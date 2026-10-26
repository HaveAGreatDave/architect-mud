// Deadball's clubs: each club's colours, home and road kits and crest, written into the
// Deadball broadcast row as `sports_pools.clubs`. The same seam the CPhL uses
// (build-cphl-clubs.mjs, client/game/js/panels/club-crest.js); a club without an entry
// here wears the house kits and gets no crest.
//
//   node scripts/content/build-deadball-clubs.mjs           write the clubs into the row
//   node scripts/content/build-deadball-clubs.mjs --check   fail if the row is out of date
//
// It writes `clubs` and nothing else. The league itself is `::teams` in
// data/scripts/baseball.bsm; every club here must be on it.
//
// A crest is layers in a 100-unit box, y down: `layers` is the full drawing, `small` the
// one used under about 34px. The lettering is drawn here as outlines, from the legend
// face's strokes (client/shared/legend-font.js) with serifs and the Tuscan spur added.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';
import { LEGEND_STROKES } from '../../client/shared/legend-font.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ROW = path.join(ROOT, 'content/media_broadcasts/bc_1783289744953.json');

// ── geometry ────────────────────────────────────────────────────────────────────
const n2 = (v) => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? '0' : String(r); };
const TAU = Math.PI * 2;
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
// A polygon, always wound the same way, so any number of them overlapping fill as one
// shape under the nonzero rule.
const poly = (pts) => {
  const p = area(pts) < 0 ? [...pts].reverse() : pts;
  return 'M' + p.map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L') + 'Z';
};
const arcPts = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const ellipsePts = (cx, cy, rx, ry, rot = 0, n = 28) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
  return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
});
// points along a quadratic and a cubic
const qPts = (a, c, b, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]; });
const cPts = (a, c1, c2, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n, u = 1 - t;
  return [u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0], u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1]];
});
const L = (d, fill, more = {}) => ({ d, fill, ...more });

// ── lettering ─────────────────────────────────────────────────────────────────────
// The legend face's strokes (a 4 x 6 grid, y up), drawn as strokes with round caps: the
// upright ones at the full weight and the rest lighter, as a display face's stems and bars
// are. With `serif`, a stem's free end on the baseline or the cap line gets a slab, notched
// in the middle (the forked serif of a Tuscan), and a bar's free end a short beak; with
// `spur`, a full-height stem gets the Tuscan's pointed bulge halfway up. Strokes are a
// fraction of the bytes outlines would be: one club's lettering is a few KB.
//
// A run is { stems, bars, polys, W, B }: segments for the two weights, filled polygons for
// the slabs and spurs, and the two stroke widths.
// The letters a narrow face can't squeeze to the common width and still read: a W's middle
// peak closes up into a V, and a T's bar sinks into its own slab.
const GLYPH_WIDE = { W: 1.4, M: 1.25, T: 1.2 };
const wideOf = (ch, o) => (o.wide ?? 0.7) * (GLYPH_WIDE[ch] || 1);
const run = (h, o) => ({ stems: [], bars: [], polys: [], W: (o.stem ?? 0.2) * h, B: (o.stem ?? 0.2) * h * (o.thin ?? 0.6) });
function glyphInto(R, ch, x0, base, h, o = {}, xf = null) {
  const { serif = false, spur = false } = o, wide = wideOf(ch, o), W = R.W, B = R.B;
  const u = h / 6, gx = (x) => x0 + x * u * wide * 1.5, gy = (y) => base - y * u;
  const T = xf || ((x, y) => [x, y]);
  const seg = (list, x1, y1, x2, y2) => list.push([...T(x1, y1), ...T(x2, y2)]);
  const fill = (pts) => R.polys.push(pts.map(([x, y]) => T(x, y)));
  if (ch === '.') { const s = W * 1.05; fill([[x0 - s / 2, base], [x0 + s / 2, base], [x0 + s / 2, base - s], [x0 - s / 2, base - s]]); return; }
  const strokes = LEGEND_STROKES[ch];
  if (!strokes) return;
  const ends = new Map(), key = (x, y) => `${x},${y}`;
  for (const [a, b, c, d] of strokes) for (const k of [key(a, b), key(c, d)]) ends.set(k, (ends.get(k) || 0) + 1);
  const free = (x, y) => ends.get(key(x, y)) === 1;
  const sH = W * 0.5, nd = sH * 0.55, s = W * 1.05;
  for (const [a, b, c, d] of strokes) {
    let x1 = gx(a), y1 = gy(b), x2 = gx(c), y2 = gy(d);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, vert = Math.abs(y2 - y1) / len;
    const isStem = vert > 0.97;
    if (serif && isStem) {
      for (const [gxv, gyv, which] of [[a, b, 0], [c, d, 1]]) {
        if (!free(gxv, gyv) || (gyv !== 0 && gyv !== 6)) continue;
        const X = gx(gxv), Y = gy(gyv), dir = gyv === 0 ? -1 : 1;
        // the slab flush with the line, notched in its outer edge, with a stub of stem the
        // stroke's round end sits in, so the notch stays open
        fill([[X - s, Y], [X - s * 0.18, Y], [X, Y + dir * nd], [X + s * 0.18, Y], [X + s, Y], [X + s, Y + dir * sH],
          [X + W / 2, Y + dir * sH], [X + W / 2, Y + dir * (sH + W)], [X - W / 2, Y + dir * (sH + W)], [X - W / 2, Y + dir * sH], [X - s, Y + dir * sH]]);
        if (which === 0) y1 = Y + dir * (sH + W / 2); else y2 = Y + dir * (sH + W / 2);
      }
    }
    if (serif && vert < 0.1) {
      // a bar's free end turns down (or up) in a short beak
      for (const [gxv, gyv] of [[a, b], [c, d]]) {
        if (!free(gxv, gyv) || (gxv !== 0 && gxv !== 4)) continue;
        const X = gx(gxv), Y = gy(gyv), dy = gyv >= 3 ? 1 : -1;
        fill([[X - B / 2, Y - dy * B / 2], [X + B / 2, Y - dy * B / 2], [X + B / 2, Y + dy * (B / 2 + W * 0.55)], [X - B / 2, Y + dy * (B / 2 + W * 0.55)]]);
      }
    }
    seg(vert > 0.6 ? R.stems : R.bars, x1, y1, x2, y2);
    if (spur && isStem && Math.abs(d - b) >= 5) {
      const cx = (x1 + x2) / 2, cy = (gy(b) + gy(d)) / 2, p = W * 0.42, q = W * 0.85;
      fill([[cx - W / 2 - p, cy], [cx, cy - q], [cx + W / 2 + p, cy], [cx, cy + q]]);
    }
  }
}
// The advance of a glyph at these settings (the grid is 4 wide; `track` is the gap).
const glyphW = (ch, h, o) => (h / 6) * wideOf(ch, o) * 1.5 * 4;
const advance = (h, o = {}, ch = '') => glyphW(ch, h, o) + (o.stem ?? 0.2) * h + (o.track ?? 0.08) * h;
const charAdv = (ch, h, o) => (ch === ' ' ? advance(h, o) * 0.55 : ch === '.' ? (o.stem ?? 0.2) * h * 1.9 : advance(h, o, ch));
const textWidth = (str, h, o = {}) => [...str].reduce((w, ch) => w + charAdv(ch, h, o), 0) - (o.track ?? 0.08) * h;
// A line of text centred on cx, sitting on `base`.
function text(str, cx, base, h, o = {}) {
  const R = run(h, o);
  let x = cx - textWidth(str, h, o) / 2 + (o.stem ?? 0.2) * h / 2;
  for (const ch of str) {
    if (ch !== ' ') glyphInto(R, ch, ch === '.' ? x + (o.stem ?? 0.2) * h * 0.3 : x, base, h, o);
    x += charAdv(ch, h, o);
  }
  return R;
}
// Text round an arc: each letter stood on the circle, upright to it, the run centred on
// angle `mid` (radians, y down, so -PI/2 is the top).
function arcText(str, cx, cy, r, mid, h, o = {}) {
  const R = run(h, o);
  let s = -textWidth(str, h, o) / 2;
  for (const ch of str) {
    if (ch !== ' ') {
      const gw = glyphW(ch, h, o), a = mid + (s + (o.stem ?? 0.2) * h / 2 + gw / 2) / r;
      const rot = a + Math.PI / 2, c = Math.cos(rot), sn = Math.sin(rot), bx = cx + Math.cos(a) * r, by = cy + Math.sin(a) * r;
      // drawn about its own bottom centre at the origin, then stood on the arc
      glyphInto(R, ch, -gw / 2, 0, h, o, (x, y) => [bx + x * c - y * sn, by + x * sn + y * c]);
    }
    s += charAdv(ch, h, o);
  }
  return R;
}
// A column of letters, one under another, each centred on cx.
function column(str, cx, top, h, gap, o = {}) {
  const R = run(h, o);
  [...str].forEach((ch, i) => {
    const one = text(ch, cx, top + h + i * (h + gap), h, o);
    R.stems.push(...one.stems); R.bars.push(...one.bars); R.polys.push(...one.polys);
  });
  return R;
}
const segsD = (segs) => segs.map(([a, b, c, d]) => `M${n2(a)} ${n2(b)}L${n2(c)} ${n2(d)}`).join('');
// A run as layers in one ink: the stems, the bars, then the slabs and spurs.
function inked(R, ink) {
  const out = [];
  if (R.stems.length) out.push(L(segsD(R.stems), 'none', { stroke: ink, sw: +n2(R.W) }));
  if (R.bars.length) out.push(L(segsD(R.bars), 'none', { stroke: ink, sw: +n2(R.B) }));
  if (R.polys.length) out.push(L(R.polys.map(poly).join(''), ink));
  return out;
}

