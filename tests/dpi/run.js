/**
 * Luncher DPI sandbox — executable report.
 *
 *   npm run test:dpi
 *
 * Runs entirely on loopback sockets. It answers four questions a user in Iran
 * actually needs answered, and it reports failures as readily as successes:
 *
 *   1. Does the simulated filter block the services we claim to unlock?
 *      (If the sandbox did not block anything, every later "pass" would be
 *      meaningless. This is the control.)
 *   2. Which of our shipped presets defeat a first-packet SNI inspector?
 *   3. Which defeat a *streaming* inspector that reassembles across segments?
 *      This is where splitting alone stops being enough and delay matters.
 *   4. Does the Worker still reconstruct what the filter could not, and does
 *      the relay path actually reach a sanctioned destination?
 *
 * Read tests/dpi/lib.js first for the modelling assumptions and their limits.
 */

import net from 'node:net';
import {
  clientHello, parseSni, fragment, startDpi, startTarget, startSocks5,
  sendSchedule, connectTcp, sleep, concat,
} from './lib.js';
import { FRAGMENT_PRESETS, SANCTIONED_DOMAINS, isSanctioned } from '../../src/panel/presets.js';
import { decode, MORE } from '../../src/proxy/parse.js';
import { createUpstream } from '../../src/proxy/upstream.js';

const BLOCKED = ['gemini.google.com', 'aistudio.google.com', 'chatgpt.com', 'claude.ai', 'api.openai.com'];
const DECOY = 'www.cloudflare.com';
const TRIALS = 3;

let failures = 0;
let checks = 0;
const results = [];

