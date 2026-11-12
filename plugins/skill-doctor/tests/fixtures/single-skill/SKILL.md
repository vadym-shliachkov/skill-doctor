---
name: alpha
description: Turns notes into a summary report. Use when asked to summarise notes.
---

# Alpha

## Steps

1. Read `references/style.md` for the house style.
2. Run `node scripts/build.mjs collect` to gather the notes into notes.json.
3. Ask the user to approve the outline. STOP until they answer.
4. Write report.md from notes.json.
