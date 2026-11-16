import path from 'node:path';
import { knownSkills, makeResolver } from './inventory.mjs';
import { slug } from './paths.mjs';
import { readText, splitLines } from './io.mjs';
import { parseTable, parseList } from './markdown.mjs';
import { schemaFields } from './fields.mjs';
import { parseCommand, parseStage, scriptKey, stageKey, scriptResolver, shortCommand } from './discover.mjs';
import { computeProblems, normPath } from './problems.mjs';

export { shortCommand };
export const MODEL_VERSION = 3;
const base = (p) => path.posix.basename(p);

// A callee named by its file (agents/backlog.md, <SKILL_DIR>/agents/x.md): the analysed unit with that file, else the
// only unit of the plugin with that file name. A file that exists without a flowchart is neither missing nor out of scope.
function resolveFileTarget(target, unit, known) {
  const t = String(target).trim();
  if (!/\.md$/i.test(t) || /\s/.test(t)) return null;
  const file = makeResolver(known.root, unit)(t);
  const hit = file && known.byFile.get(file);
  if (hit) return { id: hit.id };
  const same = [...known.byFile].filter(([f, u]) => base(f) === base(t) && u.plugin === unit.plugin);
  if (same.length === 1) return { id: same[0][1].id };
  return file ? { file } : { missing: true };
}

