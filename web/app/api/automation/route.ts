// /api/automation — правила автоматизации блогов (GET) + configure/run (POST).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../lib/auth';
import { automationConfigureSchema, automationRunSchema } from '../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../lib/server/http';
import { getBlogDb, getGamificationDb, getNotificationDb, withDb } from '../../../lib/server/db';
import { getAutomation } from '../../../lib/server/automation-service';
import { safeMessage } from '../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const data = await withDb(() => {
    const blogs = new Map(getBlogDb().listBlogs().map((b) => [b.id, b]));
    const rules = getAutomation().listRules().map((r) => {
      const blog = blogs.get(r.blog_id);
      return {
        blogId: r.blog_id,
        blogSlug: blog?.slug ?? null,
        blogName: blog?.name ?? `#${r.blog_id}`,
        stylePreset: blog?.style_preset ?? 'default',
        enabled: r.enabled === 1,
        intervalMinutes: r.interval_minutes,
        autoPublish: r.auto_publish === 1,
        lastRunAt: r.last_run_at,
        nextRunAt: r.next_run_at,
      };
    });
    const runs = getAutomation().listRuns(50).map((r) => ({
      id: r.id,
      blogId: r.blog_id,
      status: r.status,
      message: r.message,
      postId: r.post_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    }));
    return { rules, runs };
  });
  return jsonOk({ ...data });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));

  const configure = automationConfigureSchema.safeParse(body);
  if (configure.success) {
    try {
      await withDb(() =>
        getAutomation().upsertRule(configure.data.blogId, {
          enabled: configure.data.enabled,
          intervalMinutes: configure.data.intervalMinutes,
          autoPublish: configure.data.autoPublish,
        }),
      );
      return jsonOk({});
    } catch (e) {
      return jsonError(safeMessage(e instanceof Error ? e.message : 'configure failed'), 400);
    }
  }

  const run = automationRunSchema.safeParse(body);
  if (!run.success) return jsonError(run.error.issues[0]?.message ?? 'invalid request', 400);
  try {
    const result = await withDb(() => getAutomation().runNow(run.data.blogId));
    // Геймификация + уведомление — реальные события прогона.
    await withDb(() => {
      getGamificationDb().award('automation_run', String(run.data.blogId));
      getNotificationDb().add({
        type: 'automation',
        title: result.status === 'success' ? 'Автоматизация: успех' : 'Автоматизация: ошибка',
        body: result.message,
        href: '/automation',
      });
    });
    if (result.status === 'error') return jsonOk({ status: result.status, message: result.message });
    return jsonOk({ status: result.status, message: result.message });
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'run failed'), 500);
  }
}
