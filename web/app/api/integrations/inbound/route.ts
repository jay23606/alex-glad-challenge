// /api/integrations/inbound — управление входящими webhook-хуками.
// GET — список без секретов; POST — создать (секрет возвращается один раз в ответе).
// Секрет хранится в БД; наружу из списка уходит только hasSecret-флаг не нужен —
// секрет не отдаём вообще (он известен владельцу с момента создания).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { inboundHookCreateSchema } from '../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../lib/server/http';
import { getInboundHookDb, withDb } from '../../../../lib/server/db';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const hooks = await withDb(() =>
    getInboundHookDb()
      .list()
      .map((h) => ({
        id: h.id,
        name: h.name,
        target: h.target,
        url: `/api/integrations/inbound/${h.id}`,
        createdAt: h.created_at,
      })),
  );
  return jsonOk({ hooks });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const parsed = inboundHookCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  try {
    const created = await withDb(() => getInboundHookDb().create(parsed.data));
    // Секрет показывается один раз — в ответе на создание; list() его не отдаёт.
    return jsonOk(
      { id: created.id, secret: created.secret, url: `/api/integrations/inbound/${created.id}` },
      201,
    );
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'create failed'), 400);
  }
}
