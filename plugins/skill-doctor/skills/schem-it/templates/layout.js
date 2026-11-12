// Flowchart layout for the schem-it viewer: design tokens, block sizes, ports and ELK placement.
// A plain script, inlined into schem.html; the tests load it in a vm with the same ELK bundle.
globalThis.SchemLayout = (() => {
  // One fixed width per block kind, so a kind looks the same on every chart; heights grow with the text.
  const TOKENS = {
    width: { start: 220, end: 220, io: 240, process: 240, subprocess: 240, decision: 260, storage: 240, group: 320 },
    minHeight: { start: 44, end: 44, io: 48, process: 52, subprocess: 52, decision: 96, storage: 66 },
    padX: 16, padY: 12, icon: 16, iconGap: 10, slant: 18, bar: 10, cylRy: 8, radius: 10,
    label: { line: 17, char: 7.3 },
    sub: { line: 14, char: 6.7, gap: 3 },
    pill: { line: 14, char: 6.6, padX: 8, padY: 3 },
    dataLabel: { line: 14, char: 6.3, max: 24, clear: 6 },
    row: { line: 20, gap: 8, max: 8 },
    gap: { layer: 60, node: 56, fileMin: 72, bus: 18, stack: 16, labelPad: 10 },
  };

  function wrap(text, max, lines) {
    const out = [];
    let cur = '';
    for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
      for (let w = word; w.length; ) {
        // A word too long for one line (a file name, a path) breaks after its last - _ / . that fits.
        const cut = w.length > max ? Math.max(...'-_/.'.split('').map((c) => w.slice(0, max).lastIndexOf(c))) : -1;
        const piece = w.length <= max ? w : cut >= max * 0.4 ? w.slice(0, cut + 1) : w.slice(0, max);
        w = w.slice(piece.length);
        if (cur && `${cur} ${piece}`.length > max) { out.push(cur); cur = piece; } else cur = cur ? `${cur} ${piece}` : piece;
      }
    }
    if (cur) out.push(cur);
    if (out.length > lines) {
      out.length = lines;
      out[lines - 1] = `${out[lines - 1].slice(0, Math.max(1, max - 1))}…`;
    }
    return out;
  }

  function labelOf(n) {
    let t = n.label;
    if (n.kind === 'subprocess' && n.parallel) t += n.count ? ` ×${n.count}` : ' ×N';
    return n.missing ? `missing: ${t}` : t;
  }
  // A parallel group lists its branches inside the block; more than `max` show as max - 1 rows and "+N more".
  function rowsOf(n) {
    const all = n.kind === 'subprocess' ? n.branches ?? [] : [];
    if (!all.length) return [];
    const max = TOKENS.row.max;
    const shown = all.length > max ? all.slice(0, max - 1) : all;
    // A prefix several branches share ("Area: ") repeats what the block already says; dropping it keeps the names readable.
    const prefix = (l) => /^[A-Z][\w-]*: /.exec(l)?.[0];
    const shared = new Set(shown.map((b) => prefix(b.label)).filter((p, i, all) => p && all.indexOf(p) !== i));
    const rows = shown.map((b) => ({ text: shared.has(prefix(b.label)) ? b.label.slice(prefix(b.label).length) : b.label, open: b.opens?.[0] ?? null }));
    if (shown.length < all.length) rows.push({ text: `+${all.length - shown.length} more`, open: null, more: true });
    return rows;
  }

  // "16 rules ▸" for a table (noun from its first column), "5 items ▸" for a list, "12 fields" for a file.
  function detailLine(n) {
    if (n.table) {
      const head = (n.table.columns[0] ?? '').toLowerCase();
      const noun = /^[a-z]{2,12}$/.test(head) ? (head.endsWith('s') ? head : `${head}s`) : 'rows';
      return `${n.table.rows.length} ${noun} ▸`;
    }
    if (n.list) return `${n.list.items.length} items ▸`;
    if (n.kind === 'storage' && n.fields?.length) return `${n.fields.length} fields`;
    return null;
  }


  function sizeOf(n) {
    const T = TOKENS;
    const k = n.kind === 'end' ? 'end' : n.kind;
    // A parallel group that lists its branches is wider, so each branch name fits on its row.
    const w = k === 'subprocess' && rowsOf(n).length ? T.width.group : T.width[k];
    const iconW = T.icon + T.iconGap;
    let tw = w - 2 * T.padX - iconW;
    if (k === 'io') tw -= T.slant;
    if (k === 'subprocess') tw -= 2 * T.bar;
    if (k === 'decision') tw = w * 0.56 - iconW;
    const main = wrap(labelOf(n), Math.floor(tw / T.label.char), 4);
    const subText = k === 'process' ? n.command : k === 'storage' ? n.holds : null;
    const sub = subText ? wrap(subText, Math.floor(tw / T.sub.char), 2) : [];
    const detail = detailLine(n);
    if (detail) sub.push(detail);
    const rows = rowsOf(n).map((r) => ({ ...r, text: wrap(r.text, Math.floor((tw - 14) / T.sub.char), 1)[0] ?? '' }));
    const rowsH = rows.length ? T.row.gap + rows.length * T.row.line : 0;
    const textH = main.length * T.label.line + (sub.length ? T.sub.gap + sub.length * T.sub.line : 0);
    let h = Math.max(T.minHeight[k], textH + rowsH + 2 * T.padY);
    if (k === 'storage') h = Math.max(T.minHeight[k], textH + 2 * T.padY + 2 * T.cylRy);
    // Text inside a diamond must fit where the diamond is still wide enough: (1 - textH / h) * w >= tw + icon.
    if (k === 'decision') h = Math.max(T.minHeight[k], Math.ceil(textH / 0.44) + 8);
    const side = k === 'io' ? T.slant / 2 : 0;
    return { w, h, main, sub, detail: detail ? sub.length - 1 : -1, rows, rowsH, textH, inLeft: side, outRight: side };
  }

  function dataLabel(text) {
    const D = TOKENS.dataLabel;
    const lines = wrap(text, D.max, 3);
    return { lines, w: Math.max(...lines.map((l) => l.length), 1) * D.char + 4, h: lines.length * D.line };
  }

  function pillOf(text) {
    const P = TOKENS.pill;
    return { w: String(text).length * P.char + 2 * P.padX, h: P.line + 2 * P.padY };
  }

  // Edges that point back to a block already on the path from Start (the loop edges).
  function backEdges(flowNodes, flow) {
    const out = new Map();
    for (const e of flow) {
      if (!out.has(e.from)) out.set(e.from, []);
      out.get(e.from).push(e);
    }
    const back = new Set();
    const state = new Map();
    const start = flowNodes.find((n) => n.kind === 'start') ?? flowNodes[0];
    const visit = (id) => {
      state.set(id, 1);
      for (const e of out.get(id) ?? []) {
        if (state.get(e.to) === 1) back.add(e.id);
        else if (!state.has(e.to)) visit(e.to);
      }
      state.set(id, 2);
    };
    if (start) visit(start.id);
    for (const n of flowNodes) if (!state.has(n.id)) visit(n.id);
    return back;
  }

  // Blocks in reading order: every edge except a loop edge goes from an earlier block to a later one, ties kept in
  // the analyst's order. Given this order, ELK's model-order cycle breaking reverses exactly the loop edges, so a
  // retry loop no longer lifts the steps it repeats above Start.
  function readingOrder(flowNodes, flow, back) {
    const index = new Map(flowNodes.map((n, i) => [n.id, i]));
    const indeg = new Map(flowNodes.map((n) => [n.id, 0]));
    const next = new Map(flowNodes.map((n) => [n.id, []]));
    for (const e of flow) {
      if (back.has(e.id)) continue;
      indeg.set(e.to, indeg.get(e.to) + 1);
      next.get(e.from).push(e.to);
    }
    const ready = flowNodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
    const order = [];
    while (ready.length) {
      ready.sort((a, b) => index.get(a) - index.get(b));
      const id = ready.shift();
      order.push(id);
      for (const t of next.get(id)) {
        indeg.set(t, indeg.get(t) - 1);
        if (indeg.get(t) === 0) ready.push(t);
      }
    }
    return order;
  }

  // A decision's main path leaves from the bottom vertex; the branch (a loop back, an End, or "no") from the right vertex.
  function exitSides(flowNodes, flow, byId, back = backEdges(flowNodes, flow)) {
    const sides = new Map();
    const grouped = new Map();
    for (const e of flow) {
      if (!grouped.has(e.from)) grouped.set(e.from, []);
      grouped.get(e.from).push(e);
    }
    for (const [from, list] of grouped) {
      if (byId.get(from)?.kind !== 'decision' || list.length < 2) { list.forEach((e) => sides.set(e.id, 'S')); continue; }
      const score = (e) => (back.has(e.id) ? 4 : 0) + (byId.get(e.to)?.kind === 'end' ? 2 : 0) + (/^(no|false|n)$/i.test(e.label ?? '') ? 1 : 0);
      let branch = list[1];
      if (score(list[0]) > score(list[1])) branch = list[0];
      list.forEach((e) => sides.set(e.id, e === branch ? 'E' : 'S'));
    }
    return sides;
  }

  // Files read by a step stack in a column on its left, files it writes on its right. Offsets are from the step's centre line.
  function stackOf(items, sizes) {
    const T = TOKENS;
    const D = T.dataLabel;
    if (!items.length) return null;
    let cy = 0;
    let prev = null;
    for (const it of items) {
      const h = sizes.get(it.copy).h;
      if (prev) cy += Math.max(prev.h / 2 + T.gap.stack + h / 2, it.label.h + 2 * D.clear);
      it.cy = cy;
      it.h = h;
      prev = it;
    }
    const top = Math.min(...items.map((it) => Math.min(it.cy - it.h / 2, it.cy - D.clear - it.label.h)));
    const bottom = Math.max(...items.map((it) => it.cy + it.h / 2));
    const shift = -(top + bottom) / 2;
    for (const it of items) it.cy += shift;
    const labelW = Math.max(...items.map((it) => it.label.w));
    return {
      items,
      height: bottom - top,
      colW: Math.max(...items.map((it) => sizes.get(it.copy).w)),
      gap: Math.max(T.gap.fileMin, labelW + 2 * T.gap.labelPad + T.gap.bus),
    };
  }

  async function compute(view, byId, elk, { showFiles = true, candidates = CANDIDATES } = {}) {
    const T = TOKENS;
    const flowNodes = view.nodes.map((id) => byId.get(id)).filter((n) => n && n.kind !== 'storage');
    const flowIds = new Set(flowNodes.map((n) => n.id));
    const flow = view.edges.filter((e) => e.kind === 'flow' && flowIds.has(e.from) && flowIds.has(e.to));
    const sizes = new Map(flowNodes.map((n) => [n.id, sizeOf(n)]));
    const copies = [];
    const sideLists = new Map(flowNodes.map((n) => [n.id, { west: [], east: [] }]));
    if (showFiles) {
      for (const e of view.edges) {
        if (e.kind !== 'reads' && e.kind !== 'writes') continue;
        const reads = e.kind === 'reads';
        const step = reads ? e.to : e.from;
        const file = byId.get(reads ? e.from : e.to);
        if (!file || !sideLists.has(step)) continue;
        const copy = { ...file, id: `${file.id}@${e.id}`, of: file.id };
        copies.push(copy);
        sizes.set(copy.id, sizeOf(copy));
        sideLists.get(step)[reads ? 'west' : 'east'].push({ copy: copy.id, edge: e, label: dataLabel(e.label ?? '') });
      }
    }
    const room = new Map();
    for (const n of flowNodes) {
      const sz = sizes.get(n.id);
      const lists = sideLists.get(n.id);
      const west = stackOf(lists.west, sizes);
      const east = stackOf(lists.east, sizes);
      const ml = west ? west.colW + west.gap : 0;
      const mr = east ? east.colW + east.gap : 0;
      const H = Math.max(sz.h, west?.height ?? 0, east?.height ?? 0);
      room.set(n.id, { west, east, ml, mr, W: ml + sz.w + mr, H });
    }
    const back = backEdges(flowNodes, flow);
    const sides = exitSides(flowNodes, flow, byId, back);
    // A loop back from a step leaves from its right side and climbs straight up; from the bottom it would first run
    // down along the lines below it and seem to end where they do. Not when files sit on that side.
    for (const e of flow) {
      const k = byId.get(e.from)?.kind;
      if (back.has(e.id) && (k === 'process' || k === 'subprocess') && !room.get(e.from).east) sides.set(e.id, 'E');
    }
    const eastOut = new Set(flow.filter((e) => sides.get(e.id) === 'E').map((e) => e.from));
    const rank = new Map(readingOrder(flowNodes, flow, back).map((id, i) => [id, i]));
    const ordered = [...flowNodes].sort((a, b) => rank.get(a.id) - rank.get(b.id));
    const children = ordered.map((n) => {
      const r = room.get(n.id);
      const sz = sizes.get(n.id);
      const cx = r.ml + sz.w / 2;
      const ports = [
        { id: `${n.id}::n`, x: cx, y: 0, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'NORTH' } },
        { id: `${n.id}::s`, x: cx, y: r.H, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'SOUTH' } },
      ];
      if (n.kind === 'decision' || eastOut.has(n.id)) ports.push({ id: `${n.id}::e`, x: r.W, y: r.H / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } });
      return { id: n.id, width: r.W, height: r.H, ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } };
    });
    const place = (res) => placeOf(res, { byId, room, sizes, copies, sides, flow });
    const edges = [...flow].sort((a, b) => rank.get(a.from) - rank.get(b.from)).map((e) => {
      const side = sides.get(e.id) ?? 'S';
      const labels = e.label ? [{ id: `${e.id}::l`, text: e.label, ...(({ w, h }) => ({ width: w, height: h }))(pillOf(e.label)), layoutOptions: { 'elk.edgeLabels.placement': 'TAIL' } }] : [];
      return { id: e.id, sources: [`${e.from}::${side === 'E' ? 'e' : 's'}`], targets: [`${e.to}::n`], labels };
    });
    const base = {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(T.gap.layer),
      'elk.spacing.nodeNode': String(T.gap.node),
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.spacing.edgeLabel': '6',
      'elk.edgeLabels.inline': 'false',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    };
    // Evaluation step: lay the chart out with every candidate setting, score each result and keep the best.
    let best = null;
    for (const [i, extra] of candidates.entries()) {
      const res = await elk.layout(JSON.parse(JSON.stringify({ id: 'root', layoutOptions: { ...base, ...extra }, children, edges })));
      const L = place(res);
      L.score = { candidate: i, ...scoreLayout(L) };
      if (!best || L.score.total < best.score.total) best = L;
    }
    return best;
  }

  // Turns ELK's placement of the reserved boxes into drawn blocks, file copies and connector points.
  function placeOf(res, { byId, room, sizes, copies, sides, flow }) {
    const T = TOKENS;
    const blocks = [];
    const shapes = new Map();
    const outEdges = [];
    const D = T.dataLabel;
    for (const c of res.children) {
      const n = byId.get(c.id);
      const r = room.get(c.id);
      const sz = sizes.get(c.id);
      const s = { x: c.x + r.ml, y: c.y + (r.H - sz.h) / 2, w: sz.w, h: sz.h };
      shapes.set(c.id, s);
      blocks.push({ id: c.id, kind: n.kind, node: n, ...s, main: sz.main, sub: sz.sub, textH: sz.textH, rows: sz.rows, rowsH: sz.rowsH, detail: sz.detail, inLeft: sz.inLeft, outRight: sz.outRight });
      const cy = s.y + s.h / 2;
      for (const [where, stack] of [['west', r.west], ['east', r.east]]) {
        if (!stack) continue;
        for (const it of stack.items) {
          const cz = sizes.get(it.copy);
          const copy = copies.find((x) => x.id === it.copy);
          const y = cy + it.cy;
          const x = where === 'west' ? s.x - stack.gap - cz.w : s.x + s.w + stack.gap;
          blocks.push({ id: copy.id, of: copy.of, kind: 'storage', node: copy, x, y: y - cz.h / 2, w: cz.w, h: cz.h, main: cz.main, sub: cz.sub, textH: cz.textH, rows: [], rowsH: 0, detail: cz.detail, inLeft: 0, outRight: 0 });
          const label = it.edge.label ? { text: it.edge.label, lines: it.label.lines, w: it.label.w, h: it.label.h, y: y - D.clear - it.label.h } : null;
          let points;
          if (where === 'west') {
            const bus = s.x + sz.inLeft - T.gap.bus;
            points = Math.abs(y - cy) < 0.5 ? [{ x: x + cz.w, y }, { x: s.x + sz.inLeft, y: cy }]
              : [{ x: x + cz.w, y }, { x: bus, y }, { x: bus, y: cy }, { x: s.x + sz.inLeft, y: cy }];
            if (label) label.x = x + cz.w + T.gap.labelPad;
            outEdges.push({ id: it.edge.id, kind: 'reads', ref: it.edge, from: copy.id, to: c.id, points, label });
          } else {
            const right = s.x + s.w - sz.outRight;
            const bus = right + T.gap.bus;
            points = Math.abs(y - cy) < 0.5 ? [{ x: right, y: cy }, { x, y }]
              : [{ x: right, y: cy }, { x: bus, y: cy }, { x: bus, y }, { x, y }];
            if (label) label.x = x - T.gap.labelPad - label.w;
            outEdges.push({ id: it.edge.id, kind: 'writes', ref: it.edge, from: c.id, to: copy.id, points, label });
          }
        }
      }
    }
    const refs = new Map(flow.map((e) => [e.id, e]));
    for (const ee of res.edges ?? []) {
      const ref = refs.get(ee.id);
      const pts = [];
      for (const sec of ee.sections ?? []) pts.push(sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint);
      if (pts.length < 2) continue;
      // Ports sit on the reserved box; run the first and last stretch on to the drawn shape (same x, so still orthogonal).
      const from = shapes.get(ref.from);
      const to = shapes.get(ref.to);
      if (sides.get(ref.id) !== 'E') pts[0] = { x: pts[0].x, y: from.y + from.h };
      pts[pts.length - 1] = { x: pts[pts.length - 1].x, y: to.y };
      const lb = ee.labels?.[0];
      const label = lb ? { text: lb.text, lines: [lb.text], x: lb.x, y: lb.y, w: lb.width, h: lb.height, pill: true } : null;
      outEdges.push({ id: ref.id, kind: 'flow', ref, from: ref.from, to: ref.to, points: pts, label, side: sides.get(ref.id) });
    }
    return { blocks, edges: outEdges, width: res.width, height: res.height };
  }

  // The whole-system map. Each unit is a card or, with `expand`, a frame around its whole flowchart (laid out by
  // `chartOf`, the same layout as its own page). Calls run from caller down to callee; with `expand` they leave the
  // calling block and enter the callee's Start. A file one unit writes and another reads sits between them.
  // Everything comes back in page coordinates: blocks and edges as compute() returns them, plus the frames.
  const MAP = { card: 260, head: 34, accent: 5, chev: 12, framePad: 20 };

  function cardOf(n, meta) {
    const T = TOKENS;
    const tw = MAP.card - 2 * T.padX - MAP.accent - T.icon - T.iconGap - MAP.chev;
    const main = wrap(n.label, Math.floor(tw / T.label.char), 2);
    const sub = [meta, ...wrap(n.description ?? '', Math.floor(tw / T.sub.char), 2)].filter(Boolean);
    const textH = main.length * T.label.line + (sub.length ? T.sub.gap + sub.length * T.sub.line : 0);
    return { w: MAP.card, h: Math.max(T.minHeight.process, textH + 2 * T.padY), main, sub, textH };
  }

  async function computeMap(view, byId, elk, { expand = false, showFiles = true, chartOf = async () => null, metaOf = () => '' } = {}) {
    const boxes = new Map();
    for (const id of view.units) {
      const L = expand ? await chartOf(id) : null;
      if (L) {
        const w = Math.max(L.width, MAP.card);
        boxes.set(id, { w, h: L.height + MAP.head, chart: L, ox: (w - L.width) / 2 });
      } else boxes.set(id, { ...cardOf(byId.get(id), metaOf(id)), card: true });
    }
    // One arrow per calling block when the charts are open, otherwise one per pair of units.
    const calls = new Map();
    for (const c of view.calls) {
      const key = expand && boxes.get(c.from).chart ? `${c.via}>${c.to}` : `${c.from}>${c.to}`;
      if (!calls.has(key)) calls.set(key, { id: c.id, from: c.from, to: c.to, via: [], kinds: new Set() });
      calls.get(key).via.push(c.via);
      calls.get(key).kinds.add(c.kind);
    }
    const ports = new Map();
    const port = (unit, p) => {
      if (!ports.has(unit)) ports.set(unit, []);
      if (!ports.get(unit).some((x) => x.id === p.id)) ports.get(unit).push(p);
      return p.id;
    };
    const edges = [];
    for (const c of calls.values()) {
      const group = c.via.map((v) => byId.get(v)).find((n) => n?.parallel);
      const text = `${[...c.kinds].join(', ')}${group ? (group.count ? ` ×${group.count}` : ' ×N') : ''}`;
      const e = { id: c.id, kind: 'call', from: c.from, to: c.to, via: c.via, text, source: c.from, target: c.to };
      const src = boxes.get(c.from);
      const b = src.chart?.blocks.find((x) => x.id === c.via[0]);
      if (b) {
        // The arrow leaves the calling block on the side with no files, so it does not cut through them.
        const west = src.chart.edges.some((x) => x.kind === 'writes' && x.from === b.id) && !src.chart.edges.some((x) => x.kind === 'reads' && x.to === b.id);
        const y = MAP.head + b.y + b.h / 2;
        e.source = port(c.from, { id: `${c.id}::out`, x: west ? 0 : src.w, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': west ? 'WEST' : 'EAST' } });
        e.inner = { x: src.ox + (west ? b.x + b.inLeft : b.x + b.w - b.outRight), y };
      }
      const dst = boxes.get(c.to);
      const s = dst.chart?.blocks.find((x) => x.kind === 'start');
      if (s) {
        const x = dst.ox + s.x + s.w / 2;
        e.target = port(c.to, { id: `${c.to}::in`, x, y: 0, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'NORTH' } });
        e.enter = { x, y: MAP.head + s.y };
      }
      edges.push(e);
    }
    const files = showFiles && !expand ? view.files : [];
    const fileSizes = new Map(files.map((f) => [f.id, sizeOf(byId.get(f.id))]));
    for (const f of files) {
      for (const u of f.writers) edges.push({ id: `${f.id}<${u}`, kind: 'writes', from: u, to: f.id, source: u, target: f.id });
      for (const u of f.readers) edges.push({ id: `${f.id}>${u}`, kind: 'reads', from: f.id, to: u, source: f.id, target: u });
    }
    // Units of a marketplace sit in a frame per plugin; a file goes into a frame when all its units are in it.
    const frameOf = new Map(view.frames.flatMap((f) => f.units.map((u) => [u, f.id])));
    for (const f of files) {
      const fr = new Set([...f.writers, ...f.readers].map((u) => frameOf.get(u)));
      if (fr.size === 1 && [...fr][0]) frameOf.set(f.id, [...fr][0]);
    }
    const top = [];
    const inFrame = new Map(view.frames.map((f) => [f.id, []]));
    const put = (id, n) => (frameOf.has(id) ? inFrame.get(frameOf.get(id)) : top).push(n);
    for (const id of view.units) {
      const bx = boxes.get(id);
      put(id, { id, width: bx.w, height: bx.h, ...(ports.has(id) ? { ports: ports.get(id), layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } } : {}) });
    }
    for (const f of files) put(f.id, { id: f.id, width: fileSizes.get(f.id).w, height: fileSizes.get(f.id).h });
    for (const f of view.frames) top.push({ id: f.id, children: inFrame.get(f.id), layoutOptions: { 'elk.padding': `[top=${MAP.head + 12},left=${MAP.framePad},bottom=${MAP.framePad},right=${MAP.framePad}]` } });
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        // Cards read left to right, so one unit calling many stacks them in a column; open charts read top down.
        'elk.direction': expand ? 'DOWN' : 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.json.shapeCoords': 'ROOT',
        'elk.json.edgeCoords': 'ROOT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '70',
        'elk.spacing.nodeNode': '40',
        'elk.spacing.componentComponent': '48',
        'elk.spacing.edgeNode': '24',
        'elk.spacing.edgeEdge': '14',
        'elk.spacing.edgeLabel': '6',
        'elk.edgeLabels.inline': 'false',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.padding': '[top=24,left=24,bottom=24,right=24]',
      },
      children: top,
      edges: edges.map((e) => ({
        id: e.id, sources: [e.source], targets: [e.target],
        labels: e.text ? [{ id: `${e.id}::l`, text: e.text, ...(({ w, h }) => ({ width: w, height: h }))(pillOf(e.text)), layoutOptions: { 'elk.edgeLabels.placement': 'TAIL' } }] : [],
      })),
    };
    const res = await elk.layout(graph);
    const pos = new Map();
    const walk = (n) => { for (const c of n.children ?? []) { pos.set(c.id, c); walk(c); } };
    walk(res);
    const frames = view.frames.map((f) => ({ id: f.id, kind: 'plugin', title: f.title, ...(({ x, y, width, height }) => ({ x, y, w: width, h: height }))(pos.get(f.id)) }));
    const blocks = [];
    const out = [];
    for (const id of view.units) {
      const p = pos.get(id);
      const bx = boxes.get(id);
      const n = byId.get(id);
      if (bx.card) { blocks.push({ id, kind: 'unit', node: n, x: p.x, y: p.y, w: bx.w, h: bx.h, main: bx.main, sub: bx.sub, textH: bx.textH }); continue; }
      frames.push({ id, kind: 'unit', title: n.label, x: p.x, y: p.y, w: bx.w, h: bx.h });
      const dx = p.x + bx.ox;
      const dy = p.y + MAP.head;
      for (const b of bx.chart.blocks) blocks.push({ ...b, x: b.x + dx, y: b.y + dy });
      for (const e of bx.chart.edges) {
        out.push({ ...e, points: e.points.map((q) => ({ x: q.x + dx, y: q.y + dy })), label: e.label && { ...e.label, x: e.label.x + dx, y: e.label.y + dy } });
      }
    }
    for (const f of files) {
      const p = pos.get(f.id);
      const sz = fileSizes.get(f.id);
      blocks.push({ id: f.id, kind: 'storage', node: byId.get(f.id), x: p.x, y: p.y, w: sz.w, h: sz.h, main: sz.main, sub: sz.sub, textH: sz.textH, rows: [], rowsH: 0, detail: sz.detail, inLeft: 0, outRight: 0 });
    }
    const refs = new Map(edges.map((e) => [e.id, e]));
    for (const ee of res.edges ?? []) {
      const e = refs.get(ee.id);
      const pts = [];
      for (const sec of ee.sections ?? []) pts.push(sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint);
      if (pts.length < 2) continue;
      // Run the arrow on from the frame's edge to the calling block, and from the callee's frame top to its Start.
      if (e.inner) { const p = pos.get(e.from); pts.unshift({ x: p.x + e.inner.x, y: p.y + e.inner.y }); }
      if (e.enter) { const p = pos.get(e.to); pts.push({ x: p.x + e.enter.x, y: p.y + e.enter.y }); }
      const lb = ee.labels?.[0];
      out.push({ id: e.id, kind: e.kind, from: e.from, to: e.to, ...(e.via ? { via: e.via } : {}), points: pts,
        label: lb ? { text: lb.text, lines: [lb.text], x: lb.x, y: lb.y, w: lb.width, h: lb.height, pill: true } : null });
    }
    return { blocks, edges: out, frames, width: res.width, height: res.height, head: MAP.head };
  }

  // Candidate ELK settings. Within a layer ELK orders blocks to reduce crossings (layer sweep, a heuristic): keeping
  // the analyst's order, or not, with different random starts, finds different local optima; Brandes-Köpf or
  // network-simplex placement then trades straight lines against compactness. The first is the default and wins ties.
  const FREE = { 'elk.layered.considerModelOrder.strategy': 'NONE', 'elk.layered.thoroughness': '40' };
  const SIMPLEX = { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX' };
  const CANDIDATES = [
    {},
    SIMPLEX,
    FREE,
    { ...FREE, ...SIMPLEX },
    { ...FREE, 'elk.randomSeed': '7' },
    { ...FREE, ...SIMPLEX, 'elk.randomSeed': '7' },
  ];

  // Layout quality, lower is better. Penalised, heaviest first: a line drawn through a block that is not its end,
  // two lines crossing, two lines bound for different places running side by side closer than SIDE_BY_SIDE
  // (the reader cannot tell which goes where), then bends and total line length as tie-breakers.
  const SIDE_BY_SIDE = 20;
  function scoreLayout(L) {
    const segs = [];
    for (const e of L.edges) {
      for (let i = 0; i < e.points.length - 1; i++) {
        const a = e.points[i];
        const b = e.points[i + 1];
        const horizontal = Math.abs(a.y - b.y) < 0.5;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) continue;
        segs.push({ e, horizontal, at: horizontal ? a.y : a.x, lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y) });
      }
    }
    let crossings = 0;
    let sideBySide = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i];
        const t = segs[j];
        if (s.e === t.e) continue;
        if (s.horizontal !== t.horizontal) {
          const [h, v] = s.horizontal ? [s, t] : [t, s];
          if (v.at > h.lo + 0.5 && v.at < h.hi - 0.5 && h.at > v.lo + 0.5 && h.at < v.hi - 0.5) crossings++;
        } else if (s.e.to !== t.e.to && s.e.from !== t.e.from && Math.abs(s.at - t.at) < SIDE_BY_SIDE) {
          sideBySide += Math.max(0, Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo));
        }
      }
    }
    let throughBlocks = 0;
    for (const s of segs) {
      for (const b of L.blocks) {
        const id = b.id;
        if (id === s.e.from || id === s.e.to) continue;
        const [x1, x2, y1, y2] = s.horizontal ? [s.lo, s.hi, s.at, s.at] : [s.at, s.at, s.lo, s.hi];
        if (x2 > b.x + 1 && x1 < b.x + b.w - 1 && y2 > b.y + 1 && y1 < b.y + b.h - 1) throughBlocks++;
      }
    }
    const bends = L.edges.reduce((sum, e) => sum + Math.max(0, e.points.length - 2), 0);
    const length = segs.reduce((sum, s) => sum + s.hi - s.lo, 0);
    const total = 1000 * throughBlocks + 100 * crossings + 0.5 * sideBySide + 4 * bends + 0.01 * length;
    return { total, throughBlocks, crossings, sideBySide: Math.round(sideBySide), bends, length: Math.round(length) };
  }

  return { TOKENS, MAP, CANDIDATES, compute, computeMap, scoreLayout, sizeOf, wrap, labelOf, rowsOf, detailLine };
})();
