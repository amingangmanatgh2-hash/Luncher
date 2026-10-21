/** HTTP surface: panel REST API, subscriptions and public status pages. */

import { json, html, escapeHtml, notFound } from '../lib/errors.js';
import { loadSettings, saveSettings, validateReport } from './settings.js';
import { newUser, applyEdits, quotaState, publicUser, randomUuid, randomTrojanPassword } from './users.js';
import { buildLinks, buildAll, buildXrayJson, subscriptionHeaders } from './configs.js';
import { FRAGMENT_PRESETS, CIPHER_SUITES, FINGERPRINTS, DECOY_SNI, CF_RANGES_V4, CF_RANGES_V6, SANCTIONED_DOMAINS, WORKER_TCP_PORTS, isSanctioned } from './presets.js';
import { sha256Hex, clientIp, adminCredential, login, logout, sessionCookie } from './auth.js';
import { qrToSvg, encodeQr } from '../lib/qr.js';

const VERSION = '1.0.0';

/**
 * Byte-mode capacity ceiling for a QR code: version 40 at error-correction L
 * holds 2953 bytes, and nothing above that can be encoded at all.
 *
 * This used to be a hardcoded 900, which rejected EVERY PattNG share link: the
 * `cs` (13 cipher suites) and `fm` (finalMask JSON) parameters alone push a link
 * past 900 characters. So the QR button failed for precisely the client this
 * panel supports first. A real 918-character PattNG link encodes as version 21
 * (101x101 modules) at EC L, which is comfortably scannable.
 */
const QR_MAX_BYTES = 2953;

/** Endpoints a client can dial, in preference order. */
/**
 * Preset metadata exposed to the UI. Built once at module scope so `/api/state`
 * and `/api/overview` cannot drift apart — the panel renders preset labels and
 * the per-ISP notes from this, so a mismatch shows up as missing translations.
 */
const PRESET_LIST = Object.entries(FRAGMENT_PRESETS).map(([id, v]) => ({
  id, label: v.label, labelFa: v.labelFa, note: v.note, legacy: !!v.legacy,
}));

export function endpointsFor(settings, requestHost) {
  // `requestHost` comes from `new URL(request.url).host`, which KEEPS the port
  // when one is explicit — so local dev yields "127.0.0.1:8787". A share link
  // must carry a bare hostname in `host=` and a separate numeric port, so strip
  // it here rather than letting ":8787" leak into the address or the brackets.
  const raw = String(settings.customHost || requestHost || '').trim();
  const host = raw.replace(/:\d+$/, '');
  const port = 443;
  const out = [];
  if (settings.useWorkerHostAsAddress !== false) out.push({ host, address: host, port, label: 'Domain', tls: true });
  for (const ip of (settings.cleanIps || []).slice(0, 3)) out.push({ host, address: ip, port, label: `CF ${ip}`, tls: true });
  for (const ip of (settings.cleanIp6 || []).slice(0, 1)) out.push({ host, address: ip, port, label: `CF6`, tls: true });
  return out;
}

function settingsForUser(settings, user) {
  return { ...settings, preset: user.preset || settings.preset };
}

