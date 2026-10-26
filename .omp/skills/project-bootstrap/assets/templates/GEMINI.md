# GEMINI.md — pointer to the canonical pack

Canonical project adapter: [`AGENTS.md`](AGENTS.md).
Portable rules: [`.omp/RULES.md`](.omp/RULES.md).
Portable profiles: `.omp/skills/agent-profiles/SKILL.md`.
Skills: `.omp/skills/<name>/SKILL.md`; personas: `.omp/agents/*.md`;
checklists: `.omp/references/*.md`.

Before the first action, read `AGENTS.md` and `.omp/RULES.md`. Load `agent-profiles`
at task start and follow the project adapter section. This file is a harness
adapter: it contains no rules and does not override `AGENTS.md`.

Alternatively, set Gemini `context.fileName` to include `AGENTS.md` and use the
same adapter as the other harnesses.
