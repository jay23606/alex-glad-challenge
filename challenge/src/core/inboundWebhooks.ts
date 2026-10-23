// Входящие webhooks: внешний сервис POST'ит событие на /api/integrations/inbound/[id],
// оно превращается во внутреннее уведомление или todo.
// Инварианты: секрет генерится сервером и показывается один раз (create);
// подпись — HMAC-SHA256 над сырым телом, timing-safe (переиспользуем verifySignature
// из webhooks.ts); handleInboundEvent не делает I/O кроме инжектированных зависимостей.

import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type { NotificationService } from './notifications.js';
import type { TodoDb } from './todoDb.js';

export type InboundTarget = 'notification' | 'todo';

export interface InboundHookRow {
  id: number;
  name: string;
  secret: string;
  target: InboundTarget;
  created_at: string;
}

export interface InboundHookInput {
  readonly name: string;
  readonly target: InboundTarget;
}

export interface InboundEvent {
  readonly title: string;
  readonly body?: string;
  readonly href?: string;
}

export interface InboundEventDeps {
  readonly notifications?: NotificationService;
  readonly todos?: TodoDb;
}

const TARGETS: ReadonlySet<string> = new Set(['notification', 'todo']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inbound_hooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  secret TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function generateInboundSecret(): string {
  return randomBytes(24).toString('hex');
}

export class InboundHookDb {
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

  /** Создаёт хук со сгенерированным секретом; секрет возвращается только здесь. */
  create(input: InboundHookInput): { id: number; secret: string } {
    const name = input.name.trim();
    if (!name) throw new RangeError('name must be non-empty');
    if (!TARGETS.has(input.target)) throw new RangeError('target must be notification|todo');
    const secret = generateInboundSecret();
    const result = this.db
      .prepare('INSERT INTO inbound_hooks (name, secret, target) VALUES (?, ?, ?)')
      .run(name, secret, input.target);
    return { id: Number(result.lastInsertRowid), secret };
  }

  list(): InboundHookRow[] {
    return this.db.prepare('SELECT * FROM inbound_hooks ORDER BY id').all() as unknown as InboundHookRow[];
  }

  get(id: number): InboundHookRow | null {
    const row = this.db.prepare('SELECT * FROM inbound_hooks WHERE id = ?').get(id);
    return (row as unknown as InboundHookRow | undefined) ?? null;
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM inbound_hooks WHERE id = ?').run(id).changes > 0;
  }
}

/**
 * Применяет входящее событие к цели хука. Домен защищает инварианты сам
 * (title non-empty), не полагаясь на валидацию границы. Возвращает id записи.
 */
export function handleInboundEvent(
  hook: InboundHookRow,
  event: InboundEvent,
  deps: InboundEventDeps,
): number {
  const title = event.title.trim();
  if (!title) throw new RangeError('title must be non-empty');
  const body = event.body?.trim() ?? '';

  if (hook.target === 'notification') {
    if (!deps.notifications) throw new Error('notifications dependency is required');
    return deps.notifications.notify({
      type: 'system',
      title: `${hook.name}: ${title}`,
      body,
      href: event.href ?? null,
    });
  }
  if (hook.target === 'todo') {
    if (!deps.todos) throw new Error('todos dependency is required');
    const text = body ? `[${hook.name}] ${title} — ${body}` : `[${hook.name}] ${title}`;
    return deps.todos.addTodo(text.slice(0, 500));
  }
  throw new RangeError(`unknown inbound target: ${String(hook.target)}`);
}
