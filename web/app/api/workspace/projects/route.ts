// /api/workspace/projects — список (GET) и создание (POST) проектов.
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { workspaceProjectSchema } from '../../../../lib/shared/forms';
import { jsonOk, jsonError } from '../../../../lib/server/http';
import { getWorkspaceDb, withDb } from '../../../../lib/server/db';
import { safeMessage } from '../../../../lib/server/safe-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function projectShape(p: { id: number; name: string; description: string; color: string; status: string; created_at: string; updated_at: string }) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    status: p.status,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  const rows = await withDb(() => getWorkspaceDb().listProjects(status as 'active' | 'archived' | undefined));
  return jsonOk({ projects: rows.map(projectShape) });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const parsed = workspaceProjectSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? 'invalid request', 400);
  try {
    const id = await withDb(() => getWorkspaceDb().createProject(parsed.data));
    return jsonOk({ id }, 201);
  } catch (e) {
    return jsonError(safeMessage(e instanceof Error ? e.message : 'create failed'), 400);
  }
}
