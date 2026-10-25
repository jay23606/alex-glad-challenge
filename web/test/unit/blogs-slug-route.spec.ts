// Unit: Route Handler PATCH /api/blogs/[slug] — второй auth-слой (requireApiAuth):
// cookie-сессия ИЛИ мобильный Bearer-токен (стиль пресета ставится с телефона).
// db (getBlogDb/withDb) и chokepoint (ProfileManager/dataPath) мокаются как
// граница; auth — реальный (HMAC-cookie и MOBILE_API_TOKEN на тестовых env).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';
process.env.MOBILE_API_TOKEN = 'test-mobile-token';

const MOBILE_TOKEN = 'test-mobile-token';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  updateBlog: vi.fn(),
  listProfiles: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({ getBlogBySlug: mocks.getBlogBySlug, updateBlog: mocks.updateBlog })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  ProfileManager: class {
    list = mocks.listProfiles;
  },
  dataPath: vi.fn((p: string) => p),
}));

let PATCH: (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
let createSessionValue: () => string;

// Динамический импорт обязателен: vi.mock выше должен примениться ДО оценки
// route-модуля (канонический паттерн route-тестов, AGENTS §9.4).
beforeAll(async () => {
  ({ PATCH } = await import('../../app/api/blogs/[slug]/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.getBlogBySlug.mockReset();
  mocks.updateBlog.mockReset();
  mocks.listProfiles.mockReset();
  // Дефолт: блог найден, updateBlog «сохраняет» — getBlogBySlug отдаёт патченный блог.
  const blog = { id: 1, slug: 'main', name: 'Главный', style_preset: 'default' };
  mocks.getBlogBySlug.mockImplementation(() => blog);
  mocks.updateBlog.mockImplementation((_id: number, patch: Record<string, unknown>) => {
    Object.assign(blog, patch);
  });
});

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

type Ctx = { params: Promise<{ slug: string }> };

function ctx(slug: string): Ctx {
  return { params: Promise.resolve({ slug }) };
}

function patchReq(
  body: unknown,
  auth: { bearer?: boolean; cookie?: boolean } = { bearer: true },
  slug = 'main',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.bearer) headers.authorization = `Bearer ${MOBILE_TOKEN}`;
  if (auth.cookie) headers.cookie = cookie();
  return new NextRequest(`http://127.0.0.1:3000/api/blogs/${slug}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/blogs/[slug] — auth', () => {
  it('без auth (нет cookie и Bearer) → 401, БД не трогается', async () => {
    const res = await PATCH(patchReq({ stylePreset: 'antonov' }, {}), ctx('main'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
    expect(mocks.updateBlog).not.toHaveBeenCalled();
  });

  it('чужой Bearer-токен → 401', async () => {
    const req = new NextRequest('http://127.0.0.1:3000/api/blogs/main', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ stylePreset: 'antonov' }),
    });
    const res = await PATCH(req, ctx('main'));
    expect(res.status).toBe(401);
    expect(mocks.updateBlog).not.toHaveBeenCalled();
  });

  it('мобильный Bearer-токен принят → 200, style_preset патчится', async () => {
    const res = await PATCH(patchReq({ stylePreset: 'antonov' }), ctx('main'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(mocks.updateBlog).toHaveBeenCalledWith(1, { style_preset: 'antonov' });
  });

  it('cookie-сессия по-прежнему принимается (второй слой не ослаблен)', async () => {
    const res = await PATCH(patchReq({ stylePreset: 'default' }, { cookie: true }), ctx('main'));
    expect(res.status).toBe(200);
    expect(mocks.updateBlog).toHaveBeenCalledWith(1, { style_preset: 'default' });
  });
});

describe('PATCH /api/blogs/[slug] — контракт', () => {
  it('невалидный stylePreset (не enum) → 400, БД не трогается', async () => {
    const res = await PATCH(patchReq({ stylePreset: 'nope' }), ctx('main'));
    expect(res.status).toBe(400);
    expect(mocks.updateBlog).not.toHaveBeenCalled();
  });

  it('неизвестный slug → 404', async () => {
    mocks.getBlogBySlug.mockReturnValue(null);
    const res = await PATCH(patchReq({ stylePreset: 'antonov' }), ctx('ghost'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'not found' });
  });

  it('несуществующий профиль голоса → 400 человекочитаемый', async () => {
    mocks.listProfiles.mockReturnValue([]);
    const res = await PATCH(patchReq({ profile: 'ghost-voice' }), ctx('main'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Профиль «ghost-voice» не найден — создайте его в /chat' });
  });

  it('sources: [] → sources=null в БД (сброс на дефолтные фиды)', async () => {
    const res = await PATCH(patchReq({ sources: [] }), ctx('main'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(mocks.updateBlog).toHaveBeenCalledWith(1, { sources: null });
  });

  it('sources: [http-url] → JSON-строка массива в БД', async () => {
    const res = await PATCH(patchReq({ sources: ['https://a.example/rss'] }), ctx('main'));
    expect(res.status).toBe(200);
    expect(mocks.updateBlog).toHaveBeenCalledWith(1, {
      sources: JSON.stringify(['https://a.example/rss']),
    });
  });

  it("tgChatId: '' → tg_chat_id=null (очистка привязки чата)", async () => {
    const res = await PATCH(patchReq({ tgChatId: '' }), ctx('main'));
    expect(res.status).toBe(200);
    expect(mocks.updateBlog).toHaveBeenCalledWith(1, { tg_chat_id: null });
  });

  it('пустое тело {} → 200 no-op: updateBlog с пустым патчем', async () => {
    const res = await PATCH(patchReq({}), ctx('main'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(mocks.updateBlog).toHaveBeenCalledTimes(1);
    expect(mocks.updateBlog).toHaveBeenCalledWith(1, {});
  });
});
