import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readText, writeJson, writeText, parseLooseJson, readStdin } from './lib/io.mjs';
import { absRoot, outDir, runDir, newRunId, resolveRun, unitFile, overviewFile, toPosix, refuseLink } from './lib/paths.mjs';
import { scan } from './lib/scan.mjs';
import { inventoryAll, inventoryUnit, knownSkills, makeResolver } from './lib/inventory.mjs';
import { discoverUnits } from './lib/discover.mjs';
import { scanCode } from './lib/codescan.mjs';
import { validateFragment, validateOverview } from './lib/validate.mjs';
import { buildContext, buildOverviewContext } from './lib/context.mjs';
import { mergeModel, MODEL_VERSION } from './lib/merge.mjs';
import { OVERVIEW_KINDS, countProblems } from './lib/problems.mjs';
import { buildViews } from './lib/views.mjs';
import { renderMarkdown } from './lib/render-mermaid.mjs';
import { figjamDiagrams } from './lib/figjam.mjs';
import { renderHtml } from './lib/render-html.mjs';

const SI_PATH = toPosix(fileURLToPath(new URL('./si.mjs', import.meta.url)));
const FORMATS = ['html', 'mermaid', 'figjam'];
const RENDERERS = { html: renderHtml };

const loadScan = (root, run) => readJson(path.join(runDir(root, run), 'scan.json'));
const loadInventory = (root, run) => readJson(path.join(runDir(root, run), 'inventory.json'), { units: {} });

// A unit's saved detailed result when it is valid: what its overview is checked against.
function detailedOf(root, run, u, inventory) {
  const file = unitFile(root, run, u.id);
  if (!fs.existsSync(file)) return null;
  const frag = readJson(file);
  return validateFragment(root, u.id, frag, inventory.units[u.id], { resolve: makeResolver(root, u) }).ok ? frag : null;
}

function requireDetailed(root, run, u) {
  if (!OVERVIEW_KINDS.has(u.kind)) throw new Error(`Unit ${u.id} is a script and gets no overview`);
  const detailed = detailedOf(root, run, u, loadInventory(root, run));
  if (!detailed) throw new Error(`Unit ${u.id} has no valid detailed result to make an overview from`);
  return detailed;
}

function requireUnit(scanRes, unit) {
  if (!unit) throw new Error('--unit is required');
  const u = scanRes.units.find((x) => x.id === unit);
  if (!u) throw new Error(`Unknown unit "${unit}". Units: ${scanRes.units.map((x) => x.id).join(', ')}`);
  return u;
}

