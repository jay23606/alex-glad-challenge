// Unit: isMobileAuthed/requireApiAuth (web/lib/auth.ts) — Bearer с подписанной
// session-строкой (выдача /api/auth/login и /api/mobile/login) и статический
// MOBILE_API_TOKEN автоматизации. Auth-математика реальная (HMAC на тестовых
// env); сети и БД нет.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';
process.env.MOBILE_API_TOKEN = 'test-mobile-token';

const MOBILE_TOKEN = 'test-mobile-token';

let createSessionValue: () => string;
let isValidSession: (value: string | undefined | null) => boolean;
let isMobileAuthed: (req: NextRequest) => boolean;
let requireApiAuth: (req: NextRequest) => NextResponse | null;
let SESSION_TTL_MS: number;

beforeAll(async () => {
  ({ createSessionValue, isValidSession, isMobileAuthed, requireApiAuth, SESSION_TTL_MS } =
    await import('../../lib/auth'));
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function bearer(value: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/mobile/bootstrap', {
    headers: { authorization: `Bearer ${value}` },
  });
}

describe('isMobileAuthed', () => {
  it('подписанная session-строка (выдача /api/mobile/login) → true', () => {
    expect(isMobileAuthed(bearer(createSessionValue()))).toBe(true);
  });

  it('подделка (неверная подпись) → false', () => {
    expect(isMobileAuthed(bearer('999.deadbeef'))).toBe(false);
  });

  it('статический MOBILE_API_TOKEN (автоматизация) → true', () => {
    expect(isMobileAuthed(bearer(MOBILE_TOKEN))).toBe(true);
  });

  it('без Authorization → false', () => {
    expect(isMobileAuthed(new NextRequest('http://127.0.0.1:3000/api/mobile/bootstrap'))).toBe(false);
  });
});

describe('requireApiAuth', () => {
  it('Bearer session-токен пропускает (null)', () => {
    expect(requireApiAuth(bearer(createSessionValue()))).toBeNull();
  });

  it('подделка → 401', () => {
    const denied = requireApiAuth(bearer('999.deadbeef'));
    expect(denied?.status).toBe(401);
  });
});

describe('isValidSession: TTL', () => {
  afterEach(() => vi.useRealTimers());

  it('валиден до exp и истекает после', () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-10-25T00:00:00Z').getTime();
    vi.setSystemTime(t0);
    const token = createSessionValue();
    expect(isValidSession(token)).toBe(true);

    vi.setSystemTime(t0 + SESSION_TTL_MS - 1);
    expect(isValidSession(token)).toBe(true);

    vi.setSystemTime(t0 + SESSION_TTL_MS + 1);
    expect(isValidSession(token)).toBe(false);
  });

  it('подмена exp при старой подписи → false', () => {
    const token = createSessionValue();
    const dot = token.indexOf('.');
    const exp = Number(token.slice(0, dot));
    expect(isValidSession(`${exp + 60_000}${token.slice(dot)}`)).toBe(false);
  });
});

describe('fail-closed env', () => {
  it('без MOBILE_API_TOKEN статический токен не проходит, session проходит', () => {
    const saved = process.env.MOBILE_API_TOKEN;
    delete process.env.MOBILE_API_TOKEN;
    try {
      expect(isMobileAuthed(bearer(MOBILE_TOKEN))).toBe(false);
      expect(isMobileAuthed(bearer(createSessionValue()))).toBe(true);
    } finally {
      restoreEnv('MOBILE_API_TOKEN', saved);
    }
  });

  it('без WEB_AUTH_SECRET подписанная сессия не проходит', () => {
    const token = createSessionValue();
    const saved = process.env.WEB_AUTH_SECRET;
    delete process.env.WEB_AUTH_SECRET;
    try {
      expect(isMobileAuthed(bearer(token))).toBe(false);
    } finally {
      restoreEnv('WEB_AUTH_SECRET', saved);
    }
  });
});

describe('Authorization parsing', () => {
  it.each([
    ['Bearer <t>', (t: string) => `Bearer ${t}`, true],
    ['bearer <t>', (t: string) => `bearer ${t}`, true],
    ['Bearer   <t>', (t: string) => `Bearer   ${t}`, true],
    ['Basic <t>', (t: string) => `Basic ${t}`, false],
    ['Bearer без значения', () => 'Bearer', false],
  ])('%s', (_name, make, expected) => {
    const request = new NextRequest('http://127.0.0.1:3000/api/mobile/bootstrap', {
      headers: { authorization: make(createSessionValue()) },
    });
    expect(isMobileAuthed(request)).toBe(expected);
  });
});
