/**
 * Luncher — Worker entry point.
 *
 * One Worker, three jobs:
 *   1. terminate VLESS/Trojan over WebSocket and bridge to outbound TCP
 *   2. serve the panel (one inlined document, no external assets)
 *   3. serve subscriptions and per-user status pages
 *
 * The entire fetch handler is wrapped in `safe()`. An exception escaping here is
 * exactly what Cloudflare reports as **error 1101**, so nothing is allowed to
 * escape: bad input, a closed socket, a missing binding or a failed relay all
 * become ordinary HTTP responses instead.
 */

import { connect } from 'cloudflare:sockets';
import { safe, html, json, notFound, escapeHtml } from './lib/errors.js';
import { getStore } from './store/index.js';
import { createUpstream, UpstreamError } from './proxy/upstream.js';
import { attachSession, extractEarlyData } from './proxy/session.js';
import { loadSettings } from './panel/settings.js';
import { handleApi, handleSubscription, handleStatusPage, endpointsFor, VERSION } from './panel/api.js';
import { quotaState } from './panel/users.js';
import { isSanctioned } from './panel/presets.js';
import { currentSession, clientIp } from './panel/auth.js';
import { createGovernor } from './lib/governor.js';
import { createUsageCollector } from './lib/usage.js';

import UI_HTML from './ui/index.html';
import UI_CSS from './ui/styles.css.txt';
import UI_ICONS from './ui/icons.js.txt';
import UI_JS from './ui/app.js.txt';

export default {
  async fetch(request, env, ctx) {
    return safe(() => route(request, env, ctx), {
      wantsJson: request.url.includes('/api/'),
      onLog: () => { /* deliberately silent: console.error in a Worker adds cost */ },
    });
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/{2,}$/, '') || '/';
  const method = request.method.toUpperCase();

  const store = getStore(env);
  try { await store.init(); } catch { /* init is idempotent and non-fatal */ }

  const settings = await loadSettings(store);
  const governor = createGovernor(store, env);
  const waitUntil = ctx && typeof ctx.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null;
  const budget = await governor.tick(waitUntil);

  const upstream = createUpstream(connect, { extraPorts: parsePorts(env.EXTRA_TCP_PORTS) });
  const collector = createUsageCollector(store, waitUntil);

  /* ------------------------------------------------------- WebSocket tunnel */

  const isUpgrade = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
  if (path === settings.wsPath) {
    if (!isUpgrade) return decoy(settings);
    if (budget.mode === 'critical') return html(503, BUDGET_PAGE, { 'retry-after': '3600' });
    return openTunnel(request, { env, store, settings, upstream, collector, ctx });
  }

  /* ------------------------------------------------------------- panel API */

  if (path.startsWith('/api/')) {
    const session = await currentSession(request, store);
    return handleApi(path, request, { env, store, governor, session, waitUntil, upstream });
  }

  /* --------------------------------------------- subscriptions & status */

  const sub = path.match(/^\/sub\/([A-Za-z0-9\-]{8,64})(\/json)?$/);
  if (sub && method === 'GET') return handleSubscription(sub, request, { env, store, settings, governor });

  const st = path.match(/^\/s\/([A-Za-z0-9\-]{8,64})$/);
  if (st && method === 'GET') return handleStatusPage(st, request, { env, store, settings });

  /* ------------------------------------------------------------------- UI */

  if (path === '/panel' || path === '/panel/' || path === '/app') {
    return html(200, renderShell(env, settings), {
      // The panel must reflect the current state, so no long cache. It is still
      // ONE request per load because every asset is inlined below.
      'cache-control': 'no-store',
      'x-luncher-version': VERSION,
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
  }

  if (path === '/health' || path === '/healthz') {
    return json(200, {
      ok: true, version: VERSION, backend: store.kind,
      budget: governor.state(budget), time: new Date().toISOString(),
      wsPath: settings.wsPath, endpoints: endpointsFor(settings, url.host).map((e) => e.address),
    }, { 'cache-control': 'no-store' });
  }

  if (path === '/') return html(200, LANDING({ settings, host: url.host }), { 'cache-control': 'public, max-age=300' });

  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });

  return notFound(path.startsWith('/api') ? 'json' : 'html');
}

/* ------------------------------------------------------------------ tunnel */

function openTunnel(request, { env, store, settings, upstream, collector, ctx }) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  // Echoing Sec-WebSocket-Protocol is what makes `ed=2048` early data work: the
  // client only trusts the handshake if its subprotocol comes back. This saves
  // a full round trip on every connection.
  const headers = new Headers();
  const proto = request.headers.get('Sec-WebSocket-Protocol');
  if (proto) headers.set('Sec-WebSocket-Protocol', proto);

  try {
    server.accept();
  } catch {
    return new Response(null, { status: 500 });
  }

  const ip = clientIp(request);

  const authenticate = async (hdr) => {
    const user = hdr.kind === 'vless'
      ? await store.findUser({ uuid: hdr.id })
      : await store.findUser({ trojanKey: hdr.id });
    if (!user) return { ok: false, reason: 'unknown credential' };
    const q = quotaState(user, settings);
    if (!q.active) return { ok: false, reason: q.expired ? 'subscription expired' : 'quota exhausted' };

    if (user.max_ips > 0) {
      try {
        const lim = await store.touchIp(user.id, ip, user.max_ips);
        if (!lim.allowed) return { ok: false, reason: 'device limit reached' };
      } catch { /* a failing counter must not lock users out */ }
    }
    if (!user.first_seen_at) {
      collector.markFirstSeen(user.id);
    }
    return { ok: true, user };
  };

  const relayFor = (host) => {
    const relays = settings.relays || [];
    if (!relays.length) return null;
    const sanctioned = isSanctioned(host);
    return relays.find((r) => r.scope === 'all')
      || (sanctioned && settings.unlockSanctioned ? relays.find((r) => r.scope === 'sanctioned') : null)
      || null;
  };

  attachSession({
    server, request, upstream,
    ctx: {
      authenticate,
      relayFor,
      onUsage: ({ bytesUp, bytesDown, user }) => collector.record({ userId: user && user.id, bytes: bytesUp + bytesDown }),
    },
  });

  return new Response(null, { status: 101, webSocket: client, headers });
}

