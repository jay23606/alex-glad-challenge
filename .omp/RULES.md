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
- Finding outside scope → issue via `.github/ISSUE_TEMPLATE/bug.md` with label
  `P0`–`P3`; do not fix it in the current task. Exception: `P0`/`incident` and
  blockers needed to reach AGENTS §10.
- WIP = 1 `in-progress` per executor; triage findings before closing the current
  task (AGENTS §13.9).
- Стадийные профили: граф `Research → Plan → Fix → Validation → Report` обязателен;
  стадия Validation (персоны `code-reviewer` + `test-engineer`) и финальный Report
  не пропускаются и не подменяются ad-hoc проверками (AGENTS §13.2–§13.3).
- Профиль выбирает ассистент сам (§13.1), объявляет одной строкой и следует ему
  СТРОГО; `ask` — только при реальной неоднозначности, иначе консервативный выбор.
- Крупная фича = эпик (label `epic`) → разбивается на story-issues (label `story`)
  ДО старта, с тем же milestone и `loop-run` (AGENTS §13.9). Баги, недоразумения и
  недопонимания, найденные по ходу flow, сразу заводятся issues — не чинятся «заодно».
- Time and completion are proven by `scripts/loop-metrics.mjs` and `Closes #N`,
  not by self-report.
- The execution loop never starts by itself: explicit `loop-run` /
  "execution loop" / "пул задач" request, or an existing milestone.
  Instrumented run = milestone + `loop-run` on every issue; failed first
  attempt = `iteration:2` + one `cause:*`; stop to ask the user = `asked-user`
  (AGENTS §13.9).
