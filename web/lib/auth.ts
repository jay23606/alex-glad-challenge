// Admin-auth (день 36): единый auth-код для middleware + Route Handlers.
// БЕЗ 'server-only' — этот модуль импортирует middleware.ts (server-only-пакет
// в middleware-bundle не гарантирован). Секреты читаются ТОЛЬКО здесь: наружу
// уходят Boolean-флаги; значения env никогда не покидают модуль и не попадают
// в ошибки (в сообщениях — только имена переменных).
//
// Механизм: stateless cookie admin_session = `${exp}.${HEX(HMAC-SHA256(secret, "admin:"+exp))}`,
// TTL 7 дней. Проверка: exp > now + пересчёт HMAC + timingSafeEqual по sha256-дайджестам.
//
// Env-landmine: Next грузит только web/.env*, секреты лежат в корневом .env репо —
// поэтому top-level loadEnvUpward() (тот же приём, что lib/server/env.ts). Цепочка
// импорта лёгкая: core/env → dotenv + node:fs/path на builtins.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { loadEnvUpward } from '@challenge/core/env';

loadEnvUpward();

export const SESSION_COOKIE = 'admin_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней
export const SESSION_MAX_AGE_S = SESSION_TTL_MS / 1000; // maxAge cookie в секундах

function getAuthSecret(): string | null {
  const s = process.env.WEB_AUTH_SECRET?.trim();
  return s ? s : null;
}

/** Наружу — только Boolean (fail-closed: обе переменные обязательны). */
export function isAdminAuthConfigured(): boolean {
  const p = process.env.WEB_ADMIN_PASSWORD?.trim();
  return p !== undefined && p.length > 0 && getAuthSecret() !== null;
}

// timingSafeEqual требует буферы равной длины — сравниваем sha256-дайджесты строк
// (дайджест всегда 32 байта). Покрывает и разнодлинные пароли, и hex-подписи.
function timingSafeEq(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

export function verifyAdminPassword(input: string): boolean {
  const expected = process.env.WEB_ADMIN_PASSWORD?.trim();
  if (expected === undefined || expected.length === 0 || getAuthSecret() === null) {
    return false; // fail-closed: без настроенного env пароля «нет»
  }
  return timingSafeEq(input, expected);
}

export function createSessionValue(): string {
  const secret = getAuthSecret();
  if (secret === null) throw new Error('WEB_AUTH_SECRET не задан в .env');
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = createHmac('sha256', secret).update(`admin:${exp}`).digest('hex');
  return `${exp}.${sig}`;
}

export function isValidSession(value: string | undefined | null): boolean {
  if (!value) return false;
  const secret = getAuthSecret();
  if (secret === null) return false; // fail-closed: без секрета валидных сессий не бывает
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const expStr = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d{1,16}$/.test(expStr)) return false;
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || exp <= Date.now()) return false;
  const expected = createHmac('sha256', secret).update(`admin:${exp}`).digest('hex');
  return timingSafeEq(sig, expected);
}

/** Второй auth-слой для деструктивных роутов: null = пропустить, ответ = вернуть 401. */
export function requireAuth(req: NextRequest): NextResponse | null {
  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return null;
  return NextResponse.json(
    { error: 'unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Статический Bearer-токен автоматизации/скриптов. Приложение Артель его не
 * использует: оно получает session-токен через /api/mobile/login. Наружу — только Boolean. */
export function isMobileApiConfigured(): boolean {
  const t = process.env.MOBILE_API_TOKEN?.trim();
  return t !== undefined && t.length > 0;
}

function isValidMobileToken(value: string | null | undefined): boolean {
  const expected = process.env.MOBILE_API_TOKEN?.trim();
  if (value == null || value === '' || expected === undefined || expected.length === 0) {
    return false; // fail-closed
  }
  return timingSafeEq(value, expected);
}

/** Извлекает и проверяет Authorization: Bearer из запроса: подписанная session-строка
 * (выдаётся /api/auth/login и /api/mobile/login) либо статический MOBILE_API_TOKEN
 * (автоматизация; сравнение timing-safe). Наружу — только Boolean. */
export function isMobileAuthed(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const token = match[1].trim();
  return isValidSession(token) || isValidMobileToken(token);
}

/** Второй auth-слой для API: cookie-сессия ИЛИ мобильный Bearer-токен. */
export function requireApiAuth(req: NextRequest): NextResponse | null {
  if (isValidSession(req.cookies.get(SESSION_COOKIE)?.value) || isMobileAuthed(req)) return null;
  return NextResponse.json(
    { error: 'unauthorized' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}
