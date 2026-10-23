// Интеграции с внешними сервисами: исходящие webhook-подписки + доставка.
// Инварианты: URL http(s) без userinfo и без metadata-endpoint; подпись —
// HMAC-SHA256 над сырым телом; доставка с таймаутом; история статусов в БД.
// fetch инжектится — тесты без сети.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type WebhookEvent =
  | 'post_published'
  | 'todo_completed'
  | 'automation_run'
  | 'notification';

export interface WebhookRow {
  id: number;
  name: string;
  url: string;
  secret: string;
  events: string;
  enabled: number;
  created_at: string;
}

export interface WebhookDeliveryRow {
  id: number;
  webhook_id: number;
  event: string;
  status: string;
  response_code: number | null;
  error: string | null;
  created_at: string;
}

export interface WebhookInput {
  readonly name: string;
  readonly url: string;
  readonly secret?: string;
  readonly events?: ReadonlyArray<WebhookEvent>;
  readonly enabled?: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  response_code INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id);
`;

export function validateWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new RangeError('url must be a valid absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RangeError('url must be http(s)');
  }
  if (url.username || url.password) throw new RangeError('url must not contain credentials');
  const host = url.hostname;
  if (host === '169.254.169.254' || host === '0.0.0.0' || host === '::1') {
    throw new RangeError('url host is not allowed');
  }
  return url.toString();
}

// body — байты, которые реально ушли в сеть (Uint8Array/Buffer), либо строка:
// строка кодируется в UTF-8, поэтому эквивалентна байтам только для валидного
// UTF-8 без BOM. Отправитель с нестандартными байтами (BOM, битая кодировка)
// подписывает сырые байты — сервер обязан проверять те же байты (issue #98).
export function signPayload(secret: string, body: string | Uint8Array): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(secret: string, body: string | Uint8Array, signature: string): boolean {
  // Fail-closed: пустой секрет (DEFAULT '' в схеме БД) не аутентифицирует —
  // иначе HMAC('', body) валиден, и хук без секрета принимал бы подделки.
  if (secret === '') return false;
  const expected = signPayload(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class WebhookDb {
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

  create(input: WebhookInput): number {
    const result = this.db
      .prepare('INSERT INTO webhooks (name, url, secret, events, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(
        input.name.trim(),
        validateWebhookUrl(input.url),
        input.secret ?? '',
        JSON.stringify(input.events ?? []),
        input.enabled === false ? 0 : 1,
      );
    return Number(result.lastInsertRowid);
  }

  list(): WebhookRow[] {
    return this.db.prepare('SELECT * FROM webhooks ORDER BY id').all() as unknown as WebhookRow[];
  }

  get(id: number): WebhookRow | null {
    const row = this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
    return (row as unknown as WebhookRow | undefined) ?? null;
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id).changes > 0;
  }

  recordDelivery(
    webhookId: number,
    event: string,
    status: string,
    responseCode: number | null,
    error: string | null,
  ): void {
    this.db
      .prepare(
        'INSERT INTO webhook_deliveries (webhook_id, event, status, response_code, error) VALUES (?, ?, ?, ?, ?)',
      )
      .run(webhookId, event, status, responseCode, error);
  }

  listDeliveries(limit = 50): WebhookDeliveryRow[] {
    return this.db
      .prepare('SELECT * FROM webhook_deliveries ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as WebhookDeliveryRow[];
  }
}

export interface WebhookDeliveryOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Доставляет событие всем включённым webhook'ам, подписанным на него. */
export async function deliverEvent(
  db: WebhookDb,
  event: WebhookEvent,
  payload: unknown,
  opts: WebhookDeliveryOptions = {},
): Promise<number> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const body = JSON.stringify({ event, payload, sentAt: new Date().toISOString() });
  let delivered = 0;
  for (const hook of db.list()) {
    if (hook.enabled !== 1) continue;
    const events = safeEventList(hook.events);
    if (!events.includes(event)) continue;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hook.secret) headers['x-artel-signature'] = signPayload(hook.secret, body);
    try {
      const res = await fetchFn(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      db.recordDelivery(hook.id, event, res.ok ? 'ok' : 'http-error', res.status, null);
      if (res.ok) delivered += 1;
    } catch (e) {
      db.recordDelivery(hook.id, event, 'error', null, e instanceof Error ? e.message : 'network error');
    }
  }
  return delivered;
}

function safeEventList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String);
  } catch {
    return [];
  }
}
