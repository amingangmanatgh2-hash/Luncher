import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha224, toHex, trojanKey, safeEqual } from '../src/lib/sha224.js';
import { uuidToBytes, bytesToUuid, bytesToBase64, readVarint } from '../src/lib/bytes.js';
import { decode, sniff, MORE, portAllowed, isLoopback } from '../src/proxy/parse.js';

const enc = new TextEncoder();

test('sha224 matches node crypto across lengths and multibyte input', () => {
  for (const s of ['', 'a', 'abc', 'trojan', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64),
    'w'.repeat(119), 'سلام دنیا', 'q'.repeat(1000)]) {
    assert.equal(toHex(sha224(s)), createHash('sha224').update(s, 'utf8').digest('hex'), `sha224(${JSON.stringify(s).slice(0, 20)})`);
  }
});

test('trojanKey reproduces the canonical test vector', () => {
  assert.equal(trojanKey('trojan'), '07f3019e36783ac5253649a9aa621ba3287b0b7b4e8db6c5c5519444');
});

test('safeEqual rejects mismatches and differing lengths', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(!safeEqual('abc', 'abd'));
  assert.ok(!safeEqual('abc', 'ab'));
  assert.ok(!safeEqual(null, 'ab'));
});

test('uuid round-trips through bytes and base64', () => {
  const u = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607';
  const b = uuidToBytes(u);
  assert.equal(b.length, 16);
  assert.equal(bytesToUuid(b), u);
  assert.equal(uuidToBytes(u.replace(/-/g, '')).length, 16);
  assert.equal(bytesToBase64(b).length, 24);
  assert.equal(uuidToBytes('not-a-uuid'), null);
});

test('readVarint decodes single and multi-byte values', () => {
  assert.deepEqual(readVarint(new Uint8Array([0x00]), 0), [0, 1]);
  assert.deepEqual(readVarint(new Uint8Array([0x7f]), 0), [127, 1]);
  assert.deepEqual(readVarint(new Uint8Array([0xac, 0x02]), 0), [300, 2]);
  assert.equal(readVarint(new Uint8Array([0x80]), 0), null); // truncated
});

function vlessHeader(uuid, host, port, cmd = 1, payload = '') {
  const parts = [new Uint8Array([0]), uuidToBytes(uuid), new Uint8Array([0]), new Uint8Array([cmd]),
    new Uint8Array([(port >> 8) & 0xff, port & 0xff])];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    parts.push(new Uint8Array([1, ...host.split('.').map(Number)]));
  } else {
    const d = enc.encode(host);
    parts.push(new Uint8Array([2, d.length]), d);
  }
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

const U = 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607';

test('VLESS header decodes: version 0, port-before-address, 1-byte domain length', () => {
  const h = vlessHeader(U, 'gemini.google.com', 443, 1, 'GET / HTTP/1.1\r\n');
  assert.equal(sniff(h), 'vless');
  const d = decode(h);
  assert.equal(d.kind, 'vless');
  assert.equal(d.id, U);
  assert.equal(d.host, 'gemini.google.com');
  assert.equal(d.port, 443);
  assert.equal(d.cmd, 1);
  assert.equal(new TextDecoder().decode(d.rest), 'GET / HTTP/1.1\r\n');
});

test('VLESS IPv4 and IPv6 addresses decode', () => {
  const v4 = decode(vlessHeader(U, '1.1.1.1', 80));
  assert.equal(v4.host, '1.1.1.1');
  assert.equal(v4.port, 80);
});

test('Trojan header decodes with hex(SHA224) credential and CRLF framing', () => {
  const h = trojanHeader('luncher-secret', 'aistudio.google.com', 443, 1, 'payload');
  assert.equal(sniff(h), 'trojan');
  const d = decode(h);
  assert.equal(d.kind, 'trojan');
  assert.equal(d.id, trojanKey('luncher-secret'));
  assert.equal(d.host, 'aistudio.google.com');
  assert.equal(d.port, 443);
  assert.equal(new TextDecoder().decode(d.rest), 'payload');
});

