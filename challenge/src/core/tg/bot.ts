// Бот «Медиум» (M1) — память и шаржист чата «Факты в чате».
// Спек: prompts/factchempik-bot.md; решения консилиума: swarm-report/factchempik-plan-01.md.
//
// Железная граница: реальные цитаты — только SQL/FTS по tg.sqlite, атрибуция по
// from_id КОДОМ, дата в выводе всегда; воображаемое (M3) — только через 🎭-маркер
// (гейт в jokerMarker.ts). Сеть — Bot API через netFetch (botApi.ts). Логи —
// только метаданные (chat_id/msg_id/счётчики), тексты сообщений не логируются.
// Исходящие из БД данные — только в чаты из allow-list (fail-closed).

import { rmSync, renameSync } from 'node:fs';
import { getTgBotRuntimeConfig, getKakbyLlmConfig } from '../env.js';
import { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { ChatMessage } from '../types.js';
import { dataPath } from '../paths.js';
import { BotApiClient, BotApiError } from './botApi.js';
import type { TgUpdate, TgCallbackQuery, TgUser } from './botApi.js';
import { BotStore } from './botStore.js';
import type { TgMessageRow } from './tgStore.js';
import { FtsStore } from './ftsStore.js';
import { buildFtsQuery, scoreQuote, themeFromReplyText, tokenizeTheme } from './botFtsQuery.js';
import { resolveAuthor, resolveGreedyName, collectAliasCandidates } from './botNames.js';
import type { AuthorEntry, ResolveResult } from './botNames.js';
import { extractInvocation, BOT_COMMAND_DESCRIPTIONS } from './botCommands.js';
import type { ParsedCommand } from './botCommands.js';
import { OutboxQueue, SendError, UserCommandQueue, ConcurrencyLimiter, errText } from './botQueue.js';
import type { OutboundMessage, InlineKeyboard } from './botQueue.js';
import { ImprovGame } from './botImprov.js';
import { guardImaginedReply } from './jokerMarker.js';
import { BotAutomationCommands } from './botAutomation.js';
import { createTgAutomationRunner } from './automationRun.js';
import { GamificationDb } from '../gamification.js';

// Целевой чат фичи (t.me/lookAtFactsChat). Бот отвечает в любом чате из
// allow-list, но данные (цитаты/игра) — всегда из этого чата.
export const BOT_CHAT_KEY = '-1001736860345';
export const BOT_TOPIC_ID = 0;
// Бот-канал «Иди на факты глянь» — НЕ участник: исключён из цитат/игры/каталога.
export const BOT_CHANNEL_FROM_ID = '-1001298193122';

// SEED алиасов (проверены lookup по tg.sqlite 2026-09-24). «вячеслав» НЕ сажаем:
// подстрока матчит 9 from_id — это кейс дизамбиг-кнопок, а не словаря.
const SEED_ALIASES: Readonly<Record<string, string>> = {
  'савелий': '662123302',
  'saveliy': '662123302',
  'sevens': '587493810',
  'севенс': '587493810',
  'краснобелый': '1321375335',
  'краснобелий': '1321375335',
  'тема': '514816799',
  'тёма': '514816799',
  'темыч': '514816799',
  'темич': '514816799',
  'дед': '5155693649',
  'уберпончик': '5155693649',
  'uberponchik': '5155693649',
};

const GAME_ROUND_MS = 90_000;
const RESOLVE_TTL_MS = 60_000;
const SAID_PAGE_TTL_MS = 10 * 60_000;
const KAKBY_SESSION_TTL_MS = 10 * 60_000;
const SPAM_HINT = 'Слишком много команд подряд — отдохни немного.';
const START_INTRO = [
  '🎭 О, здравствуйте! Я — Медиум, дух-память чата «Факты в чате».',
  '',
  'Я прочитал этот чат целиком: от первого сообщения 2021 года',
  'до последнего «ахахаха». Ничего не забыл. Ни-че-го.',
  '',
  'Команды (теперь с префиксом medium_/м, чтобы не дублировать других ботов):',
  '/medium_quote — случайная жемчужина из истории чата',
  '/medium_quote Вася — жемчужина конкретного человека',
  '/medium_said Вася парковка — всё, что Вася говорил про парковку',
  '/medium_game — игра: угадай по фразе, кто это сказал',
  '/medium_improv Вася — вы пародируете Васю, чат голосует',
  '/medium_asif Вася — вызвать духа Васи и поговорить с ним:',
  'продолжение — реплай на его ответ или @Медиум <текст>,',
  '/medium_asif стоп — отпустить духа. Реплики духа — выдумка, помечены 🎭.',
  '',
  'Имя пишите как привыкли: ник, имя, прозвище — разберусь.',
  'Если кандидатов несколько — предложу кнопки на выбор.',
  'Понимаю и кириллицу: /мцитата, /мсказал, /мигра, /мизобрази, /мкакбы.',
  'Старые имена (/quote, /цитата и т.п.) тоже работают, но в меню бота — только новые.',
  'Играем в самом чате «Факты в чате» — там я и обитаю.',
].join('\n');
const START_INTRO_OWNER =
  '\n\nТвои админские: /stat, /alias, /aliasscan, /reindex, /off, /on (кириллицей: /стат, /алиас, /алиасскан). Никому не говори.';

export interface RunTgBotOpts {
  /** Собрать/доклеить FTS-индекс и выйти (без сети). */
  indexOnly?: boolean;
  /** Полная перестройка FTS (иначе инкрементальный догон). */
  rebuildIndex?: boolean;
}

export async function runTgBot(opts: RunTgBotOpts = {}): Promise<void> {
  const cfg = getTgBotRuntimeConfig();
  if (!cfg) {
    console.error('tg-bot: TG_BOT_TOKEN не задан (см. .env.example).');
    process.exit(1);
  }
  if (cfg.allowChats.size === 0) {
    console.error(
      'tg-bot: TG_BOT_ALLOW_CHATS пуст — бот НЕ работает (fail-closed). ' +
        'Добавь в .env строку вида TG_BOT_ALLOW_CHATS=-1001736860345.',
    );
    process.exit(1);
  }
  console.error(
    `[tg-bot] allow-list: ${cfg.allowChats.size} чат(ов); owner: ` +
      (cfg.ownerChatId ? 'задан' : 'НЕ задан (админ-команды недоступны)'),
  );

  const store = new BotStore(dataPath('tg.sqlite'));
  const fts = new FtsHolder(dataPath('tg-fts.sqlite'));
  const seeded = store.ensureSeedAliases(SEED_ALIASES);
  if (seeded > 0) console.error(`[tg-bot] seed-алиасов добавлено: ${seeded}`);

  if (opts.rebuildIndex) {
    console.error('[tg-bot] FTS: полная перестройка в свежий файл…');
    const r = rebuildFtsFull(store, fts);
    console.error(`[tg-bot] FTS: пересобрано ${r.added} док. за ${(r.ms / 1000).toFixed(1)} с`);
  } else {
    fts.discardBuildArtifacts();
    fts.open();
  }
  const idx = catchUpFtsIndex(store, fts.get());
  console.error(
    `[tg-bot] FTS: +${idx.added} док. за ${(idx.ms / 1000).toFixed(1)} с; ` +
      `всего ${fts.get().countDocs()}, курсор msg_id=${idx.maxId}, ` +
      `файл ${(fts.get().fileSizeBytes() / 1024 / 1024).toFixed(1)} МБ`,
  );
  if (opts.indexOnly) {
    store.close();
    fts.close();
    return;
  }

  const api = new BotApiClient(cfg.botToken);
  let me: TgUser;
  try {
    me = await api.getMe();
  } catch (err) {
    console.error(`tg-bot: getMe не прошёл — ${errText(err)}`);
    store.close();
    fts.close();
    process.exit(1);
  }
  console.error(`[tg-bot] бот: @${me.username ?? String(me.id)}`);
  try {
    await api.deleteWebhook();
  } catch (err) {
    console.error(`[tg-bot] deleteWebhook (не фатально): ${errText(err)}`);
  }
  // Меню команд: кириллицу Bot API в меню не принимает ([a-z0-9_]{1,32} — BOT_COMMAND_INVALID),
  // поэтому публикуем брендированные латинские имена (/medium_quote и т.д.).
  // Парсер по-прежнему понимает старые имена (/quote, /цитата) как алиасы.
  const menu = (Object.entries(BOT_COMMAND_DESCRIPTIONS) as [string, string][]).map(
    ([command, description]) => ({ command, description }),
  );
  const publicMenu = menu.filter((c) =>
    ['medium_quote', 'medium_said', 'medium_game', 'medium_improv', 'medium_asif', 'medium_level'].includes(c.command),
  );
  try {
    await api.setMyCommands(publicMenu);
    if (cfg.ownerChatId) {
      await api.setMyCommands(menu, { type: 'chat', chat_id: Number(cfg.ownerChatId) });
    }
    console.error(
      `[tg-bot] setMyCommands: ${publicMenu.length} публичных` +
        (cfg.ownerChatId ? ` + ${menu.length} админских (чат owner)` : ''),
    );
  } catch (err) {
    console.error(`[tg-bot] setMyCommands (не фатально): ${errText(err)}`);
  }

  const queue = new OutboxQueue({
    sender: async (m) => {
      try {
        return await api.sendMessage(m.chatId, m.text, { replyTo: m.replyTo, markup: m.markup });
      } catch (err) {
        if (err instanceof BotApiError) throw new SendError(err.message, err.retryAfterSec);
        throw err;
      }
    },
    onError: (msg) => console.error(`[tg-bot][queue] ${msg}`),
  });

  // Блог-автоматизация (/блоги, /авто) и XP-профиль (/уровень): core-раннер и
  // геймификация живут в .data/*.sqlite рядом с tg.sqlite (пути — dataPath).
  const automationRunner = createTgAutomationRunner();
  const gamification = new GamificationDb(dataPath('gamification.sqlite'));
  const automationCommands = new BotAutomationCommands({
    automation: automationRunner.automation,
    blogs: automationRunner.blogs,
    send: (chatId, text, replyTo) => queue.enqueue({ chatId, text, replyTo }),
  });

  const session = { startedAt: Date.now(), updatesSeen: 0, enabled: store.getState('enabled') !== '0' };
  const bot = new MediumBot({
    api,
    store,
    fts,
    queue,
    commandQueue: new UserCommandQueue(),
    kakbyLimiter: new ConcurrencyLimiter(3),
    directory: new AuthorDirectory(store),
    cfg,
    session,
    botId: String(me.id),
    botUsername: me.username,
    automationCommands,
    gamification,
  });

  let offset = Number(store.getState('poll_offset') ?? '0') || 0;
  const seen = new Set<number>();
  let backoffMs = 0;
  let shuttingDown = false;
  const abort = new AbortController();
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('[tg-bot] SIGINT/SIGTERM — завершаюсь: drain очереди, persist offset…');
    abort.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  while (!shuttingDown) {
    let updates: TgUpdate[];
    try {
      updates = await api.getUpdates(offset, cfg.pollTimeoutSec, ['message', 'callback_query'], abort.signal);
    } catch (err) {
      if (shuttingDown || abort.signal.aborted) break;
      if (err instanceof BotApiError && err.code === 409) {
        console.error('tg-bot: 409 Conflict — токен уже используется (второй инстанс или webhook). Выхожу.');
        store.close();
        fts.close();
        process.exit(1);
      }
      // Сетевой сбой → backoff ×2 (cap 30 с), НЕ exit (спек §2).
      backoffMs = backoffMs === 0 ? 1000 : Math.min(backoffMs * 2, 30_000);
      console.error(`[tg-bot] poll error (${errText(err)}); пауза ${backoffMs} мс`);
      await sleepAbortable(backoffMs, abort.signal);
      continue;
    }
    backoffMs = 0;
    for (const u of updates) {
      if (seen.has(u.update_id)) {
        offset = u.update_id + 1;
        continue;
      }
      seen.add(u.update_id);
      if (seen.size > 20_000) seen.clear();
      session.updatesSeen++;
      try {
        await bot.handleUpdate(u);
      } catch (err) {
        console.error(`[tg-bot] handler error (update_id=${u.update_id}): ${errText(err)}`);
      }
      offset = u.update_id + 1;
      store.setState('poll_offset', String(offset));
    }
  }

  bot.cancelTimers();
  await Promise.race([queue.drain(), sleepAbortable(5_000, abort.signal)]);
  store.setState('poll_offset', String(offset));
  store.close();
  fts.close();
  automationRunner.close();
  gamification.close();
  console.error('[tg-bot] остановлен.');
  process.exit(0);
}

interface MediumDeps {
  api: BotApiClient;
  store: BotStore;
  fts: FtsHolder;
  queue: OutboxQueue;
  commandQueue: UserCommandQueue;
  kakbyLimiter: ConcurrencyLimiter;
  directory: AuthorDirectory;
  cfg: NonNullable<ReturnType<typeof getTgBotRuntimeConfig>>;
  session: { startedAt: number; updatesSeen: number; enabled: boolean };
  botId: string;
  botUsername?: string;
  /** /уровень: глобальный XP-профиль (геймификация). Опционально — тесты бота. */
  gamification?: GamificationDb;
  /** /блоги и /авто: команды блог-автоматизации. Опционально — тесты бота. */
  automationCommands?: BotAutomationCommands;
  /** Генератор реплики /какбы (инъекция для тестов; дефолт — LLM DeepSeek). */
  generateImitation?: (author: AuthorEntry, history: ChatMessage[], samples: string[]) => Promise<string>;
}

interface CommandCtx {
  chatId: string;
  userId: string;
  userName: string;
  replyTo: number;
  replyText?: string;
  isOwner: boolean;
}

interface PendingResolve {
  chatId: string;
  cmdName: 'цитата' | 'сказал' | 'изобрази' | 'какбы' | 'алиасскан';
  argsText: string;
  replyTo: number;
  replyText?: string;
  expiresAt: number;
}

/** Диалог с «духом» автора (/какбы): persona + few-shot сэмплы + история реплик. */
interface KakbySession {
  author: AuthorEntry;
  samples: string[];
  /** user/assistant пары диалога (assistant — без 🎭-строки), ≤ 12. */
  history: ChatMessage[];
  /** msg_id реплик «духа» — реплай на них продолжает диалог (≤ 20). */
  botMsgIds: Set<number>;
  /** Sliding TTL: каждая реплика продлевает. */
  expiresAt: number;
}

interface SaidPage {
  chatId: string;
  fromId: string;
  name: string;
  theme: string;
  matchQuery: string;
  offset: number;
  expiresAt: number;
}

interface SaidSearchResult {
  scored: Array<{ row: TgMessageRow; score: number }>;
  total: number;
}

interface GameRound {
  seq: number;
  chatId: string;
  correctFromId: string;
  options: Array<{ fromId: string; label: string }>;
  quoteText: string;
  quoteDate: string;
  quoteReactions: number;
  endsAt: number;
  timer: NodeJS.Timeout;
  finished: boolean;
}

export class MediumBot {
  private readonly pending = new Map<string, PendingResolve>();
  private readonly saidPages = new Map<string, SaidPage>();
  private readonly kakbySessions = new Map<string, KakbySession>();
  private readonly rounds = new Map<string, GameRound>();
  private readonly scores = new Map<string, Map<string, { name: string; score: number }>>();
  /** Окно anti-повтора: msg_id последних показанных цитат на чат (игра — 30). */
  private static readonly QUOTE_AVOID_GAME = 30;
  /** Кап для узких пулов (авторские цитаты), чтобы не вычитать пул дочерна. */
  private static readonly QUOTE_AVOID_NARROW = 5;
  private readonly lastQuotes = new Map<string, number[]>();
  private readonly improv: ImprovGame;
  private roundSeq = 0;

  constructor(private readonly d: MediumDeps) {
    this.improv = new ImprovGame({
      send: (m) => d.queue.enqueue(m),
      del: (chatId, msgId) => d.api.deleteMessage(chatId, msgId),
      edit: (chatId, msgId, text, markup) => d.api.editMessageText(chatId, msgId, text, { markup }),
      answer: (cbId, text) => this.safeAnswer(cbId, text),
      plausibleDate: (fromId) => d.store.sampleAuthorDate(BOT_CHAT_KEY, BOT_TOPIC_ID, fromId),
      addScore: (chatId, userId, name, delta) => this.addScore(chatId, userId, name, delta),
      topScores: (chatId) => this.topScoresLine(chatId),
      // XP за TG-игры (#59): сбой геймификации не должен срывать ревил раунда.
      // ref с номером раунда: события разных раундов различимы (#94).
      awardGame: (chatId, userId, kind, roundSeq) => {
        try {
          d.gamification?.award(
            kind === 'win' ? 'tg_game_win' : 'tg_game_play',
            `improv:${chatId}:${roundSeq}:${userId}`,
          );
        } catch (err) {
          console.error(`[tg-bot][improv] award XP упал: ${errText(err)}`);
        }
      },
      now: () => Date.now(),
      log: (msg) => console.error(`[tg-bot][improv] ${msg}`),
    });
  }

  cancelTimers(): void {
    for (const r of this.rounds.values()) clearTimeout(r.timer);
    this.rounds.clear();
    this.improv.cancelAllSilent();
  }

  async handleUpdate(u: TgUpdate): Promise<void> {
    if (u.callback_query) {
      await this.handleCallback(u.callback_query);
      return;
    }
    const msg = u.message;
    if (!msg || !msg.from) return;
    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    if (msg.from.is_bot || userId === this.d.botId) return;

    const isOwner = this.isOwner(userId);
    if (!this.d.session.enabled && !isOwner) return;

    const rawText = (msg.text ?? msg.caption ?? '').trim();
    // /start парсер не проходит (нет в BOT_COMMANDS) — ловим отдельно, включая deep-link payload.
    const startM = /^\/start(?:@(\S+))?(?:\s+[\s\S]*)?$/i.exec(rawText);
    const startBot = startM?.[1]?.toLowerCase();
    if (startM && (startBot === undefined || startBot === this.d.botUsername?.toLowerCase())) {
      // Интро: в личке — каждому, в разрешённом чате — всем участникам.
      // В чужих группах (бот сидит там не ради Медиума) молчим.
      const isPrivate = msg.chat.type === 'private';
      if (isPrivate || this.d.cfg.allowChats.has(chatId)) {
        const intro = isOwner ? START_INTRO + START_INTRO_OWNER : START_INTRO;
        await this.reply(chatId, intro, msg.message_id);
      }
      return;
    }
    const cmd = extractInvocation(msg.text ?? msg.caption, this.d.botUsername);

    if (msg.chat.type === 'private' ? !isOwner : !this.d.cfg.allowChats.has(chatId)) return;

    // Активный диалог /какбы: реплай на реплику «духа» или @бот с текстом —
    // продолжение разговора в манере автора. Команды (cmd !== null) важнее.
    let kakbyText: string | null = null;
    if (cmd === null && rawText) {
      const session = this.kakbySessions.get(chatId);
      if (session) {
        if (session.expiresAt < Date.now()) {
          this.kakbySessions.delete(chatId);
        } else {
          const replyToSpirit =
            msg.reply_to_message !== undefined &&
            session.botMsgIds.has(msg.reply_to_message.message_id);
          const mention = this.d.botUsername
            ? rawText.toLowerCase().includes(`@${this.d.botUsername.toLowerCase()}`)
            : false;
          if (replyToSpirit) {
            kakbyText = rawText;
          } else if (mention) {
            // TG-юзернеймы [a-zA-Z0-9_] — regex-безопасны без экранирования.
            const rest = rawText
              .replaceAll(new RegExp(`@${this.d.botUsername}`, 'gi'), ' ')
              .trim();
            if (rest) kakbyText = rest;
          }
        }
      }
    }

    // Голый пинг «@бот» без команды — подсказка вместо тишины.
    const ping = this.d.botUsername
      ? rawText.toLowerCase().includes(`@${this.d.botUsername.toLowerCase()}`)
      : false;
    if (cmd === null && !kakbyText && ping) {
      await this.reply(
        chatId,
        '🎭 Слушаю. Команды: /medium_quote [имя], /medium_said <имя> <тема>, /medium_game, /medium_improv <имя>, /medium_asif <имя> [тема] — или /start.',
        msg.message_id,
      );
      return;
    }

    // Реплай на анонс «Изобрази» — всегда запись (даже если текст начинается с «/»);
    // жёсткое сравнение message_id отсекает реплаи на другие карточки бота.
    if (msg.reply_to_message && this.improv.isCollectAnnounce(chatId, msg.reply_to_message.message_id)) {
      try {
        await this.improv.handleEntry({
          chatId,
          msgId: msg.message_id,
          userId,
          userName: msg.from.first_name ?? msg.from.username ?? 'участник',
          replyToMessageId: msg.reply_to_message.message_id,
          text: msg.text,
        });
      } catch (err) {
        console.error(`[tg-bot] improv entry (chat=${chatId} user=${userId}): ${errText(err)}`);
      }
      return;
    }

    if (!cmd && !kakbyText) return;

    const userName = msg.from.first_name ?? msg.from.username ?? 'участник';
    const run = async (): Promise<void> => {
      if (cmd) {
        const ctx: CommandCtx = {
          chatId,
          userId,
          userName,
          replyTo: msg.message_id,
          replyText: msg.reply_to_message?.text,
          isOwner,
        };
        try {
          await this.dispatch(cmd, ctx);
        } catch (err) {
          console.error(`[tg-bot] команда /${cmd.name} упала (chat=${chatId} user=${userId}): ${errText(err)}`);
          await this.reply(chatId, '⚠️ Внутренняя ошибка, попробуй ещё раз.', ctx.replyTo);
        }
        return;
      }
      // Продолжение диалога с духом.
      const session = this.kakbySessions.get(chatId);
      if (!session || session.expiresAt < Date.now()) {
        this.kakbySessions.delete(chatId);
        return;
      }
      await this.kakbyTurn(chatId, session, `${userName}: ${kakbyText}`, msg.message_id);
    };

    if (isOwner) {
      await run();
      return;
    }
    const accepted = this.d.commandQueue.submit(userId, run);
    if (accepted) {
      await accepted;
    } else {
      await this.reply(chatId, SPAM_HINT, msg.message_id);
    }
  }

  // --- dispatch ---

  private async dispatch(cmd: ParsedCommand, ctx: CommandCtx): Promise<void> {
    switch (cmd.name) {
      case 'цитата':
        return this.cmdQuote(cmd.args, ctx);
      case 'сказал':
        return this.cmdSaid(cmd.args, ctx);
      case 'игра':
        return this.cmdGame(ctx);
      case 'изобрази':
        return this.cmdImprov(cmd.args, ctx);
      case 'какбы':
        return this.cmdKakby(cmd.args, ctx);
      case 'уровень':
        return this.cmdLevel(ctx);
      default:
        break;
    }
    if (!ctx.isOwner) return; // админ-команды — только owner, остальным молчание
    switch (cmd.name) {
      case 'reindex':
        return this.cmdReindex(ctx);
      case 'алиас':
        return this.cmdAlias(cmd.args, ctx);
      case 'алиасскан':
        return this.cmdAliasScan(cmd.args, ctx);
      case 'off':
        return this.cmdSetEnabled(false, ctx);
      case 'on':
        return this.cmdSetEnabled(true, ctx);
      case 'стат':
        return this.cmdStat(ctx);
      case 'блоги':
        if (!this.d.automationCommands) {
          await this.reply(ctx.chatId, 'Автоматизация не сконфигурирована.', ctx.replyTo);
          return;
        }
        return this.d.automationCommands.cmdBlogs(ctx.chatId, ctx.replyTo);
      case 'авто':
        if (!this.d.automationCommands) {
          await this.reply(ctx.chatId, 'Автоматизация не сконфигурирована.', ctx.replyTo);
          return;
        }
        return this.d.automationCommands.cmdAuto(cmd.args, ctx.chatId, ctx.replyTo);
      default:
        return;
    }
  }

  /** /уровень — глобальный XP-профиль чата (уровень/XP/серия/прогресс). */
  private async cmdLevel(ctx: CommandCtx): Promise<void> {
    const gamification = this.d.gamification;
    if (!gamification) {
      await this.reply(ctx.chatId, 'Геймификация недоступна.', ctx.replyTo);
      return;
    }
    const s = gamification.getStats();
    const pct = Math.round(s.levelProgress * 100);
    await this.reply(
      ctx.chatId,
      `🏆 Уровень ${s.level} · ${s.xp} XP (до уровня ${s.level + 1} — ${s.nextLevelXp} XP, прогресс ${pct}%).\n` +
        `🔥 Серия: ${s.streak} дн. (рекорд: ${s.bestStreak} дн.)`,
      ctx.replyTo,
    );
  }

  private async cmdQuote(args: string, ctx: CommandCtx): Promise<void> {
    const store = this.d.store;
    const words = args.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      // кап окна: топ-пул широкий, но avoid в COUNT+OFFSET вычитает дочерна
      const avoid = this.lastQuotesFor(ctx.chatId, MediumBot.QUOTE_AVOID_NARROW);
      const row = store.randomTopQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, {
        minReactions: 3,
        excludeFromId: BOT_CHANNEL_FROM_ID,
        avoidMsgIds: avoid,
      });
      if (!row) {
        await this.reply(ctx.chatId, 'Топ-цитаты кончились (или база пуста).', ctx.replyTo);
        return;
      }
      this.rememberQuote(ctx.chatId, row.msg_id);
      await this.reply(ctx.chatId, formatQuoteCard(row), ctx.replyTo);
      return;
    }
    const { name: nameCandidate, themeWords, result: nameResult } = resolveGreedyName(words, (q) =>
      this.resolveOnce(q),
    );
    const theme = themeWords.join(' ');
    if (nameResult.kind === 'ok') {
      if (theme) {
        const matchQuery = buildFtsQuery(theme);
        if (!matchQuery) {
          await this.reply(ctx.chatId, 'В теме одни стоп-слова. Конкретизируй.', ctx.replyTo);
          return;
        }
        await this.sendSaidQuotes(nameResult.author, theme, matchQuery, ctx);
      } else {
        await this.sendAuthorQuote(nameResult.author, ctx);
      }
      return;
    }
    // Имя может быть многословным и без темы: пробуем аргумент целиком.
    const whole = this.resolveOnce(args);
    const r = whole.kind !== 'none' ? whole : nameResult;
    await this.runResolved(r, nameCandidate, ctx, 'цитата', theme);
  }

  private async cmdSaid(args: string, ctx: CommandCtx): Promise<void> {
    const words = args.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      await this.reply(
        ctx.chatId,
        'Формат: /сказал <имя> [тема…] — или реплай на сообщение бота.',
        ctx.replyTo,
      );
      return;
    }
    const { name: nameCandidate, themeWords, result: nameResult } = resolveGreedyName(words, (q) =>
      this.resolveOnce(q),
    );
    let theme = themeWords.join(' ');
    if (!theme && ctx.replyText) theme = themeFromReplyText(ctx.replyText);
    if (!theme) {
      await this.reply(
        ctx.chatId,
        'Про что искать? Добавь тему: /сказал <имя> <тема…> (или реплай на сообщение).',
        ctx.replyTo,
      );
      return;
    }
    const matchQuery = buildFtsQuery(theme);
    if (!matchQuery) {
      await this.reply(ctx.chatId, 'В теме одни стоп-слова. Конкретизируй.', ctx.replyTo);
      return;
    }
    if (nameResult.kind === 'ok') {
      await this.sendSaidQuotes(nameResult.author, theme, matchQuery, ctx);
      return;
    }
    await this.runResolved(nameResult, nameCandidate, ctx, 'сказал', theme);
  }

  private resolveOnce(query: string): ResolveResult {
    return resolveAuthor(query, this.d.directory.get(), this.d.store.listAliases());
  }

  /** ambiguous → inline-кнопки (60 с); none → отказ с 3 подсказками. */
  private async runResolved(
    r: ResolveResult,
    query: string,
    ctx: CommandCtx,
    cmdName: 'цитата' | 'сказал' | 'изобрази' | 'какбы' | 'алиасскан',
    argsText: string,
  ): Promise<void> {
    if (r.kind === 'ok') {
      if (cmdName === 'сказал') await this.sendSaidQuotes(r.author, argsText, buildFtsQuery(argsText), ctx);
      else if (cmdName === 'изобрази') await this.cmdImprovStart(r.author, argsText, ctx);
      else if (cmdName === 'какбы') await this.cmdKakbyStart(r.author, argsText, ctx);
      else if (cmdName === 'алиасскан') await this.cmdAliasScan(r.author.name, ctx);
      else if (cmdName === 'цитата' && argsText) {
        await this.sendSaidQuotes(r.author, argsText, buildFtsQuery(argsText), ctx);
      } else await this.sendAuthorQuote(r.author, ctx);
      return;
    }
    if (r.kind === 'ambiguous') {
      this.sweepPending();
      const token = Math.random().toString(36).slice(2, 10);
      this.pending.set(token, {
        chatId: ctx.chatId,
        cmdName,
        argsText,
        replyTo: ctx.replyTo,
        replyText: ctx.replyText,
        expiresAt: Date.now() + RESOLVE_TTL_MS,
      });
      const buttons = r.options.slice(0, 8).map((o) => ({
        text: `${truncate(o.name, 20)} · ${o.textMessages} сообщ. · ${o.firstDate.slice(0, 4)}–${o.lastDate.slice(0, 4)}`,
        callback_data: `res:${token}:${o.fromId}`,
      }));
      await this.send({
        chatId: ctx.chatId,
        text: `«${query}» — уточни, кто именно:`,
        replyTo: ctx.replyTo,
        markup: { inline_keyboard: [buttons] },
      });
      return;
    }
    const names = r.suggestions.map((s) => s.name).join(', ');
    await this.reply(
      ctx.chatId,
      `Не знаю автора «${query}».${names ? ` Ближайшие: ${names}.` : ''}`,
      ctx.replyTo,
    );
  }

  private async sendAuthorQuote(author: AuthorEntry, ctx: CommandCtx): Promise<void> {
    // кап окна: пул одного автора узкий, avoid в COUNT+OFFSET вычитает дочерна
    const avoid = this.lastQuotesFor(ctx.chatId, MediumBot.QUOTE_AVOID_NARROW);
    const row = this.d.store.randomAuthorQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, author.fromId, 3, avoid);
    if (!row) {
      await this.reply(
        ctx.chatId,
        `У ${author.name} пока нет цитат в топе. Попробуй /сказал ${author.name} <тема>.`,
        ctx.replyTo,
      );
      return;
    }
    this.rememberQuote(ctx.chatId, row.msg_id);
    await this.reply(ctx.chatId, formatQuoteCard(row), ctx.replyTo);
  }

  private async sendSaidQuotes(
    author: AuthorEntry,
    theme: string,
    matchQuery: string,
    ctx: CommandCtx,
  ): Promise<void> {
    if (!matchQuery) {
      await this.reply(ctx.chatId, 'В теме одни стоп-слова. Конкретизируй.', ctx.replyTo);
      return;
    }
    // Тема для показа — без стоп-слов («про Кайседо» → «Кайседо»), регистр сохраняем.
    const displayTheme =
      theme
        .split(/\s+/)
        .filter((w) => tokenizeTheme(w).length > 0)
        .join(' ') || theme;
    let result: SaidSearchResult;
    try {
      result = this.searchSaidScored(author.fromId, matchQuery);
    } catch {
      await this.reply(ctx.chatId, 'Не смог разобрать тему, попробуй другими словами.', ctx.replyTo);
      return;
    }
    if (result.scored.length === 0) {
      await this.reply(ctx.chatId, `Про «${displayTheme}» ${author.name} молчал.`, ctx.replyTo);
      return;
    }
    await this.sendSaidBatch(
      ctx.chatId,
      { fromId: author.fromId, name: author.name, theme: displayTheme, matchQuery, offset: 0 },
      result,
      ctx.replyTo,
    );
  }

  /** Поиск /сказал целиком: FTS-хиты → скоринг по реакциям+свежести, без среза топ-5. */
  private searchSaidScored(fromId: string, matchQuery: string): SaidSearchResult {
    const hits = this.d.fts.get().search(BOT_CHAT_KEY, matchQuery, fromId, 200);
    const rows = this.d.store.getMessagesByKeys(
      BOT_CHAT_KEY,
      hits.map((h) => ({ topicId: h.topicId, msgId: h.msgId })),
    );
    const now = Date.now();
    const scored = [...rows.values()]
      .map((row) => ({ row, score: scoreQuote(row.reaction_total, row.date_iso, now) }))
      .sort((a, b) => b.score - a.score);
    return { scored, total: hits.length };
  }

  /** Один лист выдачи /сказал (5 шт.) + кнопка «Ещё», если остались. */
  private async sendSaidBatch(
    chatId: string,
    page: { fromId: string; name: string; theme: string; matchQuery: string; offset: number },
    result: SaidSearchResult,
    replyTo?: number,
  ): Promise<void> {
    const batch = result.scored.slice(page.offset, page.offset + 5);
    if (batch.length === 0) {
      await this.send({ chatId, text: `Про «${page.theme}» больше ничего нет.`, replyTo });
      return;
    }
    const items = batch
      .map((s, i) => `${page.offset + i + 1}. [${formatDate(s.row.date_iso)}] ${truncate(s.row.text, 500)}`)
      .join('\n');
    const header =
      page.offset === 0
        ? `💬 ${page.name} про «${page.theme}»:\n\n`
        : `💬 ${page.name} про «${page.theme}» (продолжение):\n\n`;
    const remaining = result.scored.length - (page.offset + batch.length);
    const footer =
      remaining === 0 && result.total > result.scored.length
        ? `\n\n(показаны лучшие ${result.scored.length} из ${result.total} найденных)`
        : '';
    let markup: InlineKeyboard | undefined;
    if (remaining > 0) {
      this.sweepPending();
      const token = Math.random().toString(36).slice(2, 10);
      this.saidPages.set(token, {
        chatId,
        fromId: page.fromId,
        name: page.name,
        theme: page.theme,
        matchQuery: page.matchQuery,
        offset: page.offset + batch.length,
        expiresAt: Date.now() + SAID_PAGE_TTL_MS,
      });
      markup = {
        inline_keyboard: [
          [{ text: `Ещё ${Math.min(5, remaining)} ▸ (осталось ${remaining})`, callback_data: `said:${token}` }],
        ],
      };
    }
    await this.send({ chatId, text: header + items + footer, replyTo, markup });
  }

  // --- игры (общий слот «один раунд на чат» на /игра и /изобрази) ---

  /** Когда освободится слот раунда любой игры; null — слот свободен. */
  private activeGameEndsAt(chatId: string): number | null {
    const game = this.rounds.get(chatId);
    if (game && !game.finished) return game.endsAt;
    const improv = this.improv.hasActiveRound(chatId);
    if (improv) return improv.endsAt;
    return null;
  }

  private async cmdGame(ctx: CommandCtx): Promise<void> {
    const activeEnds = this.activeGameEndsAt(ctx.chatId);
    if (activeEnds !== null) {
      const sec = Math.max(1, Math.round((activeEnds - Date.now()) / 1000));
      await this.reply(ctx.chatId, `Раунд уже идёт, осталось ${sec} с.`, ctx.replyTo);
      return;
    }
    const avoid = this.lastQuotesFor(ctx.chatId, MediumBot.QUOTE_AVOID_GAME);
    const quote = this.d.store.randomGameQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, {
      excludeFromId: BOT_CHANNEL_FROM_ID,
      avoidMsgIds: avoid,
    });
    if (!quote || !quote.from_id) {
      await this.reply(ctx.chatId, 'Не нашёл цитату для раунда (база пуста?).', ctx.replyTo);
      return;
    }
    // Дедуп по имени: два from_id с одинаковым from_name дали бы одинаковые кнопки.
    const byName = new Map<string, AuthorEntry>();
    for (const e of this.d.directory.get()) {
      if (e.fromId === quote.from_id || e.textMessages <= 10) continue;
      const prev = byName.get(e.name);
      if (!prev || e.textMessages > prev.textMessages) byName.set(e.name, e);
    }
    const distractors = weightedDistractors([...byName.values()], 7);
    if (distractors.length < 3) {
      await this.reply(ctx.chatId, 'Мало известных авторов для вариантов — попробуй позже.', ctx.replyTo);
      return;
    }
    const options = [
      { fromId: quote.from_id, label: truncate(quote.from_name, 24) },
      ...distractors.map((e) => ({ fromId: e.fromId, label: truncate(e.name, 24) })),
    ].sort(() => Math.random() - 0.5);
    this.rememberQuote(ctx.chatId, quote.msg_id);

    const seq = ++this.roundSeq;
    const round: GameRound = {
      seq,
      chatId: ctx.chatId,
      correctFromId: quote.from_id,
      options,
      quoteText: quote.text,
      quoteDate: quote.date_iso,
      quoteReactions: quote.reaction_total,
      endsAt: Date.now() + GAME_ROUND_MS,
      timer: null as unknown as NodeJS.Timeout,
      finished: false,
    };
    round.timer = setTimeout(() => {
      void this.revealRound(ctx.chatId, true);
    }, GAME_ROUND_MS);
    this.rounds.set(ctx.chatId, round);

    const buttons = options.map((o, i) => ({ text: o.label, callback_data: `g:${seq}:${i}` }));
    await this.send({
      chatId: ctx.chatId,
      text: formatGameQuestion(quote),
      replyTo: ctx.replyTo,
      markup: { inline_keyboard: [buttons] },
    });
  }

  private async revealRound(chatId: string, timedOut: boolean): Promise<void> {
    if (!this.d.session.enabled) {
      // фикс: после /off ревил не вскрывает выключенного бота ни по одному пути
      const stuck = this.rounds.get(chatId);
      if (stuck) {
        clearTimeout(stuck.timer);
        this.rounds.delete(chatId);
      }
      return;
    }
    const round = this.rounds.get(chatId);
    if (!round || round.finished) return;
    round.finished = true;
    clearTimeout(round.timer);
    this.rounds.delete(chatId);
    const author = this.d.directory.get().find((e) => e.fromId === round.correctFromId);
    const name = author?.name ?? 'неизвестный';
    const lines = [
      timedOut ? '⏰ Время вышло!' : '🎉 Есть попадание!',
      `✅ ${name} · [${formatDate(round.quoteDate)}] · 🔥 ${round.quoteReactions}`,
      `«${truncate(round.quoteText, 400)}»`,
    ];
    const top = this.topScoresLine(chatId);
    if (top) lines.push(`🏆 Сессия: ${top}`);
    await this.send({ chatId, text: lines.join('\n') });
  }

  // --- изобрази ---

  /** /изобрази <имя> [тема…]: раунд «Изобрази автора» — пародии реплаями. */
  private async cmdImprov(args: string, ctx: CommandCtx): Promise<void> {
    const words = args.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      await this.reply(ctx.chatId, 'Формат: /изобрази <имя> [тема…] — кого изображаем?', ctx.replyTo);
      return;
    }
    const activeEnds = this.activeGameEndsAt(ctx.chatId);
    if (activeEnds !== null) {
      const sec = Math.max(1, Math.round((activeEnds - Date.now()) / 1000));
      await this.reply(ctx.chatId, `Раунд уже идёт, осталось ${sec} с.`, ctx.replyTo);
      return;
    }
    const { name: nameCandidate, themeWords, result: nameResult } = resolveGreedyName(words, (q) =>
      this.resolveOnce(q),
    );
    const theme = themeWords.join(' ');
    if (themeWords.length > 0 && !buildFtsQuery(theme)) {
      await this.reply(ctx.chatId, 'В теме одни стоп-слова. Конкретизируй.', ctx.replyTo);
      return;
    }
    if (nameResult.kind === 'ok') {
      await this.cmdImprovStart(nameResult.author, theme, ctx);
      return;
    }
    await this.runResolved(nameResult, nameCandidate, ctx, 'изобрази', theme);
  }

  private async cmdImprovStart(author: AuthorEntry, theme: string, ctx: CommandCtx): Promise<void> {
    // гард обязателен ЗДЕСЬ, а не только в cmdImprov: сюда ведёт и res:-кнопка
    // дизамбиги (60 с), за окно которой слот могла занять другая игра
    const activeEnds = this.activeGameEndsAt(ctx.chatId);
    if (activeEnds !== null) {
      const sec = Math.max(1, Math.round((activeEnds - Date.now()) / 1000));
      await this.reply(ctx.chatId, `Раунд уже идёт, осталось ${sec} с.`, ctx.replyTo);
      return;
    }
    let real: { msgId: number; text: string; dateIso: string; reactions: number } | null = null;
    if (theme) {
      // тема задана — настоящую цитату берём лучшую по теме (путь /сказал)
      const matchQuery = buildFtsQuery(theme);
      let hits: Array<{ topicId: number; msgId: number }> = [];
      try {
        hits = this.d.fts.get().search(BOT_CHAT_KEY, matchQuery, author.fromId, 200);
      } catch {
        hits = [];
      }
      const rows = this.d.store.getMessagesByKeys(
        BOT_CHAT_KEY,
        hits.map((h) => ({ topicId: h.topicId, msgId: h.msgId })),
      );
      const now = Date.now();
      const best = [...rows.values()]
        .filter((r) => r.text.length >= 40 && r.text.length <= 400 && !r.text.includes('http'))
        .map((row) => ({ row, score: scoreQuote(row.reaction_total, row.date_iso, now) }))
        .sort((a, b) => b.score - a.score)[0];
      real = best
        ? { msgId: best.row.msg_id, text: best.row.text, dateIso: best.row.date_iso, reactions: best.row.reaction_total }
        : null;
      if (!real) {
        await this.reply(ctx.chatId, `Про «${theme}» ${author.name} молчал.`, ctx.replyTo);
        return;
      }
    } else {
      // кап окна: пул одного автора узкий, avoid в COUNT+OFFSET вычитает дочерна
      const avoid = this.lastQuotesFor(ctx.chatId, MediumBot.QUOTE_AVOID_NARROW);
      const row = this.d.store.randomAuthorGameQuote(BOT_CHAT_KEY, BOT_TOPIC_ID, author.fromId, {
        avoidMsgIds: avoid,
      });
      if (!row) {
        await this.reply(ctx.chatId, `У ${author.name} нет цитат для раунда.`, ctx.replyTo);
        return;
      }
      real = { msgId: row.msg_id, text: row.text, dateIso: row.date_iso, reactions: row.reaction_total };
    }
    this.rememberQuote(ctx.chatId, real.msgId);
    await this.improv.start({
      chatId: ctx.chatId,
      replyTo: ctx.replyTo,
      author,
      theme,
      real,
    });
  }

  // --- какбы (LLM-стилизация, M3; наружу — только через 🎭-гейт) ---

  // Просьбы «пусть X оскорбит/унизит Y» — отказ без генерации (спек §5.5).
  private static readonly KAKBY_REFUSAL_RE =
    /(оскорб|униз|обоср|опозор|угроз|угрож|нагруб|высме[яю])/i;

  private kakbyClient: LlmClient | null = null;

  /** /какбы <имя> [тема…] — открыть диалог с «духом» автора; /какбы стоп — закрыть. */
  private async cmdKakby(args: string, ctx: CommandCtx): Promise<void> {
    const words = args.split(/\s+/).filter(Boolean);
    if (words.length === 1 && /^(стоп|хватит)$/i.test(words[0])) {
      if (this.kakbySessions.delete(ctx.chatId)) {
        await this.reply(ctx.chatId, '🎭 Сеанс окончен, дух отпущен. Было неплохо.', ctx.replyTo);
      } else {
        await this.reply(ctx.chatId, '🎭 Сейчас никого не вызываю.', ctx.replyTo);
      }
      return;
    }
    if (words.length === 0) {
      await this.reply(
        ctx.chatId,
        'Формат: /какбы <имя> [тема…] — вызвать духа для разговора; /какбы стоп — отпустить.',
        ctx.replyTo,
      );
      return;
    }
    if (MediumBot.KAKBY_REFUSAL_RE.test(args)) {
      await this.reply(
        ctx.chatId,
        '🎭 Такое не вызываю: грязь и унижения — не мой жанр. Дай тему, а не подлость.',
        ctx.replyTo,
      );
      return;
    }
    const { name: nameCandidate, themeWords, result: nameResult } = resolveGreedyName(words, (q) =>
      this.resolveOnce(q),
    );
    const theme = themeWords.join(' ');
    if (nameResult.kind === 'ok') {
      await this.cmdKakbyStart(nameResult.author, theme, ctx);
      return;
    }
    await this.runResolved(nameResult, nameCandidate, ctx, 'какбы', theme);
  }

  /** Открытие сеанса: сэмплы по теме, первая реплика духа, TTL. */
  private async cmdKakbyStart(
    author: AuthorEntry,
    themeArg: string,
    ctx: CommandCtx,
  ): Promise<void> {
    const theme = themeArg || (ctx.replyText ? themeFromReplyText(ctx.replyText) : '');
    let samples: string[] = [];
    try {
      samples = this.collectKakbySamples(author, theme);
    } catch (err) {
      console.error(`[tg-bot] какбы samples (chat=${ctx.chatId}): ${errText(err)}`);
    }
    const session: KakbySession = {
      author,
      samples,
      history: [],
      botMsgIds: new Set(),
      expiresAt: Date.now() + KAKBY_SESSION_TTL_MS,
    };
    this.kakbySessions.set(ctx.chatId, session);
    const opening = theme
      ? `Начинаем разговор. Тема: «${theme}» — ответь первой репликой в своей манере.`
      : 'Поприветствуй чат короткой репликой в своей манере.';
    await this.kakbyTurn(ctx.chatId, session, opening, ctx.replyTo);
  }

  /** Один ход диалога: user-реплика → LLM (через 🎭-гейт) → ответ + история. */
  private async kakbyTurn(
    chatId: string,
    session: KakbySession,
    userText: string,
    replyTo?: number,
  ): Promise<void> {
    session.expiresAt = Date.now() + KAKBY_SESSION_TTL_MS;
    const history: ChatMessage[] = [
      ...session.history.slice(-11),
      { role: 'user', content: userText },
    ];
    const generate = this.d.generateImitation ?? ((a, h, s) => this.defaultImitation(a, h, s));
    const guarded = await guardImaginedReply(
      () => this.d.kakbyLimiter.run(() => generate(session.author, history, session.samples)),
      session.author.name,
    );
    // Провал генерации (fallback) в историю ассистента не пишем — она мнимая.
    session.history = guarded.passed
      ? ([...history, { role: 'assistant', content: stripSpiritMarker(guarded.text) }] as ChatMessage[]).slice(-12)
      : history;
    const id = await this.send({ chatId, text: guarded.text, replyTo });
    if (id !== null) {
      session.botMsgIds.add(id);
      if (session.botMsgIds.size > 20) {
        const oldest = session.botMsgIds.values().next().value;
        if (oldest !== undefined) session.botMsgIds.delete(oldest);
      }
    }
  }

  /** Few-shot для /какбы: сначала до 5 сообщений автора ПО ТЕМЕ (FTS, как /сказал),
   *  добор случайными до 8 — иначе модель клеит реплику из чужих контекстов. */
  private collectKakbySamples(author: AuthorEntry, theme: string): string[] {
    const seen = new Set<number>();
    const out: string[] = [];
    if (theme) {
      const matchQuery = buildFtsQuery(theme);
      if (matchQuery) {
        let hits: Array<{ topicId: number; msgId: number }> = [];
        try {
          hits = this.d.fts.get().search(BOT_CHAT_KEY, matchQuery, author.fromId, 100);
        } catch {
          hits = [];
        }
        const rows = this.d.store.getMessagesByKeys(
          BOT_CHAT_KEY,
          hits.map((h) => ({ topicId: h.topicId, msgId: h.msgId })),
        );
        const now = Date.now();
        const best = [...rows.values()]
          .filter((r) => r.text.length >= 40 && r.text.length <= 400 && !r.text.includes('http'))
          .map((row) => ({ row, score: scoreQuote(row.reaction_total, row.date_iso, now) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        for (const b of best) {
          seen.add(b.row.msg_id);
          out.push(b.row.text);
        }
      }
    }
    if (out.length < 8) {
      for (const r of this.d.store.sampleAuthorQuotes(BOT_CHAT_KEY, BOT_TOPIC_ID, author.fromId, 8)) {
        if (!seen.has(r.msg_id)) out.push(r.text);
      }
    }
    return out.slice(0, 8);
  }

  /** Дефолтный генератор: DeepSeek (напрямую или через OpenRouter), дерзкий тон.
   *  Роль — сам автор: бот отвечает на реплики собеседников в его манере. */
  private async defaultImitation(
    author: AuthorEntry,
    history: ChatMessage[],
    samples: string[],
  ): Promise<string> {
    this.kakbyClient ??= new LlmClient(getKakbyLlmConfig());
    const system = [
      `Ты играешь роль ${author.name} — участника чата «Факты в чате». Ты не ассистент,`,
      `ты — ${author.name}: его лексика, ритм, любимые словечки (примеры ниже).`,
      'Отвечай собеседникам так, как ответил бы он: дерзко, самоуверенно, по делу.',
      'Жёсткие правила:',
      'Жёсткие правила:',
      `1. Первая строка ВСЕГДА: 🎭 Дух ${author.name}:`,
      '2. Дальше — только реплика, 1–3 коротких предложения, разговорно, по-русски.',
      '3. Герою НЕ приписывай факты, мнения о реальных людях, оскорбления,',
      '   личную жизнь, политику. Тема незнакома — оценочная реакция без деталей.',
      '4. Реплика самостоятельная: не комментируй несуществующие видео/ссылки/фото.',
      '5. Примеры ниже — только для манеры, не цитируй и не продолжай их.',
    ].join('\n');
    const user =
      samples.length > 0
        ? `Реальные сообщения ${author.name} (для манеры, не для цитирования):\n` +
          samples.map((s) => `— ${truncate(s, 200)}`).join('\n') +
          '\n\nДальше — диалог. Реплики собеседников начинаются с их имени.'
        : 'Примеров нет — импровизируй по имени. Дальше — диалог.';
    return this.kakbyClient.chat([msg.system(system), msg.user(user), ...history], {
      temperature: 0.9,
      maxTokens: 300,
    });
  }

  // --- callback_query ---

  private async handleCallback(cb: TgCallbackQuery): Promise<void> {
    const msg = cb.message;
    const data = cb.data ?? '';
    if (!msg) {
      await this.safeAnswer(cb.id, undefined);
      return;
    }
    const chatId = String(msg.chat.id);
    const isOwner = this.isOwner(String(cb.from.id));
    const privateOwner = isOwner && msg.chat.type === 'private';
    if (!this.d.cfg.allowChats.has(chatId) && !privateOwner) return;

    if (data.startsWith('vote:')) {
      const [, token, idxRaw] = data.split(':');
      await this.improv.handleVote(
        cb.id,
        chatId,
        String(cb.from.id),
        cb.from.first_name ?? cb.from.username ?? 'участник',
        token ?? '',
        idxRaw ?? '',
      );
      return;
    }
    if (data.startsWith('g:')) {
      await this.handleGameCallback(cb, chatId, data);
      return;
    }
    if (data.startsWith('said:')) {
      const token = data.slice('said:'.length);
      const page = this.saidPages.get(token);
      if (!page || page.expiresAt < Date.now() || page.chatId !== chatId) {
        this.saidPages.delete(token);
        await this.safeAnswer(cb.id, 'Лист устарел, вызови /сказал заново');
        return;
      }
      await this.safeAnswer(cb.id, undefined);
      try {
        const result = this.searchSaidScored(page.fromId, page.matchQuery);
        await this.sendSaidBatch(chatId, page, result);
      } catch (err) {
        console.error(`[tg-bot] said-page упал: ${errText(err)}`);
        await this.send({ chatId, text: '⚠️ Внутренняя ошибка, попробуй ещё раз.' });
      }
      return;
    }
    if (!data.startsWith('res:')) {
      await this.safeAnswer(cb.id, undefined);
      return;
    }
    const [, token, fromId] = data.split(':');
    const p = this.pending.get(token);
    this.pending.delete(token);
    if (!p || p.expiresAt < Date.now() || p.chatId !== chatId) {
      await this.safeAnswer(cb.id, 'Выбор устарел, вызови команду заново');
      return;
    }
    await this.safeAnswer(cb.id, 'Принято');
    const entry = this.d.directory.get().find((e) => e.fromId === fromId);
    if (!entry) return;
    const ctx: CommandCtx = {
      chatId: p.chatId,
      userId: String(cb.from.id),
      userName: cb.from.first_name ?? 'участник',
      replyTo: p.replyTo,
      replyText: p.replyText,
      isOwner,
    };
    try {
      if (p.cmdName === 'сказал') {
        await this.sendSaidQuotes(entry, p.argsText, buildFtsQuery(p.argsText), ctx);
      } else if (p.cmdName === 'изобрази') {
        await this.cmdImprovStart(entry, p.argsText, ctx);
      } else if (p.cmdName === 'какбы') {
        await this.cmdKakbyStart(entry, p.argsText, ctx);
      } else if (p.cmdName === 'алиасскан') {
        await this.cmdAliasScan(entry.name, ctx);
      } else {
        await this.sendAuthorQuote(entry, ctx);
      }
    } catch (err) {
      console.error(`[tg-bot] callback-dispatch упал: ${errText(err)}`);
    }
  }

  private async handleGameCallback(cb: TgCallbackQuery, chatId: string, data: string): Promise<void> {
    const round = this.rounds.get(chatId);
    const [, seqRaw, idxRaw] = data.split(':');
    if (!round || round.finished || String(round.seq) !== seqRaw) {
      await this.safeAnswer(cb.id, 'Раунд уже завершён');
      return;
    }
    const picked = round.options[Number(idxRaw)];
    if (!picked) {
      await this.safeAnswer(cb.id, undefined);
      return;
    }
    if (picked.fromId === round.correctFromId) {
      const entry = this.addScore(chatId, String(cb.from.id), cb.from.first_name ?? 'участник', 1);
      await this.safeAnswer(cb.id, `Верно, ${entry.name}! +1`);
      await this.revealRound(chatId, false);
    } else {
      await this.safeAnswer(cb.id, 'Мимо 🙂');
    }
  }

  // --- admin (только owner) ---

  private async cmdReindex(ctx: CommandCtx): Promise<void> {
    const idx = rebuildFtsFull(this.d.store, this.d.fts);
    await this.reply(
      ctx.chatId,
      `♻️ FTS пересобран: ${idx.added} док. за ${(idx.ms / 1000).toFixed(1)} с, курсор msg_id=${idx.maxId}.`,
      ctx.replyTo,
    );
  }

  private async cmdAlias(args: string, ctx: CommandCtx): Promise<void> {
    const parts = args.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      await this.reply(ctx.chatId, 'Формат: /алиас <ник> <имя-автора>', ctx.replyTo);
      return;
    }
    const nick = parts[0];
    const authorName = parts.slice(1).join(' ');
    const r = this.resolveOnce(authorName);
    if (r.kind === 'none') {
      const names = r.suggestions.map((s) => s.name).join(', ');
      await this.reply(ctx.chatId, `Не нашёл «${authorName}».${names ? ` Ближайшие: ${names}.` : ''}`, ctx.replyTo);
      return;
    }
    if (r.kind === 'ambiguous') {
      const names = r.options
        .slice(0, 8)
        .map((o) => `• ${o.name} (${o.textMessages} сообщ.)`)
        .join('\n');
      await this.reply(ctx.chatId, `«${authorName}» неоднозначно, уточни имя:\n${names}`, ctx.replyTo);
      return;
    }
    this.d.store.upsertAlias(nick, r.author.fromId);
    await this.reply(ctx.chatId, `Алиас «${nick}» → ${r.author.name} сохранён.`, ctx.replyTo);
  }

  /** /алиасскан <имя-автора> — найти частые слова из сообщений, где упоминается автор.
   *  Кандидаты в прозвища выводятся списком; не конфликтующие можно сохранить командой /алиас. */
  private async cmdAliasScan(args: string, ctx: CommandCtx): Promise<void> {
    const words = args.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      await this.reply(ctx.chatId, 'Формат: /алиасскан <имя-автора>', ctx.replyTo);
      return;
    }
    const { name: nameCandidate, themeWords, result: nameResult } = resolveGreedyName(words, (q) =>
      this.resolveOnce(q),
    );
    if (nameResult.kind !== 'ok') {
      await this.runResolved(nameResult, nameCandidate, ctx, 'алиасскан', themeWords.join(' '));
      return;
    }
    const author = nameResult.author;
    const matchQuery = buildFtsQuery(author.name);
    if (!matchQuery) {
      await this.reply(ctx.chatId, 'Не смог составить поисковый запрос по имени автора.', ctx.replyTo);
      return;
    }
    let hits: Array<{ topicId: number; msgId: number }> = [];
    try {
      hits = this.d.fts.get().search(BOT_CHAT_KEY, matchQuery, null, 200);
    } catch {
      await this.reply(ctx.chatId, 'Ошибка поиска по FTS, попробуй позже.', ctx.replyTo);
      return;
    }
    const rows = this.d.store.getMessagesByKeys(
      BOT_CHAT_KEY,
      hits.map((h) => ({ topicId: h.topicId, msgId: h.msgId })),
    );
    const existingAliases = [...this.d.store.listAliases().keys()];
    const candidates = collectAliasCandidates(
      author.name,
      [...rows.values()].map((r) => r.text),
      existingAliases,
      15,
    );
    if (candidates.length === 0) {
      await this.reply(ctx.chatId, `Не нашёл подходящих прозвищ для ${author.name}.`, ctx.replyTo);
      return;
    }
    // Фильтруем кандидатов, которые уже резолвятся в кого-то другого.
    const safe = candidates.filter((c) => {
      const resolved = this.resolveOnce(c.word);
      return resolved.kind !== 'ok' || resolved.author.fromId === author.fromId;
    });
    const lines = safe.map((c) => `• ${c.word} (${c.count})`).join('\n');
    const header = `🔎 Кандидаты в прозвища для ${author.name}:\n\n`;
    const footer = safe.length
      ? '\n\nСохранить: /алиас <слово> <имя-автора>'
      : '\n\nВсе найденные слова уже резолвятся в других авторов — добавлять осторожно.';
    await this.reply(ctx.chatId, header + lines + footer, ctx.replyTo);
  }

  private async cmdSetEnabled(enabled: boolean, ctx: CommandCtx): Promise<void> {
    this.d.session.enabled = enabled;
    this.d.store.setState('enabled', enabled ? '1' : '0');
    if (!enabled) {
      // рубильник гасит активный раунд ЛЮБОЙ игры в этом чате (и /игра, и /изобрази)
      const round = this.rounds.get(ctx.chatId);
      if (round && !round.finished) {
        clearTimeout(round.timer);
        this.rounds.delete(ctx.chatId);
        await this.send({ chatId: ctx.chatId, text: '🛑 Раунд прерван владельцем' });
      }
      this.improv.cancelActive(ctx.chatId);
    }
    await this.reply(
      ctx.chatId,
      enabled ? '✅ Бот включён.' : '🛑 Бот выключен (отвечает только владельцу). Включить: /on',
      ctx.replyTo,
    );
  }

  private async cmdStat(ctx: CommandCtx): Promise<void> {
    const d = this.d;
    const uptimeSec = Math.round((Date.now() - d.session.startedAt) / 1000);
    const lines = [
      `Апдейтов за сессию: ${d.session.updatesSeen}`,
      `Очередь отправки: ${d.queue.size()}`,
      `Бот: ${d.session.enabled ? 'включён' : 'выключен'}`,
      `FTS: ${d.fts.get().countDocs()} док., курсор msg_id=${d.fts.get().getMaxIndexed()}, файл ${(d.fts.get().fileSizeBytes() / 1024 / 1024).toFixed(1)} МБ`,
      `Алиасов: ${d.store.countAliases()}`,
      `Каталог авторов: ${d.directory.get().length}`,
      `Аптайм: ${Math.floor(uptimeSec / 60)} мин ${uptimeSec % 60} с`,
    ];
    await this.reply(ctx.chatId, lines.join('\n'), ctx.replyTo);
  }

  // --- прочее ---

  private isOwner(userId: string): boolean {
    return this.d.cfg.ownerChatId != null && userId === this.d.cfg.ownerChatId;
  }

  /** Общая сессионная доска /игра и /изобрази (in-memory, умирает при рестарте). */
  private addScore(chatId: string, userId: string, name: string, delta: number): { name: string; score: number } {
    const board = this.scores.get(chatId) ?? new Map<string, { name: string; score: number }>();
    const entry = board.get(userId) ?? { name, score: 0 };
    entry.score += delta;
    board.set(userId, entry);
    this.scores.set(chatId, board);
    return entry;
  }

  private topScoresLine(chatId: string): string {
    const board = this.scores.get(chatId);
    return [...(board?.values() ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => `${s.name} — ${s.score}`)
      .join(' · ');
  }

  /** Некликнутые токены дизамбиги живут 60 с (RESOLVE_TTL_MS), листы /сказал —
   *  10 мин (SAID_PAGE_TTL_MS); подметаем лениво при каждой новой выдаче кнопок. */
  private sweepPending(): void {
    const now = Date.now();
    for (const [token, p] of this.pending) {
      if (p.expiresAt < now) this.pending.delete(token);
    }
    for (const [token, p] of this.saidPages) {
      if (p.expiresAt < now) this.saidPages.delete(token);
    }
    for (const [chatId, s] of this.kakbySessions) {
      if (s.expiresAt < now) this.kakbySessions.delete(chatId);
    }
  }

  /** Последние N msg_id цитат чата (anti-повтор); N = 0 → пустой список. */
  private lastQuotesFor(chatId: string, n: number): number[] {
    const arr = this.lastQuotes.get(chatId) ?? [];
    return n > 0 ? arr.slice(-n) : [];
  }

  private rememberQuote(chatId: string, msgId: number): void {
    const arr = this.lastQuotes.get(chatId) ?? [];
    arr.push(msgId);
    // Кап = самое широкое окно anti-повтора, иначе NARROW-константы не видят историю.
    while (arr.length > MediumBot.QUOTE_AVOID_GAME) arr.shift();
    this.lastQuotes.set(chatId, arr);
  }

  private async reply(chatId: string, text: string, replyTo?: number): Promise<number | null> {
    return this.send({ chatId, text, replyTo });
  }

  private async send(m: OutboundMessage): Promise<number | null> {
    return this.d.queue.enqueue(m);
  }

  private async safeAnswer(callbackId: string, text?: string): Promise<void> {
    try {
      await this.d.api.answerCallbackQuery(callbackId, text);
    } catch (err) {
      console.error(`[tg-bot] answerCallbackQuery: ${errText(err)}`);
    }
  }
}

// --- каталог авторов с кэшем (GROUP BY по 950k строк ~2 с — не на каждую команду) ---

class AuthorDirectory {
  private entries: AuthorEntry[] | null = null;
  private builtAt = 0;
  private static readonly TTL_MS = 15 * 60_000;

  constructor(private readonly store: BotStore) {}

  get(): AuthorEntry[] {
    if (!this.entries || Date.now() - this.builtAt > AuthorDirectory.TTL_MS) {
      const t0 = Date.now();
      this.entries = this.store.getAuthorDirectory(BOT_CHAT_KEY, BOT_TOPIC_ID, BOT_CHANNEL_FROM_ID);
      this.builtAt = Date.now();
      console.error(`[tg-bot] каталог авторов: ${this.entries.length} записей за ${Date.now() - t0} мс`);
    }
    return this.entries;
  }
}

// --- FTS-хранилище бота: держатель с ленивым открытием (пересборка подменяет файл) ---

class FtsHolder {
  private current: FtsStore | null = null;

  constructor(private readonly path: string) {}

  open(): void {
    if (!this.current) this.current = new FtsStore(this.path);
  }

  get(): FtsStore {
    this.open();
    return this.current as FtsStore;
  }

  close(): void {
    this.current?.close();
    this.current = null;
  }

  /** Хвосты прерванной пересборки (.build) — не мусорим в .data. */
  discardBuildArtifacts(): void {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(this.buildPath() + suffix, { force: true });
    }
  }

  buildPath(): string {
    return `${this.path}.build`;
  }

  /** Подменить основной файл свежесобранным (оба ДБ должны быть закрыты). */
  replaceWith(buildFilePath: string): void {
    this.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(this.path + suffix, { force: true });
    renameSync(buildFilePath, this.path);
  }
}

