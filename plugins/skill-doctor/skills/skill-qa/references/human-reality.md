# Human reality: you are not the reader

You review the output as a model. You read a page in milliseconds, click without looking for the button, wait for nothing and already know how the output was built. The reader does none of that. Two kinds of problem hide in that gap, and screenshots and scores don't show them:

- **Claims about the reader's effort that only hold at machine speed:** "about 6 min", "2 h for the whole plan", "a quick check", "one step".
- **Things that are only clear if you know the source:** a block that continues from the last page but looks like a new item, two blocks that look identical but do different jobs, a code nobody explained, an order that only the template knows.

Use this reference in the static review (step 1), the hands-on pass (step 7) and whenever you grade text or design for a human reader.

## 1. Estimating human time bottom-up

Estimate one unit of work (a test, a flow, a section, a task) the way the reader would live it. The numbers below are rough heuristics, good enough to tell 6 minutes from 20. Say they are estimates when you use them.

| Part | What it covers | Rough guide |
|---|---|---|
| **Read and understand** | Reading every word of an instruction they have to follow, re-reading the unclear parts, looking up a term or code | ~150–200 words a minute for instructions; slower for a junior, a non-native reader or dense text. Add re-reading for anything ambiguous |
| **Orient** | Finding the page, the menu, the field, the right row in a checklist; switching between the document and the thing being tested | 15–30 s per navigation, more the first time; 10–20 s per switch between two windows or documents |
| **Do** | Typing, choosing, uploading, waiting for page loads, logging in and out, preparing test data | 10–20 s per form field; 30–60 s per login; ~1 min to find and attach a file |
| **Wait** | Anything the output itself says to wait for: an email "within 10 minutes", a cron, a cache, an approval | Use the output's own figure. A wait inside a unit counts in full unless the reader is told to do something else meanwhile |
| **Coordinate** | Steps that need another person or role: "ask HR to forward the email", "an admin approves the account" | Minutes to hours, and not under the reader's control. At the least, the unit can't finish until that person answers |
| **Record** | Marking the result, writing a note, taking and attaching a screenshot when something fails | ~30 s per pass; 2–5 min per failure (note plus screenshot) |
| **Set up and recover** | Accounts, test data, clearing a cart, resetting state between runs, a step that fails and is retried | Often forgotten entirely; count it once per session and once per retry |
| **Stamina** | Sessions longer than ~90 min need breaks; attention drops and re-reading rises | Add ~10% per extra hour, or split the work across sittings |

A unit's honest time is the sum, not the time to perform its clicks.

## 2. Checking a time or effort claim

1. **Find every place the output states effort:** per-item times, totals, "quick", "takes a minute", "one step", progress bars, counts of "things to do".
2. **Find where the number comes from** (step 1's "where does each visible value come from"). If it is a formula, list its terms and compare them with the table above. A formula with only "per step" terms ignores reading, waiting, coordinating and recording, and will under-estimate every unit that has them.
3. **Estimate two units bottom-up:** the longest one and a typical one. Write the parts, not just the total.
4. **Compare.** A gap of more than about 1.5× is a finding. Its severity depends on what the reader does with the number: a lead who books a tester's afternoon on "2 h" and gets a day-long job is misled (Major); a rough "about 5 min" on a one-off task that takes 8 is a Nit.
5. **Look for contradictions inside the output:** a unit estimated at 6 min that contains "within 10 minutes"; a total that is less than the sum of its waits; a step that depends on another person with no word on when to ask them.
6. **Look for dependencies the plan doesn't schedule:** another person, a time window, an email, an approval, data that has to exist first. The reader needs to know these before starting, not when they reach the step.

## 3. The confusion hunt

You know how the output was made; the reader only sees it. Look for these on purpose, in the rendered output (not the source), as the reader moves through it:

- **New or continued?** A card, table or section split over a page break, a scroll or a slide break. If the second part repeats the same header in the same style with no "continued" mark, it reads as a new or duplicate item.
- **Same look, different job.** Two blocks styled alike that play different roles (a description and an instruction; an example and a real item; a model-checked code and a code the reader has to check). The reader assumes alike means alike.
- **Different look, same job.** The same kind of item styled two ways, so the reader wonders what the difference means.
- **Unexplained codes and labels.** Ids, chips, badges and abbreviations with no key the reader can find from where they are.
- **Hidden order.** The reader needs to do A before B, but nothing on the page says so, or the warning comes after the action.
- **Where am I?** After a page turn or a scroll, can the reader tell which item, chapter or step they are in?

For each one you find, say what the reader would think, what they would do as a result, and what that costs them.

## 4. The reader's real working conditions

Fill these in the context profile (`references/context-profile.md`) and use them in every judgement above:

- Do they go through it in **one sitting or across days**? Interrupted by other work?
- **On screen or printed?** Next to another tool (a checklist, the site, an inbox)?
- **Who else** do they depend on, and how reachable are those people?
- **How much time** have they been given, and who uses the estimate to plan it?
- **What happens when they misunderstand?** A wasted afternoon, a real email sent to a client, a missed defect?
