// Unit: Route Handlers /api/course/lessons — список (GET) и урок (GET [slug]).
// Auth реальный; db (getCourseDb/withDb) замокан как граница.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const lessonRow = {
  id: 1,
  slug: 'week-1',
  title: 'Неделя 1',
  kind: 'week',
  weekNo: 1,
  durationMs: 3_600_000,
  summary: 'Резюме',
  why: 'Зачем',
  pain: 'Боль',
  sourceFile: '1.transcript.json',
  createdAt: '2026-01-01 00:00:00',
  updatedAt: '2026-01-01 00:00:00',
};

const mocks = vi.hoisted(() => ({
  listLessons: vi.fn(),
  getLesson: vi.fn(),
  getSections: vi.fn(),
  getExcerpts: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getCourseDb: vi.fn(() => ({
    listLessons: mocks.listLessons,
    getLesson: mocks.getLesson,
    getSections: mocks.getSections,
    getExcerpts: mocks.getExcerpts,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let listGET: (req: NextRequest) => Promise<Response>;
let detailGET: (
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET: listGET } = await import('../../app/api/course/lessons/route'));
  ({ GET: detailGET } = await import('../../app/api/course/lessons/[slug]/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.listLessons.mockReset().mockReturnValue([lessonRow]);
  mocks.getLesson.mockReset().mockReturnValue(lessonRow);
  mocks.getSections.mockReset().mockReturnValue([
    { id: 10, lessonId: 1, idx: 0, startMs: 0, endMs: 1000, text: 'Секция' },
  ]);
  mocks.getExcerpts.mockReset().mockReturnValue([
    { id: 20, lessonId: 1, idx: 0, quote: 'Q', explanation: 'E' },
  ]);
});

function getReq(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, {
    headers: withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {},
  });
}

describe('GET /api/course/lessons', () => {
  it('без сессии → 401', async () => {
    const res = await listGET(getReq('http://127.0.0.1:3000/api/course/lessons', false));
    expect(res.status).toBe(401);
    expect(mocks.listLessons).not.toHaveBeenCalled();
  });

  it('200: camelCase-уроки без секций', async () => {
    const res = await listGET(getReq('http://127.0.0.1:3000/api/course/lessons'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      lessons: [
        {
          slug: 'week-1',
          title: 'Неделя 1',
          kind: 'week',
          weekNo: 1,
          durationMs: 3_600_000,
          summary: 'Резюме',
          why: 'Зачем',
          pain: 'Боль',
        },
      ],
    });
  });
});

describe('GET /api/course/lessons/[slug]', () => {
  const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

  it('без сессии → 401', async () => {
    const res = await detailGET(
      getReq('http://127.0.0.1:3000/api/course/lessons/week-1', false),
      ctx('week-1'),
    );
    expect(res.status).toBe(401);
  });

  it('200: урок + секции + выдержки (camelCase)', async () => {
    const res = await detailGET(
      getReq('http://127.0.0.1:3000/api/course/lessons/week-1'),
      ctx('week-1'),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      lesson: {
        slug: 'week-1',
        title: 'Неделя 1',
        kind: 'week',
        weekNo: 1,
        durationMs: 3_600_000,
        summary: 'Резюме',
        why: 'Зачем',
        pain: 'Боль',
      },
      sections: [{ idx: 0, startMs: 0, endMs: 1000, text: 'Секция' }],
      excerpts: [{ idx: 0, quote: 'Q', explanation: 'E' }],
    });
    expect(mocks.getLesson).toHaveBeenCalledWith('week-1');
  });

  it('404: slug не найден', async () => {
    mocks.getLesson.mockReturnValue(null);
    const res = await detailGET(
      getReq('http://127.0.0.1:3000/api/course/lessons/nope'),
      ctx('nope'),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'урок не найден' });
  });
});
