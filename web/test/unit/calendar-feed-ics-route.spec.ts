// Unit: Route Handler GET /api/calendar/feed.ics — экспорт событий в ICS (RFC 5545).
// Auth реальный; границы замоканы: chokepoint (buildIcs), calendar-events, db.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  buildIcs: vi.fn(),
  collectCalendarEvents: vi.fn(),
}));

vi.mock('../../lib/server/challenge', () => ({
  buildIcs: mocks.buildIcs,
}));

vi.mock('../../lib/server/calendar-events', () => ({
  collectCalendarEvents: mocks.collectCalendarEvents,
}));

vi.mock('../../lib/server/db', () => ({
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let GET: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET } = await import('../../app/api/calendar/feed.ics/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

const EVENTS = [
  {
    uid: 'todo-3',
    title: 'Позвонить',
    description: 'Напоминание',
    start: '2026-02-01T00:00:00.000Z',
    end: '2026-02-01T01:00:00.000Z',
    href: '/mcp/todos',
  },
];

beforeEach(() => {
  mocks.buildIcs.mockReset().mockReturnValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  mocks.collectCalendarEvents.mockReset().mockReturnValue(EVENTS);
});

function req(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, {
    headers: withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {},
  });
}

describe('GET /api/calendar/feed.ics', () => {
  it('без сессии → 401 (приватный календарь не палим), buildIcs не вызывается', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/calendar/feed.ics', false));
    expect(res.status).toBe(401);
    expect(mocks.buildIcs).not.toHaveBeenCalled();
  });

  it('200: text/calendar, attachment artel-<дата>.ics, no-store, тело из buildIcs', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/calendar/feed.ics'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="artel-\d{4}-\d{2}-\d{2}\.ics"$/,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.text()).resolves.toContain('BEGIN:VCALENDAR');

    // buildIcs получает собранные события и имя календаря «Артель»
    expect(mocks.buildIcs).toHaveBeenCalledWith(EVENTS, 'Артель');
    expect(mocks.collectCalendarEvents).toHaveBeenCalledWith(30); // дефолтное окно
  });

  it('days из query передаётся в collectCalendarEvents; потолок 90', async () => {
    await GET(req('http://127.0.0.1:3000/api/calendar/feed.ics?days=7'));
    expect(mocks.collectCalendarEvents).toHaveBeenLastCalledWith(7);

    await GET(req('http://127.0.0.1:3000/api/calendar/feed.ics?days=365'));
    expect(mocks.collectCalendarEvents).toHaveBeenLastCalledWith(90);
  });
});
