// /api/blog/style — образцы стиля для блог-pipeline (день 28, web P4a).
// GET ?blog=slug → styleSamples(50, blogId). POST {text, blog?} → addStyleSample
// (false при UNIQUE-конфликте). Без blog → легаси-общий пул (blog_id NULL).
// server-only: core/ (BlogDb) через chokepoint.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { styleSampleSchema } from '../../../../lib/shared/forms';
import { getBlogDb, withDb } from '../../../../lib/server/db';
import { resolveBlog } from '../../../../lib/server/blogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const blogRef = req.nextUrl.searchParams.get('blog');
  let blogId: number | undefined;
  if (blogRef) {
    const res = resolveBlog(blogRef);
    if (!res.blog) return NextResponse.json({ error: res.error ?? 'blog not found' }, { status: 400 });
    blogId = res.blog.id;
  }
  const samples = await withDb(() => getBlogDb().styleSamples(50, blogId));
  return NextResponse.json({ samples });
}

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = styleSampleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  let blogId: number | undefined;
  if (parsed.data.blog) {
    const res = resolveBlog(parsed.data.blog);
    if (!res.blog) return NextResponse.json({ error: res.error ?? 'blog not found' }, { status: 400 });
    blogId = res.blog.id;
  }
  // addStyleSample возвращает false при UNIQUE-конфликте — не ошибка, а дубликат.
  const added = await withDb(() => getBlogDb().addStyleSample(parsed.data.text, blogId));
  return NextResponse.json({ ok: added, duplicated: !added }, { status: added ? 201 : 200 });
}
