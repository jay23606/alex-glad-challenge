// /api/integrations/inbound/[id] — приём события (POST, публичный: HMAC-подпись
// сырого тела вместо сессии; путь открыт в middleware) + удаление хука (DELETE, auth).
// Подпись — hex HMAC-SHA256(secret, rawBody) в заголовке x-artel-signature
// (тот же контракт, что у исходящих webhooks); rawBody — сырые байты запроса,
// декодирование в UTF-8 для JSON.parse — только после проверки (issue #98).
//
// Опциональный x-artel-timestamp (Unix ms, issue #97): нет заголовка — прежнее
// поведение; есть — принимается только в окне ±5 мин от серверного времени,
// иначе 400. В подпись не входит (контракт подписи заморожен, отправители не
// ломаются) — см. docs/AUTHORIZATION.md.
//
// Rate-limit POST — два in-memory fixed-window, окно 5 минут у обоих (issue #103):
// 1) per-hook: 30 неудачных попыток (401/404/400) КОНКРЕТНОГО хука → 429 + Retry-After
//    до конца окна. Раньше счётчик был один на все хуки: 30 неудач против хука #1
//    блокировали и хук #2, а сбрасывал счётчик только успех — сам заблокированный.
//    Окно сбрасывается по времени; успех (доказательство владения секретом) сбрасывает
//    бюджет только своего хука. Accepted risk F2: адресный lockout конкретного хука
//    (30 мусорных подписей/5 мин → 429 до конца окна) — цена любого per-key rate-limit;
//    митигации: мониторинг 429, ротация/DELETE хука (docs/AUTHORIZATION.md).
// 2) глобальный abuse-guard: 200 неудач на процесс — только перебор id (невалидный
//    или неизвестный хук): гейт применяется там, где хук не опознан (invalid-id до
//    чтения тела, unknown hook после getHook). Известный хук глобальный кап не
//    блокирует — иначе мусор по чужим id отзывался бы 429 на легитимные доставки.
//    Успех глобальный счётчик НЕ сбрасывает: чередование неудача/успех не должно
//    обнулять guard.
// Карта per-hook бюджетов капится 1000 записями: истёкшие окна вычищаются; при полной
// карте живых бюджетов новый id остаётся без учёта (skip tracking) — предусловие
// практически недостижимо (~1000 живых бюджетов/окно; перебор id раньше закрывает
// глобальный кап 200).
// Глобальный (не per-IP) сознательно, как у login: за прокси XFF подделываем;
// сбрасывается рестартом.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { inboundEventSchema } from '../../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../../lib/server/http';
import {
  getInboundHookDb,
  getNotificationDb,
  getTodoDb,
  withDb,
} from '../../../../../lib/server/db';
import {
  NotificationService,
  handleInboundEvent,
  verifySignature,
} from '../../../../../lib/server/challenge';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = 30; // неудачных попыток одного хука до 429 (per-hook бюджет)
const GLOBAL_FAIL_LIMIT = 200; // неудач на процесс до 429 (abuse-guard, issue #103)
const RATE_WINDOW_MS = 5 * 60 * 1000; // окно 5 минут — общее для обоих счётчиков
const MAX_TRACKED_HOOKS = 1000; // кап размера карты per-hook бюджетов (память)

// Лимит размера тела POST до проверки подписи (issue #96). Тело нужно целиком
// (HMAC считается по raw body), т.е. оно читается до аутентификации — без капа
// запрос с огромным/бесконечным (chunked) телом вынуждает сервер буферизовать
// его в памяти: pre-auth memory DoS. 64 KiB с запасом покрывают легитимные
// события {title, body} и отсекают всё крупное до/во время чтения.
const MAX_BODY_BYTES = 64 * 1024;

// Модульное состояние окон (globalThis — переживает HMR dev-сервера). Роут захватывает
// ссылки при импорте — тест мутирует содержимое через globalThis, не ссылки.
interface FailBudget {
  fails: number;
  resetAt: number;
}
const g = globalThis as unknown as {
  __inboundHookFails?: Map<number, FailBudget>;
  __inboundGlobalFails?: FailBudget;
};
const hookBudgets: Map<number, FailBudget> = (g.__inboundHookFails ??= new Map());
const globalBudget: FailBudget = (g.__inboundGlobalFails ??= { fails: 0, resetAt: 0 });

// Fixed-window: истекшее окно обнуляет счётчик — через 5 минут гейт снова пускает,
// «вечный lockout» невозможен по построению (issue #103).
function rollWindow(budget: FailBudget, now: number): void {
  if (now >= budget.resetAt) {
    budget.fails = 0;
    budget.resetAt = now + RATE_WINDOW_MS;
  }
}

