# Stage law

These rules are common to every staged profile. The project adapter supplies the
commands, paths, artifact directory, and role mapping; the stage law does not
change.

## Roles

| Role | Does | Must not |
|---|---|---|
| orchestrator | selects the profile, sequences stages, merges reports, talks to the user | write code or skip a stage |
| researcher | reads code/docs and returns evidence | edit files, mutate state, commit |
| implementer | makes the planned changes and runs focused checks | change the plan or stage graph |
| reviewer | reviews correctness, security, maintainability | edit the reviewed files |
| validator | runs the declared checks, reproduces, verifies | replace missing checks with "looks right" |

The adapter maps roles to real agents/subagents. Personas do not call personas;
skills are the hops inside a role. The user or the harness is the orchestrator.

## One stage, one kind of work

- Announce every transition: `stage X → Y`.
- A stage ends only when its artifact exists: research notes, plan, diff, validation
  evidence, or Report.
- A subagent must not change the stage on its own. If the premise is wrong, return
  to the orchestrator with the evidence.

## Context handoff

Use two channels, both required:

1. **Prompt summary:** "Context from the previous stage" — decisions, files,
   commands, open risks.
2. **Durable artifact:** write stage evidence to `<reportDir>` so a compacted or
   restarted session can recover.

Subagents do not talk to each other directly unless the adapter explicitly allows
it. Default is report-only fan-out.

## Artifact naming

Default:

```text
<reportDir>/<slug>-research-01.md
<reportDir>/<slug>-plan-01.md
<reportDir>/<slug>-diagnose-01.md
<reportDir>/<slug>-fix-01.md
<reportDir>/<slug>-validation-01.md
<reportDir>/<slug>-reproduce.md
<reportDir>/<slug>-e2e-scenario.md
<reportDir>/<slug>-<YYYY-MM-DD>.md
```

Fan-out: `<reportDir>/<slug>-<stage>-<role|package>-<NN>.md`. Never write the same
file in parallel. The adapter may change the directory or prefix; it must not
remove the stage evidence.

## Fan-out and barriers

- Fan out inside a stage in one message, only for genuinely independent work.
- A diagnosis consilium is exactly three researchers with distinct hypotheses.
- Fix fan-out is at most four implementers with disjoint files. One owner touches
  the integration point.
- No one commits during a parallel phase.
- Barriers are data-driven: Plan after all research artifacts; Validation after
  Fix; Report after Validation.

## Baseline and verification

Before edits, capture the baseline declared by the adapter (for example the focused
typecheck/test command). After edits, run the same baseline plus the focused check
for the changed behavior. A missing command is `n/a` with a reason, never a guessed
command.

## Limits

- Fix ↔ Validation: at most 2 cycles without measurable progress; then stop and
  report.
- Reproduction: at most 3 attempts, one changed variable per attempt.
- A P0/incident does not relax these limits; it changes priority, not evidence.

## Right to object

A subagent that finds a workaround, security hole, or architectural debt records
the objection in its report. The orchestrator must surface it to the user; do not
swallow it.

## Compaction and restart

- Status lives in `<reportDir>`, not in the conversation.
- Before a step, re-read the active scenario; do not repeat steps marked `[x]`.
- A fresh session reads the rules, the active plan, the Report, and the actual
  working-tree state before acting.

## Report

A staged profile is incomplete without a Report. Use `report.md`; include the
profile, the stage artifacts, checks with evidence, security items, risks, and
open questions. In loop mode, include the metrics the adapter requires.
