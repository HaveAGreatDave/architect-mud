// The CPhL's eight clubs: where each plays, its colours, its home and road kits and its
// crest, written into the Cluster Puck broadcast row as `sports_pools.clubs`.
//
// WHY A SCRIPT. A crest is a few hundred path commands, and some of them are made by
// rule: twenty-four gems round a bezel, chain links along a curve, a weapon laid along
// the stroke of a W. Nobody should hand-edit that in JSON. This file is the authoring
// source; the content row is its output, and git ships the row like any other content.
//
//   node scripts/content/build-cphl-clubs.mjs           write the clubs into the row
//   node scripts/content/build-cphl-clubs.mjs --check   fail if the row is out of date
//
// It writes `clubs` and nothing else, so the rest of the row (teams, pools) is left as
// it is. The club list itself is `::teams` in data/scripts/hockey.bsm, mirrored into the
// row's `teams`; every club here must be on it and every club on it must be here.
//
// A crest is layers in a 100-unit box (client/game/js/panels/club-crest.js draws it):
// `layers` is the full drawing, `small` the one used under about 34px. Colours are the
// club's own; 'sett' fills with the club's tartan.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ROW = path.join(ROOT, 'content/media_broadcasts/bc_cluster_puck.json');

// ── geometry ────────────────────────────────────────────────────────────────────
const n2 = (v) => { const r = Math.round(v * 10) / 10; return Object.is(r, -0) ? '0' : String(r); };
const P = (x, y) => `${n2(x)} ${n2(y)}`;
const TAU = Math.PI * 2;

// A transform: scale, rotate (radians), then translate. sx -1 mirrors.
const T = (o = {}) => ({ tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, ...o });
const ap = (t, x, y) => {
  if (!t) return [x, y];
  if (t.fn) return t.fn(x, y);
  const X = x * t.sx, Y = y * t.sy, c = Math.cos(t.rot), s = Math.sin(t.rot);
  return [X * c - Y * s + t.tx, X * s + Y * c + t.ty];
};
// A shape in its own frame: ['M',x,y] ['L',x,y] ['Q',cx,cy,x,y] ['C',x1,y1,x2,y2,x,y] ['Z']
function shape(cmds, t) {
  let d = '';
  for (const c of cmds) {
    const k = c[0];
    if (k === 'Z') { d += 'Z'; continue; }
    const pts = [];
    for (let i = 1; i < c.length; i += 2) pts.push(P(...ap(t, c[i], c[i + 1])));
    d += k + pts.join(' ');
  }
  return d;
}
// a polygon from points, through an optional transform
const poly = (pts, t) => 'M' + pts.map(([x, y]) => P(...ap(t, x, y))).join('L') + 'Z';
// the polyline form of a path written in the mini-language above (for the pieces that
// need their own points later)
const circle = (cx, cy, r) => `M${P(cx - r, cy)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0Z`;
// the same circle wound the other way, to cut a hole with the default fill rule
const hole = (cx, cy, r) => `M${P(cx - r, cy)}a${n2(r)} ${n2(r)} 0 1 1 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 1 ${n2(-2 * r)} 0Z`;
const ring = (cx, cy, r0, r1) => circle(cx, cy, r1) + hole(cx, cy, r0);
const ellipsePts = (cx, cy, rx, ry, rot = 0, n = 36) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
};
const ellipse = (cx, cy, rx, ry, rot = 0, n = 36) => poly(ellipsePts(cx, cy, rx, ry, rot, n));
// the part of an ellipse on the side of a line through (lx, ly) that the normal points to
function ellipseSide(cx, cy, rx, ry, lx, ly, nx, ny, n = 72) {
  const pts = ellipsePts(cx, cy, rx, ry, 0, n);
  const side = (p) => (p[0] - lx) * nx + (p[1] - ly) * ny;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) { const k = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  }
  return out;
}
const rrect = (x, y, w, h, r) => shape([
  ['M', x + r, y], ['L', x + w - r, y], ['Q', x + w, y, x + w, y + r], ['L', x + w, y + h - r], ['Q', x + w, y + h, x + w - r, y + h],
  ['L', x + r, y + h], ['Q', x, y + h, x, y + h - r], ['L', x, y + r], ['Q', x, y, x + r, y], ['Z'],
]);
// a finished path string, scaled uniformly by k about (ox, oy). Understands what the
// helpers here emit: absolute M L Q C Z and the relative arcs in circle().
function xfD(d, k, ox, oy) {
  const out = [];
  for (const m of d.matchAll(/([MLQCZa])([^MLQCZa]*)/g)) {
    const cmd = m[1], nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
    if (cmd === 'Z') { out.push('Z'); continue; }
    if (cmd === 'a') {
      const r = [];
      for (let i = 0; i < nums.length; i += 7) r.push([nums[i] * k, nums[i + 1] * k, nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5] * k, nums[i + 6] * k].map(n2).join(' '));
      out.push('a' + r.join(' '));
      continue;
    }
    const pts = [];
    for (let i = 0; i < nums.length; i += 2) pts.push(P(ox + (nums[i] - ox) * k, oy + (nums[i + 1] - oy) * k));
    out.push(cmd + pts.join(' '));
  }
  return out.join('');
}
// a thick polyline as an outline polygon (butt ends), for bars and shafts
function bar(x0, y0, x1, y1, w) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * w / 2, ny = (dx / L) * w / 2;
  return poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
}
// a regular polygon / star
const ngon = (cx, cy, r, n, rot = -Math.PI / 2) => poly(Array.from({ length: n }, (_, i) => [cx + r * Math.cos(rot + (i / n) * TAU), cy + r * Math.sin(rot + (i / n) * TAU)]));
const star = (cx, cy, r0, r1, n, rot = -Math.PI / 2) => poly(Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? r0 : r1, a = rot + (i / (n * 2)) * TAU; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }));
// points along a quadratic curve
const qAt = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
const qTan = (a, c, b, t) => Math.atan2(2 * (1 - t) * (c[1] - a[1]) + 2 * t * (b[1] - c[1]), 2 * (1 - t) * (c[0] - a[0]) + 2 * t * (b[0] - c[0]));
// a transform that lays a shape authored along +x (0 … len) from point a to point b
function along(a, b, len, flip = false) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), k = L / len;
  return T({ tx: a[0], ty: a[1], rot: Math.atan2(dy, dx), sx: k, sy: flip ? -k : k });
}
const L = (d, fill, more = {}) => ({ d, fill, ...more });

// ── lettering ───────────────────────────────────────────────────────────────────
// Stamped capitals for the few places a crest carries letters (the Bulldogs' tags). Each
// glyph is 6 wide and 8 tall in its own frame; counters are cut with the even-odd rule.
const GLYPH = {
  R: [['M', 0, 0], ['L', 3.6, 0], ['C', 6.4, 0, 6.4, 4.4, 3.6, 4.4], ['L', 6, 8], ['L', 4.1, 8], ['L', 2, 4.6], ['L', 1.7, 4.6], ['L', 1.7, 8], ['L', 0, 8], ['Z'],
    ['M', 1.7, 1.5], ['L', 3.4, 1.5], ['C', 4.6, 1.5, 4.6, 3, 3.4, 3], ['L', 1.7, 3], ['Z']],
  C: [['M', 6, 1.9], ['C', 5.3, 0.6, 4.4, 0, 3.2, 0], ['C', 1.2, 0, 0, 1.8, 0, 4], ['C', 0, 6.2, 1.2, 8, 3.2, 8], ['C', 4.4, 8, 5.3, 7.4, 6, 6.1],
    ['L', 4.6, 5.3], ['C', 4.2, 6.1, 3.8, 6.4, 3.2, 6.4], ['C', 2.2, 6.4, 1.7, 5.4, 1.7, 4], ['C', 1.7, 2.6, 2.2, 1.6, 3.2, 1.6], ['C', 3.8, 1.6, 4.2, 1.9, 4.6, 2.7], ['Z']],
};
GLYPH.D = [['M', 0, 0], ['L', 2.8, 0], ['C', 6.6, 0, 6.6, 8, 2.8, 8], ['L', 0, 8], ['Z'], ['M', 1.8, 1.7], ['L', 2.7, 1.7], ['C', 4.7, 1.7, 4.7, 6.3, 2.7, 6.3], ['L', 1.8, 6.3], ['Z']];
GLYPH['9'] = [['M', 6, 3.2], ['C', 6, 1.2, 4.7, 0, 3, 0], ['C', 1.3, 0, 0, 1.3, 0, 3], ['C', 0, 4.8, 1.3, 6, 3, 6], ['C', 3.6, 6, 4, 5.9, 4.3, 5.6],
  ['C', 4, 6.6, 3.2, 7.2, 1.6, 7.2], ['L', 1.6, 8.6], ['C', 4.6, 8.6, 6, 6.6, 6, 3.2], ['Z'], ['M', 3, 1.5], ['C', 3.9, 1.5, 4.4, 2.2, 4.4, 3], ['C', 4.4, 3.8, 3.9, 4.5, 3, 4.5],
  ['C', 2.1, 4.5, 1.6, 3.8, 1.6, 3], ['C', 1.6, 2.2, 2.1, 1.5, 3, 1.5], ['Z']];
const glyph = (ch, t) => shape(GLYPH[ch], t);

// ── the crests ──────────────────────────────────────────────────────────────────

