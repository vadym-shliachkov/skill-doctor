---
name: audit
description: Audit a project area by area.
---

# Audit

- **T** means `node "<SKILL_DIR>/scripts/tool.mjs"`.

1. `T collect --root <ROOT>` writes collect.json.
2. Start one deep:runner subagent per area in parallel; each runs `T context --area <area>` and follows it.
3. `T merge --root <ROOT>` writes findings.json (see references/finding.schema.json).
4. Start a subagent whose task is <SKILL_DIR>/agents/backlog.md.
5. Run `git log -1` and `python scripts/report.py` to finish.