/**
 * Полная пересборка FTS: строим с нуля в свежий .build-файл и подменяем им
 * основной. Перестройка поверх живого 190-МБ файла упирается в freelist-чурн
 * и медленные страницы (71 с против ~12 с на чистом файле, замер 2026-09-24).
 */
function rebuildFtsFull(store: BotStore, fts: FtsHolder): {
  added: number;
  ms: number;
  maxId: number;
} {
  const buildPath = fts.buildPath();
  for (const suffix of ['', '-wal', '-shm']) rmSync(buildPath + suffix, { force: true });
  const build = new FtsStore(buildPath, { disposable: true });
  let result: { added: number; ms: number; maxId: number };
  try {
    result = catchUpFtsIndex(store, build);
  } finally {
    build.close();
  }
  fts.replaceWith(buildPath);
  return result;
}

// --- FTS-догон (батчи по 50k: коммит/курсор реже — полная сборка ~2× быстрее;
// курсор переживает рестарт, незакоммиченный хвост пересобирается) ---

export function catchUpFtsIndex(store: BotStore, fts: FtsStore): {
  added: number;
  ms: number;
  maxId: number;
} {
  const t0 = Date.now();
  let maxId = fts.getMaxIndexed();
  let added = 0;
  const BATCH = 50_000;
  // Read-ahead на один батч: чтение из tg.sqlite и запись в FTS-файл — два
  // потока I/O по одному диску, конвейер прячет чтение за записью.
  let ahead = store.iterMessagesAfter(BOT_CHAT_KEY, BOT_TOPIC_ID, maxId, BATCH);
  while (ahead.length > 0) {
    const rows = ahead;
    maxId = rows[rows.length - 1].msg_id;
    ahead = store.iterMessagesAfter(BOT_CHAT_KEY, BOT_TOPIC_ID, maxId, BATCH);
    fts.indexRows(rows);
    fts.setMaxIndexed(maxId);
    added += rows.length;
  }
  return { added, ms: Date.now() - t0, maxId };
}

