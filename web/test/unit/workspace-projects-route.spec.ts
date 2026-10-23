// Unit: Route Handler /api/workspace/projects — список (GET) и создание (POST).
// Auth реальный; db (getWorkspaceDb/withDb) замокан как граница.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getWorkspaceDb: vi.fn(() => ({
    listProjects: mocks.listProjects,
    createProject: mocks.createProject,
  })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/workspace/projects/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.listProjects.mockReset().mockReturnValue([
    {
      id: 1,
      name: 'Артель',
      description: 'Основной',
      color: '#ff0000',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
  ]);
  mocks.createProject.mockReset().mockReturnValue(7);
});

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function getReq(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, { headers: withAuth ? { cookie: cookie() } : {} });
}

function postReq(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/workspace/projects', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie: cookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/workspace/projects', () => {
  it('без сессии → 401', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/workspace/projects', false));
    expect(res.status).toBe(401);
    expect(mocks.listProjects).not.toHaveBeenCalled();
  });

  it('200: проекты с createdAt/updatedAt; без status → listProjects(undefined)', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/workspace/projects'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      projects: [
        {
          id: 1,
          name: 'Артель',
          description: 'Основной',
          color: '#ff0000',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    expect(mocks.listProjects).toHaveBeenCalledWith(undefined);
  });

  it('?status=archived пробрасывается в listProjects', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/workspace/projects?status=archived'));
    expect(res.status).toBe(200);
    expect(mocks.listProjects).toHaveBeenCalledWith('archived');
  });
});

describe('POST /api/workspace/projects', () => {
  it('400: пустое название (zod)', async () => {
    const res = await POST(postReq({ name: '  ' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Название обязательно' });
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('201 {id}: createProject получает тело как есть', async () => {
    const res = await POST(postReq({ name: 'Новый', description: 'Описание', color: '#00ff00' }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, id: 7 });
    expect(mocks.createProject).toHaveBeenCalledWith({
      name: 'Новый',
      description: 'Описание',
      color: '#00ff00',
    });
  });

  it('400: createProject бросает → safeMessage', async () => {
    mocks.createProject.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed');
    });
    const res = await POST(postReq({ name: 'Дубль' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'UNIQUE constraint failed' });
  });
});
