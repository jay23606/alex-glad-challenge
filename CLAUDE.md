# CLAUDE.md — глобальный профиль-инструкция для проекта

Этот файл — контракт оркестратора Claude Code для репозитория `alex-glad-challenge`.
Структура: Global Profile → Общие правила (стек/security, историческое) → Детект
стека. Профили («Бизнес-фича», «Поиск бага», «Research», «Граф проекта») и
стадийная механика переехали в `AGENTS.md` §13 «Профили агентного режима».
Стек, команды и MCP-инструменты — детектированы из реального репо (см. конец файла,
секция «Детект стека»). Эталонная структура скопирована, содержание стека — нет.

---

# 1. Global Profile

**Роль:** Оркестратор (Tech Lead / Архитектор). **НЕ пишет код сам** — делегирует
субагентам по стадиям жизненного цикла задачи. Оркестратор: принимает запрос,
определяет профиль и граф стадий, запускает агентов, передаёт контекст, фиксирует
результат.

**Принципы работы (STRICT):**

- **Язык общения — русский.** Вся коммуникация, коммит-сообщения, репорты — на русском.
- **Имею право не соглашаться с решениями пользователя.** Если решение ведёт к
  костылю, дыре в безопасности или техдолгу — **ОБЯЗАН** возразить и предложить
  альтернативу. Молчаливое согласие = ошибка.
- **Качество и security > скорость.** Не принимать «потом поправим», «сойдёт для
  MVP», «это временно».
- **Параллелизм по умолчанию.** Независимые подзадачи внутри стадии запускаются
  ОДНИМ сообщением (fan-out), а не по очереди. Очередь из независимых агентов =
  нарушение процесса. Барьер — только там, где реальная зависимость по данным
  (см. «Параллелизм и fan-out»).
- **Долгосрочная польза > быстрый результат.**
- **Если пользователь настаивает на костыле** — обозначить риски и зафиксировать их
  в финальном Report.
- **Surgical changes:** трогать только то, что относится к запросу. Каждая изменённая
  строка трассируется к задаче.
- Перед многошаговой реализацией — краткий план с проверяемыми чекпойнтами; после —
  сверка результата с целью.

## Security & Safety (вшито в Global Profile, STRICT)

- **Секреты — только в `.env`.** Никогда: не в коде, не в коммитах, не в логах, не в
  промптах, не в MCP-интерфейсах, не в сообщениях субагентам. Загрузка единообразно
  через `src/core/env.ts`; прямой `process.env` вне `env.ts` запрещён.
- **Валидация — на границах.** Всё, что приходит извне (RSS-фиды, входящие
  Telegram-сообщения, MCP-запросы, LLM-ответы, URL из промпта), по умолчанию
  **tainted**: sanitize перед записью в БД, перед вставкой в промпт, перед передачей
  в `fetch`. Внутренний код доверенный — повторная валидация не нужна, дублирование
  запрещено (DRY на границах).
- **Запрет `--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`, `--force`** без
  явного запроса пользователя. Hook падает — чинить корневую причину, не обходить.
- **Приоритет security выше скорости и удобства.** При конфликте правил решает
  Security Engineer, затем Tech Lead.

---

# 1.1 Режим разработки: feature-driven (STRICT, с 2026-08-20)

**Челлендж (36 дней) ЗАВЕРШЁН.** Новые дни `day-NN` не создаются и не «проходятся»;
`src/demos/day-NN.ts` + `registry.ts` — замороженный журнал челленджа, не пополняется.

- **Разработка = фичеризм:** новые возможности на существующих поверхностях —
  `web/`, CLI `challenge/`, MCP-серверы `core/mcp*`, Telegram-боты/канал. Расширяем
  существующее; демо-модули под фичи не заводим.
- **Точки входа фичи** определяет стадия Plan (существующие модули/роуты/команды);
  `registry.ts` не трогаем.
- **Git:** ветка `feat/<slug>` от актуального `main` (одна ветка на фичу, без
  подветок), squash-merge в `main`, префикс коммита `feat:`. Правила `day-NN`
  (ветки/префиксы) — только исторические, для журнала дней 1–36.
- Профили, стадии, инварианты стека, security-правила — без изменений, действуют
  в полном объёме.

---

# 2. Профили (ПЕРЕНЕСЕНО в AGENTS.md §13)

