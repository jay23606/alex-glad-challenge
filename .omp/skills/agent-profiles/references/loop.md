# Loop mode

Loop mode runs a prioritized pool of work items through the profile graphs. It is
opt-in and project-adapted.

## Entry

Enter loop mode only when the user says `loop-run`, `execution loop`, `пул задач`,
or an existing milestone/tracker iteration already defines the pool. A normal task
uses one profile and does not create issues or metrics.

## Bootstrap defaults

The adapter supplies values. Use these placeholders when a slot is absent; print
the chosen defaults in one line and continue.

| Parameter | Default | Ask? |
|---|---|---|
| Profile | selected by `selection.md`; announce one line | no |
| Branch | current feature branch; else `feat/<slug>` from the trunk | only if the user explicitly named a different one |
| Milestone/iteration | `run-YYYY-MM-DD`, then `-2`, `-3` on collision | only if an existing one is supplied |
| Work items | created in the milestone with the loop label and priority | no |
| Commit | allowed on entering the loop, unless the user explicitly forbade commits | explicit veto wins |
| Push/PR | forbidden until the user says `push`/`PR` or explicitly asks | no |
| Scope | only the listed features/refactors; findings get their own item by priority | no |
| Surfaces | inferred from code and request; choose the minimal existing surface and record it | no |
| Priorities | `P0 → P1 → P2 → P3`, WIP=1 | an open P0/incident |

Default line:

```text
loop: profile=<profile>, branch=<branch>, milestone=<milestone>, commit=yes, push=no
```

Interactive questionnaires, multi-tab confirmations, and "confirm these defaults"
prompts are a harness defect, not an approval step.

## Ask exceptions

Ask only for:

- a missing secret/access that cannot be discovered safely;
- an unauthorized destructive or irreversible action (force-push, history rewrite,
  data deletion);
- an open `P0`/incident that changes priority;
- a real contradiction between project rules where the default changes safety.

Everything else is a conservative autonomous decision recorded in the Report.
Stopping to ask is counted as `asked-user`; do not spend it on defaults.

## Work items and priorities

The adapter maps these generic priorities to its tracker:

| Priority | Meaning | Executor |
|---|---|---|
| `P0` + incident | production down, data loss/leak, security | stop the current task; fix the incident; file the item immediately |
| `P1` | main path broken, workaround exists | finish the current task to the Definition of Done, then take it next |
| `P2` | side defect, UX, edge case | file it now, queue it, do not interrupt the current task |
| `P3` | cosmetic, debt, "while we're here" | queue it; take it in a free slot |

Findings are never fixed "while we're here"; they become items. Exception: a
blocker without which the current task cannot reach the Definition of Done — then
it is in scope and the fact is recorded in the Report.

## WIP and limits

- One `in-progress` item per executor.
- Parallel work only on disjoint files; each item has its own `in-progress`.
- Reproduction ≤3 attempts, one variable each; Fix ↔ Validation ≤2 cycles without
  progress; then stop and report.
- Open P0/incident target is zero; P1 queue is capped by the adapter. Over the cap,
  the next slot goes to triage, not a new feature.

## Iteration and cause vocabulary

If the adapter instruments attempts, use a stable vocabulary:

- failed first attempt: `iteration:2` + exactly one `cause:*`;
- `cause:context` — did not understand the context;
- `cause:code` — code does not work;
- `cause:loop` — looped/stuck;
- `cause:test` — test failure/mistake;
- `cause:premise` — false premise.
- stopped to ask: `asked-user`, with the reason in a comment.

If the adapter has no tracker for these labels, record them in the Report; do not
invent a second tracker.

## Metrics

The adapter declares the metric command or `n/a`. Generic definitions:

| Metric | Source | If not instrumented |
|---|---|---|
| tasks in a row without stops | items in the milestone − `asked-user` | `n/a` |
| where/why it broke | `iteration:2` + `cause:*` | `n/a` |
| average time | `in-progress` timestamp → close/merge | fallback intervals |
| first-attempt success | closed with the loop label and no `iteration:2` | `n/a` |

A metric without its marker does not exist; report `n/a`, not zero or an estimate.
Self-report is not measurement.

## Close

- Start = `in-progress` marker (timestamp in the tracker timeline).
- Finish = the adapter's close marker (`Closes #N` in GitHub, a close transition
  in another tracker) or a close comment with the Report when no code was produced.
  The close timestamp is the only one trusted.
- On close: remove `in-progress`; `blocked` if waiting on an external event;
  `hotfix` if the fix arrived outside the plan.
- Final: full project validation, metrics command, changelog if the project
  requires it, and a run report in `<reportDir>`.

## Large work

A large feature is an epic: create the tracking item with an `epic` marker and a
story checklist, split it into story items with the same milestone and loop label,
and do not close the epic until every story closes. Bug fixes and refactors are
separate items and commits; do not mix diffs.
