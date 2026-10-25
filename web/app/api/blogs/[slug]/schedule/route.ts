// /api/blogs/[slug]/schedule — недельное расписание постов блога.
// GET → {blog, schedules, runs}; PUT {entries:[...]} → полная замена (PUT-семантика).
// Слоты хранятся в schedule.sqlite (core BlogScheduleStore); due-слоты выполняет
// instrumentation-runner тем же тиком, что и интервальная автоматизация.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { blogScheduleSchema } from '../../../../../lib/shared/forms';
import { getBlogScheduleStore } from '../../../../../lib/server/blog-schedule-service';
import { getBlogDb, withDb } from '../../../../../lib/server/db';
import { jsonError, jsonOk } from '../../../../../lib/server/http';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScheduleDto {
  id: number;
  dayOfWeek: number;
  timeLocal: string;
  timezone: string;
  topic: string;
  variants: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function toDto(r: {
  id: number;
  day_of_week: number;
  time_local: string;
  timezone: string;
  topic: string;
  variants: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}): ScheduleDto {
  return {
    id: r.id,
    dayOfWeek: r.day_of_week,
    timeLocal: r.time_local,
    timezone: r.timezone,
    topic: r.topic,
    variants: r.variants,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const data = await withDb(() => {
    const blog = getBlogDb().getBlogBySlug(slug);
    if (!blog) return null;
    const store = getBlogScheduleStore();
    return {
      blog: { id: blog.id, slug: blog.slug, name: blog.name },
      schedules: store.list(blog.id).map(toDto),
      runs: store
        .listRuns(50)
        .filter((r) => r.blog_id === blog.id)
        .slice(0, 10)
        .map((r) => ({
          id: r.id,
          scheduleId: r.schedule_id,
          status: r.status,
          attempts: r.attempts,
          postId: r.post_id,
          message: r.message,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
        })),
    };
  });
  if (!data) return jsonError('not found', 404);
  return jsonOk({ ...data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;

  const { slug } = await params;
  const parsed = blogScheduleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  }

  try {
    const rows = await withDb(() => {
      const blog = getBlogDb().getBlogBySlug(slug);
      if (!blog) return null;
      return getBlogScheduleStore().replaceForBlog(blog.id, parsed.data.entries);
    });
    if (!rows) return jsonError('not found', 404);
    return jsonOk({ schedules: rows.map(toDto) });
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'schedule save failed'), 400);
  }
}
