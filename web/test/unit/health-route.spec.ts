// Unit: GET /api/health — публичный health-check (в PUBLIC_PATHS, гость без cookie).
import { beforeAll, describe, expect, it } from 'vitest';

import pkg from '../../../package.json';

let GET: () => Promise<Response>;

// server-only в route разрешён vitest-конфигом; моков не нужно — route чистый.
beforeAll(async () => {
  ({ GET } = await import('../../app/api/health/route'));
});

describe('GET /api/health', () => {
  it('отдаёт ok/uptimeS/version и no-store, без секретов', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { ok: boolean; uptimeS: number; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.uptimeS).toBe('number');
    expect(body.uptimeS).toBeGreaterThanOrEqual(0);
    expect(body.version).toBe(pkg.version);
    // наружу не утекает ничего, кроме трёх объявленных полей
    expect(Object.keys(body).sort()).toEqual(['ok', 'uptimeS', 'version']);
  });
});
