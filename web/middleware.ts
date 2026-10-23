// CSP с per-request nonce (fix web-prod-blank-csp). Next.js в production App Router
// вставляет inline-скрипты гидратации (bootstrap, RSC flight-payload, module-preloads).
// Статический `script-src 'self'` (бывший в next.config headers()) их блокировал →
// router-чанк выкидывал SSR-шелл, гидрировать нечем → чёрный пустой `body` на боeвом
// деплое. Nonce генерится per-request, Next.js автоматически навешивает его на свои
// inline-скрипты через `x-nonce` request-header (механизм фреймворка). 'strict-dynamic'
// разрешает внешние чанки, которые грузит bootstrap. Требует dynamic-rendering — все
// наши страницы force-dynamic, fresh nonce на каждый view.
//
// runtime = nodejs: standalone-стек на Node, Buffer доступен, нет риска edge-API-гэпов.
// Рантайм объявлен в `export const config` ниже — документированная форма
// node-middleware (Next 15.5 stable); парсер уважает и топ-левел
// `export const runtime`, обе формы равнозначны (get-page-static-info.js:
// config.runtime ?? config.config.runtime). Реальная причина инцидента #77 —
// не форма объявления, а dev-компиляция instrumentation.ts на edge
// (подробности и фикс — в next.config.ts, блок «fix #77»).
//
// Day 36 — admin-auth гейт ПОСЛЕ nonce-кода (nonce-логика не тронута: прошлый инцидент
// «пустой body»). Публичные пути — только точный allowlist PUBLIC_PATHS ниже, он
// единственный источник истины (не дублировать список в комментарии). Остальное:
// страницы → 302 /login?next=<pathname> (query выкидывается), /api/* → 401 JSON
// (клиентские страницы ждут JSON, не HTML-redirect). 401/302 строятся напрямую,
// без nonce — это не HTML, CSP им не нужен. Fail-closed: env не задан → сессий
// не бывает → всё кроме публичного уводит на /login.
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, isValidSession, isMobileAuthed } from './lib/auth';

// Публичные пути: точное совпадение pathname (префиксы не открываем). /jira, /demo и их
// API открыты одновременно — иначе гость получает 401/редирект вместо формы.
const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/harness',
  '/jira',
  '/demo',
  '/style',
  '/blog/pipeline',
  '/api/jira/generate',
  '/api/demo/rag',
  '/api/style/rewrite',
  '/api/blog/pipeline',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  // Metadata-роуты (sitemap/robots/opengraph-image) публичны:
  // их читают краулеры и TG/OG-клиенты без cookie-сессии. Set — точное совпадение
  // pathname (query не входит), поэтому '/opengraph-image' покрывает и '/opengraph-image?<query>'.
  '/robots.txt',
  '/sitemap.xml',
  '/opengraph-image',
]);

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // dev: React Refresh (@next/react-refresh-utils) использует eval() для HMR — без
  // 'unsafe-eval' клиентский бандл валится с EvalError, гидратации нет, UI мёртв.
  // prod: React Refresh вырезается сборкой — 'unsafe-eval' не нужен, CSP остаётся строгим.
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', csp);

  // --- Admin-auth гейт (day 36) ---
  const { pathname } = request.nextUrl;
  const cookieAuthed = isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
  // Мобильный клиент: Bearer MOBILE_API_TOKEN даёт доступ к /api/*, но не к страницам.
  const apiMobileAuthed = pathname.startsWith('/api') && isMobileAuthed(request);
  const authed = cookieAuthed || apiMobileAuthed;
  // Входящие webhooks (T7): POST /api/integrations/inbound/<id> — приём событий от
  // внешних сервисов БЕЗ сессии; авторизация — HMAC-подпись тела секретом хука из БД
  // (проверяется в route). Открываем только POST на конкретный id: управление хуками
  // (GET/POST /api/integrations/inbound, DELETE) остаётся за session-auth.
  const isInboundWebhookPost =
    request.method === 'POST' && /^\/api\/integrations\/inbound\/\d+$/.test(pathname);
  if (!PUBLIC_PATHS.has(pathname) && !authed && !isInboundWebhookPost) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    // За reverse-proxy (Caddy → 127.0.0.1:3000) request.url строится от внутреннего
    // origin (localhost:3000) — Host/X-Forwarded-Host на него не влияют (проверено
    // curl'ом напрямую). Публичный origin: WEB_PUBLIC_ORIGIN → X-Forwarded-Host →
    // Host → request.url как последний fallback.
    const fwdHost = request.headers.get('x-forwarded-host');
    const rawHost = fwdHost ?? request.headers.get('host');
    const proto =
      request.headers.get('x-forwarded-proto') ??
      (rawHost && (rawHost.startsWith('localhost:') || rawHost.startsWith('127.')) ? 'http' : 'https');
    const envOrigin = process.env.WEB_PUBLIC_ORIGIN?.trim();
    const base = envOrigin || (rawHost ? `${proto}://${rawHost}` : request.url);
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(pathname)}`, base),
      302,
    );
  }

  return response;
}

export const config = {
  // Документированная форма node-middleware (Next 15.5 stable); парсер
  // уважает и топ-левел `export const runtime` (см. комментарий в шапке).
  runtime: 'nodejs',
  matcher: [
    // Всё, кроме API, статики, картинок next/image, favicon. Prefetch-запросы пропускаем.
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
    // API — отдельным entry БЕЗ prefetch-исключения: крафтовый next-router-prefetch-хедер
    // не должен обходить auth для /api/*. Prefetch-утечка страниц невозможна: все роуты
    // динамические (layout await headers()), prefetch динамических страниц payload не отдаёт.
    { source: '/api/:path*' },
  ],
};
