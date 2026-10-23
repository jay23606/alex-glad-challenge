// Постоянный планировщик автоматизации блога (issue #53): раз в tickMs дёргает
// инжектируемый runDue() (в web — BlogAutomation.runDue через withDb). runDue
// сам фильтрует включённые правила с наступившим next_run_at, поэтому циклу
// достаточно интервала. Параллельные прогоны недопустимы: пока предыдущий
// вызов в полёте, новые тики пропускаются (реентрант-guard). Время и
// наблюдаемость инжектятся (botQueue-стиль, AGENTS §7.3): юнит-тесты гоняют
// цикл без реальных ожиданий и без сети.

import 'server-only';

export interface AutomationSchedulerOpts {
  /** Полезная работа тика; ошибки ловятся и уходят в onError. */
  runDue: () => Promise<unknown>;
  /** Период тика. Инвариант правил автоматизации — интервал ≥ 5 мин, дефолт 60 c. */
  tickMs?: number;
  /** Пауза; через неё stop() ждёт завершения in-flight-тика. */
  sleep?: (ms: number) => Promise<void>;
  /** Приёмник ошибок тика; дефолт — console.error без секретов. */
  onError?: (message: string) => void;
}

const DEFAULT_TICK_MS = 60_000;

export class AutomationScheduler {
  private readonly runDue: () => Promise<unknown>;
  private readonly tickMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly onError: (message: string) => void;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(opts: AutomationSchedulerOpts) {
    this.runDue = opts.runDue;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.sleepFn = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onError =
      opts.onError ??
      ((message) => console.error(`[automation-scheduler] runDue failed: ${message}`));
  }

  /** Включает цикл и логирует одну строку старта. Повторный вызов — no-op. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.onTick(), this.tickMs);
    console.error(`[automation-scheduler] started (tickMs=${this.tickMs})`);
  }

  /** Снимает таймер и дожидается завершения in-flight-тика (если он был). */
  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.inFlight !== null) {
      await this.sleepFn(1);
    }
  }

  private onTick(): void {
    if (this.inFlight !== null) return; // предыдущий runDue ещё не завершился — тик пропущен
    this.inFlight = (async () => {
      try {
        await this.runDue();
      } catch (e: unknown) {
        this.onError(e instanceof Error ? e.message : String(e));
      } finally {
        this.inFlight = null;
      }
    })();
  }
}
