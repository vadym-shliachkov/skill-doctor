import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../../skills/schem-it/scripts/commands.mjs';
import { parseFrontmatter } from '../../skills/schem-it/scripts/lib/frontmatter.mjs';

const skill = fs.readFileSync(fileURLToPath(new URL('../../skills/schem-it/SKILL.md', import.meta.url)), 'utf8');

test('SKILL.md frontmatter names the skill and describes when to use it', () => {
  const { data, error } = parseFrontmatter(skill);
  assert.equal(error, null);
  assert.equal(data.name, 'schem-it');
  assert.match(data.description, /block diagram/);
  assert.match(data['argument-hint'], /--mermaid/);
});

test('every SI command SKILL.md uses exists, and every command is used', () => {
  const used = new Set([...skill.matchAll(/`SI ([a-z-]+)/g)].map((m) => m[1]));
  for (const c of used) assert.ok(COMMANDS[c], `SKILL.md uses unknown command ${c}`);
  for (const c of ['scan', 'inventory', 'context', 'save-unit', 'validate', 'merge', 'discover', 'render']) assert.ok(used.has(c), `SKILL.md never uses ${c}`);
});

test('SKILL.md covers subagent dispatch on both hosts and the FigJam tool', () => {
  assert.match(skill, /skill-doctor:block-analyst/);
  assert.match(skill, /spawn_agent/);
  assert.match(skill, /--mode sequential/);
  assert.match(skill, /generate_diagram/);
});

test('SKILL.md repeats discover rounds until nothing is new and reports what the cap left', () => {
  assert.match(skill, /`SI discover --root "<ROOT>" --run <run>`/);
  assert.match(skill, /\*\*Further rounds\.\*\*/);
  assert.match(skill, /repeat this step/);
  assert.match(skill, /`capped`/);
  assert.match(skill, /not run by anything/);
});

test('SKILL.md describes agent prompts as every .md file in a skill agents/ folder', () => {
  assert.match(skill, /every `\.md` file in a skill's `agents\/` folder/);
});
