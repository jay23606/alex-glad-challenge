// Бот «Максим Артемьевич» — QA Lead front-back. Раз в две недели, в день
// релиза (релизный календарь: эпоха + период, env; по умолч. 2026-10-06,
// 14 дней — релизы 41, 43, …), присылает в чат одно напутствие в случайный
// момент окна 10:00–20:00 локали («с продом повнимательнее», «переводи в
// ревью»), сгенерированное DeepSeek с настраиваемой температурой
// (/maxim_temp). Если за MAXIM_CAPS_DELAY_SEC (по умолч. 2 мин) в чате нет
// ни одного человеческого сообщения — повторяет фразу КАПСОМ, пингуя
// участников поочерёдно: первыми — тех, кого не пинговали дольше всех.
// В остальное время молчит, но отвечает на обращения: реплай на его
// сообщение, @упоминание, «максим, …» или любое сообщение в личке.
//
// Сеть — Bot API через BotApiClient/netFetch (chokepoint), LLM — LlmClient
// (DeepSeek приоритетно, env DEEPSEEK_API_KEY). Состояние (offset, температура,
// pending-напутствие, участники) — JSON в .data/maxim-bot.json, атомарная
// запись (tmp + rename). Логи — только метаданные, тексты не логируются.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { getMaximBotConfig, getMaximLlmConfig } from '../env.js';
import type { MaximBotConfig } from '../env.js';
import { LlmClient } from '../client.js';
import { msg } from '../types.js';
import type { ChatMessage } from '../types.js';
import { dataPath } from '../paths.js';
import { BotApiClient, BotApiError } from './botApi.js';
import type { TgUpdate, TgUser } from './botApi.js';

// --- Чистая логика (экспортирована для тестов) ---

/** Локальная полночь даты — база сравнения с релизным календарём. */
function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * День релиза по календарю: epoch — 'YYYY-MM-DD', далее каждые periodDays.
 * Битую эпоху трактуем как «календаря нет» → всегда false.
 */
export function isReleaseDay(now: Date, epoch: string, periodDays: number): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(epoch);
  if (!m) return false;
  const epochMs = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const diffDays = Math.round((localMidnight(now) - epochMs) / DAY_MS);
  return diffDays >= 0 && diffDays % periodDays === 0;
}

export interface NudgeScheduleCfg {
  releaseEpoch: string;
  releasePeriodDays: number;
  dailyWindowStartHour: number;
  dailyWindowEndHour: number;
}

/** Битая эпоха = нет календаря = нет напутствий (макс. валидная дата). */
const NEVER = 8.64e15;

/**
 * Когда слать следующее напутствие: ближайший релизный день (сегодня, если
 * он релизный и слот ещё впереди, иначе — следующий по календарю), случайный
 * момент окна [start, end) локального времени.
 */
export function computeNextNudgeAt(
  now: Date,
  cfg: NudgeScheduleCfg,
  rng: () => number = Math.random,
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cfg.releaseEpoch);
  if (!m) return NEVER;
  const epochMs = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const start = Math.min(cfg.dailyWindowStartHour, cfg.dailyWindowEndHour);
  const end = Math.max(cfg.dailyWindowStartHour, cfg.dailyWindowEndHour);
  const slotOn = (dayMs: number): number => {
    const d = new Date(dayMs);
    return (
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), start).getTime() +
      rng() * Math.max(1, end - start) * 3_600_000
    );
  };
  const todayMs = localMidnight(now);
  const diffDays = Math.round((todayMs - epochMs) / DAY_MS);
  let releaseDayMs: number;
  if (diffDays < 0) {
    releaseDayMs = epochMs;
  } else {
    const rem = diffDays % cfg.releasePeriodDays;
    releaseDayMs = todayMs + (rem === 0 ? 0 : cfg.releasePeriodDays - rem) * DAY_MS;
  }
  let slot = slotOn(releaseDayMs);
  if (slot <= now.getTime()) {
    slot = slotOn(releaseDayMs + cfg.releasePeriodDays * DAY_MS);
  }
  return slot;
}

/** Капс-версия напутствия: верхний регистр + гарантированные восклицания. */
export function toCapsText(text: string): string {
  const up = text.trim().toUpperCase();
  return up.includes('!') ? up : `${up}!!!`;
}

/** Минимальный слайс участника для ротации пингов. */
export interface PingCandidate {
  id: number;
  username?: string;
  lastSeen: number;
  /** Когда пинговали последний раз (0 — никогда). */
  lastPingedAt: number;
}

