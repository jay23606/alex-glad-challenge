// Unit: Route Handlers /api/integrations/inbound — управление входящими хуками
// (GET/POST, session-auth) и приём событий POST /api/integrations/inbound/[id]
// (публичный: HMAC-подпись вместо сессии; rate-limit — 30 неудач/хук/5 мин
// + глобальный abuse-guard 200/5 мин, issue #103; опциональный
// x-artel-timestamp ±5 мин, issue #97) + DELETE [id].
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
let signPayload: (secret: string, body: string | Uint8Array) => string;

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
  hookBudgets().clear();
  Object.assign(globalBudget(), { fails: 0, resetAt: 0 });
});

function cookieValue(): string {
  return `admin_session=${createSessionValue()}`;
}

// Состояние rate-limit роута [id] (globalThis): карта per-hook бюджетов + глобальный
// abuse-guard. Роут захватывает ссылки на Map/объект при импорте — переприсваивать
// нельзя, мутируем содержимое.
interface FailBudget {
  fails: number;
  resetAt: number;
}
function hookBudgets(): Map<number, FailBudget> {
  const g = globalThis as unknown as { __inboundHookFails?: Map<number, FailBudget> };
  if (!g.__inboundHookFails) g.__inboundHookFails = new Map();
  return g.__inboundHookFails;
}
function hookBudget(hookId: number): FailBudget {
  const budgets = hookBudgets();
  let budget = budgets.get(hookId);
  if (!budget) {
    budget = { fails: 0, resetAt: 0 };
    budgets.set(hookId, budget);
  }
  return budget;
}
function globalBudget(): FailBudget {
  const g = globalThis as unknown as { __inboundGlobalFails?: FailBudget };
  if (!g.__inboundGlobalFails) g.__inboundGlobalFails = { fails: 0, resetAt: 0 };
  return g.__inboundGlobalFails;
}

function eventReq(
  hookId: number,
  rawBody: string | Uint8Array,
  signature: string | null,
  timestamp?: string | null,
): { req: NextRequest; ctx: { params: Promise<{ id: string }> } } {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-artel-signature'] = signature;
  if (timestamp != null) headers['x-artel-timestamp'] = timestamp;
  return {
    req: new NextRequest(`http://127.0.0.1:3000/api/integrations/inbound/${hookId}`, {
      method: 'POST',
      headers,
      // Копия в собственный ArrayBuffer: BodyInit pin-ит ArrayBuffer-бэкинг,
      // а Buffer может сидеть в пуле со смещением; байты те же.
      body: typeof rawBody === 'string' ? rawBody : new Uint8Array(rawBody).buffer,
    }),
    ctx: { params: Promise.resolve({ id: String(hookId) }) },
  };
}

function signedReq(hook: typeof HOOK_NOTIFICATION, body: unknown): ReturnType<typeof eventReq> {
  const raw = JSON.stringify(body);
  return eventReq(hook.id, raw, signPayload(hook.secret, raw));
}

