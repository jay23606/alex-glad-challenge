// Unit: Route Handler POST /api/auth/login — cookie-вход админа после выноса
// rate-limit в lib/server/loginRateLimit.ts. Фиксируем Set-Cookie-атрибуты,
// 400/401/429/503 и общее окно с мобильным входом. Auth-математика реальная,
// сети и БД нет.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

let POST: (req: NextRequest) => Promise<Response>;
let mobilePOST: (req: NextRequest) => Promise<Response>;
let reset: () => void;
let RATE_LIMIT: number;

// Динамический импорт: env выше должен быть выставлен до загрузки lib/auth.
beforeAll(async () => {
  ({ POST } = await import('../../app/api/auth/login/route'));
  ({ POST: mobilePOST } = await import('../../app/api/mobile/login/route'));
  ({ RATE_LIMIT, reset } = await import('../../lib/server/loginRateLimit'));
});

beforeEach(() => {
  reset();
});

function req(body: unknown, path = '/api/auth/login'): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('POST /api/auth/login', () => {
  it('400 на невалидном теле + no-store', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).ok).toBe(false);
  });

  it('401 на неверном пароле: без Set-Cookie', async () => {
    const res = await POST(req({ password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({ ok: false, error: 'Неверный пароль' });
  });

  it('200: admin_session cookie с флагами, тело без токена', async () => {
    const res = await POST(req({ password: 'test-password' }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('admin_session=');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('503 при незаданном WEB_AUTH_SECRET (fail-closed)', async () => {
    const saved = process.env.WEB_AUTH_SECRET;
    delete process.env.WEB_AUTH_SECRET;
    try {
      expect((await POST(req({ password: 'test-password' }))).status).toBe(503);
    } finally {
      restoreEnv('WEB_AUTH_SECRET', saved);
    }
  });

  it('429 после порога: Retry-After 900', async () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect((await POST(req({ password: 'wrong' }))).status).toBe(401);
    }
    const res = await POST(req({ password: 'test-password' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('900');
  });

  it('окно rate-limit общее с /api/mobile/login', async () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      const failed = await mobilePOST(req({ password: 'wrong' }, '/api/mobile/login'));
      expect(failed.status).toBe(401);
    }
    expect((await POST(req({ password: 'test-password' }))).status).toBe(429);
  });
});
