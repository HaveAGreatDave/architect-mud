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
const join = (polys) => polys.map(poly).join('');

// ── the crests ──────────────────────────────────────────────────────────────────

// COLDWATER CROWS. A die-cut red sticker: an arch over a squared body, STILL WATCHING
// round the arch, a crow with its wings up perched on a bat across the middle, COLDWATER
// CROWS in Tuscan capitals over BASEBALL CLUB, EST. 2022 down the left side and DEADBALL
// down the right. Drawn after a 1909 minor-league sticker.
const CR = { red: '#c8302c', edge: '#6e1416', bat: '#8a1a1b', batHi: '#a52224', ink: '#151113', bone: '#efe9dc', grey: '#8f9296' };

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

// The crow, facing left, perched on the bat with its wings thrown up. A silhouette in ink,
// the coverts and the flight feathers picked out in the sticker's red. All of it stays inside
// the arch's lettering (33 units from the arch's centre), as the 1909 bird stays inside its.
const CROW_HEAD = ellipsePts(36.6, 29.4, 4.7, 4.3, -0.25, 24);
const CROW_BEAK = [[32.8, 27.6], [27.4, 29.9], [26.8, 30.6], [28.2, 31], [33, 31.8]];
const CROW_BODY = [
  ...cPts([34.2, 32], [36, 39], [41, 44.5], [47.5, 45], 10),             // throat and breast down to the belly
  ...cPts([47.5, 45], [53, 45.4], [58, 46], [63.6, 50.4], 6).slice(1),  // the underside to the tail's tip
  [66.8, 51.6], [65, 48], [66.4, 47.2],                                    // the tail, wedge-ended
  ...cPts([66.4, 47.2], [61, 42], [56, 36.5], [48.5, 33], 8),            // over the back
  ...cPts([48.5, 33], [44, 30], [40.5, 26.6], [37, 25.2], 6).slice(1),   // the nape
];
// the near wing, thrown up and back: the shoulder, the leading edge rising to the wrist,
// the primaries fanned off it as fingers, the secondaries in scallops back to the body
const WING = (() => {
  const pts = [[44.6, 34.6], ...cPts([44.6, 34.6], [45, 27], [49, 21], [55.4, 18.4], 8).slice(1)];
  const tips = [[59.4, 14.4], [64.6, 15.2], [68.4, 18.8], [69.8, 23.6], [68.8, 28.6]];
  const notches = [[58.4, 19.4], [61.4, 20.8], [62.8, 23.8], [63.2, 27.2], [62.2, 30.6]];
  for (let i = 0; i < tips.length; i++) pts.push(tips[i], notches[i]);
  pts.push([61, 31.6], [59.4, 34.4], [56.6, 33.8], [55, 36.6], [52, 35.8], [49.6, 38]);
  return pts;
})();
// the far wing, behind: its tips show over the near wing's leading edge
const WING_FAR = [[43.6, 33], [43.4, 25], [45.6, 19.6], [48.2, 16.6], [48.8, 19.4], [51.2, 16], [51.4, 19.2], [53.8, 17.2], [52.6, 22.6], [49, 27]];
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
// legs down to the bat's top edge, and the toes gripping it
const LEGS = [[45.4, 44, 44.6, 49.4], [50.2, 44.6, 50.6, 50.6]];
const TOES = [[42.4, 49.7, 46.8, 49.3], [48.4, 50.7, 52.8, 51]];

function crowsCrest() {
  const crow = join([CROW_HEAD, CROW_BEAK, CROW_BODY, WING, WING_FAR]);
  const feet = segsD([...LEGS, ...TOES]);
  // feather detail, in the sticker's red over the ink: scalloped coverts on the wing, the
  // shafts of the primaries, two lines of breast feathers
  const coverts = [];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - (row > 1 ? 1 : 0); i++) {
      const x = 49.4 + i * 3.6 + row * 1.6, y = 24.6 + row * 3.3 + i * 0.5;
      coverts.push('M' + arcPts(x, y, 1.6, 0.15 * Math.PI, 0.85 * Math.PI, 4).map(([px, py]) => `${n2(px)} ${n2(py)}`).join('L'));
    }
  }
  const shafts = segsD([[56.8, 21, 58.8, 15.8], [59.4, 21.6, 63.8, 16.6], [60.8, 23.8, 67.2, 20], [61.4, 26.6, 68.6, 24.2], [60.8, 29.2, 67.6, 28.6]]);
  const breast = [cPts([38, 35.4], [40, 38.4], [42.6, 40.4], [46, 41.2], 5), cPts([41.6, 33.6], [44, 36], [46.6, 37.4], [49.6, 38], 5)]
    .map((pts) => 'M' + pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L')).join('');

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

  return {
    box: 100,
    layers: [
      L(poly(stickerPts(0)), CR.edge),
      L(poly(stickerPts(1.4)), CR.red),
      L(poly(batPts()), CR.bat),
      L(poly(batShinePts()), CR.batHi),
      ...lettering,
      // a ring of red round the bird, so where it meets the lettering it reads as cut out
      L(crow + feet, 'none', { stroke: CR.red, sw: 2.4 }),
      L(crow, CR.ink),
      L(feet, 'none', { stroke: CR.ink, sw: 1.2 }),
      L(coverts.join('') + shafts + breast, 'none', { stroke: CR.red, sw: 0.5 }),
      L(poly(ellipsePts(35.6, 28.4, 0.9, 0.85, 0, 8)), CR.red),
    ],
    // under 34px: the sticker, the bat and the bird, no words
    small: [
      L(poly(stickerPts(0)), CR.edge),
      L(poly(stickerPts(2.4)), CR.red),
      L(poly(batPts()), CR.bat),
      L(crow, CR.ink),
      L(feet, 'none', { stroke: CR.ink, sw: 1.6 }),
    ],
  };
}

