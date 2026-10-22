// Unit: Route Handler POST /api/tokens/estimate — оценка токенов диалога
// (эвристика core TokenEstimator: UTF-8 байты / 4, без LLM). Контракт:
// 200 {total, messages[], budget, remaining, fits} / 400 (zod/не-JSON).
// Бюджет опционален: не задан → budget/remaining = null, fits = true.
// Chokepoint подменяется реальным чистым модулем core (tokenEstimator) —
// тяжёлый граф core (telegram/БД) в тест не тянется.
//
// Динамические import() ниже обязательны: vi.mock поднимается хойстингом
// наверх файла, поэтому реальный импорт роута возможен только ПОСЛЕ
// применения моков — в beforeAll; фабрика vi.mock тоже асинхронная
// (конвенция остальных route-спеков этого репозитория).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../lib/server/challenge', async () => {
  const { TokenEstimator } = await import('@challenge/core/tokenEstimator');
  return { TokenEstimator };
});

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  const mod = await import('../../app/api/tokens/estimate/route');
  POST = mod.POST;
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/tokens/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function rawReq(body: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/tokens/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/tokens/estimate', () => {
  it('200: total + разбивка по сообщениям + бюджет (ASCII и кириллица)', async () => {
    const res = await POST(
      req({
        messages: [
          { role: 'user', content: 'hello' }, // 5 байт → 2
          { role: 'assistant', content: 'привет' }, // 12 байт → 3
        ],
        budget: 10,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({
      total: 5,
      budget: 10,
      remaining: 5,
      fits: true,
      messages: [
        { index: 0, role: 'user', bytes: 5, tokens: 2 },
        { index: 1, role: 'assistant', bytes: 12, tokens: 3 },
      ],
    });
  });

  it('200: total > budget → fits false, remaining отрицательный', async () => {
    const res = await POST(
      req({
        messages: [{ role: 'user', content: 'hello world' }], // 11 байт → 3
        budget: 2,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; remaining: number; fits: boolean };
    expect(body.total).toBe(3);
    expect(body.remaining).toBe(-1);
    expect(body.fits).toBe(false);
  });

  it('200: total == budget — граница, fits true и remaining 0', async () => {
    const res = await POST(
      req({
        messages: [{ role: 'user', content: 'abcd' }], // 4 байта → 1
        budget: 1,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { remaining: number; fits: boolean };
    expect(body.remaining).toBe(0);
    expect(body.fits).toBe(true);
  });

  it('200: без бюджета — budget/remaining null, fits true', async () => {
    const res = await POST(req({ messages: [{ role: 'system', content: 'ok' }] }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      total: 1,
      budget: null,
      remaining: null,
      fits: true,
      messages: [{ index: 0, role: 'system', bytes: 2, tokens: 1 }],
    });
  });

  it('200: пустой диалог — total 0 и пустая разбивка', async () => {
    const res = await POST(req({ messages: [], budget: 100 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; messages: unknown[]; remaining: number };
    expect(body.total).toBe(0);
    expect(body.messages).toEqual([]);
    expect(body.remaining).toBe(100);
  });

  it('400: неизвестная роль (enum)', async () => {
    const res = await POST(req({ messages: [{ role: 'tool', content: 'x' }] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('400: messages отсутствует / не массив', async () => {
    for (const body of [{}, { messages: 'nope' }]) {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
    }
  });

  it('400: content длиннее 8000 и messages больше 200', async () => {
    const long = await POST(
      req({ messages: [{ role: 'user', content: 'x'.repeat(8001) }] }),
    );
    expect(long.status).toBe(400);

    const many = await POST(
      req({
        messages: Array.from({ length: 201 }, () => ({ role: 'user', content: 'hi' })),
      }),
    );
    expect(many.status).toBe(400);
  });

  it('400: budget отрицательный / дробный / не число', async () => {
    for (const budget of [-1, 1.5, '10']) {
      const res = await POST(req({ messages: [{ role: 'user', content: 'ok' }], budget }));
      expect(res.status).toBe(400);
    }
  });

  it('400: не-JSON тело', async () => {
    const res = await POST(rawReq('not json'));
    expect(res.status).toBe(400);
  });
});
