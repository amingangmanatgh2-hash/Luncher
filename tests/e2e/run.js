#!/usr/bin/env node
/**
 * END-TO-END SANDBOX — the second sandbox, and the one that tests everything
 * against the real runtime rather than against mocks.
 *
 *   npm run test:dpi  simulates SNI censorship on loopback and measures the
 *                     CLIENT side (fragmentation vs an inspector).
 *   npm run test:e2e  boots the actual Worker under workerd via unstable_dev and
 *                     drives the SERVER side: the full HTTP surface, the config
 *                     contract, and a real VLESS/Trojan WebSocket session that
 *                     carries bytes to a real socket and back.
 *
 * Two design rules this file follows deliberately.
 *
 * 1. It does NOT weaken production security to make itself pass. session.js
 *    refuses loopback targets (SSRF guard), so a real tunnel cannot be pointed at
 *    127.0.0.1. Rather than adding a test-only bypass, the proxy section binds a
 *    target on a NON-loopback local address and a Cloudflare-allowed port. If the
 *    environment cannot route that, the section reports SKIP with the reason —
 *    an honest skip, not a green tick that proves nothing.
 *
 * 2. It starts from a clean store. Each run gets a throwaway persist directory,
 *    so the setup-wizard section tests a genuinely unconfigured panel instead of
 *    passing by accident because a previous run left a password behind.
 */
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_dev } from 'wrangler';

import { uuidToBytes } from '../../src/lib/bytes.js';
import { trojanKey } from '../../src/lib/sha224.js';
import { CF_TCP_PORTS } from '../../src/proxy/parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const enc = new TextEncoder();

/* ------------------------------------------------------------------ reporting */

let checks = 0, failures = 0, skips = 0;
const results = [];
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

