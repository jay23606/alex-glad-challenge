// Store бота «Медиум»: состояние (tg_bot_state), алиасы (tg_bot_aliases)
// и запросы цитат/авторов поверх tg_messages. Файл тот же tg.sqlite — идиома
// «всё TG-состояние в одной БД». Таблицы АДДИТИВНЫЕ (существующие схемы не
// трогаем). Все SQL — строго parameterized (`?`).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { TgMessageRow } from './tgStore.js';
import { normalizeName } from './botNames.js';
import type { AuthorEntry } from './botNames.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tg_bot_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tg_bot_aliases (
  alias      TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const ROW_COLS =
  'chat_id, topic_id, msg_id, from_id, from_name, text, date_iso, reactions_json, reaction_total';

function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

export class BotStore {
  private readonly db: DatabaseSync;
  private readonly stateUpsert;
  private readonly aliasUpsert;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    // Ждём освобождения блокировки, а не падаем «database is locked»: параллельно
    // с tg-collect может работать сам бот (и наоборот) — тот же файл.
    this.db.exec('PRAGMA busy_timeout = 30000');
    this.db.exec(SCHEMA);
    this.stateUpsert = this.db.prepare(
      `INSERT INTO tg_bot_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    );
    this.aliasUpsert = this.db.prepare(
      `INSERT INTO tg_bot_aliases (alias, from_id) VALUES (?, ?)
       ON CONFLICT(alias) DO UPDATE SET from_id = excluded.from_id, created_at = datetime('now')`,
    );
  }

  close(): void {
    this.db.close();
  }

  // --- состояние (offset poll, рубильник on/off) ---

  getState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM tg_bot_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  setState(key: string, value: string): void {
    this.stateUpsert.run(key, value);
  }

  // --- алиасы (ключ всегда нормализован) ---

  upsertAlias(alias: string, fromId: string): void {
    this.aliasUpsert.run(normalizeName(alias), fromId);
  }

  getAlias(alias: string): string | null {
    const row = this.db.prepare('SELECT from_id FROM tg_bot_aliases WHERE alias = ?').get(
      normalizeName(alias),
    ) as { from_id: string } | undefined;
    return row ? row.from_id : null;
  }

  listAliases(): Map<string, string> {
    const rows = this.db.prepare('SELECT alias, from_id FROM tg_bot_aliases').all() as unknown as Array<{
      alias: string;
      from_id: string;
    }>;
    return new Map(rows.map((r) => [r.alias, r.from_id]));
  }

  countAliases(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM tg_bot_aliases').get() as { n: number };
    return row.n;
  }

  /** SEED при первой инициализации: вставляем только отсутствующие ключи. */
  ensureSeedAliases(seeds: Readonly<Record<string, string>>): number {
    let added = 0;
    for (const [alias, fromId] of Object.entries(seeds)) {
      if (this.getAlias(alias) === null) {
        this.upsertAlias(alias, fromId);
        added++;
      }
    }
    return added;
  }

  // --- каталог авторов (один GROUP BY по чату; вызывается редко, кэш снаружи) ---

  getAuthorDirectory(chatKey: string, topicId: number, excludeFromId: string): AuthorEntry[] {
    const rows = this.db
      .prepare(
        `SELECT from_id, from_name, COUNT(*) AS messages, SUM(text <> '') AS text_messages,
                MIN(date_iso) AS first_date, MAX(date_iso) AS last_date
         FROM tg_messages
         WHERE chat_id = ? AND topic_id = ? AND from_id IS NOT NULL AND from_id <> ?
         GROUP BY from_id, from_name`,
      )
      .all(chatKey, topicId, excludeFromId) as unknown as Array<{
      from_id: string;
      from_name: string;
      messages: number;
      text_messages: number;
      first_date: string;
      last_date: string;
    }>;
    return rows.map((r) => ({
      fromId: r.from_id,
      name: r.from_name,
      messages: Number(r.messages),
      textMessages: Number(r.text_messages),
      firstDate: r.first_date,
      lastDate: r.last_date,
    }));
  }

  // --- цитаты ---

  /** COUNT + случайный OFFSET по готовому WHERE/args — без ORDER BY random(). */
  private randomByWhere(
    where: string,
    args: ReadonlyArray<string | number>,
  ): TgMessageRow | null {
    const n = this.db.prepare(`SELECT COUNT(*) AS n FROM tg_messages WHERE ${where}`).get(
      ...args,
    ) as { n: number };
    if (n.n === 0) return null;
    const offset = Math.floor(Math.random() * n.n);
    return (this.db
      .prepare(`SELECT ${ROW_COLS} FROM tg_messages WHERE ${where} LIMIT 1 OFFSET ?`)
      .get(...args, offset) ?? null) as TgMessageRow | null;
  }

  /** Случайная цитата из топ-пула (reaction_total ≥ min) без ORDER BY random(). */
  randomTopQuote(
    chatKey: string,
    topicId: number,
    opts: { minReactions: number; excludeFromId: string; avoidMsgIds?: number[] },
  ): TgMessageRow | null {
    const where =
      `chat_id = ? AND topic_id = ? AND reaction_total >= ? AND text <> '' AND from_id IS NOT NULL AND from_id <> ?` +
      (opts.avoidMsgIds && opts.avoidMsgIds.length > 0
        ? ` AND msg_id NOT IN (${placeholders(opts.avoidMsgIds.length)})`
        : '');
    const base: Array<string | number> = [chatKey, topicId, opts.minReactions, opts.excludeFromId];
    const args =
      opts.avoidMsgIds && opts.avoidMsgIds.length > 0 ? [...base, ...opts.avoidMsgIds] : base;
    return this.randomByWhere(where, args);
  }

  /** Случайная топ-цитата конкретного автора (fallback на reaction_total ≥ 1). */
  randomAuthorQuote(
    chatKey: string,
    topicId: number,
    fromId: string,
    minReactions = 3,
    avoidMsgIds: number[] = [],
  ): TgMessageRow | null {
    for (const min of [minReactions, 1]) {
      const where =
        `chat_id = ? AND topic_id = ? AND from_id = ? AND reaction_total >= ? AND text <> ''` +
        (avoidMsgIds.length > 0 ? ` AND msg_id NOT IN (${placeholders(avoidMsgIds.length)})` : '');
      const args: Array<string | number> = [chatKey, topicId, fromId, min, ...avoidMsgIds];
      const found = this.randomByWhere(where, args);
      if (found) return found;
    }
    return null;
  }

  /**
   * Случайная цитата для /игра: 40–400 зн., живой участник. Равномерный COUNT +
   * случайный OFFSET по фильтру — прежний PK-range скан смещал выбор к цитатам,
   * идущим после длинных «пустых» зон msg_id (попадание пропорционально размеру
   * пустого промежутка, а не 1/пулу). Реакции ≥5 с фолбэком ≥3, затем ≥1.
   */
  randomGameQuote(
    chatKey: string,
    topicId: number,
    opts: {
      excludeFromId: string;
      minReactions?: number;
      minLen?: number;
      maxLen?: number;
      avoidMsgIds?: number[];
    },
  ): TgMessageRow | null {
    const minLen = opts.minLen ?? 40;
    const maxLen = opts.maxLen ?? 400;
    const avoid = opts.avoidMsgIds ?? [];
    const base =
      `chat_id = ? AND topic_id = ? AND text <> '' AND length(text) BETWEEN ? AND ?` +
      ` AND from_id IS NOT NULL AND from_id <> ?` +
      (avoid.length > 0 ? ` AND msg_id NOT IN (${placeholders(avoid.length)})` : '');
    const baseArgs: Array<string | number> = [
      chatKey,
      topicId,
      minLen,
      maxLen,
      opts.excludeFromId,
      ...avoid,
    ];
    for (const min of [opts.minReactions ?? 5, 3, 1]) {
      const found = this.randomByWhere(`${base} AND reaction_total >= ?`, [...baseArgs, min]);
      if (found) return found;
    }
    return null;
  }

  /**
   * Случайная игровая цитата КОНКРЕТНОГО автора (для «Изобрази»): 40–400 зн.,
   * без ссылок, реакции ≥5 с fallback-проходом ≥3 — пул по образцу randomGameQuote.
   */
  randomAuthorGameQuote(
    chatKey: string,
    topicId: number,
    fromId: string,
    opts: { avoidMsgIds?: number[] } = {},
  ): TgMessageRow | null {
    const avoid = opts.avoidMsgIds ?? [];
    for (const min of [5, 3]) {
      const where =
        `chat_id = ? AND topic_id = ? AND from_id = ? AND reaction_total >= ? AND text <> ''
         AND length(text) BETWEEN 40 AND 400 AND text NOT LIKE '%http%'` +
        (avoid.length > 0 ? ` AND msg_id NOT IN (${placeholders(avoid.length)})` : '');
      const args: Array<string | number> = [chatKey, topicId, fromId, min, ...avoid];
      const found = this.randomByWhere(where, args);
      if (found) return found;
    }
    return null;
  }

  /** Реальный сэмпл даты активности автора (COUNT + случайный OFFSET) —
   *  правдоподобная дата для карточки пародии; у автора нет текстовых → null. */
  sampleAuthorDate(chatKey: string, topicId: number, fromId: string): string | null {
    const where = `chat_id = ? AND topic_id = ? AND from_id = ? AND text <> ''`;
    const n = this.db.prepare(`SELECT COUNT(*) AS n FROM tg_messages WHERE ${where}`).get(
      chatKey,
      topicId,
      fromId,
    ) as { n: number };
    if (n.n === 0) return null;
    const offset = Math.floor(Math.random() * n.n);
    const row = this.db
      .prepare(`SELECT date_iso FROM tg_messages WHERE ${where} LIMIT 1 OFFSET ?`)
      .get(chatKey, topicId, fromId, offset) as { date_iso: string } | undefined;
    return row ? row.date_iso : null;
  }

  /** До limit случайных текстовых сообщений автора (few-shot для /какбы):
   *  40–400 зн., без ссылок, случайные OFFSET-пробы с дедупом по msg_id. */
  sampleAuthorQuotes(
    chatKey: string,
    topicId: number,
    fromId: string,
    limit: number,
  ): TgMessageRow[] {
    const where =
      `chat_id = ? AND topic_id = ? AND from_id = ? AND text <> ''` +
      ` AND length(text) BETWEEN 40 AND 400 AND text NOT LIKE '%http%'`;
    const { n } = this.db
      .prepare(`SELECT COUNT(*) AS n FROM tg_messages WHERE ${where}`)
      .get(chatKey, topicId, fromId) as { n: number };
    if (n === 0) return [];
    const rows = new Map<number, TgMessageRow>();
    for (let i = 0; i < limit * 3 && rows.size < limit; i++) {
      const offset = Math.floor(Math.random() * n);
      const row = this.db
        .prepare(`SELECT ${ROW_COLS} FROM tg_messages WHERE ${where} LIMIT 1 OFFSET ?`)
        .get(chatKey, topicId, fromId, offset) as TgMessageRow | undefined;
      if (row) rows.set(row.msg_id, row);
    }
    return [...rows.values()];
  }

  /** Сообщения по PK (join кандидатов FTS к tg_messages). */
  getMessagesByKeys(
    chatKey: string,
    keys: ReadonlyArray<{ topicId: number; msgId: number }>,
  ): Map<string, TgMessageRow> {
    const result = new Map<string, TgMessageRow>();
    const stmt = this.db.prepare(
      `SELECT ${ROW_COLS} FROM tg_messages WHERE chat_id = ? AND topic_id = ? AND msg_id = ?`,
    );
    for (const k of keys) {
      const row = stmt.get(chatKey, k.topicId, k.msgId) as TgMessageRow | undefined;
      if (row) result.set(rowKey(k.topicId, k.msgId), row);
    }
    return result;
  }

  /** Батч текстовых сообщений с атрибуцией после курсора — для сборки FTS. */
  iterMessagesAfter(
    chatKey: string,
    topicId: number,
    afterMsgId: number,
    limit: number,
  ): TgMessageRow[] {
    return this.db
      .prepare(
        `SELECT ${ROW_COLS} FROM tg_messages
         WHERE chat_id = ? AND topic_id = ? AND msg_id > ? AND text <> '' AND from_id IS NOT NULL
         ORDER BY msg_id LIMIT ?`,
      )
      .all(chatKey, topicId, afterMsgId, limit) as unknown as TgMessageRow[];
  }
}

export function rowKey(topicId: number, msgId: number): string {
  return `${topicId}:${msgId}`;
}