// Запрос с телом-стримом (pull-продюсер): по одному чанку 40 KiB на pull,
// 3 чанка = 120 KiB, каждый ≤ MAX — срабатывает только кумулятивный счётчик.
// cancelled() = дошла ли отмена чтения до продюсера; pulls() = сколько чанков
// вытянуто (чтобы отличить «чтение остановлено капом» от «стрим вычитан весь»).
function streamedReq(hookId: number): {
  req: NextRequest;
  ctx: { params: Promise<{ id: string }> };
  pulls: () => number;
  cancelled: () => boolean;
} {
  let pulls = 0;
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls <= 3) controller.enqueue(encoder.encode('y'.repeat(40 * 1024)));
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    req: new NextRequest(`http://127.0.0.1:3000/api/integrations/inbound/${hookId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    }),
    ctx: { params: Promise.resolve({ id: String(hookId) }) },
    pulls: () => pulls,
    cancelled: () => cancelled,
  };
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

// #92: edge-cases валидности id. Middleware открывает bypass regex'ом /\d+/, т.е.
// ЛЮБАЯ цифровая строка доходит до роута — гейт валидности обязан быть в роуте и
// срабатывать ДО чтения тела и БД (400, не 404 и не hang). Граница ветки:
// Number(id) должен быть целым > 0. Переполнение до Infinity → 400; конечное, но
// гигантское (1e20 — целое) в 400-ветку не попадает: уходит в БД и отвечает
// 404 «hook not found», как обычный неизвестный id.
describe('POST [id]: граница валидности id (#92)', () => {
  function rawIdReq(id: string): { req: NextRequest; ctx: { params: Promise<{ id: string }> } } {
    return {
      req: new NextRequest(`http://127.0.0.1:3000/api/integrations/inbound/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
      ctx: { params: Promise.resolve({ id }) },
    };
  }

  it('id=0 → 400 «invalid id» до чтения тела и БД (не 404, не hang)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    // Бесконечный продюсер (никогда не enqueue): если бы гейт валидности стоял
    // после чтения тела, хендлер завис бы на этом стриме — тест упал по таймауту.
    const req = new NextRequest('http://127.0.0.1:3000/api/integrations/inbound/0', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream<Uint8Array>({ pull() {} }),
      duplex: 'half',
    });
    const res = await POST_RECEIVE(req, { params: Promise.resolve({ id: '0' }) });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid id' });
    expect(mocks.getHook).not.toHaveBeenCalled(); // не 404-ветка: до БД не дошло
    expect(hookBudget(0).fails).toBe(0); // per-hook бюджет на id=0 не заводится
    expect(globalBudget().fails).toBe(1); // невалидный id — чистый перебор (guard #103)
  });

  it('огромный цифровой id (Number → Infinity) → 400 до чтения тела и БД', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = rawIdReq('9'.repeat(400)); // 400 цифр: Number = Infinity, regex \d+ такой путь пропускает
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid id' });
    expect(mocks.getHook).not.toHaveBeenCalled();
    expect(globalBudget().fails).toBe(1);
  });

  it('граница ветки: конечный огромный id (1e20 — целое) — не 400, а 404 из БД', async () => {
    mocks.getHook.mockReturnValue(null);
    const { req, ctx } = rawIdReq('100000000000000000000'); // Number(...) = 1e20 — integer > 0
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'hook not found' });
    expect(mocks.getHook).toHaveBeenCalledWith(1e20); // дошло до поиска хука
    expect(globalBudget().fails).toBe(1); // неизвестный id — тоже перебор
  });
});

