// TokenEstimator — грубая оценка токенов по UTF-8-байтам без токенизатора.
//
// Эвристика: tokens = ceil(bytes / bytesPerToken), по умолчанию 4 байта на токен.
// Оценка детерминированная и не ходит в сеть; она нужна для бюджета контекста,
// а не для биллинга. total — сумма по-сообщенных оценок (каждое сообщение
// округляется вверх отдельно), поэтому total всегда сходится с breakdown.
//
// Инварианты: bytesPerToken — положительное конечное число; budget — целое ≥ 0.
// Без budget ограничения нет: budget/remaining = null, fits = true.

import type { ChatMessage, Role } from './types.js';

export const DEFAULT_BYTES_PER_TOKEN = 4;

export interface TokenEstimatorOptions {
  readonly bytesPerToken?: number;
}

export interface TextEstimate {
  readonly bytes: number;
  readonly tokens: number;
}

export interface MessageEstimate extends TextEstimate {
  readonly index: number;
  readonly role: Role;
}

export interface TokenEstimate {
  readonly total: number;
  readonly messages: readonly MessageEstimate[];
  readonly budget: number | null;
  readonly remaining: number | null;
  readonly fits: boolean;
}

export class TokenEstimator {
  private readonly bytesPerToken: number;

  constructor(opts: TokenEstimatorOptions = {}) {
    const bytesPerToken = opts.bytesPerToken ?? DEFAULT_BYTES_PER_TOKEN;
    if (!Number.isFinite(bytesPerToken) || bytesPerToken <= 0) {
      throw new RangeError('bytesPerToken must be a positive finite number');
    }
    this.bytesPerToken = bytesPerToken;
  }

  estimateText(content: string): TextEstimate {
    const bytes = Buffer.byteLength(content, 'utf8');
    return { bytes, tokens: Math.ceil(bytes / this.bytesPerToken) };
  }

  estimate(messages: readonly ChatMessage[], budget?: number): TokenEstimate {
    if (budget !== undefined && (!Number.isInteger(budget) || budget < 0)) {
      throw new RangeError('budget must be a non-negative integer');
    }

    const breakdown = messages.map((message, index): MessageEstimate => ({
      index,
      role: message.role,
      ...this.estimateText(message.content),
    }));
    const total = breakdown.reduce((sum, message) => sum + message.tokens, 0);

    return {
      total,
      messages: breakdown,
      budget: budget ?? null,
      remaining: budget === undefined ? null : budget - total,
      fits: budget === undefined ? true : total <= budget,
    };
  }
}