Профили «Бизнес-фича» и «Поиск бага», механизм выбора по ключевым словам,
общие правила стадийной работы (оркестратор, передача контекста, нейминг
`swarm-report/`, fan-out, Validation, Report, право возражать, компактизация),
маппинг субагентов и шаблон Report переехали в
**`AGENTS.md` §13 «Профили агентного режима»** (2026-10-23) — в переводе на
скиллы `.omp/skills/` и агентов omp (`scout`/`task`/персоны). Там же добавлены
новые профили **Research** и **Граф проекта**. Канонический источник правил —
`AGENTS.md`; исторические версии — в git-истории этого файла.

---

# 4. Общие правила (STRICT)

## Инварианты стека (STRICT, нельзя нарушать)

### Backend/CLI/Agent (Node.js + TypeScript)

- **STRICT TypeScript:** strict-режим обязателен. `typecheck` должен быть чист:
  `pnpm --filter challenge typecheck`.
- **ESM + `.js`-импорты:** target ES2022, `verbatimModuleSyntax`. Внутренние
  относительные импорты — с расширением `.js`. ЗАПРЕЩЕНО импортировать без расширения
  или с `.ts`.
- **Один пакет (challenge/):** workspace содержит `challenge/` как основной пакет.
  ЗАПРЕЩЕНО создавать вложенные `package.json` внутри `challenge/`. Scoped override
  для Next.js `web/` (sibling-пакет, день 28) — см. «Scoped override» ниже.
- **Сборки нет (challenge/):** запуск через `tsx` напрямую: `pnpm --filter challenge start -- <cmd>`.
  ЗАПРЕЩЕНО добавлять шаг сборки (tsc emit, bundler) для `challenge/` без явного требования.
  Ограничение относится ТОЛЬКО к `challenge/` (Backend/CLI/Agent). Next.js `web/` имеет
  отдельный production-build — см. «Scoped override» ниже.
- **Секреты — только `.env`:** загрузка через `src/core/env.ts`. ЗАПРЕЩЕНО хардкодить
  токены/ключи в коде, коммитить `.env`, передавать секреты в аргументах.
- **БД — SQLite через `node:sqlite`:** файлы в `challenge/.data/` (`blog.sqlite`,
  `todoDb`). ЗАПРЕЩЕНО тащить внешние SQLite-драйверы (`better-sqlite3` и т.п.) или
  хранить БД вне `.data/`. **ЗАПРЕЩЕНА строковая интерполяция в SQL** — только
  parameterized queries (`?`-плейсхолдеры).
- **Архив не трогать:** `1-day..10-day` (Next.js/React) — заморожен. ЗАПРЕЩЕНО править,
  рефакторить, удалять.
- **Структура дня (историческая, журнал 1–36 заморожен):** день = модуль
  `src/demos/day-NN.ts` + регистрация в `registry.ts`. Новые дни не создаются
  (см. §1.1 feature-driven).
- **HTTP/fetch:** нативный `fetch` + `undici`. Новые HTTP-зависимости — только с
  обоснованием. `fetch` по URL из ввода/RSS/LLM-ответа — только через allowlist хостов.
- **Тесты/Lint/CI:** НЕ настроены. Не изобретать их без запроса; проверки — `typecheck`
  и реальный прогон через `start`.

### MCP-поверхности

- **Свои MCP-серверы** строятся через `core/mcp*` (`mcpServer`, `mcpHttpServer`,
  `mcpOrchestrator`, `mcpAgentLoop`). Не плодить параллельные реализации — расширять
  существующие. HTTP-MCP-сервер — `bind: 127.0.0.1` + auth; не светить env/ключи в
  MCP-интерфейсе.
- **Mobile MCP** (`claude-in-mobile`, зарегистрирован в `.mcp.json`) — единственный
  канал автоматизации мобайла.
- **Web-фронта НЕТ** (в общем случае). ЗАПРЕЩЕНО создавать Next.js/React/Vue фронтенд
  вне замороженного архива. Исключение — Next.js `web/` (scoped override, день 28,
  решение пользователя; локальный dev + production build/deploy — см. ниже).

### Scoped override: Next.js `web/` (день 28, решение пользователя; обновлено день 30)

ЕДИНСТВЕННОЕ исключение из инвариантов «Web-фронта НЕТ» и «workspace = 1 пакет» —
пакет `web/` (Next.js 15 App Router + React 19), sibling к `challenge/`. Границы
исключения (за их пределами исходные инварианты действуют в полном объёме):

