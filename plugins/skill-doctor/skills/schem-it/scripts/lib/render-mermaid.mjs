import { breadcrumb, overviewView } from './views.mjs';
import { SEVERITIES } from './problems.mjs';

const SHAPES = {
  start: ['(["', '"])'], end: ['(["', '"])'], io: ['[/"', '"/]'], process: ['["', '"]'],
  decision: ['{"', '"}'], subprocess: ['[["', '"]]'], storage: ['[("', '")]'],
};
// Same design tokens as the HTML viewer (templates/viewer.html): [fill, outline] per block look.
const COLORS = {
  start: ['#e3f5ea', '#3e9e6b'], end: ['#e3f5ea', '#3e9e6b'], io: ['#e3f6fa', '#4d8597'], process: ['#eaf2fd', '#4c8bdb'],
  user: ['#fde7e8', '#c27378'], decision: ['#fff5d9', '#ddae3e'], subprocess: ['#f0e7fc', '#8c6bc2'], storage: ['#fff2da', '#d19c46'],
};
const INK = { text: '#0f2247', line: '#1e3a6e', data: '#3aa0e6', missing: '#d64545' };
const colourOf = (n) => (n.kind === 'process' && n.user ? 'user' : n.kind);
const cls = (key) => `k_${key}`;

export function mermaidLabel(text) {
  return String(text).replace(/[\r\n]+/g, ' ').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').trim();
}

export function nodeLines(n) {
  let first = n.missing ? `missing: ${n.label}` : n.label;
  if (n.kind === 'subprocess' && n.parallel) first += n.count ? ` ×${n.count}` : ' ×N';
  if (n.kind === 'process' && n.command) return [first, n.command];
  if (n.kind === 'storage' && n.holds) return [first, n.holds];
  return [first];
}

export function mermaidForView(model, view, { direction = 'TD', styles = true } = {}) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const flowIds = view.nodes.filter((id) => byId.get(id).kind !== 'storage');
  const ids = new Map(flowIds.map((id, i) => [id, `n${i}`]));
  const placed = flowIds.map((id) => [ids.get(id), byId.get(id)]);
  const decl = (mid, n) => {
    const [open, close] = SHAPES[n.kind] ?? SHAPES.process;
    return `  ${mid}${open}${nodeLines(n).map(mermaidLabel).join('<br>')}${close}`;
  };
  const out = [`flowchart ${direction}`, ...placed.map(([mid, n]) => decl(mid, n))];
  const lines = [];
  const dataLinks = [];
  view.edges.forEach((e, i) => {
    const label = e.label ? `|"${mermaidLabel(e.label)}"|` : '';
    if (e.kind === 'flow') {
      if (ids.has(e.from) && ids.has(e.to)) lines.push(`  ${ids.get(e.from)} -->${label} ${ids.get(e.to)}`);
      return;
    }
    // Each read or write gets its own copy of the file: a read sits before its step, a write after it.
    const file = byId.get(e.kind === 'reads' ? e.from : e.to);
    const step = e.kind === 'reads' ? e.to : e.from;
    if (!file || !ids.has(step)) return;
    const mid = `d${i}`;
    out.push(decl(mid, file));
    placed.push([mid, file]);
    dataLinks.push(lines.length);
    lines.push(e.kind === 'reads' ? `  ${mid} -.->${label} ${ids.get(step)}` : `  ${ids.get(step)} -.->${label} ${mid}`);
  });
  out.push(...lines);
  const nodes = placed.map(([, n]) => n);
  if (styles && lines.length) {
    out.push(`  linkStyle default stroke:${INK.line},stroke-width:1.5px`);
    if (dataLinks.length) out.push(`  linkStyle ${dataLinks.join(',')} stroke:${INK.data},stroke-width:1.3px`);
  }
  if (styles) for (const k of new Set(nodes.map(colourOf))) out.push(`  classDef ${cls(k)} fill:${COLORS[k][0]},stroke:${COLORS[k][1]},color:${INK.text}`);
  if (nodes.some((n) => n.missing)) out.push(`  classDef missing stroke:${INK.missing},stroke-width:2px,color:${INK.missing}`);
  for (const [mid, n] of placed) {
    if (styles) out.push(`  class ${mid} ${cls(colourOf(n))}`);
    if (n.missing) out.push(`  class ${mid} missing`);
  }
  return `${out.join('\n')}\n`;
}

