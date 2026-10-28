// Feature-БД TG-топика: сообщения forum-топика с авторами и реакциями.
// Файл: challenge/.data/tg.sqlite (вне git — правило challenge/.data/).
//
// Идиома копирована с core/rag/store.ts и core/dialogDb.ts: mkdirSync →
// new DatabaseSync → PRAGMA WAL → exec(SCHEMA). Все SQL — строго `?`-плейсхолдеры
// (SQLi-инвариант CLAUDE.md); единственная динамическая часть — конструирование
// строки из N вопросительных знаков для `IN (?, ?, ...)`, значения идут параметрами.
//
// row = одно сообщение топика: text/date/from_name + reactions_json ({emoticon:count})
// и reaction_total (stored, для ORDER BY без агрегации на чтение). Составной PK
// (chat_id, topic_id, msg_id) + WITHOUT ROWID → естественный dedup → повторный
// сбор идемпотентен (ON CONFLICT DO UPDATE актуализирует реакции/текст).
// tg_collect_state — курсор (min/max msg_id + completed-флаг) рядом с данными:
// «всё TG-состояние в одной БД», атомарность с данными.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface TgMessageRow {
  chat_id: string;
  topic_id: number;
  msg_id: number;
  from_id: string | null;
  from_name: string;
  text: string;
  date_iso: string;
  reactions_json: string;
  reaction_total: number;
}

export interface CollectStateRow {
  min_msg_id: number | null;
  max_msg_id: number | null;
  total: number;
  completed: number; // 0/1: 1 = полный backward-sweep дошёл до конца
}