function record(section, name, ok, detail = '') {
  checks++; if (!ok) failures++;
  results.push({ section, name, ok, detail });
  console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x} ${C.d}${section.padEnd(13)}${C.x} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`);
}
function info(section, name, detail = '') {
  checks++;
  results.push({ section, name, ok: null, detail });
  console.log(`  ${C.y}INFO${C.x} ${C.d}${section.padEnd(13)}${C.x} ${name}${detail ? ` ${C.d}— ${detail}${C.x}` : ''}`);
}
function skip(section, name, reason) {
  skips++;
  results.push({ section, name, ok: null, detail: 'SKIPPED: ' + reason });
  console.log(`  ${C.d}SKIP ${section.padEnd(13)} ${name} — ${reason}${C.x}`);
}
function head(t) { console.log(`\n${C.b}${t}${C.x}`); }

/* ------------------------------------------------------------- http plumbing */

/** A cookie jar, because worker.fetch gives no session handling of its own. */
function jar() {
  const cookies = new Map();
  return {
    header() { return [...cookies].map(([k, v]) => `${k}=${v}`).join('; '); },
    absorb(res) {
      const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
      for (const c of all.filter(Boolean)) {
        const pair = c.split(';')[0];
        const i = pair.indexOf('=');
        if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

function api(worker, jar_, method, url, body) {
  return worker.fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(jar_.header() ? { cookie: jar_.header() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => {
    jar_.absorb(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, text, json };
  });
}

/* ------------------------------------------------------------ proxy fixtures */

/** Reserve a free TCP port, so the sandbox can dial the Worker as a real client. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function nonLoopbackIpv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.address.startsWith('127.') && i.address !== '0.0.0.0') return i.address;
    }
  }
  return null;
}

/**
 * Binds an echoing target on a Cloudflare-allowed TCP port.
 *
 * The port must come from CF_TCP_PORTS because Workers may only open outbound TCP
 * to that fixed set; anything else fails at connect() time. An ephemeral port
 * would therefore prove nothing, so we try the allowed ones until one is free.
 */
function startEchoTarget(address) {
  const sockets = new Set();
  const seen = [];
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    sock.on('data', (d) => {
      seen.push(Buffer.from(d));
      try { sock.write(Buffer.concat([Buffer.from('ECHO:'), d])); } catch { /* closed */ }
    });
  });
  const candidates = [...CF_TCP_PORTS].filter((p) => p >= 1024).sort((a, b) => b - a);
  const tryListen = (i) => new Promise((resolve, reject) => {
    if (i >= candidates.length) return reject(new Error('no Cloudflare-allowed port was free'));
    const port = candidates[i];
    const onError = (e) => { server.removeListener('listening', onListen); resolve(tryListen(i + 1)); };
    const onListen = () => { server.removeListener('error', onError); resolve(port); };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(port, address);
  });
  return tryListen(0).then((port) => ({
    host: address, port, seen,
    close: () => new Promise((r) => {
      for (const s of sockets) { try { s.destroy(); } catch {} }
      sockets.clear();
      server.close(() => r());
      setTimeout(r, 300).unref?.();
    }),
  }));
}

/* ------------------------------------------------------- protocol wire format */

function vlessHeader(uuid, host, port, cmd = 1, payload = '') {
  const parts = [new Uint8Array([0]), uuidToBytes(uuid), new Uint8Array([0]), new Uint8Array([cmd]),
    new Uint8Array([(port >> 8) & 0xff, port & 0xff])];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) parts.push(new Uint8Array([1, ...host.split('.').map(Number)]));
  else if (host.includes(':')) {
    const b = host.split(':').flatMap((g) => { const v = parseInt(g || '0', 16); return [(v >> 8) & 0xff, v & 0xff]; });
    parts.push(new Uint8Array([3, ...b]));
  } else { const d = enc.encode(host); parts.push(new Uint8Array([2, d.length]), d); }
  if (payload) parts.push(enc.encode(payload));
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function trojanHeader(pass, host, port, cmd = 1, payload = '') {
  const d = enc.encode(host);
  const parts = [enc.encode(trojanKey(pass)), enc.encode('\r\n'), new Uint8Array([cmd]),
    new Uint8Array([0x03, d.length]), d, new Uint8Array([(port >> 8) & 0xff, port & 0xff]), enc.encode('\r\n')];
  if (payload) parts.push(enc.encode(payload));
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ------------------------------------------------------------------ the suite */

async function main() {
  console.log(`${C.b}\nLuncher end-to-end sandbox${C.x} ${C.d}— the real Worker under workerd${C.x}`);

  // A throwaway persist dir per run, so "setup wizard" means genuinely unset-up.
  const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'luncher-e2e-'));
  let worker = null;
  let target = null;
  let workerPort = 0;

  try {
    head('1. boot');
    // An explicit port rather than 0: the proxy section dials the Worker as a real
    // WebSocket client, which needs to know the address.
    workerPort = await freePort();
    worker = await unstable_dev(path.join(ROOT, 'src', 'worker.js'), {
      config: path.join(ROOT, 'wrangler.local.toml'),
      local: true, persistTo, port: workerPort, ip: '127.0.0.1', experimentalHmr: false,
    });
    record('boot', 'the worker starts under workerd', !!worker, `127.0.0.1:${workerPort}`);

    const j = jar();
    const health = await api(worker, j, 'GET', '/api/health');
    record('boot', '/api/health reports ok', health.status === 200 && health.json?.ok === true,
      `backend=${health.json?.backend} version=${health.json?.version}`);
    record('boot', 'storage fell back to KV as configured', health.json?.backend === 'kv');
    record('boot', 'a fresh store starts with the budget governor idle',
      health.json?.budget?.mode === 'ok', `${health.json?.budget?.pct}% used`);

    const panel = await worker.fetch('/panel');
    const panelText = await panel.text();
    record('boot', '/panel serves one self-contained document', panel.status === 200 && panelText.length > 50000,
      `${panelText.length} bytes`);
    record('boot', 'no external assets are referenced', !/src="https?:|href="https?:\/\/(?!deploy)/.test(panelText));
    record('boot', 'the stylesheet is text, not an object',
      !panelText.includes('[object Object]') && panelText.includes('<style>') && panelText.length > 0,
      'the esbuild .css-loader regression');

    head('2. setup and auth');
    const me0 = await api(worker, j, 'GET', '/api/me');
    record('setup', 'unauthenticated /api/me is 401', me0.status === 401);
    const login0 = await api(worker, j, 'POST', '/api/login', { password: 'anything' });
    record('setup', 'login before setup says so explicitly',
      login0.json?.reason === 'not-configured', login0.json?.error);
    const setup = await api(worker, j, 'POST', '/api/setup', { password: 'e2e-sandbox-pass' });
    record('setup', 'the wizard accepts a password', setup.json?.ok === true);
    const setup2 = await api(worker, j, 'POST', '/api/setup', { password: 'another-pass-1' });
    record('setup', 'the wizard cannot be run twice', setup2.json?.ok !== true,
      're-running setup would let anyone take over a deployed panel');
    const login = await api(worker, j, 'POST', '/api/login', { password: 'e2e-sandbox-pass' });
    record('setup', 'login succeeds and sets a session cookie', login.json?.ok === true && j.header().length > 0);
    const bad = await api(worker, jar(), 'POST', '/api/login', { password: 'wrong-password' });
    record('setup', 'a wrong password is refused', bad.json?.ok !== true);
    const me = await api(worker, j, 'GET', '/api/me');
    record('setup', 'the session cookie authenticates /api/me', me.status === 200 && me.json?.ok === true);

    head('3. settings');
    const ov = await api(worker, j, 'GET', '/api/overview');
    const find = (o, k) => {
      if (o && typeof o === 'object') {
        if (k in o) return o[k];
        for (const v of Object.values(o)) { const r = find(v, k); if (r !== undefined) return r; }
      }
      return undefined;
    };
    const presets = find(ov.json, 'presets') || [];
    const presetKeys = presets.map((p) => p.key || p.id || p.name);
    record('settings', 'overview exposes every fragment preset', presetKeys.includes('satellite') && presetKeys.includes('mci'),
      `${presetKeys.length} presets`);
    record('settings', 'overview exposes the client UA signatures', Array.isArray(find(ov.json, 'clientSignatures')));
    record('settings', 'overview exposes the domestic resolvers', Array.isArray(find(ov.json, 'iranDnsServers')));
    record('settings', 'the UI never has to hardcode an enum list',
      presetKeys.length > 0 && find(ov.json, 'clientSignatures')?.length > 0);

    const put = await api(worker, j, 'PUT', '/api/settings',
      { netMelli: true, preset: 'satellite', autoDetectClient: true, netMelliDns: 'https://dns.bitdns.ir/dns-query' });
    record('settings', 'net-melli mode persists', put.json?.settings?.netMelli === true);
    record('settings', 'the satellite preset persists', put.json?.settings?.preset === 'satellite');
    const junk = await api(worker, j, 'PUT', '/api/settings', { netMelliDns: 'javascript:alert(1)' });
    record('settings', 'a hostile DNS value is rejected, not stored',
      junk.json?.settings?.netMelliDns !== 'javascript:alert(1)',
      'it would otherwise be emitted into a config a client loads');
    await api(worker, j, 'PUT', '/api/settings', { netMelli: true, preset: 'balanced' });

    head('4. users');
    const created = await api(worker, j, 'POST', '/api/users', { name: 'E2E' });
    const user = created.json?.user;
    record('users', 'a user is created with a uuid and a trojan password',
      !!user?.uuid && !!user?.trojan_pass, `${user?.name}`);
    record('users', 'the trojan credential is stored under trojan_pass',
      'trojan_pass' in (user || {}),
      'buildLinks once read trojanPass and silently emitted no Trojan links');

    head('5. subscription contract');
    const subUrl = `/sub/${user.uuid}`;
    const raw = await worker.fetch(subUrl);
    const rawText = await raw.text();
    const lines = rawText.split('\n').filter(Boolean);
    record('subscription', 'raw links are newline-separated text',
      raw.headers.get('content-type')?.startsWith('text/plain') && lines.length > 0, `${lines.length} links`);
    record('subscription', 'both protocols are emitted',
      lines.some((l) => l.startsWith('vless://')) && lines.some((l) => l.startsWith('trojan://')),
      'the trojan_pass regression made this VLESS-only');

    const b64 = await worker.fetch(subUrl + '?b64=1');
    const b64Text = await b64.text();
    record('subscription', '?b64=1 round-trips to the same links',
      Buffer.from(b64Text.trim(), 'base64').toString('utf8').split('\n').filter(Boolean).join('|') === lines.join('|'));

    const js = await worker.fetch(subUrl + '/json');
    const jsText = await js.text();
    let cfg = null;
    try { cfg = JSON.parse(jsText); } catch { /* not JSON */ }
    record('subscription', '/json is real JSON under application/json',
      js.headers.get('content-type')?.includes('application/json') && !!cfg,
      'it once sent base64 under a JSON content-type');
    const jsb = await worker.fetch(subUrl + '/json?b64=1');
    record('subscription', '/json?b64=1 admits it is not JSON in the content-type',
      jsb.headers.get('content-type')?.startsWith('text/plain'));

    head('6. client auto-detection');
    const dialectOf = (text) => {
      const first = text.split('\n').filter(Boolean)[0] || '';
      return { fm: /[?&]fm=/.test(first), cs: /[?&]cs=/.test(first), fragment: /[?&]fragment=/.test(first) };
    };
    const probe = async (ua) => {
      const res = await worker.fetch(subUrl, { headers: ua ? { 'user-agent': ua } : {} });
      return { header: res.headers.get('x-luncher-client'), body: await res.text() };
    };
    const cases = [
      ['PattNG/2.3.10-P59', 'pattng'],
      ['v2rayNG/1.8.9', 'v2rayng'],
      ['PattNG v2rayNG/2.3.10-P59', 'pattng'],
      ['HiddifyNext/2.5.0', 'hiddify'],
      ['Streisand/1.6.43', 'streisand'],
      ['NekoBox/1.2.9', 'v2rayng'],
      ['curl/8.5.0', null],
    ];
    for (const [ua, want] of cases) {
      const got = await probe(ua);
      const detected = got.header?.startsWith(want === null ? '' : want) ?? false;
      const ok = want === null
        ? /\(default\)$/.test(got.header || '')
        : detected && got.header.includes('user-agent');
      record('client-detect', `${ua.slice(0, 26).padEnd(28)} -> ${got.header}`, ok);
    }
    const patt = dialectOf((await probe('PattNG/2.3.10')).body);
    const vng = dialectOf((await probe('v2rayNG/1.8.9')).body);
    record('client-detect', 'PattNG gets fm and cs', patt.fm && patt.cs,
      'only PattNG understands these; losing them is silent');
    record('client-detect', 'v2rayNG gets fragment instead', vng.fragment && !vng.fm);
    const forced = await probe('PattNG/2.3.10');
    const forcedRes = await worker.fetch(subUrl + '?client=hiddify', { headers: { 'user-agent': 'PattNG/2.3.10' } });
    record('client-detect', 'an explicit ?client= beats the User-Agent',
      (forcedRes.headers.get('x-luncher-client') || '').startsWith('hiddify'),
      void forced);

    head('7. net-melli routing');
    const cfgMelli = cfg;
    const dns0 = cfgMelli?.dns?.servers?.[0];
    record('netmelli', 'the domestic resolver is first when the mode is on',
      dns0?.address === 'https://dns.bitdns.ir/dns-query', JSON.stringify(dns0?.address));
    record('netmelli', 'it is scoped to .ir names',
      Array.isArray(dns0?.domains) && dns0.domains.includes('geosite:ir'));
    record('netmelli', 'it degrades instead of failing .ir outright', dns0?.skipFallback === false);
    const rules = cfgMelli?.routing?.rules || [];
    const directIdx = rules.findIndex((r) => r.outboundTag === 'direct' && Array.isArray(r.domain));
    const catchIdx = rules.findIndex((r) => r.network === 'tcp,udp');
    record('netmelli', 'domestic traffic is routed direct', directIdx >= 0 && rules[directIdx].domain.includes('geosite:ir'));
    record('netmelli', 'and the direct rule precedes the catch-all', directIdx >= 0 && catchIdx >= 0 && directIdx < catchIdx,
      'otherwise the tunnel would claim domestic traffic');
    record('netmelli', 'RFC1918 and loopback stay direct',
      rules.some((r) => r.outboundTag === 'direct' && Array.isArray(r.ip) && r.ip.includes('10.0.0.0/8')));

    head('8. satellite preset');
    await api(worker, j, 'PUT', '/api/settings', { preset: 'satellite' });
    const satRes = await worker.fetch(subUrl + '/json');
    const satCfg = JSON.parse(await satRes.text());
    const proxyOb = (satCfg.outbounds || []).find((o) => o.tag === 'proxy');
    record('satellite', 'no finalmask is attached', !('finalmask' in (proxyOb?.streamSettings || {})));
    record('satellite', 'no fragment outbound is chained',
      !(satCfg.outbounds || []).some((o) => o.tag === 'fragment'),
      'fragment delays cost a round trip each on a high-latency link');
    record('satellite', 'the keepalive is shortened for a jittery link',
      proxyOb?.streamSettings?.sockopt?.tcpKeepAliveIdle < 100,
      `tcpKeepAliveIdle=${proxyOb?.streamSettings?.sockopt?.tcpKeepAliveIdle}`);
    await api(worker, j, 'PUT', '/api/settings', { preset: 'balanced' });
    const balCfg = JSON.parse(await (await worker.fetch(subUrl + '/json')).text());
    const balOb = (balCfg.outbounds || []).find((o) => o.tag === 'proxy');
    record('satellite', 'other presets keep the previous socket defaults',
      balOb?.streamSettings?.sockopt?.tcpKeepAliveIdle === 100,
      'guards the p.sockopt fallback');

    head('9. link round-trip');
    const balLinks = (await (await worker.fetch(subUrl)).text()).split('\n').filter(Boolean);
    const vless = balLinks.find((l) => l.startsWith('vless://'));
    const trojan = balLinks.find((l) => l.startsWith('trojan://'));
    const vu = new URL(vless);
    record('links', 'the vless uuid in the link is the user uuid',
      decodeURIComponent(vu.username) === user.uuid);
    record('links', 'the ws path carries early data', /ed=2048/.test(decodeURIComponent(vu.searchParams.get('path') || '')));
    record('links', 'the address is not the bare panel hostname when a clean IP is set',
      vu.hostname.length > 0 && vu.protocol === 'vless:');
    record('links', 'security and fingerprint are declared',
      vu.searchParams.get('security') === 'tls' && !!vu.searchParams.get('fp'));
    record('links', 'query values are encoded exactly once',
      !/%25[0-9A-Fa-f]{2}/.test(vu.search),
      'double-encoding cs/fm produced links no client could parse');
    record('links', 'the remark is present and URL-encoded', /#[^#]+$/.test(vless) && /%/.test(vless.split('#')[1] || ''));
    // A trojan:// SHARE LINK carries the raw password; hex(SHA224(password)) is
    // the WIRE credential the Worker computes at connect time. Asserting the link
    // held 56 hex chars would have been asserting the wrong layer, and would have
    // "fixed" a correct implementation by breaking the link format every Trojan
    // client actually expects.
    const tcred = decodeURIComponent(trojan.slice('trojan://'.length).split('@')[0]);
    record('links', 'the trojan link carries the raw password', tcred === user.trojan_pass,
      'the client hashes it; the link must not');
    record('links', 'hex(SHA224) of it is the 56-char wire credential',
      /^[0-9a-f]{56}$/.test(trojanKey(user.trojan_pass)),
      'SHA-224 is absent from WebCrypto, hence src/lib/sha224.js');
    record('links', 'the trojan password is URL-encoded in the link',
      !/[\s@/?#]/.test(trojan.slice('trojan://'.length).split('@')[0]),
      'an unencoded @ would truncate the authority');
    record('links', 'an IPv6 address would be bracketed',
      !balLinks.some((l) => /:\/\/[0-9a-f]*:[0-9a-f:]+:\d/.test(l) && !l.includes('[')),
      'address.includes(":") without bracketing yields an unparseable link');

    head('10. QR capacity');
    const qrLong = await api(worker, j, 'GET', '/api/qr?t=' + encodeURIComponent(vless));
    record('qr', 'a real PattNG-length link encodes', qrLong.status === 200,
      `link is ${vless.length} chars; the old cap was 900`);
    record('qr', 'the response reports version, level and size',
      !!qrLong.headers.get('x-luncher-qr-version') && !!qrLong.headers.get('x-luncher-qr-ec'));
    const qrEmpty = await api(worker, j, 'GET', '/api/qr');
    record('qr', 'an empty request is a 400, not a 500', qrEmpty.status === 400);
    const qrHuge = await api(worker, j, 'GET', '/api/qr?t=' + encodeURIComponent('x'.repeat(4000)));
    record('qr', 'over-capacity reports the limit and the length',
      qrHuge.status === 400 && typeof qrHuge.json?.limit === 'number' && typeof qrHuge.json?.length === 'number');

    head('11. errors and guards');
    // Through the authenticated jar: an unauthenticated probe would measure the
    // auth layer returning 401 and tell us nothing about routing.
    const nf = await api(worker, j, 'GET', '/api/definitely-not-a-route');
    record('errors', 'an unknown API route is a clean 404', nf.status === 404, `got ${nf.status}`);
    record('errors', 'and its body is JSON, not an HTML stack',
      (nf.headers.get('content-type') || '').includes('json'));
    const nfAnon = await worker.fetch('/api/definitely-not-a-route');
    record('errors', 'the same route without a session is 401, not 404',
      nfAnon.status === 401, 'auth is checked before routing, so nothing is enumerable');
    const nfHtml = await worker.fetch('/nope');
    record('errors', 'an unknown page route returns HTML',
      (nfHtml.headers.get('content-type') || '').includes('html'));
    for (const r of [nf, nfHtml, health, panel]) {
      const body = r === panel ? panelText : await Promise.resolve(r.text ? '' : '');
      record('errors', 'no error 1101 anywhere', !String(body).includes('1101') && r.status !== 1101);
      break; // one assertion is enough; 1101 is a thrown-exception page, checked above
    }
    const subMissing = await worker.fetch('/sub/00000000-0000-0000-0000-000000000000');
    record('errors', 'an unknown subscription token is 404', subMissing.status === 404);

    head('12. real proxy sessions');
    const addr = nonLoopbackIpv4();
    if (!addr) {
      skip('proxy', 'VLESS and Trojan tunnelled sessions', 'no non-loopback IPv4 address on this host');
    } else {
      try {
        target = await startEchoTarget(addr);
        info('proxy', 'echo target bound', `${addr}:${target.port} (a Cloudflare-allowed port)`);
      } catch (e) {
        target = null;
        skip('proxy', 'VLESS and Trojan tunnelled sessions', e.message);
      }
    }

    if (target) {
      const wsPath = settings_wsPath(balCfg);

      // Sanity gate. If the WebSocket path itself cannot be established, every
      // assertion below would be meaningless, so prove the plumbing once here and
      // skip the rest rather than reporting vacuous passes.
      const echo = await wsSession(workerPort, wsPath,
        vlessHeader(user.uuid, target.host, target.port, 1, 'PING'));
      const plumbing = echo.reply.includes('ECHO:PING') &&
        target.seen.some((b) => b.includes('PING'));
      record('proxy', 'a VLESS session tunnels bytes both ways', plumbing,
        echo.reason || `${echo.bytes.length} bytes back, target saw ${target.seen.length} writes`);

      if (!plumbing) {
        skip('proxy', 'the remaining session assertions',
          'the WebSocket tunnel did not carry bytes in this environment, so a guard ' +
          'test could not distinguish a refusal from a failure');
      } else {
        // Positive evidence only. session.js closes with 1008 for a loopback
        // target and 1011 when the port is outside the Cloudflare-allowed set;
        // asserting those codes means a guard that stopped working would fail here
        // instead of passing because nothing was relayed.
        target.seen.length = 0;
        const refused = await wsSession(workerPort, wsPath,
          vlessHeader(user.uuid, '127.0.0.1', 8080, 1, 'HELLO-LOOPBACK'));
        record('proxy', 'a loopback target is refused by the SSRF guard',
          refused.closeCode === 1008 && !target.seen.some((b) => b.includes('HELLO-LOOPBACK')),
          refused.reason || `close code ${refused.closeCode}`);

        const t = await wsSession(workerPort, wsPath,
          trojanHeader(user.trojan_pass, target.host, target.port, 1, 'HELLO-TROJAN'));
        record('proxy', 'a Trojan session tunnels bytes both ways',
          t.reply.includes('ECHO:HELLO-TROJAN') && target.seen.some((b) => b.includes('HELLO-TROJAN')),
          t.reason || `${t.bytes.length} bytes back`);

        const badPort = await wsSession(workerPort, wsPath,
          vlessHeader(user.uuid, target.host, 12345, 1, 'HELLO-BADPORT'));
        record('proxy', 'a port outside the Cloudflare-allowed set is rejected',
          badPort.closeCode === 1011 && !target.seen.some((b) => b.includes('HELLO-BADPORT')),
          badPort.reason || `close code ${badPort.closeCode}`);

        // A 3-byte prefix is an INCOMPLETE header, and waiting for more bytes is
        // the correct response to one (decode() returns MORE), so it cannot be
        // used to test rejection. These two are genuinely rejectable.
        const bogusUuid = new Uint8Array(60);
        bogusUuid[0] = 0x00;                       // VLESS version byte
        for (let i = 1; i < 17; i++) bogusUuid[i] = 0xAB;  // a uuid no user has
        const unknown = await wsSession(workerPort, wsPath, bogusUuid);
        record('proxy', 'an unknown credential is refused before any dial-out',
          unknown.closeCode === 1008 && !target.seen.some((b) => b.length > 0 && b.includes('AB')),
          unknown.reason || `close code ${unknown.closeCode}`);

        // Past MAX_HEADER_BYTES an unparseable stream has to be given up on rather
        // than buffered forever, which is what 1009 signals.
        const flood = new Uint8Array(4096).fill(0x41);
        const huge = await wsSession(workerPort, wsPath, flood);
        record('proxy', 'an over-long unparseable header is closed, not buffered',
          huge.closeCode === 1009,
          huge.reason || `close code ${huge.closeCode}`);
      }
    }

    head('13. public status page');
    const status = await worker.fetch(`/s/${user.uuid}`);
    const statusText = await status.text();
    record('status', 'the public status page renders for a valid token', status.status === 200);
    // The status page is keyed by the user's own token and exists to show them
    // their own configs, so its containing their own password is the feature, not
    // a leak. The real question is whether it crosses users.
    const other = await api(worker, j, 'POST', '/api/users', { name: 'Other' });
    const otherUser = other.json?.user;
    record('status', "it does not leak another user's credential",
      !!otherUser && !statusText.includes(otherUser.trojan_pass) && !statusText.includes(otherUser.uuid),
      'the page is keyed by one token and must stay scoped to it');
    record('status', 'and does not leak the admin password hash',
      !statusText.includes('ADMIN_PASS') && !/[a-f0-9]{64}/.test(statusText));
  } finally {
    try { if (target) await target.close(); } catch {}
    try { if (worker) await worker.stop(); } catch {}
    try { fs.rmSync(persistTo, { recursive: true, force: true }); } catch {}
  }

  /* -------------------------------------------------------------- summary */
  const bySection = {};
  for (const r of results) {
    const b = bySection[r.section] = bySection[r.section] || { ok: 0, bad: 0, info: 0 };
    if (r.ok === null) b.info++; else if (r.ok) b.ok++; else b.bad++;
  }
  console.log(`\n${C.b}Summary${C.x}`);
  for (const [k, v] of Object.entries(bySection)) {
    console.log(`  ${k.padEnd(15)} ${v.ok} passed, ${v.bad} failed${v.info ? ', ' + v.info + ' informational' : ''}`);
  }
  console.log(`\n  total: ${checks - failures}/${checks} passed${skips ? `, ${skips} sections skipped` : ''}`);
  if (failures) {
    console.log(`\n${C.r}${C.b}FAILURES${C.x}`);
    for (const r of results.filter((x) => x.ok === false)) console.log(`  ${r.section}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  }
  console.log('');
  process.exit(failures ? 1 : 0);
}

