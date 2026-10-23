// /api/notifications — список (GET) + отметка прочитанным (POST).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../lib/auth';
import { notificationActionSchema } from '../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../lib/server/http';
import { getNotificationDb, withDb } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function shape(n: { id: number; type: string; title: string; body: string; href: string | null; read: number; created_at: string }) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    read: n.read === 1,
    createdAt: n.created_at,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1';
  const data = await withDb(() => {
    const db = getNotificationDb();
    return {
      unread: db.unreadCount(),
      notifications: db.list(100, unreadOnly).map(shape),
    };
  });
  return jsonOk({ ...data });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const parsed = notificationActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  const result = await withDb(() => {
    const db = getNotificationDb();
    if (parsed.data.action === 'markAllRead') return { count: db.markAllRead() };
    const id = parsed.data.id;
    if (!id) return { ok: false as const };
    return { ok: db.markRead(id) };
  });
  if ('ok' in result && result.ok === false) return jsonError('id обязателен для markRead', 400);
  return jsonOk({});
}
