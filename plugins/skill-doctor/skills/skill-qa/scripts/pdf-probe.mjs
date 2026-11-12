#!/usr/bin/env node
// Usage: node pdf-probe.mjs <file.pdf> --out <dir> [--pages 40] [--dpi 110]
// Renders PDF pages to PNG and prints JSON facts for a design and text review:
// page sizes, metadata, fonts (embedded or not), text per page, page flow
// (large blank areas, pages that start with text repeated from the page before)
// and warnings.
// It needs the Poppler tools (pdfinfo, pdffonts, pdftoppm, pdftotext) on PATH.
// It reads the PDF and writes only into --out.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const pdf = args.find((a, i) => !a.startsWith('--') && !['--out', '--pages', '--dpi'].includes(args[i - 1]));
const out = resolve(opt('--out', 'pdf-probe'));
const maxPages = parseInt(opt('--pages', '40'), 10);
const dpi = parseInt(opt('--dpi', '110'), 10);

const fail = (error, extra = {}) => { console.log(JSON.stringify({ ok: false, error, ...extra }, null, 2)); process.exit(1); };
if (!pdf) fail('usage: node pdf-probe.mjs <file.pdf> --out <dir> [--pages 40] [--dpi 110]');
if (!existsSync(pdf)) fail(`file not found: ${pdf}`);
// Pass an absolute path so a file name starting with '-' is never read as a Poppler option.
const pdfPath = resolve(pdf);

