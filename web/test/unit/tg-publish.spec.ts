// Unit: единый publish-путь publishToTelegram — гейт TG-env, санитайз, карта
// ошибок Bot API (§7.4), запись outbox (ok/error), tgPublishResponse, rate-limit.
// core (challenge) мокается: интересует оркестрация, не сам HTTP.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { publishPost as publishPostT } from '../../lib/server/challenge';

process.env.CHALLENGE_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tg-publish-test-'));

// Частичный мок: подменяем только isTelegramConfigured/publishPost, остальной баррель
// (dataPath для outbox и пр.) остаётся реальным.
vi.mock('../../lib/server/challenge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/server/challenge')>();
  return {
    ...actual,
    isTelegramConfigured: vi.fn(),
    publishPost: vi.fn(),
  };
});

type Out = { ok: boolean; messageId?: number; error?: string; errorKind?: string; retryAfter?: number };

let publishToTelegram: (
  text: string,
  source: 'manual' | 'blog' | 'summary',
  blogPostId?: number,
  parseMode?: 'HTML' | 'none',
  chatId?: string,
) => Promise<Out>;
let tgPublishResponse: (out: Out) => Response;
let tgRateLimit: (key: string) => { ok: boolean; retryAfterSec?: number };
let publishPost: typeof publishPostT;
let isTelegramConfigured: ReturnType<typeof vi.fn>;
let getOutboxDb: () => {
  insert: (row: Record<string, unknown>) => number;
  recent: (limit?: number) => Array<{ status?: string; source?: string; message_id?: number | null; blog_post_id?: number | null; text?: string; error?: string | null }>;
};

beforeAll(async () => {
  const challenge = await import('../../lib/server/challenge');
  publishPost = vi.mocked(challenge.publishPost);
  isTelegramConfigured = vi.mocked(challenge.isTelegramConfigured);
  const mod = await import('../../lib/server/tg-publish');
  publishToTelegram = mod.publishToTelegram as typeof publishToTelegram;
  tgPublishResponse = mod.tgPublishResponse as typeof tgPublishResponse;
  tgRateLimit = mod.tgRateLimit;
  const outbox = await import('../../lib/server/outbox');
  getOutboxDb = outbox.getOutboxDb as unknown as typeof getOutboxDb;
});

beforeEach(() => {
  vi.mocked(isTelegramConfigured).mockReturnValue(true);
  vi.mocked(publishPost).mockResolvedValue({ ok: true, messageId: 7 });
});

describe('publishToTelegram — happy path', () => {
  it('ok → messageId + запись outbox (ok) с source и sanitized-текстом', async () => {
    const out = await publishToTelegram('<b>hi</b><script>x</script>', 'manual');

    expect(out).toMatchObject({ ok: true, messageId: 7 });
    expect(publishPost).toHaveBeenCalledWith('<b>hi</b>&lt;script&gt;x&lt;/script&gt;', 'HTML', undefined);

    const [row] = getOutboxDb().recent(1);
    expect(row.status).toBe('ok');
    expect(row.source).toBe('manual');
    expect(row.message_id).toBe(7);
    // В outbox лежит исходный текст (как набрал админ), не санитайз
    expect(row.text).toBe('<b>hi</b><script>x</script>');
  });

  it('blog-путь пишет source=blog + blog_post_id', async () => {
    await publishToTelegram('пост', 'blog', 24);
    const [row] = getOutboxDb().recent(1);
    expect(row.source).toBe('blog');
    expect(row.blog_post_id).toBe(24);
  });

  it('parseMode none уходит в publishPost без HTML', async () => {
    await publishToTelegram('текст', 'manual', undefined, 'none');
    expect(publishPost).toHaveBeenCalledWith('текст', 'none', undefined);
  });

  it('chatId блога пробрасывается пятым аргументом (мульти-блог)', async () => {
    await publishToTelegram('пост', 'blog', 24, 'HTML', '-100123');
    expect(publishPost).toHaveBeenCalledWith('пост', 'HTML', '-100123');
  });
});

