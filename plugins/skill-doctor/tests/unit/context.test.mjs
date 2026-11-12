import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BLOCK_KINDS, EDGE_KINDS } from '../../skills/schem-it/scripts/lib/validate.mjs';
import { copyFixture, runSi } from '../helpers.mjs';

const read = (p) => fs.readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

test('block-types.md documents every block and edge kind', () => {
  const doc = read('../../skills/schem-it/references/block-types.md');
  for (const k of [...BLOCK_KINDS, ...EDGE_KINDS]) assert.match(doc, new RegExp(`\`${k}\``), `block-types.md is missing ${k}`);
});

test('block-analyst agent can write its draft, nothing else, and points at the context command', () => {
  const agent = read('../../agents/block-analyst.md');
  assert.match(agent, /^name: block-analyst$/m);
  // The save command reads a draft file: the agent needs a file-writing tool, and its rules must allow that one file.
  assert.match(agent, /^tools: Read, Write, Grep, Glob, Bash$/m);
  assert.match(agent, /Use Write only for that one draft file/);
  assert.match(agent, /si\.mjs context/);
});

test('context prints instructions, facts, schema and save command', () => {
  const root = copyFixture('plugin');
  runSi(['scan', '--root', root]);
  runSi(['inventory', '--root', root]);
  const r = runSi(['context', '--root', root, '--unit', 'demo/alpha', '--save']);
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /^# schem-it analyst task: demo\/alpha/);
  assert.doesNotMatch(out, /\{\{(UNIT|SKILL_FILE|ROOT)\}\}/);
  assert.match(out, /skills\/alpha\/SKILL\.md/);
  assert.match(out, /\| f\d+ \| dispatch \| demo:checker \|/);
  assert.match(out, /\| f\d+ \| skill \| \/demo:beta → s:demo\/beta \|/);
  assert.match(out, /"\$comment": "One unit's flowchart/);
  assert.match(out, /save-unit --root '.*' --run '\S+' --unit 'demo\/alpha' --file '[^']*\/\.schem-it\/[^']+\/drafts\/demo-alpha\.json'/);
  // No redirect: PowerShell has no `<`.
  assert.doesNotMatch(out, /save-unit [^\n]*</);
  assert.doesNotMatch(out, /SCHEMIT_JSON/);
  const noSave = runSi(['context', '--root', root, '--unit', 'demo/alpha']).stdout;
  assert.match(noSave, /Reply with the JSON object only/);
  assert.doesNotMatch(noSave, /save-unit/);
});
