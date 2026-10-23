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
  output: 'standalone',
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
  webpack(config) {
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
    return config;
  },
};

export default nextConfig;