// WESTSIDE WARLORDS. A gem-set bezel round a black dial, and on the dial a W laid out
// in weapons: the outer strokes are two bazookas, muzzles up as the W's top serifs; the
// inner two are rifles crossing at the peak. The bezel's stones are the same stones
// that run along the Warlords' sweater stripe.
const WL = { black: '#0e0e0f', gold: '#f6b51e', goldDeep: '#b9820c', goldDark: '#6b4a06', gem: '#f4fbff', facet: '#a9d3ee', glint: '#ffffff' };
// a rifle in profile, butt at x 0, muzzle at x 58; +y is the side the magazine hangs
const RIFLE = [
  ['M', 0, -3.6], ['L', 13, -2.2], ['L', 14.5, -3.6], ['L', 31, -3.6], ['L', 32, -4.6], ['L', 33.8, -4.6], ['L', 34.4, -3.2],
  ['L', 45, -3.2], ['L', 46, -1.9], ['L', 51.4, -1.9], ['L', 51.8, -4.8], ['L', 53.6, -4.8], ['L', 53.8, -1.4], ['L', 58.5, -1.4],
  ['L', 58.5, 1.2], ['L', 45, 1.2], ['L', 45, 2.8], ['L', 34, 2.8],
  ['Q', 34.4, 6.6, 36.6, 9.6], ['L', 32, 11], ['Q', 29.8, 7.2, 29.6, 2.8],
  ['L', 25, 2.8], ['L', 23.4, 7.6], ['L', 19.8, 7.4], ['L', 21, 2.8],
  ['L', 13.6, 2.8], ['L', 0, 5.6], ['Z'],
];
// the rifle's wood: stock and handguard, drawn darker over the silhouette
const RIFLE_WOOD = [
  ['M', 1.2, -2.4], ['L', 12, -1.2], ['L', 12.6, 1.8], ['L', 1.2, 4.2], ['Z'],
  ['M', 35.2, -2.2], ['L', 44.4, -2.2], ['L', 44.4, 1.8], ['L', 35.2, 1.8], ['Z'],
];
// a bazooka: a straight tube, rear at x 0, muzzle at x 60.5, squared off at both ends
// with a flared lip at the muzzle; a box sight on top, two grips under (+y)
const LAUNCHER = [
  ['M', 0, -3.8], ['L', 3.4, -3.8], ['L', 4.2, -2.9], ['L', 35.6, -2.9], ['L', 35.6, -6.6], ['L', 41.4, -6.6], ['L', 41.4, -2.9],
  ['L', 55.4, -2.9], ['L', 56.4, -4.2], ['L', 60.5, -4.2], ['L', 60.5, 4.2], ['L', 56.4, 4.2], ['L', 55.4, 2.9],
  ['L', 33.4, 2.9], ['L', 32.4, 7.8], ['L', 29.6, 7.8], ['L', 30.2, 2.9], ['L', 22.2, 2.9], ['L', 20.8, 8.6], ['L', 18, 8.6], ['L', 19.2, 2.9],
  ['L', 4.2, 2.9], ['L', 3.4, 3.8], ['L', 0, 3.8], ['Z'],
];
const LAUNCHER_DETAIL = [
  ['M', 7.5, -2.9], ['L', 15.5, -2.9], ['L', 15.5, 2.9], ['L', 7.5, 2.9], ['Z'],                 // the shoulder pad
  ['M', 50.4, -2.9], ['L', 52.6, -2.9], ['L', 52.6, 2.9], ['L', 50.4, 2.9], ['Z'],               // a band near the muzzle
  ['M', 37, -5.4], ['L', 40, -5.4], ['L', 40, -4.2], ['L', 37, -4.2], ['Z'],                     // the sight's window
];
function warlords() {
  const C = 50;
  // the fluted outer edge: a coin's milling, eighty teeth
  const flute = [];
  for (let i = 0; i < 160; i++) { const a = (i / 160) * TAU, r = i % 2 ? 48.6 : 49.8; flute.push([C + r * Math.cos(a), C + r * Math.sin(a)]); }
  const N = 24, R = 44.4;
  let seats = '', gems = '', tables = '', glints = '';
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + (i / N) * TAU, x = C + R * Math.cos(a), y = C + R * Math.sin(a);
    seats += circle(x, y, 3.4);
    gems += circle(x, y, 2.75);
    tables += ngon(x, y, 1.4, 8, a + Math.PI / 8);
    glints += circle(x - 1, y - 1.1, 0.55);
  }
  // the W: bazookas on the outside strokes, muzzles up as its two top serifs; rifles up
  // the middle, crossing at the peak
  const lb = [35.5, 79.5], rb = [64.5, 79.5];
  const fat = (t) => ({ ...t, sy: t.sy * 1.25 });
  const launchL = fat(along(lb, [21, 32.5], 60.5, true)), launchR = fat(along(rb, [79, 32.5], 60.5, false));
  const peak = [50, 44];
  const dir = [peak[0] - 37.5, peak[1] - 79.5], kd = Math.hypot(...dir), reach = kd + 12;
  const tip = [37.5 + dir[0] / kd * reach, 79.5 + dir[1] / kd * reach];
  const rifleL = fat(along([37.5, 79.5], tip, 58.5, true)), rifleR = fat(along([62.5, 79.5], [100 - tip[0], tip[1]], 58.5, false));
  const W = (t) => [
    L(shape(LAUNCHER, t), WL.gold, { stroke: WL.black, sw: 1.5 }),
    L(shape(LAUNCHER_DETAIL, t), WL.goldDeep),
  ];
  const R2 = (t) => [
    L(shape(RIFLE, t), WL.gold, { stroke: WL.black, sw: 1.5 }),
    L(shape(RIFLE_WOOD, t), WL.goldDeep),
  ];
  const layers = [
    L(poly(flute), WL.goldDeep),
    L(circle(C, C, 48.4), WL.gold),
    L(seats, WL.goldDark),
    L(gems, WL.gem),
    L(tables, WL.facet),
    L(glints, WL.glint),
    L(circle(C, C, 40.6), WL.goldDeep),
    L(circle(C, C, 39.4), WL.black),
    L(ring(C, C, 37.3, 37.9), WL.goldDark),
    ...R2(rifleL), ...R2(rifleR), ...W(launchL), ...W(launchR),
  ];
  // small: the bezel with a dozen stones and a bold W
  let sGems = '';
  for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + (i / 12) * TAU; sGems += circle(C + 43 * Math.cos(a), C + 43 * Math.sin(a), 3.6); }
  const small = [
    L(circle(C, C, 49.5), WL.gold),
    L(sGems, WL.gem),
    L(circle(C, C, 37.5), WL.black),
    L('M21 29L36.5 74L50 43L63.5 74L79 29', 'none', { stroke: WL.gold, sw: 10.5 }),
  ];
  return { box: 100, layers, small };
}

