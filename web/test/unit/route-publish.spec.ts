// Unit: Route Handler POST /api/telegram/publish — второй auth-слой (requireAuth),
// zod-схема, rate-limit на сессию, делегирование в publishToTelegram.
// tg-publish мокается; auth — реальный (HMAC-cookie на тестовых env).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

vi.mock('../../lib/server/tg-publish', () => ({
  publishToTelegram: vi.fn(),
  tgPublishResponse: vi.fn(),
  tgRateLimit: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  award: vi.fn(),
  // Типизированная сигнатура: payload уведомления читается из mock.calls без cast.
  notifyAdd: vi.fn<(input: { type: string; title: string; body: string; href: string }) => number>(),
  deliverEvent: vi.fn(),
}));

vi.mock('../../lib/server/db', () => ({
  getGamificationDb: vi.fn(() => ({ award: mocks.award })),
  getNotificationDb: vi.fn(() => ({ add: mocks.notifyAdd })),
  getWebhookDb: vi.fn(() => ({})),
  withDb: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../../lib/server/challenge', () => ({
  deliverEvent: mocks.deliverEvent,
}));

let POST: (req: NextRequest) => Promise<Response>;
let createSessionValue: () => string;
let publishToTelegram: ReturnType<typeof vi.fn>;
let tgPublishResponse: ReturnType<typeof vi.fn>;
let tgRateLimit: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('../../app/api/telegram/publish/route');
  POST = mod.POST;
  const auth = await import('../../lib/auth');
  createSessionValue = auth.createSessionValue;
  const tg = await import('../../lib/server/tg-publish');
  publishToTelegram = vi.mocked(tg.publishToTelegram);
  tgPublishResponse = vi.mocked(tg.tgPublishResponse);
  tgRateLimit = vi.mocked(tg.tgRateLimit);
});

beforeEach(() => {
  publishToTelegram.mockReset();
  tgPublishResponse.mockReset().mockImplementation(
    (outcome: { ok: boolean; messageId?: number }) =>
      new Response(JSON.stringify(outcome), { status: outcome.ok ? 200 : 502 }),
  );
  tgRateLimit.mockReset().mockReturnValue({ ok: true });
  mocks.award.mockReset();
  mocks.notifyAdd.mockReset();
  mocks.deliverEvent.mockReset();
});

