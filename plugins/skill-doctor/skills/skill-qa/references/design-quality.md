# Design-quality rubric

Judge the **rendered** output (screenshots, page images), never the source alone. Judge it for the reader and the device named in the context profile. Separate **guideline violations** (cite the guideline) from **opinions** (taste). The author should be able to tell them apart.

## Contents
1. Core concepts (what you are judging against)
2. Method
3. Rubric
4. Medium-specific checks: web pages, PDF and print, slides, charts
5. Reporting a design finding

---

## 1. Core concepts

**Purpose first.** Design serves the reader's task. Before judging anything, name the one or two things the reader must get from this page. Good design makes those the most prominent things on it.

**Visual hierarchy.** The eye should travel from the most important to the least important element. The tools are size, weight, colour and contrast, position (top-left in left-to-right languages), whitespace and isolation. Test it by squinting at a blurred or small screenshot: the elements you can still make out should be the important ones. When everything is bold, nothing is.

**Gestalt principles.**
- *Proximity:* related things sit close together, unrelated things further apart. Spacing inside a group should be clearly smaller than spacing between groups. A label must sit closer to its own field than to the next one.
- *Similarity:* things that look alike are read as alike. The same style must mean the same function. This holds across pages and screens too: a block at the top of a page that looks exactly like the card that started on the page before is read as another card, not as the second half of the first one.
- *Alignment and continuity:* elements share edges. A few strong alignment lines look intentional, while many near-misses look broken.
- *Common region:* cards, panels and backgrounds group content. Too many boxes inside boxes create noise.
- *Figure and ground:* the content is clearly separated from the background.

**Typography.**
- At most 2 font families (one is often enough). Use a limited set of sizes from a scale (for example a ratio of about 1.2–1.333), with clear steps between heading levels.
- Body text: 16 px or more on the web (never under 14 px for running text), 10–12 pt in print. Line height 1.4–1.6 for body text and tighter for headings (1.1–1.3).
- Line length: 45–75 characters per line for running text. Over about 90 tires the eye. Under about 35 makes the text choppy.
- Use left-aligned text for reading. Justified text without hyphenation leaves rivers of space. Centred text only suits short lines.
- Use real typographic characters (quotation marks, dashes, ellipses). Avoid all-caps paragraphs. Tabular figures in numeric columns.

**Spacing and layout.**
- Use a consistent spacing scale (multiples of 4 or 8 px). Use the probe's spacing histogram: many one-off values suggest no system.
- Whitespace is structure, not waste. Cramped layouts hide hierarchy, and huge gaps break groups apart.
- A grid: content aligns to columns, and the margins are consistent and generous enough.

**Colour.**
- A limited palette: neutrals plus one primary accent, with semantic colours (success, warning, danger) used only for their meaning. A rough 60/30/10 balance.
- Colour must never be the only way meaning is carried (WCAG 1.4.1). Add text, icons or patterns, and check legibility for colour-blind readers.
- **Contrast (WCAG 2.2 AA).** Body text 4.5:1. Large text (≥ 24 px, or ≥ 18.66 px bold) 3:1. UI components and meaningful graphics 3:1 against their surroundings (WCAG 1.4.11).
- Dark mode, if offered: not a simple inversion. Contrast holds, there are no pure-white glaring panels, and the brand colours are adjusted.

**Judge the effect, not the intent.** Many layout mechanisms are good or bad depending on what the reader ends up seeing. A header repeated over a page break helps only if it reads as "continued"; a keep-together rule helps only if it doesn't leave half a page empty; a chip helps only if the reader knows what it refers to. You know what the template meant, because you read it. The reader only has the page. Score what the page does to the reader.

**Consistency.** The same component looks and behaves the same everywhere (buttons, cards, tables, icons, date and number formats). Icon styles are not mixed.

**Accessibility (beyond colour).**
- A logical heading outline (one h1, no skipped levels), landmarks, the `lang` attribute, a page title.
- Images have alt text when they carry meaning. Decorative images are marked as decorative.
- Keyboard: everything interactive is reachable, the focus is visible and the order makes sense.
- Target size: at least 24×24 CSS px (WCAG 2.5.8 AA), 44×44 recommended for touch.
- Motion respects `prefers-reduced-motion`. Nothing flashes.

**Responsiveness.** No horizontal scrolling at 320–390 px. Tables and diagrams scroll inside their own container or reflow. Tap targets are not crowded. Text is not tiny on mobile.

**States.** Empty, loading, error and very-long-content states are designed, not left to chance.

## 2. Method

1. **Five-second impression.** Look at the first-viewport screenshot (or page 1) for five seconds. Write down what you noticed first, second and third. Does that order match what matters most to the reader?
2. **Squint test.** Look at the small or blurred version. Is the structure still readable?
3. **Flip-through (multi-page or long outputs).** Look at consecutive pages as pairs, in order, the way the reader turns them or scrolls; one page at a time hides what happens between pages. Start with the pairs `pdf-probe` lists under `pageFlow`. At each page break ask:
   - Is the first block on the new page new, or a continuation? Can the reader tell without reading the content closely? A continuation needs a visible marker ("continued", "2 of 2", a lighter repeated header). A repeated table header is the expected exception.
   - Do two blocks look the same but do different jobs (a description and the instructions, an example and a real item)? Or look different but do the same job?
   - Where does one item end and the next begin?
   - Is a page mostly empty because a block was pushed to the next page?
   Then do the same at the scroll level for long web pages and across slides.