/**
 * Non-WebSocket request to the tunnel path.
 *
 * Serves an ordinary redirect rather than anything that advertises this Worker
 * as a proxy. This is not about hiding from Cloudflare — it is about not
 * announcing "VPN endpoint" to every scanner that crawls your hostname.
 */
function decoy(settings) {
  const to = settings.decoyRedirect || 'https://www.cloudflare.com/';
  return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
}

function parsePorts(v) {
  if (!v) return [];
  return String(v).split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
}

/* -------------------------------------------------------------------- shell */

function renderShell(env, settings) {
  const boot = {
    panelName: settings.panelName || 'Luncher',
    language: settings.language || 'fa',
    version: VERSION,
  };
  // Escape every "<" so a hostile panelName can never close the inline
  // <script> block and inject markup. JSON.stringify alone does not do this.
  const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  return UI_HTML
    .replace('/*__LUNCHER_CSS__*/', () => UI_CSS)
    .replace('/*__LUNCHER_JS__*/', () => UI_ICONS + '\n;\n' + UI_JS)
    .replace('/*__LUNCHER_BOOT__*/', () => bootJson);
}

const BUDGET_PAGE = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Luncher</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05060a;color:#e8eaf2;
font:16px/1.7 system-ui,"Segoe UI",Tahoma,sans-serif;padding:24px;text-align:center}
h1{font-size:22px}p{color:#9aa2bd;max-width:48ch}code{background:#12141d;border:1px solid #23263a;
border-radius:6px;padding:2px 7px;color:#ffd8a8;font-size:13px}</style></head>
<body><div><h1>سقف درخواست روزانه نزدیک است</h1>
<p>The daily Cloudflare request budget guard has tripped, so new tunnels are being
refused to protect the account. Existing sessions are unaffected. Raise
<code>REQUEST_BUDGET</code> or move to a paid plan.</p></div></body></html>`;

const LANDING = ({ settings, host }) => `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(settings.panelName || 'Luncher')}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#05060a;color:#e8eaf2;padding:24px;
font:16px/1.8 system-ui,"Segoe UI",Tahoma,sans-serif;display:grid;place-items:center;
background-image:radial-gradient(1100px 620px at 85% -10%,rgba(255,169,77,.16),transparent 62%),
radial-gradient(900px 520px at -5% 108%,rgba(64,224,208,.13),transparent 60%)}
.w{max-width:640px;width:100%;text-align:center}
.badge{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:99px;
background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);font-size:12.5px;color:#c9cede;margin-bottom:22px}
.dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 10px #4ade80}
h1{font-size:clamp(30px,7vw,46px);margin:0 0 8px;font-weight:750;letter-spacing:-.02em;
background:linear-gradient(135deg,#ffd8a8,#ffa94d 45%,#ff8787);-webkit-background-clip:text;background-clip:text;color:transparent}
p.sub{color:#9aa2bd;margin:0 auto 30px;max-width:50ch}
a.btn{display:inline-block;padding:13px 26px;border-radius:13px;text-decoration:none;font-weight:600;font-size:15px;
background:linear-gradient(135deg,#ffa94d,#ff7a59);color:#1a0d04;box-shadow:0 10px 30px -12px rgba(255,169,77,.7)}
a.btn.ghost{background:transparent;color:#c9cede;border:1px solid rgba(255,255,255,.14);box-shadow:none;margin-inline-start:10px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-top:34px;text-align:start}
.c{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:15px;padding:15px}
.c b{display:block;font-size:13.5px;margin-bottom:5px;color:#ffe8cc}
.c span{font-size:12.5px;color:#8f97b3;line-height:1.6}
.ft{margin-top:32px;color:#5f6784;font-size:12px}
code{background:#12141d;border:1px solid #23263a;border-radius:6px;padding:1px 6px;font-size:12px;color:#ffd8a8;direction:ltr;display:inline-block}
</style></head><body><div class="w">
<div class="badge"><span class="dot"></span> Luncher v${VERSION} · ${escapeHtml(host)}</div>
<h1>${escapeHtml(settings.panelName || 'Luncher')}</h1>
<p class="sub">پنل پروکسی VLESS و Trojan روی Cloudflare Workers — با پریست‌های ضد فیلتر آماده برای نت‌های ایران و پشتیبانی کامل از PattNG.</p>
<div><a class="btn" href="/panel">ورود به پنل</a><a class="btn ghost" href="/health">وضعیت سرویس</a></div>
<div class="grid">
<div class="c"><b>مسیر تونل</b><span><code>${escapeHtml(settings.wsPath)}</code></span></div>
<div class="c"><b>پریست فعال</b><span>${escapeHtml((settings.preset || 'balanced'))}</span></div>
<div class="c"><b>آی‌پی تمیز</b><span>${(settings.cleanIps || []).length} IPv4 · ${(settings.cleanIp6 || []).length} IPv6</span></div>
<div class="c"><b>رله</b><span>${(settings.relays || []).length ? (settings.relays.length + ' configured') : 'none — see docs/sanctions.md'}</span></div>
</div>
<div class="ft">Luncher is MIT-licensed. It runs entirely on Cloudflare's own infrastructure.</div>
</div></body></html>`;

export { UpstreamError, extractEarlyData };
