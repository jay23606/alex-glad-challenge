# Global engineering rules

> **Historical (ADVANCED Day 1).** Superseded by `AGENTS.md` and `.omp/RULES.md`.
> Do not follow this copy.

These rules apply to every project. A project's `AGENTS.md` / `.omp/RULES.md`
is more specific and wins on conflict.

- Answer in the user's language (default Russian if the user writes Russian).
- Read the repository's existing patterns before editing; prefer them over new
  abstractions or dependencies.
- Never hardcode, print, or commit secrets: API keys, tokens, sessions,
  passwords, credential-bearing URLs.
- Do not commit, push, rewrite history, or delete unrelated work unless the
  user explicitly asks.
- Keep changes surgical. Do not reformat or rename unrelated code.
- Use the repository's declared validation commands. If a linter/test/build
  script is absent, say so; do not invent one.
- Report what you actually ran. Mark unverified claims as `[INFERENCE]`.
- If a task is ambiguous and the repository cannot answer it, ask once with
  concrete options; otherwise proceed with the conservative choice.
