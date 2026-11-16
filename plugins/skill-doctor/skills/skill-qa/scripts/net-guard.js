// Network guard: run this whole file as Playwright code (for example browser_run_code_unsafe,
// with `filename` set to this file or its contents pasted as `code`) BEFORE opening any page.
// It blocks, for the whole browser context, every request that could submit a form or reach
// a real person or organisation:
//   - Requests to this machine (localhost, 127.0.0.1, ::1) pass, so pages from serve.mjs work.
//   - Scripts, styles, fonts and images may be fetched (GET or HEAD only) from the static CDNs
//     below, so pages that use them still render. Everything else to those hosts is blocked.
//   - Everything else is aborted: form posts, fetch/XHR/beacons, clicks on links to live
//     sites, iframes from other hosts and WebSockets to other hosts.
// Read-only checks of a live site: call it as `async (page) => (<this file>)(page, ['example.org'])`.
// Those hosts then allow GET and HEAD only, so POST forms there are blocked. A form that
// submits by GET cannot be told apart from a link, so the written rule still applies.
// Run it again at any time to get the guard's status and the list of blocked requests.
// The guard lasts until the browser is closed; after browser_close, run it again.
// It never loosens: a second run cannot change the allowed hosts (close the browser for that).
// Keep STATIC_CDNS in step with serve.mjs.
async (page, allow = []) => {
  const ctx = page.context();
  const want = [...new Set(allow.map((h) => String(h).toLowerCase()))].sort();
  if (ctx.__skillQaGuard) {
    const g = ctx.__skillQaGuard;
    const same = JSON.stringify(g.allow) === JSON.stringify(want);
    return {
      guard: 'on', since: g.since, allow: g.allow, blocked: g.blocked.length, requests: g.blocked.slice(-200),
      ...(same ? {} : { note: `Already on with allow=${JSON.stringify(g.allow)}. The guard never loosens; close the browser and run it again to change the allowed hosts.` }),
    };
  }
  const STATIC_CDNS = new Set([
    'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.tailwindcss.com', 'code.jquery.com',
    'fonts.googleapis.com', 'fonts.gstatic.com',
  ]);
  const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const STATIC_TYPES = new Set(['script', 'stylesheet', 'font', 'image']);
  const READ = new Set(['GET', 'HEAD']);
  const extra = new Set(want);
  const g = { since: new Date().toISOString(), allow: want, blocked: [] };
  const record = (method, type, u, why) => {
    // Origin and path only: query strings and bodies can hold the data being sent.
    g.blocked.push({ method, type, url: u ? `${u.protocol}//${u.host}${u.pathname}` : '(unparsable)', why });
  };
  const verdict = (u, method, type) => {
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return `protocol ${u.protocol}`;
    const host = u.hostname.toLowerCase();
    if (LOCAL.has(host)) return null;
    if (STATIC_CDNS.has(host)) return READ.has(method) && STATIC_TYPES.has(type) ? null : 'CDN host: static files only';
    if (extra.has(host)) return READ.has(method) ? null : 'allowed host: GET and HEAD only';
    return 'outside host';
  };
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    let u = null;
    try { u = new URL(req.url()); } catch { /* falls through to block */ }
    const why = u ? verdict(u, req.method(), req.resourceType()) : 'unparsable URL';
    if (why) {
      record(req.method(), req.resourceType(), u, why);
      return route.abort('blockedbyclient');
    }
    // fallback, not continue: any other guard registered earlier also gets its say.
    return route.fallback();
  });
  if (typeof ctx.routeWebSocket === 'function') {
    await ctx.routeWebSocket(/.*/, (ws) => {
      let u = null;
      try { u = new URL(ws.url()); } catch { /* blocked below */ }
      const why = u ? verdict(u, 'GET', 'websocket') : 'unparsable URL';
      if (why) { record('GET', 'websocket', u, why); return ws.close({ code: 1008, reason: 'blocked by skill-qa net-guard' }); }
      ws.connectToServer();
    });
  }
  ctx.__skillQaGuard = g;
  return { guard: 'on', since: g.since, allow: g.allow, websockets: typeof ctx.routeWebSocket === 'function' ? 'blocked' : 'not covered (old Playwright); serve.mjs CSP still blocks them on served pages' };
}
