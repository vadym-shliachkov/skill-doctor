#!/usr/bin/env node
// Usage: node serve.mjs <folder> [--port 0]
// A read-only static file server for viewing generated HTML in a browser, because
// many browser tools block file:// URLs. It prints {"url": ...} once listening.
// It also serves the design probe at /__skill-qa/design-probe.js so that a page can load it.
// Run it in the background and stop it when you are done.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const probe = join(dirname(fileURLToPath(import.meta.url)), 'design-probe.js');

const args = process.argv.slice(2);
const folder = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');
if (!folder) { console.error('usage: node serve.mjs <folder> [--port 0]'); process.exit(1); }
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
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(await readFile(probe));
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
    res.writeHead(200, { 'content-type': types[extname(p).toLowerCase()] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(JSON.stringify({ url, root, probe: `${url}__skill-qa/design-probe.js` }));
});
