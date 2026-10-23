// Unit: Route Handler GET /api/gamification — прогресс (XP/уровень) + лента событий.
// Auth реальный (HMAC-cookie на тестовых env, прецедент rag-notes-route.spec.ts);
// db (getGamificationDb/withDb) замокан как граница — сам route не мокается.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  getStats: vi.fn(),
  listAchievements: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getGamificationDb: vi.fn(() => ({
    getStats: mocks.getStats,
    listAchievements: mocks.listAchievements,
    listEvents: mocks.listEvents,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let GET: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET } = await import('../../app/api/gamification/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.getStats.mockReset().mockReturnValue({ xp: 120, level: 3 });
  mocks.listAchievements
    .mockReset()
    .mockReturnValue([{ code: 'first_post', unlocked_at: '2026-01-01T00:00:00.000Z' }]);
  mocks.listEvents.mockReset().mockReturnValue([
    { id: 7, type: 'todo_completed', points: 10, created_at: '2026-01-02T00:00:00.000Z' },
  ]);
});

function req(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, {
    headers: withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {},
  });
}

describe('GET /api/gamification', () => {
  it('без сессии → 401, БД не трогается', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/gamification', false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
    expect(mocks.getStats).not.toHaveBeenCalled();
  });

  it('200: stats/achievements как есть, события с createdAt (snake→camel), no-store', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/gamification'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({
      ok: true,
      stats: { xp: 120, level: 3 },
      achievements: [{ code: 'first_post', unlocked_at: '2026-01-01T00:00:00.000Z' }],
      events: [{ id: 7, type: 'todo_completed', points: 10, createdAt: '2026-01-02T00:00:00.000Z' }],
    });
    // дефолтный лимит ленты
    expect(mocks.listEvents).toHaveBeenCalledWith(30);
  });

  it('limit из query передаётся в listEvents; потолок 100; мусор → дефолт 30', async () => {
    await GET(req('http://127.0.0.1:3000/api/gamification?limit=5'));
    expect(mocks.listEvents).toHaveBeenLastCalledWith(5);

    await GET(req('http://127.0.0.1:3000/api/gamification?limit=500'));
    expect(mocks.listEvents).toHaveBeenLastCalledWith(100);

    await GET(req('http://127.0.0.1:3000/api/gamification?limit=abc'));
    expect(mocks.listEvents).toHaveBeenLastCalledWith(30);
  });
});