// The whole-system map: a box per unit (in a subgraph per plugin), an arrow per pair of units that call each other,
// and the files one unit writes and another reads.
const UNIT_COLOURS = { skill: 'process', command: 'start', 'agent-def': 'subprocess', 'agent-prompt': 'user', 'script-command': 'io' };
export function mermaidForMap(model, view, { direction = 'LR', styles = true } = {}) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const ids = new Map([...view.units, ...view.files.map((f) => f.id)].map((id, i) => [id, `u${i}`]));
  const out = [`flowchart ${direction}`];
  const decl = (id, indent) => {
    const n = byId.get(id);
    const [open, close] = n.kind === 'storage' ? SHAPES.storage : SHAPES.subprocess;
    return `${indent}${ids.get(id)}${open}${mermaidLabel(n.label)}${close}`;
  };
  const framed = new Set(view.frames.flatMap((f) => f.units));
  view.frames.forEach((f, i) => {
    out.push(`  subgraph g${i}["${mermaidLabel(f.title)}"]`, ...f.units.map((id) => decl(id, '    ')), '  end');
  });
  for (const id of view.units) if (!framed.has(id)) out.push(decl(id, '  '));
  for (const f of view.files) out.push(decl(f.id, '  '));
  const pairs = new Map();
  for (const c of view.calls) {
    const key = `${c.from}>${c.to}`;
    if (!pairs.has(key)) pairs.set(key, new Set());
    pairs.get(key).add(c.kind);
  }
  const lines = [...pairs].map(([key, kinds]) => {
    const [from, to] = key.split('>');
    return `  ${ids.get(from)} -->|"${[...kinds].join(', ')}"| ${ids.get(to)}`;
  });
  const dataFrom = lines.length;
  for (const f of view.files) {
    for (const u of f.writers) lines.push(`  ${ids.get(u)} -.-> ${ids.get(f.id)}`);
    for (const u of f.readers) lines.push(`  ${ids.get(f.id)} -.-> ${ids.get(u)}`);
  }
  out.push(...lines);
  if (styles && lines.length) {
    out.push(`  linkStyle default stroke:${INK.line},stroke-width:1.5px`);
    if (lines.length > dataFrom) out.push(`  linkStyle ${lines.map((_, i) => i).slice(dataFrom).join(',')} stroke:${INK.data},stroke-width:1.3px`);
  }
  if (styles) {
    const keyOf = (id) => (byId.get(id).kind === 'storage' ? 'storage' : UNIT_COLOURS[byId.get(id).kind] ?? 'process');
    const all = [...ids.keys()];
    for (const k of new Set(all.map(keyOf))) out.push(`  classDef ${cls(k)} fill:${COLORS[k][0]},stroke:${COLORS[k][1]},color:${INK.text}`);
    for (const id of all) out.push(`  class ${ids.get(id)} ${cls(keyOf(id))}`);
  }
  return `${out.join('\n')}\n`;
}

const cell = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const fmtLines = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);
const anchor = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');

// What a block carries beyond its label: branches of a parallel group, a table or list from the text, a file's fields.
function detailParts(n) {
  const name = nodeLines(n)[0];
  const out = [];
  if (n.branches?.length) {
    out.push(`**${name}: branches**`, '', '| Branch | Role |', '|---|---|', ...n.branches.map((b) => `| ${cell(b.label)} | ${cell(b.role)} |`), '');
  }
  if (n.table) {
    out.push(`**${n.label}: table** (${n.table.source.file}:${fmtLines(n.table.source.lines)})`, '',
      `| ${n.table.columns.map(cell).join(' | ')} |`, `|${n.table.columns.map(() => '---').join('|')}|`,
      ...n.table.rows.map((r) => `| ${r.map(cell).join(' | ')} |`), '');
  }
  if (n.list) {
    out.push(`**${n.label}: list** (${n.list.source.file}:${fmtLines(n.list.source.lines)})`, '', ...n.list.items.map((it) => `${'  '.repeat(it.depth)}- ${it.text}`), '');
  }
  if (n.fields?.length) {
    out.push(`**${n.label}: fields**${n.schemaFile ? ` (${n.schemaFile})` : ''}`, '', '| Field | Type | Required | Holds |', '|---|---|---|---|',
      ...n.fields.map((f) => `| ${cell(f.name)} | ${cell([f.type, f.values?.join(', ')].filter(Boolean).join(': '))} | ${f.required ? 'yes' : ''} | ${cell(f.holds)} |`), '');
  }
  return out;
}

const sevCount = (s, k) => (s === 'info' ? `${k} info` : `${k} ${s}${k === 1 ? '' : 's'}`);
export function problemSummary(list) {
  return SEVERITIES.map((s) => [s, list.filter((p) => p.severity === s).length]).filter(([, k]) => k).map(([s, k]) => sevCount(s, k)).join(', ');
}

// A unit's problems as a table: what is wrong, on which block, who found it and the lines it cites.
function problemTable(list, byId) {
  if (!list.length) return [];
  return [
    `**Problems** (${problemSummary(list)})`, '',
    '| Severity | Problem | Block | Found by | Source |', '|---|---|---|---|---|',
    ...list.map((p) => `| ${p.severity} | **${cell(p.title ?? p.kind)}**: ${cell(p.message)} | ${p.node && byId.get(p.node) ? cell(nodeLines(byId.get(p.node))[0]) : 'whole unit'} | ${p.by === 'analyst' ? 'analyst' : 'script'} | ${p.source ? cell(`${p.source.file}:${fmtLines(p.source.lines)}`) : ''} |`),
    '',
  ];
}
// What decides when a skill, command or agent runs: its frontmatter description.
const TRIGGER_KINDS = new Set(['skill', 'command', 'agent-def']);

