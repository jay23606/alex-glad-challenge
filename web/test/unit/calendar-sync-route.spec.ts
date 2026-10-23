// Unit: Route Handler POST /api/calendar/sync — пуш событий в Google Calendar.
// Доменный контракт: без GOOGLE_CALENDAR_* → 503 (не hard-fail, .ics остаётся).
// Границы замоканы: chokepoint (GoogleCalendarClient/getGoogleCalendarConfig),
// calendar-events, db. Сам route не мокается.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  getGoogleCalendarConfig: vi.fn(),
  insertEvent: vi.fn(),
  collectCalendarEvents: vi.fn(),
  GoogleCalendarClient: vi.fn(),
}));

vi.mock('../../lib/server/challenge', () => ({
  getGoogleCalendarConfig: mocks.getGoogleCalendarConfig,
  GoogleCalendarClient: mocks.GoogleCalendarClient,
}));

vi.mock('../../lib/server/calendar-events', () => ({
  collectCalendarEvents: mocks.collectCalendarEvents,
}));

vi.mock('../../lib/server/db', () => ({
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ POST } = await import('../../app/api/calendar/sync/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

const EVENTS = [
  { uid: 'workspace-1', title: 'Релиз', description: '', start: 's1', end: 'e1', href: '/projects' },
  { uid: 'todo-3', title: 'Позвонить', description: '', start: 's2', end: 'e2', href: '/mcp/todos' },
];

const CONFIG = { clientId: 'id', clientSecret: 'secret', refreshToken: 'rt', calendarId: 'primary' };

beforeEach(() => {
  mocks.getGoogleCalendarConfig.mockReset().mockReturnValue(CONFIG);
  mocks.insertEvent.mockReset().mockResolvedValue(undefined);
  // new GoogleCalendarClient(...): mockImplementation обязан быть function,
  // не стрелкой — стрелки не являются конструкторами.
  mocks.GoogleCalendarClient.mockReset().mockImplementation(function () {
    return { insertEvent: mocks.insertEvent };
  });
  mocks.collectCalendarEvents.mockReset().mockReturnValue(EVENTS);
});

function req(withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/calendar/sync', {
    method: 'POST',
    headers: withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {},
  });
}

describe('POST /api/calendar/sync', () => {
  it('без сессии → 401, конфиг не читается', async () => {
    const res = await POST(req(false));
    expect(res.status).toBe(401);
    expect(mocks.getGoogleCalendarConfig).not.toHaveBeenCalled();
  });

  it('503: Google Calendar не настроен (config null) — без обращения к API', async () => {
    mocks.getGoogleCalendarConfig.mockReturnValue(null);
    const res = await POST(req());
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Google Calendar не настроен (см. .env GOOGLE_CALENDAR_*)',
    });
    expect(mocks.collectCalendarEvents).not.toHaveBeenCalled();
    expect(mocks.insertEvent).not.toHaveBeenCalled();
  });

  it('200 {synced}: каждое событие уходит в insertEvent, клиент создан с конфигом', async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, synced: 2 });

    expect(mocks.GoogleCalendarClient).toHaveBeenCalledWith({ config: CONFIG });
    expect(mocks.insertEvent).toHaveBeenCalledTimes(2);
    expect(mocks.insertEvent).toHaveBeenNthCalledWith(1, EVENTS[0]);
    expect(mocks.insertEvent).toHaveBeenNthCalledWith(2, EVENTS[1]);
  });

  it('502: ошибка Google API проходит через safeMessage (без URL/ключей)', async () => {
    mocks.insertEvent.mockRejectedValue(
      new Error('POST https://www.googleapis.com/calendar/v3 failed, key sk-1234567890abcdef'),
    );
    const res = await POST(req());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/https?:\/\//);
    expect(body.error).not.toContain('sk-1234567890abcdef');
  });
});
