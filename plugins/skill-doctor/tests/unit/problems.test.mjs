import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scan } from '../../skills/schem-it/scripts/lib/scan.mjs';
import { inventoryAll } from '../../skills/schem-it/scripts/lib/inventory.mjs';
import { validateFragment } from '../../skills/schem-it/scripts/lib/validate.mjs';
import { mergeModel } from '../../skills/schem-it/scripts/lib/merge.mjs';
import { discoverUnits } from '../../skills/schem-it/scripts/lib/discover.mjs';
import { buildViews } from '../../skills/schem-it/scripts/lib/views.mjs';
import { renderMarkdown } from '../../skills/schem-it/scripts/lib/render-mermaid.mjs';
import { splitTools, bashRule, commandAllowed, countProblems } from '../../skills/schem-it/scripts/lib/problems.mjs';
import { copyFixture, FIXTURES, runSi } from '../helpers.mjs';

const at = (file, line, quote) => ({ file, lines: [line, line], quote });
// A straight flowchart: start, the given blocks in order (files hang off them by the extra edges), end.
const chain = (unit, file, mid, extraEdges = [], extra = {}) => ({
  unit,
  nodes: [{ id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: at(file, 1, '---') }, ...mid, { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: at(file, 1, '---') }],
  edges: [...['start', ...mid.filter((n) => n.kind !== 'storage').map((n) => n.id), 'end'].map((id, i, all) => (i ? { from: all[i - 1], to: id, kind: 'flow', source: at(file, 1, '---') } : null)).filter(Boolean), ...extraEdges],
  ...extra,
});
const step = (id, label, file, more = {}) => ({ id, kind: 'process', label, role: 'r', origin: 'inferred', source: at(file, 1, '---'), ...more });
const file = (id, p, src) => ({ id, kind: 'storage', label: path.posix.basename(p), role: 'r', path: p, holds: 'data', origin: 'inferred', source: at(src, 1, '---') });
const reads = (from, to, src) => ({ from, to, kind: 'reads', label: 'data', source: at(src, 1, '---') });
const writes = (from, to, src) => ({ from, to, kind: 'writes', label: 'data', source: at(src, 1, '---') });

const RUNNER = 'skills/runner/SKILL.md';
const WORKER = 'agents/worker.md';

function problemsFixture({ gaps } = {}) {
  const s = scan(copyFixture('problems'));
  const units = inventoryAll(s);
  const runner = chain('prob/runner', RUNNER, [
    { id: 'in', kind: 'io', direction: 'in', label: 'Task', role: 'The task in input.json.', origin: 'inferred', source: at(RUNNER, 9, 'input.json') },
    step('read-in', 'Read the task', RUNNER),
    file('f-in', '.out/<run>/input.json', RUNNER),
    step('build', 'Build', RUNNER, { command: 'node "<SKILL_DIR>/scripts/go.mjs" build' }),
    file('f-state', '.out/<run>/state.json', RUNNER),
    step('git', 'See what changed', RUNNER, { command: 'git status' }),
    step('gone', 'Clean up', RUNNER, { command: 'node scripts/gone.mjs' }),
    step('plan', 'Read the plan', RUNNER),
    file('f-plan', '.out/<run>/plan.json', RUNNER),
    step('seed', 'Read the seed', RUNNER),
    file('f-seed', 'data/seed.json', RUNNER),
    file('f-result', 'data/result.json', RUNNER),
    step('log', 'Write the log and report', RUNNER),
    file('f-log', '.out/<run>/log.json', RUNNER),
    file('f-report', '.out/<run>/report.md', RUNNER),
    { id: 'out', kind: 'io', direction: 'out', label: 'report.md', role: 'The report handed to the user.', origin: 'inferred', source: at(RUNNER, 15, 'report.md') },
  ], [
    reads('f-in', 'read-in', RUNNER), writes('build', 'f-state', RUNNER), reads('f-plan', 'plan', RUNNER), reads('f-state', 'plan', RUNNER),
    reads('f-seed', 'seed', RUNNER), writes('seed', 'f-result', RUNNER), writes('log', 'f-log', RUNNER), writes('log', 'f-report', RUNNER),
  ], gaps ? { gaps } : {});
  const worker = chain('prob/agent-worker', WORKER, [
    step('build', 'Build once', WORKER, { command: 'node scripts/go.mjs build' }),
    step('read', 'Read the result', WORKER),
    file('f-result', 'data/result.json', WORKER),
  ], [reads('f-result', 'read', WORKER)]);
  const free = chain('prob/agent-free', 'agents/free.md', [step('log', 'List commits', 'agents/free.md', { command: 'git log' })]);
  const loose = chain('prob/loose', 'skills/loose/SKILL.md', [step('git', 'Check status', 'skills/loose/SKILL.md', { command: 'git status' })]);
  const fragments = new Map([runner, worker, free, loose].map((f) => [f.unit, f]));
  return { s, units, model: mergeModel(s, { units }, fragments, { run: 'r1' }) };
}

