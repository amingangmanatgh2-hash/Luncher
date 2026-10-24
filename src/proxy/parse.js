/**
 * VLESS and Trojan request-header decoding.
 *
 * Byte layouts verified against XTLS/Xray-core and v2fly/v2ray-core:
 *
 *   VLESS  (port-first):
 *     version(1)=0 | uuid(16) | varint(addonLen) | addons | cmd(1)
 *                  | port(2 BE) | atyp(1) | addr | payload
 *     atyp: 1=IPv4(4B) 2=Domain(1B len + N) 3=IPv6(16B)
 *     cmd:  1=TCP 2=UDP 3=MUX
 *
 *   Trojan (port-last):
 *     hex(SHA224(password))(56 ASCII) | CRLF | cmd(1) | atyp(1) | addr
 *                  | port(2 BE) | CRLF | payload
 *     atyp: 0x01=IPv4(4B) 0x03=Domain(1B len + N) 0x04=IPv6(16B)
 *     cmd:  1=TCP 3=UDP
 *
 * Both accept an address that arrives split across several WebSocket frames,
 * so `decode` reports how many more bytes it needs instead of throwing.
 */

import { Reader, readVarint, bytesToUuid, isIpv4 } from '../lib/bytes.js';

export const MORE = Symbol('needMoreBytes');

/** Minimum bytes before we can even tell which protocol this is. */
export const MIN_SNIFF = 58;

const HEXOK = (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46);

/**
 * Cheap discriminator. Returns 'trojan' | 'vless' | null (undecided).
 * @param {Uint8Array} b
 */
export function sniff(b) {
  if (b.length === 0) return null;
  if (b[0] === 0x00) return 'vless';
  if (b.length >= MIN_SNIFF) {
    let hex = true;
    for (let i = 0; i < 56; i++) if (!HEXOK(b[i])) { hex = false; break; }
    if (hex && b[56] === 0x0d && b[57] === 0x0a) return 'trojan';
  }
  return null;
}

function readAddrVless(r) {
  const port = r.u16be();
  const atyp = r.byte();
  let host;
  if (atyp === 1) {
    const p = r.take(4);
    host = `${p[0]}.${p[1]}.${p[2]}.${p[3]}`;
  } else if (atyp === 2) {
    const n = r.byte();
    host = new TextDecoder().decode(r.take(n));
  } else if (atyp === 3) {
    const p = r.take(16);
    const g = [];
    for (let i = 0; i < 16; i += 2) g.push(((p[i] << 8) | p[i + 1]).toString(16));
    host = g.join(':').replace(/(^|:)0(:0)+(:|$)/g, '$1::$3').replace(/:::$/, '::');
  } else {
    return null;
  }
  return { host, port };
}

function readAddrTrojan(r) {
  const atyp = r.byte();
  let host;
  if (atyp === 0x01) {
    const p = r.take(4);
    host = `${p[0]}.${p[1]}.${p[2]}.${p[3]}`;
  } else if (atyp === 0x03) {
    const n = r.byte();
    host = new TextDecoder().decode(r.take(n));
  } else if (atyp === 0x04) {
    const p = r.take(16);
    const g = [];
    for (let i = 0; i < 16; i += 2) g.push(((p[i] << 8) | p[i + 1]).toString(16));
    host = g.join(':');
  } else {
    return null;
  }
  const port = r.u16be();
  return { host, port };
}

/**
 * @param {Uint8Array} buf accumulated bytes from the client
 * @returns {{kind:'vless'|'trojan', id:string, cmd:number, host:string, port:number,
 *            rest:Uint8Array}|typeof MORE|{error:string}}
 */
export function decode(buf) {
  const kind = sniff(buf);
  if (kind === null) {
    return buf.length < MIN_SNIFF ? MORE : { error: 'unrecognised protocol header' };
  }

  if (kind === 'trojan') {
    // Need the 58-byte prefix to authenticate, then at least 1 more byte for cmd.
    if (buf.length < 59) return MORE;
    const r = new Reader(buf);
    const keyBytes = r.take(56);
    const key = new TextDecoder().decode(keyBytes).toLowerCase();
    r.take(2); // CRLF
    const cmd = r.byte();
    if (r.remaining < 1) return MORE;
    const need = addrNeed(buf, r.i, 'trojan');
    if (need === MORE) return MORE;
    const a = readAddrTrojan(r);
    if (!a) return { error: 'bad trojan address' };
    if (r.remaining < 2) return MORE;
    r.take(2); // trailing CRLF
    if (cmd !== 1 && cmd !== 3) return { error: `unsupported trojan command ${cmd}` };
    return { kind: 'trojan', id: key, cmd, host: a.host, port: a.port, rest: r.rest() };
  }

  // VLESS
  if (buf.length < 18) return MORE;
  const r = new Reader(buf);
  const version = r.byte();
  if (version !== 0) return { error: `unsupported vless version ${version}` };
  const id = bytesToUuid(r.take(16));
  const av = readVarint(buf, r.i);
  if (!av) return MORE;
  r.i += av[1];
  const addonLen = av[0];
  if (r.remaining < addonLen) return MORE;
  const addons = r.take(addonLen);
  if (r.remaining < 1) return MORE;
  const cmd = r.byte();
  if (cmd === 3) return { error: 'mux is not supported over this transport' };
  const need = addrNeed(buf, r.i, 'vless');
  if (need === MORE) return MORE;
  const a = readAddrVless(r);
  if (!a) return { error: 'bad vless address' };
  return { kind: 'vless', id, cmd, host: a.host, port: a.port, rest: r.rest(), addons };
}

/** How many bytes an address block needs, given we are positioned at its start. */
function addrNeed(buf, at, kind) {
  if (kind === 'vless') {
    if (buf.length < at + 3) return MORE; // port(2) + atyp(1)
    const atyp = buf[at + 2];
    const need = atyp === 1 ? 4 : atyp === 3 ? 16 : atyp === 2 ? (buf.length >= at + 4 ? 1 + buf[at + 3] : MORE) : 0;
    if (need === MORE) return MORE;
    return buf.length >= at + 3 + need ? 0 : MORE;
  }
  if (buf.length < at + 1) return MORE;
  const atyp = buf[at];
  let need = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : 0;
  if (atyp === 0x03) {
    if (buf.length < at + 2) return MORE;
    need = 1 + buf[at + 1];
  }
  // +2 for the port, +2 for the trailing CRLF
  return buf.length >= at + 1 + need + 2 + 2 ? 0 : MORE;
}

/** True when the target is one Cloudflare itself cannot reach over TCP. */
export function isLoopback(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('127.') ||
    h === '0.0.0.0' || h === 'metadata.google.internal' || h === '169.254.169.254';
}

/**
 * Cloudflare Workers may only open outbound TCP to a fixed set of ports.
 * Anything else fails at connect() time, so reject early with a clear reason
 * rather than surfacing an opaque 1101 later.
 */
export const CF_TCP_PORTS = new Set([
  20, 21, 22, 80, 443, 8080, 8443,
  2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096,
]);

export function portAllowed(port, extra) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (CF_TCP_PORTS.has(port)) return true;
  return Array.isArray(extra) && extra.some((p) => Number(p) === port);
}

export { isIpv4 };
