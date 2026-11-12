import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const SI = fileURLToPath(new URL('../skills/schem-it/scripts/si.mjs', import.meta.url));

export function tmpDir(prefix = 'schem it ~') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function copyFixture(name) {
  const dest = path.join(tmpDir(), name);
  fs.cpSync(path.join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

export function runSi(args, { input } = {}) {
  const r = spawnSync(process.execPath, [SI, ...args], { input, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
