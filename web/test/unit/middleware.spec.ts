// Unit: middleware (web/middleware.ts) — CSP-nonce + admin-auth гейт (day 36).
// Фокус #64: bypass POST /api/integrations/inbound/<id> (T7 — приём внешних
// webhooks БЕЗ сессии) открывает только POST на конкретный числовой id;
// управление хуками (GET/POST без id, DELETE) и прочие /api/* остаются за
// session-auth. middleware() вызывается напрямую с NextRequest (по образцу
// route-спеков); auth-математика реальная (HMAC на тестовых env), моков нет.
import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import type { MiddlewareConfig, NextResponse } from 'next/server';

process.env.WEB_AUTH_SECRET = 'test-secret-for-vitest';
process.env.WEB_ADMIN_PASSWORD = 'test-password';

let middleware: (request: NextRequest) => NextResponse;
let config: MiddlewareConfig;
let createSessionValue: () => string;

beforeAll(async () => {
  // Динамический импорт осознанный: lib/auth читает env на загрузке модуля
  // (loadEnvUpward) — env-строки выше обязаны выполниться раньше импорта.
  ({ middleware, config } = await import('../../middleware'));
  ({ createSessionValue } = await import('../../lib/auth'));
});

function req(path: string, init?: { method?: string; cookie?: string }): NextRequest {
  const headers = new Headers({ host: 'localhost:3000' });
  if (init?.cookie) headers.set('cookie', init.cookie);
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method ?? 'GET',
    headers,
  });
}

