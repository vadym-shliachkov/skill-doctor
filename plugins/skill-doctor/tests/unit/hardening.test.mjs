import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detect } from '../../skills/schem-it/scripts/lib/detect.mjs';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll, extractFacts } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { unitFile, runDir, isInside } from '../../skills/schem-it/scripts/lib/paths.mjs';
import { tmpDir, runSi } from '../helpers.mjs';

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('a skill folder with its own agents/ is still a skill', () => {
  const root = write(path.join(tmpDir(), 'helper'), {
    'SKILL.md': '---\nname: helper\ndescription: d\n---\n\n1. Dispatch `agents/worker.md`.\n',
    'agents/worker.md': 'You work.\n',
  });
  assert.equal(detect(root).level, 'skill');
  assert.deepEqual(scan(root).units.map((u) => u.id), ['helper', 'helper/worker']);
});

test('scan warns when there is nothing to analyse', () => {
  const root = write(path.join(tmpDir(), 'p'), { '.claude-plugin/plugin.json': '{"name":"p"}', 'skills/a/SKILL.md': '---\nname: a\n---\n' });
  assert.match(scan(root, { only: 'nomatch' }).warnings.join('\n'), /No skills to analyse/);
});

test('unit ids are safe slugs even when the frontmatter name is hostile', () => {
  const root = write(path.join(tmpDir(), 'p'), {
    '.claude-plugin/plugin.json': '{"name":"p"}',
    'skills/a/SKILL.md': '---\nname: evil$(echo PWNED>&2)\n---\n',
    'skills/b/SKILL.md': '---\nname: ..\\..\\..\\escaped\n---\n',
  });
  const r = scan(root);
  for (const u of r.units) assert.match(u.id, /^p\/[A-Za-z0-9._-]+$/, u.id);
  assert.equal(r.containers.find((c) => c.id === `s:${r.units[0].id}`).label, 'evil$(echo PWNED>&2)');
  assert.match(r.warnings.join('\n'), /not a safe id/);
});

test('a skill folder with a space and no name gets a slug id', () => {
  const root = write(path.join(tmpDir(), 'my skill'), { 'SKILL.md': '# no frontmatter\n' });
  assert.deepEqual(scan(root).units.map((u) => u.id), ['my-skill']);
});

test('unitFile never leaves the run folder', () => {
  const root = tmpDir();
  const f = unitFile(root, 'r1', '../../../outside');
  assert.ok(isInside(path.join(runDir(root, 'r1'), 'units'), f), f);
});

test('context quotes every value in the save command', () => {
  const root = write(path.join(tmpDir(), 'sk'), { 'SKILL.md': '---\nname: sk\n---\n\n1. Step.\n' });
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const out = runSi(['context', '--root', root, '--unit', 'sk', '--save']).stdout;
  assert.match(out, /save-unit --root '[^']+' --run '[^']+' --unit 'sk' --file '[^']+drafts\/sk\.json'/);
});

test('../ links resolve against the file that mentions them', () => {
  const root = write(path.join(tmpDir(), 'p'), {
    '.claude-plugin/plugin.json': '{"name":"p"}',
    'skills/a/SKILL.md': '---\nname: a\n---\n\nSee [tools](../b/references/tools.md).\n',
    'skills/b/SKILL.md': '---\nname: b\n---\n',
    'skills/b/references/tools.md': '# tools\n',
  });
  const f = inventoryAll(scan(root))['p/a'].facts.find((x) => x.kind === 'file');
  assert.equal(f.path, '../b/references/tools.md');
  assert.equal(f.resolved, 'skills/b/references/tools.md');
  assert.equal(f.missing, false);
});

test('a role folder deep inside an example path does not make it a missing reference', () => {
  const root = write(path.join(tmpDir(), 'p'), {
    '.claude-plugin/plugin.json': '{"name":"p"}',
    'skills/a/SKILL.md': '---\nname: a\n---\n\nFor example `src/agents/agent-tool-abort.test.ts` fails.\n',
  });
  const f = inventoryAll(scan(root))['p/a'].facts.find((x) => x.kind === 'file');
  assert.equal(f.missing, false);
});

test('negated mentions are left out of the inventory missing summary', () => {
  const root = write(path.join(tmpDir(), 'p'), {
    '.claude-plugin/plugin.json': '{"name":"p"}',
    'skills/a/SKILL.md': '---\nname: a\n---\n\nFor example `scripts/tool.sh` would do it.\nRun `scripts/real.sh`.\n',
  });
  runSi(['scan', '--root', root]);
  const r = runSi(['inventory', '--root', root]);
  assert.deepEqual(r.json.missing, [{ unit: 'p/a', ref: 'scripts/real.sh' }]);
});

test('plugin:agent after subagent_type is not a skill mention', () => {
  const known = { byQualified: new Map(), byName: new Map(), plugins: new Set(['demo']), agents: new Set() };
  const facts = extractFacts('Use subagent_type: "demo:reviewer" here.', 'SKILL.md', { known, selfId: 's:demo/x', selfPlugin: 'demo', resolve: () => null });
  assert.equal(facts.some((f) => f.kind === 'skill'), false);
  assert.deepEqual(facts.filter((f) => f.kind === 'dispatch').map((f) => f.agentType), ['demo:reviewer']);
});

test('--only pulls in an agent only when its exact name appears, regex characters included', () => {
  const files = {
    '.claude-plugin/plugin.json': '{"name":"p"}',
    'agents/v1.2-check.md': '---\nname: v1.2-check\ndescription: d\n---\n\nYou check.\n',
  };
  const near = write(path.join(tmpDir(), 'p'), { ...files, 'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\n\n1. Ask v1x2-check.\n' });
  assert.deepEqual(scan(near, { only: 'p/a' }).units.map((u) => u.id), ['p/a']);
  const exact = write(path.join(tmpDir(), 'p'), { ...files, 'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\n\n1. Ask v1.2-check.\n' });
  assert.deepEqual(scan(exact, { only: 'p/a' }).units.map((u) => u.id), ['p/a', 'p/agent-v1.2-check']);
});

test('an agent file whose frontmatter does not parse is a warning', () => {
  const root = write(path.join(tmpDir(), 'p'), {
    '.claude-plugin/plugin.json': '{"name":"p"}',
    'skills/a/SKILL.md': '---\nname: a\n---\n',
    'agents/broken.md': '---\nname: broken\ndescription: d\n\nNo closing line.\n',
  });
  assert.match(scan(root).warnings.join('\n'), /agents\/broken\.md: Frontmatter has no closing/);
});
