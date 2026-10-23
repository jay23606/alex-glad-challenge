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
