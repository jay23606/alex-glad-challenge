// Unit: Route Handler /api/workspace/items — список (GET ?projectId/kind/includeDone)
// и создание (POST). Auth реальный; db (getWorkspaceDb/getGamificationDb/withDb) замокан.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  listItems: vi.fn(),
  createItem: vi.fn(),
  award: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getWorkspaceDb: vi.fn(() => ({ listItems: mocks.listItems, createItem: mocks.createItem })),
  getGamificationDb: vi.fn(() => ({ award: mocks.award })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/workspace/items/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.listItems.mockReset().mockReturnValue([
    {
      id: 11,
      project_id: 2,
      folder_id: null,
      kind: 'task',
      title: 'Сделать релиз',
      body: '',
      url: null,
      due_at: '2026-02-01T00:00:00.000Z',
      done: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
  ]);
  mocks.createItem.mockReset().mockReturnValue(11);
  mocks.award.mockReset();
});

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function getReq(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, { headers: withAuth ? { cookie: cookie() } : {} });
}

function postReq(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/workspace/items', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie: cookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/workspace/items', () => {
  it('без сессии → 401', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/workspace/items', false));
    expect(res.status).toBe(401);
    expect(mocks.listItems).not.toHaveBeenCalled();
  });

  it('200: элементы snake→camel с done:boolean; без query → фильтры undefined/false', async () => {
    const res = await GET(getReq('http://127.0.0.1:3000/api/workspace/items'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      items: [
        {
          id: 11,
          projectId: 2,
          folderId: null,
          kind: 'task',
          title: 'Сделать релиз',
          body: '',
          url: null,
          dueAt: '2026-02-01T00:00:00.000Z',
          done: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    expect(mocks.listItems).toHaveBeenCalledWith({
      projectId: undefined,
      kind: undefined,
      includeDone: false,
    });
  });

  it('query projectId/kind/includeDone маппятся в фильтры; нечисловой projectId → undefined', async () => {
    const res = await GET(
      getReq('http://127.0.0.1:3000/api/workspace/items?projectId=2&kind=task&includeDone=1'),
    );
    expect(res.status).toBe(200);
    expect(mocks.listItems).toHaveBeenCalledWith({ projectId: 2, kind: 'task', includeDone: true });

    await GET(getReq('http://127.0.0.1:3000/api/workspace/items?projectId=abc'));
    expect(mocks.listItems).toHaveBeenLastCalledWith({
      projectId: undefined,
      kind: undefined,
      includeDone: false,
    });
  });
});

describe('POST /api/workspace/items', () => {
  it('400: без projectId (zod)', async () => {
    const res = await POST(postReq({ title: 'Задача' }));
    expect(res.status).toBe(400);
    expect(mocks.createItem).not.toHaveBeenCalled();
  });

  it('400: пустой заголовок (zod)', async () => {
    const res = await POST(postReq({ projectId: 2, title: ' ' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Заголовок обязателен' });
  });

  it('201 {id}: createItem получает тело, award("workspace_item") начислен', async () => {
    const res = await POST(
      postReq({ projectId: 2, kind: 'task', title: 'Задача', dueAt: '2026-02-01T00:00:00.000Z' }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, id: 11 });
    expect(mocks.createItem).toHaveBeenCalledWith({
      projectId: 2,
      kind: 'task',
      title: 'Задача',
      dueAt: '2026-02-01T00:00:00.000Z',
    });
    expect(mocks.award).toHaveBeenCalledWith('workspace_item', '11');
  });

  it('400: createItem бросает (нет такого проекта) → safeMessage, award не начисляется', async () => {
    mocks.createItem.mockImplementation(() => {
      throw new Error('Проект 99 не найден');
    });
    const res = await POST(postReq({ projectId: 99, title: 'Задача' }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Проект 99 не найден' });
    expect(mocks.award).not.toHaveBeenCalled();
  });
});