// ── drawing ─────────────────────────────────────────────────────────────────────
// A path through points (no closing), for a stroked line, and a circle as one.
const lineD = (pts) => 'M' + pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L');
const ringD = (cx, cy, r, n = 48) => lineD(arcPts(cx, cy, r, 0, TAU, n)) + 'Z';
const disc = (cx, cy, r, n = 48) => poly(ellipsePts(cx, cy, r, r, 0, n));
// A smooth path through points, drawn as cubics (Catmull-Rom). A point [x, y, 1] is a corner:
// the curve meets it straight, and two corners in a row are a straight line. A closed path is
// wound as poly() winds.
function curve(pts, closed = true) {
  const p = closed && area(pts) < 0 ? [...pts].reverse() : pts;
  const n = p.length, at = (i) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${n2(p[0][0])} ${n2(p[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = at(i), b = at(i + 1);
    if (a[2] && b[2]) { d += `L${n2(b[0])} ${n2(b[1])}`; continue; }
    const a0 = at(i - 1), b1 = at(i + 2);
    const c1 = a[2] ? [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3] : [a[0] + (b[0] - a0[0]) / 6, a[1] + (b[1] - a0[1]) / 6];
    const c2 = b[2] ? [b[0] - (b[0] - a[0]) / 3, b[1] - (b[1] - a[1]) / 3] : [b[0] - (b1[0] - a[0]) / 6, b[1] - (b1[1] - a[1]) / 6];
    d += `C${n2(c1[0])} ${n2(c1[1])} ${n2(c2[0])} ${n2(c2[1])} ${n2(b[0])} ${n2(b[1])}`;
  }
  return closed ? d + 'Z' : d;
}
// Points along a Catmull-Rom spline through `pts`, `per` to a span.
function spline(pts, per = 6) {
  const n = pts.length, at = (i) => pts[Math.max(0, Math.min(n - 1, i))], out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
// A band along a centre line, `w0` wide at its start tapering to `w1` at its end; a zero end is a point.
function ribbon(c, w0, w1) {
  const left = [], right = [];
  c.forEach((p, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1, w = (w0 + (w1 - w0) * (i / (c.length - 1))) / 2;
    left.push([p[0] - (dy / m) * w, p[1] + (dx / m) * w]);
    right.push([p[0] + (dy / m) * w, p[1] - (dx / m) * w]);
  });
  const end = w1 < 0.05 ? [c[c.length - 1]] : [left[left.length - 1], right[right.length - 1]];
  return [...left.slice(0, -1), ...end, ...right.slice(0, -1).reverse()];
}
// The left half of a figure, top centre to bottom centre, and its mirror: the whole of it.
const mir = (pts, c = 50) => pts.map(([x, y, k]) => (k ? [2 * c - x, y, k] : [2 * c - x, y]));
const sym = (half, c = 50) => [...half, ...mir(half, c).reverse().slice(1, -1)];
// A frame along a line from A to B: at(u, v) is u of the way along it and v units to its right.
function along(A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const at = (u, v = 0) => [A[0] + dx * u - uy * v, A[1] + dy * u + ux * v];
  at.len = len;
  return at;
}
// Every coordinate pair of a path through fn: an affine fn moves a cubic's controls correctly.
const xformD = (d, fn) => d.replace(/(-?[\d.]+)[ ,](-?[\d.]+)/g, (_, x, y) => fn(+x, +y).map(n2).join(' '));
// Gradients in the box's units (club-crest.js draws them): colours spread evenly, or [offset, colour].
const stopsOf = (cs) => cs.map((c, i) => (Array.isArray(c) ? c : [+(i / (cs.length - 1)).toFixed(3), c]));
const lin = (x1, y1, x2, y2, ...cs) => ({ lin: [x1, y1, x2, y2].map((v) => +n2(v)), stops: stopsOf(cs) });
const rad = (cx, cy, r, ...cs) => ({ rad: [cx, cy, r].map((v) => +n2(v)), stops: stopsOf(cs) });
const keyline = (d, ink, sw) => L(d, 'none', { stroke: ink, sw });
// Text round the foot of a circle, upright, reading left to right: the baseline on the circle
// and the letters standing in toward the centre.
function arcTextUnder(str, cx, cy, r, h, o = {}) {
  const R = run(h, o);
  let s = -textWidth(str, h, o) / 2;
  for (const ch of str) {
    if (ch !== ' ') {
      const gw = glyphW(ch, h, o), a = Math.PI / 2 - (s + (o.stem ?? 0.2) * h / 2 + gw / 2) / r;
      const rot = a - Math.PI / 2, c = Math.cos(rot), sn = Math.sin(rot), bx = cx + Math.cos(a) * r, by = cy + Math.sin(a) * r;
      glyphInto(R, ch, -gw / 2, 0, h, o, (x, y) => [bx + x * c - y * sn, by + x * sn + y * c]);
    }
    s += charAdv(ch, h, o);
  }
  return R;
}

// ── the crests ──────────────────────────────────────────────────────────────────

// COLDWATER CROWS. A die-cut red sticker: an arch over a squared body, STILL WATCHING
// round the arch, a crow cawing with its wings half raised and its talons in a bat across the
// middle, COLDWATER CROWS in Tuscan capitals over BASEBALL CLUB, EST. 2022 down the left side
// and DEADBALL down the right. Drawn after a 1909 minor-league sticker.
const CR = { red: '#c8302c', edge: '#6e1416', bat: '#8a1a1b', batHi: '#a52224', ink: '#151113', bone: '#efe9dc', grey: '#8f9296', gloss: '#3b3852' };

// the sticker: the arch's circle, and the body under it with its corners rounded
const ARCH = { cx: 50, cy: 47, r: 43 };
function stickerPts(inset = 0) {
  const r = ARCH.r - inset, x0 = ARCH.cx - r, x1 = ARCH.cx + r, bot = 97 - inset, cr = 9 - inset * 0.6;
  return [
    ...arcPts(ARCH.cx, ARCH.cy, r, Math.PI, TAU, 40),
    [x1, 86 - inset * 0.2],
    ...qPts([x1, bot - cr], [x1, bot], [x1 - cr, bot], 6).slice(1),
    ...qPts([x0 + cr, bot], [x0, bot], [x0, bot - cr], 6),
  ];
}

// The crow, facing left on the bat, beak open, its wing half raised. All of it stays
// inside the arch's lettering (33 units from the arch's centre), as the 1909 bird stays inside its.
const CROW = [
  [33, 25.4], [37, 23.6], [41, 24.8], [44.6, 28.4], [50, 33], [57, 38], [63, 42.4],
  // the tail, wedge-ended and ragged
  [71, 44.4, 1], [76, 46, 1], [72.6, 47.6, 1], [77, 50, 1], [72.6, 50.8, 1], [75, 54, 1], [67, 52.4, 1],
  [61, 50.6], [54, 49], [48, 48.4], [43, 46.2], [39, 42.4],
  // the shaggy throat
  [37.4, 40.6, 1], [38.6, 38.6, 1], [35.8, 38.8, 1], [36.6, 37, 1], [33.6, 36.8, 1], [34.2, 35.2, 1], [31.4, 34.2], [30.6, 32.4],
  [31, 28],
];
const CROW_UPPER = [[33.6, 25.8, 1], [28, 27.4], [22.6, 30.8, 1], [24.4, 31.4, 1], [31.6, 31, 1]];
const CROW_LOWER = [[31, 32.2, 1], [24.6, 36.2, 1], [26.4, 36.8, 1], [32.4, 34.8, 1]];
// the near wing, half raised: the leading edge to the wrist, the primaries swept back with
// rounded tips, and a smooth trailing edge back to the body
const CROW_WING = [
  [42.6, 33], [43.4, 28], [46, 24], [50.6, 21],
  [55.6, 19.4], [57, 21.8, 1], [61.6, 21], [62.4, 23.8, 1], [67, 24.4], [67, 27.2, 1],
  [71.4, 28.6], [70.6, 31.4, 1], [74, 33.6], [72, 36],
  [66, 37.2], [60, 38.8], [54.6, 39.8], [49, 38.6],
];
// the bat, under the crow's feet and behind the lettering: the barrel at the left, the
// handle running down to the knob at the right
const BAT_A = [12, 48.6], BAT_B = [92, 58.4];
const BAT_PROFILE = [[0, 0], [0.006, 2.2], [0.03, 3.4], [0.36, 3.3], [0.62, 1.7], [0.92, 1.25], [0.935, 2.1], [0.975, 2.1], [0.99, 1.2], [1, 0]];
const batFrame = () => {
  const dx = BAT_B[0] - BAT_A[0], dy = BAT_B[1] - BAT_A[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  return (t, w) => [BAT_A[0] + ux * len * t - uy * w, BAT_A[1] + uy * len * t + ux * w];
};
const batPts = () => { const at = batFrame(); return [...BAT_PROFILE.map(([t, w]) => at(t, w)), ...[...BAT_PROFILE].reverse().map(([t, w]) => at(t, -w))]; };
// the shine along the barrel's top
const batShinePts = () => { const at = batFrame(); return [at(0.04, -2.4), at(0.34, -2.4), at(0.5, -1.4), at(0.5, -0.6), at(0.34, -1.3), at(0.04, -1.2)]; };
// legs down to the bat, and the talons hooked over its face
const CROW_LEGS = [[45.6, 46.6, 45.2, 49.4], [50.6, 48, 51, 50.6]];
const CROW_TALONS = [
  [[45.2, 49.4], [42.8, 49.6], [41.4, 51.4], [41.8, 52.6]], [[45.2, 49.4], [44.4, 51.2], [44.4, 53]], [[45.2, 49.4], [47.4, 49.8], [48.2, 51]],
  [[51, 50.6], [48.8, 51.4], [48, 53.2], [48.6, 54.2]], [[51, 50.6], [51, 52.6], [51.8, 54]], [[51, 50.6], [53.2, 51], [54, 52.2]],
];

function crowsCrest() {
  const crow = [CROW, CROW_UPPER, CROW_LOWER, CROW_WING].map((p) => curve(p)).join('');
  const feet = segsD(CROW_LEGS) + CROW_TALONS.map((t) => curve(t, false)).join('');
  // feather detail, in the sticker's red over the ink: the edges of the coverts, the partings
  // between the primaries, the hackles down the throat
  const coverts = [curve([[45, 31], [51, 28.6], [58, 30.4], [64, 33.6], [68, 36]], false), curve([[47, 34.4], [54, 34], [60, 36.8]], false)];
  const shafts = segsD([[52, 26, 57, 21.8], [55, 28, 62.4, 23.8], [58, 30.6, 67, 27.2], [60, 33, 70.6, 31.4]]);
  const hackles = [[[34.6, 33.4], [37, 36.4], [40.4, 39.4]], [[37.6, 31.6], [40.6, 35], [44.6, 38]], [[41, 31.6], [44.6, 35.4], [48.8, 38.6]]].map((p) => curve(p, false)).join('');
  // gloss off the crown, the wing's leading edge and the back, as a crow's black shines blue
  const gloss = [
    [[33.6, 25.4], [37.4, 24.4], [41, 25.8], [37.6, 25.6]],
    [[43.4, 32], [44, 27.6], [46.6, 24.2], [50, 22], [47.6, 25.6], [45.4, 29]],
    [[50, 35], [56, 38.6], [62, 43], [56, 40.4]],
  ].map((p) => curve(p)).join('');
  // the eye, a slit of bone under a brow cut down at the beak
  const eye = curve([[32.8, 28.6, 1], [37, 26.2, 1], [37.4, 27.2], [33.4, 29.2]]);

  const title = { stem: 0.21, thin: 0.5, serif: true, spur: true, track: 0.1 };
  const plain = { stem: 0.2, thin: 0.75, track: 0.12 };
  const tag = { stem: 0.22, thin: 0.7, serif: true, track: 0.06 };
  const lettering = [
    text('COLDWATER', 50, 67, 8.4, { ...title, wide: 0.4 }),
    text('CROWS', 50, 83, 13, { ...title, wide: 0.52 }),
    text('BASEBALL CLUB', 50, 91, 4.4, { ...plain, wide: 0.55 }),
    arcText('STILL WATCHING', ARCH.cx, ARCH.cy, 35.2, -Math.PI / 2, 5.4, { ...plain, wide: 0.62, stem: 0.19, track: 0.2 }),
    text('EST.', 14, 53.4, 3.3, { ...plain, wide: 0.5, stem: 0.22 }),
    column('2022', 14, 56.5, 6.4, 2, { ...tag, wide: 0.55 }),
    column('DEADBALL', 86.4, 47, 4.1, 1.1, { ...tag, wide: 0.6, stem: 0.24 }),
  ].flatMap((R) => inked(R, CR.ink));
  const sticker = rad(50, 40, 62, '#d8403a', CR.red, '#a5221f');
  const bat = lin(40, 49, 42, 58, CR.batHi, CR.bat, '#5e1012');

  return {
    box: 100,
    layers: [
      L(poly(stickerPts(0)), CR.edge),
      L(poly(stickerPts(1.4)), sticker),
      L(poly(batPts()), bat),
      L(poly(batShinePts()), '#b8393a', { op: 0.8 }),
      ...lettering,
      // a ring of red round the bird, so where it meets the lettering it reads as cut out
      keyline(crow + feet, CR.red, 2.4),
      L(crow, CR.ink),
      keyline(feet, CR.ink, 1.1),
      L(gloss, CR.gloss, { op: 0.9 }),
      keyline(coverts.join('') + shafts + hackles, CR.red, 0.45),
      L(eye, CR.bone),
    ],
    // under 34px: the sticker, the bat and the bird, no words
    small: [
      L(poly(stickerPts(0)), CR.edge),
      L(poly(stickerPts(2.4)), sticker),
      L(poly(batPts()), CR.bat),
      L(crow, CR.ink),
      keyline(feet, CR.ink, 1.6),
      L(eye, CR.bone),
    ],
  };
}

// BASIN BLUE BIRDS. A night-blue roundel ringed in royal and red, two ash bats crossed behind, and
// on it a blue jay's head in profile: the crest raised in three swept feathers, a short black beak
// open on a red mouth, the black bridle cut down over a red-ringed eye, the pale cheek inside the
// black necklace. A red banner across its foot reads BLUE BIRDS, with three stars under it. The
// colours are the Blue Jays' City Connect ("Night Mode") set, matched by eye: pitch blue, hyper
// royal, speed red.
const BB = { pitch: '#0d1b2e', royal: '#1d55d8', red: '#e0243a', white: '#f3f5f9', grey: '#9aa0a8', deep: '#0f2f86', maw: '#5a0c18', ash: '#e6cf9f' };
// The head is drawn in its own 100-unit frame and set into the roundel by JAY_AT.
const JAY = [
  [37, 40.6], [38.4, 33], [42.6, 25], [49, 17], [56, 10],
  // the crest, raised: three feathers swept back
  [64, 4.4, 1], [65.8, 10.6, 1], [74.4, 7.6, 1], [72.4, 15, 1], [82.6, 14.4, 1],
  // the back of the head and the nape, down to the cut
  [80.4, 21.6], [84.6, 30], [87.4, 41], [87.6, 53], [86.2, 64], [89, 78], [93, 90, 1],
  [74, 92.4], [55, 90, 1],
  // the throat up to the beak
  [50, 80], [43.6, 70], [39, 60], [37, 51],
];
// the beak, short and stout, its lower half dropped
const JAY_UPPER = [[37.4, 40.4, 1], [30, 41.6], [23.6, 43.6], [18.6, 46.4, 1], [24, 47], [30.4, 46.8], [37.6, 46.6, 1]];
const JAY_LOWER = [[37, 48.6, 1], [30, 50], [23, 51], [19.6, 51.6, 1], [24.4, 53.6], [31, 54], [37.6, 53.4, 1]];
const JAY_MAW = [[37.6, 45.6], [19, 47], [20, 51.4], [37.6, 49.4]];
// the pale cheek, and the black necklace under it
const JAY_FACE = [[37.6, 46], [44, 45], [52, 43.4], [60, 42], [66, 43], [69, 48], [68, 55], [62, 60], [54, 62], [46, 61], [41, 58], [38, 53]];
const JAY_COLLAR = [[67, 41.6], [70.2, 49], [67.4, 57], [59.4, 62.6], [50, 63.6], [43, 61], [38.6, 55.6]];
// the breast under the necklace, greyed blue
const JAY_BREAST = [[38.6, 56], [44, 62], [52, 64.6], [62, 63], [69, 58], [70, 70], [66, 80], [63, 91, 1], [55, 90, 1], [50, 80], [43.6, 70], [39.6, 61]];
// the bridle, from the beak back over the eye, tapering to a point
const JAY_BRIDLE = [[35.6, 40.4, 1], [46, 35.6], [57, 32.6], [64, 32.4, 1], [56, 37], [47, 40.6], [38.4, 45, 1]];
const JAY_SHEEN = [[42, 30], [48, 21], [57, 12], [62, 8, 1], [58, 16], [51, 24], [45, 32]];
const JAY_K = 0.72, JAY_AT = (x, y) => [50 + (x - 56) * JAY_K, 45 + (y - 48) * JAY_K];
// the banner across the foot, its tails folded behind
const BANNER = [[21, 65.6], [50, 67.6], [79, 65.6, 1], [79, 76.6, 1], [50, 78.6], [21, 76.6, 1]];
const BANNER_TAIL = [[24, 69.6, 1], [15, 69.6, 1], [18, 75.2, 1], [15, 80.8, 1], [24, 80.8, 1]];
const BANNER_FOLD = [[21, 76.6, 1], [24, 76.6, 1], [24, 80.8, 1]];
const star = (cx, cy, r) => poly(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r * 0.42 : r; return [cx + Math.cos(a) * q, cy + Math.sin(a) * q]; }));
// a bat laid from its knob at A to its barrel's end at B
const batAlong = (A, B) => {
  const at = along(A, B), prof = [[0, 0], [0.01, 1.9], [0.045, 1.9], [0.06, 1], [0.38, 1.25], [0.72, 2.7], [0.97, 2.9], [1, 0]];
  return [...prof.map(([u, w]) => at(u, -w)), ...[...prof].reverse().map(([u, w]) => at(u, w))];
};

function blueBirdsCrest() {
  const J = (d) => xformD(d, JAY_AT);
  const head = J(curve(JAY)), upper = J(curve(JAY_UPPER)), lower = J(curve(JAY_LOWER)), all = head + upper + lower;
  const g = (x1, y1, x2, y2, ...cs) => lin(...JAY_AT(x1, y1), ...JAY_AT(x2, y2), ...cs);
  const roundel = rad(50, 36, 54, '#1f3d6c', BB.pitch);
  const blue = g(55, 4, 80, 90, '#5a8dff', BB.royal, BB.deep);
  const face = g(40, 42, 66, 62, '#ffffff', '#d3dbe8');
  const breast = g(44, 60, 64, 90, '#9fb0cf', '#5f74a0');
  const beak = g(24, 40, 28, 54, '#4c5566', '#14181f');
  const [ex, ey] = JAY_AT(48.4, 42.6);
  const iris = rad(ex, ey - 0.2, 2.6, '#ff6a3a', BB.red, '#5a0010');
  // the crest's feathers parted, and the nape's
  const feathers = J(segsD([[48, 24, 62, 8], [56, 24, 71.6, 10.4], [62, 26, 79.6, 16.4]])
    + curve([[78, 30], [81, 40], [80, 50]], false) + curve([[82, 56], [84, 66], [86, 76]], false) + curve([[60, 30], [68, 32], [76, 34]], false));
  const bats = poly(batAlong([30, 74], [79, 23])) + poly(batAlong([70, 74], [21, 23]));
  const tails = poly(BANNER_TAIL) + poly(mir(BANNER_TAIL)), folds = poly(BANNER_FOLD) + poly(mir(BANNER_FOLD));
  const banner = curve(BANNER);
  const title = inked(text('BLUE BIRDS', 50, 75.4, 6.2, { stem: 0.21, thin: 0.55, serif: true, track: 0.12, wide: 0.46 }), BB.white);
  const stars = star(40, 85.4, 2.6) + star(50, 87.4, 3) + star(60, 85.4, 2.6);
  return {
    box: 100,
    layers: [
      L(disc(50, 50, 46), roundel),
      keyline(ringD(50, 50, 44), BB.royal, 2.4),
      keyline(ringD(50, 50, 40.6), BB.red, 0.9),
      keyline(bats, BB.pitch, 2),
      L(bats, lin(20, 20, 80, 80, '#f4e2bb', BB.ash, '#a77e4c')),
      // a white keyline round the head, so it reads cut out against the bats
      keyline(all, BB.white, 4.6),
      keyline(all, BB.pitch, 2.2),
      L(head, blue),
      L(J(curve(JAY_SHEEN)), '#8db4ff', { op: 0.45 }),
      keyline(feathers, BB.deep, 0.7),
      L(J(curve(JAY_BREAST)), breast),
      L(J(curve(JAY_FACE)), face),
      keyline(J(curve(JAY_COLLAR, false)), BB.pitch, 2.4),
      L(J(poly(JAY_MAW)), BB.maw),
      L(lower, beak),
      L(upper, beak),
      keyline(J(curve([[36.4, 41.6], [28, 43], [21, 45.6]], false)), '#7d8899', 0.6),
      L(disc(ex, ey, 2.5, 16), iris),
      L(disc(ex - 0.1, ey + 0.1, 1.4, 12), '#05080e'),
      L(disc(ex - 0.7, ey - 0.6, 0.45, 8), '#ffffff'),
      L(J(curve(JAY_BRIDLE)), BB.pitch),
      // the banner over the neck's cut
      L(tails, '#9c1426'),
      L(folds, '#5e0a16'),
      keyline(banner, BB.white, 1.6),
      L(banner, lin(50, 65, 50, 79, '#ff4a5c', BB.red, '#a8122a')),
      ...title,
      L(stars, BB.white),
    ],
    // under 34px: the roundel, the head in its necklace, the beak, the eye and the banner
    small: [
      L(disc(50, 50, 46), BB.pitch),
      keyline(ringD(50, 50, 43.6), BB.royal, 3),
      keyline(all, BB.white, 3.6),
      L(head, BB.royal),
      L(J(curve(JAY_FACE)), BB.white),
      keyline(J(curve(JAY_COLLAR, false)), BB.pitch, 3),
      L(J(poly(JAY_MAW)), BB.red),
      L(lower, BB.pitch),
      L(upper, BB.pitch),
      L(disc(ex, ey, 2.6, 12), BB.red),
      L(J(curve(JAY_BRIDLE)), BB.pitch),
      L(tails + banner, BB.red),
    ],
  };
}

// BOOMTOWN BOMBERS. A navy roundel in pinstripes, ringed in white, and diving through it an
// aerial bomb in gunmetal: a shark's mouth painted on its nose under an angry eye, the club's
// script B on its flank, yellow bands at the tail, its fins boxed, speed lines behind it.
const BO = { navy: '#0c2340', white: '#f4f4f0', grey: '#9ea2a6', red: '#c8202c', spark: '#ffb81c', maw: '#4a0810', steel: '#5c646e' };
const BOMB = along([21, 78], [81, 20]);
// the body's half-width along it, nose to tail cone
const BOMB_W = [[0, 0], [0.012, 4.6], [0.045, 9], [0.11, 11.8], [0.24, 12.8], [0.5, 12.4], [0.62, 11.2], [0.72, 8], [0.8, 4.4], [0.84, 3.6]];
const BOMB_BODY = [
  ...BOMB_W.slice(1).map(([u, w], i, a) => (i === a.length - 1 ? [...BOMB(u, -w), 1] : BOMB(u, -w))),
  ...[...BOMB_W].reverse().map(([u, w], i) => (i === 0 ? [...BOMB(u, w), 1] : BOMB(u, w))),
];
const bombFin = (s) => [[0.7, 8.6], [0.88, 15.5], [1, 15.5], [1, 3.6], [0.84, 3.6]].map(([u, v]) => [...BOMB(u, s * v), 1]);
const bombBand = (u0, u1, w) => poly([BOMB(u0, -w), BOMB(u1, -w), BOMB(u1, w), BOMB(u0, w)]);
// the shark's mouth along the nose's underside: the upper lip from the nose's tip back to the
// corner, the lower lip from the corner forward again
const LIP_UP = [[0.02, 0.4], [0.1, 2.2], [0.2, 3.4], [0.31, 5.6]];
const LIP_DN = [[0.31, 5.6], [0.22, 8.4], [0.13, 10.2], [0.06, 9.8]];
const lipV = (lip, u) => {
  const s = [...lip].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < s.length - 1; i++) if (u <= s[i + 1][0]) return s[i][1] + (s[i + 1][1] - s[i][1]) * ((u - s[i][0]) / (s[i + 1][0] - s[i][0]));
  return s[s.length - 1][1];
};
// the script B, as on the home jersey
const SCRIPT_B = 'M37 44C43 36 60 34 60 43C60 50 50 53 45 54C57 53 64 58 61 66C58 74 45 77 39 72C35 69 38 64 42 67'
  + 'M47 39C46 50 44 62 40 75C38 80 33 79 34 76';

function bombersCrest() {
  const body = curve(BOMB_BODY);
  const fins = poly(bombFin(-1)) + poly(bombFin(1));
  const mouth = curve([
    [...BOMB(...LIP_UP[0]), 1], BOMB(...LIP_UP[1]), BOMB(...LIP_UP[2]), [...BOMB(...LIP_UP[3]), 1],
    BOMB(...LIP_DN[1]), BOMB(...LIP_DN[2]), [...BOMB(...LIP_DN[3]), 1], BOMB(0.03, 6),
  ]);
  const teeth = [];
  for (let k = 0; k < 7; k++) {
    const u = 0.045 + k * 0.038, du = 0.017;
    teeth.push([BOMB(u - du, lipV(LIP_UP, u - du)), BOMB(u + du, lipV(LIP_UP, u + du)), BOMB(u, lipV(LIP_UP, u) + 2.6)]);
    if (u > 0.07 && u < 0.29) teeth.push([BOMB(u - du, lipV(LIP_DN, u - du)), BOMB(u + du, lipV(LIP_DN, u + du)), BOMB(u, lipV(LIP_DN, u) - 2.6)]);
  }
  const eye = curve([[...BOMB(0.19, -1.2), 1], BOMB(0.25, -4.4), BOMB(0.33, -4.8), [...BOMB(0.355, -2.6), 1], BOMB(0.29, 0.2), BOMB(0.23, 0.4)]);
  const brow = curve([[...BOMB(0.17, -3.2), 1], [...BOMB(0.37, -7.8), 1], [...BOMB(0.375, -5.6), 1], [...BOMB(0.19, -1.2), 1]]);
  const s = 0.34, bAt = (x, y) => BOMB(0.5 + ((x - 49) * s) / BOMB.len, (y - 57.5) * s);
  const B = xformD(SCRIPT_B, bAt);
  const rivets = Array.from({ length: 7 }, (_, i) => disc(...BOMB(0.665, -9 + i * 3), 0.55, 6)).join('');
  const stripes = Array.from({ length: 11 }, (_, i) => { const x = 15 + i * 7, h = Math.sqrt(43 * 43 - (x - 50) ** 2); return [x, 50 - h, x, 50 + h]; });
  const speed = segsD([[...BOMB(0.62, -18), ...BOMB(0.96, -18)], [...BOMB(0.7, -22.5), ...BOMB(0.9, -22.5)], [...BOMB(0.66, 17.5), ...BOMB(0.94, 17.5)], [...BOMB(0.74, 22), ...BOMB(0.88, 22)]]);
  const steel = lin(...BOMB(0.4, -13), ...BOMB(0.4, 13), [0, '#c6cdd5'], [0.22, '#848c97'], [0.6, '#3c424a'], [1, '#14171b']);
  const finSteel = lin(...BOMB(0.9, -15), ...BOMB(0.9, 15), '#9aa2ac', '#3a4048', '#16191d');
  return {
    box: 100,
    layers: [
      L(disc(50, 50, 47), rad(50, 42, 52, '#18375f', BO.navy)),
      keyline(segsD(stripes), '#1a355c', 0.7),
      keyline(ringD(50, 50, 44.6), BO.white, 2.2),
      keyline(ringD(50, 50, 41.6), BO.grey, 0.6),
      keyline(speed, BO.white, 1.2),
      keyline(body + fins, '#06101e', 2.6),
      L(fins, finSteel),
      L(poly([BOMB(0.76, -1.3), BOMB(1, -1.3), BOMB(1, 1.3), BOMB(0.76, 1.3)]), '#2a2f36'),
      L(poly([BOMB(0.93, -15.8), BOMB(1, -15.8), BOMB(1, 15.8), BOMB(0.93, 15.8)]), finSteel),
      keyline(segsD([[...BOMB(0.93, -15.8), ...BOMB(0.93, 15.8)]]), '#c6cdd5', 0.6),
      L(body, steel),
      L(bombBand(0.565, 0.585, 12.3) + bombBand(0.6, 0.62, 11.6), BO.spark),
      L(rivets, '#d5dbe1'),
      L(mouth, BO.maw),
      L(teeth.map(poly).join(''), BO.white),
      keyline(mouth, BO.red, 1),
      L(eye, '#f6f1e2'),
      L(disc(...BOMB(0.25, -1.8), 1.9, 12), '#0b0d10'),
      L(disc(...BOMB(0.244, -2.5), 0.55, 6), '#f6f1e2'),
      L(brow, '#0b0d10'),
      keyline(B, BO.navy, 3),
      keyline(B, BO.white, 1.5),
    ],
    small: [
      L(disc(50, 50, 47), BO.navy),
      keyline(ringD(50, 50, 44), BO.white, 3),
      keyline(body + fins, '#06101e', 3),
      L(fins, '#59616b'),
      L(body, steel),
      L(mouth, BO.maw),
      L(teeth.map(poly).join(''), BO.white),
      L(eye, '#f6f1e2'),
      L(brow, '#0b0d10'),
      L(bombBand(0.56, 0.62, 12), BO.spark),
    ],
  };
}

// ── the sock ──────────────────────────────────────────────────────────────────────
// Both Sox clubs' sock, one silhouette: a ribbed cuff, the calf's curve, a heel cup and the toe
// kicked out to the right. Drawn in its own frame, y down, the cuff's top centre at the origin,
// 48 units tall; sockAt() stands it in a crest.
const SOCK_SHAPE = (torn) => [
  [-7.4, 0, 1], [7.4, 0, 1],
  // the shin, then the instep out to the toe
  [7, 3.4], [6.4, 10], [6.2, 20], [5.8, 28], [8.4, 32.6], [14, 35.4], [21, 37.6],
  ...(torn
    // the toe torn open
    ? [[26.4, 39.4, 1], [28.6, 41.4, 1], [26.8, 42.8, 1], [29.4, 44.6, 1], [27, 46, 1], [28.4, 47.6, 1]]
    : [[27, 39.6], [31.6, 42.2], [33, 44.6], [31.4, 46.8]]),
  // the sole and the heel, then up the back of the leg over the calf
  [24, 47.8], [14, 47.6], [4, 47.4], [-3, 46.8], [-7.4, 43.6], [-8.6, 38], [-7.4, 31], [-6.6, 26], [-8.4, 17], [-9, 10], [-8, 4],
];
const SOCK_HEEL = [[-8.6, 38], [-7.4, 43.6], [-3, 46.8], [4, 47.4], [3, 43], [-1, 39.6], [-5.6, 36.4]];
const SOCK_TOE = [[27, 39.6], [31.6, 42.2], [33, 44.6], [31.4, 46.8], [25, 47.8], [24.4, 44], [25.4, 41]];
// a team band round the leg at y0..y1, bowed a touch as it goes round
const sockBandPts = (y0, y1, xl, xr) => [[xl, y0, 1], [-1, y0 + 0.8], [xr, y0, 1], [xr - 0.1, y1, 1], [-1, y1 + 0.8], [xl - 0.2, y1, 1]];
const sockAt = (ox, oy, k, rot) => { const c = Math.cos(rot), s = Math.sin(rot); return (x, y) => [ox + (x * c - y * s) * k, oy + (x * s + y * c) * k]; };
// The sock's parts through a placement: the outline, the two bands, the heel and toe, the cuff's
// ribs, the folds at the ankle and a shine down the shin.
function sockParts(at, torn = false) {
  const pts = (p) => p.map(([x, y, f]) => (f ? [...at(x, y), f] : at(x, y)));
  const open = (p) => curve(pts(p), false);
  return {
    outline: curve(pts(SOCK_SHAPE(torn))),
    bands: [curve(pts(sockBandPts(6, 8.8, -8.6, 6.9))), curve(pts(sockBandPts(10.8, 13.6, -9, 6.5)))],
    heel: curve(pts(SOCK_HEEL)),
    toe: curve(pts(SOCK_TOE)),
    ribs: [-5, -2.5, 0, 2.5, 5].map((x) => open([[x, 0.6], [x, 3.6]])).join(''),
    cuffLine: open([[-8, 4], [-1, 4.8], [7, 3.4]]),
    folds: open([[-6.4, 29], [-1, 31], [4, 30.4]]) + open([[-5, 33.4], [0, 34.8], [6.4, 33]]) + open([[10, 35.4], [14, 38], [16, 41.6]]),
    shine: curve(pts([[2.4, 16], [4.4, 15.6], [4.4, 26], [6.4, 31], [3.6, 30], [2.2, 24]])),
  };
}

// WESTSIDE WHITE SOX. A black roundel ringed in silver, WESTSIDE round its foot, and a gloved
// fist in a studded cuff swinging a white sock with a padlock in it, the lock bursting out
// through the torn toe, blood flying off it. Black, silver and white.
const WS = { black: '#1b1b1d', silver: '#c4ced4', white: '#f4f4f0', grey: '#9aa0a6', blood: '#a3141c' };
const WS_SOCK = sockAt(40, 29, 1.05, -0.22);
// the padlock, in its own frame (y down, the body's centre at the origin), tipped back, in the toe
const LOCK_AT = (() => { const [cx, cy] = WS_SOCK(31.4, 43.4), a = -0.34, c = Math.cos(a), s = Math.sin(a); return (x, y) => [cx + (x * c - y * s) * 0.8, cy + (x * s + y * c) * 0.8]; })();
// the fist from the front, the fingers curled toward us: a knuckle for each down its right side
const GLOVE = [[34, 15.6], [40, 12.4], [48, 11.8], [55.4, 13], [59.4, 15.4], [60.4, 18], [58.6, 19.8, 1], [60.8, 21.8], [60.8, 24.2], [58.8, 25.4, 1], [60.6, 27.4], [60.2, 29.8], [58, 31, 1], [58.8, 32.8], [56.6, 34.6], [48, 35], [38, 34.4], [33.4, 31.2], [32.2, 25], [32.4, 19]];
const THUMB = [[31.6, 15], [38, 12.6], [47, 15], [51, 17.4], [48, 19.4], [38, 18.6], [32, 18.4]];
// the forearm up from the fist to the ring, cut along the ring so it comes from behind it
const armPts = (y0, r = 45.2) => {
  const yc = (x) => 50 - Math.sqrt(r * r - (x - 50) ** 2), a = (x) => Math.atan2(yc(x) - 50, x - 50);
  return [[37.6 - (17 - y0) * 0.2, y0, 1], ...arcPts(50, 50, r, a(35.2), a(50.4), 6).map(([x, y]) => [x, y, 1]), [52.4 - (17 - y0) * 0.2, y0, 1]];
};

function whiteSoxCrest() {
  const lettering = inked(arcTextUnder('WESTSIDE', 50, 50, 41, 6.4, { stem: 0.2, thin: 0.7, wide: 0.6, track: 0.22 }), WS.silver);
  const sock = sockParts(WS_SOCK, true);
  const lockBody = curve([[-6.6, -4.2], [0, -5], [6.6, -4.2], [7, 3], [5.6, 5.4], [0, 5.8], [-5.6, 5.4], [-7, 3]].map(([x, y]) => LOCK_AT(x, y)));
  const shackle = curve([[-3.8, -4.6], [-3.8, -9.6], [-2.4, -12.6], [0, -13.4], [2.4, -12.6], [3.8, -9.6], [3.8, -4.6]].map(([x, y]) => LOCK_AT(x, y)), false);
  const keyhole = disc(...LOCK_AT(0, 0), 1.1, 8) + poly([LOCK_AT(-0.5, 0.4), LOCK_AT(0.5, 0.4), LOCK_AT(0.7, 2.8), LOCK_AT(-0.7, 2.8)]);
  const arm = curve(armPts(17)), cuff = curve(armPts(12.6));
  const studs = [38.6, 42.4, 46.2, 50].map((x) => disc(x - 0.6, 9.6, 1.3, 8)).join('');
  const knuckles = [[[35, 19.8], [46, 20.8], [58.6, 19.8]], [[34.6, 25.4], [46, 26.2], [58.8, 25.4]], [[35, 30.8], [46, 31.4], [58, 31]]].map((p) => curve(p, false)).join('');
  const shine = [[[53, 14.4], [57, 15.6], [59, 17.8]], [[55, 21.2], [58.6, 21.8], [59.8, 23.4]], [[55, 26.8], [58.4, 27.4], [59.4, 29]], [[53, 32.2], [56.4, 32.6], [57.6, 33.6]]].map((p) => curve(p, false)).join('');
  const swing = curve(arcPts(46, 22, 44, 0.2, 0.62, 8), false) + curve(arcPts(46, 22, 50, 0.24, 0.56, 8), false);
  const [lx, ly] = LOCK_AT(8, -3);
  const drops = curve([[lx + 2, ly - 3], [lx + 4.6, ly - 1.6], [lx + 3.4, ly + 0.4], [lx + 1.6, ly - 0.6]]) + disc(lx + 5.4, ly + 5, 1.3, 8) + disc(lx + 2.6, ly + 11, 1.1, 8) + disc(lx + 6.6, ly + 9.4, 0.7, 6);
  const glove = lin(36, 12, 56, 34, '#56595f', '#26282c', '#0e0f11');
  const wool = lin(...WS_SOCK(-9, 10), ...WS_SOCK(8, 10), '#ffffff', '#eceae4', '#a9adb2');
  const steel = lin(...LOCK_AT(0, -5), ...LOCK_AT(0, 6), '#d9dee3', '#848b93', '#3c4147');
  return {
    box: 100,
    layers: [
      L(disc(50, 50, 47), rad(50, 44, 50, '#2e2f33', WS.black)),
      keyline(swing, WS.silver, 1.1),
      ...lettering,
      // the lock, under the sock it's bursting out of
      keyline(lockBody + shackle, '#0c0c0e', 4.2),
      keyline(shackle, '#b9c2ca', 2.4),
      L(lockBody, steel),
      L(keyhole, '#101114'),
      L(drops, WS.blood),
      L(sock.outline, wool),
      L(sock.shine, '#ffffff', { op: 0.7 }),
      keyline(sock.ribs + sock.folds, '#b7bbc0', 0.6),
      L(sock.bands.join('') + sock.heel, WS.black),
      keyline(sock.cuffLine, '#b7bbc0', 0.6),
      keyline(sock.outline, '#050506', 1.6),
      // the arm, the studded cuff and the fist over the sock's top
      L(arm, glove),
      L(cuff, '#121315'),
      keyline(segsD([[34.8, 12.8, 49.8, 12.8]]), '#6b7076', 0.8),
      L(studs, rad(43, 8.6, 5, '#ffffff', WS.silver, '#5a6066')),
      keyline(curve(GLOVE), WS.silver, 2.2),
      L(curve(GLOVE), glove),
      keyline(knuckles, '#050506', 0.9),
      keyline(shine, '#8d949b', 0.7),
      L(curve(THUMB), '#3a3d42'),
      keyline(curve(THUMB), '#050506', 0.6),
      keyline(ringD(50, 50, 44.6), WS.silver, 2),
    ],
    small: [
      L(disc(50, 50, 47), WS.black),
      L(lockBody, '#9aa2aa'),
      keyline(shackle, '#9aa2aa', 2.6),
      L(sock.outline, WS.white),
      L(sock.bands.join('') + sock.heel, WS.black),
      L(arm, '#2a2c30'),
      keyline(curve(GLOVE), WS.silver, 2.4),
      L(curve(GLOVE), '#2a2c30'),
      keyline(ringD(50, 50, 44), WS.silver, 3),
    ],
  };
}

// RUSTPILE RED SOX. A rusted cog round a navy disc, RUSTPILE round its foot in white, and a red
// sock hung on a rusted meat hook through its cuff, chained from the top, soaked and dripping.
// Red, navy and white.
const RS = { red: '#bd3039', navy: '#0c2340', white: '#f4f4f0', grey: '#9ea2a6', rust: '#8a4a24', rustDk: '#5e3016' };
const COG = (() => { const out = []; for (let i = 0; i < 12; i++) { const a0 = (i / 12) * TAU, a1 = ((i + 0.5) / 12) * TAU; for (const [a, r] of [[a0, 41], [a0 + 0.06, 47], [a1 - 0.06, 47], [a1, 41]]) out.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]); } return out; })();
const RS_SOCK = sockAt(40, 25, 0.88, 0.04);
// the hook, whole and in front: down from its eye, round under, its point up into the cuff
const HOOK = spline([[47.4, 11.6], [47.6, 19.4], [47, 27], [44.6, 31.8], [40.6, 32], [38.4, 28.8], [38.4, 25]], 5);

