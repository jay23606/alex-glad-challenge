# API-контракты web/

Реестр внешних контрактов HTTP API (`web/app/api/*`). Описывает текущее
поведение сервера; источник фактов — код (`challenge/src/core/*` + роуты).
При изменении контракта этот файл обновляется в том же коммите.

Ответы завёрнуты в общий конверт `jsonOk` (`{ ok: true, ... }`,
`web/lib/server/http.ts`); ошибки — через `requireApiAuth` / `withDb`.

## Геймификация: `stats`

Источник: `challenge/src/core/gamification.ts` — интерфейс `GamificationStats`
и `GamificationDb.getStats()`. Оба endpoint'а отдают поля **без преобразования**:

- `GET /api/gamification` → `stats` (`web/app/api/gamification/route.ts`);
- `GET /api/mobile/bootstrap` → `gamification.*` (`web/app/api/mobile/bootstrap/route.ts`;
  там же `achievements` — проекция `{ code, title, description, unlocked }`, без `unlockedAt`).

| Поле | Тип | Семантика |
|---|---|---|
| `xp` | `number` | Накопленный XP; только растёт. |
| `level` | `number` | Текущий уровень: `levelForXp(xp) = floor(sqrt(xp / 100)) + 1`. |
| `levelProgress` | `number` | **ДОЛЯ 0..1** прогресса внутри текущего уровня к следующему. НЕ процент и НЕ 0..100: клиент умножает на 100 сам. |
| `nextLevelXp` | `number` | **АБСОЛЮТНЫЙ XP-порог** следующего уровня: `xpForLevel(level) = 100·level²`. НЕ «сколько осталось» — остаток считается как `nextLevelXp − xp`. |
| `streak` | `number` | Текущая серия дней с активностью; сбрасывается после пропуска дня. |
| `bestStreak` | `number` | Лучшая серия за всё время. |

### Формулы и пример

```
xpForLevel(n) = 100·n²
levelProgress = (xp − xpForLevel(level − 1)) / (xpForLevel(level) − xpForLevel(level − 1))
```

Пример: `xp = 250` → `level = 2`, `levelProgress = (250 − 100) / (400 − 100) = 0.5`,
`nextLevelXp = 400`, до следующего уровня осталось `400 − 250 = 150` XP.

Границы: `levelProgress ∈ [0, 1)` для любого XP; `0` — только в точке
`xp = 100·n²` (ровно порог уровня: level-up). `award()` и `getStats()` используют
одну формулу (общий приватный helper `buildStats`), поэтому `award().stats`
всегда идентичен `getStats()`. Тест-инвариант: `0 <= levelProgress <= 1`
(`challenge/src/core/gamification.test.ts:44`).

### Потребители (обязаны трактовать как долю 0..1)

| Потребитель | Использование |
|---|---|
| Web UI `/gamification` | `web/app/gamification/page.tsx` — `Math.round(levelProgress * 100)` для процентов. |
| Android дашборд | `android/.../ui/screens/dashboard/DashboardScreen.kt` — Double-доля, `coerceIn(0f, 1f)`; контракт в `data/api/ApiModels.kt` (трактовка «доля» закреплена issue #61). |
| TG-бот | `challenge/src/core/tg/bot.ts` — `Math.round(levelProgress * 100)` в сообщении статуса. |

## Проверка

- Инвариант доли: `pnpm --filter challenge test` (`gamification.test.ts`).
- Типы роутов: `pnpm --filter web typecheck`.