// BOOMTOWN BULLDOGS. A bulldog's head, square on: rose ears, a scowl, big hanging jowls,
// a bone clamped in its underbite with the fangs up over it, bursting out of a rusted cog (the Rust Quarter),
// on a chain collar with two tags hanging from it. The front tag reads RC.
const BD = { orange: '#f37021', orangeDeep: '#b9480b', orangeDark: '#7c2d06', black: '#111111', bone: '#f6ead6', boneShade: '#d9c4a3', white: '#ffffff', mouth: '#5b0f12', steel: '#d3d8dc', steelDark: '#7b848b', nose: '#1b1b1b', boneWhite: '#fbf5e6', rust: '#8a3a12', rustDeep: '#5c260b' };
function bulldogs() {
  // the cog: twelve teeth
  const cog = [];
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * TAU - Math.PI / 2 + Math.PI / 12;
    for (const [da, r] of [[-0.2, 41.5], [-0.13, 49], [0.13, 49], [0.2, 41.5]]) cog.push([50 + r * Math.cos(a0 + da), 50 + r * Math.sin(a0 + da)]);
  }
  // everything else is drawn in one frame and set down a touch smaller, so the tags fit
  const h = T({ sx: 0.9, sy: 0.9, tx: 5, ty: -2.4 });
  const S = (cmds) => shape(cmds, h);
  const mirror = (cmds) => cmds.map((c) => (c[0] === 'Z' ? c : [c[0], ...c.slice(1).map((v, i) => (i % 2 === 0 ? 100 - v : v))]));
  // the half-head, right side: skull, temple, then the jowl swinging out wide and
  // hanging in a heavy lobe below the jaw line before it comes back to the chin
  const half = [['M', 50, 8], ['C', 62, 8, 72, 9, 79, 14], ['C', 85, 18, 88, 25, 89, 33], ['C', 91, 41, 97, 48, 98.5, 59], ['C', 100.5, 72, 97, 87, 87.5, 93],
    ['C', 80, 97, 71, 94.5, 65.5, 87.5], ['C', 60, 89.5, 55, 90, 50, 90]];
  const head = [...half, ...mirror(half.slice(1).reverse().map((c, i, arr) => {
    // walk the right half backwards: each curve's end becomes the previous one's start
    const prevEnd = i + 1 < arr.length ? arr[i + 1].slice(-2) : [50, 8];
    return ['C', c[3], c[4], c[1], c[2], prevEnd[0], prevEnd[1]];
  })), ['Z']];
  const neck = [['M', 17, 62], ['C', 18, 80, 32, 92, 50, 92], ['C', 68, 92, 82, 80, 83, 62], ['Z']];
  const earR = [['M', 77, 13.4], ['C', 85, 8.6, 93.6, 10.6, 98.4, 18.4], ['C', 96.6, 23.4, 92.6, 26.2, 88.6, 27.4], ['C', 88, 21.6, 84, 16.4, 77, 13.4], ['Z']];
  const ears = [...earR, ...mirror(earR)];
  const earFold = [['M', 84, 13.6], ['C', 89, 12.6, 93.4, 14.4, 96, 18.4], ['C', 93, 19, 90.6, 21, 89.4, 24], ['C', 88.4, 19.6, 86.6, 16, 84, 13.6], ['Z']];
  const jowlR = [['M', 97, 58], ['C', 99.5, 71, 96.6, 85.6, 87.5, 92], ['C', 80.4, 95.6, 72, 93.4, 66.4, 87.4], ['C', 78, 84, 84, 73, 85, 59], ['Z']];
  const jowlFold = [['M', 75, 62], ['C', 82, 71, 82, 82, 74, 89], ['M', 25, 62], ['C', 18, 71, 18, 82, 26, 89]];
  const muzzle = [['M', 50, 39], ['C', 62, 39, 72, 44, 77, 53], ['C', 82, 63, 78, 76, 68, 81.4], ['C', 62, 84.6, 56, 85.6, 50, 85.6], ['C', 44, 85.6, 38, 84.6, 32, 81.4],
    ['C', 22, 76, 18, 63, 23, 53], ['C', 28, 44, 38, 39, 50, 39], ['Z']];
  const browR = [['M', 50, 37.5], ['L', 53, 34.6], ['Q', 62, 25.4, 77.4, 26.6], ['L', 76.4, 31.4], ['Q', 63, 31, 54.6, 40.2], ['Z']];
  const brow = [...browR, ...mirror(browR)];
  const eyeR = [['M', 57.4, 36.6], ['Q', 64, 31.4, 71, 33.2], ['Q', 66.4, 39.4, 57.4, 36.6], ['Z']];
  const eyes = [...eyeR, ...mirror(eyeR)];
  const pupils = circle(...ap(h, 63.6, 35.3), 1.75) + circle(...ap(h, 36.4, 35.3), 1.75);
  const wrinkles = [['M', 44, 21.6], ['Q', 50, 19.4, 56, 21.6], ['M', 46.6, 26.4], ['Q', 50, 25, 53.4, 26.4]];
  const roll = [['M', 36.6, 44.4], ['Q', 50, 37.4, 63.4, 44.4], ['Q', 50, 41.6, 36.6, 44.4], ['Z']];
  const nose = [['M', 50, 43.6], ['C', 58.6, 43.6, 62.6, 45.6, 62.6, 49.4], ['C', 62.6, 53.4, 57, 55, 50, 56.2], ['C', 43, 55, 37.4, 53.4, 37.4, 49.4], ['C', 37.4, 45.6, 41.4, 43.6, 50, 43.6], ['Z']];
  const nostrils = poly(ellipsePts(45, 51.2, 2.4, 1.3, 0.3), h) + poly(ellipsePts(55, 51.2, 2.4, 1.3, -0.3), h);
  const shine = poly(ellipsePts(46.8, 46.4, 3.8, 1.2, -0.08), h);
  // the bone, clamped crosswise: the shaft between the jaws, a knob each end out past
  // the jowls. Underbite below it, fangs up over it, the flews draped on top.
  const boneD = [['M', 13, 67.4], ['L', 87, 67.4], ['C', 88.6, 61.4, 97.4, 61.6, 96.4, 67.4], ['C', 99.4, 69.6, 97.8, 76.6, 92.6, 74.4], ['C', 91.2, 76.2, 88.4, 75.6, 87, 73.6],
    ['L', 13, 73.6], ['C', 11.6, 75.6, 8.8, 76.2, 7.4, 74.4], ['C', 2.2, 76.6, 0.6, 69.6, 3.6, 67.4], ['C', 2.6, 61.6, 11.4, 61.4, 13, 67.4], ['Z']];
  const boneShine = [['M', 16, 69], ['L', 84, 69]];
  const mouth = [['M', 31.4, 66.6], ['C', 38, 62, 45, 61.4, 50, 61.4], ['C', 55, 61.4, 62, 62, 68.6, 66.6], ['L', 68.6, 75], ['L', 31.4, 75], ['Z']];
  const jaw = [['M', 32.6, 73.4], ['L', 67.4, 73.4], ['C', 67, 79.4, 59.4, 83.4, 50, 83.4], ['C', 40.6, 83.4, 33, 79.4, 32.6, 73.4], ['Z']];
  const teeth = [];
  for (let i = 0; i < 6; i++) { const x = 41.2 + i * 2.95; teeth.push(['M', x, 74.6], ['L', x + 1.45, 71.2], ['L', x + 2.9, 74.6], ['Z']); }
  const fangR = [['M', 57.8, 75], ['C', 58.2, 69.6, 59.4, 65.2, 61.2, 61.4], ['C', 62.6, 65.4, 63.4, 70, 63, 74.6], ['Z']];
  const fangs = [...fangR, ...mirror(fangR)];
  const flewR = [['M', 50, 59.4], ['C', 56, 59.4, 63, 61.4, 70.6, 67.6], ['C', 66, 71.4, 60, 71.2, 54, 68.4], ['C', 52.4, 67.6, 51.2, 66.6, 50, 66.6], ['Z']];
  const flews = [...flewR, ...mirror(flewR)];
  const philtrum = [['M', 50, 55.6], ['L', 50, 61]];
  const folds = [['M', 70.6, 50], ['C', 75, 55, 76, 60, 75, 64], ['M', 29.4, 50], ['C', 25, 55, 24, 60, 25, 64]];
  // the chain: links along a curve under the chin, face-on and edge-on in turn
  const a = [8, 76], c = [50, 112], b = [92, 76];
  let links = '', linkHoles = '', edges = '';
  const NL = 13;
  for (let i = 0; i < NL; i++) {
    const t = (i + 0.5) / NL, [x, y] = ap(h, ...qAt(a, c, b, t)), ang = qTan(a, c, b, t);
    if (i % 2 === 0) { links += ellipse(x, y, 4.3, 3, ang, 24); linkHoles += ellipse(x, y, 2.3, 1.1, ang, 20); }
    else edges += poly([[-4.2, -1], [4.2, -1], [4.2, 1], [-4.2, 1]].map(([px, py]) => [x + px * Math.cos(ang) - py * Math.sin(ang), y + px * Math.sin(ang) + py * Math.cos(ang)]));
  }
  // the tags hang from the middle link: the back one turned away, the front one reads RC
  const TAGK = 0.78;
  const tagCmds = [['M', -7, 1.5], ['Q', -7, -1, -4.5, -1], ['L', 4.5, -1], ['Q', 7, -1, 7, 1.5], ['L', 7, 14], ['Q', 7, 16.5, 4.5, 16.5], ['L', -4.5, 16.5], ['Q', -7, 16.5, -7, 14], ['Z']];
  const tagT = (cx, cy, rot) => T({ tx: cx, ty: cy, rot, sx: TAGK, sy: TAGK });
  const mid = ap(h, ...qAt(a, c, b, 0.5));
  const back = tagT(mid[0] + 3.4, mid[1] + 2.2, 0.26), front = tagT(mid[0] - 1.4, mid[1] + 2.8, -0.07);
  const tagHole = (t) => circle(...ap(t, 0, 2), 1.15 * TAGK);
  const lt = (x, y) => T({ tx: ap(front, x, y)[0], ty: ap(front, x, y)[1], rot: front.rot, sx: 0.92 * TAGK, sy: 1.05 * TAGK });
  const letters = glyph('R', lt(-5.9, 4.6)) + glyph('C', lt(0.4, 4.6));
  const ring0 = ring(mid[0], mid[1] + 1.6, 1.3, 2.3);
  const layers = [
    L(poly(cog), BD.rust, { stroke: BD.black, sw: 2.2 }),
    L(circle(50, 50, 36.5), BD.black),
    L(ring(50, 50, 32, 33.6), BD.rustDeep),
    L(S(neck), BD.orangeDeep, { stroke: BD.black, sw: 3.4 }),
    // the chain goes round the neck behind the jowls, which hang over it
    L(links + edges, BD.steel, { stroke: BD.black, sw: 1.3 }),
    L(linkHoles, BD.black),
    L(S(ears), BD.orange, { stroke: BD.black, sw: 3 }),
    L(S([...earFold, ...mirror(earFold)]), BD.orangeDeep),
    L(S(head), BD.orange, { stroke: BD.black, sw: 3.6 }),
    L(S([...jowlR, ...mirror(jowlR)]), BD.orangeDeep),
    L(S(jowlFold), 'none', { stroke: BD.black, sw: 1.6 }),
    L(S(muzzle), BD.bone),
    L(S(wrinkles), 'none', { stroke: BD.black, sw: 1.7 }),
    L(S(eyes), BD.white, { stroke: BD.black, sw: 1.1 }),
    L(pupils, BD.black),
    L(S(brow), BD.black),
    L(S(folds), 'none', { stroke: BD.boneShade, sw: 1.6 }),
    L(S(mouth), BD.mouth),
    L(S(jaw), BD.boneShade, { stroke: BD.black, sw: 1.4 }),
    L(S(boneD), BD.boneWhite, { stroke: BD.black, sw: 1.8 }),
    L(S(boneShine), 'none', { stroke: BD.boneShade, sw: 1.2 }),
    L(S(teeth), BD.white, { stroke: BD.black, sw: 0.5 }),
    L(S(fangs), BD.white, { stroke: BD.black, sw: 1 }),
    L(S(flews), BD.bone, { stroke: BD.black, sw: 1.6 }),
    L(S(philtrum), 'none', { stroke: BD.black, sw: 2 }),
    L(S(roll), BD.boneShade, { stroke: BD.black, sw: 1 }),
    L(S(nose), BD.nose),
    L(nostrils, '#3c3c3c'),
    L(shine, '#5d5d5d'),
    L(shape(tagCmds, back), BD.steelDark, { stroke: BD.black, sw: 1.2 }),
    L(shape(tagCmds, front), BD.steel, { stroke: BD.black, sw: 1.2 }),
    L(tagHole(back) + tagHole(front), BD.black),
    L(ring0, BD.steel, { stroke: BD.black, sw: 0.8 }),
    L(letters, BD.black, { rule: 'evenodd' }),
  ];
  // small: the cog as a plain disc, the head, the muzzle, the scowl and nose, the fangs,
  // the chain as one band and a single tag
  const chain = shape([['M', ...a], ['Q', ...c, ...b]], h);
  const small = [
    L(circle(50, 50, 47), BD.rust),
    L(S(ears), BD.orange, { stroke: BD.black, sw: 5 }),
    L(S(head), BD.orange, { stroke: BD.black, sw: 5 }),
    L(S(muzzle), BD.bone),
    L(S(brow), BD.black),
    L(S(nose), BD.nose),
    L(S(boneD), BD.boneWhite, { stroke: BD.black, sw: 3 }),
    L(S(fangs), BD.white),
    L(S(flews), BD.bone),
    L(chain, 'none', { stroke: BD.black, sw: 8.5 }),
    L(chain, 'none', { stroke: BD.steel, sw: 4 }),
    L(shape(tagCmds, T({ tx: mid[0], ty: mid[1] + 1.4 })), BD.steel, { stroke: BD.black, sw: 2.6 }),
  ];
  return { box: 100, layers, small };
}

