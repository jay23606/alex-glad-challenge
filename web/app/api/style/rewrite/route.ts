// POST /api/style/rewrite — «Антоновайзер»: публичный рерайт текста в стиле
// канала-инсайдера (страница /style). Контур защиты — прецедент /api/demo/rag:
//   1) двойной rate-limit (per-IP 5 + глобальный предохранитель 40 на 15 мин,
//      in-memory fixed-window на globalThis; fuse проверяется ДО создания
//      IP-окна — спуфинг XFF не надувает Map);
//   2) zod-граница styleRewriteSchema (text ≤2000, mode/format/signature/llm) +
//      clean() tainted-текста;
//   3) LLM и промпт фиксирует сервер; из запроса принимается ТОЛЬКО выбор движка
//      llm: 'cloud' | 'local' (оба настроены серверным env, дефолт cloud; cloud
//      без ключа → существующий фолбэк на local) — lib/server/style-prompt.ts;
//   4) ответ = переписанный текст + фактически использованный provider.
// Ошибки: 400 (zod/не-JSON), 429 (+Retry-After), 502 (LLM/сеть, safeMessage),
// 503 (LLM не настроен нигде).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';


import { styleRewriteSchema } from '../../../../lib/shared/forms';
import { clean, msg } from '../../../../lib/server/challenge';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getKeysStatus } from '../../../../lib/server/env';
import { safeMessage } from '../../../../lib/server/safe-message';
import { STYLE_SYSTEM_PROMPT, buildStyleUserPrompt } from '../../../../lib/server/style-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_POST_LEN = 4000;
// Рерайт тяжелее вопроса к RAG (генерация длиннее) — лимиты ниже демо-шных.
const RATE_PER_IP = 5;
const RATE_GLOBAL = 40;
const RATE_WINDOW_MS = 15 * 60 * 1000;

interface RateWindow {
  count: number;
  resetAt: number;
}

// Модульное состояние окон (globalThis — переживает HMR dev-сервера).
const g = globalThis as unknown as {
  __styleRewriteRate?: { ips: Map<string, RateWindow>; total: RateWindow };
};
const rate = (g.__styleRewriteRate ??= { ips: new Map(), total: { count: 0, resetAt: 0 } });

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function rollWindow(w: RateWindow, now: number): void {
  if (now >= w.resetAt) {
    w.count = 0;
    w.resetAt = now + RATE_WINDOW_MS;
  }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function tooMany(retryAfterSec: number): NextResponse {
  return json(
    {
      ok: false,
      error: `Слишком много запросов — попробуйте снова через ${Math.max(1, Math.ceil(retryAfterSec / 60))} мин.`,
      retryAfterSec,
    },
    429,
    { 'Retry-After': String(retryAfterSec) },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  // --- Rate-limit: fuse до всего остального (см. шапку) ---
  const now0 = Date.now();
  rollWindow(rate.total, now0);
  if (rate.total.count > RATE_GLOBAL) {
    return tooMany(Math.max(1, Math.ceil((rate.total.resetAt - now0) / 1000)));
  }

  const ip = clientIp(req);
  if (rate.ips.size > 500) {
    for (const [k, v] of rate.ips) {
      if (now0 >= v.resetAt) rate.ips.delete(k);
    }
  }
  let win = rate.ips.get(ip);
  if (!win) {
    win = { count: 0, resetAt: now0 + RATE_WINDOW_MS };
    rate.ips.set(ip, win);
  }
  rollWindow(win, now0);
  win.count += 1;
  if (win.count > RATE_PER_IP) {
    return tooMany(Math.max(1, Math.ceil((win.resetAt - now0) / 1000)));
  }

  rate.total.count += 1;
  if (rate.total.count > RATE_GLOBAL) {
    return tooMany(Math.max(1, Math.ceil((rate.total.resetAt - now0) / 1000)));
  }

  // --- Валидация входа (граница; не-JSON тело тоже 400) ---
  const parsed = styleRewriteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' }, 400);
  }

  // --- Провайдер: явный выбор из запроса (llm), дефолт cloud; если выбранного
  // нет — 503 с конкретикой, если cloud не настроен — существующий фолбэк на local.
  const input = parsed.data;
  const keys = getKeysStatus();
  if (!keys.cloud.configured && !keys.local.configured) {
    return json(
      { ok: false, error: 'LLM не настроен ни локально, ни в облаке — стилизатор временно недоступен.' },
      503,
    );
  }
  const prefersLocal = input.llm === 'local';
  if (prefersLocal && !keys.local.configured) {
    return json(
      { ok: false, error: 'Локальная LLM не настроена (LOCAL_LLM_BASE_URL / LOCAL_LLM_MODEL) — выберите облако или настройте Ollama.' },
      503,
    );
  }
  const provider: 'cloud' | 'local' = prefersLocal || !keys.cloud.configured ? 'local' : 'cloud';
  const client = pickLlmClient(provider);

  // clean() поверх tainted-текста: в промпт идёт очищенная версия (и это единственная).
  const userPrompt = buildStyleUserPrompt({ ...input, text: clean(input.text, 2000) });

  try {
    const raw = await client.chat([msg.system(STYLE_SYSTEM_PROMPT), msg.user(userPrompt)], {
      temperature: 0.8,
      maxTokens: 1500,
    });
    // clean() поверх ответа модели: tainted LLM-текст → гость (клацание «Скопировать»).
    const post = clean(raw, MAX_POST_LEN).trim();
    if (post.length === 0) {
      return json({ ok: false, error: 'Модель вернула пустой результат — попробуйте ещё раз.' }, 502);
    }
    return json({ ok: true, post, provider }, 200);
  } catch (e) {
    // LLM/сеть упали (Ollama лежит, таймаут, ключ) → честный 502, safeMessage
    // чистит Bearer/URL/пути/ключи из сообщения.
    const detail = e instanceof Error ? safeMessage(e.message) : 'rewrite failed';
    return json(
      { ok: false, error: `Стилизатор временно недоступен (${detail}). Попробуйте позже.` },
      502,
    );
  }
}
