/**
 * Luncher DPI sandbox — simulation primitives.
 *
 * WHAT THIS IS
 *   A local, offline model of SNI-based censorship plus a byte-level model of
 *   the fragmentation our presets emit. Everything runs over 127.0.0.1 sockets;
 *   no internet access is required or used, and no test depends on DNS.
 *
 * WHAT THIS IS NOT
 *   Not a packet-level reproduction of Iran's filtering infrastructure, and
 *   nothing here can prove that a given preset works on a given ISP on a given
 *   day. Real DPI varies by operator, city and hour. The only authoritative
 *   test is the user's own connection. Read this file before quoting a number
 *   from the report.
 *
 * THE MODELLING CHOICE THAT MATTERS
 *   A censorship box has a finite inspection budget: it examines the start of a
 *   flow for a bounded number of bytes and a bounded time, and if it cannot
 *   reconstruct the SNI it must either fail open (let the flow through) or fail
 *   closed (block everything, breaking the internet for its own users). Real
 *   deployments fail open. We model both inspector shapes:
 *
 *     first-packet  inspect only the first segment. The common case, and the
 *                   reason splitting the ClientHello helps at all: the SNI field
 *                   is simply not present in that segment.
 *
 *     streaming     accumulate across segments, but give up after `windowMs` or
 *                   `windowBytes`. Splitting alone does NOT beat this one — the
 *                   pieces still arrive and still contain the SNI. Beating it
 *                   needs *delay*, so the SNI lands after the budget expires.
 *
 *   That distinction is the honest core of the suite: it reports which presets
 *   defeat which inspector, including the ones that do not.
 */

import net from 'node:net';
import { FRAGMENT_PRESETS } from '../../src/panel/presets.js';

/* ------------------------------------------------------------- byte utils */

export function u8(n) { return new Uint8Array([n & 0xff]); }
export function u16(n) { return new Uint8Array([(n >> 8) & 0xff, n & 0xff]); }
export function u24(n) { return new Uint8Array([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]); }
export function buf(x) { return x instanceof Uint8Array ? x : new Uint8Array(x); }
export function concat(...parts) {
  const all = parts.map(buf);
  const total = all.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of all) { out.set(p, off); off += p.length; }
  return out;
}
const bytesOf = (list) => new Uint8Array(list.flatMap((v) => [(v >> 8) & 0xff, v & 0xff]));

/**
 * One TLS extension: 2-byte type, 2-byte length, body.
 *
 * NOTE: build these with concat(), never with `+`. `+` on two Uint8Arrays
 * stringifies both operands ("0,22" + "1,4"), producing a short, unparseable
 * record that makes every downstream SNI assertion fail in a confusing way.
 */
const ext = (type, body) => concat(u16(type), u16(body.length), body);

/* ------------------------------------------------------------------ TLS */

/**
 * Build a well-formed, realistically sized TLS ClientHello carrying `sni`.
 *
 * It never completes a handshake — the inspector and our parser only care about
 * the bytes on the wire — but it must be well formed, because an inspector that
 * cannot parse the record at all is not a useful model.
 *
 * Size matters for the fragmentation tests. A real Chrome ClientHello is ~517
 * bytes, which is what makes `lengths: "100-200"` produce several fragments. A
 * minimal hello would fit in one fragment and every preset would look equally
 * effective, which is exactly the false positive this suite exists to avoid.
 */
