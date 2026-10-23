// /api/integrations/webhooks — список/создание исходящих webhook-подписок.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { webhookSchema } from '../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../lib/server/http';
import { getWebhookDb, withDb } from '../../../../lib/server/db';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function shape(h: { id: number; name: string; url: string; secret: string; events: string; enabled: number; created_at: string }) {
  let events: string[] = [];
  try {
    const parsed = JSON.parse(h.events) as unknown;
    if (Array.isArray(parsed)) events = parsed.map(String);
  } catch {
    events = [];
  }
  return {
    id: h.id,
    name: h.name,
    url: h.url,
    hasSecret: h.secret.length > 0,
    events,
    enabled: h.enabled === 1,
    createdAt: h.created_at,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const rows = await withDb(() => getWebhookDb().list().map(shape));
  const deliveries = await withDb(() =>
    getWebhookDb().listDeliveries(50).map((d) => ({
      id: d.id,
      webhookId: d.webhook_id,
      event: d.event,
      status: d.status,
      responseCode: d.response_code,
      error: d.error,
      createdAt: d.created_at,
    })),
  );
  return jsonOk({ webhooks: rows, deliveries });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const parsed = webhookSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  try {
    const id = await withDb(() => getWebhookDb().create(parsed.data));
    return jsonOk({ id }, 201);
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'create failed'), 400);
  }
}
