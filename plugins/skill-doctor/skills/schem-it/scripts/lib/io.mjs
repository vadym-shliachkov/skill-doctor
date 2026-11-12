import fs from 'node:fs';
import path from 'node:path';

export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

export function splitLines(text) {
  return String(text).split(/\r\n|\r|\n/);
}

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (arguments.length > 1) return fallback;
    throw new Error(`File not found: ${file}`);
  }
  return JSON.parse(readText(file));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function parseLooseJson(text) {
  let t = String(text).replace(/^\uFEFF/, '').trim();
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* look for an object inside surrounding prose */ }
  for (const span of topLevelObjectSpans(t)) {
    let value;
    try { value = JSON.parse(span); } catch { continue; }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  throw new Error('No JSON object found');
}

function topLevelObjectSpans(t) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) { inString = true; continue; }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0) spans.push(t.slice(start, i + 1));
    }
  }
  return spans;
}

export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
