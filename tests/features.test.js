/**
 * Regression tests for the three server-side features: automatic client
 * detection, net-melli mode, and the satellite preset.
 *
 * These are pure-function tests. The precedence rules that combine a User-Agent
 * with an explicit ?client= and the configured defaults live in the subscription
 * handler, which needs a store; those are covered end to end by `npm run test:e2e`
 * against the real workerd runtime instead of being faked here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectClient, CLIENT_UA_SIGNATURES, FRAGMENT_PRESETS, IRAN_DNS_SERVERS } from '../src/panel/presets.js';
import { DEFAULTS, normalize } from '../src/panel/settings.js';
import { buildXrayJson } from '../src/panel/configs.js';

const USER = { uuid: '0ee8c199-8f53-41b8-9f2e-000000000001', trojan_pass: 'secret' };
const EP = { host: 'luncher.example.workers.dev', address: '188.114.97.6', port: 443, tls: true };
const json = (settings) => buildXrayJson({ user: USER, endpoint: EP, settings: normalize(settings) });
const proxyOutbound = (cfg) => cfg.outbounds.find((o) => o.tag === 'proxy');

/* ------------------------------------------------- client auto-detection */

test('detectClient maps each supported app to its own dialect', () => {
  const cases = [
    ['PattNG/2.3.10-P59 (Android 13)', 'pattng'],
    ['v2rayNG/1.8.9', 'v2rayng'],
    ['HiddifyNext/2.5.0', 'hiddify'],
    ['Streisand/1.6.43', 'streisand'],
    ['NekoBox/1.2.9', 'v2rayng'],
    ['nekoray/3.8', 'v2rayng'],
  ];
  for (const [ua, want] of cases) {
    assert.equal(detectClient(ua).key, want, `UA ${ua} should map to ${want}`);
  }
});

test('detectClient tests PattNG before v2rayNG, because PattNG forks it', () => {
  // This is the case that matters most. PattNG's User-Agent can legitimately
  // contain "v2rayNG", and getting the order wrong hands a PattNG user the
  // v2rayNG dialect, which silently drops fm and cs.
  assert.equal(detectClient('PattNG v2rayNG/2.3.10-P59').key, 'pattng');
  const order = CLIENT_UA_SIGNATURES.map((s) => s.key);
  assert.ok(order.indexOf('pattng') < order.indexOf('v2rayng'),
    'pattng must be tested before v2rayng');
});

test('detectClient returns null for unknown agents rather than guessing', () => {
  // A wrong guess that serves one dialect is worse than no guess that serves all
  // of them, so anything unrecognised must fall through to the configured set.
  for (const ua of ['curl/8.5.0', 'Mozilla/5.0 (X11; Linux x86_64)', 'ClashForAndroid/2.5', 'sing-box/1.8', '', null, undefined]) {
    assert.equal(detectClient(ua), null, `UA ${JSON.stringify(ua)} should not be guessed at`);
  }
});

test('detectClient is case-insensitive and never throws on odd input', () => {
  assert.equal(detectClient('PATTNG/1.0').key, 'pattng');
  // Non-string input must be handled, not thrown on: a header value is not
  // guaranteed to be a string at every call site, and a throw here would surface
  // as a 500 on a subscription fetch.
  assert.equal(detectClient(12345), null);
  assert.equal(detectClient({}), null);
  // An array is coerced by String(), so one holding a matching token does match.
  // That is lenient rather than wrong — header values are strings in practice —
  // but asserting null here would have been asserting a behaviour the code does
  // not have.
  assert.equal(detectClient(['v2rayNG']).key, 'v2rayng');
});

test('autoDetectClient can be switched off and defaults to on', () => {
  assert.equal(DEFAULTS.autoDetectClient, true);
  assert.equal(normalize({}).autoDetectClient, true);
  assert.equal(normalize({ autoDetectClient: false }).autoDetectClient, false);
  // Only a literal false disables it; junk must not silently turn the feature off.
  assert.equal(normalize({ autoDetectClient: 'no' }).autoDetectClient, true);
});

