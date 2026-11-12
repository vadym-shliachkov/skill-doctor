import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detect } from '../../skills/schem-it/scripts/lib/detect.mjs';
import { scan, globToRegex } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { copyFixture, tmpDir, runSi } from '../helpers.mjs';

test('detects each fixture level', () => {
  assert.equal(detect(copyFixture('single-skill')).level, 'skill');
  assert.equal(detect(copyFixture('plugin')).level, 'plugin');
  const m = detect(copyFixture('marketplace'));
  assert.equal(m.level, 'marketplace');
  assert.deepEqual(m.plugins.map((p) => p.name), ['one', 'two']);
  assert.match(m.warnings.join('\n'), /remote.*non-local source/);
});

test('unrecognised folder lists the markers looked for', () => {
  assert.throws(() => detect(tmpDir()), /Not a marketplace, plugin or skill: looked for .*SKILL\.md/);
});

test('single skill scan: root is the skill and paths are relative', () => {
  const root = copyFixture('single-skill');
  const r = scan(root);
  assert.equal(r.level, 'skill');
  assert.equal(r.rootId, 's:alpha');
  assert.equal(r.root.includes('\\'), false);
  assert.deepEqual(r.units, [{ id: 'alpha', kind: 'skill', skillNode: 's:alpha', plugin: null, name: 'alpha', dir: '.', file: 'SKILL.md', pluginDir: '.' }]);
  const skill = r.containers.find((c) => c.id === 's:alpha');
  assert.deepEqual(skill.source, { file: 'SKILL.md', lines: [2, 2], quote: 'name: alpha' });
});

test('plugin scan lists skills, agents, commands and hooks', () => {
  const r = scan(copyFixture('plugin'));
  assert.equal(r.rootId, 'p:demo');
  const ids = r.containers.map((c) => c.id).sort();
  assert.deepEqual(ids, ['a:demo/checker', 'c:demo/hello', 'h:demo/PreToolUse.0', 'p:demo', 's:demo/alpha', 's:demo/beta']);
  assert.deepEqual(r.units.map((u) => u.id), ['demo/alpha', 'demo/beta', 'demo/agent-checker']);
  assert.deepEqual(r.units[2], { id: 'demo/agent-checker', kind: 'agent', skillNode: 'a:demo/checker', plugin: 'demo', name: 'checker', dir: 'agents', file: 'agents/checker.md', pluginDir: '.' });
  const hook = r.containers.find((c) => c.kind === 'hook');
  assert.equal(hook.label, 'PreToolUse: Bash');
  assert.match(hook.command, /guard\.js/);
  assert.equal(r.containers.find((c) => c.id === 'a:demo/checker').tools, 'Read, Grep');
  assert.equal(r.containers.find((c) => c.id === 'c:demo/hello').label, '/hello');
});

test('marketplace scan nests plugins under the marketplace', () => {
  const r = scan(copyFixture('marketplace'));
  assert.equal(r.rootId, 'm:shop');
  assert.equal(r.containers.find((c) => c.id === 'p:one').parent, 'm:shop');
  assert.equal(r.containers.find((c) => c.id === 's:two/finish').parent, 'p:two');
  assert.deepEqual(r.units.map((u) => u.id), ['one/start', 'two/finish']);
  assert.equal(r.units[1].pluginDir, 'plugins/two');
});

test('--only marks other units as skipped and pulls in the agents a selected unit names', () => {
  const beta = scan(copyFixture('plugin'), { only: 'demo/b*' });
  assert.deepEqual(beta.units.map((u) => u.id), ['demo/beta']);
  assert.equal(beta.containers.find((c) => c.id === 's:demo/alpha').analysis, 'skipped');
  assert.equal(beta.containers.find((c) => c.id === 'a:demo/checker').analysis, 'skipped');
  assert.deepEqual(scan(copyFixture('plugin'), { only: 'demo/alpha' }).units.map((u) => u.id), ['demo/alpha', 'demo/agent-checker']);
  assert.deepEqual(scan(copyFixture('plugin'), { only: 'demo/agent-*' }).units.map((u) => u.id), ['demo/agent-checker']);
  assert.equal(globToRegex('a*,b').test('b'), true);
  assert.equal(globToRegex('a*,b').test('cb'), false);
});

test('malformed frontmatter is a warning, not a failure', () => {
  const r = scan(copyFixture('broken'));
  const bad = r.containers.find((c) => c.kind === 'skill');
  assert.equal(bad.id, 's:broken/bad');
  assert.match(bad.warnings[0], /Frontmatter/);
  assert.match(r.warnings.join('\n'), /skills\/bad\/SKILL\.md: Frontmatter/);
});

test('scan command writes scan.json and latest.json in a path with spaces and ~', () => {
  const root = copyFixture('plugin');
  assert.match(root, / /);
  const r = runSi(['scan', '--root', root]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.counts, { units: { skills: 2, commands: 0, agents: 1, prompts: 0 }, plugins: 1, skills: 2, agents: 1, prompts: 0, hooks: 1, commands: 1 });
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.schem-it', r.json.run, 'scan.json'), 'utf8'));
  assert.equal(saved.run, r.json.run);
  const latest = JSON.parse(fs.readFileSync(path.join(root, '.schem-it', 'latest.json'), 'utf8'));
  assert.equal(latest.run, r.json.run);
});