// MARQUEE MARAUDERS. A great helm, front on, on a heater shield, with a plume that
// breaks the shield's edge.
const MM = { navy: '#00205b', blue: '#1e4fa3', white: '#ffffff', ice: '#e3eaf4', silver: '#a9b5c4', steel: '#6f7f94', ink: '#00163f' };
function marauders() {
  const shield = (k) => shape([['M', 50 - 37 * k, 50 - 41 * k], ['L', 50 + 37 * k, 50 - 41 * k], ['L', 50 + 37 * k, 50 - 6 * k], ['C', 50 + 37 * k, 50 + 22 * k, 50 + 20 * k, 50 + 37 * k, 50, 50 + 46 * k],
    ['C', 50 - 20 * k, 50 + 37 * k, 50 - 37 * k, 50 + 22 * k, 50 - 37 * k, 50 - 6 * k], ['Z']]);
  const plume = [['M', 49, 24], ['C', 50, 12, 60, 3, 74, 2.5], ['C', 86, 2.2, 95, 9, 97, 18], ['C', 91, 12, 84, 11, 78, 13], ['C', 86, 15, 90, 20, 91, 26],
    ['C', 84, 20, 76, 19, 68, 22], ['C', 63, 24, 59, 27, 56, 30], ['Z']];
  const plumeStreak = [['M', 54, 22], ['C', 58, 12, 68, 6.5, 80, 6.5], ['C', 70, 9, 62, 14, 57, 24], ['Z']];
  const helm = [['M', 30.5, 33], ['C', 30.5, 22.5, 39, 18, 50, 18], ['C', 61, 18, 69.5, 22.5, 69.5, 33], ['L', 69.5, 66], ['C', 69.5, 72.5, 62, 77, 50, 78],
    ['C', 38, 77, 30.5, 72.5, 30.5, 66], ['Z']];
  // the left half lit, the right in shade, so the barrel reads round
  const shade = [['M', 50, 18], ['C', 61, 18, 69.5, 22.5, 69.5, 33], ['L', 69.5, 66], ['C', 69.5, 72.5, 62, 77, 50, 78], ['Z']];
  const slitL = [['M', 32.5, 41], ['L', 46.6, 41], ['L', 46.6, 46], ['L', 33, 46.4], ['Z']];
  const slitR = [['M', 53.4, 41], ['L', 67.5, 41], ['L', 67, 46.4], ['L', 53.4, 46], ['Z']];
  const cross = poly([[47, 19], [53, 19], [53, 39.5], [69.5, 39.5], [69.5, 41], [53, 41], [53, 77.6], [47, 77.6], [47, 41], [30.5, 41], [30.5, 39.5], [47, 39.5]]);
  let breaths = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) breaths += circle(57.5 + c * 3.4 + (r % 2) * 1.7, 53 + r * 4, 0.95);
  let rivets = '';
  for (const y of [24, 31, 58, 66, 73]) rivets += circle(50, y, 1.05);
  rivets += circle(36, 43.6, 0.9) + circle(64, 43.6, 0.9);
  const band = [['M', 30.5, 33], ['L', 69.5, 33], ['L', 69.5, 36], ['L', 30.5, 36], ['Z']];
  const layers = [
    L(shield(1.12), MM.navy),
    L(shield(1.05), MM.white),
    L(shield(0.95), MM.navy),
    L(shield(0.87), MM.blue),
    L(shield(0.84), MM.navy),
    L(shape(plume), MM.white, { stroke: MM.ink, sw: 1.8 }),
    L(shape(plumeStreak), MM.blue),
    L(shape(helm), MM.white, { stroke: MM.ink, sw: 2.2 }),
    L(shape(shade), MM.ice),
    L(shape(band), MM.silver),
    L(cross, MM.silver),
    L(shape(slitL) + shape(slitR), MM.ink),
    L(breaths, MM.ink),
    L(rivets, MM.steel),
    L(shape(helm), 'none', { stroke: MM.ink, sw: 2.2 }),
  ];
  const small = [
    L(shield(1.12), MM.navy),
    L(shield(1.02), MM.white),
    L(shield(0.9), MM.navy),
    L(shape(plume), MM.white),
    L(shape(helm), MM.white),
    L(shape(slitL) + shape(slitR), MM.navy),
    L(bar(50, 46, 50, 72, 5), MM.navy),
  ];
  return { box: 100, layers, small };
}

// COLDWATER HIGHLANDERS. A ginger maniac in the Malcolm sett, face half in woad and
// roaring, cocking a hockey stick over his shoulder the way you'd hold a claymore, on a
// tartan ring.
const HL = { navy: '#16244f', green: '#0d5a32', black: '#141414', ginger: '#e2621b', gingerDeep: '#a33f0c', gingerLight: '#f39a45', skin: '#f2c49d', skinShade: '#d39a6e',
  woad: '#2f63c4', woadDeep: '#1d3f8a', white: '#ffffff', mouth: '#5c1010', wood: '#d4a464', woodDeep: '#93683a', tape: '#1d1d1d', hose: '#efe7d6', red: '#c8102e', boot: '#1a1a1a', silver: '#c9cfd4', fur: '#f3efe6' };