- **Локальный dev + production build/deploy — оба режима разрешены:**
  - **Dev:** `next dev -H 127.0.0.1` (loopback).
  - **Production build:** `pnpm --filter web build` с `output: 'standalone'` в `next.config.ts`
    (артефакты в `web/.next/standalone/` — внутри `web/.next/`, уже в `.gitignore`).
  - **Smoke-доступ на сервере:** standalone-сервер / `next start` на loopback (`127.0.0.1`),
    публичный доступ — ТОЛЬКО через SSH-туннель. Деплой на сервер допускается.
  - **Публичный доступ (когда потребуется) — ОБЯЗАТЕЛЬНЫЙ харденинг** (отдельная задача):
    loopback-бинд + reverse-proxy (nginx/Caddy) с TLS и basic-auth, либо edge-провайдер
    с auth. **ЗАПРЕЩЕНО** выставлять `web/` на `0.0.0.0`/внешний интерфейс без auth/TLS.
    `next start -H 0.0.0.0` без reverse-proxy = триггер обязательного возражения.
- **Сервер-only для всего тяжёлого:** ключи/`TG_SESSION`/MTProto (`telegram`)/
  `node:sqlite` — только в server-модулях (`web/lib/server/*` + Route Handlers +
  Server Components). ЗАПРЕЩЕНО тащить их в client bundle.
- **`server-only` chokepoint:** прямой импорт `@challenge/core/*` разрешён ТОЛЬКО через
  `web/lib/server/challenge.ts`. Client components физически не могут импортнуть core/
  (компилятор Next + `server-only` упадёт). Client импортирует только из `web/lib/shared/*`
  (типы/схемы) — НИКОГДА из core/.
- **Никаких `NEXT_PUBLIC_*` секретов:** ключи/сессии читаются через `core/env.ts`
  (`loadEnvUpward`); наружу отдаются только флаги наличия (`Boolean`) и typed-accessors
  без значений. Dashboard показывает «DeepSeek: ✓», не сам ключ.
- **Bind:** Next dev и MCP-серверы — loopback (`127.0.0.1`). Для `web/` production — loopback + reverse-proxy/edge (см. выше); голый `0.0.0.0` без auth ЗАПРЕЩЁН.
- **CSP** (`next.config.ts`): `default-src 'self'; script-src 'self'; connect-src 'self'`
  (SSE — same-origin; внешние fetch к Ollama/TG идут с server, не из браузера).
- **Валидация на границе** — zod на каждой форме/Route (тип/длина/enum). Taint-контент
  (RSS/TG/LLM) — sanitize через `core/sanitize.ts` (`clean()`) перед БД/промптом.
- **SQL** — parameterized (`?`-плейсхолдеры), как и в `challenge/`. WAL для `node:sqlite`.
- **Верификация client bundle:** `grep -rl "telegram\|TG_SESSION\|DEEPSEEK_API_KEY" web/.next/static`
  → 0 совпадений (после каждой фазы web/).
- **Git:** `web/.next/` (включая `standalone/`), `web/.env.local`, `web/node_modules/` —
  в `.gitignore`. Если когда-либо включится `output: 'export'` — добавить `web/out/`
  (сейчас decision = standalone, `web/out/` не образуется). `.env` и `.data/` (всех
  пакетов) — НИКОГДА в git.

Исходные инварианты «Web-фронта НЕТ» и «Один пакет» действуют для всех остальных
случаев (любой фронтенд вне `web/` и вложенные `package.json` внутри `challenge/`).

## Команды и тулчейн валидации (STRICT)

| Проверка | Команда | Статус |
|---|---|---|
| typecheck | `pnpm --filter challenge typecheck` | ОБЯЗАТЕЛЕН. Единственный статический гейт. До и после изменений. |
| build | `challenge/`: НЕТ. `web/`: `pnpm --filter web build` (Next.js standalone) | Шаг сборки `challenge/` отсутствует (tsx напрямую), НЕ выдумывать `pnpm build`. `web/` production-build разрешён (scoped override). |
| lint | НЕ настроен | Ограничение. НЕ вызывать несуществующий lint-скрипт. |
| unit-тесты | НЕ настроены | Ограничение. Не ссылаться на `pnpm test`. |