export interface TgStats {
  messages: number;
  topics: number;
  chats: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tg_messages (
  chat_id        TEXT    NOT NULL,
  topic_id       INTEGER NOT NULL,
  msg_id         INTEGER NOT NULL,
  from_id        TEXT,
  from_name      TEXT    NOT NULL,
  text           TEXT    NOT NULL DEFAULT '',
  date_iso       TEXT    NOT NULL,
  reactions_json TEXT    NOT NULL DEFAULT '{}',
  reaction_total INTEGER NOT NULL DEFAULT 0,
  fetched_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, topic_id, msg_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_tg_top
  ON tg_messages(chat_id, topic_id, reaction_total DESC);

CREATE TABLE IF NOT EXISTS tg_collect_state (
  chat_key   TEXT    NOT NULL,
  topic_id   INTEGER NOT NULL,
  min_msg_id INTEGER,
  max_msg_id INTEGER,
  total      INTEGER NOT NULL DEFAULT 0,
  completed  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_key, topic_id)
) WITHOUT ROWID;
`;

// Placeholders-строка '?, ?, ?' для IN-запроса; значения ВСЕГДА параметрами.
function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

export class TgStore {
  private readonly db: DatabaseSync;
  private readonly upsertStmt;
  private readonly stateUpsertStmt;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    // Ждём освобождения блокировки, а не падаем «database is locked»: параллельно
    // с collect может работать tg-bot (и наоборот) — тот же файл.
    this.db.exec('PRAGMA busy_timeout = 30000');
    this.db.exec(SCHEMA);
    this.upsertStmt = this.db.prepare(
      `INSERT INTO tg_messages
         (chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, topic_id, msg_id) DO UPDATE SET
         from_id         = excluded.from_id,
         from_name       = excluded.from_name,
         text            = excluded.text,
         date_iso        = excluded.date_iso,
         reactions_json  = excluded.reactions_json,
         reaction_total  = excluded.reaction_total,
         fetched_at      = datetime('now')`,
    );
    this.stateUpsertStmt = this.db.prepare(
      `INSERT INTO tg_collect_state
         (chat_key, topic_id, min_msg_id, max_msg_id, total, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(chat_key, topic_id) DO UPDATE SET
         min_msg_id = excluded.min_msg_id,
         max_msg_id = excluded.max_msg_id,
         total      = excluded.total,
         completed  = excluded.completed,
         updated_at = datetime('now')`,
    );
  }

  close(): void {
    this.db.close();
  }

  /** Идемпотентный батч-upsert. Возвращает {written, newlyInserted}. */
  upsertMessages(rows: TgMessageRow[]): { written: number; newlyInserted: number } {
    if (rows.length === 0) return { written: 0, newlyInserted: 0 };
    // Точный подсчёт new-vs-updated: один SELECT IN на (chat,topic)-группу (дёшево
    // относительно самих GetReplies-запросов). Избегаем неоднозначности `changes`
    // в ON CONFLICT и составных ключей с разделителем.
    const byTopic = new Map<string, Map<number, TgMessageRow[]>>();
    for (const r of rows) {
      let perTopic = byTopic.get(r.chat_id);
      if (!perTopic) { perTopic = new Map<number, TgMessageRow[]>(); byTopic.set(r.chat_id, perTopic); }
      const arr = perTopic.get(r.topic_id);
      if (arr) arr.push(r);
      else perTopic.set(r.topic_id, [r]);
    }
    let newlyInserted = 0;
    let written = 0;
    this.db.exec('BEGIN');
    try {
      for (const [chatId, perTopic] of byTopic) {
        for (const [topicId, batch] of perTopic) {
          const ids = batch.map((r) => r.msg_id);
          const existingStmt = this.db.prepare(
            `SELECT msg_id FROM tg_messages WHERE chat_id = ? AND topic_id = ? AND msg_id IN (${placeholders(ids.length)})`,
          );
          const existingRows = existingStmt.all(chatId, topicId, ...ids) as { msg_id: number }[];
          const existing = new Set(existingRows.map((r) => r.msg_id));
          newlyInserted += batch.filter((r) => !existing.has(r.msg_id)).length;
          for (const r of batch) {
            this.upsertStmt.run(
              r.chat_id,
              r.topic_id,
              r.msg_id,
              r.from_id,
              r.from_name,
              r.text,
              r.date_iso,
              r.reactions_json,
              r.reaction_total,
            );
            written++;
          }
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { written, newlyInserted };
  }

  /** Только текстовые сообщения топика (text <> '') — для построения RAG-чанков. */
  listForIndex(chatKey: string, topicId: number): TgMessageRow[] {
    return this.db
      .prepare(
        `SELECT chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total
         FROM tg_messages
         WHERE chat_id = ? AND topic_id = ? AND text <> ''
         ORDER BY msg_id ASC`,
      )
      .all(chatKey, topicId) as unknown as TgMessageRow[];
  }

  topByReactions(chatKey: string, topicId: number, limit: number): TgMessageRow[] {
    return this.db
      .prepare(
        `SELECT chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total
         FROM tg_messages
         WHERE chat_id = ? AND topic_id = ?
         ORDER BY reaction_total DESC, date_iso DESC
         LIMIT ?`,
      )
      .all(chatKey, topicId, limit) as unknown as TgMessageRow[];
  }

  topByDate(chatKey: string, topicId: number, limit: number): TgMessageRow[] {
    return this.db
      .prepare(
        `SELECT chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total
         FROM tg_messages
         WHERE chat_id = ? AND topic_id = ?
         ORDER BY date_iso DESC
         LIMIT ?`,
      )
      .all(chatKey, topicId, limit) as unknown as TgMessageRow[];
  }

  countInTopic(chatKey: string, topicId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM tg_messages WHERE chat_id = ? AND topic_id = ?')
      .get(chatKey, topicId) as { n: number };
    return row.n;
  }

  /** DISTINCT topic_id одного чата — fallback для whole-chat index-tg, если MTProto
   *  GetForumTopics упал (PEER_ID_INVALID/CHAT_ADMIN_REQUIRED). Только parameterized. */
  listTopicIds(chatKey: string): number[] {
    const rows = this.db
      .prepare('SELECT DISTINCT topic_id AS t FROM tg_messages WHERE chat_id = ?')
      .all(chatKey) as { t: number }[];
    return rows.map((r) => r.t);
  }

  clearTopic(chatKey: string, topicId: number): void {
    this.db
      .prepare('DELETE FROM tg_messages WHERE chat_id = ? AND topic_id = ?')
      .run(chatKey, topicId);
  }

  getCollectState(chatKey: string, topicId: number): CollectStateRow | null {
    const row = this.db
      .prepare('SELECT min_msg_id, max_msg_id, total, completed FROM tg_collect_state WHERE chat_key = ? AND topic_id = ?')
      .get(chatKey, topicId) as CollectStateRow | undefined;
    return row ?? null;
  }

  setCollectState(chatKey: string, topicId: number, st: CollectStateRow): void {
    this.stateUpsertStmt.run(
      chatKey,
      topicId,
      st.min_msg_id,
      st.max_msg_id,
      st.total,
      st.completed ? 1 : 0,
    );
  }

  clearState(chatKey: string, topicId: number): void {
    this.db
      .prepare('DELETE FROM tg_collect_state WHERE chat_key = ? AND topic_id = ?')
      .run(chatKey, topicId);
  }

  stats(): TgStats {
    const m = this.db.prepare('SELECT COUNT(*) AS n FROM tg_messages').get() as { n: number };
    const t = this.db
      .prepare('SELECT COUNT(DISTINCT chat_id || char(124) || topic_id) AS n FROM tg_messages')
      .get() as { n: number };
    const c = this.db
      .prepare('SELECT COUNT(DISTINCT chat_id) AS n FROM tg_messages')
      .get() as { n: number };
    return { messages: m.n, topics: t.n, chats: c.n };
  }
}
