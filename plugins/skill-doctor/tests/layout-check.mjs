// Loads the viewer's layout code and ELK the way the page does, and checks a computed layout against the
// connection and spacing rules. Shared by the unit tests and by ad-hoc checks on real runs.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEMPLATES = fileURLToPath(new URL('../skills/schem-it/templates/', import.meta.url));

export function loadLayout() {
  // The same ELK bundle the page inlines, loaded as the CommonJS module it also is (its UMD wrapper picks that up).
  const mod = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(`${TEMPLATES}vendor/elk.bundled.js`, 'utf8'))(mod, mod.exports);
  // Same realm as ELK (it checks arrays with instanceof); a local globalThis keeps the real global clean.
  const scope = {};
  new Function('globalThis', fs.readFileSync(`${TEMPLATES}layout.js`, 'utf8'))(scope);
  return { SchemLayout: scope.SchemLayout, elk: new mod.exports() };
}

const near = (a, b) => Math.abs(a - b) <= 0.5;
const hit = (r, s, pad) => {
  const [x1, x2] = [Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x)];
  const [y1, y2] = [Math.min(s[0].y, s[1].y), Math.max(s[0].y, s[1].y)];
  return x2 > r.x - pad && x1 < r.x + r.w + pad && y2 > r.y - pad && y1 < r.y + r.h + pad;
};
const overlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

// Returns a list of human-readable rule violations (empty when the layout follows every rule).
export function checkLayout(L) {
  const problems = [];
  const blocks = new Map(L.blocks.map((b) => [b.id, b]));
  const centre = (b, side) => ({
    top: { x: b.x + b.w / 2, y: b.y }, bottom: { x: b.x + b.w / 2, y: b.y + b.h },
    left: { x: b.x + b.inLeft, y: b.y + b.h / 2 }, right: { x: b.x + b.w - b.outRight, y: b.y + b.h / 2 },
  })[side];
  const at = (p, b, sides) => sides.find((s) => { const c = centre(b, s); return near(p.x, c.x) && near(p.y, c.y); });
  const exits = new Map();
  for (const e of L.edges) {
    const p = e.points;
    const from = blocks.get(e.from);
    const to = blocks.get(e.to);
    for (let i = 0; i < p.length - 1; i++) {
      if (!near(p[i].x, p[i + 1].x) && !near(p[i].y, p[i + 1].y)) problems.push(`${e.id}: segment ${i} is diagonal`);
    }
    const outSide = at(p[0], from, ['bottom', 'right']);
    const inSide = at(p[p.length - 1], to, ['top', 'left']);
    if (!outSide) problems.push(`${e.id} (${e.kind}): does not leave ${e.from} from the bottom or right centre`);
    if (!inSide) problems.push(`${e.id} (${e.kind}): does not enter ${e.to} at the top or left centre`);
    if (e.kind === 'flow' && inSide && inSide !== 'top') problems.push(`${e.id}: flow enters ${e.to} from the ${inSide}`);
    if (e.kind === 'reads' && inSide !== 'left') problems.push(`${e.id}: read does not enter ${e.to} from the left`);
    if (e.kind === 'writes' && outSide !== 'right') problems.push(`${e.id}: write does not leave ${e.from} from the right`);
    if (e.kind === 'flow') {
      if (!exits.has(e.from)) exits.set(e.from, []);
      exits.get(e.from).push(outSide);
    }
  }
  for (const b of L.blocks) {
    if (b.kind === 'decision') {
      const sides = (exits.get(b.id) ?? []).sort().join(',');
      if (sides !== 'bottom,right') problems.push(`${b.id}: decision exits are ${sides || 'none'}, expected bottom,right`);
    }
  }
  const labels = L.edges.filter((e) => e.label).map((e) => ({ e, r: e.label }));
  for (const { e, r } of labels) {
    for (const f of L.edges) {
      for (let i = 0; i < f.points.length - 1; i++) {
        if (hit(r, [f.points[i], f.points[i + 1]], 2)) problems.push(`label "${r.text}" of ${e.id} touches a line of ${f.id}`);
      }
    }
    for (const b of L.blocks) if (overlap(r, b, 2)) problems.push(`label "${r.text}" of ${e.id} touches block ${b.id}`);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) if (overlap(labels[i].r, labels[j].r, 2)) problems.push(`labels of ${labels[i].e.id} and ${labels[j].e.id} overlap`);
  }
  for (let i = 0; i < L.blocks.length; i++) {
    for (let j = i + 1; j < L.blocks.length; j++) if (overlap(L.blocks[i], L.blocks[j], 4)) problems.push(`blocks ${L.blocks[i].id} and ${L.blocks[j].id} overlap`);
  }
  return [...new Set(problems)];
}