function registerGlobalFail(): void {
  rollWindow(globalBudget, Date.now());
  globalBudget.fails += 1;
}

// Карта per-hook бюджетов ограничена по размеру: при заполнении вычищаются хуки с
// истёкшим окном. Если всё ещё тесно (все бюджеты живы) — новый id остаётся без
// учёта: вытеснение чужого живого бюджета = бесплатный сброс блокировки легитимного
// хука, а перебор id в это время режет глобальный guard (200/окно), памяти он не
// угрожает. Кап — гигиена памяти, а не второй лимитер.
function registerHookFail(hookId: number): void {
  const now = Date.now();
  let budget = hookBudgets.get(hookId);
  if (!budget) {
    if (hookBudgets.size >= MAX_TRACKED_HOOKS) {
      for (const [key, entry] of hookBudgets) {
        if (now >= entry.resetAt) hookBudgets.delete(key);
      }
      if (hookBudgets.size >= MAX_TRACKED_HOOKS) return; // skip tracking, чужие бюджеты не трогаем
    }
    budget = { fails: 0, resetAt: 0 };
    hookBudgets.set(hookId, budget);
  }
  rollWindow(budget, now);
  budget.fails += 1;
}

// 429 + Retry-After до конца окна; сам 429-путь счётчики не двигает.
function limited(budget: FailBudget, limit: number): Response | null {
  const now = Date.now();
  if (budget.fails >= limit && now < budget.resetAt) {
    const retryAfterSec = Math.max(1, Math.ceil((budget.resetAt - now) / 1000));
    return NextResponse.json(
      { error: 'Слишком много неудачных попыток. Подождите до конца 5-минутного окна.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSec) } },
    );
  }
  return null;
}

// Опциональная replay-защита (issue #97). Отправитель MAY передать
// x-artel-timestamp (Unix ms): нет заголовка — поведение прежнее; есть — запрос
// принимается только при |now − ts| ≤ окна, иначе 400. Заголовок НЕ входит в
// подпись (контракт подписи заморожен): он отсекает наивный повтор захваченной
// доставки — в повторе остаётся старый timestamp, а провал двигает per-hook
// бюджет и упирается в 429. От активного подменщика заголовка (MITM) это не
// защищает — для loopback-модели угроз достаточно, см. docs/AUTHORIZATION.md.
const TIMESTAMP_WINDOW_MS = 300_000; // ±5 минут, симметрично в прошлое и будущее

function timestampRejection(req: NextRequest): string | null {
  const header = req.headers.get('x-artel-timestamp');
  if (header === null) return null;
  const ts = Number(header.trim());
  if (!Number.isSafeInteger(ts) || ts <= 0) return 'invalid timestamp';
  if (Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) return 'stale timestamp';
  return null;
}

// Чтение тела с капом; ok:false too-large — лимит превышен, aborted — поток
// сорвался (обрыв клиента → 400, а не 500; это не попытка подбора подписи,
// rate-счётчик не двигает). Сначала дешёвый precheck по заголовку
// Content-Length (отказ до чтения потока), затем поток читается чанками как
// сырые байты: подпись считается по байтам, декодирование UTF-8 — только после
// успешной проверки (issue #98: TextDecoder режет BOM и подменяет битые
// последовательности, HMAC по декодированной строке не совпадает с подписью
// отправителя). Память — один преаллоцированный буфер + курсор: O(MAX) на запрос
// независимо от гранулярности чанков (массив чанков при chunked '1\r\nA\r\n'
// раздувал heap в сотни раз при «64 KiB» запросе). При переполнении чтение
// прекращается (reader.cancel()) — chunked-запрос без Content-Length не может
// буферизоваться бесконечно.
type BodyRead =
  | { ok: true; body: Buffer }
  | { ok: false; reason: 'too-large' | 'aborted' };

async function readBodyCapped(req: NextRequest): Promise<BodyRead> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, reason: 'too-large' };
  if (!req.body) return { ok: true, body: Buffer.alloc(0) };
  const reader = req.body.getReader();
  const buf = Buffer.allocUnsafe(MAX_BODY_BYTES);
  let len = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { ok: true, body: buf.subarray(0, len) };
      if (len + value.byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {}); // reject cancel не уводит в catch: кап остаётся 413, не 400
        return { ok: false, reason: 'too-large' };
      }
      buf.set(value, len);
      len += value.byteLength;
    }
  } catch {
    return { ok: false, reason: 'aborted' };
  } finally {
    // cancel: no-op на закрытом/оборванном потоке (ошибки игнорируем);
    // releaseLock: чтение всегда завершено к этому моменту.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Гейты вперёд, порядок limit → id → sizeGate → hook → HMAC сохранён. Глобальный
  // abuse-guard — только перебор id (невалидный/неизвестный хук); доставки известного
  // хука он не трогает: иначе 200 мусорных запросов по чужим id отзывались бы 429 на
  // легитимные подписанные события (issue #103, Val103CR).
  const { id } = await params;
  const hookId = Number(id);
  if (!Number.isInteger(hookId) || hookId <= 0) {
    // Невалидный id — чистый перебор: глобальный guard до чтения тела.
    const denied = limited(globalBudget, GLOBAL_FAIL_LIMIT);
    if (denied) return denied;
    registerGlobalFail();
    return jsonError('invalid id', 400);
  }
  const budget = hookBudgets.get(hookId);
  const hookDenied = budget ? limited(budget, RATE_LIMIT) : null;
  if (hookDenied) return hookDenied;

  // Сырое тело до JSON.parse — подпись считается по его байтам. Читается с
  // капом: oversized → 413 до/во время чтения, до проверки подписи (issue #96);
  // обрыв клиента → 400 (issue #98).
  const read = await readBodyCapped(req);
  if (!read.ok) {
    if (read.reason === 'aborted') return jsonError('request aborted', 400);
    return jsonError('body too large', 413);
  }
  const rawBody = read.body;
  const signature = req.headers.get('x-artel-signature') ?? '';

  const hook = await withDb(() => getInboundHookDb().get(hookId));
  if (!hook) {
    // Неизвестный id — перебор: глобальный guard (после getHook), плюс per-hook
    // бюджет этого id — долбление одного несуществующего id отсекается до БД.
    // Oracle 404-vs-401 (решение зафиксировано, #92; поведение не менять):
    // неизвестный id → 404 «hook not found», известный id с неверной подписью →
    // 401 «invalid signature». Различение сознательное — легитимный интегратор
    // отличает опечатку в URL от ротированного секрета. Цена: существование id
    // перебирается по статусу; утечка осознанная — существование id не секрет
    // (id — маленькие последовательные целые, настоящая граница доступа —
    // секрет хука), а схлопывание 404→401 устранило бы oracle, но ухудшило бы
    // диагностику. Лимиты (глобальный guard 200/5 мин + per-hook бюджет 30/5 мин)
    // ограничивают СКОРОСТЬ перебора, не устраняя утечку.
    const denied = limited(globalBudget, GLOBAL_FAIL_LIMIT);
    if (denied) return denied;
    registerHookFail(hookId);
    registerGlobalFail();
    return jsonError('hook not found', 404);
  }
  if (!verifySignature(hook.secret, rawBody, signature)) {
    registerHookFail(hookId);
    return jsonError('invalid signature', 401);
  }

  // Timestamp-гейт только после успешного HMAC: без валидной подписи содержимое
  // заголовка ни на что не влияет (не oracle). Провал — 400 и per-hook бюджет,
  // как у прочих 400: повтор захваченной доставки ограничивается rate-limit'ом.
  const tsReject = timestampRejection(req);
  if (tsReject !== null) {
    registerHookFail(hookId);
    return jsonError(tsReject, 400);
  }

  // Декодирование только после успешной проверки подписи: подпись — по байтам.
  const bodyText = new TextDecoder().decode(rawBody);
  let json: unknown;
  try {
    json = JSON.parse(bodyText) as unknown;
  } catch {
    registerHookFail(hookId);
    return jsonError('body must be valid JSON', 400);
  }
  const parsed = inboundEventSchema.safeParse(json);
  if (!parsed.success) {
    registerHookFail(hookId);
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  }

  try {
    const recordId = await withDb(() =>
      handleInboundEvent(hook, parsed.data, {
        notifications: new NotificationService(getNotificationDb()),
        todos: getTodoDb(),
      }),
    );
    // Успех: валидная подпись доказывает владение секретом → сброс бюджета своего
    // хука (как у login). Глобальный guard успехом не сбрасывается: чередование
    // неудача/успех не должно обнулять его.
    hookBudgets.delete(hookId);
    return jsonOk({ id: recordId });
  } catch (e) {
    registerHookFail(hookId);
    return jsonError(safeMessage(e instanceof Error ? e.message : 'handle failed'), 400);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const hookId = Number(id);
  if (!Number.isInteger(hookId) || hookId <= 0) return jsonError('invalid id', 400);
  const ok = await withDb(() => getInboundHookDb().delete(hookId));
  if (!ok) return jsonError('hook not found', 404);
  return jsonOk({});
}
