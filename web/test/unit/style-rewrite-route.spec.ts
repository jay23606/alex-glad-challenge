// Unit: Route Handler POST /api/style/rewrite — «Антоновайзер» (публичный
// рерайт-эндпоинт страницы /style). Контракт: 400 zod / 429 + Retry-After /
// 200 {ok,post} / 502 c safeMessage / 503 без ключей. pickLlmClient/env
// мокаются; server-only застаблен в vitest.config; clean() — реальный.
// Промпт-модуль (style-prompt) — реальный: проверяем, что режим/формат/подпись
// попадают в user-сообщение, а система-промпт передан.
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
  const mod = await import('../../app/api/style/rewrite/route');
  POST = mod.POST;
  const llm = await import('../../lib/server/llm');
  pickLlmClient = vi.mocked(llm.pickLlmClient) as unknown as ReturnType<typeof vi.fn>;
  // Холодный импорт цепочки route → core тянет трансформ многих модулей
  // (в полном прогоне гретается кешем) — таймаут хука выше дефолтных 10с.
}, 30_000);

beforeEach(() => {
  chat = vi.fn();
  pickLlmClient.mockClear();
  pickLlmClient.mockImplementation(() => ({ chat }) as never);
  // Сброс in-memory rate-limit окон роута между тестами.
  const g = globalThis as unknown as {
    __styleRewriteRate?: { ips: Map<string, unknown>; total: { count: number; resetAt: number } };
  };
  if (g.__styleRewriteRate) {
    g.__styleRewriteRate.ips.clear();
    g.__styleRewriteRate.total.count = 0;
    g.__styleRewriteRate.total.resetAt = 0;
  }
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/style/rewrite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/style/rewrite', () => {
  it('пустой текст (после trim) → 400 zod, до LLM не доходит', async () => {
    const res = await POST(req({ text: '   ' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Введите текст' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('текст длиннее 2000 символов → 400', async () => {
    const res = await POST(req({ text: 'т'.repeat(2001) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('максимум 2000 символов');
    expect(chat).not.toHaveBeenCalled();
  });

  it('не-JSON тело → 400', async () => {
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/style/rewrite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('неверный mode → 400 (enum zod)', async () => {
    const res = await POST(req({ text: 'привет', mode: 'salt' }));
    expect(res.status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rate-limit: 6-й запрос с одного IP → 429 с Retry-After, LLM не вызывается', async () => {
    chat.mockResolvedValue('готовый пост');
    for (let i = 0; i < 5; i++) {
      const res = await POST(req({ text: `текст ${i}` }));
      expect(res.status).toBe(200);
    }
    const res = await POST(req({ text: 'ещё текст' }));
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await res.json()) as { ok: boolean; error: string; retryAfterSec: number };
    expect(body.ok).toBe(false);
    expect(body.retryAfterSec).toBe(Number(retryAfter));
    expect(body.error).toContain('Слишком много запросов');
    expect(chat).toHaveBeenCalledTimes(5);
  });

  it('глобальный fuse сработал → 429 без создания новых IP-окон (спуфинг XFF не надувает Map)', async () => {
    chat.mockResolvedValue('готовый пост');
    let ok = 0;
    let limited = 0;
    // 45 уникальных XFF при глобальном лимите 40: первые 40 проходят, дальше 429.
    for (let i = 1; i <= 45; i++) {
      const res = await POST(
        new NextRequest('http://127.0.0.1:3000/api/style/rewrite', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}` },
          body: JSON.stringify({ text: `текст ${i}` }),
        }),
      );
      if (res.status === 200) ok += 1;
      else if (res.status === 429) limited += 1;
    }
    expect(ok).toBe(40);
    expect(limited).toBe(5);
    // Окна создают только 41 IP (40 успешных + 1 на первом 429 до второго инкремента).
    const g = globalThis as unknown as {
      __styleRewriteRate?: { ips: Map<string, unknown> };
    };
    expect(g.__styleRewriteRate?.ips.size).toBe(41);
  });

  it('успех → 200 {ok,post}, no-store; дефолты mode/format ушли в user-промпт; cloud-first', async () => {
    chat.mockResolvedValue('Ну всё, привет, платная доставка.\n\nПонимаю.');
    const res = await POST(req({ text: 'С понедельника парковка станет платной — 150 рублей в день.' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as { ok: boolean; post: string; provider: string };
    expect(body.ok).toBe(true);
    expect(body.post).toContain('Понимаю.');
    // Наружу идут только пост + фактически использованный провайдер.
    expect(Object.keys(body).sort()).toEqual(['ok', 'post', 'provider']);
    expect(body.provider).toBe('cloud');

    // Контекст вызова LLM: system-промпт стиля + user с режимом/форматом/текстом.
    expect(chat).toHaveBeenCalledTimes(1);
    const [messages, params] = chat.mock.calls[0] as unknown as [
      Array<{ role: string; content: string }>,
      { temperature: number; maxTokens: number },
    ];
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('РЕРАЙТЕР-СТИЛИЗАТОР');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('ПО-СВОЙСКИ');
    expect(messages[1]!.content).toContain('АВТО');
    expect(messages[1]!.content).toContain('парковка станет платной');
    expect(params.temperature).toBe(0.8);
    expect(params.maxTokens).toBe(1500);

    // Выбор LLM серверный: дефолт cloud, поле llm отсутствует → cloud.
    expect(pickLlmClient).toHaveBeenCalledWith('cloud');
  });

  it('llm:"local" → локальный клиент, provider в ответе', async () => {
    chat.mockResolvedValue('Ну что, спишь?\n\nПонимаю.');
    const res = await POST(req({ text: 'текст', llm: 'local' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; provider: string };
    expect(body.provider).toBe('local');
    expect(pickLlmClient).toHaveBeenCalledWith('local');
  });

  it('llm:"local", но local не настроен → 503 с подсказкой про env, до вызова модели', async () => {
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

  it('неверный llm → 400 (enum zod)', async () => {
    const res = await POST(req({ text: 'привет', llm: 'quantum' }));
    expect(res.status).toBe(400);
    expect(chat).not.toHaveBeenCalled();
  });

  it('подпись и жёсткий режим доходят до user-промпта', async () => {
    chat.mockResolvedValue('пост');
    await POST(req({ text: 'текст', mode: 'hard', format: 'guide', signature: true }));
    const [messages] = chat.mock.calls[0] as unknown as [Array<{ role: string; content: string }>];
    expect(messages[1]!.content).toContain('ЖЁСТКО');
    expect(messages[1]!.content).toContain('ИНСТРУКЦИЯ');
    expect(messages[1]!.content).toContain('быть добру');
  });

  it('пустой ответ модели → 502, человекочитаемый', async () => {
    chat.mockResolvedValue('   ');
    const res = await POST(req({ text: 'текст' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('пустой результат');
  });

  it('LLM упал (fetch failed) → 502 человекочитаемый, без URL/Bearer/ключей', async () => {
    chat.mockRejectedValue(
      new Error('fetch failed: https://api.deepseek.com/chat/completions Bearer sk-secret123'),
    );
    const res = await POST(req({ text: 'текст' }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Стилизатор временно недоступен');
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
});
