// /api/workspace/projects/[id] — PATCH (обновить/архивировать) и DELETE проект.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { workspaceProjectPatchSchema } from '../../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../../lib/server/http';
import { getWorkspaceDb, withDb } from '../../../../../lib/server/db';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) return jsonError('invalid id', 400);

  const parsed = workspaceProjectPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  try {
    const ok = await withDb(() => getWorkspaceDb().updateProject(projectId, parsed.data));
    if (!ok) return jsonError('project not found', 404);
    return jsonOk({});
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'update failed'), 400);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) return jsonError('invalid id', 400);
  const ok = await withDb(() => getWorkspaceDb().deleteProject(projectId));
  if (!ok) return jsonError('project not found', 404);
  return jsonOk({});
}
