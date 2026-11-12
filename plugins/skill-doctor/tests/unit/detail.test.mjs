import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { MODEL_VERSION, mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { discoverUnits } from '../../skills/schem-it/scripts/lib/discover.mjs';
import { copyFixture } from '../helpers.mjs';
import { firstRound, secondRound } from '../deep-model.mjs';

const SEO = 'skills/audit/agents/seo.md';
const node = (m, id) => m.nodes.find((n) => n.id === id);

test('model version is 3', () => {
  assert.equal(MODEL_VERSION, 3);
  assert.equal(firstRound().model.version, 3);
});

test('a parallel group keeps its runner and lists each branch with its label, role and chart', () => {
  const g = node(firstRound().model, 's:deep/audit#areas');
  assert.equal(g.runner, 'a:deep/runner');
  assert.deepEqual(g.targets, ['agents/seo.md', 'agents/perf.md']);
  assert.equal(g.count, 2);
  assert.deepEqual(g.branches, [
    { target: 'agents/seo.md', label: 'Area: SEO (`seo`)', role: 'Checks SEO', opens: ['t:deep/audit/seo'] },
    { target: 'agents/perf.md', label: 'Area: Performance (`perf`)', role: 'Checks speed', opens: ['t:deep/audit/perf'] },
  ]);
  assert.deepEqual(g.opens, ['a:deep/runner', 't:deep/audit/seo', 't:deep/audit/perf']);
});

test('one prompt run per item in parallel stays ×N; only different branches are counted', () => {
  const { s, fragments } = firstRound();
  const audit = structuredClone(fragments.get('deep/audit'));
  audit.nodes.find((n) => n.id === 'areas').targets = [{ target: 'agents/seo.md', role: 'Checks one area' }];
  const one = node(mergeModel(s, { units: {} }, new Map([...fragments, ['deep/audit', audit]]), { run: 'r1' }), 's:deep/audit#areas');
  assert.equal(one.count, undefined);
  assert.deepEqual(one.targets, ['agents/seo.md']);
  audit.nodes.find((n) => n.id === 'areas').count = 4;
  assert.equal(node(mergeModel(s, { units: {} }, new Map([...fragments, ['deep/audit', audit]]), { run: 'r1' }), 's:deep/audit#areas').count, 4);
});

test('tables and lists are copied from the cited lines', () => {
  const m = firstRound().model;
  const rules = node(m, 't:deep/audit/seo#rules');
  assert.deepEqual(rules.table.columns, ['Rule', 'Default severity', 'What to check']);
  assert.deepEqual(rules.table.rows, [['seo.missing-title', 'high', 'Pages without a <title>.'], ['seo.pipe', 'low', 'A cell with an escaped | pipe.']]);
  assert.deepEqual(rules.table.source, { file: SEO, lines: [5, 8] });
  assert.deepEqual(node(m, 't:deep/audit/seo#facts').list.items.map((i) => i.text), ['seo.sitemapUrl: sitemap location.', 'seo.languages: languages of the site.']);
});

test('a file with a schema gets its fields; without one it keeps the fields the analyst listed', () => {
  const m = firstRound().model;
  const findings = node(m, 's:deep/audit#findings');
  assert.equal(findings.schemaFile, 'skills/audit/references/finding.schema.json');
  assert.deepEqual(findings.fields.find((f) => f.name === 'evidence[].type'), { name: 'evidence[].type', type: 'string', required: true, values: ['file', 'url'], depth: 1 });
  assert.deepEqual(node(m, 't:deep/audit/seo#notes').fields, [{ name: 'area', holds: 'The area key', depth: 0 }, { name: 'facts.key', holds: 'A fact key', depth: 1 }]);
});

test('a step that runs a script command opens its chart, also from a sibling script chart', () => {
  const { model } = secondRound();
  assert.deepEqual(node(model, 's:deep/audit#collect').opens, ['x:deep/audit/run-tool-collect']);
  assert.deepEqual(node(model, 's:deep/audit#merge').opens, ['x:deep/audit/run-tool-merge']);
  assert.deepEqual(node(model, 'x:deep/audit/run-tool-collect#then').opens, ['x:deep/audit/run-tool-merge']);
  assert.equal(node(firstRound().model, 's:deep/audit#collect').opens, undefined);
});

import { buildViews } from '../../skills/schem-it/scripts/lib/views.mjs';
import { renderMarkdown } from '../../skills/schem-it/scripts/lib/render-mermaid.mjs';

test('script commands have views under the skill that holds the script and a group on the plugin index', () => {
  const { model } = secondRound();
  const views = buildViews(model);
  const collect = views.find((v) => v.id === 'x:deep/audit/run-tool-collect');
  assert.equal(collect.kind, 'script-command');
  assert.equal(collect.parent, 's:deep/audit');
  assert.equal(views.find((v) => v.id === 's:deep/audit').nodes.some((id) => id.startsWith('x:')), false);
  const index = views.find((v) => v.id === 'p:deep');
  assert.deepEqual(index.groups.map((g) => g.title), ['Skills', 'Agents', 'Agent prompts', 'Scripts']);
  assert.deepEqual(index.groups[3].items, ['x:deep/audit/run-tool-collect', 'x:deep/audit/run-tool-merge']);
});

test('schem.md lists branches, tables, lists and fields under each chart', () => {
  const { model } = secondRound();
  const md = renderMarkdown(model, buildViews(model));
  assert.match(md, /\*\*Analysts check each area ×2: branches\*\*/);
  assert.match(md, /\| Area: SEO \(`seo`\) \| Checks SEO \|/);
  assert.match(md, /\*\*Check every rule: table\*\* \(skills\/audit\/agents\/seo\.md:5-8\)/);
  assert.match(md, /\| seo\.pipe \| low \| A cell with an escaped \\\| pipe\. \|/);
  assert.match(md, /- seo\.languages: languages of the site\./);
  assert.match(md, /\| evidence\[\]\.type \| string: file, url \| yes \|/);
});

import { inventoryAll } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { buildContext } from '../../skills/schem-it/scripts/lib/context.mjs';

test('context: a bundled prompt names its shared prompt and says to draw the combined work', () => {
  const s = scan(copyFixture('deep'));
  const seo = s.units.find((u) => u.id === 'deep/audit/seo');
  const text = buildContext({ root: s.root, run: 'r1', unit: seo, inventory: inventoryAll(s)[seo.id], units: s.units, save: false, siPath: 'si.mjs' });
  assert.match(text, /always handed over together with `skills\/audit\/agents\/_contract\.md`/);
  assert.match(text, /draw the subagent's combined work/);
  assert.match(text, /skills\/audit\/scripts\/tool\.mjs:4/);
});

test('context: a script command names its script, callers and sibling commands', () => {
  const { model, s } = firstRound();
  const d = discoverUnits(s, model);
  const unit = d.scan.units.find((u) => u.id === 'deep/audit/run-tool-collect');
  const text = buildContext({ root: d.scan.root, run: 'r1', unit, inventory: { facts: [] }, units: d.scan.units, save: false, siPath: 'si.mjs' });
  assert.match(text, /## Script command under analysis/);
  assert.match(text, /the subcommand `collect` of `skills\/audit\/scripts\/tool\.mjs`/);
  assert.match(text, /- deep\/audit: `skills\/audit\/SKILL\.md:10`/);
  assert.match(text, /## Other commands of this script/);
  assert.match(text, /\| `merge` \| deep\/audit\/run-tool-merge \|/);
});

test('analyst instructions and block types document branches, tables, lists, schema and fields', async () => {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const analyst = read('../../skills/schem-it/agents/analyst.md');
  for (const re of [/"role": "<what this branch does/, /\*\*Tables and lists\.\*\*/, /`schema`/, /`fields`/]) assert.match(analyst, re);
  const types = read('../../skills/schem-it/references/block-types.md');
  for (const re of [/`table`/, /`list`/, /`schema`/, /`fields`/, /\{ "target", "role" \}/]) assert.match(types, re);
});

test('a sub-process with a command links its script chart; loads with placeholders are not missing', async () => {
  const { mergeModel } = await import('../../skills/schem-it/scripts/lib/merge.mjs');
  const { s, fragments, model } = firstRound();
  const at = { file: 'skills/audit/SKILL.md', lines: [11, 11], quote: 'deep:runner' };
  const runner = {
    unit: 'deep/agent-runner',
    nodes: [
      { id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: at },
      { id: 'fetch', kind: 'subprocess', label: 'Fetch instructions', role: 'r', target: 'agents/seo.md', calls: 'agent', command: 'node scripts/tool.mjs context', origin: 'inferred', source: at },
      { id: 'read', kind: 'process', label: 'Read', role: 'r', loads: ['agents/<area>.md', 'references/${stack}.md', 'agents/nope.md'], origin: 'inferred', source: at },
      { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: at },
    ],
    edges: [['start', 'fetch'], ['fetch', 'read'], ['read', 'end']].map(([from, to]) => ({ from, to, kind: 'flow', source: at })),
  };
  fragments.set('deep/agent-runner', runner);
  const d = discoverUnits(s, mergeModel(s, { units: {} }, fragments, { run: 'r1' }));
  const final = mergeModel(d.scan, { units: {} }, fragments, { run: 'r1' });
  const fetch = node(final, 'a:deep/runner#fetch');
  assert.equal(fetch.script, 'x:deep/audit/run-tool-context');
  assert.deepEqual(fetch.opens, ['t:deep/audit/seo']);
  assert.deepEqual(node(final, 'a:deep/runner#read').loadsMissing, ['agents/nope.md']);
  assert.ok(model);
});

test('a command-type sub-process opens the script chart it names as its runner, and its prompt branches', async () => {
  const { mergeModel } = await import('../../skills/schem-it/scripts/lib/merge.mjs');
  const { s, fragments } = firstRound();
  const at = { file: 'skills/audit/SKILL.md', lines: [11, 11], quote: 'deep:runner' };
  fragments.set('deep/agent-runner', {
    unit: 'deep/agent-runner',
    nodes: [
      { id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: at },
      { id: 'fetch', kind: 'subprocess', label: 'Analyse one area', role: 'r', calls: 'command', target: 'tool.mjs context', targets: [{ target: 'agents/seo.md', role: 'SEO' }], origin: 'inferred', source: at },
      { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: at },
    ],
    edges: [['start', 'fetch'], ['fetch', 'end']].map(([from, to]) => ({ from, to, kind: 'flow', source: at })),
  });
  const d = discoverUnits(s, mergeModel(s, { units: {} }, fragments, { run: 'r1' }));
  const fetch = node(mergeModel(d.scan, { units: {} }, fragments, { run: 'r1' }), 'a:deep/runner#fetch');
  assert.equal(fetch.script, 'x:deep/audit/run-tool-context');
  assert.equal(fetch.runner, 'x:deep/audit/run-tool-context');
  assert.deepEqual(fetch.branches.map((b) => b.opens), [['t:deep/audit/seo']]);
  assert.equal(fetch.outOfScope, undefined);
});