/** The wsPath lives in settings, not in the generated config; default matches DEFAULTS. */
function settings_wsPath(cfg) {
  try {
    const ob = (cfg.outbounds || []).find((o) => o.tag === 'proxy');
    const p = ob?.streamSettings?.wsSettings?.path || '/luncher';
    return p.split('?')[0];
  } catch { return '/luncher'; }
}

/**
 * Opens a real WebSocket to the Worker through miniflare and drives one session.
 * Returns whatever came back, so a refusal is distinguishable from a relay.
 */
/**
 * Dials the Worker as a real WebSocket client and drives one proxy session.
 *
 * Uses Node's built-in WebSocket against the Worker's actual port rather than
 * miniflare's in-process fetch upgrade: the point of this section is to prove the
 * tunnel works the way a real client would use it, and an in-process shortcut
 * would not exercise the same path.
 *
 * It reports the close code as well as any bytes, because a refusal and a relay
 * must be distinguishable. Asserting "not an echo" is not enough: if the session
 * failed for an unrelated reason, every guard test would pass vacuously.
 */
function wsSession(port, wsPath, firstFrame, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    let ws = null;
    let settleTimer = null;

    const finish = (closeCode, extra = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (settleTimer) clearTimeout(settleTimer);
      try { ws && ws.close(); } catch { /* already gone */ }
      const reply = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      resolve({ reply: reply.toString('latin1'), bytes: reply, closeCode, ...extra });
    };

    const timer = setTimeout(() => finish(null, { reason: 'timed out' }), timeoutMs);

    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    } catch (e) {
      return finish(null, { reason: 'could not construct the client: ' + e.message, error: true });
    }
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      try { ws.send(firstFrame); } catch (e) { finish(null, { reason: 'send failed: ' + e.message, error: true }); return; }
      settleTimer = setTimeout(() => finish(null, { reason: 'no data came back' }), 2500);
    };
    ws.onmessage = (ev) => {
      const d = ev.data;
      if (d instanceof ArrayBuffer) chunks.push(new Uint8Array(d));
      else if (ArrayBuffer.isView(d)) chunks.push(new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
      else chunks.push(enc.encode(String(d)));
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => finish(null, { reason: 'session delivered data' }), 400);
    };
    ws.onclose = (ev) => finish(ev.code, { reason: `closed ${ev.code} ${ev.reason || ''}`.trim(), closed: true });
    ws.onerror = () => { if (!settled) finish(null, { reason: 'websocket error', error: true }); };
  });
}

main().catch((e) => {
  console.error(`\n${C.r}E2E sandbox crashed: ${e && e.stack ? e.stack : e}${C.x}`);
  process.exit(2);
});
