import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readText, splitLines, readJson, writeJson, parseLooseJson } from '../../skills/schem-it/scripts/lib/io.mjs';
import { tmpDir } from '../helpers.mjs';

test('readText strips a BOM and splitLines handles CRLF, CR and LF', () => {
  const f = path.join(tmpDir(), 'a.md');
  fs.writeFileSync(f, '\uFEFFone\r\ntwo\rthree\nfour');
  const text = readText(f);
  assert.equal(text.startsWith('one'), true);
  assert.deepEqual(splitLines(text), ['one', 'two', 'three', 'four']);
});

test('readJson returns the fallback for a missing file and throws without one', () => {
  const f = path.join(tmpDir(), 'missing.json');
  assert.deepEqual(readJson(f, { a: 1 }), { a: 1 });
  assert.throws(() => readJson(f), /File not found/);
});

test('writeJson creates folders and round-trips', () => {
  const f = path.join(tmpDir(), 'x', 'y', 'z.json');
  writeJson(f, { ok: true });
  assert.deepEqual(readJson(f), { ok: true });
});

test('parseLooseJson accepts plain JSON, fenced JSON and JSON inside prose', () => {
  assert.deepEqual(parseLooseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLooseJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseLooseJson('Here is the result: {"a":"x } y"} — done'), { a: 'x } y' });
  assert.throws(() => parseLooseJson('no json here'), /No JSON object found/);
});
