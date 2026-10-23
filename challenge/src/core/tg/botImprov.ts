// Игра «Изобрази автора» (/изобрази <имя> [тема]): бот публикует анонс, чат
// сдаёт пародии реплаями на анонс (каждая принятая тут же удаляется — аноним),
// затем голосование кнопками «3 пародии + настоящая цитата» и ревил с очками.
// План: swarm-report/izobrazi-plan-01.md. Настоящая цитата фиксируется на старте
// раунда — гард «запись ≠ настоящая» O(1). from_id в вывод не попадает никогда.
// Вся сеть — через инжектные deps (send/del/edit/answer) — юнит-тесты без сети.

import { normalizeName } from './botNames.js';
import type { AuthorEntry } from './botNames.js';
import type { InlineKeyboard, OutboundMessage } from './botQueue.js';

const IMPROV_COLLECT_MS = 180_000;
const IMPROV_MIN_WINDOW_MS = 45_000;
const IMPROV_VOTE_MS = 90_000;
const IMPROV_MAX_ENTRIES = 3;
const IMPROV_MIN_ENTRIES = 2;
const IMPROV_ENTRY_MAX_LEN = 300;
const REAL_TEXT_MAX = 400;
/** Межраундовый кулдаун (выключен; включается опцией cooldownMs в конструкторе). */
const IMPROV_COOLDOWN_MS = 0;

export interface ImprovReplyEvent {
  chatId: string;
  msgId: number; // сообщение-запись (для deleteMessage)
  userId: string;
  userName: string;
  replyToMessageId: number | undefined;
  text: string | undefined; // undefined/'' → не запись (медиа), молча
}

export interface ImprovRealQuote {
  msgId: number;
  text: string;
  dateIso: string;
  reactions: number;
}

export interface ImprovStartParams {
  chatId: string;
  replyTo?: number;
  author: AuthorEntry;
  theme: string; // '' если без темы
  real: ImprovRealQuote;
}

export interface ImprovDeps {
  send: (m: OutboundMessage) => Promise<number | null>;
  del: (chatId: string, msgId: number) => Promise<boolean>;
  edit: (chatId: string, msgId: number, text: string, markup?: InlineKeyboard) => Promise<boolean>;
  answer: (cbId: string, text?: string) => Promise<void>;
  /** Реальный сэмпл date_iso автора пародии (правдоподобная дата карточки). */
  plausibleDate: (fromId: string) => string | null;
  addScore: (chatId: string, userId: string, name: string, delta: number) => void;
  topScores: (chatId: string) => string; // «Имя — 5 · …» | ''
  /** XP-хук (T4): «золотой шарж» → win, угадавший настоящую → play. Опционально.
   *  roundSeq — номер раунда игры: ref XP-события уникален по раундам.
   *  Контракт: хук НЕ должен бросать — вызывается синхронно внутри общего
   *  try ревила, throw сорвёт пост раскрытия (в bot.ts award обёрнут в try). */
  awardGame?: (chatId: string, userId: string, kind: 'win' | 'play', roundSeq: number) => void;
  now: () => number;
  log: (msg: string) => void;
}

interface ImprovEntry {
  userId: string;
  userName: string;
  text: string;
  msgId: number;
}

interface ImprovVariant {
  idx: number; // 1-based номер на карточке
  text: string;
  dateIso: string;
  authorUserId: string | null; // null → настоящая цитата
  authorName: string;
}

interface ImprovRound {
  chatId: string;
  token: string;
  seq: number; // монотонный номер раунда — попадает в ref XP-события
  phase: 'collect' | 'vote';
  author: AuthorEntry;
  theme: string;
  announceMsgId: number | null;
  real: ImprovRealQuote;
  entries: Map<string, ImprovEntry>; // userId → запись
  seenNorms: Map<string, string>; // нормализованный текст → userId (дедуп)
  variants: ImprovVariant[] | null;
  realIdx: number;
  votes: Map<string, number>; // userId → idx (last-wins)
  voterNames: Map<string, string>;
  collectStartsAt: number;
  endsAt: number;
  timer: NodeJS.Timeout;
  finished: boolean;
}

export interface ImprovGameOpts {
  cooldownMs?: number;
  collectMs?: number;
  voteMs?: number;
  minWindowMs?: number;
}

