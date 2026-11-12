import fs from 'node:fs';
import path from 'node:path';
import { readText, splitLines } from './io.mjs';
import { isInside } from './paths.mjs';
import { loadSchema, validateSchema } from './schema.mjs';
import { parseTable, parseList } from './markdown.mjs';
import { schemaFields } from './fields.mjs';

export const FLOW_BLOCKS = ['start', 'io', 'process', 'decision', 'subprocess', 'end'];
export const BLOCK_KINDS = [...FLOW_BLOCKS, 'storage'];
const ACTIONS = ['process', 'decision', 'subprocess'];
export const EDGE_RULES = {
  flow: [['start', 'io', ...ACTIONS], ['io', ...ACTIONS, 'end']],
  reads: [['storage'], ACTIONS],
  writes: [['process', 'subprocess'], ['storage']],
};
export const EDGE_KINDS = Object.keys(EDGE_RULES);
const REQUIRED = { io: ['direction'], subprocess: ['target', 'calls'], storage: ['path', 'holds'] };

export function normalizeQuote(s) {
  return String(s).replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim();
}

export function checkCitation(root, source, cache) {
  const abs = path.resolve(root, source.file);
  if (!isInside(root, abs)) return 'file is outside the analysed folder';
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return `file not found: ${source.file}`;
  if (!cache.has(abs)) cache.set(abs, splitLines(readText(abs)));
  const lines = cache.get(abs);
  const [a, b] = source.lines;
  if (!(a >= 1 && b >= a && b <= lines.length)) return `lines ${a}-${b} outside ${source.file} (1-${lines.length})`;
  const needle = normalizeQuote(source.quote);
  if (!needle) return 'quote is empty';
  if (!normalizeQuote(lines.slice(a - 1, b).join(' ')).includes(needle)) return `quote not found in ${source.file}:${a}-${b}`;
  return null;
}

const MAX_RANGE = 200;

function checkRange(root, ref, defaultFile, key, cache) {
  const file = ref.file ?? defaultFile;
  const abs = path.resolve(root, file);
  if (!isInside(root, abs)) return 'file is outside the analysed folder';
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return `file not found: ${file}`;
  if (!cache.has(abs)) cache.set(abs, splitLines(readText(abs)));
  const lines = cache.get(abs);
  const [a, b] = ref.lines;
  if (!(a >= 1 && b >= a && b <= lines.length)) return `lines ${a}-${b} outside ${file} (1-${lines.length})`;
  if (b - a + 1 > MAX_RANGE) return `a ${key} range holds at most ${MAX_RANGE} lines`;
  if ((key === 'table' ? parseTable : parseList)(lines.slice(a - 1, b))) return null;
  return key === 'table'
    ? `${file}:${a}-${b} is not a Markdown table (a header row, a |---| row and at least one row)`
    : `${file}:${a}-${b} is not a list (every line an item starting with -, * or 1.)`;
}

function checkSchemaFile(root, p, resolve) {
  const file = resolve(p);
  if (!file) return `schema not found: ${p}`;
  let json;
  try { json = JSON.parse(readText(path.resolve(root, file))); } catch { return `schema is not JSON: ${p}`; }
  return schemaFields(json).length ? null : `schema has no properties: ${p}`;
}