describe('POST [id]: подпись по сырым байтам и обрыв чтения (issue #98)', () => {
  // BOM-префикс: подпись по байтам с EF BB BF. Старый путь (декодирование до
  // HMAC) резал BOM → 401; теперь HMAC считается по байтам до декодирования.
  it('BOM-префикс: подпись по байтам проходит → 200, событие создаётся', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"title":"bom ok"}')]);
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, raw, signPayload(HOOK_NOTIFICATION.secret, raw));
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 42 });
    expect(mocks.notificationAdd).toHaveBeenCalledTimes(1);
  });

  // Битая UTF-8 последовательность (0xFF): декодирование до HMAC подменяло её
  // на U+FFFD → 401. По байтам подпись проходит; декодирование после проверки
  // даёт U+FFFD внутри строки — JSON валиден, событие создаётся.
  it('invalid UTF-8 в теле: подпись по байтам проходит (не 401)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const raw = Buffer.concat([Buffer.from('{"title":"a'), Buffer.from([0xff]), Buffer.from('"}')]);
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, raw, signPayload(HOOK_NOTIFICATION.secret, raw));
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 42 });
    expect(mocks.notificationAdd).toHaveBeenCalledTimes(1);
  });

  // reader.read() reject (обрыв клиента) → 400, не 500; cancel/release не роняют
  // хендлер. Отказ до обращения к БД; счётчик не двигает — это не подбор подписи.
  it('обрыв чтения (read reject) → 400, БД не тронута, rate-счётчик не двигается', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('client gone'));
      },
    });
    const req = new NextRequest(`http://127.0.0.1:3000/api/integrations/inbound/${HOOK_NOTIFICATION.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-artel-signature': 'deadbeef' },
      body,
      duplex: 'half',
    });
    const res = await POST_RECEIVE(req, { params: Promise.resolve({ id: String(HOOK_NOTIFICATION.id) }) });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'request aborted' });
    expect(mocks.getHook).not.toHaveBeenCalled();
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(0);
  });
});

describe('POST [id]: лимит размера тела — 413 до HMAC (issue #96, cap 64 KiB)', () => {
  // Дублирует MAX_BODY_BYTES роута намеренно: лимит зафиксирован тестом.
  const OVER = 64 * 1024 + 1;

  it('oversized с Content-Length → 413 до чтения тела, событие не создаётся, rate-счётчик не двигается', async () => {
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, '{}', null);
    // undici сам не выставляет content-length — реальный клиент присылает его,
    // выставляем явно: заголовок заявляет oversized, тело меньше (гейт смотрит
    // только на заголовок и отказывает до чтения потока).
    req.headers.set('content-length', String(OVER));
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('large') });
    expect(mocks.getHook).not.toHaveBeenCalled(); // отказ до обращения к БД
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
    expect(mocks.todoAdd).not.toHaveBeenCalled();
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(0); // 413 — не перебор подписи, счётчик неудач не растёт
  });

  it('oversized без Content-Length (стрим) → чтение обрывается капом → 413, событие не создаётся', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, 'x'.repeat(OVER), 'deadbeef');
    // Явно убираем заголовок — не полагаемся на то, что undici его не ставит.
    req.headers.delete('content-length');
    expect(req.headers.get('content-length')).toBeNull(); // → запрос идёт по пути стрима (аналог chunked)
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('large') });
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
    expect(mocks.todoAdd).not.toHaveBeenCalled();
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(0);
  });

  it('тело ровно 64 KiB проходит гейт → 401 по подписи (а не 413)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const raw = 'x'.repeat(64 * 1024);
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, raw, 'deadbeef');
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(401); // гейт пропустил, отвергла подпись
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(1);
  });

  it('multi-chunk oversized: чанки по 40 KiB (каждый ≤ MAX) → 413, cancel доходит до продюсера', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    // Каждый чанк ≤ MAX: срабатывает только кумулятивный счётчик — при мутации
    // «счётчик не кумулятивный» (bytes = value.byteLength) лимит не сработал бы
    // ни на одном чанке и тест упал бы (401 вместо 413). Продюсер pull-based:
    // у стрима без close() cancel источника вызывается гарантированно.
    const { req, ctx, pulls, cancelled } = streamedReq(HOOK_NOTIFICATION.id);
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(413);
    expect(cancelled()).toBe(true); // чтение прекратилось: reader.cancel дошёл до продюсера
    expect(pulls()).toBeLessThan(4); // вытянуто ≤ 2-3 чанков: стрим не вычитан до конца
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
    expect(mocks.todoAdd).not.toHaveBeenCalled();
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(0);
  });

  // Аудит #98 (HIGH): переполнение мелкими чанками — 100×700 B ≈ 70 KiB > капа.
  // Память фиксирована одним преаллоцированным Buffer(MAX): количество чанков
  // на heap не влияет; отказ приходит до БД/HMAC.
  it('переполнение мелкими чанками (100×700 B) → 413, чтение остановлено досрочно', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(700));
        if (pulls >= 100) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new NextRequest(`http://127.0.0.1:3000/api/integrations/inbound/${HOOK_NOTIFICATION.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-artel-signature': 'deadbeef' },
      body,
      duplex: 'half',
    });
    const res = await POST_RECEIVE(req, { params: Promise.resolve({ id: String(HOOK_NOTIFICATION.id) }) });
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true); // cancel при переполнении: кап не уводит в 400
    expect(pulls).toBeLessThan(100); // кап сработал до исчерпания продюсера (~94 чанка)
    expect(mocks.getHook).not.toHaveBeenCalled();
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(0);
  });

  it('Content-Length ровно MAX проходит precheck → 401 по подписи (а не 413)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, '{}', 'deadbeef');
    req.headers.set('content-length', String(64 * 1024)); // == MAX: граница precheck не отклоняет
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(401); // при мутации «>=» precheck дал бы 413
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(1);
  });
});

