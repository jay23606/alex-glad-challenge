/**
 * /api/mobile/bootstrap — единый снапшот для мобильного клиента (дашборд).
 *
 * Контракт блока `gamification` (пробрасывается из `GamificationDb.getStats()` без преобразования):
 * - `levelProgress` — ДОЛЯ 0..1 прогресса внутри текущего уровня к следующему
 *   (не процент и не 0..100 — клиент умножает на 100 сам; Android-клиент
 *   трактует как Double-долю, coerceIn(0f, 1f));
 * - `nextLevelXp` — АБСОЛЮТНЫЙ XP-порог следующего уровня (100·level²), не остаток
 *   (остаток = `nextLevelXp − xp`).
 *
 * Таблица полей: docs/api-contracts.md.
 */
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { jsonOk } from '../../../../lib/server/http';
import { getGamificationDb, getNotificationDb, getWorkspaceDb, withDb } from '../../../../lib/server/db';
import { getAutomation } from '../../../../lib/server/automation-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const data = await withDb(() => {
    const stats = getGamificationDb().getStats();
    const achievements = getGamificationDb().listAchievements().map((a) => ({
      code: a.code,
      title: a.title,
      description: a.description,
      unlocked: a.unlocked,
    }));
    return {
      app: 'Артель',
      gamification: {
        xp: stats.xp,
        level: stats.level,
        levelProgress: stats.levelProgress,
        nextLevelXp: stats.nextLevelXp,
        streak: stats.streak,
        bestStreak: stats.bestStreak,
        achievements,
      },
      notifications: { unread: getNotificationDb().unreadCount() },
      counts: {
        projects: getWorkspaceDb().listProjects('active').length,
        openTasks: getWorkspaceDb().listItems({ kind: 'task' }).length,
        enabledRules: getAutomation().listRules().filter((r) => r.enabled === 1).length,
      },
    };
  });
  return jsonOk({ ...data });
}
