/**
 * Outbound transport for the Worker.
 *
 * `connect()` from `cloudflare:sockets` is injected rather than imported here so
 * the module is unit-testable under plain Node (see tests/upstream.test.js).
 *
 * Three modes, chosen per user / per destination:
 *   direct      -> Cloudflare opens TCP to the target itself (exit IP = Cloudflare)
 *   socks5      -> tunnel through a user-supplied SOCKS5 relay
 *   http        -> tunnel through an HTTP CONNECT relay
 *
 * Relaying matters for sanctioned destinations: Gemini and Google AI Studio
 * reject requests by *source IP*, and Cloudflare's own egress ranges are
 * sometimes flagged as datacenter traffic. A relay outside Iran with a clean
 * IP fixes that. See docs/sanctions.md.
 */

import { portAllowed, isIpv4 } from './parse.js';

export class UpstreamError extends Error {
  constructor(message, code = 'upstream') { super(message); this.code = code; }
}

const enc = new TextEncoder();

/** RFC 1928 reply codes. Naming the reason turns a dead tunnel into a fixable one. */
const SOCKS5_REASONS = {
  0x01: 'general SOCKS server failure', 0x02: 'connection not allowed by ruleset',
  0x03: 'network unreachable', 0x04: 'host unreachable', 0x05: 'connection refused',
  0x06: 'TTL expired', 0x07: 'command not supported', 0x08: 'address type not supported',
};
const dec = new TextDecoder();

/**
 * Re-expose a locked writer as a WritableStream.
 *
 * The relay handshakes must own a writer (they interleave reads and writes),
 * which LOCKS the underlying stream. But `open()` promises callers a
 * WritableStream, and session.js relies on that: it calls
 * `toUpstream.readable.pipeTo(tun.writable)`, which throws immediately if
 * handed a WritableStreamDefaultWriter instead of a stream.
 *
 * Returning `writer` directly therefore broke every relayed connection — the
 * exact path that unlocks sanctioned services such as Gemini. Wrapping it keeps
 * the promise honest and preserves backpressure, since each write still awaits
 * the underlying writer.
 */
function writerAsStream(writer) {
  return new WritableStream({
    write(chunk) { return writer.write(chunk); },
    close() { return writer.close(); },
    abort(reason) { return writer.abort(reason); },
  });
}

/**
 * A reader that keeps its own leftover buffer.
 *
 * A SOCKS5 handshake is a sequence of fixed- and variable-length reads, and a
 * relay is free to coalesce replies into one TCP segment. Threading `leftover`
 * through every call site by hand is exactly where this code first went wrong:
 * it fed the 2-byte *authentication* reply into the parser for the CONNECT
 * reply, so `acc[0] !== 0x05` and every authenticated relay failed with
 * "bad SOCKS5 reply". Owning the buffer here makes that mistake unrepresentable.
 */
function bufferedReader(reader) {
  let acc = new Uint8Array(0);
  return {
    async take(n) {
      while (acc.length < n) {
        const { done, value } = await reader.read();
        if (done) throw new UpstreamError('relay closed during handshake', 'relay-eof');
        acc = concat2(acc, value);
      }
      const out = acc.subarray(0, n);
      acc = acc.subarray(n);
      return out;
    },
    /** Peek at what is buffered without consuming it. */
    get buffered() { return acc; },
    /** Hand over everything consumed past the handshake, for the data stream. */
    rest() { const r = acc; acc = new Uint8Array(0); return r; },
  };
}


async function readUntil(reader, sentinel, limit = 16384) {
  let acc = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new UpstreamError('relay closed during handshake', 'relay-eof');
    const next = new Uint8Array(acc.length + value.length);
    next.set(acc); next.set(value, acc.length); acc = next;
    const idx = indexOf(acc, sentinel);
    if (idx >= 0) return { head: acc.subarray(0, idx + sentinel.length), leftover: acc.subarray(idx + sentinel.length) };
    if (acc.length > limit) throw new UpstreamError('relay handshake too large', 'relay-proto');
  }
}

