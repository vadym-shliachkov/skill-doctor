import fs from 'node:fs';

const TEMPLATES = new URL('../../templates/', import.meta.url);

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderHtml(model, views, { template, elk, layout } = {}) {
  const tpl = template ?? fs.readFileSync(new URL('viewer.html', TEMPLATES), 'utf8');
  const elkSource = elk ?? fs.readFileSync(new URL('vendor/elk.bundled.js', TEMPLATES), 'utf8');
  const layoutSource = layout ?? fs.readFileSync(new URL('layout.js', TEMPLATES), 'utf8');
  const data = JSON.stringify({ model, views })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const rootLabel = model.nodes.find((n) => n.id === model.rootId)?.label ?? 'schem-it';
  // One pass, so text from the analysed files (the title) is never taken for a later placeholder.
  const parts = {
    '<!--TITLE-->': () => escapeHtml(`${rootLabel} · schem-it`),
    '/*ELK*/': () => elkSource.replace(/<\/script/gi, '<\\/script'),
    '/*LAYOUT*/': () => layoutSource.replace(/<\/script/gi, '<\\/script'),
    '/*DATA*/': () => `const DATA = ${data};`,
  };
  return tpl.replace(/<!--TITLE-->|\/\*(?:ELK|LAYOUT|DATA)\*\//g, (m) => parts[m]());
}
