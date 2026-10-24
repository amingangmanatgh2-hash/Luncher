/**
 * Outbound transport tests.
 *
 * These lock in three defects that the DPI sandbox (tests/dpi/run.js) caught at
 * runtime and that no amount of reading would have surfaced:
 *
 *   1. `open()` returned a WritableStreamDefaultWriter on the relay paths but a
 *      WritableStream on the direct path. session.js does both
 *      `tun.writable.write(...)` and `tun.writable.pipeTo(...)`, so one of the
 *      two always threw — every relayed connection died, which is precisely the
 *      path that unlocks sanctioned services.
 *   2. The SOCKS5 username/password handshake fed the 2-byte auth reply into the
 *      CONNECT-reply parser, so every authenticated relay failed with
 *      "bad SOCKS5 reply".
 *   3. IPv6 destinations were encoded as their ASCII text under ATYP 0x04, which
 *      RFC 1928 defines as 16 raw bytes.
 *
 * The fake relay comes from tests/dpi/lib.js so there is exactly one
 * implementation of it; two would eventually disagree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startSocks5, startTarget, sleep, concat } from './dpi/lib.js';
import { createUpstream, UpstreamError } from '../src/proxy/upstream.js';

/** Adapt a Node socket to the cloudflare:sockets shape upstream.js consumes. */
function nodeConnect({ hostname, port }) {
  const sock = net.connect(Number(port), hostname);
  sock.setNoDelay(true);
  let closed = false;
  const readable = new ReadableStream({
    start(controller) {
      sock.on('data', (d) => { if (!closed) { try { controller.enqueue(new Uint8Array(d)); } catch { /* closed */ } } });
      const finish = () => { closed = true; try { controller.close(); } catch { /* already closed */ } };
      sock.on('end', finish); sock.on('close', finish);
      sock.on('error', () => { closed = true; try { controller.close(); } catch { /* noop */ } });
    },
    cancel() { try { sock.destroy(); } catch { /* noop */ } },
  });
  const writable = new WritableStream({
    write(chunk) { return new Promise((res, rej) => sock.write(chunk, (e) => (e ? rej(e) : res()))); },
    close() { try { sock.end(); } catch { /* noop */ } },
    abort() { try { sock.destroy(); } catch { /* noop */ } },
  });
  return { readable, writable, close() { try { sock.destroy(); } catch { /* noop */ } }, get closed() { return closed; } };
}

/**
 * `portAllowed` enforces the fixed set of TCP ports Cloudflare Workers may dial.
 * Test servers bind ephemeral ports, so each test allowlists the ports it needs
 * rather than weakening the check globally — the allowlist itself is asserted
 * separately below.
 */
const mkUpstream = (extraPorts = []) => createUpstream(nodeConnect, { extraPorts });
const upstream = mkUpstream();

/** The exact sequence session.js performs on a tunnel's writable side. */
async function exerciseWritable(t) {
  assert.ok(t.writable instanceof WritableStream, 'writable must be a WritableStream, not a writer');
  assert.equal(typeof t.writable.getWriter, 'function', 'must expose getWriter()');
  const w = t.writable.getWriter();
  await w.write(new Uint8Array([1, 2, 3]));      // early-data remainder
  w.releaseLock();                                // pipeTo requires an unlocked stream
  const src = new ReadableStream({
    start(c) { c.enqueue(new Uint8Array([4, 5, 6])); c.close(); },
  });
  await src.pipeTo(t.writable);                   // must not reject with "already locked"
}

test('direct mode returns a stream session.js can write to and pipe into', async () => {
  const target = await startTarget();
  const tun = await mkUpstream([target.port]).open({ host: target.host, port: target.port });
  assert.match(tun.via, /^direct:/);
  await exerciseWritable(tun);
  await sleep(60);
  assert.ok(target.seen.length > 0, 'target should have received bytes');
  tun.close();
  await target.close();
});

test('socks5 relay returns the same writable contract as direct mode', async () => {
  const target = await startTarget();
  const relay = await startSocks5({ redirect: { host: target.host, port: target.port } });
  const tun = await upstream.open({ host: 'gemini.google.com', port: 443 },
    { relay: { type: 'socks5', host: relay.host, port: relay.port } });
  assert.match(tun.via, /^socks5:/);
  await exerciseWritable(tun);
  await sleep(80);
  assert.deepEqual(relay.connects, [{ host: 'gemini.google.com', port: 443 }]);
  tun.close();
  await relay.close(); await target.close();
});

test('socks5 username/password authentication succeeds', async () => {
  const target = await startTarget();
  const relay = await startSocks5({ requireAuth: true, username: 'user1', password: 'pass1',
    redirect: { host: target.host, port: target.port } });
  const tun = await upstream.open({ host: 'chatgpt.com', port: 443 },
    { relay: { type: 'socks5', host: relay.host, port: relay.port, username: 'user1', password: 'pass1' } });
  await exerciseWritable(tun);
  await sleep(80);
  assert.deepEqual(relay.connects, [{ host: 'chatgpt.com', port: 443 }],
    'the auth reply must be consumed separately from the CONNECT reply');
  tun.close();
  await relay.close(); await target.close();
});

