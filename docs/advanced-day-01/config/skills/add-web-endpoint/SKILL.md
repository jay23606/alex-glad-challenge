---
name: add-web-endpoint
description: Add a Next.js Route Handler in web/app/api with server-only, zod validation, chokepoint imports, no-store caching, correct status codes, and a Vitest route test.
---

# Add a web endpoint

> **Historical (ADVANCED Day 1).** Superseded by `AGENTS.md` and
> `.omp/skills/agent-profiles/`. Do not follow this copy.

Use for any new `web/app/api/**/route.ts`.

## Steps

1. Read the closest route and its unit test:
   - `web/app/api/todos/route.ts` + `web/test/unit/...`
   - `web/app/api/settings/route.ts` (secrets/flags pattern)
2. Add the zod schema and exported input type to
   `web/lib/shared/forms.ts`. Validate type, length, enum, and numeric range.
3. If the route needs a core class/function, re-export it from
   `web/lib/server/challenge.ts` (the chokepoint). Do not import
   `@challenge/core/*` directly in the route.
4. Write the handler:
   - `import 'server-only';`
   - `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';`
   - `safeParse(await req.json().catch(() => ({})))`;
   - 400 with `{ error: firstIssue }`;
   - action success `{ ok: true, ... }`;
   - `Cache-Control: no-store` for dynamic data;
   - map upstream errors to 502/503; never leak secrets/URLs (`safeMessage`).
5. New `/api/*` routes are admin-gated by `web/middleware.ts` by default. Add to
   `PUBLIC_PATHS` only if the route is intentionally public.
6. Add `web/test/unit/<route>-route.spec.ts` with Vitest and `NextRequest`.
   Cover 200, 400 validation, boundary, and error mapping. Mock only external
   I/O (LLM, DB, network), not the module under test. If importing the route
   pulls the full `web/lib/server/challenge` barrel (heavy core graph), mock
   that barrel down to the one export the route needs; that is a boundary mock,
   not mocking the route.
7. Run `pnpm --filter web typecheck` and the scoped Vitest file.

## Response conventions

| Case | Status | Body |
|---|---|---|
| validation | 400 | `{ error: string }` |
| unauthorized | 401 | `{ error: 'unauthorized' }` |
| not found | 404 | `{ error: string }` |
| rate limit | 429 | `{ error, retryAfterSec }` + `Retry-After` |
| upstream failure | 502 | `{ error: safeMessage(...) }` |
| not configured | 503 | `{ error: string }` |
| success (action) | 200/201 | `{ ok: true, ... }` |
| success (read) | 200 | payload |

## Do not

- no `@challenge/core/*` import in `route.ts` (use chokepoint);
- no `process.env` in the route (use `lib/server/env.ts`);
- no client component importing the route or core;
- no `any`, no unhandled `req.json()` throw, no secret in errors.