export class ImprovGame {
  private readonly rounds = new Map<string, ImprovRound>();
  private readonly lastEndAt = new Map<string, number>();
  // Номер последнего созданного раунда. Сбрасывается при рестарте процесса:
  // ref не уникален/не дедуплицируется между запусками; если ref станет
  // ключом идемпотентности — нужен персистентный счётчик или round.token.
  private seq = 0;
  private readonly cooldownMs: number;
  private readonly collectMs: number;
  private readonly voteMs: number;
  private readonly minWindowMs: number;

  constructor(
    private readonly deps: ImprovDeps,
    opts: ImprovGameOpts = {},
  ) {
    this.cooldownMs = opts.cooldownMs ?? IMPROV_COOLDOWN_MS;
    this.collectMs = opts.collectMs ?? IMPROV_COLLECT_MS;
    this.voteMs = opts.voteMs ?? IMPROV_VOTE_MS;
    this.minWindowMs = opts.minWindowMs ?? IMPROV_MIN_WINDOW_MS;
  }

  hasActiveRound(chatId: string): { endsAt: number } | null {
    const r = this.rounds.get(chatId);
    if (!r || r.finished) return null;
    return { endsAt: r.endsAt };
  }

  /** Жёсткий фильтр reply-ветки: реплай на анонс активного набора этого чата. */
  isCollectAnnounce(chatId: string, replyToMessageId: number | undefined): boolean {
    const r = this.rounds.get(chatId);
    return (
      r !== undefined &&
      !r.finished &&
      r.phase === 'collect' &&
      r.announceMsgId !== null &&
      replyToMessageId === r.announceMsgId
    );
  }

  async start(p: ImprovStartParams): Promise<void> {
    const now = this.deps.now();
    if (this.cooldownMs > 0) {
      const last = this.lastEndAt.get(p.chatId);
      if (last !== undefined && now - last < this.cooldownMs) {
        const sec = Math.max(1, Math.ceil((this.cooldownMs - (now - last)) / 1000));
        await this.sendQuiet({ chatId: p.chatId, text: `Игра только что была — подожди ${sec} с.`, replyTo: p.replyTo });
        return;
      }
    }
    const round: ImprovRound = {
      chatId: p.chatId,
      token: Math.random().toString(36).slice(2, 10),
      seq: ++this.seq,
      phase: 'collect',
      author: p.author,
      theme: p.theme,
      announceMsgId: null,
      real: p.real,
      entries: new Map(),
      seenNorms: new Map(),
      variants: null,
      realIdx: -1,
      votes: new Map(),
      voterNames: new Map(),
      collectStartsAt: now,
      endsAt: now + this.collectMs,
      timer: null as unknown as NodeJS.Timeout,
      finished: false,
    };
    this.rounds.set(p.chatId, round); // слот занят сразу — до доставки анонса
    const msgId = await this.sendQuiet({
      chatId: p.chatId,
      text: announceText(round, now, this.minWindowMs),
      replyTo: p.replyTo,
    });
    if (msgId === null || this.rounds.get(p.chatId) !== round) {
      this.deps.log(`анонс дропнут, раунд отменён молча (chat=${p.chatId})`);
      this.dropRound(round, null);
      return;
    }
    round.announceMsgId = msgId;
    round.collectStartsAt = this.deps.now();
    round.endsAt = round.collectStartsAt + this.collectMs;
    // токен в замыкании: таймер СТАРОГО раунда после перезаписи слота — no-op
    round.timer = setTimeout(
      () => this.runTimer(() => this.closeCollect(p.chatId, round.token)),
      this.collectMs,
    );
  }

