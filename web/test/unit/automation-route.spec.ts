// Unit: Route Handler /api/automation — правила (GET) + configure/run (POST).
// Auth реальный; границы замоканы: automation-service (getAutomation) и db.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  listBlogs: vi.fn(),
  listRules: vi.fn(),
  listRuns: vi.fn(),
  upsertRule: vi.fn(),
  runNow: vi.fn(),
  award: vi.fn(),
  notifyAdd: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({ listBlogs: mocks.listBlogs })),
  getGamificationDb: vi.fn(() => ({ award: mocks.award })),
  getNotificationDb: vi.fn(() => ({ add: mocks.notifyAdd })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/automation-service', () => ({
  getAutomation: vi.fn(() => ({
    listRules: mocks.listRules,
    listRuns: mocks.listRuns,
    upsertRule: mocks.upsertRule,
    runNow: mocks.runNow,
  })),
}));

let GET: (req: NextRequest) => Promise<Response>;
let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET, POST } = await import('../../app/api/automation/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.listBlogs.mockReset().mockReturnValue([{ id: 1, slug: 'main', name: 'Главный', style_preset: 'antonov' }]);
  mocks.listRules.mockReset().mockReturnValue([
    {
      blog_id: 1,
      enabled: 1,
      interval_minutes: 60,
      auto_publish: 1,
      last_run_at: '2026-01-01T00:00:00.000Z',
      next_run_at: '2026-01-01T01:00:00.000Z',
    },
    {
      blog_id: 99,
      enabled: 0,
      interval_minutes: 120,
      auto_publish: 0,
      last_run_at: null,
      next_run_at: null,
    },
  ]);
  mocks.listRuns.mockReset().mockReturnValue([
    {
      id: 5,
      blog_id: 1,
      status: 'success',
      message: 'Пост создан',
      post_id: 12,
      started_at: '2026-01-01T00:00:00.000Z',
      finished_at: '2026-01-01T00:01:00.000Z',
    },
  ]);
  mocks.upsertRule.mockReset();
  mocks.runNow.mockReset().mockResolvedValue({ status: 'success', message: 'Пост создан' });
  mocks.award.mockReset();
  mocks.notifyAdd.mockReset();
});

function cookie(): string {
  return `admin_session=${createSessionValue()}`;
}

function getReq(withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/automation', {
    headers: withAuth ? { cookie: cookie() } : {},
  });
}

function postReq(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/automation', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withAuth ? { cookie: cookie() } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/automation', () => {
  it('без сессии → 401', async () => {
    const res = await GET(getReq(false));
    expect(res.status).toBe(401);
    expect(mocks.listRules).not.toHaveBeenCalled();
  });

  it('200: правила snake→camel с именем блога (fallback #id), прогоны маппятся', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      rules: [
        {
          blogId: 1,
          blogSlug: 'main',
          blogName: 'Главный',
          stylePreset: 'antonov',
          enabled: true,
          intervalMinutes: 60,
          autoPublish: true,
          lastRunAt: '2026-01-01T00:00:00.000Z',
          nextRunAt: '2026-01-01T01:00:00.000Z',
        },
        {
          blogId: 99,
          blogSlug: null,
          blogName: '#99',
          stylePreset: 'default',
          enabled: false,
          intervalMinutes: 120,
          autoPublish: false,
          lastRunAt: null,
          nextRunAt: null,
        },
      ],
      runs: [
        {
          id: 5,
          blogId: 1,
          status: 'success',
          message: 'Пост создан',
          postId: 12,
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
    });
  });
});

describe('POST /api/automation', () => {
  it('configure → upsertRule(blogId, {enabled, intervalMinutes, autoPublish}), 200', async () => {
    const res = await POST(
      postReq({ action: 'configure', blogId: 1, enabled: true, intervalMinutes: 60, autoPublish: true }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.upsertRule).toHaveBeenCalledWith(1, {
      enabled: true,
      intervalMinutes: 60,
      autoPublish: true,
    });
  });

  it('configure: ошибка домена (upsertRule бросает) → 400 safeMessage', async () => {
    mocks.upsertRule.mockImplementation(() => {
      throw new Error('Блог 42 не найден');
    });
    const res = await POST(postReq({ action: 'configure', blogId: 42 }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Блог 42 не найден' });
  });

  it('400: тело не подходит ни под configure, ни под run (intervalMinutes < 5)', async () => {
    const res = await POST(postReq({ action: 'configure', blogId: 1, intervalMinutes: 1 }));
    expect(res.status).toBe(400);
    expect(mocks.upsertRule).not.toHaveBeenCalled();
    expect(mocks.runNow).not.toHaveBeenCalled();
  });

  it('400: неизвестный action', async () => {
    const res = await POST(postReq({ action: 'delete', blogId: 1 }));
    expect(res.status).toBe(400);
    expect(mocks.runNow).not.toHaveBeenCalled();
  });

  it('run → 200 со статусом прогона; award + уведомление «успех»', async () => {
    const res = await POST(postReq({ action: 'run', blogId: 1 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, status: 'success', message: 'Пост создан' });

    expect(mocks.runNow).toHaveBeenCalledWith(1);
    expect(mocks.award).toHaveBeenCalledWith('automation_run', '1');
    expect(mocks.notifyAdd).toHaveBeenCalledWith({
      type: 'automation',
      title: 'Автоматизация: успех',
      body: 'Пост создан',
      href: '/automation',
    });
  });

  it('run со status=error → всё равно 200, уведомление «ошибка»', async () => {
    mocks.runNow.mockResolvedValue({ status: 'error', message: 'LLM упал' });
    const res = await POST(postReq({ action: 'run', blogId: 1 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'error', message: 'LLM упал' });
    expect(mocks.notifyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Автоматизация: ошибка' }),
    );
  });

  it('run: runNow бросает → 500 safeMessage', async () => {
    mocks.runNow.mockRejectedValue(new Error('fatal: https://internal.host/x'));
    const res = await POST(postReq({ action: 'run', blogId: 1 }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/https?:\/\//);
  });
});