/**
 * Поочерёдный выбор, кого пинговать: первыми те, кого не пинговали дольше всех
 * (lastPingedAt), при равенстве — кто дольше молчал (lastSeen). Автор (exceptId)
 * исключается. Так за несколько капсов теги расходятся по всему чату, а не
 * вечно падают на два самых свежих аккаунта.
 */
export function pickPingCandidates<P extends PingCandidate>(
  participants: readonly P[],
  exceptId: number,
  count: number,
): P[] {
  return participants
    .filter((p) => p.id !== exceptId && p.username)
    .slice()
    .sort((a, b) => (a.lastPingedAt || 0) - (b.lastPingedAt || 0) || a.lastSeen - b.lastSeen)
    .slice(0, count);
}

/** Капс-сообщение с пингом активных участников (юзернеймы через пробел). */
export function buildCapsMessage(text: string, usernames: string[]): string {
  const caps = toCapsText(text);
  const pings = usernames.filter(Boolean).map((u) => `@${u}`);
  return pings.length > 0 ? `${caps}\n${pings.join(' ')}` : caps;
}

export type MaximCommandName = 'temp' | 'say' | 'status' | 'start';
export interface MaximCommand {
  name: MaximCommandName;
  arg: string;
}

const COMMAND_ALIASES: Readonly<Record<string, MaximCommandName>> = {
  start: 'start',
  maxim_start: 'start',
  maxim_temp: 'temp',
  maxim_say: 'say',
  maxim_status: 'status',
};

/**
 * Разбор команды: только префиксные /maxim_* (в чате живут другие боты).
 * Команда с @суффиксом другого бота игнорируется.
 */
export function parseMaximCommand(text: string, botUsername?: string): MaximCommand | null {
  const m = /^\/([a-zA-Z0-9_]+)(?:@(\w+))?(?:\s+(.*))?$/s.exec(text.trim());
  if (!m) return null;
  const [, rawName, mention, rawArg] = m;
  if (mention && botUsername && mention.toLowerCase() !== botUsername.toLowerCase()) return null;
  const name = COMMAND_ALIASES[rawName.toLowerCase()];
  if (!name) return null;
  return { name, arg: (rawArg ?? '').trim() };
}

/** Валидация температуры из команды: число 0–2, иначе null. */
export function parseTemperature(arg: string): number | null {
  const n = Number(arg.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 2) return null;
  return Math.round(n * 100) / 100;
}

/** Обращение к боту: реплай на его сообщение, @упоминание или «максим, …». */
export interface AddressCheckInput {
  text: string;
  /** from.id сообщения, на которое пришёл реплай (undefined — не реплай). */
  replyFromId?: number;
  botId: number;
  botUsername?: string;
}

export function isAddressedToBot(input: AddressCheckInput): boolean {
  if (input.replyFromId !== undefined && input.replyFromId === input.botId) return true;
  if (
    input.botUsername &&
    input.text.toLowerCase().includes(`@${input.botUsername.toLowerCase()}`)
  ) {
    return true;
  }
  return /^\s*(максим(?:\s+артемьевич)?|макс)[\s,!:)-]/iu.test(input.text);
}

/** Текст обращения без @упоминания бота и ведущего «максим, ». */
export function stripAddress(text: string, botUsername?: string): string {
  let t = text;
  if (botUsername) t = t.replace(new RegExp(`@${botUsername}`, 'gi'), ' ');
  t = t.replace(/^\s*(максим(?:\s+артемьевич)?|макс)[\s,!:)-]*/iu, '');
  return t.trim();
}

/** Настроение ответа: забота по умолчанию, вспышка — редко, но регулярно. */
export type MaximMood = 'calm' | 'angry';

export function pickMood(rng: () => number = Math.random): MaximMood {
  return rng() < 0.15 ? 'angry' : 'calm';
}

// --- Персона и генерация ---

const PERSONA_SYSTEM = [
  'Ты — Максим Артемьевич, QA Lead команды front-back (фронтенд + бэк).',
  'Пишешь в рабочий чат короткие напутствия: одна фраза, до 10 слов, строчными,',
  'без эмодзи и без приветствий. Тон — опытный тимлид: спокойная уверенность,',
  'лёгкая усталость от чужих багов. Материшься по-русски, как все нормальные',
  'айтишники: не в каждой фразе, но для выразительности — запросто («опять',
  'этот херов флейк», «какого хрена тесты красные»). Темы: прод, релизы, ревью,',
  'тесты, регрессии, стенды. Примеры твоих фраз: «с продом повнимательнее»,',
  '«переводи в ревью», «тесты сами себя не прогонят». Не повторяй примеры',
  'дословно — придумывай свои.',
  'Отвечай ТОЛЬКО текстом напутствия, без кавычек и пояснений.',
].join('\n');

