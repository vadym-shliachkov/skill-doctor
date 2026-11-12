import fs from 'node:fs';
import path from 'node:path';
import { runDir, slug, toPosix } from './paths.mjs';

const SKILL_DIR = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, SKILL_DIR), 'utf8');
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const cell = (s) => String(s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

function factDetail(f) {
  switch (f.kind) {
    case 'file': return `${f.path} (${f.role}${f.missing ? ', missing' : f.resolved ? `, ${f.resolved}` : ''})`;
    case 'skill': return `${f.mention} → ${f.target}${f.missing ? ' (missing)' : f.outOfScope ? ' (outside the analysed folder)' : ''}`;
    case 'dispatch': return f.agentType ?? 'subagent (type not named)';
    case 'external': return f.name;
    default: return '';
  }
}

export function buildContext({ root, run, unit, inventory, units = [], hints = [], save, siPath }) {
  const fill = (s) => s.replaceAll('{{UNIT}}', unit.id).replaceAll('{{SKILL_FILE}}', unit.file).replaceAll('{{ROOT}}', root);
  const facts = inventory?.facts ?? [];
  const kindName = { command: 'Command', agent: 'Agent', prompt: 'Agent prompt', script: 'Script command' }[unit.kind] ?? 'Skill';
  const at = (r) => `\`${r.file}:${r.lines[0]}\``;
  const intro = {
    command: `This unit is the slash command \`${unit.name}\`. Model it as a skill whose instructions are the command file; paths in it are usually relative to the root.`,
    agent: `This unit is the agent \`${unit.name}\`, defined in \`${unit.file}\`. Its flowchart starts when another skill or command spawns it and ends with what it returns to the caller.`,
    prompt: [
      `This unit is the agent prompt \`${unit.file}\` of the skill \`${unit.skill}\`: the skill, or a script it runs, gives this text to a subagent as its task, sometimes with other text around it. Its flowchart starts when the subagent receives the text and ends with what it returns. Paths in it are usually relative to the skill folder \`${unit.skillDir}\`. The text is handed over here:`,
      ...(unit.refs ?? []).map((r) => `- ${at(r)}`),
      ...(unit.with?.length ? ['', `It is always handed over together with ${unit.with.map((w) => `\`${w.file}\``).join(', ')}. Read those files too and draw the subagent's combined work in the order the shared text gives; attach this file's own tables and lists to the steps that use them (\`table\`, \`list\`), and cite each block from the file it comes from.`] : []),
    ].join('\n'),
    script: unit.symbol
      ? [
        `This unit is the function \`${unit.symbol}\` in \`${unit.script}\`, a stage of a script pipeline. Draw what the function does: each step that changes the result, each decision that changes the outcome, loops over items, every file it reads or writes with the fields it builds, scripts and programs it runs, functions in other files it hands work to (a \`subprocess\` with \`"calls": "function"\`), and what it returns. Do not draw argument parsing, logging or error plumbing unless it changes the outcome. Cite code lines. Label Start \`${unit.name}\`; the input \`io\` is its parameters, the output \`io\` is what it returns. It is called by:`,
        ...(unit.callers ?? []).map((c) => `- ${c.unit}: ${at(c.source)}`),
      ].join('\n')
      : [
        `This unit is ${unit.subcommand ? `the subcommand \`${unit.subcommand}\` of` : 'the script'} \`${unit.script}\`. Find where the script dispatches it, follow the functions it calls (in any file), and draw what it does: each step that changes the result, each decision that changes the outcome (\`no browser → write HTML only\`), loops over items, every file it reads or writes with the fields it builds, scripts and programs it runs, functions in other files it hands work to (a \`subprocess\` with \`"calls": "function"\`), and what it prints. Do not draw argument parsing, logging or error plumbing unless it changes the outcome. Cite code lines. Label Start \`${unit.name}\`; the input \`io\` is its options, the output \`io\` is what it prints or returns.`,
        ...(unit.callers?.length ? ['It is run by:', ...unit.callers.map((c) => `- ${c.unit}: ${at(c.source)}`)] : ['No analysed text or script runs it: draw what running it directly does, from its entry point and options.']),
      ].join('\n'),
  }[unit.kind];
  const prompts = units.filter((p) => p.kind === 'prompt' && p.id !== unit.id && p.plugin === unit.plugin);
  const promptTable = prompts.length
    ? [
      '## Agent prompts in this plugin',
      '',
      'These files are the tasks of subagents, each with a flowchart of its own. When a step of this unit hands one to a subagent, directly or through a command that prints it, list its path (as the text writes it, or as below) in the sub-process `targets`.',
      '',
      '| file | title | handed over at |',
      '|---|---|---|',
      ...prompts.map((p) => `| \`${p.file}\` | ${cell(p.title ?? p.name)} | ${(p.refs ?? []).map((r) => `${r.file}:${r.lines[0]}`).join(', ')} |`),
      '',
    ]
    : [];
  const siblings = unit.kind === 'script' ? units.filter((u) => u.kind === 'script' && u.script === unit.script && u.id !== unit.id) : [];
  const siblingTable = siblings.length
    ? ['## Other commands of this script', '', 'Each has a chart of its own; a step that runs one keeps its `command`, so it opens that chart.', '', '| command | unit |', '|---|---|', ...siblings.map((u) => `| \`${u.subcommand ?? u.name}\` | ${u.id} |`), '']
    : [];
  const hintTable = unit.kind === 'script' && hints.length
    ? [
      '## Calls found in the code',
      '',
      'A quick scan found these calls in the code. Draw every `child` call that runs a script as a step with `command` (it opens that script\'s chart), every `import` used as a pipeline stage as a sub-process with `"calls": "function"` and `"target": "<path>#<function>"`, and every `ai` call as an AI call (a sub-process with `"calls": "command"`). Leave out a hint that is not a real call (a comment, a string in a message).',
      '',
      '| file:line | kind | detail |',
      '|---|---|---|',
      ...hints.map((h) => `| \`${h.file}:${h.line}\` | ${h.kind} | ${cell(h.detail)} |`),
      '',
    ]
    : [];
  const factTable = facts.length
    ? ['| id | kind | detail | negated | source |', '|---|---|---|---|---|', ...facts.map((f) => `| ${f.id} | ${f.kind} | ${cell(factDetail(f))} | ${f.negated ? 'yes' : ''} | ${f.source.file}:${f.source.lines[0]} |`)].join('\n')
    : '_None._';
  // A file named by --file, not a heredoc or a redirect: charts quote code, quotes or backticks break a heredoc,
  // a long one hits the command-line limit, and PowerShell has no `<`.
  const draft = toPosix(path.join(runDir(root, run), 'drafts', `${slug(unit.id)}.json`));
  const saveCmd = `node ${shq(siPath)} save-unit --root ${shq(root)} --run ${shq(run)} --unit ${shq(unit.id)} --file ${shq(draft)}`;
  const returnPart = save
    ? [
      `Write your JSON with your file-writing tool (not the shell) to \`${draft}\`, then save it with this command:`,
      '',
      '```bash',
      saveCmd,
      '```',
      '',
      'It prints `"ok": true` when the result is valid. If it prints `"ok": false`, read `errors`, fix the file and save again; give up after three attempts.',
      '',
      `Then reply with exactly one line: \`${unit.id}: ok, <N> blocks\` or \`${unit.id}: failed: <reason>\`.`,
    ]
    : ['Reply with the JSON object only: no prose before or after it. The orchestrator validates and saves it.'];
  return [
    `# schem-it analyst task: ${unit.id}`,
    '',
    fill(read('agents/analyst.md')).trim(),
    '',
    `## ${kindName} under analysis`,
    '',
    ...(intro ? [intro, ''] : []),
    `- Unit: \`${unit.id}\``,
    `- Root: \`${root}\` (every \`source.file\` is relative to this folder)`,
    `- ${kindName} file: \`${unit.file}\``,
    `- Frontmatter ends on line ${inventory?.frontmatterEnd ?? 0}`,
    ...(unit.kind === 'skill' ? [`- Files in the skill folder (\`${unit.dir}\`):`, ...(inventory?.files ?? []).map((f) => `  - \`${f}\``)] : []),
    '',
    ...promptTable,
    ...siblingTable,
    ...hintTable,
    '## Facts found by the script',
    '',
    factTable,
    '',
    read('references/block-types.md').trim(),
    '',
    '## Output schema',
    '',
    '```json',
    read('references/model.schema.json').trim(),
    '```',
    '',
    '## How to return your result',
    '',
    ...returnPart,
  ].join('\n') + '\n';
}