function redSoxCrest() {
  const lettering = inked(arcTextUnder('RUSTPILE', 50, 50, 36.4, 5.4, { stem: 0.2, thin: 0.7, wide: 0.6, track: 0.2 }), RS.white);
  const sock = sockParts(RS_SOCK);
  const pits = [[20, 30], [74, 22], [84, 62], [30, 84], [62, 88], [12, 56], [88, 40], [40, 12]].map(([x, y]) => disc(50 + (x - 50) * 1.02, 50 + (y - 50) * 1.02, 1.1, 6)).join('');
  const bolts = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * TAU + 0.26; return disc(50 + Math.cos(a) * 43.8, 50 + Math.sin(a) * 43.8, 1.2, 8); }).join('');
  const chain = curve([[45.4, 1.6], [49.4, 1.6], [49.8, 4.6], [47.4, 6.2], [45, 4.6]]) + segsD([[47.4, 6.2, 47.4, 7.6]]);
  const hook = poly(ribbon(HOOK, 3.2, 0));
  // drips off the sole and the toe
  const drips = [[18, 47.6, 3.8], [26, 47.6, 3], [8, 47.4, 2.4]].map(([x, y, h]) => { const [px, py] = RS_SOCK(x, y); return curve([[px - 1.1, py - 0.8], [px + 1.1, py - 0.8], [px + 0.9, py + h * 0.6], [px, py + h, 1], [px - 0.9, py + h * 0.6]]); }).join('')
  const wool = lin(...RS_SOCK(-9, 20), ...RS_SOCK(30, 40), '#e04a52', RS.red, '#6e0f17');
  const rust = rad(46, 40, 52, '#b7672f', RS.rust, RS.rustDk);
  const iron = lin(40, 20, 50, 24, '#7a4a2c', '#b98a64', '#4a2a16');
  return {
    box: 100,
    layers: [
      L(poly(COG), rust),
      L(pits, '#3e1e0c', { op: 0.8 }),
      keyline(ringD(50, 50, 43.4), RS.rustDk, 1.2),
      L(bolts, '#c27b45'),
      L(disc(50, 50, 38.6), rad(50, 42, 44, '#183660', RS.navy)),
      keyline(ringD(50, 50, 38.6), '#2a1408', 1.2),
      ...lettering,
      keyline(chain, '#2a1408', 3),
      keyline(chain, '#a06640', 1.6),
      L(disc(47.4, 9.8, 2.4, 12), 'none', { stroke: '#a06640', sw: 1.6 }),
      keyline(sock.outline, RS.white, 2.6),
      L(sock.outline, wool),
      L(sock.shine, '#ff8a90', { op: 0.4 }),
      keyline(sock.ribs + sock.folds, '#7a121a', 0.6),
      L(sock.bands[0], RS.white),
      L(sock.bands[1] + sock.heel + sock.toe, RS.navy),
      keyline(sock.cuffLine, '#7a121a', 0.6),
      keyline(sock.outline, '#2a0508', 1.2),
      L(drips, '#8e0f18'),
      keyline(hook, '#1c0d05', 1.4),
      L(hook, iron),
      // the tear where the point goes into the wool
      L(curve([[36.8, 25.6], [38.4, 24], [40, 25.8], [38.4, 26.8]]), '#3a0a0e'),
    ],
    small: [
      L(poly(COG), RS.rust),
      L(disc(50, 50, 38.6), RS.navy),
      keyline(segsD([[47.4, 2, 47.4, 10]]), '#a06640', 2.4),
      L(sock.outline, RS.red),
      L(sock.bands[0], RS.white),
      L(sock.heel + sock.toe, RS.navy),
      L(hook, '#a06640'),
      L(drips, '#8e0f18'),
    ],
  };
}