function highlanders() {
  const C = 50;
  // the stick, raised overhead in both fists like a claymore about to come down: the
  // butt behind his head, the shaft up to the right, the taped blade at the top
  const butt = [41, 14], heel = [91, 0];
  const shaft = `M${P(...butt)}L${P(...heel)}`;
  const sa = Math.atan2(heel[1] - butt[1], heel[0] - butt[0]);
  // the blade leaves the heel at a hockey lie, toe down and to the right
  const bt = T({ tx: heel[0], ty: heel[1], rot: sa + 2.1 });
  const blade = shape([['M', -1.6, -2.4], ['L', 14.4, -2.6], ['C', 16.6, -2.6, 17.4, 0.6, 15.6, 2.2], ['L', 0.4, 2.8], ['C', -1.8, 2.4, -2.6, -0.4, -1.6, -2.4], ['Z']], bt);
  const tapeD = shape([['M', 3.4, -2.5], ['L', 13.6, -2.6], ['C', 15.6, -2.4, 16, 0.8, 14.6, 2.3], ['L', 3.4, 2.7], ['Z']], bt);
  const knob = `M${P(butt[0] - Math.cos(sa) * 1.5, butt[1] - Math.sin(sa) * 1.5)}L${P(butt[0] + Math.cos(sa) * 4.5, butt[1] + Math.sin(sa) * 4.5)}`;
  const onShaft = (t) => [butt[0] + (heel[0] - butt[0]) * t, butt[1] + (heel[1] - butt[1]) * t];
  const fistA = onShaft(0.16), fistB = onShaft(0.3);
  // the body
  const torso = [['M', 31, 49], ['C', 38, 46, 56, 46, 63, 49], ['L', 60, 64], ['L', 34, 64], ['Z']];
  const pec = [['M', 39, 55], ['Q', 43, 58, 47, 55.5], ['M', 47, 55.5], ['Q', 51, 58, 55, 55], ['M', 47, 59], ['L', 47, 64]];
  const sash = [['M', 31, 49.5], ['L', 37.5, 47.6], ['L', 60.8, 62.2], ['L', 59.4, 64.6], ['Z']];
  const belt = [['M', 33.8, 62.4], ['L', 60.2, 62.4], ['L', 60.4, 66], ['L', 33.6, 66], ['Z']];
  const buckle = rrect(44.6, 61.8, 5, 4.8, 0.8);
  // the kilt is drawn knee-length and then taken up, so the legs below it get their length
  const ky = (cmds) => cmds.map((c) => (c[0] === 'Z' ? c : [c[0], ...c.slice(1).map((v, i) => (i % 2 ? 65.8 + (v - 68.8) * 0.784 : v))]));
  const kilt = ky([['M', 33.4, 68.8], ['L', 60.6, 68.8], ['L', 64.8, 85.6], ['L', 61.6, 84.6], ['L', 58.4, 86.2], ['L', 55.2, 84.8], ['L', 52, 86.4], ['L', 48.8, 84.9],
    ['L', 45.6, 86.4], ['L', 42.4, 84.8], ['L', 39.2, 86.2], ['L', 36, 84.6], ['L', 32.4, 85.8], ['Z']]);
  const pleats = ky([['M', 39.6, 70], ['L', 38.4, 84.4], ['M', 45.4, 70], ['L', 45, 85.2], ['M', 51.2, 70], ['L', 51.8, 85.2], ['M', 57, 70], ['L', 58.4, 84.6]]);
  const sporran = ky([['M', 44, 70.5], ['L', 50.2, 70.5], ['C', 52, 74, 51.6, 78.4, 47.1, 80.2], ['C', 42.6, 78.4, 42.2, 74, 44, 70.5], ['Z']]);
  const tassels = bar(45.4, 71.5, 45.2, 75.4, 1.2) + bar(48.8, 71.5, 49, 75.4, 1.2);
  // legs, hose, flashes and boots
  const legs = rrect(36.4, 78.6, 7.2, 8.6, 2.4) + rrect(51.4, 78.6, 7.2, 8.6, 2.4);
  const hose = rrect(35.6, 85.4, 8.6, 9.8, 1.4) + rrect(51, 85.4, 8.6, 9.8, 1.4);
  const flashes = poly([[35.6, 86.4], [32.6, 90.8], [35.6, 89.8]]) + poly([[59.6, 86.4], [62.6, 90.8], [59.6, 89.8]]);
  const boots = shape([['M', 34.4, 94.6], ['L', 44.4, 94.6], ['L', 44.4, 98.8], ['L', 31, 98.8], ['C', 31, 96.6, 32.6, 95.4, 34.4, 94.6], ['Z'],
    ['M', 50.8, 94.6], ['L', 60.8, 94.6], ['C', 62.6, 95.4, 64.2, 96.6, 64.2, 98.8], ['L', 50.8, 98.8], ['Z']]);
  // arms: an A round the head, elbows out, both fists on the shaft above it
  const armL = `M33 49.4L26.4 36L${P(fistA[0] - 1, fistA[1] + 2)}`;
  const armR = `M61 49.4L68.4 35L${P(fistB[0] + 1, fistB[1] + 2.4)}`;
  const fists = circle(...fistA, 4.2) + circle(...fistB, 4.2);
  // the head: hair blown back in flames, a forked beard, the face half woad
  const hc = [47, 28];
  const hair = [];
  const spikes = 15;
  for (let i = 0; i <= spikes * 2; i++) {
    const a = Math.PI * 0.92 + (i / (spikes * 2)) * Math.PI * 1.16;
    const r = i % 2 ? 13.6 : 19 + (i % 4 === 0 ? 1.6 : 0);
    hair.push([hc[0] + r * Math.cos(a), hc[1] + 1 + r * Math.sin(a) * 0.96]);
  }
  hair.push([hc[0] + 10, hc[1] + 10], [hc[0] - 10, hc[1] + 10]);
  const beard = [['M', 36.4, 29], ['C', 35, 37, 36.6, 45, 40.4, 50.6], ['L', 42.6, 47.6], ['L', 44.4, 53.6], ['L', 47, 48.6], ['L', 49.6, 53.6], ['L', 51.4, 47.6], ['L', 53.6, 50.6],
    ['C', 57.4, 45, 59, 37, 57.6, 29], ['C', 55, 34, 52, 36, 47, 36], ['C', 42, 36, 39, 34, 36.4, 29], ['Z']];
  const face = ellipse(hc[0], hc[1] + 1.4, 9.6, 11.2, 0, 48);
  const woad = poly(ellipseSide(hc[0], hc[1] + 1.4, 9.6, 11.2, hc[0] + 0.6, hc[1], -0.99, 0.12));
  const brows = poly([[39.4, 24.4], [46, 27.2], [45.6, 28.8], [39, 26.4]]) + poly([[54.6, 24.4], [48, 27.2], [48.4, 28.8], [55, 26.4]]);
  const eyes = circle(42.4, 29.4, 2.5) + circle(51.6, 29.4, 2.5);
  const pupils = circle(42.9, 29.7, 0.95) + circle(51.1, 29.7, 0.95);
  const mouth = shape([['M', 41.8, 36], ['C', 43.4, 34.6, 50.6, 34.6, 52.2, 36], ['C', 52.4, 41, 50, 44.6, 47, 44.6], ['C', 44, 44.6, 41.6, 41, 41.8, 36], ['Z']]);
  const teeth = shape([['M', 42.6, 36.2], ['L', 51.4, 36.2], ['L', 51, 38], ['L', 43, 38], ['Z']]);
  const tongue = ellipse(47, 42.6, 3, 1.6);
  const tache = shape([['M', 47, 33.2], ['C', 44, 32, 40, 32.6, 38.6, 36.4], ['C', 41.4, 35, 44.4, 35, 47, 35.6], ['C', 49.6, 35, 52.6, 35, 55.4, 36.4], ['C', 54, 32.6, 50, 32, 47, 33.2], ['Z']]);
  const nose = shape([['M', 47, 28.6], ['L', 49.2, 33.2], ['L', 44.8, 33.2], ['Z']]);
  const roundel = [
    L(circle(C, C, 48.6), HL.black),
    L(circle(C, C, 47.4), 'sett'),
    L(circle(C, C, 39.4), HL.black),
    L(circle(C, C, 38.2), HL.navy),
  ];
  const figure = [
    L(shaft, 'none', { stroke: HL.black, sw: 5.6 }),
    L(shaft, 'none', { stroke: HL.wood, sw: 3.4 }),
    L(knob, 'none', { stroke: HL.tape, sw: 5 }),
    L(blade, HL.wood, { stroke: HL.black, sw: 1.4 }),
    L(tapeD, HL.tape),
    L(shape(boots), HL.boot, { stroke: HL.black, sw: 1.2 }),
    L(hose, HL.hose, { stroke: HL.black, sw: 1.2 }),
    L(flashes, HL.red, { stroke: HL.black, sw: 0.8 }),
    L(legs, HL.skin, { stroke: HL.black, sw: 1.2 }),
    L(shape(kilt), 'sett', { stroke: HL.black, sw: 1.4 }),
    L(shape(pleats), 'none', { stroke: 'rgba(0,0,0,0.45)', sw: 0.8 }),
    L(shape(torso), HL.skin, { stroke: HL.black, sw: 1.4 }),
    L(shape(pec), 'none', { stroke: HL.skinShade, sw: 1.1 }),
    L(shape(sash), 'sett', { stroke: HL.black, sw: 1.2 }),
    L(shape(belt), HL.black),
    L(buckle, HL.silver, { stroke: HL.black, sw: 0.7 }),
    L(shape(sporran), HL.fur, { stroke: HL.black, sw: 1 }),
    L(tassels, HL.black),
    L(armL + armR, 'none', { stroke: HL.black, sw: 7 }),
    L(armL + armR, 'none', { stroke: HL.skin, sw: 4.8 }),
    L(poly(hair), HL.ginger, { stroke: HL.black, sw: 1.4 }),
    L(face, HL.skin, { stroke: HL.black, sw: 1.2 }),
    L(woad, HL.woad),
    L(shape(beard), HL.ginger, { stroke: HL.black, sw: 1.2 }),
    L(shape(tache), HL.gingerDeep),
    L(mouth, HL.mouth, { stroke: HL.black, sw: 0.9 }),
    L(teeth, HL.white),
    L(tongue, '#b8343a'),
    L(nose, HL.skinShade),
    L(eyes, HL.white, { stroke: HL.black, sw: 0.7 }),
    L(pupils, HL.black),
    L(brows, HL.gingerDeep, { stroke: HL.black, sw: 0.6 }),
    L(fists, HL.skin, { stroke: HL.black, sw: 1.3 }),
    L(shape([['M', fistA[0] - 2.6, fistA[1] - 1], ['L', fistA[0] + 1.6, fistA[1] - 3], ['M', fistB[0] - 2.6, fistB[1] - 1], ['L', fistB[0] + 1.6, fistB[1] - 3]]), 'none', { stroke: HL.skinShade, sw: 0.9 }),
  ];
  // the man is drawn full size and set down from his boots, so the fists clear the hair
  const FK = 0.86;
  const layers = [...roundel, ...figure.map((l) => ({ ...l, d: xfD(l.d, FK, 50, 99), ...(l.sw ? { sw: +(l.sw * FK).toFixed(2) } : {}) }))];
  // small: the head alone, big, with the stick crossing behind it, on a plain disc
  const s = T({ sx: 2.05, sy: 2.05, tx: 50 - 47 * 2.05, ty: 50 - 34 * 2.05 });
  const small = [
    L(circle(C, C, 49.5), HL.green),
    L(circle(C, C, 44), HL.navy),
    L(bar(84, 86, 16, 14, 8), HL.wood, { stroke: HL.black, sw: 2 }),
    L(poly(hair, s), HL.ginger, { stroke: HL.black, sw: 2.6 }),
    L(ellipse(50, 50 - 5.6 * 2.05 + 1.4 * 2.05 + 0, 9.6 * 2.05, 11.2 * 2.05, 0, 48), HL.skin, { stroke: HL.black, sw: 2.4 }),
    L(poly(ellipseSide(50, 50 - 6 * 2.05 + 1.4 * 2.05, 9.6 * 2.05, 11.2 * 2.05, 51.2, 0, -0.99, 0.12)), HL.woad),
    L(shape(beard, s), HL.ginger, { stroke: HL.black, sw: 2.4 }),
    L(shape([['M', 41.8, 36], ['C', 43.4, 34.6, 50.6, 34.6, 52.2, 36], ['C', 52.4, 41, 50, 44.6, 47, 44.6], ['C', 44, 44.6, 41.6, 41, 41.8, 36], ['Z']], s), HL.mouth, { stroke: HL.black, sw: 1.6 }),
    L(shape([['M', 42.6, 36.2], ['L', 51.4, 36.2], ['L', 51, 38], ['L', 43, 38], ['Z']], s), HL.white),
    L(circle(...ap(s, 42.4, 29.4), 2.6 * 2.05) + circle(...ap(s, 51.6, 29.4), 2.6 * 2.05), HL.white, { stroke: HL.black, sw: 1.4 }),
    L(circle(...ap(s, 42.9, 29.7), 1.1 * 2.05) + circle(...ap(s, 51.1, 29.7), 1.1 * 2.05), HL.black),
    L(poly([[39.4, 24.4], [46, 27.2], [45.6, 28.8], [39, 26.4]], s) + poly([[54.6, 24.4], [48, 27.2], [48.4, 28.8], [55, 26.4]], s), HL.black),
  ];
  return { box: 100, layers, small, settUnit: 0.15 };
}