export function clientHello(sni, opts = {}) {
  const name = new TextEncoder().encode(sni);
  const suites = opts.suites || [
    0x1a1a, 0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030,
    0xcca9, 0xcca8, 0xc013, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035,
  ];

  const extensions = concat(
    ext(0x0a0a, new Uint8Array(0)),                                   // GREASE (Chrome sends one first)
    ext(0x0000, concat(                                               // server_name
      u16(3 + name.length), u8(0x00), u16(name.length), name)),
    ext(0x0017, new Uint8Array(0)),                                   // extended_master_secret
    ext(0xff01, u8(0x00)),                                            // renegotiation_info
    ext(0x000a, concat(                                               // supported_groups
      u16(8), bytesOf([0x001d, 0x0017, 0x0018, 0x0100]).subarray(0, 8))),
    ext(0x000b, concat(u8(0x02), u8(0x01), u8(0x00))),                 // ec_point_formats
    ext(0x0023, new Uint8Array(0)),                                   // session_ticket
    ext(0x0010, concat(                                               // alpn
      u16(14), u8(0x02), new TextEncoder().encode('h2'),
      u8(0x08), new TextEncoder().encode('http/1.1'))),
    ext(0x0005, u8(0x01)),                                            // status_request
    ext(0x000d, concat(                                               // signature_algorithms
      u16(2 * 10),
      bytesOf([0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601, 0x0603, 0x0201]))),
    ext(0x0012, new Uint8Array(0)),                                   // signed_certificate_timestamp
    ext(0x0033, concat(                                               // key_share (x25519, 32 bytes)
      u16(36), u16(0x001d), u16(0x0020), new Uint8Array(32).fill(0x42))),
    ext(0x002d, concat(u8(0x01), u8(0x01))),                           // psk_key_exchange_modes
    ext(0x002b, concat(u8(0x03), bytesOf([0x0304]).subarray(0, 2), u8(0x03))), // supported_versions
  );

  const random = new Uint8Array(32);
  for (let i = 0; i < 32; i++) random[i] = (i * 7 + 13) & 0xff;   // deterministic: no flaky tests

  const core = concat(
    u8(0x03), u8(0x03),                                    // legacy client_version
    random,
    u8(0x00),                                              // session_id length
    u16(suites.length * 2), bytesOf(suites),
    u8(0x01), u8(0x00),                                    // compression: null
  );

  // Chrome pads the ClientHello to a 512-byte boundary so that the record does
  // not straddle a TCP segment. We reproduce the effect (not the exact rule) to
  // land at a realistic size, which is what the fragment counts depend on.
  let body = concat(core, u16(extensions.length), extensions);
  const target = 512 - 4;                                  // minus the handshake header
  if (body.length < target) {
    const padLen = target - body.length - 4;
    if (padLen > 0) body = concat(body, ext(0x0015, new Uint8Array(padLen)));
  }

  const handshake = concat(u8(0x01), u24(body.length), body);
  return concat(u8(0x16), u8(0x03), u8(0x01), u16(handshake.length), handshake);
}

