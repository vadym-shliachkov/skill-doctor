import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detect } from '../../skills/schem-it/scripts/lib/detect.mjs';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll, knownSkills, makeResolver } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { buildViews } from '../../skills/schem-it/scripts/lib/views.mjs';
import { copyFixture, runSi } from '../helpers.mjs';

test('a project with .claude/ is a plugin rooted at the project', () => {
  const d = detect(copyFixture('claude-project'));
  assert.equal(d.level, 'plugin');
  assert.equal(d.name, 'claude-project');
  assert.match(d.plugins[0].dir, /claude-project\/\.claude$/);
});

test('a command with a workflow is a unit; a short wrapper stays a box', () => {
  const r = scan(copyFixture('claude-project'));
  assert.deepEqual(r.units, [{
    id: 'claude-project/report', kind: 'command', skillNode: 'c:claude-project/report', plugin: 'claude-project', name: '/report',
    dir: '.claude/commands', file: '.claude/commands/report.md', pluginDir: '.claude',
  }, {
    id: 'claude-project/agent-reviewer', kind: 'agent', skillNode: 'a:claude-project/reviewer', plugin: 'claude-project', name: 'reviewer',
    dir: '.claude/agents', file: '.claude/agents/reviewer.md', pluginDir: '.claude',
  }]);
  assert.equal(r.containers.some((c) => c.id === 'a:claude-project/readme'), false);
  assert.equal(r.containers.find((c) => c.id === 'c:claude-project/quick').wrapper, true);
  assert.deepEqual(r.warnings, ['Command /quick not analysed: 1 line and no numbered steps, so it is drawn as a box that hands over to what it names']);
  const only = scan(copyFixture('claude-project'), { only: 'nomatch' });
  assert.equal(only.containers.find((c) => c.id === 'c:claude-project/report').analysis, 'skipped');
  // A command --only leaves out is not reported as short.
  assert.equal(only.warnings.some((w) => w.includes('/quick')), false);
});

test('a short command with numbered steps is a unit; its warning names a short one with steps too few', () => {
  const root = copyFixture('claude-project');
  fs.writeFileSync(path.join(root, '.claude/commands/tidy.md'), [
    '---', 'description: Tidy notes.', '---', '', 'Tidy the notes folder.', '',
    '1. List every note.', '2. For each pair with the same title, start the `reviewer` agent.', '3. Ask the user which one to keep; delete the other after they confirm.', '4. Tell the user what changed.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, '.claude/commands/two.md'), '---\ndescription: Two steps.\n---\n\n1. Run /report.\n2. Tell the user.\n');
  const r = scan(root);
  assert.ok(r.units.some((u) => u.id === 'claude-project/tidy' && u.kind === 'command'));
  assert.equal(r.containers.find((c) => c.id === 'c:claude-project/tidy').wrapper, undefined);
  assert.ok(r.warnings.includes('Command /two not analysed: 2 lines and 2 numbered steps, so it is drawn as a box that hands over to what it names'));
});

test('an agent unit is one file and its context says it is an agent', () => {
  const s = scan(copyFixture('claude-project'));
  assert.deepEqual(inventoryAll(s)['claude-project/agent-reviewer'].files, ['reviewer.md']);
  const root = copyFixture('claude-project');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const r = runSi(['context', '--root', root, '--unit', 'claude-project/agent-reviewer']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /## Agent under analysis/);
  assert.match(r.stdout, /the agent `reviewer`/);
  assert.match(r.stdout, /Agent file: `\.claude\/agents\/reviewer\.md`/);
  assert.doesNotMatch(r.stdout, /Files in the skill folder/);
});

test('--only on the command pulls in the reviewer it dispatches', () => {
  const r = scan(copyFixture('claude-project'), { only: 'claude-project/report' });
  assert.deepEqual(r.units.map((u) => u.id), ['claude-project/report', 'claude-project/agent-reviewer']);
});

test('command inventory resolves paths against the project root and links commands', () => {
  const s = scan(copyFixture('claude-project'));
  const inv = inventoryAll(s)['claude-project/report'];
  assert.deepEqual(inv.files, ['report.md']);
  const script = inv.facts.find((f) => f.path === 'scripts/report.py');
  assert.equal(script.resolved, 'scripts/report.py');
  assert.equal(script.missing, false);
  assert.ok(inv.facts.some((f) => f.kind === 'dispatch' && f.agentType === 'reviewer'));
  assert.deepEqual(knownSkills(s).byQualified.get('claude-project:quick'), 'c:claude-project/quick');
});

test('merge gives an analysed command its own view; the short one has none', () => {
  const s = scan(copyFixture('claude-project'));
  const model = mergeModel(s, { units: inventoryAll(s) }, new Map(), { run: 'r1' });
  assert.equal(model.nodes.find((n) => n.id === 'c:claude-project/report').analysis, 'failed');
  const views = buildViews(model);
  const view = views.find((v) => v.id === 'c:claude-project/report');
  assert.equal(view.kind, 'command');
  assert.ok(view.nodes.length > 1);
  assert.equal(views.some((v) => v.id === 'c:claude-project/quick'), false);
  assert.equal(views.find((v) => v.id === 'a:claude-project/reviewer').kind, 'agent-def');
  assert.equal(views[0].kind, 'index');
});

test('context names the unit a command', () => {
  const root = copyFixture('claude-project');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const r = runSi(['context', '--root', root, '--unit', 'claude-project/report']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /## Command under analysis/);
  assert.match(r.stdout, /slash command `\/report`/);
  assert.match(r.stdout, /Command file: `\.claude\/commands\/report\.md`/);
  assert.doesNotMatch(r.stdout, /Files in the skill folder/);
});

test('a bare script name resolves to the scripts/ folder', () => {
  const s = scan(copyFixture('claude-project'));
  const resolve = makeResolver(s.root, s.units[0]);
  assert.equal(resolve('report.py'), 'scripts/report.py');
  assert.equal(resolve('other/report.py'), null);
});
