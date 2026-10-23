// /api/integrations/webhooks/[id] — удаление подписки.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../../lib/auth';
import { jsonOk, jsonError } from '../../../../../lib/server/http';
import { getWebhookDb, withDb } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const webhookId = Number(id);
  if (!Number.isInteger(webhookId) || webhookId <= 0) return jsonError('invalid id', 400);
  const ok = await withDb(() => getWebhookDb().delete(webhookId));
  if (!ok) return jsonError('webhook not found', 404);
  return jsonOk({});
}