describe('POST [id]: опциональный x-artel-timestamp — replay-защита (issue #97)', () => {
  const BODY = { title: 'replayed delivery' };
  const raw = JSON.stringify(BODY);

  // Отправители без заголовка (текущие внутренние сервисы, curl) не ломаются:
  // контракт подписи не менялся, заголовок purely additive.
  it('без заголовка — прежнее поведение: 200, событие создаётся', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = signedReq(HOOK_NOTIFICATION, BODY);
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 42 });
    expect(mocks.notificationAdd).toHaveBeenCalledTimes(1);
  });

  it('свежий timestamp → 200, событие создаётся', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = eventReq(
      HOOK_NOTIFICATION.id, raw, signPayload(HOOK_NOTIFICATION.secret, raw), String(Date.now()),
    );
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 42 });
    expect(mocks.notificationAdd).toHaveBeenCalledTimes(1);
  });

  // Повтор захваченной доставки через >5 мин: подпись валидна, timestamp протух
  // → 400 до мутации; бюджет двигается, чтобы массовый повтор упирался в 429.
  it('протухший timestamp (подпись валидна) → 400, событие не создаётся, бюджет двигается', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const stale = String(Date.now() - 400_000); // > окна ±300 с, без опоры на границу
    const { req, ctx } = eventReq(
      HOOK_NOTIFICATION.id, raw, signPayload(HOOK_NOTIFICATION.secret, raw), stale,
    );
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'stale timestamp' });
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(1);
  });

  // Окно симметрично: timestamp из далёкого будущего тоже отклоняется —
  // иначе зашитый в шаблон «свежий навсегда» ts отключал бы защиту.
  it('timestamp из далёкого будущего → 400', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const future = String(Date.now() + 400_000);
    const { req, ctx } = eventReq(
      HOOK_NOTIFICATION.id, raw, signPayload(HOOK_NOTIFICATION.secret, raw), future,
    );
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'stale timestamp' });
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  it('мусор в заголовке (не целое число) → 400 invalid timestamp', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = eventReq(
      HOOK_NOTIFICATION.id, raw, signPayload(HOOK_NOTIFICATION.secret, raw), 'not-a-number',
    );
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid timestamp' });
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  // Порядок гейтов: подпись проверяется первой — без валидного HMAC содержимое
  // timestamp ни на что не влияет (не oracle), наблюдается 401, не 400.
  it('невалидная подпись + мусорный timestamp → 401 (timestamp не проверяется)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, raw, 'deadbeef', 'garbage');
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid signature' });
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  // Replay-сценарий: повтор байт запроса один в один (старый timestamp внутри) —
  // каждый повтор 400 и двигает per-hook бюджет, 31-й повтор уходит в 429.
  it('массовый повтор одной доставки (фиксированный старый ts) → 429 на 31-й', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const stale = String(Date.now() - 400_000);
    const sig = signPayload(HOOK_NOTIFICATION.secret, raw); // повторяется один в один
    for (let i = 0; i < 30; i += 1) {
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, raw, sig, stale);
      const res = await POST_RECEIVE(req, ctx);
      expect(res.status).toBe(400);
    }
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(30);
    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, raw, sig, stale);
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('много') });
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
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

