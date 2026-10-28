// Коллектор forum-топика Telegram → строки tg.sqlite → RAG-чанки.
// Использует сырой gramjs-клиент из telegramScan.ts (getConnectedRawScanClient),
// чтобы НЕ дублировать init/туннель/session (TG_SESSION в одном месте — security).
//
// API (верифицировано по node_modules/telegram):
//   client.iterMessages(entity, { replyTo: topicTopMsgId, limit, offsetId, minId, reverse })
//   → async-iterator страниц GetReplies; стоп — естественный done:true.
//   msg.reactions.results[]: Api.ReactionCount { count, reaction: ReactionEmoji{emoticon} | ReactionCustomEmoji | ReactionPaid }
//
// Реакции одним проходом: {emoticon:count}+total. Автор — senderName() O(1) из кеша
// gramjs (НЕ getEntity на каждое сообщение — N+1). Содержимое TG = tainted: sanitize
// перед БД и перед Chunk. dim эмбеддинга НЕ хардкодить (HttpEmbedder self-detect).

import type { Chunk, Embedder } from '../rag/types.js';
import type { RagStore } from '../rag/store.js';
import type { MsgLike, RawTelegramClient } from '../agents/telegramScan.js';
import { senderName, msgDateIso } from '../agents/telegramScan.js';
import type { CollectStateRow, TgMessageRow, TgStore } from './tgStore.js';
import { clean } from '../sanitize.js';
import { getTgTopic } from '../env.js';

// Структурная проекция Api.Message — только читаемые поля. Не grain gramjs-тип
// (top-level runtime-import telegram запрещён). Приводится через unknown на каждой итерации.
interface RawTgMessage {
  id?: number;
  message?: string;
  date?: number;
  senderId?: { toString(): string } | bigint | number | null;
  sender?: { firstName?: string; lastName?: string; title?: string; username?: string } | null;
  reactions?: {
    results?: Array<{
      count: number;
      reaction?: { className: string; emoticon?: string };
    }>;
    min?: boolean;
  } | null;
  fwdFrom?: RawFwdHeader | null;
}

interface RawFwdHeader {
  fromId?: RawPeer | null;
  fromName?: string;
  postAuthor?: string;
}

interface RawPeer {
  className?: string;
  userId?: { toString(): string } | bigint | number | null;
  channelId?: { toString(): string } | bigint | number | null;
  chatId?: { toString(): string } | bigint | number | null;
}

interface TgEntity {
  title?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  id?: { toString(): string } | bigint | number | null;
  className?: string;
}

// --- Реакции ---

export interface ReactionSummary {
  byEmoji: Record<string, number>;
  total: number;
}

export function summarizeReactions(m: RawTgMessage): ReactionSummary {
  const byEmoji: Record<string, number> = {};
  let total = 0;
  const results = m.reactions?.results;
  if (results) {
    for (const r of results) {
      total += r.count;
      const cls = r.reaction?.className ?? 'other';
      const key =
        cls === 'ReactionEmoji' ? (r.reaction?.emoticon ?? '?') :
        cls === 'ReactionCustomEmoji' ? 'custom' :
        cls === 'ReactionPaid' ? 'paid' :
        'other';
      byEmoji[key] = (byEmoji[key] ?? 0) + r.count;
    }
  }
  return { byEmoji, total };
}

// Sanitize (tainted TG-контент → БД + RAG-промпт) — единый clean() из core/sanitize.

// --- Атрибуция пересланных сообщений ---

function peerIdString(peer: RawPeer | null | undefined): string | null {
  if (!peer) return null;
  if (peer.className === 'PeerUser') {
    const id = peer.userId;
    return id == null ? null : String(id);
  }
  if (peer.className === 'PeerChannel') {
    const id = peer.channelId;
    return id == null ? null : `-100${id}`;
  }
  if (peer.className === 'PeerChat') {
    const id = peer.chatId;
    return id == null ? null : `-${id}`;
  }
  return null;
}

