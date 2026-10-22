// Единый publish-путь в Telegram из веба (ТЗ §7.2/§7.4): гейт isTelegramConfigured()
// → publishPost() (chokepoint challenge.ts) → запись в outbox (ok/error) →
// нормализованный результат с errorKind/retryAfter для UX-карты ошибок.
// Все тексты ошибок — через safeMessage(). Вариант маппинга: в вебе (§13), core не
// расширяется (только back-compat parseMode-параметр).
import 'server-only';
import { isTelegramConfigured, publishPost } from './challenge';
import { getOutboxDb, type OutboxSource } from './outbox';
import { withDb } from './db';
import { safeMessage } from './safe-message';
import { sanitizeTgHtml } from '../shared/tg-html';

export type TgErrorKind =
  | 'not-configured'
  | 'unauthorized'
  | 'chat-not-found'
  | 'forbidden'
  | 'rate-limit'
  | 'network'
  | 'unknown';

export interface TgPublishOutcome {
  ok: boolean;
  messageId?: number;
  /** Человекочитаемый текст (safeMessage) — прямо в UI. */
  error?: string;
  errorKind?: TgErrorKind;
  /** Секунды ожидания для kind='rate-limit' (Bot API retry_after). */
  retryAfter?: number;
}

// UX-карта ошибок Bot API (ТЗ §7.4). rate-limit/not-configured собираются отдельно.
const KIND_MESSAGES: Record<Exclude<TgErrorKind, 'unknown' | 'not-configured' | 'rate-limit'>, string> = {
  unauthorized: 'Токен бота недействителен. Проверьте TG_BOT_TOKEN',
  'chat-not-found': 'Канал не найден. Проверьте TG_CHAT_ID и что бот — администратор канала',
  forbidden: 'Боту нужны права администратора канала',
  network: 'Telegram недоступен (таймаут). Текст сохранён — повторите',
};

function classify(raw: string): { kind: TgErrorKind; retryAfter?: number } {
  const s = raw.toLowerCase();
  if (s.includes('unauthorized') || s.includes('401')) return { kind: 'unauthorized' };
  if (s.includes('chat not found')) return { kind: 'chat-not-found' };
  if (
    s.includes('not a member') ||
    s.includes('not enough rights') ||
    s.includes('kicked') ||
    s.includes('forbidden') ||
    s.includes('403')
  ) {
    return { kind: 'forbidden' };
  }
  if (s.includes('too many requests') || s.includes('429')) {
    const m = /retry after (\d+)/.exec(s);
    return { kind: 'rate-limit', retryAfter: m ? Number(m[1]) + 1 : undefined };
  }
  if (
    s.includes('timeout') ||
    s.includes('abort') ||
    s.includes('fetch failed') ||
    s.includes('econn') ||
    s.includes('enotfound') ||
    s.includes('etimedout')
  ) {
    return { kind: 'network' };
  }
  return { kind: 'unknown' };
}

function humanize(kind: TgErrorKind, raw: string, retryAfter?: number): string {
  if (kind === 'not-configured') return 'Telegram не настроен (TG_BOT_TOKEN/TG_CHAT_ID не заданы)';
  if (kind === 'rate-limit') return `Telegram просит подождать ${retryAfter ?? '?'} с перед повтором`;
  if (kind === 'unknown') return safeMessage(raw || 'publish failed');
  return KIND_MESSAGES[kind];
}

export async function publishToTelegram(
  text: string,
  source: OutboxSource,
  blogPostId?: number,
  parseMode: 'HTML' | 'none' = 'HTML',
  // Мульти-блог: chat_id канала блога; undefined → общий TG_CHAT_ID (внутри publishPost).
  chatId?: string,
): Promise<TgPublishOutcome> {
  if (!isTelegramConfigured()) {
    const outcome: TgPublishOutcome = { ok: false, errorKind: 'not-configured' };
    return { ...outcome, error: humanize('not-configured', '') };
  }

  const payload = parseMode === 'HTML' ? sanitizeTgHtml(text) : text;
  const result = await publishPost(payload, parseMode, chatId);

  if (result.ok) {
    await withDb(() =>
      getOutboxDb().insert({
        text,
        source,
        blogPostId: blogPostId ?? null,
        messageId: result.messageId ?? null,
        status: 'ok',
      }),
    );
    return { ok: true, messageId: result.messageId };
  }

  const raw = result.error ?? 'publish failed';
  const { kind, retryAfter } = classify(raw);
  const human = humanize(kind, raw, retryAfter);
  await withDb(() =>
    getOutboxDb().insert({
      text,
      source,
      blogPostId: blogPostId ?? null,
      status: 'error',
      error: safeMessage(human),
    }),
  );
  return { ok: false, error: safeMessage(human), errorKind: kind, retryAfter };
}

// HTTP-маппинг результата для Route Handlers (единый для manual/blog/summary).
export function tgPublishResponse(outcome: TgPublishOutcome): Response {
  if (outcome.ok) return Response.json({ ok: true, messageId: outcome.messageId });
  const status =
    outcome.errorKind === 'not-configured' ? 400 : outcome.errorKind === 'rate-limit' ? 429 : 502;
  return Response.json(
    {
      ok: false,
      error: outcome.error ?? 'publish failed',
      errorKind: outcome.errorKind,
      ...(outcome.retryAfter !== undefined ? { retryAfter: outcome.retryAfter } : {}),
    },
    { status },
  );
}

// In-memory rate-limit (ТЗ §9): 10/мин на сессию для publish-мутаций. Ключ —
// sha256-cookie (сырое значение cookie не хранится). 1-юзер локально, но гейт
// от дубль-кликов и зацикленных ретраев.
const WINDOW_MS = 60_000;
const MAX_HITS = 10;
const hits = new Map<string, number[]>();

export function tgRateLimit(key: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    return { ok: false, retryAfterSec: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}
