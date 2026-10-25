// Unit: Route Handler POST /api/antonov/thread — агент «Поток-перевод» студии
// /antonov (авторизованный инструмент владельца). Зеркало antonov-rewrite-route:
// свой rate-limit-бакет 20/60, zod-кап 15000, ответ модели парсится в посты
// (===ПОСТ===), длинные посты режутся до лимита ТГ. THREAD_SYSTEM_PROMPT и
// buildThreadUserPrompt — общие с lib/server/style-prompt (проверяем содержимое
// сообщений). pickLlmClient/env мокаются; server-only застаблен; clean() —
// реальный. Auth-гейт — middleware, юнит-тестом не покрывается.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../lib/server/llm', () => ({
  pickLlmClient: vi.fn(() => ({ chat: vi.fn() })),
}));

vi.mock('../../lib/server/env', () => ({
  getKeysStatus: vi.fn(() => ({
    cloud: { configured: true, provider: 'DeepSeek', model: 'test-model' },
    local: { configured: true, model: 'test-local' },
    embed: { configured: true, model: 'test-embed' },
    mtproto: { configured: false },
    botApi: { configured: false, channelLabel: null },
    activeModel: 'test-model',
    activeProvider: 'DeepSeek',
  })),
}));

let POST: (req: NextRequest) => Promise<Response>;
let chat: ReturnType<typeof vi.fn>;
let pickLlmClient: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('../../app/api/antonov/thread/route');
  POST = mod.POST;
  const llm = await import('../../lib/server/llm');
  pickLlmClient = vi.mocked(llm.pickLlmClient) as unknown as ReturnType<typeof vi.fn>;
}, 30_000);