// #109: у DELETE тот же гейт валидности id, что у POST (см. #92 выше): middleware
// пропускает любую цифровую строку, поэтому гейт обязан жить в роуте — после auth,
// но до БД. Number(id) должен быть целым > 0: id=0 и переполнение до Infinity → 400;
// конечное гигантское (1e20 — целое) проходит гейт и уходит в БД → 404 «hook not found».
describe('DELETE [id]: граница валидности id (#109)', () => {
  function rawIdReq(id: string): { req: NextRequest; ctx: { params: Promise<{ id: string }> } } {
    return {
      req: new NextRequest(`http://127.0.0.1:3000/api/integrations/inbound/${id}`, {
        method: 'DELETE',
        headers: { cookie: cookieValue() },
      }),
      ctx: { params: Promise.resolve({ id }) },
    };
  }

  it('id=0 → 400 «invalid id» до БД (не 404)', async () => {
    const { req, ctx } = rawIdReq('0');
    const res = await DELETE_HOOK(req, ctx);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid id' });
    expect(mocks.deleteHook).not.toHaveBeenCalled();
  });

  it('огромный цифровой id (Number → Infinity) → 400 до БД', async () => {
    const { req, ctx } = rawIdReq('9'.repeat(400)); // 400 цифр: Number = Infinity, regex \d+ такой путь пропускает
    const res = await DELETE_HOOK(req, ctx);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid id' });
    expect(mocks.deleteHook).not.toHaveBeenCalled();
  });

  it('граница ветки: конечный огромный id (1e20 — целое) — не 400, а 404 из БД', async () => {
    mocks.deleteHook.mockReturnValue(false);
    const { req, ctx } = rawIdReq('100000000000000000000'); // Number(...) = 1e20 — integer > 0
    const res = await DELETE_HOOK(req, ctx);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'hook not found' });
    expect(mocks.deleteHook).toHaveBeenCalledWith(1e20); // дошло до удаления
  });
});

