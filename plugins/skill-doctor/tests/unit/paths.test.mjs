import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { toPosix, absRoot, rel, isInside, runDir, newRunId, resolveRun, unitFile, outDir } from '../../skills/schem-it/scripts/lib/paths.mjs';
import { tmpDir } from '../helpers.mjs';

test('toPosix and rel use forward slashes', () => {
  assert.equal(toPosix('a\\b\\c'), 'a/b/c');
  const root = absRoot(tmpDir());
  assert.equal(rel(root, path.join(root, 'x', 'y.md')), 'x/y.md');
  assert.equal(rel(root, root), '.');
  assert.equal(absRoot(root).includes('\\'), false);
});

test('isInside rejects paths that escape the root', () => {
  const root = absRoot(tmpDir());
  assert.equal(isInside(root, path.join(root, 'a.md')), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, path.join(root, '..', 'other.md')), false);
});

test('newRunId is time based and avoids collisions', () => {
  const root = tmpDir();
  const now = new Date('2026-10-12T09:30:00Z');
  const a = newRunId(root, now);
  assert.equal(a, '2026-10-12T09-30-00');
  fs.mkdirSync(runDir(root, a), { recursive: true });
  assert.equal(newRunId(root, now), '2026-10-12T09-30-00-2');
});

test('resolveRun uses the given run or latest.json', () => {
  const root = tmpDir();
  assert.throws(() => resolveRun(root), /No runs/);
  fs.mkdirSync(runDir(root, 'r1'), { recursive: true });
  fs.writeFileSync(path.join(outDir(root), 'latest.json'), '{"run":"r1"}');
  assert.equal(resolveRun(root), 'r1');
  assert.equal(resolveRun(root, 'r1'), 'r1');
  assert.throws(() => resolveRun(root, 'nope'), /Run not found/);
});

test('unitFile flattens unit ids', () => {
  assert.equal(toPosix(unitFile('/r', 'run', 'p/s')).endsWith('.schem-it/run/units/p__s.json'), true);
});
