import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { buildViews } from '../../skills/schem-it/scripts/lib/views.mjs';
import { renderHtml } from '../../skills/schem-it/scripts/lib/render-html.mjs';
import { copyFixture, FIXTURES, runSi } from '../helpers.mjs';

const TEMPLATE = fileURLToPath(new URL('../../skills/schem-it/templates/viewer.html', import.meta.url));

function demoModel() {
  const s = scan(copyFixture('plugin'));
  const f = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', 'plugin', 'demo__alpha.json'), 'utf8'));
  return mergeModel(s, { units: inventoryAll(s) }, new Map([[f.unit, f]]), { run: 'r1' });
}

test('template has each placeholder exactly once', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  for (const p of ['<!--TITLE-->', '/*ELK*/', '/*LAYOUT*/', '/*DATA*/']) assert.equal(t.split(p).length, 2, p);
});

test('output embeds model, views and ELK, and makes no network requests', () => {
  const m = demoModel();
  const html = renderHtml(m, buildViews(m));
  assert.match(html, /<title>demo · schem-it<\/title>/);
  assert.match(html, /const DATA = \{"model":/);
  assert.match(html, /g\.ELK = f\(\)/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href="?https?:/i);
  assert.doesNotMatch(html, /\/\*(ELK|LAYOUT|DATA)\*\/|<!--TITLE-->/);
  assert.match(html, /globalThis\.SchemLayout = /);
});

test('labels containing </script> cannot break out of the data script', () => {
  const m = demoModel();
  m.nodes.find((n) => n.id === 's:demo/alpha#chk').label = '</script><script>alert(1)</script>';
  const html = renderHtml(m, buildViews(m), { elk: '/* elk */' });
  const dataScript = html.slice(html.indexOf('const DATA'));
  assert.doesNotMatch(dataScript.slice(0, dataScript.indexOf(';\n')), /<\/script>/);
  assert.match(html, /\\u003c\/script>/);
});

test('render command writes schem.html by default', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  runSi(['merge', '--root', root]);
  const r = runSi(['render', '--root', root]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.files.length, 1);
  assert.match(r.json.files[0], /schem\.html$/);
  assert.ok(fs.statSync(r.json.files[0]).size > 1_000_000);
});

test('template draws the flowchart vocabulary and drops the old block kinds', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  for (const k of ['start', 'io', 'process', 'decision', 'subprocess', 'storage', 'user']) assert.match(t, new RegExp(`--${k}-fill:`), k);
  assert.match(t, /id="legend"/);
  for (const old of ['skill-call', 'collapsed', 't-reference', 'phase']) assert.doesNotMatch(t, new RegExp(old), old);
});

test('viewer has the table overlay, branch rows and script-command names', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  for (const s of ['id="overlay"', 'id="ov-close"', "'script-command': 'Script'", 'function openDetail(', "'row more' : 'row'", "row('Branches'", "row('Run by'"]) assert.ok(t.includes(s), s);
});

test('viewer has the Problems page, block marks, panel lists and When it runs', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  for (const s of ['id="to-problems"', 'function renderProblems(', 'function openProblem(', 'function drawMark(', 'function problemList(', "'When it runs'", '--sev-error:', 'model.problems ?? []']) assert.ok(t.includes(s), s);
  const m = demoModel();
  assert.ok(m.problems.length);
  assert.match(renderHtml(m, buildViews(m), { elk: '/* elk */' }), /"problems":\[\{"id":"p1"/);
});

test('viewer names script units, marks scripts nothing runs and shows function calls', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  for (const s of ["'script-command': 'Script'", 'not run by anything', "n.calls === 'function'"]) assert.ok(t.includes(s), s);
});
