// Unit: automation-service — ленивый LLM-клиент (итерация 2 #78).
// Контракт: getAutomation() строится в keyless-окружении (GET /api/automation,
// /api/assistant, /api/mobile/bootstrap не должны падать 500); pickLlmClient
// резолвится только в runBlog. Границы замоканы: llm (keyless-стаб) и db.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BlogAutomation } from '../../lib/server/challenge';

// CHALLENGE_DATA_DIR до первого импорта core/paths: DATA_DIR замораживается на
// загрузке модуля, automation-service импортируется динамически в beforeAll.
const dataDir = mkdtempSync(path.join(tmpdir(), 'automation-svc-'));
process.env.CHALLENGE_DATA_DIR = dataDir;

const mocks = vi.hoisted(() => ({ pickLlmClient: vi.fn() }));

vi.mock('../../lib/server/llm', () => ({ pickLlmClient: mocks.pickLlmClient }));

vi.mock('../../lib/server/db', () => ({
  getBlogDb: vi.fn(() => ({ getBlog: () => null, listBlogs: () => [] })),
}));

// Динамический импорт обязателен: static import вычислил бы core/paths до
// присваивания CHALLENGE_DATA_DIR выше (импорты поднимаются) — DATA_DIR
// заморозился бы на реальном challenge/.data.
let getAutomation: () => BlogAutomation;

beforeAll(async () => {
  ({ getAutomation } = await import('../../lib/server/automation-service'));
});

afterAll(() => {
  // WAL-дескрипторы могут пережить close() — EPERM/EBUSY не проваливают тест
  // (паттерн core-тестов); временный каталог в os.tmpdir().
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* каталог останется во временной директории ОС */
  }
});

describe('automation-service: ленивый LLM-клиент', () => {
  it('getAutomation() строится без ключей; pickLlmClient не вызывается', () => {
    const automation = getAutomation();
    expect(automation).toBeDefined();
    // Живой BlogAutomation над temp-базой: правил нет → getRule вернёт null.
    expect(automation.getRule(1)).toBeNull();
    expect(mocks.pickLlmClient).not.toHaveBeenCalled();
  });

  it('singleton: повторный вызов возвращает тот же инстанс (без второй БД)', () => {
    expect(getAutomation()).toBe(getAutomation());
  });
});