  /** Запись-реплой: валидация ДО удаления; отказ не удаляет и не считает. */
  async handleEntry(ev: ImprovReplyEvent): Promise<void> {
    const round = this.rounds.get(ev.chatId);
    if (!round || round.finished || round.phase !== 'collect' || round.announceMsgId === null) return;
    if (ev.replyToMessageId !== round.announceMsgId) return;
    const text = ev.text?.trim();
    if (!text) return; // медиа/caption — не запись
    const refuse = (msg: string): Promise<void> =>
      this.sendQuiet({ chatId: ev.chatId, text: msg, replyTo: round.announceMsgId ?? undefined }).then(() => {});
    if (text.length > IMPROV_ENTRY_MAX_LEN) {
      await refuse('Уложись в 300 знаков 🙂');
      return;
    }
    if (looksLikeReal(text, round.real.text)) {
      await refuse('Это не пародия, это копипаст 🙂');
      return;
    }
    const norm = normalizeName(text);
    const owner = round.seenNorms.get(norm);
    if (owner !== undefined && owner !== ev.userId) {
      await refuse('Такое уже сдают, перезапиши 🙂');
      return;
    }
    if (round.entries.size >= IMPROV_MAX_ENTRIES && !round.entries.has(ev.userId)) return; // «первые 3»
    const outcome = await this.deleteQuiet(ev.chatId, ev.msgId);
    // пока шло удаление, раунд могли закрыть (/off, дедлайн) или перезаписать — запись в него не принимаем
    if (this.rounds.get(ev.chatId) !== round || round.finished || round.phase !== 'collect') return;
    if (outcome === 'denied') {
      this.cancelForRights(round);
      return;
    }
    if (outcome === 'error') {
      // транзиентный сбой сети: анонимность записи не подтверждена — раунд гасим без ложного текста про админку
      this.dropRound(round, 'Не получилось обработать запись, попробуй ещё раз. Раунд отменён.');
      return;
    }
    const prev = round.entries.get(ev.userId);
    if (prev) round.seenNorms.delete(normalizeName(prev.text));
    round.entries.set(ev.userId, { userId: ev.userId, userName: ev.userName, text, msgId: ev.msgId });
    round.seenNorms.set(norm, ev.userId);
    if (prev) await refuse('Перезаписал 🙂');
    else await this.editCounter(round);
    const elapsed = this.deps.now() - round.collectStartsAt;
    if (round.entries.size >= IMPROV_MAX_ENTRIES) {
      if (elapsed >= this.minWindowMs) {
        this.closeCollect(ev.chatId, round.token);
      } else {
        // 3/3 раньше минимального окна: держим паузу, анонс показывает «стартую…»
        clearTimeout(round.timer);
        const rest = this.minWindowMs - elapsed;
        round.endsAt = this.deps.now() + rest;
        round.timer = setTimeout(
          () => this.runTimer(() => this.closeCollect(ev.chatId, round.token)),
          rest,
        );
        await this.editCounter(round);
      }
    }
  }

  /** Голос кнопкой vote:<token>:<idx>; ack не зависит от правильности (нет утечки). */
  async handleVote(
    cbId: string,
    chatId: string,
    userId: string,
    userName: string,
    token: string,
    idxRaw: string,
  ): Promise<void> {
    const round = this.rounds.get(chatId);
    if (!round || round.token !== token || round.phase !== 'vote' || !round.variants) {
      await this.answerQuiet(cbId, 'Раунд уже завершён');
      return;
    }
    if (round.finished || this.deps.now() >= round.endsAt) {
      await this.answerQuiet(cbId, 'Голосование закрыто');
      return;
    }
    const idx = Number(idxRaw);
    const variant = round.variants.find((v) => v.idx === idx);
    if (!variant) {
      await this.answerQuiet(cbId, undefined);
      return;
    }
    if (variant.authorUserId !== null && variant.authorUserId === userId) {
      await this.answerQuiet(cbId, 'Свой вариант не считается 🙂');
      return;
    }
    round.votes.set(userId, idx);
    round.voterNames.set(userId, userName);
    await this.answerQuiet(cbId, `Принято (вариант ${idx})`);
  }

  /** /off: активный раунд гасится с постом; finished-раунд просто освобождает слот. */
  cancelActive(chatId: string): boolean {
    const round = this.rounds.get(chatId);
    if (!round) return false;
    if (round.finished) {
      this.rounds.delete(chatId);
      return false;
    }
    this.dropRound(round, null);
    void this.sendQuiet({ chatId, text: '🛑 Раунд прерван владельцем' });
    return true;
  }

  /** cancelTimers/shutdown: таймеры сняты, без постов. */
  cancelAllSilent(): void {
    for (const r of this.rounds.values()) clearTimeout(r.timer);
    this.rounds.clear();
  }

  // --- переход collect → vote (синхронные мутации до первого await) ---

