# Portable agent pack

This `.omp/` directory is a self-contained Agent Skills pack plus a portable work
process. Copy it into another project, then adapt **one** project file
(`AGENTS.md`). Skills, personas, references, and the profiling rule stay the same.

## Three layers

| Layer | Files | Changes per project? |
|---|---|---|
| Portable pack | `.omp/RULES.md`, `.omp/skills/`, `.omp/agents/`, `.omp/references/`, `pack.json`, `templates/` | No (except version) |
| Project adapter | `AGENTS.md` (facts, boundaries, commands, profile bindings) | Yes |
| Harness adapters | `opencode.json`, `CLAUDE.md`, `GEMINI.md`, optional `.claude/skills`/`.agents/skills` links | Paths only, no rules |

Precedence: project `AGENTS.md` > `.omp/RULES.md` > harness global config >
harness defaults. On conflict, project rules win; do not ask the user to arbitrate.

## Layout

```text
.omp/
  pack.json
  README.md
  RULES.md                       # portable sticky rules
  skills/
    agent-profiles/              # profile selection + stage graph + loop + report
    project-bootstrap/           # install/adapt this pack
    ...                          # workflow skills
  agents/                        # review personas
  references/                    # lazy-loaded checklists
  docs/agents.md                 # persona composition guide
  skills/project-bootstrap/assets/templates/
    AGENTS.project.md            # project adapter template
    opencode.json
    CLAUDE.md
    GEMINI.md
    cursor-rules.mdc
    copilot-instructions.md
```

## Quick start in a new project

1. Copy `.omp/` into the target (or use a git submodule; see the bootstrap skill).
2. Invoke the `project-bootstrap` skill.
3. Fill `AGENTS.md` from
   `.omp/skills/project-bootstrap/assets/templates/AGENTS.project.md`; infer stack
   and commands from the repository, ask only for missing facts.
4. Generate/verify the harness adapters. Do not copy rules into them.
5. Validate:

```bash
node -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8')); console.log('json ok')"
opencode debug config
opencode debug skill
```

Start OpenCode at the repository root: its `skills` paths resolve against the start
directory, not the config file. The first `debug skill` may be partial while
discovery completes; re-run and judge by resolved `location` paths.

## Profiles

At task start, load `agent-profiles`. It selects exactly one profile and follows
its graph:

- `business-feature`: Research → Plan → Fix → Validation → Report
- `bug-search`: Diagnose → Reproduce → Fix → Validation → Report
- `research`: read-only answer
- `project-graph`: read-only graph

Project commands, surfaces, tracker, report directory, and harness role mapping
come from `AGENTS.md` §"Agent profile adapter". The stage text is never copied
there.

## Rules vs skills

- **Rules** are always-on constraints. `.omp/RULES.md` is portable; project
  invariants belong in `AGENTS.md`.
- **Skills** are on-demand workflows. Keep one canonical copy; harness adapters
  point at `.omp/skills` or link to it. Shared checklists live in `.omp/references`;
  12 workflow skills link to them, so the full `.omp/` pack is the install unit.
- **Personas** are roles, not routers. They do not call each other; the
  orchestrator composes them.

## Install transports

| Mode | Reproducible | Use when |
|---|---|---|
| Copy `.omp/` | Yes (commit it) | Default; simplest and Windows-safe |
| Git submodule + links | Yes (pinned tag) | Teams/CI |
| Junction/symlink to local clone | No | Solo fast iteration; local volume only |
| `npx skills add .omp/skills` | Skill source/ref in lock | **Standalone skills only**; 12 workflow skills reference `.omp/references`, so the full pack needs copy/submodule |

`npx skills` is the de facto Agent Skills installer; it does not install rules,
profiles, or personas. This pack's workflow skills also link to `.omp/references`;
installing only `.omp/skills` breaks those links. Use copy/submodule for the full
pack, and `npx` only for standalone skills.

## Harness notes

- **OpenCode**: `opencode.json` loads `.omp/RULES.md` and `.omp/skills`. Start at
  the repo root. Project skills win over same-named global skills. `.omp/agents`
  are canonical persona documents; OpenCode does not auto-register them as skills —
  load them as an agent/system prompt or link them into `.opencode/agents`.
- **Claude Code**: Claude reads `CLAUDE.md`; use a pointer. Its native skill
  directory is `.claude/skills`; generate a mirror/link if the project needs native
  skill discovery. Personal skills can shadow project skills — avoid duplicate
  names.
- **Codex**: native `AGENTS.md` + `.agents/skills`.
- **Gemini CLI**: `GEMINI.md` or `context.fileName` including `AGENTS.md`.
- **Cursor / Copilot**: copy the pointer templates to
  `.cursor/rules/000-canonical.mdc` and `.github/copilot-instructions.md`.
- **omp**: `AGENTS.md` + `.omp/RULES.md` + `.omp/skills`.

## Sources

- Agent Skills specification — <https://agentskills.io/specification>
- AGENTS.md — <https://agents.md/>
- OpenCode skills — <https://opencode.ai/docs/skills>
- OpenCode rules/instructions — <https://opencode.ai/docs/rules>
- Claude Code memory — <https://code.claude.com/docs/en/memory>
- Claude Code skills — <https://code.claude.com/docs/en/skills>
- Codex skills — <https://developers.openai.com/codex/skills>
- skills CLI — <https://www.skills.sh/docs/cli>

## Limits

- No cross-vendor standard exists for rules, profiles, or personas; this pack uses
  Markdown + the Agent Skills folder contract.
- Symlinks/junctions are machine-local; prefer copy or submodule for teams.
- OpenCode's skill discovery can be briefly partial at startup; this is a harness
  behavior, not a pack bug.