// The overview analyst groups a finished detailed chart: it gets the chart as a table, not the unit's files.
export function buildOverviewContext({ root, run, unit, detailed, save, siPath }) {
  const fill = (s) => s.replaceAll('{{UNIT}}', unit.id).replaceAll('{{SKILL_FILE}}', unit.file).replaceAll('{{ROOT}}', root);
  const label = new Map(detailed.nodes.map((n) => [n.id, n.label]));
  const flows = (id) => detailed.edges.filter((e) => e.kind === 'flow' && e.from === id).map((e) => `${e.to}${e.label ? ` (${cell(e.label)})` : ''}`).join(', ');
  const files = (id) => detailed.edges.filter((e) => e.kind !== 'flow' && (e.from === id || e.to === id))
    .map((e) => (e.kind === 'reads' ? `reads ${e.from}` : `writes ${e.to}`)).join(', ');
  const extra = (n) => [n.user && 'waits for the user', n.command && `runs \`${cell(n.command)}\``, n.target && `calls ${n.calls} \`${cell(n.target)}\`${n.parallel ? ' in parallel' : ''}`,
    n.direction && (n.direction === 'in' ? 'input' : 'output'), n.path && `\`${cell(n.path)}\``].filter(Boolean).join('; ');
  const table = [
    '| id | kind | label | role | details | goes to | files |',
    '|---|---|---|---|---|---|---|',
    ...detailed.nodes.map((n) => `| ${n.id} | ${n.kind} | ${cell(n.label)} | ${cell(n.role)} | ${extra(n)} | ${n.kind === 'storage' ? '' : flows(n.id)} | ${n.kind === 'storage' ? '' : files(n.id)} |`),
  ].join('\n');
  const draft = toPosix(path.join(runDir(root, run), 'drafts', `${slug(unit.id)}.overview.json`));
  const saveCmd = `node ${shq(siPath)} save-unit --overview --root ${shq(root)} --run ${shq(run)} --unit ${shq(unit.id)} --file ${shq(draft)}`;
  const returnPart = save
    ? [
      `Write your JSON with your file-writing tool (not the shell) to \`${draft}\`, then save it with this command:`,
      '',
      '```bash',
      saveCmd,
      '```',
      '',
      'It prints `"ok": true` when the overview is valid. If it prints `"ok": false`, read `errors` (they name the detailed blocks and arrows concerned), fix the file and save again; give up after three attempts.',
      '',
      `Then reply with exactly one line: \`${unit.id}: ok, <N> blocks\` or \`${unit.id}: failed: <reason>\`.`,
    ]
    : ['Reply with the JSON object only: no prose before or after it. The orchestrator validates and saves it.'];
  return [
    `# schem-it overview task: ${unit.id}`,
    '',
    fill(read('agents/overview.md')).trim(),
    '',
    '## The detailed chart',
    '',
    `- Unit: \`${unit.id}\``,
    `- Unit file: \`${unit.file}\` (relative to \`${root}\`)`,
    `- ${detailed.nodes.filter((n) => n.kind !== 'storage').length} blocks on the flow, ${detailed.nodes.filter((n) => n.kind === 'storage').length} files; start: ${detailed.nodes.filter((n) => n.kind === 'start').map((n) => n.id).join(', ')}; ends: ${detailed.nodes.filter((n) => n.kind === 'end').map((n) => `${n.id} (${cell(label.get(n.id))})`).join(', ')}`,
    '',
    table,
    '',
    '## Output schema',
    '',
    '```json',
    read('references/overview.schema.json').trim(),
    '```',
    '',
    '## How to return your result',
    '',
    ...returnPart,
  ].join('\n') + '\n';
}
