// Постоянный планировщик BlogAutomation.runDue() в web-процессе (issue #53).
// Next 15 вызывает register() один раз на старт сервера. Планировщик включается
// только в nodejs-рантайме и только при AUTOMATION_ENABLED=1: нефичерный флаг
// читается здесь, на границе, дальше строкой не протекает (секреты — только
// через lib/server/env.ts, здесь их нет). Импорты динамические, чтобы edge-
// сборка не тянула server-only модули. Ошибка старта логируется без секретов,
// процесс не роняется.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.AUTOMATION_ENABLED !== '1') return;

  try {
    const [{ AutomationScheduler }, { getAutomation }, { withDb }] = await Promise.all([
      import('./lib/server/automation-scheduler'),
      import('./lib/server/automation-service'),
      import('./lib/server/db'),
    ]);
    const scheduler = new AutomationScheduler({
      runDue: () => withDb(() => getAutomation().runDue()),
    });
    const stop = (): Promise<void> => scheduler.stop();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    scheduler.start();
  } catch (e: unknown) {
    console.error(
      `[automation-scheduler] start failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
