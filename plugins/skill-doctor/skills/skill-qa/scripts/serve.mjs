#!/usr/bin/env node
// Usage: node serve.mjs <folder> [--port 0] [--allow <host>]...
// A read-only static file server for viewing generated HTML in a browser, because
// many browser tools block file:// URLs. It prints {"url": ...} once listening.
// It also serves the design probe at /__skill-qa/design-probe.js so that a page can load it.
// Run it in the background and stop it when you are done.
//
// Network block: every response carries a Content-Security-Policy that the browser enforces,
// whichever browser tool opens the page. A served page cannot submit a form (form-action 'none'),
// and cannot send anything to another host: fetch, XHR, sendBeacon, WebSocket and EventSource
// are limited to this server (connect-src 'self'). Scripts, styles, fonts and images may load
// only from this server and the static CDNs below, so pages that use them still render.
// --allow <host> adds a host for those static files only, never for connections or forms.
// Keep STATIC_CDNS in step with net-guard.js.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const probe = join(dirname(fileURLToPath(import.meta.url)), 'design-probe.js');

const args = process.argv.slice(2);
const usage = 'usage: node serve.mjs <folder> [--port 0] [--allow <host>]...';
const folder = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port' && args[i - 1] !== '--allow');
if (!folder) { console.error(usage); process.exit(1); }
const allow = args.flatMap((a, i) => (a === '--allow' ? [args[i + 1]] : []));
for (const h of allow) {
  if (!h || !/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i.test(h)) { console.error(`--allow needs a host name such as use.typekit.net, got "${h ?? ''}"\n${usage}`); process.exit(1); }
}
const STATIC_CDNS = [
  'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.tailwindcss.com', 'code.jquery.com',
  'fonts.googleapis.com', 'fonts.gstatic.com',
];
const assets = [...STATIC_CDNS, ...allow].map((h) => `https://${h.toLowerCase()}`).join(' ');
const csp = [
  "default-src 'self' data: blob:",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ${assets}`,
  `style-src 'self' 'unsafe-inline' data: blob: ${assets}`,
  `font-src 'self' data: blob: ${assets}`,
  `img-src 'self' data: blob: ${assets}`,
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');
const guardHeaders = { 'content-security-policy': csp, 'referrer-policy': 'no-referrer' };
const root = realpathSync(resolve(folder));
const inside = (p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
const pi = args.indexOf('--port');
const port = pi >= 0 ? parseInt(args[pi + 1], 10) : 0;
const types = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this server (blocks DNS rebinding).
    const host = String(req.headers.host || '').toLowerCase();
    const port = server.address().port;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end(); return; }
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__skill-qa/design-probe.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store', ...guardHeaders }).end(await readFile(probe));
      return;
    }
    // No dotfiles (.env, .npmrc, ...) and nothing inside .git or .ssh. Dot-folders such as .schem-it/ stay reachable.
    const segs = path.split(/[\\/]/).filter(Boolean);
    if ((segs.length && segs[segs.length - 1].startsWith('.')) || segs.some((s) => ['.git', '.ssh'].includes(s.toLowerCase()))) { res.writeHead(404).end('not found'); return; }
    let p = normalize(join(root, path));
    if (!inside(p)) { res.writeHead(403).end(); return; }
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
    // Resolve symlinks and junctions so a link cannot lead outside the folder.
    p = await realpath(p);
    if (!inside(p)) { res.writeHead(403).end(); return; }
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': types[extname(p).toLowerCase()] || 'application/octet-stream', ...guardHeaders }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(JSON.stringify({ url, root, probe: `${url}__skill-qa/design-probe.js`, networkBlock: 'csp', allow }));
});
