// THE FACE ATLAS: BAKE IT, OR CHECK THE COMMITTED ONE IS WHAT THE PAINTER MAKES.
//
//   node scripts/shapes/actor-faces.mjs            # gate: paints in memory, writes nothing
//   node scripts/shapes/actor-faces.mjs --write    # bake client/game/assets/actor-faces*.png
//   node scripts/shapes/actor-faces.mjs --report   # the numbers behind it
//
// Phase 3 of docs/proposals/street-figure-heads.md. The painter is tools/modelshop/face-masks.mjs;
// what the masks mean and how they're coloured is client/game/js/panels/actor-faces.js.
//
// The gate repaints the atlas and compares it with the committed PNGs pixel by pixel, so an edit to
// the painter or the layouts that wasn't re-baked fails here rather than shipping a stale atlas.
// It compares decoded pixels, not file bytes, because zlib's output differs between versions.
// It also checks each face has what it should where it should (both eyes open, the lips, a beard
// on the bearded and none on the rest), the cell borders are plain skin so mips and filtering
// don't bleed one face into the next, and the token pick reaches every layout and is stable.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { paintFaceAtlas } from '../../tools/modelshop/face-masks.mjs';
import { FACE_ATLAS, FACE_LAYOUTS, faceCell, actorFace, faceHair, FACE_COLOURS } from '../../client/game/js/panels/actor-faces.js';
import { FACE } from '../../client/game/js/panels/actor-head.js';

const WRITE = process.argv.includes('--write'), REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };
const FULL = new URL('../../client/game/' + FACE_ATLAS.src, import.meta.url), HALF = new URL('../../client/game/' + FACE_ATLAS.half, import.meta.url);

// ── PNG, RGBA 8-bit, unpremultiplied ────────────────────────────────────────────────────────────────
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
function encodePng(px, w, h) {
  // Each row gets whichever filter leaves the smallest sum, the usual heuristic.
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h), row = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    let best = null, bestSum = Infinity, bestF = 0;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const v = px[y * stride + x], a = x >= 4 ? px[y * stride + x - 4] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= 4 && y ? px[(y - 1) * stride + x - 4] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
        row[x] = (v - pred) & 255;
        sum += row[x] < 128 ? row[x] : 256 - row[x];
      }
      if (sum < bestSum) { bestSum = sum; bestF = f; best = Buffer.from(row); }
    }
    raw[y * (stride + 1)] = bestF;
    best.copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePng(buf) {
  let o = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9]; }
    else if (t === 'IDAT') idat.push(data);
    else if (t === 'IEND') break;
    o += 12 + len;
  }
  if (type !== 6) throw new Error(`colour type ${type}, not RGBA`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, px = new Uint8Array(h * stride);
  for (let y = 0, p = 0; y < h; y++) {
    const f = raw[p++];
    for (let x = 0; x < stride; x++, p++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= 4 && y ? px[(y - 1) * stride + x - 4] : 0;
      const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      px[y * stride + x] = (raw[p] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
  }
  return { w, h, px };
}

// ── Paint ───────────────────────────────────────────────────────────────────────────────────────────
const { cols, rows, cellW, cellH, w, h, maxLevel } = FACE_ATLAS;
const { full, half } = paintFaceAtlas();
if (WRITE) {
  const a = encodePng(full, w, h), b = encodePng(half, w / 2, h / 2);
  writeFileSync(FULL, a); writeFileSync(HALF, b);
  console.log(`wrote ${FACE_ATLAS.src} (${w}×${h}, ${(a.length / 1024).toFixed(0)} KB) and ${FACE_ATLAS.half} (${w / 2}×${h / 2}, ${(b.length / 1024).toFixed(0)} KB)`);
}

// ── The layout of the atlas ─────────────────────────────────────────────────────────────────────────
if (FACE_LAYOUTS.length !== cols * rows) problems.push(`${FACE_LAYOUTS.length} layouts for ${cols * rows} cells`);
if (cols * cellW !== w || rows * cellH !== h) problems.push(`${cols}×${rows} cells of ${cellW}×${cellH} aren't ${w}×${h}`);
if (w > 4096 || h > 4096) problems.push(`the atlas is ${w}×${h}; keep it to 4096 for the phones`);
if (cellW % (1 << maxLevel) || cellH % (1 << maxLevel)) problems.push(`cells of ${cellW}×${cellH} aren't on ${1 << maxLevel}-texel boundaries, so mip ${maxLevel} mixes faces`);
for (const L of FACE_LAYOUTS) if (L.beard && L.makeup) problems.push('a layout has both a beard and makeup');
{
  const [u0, v0, du, dv] = faceCell(cols + 2);
  if (Math.abs(u0 - 2 / cols) > 1e-9 || Math.abs(v0 - (rows - 2) / rows) > 1e-9 || du !== 1 / cols || dv !== 1 / rows) problems.push(`faceCell(${cols + 2}) is ${[u0, v0, du, dv]}, not cell 2 of row 1 in a flipped upload`);
}

// ── Against the committed PNGs ──────────────────────────────────────────────────────────────────────
for (const [url, px, ww, hh] of [[FULL, full, w, h], [HALF, half, w / 2, h / 2]]) {
  let png;
  try { png = decodePng(readFileSync(url)); } catch (e) { problems.push(`${url.pathname.split('/').pop()} won't read (${e.message}); run node scripts/shapes/actor-faces.mjs --write`); continue; }
  if (png.w !== ww || png.h !== hh) { problems.push(`${url.pathname.split('/').pop()} is ${png.w}×${png.h}, not ${ww}×${hh}`); continue; }
  let off = 0, worst = 0;
  for (let i = 0; i < px.length; i++) { const d = Math.abs(px[i] - png.px[i]); if (d > 1) off++; worst = Math.max(worst, d); }
  report(`${url.pathname.split('/').pop()}: ${off} bytes off by more than 1, worst ${worst}`);
  if (off) problems.push(`${url.pathname.split('/').pop()} isn't what the painter makes (${off} bytes differ, by up to ${worst}); run node scripts/shapes/actor-faces.mjs --write`);
}

// ── Each face ───────────────────────────────────────────────────────────────────────────────────────
// A texel of a layout at a point on the face, in metres.
const at = (i, x, y, c) => {
  const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
  const px = Math.floor(((x - FACE.x0) / (FACE.x1 - FACE.x0)) * cellW), py = Math.floor(((FACE.y1 - y) / (FACE.y1 - FACE.y0)) * cellH);
  return full[((cy + py) * w + cx + px) * 4 + c];
};
const R = 0, G = 1, B = 2, A = 3, PLAIN = Math.round(255 / 1.5);
FACE_LAYOUTS.forEach((L, i) => {
  for (const s of [1, -1]) if (at(i, s * FACE.irisX, FACE.eyeY, A) > 40) problems.push(`layout ${i}: the ${s > 0 ? 'left' : 'right'} eye isn't open`);
  if (at(i, 0, 1.559, B) < 200 || at(i, 0, 1.572, B) < 200) problems.push(`layout ${i}: no lips`);
  for (const s of [1, -1]) {
    let g = 0;
    for (let y = 1.65; y <= 1.664; y += 0.0005) g = Math.max(g, at(i, s * 0.03, y, G));
    if (g < 60) problems.push(`layout ${i}: no ${s > 0 ? 'left' : 'right'} brow`);
  }
  // the chin, mean over a patch
  let g = 0;
  for (let k = 0; k < 25; k++) g += at(i, -0.02 + (k % 5) * 0.01, 1.53 + Math.floor(k / 5) * 0.003, G) / 25;
  report(`  layout ${i}: age ${L.age}, beard ${L.beard}, chin ${g.toFixed(0)} hair`);
  if (L.beard === 2 && g < 70) problems.push(`layout ${i} has a full beard and its chin is ${g.toFixed(0)} hair`);
  if (L.beard === 1 && (g < 5 || g > 70)) problems.push(`layout ${i} has stubble and its chin is ${g.toFixed(0)} hair`);
  if (L.beard === 0 && g > 3) problems.push(`layout ${i} has no beard and its chin is ${g.toFixed(0)} hair`);
  // No eye or lip near the cell's edge. The head's UVs stay 8 texels in from it, and mips to
  // maxLevel never mix cells, so only a feature painted in the wrong place could bleed.
  const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
  let bad = 0;
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      if (x >= 8 && x < cellW - 8 && y >= 8 && y < cellH - 8) continue;
      const o = ((cy + y) * w + cx + x) * 4;
      if (full[o + 2] > 115 || full[o + 3] < 255) bad++;
    }
  }
  if (bad) problems.push(`layout ${i}: ${bad} texels of eye or lip within 8 of the cell's edge`);
  if (Math.abs(at(i, 0, 1.762, R) - PLAIN) > 3) problems.push(`layout ${i}: the crown isn't plain skin (${at(i, 0, 1.762, R)}, not ${PLAIN})`);
});

