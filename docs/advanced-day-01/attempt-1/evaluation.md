# Генерация 1 — правила v1 (`AGENTS.md` до итерации)

**Промпт:** `docs/advanced-day-01/prompt.md` (один и тот же для обеих генераций).
**Правила:** `AGENTS.v1.md` (150 строк; web/ и `.omp` не описаны).
**Исполнитель:** субагент `task` (general-purpose), без правок правил во время прогона.

## Что сгенерировано

Новые файлы:

- `challenge/src/core/tokenEstimator.ts`
- `challenge/src/core/tokenEstimator.test.ts`
- `web/app/api/tokens/estimate/route.ts`
- `web/test/unit/tokens-estimate-route.spec.ts`

Изменены:

- `challenge/src/core/index.ts` — экспорт `TokenEstimator` и типов;
- `web/lib/shared/forms.ts` — `tokenEstimateSchema`;
- `web/lib/server/challenge.ts` — экспорт через chokepoint.

Полный diff: `diff.patch`; исходники: `files/`.

## Объективная проверка

| Проверка | Команда | Результат |
|---|---|---|
| Typecheck challenge | `pnpm --filter challenge typecheck` | PASS |
| Typecheck web | `pnpm --filter web typecheck` | PASS |
| Тесты challenge | `pnpm --filter challenge test` | PASS, 101/101 (7 новых) |
| Тесты web | `vitest run test/unit/tokens-estimate-route.spec.ts` | PASS, 10/10 |
| Lint | — | **не настроен в репозитории** |
| Новые зависимости | `package.json` diff | нет |
| `any` / `console.log` / `process.env` | grep по diff | нет |
| Прямой core-импорт в client | grep по diff | нет (в route — chokepoint; в тесте — mock) |

## Соответствие стилю: что получилось хорошо

- Zod-валидация на границе Route Handler, 400 с `{ error }`.
- `server-only`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- Импорт core через `web/lib/server/challenge.ts`, а не напрямую.
- ESM-импорты `.js` в `challenge/`, `import type` для типов.
- Тесты в двух существующих раннерах: `node:test` и Vitest.
- Нет новых зависимостей, нет `any`, нет `console.log`.
- 10 route-тестов покрывают 200/400, границы бюджета, пустой диалог,
  не-JSON, enum, лимиты длины и количества.

## Отклонения от стиля проекта

| # | Наблюдение | Почему это отклонение | Что добавлено в v2 |
|---|---|---|---|
| 1 | `TokenEstimator` — класс только со `static`-методами | Для stateless-логики проект предпочитает функции; для сервиса с конфигом — instance-класс с инъекцией | §6.3–6.4, скилл `add-core-service` |
| 2 | Входы/выходы мутабельные: `ChatMessage[]`, `MessageEstimate[]`, поля без `readonly` | Контракты должны быть неизменяемыми, как `Demo` и `readonly`-поля в core | §6.1, §9.1 |
| 3 | Нет доменной проверки бюджета: `estimate(messages, -1)` принимается; валидация только в web | Core-сервис должен защищать свои инварианты независимо от UI | §6.5, скилл `add-core-service` |
| 4 | В `web/lib/server/challenge.ts` изменён несвязанный комментарий `P2b` → `P3b` | Нарушает surgical diff; ревьюер не должен видеть шум | §6.7, `.omp/RULES.md` |
| 5 | Успешный ответ — голый объект без `{ ok: true }` | Для action-endpoint v2 фиксирует единый конверт; существующие route'ы расходятся, поэтому правило введено явно | §9.2 |
| 6 | Тест мокает chokepoint, чтобы не тянуть тяжёлый core-граф | Допустимо (мок границы), но v2 уточняет: мокать только внешний I/O, не модуль под тестом | §9.4 |

## Вывод по генерации 1

Функционально задача решена: код компилируется, тесты проходят, границы
`web → core` соблюдены. Основные потери — не в работоспособности, а в
однозначности контрактов: мутабельность, форма сервиса, доменная валидация,
шум в diff и отсутствие зафиксированного конверта ответа.

Сильное влияние на результат оказал не v1-текст, а **чтение существующих
файлов** (`forms.ts`, `challenge.ts`, route-тесты). Там, где v1 молчал
(web-слой), ассистент восстановил конвенции по коду. Это и стало главным
аргументом за v2: явно описать то, что раньше приходилось угадывать.
