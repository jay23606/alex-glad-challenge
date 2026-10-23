// /api/workspace/items — список (GET ?projectId/kind/includeDone) и создание (POST).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { workspaceItemSchema } from '../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../lib/server/http';
import { getWorkspaceDb, getGamificationDb, withDb } from '../../../../lib/server/db';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function itemShape(r: {
  id: number; project_id: number; folder_id: number | null; kind: string; title: string;
  body: string; url: string | null; due_at: string | null; done: number; created_at: string; updated_at: string;
}) {
  return {
    id: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    url: r.url,
    dueAt: r.due_at,
    done: r.done === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get('projectId') ? Number(sp.get('projectId')) : undefined;
  const kind = sp.get('kind') as 'note' | 'task' | 'link' | null;
  const includeDone = sp.get('includeDone') === '1';
  const rows = await withDb(() =>
    getWorkspaceDb().listItems({
      projectId: projectId && Number.isInteger(projectId) ? projectId : undefined,
      kind: kind ?? undefined,
      includeDone,
    }),
  );
  return jsonOk({ items: rows.map(itemShape) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const parsed = workspaceItemSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  try {
    const id = await withDb(() => getWorkspaceDb().createItem(parsed.data));
    // Геймификация: создание элемента — реальное действие.
    await withDb(() => getGamificationDb().award('workspace_item', String(id)));
    return jsonOk({ id }, 201);
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'create failed'), 400);
  }
}