// --- форматирование (экспорт для тестов: дата в реальной цитате — инвариант) ---

export function formatDate(dateIso: string): string {
  const d = dateIso.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return dateIso;
  return `${day}.${m}.${y}`;
}

/** Убрать 🎭-строку маркера из реплики духа (для истории диалога). */
function stripSpiritMarker(text: string): string {
  const nl = text.indexOf('\n');
  const first = nl < 0 ? text : text.slice(0, nl);
  return first.trimStart().startsWith('🎭') ? (nl < 0 ? '' : text.slice(nl + 1).trim()) : text;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** Вопрос /игра: дата обязательна (реальная цитата), имя автора НЕ показываем. */
export function formatGameQuestion(quote: { text: string; date_iso: string }): string {
  return `🎯 Кто это сказал?\n\n[${formatDate(quote.date_iso)}] «${truncate(quote.text, 400)}»\n\n⏱ 90 секунд`;
}

/**
 * Дистракторы для /игра: k разных авторов через взвешенный сэмплинр без повторов —
 * вес = textMessages, активные участники попадаются чаще, «молчуны» остаются в игре,
 * но редко. Известный (правильный) автор исключён фильтром выше по потоку.
 */
export function weightedDistractors(pool: AuthorEntry[], k: number): AuthorEntry[] {
  const items = pool.map((e) => ({ e, w: Math.max(1, e.textMessages) }));
  const picked: AuthorEntry[] = [];
  while (picked.length < k && items.length > 0) {
    const total = items.reduce((s, it) => s + it.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < items.length; idx++) {
      r -= items[idx].w;
      if (r <= 0) break;
    }
    if (idx >= items.length) idx = items.length - 1;
    picked.push(items[idx].e);
    items.splice(idx, 1);
  }
  return picked;
}

export function formatQuoteCard(row: { from_name: string; text: string; date_iso: string }): string {
  return `[${formatDate(row.date_iso)}] ${row.from_name}:\n${truncate(row.text, 600)}`;
}

// --- прочее ---

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

