// Недельное расписание блогов: дни недели + локальное время + таймзона.
// Отдельно от интервальной автоматизации (automation.ts): здесь слоты календаря
// (Сб/Вс, праздники по расписанию), а не «каждые N минут».
//
// Инварианты:
// - day_of_week: 0=Sunday .. 6=Saturday (как Date#getDay);
// - time_local: строгий HH:MM, timezone — валидная IANA;
// - слот идемпотентен: blog_schedule_runs.slot_key UNIQUE, повторный тик не
//   создаёт дубль; ошибки ретраятся не больше MAX_ATTEMPTS раз;
// - расчёт due — чистая функция localClock/dueScheduleSlots (тесты без таймеров).

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TIMEZONE = 'Europe/Moscow';
export const MAX_ATTEMPTS = 3;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface BlogScheduleRow {
  id: number;
  blog_id: number;
  day_of_week: number;
  time_local: string;
  timezone: string;
  topic: string;
  variants: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface BlogScheduleInput {
  readonly dayOfWeek: number;
  readonly timeLocal: string;
  readonly timezone?: string;
  readonly topic?: string;
  readonly variants?: number;
  readonly enabled?: boolean;
}

export interface BlogScheduleRunRow {
  id: number;
  schedule_id: number;
  blog_id: number;
  slot_key: string;
  status: 'running' | 'success' | 'error';
  attempts: number;
  post_id: number | null;
  message: string;
  started_at: string;
  finished_at: string | null;
}

export interface ScheduleSlot {
  readonly schedule: BlogScheduleRow;
  readonly blogId: number;
  readonly slotKey: string;
  readonly localDate: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blog_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_local TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  topic TEXT NOT NULL DEFAULT '',
  variants INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(blog_id, day_of_week, time_local)
);

CREATE TABLE IF NOT EXISTS blog_schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  blog_id INTEGER NOT NULL,
  slot_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  post_id INTEGER,
  message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_blog_schedules_blog ON blog_schedules(blog_id);
CREATE INDEX IF NOT EXISTS idx_blog_schedule_runs_blog ON blog_schedule_runs(blog_id);
`;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface LocalClock {
  /** YYYY-MM-DD в таймзоне. */
  readonly date: string;
  /** 0=Sunday .. 6=Saturday. */
  readonly weekday: number;
  /** Минуты от локальной полуночи. */
  readonly minutes: number;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = formatter(timeZone).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekday = WEEKDAYS[get('weekday')];
  if (weekday === undefined) throw new RangeError(`invalid timezone: ${timeZone}`);
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return { date, weekday, minutes: hour * 60 + minute };
}

function shiftDate(date: string, days: number): { date: string; weekday: number } {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay() };
}

function timeMinutes(timeLocal: string): number {
  const [h, m] = timeLocal.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Слоты, которые пора запускать: локальное время попало в окно [slot; slot+window).
 * Проверяются сегодняшний и вчерашний локальный день — окно может пересекать
 * полночь (например, суббота 23:30 + 180 минут). Чистая функция.
 */
export function dueScheduleSlots(
  schedules: readonly BlogScheduleRow[],
  now: Date,
  windowMinutes = 180,
): ScheduleSlot[] {
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) {
    throw new RangeError('windowMinutes must be an integer 1..1440');
  }
  const out: ScheduleSlot[] = [];
  for (const s of schedules) {
    if (s.enabled !== 1) continue;
    if (!isValidTimeZone(s.timezone)) continue;
    if (!TIME_RE.test(s.time_local)) continue;
    const clock = localClock(now, s.timezone);
    const slotMin = timeMinutes(s.time_local);
    for (const shift of [0, -1]) {
      const day = shift === 0 ? { date: clock.date, weekday: clock.weekday } : shiftDate(clock.date, shift);
      if (day.weekday !== s.day_of_week) continue;
      const delta = clock.minutes - slotMin + (shift === 0 ? 0 : 1440);
      if (delta < 0 || delta >= windowMinutes) continue;
      out.push({
        schedule: s,
        blogId: s.blog_id,
        slotKey: `${s.blog_id}:${s.id}:${day.date}:${s.time_local}`,
        localDate: day.date,
      });
    }
  }
  return out;
}

function normalizeInput(input: BlogScheduleInput): Required<BlogScheduleInput> {
  const dayOfWeek = Math.trunc(input.dayOfWeek);
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new RangeError('dayOfWeek must be 0..6');
  }
  const timeLocal = input.timeLocal.trim();
  if (!TIME_RE.test(timeLocal)) throw new RangeError('timeLocal must be HH:MM');
  const timezone = (input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  if (!isValidTimeZone(timezone)) throw new RangeError(`invalid timezone: ${timezone}`);
  const topic = (input.topic ?? '').trim().slice(0, 500);
  const variants = Math.trunc(input.variants ?? 1);
  if (!Number.isInteger(variants) || variants < 1 || variants > 3) {
    throw new RangeError('variants must be 1..3');
  }
  return { dayOfWeek, timeLocal, timezone, topic, variants, enabled: input.enabled ?? true };
}

export class BlogScheduleStore {
  /** true — файл создан этим конструктором (для однократного seed расписания). */
  readonly isNew: boolean;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.isNew = !existsSync(dbPath);
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  list(blogId?: number): BlogScheduleRow[] {
    const sql =
      'SELECT * FROM blog_schedules' +
      (blogId !== undefined ? ' WHERE blog_id = ?' : '') +
      ' ORDER BY blog_id, day_of_week, time_local';
    return this.db
      .prepare(sql)
      .all(...(blogId !== undefined ? [blogId] : [])) as unknown as BlogScheduleRow[];
  }

  /** Полная замена расписания блога (PUT-семантика), атомарно. */
  replaceForBlog(blogId: number, entries: readonly BlogScheduleInput[]): BlogScheduleRow[] {
    const normalized = entries.map(normalizeInput);
    if (normalized.length > 14) throw new RangeError('too many schedule entries');
    const seen = new Set<string>();
    for (const e of normalized) {
      const key = `${e.dayOfWeek}:${e.timeLocal}`;
      if (seen.has(key)) throw new RangeError(`duplicate schedule slot: ${key}`);
      seen.add(key);
    }
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM blog_schedules WHERE blog_id = ?').run(blogId);
      const stmt = this.db.prepare(
        `INSERT INTO blog_schedules
           (blog_id, day_of_week, time_local, timezone, topic, variants, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of normalized) {
        stmt.run(
          blogId,
          e.dayOfWeek,
          e.timeLocal,
          e.timezone,
          e.topic,
          e.variants,
          e.enabled ? 1 : 0,
        );
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return this.list(blogId);
  }

  due(now: Date, windowMinutes = 180): ScheduleSlot[] {
    return dueScheduleSlots(this.list(), now, windowMinutes);
  }

  /**
   * Атомарно занять слот. null = уже выполняется/выполнен или лимит попыток.
   * Ошибка слота может быть перезапущена (attempts < MAX_ATTEMPTS).
   */
  claim(slot: ScheduleSlot, now: Date): number | null {
    const nowIso = now.toISOString();
    const existing = this.db
      .prepare('SELECT * FROM blog_schedule_runs WHERE slot_key = ?')
      .get(slot.slotKey) as unknown as BlogScheduleRunRow | undefined;
    if (!existing) {
      try {
        const result = this.db
          .prepare(
            `INSERT INTO blog_schedule_runs
               (schedule_id, blog_id, slot_key, status, attempts, started_at)
             VALUES (?, ?, ?, 'running', 1, ?)`,
          )
          .run(slot.schedule.id, slot.blogId, slot.slotKey, nowIso);
        return Number(result.lastInsertRowid);
      } catch (e) {
        if (e instanceof Error && e.message.includes('UNIQUE')) return null;
        throw e;
      }
    }
    if (existing.status !== 'error' || existing.attempts >= MAX_ATTEMPTS) return null;
    this.db
      .prepare(
        `UPDATE blog_schedule_runs
         SET status = 'running', attempts = attempts + 1,
             message = '', started_at = ?, finished_at = NULL
         WHERE id = ?`,
      )
      .run(nowIso, existing.id);
    return existing.id;
  }

  getRun(id: number): BlogScheduleRunRow | null {
    const row = this.db.prepare('SELECT * FROM blog_schedule_runs WHERE id = ?').get(id);
    return (row ?? null) as BlogScheduleRunRow | null;
  }

  finish(
    runId: number,
    status: 'success' | 'error',
    postId: number | null,
    message: string,
    now: Date,
  ): void {
    this.db
      .prepare(
        `UPDATE blog_schedule_runs
         SET status = ?, post_id = ?, message = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(status, postId, message.slice(0, 500), now.toISOString(), runId);
  }

  listRuns(limit = 30): BlogScheduleRunRow[] {
    return this.db
      .prepare('SELECT * FROM blog_schedule_runs ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as BlogScheduleRunRow[];
  }
}
