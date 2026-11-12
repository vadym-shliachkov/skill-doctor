import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSi, tmpDir } from '../helpers.mjs';

test('unknown command prints usage and exits 2', () => {
  const r = runSi(['nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Usage: si </);
});

test('latest reports a clear error when there are no runs', () => {
  const r = runSi(['latest', '--root', tmpDir()]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /schem-it: No runs/);
});