/** Extract the SNI from a ClientHello, or null if it cannot be reconstructed. */
export function parseSni(bytes) {
  try {
    if (bytes.length < 5 || bytes[0] !== 0x16) return null;
    const recordLen = (bytes[3] << 8) | bytes[4];
    if (bytes.length < 5 + recordLen) return null;      // incomplete record -> no SNI
    let p = 5;
    if (bytes[p] !== 0x01) return null;                 // not a ClientHello
    const hsLen = (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    if (bytes.length < p + 4 + hsLen) return null;
    p += 4 + 2 + 32;                                    // hs header + version + random
    const sidLen = bytes[p]; p += 1 + sidLen;
    if (p + 2 > bytes.length) return null;
    const csLen = (bytes[p] << 8) | bytes[p + 1]; p += 2 + csLen;
    if (p + 1 > bytes.length) return null;
    const cmLen = bytes[p]; p += 1 + cmLen;
    if (p + 2 > bytes.length) return null;
    const extTotal = (bytes[p] << 8) | bytes[p + 1]; p += 2;
    const end = Math.min(p + extTotal, bytes.length);
    while (p + 4 <= end) {
      const type = (bytes[p] << 8) | bytes[p + 1];
      const len = (bytes[p + 2] << 8) | bytes[p + 3];
      p += 4;
      if (p + len > bytes.length) return null;          // truncated extension -> give up
      if (type === 0x0000) {
        if (len < 5) return null;
        const nameType = bytes[p + 2];
        const nameLen = (bytes[p + 3] << 8) | bytes[p + 4];
        if (nameType !== 0x00 || p + 5 + nameLen > bytes.length) return null;
        return new TextDecoder().decode(bytes.subarray(p + 5, p + 5 + nameLen));
      }
      p += len;
    }
    return null;
  } catch { return null; }
}

/* ---------------------------------------------------------- fragmentation */

function pickRange(spec) {
  const s = String(spec);
  const m = s.match(/^(\d+)-(\d+)$/);
  if (!m) return Math.max(0, parseInt(s, 10) || 0);
  const lo = Number(m[1]); const hi = Number(m[2]);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Split `bytes` the way an Xray fragment outbound would, driven by one of our
 * real preset masks. Returns [{ data, delayMs }] writes.
 *
 * `packets: "tlshello"` fragments the handshake record; a numeric spec such as
 * "1-3" picks a random piece count in that range. Both are byte-level
 * abstractions of what is really a per-segment decision — see the header note.
 */
export function fragment(bytes, presetId) {
  const preset = FRAGMENT_PRESETS[presetId];
  if (!preset || !preset.mask || !preset.mask.tcp) return [{ data: bytes, delayMs: 0 }];

  let out = [{ data: bytes, delayMs: 0 }];
  for (const stage of preset.mask.tcp) {
    if (stage.type !== 'fragment') continue;
    const st = stage.settings || {};
    const lengthSpecs = st.lengths || ['100-200'];
    const delaySpecs = st.delays || ['0'];
    const packets = String(st.packets || 'tlshello');   // selects packets; see note below
    const maxSplit = parseInt(st.maxSplit, 10) || 0;    // cap on fragment length
    const next = [];

    for (const piece of out) {
      if (piece.data.length === 0) { next.push(piece); continue; }

      // In Xray, `packets` selects WHICH packets of the flow get fragmented
      // ("tlshello" = the one carrying the TLS hello, "1-3" = the first one to
      // three); `lengths` decides how each selected packet is split. An earlier
      // version of this model misread `packets` as the piece COUNT, which made
      // `packets: "1-1"` emit a single unfragmented write and made the `gaming`
      // preset look as effective as `maxStealth`.
      //
      // This simulation only ever models one ClientHello, i.e. packet 1, which
      // every preset selects. So the split is always driven by `lengths`.
      let off = 0; let i = 0;
      while (off < piece.data.length) {
        let len = pickRange(lengthSpecs[i % lengthSpecs.length]);
        if (maxSplit > 0) len = Math.min(len, maxSplit);
        if (len <= 0) len = 1;                    // a zero-length write is a no-op on a socket
        next.push({ data: piece.data.subarray(off, off + len), delayMs: pickRange(delaySpecs[i % delaySpecs.length]) });
        off += len; i++;
      }
    }
    out = next;
  }
  return out;
}

/* ------------------------------------------------------------- inspector */

/**
 * A censorship middlebox.
 *
 *   mode 'first-packet'  decide from the first segment only.
 *   mode 'streaming'     accumulate up to windowBytes / windowMs, then decide.
 *
 * Either way it FAILS OPEN when the SNI cannot be reconstructed — the only
 * survivable behaviour for a national filter, and the entire basis on which
 * fragmentation works.
 *
 * Bytes consumed while inspecting are forwarded on allow. Dropping them would
 * model a filter that corrupts every connection it permits, and would make the
 * "the tunnel still works" assertions meaningless.
 */
export function startDpi({ target, blocklist, mode = 'first-packet', windowMs = 40, windowBytes = 4096 }) {
  const log = [];
  const sockets = new Set();
  const track = (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); return s; };
  const server = net.createServer((client) => {
    track(client);
    const started = Date.now();
    const upstream = track(net.connect(target.port, target.host));
    let decided = false;
    let acc = new Uint8Array(0);
    let spliced = false;

    const splice = () => {
      if (spliced) return;
      spliced = true;
      client.removeListener('data', inspect);
      // Forward everything the inspection consumed, then pipe both ways.
      if (acc.length) { try { upstream.write(acc); } catch { /* closed */ } }
      const teardown = () => {
        try { client.destroy(); } catch { /* noop */ }
        try { upstream.destroy(); } catch { /* noop */ }
      };
      client.on('data', (d) => { try { upstream.write(d); } catch { teardown(); } });
      upstream.on('data', (d) => { try { client.write(d); } catch { teardown(); } });
      for (const [s, ev] of [[client, upstream], [upstream, client]]) {
        s.on('end', teardown); s.on('error', teardown); s.on('close', teardown);
      }
    };

    const allow = (sni, atMs) => {
      if (decided) return;
      decided = true;
      log.push({ verdict: 'allow', sni: sni || null, atMs, mode });
      splice();
    };
    const block = (sni, atMs) => {
      if (decided) return;
      decided = true;
      log.push({ verdict: 'block', sni, atMs, mode });
      try { client.destroy(); } catch { /* noop */ }
      try { upstream.destroy(); } catch { /* noop */ }
    };

    // In streaming mode the budget IS the window. In first-packet mode the
    // decision is made by the first `data` event, so this timer is only a
    // fallback for a client that sends nothing; giving it a 1ms budget made it
    // race the arriving segment and fail open on every blocked host, which
    // silently turned the whole control section green for the wrong reason.
    const timer = setTimeout(() => {
      allow(parseSni(acc), Date.now() - started);   // budget exhausted -> fail open
    }, mode === 'streaming' ? windowMs : 800);

    function inspect(chunk) {
      const atMs = Date.now() - started;
      if (mode === 'first-packet') {
        clearTimeout(timer);
        acc = chunk;
        const sni = parseSni(chunk);
        if (sni && blocklist.includes(sni)) block(sni, atMs); else allow(sni, atMs);
        return;
      }
      acc = concat(acc, chunk);
      const sni = parseSni(acc);
      if (sni) {
        clearTimeout(timer);
        if (blocklist.includes(sni)) block(sni, atMs); else allow(sni, atMs);
      } else if (acc.length >= windowBytes) {
        clearTimeout(timer);
        allow(null, atMs);
      }
    }

    client.on('data', inspect);
    client.on('error', () => { clearTimeout(timer); try { upstream.destroy(); } catch { /* noop */ } });
    upstream.on('error', () => { clearTimeout(timer); try { client.destroy(); } catch { /* noop */ } });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      log,
      close: () => new Promise((r) => {
        for (const s of sockets) { try { s.destroy(); } catch { /* noop */ } }
        sockets.clear();
        server.close(() => r());
        setTimeout(r, 300).unref?.();
      }),
    }));
  });
}

