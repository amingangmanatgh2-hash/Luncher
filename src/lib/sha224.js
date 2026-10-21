/**
 * SHA-224 in pure JavaScript.
 *
 * WebCrypto (`crypto.subtle.digest`) does not implement SHA-224, but the
 * Trojan protocol authenticates with `hex(SHA224(password))` — 56 lowercase
 * hex chars — so we need it. SHA-224 is SHA-256 with a different IV and the
 * output truncated to 28 bytes, which is what this implements.
 *
 * Verified against Node's `crypto.createHash('sha224')` in tests/sha224.test.js.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV224 = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** @param {Uint8Array} data @returns {Uint8Array} 28-byte digest */
export function sha224(data) {
  const msg = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  const bitLen = msg.length * 8;

  // padding: 0x80, zeros, then 64-bit big-endian bit length in the final block
  const withOne = msg.length + 1;
  const blocks = Math.ceil((withOne + 8) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // Bit length as 64-bit BE. JS bitwise ops are 32-bit, so split hi/lo.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const tail = buf.length - 8;
  buf[tail] = (hi >>> 24) & 0xff;
  buf[tail + 1] = (hi >>> 16) & 0xff;
  buf[tail + 2] = (hi >>> 8) & 0xff;
  buf[tail + 3] = hi & 0xff;
  buf[tail + 4] = (lo >>> 24) & 0xff;
  buf[tail + 5] = (lo >>> 16) & 0xff;
  buf[tail + 6] = (lo >>> 8) & 0xff;
  buf[tail + 7] = lo & 0xff;

  const h = Int32Array.from(IV224);
  const w = new Uint32Array(64);

  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(28);
  for (let i = 0; i < 7; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

const HEX = '0123456789abcdef';

/** @param {Uint8Array} bytes @returns {string} lowercase hex */
export function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0xf];
  }
  return s;
}

/** The 56-char Trojan "key" for a given password. */
export function trojanKey(password) {
  return toHex(sha224(new TextEncoder().encode(password)));
}

/** Constant-time-ish string compare (avoid length/short-circuit timing leaks). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
