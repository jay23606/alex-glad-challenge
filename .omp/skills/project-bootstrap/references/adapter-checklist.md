# Project adapter checklist

Fill these slots in `AGENTS.md`. Infer what you can from the repository; ask only
for what cannot be discovered, in one batched question.

| Slot | What to record | Where to infer |
|---|---|---|
| `pack.version` | pack version from `.omp/pack.json` | `pack.json` |
| `stack` | runtime, languages, frameworks, package manager, versions | lockfiles, manifests |
| `layout` | top-level packages/apps and their roles | workspace config, directories |
| `commands.build` | production build (or `none`) | package scripts, Makefile |
| `commands.typecheck` | static check | package scripts, tsconfig |
| `commands.test` | focused and full test commands | package scripts, test config |
| `commands.lint` | lint command or `none` (do not invent) | package scripts |
| `commands.dev` | local run command | package scripts |
| `validation.baseline` | command run before/after edits | project choice |
| `validation.focused` | command for the changed behavior | test/runtime docs |
| `validation.runtime` | CLI/browser/device smoke | README, existing scripts |
| `surfaces` | packages/apps the profiles may touch | layout + entrypoints |
| `frozen` | paths that must not be touched | repo docs, archive dirs |
| `boundaries` | dependency direction, server/client split, data access | architecture docs |
| `security` | secret store, input validation, SQL, network/bind rules | env/config docs |
| `reportDir` | stage evidence directory | existing convention or `reports/` |
| `tracker` | GitHub/GitLab/Jira/Linear/none; labels/milestones | issue templates, CI |
| `roles` | researcher/implementer/reviewer/validator → harness agents | harness docs |
| `profileLabels` | localized profile names (optional) | user preference |
| `loop` | branch default, milestone format, commit/push policy, metrics command | git/tracker docs |
| `graph` | graph tool/command or `none` | existing tooling |
| `harness` | tested harness versions | lockfiles, CI |

## Fill order

1. Stack and layout from manifests.
2. Commands from scripts; mark missing ones `none` or `n/a`, never invent.
3. Boundaries and security from architecture docs and config.
4. Tracker/git/report conventions from existing templates and CI.
5. Role mapping last; use role names in the pack and real agent IDs only here.

## Acceptance

- Every slot is filled or explicitly `none`/`n/a` with a reason.
- The precedence line is present.
- The profile adapter points to `agent-profiles`; it does not copy its stage text.
- No project nouns leaked into `.omp/RULES.md` or the portable skills.
- No secrets or absolute local paths in adapters.
