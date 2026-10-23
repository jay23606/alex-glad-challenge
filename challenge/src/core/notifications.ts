// Центр уведомлений: хранение + фан-аут по каналам (Telegram, webhook).
// NotificationDb — только хранение (node:sqlite, WAL). NotificationService —
// DI-граница: создаёт запись и рассылает по инжектированным каналам.
// Инвариант: ошибка канала не теряет запись уведомления (запись создаётся первой).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type NotificationType =
  | 'post_published'
  | 'todo_due'
  | 'automation'
  | 'system';

export interface NotificationRow {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  read: number;
  created_at: string;
}

export interface NotificationInput {
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly href?: string | null;
}

export interface NotificationChannel {
  /** Возвращает true, если канал доставил; бросает/возвращает false при недоступности. */
  send(n: NotificationInput): Promise<boolean> | boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
`;

export class NotificationDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  add(input: NotificationInput): number {
    const result = this.db
      .prepare('INSERT INTO notifications (type, title, body, href) VALUES (?, ?, ?, ?)')
      .run(input.type, input.title.trim(), input.body.trim(), input.href?.trim() || null);
    return Number(result.lastInsertRowid);
  }

  list(limit = 50, unreadOnly = false): NotificationRow[] {
    const sql = unreadOnly
      ? 'SELECT * FROM notifications WHERE read = 0 ORDER BY id DESC LIMIT ?'
      : 'SELECT * FROM notifications ORDER BY id DESC LIMIT ?';
    return this.db.prepare(sql).all(limit) as unknown as NotificationRow[];
  }

  unreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').get() as {
      n: number;
    };
    return row.n;
  }

  markRead(id: number): boolean {
    return Number(this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id).changes) > 0;
  }

  markAllRead(): number {
    return Number(this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run().changes);
  }

  prune(keepDays: number): number {
    const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
    return Number(this.db.prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff).changes);
  }
}

export class NotificationService {
  constructor(
    private readonly db: NotificationDb,
    private readonly channels: ReadonlyArray<NotificationChannel> = [],
  ) {}

  notify(input: NotificationInput): number {
    const id = this.db.add(input);
    for (const channel of this.channels) {
      try {
        channel.send(input);
      } catch {
        // канал недоступен — запись уже сохранена, молча пропускаем
      }
    }
    return id;
  }
}