function indexOf(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Parse an IPv6 literal into its 16 packed bytes, or null.
 *
 * Handles `::` compression and the embedded-IPv4 suffix form by first rewriting
 * that suffix as two hex groups, so `::ffff:1.2.3.4` becomes `::ffff:102:304`
 * and the rest of the parser only ever sees hex groups.
 */
function parseIpv6(text) {
  let s = String(text).trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const p = v4.slice(1).map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, v4.index) + (((p[0] << 8) | p[1]) >>> 0).toString(16) + ':' + (((p[2] << 8) | p[3]) >>> 0).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (seg) => (seg === '' ? [] : seg.split(':').map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : null)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (head.includes(null) || tail.includes(null)) return null;
  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = head.concat(new Array(missing).fill(0), tail);
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => { bytes[i * 2] = (g >> 8) & 0xff; bytes[i * 2 + 1] = g & 0xff; });
  return bytes;
}

function addrBytes(host) {
  if (isIpv4(host)) return { atyp: 0x01, bytes: Uint8Array.from(host.split('.').map(Number)) };
  // ATYP 0x04 means 16 RAW bytes per RFC 1928. Encoding the literal text here
  // (as an earlier "simplified" version did) makes every IPv6 destination
  // unreachable through a relay, and the relay just reports a malformed request.
  const v6 = parseIpv6(host);
  if (v6) return { atyp: 0x04, bytes: v6 };
  const d = enc.encode(host);
  if (d.length === 0 || d.length > 255) {
    throw new UpstreamError('destination hostname is empty or too long for SOCKS5', 'bad-target');
  }
  return { atyp: 0x03, bytes: Uint8Array.from([d.length, ...d]) };
}

/** Wrap a reader (+ any bytes already consumed) back into a ReadableStream. */
function streamFrom(reader, leftover) {
  let first = leftover;
  return new ReadableStream({
    async pull(controller) {
      if (first && first.length) { const b = first; first = null; controller.enqueue(b); return; }
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      controller.enqueue(value);
    },
    cancel() { try { reader.releaseLock(); } catch { /* already released */ } },
  });
}