/* --------------------------------------------------------- target + relay */

/** A trivial endpoint that records what it received and echoes a reply. */
export function startTarget() {
  const seen = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('data', (d) => {
      seen.push(d);
      try { sock.write(new Uint8Array([0x16, 0x03, 0x03, 0x00, 0x04, 0x02, 0x00, 0x00, 0x00])); } catch { /* closed */ }
    });
    sock.on('error', () => { /* client went away */ });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      host: '127.0.0.1', port: server.address().port, seen,
      // server.close() waits for every live connection to end. A peer that was
      // destroyed rather than gracefully closed leaves one behind, so close()
      // never calls back and the test runner hangs until it is killed. Destroy
      // them explicitly first.
      close: () => new Promise((r) => {
        for (const s of sockets) { try { s.destroy(); } catch { /* noop */ } }
        sockets.clear();
        server.close(() => r());
        setTimeout(r, 300).unref?.();
      }),
    }));
  });
}

/**
 * A minimal SOCKS5 relay (no-auth and user/pass) that records every CONNECT.
 *
 * `redirect` forwards to a local address instead of the requested one. Without
 * it the test would need real DNS and real egress for hosts like
 * gemini.google.com, which makes the suite network-dependent and flaky. The
 * requested destination is still recorded, which is the part under test.
 */
