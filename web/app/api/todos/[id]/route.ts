// /api/todos/[id] — действия над задачей (день 28, web P1).
// POST {action:'complete'|'dismiss'|'delete'} → соответствующий метод TodoDb.
// server-only: импорт core/ только через web/lib/server/* chokepoint.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getTodoDb, getGamificationDb, withDb } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  action: z.enum(['complete', 'dismiss', 'delete']),
});

// Next 15: params — Promise.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid action' },
      { status: 400 },
    );
  }
  const changed = await withDb(() => {
    const db = getTodoDb();
    if (parsed.data.action === 'complete') return db.completeTodo(id);
    if (parsed.data.action === 'dismiss') return db.dismissTodo(id);
    return db.deleteTodo(id);
  });
  if (parsed.data.action === 'complete' && changed) {
    await withDb(() => getGamificationDb().award('todo_completed', String(id)));
  }
  return NextResponse.json({ ok: true, changed });
}
