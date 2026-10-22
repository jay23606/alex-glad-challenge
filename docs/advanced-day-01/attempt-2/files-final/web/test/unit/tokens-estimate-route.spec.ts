// Unit: Route Handler POST /api/tokens/estimate — эвристика UTF-8 bytes / 4.
// Контракт: 200 {ok,total,messages:[{index,role,bytes,tokens}],budget,remaining,fits},
// 400 на zod/не-JSON. TokenEstimator — реальный core, но chokepoint замокан
// до одного экспорта: иначе route тянет весь тяжёлый баррель core (telegram/DB)
// в каждый воркер. Это мок границы, не модуля под тестом.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../lib/server/challenge', async () => {
  const { TokenEstimator } = await import('@challenge/core/tokenEstimator');
  return { TokenEstimator };
});

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('../../app/api/tokens/estimate/route'));
});

interface EstimateBody {
  ok: boolean;
  total: number;
  messages: Array<{ index: number; role: string; bytes: number; tokens: number }>;
  budget: number | null;
  remaining: number | null;
  fits: boolean;
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/tokens/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<EstimateBody> {
  return (await res.json()) as EstimateBody;
}

describe('POST /api/tokens/estimate', () => {
  it('200: total, разбивка по сообщениям, остаток и fits', async () => {
    const res = await POST(
      req({
        messages: [
          { role: 'system', content: 'rules' },
          { role: 'user', content: 'привет' },
        ],
        budget: 5,
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await bodyOf(res)).toEqual({
      ok: true,
      total: 5,
      messages: [
        { index: 0, role: 'system', bytes: 5, tokens: 2 },
        { index: 1, role: 'user', bytes: 12, tokens: 3 },
      ],
      budget: 5,
      remaining: 0,
      fits: true,
    });
  });

  it('без budget → budget/remaining null, fits=true', async () => {
    const res = await POST(req({ messages: [{ role: 'user', content: 'hello' }] }));

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.total).toBe(2);
    expect(body.budget).toBeNull();
    expect(body.remaining).toBeNull();
    expect(body.fits).toBe(true);
  });

  it('бюджет меньше total → отрицательный remaining, fits=false', async () => {
    const res = await POST(req({ messages: [{ role: 'user', content: 'hello' }], budget: 1 }));

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.total).toBe(2);
    expect(body.remaining).toBe(-1);
    expect(body.fits).toBe(false);
  });

  it('пустой список сообщений → total 0 и fits при нулевом бюджете', async () => {
    const res = await POST(req({ messages: [], budget: 0 }));

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({
      ok: true,
      total: 0,
      messages: [],
      budget: 0,
      remaining: 0,
      fits: true,
    });
  });

  it('граница 200 сообщений проходит, 201 — 400', async () => {
    const messages = Array.from({ length: 200 }, () => ({ role: 'user', content: 'a' }));
    const ok = await POST(req({ messages }));
    expect(ok.status).toBe(200);
    const body = await bodyOf(ok);
    expect(body.total).toBe(200);
    expect(body.messages).toHaveLength(200);

    const tooMany = await POST(req({ messages: [...messages, { role: 'user', content: 'a' }] }));
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({ error: 'Сообщений — не больше 200' });
  });

  it('400: неизвестная роль', async () => {
    const res = await POST(req({ messages: [{ role: 'tool', content: 'x' }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it('400: отрицательный или дробный бюджет', async () => {
    for (const budget of [-1, 1.5]) {
      const res = await POST(req({ messages: [], budget }));
      expect(res.status).toBe(400);
    }
  });

  it('400: messages не массив / отсутствует', async () => {
    expect((await POST(req({ messages: 'hello' }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
  });

  it('400: сообщение длиннее 100000 символов', async () => {
    const res = await POST(req({ messages: [{ role: 'user', content: 'a'.repeat(100_001) }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Сообщение — до 100000 символов' });
  });

  it('400: не-JSON тело', async () => {
    const res = await POST(req('not json'));
    expect(res.status).toBe(400);
  });
});
