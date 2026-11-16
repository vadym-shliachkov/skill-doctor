import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { makeResolver } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { discoverUnits, parseCommand, MAX_ROUND, SWEEP_LIMIT } from '../../skills/schem-it/scripts/lib/discover.mjs';
import { copyFixture } from '../helpers.mjs';

const SK = 'skills/flow/SKILL.md';
const node = (parent, id, extra = {}) => ({ id: `${parent}#${id}`, parent, kind: 'process', label: id, source: { file: SK, lines: [6, 6], quote: 'Run' }, ...extra });
const round1 = () => ({ nodes: [node('s:pipe/flow', 'a', { command: 'node scripts/entry.mjs go' }), node('s:pipe/flow', 'b', { command: 'python scripts/loop.py' })] });
const round2 = () => ({ nodes: [
  ...round1().nodes,
  node('x:pipe/flow/run-entry-go', 'c', { command: 'node tools/child.mjs' }),
  node('x:pipe/flow/run-entry-go', 'g', { command: 'node scripts/entry.mjs go' }),
  node('x:pipe/flow/run-loop', 'd', { kind: 'subprocess', calls: 'function', target: 'run_eval.py#run_eval' }),
  node('x:pipe/flow/run-loop', 'e', { kind: 'subprocess', calls: 'command', target: 'claude -p' }),
  node('x:pipe/flow/run-loop', 'f', { kind: 'subprocess', calls: 'function', target: 'run_eval.py#nope' }),
] });

test('rounds: script charts add the scripts they run and the stages they call; ids stay stable; a script running itself adds nothing', () => {
  const s = scan(copyFixture('pipeline'));
  const r1 = discoverUnits(s, round1());
  assert.deepEqual(r1.units.map((u) => u.id), ['pipe/flow/run-entry-go', 'pipe/flow/run-loop']);
  assert.equal(r1.round, 2);
  const r2 = discoverUnits(r1.scan, round2());
  assert.deepEqual(r2.units.map((u) => u.id), ['pipe/flow/run-child', 'pipe/flow/fn-run_eval-run_eval']);
  assert.equal(r2.round, 3);
  const stage = r2.units[1];
  assert.deepEqual({ script: stage.script, symbol: stage.symbol, subcommand: stage.subcommand, name: stage.name },
    { script: 'skills/flow/scripts/run_eval.py', symbol: 'run_eval', subcommand: null, name: 'run_eval.py › run_eval' });
  assert.equal(r2.scan.containers.find((c) => c.id === 'x:pipe/flow/fn-run_eval-run_eval').label, 'run_eval.py › run_eval');
  assert.deepEqual(r2.units[0].callers.map((c) => c.node), ['x:pipe/flow/run-entry-go#c']);
  const entry = r2.scan.units.find((u) => u.id === 'pipe/flow/run-entry-go');
  assert.deepEqual(entry.callers.map((c) => c.node), ['s:pipe/flow#a']);
  assert.deepEqual(r2.skipped, [{ command: 'run_eval.py#nope', reason: 'skills/flow/scripts/run_eval.py does not define nope' }]);
});

test('when nothing new is called, the sweep adds entry scripts nothing runs, once; then discover returns nothing', () => {
  const s = scan(copyFixture('pipeline'));
  const r2 = discoverUnits(discoverUnits(s, round1()).scan, round2());
  const r3 = discoverUnits(r2.scan, round2());
  assert.deepEqual(r3.units.map((u) => u.id), ['pipe/flow/run-cli']);
  assert.equal(r3.scan.sweepDone, true);
  assert.equal(r3.units[0].sweep, true);
  const box = r3.scan.containers.find((c) => c.id === 'x:pipe/flow/run-cli');
  assert.equal(box.description, 'Not run by any analysed text or script.');
  assert.equal(box.sweep, true);
  assert.equal(r3.round, 4);
  const r4 = discoverUnits(r3.scan, round2());
  assert.deepEqual(r4.units, []);
  assert.equal(r4.round, 4);
  assert.equal(r4.scan.units.length, r3.scan.units.length);
});

