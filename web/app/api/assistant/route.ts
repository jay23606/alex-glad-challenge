// /api/assistant — ИИ-помощник: отвечает на вопрос с контекстом состояния продукта.
// LLM не настроен → 503 с честным сообщением (не выдумываем ответ).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../lib/auth';
import { assistantSchema } from '../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../lib/server/http';
import {
  getBlogDb,
  getGamificationDb,
  getNotificationDb,
  getWorkspaceDb,
  getTodoDb,
  withDb,
} from '../../../lib/server/db';
import { getAutomation } from '../../../lib/server/automation-service';
import { pickLlmClient } from '../../../lib/server/llm';
import { buildAssistantMessages } from '../../../lib/server/challenge';
import type { AssistantSnapshot } from '../../../lib/server/challenge';
import { safeMessage } from '../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const parsed = assistantSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);

  let client;
  try {
    client = pickLlmClient('cloud');
  } catch {
    return jsonError('LLM не настроен — задайте DEEPSEEK_API_KEY или локальную модель', 503);
  }

  const snapshot = await withDb(() => buildSnapshot());
  const messages = buildAssistantMessages(snapshot, parsed.data.message);
  try {
    const answer = await client.chat(messages, { temperature: 0.3, maxTokens: 800 });
    await withDb(() => getGamificationDb().award('assistant_used'));
    return jsonOk({ answer: answer.trim() });
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'assistant failed'), 502);
  }
}

function buildSnapshot(): AssistantSnapshot {
  const workspace = getWorkspaceDb();
  const gamification = getGamificationDb();
  const notifications = getNotificationDb();
  const blogs = new Map(getBlogDb().listBlogs().map((b) => [b.id, b]));
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 86_400_000).toISOString();

  const projects = workspace.listProjects('active').map((p) => ({
    name: p.name,
    openTasks: workspace.listItems({ projectId: p.id, kind: 'task' }).length,
  }));

  const automation = getAutomation().listRules().map((r) => ({
    blogName: blogs.get(r.blog_id)?.name ?? `#${r.blog_id}`,
    enabled: r.enabled === 1,
    intervalMinutes: r.interval_minutes,
    autoPublish: r.auto_publish === 1,
  }));

  const stats = gamification.getStats();
  return {
    projects,
    dueTasks: workspace.listUpcoming(now.toISOString(), soon).length + getTodoDb().getDueTodos().length,
    unreadNotifications: notifications.unreadCount(),
    automation,
    xp: stats.xp,
    level: stats.level,
  };
}
