// Агент 3: TelegramScanner.
// Через MTProto (gram.js) читает последние посты из указанных каналов,
// считает реакции и просмотры, отдаёт самые горячие темы.
//
// Требует: TG_API_ID, TG_API_HASH в .env.
// При первом запуске — интерактивная авторизация по номеру телефона.
// Сессия сохраняется в .data/tg-session.json.

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import type { ProxyInterface } from 'telegram/network/connection/TCPMTProxy.js';
import { getTgMtprotoConfig, getTgSocksProxy } from '../env.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import QRCode from 'qrcode';
import type { SourceAgent, SourceAgentResult, TrendingTopic } from './sourceAgent.js';

/** Интерактивный ввод. По умолчанию — отдельный readline (для CLI/демо).
 * REPL передаёт свой callback, чтобы не создавать второй интерфейс на stdin. */
export type AskFn = (q: string) => Promise<string>;

function defaultAsk(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}

// Парсит SOCKS5-прокси из env. gram.js ходит напрямую по TCP,
// HTTPS_PROXY (для fetch) на него не влияет — нужен отдельный SOCKS.
// Приоритет: TG_SOCKS_PROXY > SOCKS_PROXY > вывод хоста из HTTPS_PROXY.
function parseSocksProxy(): ProxyInterface | undefined {
  const raw = getTgSocksProxy();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.hostname || !url.port) return undefined;
    return {
      socksType: 5,
      ip: url.hostname,
      port: Number(url.port),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    };
  } catch {
    return undefined;
  }
}

const CHANNELS = [
  'englishaccent',
  'news_blues',
  'Vstakane',
  'bitc2306',
  'lukomski',
];

export class TelegramScannerAgent implements SourceAgent {
  readonly name = 'telegram';
  private client: TelegramClient | null = null;
  private readonly sessionPath: string;
  private readonly ask: AskFn;

  constructor(sessionDir: string = '.data', ask?: AskFn) {
    mkdirSync(sessionDir, { recursive: true });
    this.sessionPath = path.join(sessionDir, 'tg-session.json');
    this.ask = ask ?? defaultAsk;
  }

