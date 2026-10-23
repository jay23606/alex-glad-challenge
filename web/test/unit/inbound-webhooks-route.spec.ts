// Unit: Route Handlers /api/integrations/inbound — управление входящими хуками
// (GET/POST, session-auth) и приём событий POST /api/integrations/inbound/[id]
// (публичный: HMAC-подпись вместо сессии, rate-limit неудач 30/5 мин — issue #62)
// + DELETE [id].
// db (getInboundHookDb/getNotificationDb/getTodoDb/withDb) мокается по образцу
// rag-notes-route.spec.ts; chokepoint мокается с реальными pure-частями core
// (handleInboundEvent/verifySignature/NotificationService — без сети и файлов).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

interface HookFixture {
  id: number;
  name: string;
  secret: string;
  target: 'notification' | 'todo';
  created_at: string;
}

const HOOK_NOTIFICATION: HookFixture = {
  id: 5,
  name: 'ci',
  secret: 'inbound-secret-5',
  target: 'notification' as const,
  created_at: '2026-01-01 00:00:00',
};
const HOOK_TODO: HookFixture = { ...HOOK_NOTIFICATION, id: 6, name: 'alerts', secret: 'inbound-secret-6', target: 'todo' };

const mocks = vi.hoisted(() => ({
  getHook: vi.fn(),
  listHooks: vi.fn(),
  createHook: vi.fn(),
  deleteHook: vi.fn(),
  notificationAdd: vi.fn(),
  todoAdd: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getInboundHookDb: vi.fn(() => ({
    get: mocks.getHook,
    list: mocks.listHooks,
    create: mocks.createHook,
    delete: mocks.deleteHook,
  })),
  getNotificationDb: vi.fn(() => ({ add: mocks.notificationAdd })),
  getTodoDb: vi.fn(() => ({ addTodo: mocks.todoAdd })),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', async () => {
  const { handleInboundEvent } = await import('@challenge/core/inboundWebhooks');
  const { verifySignature } = await import('@challenge/core/webhooks');
  const { NotificationService } = await import('@challenge/core/notifications');
  return { handleInboundEvent, verifySignature, NotificationService };
});

let POST_RECEIVE: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let DELETE_HOOK: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let GET_LIST: (req: NextRequest) => Promise<Response>;
let POST_CREATE: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;
let signPayload: (secret: string, body: string) => string;

beforeAll(async () => {
  const idRoute = await import('../../app/api/integrations/inbound/[id]/route');
  POST_RECEIVE = idRoute.POST;
  DELETE_HOOK = idRoute.DELETE;
  const listRoute = await import('../../app/api/integrations/inbound/route');
  GET_LIST = listRoute.GET;
  POST_CREATE = listRoute.POST;
  ({ createSessionValue } = await import('../../lib/auth'));
  ({ signPayload } = await import('@challenge/core/webhooks'));
});

beforeEach(() => {
  mocks.getHook.mockReset();
  mocks.listHooks.mockReset();
  mocks.createHook.mockReset();
  mocks.deleteHook.mockReset();
  mocks.notificationAdd.mockReset().mockReturnValue(42);
  mocks.todoAdd.mockReset().mockReturnValue(7);
  Object.assign(failState(), { fails: 0, resetAt: 0 });
});

function cookieValue(): string {
  return `admin_session=${createSessionValue()}`;
}

// Состояние rate-limit роута [id] (globalThis). Мутируем существующий объект —
// роут захватывает ссылку на него при импорте, переприсваивать нельзя.
function failState(): { fails: number; resetAt: number } {
  const g = globalThis as unknown as { __inboundHookFails?: { fails: number; resetAt: number } };
  if (!g.__inboundHookFails) g.__inboundHookFails = { fails: 0, resetAt: 0 };
  return g.__inboundHookFails;
}

function eventReq(
  hookId: number,
  rawBody: string,
  signature: string | null,
): { req: NextRequest; ctx: { params: Promise<{ id: string }> } } {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-artel-signature'] = signature;
  return {
    req: new NextRequest(`http://127.0.0.1:3000/api/integrations/inbound/${hookId}`, {
      method: 'POST',
      headers,
      body: rawBody,
    }),
    ctx: { params: Promise.resolve({ id: String(hookId) }) },
  };
}

function signedReq(hook: typeof HOOK_NOTIFICATION, body: unknown): ReturnType<typeof eventReq> {
  const raw = JSON.stringify(body);
  return eventReq(hook.id, raw, signPayload(hook.secret, raw));
}

describe('POST /api/integrations/inbound/[id] (приём события, HMAC вместо сессии)', () => {
  it('200 без cookie при валидной подписи: target=notification → NotificationService.notify', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = signedReq(HOOK_NOTIFICATION, { title: 'build failed', body: 'tests red' });
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 42 });
    expect(mocks.notificationAdd).toHaveBeenCalledTimes(1);
    const input = mocks.notificationAdd.mock.calls[0]?.[0] as { type: string; title: string; body: string };
    expect(input.type).toBe('system');
    expect(input.title).toBe('ci: build failed');
    expect(input.body).toBe('tests red');
    expect(mocks.todoAdd).not.toHaveBeenCalled();
  });

  it('200 target=todo → TodoDb.addTodo', async () => {
    mocks.getHook.mockReturnValue(HOOK_TODO);
    const { req, ctx } = signedReq(HOOK_TODO, { title: 'диск почти полон' });
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 7 });
    expect(mocks.todoAdd).toHaveBeenCalledWith('[alerts] диск почти полон');
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  it('401 на невалидной подписи и без заголовка; запись не создаётся', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const bad = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    const res1 = await POST_RECEIVE(bad.req, bad.ctx);
    expect(res1.status).toBe(401);
    await expect(res1.json()).resolves.toMatchObject({ error: 'invalid signature' });

    const noSig = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), null);
    const res2 = await POST_RECEIVE(noSig.req, noSig.ctx);
    expect(res2.status).toBe(401);
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  it('404 на неизвестном хуке', async () => {
    mocks.getHook.mockReturnValue(null);
    const { req, ctx } = signedReq(HOOK_NOTIFICATION, { title: 'x' });
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(404);
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  it('400 на невалидном JSON и на теле, не прошедшем zod', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const rawBad = 'not json';
    const badJson = eventReq(HOOK_NOTIFICATION.id, rawBad, signPayload(HOOK_NOTIFICATION.secret, rawBad));
    const res1 = await POST_RECEIVE(badJson.req, badJson.ctx);
    expect(res1.status).toBe(400);

    const badSchema = signedReq(HOOK_NOTIFICATION, { title: '' });
    const res2 = await POST_RECEIVE(badSchema.req, badSchema.ctx);
    expect(res2.status).toBe(400);
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  it('подпись по изменённому телу не проходит (tamper)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const raw = JSON.stringify({ title: 'orig' });
    const sig = signPayload(HOOK_NOTIFICATION.secret, raw);
    const tampered = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'forged' }), sig);
    const res = await POST_RECEIVE(tampered.req, tampered.ctx);
    expect(res.status).toBe(401);
  });
});

