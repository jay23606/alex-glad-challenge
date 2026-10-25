// Постоянный планировщик фоновых постов в web-процессе (issue #53, #131).
// Один тик обслуживает два независимых источника: интервальную
// BlogAutomation.runDue() (RSS-новости) и календарные слоты расписания
// (Сб/Вс, BlogScheduleRunner.runDue). Next 15 вызывает register() один раз на
// старт сервера. Планировщик включается только в nodejs-рантайме и только при
// AUTOMATION_ENABLED=1: нефичерный флаг читается здесь, на границе, дальше
// строкой не протекает (секреты — только через lib/server/env.ts). Импорты
// динамические, чтобы edge-сборка не тянула server-only модули. Ошибка старта
// логируется без секретов, процесс не роняется.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.AUTOMATION_ENABLED !== '1') return;

  try {
    const [{ AutomationScheduler }, { getAutomation }, { withDb }, { runDueSchedules }] =
      await Promise.all([
        import('./lib/server/automation-scheduler'),
        import('./lib/server/automation-service'),
        import('./lib/server/db'),
        import('./lib/server/blog-schedule-service'),
      ]);
    const scheduler = new AutomationScheduler({
      // Источники независимы: сбой одного не должен отменять второй. Ошибки
      // объединяем и отдаём планировщику (он логирует через onError).
      runDue: async () => {
        const errors: string[] = [];
        try {
          await withDb(() => getAutomation().runDue());
        } catch (e: unknown) {
          errors.push(`automation: ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
          await runDueSchedules();
        } catch (e: unknown) {
          errors.push(`schedule: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (errors.length > 0) throw new Error(errors.join('; '));
      },
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
