# Report template

A profile is incomplete without a Report. Replace placeholders with the project
adapter's values; keep the section order.

```markdown
# <Slug> — <YYYY-MM-DD>

## Profile
<business-feature | bug-search | research | project-graph>
<stage graph actually followed; note any switch and why>

## What was done / Answer
- <change or answer>
- <files/contracts touched>
- <acceptance criteria → status>

## Checks
- [ ] Baseline: `<validation.baseline>` — <result>
- [ ] Focused: `<validation.focused>` — <result>
- [ ] Runtime/smoke: `<runtime>` — <result>
- [ ] Regression: `<test>` — <result or n/a + reason>

### Security checklist
- [ ] Secrets only in the project's secret store; none in code/logs/commits.
- [ ] SQL uses placeholders (if the project uses SQL); no interpolation of user
      input.
- [ ] External content named by the adapter is treated as tainted and sanitized
      before DB/prompt/fetch.
- [ ] Client bundle contains no server secrets (if the project has a client).
- [ ] Bind/network rules from the adapter are respected.

## Risks / assumptions
- <risk>
- <assumption>

## Open questions
- <question or "none">

## Loop metrics (only when the adapter enables loop mode)
- <metric command/output or n/a>
```

Rules:

- Every check is a command or a concrete observation, not "looks right".
- A skipped check is `n/a` with a reason. It is not a pass.
- Link stage artifacts by path; do not paste large logs.
- Keep secrets, tokens, `.env` values, and credential-bearing URLs out of the
  Report.
- For `research`, "Checks" becomes "Evidence": the commands/searches used and the
  `path:line` sources.
- For `project-graph`, include the mermaid graph and limitations.
- For loop runs, include the tracker/milestone and the metric output; missing
  instrumentation is `n/a`, not zero.
