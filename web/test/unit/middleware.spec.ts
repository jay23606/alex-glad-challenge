// Unit: middleware (web/middleware.ts) — CSP-nonce + admin-auth гейт (day 36).
// Фокус #64: bypass POST /api/integrations/inbound/<id> (T7 — приём внешних
// webhooks БЕЗ сессии) открывает только POST на конкретный числовой id;
// управление хуками (GET/POST без id, DELETE) и прочие /api/* остаются за
// session-auth. middleware() вызывается напрямую с NextRequest (по образцу
// route-спеков); auth-математика реальная (HMAC на тестовых env), моков нет.
import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

let middleware: (request: NextRequest) => NextResponse;
let createSessionValue: () => string;

beforeAll(async () => {
  // Динамический импорт осознанный: lib/auth читает env на загрузке модуля
  // (loadEnvUpward) — env-строки выше обязаны выполниться раньше импорта.
  ({ middleware } = await import('../../middleware'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

function req(path: string, init?: { method?: string; cookie?: string }): NextRequest {
  const headers = new Headers({ host: 'localhost:3000' });
  if (init?.cookie) headers.set('cookie', init.cookie);
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method ?? 'GET',
    headers,
  });
}

describe('middleware: bypass входящих webhooks (T7)', () => {
  it('POST /api/integrations/inbound/7 без сессии — пропускается: next() (200 + CSP, не 401/redirect)', () => {
    const res = middleware(req('/api/integrations/inbound/7', { method: 'POST' }));
    expect(res.status).toBe(200);
    // next()-ответ несёт per-request CSP-nonce — отличает пропуск от 401/redirect.
    expect(res.headers.get('content-security-policy')).toContain('script-src');
    expect(res.headers.get('location')).toBeNull();
  });

  it('GET того же пути без сессии — 401 JSON (bypass только POST)', async () => {
    const res = middleware(req('/api/integrations/inbound/7'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('POST /api/integrations/inbound (без id) — управление хуками защищено: 401', async () => {
    const res = middleware(req('/api/integrations/inbound', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('DELETE /api/integrations/inbound/7 — 401 (метод не входит в bypass)', async () => {
    const res = middleware(req('/api/integrations/inbound/7', { method: 'DELETE' }));
    expect(res.status).toBe(401);
  });

  it('POST /api/integrations/inbound/abc и .../7/extra — 401 (regex требует ровно числовой id)', async () => {
    expect(middleware(req('/api/integrations/inbound/abc', { method: 'POST' })).status).toBe(401);
    expect(middleware(req('/api/integrations/inbound/7/extra', { method: 'POST' })).status).toBe(401);
  });
});

describe('middleware: auth-гейт (контраст к bypass)', () => {
  it('обычный /api/* без сессии — 401 JSON + no-store', async () => {
    const res = middleware(req('/api/notifications'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('валидная сессия-cookie — /api/* пропускается: next() (200 + CSP)', () => {
    const res = middleware(req('/api/notifications', { cookie: `admin_session=${createSessionValue()}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain('script-src');
  });

  it('страница /dashboard без сессии — 302 на /login?next=<pathname> (query выкидывается)', () => {
    expect(middleware(req('/dashboard')).status).toBe(302);
    expect(middleware(req('/dashboard?tab=alerts')).headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Fdashboard',
    );
  });
});
