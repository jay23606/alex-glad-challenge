# alex-glad-challenge

Челлендж «как LLM работает изнутри». Дневник прохождения курса, по одному
заданию в день. Каждое задание — отдельный эксперимент над LLM: температура,
токены, стратегии контекста, ветки диалога, агенты и т.п.

Кроме того, в репозитории живёт **pipeline блог-агентов** для футбольного
Telegram-канала «Иди на факты глянь»: RSS → выбор топ-новостей → написание
поста в авторском стиле → фактчекинг. Готов к cron-автоматизации. И —
**Telegram-бот «Фактчемпик»**: бот-память дискуссионного чата канала, который
по командам достаёт реальные цитаты участников (FTS5 по 866k сообщений, дата
и атрибуция — кодом, без LLM) и играет в «кто это сказал» и «Изобрази
автора» (пародии + слепое голосование). См.
[`challenge/README.md`](challenge/README.md).

## Архитектура

Монорепозиторий из двух пакетов (pnpm workspace):

- **`challenge/`** — основной TypeScript-монолит: CLI, REPL, `LlmClient`,
  агенты, RAG, Telegram-бот, блог-pipeline, SQLite через `node:sqlite`,
  MCP-серверы и исторические демо `day-01..30`.
- **`web/`** — локальный Next.js 15 (App Router) + React 19: админка, дашборд,
  чат, RAG, блог и Telegram-инструменты. Доменная логика остаётся в
  `challenge/`; `web/` — scoped override с собственным production-build.

Исторические демо `challenge/src/demos/day-01..30` **заморожены**. Новые задачи
(ADVANCED-челлендж и продуктовые фичи) делаются как фичи: core-сервис,
CLI-команда, web-endpoint/страница, тесты. Ветка на задачу (`day-NN` или
`feat/<slug>`) вливается в `main` через PR.

Стек: Node.js 24+, TypeScript (strict, ESM), pnpm, `tsx` без сборки для
`challenge/`; Next.js 15 + React 19 + Tailwind для `web/`; SQLite
(`node:sqlite`), zod, `node:test` / Vitest / Playwright. API: DeepSeek и
OpenRouter. Ключи — через `.env`, см. `.env.example`.

Правила для ИИ-ассистентов — в [`AGENTS.md`](AGENTS.md) и `.omp/` (sticky
правила, субагенты, скиллы). Полный лог — в [`CHANGELOG.md`](CHANGELOG.md).

## Агентные профили

Работа над задачами идёт по одному из четырёх профилей (`AGENTS.md` §13):
**Бизнес-фича** (Research → Plan → Fix → Validation → Report), **Поиск бага**
(Diagnose → Reproduce → Fix → Validation → Report), **Research** (вопрос по
кодовой базе → файлы/связи/выводы, только чтение) и **Граф проекта** (карта
компонентов и связей). Профиль выбирается по формулировке запроса и
подтверждается перед стартом; артефакты стадий пишутся в `swarm-report/`.
Живые примеры прогонов Research и Графа — в
[`docs/advanced-day-02/`](docs/advanced-day-02/README.md).

Находки и дефекты вне текущей задачи не чинятся «заодно»: они заводятся в issues
по шаблону [`.github/ISSUE_TEMPLATE/bug.md`](.github/ISSUE_TEMPLATE/bug.md) с
приоритетом `P0`–`P3`, а текущая задача продолжается (кроме `P0`/`incident`).
WIP, лимиты итераций и измерение времени — [`AGENTS.md` §13.9](AGENTS.md).
Фактическое время по issue печатает `node scripts/loop-metrics.mjs --from N --to M`
(работает из любого harness, нужен только `gh`). Execution loop — явный режим, а
не фон: включается токеном `loop-run` (синонимы: «execution loop»/«пул задач»)
или существующим milestone. Без метки `loop-run` метрики «с первого раза» и остановок печатаются
как `n/a`, а не угадываются.

## Что уже разобрано

> Таблица ниже — исторические дни 1–10. Актуальные правила и текущая
> архитектура — в `AGENTS.md`.

