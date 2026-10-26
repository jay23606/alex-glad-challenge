# Harness matrix

Adapters point at the canonical pack; they never contain rules. Verify the current
harness version before relying on precedence details.

| Harness | Project entrypoint | Skill discovery | Notes |
|---|---|---|---|
| OpenCode 1.x | `AGENTS.md` (falls back to `CLAUDE.md`) | `.opencode/skills`, `.claude/skills`, `.agents/skills`, plus `skills` config paths | `instructions` loads extra rule files; project skills win over global; `permission.skill` gates loading. Start at the repo root: `skills` paths resolve against the start directory. Personas are not skills: `.omp/agents` must be loaded as an agent/system prompt or linked into `.opencode/agents`. |
| OpenCode 2.x | `AGENTS.md` only | same discovery locations: `.opencode/skills`, `.claude/skills`, `.agents/skills`, plus `skills` config paths | Combines global + ancestor + nested instructions without resolving conflicts; pin the major version. Verified behavior in this pack: 1.19.4. |
| Claude Code | `CLAUDE.md`; reads `AGENTS.md` only when no `CLAUDE.md` exists | `.claude/skills` (personal > project on name collision) | Supports `@path` imports (max 4 hops). Do not keep a stale personal copy of a project skill. |
| Codex | `AGENTS.md`, root → cwd, plus global | `.agents/skills` and `~/.agents/skills` | Duplicate names are not merged; keep one canonical copy. |
| Gemini CLI | `GEMINI.md` or `context.fileName` including `AGENTS.md` | `.agents/skills` per skills CLI table | Point `context.fileName` at `AGENTS.md` to reuse the same adapter. |
| Cursor | `.cursor/rules/000-canonical.mdc` | native via skills CLI / `.agents/skills` | Keep the rule file a pointer; `alwaysApply: true`. |
| GitHub Copilot | `.github/copilot-instructions.md` | native via skills CLI / `.agents/skills` | Pointer only; no rule duplication. |
| omp | `AGENTS.md` + `.omp/RULES.md` | `.omp/skills` | Sticky rules and skills are project-local. |

## Precedence to declare

```text
project AGENTS.md > .omp/RULES.md > harness global config > harness defaults
```

On conflict, apply project rules and proceed; do not ask the user to arbitrate a
harness-vs-project conflict.

## Known pitfalls

1. **Duplicate skills.** Claude personal skills can shadow project skills; Codex
   keeps duplicates. Install project skills project-locally.
2. **Different entrypoints.** A `CLAUDE.md` can disable Claude's `AGENTS.md` read;
   Gemini defaults to `GEMINI.md`; OpenCode v2 ignores `CLAUDE.md`.
3. **Root-only paths.** OpenCode resolves `skills` paths from the start directory;
   start at the repo root or add a harness-native mirror.
4. **Context budget.** Keep `AGENTS.md` short (Claude recommends under 200 lines)
   and skill bodies under ~500 lines; new skills should keep their own references
   one level deep. Shared checklists in `.omp/references` are part of the full pack
   (copy install), not standalone skills.
5. **Symlinks on Windows.** Prefer copy or a local junction; never point at UNC
   paths or commit symlinks for Windows contributors.
6. **Untrusted repos.** Project skills are instructions; review them before enabling
   them in a freshly cloned, untrusted repository.

## Sources

- https://agentskills.io/specification
- https://agents.md/
- https://opencode.ai/docs/skills
- https://opencode.ai/v2/docs/instructions
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/skills
- https://developers.openai.com/codex/skills
- https://geminicli.com/docs/cli/gemini-md/