// DISTRICT 9 GOONS. A taped fist coming straight at you out of an octagon, knuckles
// bloodied, D9 written on the tape in marker.
const GN = { purple: '#4b2a72', purpleDeep: '#2c1846', purpleLight: '#8e68c0', bone: '#efe5d2', boneShade: '#cdbb9d', black: '#121014', tape: '#f7f4ee', tapeShade: '#c9c2b4', blood: '#a3141c' };
function goons() {
  const oct = (r) => ngon(50, 50, r, 8, -Math.PI / 2 + Math.PI / 8);
  // the fist: four fingers rolled toward you, the thumb across them, the wrist taped
  const fingers = [];
  const fx = [26.5, 37.5, 48.5, 59.5];
  for (let i = 0; i < 4; i++) {
    const x = fx[i], top = 33 + [3, 0, 0.6, 3.6][i], w = 11.4;
    fingers.push(rrect(x, top, w, 26 - [3, 0, 0.6, 3.6][i], 5.4));
  }
  const knuckleLines = shape([['M', 28, 46], ['Q', 32, 47.6, 36.4, 46], ['M', 39, 44.6], ['Q', 43.2, 46.2, 47.6, 44.6], ['M', 50, 45.2], ['Q', 54.2, 46.8, 58.6, 45.2], ['M', 61, 48], ['Q', 65, 49.6, 69.4, 48]]);
  const blood = ellipse(43.6, 37.6, 2.6, 1.6, 0.2) + ellipse(56, 38, 2.2, 1.4, -0.3) + ellipse(43, 41.2, 0.9, 1.8) + ellipse(31.2, 40.6, 1.4, 1);
  const thumb = shape([['M', 22.6, 54], ['C', 22.6, 50, 26, 48.6, 30, 49], ['L', 55.6, 52], ['C', 60, 52.6, 61.6, 55.4, 61, 58.4], ['C', 60.4, 61.4, 57, 62.6, 53, 62], ['L', 29, 60.4], ['C', 25, 60, 22.6, 58, 22.6, 54], ['Z']]);
  const nail = shape([['M', 52.4, 53], ['C', 56, 53, 58.6, 54.6, 58.6, 57], ['C', 58.6, 59.4, 56, 60.4, 52.4, 60], ['Z']]);
  const back = shape([['M', 25, 57], ['L', 71.4, 52], ['L', 70.6, 66], ['C', 64, 71, 36, 71, 28, 66], ['Z']]);
  const wrist = shape([['M', 30, 64], ['C', 40, 68, 60, 68, 69.4, 63], ['L', 67.6, 88], ['C', 58, 91, 42, 91, 32.4, 88], ['Z']]);
  const wraps = shape([['M', 31, 70], ['C', 42, 74, 58, 74, 68.8, 69], ['M', 31.6, 76.6], ['C', 42, 80.6, 58, 80.6, 68.4, 75.6], ['M', 32, 83], ['C', 42, 86.6, 58, 86.6, 68, 82]]);
  const layers = [
    L(oct(49.5), GN.black),
    L(oct(47), GN.bone),
    L(oct(43.4), GN.black),
    L(oct(42), GN.purple),
    L(wrist, GN.tape, { stroke: GN.black, sw: 2 }),
    L(wraps, 'none', { stroke: GN.tapeShade, sw: 1.4 }),
    L(glyph('D', T({ tx: 36.6, ty: 71.4, sx: 1.9, sy: 1.75, rot: -0.04 })) + glyph('9', T({ tx: 50.4, ty: 70.8, sx: 1.9, sy: 1.75, rot: -0.04 })), GN.purpleDeep, { rule: 'evenodd' }),
    L(back, GN.bone, { stroke: GN.black, sw: 2 }),
    L(fingers.join(''), GN.bone, { stroke: GN.black, sw: 2 }),
    L(knuckleLines, 'none', { stroke: GN.boneShade, sw: 1.4 }),
    L(blood, GN.blood),
    L(thumb, GN.bone, { stroke: GN.black, sw: 2 }),
    L(nail, GN.boneShade),
  ];
  const small = [
    L(oct(49.5), GN.bone),
    L(oct(43.5), GN.purple),
    L(wrist, GN.tape, { stroke: GN.black, sw: 3.6 }),
    L(back, GN.bone, { stroke: GN.black, sw: 3.6 }),
    L(fingers.join(''), GN.bone, { stroke: GN.black, sw: 3.6 }),
    L(thumb, GN.bone, { stroke: GN.black, sw: 3.6 }),
  ];
  return { box: 100, layers, small };
}

// DOCKS BOARDERS. An anchor over two crossed sticks, inside a rope ring.
const DK = { teal: '#00727a', tealDeep: '#004d55', navy: '#0b2341', rope: '#d8b67e', ropeDark: '#8c6a3a', white: '#ffffff', wood: '#cfa36a', ink: '#081a30' };
function docks() {
  const C = 50;
  let twists = '';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU, a2 = a + 0.1;
    twists += poly([[C + 40.6 * Math.cos(a), C + 40.6 * Math.sin(a)], [C + 47 * Math.cos(a2 + 0.06), C + 47 * Math.sin(a2 + 0.06)], [C + 47 * Math.cos(a2 + 0.12), C + 47 * Math.sin(a2 + 0.12)], [C + 40.6 * Math.cos(a + 0.06), C + 40.6 * Math.sin(a + 0.06)]]);
  }
  const stick = (flip) => {
    const t = flip ? T({ sx: -1, tx: 100 }) : null;
    return [
      L(poly([[22, 22.4], [25.4, 19], [76.8, 70.4], [73.4, 73.8]], t), DK.wood, { stroke: DK.ink, sw: 1.4 }),
      L(shape([['M', 73.4, 73.8], ['L', 76.8, 70.4], ['C', 80, 74, 84, 75.6, 88, 74.6], ['L', 87, 80], ['C', 82, 81, 76.4, 79, 73.4, 73.8], ['Z']], t), DK.wood, { stroke: DK.ink, sw: 1.4 }),
      L(poly([[79.6, 74.6], [81.2, 73.1], [83.2, 78.6], [81.4, 79]], t), DK.navy),
    ];
  };
  const anchor = shape([
    ['M', 47.2, 25.6], ['C', 43.6, 24.4, 42.2, 21, 43.4, 18], ['C', 44.6, 14.8, 48, 13.4, 50, 13.4], ['C', 52, 13.4, 55.4, 14.8, 56.6, 18], ['C', 57.8, 21, 56.4, 24.4, 52.8, 25.6],
    ['L', 52.8, 28.4], ['L', 66, 28.4], ['C', 67.6, 28.4, 68.6, 29.4, 68.6, 30.9], ['C', 68.6, 32.4, 67.6, 33.4, 66, 33.4], ['L', 52.8, 33.4],
    ['L', 52.8, 79.4], ['C', 61, 78.6, 67.6, 74.6, 71.4, 67], ['L', 66.2, 66.4], ['L', 75.6, 57.4], ['L', 78.4, 70.8], ['L', 74.6, 68.6],
    ['C', 70.4, 79, 61.4, 85.4, 50, 86.4], ['C', 38.6, 85.4, 29.6, 79, 25.4, 68.6], ['L', 21.6, 70.8], ['L', 24.4, 57.4], ['L', 33.8, 66.4], ['L', 28.6, 67],
    ['C', 32.4, 74.6, 39, 78.6, 47.2, 79.4], ['L', 47.2, 33.4], ['L', 34, 33.4], ['C', 32.4, 33.4, 31.4, 32.4, 31.4, 30.9], ['C', 31.4, 29.4, 32.4, 28.4, 34, 28.4], ['L', 47.2, 28.4], ['Z'],
  ]);
  const eye = hole(50, 19.6, 3.1);
  const layers = [
    L(circle(C, C, 49.4), DK.navy),
    L(ring(C, C, 40.6, 47), DK.rope),
    L(twists, DK.ropeDark),
    L(ring(C, C, 40.2, 40.9), DK.ink),
    L(circle(C, C, 40.2), DK.teal),
    L(ring(C, C, 35.6, 36.6), DK.tealDeep),
    ...stick(false), ...stick(true),
    L(anchor + eye, DK.white, { stroke: DK.ink, sw: 2 }),
  ];
  const small = [
    L(circle(C, C, 49.5), DK.rope),
    L(circle(C, C, 42.5), DK.teal),
    L(anchor + eye, DK.white, { stroke: DK.ink, sw: 3.2 }),
  ];
  return { box: 100, layers, small };
}

// ST GARNEAU GUILLOTINES. Father Jerome's club, out of St Garneau's in Nine Elms. A bold
// G whose crossbar carries a guillotine: the posts stand on the bar where a G keeps its
// serif, the beam closes the G's open jaw, and the blade hangs raised between them.
const SG = { red: '#af1e2d', redDeep: '#7d1520', blue: '#192168', blueDeep: '#0f1440', white: '#ffffff', steel: '#d6dce3', steelDeep: '#8f9aa6' };
function guillotines() {
  const C = 50, cy = 53.5, R = 33.5, r = 18.5;
  const at = (a, rad) => [C + rad * Math.cos(a), cy + rad * Math.sin(a)];
  // the G: a ring from its crossbar (3 o'clock) round the bottom, the left and the top to
  // its upper terminal, plus the bar itself, squared off at the jaw
  // the upper terminal is cut square, on the line the guillotine's left post stands on
  const cut = C + 6.5;
  const o1x = cut, o1y = cy - Math.sqrt(R * R - (cut - C) ** 2), i1x = cut, i1y = cy - Math.sqrt(r * r - (cut - C) ** 2);
  const [o0x, o0y] = at(0, R), [i0x, i0y] = at(0, r);
  const ringD = `M${P(o0x, o0y)}A${n2(R)} ${n2(R)} 0 1 1 ${P(o1x, o1y)}L${P(i1x, i1y)}A${n2(r)} ${n2(r)} 0 1 0 ${P(i0x, i0y)}Z`;
  const barD = poly([[C + 2, cy - 3], [C + R, cy - 3], [C + R, cy + 11], [C + 2, cy + 11]]);
  const G = ringD + barD;
  // the guillotine, standing on the bar
  // the beam runs on from the G's top, so the guillotine reads as the G's serif
  const pl = [C + 9.5, C + 12.5], pr = [C + 23.5, C + 26.5], beamTop = cy - Math.sqrt(R * R - (cut - C) ** 2), top = beamTop + 4;
  const posts = poly([[pl[0], cy - 3], [pl[1], cy - 3], [pl[1], top], [pl[0], top]]) + poly([[pr[0], cy - 3], [pr[1], cy - 3], [pr[1], top], [pr[0], top]]);
  const beam = poly([[cut, beamTop], [C + 29, beamTop], [C + 29, top + 0.5], [cut, top + 0.5]]);
  const blade = poly([[pl[1], top], [pr[0], top], [pr[0], cy - 22.5], [pl[1], cy - 17.5]]);
  const edge = poly([[pl[1], cy - 19.4], [pr[0], cy - 24.4], [pr[0], cy - 22.5], [pl[1], cy - 17.5]]);
  const lunette = poly([[pl[1], cy - 11], [pr[0], cy - 11], [pr[0], cy - 6], [pl[1], cy - 6]]);
  const neck = circle((pl[1] + pr[0]) / 2, cy - 8.5, 1.9);
  const field = (k) => circle(50, 50, k);
  const layers = [
    L(field(49.5), SG.blue),
    L(field(45.6), SG.white),
    L(ring(50, 50, 41.4, 43.2), SG.red),
    L(G, SG.blue, { stroke: SG.blue, sw: 5 }),
    L(G, SG.red),
    L(posts + beam, SG.blue, { stroke: SG.blue, sw: 1 }),
    L(blade, SG.steel, { stroke: SG.blueDeep, sw: 1.1 }),
    L(edge, SG.steelDeep),
    L(lunette, SG.blue),
    L(neck, SG.white),
  ];
  // small: the same G and frame, heavier, without the keylines and the lunette
  const small = [
    L(field(49.5), SG.blue),
    L(field(44), SG.white),
    L(G, SG.red, { stroke: SG.red, sw: 2 }),
    L(posts + beam, SG.blue, { stroke: SG.blue, sw: 2.6 }),
    L(blade, SG.steelDeep),
  ];
  return { box: 100, layers, small };
}