function peerInputString(peer: RawPeer | null | undefined): string | null {
  if (!peer) return null;
  if (peer.className === 'PeerUser') {
    const id = peer.userId;
    return id == null ? null : String(id);
  }
  if (peer.className === 'PeerChannel') {
    const id = peer.channelId;
    return id == null ? null : `-100${id}`;
  }
  if (peer.className === 'PeerChat') {
    const id = peer.chatId;
    return id == null ? null : `-${id}`;
  }
  return null;
}

function entityName(entity: TgEntity | null | undefined): string | null {
  if (!entity) return null;
  if (entity.firstName || entity.lastName) {
    return [entity.firstName, entity.lastName].filter(Boolean).join(' ');
  }
  if (entity.title) return entity.title;
  if (entity.username) return '@' + entity.username;
  return null;
}

interface ForwardAuthor {
  fromId: string;
  fromName: string;
}

async function resolveForwardAuthor(
  client: RawTelegramClient,
  fwd: RawFwdHeader | null | undefined,
  cache: Map<string, TgEntity | null>,
): Promise<ForwardAuthor | null> {
  if (!fwd) return null;
  const fromId = peerIdString(fwd.fromId);
  if (fromId == null) {
    if (fwd.fromName) return { fromId: 'forward:hidden', fromName: fwd.fromName };
    return null;
  }
  if (fwd.fromName) return { fromId, fromName: fwd.fromName };
  if (fwd.postAuthor) return { fromId, fromName: fwd.postAuthor };
  const input = peerInputString(fwd.fromId);
  if (input == null) return { fromId, fromName: fromId };
  let entity = cache.get(input);
  if (entity === undefined) {
    try {
      entity = (await client.getEntity(input)) as TgEntity | null;
    } catch {
      entity = null;
    }
    cache.set(input, entity);
  }
  const name = entityName(entity) ?? fromId;
  return { fromId, fromName: name };
}

// --- Резолв chat/topic ---

export interface ChatTopicRef {
  entity: unknown;
  chatKey: string;
  topicId: number;
  chatTitle: string;
}

/** Парсит chatRef + опциональный topicArg в {peer, topicId}. Поддерживаемые формы:
 *  https://t.me/c/<X>/<T>, https://t.me/<username>/<T>, @username, -100<id>, голый username. */
export function parseChatTopicInput(
  input: string,
  topicArg?: string,
): { peer: string; topicId: number | undefined } {
  const s = input.trim();
  let m = s.match(/^https?:\/\/t\.me\/c\/(\d+)\/(\d+)/i);
  if (m) return { peer: `-100${m[1]}`, topicId: Number(m[2]) };
  m = s.match(/^https?:\/\/t\.me\/([^/]+)\/(\d+)/i);
  if (m) {
    const name = m[1];
    return { peer: name.startsWith('@') ? name : `@${name}`, topicId: Number(m[2]) };
  }
  m = s.match(/^https?:\/\/t\.me\/([^/]+)$/i);
  if (m) return { peer: `@${m[1]}`, topicId: topicArg != null ? Number(topicArg) : undefined };
  if (s.startsWith('@')) return { peer: s, topicId: topicArg != null ? Number(topicArg) : undefined };
  if (/^-?\d+$/.test(s)) return { peer: s, topicId: topicArg != null ? Number(topicArg) : undefined };
  return { peer: `@${s}`, topicId: topicArg != null ? Number(topicArg) : undefined };
}

// chatKey: приоритет numeric marked id (-100<raw>) — стабилен при rename чата.
// Для приватного c/<X> URL peer уже '-100...' — отдаём как есть. Для публичного
// @username fallback на @username (для single-topic personal-фичи допустимо).
function deriveChatKey(peer: string, entity: TgEntity): string {
  if (/^-100\d+$/.test(peer)) return peer;
  const eid = entity.id;
  if (eid != null) {
    const rawStr = typeof eid === 'bigint' ? eid.toString() : String(eid);
    if (/^\d+$/.test(rawStr)) return `-100${rawStr}`;
  }
  return peer.startsWith('@') ? peer : entity.username ? `@${entity.username}` : peer;
}

