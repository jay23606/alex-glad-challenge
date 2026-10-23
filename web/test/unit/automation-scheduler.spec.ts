// Unit: AutomationScheduler (web/lib/server/automation-scheduler.ts) —
// interval-цикл, реентрант-guard, ожидание in-flight в stop(). Время — реальные
// таймеры с tickMs=1 (надёжнее fake timers: не нужно вручную проматывать
// макротаски вокруг async runDue); синхронизация — deferred-промисы.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomationScheduler } from '../../lib/server/automation-scheduler';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Реальная пауза: даёт интервалу 1 мс время на тики. */
const pause = (ms = 25): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AutomationScheduler', () => {
  it('тик вызывает runDue; старт логирует одну строку', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const scheduler = new AutomationScheduler({
      runDue: async () => {
        calls += 1;
      },
      tickMs: 1,
    });
    scheduler.start();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0]?.[0])).toBe('[automation-scheduler] started (tickMs=1)');
    await scheduler.stop();
  });

  it('перекрытие: второй тик во время in-flight НЕ вызывает runDue повторно', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const gate1 = deferred();
    const gate2 = deferred();
    let calls = 0;
    const scheduler = new AutomationScheduler({
      runDue: async () => {
        calls += 1;
        await (calls === 1 ? gate1.promise : gate2.promise); // второй вызов висит — счётчик точен
      },
      tickMs: 1,
    });
    scheduler.start();
    await vi.waitFor(() => expect(calls).toBe(1));
    await pause(); // несколько тиков уходят — guard держит
    expect(calls).toBe(1);
    gate1.resolve();
    await vi.waitFor(() => expect(calls).toBe(2)); // guard отпустил — следующий тик прошёл
    gate2.resolve(); // завершаем второй вызов, чтобы stop() не ждал вечно
    await scheduler.stop();
    const afterStop = calls;
    await pause();
    expect(calls).toBe(afterStop); // после stop новых тиков нет
  });

  it('stop() ждёт in-flight', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const gate = deferred();
    let entered = false;
    let finished = false;
    const scheduler = new AutomationScheduler({
      runDue: async () => {
        entered = true;
        await gate.promise;
        finished = true;
      },
      tickMs: 1,
    });
    scheduler.start();
    await vi.waitFor(() => expect(entered).toBe(true));
    const stopped = scheduler.stop();
    let stopSettled = false;
    void stopped.then(() => {
      stopSettled = true;
    });
    await pause();
    expect(stopSettled).toBe(false); // runDue в полёте — stop не завершился
    expect(finished).toBe(false);
    gate.resolve();
    await stopped;
    expect(stopSettled).toBe(true);
    expect(finished).toBe(true);
  });

  it('без start() вызовов нет', async () => {
    let calls = 0;
    const scheduler = new AutomationScheduler({
      runDue: async () => {
        calls += 1;
      },
      tickMs: 1,
    });
    await expect(scheduler.stop()).resolves.toBeUndefined(); // stop до start безопасен
    await pause();
    expect(calls).toBe(0);
  });

  it('stop() снимает таймер: после stop новые тики не приходят', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const scheduler = new AutomationScheduler({
      runDue: async () => {
        calls += 1;
      },
      tickMs: 1,
    });
    scheduler.start();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    await scheduler.stop();
    const afterStop = calls;
    await pause();
    expect(calls).toBe(afterStop);
  });

  it('ошибка runDue уходит в onError, цикл продолжается', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const gate = deferred();
    const firstError = deferred<string>();
    const errors: string[] = [];
    let threw = false;
    const scheduler = new AutomationScheduler({
      runDue: async () => {
        if (threw) {
          await gate.promise; // последующие тики висят — guard не пускает новых
          return;
        }
        threw = true;
        throw new Error('run failed');
      },
      tickMs: 1,
      onError: (message) => {
        errors.push(message);
        firstError.resolve(message);
      },
    });
    scheduler.start();
    await expect(firstError.promise).resolves.toBe('run failed');
    gate.resolve();
    await scheduler.stop();
    expect(errors).toEqual(['run failed']);
  });
});
