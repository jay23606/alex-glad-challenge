// Unit: Route Handler /api/notifications — список (GET) + отметка прочитанным (POST).
// Auth реальный; db (getNotificationDb/withDb) замокан как граница.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  unreadCount: vi.fn(),
  list: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getNotificationDb: vi.fn(() => ({
    unreadCount: mocks.unreadCount,
    list: mocks.list,
    markAllRead: mocks.markAllRead,
    markRead: mocks.markRead,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/notifications/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.unreadCount.mockReset().mockReturnValue(3);
  mocks.list.mockReset().mockReturnValue([
    {
      id: 1,
      type: 'automation',
      title: 'Автоматизация: успех',
      body: 'Пост создан',
      href: '/automation',
      read: 0,
      created_at: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 2,
      type: 'system',
      title: 'Прочитанное',
      body: 'старое',
      href: null,
      read: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ]);
  mocks.markAllRead.mockReset().mockReturnValue(4);
  mocks.markRead.mockReset().mockReturnValue(true);
});

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function getReq(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, { headers: withAuth ? { cookie: cookie() } : {} });
}

function postReq(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/notifications', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie: cookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/notifications', () => {
  it('без сессии → 401, БД не трогается', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/notifications', false));
    expect(res.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('200: unread-счётчик + список с read:boolean и createdAt', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/notifications'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      unread: 3,
      notifications: [
        {
          id: 1,
          type: 'automation',
          title: 'Автоматизация: успех',
          body: 'Пост создан',
          href: '/automation',
          read: false,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 2,
          type: 'system',
          title: 'Прочитанное',
          body: 'старое',
          href: null,
          read: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(mocks.list).toHaveBeenCalledWith(100, false);
  });

  it('?unread=1 → list(100, true)', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/notifications?unread=1'));
    expect(res.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(100, true);
  });
});

describe('POST /api/notifications', () => {
  it('400: неизвестный action (zod)', async () => {
    const res = await POST(postReq({ action: 'delete' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
    expect(mocks.markAllRead).not.toHaveBeenCalled();
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('markAllRead → 200 {ok}, markAllRead вызван', async () => {
    const res = await POST(postReq({ action: 'markAllRead' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.markAllRead).toHaveBeenCalledTimes(1);
  });

  it('markRead с id → 200, markRead(id)', async () => {
    const res = await POST(postReq({ action: 'markRead', id: 5 }));
    expect(res.status).toBe(200);
    expect(mocks.markRead).toHaveBeenCalledWith(5);
  });

  it('markRead без id → 400 «id обязателен для markRead»', async () => {
    const res = await POST(postReq({ action: 'markRead' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'id обязателен для markRead' });
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it('markRead вернул false (нет такого id) → 400', async () => {
    mocks.markRead.mockReturnValue(false);
    const res = await POST(postReq({ action: 'markRead', id: 999 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'id обязателен для markRead' });
  });
});
