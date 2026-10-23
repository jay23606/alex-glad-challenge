// /api/support/tickets — список обращений (GET) и создание (POST).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { supportTicketSchema } from '../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../lib/server/http';
import { getSupportDb, getGamificationDb, withDb } from '../../../../lib/server/db';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const tickets = await withDb(() =>
    getSupportDb().listTickets(50).map((t) => ({
      id: t.id,
      subject: t.subject,
      body: t.body,
      contact: t.contact,
      status: t.status,
      createdAt: t.created_at,
    })),
  );
  return jsonOk({ tickets });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const parsed = supportTicketSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  try {
    const id = await withDb(() => getSupportDb().createTicket(parsed.data.subject, parsed.data.body, parsed.data.contact));
    await withDb(() => getGamificationDb().award('support_ticket', String(id)));
    return jsonOk({ id }, 201);
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'create failed'), 400);
  }
}
