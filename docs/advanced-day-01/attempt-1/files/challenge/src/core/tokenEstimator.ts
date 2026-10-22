// Оценка стоимости диалога в токенах без вызова LLM и без зависимостей.
// Точный токенизатор (BPE модели) недоступен — эвристика: ~4 байта UTF-8
// на токен, округление вверх (консервативная оценка). Достаточно для
// бюджетирования контекста (fits/remaining перед отправкой в LLM),
// не для биллинга.

import type { ChatMessage, Role } from './types.js';

/** Оценка одного сообщения в разбивке. */
export interface MessageEstimate {
  index: number;
  role: Role;
  /** UTF-8 байты контента. */
  bytes: number;
  /** Оценка токенов: ceil(bytes / BYTES_PER_TOKEN). */
  tokens: number;
}

/** Итог оценки диалога: total + разбивка + бюджет. */
export interface TokenEstimate {
  /** Суммарная оценка по всем сообщениям. */
  total: number;
  /** Разбивка по сообщениям (порядок входа). */
  messages: MessageEstimate[];
  /** Заданный бюджет; без бюджета — null. */
  budget: number | null;
  /** budget − total; без бюджета — null. */
  remaining: number | null;
  /** total ≤ budget; без бюджета — всегда true (нечего превышать). */
  fits: boolean;
}

export class TokenEstimator {
  /** Среднее число UTF-8 байт на токен (эвристика, не биллинг). */
  static readonly BYTES_PER_TOKEN = 4;

  /** Оценка одной строки: UTF-8 байты + ceil(bytes / 4) токенов. */
  static estimateText(content: string): { bytes: number; tokens: number } {
    const bytes = Buffer.byteLength(content, 'utf8');
    return { bytes, tokens: Math.ceil(bytes / TokenEstimator.BYTES_PER_TOKEN) };
  }

  /** Оценка диалога: total, разбивка по сообщениям, остаток бюджета и fits. */
  static estimate(messages: ChatMessage[], budget?: number): TokenEstimate {
    const perMessage = messages.map((m, index) => ({
      index,
      role: m.role,
      ...TokenEstimator.estimateText(m.content),
    }));
    const total = perMessage.reduce((sum, m) => sum + m.tokens, 0);
    const hasBudget = budget !== undefined;
    return {
      total,
      messages: perMessage,
      budget: hasBudget ? budget : null,
      remaining: hasBudget ? budget - total : null,
      fits: !hasBudget || total <= budget,
    };
  }
}
