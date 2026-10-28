# CLAUDE.md — pointer to the canonical pack

Canonical project adapter: [`AGENTS.md`](AGENTS.md).
Portable rules: [`.omp/RULES.md`](.omp/RULES.md).
Portable profiles: `.omp/skills/agent-profiles/SKILL.md`.
Skills: `.omp/skills/<name>/SKILL.md`; personas: `.omp/agents/*.md`;
checklists: `.omp/references/*.md`.

Before the first action, read `AGENTS.md` and `.omp/RULES.md`. Load `agent-profiles`
at task start and follow the project adapter section. This file is a harness
adapter: it contains no rules and does not override `AGENTS.md`.

If Claude Code loads this file instead of `AGENTS.md`, keep this pointer short and
do not add project facts here.
