import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { buildViews, overviewView } from '../../skills/schem-it/scripts/lib/views.mjs';
import { validateOverview } from '../../skills/schem-it/scripts/lib/validate.mjs';
import { renderMarkdown } from '../../skills/schem-it/scripts/lib/render-mermaid.mjs';
import { figjamDiagrams } from '../../skills/schem-it/scripts/lib/figjam.mjs';
import { loadLayout, checkLayout } from '../layout-check.mjs';
import { copyFixture, runSi, FIXTURES } from '../helpers.mjs';

const SKILL = fileURLToPath(new URL('../../skills/schem-it/', import.meta.url));
const TEMPLATE = path.join(SKILL, 'templates/viewer.html');
const frag = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', 'plugin', `${name}.json`), 'utf8'));

// The detailed chart the example in agents/overview.md describes.
function notesChart() {
  const n = (id, kind, label, extra = {}) => ({ id, kind, label, role: 'r', origin: 'inferred', ...extra });
  const nodes = [
    n('start', 'start', 'Start'), n('in', 'io', 'Notes folder', { direction: 'in' }), n('d-node', 'decision', 'Node.js available?'), n('stop', 'end', 'Stop'),
    n('p1', 'process', 'Collect notes', { command: 'node scripts/build.mjs collect' }), n('chk', 'subprocess', 'Checkers check notes', { target: 'demo:checker', calls: 'agent', parallel: true }),
    n('ask', 'process', 'Ask user to approve outline', { user: true }), n('d-ok', 'decision', 'Outline approved?'), n('p2', 'process', 'Write report'),
    n('out', 'io', 'report.md', { direction: 'out' }), n('end', 'end', 'End'),
    n('f-notes', 'storage', 'notes.json', { path: 'notes.json', holds: 'notes' }), n('f-report', 'storage', 'report.md', { path: 'report.md', holds: 'report' }),
  ];
  const e = (from, to, kind = 'flow', label) => ({ from, to, kind, ...(label ? { label } : {}) });
  const edges = [
    e('start', 'in'), e('in', 'd-node'), e('d-node', 'stop', 'flow', 'no'), e('d-node', 'p1', 'flow', 'yes'), e('p1', 'chk'), e('chk', 'ask'), e('ask', 'd-ok'),
    e('d-ok', 'p1', 'flow', 'no'), e('d-ok', 'p2', 'flow', 'yes'), e('p2', 'out'), e('out', 'end'),
    e('p1', 'f-notes', 'writes', 'all notes'), e('p2', 'f-report', 'writes', 'summary'),
  ];
  return { unit: 'demo/notes', nodes, edges };
}

function example() {
  const text = fs.readFileSync(path.join(SKILL, 'agents/overview.md'), 'utf8');
  return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1].replaceAll('{{UNIT}}', 'demo/notes'));
}
const messages = (r) => r.errors.map((e) => e.message).join('\n');

test('the example in the overview instructions is a valid overview of the chart it describes', () => {
  const r = validateOverview('demo/notes', example(), notesChart());
  assert.deepEqual(r.errors, []);
});

test('every detailed block is covered once, by a block of a kind that may stand for it', () => {
  const ov = example();
  ov.nodes.find((n) => n.id === 'collect').covers = ['p1', 'stop'];
  ov.nodes.find((n) => n.id === 'write').covers = ['p2', 'p1', 'ghost'];
  ov.nodes.find((n) => n.id === 'start').covers = ['start', 'in'];
  ov.nodes.find((n) => n.id === 'approve').covers = ['ask'];
  const m = messages(validateOverview('demo/notes', ov, notesChart()));
  assert.match(m, /the detailed decision "d-node" \(Node\.js available\?\) is not covered/);
  assert.match(m, /"p1" \(Collect notes\) is already covered by "collect"/);
  assert.match(m, /"ghost" is not a block of the detailed chart/);
  assert.match(m, /a start cannot cover the io "in"/);
  assert.match(m, /"ask" \(Ask user to approve outline\) is already covered by "ask"/);
  assert.match(m, /a decision covers at least one detailed decision/);
});

test('the overview arrows are exactly the detailed arrows between groups', () => {
  const ov = example();
  ov.edges = ov.edges.filter((e) => !(e.from === 'approve' && e.to === 'collect'));
  ov.edges.push({ from: 'collect', to: 'report', kind: 'writes', label: 'x' });
  ov.edges.find((e) => e.from === 'in').to = 'check';
  const m = messages(validateOverview('demo/notes', ov, notesChart()));
  assert.match(m, /the detailed arrow d-ok → p1 \(Outline approved\? → Collect notes\) leaves "approve" for "collect": add a flow "approve" → "collect" \(labelled like "no"\)/);
  assert.match(m, /the detailed arrow in → d-node .* leaves "in" for "collect"/);
  assert.match(m, /no detailed arrow goes from a block "in" covers to a block "check" covers/);
  assert.match(m, /no detailed "writes" link goes from a block "collect" covers to a block "report" covers/);
});

