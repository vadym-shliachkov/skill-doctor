import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { splitRow, parseTable, parseList } from '../../skills/schem-it/scripts/lib/markdown.mjs';
import { schemaFields } from '../../skills/schem-it/scripts/lib/fields.mjs';
import { FIXTURES } from '../helpers.mjs';

test('splitRow keeps escaped pipes and pipes inside backticks in their cell', () => {
  assert.deepEqual(splitRow('| a | b \\| c | `x | y` |'), ['a', 'b | c', '`x | y`']);
});

test('parseTable reads header and rows, strips code and bold marks, ignores blank lines around the table', () => {
  const t = parseTable(['', '| Rule | Default severity | What to check |', '|---|:---:|---|', '| `seo.title` | **high** | Pages without a title. |', '| `seo.pipe` | low | An escaped \\| pipe. |', '']);
  assert.deepEqual(t.columns, ['Rule', 'Default severity', 'What to check']);
  assert.deepEqual(t.rows, [['seo.title', 'high', 'Pages without a title.'], ['seo.pipe', 'low', 'An escaped | pipe.']]);
});

test('parseTable rejects text that is not a table', () => {
  assert.equal(parseTable(['| a | b |', '| 1 | 2 |']), null);
  assert.equal(parseTable(['Just text', '|---|', '| 1 |']), null);
  assert.equal(parseTable(['| a |', '|---|']), null);
  assert.equal(parseTable(['| a |', '|---|', '| 1 |', 'trailing prose']), null);
});

test('parseList reads bullets, numbers, nesting and continuation lines; rejects prose', () => {
  assert.deepEqual(parseList(['- `seo.sitemapUrl`: sitemap location.', '  - nested', '    continued', '', '2. second']).items, [
    { text: 'seo.sitemapUrl: sitemap location.', depth: 0 },
    { text: 'nested continued', depth: 1 },
    { text: 'second', depth: 0 },
  ]);
  assert.equal(parseList(['Not a list']), null);
  assert.equal(parseList(['']), null);
});

test('schemaFields lists properties two levels deep with type, required, values and description', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'deep/skills/audit/references/finding.schema.json'), 'utf8'));
  assert.deepEqual(schemaFields(schema), [
    { name: 'rule', type: 'string', required: true, holds: 'Rule key, area.name', depth: 0 },
    { name: 'severity', type: 'string', required: true, values: ['critical', 'high', 'medium', 'low'], depth: 0 },
    { name: 'evidence', type: 'object[]', required: true, depth: 0 },
    { name: 'evidence[].type', type: 'string', required: true, values: ['file', 'url'], depth: 1 },
    { name: 'evidence[].ref', type: 'string', required: false, depth: 1 },
  ]);
  assert.deepEqual(schemaFields({ type: 'array', items: { properties: { id: { type: 'string' } } } }), [{ name: 'id', type: 'string', required: false, depth: 0 }]);
  assert.deepEqual(schemaFields({ type: 'string' }), []);
});

test('parseTable accepts short separators, alignment colons and tables without outer pipes', () => {
  assert.deepEqual(parseTable(['|a|b|', '|-|-|', '|1|2|']).rows, [['1', '2']]);
  assert.deepEqual(parseTable(['| a | b |', '|:--|--:|', '| 1 | 2 |']).rows, [['1', '2']]);
  assert.deepEqual(parseTable(['a | b', '---|---', '1 | 2']), { columns: ['a', 'b'], rows: [['1', '2']] });
});
