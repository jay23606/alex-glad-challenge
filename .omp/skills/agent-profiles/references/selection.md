# Profile selection

## Trigger table

Match the request, not the file you happen to have open. Keywords may be in any
language; the profile names stay stable.

| Profile | Strong triggers | Typical outputs |
|---|---|---|
| `business-feature` | add, implement, build, feature, integration, endpoint, route, CLI command, new capability, «добавить», «реализовать», «фича», «интеграция», «endpoint», «команда CLI» | code + tests + docs + Report |
| `bug-search` | bug, error, crash, failing, regression, stack trace, reproduce, broken, «баг», «ошибка», «падает», «не работает», «регрессия», «стек-трейс», «воспроизвести» | root cause + fix + regression test + Report |
| `research` | how does it work, find, which, where, assess, explain, compare, «как устроено», «найди», «какие», «где», «оцени»; explicitly no edits | answer with `path:line` evidence; no changes |
| `project-graph` | graph, map, dependency map, component links, feature map, architecture picture, «граф», «карта проекта», «связи компонентов», «схема фич» | mermaid graph + node legend + structural findings |

## Decision rules

1. **Edits decide the family.** If the user asks for a change, the profile is
   `business-feature` or `bug-search`; if not, `research` or `project-graph`.
2. **Bug evidence wins over feature wording.** "Fix the endpoint that crashes" is
   `bug-search`, not `business-feature`.
3. **A question about structure is `project-graph`** only when the user wants the
   map itself. "Where is this function called?" is `research`.
4. **Two matches:** prefer the profile whose verification is stricter. A bug fix
   with tests beats a feature flow without a reproduction.
5. **No match:** default to `business-feature` for change requests, otherwise
   `research`. State the choice in one line; do not ask.

## Announcement

Use the label supplied by the project adapter. Default labels:

```text
profile: business-feature
profile: bug-search
profile: research
profile: project-graph
```

The project may localize the label (for example «профиль: Бизнес-фича»). The
label is cosmetic; the stage graph is not.

## Switching

Switch profiles only when the premise was wrong and the current graph cannot
produce the requested artifact (for example, "add a feature" turns out to be a
production regression with an existing failing test). Announce the switch and the
reason in one line, and record it in the Report. Do not switch to avoid a stage.

## Examples

| Request | Profile | Why |
|---|---|---|
| "Add a `/api/export` endpoint with validation" | business-feature | new capability + edits |
| "The export endpoint returns 500 for empty input" | bug-search | defect + reproduction |
| "Which module owns the export endpoint?" | research | no edits |
| "Map the export feature across CLI, web, and storage" | project-graph | wants the map |
| "Rename this variable" | none of the staged profiles | trivial single edit; apply the project rules and verify |

A trivial change that does not need a multi-stage graph should say so and use the
project's normal edit/verify loop. Do not invent a profile for it.