test('a group that leaves by two arrows must be a decision; folding a side path into a step is fine', () => {
  const ov = example();
  // The decision and the step it loops back to in one group: the loop disappears into it.
  ov.nodes = ov.nodes.filter((n) => n.id !== 'approve' && n.id !== 'ask');
  ov.nodes.find((n) => n.id === 'collect').covers.push('ask', 'd-ok');
  ov.nodes.find((n) => n.id === 'check').covers = ['chk'];
  ov.edges = ov.edges.filter((e) => !['ask', 'approve'].includes(e.from) && !['ask', 'approve'].includes(e.to));
  ov.edges.push({ from: 'check', to: 'collect', kind: 'flow' }, { from: 'collect', to: 'write', kind: 'flow' });
  const m = messages(validateOverview('demo/notes', ov, notesChart()));
  assert.match(m, /process "collect" needs exactly one outgoing flow \(found 2\)/);
});

test('an overview has at most 12 steps and 6 files', () => {
  const chart = notesChart();
  const ov = example();
  for (let i = 0; i < 12; i++) {
    chart.nodes.push({ id: `x${i}`, kind: 'process', label: `x${i}`, role: 'r', origin: 'inferred' });
    ov.nodes.push({ id: `x${i}`, kind: 'process', label: `x${i}`, role: 'r', covers: [`x${i}`] });
  }
  for (let i = 0; i < 6; i++) ov.nodes.push({ id: `f${i}`, kind: 'storage', label: 'f', role: 'r', covers: ['f-notes'] });
  const m = messages(validateOverview('demo/notes', ov, chart));
  assert.match(m, /at most 12 steps, decisions and sub-processes \(found 17\)/);
  assert.match(m, /at most 6 files \(found 8\)/);
});

// demo/alpha: start → checkers (parallel agent) → beta (skill) → end.
const alphaOverview = (covers = [['chk'], ['beta']]) => ({
  unit: 'demo/alpha',
  nodes: [
    { id: 'start', kind: 'start', label: 'Start', role: 'r', covers: ['start'] },
    ...covers.map((c, i) => ({ id: `s${i}`, kind: 'subprocess', label: `Step ${i}`, role: 'r', covers: c })),
    { id: 'end', kind: 'end', label: 'End', role: 'r', covers: ['end'] },
  ],
  edges: ['start', ...covers.map((_, i) => `s${i}`), 'end'].slice(1).map((to, i, all) => ({ from: i ? all[i - 1] : 'start', to, kind: 'flow' })),
});

function alphaModel(overview = alphaOverview()) {
  const s = scan(copyFixture('plugin'));
  const fragments = new Map(['demo__alpha', 'demo__agent-checker'].map((n) => { const f = frag(n); return [f.unit, f]; }));
  assert.deepEqual(validateOverview('demo/alpha', overview, fragments.get('demo/alpha')).errors, []);
  return mergeModel(s, { units: inventoryAll(s) }, fragments, { run: 'r1', overviews: new Map([['demo/alpha', overview]]) });
}

test('merge adds overview blocks beside the detailed ones; each opens what its covered call opens', () => {
  const m = alphaModel();
  const ov = m.nodes.filter((n) => n.layer === 'overview');
  assert.deepEqual(ov.map((n) => n.id), ['s:demo/alpha~start', 's:demo/alpha~s0', 's:demo/alpha~s1', 's:demo/alpha~end']);
  const s0 = ov[1];
  assert.deepEqual(s0.covers, ['s:demo/alpha#chk']);
  assert.equal(s0.parallel, true);
  assert.deepEqual(s0.opens, m.nodes.find((n) => n.id === 's:demo/alpha#chk').opens);
  assert.deepEqual(m.edges.filter((e) => e.layer === 'overview').map((e) => [e.from.split('~')[1], e.to.split('~')[1]]), [['start', 's0'], ['s0', 's1'], ['s1', 'end']]);
  const two = alphaModel(alphaOverview([['chk', 'beta']])).nodes.find((n) => n.id === 's:demo/alpha~s0');
  assert.equal(two.opens.length, 2, 'a step standing for two calls opens both');
});

