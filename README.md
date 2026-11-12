# skill-doctor

A Claude Code and Codex plugin for people who build skills, plugins and marketplaces. It has two skills:

| Command | What it does |
|---|---|
| `/skill-doctor:schem-it` | Analyses a skill, plugin or whole marketplace and draws each skill, command and agent as an **algorithm flowchart**: start and end, inputs and outputs, steps, yes/no decisions and loops, the agents and skills it calls (each one opens its own chart) and the files it reads or writes. Every block links to the source lines it came from. It also lists the problems it finds, such as references that lead nowhere or steps that can be read two ways. |
| `/skill-doctor:skill-qa` | QAs a skill the way an independent tester would. It works out who uses the skill and who reads its output, plans main-purpose and edge-case scenarios, runs them against fixtures, uses the output at its reader's pace, judges the text and design of what it produces, and writes an evaluation report. With `--fix`, a separate fixer agent fixes the important findings and skill-qa tests again, for up to 4 rounds. |

## Requirements

- Node.js 22 or newer (schem-it). skill-qa's scripts need Node.js 18 or newer.
- skill-qa's PDF checks use the Poppler tools (`pdfinfo`, `pdffonts`, `pdftoppm`, `pdftotext`) when they are installed. Its HTML checks use a browser tool, such as the Playwright MCP, when one is available.
- schem-it's FigJam output (`--figjam`) needs the Figma MCP to be connected and authorised.

Neither skill installs anything or needs network access for its own work.

## Install

### Claude Code

```bash
claude plugin marketplace add vadym-shliachkov/skill-doctor
claude plugin install skill-doctor@skill-doctor
```

### Codex

```bash
codex plugin marketplace add <path-of-this-repo>
```

Then enable `skill-doctor` from the plugin list in the Codex app, or add this to `.codex/config.toml`:

```toml
[plugins."skill-doctor@skill-doctor"]
enabled = true
```

## Use

```text
/skill-doctor:schem-it path/to/skill
/skill-doctor:schem-it path/to/marketplace --mermaid
/skill-doctor:schem-it . --only "shop/shop-site,shop/agent-*" --figjam

/skill-doctor:skill-qa path/to/skill
/skill-doctor:skill-qa path/to/skill --quick
/skill-doctor:skill-qa path/to/skill --fix --rounds 3
```

In Codex, mention the skill (`$schem-it` or `$skill-qa`) with the same arguments.

### schem-it options

| Option | Effect |
|---|---|
| `--mermaid` | Also write `schem.md` (Mermaid flowcharts and block tables). |
| `--figjam` | Also create FigJam boards through the Figma MCP. |
| `--only <units>` | Analyse only matching units (`plugin/skill`, `plugin/agent-<name>`, `plugin/skill/<prompt>`; globs allowed). |
| `--run <id>` | Re-render an earlier run without analysing again. |

Output goes to `<target>/.schem-it/<run>/`: `schem.html` is a single offline page with an overview and a detailed chart per unit, a whole-system map and a problems list. Nothing else in the target is changed.

### skill-qa options

| Option | Effect |
|---|---|
| `--quick` | Static review, the usage profile, one live main-purpose case and the hands-on pass. |
| `--static` | No live runs: every case is traced on paper. |
| `--baseline` | Also run each main-purpose case without the skill, to show what the skill adds. |
| `--fix` | After the report, a separate fixer agent fixes Critical and Major findings, then skill-qa tests again. |
| `--rounds <n>` | Caps the QA rounds in the fix loop (default and maximum 4). |
| `--out <dir>` | Where to write the run (default `.skill-qa/<timestamp>/` in the current folder). |

## Safety

Both skills treat the files they analyse as data and never as instructions to follow.

- **schem-it** only reads the target and writes into `<target>/.schem-it/`. It never runs the scripts it analyses.
- **skill-qa** is read-only towards the skill under test unless you pass `--fix`. Its scenario runners do follow the target skill's instructions, because that is how they test it. They work on copies inside the run folder and are told never to push, publish, send, pay, delete or call production services. Each runner logs any path it wrote outside the run folder, and the report lists them. Before `--fix` edits anything, skill-qa snapshots the target folder (`OUT/round-1/target-before/`) so you can roll back.

Run skill-qa against a skill you are prepared to execute: a skill that does something harmful when run can still do it inside a scenario, so review an untrusted skill with `--static` first.

## Development

```bash
cd plugins/skill-doctor && npm test
```

elkjs 0.12.0 (EPL-2.0) is vendored unmodified in `plugins/skill-doctor/skills/schem-it/templates/vendor/`.

## License

MIT, except the vendored elkjs bundle (EPL-2.0).
