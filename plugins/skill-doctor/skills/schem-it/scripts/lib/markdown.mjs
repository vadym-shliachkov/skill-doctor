// Markdown tables and lists cited by a block: the script copies their rows into the chart, so no analyst retypes them.

// GitHub tables: outer pipes optional, separator cells of one or more dashes with optional alignment colons.
const ROW_RE = /\|/;
const SEP_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|\s*$/;
const ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

const clean = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]*)\*\*/g, '$1').trim();

function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

// Splits a table row on the pipes that are neither escaped (\|) nor inside inline code.
export function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseTable(lines) {
  const body = trimBlank(lines);
  if (body.length < 3 || !ROW_RE.test(body[0]) || !SEP_RE.test(body[1]) || !body.slice(2).every((l) => ROW_RE.test(l))) return null;
  const columns = splitRow(body[0]).map(clean);
  const rows = body.slice(2).map((l) => {
    const cells = splitRow(l).map(clean);
    return columns.map((_, i) => cells[i] ?? '');
  });
  return { columns, rows };
}

export function parseList(lines) {
  const items = [];
  for (const l of trimBlank(lines)) {
    if (!l.trim()) continue;
    const m = ITEM_RE.exec(l);
    if (m) items.push({ text: clean(m[2]), depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2) });
    else if (/^\s+\S/.test(l) && items.length) items[items.length - 1].text += ` ${clean(l)}`;
    else return null;
  }
  return items.length ? { items } : null;
}
