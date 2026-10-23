// Unit: Route Handler /api/workspace/projects/[id] — PATCH (обновить/архивировать)
// и DELETE проекта. Auth реальный; db (getWorkspaceDb/withDb) замокан как граница.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getWorkspaceDb: vi.fn(() => ({
    updateProject: mocks.updateProject,
    deleteProject: mocks.deleteProject,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

type Ctx = { params: Promise<{ id: string }> };

let PATCH: (req: NextRequest, ctx: Ctx) => Promise<Response>;
let DELETE: (req: NextRequest, ctx: Ctx) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ PATCH, DELETE } = await import('../../app/api/workspace/projects/[id]/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.updateProject.mockReset().mockReturnValue(true);
  mocks.deleteProject.mockReset().mockReturnValue(true);
});

function ctx(id: string): Ctx {
  return { params: Promise.resolve({ id }) };
}

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/workspace/projects/3', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookie() },
    body: JSON.stringify(body),
  });
}

function deleteReq(withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/workspace/projects/3', {
    method: 'DELETE',
    headers: withAuth ? { cookie: cookie() } : {},
  });
}

describe('PATCH /api/workspace/projects/[id]', () => {
  it('без сессии → 401', async () => {
    const res = await PATCH(
      new NextRequest('http://127.0.0.1:3000/api/workspace/projects/3', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }),
      ctx('3'),
    );
    expect(res.status).toBe(401);
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-2', '1.5'])('невалидный id %s → 400, БД не трогается', async (id) => {
    const res = await PATCH(patchReq({ name: 'X' }), ctx(id));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid id' });
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('400: невалидное тело (пустое имя)', async () => {
    const res = await PATCH(patchReq({ name: '' }), ctx('3'));
    expect(res.status).toBe(400);
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('200: patch уходит в updateProject(id, data) — включая status=archived', async () => {
    const res = await PATCH(patchReq({ name: 'Архив', status: 'archived' }), ctx('3'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.updateProject).toHaveBeenCalledWith(3, { name: 'Архив', status: 'archived' });
  });

  it('404: проект не найден (updateProject → false)', async () => {
    mocks.updateProject.mockReturnValue(false);
    const res = await PATCH(patchReq({ name: 'X' }), ctx('3'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'project not found' });
  });
});

describe('DELETE /api/workspace/projects/[id]', () => {
  it('без сессии → 401', async () => {
    const res = await DELETE(deleteReq(false), ctx('3'));
    expect(res.status).toBe(401);
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });

  it('невалидный id → 400', async () => {
    const res = await DELETE(deleteReq(), ctx('nope'));
    expect(res.status).toBe(400);
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });

  it('200: deleteProject(id) → ok', async () => {
    const res = await DELETE(deleteReq(), ctx('3'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteProject).toHaveBeenCalledWith(3);
  });

  it('404: проект не найден (deleteProject → false)', async () => {
    mocks.deleteProject.mockReturnValue(false);
    const res = await DELETE(deleteReq(), ctx('3'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'project not found' });
  });
});
