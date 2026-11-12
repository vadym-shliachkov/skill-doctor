# Text-quality rubric

Grade text **for its reader**, as named in the context profile. The same paragraph can score 5 for a senior engineer and 2 for a client's marketing lead. Always write down which reader you are grading for.

## Method

1. **Become the reader.** Re-read the profile: their role, what they already know, why they opened this, how much time they have, the device they read it on, their language.
2. **The five-second test.** Look only at the first screen or the first paragraph. Can the reader tell what this is, what the conclusion is and whether they need to act? Write down what they would take away.
3. **Read it through as the reader.** Mark every point where they would stop: an undefined term, a jump in logic, a number with no meaning attached ("LCP 3.1s", so is that good?), an instruction with no actor, a sentence that has to be read twice.
4. **List the reader's leftover questions.** After reading, what would they still ask the author? Each important unanswered question is a finding. Always ask the practical ones too: "How long will this really take me?", "Whom do I need, and when do I have to ask them?", "What do I do while I wait?"
5. **Check the claims.** Pick 3–5 factual claims, numbers or file references and verify them against the inputs and run logs. One fabricated or wrong claim is a Major finding, whatever the prose is like. Claims about the reader's own effort count as claims: durations, totals, "quick", "one step", "no setup needed". Check them at human pace with `references/human-reality.md`, not at yours.
6. **Score each dimension below**, with a quoted example for any score under 4.

## Dimensions (score 1–5)

| # | Dimension | 5 looks like | 1 looks like |
|---|---|---|---|
| 1 | **Audience fit** | Vocabulary, depth and examples match what the reader knows. Jargon is either absent or explained once in plain words. | Written for the author. Insider terms, tool names and codes with no explanation. |
| 2 | **Bottom line first** | The conclusion, verdict or required action is in the first lines. Detail follows for those who want it. | The reader has to get through method and background before learning what it means. |
| 3 | **Structure and scannability** | Headings say what the section concludes, not just its topic. Lists for parallel items, tables for comparisons, prose for reasoning. Sections in order of importance. | A wall of text, or the opposite: everything bulleted, nesting three deep, no thread connecting the points. |
| 4 | **Sentence clarity** | Plain words, mostly short sentences, active voice, concrete subjects ("the checkout page loads in 3 s"), one idea per sentence. | Long nominalised sentences, passive constructions hiding who does what, vague nouns ("various issues were identified"). |
| 5 | **Accuracy and grounding** | Every claim is supported by evidence the reader can see or trust. Numbers are consistent across sections. Uncertainty is stated once, clearly. | Invented or unverified facts, contradictory numbers, or so much hedging that nothing is actually claimed. |
| 6 | **Actionability** | Next steps are specific: what to do, who does it, in what order, and the expected effect. | "Consider improving performance." Recommendations with no owner or priority. |
| 7 | **Concision** | Every paragraph earns its place. No restating, no filler openers ("It is important to note that…"). | Padding, repetition, boilerplate, summaries of summaries. |
| 8 | **Consistency and correctness** | One term per concept. Formatting is consistent. Spelling and grammar are correct, in the reader's language and locale. | The same thing has three names. Mixed date formats, number formats or languages. Typos. |
| 9 | **Tone** | Fits the relationship. Respectful to a client, direct with a colleague, calm about bad news, no hype. | Alarmist, condescending, salesy or robotic for the context. |

Overall text score: the mean of the dimensions, **capped at 2 if dimension 5 (accuracy) is 1–2**. A clear text that is wrong is worse than a clumsy one that is right.

## Signals worth measuring

- Average sentence length. Over about 25 words for a non-specialist reader is a warning sign.
- The number of undefined acronyms or terms per page, for the given reader.
- The share of the text that is bullets. Over about 70% often means the reasoning has gone missing.
- Whether headings would make sense on their own as a table of contents.
- Numbers given with no comparison or threshold ("12 issues": out of how many? is that bad?).

These are signals, not verdicts. Mention them only when they explain a score.

## Special cases

- **Messages to the user during a run** (questions, progress, errors). Are the questions answerable, with options? Do errors say what happened and what to do next? Is the final summary short and does it say where the output is?
- **Machine-read text** (JSON, prompts for other agents, config). Does it parse? Is every field defined? Can it be read in only one way? Prose rules do not apply.
- **Localised output.** If the reader's language differs from the skill's, check whether the skill should localise, and if it does, whether the translation reads naturally rather than literally.

## Reporting a text finding

```
T3 · Major · Audience fit · report.pdf p.2
Quote: "CLS regressions on PLP due to late-loading hero."
Reader: the client's marketing lead (non-technical).
Problem: three undefined terms (CLS, PLP, hero), and no consequence the reader cares about.
Recommendation: say the effect first (the product list jumps while loading, so shoppers mis-tap) and define or drop the acronyms.
```
