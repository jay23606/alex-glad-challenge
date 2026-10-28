// Unit: GET/PUT /api/blogs/[slug]/schedule — контракт расписания.
// Auth реальный (cookie); db и schedule-сервис замоканы как границы.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  getBlogBySlug: vi.fn(),
  list: vi.fn(),
  listRuns: vi.fn(),
  replaceForBlog: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({ getBlogBySlug: mocks.getBlogBySlug })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/blog-schedule-service', () => ({
  getBlogScheduleStore: vi.fn(() => ({
    list: mocks.list,
    listRuns: mocks.listRuns,
    replaceForBlog: mocks.replaceForBlog,
  })),
}));

let GET: (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
let PUT: (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET, PUT } = await import('../../app/api/blogs/[slug]/schedule/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

const BLOG = { id: 7, slug: 'nevsky-hram', name: 'Невский храм' };

beforeEach(() => {
  mocks.getBlogBySlug.mockReset().mockReturnValue(BLOG);
  mocks.list.mockReset().mockReturnValue([
    {
      id: 3,
      blog_id: 7,
      day_of_week: 6,
      time_local: '10:00',
      timezone: 'Europe/Moscow',
      topic: 'Субботняя заметка',
      variants: 1,
      enabled: 1,
      created_at: '2026-10-01 10:00:00',
      updated_at: '2026-10-01 10:00:00',
    },
  ]);
  mocks.listRuns.mockReset().mockReturnValue([
    {
      id: 9,
      schedule_id: 3,
      blog_id: 7,
      slot_key: '7:3:2026-10-24:10:00',
      status: 'success',
      attempts: 1,
      post_id: 55,
      message: 'Создано вариантов: 1',
      started_at: '2026-10-24T07:00:00.000Z',
      finished_at: '2026-10-24T07:00:02.000Z',
    },
    {
      id: 8,
      schedule_id: 3,
      blog_id: 99,
      slot_key: '99:3:2026-10-24:10:00',
      status: 'error',
      attempts: 1,
      post_id: null,
      message: 'чужой блог',
      started_at: '2026-10-24T07:00:00.000Z',
      finished_at: '2026-10-24T07:00:01.000Z',
    },
  ]);
  mocks.replaceForBlog.mockReset().mockImplementation(
    (_blogId: number, entries: Array<Record<string, unknown>>) =>
      entries.map((e, i) => ({
        id: i + 1,
        blog_id: 7,
        day_of_week: e.dayOfWeek,
        time_local: e.timeLocal,
        timezone: e.timezone ?? 'Europe/Moscow',
        topic: e.topic ?? '',
        variants: e.variants ?? 1,
        enabled: e.enabled === false ? 0 : 1,
        created_at: '2026-10-01 10:00:00',
        updated_at: '2026-10-01 10:00:00',
      })),
  );
});

function req(method: string, body?: unknown, auth = true): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.cookie = `admin_session=${createSessionValue()}`;
  return new NextRequest('http://127.0.0.1:3000/api/blogs/nevsky-hram/schedule', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(slug = 'nevsky-hram') {
  return { params: Promise.resolve({ slug }) };
}

describe('/api/blogs/[slug]/schedule', () => {
  it('GET без auth → 401', async () => {
    const res = await GET(req('GET', undefined, false), ctx());
    expect(res.status).toBe(401);
  });

  it('GET неизвестный блог → 404', async () => {
    mocks.getBlogBySlug.mockReturnValue(null);
    const res = await GET(req('GET'), ctx('ghost'));
    expect(res.status).toBe(404);
  });

  it('GET отдаёт слоты и только запуски этого блога', async () => {
    const res = await GET(req('GET'), ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      blog: BLOG,
      schedules: [
        {
          id: 3,
          dayOfWeek: 6,
          timeLocal: '10:00',
          timezone: 'Europe/Moscow',
          topic: 'Субботняя заметка',
          variants: 1,
          enabled: true,
        },
      ],
      runs: [{ id: 9, status: 'success', postId: 55, attempts: 1 }],
    });
  });

  it('PUT невалидное время → 400, без записи', async () => {
    const res = await PUT(
      req('PUT', { entries: [{ dayOfWeek: 6, timeLocal: '9:00' }] }),
      ctx(),
    );
    expect(res.status).toBe(400);
    expect(mocks.replaceForBlog).not.toHaveBeenCalled();
  });

  it('PUT заменяет расписание и возвращает слоты', async () => {
    const entries = [
      { dayOfWeek: 6, timeLocal: '10:00', topic: 'Сб', variants: 2, enabled: true },
      { dayOfWeek: 0, timeLocal: '09:30', timezone: 'Europe/Moscow', enabled: false },
    ];
    const res = await PUT(req('PUT', { entries }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.replaceForBlog).toHaveBeenCalledWith(7, entries);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      schedules: [
        { id: 1, dayOfWeek: 6, timeLocal: '10:00', variants: 2, enabled: true },
        { id: 2, dayOfWeek: 0, timeLocal: '09:30', enabled: false },
      ],
    });
  });

  it('PUT ошибка store → 400 c safe-сообщением', async () => {
    mocks.replaceForBlog.mockImplementation(() => {
      throw new RangeError('invalid timezone: Mars/Olympus');
    });
    const res = await PUT(
      req('PUT', { entries: [{ dayOfWeek: 6, timeLocal: '10:00', timezone: 'Mars/Olympus' }] }),
      ctx(),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid timezone: Mars/Olympus',
    });
  });
});