function record(section, name, ok, detail) {
  checks++;
  if (!ok) failures++;
  results.push({ section, name, ok, detail });
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${name}${detail ? '  \x1b[90m' + detail + '\x1b[0m' : ''}`);
}
function section(title) { console.log(`\n\x1b[1m${title}\x1b[0m`); }

/** Report a measurement without scoring it as a pass/fail. */
function info(sectionName, name, detail) {
  results.push({ section: sectionName, name, ok: null, detail });
  console.log(`  \x1b[36mINFO\x1b[0m  ${name}  \x1b[90m${detail}\x1b[0m`);
}

/* ------------------------------------------------------------------ shim */

/**
 * Adapt a Node socket to the `cloudflare:sockets` shape upstream.js expects:
 * synchronous return, web ReadableStream/WritableStream, plus close()/closed.
 * Writes issued before the TCP handshake completes are queued by Node, exactly
 * as workerd queues them, so the caller does not have to await `opened`.
 */
function nodeConnect({ hostname, port }) {
  const sock = net.connect(Number(port), hostname);
  sock.setNoDelay(true);
  let closed = false;
  const readable = new ReadableStream({
    start(controller) {
      let enqueued = false;
      sock.on('data', (d) => { if (!closed) { try { controller.enqueue(new Uint8Array(d)); enqueued = true; } catch { /* closed */ } } });
      const finish = () => { closed = true; try { controller.close(); } catch { /* already closed */ } };
      sock.on('end', finish);
      sock.on('close', finish);
      sock.on('error', () => {
        closed = true;
        // Surface a refused connect the way workerd does: as a stream error, so
        // upstream.js reports it instead of hanging.
        try { controller.error(new Error('connect failed')); } catch { if (!enqueued) { try { controller.close(); } catch { /* noop */ } } }
      });
    },
    cancel() { try { sock.destroy(); } catch { /* noop */ } },
  });
  const writable = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        sock.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
    },
    close() { try { sock.end(); } catch { /* noop */ } },
    abort() { try { sock.destroy(); } catch { /* noop */ } },
  });
  return {
    readable, writable,
    close() { try { sock.destroy(); } catch { /* noop */ } },
    get closed() { return closed; },
    opened: new Promise((resolve, reject) => {
      sock.once('connect', resolve);
      sock.once('error', reject);
    }),
  };
}

/* --------------------------------------------------------------- attempt */

/**
 * Push one ClientHello through the inspector and observe the verdict.
 *
 * The verdict is read from the wire, not from the inspector's log: if the flow
 * survives, the target echoes bytes back; if it is blocked, the socket dies.
 * That keeps the assertion honest — it is what a real client would experience.
 */
/**
 * A preset fragments only if it carries a mask. `none` and `satellite` do not, and
 * a future preset that deliberately opts out must not need a new special case
 * sprinkled through this file — the harness crashed the first time a second
 * non-fragmenting preset appeared, which is what this replaces.
 */
const fragments = (id) => !!(FRAGMENT_PRESETS[id] && FRAGMENT_PRESETS[id].mask);

async function attempt(dpiPort, { sni, preset = 'none', hostHeader = null, timeoutMs = 1200 }) {
  const hello = clientHello(sni);
  const schedule = fragment(hello, preset);
  const sock = await connectTcp(dpiPort);
  sock.setNoDelay(true);

  // The verdict and the send schedule are tracked separately. Awaiting only the
  // verdict made this flaky: the target echoes on the first fragment, so the
  // promise resolved and the socket was destroyed before the scheduled Host
  // header was ever written — reporting "Host header never arrived" for a flow
  // that had in fact been allowed.
  const verdictPromise = new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    sock.once('data', () => done('allowed'));
    sock.once('error', () => done('blocked'));
    sock.once('close', () => done('blocked'));
  });

  const sending = sendSchedule(sock, schedule).catch(() => 'blocked');
  let wroteHost = false;
  if (hostHeader) {
    // What a real client sends after the handshake, so the claim "decoy SNI,
    // real Host header" is exercised end to end rather than asserted.
    await sleep(30);
    try {
      sock.write(new TextEncoder().encode(
        `GET /luncher?ed=2048 HTTP/1.1\r\nHost: ${hostHeader}\r\nUpgrade: websocket\r\n\r\n`));
      wroteHost = true;
    } catch { wroteHost = false; }
  }

  const verdict = await verdictPromise;
  await sending;
  // Give an allowed flow time to deliver the Host header before we tear down and
  // before the caller inspects what the target saw.
  if (hostHeader && verdict === 'allowed') await sleep(120);

  try { sock.destroy(); } catch { /* noop */ }
  return { verdict, pieces: schedule.length, wroteHost };
}

/* ------------------------------------------------------------------ main */

async function main() {
  console.log('\x1b[1mLuncher DPI sandbox\x1b[0m');
  console.log('\x1b[90mSimulated SNI filtering on loopback. Offline by design; see tests/dpi/lib.js for the model and its limits.\x1b[0m');

  const target = await startTarget();

  /* ------------------------------------------------------------- 1. TLS */
  section('1. TLS record construction (the sandbox must be able to see SNI at all)');
  for (const name of ['gemini.google.com', 'chatgpt.com', DECOY, 'example.com']) {
    const rec = clientHello(name);
    record('tls', `ClientHello -> parseSni("${name}")`, parseSni(rec) === name, `${rec.length} bytes`);
  }
  {
    const rec = clientHello('gemini.google.com');
    // A truncated prefix must NOT yield an SNI: this is precisely the condition
    // fragmentation creates for the inspector.
    let firstLoss = -1;
    for (let n = rec.length; n > 0; n--) { if (parseSni(rec.subarray(0, n)) === null) { firstLoss = n; break; } }
    record('tls', 'truncated ClientHello hides the SNI',
      firstLoss > 0 && firstLoss < rec.length,
      `SNI unrecoverable below ${firstLoss} of ${rec.length} bytes`);
    record('tls', 'one byte short is not enough', parseSni(rec.subarray(0, rec.length - 1)) === null, '');
  }

  /* --------------------------------------------------- 2. control: block */
  section('2. Control — an unfragmented handshake to a blocked host MUST be dropped');
  {
    const dpi = await startDpi({ target, blocklist: BLOCKED, mode: 'first-packet' });
    for (const sni of ['gemini.google.com', 'chatgpt.com']) {
      const r = await attempt(dpi.port, { sni, preset: 'none' });
      record('control', `first-packet DPI blocks ${sni}`, r.verdict === 'blocked', `verdict=${r.verdict}`);
    }
    const ok = await attempt(dpi.port, { sni: 'example.com', preset: 'none' });
    record('control', 'first-packet DPI allows an unlisted host', ok.verdict === 'allowed', `verdict=${ok.verdict}`);
    await dpi.close();
  }
  {
    const dpi = await startDpi({ target, blocklist: BLOCKED, mode: 'streaming', windowMs: 400, windowBytes: 8192 });
    for (const sni of ['gemini.google.com', 'aistudio.google.com']) {
      const r = await attempt(dpi.port, { sni, preset: 'none' });
      record('control', `streaming DPI blocks ${sni}`, r.verdict === 'blocked', `verdict=${r.verdict}`);
    }
    await dpi.close();
  }

  /* ------------------------------------------------- 3. preset vs first-packet */
  section('3. Shipped presets vs a first-packet SNI inspector (window = 1 segment)');
  {
    const dpi = await startDpi({ target, blocklist: BLOCKED, mode: 'first-packet' });
    const ids = Object.keys(FRAGMENT_PRESETS);
    for (const id of ids) {
      const sni = BLOCKED[ids.indexOf(id) % BLOCKED.length];
      const runs = [];
      for (let i = 0; i < TRIALS; i++) runs.push(await attempt(dpi.port, { sni, preset: id }));
      const passed = runs.filter((r) => r.verdict === 'allowed').length;
      const expectAllow = fragments(id);
      const ok = expectAllow ? passed === TRIALS : passed === 0;
      record('first-packet', `${id.padEnd(14)} vs ${sni}`,
        ok, `${passed}/${TRIALS} allowed, ${runs[0].pieces} fragments${expectAllow ? '' : ' (expected blocked: preset does not fragment)'}`);
    }
    await dpi.close();
  }

  /* ------------------------------------------------- 4. preset vs streaming */
  section('4. Shipped presets vs a streaming inspector (reassembles within 40ms)');
  console.log('  \x1b[90mSplitting alone does not beat this inspector — the pieces still arrive and still\n  contain the SNI. Only presets whose fragments are spaced beyond the inspection\n  window defeat it. Results below are measured, not assumed.\x1b[0m');
  const streaming = {};
  {
    const dpi = await startDpi({ target, blocklist: BLOCKED, mode: 'streaming', windowMs: 40, windowBytes: 8192 });
    for (const id of Object.keys(FRAGMENT_PRESETS)) {
      if (!fragments(id)) { streaming[id] = { passed: 0, note: 'no fragmentation' }; continue; }
      let passed = 0; let pieces = 0;
      for (let i = 0; i < TRIALS; i++) {
        const r = await attempt(dpi.port, { sni: BLOCKED[i % BLOCKED.length], preset: id });
        if (r.verdict === 'allowed') passed++;
        pieces = r.pieces;
      }
      streaming[id] = { passed, pieces };
      const delays = (FRAGMENT_PRESETS[id].mask.tcp[0].settings.delays || []).join('/');
      // Measured, not asserted: a preset losing to a reassembling inspector is a
      // finding to report, not a build failure. The one invariant that MUST hold
      // is checked after the loop — otherwise the sandbox could not tell a
      // working defence from an inspector that simply never blocks anything.
      info('streaming', `${id.padEnd(14)} (delays ${delays}ms)`,
        `${passed}/${TRIALS} allowed, ${pieces} fragments`);
    }
    await dpi.close();

    const beats = Object.entries(streaming).filter(([, v]) => v.passed === TRIALS && v.pieces).map(([k]) => k);
    record('streaming', 'at least one shipped preset defeats a reassembling inspector',
      beats.length > 0, beats.length ? beats.join(', ') : 'none — check the window or the delay model');
    record('streaming', 'not every preset defeats a reassembling inspector (discrimination check)',
      beats.length < Object.keys(streaming).length - 1,
      `${beats.length}/${Object.keys(streaming).length - 1} presets beat it`);
  }

  /* ------------------------------------------------------- 5. decoy SNI */
  section('5. Decoy SNI — advertise an innocent name, route by Host header');
  {
    const dpi = await startDpi({ target, blocklist: BLOCKED, mode: 'streaming', windowMs: 400, windowBytes: 8192 });
    const r = await attempt(dpi.port, { sni: DECOY, preset: 'balanced', hostHeader: 'luncher.example.workers.dev' });
    record('decoy', `ClientHello says ${DECOY}, Host says the Worker`, r.verdict === 'allowed', `verdict=${r.verdict}`);
    const gotHost = target.seen.some((b) => new TextDecoder().decode(b).includes('Host: luncher.example.workers.dev'));
    record('decoy', 'target still received the real Host header', gotHost && r.wroteHost,
      gotHost ? 'routing preserved: innocent SNI, real Host' : `host written=${r.wroteHost}, arrived=${gotHost}`);
    await dpi.close();
  }

  /* --------------------------------------- 6. Worker-side reassembly */
  section('6. The Worker reassembles what the filter could not');
  {
    // VLESS: version(1)=0 | uuid(16) | varint addons | cmd(1) | port(2) | atyp | addr
    const uuid = Uint8Array.from([0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff,0x00]);
    const dom = new TextEncoder().encode('gemini.google.com');
    const vless = concat(new Uint8Array([0x00]), uuid, new Uint8Array([0x00]),
      new Uint8Array([0x01]), new Uint8Array([0x01, 0xbb]), new Uint8Array([0x02, dom.length]), dom,
      new TextEncoder().encode('PAYLOAD'));
    const trojanKey = new TextEncoder().encode('07f3019e36783ac5253649a9aa621ba3287b0b7b4e8db6c5c5519444');
    // Trojan uses SOCKS5 address numbering (0x01 IPv4, 0x03 domain, 0x04 IPv6),
    // which differs from VLESS (1/2/3). Getting this wrong is a classic way to
    // build a test vector that a correct parser rightly rejects.
    const trojan = concat(trojanKey, new Uint8Array([0x0d, 0x0a]), new Uint8Array([0x01]),
      new Uint8Array([0x03, dom.length]), dom, new Uint8Array([0x01, 0xbb]), new Uint8Array([0x0d, 0x0a]),
      new TextEncoder().encode('PAYLOAD'));

    for (const [label, msg, wantHost, wantPort] of [['VLESS', vless, 'gemini.google.com', 443], ['Trojan', trojan, 'gemini.google.com', 443]]) {
      let acc = new Uint8Array(0); let sawMore = 0; let out = null;
      for (let i = 0; i < msg.length; i++) {
        acc = concat(acc, msg.subarray(i, i + 1));   // one byte at a time
        const r = decode(acc);
        if (r === MORE) { sawMore++; continue; }
        out = r; break;
      }
      record('reassembly', `${label} header decoded from single-byte fragments`,
        !!out && !out.error && out.host === wantHost && Number(out.port) === wantPort,
        out ? `host=${out.host} port=${out.port} after ${sawMore} partial reads` : 'never completed');
      record('reassembly', `${label} reported MORE while incomplete`, sawMore > 5, `${sawMore} partial reads before a verdict`);
    }
  }

  /* ------------------------------------------------ 7. sanctioned routing */
  section('7. Sanctioned-destination routing decisions');
  {
    for (const h of ['gemini.google.com', 'aistudio.google.com', 'chatgpt.com', 'claude.ai']) {
      record('routing', `isSanctioned("${h}") routes via relay`, isSanctioned(h) === true, '');
    }
    for (const h of ['www.googleapis.com', 'example.com', 'cdn.jsdelivr.net']) {
      record('routing', `isSanctioned("${h}") stays direct`, isSanctioned(h) === false, '');
    }
    record('routing', 'subdomain matching works', isSanctioned('ai.google.dev') && isSanctioned('deepmind.google'),
      `${SANCTIONED_DOMAINS.length} domains covered`);
  }

  /* ------------------------------------------------------ 8. relay path */
  section('8. Relay path through upstream.js against a live SOCKS5 relay');
  {
    // `redirect` keeps this hermetic: the relay records the requested
    // destination (the thing under test) but forwards to the local target, so
    // no DNS or real egress is involved.
    const relay = await startSocks5({ redirect: { host: target.host, port: target.port } });
    const upstream = createUpstream(nodeConnect);

    /**
     * Regression guard for a real bug this sandbox caught.
     *
     * session.js does `toUpstream.readable.pipeTo(tun.writable)`, which requires
     * a WritableStream. The relay paths used to return the locked
     * WritableStreamDefaultWriter instead, so pipeTo threw and every relayed
     * connection died — precisely the path that unlocks Gemini. The direct path
     * had the mirror-image problem: session.js also called `tun.writable.write()`
     * for early data, which a WritableStream does not have.
     * All three modes must now return a stream, and session.js must take a
     * writer from it and release the lock before piping.
     */
    const assertStream = async (label, opts2) => {
      try {
        const conn = await upstream.open({ host: 'gemini.google.com', port: 443 }, opts2);
        const isStream = conn.writable instanceof WritableStream && typeof conn.writable.getWriter === 'function';
        record('contract', `${label}: writable is a WritableStream`, isStream, `via=${conn.via}`);
        if (isStream) {
          // The exact sequence session.js performs, including the lock release.
          const w = conn.writable.getWriter();
          await w.write(new Uint8Array([1, 2, 3]));
          w.releaseLock();
          const piped = await Promise.race([
            new ReadableStream({ start(c) { c.enqueue(new Uint8Array([4, 5])); c.close(); } })
              .pipeTo(conn.writable).then(() => 'piped'),
            sleep(800).then(() => 'timeout'),
          ]);
          record('contract', `${label}: pipeTo works after releaseLock`, piped === 'piped', `result=${piped}`);
        }
        conn.close();
        return conn;
      } catch (e) {
        record('contract', `${label}: writable is a WritableStream`, false, `${e.code || ''} ${e.message}`);
        return null;
      }
    };

    // Direct mode is checked against the local target with its ephemeral port
    // allowlisted, so this suite never dials a real host.
    const localUpstream = createUpstream(nodeConnect, { extraPorts: [target.port] });
    {
      const conn = await localUpstream.open({ host: target.host, port: target.port }, {});
      const isStream = conn.writable instanceof WritableStream && typeof conn.writable.getWriter === 'function';
      record('contract', 'direct: writable is a WritableStream', isStream, `via=${conn.via}`);
      if (isStream) {
        const w = conn.writable.getWriter();
        await w.write(new Uint8Array([1, 2, 3]));
        w.releaseLock();
        const piped = await Promise.race([
          new ReadableStream({ start(c) { c.enqueue(new Uint8Array([4, 5])); c.close(); } })
            .pipeTo(conn.writable).then(() => 'piped'),
          sleep(800).then(() => 'timeout'),
        ]);
        record('contract', 'direct: pipeTo works after releaseLock', piped === 'piped', `result=${piped}`);
      }
      conn.close();
    }
    await assertStream('socks5 relay', { relay: { name: 'test', type: 'socks5', host: relay.host, port: relay.port } });
    await sleep(80);
    record('relay', 'relay saw the CONNECT for the sanctioned host',
      relay.connects.some((c) => c.host === 'gemini.google.com' && c.port === 443),
      JSON.stringify(relay.connects));

    const authRelay = await startSocks5({ requireAuth: true, username: 'u1', password: 'p1',
      redirect: { host: target.host, port: target.port } });
    try {
      const conn = await upstream.open({ host: 'chatgpt.com', port: 443 },
        { relay: { type: 'socks5', host: authRelay.host, port: authRelay.port, username: 'u1', password: 'p1' } });
      record('relay', 'username/password auth accepted', conn.writable instanceof WritableStream, `via=${conn.via}`);
      conn.close();
    } catch (e) { record('relay', 'username/password auth accepted', false, e.message); }

    try {
      await upstream.open({ host: 'chatgpt.com', port: 443 },
        { relay: { type: 'socks5', host: authRelay.host, port: authRelay.port } });
      record('relay', 'missing credentials are refused with relay-auth', false, 'open() unexpectedly succeeded');
    } catch (e) {
      record('relay', 'missing credentials are refused with relay-auth', e.code === 'relay-auth', `code=${e.code}`);
    }
    await authRelay.close();

    try {
      await upstream.open({ host: 'gemini.google.com', port: 25 }, {});
      record('relay', 'a port Workers may not dial is refused, not crashed', false, 'open() unexpectedly succeeded');
    } catch (e) {
      record('relay', 'a port Workers may not dial is refused, not crashed', e.code === 'port-blocked', `code=${e.code}`);
    }
    await relay.close();
  }

  await target.close();
  await sleep(60);

  /* -------------------------------------------------------- verdict */
  console.log('\n\x1b[1mSummary\x1b[0m');
  const bySection = {};
  for (const r of results) {
    const b = bySection[r.section] = bySection[r.section] || { ok: 0, bad: 0, info: 0 };
    if (r.ok === null) b.info++; else if (r.ok) b.ok++; else b.bad++;
  }
  for (const [k, v] of Object.entries(bySection)) {
    console.log(`  ${k.padEnd(14)} ${v.ok} passed, ${v.bad} failed${v.info ? ', ' + v.info + ' measured' : ''}`);
  }
  console.log(`\n  total: ${checks - failures}/${checks} passed`);

  const streamingFailures = Object.entries(streaming).filter(([, v]) => v.passed !== TRIALS && v.pieces);
  if (streamingFailures.length) {
    console.log('\n\x1b[1mFindings to report to the user (not test failures unless asserted above)\x1b[0m');
    for (const [id, v] of Object.entries(streaming)) {
      if (!v.pieces) continue;
      const delays = (FRAGMENT_PRESETS[id].mask.tcp[0].settings.delays || []).join('/');
      const verdict = v.passed === TRIALS ? 'defeats a streaming inspector' : 'does NOT reliably defeat a streaming inspector';
      console.log(`  ${id.padEnd(14)} delays=${String(delays).padEnd(8)} ${v.passed}/${TRIALS}  -> ${verdict}`);
    }
    console.log('  \x1b[90mA preset that loses to a streaming inspector is still fine against the far more\n  common first-packet inspector (section 3). Use maxStealth / balanced / tci when\n  the network reassembles.\x1b[0m');
  }

  if (failures) { console.log(`\n\x1b[31m${failures} check(s) failed\x1b[0m`); process.exitCode = 1; }
  else console.log('\n\x1b[32mAll checks passed.\x1b[0m');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('\nDPI sandbox crashed:', e); process.exit(2); });