export async function resolveChatTopic(
  client: RawTelegramClient,
  input: string,
  topicArg?: string,
): Promise<ChatTopicRef> {
  const { peer, topicId: parsed } = parseChatTopicInput(input, topicArg);
  let topicId = parsed;
  if (topicId == null || !Number.isFinite(topicId)) {
    const envTopic = getTgTopic();
    if (envTopic != null) topicId = envTopic;
  }
  if (topicId == null || !Number.isFinite(topicId)) {
    throw new Error(
      'topicId не задан: укажите позиционным аргументом или в URL t.me/<chat>/<topicId> (или env TG_TOPIC).',
    );
  }
  const entityRaw = await client.getEntity(peer);
  const entity = entityRaw as TgEntity;
  return {
    entity: entityRaw,
    chatKey: deriveChatKey(peer, entity),
    topicId,
    chatTitle: entity.title || entity.username || peer,
  };
}

/** Резолв chatKey по chatRef БЕЗ требования topicId — для chat-filter CLI (§2.5).
 *  Возвращает entity (для переиспользования в GetForumTopics/collectTopic) и chatTitle.
 *  Numeric -100<id> / t.me/c/<id> — offline-резолвятся в peer; @username/bare-name —
 *  через MTProto getEntity (требует подключенный client). */
export async function resolveChatKey(
  client: RawTelegramClient,
  input: string,
): Promise<{ entity: unknown; chatKey: string; chatTitle: string }> {
  const { peer } = parseChatTopicInput(input);
  const entityRaw = await client.getEntity(peer);
  const entity = entityRaw as TgEntity;
  return {
    entity: entityRaw,
    chatKey: deriveChatKey(peer, entity),
    chatTitle: entity.title || entity.username || peer,
  };
}

/** Перечислить id forum-топиков через Api.channels.GetForumTopics (paging по offsetTopic).
 *  General topic (id=1) включается, если вернётся сервером. Бросает RPC-ошибку наружу
 *  (PEER_ID_INVALID/CHAT_ADMIN_REQUIRED) — вызывающий код ловит и fallback на SQL.
 *  Ленивый import telegram — инвариант lazy gramjs сохранён (как в probeTopicViaSearch). */
export async function listForumTopicIds(
  client: RawTelegramClient,
  entity: unknown,
): Promise<number[]> {
  const { Api } = await import('telegram');
  const invokeClient = client as unknown as {
    invoke(req: unknown): Promise<unknown>;
    getInputChannel?(entity: unknown): Promise<unknown>;
  };
  const channel = invokeClient.getInputChannel
    ? await invokeClient.getInputChannel(entity)
    : entity;

  const ids: number[] = [];
  let offsetTopic = 0;
  const MAX_PAGES = 200; // защита от зацикливания при непредвиденном paging
  let pages = 0;
  while (pages < MAX_PAGES) {
    pages++;
    const resRaw = await invokeClient.invoke(
      new Api.channels.GetForumTopics({
        channel: channel as never,
        offsetDate: 0,
        offsetId: 0,
        offsetTopic,
        limit: 100,
      }),
    );
    const res = resRaw as { topics?: Array<{ id?: number; className?: string }> };
    const topics = res.topics ?? [];
    if (topics.length === 0) break;
    let maxId = offsetTopic;
    for (const t of topics) {
      // ForumTopicDeleted тоже имеет id — оставляем (collect пустого topic'а вернёт 0)
      if (typeof t.id === 'number' && t.id > 0) {
        ids.push(t.id);
        if (t.id > maxId) maxId = t.id;
      }
    }
    if (maxId <= offsetTopic) break; // нет прогресса — выходим
    offsetTopic = maxId;
    if (topics.length < 100) break; // последняя страница
  }
  return Array.from(new Set(ids)); // дедуп на случай пересечения страниц
}

// --- Probe (read-only dry-run) ---

export interface ProbeMessage {
  msgId: number;
  fromName: string;
  dateIso: string;
  text: string;
  reactions: ReactionSummary;
}

/** Read-only чтение топика (НЕ пишет БД). Для --probe: проверить, что форум-чтение
 *  через iterMessages({replyTo}) работает на конкретном чате. Возвращает пустой массив,
 *  если топик пуст; бросает RPC-ошибку (PEER_ID_INVALID и т.п.) наружу — fallback Search. */