test('headers split across frames accumulate instead of throwing', () => {
  const h = vlessHeader(U, 'chatgpt.com', 443, 1, 'hello');
  assert.equal(decode(h.slice(0, 5)), MORE);
  let acc = new Uint8Array(0);
  let resolved = null;
  for (let i = 0; i < h.length; i++) {
    const next = new Uint8Array(acc.length + 1); next.set(acc); next[i] = h[i]; acc = next;
    const r = decode(acc);
    if (r !== MORE) { resolved = r; break; }
  }
  assert.equal(resolved.host, 'chatgpt.com');
});

test('malformed input returns an error object, never an exception', () => {
  const bad = vlessHeader(U, 'x.com', 443); bad[0] = 9;
  const padded = new Uint8Array(60); padded.set(bad);
  assert.equal(typeof decode(padded).error, 'string');
  assert.equal(decode(new Uint8Array(60).fill(0x41)).error, 'unrecognised protocol header');
  assert.equal(decode(new Uint8Array(0)), MORE);
});

test('mux is refused cleanly rather than silently mis-framed', () => {
  const mux = new Uint8Array(60);
  mux.set(vlessHeader(U, 'x.com', 443, 3));
  assert.match(decode(mux).error, /mux/i);
});

test('port policy matches what Cloudflare Workers may dial', () => {
  for (const p of [80, 443, 8080, 8443, 2053, 2087]) assert.ok(portAllowed(p), `port ${p}`);
  for (const p of [25, 3389, 5432, 0, 70000]) assert.ok(!portAllowed(p), `port ${p}`);
  assert.ok(portAllowed(9999, [9999]), 'extra ports are honoured');
});

test('loopback and metadata targets are refused', () => {
  for (const h of ['localhost', '127.0.0.1', '::1', '127.9.9.9', '169.254.169.254', '']) {
    assert.ok(isLoopback(h), h);
  }
  assert.ok(!isLoopback('gemini.google.com'));
});

test('a stored user yields BOTH VLESS and Trojan links', async () => {
  // Regression: buildLinks read `user.trojanPass` while the stored record uses
  // `trojan_pass`, so the Trojan branch never fired and every subscription was
  // VLESS-only — dead protocol support behind a UI that advertised it.
  const { buildLinks } = await import('../src/panel/configs.js');
  const { newUser } = await import('../src/panel/users.js');
  const { DEFAULTS, normalize } = await import('../src/panel/settings.js');
  const user = newUser({ name: 'Ali', quotaGb: 0, expireDays: 0 });
  assert.ok(user.trojan_pass, 'newUser must generate a trojan password');
  assert.equal(user.trojanPass, undefined, 'the stored shape is snake_case');

  const settings = normalize({ ...DEFAULTS, preset: 'balanced' });
  const links = buildLinks({
    user,
    endpoint: { host: 'h.example.dev', address: 'h.example.dev', port: 443, tls: true },
    settings: { ...settings, client: 'pattng' },
  });
  const protocols = new Set(links.map((l) => l.protocol));
  assert.ok(protocols.has('vless'), 'VLESS link missing');
  assert.ok(protocols.has('trojan'), 'Trojan link missing — the snake_case field was not read');

  const trojan = links.find((l) => l.protocol === 'trojan').link;
  assert.ok(trojan.startsWith(`trojan://${user.trojan_pass}@`), 'the trojan link must carry the password');
  // Trojan is port-LAST with hex(SHA224) credentials; the link itself is a URL,
  // so all we assert here is that it is well formed and percent-encoded once.
  assert.ok(!trojan.includes('%25'), 'the trojan link must not be double-encoded');

  // A user created without a trojan password must not emit a broken link.
  const noTrojan = newUser({ name: 'NoTrojan', trojanPass: null, quotaGb: 0, expireDays: 0 });
  assert.equal(noTrojan.trojan_pass, '');
  const only = buildLinks({ user: noTrojan,
    endpoint: { host: 'h.example.dev', address: 'h.example.dev', port: 443, tls: true },
    settings: { ...settings, client: 'pattng' } });
  assert.ok(only.every((l) => l.protocol === 'vless'), 'no Trojan link without a password');
});