export function startSocks5({ requireAuth = false, username = '', password = '', redirect = null } = {}) {
  const connects = [];
  const sockets = new Set();
  const track = (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); return s; };
  const server = net.createServer((sock) => {
    track(sock);
    let stage = 'greet';
    let buf = new Uint8Array(0);
    sock.on('data', (d) => {
      buf = concat(buf, d);
      if (stage === 'greet') {
        if (buf.length < 2) return;
        const nMethods = buf[1];
        if (buf.length < 2 + nMethods) return;
        const methods = Array.from(buf.subarray(2, 2 + nMethods));
        buf = buf.subarray(2 + nMethods);
        if (requireAuth) { sock.write(new Uint8Array([0x05, 0x02])); stage = 'auth'; }
        else if (methods.includes(0x00)) { sock.write(new Uint8Array([0x05, 0x00])); stage = 'req'; }
        else { sock.write(new Uint8Array([0x05, 0xff])); sock.end(); }
        return;
      }
      if (stage === 'auth') {
        if (buf.length < 2) return;
        const ul = buf[1];
        if (buf.length < 2 + ul + 1) return;
        const u = new TextDecoder().decode(buf.subarray(2, 2 + ul));
        const pl = buf[2 + ul];
        if (buf.length < 3 + ul + pl) return;
        const p = new TextDecoder().decode(buf.subarray(3 + ul, 3 + ul + pl));
        buf = buf.subarray(3 + ul + pl);
        if (u === username && p === password) { sock.write(new Uint8Array([0x01, 0x00])); stage = 'req'; }
        else { sock.write(new Uint8Array([0x01, 0x01])); sock.end(); }
        return;
      }
      if (stage === 'req') {
        if (buf.length < 5) return;
        const atyp = buf[3];
        let host = ''; let port = 0; let off = 4;
        if (atyp === 0x01) {
          if (buf.length < 10) return;
          host = Array.from(buf.subarray(4, 8)).join('.'); port = (buf[8] << 8) | buf[9]; off = 10;
        } else if (atyp === 0x03) {
          const l = buf[4];
          if (buf.length < 7 + l) return;
          host = new TextDecoder().decode(buf.subarray(5, 5 + l)); port = (buf[5 + l] << 8) | buf[6 + l]; off = 7 + l;
        } else if (atyp === 0x04) {
          // IPv6: 16 raw bytes. Record the packed hex so a test can assert the
          // encoder produced real bytes rather than the ASCII literal.
          if (buf.length < 22) return;
          const raw = buf.subarray(4, 20);
          host = 'ipv6:' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('');
          port = (buf[20] << 8) | buf[21]; off = 22;
        } else {
          sock.write(new Uint8Array([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); sock.end(); return;
        }
        connects.push({ host, port });
        const rest = buf.subarray(off);
        buf = new Uint8Array(0);
        const dest = redirect || { host, port };
        stage = 'splice';
        const out = track(net.connect(dest.port, dest.host, () => {
          sock.write(new Uint8Array([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 0, (port >> 8) & 0xff, port & 0xff]));
          if (rest.length) out.write(rest);
          sock.pipe(out); out.pipe(sock);
        }));
        out.on('error', () => { try { sock.destroy(); } catch { /* noop */ } });
        sock.on('error', () => { try { out.destroy(); } catch { /* noop */ } });
      }
    });
    sock.on('error', () => { /* noop */ });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      host: '127.0.0.1', port: server.address().port, connects,
      close: () => new Promise((r) => {
        for (const s of sockets) { try { s.destroy(); } catch { /* noop */ } }
        sockets.clear();
        server.close(() => r());
        setTimeout(r, 300).unref?.();
      }),
    }));
  });
}

/* --------------------------------------------------------------- plumbing */

/** Send a fragment schedule down a socket, honouring the per-piece delays. */
export function sendSchedule(sock, schedule) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const t0 = Date.now();
    const step = () => {
      if (i >= schedule.length) { resolve({ ms: Date.now() - t0 }); return; }
      const piece = schedule[i++];
      const wait = i === 1 ? 0 : Math.max(0, piece.delayMs || 0);
      setTimeout(() => {
        try {
          if (piece.data.length) sock.write(piece.data);
          step();
        } catch (e) { reject(e); }
      }, wait);
    };
    step();
  });
}

export function connectTcp(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host, () => resolve(sock));
    sock.once('error', reject);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
