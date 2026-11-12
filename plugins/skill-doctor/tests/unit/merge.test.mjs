import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll, knownSkills } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { validateFragment } from '../../skills/schem-it/scripts/lib/validate.mjs';
import { mergeModel, resolveSkillTarget, resolveAgentTarget, fallbackFragment } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { copyFixture, FIXTURES, runSi, tmpDir } from '../helpers.mjs';

const frag = (set, name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', set, `${name}.json`), 'utf8'));

function build(fixture, set, names) {
  const s = scan(copyFixture(fixture));
  const units = inventoryAll(s);
  const fragments = new Map();
  for (const n of names) {
    const f = frag(set, n);
    const v = validateFragment(s.root, f.unit, f, units[f.unit]);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    fragments.set(f.unit, f);
  }
  return { s, units, model: mergeModel(s, { units }, fragments, { run: 'r1' }) };
}

test('fragment fixtures are valid against their fixtures', () => {
  build('marketplace', 'marketplace', ['one__start', 'two__finish']);
  build('plugin', 'plugin', ['demo__alpha', 'demo__agent-checker']);
});

test('marketplace merge: version 3, prefixed ids, sub-process targets, file usage across units, no container edges', () => {
  const { model } = build('marketplace', 'marketplace', ['one__start', 'two__finish']);
  const node = (id) => model.nodes.find((n) => n.id === id);
  assert.equal(model.version, 3);
  assert.equal(node('s:one/start#s1').parent, 's:one/start');
  assert.deepEqual(node('s:one/start#call').resolved, ['s:two/finish']);
  assert.deepEqual(node('s:one/start#call').opens, ['s:two/finish']);
  assert.equal(node('s:one/start#ghost').missing, true);
  assert.equal(node('s:one/start#ghost').opens, undefined);
  assert.equal(node('s:one/start#ext').outOfScope, true);
  assert.equal(node('s:one/start#ext').missing, false);
  assert.equal(node('s:one/start').analysis, 'ok');
  const usage = [
    { unit: 's:one/start', node: 's:one/start#s1', kind: 'writes', label: 'the brief' },
    { unit: 's:two/finish', node: 's:two/finish#s1', kind: 'reads', label: 'the brief' },
  ];
  assert.deepEqual(node('s:one/start#brief').usage, usage);
  assert.deepEqual(node('s:two/finish#brief').usage, usage);
  assert.ok(model.edges.every((e) => ['flow', 'reads', 'writes'].includes(e.kind)));
  assert.ok(model.edges.every((e, i) => e.id === `e${i + 1}`));
  assert.equal(model.warnings.map((w) => w.message).filter((m) => /remote/.test(m)).length, 1);
});

test('plugin merge: a sub-process opens the agent and the skill it calls; a missing fragment falls back', () => {
  const { model } = build('plugin', 'plugin', ['demo__alpha', 'demo__agent-checker']);
  const node = (id) => model.nodes.find((n) => n.id === id);
  assert.deepEqual(node('s:demo/alpha#chk').resolved, ['a:demo/checker']);
  assert.deepEqual(node('s:demo/alpha#chk').opens, ['a:demo/checker']);
  assert.deepEqual(node('s:demo/alpha#beta').opens, ['s:demo/beta']);
  assert.equal(node('a:demo/checker').analysis, 'ok');
  assert.equal(node('s:demo/beta').analysis, 'failed');
  const fb = model.nodes.filter((n) => n.parent === 's:demo/beta');
  assert.deepEqual(fb.map((n) => n.kind), ['start', 'end']);
});

test('a sub-process calling its own unit does not open it again', () => {
  const s = scan(copyFixture('plugin'));
  const units = inventoryAll(s);
  const f = frag('plugin', 'demo__alpha');
  f.nodes.find((n) => n.id === 'beta').target = 'demo:alpha';
  const model = mergeModel(s, { units }, new Map([[f.unit, f]]), { run: 'r1' });
  const self = model.nodes.find((n) => n.id === 's:demo/alpha#beta');
  assert.deepEqual(self.resolved, ['s:demo/alpha']);
  assert.equal(self.opens, undefined);
});

test('loads that do not resolve are listed on the process', () => {
  const s = scan(copyFixture('marketplace'));
  const units = inventoryAll(s);
  const f = frag('marketplace', 'one__start');
  f.nodes.find((n) => n.id === 's1').loads = ['references/gone.md'];
  const model = mergeModel(s, { units }, new Map([[f.unit, f]]), { run: 'r1' });
  assert.deepEqual(model.nodes.find((n) => n.id === 's:one/start#s1').loadsMissing, ['references/gone.md']);
});

test('resolveSkillTarget and resolveAgentTarget rules', () => {
  const s = scan(copyFixture('marketplace'));
  const known = knownSkills(s);
  const unit = s.units[0];
  assert.deepEqual(resolveSkillTarget('/two:finish', unit, known), { id: 's:two/finish' });
  assert.deepEqual(resolveSkillTarget('finish', unit, known), { id: 's:two/finish' });
  assert.deepEqual(resolveSkillTarget('two:nope', unit, known), { missing: true });
  assert.deepEqual(resolveSkillTarget('superpowers:writing-plans', unit, known), { outOfScope: true });
  const p = scan(copyFixture('plugin'));
  const pk = knownSkills(p);
  const alpha = p.units.find((u) => u.id === 'demo/alpha');
  assert.deepEqual(resolveAgentTarget('demo:checker', alpha, pk), { id: 'a:demo/checker' });
  assert.deepEqual(resolveAgentTarget('checker', alpha, pk), { id: 'a:demo/checker' });
  assert.deepEqual(resolveAgentTarget('demo:nobody', alpha, pk), { missing: true });
  assert.deepEqual(resolveAgentTarget('general-purpose', alpha, pk), { outOfScope: true });
  assert.deepEqual(resolveAgentTarget('other:x', alpha, pk), { outOfScope: true });
});

test('fallbackFragment is a start-to-end chain of scripts and calls in text order', () => {
  const s = scan(copyFixture('broken'));
  const units = inventoryAll(s);
  const unit = s.units[0];
  const f = fallbackFragment(unit, units[unit.id], s.containers.find((c) => c.id === unit.skillNode).source);
  assert.equal(f.nodes[0].kind, 'start');
  assert.equal(f.nodes.at(-1).kind, 'end');
  assert.deepEqual(f.edges.map((e) => [e.from, e.to]), f.nodes.slice(1).map((n, i) => [f.nodes[i].id, n.id]));
  assert.equal(f.nodes.some((n) => /ghost/.test(n.label)), false);
  assert.ok(f.nodes.some((n) => n.kind === 'process' && n.command === 'scripts/gone.mjs'));
  assert.ok(f.nodes.some((n) => n.kind === 'subprocess' && n.calls === 'skill' && /phantom/.test(n.target)));
  assert.deepEqual([f.nodes[0].origin, f.nodes.at(-1).origin], ['inferred', 'inferred']);
  const v = validateFragment(s.root, unit.id, f, units[unit.id]);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('merge command builds model.json from saved units and reports failures', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  for (const [unit, name] of [['demo/alpha', 'demo__alpha'], ['demo/agent-checker', 'demo__agent-checker']]) {
    const body = fs.readFileSync(path.join(FIXTURES, 'fragments', 'plugin', `${name}.json`), 'utf8');
    assert.equal(runSi(['save-unit', '--root', root, '--unit', unit], { input: body }).json.ok, true);
  }
  const r = runSi(['merge', '--root', root]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.failed, ['s:demo/beta']);
  assert.deepEqual(r.json.missing, []);
  const run = JSON.parse(fs.readFileSync(path.join(root, '.schem-it', 'latest.json'))).run;
  const modelFile = path.join(root, '.schem-it', run, 'model.json');
  assert.equal(JSON.parse(fs.readFileSync(modelFile, 'utf8')).version, 3);
  fs.writeFileSync(modelFile, JSON.stringify({ version: 1, nodes: [], edges: [] }));
  assert.match(runSi(['render', '--root', root]).stderr, /older schem-it; analyse again/);
});

const W = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
};
const src = { file: 'x.md', lines: [1, 1], quote: 'quote' };
const sub = (id, target, extra = {}) => ({ id, kind: 'subprocess', label: id, role: 'r', target, calls: 'agent', origin: 'inferred', source: src, ...extra });
const step = (id) => ({ id, kind: 'process', label: id, role: 'r', origin: 'inferred', source: src });
const store = (id, p) => ({ id, kind: 'storage', label: p, role: 'r', path: p, holds: 'h', origin: 'inferred', source: src });
const fragOf = (unit, mid, files = [], links = []) => ({
  unit,
  nodes: [{ id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: src }, ...mid, ...files, { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: src }],
  edges: [{ from: 'start', to: mid[0].id, kind: 'flow', source: src }, { from: mid[0].id, to: 'end', kind: 'flow', source: src }, ...links.map(([from, to, kind]) => ({ from, to, kind, label: 'x', source: src }))],
});
const SK = (name, body = 'Do things.') => `---\nname: ${name}\ndescription: d\n---\n\n${body}\n`;

test('a sub-process with targets opens every analysed unit it lists; out of scope only when all are', () => {
  const root = W(path.join(tmpDir(), 'p'), {
    '.claude-plugin/plugin.json': '{"name":"demo"}',
    'skills/alpha/SKILL.md': SK('alpha'),
    'agents/one.md': SK('one', 'You do one.'),
    'agents/two.md': SK('two', 'You do two.'),
  });
  const s = scan(root);
  const run = (targets, target = 'lens analyst subagents') => mergeModel(s, { units: {} }, new Map([['demo/alpha', fragOf('demo/alpha', [sub('g', target, targets ? { targets, parallel: true } : {})])]]), { run: 'r1' }).nodes.find((n) => n.id === 's:demo/alpha#g');
  const group = run(['demo:one', 'two']);
  assert.deepEqual(group.opens, ['a:demo/one', 'a:demo/two']);
  assert.deepEqual(group.resolved, ['a:demo/one', 'a:demo/two']);
  assert.equal(group.missing, false);
  const mixed = run(['demo:one', 'general-purpose']);
  assert.deepEqual(mixed.opens, ['a:demo/one']);
  assert.equal(mixed.outOfScope, undefined);
  assert.equal(run(['demo:one', 'demo:nobody']).missing, true);
  const outside = run(['general-purpose', 'Explore']);
  assert.equal(outside.outOfScope, true);
  assert.equal(outside.opens, undefined);
  const named = run(undefined, 'lens analyst subagents');
  assert.equal(named.unresolved, true);
  assert.equal(named.outOfScope, undefined);
  assert.equal(named.opens, undefined);
  assert.equal(run(undefined, 'general-purpose').outOfScope, true);
});

test('a description with spaces is unresolved, not out of scope', () => {
  const p = scan(copyFixture('plugin'));
  const pk = knownSkills(p);
  const alpha = p.units.find((u) => u.id === 'demo/alpha');
  assert.deepEqual(resolveAgentTarget('lens analyst subagents', alpha, pk), { unresolved: true });
  assert.deepEqual(resolveSkillTarget('the helper skill', alpha, pk), { unresolved: true });
});

test('files that share a bare name are linked only across a folder path or a call', () => {
  const mk = (alphaPath, betaPath, calls) => {
    const root = W(path.join(tmpDir(), 'p'), {
      '.claude-plugin/plugin.json': '{"name":"demo"}',
      'skills/alpha/SKILL.md': SK('alpha'),
      'skills/beta/SKILL.md': SK('beta'),
    });
    const s = scan(root);
    const a = fragOf('demo/alpha', [calls ? sub('c', 'demo:beta', { calls: 'skill' }) : step('p')], [store('f', alphaPath)], [[calls ? 'c' : 'p', 'f', 'writes']]);
    const b = fragOf('demo/beta', [step('p')], [store('f', betaPath)], [['f', 'p', 'reads']]);
    const model = mergeModel(s, { units: {} }, new Map([['demo/alpha', a], ['demo/beta', b]]), { run: 'r1' });
    return (id) => model.nodes.find((n) => n.id === id).usage.map((u) => u.unit);
  };
  const apart = mk('notes.md', './notes.md', false);
  assert.deepEqual(apart('s:demo/alpha#f'), ['s:demo/alpha']);
  assert.deepEqual(apart('s:demo/beta#f'), ['s:demo/beta']);
  const folder = mk('out/notes.md', './out/notes.md', false);
  assert.deepEqual(folder('s:demo/alpha#f'), ['s:demo/alpha', 's:demo/beta']);
  const called = mk('notes.md', 'notes.md', true);
  assert.deepEqual(called('s:demo/alpha#f'), ['s:demo/alpha', 's:demo/beta']);
  assert.deepEqual(called('s:demo/beta#f'), ['s:demo/alpha', 's:demo/beta']);
});

test('merge command lists unresolved and missing sub-processes', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const f = frag('plugin', 'demo__alpha');
  f.nodes.find((n) => n.id === 'chk').target = 'lens analyst subagents';
  f.nodes.find((n) => n.id === 'beta').target = 'demo:nobody';
  assert.equal(runSi(['save-unit', '--root', root, '--unit', 'demo/alpha'], { input: JSON.stringify(f) }).json.ok, true);
  const r = runSi(['merge', '--root', root]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.unresolved, [{ id: 's:demo/alpha#chk', label: 'Check each file' }]);
  assert.deepEqual(r.json.missing, [{ id: 's:demo/alpha#beta', label: 'Write the report' }]);
});

test('shortCommand drops the skill-folder placeholder and its quotes so the subcommand stays visible', async () => {
  const { shortCommand } = await import('../../skills/schem-it/scripts/lib/merge.mjs');
  assert.equal(shortCommand('node "<SKILL_DIR>/scripts/ph.mjs" context --area x'), 'node scripts/ph.mjs context --area x');
  assert.equal(shortCommand('node ${CLAUDE_SKILL_DIR}/scripts/si.mjs scan'), 'node scripts/si.mjs scan');
  assert.equal(shortCommand("python '${CLAUDE_PLUGIN_ROOT}/tools/a b.py'"), "python 'tools/a b.py'");
  assert.equal(shortCommand('node scripts/build.mjs collect'), 'node scripts/build.mjs collect');
});
