# ADVANCED Day 4 — правила проекта в системном промпт локальной модели
# Выжимка AGENTS.md v3 (полный файл не влезает в контекст 4b/7b без вреда).
# Подключается в ~/.continue/config.yaml -> rules: [~/.continue/rules/alex-glad-challenge.md]

# Стек: pnpm workspace `challenge/` (TS strict ESM, tsx без сборки, node:sqlite) + `web/` (Next.js 15 App Router, React 19, Tailwind 3).

## Границы (нарушать нельзя)
- `challenge/` НЕ импортирует `web/`. Доменная логика — в `challenge/src/core`.
- Клиентские компоненты (`'use client'`) импортируют только `web/lib/shared/*`.
  Прямой импорт `@challenge/core/*` из клиента запрещён (server-only сломает сборку).
- Канонический chokepoint для БД/агентов из web — `web/lib/server/challenge.ts`. Второй chokepoint не создавать.

## Жёсткие запреты
- Никаких секретов в коде/логах/коммитах: ключи только через `core/env.ts` (CLI) или `web/lib/server/env.ts` (web).
- SQL — только parameterized (`?`). Идентификаторы таблиц — из закрытого литерального набора.
- Никакого `any`. `as unknown as` — только на внешней границе с комментарием и runtime-проверкой.
- Никаких `console.log` в core/web-сервисах (логи — на границе CLI или инжектированный onError).
- Не создавать вложенные package.json, новые зависимости, `day-NN.ts` (демо заморожены), второй lint/build.
- Не коммитить `.env`, `.data/`, `web/.next/`.

## Конвенции
- Файлы core — camelCase (`tokenEstimator.ts`); классы/типы PascalCase; константы UPPER_SNAKE_CASE; boolean `is/has/can/should`.
- Относительные импорты в core — с расширением `.js`; `import type` для типов; `readonly` у полей/входов.
- Класс с зависимостями принимает их в конструкторе (DI); stateless-логика — чистые функции.
- Ошибки наружу — `safeMessage()`, без URL/путей/ключей. Route Handler: zod на границе → core → JSON `{ error }` / `{ ok: true, ... }`.

## Команды валидации (lint НЕ существует — не вызывать)
- `pnpm --filter challenge typecheck` и `pnpm --filter challenge test` (node:test)
- `pnpm --filter web typecheck` и `pnpm --filter web test` (Vitest; на Windows-хосте --maxWorkers=2)
- Прогон CLI: `pnpm --filter challenge start -- <cmd>`

## Стиль ответа
Русский язык. Сначала решение, потом объяснение. Без воды и без несуществующих API.
