import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/skill-qa/scripts');
const serve = path.join(scripts, 'serve.mjs');
const guardSrc = fs.readFileSync(path.join(scripts, 'net-guard.js'), 'utf8');
const loadGuard = () => (0, eval)('(' + guardSrc + ')');

function startServe(folder, extra = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [serve, folder, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n').find((l) => l.startsWith('{'));
      if (line) resolve({ proc: p, info: JSON.parse(line) });
    });
    p.on('exit', (code) => reject(new Error(`serve.mjs exited ${code}`)));
  });
}

test('serve.mjs sends a CSP that blocks forms and outside connections on every file', async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || process.env.TMPDIR || '/tmp'), 'sqa-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><p>hi</p>');
  const { proc, info } = await startServe(dir, ['--allow', 'use.typekit.net']);
  try {
    for (const p of ['', '__skill-qa/design-probe.js']) {
      const res = await fetch(info.url + p);
      assert.equal(res.status, 200);
      const csp = res.headers.get('content-security-policy');
      assert.match(csp, /form-action 'none'/);
      assert.match(csp, /connect-src 'self'(;|$)/);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /img-src [^;]*https:\/\/use\.typekit\.net/);
      assert.doesNotMatch(csp, /connect-src[^;]*typekit/);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    }
    assert.deepEqual(info.allow, ['use.typekit.net']);
  } finally { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('serve.mjs refuses an --allow value that is not a host name', () => {
  for (const bad of ["x.com; connect-src *", 'https://x.com', 'localhost', '']) {
    const r = spawnSync(process.execPath, [serve, '.', '--allow', bad], { encoding: 'utf8' });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /--allow needs a host name/);
  }
});

test('serve.mjs and net-guard.js allow the same static CDNs', () => {
  const list = (src) => [...src.match(/STATIC_CDNS = (?:new Set\()?\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(list(fs.readFileSync(serve, 'utf8')), list(guardSrc));
});

// A stand-in for a Playwright page and context that records what the guard does.
function fakePage() {
  const ctx = { handlers: [], ws: null };
  ctx.route = async (_pattern, h) => { ctx.handlers.push(h); };
  ctx.routeWebSocket = async (_pattern, h) => { ctx.ws = h; };
  return { context: () => ctx, ctx };
}
async function send(ctx, url, method = 'GET', type = 'document') {
  let result = 'network';
  const route = {
    request: () => ({ url: () => url, method: () => method, resourceType: () => type }),
    abort: async () => { result = 'blocked'; },
    fallback: async () => { result = 'network'; },
  };
  // Playwright runs the last registered handler first; fallback passes to the previous one.
  for (const h of [...ctx.handlers].reverse()) {
    result = 'pending';
    await h(route);
    if (result === 'blocked') return result;
  }
  return 'network';
}

test('net-guard passes local requests and static CDN files, and blocks everything else', async () => {
  const page = fakePage();
  const r = await loadGuard()(page);
  assert.equal(r.guard, 'on');
  const c = page.ctx;
  assert.equal(await send(c, 'http://127.0.0.1:5000/'), 'network');
  assert.equal(await send(c, 'http://localhost:5000/x', 'POST', 'fetch'), 'network');
  assert.equal(await send(c, 'https://cdnjs.cloudflare.com/x.js', 'GET', 'script'), 'network');
  assert.equal(await send(c, 'https://fonts.gstatic.com/f.woff2', 'GET', 'font'), 'network');
  assert.equal(await send(c, 'https://cdnjs.cloudflare.com/', 'GET', 'document'), 'blocked');
  assert.equal(await send(c, 'https://cdn.jsdelivr.net/x', 'POST', 'fetch'), 'blocked');
  assert.equal(await send(c, 'https://example.invalid/contact', 'POST', 'document'), 'blocked');
  assert.equal(await send(c, 'https://example.invalid/', 'GET', 'document'), 'blocked');
  assert.equal(await send(c, 'https://example.invalid/pixel.png', 'GET', 'image'), 'blocked');
  assert.equal(await send(c, 'https://127.0.0.1.example.invalid/', 'GET', 'document'), 'blocked');

  let closed = false, connected = false;
  c.ws({ url: () => 'wss://example.invalid/ws', close: () => { closed = true; }, connectToServer: () => { connected = true; } });
  assert.ok(closed && !connected);
  closed = false;
  c.ws({ url: () => 'ws://127.0.0.1:5000/ws', close: () => { closed = true; }, connectToServer: () => { connected = true; } });
  assert.ok(connected && !closed);

  const status = await loadGuard()(page);
  assert.equal(c.handlers.length, 1, 'a second run must not add a handler');
  assert.equal(status.blocked, 7);
  assert.ok(status.requests.every((q) => !q.url.includes('?')));
});

test('net-guard allows GET only on extra hosts, and a second run cannot loosen it', async () => {
  const page = fakePage();
  await loadGuard()(page, ['Docs.Example.invalid']);
  const c = page.ctx;
  assert.equal(await send(c, 'https://docs.example.invalid/a', 'GET', 'document'), 'network');
  assert.equal(await send(c, 'https://docs.example.invalid/form', 'POST', 'document'), 'blocked');
  assert.equal(await send(c, 'https://other.example.invalid/', 'GET', 'document'), 'blocked');

  const again = await loadGuard()(page, ['other.example.invalid']);
  assert.match(again.note, /never loosens/);
  assert.equal(await send(c, 'https://other.example.invalid/', 'GET', 'document'), 'blocked');
});

test('net-guard records the origin and path only, never the query string', async () => {
  const page = fakePage();
  await loadGuard()(page);
  await send(page.ctx, 'https://example.invalid/b?email=a%40b.c', 'GET', 'image');
  const s = await loadGuard()(page);
  assert.equal(s.requests[0].url, 'https://example.invalid/b');
});