export function renderMarkdown(model, views) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const viewById = new Map(views.map((v) => [v.id, v]));
  const problems = model.problems ?? [];
  const probsOf = (id) => problems.filter((p) => p.unit === id);
  // A plugin row counts everything in it.
  const probsUnder = (id) => problems.filter((p) => { for (let x = byId.get(p.unit); x; x = byId.get(x.parent)) if (x.id === id) return true; return false; });
  const parts = [
    `# ${byId.get(model.rootId).label}: flowcharts`,
    '',
    `Generated by schem-it from \`${model.root}\` (run ${model.run}). A skill, command or agent comes first as an overview in a few plain steps, then as its detailed flowchart. Oval: start or end. Parallelogram: input or output. Rectangle: a step. Diamond: a yes/no decision. Double-sided box: a sub-process with its own flowchart below. Cylinder: a file (read above its step, written below it). Red outline: referenced but not found.`,
    '',
    ...(problems.length ? [`Problems found: ${problems.length} (${problemSummary(problems)}). Each unit lists its own under its heading, with the block concerned and the lines it cites; "analyst" marks where the text itself leaves a reader unable to tell what happens.`, ''] : []),
  ];
  // The whole-system map comes right after the top index, before the flowcharts it leads to.
  const map = views.find((v) => v.kind === 'map');
  const ordered = map ? [views[0], map, ...views.slice(1).filter((v) => v !== map)] : views;
  for (const v of ordered) {
    parts.push(`## ${breadcrumb(views, v.id).join(' › ')}`, '');
    if (v.kind === 'map') {
      parts.push('Every unit with a flowchart: an arrow from a unit to the one it calls or runs (agent, skill, runs a script, stage of a script), a dotted arrow into and out of a file one unit writes and another reads.', '');
      parts.push('```mermaid', mermaidForMap(model, v).trimEnd(), '```', '');
      continue;
    }
    if (v.kind === 'index') {
      for (const g of v.groups) {
        parts.push(`### ${g.title}`, '', '| Name | Description | Flowchart | Problems |', '|---|---|---|---|');
        for (const id of g.items) {
          const n = byId.get(id);
          const target = viewById.get(id);
          parts.push(`| ${cell(n.label)} | ${cell(n.description)} | ${target ? `[open](#${anchor(breadcrumb(views, id).join(' › '))})` : n.wrapper ? 'none: a short command, not analysed' : ''} | ${problemSummary(n.kind === 'plugin' ? probsUnder(id) : probsOf(id))} |`);
        }
        parts.push('');
      }
      parts.push(...problemTable(probsOf(v.id), byId));
      continue;
    }
    const self = byId.get(v.id);
    if (TRIGGER_KINDS.has(self.kind) && self.description) parts.push(`**When it runs:** ${cell(self.description)}`, '');
    if (self.analysis === 'failed') parts.push('> Analysis failed: this flowchart shows only what the script found, in the order the text mentions it.', '');
    if (self.analysis === 'skipped') parts.push('> Not analysed in this run (excluded by --only).', '');
    parts.push(...problemTable(probsOf(v.id), byId));
    if (!v.nodes.length) { parts.push('_No blocks._', ''); continue; }
    const ov = overviewView(v);
    if (ov) {
      parts.push('### Overview', '', 'The same work in a few steps; each block stands for the detailed blocks listed under Covers.', '');
      parts.push('```mermaid', mermaidForView(model, ov).trimEnd(), '```', '');
      parts.push('| Block | Kind | Role | Covers |', '|---|---|---|---|');
      for (const id of ov.nodes) {
        const n = byId.get(id);
        parts.push(`| ${cell(nodeLines(n)[0])} | ${n.kind} | ${cell(n.role)} | ${cell(n.covers.map((c) => byId.get(c)?.label ?? c).join('; '))} |`);
      }
      parts.push('', '### Detailed', '');
    }
    parts.push('```mermaid', mermaidForView(model, v).trimEnd(), '```', '');
    parts.push('| Block | Kind | Role | Source |', '|---|---|---|---|');
    for (const id of v.nodes) {
      const n = byId.get(id);
      parts.push(`| ${cell(nodeLines(n)[0])} | ${n.kind} | ${cell(n.role ?? n.description)} | ${n.source ? cell(`${n.source.file}:${fmtLines(n.source.lines)}`) : ''} |`);
    }
    for (const id of v.nodes) {
      const d = detailParts(byId.get(id));
      if (d.length) parts.push('', ...d);
    }
    parts.push('');
  }
  return parts.join('\n');
}
