import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll, extractFacts, knownSkills } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { copyFixture, runSi } from '../helpers.mjs';

const byKind = (facts, kind) => facts.filter((f) => f.kind === kind);

test('single skill: script and reference resolved with line citations', () => {
  const inv = inventoryAll(scan(copyFixture('single-skill'))).alpha;
  const files = byKind(inv.facts, 'file');
  const script = files.find((f) => f.path === 'scripts/build.mjs');
  assert.equal(script.role, 'script');
  assert.equal(script.resolved, 'scripts/build.mjs');
  assert.equal(script.missing, false);
  assert.deepEqual(script.source, { file: 'SKILL.md', lines: [11, 11], quote: 'scripts/build.mjs' });
  const ref = files.find((f) => f.path === 'references/style.md');
  assert.equal(ref.role, 'reference');
  const artifacts = files.filter((f) => f.role === 'artifact').map((f) => f.path).sort();
  assert.deepEqual(artifacts, ['notes.json', 'report.md']);
  assert.equal(inv.frontmatterEnd, 4);
  assert.deepEqual(inv.files.sort(), ['SKILL.md', 'references/style.md', 'scripts/build.mjs']);
  assert.deepEqual(inv.facts.map((f) => f.id), inv.facts.map((_, i) => `f${i + 1}`));
});

test('plugin: dispatch, qualified skill call and negated mention', () => {
  const inv = inventoryAll(scan(copyFixture('plugin')));
  const alpha = inv['demo/alpha'].facts;
  assert.deepEqual(byKind(alpha, 'dispatch').map((f) => f.agentType), ['demo:checker']);
  const skills = byKind(alpha, 'skill');
  assert.equal(skills.length, 1);
  assert.equal(skills[0].target, 's:demo/beta');
  assert.equal(skills[0].negated, false);
  const beta = inv['demo/beta'].facts;
  const missing = byKind(beta, 'file').find((f) => f.path === 'references/missing.md');
  assert.equal(missing.missing, true);
});

test('broken: missing script, negated and missing skill mentions', () => {
  const inv = inventoryAll(scan(copyFixture('broken')))['broken/bad'];
  assert.equal(byKind(inv.facts, 'file').find((f) => f.path === 'scripts/gone.mjs').missing, true);
  const skills = byKind(inv.facts, 'skill');
  const ghost = skills.find((f) => f.mention.includes('ghost'));
  assert.equal(ghost.negated, true);
  assert.equal(ghost.missing, true);
  const phantom = skills.find((f) => f.mention.includes('phantom'));
  assert.equal(phantom.negated, false);
  assert.equal(phantom.missing, true);
});

test('marketplace: cross-plugin qualified mention resolves', () => {
  const inv = inventoryAll(scan(copyFixture('marketplace')));
  const s = byKind(inv['one/start'].facts, 'skill')[0];
  assert.equal(s.target, 's:two/finish');
});

test('extractFacts: bare known names, slash names, MCP tools, URLs ignored, dedupe', () => {
  const known = { byQualified: new Map([['p:other-skill', 's:p/other-skill']]), byName: new Map([['other-skill', ['s:p/other-skill']], ['self', ['s:p/self']]]), plugins: new Set(['p']) };
  const text = [
    'Then run other-skill and /other-skill again.',
    'Use mcp__figma__get_screenshot for images.',
    'See https://example.com/docs/readme.md for more.',
    'self is this skill.',
    'Run other-skill once more.',
    'Use the Agent tool for each file. Codex: spawn_agent.',
  ].join('\n');
  const facts = extractFacts(text, 'SKILL.md', { known, selfId: 's:p/self', selfPlugin: 'p', resolve: () => null });
  const skills = facts.filter((f) => f.kind === 'skill');
  assert.equal(skills.length, 1);
  assert.equal(skills[0].occurrences, 3);
  assert.equal(skills[0].target, 's:p/other-skill');
  assert.deepEqual(facts.filter((f) => f.kind === 'external').map((f) => f.name), ['mcp__figma__get_screenshot']);
  assert.equal(facts.some((f) => f.kind === 'file'), false);
  assert.deepEqual(facts.filter((f) => f.kind === 'dispatch').map((f) => f.agentType), [null, 'spawn_agent']);
});