const run = (cmd, a) => {
  try { return execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`${cmd} failed: ${(e.stderr || e.message).toString().trim()}`); }
};
const has = (cmd) => { try { execFileSync(cmd, ['-v'], { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; } };
const missing = ['pdfinfo', 'pdffonts', 'pdftoppm', 'pdftotext'].filter((t) => !has(t));
if (missing.length) fail('Poppler tools not found on PATH', { missing, hint: 'Install Poppler (or MiKTeX/TeX Live, which ship it), or review the PDF another way.' });

mkdirSync(out, { recursive: true });
const warnings = [];

const info = {};
// -enc UTF-8: without it, Windows builds print non-ASCII metadata and text in the console code page.
for (const line of run('pdfinfo', ['-enc', 'UTF-8', pdfPath]).split(/\r?\n/)) {
  const m = line.match(/^([^:]+):\s*(.*)$/);
  if (m) info[m[1].trim()] = m[2].trim();
}
const pages = parseInt(info.Pages || '0', 10);
const last = Math.min(pages, maxPages);

const sizes = [];
for (const line of run('pdfinfo', ['-enc', 'UTF-8', '-f', '1', '-l', String(pages), pdfPath]).split(/\r?\n/)) {
  const m = line.match(/^Page\s+(\d+)\s+size:\s+([\d.]+) x ([\d.]+) pts(?:\s+\((\w+)\))?/);
  if (m) sizes.push({ page: +m[1], wMm: Math.round(+m[2] * 0.3528), hMm: Math.round(+m[3] * 0.3528), name: m[4] || null });
}
const distinctSizes = [...new Set(sizes.map((s) => `${s.wMm}x${s.hMm}`))];
if (distinctSizes.length > 1) warnings.push(`mixed page sizes: ${distinctSizes.join(', ')} mm`);
if (!info.Title) warnings.push('no Title in the document metadata (viewers show the file name instead)');

const fonts = [];
const fontOut = run('pdffonts', [pdfPath]).split(/\r?\n/);
const hasEncoding = /encoding/i.test(fontOut[0] || '');
const fontLines = fontOut.slice(2).filter(Boolean);
for (const line of fontLines) {
  const parts = line.trim().split(/\s+/);
  // columns: name, type (several words), [encoding], emb, sub, uni, object, ID
  const n = parts.length;
  fonts.push({ name: parts[0], type: parts.slice(1, n - (hasEncoding ? 6 : 5)).join(' '), embedded: parts[n - 5] === 'yes', subset: parts[n - 4] === 'yes' });
}
const notEmbedded = fonts.filter((f) => !f.embedded).map((f) => f.name);
if (notEmbedded.length) warnings.push(`fonts not embedded: ${notEmbedded.join(', ')}`);
const families = [...new Set(fonts.map((f) => f.name.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0]))];

const text = run('pdftotext', ['-enc', 'UTF-8', '-layout', '-f', '1', '-l', String(pages), pdfPath, '-']).split('\f');
const textPerPage = text.slice(0, pages).map((t, i) => ({ page: i + 1, chars: t.replace(/\s+/g, '').length, start: t.trim().replace(/\s+/g, ' ').slice(0, 200) }));
const imageOnly = textPerPage.filter((p) => p.chars < 20).map((p) => p.page);
if (imageOnly.length) warnings.push(`pages with no extractable text (image-only or blank): ${imageOnly.join(', ')}`);

// Page flow, part 1: a page that opens with a line the page before also has (a card
// or section header repeated over a page break) can read as a new or duplicate item.
// Running headers and footers are ignored: a line that, wherever it appears, is the
// first line of its page or one of the last two.
const norm = (l) => l.trim().replace(/\s+/g, ' ').replace(/\d+/g, '#');
const pageLines = text.slice(0, pages).map((t) => t.split(/\r?\n/)
  .map((raw) => ({ raw: raw.trim().replace(/\s+/g, ' '), n: norm(raw) })).filter((l) => l.n.length >= 12));
const atEdge = new Map();
pageLines.forEach((ls) => ls.forEach((l, i) => atEdge.set(l.n, (atEdge.get(l.n) ?? true) && (i === 0 || i >= ls.length - 2))));
const repeatedStarts = [];
for (let p = 1; p < pageLines.length; p++) {
  const prev = new Set(pageLines[p - 1].map((l) => l.n));
  const hit = pageLines[p].filter((l) => !atEdge.get(l.n)).slice(0, 3).find((l) => prev.has(l.n));
  if (hit) repeatedStarts.push({ page: p + 1, text: hit.raw.slice(0, 60) });
}
if (repeatedStarts.length) warnings.push(`pages that start with a line repeated from the page before, e.g. a card or section header repeated over a page break: ${repeatedStarts.map((r) => `${r.page} ("${r.text}")`).join(', ')}. Look at each pair of pages: does the second read as a continuation, or as a new or duplicate item?`);

// Page flow, part 2: large blank areas, measured on a small grayscale render as the
// longest run of blank rows between the first and the last ink on the page.
const flowDir = join(out, '.flow');
mkdirSync(flowDir, { recursive: true });
run('pdftoppm', ['-gray', '-r', '20', '-f', '1', '-l', String(pages), pdfPath, join(flowDir, 'p')]);
const blankGaps = [];
for (const f of readdirSync(flowDir).filter((f) => f.endsWith('.pgm'))) {
  const page = parseInt(f.match(/(\d+)\.pgm$/)[1], 10);
  const buf = readFileSync(join(flowDir, f));
  const head = buf.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!head) continue;
  const [w, h, max] = [+head[1], +head[2], +head[3]];
  const ink = [];
  for (let y = 0; y < h; y++) {
    const row = buf.subarray(head[0].length + y * w, head[0].length + (y + 1) * w);
    ink.push(row.some((v) => v < max * 0.92));
  }
  const first = ink.indexOf(true), last = ink.lastIndexOf(true);
  let gap = 0, run_ = 0;
  for (let y = first; y <= last && first >= 0; y++) { run_ = ink[y] ? 0 : run_ + 1; gap = Math.max(gap, run_); }
  const pct = Math.round((gap / h) * 100);
  if (pct >= 30 && page < pages) blankGaps.push({ page, blankPct: pct });
}
rmSync(flowDir, { recursive: true, force: true });
blankGaps.sort((a, b) => a.page - b.page);
if (blankGaps.length) warnings.push(`pages with a blank area of 30% or more of the page height: ${blankGaps.map((g) => `${g.page} (${g.blankPct}%)`).join(', ')}. Check whether each is a deliberate break or a block pushed to the next page`);

run('pdftoppm', ['-png', '-r', String(dpi), '-f', '1', '-l', String(last), pdfPath, join(out, 'page')]);
const images = readdirSync(out).filter((f) => /^page-\d+\.png$/.test(f)).sort().map((f) => join(out, f));
if (pages > last) warnings.push(`rendered only pages 1-${last} of ${pages}; pass --pages ${pages} to render all`);

console.log(JSON.stringify({
  ok: true,
  file: resolve(pdf),
  pages,
  metadata: { title: info.Title || null, author: info.Author || null, creator: info.Creator || null, producer: info.Producer || null, tagged: info.Tagged || null, pdfVersion: info['PDF version'] || null },
  pageSizes: distinctSizes.length === 1 ? { allPages: distinctSizes[0] + ' mm', name: sizes[0]?.name } : sizes,
  fonts: { families, count: fonts.length, notEmbedded },
  textPerPage,
  pageFlow: { repeatedStarts, blankGaps },
  images,
  warnings,
}, null, 2));
