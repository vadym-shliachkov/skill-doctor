#!/usr/bin/env node
// Usage: node snapshot.mjs <target-dir> <dest-dir>       copy the target and write <dest>/manifest.json
//        node snapshot.mjs --diff <dest-dir> <target-dir> list what changed since the snapshot
// Used by the fix loop: a snapshot before each fix round gives the diff for the
// regression round and a way back. Skips .git, node_modules, __pycache__ and .skill-qa.
// It reads the target and writes only into <dest-dir>.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.skill-qa']);
const fail = (error) => { console.log(JSON.stringify({ ok: false, error }, null, 2)); process.exit(1); };

const walk = (root, dir = root, files = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    // Symlinks and junctions are recorded as links (not followed), so a link added or re-pointed shows in --diff.
    if (e.isSymbolicLink()) files.push(relative(root, p).split(sep).join('/'));
    else if (e.isDirectory()) walk(root, p, files);
    else if (e.isFile()) files.push(relative(root, p).split(sep).join('/'));
  }
  return files;
};
const isLink = (p) => { try { return readlinkSync(p) !== undefined; } catch { return false; } };
const digest = (root, f) => {
  const p = join(root, f);
  if (isLink(p)) return `link:${readlinkSync(p)}`;
  return createHash('sha256').update(readFileSync(p)).digest('hex');
};
const hashes = (root) => Object.fromEntries(walk(root).sort().map((f) => [f, digest(root, f)]));
// Windows paths are case-insensitive.
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

const args = process.argv.slice(2);
if (args[0] === '--diff') {
  const [dest, target] = args.slice(1).map((a) => a && resolve(a));
  if (!dest || !target) fail('usage: node snapshot.mjs --diff <dest-dir> <target-dir>');
  if (!existsSync(join(dest, 'manifest.json'))) fail(`no manifest.json in ${dest}`);
  const before = JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')).files;
  const now = hashes(target);
  const added = Object.keys(now).filter((f) => !(f in before));
  const removed = Object.keys(before).filter((f) => !(f in now));
  const changed = Object.keys(now).filter((f) => f in before && before[f] !== now[f]);
  console.log(JSON.stringify({ ok: true, snapshot: join(dest, 'files'), target, added, removed, changed, unchanged: Object.keys(now).length - added.length - changed.length }, null, 2));
} else {
  const [target, dest] = args.map((a) => a && resolve(a));
  if (!target || !dest) fail('usage: node snapshot.mjs <target-dir> <dest-dir>');
  if (!existsSync(target) || !statSync(target).isDirectory()) fail(`not a folder: ${target}`);
  if (norm(dest).startsWith(norm(target) + sep) && !relative(target, dest).split(sep).some((p) => SKIP.has(p))) fail('the snapshot folder is inside the target; put it in the run folder');
  const files = hashes(target);
  mkdirSync(join(dest, 'files'), { recursive: true });
  for (const f of Object.keys(files)) if (!files[f].startsWith('link:')) cpSync(join(target, f), join(dest, 'files', f));
  writeFileSync(join(dest, 'manifest.json'), JSON.stringify({ target, taken: new Date().toISOString(), files }, null, 2));
  console.log(JSON.stringify({ ok: true, target, snapshot: join(dest, 'files'), files: Object.keys(files).length }, null, 2));
}
