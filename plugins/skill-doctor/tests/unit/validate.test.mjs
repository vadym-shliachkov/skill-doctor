import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateFragment, checkCitation } from '../../skills/schem-it/scripts/lib/validate.mjs';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { copyFixture, runSi } from '../helpers.mjs';

function setup() {
  const root = copyFixture('single-skill');
  const s = scan(root);
  return { root: s.root, inv: inventoryAll(s).alpha };
}

const src = (lines, quote) => ({ file: 'SKILL.md', lines, quote });

function goodFragment(inv) {
  const script = inv.facts.find((f) => f.path === 'scripts/build.mjs');
  return {
    unit: 'alpha',
    nodes: [
      { id: 'start', kind: 'start', label: 'Start', role: 'The user runs the skill.', origin: 'inferred', source: src([8, 8], 'Steps') },
      { id: 's1', kind: 'process', label: 'Read house style', role: 'Loads the house style.', loads: ['references/style.md'], origin: 'inferred', source: src([10, 10], 'Read references/style.md for the house style.') },
      { id: 'build', kind: 'process', label: 'Collect notes', role: 'Collects notes.', command: 'node scripts/build.mjs collect', origin: 'static', fact: script.id, source: src([11, 11], 'node scripts/build.mjs collect') },
      { id: 'notes', kind: 'storage', label: 'notes.json', role: 'The collected notes.', path: 'notes.json', holds: 'Every note gathered by the collector.', origin: 'inferred', source: src([11, 11], 'to gather the notes into notes.json') },
      { id: 'ask', kind: 'process', user: true, label: 'Ask user to approve outline', role: 'Asks for approval.', origin: 'inferred', source: src([12, 12], 'Ask the user to approve the outline.') },
      { id: 'ok', kind: 'decision', label: 'Outline approved?', role: 'Waits for the answer.', origin: 'inferred', source: src([12, 12], 'STOP until they answer.') },
      { id: 'write', kind: 'process', label: 'Write report', role: 'Writes the report.', origin: 'inferred', source: src([13, 13], 'Write report.md from notes.json.') },
      { id: 'report', kind: 'io', direction: 'out', label: 'report.md', role: 'The report for the user.', origin: 'inferred', source: src([13, 13], 'Write report.md') },
      { id: 'end', kind: 'end', label: 'End', role: 'Done.', origin: 'inferred', source: src([13, 13], 'Write report.md') },
    ],
    edges: [
      { from: 'start', to: 's1', kind: 'flow', source: src([10, 10], 'Read `references/style.md`') },
      { from: 's1', to: 'build', kind: 'flow', source: src([11, 11], 'Run node scripts/build.mjs collect') },
      { from: 'build', to: 'notes', kind: 'writes', label: 'collected notes', source: src([11, 11], 'to gather the notes into notes.json') },
      { from: 'build', to: 'ask', kind: 'flow', source: src([12, 12], 'Ask the user to approve the outline.') },
      { from: 'ask', to: 'ok', kind: 'flow', source: src([12, 12], 'STOP until they answer.') },
      { from: 'ok', to: 'write', kind: 'flow', label: 'yes', source: src([13, 13], 'Write report.md from notes.json.') },
      { from: 'ok', to: 'ask', kind: 'flow', label: 'no', source: src([12, 12], 'Ask the user to approve the outline.') },
      { from: 'notes', to: 'write', kind: 'reads', label: 'notes', source: src([13, 13], 'from notes.json') },
      { from: 'write', to: 'report', kind: 'flow', source: src([13, 13], 'Write report.md') },
      { from: 'report', to: 'end', kind: 'flow', source: src([13, 13], 'Write report.md') },
    ],
  };
}

const messages = (root, inv, f) => validateFragment(root, 'alpha', f, inv).errors.map((e) => e.message);
const has = (msgs, re) => assert.ok(msgs.some((m) => re.test(m)), `missing ${re} in ${JSON.stringify(msgs)}`);

test('accepts a valid flowchart (quotes may drop backticks)', () => {
  const { root, inv } = setup();
  assert.deepEqual(validateFragment(root, 'alpha', goodFragment(inv), inv), { ok: true, errors: [] });
});

test('rejects schema errors before anything else', () => {
  const { root, inv } = setup();
  const f = goodFragment(inv);
  f.nodes[0].kind = 'step';
  const r = validateFragment(root, 'alpha', f, inv);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].path, '$.nodes[0].kind');
});

