# Extending profiles

Add a profile only when the existing four cannot express a distinct stage graph or
verification artifact. Do not add a profile that is just a different wording for
`business-feature`.

## Checklist

1. **Trigger** — add keywords (all supported languages) to `selection.md`.
2. **Reference file** — add `references/<profile>.md` with:
   - purpose (one paragraph);
   - stage graph and allowed rollbacks;
   - stage table: stage → role → artifact;
   - MUST / MUST NOT;
   - adapter slots;
   - report fields.
3. **Report** — add profile-specific fields to `report.md` only if they are not
   covered by the generic sections.
4. **Adapter** — add the project-specific commands/paths to the project's
   `AGENTS.md` adapter; never hardcode them in this pack.
5. **Live run** — exercise one real task. Record the artifact path and the
   validation evidence. If the first run required fixes, record the cause and the
   change in the project changelog/report.
6. **No router** — do not add a persona whose only job is selecting a profile.
   Selection belongs to `SKILL.md`; execution belongs to the roles.

## Anti-patterns

- A profile that skips Validation or Report.
- A profile that hardcodes `pnpm`, a repo path, a tracker label, or a harness agent
  ID. Those belong in the adapter.
- A profile whose stages overlap another profile without a different verification.
- A "meta" profile that calls other profiles. The orchestrator handles composition.
