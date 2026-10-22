// /api/blog/posts — список постов (день 28, web P4a; ТЗ §8.4 + TG-статус §7.3).
// GET ?limit=&blog=slug → recentPosts(limit, blogId) + tg-статус каждого поста
// (join с outbox по blog_post_id: последняя запись ok/error) + блог поста
// (мульти-блог; NULL blog_id = легаси, blog: null). server-only.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { getBlogDb, withDb } from '../../../../lib/server/db';
import { getOutboxDb } from '../../../../lib/server/outbox';
import { resolveBlog } from '../../../../lib/server/blogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface PostTgStatus {
  status: 'ok' | 'error';
  messageId: number | null;
  createdAt: string;
  error: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const raw = req.nextUrl.searchParams.get('limit');
  const parsed = Number(raw ?? '20');
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed) || 20, 1), 100) : 20;

  const blogRef = req.nextUrl.searchParams.get('blog');
  let blogId: number | null | undefined;
  if (blogRef) {
    const res = resolveBlog(blogRef);
    if (!res.blog) return NextResponse.json({ error: res.error ?? 'blog not found' }, { status: 400 });
    blogId = res.blog.id;
  }

  const posts = await withDb(() => {
    const db = getBlogDb();
    const blogs = new Map(db.listBlogs().map((b) => [b.id, { id: b.id, slug: b.slug, name: b.name }]));
    const rows = db.recentPosts(limit, blogId);
    const outbox = getOutboxDb();
    return rows.map((p) => {
      const tg = outbox.latestForPost(p.id);
      return {
        ...p,
        blog: p.blog_id !== null ? (blogs.get(p.blog_id) ?? null) : null,
        tg: tg
          ? {
              status: tg.status,
              messageId: tg.message_id,
              createdAt: tg.created_at,
              error: tg.error,
            }
          : null,
      };
    });
  });
  return NextResponse.json({ posts });
}
