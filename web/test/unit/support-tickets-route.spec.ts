// Unit: Route Handler /api/support/tickets — список (GET) и создание (POST).
// Auth реальный; db (getSupportDb/getGamificationDb/withDb) замокан как граница.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  listTickets: vi.fn(),
  createTicket: vi.fn(),
  award: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getSupportDb: vi.fn(() => ({ listTickets: mocks.listTickets, createTicket: mocks.createTicket })),
  getGamificationDb: vi.fn(() => ({ award: mocks.award })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/support/tickets/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.listTickets.mockReset().mockReturnValue([
    {
      id: 3,
      subject: 'Не работает синк',
      body: 'Календарь не пушится',
      contact: '@owner',
      status: 'open',
      created_at: '2026-01-02T00:00:00.000Z',
    },
  ]);
  mocks.createTicket.mockReset().mockReturnValue(42);
  mocks.award.mockReset();
});

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function getReq(withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/support/tickets', {
    headers: withAuth ? { cookie: cookie() } : {},
  });
}

function postReq(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/support/tickets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie: cookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/support/tickets', () => {
  it('без сессии → 401', async () => {
    const res = await GET(getReq(false));
    expect(res.status).toBe(401);
    expect(mocks.listTickets).not.toHaveBeenCalled();
  });

  it('200: тикеты с createdAt (snake→camel)', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      tickets: [
        {
          id: 3,
          subject: 'Не работает синк',
          body: 'Календарь не пушится',
          contact: '@owner',
          status: 'open',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    expect(mocks.listTickets).toHaveBeenCalledWith(50);
  });
});

describe('POST /api/support/tickets', () => {
  it('400: пустая тема (zod)', async () => {
    const res = await POST(postReq({ subject: '  ', body: 'Описание' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Тема обязательна' });
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });

  it('400: нет тела обращения (zod)', async () => {
    const res = await POST(postReq({ subject: 'Тема', body: '' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Опишите проблему' });
  });

  it('201 {id}: тикет создан, award("support_ticket") начислен', async () => {
    const res = await POST(
      postReq({ subject: 'Тема', body: 'Описание проблемы', contact: '@owner' }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, id: 42 });
    expect(mocks.createTicket).toHaveBeenCalledWith('Тема', 'Описание проблемы', '@owner');
    expect(mocks.award).toHaveBeenCalledWith('support_ticket', '42');
  });

  it('400: createTicket бросает → safeMessage без URL', async () => {
    mocks.createTicket.mockImplementation(() => {
      throw new Error('db locked at https://x.y/z');
    });
    const res = await POST(postReq({ subject: 'Тема', body: 'Описание' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/https?:\/\//);
    expect(mocks.award).not.toHaveBeenCalled();
  });
});
