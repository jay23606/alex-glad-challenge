// Unit: общий in-memory rate-limit входа (lib/server/loginRateLimit.ts).
// Fixed-window: порог, истечение окна, новое окно после истечения, reset().
// Время — fake timers; состояние сбрасывается между тестами.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMIT,
  RATE_WINDOW_MS,
  isRateLimited,
  registerFailure,
  reset,
} from '../../lib/server/loginRateLimit';

beforeEach(() => {
  reset();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  reset();
});

describe('loginRateLimit', () => {
  it('порог наступает после RATE_LIMIT неудач и держится до конца окна', () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-10-25T00:00:00Z').getTime();
    vi.setSystemTime(t0);

    for (let i = 0; i < RATE_LIMIT - 1; i += 1) {
      registerFailure();
      expect(isRateLimited()).toBe(false);
    }
    registerFailure();
    expect(isRateLimited()).toBe(true);

    vi.setSystemTime(t0 + RATE_WINDOW_MS - 1);
    expect(isRateLimited()).toBe(true);

    vi.setSystemTime(t0 + RATE_WINDOW_MS + 1);
    expect(isRateLimited()).toBe(false);
  });

  it('reset() снимает блокировку', () => {
    for (let i = 0; i < RATE_LIMIT; i += 1) registerFailure();
    expect(isRateLimited()).toBe(true);
    reset();
    expect(isRateLimited()).toBe(false);
  });

  it('после истечения окна неудача открывает новое окно', () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-10-25T00:00:00Z').getTime();
    vi.setSystemTime(t0);
    for (let i = 0; i < RATE_LIMIT; i += 1) registerFailure();
    expect(isRateLimited()).toBe(true);

    vi.setSystemTime(t0 + RATE_WINDOW_MS + 1);
    registerFailure();
    expect(isRateLimited()).toBe(false);

    for (let i = 1; i < RATE_LIMIT; i += 1) registerFailure();
    expect(isRateLimited()).toBe(true);
  });
});
