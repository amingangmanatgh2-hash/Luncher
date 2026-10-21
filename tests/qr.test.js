import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeQr, qrToSvg } from '../src/lib/qr.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/qr-ref.json', import.meta.url), 'utf8'));

function unpack(b64, size) {
  const bin = Buffer.from(b64, 'base64');
  const rowBytes = Math.ceil(size / 8);
  const rows = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      const byte = bin[r * rowBytes + Math.floor(c / 8)];
      row.push((byte >> (7 - (c % 8))) & 1);
    }
    rows.push(row);
  }
  return rows;
}

test('QR encoder matches the reference implementation for all 8 masks', () => {
  let checked = 0;
  for (const c of fixture.cases) {
    const q = encodeQr(c.text, { ec: c.ec, mask: c.mask });
    assert.ok(q, `encodeQr returned null for ${JSON.stringify(c.text).slice(0, 40)} ${c.ec}/${c.mask}`);
    assert.equal(q.version, c.version, `version mismatch (mask ${c.mask})`);
    assert.equal(q.size, c.size, `size mismatch (mask ${c.mask})`);
    assert.deepEqual(q.modules, unpack(c.modules, c.size), `module mismatch for mask ${c.mask}`);
    checked++;
  }
  assert.equal(checked, fixture.cases.length);
});

test('QR version selection picks the smallest version that fits', () => {
  assert.equal(encodeQr('HI', { ec: 'L', mask: 0 }).version, 1);
  assert.equal(encodeQr('x'.repeat(20), { ec: 'L', mask: 0 }).version, 2);
  // 400 bytes need 4*8+16 = 3216 bits = 402 codewords; version 13-L carries 4*107 = 428.
  assert.equal(encodeQr('x'.repeat(400), { ec: 'L', mask: 0 }).version, 13);
  // ...but the same data at EC H needs far more redundancy.
  assert.ok(encodeQr('x'.repeat(400), { ec: 'H', mask: 0 }).version > 13);
});

test('QR higher error correction yields a larger version for the same data', () => {
  const text = 'https://luncher.example.workers.dev/sub/abcdef0123456789';
  const l = encodeQr(text, { ec: 'L', mask: 0 }).version;
  const h = encodeQr(text, { ec: 'H', mask: 0 }).version;
  assert.ok(h > l, `expected H (${h}) > L (${l})`);
});

test('QR renders valid, self-contained SVG with no external references', () => {
  const svg = qrToSvg('https://luncher.example.workers.dev/sub/deadbeef');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(svg.includes('</svg>'));
  assert.ok(!/href=|url\(|https?:\/\/(?!www\.w3\.org)/.test(svg), 'SVG must not reference external resources');
  assert.ok(svg.length < 40000, 'SVG should stay small');
});

test('QR handles multi-byte UTF-8 (Persian) input', () => {
  const q = encodeQr('سلام دنیا — Luncher ۱۲۳', { ec: 'M', mask: 0 });
  assert.ok(q && q.size > 0);
});

test('QR encodes a real PattNG share link at every error-correction level', async () => {
  // Regression for the /api/qr capacity cap, which used to be a hardcoded 900
  // and therefore rejected EVERY PattNG share link: the `cs` (13 cipher suites)
  // and `fm` (finalMask JSON) parameters alone push a link past 900 characters.
  // The QR button failed for precisely the client this panel supports first.
  const { buildLinks } = await import('../src/panel/configs.js');
  const { DEFAULTS, normalize } = await import('../src/panel/settings.js');
  const settings = normalize({ ...DEFAULTS, preset: 'irancell', fingerprint: 'unsafe', cipherSuites: 'standard' });
  const user = { uuid: 'fa907ea1-3236-4a0b-b2da-2f4b18c68af0', name: 'Ali', trojan_pass: 'V5k9rnGCEviJW63S' };
  const built = buildLinks({
    user,
    endpoint: { host: 'luncher.example.workers.dev', address: '188.114.97.6', port: 443, label: 'CF', tls: true },
    settings: { ...settings, client: 'pattng' },
  });
  assert.ok(Array.isArray(built) && built.length > 0, 'buildLinks returns a list of link objects');
  const link = built[0].link;
  assert.equal(typeof link, 'string', 'each entry carries the share link string');
  assert.ok(link.includes('fm=') && link.includes('cs=') && link.includes('fp=unsafe'),
    'the fixture must be a genuine PattNG link with finalMask and cipherSuites');
  assert.ok(link.length > 900, `a PattNG link should exceed the old 900 cap, this one is ${link.length}`);

  // Measured ceilings: v21 at L, v25 at M. Both are scannable; M is the default.
  for (const [ec, minVersion] of [['L', 15], ['M', 20]]) {
    const r = encodeQr(link, { ec });
    assert.ok(r, `the link must encode at EC ${ec}`);
    assert.ok(r.version >= minVersion, `EC ${ec} gave version ${r.version}, expected >= ${minVersion}`);
    assert.equal(r.size, r.version * 4 + 17, 'module grid must match the version');
    assert.ok(qrToSvg(link, { ec }).startsWith('<svg'), 'SVG must render');
  }
});

test('QR capacity matches the published byte-mode ceilings', () => {
  // These are the numbers /api/qr's 2953-byte limit is derived from. If the
  // encoder ever regresses, the API would advertise a limit it cannot meet.
  const ceilings = { L: 2953, M: 2331, Q: 1663, H: 1273 };
  for (const [ec, max] of Object.entries(ceilings)) {
    assert.ok(encodeQr('x'.repeat(max), { ec }), `EC ${ec} should hold ${max} bytes`);
    assert.equal(encodeQr('x'.repeat(max + 1), { ec }), null, `EC ${ec} must reject ${max + 1} bytes`);
  }
});

test('the API capacity limit matches what the encoder can really hold', () => {
  // The encoder happily encodes an empty string (version 1, no payload), so the
  // guard against empty input belongs in the route, not in the encoder. What
  // must stay tied together is the advertised ceiling and the real one: if the
  // encoder ever regressed, /api/qr would promise a size it cannot produce.
  const api = readFileSync(new URL('../src/panel/api.js', import.meta.url), 'utf8');
  const m = api.match(/const QR_MAX_BYTES = (\d+);/);
  assert.ok(m, 'QR_MAX_BYTES was not found in the API');
  const limit = Number(m[1]);
  assert.ok(encodeQr('x'.repeat(limit), { ec: 'L' }),
    `the encoder must hold the ${limit}-byte limit the API advertises`);
  assert.equal(encodeQr('x'.repeat(limit + 1), { ec: 'L' }), null,
    'the limit must be the true ceiling, not a conservative guess');
  assert.ok(/if \(!text\) return json\(400/.test(api), 'the route should reject empty input');
});