describe('publishToTelegram — карта ошибок (ТЗ §7.4)', () => {
  it('TG не настроен → not-configured, outbox НЕ пишется', async () => {
    vi.mocked(isTelegramConfigured).mockReturnValue(false);
    const before = getOutboxDb().recent(100).length;

    const out = await publishToTelegram('x', 'manual');
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('not-configured');
    expect(out.error).toContain('Telegram не настроен');
    expect(getOutboxDb().recent(100).length).toBe(before);
  });

  it('401 Unauthorized → unauthorized + человеческий текст + error-запись', async () => {
    vi.mocked(publishPost).mockResolvedValue({ ok: false, error: 'Unauthorized' });
    const out = await publishToTelegram('x', 'manual');

    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('unauthorized');
    expect(out.error).toBe('Токен бота недействителен. Проверьте TG_BOT_TOKEN');
    const [row] = getOutboxDb().recent(1);
    expect(row.status).toBe('error');
  });

  it('chat not found → chat-not-found', async () => {
    vi.mocked(publishPost).mockResolvedValue({ ok: false, error: 'Bad Request: chat not found' });
    const out = await publishToTelegram('x', 'summary');
    expect(out.errorKind).toBe('chat-not-found');
    expect(out.error).toContain('Канал не найден');
  });

  it('403 not enough rights → forbidden', async () => {
    vi.mocked(publishPost).mockResolvedValue({
      ok: false,
      error: 'Bad Request: bot is not a member of the channel chat',
    });
    const out = await publishToTelegram('x', 'manual');
    expect(out.errorKind).toBe('forbidden');
  });

  it('429 retry after 26 → rate-limit + retryAfter 27', async () => {
    vi.mocked(publishPost).mockResolvedValue({ ok: false, error: 'Too Many Requests: retry after 26' });
    const out = await publishToTelegram('x', 'manual');
    expect(out.errorKind).toBe('rate-limit');
    expect(out.retryAfter).toBe(27); // retry_after + 1с буфер
    expect(out.error).toContain('27 с');
  });

  it('сеть (fetch failed) → network + «текст сохранён»', async () => {
    vi.mocked(publishPost).mockResolvedValue({ ok: false, error: 'fetch failed' });
    const out = await publishToTelegram('x', 'manual');
    expect(out.errorKind).toBe('network');
    expect(out.error).toContain('недоступен');
  });

  it('неизвестная ошибка проходит через safeMessage (URL режется)', async () => {
    vi.mocked(publishPost).mockResolvedValue({
      ok: false,
      error: 'weird failure at https://api.telegram.org/bot123:secret/x',
    });
    const out = await publishToTelegram('x', 'manual');
    expect(out.errorKind).toBe('unknown');
    expect(out.error).not.toContain('https://');
    expect(out.error).toContain('<url>');
  });
});

describe('tgPublishResponse — HTTP-маппинг', () => {
  it('ok → 200 + messageId', () => {
    const r = tgPublishResponse({ ok: true, messageId: 5 });
    expect(r.status).toBe(200);
  });

  it('not-configured → 400; rate-limit → 429 + retryAfter; остальное → 502', async () => {
    expect(tgPublishResponse({ ok: false, errorKind: 'not-configured', error: 'x' }).status).toBe(400);
    const rl = tgPublishResponse({ ok: false, errorKind: 'rate-limit', error: 'жди', retryAfter: 12 });
    expect(rl.status).toBe(429);
    await expect(rl.json()).resolves.toMatchObject({ retryAfter: 12 });
    expect(tgPublishResponse({ ok: false, errorKind: 'unauthorized', error: 'x' }).status).toBe(502);
  });
});

describe('tgRateLimit — 10/мин на ключ', () => {
  it('11-я попытка подряд блокируется с retryAfterSec', () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(tgRateLimit(key).ok).toBe(true);
    }
    const blocked = tgRateLimit(key);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('ключи независимы', () => {
    expect(tgRateLimit('other-key').ok).toBe(true);
  });
});