// BASIN BLUE BIRDS. A night-blue roundel ringed in royal and red, and breaking
// out of it a blue jay's head in silhouette, crest swept back, a black beak, a red eye under
// a brow cut down at the beak, and the white throat under the jay's black necklace. The colours are
// the Blue Jays' City Connect ("Night Mode") set, matched by eye: pitch blue, hyper royal,
// speed red.
const BB = { pitch: '#0d1b2e', royal: '#1d55d8', red: '#e0243a', white: '#f3f5f9', grey: '#9aa0a8' };
const JAY_HEAD = [
  [14, 52], [22, 47.5], [29, 44.5], [34, 41], [38.5, 37.6], [42, 34],
  // the crest, four feathers swept back
  [58, 10], [55, 24], [72, 13], [66, 25], [84, 20], [75, 30], [91, 31], [79, 40],
  // the nape and the neck, cut off at the bottom
  [82, 50], [83, 62], [87, 74], [82, 80], ...qPts([82, 80], [68, 84], [54, 80], 6).slice(1),
  // the throat and under the beak
  [46, 74], [38, 66], [33, 60], [28, 57.5], [22, 55.5],
];
// the beak, in night blue over the head: hooked a touch at the tip
const JAY_BEAK = [[13, 52.2], [20, 48], [29, 45], [31.6, 50.2], [30.6, 54.6], [21, 55.4], [15.6, 53.4]];
// the white throat, and the black necklace round its top and back
const JAY_THROAT = [[30.6, 54.6], [40, 55], [52, 55.8], [62, 59], [66, 66], [65, 81], [54, 80], [46, 74], [38, 66], [33, 60]];
const JAY_COLLAR = 'M' + [[30.6, 54.2], [41, 54.8], [52, 55.6], [62.4, 58.8], [66.6, 66], [66, 81]].map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L');
const JAY_EYE = [[35, 46], [38, 42.6], [44.5, 41.4], [46.6, 43.8], [43, 47], [37.6, 47.6]];
const JAY_BROW = [[31, 42.4], [47.5, 36], [49.6, 39.4], [33.6, 45.4]];

function blueBirdsCrest() {
  const head = poly(JAY_HEAD);
  const disc = poly(ellipsePts(50, 50, 46, 46, 0, 48));
  const ring = (r) => 'M' + arcPts(50, 50, r, 0, TAU, 48).map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L') + 'Z';
  const face = [
    L(poly(JAY_THROAT), BB.white),
    L(JAY_COLLAR, 'none', { stroke: BB.pitch, sw: 3 }),
    L(poly(JAY_BEAK), BB.pitch),
    L(segsD([[16, 53], [30, 51.8]]), 'none', { stroke: BB.royal, sw: 0.6 }),
    L(poly(JAY_EYE), BB.white),
    L(poly(ellipsePts(42, 44.4, 1.9, 1.9, 0, 10)), BB.red),
    L(poly(ellipsePts(42.2, 44.4, 0.9, 0.9, 0, 8)), BB.pitch),
    L(poly(JAY_BROW), BB.pitch),
  ];
  return {
    box: 100,
    layers: [
      L(disc, BB.pitch),
      L(ring(44), 'none', { stroke: BB.royal, sw: 2.4 }),
      L(ring(40.6), 'none', { stroke: BB.red, sw: 0.9 }),
      // a white keyline round the head, so it reads cut out where it breaks the rings
      L(head, 'none', { stroke: BB.white, sw: 2.6 }),
      L(head, BB.royal),
      // the crest's feathers parted in night blue
      L(segsD([[47, 30, 56, 14], [57, 28, 70, 16], [65, 31, 82, 22], [72, 36, 88, 31]]), 'none', { stroke: BB.pitch, sw: 0.9 }),
      ...face,
    ],
    // under 34px: the roundel and the head, the collar, the eye and the brow
    small: [
      L(disc, BB.pitch),
      L(ring(43.6), 'none', { stroke: BB.royal, sw: 3 }),
      L(head, 'none', { stroke: BB.white, sw: 3 }),
      L(head, BB.royal),
      L(poly(JAY_THROAT), BB.white),
      L(JAY_COLLAR, 'none', { stroke: BB.pitch, sw: 4 }),
      L(poly(JAY_BEAK), BB.pitch),
      L(poly(JAY_EYE), BB.white),
      L(poly(JAY_BROW), BB.pitch),
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