const kinds = (model, unit) => model.problems.filter((p) => p.unit === unit).map((p) => `${p.severity} ${p.kind}${p.node ? ` ${p.node.split('#')[1]}` : ''}`);

// --- gaps from the analyst -------------------------------------------------------------------------------------

function singleSkill() {
  const s = scan(copyFixture('single-skill'));
  return { root: s.root, inv: inventoryAll(s).alpha };
}
const src = (lines, quote) => ({ file: 'SKILL.md', lines, quote });
const tiny = (extra = {}) => ({
  unit: 'alpha',
  nodes: [
    { id: 'start', kind: 'start', label: 'Start', role: 'r', origin: 'inferred', source: src([8, 8], 'Steps') },
    { id: 'ask', kind: 'process', user: true, label: 'Ask user', role: 'r', origin: 'inferred', source: src([12, 12], 'Ask the user to approve the outline.') },
    { id: 'end', kind: 'end', label: 'End', role: 'r', origin: 'inferred', source: src([13, 13], 'Write report.md') },
  ],
  edges: [
    { from: 'start', to: 'ask', kind: 'flow', source: src([12, 12], 'Ask the user') },
    { from: 'ask', to: 'end', kind: 'flow', source: src([13, 13], 'Write report.md') },
  ],
  ...extra,
});
const gap = (more = {}) => ({ kind: 'missing-branch', at: 'ask', text: 'The text never says what happens when the user rejects the outline.', source: src([12, 12], 'STOP until they answer.'), ...more });

test('a fragment without gaps, and one with a valid gap, are valid', () => {
  const { root, inv } = singleSkill();
  assert.deepEqual(validateFragment(root, 'alpha', tiny(), inv), { ok: true, errors: [] });
  assert.deepEqual(validateFragment(root, 'alpha', tiny({ gaps: [gap(), (({ at: _at, ...g }) => g)(gap({ kind: 'undefined' }))] }), inv), { ok: true, errors: [] });
});

test('a gap must name an existing block, cite its lines, use a known kind and stay short', () => {
  const { root, inv } = singleSkill();
  const errs = (g) => validateFragment(root, 'alpha', tiny({ gaps: [g] }), inv).errors.map((e) => `${e.path} ${e.message}`);
  assert.ok(errs(gap({ at: 'nowhere' })).some((m) => m.startsWith('$.gaps[0].at') && /unknown node "nowhere"/.test(m)));
  assert.ok(errs(gap({ source: src([10, 10], 'STOP until they answer.') })).some((m) => m.startsWith('$.gaps[0].source') && /quote not found/.test(m)));
  assert.ok(errs(gap({ source: src([90, 90], 'STOP until they answer.') })).some((m) => /lines 90-90 outside/.test(m)));
  assert.ok(errs(gap({ kind: 'vague' })).some((m) => m.startsWith('$.gaps[0].kind')));
  assert.ok(errs(gap({ text: 'x'.repeat(241) })).some((m) => /at most 240/.test(m)));
  assert.ok(errs({ kind: 'ambiguous', text: 'Two readings of this step.' }).some((m) => /missing required property "source"/.test(m)));
});

test('merge turns gaps into problems pinned to their block; a fragment without gaps adds none', () => {
  const with_ = problemsFixture({ gaps: [{ kind: 'contradiction', at: 'git', text: 'Step 3 runs git status but the allowed tools only cover node.', source: at(RUNNER, 11, 'git status') }, { kind: 'ambiguous', text: 'It is unclear whether the report is written before or after the log.', source: at(RUNNER, 15, 'log.json') }] }).model;
  const gaps = with_.problems.filter((p) => p.by === 'analyst');
  assert.deepEqual(gaps.map((p) => [p.severity, p.kind, p.node ?? null, p.title]), [
    ['warning', 'contradiction', 's:prob/runner#git', 'Contradiction'],
    ['info', 'ambiguous', null, 'Ambiguous step'],
  ]);
  assert.deepEqual(gaps[0].source, at(RUNNER, 11, 'git status'));
  const without = problemsFixture().model;
  assert.equal(without.problems.filter((p) => p.by === 'analyst').length, 0);
  assert.ok(without.problems.every((p, i) => p.id === `p${i + 1}`));
});

// --- checks computed by the script -----------------------------------------------------------------------------

