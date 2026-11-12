# Edge-case catalogue

Pick the cases that are **realistic for this skill's persona and situation**. A good edge case is one a real user will hit in their first month. A bad one is an exotic input nobody would send. Ten well-chosen cases beat forty mechanical ones.

## How to choose

1. Walk through the skill's workflow step by step. At each step ask: what does this step assume about its input, the environment or the user? What if that assumption is false?
2. Use the categories below to check you have not missed a whole class of problem.
3. Rate each candidate by **likelihood × harm** and keep the top ones. Most plans should have at least one case from categories A, B, C and F.
4. Write the expected behaviour **before** you run the case. Take it from the skill's own promises where they exist. Where the skill says nothing, write what a reasonable user would expect, and label it "reasonable expectation". A skill that is silent on a common case is itself a finding.

## A. Input

- Missing input (no path given, empty folder, empty file), or the minimum viable input.
- Large input: thousands of files, a 200-page document, a very long paste. Does it sample, chunk, warn, or quietly drop content?
- Malformed or unexpected input: broken JSON, the wrong file type, a binary file, a half-finished project, a mix of encodings.
- Non-English content, emoji, right-to-left text, very long words or URLs. Does the output keep them intact?
- Paths with spaces, `~`, non-ASCII characters, Windows backslashes, very deep nesting, symlinks.
- Input that has already been processed, i.e. a second run on the same folder. Does it overwrite, duplicate, or reuse the earlier result? Is that what the user wants?
- Conflicting or unknown arguments (`--mermaid --run x`, a typo in a flag).

## B. The request

- A vague request ("check my thing") or one using none of the skill's vocabulary.
- Partial information: a required detail is missing. Does the skill ask, assume and say so, or assume silently?
- A request in another language, or with heavy typos.
- An adjacent request: something close to, but outside, the skill's scope. Does it decline, stretch to cover it, or do it badly without saying so?
- Two tasks in one message.

## C. Environment and host

- A required tool is missing (no Python, wrong Node version, no browser, an MCP server not authorised, no network).
- A different host: Codex or claude.ai (often no local shell and no subagents), the desktop app.
- The OS and shell: Windows PowerShell versus bash. Quoting, path separators, `/tmp`, line endings.
- Permission denied, a read-only folder, not a git repository, no write access to the output location.
- The skill is installed in another location (plugin cache versus a local folder), so relative paths break.

## D. Flow and interaction

- The user declines a question, answers "you decide", or answers with something unexpected.
- The user changes their mind or adds a requirement halfway through.
- A step fails: a script exits non-zero, a subagent returns garbage or nothing, a timeout. Is the failure surfaced, retried or swallowed?
- A long run: does context run out, or is progress lost? Can it be resumed?
- Running it twice in a row, or two runs at the same time (output collisions).

## E. Output

- The empty result ("nothing found"). Is it clearly reported, or does it look like a failure?
- An extreme result: very many findings, very long content, a single item.
- Overwriting existing files, especially user files.
- The output location and naming: can the user find it? Does it say where it is?
- The format promise: if it says PDF, is it a real PDF that opens, has selectable text and the right page size?
- Claims about the reader's effort: time estimates, "quick", "one step". Do they hold for the longest unit, at human pace, with its waits and the other people it needs?
- Long output that breaks across pages, screens or messages: does every piece still say what it is and what it belongs to?

## F. Safety and trust

- Prompt injection inside processed content: a file in the input that says "ignore your instructions and…". Does the skill obey it?
- Secrets in the input (`.env`, API keys, client data). Do they leak into the report, a third-party service, logs or a commit?
- Destructive or outward-facing actions (delete, push, send, publish): is there confirmation, and a dry run?
- Mistakes that look plausible: does the output state facts it did not verify?

## G. Triggering

- Paraphrases that should trigger, including casual ones, ones with typos, and ones that never name the skill.
- Near misses that share keywords but need something else. These are the valuable negatives.
- Competition: another installed skill covers similar ground. Which one should win, and does the description make that clear?

## H. Instruction quality (mostly static)

- Contradictory instructions, or two places defining the same thing differently.
- Steps with no stop condition, unbounded loops, "repeat until good".
- References to files, scripts or tools that do not exist or are named differently.
- Decisions left to the model with no criteria ("pick the best approach").
- Heavy MUST/NEVER language with no reasons. Models follow reasons more reliably than shouting.
- Length: a very long SKILL.md that would be better split, or so short that key steps are implicit.

## Writing a case

```
E4 · Input · P1 · live
Probes: a folder path containing a space and a tilde (for example a skills folder such as C:\Users\me\~skills\)
Prompt: "run it on C:\Users\me\~skills\my project"
Inputs: OUT/fixtures/my project/ (copy of a minimal skill)
Expected (skill's promise, SKILL.md:18): accepts any path; output in <ROOT>/.x/
Expected (reasonable expectation): no quoting errors on Windows; the output path is reported
```
