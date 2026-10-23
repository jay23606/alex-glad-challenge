# Execution Loop — handoff для следующей сессии

> Задание для будущей нейросети: пройти execution loop **правильно**, по бизнес-профилям
> и с обязательным следованием flow. Читать вместе с `AGENTS.md` §13 (профили) и
> `.omp/RULES.md` (sticky-инварианты). Этот файл — мост между сессиями.

## 0. Текущее состояние репозитория (2026-10-23, конец прошлой сессии)

- Ветка `feat/product-loop` (НЕ смержена, НЕ запушена). Коммиты:
  - `918f9b9` — product-фичи (геймификация, ассистент, автоматизация, интеграции, Android)
  - `81a5690` — метрики прогона + открытые вопросы
  - `b84ab1a` — процесс: эпик→стори, обязательная Validation, day-5 (не 6), находки→issues
  - `29fc399` — процесс: профиль выбирает ассистент сам и следует стадиям строго (§13.1)
- **В рабочем дереве есть незакоммиченные изменения НЕ из прошлой сессии** (см. `git status`):
  - `challenge/src/core/stylePreset.ts` (новый) + `style_preset` в `BlogRow`/`db.ts`/`postWriter.ts`/
    `web/app/api/blogs/*` — пресет Антонова на уровне `PostWriter`. **Пересекается** с моим
    хаком `web/lib/server/automation-service.ts::applyAntonovStyle`. Их нужно примирить
    (ожидаемо: убрать `applyAntonovStyle`, полагаться на `style_preset`).
  - Полировка `android/**` (после моей сборки) и правки части моих файлов
    (`web/app/automation/page.tsx`, `integrations/page.tsx`, `NotificationBell.tsx`,
    `middleware.ts`, `forms.ts`, `db.ts`, `challenge.ts`).
  - НЕ трогать вслепую: сначала `git diff`, понять, чьё это и зачем.

## 1. Метрики последней фазы (13 задач, issues #38–#50)

`node scripts/loop-metrics.mjs --from 38 --to 50`:

```
repo: tema1302/alex-glad-challenge | issues: 13 | starts: in-progress 1, fallback 12
| 38 | P1 | 29.47 мин | (единственная с меткой in-progress: research + core)
| 39–50 | P1/P2/P3 | ~0.03 мин каждый | (fallback «закрытие предыдущей»)
closed: 13 | total: 29.9 мин | mean: 2.30 | median: 0.03
instrumented: 13/13 (loop-run) | first-try: 13/13 (100%) | asked-user: 0 | causes: n/a
```

**Честная интерпретация (обязательна для будущей сессии):**
- `total 29.9 мин` — реальный wall-clock только для #38 (research+core). #39–#50 были
  сделаны внутри одного сеанса и закрыты одним батчем → их ~0.03 мин — это **артефакт
  измерения**, а не реальное время.
- `first-try 13/13 (100%)` — **недостоверно**: я не ставил `iteration:2`+`cause:*` на
  реальные провалы (ошибки typecheck/тестов, которые правил вручную). Это завышение.
- **Правильная инструментация (делать в новой сессии):** на каждую issue при старте —
  метка `in-progress`; при провале первой попытки — `iteration:2` + ровно один `cause:*`
  (`cause:context`/`cause:code`/`cause:loop`/`cause:test`/`cause:premise`); при остановке
  с вопросом — `asked-user`. Метрика без меток не существует.

## 2. Что уже сделано (не переделывать)

- Core: `workspaceDb`, `gamification`, `notifications`, `automation`, `calendar`+`googleCalendar`,
  `webhooks`, `supportCenter`, `assistant` (+ тесты, challenge 196/196).
- Web: API `/api/{workspace,gamification,notifications,automation,calendar,integrations,support,assistant,mobile}/*`,
  страницы `/projects /gamification /notifications /automation /calendar /support /assistant /integrations`,
  тема (4 палитры + system), колокольчик, `Bearer MOBILE_API_TOKEN`.
- Android: `android/` (Kotlin + Compose), `:app:assembleDebug` собирается (APK ~18 МБ).
- Рефакторинг: `web/lib/server/db.ts` (реестр singleton), `web/lib/server/http.ts`.

## 3. Процесс — ОБЯЗАТЕЛЬНО соблюдать (исправлено после ревью владельца)

