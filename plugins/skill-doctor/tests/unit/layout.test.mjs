import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLayout, checkLayout } from '../layout-check.mjs';

const { SchemLayout, elk } = loadLayout();

// A chart with every case the rules cover: input, a step reading two files and writing one, a decision whose
// "no" ends the run, a loop back, a parallel sub-process, a user step, an output and two ends.
function richChart() {
  const n = (id, kind, label, extra = {}) => ({ id, kind, label, origin: 'inferred', ...extra });
  const nodes = [
    n('start', 'start', 'Spawned for a debated card'),
    n('in', 'io', 'Card and run context', { direction: 'in' }),
    n('read', 'process', 'Read panel protocol and the knowledge base for this card', { command: 'python scripts/kb.py query --card "<card name>" --theme' }),
    n('proto', 'storage', 'price-panel-protocol.md', { path: 'price-panel-protocol.md', holds: 'Horizons, per-card debate steps and the evidence rules' }),
    n('rates', 'storage', 'base-rates.md', { path: 'base-rates.md', holds: 'Class release and d30 price ratios' }),
    n('case', 'storage', 'case.md', { path: 'case.md', holds: 'The per-card case file' }),
    n('past', 'decision', 'Past event unmeasured?'),
    n('measure', 'process', 'Measure past event effect', { command: 'python scripts/long_history.py' }),
    n('ask', 'process', 'Ask the user to confirm the horizon', { user: true }),
    n('ok', 'decision', 'Horizon confirmed?'),
    n('team', 'subprocess', 'Run the analysts', { target: 'audit:analyst', calls: 'agent', parallel: true, count: 5 }),
    n('out', 'io', 'Case file path', { direction: 'out' }),
    n('end1', 'end', 'End'),
    n('end2', 'end', 'Stop: nothing to measure'),
  ];
  const e = (id, kind, from, to, label) => ({ id, kind, from, to, ...(label ? { label } : {}) });
  const edges = [
    e('e1', 'flow', 'start', 'in'), e('e2', 'flow', 'in', 'read'),
    e('e3', 'reads', 'proto', 'read', 'horizons, steps, evidence rules'), e('e4', 'reads', 'rates', 'read', 'release and d30 ratios'),
    e('e5', 'flow', 'read', 'past'), e('e6', 'flow', 'past', 'measure', 'yes'), e('e7', 'flow', 'past', 'end2', 'no'),
    e('e8', 'flow', 'measure', 'ask'), e('e9', 'writes', 'measure', 'case', 'measured effect per horizon'),
    e('e10', 'flow', 'ask', 'ok'), e('e11', 'flow', 'ok', 'team', 'yes'), e('e12', 'flow', 'ok', 'ask', 'no'),
    e('e13', 'flow', 'team', 'out'), e('e14', 'reads', 'case', 'team', 'case file'), e('e15', 'flow', 'out', 'end1'),
  ];
  return { view: { id: 'v', kind: 'agent-def', nodes: nodes.map((x) => x.id), edges }, byId: new Map(nodes.map((x) => [x.id, x])) };
}

test('layout follows the connection, label and spacing rules', async () => {
  const { view, byId } = richChart();
  const L = await SchemLayout.compute(view, byId, elk, { showFiles: true });
  assert.deepEqual(checkLayout(L), []);
});

test('each read or write gets its own file copy beside its step', async () => {
  const { view, byId } = richChart();
  const L = await SchemLayout.compute(view, byId, elk, { showFiles: true });
  const copies = L.blocks.filter((b) => b.of);
  assert.equal(copies.length, 4);
  const step = L.blocks.find((b) => b.id === 'read');
  for (const c of copies.filter((b) => b.of === 'proto' || b.of === 'rates')) assert.ok(c.x + c.w < step.x, `${c.id} is left of its step`);
  const measure = L.blocks.find((b) => b.id === 'measure');
  const written = copies.find((b) => b.of === 'case' && L.edges.some((x) => x.kind === 'writes' && x.to === b.id));
  assert.ok(written.x > measure.x + measure.w, 'written file is right of its step');
});

test('decision branch to an End or back to an earlier block leaves from the right', async () => {
  const { view, byId } = richChart();
  const L = await SchemLayout.compute(view, byId, elk, { showFiles: true });
  const right = (id) => { const b = L.blocks.find((x) => x.id === id); return { x: b.x + b.w, y: b.y + b.h / 2 }; };
  const first = (id) => L.edges.find((x) => x.id === id).points[0];
  assert.deepEqual(first('e7'), right('past'));
  assert.deepEqual(first('e12'), right('ok'));
});

test('hiding files leaves only the flow', async () => {
  const { view, byId } = richChart();
  const L = await SchemLayout.compute(view, byId, elk, { showFiles: false });
  assert.equal(L.blocks.some((b) => b.kind === 'storage'), false);
  assert.ok(L.edges.every((x) => x.kind === 'flow'));
  assert.deepEqual(checkLayout(L), []);
});

