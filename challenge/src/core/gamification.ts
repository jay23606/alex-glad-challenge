// Геймификация: XP, уровни, ежедневные серии и достижения.
// Чистая математика уровней вынесена в функции; хранение — node:sqlite (WAL).
// Инварианты: xp неотрицателен; достижение открывается ровно один раз;
// серия считается по локальным датам (день без действия сбрасывает серию).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type GamificationEventType =
  | 'post_published'
  | 'todo_completed'
  | 'workspace_item'
  | 'automation_run'
  | 'assistant_used'
  | 'support_ticket'
  | 'tg_game_win'
  | 'tg_game_play';

export interface XpEventRow {
  id: number;
  type: string;
  points: number;
  ref: string | null;
  created_at: string;
}

export interface Achievement {
  code: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface GamificationStats {
  xp: number;
  level: number;
  levelProgress: number; // 0..1 к следующему уровню
  nextLevelXp: number;
  streak: number;
  bestStreak: number;
}

export interface AwardResult {
  points: number;
  stats: GamificationStats;
  levelUp: boolean;
  unlocked: Achievement[];
}

// Баллы за действия — единственный источник весов (стабильный публичный контракт).
export const EVENT_POINTS: Readonly<Record<GamificationEventType, number>> = {
  post_published: 50,
  todo_completed: 10,
  workspace_item: 8,
  automation_run: 20,
  assistant_used: 5,
  support_ticket: 5,
  tg_game_win: 15,
  tg_game_play: 2,
};

// Уровень n требует 100·n² XP. levelForXp — обратная функция.
export function xpForLevel(level: number): number {
  return 100 * level * level;
}

export function levelForXp(xp: number): number {
  const safe = Math.max(0, Math.floor(xp));
  return Math.floor(Math.sqrt(safe / 100)) + 1;
}

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  /** Возвращает true, когда достижение открывается при текущей статистике/контексте. */
  predicate: (ctx: AchievementContext) => boolean;
}

export interface AchievementContext {
  xp: number;
  level: number;
  streak: number;
  bestStreak: number;
  posts: number;
  tasks: number;
  automationRuns: number;
  assistantUses: number;
}

