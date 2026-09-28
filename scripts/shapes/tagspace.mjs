// tagspace — do a throw-up's letters touch without landing on each other?
//
//   node scripts/shapes/tagspace.mjs
//
// A throw-up was set by advancing each letter 0.72–0.84 of its box, so every letter bit into the one
// before it. On a four-letter handle that read as a style; on a sentence a player sprayed it buried a
// third of every letter under its neighbour and COLDWATER LIES came out as a row of blobs. Nothing
// failed: the bake drew exactly what it was told, every frame. `tagLayout` now spaces letters by
// their outlines so the bodies stop TAG_GAP apart at their nearest and one keyline runs between
// them, and this holds it there for every letterform:
//
//   · no two letters overlap or come closer than the gap, on a line or between lines;
//   · each letter after the first in a word touches the word so far (it did not drift apart);
//   · every letter A-Z and digit 0-9 has a drawn or stroked glyph in every face, so none falls back
//     to a system font, which is a different hand on every machine;
//   · no stroked letter's point runs away from it (the mitre clip in `tagJoinPoly`).
//
// ⚠ MEASURED ON THE OUTLINE, NOT ON THE LAYOUT'S OWN BANDS. `tagLayout` spaces letters by the
// extents of their outlines in 2px bands; re-deriving the answer the same way would agree with it
// wherever it was wrong. This cuts each outline with exact scanlines, and takes the true distance
// between the segments of letters that nearly meet.
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const faces = ws.tagFaceList();
let pass = 0;
const fails = [];
const check = (ok, what) => { if (ok) pass++; else fails.push(what); };

const PLAYER = ['COLDWATER LIES', 'THE ARCHITECT IS WATCHING YOU ALL', 'NO NO NO', 'KINGS OF THE UNDER 4EVER',
  'WWWWWW', 'LT AV TY', 'HI!', 'I', 'MMM 101', 'WHO IS WATCHING?', 'QUIZ JOCKS VEX', 'AVAVAV'];
const WORDS = [...ws.tagWordList(), ...PLAYER];
const VARIANTS = [0, 5];
const STEP = 0.5;

// Every crossing of one letter's outline with the lines t = o + k·STEP, as [lo, hi] per line.
// `axis` 0 cuts horizontally (t is y, the answer is x); 1 cuts vertically.
function scan(segs, ox, oy, axis) {
  let tMin = Infinity, tMax = -Infinity;
  for (const s of segs) for (const t of axis ? [s[0] + ox, s[2] + ox] : [s[1] + oy, s[3] + oy]) { tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
  const o = Math.floor(tMin / STEP) * STEP, n = Math.floor((tMax - o) / STEP) + 1;
  const lo = new Float64Array(n).fill(Infinity), hi = new Float64Array(n).fill(-Infinity);
  for (const s of segs) {
    const a0 = axis ? s[0] + ox : s[1] + oy, a1 = axis ? s[2] + ox : s[3] + oy;
    const b0 = axis ? s[1] + oy : s[0] + ox, b1 = axis ? s[3] + oy : s[2] + ox;
    const k0 = Math.ceil((Math.min(a0, a1) - o) / STEP), k1 = Math.floor((Math.max(a0, a1) - o) / STEP);
    for (let k = Math.max(0, k0); k <= Math.min(n - 1, k1); k++) {
      const t = o + k * STEP;
      const v = Math.abs(a1 - a0) < 1e-9 ? [b0, b1] : [b0 + (b1 - b0) * (t - a0) / (a1 - a0)];
      for (const x of v) { if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
    }
  }
  return { o, lo, hi };
}
// The least room between A's far side and B's near side over the lines both cross, or Infinity.
function across(A, B) {
  let sep = Infinity;
  const k0 = Math.round((Math.max(A.o, B.o) - A.o) / STEP), off = Math.round((A.o - B.o) / STEP);
  for (let k = k0; k < A.lo.length; k++) {
    const j = k + off;
    if (j < 0) continue;
    if (j >= B.lo.length) break;
    if (A.hi[k] >= A.lo[k] && B.hi[j] >= B.lo[j]) sep = Math.min(sep, B.lo[j] - A.hi[k]);
  }
  return sep;
}
// The true least distance between two placed outlines. Only the segments that reach toward the
// other letter's box can hold the nearest point, so the rest are dropped before the pairwise pass.
function nearest(PA, PB, pad) {
  const toward = (P, o) => P.segs.filter((s) => Math.max(s[0], s[2]) >= o.x0 - pad && Math.min(s[0], s[2]) <= o.x1 + pad
    && Math.max(s[1], s[3]) >= o.y0 - pad && Math.min(s[1], s[3]) <= o.y1 + pad);
  const A = toward(PA, PB), B = toward(PB, PA);
  const pt = (x, y, s) => {
    const dx = s[2] - s[0], dy = s[3] - s[1], L = dx * dx + dy * dy;
    const t = L > 1e-12 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L)) : 0;
    return Math.hypot(x - (s[0] + dx * t), y - (s[1] + dy * t));
  };
  let d = Infinity;
  for (const s of A) for (const u of B) {
    d = Math.min(d, pt(s[0], s[1], u), pt(s[2], s[3], u), pt(u[0], u[1], s), pt(u[2], u[3], s));
  }
  return d;
}

