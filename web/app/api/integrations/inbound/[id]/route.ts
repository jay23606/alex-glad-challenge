// /api/integrations/inbound/[id] — приём события (POST, публичный: HMAC-подпись
// сырого тела вместо сессии; путь открыт в middleware) + удаление хука (DELETE, auth).
// Подпись — hex HMAC-SHA256(secret, rawBody) в заголовке x-artel-signature
// (тот же контракт, что у исходящих webhooks).
//
// Rate-limit POST: глобальный in-memory fixed-window, 30 неудачных попыток (401/404/400)
// за 5 минут → 429 + Retry-After до конца окна. Успешная подпись (доказательство
// владения секретом) счётчик сбрасывает. Глобальный (не per-IP) сознательно, как у
// login: за прокси XFF подделываем; сбрасывается рестартом.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { inboundEventSchema } from '../../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../../lib/server/http';
import {
  getInboundHookDb,
  getNotificationDb,
  getTodoDb,
  withDb,
} from '../../../../../lib/server/db';
import {
  NotificationService,
  handleInboundEvent,
  verifySignature,
} from '../../../../../lib/server/challenge';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = 30; // неудачных попыток до блокировки
const RATE_WINDOW_MS = 5 * 60 * 1000; // окно 5 минут

// Модульное состояние окна (globalThis — переживает HMR dev-сервера).
const g = globalThis as unknown as { __inboundHookFails?: { fails: number; resetAt: number } };
const state = (g.__inboundHookFails ??= { fails: 0, resetAt: 0 });

function registerFail(): void {
  const now = Date.now();
  if (now >= state.resetAt) {
    state.fails = 0;
    state.resetAt = now + RATE_WINDOW_MS;
  }
  state.fails += 1;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (state.fails >= RATE_LIMIT && Date.now() < state.resetAt) {
    const retryAfterSec = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: 'Слишком много неудачных попыток. Подождите до конца 5-минутного окна.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSec) } },
    );
  }

  const { id } = await params;
  const hookId = Number(id);
  if (!Number.isInteger(hookId) || hookId <= 0) {
    registerFail();
    return jsonError('invalid id', 400);
  }

  // Сырое тело до JSON.parse — подпись считается по нему.
  const rawBody = await req.text();
  const signature = req.headers.get('x-artel-signature') ?? '';

  const hook = await withDb(() => getInboundHookDb().get(hookId));
  if (!hook) {
    registerFail();
    return jsonError('hook not found', 404);
  }
  if (!verifySignature(hook.secret, rawBody, signature)) {
    registerFail();
    return jsonError('invalid signature', 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    registerFail();
    return jsonError('body must be valid JSON', 400);
  }
  const parsed = inboundEventSchema.safeParse(json);
  if (!parsed.success) {
    registerFail();
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  }

  try {
    const recordId = await withDb(() =>
      handleInboundEvent(hook, parsed.data, {
        notifications: new NotificationService(getNotificationDb()),
        todos: getTodoDb(),
      }),
    );
    // Успех: валидная подпись доказывает владение секретом → сброс окна (как у login).
    state.fails = 0;
    state.resetAt = 0;
    return jsonOk({ id: recordId });
  } catch (e) {
    registerFail();
    return jsonError(safeMessage(e instanceof Error ? e.message : 'handle failed'), 400);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const hookId = Number(id);
  if (!Number.isInteger(hookId) || hookId <= 0) return jsonError('invalid id', 400);
  const ok = await withDb(() => getInboundHookDb().delete(hookId));
  if (!ok) return jsonError('hook not found', 404);
  return jsonOk({});
}
