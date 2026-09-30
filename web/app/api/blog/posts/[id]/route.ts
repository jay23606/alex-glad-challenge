// /api/blog/posts/[id] — детали поста (день 28, web P4a).
// GET → getPost(id). PATCH {content} → updatePostContent. DELETE → deletePost.
// Next 15: params — Promise. server-only: core/ через chokepoint.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { postUpdateSchema } from '../../../../../lib/shared/forms';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import { getOutboxDb } from '../../../../../lib/server/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(idStr: string): number | null {
  const id = Number(idStr);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const data = await withDb(() => {
    const db = getBlogDb();
    const post = db.getPost(id);
    if (!post) return null;
    const blog =
      post.blog_id !== null
        ? (() => {
            const b = db.getBlog(post.blog_id);
            return b ? { id: b.id, slug: b.slug, name: b.name, tgChatId: b.tg_chat_id } : null;
          })()
        : null;
    return { post, blog };
  });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const tg = await withDb(() => getOutboxDb().latestForPost(id));
  return NextResponse.json({
    post: data.post,
    blog: data.blog,
    tg: tg
      ? {
          status: tg.status,
          messageId: tg.message_id,
          createdAt: tg.created_at,
          error: tg.error,
        }
      : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const parsed = postUpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const updated = await withDb(() => {
    const db = getBlogDb();
    if (!db.getPost(id)) return null;
    db.updatePostContent(id, parsed.data.content);
    return db.getPost(id);
  });
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, post: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const changed = await withDb(() => getBlogDb().deletePost(id));
  if (!changed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
