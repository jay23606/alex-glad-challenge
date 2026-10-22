# AGENTS.md — правила проекта (v2, ADVANCED Day 1)

Единый контракт для ИИ-ассистентов, работающих с репозиторием
`alex-glad-challenge`. Прочитайте до любых изменений. Файл описывает **текущую
реальность репозитория**, а не историю первых десяти дней.

## 0. Как читать правила

- **Глобальный конфиг:** `~/.omp/agent/AGENTS.md` — общие правила для всех
  проектов. Он **не отменяет** этот файл; при конфликте побеждает проектный.
- **Локальный конфиг:** этот `AGENTS.md` — канонический источник правил проекта.
  `.omp/AGENTS.md` намеренно **не создаётся**: native-провайдер `omp` отдал бы
  ему приоритет и затенил этот файл.
- **Sticky-правила:** `.omp/RULES.md` — короткие жёсткие инварианты, которые
  должны оставаться в контексте даже в длинной сессии.
- **Субагенты:** `.omp/agents/*.md` — `project-implementer` и `project-reviewer`.
- **Скиллы:** `.omp/skills/*/SKILL.md` — `add-core-service`, `add-web-endpoint`,
  `project-validation`.
- `CLAUDE.md` — исторический документ для другого инструмента. При расхождении
  с этим файлом прав `AGENTS.md`; не дублируйте правила в `CLAUDE.md`.

## 1. Что это за проект

Репозиторий — монорепозиторий из двух пакетов:

1. **`challenge/`** — основной TypeScript-монолит: CLI, интерактивный REPL,
   LLM-клиент, агенты, RAG, Telegram-бот, блог-pipeline, SQLite-хранилища,
   MCP-серверы и исторические демо дней 1–30.
2. **`web/`** — локальный Next.js 15 (App Router) + React 19: админка,
   дашборд, чат, RAG, блог, Telegram-инструменты. Пакет появился позже и
   является **scoped override**: он имеет собственный production-build, но
   доменная логика остаётся в `challenge/`.

Исторические демо `challenge/src/demos/day-01..30` **заморожены**. Новые
задачи (ADVANCED-челлендж и продуктовые фичи) делаются как фичи: core-сервис,
CLI-команда, web-endpoint/страница, тесты. **Не создавайте новый `day-NN.ts` без
явного требования.**

## 2. Стек и рантайм

| Слой | Технологии |
|---|---|
| Runtime | Node.js 24+ |
| Язык | TypeScript 5.6+, `strict`, ESM |
| Пакеты | pnpm 10, workspace `challenge` + `web` |
| Запуск CLI | `tsx` напрямую, без шага сборки |
| HTTP | нативный `fetch`, `undici`; Next.js Route Handlers |
| БД | `node:sqlite` (`DatabaseSync`), WAL, файлы в `challenge/.data/` |
| Web | Next.js 15 App Router, React 19, Tailwind 3, `server-only` |
| Валидация | `zod` на границах (`web/lib/shared/forms.ts`) |
| Тесты | `node:test` в `challenge/`, Vitest в `web/`, Playwright для e2e |
| Секреты | `dotenv` → `challenge/src/core/env.ts` / `web/lib/server/env.ts` |

**Новые зависимости** — только с явным обоснованием и одобрением. Не добавляйте
вложенные `package.json`, альтернативные SQLite-драйверы, второй HTTP-клиент,
второй LLM-клиент или вторую библиотеку валидации.

## 3. Структура репозитория