// MARQUEE MASTODONS. A dark disc in a maroon ring set with lamps, as the Marquee's fronts are,
// and charging out of it a mastodon head-on: the shaggy dome, the ears flared, small eyes
// burning under a heavy brow, the mouth open either side of the trunk, the trunk curled, and
// two ivory tusks sweeping out past the ring. Maroon, grey and white.
const MM = { maroon: '#6d1f2f', dark: '#4a1420', grey: '#8e9196', light: '#c9cbce', ivory: '#efe6d2', bulb: '#ffe8a8', deep: '#2a0810' };
const MAST_EAR = [[33, 22], [22, 17.6], [12, 22], [6.6, 32], [7.6, 44], [12, 54], [20, 60], [30, 58], [34, 48]];
const MAST_HEAD = [
  [50, 9.6, 1],
  // the shag on the crown
  [46, 12.4, 1], [44, 7.6, 1], [41, 12.6, 1], [37.6, 9.6, 1], [36.6, 14.8, 1], [32.4, 13.8, 1], [32.4, 19.4],
  [28.6, 26], [27, 34], [27.4, 42], [29, 50],
  // the fringe off the cheeks
  [26.6, 55.6, 1], [31, 55.6, 1], [29.6, 60.6, 1], [34, 59, 1], [34, 64.4, 1], [38, 61.6, 1], [40.4, 66.4, 1], [42.6, 61], [46, 60], [50, 60],
];
const MAST_TUSK = spline([[39.6, 60], [32, 69.4], [22, 72.4], [13, 66.4], [8.6, 55], [10.6, 40.6]], 6);
const MAST_TRUNK = spline([[50, 40], [50, 52], [50.6, 64], [49, 74], [44.6, 81], [38.6, 82.6], [35.4, 78.6], [38, 75.2], [41.2, 77.2]], 5);
const MAST_BROW = [[30.4, 32.6, 1], [46.8, 38.2, 1], [46.2, 42, 1], [32, 37.4]];
const MAST_EYE = [[34.8, 38.6], [44.2, 41.4, 1], [42, 43.8], [37, 43]];
const MAST_MAW = [[44.2, 57.6], [40.4, 60.6], [40.8, 66], [44.4, 68.6], [45.8, 64]];