test('socks5 wrong password is reported as relay-auth, not a protocol error', async () => {
  const relay = await startSocks5({ requireAuth: true, username: 'user1', password: 'pass1' });
  await assert.rejects(
    upstream.open({ host: 'chatgpt.com', port: 443 },
      { relay: { type: 'socks5', host: relay.host, port: relay.port, username: 'user1', password: 'WRONG' } }),
    (e) => e instanceof UpstreamError && e.code === 'relay-auth',
  );
  await relay.close();
});

test('socks5 relay demanding auth without credentials is refused clearly', async () => {
  const relay = await startSocks5({ requireAuth: true, username: 'user1', password: 'pass1' });
  await assert.rejects(
    upstream.open({ host: 'chatgpt.com', port: 443 },
      { relay: { type: 'socks5', host: relay.host, port: relay.port } }),
    (e) => e.code === 'relay-auth' && /username\/password/.test(e.message),
  );
  await relay.close();
});

test('IPv6 destinations are packed into 16 raw bytes under ATYP 0x04', async () => {
  const target = await startTarget();
  const relay = await startSocks5({ redirect: { host: target.host, port: target.port } });
  const tun = await upstream.open({ host: '2606:4700::bc72:6106', port: 443 },
    { relay: { type: 'socks5', host: relay.host, port: relay.port } });
  await sleep(80);
  assert.equal(relay.connects.length, 1);
  assert.equal(relay.connects[0].host, 'ipv6:260647000000000000000000bc726106',
    'ATYP 0x04 must carry 16 packed bytes, never the ASCII literal');
  assert.equal(relay.connects[0].port, 443);
  tun.close();
  await relay.close(); await target.close();
});

test('a port Workers may not dial is refused instead of crashing', async () => {
  await assert.rejects(upstream.open({ host: 'gemini.google.com', port: 25 }, {}),
    (e) => e instanceof UpstreamError && e.code === 'port-blocked');
});

test('every port Workers may dial is accepted, and others are refused', async () => {
  // Direct mode returns without waiting for the TCP handshake, so an unused
  // loopback port is enough to prove the allowlist decision — which is the
  // thing actually under test. Nothing here reaches the network.
  const allowed = [20, 21, 22, 80, 443, 8080, 8443, 2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096];
  for (const port of allowed) {
    const tun = await upstream.open({ host: '127.0.0.1', port });
    assert.ok(tun.writable instanceof WritableStream, `port ${port} should be dialable`);
    tun.close();
  }
  for (const port of [25, 53, 3306, 5432, 6379, 27017]) {
    await assert.rejects(upstream.open({ host: '127.0.0.1', port }),
      (e) => e.code === 'port-blocked', `port ${port} must be refused`);
  }
});

test('createUpstream rejects a missing connect() implementation', () => {
  assert.throws(() => createUpstream(undefined), (e) => e.code === 'no-transport');
});

test('an unknown relay type is reported, not swallowed', async () => {
  await assert.rejects(
    upstream.open({ host: 'example.com', port: 443 }, { relay: { type: 'carrier-pigeon', host: 'x', port: 1 } }),
    (e) => e.code === 'bad-relay',
  );
});

test('bytes arriving with the relay reply are not lost', async () => {
  // A relay that coalesces its CONNECT reply with the first bytes of the
  // proxied stream must not drop those bytes — a naive parser consumes the whole
  // chunk and the tunnel then starts mid-record.
  const server = net.createServer((sock) => {
    let stage = 0; let buf = new Uint8Array(0);
    sock.on('data', (d) => {
      buf = concat(buf, d);
      if (stage === 0 && buf.length >= 2) { sock.write(new Uint8Array([0x05, 0x00])); buf = new Uint8Array(0); stage = 1; return; }
      if (stage === 1 && buf.length >= 5) {
        // Reply + immediate server payload in ONE segment.
        sock.write(concat(new Uint8Array([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x01, 0xbb]),
          new TextEncoder().encode('HELLO-PIPED')));
        stage = 2;
      }
    });
    sock.on('error', () => { /* noop */ });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const tun = await mkUpstream([]).open({ host: 'example.com', port: 443 },
    { relay: { type: 'socks5', host: '127.0.0.1', port } });
  const reader = tun.readable.getReader();
  const { value } = await reader.read();
  assert.equal(new TextDecoder().decode(value), 'HELLO-PIPED',
    'payload pipelined with the SOCKS reply must survive into the data stream');
  tun.close();
  await new Promise((r) => { server.close(() => r()); setTimeout(r, 300).unref?.(); });
});