/* -------------------------------------------------------- net melli mode */

test('net-melli mode puts a domestic resolver first for .ir names', () => {
  const first = json({ ...DEFAULTS, netMelli: true }).dns.servers[0];
  assert.equal(first.address, DEFAULTS.netMelliDns);
  assert.ok(first.domains.includes('geosite:ir'));
  assert.ok(first.domains.some((d) => d.includes('.ir')), 'must cover bare .ir domains');
  assert.deepEqual(first.expectIPs, ['geoip:ir']);
});

test('net-melli mode leaves the DNS untouched when disabled', () => {
  const first = json(DEFAULTS).dns.servers[0];
  assert.notEqual(first.address, DEFAULTS.netMelliDns,
    'domestic resolver must not appear unless the mode is on');
});

test('an unreachable domestic resolver degrades instead of failing .ir', () => {
  // skipFallback: true would make .ir resolution fail outright when the domestic
  // resolver is down, which is worse than resolving it abroad.
  const first = json({ ...DEFAULTS, netMelli: true }).dns.servers[0];
  assert.equal(first.skipFallback, false);
});

test('domestic traffic routes direct whether or not net-melli mode is on', () => {
  for (const netMelli of [true, false]) {
    const rules = json({ ...DEFAULTS, netMelli }).routing.rules;
    const direct = rules.find((r) => r.outboundTag === 'direct' && Array.isArray(r.domain));
    assert.ok(direct, `netMelli=${netMelli}: a direct rule must exist`);
    assert.ok(direct.domain.includes('geosite:ir'));
    assert.ok(direct.ip.includes('geoip:ir'));
    // It must come before the catch-all, or the tunnel would claim domestic traffic.
    const idx = rules.indexOf(direct);
    const catchAll = rules.findIndex((r) => r.network === 'tcp,udp');
    assert.ok(idx < catchAll, 'direct rule must precede the catch-all');
  }
});

test('netMelliDns is validated rather than emitted verbatim', () => {
  // An unvalidated string here lands inside a config a client will load.
  for (const bad of ['javascript:alert(1)', '"><script>', '', null, 123, 'https://']) {
    assert.equal(normalize({ ...DEFAULTS, netMelliDns: bad }).netMelliDns, DEFAULTS.netMelliDns,
      `${JSON.stringify(bad)} must fall back to the default`);
  }
  assert.equal(normalize({ netMelliDns: 'https://dns.example.ir/dns-query' }).netMelliDns,
    'https://dns.example.ir/dns-query', 'a valid DoH URL must be accepted');
  assert.equal(normalize({ netMelliDns: '217.219.121.121' }).netMelliDns,
    '217.219.121.121', 'a bare resolver IP must be accepted');
});

test('netMelli is coerced to a boolean', () => {
  assert.equal(normalize({ netMelli: 'yes' }).netMelli, false);
  assert.equal(normalize({ netMelli: true }).netMelli, true);
});

/* ------------------------------------------------------ satellite preset */

test('the satellite preset deliberately emits no fragmentation', () => {
  const p = FRAGMENT_PRESETS.satellite;
  assert.ok(p, 'satellite preset must exist');
  assert.equal(p.legacy, null);
  assert.equal(p.mask, null);
  const cfg = json({ ...DEFAULTS, preset: 'satellite' });
  assert.ok(!('finalmask' in proxyOutbound(cfg).streamSettings),
    'satellite must not attach finalmask');
  assert.ok(!cfg.outbounds.some((o) => o.tag === 'fragment'),
    'satellite must not chain a fragment outbound');
});

test('the satellite preset shortens the TCP keepalive for a jittery link', () => {
  const sat = proxyOutbound(json({ ...DEFAULTS, preset: 'satellite' })).streamSettings.sockopt;
  const bal = proxyOutbound(json({ ...DEFAULTS, preset: 'balanced' })).streamSettings.sockopt;
  assert.ok(sat.tcpKeepAliveIdle < bal.tcpKeepAliveIdle,
    'satellite keepalive must be shorter than the default');
  assert.equal(sat.tcpNoDelay, true);
});