test('rejects wrong quotes, bad line ranges and files outside the root', () => {
  const { root, inv } = setup();
  const f = goodFragment(inv);
  f.nodes[0].source.quote = 'text that is not there';
  f.nodes[2].source.lines = [11, 999];
  f.nodes[4].source.file = '../outside.md';
  const msgs = validateFragment(root, 'alpha', f, inv).errors.map((e) => `${e.path} ${e.message}`);
  assert.ok(msgs.some((m) => m.startsWith('$.nodes[0].source quote not found')));
  assert.ok(msgs.some((m) => m.startsWith('$.nodes[2].source lines 11-999 outside')));
  assert.ok(msgs.some((m) => m.startsWith('$.nodes[4].source file is outside')));
});

test('rejects dangling edges, duplicate ids, wrong unit, unknown facts and edges between the wrong kinds', () => {
  const { root, inv } = setup();
  const f = goodFragment(inv);
  f.nodes.push({ ...f.nodes[3] });
  f.nodes[2].fact = 'f99';
  f.edges.push({ from: 'write', to: 'nope', kind: 'flow', source: f.edges[0].source });
  f.edges.push({ from: 'notes', to: 'write', kind: 'flow', source: f.edges[0].source });
  f.unit = 'other';
  const msgs = messages(root, inv, f);
  for (const re of [/must be "alpha"/, /duplicate id "notes"/, /unknown fact "f99"/, /unknown node "nope"/, /flow cannot go from storage to process/]) has(msgs, re);
});

test('one start with one exit, at least one end', () => {
  const { root, inv } = setup();
  const noEnd = goodFragment(inv);
  noEnd.nodes = noEnd.nodes.filter((n) => n.id !== 'end');
  noEnd.edges = noEnd.edges.filter((e) => e.to !== 'end');
  has(messages(root, inv, noEnd), /at least one end block is required/);
  const twoStarts = goodFragment(inv);
  twoStarts.nodes.push({ ...twoStarts.nodes[0], id: 'start2' });
  twoStarts.edges.push({ ...twoStarts.edges[0], from: 'start2' });
  has(messages(root, inv, twoStarts), /exactly one start block is required \(found 2\)/);
  const intoStart = goodFragment(inv);
  intoStart.edges.find((e) => e.label === 'no').to = 'start';
  has(messages(root, inv, intoStart), /flow cannot go from decision to start/);
});

test('a decision has exactly two exits with different labels', () => {
  const { root, inv } = setup();
  const one = goodFragment(inv);
  one.edges = one.edges.filter((e) => e.label !== 'no');
  has(messages(root, inv, one), /decision "ok" needs exactly two outgoing flows .*found 1/);
  const same = goodFragment(inv);
  same.edges.find((e) => e.label === 'no').label = 'Yes';
  has(messages(root, inv, same), /decision "ok" needs a different label on each exit/);
  const unlabelled = goodFragment(inv);
  delete unlabelled.edges.find((e) => e.label === 'no').label;
  has(messages(root, inv, unlabelled), /decision "ok" needs a different label on each exit/);
});

test('every other flow block has exactly one exit', () => {
  const { root, inv } = setup();
  const f = goodFragment(inv);
  f.edges.push({ from: 's1', to: 'ask', kind: 'flow', source: f.edges[0].source });
  has(messages(root, inv, f), /process "s1" needs exactly one outgoing flow \(found 2\)/);
});

test('every block is reachable from start and reaches an end', () => {
  const { root, inv } = setup();
  const f = goodFragment(inv);
  f.nodes.push({ id: 'lost', kind: 'process', label: 'Lost', role: 'Unreachable.', origin: 'inferred', source: f.nodes[1].source });
  f.edges.push({ from: 'lost', to: 'end', kind: 'flow', source: f.edges[0].source });
  f.nodes.push({ id: 'spin', kind: 'process', label: 'Spin', role: 'Never ends.', origin: 'inferred', source: f.nodes[1].source });
  f.edges.push({ from: 'spin', to: 'spin', kind: 'flow', source: f.edges[0].source });
  f.edges.find((e) => e.label === 'no').to = 'spin';
  const msgs = messages(root, inv, f);
  has(msgs, /process "lost" cannot be reached from start/);
  has(msgs, /process "spin" never reaches an end/);
});

test('storage must be read or written; reads and writes say what', () => {
  const { root, inv } = setup();
  const f = goodFragment(inv);
  f.nodes.push({ ...f.nodes[3], id: 'stray' });
  delete f.edges.find((e) => e.kind === 'reads').label;
  const msgs = messages(root, inv, f);
  has(msgs, /storage "stray" is not read or written by any block/);
  has(msgs, /reads edge needs a label saying what is read/);
});

