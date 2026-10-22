# ADVANCED Day 1 — Rules

Правила проекта v2 + проверка на боевой задаче двумя генерациями.

## Задание

1. Проанализировать проект и создать файл правил (`.cursorrules` / `AGENTS.md`):
   стек, архитектура, структура папок, naming conventions, паттерны.
2. Использовать глобальный конфиг, локальный конфиг, субагентов и скиллы.
3. Включить 3–5 примеров хорошего кода, 3–5 антипаттернов и шаблон типичного
   файла.
4. Проверить на боевой задаче одним промптом без уточнений: новый endpoint /
   компонент / сервис; оценить compile / lint / стиль.
5. Усилить правила по результатам, повторить тот же промпт, зафиксировать
   разницу.
6. Результат: правила v2 + диффы двух генераций + список факторов качества.

## Что сделано

### Правила

| Слой | Файл | Назначение |
|---|---|---|
| Глобальный | `~/.omp/agent/AGENTS.md` | общие правила для всех проектов; проект побеждает |
| Локальный | `AGENTS.md` | канонические правила репозитория (v2) |
| Sticky | `.omp/RULES.md` | короткие жёсткие инварианты на всю сессию |
| Субагенты | `.omp/agents/project-implementer.md`, `project-reviewer.md` | реализация и read-only ревью |
| Скиллы | `.omp/skills/add-core-service`, `add-web-endpoint`, `project-validation` | пошаговые чеклисты |

Копии для аудита: [`config/`](config/).

Почему нет `.omp/AGENTS.md`: native-провайдер `omp` отдал бы ему приоритет и
затенил корневой `AGENTS.md`. Два канонических файла — хуже одного.

Проверка discovery: свежий `omp -p --no-tools` перечисляет
`add-core-service, add-web-endpoint, project-validation`. В уже запущенной
сессии реестр скиллов был построен до создания файлов, поэтому Gen2 прочитал
`SKILL.md` по пути; новый сеанс резолвит их через `skill://`.

### Боевая задача

Один промпт ([`prompt.md`](prompt.md)):

> Добавь в проект оценку токенов: core-сервис `TokenEstimator` и веб-endpoint
> `POST /api/tokens/estimate`… Покрой сервис и endpoint тестами.

Это проверяет сразу три слоя: `challenge/src/core`, `web/app/api` и два
тест-раннера. Промпт намеренно не подсказывает `server-only`, chokepoint,
zod, `.js`-импорты и `readonly` — это должно прийти из правил.

### Две генерации

| | Gen1 | Gen2 |
|---|---|---|
| Правила | [`AGENTS.v1.md`](AGENTS.v1.md) | [`config/AGENTS.v2.md`](config/AGENTS.v2.md) + `.omp` |
| Исполнитель | `task` | `project-implementer` |
| Diff | [`attempt-1/diff.patch`](attempt-1/diff.patch) | [`attempt-2/diff.patch`](attempt-2/diff.patch) |
| Оценка | [`attempt-1/evaluation.md`](attempt-1/evaluation.md) | [`attempt-2/evaluation.md`](attempt-2/evaluation.md) |
| Итоговый diff | — | [`attempt-2/final.diff.patch`](attempt-2/final.diff.patch) |

Сравнение и факторы качества: [`comparison.md`](comparison.md).

## Результаты

| Проверка | Gen1 | Gen2 |
|---|---|---|
| `challenge` typecheck | PASS | PASS |
| `web` typecheck | PASS | PASS |
| `challenge` tests | 101/101 | 105/105 |
| Route tests | 10/10 | 10/10 |
| Endpoint smoke | не запускался | 401 без cookie; 200 после login (`{ok:true,total:2,...}`) |
| Lint | не настроен | не настроен |
| Web build | не запускался | compile + types + 40/40 pages PASS; trace copy EPERM (Windows) |

Gen1 был функционально рабочим. Gen2 дал предсказуемость: `readonly`,
instance-сервис с options, доменные `RangeError`, `{ ok: true }`,
`safeMessage`, CHANGELOG и отсутствие несвязанных правок. Время генерации:
~12 мин → ~2 мин 42 с.

## Что больше всего повлияло

1. Шаблоны файлов (§9) — дали конкретную форму кода.
2. Sticky `.omp/RULES.md` — запреты сработали до ревью.
3. Скилл `add-web-endpoint` — последовательность schema → chokepoint → route →
   test.
4. Project-scoped субагент — фокус и скорость.
5. Раздел валидации — CHANGELOG и честные границы; но полный suite всё равно
   обязателен.

## Воспроизведение

```powershell
pnpm --filter challenge typecheck
pnpm --filter challenge test

pnpm --filter web typecheck
pnpm --filter web exec vitest run test/unit/tokens-estimate-route.spec.ts
pnpm --filter web exec vitest run --maxWorkers=2
pnpm --filter web build
```

## Ограничения

- **Lint не настроен.** Оценка «прошло линтер» заменена на typecheck + тесты +
  grep-чеклист (`any`, `console.log`, секреты, прямой core-импорт).
- **Полный web suite без ограничения воркеров** на этом Windows-хосте падает
  на старте 2 UI-воркеров (`Timeout waiting for worker to respond`), при этом
  все выполненные тесты зелёные. `--maxWorkers=2` стабилен: 28 files / 235
  tests.
- **`next build`** проходит compile/typecheck/static pages, затем падает на
  EPERM symlink при копировании standalone trace. Это ограничение Windows,
  не кода; на Linux/CI проверять отдельно.
- **Остаточные пробелы v2:** лимит `content` (8k vs 100k) не зафиксирован;
  500-ветка route не покрыта тестом; тест route изначально тянул весь
  chokepoint-баррель (исправлено integration-fix'ом). Кандидаты в v3.
