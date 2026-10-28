# Bug search profile

A defect, regression, crash, or wrong runtime behavior. The target is the root
cause, not the symptom.

## Graph

```text
Diagnose → Reproduce → Fix → Validation → Report
```

Allowed rollbacks: `Reproduce → Diagnose` when the hypothesis is disproved, and
`Validation → Fix`. Forbidden: `Diagnose → Fix`, `Fix → Diagnose`,
`Reproduce → Validation`, `Report → *`. The total rollback budget is 2; then stop
and report.

## Stages

| Stage | Role | Produces |
|---|---|---|
| Diagnose | three `researcher` lenses: hypothesis generator, code tracer, counter-censor | a ranked hypothesis with evidence; each writes its own artifact |
| Reproduce | `validator` | a deterministic minimal reproduction, before edits |
| Fix | `implementer` | root-cause fix + regression test (Prove-It) |
| Validation | `reviewer` + `validator` | reproduction no longer occurs; baseline and focused checks green; no new regressions |
| Report | `orchestrator` | root cause, repro steps, fix (file:line), evidence, regressions |

Reproduction starts only after a hypothesis is confirmed by evidence. Do not start
Fix from a plausible guess.

## MUST

- Reproduce deterministically with the smallest run before changing code.
- Add a regression test that fails before the fix and passes after it.
- Fix the root cause; explain why the symptom disappeared.
- Run the adapter's baseline and the focused check after the fix.
- Record the exact commands and observed output.

## MUST NOT

- Start Fix without a confirmed reproduction.
- Fix the symptom, suppress the error, or special-case the failing input.
- Make a fourth reproduction attempt.
- Refactor adjacent code, rename unrelated symbols, or "clean up" during the fix.
- Hide a regression behind a disabled test or a loosened assertion.

## Adapter slots

| Slot | Meaning |
|---|---|
| `repro` | command/scenario that demonstrates the defect |
| `validation.baseline` | static check before/after |
| `validation.focused` | test file/command for the regression |
| `runtime` | browser/device/CLI smoke instructions |
| `reportDir` | evidence directory |

## Report fields

- Root cause, with `path:line` evidence.
- Reproduction steps and observed failure.
- Fix location and why it addresses the cause.
- Confirmation that the failure no longer reproduces.
- Regression test added/updated.
- Remaining risks and related findings.