// 1. Coverage.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
for (const face of faces) {
  const L = ws.tagLayoutOf(ALPHA.slice(0, 13) + ' ' + ALPHA.slice(13, 26) + ' ' + ALPHA.slice(26), face, 0);
  const got = new Set(L ? L.glyphs.filter((q) => q.glyph || q.sk).map((q) => q.ch) : []);
  const missing = [...ALPHA].filter((ch) => !got.has(ch));
  check(!missing.length, `${face}: no drawn or stroked glyph for ${missing.join('')}; it would fall back to a system font`);
}

// 2. Spacing, and 3. how far a point reaches.
let layouts = 0, pairs = 0, tightest = Infinity, loosest = 0;
for (const face of faces) for (const word of WORDS) for (const v of VARIANTS) {
  const L = ws.tagLayoutOf(word, face, v);
  if (!L) { check(false, `${face} "${word}" v${v}: no layout`); continue; }
  layouts++;
  const { glyphs, lineY, gap, cell } = L;
  // ⚠ A PIXEL UNDER THE GAP IS STILL SPACED: the layout works in 2px bands and what it promises
  // is the gap to within one. What this catches is letters running INTO each other.
  const TOL = 1;
  const tag = `${face} "${word}" v${v}`;
  const P = glyphs.map((q) => {
    const ox = q.ax, oy = lineY[q.li];
    const segs = q.segs.map((s) => [s[0] + ox, s[1] + oy, s[2] + ox, s[3] + oy]);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); }
    return { q, segs, x0, x1, y0, y1, rows: scan(q.segs, ox, oy, 0), cols: scan(q.segs, ox, oy, 1) };
  });

  for (const p of P) {
    let reach = 0;
    for (const s of p.q.segs) reach = Math.max(reach, Math.abs(s[1] - p.q.bob), Math.abs(s[3] - p.q.bob));
    check(reach <= cell * 0.8, `${tag}: '${p.q.ch}' reaches ${(reach / cell).toFixed(2)} of a cell from its middle`);
  }

  for (let j = 0; j < P.length; j++) {
    const B = P[j];
    // A letter's own word is the run back to the last space; `spaces` sits on the letter after one.
    let near = Infinity, inWord = !B.q.spaces;
    for (let i = j - 1; i >= 0; i--) {
      const A = P[i];
      if (A.q.li === B.q.li) {
        // Across the line, at every scanline both cross.
        const sep = across(A.rows, B.rows);
        if (sep !== Infinity) {
          pairs++;
          check(sep >= gap - TOL, `${tag}: '${B.q.ch}' runs ${(gap - sep).toFixed(1)}px into '${A.q.ch}'`);
        }
      } else {
        // Down the piece: the line above never has a letter this one lands on.
        const sep = across(A.cols, B.cols);
        if (sep !== Infinity) check(sep >= gap - TOL, `${tag}: '${B.q.ch}' on line ${B.q.li + 1} sits ${(gap - sep).toFixed(1)}px into '${A.q.ch}' above it`);
      }
      // In any direction, for the letters whose boxes come within reach of each other.
      if (A.x1 + gap * 3 < B.x0 || B.x1 + gap * 3 < A.x0 || A.y1 + gap * 3 < B.y0 || B.y1 + gap * 3 < A.y0) continue;
      const d = nearest(A, B, gap * 3);
      check(d >= gap - TOL, `${tag}: '${B.q.ch}' comes ${d.toFixed(1)}px from '${A.q.ch}', under the ${gap.toFixed(1)}px gap`);
      // Touching is judged within a word: across a space the gap is meant to be wide.
      if (inWord && A.q.li === B.q.li) near = Math.min(near, d);
      if (A.q.spaces) inWord = false;
    }
    if (j && B.q.li === P[j - 1].q.li && !B.q.spaces) {
      tightest = Math.min(tightest, near);
      loosest = Math.max(loosest, near);
      // The layout binds on 2px bands, so a point can sit up to a band from where its band says.
      // More than two bands over is a letter that came loose from its word.
      check(near <= gap + 4, `${tag}: '${B.q.ch}' stands ${(near - gap).toFixed(1)}px off the letters before it`);
    }
  }
}

if (fails.length) {
  console.error(`tagspace: ${fails.length} failure(s)`);
  for (const f of fails.slice(0, 40)) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`✓ tagspace: ${pass} checks over ${layouts} layouts (${faces.join(', ')}); ${pairs} letter pairs clear the gap, and letters in a word sit ${tightest.toFixed(1)}–${loosest.toFixed(1)}px apart at their nearest against a ${(64 * 0.07).toFixed(1)}px gap.`);