  /** expectedToken — защита от выстрела таймера СТАРОГО раунда в новый
   *  (перезапись слота): несовпадение токена → no-op. Без параметра — для тестов. */
  private closeCollect(chatId: string, expectedToken?: string): void {
    const round = this.rounds.get(chatId);
    if (!round || round.finished || round.phase !== 'collect') return;
    if (expectedToken !== undefined && round.token !== expectedToken) return;
    clearTimeout(round.timer);
    if (round.entries.size < IMPROV_MIN_ENTRIES) {
      const text =
        round.entries.size === 0
          ? 'Никто не рискнул. Раунд отменён.'
          : 'Для розыгрыша нужно минимум две пародии — раунд отменён.';
      this.dropRound(round, text);
      return;
    }
    const parodies = [...round.entries.values()].map(
      (e): ImprovVariant => ({
        idx: 0,
        text: e.text,
        // правдоподобная дата — сэмпл активности ИЗОБРАЖАЕМОГО автора (не пародиста)
        dateIso: this.deps.plausibleDate(round.author.fromId) ?? round.author.firstDate,
        authorUserId: e.userId,
        authorName: e.userName,
      }),
    );
    const variants: ImprovVariant[] = [
      ...parodies,
      {
        idx: 0,
        text: round.real.text,
        dateIso: round.real.dateIso,
        authorUserId: null,
        authorName: round.author.name,
      },
    ];
    variants.sort(() => Math.random() - 0.5);
    variants.forEach((v, i) => {
      v.idx = i + 1;
    });
    round.realIdx = variants.findIndex((v) => v.authorUserId === null);
    round.variants = fitVariantsPost(variants);
    round.phase = 'vote';
    round.endsAt = this.deps.now() + this.voteMs;
    round.timer = setTimeout(
      () => this.runTimer(() => this.reveal(chatId, round.token)),
      this.voteMs,
    );
    void this.postVariants(round);
  }

  private async postVariants(round: ImprovRound): Promise<void> {
    if (!round.variants) return;
    const buttons = round.variants.map((v) => ({
      text: String(v.idx),
      callback_data: `vote:${round.token}:${v.idx}`,
    }));
    const msgId = await this.sendQuiet({
      chatId: round.chatId,
      text: variantsPostText(round.author.name, round.variants),
      markup: { inline_keyboard: [buttons] },
    });
    if (msgId === null && this.rounds.get(round.chatId) === round && !round.finished) {
      // варианты никто не увидел — честно гасим раунд (дроп после ретраев редок)
      this.dropRound(round, 'Не получилось собрать голосование — раунд отменён.');
    }
  }

  // --- ревил и очки (весь таймерный путь — в try/catch, не unhandled rejection) ---