test(`discover stops after round ${MAX_ROUND} and lists what it left undrawn`, () => {
  const s = scan(copyFixture('pipeline'));
  const r1 = discoverUnits(s, round1());
  const capped = discoverUnits({ ...r1.scan, round: MAX_ROUND }, round2());
  assert.equal(capped.capped, true);
  assert.deepEqual(capped.units, []);
  assert.deepEqual(capped.left.map((l) => [l.kind, l.target]), [['command', 'child.mjs'], ['stage', 'skills/flow/scripts/run_eval.py#run_eval']]);
  assert.equal(capped.scan.units.some((u) => u.id === 'pipe/flow/run-child'), false);
  assert.equal(capped.scan.units.some((u) => u.id === 'pipe/flow/run-entry-go'), true);
});

test('python -m module and any leading <placeholder>/ path are recognised', () => {
  const resolve = (p) => (p === 'scripts/run_loop.py' ? 'skills/a/scripts/run_loop.py' : null);
  assert.deepEqual(parseCommand('python -m scripts.run_loop --iterations 3', resolve), { script: 'scripts.run_loop', file: 'skills/a/scripts/run_loop.py', subcommand: null });
  const s = scan(copyFixture('pipeline'));
  const flow = makeResolver(s.root, s.units.find((u) => u.id === 'pipe/flow'));
  assert.equal(flow('<skill-creator-path>/scripts/cli.py'), 'skills/flow/scripts/cli.py');
});

import { mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';

const at = (file, line) => ({ file, lines: [line, line], quote: 'x' });
const flow = (unit, file, mid) => {
  const ends = [{ id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: at(file, 1) }, { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: at(file, 1) }];
  const ids = ['start', ...mid.map((n) => n.id), 'end'];
  return { unit, nodes: [ends[0], ...mid, ends[1]], edges: ids.slice(1).map((to, i) => ({ from: ids[i], to, kind: 'flow', source: at(file, 1) })) };
};

test('a function call opens its stage chart; an undefined function is missing; a stage and a whole-script command in one file stay apart', () => {
  const s = scan(copyFixture('pipeline'));
  const LOOP = 'skills/flow/scripts/loop.py';
  const frags = new Map([['pipe/flow', flow('pipe/flow', SK, [
    { id: 'loop', kind: 'process', label: 'Loop', role: 'r', command: 'python scripts/loop.py', origin: 'inferred', source: at(SK, 7) },
    { id: 'eval', kind: 'process', label: 'Eval directly', role: 'r', command: 'python scripts/run_eval.py', origin: 'inferred', source: at(SK, 7) },
  ])]]);
  const d1 = discoverUnits(s, mergeModel(s, { units: {} }, frags, { run: 'r1' }));
  frags.set('pipe/flow/run-loop', flow('pipe/flow/run-loop', LOOP, [
    { id: 'st', kind: 'subprocess', label: 'Run eval', role: 'r', calls: 'function', target: 'run_eval.py#run_eval', origin: 'inferred', source: at(LOOP, 7) },
    { id: 'bad', kind: 'subprocess', label: 'Nope', role: 'r', calls: 'function', target: 'run_eval.py#nope', origin: 'inferred', source: at(LOOP, 7) },
  ]));
  const d2 = discoverUnits(d1.scan, mergeModel(d1.scan, { units: {} }, frags, { run: 'r1' }));
  const m = mergeModel(d2.scan, { units: {} }, frags, { run: 'r1' });
  const n = (id) => m.nodes.find((x) => x.id === id);
  assert.deepEqual(n('x:pipe/flow/run-loop#st').opens, ['x:pipe/flow/fn-run_eval-run_eval']);
  assert.equal(n('x:pipe/flow/run-loop#bad').missing, true);
  assert.equal(n('x:pipe/flow/run-loop#bad').opens, undefined);
  assert.deepEqual(n('s:pipe/flow#eval').opens, ['x:pipe/flow/run-run_eval']);
});

import fs from 'node:fs';
import path from 'node:path';
import { buildContext } from '../../skills/schem-it/scripts/lib/context.mjs';
import { scanCode } from '../../skills/schem-it/scripts/lib/codescan.mjs';
import { runSi } from '../helpers.mjs';

test('context: a stage says which function it is and lists the calls found in its code; a sweep unit says nothing runs it', () => {
  const s = scan(copyFixture('pipeline'));
  const r3 = discoverUnits(discoverUnits(discoverUnits(s, round1()).scan, round2()).scan, round2());
  const stage = r3.scan.units.find((u) => u.id === 'pipe/flow/fn-run_eval-run_eval');
  const text = buildContext({ root: s.root, run: 'r1', unit: stage, inventory: { facts: [] }, units: r3.scan.units, hints: scanCode(s.root, stage.file), save: false, siPath: 'si.mjs' });
  assert.match(text, /the function `run_eval` in `skills\/flow\/scripts\/run_eval\.py`/);
  assert.match(text, /## Calls found in the code/);
  assert.match(text, /\| `skills\/flow\/scripts\/run_eval\.py:5` \| child \| cli\.py \|/);
  const cli = r3.scan.units.find((u) => u.id === 'pipe/flow/run-cli');
  assert.match(buildContext({ root: s.root, run: 'r1', unit: cli, inventory: { facts: [] }, units: r3.scan.units, hints: [], save: false, siPath: 'si.mjs' }), /No analysed text or script runs it/);
});

test('si context passes the code hints to a script analyst', () => {
  const root = copyFixture('pipeline');
  const run = runSi(['scan', '--root', root]).json.run;
  runSi(['inventory', '--root', root, '--run', run]);
  fs.writeFileSync(path.join(root, '.schem-it', run, 'model.json'), JSON.stringify(round1()));
  assert.deepEqual(runSi(['discover', '--root', root, '--run', run]).json.units, ['pipe/flow/run-entry-go', 'pipe/flow/run-loop']);
  const c = runSi(['context', '--root', root, '--run', run, '--unit', 'pipe/flow/run-loop']);
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stdout, /## Calls found in the code/);
  assert.match(c.stdout, /run_eval from skills\/flow\/scripts\/run_eval\.py/);
});

test('analyst instructions cover stages, scripts that run scripts and AI calls', () => {
  const analyst = fs.readFileSync(new URL('../../skills/schem-it/agents/analyst.md', import.meta.url), 'utf8');
  for (const re of [/"calls": "function"/, /<path>#<function>/, /about 10 steps/, /AI call/]) assert.match(analyst, re);
});

import { buildViews } from '../../skills/schem-it/scripts/lib/views.mjs';

test('the plugin index lists commands, stages and unreferenced scripts under Scripts', () => {
  const s = scan(copyFixture('pipeline'));
  const r3 = discoverUnits(discoverUnits(discoverUnits(s, round1()).scan, round2()).scan, round2());
  const index = buildViews(mergeModel(r3.scan, { units: {} }, new Map(), { run: 'r1' })).find((v) => v.id === 'p:pipe');
  const scripts = index.groups.find((g) => g.title === 'Scripts');
  assert.deepEqual(scripts.items, ['x:pipe/flow/run-entry-go', 'x:pipe/flow/run-loop', 'x:pipe/flow/run-child', 'x:pipe/flow/fn-run_eval-run_eval', 'x:pipe/flow/run-cli']);
});

test('a chart that runs its own script is not its caller; a sweep unit keeps its mark', () => {
  const s = scan(copyFixture('pipeline'));
  const r3 = discoverUnits(discoverUnits(discoverUnits(s, round1()).scan, round2()).scan, round2());
  const self = { nodes: [...round2().nodes, node('x:pipe/flow/run-cli', 'h', { command: 'python scripts/cli.py' })] };
  const r4 = discoverUnits(r3.scan, self);
  const cli = r4.scan.units.find((u) => u.id === 'pipe/flow/run-cli');
  assert.equal(cli.sweep, true);
  assert.deepEqual(cli.callers, []);
  assert.equal(r4.scan.containers.find((c) => c.id === 'x:pipe/flow/run-cli').description, 'Not run by any analysed text or script.');
});

test('two scripts that run each other add no units and no rounds', () => {
  const s = scan(copyFixture('pipeline'));
  const r2 = discoverUnits(discoverUnits(s, round1()).scan, round2());
  const loop = { nodes: [...round2().nodes, node('x:pipe/flow/run-child', 'k', { command: 'node scripts/entry.mjs go' })] };
  const r3 = discoverUnits(r2.scan, loop);
  assert.deepEqual(r3.units.map((u) => u.id), ['pipe/flow/run-cli']);
  const r4 = discoverUnits(r3.scan, loop);
  assert.deepEqual(r4.units, []);
  assert.equal(r4.round, r3.round);
});

test('the sweep adds at most SWEEP_LIMIT scripts and lists the rest in left', () => {
  const root = copyFixture('pipeline');
  for (let i = 0; i < SWEEP_LIMIT + 3; i++) fs.writeFileSync(path.join(root, 'skills/flow/scripts', `tool${String(i).padStart(2, '0')}.py`), "if __name__ == '__main__':\n    pass\n");
  const s = scan(root);
  const r2 = discoverUnits(discoverUnits(s, round1()).scan, round2());
  const r3 = discoverUnits(r2.scan, round2());
  assert.equal(r3.units.length, SWEEP_LIMIT);
  assert.ok(r3.units.every((u) => u.sweep));
  assert.equal(r3.left.length, 4);
  assert.ok(r3.left.every((l) => l.kind === 'sweep'));
  assert.equal(discoverUnits(r3.scan, round2()).units.length, 0);
});

test('a stage in a nested script resolves a path written from a folder above it (lib/x.mjs#f inside scripts/lib/x.mjs)', () => {
  const root = copyFixture('pipeline');
  const UTIL = 'skills/flow/scripts/lib/util.mjs';
  fs.mkdirSync(path.join(root, 'skills/flow/scripts/lib'));
  fs.writeFileSync(path.join(root, UTIL), 'export function helper() {\n  return other();\n}\nexport function other() {\n  return 1;\n}\n');
  const s = scan(root);
  const ENTRY = 'skills/flow/scripts/entry.mjs';
  const frags = new Map([['pipe/flow', flow('pipe/flow', SK, [
    { id: 'go', kind: 'process', label: 'Go', role: 'r', command: 'node scripts/entry.mjs go', origin: 'inferred', source: at(SK, 7) },
  ])]]);
  const d1 = discoverUnits(s, mergeModel(s, { units: {} }, frags, { run: 'r1' }));
  frags.set('pipe/flow/run-entry-go', flow('pipe/flow/run-entry-go', ENTRY, [
    { id: 'h', kind: 'subprocess', label: 'Help', role: 'r', calls: 'function', target: 'lib/util.mjs#helper', origin: 'inferred', source: at(ENTRY, 5) },
  ]));
  const d2 = discoverUnits(d1.scan, mergeModel(d1.scan, { units: {} }, frags, { run: 'r1' }));
  assert.deepEqual(d2.units.map((u) => u.id), ['pipe/flow/fn-util-helper']);
  frags.set('pipe/flow/fn-util-helper', flow('pipe/flow/fn-util-helper', UTIL, [
    { id: 'o', kind: 'subprocess', label: 'Other', role: 'r', calls: 'function', target: 'lib/util.mjs#other', origin: 'inferred', source: at(UTIL, 2) },
  ]));
  const d3 = discoverUnits(d2.scan, mergeModel(d2.scan, { units: {} }, frags, { run: 'r1' }));
  assert.deepEqual(d3.units.map((u) => u.id), ['pipe/flow/fn-util-other']);
  assert.deepEqual(d3.skipped, []);
  const m = mergeModel(d3.scan, { units: {} }, frags, { run: 'r1' });
  const o = m.nodes.find((x) => x.id === 'x:pipe/flow/fn-util-helper#o');
  assert.deepEqual(o.opens, ['x:pipe/flow/fn-util-other']);
  assert.notEqual(o.missing, true);
});

test('a stage that names a table of functions (COMMANDS[name]) is neither drawn nor missing', () => {
  const root = copyFixture('pipeline');
  const IDX = 'skills/flow/scripts/index.mjs';
  fs.writeFileSync(path.join(root, IDX), 'export const COMMANDS = {};\nCOMMANDS.go = () => 1;\n');
  const s = scan(root);
  const ENTRY = 'skills/flow/scripts/entry.mjs';
  const frags = new Map([['pipe/flow', flow('pipe/flow', SK, [
    { id: 'go', kind: 'process', label: 'Go', role: 'r', command: 'node scripts/entry.mjs go', origin: 'inferred', source: at(SK, 7) },
  ])]]);
  const d1 = discoverUnits(s, mergeModel(s, { units: {} }, frags, { run: 'r1' }));
  frags.set('pipe/flow/run-entry-go', flow('pipe/flow/run-entry-go', ENTRY, [
    { id: 'run', kind: 'subprocess', label: 'Run the command', role: 'r', calls: 'function', target: './index.mjs#COMMANDS', origin: 'inferred', source: at(ENTRY, 1) },
  ]));
  const d2 = discoverUnits(d1.scan, mergeModel(d1.scan, { units: {} }, frags, { run: 'r1' }));
  assert.deepEqual(d2.units.filter((u) => u.symbol), []);
  assert.match(d2.skipped[0].reason, /COMMANDS in skills\/flow\/scripts\/index\.mjs is a value, not a function/);
  const run = mergeModel(d2.scan, { units: {} }, frags, { run: 'r1' }).nodes.find((x) => x.id === 'x:pipe/flow/run-entry-go#run');
  assert.notEqual(run.missing, true);
  assert.equal(run.opens, undefined);
});

test('a stage path copied from an import (../lib/x.mjs#f) resolves from the file the block cites, not the script\'s folder', () => {
  const root = copyFixture('pipeline');
  const UTIL = 'skills/flow/scripts/lib/util.mjs';
  const CMD = 'skills/flow/scripts/commands/cmd.mjs';
  fs.mkdirSync(path.join(root, 'skills/flow/scripts/lib'));
  fs.mkdirSync(path.join(root, 'skills/flow/scripts/commands'));
  fs.writeFileSync(path.join(root, UTIL), 'export function helper() {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(root, CMD), "import { helper } from '../lib/util.mjs';\nexport function go() {\n  return helper();\n}\n");
  const s = scan(root);
  const frags = new Map([['pipe/flow', flow('pipe/flow', SK, [
    { id: 'go', kind: 'process', label: 'Go', role: 'r', command: 'node scripts/entry.mjs go', origin: 'inferred', source: at(SK, 7) },
  ])]]);
  const d1 = discoverUnits(s, mergeModel(s, { units: {} }, frags, { run: 'r1' }));
  frags.set('pipe/flow/run-entry-go', flow('pipe/flow/run-entry-go', 'skills/flow/scripts/entry.mjs', [
    { id: 'h', kind: 'subprocess', label: 'Help', role: 'r', calls: 'function', target: '../lib/util.mjs#helper', origin: 'inferred', source: at(CMD, 3) },
  ]));
  const d2 = discoverUnits(d1.scan, mergeModel(d1.scan, { units: {} }, frags, { run: 'r1' }));
  assert.deepEqual(d2.units.map((u) => u.id), ['pipe/flow/fn-util-helper']);
  assert.deepEqual(d2.skipped, []);
  const h = mergeModel(d2.scan, { units: {} }, frags, { run: 'r1' }).nodes.find((x) => x.id === 'x:pipe/flow/run-entry-go#h');
  assert.deepEqual(h.opens, ['x:pipe/flow/fn-util-helper']);
  assert.notEqual(h.missing, true);
});

test('a defined stage without a chart is not missing; an outside program is out of scope, not unresolved', () => {
  const s = scan(copyFixture('pipeline'));
  const d1 = discoverUnits(s, round1());
  const LOOP = 'skills/flow/scripts/loop.py';
  const frags = new Map([['pipe/flow/run-loop', flow('pipe/flow/run-loop', LOOP, [
    { id: 'st', kind: 'subprocess', label: 'Run eval', role: 'r', calls: 'function', target: 'run_eval.py#run_eval', origin: 'inferred', source: at(LOOP, 7) },
    { id: 'ai', kind: 'subprocess', label: 'Ask Claude', role: 'r', calls: 'command', target: 'claude -p --output-format text', origin: 'inferred', source: at(LOOP, 8) },
  ])]]);
  const m = mergeModel(d1.scan, { units: {} }, frags, { run: 'r1' });
  const n = (id) => m.nodes.find((x) => x.id === id);
  assert.equal(n('x:pipe/flow/run-loop#st').missing, false);
  assert.equal(n('x:pipe/flow/run-loop#st').opens, undefined);
  assert.equal(n('x:pipe/flow/run-loop#ai').unresolved, undefined);
  assert.equal(n('x:pipe/flow/run-loop#ai').outOfScope, true);
});
