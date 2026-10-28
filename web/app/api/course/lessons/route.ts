// /api/course/lessons — список уроков курса (GET): метаданные без полного текста.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { jsonOk } from '../../../../lib/server/http';
import { getCourseDb, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const lessons = await withDb(() =>
    getCourseDb()
      .listLessons()
      .map((l) => ({
        slug: l.slug,
        title: l.title,
        kind: l.kind,
        weekNo: l.weekNo,
        durationMs: l.durationMs,
        summary: l.summary,
        why: l.why,
        pain: l.pain,
      })),
  );
  return jsonOk({ lessons });
}
