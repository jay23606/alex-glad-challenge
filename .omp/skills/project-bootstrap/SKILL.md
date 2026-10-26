---
name: project-bootstrap
description: Install and adapt the portable agent pack in a new project. Use when starting a repository, copying the pack from another project, or adding a harness; copies skills/personas/references/templates, generates AGENTS.md from the adapter template, wires OpenCode/Claude/Codex/Gemini, and validates discovery without duplicating rules.
license: MIT
compatibility: Agent Skills. Node.js 20+ for JSON/frontmatter checks; tested with OpenCode 1.19 and omp.
metadata:
  pack: agent-pack
  version: "1.0.0"
  owner: portable-pack
---

# Project Bootstrap

Move the pack into a project, then adapt the **rules** while leaving the **skills**
and **profile process** unchanged.

## What ships

- `.omp/RULES.md` — portable sticky rules (do not add project nouns).
- `.omp/skills/` — workflow skills, including `agent-profiles`.
- `.omp/agents/` — review personas.
- `.omp/references/` — lazy-loaded checklists.
- `.omp/docs/` — persona composition guide (referenced by the adapter).
- `.omp/skills/project-bootstrap/assets/templates/` — project adapter and harness
  templates.
- `.omp/pack.json` — version and target map.

## Procedure

### 1. Inspect the target

- Find an existing `AGENTS.md`, `.omp/`, `CLAUDE.md`, `GEMINI.md`, `opencode.json`.
- If any exists, read it before writing. Never overwrite project rules, skills, or
  uncommitted work without explicit approval.
- Identify the stack from `package.json`, `pyproject.toml`, `go.mod`,
  `Cargo.toml`, `*.csproj`, or the build files. Identify commands from the scripts,
  not from memory.

### 2. Copy the pack

Copy `.omp/` from the pack source into the target. Exclude target artifacts
(`.omp/.data/`, reports, caches). Do not copy `.env` or generated output.

Choose one transport (see `references/install.md`):

- **Copy** — default; portable and Windows-safe.
- **Git submodule** — teams/CI; pin a tag.
- **Junction/symlink** — solo developer; local volume only; never a UNC path.
- **`npx skills add`** — skill-only distribution; it does not install rules,
  profiles, or templates.

### 3. Adapt the project adapter

Create `AGENTS.md` from `assets/templates/AGENTS.project.md` (or merge the
template into the existing file). Fill every slot in `references/adapter-checklist.md`.
Infer facts from the repo; batch only genuinely missing questions. Keep the
project's commands, boundaries, security invariants, tracker, and role mapping.
Do not copy the stage text from `agent-profiles`; point to it.

### 4. Generate harness adapters

Use the templates in `assets/templates/`:

- `opencode.json` — `instructions: [".omp/RULES.md"]`, `skills: [".omp/skills"]`,
  `permission.skill: "allow"`.
- `CLAUDE.md` — pointer; Claude Code reads `AGENTS.md` when no `CLAUDE.md` exists,
  so a pointer or an explicit project setting is required.
- `GEMINI.md` — pointer, or set Gemini `context.fileName` to include `AGENTS.md`.
- `AGENTS.md` — native for OpenCode, Codex, omp, and other AGENTS-aware harnesses.
- `.cursor/rules/000-canonical.mdc` — copy `cursor-rules.mdc`; pointer for Cursor.
- `.github/copilot-instructions.md` — copy `copilot-instructions.md`; pointer for
  GitHub Copilot.
- Optional `.claude/skills` links and `.agents/skills` links for harnesses that do
  not read `.omp/skills` (see `references/harness-matrix.md`).
- Personas: `.omp/agents/*.md` are canonical documents, not skills. If the harness
  has native agents (OpenCode `.opencode/agents`, Claude `.claude/agents`), link or
  copy them there, or load the persona file as the system prompt. Do not maintain a
  second editable copy.

Adapters contain no rules; they only point/configure.

### 5. Validate

- JSON parses: `node -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8'))"`.
- Every `SKILL.md` has `name`/`description`; `name` matches its directory.
- If OpenCode is installed:
  - `opencode debug config` shows the expected `instructions`/`skills`;
  - `opencode debug skill` lists the project skills (start at the repo root; the
    first run may be partial while discovery completes).
- The project adapter has a precedence line and every required slot.
- The full `.omp/` is present if any skill references `.omp/references` (12 do);
  skill-only installs are not supported for those skills.
- No absolute paths, secrets, tokens, or credential URLs in adapters.
- No duplicate rule text in adapters; no project nouns in the portable pack.

### 6. Report

Record: pack version, transport, files copied, slots filled/assumed, adapters
generated, checks run, residual risks, and anything that remains project-specific.
Do not commit or push unless the user explicitly asks.

## Rules

- Keep one canonical copy of every skill and rule. Do not create a second editable
  copy in a harness directory.
- Do not put project facts (commands, paths, labels, harness agent IDs) into
  `.omp/RULES.md` or the portable skills; they belong in `AGENTS.md`.
- Do not create a router persona; `agent-profiles` selects the profile.
- Do not install the same skill globally and per project without a reason; Claude
  gives personal skills precedence over project skills.
- Do not commit symlinks if Windows contributors are expected; copy or document a
  junction setup.

## References

- `references/adapter-checklist.md` — every slot the project must fill.
- `references/harness-matrix.md` — entrypoints, skill paths, precedence pitfalls.
- `references/install.md` — copy/submodule/junction/npx tradeoffs.
- `assets/templates/` — AGENTS, OpenCode, Claude, Gemini templates.