describe('/api/integrations/inbound (управление, session-auth)', () => {
  it('GET без куки → 401; с кукой → список БЕЗ секретов', async () => {
    mocks.listHooks.mockReturnValue([HOOK_NOTIFICATION]);
    const denied = await GET_LIST(new NextRequest('http://127.0.0.1:3000/api/integrations/inbound'));
    expect(denied.status).toBe(401);

    const res = await GET_LIST(
      new NextRequest('http://127.0.0.1:3000/api/integrations/inbound', {
        headers: { cookie: cookieValue() },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hooks: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.hooks).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(HOOK_NOTIFICATION.secret);
    expect(body.hooks[0]).toMatchObject({ id: 5, name: 'ci', target: 'notification' });
  });

  it('POST без куки → 401; с кукой → 201, секрет показан один раз в ответе', async () => {
    mocks.createHook.mockReturnValue({ id: 9, secret: 'generated-secret-9' });
    const denied = await POST_CREATE(
      new NextRequest('http://127.0.0.1:3000/api/integrations/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ci', target: 'notification' }),
      }),
    );
    expect(denied.status).toBe(401);

    const res = await POST_CREATE(
      new NextRequest('http://127.0.0.1:3000/api/integrations/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieValue() },
        body: JSON.stringify({ name: 'ci', target: 'notification' }),
      }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      id: 9,
      secret: 'generated-secret-9',
      url: '/api/integrations/inbound/9',
    });
  });

  it('POST с невалидным target → 400 zod', async () => {
    const res = await POST_CREATE(
      new NextRequest('http://127.0.0.1:3000/api/integrations/inbound', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookieValue() },
        body: JSON.stringify({ name: 'ci', target: 'email' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.createHook).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/integrations/inbound/[id]', () => {
  it('без куки → 401; с кукой → 200; несуществующий → 404', async () => {
    const ctx = { params: Promise.resolve({ id: '5' }) };
    const denied = await DELETE_HOOK(
      new NextRequest('http://127.0.0.1:3000/api/integrations/inbound/5', { method: 'DELETE' }),
      ctx,
    );
    expect(denied.status).toBe(401);

    mocks.deleteHook.mockReturnValue(true);
    const res = await DELETE_HOOK(
      new NextRequest('http://127.0.0.1:3000/api/integrations/inbound/5', {
        method: 'DELETE',
        headers: { cookie: cookieValue() },
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(mocks.deleteHook).toHaveBeenCalledWith(5);

    mocks.deleteHook.mockReturnValue(false);
    const missing = await DELETE_HOOK(
      new NextRequest('http://127.0.0.1:3000/api/integrations/inbound/5', {
        method: 'DELETE',
        headers: { cookie: cookieValue() },
      }),
      ctx,
    );
    expect(missing.status).toBe(404);
  });
});

describe('rate-limit POST /api/integrations/inbound/[id] (30 неудач/5 мин, globalThis)', () => {
  it('30 неудачных подписей → 401, 31-я → 429 + Retry-After; 429 не инкрементит', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    for (let i = 0; i < 30; i++) {
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      const res = await POST_RECEIVE(req, ctx);
      expect(res.status).toBe(401);
    }
    expect(failState().fails).toBe(30);

    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('Слишком много') });
    const retryAfter = res.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(300); // окно 5 минут
    expect(failState().fails).toBe(30); // 429 сам счётчик не двигает
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  it('после истечения окна (мок Date.now) счётчик сбрасывается → снова 401, не 429', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      for (let i = 0; i < 30; i++) {
        const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
        await POST_RECEIVE(req, ctx);
      }
      // +5 минут и секунда: окно истекло → fuse отпускает, новая неудача открывает новое окно.
      spy.mockReturnValue(now + 5 * 60 * 1000 + 1000);
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      const res = await POST_RECEIVE(req, ctx);
      expect(res.status).toBe(401);
      expect(failState().fails).toBe(1);
      expect(failState().resetAt).toBeGreaterThan(now + 5 * 60 * 1000);
    } finally {
      spy.mockRestore();
    }
  });

  it('успешная подпись не инкрементит счётчик и сбрасывает окно (паттерн login)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    // 29 неудач — на грани лимита.
    for (let i = 0; i < 29; i++) {
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      await POST_RECEIVE(req, ctx);
    }
    expect(failState().fails).toBe(29);

    const { req, ctx } = signedReq(HOOK_NOTIFICATION, { title: 'ок', body: 'ок' });
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    expect(failState().fails).toBe(0); // успех обнулил окно

    // Следующая неудача — снова 401, а не 429: счётчик начинался с нуля.
    const retry = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    const res2 = await POST_RECEIVE(retry.req, retry.ctx);
    expect(res2.status).toBe(401);
    expect(failState().fails).toBe(1);
  });
});
