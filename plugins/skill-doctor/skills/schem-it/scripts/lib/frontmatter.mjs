import { splitLines } from './io.mjs';

export function parseFrontmatter(text) {
  const lines = splitLines(String(text).replace(/^\uFEFF/, ''));
  if (lines[0]?.trim() !== '---') return { data: {}, endLine: 0, error: null };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { data: {}, endLine: 0, error: 'Frontmatter has no closing ---' };
  try {
    return { data: parseYaml(lines.slice(1, end)), endLine: end + 1, error: null };
  } catch (e) {
    return { data: {}, endLine: end + 1, error: `Frontmatter: ${e.message}` };
  }
}

const indentOf = (l) => /^ */.exec(l)[0].length;
const isBlank = (l) => l.trim() === '' || l.trim().startsWith('#');
const isListLine = (l) => /^\s*-(\s|$)/.test(l);
const MAP_LINE = /^\s*([^\s:#][^:]*?)\s*:(?:\s+(.*))?$/;

export function parseYaml(lines) {
  const ctx = { lines: [...lines], i: 0 };
  skipBlank(ctx);
  if (ctx.i >= ctx.lines.length) return {};
  const result = parseBlock(ctx, indentOf(ctx.lines[ctx.i]));
  skipBlank(ctx);
  if (ctx.i < ctx.lines.length) throw new Error(`cannot parse line ${ctx.i + 1}: ${ctx.lines[ctx.i].trim()}`);
  return result;
}

function skipBlank(ctx) {
  while (ctx.i < ctx.lines.length && isBlank(ctx.lines[ctx.i])) ctx.i++;
}

function parseBlock(ctx, indent) {
  skipBlank(ctx);
  return isListLine(ctx.lines[ctx.i]) ? parseList(ctx, indent) : parseMap(ctx, indent);
}

function parseMap(ctx, indent) {
  const out = {};
  for (;;) {
    skipBlank(ctx);
    if (ctx.i >= ctx.lines.length) break;
    const line = ctx.lines[ctx.i];
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`unexpected indentation on line ${ctx.i + 1}`);
    if (isListLine(line)) break;
    const m = MAP_LINE.exec(line);
    if (!m) throw new Error(`cannot parse line ${ctx.i + 1}: ${line.trim()}`);
    ctx.i++;
    out[m[1].replace(/^["']|["']$/g, '')] = parseValue(ctx, m[2], indent);
  }
  return out;
}

function parseList(ctx, indent) {
  const out = [];
  for (;;) {
    skipBlank(ctx);
    if (ctx.i >= ctx.lines.length) break;
    const line = ctx.lines[ctx.i];
    if (indentOf(line) !== indent || !isListLine(line)) break;
    const rest = line.trim().slice(1).trim();
    if (rest === '') {
      ctx.i++;
      out.push(parseValue(ctx, '', indent));
    } else if (!/^["'[{]/.test(rest) && MAP_LINE.test(rest)) {
      const col = line.indexOf(rest);
      ctx.lines[ctx.i] = ' '.repeat(col) + rest;
      out.push(parseMap(ctx, col));
    } else {
      ctx.i++;
      out.push(scalar(rest));
    }
  }
  return out;
}

function parseValue(ctx, raw, indent) {
  const v = (raw ?? '').trim();
  if (v === '') {
    skipBlank(ctx);
    if (ctx.i < ctx.lines.length) {
      const next = ctx.lines[ctx.i];
      const ind = indentOf(next);
      if (ind > indent || (ind === indent && isListLine(next))) return parseBlock(ctx, ind);
    }
    return null;
  }
  if (/^[|>][+-]?$/.test(v)) return parseBlockScalar(ctx, indent, v[0]);
  let text = v;
  while (ctx.i < ctx.lines.length && !isBlank(ctx.lines[ctx.i]) && indentOf(ctx.lines[ctx.i]) > indent && !MAP_LINE.test(ctx.lines[ctx.i])) {
    text += ` ${ctx.lines[ctx.i].trim()}`;
    ctx.i++;
  }
  return scalar(text);
}

function parseBlockScalar(ctx, indent, style) {
  const parts = [];
  let blockIndent = null;
  while (ctx.i < ctx.lines.length) {
    const line = ctx.lines[ctx.i];
    if (line.trim() === '') { parts.push(''); ctx.i++; continue; }
    const ind = indentOf(line);
    if (ind <= indent) break;
    blockIndent ??= ind;
    parts.push(line.slice(Math.min(ind, blockIndent)));
    ctx.i++;
  }
  while (parts.length && parts.at(-1) === '') parts.pop();
  return style === '|' ? parts.join('\n') : parts.join(' ').replace(/\s+/g, ' ').trim();
}

function scalar(v) {
  if (/^".*"$/.test(v)) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).map(scalar);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/\s+#\s.*$/, '');
}
