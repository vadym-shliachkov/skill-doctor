import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, COMPUTED_PROMPT_RE } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll, knownSkills } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { mergeModel, resolveAgentTarget } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { buildViews } from '../../skills/schem-it/scripts/lib/views.mjs';
import { buildContext } from '../../skills/schem-it/scripts/lib/context.mjs';
import { copyFixture, runSi } from '../helpers.mjs';

const SKILL = 'skills/audit/SKILL.md';
const src = { file: SKILL, lines: [13, 13], quote: 'Start a subagent' };
const flowOf = (unit, mid) => ({
  unit,
  nodes: [{ id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: src }, ...mid, { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: src }],
  edges: [{ from: 'start', to: mid[0].id, kind: 'flow', source: src }, { from: mid[0].id, to: 'end', kind: 'flow', source: src }],
});
const sub = (id, target, extra = {}) => ({ id, kind: 'subprocess', label: id, role: 'r', target, calls: 'agent', origin: 'inferred', source: src, ...extra });

test('every prompt in a skill agents/ folder is a unit; a README is not', () => {
  const s = scan(copyFixture('deep'));
  assert.deepEqual(s.units.map((u) => u.id), ['deep/audit', 'deep/audit/_contract', 'deep/audit/backlog', 'deep/audit/perf', 'deep/audit/seo', 'deep/agent-runner']);
  const backlog = s.units.find((u) => u.id === 'deep/audit/backlog');
  assert.equal(backlog.kind, 'prompt');
  assert.equal(backlog.skillNode, 't:deep/audit/backlog');
  assert.equal(backlog.file, 'skills/audit/agents/backlog.md');
  assert.equal(backlog.skillDir, 'skills/audit');
  assert.deepEqual(backlog.refs, [{ file: SKILL, lines: [13, 13], quote: 'agents/backlog.md' }]);
  assert.deepEqual(backlog.with, []);
  const node = s.containers.find((c) => c.id === 't:deep/audit/backlog');
  assert.equal(node.kind, 'agent-prompt');
  assert.equal(node.parent, 's:deep/audit');
  assert.equal(node.label, 'Backlog builder');
  assert.equal(node.description, 'You turn findings into a backlog.');
  assert.equal(s.containers.some((c) => /readme/i.test(c.file ?? '')), false);
});

test('a prompt read through a computed path gets that reference and is bundled with the prompt named next to it', () => {
  const s = scan(copyFixture('deep'));
  const seo = s.units.find((u) => u.id === 'deep/audit/seo');
  assert.deepEqual(seo.refs, [{ file: 'skills/audit/scripts/tool.mjs', lines: [4, 4], quote: 'agents/${o.area}.md' }]);
  assert.deepEqual(seo.with, [{ unit: 'deep/audit/_contract', file: 'skills/audit/agents/_contract.md' }]);
  assert.deepEqual(s.containers.find((c) => c.id === 't:deep/audit/seo').with, seo.with);
  const contract = s.units.find((u) => u.id === 'deep/audit/_contract');
  assert.deepEqual(contract.refs.map((r) => `${r.file}:${r.lines[0]}`), ['skills/audit/scripts/tool.mjs:4']);
  assert.deepEqual(contract.with, []);
});

test('computed prompt paths in JS, Python, shell and prose are recognised', () => {
  for (const s of ['read(`agents/${o.area}.md`)', "open('agents/' + area + '.md')", 'f"agents/{area}.md"', 'agents/<area>.md', '"agents/%s.md" % area']) {
    assert.match(s, COMPUTED_PROMPT_RE, s);
  }
  assert.doesNotMatch('agents/seo.md', COMPUTED_PROMPT_RE);
});

test('--only on a skill takes its prompts; --only on a prompt takes only that prompt', () => {
  const root = copyFixture('deep');
  assert.deepEqual(scan(root, { only: 'deep/audit' }).units.map((u) => u.id), ['deep/audit', 'deep/audit/_contract', 'deep/audit/backlog', 'deep/audit/perf', 'deep/audit/seo', 'deep/agent-runner']);
  const one = scan(root, { only: 'deep/audit/backlog' });
  assert.deepEqual(one.units.map((u) => u.id), ['deep/audit/backlog']);
  assert.equal(one.containers.find((c) => c.id === 't:deep/audit/_contract').analysis, 'skipped');
});

test('a prompt is inventoried alone with its bundle, against its skill folder; naming its own skill is not a call', () => {
  const inv = inventoryAll(scan(copyFixture('deep')));
  const backlog = inv['deep/audit/backlog'];
  assert.deepEqual(backlog.files, ['backlog.md']);
  assert.equal(backlog.facts.find((f) => f.path === 'references/finding.schema.json').resolved, 'skills/audit/references/finding.schema.json');
  assert.equal(backlog.facts.some((f) => f.kind === 'skill'), false);
  assert.ok(inv['deep/audit/seo'].facts.some((f) => f.path === 'findings.json' && f.source.file === 'skills/audit/agents/_contract.md'));
});