export function resolveSkillTarget(target, unit, known) {
  const byFile = resolveFileTarget(target, unit, known);
  if (byFile) return byFile;
  const t = String(target).trim().replace(/^\//, '');
  if (t.includes(':')) {
    const [plugin, name] = t.split(':');
    const id = known.byQualified.get(`${plugin}:${name}`);
    if (id) return { id };
    return known.plugins.has(plugin) ? { missing: true } : { outOfScope: true };
  }
  const ids = known.byName.get(t) ?? [];
  const own = ids.find((id) => unit.plugin && id.slice(2).startsWith(`${unit.plugin}/`));
  if (own) return { id: own };
  if (ids.length === 1) return { id: ids[0] };
  // Text with spaces is a description of the callee ("lens analyst subagents"), not a name that could be looked up.
  return /\s/.test(t) ? { unresolved: true } : { outOfScope: true };
}

export function resolveAgentTarget(target, unit, known) {
  const byFile = resolveFileTarget(target, unit, known);
  if (byFile) return byFile;
  const t = String(target).trim().replace(/^\//, '');
  const qualified = t.includes(':');
  const [plugin, name] = qualified ? t.split(':') : [unit.plugin, t];
  if (plugin && known.agents.has(`${plugin}:${slug(name)}`)) return { id: `a:${plugin}/${slug(name)}` };
  const alias = plugin && known.agentAliases?.get(`${plugin}:${slug(name)}`);
  if (alias) return { id: alias };
  // An unqualified name not defined in this plugin is usually a built-in or user-level agent such as general-purpose.
  if (!qualified && /\s/.test(t)) return { unresolved: true };
  return qualified && known.plugins.has(plugin) ? { missing: true } : { outOfScope: true };
}

function factToBlock(f) {
  switch (f.kind) {
    case 'file': return f.role === 'script' ? { kind: 'process', label: `Run ${base(f.path)}`, command: f.path } : null;
    case 'skill': return { kind: 'subprocess', label: f.mention.replace(/^\//, ''), target: f.mention, calls: 'skill' };
    case 'dispatch': return f.agentType && f.agentType !== 'spawn_agent' ? { kind: 'subprocess', label: f.agentType, target: f.agentType, calls: 'agent' } : null;
    default: return null;
  }
}

export function fallbackFragment(unit, inventory, unitSource) {
  const blocks = [];
  const seen = new Set();
  const facts = (inventory?.facts ?? []).filter((f) => !f.negated).sort((a, b) => a.source.lines[0] - b.source.lines[0]);
  for (const f of facts) {
    const spec = factToBlock(f);
    if (!spec) continue;
    const key = `${spec.kind}|${spec.command ?? spec.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ id: f.id, ...spec, role: 'Mentioned in the text (found by the script); the order follows the text.', origin: 'static', fact: f.id, source: f.source });
  }
  const nodes = [
    { id: 'start', kind: 'start', label: unit.name, role: 'Not analysed: the blocks below were found by the script, in the order the text mentions them.', origin: 'inferred', source: unitSource },
    ...blocks,
    { id: 'end', kind: 'end', label: 'End', role: 'End of the text.', origin: 'inferred', source: unitSource },
  ];
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, kind: 'flow', source: n.source }));
  return { unit: unit.id, nodes, edges };
}

// An overview block takes what opens it, or what it holds, from the detailed blocks it covers: a sub-process that
// stands for one call opens that callee exactly as the detailed block does.
function overviewNodes(unit, overview, local) {
  const oid = (id) => `${unit.skillNode}~${id}`;
  const nodes = overview.nodes.map((n) => {
    const covered = n.covers.map((id) => local.get(id)).filter(Boolean);
    const node = { id: oid(n.id), kind: n.kind, label: n.label, role: n.role, parent: unit.skillNode, layer: 'overview', covers: covered.map((c) => c.id), missing: false };
    if (n.direction) node.direction = n.direction;
    if (n.user) node.user = true;
    if (n.kind === 'subprocess') {
      const subs = covered.filter((c) => c.kind === 'subprocess');
      Object.assign(node, { calls: subs[0].calls, target: subs[0].target, missing: subs.some((c) => c.missing) });
      if (subs.some((c) => c.parallel)) node.parallel = true;
      const opens = [...new Set(subs.flatMap((c) => c.opens ?? []))];
      if (opens.length) node.opens = opens;
      if (subs.length === 1) for (const key of ['count', 'branches', 'runner', 'targets', 'script']) if (subs[0][key] != null) node[key] = subs[0][key];
    }
    if (n.kind === 'storage') {
      Object.assign(node, { path: covered[0].path, holds: n.holds ?? covered[0].holds });
      if (covered.length === 1) for (const key of ['fields', 'schemaFile']) if (covered[0][key] != null) node[key] = covered[0][key];
    }
    return node;
  });
  const edges = overview.edges.map((e, i) => ({ id: `${unit.skillNode}~e${i + 1}`, kind: e.kind, from: oid(e.from), to: oid(e.to), ...(e.label ? { label: e.label } : {}), layer: 'overview' }));
  return { nodes, edges };
}

export function mergeModel(scanRes, inventory, fragments, { run, mode = 'parallel', overviews = new Map() } = {}) {
  const known = knownSkills(scanRes);
  const nodes = scanRes.containers.map((c) => ({ ...c }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const unitNodes = new Set(scanRes.units.map((u) => u.skillNode));
  const edges = [];
  const usage = new Map();
  const calls = new Set();
  const storage = [];
  const gaps = [];

  for (const unit of scanRes.units) {
    const owner = byId.get(unit.skillNode);
    let frag = fragments.get(unit.id);
    if (frag) owner.analysis = 'ok';
    else {
      frag = fallbackFragment(unit, inventory.units?.[unit.id], owner.source);
      owner.analysis = 'failed';
    }
    const resolve = makeResolver(scanRes.root, unit);
    const runs = scriptResolver(scanRes, unit);
    const lines = (file) => splitLines(readText(path.join(scanRes.root, file)));
    const pid = (local) => `${unit.skillNode}#${local}`;
    const local = new Map();
    for (const n of frag.nodes) {
      const node = { ...n, id: pid(n.id), parent: unit.skillNode, origin: n.origin ?? 'inferred', missing: Boolean(n.missing) };
      if (n.command) node.command = shortCommand(n.command);
      if (n.kind === 'subprocess') {
        // A stage names file#function: its chart; missing when the file or the function is not there; otherwise
        // a real function without a chart (the round limit stopped before it).
        const resolveStage = (t) => {
          const s = parseStage(t, runs, scanRes.root, n.source?.file);
          if (!s) return { unresolved: true };
          if (s.value) return {};
          if (!s.file || !s.defined) return { missing: true };
          const id = known.byStage.get(stageKey(s.file, s.symbol));
          return id ? { id } : {};
        };
        // A command with arguments is a program: a script of the folder (its chart is linked below), or one outside
        // it such as `claude -p` or `git log`.
        const resolveCommand = (t) => {
          if (!/\s/.test(String(t).trim())) return resolveSkillTarget(t, unit, known);
          return parseCommand(t, runs)?.file ? {} : { outOfScope: true };
        };
        const resolveOne = (t) => (n.calls === 'function' ? resolveStage(t) : n.calls === 'command' ? resolveCommand(t)
          : n.calls === 'agent' ? resolveAgentTarget(t, unit, known) : resolveSkillTarget(t, unit, known));
        // A unit that calls itself must not open itself again: the viewer would stack the same flowchart forever.
        const opensOf = (r) => (r.id && r.id !== unit.skillNode && unitNodes.has(r.id) ? [r.id] : []);
        const targets = (n.targets ?? []).map((t) => (typeof t === 'string' ? { target: t } : t));
        const runner = resolveOne(n.target);
        // With targets, the branches decide what is missing or out of scope; `target` is what runs them.
        const results = targets.length ? targets.map((t) => resolveOne(t.target)) : [runner];
        const resolved = [...new Set([runner, ...results].filter((r) => r.id).map((r) => r.id))];
        if (resolved.length) node.resolved = resolved;
        if (targets.length) {
          node.targets = targets.map((t) => t.target);
          node.branches = targets.map((t, i) => ({ target: t.target, label: byId.get(results[i].id)?.label ?? t.target, ...(t.role ? { role: t.role } : {}), opens: opensOf(results[i]) }));
          // Different branches are counted; one prompt run once per item stays ×N unless the text fixes a number.
          if (n.parallel && !n.count && targets.length > 1) node.count = targets.length;
          if (opensOf(runner).length) node.runner = opensOf(runner)[0];
        }
        const opens = [...new Set([...(targets.length ? opensOf(runner) : []), ...results.flatMap(opensOf)])];
        if (opens.length) {
          node.opens = opens;
          for (const id of opens) calls.add(`${unit.skillNode}>${id}`);
        }
        node.missing = results.some((r) => r.missing);
        if (node.missing) node.missingTargets = (targets.length ? targets.map((t) => t.target) : [n.target]).filter((_, i) => results[i].missing);
        if (results.every((r) => r.outOfScope)) node.outOfScope = true;
        if (results.every((r) => r.unresolved)) node.unresolved = true;
      }
      // A step that runs a script command opens its chart; a sub-process keeps its callees in opens and links the script apart.
      const command = node.command ?? (n.kind === 'subprocess' && n.calls === 'command' ? n.target : null);
      if ((n.kind === 'process' || n.kind === 'subprocess') && command) {
        const c = parseCommand(command, runs);
        const id = c?.file && known.byScript.get(scriptKey(c.file, c.subcommand));
        if (id && id !== unit.skillNode && unitNodes.has(id)) {
          node.script = id;
          if (n.kind === 'process') node.opens = [id];
          // A call of kind "command" names the script it runs as its target: that chart is what runs the branches.
          if (n.kind === 'subprocess' && !node.command) {
            node.runner = id;
            node.opens = [...new Set([id, ...(node.opens ?? [])])];
            delete node.outOfScope;
            delete node.unresolved;
          }
          calls.add(`${unit.skillNode}>${id}`);
        }
      }
      for (const key of ['table', 'list']) {
        if (!n[key]) continue;
        const file = n[key].file ?? n.source.file;
        const [a, b] = n[key].lines;
        const parsed = (key === 'table' ? parseTable : parseList)(lines(file).slice(a - 1, b));
        if (parsed) node[key] = { ...parsed, source: { file, lines: [a, b] } };
        else delete node[key];
      }
      if (n.kind === 'storage') {
        const schemaFile = n.schema ? resolve(n.schema) : null;
        let fields = [];
        if (schemaFile) {
          try { fields = schemaFields(JSON.parse(readText(path.join(scanRes.root, schemaFile)))); } catch { fields = []; }
          node.schemaFile = schemaFile;
        }
        if (!fields.length && n.fields) fields = n.fields.map((f) => ({ name: f.name, holds: f.holds, depth: f.name.includes('.') ? 1 : 0 }));
        if (fields.length) node.fields = fields;
      }
      if (n.kind === 'process' && n.loads?.length) {
        // A path with a placeholder (agents/<area>.md) names a family of files, not one that could be missing; text with
        // spaces ("the file named in criterion.card") describes a path worked out at run time.
        const gone = n.loads.filter((p) => !/<[^>]+>|\$\{|\s/.test(String(p).trim()) && !resolve(p));
        if (gone.length) node.loadsMissing = gone;
      }
      if (n.kind === 'storage') storage.push(node);
      nodes.push(node);
      byId.set(node.id, node);
      local.set(n.id, node);
    }
    for (const e of frag.edges) {
      edges.push({ id: `e${edges.length + 1}`, kind: e.kind, from: pid(e.from), to: pid(e.to), ...(e.label ? { label: e.label } : {}), origin: e.origin ?? 'inferred', source: e.source });
      if (e.kind === 'flow') continue;
      const file = local.get(e.kind === 'reads' ? e.from : e.to);
      if (!file?.path) continue;
      const key = normPath(file.path);
      if (!usage.has(key)) usage.set(key, []);
      usage.get(key).push({ key, unit: unit.skillNode, node: pid(e.kind === 'reads' ? e.to : e.from), kind: e.kind, ...(e.label ? { label: e.label } : {}) });
    }
    for (const g of frag.gaps ?? []) gaps.push({ unit: unit.skillNode, kind: g.kind, text: g.text, ...(g.at ? { node: pid(g.at) } : {}), source: g.source });
    const overview = owner.analysis === 'ok' && overviews.get(unit.id);
    if (overview) {
      const ov = overviewNodes(unit, overview, local);
      nodes.push(...ov.nodes);
      edges.push(...ov.edges);
    }
  }
  // Two units share a file when it has a folder part, or when one of them calls the other; a bare name such as notes.md is too common to link on its own.
  const related = (a, b) => a === b || calls.has(`${a}>${b}`) || calls.has(`${b}>${a}`);
  for (const n of storage) {
    const key = normPath(n.path);
    n.usage = (usage.get(key) ?? []).filter((u) => key.includes('/') || related(n.parent, u.unit)).map(({ key: _key, ...u }) => u);
  }

  return {
    version: MODEL_VERSION,
    run,
    root: scanRes.root,
    level: scanRes.level,
    rootId: scanRes.rootId,
    mode,
    nodes,
    edges,
    problems: computeProblems({ scanRes, inventory, nodes, edges, gaps }),
    warnings: (scanRes.warnings ?? []).map((message) => ({ node: null, message })),
  };
}
