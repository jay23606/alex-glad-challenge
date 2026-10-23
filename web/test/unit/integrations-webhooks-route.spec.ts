// Unit: Route Handler /api/integrations/webhooks — список+доставки (GET), создание (POST).
// Auth реальный; db (getWebhookDb/withDb) замокан как граница.
// Инвариант: secret наружу не утекает — в ответе только hasSecret: boolean.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  listDeliveries: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getWebhookDb: vi.fn(() => ({
    list: mocks.list,
    listDeliveries: mocks.listDeliveries,
    create: mocks.create,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/integrations/webhooks/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.list.mockReset().mockReturnValue([
    {
      id: 1,
      name: 'CI',
      url: 'https://hooks.example.com/ci',
      secret: 's3cr3t-value',
      events: '["post_published","automation_run"]',
      enabled: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 2,
      name: 'Сломанный events',
      url: 'https://hooks.example.com/broken',
      secret: '',
      events: 'не-json',
      enabled: 0,
      created_at: '2026-01-02T00:00:00.000Z',
    },
  ]);
  mocks.listDeliveries.mockReset().mockReturnValue([
    {
      id: 9,
      webhook_id: 1,
      event: 'post_published',
      status: 'ok',
      response_code: 200,
      error: null,
      created_at: '2026-01-03T00:00:00.000Z',
    },
  ]);
  mocks.create.mockReset().mockReturnValue(5);
});

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function getReq(withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/integrations/webhooks', {
    headers: withAuth ? { cookie: cookie() } : {},
  });
}

function postReq(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/integrations/webhooks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie: cookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/integrations/webhooks', () => {
  it('без сессии → 401', async () => {
    const res = await GET(getReq(false));
    expect(res.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('200: webhooks (hasSecret, events из JSON, битый JSON → []) + deliveries; secret не утекает', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      webhooks: [
        {
          id: 1,
          name: 'CI',
          url: 'https://hooks.example.com/ci',
          hasSecret: true,
          events: ['post_published', 'automation_run'],
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          name: 'Сломанный events',
          url: 'https://hooks.example.com/broken',
          hasSecret: false,
          events: [],
          enabled: false,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      deliveries: [
        {
          id: 9,
          webhookId: 1,
          event: 'post_published',
          status: 'ok',
          responseCode: 200,
          error: null,
          createdAt: '2026-01-03T00:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('s3cr3t-value');
  });
});

describe('POST /api/integrations/webhooks', () => {
  it('400: без url (zod)', async () => {
    const res = await POST(postReq({ name: 'CI' }));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('400: событие вне enum', async () => {
    const res = await POST(postReq({ name: 'CI', url: 'https://hooks.example.com', events: ['hack'] }));
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('201 {id}: create получает валидное тело', async () => {
    const res = await POST(
      postReq({ name: 'CI', url: 'https://hooks.example.com/ci', events: ['post_published'] }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, id: 5 });
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'CI',
      url: 'https://hooks.example.com/ci',
      events: ['post_published'],
    });
  });

  it('400: create бросает → safeMessage без секрета', async () => {
    mocks.create.mockImplementation(() => {
      throw new Error('fail Authorization: Bearer topsecret123');
    });
    const res = await POST(postReq({ name: 'CI', url: 'https://hooks.example.com/ci' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain('topsecret123');
  });
});