  async askWithTimeout(question: string, ms: number): Promise<string> {
    return Promise.race([
      this.ask(question),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), ms),
      ),
    ]).catch((e) => {
      if (e instanceof Error && e.message === 'TIMEOUT') return '';
      throw e;
    });
  }

  async fetch(): Promise<SourceAgentResult> {
    try {
      const client = await this.getClient();
      const allTopics: TrendingTopic[] = [];

      for (const channel of CHANNELS) {
        try {
          const topics = await this.scanChannel(client, channel);
          allTopics.push(...topics);
        } catch (err) {
          console.error(`[telegram] ${channel}: ${(err as Error).message}`);
        }
      }

      // Сортируем по"hype score" (просмотры + реакции).
      allTopics.sort((a, b) => b.hypeScore - a.hypeScore);
      return { agent: this.name, topics: allTopics.slice(0, 15) };
    } catch (err) {
      return { agent: this.name, topics: [], error: (err as Error).message };
    }
  }

  private async scanChannel(client: TelegramClient, channel: string): Promise<TrendingTopic[]> {
    // Получаем последние посты из канала.
    const entity = await client.getEntity(channel);
    const messages = await client.getMessages(entity, { limit: 15 });

    const topics: TrendingTopic[] = [];

    for (const msg of messages) {
      if (!msg.message || msg.message.length < 20) continue;

      // Считаем реакции.
      let reactionCount = 0;
      if (msg.reactions) {
        for (const r of msg.reactions.results) {
          reactionCount += r.count;
        }
      }

      const views = msg.views ?? 0;
      const hypeScore = Math.min(100, Math.round((views / 100) + reactionCount));

      topics.push({
        title: msg.message.slice(0, 120).split('\n')[0],
        description: msg.message.slice(0, 200),
        source: `telegram/${channel}`,
        url: `https://t.me/${channel}/${msg.id}`,
        hypeScore,
        hypeReason: `${views} views, ${reactionCount} reactions`,
        rawContent: msg.message.slice(0, 500),
      });
    }

    return topics;
  }

  private async getClient(): Promise<TelegramClient> {
    if (this.client && this.client.connected) return this.client;

    const mtproto = getTgMtprotoConfig();
    if (!mtproto) {
      throw new Error('TG_API_ID или TG_API_HASH не заданы в .env');
    }
    const apiId = mtproto.apiId;
    const apiHash = mtproto.apiHash;

    // Загружаем сохранённую сессию.
    let sessionString = '';
    if (existsSync(this.sessionPath)) {
      const data = JSON.parse(readFileSync(this.sessionPath, 'utf-8')) as { session?: string };
      sessionString = data.session ?? '';
    }
    const session = new StringSession(sessionString);

    const proxy = parseSocksProxy();
    if (proxy) {
      console.log(`[telegram] SOCKS5 через ${proxy.ip}:${proxy.port}`);
    } else {
      console.warn('[telegram] SOCKS-прокси не задан — подключение напрямую (может зависнуть, если TG заблокирован)');
    }

    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      autoReconnect: false,
      ...(proxy ? { proxy } : {}),
    });

    await client.connect();

    if (await client.isUserAuthorized()) {
      console.log('[telegram] Сессия валидна, авторизация не требуется.');
      this.client = client;
      return client;
    }

    // ---- Ручной flow: виден полный ответ auth.SendCode ----
    const phone = await this.ask('Telegram номер (в формате +7XXXXXXXXXX): ');
    if (!phone) throw new Error('Номер не введён');

    // Шаг 1: отправляем код напрямую через invoke, чтобы увидеть
    // полный ответ (тип доставки, timeout, nextType, ошибки).
    // client.sendCode() прячет эти данные, возвращает только hash.
    let sentCode: Api.auth.SentCode;
    try {
      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({}),
        }),
      );
      if (!(result instanceof Api.auth.SentCode)) {
        throw new Error(`Неожиданный ответ Telegram: ${result.className}`);
      }
      sentCode = result;
    } catch (err) {
      const e = err as Error & { errorMessage?: string };
      const msg = e.errorMessage ?? e.message;
      if (msg?.includes('PHONE_NUMBER_INVALID')) {
        throw new Error('PHONE_NUMBER_INVALID: неверный формат номера. Нужен +7XXXXXXXXXX.');
      }
      if (msg?.includes('PHONE_MIGRATE_')) {
        // Telegram просит другой DC — gram.js обработает сам, попробуем ещё раз.
        throw new Error(`Phone migrate: ${msg}. Попробуйте ещё раз, gram.js переключит DC автоматически.`);
      }
      if (msg?.includes('FLOOD_WAIT_')) {
        const seconds = msg.match(/FLOOD_WAIT_(\d+)/)?.[1] ?? '?';
        throw new Error(`FloodWait: подождите ${seconds}с (${Math.ceil(Number(seconds) / 60)} мин) перед повторным запросом кода.`);
      }
      throw new Error(`auth.SendCode failed: ${msg}`);
    }

    // Выводим полный ответ Telegram — способ доставки, длина, timeout.
    const type = sentCode.type;
    const typeMap: Record<string, string> = {
      'auth.SentCodeTypeApp': 'приложение Telegram',
      'auth.SentCodeTypeSms': 'SMS',
      'auth.SentCodeTypeCall': 'звонок',
      'auth.SentCodeTypeFlashCall': 'flash-звонок',
      'auth.SentCodeTypeMissedCall': 'пропущенный звонок',
      'auth.SentCodeTypeFragmentSms': 'Fragment SMS',
      'auth.SentCodeTypeEmailCode': 'email',
      'auth.SentCodeTypeSetUpEmailRequired': 'требуется email',
    };
    const codeTypeStr = typeMap[type.className] ?? type.className;
    const codeLength = 'length' in type ? (type as { length?: number }).length : undefined;
    const nextType = sentCode.nextType;
    const nextTypeMap: Record<string, string> = {
      'auth.CodeTypeSms': 'SMS',
      'auth.CodeTypeCall': 'звонок',
      'auth.CodeTypeApp': 'приложение',
      'auth.CodeTypeMissedCall': 'пропущенный звонок',
      'auth.CodeTypeFragmentSms': 'Fragment SMS',
    };
    const nextTypeStr = nextType ? (nextTypeMap[nextType.className] ?? nextType.className) : 'нет';

    console.log('\n[telegram] === Ответ Telegram на auth.SendCode ===');
    console.log(`  способ доставки:    ${codeTypeStr}`);
    if (codeLength !== undefined) console.log(`  длина кода:         ${codeLength} цифр`);
    if (sentCode.timeout) console.log(`  timeout:            ${sentCode.timeout}с`);
    console.log(`  следующий способ:   ${nextTypeStr}`);
    console.log(`  phoneCodeHash:      ${sentCode.phoneCodeHash.slice(0, 16)}...`);
    console.log('');

    // Если код уходит в приложение, а у пользователя нет активной сессии
    // (или код не доходит) — даём выбор: повторить (SMS/звонок) или QR-логин.
    const resendChoice = await this.ask(
      'Код не пришёл? "sms" — выслать SMS, "qr" — вход по QR-коду, Enter — ввод кода: ',
    );

    if (resendChoice === 'sms' || resendChoice === 'call') {
      try {
        const reason = resendChoice === 'sms' ? 'sms' : 'call';
        const resendResult = await client.invoke(
          new Api.auth.ResendCode({
            phoneNumber: phone,
            phoneCodeHash: sentCode.phoneCodeHash,
            reason,
          }),
        );
        if (resendResult instanceof Api.auth.SentCode) {
          sentCode = resendResult;
          const newType = typeMap[sentCode.type.className] ?? sentCode.type.className;
          const newLen = 'length' in sentCode.type ? (sentCode.type as { length?: number }).length : undefined;
          console.log(`\n[telegram] Код переотправлен: ${newType}${newLen !== undefined ? `, ${newLen} цифр` : ''}\n`);
        }
      } catch (err) {
        const e = err as Error & { errorMessage?: string };
        console.log(`[telegram] ResendCode: ${e.errorMessage ?? e.message}\n`);
        console.log('[telegram] Попробуйте QR-логин (введите "qr" при следующей попытке).\n');
      }
    } else if (resendChoice === 'qr') {
      // QR-логин:扫码 вход через приложение Telegram.
      console.log('\n[telegram] Запуск QR-входа...\n');
      try {
        await client.signInUserWithQrCode(
          { apiId, apiHash },
          {
            qrCode: async ({ token }) => {
              const url = `tg://login?token=${token.toString('base64url')}`;
              const ascii = await QRCode.toString(url, { type: 'terminal', small: true });
              console.log(ascii);
              console.log('[telegram] Откройте Telegram → Настройки → Устройства → Сканировать QR-код');
              console.log('[telegram] Или перейдите по ссылке: ' + url);
              console.log('[telegram] Ожидание сканирования...\n');
            },
            password: async (hint?: string) => {
              console.log('[telegram] 2FA: нужен облачный пароль Telegram.');
              if (hint) console.log(`[telegram] Подсказка: ${hint}`);
              const pw = await this.ask('Облачный пароль: ');
              return pw;
            },
            onError: async (err) => {
              console.log(`[telegram] QR error: ${err.message}`);
              return true; // stop
            },
          },
        );
        // Если дошли сюда — авторизация через QR прошла.
        const newSession = session.save();
        writeFileSync(this.sessionPath, JSON.stringify({ session: newSession }), 'utf-8');
        console.log('[telegram] QR-вход успешен! Сессия сохранена.');
        this.client = client;
        return client;
      } catch (err) {
        const e = err as Error & { errorMessage?: string };
        throw new Error(`QR-вход не удался: ${e.errorMessage ?? e.message}`);
      }
    }

    // Шаг 2: ввод кода.
    const code = await this.askWithTimeout('Код из Telegram: ', 180_000);
    if (!code) {
      throw new Error('Код не введён или истёк таймаут (3 мин).');
    }

    // Шаг 3: авторизация кодом.
    try {
      const signInResult = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash: sentCode.phoneCodeHash,
          phoneCode: code,
        }),
      );

      if (signInResult instanceof Api.auth.AuthorizationSignUpRequired) {
        throw new Error('Telegram требует регистрацию нового аккаунта (этот номер не зарегистрирован).');
      }
      console.log('[telegram] Авторизация успешна.');
    } catch (err) {
      const e = err as Error & { errorMessage?: string };
      // 2FA: SESSION_PASSWORD_NEEDED — у аккаунта стоит облачный пароль.
      if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        console.log('[telegram] Включена двухфакторная авторизация (2FA).');
        const password = await this.ask('Облачный пароль Telegram: ');
        if (!password) throw new Error('Пароль не введён');

        const passwordSrp = await client.invoke(new Api.account.GetPassword());
        const passwordCheck = await computeCheck(passwordSrp, password);
        await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
        console.log('[telegram] 2FA пройдена, авторизация успешна.');
      } else if (e.errorMessage === 'PHONE_CODE_INVALID') {
        throw new Error('Неверный код. Проверьте код и попробуйте снова.');
      } else if (e.errorMessage === 'PHONE_CODE_EXPIRED') {
        throw new Error('Код истёк. Запросите новый код (подождите 60с, если был flood).');
      } else {
        throw new Error(`auth.SignIn failed: ${e.errorMessage ?? e.message}`);
      }
    }

    // Сохраняем сессию для будущих запусков.
    const newSession = session.save();
    writeFileSync(this.sessionPath, JSON.stringify({ session: newSession }), 'utf-8');
    console.log('[telegram] Сессия сохранена в', this.sessionPath);

    this.client = client;
    return client;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // ignore — клиент уже отключён
      }
      this.client = null;
    }
  }
}
