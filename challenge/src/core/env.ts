// Загрузка .env из корня репозитория (вверх от cwd).
// Импортируется из точки входа cli.ts, чтобы переменные были доступны
// всем модулям, включая telegram.ts, даже если LlmClient не используется.

import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { dataPath } from './paths.js';

let loaded = false;

export function loadEnvUpward(): void {
  if (loaded) return;
  loaded = true;

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, '.env'))) {
      dotenvConfig({ path: path.join(dir, '.env') });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenvConfig();
}

// --- Typed env-accessors ---
//
// Единая точка чтения секретов/конфигов: значения НЕ попадают в error-сообщения
// (только имена переменных), не логируются здесь. Секретоносные поля возвращаются
// как есть — потребитель не должен их печатать. Все строки — .trim(), пустые → ''
// или null/undefined-возврат.

/** Конфиг cloud-LLM: DeepSeek (приоритет) или OpenRouter. Бросает generic-ошибку. */
export interface LlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export function getLlmProviderConfig(): LlmProviderConfig {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (dsKey) {
    return {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: dsKey,
      defaultModel: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
    };
  }
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (orKey) {
    return {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: orKey,
      defaultModel: process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-3.5-flash',
    };
  }
  throw new Error(
    'Нет API-ключа LLM: задайте DEEPSEEK_API_KEY или OPENROUTER_API_KEY в .env. См. .env.example.',
  );
}

/**
 * Конфиг LLM для /какбы (бот «Медиум»): модель DeepSeek — напрямую
 * (DEEPSEEK_API_KEY → 'deepseek-chat') или через OpenRouter
 * ('deepseek/deepseek-chat-v3.1'). Переопределение — TG_BOT_KAKBY_MODEL.
 */
export function getKakbyLlmConfig(): LlmProviderConfig {
  const base = getLlmProviderConfig();
  const override = process.env.TG_BOT_KAKBY_MODEL?.trim();
  if (override) return { ...base, defaultModel: override };
  return {
    ...base,
    defaultModel: base.baseUrl.includes('deepseek.com')
      ? 'deepseek-chat'
      : 'deepseek/deepseek-chat-v3.1',
  };
}

/**
 * Конфиг cloud-refine для dev-assistant: ИМЕННО OpenRouter (default Claude),
 * БЕЗ приоритета DeepSeek (в отличие от getLlmProviderConfig — там DeepSeek
 * перебивает, а refine-стадия всегда идёт через cloud Claude). null если
 * OPENROUTER_API_KEY не задан — потребитель (devAssistant) показывает cloud-down
 * fallback. Значение ключа НЕ попадает в error/логи.
 */
export function getOpenRouterConfig(): LlmProviderConfig | null {
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!orKey) return null;
  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: orKey,
    defaultModel: process.env.OPENROUTER_MODEL?.trim() || 'anthropic/claude-haiku-4-5',
  };
}

/** HTTPS-прокси для исходящих fetch к cloud-провайдерам (OpenRouter/DeepSeek).
 *  null если не задан — запрос идёт напрямую. Чтение сосредоточено в env.ts
 *  (инвариант: process.env вне env.ts запрещён). */
export function getHttpsProxy(): string | null {
  return process.env['HTTPS_PROXY']?.trim() || process.env['https_proxy']?.trim() || null;
}

/** Конфиг локального LLM (Ollama). Бросает generic-ошибку без значений. */
export interface LocalLlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function getLocalLlmConfig(): LocalLlmConfig {
  const baseUrl = process.env.LOCAL_LLM_BASE_URL?.trim();
  const model = process.env.LOCAL_LLM_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      'Локальный LLM не настроен: задайте LOCAL_LLM_BASE_URL и LOCAL_LLM_MODEL в .env.',
    );
  }
  return { baseUrl, model, apiKey: process.env.LOCAL_LLM_API_KEY?.trim() ?? '' };
}

/** Конфиг локальных эмбеддингов. Бросает generic-ошибку без значений. */
export interface EmbedConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function getEmbedConfig(): EmbedConfig {
  const baseUrl = process.env.LOCAL_EMBED_BASE_URL?.trim();
  const model = process.env.LOCAL_EMBED_MODEL?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      'Локальные эмбеддинги не настроены: задайте LOCAL_EMBED_BASE_URL и LOCAL_EMBED_MODEL в .env.',
    );
  }
  return { baseUrl, model, apiKey: process.env.LOCAL_EMBED_API_KEY?.trim() ?? '' };
}

/** MTProto session: env TG_SESSION (приоритет) либо .data/tg-session.json. null если нет. */
function readTgSession(): string | null {
  const env = process.env.TG_SESSION;
  if (env && env.trim()) return env.trim();
  try {
    const obj = JSON.parse(readFileSync(dataPath('tg-session.json'), 'utf8')) as {
      session?: unknown;
    };
    if (typeof obj.session === 'string' && obj.session.trim()) return obj.session.trim();
  } catch {
    /* файла нет или битый — не страшно */
  }
  return null;
}