export function validateFragment(root, unitId, fragment, inventory, { resolve } = {}) {
  const errors = validateSchema(loadSchema('model'), fragment);
  if (errors.length) return { ok: false, errors };
  const push = (p, message) => errors.push({ path: p, message });
  if (fragment.unit !== unitId) push('$.unit', `must be "${unitId}"`);

  const ids = new Map();
  fragment.nodes.forEach((n, i) => {
    if (ids.has(n.id)) push(`$.nodes[${i}].id`, `duplicate id "${n.id}"`);
    else ids.set(n.id, n);
  });
  const facts = new Set((inventory?.facts ?? []).map((f) => f.id));
  const cache = new Map();
  const resolveFile = resolve ?? ((p) => (isInside(root, path.resolve(root, p)) && fs.existsSync(path.resolve(root, p)) ? p : null));

  fragment.nodes.forEach((n, i) => {
    const at = `$.nodes[${i}]`;
    const err = checkCitation(root, n.source, cache);
    if (err) push(`${at}.source`, err);
    if (n.origin === 'static' && !facts.has(n.fact)) push(`${at}.fact`, n.fact ? `unknown fact "${n.fact}"` : 'static nodes must name the inventory fact they come from');
    for (const field of REQUIRED[n.kind] ?? []) if (n[field] == null) push(`${at}.${field}`, `${n.kind} needs ${field}`);
    for (const key of ['table', 'list']) {
      if (!n[key]) continue;
      const rangeErr = checkRange(root, n[key], n.source.file, key, cache);
      if (rangeErr) push(`${at}.${key}`, rangeErr);
    }
    if (n.schema) {
      const schemaErr = checkSchemaFile(root, n.schema, resolveFile);
      if (schemaErr) push(`${at}.schema`, schemaErr);
    }
    if (n.kind === 'subprocess' && n.calls === 'function') {
      const named = n.targets?.length ? n.targets.map((t) => (typeof t === 'string' ? t : t.target)) : [n.target];
      for (const t of named) if (!String(t).includes('#')) push(`${at}.target`, `a call of kind "function" names "<path>#<function>" (got "${t}")`);
    }
  });

  fragment.edges.forEach((e, i) => {
    const at = `$.edges[${i}]`;
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    if (!from) push(`${at}.from`, `unknown node "${e.from}"`);
    if (!to) push(`${at}.to`, `unknown node "${e.to}"`);
    if (from && to) {
      const [fromKinds, toKinds] = EDGE_RULES[e.kind];
      if (!fromKinds.includes(from.kind) || !toKinds.includes(to.kind)) push(`${at}.kind`, `${e.kind} cannot go from ${from.kind} to ${to.kind}`);
    }
    if (e.kind !== 'flow' && !e.label) push(`${at}.label`, `${e.kind} edge needs a label saying what is ${e.kind === 'reads' ? 'read' : 'written'}`);
    const err = checkCitation(root, e.source, cache);
    if (err) push(`${at}.source`, err);
  });

  (fragment.gaps ?? []).forEach((g, i) => {
    const at = `$.gaps[${i}]`;
    if (g.at != null && !ids.has(g.at)) push(`${at}.at`, `unknown node "${g.at}"; "at" names the block the gap concerns, or leave it out`);
    const err = checkCitation(root, g.source, cache);
    if (err) push(`${at}.source`, err);
  });

  checkFlow(fragment.nodes, fragment.edges, push);

  return { ok: errors.length === 0, errors };
}

export const OVERVIEW_LIMITS = { steps: 12, files: 6 };
// What an overview block may stand for: a start only the start, a file only files; a step anything on the flow.
const ON_FLOW = ['io', 'process', 'decision', 'subprocess', 'end'];
const COVERS = { start: ['start'], end: ['end'], io: ['io'], storage: ['storage'], process: ON_FLOW, decision: ON_FLOW, subprocess: ON_FLOW };
const MUST_COVER = { decision: 'decision', subprocess: 'subprocess' };

// An overview is faithful to the detailed chart: its blocks split the detailed flow into groups (each detailed block
// in exactly one), and its arrows are exactly the detailed arrows between groups. It cannot add or drop a step or a link.
export function validateOverview(unitId, overview, detailed) {
  const errors = validateSchema(loadSchema('overview'), overview);
  if (errors.length) return { ok: false, errors };
  const push = (p, message) => errors.push({ path: p, message });
  if (overview.unit !== unitId) push('$.unit', `must be "${unitId}"`);

  const ids = new Map();
  overview.nodes.forEach((n, i) => {
    if (ids.has(n.id)) push(`$.nodes[${i}].id`, `duplicate id "${n.id}"`);
    else ids.set(n.id, n);
  });
  const steps = overview.nodes.filter((n) => ACTIONS.includes(n.kind)).length;
  if (steps > OVERVIEW_LIMITS.steps) push('$.nodes', `an overview has at most ${OVERVIEW_LIMITS.steps} steps, decisions and sub-processes (found ${steps}); group more detailed blocks into each`);
  const files = overview.nodes.filter((n) => n.kind === 'storage').length;
  if (files > OVERVIEW_LIMITS.files) push('$.nodes', `an overview shows at most ${OVERVIEW_LIMITS.files} files (found ${files}); keep the ones the reader needs: what goes in and what comes out`);
  if (overview.nodes.some((n) => n.kind === 'io' && !n.direction)) push('$.nodes', 'io needs direction');

  const detail = new Map(detailed.nodes.map((n) => [n.id, n]));
  const owner = new Map();
  overview.nodes.forEach((n, i) => {
    const at = `$.nodes[${i}].covers`;
    const kinds = [];
    for (const id of n.covers) {
      const d = detail.get(id);
      if (!d) { push(at, `"${id}" is not a block of the detailed chart`); continue; }
      kinds.push(d.kind);
      if (!COVERS[n.kind].includes(d.kind)) push(at, `a ${n.kind} cannot cover the ${d.kind} "${id}" (${d.label})`);
      if (owner.has(id)) push(at, `"${id}" (${d.label}) is already covered by "${owner.get(id)}"; each detailed block belongs to one overview block`);
      else owner.set(id, n.id);
    }
    const must = MUST_COVER[n.kind];
    if (must && !kinds.includes(must)) push(at, `a ${n.kind} covers at least one detailed ${must}`);
    if (n.kind === 'start' && kinds.length && !kinds.includes('start')) push(at, 'the start covers the detailed start');
  });
  for (const d of detailed.nodes) {
    if (d.kind !== 'storage' && !owner.has(d.id)) push('$.nodes', `the detailed ${d.kind} "${d.id}" (${d.label}) is not covered by any overview block`);
  }

  overview.edges.forEach((e, i) => {
    const at = `$.edges[${i}]`;
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    if (!from) push(`${at}.from`, `unknown node "${e.from}"`);
    if (!to) push(`${at}.to`, `unknown node "${e.to}"`);
    if (from && to) {
      const [fromKinds, toKinds] = EDGE_RULES[e.kind];
      if (!fromKinds.includes(from.kind) || !toKinds.includes(to.kind)) push(`${at}.kind`, `${e.kind} cannot go from ${from.kind} to ${to.kind}`);
    }
  });

  // The detailed arrows between groups, against the overview's own.
  const key = (e) => `${e.kind}|${e.from}|${e.to}`;
  const wanted = new Map();
  for (const e of detailed.edges) {
    const a = owner.get(e.from);
    const b = owner.get(e.to);
    if (!a || !b || a === b) continue;
    if (!wanted.has(key({ kind: e.kind, from: a, to: b }))) wanted.set(key({ kind: e.kind, from: a, to: b }), e);
  }
  const drawn = new Set(overview.edges.map(key));
  overview.edges.forEach((e, i) => {
    if (!ids.has(e.from) || !ids.has(e.to) || wanted.has(key(e))) return;
    const what = e.kind === 'flow' ? 'arrow' : `"${e.kind}" link`;
    push(`$.edges[${i}]`, `no detailed ${what} goes from a block "${e.from}" covers to a block "${e.to}" covers; draw only links the detailed chart has`);
  });
  for (const [k, e] of wanted) {
    if (e.kind !== 'flow' || drawn.has(k)) continue;
    const [, a, b] = k.split('|');
    push('$.edges', `the detailed arrow ${e.from} → ${e.to} (${detail.get(e.from).label} → ${detail.get(e.to).label}) leaves "${a}" for "${b}": add a flow "${a}" → "${b}"${e.label ? ` (labelled like "${e.label}")` : ''}, or put both blocks in one group`);
  }

  checkFlow(overview.nodes, overview.edges, push);
  return { ok: errors.length === 0, errors };
}

