import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../../skills/schem-it/scripts/lib/frontmatter.mjs';

test('parses scalars, quoted values, lists and nested maps', () => {
  const text = [
    '---',
    'name: shop-site',
    'description: "Use when: you need a site"',
    "argument-hint: '[analyse|report]'",
    'version: 1.13.9',
    'accepts_arguments: true',
    'dependencies:',
    '  hard: []',
    '  soft:',
    '    - shop-pre-design',
    '    - shop-design',
    'reads:',
    '- site-instruction.md',
    'tags: [a, b]',
    '---',
    '# Body',
  ].join('\n');
  const { data, endLine, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.equal(endLine, 15);
  assert.equal(data.name, 'shop-site');
  assert.equal(data.description, 'Use when: you need a site');
  assert.equal(data['argument-hint'], '[analyse|report]');
  assert.equal(data.version, '1.13.9');
  assert.equal(data.accepts_arguments, true);
  assert.deepEqual(data.dependencies, { hard: [], soft: ['shop-pre-design', 'shop-design'] });
  assert.deepEqual(data.reads, ['site-instruction.md']);
  assert.deepEqual(data.tags, ['a', 'b']);
});

test('parses block scalars and multi-line plain scalars', () => {
  const text = '---\nname: x\ndescription: >\n  folded line one\n  line two\nnotes: |\n  keep\n  lines\nsummary: starts here\n  and continues\n---\n';
  const { data, error } = parseFrontmatter(text);
  assert.equal(error, null);
  assert.equal(data.description, 'folded line one line two');
  assert.equal(data.notes, 'keep\nlines');
  assert.equal(data.summary, 'starts here and continues');
});

test('handles CRLF and a BOM', () => {
  const { data, endLine } = parseFrontmatter('\uFEFF---\r\nname: crlf\r\n---\r\nbody');
  assert.equal(data.name, 'crlf');
  assert.equal(endLine, 3);
});

test('no frontmatter gives empty data', () => {
  assert.deepEqual(parseFrontmatter('# Title\ntext'), { data: {}, endLine: 0, error: null });
});

test('unclosed or malformed frontmatter reports an error', () => {
  assert.match(parseFrontmatter('---\nname: x\n').error, /no closing ---/);
  const bad = parseFrontmatter('---\nname: x\n   oops: y\n  : z\n---\n');
  assert.deepEqual(bad.data, {});
  assert.match(bad.error, /^Frontmatter: /);
});

test('list items that are maps', () => {
  const { data } = parseFrontmatter('---\nitems:\n  - name: a\n    kind: b\n  - name: c\n---\n');
  assert.deepEqual(data.items, [{ name: 'a', kind: 'b' }, { name: 'c' }]);
});