test('knownSkills includes skipped skills', () => {
  const k = knownSkills(scan(copyFixture('plugin'), { only: 'demo/alpha' }));
  assert.equal(k.byQualified.get('demo:beta'), 's:demo/beta');
});

test('inventory command writes inventory.json and reports missing references', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  const r = runSi(['inventory', '--root', root]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.units, 3);
  assert.deepEqual(r.json.missing, [{ unit: 'demo/beta', ref: 'references/missing.md' }]);
});

test('makeResolver strips skill-dir placeholders and plugin-relative prefixes', async () => {
  const { makeResolver } = await import('../../skills/schem-it/scripts/lib/inventory.mjs');
  const s = scan(copyFixture('single-skill'));
  const resolve = makeResolver(s.root, s.units[0]);
  assert.equal(resolve('<SKILL_DIR>/references/style.md'), 'references/style.md');
  assert.equal(resolve('${CLAUDE_SKILL_DIR}/scripts/build.mjs'), 'scripts/build.mjs');
  assert.equal(resolve('${CLAUDE_PLUGIN_ROOT}/skills/alpha/references/style.md'), 'references/style.md');
  assert.equal(resolve('skills/alpha/references/style.md'), 'references/style.md');
  assert.equal(resolve('references/nope.md'), null);
});

test('extractFacts: e.g. paths, example sections and product names are not references', () => {
  const known = { byQualified: new Map(), byName: new Map(), plugins: new Set(), agents: new Set() };
  const text = [
    'Run the script (e.g. `node scripts/ph.mjs init`).', // 1
    'Requires Node.js 22.', // 2
    '## Example', // 3
    '```json', // 4
    '# not a heading inside a fence', // 5
    '{ "command": "node scripts/build.mjs collect", "loads": ["references/style.md"] }', // 6
    '```', // 7
    '## Steps', // 8
    'Run scripts/real.mjs.', // 9
  ].join('\n');
  const facts = extractFacts(text, 'SKILL.md', { known, selfId: 's:p/self', selfPlugin: 'p', resolve: () => null });
  const file = (p) => facts.find((f) => f.path === p);
  assert.equal(file('scripts/ph.mjs').negated, true);
  assert.equal(file('Node.js'), undefined);
  assert.equal(file('scripts/build.mjs').negated, true);
  assert.equal(file('references/style.md').negated, true);
  assert.equal(file('scripts/real.mjs').negated, false);
  assert.equal(file('scripts/real.mjs').missing, true);
});

test('extractFacts: dotfile paths keep their leading dot', () => {
  const known = { byQualified: new Map(), byName: new Map(), plugins: new Set(), agents: new Set() };
  const text = 'Check `.mcp.json`, .claude/settings.json and ../shared/notes.md, but not end.of.sentence words.';
  const facts = extractFacts(text, 'SKILL.md', { known, selfId: 's:p/self', selfPlugin: 'p', resolve: () => null });
  assert.deepEqual(facts.filter((f) => f.kind === 'file').map((f) => f.path), ['.mcp.json', '.claude/settings.json', '../shared/notes.md']);
});

test('extractFacts: the frontmatter describes the unit; only MCP tools in it are facts', () => {
  const known = { byQualified: new Map(), byName: new Map([['parent-skill', ['s:p/parent-skill']]]), plugins: new Set(['p']), agents: new Set() };
  const text = [
    '---', // 1
    'name: helper', // 2
    'description: Started by the parent-skill skill; writes report.md.', // 3
    'tools: Read, mcp__figma__get_screenshot', // 4
    '---', // 5
    'Read notes.json, then hand back to parent-skill.', // 6
  ].join('\n');
  const facts = extractFacts(text, 'agents/helper.md', { known, selfId: 'a:p/helper', selfPlugin: 'p', resolve: () => null });
  const skill = facts.find((f) => f.kind === 'skill');
  assert.deepEqual(skill.source.lines, [6, 6]);
  assert.equal(facts.some((f) => f.path === 'report.md'), false);
  assert.deepEqual(facts.filter((f) => f.kind === 'external').map((f) => f.source.lines[0]), [4]);
});