function checkFlow(nodes, edges, push) {
  const at = (n) => `$.nodes[${nodes.indexOf(n)}]`;
  const out = new Map(nodes.map((n) => [n.id, []]));
  const inn = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (e.kind !== 'flow' || !out.has(e.from) || !inn.has(e.to)) continue;
    out.get(e.from).push(e);
    inn.get(e.to).push(e);
  }
  const starts = nodes.filter((n) => n.kind === 'start');
  const ends = nodes.filter((n) => n.kind === 'end');
  if (starts.length !== 1) push('$.nodes', `exactly one start block is required (found ${starts.length})`);
  if (!ends.length) push('$.nodes', 'at least one end block is required');
  for (const n of nodes) {
    const exits = out.get(n.id);
    if (n.kind === 'end') continue;
    if (n.kind === 'storage') {
      if (!edges.some((e) => (e.kind === 'reads' && e.from === n.id) || (e.kind === 'writes' && e.to === n.id))) push(at(n), `storage "${n.id}" is not read or written by any block`);
    } else if (n.kind === 'decision') {
      const labels = exits.map((e) => (e.label ?? '').trim().toLowerCase());
      if (exits.length !== 2) push(at(n), `decision "${n.id}" needs exactly two outgoing flows (found ${exits.length}), one per answer; write a three-way branch as two decisions`);
      else if (!labels[0] || !labels[1] || labels[0] === labels[1]) push(at(n), `decision "${n.id}" needs a different label on each exit, normally "yes" and "no"`);
    } else if (exits.length !== 1) {
      push(at(n), `${n.kind} "${n.id}" needs exactly one outgoing flow (found ${exits.length}); parallel work is one subprocess with "parallel": true`);
    }
  }
  if (starts.length !== 1) return;
  const reach = (seeds, next) => {
    const seen = new Set(seeds);
    const queue = [...seeds];
    while (queue.length) for (const id of next(queue.pop())) if (!seen.has(id)) { seen.add(id); queue.push(id); }
    return seen;
  };
  const fromStart = reach([starts[0].id], (id) => out.get(id).map((e) => e.to));
  const toEnd = reach(ends.map((n) => n.id), (id) => inn.get(id).map((e) => e.from));
  for (const n of nodes) {
    if (n.kind === 'storage') continue;
    if (!fromStart.has(n.id)) push(at(n), `${n.kind} "${n.id}" cannot be reached from start`);
    else if (!toEnd.has(n.id)) push(at(n), `${n.kind} "${n.id}" never reaches an end`);
  }
}
