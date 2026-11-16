import fs from 'node:fs';
import path from 'node:path';
import { makeResolver } from './inventory.mjs';
import { slug } from './paths.mjs';
import { readText } from './io.mjs';
import { citeLine } from './scan.mjs';
import { resolveModule, definesFunction, declaresName, isEntryScript, listScriptFiles, langOf } from './codescan.mjs';

// The first analysis round is 1; discover adds units for the rounds after it, up to this one.
export const MAX_ROUND = 5;
// Each sweep unit is one more analyst; scripts past this many are listed in `left`.
export const SWEEP_LIMIT = 30;
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'deno', 'bun', 'tsx', 'ts-node']);
// deno run x.ts, bun run x.ts: the word after the runner is not the script.
const RUNNERS = new Set(['deno', 'bun']);
const PYTHONS = new Set(['python', 'python3', 'py']);
const SCRIPT_EXT_RE = /\.(?:mjs|cjs|js|ts|py|sh|ps1|rb|pl)$/i;
const SUBCOMMAND_RE = /^[a-z][a-z0-9-]*$/;

// The skill-folder placeholder and its quotes say nothing to a reader and push the subcommand out of the block:
// node "<SKILL_DIR>/scripts/ph.mjs" context → node scripts/ph.mjs context.
export function shortCommand(command) {
  return String(command).replace(/(["']?)(?:<SKILL_DIR>|<PLUGIN_ROOT>|\$\{CLAUDE_SKILL_DIR\}|\$\{CLAUDE_PLUGIN_ROOT\})\/([^\s"']*)\1/g, '$2');
}

export function tokenize(command) {
  return (String(command).match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^(["'])(.*)\1$/, '$2'));
}

// node scripts/ph.mjs collect --root x → { script: 'scripts/ph.mjs', file: <resolved or null>, subcommand: 'collect' };
// python -m scripts.run_loop → the module's file; null when the command does not run a script (git log, npx x).
export function parseCommand(command, resolve) {
  const t = tokenize(command);
  let i = 0;
  while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++;
  const exe = path.posix.basename((t[i] ?? '').replace(/\\/g, '/')).replace(/\.exe$/i, '').toLowerCase();
  if (INTERPRETERS.has(exe)) {
    i++;
    if (RUNNERS.has(exe) && t[i] === 'run') i++;
    if (PYTHONS.has(exe) && t[i] === '-m' && t[i + 1]) {
      // A module outside the folder (the standard library, an installed package) is not a script of the skill.
      const file = resolveModule(t[i + 1], resolve);
      if (!file) return null;
      const next = t[i + 2];
      return { script: t[i + 1], file, subcommand: next && SUBCOMMAND_RE.test(next) ? next : null };
    }
    while (t[i]?.startsWith('-')) i++;
  }
  const script = t[i];
  if (!script || !(/[/\\]/.test(script) || SCRIPT_EXT_RE.test(script))) return null;
  const next = t[i + 1];
  return { script, file: resolve(script.replace(/\\/g, '/')), subcommand: next && SUBCOMMAND_RE.test(next) ? next : null };
}

export const scriptKey = (file, subcommand) => `${file}|${subcommand ?? ''}`;
export const stageKey = (file, symbol) => `${file}#${symbol}`;
export const unitKey = (u) => (u.symbol ? stageKey(u.script, u.symbol) : scriptKey(u.script, u.subcommand));

// The unit's own folders first; an agent that runs <SKILL_DIR>/scripts/x.mjs means the plugin's only skill that has it.
export function scriptResolver(scanRes, unit) {
  const own = makeResolver(scanRes.root, unit);
  const skills = scanRes.units.filter((u) => u.kind === 'skill' && u.plugin === unit.plugin);
  // A script's chart may name files from any folder between its own and the plugin's: lib/x.mjs#f in scripts/lib/x.mjs.
  const ups = [];
  if (unit.kind === 'script') {
    for (let d = path.posix.dirname(unit.dir); d !== '.' && d !== unit.pluginDir && unit.dir.startsWith(`${d}/`); d = path.posix.dirname(d)) {
      ups.push(makeResolver(scanRes.root, { ...unit, dir: d }));
    }
  }
  return (p) => {
    const hit = own(p) ?? ups.reduce((h, r) => h ?? r(p), null);
    if (hit) return hit;
    const found = [...new Set(skills.map((s) => makeResolver(scanRes.root, s)(p)).filter(Boolean))];
    return found.length === 1 ? found[0] : null;
  };
}

// "scripts/run_eval.py#run_eval" → { file, symbol, defined }; file is null when the path names nothing in the folder.
// A path copied from the import that brings the function in (../lib/x.mjs) is relative to `fromFile`, the file the block cites.
export function parseStage(target, resolve, root, fromFile) {
  const m = /^\s*([^#\s]+)#([A-Za-z_$][\w$]*)\s*$/.exec(String(target ?? ''));
  if (!m) return null;
  const beside = (p) => {
    const r = path.posix.normalize(path.posix.join(path.posix.dirname(String(fromFile).replace(/\\/g, '/')), p));
    const abs = path.join(root, r);
    return !r.startsWith('../') && r !== '..' && fs.existsSync(abs) && fs.statSync(abs).isFile() ? r : null;
  };
  const file = (fromFile && /^\.\.?\//.test(m[1]) ? resolveModule(m[1], beside) : null) ?? resolveModule(m[1], resolve);
  if (!file) return { file: null, symbol: m[2], defined: false };
  const text = readText(path.join(root, file));
  const defined = definesFunction(text, m[2], langOf(file));
  // A table of functions (COMMANDS[name]) is there but has no flow of its own to draw.
  return { file, symbol: m[2], defined, ...(!defined && declaresName(text, m[2], langOf(file)) ? { value: true } : {}) };
}

// A block runs a script command with `command`, or as a call of kind "command" whose target is the command.
const commandsOf = (n) => [n.command ?? (n.kind === 'subprocess' && n.calls === 'command' ? n.target : null)].filter(Boolean);
const stagesOf = (n) => (n.kind === 'subprocess' && n.calls === 'function'
  ? [n.target, ...(n.targets ?? []).map((t) => (typeof t === 'string' ? t : t.target))].filter((t) => String(t ?? '').includes('#'))
  : []);

// Entry-point scripts in each skill folder; the sweep gives those nothing runs a chart.
function entryScripts(base) {
  const files = [];
  for (const s of base.units.filter((u) => u.kind === 'skill')) {
    for (const f of listScriptFiles(base.root, s.dir)) if (isEntryScript(readText(path.join(base.root, f)), f) && !files.includes(f)) files.push(f);
  }
  return files;
}

function buildUnits(base, found, prevIds, allById) {
  const skills = base.units.filter((u) => u.kind === 'skill');
  const taken = new Set([...base.units.map((u) => u.id), ...prevIds.values()]);
  const units = [];
  const containers = [];
  for (const [key, e] of found) {
    const owner = skills.find((s) => s.dir === '.' || e.file.startsWith(`${s.dir}/`));
    const callerUnit = e.callers[0] && allById.get(e.callers[0].unit);
    const plugin = owner?.plugin ?? callerUnit?.plugin ?? null;
    const pluginDir = owner?.pluginDir ?? callerUnit?.pluginDir ?? '.';
    const pluginNode = plugin && base.containers.some((x) => x.id === `p:${plugin}`) ? `p:${plugin}` : base.rootId;
    const prefix = owner?.id ?? plugin ?? 'root';
    const stem = slug(path.posix.basename(e.file).replace(/\.[^.]+$/, '')) || 'script';
    let id = prevIds.get(key);
    if (!id) {
      const want = e.symbol ? `${prefix}/fn-${stem}-${slug(e.symbol)}` : `${prefix}/run-${stem}${e.subcommand ? `-${e.subcommand}` : ''}`;
      id = want;
      for (let k = 2; taken.has(id); k++) id = `${want}-${k}`;
      taken.add(id);
    }
    const name = path.posix.basename(e.file);
    const label = e.symbol ? `${name} › ${e.symbol}` : `${name}${e.subcommand ? ` ${e.subcommand}` : ''}`;
    const by = [...new Set(e.callers.map((x) => x.unit))];
    const sweep = !by.length;
    const nodeId = `x:${id}`;
    containers.push({
      id: nodeId, parent: owner?.skillNode ?? pluginNode, kind: 'script-command', label,
      description: sweep ? 'Not run by any analysed text or script.' : `Run by ${by.join(', ')}.`, file: e.file, callers: e.callers,
      ...(sweep ? { sweep: true } : {}), source: e.callers[0]?.source ?? citeLine(base.root, path.join(base.root, e.file)),
    });
    units.push({
      id, kind: 'script', skillNode: nodeId, plugin, name: label, script: e.file, subcommand: e.subcommand ?? null,
      ...(e.symbol ? { symbol: e.symbol } : {}), ...(sweep ? { sweep: true } : {}),
      dir: path.posix.dirname(e.file), ...(owner ? { skillDir: owner.dir } : {}), file: e.file, pluginDir, callers: e.callers, wave: 2,
    });
  }
  return { units, containers };
}

// Further analysis rounds: every chart (script charts too) adds the script commands it runs and the stages it calls;
// existing script units keep their ids; when nothing new is called, the sweep adds entry scripts nothing runs, once.
export function discoverUnits(scanRes, model) {
  const prev = scanRes.units.filter((u) => u.kind === 'script');
  const prevIds = new Map(prev.map((u) => [unitKey(u), u.id]));
  const base = {
    ...scanRes,
    units: scanRes.units.filter((u) => u.kind !== 'script'),
    containers: scanRes.containers.filter((c) => c.kind !== 'script-command'),
  };
  const allById = new Map(scanRes.units.map((u) => [u.id, u]));
  const callerOf = new Map(scanRes.units.map((u) => [u.skillNode, u]));
  const found = new Map();
  const skipped = [];
  const skip = (command, reason) => { if (!skipped.some((s) => s.command === command)) skipped.push({ command, reason }); };
  const note = (key, entry, caller, n) => {
    if (!found.has(key)) found.set(key, { ...entry, callers: [] });
    // A script's own chart running that script again (a sweep chart calling its own stage) does not make anything run it.
    if (caller && !(caller.kind === 'script' && unitKey(caller) === key)) found.get(key).callers.push({ unit: caller.id, node: n.id, source: n.source });
  };
  for (const n of model.nodes ?? []) {
    const caller = callerOf.get(n.parent);
    if (!caller || (n.kind !== 'process' && n.kind !== 'subprocess')) continue;
    const resolve = scriptResolver(base, caller);
    for (const command of commandsOf(n)) {
      const c = parseCommand(command, resolve);
      if (!c) continue;
      if (!c.file) { skip(command, `${c.script} is not a file in the analysed folder`); continue; }
      note(scriptKey(c.file, c.subcommand), { file: c.file, subcommand: c.subcommand }, caller, n);
    }
    for (const target of stagesOf(n)) {
      const s = parseStage(target, resolve, base.root, n.source?.file);
      if (!s?.file) { skip(target, `${target} is not a file in the analysed folder`); continue; }
      if (!s.defined) { skip(target, s.value ? `${s.symbol} in ${s.file} is a value, not a function, so it has no flowchart` : `${s.file} does not define ${s.symbol}`); continue; }
      note(stageKey(s.file, s.symbol), { file: s.file, symbol: s.symbol }, caller, n);
    }
  }
  let overflow = [];
  const addSweep = () => {
    const covered = new Set([...found.values()].filter((e) => !e.symbol && e.callers.length).map((e) => e.file));
    const unrun = entryScripts(base).filter((f) => !covered.has(f));
    for (const f of unrun.slice(0, SWEEP_LIMIT)) note(scriptKey(f, null), { file: f, subcommand: null });
    overflow = unrun.slice(SWEEP_LIMIT).map((f) => ({ kind: 'sweep', target: f, caller: null }));
  };
  let sweepDone = Boolean(scanRes.sweepDone);
  if (sweepDone) addSweep();
  let built = buildUnits(base, found, prevIds, allById);
  let fresh = built.units.filter((u) => !prevIds.has(unitKey(u)));
  if (!fresh.length && !sweepDone) {
    sweepDone = true;
    addSweep();
    built = buildUnits(base, found, prevIds, allById);
    fresh = built.units.filter((u) => !prevIds.has(unitKey(u)));
  }
  const round = scanRes.round ?? 1;
  if (fresh.length && round >= MAX_ROUND) {
    const drop = new Set(fresh.map((u) => u.id));
    const left = fresh.map((u) => ({ kind: u.symbol ? 'stage' : u.sweep ? 'sweep' : 'command', target: u.symbol ? stageKey(u.script, u.symbol) : u.name, caller: u.callers[0]?.unit ?? null }));
    return {
      scan: { ...base, units: [...base.units, ...built.units.filter((u) => !drop.has(u.id))], containers: [...base.containers, ...built.containers.filter((c) => !drop.has(c.id.slice(2)))], round, sweepDone },
      units: [], skipped, round, capped: true, left: [...left, ...overflow],
    };
  }
  const next = fresh.length ? round + 1 : round;
  return {
    scan: { ...base, units: [...base.units, ...built.units], containers: [...base.containers, ...built.containers], round: next, sweepDone },
    units: fresh, skipped, round: next, capped: false, left: overflow,
  };
}
