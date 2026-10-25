// Unit: POST /api/blogs/[slug]/posts — ручной/праздничный пост по теме.
// Auth реальный; границы замоканы: db, chokepoint (writer/profile/clean), llm,
// tg-publish. Проверяем контракт 201/400/401/404/502 и запись вариантов.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  recentPosts: vi.fn(),
  insertPost: vi.fn(),
  writeMany: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({
    getBlogBySlug: mocks.getBlogBySlug,
    recentPosts: mocks.recentPosts,
    insertPost: mocks.insertPost,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  clean: vi.fn((s: string) => s.trim()),
  dataPath: vi.fn((p: string) => p),
  ProfileManager: class {
    load = vi.fn();
  },
  TopicPostWriter: class {
    writeMany = mocks.writeMany;
  },
}));

vi.mock('../../lib/server/llm', () => ({
  pickLlmClient: vi.fn(() => ({})),
}));

vi.mock('../../lib/server/tg-publish', () => ({
  publishToTelegram: mocks.publish,
}));

let POST: (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ POST } = await import('../../app/api/blogs/[slug]/posts/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

const BLOG = {
  id: 7,
  slug: 'nevsky-hram',
  name: 'Невский храм',
  profile: null,
  tg_chat_id: '-100777',
  style_preset: 'default',
  system_prompt: 'Пиши тепло.',
  context_prompt: null,
};

beforeEach(() => {
  mocks.getBlogBySlug.mockReset().mockReturnValue(BLOG);
  mocks.recentPosts.mockReset().mockReturnValue([]);
  let nextId = 100;
  mocks.insertPost.mockReset().mockImplementation(() => nextId++);
  mocks.writeMany.mockReset().mockResolvedValue([
    { content: 'Невский храм: вариант 1', variant: 0, angle: 'тёплый человеческий' },
    { content: 'Невский храм: вариант 2', variant: 1, angle: 'короткий факт' },
  ]);
  mocks.publish.mockReset().mockResolvedValue({ ok: true, messageId: 42 });
});

function req(body: unknown, auth = true): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.cookie = `admin_session=${createSessionValue()}`;
  return new NextRequest('http://127.0.0.1:3000/api/blogs/nevsky-hram/posts', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function ctx(slug = 'nevsky-hram') {
  return { params: Promise.resolve({ slug }) };
}

describe('POST /api/blogs/[slug]/posts', () => {
  it('без auth → 401', async () => {
    const res = await POST(req({ topic: 'Рождество' }, false), ctx());
    expect(res.status).toBe(401);
    expect(mocks.writeMany).not.toHaveBeenCalled();
  });

  it('короткая тема → 400', async () => {
    const res = await POST(req({ topic: 'ok' }), ctx());
    expect(res.status).toBe(400);
    expect(mocks.writeMany).not.toHaveBeenCalled();
  });

  it('неизвестный блог → 404', async () => {
    mocks.getBlogBySlug.mockReturnValue(null);
    const res = await POST(req({ topic: 'Рождество' }), ctx('ghost'));
    expect(res.status).toBe(404);
  });

  it('создаёт варианты черновиками (201), без публикации', async () => {
    const res = await POST(req({ topic: 'Рождество', variants: 2 }), ctx());
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      posts: Array<{ id: number; variant: number }>;
      published: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.posts).toEqual([
      { id: 100, variant: 0, angle: 'тёплый человеческий', content: 'Невский храм: вариант 1' },
      { id: 101, variant: 1, angle: 'короткий факт', content: 'Невский храм: вариант 2' },
    ]);
    expect(body.published).toBeNull();
    expect(mocks.insertPost).toHaveBeenNthCalledWith(
      1,
      'Невский храм: вариант 1',
      null,
      expect.any(String),
      7,
      'Рождество',
      0,
    );
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('publishNow → публикует первый вариант в канал блога', async () => {
    const res = await POST(req({ topic: 'Рождество', variants: 2, publishNow: true }), ctx());
    expect(res.status).toBe(201);
    expect(mocks.publish).toHaveBeenCalledWith(
      'Невский храм: вариант 1',
      'blog',
      100,
      'HTML',
      '-100777',
    );
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      published: { ok: true, messageId: 42 },
    });
  });

  it('ошибка генерации → 502 без утечки стека', async () => {
    mocks.writeMany.mockRejectedValue(new Error('LLM unavailable'));
    const res = await POST(req({ topic: 'Рождество' }), ctx());
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: 'LLM unavailable' });
    expect(mocks.insertPost).not.toHaveBeenCalled();
  });
});
