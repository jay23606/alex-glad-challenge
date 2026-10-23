// Unit: Route Handler DELETE /api/integrations/webhooks/[id] — удаление подписки.
// Auth реальный; db (getWebhookDb/withDb) замокан как граница.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  deleteWebhook: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getWebhookDb: vi.fn(() => ({ delete: mocks.deleteWebhook })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

type Ctx = { params: Promise<{ id: string }> };

let DELETE: (req: NextRequest, ctx: Ctx) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ DELETE } = await import('../../app/api/integrations/webhooks/[id]/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.deleteWebhook.mockReset().mockReturnValue(true);
});

function ctx(id: string): Ctx {
  return { params: Promise.resolve({ id }) };
}

function req(withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/integrations/webhooks/5', {
    method: 'DELETE',
    headers: withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {},
  });
}

describe('DELETE /api/integrations/webhooks/[id]', () => {
  it('без сессии → 401, БД не трогается', async () => {
    const res = await DELETE(req(false), ctx('5'));
    expect(res.status).toBe(401);
    expect(mocks.deleteWebhook).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '2.5'])('невалидный id %s → 400', async (id) => {
    const res = await DELETE(req(), ctx(id));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid id' });
    expect(mocks.deleteWebhook).not.toHaveBeenCalled();
  });

  it('200: delete(id) → ok', async () => {
    const res = await DELETE(req(), ctx('5'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteWebhook).toHaveBeenCalledWith(5);
  });

  it('404: подписка не найдена (delete → false)', async () => {
    mocks.deleteWebhook.mockReturnValue(false);
    const res = await DELETE(req(), ctx('5'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'webhook not found' });
  });
});
