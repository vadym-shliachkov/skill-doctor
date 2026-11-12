export const FLOW_KINDS = new Set(['skill', 'command', 'agent-def', 'agent-prompt', 'script-command']);
const INDEX_KINDS = new Set(['marketplace', 'plugin']);
const CONTAINER_KINDS = new Set([...FLOW_KINDS, ...INDEX_KINDS, 'hook']);
// Units that belong to a skill but are listed with the plugin's other units.
const NESTED_KINDS = new Set(['agent-prompt', 'script-command']);
const GROUPS = [['plugin', 'Plugins'], ['skill', 'Skills'], ['command', 'Commands'], ['agent-def', 'Agents'], ['agent-prompt', 'Agent prompts'], ['script-command', 'Scripts'], ['hook', 'Hooks']];

export function buildViews(model) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const n of model.nodes) {
    if (!n.parent) continue;
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n.id);
  }
  const views = [];
  const visit = (id, parent) => {
    const node = byId.get(id);
    if (!node) return;
    const kids = children.get(id) ?? [];
    if (INDEX_KINDS.has(node.kind)) {
      const listed = [...kids, ...kids.flatMap((k) => (children.get(k) ?? []).filter((c) => NESTED_KINDS.has(byId.get(c).kind)))];
      const groups = GROUPS.map(([kind, title]) => ({ kind, title, items: listed.filter((k) => byId.get(k).kind === kind) })).filter((g) => g.items.length);
      views.push({ id, kind: 'index', of: node.kind, title: node.label, parent, groups, nodes: [], edges: [] });
      for (const k of kids) visit(k, id);
      return;
    }
    if (!FLOW_KINDS.has(node.kind)) return;
    // A short command is not analysed: it stays an index card without a flowchart of its own.
    if (node.kind === 'command' && !node.analysis && !kids.length) return;
    // The overview's blocks sit beside the detailed ones: the detailed chart, the map and the exports never mix them.
    const all = kids.filter((k) => !CONTAINER_KINDS.has(byId.get(k).kind));
    const edgesOf = (ids) => {
      const set = new Set(ids);
      return model.edges
        .filter((e) => set.has(e.from) && set.has(e.to))
        .map(({ id: eid, kind, from, to, label }) => ({ id: eid, kind, from, to, ...(label ? { label } : {}) }));
    };
    const blocks = all.filter((k) => !byId.get(k).layer);
    const overview = all.filter((k) => byId.get(k).layer === 'overview');
    views.push({ id, kind: node.kind, title: node.label, parent, nodes: blocks, edges: edgesOf(blocks), ...(overview.length ? { overview: { nodes: overview, edges: edgesOf(overview) } } : {}) });
    for (const k of kids) if (FLOW_KINDS.has(byId.get(k).kind)) visit(k, id);
  };
  visit(model.rootId, null);
  const map = mapView(model, views, byId);
  if (map) views.push(map);
  return views;
}

// A chart's overview drawn as a chart of its own: same id and title, the overview's blocks and arrows.
export function overviewView(view) {
  return view.overview ? { ...view, nodes: view.overview.nodes, edges: view.overview.edges, layer: 'overview' } : null;
}

export const MAP_ID = '@map';

// The whole system on one chart: a box per flowchart, an arrow for each unit calling or running another, and the
// files one unit writes and another reads. Units of a marketplace sit in a frame per plugin.
function mapView(model, views, byId) {
  const all = views.filter((v) => v.kind !== 'index');
  // A unit left out by --only is drawn only when something calls it: a page of unconnected empty boxes says nothing.
  const linked = new Set(all.flatMap((v) => v.nodes.flatMap((id) => [...(byId.get(id).opens ?? []), byId.get(id).script])));
  const charts = all.filter((v) => byId.get(v.id).analysis !== 'skipped' || linked.has(v.id));
  if (charts.length < 2) return null;
  const units = charts.map((v) => v.id);
  const has = new Set(units);
  const pluginOf = (id) => {
    for (let n = byId.get(id); n; n = byId.get(n.parent)) if (n.kind === 'plugin') return n.id;
    return null;
  };
  const plugins = [...new Set(units.map(pluginOf).filter(Boolean))];
  const frames = plugins.length > 1 ? plugins.map((p) => ({ id: p, title: byId.get(p).label, units: units.filter((u) => pluginOf(u) === p) })) : [];
  const calls = [];
  const files = new Map();
  for (const v of charts) {
    for (const id of v.nodes) {
      const n = byId.get(id);
      if (n.kind === 'process' || n.kind === 'subprocess') {
        const how = n.kind === 'process' || n.calls === 'command' ? 'runs' : n.calls === 'function' ? 'stage' : n.calls;
        for (const to of new Set([...(n.opens ?? []), ...(n.script ? [n.script] : [])])) {
          if (!has.has(to) || to === v.id) continue;
          calls.push({ id: `c${calls.length + 1}`, from: v.id, to, via: id, kind: to === n.script ? 'runs' : how, ...(n.parallel ? { parallel: true } : {}) });
        }
      }
      if (n.kind !== 'storage' || !n.usage) continue;
      const use = n.usage.filter((u) => has.has(u.unit));
      if (new Set(use.map((u) => u.unit)).size < 2) continue;
      // Every copy of a shared file carries the same usage list: the first one stands for the file.
      const key = use.map((u) => `${u.node}:${u.kind}`).sort().join('|');
      if (files.has(key)) continue;
      const of = (kind) => [...new Set(use.filter((u) => u.kind === kind).map((u) => u.unit))];
      files.set(key, { id, writers: of('writes'), readers: of('reads') });
    }
  }
  return { id: MAP_ID, kind: 'map', title: 'Whole system', parent: model.rootId, units, left: all.length - units.length, frames, calls, files: [...files.values()], nodes: [], edges: [] };
}

export function breadcrumb(views, viewId) {
  const byId = new Map(views.map((v) => [v.id, v]));
  const out = [];
  for (let v = byId.get(viewId); v; v = byId.get(v.parent)) out.unshift(v.title);
  return out;
}