export async function probeTopic(
  client: RawTelegramClient,
  ref: ChatTopicRef,
  limit = 5,
): Promise<ProbeMessage[]> {
  const out: ProbeMessage[] = [];
  const fwdCache = new Map<string, TgEntity | null>();
  const it = client.iterMessages(ref.entity, { replyTo: ref.topicId, limit });
  for await (const raw of it) {
    const m = raw as unknown as RawTgMessage;
    if (m.id == null) continue;
    const fwd = await resolveForwardAuthor(client, m.fwdFrom, fwdCache);
    out.push({
      msgId: m.id,
      fromName: fwd?.fromName ?? senderName(m as MsgLike),
      dateIso: msgDateIso(m as MsgLike),
      text: m.message ?? '',
      reactions: summarizeReactions(m),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Fallback зонда через Api.messages.Search({topMsgId}) — если replyTo-путь упал
 *  (PEER_ID_INVALID и т.п.). Ленивый import telegram (инвариант lazy gramjs сохранён). */
export async function probeTopicViaSearch(
  client: RawTelegramClient,
  ref: ChatTopicRef,
  limit = 5,
): Promise<ProbeMessage[]> {
  const { Api } = await import('telegram');
  const invokeClient = client as unknown as { invoke(req: unknown): Promise<unknown> };
  const resRaw = await invokeClient.invoke(
    new Api.messages.Search({
      peer: ref.entity as never,
      q: '',
      topMsgId: ref.topicId,
      filter: new Api.InputMessagesFilterEmpty(),
      minDate: 0,
      maxDate: 0,
      offsetId: 0,
      addOffset: 0,
      limit,
      maxId: 0,
      minId: 0,
      hash: 0n as never,
    }),
  );
  const res = resRaw as { messages?: Array<RawTgMessage> };
  const msgs = res.messages ?? [];
  const fwdCache = new Map<string, TgEntity | null>();
  const out: ProbeMessage[] = [];
  for (const m of msgs.filter((m): m is RawTgMessage & { id: number } => m.id != null).slice(0, limit)) {
    const fwd = await resolveForwardAuthor(client, m.fwdFrom, fwdCache);
    out.push({
      msgId: m.id,
      fromName: fwd?.fromName ?? senderName(m as MsgLike),
      dateIso: msgDateIso(m as MsgLike),
      text: m.message ?? '',
      reactions: summarizeReactions(m),
    });
  }
  return out;
}

// --- Collect (полный/incremental/resume) ---

export interface CollectOpts {
  limit?: number;
  resume?: boolean;
  reset?: boolean;
  // whole-chat не-forum: основной поток без replyTo. topic_id фиксируется = ref.topicId
  // (для plain-чата вызывающий код передаёт topicId=0). replyTo НЕ добавляется.
  plain?: boolean;
  onProgress?: (info: { fetched: number; newlyInserted: number; lastId: number | undefined }) => void;
}

export interface CollectResult {
  chatKey: string;
  topicId: number;
  chatTitle: string;
  mode: 'full' | 'resume' | 'incremental';
  fetched: number;
  newlyInserted: number;
  updated: number;
  total: number;
  minIdSeen: number | undefined;
  maxIdSeen: number | undefined;
}

const FLUSH_EVERY = 200;
const MAX_FLOOD_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Секунды FloodWait, если ошибка их несёт (FloodWaitError / SlowModeWaitError /
 *  FloodTestPhoneWaitError — все имеют поле seconds). Иначе null. */
function floodWaitSeconds(err: unknown): number | null {
  if (err && typeof err === 'object' && 'seconds' in err) {
    const s = (err as { seconds: unknown }).seconds;
    if (typeof s === 'number' && Number.isFinite(s) && s > 0) return s;
  }
  return null;
}

/**
 * Собрать сообщения forum-топика в tg.sqlite. Режимы (по моей инструкции — incremental default):
 *  - reset: сброс курсора (clearState) → полный backward-sweep; СООБЩЕНИЯ НЕ УДАЛЯЮТСЯ
 *           (upsert идемпотентен, повторный проход обновит текст/реакции на месте).
 *  - resume: продолжить прерванный backward-sweep с offsetId=state.min_msg_id.
 *  - default: если state.completed=1 → incremental (id > state.max_msg_id, reverse:true);
 *             иначе полный backward-sweep (первый запуск или прерванный).
 * limit — cap (для smoke/--probe-подобного ограничения); undefined = вся история/все новые.
 * Идемпотентность: PK(chat_id,topic_id,msg_id)+ON CONFLICT; FloodWait catch → sleep(sec+1)+retry.
 */
export async function collectTopic(
  store: TgStore,
  client: RawTelegramClient,
  ref: ChatTopicRef,
  opts: CollectOpts = {},
): Promise<CollectResult> {
  const limit = opts.limit;
  const prev = store.getCollectState(ref.chatKey, ref.topicId);

  // --reset больше НЕ удаляет сообщения: upsert идемпотентен (PK + ON CONFLICT
  // обновит текст/реакции), а стирание истории — необратимая потеря данных
  // (инцидент 2026-10-05: --reset снёс 950к сообщений, сборка упала на
  // «database is locked», база осталась с 20к хвостом). Reset = только сброс
  // курсора → полный backward-sweep поверх того, что уже в базе.
  let mode: 'full' | 'resume' | 'incremental';
  if (opts.reset) {
    store.clearState(ref.chatKey, ref.topicId);
    mode = 'full';
  } else if (opts.resume) {
    mode = prev && prev.min_msg_id != null ? 'resume' : 'full';
  } else if (prev && prev.completed === 1 && prev.max_msg_id != null) {
    mode = 'incremental';
  } else {
    mode = prev && prev.min_msg_id != null ? 'resume' : 'full';
  }

  const iterOpts: Record<string, unknown> = {};
  if (!opts.plain) iterOpts.replyTo = ref.topicId;
  if (mode === 'full') {
    if (limit != null) iterOpts.limit = limit;
  } else if (mode === 'resume') {
    iterOpts.offsetId = prev!.min_msg_id!;
    if (limit != null) iterOpts.limit = limit;
  } else {
    iterOpts.reverse = true;
    iterOpts.minId = prev!.max_msg_id!;
    if (limit != null) iterOpts.limit = limit;
  }

  let fetched = 0;
  let newlyInserted = 0;
  let updated = 0;
  let minId: number | undefined;
  let maxId: number | undefined;
  let batch: TgMessageRow[] = [];

  const flush = (): void => {
    if (batch.length === 0) return;
    const res = store.upsertMessages(batch);
    newlyInserted += res.newlyInserted;
    updated += res.written - res.newlyInserted;
    batch = [];
  };

  const fwdCache = new Map<string, TgEntity | null>();
  let attempt = 0;
  while (true) {
    try {
      const it = client.iterMessages(ref.entity, iterOpts);
      for await (const raw of it) {
        const m = raw as unknown as RawTgMessage;
        const id = m.id;
        if (id == null) continue;
        const { byEmoji, total } = summarizeReactions(m);
        const fwd = await resolveForwardAuthor(client, m.fwdFrom, fwdCache);
        batch.push({
          chat_id: ref.chatKey,
          topic_id: ref.topicId,
          msg_id: id,
          from_id: fwd?.fromId ?? (m.senderId == null ? null : String(m.senderId)),
          from_name: clean(fwd?.fromName ?? senderName(m as MsgLike), 200),
          text: clean(m.message ?? '', 4096),
          date_iso: msgDateIso(m as MsgLike),
          reactions_json: JSON.stringify(byEmoji),
          reaction_total: total,
        });
        minId = minId == null || id < minId ? id : minId;
        maxId = maxId == null || id > maxId ? id : maxId;
        fetched++;
        if (batch.length >= FLUSH_EVERY) {
          flush();
          opts.onProgress?.({ fetched, newlyInserted, lastId: id });
        }
      }
      flush();
      break;
    } catch (err) {
      flush();
      const wait = floodWaitSeconds(err);
      if (wait != null && attempt < MAX_FLOOD_RETRIES) {
        attempt++;
        const resumeFrom = minId;
        console.warn(
          `[tg] FloodWait ${wait}s (попытка ${attempt}/${MAX_FLOOD_RETRIES}); ` +
            `сон ${wait + 1}s, продолжу backward с offsetId=${resumeFrom}`,
        );
        await sleep((wait + 1) * 1000);
        // backward-sweep от последнего увиденного (id < offsetId)
        iterOpts.offsetId = resumeFrom;
        delete iterOpts.reverse;
        delete iterOpts.minId;
        continue;
      }
      throw err;
    }
  }

  // capped = sweep обрезан --limit (возможно, не вся история). В этом случае НЕ
  // считаем сбор завершённым: иначе следующий запуск уйдёт в incremental (id > max)
  // и никогда не подтянет историю ниже min → silent data-loss. capped=0 → resume/full.
  // Edge-case «ровно limit сообщений всего» → один избыточный full-sweep, PK дедуплит.
  const capped = limit != null && fetched >= limit;
  const total = store.countInTopic(ref.chatKey, ref.topicId);
  const next: CollectStateRow = {
    min_msg_id: minId ?? prev?.min_msg_id ?? null,
    max_msg_id: maxId ?? prev?.max_msg_id ?? null,
    total,
    completed: capped ? 0 : 1,
  };
  if (mode === 'incremental') {
    // incremental: min не сдвигается (старые не читались); max — самый свежий увиденный
    next.min_msg_id = prev?.min_msg_id ?? minId ?? null;
    next.max_msg_id = maxId ?? prev?.max_msg_id ?? null;
  } else if (mode === 'resume') {
    next.min_msg_id = minId != null && prev?.min_msg_id != null
      ? Math.min(minId, prev.min_msg_id)
      : (minId ?? prev?.min_msg_id ?? null);
    next.max_msg_id = maxId != null && prev?.max_msg_id != null
      ? Math.max(maxId, prev.max_msg_id)
      : (maxId ?? prev?.max_msg_id ?? null);
  }
  store.setCollectState(ref.chatKey, ref.topicId, next);

  return {
    chatKey: ref.chatKey,
    topicId: ref.topicId,
    chatTitle: ref.chatTitle,
    mode,
    fetched,
    newlyInserted,
    updated,
    total,
    minIdSeen: minId,
    maxIdSeen: maxId,
  };
}

// --- RAG-маппер и dim-guard ---

export function messageToChunk(m: TgMessageRow): Chunk {
  return {
    text: `${m.from_name}:\n${m.text}`,
    metadata: {
      source: `tg://chat/${m.chat_id}/${m.topic_id}`,
      title: m.from_name,
      section: `${m.date_iso.slice(0, 10)} | topic ${m.topic_id}`,
      chunkId: `tg::${m.chat_id}::${m.topic_id}::${m.msg_id}`,
    },
  };
}

// --- Length-чанкирование топика (склейка сообщений + границы по размеру/времени) ---
//
// Альтернатива messageToChunk (1 сообщ = 1 чанк): 67k сообщений = 67k чанков =
// неприемлемо долго для локального embedder'а. Склеиваем сообщения хронологически
// (msg_id ASC из listForIndex) и режем на чанки целевого размера на границах
// сообщений. Доп. логическая граница — временной gap > gapMin минут (новая беседа):
// reply_to_msg_id в схеме tg_messages нет → forum-thread reconstruction невозможен
// без re-collect, поэтому единственный сигнал сегментации — паузы во времени.
//
// Реакции = приоритет: каждый чанк имеет reactionTotal (Σ reaction_total вложенных
// сообщений). buildTopicChunks возвращает массив, отсортированный по reactionTotal DESC;
// CLI индексирует tier1 = top-N (по реакциям), tier2 (--rest) = хвост. chunkId
// детерминирован по msg_id-диапазону → chunkId tier1 и tier2 не пересекаются
// (insertChunks = plain INSERT без UNIQUE, конфликтов нет).

export interface TgBuiltChunk {
  chunk: Chunk;
  reactionTotal: number;
  msgCount: number;
}

export interface TopicChunkOpts {
  targetChars?: number; // default 2400
  gapMin?: number;      // default 30 (минут)
}

const DEFAULT_TOPIC_TARGET_CHARS = 2400;
const DEFAULT_TOPIC_GAP_MIN = 30;

interface AccumChunk {
  text: string;
  firstMsgId: number;
  lastMsgId: number;
  firstDateIso: string;
  lastDateIso: string;
  reactionTotal: number;
  msgCount: number;
}

/**
 * Склеить сообщения топика в length-чанки. Граница чанка:
 *  - накоплено text.length >= targetChars (закрывается в конце сообщения);
 *  - ИЛИ временной gap между соседними сообщениями > gapMin минут.
 * Результат отсортирован по reactionTotal DESC (лучшие по реакциям первыми).
 * rows = вывод listForIndex (text <> '', msg_id ASC). rows[0].chat_id/topic_id
 * используются как принадлежность чанка (внутри топика они константны).
 */
export function buildTopicChunks(
  rows: TgMessageRow[],
  opts: TopicChunkOpts = {},
): TgBuiltChunk[] {
  if (rows.length === 0) return [];
  const targetChars = opts.targetChars ?? DEFAULT_TOPIC_TARGET_CHARS;
  const gapMin = opts.gapMin ?? DEFAULT_TOPIC_GAP_MIN;
  const chatId = rows[0].chat_id;
  const topicId = rows[0].topic_id;

  const acc: AccumChunk[] = [];
  let cur: AccumChunk | null = null;
  let prevTs: number | null = null;

  for (const m of rows) {
    const ts = Date.parse(m.date_iso);
    // gap-граница: новая беседа после паузы > gapMin
    if (cur && prevTs != null && Number.isFinite(ts) && (ts - prevTs) / 60000 > gapMin) {
      acc.push(cur);
      cur = null;
    }
    const time = m.date_iso.slice(11, 16); // HH:MM
    const line = `${m.from_name} [${time}]: ${m.text}`;
    if (!cur) {
      cur = {
        text: line,
        firstMsgId: m.msg_id,
        lastMsgId: m.msg_id,
        firstDateIso: m.date_iso,
        lastDateIso: m.date_iso,
        reactionTotal: m.reaction_total,
        msgCount: 1,
      };
    } else {
      cur.text += `\n${line}`;
      cur.lastMsgId = m.msg_id;
      cur.lastDateIso = m.date_iso;
      cur.reactionTotal += m.reaction_total;
      cur.msgCount++;
    }
    prevTs = Number.isFinite(ts) ? ts : prevTs;
    // length-граница: достигли targetChars → закрываем на конце сообщения
    if (cur && cur.text.length >= targetChars) {
      acc.push(cur);
      cur = null;
    }
  }
  if (cur) acc.push(cur);

  const built: TgBuiltChunk[] = acc.map((c) => {
    const range = `${c.firstMsgId}-${c.lastMsgId}`;
    return {
      chunk: {
        text: c.text,
        metadata: {
          source: `tg://chat/${chatId}/${topicId}/${range}`,
          title: `TG topic ${topicId}`,
          section:
            `${c.firstDateIso.slice(0, 10)}..${c.lastDateIso.slice(0, 10)} | msgs ${range} ` +
            `(${c.msgCount}) | ♥${c.reactionTotal}`,
          chunkId: `tg::${chatId}::${topicId}::${range}`,
        },
      },
      reactionTotal: c.reactionTotal,
      msgCount: c.msgCount,
    };
  });
  built.sort((a, b) => b.reactionTotal - a.reactionTotal);
  return built;
}

/** Guard перед query/index-tg: индекс 'telegram' не пуст и dim совместим с embedder'ом.
 *  Контрмера R4 (cosine берёт Math.min — при смене модели тихо деградирует). */
export function assertDimCompatible(store: RagStore, embedder: Embedder): void {
  const st = store.stats('telegram');
  if (st.chunks === 0) {
    throw new Error('Индекс telegram пуст. Сначала: rag index-tg <chat> [<topicId>]');
  }
  if (embedder.dim != null && st.dim != null && st.dim !== embedder.dim) {
    throw new Error(
      `dim mismatch: index=${st.dim}, embedder=${embedder.dim}. ` +
        'Смените LOCAL_EMBED_MODEL или переиндексируйте: rag index-tg <chat> [<topicId>] --reset.',
    );
  }
}
