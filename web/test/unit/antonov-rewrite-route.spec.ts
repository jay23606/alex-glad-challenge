// Unit: Route Handler POST /api/antonov/rewrite — студия канала (авторизованный
// инструмент владельца, зеркало /api/style/rewrite). Отличия от публичного:
// лимиты 20/60 (не 5/40), zod-кап 15000 (не 2000), вход >6000 → дайджест-режим
// (сжатый пересказ). Промпт-модуль ОБЩИЙ со
// style-роутом (lib/server/style-prompt) — проверяем, что system/user доходят
// как у Антоновайзера. pickLlmClient/env мокаются; server-only застаблен;
// clean() — реальный. Auth-гейт — middleware, юнит-тестом не покрывается.
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
  const mod = await import('../../app/api/antonov/rewrite/route');
  POST = mod.POST;
  const llm = await import('../../lib/server/llm');
  pickLlmClient = vi.mocked(llm.pickLlmClient) as unknown as ReturnType<typeof vi.fn>;
}, 30_000);

beforeEach(() => {
  chat = vi.fn();
  pickLlmClient.mockClear();
  pickLlmClient.mockImplementation(() => ({ chat }) as never);
  // Сброс in-memory rate-limit окон роута между тестами.
  const g = globalThis as unknown as {
    __antonovRewriteRate?: { ips: Map<string, unknown>; total: { count: number; resetAt: number } };
  };
  if (g.__antonovRewriteRate) {
    g.__antonovRewriteRate.ips.clear();
    g.__antonovRewriteRate.total.count = 0;
    g.__antonovRewriteRate.total.resetAt = 0;
  }
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/antonov/rewrite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/antonov/rewrite', () => {
  it('пустой текст (после trim) → 400 zod, до LLM не доходит', async () => {
    const res = await POST(req({ text: '   ' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Введите текст' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('кап хозяина: 15000 символов проходит, 15001 → 400', async () => {
    chat.mockResolvedValue('пост');
    const ok = await POST(req({ text: 'а'.repeat(15000) }));
    expect(ok.status).toBe(200);

    const res = await POST(req({ text: 'а'.repeat(15001) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('максимум 15000 символов');
  });

  it('не-JSON тело → 400', async () => {
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/antonov/rewrite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rate-limit: 21-й запрос с одного IP → 429 с Retry-After (шире публичных 5)', async () => {
    chat.mockResolvedValue('готовый пост');
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
    chat.mockResolvedValue('готовый пост');
    let ok = 0;
    let limited = 0;
    for (let i = 1; i <= 65; i++) {
      const res = await POST(
        new NextRequest('http://127.0.0.1:3000/api/antonov/rewrite', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.1.${i}` },
          body: JSON.stringify({ text: `текст ${i}` }),
        }),
      );
      if (res.status === 200) ok += 1;
      else if (res.status === 429) limited += 1;
    }
    expect(ok).toBe(60);
    expect(limited).toBe(5);
  });

  it('успех → 200 {ok,post}, no-store; ОБЩИЙ с Антоновайзером system-промпт и подача в user', async () => {
    chat.mockResolvedValue('Ну что, спишь?\n\nПонимаю.');
    const res = await POST(req({ text: 'С понедельника парковка станет платной — 150 рублей в день.' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as { ok: boolean; post: string; provider: string };
    expect(body.ok).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['ok', 'post', 'provider']);
    expect(body.provider).toBe('cloud');

    const [messages, params] = chat.mock.calls[0] as unknown as [
      Array<{ role: string; content: string }>,
      { temperature: number; maxTokens: number },
    ];
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('РЕРАЙТЕР-СТИЛИЗАТОР');
    expect(messages[1]!.content).toContain('ПО-СВОЙСКИ');
    expect(messages[1]!.content).toContain('АВТО');
    expect(messages[1]!.content).toContain('парковка станет платной');
    expect(params.temperature).toBe(0.8);
    // 3000: выход по замыслу компактный — вход >6000 идёт в дайджест-режиме
    // (сжатый пересказ до ~4000 зн.), масштабировать под вход не нужно.
    expect(params.maxTokens).toBe(3000);
    expect(pickLlmClient).toHaveBeenCalledWith('cloud');
  });

  it('длинный вход (>6000) → дайджест-инструкция в user-промпте, короткий — без неё', async () => {
    chat.mockResolvedValue('пост');
    await POST(req({ text: 'а'.repeat(6500) }));
    let [messages] = chat.mock.calls[0] as unknown as [Array<{ content: string }>];
    expect(messages[1]!.content).toContain('РЕЖИМ ДАЙДЖЕСТА');
    expect(messages[1]!.content).toContain('~4000 знаков');

    await POST(req({ text: 'а'.repeat(1500) }));
    [messages] = chat.mock.calls[1] as unknown as [Array<{ content: string }>];
    expect(messages[1]!.content).not.toContain('РЕЖИМ ДАЙДЖЕСТА');
  });

  it('подпись и жёсткий режим доходят до user-промпта', async () => {
    chat.mockResolvedValue('пост');
    await POST(req({ text: 'текст', mode: 'hard', format: 'guide', signature: true }));
    const [messages] = chat.mock.calls[0] as unknown as [Array<{ role: string; content: string }>];
    expect(messages[1]!.content).toContain('ЖЁСТКО');
    expect(messages[1]!.content).toContain('ИНСТРУКЦИЯ');
    expect(messages[1]!.content).toContain('быть добру');
  });

  it('llm:"local" → локальный клиент и provider в ответе (общий промпт сохранён)', async () => {
    chat.mockResolvedValue('Ну что, спишь?\n\nПонимаю.');
    const res = await POST(req({ text: 'текст', llm: 'local' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; provider: string };
    expect(body.provider).toBe('local');
    expect(pickLlmClient).toHaveBeenCalledWith('local');
    const [messages, params] = chat.mock.calls[0] as unknown as [
      Array<{ role: string; content: string }>,
      { numCtx?: number },
    ];
    expect(messages[0]!.content).toContain('РЕРАЙТЕР-СТИЛИЗАТОР');
    // Локальной модели явно задаётся num_ctx — иначе дефолт Ollama молча режет
    // длинный вход (15000 знаков + промпт > 4096 токенов). 12288 — рабочий
    // максимум после OOM-инцидента 2026-09-24 (было 32768).
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
});