// YARDS ICEHAULERS. Ice tongs biting a block, on a maroon plate.
const IH = { maroon: '#7a1f2b', maroonDeep: '#4f111b', steel: '#b6bec4', steelDeep: '#6b747b', ice: '#d8eef8', iceMid: '#a9d4ea', iceDeep: '#78b3d3', white: '#ffffff', black: '#141414', wood: '#c99a5c' };
function yards() {
  const hex = (r) => ngon(50, 50, r, 6, 0);
  // the block in three-quarter view: top, left face, right face
  const top = poly([[50, 46], [72, 55.6], [50, 65.2], [28, 55.6]]);
  const left = poly([[28, 55.6], [50, 65.2], [50, 91], [28, 81.4]]);
  const right = poly([[50, 65.2], [72, 55.6], [72, 81.4], [50, 91]]);
  const cracks = shape([['M', 34, 62], ['L', 38, 69], ['L', 36, 74], ['M', 60, 70], ['L', 64, 66], ['L', 67, 72], ['M', 44, 54], ['L', 52, 52]]);
  const shine = poly([[30.6, 60.6], [33.4, 61.8], [33.4, 78.2], [30.6, 77]]) + poly([[53.6, 66.6], [60, 63.8], [60, 65.6], [53.6, 68.4]]);
  // the tongs: two arms crossing at the pivot, points bitten into the block's sides,
  // a bail handle over the top
  const arm = (m) => {
    const t = m ? T({ sx: -1, tx: 100 }) : null;
    return shape([['M', 61, 18], ['C', 58, 22, 52, 26, 47.6, 31], ['C', 36, 43, 26, 52, 26.4, 66], ['C', 26.6, 70, 29, 72.6, 32.4, 72.4], ['L', 31.6, 68.4],
      ['C', 30.4, 66.4, 30.4, 62, 31, 59], ['C', 33.4, 50, 42, 42, 52, 34], ['C', 56, 30.6, 61.4, 26, 64.6, 21.6], ['Z']], t);
  };
  const pivot = circle(50, 32.6, 3.4);
  const bail = shape([['M', 59.4, 18.6], ['L', 54.6, 12], ['L', 45.4, 12], ['L', 40.6, 18.6], ['L', 43.4, 19.8], ['L', 47, 15], ['L', 53, 15], ['L', 56.6, 19.8], ['Z']]);
  const grip = rrect(39, 7.6, 22, 5.4, 2.6);
  const layers = [
    L(hex(49.6), IH.black),
    L(hex(47.4), IH.steel),
    L(hex(43.6), IH.black),
    L(hex(42.2), IH.maroon),
    L(left, IH.iceMid, { stroke: IH.black, sw: 1.6 }),
    L(right, IH.iceDeep, { stroke: IH.black, sw: 1.6 }),
    L(top, IH.ice, { stroke: IH.black, sw: 1.6 }),
    L(cracks, 'none', { stroke: IH.white, sw: 1.2 }),
    L(shine, IH.white, { op: 0.85 }),
    L(bail, IH.steelDeep, { stroke: IH.black, sw: 1.4 }),
    L(grip, IH.wood, { stroke: IH.black, sw: 1.6 }),
    L(arm(false), IH.steel, { stroke: IH.black, sw: 1.6 }),
    L(arm(true), IH.steel, { stroke: IH.black, sw: 1.6 }),
    L(pivot, IH.steelDeep, { stroke: IH.black, sw: 1.4 }),
  ];
  const small = [
    L(hex(49.6), IH.steel),
    L(hex(43.4), IH.maroon),
    L(left, IH.iceMid, { stroke: IH.black, sw: 2.6 }),
    L(right, IH.iceDeep, { stroke: IH.black, sw: 2.6 }),
    L(top, IH.ice, { stroke: IH.black, sw: 2.6 }),
    L(arm(false), IH.steel, { stroke: IH.black, sw: 2.6 }),
    L(arm(true), IH.steel, { stroke: IH.black, sw: 2.6 }),
    L(grip, IH.steel, { stroke: IH.black, sw: 2.6 }),
  ];
  return { box: 100, layers, small };
}

// ── the Malcolm sett ────────────────────────────────────────────────────────────
// The Malcolm tartan as W. & A. Smith recorded it in 1850, transcribed from the Tartan
// Dictionary: K/4 Y4 K4 G24 K24 DB24 R4 DB4 R4 DB24 K24 G24 K4 LB/4, 344 threads to the
// repeat. Modern dyes: green, black and navy, with the red pair in the blue and the yellow
// and azure guards in the black.
const MALCOLM = {
  name: 'Malcolm',
  threads: 'K/4 Y4 K4 G24 K24 DB24 R4 DB4 R4 DB24 K24 G24 K4 LB/4',
  colours: { K: '#101010', Y: '#e8c000', G: '#00602a', DB: '#1c2c6a', R: '#c8102e', LB: '#3b88c8' },
};

// ── the kits ────────────────────────────────────────────────────────────────────
// A kit is what a body wears. `jersey`/`trim`/`pants`/`sock`/`glove`/`helmet` are the
// solid colours every renderer understands. `number` and `numberEdge` letter the back.
// `hem`, `sleeve` and `socks` are bands: `at` and `w` as fractions of the hem-to-collar,
// elbow-to-wrist or knee-to-ankle run, `col` the colour, and `pattern` ('gems', 'sett')
// a richer fill where the renderer can paint one. `yoke` is the shoulder band's colour.
// `body: 'sett'` weaves the whole sweater in the club's tartan.
const band = (at, w, col, pattern) => (pattern ? { at, w, col, pattern } : { at, w, col });

function kit(o) { return o; }