test('kind-specific fields are required', () => {
  const { root, inv } = setup();
  const f = goodFragment(inv);
  delete f.nodes[7].direction;
  delete f.nodes[3].holds;
  f.nodes[2] = { ...f.nodes[2], kind: 'subprocess', target: 'demo:checker' };
  delete f.nodes[2].command;
  const msgs = messages(root, inv, f);
  for (const m of ['io needs direction', 'storage needs holds', 'subprocess needs calls']) assert.ok(msgs.includes(m), m);
});

test('checkCitation works on CRLF files with a BOM', () => {
  const { root } = setup();
  fs.writeFileSync(path.join(root, 'crlf.md'), '\uFEFFline one\r\nline **two** here\r\nline three\r\n');
  assert.equal(checkCitation(root, { file: 'crlf.md', lines: [2, 3], quote: 'two here line three' }, new Map()), null);
  assert.match(checkCitation(root, { file: 'crlf.md', lines: [5, 5], quote: 'xyz' }, new Map()), /outside/);
});

test('save-unit accepts JSON wrapped in prose and validate re-checks it', () => {
  const root = copyFixture('single-skill');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const inv = JSON.parse(fs.readFileSync(path.join(root, '.schem-it', JSON.parse(fs.readFileSync(path.join(root, '.schem-it', 'latest.json'))).run, 'inventory.json'))).units.alpha;
  const body = `Here you go:\n\`\`\`json\n${JSON.stringify(goodFragment(inv))}\n\`\`\``;
  const saved = runSi(['save-unit', '--root', root, '--unit', 'alpha'], { input: body });
  assert.equal(saved.code, 0, saved.stdout + saved.stderr);
  assert.deepEqual({ ok: saved.json.ok, nodes: saved.json.nodes, edges: saved.json.edges }, { ok: true, nodes: 9, edges: 10 });
  assert.equal(runSi(['validate', '--root', root, '--unit', 'alpha']).json.ok, true);
  const bad = runSi(['save-unit', '--root', root, '--unit', 'alpha'], { input: 'nothing useful' });
  assert.equal(bad.code, 1);
  assert.equal(bad.json.errors[0].message, 'No JSON object found in the input');
  const unknown = runSi(['validate', '--root', root, '--unit', 'zzz']);
  assert.match(unknown.stderr, /Unknown unit "zzz"/);
});

test('save-unit --file reads the draft an analyst wrote, and says so when there is none', () => {
  const root = copyFixture('single-skill');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const inv = JSON.parse(fs.readFileSync(path.join(root, '.schem-it', JSON.parse(fs.readFileSync(path.join(root, '.schem-it', 'latest.json'))).run, 'inventory.json'))).units.alpha;
  // Quotes, backticks and a dollar sign: what broke the heredoc saves.
  const frag = goodFragment(inv);
  frag.nodes[0].role = 'It runs `node "x.mjs"` with \'$ROOT\' set.';
  const draft = path.join(root, 'draft alpha.json');
  fs.writeFileSync(draft, JSON.stringify(frag));
  const saved = runSi(['save-unit', '--root', root, '--unit', 'alpha', '--file', draft]);
  assert.equal(saved.code, 0, saved.stdout + saved.stderr);
  assert.equal(saved.json.ok, true);
  assert.equal(runSi(['validate', '--root', root, '--unit', 'alpha']).json.ok, true);
  const none = runSi(['save-unit', '--root', root, '--unit', 'alpha', '--file', path.join(root, 'nope.json')]);
  assert.equal(none.code, 1);
  assert.match(none.json.errors[0].message, /^No file at .*nope\.json: write your JSON there first$/);
});

import { makeResolver } from '../../skills/schem-it/scripts/lib/inventory.mjs';

