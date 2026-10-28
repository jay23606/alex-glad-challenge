# Project graph profile

A map of the project: nodes, edges, and structural conclusions. The output is a
graph and a short interpretation; code changes are zero.

## Graph

```text
Graph (read-only)
```

If the request turns into "fix this dependency", switch to `business-feature` or
`bug-search`; do not edit inside Graph.

## MUST

- Build edges from real imports/calls/registered routes, not from names.
- Use the adapter's layers when provided; otherwise:
  `surfaces (CLI/TG/MCP/web) → server/adapters → core modules → data`.
- Mark unproven edges as `INFERRED`.
- Report god modules, cycles, boundary violations, and dead or duplicate paths.
- Update an existing graph incrementally; do not rebuild from scratch when the
  adapter provides an update command.
- Exclude frozen/vendored areas unless the user explicitly includes them; mark them
  if included.

## MUST NOT

- Edit files, commit, install packages, or run mutating generators.
- Invent nodes or edges to make the picture look complete.
- Treat a graph tool's output as ground truth without checking the source.
- Include secrets, tokens, or private URLs in node labels.

## Optional graph provider

If the adapter names a graph skill/tool, use its query command for known graphs and
its incremental update for changes. If it is absent, use imports/calls and say the
graph is source-derived, not tool-verified.

## Output format

1. **Mermaid graph** — genuine structure/flow only.
2. **Node legend** — `path` + role.
3. **3–5 structural findings** — god nodes, cycles, boundary violations, risky
   coupling.
4. **Limitations** — what was excluded or not verified.
