// /api/course/lessons/[slug] — урок целиком: метаданные + таймкодс-секции +
// курируемые выдержки. 404 — slug не найден.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { jsonError } from '../../../../../lib/server/http';
import { getCourseDb, withDb } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(_req);
  if (denied) return denied;
  const { slug } = await ctx.params;
  const data = await withDb(() => {
    const db = getCourseDb();
    const lesson = db.getLesson(slug);
    if (!lesson) return null;
    return {
      lesson: {
        slug: lesson.slug,
        title: lesson.title,
        kind: lesson.kind,
        weekNo: lesson.weekNo,
        durationMs: lesson.durationMs,
        summary: lesson.summary,
        why: lesson.why,
        pain: lesson.pain,
      },
      sections: db.getSections(lesson.id).map((s) => ({
        idx: s.idx,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
      })),
      excerpts: db.getExcerpts(lesson.id).map((e) => ({
        idx: e.idx,
        quote: e.quote,
        explanation: e.explanation,
      })),
    };
  });
  if (!data) return jsonError('урок не найден', 404);
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