export const ACHIEVEMENTS: ReadonlyArray<AchievementDef> = [
  {
    code: 'first-post',
    title: 'Первый пост',
    description: 'Опубликован первый пост блога',
    predicate: (c) => c.posts >= 1,
  },
  {
    code: 'first-task',
    title: 'Первый дедлайн',
    description: 'Выполнена первая задача',
    predicate: (c) => c.tasks >= 1,
  },
  {
    code: 'streak-3',
    title: 'В ритме',
    description: 'Серия из 3 дней подряд',
    predicate: (c) => c.streak >= 3,
  },
  {
    code: 'streak-7',
    title: 'Неделя без пропусков',
    description: 'Серия из 7 дней подряд',
    predicate: (c) => c.streak >= 7,
  },
  {
    code: 'xp-500',
    title: 'Набирающий ход',
    description: 'Накоплено 500 XP',
    predicate: (c) => c.xp >= 500,
  },
  {
    code: 'level-5',
    title: 'Пятый уровень',
    description: 'Достигнут 5 уровень',
    predicate: (c) => c.level >= 5,
  },
  {
    code: 'auto-10',
    title: 'На автопилоте',
    description: '10 автоматических прогонов блога',
    predicate: (c) => c.automationRuns >= 10,
  },
  {
    code: 'assistant-25',
    title: 'Вместе с ИИ',
    description: '25 обращений к ассистенту',
    predicate: (c) => c.assistantUses >= 25,
  },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  points INTEGER NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gamification_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  xp INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  last_action_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS achievements (
  code TEXT PRIMARY KEY,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_xp_events_type ON xp_events(type);
`;

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  return Math.round((b - a) / 86_400_000);
}

export class GamificationDb {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(dbPath: string, now: () => Date = () => new Date()) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.now = now;
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.db
      .prepare(
        'INSERT INTO gamification_profile (id) VALUES (1) ON CONFLICT(id) DO NOTHING',
      )
      .run();
  }

  close(): void {
    this.db.close();
  }

  award(type: GamificationEventType, ref: string | null = null): AwardResult {
    const points = EVENT_POINTS[type];
    this.db.prepare('INSERT INTO xp_events (type, points, ref) VALUES (?, ?, ?)').run(type, points, ref);

    const profile = this.readProfile();
    const today = localDate(this.now());
    const last = profile.last_action_date;
    let streak = profile.current_streak;
    if (last === today) {
      // уже действовали сегодня — серия не меняется
    } else if (last !== null && daysBetween(last, today) === 1) {
      streak += 1;
    } else {
      streak = 1;
    }
    const bestStreak = Math.max(profile.best_streak, streak);
    const xp = profile.xp + points;

    this.db
      .prepare(
        `UPDATE gamification_profile
         SET xp = ?, current_streak = ?, best_streak = ?, last_action_date = ?, updated_at = datetime('now')
         WHERE id = 1`,
      )
      .run(xp, streak, bestStreak, today);

    const level = levelForXp(xp);
    const prevLevel = levelForXp(profile.xp);
    const unlocked = this.evaluateAchievements({
      xp,
      level,
      streak,
      bestStreak,
      posts: this.countEvents('post_published'),
      tasks: this.countEvents('todo_completed'),
      automationRuns: this.countEvents('automation_run'),
      assistantUses: this.countEvents('assistant_used'),
    });

    return {
      points,
      stats: this.buildStats(xp, streak, bestStreak),
      levelUp: level > prevLevel,
      unlocked,
    };
  }

  getStats(): GamificationStats {
    const p = this.readProfile();
    return this.buildStats(p.xp, p.current_streak, p.best_streak);
  }

  // Единая формула GamificationStats для award() и getStats(): оба считают
  // уровень и прогресс от одного и того же xp и всегда совпадают.
  // На границе уровня (xp ровно 100·n²) levelForXp относит xp уже к следующему
  // уровню, поэтому сразу после level-up levelProgress = 0 — та же семантика,
  // что и у getStats() (прогресс считается от пола нового уровня).
  private buildStats(xp: number, streak: number, bestStreak: number): GamificationStats {
    const level = levelForXp(xp);
    const currentFloor = xpForLevel(level - 1);
    const next = xpForLevel(level);
    return {
      xp,
      level,
      levelProgress: (xp - currentFloor) / (next - currentFloor),
      nextLevelXp: next,
      streak,
      bestStreak,
    };
  }

  listEvents(limit = 30): XpEventRow[] {
    return this.db
      .prepare('SELECT * FROM xp_events ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as XpEventRow[];
  }

  listAchievements(): Achievement[] {
    const unlocked = new Map<string, string>();
    for (const row of this.db.prepare('SELECT * FROM achievements').all() as unknown as Array<{
      code: string;
      unlocked_at: string;
    }>) {
      unlocked.set(row.code, row.unlocked_at);
    }
    return ACHIEVEMENTS.map((a) => ({
      code: a.code,
      title: a.title,
      description: a.description,
      unlocked: unlocked.has(a.code),
      unlockedAt: unlocked.get(a.code) ?? null,
    }));
  }

  private readProfile(): {
    xp: number;
    current_streak: number;
    best_streak: number;
    last_action_date: string | null;
  } {
    const row = this.db.prepare('SELECT * FROM gamification_profile WHERE id = 1').get() as
      | { xp: number; current_streak: number; best_streak: number; last_action_date: string | null }
      | undefined;
    return row ?? { xp: 0, current_streak: 0, best_streak: 0, last_action_date: null };
  }

  private countEvents(type: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM xp_events WHERE type = ?').get(type) as {
      n: number;
    };
    return row.n;
  }

  private evaluateAchievements(ctx: AchievementContext): Achievement[] {
    const existing = new Set(
      (this.db.prepare('SELECT code FROM achievements').all() as unknown as Array<{ code: string }>).map(
        (r) => r.code,
      ),
    );
    const unlocked: Achievement[] = [];
    for (const def of ACHIEVEMENTS) {
      if (existing.has(def.code) || !def.predicate(ctx)) continue;
      this.db.prepare('INSERT INTO achievements (code) VALUES (?)').run(def.code);
      unlocked.push({ code: def.code, title: def.title, description: def.description, unlocked: true, unlockedAt: null });
    }
    return unlocked;
  }
}