```text
alex-glad-challenge/
  AGENTS.md                  # этот файл — правила проекта
  .omp/
    RULES.md                 # sticky hard rules
    agents/                  # project-implementer, project-reviewer
    skills/                  # add-core-service, add-web-endpoint, project-validation
  challenge/
    src/
      cli.ts                 # точка входа CLI, диспетчер команд
      repl.ts                # интерактивный чат
      core/                  # общая библиотека (без web-зависимостей)
        client.ts            # LlmClient (OpenAI-compat)
        types.ts             # ChatMessage, Role, Usage, msg
        strategy.ts          # FullHistory / SlidingWindow / StickyFacts / Branching
        db.ts                # BlogDb
        dialogDb.ts          # DialogDb
        todoDb.ts            # TodoDb
        env.ts               # единственное чтение process.env
        paths.ts             # dataPath() / DATA_DIR
        agents/              # блог-агенты и pipeline
        rag/                 # RAG, embeddings, retriever, eval
        tg/                  # Telegram-бот, FTS, игры
        mcp*.ts              # MCP-клиенты/серверы
      demos/                 # day-01..30, заморожены
      data/                  # статические данные/demo-данные
    .data/                   # runtime SQLite/сессии, в git не попадает
  web/
    app/api/**/route.ts      # Route Handlers
    app/**/page.tsx          # Server/Client страницы
    app/components/          # UI-компоненты
    lib/server/              # server-only адаптеры и chokepoint'ы
    lib/shared/              # zod-схемы и типы, безопасные для клиента
    test/unit/               # Vitest: route/утилиты
    test/ui/                 # Vitest + Testing Library
    e2e/                     # Playwright
  docs/                      # коммитируемые документы и отчёты
  prompts/                   # промпты
  swarm-report/              # рабочие отчёты, в .gitignore
```

## 4. Naming conventions

| Что | Конвенция | Пример |
|---|---|---|
| Файлы core | `camelCase.ts` | `tokenEstimator.ts`, `botQueue.ts` |
| Файлы демо | `day-NN.ts` | `day-30.ts` |
| Тесты challenge | `<module>.test.ts` | `tokenEstimator.test.ts` |
| Тесты web | `<route>-route.spec.ts`, `<component>.spec.tsx` | `style-rewrite-route.spec.ts` |
| Route Handler | `route.ts` | `app/api/tokens/estimate/route.ts` |
| Страница | `page.tsx`, `layout.tsx` | `app/dashboard/page.tsx` |
| Классы/типы | `PascalCase` | `TokenEstimator`, `ChatMessage` |
| Функции/переменные | `camelCase` | `estimateMessages`, `blogId` |
| Константы | `UPPER_SNAKE_CASE` | `DEFAULT_GAP_MS`, `MAX_CHUNK` |
| Boolean | `is/has/can/should` | `isConfigured`, `hasBudget` |
| DB-таблицы/колонки | `snake_case` | `style_samples`, `blog_id` |
| JSON API | `camelCase` | `remaining`, `fits`, `messageId` |
| Env | `UPPER_SNAKE_CASE` | `DEEPSEEK_API_KEY`, `LOCAL_LLM_MODEL` |

Правила: без `I`-префикса у интерфейсов, без `Enum`-суффикса, без транслита.
Допустимые сокращения — только доменные: `db`, `llm`, `tg`, `rag`, `mcp`, `api`.

## 5. Архитектурные границы

### 5.1. Направление зависимостей

```text
CLI / REPL ──► challenge/src/core ──► LlmClient / DB / сеть
Next route / server component ──► web/lib/server ──► challenge/src/core
Client component ──► web/lib/shared (типы/zod)      ✗ core
```

- `challenge/` **не импортирует** `web/`. Доменная логика живёт в core.
- `web/` **не дублирует** доменную логику. Route Handler — тонкий слой:
  валидация → вызов core/адаптера → JSON.
- Клиентские компоненты (`'use client'`) импортируют только из
  `web/lib/shared/*`. Прямой импорт `@challenge/core/*` из клиента запрещён:
  `server-only` + Next сломают сборку.
- Канонический chokepoint для БД/агентов/сервисов —
  `web/lib/server/challenge.ts`. Отдельные server-адаптеры (`env.ts`, `llm.ts`,
  `auth.ts`) могут импортировать core напрямую, потому что сами являются
  границей. Не создавайте третий chokepoint.

### 5.2. SQLite

- Только `node:sqlite`, только файлы в `challenge/.data/` через `dataPath()`.
- В web — singleton-ы из `web/lib/server/db.ts` и `withDb()`: синхронный
  `DatabaseSync` сериализуется, чтобы не блокировать event loop ре-ентрантно.
- SQL — только parameterized (`?`). Идентификаторы таблиц/колонок — только из
  закрытого литерального набора, никогда из пользовательского ввода.
