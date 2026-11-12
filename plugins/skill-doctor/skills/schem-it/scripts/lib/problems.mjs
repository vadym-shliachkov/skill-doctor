import fs from 'node:fs';
import path from 'node:path';
import { makeResolver } from './inventory.mjs';
import { parseCommand, scriptResolver, shortCommand, MAX_ROUND, SWEEP_LIMIT } from './discover.mjs';

// What schem-it can tell is wrong or unclear in the analysed units, each pinned to its unit and, when it can, its block.
// `by`: "analyst" for a gap the analyst read in the text, "script" for what the script found.

// Skills, commands, agents and agent prompts get an overview; script commands and stages are implementation.
export const OVERVIEW_KINDS = new Set(['skill', 'command', 'agent', 'prompt']);
export const SEVERITIES = ['error', 'warning', 'info'];
export const GAP_SEVERITY = { 'missing-branch': 'warning', ambiguous: 'info', contradiction: 'warning', undefined: 'warning', 'unbounded-loop': 'warning' };
// What each kind is called on a problem's row.
export const PROBLEM_TITLES = {
  'analysis-failed': 'Analysis failed', missing: 'Not found', 'load-missing': 'Loaded file not found', 'reference-missing': 'Reference not found',
  'script-not-found': 'Script not found', unresolved: 'Callee not named', 'tool-not-allowed': 'Not in allowed tools', 'never-written': 'Read but never produced',
  'never-read': 'Written but never used', 'not-run': 'Not run by anything', 'not-drawn': 'Not drawn', 'no-overview': 'No overview',
  'missing-branch': 'Unhandled outcome', ambiguous: 'Ambiguous step', contradiction: 'Contradiction', undefined: 'Never defined', 'unbounded-loop': 'Loop without a limit',
};
const BLOCKS = new Set(['start', 'end', 'io', 'process', 'decision', 'subprocess', 'storage']);

export const normPath = (p) => String(p).replace(/^\.\//, '').replace(/^<ROOT>\//, '').trim();
const baseOf = (p) => path.posix.basename(normPath(p)).toLowerCase();
const dirOf = (p) => path.posix.dirname(normPath(p));
const q = (n) => `"${n.label}"`;

export function countProblems(problems = []) {
  const out = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const p of problems) out[p.severity]++;
  return out;
}

// allowed-tools: Read, Grep, Bash(node:*) - a list, a comma-separated string, or (no commas) a space-separated one.
export function splitTools(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  const text = String(raw ?? '');
  const parts = (sepRe) => {
    const out = [];
    let cur = '';
    let depth = 0;
    for (const c of text) {
      if (c === '(') depth++;
      if (c === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && sepRe.test(c)) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  };
  const byComma = parts(/,/);
  return byComma.length > 1 ? byComma : parts(/\s/);
}

// One Bash(...) pattern as a test on a command, or null when its wildcards cannot be decided safely.
function bashMatcher(pattern) {
  const s = shortCommand(pattern.trim());
  let m;
  if ((m = /^(.*?):\*$/.exec(s)) && !m[1].includes('*')) return (c) => c === m[1] || c.startsWith(`${m[1]} `);
  if ((m = /^(.*?) \*$/.exec(s)) && !m[1].includes('*')) return (c) => c === m[1] || c.startsWith(`${m[1]} `);
  if ((m = /^([^*]*)\*$/.exec(s))) return (c) => c.startsWith(m[1]);
  if (!s.includes('*')) return (c) => c === s;
  return null;
}

// What the unit's frontmatter lets it run through Bash; null when it does not say (everything is allowed).
export function bashRule(raw) {
  if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length)) return null;
  const list = splitTools(raw);
  const bash = list.filter((t) => /^Bash(?:\(|$)/.test(t));
  if (bash.some((t) => t === 'Bash' || /^Bash\(\s*\*?\s*\)$/.test(t))) return { list, all: true, matchers: [], unsure: false };
  const inner = bash.map((t) => /^Bash\((.*)\)$/s.exec(t)?.[1]).filter((x) => x != null);
  const matchers = inner.map(bashMatcher);
  return { list, all: false, matchers: matchers.filter(Boolean), unsure: matchers.some((x) => !x) || inner.length < bash.length };
}