function mastodonsCrest() {
  const bulbs = Array.from({ length: 20 }, (_, i) => { const a = (i / 20) * TAU; return disc(50 + Math.cos(a) * 45, 50 + Math.sin(a) * 45, 1.5, 8); }).join('');
  const glow = Array.from({ length: 20 }, (_, i) => { const a = (i / 20) * TAU; return disc(50 + Math.cos(a) * 45, 50 + Math.sin(a) * 45, 2.6, 10); }).join('');
  const ears = curve(MAST_EAR) + curve(mir(MAST_EAR));
  const head = curve(sym(MAST_HEAD));
  const tusks = poly(ribbon(MAST_TUSK, 6, 0)) + poly(mir(ribbon(MAST_TUSK, 6, 0)));
  const trunk = poly(ribbon(MAST_TRUNK, 12.4, 3.2));
  const brows = curve(MAST_BROW) + curve(mir(MAST_BROW)), eyes = curve(MAST_EYE) + curve(mir(MAST_EYE));
  const maws = curve(MAST_MAW) + curve(mir(MAST_MAW));
  // the tusks' growth rings, across them at a few points
  const rings = [10, 16, 22].map((i) => { const [x, y] = MAST_TUSK[i], [x2, y2] = MAST_TUSK[i + 1], dx = x2 - x, dy = y2 - y, m = Math.hypot(dx, dy), w = 2.6 * (1 - i / MAST_TUSK.length); return [x - (dy / m) * w, y + (dx / m) * w, x + (dy / m) * w, y - (dx / m) * w]; });
  const tuskRings = segsD([...rings, ...rings.map(([a, b, c, d]) => [100 - a, b, 100 - c, d])]);
  const wrinkles = Array.from({ length: 6 }, (_, i) => { const y = 47 + i * 4.4, hw = 5.8 - i * 0.5; return curve([[50 - hw, y], [50, y + 1.2], [50 + hw, y]], false); }).join('');
  const shagHalf = [[44, 12, 42.4, 22], [40, 14, 36.6, 24], [47.6, 13, 47, 24], [36, 18, 32.6, 28], [29.6, 40, 31, 50], [32.6, 44, 34.6, 54], [36, 50, 38, 58.4], [32, 26, 30.6, 34]];
  const shag = segsD([...shagHalf, ...shagHalf.map(([a, b, c, d]) => [100 - a, b, 100 - c, d])]);
  const hi = segsD([[42, 15, 40.4, 21], [46, 16, 45.4, 22], [58, 15, 59.6, 21], [54, 16, 54.6, 22]]);
  const hide = rad(50, 28, 40, '#9a3a4e', MM.maroon, '#3a0e18');
  const earHide = lin(6, 30, 34, 40, '#2c0a12', MM.dark, '#5e1a29');
  const ivory = lin(8, 40, 40, 72, '#fffaf0', '#e8d9b5', '#b09a6c');
  const trunkHide = lin(43, 0, 57, 0, '#3e0f1a', '#8f3346', '#3a0e18');
  const eye = rad(39.6, 41.2, 4.2, '#fff27a', '#ff6a1a', '#a3100a');
  return {
    box: 100,
    layers: [
      L(disc(50, 50, 48), lin(50, 2, 50, 98, '#8a2a3d', MM.maroon, MM.dark)),
      L(glow, '#ffd27a', { op: 0.25 }),
      L(bulbs, MM.bulb),
      L(disc(50, 50, 41), rad(50, 42, 44, '#7b7e84', '#4a4c51', '#25262a')),
      keyline(ears + head + trunk, MM.light, 2.6),
      L(ears, earHide),
      keyline(curve([[30, 26], [18, 24.4], [11, 34], [12.6, 46], [20, 54]], false) + curve([[70, 26], [82, 24.4], [89, 34], [87.4, 46], [80, 54]], false), MM.deep, 0.8),
      L(head, hide),
      keyline(shag, MM.deep, 1),
      keyline(hi, '#b24a60', 0.7),
      L(maws, '#3a0610'),
      keyline(maws, '#c25a6c', 0.6),
      keyline(tusks, MM.deep, 1.6),
      L(tusks, ivory),
      keyline(tuskRings, '#a8915f', 0.6),
      L(trunk, trunkHide),
      keyline(wrinkles, MM.deep, 0.7),
      L(eyes, eye),
      L(disc(40.6, 41.8, 0.9, 8) + disc(59.4, 41.8, 0.9, 8), MM.deep),
      L(brows, MM.deep),
    ],
    small: [
      L(disc(50, 50, 48), MM.maroon),
      L(bulbs, MM.bulb),
      L(disc(50, 50, 41), '#3c3e42'),
      L(ears, MM.dark),
      L(head, MM.maroon),
      L(tusks, MM.ivory),
      L(trunk, '#7e2a3c'),
      L(eyes, '#ff6a1a'),
      L(brows, MM.deep),
    ],
  };
}

