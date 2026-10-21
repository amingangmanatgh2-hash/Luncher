/**
 * Bridges one client WebSocket to one upstream TCP connection.
 *
 * Everything here is defensive on purpose. An exception that escapes a Worker's
 * fetch handler is what Cloudflare surfaces as **error 1101** ("Worker threw an
 * exception"), so:
 *   - every promise gets a .catch()
 *   - every WebSocket send/close is guarded by a readyState check
 *   - header accumulation is capped so a malicious client cannot exhaust memory
 *   - protocol errors close the socket with a code instead of throwing
 */

import { decode, MORE, isLoopback } from './parse.js';
import { concat, base64ToBytes } from '../lib/bytes.js';

const MAX_HEADER_BYTES = 2048;   // a VLESS/Trojan header is < 300 bytes in practice
const IDLE_TIMEOUT_MS = 120000;  // close half-open tunnels so we do not leak sockets

export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}

function safeSend(ws, data) {
  try { if (ws.readyState === WS_OPEN) ws.send(data); } catch { /* peer already gone */ }
}

function safeClose(ws, code, reason) {
  try { if (ws.readyState === WS_OPEN || ws.readyState === WS_CLOSING) ws.close(code, reason || ''); } catch { /* noop */ }
}

/**
 * @param {object} p
 * @param {WebSocket} p.server           the accepted server side of the WebSocketPair
 * @param {Request}   p.request          original request (for early data / subprotocol)
 * @param {object}    p.upstream         from createUpstream()
 * @param {object}    p.ctx              { authenticate, authorizeTarget, relayFor, onUsage }
 * @returns {Promise<{ok:boolean, reason?:string, user?:object, target?:object, via?:string}>}
 */
export function attachSession(p) {
  const { server, request, upstream, ctx } = p;
  const earlyData = extractEarlyData(request);
  const pending = earlyData ? [earlyData] : [];

  let headerDone = false;
  let authedUser = null;
  let tunnel = null;      // { readable, writable, close, via }
  let upWriter = null;
  let bytesUp = 0;
  let bytesDown = 0;
  let closed = false;
  let idleTimer = null;

  // Client -> upstream, with backpressure handled by the stream, not by us.
  const toUpstream = new TransformStream();
  const upWriterSink = toUpstream.writable.getWriter();

  const result = { ok: false };

  const finish = (code, reason) => {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    safeClose(server, code, reason);
    try { tunnel && tunnel.close(); } catch { /* noop */ }
    try { upWriterSink.close(); } catch { /* noop */ }
    if (ctx.onUsage) {
      // Fire-and-forget accounting; never let it reject into the Worker.
      Promise.resolve()
        .then(() => ctx.onUsage({ bytesUp, bytesDown, user: authedUser }))
        .catch(() => { /* accounting is best-effort */ });
    }
  };

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => finish(1001, 'idle timeout'), IDLE_TIMEOUT_MS);
  };

  async function openTunnel(hdr) {
    if (isLoopback(hdr.host)) { finish(1008, 'loopback target refused'); return { error: 'loopback' }; }
    let relay = null;
    if (ctx.relayFor) {
      try { relay = await ctx.relayFor(hdr.host, hdr.port); }
      catch { relay = null; } // a broken relay must not kill the tunnel
    }
    let tun;
    try {
      tun = await upstream.open({ host: hdr.host, port: hdr.port }, { relay, tls: false });
    } catch (e) {
      finish(1011, e.code === 'port-blocked' ? 'port not reachable' : 'upstream failed');
      return { error: e.message, code: e.code };
    }
    tunnel = tun;

    // `tun.writable` is always a WritableStream (see writerAsStream in
    // upstream.js). pipeTo() requires the stream to be UNLOCKED, so the writer
    // used for the early-data remainder must be released before piping, or
    // pipeTo rejects with "already locked" and the tunnel dies on the first
    // byte of a client that sent `?ed=2048` early data.
    if (hdr.rest && hdr.rest.length) {
      upWriter = tun.writable.getWriter();
      try { await upWriter.write(hdr.rest); } finally { upWriter.releaseLock(); upWriter = null; }
    }
    await toUpstream.readable.pipeTo(tun.writable).catch(() => { /* peer reset */ });
    finish(1000, '');
    return {};
  }

  async function pumpDownstream() {
    const sink = new WritableStream({
      write(chunk) {
        bytesDown += chunk.byteLength || chunk.length || 0;
        armIdle();
        safeSend(server, chunk);
      },
      close() { finish(1000, ''); },
      abort() { finish(1006, 'upstream aborted'); },
    });
    await tunnel.readable.pipeTo(sink).catch(() => finish(1006, 'upstream reset'));
  }

  server.addEventListener('message', (event) => {
    if (closed) return;
    let chunk;
    try { chunk = toBytes(event.data); } catch { return; }
    armIdle();

    if (headerDone) {
      bytesUp += chunk.byteLength;
      upWriterSink.write(chunk).catch(() => finish(1006, 'write failed'));
      return;
    }

    pending.push(chunk);
    let buf;
    try { buf = concat(pending); } catch { return finish(1011, 'buffer error'); }
    if (buf.length > MAX_HEADER_BYTES) return finish(1009, 'header too large');

    let hdr;
    try { hdr = decode(buf); }
    catch (e) { return finish(1002, 'malformed header'); }

    if (hdr === MORE) return;                 // wait for the rest
    if (hdr.error) return finish(1008, hdr.error.slice(0, 100));
    pending.length = 0;
    headerDone = true;

    // Authenticate *after* we know the protocol, because the credential shape differs.
    let auth;
    try { auth = ctx.authenticate ? ctx.authenticate(hdr) : { ok: true }; }
    catch { auth = { ok: false, reason: 'auth error' }; }

    Promise.resolve(auth).then(async (a) => {
      if (!a || !a.ok) return finish(1008, (a && a.reason) || 'unauthorised');
      if (hdr.cmd !== 1) return finish(1008, 'only TCP is supported');
      if (ctx.authorizeTarget) {
        let allowed = true;
        try { allowed = await ctx.authorizeTarget(a.user, hdr.host, hdr.port); } catch { allowed = false; }
        if (!allowed) return finish(1008, 'destination not permitted');
      }
      authedUser = a.user;
      result.ok = true; result.user = a.user; result.target = { host: hdr.host, port: hdr.port };

      const opened = await openTunnel(hdr);
      if (opened.error) { result.reason = opened.error; return; }
      result.via = tunnel && tunnel.via;
      await pumpDownstream();
    }).catch((e) => finish(1011, 'session error'));
  });

  server.addEventListener('close', () => finish(1000, 'client closed'));
  server.addEventListener('error', () => finish(1006, 'socket error'));

  armIdle();
  return result;
}

/**
 * v2ray clients put the first bytes of the protocol header into the
 * `Sec-WebSocket-Protocol` header (base64) when the share link carries `ed=NNNN`.
 * Reading it saves a whole round trip, which matters a lot on high-latency links.
 */
export function extractEarlyData(request) {
  try {
    const proto = request.headers.get('Sec-WebSocket-Protocol');
    if (!proto) return null;
    const candidate = proto.split(',')[0].trim();
    // Only accept something that looks like base64 of a plausible header.
    if (!/^[A-Za-z0-9+/=_-]{8,}$/.test(candidate)) return null;
    const bytes = base64ToBytes(candidate.replace(/-/g, '+').replace(/_/g, '/'));
    if (bytes.length === 0 || bytes.length > MAX_HEADER_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}

export { toBytes, safeSend, safeClose };