/** Конфиг MTProto-scan (userbot). null если что-то из apiId/apiHash/session отсутствует. */
export interface TgScanConfig {
  apiId: number;
  apiHash: string;
  session: string;
}

export function getTgScanConfig(): TgScanConfig | null {
  const apiIdRaw = process.env.TG_API_ID?.trim();
  const apiHash = process.env.TG_API_HASH?.trim();
  const session = readTgSession();
  if (!apiIdRaw || !apiHash || !session) return null;
  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId)) return null;
  return { apiId, apiHash, session };
}

/** TCP-туннель к Telegram DC (socat на прокси). Дефолты — публичные хост/порт. */
export function getTgTunnel(): { host: string; port: number } {
  return {
    host: process.env.TG_TUNNEL_HOST?.trim() || '91.199.147.131',
    port: Number(process.env.TG_TUNNEL_PORT) || 8081,
  };
}

/** topicId по умолчанию для TG-команд (env TG_TOPIC). Числовой override. */
export function getTgTopic(): number | undefined {
  const raw = process.env.TG_TOPIC?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Bot API config для публикации/уведомлений. null если токен/chatId отсутствуют. */
export function getTgBotConfig(): { botToken: string; chatId: string } | null {
  const botToken = process.env.TG_BOT_TOKEN?.trim();
  const chatId = process.env.TG_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/** Токен Telegram Bot API без привязки к chatId (chat может приходить параметром — мульти-блог). */
export function getTgBotToken(): string | null {
  return process.env.TG_BOT_TOKEN?.trim() || null;
}

/** chat_id канала по умолчанию. null если не задан. */
export function getTgChatId(): string | null {
  return process.env.TG_CHAT_ID?.trim() || null;
}

/** SOCKS5-прокси для gram.js (MTProto ходит по TCP, HTTPS_PROXY на него не влияет).
 *  Приоритет: TG_SOCKS_PROXY > SOCKS_PROXY > HTTPS_PROXY > https_proxy. null если ничего не задано. */
export function getTgSocksProxy(): string | null {
  return (
    process.env['TG_SOCKS_PROXY']?.trim() ||
    process.env['SOCKS_PROXY']?.trim() ||
    process.env['HTTPS_PROXY']?.trim() ||
    process.env['https_proxy']?.trim() ||
    null
  );
}

/** MTProto-креды грам.js. null если apiId/apiHash не заданы. */
export function getTgMtprotoConfig(): { apiId: number; apiHash: string } | null {
  const apiId = Number(process.env['TG_API_ID']);
  const apiHash = process.env['TG_API_HASH']?.trim();
  if (!apiId || !apiHash) return null;
  return { apiId, apiHash };
}

/** Опциональный bearer-токен для auth на MCP HTTP-сервере. undefined если не задан. */
export function getMcpAuth(): string | undefined {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  return token || undefined;
}

/**
 * Конфиг рантайм-бота «Медиум» (CLI tg-bot). null если нет TG_BOT_TOKEN.
 * allowChats — CSV TG_BOT_ALLOW_CHATS; пусто = бот не работает (fail-closed,
 * проверяется на старте). ownerChatId — TG_BOT_OWNER_ID (user id владельца для
 * админ-команд и лички); без него — первый ЛИЧНЫЙ (положительный) chat_id из
 * allow-list, иначе null (админ-команды недоступны).
 */
export interface TgBotRuntimeConfig {
  botToken: string;
  allowChats: ReadonlySet<string>;
  ownerChatId: string | null;
  pollTimeoutSec: number;
}

export function getTgBotRuntimeConfig(): TgBotRuntimeConfig | null {
  const botToken = process.env.TG_BOT_TOKEN?.trim() || '';
  if (!botToken) return null;
  const allowChats = (process.env.TG_BOT_ALLOW_CHATS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ownerRaw = process.env.TG_BOT_OWNER_ID?.trim() || '';
  const ownerChatId =
    ownerRaw || allowChats.find((id) => !id.startsWith('-')) || null;
  const pollRaw = Number(process.env.TG_BOT_POLL_TIMEOUT?.trim());
  const pollTimeoutSec =
    Number.isFinite(pollRaw) && pollRaw >= 5 && pollRaw <= 120 ? pollRaw : 25;
  return { botToken, allowChats: new Set(allowChats), ownerChatId, pollTimeoutSec };
}

/**
 * Конфиг LLM для бота «Максим Артемьевич»: ИМЕННО DeepSeek — напрямую
 * (DEEPSEEK_API_KEY → 'deepseek-chat') или через OpenRouter
 * ('deepseek/deepseek-chat-v3.1'). Переопределение — MAXIM_MODEL.
 */
export function getMaximLlmConfig(): LlmProviderConfig {
  const base = getLlmProviderConfig();
  const override = process.env.MAXIM_MODEL?.trim();
  if (override) return { ...base, defaultModel: override };
  return {
    ...base,
    defaultModel: base.baseUrl.includes('deepseek.com')
      ? 'deepseek-chat'
      : 'deepseek/deepseek-chat-v3.1',
  };
}

/**
 * Конфиг бота «Максим Артемьевич» (CLI maxim-bot): QA Lead front-back, шлёт
 * напутствия в чат и капсит, если нет ответа. null если нет MAXIM_BOT_TOKEN.
 * chatId — MAXIM_CHAT_ID (fail-closed: пусто = бот не стартует, проверяется
 * в рантайме). ownerId — MAXIM_OWNER_ID (user id владельца; null = команды
 * настройки доступны всем участникам чата).
 */
export interface MaximBotConfig {
  botToken: string;
  chatId: string;
  ownerId: string | null;
  pollTimeoutSec: number;
  /** Дефолтная температура генерации напутствий (0–2), меняется командой в чате. */
  temperature: number;
  /** Задержка капса при молчании чата (сек). */
  capsDelaySec: number;
  /** Календарь релизов: дата первого релиза (YYYY-MM-DD) и период в днях. */
  releaseEpoch: string;
  releasePeriodDays: number;
  /** Окно напутствия в обычный день (часы локального времени). */
  dailyWindowStartHour: number;
  dailyWindowEndHour: number;
  /** Интервал напутствий в обычные дни (дней; в релизные — hotInterval). */
  normalIntervalDays: number;
  /** Интервал напутствий в день релиза и на следующий (минуты, min–max). */
  hotIntervalMinMin: number;
  hotIntervalMaxMin: number;
}

export function getMaximBotConfig(): MaximBotConfig | null {
  const botToken = process.env.MAXIM_BOT_TOKEN?.trim() || '';
  if (!botToken) return null;
  const num = (name: string, def: number): number => {
    const raw = process.env[name]?.trim();
    if (!raw) return def;
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  };
  const pollRaw = num('MAXIM_POLL_TIMEOUT', 25);
  return {
    botToken,
    chatId: process.env.MAXIM_CHAT_ID?.trim() || '',
    ownerId: process.env.MAXIM_OWNER_ID?.trim() || null,
    pollTimeoutSec: pollRaw >= 5 && pollRaw <= 120 ? pollRaw : 25,
    temperature: Math.min(2, Math.max(0, num('MAXIM_TEMPERATURE', 1.0))),
    capsDelaySec: Math.max(10, num('MAXIM_CAPS_DELAY_SEC', 120)),
    releaseEpoch: process.env.MAXIM_RELEASE_EPOCH?.trim() || '2026-10-06',
    releasePeriodDays: Math.max(1, num('MAXIM_RELEASE_PERIOD_DAYS', 14)),
    dailyWindowStartHour: num('MAXIM_DAILY_WINDOW_START', 10),
    dailyWindowEndHour: num('MAXIM_DAILY_WINDOW_END', 20),
    normalIntervalDays: Math.max(1, num('MAXIM_NORMAL_INTERVAL_DAYS', 3)),
    hotIntervalMinMin: Math.max(1, num('MAXIM_HOT_INTERVAL_MIN', 60)),
    hotIntervalMaxMin: Math.max(1, num('MAXIM_HOT_INTERVAL_MAX', 180)),
  };
}

/**
 * Конфиг приватного LLM-gateway (day-30): порт bind, auth-токен (отдельный домен
 * от MCP_AUTH_TOKEN), RPS/TPM-лимиты, concurrency-кап и max-context-tokens cap.
 * Дефолты рассчитаны на один инстанс vLLM/Ollama на loopback. Секрет (authToken)
 * НЕ попадает в error/логи — потребитель не должен его печатать.
 */
export interface PrivateLlmServiceConfig {
  port: number;
  authToken?: string;
  rateRps: number;
  rateTpm: number;
  maxConcurrency: number;
  maxContextTokens: number;
}

export function getPrivateLlmServiceConfig(): PrivateLlmServiceConfig {
  const num = (name: string, def: number): number => {
    const raw = process.env[name]?.trim();
    if (!raw) return def;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : def;
  };
  return {
    port: num('PRIVATE_LLM_PORT', 3030),
    authToken: process.env.PRIVATE_LLM_AUTH_TOKEN?.trim() || undefined,
    rateRps: num('PRIVATE_LLM_RATE_RPS', 5),
    rateTpm: num('PRIVATE_LLM_RATE_TPM', 10_000),
    maxConcurrency: num('PRIVATE_LLM_MAX_CONCURRENCY', 4),
    maxContextTokens: num('PRIVATE_LLM_MAX_CONTEXT_TOKENS', 3_500),
  };
}