export async function handleApi(path, request, { env, store, governor, session, waitUntil, upstream }) {
  const method = request.method.toUpperCase();
  const wants = (m) => method === m;

  const body = async () => {
    try { return await request.json(); } catch { return {}; }
  };
  const requireAuth = () => {
    if (!session) return json(401, { ok: false, error: 'not authenticated' });
    return null;
  };

  /* ------------------------------------------------------------- public */

  if (path === '/api/state' && wants('GET')) {
    const settings = await loadSettings(store);
    const cred = await adminCredential(env, store);
    return json(200, {
      ok: true, version: VERSION, panelName: settings.panelName || 'Luncher',
      configured: cred.configured, backend: store.kind, language: settings.language,
      presets: PRESET_LIST,
      cipherSuiteOptions: Object.keys(CIPHER_SUITES),
      fingerprints: FINGERPRINTS,
      decoys: DECOY_SNI,
    });
  }

  if (path === '/api/health' && wants('GET')) {
    const u = governor ? governor.state(await governor.read()) : { requests: 0, pct: 0, mode: 'ok' };
    return json(200, { ok: true, version: VERSION, backend: store.kind, budget: { requests: u.requests, pct: u.pct, mode: u.mode }, time: new Date().toISOString() },
      { 'cache-control': 'no-store' });
  }

  if (path === '/api/setup' && wants('POST')) {
    const cred = await adminCredential(env, store);
    if (cred.configured && cred.source === 'env') {
      return json(403, { ok: false, error: 'The admin password is pinned by ADMIN_PASS_HASH in the environment and cannot be changed from the panel.' });
    }
    if (cred.configured) return json(409, { ok: false, error: 'already configured' });
    const { password } = await body();
    if (!password || String(password).length < 8) return json(400, { ok: false, error: 'Password must be at least 8 characters.' });
    if (store.kind === 'memory') {
      return json(501, { ok: false, error: 'Setup needs persistent storage. Bind a D1 database or KV namespace, or set ADMIN_PASS_HASH in the Worker environment. See docs/deploy.md.' });
    }
    await store.setSetting('admin_hash', await sha256Hex(String(password)));
    return json(200, { ok: true });
  }

  /* --------------------------------------------------------------- auth */

  if (path === '/api/login' && wants('POST')) {
    const { password } = await body();
    const res = await login(request, env, store, String(password || ''));
    if (!res.ok) {
      return json(res.reason === 'locked' ? 429 : 401, {
        ok: false, reason: res.reason, retryAfter: res.retryAfter || 0, remaining: res.remaining ?? 0,
        error: res.reason === 'locked' ? `Too many attempts. Try again in ${res.retryAfter}s.` :
          res.reason === 'not-configured' ? 'This panel has no password yet. Run setup first.' : 'Wrong password.',
      }, res.retryAfter ? { 'retry-after': String(res.retryAfter) } : {});
    }
    return json(200, { ok: true }, { 'set-cookie': sessionCookie(res.token, res.ttl) });
  }

  if (path === '/api/logout' && wants('POST')) {
    return json(200, { ok: true }, { 'set-cookie': await logout(request, store) });
  }

  if (path === '/api/me' && wants('GET')) {
    if (!session) return json(401, { ok: false });
    return json(200, { ok: true, ip: clientIp(request) });
  }

  /* -------------------------------------------------- everything below: auth */

  const denied = requireAuth();
  if (denied) return denied;

  const settings = await loadSettings(store);
  const requestHost = new URL(request.url).host;

  if (path === '/api/overview' && wants('GET')) {
    const users = await store.listUsers();
    const u = governor.state(await governor.read());
    const active = users.filter((x) => quotaState(x, settings).active).length;
    return json(200, {
      ok: true, version: VERSION, backend: store.kind, requestHost,
      budget: { requests: u.requests, daily: u.limits.daily, pct: u.pct, mode: u.mode, bytes: u.bytes, estimated: !!u.estimated },
      users: { total: users.length, active, disabled: users.filter((x) => !x.enabled).length,
               expired: users.filter((x) => quotaState(x, settings).expired).length },
      settings: { ...settings, report: validateReport(settings) },
      endpoints: endpointsFor(settings, requestHost),
      workerPorts: WORKER_TCP_PORTS, cfRanges: { v4: CF_RANGES_V4, v6: CF_RANGES_V6 },
      sanctionedCount: SANCTIONED_DOMAINS.length,
      // The UI builds its preset cards, fingerprint/cipher selects, decoy
      // datalist and sanctioned-domain list from these. Serving them keeps the
      // client free of hardcoded enums that silently fall out of date.
      presets: PRESET_LIST,
      sanctionedDomains: SANCTIONED_DOMAINS,
      fingerprints: FINGERPRINTS,
      cipherSuites: Object.keys(CIPHER_SUITES),
      decoys: DECOY_SNI,
      relayConfigured: settings.relays.length > 0,
    });
  }

  if (path === '/api/users' && wants('GET')) {
    const users = await store.listUsers();
    return json(200, { ok: true, users: users.map((u) => publicUser(u)) });
  }

  if (path === '/api/users' && wants('POST')) {
    const b = await body();
    const u = newUser({
      name: b.name, uuid: b.uuid || randomUuid(), trojanPass: b.trojanPass === '' ? null : b.trojanPass,
      quotaGb: b.quota_gb, expireDays: b.expire_days, maxIps: b.max_ips, preset: b.preset || '', note: b.note,
    });
    await store.putUser(u);
    // Flatten the built-link payload instead of nesting it under `links`, which
    // would produce { ok, user, links: { ok, links, subUrl, ... } } — a doubled
    // envelope that every client then has to special-case.
    const built = await linksFor(u, settings, requestHost, b.client);
    return json(200, { ok: true, user: publicUser(u), ...built });
  }

  const um = path.match(/^\/api\/users\/([a-f0-9]{8,32})$/);
  if (um) {
    const id = um[1];
    const existing = await store.getUser(id);
    if (!existing) return notFound('json');
    if (wants('GET')) return json(200, { ok: true, user: publicUser(existing) });
    if (wants('PATCH')) {
      const next = applyEdits(existing, await body());
      await store.putUser(next);
      return json(200, { ok: true, user: publicUser(next) });
    }
    if (wants('DELETE')) { await store.deleteUser(id); return json(200, { ok: true }); }
  }

  if (path.match(/^\/api\/users\/[a-f0-9]{8,32}\/reset$/) && wants('POST')) {
    const id = path.split('/')[3];
    const existing = await store.getUser(id);
    if (!existing) return notFound('json');
    const next = { ...existing, used_bytes: 0, request_count: 0, first_seen_at: 0 };
    await store.putUser(next);
    return json(200, { ok: true, user: publicUser(next) });
  }

  if (path.match(/^\/api\/users\/[a-f0-9]{8,32}\/rotate$/) && wants('POST')) {
    const id = path.split('/')[3];
    const existing = await store.getUser(id);
    if (!existing) return notFound('json');
    const pass = randomTrojanPassword();
    const next = applyEdits(existing, { uuid: randomUuid(), trojan_pass: pass });
    await store.putUser(next);
    return json(200, { ok: true, user: publicUser(next) });
  }

  const cm = path.match(/^\/api\/users\/([a-f0-9]{8,32})\/configs$/);
  if (cm && wants('GET')) {
    const u = await store.getUser(cm[1]);
    if (!u) return notFound('json');
    const url = new URL(request.url);
    return json(200, await linksFor(u, settings, requestHost, url.searchParams.get('client')));
  }

  if (path === '/api/settings' && wants('GET')) {
    return json(200, { ok: true, settings, report: validateReport(settings), endpoints: endpointsFor(settings, requestHost) });
  }
  if (path === '/api/settings' && wants('PUT')) {
    const res = await saveSettings(store, await body());
    // Embed the health report inside `settings` as well as beside it. `/api/overview`
    // returns it nested, and the panel caches `r.settings` verbatim after every
    // save; without this the health checks would silently vanish from the
    // dashboard until the next full overview fetch.
    const settings = { ...res.settings, report: res.report || [] };
    return json(200, { ok: true, settings, report: res.report || [] });
  }

  if (path === '/api/qr' && wants('GET')) {
    const url = new URL(request.url);
    const text = url.searchParams.get('t') || '';
    if (!text) return json(400, { ok: false, error: 'nothing to encode' });
    if (text.length > QR_MAX_BYTES) {
      return json(400, { ok: false, limit: QR_MAX_BYTES, length: text.length,
        error: `too long for a QR code (${text.length} of ${QR_MAX_BYTES} bytes)` });
    }

    // Prefer the requested error-correction level, then step down. A dense but
    // scannable code beats a hard failure, and the response headers report which
    // level and version actually won so the UI can warn about density.
    const wanted = (url.searchParams.get('ec') || 'M').toUpperCase();
    const ladder = [...new Set(['L', 'M', 'Q', 'H'].includes(wanted) ? [wanted, 'M', 'L'] : ['M', 'L'])];
    let svg = null; let info = null; let used = null;
    for (const ec of ladder) {
      info = encodeQr(text, { ec });
      if (info) { svg = qrToSvg(text, { ec }); used = ec; break; }
    }
    if (!svg) {
      return json(413, { ok: false, limit: QR_MAX_BYTES, length: text.length,
        error: 'text does not fit a QR code at any error-correction level' });
    }
    return new Response(svg, {
      headers: {
        'content-type': 'image/svg+xml', 'cache-control': 'no-store',
        'x-luncher-qr-version': String(info.version),
        'x-luncher-qr-ec': used,
        'x-luncher-qr-size': String(info.size),
      },
    });
  }

  /**
   * Egress probe: what source IP does the outside world actually see?
   *
   * This is the single most useful diagnostic for sanctioned services. Gemini,
   * Google AI Studio and OpenAI reject by *source IP*, so no amount of
   * fragmentation helps if the exit is Iranian. The probe dials a plaintext
   * echo service over port 80 (a port Workers is allowed to use), optionally
   * through one of the configured relays, and reports the IP plus its country.
   */
  if (path === '/api/egress' && wants('POST')) {
    const b = await body();
    const idx = Number.isInteger(b.relay) ? b.relay : -1;
    const relay = idx >= 0 ? (settings.relays || [])[idx] : null;
    if (idx >= 0 && !relay) return json(400, { ok: false, error: 'no such relay' });

    const target = { host: 'api.ipify.org', port: 80 };
    const started = Date.now();
    let conn = null;
    try {
      conn = await upstream.open(target, { relay });
      const w = conn.writable.getWriter();
      await w.write(new TextEncoder().encode(
        'GET /ip HTTP/1.1\r\nHost: api.ipify.org\r\nUser-Agent: luncher/1.0\r\n' +
        'Accept: */*\r\nConnection: close\r\n\r\n'));

      const reader = conn.readable.getReader();
      let acc = new Uint8Array(0);
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline && acc.length < 16384) {
        const { done, value } = await reader.read();
        if (done) break;
        const next = new Uint8Array(acc.length + value.length);
        next.set(acc); next.set(value, acc.length); acc = next;
      }
      const text = new TextDecoder().decode(acc);
      const payload = text.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
      const ipMatch = payload.match(/[0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9a-fA-F:]{2,45}/);
      const exitIp = ipMatch ? ipMatch[0] : null;
      const ms = Date.now() - started;
      if (!exitIp) {
        return json(502, { ok: false, error: 'Probe returned no address. The relay may be unreachable or refused the connection.', via: conn.via, ms });
      }

      // Country lookup is best-effort: a failure here must not fail the probe.
      let country = 'unknown'; let detail = '';
      try {
        const geo = await fetch('https://ipapi.co/' + encodeURIComponent(exitIp) + '/json/', {
          signal: AbortSignal.timeout(5000), cf: { cacheTtl: 3600 },
        }).then((r) => (r.ok ? r.json() : null));
        if (geo) {
          country = geo.country_name || geo.country || 'unknown';
          detail = [geo.country_name, geo.region, geo.city, geo.org].filter(Boolean).join(' · ');
        }
      } catch { /* geo lookup is optional */ }

      const sanctionRisk = country === 'Iran' || /\bIR\b/.test(detail);
      return json(200, {
        ok: true, exitIp, ms, via: conn.via, country, detail, sanctionRisk,
        target: target.host + ':' + target.port,
        hint: sanctionRisk
          ? 'This exit IP is Iranian: Gemini, Google AI Studio, OpenAI and Claude will refuse it regardless of fragmentation. Add a relay outside Iran.'
          : 'This exit IP is not Iranian, so application-layer geo-blocks should not trigger. If a service still refuses, it is blocking datacenter ranges — a residential relay fixes that.',
      });
    } catch (err) {
      return json(502, {
        ok: false, via: conn ? conn.via : 'n/a', ms: Date.now() - started,
        error: String((err && err.message) || err),
        hint: err && err.code === 'relay-auth' ? 'The relay rejected the credentials.'
          : err && err.code === 'relay-refused' ? 'The relay refused the CONNECT request.'
          : 'Check that the relay listens on a port Cloudflare Workers may dial (443 is the safe choice).',
      });
    } finally {
      if (conn) { try { conn.close(); } catch { /* already closed */ } }
    }
  }

  if (path === '/api/backup' && wants('GET')) {
    const users = await store.listUsers();
    return json(200, {
      ok: true, version: VERSION, exportedAt: new Date().toISOString(),
      settings, users: users.map((u) => publicUser(u)),
    }, { 'content-disposition': 'attachment; filename="luncher-backup.json"' });
  }

  if (path === '/api/backup' && wants('POST')) {
    const b = await body();
    if (!b || typeof b !== 'object') return json(400, { ok: false, error: 'invalid backup' });
    if (b.settings) await saveSettings(store, b.settings);
    let n = 0;
    for (const u of b.users || []) {
      if (!u || !u.id) continue;
      await store.putUser(newUser({ name: u.name, uuid: u.uuid, trojanPass: u.trojan_pass || '',
        quotaGb: u.quota_gb, expireDays: u.expire_days, maxIps: u.max_ips, preset: u.preset, note: u.note }));
      n++;
    }
    return json(200, { ok: true, imported: n });
  }

  return notFound('json');

  async function linksFor(user, st, host, client) {
    const s = settingsForUser(st, user);
    const eps = endpointsFor(s, host);
    const links = buildAll({ user, endpoints: eps, settings: { ...s, clients: client ? [client] : s.clients, profileTitle: s.profileTitle }, max: s.maxLinksPerSub });
    const ep = eps.find((x) => x.address !== host) || eps[0];
    return {
      ok: true,
      links,
      json: buildXrayJson({ user, endpoint: ep, settings: s, style: s.jsonStyle, blockAds: s.blockAds, unlockSanctioned: s.unlockSanctioned }),
      subUrl: `${new URL(request.url).origin}/sub/${user.uuid}`,
      statusUrl: `${new URL(request.url).origin}/s/${user.uuid}`,
      endpoints: eps,
    };
  }
}

