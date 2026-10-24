// Route Handler: /api/telegram/publish — отправка текста в TG-канал (Bot API, ТЗ §7.1).
// POST → реальная отправка. Путь: requireAuth (второй слой) → rate-limit (10/мин на
// сессию) → tgPublishToTelegram('manual') [гейт TG-env → chokepoint publishPost →
// outbox → карта ошибок §7.4]. server-only.
import 'server-only';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

import { tgPublishSchema } from '../../../../lib/shared/forms';
import { tgHtmlToPlain } from '../../../../lib/shared/tg-html';
import { requireAuth, SESSION_COOKIE } from '../../../../lib/auth';
import { publishToTelegram, tgPublishResponse, tgRateLimit } from '../../../../lib/server/tg-publish';
import { getGamificationDb, getNotificationDb, getWebhookDb, withDb } from '../../../../lib/server/db';
import { deliverEvent } from '../../../../lib/server/challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  // Второй auth-слой: реальный внешний эффект — ошибка в middleware-matcher
  // не должна открывать отправку в TG-канал.
  const denied = requireAuth(req);
  if (denied) return denied;

  const sessionKey = createHash('sha256')
    .update(req.cookies.get(SESSION_COOKIE)?.value ?? '')
    .digest('hex')
    .slice(0, 16);
  const rl = tgRateLimit(sessionKey);
  if (!rl.ok) {
    return Response.json(
      {
        ok: false,
        error: `Слишком много отправок. Подождите ${rl.retryAfterSec ?? '?'} с`,
        errorKind: 'rate-limit',
        ...(rl.retryAfterSec !== undefined ? { retryAfter: rl.retryAfterSec } : {}),
      },
      { status: 429 },
    );
  }

  const parsed = tgPublishSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }

  const outcome = await publishToTelegram(
    parsed.data.text,
    'manual',
    undefined,
    parsed.data.parseMode ?? 'HTML',
  );
  if (outcome.ok) {
    await withDb(() => {
      getGamificationDb().award('post_published');
      getNotificationDb().add({
        type: 'post_published',
        title: 'Пост опубликован',
        // Тело уведомления — чистый текст: composer присылает TG-HTML, сырую
        // разметку в /notifications не показываем (кап 160).
        body: tgHtmlToPlain(parsed.data.text).slice(0, 160),
        href: '/telegram/history',
      });
    });
    // Webhook-payload сознательно raw: machine-потребителям интеграций нужен полный HTML.
    void deliverEvent(getWebhookDb(), 'post_published', { text: parsed.data.text });
  }
  return tgPublishResponse(outcome);
}
