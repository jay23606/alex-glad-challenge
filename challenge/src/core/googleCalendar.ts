// Клиент Google Calendar (сервер-к-серверу через OAuth refresh token).
// Без внешних зависимостей: нативный fetch + AbortSignal.timeout. Ошибки наружу —
// без значений токенов. Секреты — из getGoogleCalendarConfig() (core/env.ts).

import type { GoogleCalendarConfig } from './env.js';
import type { CalendarEvent } from './calendar.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars';

export interface GoogleCalendarClientOptions {
  readonly config: GoogleCalendarConfig;
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}

interface AccessTokenResponse {
  access_token?: string;
}

interface GoogleEventBody {
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  id?: string;
}

export class GoogleCalendarClient {
  private readonly config: GoogleCalendarConfig;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private cachedToken: string | null = null;

  constructor(opts: GoogleCalendarClientOptions) {
    this.config = opts.config;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async accessToken(): Promise<string> {
    if (this.cachedToken) return this.cachedToken;
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`google token exchange failed: HTTP ${res.status}`);
    const json = (await res.json()) as AccessTokenResponse;
    if (!json.access_token) throw new Error('google token exchange returned no access_token');
    this.cachedToken = json.access_token;
    return json.access_token;
  }

  /** Создаёт событие; возвращает google eventId. Бросает при ошибке (без значений секретов). */
  async insertEvent(event: CalendarEvent): Promise<string> {
    const token = await this.accessToken();
    const body: GoogleEventBody = {
      summary: event.title,
      start: { dateTime: event.start },
      end: { dateTime: event.end ?? new Date(Date.parse(event.start) + 30 * 60_000).toISOString() },
      id: event.uid.replace(/[^a-zA-Z0-9_@-]/g, '_'),
    };
    if (event.description) body.description = event.description;
    const url = `${EVENTS_URL}/${encodeURIComponent(this.config.calendarId)}/events`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`google calendar insert failed: HTTP ${res.status}`);
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error('google calendar insert returned no id');
    return json.id;
  }
}