describe('rate-limit POST /api/integrations/inbound/[id] (30 неудач/хук/5 мин + глобальный кап 200)', () => {
  it('30 неудачных подписей → 401, 31-я → 429 + Retry-After; 429 не инкрементит', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    for (let i = 0; i < 30; i++) {
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      const res = await POST_RECEIVE(req, ctx);
      expect(res.status).toBe(401);
    }
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(30);

    const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('Слишком много') });
    const retryAfter = res.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(300); // окно 5 минут
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(30); // 429 сам счётчик не двигает
    expect(mocks.notificationAdd).not.toHaveBeenCalled();
  });

  // issue #103: бюджеты изолированы по хукам — блокировка #5 не задевает #6.
  it('30 неудач хука #5 → 429 для #5, но хук #6 отвечает 401 (не 429)', async () => {
    mocks.getHook.mockImplementation((id: number) =>
      id === HOOK_NOTIFICATION.id ? HOOK_NOTIFICATION : id === HOOK_TODO.id ? HOOK_TODO : null,
    );
    for (let i = 0; i < 30; i++) {
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      expect((await POST_RECEIVE(req, ctx)).status).toBe(401);
    }
    const blocked = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    expect((await POST_RECEIVE(blocked.req, blocked.ctx)).status).toBe(429);

    // Бюджет #6 пуст → подпись отвергается обычным 401 (глобальный guard далеко от капа).
    const other = eventReq(HOOK_TODO.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    expect((await POST_RECEIVE(other.req, other.ctx)).status).toBe(401);
    expect(hookBudget(HOOK_TODO.id).fails).toBe(1);
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(30); // 429 по #5 не списал бюджет #6

    // Легитимная доставка в #6 проходит, пока #5 в 429: бюджеты и гейты независимы.
    const delivered = signedReq(HOOK_TODO, { title: 'ок при чужом 429', body: 'ок' });
    expect((await POST_RECEIVE(delivered.req, delivered.ctx)).status).toBe(200);
    expect(mocks.todoAdd).toHaveBeenCalled();
  });

  // issue #103 / Val103CR: глобальный abuse-guard — кап 200 на процесс, скоуп —
  // только перебор id (невалидный/неизвестный хук); известный хук он не блокирует.
  it('глобальный кап: 200 невалидных id → перебор 429, но доставка в хук #6 → 200', async () => {
    // 200 переборных неудач по невалидным id (400): per-hook бюджеты не создаются.
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    for (let i = 0; i < 200; i++) {
      const { req, ctx } = eventReq(0, '{}', 'deadbeef');
      expect((await POST_RECEIVE(req, ctx)).status).toBe(400);
    }
    expect(globalBudget().fails).toBe(200);
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(0); // невалидный id — не к хуку

    // Перебор заблокирован: невалидный id и неизвестный хук → 429 + Retry-After.
    mocks.getHook.mockReturnValue(null);
    const invalid = eventReq(0, '{}', 'deadbeef');
    expect((await POST_RECEIVE(invalid.req, invalid.ctx)).status).toBe(429);
    const unknown = eventReq(9999, '{}', 'deadbeef');
    const blockedUnknown = await POST_RECEIVE(unknown.req, unknown.ctx);
    expect(blockedUnknown.status).toBe(429);
    expect(blockedUnknown.headers.get('retry-after')).not.toBeNull();
    expect(globalBudget().fails).toBe(200); // 429-путь сам счётчик не двигает

    // Главное: кап НЕ блокирует легитимную доставку в известный хук → 200 + событие.
    mocks.getHook.mockReturnValue(HOOK_TODO);
    const ok = signedReq(HOOK_TODO, { title: 'мимо капа', body: 'ок' });
    const res = await POST_RECEIVE(ok.req, ok.ctx);
    expect(res.status).toBe(200);
    expect(mocks.todoAdd).toHaveBeenCalled(); // событие создано
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
      expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(30);
      expect(hookBudget(HOOK_NOTIFICATION.id).resetAt).toBe(now + 5 * 60 * 1000);
      const locked = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      expect((await POST_RECEIVE(locked.req, locked.ctx)).status).toBe(429);

      // +5 минут и секунда: окно истекло → fuse отпускает, неудача открывает новое окно.
      spy.mockReturnValue(now + 5 * 60 * 1000 + 1000);
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      const res = await POST_RECEIVE(req, ctx);
      expect(res.status).toBe(401);
      expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(1);
      expect(hookBudget(HOOK_NOTIFICATION.id).resetAt).toBe(now + 10 * 60 * 1000 + 1000);
    } finally {
      spy.mockRestore();
    }
  });

  // issue #103: успех — доказательство владения секретом — сбрасывает бюджет только
  // своего хука; глобальный guard обнулить чередованием неудача/успех нельзя.
  it('успешная подпись сбрасывает бюджет своего хука, глобальный guard — нет', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    // 29 неудач — на грани лимита.
    for (let i = 0; i < 29; i++) {
      const { req, ctx } = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
      await POST_RECEIVE(req, ctx);
    }
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(29);

    const { req, ctx } = signedReq(HOOK_NOTIFICATION, { title: 'ок', body: 'ок' });
    const res = await POST_RECEIVE(req, ctx);
    expect(res.status).toBe(200);
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(0); // успех обнулил бюджет хука
    expect(globalBudget().fails).toBe(0); // неудачи известного хука глобальный guard не двигают

    // Следующая неудача — снова 401, а не 429: бюджет начинался с нуля.
    const retry = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    const res2 = await POST_RECEIVE(retry.req, retry.ctx);
    expect(res2.status).toBe(401);
    expect(hookBudget(HOOK_NOTIFICATION.id).fails).toBe(1);
  });

  it('карта бюджетов ограничена (1000): истёкшие вычищаются, живые не вытесняются (skip tracking)', async () => {
    mocks.getHook.mockReturnValue(HOOK_NOTIFICATION);
    const budgets = hookBudgets();
    // 1) Все слоты с истёкшими окнами → одна неудача вычищает их, остаётся новый бюджет.
    for (let i = 1001; i <= 2000; i++) budgets.set(i, { fails: 5, resetAt: 1 });
    const first = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    expect((await POST_RECEIVE(first.req, first.ctx)).status).toBe(401);
    expect(budgets.size).toBe(1);
    expect(budgets.get(HOOK_NOTIFICATION.id)?.fails).toBe(1);

    // 2) Все слоты живы → новый id остаётся без учёта (skip tracking), чужие бюджеты
    // целы: вытеснение живого бюджета = бесплатный сброс блокировки легитимного хука.
    budgets.clear();
    const future = Date.now() + 10 * 60 * 1000;
    for (let i = 1001; i <= 2000; i++) budgets.set(i, { fails: 5, resetAt: future });
    const second = eventReq(HOOK_NOTIFICATION.id, JSON.stringify({ title: 'x' }), 'deadbeef');
    expect((await POST_RECEIVE(second.req, second.ctx)).status).toBe(401);
    expect(budgets.size).toBe(1000);
    expect(budgets.has(1001)).toBe(true); // ничего не вытеснено
    expect(budgets.has(HOOK_NOTIFICATION.id)).toBe(false); // новый id — без учёта
  });
});