  private async reveal(chatId: string, expectedToken?: string): Promise<void> {
    try {
      const round = this.rounds.get(chatId);
      if (!round || round.finished || round.phase !== 'vote' || !round.variants) return;
      if (expectedToken !== undefined && round.token !== expectedToken) return;
      round.finished = true; // check-and-set синхронно до await (гонка голос vs ревил)
      clearTimeout(round.timer);
      const parodyVotes = new Map<number, number>();
      for (const [voterId, idx] of round.votes) {
        const v = round.variants.find((x) => x.idx === idx);
        if (!v) continue;
        if (v.authorUserId === null) {
          this.deps.addScore(chatId, voterId, round.voterNames.get(voterId) ?? 'участник', 1);
          this.deps.awardGame?.(chatId, voterId, 'play', round.seq);
        } else {
          this.deps.addScore(chatId, v.authorUserId, v.authorName, 1);
          parodyVotes.set(idx, (parodyVotes.get(idx) ?? 0) + 1);
        }
      }
      let best = 0;
      for (const n of parodyVotes.values()) if (n > best) best = n;
      const bestParodies =
        best > 0
          ? round.variants.filter((v) => (parodyVotes.get(v.idx) ?? 0) === best && v.authorUserId !== null)
          : [];
      for (const v of bestParodies) {
        this.deps.addScore(chatId, v.authorUserId as string, v.authorName, 1);
        this.deps.awardGame?.(chatId, v.authorUserId as string, 'win', round.seq);
      }

      const real = round.variants[round.realIdx];
      const lines = [
        `🕵️ Раскрытие! Настоящая — вариант ${real.idx}: ${round.author.name} · [${fmtDate(round.real.dateIso)}] · 🔥 ${round.real.reactions}`,
        `«${cut(round.real.text, REAL_TEXT_MAX)}»`,
      ];
      for (const v of round.variants) {
        if (v.authorUserId === null) continue;
        const self = v.authorUserId === round.author.fromId ? ' — изобразил сам себя 🎭' : '';
        lines.push(`🎭 Вариант ${v.idx} — ${v.authorName}${self}`);
      }
      if (bestParodies.length > 0) {
        lines.push(
          `🏅 Золотой шарж: ${bestParodies.map((v) => `вариант ${v.idx} (${v.authorName})`).join(', ')}`,
        );
      }
      const top = this.deps.topScores(chatId);
      if (top) lines.push(`🏆 Сессия: ${top}`);
      await this.sendQuiet({ chatId, text: lines.join('\n') });
      this.lastEndAt.set(chatId, this.deps.now());
    } catch (err) {
      this.deps.log(`ревил упал: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- служебное ---

  private runTimer(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.deps.log(`таймер раунда упал: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private cancelForRights(round: ImprovRound): void {
    this.dropRound(round, 'Не смог скрыть записи — дай боту права администратора (удаление сообщений). Раунд отменён.');
  }

  /** Снять таймер, освободить слот, при тексте — постить (дроп поста не критичен). */
  private dropRound(round: ImprovRound, text: string | null): void {
    clearTimeout(round.timer);
    round.finished = true;
    if (this.rounds.get(round.chatId) === round) {
      this.rounds.delete(round.chatId);
      this.lastEndAt.set(round.chatId, this.deps.now());
    }
    if (text) void this.sendQuiet({ chatId: round.chatId, text });
  }

  private async editCounter(round: ImprovRound): Promise<void> {
    if (round.announceMsgId === null) return;
    const text = announceText(round, this.deps.now(), this.minWindowMs);
    try {
      const ok = await this.deps.edit(round.chatId, round.announceMsgId, text);
      if (!ok) this.deps.log(`счётчик не отредактирован (chat=${round.chatId} msg=${round.announceMsgId})`);
    } catch (err) {
      this.deps.log(`правка счётчика упала: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async sendQuiet(m: OutboundMessage): Promise<number | null> {
    try {
      return await this.deps.send(m);
    } catch (err) {
      this.deps.log(`отправка упала: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Итог удаления: ok — скрыто; denied — Bot API отказал (400/403 = не админ);
   *  error — сетевой сбой (тексты для игрока разные, раунд гасится в обоих случаях). */
  private async deleteQuiet(chatId: string, msgId: number): Promise<'ok' | 'denied' | 'error'> {
    try {
      return (await this.deps.del(chatId, msgId)) ? 'ok' : 'denied';
    } catch (err) {
      this.deps.log(
        `deleteMessage упал (chat=${chatId} msg=${msgId}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'error';
    }
  }

  private async answerQuiet(cbId: string, text?: string): Promise<void> {
    try {
      await this.deps.answer(cbId, text);
    } catch (err) {
      this.deps.log(`answerCallbackQuery упал: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// --- форматирование ---

/** Копия bot.ts (formatDate/truncate) — без циклического импорта. */
function fmtDate(dateIso: string): string {
  const d = dateIso.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return dateIso;
  return `${day}.${m}.${y}`;
}

function cut(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

function announceText(round: ImprovRound, now: number, minWindowMs: number): string {
  const theme = round.theme ? ` — «${round.theme}»` : '';
  const n = round.entries.size;
  const startingNow = n >= IMPROV_MAX_ENTRIES && now - round.collectStartsAt < minWindowMs;
  return [
    `🎭 Изобрази ${round.author.name}${theme}`,
    'Реплаем на это сообщение спародируй его манеру. Одна запись на человека, можно перезаписать; в дело пойдут первые 3.',
    '⏱ 3 минуты — потом угадываем, где настоящая цитата.',
    `✍️ Принято: ${n}/${IMPROV_MAX_ENTRIES}${startingNow ? ' — стартую…' : ''}`,
  ].join('\n');
}

function variantsPostText(authorName: string, variants: ImprovVariant[]): string {
  const header = `🎭 Изобрази ${authorName}: голосование!`;
  const frame = `Одно из ${variants.length} — настоящая цитата ${authorName}. Голосуй, где не врём 😏`;
  return [
    header,
    '',
    frame,
    ...variants.map((v) => `${v.idx}. [${fmtDate(v.dateIso)}] «${v.text}»`),
  ].join('\n');
}

/** Гарантия одного куска ≤3900: капы записи (300) и настоящей (400) дают
 *  худший случай ~1.7k знаков против бюджета — режем на капах, иного не нужно. */
function fitVariantsPost(variants: ImprovVariant[]): ImprovVariant[] {
  return variants.map((v) => ({
    ...v,
    text: cut(v.text, v.authorUserId === null ? REAL_TEXT_MAX : IMPROV_ENTRY_MAX_LEN),
  }));
}

/** Гард «запись ≠ настоящая»: равенство/подстрока/≥80% токенов после нормализации. */
export function looksLikeReal(entry: string, real: string): boolean {
  const a = normalizeName(entry);
  const b = normalizeName(real);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = new Set(b.split(' ').filter(Boolean));
  if (tokensA.length === 0) return false;
  const hits = tokensA.filter((t) => tokensB.has(t)).length;
  return hits / tokensA.length >= 0.8;
}
