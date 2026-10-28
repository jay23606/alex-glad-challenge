# Hard rules (sticky)

> **Historical (ADVANCED Day 1).** Superseded by `.omp/RULES.md` and `AGENTS.md`.
> Do not follow this copy.

- Read `AGENTS.md` before changing code. Project rules win over global rules.
- Never hardcode or log secrets, API keys, `TG_SESSION`, bearer tokens, URLs with
  credentials, or absolute local paths.
- No `any` in new code. `as unknown as` only at an external boundary, with a
  comment and runtime validation.
- SQL: only `?` placeholders. Never interpolate user input into SQL.
- Client components (`'use client'`) must not import `@challenge/core/*`.
  Use `web/lib/shared/*`; server code goes through `web/lib/server/*`.
- Do not create a new `challenge/src/demos/day-NN.ts` unless explicitly asked.
- Do not add packages, nested `package.json`, or a second lint/build setup.
- Do not edit unrelated comments or formatting. Keep the diff surgical.
- Validate with the commands in `AGENTS.md` §10. Lint is not configured; do not
  invent a lint command.
- Do not commit or push unless the user explicitly asks.
