import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { buildViews, breadcrumb, MAP_ID } from '../../skills/schem-it/scripts/lib/views.mjs';
import { mermaidForMap, renderMarkdown } from '../../skills/schem-it/scripts/lib/render-mermaid.mjs';
import { figjamDiagrams } from '../../skills/schem-it/scripts/lib/figjam.mjs';
import { loadLayout } from '../layout-check.mjs';
import { secondRound } from '../deep-model.mjs';
import { copyFixture, FIXTURES } from '../helpers.mjs';

const TEMPLATE = fileURLToPath(new URL('../../skills/schem-it/templates/viewer.html', import.meta.url));
const { SchemLayout, elk } = loadLayout();
const frag = (set, name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', set, `${name}.json`), 'utf8'));

function shop() {
  const s = scan(copyFixture('marketplace'));
  return mergeModel(s, { units: inventoryAll(s) }, new Map(['one__start', 'two__finish'].map((n) => { const f = frag('marketplace', n); return [f.unit, f]; })), { run: 'r1' });
}
const mapOf = (views) => views.find((v) => v.kind === 'map');

test('the map lists every unit, its calls and the files units share, framed by plugin', () => {
  const m = shop();
  const views = buildViews(m);
  const map = mapOf(views);
  assert.equal(map.id, MAP_ID);
  assert.equal(views.at(-1), map);
  assert.deepEqual(breadcrumb(views, MAP_ID), ['shop', 'Whole system']);
  assert.deepEqual(map.units, ['s:one/start', 's:two/finish']);
  assert.deepEqual(map.frames.map((f) => [f.id, f.units]), [['p:one', ['s:one/start']], ['p:two', ['s:two/finish']]]);
  assert.deepEqual(map.calls.map((c) => [c.from, c.to, c.via, c.kind]), [['s:one/start', 's:two/finish', 's:one/start#call', 'skill']]);
  assert.deepEqual(map.files, [{ id: 's:one/start#brief', writers: ['s:one/start'], readers: ['s:two/finish'] }]);
});

test('the map shows script runs, parallel agent calls and script-to-script runs; a plugin has no frames', () => {
  const map = mapOf(buildViews(secondRound().model));
  assert.deepEqual(map.frames, []);
  const calls = map.calls.map((c) => `${c.from.split('/').pop()} ${c.kind}${c.parallel ? '∥' : ''} ${c.to.split('/').pop()}`);
  assert.deepEqual(calls, ['audit runs run-tool-collect', 'audit agent∥ runner', 'audit agent∥ seo', 'audit agent∥ perf', 'audit runs run-tool-merge', 'run-tool-collect runs run-tool-merge']);
});

test('units left out by --only are dropped from the map unless something calls them; one chart makes no map', () => {
  const m = shop();
  m.nodes.find((n) => n.id === 's:two/finish').analysis = 'skipped';
  assert.ok(mapOf(buildViews(m)), 'finish is called by start, so it stays');
  m.nodes.find((n) => n.id === 's:one/start#call').opens = [];
  assert.equal(mapOf(buildViews(m)), undefined);
});

test('Markdown puts the map after the top index; FigJam gets it as one more diagram', () => {
  const m = shop();
  const views = buildViews(m);
  const md = renderMarkdown(m, views);
  assert.ok(md.indexOf('## shop › Whole system') < md.indexOf('## shop › one'));
  const mmd = mermaidForMap(m, mapOf(views));
  assert.match(mmd, /^flowchart LR\n {2}subgraph g0\["one"\]\n {4}u0\[\["start"\]\]\n {2}end/);
  assert.match(mmd, /\n {2}u0 -->\|"skill"\| u1\n/);
  assert.match(mmd, /\n {2}u0 -\.-> u2\n {2}u2 -\.-> u1\n/);
  const d = figjamDiagrams(m, views).at(-1);
  assert.deepEqual([d.file, d.name], ['figjam/_map.mmd', 'shop / Whole system']);
  assert.doesNotMatch(d.mermaid, /classDef/);
});

test('map layout: cards in plugin frames; opened charts send each call from its block to the callee Start', async () => {
  const m = shop();
  const views = buildViews(m);
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const viewById = new Map(views.map((v) => [v.id, v]));
  const map = mapOf(views);
  const chartOf = (id) => SchemLayout.compute(viewById.get(id), byId, elk);
  const inside = (p, r) => p.x >= r.x - 0.5 && p.x <= r.x + r.w + 0.5 && p.y >= r.y - 0.5 && p.y <= r.y + r.h + 0.5;

  const cards = await SchemLayout.computeMap(map, byId, elk, { chartOf });
  assert.deepEqual(cards.blocks.map((b) => b.kind).sort(), ['storage', 'unit', 'unit']);
  assert.deepEqual(cards.frames.map((f) => f.kind), ['plugin', 'plugin']);
  for (const f of cards.frames) for (const u of map.frames.find((x) => x.id === f.id).units) assert.ok(inside(cards.blocks.find((b) => b.id === u), f), `${u} sits in ${f.id}`);
  assert.deepEqual(cards.edges.map((e) => e.kind).sort(), ['call', 'reads', 'writes']);
  const call = cards.edges.find((e) => e.kind === 'call');
  assert.equal(call.label.text, 'skill');
  assert.ok(inside(call.points[0], cards.blocks.find((b) => b.id === 's:one/start')));
  assert.ok(inside(call.points.at(-1), cards.blocks.find((b) => b.id === 's:two/finish')));

  const open = await SchemLayout.computeMap(map, byId, elk, { expand: true, chartOf });
  assert.deepEqual(open.frames.map((f) => f.kind).sort(), ['plugin', 'plugin', 'unit', 'unit']);
  assert.ok(!open.blocks.some((b) => b.kind === 'unit'), 'every unit with a chart is opened');
  const c = open.edges.find((e) => e.kind === 'call');
  const via = open.blocks.find((b) => b.id === 's:one/start#call');
  const start = open.blocks.find((b) => b.kind === 'start' && inside(b, open.frames.find((f) => f.id === 's:two/finish')));
  assert.ok(inside(c.points[0], via), 'leaves the calling block');
  assert.equal(c.points.at(-1).y, start.y);
  assert.equal(c.points.at(-1).x, start.x + start.w / 2);
  assert.equal(open.edges.filter((e) => e.kind === 'flow').length, views.filter((v) => map.units.includes(v.id)).reduce((s, v) => s + v.edges.filter((e) => e.kind === 'flow').length, 0));
});

test('viewer has the map page, its controls and the overview card', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  for (const s of ['id="to-map"', 'id="t-expand"', 'id="arrow-call"', 'function drawUnit(', 'function drawFrame(', 'function renderMapPanel(', 'computeMap(', "h('h2', { textContent: 'Whole system' })"]) assert.ok(t.includes(s), s);
});