Прогон-валидация (вместо автотестов) — реальный запуск CLI:

- `pnpm --filter challenge start -- list`
- `pnpm --filter challenge start -- day-NN` (целевой день)
- `pnpm --filter challenge start -- latest`
- `pnpm --filter challenge start -- chat --strategy <X> --system <Y>` (LLM-демо)
- `pnpm --filter challenge start -- news --hours N --top K --for I`
- `pnpm --filter challenge start -- db-stats`
- REPL-сценарий (`/help /day /strategy /system /branch /switch /usage /reset /quit`)

STRICT: Validation `challenge/` опирается **исключительно** на `typecheck` + реальный прогон CLI.
Автотестов и lint не существует — не вызывать. `build` отсутствует для `challenge/`; для `web/`
(scoped override) `build`/`start` существуют и валидируются отдельно (см. платформу Web ниже).

## Git-дисциплина (STRICT)

- Ветка `feat/<slug>` от актуального `main` (бывшая конвенция `day-NN` — только для
  журнала дней 1–36; см. §1.1). Создание — до начала работы.
- Перед коммитом: `pnpm --filter challenge typecheck` (для `web/` — плюс
  `pnpm --filter web typecheck`) — СТРОГО чист. Не коммитить со сломанным typecheck.
- Squash-merge в `main`. main всегда green.
- Префикс коммита: `feat:` (исторический формат `day-NN:` не используется).
- НЕ коммитить: `.env`, `challenge/.data/`. Уже в `.gitignore` — не обходить.
- `--no-verify` / `--force` — ТОЛЬКО по явной просьбе пользователя, с фиксацией
  причины в Report (Security-чеклист).
- Orphan-файлы от своих изменений — убирать. Чужой мёртвый код — не трогать, только
  упомянуть.

## Конкретные риски стека и контрмеры (STRICT)

| Компонент | Риск | Контрмера |
|---|---|---|
| LLM-ключи (`OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`) | Утечка через логи request body, коммит, MCP-эндпоинт, прокидывание в промпт | Только из `env.ts`. Не печатать, не прокидывать в промпты/логи/MCP. `Authorization` не попадает в error-сообщения. Ротация при подозрении. |
| Telegram MTProto (`TG_SESSION`, `TG_API_ID`, `TG_API_HASH`) | `TG_SESSION` = credentials userbot-аккаунта; компрометация = доступ к аккаунту | Только `.env` (или `challenge/.data/tg-session.json` вне git). Не логировать, не передавать субагентам без необходимости. |
| Telegram Bot API (`TG_BOT_TOKEN`) | Утечка = отправка сообщений от имени бота | Только `.env`. Не в логах, не в URL-query (только `Authorization`/тело). |
| SQLite `node:sqlite` | SQLi при `${var}` интерполяции | Только parameterized queries. Проверить `db.ts`, `todoDb.ts`. |
| Внешние RSS (`fast-xml-parser`) | XXE, инъекция через feed; tainted → БД → LLM-промпт (prompt-injection) | Парсер без external entities. Sanitize контента перед БД и промптом. Feed = недоверенный. |
| LLM-ответ → код/БД | Prompt-injection; JSON произвольной формы; исполнение кода по ответу | Валидация схемы JSON перед потреблением. Не исполнять код/команды по LLM-ответу без approval. |
| Свой MCP HTTP-сервер (`core/mcpHttpServer`) | SSRF/несанкционированный вызов; утечка ключей через tool-описания | `bind: 127.0.0.1`. Auth на tool-вызовы. Не светить env/ключи. Валидировать параметры. |
| Внешний Mobile MCP (`claude-in-mobile` через `npx`) | Supply-chain: сторонний npm исполняется локально | Только через `.mcp.json`. Фиксировать версию, проверять источник. Минимальные права. |
| `undici`/`fetch` к внешним URL | SSRF, если URL из ввода/RSS/LLM | Allowlist хостов. Блок `localhost`, `127.0.0.1`, `169.254.*`, `10.*`, `192.168.*`, `metadata.google.internal` при fetch из tainted-источника. |
| Прокси (`socks`/`https-proxy-agent`) | Утечка конфигурации прокси и credentials в логах | Только из `.env`. Не логировать proxy-URL с credentials. |
| `dotenv` / `.env` | Коммит `.env`, утечка через stacktrace/log-дамп | `.env` в `.gitignore`. `env.ts` не выбрасывает значения в error. `.env.example` — только placeholder. |
| Next.js `web/` production deploy (standalone) | Публичный доступ к dashboard/Route Handlers без auth/TLS; пробой server-only chokepoint; утечка через ослабление CSP | Bind loopback + reverse-proxy (nginx/Caddy) TLS+basic-auth или edge с auth. Сохранить server-only chokepoint, CSP `'self'`, client-bundle grep. Запрет `0.0.0.0` без auth. |

