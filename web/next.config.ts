// Конфиг Next.js для web/ (день 28). Локальная dev-компиляция, 127.0.0.1.
//
// transpilePackages + path-алиас @challenge/*: challenge/src тайпскрипт-исходники
// компилируются SWC как часть графа web. .js-импорты внутри challenge/ резолвятся
// в .ts через extensionAlias (см. webpack-override ниже — Next применяет это для
// своих файлов, но путь-алиас ведёт вне web/, поэтому задаём явно).
// serverExternalPackages — тяжёлые/нативные npm-зависимости challenge не идут в
// server-bundle, require'ятся из node_modules при необходимости (P1+).
import path from 'node:path';
import type { NextConfig } from 'next';

// CSP задаётся per-request через middleware.ts (nonce для inline-скриптов гидратации).
// Статический CSP здесь убран: без nonce он блокировал bootstrap Next.js → пустой body.

// Standalone-артефакт нужен только prod-деплою на Linux (docs/HERMES-DEPLOY-RUNBOOK.md).
// На win32 next build падает на 'Collecting build traces': EPERM при создании
// symlink react → .next/standalone/node_modules/react (issue #51; без Developer Mode
// создание symlink запрещено). Compile/manifests/prerender к этому моменту
// успешны, а обычный build достаточен для next start/дев-смоков. Форсировать
// standalone: NEXT_STANDALONE=1 pnpm --filter web build — флаг лишь включает
// standalone-вывод и НЕ чинит права: на стоковой Windows сборка упадёт той же
// EPERM (нужен Developer Mode/админ; иначе собирать на Linux/CI).
// postbuild в web/package.json скоординирован: копия static выполняется только
// когда .next/standalone существует.
const isStandaloneEnabled =
  process.platform !== 'win32' || process.env.NEXT_STANDALONE === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Короткий URL /todos → реальный маршрут /mcp/todos (issue #36): наивный путь
  // из названия карточки не должен давать 404.
  async rewrites() {
    return [{ source: '/todos', destination: '/mcp/todos' }];
  },
  // Отключаем origin-compression (gzip/brotli): default compress:true в prod
  // (next start/standalone) буферизует SSE-ответы (/api/joke/session, /api/chat/*) —
  // токены идут батчами вместо token-by-token. Дополняет SSE-Headers 'X-Accel-Buffering':'no'
  // на уровне reverse-proxy.
  compress: false,
  // Production-build в standalone-режиме (scoped override день 30): артефакт в
  // web/.next/standalone/ — внутри web/.next/, уже в .gitignore. serverExternalPackages
  // + outputFileTracingRoot корректно трейсят нативные/тяжёлые зависимости challenge.
  // Включён только вне win32 (или при NEXT_STANDALONE=1) — см. комментарий выше.
  output: isStandaloneEnabled ? 'standalone' : undefined,
  transpilePackages: ['challenge'],
  // repo root для file-tracing (вышестоящий E:\IT\package-lock.json сбивает авто-детект).
  outputFileTracingRoot: path.resolve(__dirname, '..'),
  serverExternalPackages: [
    'telegram',
    'undici',
    'socks',
    'https-proxy-agent',
    'websocket',
    'fast-xml-parser',
    'qrcode',
  ],
  webpack(config, { nextRuntime }) {
    config.resolve = config.resolve || {};
    // challenge/ — ESM-TS с .js-спецификаторами импорта (verbatimModuleSyntax).
    // Без этого webpack ищет буквальный 'sanitize.js' и не находит 'sanitize.ts'.
    // Применяем глобально (касаются и server, и client-сборки) — 安全но: .js→.ts только
    // когда .js-файла нет рядом.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias as Record<string, string[]> | undefined),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    // seed-stub удалён (follow-up P4a): core/agents/seed.ts переведён на
    // path.dirname(fileURLToPath(import.meta.url)) — webpack резолвит это штатно,
    // import.meta.dirname на top-level больше не используется. Оригинальный seed.ts
    // грузится напрямую и в CLI (tsx), и в web.
    // fix #77: instrumentation.ts в dev лениво добавляется в ОБА компилятора
    // (build/entries.js runDependingOnPageType для ROOT-instrumentation всегда
    // зовёт onServer()+onEdgeServer(); встроенная оптимизация «удалить
    // edge-instrumentation, если это единственный edge-entry» живёт только в
    // createEntrypoints, которому dev-реплоадер rootPaths не передаёт, а
    // on-demand entries в dev идут мимо config.entry через webpack addInclude).
    // Edge-бандл instrumentation статически резолвит динамические import()
    // → challenge-граф тянет dotenv→require('path')/node:sqlite → ошибка
    // компиляции edge-компилятора → 500 на каждом запросе. Edge-компонентов в
    // приложении нет (middleware — nodejs), планировщик — node-only: в
    // edge-сборке подменяем instrumentation на пустую заглушку. Прод-сборку это
    // не затрагивает: там createEntrypoints сам не создаёт edge-entry.
    if (nextRuntime === 'edge') {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias as Record<string, string>),
        [path.resolve(__dirname, 'instrumentation.ts')]: path.resolve(
          __dirname,
          'edge-register-stub.ts',
        ),
      };
    }
    return config;
  },
};

export default nextConfig;
