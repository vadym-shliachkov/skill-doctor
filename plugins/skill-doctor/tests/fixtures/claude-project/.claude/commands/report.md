---
description: Build the weekly report.
argument-hint: <week>
---

# Weekly report

1. Read `data/sales.csv` for the week given in the arguments.
2. Run `py scripts/report.py build <week>` to draw the charts.
3. Dispatch one `reviewer` subagent (Agent tool, subagent_type `reviewer`) to check the numbers.
4. If the reviewer finds a problem, fix it and run step 2 again.
5. Ask the user to approve the report. STOP until they answer.
6. Write `out/report.md` and tell the user where it is.

Never edit `data/sales.csv`.
Keep the report under two pages.
Use the house chart colours.
