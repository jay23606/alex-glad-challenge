# Авторизация в web/ — как устроено

Источник фактов: `docs/advanced-day-02/research-run-01.md` (прогон профиля Research,
2026-10-23). Документ описывает текущее поведение, ничего не меняет.

## Механизм

Stateless HMAC-cookie сессия одного администратора, без серверного хранилища сессий:

```
admin_session = `${exp}.${hex(HMAC-SHA256(WEB_AUTH_SECRET, "admin:" + exp))}`
```

- Формат и проверки: `web/lib/auth.ts:7-8,50-55,58-71` (16 цифр exp, пересчёт HMAC,
  сравнение через timingSafeEqual по sha256-дайджестам). TTL 7 дней (`SESSION_MAX_AGE_S`).
- Пароль: `WEB_ADMIN_PASSWORD`, сравнение timing-safe (`web/lib/auth.ts:42-48`).
- Секреты читаются только в `web/lib/auth.ts` через `loadEnvUpward()`
  (`challenge/src/core/env.ts:12-27`); наружу — только Boolean-флаги
  (`isAdminAuthConfigured`), значения не покидают модуль.

## Два слоя проверки

1. **Middleware-гейт** — `web/middleware.ts:73-96` (runtime nodejs): cookie
   проверяется на каждом запросе, кроме точного allowlist `PUBLIC_PATHS`
   (`web/middleware.ts:27-46`, exact match pathname, без префиксов).
   Неавторизованным: страницы → `302 /login?next=<pathname>` (query отбрасывается),
   `/api/*` → `401 JSON`. Fail-closed: без `WEB_AUTH_SECRET` валидных сессий не бывает.
2. **Второй слой `requireAuth(req)`** — в роутах с внешними эффектами:
   `blog/digest/generate`, `blog/posts/[id]/publish`, `blogs/[slug]`, `rag/index-tg`,
   `rag/notes` (POST/DELETE/GET), `summary`, `telegram/publish`, `tg/collect`,
   `rag/index` (унифицировано 2026-10-23, issue #25). Защита от пропуска middleware
   (например, edge-кейс деплоя).

Для Server Components — `web/lib/server/session.ts` (`isAdminAuthed()` через `cookies()`).

## Компромиссы (осознанные)

- Отзыва сессий нет: украденная cookie живёт до `exp`; единственная инвалидация —
  смена `WEB_AUTH_SECRET`.
- Cookie без `secure` и без `__Host-`-префикса; CSRF — `sameSite=lax`, отдельных
  токенов нет; logout — POST (`web/app/api/auth/logout/route.ts:1-3`).
- Rate-limit логина глобальный (10 неудач/15 мин), не per-IP — сознательно
  (`web/app/api/auth/login/route.ts:6-10,25-42`): 10 неверных попыток блокируют
  вход владельцу, рестарт процесса сбрасывает счётчик.

## Inbound webhooks (публичный приём, HMAC вместо сессии)

`POST /api/integrations/inbound/[id]` — публичный эндпоинт, мутирующий данные
по HMAC-подписи вместо сессии: путь открыт в middleware (как и auth/demo/style-пути),
аутентификация — hex HMAC-SHA256 подпись сырого тела в `x-artel-signature`
(`web/app/api/integrations/inbound/[id]/route.ts`,
`verifySignature` в `challenge/src/core/webhooks.ts`).

**Секрет хука хранится в SQLite открытым текстом** — осознанный компромисс, как у
всех webhook-провайдеров (GitHub, Stripe): HMAC-верификация требует пересчёта
подписи тем же секретом, хеширование (даже с солью/KDF) сломало бы проверку.
Митигируется окружением: локальная loopback-БД, каталог `.data/` вне git, секрет
показывается один раз при создании хука, `GET` списка секретов не возвращает
(`web/app/api/integrations/inbound/route.ts`). Секреты не логируются и не эхоятся.

**Злоупотребление публичным путём ограничено rate-limit'ом** (issue #62): глобальный
in-memory fixed-window, 30 неудачных попыток приёма (401/404/400) за 5 минут →
`429` + `Retry-After` до конца окна; успешная подпись (доказательство владения
секретом) счётчик сбрасывает. Тот же паттерн и допущения, что у rate-limit логина
(`web/app/api/auth/login/route.ts`): глобальный, не per-IP (XFF за прокси
подделываем), состояние в `globalThis`, сбрасывается рестартом.

Рекомендации владельцу:

- не переиспользовать секреты из других систем — генерировать хук через UI/API;
- ротация = удаление хука + создание нового (`DELETE` под session-auth, нового
  секрета нет по умолчанию);
- неиспользуемые хуки удалять: каждый живой хук — действующий публичный путь;
- при подозрении на утечку секрета — немедленно удалить хук (старые подписи
  перестают приниматься сразу).

Проверка: unit `web/test/unit/inbound-webhooks-route.spec.ts` (в т.ч. describe
«rate-limit POST …»: 31-я неудача → 429, окно истекло → снова 401, успех сбрасывает).

## Открытые вопросы (решение за владельцем)

1. Нужен ли отзыв сессий (version/epoch в секрете или server-side реестр)?
2. Ставить ли `secure`/`__Host-` — зависит от гарантий reverse-proxy (TLS терминируется
   снаружи, конфиг в репозитории отсутствует).
3. Минимальная длина `WEB_ADMIN_PASSWORD` (сейчас — только непустота,
   `web/lib/shared/forms.ts:327-330`).
4. Глобальный rate-limit: блокировка владельца 10 запросами — приемлемо?
5. Шапка-комментарий middleware актуализирована (#24); держать синхронным.

## Проверка

- E2E: `web/e2e/auth.spec.ts` (гостевой гейт, неверный пароль, вход/логаут).
- Unit: 401 второго слоя — `digest-generate.spec.ts:116-128`, `route-publish.spec.ts:54-64`,
  `rag-notes-route.spec.ts:81-85`, `rag-index-route.spec.ts` (новый, issue #25).