export function createUpstream(connectImpl, opts = {}) {
  if (typeof connectImpl !== 'function') {
    throw new UpstreamError('no connect() implementation available', 'no-transport');
  }
  const extraPorts = opts.extraPorts || [];

  function rawConnect(host, port, secure) {
    return connectImpl({ hostname: host, port: Number(port) }, {
      secureTransport: secure ? 'on' : 'off',
      allowUnregistered: true,
      ...(opts.connectTimeout ? {} : {}),
    });
  }

  /**
   * @param {{host:string,port:number}} target
   * @param {{relay?:object, tls?:boolean}} o
   * @returns {Promise<{readable:ReadableStream, writable:WritableStream, close:Function, via:string}>}
   */
  async function open(target, o = {}) {
    const { host, port } = target;
    if (!host) throw new UpstreamError('missing destination host', 'bad-target');
    if (!portAllowed(Number(port), extraPorts)) {
      throw new UpstreamError(
        `Cloudflare Workers cannot open TCP to port ${port}. Allowed: ${[...new Set([...(extraPorts || [])])].length ? 'see docs' : ''}80/443/8080/8443 and a fixed set.`,
        'port-blocked');
    }

    const relay = o.relay;
    if (!relay || !relay.host) {
      const sock = rawConnect(host, port, o.tls);
      return wrapSocket(sock, `direct:${host}:${port}`);
    }

    if (relay.type === 'socks5') return openSocks5(relay, host, port);
    if (relay.type === 'http') return openHttpConnect(relay, host, port);
    throw new UpstreamError(`unknown relay type ${relay.type}`, 'bad-relay');
  }

  function wrapSocket(sock, via) {
    return {
      readable: sock.readable,
      writable: sock.writable,
      via,
      close() { try { sock.close(); } catch { /* already closed */ } },
      get closed() { return sock.closed; },
    };
  }

  async function openSocks5(relay, host, port) {
    const sock = rawConnect(relay.host, relay.port, !!relay.tls);
    const writer = sock.writable.getWriter();
    const reader = sock.readable.getReader();
    try {
      const rb = bufferedReader(reader);
      const authed = !!(relay.username && relay.password);

      // Greeting: offer username/password when we hold credentials, else no-auth.
      await writer.write(authed ? new Uint8Array([0x05, 0x02, 0x00, 0x02]) : new Uint8Array([0x05, 0x01, 0x00]));
      const greeting = await rb.take(2);
      if (greeting[0] !== 0x05) throw new UpstreamError('relay is not SOCKS5', 'relay-proto');
      const method = greeting[1];
      if (method === 0xff) throw new UpstreamError('relay rejected all auth methods', 'relay-auth');

      if (method === 0x02) {
        if (!authed) throw new UpstreamError('relay requires a username/password', 'relay-auth');
        const u = enc.encode(relay.username);
        const pw = enc.encode(relay.password);
        await writer.write(Uint8Array.from([0x01, u.length, ...u, pw.length, ...pw]));
        // Subnegotiation reply is VER(0x01) STATUS(0x00 = success). It is fully
        // consumed here and must never reach the CONNECT-reply parser.
        const authRes = await rb.take(2);
        if (authRes[1] !== 0x00) throw new UpstreamError('relay auth failed', 'relay-auth');
      }
      // method 0x00 with credentials supplied: the relay chose no-auth. Common
      // and harmless — proceed without authenticating.

      const a = addrBytes(host);
      await writer.write(Uint8Array.from([
        0x05, 0x01, 0x00, a.atyp, ...a.bytes, (port >> 8) & 0xff, port & 0xff,
      ]));

      // Reply is VER REP RSV ATYP BND.ADDR BND.PORT; the address width depends on
      // ATYP, so read the 4-byte head first and then exactly the right amount.
      const head = await rb.take(4);
      if (head[0] !== 0x05) throw new UpstreamError('bad SOCKS5 reply', 'relay-proto');
      const rep = head[1];
      const atyp = head[3];
      let addrLen;
      if (atyp === 0x01) addrLen = 4;
      else if (atyp === 0x04) addrLen = 16;
      else if (atyp === 0x03) addrLen = 1 + (await rb.take(1))[0];
      else throw new UpstreamError(`unknown SOCKS5 address type 0x${atyp.toString(16)}`, 'relay-proto');
      await rb.take(addrLen + 2);   // bound address + bound port
      if (rep !== 0x00) {
        throw new UpstreamError(
          `relay refused the connection (0x${rep.toString(16)}: ${SOCKS5_REASONS[rep] || 'unknown'})`,
          'relay-refused');
      }

      const stream = streamFrom(reader, rb.rest());
      return {
        readable: stream, writable: writerAsStream(writer),
        via: `socks5:${relay.host}:${relay.port}->${host}:${port}`,
        close() { try { sock.close(); } catch { /* noop */ } },
      };
    } catch (e) {
      try { sock.close(); } catch { /* noop */ }
      throw e;
    }
  }

  async function openHttpConnect(relay, host, port) {
    const sock = rawConnect(relay.host, relay.port, !!relay.tls);
    const writer = sock.writable.getWriter();
    const reader = sock.readable.getReader();
    try {
      let req = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n`;
      if (relay.username) {
        const tok = btoa(`${relay.username}:${relay.password || ''}`);
        req += `Proxy-Authorization: Basic ${tok}\r\n`;
      }
      req += 'Connection: keep-alive\r\n\r\n';
      await writer.write(enc.encode(req));
      const { head, leftover } = await readUntil(reader, enc.encode('\r\n\r\n'));
      const status = dec.decode(head).split('\r\n')[0];
      if (!/\s2\d\d\s/.test(status + ' ')) throw new UpstreamError(`relay CONNECT failed: ${status}`, 'relay-refused');
      const stream = streamFrom(reader, leftover);
      return { readable: stream, writable: writerAsStream(writer), via: `http:${relay.host}:${relay.port}->${host}:${port}`,
        close() { try { sock.close(); } catch { /* noop */ } } };
    } catch (e) {
      try { sock.close(); } catch { /* noop */ }
      throw e;
    }
  }

  return { open };
}

function concat2(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}