- Миграции идемпотентны и выполняются в конструкторе; схема — `CREATE TABLE IF
  NOT EXISTS` + проверки `PRAGMA table_info`.

### 5.3. LLM и сеть

- `LlmClient` инжектится в сервисы/агенты; не создавайте глобальный клиент
  внутри чистой функции.
- Секреты читаются только через `core/env.ts` (CLI) или
  `web/lib/server/env.ts` (web). `process.env` в бизнес-коде запрещён.
- Ошибки наружу — через `safeMessage()`; не отдавайте URL, пути, ключи, тела
  ответов провайдера.
- `fetch` по URL из пользовательского ввода/RSS/LLM-ответа — только через
  allowlist/валидацию.
- Тесты не ходят в сеть: инжектируйте sender/client/sleep.

### 5.4. Конфигурация и секреты

- `.env` и `.env.*` — только локально, в git не попадают.
- Наружу отдаются флаги (`configured: boolean`), имена провайдера/модели и
  маскированные метки — никогда значения ключей/сессий.
- `NEXT_PUBLIC_*` для секретов запрещён.
- Web bind — только loopback (`127.0.0.1`); production — за reverse-proxy/TLS.

## 6. Паттерны, которые мы используем

1. **Маленькие контракты.** `interface` с `readonly`-полями, `type` для
   объединений, `import type` для типов.
2. **Инъекция зависимостей.** Класс принимает клиента/БД/отправителя в
   конструкторе; тесты подменяют их без сети.
3. **Чистые функции для stateless-логики.** Если сервису не нужны зависимости
   и состояние — экспортируйте функции, а не класс со `static`-методами.
4. **Сервис-класс — когда есть конфиг/зависимости.** Конструктор принимает
   `Options` с дефолтами; поля `private readonly`.
5. **Граница валидирует, домен защищает инварианты.** Zod — на входе Route
   Handler; core-сервис всё равно проверяет свои инварианты (`RangeError` на
   отрицательный/дробный бюджет) и не полагается на UI.
6. **Ошибки — типизированные и короткие.** Домен бросает `Error`/`RangeError`;
   Route Handler маппит в 400/404/502/503; наружу — `{ error }` без секретов.
7. **Surgical changes.** Меняйте только то, что требует задача. Не
   переименовывайте чужие комментарии, не форматируйте соседние блоки.
8. **Тесты — рядом с поведением.** Core — `node:test` + `node:assert/strict`;
   web — Vitest + `NextRequest`; UI — Testing Library; e2e — Playwright.

## 7. Примеры хорошего кода

### 7.1. Чистый фабричный helper (`challenge/src/core/types.ts`)

```ts
export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export const msg = {
  system: (content: string): ChatMessage => ({ role: 'system', content }),
  user: (content: string): ChatMessage => ({ role: 'user', content }),
  assistant: (content: string): ChatMessage => ({ role: 'assistant', content }),
};
```

Почему хорошо: один источник истины для роли, нет `any`, нет класса ради
класса, все потребители получают одинаковые объекты.

### 7.2. Минимальный контракт демо (`challenge/src/demos/types.ts`)

```ts
export interface Demo {
  readonly id: string;
  readonly title: string;
  readonly run: () => Promise<void>;
}
```

Почему хорошо: `readonly`-поля, функция возвращает `Promise<void>`, контракт
не протекает деталями реализации.

### 7.3. Инъекция зависимостей (`challenge/src/core/tg/botQueue.ts`)

```ts
export interface OutboxQueueOpts {
  sender: OutboundSender;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onError?: (message: string) => void;
}

export class OutboxQueue {
  constructor(opts: OutboxQueueOpts) {
    this.sender = opts.sender;
    this.gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
    this.sleepFn = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onError = opts.onError ?? (() => {});
  }
}
```

Почему хорошо: сеть/время инжектятся, дефолты безопасны, юнит-тесты не спят
реально и не ходят в Telegram.

### 7.4. Сериализация синхронной БД (`web/lib/server/db.ts`)

```ts
let tail: Promise<unknown> = Promise.resolve();

export function withDb<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = tail.then(fn, fn) as Promise<T>;
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
```

