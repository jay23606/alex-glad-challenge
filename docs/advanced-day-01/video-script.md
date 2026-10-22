# Видео-сценарий (6–7 минут)

Все команды — из корня репозитория. Показывать реальные файлы и терминал, не
слайды.

## 0:00–0:40 — Задача

- ADVANCED Day 1: правила проекта + проверка одним промптом.
- Репозиторий: `challenge/` (CLI/core) + `web/` (Next.js).
- Проблема: старый `AGENTS.md` описывал только первые 10 дней и не знал про
  `web/`; ассистент угадывал конвенции.

## 0:40–2:00 — Правила v2

Показать:

```text
AGENTS.md
.omp/RULES.md
.omp/agents/project-implementer.md
.omp/agents/project-reviewer.md
.omp/skills/add-core-service/SKILL.md
.omp/skills/add-web-endpoint/SKILL.md
.omp/skills/project-validation/SKILL.md
~/.omp/agent/AGENTS.md
```

Акценты:

- глобальный конфиг vs локальный vs sticky `.omp/RULES.md`;
- почему нет `.omp/AGENTS.md` (затенил бы корневой);
- 5 хороших примеров, 5 антипаттернов, 4 шаблона;
- направление зависимостей `web → core`, chokepoint, `server-only`,
  `withDb`, zod, `safeMessage`.

## 2:00–2:40 — Боевой промпт

Показать `docs/advanced-day-01/prompt.md`. Подчеркнуть: один промпт, без
уточнений; проверяются core + web + два тест-раннера.

## 2:40–3:40 — Генерация 1 (v1)

- `docs/advanced-day-01/attempt-1/diff.patch`
- `attempt-1/evaluation.md`
- Терминал: `pnpm --filter challenge typecheck`, `pnpm --filter challenge test`.

Факты: PASS, 101/101, route 10/10; но static-класс, мутабельные контракты, нет
доменной валидации, несвязанная правка комментария, нет CHANGELOG.

## 3:40–5:00 — Генерация 2 (v2)

- `attempt-2/diff.patch` + `final.diff.patch`
- `attempt-2/evaluation.md`
- Diff'ы: `readonly`, instance-класс + options, `RangeError`, `{ok:true}`,
  `safeMessage`, CHANGELOG.

Терминал:

```powershell
pnpm --filter challenge typecheck
pnpm --filter challenge test
pnpm --filter web typecheck
pnpm --filter web exec vitest run test/unit/tokens-estimate-route.spec.ts
pnpm --filter web exec vitest run --maxWorkers=2
```

Smoke: `next start` → 401 без cookie, login → 200
`{ok:true,total:2,remaining:8,fits:true}`.

## 5:00–6:00 — Что повлияло

- шаблоны файлов;
- sticky-запреты;
- скилл `add-web-endpoint`;
- project-scoped субагент;
- обязательная валидация (и её ограничения).

## 6:00–6:40 — Честные ограничения

- lint не настроен;
- `vitest run` без `--maxWorkers=2` на Windows падает на старте воркеров;
- `next build` проходит compile/types/40 страниц, но standalone trace copy
  падает на EPERM symlink;
- остаточные пробелы v2: лимит `content`, 500-ветка, тяжёлый chokepoint-импорт
  (исправлен boundary-моком).

## 6:40–7:00 — Итог

- правила v2 лежат в репозитории;
- обе генерации воспроизводимы;
- итоговый код: core `TokenEstimator` + `POST /api/tokens/estimate` + тесты;
- артефакты: `docs/advanced-day-01/`.
