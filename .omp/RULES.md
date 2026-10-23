# Hard rules (sticky)

This project uses the [Agent Skills](https://github.com/addyosmani/agent-skills)
workflow pack. Read `AGENTS.md` and `.omp/RULES.md` before changing code.
Project rules win over global rules.

## Core operating behaviors (apply to every skill)

1. **Surface assumptions.** Before anything non-trivial, state assumptions and
   let the human correct them.
2. **Manage confusion actively.** Stop and ask when you see inconsistencies or
   unclear requirements. Do not guess.
3. **Push back when warranted.** Explain concrete downsides and propose
   alternatives; accept the human's override once they have full information.
4. **Enforce simplicity.** Prefer the boring, obvious solution. Abstractions must
   earn their complexity.
5. **Maintain scope discipline.** Touch only what the task asks. Do not clean up
   adjacent code, reformat files, or add "useful" features outside the spec.
6. **Verify, don't assume.** A task is done only when there is evidence: passing
   tests, clean build, runtime check. "Seems right" is never enough.

## Project hard rules

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
