// /api/blog/posts/[id]/publish — публикация поста в Telegram-канал (ТЗ §7.3).
// POST → реальная отправка через единый helper publishToTelegram('blog', id)
// [гейт TG-env → chokepoint publishPost → outbox → карта ошибок §7.4].
// requireAuth — второй auth-слой (реальный внешний эффект). server-only.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { getBlogDb, withDb } from '../../../../../../lib/server/db';
import { requireAuth } from '../../../../../../lib/auth';
import { publishToTelegram, tgPublishResponse } from '../../../../../../lib/server/tg-publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = requireAuth(_req);
  if (denied) return denied;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const post = await withDb(() => getBlogDb().getPost(id));
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Мульти-блог: пост уходит в TG-чат своего блога (blogs.tg_chat_id),
  // без него — в общий канал из TG_CHAT_ID (fallback внутри publishPost).
  const blog =
    post.blog_id !== null ? await withDb(() => getBlogDb().getBlog(post.blog_id!)) : null;

  const outcome = await publishToTelegram(post.content, 'blog', id, 'HTML', blog?.tg_chat_id ?? undefined);
  return tgPublishResponse(outcome);
}
