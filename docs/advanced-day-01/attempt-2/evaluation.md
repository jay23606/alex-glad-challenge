# Генерация 2 — правила v2 (`AGENTS.md` + `.omp/RULES.md` + скиллы)

**Промпт:** тот же `docs/advanced-day-01/prompt.md`.
**Правила:** `config/AGENTS.v2.md`, `config/RULES.md`,
`config/skills/*`, `config/agents/*`.
**Исполнитель:** субагент `project-implementer` (project-scoped definition),
один промпт, без уточнений.

**Discovery:** субагент прочитал `AGENTS.md`, `.omp/RULES.md` и оба
`SKILL.md`; `skill://add-core-service` и `skill://add-web-endpoint` в
запущенной родительской сессии вернули `Unknown skill` (реестр построен до
создания файлов). Свежий `omp -p --no-tools` видит все три скилла:
`add-core-service, add-web-endpoint, project-validation`.

## Что сгенерировано

Новые файлы:

- `challenge/src/core/tokenEstimator.ts`
- `challenge/src/core/tokenEstimator.test.ts`
- `web/app/api/tokens/estimate/route.ts`
- `web/test/unit/tokens-estimate-route.spec.ts`

Изменены:

- `challenge/src/core/index.ts` — barrel-экспорт сервиса, константы и типов;
- `web/lib/server/challenge.ts` — экспорт через chokepoint;
- `web/lib/shared/forms.ts` — `tokenEstimateSchema`;
- `CHANGELOG.md` — запись о фиче (по §10 v2).

Артефакты:

- `diff.patch` — ровно то, что сгенерировано;
- `integration-fix.patch` — пост-генерационная правка теста (см. ниже);
- `final.diff.patch` — итоговый diff после правки;
- `files/` — сгенерированные файлы, `files-final/` — итоговые.

## Объективная проверка

| Проверка | Команда | Результат |
|---|---|---|
| Typecheck challenge | `pnpm --filter challenge typecheck` | PASS |
| Typecheck web | `pnpm --filter web typecheck` | PASS (в т.ч. после правки теста) |
| Тесты challenge | `pnpm --filter challenge test` | PASS, **105/105** |
| Тест нового route | `vitest run test/unit/tokens-estimate-route.spec.ts` | PASS, **10/10** (709 ms после мока границы) |
| Полный web suite | `vitest run --maxWorkers=2` | PASS, **28 files / 235 tests** |
| Полный web suite (default) | `pnpm --filter web test` | тесты проходят, но на этом Windows-хосте Vitest падает на старте 2 UI-воркеров (timeout), exit 1 |
| Smoke endpoint | `next start -p 3100` + login + fetch | **401** без cookie; **200** после login: `{ok:true,total:2,messages:[...],budget:10,remaining:8,fits:true}` |
| Lint | — | **не настроен** |
| Web build | `pnpm --filter web build` | compile + types + 40/40 pages PASS; затем EPERM symlink при standalone trace copy (Windows) |
| Новые зависимости | diff `package.json` | нет |
| `any` / `console.log` / `process.env` | grep | нет |
| Прямой core-импорт в client | grep | нет |

> Про default web suite: это не падение assertion'ов. Все 227/235 тестов,
> которые успели выполниться, зелёные; ошибка — `Timeout waiting for worker to
> respond` на старте воркеров UI-файлов. `--maxWorkers=2` стабильно зелёный.
> UI-тесты отдельно: 7 files / 31 tests PASS.

## Соответствие стилю: что улучшилось против генерации 1

| Аспект | Генерация 1 (v1) | Генерация 2 (v2) |
|---|---|---|
| Форма сервиса | класс только со `static` | instance-класс + `TokenEstimatorOptions` |
| Входы/выходы | мутабельные `ChatMessage[]`, поля без `readonly` | `readonly` входы, `readonly` поля, `readonly MessageEstimate[]` |
| Доменные инварианты | нет; `budget = -1` принимался | `RangeError` на `bytesPerToken <= 0` и `budget` нецелый/отрицательный |
| Успешный ответ | голый `{total, ...}` | `{ ok: true, ... }` |
| Ошибки route | 400 zod/не-JSON | 400 zod/RangeError + 500 fallback + `safeMessage` |
| Тесты core | 7 | 11 (кастомный делитель, конструктор, пустой вход, инвариант суммы) |
| Тесты web | 10, chokepoint замокан | 10, chokepoint замокан после integration-fix |
| Несвязанные правки | комментарий `P2b` → `P3b` | нет |
| CHANGELOG | нет | есть |
| Время генерации | ~12 мин | ~2 мин 42 с |

## Остаточные пробелы (кандидаты в v3)

1. **Лимит `content` не зафиксирован в правилах.** Gen2 выбрал 100 000
   символов, тогда как chat-схемы используют 8 000. Для budget-endpoint это
   может быть осознанно, но правило должно говорить: «зеркаль ближайший
   endpoint, если нет явного требования».
2. **500-ветка не покрыта тестом.** Route создаёт `new TokenEstimator()`
   внутри; чтобы проверить неожиданный сбой, нужна инъекция фабрики/сервиса.
   Это не требуется промптом, но для полноты error-mapping стоит добавить.
3. **Тест route изначально тянул весь chokepoint-баррель.** Это увеличило
   import-время (1.9 s против 0.7 s) и усилило давление на воркеры полного
   suite. Integration-fix мокает баррель до одного экспорта; правило v2
   дополнено явным разрешением такой boundary-моки.
4. **`pnpm --filter web test` без ограничения воркеров** нестабилен на этом
   Windows-хосте. В §10 добавлена команда `--maxWorkers=2` как fallback.
5. **Build standalone** упирается в Windows EPERM на symlink; это ограничение
   окружения, не кода. Для CI/Linux команда остаётся обязательной.

## Вывод

V2 убрал неоднозначность, которая в v1 оставалась на усмотрение модели:
иммутабельность, форма сервиса, доменная валидация, конверт ответа, границы
web→core, формат тестов и обязательный CHANGELOG. Функционально обе версии
рабочие; разница — в предсказуемости и ревьюируемости, а не в «компилируется /
не компилируется».
