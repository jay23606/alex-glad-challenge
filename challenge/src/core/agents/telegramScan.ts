// MTProto-клиент (GramJS) для сканирования истории чата (день 19).
//
// Bot API НЕ умеет читать чужую историю — только сообщения, пришедшие боту.
// Чтобы просканировать «последние N сообщений в чате», нужен userbot:
// api_id + api_hash + session (my.telegram.org → Apps). Session-строка
// генерируется одноразовым логином и хранится в .env (TG_SESSION).
//
// Сервер подключает клиент один раз (connectScanClient при старте) и переиспользует.
//
// PROXY: VPS заблокирован для прямых IP Telegram DC. Используем TCP-туннель
// через socat на прокси-сервере: 91.199.147.131:8081 → 149.154.167.51:80 (DC2).
// GramJS подключается как будто к DC напрямую, но байты идут через туннель.

import net from 'node:net';

import { getTgScanConfig, getTgTunnel } from '../env.js';

export interface ScannedMessage {
  from: string;
  text: string;
  date: string; // ISO
}

export interface ScanResult {
  chat: string;
  total: number;
  messages: ScannedMessage[];
}

// GramJS-объекты типизированы тяжело; работаем через минимальные интерфейсы,
// приводя к ним реальные объекты (поведение проверяется на живом логине).
interface DialogLike {
  title?: string;
  entity?: unknown;
}
export interface MsgLike {
  message?: string;
  senderId?: { toString(): string } | bigint | number | null;
  date?: number;
  sender?: { firstName?: string; lastName?: string; title?: string; username?: string } | null;
}
interface ScanClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getEntity(peer: string): Promise<unknown>;
  getDialogs(opts: { limit: number }): Promise<DialogLike[]>;
  getMessages(entity: unknown, opts: { limit: number }): Promise<MsgLike[]>;
}

// Структурная проекция сырого gramjs TelegramClient для topic-коллектора.
// НЕ grain gramjs-тип (top-level runtime-import telegram запрещён инвариантом
// «сервер поднимается без telegram»). Коллектор кастит сырой клиент к этому
// интерфейсу через unknown; итераторы сообщений приводятся к RawTgMessage в
// самом коллекторе (core/tg/topicCollector.ts).
export interface RawTelegramClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getEntity(peer: string): Promise<unknown>;
  iterMessages(entity: unknown, opts: Record<string, unknown>): AsyncIterable<unknown>;
}

let client: ScanClient | null = null;
// Singleton сырого gramjs-клиента для topic-коллектора. Живёт рядом с узким
// `client`; один init/туннель/session на процесс — TG_SESSION в одном месте.
let rawClient: RawTelegramClient | null = null;

/**
 * TCP-туннельный WebSocket transport для gramJS.
 * Вместо WSS-подключения к Telegram DC, создаёт обычный TCP-сокет
 * к socat-туннелю на прокси-сервере. Байты MTProto идут прозрачно.
 *
 * gramJS думает что подключается через WebSocket, но на самом деле
 * данные текут через raw TCP → socat → Telegram DC.
 */
