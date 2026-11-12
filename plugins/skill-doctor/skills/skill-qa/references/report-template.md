# Report template

The reader is the skill's **author** (or whoever decides whether it ships). They want the verdict first, then the problems ranked by impact, each one concrete enough to act on without redoing your work. Leave out sections that do not apply, such as Design when the skill produces nothing visual, and say in one line why they were left out.

Use this structure:

```markdown
# QA report: <skill name>

<date> · target: `<path>` · run folder: `<OUT>`

**Verdict: Ready | Ready after fixes | Not ready.** <One sentence: the main reason.>

| Area | Result |
|---|---|
| Main purpose | <Pass/Partial/Fail> (<n>/<m> cases) |
| Edge cases | <n> pass · <n> partial · <n> fail · <n> blocked |
| Text quality | <score>/5 for <reader>, or "n/a" |
| Design quality | <score>/5, or "n/a" |
| Findings | <n> critical · <n> major · <n> minor · <n> nits |

## Fix these first
1. **<F-id> <title>.** <One sentence on what goes wrong, for whom, and the consequence.>
2. …
3. …

## Assumptions and open questions
- <An assumption made in place of an answer from the user, and which conclusions depend on it.>
- <Questions the author should answer; anything you could not determine.>

## Who uses this skill
| | |
|---|---|
| Invoker | … (stated/inferred/guess) |
| Situation | … |
| Inputs | … |
| Environment | … |
| Outputs | … |
| Output reader | … |
| Working conditions | … |
| Success means | … |

## What was tested
- **Size tier:** <Small | Medium | Large>, <time taken>.
- **Live runs:** <ids>. **Probes:** <ids>. **Walkthroughs:** <ids> (why each was not run live).
- **Not tested:** <what, and why: missing tools, credentials, cost, out of scope>.
- **Independence:** <runs done by fresh subagents | done in this session, so not independent>. Name any runs where the skill's own agents were refused or ran sequentially.

## Side effects of this QA
Anything written, changed or contacted outside the run folder, by the runs or by you, with full paths. If nothing, write "None: everything stayed in `<OUT>`."

## Main purpose
For each main-purpose case: the request, what happened, the verdict, and *whether the reader could do what they came to do*. With a baseline, say what the skill added.

## Hands-on
What you did with the output as its reader, and what you ran into. Each problem is also listed under All findings. For a human reader, include:
- **Time, stated vs human pace:** each figure the output states, next to your bottom-up estimate for the same unit and its main parts (read, do, wait, other people, record).
- **Cold read:** what the cold reader stumbled on, and which of those you confirmed as findings.

## Edge cases
| ID | Priority | Mode | Category | Scenario | Expected | Observed | Verdict | Severity |
|---|---|---|---|---|---|---|---|---|

Follow the table with a short paragraph only for the cases whose verdict needs explaining.

## Triggering (judged, not measured)
| Query | Should trigger? | Judgement | Why |
|---|---|---|---|

## Text quality
For each text output: who reads it, the score table (dimension · score · evidence quote), the reader's leftover questions, and the key issues.

## Design quality
For each visual output: the five-second impression, screenshots (relative links), the score table with the guideline cited, probe highlights, then **Opinions** (taste) as a separate list.

## Static review of the skill files
Issues in the SKILL.md and its resources: description and triggering, contradictions, missing files, host assumptions, error handling. Cite `file:line`.

## All findings
For each one, ordered by severity, then by how likely it is:

### F<n> · <Critical|Major|Minor|Nit> · <short title>
- **Where:** <file:line, case id, page or screenshot>
- **What happens:** <observed behaviour>
- **Why it matters:** <the effect on the named persona or reader>
- **Recommendation:** <what should change and why, described in words. No patch.>
- **Evidence:** <quote, log excerpt, probe value, image link>

## Suspicions
Things that look wrong but could not be confirmed. Say what would confirm each one.

## Appendix
Run index (case → folder), fixtures used, tool versions, time taken.
```

## Round N of a fix loop (`--fix`)

A regression round uses the same template, with these changes:

```markdown
# QA report, round <n>: <skill name>

<date> · target: `<path>` · run folder: `<OUT>/round-<n>` · previous round: `../round-<n-1>/report.md` · fix log: `../round-<n-1>/fix-log.md`

**Verdict: …** <One sentence: what the fixes achieved and what is still wrong.>

## Earlier findings
<Every finding from the previous round, plus any older one that is still open. Findings closed in an earlier round are not restated.>

| Finding | Severity | Fixer's decision | Status now | Evidence |
|---|---|---|---|---|
| F1 | Major | fix | Fixed / Partly fixed / Not fixed / Regressed | <case id, quote> |
| F4 | Major | defer | Open: author question | <the question> |
| F9 | Minor | reject | Agree / Disagree: <why> | … |

## New findings
<Findings introduced by the fixes or newly found, numbered on from the last round's ids.>
```

Keep the other sections short: say what was re-run and why, and leave out what didn't change since the previous round.

## The loop summary (`OUT/loop.md`)

```markdown
# Fix loop: <skill name>

Target: `<path>` · rounds: <n> of <max> · stopped because: <no Critical or Major left | round limit | fixer changed nothing | finding came back twice>

| Round | Verdict | Critical | Major | Minor | Nit | Fixed in the fix round after it |
|---|---|---|---|---|---|---|

<Counts are the findings open at the end of that round. A partly fixed finding counts once, at the severity of what is left.>

## What changed in the skill
- `<file>`: <one line> (round <n>, fixes F<k>)

## Questions for the author
- <deferred finding>: <question> · recommended: <answer>

## Way back
The skill before the first fix: `round-1/target-before/files/`. Later snapshots: `round-<n>/target-before/files/`.
```

## Writing rules for the report itself

- The verdict and "Fix these first" must stand on their own for someone who reads nothing else.
- Use finding ids (`F3`, `E4`, `T2`, `D1`) consistently, so the author can cross-reference them.
- Name the reader in every quality judgement ("for the client's stakeholders, …").
- Quote, don't paraphrase, when the wording is the problem.
- Recommendations describe the change and the reason. They do not contain replacement files, diffs or rewritten prompts. That is the author's job, and keeping the two apart keeps this an independent QA.
- If everything passed, say so plainly, then list what was *not* covered so the result is not over-read.
- If `report.md` cannot be written, the whole report goes in your final message instead. Do not try another way to write it.
