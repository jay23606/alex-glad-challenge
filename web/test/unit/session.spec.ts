// Unit: isAdminAuthed (web/lib/server/session.ts) — обёртка над cookies() +
// isValidSession. next/headers мокается (vi.hoisted — hoisting vi.mock);
// auth-математика реальная (HMAC на тестовых env).
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const cookiesMock = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}));

let isAdminAuthed: () => Promise<boolean>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ isAdminAuthed } = await import('../../lib/server/session'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

function cookieStore(value?: string) {
  return {
    get: (name: string) => (value !== undefined && name === 'admin_session' ? { name, value } : undefined),
  };
}

describe('isAdminAuthed', () => {
  it('валидная HMAC-cookie → true', async () => {
    cookiesMock.mockResolvedValue(cookieStore(createSessionValue()));
    await expect(isAdminAuthed()).resolves.toBe(true);
  });

  it('невалидная cookie (подделка) → false', async () => {
    cookiesMock.mockResolvedValue(cookieStore('999.deadbeef'));
    await expect(isAdminAuthed()).resolves.toBe(false);
  });

  it('cookie отсутствует → false', async () => {
    cookiesMock.mockResolvedValue(cookieStore(undefined));
    await expect(isAdminAuthed()).resolves.toBe(false);
  });
});