// ── the league ──────────────────────────────────────────────────────────────────
export const CLUBS = {
  'Westside Warlords': {
    district: 'glasshouse', home: 'the Glasshouse',
    colours: ['#f6b51e', '#0e0e0f'],
    crest: warlords(),
    gems: { band: WL.gold, gem: WL.gem, edge: WL.black },
    kit: {
      home: kit({ jersey: '#121212', trim: '#f6b51e', number: '#f6b51e', numberEdge: '#000000', pants: '#0b0b0b', sock: '#121212', glove: '#1a1a1a', helmet: '#121212',
        yoke: '#f6b51e', hem: [band(0.0, 0.07, '#f6b51e', 'gems'), band(0.115, 0.02, '#f6b51e')], sleeve: [band(0.3, 0.14, '#f6b51e', 'gems'), band(0.5, 0.05, '#f6b51e')], socks: [band(0.28, 0.14, '#f6b51e'), band(0.46, 0.06, '#f6b51e')] }),
      road: kit({ jersey: '#f4f2ec', trim: '#121212', number: '#121212', numberEdge: '#f6b51e', pants: '#0b0b0b', sock: '#f4f2ec', glove: '#121212', helmet: '#121212',
        yoke: '#121212', hem: [band(0.0, 0.07, '#121212', 'gems'), band(0.115, 0.02, '#f6b51e')], sleeve: [band(0.3, 0.14, '#121212', 'gems'), band(0.5, 0.05, '#f6b51e')], socks: [band(0.28, 0.14, '#121212'), band(0.46, 0.06, '#f6b51e')] }),
    },
  },
  'Boomtown Bulldogs': {
    district: null, home: 'the Rust Quarter',
    colours: ['#f37021', '#111111'],
    crest: bulldogs(),
    kit: {
      home: kit({ jersey: '#f37021', trim: '#111111', number: '#111111', numberEdge: '#ffffff', pants: '#111111', sock: '#f37021', glove: '#111111', helmet: '#111111',
        yoke: '#111111', hem: [band(0.0, 0.06, '#111111'), band(0.07, 0.02, '#ffffff'), band(0.1, 0.03, '#111111')], sleeve: [band(0.28, 0.11, '#111111'), band(0.41, 0.03, '#ffffff'), band(0.46, 0.05, '#111111')], socks: [band(0.26, 0.12, '#111111'), band(0.4, 0.04, '#ffffff'), band(0.46, 0.06, '#111111')] }),
      road: kit({ jersey: '#f6f3ee', trim: '#f37021', number: '#f37021', numberEdge: '#111111', pants: '#111111', sock: '#f6f3ee', glove: '#111111', helmet: '#111111',
        yoke: '#f37021', hem: [band(0.0, 0.06, '#f37021'), band(0.07, 0.02, '#111111'), band(0.1, 0.03, '#f37021')], sleeve: [band(0.28, 0.11, '#f37021'), band(0.41, 0.03, '#111111'), band(0.46, 0.05, '#f37021')], socks: [band(0.26, 0.12, '#f37021'), band(0.4, 0.04, '#111111'), band(0.46, 0.06, '#f37021')] }),
    },
  },
  'Marquee Marauders': {
    district: 'nightlife', home: 'the Marquee',
    colours: ['#00205b', '#ffffff'],
    crest: marauders(),
    kit: {
      home: kit({ jersey: '#00205b', trim: '#ffffff', number: '#ffffff', numberEdge: '#00163f', pants: '#00205b', sock: '#00205b', glove: '#00205b', helmet: '#00205b',
        yoke: '#ffffff', hem: [band(0.0, 0.05, '#ffffff'), band(0.08, 0.05, '#ffffff')], sleeve: [band(0.28, 0.08, '#ffffff'), band(0.42, 0.08, '#ffffff')], socks: [band(0.28, 0.08, '#ffffff'), band(0.42, 0.08, '#ffffff')] }),
      road: kit({ jersey: '#ffffff', trim: '#00205b', number: '#00205b', numberEdge: '#ffffff', pants: '#00205b', sock: '#ffffff', glove: '#00205b', helmet: '#00205b',
        yoke: '#00205b', hem: [band(0.0, 0.05, '#00205b'), band(0.08, 0.05, '#00205b')], sleeve: [band(0.28, 0.08, '#00205b'), band(0.42, 0.08, '#00205b')], socks: [band(0.28, 0.08, '#00205b'), band(0.42, 0.08, '#00205b')] }),
    },
  },
  'Coldwater Highlanders': {
    district: 'marrow', home: 'the Marrow',
    colours: ['#00602a', '#1c2c6a'],
    sett: MALCOLM,
    crest: highlanders(),
    kit: {
      home: kit({ jersey: '#123a2a', body: 'sett', trim: '#ffffff', number: '#ffffff', numberEdge: '#101010', pants: '#101010', sock: '#1c2c6a', glove: '#101010', helmet: '#1c2c6a',
        yoke: '#1c2c6a', hem: [band(0.0, 0.06, '#1c2c6a'), band(0.065, 0.015, '#c8102e')], sleeve: [band(0.28, 0.06, '#00602a'), band(0.34, 0.04, '#1c2c6a'), band(0.38, 0.02, '#c8102e'), band(0.40, 0.04, '#1c2c6a')], socks: [band(0.24, 0.07, '#00602a'), band(0.31, 0.06, '#101010'), band(0.37, 0.025, '#c8102e'), band(0.395, 0.06, '#1c2c6a'), band(0.455, 0.02, '#e8c000')] }),
      road: kit({ jersey: '#f4f1e8', trim: '#1c2c6a', number: '#1c2c6a', numberEdge: '#c8102e', pants: '#101010', sock: '#f4f1e8', glove: '#101010', helmet: '#1c2c6a',
        yoke: '#1c2c6a', hem: [band(0.0, 0.09, '#00602a', 'sett'), band(0.115, 0.02, '#1c2c6a')], sleeve: [band(0.28, 0.06, '#00602a'), band(0.34, 0.04, '#1c2c6a'), band(0.38, 0.02, '#c8102e'), band(0.40, 0.04, '#1c2c6a')], socks: [band(0.24, 0.07, '#00602a'), band(0.31, 0.06, '#101010'), band(0.37, 0.025, '#c8102e'), band(0.395, 0.06, '#1c2c6a'), band(0.455, 0.02, '#e8c000')] }),
    },
  },
  'District 9 Goons': {
    district: null, home: 'District 9',
    colours: ['#4b2a72', '#efe5d2'],
    crest: goons(),
    kit: {
      home: kit({ jersey: '#4b2a72', trim: '#efe5d2', number: '#efe5d2', numberEdge: '#121014', pants: '#121014', sock: '#4b2a72', glove: '#121014', helmet: '#121014',
        yoke: '#121014', hem: [band(0.0, 0.07, '#121014'), band(0.075, 0.03, '#efe5d2')], sleeve: [band(0.28, 0.1, '#121014'), band(0.38, 0.05, '#efe5d2')], socks: [band(0.26, 0.11, '#121014'), band(0.37, 0.05, '#efe5d2')] }),
      road: kit({ jersey: '#efe5d2', trim: '#4b2a72', number: '#4b2a72', numberEdge: '#121014', pants: '#121014', sock: '#efe5d2', glove: '#121014', helmet: '#121014',
        yoke: '#4b2a72', hem: [band(0.0, 0.07, '#4b2a72'), band(0.075, 0.03, '#121014')], sleeve: [band(0.28, 0.1, '#4b2a72'), band(0.38, 0.05, '#121014')], socks: [band(0.26, 0.11, '#4b2a72'), band(0.37, 0.05, '#121014')] }),
    },
  },
  'Docks Boarders': {
    district: 'docks', home: 'the Docks',
    colours: ['#00727a', '#0b2341'],
    crest: docks(),
    kit: {
      home: kit({ jersey: '#00727a', trim: '#0b2341', number: '#ffffff', numberEdge: '#0b2341', pants: '#0b2341', sock: '#00727a', glove: '#0b2341', helmet: '#0b2341',
        yoke: '#0b2341', hem: [band(0.0, 0.05, '#0b2341'), band(0.055, 0.025, '#d8b67e'), band(0.085, 0.05, '#0b2341')], sleeve: [band(0.28, 0.08, '#0b2341'), band(0.36, 0.04, '#d8b67e'), band(0.4, 0.08, '#0b2341')], socks: [band(0.26, 0.08, '#0b2341'), band(0.34, 0.04, '#d8b67e'), band(0.38, 0.08, '#0b2341')] }),
      road: kit({ jersey: '#f4f6f6', trim: '#00727a', number: '#00727a', numberEdge: '#0b2341', pants: '#0b2341', sock: '#f4f6f6', glove: '#0b2341', helmet: '#0b2341',
        yoke: '#00727a', hem: [band(0.0, 0.05, '#00727a'), band(0.055, 0.025, '#0b2341'), band(0.085, 0.05, '#00727a')], sleeve: [band(0.28, 0.08, '#00727a'), band(0.36, 0.04, '#0b2341'), band(0.4, 0.08, '#00727a')], socks: [band(0.26, 0.08, '#00727a'), band(0.34, 0.04, '#0b2341'), band(0.38, 0.08, '#00727a')] }),
    },
  },
  'St Garneau Guillotines': {
    district: 'residential', home: 'Nine Elms',
    colours: ['#af1e2d', '#192168'],
    crest: guillotines(),
    kit: {
      home: kit({ jersey: '#af1e2d', trim: '#192168', number: '#ffffff', numberEdge: '#192168', pants: '#192168', sock: '#af1e2d', glove: '#192168', helmet: '#192168',
        yoke: '#192168', hem: [band(0.0, 0.02, '#ffffff'), band(0.025, 0.07, '#192168'), band(0.1, 0.02, '#ffffff')], sleeve: [band(0.28, 0.03, '#ffffff'), band(0.31, 0.1, '#192168'), band(0.41, 0.03, '#ffffff')], socks: [band(0.24, 0.04, '#ffffff'), band(0.28, 0.12, '#192168'), band(0.4, 0.04, '#ffffff')] }),
      road: kit({ jersey: '#f6f6f4', trim: '#af1e2d', number: '#af1e2d', numberEdge: '#192168', pants: '#192168', sock: '#f6f6f4', glove: '#192168', helmet: '#192168',
        yoke: '#af1e2d', hem: [band(0.0, 0.02, '#af1e2d'), band(0.025, 0.07, '#192168'), band(0.1, 0.02, '#af1e2d')], sleeve: [band(0.28, 0.03, '#af1e2d'), band(0.31, 0.1, '#192168'), band(0.41, 0.03, '#af1e2d')], socks: [band(0.24, 0.04, '#af1e2d'), band(0.28, 0.12, '#192168'), band(0.4, 0.04, '#af1e2d')] }),
    },
  },
  'Yards Icehaulers': {
    district: 'yards', home: 'the Yards',
    colours: ['#7a1f2b', '#b6bec4'],
    crest: yards(),
    kit: {
      home: kit({ jersey: '#7a1f2b', trim: '#b6bec4', number: '#ffffff', numberEdge: '#4f111b', pants: '#4f111b', sock: '#7a1f2b', glove: '#4f111b', helmet: '#7a1f2b',
        yoke: '#b6bec4', hem: [band(0.0, 0.06, '#b6bec4'), band(0.075, 0.03, '#a9d4ea')], sleeve: [band(0.28, 0.09, '#b6bec4'), band(0.39, 0.04, '#a9d4ea')], socks: [band(0.26, 0.1, '#b6bec4'), band(0.38, 0.04, '#a9d4ea')] }),
      road: kit({ jersey: '#f3f1ef', trim: '#7a1f2b', number: '#7a1f2b', numberEdge: '#b6bec4', pants: '#4f111b', sock: '#f3f1ef', glove: '#4f111b', helmet: '#7a1f2b',
        yoke: '#7a1f2b', hem: [band(0.0, 0.06, '#7a1f2b'), band(0.075, 0.03, '#b6bec4')], sleeve: [band(0.28, 0.09, '#7a1f2b'), band(0.39, 0.04, '#b6bec4')], socks: [band(0.26, 0.1, '#7a1f2b'), band(0.38, 0.04, '#b6bec4')] }),
    },
  },
};

// ── write ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const row = JSON.parse(fs.readFileSync(ROW, 'utf8'));
  const sp = row.sports_pools || {};
  const teams = Array.isArray(sp.teams) ? sp.teams : [];
  const missing = teams.filter((t) => !CLUBS[t]), extra = Object.keys(CLUBS).filter((t) => !teams.includes(t));
  if (missing.length || extra.length) {
    console.error(`✗ the row's teams and the clubs here disagree. No identity: ${missing.join(', ') || '—'}. Not in the league: ${extra.join(', ') || '—'}.`);
    process.exit(1);
  }
  const next = JSON.stringify(CLUBS);
  const cur = JSON.stringify(sp.clubs || null);
  if (process.argv.includes('--check')) {
    if (next !== cur) { console.error('✗ sports_pools.clubs is out of date: run node scripts/content/build-cphl-clubs.mjs'); process.exit(1); }
  } else {
    sp.clubs = CLUBS;
    row.sports_pools = sp;
    fs.writeFileSync(ROW, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
    console.log(`  wrote ${Object.keys(CLUBS).length} clubs into ${path.relative(ROOT, ROW)} (${(next.length / 1024).toFixed(1)} KB)`);
  }
}
