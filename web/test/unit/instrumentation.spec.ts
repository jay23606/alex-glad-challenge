// Unit: web/instrumentation.ts — гейты register() (issue #76). NEXT_RUNTIME и
// AUTOMATION_ENABLED не пропускают старт; при включении — динамические импорты
// резолвятся, scheduler стартует, SIGTERM/SIGINT ведут к scheduler.stop();
// ошибка старта уходит в console.error без падения процесса.
// Динамические import() внутри instrumentation.ts резолвятся от web/, а vi.mock
// — от файла спеки (web/test/unit/), поэтому пути моков '../../lib/server/...'.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    schedulerImports: 0,
    serviceImports: 0,
    dbImports: 0,
    scheduleImports: 0,
  };
  return {
    state,
    AutomationScheduler: vi.fn(),
    getAutomation: vi.fn(),
    withDb: vi.fn((fn: () => unknown) => fn()),
    runDueSchedules: vi.fn(async (): Promise<void> => {}),
  };
});

vi.mock('server-only', () => ({}));

vi.mock('../../lib/server/automation-scheduler', () => {
  mocks.state.schedulerImports += 1;
  return { AutomationScheduler: mocks.AutomationScheduler };
});

vi.mock('../../lib/server/automation-service', () => {
  mocks.state.serviceImports += 1;
  return { getAutomation: mocks.getAutomation };
});

vi.mock('../../lib/server/db', () => {
  mocks.state.dbImports += 1;
  return { withDb: mocks.withDb };
});

vi.mock('../../lib/server/blog-schedule-service', () => {
  mocks.state.scheduleImports += 1;
  return { runDueSchedules: mocks.runDueSchedules };
});

import { register } from '../../instrumentation';

/** Обработчики сигналов до register(): afterEach снимает только добавленные. */
type SignalSnapshot = Record<'SIGTERM' | 'SIGINT', (() => void)[]>;

const GATED_KEYS = ['NEXT_RUNTIME', 'AUTOMATION_ENABLED'] as const;
type GatedKey = (typeof GATED_KEYS)[number];

let envBackup: Partial<Record<GatedKey, string | undefined>>;
let signalSnapshot: SignalSnapshot;
// Счётчики импортов на старте теста: mocked-фабрики кешируются между тестами
// одного файла, поэтому импорт проверяем по дельте, а не по абсолюту.
let importsBaseline: typeof mocks.state;

/** Мок-экземпляр планировщика: start/stop как vi.fn для проверок вызовов. */
interface SchedulerInstanceMock {
  start: Mock<() => void>;
  stop: Mock<() => Promise<void>>;
}

/** Мок-экземпляр планировщика + его установка как результата конструктора. */
function installScheduler(): SchedulerInstanceMock {
  const instance: SchedulerInstanceMock = {
    start: vi.fn(),
    stop: vi.fn(async (): Promise<void> => {}),
  };
  // function-декларация, не стрелка: register() зовёт мок через new,
  // vitest 5 требует function/class в реализации конструктора.
  mocks.AutomationScheduler.mockImplementation(function schedulerCtor() {
    return instance;
  });
  return instance;
}

beforeEach(() => {
  envBackup = {};
  for (const key of GATED_KEYS) {
    envBackup[key] = process.env[key];
    delete process.env[key];
  }
  signalSnapshot = {
    SIGTERM: process.listeners('SIGTERM') as (() => void)[],
    SIGINT: process.listeners('SIGINT') as (() => void)[],
  };
  mocks.AutomationScheduler.mockReset();
  mocks.getAutomation.mockReset();
  mocks.withDb.mockClear();
  mocks.runDueSchedules.mockReset();
  mocks.runDueSchedules.mockResolvedValue(undefined);
  importsBaseline = { ...mocks.state };
});

