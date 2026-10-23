// Unit: Route Handler GET /api/calendar — события из задач/напоминаний (?days=N).
// Auth реальный; границы замоканы: calendar-events (collectCalendarEvents/
// calendarEventShape), db (withDb), env (getGoogleCalendarStatus).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  collectCalendarEvents: vi.fn(),
  calendarEventShape: vi.fn(),
  getGoogleCalendarStatus: vi.fn(),
}));

vi.mock('../../lib/server/calendar-events', () => ({
  collectCalendarEvents: mocks.collectCalendarEvents,
  calendarEventShape: mocks.calendarEventShape,
}));

vi.mock('../../lib/server/db', () => ({
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/env', () => ({
  getGoogleCalendarStatus: mocks.getGoogleCalendarStatus,
}));

let GET: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET } = await import('../../app/api/calendar/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

const RAW_EVENT = {
  uid: 'workspace-1',
  title: 'Релиз',
  description: 'Задача проекта',
  start: '2026-02-01T00:00:00.000Z',
  end: '2026-02-01T01:00:00.000Z',
  href: '/projects',
};

beforeEach(() => {
  mocks.collectCalendarEvents.mockReset().mockReturnValue([RAW_EVENT]);
  mocks.calendarEventShape
    .mockReset()
    .mockImplementation((e: typeof RAW_EVENT) => ({ ...e, source: 'workspace' }));
  mocks.getGoogleCalendarStatus.mockReset().mockReturnValue({ configured: false });
});

function req(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, {
    headers: withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {},
  });
}

describe('GET /api/calendar', () => {
  it('без сессии → 401, события не собираются', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/calendar', false));
    expect(res.status).toBe(401);
    expect(mocks.collectCalendarEvents).not.toHaveBeenCalled();
  });

  it('200: события через calendarEventShape + googleConfigured из env', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/calendar'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      events: [{ ...RAW_EVENT, source: 'workspace' }],
      googleConfigured: false,
    });
    expect(mocks.collectCalendarEvents).toHaveBeenCalledWith(30); // дефолтное окно
  });

  it('googleConfigured: true, когда env сообщает о настроенном OAuth', async () => {
    mocks.getGoogleCalendarStatus.mockReturnValue({ configured: true });
    const res = await GET(req('http://127.0.0.1:3000/api/calendar'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ googleConfigured: true });
  });

  it('days из query передаётся в collectCalendarEvents; потолок 90; мусор → 30', async () => {
    await GET(req('http://127.0.0.1:3000/api/calendar?days=7'));
    expect(mocks.collectCalendarEvents).toHaveBeenLastCalledWith(7);

    await GET(req('http://127.0.0.1:3000/api/calendar?days=500'));
    expect(mocks.collectCalendarEvents).toHaveBeenLastCalledWith(90);

    await GET(req('http://127.0.0.1:3000/api/calendar?days=abc'));
    expect(mocks.collectCalendarEvents).toHaveBeenLastCalledWith(30);
  });
});
