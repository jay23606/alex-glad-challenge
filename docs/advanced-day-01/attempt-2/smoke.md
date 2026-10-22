# Endpoint smoke — реальный сервер

```powershell
pnpm --filter web exec next start -H 127.0.0.1 -p 3100
```

Проверка через `fetch` (значения env не печатались):

```text
unauth 401 {"error":"unauthorized"}
login 200 {"ok":true}
auth 200 {"ok":true,"total":2,"messages":[{"index":0,"role":"user","bytes":5,"tokens":2}],"budget":10,"remaining":8,"fits":true}
```

Что подтверждено:

- middleware пропускает только аутентифицированный запрос (401 без cookie);
- login выдаёт `admin_session` (значение не логировалось);
- route возвращает контракт `{ ok, total, messages, budget, remaining, fits }`;
- `Cache-Control: no-store` (проверяется в unit-тесте);
- без бюджета `budget/remaining = null`, `fits = true` (unit-тест).
