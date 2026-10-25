// Общий rate-limit входа (админ /api/auth/login + мобильный /api/mobile/login):
// глобальный in-memory fixed-window, 10 неудач / 15 мин → 429 до конца окна.
// Глобальный (не per-IP) сознательно: за прокси XFF подделываем; доступ
// владельца loopback. Сбрасывается рестартом — допущение single-admin,
// зафиксировано в плане day-36.
import 'server-only';

export const RATE_LIMIT = 10; // неудачных попыток до блокировки
export const RATE_WINDOW_MS = 15 * 60 * 1000; // окно 15 минут
export const RETRY_AFTER_S = RATE_WINDOW_MS / 1000; // Retry-After у 429

// Модульное состояние окна (globalThis — переживает HMR dev-сервера).
const g = globalThis as unknown as { __loginFails?: { fails: number; resetAt: number } };
const state = (g.__loginFails ??= { fails: 0, resetAt: 0 });

export function isRateLimited(): boolean {
  return state.fails >= RATE_LIMIT && Date.now() < state.resetAt;
}

export function registerFailure(): void {
  const now = Date.now();
  if (now >= state.resetAt) {
    state.fails = 0;
    state.resetAt = now + RATE_WINDOW_MS;
  }
  state.fails += 1;
}

/** Успешный вход и тесты: полный сброс окна. */
export function reset(): void {
  state.fails = 0;
  state.resetAt = 0;
}