// DOCKS DISTRICT DOLPHINS. A navy roundel ringed in aqua, a blood-orange sun going down behind
// black water, and bursting up out of the water a scarred aqua dolphin, jaws open on its teeth,
// a mean eye and a nick out of its fin. Aqua, orange and navy.
const DD = { aqua: '#008e97', orange: '#fc4c02', navy: '#005778', white: '#f4f4f0', grey: '#9aa0a6', belly: '#cde9ea', deep: '#003a4a' };
const DOLPHIN = [
  // the beak's top, the melon and the back
  [10, 26.4, 1], [18, 23.6], [24, 19.6], [31, 16.6], [40, 16.6], [50, 20], [56, 23.6, 1],
  // the dorsal fin, a nick out of its trailing edge
  [64, 12.6, 1], [63.2, 16, 1], [61.6, 17.2, 1], [63.4, 21.4], [66, 30.6],
  [72, 38], [77, 48], [80, 60], [82, 72, 1],
  [66, 72, 1], [62, 58], [54, 48], [46, 43.4],
  // the flipper
  [44, 44.4, 1], [42, 55, 1], [37.4, 43.4],
  // under the jaw to its tip, and back along its top to the gape
  [31, 39.6], [24, 37.8], [15.4, 36.6, 1], [17, 34.6], [28.4, 31, 1],
  // the upper jaw's underside out to its tip
  [20, 29.4], [11, 28.4, 1],
];
const DOLPHIN_BELLY = [[16, 36.2], [24, 37], [31, 38.8], [38, 42], [46, 44.6], [54, 50], [61, 60], [65, 72, 1], [71, 72, 1], [65, 56], [56, 45.6], [46, 39.8], [36, 35.8], [26, 34]];
// the water: a swell across the disc at y 68 and the disc's foot under it
const SWELL = Array.from({ length: 21 }, (_, i) => { const x = 10 + i * 4; return [x, 68 + Math.sin(i * 1.1) * 1.4]; });

// The dolphin is drawn in its own frame and set in by DOLPHIN_AT, small enough that its beak
// clears the ring.
const DOLPHIN_AT = (x, y) => [62 + (x - 62) * 0.88, 52 + (y - 52) * 0.88];

