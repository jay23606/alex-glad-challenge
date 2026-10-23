// POST /api/antonov/rewrite — студия канала «Антонов такой Антонов» (страница
// /antonov). НЕ в PUBLIC_PATHS → auth-middleware отдаёт гостю 401; это личный
// инструмент владельца, а не публичная витрина. Промпт — ТОТ ЖЕ модуль, что у
// публичного Антоновайзера (lib/server/style-prompt.ts), без копий; отличается
// контур лимитов (владелец генерит черновики пачками):
//   1) двойной rate-limit по прецеденту /api/style/rewrite (per-IP 20 + глобальный
//      предохранитель 60 на 15 мин; fuse проверяется ДО создания IP-окна);
//   2) zod-граница antonovRewriteSchema (text ≤15000) + clean() tainted-текста;
//      вход >6000 знаков → дайджест-режим: выход — сжатый пересказ, не рерайт ±30%;
//   3) LLM и промпт фиксирует сервер; из запроса принимается выбор движка
//      llm: 'cloud' | 'local' (дефолт cloud; cloud без ключа → фолбэк на local);
//   4) ответ = переписанный текст + фактически использованный provider.
// Ошибки: 400 (zod/не-JSON), 429 (+Retry-After), 502 (LLM/сеть, safeMessage),
// 503 (LLM не настроен нигде).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';


import { antonovRewriteSchema } from '../../../../lib/shared/forms';
import { clean, msg } from '../../../../lib/server/challenge';
import { pickLlmClient } from '../../../../lib/server/llm';
import { getKeysStatus } from '../../../../lib/server/env';
import { safeMessage } from '../../../../lib/server/safe-message';
import { STYLE_SYSTEM_PROMPT, buildStyleUserPrompt } from '../../../../lib/server/style-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Вход ≤15000 знаков, но выход по замыслу КОМПАКТНЫЙ: длинный исходник — это
// дайджест (сжатый пересказ голосом канала, ориентир ≤~4000 зн.), а не построчный
// рерайт — иначе модель по правилу «±30% от исходника» упирается в кап и хвост
// теряется молча. Дайджест включает buildStyleUserPrompt({digest:true}) для входа
// длиннее DIGEST_THRESHOLD; maxTokens 3000 и кап ответа 8000 достаточно.
const MAX_POST_LEN = 8000;
const MAX_OUTPUT_TOKENS = 3000;
// Порог дайджеста = старый кап хозяина: до него рерайт ±30%, после — выжимка.
const DIGEST_THRESHOLD = 6000;
// Локальная модель без явного num_ctx берёт дефолт Ollama (часто 4096) и молча
// режет длинный вход: 15000 знаков + system-промпт ≈ 10-12к токенов. 12288 —
// рабочий максимум для 3.8 GB RAM: раньше тут стояло 32768, но KV-кэш qwen3.5:4b
// (3.2 GB весов) при 32k ≈ +4.8 GB → OOM-killer убивал llama-server (signal: killed,
// инцидент 2026-09-24). 12288 + KV q8_0 (ollama override) ≈ +0.9 GB — живёт.
// Облако параметр игнорирует.
const LOCAL_NUM_CTX = 12288;
// Лимиты владельца: шире публичных (5/40), но не бездонные — Ollama/ключ всё
// равно конечны. Роут закрыт сессией (см. шапку).
const RATE_PER_IP = 20;
const RATE_GLOBAL = 60;
const RATE_WINDOW_MS = 15 * 60 * 1000;

interface RateWindow {
  count: number;
  resetAt: number;
}

// Модульное состояние окон (globalThis — переживает HMR dev-сервера).
const g = globalThis as unknown as {
  __antonovRewriteRate?: { ips: Map<string, RateWindow>; total: RateWindow };
};
const rate = (g.__antonovRewriteRate ??= { ips: new Map(), total: { count: 0, resetAt: 0 } });

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
  const parsed = antonovRewriteSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' }, 400);
  }

  // --- Провайдер: явный выбор из запроса (llm), дефолт cloud; если выбранного
  // нет — 503 с конкретикой, если cloud не настроен — фолбэк на local.
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
  // Длинный исходник → дайджест-инструкция в user-промпте (сжатый пересказ).
  const text = clean(input.text, 15000);
  const userPrompt = buildStyleUserPrompt({ ...input, text }, {
    digest: text.length > DIGEST_THRESHOLD,
  });

  try {
    const raw = await client.chat([msg.system(STYLE_SYSTEM_PROMPT), msg.user(userPrompt)], {
      temperature: 0.8,
      maxTokens: MAX_OUTPUT_TOKENS,
      numCtx: provider === 'local' ? LOCAL_NUM_CTX : undefined,
    });
    // clean() поверх ответа модели: tainted LLM-текст → владельцу (клацание «Скопировать»).
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
      { ok: false, error: `Студия временно недоступна (${detail}). Попробуйте позже.` },
      502,
    );
  }
}