function TcpTunnelWebSockets(tunnelHost: string, tunnelPort: number) {
  const closeError = new Error('TCP tunnel was closed');

  return class {
    private socket: net.Socket | null = null;
    private stream = Buffer.alloc(0);
    private closed = true;
    private resolveRead: (() => void) | null = null;
    private readWait: Promise<void>;

    constructor() {
      this.readWait = new Promise(() => {});
    }

    /** Signal that data is available for reading. */
    private wake(): void {
      if (this.resolveRead) {
        const fn = this.resolveRead;
        this.resolveRead = null;
        fn();
      }
    }

    /** Wait until data is available, then return. */
    private async waitData(): Promise<void> {
      if (this.stream.length > 0) return;
      this.readWait = new Promise<void>((resolve) => { this.resolveRead = resolve; });
      await this.readWait;
    }

    async readExactly(number: number): Promise<Buffer> {
      let data = Buffer.alloc(0);
      while (number > 0) {
        await this.waitData();
        if (this.closed) throw closeError;
        const take = Math.min(number, this.stream.length);
        data = Buffer.concat([data, this.stream.slice(0, take)]);
        this.stream = this.stream.slice(take);
        number -= take;
        if (number < 0) number = 0;
      }
      return data;
    }

    async read(number: number): Promise<Buffer> {
      await this.waitData();
      if (this.closed) throw closeError;
      const ret = this.stream.slice(0, number);
      this.stream = this.stream.slice(number);
      return ret;
    }

    async readAll(): Promise<Buffer> {
      await this.waitData();
      if (this.closed) throw closeError;
      const ret = this.stream;
      this.stream = Buffer.alloc(0);
      return ret;
    }

    async connect(_port: number, _ip: string, _testServers = false): Promise<this> {
      this.stream = Buffer.alloc(0);
      this.closed = false;
      this.resolveRead = null;

      return new Promise<this>((resolve, reject) => {
        const sock = net.connect(tunnelPort, tunnelHost, () => {
          sock.on('data', (chunk: Buffer) => {
            this.stream = Buffer.concat([this.stream, chunk]);
            this.wake();
          });
          sock.on('error', (err) => reject(err));
          sock.on('close', () => { this.closed = true; this.wake(); });
          resolve(this);
        });
        this.socket = sock;
      });
    }

    write(data: Buffer): void {
      if (this.closed) throw closeError;
      this.socket?.write(data);
    }

    async close(): Promise<void> {
      this.socket?.destroy();
      this.closed = true;
      this.wake();
    }

    toString(): string { return 'TcpTunnelWebSocket'; }
  };
}

/** Настроен ли MTProto-scan: apiId/apiHash/session заданы. */
export function isScanConfigured(): boolean {
  return getTgScanConfig() !== null;
}

/** Подключить MTProto-клиента (один раз). false — если не настроено.
 * GramJS грузится лениво, чтобы сервер поднимался даже без установленного
 * `telegram` (или при сбое сети/сессии) — scan-тул просто деградирует. */
export async function connectScanClient(): Promise<boolean> {
  if (!isScanConfigured()) return false;
  if (client) return true;

  const cfg = getTgScanConfig();
  if (!cfg) return false;
  const sessionStr = cfg.session;
  const apiId = cfg.apiId;
  const apiHash = cfg.apiHash;

  try {
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions');
    const { ConnectionTCPObfuscated } = await import('telegram/network/connection/TCPObfuscated.js');

    // TCP-туннель через socat на прокси-сервере → DC2 (149.154.167.51:80)
    // env TG_TUNNEL_HOST / TG_TUNNEL_PORT (по умолчанию 91.199.147.131:8081)
    const { host: tunnelHost, port: tunnelPort } = getTgTunnel();

    const clientParams: Record<string, unknown> = {
      connectionRetries: 3,
      connection: ConnectionTCPObfuscated,
      useWSS: false,
      networkSocket: TcpTunnelWebSockets(tunnelHost, tunnelPort),
    };

    const raw = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, clientParams);
    // DC2: 149.154.167.51:80 — но подключаемся через туннель,
    // поэтому IP/port не имеют значения (connect() игнорирует их в нашем TcpTunnel)
    // Граница gram.js: типизация TelegramClient не экспортирует session.setDC,
    // но рантайм-объект StringSession её имеет — сужающий каст вместо any.
    const session = (raw as unknown as { session: { setDC(dc: number, ip: string, port: number): void } })
      .session;
    session.setDC(2, '149.154.167.51', 80);
    await Promise.race([
      raw.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MTProto connect timed out (20s)')), 45_000),
      ),
    ]);
    client = raw as unknown as ScanClient;
    rawClient = raw as unknown as RawTelegramClient;
    return true;
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`MTProto connect failed: ${m}`);
    return false;
  }
}

export async function disconnectScanClient(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
    rawClient = null; // коллектор больше не получит stale-ссылку после disconnect
  }
}

