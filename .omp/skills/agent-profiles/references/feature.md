# Business feature profile

New functionality on an existing surface, or a scoped extension of an existing
module. The adapter lists the surfaces and commands; the graph stays the same.

## Graph

```text
Research → Plan → Fix → Validation → Report
```

The only allowed rollback is `Validation → Fix`. Forbidden: `Research → Fix`,
`Research → Validation`, `Plan → Validation`, `Fix → Plan`, `Fix → Research`,
`Report → *`.

## Stages

| Stage | Role | Produces |
|---|---|---|
| Research | `researcher` (three parallel lenses: architecture, stack, product/acceptance) | facts, integration points, reusable utilities, acceptance criteria, risks |
| Plan | `orchestrator` + `implementer` | touched files, disjoint work packages, approach, risks, verification plan |
| Fix | `implementer` (≤4, disjoint files) | code, tests, docs; focused checks |
| Validation | `reviewer` + `validator` | baseline before/after, plan conformance, regressions, security, runtime smoke |
| Report | `orchestrator` | Report with evidence and residual risks |

Use role names, not harness agent IDs. The adapter maps `researcher` to its
research agent, `implementer` to its edit agent, and so on.

## MUST

- Reuse existing modules and patterns before adding a new abstraction.
- Keep the diff surgical; every changed line traces to the request.
- Add or update behavior tests for the changed contract.
- Run the adapter's baseline and the focused runtime check.
- Record acceptance criteria → status in the Report.

## MUST NOT

- Create a second chokepoint, package, dependency, or build system without explicit
  approval.
- Touch frozen/vendored areas named by the adapter.
- Commit or push unless the project rules allow it.
- Replace a missing check with "seems right".

## Adapter slots

| Slot | Example meaning |
|---|---|
| `surfaces` | which packages/apps the feature may touch |
| `validation.baseline` | static check before/after |
| `validation.focused` | test or runtime command for the changed behavior |
| `frozen` | paths that must not be touched |
| `reportDir` | where stage artifacts live |
| `roles` | harness agent IDs for researcher/implementer/reviewer/validator |
| `constraints` | project-specific design or dependency limits |

## Report fields

- Profile and stage graph actually followed.
- Files/contracts changed.
- Acceptance criteria and status.
- Baseline and focused checks with output evidence.
- Security notes for new input/output boundaries.
- Risks, assumptions, open questions.
- Loop metrics if the adapter enables them.
