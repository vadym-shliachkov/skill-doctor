import fs from 'node:fs';
import path from 'node:path';
import { readJson, readText, splitLines } from './io.mjs';
import { absRoot, rel, slug, isInside } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { detect, pluginManifest, isDir } from './detect.mjs';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
// A command with at least this many non-blank body lines, or this many numbered steps, is a workflow of its own and
// is analysed like a skill; a shorter one is usually a wrapper that hands over to a skill and stays a plain box.
export const COMMAND_UNIT_LINES = 10;
export const COMMAND_UNIT_STEPS = 3;

export function citeLine(root, absFile, pattern) {
  const lines = splitLines(readText(absFile));
  let idx = pattern ? lines.findIndex((l) => pattern.test(l)) : -1;
  if (idx === -1) idx = lines.findIndex((l) => l.trim() !== '');
  if (idx === -1) idx = 0;
  return { file: rel(root, absFile), lines: [idx + 1, idx + 1], quote: (lines[idx] ?? '').trim() };
}

export function globToRegex(globs) {
  const parts = String(globs).split(',').map((g) => g.trim()).filter(Boolean)
    .map((g) => g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
  return new RegExp(`^(?:${parts.join('|')})$`);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, name) => new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`, 'i').test(text);

const listDirs = (dir) => (isDir(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);
const listMd = (dir) => (isDir(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);

export function scan(rootArg, { only } = {}) {
  const root = absRoot(rootArg);
  if (!isDir(root)) throw new Error(`Not a directory: ${root}`);
  const d = detect(root);
  const ctx = { root, containers: [], units: [], warnings: [...d.warnings], only: only ? globToRegex(only) : null };
  let rootId;
  if (d.level === 'skill') {
    rootId = addSkill(ctx, root, null, null, root);
  } else if (d.level === 'plugin') {
    rootId = addPlugin(ctx, d.plugins[0], null);
  } else {
    rootId = `m:${slug(d.name) || 'marketplace'}`;
    const file = path.join(root, d.manifestFile);
    ctx.containers.push({ id: rootId, parent: null, kind: 'marketplace', label: d.name, description: null, source: citeLine(root, file, /"name"\s*:/) });
    for (const p of d.plugins) addPlugin(ctx, p, rootId);
  }
  if (!ctx.units.length) ctx.warnings.push('No skills to analyse: no SKILL.md or command with a workflow found, or --only matched none');
  return { version: 1, root, level: d.level, name: d.name, rootId, containers: ctx.containers, units: ctx.units, warnings: ctx.warnings };
}

function addPlugin(ctx, plugin, parentId) {
  const { root } = ctx;
  const dir = plugin.dir;
  const manifest = pluginManifest(dir, ctx.warnings, root);
  const key = slug(plugin.name) || 'plugin';
  const id = `p:${key}`;
  ctx.containers.push({
    id,
    parent: parentId,
    kind: 'plugin',
    label: plugin.name,
    description: plugin.description ?? str(manifest?.data.description),
    source: manifest ? citeLine(root, path.join(root, manifest.file), /"name"\s*:/) : null,
    ...(plugin.includes?.length ? { includes: plugin.includes.map((f) => rel(root, f)) } : {}),
  });
  for (const name of listDirs(path.join(dir, 'skills'))) {
    const skillDir = path.join(dir, 'skills', name);
    if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) addSkill(ctx, skillDir, key, id, dir);
  }
  const agents = [];
  for (const f of listMd(path.join(dir, 'agents'))) {
    const file = path.join(dir, 'agents', f);
    const fm = parseFrontmatter(readText(file));
    if (fm.error) ctx.warnings.push(`${rel(root, file)}: ${fm.error}`);
    // A file without a name or description in its frontmatter (a README, notes) is not an agent definition.
    if (!str(fm.data.name) && !str(fm.data.description)) continue;
    const name = str(fm.data.name) ?? f.replace(/\.md$/, '');
    const node = {
      id: `a:${key}/${slug(name) || 'agent'}`, parent: id, kind: 'agent-def', label: name,
      description: str(fm.data.description), tools: str(Array.isArray(fm.data.tools) ? fm.data.tools.join(', ') : fm.data.tools),
      source: citeLine(root, file, /^name\s*:/),
    };
    ctx.containers.push(node);
    agents.push({ node, name, file });
  }
  for (const f of listMd(path.join(dir, 'commands'))) addCommand(ctx, path.join(dir, 'commands', f), key, id, dir);
  addAgentUnits(ctx, agents, key, dir);
  const hooksRel = typeof manifest?.data.hooks === 'string' ? manifest.data.hooks : 'hooks/hooks.json';
  const hooksFile = path.join(dir, hooksRel);
  if (!isInside(root, hooksFile)) ctx.warnings.push(`${rel(root, dir)}: hooks file is outside the analysed folder; skipped: ${hooksRel}`);
  else if (fs.existsSync(hooksFile)) {
    let hooks = null;
    try { hooks = readJson(hooksFile).hooks; } catch (e) { ctx.warnings.push(`${rel(root, hooksFile)}: ${e.message}`); }
    for (const [event, groups] of Object.entries(hooks ?? {})) {
      (Array.isArray(groups) ? groups : []).forEach((g, i) => {
        const label = `${event}${g.matcher ? `: ${g.matcher}` : ''}`;
        ctx.containers.push({
          id: `h:${key}/${slug(event) || 'hook'}.${i}`, parent: id, kind: 'hook',
          label: label.length > 60 ? `${label.slice(0, 57)}...` : label,
          command: (g.hooks ?? []).map((x) => x.command).filter(Boolean).join(' ; ') || null,
          source: citeLine(root, hooksFile, new RegExp(`"${escapeRe(event)}"`)),
        });
      });
    }
  }
  return id;
}

function addAgentUnits(ctx, agents, pluginKey, pluginDir) {
  const { root } = ctx;
  const unitOf = (a) => ({
    id: `${pluginKey}/agent-${a.node.id.slice(a.node.id.indexOf('/') + 1)}`, kind: 'agent', skillNode: a.node.id, plugin: pluginKey,
    name: a.name, dir: rel(root, path.dirname(a.file)), file: rel(root, a.file), pluginDir: rel(root, pluginDir),
  });
  const chosen = new Set(agents.filter((a) => !ctx.only || ctx.only.test(unitOf(a).id)));
  if (ctx.only) {
    // --only also takes the agents a selected unit names, and the agents those name, so their sub-processes have a flowchart to open.
    const queue = [...ctx.units.filter((u) => u.plugin === pluginKey).map((u) => path.join(root, u.file)), ...[...chosen].map((a) => a.file)];
    while (queue.length) {
      const text = readText(queue.pop());
      for (const a of agents) {
        if (chosen.has(a) || !mentions(text, a.name)) continue;
        chosen.add(a);
        queue.push(a.file);
      }
    }
  }
  for (const a of agents) {
    if (!chosen.has(a)) { a.node.analysis = 'skipped'; continue; }
    const unit = unitOf(a);
    if (ctx.units.some((u) => u.id === unit.id)) { ctx.warnings.push(`Skipped agent ${unit.file}: unit id "${unit.id}" is taken`); continue; }
    ctx.units.push(unit);
  }
}

function addCommand(ctx, file, pluginKey, parentId, pluginDir) {
  const { root } = ctx;
  const text = readText(file);
  const fm = parseFrontmatter(text);
  const name = path.basename(file).replace(/\.md$/, '');
  const key = slug(name) || 'command';
  const node = { id: `c:${pluginKey}/${key}`, parent: parentId, kind: 'command', label: `/${name}`, description: str(fm.data.description), source: citeLine(root, file, /^description\s*:/) };
  ctx.containers.push(node);
  const body = splitLines(text).slice(fm.endLine).filter((l) => l.trim());
  const steps = body.filter((l) => /^\s*\d+[.)]\s/.test(l)).length;
  let unitId = `${pluginKey}/${key}`;
  if (body.length < COMMAND_UNIT_LINES && steps < COMMAND_UNIT_STEPS) {
    node.wrapper = true;
    if (!ctx.only || ctx.only.test(unitId)) {
      ctx.warnings.push(`Command /${name} not analysed: ${body.length} line${body.length === 1 ? '' : 's'} and ${steps || 'no'} numbered step${steps === 1 ? '' : 's'}, so it is drawn as a box that hands over to what it names`);
    }
    return;
  }
  if (ctx.units.some((u) => u.id === unitId)) {
    unitId = `${pluginKey}/cmd-${key}`;
    ctx.warnings.push(`Command /${name} has the same name as a skill; its unit is "${unitId}"`);
    if (ctx.units.some((u) => u.id === unitId)) { ctx.warnings.push(`Skipped duplicate command ${rel(root, file)}`); return; }
  }
  if (fm.error) {
    node.warnings = [fm.error];
    ctx.warnings.push(`${rel(root, file)}: ${fm.error}`);
  }
  if (ctx.only && !ctx.only.test(unitId)) { node.analysis = 'skipped'; return; }
  ctx.units.push({ id: unitId, kind: 'command', skillNode: node.id, plugin: pluginKey, name: `/${name}`, dir: rel(root, path.dirname(file)), file: rel(root, file), pluginDir: rel(root, pluginDir) });
}

function addSkill(ctx, skillDir, pluginName, parentId, pluginDir) {
  const { root } = ctx;
  const file = path.join(skillDir, 'SKILL.md');
  const fm = parseFrontmatter(readText(file));
  let name = str(fm.data.name) ?? path.basename(skillDir);
  let key = slug(name) || slug(path.basename(skillDir)) || 'skill';
  if (key !== name) ctx.warnings.push(`Skill name "${name}" in ${rel(root, skillDir)} is not a safe id; using "${key}"`);
  let unitId = pluginName ? `${pluginName}/${key}` : key;
  if (ctx.units.some((u) => u.id === unitId)) {
    ctx.warnings.push(`Duplicate skill name "${name}" in ${rel(root, skillDir)}; using the folder name`);
    name = path.basename(skillDir);
    key = slug(name) || 'skill';
    unitId = pluginName ? `${pluginName}/${key}` : key;
    if (ctx.units.some((u) => u.id === unitId)) { ctx.warnings.push(`Skipped duplicate skill ${rel(root, skillDir)}`); return null; }
  }
  const id = `s:${unitId}`;
  const node = { id, parent: parentId, kind: 'skill', label: name, description: str(fm.data.description), source: citeLine(root, file, /^name\s*:/) };
  if (fm.error) {
    node.warnings = [fm.error];
    ctx.warnings.push(`${rel(root, file)}: ${fm.error}`);
  }
  if (ctx.only && !ctx.only.test(unitId)) node.analysis = 'skipped';
  ctx.containers.push(node);
  if (node.analysis !== 'skipped') {
    ctx.units.push({ id: unitId, kind: 'skill', skillNode: id, plugin: pluginName, name, dir: rel(root, skillDir), file: rel(root, file), pluginDir: rel(root, pluginDir) });
  }
  addPrompts(ctx, skillDir, { unitId, nodeId: id, name, plugin: pluginName, selected: node.analysis !== 'skipped' }, pluginDir);
  return id;
}

const SCRIPT_EXT = /\.(?:mjs|cjs|js|ts|py|sh|ps1)$/;
const listScripts = (dir, out = []) => {
  if (!isDir(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= 100 || d.name === 'node_modules' || d.name === 'vendor') continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) listScripts(abs, out);
    else if (SCRIPT_EXT.test(d.name)) out.push(abs);
  }
  return out;
};

// agents/ then a placeholder then .md: `agents/${o.area}.md`, 'agents/' + area + '.md', f"agents/{area}.md", agents/<area>.md, agents/%s.md.
export const COMPUTED_PROMPT_RE = /agents\/(?:\$\{[^}]+\}|\{[^}]+\}|<[^>\s]+>|%s|['"`]\s*\+\s*[\w.[\]]+\s*\+\s*['"`])\.md/;
// A prompt named this close to a computed path is handed over together with the prompts that path stands for.
const BUNDLE_LINES = 5;
const NOT_PROMPTS = /^readme\.md$/i;

// Every Markdown file in a skill's agents/ folder is the task of a subagent and gets a flowchart of its own. Its refs are
// the lines that hand it over: agents/<file>.md by name, else the computed paths (agents/${area}.md) that stand for it.
function addPrompts(ctx, skillDir, skill, pluginDir) {
  const { root } = ctx;
  const dir = path.join(skillDir, 'agents');
  const files = listMd(dir).filter((f) => !NOT_PROMPTS.test(f));
  if (!files.length) return;
  const sources = [path.join(skillDir, 'SKILL.md'), ...files.map((f) => path.join(dir, f)), ...listScripts(path.join(skillDir, 'scripts'))]
    .map((abs) => ({ abs, file: rel(root, abs), lines: splitLines(readText(abs)) }));
  const unitIdOf = (f) => `${skill.unitId}/${slug(f.replace(/\.md$/, '')) || 'prompt'}`;
  const direct = new Map(files.map((f) => {
    const re = new RegExp(`(?<![\\w.-])agents/${escapeRe(f)}(?![\\w-])`);
    const refs = [];
    for (const s of sources) {
      if (s.abs === path.join(dir, f)) continue;
      const i = s.lines.findIndex((l) => re.test(l));
      if (i !== -1) refs.push({ file: s.file, lines: [i + 1, i + 1], quote: `agents/${f}` });
    }
    return [f, refs];
  }));
  const computed = [];
  for (const s of sources) {
    s.lines.forEach((l, i) => {
      const m = COMPUTED_PROMPT_RE.exec(l);
      if (!m) return;
      const near = files.filter((f) => direct.get(f).some((r) => r.file === s.file && Math.abs(r.lines[0] - (i + 1)) <= BUNDLE_LINES));
      computed.push({ ref: { file: s.file, lines: [i + 1, i + 1], quote: m[0] }, near });
      // A shared prompt named next to the computed path but missing from the folder: the others are analysed alone.
      const around = s.lines.slice(Math.max(0, i - BUNDLE_LINES), i + BUNDLE_LINES + 1).join('\n');
      for (const [, name] of around.matchAll(/(?<![\w.-])agents\/([\w.-]+\.md)(?![\w-])/g)) {
        if (files.includes(name) || NOT_PROMPTS.test(name)) continue;
        ctx.warnings.push(`${s.file}:${i + 1} names agents/${name} next to a computed prompt path, but that file does not exist; the prompts it stands for are analysed alone`);
      }
    });
  }
  for (const f of files) {
    const abs = path.join(dir, f);
    const named = direct.get(f);
    const refs = named.length ? named : computed.map((c) => c.ref);
    const shared = named.length ? [] : [...new Set(computed.flatMap((c) => c.near))].filter((x) => x !== f);
    const withUnits = shared.map((x) => ({ unit: unitIdOf(x), file: rel(root, path.join(dir, x)) }));
    const unitId = unitIdOf(f);
    const all = sources.find((s) => s.abs === abs).lines;
    const lines = all.slice(parseFrontmatter(all.join('\n')).endLine);
    const heading = lines.map((l) => /^#\s+(.+)$/.exec(l)?.[1]).find(Boolean);
    const para = lines.find((l) => l.trim() && !/^\s*(?:#|\||```|---|[-*]\s|\d+\.\s)/.test(l));
    const node = {
      id: `t:${unitId}`, parent: skill.nodeId, kind: 'agent-prompt', label: heading?.trim() ?? f.replace(/\.md$/, ''),
      description: para ? (para.trim().length > 200 ? `${para.trim().slice(0, 197)}...` : para.trim()) : null,
      file: rel(root, abs), refs, ...(withUnits.length ? { with: withUnits } : {}), source: citeLine(root, abs, /^#\s/),
    };
    ctx.containers.push(node);
    if (ctx.only && !skill.selected && !ctx.only.test(unitId)) { node.analysis = 'skipped'; continue; }
    ctx.units.push({
      id: unitId, kind: 'prompt', skillNode: node.id, plugin: skill.plugin, name: f, title: node.label, skill: skill.name, owner: skill.nodeId,
      dir: rel(root, dir), skillDir: rel(root, skillDir), file: rel(root, abs), pluginDir: rel(root, pluginDir), refs, with: withUnits,
    });
  }
}
