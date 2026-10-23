/**
 * /api/gamification — прогресс (XP/уровень/серия/достижения) + лента событий.
 *
 * Контракт `stats` (пробрасывается из `GamificationDb.getStats()` без преобразования):
 * - `levelProgress` — ДОЛЯ 0..1 прогресса внутри текущего уровня к следующему
 *   (не процент и не 0..100 — клиент умножает на 100 сам);
 * - `nextLevelXp` — АБСОЛЮТНЫЙ XP-порог следующего уровня (100·level²), не остаток
 *   (остаток = `nextLevelXp − xp`).
 *
 * Таблица полей: docs/api-contracts.md.
 */
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../lib/auth';
import { jsonOk } from '../../../lib/server/http';
import { getGamificationDb, withDb } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const limit = Math.min(100, Number(req.nextUrl.searchParams.get('limit') ?? '30') || 30);
  const data = await withDb(() => {
    const db = getGamificationDb();
    return {
      stats: db.getStats(),
      achievements: db.listAchievements(),
      events: db.listEvents(limit).map((e) => ({
        id: e.id,
        type: e.type,
        points: e.points,
        createdAt: e.created_at,
      })),
    };
  });
  return jsonOk({ ...data });
}
