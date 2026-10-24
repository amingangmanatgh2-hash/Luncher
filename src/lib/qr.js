/**
 * Minimal QR Code encoder — byte mode, versions 1-40, EC levels L/M/Q/H.
 *
 * Written from scratch for Luncher so the panel can render QR codes for its own
 * subscription and share links with **zero runtime dependencies**. Loading a QR
 * library from jsDelivr/unpkg would break exactly when it matters most: on an
 * Iranian network where third-party CDNs are frequently unreachable.
 *
 * The Reed-Solomon block table and alignment-pattern positions below are
 * mechanical data, generated from the reference tables in ISO/IEC 18004 (via
 * the `qrcode` Python package) rather than transcribed by hand — see
 * scripts/gen-qr-tables.py. Output is verified two ways in tests/qr.test.js:
 *   1. module-for-module equality against `qrcode` for a forced mask pattern
 *   2. real end-to-end decode of the rendered image with OpenCV
 */

// EC level -> table index. L=0, M=1, Q=2, H=3 (the order used by the spec tables)
const EC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
// The 2-bit EC indicator that goes into the format information
const EC_FORMAT_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/** [version-1][ecIndex] -> flat [count, totalCodewords, dataCodewords, ...] */
const RS_BLOCKS = [
  /* v1  */ [[1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9]],
  /* v2  */ [[1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16]],
  /* v3  */ [[1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13]],
  /* v4  */ [[1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9]],
  /* v5  */ [[1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12]],
  /* v6  */ [[2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15]],
  /* v7  */ [[2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14]],
  /* v8  */ [[2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15]],
  /* v9  */ [[2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13]],
  /* v10 */ [[2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]],
  /* v11 */ [[4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13]],
  /* v12 */ [[2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15]],
  /* v13 */ [[4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12]],
  /* v14 */ [[3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13]],
  /* v15 */ [[5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13]],
  /* v16 */ [[5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16]],
  /* v17 */ [[1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15]],
  /* v18 */ [[5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15]],
  /* v19 */ [[3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14]],
  /* v20 */ [[3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16]],
  /* v21 */ [[4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17]],
  /* v22 */ [[2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13]],
  /* v23 */ [[4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16]],
  /* v24 */ [[6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17]],
  /* v25 */ [[8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16]],
  /* v26 */ [[10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17]],
  /* v27 */ [[8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16]],
  /* v28 */ [[3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16]],
  /* v29 */ [[7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16]],
  /* v30 */ [[5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16]],
  /* v31 */ [[13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16]],
  /* v32 */ [[17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16]],
  /* v33 */ [[17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16]],
  /* v34 */ [[13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17]],
  /* v35 */ [[12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16]],
  /* v36 */ [[6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16]],
  /* v37 */ [[17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16]],
  /* v38 */ [[4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16]],
  /* v39 */ [[20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16]],
  /* v40 */ [[19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16]],
];

/** [version-1] -> alignment pattern centre coordinates */
const ALIGNMENT = [
  /* v1  */ [],
  /* v2  */ [6, 18],
  /* v3  */ [6, 22],
  /* v4  */ [6, 26],
  /* v5  */ [6, 30],
  /* v6  */ [6, 34],
  /* v7  */ [6, 22, 38],
  /* v8  */ [6, 24, 42],
  /* v9  */ [6, 26, 46],
  /* v10 */ [6, 28, 50],
  /* v11 */ [6, 30, 54],
  /* v12 */ [6, 32, 58],
  /* v13 */ [6, 34, 62],
  /* v14 */ [6, 26, 46, 66],
  /* v15 */ [6, 26, 48, 70],
  /* v16 */ [6, 26, 50, 74],
  /* v17 */ [6, 30, 54, 78],
  /* v18 */ [6, 30, 56, 82],
  /* v19 */ [6, 30, 58, 86],
  /* v20 */ [6, 34, 62, 90],
  /* v21 */ [6, 28, 50, 72, 94],
  /* v22 */ [6, 26, 50, 74, 98],
  /* v23 */ [6, 30, 54, 78, 102],
  /* v24 */ [6, 28, 54, 80, 106],
  /* v25 */ [6, 32, 58, 84, 110],
  /* v26 */ [6, 30, 58, 86, 114],
  /* v27 */ [6, 34, 62, 90, 118],
  /* v28 */ [6, 26, 50, 74, 98, 122],
  /* v29 */ [6, 30, 54, 78, 102, 126],
  /* v30 */ [6, 26, 52, 78, 104, 130],
  /* v31 */ [6, 30, 56, 82, 108, 134],
  /* v32 */ [6, 34, 60, 86, 112, 138],
  /* v33 */ [6, 30, 58, 86, 114, 142],
  /* v34 */ [6, 34, 62, 90, 118, 146],
  /* v35 */ [6, 30, 54, 78, 102, 126, 150],
  /* v36 */ [6, 24, 50, 76, 102, 128, 154],
  /* v37 */ [6, 28, 54, 80, 106, 132, 158],
  /* v38 */ [6, 32, 58, 84, 110, 136, 162],
  /* v39 */ [6, 26, 54, 82, 110, 138, 166],
  /* v40 */ [6, 30, 58, 86, 114, 142, 170],
];

