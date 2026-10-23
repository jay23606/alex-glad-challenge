// /api/workspace/items/[id] — PATCH (toggle done/rename) и DELETE элемента.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { workspaceItemPatchSchema } from '../../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../../lib/server/http';
import { getWorkspaceDb, getGamificationDb, withDb } from '../../../../../lib/server/db';
import { safeMessage } from '../../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) return jsonError('invalid id', 400);

  const parsed = workspaceItemPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);

  const { id: _ignored, ...patch } = parsed.data;
  try {
    const ok = await withDb(() => getWorkspaceDb().updateItem(itemId, patch));
    if (!ok) return jsonError('item not found', 404);
    // Выполнение задачи — реальное действие → XP.
    if (patch.done === true) {
      await withDb(() => getGamificationDb().award('todo_completed', String(itemId)));
    }
    return jsonOk({});
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'update failed'), 400);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) return jsonError('invalid id', 400);
  const ok = await withDb(() => getWorkspaceDb().deleteItem(itemId));
  if (!ok) return jsonError('item not found', 404);
  return jsonOk({});
}