describe('middleware: bypass входящих webhooks (T7)', () => {
  it('POST /api/integrations/inbound/7 без сессии — пропускается: next() (200 + CSP, не 401/redirect)', () => {
    const res = middleware(req('/api/integrations/inbound/7', { method: 'POST' }));
    expect(res.status).toBe(200);
    // next()-ответ несёт per-request CSP-nonce — отличает пропуск от 401/redirect.
    expect(res.headers.get('content-security-policy')).toContain('script-src');
    expect(res.headers.get('location')).toBeNull();
  });

  it('GET того же пути без сессии — 401 JSON (bypass только POST)', async () => {
    const res = middleware(req('/api/integrations/inbound/7'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('POST /api/integrations/inbound (без id) — управление хуками защищено: 401', async () => {
    const res = middleware(req('/api/integrations/inbound', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('DELETE /api/integrations/inbound/7 — 401 (метод не входит в bypass)', async () => {
    const res = middleware(req('/api/integrations/inbound/7', { method: 'DELETE' }));
    expect(res.status).toBe(401);
  });

  // #92: bypass-regex требует ровно POST — HEAD/OPTIONS на тот же путь падают в
  // обычный auth-гейт: 401 JSON (fail-closed по методу), а не 405/пропуск.
  it('HEAD /api/integrations/inbound/7 без сессии — 401 JSON (fail-closed по методу)', async () => {
    const res = middleware(req('/api/integrations/inbound/7', { method: 'HEAD' }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('OPTIONS /api/integrations/inbound/7 без сессии — 401 JSON (fail-closed по методу)', async () => {
    const res = middleware(req('/api/integrations/inbound/7', { method: 'OPTIONS' }));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('POST /api/integrations/inbound/abc и .../7/extra — 401 (regex требует ровно числовой id)', async () => {
    expect(middleware(req('/api/integrations/inbound/abc', { method: 'POST' })).status).toBe(401);
    expect(middleware(req('/api/integrations/inbound/7/extra', { method: 'POST' })).status).toBe(401);
  });
});

describe('middleware: auth-гейт (контраст к bypass)', () => {
  it('обычный /api/* без сессии — 401 JSON + no-store', async () => {
    const res = middleware(req('/api/notifications'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('валидная сессия-cookie — /api/* пропускается: next() (200 + CSP)', () => {
    const res = middleware(req('/api/notifications', { cookie: `admin_session=${createSessionValue()}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain('script-src');
  });

  it('страница /dashboard без сессии — 302 на /login?next=<pathname> (query выкидывается)', () => {
    expect(middleware(req('/dashboard')).status).toBe(302);
    expect(middleware(req('/dashboard?tab=alerts')).headers.get('location')).toBe(
      'http://localhost:3000/login?next=%2Fdashboard',
    );
  });
});

// --- config.matcher: регистрация путей ---

// middleware() выше проверяет поведение, но не то, на КАКИХ путях Next его вообще
// запускает: за это отвечает config.matcher[].source. Дрейф matcher (например,
// удалили favicon.ico из lookahead или /api/:path* → /api) уводит пути мимо
// auth-гейта/CSP, не трогая сам middleware(). Здесь матчим pathname тем же
// способом, что и Next: source компилируется path-to-regexp (getMiddlewareMatchers
// → tryToParsePath → next/dist/compiled/path-to-regexp), матч —
// new RegExp(regexpStr).exec(pathname) без query, анкерный, регистрозависимый
// (shared/lib/router/utils/middleware-route-matcher.js). Условия has/missing
// (prefetch-хедеры) проверяются рантаймом Next поверх регекспы — вне юнит-скоупа.
// Мини-компилятор без новых зависимостей покрывает ровно синтаксис matcher'а:
// литеральные сегменты, «(…)» как сырой regex, «:path*» → повторяемый сегмент.
function compileSource(source: string): RegExp {
  const segment = '[^\\/#\\?]+?'; // паттерн сегмента path-to-regexp: без /, #, ?
  let re = '^';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(') {
      // Сырой regex-фрагмент (negative lookahead) — в non-capturing группу как есть.
      let depth = 0;
      let j = i;
      for (; j < source.length; j += 1) {
        if (source[j] === '(') depth += 1;
        else if (source[j] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      re += `(?:${source.slice(i + 1, j)})`;
      i = j + 1;
    } else if (ch === ':' && /^\w+/.test(source.slice(i + 1))) {
      // Именованный параметр; ведущий '/' из source — его префикс в path-to-regexp:
      // съедаем его, чтобы он не остался литералом перед группой (иначе двойной слэш).
      if (re.endsWith('/')) re = re.slice(0, -1);
      const name = /^\w+/.exec(source.slice(i + 1))![0];
      let end = i + 1 + name.length;
      const modifier = source[end] === '*' || source[end] === '+' ? source[end] : '';
      if (modifier) end += 1;
      if (modifier === '*') {
        re += `(?:/${segment}(?:/${segment})*)?`;
      } else if (modifier === '+') {
        re += `(?:/${segment}(?:/${segment})*)`;
      } else {
        re += `/${segment}`;
      }
      i = end;
    } else {
      re += /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
      i += 1;
    }
  }
  // path-to-regexp анкорит результат (^…$) и добавляет опциональный трейлинг-делимитер.
  return new RegExp(`${re}[\\/#\\?]?$`);
}

function matchesMiddleware(pathname: string): boolean {
  const matcher = config.matcher;
  const entries = typeof matcher === 'string' ? [matcher] : (matcher ?? []);
  return entries.some((entry) =>
    compileSource(typeof entry === 'string' ? entry : entry.source).test(pathname),
  );
}

describe('middleware: config.matcher — source-паттерны матчат регистрацию путей', () => {
  it('страницы матчятся: /dashboard, /login, / (иначе нет auth-гейта и CSP-nonce)', () => {
    expect(matchesMiddleware('/dashboard')).toBe(true);
    expect(matchesMiddleware('/login')).toBe(true);
    expect(matchesMiddleware('/')).toBe(true);
    // Матч — по pathname без query: Next прогоняет matcher на nextUrl.pathname.
    expect(matchesMiddleware(new URL('http://localhost:3000/dashboard?tab=alerts').pathname)).toBe(
      true,
    );
  });

  it('/api/* матчится вторым source (/api/:path*), включая вложенные сегменты', () => {
    expect(matchesMiddleware('/api/notifications')).toBe(true);
    expect(matchesMiddleware('/api/integrations/inbound/7')).toBe(true);
  });

  it('статика и favicon НЕ матчятся (исключения lookahead), иначе 302 на /login у чанков', () => {
    expect(matchesMiddleware('/_next/static/chunk.js')).toBe(false);
    expect(matchesMiddleware('/_next/image')).toBe(false);
    expect(matchesMiddleware('/favicon.ico')).toBe(false);
  });
});

// --- config.matcher: prefetch-условия (missing) и runtime (#102) ---

// #102: удаление missing из matcher[0] раньше проходило suite — поведение
// middleware() от missing не зависит, его оценивает сам Next. В Next 15 условия
// has/missing НЕ компилируются в regexp на билде: рантайм проверяет их per-request
// (middleware-route-matcher.js → matchHas из prepare-destination.js, там
// «!missing.some(hasMatch)» — entry пропускается, если ЛЮБОЕ missing-условие
// совпало с хедерами запроса). Поэтому юнит-пин структуры config здесь достаточен:
// воспроизводить оценку условий значило бы пере-имплементить матчер фреймворка.
describe('middleware: config.matcher — prefetch-условия (missing) запинены', () => {
  it('matcher[0] (страницы) имеет missing с обоими prefetch-хедерами', () => {
    const entries = Array.isArray(config.matcher) ? config.matcher : [];
    // Ровно два entry: страницы с missing + API без — индексы ниже привязаны к этому.
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      // Оба условия из middleware.ts: любой prefetch-хедер пропускает страницы
      // мимо middleware (next-router-prefetch — любое значение, purpose — ровно prefetch).
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    });
  });

  it('matcher[1] (/api/*) без missing — крафтовый prefetch-хедер не обходит auth для API', () => {
    const entries = Array.isArray(config.matcher) ? config.matcher : [];
    // toEqual пинит и отсутствие missing: массив условий в expected уронил бы тест.
    expect(entries[1]).toEqual({ source: '/api/:path*' });
  });

  it('config.runtime = nodejs (node-middleware, standalone-стек на Node)', () => {
    // MiddlewareConfigInput в типах next не декларирует runtime, но парсер его
    // читает (get-page-static-info.js: config.runtime ?? config.config.runtime).
    // Narrow через in: свойство может отсутствовать, если форму объявления сменят.
    if (!('runtime' in config)) {
      throw new Error('config.runtime отсутствует — сменилась форма объявления runtime');
    }
    expect(config.runtime).toBe('nodejs');
  });
});