const SEO = 'skills/audit/agents/seo.md';
const CONTRACT = 'skills/audit/agents/_contract.md';
function seoSetup() {
  const s = scan(copyFixture('deep'));
  const unit = s.units.find((u) => u.id === 'deep/audit/seo');
  return { root: s.root, inv: inventoryAll(s)[unit.id], resolve: makeResolver(s.root, unit) };
}
function seoFragment() {
  const at = (lines, quote, file = SEO) => ({ file, lines, quote });
  return {
    unit: 'deep/audit/seo',
    nodes: [
      { id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: at([1, 1], 'Area: SEO') },
      { id: 'rules', kind: 'process', label: 'Check every SEO rule', role: 'r', table: { lines: [5, 8] }, origin: 'inferred', source: at([5, 5], 'Default severity') },
      { id: 'facts', kind: 'process', label: 'Record SEO facts', role: 'r', list: { lines: [12, 13] }, origin: 'inferred', source: at([10, 10], 'Facts to record') },
      { id: 'out', kind: 'storage', label: 'findings.json', role: 'r', path: 'findings.json', holds: 'Findings', schema: 'references/finding.schema.json', origin: 'inferred', source: at([3, 3], 'save your findings to findings.json', CONTRACT) },
      { id: 'team', kind: 'subprocess', label: 'Checkers', role: 'r', target: 'deep:runner', calls: 'agent', parallel: true, targets: [{ target: 'agents/seo.md', role: 'Checks SEO' }, 'agents/perf.md'], origin: 'inferred', source: at([3, 3], 'Whether search engines') },
      { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: at([13, 13], 'languages of the site') },
    ],
    edges: [
      { from: 'start', to: 'rules', kind: 'flow', source: at([5, 5], 'Rule') },
      { from: 'rules', to: 'facts', kind: 'flow', source: at([10, 10], 'Facts to record') },
      { from: 'facts', to: 'team', kind: 'flow', source: at([12, 12], 'sitemap location') },
      { from: 'team', to: 'end', kind: 'flow', source: at([13, 13], 'languages') },
      { from: 'facts', to: 'out', kind: 'writes', label: 'findings', source: at([3, 3], 'save your findings', CONTRACT) },
    ],
  };
}

test('accepts tables, lists, schema files and target objects; blank lines around a table are fine', () => {
  const { root, inv, resolve } = seoSetup();
  assert.deepEqual(validateFragment(root, 'deep/audit/seo', seoFragment(), inv, { resolve }), { ok: true, errors: [] });
  const padded = seoFragment();
  padded.nodes[1].table.lines = [4, 9];
  assert.equal(validateFragment(root, 'deep/audit/seo', padded, inv, { resolve }).ok, true);
});

test('rejects a table range that is not a table, a list range that is not a list, a missing schema and a target object without target', () => {
  const { root, inv, resolve } = seoSetup();
  const f = seoFragment();
  f.nodes[1].table.lines = [1, 3];
  f.nodes[2].list = { lines: [5, 8] };
  f.nodes[3].schema = 'references/nope.json';
  const msgs = validateFragment(root, 'deep/audit/seo', f, inv, { resolve }).errors.map((e) => `${e.path} ${e.message}`);
  assert.ok(msgs.some((m) => m.startsWith('$.nodes[1].table') && /is not a Markdown table/.test(m)), msgs.join('\n'));
  assert.ok(msgs.some((m) => m.startsWith('$.nodes[2].list') && /is not a list/.test(m)), msgs.join('\n'));
  assert.ok(msgs.some((m) => m.startsWith('$.nodes[3].schema') && /schema not found/.test(m)), msgs.join('\n'));
  const bad = seoFragment();
  bad.nodes[4].targets = [{ role: 'no target' }];
  assert.equal(validateFragment(root, 'deep/audit/seo', bad, inv, { resolve }).errors[0].path, '$.nodes[4].targets[0]');
});

test('rejects table ranges outside the file or longer than 200 lines', () => {
  const { root, inv, resolve } = seoSetup();
  const f = seoFragment();
  f.nodes[1].table = { file: CONTRACT, lines: [1, 400] };
  const msgs = validateFragment(root, 'deep/audit/seo', f, inv, { resolve }).errors.map((e) => e.message);
  assert.ok(msgs.some((m) => /lines 1-400 outside/.test(m)), msgs.join('\n'));
});

test('a call of kind "function" names <path>#<function>', () => {
  const { root, inv, resolve } = seoSetup();
  const f = seoFragment();
  delete f.nodes[4].targets;
  delete f.nodes[4].parallel;
  f.nodes[4].calls = 'function';
  f.nodes[4].target = 'agents/seo.md';
  const msgs = validateFragment(root, 'deep/audit/seo', f, inv, { resolve }).errors.map((e) => `${e.path} ${e.message}`);
  assert.ok(msgs.some((m) => m.startsWith('$.nodes[4].target') && /<path>#<function>/.test(m)), msgs.join('\n'));
  f.nodes[4].target = 'scripts/run_eval.py#run_eval';
  assert.equal(validateFragment(root, 'deep/audit/seo', f, inv, { resolve }).ok, true);
});

test('block-types.md documents calls of kind function', () => {
  const doc = fs.readFileSync(new URL('../../skills/schem-it/references/block-types.md', import.meta.url), 'utf8');
  assert.match(doc, /`function`/);
  assert.match(doc, /<path>#<function>/);
});
