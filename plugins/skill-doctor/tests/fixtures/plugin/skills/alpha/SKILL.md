---
name: alpha
description: Collects input then hands over.
---

# Alpha

1. Dispatch one subagent with `subagent_type: demo:checker` per file, in parallel.
2. Then invoke `/demo:beta` to write the report.
3. Do NOT invoke frontend-design for this.
