// Unit: POST /api/rag/index — второй auth-слой (requireAuth) на мутирующем
// reindex rag.sqlite (унификация с /api/rag/index-tg). db/challenge мокаются;
// auth — реальный (HMAC-cookie на тестовых env).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

vi.mock('../../lib/server/db', () => ({
  getRagStore: vi.fn(),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  runIndexing: vi.fn(),
  DATA_DIR: 'test-data-dir',
}));

let POST: (req: NextRequest) => Promise<Response>;
let runIndexing: ReturnType<typeof vi.fn>;

// vi.mock должен примениться ДО импорта route (hoisting vitest) — статический
// импорт route импортировал бы реальные db/challenge. Канонический паттерн
// digest-generate.spec.ts / AGENTS.md §9.4.
beforeAll(async () => {
  const mod = await import('../../app/api/rag/index/route');
  POST = mod.POST;
  const challenge = await import('../../lib/server/challenge');
  runIndexing = vi.mocked(challenge.runIndexing) as unknown as ReturnType<typeof vi.fn>;
});

function req(body: unknown, cookie?: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/rag/index', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rag/index', () => {
  it('без cookie → 401 (второй auth-слой), reindex не запускается', async () => {
    const res = await POST(req({ strategies: ['fixed'] }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
    expect(runIndexing).not.toHaveBeenCalled();
  });

  it('с невалидной cookie → 401', async () => {
    const res = await POST(req({ strategies: ['fixed'] }, 'admin_session=999.deadbeef'));
    expect(res.status).toBe(401);
    expect(runIndexing).not.toHaveBeenCalled();
  });
});