| День | Тема | Где смотреть |
|------|------|--------------|
| 1 | Первый запрос к LLM через API | `challenge/src/demos/day-01.ts` |
| 2 | Формат ответа (без ограничений / JSON / stop) | `challenge/src/demos/day-02.ts` |
| 3 | Способы рассуждения (прямой / пошаговый / мета / эксперты) | `challenge/src/demos/day-03.ts` |
| 4 | Температура (0 / 0.7 / 1.2) | `challenge/src/demos/day-04.ts` |
| 5 | Сравнение версий моделей | `challenge/src/demos/day-05.ts` |
| 6 | Первый агент | `challenge/src/demos/day-06.ts` |
| 7 | Сохранение контекста в JSON | `challenge/src/demos/day-07.ts` |
| 8 | Подсчёт токенов | `challenge/src/demos/day-08.ts` |
| 9 | Сжатие истории через summary | `challenge/src/demos/day-09.ts` |
| 10 | Sliding / Sticky / Branching | `challenge/src/demos/day-10.ts` |

## Быстрый старт

### 1. Установить Node.js 24+ и pnpm

**Windows (PowerShell):**
```powershell
# через nvm-windows (рекомендуется, позволяет переключать версии):
winget install CoreyButler.NVMforWindows
nvm install 24
nvm use 24

# либо просто установить LTS-инсталлер:
# winget install OpenJS.NodeJS.LTS
# Node.js:  https://nodejs.org/

# pnpm:
winget install pnpm.pnpm
```

**macOS / Linux:**
```bash
# nvm (рекомендуется):
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 24
nvm use 24

# pnpm:
corepack enable
corepack prepare pnpm@latest --activate
```

Проверка:
```powershell
node --version   # v24.x.x
pnpm --version   # 10.x.x
```

### 2. Клонировать репозиторий

```powershell
git clone <url-вашего-репозитория> alex-glad-challenge
cd alex-glad-challenge
```

### 3. Установить зависимости

```powershell
pnpm install
```

### 4. Настроить ключи LLM-провайдера

```powershell
Copy-Item .env.example .env
notepad .env   # или любой редактор
```

Заполнить одну из строк (или обе — OpenRouter имеет приоритет):
- `OPENROUTER_API_KEY=sk-or-...` — получить на https://openrouter.ai/keys (даёт
  доступ к десяткам моделей: OpenAI, Anthropic, Google, Meta и т.д.)
- `DEEPSEEK_API_KEY=sk-...` — получить на https://platform.deepseek.com/api_keys

### 5. Запустить

```powershell
# по умолчанию: интерактивный чат-REPL с агентом:
pnpm --filter challenge start

# то же явно + стартовые опции:
pnpm --filter challenge start -- chat
pnpm --filter challenge start -- chat --strategy sliding
pnpm --filter challenge start -- chat --system "Ты ревьюер"

# прогон демо дня одним сценарием (для видео):
pnpm --filter challenge start -- day-03
pnpm --filter challenge start -- latest

# список всех дней:
pnpm --filter challenge start -- list

# блог-агенты: RSS → топ-новости → пост в стиле канала → фактчекинг
pnpm --filter challenge start -- seed-style   # первичная инициализация (один раз)
pnpm --filter challenge start -- news         # pipeline за сутки
pnpm --filter challenge start -- news --hours 48 --top 3
pnpm --filter challenge start -- db-stats     # статистика БД
```

Внутри REPL: `/help`, `/strategy <full|sliding|sticky|branching>`, `/system <text>`,
`/branch <label>`, `/switch <id>`, `/branches`, `/usage`, `/reset`, `/quit`.

### 6. Проверить типы (опционально)

```powershell
pnpm --filter challenge typecheck
```

---

Подробности — в [`AGENTS.md`](AGENTS.md) (для ИИ-ассистентов) и в
[`challenge/README.md`](challenge/README.md). Полный текст задания каждого дня и
лог прохождения — в [`CHANGELOG.md`](CHANGELOG.md).