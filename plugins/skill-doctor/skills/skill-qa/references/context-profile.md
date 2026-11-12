# Usage-context profile

The profile answers one question: **who uses this skill, for what, and who lives with the result?** Every later judgement (which edge cases matter, whether a text is clear, whether a design works) is measured against it.

## The fields

| Field | Question to answer | Where to look |
|---|---|---|
| **Invoker** | Who types the request? What is their role and expertise (developer, designer, PM, consultant, non-technical)? What language do they write in? | `description`, examples in the body, README, the trigger phrases, the jargon the skill uses with the user |
| **Situation** | What just happened that makes them reach for it? How often (one-off, daily, at release time)? How urgent is it? | The trigger wording ("when asked to…", "before a release…"), argument hints, any described workflow |
| **Inputs** | What do they hand over: files, a URL, a repo, pasted text, nothing? How big and how messy is it in real life? | Arguments, the first steps of the workflow, scripts that parse input |
| **Environment** | Host (Claude Code, Codex, claude.ai, the desktop app), OS and shell, available tools (Node, Python, browser, MCP servers), network, subagents | Setup sections, `allowed-tools`, script requirements, host-specific branches |
| **Outputs** | What is produced: a reply, a file (format?), a page, a PDF, a change to the repo, a message sent somewhere? Where does it land? | Last steps, templates, render scripts, "tell the user" sections |
| **Output reader** | Who reads or uses the output, and is that the invoker? (a client, a manager, an end user, another agent, a CI job) What do they already know, and on what device do they read it? | Templates (who they address), tone, branding, "send to…" steps, the format chosen (a branded PDF usually means an external reader) |
| **Reader's working conditions** | How do they actually work through the output: in one sitting or across days, interrupted or not, on screen or printed, next to which other tool? Who else do they depend on (an admin, HR, the client), and how reachable are those people? How much time have they been given, and who plans with the skill's time estimates? | The output's own instructions (waits, "ask the admin", "print this"), the situation, the reader's role. Usually inferred, so say what it rests on |
| **Success** | What can the reader *do* afterwards that they could not do before? What would make them say "this was worth it"? | The skill's stated purpose, plus your judgement of the reader's real goal |
| **Constraints** | Time and cost budget, privacy (client data?), irreversibility, branding rules, accessibility needs | Warnings in the skill, confirmation steps, anything about secrets or approval |

For each field write the answer, then a confidence mark:

- **stated:** the skill says it. Cite `file:line`.
- **inferred:** strongly implied. Cite the signal, for example "template opens with 'Dear client', so the reader is external".
- **guess:** a plausible default with weak evidence. Guesses about the invoker, situation, output reader or success go to the user (step 3).

## Traps to watch for

- **The invoker is not the reader.** A developer runs the skill, but the PDF goes to a client who has never heard of "lint" or "LCP". Judge the text for the client.
- **There can be several readers.** A report often has a skimming decision-maker and a detail-reading implementer. Name both, say which section serves whom, and judge each section for its own reader.
- **Another agent can be the reader.** Agent prompts, JSON handed between steps and files another skill consumes are read by a model. Judge them on whether they are unambiguous and parse, not on prose style.
- **The real environment is not your environment.** If the skill will mostly run in claude.ai or Codex, a step that needs a local shell is a real defect even if it works on this machine.
- **Language.** If the invoker writes in another language or with typos (common), check that the skill copes, and whether its output should be in the reader's language.
- **Your speed is not the reader's speed.** You read a page in a moment and wait for nothing. A person reads every word of an instruction they must follow, finds each button, waits for the email and writes the note. Judge times, effort and "quick" claims at their pace (`references/human-reality.md`).
- **You know the source; the reader doesn't.** Having read the template, you know a block is "the same card, continued". The reader only sees two blocks that look alike. Judge what is on the page, not what you know is behind it.
- **Frequency changes what matters.** For a daily skill, speed and low friction matter. For a quarterly report, accuracy and polish matter more than runtime.

## Example

> **Invoker:** web agency developer, comfortable in a terminal, writes informal English with typos (inferred from the README examples).
> **Situation:** a client asks "how healthy is our site?"; the developer runs it once per client engagement (inferred: plugin description, "per project").
> **Inputs:** a local checkout of the client's website repo, 1k–50k files (inferred).
> **Environment:** Claude Code on Windows and macOS, Node 22, Playwright MCP available (stated: SKILL.md:12).
> **Outputs:** a checklist (Markdown), a branded PDF report and an optional backlog (stated: plugin.json).
> **Output reader:** the PDF goes to the **client's non-technical stakeholders** (inferred: branded and written in prose). The checklist and backlog go to the developer.
> **Reader's working conditions:** the stakeholders skim the PDF on a laptop between meetings and forward it internally; the developer works through the backlog over a sprint (inferred).
> **Success:** the client understands the state of the site and agrees to the proposed work. The developer can turn the backlog into tickets without rewriting it (guess, so confirm with the user).
> **Constraints:** client code is private and must not be sent to third-party services (inferred).
