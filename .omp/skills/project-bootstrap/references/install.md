# Installing and updating the pack

The pack is the `.omp/` directory: rules, skills, personas, references, templates,
and `pack.json`. Project-specific facts live in `AGENTS.md`.

## Transport options

| Mechanism | Reproducible | Windows | Use when |
|---|---|---|---|
| Copy `.omp/` | Yes, if committed | Good | **Default**; simplest and portable |
| Git submodule at `.omp/` with links | Yes (pinned SHA) | Good | Teams/CI that want one source |
| Junction/symlink to a local clone | No (moving target) | Junction OK on a local volume; no UNC | Solo developer, fast iteration |
| `npx skills add ./...` | Skill source/ref in the user lock | Junction default, `--copy` fallback | Standalone skills only; some workflow skills reference `.omp/references`, so use copy/submodule for the full pack |

`npx skills` is the de facto Agent Skills installer, but it does not install rules,
profiles, or personas. Do not treat it as the pack manager.

## Copy install

1. Copy `.omp/` into the target, excluding caches and target artifacts.
2. Rename `assets/templates/AGENTS.project.md` to `AGENTS.md` (or merge it into an
   existing adapter), copy `opencode.json`/`CLAUDE.md`/`GEMINI.md` to the root, and
   put `cursor-rules.mdc`/`copilot-instructions.md` at their harness paths.
3. Fill `AGENTS.md` using the adapter checklist.
4. Generate/verify harness adapters.
5. Record the pack version (`pack.json`) and the source commit in the project's
   report or changelog.

On Windows PowerShell:

```powershell
Copy-Item -Recurse -Force .omp <target>\.omp
```

On POSIX:

```bash
cp -R .omp <target>/.omp
```

## Update

- Copy install: re-copy the pack, then diff `AGENTS.md` and the adapters. Never
  overwrite a project adapter silently.
- Submodule: update the pinned tag, then re-run the validation checklist.
- Junction: update the source clone; restart the harness so skill discovery sees
  the new files.
- `npx skills`: `npx skills check`, then `npx skills update`; review the diff.

## Validation after install

```bash
node -e "JSON.parse(require('fs').readFileSync('opencode.json','utf8')); console.log('json ok')"
opencode debug config
opencode debug skill
```

`opencode debug skill` may return a partial list on the first run while discovery
completes; start at the repository root and re-run. Judge by resolved `location`
paths, not by the first count.

## Do not

- Keep a second editable copy of the same skill in a global directory.
- Commit symlinks if Windows contributors are expected.
- Put project commands, package names, tracker labels, or harness agent IDs into
  the pack's portable skills.
- Let `CLAUDE.local.md` silently disable `AGENTS.md` loading in a project that
  relies on the pack.