test('runner: a script that is not there, a command allowed-tools does not cover, a file read that nothing writes, a file written that nothing reads', () => {
  const { model } = problemsFixture();
  assert.deepEqual(kinds(model, 's:prob/runner'), [
    'warning script-not-found gone',
    'warning never-written f-plan',
    'info no-overview',
    'info tool-not-allowed git',
    'info never-read f-log',
  ]);
  const by = (k) => model.problems.find((p) => p.kind === k);
  assert.match(by('script-not-found').message, /"Clean up" runs scripts\/gone\.mjs, but no such file is in the analysed folder/);
  assert.match(by('never-written').message, /\.out\/<run>\/plan\.json is read by "Read the plan", but no analysed unit writes it/);
  assert.match(by('never-read').message, /\.out\/<run>\/log\.json is written by "Write the log and report"/);
  assert.match(model.problems.find((p) => p.kind === 'tool-not-allowed' && p.unit === 's:prob/runner').message, /`git status`.*allowed-tools \(Read, Bash\(node:\*\)\)/);
});

test('no false positives: input named by the input block, file on disk, file another unit reads, result handed to the user, covered commands', () => {
  const { model } = problemsFixture();
  const nodes = new Set(model.problems.map((p) => p.node).filter(Boolean));
  for (const id of ['f-in', 'f-seed', 'f-state', 'f-result', 'f-report', 'build']) assert.equal(nodes.has(`s:prob/runner#${id}`), false, id);
  assert.equal(nodes.has('a:prob/worker#f-result'), false);
});

test('an agent whose tools leave out Bash cannot run its command; no tools or an undecidable pattern reports nothing', () => {
  const { model } = problemsFixture();
  // Its text names scripts/go.mjs, which is the runner skill's script: not a missing reference.
  assert.deepEqual(kinds(model, 'a:prob/worker'), ['warning tool-not-allowed build', 'info no-overview']);
  assert.match(model.problems.find((p) => p.unit === 'a:prob/worker' && p.kind === 'tool-not-allowed').message, /the agent's tools \(Read, Grep\) do not let it run/);
  assert.deepEqual(kinds(model, 'a:prob/free'), ['info no-overview']);
  assert.deepEqual(kinds(model, 's:prob/loose'), ['info no-overview']);
});

test('allowed-tools parsing and Bash patterns', () => {
  assert.deepEqual(splitTools('Read, Glob, Bash(git log:*, git diff:*), Agent'), ['Read', 'Glob', 'Bash(git log:*, git diff:*)', 'Agent']);
  assert.deepEqual(splitTools('Read Grep Bash(npm run test)'), ['Read', 'Grep', 'Bash(npm run test)']);
  assert.deepEqual(splitTools(['Read', 'Bash']), ['Read', 'Bash']);
  assert.equal(bashRule(null), null);
  assert.equal(bashRule('Read, Bash').all, true);
  assert.equal(bashRule('Read, Bash(*)').all, true);
  const rule = bashRule('Read, Bash(node:*), Bash(git log *), Bash(npm test), Bash(node ${CLAUDE_SKILL_DIR}/scripts/si.mjs:*)');
  assert.equal(commandAllowed(rule, 'node scripts/x.mjs build'), true);
  assert.equal(commandAllowed(rule, 'nodemon x'), false);
  assert.equal(commandAllowed(rule, 'git log --oneline'), true);
  assert.equal(commandAllowed(rule, 'git push'), false);
  assert.equal(commandAllowed(rule, 'npm test'), true);
  assert.equal(commandAllowed(rule, 'npm test -- --watch'), false);
  // Chained, piped or placeholder commands cannot be decided from the text: never reported.
  assert.equal(commandAllowed(rule, 'git push && git log'), true);
  assert.equal(commandAllowed(rule, 'cat x | grep y'), true);
  assert.equal(commandAllowed(rule, 'SI scan --root x'), true);
  assert.equal(commandAllowed(bashRule('Read, Bash(git * main)'), 'git status'), true);
  assert.equal(commandAllowed(bashRule('Read, Grep'), 'git status'), false);
});

test('existing defects become problems: analysis failed, missing reference, missing callee, loads not found', () => {
  const s = scan(copyFixture('plugin'));
  const units = inventoryAll(s);
  const alpha = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', 'plugin', 'demo__alpha.json'), 'utf8'));
  const model = mergeModel(s, { units }, new Map([[alpha.unit, alpha]]), { run: 'r1' });
  assert.deepEqual(kinds(model, 's:demo/beta'), ['error analysis-failed', 'warning reference-missing']);
  const ref = model.problems.find((p) => p.kind === 'reference-missing');
  assert.match(ref.message, /refers to references\/missing\.md/);
  assert.deepEqual(ref.source, { file: 'skills/beta/SKILL.md', lines: [8, 8], quote: 'references/missing.md' });

  const m = scan(copyFixture('marketplace'));
  const start = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', 'marketplace', 'one__start.json'), 'utf8'));
  start.nodes.find((n) => n.id === 's1').loads = ['references/nowhere.md'];
  const mm = mergeModel(m, { units: inventoryAll(m) }, new Map([[start.unit, start]]), { run: 'r1' });
  assert.deepEqual(kinds(mm, 's:one/start'), ['error missing ghost', 'warning load-missing s1', 'info no-overview']);
  assert.match(mm.problems.find((p) => p.kind === 'missing').message, /"two:ghost" invokes the skill \/two:ghost, but the analysed plugin has no skill of that name/);
  assert.deepEqual(mm.nodes.find((n) => n.id === 's:one/start#ghost').missingTargets, ['/two:ghost']);
});

test('an unnamed callee, a script nothing runs and what the round limit left become info problems', () => {
  const s = scan(copyFixture('plugin'));
  const alpha = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'fragments', 'plugin', 'demo__alpha.json'), 'utf8'));
  Object.assign(alpha.nodes.find((n) => n.id === 'chk'), { target: 'checker subagents' });
  const model = mergeModel({ ...s, left: [{ kind: 'stage', target: 'scripts/x.mjs#run', caller: 'demo/alpha' }] }, { units: {} }, new Map([[alpha.unit, alpha]]), { run: 'r1' });
  assert.deepEqual(kinds(model, 's:demo/alpha'), ['info no-overview', 'info not-drawn', 'info unresolved chk']);
  assert.match(model.problems.find((p) => p.kind === 'not-drawn').message, /The stage scripts\/x\.mjs#run was not drawn/);

  const p = scan(copyFixture('pipeline'));
  const first = mergeModel(p, { units: {} }, new Map(), { run: 'r1' });
  const d = discoverUnits(p, first);
  const swept = d.scan.units.filter((u) => u.sweep);
  assert.ok(swept.length);
  const second = mergeModel(d.scan, { units: {} }, new Map(), { run: 'r1' });
  const notRun = second.problems.filter((x) => x.kind === 'not-run');
  assert.deepEqual(notRun.map((x) => x.unit).sort(), swept.map((u) => u.skillNode).sort());
  assert.ok(notRun.every((x) => x.severity === 'info' && /Nothing in the analysed .* runs /.test(x.message)));
});

