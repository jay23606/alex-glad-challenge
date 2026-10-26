---
name: project-validation
description: Validation checklist and exact commands for alex-glad-challenge after a change; typecheck, tests, smoke, style/secrets grep, and what to report when lint is absent.
---

# Project validation

> **Historical (ADVANCED Day 1).** Superseded by `AGENTS.md` §10 and
> `.omp/skills/agent-profiles/`. Do not follow this copy.

Run once after integration, not inside every subagent.

## Commands

```powershell
pnpm --filter challenge typecheck
pnpm --filter challenge test
pnpm --filter web typecheck
pnpm --filter web test
# Windows/limited CPU: if Vitest fails to start workers (not test failures),
# retry capped: pnpm --filter web exec vitest run --maxWorkers=2
pnpm --filter web build        # if web build/boundary changed
```

Scoped proofs while iterating:

```powershell
node --import tsx --test challenge/src/core/<file>.test.ts
pnpm --filter web exec vitest run test/unit/<file>.spec.ts
```

## Smoke

- CLI: `pnpm --filter challenge start -- <command>`; observe output/exit.
- Route: Vitest with `NextRequest`, or `curl` to `127.0.0.1` behind auth.
- UI: open the real page; verify state/empty/error.
- RAG/indexing: run the actual command; do not rely on mocks.

## Style / security grep

```powershell
# any, console.log, casts, direct core imports in client code
rg -n "\bany\b|console\.log|as unknown as|@challenge/core" <changed files>

# secrets
rg -n "sk-|Bearer|TG_SESSION|API_KEY" <changed files>
```

## Reporting

- Lint is **not configured**. Report "lint: not available" and list the style
  checks you actually ran instead.
- State exactly what passed: typecheck, test counts, smoke command/output.
- Separate blockers, nits, and unverified claims (`[INFERENCE]`).
