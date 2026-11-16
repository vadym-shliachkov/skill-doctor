import fs from 'node:fs';
import path from 'node:path';
import { readText, splitLines } from './io.mjs';
import { isInside } from './paths.mjs';

// Quick static look at script code: the calls a script analyst should not miss, function definitions and entry points.

// Dot-folders (.git, .venv, .schem-it, caches) are skipped too: installed packages, build output and tests are not the skill's scripts.
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'venv', 'env', '__pycache__', 'site-packages', 'dist', 'build', 'test', 'tests', '__tests__', 'fixtures']);
const TEST_FILE_RE = /\.test\.|\.spec\.|^test_.*\.py$|_test\.py$/i;
export const CODE_EXT_RE = /\.(?:mjs|cjs|js|ts|py|sh|ps1|cmd)$/i;
const MODULE_EXTS = ['', '.mjs', '.js', '.cjs', '.ts', '.py', '.sh', '/index.mjs', '/index.js', '/__init__.py'];

const CHILD = {
  js: /(?<![\w$])(?:execFileSync|execSync|execFile|spawnSync|spawn|fork)\s*\(|(?<![.\w$])exec\s*\(/,
  py: /\b(?:subprocess\.(?:run|call|check_call|check_output|Popen)|os\.(?:system|popen))\s*\(/,
  sh: /^\s*(?:node|python3?|bash|sh|pwsh)\s+\S/,
};
const IMPORT = {
  js: /\bimport\s+(?:([\w${}\s,*]+?)\s+from\s+)?["'](\.{1,2}\/[^"']+)["']|\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/,
  py: /^\s*from\s+([\w.]+)\s+import\s+\(?([\w, ]+)\)?|^\s*import\s+([\w.]+)\s*$/,
  sh: /^\s*(?:source|\.)\s+["']?([^\s"']+\.sh)/,
};
const COMMENT = { js: /^\s*(?:\/\/|\*)/, py: /^\s*#/, sh: /^\s*#/ };
const AI_RE = /@anthropic-ai\/sdk|api\.anthropic\.com|\bimport\s+anthropic\b|\banthropic\.Anthropic\s*\(|["']claude["']|\bclaude\s+-p\b/;
const SCRIPT_TOKEN = /([\w./\\-]*\.(?:mjs|cjs|js|ts|py|sh|ps1))(?![\w])/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const langOf = (file) => (/\.py$/i.test(file) ? 'py' : /\.(?:sh|ps1|cmd)$/i.test(file) ? 'sh' : 'js');

export function scanText(text, lang) {
  const lines = splitLines(text);
  const hints = [];
  lines.forEach((l, i) => {
    if (COMMENT[lang].test(l) && !/^\s*#!/.test(l)) return;
    if (CHILD[lang].test(l)) {
      const m = SCRIPT_TOKEN.exec(lines.slice(i, i + 4).join(' '));
      hints.push({ line: i + 1, kind: 'child', detail: m ? m[1] : l.trim().slice(0, 80) });
    }
    const im = IMPORT[lang].exec(l);
    if (im) {
      const module = lang === 'py' ? im[1] ?? im[3] : lang === 'sh' ? im[1] : im[2] ?? im[3] ?? im[4];
      const names = lang === 'py' ? (im[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        : lang === 'js' ? (im[1] ?? '').replace(/[{}*]/g, ' ').split(/[\s,]+/).filter((n) => n && n !== 'as') : [];
      hints.push({ line: i + 1, kind: 'import', module, names });
    }
    const ai = AI_RE.exec(l);
    if (ai) hints.push({ line: i + 1, kind: 'ai', detail: ai[0] });
  });
  return hints;
}

const tryFile = (root, rel) => {
  const abs = path.join(root, rel);
  return isInside(root, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile() ? rel.replace(/\\/g, '/') : null;
};

// An import in `from` names a file in the analysed folder, or nothing (a package, the standard library).
export function findModule(root, from, spec, lang) {
  const dir = path.posix.dirname(from);
  if (lang === 'py') {
    const mod = spec.replace(/^\.+/, '').replace(/\./g, '/');
    if (!mod) return null;
    const dirs = [];
    if (spec.startsWith('.')) dirs.push(dir);
    else for (let d = dir; ; d = path.posix.dirname(d)) { dirs.push(d); if (d === '.' || d === '/' || !d) break; }
    for (const d of dirs) for (const ext of ['.py', '/__init__.py']) {
      const hit = tryFile(root, path.posix.normalize(`${d}/${mod}${ext}`));
      if (hit) return hit;
    }
    return null;
  }
  const base = path.posix.normalize(path.posix.join(dir, spec));
  for (const ext of lang === 'sh' ? [''] : ['', '.mjs', '.js', '.cjs', '.ts', '/index.mjs', '/index.js']) {
    const hit = tryFile(root, base + ext);
    if (hit) return hit;
  }
  return null;
}

// Hints for a script file and the in-folder modules it imports, one level deep, at most `limit` files.
export function scanCode(root, file, { limit = 30 } = {}) {
  const out = [];
  const seen = new Set();
  const visit = (f, depth) => {
    if (seen.has(f) || seen.size >= limit) return;
    seen.add(f);
    const lang = langOf(f);
    const next = [];
    for (const h of scanText(readText(path.join(root, f)), lang)) {
      if (h.kind !== 'import') { out.push({ file: f, line: h.line, kind: h.kind, detail: h.detail }); continue; }
      const target = findModule(root, f, h.module, lang);
      if (!target) continue;
      out.push({ file: f, line: h.line, kind: 'import', detail: `${h.names.length ? `${h.names.join(', ')} from ` : ''}${target}` });
      next.push(target);
    }
    if (depth > 0) for (const t of next) visit(t, depth - 1);
  };
  visit(file, 1);
  return out;
}

// "scripts/run_eval.py", "scripts/run_eval", "scripts.run_eval", "run_eval.py" → the file the resolver finds, else null.
export function resolveModule(spec, resolve) {
  const s = String(spec).replace(/\\/g, '/');
  const dotted = !s.includes('/') && /^\w+(?:\.\w+)+$/.test(s) && !CODE_EXT_RE.test(s) ? [s.replace(/\./g, '/')] : [];
  for (const c of [s, ...dotted]) for (const ext of MODULE_EXTS) {
    const hit = resolve(c + ext);
    if (hit) return hit;
  }
  return null;
}

// Parameters with one level of brackets inside (b = f()), then an optional TypeScript return type.
const PARAMS = '\\((?:[^()]|\\([^()]*\\))*\\)';
const ARROW = `(?:${PARAMS}\\s*(?::\\s*[^=]+?)?\\s*=>|[\\w$]+\\s*=>)`;

export function definesFunction(text, name, lang) {
  const e = escapeRe(name);
  const re = {
    py: `^\\s*(?:async\\s+)?def\\s+${e}\\s*\\(`,
    sh: `^\\s*(?:function\\s+${e}(?![\\w-])|${e}\\s*\\(\\s*\\))`,
    js: [
      `\\bfunction\\s*\\*?\\s*${e}\\s*(?:<[^>]*>)?\\s*\\(`,
      // const run = …, run = …, exports.run = …, module.exports.run = …
      `(?:^|[^\\w$])${e}\\s*=\\s*(?:async\\s+)?(?:function\\b|${ARROW})`,
      `^\\s*(?:(?:public|private|protected|static|readonly|override|async)\\s+)*\\*?${e}\\s*(?:<[^>]*>)?\\s*${PARAMS}\\s*(?::\\s*[^{;]+?)?\\s*\\{`,
      `\\bexport\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?\\s*)?${e}(?![\\w$])`,
      `(?:^|[\\s,{])${e}\\s*:\\s*(?:async\\s+)?(?:function\\b|${ARROW})`,
    ].join('|'),
  }[lang];
  return new RegExp(re, 'm').test(text);
}

// A name bound to something other than a function (a dispatch table such as `export const COMMANDS = {}`, a class).
export function declaresName(text, name, lang) {
  const e = escapeRe(name);
  const re = {
    py: `^(?:class\\s+${e}\\b|${e}\\s*(?::[^=]+)?=)`,
    sh: `^\\s*(?:export\\s+|readonly\\s+|declare\\s+(?:-\\w+\\s+)*)?${e}=`,
    js: `\\b(?:const|let|var|class)\\s+${e}(?![\\w$])`,
  }[lang];
  return Boolean(re) && new RegExp(re, 'm').test(text);
}

export function isEntryScript(text, file) {
  if (/\.(?:sh|ps1|cmd)$/i.test(file)) return true;
  if (/^\uFEFF?#!/.test(text)) return true;
  if (/\.py$/i.test(file)) return /if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(text);
  return /\bprocess\.argv\b|import\.meta\.url\s*===|require\.main\s*===\s*module/.test(text);
}

export function listScriptFiles(root, dir, out = [], limit = 300) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const d of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= limit) break;
    const rel = dir === '.' ? d.name : `${dir}/${d.name}`;
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) listScriptFiles(root, rel, out, limit);
      continue;
    }
    if (CODE_EXT_RE.test(d.name) && !TEST_FILE_RE.test(d.name)) out.push(rel);
  }
  return out;
}