test('merge command writes problems into model.json and reports their counts; failed and missing still work', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const r = runSi(['merge', '--root', root]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.problems, { error: 3, warning: 1, info: 0 });
  assert.deepEqual(r.json.failed, ['s:demo/alpha', 's:demo/beta', 'a:demo/checker']);
  const model = JSON.parse(fs.readFileSync(path.join(root, '.schem-it', r.json.run, 'model.json'), 'utf8'));
  assert.deepEqual(countProblems(model.problems), r.json.problems);
});

test('an old model.json without problems still renders', () => {
  const s = scan(copyFixture('plugin'));
  const model = mergeModel(s, { units: {} }, new Map(), { run: 'r1' });
  delete model.problems;
  const md = renderMarkdown(model, buildViews(model));
  assert.doesNotMatch(md, /Problems found/);
  assert.match(md, /\| Name \| Description \| Flowchart \| Problems \|/);
});

// --- markdown --------------------------------------------------------------------------------------------------

test('markdown: a total under the title, a count per index row, a problems table under each unit with its block and source', () => {
  const { model } = problemsFixture({ gaps: [{ kind: 'unbounded-loop', at: 'gone', text: 'Clean-up is retried until it works, with no limit.', source: at(RUNNER, 12, 'clean up') }] });
  const md = renderMarkdown(model, buildViews(model));
  assert.match(md, /Problems found: 10 \(4 warnings, 6 info\)\./);
  assert.match(md, /\| runner \| Runs the build and writes the state\. Use when asked to build\. \| \[open\]\(#prob--runner\) \| 3 warnings, 3 info \|/);
  assert.match(md, /\| worker \| [^|]+ \| \[open\]\([^)]+\) \| 1 warning, 1 info \|/);
  assert.match(md, /## prob › runner\n\n\*\*When it runs:\*\* Runs the build and writes the state\. Use when asked to build\.\n\n\*\*Problems\*\* \(3 warnings, 3 info\)\n\n\| Severity \| Problem \| Block \| Found by \| Source \|/);
  assert.match(md, /\| warning \| \*\*Loop without a limit\*\*: Clean-up is retried until it works, with no limit\. \| Clean up \| analyst \| skills\/runner\/SKILL\.md:12 \|/);
  assert.match(md, /\| warning \| \*\*Read but never produced\*\*: [^|]+ \| plan\.json \| script \| skills\/runner\/SKILL\.md:1 \|/);
  assert.match(md, /\| info \| \*\*No overview\*\*: [^|]+ \| whole unit \| script \|  \|/);
});