// A command whose permission check could not be decided from its text: chained, piped, substituted or not a program name.
const UNDECIDABLE = /&&|\|\||;|\||`|\$\(/;
export function commandAllowed(rule, command) {
  const c = String(command).trim();
  if (!rule || rule.all) return true;
  if (!/^[a-z][\w.+-]*(?:\s|$)/.test(c) || UNDECIDABLE.test(c)) return true;
  if (rule.matchers.some((m) => m(c))) return true;
  return rule.unsure ? true : false;
}

const commandOf = (n) => (n.kind === 'process' ? n.command : n.kind === 'subprocess' && n.calls === 'command' && /\s/.test(String(n.target).trim()) ? shortCommand(n.target) : null);

function missingMessage(n, t) {
  if (/\.md$/i.test(t) && !/\s/.test(t)) return `${q(n)} hands over the prompt ${t}, but no such file is in the analysed folder.`;
  switch (n.calls) {
    case 'agent': return `${q(n)} starts the agent ${t}, but no agent of that name is defined in the analysed plugin.`;
    case 'function': return `${q(n)} calls ${t}, but that file or function is not in the analysed folder.`;
    case 'command': return `${q(n)} runs the command ${t}, but the analysed plugin has no command or skill of that name.`;
    default: return `${q(n)} invokes the skill ${t}, but the analysed plugin has no skill of that name.`;
  }
}

export function computeProblems({ scanRes, inventory = {}, nodes, edges, gaps = [] }) {
  const root = scanRes.root;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const unitOrder = new Map(scanRes.units.map((u, i) => [u.skillNode, i]));
  const nodeOrder = new Map(nodes.map((n, i) => [n.id, i]));
  const out = [];
  const add = (p) => out.push(p);
  const blocksOf = (u) => nodes.filter((n) => n.parent === u.skillNode && !n.layer && BLOCKS.has(n.kind));
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

  for (const u of scanRes.units) {
    const owner = byId.get(u.skillNode);
    if (!owner) continue;
    const inv = inventory.units?.[u.id];
    const blocks = blocksOf(u);
    const refs = new Set();
    const unitLevel = (severity, kind, message, extra = {}) => add({ severity, kind, by: 'script', unit: u.skillNode, message, ...extra });
    const onNode = (n, severity, kind, message, ref) => {
      if (ref) refs.add(ref);
      add({ severity, kind, by: 'script', unit: u.skillNode, node: n.id, message, ...(n.source ? { source: n.source } : {}) });
    };

    if (owner.analysis === 'failed') unitLevel('error', 'analysis-failed', 'No valid flowchart from the analyst was saved for this unit, so the chart shows only what the script found in the text, in the order the text mentions it.');
    else if (OVERVIEW_KINDS.has(u.kind) && !nodes.some((n) => n.parent === u.skillNode && n.layer === 'overview')) {
      unitLevel('info', 'no-overview', 'No plain-language overview was made for this unit, so only its detailed chart is shown.');
    }
    if (u.sweep) unitLevel('info', 'not-run', `Nothing in the analysed skills, commands, agents or scripts runs ${u.script}; it may be unused or meant to be run by hand.`, owner.source ? { source: owner.source } : {});

    const runs = scriptResolver(scanRes, u);
    const bases = [u.dir, u.skillDir, u.pluginDir, '.'].filter((d) => d != null);
    const rule = bashRule(u.kind === 'agent' ? inv?.frontmatter?.tools : inv?.frontmatter?.['allowed-tools']);
    const field = u.kind === 'agent' ? 'tools' : 'allowed-tools';
    for (const n of blocks) {
      if (n.kind === 'subprocess' && n.missing) {
        for (const t of n.missingTargets ?? [n.target]) onNode(n, 'error', 'missing', missingMessage(n, t), normPath(t));
      }
      for (const p of n.loadsMissing ?? []) onNode(n, 'warning', 'load-missing', `${q(n)} loads ${p}, but no such file is in the analysed folder.`, normPath(p));
      if (n.kind === 'subprocess' && n.unresolved) {
        onNode(n, 'info', 'unresolved', `${q(n)} hands work to ${n.calls === 'skill' ? 'a skill' : 'an agent'} the text describes only as "${n.target}", so the chart cannot tell which one runs or open it.`);
      }
      const cmd = commandOf(n);
      if (!cmd || n.user) continue;
      // A script path that does not resolve, under a folder that does exist (scripts/ is there, scripts/x.mjs is not).
      const c = parseCommand(cmd, runs);
      if (c && !c.file && !/^(?:[/~$%]|[A-Za-z]:)|<[^>]+>|\$\{/.test(c.script)) {
        const top = c.script.replace(/\\/g, '/').split('/')[0];
        if (top !== c.script && top !== '..' && bases.some((b) => isDir(path.join(root, b, top)))) {
          onNode(n, 'warning', 'script-not-found', `${q(n)} runs ${c.script}, but no such file is in the analysed folder.`, normPath(c.script));
        }
      }
      if (!commandAllowed(rule, cmd)) {
        onNode(n, u.kind === 'agent' ? 'warning' : 'info', 'tool-not-allowed', u.kind === 'agent'
          ? `${q(n)} runs \`${cmd}\`, but the agent's tools (${rule.list.join(', ')}) do not let it run that command.`
          : `${q(n)} runs \`${cmd}\`, which the unit's allowed-tools (${rule.list.join(', ')}) does not cover, so Claude Code asks for permission each time and a non-interactive run may refuse it.`);
      }
    }

    // References the script found in the text that point at nothing, unless a block already says so.
    for (const f of inv?.facts ?? []) {
      if (!f.missing || f.negated) continue;
      const ref = normPath(f.path ?? f.target);
      const mention = f.mention ? normPath(f.mention) : null;
      if (refs.has(ref) || (mention && refs.has(mention)) || [...refs].some((r) => baseOf(r) === baseOf(ref))) continue;
      // The inventory looks only in the unit's own folders; an agent naming scripts/x.mjs means the plugin's skill that has it.
      if (f.kind === 'file' && runs(f.path)) continue;
      const at = blocks.find((n) => n.fact === f.id);
      const message = f.kind === 'skill'
        ? `The text invokes ${f.mention}, but the analysed plugin has no skill or command of that name.`
        : `The text refers to ${f.path}, but no such file is in the analysed folder.`;
      add({ severity: 'warning', kind: 'reference-missing', by: 'script', unit: u.skillNode, ...(at ? { node: at.id } : {}), message, source: f.source });
      refs.add(ref);
    }
  }

  for (const g of gaps) add({ severity: GAP_SEVERITY[g.kind] ?? 'warning', kind: g.kind, by: 'analyst', unit: g.unit, ...(g.node && byId.has(g.node) ? { node: g.node } : {}), message: g.text, source: g.source });

  fileProblems({ scanRes, nodes, edges, byId, add });

  for (const l of scanRes.left ?? []) {
    const caller = l.caller && scanRes.units.find((x) => x.id === l.caller);
    const what = l.kind === 'stage' ? `The stage ${l.target}` : l.kind === 'sweep' ? `The script ${l.target}, which nothing runs,` : `The script command ${l.target}`;
    add({ severity: 'info', kind: 'not-drawn', by: 'script', unit: caller?.skillNode ?? scanRes.rootId, message: `${what} was not drawn: the analysis stops after ${MAX_ROUND} rounds and ${SWEEP_LIMIT} scripts that nothing runs.` });
  }

  const rank = (p) => [unitOrder.get(p.unit) ?? -1, SEVERITIES.indexOf(p.severity), p.node ? nodeOrder.get(p.node) ?? 0 : -1];
  out.sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return out.map((p, i) => ({ id: `p${i + 1}`, severity: p.severity, kind: p.kind, title: PROBLEM_TITLES[p.kind] ?? p.kind, ...p }));
}

