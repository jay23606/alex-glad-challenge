// Unit: Route Handler GET /api/support/faq — поиск по FAQ-корпусу (?q=).
// Auth реальный; chokepoint замокан до одного экспорта searchFaq (иначе route
// тянул бы весь тяжёлый баррель core в воркер). Это мок границы, не роута.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

const mocks = vi.hoisted(() => ({
  searchFaq: vi.fn(),
}));

vi.mock('../../lib/server/challenge', () => ({
  searchFaq: mocks.searchFaq,
}));

let GET: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;

beforeAll(async () => {
  ({ GET } = await import('../../app/api/support/faq/route'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

beforeEach(() => {
  mocks.searchFaq.mockReset().mockReturnValue([
    { question: 'Как сбросить пароль?', answer: 'Через .env', score: 0.87 },
  ]);
});

function req(url: string, withAuth = true): NextRequest {
  return new NextRequest(url, {
    headers: withAuth ? { cookie: `admin_session=${createSessionValue()}` } : {},
  });
}

describe('GET /api/support/faq', () => {
  it('без сессии → 401, поиск не вызывается', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/support/faq?q=test', false));
    expect(res.status).toBe(401);
    expect(mocks.searchFaq).not.toHaveBeenCalled();
  });

  it('без q → пустой results, searchFaq не вызывается', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/support/faq'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, results: [] });
    expect(mocks.searchFaq).not.toHaveBeenCalled();
  });

  it('q → results в форме {question, answer, score}; q trim’ится', async () => {
    const res = await GET(req('http://127.0.0.1:3000/api/support/faq?q=%20%D1%81%D0%B1%D1%80%D0%BE%D1%81%20'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      results: [{ question: 'Как сбросить пароль?', answer: 'Через .env', score: 0.87 }],
    });
    expect(mocks.searchFaq).toHaveBeenCalledWith('сброс');
  });

  it('q длиннее 500 символов обрезается до 500', async () => {
    const long = 'а'.repeat(600);
    const res = await GET(
      req(`http://127.0.0.1:3000/api/support/faq?q=${encodeURIComponent(long)}`),
    );
    expect(res.status).toBe(200);
    expect(mocks.searchFaq).toHaveBeenCalledWith('а'.repeat(500));
  });
});
