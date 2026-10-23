// Пустая edge-заглушка instrumentation (fix #77): в dev Next компилирует
// instrumentation.ts и для edge-компилятора, где его реальный граф
// (challenge → dotenv → node builtins) не собирается. Планировщик — node-only,
// на edge register() не нужен. Подключается через resolve.alias в
// next.config.ts только для nextRuntime === 'edge' — это webpack-механизм:
// работает в webpack-dev (дефолт 15.5) и webpack-build, turbopack alias
// игнорирует. node-рантайм использует настоящий instrumentation.ts,
// прод-сборка заглушку не задаействует.
export async function register(): Promise<void> {}