// Files across all charts: one read where nothing writes it, or written where nothing reads it. Both only inside a
// folder the charts themselves write to and read from (a run folder), since a file outside it is often the user's own.
function fileProblems({ scanRes, nodes, edges, byId, add }) {
  const unitOf = new Map(scanRes.units.map((u) => [u.skillNode, u]));
  const files = nodes.filter((n) => n.kind === 'storage' && !n.layer && n.path && unitOf.has(n.parent));
  const detailed = edges.filter((e) => !e.layer);
  const readsOf = (n) => detailed.filter((e) => e.kind === 'reads' && e.from === n.id);
  const writesOf = (n) => detailed.filter((e) => e.kind === 'writes' && e.to === n.id);
  const read = new Set();
  const written = new Set();
  const readDirs = new Set();
  const writeDirs = new Set();
  for (const n of files) {
    const dir = dirOf(n.path);
    if (readsOf(n).length) { read.add(baseOf(n.path)); if (dir !== '.') readDirs.add(dir); }
    if (writesOf(n).length) { written.add(baseOf(n.path)); if (dir !== '.') writeDirs.add(dir); }
  }
  // Instruction files a step loads are read too.
  for (const n of nodes) for (const p of n.loads ?? []) read.add(baseOf(p));
  const ioText = (u, direction) => nodes.filter((n) => n.kind === 'io' && n.direction === direction && !n.layer && (!u || n.parent === u))
    .map((n) => `${n.label} ${n.role ?? ''}`.toLowerCase()).join(' \n ');
  const handedOut = ioText(null, 'out');
  const unread = new Set();
  for (const n of files) {
    const u = unitOf.get(n.parent);
    const name = baseOf(n.path);
    const dir = dirOf(n.path);
    if (dir === '.') continue;
    const r = readsOf(n);
    const w = writesOf(n);
    if (r.length && !written.has(name) && writeDirs.has(dir) && !ioText(n.parent, 'in').includes(name) && !makeResolver(scanRes.root, u)(normPath(n.path))) {
      const reader = byId.get(r[0].to);
      add({ severity: 'warning', kind: 'never-written', by: 'script', unit: n.parent, node: n.id, message: `${n.path} is read by ${reader ? q(reader) : 'a step'}, but no analysed unit writes it and it is not in the analysed folder, so nothing says where it comes from.`, ...(n.source ? { source: n.source } : {}) });
    }
    // Once per file: a skill and the script it runs both draw the same file, and the first unit is the one a reader opens.
    if (w.length && !read.has(name) && readDirs.has(dir) && !handedOut.includes(name) && !unread.has(name)) {
      unread.add(name);
      const writer = byId.get(w[0].from);
      add({ severity: 'info', kind: 'never-read', by: 'script', unit: n.parent, node: n.id, message: `${n.path} is written by ${writer ? q(writer) : 'a step'}, but nothing in the analysed units reads it and no output step names it; if it is a result for the user, the text never hands it over.`, ...(n.source ? { source: n.source } : {}) });
    }
  }
}
