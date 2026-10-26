# CLAUDE.md — указатель на канонические правила

Канонический источник правил проекта — [`AGENTS.md`](AGENTS.md). Sticky-инварианты —
[`.omp/RULES.md`](.omp/RULES.md). Workflow-скиллы — `.omp/skills/<name>/SKILL.md`;
профили — `.omp/skills/agent-profiles/SKILL.md`; перенос pack'а —
`.omp/skills/project-bootstrap/SKILL.md`. Персоны — `.omp/agents/*.md`;
чек-листы — `.omp/references/*.md`; манифест — `.omp/pack.json`.

Перед первым действием прочитайте:

1. `AGENTS.md`, особенно §0.1 (harness entrypoint), §13 (проектный adapter
   профилей), §13.1.1 (loop-дефолты без вопросов), §13.9 (issues/метрики).
2. `.omp/RULES.md` — переносимые жёсткие инварианты.
3. На старте задачи загрузите `agent-profiles`; не загружайте все скиллы сразу.

Этот файл — harness-адаптер Claude Code, а не источник правил. Он не дублирует и
не переопределяет `AGENTS.md`; при расхождении побеждает `AGENTS.md`. Исторические
версии этого файла — в git-истории, восстанавливать их сюда не нужно.
