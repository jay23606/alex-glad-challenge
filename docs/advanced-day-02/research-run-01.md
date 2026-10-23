# Прогон профиля Research (AGENTS.md §13.5) — вопрос № 01

- **Дата:** 2026-10-23
- **Вопрос:** «Как у нас устроена авторизация в web?»
- **Агент:** omp `scout` (read-only), один прогон, ~2 мин.
- **Вердикт:** ✅ прошёл с первого раза; формат §13.5 соблюдён полностью.
- **Формат ответа:** краткий ответ → файлы (path:lines + роль) → связи → выводы → открытые вопросы → что не проверено.

---

## Ответ (полный payload скаута, без редактирования)

```json
{
  "shortAnswer": "Авторизация web/ — stateless cookie-сессия одного админа: admin_session = ${exp}.${HMAC-SHA256(WEB_AUTH_SECRET, \"admin:\"+exp)}, TTL 7 дней, проверяется в middleware.ts на все пути, кроме точного allowlist PUBLIC_PATHS, а также повторно в 9 Route Handler'ах через requireAuth. Пароль (WEB_ADMIN_PASSWORD) сравнивается timing-safe в POST /api/auth/login, секрет читается только из process.env, загруженного из корневого .env через loadEnvUpward(). Webhook-приёмника в web/ нет вообще: публичность задаётся только явным списком путей, а не подписью вебхука.",
  "files": [
    { "path": "web/lib/auth.ts", "lines": "1-81", "role": "Auth-ядро: константы cookie/TTL (19-21), чтение WEB_AUTH_SECRET (23-26), isAdminAuthConfigured (29-32), timingSafeEq по sha256 (34-40), verifyAdminPassword (42-48), createSessionValue (50-55), isValidSession (58-71), requireAuth (74-81); top-level loadEnvUpward() (15-17)" },
    { "path": "web/middleware.ts", "lines": "1-117", "role": "Первый слой: CSP+nonce (47-71), PUBLIC_PATHS exact-match (25-45), гейт isValidSession (73-96): страницы → 302 /login?next=, /api/* → 401 JSON; matcher (102-117)" },
    { "path": "web/lib/server/session.ts", "lines": "1-11", "role": "server-only обёртка для Server Components: cookies() → isValidSession (isAdminAuthed)" },
    { "path": "web/app/api/auth/login/route.ts", "lines": "1-93", "role": "POST /api/auth/login: in-memory rate-limit 10/15мин (25-42), zod loginSchema (52), fail-closed 503 (61-71), timing-safe пароль (73-77), выдача cookie httpOnly/sameSite=lax (85-92)" },
    { "path": "web/app/api/auth/logout/route.ts", "lines": "1-21", "role": "обнуление cookie (maxAge:0), серверного реестра сессий нет" },
    { "path": "web/app/login/page.tsx", "lines": "1-51", "role": "Публичная страница входа: санитизация next против open-redirect (13-19), уже авторизован → /dashboard (27), graceful-блок без env (35-47)" },
    { "path": "web/app/login/LoginForm.tsx", "lines": "1-40", "role": "Клиентская форма: fetch POST /api/auth/login (23-26)" },
    { "path": "web/app/components/LogoutButton.tsx", "lines": "1-25", "role": "fetch POST /api/auth/logout (15)" },
    { "path": "web/app/layout.tsx", "lines": "56-57", "role": "читает x-nonce и isAdminAuthed() — признак админа в хром/Nav" },
    { "path": "web/app/page.tsx", "lines": "126-127,166-198", "role": "Публичный лендинг: гость — «Войти», админ — ссылка в дашборд" },
    { "path": "web/app/components/Nav.tsx", "lines": "13-14,30-48", "role": "Хром по флагу isAdmin" },
    { "path": "challenge/src/core/env.ts", "lines": "12-27", "role": "loadEnvUpward(): поиск .env вверх от cwd до 6 уровней" },
    { "path": "web/lib/server/env.ts", "lines": "1-20,126-129", "role": "Второй загрузчик env для web; ре-экспорт isAdminAuthConfigured" },
    { "path": "web/lib/shared/forms.ts", "lines": "327-330", "role": "loginSchema: password min 1, max 200" },
    { "path": "web/app/api/blog/digest/generate/route.ts", "lines": "75-79", "role": "Второй слой requireAuth (деструктивный/LLM-роут)" },
    { "path": "web/app/api/telegram/publish/route.ts", "lines": "18-25", "role": "requireAuth + rate-limit по sha256 от cookie" },
    { "path": "web/app/api/rag/notes/route.ts", "lines": "36-38,100-102,124-126", "role": "requireAuth на POST/DELETE/GET" },
    { "path": "web/app/api/blog/pipeline/route.ts", "lines": "68-113", "role": "Публичный API: гостю эфемерный sandbox" },
    { "path": "web/app/api/rag/index/route.ts", "lines": "1-28", "role": "Разрушительный SSE-роут БЕЗ requireAuth — только middleware-гейт" },
    { "path": ".env.example", "lines": "104-113", "role": "Документация WEB_ADMIN_PASSWORD+WEB_AUTH_SECRET, секрет ≥32 символов" },
    { "path": ".gitignore", "lines": "7-10", "role": ".env/.env.* игнорируются" },
    { "path": "docs/TZ-WEB-REDESIGN.md", "lines": "45-47", "role": "ТЗ фиксирует PUBLIC_PATHS, HMAC-cookie, requireAuth" },
    { "path": "web/e2e/auth.spec.ts", "lines": "1-40", "role": "E2E: гейт/логин/логаут/eye-toggle" },
    { "path": "web/e2e/helpers.ts", "lines": "8-25", "role": "E2E-логин паролем из .env или E2E_ADMIN_PASSWORD" },
    { "path": "web/test/unit/digest-generate.spec.ts", "lines": "116-128", "role": "Unit: без/с невалидной cookie → 401" },
    { "path": "web/test/unit/route-publish.spec.ts", "lines": "54-64", "role": "Unit: requireAuth защищает публикацию" },
    { "path": "web/test/unit/rag-notes-route.spec.ts", "lines": "81-85,171-175,195-199", "role": "Unit: 401 на POST/DELETE/GET" }
  ],
  "links": [
    { "from": "web/middleware.ts", "to": "web/lib/auth.ts", "via": "import { SESSION_COOKIE, isValidSession } (19), вызов (74)" },
    { "from": "web/lib/auth.ts", "to": "challenge/src/core/env.ts", "via": "import { loadEnvUpward } (15) + top-level вызов (17)" },
    { "from": "web/lib/server/session.ts", "to": "web/lib/auth.ts", "via": "import { isValidSession, SESSION_COOKIE } (6)" },
    { "from": "web/app/layout.tsx", "to": "web/lib/server/session.ts", "via": "import isAdminAuthed (18), вызов (57)" },
    { "from": "web/app/page.tsx", "to": "web/lib/server/session.ts", "via": "import (52), вызов (127)" },
    { "from": "web/app/login/page.tsx", "to": "web/lib/auth.ts", "via": "import isAdminAuthConfigured (7)" },
    { "from": "web/app/login/page.tsx", "to": "web/lib/server/session.ts", "via": "import isAdminAuthed (8), вызов (27)" },
    { "from": "web/app/api/auth/login/route.ts", "to": "web/lib/auth.ts", "via": "SESSION_COOKIE/SESSION_MAX_AGE_S/createSessionValue/isAdminAuthConfigured/verifyAdminPassword (15-20)" },
    { "from": "web/app/api/auth/login/route.ts", "to": "web/lib/shared/forms.ts", "via": "loginSchema (13, 52)" },
    { "from": "web/app/api/auth/logout/route.ts", "to": "web/lib/auth.ts", "via": "SESSION_COOKIE (7, 14)" },
    { "from": "web/app/api/blog/digest/generate/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth (18, 78)" },
    { "from": "web/app/api/blog/posts/[id]/publish/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth (9, 19)" },
    { "from": "web/app/api/blogs/[slug]/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth (9, 20)" },
    { "from": "web/app/api/rag/index-tg/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth (12, 19)" },
    { "from": "web/app/api/rag/notes/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth (17; вызовы 37, 101, 125)" },
    { "from": "web/app/api/summary/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth (12, 24)" },
    { "from": "web/app/api/telegram/publish/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth + SESSION_COOKIE (10; вызовы 19, 23)" },
    { "from": "web/app/api/tg/collect/route.ts", "to": "web/lib/auth.ts", "via": "requireAuth (14, 21)" },
    { "from": "web/app/api/blog/pipeline/route.ts", "to": "web/lib/auth.ts", "via": "SESSION_COOKIE, isValidSession (21; 69, 78) — sandbox для гостя" },
    { "from": "web/lib/server/env.ts", "to": "web/lib/auth.ts", "via": "ре-экспорт isAdminAuthConfigured (129)" },
    { "from": "web/app/login/LoginForm.tsx", "to": "web/app/api/auth/login/route.ts", "via": "HTTP fetch POST (23)" },
    { "from": "web/app/components/LogoutButton.tsx", "to": "web/app/api/auth/logout/route.ts", "via": "HTTP fetch POST (15)" },
    { "from": "web/app/login/LoginForm.tsx", "to": "web/app/login/page.tsx", "via": "рендерится страницей (36)" },
    { "from": "web/app/components/Nav.tsx", "to": "web/app/components/LogoutButton.tsx", "via": "import (10), рендер при isAdmin (48)" },
    { "from": "web/app/layout.tsx", "to": "web/app/components/Nav.tsx", "via": "isAdmin передаётся в хром (56-57)" }
  ],
  "conclusions": [
    "1. Механизм: stateless HMAC-cookie без серверного хранилища сессий (auth.ts:7-8, 50-55, 58-71). Следствия: логаут только чистит cookie — украденная живёт до exp; смена секрета инвалидирует все сессии; отзыва по одной нет.",
    "2. Гейт: middleware (nodejs runtime, 21) проверяет cookie на всех путях кроме exact PUBLIC_PATHS (25-45); страницы → 302 /login?next=, /api/* → 401 JSON. Fail-closed: без секрета isValidSession всегда false (58-61); без env /login показывает конфиг-блок, логин отдаёт 503 (61-71).",
    "3. Публичные пути — exact match, без префиксов (25-45). Шапка middleware (12-14) устарела: перечисляет не весь список. Публичные LLM-роуты имеют собственный двойной rate-limit.",
    "4. Второй слой requireAuth — в 9 файлах; остальные API (в т.ч. разрушительный /api/rag/index, /api/settings, /api/mcp/call, /api/chat/*) защищены только middleware. Схема «middleware первый + requireAuth на внешних эффектах» непоследовательна: index-tg получил второй слой, index — нет.",
    "5. Пароль: единственный админ, timing-safe (42-48); rate-limit глобальный fixed-window 10/15мин, не per-IP (сознательно, комментарий 6-10) — 10 неверных попыток блокируют владельца, рестарт сбрасывает счётчик.",
    "6. Секрет: корневой .env (в .gitignore), загрузка loadEnvUpward() (core/env.ts:12-27), top-level side effect auth.ts:17. Наружу только Boolean-флаги и имена переменных (28-47).",
    "7. Webhook-механизма в web/ нет: публичность — только через явное добавление в PUBLIC_PATHS.",
    "8. Клиент не доверяет cookie: layout/page читают сессию серверно; open-redirect закрыт санитизацией next (13-19).",
    "9. Cookie без `secure` и без `__Host-`-префикса; CSRF — sameSite=lax, отдельных токенов нет; logout — POST.",
    "10. Тесты: e2e — страничный гейт/логин/логаут; middleware unit-тестом не покрыт (явно сказано в antonov-*.spec.ts:7); матрица «какие API публичны» автотестами не зафиксирована."
  ],
  "openQuestions": [
    "Должен ли /api/rag/index получить requireAuth по аналогии с /api/rag/index-tg?",
    "Нужен ли отзыв сессий (сейчас — только смена WEB_AUTH_SECRET)?",
    "Ставить ли secure + __Host- префикс (зависит от гарантий reverse-proxy)?",
    "Нужна ли минимальная длина WEB_ADMIN_PASSWORD?",
    "Осознанно ли глобальный (не per-IP) лимит логина?",
    "Актуален ли комментарий middleware:12-14?"
  ],
  "unchecked": [
    "Корневой .env не читался (read-only + секреты).",
    "Ничего не запускалось: поведение middleware не проверялось живым сервером.",
    "Конфиг reverse-proxy в репозитории не найден.",
    "Часть маршрутов читалась через grep заголовков, не целиком.",
    "Полный список API собран glob'ом (48 route.ts); отсутствие requireAuth подтверждено grep'ом.",
    "Влияние CSP/nonce на auth не анализировалось."
  ]
}
```

## Оценка прогона против контракта §13.5

| Требование профиля | Факт |
|---|---|
| Краткий ответ 2–3 предложения | ✅ |
| Файлы path:line + роль | ✅ 26 файлов с диапазонами строк |
| Связи кто-на-кого | ✅ 25 связей с via |
| Выводы | ✅ 10, каждое с file:line |
| Открытые вопросы / не проверено | ✅ 6 + 6, включая честное «.env не читался» |
| Только чтение, без сети | ✅ |