afterEach(() => {
  // Снимаем обработчики, добавленные register() (once('SIGTERM') снимается сам
  // после emit, SIGINT-обработчик убираем вручную по ссылке).
  for (const event of ['SIGTERM', 'SIGINT'] as const) {
    for (const handler of process.listeners(event) as (() => void)[]) {
      if (!signalSnapshot[event].includes(handler)) {
        process.removeListener(event, handler);
      }
    }
  }
  for (const key of GATED_KEYS) {
    const value = envBackup[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe('instrumentation register', () => {
  it("NEXT_RUNTIME !== 'nodejs' → модули не импортируются, старта и обработчиков нет", async () => {
    process.env.NEXT_RUNTIME = 'edge';
    process.env.AUTOMATION_ENABLED = '1'; // флаг включён — гейтит только рантайм

    await expect(register()).resolves.toBeUndefined();

    // Счётчики не сдвинулись → register() не выполнял ни одного import().
    expect(mocks.state).toEqual(importsBaseline);
    expect(mocks.AutomationScheduler).not.toHaveBeenCalled();
    expect(mocks.getAutomation).not.toHaveBeenCalled();
    expect(mocks.withDb).not.toHaveBeenCalled();
    expect(process.listenerCount('SIGTERM')).toBe(signalSnapshot.SIGTERM.length);
    expect(process.listenerCount('SIGINT')).toBe(signalSnapshot.SIGINT.length);
  });

  it("AUTOMATION_ENABLED !== '1' при nodejs → импортов и старта нет", async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.AUTOMATION_ENABLED = '0';

    await expect(register()).resolves.toBeUndefined();

    expect(mocks.state).toEqual(importsBaseline);
    expect(mocks.AutomationScheduler).not.toHaveBeenCalled();
    expect(process.listenerCount('SIGTERM')).toBe(signalSnapshot.SIGTERM.length);
    expect(process.listenerCount('SIGINT')).toBe(signalSnapshot.SIGINT.length);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    "nodejs + флаг '1' → импорты, start(), %s → stop(), once снят",
    async (signal) => {
      process.env.NEXT_RUNTIME = 'nodejs';
      process.env.AUTOMATION_ENABLED = '1';
      const instance = installScheduler();
      const runDue = vi.fn();
      mocks.getAutomation.mockReturnValue({ runDue });

      await register();

      // Импорты выполнились хотя бы раз за файл: mocked-фабрики кешируются
      // между тестами, поэтому точная дельта зависела бы от порядка тестов.
      expect(mocks.state.schedulerImports).toBeGreaterThan(0);
      expect(mocks.state.serviceImports).toBeGreaterThan(0);
      expect(mocks.state.dbImports).toBeGreaterThan(0);
      expect(mocks.state.scheduleImports).toBeGreaterThan(0);
      expect(mocks.AutomationScheduler).toHaveBeenCalledTimes(1);
      expect(instance.start).toHaveBeenCalledTimes(1);

      // Проводка тика: runDue из конструктора дергает getAutomation().runDue() через withDb.
      const ctorOpts = mocks.AutomationScheduler.mock.calls[0]?.[0] as
        | { runDue: () => Promise<unknown> }
        | undefined;
      expect(typeof ctorOpts?.runDue).toBe('function');
      await ctorOpts?.runDue();
      expect(mocks.withDb).toHaveBeenCalledTimes(1);
      expect(runDue).toHaveBeenCalledTimes(1);
      expect(mocks.runDueSchedules).toHaveBeenCalledTimes(1);

      // Обработчик зарегистрирован поверх существующих.
      expect(process.listenerCount(signal)).toBe(signalSnapshot[signal].length + 1);

      // Сигнал → scheduler.stop(); once() снимает обработчик после срабатывания.
      expect(process.emit(signal)).toBe(true);
      await vi.waitFor(() => expect(instance.stop).toHaveBeenCalledTimes(1));
      expect(process.listenerCount(signal)).toBe(signalSnapshot[signal].length);
    },
  );

  it('runDue: сбой automation не отменяет schedule, ошибки агрегируются', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.AUTOMATION_ENABLED = '1';
    installScheduler();
    mocks.getAutomation.mockReturnValue({
      runDue: vi.fn(() => {
        throw new Error('rss down');
      }),
    });
    mocks.runDueSchedules.mockRejectedValue(new Error('schedule down'));

    await register();

    const ctorOpts = mocks.AutomationScheduler.mock.calls[0]?.[0] as
      | { runDue: () => Promise<unknown> }
      | undefined;
    await expect(ctorOpts?.runDue()).rejects.toThrow(
      'automation: rss down; schedule: schedule down',
    );
    expect(mocks.runDueSchedules).toHaveBeenCalledTimes(1);
  });

  it('ошибка конструктора scheduler → console.error, register не бросает', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.AUTOMATION_ENABLED = '1';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.AutomationScheduler.mockImplementation(function failingSchedulerCtor(): never {
      throw new Error('boom from ctor');
    });

    await expect(register()).resolves.toBeUndefined(); // процесс не падает

    // Конструктор вызван — значит, динамические импорты разрешились,
    // упало уже на создании scheduler.
    expect(mocks.AutomationScheduler).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0]);
    expect(logged).toContain('[automation-scheduler] start failed');
    expect(logged).toContain('boom from ctor');
    expect(process.listenerCount('SIGTERM')).toBe(signalSnapshot.SIGTERM.length);
    expect(process.listenerCount('SIGINT')).toBe(signalSnapshot.SIGINT.length);
  });
});
