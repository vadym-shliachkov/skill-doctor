---
name: runner
description: Runs the build and writes the state. Use when asked to build.
allowed-tools: Read, Bash(node:*)
---

# Runner

1. Read the task from .out/<run>/input.json.
2. Run `node scripts/go.mjs build` to build into .out/<run>/state.json.
3. Run `git status` to see what changed.
4. Run `node scripts/gone.mjs` to clean up.
5. Read .out/<run>/plan.json and .out/<run>/state.json.
6. Read data/seed.json and write data/result.json for the worker.
7. Write .out/<run>/log.json and hand .out/<run>/report.md to the user.
