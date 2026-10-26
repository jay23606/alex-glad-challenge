---
name: agent-profiles
description: Select and execute a project-adapted work profile for a coding task. Use at the start of every non-trivial task to choose business feature, bug search, research, or project graph, then follow its mandatory stage graph, loop defaults, and report format. Project commands, surfaces, tracker, and role mappings come from the AGENTS.md profile adapter.
license: MIT
compatibility: Agent Skills. Requires a project adapter in AGENTS.md; tested with OpenCode 1.19 and omp.
metadata:
  pack: agent-pack
  version: "1.0.0"
  owner: portable-pack
---

# Agent Profiles

A profile is a reusable process, not a project fact. This skill selects one profile
and enforces its stages. The project supplies commands, paths, tracker, and role
names through its adapter; the process stays identical across projects.

## Load order

1. Find the nearest `AGENTS.md` from the working directory upward.
2. Read the section whose heading ends with `Agent profile adapter` (for example
   `## 4. Agent profile adapter` or `## 13. Agent profile adapter`).
3. Load only the selected profile reference. Do not preload every reference.

If the adapter is missing, use the generic defaults here, state the assumption in
the Report, and continue. Do not ask the user to invent an adapter.

## Select one profile

Match the request against `references/selection.md`. Choose exactly one profile and
announce it in one line using the adapter's label. Never ask which profile to use.

| Profile | Use when | Graph | Load |
|---|---|---|---|
| `business-feature` | add, implement, feature, integration, endpoint, CLI command | Research → Plan → Fix → Validation → Report | `references/feature.md` |
| `bug-search` | bug, error, crash, regression, stack trace, reproduce | Diagnose → Reproduce → Fix → Validation → Report | `references/bug-search.md` |
| `research` | how does it work, find, which, where, assess; no edits | Research (read-only) | `references/research.md` |
| `project-graph` | graph, project map, component links, feature map | Graph (read-only) | `references/project-graph.md` |

If two profiles match, choose the one that changes the verification artifact. If
no edits are requested, prefer `research`; if edits are requested, prefer
`business-feature`. Never use a router persona or a second model call just to pick
a profile.

## Stage law

Read `references/stages.md` before the first stage. Non-negotiable:

- `business-feature`: Research → Plan → Fix → Validation → Report.
- `bug-search`: Diagnose → Reproduce → Fix → Validation → Report.
- `research`: read-only; no file changes, commits, or mutating commands.
- `project-graph`: read-only map; no file changes.
- Never skip Validation or Report; never replace them with ad-hoc checks.
- Stop Fix ↔ Validation after 2 cycles without progress.
- Stop reproduction after 3 attempts; change one variable per attempt.
- Fan out only independent work; one writer per shared file; no commits during a
  parallel phase.
- Announce a transition as one line: `stage X → Y`.

## Roles, not harness names

Use role names: `orchestrator`, `researcher`, `implementer`, `reviewer`,
`validator`. The project adapter maps them to harness agents. Personas do not call
personas; skills are the hops inside a role. The user or the harness is the
orchestrator.

## Loop

`loop-run`, `execution loop`, `пул задач`, or an existing milestone enters loop
mode. Apply the adapter's loop defaults, print them in one line, and proceed.

Do not use the question tool or questionnaires for profile, branch, milestone,
permissions, boundaries, surfaces, or confirmation of defaults. Ask only for:

- a missing secret or access;
- an unauthorized destructive/irreversible action;
- an open `P0`/`incident`;
- a contradiction the adapter cannot resolve without changing safety.

Details and placeholder defaults: `references/loop.md`.

## Report

Use `references/report.md`. Substitute the adapter's `reportDir`, validation
commands, security items, tracker fields, and metric command. A profile is not
complete without a Report. In loop mode also record the metrics required by the
adapter; missing instrumentation is `n/a`, not zero.

## Extending

To add a project-specific profile, follow `references/extending.md`. Keep the
procedure in this pack and put only triggers/commands in the project adapter.

## References

- `references/selection.md` — trigger table, ambiguity, profile switching
- `references/stages.md` — common stage law, fan-out, barriers, limits
- `references/feature.md` — business feature profile
- `references/bug-search.md` — bug search profile
- `references/research.md` — read-only research profile
- `references/project-graph.md` — project graph profile
- `references/loop.md` — loop defaults, ask exceptions, metrics
- `references/report.md` — report template with project placeholders
- `references/extending.md` — add or override a profile
