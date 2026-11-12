import fs from 'node:fs';
import path from 'node:path';
import { readText, splitLines } from './io.mjs';
import { rel, isInside } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

// "e.g." ends in a dot, so it stays outside the \b...\b group: no word boundary follows the dot.
const NEGATION = /\b(?:do not|don't|never|not|avoid|instead of|rather than|for example|example|such as)\b|\be\.g\./i;
// Product names that look like file names.
const NOT_FILES = /^(?:Node|Next|Nuxt|Vue|React|Three|Express|Deno)\.js$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
// A leading dot belongs to the name (.mcp.json, .claude/settings.json); one after a letter ends a sentence or a domain.
const FILE_RE = /(?:\$\{CLAUDE_SKILL_DIR\}\/|\$\{CLAUDE_PLUGIN_ROOT\}\/|<SKILL_DIR>\/)?((?:\.{1,2}\/)*(?<![A-Za-z0-9_])\.?[A-Za-z0-9_-][A-Za-z0-9_.\-/]*\.(?:md|mjs|cjs|js|ts|json|sh|py|ps1|cmd|html|css|ya?ml))(?![A-Za-z0-9_])/g;
const ROLE_DIRS = { scripts: 'script', references: 'reference', templates: 'template', agents: 'agent' };
const QUALIFIED_RE = /(?<![\w/.-])(\/?)([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9-]*)(?![\w-])/g;
const SLASH_RE = /(?<![\w/.:-])\/([a-z0-9][a-z0-9-]+)(?![\w/.:-])/g;
const DISPATCH_RE = /subagent_type[`"'\s:=]+([A-Za-z0-9_:-]+)|\b(spawn_agent)\b|\b(?:Agent|Task) tool\b/g;
const MCP_RE = /\bmcp__[A-Za-z0-9_-]+/g;
const SKIP_DIRS = new Set(['node_modules', '.git', '.schem-it']);

export function knownSkills(scanRes) {
  const byQualified = new Map();
  const byName = new Map();
  const plugins = new Set();
  const agents = new Set();
  // Every analysed file, so a sub-process that names its callee by path (agents/backlog.md) finds its flowchart.
  const byFile = new Map(scanRes.units.filter((u) => u.kind !== 'script').map((u) => [u.file, { id: u.skillNode, plugin: u.plugin }]));
  // Script commands by script file and subcommand, so a step that runs one opens its chart.
  const byScript = new Map(scanRes.units.filter((u) => u.kind === 'script' && !u.symbol).map((u) => [`${u.script}|${u.subcommand ?? ''}`, u.skillNode]));
  // Pipeline stages by file#function, so a call of kind "function" opens its chart.
  const byStage = new Map(scanRes.units.filter((u) => u.kind === 'script' && u.symbol).map((u) => [`${u.script}#${u.symbol}`, u.skillNode]));
  for (const c of scanRes.containers) {
    if (c.kind === 'plugin') plugins.add(c.id.slice(2));
    if (c.kind === 'agent-def') agents.add(c.id.slice(2).replace('/', ':'));
    if (c.kind !== 'skill' && c.kind !== 'command') continue;
    const unitId = c.id.slice(2);
    const [plugin, name] = unitId.includes('/') ? unitId.split('/') : [null, unitId];
    if (plugin) byQualified.set(`${plugin}:${name}`, c.id);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(c.id);
  }
  return { byQualified, byName, plugins, agents, byFile, byScript, byStage, root: scanRes.root };
}

export function makeResolver(root, unit) {
  // An agent prompt lives in <skill>/agents/ but names files relative to its skill folder.
  const bases = [path.join(root, unit.dir), ...(unit.skillDir ? [path.join(root, unit.skillDir)] : []), path.join(root, unit.pluginDir), root];
  const tryAll = (p) => {
    for (const base of bases) {
      const abs = path.join(base, p);
      // Never outside the analysed folder: a path climbing out of it (../../tools/x.mjs) names nothing we analyse.
      if (isInside(root, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return rel(root, abs);
    }
    return null;
  };
  return (p, fromFile) => {
    if (fromFile && p.startsWith('../')) {
      const abs = path.join(root, path.dirname(fromFile), p);
      return isInside(root, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile() ? rel(root, abs) : null;
    }
    // Any leading placeholder stands for a folder of the skill or plugin: <SKILL_DIR>/, <skill-creator-path>/, ${CLAUDE_PLUGIN_ROOT}/.
    const clean = p.replace(/^(?:<[^>/]+>|\$\{CLAUDE_SKILL_DIR\}|\$\{CLAUDE_PLUGIN_ROOT\})\//, '').replace(/^\.\//, '');
    // A path written relative to the plugin (skills/<name>/x.md) still resolves when only the skill is analysed.
    const inSkill = /^(?:.*\/)?skills\/[^/]+\/(.+)$/.exec(clean);
    // A bare script name (`build.py --strict`) usually means the scripts/ folder next to the skill or at the root.
    return tryAll(clean) ?? (inSkill ? tryAll(inSkill[1]) : null) ?? (clean.includes('/') ? null : tryAll(`scripts/${clean}`));
  };
}

function nameRegex(names) {
  if (!names.length) return null;
  const alt = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![\\w/:.-])(${alt})(?![\\w-])`, 'g');
}

export function extractFacts(text, file, ctx) {
  const { known, selfId, selfPlugin, resolve } = ctx;
  // An agent prompt that names its own skill ("a re-run of site-audit") describes it; it does not call it.
  const self = new Set([selfId, ctx.owner].filter(Boolean));
  const bareNames = [...known.byName.keys()].filter((n) => n.length >= 4 && !(known.byName.get(n).length === 1 && self.has(known.byName.get(n)[0])));
  const bareRe = nameRegex(bareNames);
  const facts = new Map();
  const lines = splitLines(text);
  // The frontmatter describes the unit ("Started by the x skill"): a name in it is not a call, a path in it is not a file the unit uses.
  const frontmatterEnd = parseFrontmatter(text).endLine;
  // Under a heading that names an example, every path and call belongs to the example, not to the unit.
  let example = null;
  let fence = false;

  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = fence ? null : HEADING_RE.exec(line);
    if (heading && (example === null || heading[1].length <= example)) example = /\bexamples?\b/i.test(heading[2]) ? heading[1].length : null;
    const add = (key, index, quote, fact) => {
      const negated = example !== null || NEGATION.test(line.slice(Math.max(0, index - 80), index));
      const prev = facts.get(key);
      if (prev) {
        prev.occurrences++;
        prev.negated = prev.negated && negated;
        return;
      }
      facts.set(key, { ...fact, negated, occurrences: 1, source: { file, lines: [i + 1, i + 1], quote } });
    };
    const lookupName = (name) => {
      const ids = known.byName.get(name) ?? [];
      return ids.find((id) => selfPlugin && id.startsWith(`s:${selfPlugin}/`)) ?? (ids.length === 1 ? ids[0] : null);
    };
    const addSkill = (index, mention, target, extra = {}) => {
      if (self.has(target)) return;
      add(`skill|${target}`, index, mention, { kind: 'skill', mention, target, missing: false, outOfScope: false, ...extra });
    };

    if (i < frontmatterEnd) {
      for (const m of line.matchAll(MCP_RE)) add(`external|${m[0]}`, m.index, m[0], { kind: 'external', name: m[0] });
      return;
    }
    for (const m of line.matchAll(FILE_RE)) {
      if (/[a-z]+:\/\/\S*$/i.test(line.slice(0, m.index))) continue;
      const p = m[1].replace(/^\.\//, '');
      if (NOT_FILES.test(p)) continue;
      // The role comes from the path's first folder only, so example paths like src/agents/x.ts are not references.
      const first = p.replace(/^(?:\.\.\/)+/, '').replace(/^(?:.*\/)?skills\/[^/]+\//, '').split('/')[0];
      const seg = p.includes('/') && ROLE_DIRS[first] ? first : null;
      const resolved = resolve(p, file);
      const role = seg ? ROLE_DIRS[seg] : resolved ? 'file' : 'artifact';
      add(`file|${p}`, m.index, m[0], { kind: 'file', path: p, role, resolved, missing: Boolean(seg) && !resolved });
    }
    for (const m of line.matchAll(QUALIFIED_RE)) {
      const [, slash, plugin, name] = m;
      const key = `${plugin}:${name}`;
      if (known.agents?.has(key) || /subagent_type\W*$/.test(line.slice(0, m.index))) continue;
      const id = known.byQualified.get(key);
      if (id) addSkill(m.index, m[0], id);
      else if (known.plugins.has(plugin)) addSkill(m.index, m[0], key, { missing: true });
      else if (slash) addSkill(m.index, m[0], key, { outOfScope: true });
    }
    for (const m of line.matchAll(SLASH_RE)) {
      const id = lookupName(m[1]);
      if (id) addSkill(m.index, m[0], id);
    }
    if (bareRe) {
      for (const m of line.matchAll(bareRe)) {
        const id = lookupName(m[1]);
        if (id) addSkill(m.index, m[0], id);
      }
    }
    for (const m of line.matchAll(DISPATCH_RE)) {
      const agentType = m[1] ?? (m[2] ? 'spawn_agent' : null);
      add(`dispatch|${agentType ?? '*'}`, m.index, m[0], { kind: 'dispatch', agentType });
    }
    for (const m of line.matchAll(MCP_RE)) add(`external|${m[0]}`, m.index, m[0], { kind: 'external', name: m[0] });
  });

  return [...facts.values()]
    .sort((a, b) => a.source.lines[0] - b.source.lines[0])
    .map((f, i) => ({ id: `f${i + 1}`, ...f }));
}

function listFiles(root, dir, out = [], limit = 200) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= limit) break;
    if (SKIP_DIRS.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) listFiles(root, abs, out, limit);
    else out.push(rel(root, abs));
  }
  return out;
}

export function inventoryUnit(scanRes, unit, known) {
  const root = scanRes.root;
  const skillDir = path.join(root, unit.dir);
  const skillText = readText(path.join(root, unit.file));
  const fm = parseFrontmatter(skillText);
  const warnings = fm.error ? [fm.error] : [];
  const ctx = { known, selfId: unit.skillNode, owner: unit.owner, selfPlugin: unit.plugin, resolve: makeResolver(root, unit) };
  // A bundled prompt is handed over together with a shared one (agents/_contract.md): its facts count for both.
  const sources = [[unit.file, skillText], ...(unit.with ?? []).map((w) => [w.file, readText(path.join(root, w.file))])];
  const singleFile = unit.kind !== 'skill';
  const agentsDir = path.join(skillDir, 'agents');
  if (!singleFile && fs.existsSync(agentsDir)) {
    for (const f of fs.readdirSync(agentsDir).filter((x) => x.endsWith('.md')).sort()) {
      const abs = path.join(agentsDir, f);
      sources.push([rel(root, abs), readText(abs)]);
    }
  }
  const all = sources.flatMap(([file, text]) => extractFacts(text, file, ctx));
  const seen = new Set();
  const facts = all.filter((f) => {
    const key = `${f.kind}|${f.path ?? f.target ?? f.agentType ?? f.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((f, i) => ({ ...f, id: `f${i + 1}` }));
  return {
    unit: unit.id,
    frontmatter: fm.data,
    frontmatterEnd: fm.endLine,
    files: singleFile ? [path.posix.basename(unit.file)] : listFiles(skillDir, skillDir),
    facts,
    warnings,
  };
}

export function inventoryAll(scanRes) {
  const known = knownSkills(scanRes);
  return Object.fromEntries(scanRes.units.map((u) => [u.id, inventoryUnit(scanRes, u, known)]));
}