test('views keep the overview apart: detailed nodes, the map and the exports', () => {
  const m = alphaModel();
  const views = buildViews(m);
  const alpha = views.find((v) => v.id === 's:demo/alpha');
  assert.ok(alpha.nodes.every((id) => !id.includes('~')));
  assert.deepEqual(alpha.overview.nodes, ['s:demo/alpha~start', 's:demo/alpha~s0', 's:demo/alpha~s1', 's:demo/alpha~end']);
  assert.equal(alpha.overview.edges.length, 3);
  assert.equal(views.find((v) => v.id === 'a:demo/checker').overview, undefined);
  const map = views.find((v) => v.kind === 'map');
  assert.ok(map.calls.every((c) => !c.via.includes('~')));
  const md = renderMarkdown(m, views);
  const section = md.slice(md.indexOf('## demo › alpha'));
  assert.ok(section.indexOf('### Overview') < section.indexOf('### Detailed'));
  assert.match(section, /\| Step 0 ×N \| subprocess \| r \| Check each file \|/);
  const fj = figjamDiagrams(m, views).filter((d) => d.view === 's:demo/alpha');
  assert.deepEqual(fj.map((d) => [d.name, d.file]), [['demo / alpha · overview', 'figjam/s_demo_alpha.overview.mmd'], ['demo / alpha', 'figjam/s_demo_alpha.mmd']]);
  assert.match(fj[0].mermaid, /n1\[\["Step 0 ×N"\]\]/);
});

test('an overview lays out like any chart', async () => {
  const m = alphaModel();
  const { SchemLayout, elk } = loadLayout();
  const v = overviewView(buildViews(m).find((x) => x.id === 's:demo/alpha'));
  const L = await SchemLayout.compute(v, new Map(m.nodes.map((n) => [n.id, n])), elk, { showFiles: true });
  assert.equal(L.blocks.length, 4);
  assert.deepEqual(checkLayout(L), []);
});

test('commands: overviews lists units, context prints the detailed chart, save and validate check it, merge reports it', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  assert.deepEqual(runSi(['overviews', '--root', root]).json.units, []);
  const alpha = frag('demo__alpha');
  assert.equal(runSi(['save-unit', '--root', root, '--unit', 'demo/alpha'], { input: JSON.stringify(alpha) }).json.ok, true);
  assert.deepEqual(runSi(['overviews', '--root', root]).json.units, ['demo/alpha']);

  const ctx = runSi(['context', '--root', root, '--unit', 'demo/alpha', '--overview', '--save']);
  assert.equal(ctx.code, 0, ctx.stderr);
  assert.match(ctx.stdout, /# schem-it overview task: demo\/alpha/);
  assert.match(ctx.stdout, /\| chk \| subprocess \| Check each file \| .* \| calls agent `demo:checker` in parallel \| beta \|/);
  assert.match(ctx.stdout, /save-unit --overview --root '.*' --run '\S+' --unit 'demo\/alpha' --file '[^']*\/drafts\/demo-alpha\.overview\.json'/);
  assert.match(runSi(['context', '--root', root, '--unit', 'demo/agent-checker', '--overview']).stderr, /no valid detailed result/);

  const bad = alphaOverview([['chk']]);
  const r = runSi(['save-unit', '--overview', '--root', root, '--unit', 'demo/alpha'], { input: JSON.stringify(bad) });
  assert.equal(r.json.ok, false);
  assert.match(messages(r.json), /"beta" \(Write the report\) is not covered/);
  assert.equal(runSi(['validate', '--overview', '--root', root, '--unit', 'demo/alpha']).json.ok, false);
  assert.equal(runSi(['merge', '--root', root]).json.noOverview[0], 'demo/alpha');

  const draft = /--file '([^']+)'/.exec(ctx.stdout)[1];
  fs.writeFileSync(draft, JSON.stringify(alphaOverview()));
  assert.equal(runSi(['save-unit', '--overview', '--root', root, '--unit', 'demo/alpha', '--file', draft]).json.ok, true);
  assert.equal(runSi(['validate', '--overview', '--root', root, '--unit', 'demo/alpha']).json.ok, true);
  const merged = runSi(['merge', '--root', root]).json;
  assert.equal(merged.overviews, 1);
  assert.deepEqual(merged.noOverview, []);
  assert.equal(runSi(['render', '--root', root, '--format', 'html']).json.ok, true);
});

test('viewer has the Overview | Detailed switch, the highlight of covered blocks and the links between levels', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  for (const s of ['id="layers"', 'id="l-overview"', 'id="l-detail"', 'function showCovered(', 'function toOverview(', "row('Covers'", "row('Overview step'", "'Back to overview'", '.node.covered .shape']) assert.ok(t.includes(s), s);
});
