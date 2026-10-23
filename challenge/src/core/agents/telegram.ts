// Публикация постов в Telegram-канал.
// Использует Telegram Bot API через fetch.
// Токен — из .env (TG_BOT_TOKEN); chat_id — из .env (TG_CHAT_ID) или
// передан явно (мульти-блог: blogs.tg_chat_id).
// Прокси через HTTPS_PROXY (HTTP/HTTPS прокси, например gost → socks5).

import { getTgBotToken, getTgChatId } from '../env.js';

import { netFetch } from '../net.js';

export interface PublishResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export function isTelegramConfigured(): boolean {
  return Boolean(getTgBotToken() && getTgChatId());
}

export async function getBotInfo(): Promise<Record<string, unknown> | null> {
  const token = getTgBotToken();
  if (!token) return null;
  try {
    const res = await netFetch(`https://api.telegram.org/bot${token}/getMe`, {
      timeoutMs: 10_000,
      label: 'Telegram Bot API',
    });
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function publishPost(
  text: string,
  parseMode: 'HTML' | 'none' = 'HTML',
  chatId?: string,
): Promise<PublishResult> {
  const token = getTgBotToken();
  const targetChat = chatId ?? getTgChatId();

  if (!token || !targetChat) {
    return { ok: false, error: 'TG_BOT_TOKEN или TG_CHAT_ID не заданы в .env' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: Number(targetChat),
    text,
    parse_mode: parseMode === 'HTML' ? 'HTML' : undefined,
    disable_web_page_preview: true,
  });

  try {
    const res = await netFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: 15_000,
      label: 'Telegram Bot API',
    });
    const data = await res.json() as Record<string, unknown>;
    if (!data['ok']) {
      return { ok: false, error: String(data['description'] ?? ' неизвестная ошибка Telegram API') };
    }
    const result = data['result'] as Record<string, unknown>;
    return { ok: true, messageId: Number(result['message_id'] ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