test('long file names break after a separator, not mid-word', () => {
  assert.deepEqual(SchemLayout.wrap('price-panel-protocol.md', 20, 2), ['price-panel-', 'protocol.md']);
  assert.deepEqual(SchemLayout.wrap('price-panel-protocol.md', 26, 2), ['price-panel-protocol.md']);
  assert.equal(SchemLayout.sizeOf({ kind: 'storage', label: 'price-panel-protocol.md', holds: 'x' }).main.length, 1);
});

test('blocks of one kind share one width on every chart', async () => {
  const { view, byId } = richChart();
  const L = await SchemLayout.compute(view, byId, elk, { showFiles: true });
  for (const kind of ['process', 'decision', 'io', 'storage', 'start']) {
    const widths = new Set(L.blocks.filter((b) => b.kind === kind || (kind === 'start' && b.kind === 'end')).map((b) => b.w));
    assert.equal(widths.size, 1, `${kind}: ${[...widths]}`);
    assert.equal([...widths][0], SchemLayout.TOKENS.width[kind]);
  }
});

test('only loop edges point upward, so the flow reads from top to bottom', async () => {
  // A retry loop back to an early decision and a per-unit loop: ELK's own cycle breaking used to reverse forward
  // edges here, lifting "Running on Claude Code?" above Start and drawing steps upward.
  const n = (id, kind, label) => ({ id, kind, label, origin: 'inferred' });
  const nodes = [
    n('start', 'start', 'Start'), n('in', 'io', 'Path and flags'), n('scan', 'process', 'Scan'),
    n('sub', 'decision', 'Subagents available?'), n('cc', 'decision', 'Running on Claude Code?'),
    n('ana', 'subprocess', 'Analysts'), n('exp', 'subprocess', 'Explorers'), n('pipe', 'process', 'Save replies'),
    n('seq', 'process', 'Analyse next unit'), n('save', 'process', 'Save unit'), n('more', 'decision', 'More units?'),
    n('val', 'process', 'Validate'), n('bad', 'decision', 'Any invalid?'), n('again', 'decision', 'Retried once?'),
    n('merge', 'process', 'Merge'), n('end', 'end', 'End'),
  ];
  const pairs = [['start', 'in'], ['in', 'scan'], ['scan', 'sub'], ['sub', 'cc', 'yes'], ['sub', 'seq', 'no'], ['cc', 'ana', 'yes'], ['cc', 'exp', 'no'],
    ['ana', 'val'], ['exp', 'pipe'], ['pipe', 'val'], ['seq', 'save'], ['save', 'more'], ['more', 'seq', 'yes'], ['more', 'val', 'no'],
    ['val', 'bad'], ['bad', 'again', 'yes'], ['bad', 'merge', 'no'], ['again', 'sub', 'no'], ['again', 'merge', 'yes'], ['merge', 'end']];
  const edges = pairs.map(([from, to, label], i) => ({ id: `e${i}`, kind: 'flow', from, to, ...(label ? { label } : {}) }));
  const view = { id: 'v', kind: 'skill', nodes: nodes.map((x) => x.id), edges };
  const L = await SchemLayout.compute(view, new Map(nodes.map((x) => [x.id, x])), elk, { showFiles: true });
  const y = new Map(L.blocks.map((b) => [b.id, b.y]));
  const up = edges.filter((e) => y.get(e.to) < y.get(e.from)).map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(up, ['again->sub', 'more->seq']);
  assert.deepEqual(checkLayout(L), []);
});

test('the layout score counts crossings, lines through blocks and lines running side by side', () => {
  const blk = (id, x, y) => ({ id, x, y, w: 40, h: 20 });
  const line = (id, from, to, points) => ({ id, kind: 'flow', from, to, points });
  const L = {
    blocks: [blk('a', 0, 0), blk('b', 200, 0), blk('c', 0, 200), blk('d', 200, 200), blk('m', 80, 90)],
    edges: [
      line('ac', 'a', 'c', [{ x: 20, y: 20 }, { x: 20, y: 100 }, { x: 180, y: 100 }, { x: 180, y: 200 }]),
      line('bd', 'b', 'd', [{ x: 220, y: 20 }, { x: 220, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 200 }]),
      line('cd', 'c', 'd', [{ x: 40, y: 210 }, { x: 40, y: 108 }, { x: 90, y: 108 }]),
    ],
  };
  const s = SchemLayout.scoreLayout(L);
  assert.equal(s.crossings, 1, 'ac and bd cross once');
  assert.ok(s.throughBlocks >= 1, 'a line passes through block m');
  assert.equal(s.sideBySide, 50, 'ac and cd run 8px apart for 50px');
});

test('the evaluation step keeps the best-scoring candidate layout', async () => {
  const { view, byId } = richChart();
  const scores = [];
  for (const c of SchemLayout.CANDIDATES) scores.push((await SchemLayout.compute(view, byId, elk, { candidates: [c] })).score.total);
  const L = await SchemLayout.compute(view, byId, elk);
  assert.equal(L.score.total, Math.min(...scores));
  assert.equal(L.score.candidate, scores.indexOf(Math.min(...scores)));
});