test('presets without sockopt keep the long-standing default', () => {
  // Guards the `p.sockopt ||` fallback: adding per-preset tuning must not change
  // the socket behaviour of the nine presets that do not ask for it.
  for (const name of Object.keys(FRAGMENT_PRESETS)) {
    if (FRAGMENT_PRESETS[name].sockopt) continue;
    const s = proxyOutbound(json({ ...DEFAULTS, preset: name })).streamSettings.sockopt;
    assert.equal(s.tcpKeepAliveIdle, 100, `${name} should keep the default keepalive`);
  }
});

test('satellite is offered alongside the Iranian ISP presets, not instead of them', () => {
  assert.ok(Object.keys(FRAGMENT_PRESETS).length >= 10);
  for (const k of ['balanced', 'mci', 'irancell', 'rightel', 'tci', 'satellite']) {
    assert.ok(FRAGMENT_PRESETS[k], `${k} must exist`);
    assert.ok(FRAGMENT_PRESETS[k].labelFa, `${k} needs a Persian label`);
  }
});

test('IRAN_DNS_SERVERS is non-empty and every entry is a plausible resolver', () => {
  assert.ok(IRAN_DNS_SERVERS.length > 0);
  for (const s of IRAN_DNS_SERVERS) {
    assert.match(s, /^(https:\/\/|\d)/, `${s} does not look like a resolver`);
  }
});

/* ------------------------------------------- error status / custom domain */

test('a blocked destination port is a 400, not a 500', async () => {
  const { safe } = await import('../src/lib/errors.js');
  const blocked = () => { const e = new Error('port not allowed'); e.code = 'port-blocked'; throw e; };
  const res = await safe(blocked, {});
  // It used to return HTTP 500 while the rendered page displayed "400", which
  // points a monitoring system at a server bug that does not exist.
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.ok(body.includes('400'), 'the page must display the same code it returned');
  assert.ok(!body.includes('[object Object]'));
});

test('an unexpected error is still a 500 and never a 1101', async () => {
  const { safe } = await import('../src/lib/errors.js');
  const res = await safe(() => { throw new TypeError('boom'); }, {});
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.ok(!body.includes('1101'), 'a thrown exception must be rendered, not leaked as 1101');
});

test('the JSON error path reports the same status as the HTML path', async () => {
  const { safe } = await import('../src/lib/errors.js');
  const blocked = () => { const e = new Error('x'); e.code = 'port-blocked'; throw e; };
  const res = await safe(blocked, { wantsJson: true });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'port-blocked');
});

test('customHost is declared, so it survives normalize instead of passing through unvalidated', () => {
  assert.equal(DEFAULTS.customHost, '', 'it must have a declared default');
  assert.equal(normalize({}).customHost, '');
});

test('customHost accepts a bare hostname and strips a scheme', () => {
  assert.equal(normalize({ customHost: 'proxy.example.com' }).customHost, 'proxy.example.com');
  assert.equal(normalize({ customHost: 'https://proxy.example.com' }).customHost, 'proxy.example.com');
  assert.equal(normalize({ customHost: '  proxy.example.com/ ' }).customHost, 'proxy.example.com');
  assert.equal(normalize({ customHost: 'sub.domain.co.uk:8443' }).customHost, 'sub.domain.co.uk:8443');
});

test('customHost rejects values that would corrupt a share link', () => {
  // endpointsFor() puts this string into both host= and the address, so a stray
  // "/", "@" or space produces links that look plausible and fail everywhere.
  for (const bad of ['bad host!.com', 'a/b', 'x@y.com', 'a b.com', 'https://', null, 123, {}]) {
    assert.equal(normalize({ customHost: bad }).customHost, '',
      `${JSON.stringify(bad)} must be rejected`);
  }
});