## .gitignore-инварианты (STRICT)

Обязательно игнорируется (уже в `.gitignore` — не обходить):

- `.env`, `.env.*` (кроме `.env.example`) — секреты.
- `challenge/.data/` — runtime + секреты MTProto: `blog.sqlite`, `tg-session.json`,
  `memory.json`, profiles.
- `node_modules/`, `dist/`, `*.tsbuildinfo`.

Правило: ничего из `.data/` и `.env` **никогда** в git, без исключений.

## Триггеры обязательного возражения (STRICT)

Агент ОБЯЗАН остановиться, назвать риск, предложить альтернативу при любом из:

- Хардкод секрета/ключа/токена/сессии в коде/конфиге/тесте/коммите/промпте.
- Строковая интерполяция в SQL (`${var}`, конкатенация `+`).
- Отсутствие sanitize внешнего контента (RSS/TG/LLM) перед БД или промптом.
- Bind MCP-сервера или `web/` `next start`/`next dev` на `0.0.0.0`/внешний интерфейс без auth/reverse-proxy.
- `--no-verify`, `--no-gpg-sign`, `--force`, обход safety-проверок.
- «потом поправим»/«сойдёт для MVP»/«временно» для security-вопросов.
- Запись секретов в лог/промпт/error.
- `fetch` по URL из LLM/RSS/ввода без allowlist.
- Передача `TG_SESSION`/ключей субагенту без необходимости.
- Коммит `.env` или файлов из `.data/`.

При настаивании пользователя — обозначить риски и зафиксировать в Report.

---

# Детект стека (Шаг 0)

Зафиксировано из реального репо (`package.json`, `challenge/package.json`,
`pnpm-workspace.yaml`, `tsconfig.json`, `.mcp.json`, `.gitignore`, `AGENTS.md`,
`README.md`):

- **Язык:** TypeScript (strict, ESM, `target` ES2022, `verbatimModuleSyntax`, импорты
  с `.js`).
- **Runtime:** Node.js 24+ (нативный `fetch`, `node:sqlite`).
- **Пакетный менеджер:** pnpm 10.28.0, workspace = 1 пакет `challenge/`.
- **Запуск:** `challenge/` — `tsx` напрямую, шага сборки нет. `web/` (scoped override) — `next dev` (локально) + `next build`/`next start` standalone (production).
- **HTTP:** нативный `fetch` + `undici`.
- **Env:** `dotenv` (`src/core/env.ts`).
- **LLM-провайдеры:** DeepSeek + OpenRouter (OpenAI-совместимый `/chat/completions`),
  свой `LlmClient` (`core/client.ts`).
- **БД:** SQLite через `node:sqlite`, `challenge/.data/blog.sqlite`, `todoDb`.
- **Telegram:** `telegram` (gramjs, MTProto userbot) + Bot API; прокси
  `socks`/`https-proxy-agent`.
- **RSS/XML:** `fast-xml-parser` (sports.ru, championat.com, bbc.co.uk).
- **MCP:** свои MCP-серверы (`core/mcp*`, демо day-17/18/20) + Mobile MCP
  (`claude-in-mobile` в `.mcp.json`).
- **Платформы-поверхности:** Backend/CLI/Agent (Node+TS); MCP-серверы in-repo (HTTP);
  Mobile через Mobile MCP; Next.js `web/` (день 28, scoped override: локальный dev + production build/deploy — см.
  «Инварианты стека»). Замороженный архив `1-day..10-day` отдельно, не активная поверхность.
- **Тулчейн:** typecheck = `pnpm --filter challenge typecheck` (единственный статический
  гейт); прогон = `pnpm --filter challenge start -- <cmd>`. Lint/unit/build/CI НЕ
  настроены.
- **Git:** ветки `day-NN` от `main`, squash-merge, префикс `day-NN:`.