/* ------------------------------------------------- subscriptions & status */

export async function handleSubscription(match, request, { env, store, settings, governor }) {
  const token = match[1];
  const suffix = match[2] || '';
  const url = new URL(request.url);
  const origin = url.origin;
  const host = url.host;

  const user = await store.findUser({ uuid: token });
  if (!user) return html(404, SUB_MISSING);

  const q = quotaState(user, settings);
  if (!q.active) return html(403, SUB_INACTIVE(user, q));

  const clientParam = url.searchParams.get('client');
  const clients = clientParam ? [clientParam] : settings.clients;
  const eps = endpointsFor(settings, host);
  const links = buildAll({ user, endpoints: eps, settings: { ...settingsForUser(settings, user), clients, profileTitle: settings.profileTitle }, max: settings.maxLinksPerSub });

  // Touch first_seen so "start on first connect" works from the subscription too.
  if (!user.first_seen_at) {
    const stamp = { ...user, first_seen_at: Date.now() };
    store.putUser(stamp).catch(() => { /* best effort */ });
  }

  const wantsJson = suffix === '/json' || url.searchParams.get('format') === 'json';

  /**
   * Encoding is always truthful about itself.
   *
   * The `content-type` must match the bytes on the wire. Returning base64 under
   * `application/json` breaks any client that trusts the header (Hiddify does),
   * while v2rayNG/PattNG tolerate raw JSON because their base64 decode fails on
   * `{` and `"` and they fall back to parsing the text. So raw JSON is the
   * default here and `?b64=1` opts into the wrapped form.
   *
   * The link list is the mirror image: raw text is the default (it is what
   * v2rayNG, PattNG and Hiddify all accept, and it is debuggable with curl),
   * with `?b64=1` for clients that expect the wrapped convention.
   */
  const b64 = url.searchParams.get('b64') === '1' || url.searchParams.get('base64') === '1';
  const wrap = (text) => (b64 ? btoa(unescape(encodeURIComponent(text))) : text);

  // Build the body first, then run ONE cache path for both formats. Caching the
  // JSON subscription matters most: it is the largest response and Xray/Hiddify
  // poll it on a timer, so every hit is a Worker request and a D1/KV read saved.
  let payload;
  let contentType;
  if (wantsJson) {
    const ep = eps.find((x) => x.address !== host) || eps[0];
    const cfg = buildXrayJson({ user, endpoint: ep, settings: settingsForUser(settings, user),
      style: settings.jsonStyle, blockAds: settings.blockAds, unlockSanctioned: settings.unlockSanctioned });
    payload = wrap(JSON.stringify(cfg, null, 2));
    contentType = b64 ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8';
  } else {
    payload = wrap(links.map((l) => l.link).join('\n'));
    contentType = 'text/plain; charset=utf-8';
  }

  const headers = { ...subscriptionHeaders({ profileTitle: settings.profileTitle, supportUrl: `${origin}/s/${token}` }),
    'content-type': contentType };

  if (settings.subCacheSeconds > 0 && request.method === 'GET') {
    try {
      // The key must carry every input that changes the bytes: the client list,
      // the format suffix AND the b64 flag. Omitting b64 would let a cached raw
      // body be served to a client that asked for the wrapped one.
      const variant = `${clients.join('-')}${suffix}${b64 ? '-b64' : ''}`;
      const cacheKey = new Request(`${origin}/__subcache/${token}/${variant}`, { method: 'GET' });
      const cached = await caches.default.match(cacheKey);
      if (cached) return new Response(cached.body, { headers: { ...headers, 'x-luncher-cache': 'hit' } });
      const res = new Response(payload, { headers: { ...headers, 'x-luncher-cache': 'miss' } });
      caches.default.put(cacheKey, res.clone()).catch(() => { /* cache is best-effort */ });
      return res;
    } catch { /* fall through to uncached */ }
  }
  return new Response(payload, { headers });
}

