// Безопасный bridge к core/env.ts accessors для web-сервера.
//
// Next.js НЕ ходит вверх от web/ за .env — поэтому явно зовём loadEnvUpward(), она
// поднимается от process.cwd() (web/) до корня репо и грузит .env оттуда.
//
// ГАРАНТИЯ: наружу уходят ТОЛЬКО флаги наличия (Boolean) и public-мета (имя провайдера,
// модель). Значения ключей/TG_SESSION/токенов НИКОГДА не покидают этот модуль. Ошибки
// accessors (бросают generic-сообщения без значений) сглатываются → configured:false.
import 'server-only';
import {
  loadEnvUpward,
  getLlmProviderConfig,
  getLocalLlmConfig,
  getEmbedConfig,
  getTgScanConfig,
  getTgBotConfig,
  getGoogleCalendarConfig,
} from '@challenge/core/env';

loadEnvUpward();

export interface CloudLlmStatus {
  configured: boolean;
  /** Имя провайдера выводится из baseUrl (не секрет). undefined если не настроен. */
  provider?: string;
  /** Дефолтная модель провайдера (не секрет). */
  model?: string;
}
export interface LocalLlmStatus {
  configured: boolean;
  model?: string;
}
export interface EmbedStatus {
  configured: boolean;
  model?: string;
}

export interface KeysStatus {
  cloud: CloudLlmStatus;
  local: LocalLlmStatus;
  embed: EmbedStatus;
  /** MTProto userbot: apiId/apiHash/session — только configured yes/no. */
  mtproto: { configured: boolean };
  /** Bot API (публикация/уведомления): configured + маскированная метка канала
   *  для confirm-диалогов (-100…7890). Полные значения NEVER. */
  botApi: { configured: boolean; channelLabel: string | null };
  /** Активная модель для dashboard: cloud приоритет, иначе local. null если ничего. */
  activeModel: string | null;
  activeProvider: string | null;
}

// Маска цели публикации: первые 4 и последние 4 символа chat_id. Не секрет-значение,
// но достаточно для «куда уйдёт пост» в ConfirmDialog (ТЗ §7.1 п.5).
function maskChannelId(id: string): string {
  const s = id.trim();
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

export function getKeysStatus(): KeysStatus {
  let cloud: CloudLlmStatus = { configured: false };
  try {
    const c = getLlmProviderConfig();
    // apiKey не читаем и не отдаём; provider определяем по baseUrl.
    cloud = {
      configured: true,
      provider: c.baseUrl.includes('deepseek') ? 'DeepSeek' : 'OpenRouter',
      model: c.defaultModel,
    };
  } catch {
    cloud = { configured: false };
  }

  let local: LocalLlmStatus = { configured: false };
  try {
    const l = getLocalLlmConfig();
    local = { configured: true, model: l.model };
  } catch {
    local = { configured: false };
  }

  let embed: EmbedStatus = { configured: false };
  try {
    const e = getEmbedConfig();
    embed = { configured: true, model: e.model };
  } catch {
    embed = { configured: false };
  }

  const mtproto = { configured: getTgScanConfig() !== null };
  const botCfg = getTgBotConfig();
  const botApi = {
    configured: botCfg !== null,
    channelLabel: botCfg ? maskChannelId(botCfg.chatId) : null,
  };

  return {
    cloud,
    local,
    embed,
    mtproto,
    botApi,
    activeModel: cloud.model ?? local.model ?? null,
    activeProvider: cloud.provider ?? (local.configured ? 'Local LLM' : null),
  };
}

// MCP HTTP-сервер: URL задаётся через MCP_SERVER_URL (тот же env, что в cli.ts/repl.ts).
// Если переменная не задана — configured:false, url:null (роуты /mcp/* показывают graceful
// «не настроен» и НЕ ходят на дефолтный внешний URL — соответствие §8 SSRF-осторожности).
// url отдаётся только сервер-сайд (роут маскирует до host перед отправкой клиенту).
export interface McpServerUrlStatus {
  configured: boolean;
  url: string | null;
}

export function getMcpServerUrl(): McpServerUrlStatus {
  const url = process.env.MCP_SERVER_URL?.trim() || null;
  return { configured: url !== null, url };
}

// MCP bearer-auth токен (опциональный). Сервер-сайд только: McpHttpClient его не шлёт
// (текущий transport без Authorization-хедера), но индикатор наличия полезен для /settings.
export function isMcpAuthConfigured(): boolean {
  return Boolean(process.env.MCP_AUTH_TOKEN?.trim());
}

// Admin-auth web/ (день 36): флаг наличия для UI-индикаторов (точка для будущего
// индикатора /settings). Реализация — lib/auth.ts, единая для middleware и роутов
// (оттуда её же видит middleware — поэтому НЕ здесь). Наружу только Boolean.
export { isAdminAuthConfigured } from '../auth';

/** Google Calendar OAuth: наружу только configured-флаг (значения секретов никогда). */
export function getGoogleCalendarStatus(): { configured: boolean } {
  return { configured: getGoogleCalendarConfig() !== null };
}
