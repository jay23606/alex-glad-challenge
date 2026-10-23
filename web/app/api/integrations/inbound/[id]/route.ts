// /api/integrations/inbound/[id] — приём события (POST, публичный: HMAC-подпись
// сырого тела вместо сессии; путь открыт в middleware) + удаление хука (DELETE, auth).
// Подпись — hex HMAC-SHA256(secret, rawBody) в заголовке x-artel-signature
// (тот же контракт, что у исходящих webhooks); rawBody — сырые байты запроса,
// декодирование в UTF-8 для JSON.parse — только после проверки (issue #98).
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

// Лимит размера тела POST до проверки подписи (issue #96). Тело нужно целиком
// (HMAC считается по raw body), т.е. оно читается до аутентификации — без капа
// запрос с огромным/бесконечным (chunked) телом вынуждает сервер буферизовать
// его в памяти: pre-auth memory DoS. 64 KiB с запасом покрывают легитимные
// события {title, body} и отсекают всё крупное до/во время чтения.
const MAX_BODY_BYTES = 64 * 1024;

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

// Чтение тела с капом; ok:false too-large — лимит превышен, aborted — поток
// сорвался (обрыв клиента → 400, а не 500; это не попытка подбора подписи,
// rate-счётчик не двигает). Сначала дешёвый precheck по заголовку
// Content-Length (отказ до чтения потока), затем поток читается чанками как
// сырые байты: подпись считается по байтам, декодирование UTF-8 — только после
// успешной проверки (issue #98: TextDecoder режет BOM и подменяет битые
// последовательности, HMAC по декодированной строке не совпадает с подписью
// отправителя). Память — один преаллоцированный буфер + курсор: O(MAX) на запрос
// независимо от гранулярности чанков (массив чанков при chunked '1\r\nA\r\n'
// раздувал heap в сотни раз при «64 KiB» запросе). При переполнении чтение
// прекращается (reader.cancel()) — chunked-запрос без Content-Length не может
// буферизоваться бесконечно.
type BodyRead =
  | { ok: true; body: Buffer }
  | { ok: false; reason: 'too-large' | 'aborted' };

async function readBodyCapped(req: NextRequest): Promise<BodyRead> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, reason: 'too-large' };
  if (!req.body) return { ok: true, body: Buffer.alloc(0) };
  const reader = req.body.getReader();
  const buf = Buffer.allocUnsafe(MAX_BODY_BYTES);
  let len = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { ok: true, body: buf.subarray(0, len) };
      if (len + value.byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {}); // reject cancel не уводит в catch: кап остаётся 413, не 400
        return { ok: false, reason: 'too-large' };
      }
      buf.set(value, len);
      len += value.byteLength;
    }
  } catch {
    return { ok: false, reason: 'aborted' };
  } finally {
    // cancel: no-op на закрытом/оборванном потоке (ошибки игнорируем);
    // releaseLock: чтение всегда завершено к этому моменту.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
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

  // Сырое тело до JSON.parse — подпись считается по его байтам. Читается с
  // капом: oversized → 413 до/во время чтения, до проверки подписи (issue #96);
  // обрыв клиента → 400 (issue #98).
  const read = await readBodyCapped(req);
  if (!read.ok) {
    if (read.reason === 'aborted') return jsonError('request aborted', 400);
    return jsonError('body too large', 413);
  }
  const rawBody = read.body;
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

  // Декодирование только после успешной проверки подписи: подпись — по байтам.
  const bodyText = new TextDecoder().decode(rawBody);
  let json: unknown;
  try {
    json = JSON.parse(bodyText) as unknown;
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