beforeEach(() => {
  chat = vi.fn();
  pickLlmClient.mockClear();
  pickLlmClient.mockImplementation(() => ({ chat }) as never);
  // Сброс in-memory rate-limit окон роута между тестами (свой бакет потока).
  const g = globalThis as unknown as {
    __antonovThreadRate?: { ips: Map<string, unknown>; total: { count: number; resetAt: number } };
  };
  if (g.__antonovThreadRate) {
    g.__antonovThreadRate.ips.clear();
    g.__antonovThreadRate.total.count = 0;
    g.__antonovThreadRate.total.resetAt = 0;
  }
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/antonov/thread', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/antonov/thread', () => {
  it('пустой текст (после trim) → 400 zod, до LLM не доходит', async () => {
    const res = await POST(req({ text: '   ' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Введите текст' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('кап хозяина: 15000 символов проходит, 15001 → 400', async () => {
    chat.mockResolvedValue('===ПОСТ===\nпост');
    const ok = await POST(req({ text: 'а'.repeat(15000) }));
    expect(ok.status).toBe(200);

    const res = await POST(req({ text: 'а'.repeat(15001) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('максимум 15000 символов');
  });

  it('13 картинок → 400 zod (лимит 12), 12 — проходят', async () => {
    chat.mockResolvedValue('===ПОСТ===\nпост');
    const imgs = Array.from({ length: 12 }, (_, i) => `картинка ${i + 1}`);
    expect((await POST(req({ text: 'текст', images: imgs }))).status).toBe(200);

    const res = await POST(req({ text: 'текст', images: [...imgs, 'лишняя'] }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Картинок — не больше 12' });
  });

  it('не-JSON тело → 400', async () => {
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/antonov/thread', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('успех: ответ модели парсится в посты, 200 {ok,posts,provider} no-store; THREAD-промпт и рамка в user', async () => {
    chat.mockResolvedValue('===ПОСТ===\nПеревожу разбор. Поехали.\n===ПОСТ===\nГолос автора. Вот именно.');
    const res = await POST(
      req({
        text: 'Длинный разбор про полузащиту.',
        author: 'TheNearPost',
        source: 'https://example.com/src',
        images: ['схема центра поля'],
        mode: 'normal',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as { ok: boolean; posts: string[]; provider: string };
    expect(body.ok).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['ok', 'posts', 'provider']);
    expect(body.posts).toEqual(['Перевожу разбор. Поехали.', 'Голос автора. Вот именно.']);
    expect(body.provider).toBe('cloud');

    const [messages, params] = chat.mock.calls[0] as unknown as [
      Array<{ role: string; content: string }>,
      { temperature: number; maxTokens: number; numCtx?: number },
    ];
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('АГЕНТ-ПЕРЕВОДЧИК');
    expect(messages[0]!.content).toContain('===ПОСТ===');
    expect(messages[1]!.content).toContain('Автор оригинала: TheNearPost');
    expect(messages[1]!.content).toContain('Источник: https://example.com/src');
    expect(messages[1]!.content).toContain('1. схема центра поля');
    expect(messages[1]!.content).toContain('ПО-СВОЙСКИ');
    expect(messages[1]!.content).toContain('Длинный разбор про полузащиту.');
    expect(params.temperature).toBe(0.8);
    // Облаку можно 6000: выход потока длиннее одиночного поста.
    expect(params.maxTokens).toBe(6000);
    expect(params.numCtx).toBeUndefined();
    expect(pickLlmClient).toHaveBeenCalledWith('cloud');
  });

  it('автор/источник/картинки не заданы → нейтральная рамка в user-промпте, без списка картинок', async () => {
    chat.mockResolvedValue('===ПОСТ===\nпост');
    await POST(req({ text: 'текст' }));
    const [messages] = chat.mock.calls[0] as unknown as [Array<{ content: string }>];
    expect(messages[1]!.content).toContain('(не указан');
    expect(messages[1]!.content).toContain('Картинок нет');
    expect(messages[1]!.content).not.toContain('1. ');
  });

  it('ответ без разделителей → один пост (не 502)', async () => {
    chat.mockResolvedValue('Цельный ответ модели без разметки.');
    const res = await POST(req({ text: 'текст' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: string[] };
    expect(body.posts).toEqual(['Цельный ответ модели без разметки.']);
  });

  it('пост длиннее лимита ТГ режется на части, каждая ≤4000', async () => {
    const paragraph = 'а'.repeat(100);
    chat.mockResolvedValue(`===ПОСТ===\n${Array.from({ length: 60 }, () => paragraph).join('\n\n')}`);
    const res = await POST(req({ text: 'текст' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: string[] };
    expect(body.posts.length).toBeGreaterThan(1);
    for (const post of body.posts) {
      expect(post.length).toBeLessThanOrEqual(4000);
    }
  });

  it('llm:"local" → локальный клиент, numCtx 12288 и maxTokens 4000 (вход+system+выход ≤ контекста)', async () => {
    chat.mockResolvedValue('===ПОСТ===\nпост');
    const res = await POST(req({ text: 'текст', llm: 'local' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string };
    expect(body.provider).toBe('local');
    expect(pickLlmClient).toHaveBeenCalledWith('local');
    const [messages, params] = chat.mock.calls[0] as unknown as [
      Array<{ content: string }>,
      { maxTokens: number; numCtx?: number },
    ];
    expect(messages[0]!.content).toContain('АГЕНТ-ПЕРЕВОДЧИК');
    expect(params.maxTokens).toBe(4000);
    expect(params.numCtx).toBe(12288);
  });

  it('llm:"local" при ненастроенной local → 503 с подсказкой про env', async () => {
    const env = await import('../../lib/server/env');
    vi.mocked(env.getKeysStatus).mockReturnValueOnce({
      cloud: { configured: true, provider: 'DeepSeek', model: 'test-model' },
      local: { configured: false },
      embed: { configured: true, model: 'test-embed' },
      mtproto: { configured: false },
      botApi: { configured: false, channelLabel: null },
      activeModel: 'test-model',
      activeProvider: 'DeepSeek',
    });
    const res = await POST(req({ text: 'текст', llm: 'local' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toContain('LOCAL_LLM_BASE_URL');
    expect(chat).not.toHaveBeenCalled();
  });

  it('пустой ответ модели → 502, человекочитаемый', async () => {
    chat.mockResolvedValue('   ');
    const res = await POST(req({ text: 'текст' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('пустой результат');
  });

  it('LLM упал → 502 человекочитаемый, без URL/Bearer/ключей (safeMessage)', async () => {
    chat.mockRejectedValue(
      new Error('fetch failed: https://api.deepseek.com/chat/completions Bearer sk-secret123'),
    );
    const res = await POST(req({ text: 'текст' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Студия временно недоступна');
    expect(body.error).not.toContain('https://');
    expect(body.error).not.toContain('sk-secret');
  });

  it('LLM не настроен нигде → 503 до вызова модели', async () => {
    const env = await import('../../lib/server/env');
    vi.mocked(env.getKeysStatus).mockReturnValueOnce({
      cloud: { configured: false },
      local: { configured: false },
      embed: { configured: true, model: 'test-embed' },
      mtproto: { configured: false },
      botApi: { configured: false, channelLabel: null },
      activeModel: null,
      activeProvider: null,
    });
    const res = await POST(req({ text: 'текст' }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
    expect(chat).not.toHaveBeenCalled();
  });

  it('rate-limit: 21-й запрос с одного IP → 429 с Retry-After', async () => {
    chat.mockResolvedValue('===ПОСТ===\nпост');
    for (let i = 0; i < 20; i++) {
      const res = await POST(req({ text: `текст ${i}` }));
      expect(res.status).toBe(200);
    }
    const res = await POST(req({ text: 'ещё текст' }));
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await res.json()) as { ok: boolean; retryAfterSec: number };
    expect(body.ok).toBe(false);
    expect(body.retryAfterSec).toBe(Number(retryAfter));
  });

  it('глобальный fuse 60 → 429 без раздувания IP-карты (спуфинг XFF)', async () => {
    chat.mockResolvedValue('===ПОСТ===\nпост');
    let ok = 0;
    let limited = 0;
    for (let i = 1; i <= 65; i++) {
      const res = await POST(
        new NextRequest('http://127.0.0.1:3000/api/antonov/thread', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.2.${i}` },
          body: JSON.stringify({ text: `текст ${i}` }),
        }),
      );
      if (res.status === 200) ok += 1;
      else if (res.status === 429) limited += 1;
    }
    expect(ok).toBe(60);
    expect(limited).toBe(5);
  });
});
