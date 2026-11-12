import fs from 'node:fs';
import path from 'node:path';
import { readJson, readText } from './io.mjs';
import { toPosix, rel, isInside } from './paths.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

const MARKERS = ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'skills/', 'agents/', 'commands/', 'SKILL.md', '.claude/'];

export const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

function tryJson(file, warnings, root) {
  try {
    return readJson(file);
  } catch (e) {
    warnings.push(`${rel(root, file)}: ${e.message}`);
    return null;
  }
}

export function pluginManifest(dir, warnings, root) {
  for (const f of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const data = tryJson(p, warnings, root);
    if (data) return { file: rel(root, p), data };
  }
  return null;
}

export function isPluginDir(dir) {
  return ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].some((f) => fs.existsSync(path.join(dir, f)))
    || ['skills', 'agents', 'commands'].some((d) => isDir(path.join(dir, d)));
}

function pluginLevel(root, warnings, dir = root) {
  const manifest = pluginManifest(dir, warnings, root);
  const name = manifest?.data.name ?? path.basename(root);
  return {
    level: 'plugin',
    name,
    manifestFile: manifest?.file ?? null,
    plugins: [{ name, dir: toPosix(dir), description: manifest?.data.description ?? null, manifestFile: manifest?.file ?? null }],
    warnings,
  };
}

export function detect(root) {
  const warnings = [];
  const marketFiles = ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json'].filter((f) => fs.existsSync(path.join(root, f)));
  if (marketFiles.length) {
    const byName = new Map();
    const skippedRemote = new Set();
    let name = null;
    for (const f of marketFiles) {
      const m = tryJson(path.join(root, f), warnings, root);
      if (!m) continue;
      name ??= m.name ?? null;
      for (const p of m.plugins ?? []) {
        if (!p?.name || byName.has(p.name)) continue;
        const src = typeof p.source === 'string' ? p.source : p.source?.path;
        if (!src) { skippedRemote.add(p.name); continue; }
        const dir = toPosix(path.resolve(root, src));
        if (!isInside(root, dir) || (isDir(dir) && !isInside(fs.realpathSync(root), fs.realpathSync(dir)))) {
          warnings.push(`Plugin "${p.name}" source is outside the analysed folder; skipped: ${src}`);
          continue;
        }
        if (!isDir(dir)) { warnings.push(`Plugin "${p.name}" source not found: ${src}`); continue; }
        skippedRemote.delete(p.name);
        byName.set(p.name, { name: p.name, dir, description: p.description ?? null, manifestFile: f });
      }
    }
    for (const n of skippedRemote) warnings.push(`Plugin "${n}" has a non-local source; skipped`);
    return { level: 'marketplace', name: name ?? path.basename(root), manifestFile: marketFiles[0], plugins: [...byName.values()], warnings };
  }
  // A plugin manifest wins; then a SKILL.md at the root (a skill may have its own agents/ folder); only then the folder fallback.
  const hasManifest = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].some((f) => fs.existsSync(path.join(root, f)));
  if (hasManifest) return pluginLevel(root, warnings);
  if (fs.existsSync(path.join(root, 'SKILL.md'))) {
    const fm = parseFrontmatter(readText(path.join(root, 'SKILL.md')));
    if (fm.error) warnings.push(`SKILL.md: ${fm.error}`);
    return { level: 'skill', name: typeof fm.data.name === 'string' ? fm.data.name : path.basename(root), manifestFile: 'SKILL.md', plugins: [], warnings };
  }
  if (isPluginDir(root)) return pluginLevel(root, warnings);
  // A project whose skills, agents and commands live in .claude/: the project stays the root, so paths written relative to it resolve.
  if (isPluginDir(path.join(root, '.claude'))) return pluginLevel(root, warnings, path.join(root, '.claude'));
  throw new Error(`Not a marketplace, plugin or skill: looked for ${MARKERS.join(', ')} in ${toPosix(root)}`);
}
