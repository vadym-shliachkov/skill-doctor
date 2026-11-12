import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { tokenize, parseCommand, discoverUnits } from '../../skills/schem-it/scripts/lib/discover.mjs';
import { copyFixture, runSi } from '../helpers.mjs';

const SKILL = 'skills/audit/SKILL.md';
const step = (id, command, parent = 's:deep/audit') => ({ id: `${parent}#${id}`, parent, kind: 'process', label: id, command, source: { file: SKILL, lines: [10, 10], quote: 'T collect' } });
const firstRound = () => ({
  version: 3,
  nodes: [
    step('c1', 'node scripts/tool.mjs collect --root <ROOT>'),
    step('c2', 'node scripts/tool.mjs collect'),
    step('m', 'node "scripts/tool.mjs" merge'),
    step('ctx', 'node scripts/tool.mjs context --area <area>', 'a:deep/runner'),
    step('git', 'git log -1'),
    step('py', 'python scripts/report.py'),
    step('lh', 'npx lighthouse https://example.com'),
  ],
  edges: [],
});

test('tokenize keeps quoted paths with spaces together', () => {
  assert.deepEqual(tokenize('node "scripts/my tool.mjs" run --x \'a b\''), ['node', 'scripts/my tool.mjs', 'run', '--x', 'a b']);
});

test('parseCommand finds interpreter, script and subcommand', () => {
  const resolve = (p) => (p.startsWith('scripts/') ? `skills/a/${p}` : null);
  assert.deepEqual(parseCommand('node scripts/tool.mjs collect --root x', resolve), { script: 'scripts/tool.mjs', file: 'skills/a/scripts/tool.mjs', subcommand: 'collect' });
  assert.deepEqual(parseCommand('NODE_ENV=test node --no-warnings scripts/tool.mjs', resolve), { script: 'scripts/tool.mjs', file: 'skills/a/scripts/tool.mjs', subcommand: null });
  assert.deepEqual(parseCommand('node "scripts/my tool.mjs" run', resolve), { script: 'scripts/my tool.mjs', file: 'skills/a/scripts/my tool.mjs', subcommand: 'run' });
  assert.deepEqual(parseCommand('node scripts\\tool.mjs collect', resolve), { script: 'scripts\\tool.mjs', file: 'skills/a/scripts/tool.mjs', subcommand: 'collect' });
  assert.deepEqual(parseCommand('python3 scripts/kb.py query --card "<card>"', resolve), { script: 'scripts/kb.py', file: 'skills/a/scripts/kb.py', subcommand: 'query' });
  assert.deepEqual(parseCommand('bash scripts/run.sh <stage>', resolve), { script: 'scripts/run.sh', file: 'skills/a/scripts/run.sh', subcommand: null });
  assert.deepEqual(parseCommand('deno run scripts/x.ts go', resolve), { script: 'scripts/x.ts', file: 'skills/a/scripts/x.ts', subcommand: 'go' });
  assert.deepEqual(parseCommand('./build.sh --strict', () => null), { script: './build.sh', file: null, subcommand: null });
  assert.equal(parseCommand('git log -1', resolve), null);
  assert.equal(parseCommand('npx lighthouse https://x', resolve), null);
  assert.equal(parseCommand('python -m http.server', resolve), null);
});

test('discoverUnits makes one unit per script and subcommand, owned by the skill that holds the script', () => {
  const s = scan(copyFixture('deep'));
  const res = discoverUnits(s, firstRound());
  assert.deepEqual(res.units.map((u) => u.id), ['deep/audit/run-tool-collect', 'deep/audit/run-tool-merge', 'deep/audit/run-tool-context']);
  const collect = res.units[0];
  assert.deepEqual({ kind: collect.kind, skillNode: collect.skillNode, script: collect.script, subcommand: collect.subcommand, dir: collect.dir, skillDir: collect.skillDir, file: collect.file, wave: collect.wave },
    { kind: 'script', skillNode: 'x:deep/audit/run-tool-collect', script: 'skills/audit/scripts/tool.mjs', subcommand: 'collect', dir: 'skills/audit/scripts', skillDir: 'skills/audit', file: 'skills/audit/scripts/tool.mjs', wave: 2 });
  assert.deepEqual(collect.callers.map((c) => c.node), ['s:deep/audit#c1', 's:deep/audit#c2']);
  assert.deepEqual(res.units[2].callers.map((c) => c.unit), ['deep/agent-runner']);
  const node = res.scan.containers.find((c) => c.id === 'x:deep/audit/run-tool-collect');
  assert.equal(node.kind, 'script-command');
  assert.equal(node.parent, 's:deep/audit');
  assert.equal(node.label, 'tool.mjs collect');
  assert.deepEqual(res.skipped, [{ command: 'python scripts/report.py', reason: 'scripts/report.py is not a file in the analysed folder' }]);
});

