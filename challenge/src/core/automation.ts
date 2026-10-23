// Автоматизация блогов: правила-расписания per blog + история запусков.
// BlogAutomation — DI-сервис: runBlog инжектится (тесты без сети/LLM), расписание —
// чистая функция. Инварианты: interval >= 5 минут; ошибка запуска фиксируется
// в run-записи и не останавливает остальные правила.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type AutomationRunStatus = 'success' | 'error' | 'skipped';

export interface AutomationRuleRow {
  blog_id: number;
  enabled: number;
  interval_minutes: number;
  auto_publish: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationRunRow {
  id: number;
  blog_id: number;
  status: AutomationRunStatus;
  post_id: number | null;
  message: string;
  started_at: string;
  finished_at: string | null;
}

export interface AutomationRuleInput {
  readonly enabled?: boolean;
  readonly intervalMinutes?: number;
  readonly autoPublish?: boolean;
}

export interface BlogRunOutcome {
  readonly postId?: number | null;
  readonly message: string;
}

export interface AutomationRunResult {
  readonly blogId: number;
  readonly status: AutomationRunStatus;
  readonly message: string;
  readonly postId: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS automation_rules (
  blog_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 360,
  auto_publish INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  post_id INTEGER,
  message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_blog ON automation_runs(blog_id);
`;

export function nextRunAfter(
  lastRunAt: string | null,
  intervalMinutes: number,
  now: Date,
): string {
  // Без последнего запуска правило должно сработать сразу (due now), а не через интервал.
  if (!lastRunAt) return now.toISOString();
  const base = Date.parse(lastRunAt);
  if (Number.isNaN(base)) return now.toISOString();
  return new Date(base + intervalMinutes * 60_000).toISOString();
}

export interface BlogAutomationOptions {
  /** Запускает конвейер поста для блога; бросает при ошибке. */
  readonly runBlog: (blogId: number) => Promise<BlogRunOutcome>;
  readonly blogExists: (blogId: number) => boolean;
  readonly now?: () => Date;
}

export class BlogAutomation {
  private db: DatabaseSync;
  private readonly runBlog: (blogId: number) => Promise<BlogRunOutcome>;
  private readonly blogExists: (blogId: number) => boolean;
  private readonly now: () => Date;

  constructor(dbPath: string, opts: BlogAutomationOptions) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.runBlog = opts.runBlog;
    this.blogExists = opts.blogExists;
    this.now = opts.now ?? (() => new Date());
  }

  close(): void {
    this.db.close();
  }

  upsertRule(blogId: number, input: AutomationRuleInput): boolean {
    if (!this.blogExists(blogId)) throw new RangeError('blog not found');
    const existing = this.getRule(blogId);
    const enabled = input.enabled ?? (existing ? existing.enabled === 1 : false);
    const intervalMinutes = input.intervalMinutes ?? existing?.interval_minutes ?? 360;
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5) {
      throw new RangeError('intervalMinutes must be an integer >= 5');
    }
    const autoPublish = input.autoPublish ?? (existing ? existing.auto_publish === 1 : false);
    const now = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO automation_rules (blog_id, enabled, interval_minutes, auto_publish, next_run_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(blog_id) DO UPDATE SET
           enabled = excluded.enabled,
           interval_minutes = excluded.interval_minutes,
           auto_publish = excluded.auto_publish,
           updated_at = datetime('now')`,
      )
      .run(
        blogId,
        enabled ? 1 : 0,
        intervalMinutes,
        autoPublish ? 1 : 0,
        nextRunAfter(existing?.last_run_at ?? null, intervalMinutes, new Date(now)),
      );
    return true;
  }

  getRule(blogId: number): AutomationRuleRow | null {
    const row = this.db.prepare('SELECT * FROM automation_rules WHERE blog_id = ?').get(blogId);
    return (row as unknown as AutomationRuleRow | undefined) ?? null;
  }

  listRules(): AutomationRuleRow[] {
    return this.db.prepare('SELECT * FROM automation_rules ORDER BY blog_id').all() as unknown as AutomationRuleRow[];
  }

  listRuns(limit = 30): AutomationRunRow[] {
    return this.db.prepare('SELECT * FROM automation_runs ORDER BY id DESC LIMIT ?').all(limit) as unknown as AutomationRunRow[];
  }

  /** Запускает все включённые правила, чей next_run_at наступил. */
  async runDue(): Promise<AutomationRunResult[]> {
    const nowIso = this.now().toISOString();
    const due = this.listRules().filter(
      (r) => r.enabled === 1 && r.next_run_at !== null && r.next_run_at <= nowIso,
    );
    const results: AutomationRunResult[] = [];
    for (const rule of due) {
      results.push(await this.runOne(rule.blog_id));
    }
    return results;
  }

  async runNow(blogId: number): Promise<AutomationRunResult> {
    if (!this.blogExists(blogId)) throw new RangeError('blog not found');
    return this.runOne(blogId);
  }

  private async runOne(blogId: number): Promise<AutomationRunResult> {
    const startedAt = this.now().toISOString();
    const insertId = Number(
      this.db
        .prepare(
          "INSERT INTO automation_runs (blog_id, status, message, started_at) VALUES (?, 'skipped', '', ?)",
        )
        .run(blogId, startedAt).lastInsertRowid,
    );
    try {
      const outcome = await this.runBlog(blogId);
      const finishedAt = this.now().toISOString();
      this.db
        .prepare(
          `UPDATE automation_runs SET status = 'success', post_id = ?, message = ?, finished_at = ?
           WHERE id = ?`,
        )
        .run(outcome.postId ?? null, outcome.message, finishedAt, insertId);
      this.touchRule(blogId, startedAt);
      return { blogId, status: 'success', message: outcome.message, postId: outcome.postId ?? null };
    } catch (e) {
      const finishedAt = this.now().toISOString();
      const message = e instanceof Error ? e.message : 'automation failed';
      this.db
        .prepare("UPDATE automation_runs SET status = 'error', message = ?, finished_at = ? WHERE id = ?")
        .run(message, finishedAt, insertId);
      this.touchRule(blogId, startedAt);
      return { blogId, status: 'error', message, postId: null };
    }
  }

  private touchRule(blogId: number, lastRunAt: string): void {
    const rule = this.getRule(blogId);
    const interval = rule?.interval_minutes ?? 360;
    const next = nextRunAfter(lastRunAt, interval, this.now());
    this.db
      .prepare('UPDATE automation_rules SET last_run_at = ?, next_run_at = ?, updated_at = datetime(\'now\') WHERE blog_id = ?')
      .run(lastRunAt, next, blogId);
  }
}
