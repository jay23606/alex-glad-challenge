# Hard rules (sticky)

Portable Agent Skills pack. Read the project adapter `AGENTS.md` and this file
before changing code. Precedence: project `AGENTS.md` > `.omp/RULES.md` >
harness global config > harness defaults. Project rules win; this pack wins over
harness global/defaults.

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
7. **Loop autonomy.** In `loop-run` or an existing milestone, do not ask: load
   `agent-profiles`, apply its loop defaults plus the project adapter, print them
   in one line, and record assumptions in the Report. Questions only for the
   adapter's ask exceptions.
8. **Finish the session's scope.** A multi-step request gets a todo plan
   (todowrite) before the first edit; a turn ends only when every todo is
   completed/cancelled or genuinely blocked by an ask-exception. Never end a turn
   on a bare tool result mid-plan; end with status: done + summary, or blocker +
   question.
9. **Resume without ceremony.** After any interruption (cut turn, «продолжай»,
   "continue"): the first action is re-checking the todo list / Report "Next" and
   resuming from the first open item immediately — no re-planning, no "shall I
   continue" question, no re-confirmation of already-approved defaults.

## Portable hard rules

- Read the project adapter before changing code. Project rules win.
- Never hardcode or log secrets, API keys, tokens, sessions, credential-bearing
  URLs, or absolute local paths.
- No unjustified type escape hatches (`any`, unchecked casts). Put the exact rule
  and allowed boundary in the project adapter.
- SQL uses parameterized queries; the project adapter pins the placeholder syntax.
  Never interpolate user input into SQL.
- Keep the diff surgical. Do not edit unrelated comments or formatting.
- Do not add packages, a second package manager, or a second lint/build setup
  without explicit approval. The project adapter may be stricter.
- Validate with the project's declared commands. If a command is absent, say so;
  never invent a lint/test/build command.
- Do not commit or push unless the user explicitly asks. Entering the loop
  (`loop-run`/synonym or an existing milestone) counts as that explicit request
  for commits in the loop's milestone unless the user explicitly forbade
  commits; push/PR still require an explicit `push`/`PR`.
- Without an explicit request, never use `--no-verify`, `--no-gpg-sign`,
  `-c commit.gpgsign=false`, or `--force`; fix a failing hook, do not bypass it.
- A finding outside scope becomes an item per the project adapter; do not fix it
  in the current task. Exception: a `P0`/incident or a blocker without which the
  task cannot reach the declared Definition of Done; record the fact in the Report.
- WIP = 1 `in-progress` per executor; triage findings before closing the task.
- Staged profiles are mandatory when the task matches one: load `agent-profiles`,
  follow its stage graph, and never skip Validation or Report or replace them with
  ad-hoc checks.
- The assistant selects the profile itself, announces it in one line, and follows
  it strictly; ask only on real ambiguity that changes the result.
- The execution loop never starts by itself: it needs an explicit `loop-run` /
  "execution loop" / "пул задач" request or an existing milestone. Instrumentation
  vocabulary and metrics come from the project adapter.

## Project adapter

Project-specific invariants, commands, paths, labels, and role mappings live in
`AGENTS.md` (its precedence block and Agent profile adapter section). Do not copy
them into this file; the pack must remain portable.