test('discoverUnits is idempotent: a second run on its own output gives the same units', () => {
  const s = scan(copyFixture('deep'));
  const once = discoverUnits(s, firstRound());
  const twice = discoverUnits(once.scan, firstRound());
  assert.deepEqual(twice.units, []);
  assert.equal(twice.scan.units.length, once.scan.units.length);
  assert.equal(twice.scan.containers.length, once.scan.containers.length);
});

test('si discover appends the units to scan.json and inventory.json, and drops stale ones on a rerun', () => {
  const root = copyFixture('deep');
  const run = runSi(['scan', '--root', root]).json.run;
  runSi(['inventory', '--root', root, '--run', run]);
  const dir = path.join(root, '.schem-it', run);
  fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(firstRound()));
  const r = runSi(['discover', '--root', root, '--run', run]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.units, ['deep/audit/run-tool-collect', 'deep/audit/run-tool-merge', 'deep/audit/run-tool-context']);
  const inv = JSON.parse(fs.readFileSync(path.join(dir, 'inventory.json'), 'utf8'));
  assert.ok(inv.units['deep/audit/run-tool-collect']);
  const model = firstRound();
  model.nodes = model.nodes.filter((n) => !n.id.endsWith('#m'));
  fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(model));
  const again = runSi(['discover', '--root', root, '--run', run]);
  assert.deepEqual(again.json.units, []);
  const inv2 = JSON.parse(fs.readFileSync(path.join(dir, 'inventory.json'), 'utf8'));
  assert.equal(inv2.units['deep/audit/run-tool-merge'], undefined);
  const scanned = JSON.parse(fs.readFileSync(path.join(dir, 'scan.json'), 'utf8'));
  assert.equal(scanned.units.filter((u) => u.kind === 'script').length, 2);
});

test('si discover without a first-round model explains what to run first', () => {
  const root = copyFixture('deep');
  const run = runSi(['scan', '--root', root]).json.run;
  const r = runSi(['discover', '--root', root, '--run', run]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /run "si merge" after the first analysis round/);
});

test('a sub-process that runs a command (an agent fetching its instructions) is discovered too', () => {
  const s = scan(copyFixture('deep'));
  const model = { nodes: [{ ...step('fetch', 'node scripts/tool.mjs context', 'a:deep/runner'), kind: 'subprocess' }] };
  assert.deepEqual(discoverUnits(s, model).units.map((u) => u.id), ['deep/audit/run-tool-context']);
});

test('a command or schema outside the analysed folder is not resolved', async () => {
  const { makeResolver } = await import('../../skills/schem-it/scripts/lib/inventory.mjs');
  const root = copyFixture('deep');
  fs.writeFileSync(path.join(root, '..', 'outside.mjs'), 'export {}\n');
  const s = scan(root);
  const res = discoverUnits(s, { nodes: [step('out', 'node ../../../outside.mjs run')] });
  assert.deepEqual(res.units, []);
  assert.equal(res.skipped.length, 1);
  assert.equal(makeResolver(s.root, s.units[0])('../../../outside.mjs'), null);
});

test('a sub-process that calls a command names it in its target (calls: "command", target "tool.mjs context")', () => {
  const s = scan(copyFixture('deep'));
  const node = { ...step('fetch', undefined, 'a:deep/runner'), kind: 'subprocess', calls: 'command', target: 'tool.mjs context' };
  delete node.command;
  assert.deepEqual(discoverUnits(s, { nodes: [node] }).units.map((u) => u.id), ['deep/audit/run-tool-context']);
});