test('a sub-process names a prompt by path, from its skill or from elsewhere in the plugin', () => {
  const s = scan(copyFixture('deep'));
  const known = knownSkills(s);
  const audit = s.units.find((u) => u.id === 'deep/audit');
  const runner = s.units.find((u) => u.id === 'deep/agent-runner');
  assert.deepEqual(resolveAgentTarget('agents/backlog.md', audit, known), { id: 't:deep/audit/backlog' });
  assert.deepEqual(resolveAgentTarget('<SKILL_DIR>/agents/backlog.md', audit, known), { id: 't:deep/audit/backlog' });
  assert.deepEqual(resolveAgentTarget('skills/audit/agents/_contract.md', runner, known), { id: 't:deep/audit/_contract' });
  assert.deepEqual(resolveAgentTarget('agents/_contract.md', runner, known), { id: 't:deep/audit/_contract' });
  assert.deepEqual(resolveAgentTarget('agents/README.md', audit, known), { file: 'skills/audit/agents/README.md' });
  assert.deepEqual(resolveAgentTarget('agents/nope.md', audit, known), { missing: true });
  const frag = flowOf('deep/audit', [sub('g', 'deep:runner', { targets: ['deep:runner', 'agents/_contract.md'] })]);
  const model = mergeModel(s, { units: {} }, new Map([['deep/audit', frag]]), { run: 'r1' });
  assert.deepEqual(model.nodes.find((n) => n.id === 's:deep/audit#g').opens, ['a:deep/runner', 't:deep/audit/_contract']);
});

test('prompts have views under their skill and are listed on the plugin index', () => {
  const s = scan(copyFixture('deep'));
  const model = mergeModel(s, { units: {} }, new Map([['deep/audit', flowOf('deep/audit', [sub('g', 'agents/backlog.md')])]]), { run: 'r1' });
  const views = buildViews(model);
  assert.equal(views.find((v) => v.id === 's:deep/audit').nodes.some((id) => id.startsWith('t:')), false);
  assert.equal(views.find((v) => v.id === 't:deep/audit/seo').parent, 's:deep/audit');
  const index = views.find((v) => v.id === 'p:deep');
  assert.deepEqual(index.groups.map((g) => g.title), ['Skills', 'Agents', 'Agent prompts']);
  assert.deepEqual(index.groups[2].items, ['t:deep/audit/_contract', 't:deep/audit/backlog', 't:deep/audit/perf', 't:deep/audit/seo']);
});

test('context: a prompt unit says where it is handed over; other units see the plugin prompts', () => {
  const s = scan(copyFixture('deep'));
  const inv = inventoryAll(s);
  const backlog = s.units.find((u) => u.id === 'deep/audit/backlog');
  const text = buildContext({ root: s.root, run: 'r1', unit: backlog, inventory: inv[backlog.id], units: s.units, save: false, siPath: 'si.mjs' });
  assert.match(text, /## Agent prompt under analysis/);
  assert.match(text, /agent prompt `skills\/audit\/agents\/backlog\.md` of the skill `audit`/);
  assert.match(text, /skills\/audit\/SKILL\.md:13/);
  const runner = s.units.find((u) => u.id === 'deep/agent-runner');
  const forRunner = buildContext({ root: s.root, run: 'r1', unit: runner, inventory: inv[runner.id], units: s.units, save: false, siPath: 'si.mjs' });
  assert.match(forRunner, /## Agent prompts in this plugin/);
  assert.match(forRunner, /\| `skills\/audit\/agents\/_contract\.md` \| Contract for every area \| skills\/audit\/scripts\/tool\.mjs:4 \|/);
});

test('scan counts prompt units', () => {
  const r = runSi(['scan', '--root', copyFixture('deep')]);
  assert.equal(r.json.counts.units.prompts, 4);
  assert.equal(r.json.counts.prompts, 4);
});

test('a computed prompt path next to a shared prompt that does not exist leaves a warning; the prompts are analysed alone', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = copyFixture('deep');
  fs.rmSync(path.join(root, 'skills/audit/agents/_contract.md'));
  const s = scan(root);
  assert.deepEqual(s.units.find((u) => u.id === 'deep/audit/seo').with, []);
  assert.match(s.warnings.join('\n'), /skills\/audit\/scripts\/tool\.mjs:4 names agents\/_contract\.md next to a computed prompt path, but that file does not exist/);
});
