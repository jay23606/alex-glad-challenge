// Unit: Route Handler /api/workspace/items/[id] — PATCH (toggle done/rename) и DELETE.
// Auth реальный; db (getWorkspaceDb/getGamificationDb/withDb) замокан как граница.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  award: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getWorkspaceDb: vi.fn(() => ({ updateItem: mocks.updateItem, deleteItem: mocks.deleteItem })),
  getGamificationDb: vi.fn(() => ({ award: mocks.award })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

type Ctx = { params: Promise<{ id: string }> };

let PATCH: (req: NextRequest, ctx: Ctx) => Promise<Response>;
let DELETE: (req: NextRequest, ctx: Ctx) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ PATCH, DELETE } = await import('../../app/api/workspace/items/[id]/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.updateItem.mockReset().mockReturnValue(true);
  mocks.deleteItem.mockReset().mockReturnValue(true);
  mocks.award.mockReset();
});

function ctx(id: string): Ctx {
  return { params: Promise.resolve({ id }) };
}

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/workspace/items/11', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookie() },
    body: JSON.stringify(body),
  });
}

function deleteReq(withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/workspace/items/11', {
    method: 'DELETE',
    headers: withAuth ? { cookie: cookie() } : {},
  });
}

describe('PATCH /api/workspace/items/[id]', () => {
  it.each(['abc', '0', '-2'])('невалидный id %s → 400, БД не трогается', async (id) => {
    const res = await PATCH(patchReq({ id: 11, done: true }), ctx(id));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid id' });
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });

  it('400: тело без id (zod требует id в patch-схеме)', async () => {
    const res = await PATCH(patchReq({ done: true }), ctx('11'));
    expect(res.status).toBe(400);
    expect(mocks.updateItem).not.toHaveBeenCalled();
  });

  it('200: id из тела вырезается, в updateItem уходит чистый patch', async () => {
    const res = await PATCH(patchReq({ id: 11, title: 'Новое имя' }), ctx('11'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.updateItem).toHaveBeenCalledWith(11, { title: 'Новое имя' });
    expect(mocks.award).not.toHaveBeenCalled();
  });

  it('done:true → award("todo_completed"); done:false → без award', async () => {
    const res = await PATCH(patchReq({ id: 11, done: true }), ctx('11'));
    expect(res.status).toBe(200);
    expect(mocks.updateItem).toHaveBeenCalledWith(11, { done: true });
    expect(mocks.award).toHaveBeenCalledWith('todo_completed', '11');

    mocks.award.mockClear();
    const res2 = await PATCH(patchReq({ id: 11, done: false }), ctx('11'));
    expect(res2.status).toBe(200);
    expect(mocks.award).not.toHaveBeenCalled();
  });

  it('404: элемент не найден (updateItem → false), award не начисляется', async () => {
    mocks.updateItem.mockReturnValue(false);
    const res = await PATCH(patchReq({ id: 11, done: true }), ctx('11'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'item not found' });
    expect(mocks.award).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/workspace/items/[id]', () => {
  it('без сессии → 401', async () => {
    const res = await DELETE(deleteReq(false), ctx('11'));
    expect(res.status).toBe(401);
    expect(mocks.deleteItem).not.toHaveBeenCalled();
  });

  it('невалидный id → 400', async () => {
    const res = await DELETE(deleteReq(), ctx('nope'));
    expect(res.status).toBe(400);
    expect(mocks.deleteItem).not.toHaveBeenCalled();
  });

  it('200: deleteItem(id) → ok', async () => {
    const res = await DELETE(deleteReq(), ctx('11'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteItem).toHaveBeenCalledWith(11);
  });

  it('404: элемент не найден (deleteItem → false)', async () => {
    mocks.deleteItem.mockReturnValue(false);
    const res = await DELETE(deleteReq(), ctx('11'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'item not found' });
  });
});