/* ---------------------------------------------------------- GF(256) arithmetic */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial of degree n, coefficients highest power first. */
function rsGenerator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                    // x * poly
      next[j + 1] ^= gfMul(poly[j], EXP[i]); // alpha^i * poly
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = msg[i];
    if (factor !== 0) for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], factor);
  }
  return msg.slice(data.length);
}

/* ------------------------------------------------------------------ structure */

function blocksOf(version, ecIdx) {
  const t = RS_BLOCKS[version - 1][ecIdx];
  const out = [];
  for (let i = 0; i < t.length; i += 3) {
    const [n, total, data] = [t[i], t[i + 1], t[i + 2]];
    for (let k = 0; k < n; k++) out.push({ total, data, ec: total - data });
  }
  return out;
}

const totalDataCodewords = (version, ecIdx) => blocksOf(version, ecIdx).reduce((a, b) => a + b.data, 0);
const charCountBits = (version) => (version <= 9 ? 8 : 16);

function pickVersion(byteLen, ecIdx) {
  for (let v = 1; v <= 40; v++) {
    const cap = totalDataCodewords(v, ecIdx) * 8;
    if (4 + charCountBits(v) + byteLen * 8 <= cap) return v;
  }
  return -1;
}

function buildCodewords(bytes, version, ecIdx) {
  const capBits = totalDataCodewords(version, ecIdx) * 8;
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };

  push(0b0100, 4); // byte mode
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);

  const term = Math.min(4, capBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    cw.push(v);
  }
  const PAD = [0xec, 0x11];
  let pi = 0;
  while (cw.length < capBits / 8) cw.push(PAD[pi++ % 2]);

  // Block interleave: all data codewords round-robin, then all EC codewords.
  const blocks = blocksOf(version, ecIdx);
  const dataB = []; const ecB = []; let off = 0;
  for (const b of blocks) {
    const d = cw.slice(off, off + b.data); off += b.data;
    dataB.push(d); ecB.push(rsEncode(d, b.ec));
  }
  const out = [];
  const maxD = Math.max(...dataB.map((x) => x.length));
  for (let i = 0; i < maxD; i++) for (const d of dataB) if (i < d.length) out.push(d[i]);
  const maxE = Math.max(...ecB.map((x) => x.length));
  for (let i = 0; i < maxE; i++) for (const x of ecB) if (i < x.length) out.push(x[i]);
  return out;
}

/* --------------------------------------------------------------------- masks */

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/* -------------------------------------------------------------------- matrix */

function drawFunctionPatterns(mods, fn, size, version) {
  const set = (r, c, v) => { if (r < 0 || c < 0 || r >= size || c >= size) return; mods[r][c] = v ? 1 : 0; fn[r][c] = true; };

  // Finder patterns + their light separators
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const r = r0 + i; const c = c0 + j;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const inside = i >= 0 && i <= 6 && j >= 0 && j <= 6;
        const dark = inside && ((i === 0 || i === 6 || j === 0 || j === 6) || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        set(r, c, dark);
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) { const v = i % 2 === 0; set(6, i, v); set(i, 6, v); }

  // Alignment patterns (skip the three corners that collide with finders)
  const pos = ALIGNMENT[version - 1];
  const n = pos.length;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === n - 1) || (a === n - 1 && b === 0)) continue;
      const r = pos[a]; const c = pos[b];
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const dark = Math.max(Math.abs(i), Math.abs(j)) !== 1;
          set(r + i, c + j, dark);
        }
      }
    }
  }

  // Reserve format-info areas (values written later, once the mask is known)
  for (let i = 0; i <= 8; i++) { if (i !== 6) { set(8, i, false); set(i, 8, false); } }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
  set(size - 8, 8, true); // the always-dark module

  // Version information
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(b, a, bit); // modules[b][a]
      set(a, b, bit); // modules[a][b]
    }
  }
  return set;
}