// ── The pick ────────────────────────────────────────────────────────────────────────────────────────
{
  const hash = (t, k) => { let x = 0x811c9dc5 ^ k; for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return (x >>> 8) / 0x1000000; };
  // Tokens as street-actors.js mints them: a 32-bit FNV hash in base 36.
  let seed = 12345;
  const u32 = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const used = new Array(FACE_LAYOUTS.length).fill(0), styles = new Set();
  for (let n = 0; n < 6400; n++) {
    const t = u32().toString(36), f = actorFace((k) => hash(t, 20 + k));
    used[f.layout]++; styles.add(f.hairStyle);
    if (n < 50 && JSON.stringify(f) !== JSON.stringify(actorFace((k) => hash(t, 20 + k)))) problems.push('the same token picked two faces');
    if (Object.keys(f).some((k) => !['layout', 'iris', 'lipstick', 'hairStyle'].includes(k))) problems.push(`actorFace returns ${Object.keys(f)}; it should carry nothing but the face`);
  }
  report(`6,400 tokens: each layout ${Math.min(...used)} to ${Math.max(...used)} times, ${styles.size} hair styles`);
  if (Math.min(...used) < 100) problems.push(`a layout is picked ${Math.min(...used)} times in 6,400 tokens; the pick doesn't reach every face`);
  if (styles.size !== FACE_COLOURS.hairStyle.length) problems.push(`only ${styles.size} hair styles picked`);
  const young = FACE_LAYOUTS.findIndex((L) => L.age < 0.3), old = FACE_LAYOUTS.findIndex((L) => L.age > 0.9);
  if (faceHair([30, 20, 15], young).some((c, k) => c !== [30, 20, 15][k])) problems.push('a young face greys the hair');
  if (!(faceHair([30, 20, 15], old)[0] > 90)) problems.push('an old face leaves the hair dark');
}

if (problems.length) {
  console.error('actor-faces: FAIL');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
report('actor-faces: ok');