test('a loop back from a step leaves from its right side', async () => {
  const n = (id, kind, label) => ({ id, kind, label, origin: 'inferred' });
  const nodes = [n('start', 'start', 'Start'), n('save', 'process', 'Save'), n('ok', 'decision', 'Saved?'), n('out', 'io', 'Status'), n('fix', 'process', 'Fix errors'), n('end', 'end', 'End')];
  const pairs = [['start', 'save'], ['save', 'ok'], ['ok', 'out', 'yes'], ['ok', 'fix', 'no'], ['fix', 'save'], ['out', 'end']];
  const edges = pairs.map(([from, to, label], i) => ({ id: `e${i}`, kind: 'flow', from, to, ...(label ? { label } : {}) }));
  const L = await SchemLayout.compute({ id: 'v', kind: 'agent-def', nodes: nodes.map((x) => x.id), edges }, new Map(nodes.map((x) => [x.id, x])), elk);
  const fix = L.blocks.find((b) => b.id === 'fix');
  assert.deepEqual(L.edges.find((e) => e.id === 'e4').points[0], { x: fix.x + fix.w, y: fix.y + fix.h / 2 });
  assert.deepEqual(checkLayout(L), []);
});

test('a parallel group grows a row per branch, at most 8 with "+N more"', () => {
  const branches = Array.from({ length: 11 }, (_, i) => ({ target: `agents/a${i}.md`, label: `Area ${i}`, opens: [`t:x/a${i}`] }));
  const n = { id: 'g', kind: 'subprocess', label: 'Analysts check each area', parallel: true, count: 11, branches };
  const s = SchemLayout.sizeOf(n);
  assert.equal(s.rows.length, 8);
  assert.deepEqual(s.rows[0], { text: 'Area 0', open: 't:x/a0' });
  assert.deepEqual(s.rows[7], { text: '+4 more', open: null, more: true });
  assert.ok(s.h >= s.textH + s.rowsH + 2 * SchemLayout.TOKENS.padY);
  assert.equal(SchemLayout.sizeOf({ ...n, branches: branches.slice(0, 3) }).rows.length, 3);
});

test('a step with a table or list, and a file with fields, get a detail line', () => {
  const table = { columns: ['Rule', 'Severity'], rows: [['a', 'high'], ['b', 'low']], source: { file: 'x.md', lines: [1, 4] } };
  const step = SchemLayout.sizeOf({ id: 'p', kind: 'process', label: 'Check rules', command: 'node scripts/x.mjs run', table });
  assert.equal(step.sub.at(-1), '2 rules ▸');
  assert.equal(step.detail, step.sub.length - 1);
  assert.equal(SchemLayout.sizeOf({ id: 'p', kind: 'process', label: 'Rows', table: { ...table, columns: ['What to check'] } }).sub.at(-1), '2 rows ▸');
  assert.equal(SchemLayout.sizeOf({ id: 'l', kind: 'process', label: 'Facts', list: { items: [{ text: 'a', depth: 0 }], source: table.source } }).sub.at(-1), '1 items ▸');
  const file = SchemLayout.sizeOf({ id: 'f', kind: 'storage', label: 'findings.json', holds: 'Findings', fields: [{ name: 'a', depth: 0 }, { name: 'b', depth: 0 }] });
  assert.equal(file.sub.at(-1), '2 fields');
  assert.equal(SchemLayout.sizeOf({ id: 'q', kind: 'process', label: 'Plain' }).detail, -1);
});

test('a chart with a tall branch block still follows the layout rules', async () => {
  const { view, byId } = richChart();
  byId.get('team').branches = Array.from({ length: 11 }, (_, i) => ({ target: `a${i}`, label: `Area number ${i}`, opens: [] }));
  const L = await SchemLayout.compute(view, byId, elk);
  assert.deepEqual(checkLayout(L), []);
  assert.equal(L.blocks.find((b) => b.id === 'team').rows.length, 8);
});

test('branch rows stay readable: a group block is wider and a prefix shared by several branches is dropped', () => {
  const branches = ['Area: SEO and discoverability (`seo`)', 'Area: Performance (`perf`)', 'Contract for every analysis area'].map((label, i) => ({ target: `t${i}`, label, opens: [] }));
  const s = SchemLayout.sizeOf({ id: 'g', kind: 'subprocess', label: 'Area analysts check each area', parallel: true, branches });
  assert.equal(s.w, SchemLayout.TOKENS.width.group);
  assert.deepEqual(s.rows.map((r) => r.text), ['SEO and discoverability (`seo`)', 'Performance (`perf`)', 'Contract for every analysis area']);
  assert.equal(SchemLayout.sizeOf({ id: 'p', kind: 'subprocess', label: 'One call', target: 'x' }).w, SchemLayout.TOKENS.width.subprocess);
});