function drawFormatBits(mods, fn, size, ecLevel, mask) {
  const data = (EC_FORMAT_BITS[ecLevel] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const set = (r, c, v) => { mods[r][c] = v ? 1 : 0; fn[r][c] = true; };

  for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
  set(7, 8, bit(6));
  set(8, 8, bit(7));
  set(8, 7, bit(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));

  for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
}

function placeData(mods, fn, size, codewords, mask) {
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  let idx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // never overwrite the vertical timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (c < 0 || fn[row][c]) continue;
        let v = idx < bits.length ? bits[idx++] : 0; // remainder bits are zero
        if (MASKS[mask](row, c)) v ^= 1;
        mods[row][c] = v;
      }
    }
    upward = !upward;
  }
}

function penalty(mods, size) {
  let score = 0;
  const get = (r, c) => mods[r][c];

  // Rule 1: runs of five or more same-coloured modules
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (get(r, c) === get(r, c - 1)) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (get(r, c) === get(r - 1, c)) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }

  // Rule 2: 2x2 blocks of one colour
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = get(r, c);
      if (v === get(r, c + 1) && v === get(r + 1, c) && v === get(r + 1, c + 1)) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 with four light modules on one side
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const match = (arr, start, pat) => { for (let i = 0; i < pat.length; i++) if (arr[start + i] !== pat[i]) return false; return true; };
  for (let r = 0; r < size; r++) {
    const line = []; for (let c = 0; c < size; c++) line.push(get(r, c));
    for (let c = 0; c + 11 <= size; c++) if (match(line, c, P1) || match(line, c, P2)) score += 40;
  }
  for (let c = 0; c < size; c++) {
    const line = []; for (let r = 0; r < size; r++) line.push(get(r, c));
    for (let r = 0; r + 11 <= size; r++) if (match(line, r, P1) || match(line, r, P2)) score += 40;
  }

  // Rule 4: deviation of the dark module ratio from 50%
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += get(r, c);
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/**
 * @param {string} text
 * @param {{ec?:'L'|'M'|'Q'|'H', mask?:number, minVersion?:number}} [opts]
 * @returns {{size:number, version:number, ec:string, mask:number, modules:number[][]}|null}
 */
export function encodeQr(text, opts = {}) {
  const ecLevel = EC_INDEX[opts.ec || 'M'] !== undefined ? (opts.ec || 'M') : 'M';
  const ecIdx = EC_INDEX[ecLevel];
  const bytes = new TextEncoder().encode(String(text));
  const minV = opts.minVersion || 1;

  let version = -1;
  for (let v = minV; v <= 40; v++) if (pickVersion(bytes.length, ecIdx) === v && v >= minV) { version = v; break; }
  if (version < 0) version = pickVersion(bytes.length, ecIdx);
  if (version < 0 || version < minV) return null; // data too long for this EC level

  const codewords = buildCodewords(bytes, version, ecIdx);
  const size = version * 4 + 17;

  const candidates = typeof opts.mask === 'number' ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  let best = null;
  for (const mask of candidates) {
    const mods = Array.from({ length: size }, () => new Array(size).fill(0));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    drawFunctionPatterns(mods, fn, size, version);
    placeData(mods, fn, size, codewords, mask);
    drawFormatBits(mods, fn, size, ecLevel, mask);
    const score = penalty(mods, size);
    if (!best || score < best.score) best = { score, mask, modules: mods };
  }

  return { size, version, ec: ecLevel, mask: best.mask, modules: best.modules };
}

/** Render to a compact SVG string. No DOM, no fonts, no network. */
export function qrToSvg(text, opts = {}) {
  const q = encodeQr(text, { ec: opts.ec || 'M', mask: opts.mask });
  if (!q) return '';
  const quiet = opts.quiet === undefined ? 2 : opts.quiet;
  const n = q.size + quiet * 2;
  const fg = opts.fg || '#0b0d14';
  const bg = opts.bg || '#ffffff';
  let rects = '';
  for (let r = 0; r < q.size; r++) {
    let c = 0;
    while (c < q.size) {
      if (q.modules[r][c]) {
        let end = c;
        while (end + 1 < q.size && q.modules[r][end + 1]) end++;
        rects += `<rect x="${c + quiet}" y="${r + quiet}" width="${end - c + 1}" height="1"/>`;
        c = end + 1;
      } else c++;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${n}" height="${n}" fill="${bg}"/><g fill="${fg}">${rects}</g></svg>`;
}

export { RS_BLOCKS, ALIGNMENT, totalDataCodewords, pickVersion };

/** @internal exported for tests */
export function _debugCodewords(text, version, ecLevel) {
  const ecIdx = EC_INDEX[ecLevel];
  return buildCodewords(new TextEncoder().encode(text), version, ecIdx);
}
