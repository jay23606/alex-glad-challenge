// Unit: Route Handler POST /api/mobile/login — вход мобильного клиента (Артель)
// по паролю рабочего пространства: 400/401/503/429/200, token в теле, без cookie.
// Auth — реальный (HMAC на тестовых env); rate-limit общий (loginRateLimit),
// сбрасывается между тестами; сети и БД нет.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

let POST: (req: NextRequest) => Promise<Response>;
let isValidSession: (value: string | undefined | null) => boolean;
let isMobileAuthed: (req: NextRequest) => boolean;
let reset: () => void;
let RATE_LIMIT: number;

// Динамический импорт обязателен: vi.mock (если появится) должен примениться
// ДО оценки route-модуля (канонический паттерн route-тестов, AGENTS §9.4).
beforeAll(async () => {
  ({ POST } = await import('../../app/api/mobile/login/route'));
  ({ isValidSession, isMobileAuthed } = await import('../../lib/auth'));
  ({ RATE_LIMIT, reset } = await import('../../lib/server/loginRateLimit'));
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  reset();
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/mobile/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mobile/login', () => {
  it('400 на невалидном теле + no-store', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(typeof json.error).toBe('string');
  });

  it('400 на битом JSON', async () => {
    const broken = new NextRequest('http://127.0.0.1:3000/api/mobile/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    });
    expect((await POST(broken)).status).toBe(400);
  });

  it('401 на неверном пароле', async () => {
    const res = await POST(req({ password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'Неверный пароль' });
  });

  it('200 на верном пароле: token валиден, expiresAt, без Set-Cookie, no-store', async () => {
    const res = await POST(req({ password: 'test-password' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(typeof json.token).toBe('string');
    expect(json.expiresAt).toBe(Number(json.token.split('.')[0]));
    expect(isValidSession(json.token)).toBe(true);
    // Цепочка «токен из роута → Bearer на /api» — без неё Android получит 401.
    const authed = new NextRequest('http://127.0.0.1:3000/api/mobile/bootstrap', {
      headers: { authorization: `Bearer ${json.token}` },
    });
    expect(isMobileAuthed(authed)).toBe(true);
  });

  it('503, когда админ-auth env не задан (fail-closed по каждой переменной)', async () => {
    const saved = {
      password: process.env.WEB_ADMIN_PASSWORD,
      secret: process.env.WEB_AUTH_SECRET,
    };
    const expected = {
      ok: false,
      error: 'Админ-доступ не настроен: задайте WEB_ADMIN_PASSWORD и WEB_AUTH_SECRET в .env',
    };
    try {
      delete process.env.WEB_AUTH_SECRET;
      const noSecret = await POST(req({ password: 'test-password' }));
      expect(noSecret.status).toBe(503);
      expect(await noSecret.json()).toEqual(expected);

      process.env.WEB_AUTH_SECRET = saved.secret;
      delete process.env.WEB_ADMIN_PASSWORD;
      const noPassword = await POST(req({ password: 'test-password' }));
      expect(noPassword.status).toBe(503);
      expect(await noPassword.json()).toEqual(expected);

      delete process.env.WEB_AUTH_SECRET;
      expect((await POST(req({ password: 'test-password' }))).status).toBe(503);
    } finally {
      restoreEnv('WEB_ADMIN_PASSWORD', saved.password);
      restoreEnv('WEB_AUTH_SECRET', saved.secret);
    }
  });

  it('успешный вход сбрасывает окно rate-limit', async () => {
    for (let i = 0; i < RATE_LIMIT - 1; i += 1) {
      expect((await POST(req({ password: 'wrong' }))).status).toBe(401);
    }
    expect((await POST(req({ password: 'test-password' }))).status).toBe(200);
    // Без reset() десятая неудача после успеха уже вернула бы 429.
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect((await POST(req({ password: 'wrong' }))).status).toBe(401);
    }
    expect((await POST(req({ password: 'wrong' }))).status).toBe(429);
  });

  it('429 после порога rate-limit (даже с верным паролем)', async () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      const failed = await POST(req({ password: 'wrong' }));
      expect(failed.status).toBe(401);
    }
    const res = await POST(req({ password: 'test-password' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('900');
  });
});