Почему хорошо: одна точка сериализации, ошибка одного вызова не рвёт очередь,
тип результата сохраняется.

### 7.5. Тонкий Route Handler (`web/app/api/todos/route.ts`)

```ts
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { todoAddSchema } from '../../../lib/shared/forms';
import { getTodoDb, withDb } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = todoAddSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }
  const { text, recurring, intervalHours } = parsed.data;
  const dayOfWeek = recurring === 'weekly' ? new Date().getDay() : null;
  const interval = recurring === 'hourly' ? (intervalHours ?? 1) : null;
  const id = await withDb(() =>
    getTodoDb().addTodo(text, null, recurring ?? null, dayOfWeek, interval),
  );
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
```

Почему хорошо: валидация на границе, `server-only`, `withDb`, никакой
доменной логики в route, ошибка 400 с человекочитаемым сообщением.

## 8. Антипаттерны (запрещено)

### 8.1. `any` и необоснованные касты

```ts
// ПЛОХО
function estimate(messages: any): any { ... }

// ПЛОХО: каст, скрывающий несовпадение домена
const rows = db.prepare(sql).all() as unknown as MyRow[];
```

Разрешённый случай `as unknown as` — только на внешней границе (драйвер БД,
JSON-RPC) с комментарием и runtime-проверкой. В бизнес-коде — `unknown` +
сужение/`zod`.

### 8.2. `console.log` в переиспользуемом коде

```ts
// ПЛОХО: core/web-сервис шумит в stdout
console.log('[estimator]', total);
```

Логи — на границе CLI (`cli.ts`, демо) или через инжектированный `onError`.
В core-сервисах и Route Handlers — `console.error` только для настоящих ошибок
и без секретов.

### 8.3. SQL-интерполяция

```ts
// ПЛОХО
db.prepare(`SELECT * FROM posts WHERE id = ${id}`).get();

// ХОРОШО
db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
```

Идентификаторы — только из литерального набора; значения — только `?`.

### 8.4. Импорт core из клиента

```tsx
'use client';
// ПЛОХО: утащит node:sqlite/telegram в браузерный бандл
import { BlogDb } from '@challenge/core/db';

// ХОРОШО
import { type TodoAddInput } from '../lib/shared/forms';
```

### 8.5. Утечка секрета в ошибке/логе

```ts
// ПЛОХО
return Response.json({ error: `fetch failed: ${url}?key=${key}` }, { status: 502 });

// ХОРОШО
const safe = error instanceof Error ? error.message : 'upstream failed';
return Response.json({ error: safeMessage(safe) }, { status: 502 });
```

### 8.6. Прочее, что считается дефектом

- `process.exit()` в `core/*` — только в `cli.ts`.
- Пустой `catch {}` без объяснения и без возврата/логирования.
- Новый `day-NN.ts` без явного требования.
- Правки чужих комментариев/форматирования «заодно».
- Прямой `fetch` к LLM-провайдеру в обход `LlmClient` без причины.
- `@ts-expect-error` без указания причины и без узкой области.

## 9. Шаблон типичного файла

### 9.1. Core-сервис

```ts
// <Одно предложение: зачем файл.>
// <Инвариант/ограничение, если неочевидно.>

import type { ChatMessage } from './types.js';

export interface TokenEstimatorOptions {
  readonly bytesPerToken?: number;
}

export interface TextEstimate {
  readonly bytes: number;
  readonly tokens: number;
}

export interface TokenEstimate {
  readonly total: number;
  readonly messages: ReadonlyArray<TextEstimate & { readonly role: string; readonly index: number }>;
  readonly budget: number | null;
  readonly remaining: number | null;
  readonly fits: boolean;
}

export class TokenEstimator {
  private readonly bytesPerToken: number;

  constructor(opts: TokenEstimatorOptions = {}) {
    this.bytesPerToken = opts.bytesPerToken ?? 4;
  }

  estimateText(content: string): TextEstimate { ... }
  estimate(messages: readonly ChatMessage[], budget?: number): TokenEstimate { ... }
}
```

Обязательно: `.js` в относительных импортах, `import type`, `readonly` у
входов/полей, дефолты в конструкторе, экспорт типов, без `any`, без I/O.
Публичный API — в `challenge/src/core/index.ts` (barrel), если сервис общий.

