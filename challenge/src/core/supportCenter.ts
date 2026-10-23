// Центр поддержки продукта «Артель»: FAQ-поиск без эмбеддингов (пересечение токенов),
// хранение обращений (тикеты) и опциональный LLM-рефайн с FAQ-контекстом.
// FAQ-корпус — про ЭТОТ продукт (автоматизация блогов, TG, календарь, мобильный клиент),
// а не про демо CloudNote. LLM инжектится — тесты без сети.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { msg } from './types.js';

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
  readonly keywords?: ReadonlyArray<string>;
}

export interface FaqMatch {
  readonly question: string;
  readonly answer: string;
  readonly score: number;
}

export const ARTEL_FAQ: ReadonlyArray<FaqEntry> = [
  {
    question: 'Как включить автоматическую публикацию блога?',
    answer:
      'Откройте /automation, выберите блог и включите правило: задайте интервал (минимум 5 минут) и флаг автопубликации. ' +
      'Расписание выполняется, пока запущен сервер. Ручной запуск — кнопкой «Запустить сейчас».',
    keywords: ['автоматизация', 'блог', 'публикация', 'расписание'],
  },
  {
    question: 'Как связать блог с Telegram-каналом?',
    answer:
      'В настройках блога задайте TG chat_id канала, а в .env — TG_BOT_TOKEN. Публикация идёт через Bot API; ' +
      'канал должен добавить бота администратором с правом постить.',
    keywords: ['телеграм', 'telegram', 'канал', 'бот'],
  },
  {
    question: 'Как синхронизировать задачи с Google Календарём?',
    answer:
      'Заполните GOOGLE_CALENDAR_CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN и CALENDAR_ID в .env. ' +
      'Затем /calendar → «Синхронизировать». Без ключей доступен экспорт .ics файла для ручного импорта.',
    keywords: ['календарь', 'google', 'синхронизация', 'ics'],
  },
  {
    question: 'Как подключить мобильное приложение?',
    answer:
      'Укажите адрес сервера и мобильный токен (MOBILE_API_TOKEN в .env) на экране подключения приложения. ' +
      'Токен задаётся вами и не сохраняется в приложении без вашего согласия.',
    keywords: ['мобильное', 'android', 'приложение', 'токен'],
  },
  {
    question: 'Почему не приходят уведомления?',
    answer:
      'Веб-уведомления требуют разрешения браузера; центр уведомлений доступен в /notifications. ' +
      'Telegram-уведомления требуют настроенного TG_BOT_TOKEN и chat_id получателя.',
    keywords: ['уведомления', 'браузер', 'telegram'],
  },
];

const TOKEN_RE = /[a-zа-яё0-9]+/gi;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length > 1);
}

/** FAQ-поиск: пересечение токенов вопроса и корпуса (0 — нет пересечения). */
export function searchFaq(question: string, faq: ReadonlyArray<FaqEntry> = ARTEL_FAQ): FaqMatch[] {
  const q = new Set(tokens(question));
  if (q.size === 0) return [];
  return faq
    .map((entry) => {
      const entryTokens = [...tokens(entry.question), ...tokens(entry.answer), ...tokens((entry.keywords ?? []).join(' '))];
      const unique = new Set(entryTokens);
      let hits = 0;
      for (const t of q) if (unique.has(t)) hits += 1;
      return { question: entry.question, answer: entry.answer, score: hits / q.size };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function buildSupportContext(question: string): ChatMessage[] {
  const matches = searchFaq(question);
  const faqBlock = matches
    .slice(0, 3)
    .map((m) => `В: ${m.question}\nО: ${m.answer}`)
    .join('\n\n');
  return [
    msg.system(
      'Ты — поддержка продукта «Артель». Отвечай кратко, по делу, на русском. ' +
        'Используй только факты из контекста FAQ; если ответа нет — честно скажи, что не знаешь, и предложи создать обращение.\n\n' +
        `КОНТЕКСТ FAQ:\n${faqBlock || '(пусто)'}`,
    ),
    msg.user(question),
  ];
}

export interface SupportTicketRow {
  id: number;
  subject: string;
  body: string;
  contact: string | null;
  status: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export class SupportCenterDb {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  createTicket(subject: string, body: string, contact: string | null = null): number {
    if (!subject.trim() || !body.trim()) throw new RangeError('subject and body must be non-empty');
    const result = this.db
      .prepare('INSERT INTO support_tickets (subject, body, contact) VALUES (?, ?, ?)')
      .run(subject.trim(), body.trim(), contact?.trim() || null);
    return Number(result.lastInsertRowid);
  }

  listTickets(limit = 50): SupportTicketRow[] {
    return this.db
      .prepare('SELECT * FROM support_tickets ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as SupportTicketRow[];
  }

  closeTicket(id: number): boolean {
    return this.db.prepare("UPDATE support_tickets SET status = 'closed' WHERE id = ?").run(id).changes > 0;
  }
}
