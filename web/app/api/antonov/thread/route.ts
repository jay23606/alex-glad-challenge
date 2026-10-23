// POST /api/antonov/thread — агент «Поток-перевод» студии /antonov (режим
// потока). НЕ в PUBLIC_PATHS → auth-middleware отдаёт гостю 401; личный
// инструмент владельца. Отличие от /api/antonov/rewrite: на входе ЧУЖОЙ длинный
// разбор, на выходе СЕРИЯ постов ТГ с рамкой переводчика (пост 1 — рамка,
// середина — голос автора, последний — «прим. переводчика» + источник);
// каркас и системный промпт — THREAD_SYSTEM_PROMPT (lib/server/style-prompt.ts).
//   1) свой rate-limit-бакет по прецеденту rewrite-роута (per-IP 20 + fuse 60
//      на 15 мин; fuse ДО создания IP-окна);
//   2) zod-граница antonovThreadSchema (text ≤15000, images ≤12) + clean();
//   3) ответ модели парсится splitThreadResponse (===ПОСТ===); посты длиннее
//      TG_MAX_POST_LEN режутся splitLongPost (кап Telegram 4096 с запасом);
//   4) maxTokens зависит от провайдера: облако 6000 (поток длиннее одиночного
//      поста), local 4000 — иначе вход 15000 зн. + system + выход не влезает в
//      num_ctx 12288 и Ollama молча режет хвост (см. комментарий в rewrite-роуте).
// Ошибки: 400 (zod/не-JSON), 429 (+Retry-After), 502 (LLM/сеть, safeMessage),
// 503 (LLM не настроен нигде / выбранный local не настроен).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';


import { antonovThreadSchema } from '../../../../lib/shared/forms';
import { clean, msg } from '../../../../lib/server/challenge';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getKeysStatus } from '../../../../lib/server/env';
import { safeMessage } from '../../../../lib/server/safe-message';
import { THREAD_SYSTEM_PROMPT, buildThreadUserPrompt } from '../../../../lib/server/style-prompt';
import { TG_MAX_POST_LEN, splitLongPost, splitThreadResponse } from '../../../../lib/server/thread-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Поток по замыслу длинный (3–12 постов × до 3500 зн.), поэтому выходной потолок
// выше, чем у rewrite (3000): облако тянет 6000, локальная модель ограничена
// контекстом (см. шапку).
const MAX_OUTPUT_TOKENS_CLOUD = 6000;
const MAX_OUTPUT_TOKENS_LOCAL = 4000;
// Локальная модель без явного num_ctx молча режет длинный вход; 12288 — рабочий
// максимум для 3.8 GB RAM (инцидент OOM 2026-09-24, подробнее в rewrite-роуте).
const LOCAL_NUM_CTX = 12288;
// Лимиты владельца — как у rewrite-роута, но бакет свой (поток генерится реже,
// однако дольше; делить окна с одиночными постами не хотим).
const RATE_PER_IP = 20;
const RATE_GLOBAL = 60;
const RATE_WINDOW_MS = 15 * 60 * 1000;

interface RateWindow {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as {
  __antonovThreadRate?: { ips: Map<string, RateWindow>; total: RateWindow };
};
const rate = (g.__antonovThreadRate ??= { ips: new Map(), total: { count: 0, resetAt: 0 } });

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
  // --- Rate-limit: fuse до всего остального ---
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
  const parsed = antonovThreadSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' }, 400);
  }

  // --- Провайдер: как в rewrite-роуте, выбранный local без настроек → 503 ---
  const input = parsed.data;
  const keys = getKeysStatus();
  if (!keys.cloud.configured && !keys.local.configured) {
    return json(
      { ok: false, error: 'LLM не настроен ни локально, ни в облаке — студия временно недоступна.' },
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
  const text = clean(input.text, 15000);
  const userPrompt = buildThreadUserPrompt({
    ...input,
    text,
    images: input.images.map((img) => clean(img, 200)).filter((img) => img.length > 0),
  });

  try {
    const raw = await client.chat(
      [msg.system(THREAD_SYSTEM_PROMPT), msg.user(userPrompt)],
      {
        temperature: 0.8,
        maxTokens: provider === 'local' ? MAX_OUTPUT_TOKENS_LOCAL : MAX_OUTPUT_TOKENS_CLOUD,
        numCtx: provider === 'local' ? LOCAL_NUM_CTX : undefined,
      },
    );
    // clean() поверх ответа модели: tainted LLM-текст → владельцу (клацание «Скопировать»).
    const posts = splitThreadResponse(clean(raw, 40000))
      .flatMap((post) => splitLongPost(post, TG_MAX_POST_LEN))
      .map((post) => post.trim())
      .filter((post) => post.length > 0);
    if (posts.length === 0) {
      return json({ ok: false, error: 'Модель вернула пустой результат — попробуйте ещё раз.' }, 502);
    }
    return json({ ok: true, posts, provider }, 200);
  } catch (e) {
    // LLM/сеть упали (Ollama лежит, таймаут, ключ) → честный 502, safeMessage
    // чистит Bearer/URL/пути/ключи из сообщения.
    const detail = e instanceof Error ? safeMessage(e.message) : 'thread failed';
    return json(
      { ok: false, error: `Студия временно недоступна (${detail}). Попробуйте позже.` },
      502,
    );
  }
}