/**
 * Singleton сырого gramjs-клиента для topic-коллектора (core/tg/topicCollector.ts).
 * Переиспользует единый init/туннель/session с scan-путём — НЕ дублирует TG_SESSION.
 * Возвращает null, если MTProto не настроен/недоступен (деградация как connectScanClient).
 */
export async function getConnectedRawScanClient(): Promise<RawTelegramClient | null> {
  if (!rawClient) {
    const ok = await connectScanClient();
    if (!ok) return null;
  }
  return rawClient;
}

export function senderName(m: MsgLike): string {
  const s = m.sender;
  if (s) {
    if (s.firstName || s.lastName) return [s.firstName, s.lastName].filter(Boolean).join(' ');
    if (s.title) return s.title;
    if (s.username) return '@' + s.username;
  }
  return m.senderId == null ? 'unknown' : String(m.senderId);
}

export function msgDateIso(m: MsgLike): string {
  return typeof m.date === 'number' ? new Date(m.date * 1000).toISOString() : '';
}

/**
 * Прочитать последние `limit` сообщений из чата `chat`.
 * `chat` — username/@username, числовой id или заголовок (ищется в диалогах).
 */
export async function scanChatMessages(chat: string, limit: number): Promise<ScanResult> {
  if (!client) {
    const ok = await connectScanClient();
    if (!ok || !client) throw new Error('scan client not connected (MTProto unavailable)');
  }

  let entity: unknown;
  let title = chat;
  if (/^-?\d+$/.test(chat) || chat.startsWith('@')) {
    entity = await client.getEntity(chat);
  } else {
    const dialogs = await client.getDialogs({ limit: 200 });
    const found = dialogs.find((d) => (d.title ?? '').toLowerCase().includes(chat.toLowerCase()));
    if (!found?.entity) throw new Error(`chat "${chat}" not found in dialogs`);
    entity = found.entity;
    title = found.title ?? chat;
  }

  const msgs = await client.getMessages(entity, { limit });
  const messages: ScannedMessage[] = msgs.map((m) => ({
    from: senderName(m),
    text: m.message ?? '',
    date: msgDateIso(m),
  }));
  return { chat: title, total: messages.length, messages };
}

export const STOP_WORDS = new Set([
  'и', 'в', 'во', 'на', 'не', 'что', 'это', 'я', 'а', 'с', 'по', 'для', 'но', 'же', 'бы',
  'ли', 'как', 'так', 'то', 'он', 'она', 'они', 'мы', 'вы', 'ты', 'его', 'ее', 'их',
  'про', 'над', 'под', 'при', 'без', 'через', 'после', 'перед', 'между', 'против',
  'среди', 'вместо', 'кроме', 'вокруг', 'ради', 'мимо', 'около', 'возле',
  'the', 'a', 'an', 'to', 'of', 'and', 'in', 'is', 'it', 'for', 'on', 'with', 'as', 'at',
]);

/** Детерминированный отчёт по сообщениями (без LLM) — шаг «обработка». */
export function analyzeMessages(s: ScanResult): string {
  const ms = s.messages;
  const bySender: Record<string, number> = {};
  const termCount: Record<string, number> = {};
  let links = 0;

  for (const m of ms) {
    bySender[m.from] = (bySender[m.from] ?? 0) + 1;
    if (m.text.includes("http")) links++;
    const tokens = m.text.toLowerCase().match(/[a-zа-яё0-9]{3,}/gi);
    if (tokens) {
      for (const w of tokens) {
        if (STOP_WORDS.has(w)) continue;
        termCount[w] = (termCount[w] ?? 0) + 1;
      }
    }
  }

  const topSenders = Object.entries(bySender)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');
  const topTerms = Object.entries(termCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
  const dates = ms.map((m) => m.date).filter(Boolean).sort();
  const range = dates.length ? `${dates[0]} … ${dates[dates.length - 1]}` : '—';

  return [
    `Анализ чата «${s.chat}» (${ms.length} сообщений)`,
    `Период: ${range}`,
    `Авторов: ${Object.keys(bySender).length}; топ: ${topSenders || '—'}`,
    `Ссылок: ${links}`,
    `Топ-термины: ${topTerms || '—'}`,
  ].join('\n');
}
