import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { buildViews, breadcrumb } from '../../skills/schem-it/scripts/lib/views.mjs';
import { mermaidForView, mermaidLabel, renderMarkdown } from '../../skills/schem-it/scripts/lib/render-mermaid.mjs';
import { figjamDiagrams } from '../../skills/schem-it/scripts/lib/figjam.mjs';
import { copyFixture, FIXTURES, runSi } from '../helpers.mjs';

const frag = (set, name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', set, `${name}.json`), 'utf8'));

function model(fixture, set, names) {
  const s = scan(copyFixture(fixture));
  const units = inventoryAll(s);
  return mergeModel(s, { units }, new Map(names.map((n) => { const f = frag(set, n); return [f.unit, f]; })), { run: 'r1' });
}

test('plugin index groups its children; skill view matches the golden Mermaid', () => {
  const m = model('plugin', 'plugin', ['demo__alpha', 'demo__agent-checker']);
  const views = buildViews(m);
  assert.deepEqual(views.map((v) => v.id), ['p:demo', 's:demo/alpha', 's:demo/beta', 'a:demo/checker', '@map']);
  assert.equal(views[0].kind, 'index');
  assert.deepEqual(views[0].groups.map((g) => [g.title, g.items]), [
    ['Skills', ['s:demo/alpha', 's:demo/beta']], ['Commands', ['c:demo/hello']], ['Agents', ['a:demo/checker']], ['Hooks', ['h:demo/PreToolUse.0']],
  ]);
  assert.equal(views[3].kind, 'agent-def');
  assert.deepEqual(breadcrumb(views, 's:demo/alpha'), ['demo', 'alpha']);
  const golden = fs.readFileSync(path.join(FIXTURES, 'golden', 'demo-alpha.mmd'), 'utf8');
  assert.equal(mermaidForView(m, views[1]), golden);
});

test('marketplace index lists its plugins', () => {
  const m = model('marketplace', 'marketplace', ['one__start', 'two__finish']);
  const root = buildViews(m)[0];
  assert.equal(root.id, 'm:shop');
  assert.equal(root.kind, 'index');
  assert.deepEqual(root.groups, [{ kind: 'plugin', title: 'Plugins', items: ['p:one', 'p:two'] }]);
});

test('files get one copy per read or write: read before the step, written after it', () => {
  const m = model('marketplace', 'marketplace', ['one__start', 'two__finish']);
  const views = buildViews(m);
  const start = mermaidForView(m, views.find((v) => v.id === 's:one/start'));
  assert.match(start, /\n  d\d+\[\("brief\.md<br>The brief for the finish step\."\)\]/);
  assert.match(start, /\n  n1 -\.->\|"the brief"\| d\d+/);
  const finish = mermaidForView(m, views.find((v) => v.id === 's:two/finish'));
  assert.match(finish, /\n  d\d+ -\.->\|"the brief"\| n1/);
  assert.match(finish, /\n  n3\[\/"final\.md"\/\]/);
});

test('a step that reads and writes the same file gets two copies', () => {
  const m = model('marketplace', 'marketplace', ['one__start', 'two__finish']);
  const view = buildViews(m).find((v) => v.id === 's:one/start');
  view.edges.push({ id: 'x', kind: 'reads', from: 's:one/start#brief', to: 's:one/start#s1', label: 'old brief' });
  const out = mermaidForView(m, view);
  assert.equal((out.match(/\[\("brief\.md/g) ?? []).length, 2);
  assert.match(out, /\n  d\d+ -\.->\|"old brief"\| n1/);
});

test('labels, commands and holds are escaped', () => {
  assert.equal(mermaidLabel('say "hi" | [x] <b>\nnext'), 'say #quot;hi#quot; | [x] #lt;b#gt; next');
  const m = model('plugin', 'plugin', ['demo__alpha']);
  const n = m.nodes.find((x) => x.id === 's:demo/alpha#chk');
  Object.assign(n, { kind: 'process', parallel: false, label: 'Run "end" [now] | <go>', command: 'node x.mjs <run>/a "b"' });
  const out = mermaidForView(m, buildViews(m)[1]);
  assert.match(out, /n1\["Run #quot;end#quot; \[now\] \| #lt;go#gt;<br>node x\.mjs #lt;run#gt;\/a #quot;b#quot;"\]/);
});

test('missing sub-processes get the missing class and a prefix', () => {
  const m = model('marketplace', 'marketplace', ['one__start', 'two__finish']);
  const out = mermaidForView(m, buildViews(m).find((v) => v.id === 's:one/start'));
  assert.match(out, /\[\["missing: two:ghost"\]\]/);
  assert.match(out, /classDef missing stroke:#d64545/);
});

test('markdown: index tables, then one flowchart section per unit', () => {
  const m = model('plugin', 'plugin', ['demo__alpha']);
  const md = renderMarkdown(m, buildViews(m));
  assert.match(md, /^# demo: flowcharts/);
  assert.match(md, /## demo\n\n### Skills\n\n\| Name \| Description \| Flowchart \|/);
  assert.match(md, /\| alpha \| Collects input then hands over\. \| \[open\]\(#demo--alpha\) \|/);
  assert.match(md, /\| \/hello \| Say hello\. \| none: a short command, not analysed \|/);
  assert.match(md, /## demo › alpha\n\n\*\*When it runs:\*\* Collects input then hands over\.\n\n\*\*Problems\*\* \(1 info\)\n\n\| Severity \| Problem \| Block \| Found by \| Source \|\n\|---\|---\|---\|---\|---\|\n\| info \| \*\*No overview\*\*: [^\n]+ \| whole unit \| script \|  \|\n\n```mermaid\nflowchart TD/);
  assert.match(md, /\| Check each file ×N \| subprocess \| Checks every file in parallel\. \| skills\/alpha\/SKILL\.md:8 \|/);
  assert.match(md, /## demo › beta\n\n\*\*When it runs:\*\* Writes the report\.\n\n> Analysis failed/);
});

test('figjam payloads: one per flowchart, top to bottom, no colour classes', () => {
  const m = model('plugin', 'plugin', ['demo__alpha']);
  const d = figjamDiagrams(m, buildViews(m));
  assert.deepEqual(d.map((x) => x.file), ['figjam/s_demo_alpha.mmd', 'figjam/s_demo_beta.mmd', 'figjam/a_demo_checker.mmd', 'figjam/_map.mmd']);
  assert.equal(d[0].name, 'demo / alpha');
  assert.match(d[0].mermaid, /^flowchart TD/);
  assert.doesNotMatch(d[0].mermaid, /classDef k_/);
});

test('render command writes schem.md and figjam files', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  runSi(['merge', '--root', root]);
  const r = runSi(['render', '--root', root, '--format', 'mermaid,figjam']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.json.files.some((f) => f.endsWith('/schem.md')));
  assert.equal(r.json.figjam.length, 4);
  assert.ok(fs.existsSync(r.json.figjam[0].file));
  assert.match(runSi(['render', '--root', root, '--format', 'png']).stderr, /Unknown format "png"/);
});
