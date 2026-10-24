/** Byte-level helpers shared by the protocol parsers and config generators. */

export const ATYP_IPV4 = 1;
export const ATYP_DOMAIN = 2; // VLESS numbering
export const ATYP_IPV6 = 3; // VLESS numbering

// Trojan uses the SOCKS5 ATYP numbering, which differs from VLESS.
export const T_ATYP_IPV4 = 0x01;
export const T_ATYP_DOMAIN = 0x03;
export const T_ATYP_IPV6 = 0x04;

export const CMD_TCP = 1;
export const CMD_UDP = 2;
export const CMD_MUX = 3;

const HEX = '0123456789abcdef';
const UNHEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 16; i++) t[HEX.charCodeAt(i)] = i;
  for (let i = 0; i < 16; i++) t[HEX.toUpperCase().charCodeAt(i)] = i;
  return t;
})();

/** Parse a UUID (dashed hex or raw base64) into exactly 16 bytes, or null. */
export function uuidToBytes(input) {
  if (!input) return null;
  const s = String(input).trim();
  const hex = s.replace(/-/g, '');
  if (/^[0-9a-fA-F]{32}$/.test(hex)) {
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      const hi = UNHEX[hex.charCodeAt(i * 2)];
      const lo = UNHEX[hex.charCodeAt(i * 2 + 1)];
      if (hi < 0 || lo < 0) return null;
      out[i] = (hi << 4) | lo;
    }
    return out;
  }
  // Some clients emit the UUID already base64-encoded.
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    if (bin.length === 16) {
      const out = new Uint8Array(16);
      for (let i = 0; i < 16; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
  } catch { /* not base64 */ }
  return null;
}

/** 16 bytes -> canonical dashed UUID string. */
export function bytesToUuid(b) {
  let h = '';
  for (let i = 0; i < b.length; i++) h += HEX[b[i] >> 4] + HEX[b[i] & 0xf];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 16 bytes -> base64 (the form VLESS share links use for the id). */
export function bytesToBase64(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function base64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read a protobuf-style varint. Returns [value, bytesRead] or null. */
export function readVarint(buf, offset = 0) {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result >>> 0, i - offset];
    shift += 7;
    if (shift > 35) return null; // malformed
  }
  return null; // truncated
}

export function isIpv4(s) {
  const p = String(s).split('.');
  if (p.length !== 4) return false;
  return p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
}

export function isIpv6(s) {
  return String(s).includes(':') && /^[0-9a-fA-F:]+$/.test(s);
}

export function isValidHost(s) {
  if (!s) return false;
  if (s.length > 253) return false;
  return /^[a-zA-Z0-9._\-\[\]:]+$/.test(s);
}

/** Concatenate Uint8Arrays. */
export function concat(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** A tiny byte cursor for parsing headers. */
export class Reader {
  constructor(buf) { this.b = buf; this.i = 0; }
  get remaining() { return this.b.length - this.i; }
  byte() { return this.b[this.i++]; }
  u16be() { const v = (this.b[this.i] << 8) | this.b[this.i + 1]; this.i += 2; return v; }
  take(n) { const s = this.b.subarray(this.i, this.i + n); this.i += n; return s; }
  rest() { return this.b.subarray(this.i); }
}