4. **Systematic pass.** Go through the rubric below, one dimension at a time, across every width or page.
5. **Probe numbers.** Use `design-probe.js` (HTML) or `pdf-probe.mjs` (PDF) output to confirm or refute what you see: contrast failures, smallest text, line lengths, overflow, target sizes, heading outline, number of fonts and colours, spacing values.
6. **Interact.** For HTML, use the main controls (but never submit a form, press Enter in a form field, or open a `mailto:`, `tel:` or `sms:` link; type into fields to check them, and read a form's markup to see where it would send), tab through with the keyboard, resize, toggle dark mode, and try an empty or long state if the fixtures allow it. Do what real hands do: drag, use the mouse wheel and trackpad, pinch, double-click, select and copy text, use the back button. Interaction bugs, such as a drag that selects the whole page or a scroll that zooms, never show up in a screenshot.
7. **Compare with the reader's task.** Could the reader find the answer they came for in under about 10 seconds? Then check what the cold reader (SKILL.md step 7) stumbled on: each of its confusions is a candidate design finding.

## 3. Rubric (score 1–5)

| # | Dimension | 5 looks like | 1 looks like |
|---|---|---|---|
| 1 | **Hierarchy and focus** | The most important information wins at a glance, with a clear reading path. | Everything competes, or the most prominent element is unimportant. |
| 2 | **Layout, grid and alignment** | Consistent margins and columns, a few strong alignment lines, intentional whitespace. | Ragged edges, near-miss alignments, cramped or arbitrary gaps. |
| 3 | **Typography** | ≤ 2 families, a clear scale, readable body size, 45–75 ch lines, good line height. | Many sizes and fonts, tiny or huge body text, lines running the full width of a wide screen. |
| 4 | **Spacing rhythm and grouping** | A spacing scale, groups visibly grouped, proximity matching meaning. | One-off spacing everywhere, labels floating between fields, sections running into each other. |
| 5 | **Colour and contrast** | A restrained palette, semantic colour used correctly, AA contrast everywhere, meaning not carried by colour alone. | Contrast failures in body text, rainbow palettes, red and green as the only signal. |
| 6 | **Consistency** | The same thing always looks the same, and components are reused. | Three button styles, mixed icon sets, inconsistent tables. |
| 7 | **Accessibility** | Outline, alt text, focus, target sizes, keyboard and reduced motion all fine. | Not keyboard-usable, no headings, invisible focus, tiny targets. |
| 8 | **Responsiveness / medium fit** | Works at every width the reader uses, or prints cleanly (see section 4). | Horizontal scroll on a phone, clipped content, broken page breaks. |
| 9 | **Content–design fit** | The form suits the content: tables for comparison, the right charts, density matched to the reader. | Decoration over substance, generic template look, the key number buried in a paragraph. |

The overall design score is the mean. **Cap it at 2 if body text fails contrast or the main content is unreadable on the reader's main device.**

## 4. Medium-specific checks

**Web pages and HTML artifacts**
- Check the first viewport at 1440, 768 and 390 widths. Is the purpose clear without scrolling?
- Body background set explicitly. Both themes legible if dark mode is supported.
- Links look like links. Hover and focus states exist.
- External resources load (look at the console messages). No broken images or fonts falling back to unexpected faces.
- Performance felt by the reader: does it appear quickly, without layout jumping around?

**PDF and print**
- A page size that suits the reader (A4 in Europe, Letter in the US), with consistent sizes and orientation across pages.
- Margins of at least about 15–20 mm. Nothing important within about 5 mm of the edge.
- Page breaks: no heading stranded at the foot of a page, no table row or figure split badly, no single-line widows or orphans. Repeated table headers on long tables.
- Items split over a page break (a card, a test, a section box) are marked as continued, so the second part does not read as a new or duplicate item. If the split puts two different kinds of content on either side (the description on one page, the instructions on the next), the reader must still see that they belong together.
- No page left mostly empty because the next block didn't fit, unless the break is deliberate (a new chapter).
- Running header or footer with page numbers on multi-page documents. A cover or title block that says what the document is, for whom, and the date. Check each of those values against the input. A brand name derived from a page title, a placeholder or a default ("Home", "Untitled", "Client") looks fine at a glance and is wrong.
- Fonts embedded (pdf-probe lists the ones that are not). Text selectable and searchable, not a flattened image. Links clickable. A sensible document title in the metadata.
- Images sharp at print resolution (at least about 150 dpi effective). No raster screenshots of text.
- Colour that survives grey-scale printing when the reader is likely to print.

**Slides**
- One idea per slide. A headline that states the point. Readable from the back of the room (body ≥ about 18 pt).
- Consistent template, aligned elements, not overloaded (as a rule of thumb, ≤ about 6 bullets of ≤ about 10 words).

**Charts and data visualisation**
- The right chart for the question: bars for comparison, lines for change over time, no 3-D, pies only with ≤ 5 slices.
- Axes labelled with units. Scales start at zero for bars. Direct labels rather than distant legends where possible.
- Colour-blind-safe palette, with emphasis colour reserved for the point being made.
- The title states the takeaway ("Mobile traffic doubled in Q3"), not just the topic.

## 5. Reporting a design finding

```
D2 · Major · Colour and contrast · report.html @390px, dark mode
Evidence: shots/report-390-dark.png; probe: 14 text nodes below 4.5:1, worst 2.3:1 (#6b7280 on #1f2937), "Last updated" captions
Guideline: WCAG 2.2 SC 1.4.3 (contrast minimum)
Effect on reader: the client reads on a phone in dark mode, so the dates of each finding are effectively invisible.
Recommendation: lighten secondary text in the dark theme until it reaches at least 4.5:1 on the card background.
```

Put opinions in their own short list, phrased as opinions ("The accent colour feels dated; consider…"). Never mix them into the scores.