function dolphinsCrest() {
  const D = (d) => xformD(d, DOLPHIN_AT);
  const fish = D(curve(DOLPHIN)), fishBelly = D(curve(DOLPHIN_BELLY));
  const sun = poly([...arcPts(50, 68, 25, Math.PI, TAU, 28)]);
  const sea = poly([...SWELL, ...arcPts(50, 50, 44, Math.asin(18 / 44), Math.PI - Math.asin(18 / 44), 20)]);
  const foam = curve(SWELL.slice(0, 15), false) + curve(SWELL.slice(16), false);
  const glints = segsD([[34, 72.6, 66, 72.6], [38, 76, 62, 76], [43, 79.4, 57, 79.4]]);
  const splash = curve([[60, 72], [61.4, 66, 1], [63.4, 70], [65, 62.6, 1], [67, 69], [70.4, 64, 1], [71, 69.6], [76, 62, 1], [76, 69], [80.4, 65.4, 1], [80.6, 70.4], [86, 67.4, 1], [84, 72.6], [62, 73.6]]);
  const spray = [[58, 63, 0.9], [62.4, 58.6, 1.1], [70, 58, 0.8], [79, 57, 1], [86, 61.4, 0.9], [74, 54.4, 0.7]].map(([x, y, r]) => disc(x, y, r, 8)).join('');
  // teeth along the upper jaw pointing down, and along the lower pointing up
  const teeth = [];
  for (let k = 0; k < 7; k++) {
    const t = (k + 0.5) / 7;
    const ux = 12.6 + (27.4 - 12.6) * t, uy = 28.6 + (31 - 28.6) * t;
    teeth.push([[ux - 0.8, uy - 0.2], [ux + 0.8, uy + 0.1], [ux + 0.2, uy + 1.9]]);
    if (k < 6) { const lx = 17 + (27 - 17) * t, ly = 34.6 - (34.6 - 31.6) * t; teeth.push([[lx - 0.8, ly + 0.2], [lx + 0.8, ly], [lx - 0.2, ly - 1.8]]); }
  }
  const maw = D(poly([[11, 28.6], [28.6, 31], [16, 35.4]])), fangs = D(teeth.map(poly).join(''));
  const eye = D(curve([[29.8, 27.8, 1], [35.6, 25, 1], [36.4, 26.6], [32, 29]]));
  const scars = D(segsD([[43.6, 19.6, 48.6, 27.4], [46.8, 19.2, 51.6, 26.8], [50, 19.8, 54.2, 26]]));
  const hide = lin(40, 12, 54, 64, '#45d3d8', DD.aqua, '#004c56');
  const belly = lin(30, 34, 40, 50, '#d6eff0', '#7fbcc0');
  return {
    box: 100,
    layers: [
      L(disc(50, 50, 47), rad(50, 64, 56, '#0a6a8a', DD.navy, '#012c40')),
      L(sun, lin(50, 43, 50, 68, '#ffb347', DD.orange, '#b52a00')),
      keyline(fish, DD.white, 2.6),
      L(maw, '#4a0a12'),
      L(fish, hide),
      L(fishBelly, belly),
      L(fangs, DD.white),
      keyline(scars, '#bff0f1', 0.8),
      keyline(D(curve([[28.6, 25.2], [33, 23.2], [37.8, 23]], false)), DD.deep, 1.2),
      L(eye, '#0a1418'),
      L(disc(...DOLPHIN_AT(34.4, 26.2), 0.45, 6), '#ffffff'),
      L(sea, lin(50, 66, 50, 94, '#023a52', '#01131c')),
      keyline(glints, DD.orange, 0.9),
      keyline(foam, DD.white, 1.3),
      L(splash, '#e8f6f7'),
      L(spray, '#e8f6f7'),
      keyline(ringD(50, 50, 44.4), DD.aqua, 2.4),
    ],
    small: [
      L(disc(50, 50, 47), DD.navy),
      L(sun, DD.orange),
      L(maw, '#4a0a12'),
      L(fish, DD.aqua),
      L(fishBelly, DD.belly),
      L(fangs, DD.white),
      L(eye, '#0a1418'),
      L(sea, DD.deep),
      L(splash, DD.white),
      keyline(ringD(50, 50, 44), DD.aqua, 3),
    ],
  };
}

// YARDS YELLOWJACKETS. A black honeycomb cell ringed in yellow, and on it a yellowjacket head-on
// from above: black compound eyes cut down at the middle, the mandibles open, antennae up, its
// wings spread and veined, six hooked legs, and the banded abdomen down to a stinger with a drop of
// venom on it. Yellow and black.
const YJ = { yellow: '#ffcd00', black: '#111111', grey: '#8f9296', white: '#f4f4f0', wing: '#e8f1f6', amber: '#c8961e' };
const hexPts = (r) => Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * TAU + Math.PI / 6; return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]; });
const YJ_HEAD = [[50, 12], [43.4, 12.8], [38.6, 16], [36.8, 21.6], [37.8, 27.6], [41.6, 32.6], [46, 35.4], [50, 36]];
// a compound eye, its inner top corner cut down toward the middle, as a scowl
const YJ_EYE = [[41, 13.6], [37.6, 17.6], [37.2, 24], [39.2, 30], [42.6, 33], [43.8, 28], [43.4, 22.4], [47.8, 19.2, 1]];
const YJ_MARK = [[50, 17.6, 1], [47.8, 21], [48.8, 25], [46.8, 28.8], [50, 31.6, 1], [53.2, 28.8], [51.2, 25], [52.2, 21]];
// a mandible, curving out and back in to a hooked tip, toothed along its inner edge
const YJ_MANDIBLE = [[46, 34], [41.4, 36.4], [40, 40.6], [41.6, 44.4], [46.6, 46.4, 1], [44.6, 43.6, 1], [45.4, 42.6, 1], [44, 41.2, 1], [44.8, 39.6, 1], [47, 37.6], [48.6, 36]];
const YJ_FOREWING = [[45, 37], [36, 29], [24, 23.6], [13.6, 24.4], [12.4, 28.6], [20, 33], [32, 39], [44, 41.6]];
const YJ_HINDWING = [[45, 44], [32, 43.6], [19.6, 46], [17.6, 50], [28, 51.4], [44, 47]];
const YJ_LEGS = [
  [[43.4, 41], [35, 37.6], [30, 43], [26.6, 41.4]],
  [[42.6, 46], [33, 50], [28.6, 57.4], [25.4, 58.6]],
  [[44.4, 50], [37, 57.4], [34.4, 67], [31.4, 71]],
];
// the abdomen's half-width down it
const YJ_W = [[52, 2], [54, 7], [58, 11], [64, 13], [70, 12.6], [76, 10.6], [82, 7], [86, 3.6], [88.4, 1.4]];
const yjW = (y) => { for (let i = 0; i < YJ_W.length - 1; i++) { const [y0, w0] = YJ_W[i], [y1, w1] = YJ_W[i + 1]; if (y <= y1) return w0 + (w1 - w0) * ((y - y0) / (y1 - y0)); } return 0; };

function yellowjacketsCrest() {
  const head = curve(sym(YJ_HEAD)), eyes = curve(YJ_EYE) + curve(mir(YJ_EYE));
  const mandibles = curve(YJ_MANDIBLE) + curve(mir(YJ_MANDIBLE));
  const wings = [YJ_FOREWING, YJ_HINDWING].map((w) => curve(w) + curve(mir(w))).join('');
  const veinsHalf = [[[44, 39], [34, 32], [22, 27.4]], [[40, 37], [30, 34.4], [18, 30]], [[30, 33], [26, 36]], [[43, 45.6], [30, 46.4], [21, 48]]];
  const veins = [...veinsHalf, ...veinsHalf.map((v) => mir(v))].map((p) => curve(p, false)).join('');
  const legs = [...YJ_LEGS, ...YJ_LEGS.map((l) => mir(l))].map((p) => curve(p, false)).join('');
  const antennae = curve([[47, 14], [45.4, 8, 1], [37.6, 4.4]], false) + curve([[53, 14], [54.6, 8, 1], [62.4, 4.4]], false);
  // the abdomen, sampled down its length, and its black bands with the wedge in the middle of each
  const side = []; for (let y = 52; y <= 88.4; y += 1.2) side.push([50 - yjW(y), y]);
  const abdomen = poly([...side, [50, 89.4], ...mir(side).reverse()]);
  const band = (y0, y1, v) => {
    const l = [], r = [];
    for (let y = y0; y <= y1 + 0.01; y += (y1 - y0) / 4) { l.push([50 - yjW(y) - 0.3, y]); r.push([50 + yjW(y) + 0.3, y]); }
    return poly([...l, [50 - 2.4, y1], [50, y1 + v], [50 + 2.4, y1], ...r.reverse()]);
  };
  const bands = band(57, 60.6, 4.2) + band(65, 68.4, 4.4) + band(72.6, 75.6, 4) + band(79.4, 82, 3.2) + band(85, 88.4, 0);
  const thorax = poly(ellipsePts(50, 43.6, 8.6, 8.4, 0, 24));
  const thoraxMarks = curve([[42.6, 38.6], [50, 36.4], [57.4, 38.6], [56, 40.2], [50, 38.8], [44, 40.2]]) + poly(ellipsePts(50, 49.6, 3, 1.2, 0, 12));
  const stinger = poly([[48.8, 88], [51.2, 88], [50, 96.2]]);
  const comb = (() => { const out = []; for (const [cx, cy] of [[30, 62], [70, 62], [30, 38], [70, 38], [50, 74], [20, 50], [80, 50], [50, 26]]) out.push(poly(Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * TAU + Math.PI / 6; return [cx + Math.cos(a) * 7.6, cy + Math.sin(a) * 7.6]; }))); return out.join(''); })();
  const gold = rad(45, 62, 24, '#fff08a', YJ.yellow, '#b58600');
  const hex = lin(10, 4, 90, 96, '#ffe24d', YJ.yellow, '#c79400');
  const eyeShine = rad(40, 20, 10, '#5a5f66', '#16181b', '#000000');
  return {
    box: 100,
    layers: [
      L(poly(hexPts(48)), hex),
      L(poly(hexPts(43)), rad(50, 46, 46, '#26231a', YJ.black)),
      keyline(comb, '#2e2a1c', 0.8),
      L(wings, YJ.wing, { op: 0.42 }),
      keyline(wings, '#cfe1ea', 0.5),
      keyline(veins, '#9ab0bd', 0.4),
      keyline(legs, YJ.black, 2.6),
      keyline(legs, YJ.yellow, 1.3),
      keyline(antennae, YJ.black, 1.6),
      keyline(abdomen + thorax + head + stinger, YJ.black, 2.4),
      L(stinger, lin(50, 88, 50, 96, '#3a3a3a', '#000000')),
      L(curve([[50, 95.4], [51.2, 97.6], [50, 98.8], [48.8, 97.6]]), '#c9e86a', { op: 0.85 }),
      L(abdomen, gold),
      L(bands, YJ.black),
      L(thorax, lin(40, 36, 60, 52, '#3a3a3a', YJ.black)),
      L(thoraxMarks, YJ.yellow),
      L(head, gold),
      L(poly(YJ_MARK), YJ.black),
      L(eyes, eyeShine),
      L(curve([[39.4, 18.4], [41.2, 16.4], [41, 22.4], [39.4, 24.4]]) + curve([[60.6, 18.4], [58.8, 16.4], [59, 22.4], [60.6, 24.4]]), '#9fb4c4', { op: 0.6 }),
      keyline(mandibles, YJ.black, 1.2),
      L(mandibles, lin(40, 34, 48, 46, '#e8b43a', YJ.amber, '#3a2404')),
    ],
    small: [
      L(poly(hexPts(48)), YJ.yellow),
      L(poly(hexPts(42)), YJ.black),
      L(wings, YJ.wing, { op: 0.5 }),
      keyline(legs, YJ.yellow, 1.8),
      L(stinger, YJ.yellow),
      L(abdomen, YJ.yellow),
      L(bands, YJ.black),
      L(head, YJ.yellow),
      L(eyes, YJ.black),
    ],
  };
}

