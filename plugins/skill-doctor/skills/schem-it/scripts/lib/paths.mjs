import fs from 'node:fs';
import path from 'node:path';

export const OUT_DIR = '.schem-it';

export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

export function absRoot(root) {
  return toPosix(path.resolve(root ?? process.cwd()));
}

export function rel(root, abs) {
  return toPosix(path.relative(root, abs)) || '.';
}

export function isInside(root, abs) {
  const r = path.relative(root, abs);
  return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
}

// Ids come from analysed files, which are untrusted: keep them to characters that are safe in paths and shell arguments.
export function slug(s) {
  return String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

// The analysed folder is untrusted: it could ship .schem-it, or a file in it, as a link to somewhere else.
export function refuseLink(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return p; }
  if (st.isSymbolicLink()) throw new Error(`Refusing to write through a symbolic link: ${toPosix(p)}`);
  return p;
}

export function outDir(root) {
  return refuseLink(path.join(root, OUT_DIR));
}

export function runDir(root, run) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(run))) throw new Error(`Invalid run id: ${run}`);
  return refuseLink(path.join(outDir(root), run));
}

export function newRunId(root, now = new Date()) {
  const base = now.toISOString().slice(0, 19).replace(/:/g, '-');
  let id = base;
  for (let n = 2; fs.existsSync(runDir(root, id)); n++) id = `${base}-${n}`;
  return id;
}

export function resolveRun(root, run) {
  if (run) {
    if (!fs.existsSync(runDir(root, run))) throw new Error(`Run not found: ${run}`);
    return run;
  }
  const latest = path.join(outDir(root), 'latest.json');
  if (!fs.existsSync(latest)) throw new Error(`No runs in ${toPosix(outDir(root))}; run "si scan" first`);
  const id = JSON.parse(fs.readFileSync(refuseLink(latest), 'utf8')).run;
  runDir(root, id);
  return id;
}

export function unitFile(root, run, unitId, folder = 'units') {
  const dir = path.join(runDir(root, run), folder);
  const file = path.join(dir, `${encodeURIComponent(unitId.replace(/[/:]/g, '__'))}.json`);
  if (!isInside(dir, file) || path.dirname(file) !== dir) throw new Error(`Unsafe unit id: ${unitId}`);
  return file;
}

export function overviewFile(root, run, unitId) {
  return unitFile(root, run, unitId, 'overviews');
}