export const COMMANDS = {
  async scan(v) {
    const root = absRoot(v.root);
    const res = scan(root, { only: v.only });
    const run = newRunId(root);
    writeJson(path.join(runDir(root, run), 'scan.json'), { run, ...res });
    writeJson(refuseLink(path.join(outDir(root), 'latest.json')), { run });
    // Keep runs out of the user's commits: they hold absolute paths and quotes from the analysed files.
    const ignore = refuseLink(path.join(outDir(root), '.gitignore'));
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
    const unitCount = (k) => res.units.filter((u) => u.kind === k).length;
    const count = (k) => res.containers.filter((c) => c.kind === k).length;
    return {
      ok: true,
      run,
      level: res.level,
      rootId: res.rootId,
      units: res.units.map((u) => u.id),
      counts: { units: { skills: unitCount('skill'), commands: unitCount('command'), agents: unitCount('agent'), prompts: unitCount('prompt') }, plugins: count('plugin'), skills: count('skill'), agents: count('agent-def'), prompts: count('agent-prompt'), hooks: count('hook'), commands: count('command') },
      warnings: res.warnings,
    };
  },

  async inventory(v) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const units = inventoryAll(loadScan(root, run));
    writeJson(path.join(runDir(root, run), 'inventory.json'), { run, units });
    const all = Object.values(units);
    return {
      ok: true,
      run,
      units: all.length,
      facts: all.reduce((s, u) => s + u.facts.length, 0),
      missing: all.flatMap((u) => u.facts.filter((f) => f.missing && !f.negated).map((f) => ({ unit: u.unit, ref: f.path ?? f.target }))),
      warnings: all.flatMap((u) => u.warnings.map((w) => `${u.unit}: ${w}`)),
    };
  },

  async context(v) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const scanRes = loadScan(root, run);
    const u = requireUnit(scanRes, v.unit);
    if (v.save) fs.mkdirSync(path.join(runDir(root, run), 'drafts'), { recursive: true });
    if (v.overview) return buildOverviewContext({ root, run, unit: u, detailed: requireDetailed(root, run, u), save: Boolean(v.save), siPath: SI_PATH });
    const hints = u.kind === 'script' ? scanCode(root, u.file) : [];
    return buildContext({ root, run, unit: u, inventory: loadInventory(root, run).units[u.id], units: scanRes.units, hints, save: Boolean(v.save), siPath: SI_PATH });
  },

  async 'save-unit'(v, io = {}) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const u = requireUnit(loadScan(root, run), v.unit);
    // --file reads the draft an analyst wrote; standard input is for a host that pipes the reply.
    if (v.file != null && !fs.existsSync(v.file)) return { ok: false, unit: u.id, errors: [{ path: '$', message: `No file at ${v.file}: write your JSON there first` }] };
    const text = io.stdin ?? (v.file != null ? readText(v.file) : await readStdin());
    let fragment;
    try {
      fragment = parseLooseJson(text);
    } catch {
      return { ok: false, unit: u.id, errors: [{ path: '$', message: 'No JSON object found in the input' }] };
    }
    if (v.overview) {
      const res = validateOverview(u.id, fragment, requireDetailed(root, run, u));
      if (!res.ok) return { ok: false, unit: u.id, errors: res.errors };
      writeJson(overviewFile(root, run, u.id), fragment);
      return { ok: true, unit: u.id, overview: true, nodes: fragment.nodes.length, edges: fragment.edges.length };
    }
    const res = validateFragment(root, u.id, fragment, loadInventory(root, run).units[u.id], { resolve: makeResolver(root, u) });
    if (!res.ok) return { ok: false, unit: u.id, errors: res.errors };
    writeJson(unitFile(root, run, u.id), fragment);
    return { ok: true, unit: u.id, nodes: fragment.nodes.length, edges: fragment.edges.length };
  },

  async validate(v) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const u = requireUnit(loadScan(root, run), v.unit);
    if (v.overview) {
      const file = overviewFile(root, run, u.id);
      if (!fs.existsSync(file)) return { ok: false, unit: u.id, errors: [{ path: '$', message: `No saved overview for unit ${u.id}` }] };
      const res = validateOverview(u.id, readJson(file), requireDetailed(root, run, u));
      return { ok: res.ok, unit: u.id, errors: res.errors };
    }
    const file = unitFile(root, run, u.id);
    if (!fs.existsSync(file)) return { ok: false, unit: u.id, errors: [{ path: '$', message: `No saved result for unit ${u.id}` }] };
    const res = validateFragment(root, u.id, readJson(file), loadInventory(root, run).units[u.id], { resolve: makeResolver(root, u) });
    return { ok: res.ok, unit: u.id, errors: res.errors };
  },

  async merge(v) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const scanRes = loadScan(root, run);
    const inventory = loadInventory(root, run);
    const fragments = new Map();
    const overviews = new Map();
    for (const u of scanRes.units) {
      const frag = detailedOf(root, run, u, inventory);
      if (!frag) continue;
      fragments.set(u.id, frag);
      const file = overviewFile(root, run, u.id);
      if (!OVERVIEW_KINDS.has(u.kind) || !fs.existsSync(file)) continue;
      const ov = readJson(file);
      if (validateOverview(u.id, ov, frag).ok) overviews.set(u.id, ov);
    }
    const model = mergeModel(scanRes, inventory, fragments, { run, mode: v.mode ?? 'parallel', overviews });
    writeJson(path.join(runDir(root, run), 'model.json'), model);
    return {
      ok: true,
      run,
      nodes: model.nodes.length,
      edges: model.edges.length,
      failed: scanRes.units.filter((u) => !fragments.has(u.id)).map((u) => u.skillNode),
      missing: [
        ...model.nodes.filter((n) => n.missing && !n.layer).map((n) => ({ id: n.id, label: n.label })),
        ...model.nodes.flatMap((n) => (n.loadsMissing ?? []).map((p) => ({ id: n.id, label: p }))),
      ],
      unresolved: model.nodes.filter((n) => n.unresolved).map((n) => ({ id: n.id, label: n.label })),
      overviews: overviews.size,
      noOverview: scanRes.units.filter((u) => OVERVIEW_KINDS.has(u.kind) && fragments.has(u.id) && !overviews.has(u.id)).map((u) => u.id),
      problems: countProblems(model.problems),
    };
  },

  async overviews(v) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const scanRes = loadScan(root, run);
    const inventory = loadInventory(root, run);
    const units = scanRes.units.filter((u) => OVERVIEW_KINDS.has(u.kind) && detailedOf(root, run, u, inventory));
    return { ok: true, run, units: units.map((u) => u.id) };
  },

  async discover(v) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const dir = runDir(root, run);
    const modelFile = path.join(dir, 'model.json');
    if (!fs.existsSync(modelFile)) throw new Error(`No model for run ${run}; run "si merge" after the first analysis round`);
    const res = discoverUnits(loadScan(root, run), readJson(modelFile));
    // What the round limit left undrawn is reported by merge as a problem.
    writeJson(path.join(dir, 'scan.json'), { ...res.scan, left: res.left });
    const inventory = loadInventory(root, run);
    const ids = new Set(res.scan.units.map((u) => u.id));
    for (const id of Object.keys(inventory.units)) if (!ids.has(id)) delete inventory.units[id];
    const known = knownSkills(res.scan);
    for (const u of res.units) inventory.units[u.id] = inventoryUnit(res.scan, u, known);
    writeJson(path.join(dir, 'inventory.json'), { run, units: inventory.units });
    return { ok: true, run, round: res.round, units: res.units.map((u) => u.id), skipped: res.skipped, capped: res.capped, left: res.left };
  },

  async render(v) {
    const root = absRoot(v.root);
    const run = resolveRun(root, v.run);
    const dir = runDir(root, run);
    const modelFile = path.join(dir, 'model.json');
    if (!fs.existsSync(modelFile)) throw new Error(`No model for run ${run}; run "si merge" first`);
    const formats = (v.format ?? 'html').split(',').map((s) => s.trim()).filter(Boolean);
    for (const f of formats) if (!FORMATS.includes(f)) throw new Error(`Unknown format "${f}"; use html, mermaid or figjam`);
    const model = readJson(modelFile);
    if (model.version !== MODEL_VERSION) throw new Error(`Run ${run} was made by an older schem-it; analyse again (run the skill without --run)`);
    const views = buildViews(model);
    const files = [];
    let figjam;
    if (formats.includes('html') && RENDERERS.html) {
      writeText(path.join(dir, 'schem.html'), RENDERERS.html(model, views));
      files.push(path.join(dir, 'schem.html'));
    }
    if (formats.includes('mermaid')) {
      writeText(path.join(dir, 'schem.md'), renderMarkdown(model, views));
      files.push(path.join(dir, 'schem.md'));
    }
    if (formats.includes('figjam')) {
      const diagrams = figjamDiagrams(model, views);
      for (const d of diagrams) writeText(path.join(dir, d.file), d.mermaid);
      writeJson(path.join(dir, 'figjam', 'index.json'), diagrams.map(({ view, name, file }) => ({ view, name, file })));
      figjam = diagrams.map(({ name, file }) => ({ name, file: toPosix(path.join(dir, file)) }));
    }
    return { ok: true, run, files: files.map(toPosix), ...(figjam ? { figjam } : {}) };
  },

  async latest(v) {
    return { run: resolveRun(absRoot(v.root)) };
  },
};