// ── the clubs ───────────────────────────────────────────────────────────────────
// `kit` uses the names gl/ballplayer-mesh.js's KITS already reads (base, ink, trim, cap,
// under, helmet, belt), so a club's kit can be dropped in where a side's is now, plus the
// baseball fields the 3-D kits will want (fabric, bill, stirrups, pants, number, wordmark).
const CLUBS = {
  // the oldest club in the league, from before the collapse; Sir Charles's club
  'Basin Blue Birds': {
    district: 'Old Coldwater',
    home: 'Old Coldwater, by the Meridian',
    founded: 2019,
    colours: [BB.royal, BB.pitch, BB.red],
    crest: blueBirdsCrest(),
    kit: {
      // home: the night-blue jersey, royal letters edged in red
      home: {
        base: BB.pitch, ink: BB.royal, trim: BB.red, cap: BB.pitch, bill: BB.royal, under: BB.pitch, helmet: BB.pitch, belt: BB.pitch,
        pants: BB.pitch, stirrups: BB.royal, fabric: 'plain', number: [BB.royal, BB.red], wordmark: 'BLUE BIRDS',
      },
      // road: greys, night-blue letters edged in royal
      road: {
        base: BB.grey, ink: BB.pitch, trim: BB.royal, cap: BB.pitch, bill: BB.royal, under: BB.pitch, helmet: BB.pitch, belt: BB.pitch,
        pants: BB.grey, stirrups: BB.pitch, fabric: 'plain', number: [BB.pitch, BB.royal], wordmark: 'COLDWATER',
      },
    },
  },
  // pre-collapse too, and the Blue Birds' rival since; the Long Watch's club, quietly
  'Coldwater Crows': {
    district: 'Coldwater',
    home: 'the Charles B. Hughson Coliseum',
    founded: 2022,
    colours: [CR.red, CR.ink, CR.bone],
    crest: crowsCrest(),
    kit: {
      // home: bone flannel, black and red trim, a black cap with the red bird on it
      home: {
        base: CR.bone, ink: CR.ink, trim: CR.red, cap: CR.ink, bill: CR.ink, under: CR.ink, helmet: CR.ink, belt: CR.ink,
        pants: CR.bone, stirrups: CR.ink, fabric: 'flannel', number: [CR.ink, CR.red], wordmark: 'CROWS',
      },
      // road: travelling grey, black and red trim, the city's name across the chest
      road: {
        base: CR.grey, ink: CR.ink, trim: CR.red, cap: CR.ink, bill: CR.red, under: CR.ink, helmet: CR.ink, belt: CR.ink,
        pants: CR.grey, stirrups: CR.ink, fabric: 'flannel', number: [CR.ink, CR.red], wordmark: 'COLDWATER',
      },
    },
  },
  // Boomtown, in the Rust Quarter: navy pinstripes at home with a lone script B on the chest, the
  // town's name across the road greys
  'Boomtown Bombers': {
    district: 'the Rust Quarter',
    home: 'Boomtown',
    colours: [BO.navy, BO.white, BO.grey],
    crest: bombersCrest(),
    kit: {
      home: {
        base: BO.white, ink: BO.navy, trim: BO.navy, stripe: BO.navy, cap: BO.navy, bill: BO.navy, under: BO.navy, helmet: BO.navy, belt: BO.navy,
        pants: BO.white, stirrups: BO.navy, fabric: 'pinstripe', number: [BO.navy, BO.navy], wordmark: 'B',
      },
      road: {
        base: BO.grey, ink: BO.navy, trim: BO.white, cap: BO.navy, bill: BO.navy, under: BO.navy, helmet: BO.navy, belt: BO.navy,
        pants: BO.grey, stirrups: BO.navy, fabric: 'plain', number: [BO.navy, BO.white], wordmark: 'BOOMTOWN',
      },
    },
  },
  // the Westside, by the Glasshouse: black pinstripes and silver at home, black on the road greys
  'Westside White Sox': {
    district: 'the Glasshouse',
    home: 'the Westside',
    colours: [WS.black, WS.silver, WS.white],
    crest: whiteSoxCrest(),
    kit: {
      home: {
        base: WS.white, ink: WS.black, trim: WS.silver, stripe: WS.black, cap: WS.black, bill: WS.black, under: WS.black, helmet: WS.black, belt: WS.black,
        pants: WS.white, stirrups: WS.black, fabric: 'pinstripe', number: [WS.black, WS.silver], wordmark: 'SOX',
      },
      road: {
        base: WS.grey, ink: WS.black, trim: WS.silver, cap: WS.black, bill: WS.black, under: WS.black, helmet: WS.black, belt: WS.black,
        pants: WS.grey, stirrups: WS.black, fabric: 'plain', number: [WS.black, WS.silver], wordmark: 'WESTSIDE',
      },
    },
  },
  // Rustpile, in the Rust Quarter: home whites with red letters edged in navy and red stirrups,
  // navy on the road greys
  'Rustpile Red Sox': {
    district: 'the Rust Quarter',
    home: 'Rustpile, in the Rust Quarter',
    colours: [RS.red, RS.navy, RS.white],
    crest: redSoxCrest(),
    kit: {
      home: {
        base: RS.white, ink: RS.red, trim: RS.navy, cap: RS.navy, bill: RS.navy, under: RS.navy, helmet: RS.navy, belt: RS.navy,
        pants: RS.white, stirrups: RS.red, fabric: 'plain', number: [RS.red, RS.navy], wordmark: 'RED SOX',
      },
      road: {
        base: RS.grey, ink: RS.navy, trim: RS.red, cap: RS.navy, bill: RS.navy, under: RS.navy, helmet: RS.navy, belt: RS.navy,
        pants: RS.grey, stirrups: RS.red, fabric: 'plain', number: [RS.navy, RS.red], wordmark: 'RUSTPILE',
      },
    },
  },
  // the Marquee: maroon on white at home, the district's name in maroon across the greys away
  'Marquee Mastodons': {
    district: 'the Marquee',
    home: 'the Marquee',
    colours: [MM.maroon, MM.grey, MM.ivory],
    crest: mastodonsCrest(),
    kit: {
      home: {
        base: '#f4f4f0', ink: MM.maroon, trim: MM.grey, cap: MM.maroon, bill: MM.maroon, under: MM.maroon, helmet: MM.maroon, belt: MM.maroon,
        pants: '#f4f4f0', stirrups: MM.maroon, fabric: 'plain', number: [MM.maroon, MM.grey], wordmark: 'MASTODONS',
      },
      road: {
        base: MM.grey, ink: MM.maroon, trim: '#f4f4f0', cap: MM.maroon, bill: MM.maroon, under: MM.maroon, helmet: MM.maroon, belt: MM.maroon,
        pants: MM.grey, stirrups: MM.maroon, fabric: 'plain', number: [MM.maroon, '#f4f4f0'], wordmark: 'MARQUEE',
      },
    },
  },
  // the Docks: aqua edged in orange on white at home, white on aqua away
  'Docks District Dolphins': {
    district: 'the Docks',
    home: 'the Docks',
    colours: [DD.aqua, DD.orange, DD.navy],
    crest: dolphinsCrest(),
    kit: {
      home: {
        base: DD.white, ink: DD.aqua, trim: DD.orange, cap: DD.aqua, bill: DD.orange, under: DD.navy, helmet: DD.aqua, belt: DD.navy,
        pants: DD.white, stirrups: DD.aqua, fabric: 'plain', number: [DD.aqua, DD.orange], wordmark: 'DOLPHINS',
      },
      road: {
        base: DD.aqua, ink: DD.white, trim: DD.orange, cap: DD.navy, bill: DD.aqua, under: DD.navy, helmet: DD.navy, belt: DD.navy,
        pants: DD.white, stirrups: DD.navy, fabric: 'plain', number: [DD.white, DD.orange], wordmark: 'DOCKS',
      },
    },
  },
  // the Yards: black on yellow at home, yellow on black away
  'Yards Yellowjackets': {
    district: 'the Yards',
    home: 'the Yards',
    colours: [YJ.yellow, YJ.black, YJ.white],
    crest: yellowjacketsCrest(),
    kit: {
      home: {
        base: YJ.yellow, ink: YJ.black, trim: YJ.white, cap: YJ.black, bill: YJ.yellow, under: YJ.black, helmet: YJ.black, belt: YJ.black,
        pants: YJ.white, stirrups: YJ.black, fabric: 'plain', number: [YJ.black, YJ.white], wordmark: 'JACKETS',
      },
      road: {
        base: YJ.black, ink: YJ.yellow, trim: YJ.white, cap: YJ.black, bill: YJ.yellow, under: YJ.black, helmet: YJ.black, belt: YJ.black,
        pants: YJ.grey, stirrups: YJ.yellow, fabric: 'plain', number: [YJ.yellow, YJ.white], wordmark: 'YARDS',
      },
    },
  },
};

// ── write ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const raw = fs.readFileSync(ROW, 'utf8');
  const row = JSON.parse(raw);
  const sp = row.sports_pools || {};
  const teams = Array.isArray(sp.teams) ? sp.teams : [];
  const extra = Object.keys(CLUBS).filter((t) => !teams.includes(t));
  if (extra.length) {
    console.error(`✗ clubs here that aren't in the league (sports_pools.teams): ${extra.join(', ')}`);
    process.exit(1);
  }
  const next = canonicalJson(CLUBS), cur = canonicalJson(sp.clubs || null);
  if (process.argv.includes('--check')) {
    if (next !== cur) { console.error('✗ Deadball\'s sports_pools.clubs is out of date: run node scripts/content/build-deadball-clubs.mjs'); process.exit(1); }
  } else {
    sp.clubs = CLUBS;
    row.sports_pools = sp;
    const after = canonicalJson(row);
    if (after !== raw) fs.writeFileSync(ROW, after, 'utf8');
    console.log(`  ${after === raw ? 'unchanged' : 'wrote    '} ${Object.keys(CLUBS).length} club(s) into ${path.relative(ROOT, ROW)} (${(next.length / 1024).toFixed(1)} KB)`);
  }
}

export { CLUBS };
