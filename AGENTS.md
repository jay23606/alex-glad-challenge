<!-- From: E:/IT/alex-glad-challenge/AGENTS.md -->
# AGENTS.md — правила проекта (v3, Agent Skills)

Единый контракт для ИИ-ассистентов, работающих с репозиторием
`alex-glad-challenge`. Прочитайте до любых изменений. Файл описывает **текущую
реальность репозитория**, а не историю первых десяти дней.

Этот проект использует workflow-пак [Agent Skills](https://github.com/addyosmani/agent-skills)
(24 lifecycle-скилла + 4 review-персоны). Проектные факты (стек, структура,
границы, конвенции, команды валидации) остаются в этом файле; сами процессы
живут в `.omp/skills/` и `.omp/agents/`.

## 0. Как читать правила

- **Глобальный конфиг:** `~/.omp/agent/AGENTS.md` — общие правила для всех
  проектов. Он **не отменяет** этот файл; при конфликте побеждает проектный.
- **Локальный конфиг:** этот `AGENTS.md` — канонический источник правил проекта.
- **Sticky-правила:** `.omp/RULES.md` — короткие жёсткие инварианты, которые
  должны оставаться в контексте даже в длинной сессии.
- **Скиллы:** `.omp/skills/*/SKILL.md` — 24 workflow-скилла из Agent Skills.
- **Персоны агентов:** `.omp/agents/*.md` — `code-reviewer`, `test-engineer`,
  `security-auditor`, `web-performance-auditor`.
- **Референсы:** `.omp/references/*.md` — чек-листы: Definition of Done,
  testing-patterns, security, performance, accessibility, observability,
  orchestration-patterns.
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
    agents/                  # code-reviewer, test-engineer, ...
    skills/                  # 24 Agent Skills workflow-скилла
    references/              # shared checklists
    docs/agents.md           # orchestration/composition guide
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

## 9. Шаблоны типичного файла

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
do одного нужного экспорта — это мок границы, а не модуля под тестом. Сам
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

Полный project-wide Definition of Done и пояснение, чем он отличается от
acceptance criteria задачи, см. в `.omp/references/definition-of-done.md`.

## 11. Как пользоваться скиллами

Скиллы — это workflow, не советы. Когда задача попадает под один из них,
следуйте шагам в `.omp/skills/<name>/SKILL.md` в указанном порядке, не
пропускайте verification.

```text
DEFINE                      PLAN                         BUILD
interview-me            planning-and-task-breakdown    incremental-implementation
idea-refine                                            test-driven-development
spec-driven-development                                context-engineering
constraint-driven-development                          source-driven-development
                                                       doubt-driven-development
                                                       frontend-ui-engineering
                                                       api-and-interface-design

VERIFY                      REVIEW                       SHIP
browser-testing-with-devtools   code-review-and-quality      git-workflow-and-versioning
debugging-and-error-recovery    code-simplification          ci-cd-and-automation
                                security-and-hardening       deprecation-and-migration
                                performance-optimization     documentation-and-adrs
                                                             observability-and-instrumentation
                                                             shipping-and-launch
```

Полный список:

| Фаза | Скилл | Зачем |
|---|---|---|
| Define | `interview-me` | Вытащить, чего пользователь на самом деле хочет |
| Define | `idea-refine` | Структурировать размытые идеи |
| Define | `spec-driven-development` | Спека до кода |
| Define | `constraint-driven-development` | Зафиксировать планку качества |
| Plan | `planning-and-task-breakdown` | Разбить на маленькие проверяемые задачи |
| Build | `incremental-implementation` | Тонкие вертикальные срезы |
| Build | `test-driven-development` | Red-Green-Refactor |
| Build | `context-engineering` | Правильный контекст в нужный момент |
| Build | `source-driven-development` | Решения по официальной документации |
| Build | `doubt-driven-development` | Адверсариальная проверка решений |
| Build | `frontend-ui-engineering` | UI, доступность, адаптивность |
| Build | `api-and-interface-design` | Контракты и границы |
| Verify | `browser-testing-with-devtools` | Runtime-данные из браузера |
| Verify | `debugging-and-error-recovery` | Пять шагов: reproduce → localize → reduce → fix → guard |
| Review | `code-review-and-quality` | Пятиосевое ревью |
| Review | `code-simplification` | Упростить, сохранив поведение |
| Review | `security-and-hardening` | OWASP, валидация, секреты |
| Review | `performance-optimization` | Сначала замер, потом оптимизация |
| Ship | `git-workflow-and-versioning` | Атомарные коммиты, чистая история |
| Ship | `ci-cd-and-automation` | Пайплайны качества |
| Ship | `deprecation-and-migration` | Безопасный вывод старых систем |
| Ship | `documentation-and-adrs` | Записать почему, а не только что |
| Ship | `observability-and-instrumentation` | Логи, метрики, трейсы |
| Ship | `shipping-and-launch` | Чек-лист запуска, мониторинг, откат |

Составление персон: см. `.omp/docs/agents.md`.

## 12. Персоны агентов

Специалисты для целевых ревью. Персона не вызывает другую персону;
оркестрация — задача пользователя или slash-команды (см. `.omp/docs/agents.md`).

| Персона | Роль | Когда использовать |
|---|---|---|
| `code-reviewer` | Senior Staff Engineer | Пятиосевое ревью перед мержем |
| `test-engineer` | QA Specialist | Стратегия тестирования, coverage, Prove-It |
| `security-auditor` | Security Engineer | OWASP-аудит, уязвимости |
| `web-performance-auditor` | Web Performance Engineer | Core Web Vitals, perf-аудит |

## 13. Профили агентного режима

Профиль — готовый процесс под тип задачи: стадии, запреты, формат результата.
Механизм перенесён сюда из исторического `CLAUDE.md` (2026-10-23) и переведён на
живые скиллы `.omp/skills/` и агентов omp (`scout`, `task`, персоны §12).

### 13.1. Выбор профиля

Ассистент **сам выбирает** профиль по ключевым словам запроса (таблица ниже),
объявляет его одной строкой (`профиль: Бизнес-фича`) и далее следует **СТРОГО**
по графу стадий этого профиля до конца задачи — без повторных вопросов. Смена
профиля — только явным решением при вскрывшейся ошибке выбора. `ask` — только
когда задача реально неоднозначна И выбор профиля меняет результат; в остальных
случаях действовать по консервативному выбору, не спрашивать и не угадывать.

Пропуск стадии профиля (особенно `Validation` и `Report`) — дефект процесса:
он фиксируется в отчёте, а не молча «закрывается» ad-hoc проверками (§13.2).

| Триггеры в запросе | Профиль |
|---|---|
| «добавить», «реализовать», «фича», «интеграция», «endpoint», «команда CLI» | **Бизнес-фича** |
| «баг», «ошибка», «падает», «не работает», «регрессия», «стек-трейс», «воспроизвести» | **Поиск бага** |
| «как устроено», «найди», «какие», «где», «оцени» (вопрос без правок) | **Research** |
| «граф», «карта проекта», «связи компонентов», «схема фич» | **Граф проекта** |

### 13.2. Общие правила стадийных профилей (STRICT)

- Оркестратор не пишет код сам: чтение/поиск → `scout`, правки → `task`, ревью →
  персоны §12. Одна стадия = один тип работы; субагент не меняет стадию сам.
  Перед сменой — строка `стадия X → Y` пользователю и в prompt следующего агента.
- Контекст между агентами — два канала, оба обязательны: (1) сводка «Контекст от
  предыдущей стадии» в prompt; (2) файлы `swarm-report/`. Субагенты не общаются
  напрямую.
- Нейминг артефактов: `swarm-report/<slug>-<stage>-<NN>.md` (stage: `research`,
  `plan`, `diagnose`, `fix`, `validation`), `<slug>-reproduce.md`,
  `<slug>-e2e-scenario.md`, финал `<slug>-<YYYY-MM-DD>.md`. При fan-out —
  `<slug>-<stage>-<роль|пакет>-<NN>.md`; параллельная запись в один файл запрещена.
- Fan-out внутри стадии — одним сообщением. Консилиум — ровно 3. Fix — ≤4 агентов
  и только при непересекающихся файлах; точку интеграции трогает один агент;
  во время параллельной фазы никто не коммитит. Барьеры — только по данным:
  Plan после всех research-отчётов, Validation после Fix, Report после Validation.
- Baseline до правок: `pnpm --filter challenge typecheck` + прогон целевой
  команды/тестов — точка сравнения для Validation.
- Цикл Fix↔Validation без прогресса >2 итераций → стоп и доклад. Репродукция —
  ≤3 попыток, между попытками меняется один параметр.
- Право возражать: субагент, нашедший костыль/дыру/техдолг, фиксирует возражение
  в своём отчёте; оркестратор доводит его до пользователя, не глотает.
- Устойчивость к компактизации: статус работы — в файлах `swarm-report/`, не в
  памяти; перед шагом перечитать файл сценария; шаги с `[x]` не повторять.
- Report обязателен в конце (§13.7). Без Report сценарий незавершён.

### 13.3. Бизнес-фича

Новая функциональность на существующих поверхностях (`web/`, CLI, MCP-серверы,
TG). Новые `day-NN` не создаются (§1).

Скиллы: `spec-driven-development` → `planning-and-task-breakdown` →
`incremental-implementation` / `test-driven-development` →
`code-review-and-quality`. Персоны: `code-reviewer`, `test-engineer`.

Граф стадий: `Research → Plan → Fix → Validation → Report`; единственный откат —
`Validation → Fix`. Запрещены: `Research → Fix`, `Research → Validation`,
`Plan → Validation`, `Fix → Plan`, `Fix → Research`, `Report → *`.

| Стадия | Агент | Делает |
|---|---|---|
| Research | `scout` ×3 (архитектор / стек / продуктовый критик) | факты, точки интеграции, готовые утилиты для переиспользования, критерии приёмки |
| Plan | `task` | затрагиваемые файлы, work-пакеты (непересекающиеся → fan-out), подход, риски |
| Fix | `task` (≤4) | реализация по плану, typecheck |
| Validation | `code-reviewer` + `test-engineer` | typecheck до/после, соответствие плану, регрессии, security |
| Report | оркестратор | §13.7 |

ДОЛЖЕН: переиспользовать существующие модули; держать diff хирургическим;
проверять по §10.
НЕ ДОЛЖЕН: создавать второй chokepoint/пакет/зависимость без явного одобрения;
трогать замороженные `demos/` и архивы; коммитить без запроса.
Report-specific: затронутые файлы, критерии приёмки → статус, риски/допущения.

### 13.4. Поиск бага

Дефект, регрессия, неверное поведение runtime.

Скиллы: `debugging-and-error-recovery` (reproduce → localize → reduce → fix →
guard), `test-driven-development` (Prove-It: сперва падающий тест), для web —
`browser-testing-with-devtools`. Персона: `code-reviewer`.

Граф стадий: `Diagnose → Reproduce → Fix → Validation → Report`; откаты
`Reproduce → Diagnose` (гипотеза опровергнута) и `Validation → Fix`. Запрещены:
`Diagnose → Fix`, `Fix → Diagnose`, `Reproduce → Validation`, `Report → *`.
Сумма откатов ≤2, далее стоп и доклад.

Diagnose — консилиум 3 (`scout`): гипотез-генератор / трассировщик кода /
контр-цензор; каждый пишет свой файл. Reproduce стартует только по подтверждённой
гипотезе.

ДОЛЖЕН: воспроизводить детерминированно минимальным прогоном ДО правок; править
корневую причину, а не симптом; добавлять регрессионный тест (Prove-It); гнать
typecheck и целевые тесты после фикса.
НЕ ДОЛЖЕН: начинать Fix без подтверждённого repro; чинить симптом; делать 4-ю
попытку репродукции; править попутный код.
Report-specific: корневая причина, шаги repro, фикс (файл:строка), подтверждение
«больше не воспроизводится», регрессии.

### 13.5. Research

Вопрос по кодовой базе → структурированный ответ. Изменений кода — ноль.

Агент: `scout` (read-only). Скиллы: `source-driven-development`; для вопросов о
структуре — сначала `graphify query` при готовом `graphify-out/graph.json`.

ДОЛЖЕН: локализовать файлы (`find`/`grep`/`glob`), читать код, а не память;
проверять связи (кто импортирует/вызывает; для символов — LSP references);
сопоставлять поверхности с тестами (что покрыто/нет); каждое утверждение —
`file:line`; честно отделять проверенное от предположений.
НЕ ДОЛЖЕН: менять файлы, коммитить, ставить пакеты; запускать мутирующие команды
(миграции, генерация, build с записью); ходить в сеть; утверждать без источника.

Формат ответа: (1) краткий ответ 2–3 предложения; (2) файлы — `path:line` + роль;
(3) связи — кто на кого и в какую сторону; (4) выводы; (5) открытые вопросы и что
не проверено.

### 13.6. Граф проекта

Карта проекта / цепи компонентов / фич: узлы, рёбра, структурные выводы.

Агент: `scout` собирает факты (модули, импорты, поверхности); граф собирает
оркестратор. Тяжёлый пайплайн — глобальный скилл `graphify` (`/graphify .`,
инкремент `--update`, ответы `graphify query`).

ДОЛЖЕН: строить рёбра по реальным импортам/вызовам; уровни: поверхности
(CLI/TG/MCP) → web-server (роуты/адаптеры) → core-модули → данные; помечать
недоказанные рёбра как
INFERRED; в выводы — god-модули, циклы, нарушения границ; обновлять граф
инкрементально (`graphify --update`), не перестраивать с нуля.
НЕ ДОЛЖЕН: менять код; включать замороженное (`demos/`, архивы) в активный граф
без пометки; выдумывать узлы/рёбра.

Формат: mermaid-граф → легенда узлов (path + роль) → 3–5 структурных выводов →
ограничения (что не включено).

### 13.7. Шаблон Report

```markdown
# <Slug> — <YYYY-MM-DD>

## Профиль
<Бизнес-фича | Поиск бага | Research | Граф проекта>

## Что сделано / Ответ
- …

## Проверки
- [ ] typecheck: `pnpm --filter challenge typecheck` (+ `web` при затронутом web/)
- [ ] Прогон: <команда/тест/сценарий>

### Security-чеклист (стадийные профили)
- [ ] Ключи только в `.env`; SQL parameterized; tainted-контент sanitize
- [ ] `.env`/`.data/` не в коммите; fetch по tainted-URL — через allowlist
- [ ] web: bind loopback; client-bundle без секретов

## Риски / допущения
## Открытые вопросы
```

### 13.8. Как добавить новый профиль

Чек-лист (каждый пункт обязателен, профиль без любого из них неполон):

1. **Триггер** — добавить строку в таблицу §13.1 (ключевые слова → имя профиля).
2. **Subsection §13.N** с обязательными блоками:
   - Назначение — один абзац: какой тип задачи, что на выходе.
   - Агенты и скиллы — `scout`/`task`/персоны §12 + скиллы `.omp/skills/`.
   - ДОЛЖЕН — проверяемые действия (искать/читать/запускать/проверять).
   - НЕ ДОЛЖЕН — запреты (что профильу запрещено в принципе).
   - Формат ответа — нумерованная структура результата (для стадийных — граф
     переходов + таблица стадий + отчётные поля).
3. **Шаблон Report** — дополнить enum в §13.7, если профилю нужны свои поля.
4. **Боевой прогон** — одна реальная задача; артефакты в `docs/advanced-day-*`;
   при доработках после первой попытки — зафиксировать в CHANGELOG.

Существующие профили соответствуют этому чек-листу (проверено при добавлении
Research и Графа проекта, 2026-10-23).

### 13.9. Находки, дефекты и инциденты вне скоупа

Правило уровня процесса, а не отдельный профиль: действует в любом профиле и
для любого исполнителя (omp, Claude Code, Codex, человек). Источник истины —
этот раздел и `.github/ISSUE_TEMPLATE/bug.md`; `.omp/RULES.md` дублирует только
инварианты. Приоритет без метки на issue не существует. Ни один шаг ниже не
требует omp-инструментов: нужны только `gh` и GitHub.

**Приоритеты:**

|Метка|Когда|Что делает исполнитель|
|---|---|---|
|`P0` + `incident`|прод недоступен, потеря/утечка данных, security|останавливает текущую задачу, чинит инцидент (`hotfix`), issue заводит сразу|
|`P1`|сломан основной сценарий, обход есть|доводит текущую задачу до §10, затем берёт issue следующим слотом|
|`P2`|побочный дефект, UX, неверный край|заводит issue сразу, кладёт в пул, задачу не прерывает|
|`P3`|косметика, техдолг, «заодно»|issue в пул, берётся в свободное окно|

**Порядок при находке:**

1. Оформить issue по `.github/ISSUE_TEMPLATE/bug.md`
   (`gh issue create --template bug.md`): факт, repro, ожидание/факт, критерий
   готовности, профиль, источник (issue/PR/отчёт/шаг smoke). Labels из шапки
   (`bug`, `needs-triage`) применяет GitHub UI; при создании через `gh` укажи
   их явно: `--label bug --label needs-triage`.
2. Проставить `P0`–`P3`; для `P0` — ещё `incident`.
3. P1–P3: продолжить текущую задачу. P0: остановиться, завести `hotfix`, после
   §10 по инциденту вернуться к прерванной задаче (она остаётся `in-progress`).
4. Триаж — до закрытия текущей задачи: каждой находке приоритет и владелец;
   дубликаты и не-баги закрыть с причиной; остальное оставить в пуле.
5. Находку в текущей задаче не править, даже если фикс тривиален
   (`.omp/RULES.md` §5).
   Исключение — блокер, без которого задачу нельзя довести до §10: он входит в
   скоуп, отдельный issue не нужен, факт отметить в Report.

**Лимиты:**

- WIP = 1 `in-progress` на исполнителя. Параллельно — только непересекающиеся
  файлы (§13.2), у каждой задачи свой `in-progress`.
- Repro ≤3 попыток (одна переменная за попытку), Fix↔Validation ≤2 циклов, дальше
  стоп и доклад (§13.4). Для `P0` лимит итераций не отменяется.
- Открытых `P0`/`incident` — 0 в норме; `P1` — не больше 5 одновременно. При
  превышении следующий слот идёт на разбор очереди, а не на новую фичу.

**Закрытие и метрики:**

- Старт = метка `in-progress` (таймстемп в timeline). Финиш = `Closes #N` в
  коммите или close с отчётом, если кода нет. `closedAt` — единственный
  timestamp, которому верим.
- Время: `node scripts/loop-metrics.mjs --from <N> --to <M>` — GitHub API,
  старт из `in-progress`, fallback — закрытие предыдущей issue; печатает
  среднее и медиану. Отчёт без этой команды не принимается; оценка «на глаз» и
  самоотчёт вместо измерения — дефект отчёта.
- При закрытии: снять `in-progress`; `blocked` — если ждём внешнее событие;
  `hotfix` — если фикс пришёл вне плана.

**Прогон (execution loop) и инструментация:**

Loop не включается сам: обычная задача идёт одним профилем, issues не создаются,
метрики не пишутся. Режим включается явно — токеном `loop-run` в запросе
(синонимы: «execution loop», «пул задач»), либо существующим milestone. Это
контрактный токен, а не shell/slash-команда: его обязан распознать любой
harness, прочитавший этот раздел.

**Вход прогона (что даёт пользователь):** список фич и список рефакторинга
(можно сырой), разрешения (`issues/milestone`, `commit`, `push/PR`), границы
(что не входит) и ветку. Без разрешения на commit loop не запускается: issues
не закроются, метрики будут неполными.

**Что делает исполнитель:**

1. Research до создания задач: читает код, режет список на issues с критериями,
   файлами, профилем и приоритетом. **Крупная фича = эпик: заводится tracking-issue
   с меткой `epic` и чеклистом стори, и разбивается на story-issues (метка `story`,
   тот же milestone, `loop-run`).** Неразрешимая ambiguity — либо консервативное
   допущение в issue, либо `asked-user` (это остановка и вмешательство).
2. Создаёт milestone `run-…` и issues по шаблону с `loop-run` и `P0–P3`. Каждая
   story — отдельный issue с критерием готовности; эпик — обёртка со ссылками на
   стори и сквозным критерием приёмки (не закрывается, пока не закрыты все стори).
3. Выполняет P0 → P1 → P2 → P3, WIP=1, §10 на каждую задачу, `Closes #N`.
   Фичи и рефакторинг — отдельные issues и коммиты, диффы не смешивать.
4. Финал: полный §10, `loop-metrics`, CHANGELOG, run-отчёт в `swarm-report/`.

- Прогон = GitHub milestone (`run-YYYY-MM-DD[-N]`). Все issues пула получают этот
  milestone и метку `loop-run`; первая — `in-progress`.
- Первая попытка не прошла: `iteration:2` + ровно один `cause:*`:
  `cause:context` (не понял контекст), `cause:code` (нерабочий код),
  `cause:loop` (зациклился), `cause:test` (ошибка в тесте),
  `cause:premise` (ложная посылка).
- Исполнитель остановился спросить пользователя: `asked-user`, причина — в
  комментарии. Другие сообщения пользователя GitHub API не видны: их число
  фиксируется в run-отчёте.

|Метрика|Источник|Если не инструментировано|
|---|---|---|
|задач подряд без остановок|issues milestone − `asked-user`|`n/a`|
|на чём сломался и почему|`iteration:2` + `cause:*`|`n/a`|
|среднее время|`in-progress`/`Closes #N`|fallback-интервалы|
|с первого раза|closed с `loop-run` без `iteration:2`|`n/a`|

`node scripts/loop-metrics.mjs --milestone <name>` печатает все четыре.
Отсутствие метки — это `n/a`, а не 0 и не оценка: метрика без метки не
существует.

---

## 14. Git-дисциплина

- Ветка на задачу: `day-NN` или `feat/<slug>`; PR в `main`, squash-merge.
- Коммит: `<scope>: <imperative>` (`day-11: add ...`, `web: fix ...`).
- Не коммитьте `.env`, `.data/`, `web/.next/`, `swarm-report/`, `.shots/`.
- Не делайте commit/push, если пользователь явно не попросил.
