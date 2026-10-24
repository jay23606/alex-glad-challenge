# ADVANCED Day 5 (продолжение) — Product loop: геймификация, ИИ-помощник, автоматизация, интеграции, Android

**Дата:** 2026-10-23. Исполнитель: агент (execution loop, профиль Бизнес-фича §13.3).
Пул: issues [#38–#50](https://github.com/tema1302/alex-glad-challenge/issues?q=milestone%3Arun-2026-10-23-product),
milestone `run-2026-10-23-product`.

## Что сделано

| Слой | Модули | Назначение |
|---|---|---|
| core | `workspaceDb` | проекты → папки → элементы, `listUpcoming` для календаря |
| core | `gamification` | XP (100·n²), уровни, серии, 8 достижений, журнал |
| core | `notifications` | центр уведомлений + DI-каналы |
| core | `automation` | расписание per blog, `runDue`/`runNow`, история |
| core | `calendar` + `googleCalendar` | ICS (RFC 5545) + Google Calendar OAuth |
| core | `webhooks` | исходящие webhook'и, HMAC-SHA256, таймаут |
| core | `inboundWebhooks` | входящие webhook'и: HMAC-приём событий (notification/todo) |
| core | `supportCenter` | FAQ-поиск по токенам + тикеты |
| core | `assistant` | снапшот → системный промпт ассистента |
| core tg | `botCommands`/`botAutomation`/`automationRun` | TG-команды `/уровень` `/блоги` `/авто`, XP за игры |
| web API | `/api/workspace/*` `/api/gamification` `/api/notifications` `/api/automation` `/api/calendar*` `/api/integrations/webhooks` `/api/integrations/inbound/*` `/api/support/*` `/api/assistant` `/api/mobile/bootstrap` | полный CRUD-контур продукта |
| web UI | `/projects` `/gamification` `/notifications` `/automation` `/calendar` `/support` `/assistant` `/integrations` | страницы + группа nav `product` + колокольчик с opt-in браузерными уведомлениями |
| web | тема | 4 палитры + system |
| web | мобильный доступ | `Bearer MOBILE_API_TOKEN` |
| web | планировщик автоматизации | instrumentation-тик 60 с, вкл. `AUTOMATION_ENABLED=1` |
| android | `android/` | Kotlin + Compose, реальные API |

## Проверки

- `pnpm --filter challenge typecheck` — ✅
- `pnpm --filter challenge test` — ✅ 196/196 (+29 новых: workspace/gamification/notifications/automation/calendar/webhooks/support/assistant)
- `pnpm --filter web typecheck` — ✅
- `pnpm --filter web test` — ✅ 262/262 (34 файла)
- `pnpm --filter web build` — страницы 48/48 генерируются; падает только на
  standalone-symlink (EPERM на Windows) — известное ограничение окружения, не код.

## Риски / допущения

- Google Calendar sync требует `GOOGLE_CALENDAR_*`; без них — честный `.ics`-экспорт
  и 503 на `/api/calendar/sync` (не hard-fail).
- Автоматизация выполняется, пока запущен web-процесс; внешнего cron нет
  (внутрипроцессное расписание через `nextRunAfter`; фоновый планировщик —
  `web/instrumentation.ts`, по умолчанию выключен, включается `AUTOMATION_ENABLED=1`).
- TG-бот «Медиум»: чат-память не изменена; добавлены публичная `/уровень` и owner-only
  `/блоги`/`/авто` (управление автоматизацией из TG — тот же голос блога через
  `automationRun`), XP за игры; публикация идёт через существующий `publishPost` (Bot API).
- Стиль Антонова задаётся пресетом блога (`blogs.style_preset`, seed «Иди на факты
  глянь» = `antonov`) и применяется в PostWriter на этапе генерации
  (`challenge/src/core/stylePreset.ts`) — один механизм для web-автоматизации,
  CLI news и TG `/авто run`; прежний веб-хак с повторной стилизацией готового
  поста удалён (#56). `STYLE_SYSTEM_PROMPT` остался только у независимых
  потребителей (`/style/rewrite`, `/antonov/*`, `auto-drafts --style`).

## Открытые вопросы

- Фоновый `runDue` реализован планировщиком в web-процессе (#53, тик 60 с,
  `web/instrumentation.ts`), по умолчанию выключен — включается `AUTOMATION_ENABLED=1`;
  ручной запуск и `runNow` работают без флага. Включать планировщик по умолчанию —
  решение владельца (влияет на idle-процесс Next).
- Android-сборка: JDK/Android SDK доступны, но фактическая компиляция зависит от
  установленного toolchain (см. `android/README.md`).

## Метрики прогона

`node scripts/loop-metrics.mjs --from 38 --to 50`:
закрыто 13/13, суммарно 29.9 мин, среднее 2.30 мин. #38 (29.47 мин — research +
core) был единственным с меткой `in-progress`; #39–#50 закрыты одним коммитом,
поэтому их интервалы — fallback «закрытие предыдущей» (~0.03 мин), а не реальное
время (параллельная/последовательная реализация внутри одного сеанса).
first-try 13/13, asked-user 0, iteration:2 0.

## Процесс-урок (по ревью владельца)

1. **Не было стадии Validation.** Профиль Бизнес-фича §13.3 требует граф
   `Research → Plan → Fix → Validation → Report`; стадия Validation (персоны
   `code-reviewer` + `test-engineer`) и финальный Report §13.7 не выполнялись —
   проверки шли ad-hoc (typecheck/tests/smoke) без персон и без маркеров
   `стадия X → Y`. Исправлено: sticky-инвариант в `.omp/RULES.md`.
2. **Эпики записаны плоскими задачами.** Крупные фичи (геймификация, автоматизация,
   Android) должны быть эпиками (`label epic`) → story-issues (`label story`).
   Исправлено: правило эпик→стори в `AGENTS.md` §13.9 + sticky в `.omp/RULES.md`.
3. **День нумерации:** это продолжение Day 5 (проверка execution loop), не новый
   Day 6. Лейбл `day-6` удалён, issues #38–#50 переведены на `day-5`, отчёт перенесён
   в `docs/advanced-day-05/`.
4. **Находки по ходу flow → issues:** #51–#54 (standalone-symlink EPERM, JDK-пререквизит,
   отсутствующий планировщик автоматизации, контракт levelProgress).