const FALLBACK_NUDGES: readonly string[] = [
  'с продом повнимательнее',
  'переводи в ревью',
  'тесты сами себя не прогонят',
  'на прод без регресса не ходим',
  'перед мержем глянь на стенд ещё раз',
];

// Приветствие /start — статичный текст, LLM не дёргаем (экономия токенов).
const START_INTRO = [
  'максим артемьевич, qa lead front-back.',
  '',
  'слежу, чтобы релизы выходили без сюрпризов: раз в две недели, в день',
  'релиза, говорю своё веское слово. если мне не отвечают — повышаю голос.',
  '',
  'поговорить можно и так: реплай на моё сообщение, @упоминание или просто',
  '«максим, …» в чате. в личке — любое сообщение, я на связи.',
  '',
  '/maxim_temp 0–2 — настроить мне разнообразие фраз',
  '/maxim_say — напутствие прямо сейчас',
  '/maxim_status — что у меня на уме',
].join('\n');

function cleanGenerated(text: string): string {
  const oneLine = text
    .replace(/^["'«»\s]+|["'«»\s]+$/g, '')
    .split('\n')[0]
    .trim();
  return oneLine.length > 0 && oneLine.length <= 200 ? oneLine : '';
}

async function generateNudge(
  llm: LlmClient,
  temperature: number,
  release: boolean,
  rng: () => number = Math.random,
): Promise<string> {
  const context = release
    ? 'Сегодня день релиза — напутствие должно это чувствовать.'
    : 'Обычный рабочий день.';
  try {
    const raw = await llm.chat(
      [msg.system(PERSONA_SYSTEM), msg.user(`${context} Напиши одно напутствие для чата.`)],
      { temperature, maxTokens: 60 },
    );
    const cleaned = cleanGenerated(raw);
    if (cleaned) return cleaned;
  } catch {
    // фолбэк ниже
  }
  return FALLBACK_NUDGES[Math.floor(rng() * FALLBACK_NUDGES.length)];
}

// --- Диалог: заботливый QA Lead, который временами вспыхивает ---

const DIALOG_SYSTEM = [
  'Ты — Максим Артемьевич, QA Lead команды front-back. Тебе пишут в рабочем чате —',
  'отвечай как руководитель тестирования, по делу и по-человечески.',
  'Характер: очень бережный и заботливый руководитель. Поддерживаешь, хвалишь за',
  'находки, мягко объясняешь, спрашиваешь, не устал ли человек. Обращаешься на «ты»,',
  'тепло. Но ты живой: вспышки случаются — от багов на проде, «у меня работало»,',
  'пропущенных тестов. Вспышка короткая, после неё снова забота.',
  'Материшься по-русски, естественно: в спокойном состоянии — умеренно, для',
  'выразительности; во вспышке — жёстко и от души. Мат никогда не направлен',
  'на личность собеседника — только на баги, прод и обстоятельства.',
  'Стиль: 1–3 коротких предложения, строчными, без эмодзи. Темы — тестирование,',
  'прод, ревью, релизы, стенды. Отвечай ТОЛЬКО текстом ответа, без кавычек.',
].join('\n');

const MOOD_HINT: Readonly<Record<MaximMood, string>> = {
  calm: 'Сейчас ты спокоен и заботлив. Лёгкий мат уместен, но не обязателен.',
  angry:
    'Сейчас ты на взводе (достали эти ёбаные баги): начни с короткой вспышки ' +
    'С МАТОМ (можно КАПСОМ), но к концу ответа вернись к заботе о человеке.',
};

const FALLBACK_REPLIES: readonly string[] = [
  'секунду, блин, отвлекли на прод. что случилось?',
  'напиши ещё раз, я на созвоне был. разберёмся',
  'прости, бегал тушить релиз. что там у тебя?',
];

const DIALOG_HISTORY_CAP = 12;
const DIALOG_REPLY_MAX_LEN = 600;

async function generateDialogReply(
  llm: LlmClient,
  temperature: number,
  history: readonly ChatMessage[],
  userText: string,
  mood: MaximMood,
  rng: () => number = Math.random,
): Promise<string> {
  try {
    const raw = await llm.chat(
      [msg.system(`${DIALOG_SYSTEM}\n${MOOD_HINT[mood]}`), ...history, msg.user(userText)],
      { temperature, maxTokens: 150 },
    );
    const cleaned = raw.replace(/^["'«»\s]+|["'«»\s]+$/g, '').trim();
    if (cleaned.length > 0 && cleaned.length <= DIALOG_REPLY_MAX_LEN) return cleaned;
  } catch {
    // фолбэк ниже
  }
  return FALLBACK_REPLIES[Math.floor(rng() * FALLBACK_REPLIES.length)];
}

// --- Состояние ---

interface Participant {
  id: number;
  username?: string;
  lastSeen: number;
  /** Когда участника последний раз пинговали в капс-сообщении (0 — никогда). */
  lastPingedAt: number;
}

interface PendingNudge {
  messageId: number | null;
  text: string;
  sentAt: number;
}

interface MaximState {
  offset: number;
  temperature: number;
  nextNudgeAt: number;
  pending: PendingNudge | null;
  participants: Participant[];
}

const PARTICIPANTS_CAP = 20;
const PING_COUNT = 3;
const SAY_COOLDOWN_MS = 60_000;
const PENDING_RESUME_WINDOW_MS = 10 * 60_000;

function defaultState(cfg: MaximBotConfig): MaximState {
  return {
    offset: 0,
    temperature: cfg.temperature,
    nextNudgeAt: 0,
    pending: null,
    participants: [],
  };
}

class MaximStateStore {
  private readonly file = dataPath('maxim-bot.json');
  readonly state: MaximState;

  constructor(cfg: MaximBotConfig) {
    this.state = this.load() ?? defaultState(cfg);
  }

  private load(): MaximState | null {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<MaximState>;
      if (typeof raw.offset !== 'number') return null;
      return {
        offset: raw.offset,
        temperature: typeof raw.temperature === 'number' ? raw.temperature : 1.0,
        nextNudgeAt: typeof raw.nextNudgeAt === 'number' ? raw.nextNudgeAt : 0,
        pending: raw.pending ?? null,
        participants: Array.isArray(raw.participants)
          ? raw.participants.map((p) => ({
              id: p.id,
              username: p.username,
              lastSeen: p.lastSeen,
              lastPingedAt: typeof p.lastPingedAt === 'number' ? p.lastPingedAt : 0,
            }))
          : [],
      };
    } catch {
      return null;
    }
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
  }

  touchParticipant(user: TgUser): void {
    const list = this.state.participants;
    const existing = list.find((p) => p.id === user.id);
    if (existing) {
      existing.username = user.username;
      existing.lastSeen = Date.now();
    } else {
      list.push({
        id: user.id,
        username: user.username,
        lastSeen: Date.now(),
        lastPingedAt: 0,
      });
    }
    list.sort((a, b) => b.lastSeen - a.lastSeen);
    if (list.length > PARTICIPANTS_CAP) list.length = PARTICIPANTS_CAP;
  }

  /**
   * Кого пинговать в капсе: поочерёдная ротация — первыми те, кого не пинговали
   * дольше всех (lastPingedAt), при равенстве — кто молчал дольше. Автор
   * сообщения (exceptId) не пингуется: он и так в чате. Пингуем только тех, у
   * кого есть юзернейм.
   */
  pingUsernames(exceptId: number): string[] {
    const now = Date.now();
    const candidates = pickPingCandidates(this.state.participants, exceptId, PING_COUNT);
    for (const p of candidates) p.lastPingedAt = now;
    if (candidates.length > 0) this.save();
    return candidates.map((p) => p.username as string);
  }
}

// --- Рантайм ---

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runMaximBot(): Promise<void> {
  const cfg = getMaximBotConfig();
  if (!cfg) {
    console.error('maxim-bot: MAXIM_BOT_TOKEN не задан (см. .env.example).');
    process.exit(1);
  }
  if (!cfg.chatId) {
    console.error(
      'maxim-bot: MAXIM_CHAT_ID пуст — бот НЕ работает (fail-closed). ' +
        'Добавь в .env строку вида MAXIM_CHAT_ID=-4805270771.',
    );
    process.exit(1);
  }

  const api = new BotApiClient(cfg.botToken);
  let me: TgUser;
  try {
    me = await api.getMe();
  } catch (err) {
    console.error(`maxim-bot: getMe не прошёл — ${errText(err)}`);
    process.exit(1);
  }
  console.error(`[maxim-bot] бот: @${me.username ?? String(me.id)}, чат ${cfg.chatId}`);
  try {
    await api.deleteWebhook();
    await api.setMyCommands([
      { command: 'start', description: 'Кто я и что умею' },
      { command: 'maxim_temp', description: 'Температура фраз (0–2), /maxim_temp 1.3 — задать' },
      { command: 'maxim_say', description: 'Напутствие прямо сейчас' },
      { command: 'maxim_status', description: 'Статус Максима' },
    ]);
  } catch (err) {
    console.error(`[maxim-bot] init (не фатально): ${errText(err)}`);
  }

  const llm = new LlmClient(getMaximLlmConfig());
  const store = new MaximStateStore(cfg);
  const st = store.state;

  // Миграция расписания: сохранённый nextNudgeAt, не попадающий на релизный
  // день (остаток старой схемы «раз в N дней»), пересчитываем по календарю.
  if (
    st.nextNudgeAt <= 0 ||
    !isReleaseDay(new Date(st.nextNudgeAt), cfg.releaseEpoch, cfg.releasePeriodDays)
  ) {
    st.nextNudgeAt = computeNextNudgeAt(new Date(), cfg);
  }
  // Рестарт: протухший pending (старше 10 мин) не эскалируем — непонятно,
  // отвечали ли, пока бот лежал. Свежий — доживает до тика планировщика.
  if (st.pending && Date.now() - st.pending.sentAt > PENDING_RESUME_WINDOW_MS) {
    st.pending = null;
  }
  store.save();
  console.error(
    `[maxim-bot] температура ${st.temperature}, капс через ${cfg.capsDelaySec} с, ` +
      `следующее напутствие ${new Date(st.nextNudgeAt).toISOString()}`,
  );

  let lastSayAt = 0;
  let shuttingDown = false;
  // Контекст диалогов: последние пары реплик на чат (in-memory; рестарт = чистый
  // лист). Отдельная история на группу и на каждую личку.
  const dialogHistories = new Map<string, ChatMessage[]>();
  const pushDialogHistory = (chatKey: string, userText: string, reply: string): void => {
    let h = dialogHistories.get(chatKey);
    if (!h) {
      h = [];
      dialogHistories.set(chatKey, h);
    }
    h.push(msg.user(userText), msg.assistant(reply));
    if (h.length > DIALOG_HISTORY_CAP) h.splice(0, h.length - DIALOG_HISTORY_CAP);
  };

  const sendNudge = async (): Promise<void> => {
    const release = isReleaseDay(new Date(), cfg.releaseEpoch, cfg.releasePeriodDays);
    const text = await generateNudge(llm, st.temperature, release);
    const messageId = await api.sendMessage(cfg.chatId, text);
    st.pending = { messageId, text, sentAt: Date.now() };
    st.nextNudgeAt = computeNextNudgeAt(new Date(), cfg);
    store.save();
    console.error(`[maxim-bot] напутствие отправлено (msg_id=${messageId ?? 'n/a'}, release=${release})`);
  };

  const sendCaps = async (): Promise<void> => {
    const pending = st.pending;
    if (!pending) return;
    const text = buildCapsMessage(pending.text, store.pingUsernames(me.id));
    await api.sendMessage(cfg.chatId, text, { replyTo: pending.messageId ?? undefined });
    st.pending = null;
    store.save();
    console.error(`[maxim-bot] капс-эскалация (на msg_id=${pending.messageId ?? 'n/a'})`);
  };

  const scheduler = setInterval(() => {
    if (shuttingDown) return;
    void (async () => {
      try {
        const now = Date.now();
        if (st.pending && now - st.pending.sentAt >= cfg.capsDelaySec * 1000) {
          await sendCaps();
        } else if (!st.pending && now >= st.nextNudgeAt) {
          await sendNudge();
        }
      } catch (err) {
        console.error(`[maxim-bot] scheduler error: ${errText(err)}`);
      }
    })();
  }, 5_000);

  const handleMessage = async (u: TgUpdate): Promise<void> => {
    const m = u.message;
    if (!m) return;
    const chatKey = String(m.chat.id);
    // Личка с ботом (положительный chat_id) — там каждое сообщение адресовано ему.
    const isPrivate = m.chat.type === 'private' || !chatKey.startsWith('-');
    if (!isPrivate && chatKey !== cfg.chatId) return;
    const from = m.from;
    if (!from || from.is_bot || from.id === me.id) return;
    store.touchParticipant(from);
    const text = m.text ?? '';
    const cmd = text.startsWith('/') ? parseMaximCommand(text, me.username) : null;
    if (cmd) {
      if (cmd.name === 'start') {
        await api.sendMessage(chatKey, START_INTRO);
      } else if (cmd.name === 'temp') {
        if (!cmd.arg) {
          await api.sendMessage(chatKey, `температура сейчас ${st.temperature} (0–2)`);
        } else {
          const t = parseTemperature(cmd.arg);
          if (t === null) {
            await api.sendMessage(chatKey, 'не понял. число от 0 до 2, например /maxim_temp 1.3');
          } else {
            st.temperature = t;
            store.save();
            await api.sendMessage(chatKey, `температура ${t}. посмотрим, что из этого выйдет`);
          }
        }
      } else if (cmd.name === 'say') {
        if (Date.now() - lastSayAt < SAY_COOLDOWN_MS) {
          await api.sendMessage(chatKey, 'только что говорил. минуту подожди');
        } else {
          lastSayAt = Date.now();
          st.pending = null; // не капсим на подавленное напутствие
          await sendNudge();
          if (isPrivate) await api.sendMessage(chatKey, 'напутствовал в чат');
        }
      } else {
        const release = isReleaseDay(new Date(), cfg.releaseEpoch, cfg.releasePeriodDays);
        await api.sendMessage(
          chatKey,
          [
            `день: ${release ? 'релизный, сегодня скажу своё слово' : 'обычный, молчу до релиза'}`,
            `температура: ${st.temperature}`,
            st.pending
              ? 'жду реакции на своё сообщение'
              : `следующее напутствие: ${new Date(st.nextNudgeAt).toLocaleString('ru-RU')}`,
          ].join('\n'),
        );
      }
      store.save();
      return;
    }
    // Эскалация снимается только активностью в рабочем чате — личка не в счёт.
    if (!isPrivate && st.pending) {
      st.pending = null;
      store.save();
    }
    if (!text) return;
    // Интерактив: в личке — любое сообщение; в чате — реплай ему, @упоминание,
    // «максим, …».
    const addressed =
      isPrivate ||
      isAddressedToBot({
        text,
        replyFromId: m.reply_to_message?.from?.id,
        botId: me.id,
        botUsername: me.username,
      });
    if (addressed) {
      const body = stripAddress(text, me.username) || 'привет';
      const quoted = m.reply_to_message?.text?.slice(0, 200);
      const content = quoted ? `(реплай на: «${quoted}»)\n${body}` : body;
      const mood = pickMood();
      const reply = await generateDialogReply(
        llm,
        st.temperature,
        dialogHistories.get(chatKey) ?? [],
        content,
        mood,
      );
      await api.sendMessage(chatKey, reply, { replyTo: m.message_id });
      pushDialogHistory(chatKey, content, reply);
      console.error(
        `[maxim-bot] диалог-ответ (${isPrivate ? 'личка' : 'чат'}, mood=${mood}, на msg_id=${m.message_id})`,
      );
    }
  };

  const abort = new AbortController();
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('[maxim-bot] SIGINT/SIGTERM — завершаюсь: persist state…');
    abort.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  let backoffMs = 0;
  const seen = new Set<number>();
  while (!shuttingDown) {
    let updates: TgUpdate[];
    try {
      updates = await api.getUpdates(st.offset, cfg.pollTimeoutSec, ['message'], abort.signal);
    } catch (err) {
      if (shuttingDown || abort.signal.aborted) break;
      if (err instanceof BotApiError && err.code === 409) {
        console.error('maxim-bot: 409 Conflict — токен уже используется (второй инстанс или webhook). Выхожу.');
        clearInterval(scheduler);
        process.exit(1);
      }
      backoffMs = backoffMs === 0 ? 1000 : Math.min(backoffMs * 2, 30_000);
      console.error(`[maxim-bot] poll error (${errText(err)}); пауза ${backoffMs} мс`);
      await sleepMs(backoffMs);
      continue;
    }
    backoffMs = 0;
    for (const u of updates) {
      if (seen.has(u.update_id)) {
        st.offset = u.update_id + 1;
        continue;
      }
      seen.add(u.update_id);
      if (seen.size > 20_000) seen.clear();
      try {
        await handleMessage(u);
      } catch (err) {
        console.error(`[maxim-bot] handler error (update_id=${u.update_id}): ${errText(err)}`);
      }
      st.offset = u.update_id + 1;
      store.save();
    }
  }

  clearInterval(scheduler);
  store.save();
  console.error('[maxim-bot] остановлен.');
  process.exit(0);
}