### 9.2. Web Route Handler

```ts
// /api/<path> — <что делает>, <какие коды>.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { exampleSchema } from '../../../lib/shared/forms';
import { ExampleService } from '../../../lib/server/challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = exampleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    );
  }

  const result = new ExampleService().run(parsed.data);
  return NextResponse.json(
    { ok: true, ...result },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

Обязательно: `server-only`, zod-схема в `lib/shared/forms.ts`, `runtime =
'nodejs'`, `dynamic = 'force-dynamic'`, `Cache-Control: no-store` для
динамических данных, ошибки `{ error }`, успех действия `{ ok: true, ... }`.
Новый `/api/*` по умолчанию закрыт `middleware.ts`; публичным он становится
только через осознанное добавление в `PUBLIC_PATHS`.

### 9.3. Тест core (`node:test`)

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { TokenEstimator } from './tokenEstimator.js';

test('estimateText: округляет вверх по UTF-8 байтам', () => {
  const estimator = new TokenEstimator();
  assert.deepEqual(estimator.estimateText('hello'), { bytes: 5, tokens: 2 });
});
```

### 9.4. Тест Route Handler (Vitest)

```ts
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let POST: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  // dynamic import: vi.mock (если нужен) должен примениться раньше route.
  ({ POST } = await import('../../app/api/example/route'));
});

function req(body: unknown): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/example', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/example', () => {
  it('400 на невалидном теле', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });
});
```

Мокайте только внешние зависимости (LLM, сеть, БД) и тяжёлые границы. Если
импорт route тянет весь баррель `web/lib/server/challenge`, замокайте баррель
до одного нужного экспорта — это мок границы, а не модуля под тестом. Сам
route не мокайте.

## 10. Валидация (Definition of Done)

Перед сдачей задачи:

```powershell
pnpm --filter challenge typecheck
pnpm --filter challenge test          # node:test, все core-тесты
pnpm --filter web typecheck
pnpm --filter web test               # Vitest
# Windows/limited CPU: если Vitest падает на старте воркеров (не на тестах),
# повторите с ограничением: pnpm --filter web exec vitest run --maxWorkers=2
pnpm --filter web build              # если меняли web-сборку/границы
```

- **Lint не настроен.** Не вызывайте несуществующий `lint` и не добавляйте
  ESLint «заодно». Вместо него — чеклист стиля из §8 и ревью diff.
- **Smoke обязателен:** для CLI — реальный запуск команды; для endpoint —
  `NextRequest`-тест или `curl` к `127.0.0.1`; для UI — реальная страница.
- **CHANGELOG:** для продуктовой фичи добавьте запись (что/зачем/коды/риски).
- **Diff:** только файлы задачи; никаких случайных переименований/комментариев.
- **Секреты:** `grep` по diff на ключи, `Bearer`, `TG_SESSION`, `sk-`.

## 11. Как пользоваться субагентами и скиллами

1. Определите слой: `challenge/src/core` → скилл `add-core-service`;
   `web/app/api` → скилл `add-web-endpoint`.
2. Прочитайте `SKILL.md` и соответствующий существующий файл-образец.
3. Для реализации запускайте субагента `project-implementer` с одним
   самодостаточным срезом. В `context` передайте интерфейсы и запрет на
   build/lint/test внутри среза.
4. Для ревью — `project-reviewer` (read-only): корректность, границы,
   секреты, стиль, тесты.
5. Валидацию (`typecheck`, тесты, smoke) запускает **родитель один раз** после
   интеграции, не каждый субагент.

Субагент не должен: создавать новый пакет, менять `AGENTS.md`/`.omp/RULES.md`,
делать commit/push, трогать замороженные демо, добавлять зависимости.

## 12. Git-дисциплина

- Ветка на задачу: `day-NN` или `feat/<slug>`; PR в `main`, squash-merge.
- Коммит: `<scope>: <imperative>` (`day-11: add ...`, `web: fix ...`).
- Не коммитьте `.env`, `.data/`, `web/.next/`, `swarm-report/`, `.shots/`.
- Не делайте commit/push, если пользователь явно не попросил.