function req(body: unknown, cookie?: string): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/telegram/publish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/telegram/publish', () => {
  it('без cookie → 401 JSON (второй auth-слой, даже если middleware пропустил)', async () => {
    const res = await POST(req({ text: 'привет' }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('с невалидной cookie → 401', async () => {
    const res = await POST(req({ text: 'привет' }, 'admin_session=999.deadbeef'));
    expect(res.status).toBe(401);
  });

  it('пустой текст → 400 zod-валидация (до publish)', async () => {
    const res = await POST(req({ text: '   ' }, `admin_session=${createSessionValue()}`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Текст обязателен');
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('валидный запрос → publishToTelegram("manual", HTML) → tgPublishResponse', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 42 });
    const res = await POST(req({ text: '<b>привет</b>' }, `admin_session=${createSessionValue()}`));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, messageId: 42 });
    expect(publishToTelegram).toHaveBeenCalledWith('<b>привет</b>', 'manual', undefined, 'HTML');
  });

  it('уведомление post_published: тело — чистый текст без HTML-тегов', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 7 });
    const res = await POST(
      req(
        { text: '<b>привет</b> <a href="https://t.me/ch">x</a>' },
        `admin_session=${createSessionValue()}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(mocks.notifyAdd).toHaveBeenCalledTimes(1);
    expect(mocks.notifyAdd).toHaveBeenCalledWith({
      type: 'post_published',
      title: 'Пост опубликован',
      body: 'привет x',
      href: '/telegram/history',
    });
    expect(mocks.award).toHaveBeenCalledWith('post_published');
    expect(mocks.deliverEvent).toHaveBeenCalledWith(
      expect.anything(),
      'post_published',
      { text: '<b>привет</b> <a href="https://t.me/ch">x</a>' },
    );
  });

  it('уведомление post_published: длинное тело капится 160 символами и без разметки', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 8 });
    const text = `<i>${'слово '.repeat(60)}</i>`;
    const res = await POST(req({ text }, `admin_session=${createSessionValue()}`));

    expect(res.status).toBe(200);
    const added = mocks.notifyAdd.mock.calls[0][0];
    expect(added.body).not.toContain('<');
    expect(added.body.length).toBeLessThanOrEqual(160);
  });

  it('уведомление post_published: кап ровно 160 — границы 160/161, тело = точный префикс', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 9 });
    const session = `admin_session=${createSessionValue()}`;

    const exactly160 = 'а'.repeat(160);
    await POST(req({ text: `<b>${exactly160}</b>` }, session));
    const added160 = mocks.notifyAdd.mock.calls[0][0];
    expect(added160.body).toBe(exactly160);
    expect(added160.body.length).toBe(160);

    mocks.notifyAdd.mockClear();
    const plain161 = 'а'.repeat(161);
    await POST(req({ text: `<b>${plain161}</b>` }, session));
    const added161 = mocks.notifyAdd.mock.calls[0][0];
    expect(added161.body).toBe(plain161.slice(0, 160));
    expect(added161.body.length).toBe(160);
  });

  it('уведомление post_published: strip до slice — тег на границе 160 не оставляет обломков', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 11 });
    // Тег <b> пересекает позицию 160 сырой строки: при slice→strip в теле остался бы '<b'.
    const text = `${'а'.repeat(158)}<b>хвост</b>`;
    const res = await POST(req({ text }, `admin_session=${createSessionValue()}`));

    expect(res.status).toBe(200);
    const added = mocks.notifyAdd.mock.calls[0][0];
    expect(added.body).toBe(`${'а'.repeat(158)}хв`);
    expect(added.body).not.toContain('<');
    expect(added.body).not.toContain('<b');
  });

  it('уведомление post_published: вложенные теги и сущности разворачиваются', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 12 });
    const session = `admin_session=${createSessionValue()}`;

    await POST(req({ text: '<b><i>x</i></b>' }, session));
    expect(mocks.notifyAdd.mock.calls[0][0].body).toBe('x');

    mocks.notifyAdd.mockClear();
    await POST(req({ text: 'a &lt; b' }, session));
    expect(mocks.notifyAdd.mock.calls[0][0].body).toBe('a < b');
  });

  it('notification body matches Telegram-visible text for HTML and none', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 13 });
    const session = `admin_session=${createSessionValue()}`;

    await POST(req({ text: '5 < 10 > 3' }, session));
    expect(mocks.notifyAdd.mock.calls[0][0].body).toBe('5 < 10 > 3');

    mocks.notifyAdd.mockClear();
    await POST(req({ text: '<b>5 < 10 > 3</b>', parseMode: 'none' }, session));
    expect(mocks.notifyAdd.mock.calls[0][0].body).toBe('<b>5 < 10 > 3</b>');
  });

  it('parseMode none пробрасывается', async () => {
    publishToTelegram.mockResolvedValue({ ok: true, messageId: 1 });
    await POST(req({ text: 'текст', parseMode: 'none' }, `admin_session=${createSessionValue()}`));
    expect(publishToTelegram).toHaveBeenCalledWith('текст', 'manual', undefined, 'none');
  });

  it('rate-limit: превышение → 429 с retryAfter, publish не вызывается', async () => {
    tgRateLimit.mockReturnValue({ ok: false, retryAfterSec: 33 });
    const res = await POST(req({ text: 'привет' }, `admin_session=${createSessionValue()}`));

    expect(res.status).toBe(429);
    const body = (await res.json()) as { errorKind?: string; retryAfter?: number };
    expect(body.errorKind).toBe('rate-limit');
    expect(body.retryAfter).toBe(33);
    expect(publishToTelegram).not.toHaveBeenCalled();
  });

  it('не-JSON тело → 400 схемы', async () => {
    const res = await POST(
      new NextRequest('http://127.0.0.1:3000/api/telegram/publish', {
        method: 'POST',
        headers: { cookie: `admin_session=${createSessionValue()}` },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });
});
