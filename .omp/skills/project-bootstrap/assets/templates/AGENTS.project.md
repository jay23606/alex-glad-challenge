# <Project> — agent adapter

## 0. Pack and precedence

- Pack: `agent-pack` v<pack.version> (`.omp/pack.json`).
- Portable rules: `.omp/RULES.md`.
- Portable profiles: `.omp/skills/agent-profiles/SKILL.md`.
- At the start of every non-trivial task, load `agent-profiles`; it selects the
  profile and reads §4 below for project bindings.
- Precedence: this file > `.omp/RULES.md` > harness global config > harness
  defaults. Project rules win; do not ask the user to arbitrate a
  harness-vs-project conflict.
- Harness adapters (`opencode.json`, `CLAUDE.md`, `GEMINI.md`, `.cursor/*`,
  `.github/copilot-instructions.md`) are pointers/config only. They contain no
  rules.

## 1. Project facts

| Fact | Value |
|---|---|
| Stack | <runtime, language, frameworks, package manager, versions> |
| Layout | <top-level packages/apps and their roles> |
| Entrypoints | <CLI, HTTP routes, workers, UI> |
| Package manager | <pnpm/npm/yarn/bun/...> |
| Runtime versions | <Node/Python/Go/...> |

## 2. Boundaries

- <dependency direction; server/client split; data access>
- <frozen or archived paths: do not modify>
- <dependency policy: approval required for new packages>
- <security invariants: secret store, input validation, SQL placeholders, bind/network>
- <naming/conventions that differ from the language defaults>

## 3. Validation

| Check | Command | Required |
|---|---|---|
| build | `<command or none>` | <yes/no> |
| typecheck | `<command>` | <yes/no> |
| test (focused) | `<command>` | <yes/no> |
| test (full) | `<command>` | <yes/no> |
| lint | `<command or none — do not invent>` | <yes/no> |
| dev/run | `<command>` | <yes/no> |
| runtime smoke | `<CLI/browser/device scenario>` | <yes/no> |

`validation.baseline` = `<the command run before and after edits>`.
`validation.focused` = `<the command/test for the changed behavior>`.
If a check is absent, write `none` or `n/a` with a reason; never invent a command.

Definition of Done: <project-specific additions; the pack's default is the
standing checklist in `.omp/references/definition-of-done.md`>.

## 4. Agent profile adapter

The portable skill owns the stage graph and report format. Fill only the project
bindings here.

| Slot | Value |
|---|---|
| `reportDir` | `<reports directory>` |
| `tracker` | `<GitHub/GitLab/Jira/Linear/none; labels/milestones>` |
| `surfaces` | `<packages/apps a profile may touch>` |
| `roles.researcher` | `<harness agent/subagent>` |
| `roles.implementer` | `<harness agent/subagent>` |
| `roles.reviewer` | `<harness persona/agent>` |
| `roles.validator` | `<harness persona/agent>` |
| `loop.branch` | `<current feature branch or feat/<slug>>` |
| `loop.milestone` | `<format>` |
| `loop.commit` | `<policy>` |
| `loop.pushPr` | `<policy: explicit only by default>` |
| `loop.metrics` | `<command or n/a>` |
| `graph` | `<graph tool/command or none>` |
| `profileLabels` | `<localized names, optional>` |

Project notes per profile:

- **business-feature:** <surfaces, constraints, acceptance focus>
- **bug-search:** <repro command, runtime mode, regression test convention>
- **research:** <search tools, LSP availability, graph provider>
- **project-graph:** <layers, frozen paths, graph update command>

## 5. Harness adapters

| Harness | Entrypoint | Skills |
|---|---|---|
| OpenCode | `AGENTS.md` + `opencode.json` | `.omp/skills` via config |
| Claude Code | `CLAUDE.md` pointer | `.claude/skills` links if needed |
| Codex | `AGENTS.md` | `.agents/skills` links if needed |
| Gemini CLI | `GEMINI.md` or `context.fileName` | `.agents/skills` links if needed |
| omp | `AGENTS.md` + `.omp/RULES.md` | `.omp/skills` |

Do not duplicate rules in these files. See the pack's
`.omp/skills/project-bootstrap/references/harness-matrix.md`.

## 6. Open questions and local exceptions

- <known exception, unresolved decision, or "none">
