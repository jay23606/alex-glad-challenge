// Хранилище курса: уроки, таймкодс-секции полной транскрипции и курируемые
// выдержки. Файл: challenge/.data/course.sqlite (вне git). Идиома — core/db.ts
// (BlogDb): mkdirSync → DatabaseSync → WAL → exec(SCHEMA). SQL — только `?`.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { clean } from './sanitize.js';

export interface LessonRow {
  id: number;
  slug: string;
  title: string;
  kind: string;
  weekNo: number | null;
  durationMs: number;
  summary: string;
  why: string;
  pain: string;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionRow {
  id: number;
  lessonId: number;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface ExcerptRow {
  id: number;
  lessonId: number;
  idx: number;
  quote: string;
  explanation: string;
}

export interface LessonInput {
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly weekNo: number | null;
  readonly durationMs: number;
  readonly summary: string;
  readonly why: string;
  readonly pain: string;
  readonly sourceFile: string;
  readonly sections: ReadonlyArray<{
    readonly idx: number;
    readonly startMs: number;
    readonly endMs: number;
    readonly text: string;
  }>;
  readonly excerpts: ReadonlyArray<{
    readonly idx: number;
    readonly quote: string;
    readonly explanation: string;
  }>;
}

// Лимиты длин: защищают БД от раздувания; текст секции режется по абзацу.
const MAX_TITLE = 300;
const MAX_FIELD = 4096;
const MAX_SECTION_TEXT = 16384;
const MAX_QUOTE = 2000;
const MAX_EXPLANATION = 4096;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'week',
  week_no INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  pain TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(lesson_id, idx)
);

CREATE TABLE IF NOT EXISTS excerpts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  quote TEXT NOT NULL,
  explanation TEXT NOT NULL,
  UNIQUE(lesson_id, idx)
);
`;

export class CourseDb {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Полная замена урока с секциями и выдержками в одной транзакции. */
  upsertLesson(input: LessonInput): number {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO lessons (slug, title, kind, week_no, duration_ms, summary, why, pain, source_file, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             title = excluded.title,
             kind = excluded.kind,
             week_no = excluded.week_no,
             duration_ms = excluded.duration_ms,
             summary = excluded.summary,
             why = excluded.why,
             pain = excluded.pain,
             source_file = excluded.source_file,
             updated_at = excluded.updated_at`,
        )
        .run(
          clean(input.slug, 100),
          clean(input.title, MAX_TITLE),
          clean(input.kind, 50),
          input.weekNo,
          Math.max(0, Math.trunc(input.durationMs)),
          clean(input.summary, MAX_FIELD),
          clean(input.why, MAX_FIELD),
          clean(input.pain, MAX_FIELD),
          clean(input.sourceFile, 500),
          now,
        );
      const row = this.db
        .prepare('SELECT id FROM lessons WHERE slug = ?')
        .get(input.slug) as unknown as { id: number } | undefined;
      if (!row) throw new Error(`upsert lesson failed: ${input.slug}`);
      const lessonId = row.id;

      this.db.prepare('DELETE FROM sections WHERE lesson_id = ?').run(lessonId);
      this.db.prepare('DELETE FROM excerpts WHERE lesson_id = ?').run(lessonId);

      const insertSection = this.db.prepare(
        'INSERT INTO sections (lesson_id, idx, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)',
      );
      for (const s of input.sections) {
        insertSection.run(
          lessonId,
          s.idx,
          Math.max(0, Math.trunc(s.startMs)),
          Math.max(0, Math.trunc(s.endMs)),
          clean(s.text, MAX_SECTION_TEXT),
        );
      }

      const insertExcerpt = this.db.prepare(
        'INSERT INTO excerpts (lesson_id, idx, quote, explanation) VALUES (?, ?, ?, ?)',
      );
      for (const e of input.excerpts) {
        insertExcerpt.run(
          lessonId,
          e.idx,
          clean(e.quote, MAX_QUOTE),
          clean(e.explanation, MAX_EXPLANATION),
        );
      }

      this.db.exec('COMMIT');
      return lessonId;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  listLessons(): LessonRow[] {
    const rows = this.db
      .prepare('SELECT * FROM lessons ORDER BY COALESCE(week_no, 0), slug')
      .all() as unknown as RawLesson[];
    return rows.map(toLesson);
  }

  getLesson(slug: string): LessonRow | null {
    const row = this.db.prepare('SELECT * FROM lessons WHERE slug = ?').get(slug) as unknown as
      | RawLesson
      | undefined;
    return row ? toLesson(row) : null;
  }

  getSections(lessonId: number): SectionRow[] {
    const rows = this.db
      .prepare('SELECT * FROM sections WHERE lesson_id = ? ORDER BY idx')
      .all(lessonId) as unknown as RawSection[];
    return rows.map((r) => ({
      id: r.id,
      lessonId: r.lesson_id,
      idx: r.idx,
      startMs: r.start_ms,
      endMs: r.end_ms,
      text: r.text,
    }));
  }

  getExcerpts(lessonId: number): ExcerptRow[] {
    const rows = this.db
      .prepare('SELECT * FROM excerpts WHERE lesson_id = ? ORDER BY idx')
      .all(lessonId) as unknown as RawExcerpt[];
    return rows.map((r) => ({
      id: r.id,
      lessonId: r.lesson_id,
      idx: r.idx,
      quote: r.quote,
      explanation: r.explanation,
    }));
  }
}

interface RawLesson {
  id: number;
  slug: string;
  title: string;
  kind: string;
  week_no: number | null;
  duration_ms: number;
  summary: string;
  why: string;
  pain: string;
  source_file: string;
  created_at: string;
  updated_at: string;
}

interface RawSection {
  id: number;
  lesson_id: number;
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

interface RawExcerpt {
  id: number;
  lesson_id: number;
  idx: number;
  quote: string;
  explanation: string;
}

function toLesson(r: RawLesson): LessonRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    weekNo: r.week_no,
    durationMs: r.duration_ms,
    summary: r.summary,
    why: r.why,
    pain: r.pain,
    sourceFile: r.source_file,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