export async function handleStatusPage(match, request, { store, settings }) {
  const token = match[1];
  const user = await store.findUser({ uuid: token });
  if (!user) return html(404, SUB_MISSING);
  const q = quotaState(user, settings);
  const links = buildAll({ user, endpoints: endpointsFor(settings, new URL(request.url).host),
    settings: { ...settingsForUser(settings, user), profileTitle: settings.profileTitle }, max: settings.maxLinksPerSub });
  return html(200, STATUS_PAGE({ user, q, links, settings }));
}

const SUB_MISSING = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Luncher</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05060a;color:#e8eaf2;
font:16px/1.7 system-ui,"Segoe UI",Tahoma,sans-serif;padding:24px;text-align:center}
h1{font-size:22px}p{color:#9aa2bd;max-width:44ch}</style></head>
<body><div><h1>این لینک معتبر نیست</h1>
<p>This subscription link does not match any user on this panel. Ask the panel owner for a fresh link.</p>
</div></body></html>`;

const SUB_INACTIVE = (user, q) => `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Luncher</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05060a;color:#e8eaf2;
font:16px/1.7 system-ui,"Segoe UI",Tahoma,sans-serif;padding:24px;text-align:center}
.c{max-width:46ch}.b{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:10px;
background:#2a1220;border:1px solid #5b2340;color:#ffc9de;font-size:14px}h1{font-size:22px}</style></head>
<body><div class="c"><h1>${escapeHtml(user.name)}</h1>
<p>${q.expired ? 'اشتراک شما منقضی شده است.' : 'سهمیهٔ ترافیک شما تمام شده است.'}<br>
${q.expired ? 'Your subscription has expired.' : 'Your traffic quota is exhausted.'}</p>
<div class="b">${q.expired && q.daysLeft !== null ? `${q.daysLeft} days overdue` : `${Math.round((q.usedBytes / 1073741824) * 100) / 100} / ${Math.round(q.quotaBytes / 1073741824)} GB`}</div>
</div></body></html>`;

const STATUS_PAGE = ({ user, q, links, settings }) => `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(user.name)} · Luncher</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#05060a;color:#e8eaf2;font:15px/1.7 system-ui,"Segoe UI",Tahoma,sans-serif;
padding:20px;min-height:100vh;background-image:radial-gradient(1200px 600px at 80% -10%,rgba(255,169,77,.13),transparent 60%),radial-gradient(900px 500px at 0% 110%,rgba(64,224,208,.10),transparent 60%)}
.w{max-width:720px;margin:0 auto}
.hd{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.dot{width:10px;height:10px;border-radius:50%;background:${q.active ? '#4ade80' : '#f87171'};box-shadow:0 0 12px ${q.active ? '#4ade80' : '#f87171'}}
h1{font-size:19px;margin:0;font-weight:650}
.card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-bottom:12px;backdrop-filter:blur(8px)}
.row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px dashed rgba(255,255,255,.07);font-size:14px}
.row:last-child{border:0}
.k{color:#9aa2bd}.v{font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;text-align:left;direction:ltr}
.bar{height:8px;border-radius:99px;background:#151827;overflow:hidden;margin-top:8px}
.bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#ffa94d,#ff6b6b)}
a.lnk{display:block;padding:11px 14px;border-radius:12px;background:#0d1018;border:1px solid #1e2233;color:#cfe3ff;
text-decoration:none;font-size:13px;margin-bottom:8px;word-break:break-all;direction:ltr;text-align:left;font-family:ui-monospace,Menlo,monospace}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;background:#1b2136;color:#9fc0ff;font-size:11px;margin-inline-start:6px}
.ft{color:#5f6784;font-size:12px;text-align:center;margin-top:20px}
</style></head><body><div class="w">
<div class="hd"><span class="dot"></span><h1>${escapeHtml(user.name)}</h1>
<span class="tag">${q.active ? 'فعال / Active' : 'غیرفعال / Inactive'}</span></div>
<div class="card">
<div class="row"><span class="k">وضعیت / Status</span><span class="v">${q.active ? 'ACTIVE' : 'INACTIVE'}</span></div>
<div class="row"><span class="k">انقضا / Expiry</span><span class="v">${q.daysLeft === null ? 'بدون محدودیت / unlimited' : q.daysLeft + ' روز / days left'}</span></div>
${q.quotaBytes ? `<div class="row"><span class="k">ترافیک / Traffic</span><span class="v">${Math.round(q.usedBytes / 10737418.24) / 100} / ${Math.round(q.quotaBytes / 1073741824)} GB</span></div>
<div class="bar"><i style="width:${q.usedPct || 0}%"></i></div>` : ''}
<div class="row"><span class="k">پریست ضد فیلتر / Anti-DPI preset</span><span class="v">${escapeHtml(user.preset || settings.preset)}</span></div>
</div>
<div class="card"><div class="k" style="margin-bottom:10px">کانفیگ‌ها / Configs — روی هرکدام بزنید تا کپی شود</div>
${links.map((l) => `<a class="lnk" href="${escapeHtml(l.link)}">${escapeHtml(l.remark)}</a>`).join('')}
</div>
<div class="ft">Powered by Luncher · ${escapeHtml(settings.panelName || 'Luncher')}</div>
</div></body></html>`;

export { VERSION };