1. **Профиль выбирает ассистент сам** (`AGENTS.md` §13.1): по триггерам → объявляет одной
   строкой `профиль: <Имя>` → следует стадиям **СТРОГО**. `ask` — только при реальной
   неоднозначности, иначе консервативный выбор без вопросов.
2. **Граф стадий обязателен** (`§13.2`): `Research → Plan → Fix → Validation → Report`.
   - Orchestrator НЕ пишет код: чтение → `scout`, правки → `task`, ревью → персоны §12.
   - Перед сменой стадии — строка `стадия X → Y`.
   - **Validation** = персоны `code-reviewer` + `test-engineer` (не ad-hoc typecheck).
   - **Report** = шаблон §13.7. Пропуск стадии = дефект процесса, фиксируется, не замалчивается.
3. **Крупная фича = эпик** (`§13.9`): `label epic` (tracking-issue с чеклистом) → story-issues
   (`label story`, тот же milestone, `loop-run`). Эпик не закрывается, пока не закрыты все стори.
4. **Находки по ходу flow → issues** сразу (баг/недоразумение), не «чинить заодно»,
   приоритет `P0–P3` по §13.9.
5. **§10 на каждую задачу** + `Closes #N` + `loop-metrics` в финале.

## 4. Открытые задачи (взять в работу по flow)

### Эпик A — «Довести product-фичи до прода»
Стори:
- **#51** `bug P3` — web build падает на standalone-symlink (EPERM) под Windows.
- **#52** `chore P3` — Android-сборка требует JDK (отсутствует на машине): задокументировать пререквизит + setup-скрипт.
- **#53** `feature P2` — постоянный планировщик `runDue` в web-процессе (Next instrumentation + env-флаг `AUTOMATION_ENABLED`), корректный shutdown.
- **#54** `docs P3` — контракт `levelProgress`: доля 0..1 (не процент), зафиксировать в `/api/gamification` и `/api/mobile/bootstrap`.

### Эпик B — «Примирить stylePreset и автоматизацию»
- Незакоммиченный `stylePreset.ts` (пресет Антонова на уровне `PostWriter`) конфликтует по
  смыслу с `automation-service.ts::applyAntonovStyle`. Стори: разобрать diff → выбрать один
  механизм (ожидаемо `style_preset`) → удалить дубль → тесты + Validation.

### Эпик C — «Довести прошлую ветку до merge»
- `feat/product-loop` не смержена: после зелёного §10 — merge в `main` (по запросу владельца),
  разобрать незакоммиченные изменения рабочего дерева (кому принадлежат).

## 5. Команды валидации (AGENTS.md §10)

```powershell
pnpm --filter challenge typecheck
pnpm --filter challenge test          # node:test, все core-тесты
pnpm --filter web typecheck
pnpm --filter web test               # Vitest; при падении воркеров: --maxWorkers=2
pnpm --filter web build              # при изменении web-сборки/границ
```

- Lint не настроен — не вызывать и не добавлять.
- Smoke обязателен: CLI — реальный запуск; endpoint — `NextRequest`-тест или curl к 127.0.0.1;
  UI — реальная страница; Android — `gradlew.bat :app:assembleDebug` (JDK/SDK — см. `android/README.md`).
- CHANGELOG: запись на продуктовую фичу (что/зачем/коды/риски).

## 6. Чего НЕ делать (ошибки прошлой сессии)

- Не пропускать стадии Validation и Report (главный дефект прошлого прогона).
- Не писать код без стадии Plan и без маркеров `стадия X → Y`.
- Не записывать крупные фичи плоскими задачами — только эпик→стори.
- Не «чинить заодно» находки — issues + приоритет.
- Не считать метрики достоверными без корректных меток (`in-progress`/`iteration:2`+`cause:*`/`asked-user`).

## 7. Критерий «сделано правильно»

- Каждая стори: `in-progress` → `Closes #N`, §10 зелёный, Validation персон, Report §13.7.
- `node scripts/loop-metrics.mjs --from 51 --to 54` показывает реальные интервалы и достоверный first-try.
- Все незакоммиченные изменения рабочего дерева разобраны (закоммичены или явно отложены владельцу).
- `feat/product-loop` смержена после подтверждения владельца.

ОБЯЗАТЕЛЬНО ПРОЙТИСЬ E2E тестами по приложению, которое ты посмотришь, и оценить дизайн. Если не понравится - ставим задачу в Issue, доделываем свою задачу, а потом переключаемся на эти таски из Issue.
