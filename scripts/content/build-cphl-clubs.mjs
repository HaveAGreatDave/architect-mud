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
// It also writes client/shared/cphl-crests.js, the copy GLASS paints on the shields of
// Golden Goose Gardens (see "the copy GLASS draws" at the bottom), and --check fails while
// that file is behind too.
//
// A crest is layers in a 100-unit box (client/game/js/panels/club-crest.js draws it):
// `layers` is the full drawing, `small` the one used under about 34px. Colours are the
// club's own; 'sett' fills with the club's tartan. A keeper's mask is the same kind of
// layers, drawn in the mask's own flattening (see "the keepers' masks").
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { maskUV, maskOutline, MASK_EL_MIN } from '../../client/game/js/panels/gl/arena-mesh.js';

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

// ── figures ───────────────────────────────────────────────────────────────────────
// Characters (the Highlander, the Yard Birds' cock) are built from limbs and feathers and
// inked as cut-outs.
const add = (p, q) => [p[0] + q[0], p[1] + q[1]], sub = (p, q) => [p[0] - q[0], p[1] - q[1]], mul = (p, k) => [p[0] * k, p[1] * k];
const nrm = (p) => { const l = Math.hypot(p[0], p[1]) || 1; return [p[0] / l, p[1] / l]; };
// A limb from joint a to joint b, run a little past both so its neighbours bury its ends,
// with a muscle bulge at `at`. Returns its outline and the band of shade on the side away
// from the light.
function limb(a, b, wa, wb, o = {}) {
  const { bulge = 0.07, at = 0.4, ext = 1.4, shadeFrac = 0.4 } = o;
  const u = nrm(sub(b, a)), A = sub(a, mul(u, ext)), B = add(b, mul(u, ext)), d = sub(B, A), len = Math.hypot(d[0], d[1]), n = [-u[1], u[0]];
  const edge = (f) => {
    const wm = (wa + (wb - wa) * at) / 2 + bulge * len;
    return [add(A, mul(n, f * wa / 2)), add(add(A, mul(d, at * 0.7)), mul(n, f * wm)),
      add(add(A, mul(d, Math.min(0.95, at * 0.7 + 0.45))), mul(n, f * (wm * 0.9 + wb * 0.05))), add(B, mul(n, f * wb / 2))];
  };
  const band = (e0, e1) => [['M', ...e0[0]], ['C', ...e0[1], ...e0[2], ...e0[3]], ['L', ...e1[3]], ['C', ...e1[2], ...e1[1], ...e1[0]], ['Z']];
  const sd = (n[0] * 0.6 + n[1] * 0.8) > 0 ? 1 : -1;
  return { outline: band(edge(1), edge(-1)), shade: band(edge(sd * 0.92), edge(sd * (0.92 - shadeFrac * 2))) };
}
// draw a group of shapes as one cut-out: a heavy outline pass under a fill pass, so the
// seams between overlapping parts vanish and only the silhouette is inked
const group = (cmdsList, fill, sw = 2.3, extra = '', ink = '#141414') => {
  const d = cmdsList.map((c) => (typeof c === 'string' ? c : shape(c))).join('') + extra;
  return [L(d, 'none', { stroke: ink, sw }), L(d, fill)];
};

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

// BOOMTOWN BULLDOGS. A bulldog's head, square on and lowered, cut in hard planes: a heavy
// brow pulled down into a V over narrow yellow eyes, the snout wrinkled back in a snarl,
// the upper fangs bared and the underbite's lower fangs jutting up past them, jowls slung
// wide. A studded collar round the neck, and behind it all a rusted cog (the Rust Quarter).
const BD = { orange: '#f37021', orangeDeep: '#b9480b', orangeDark: '#7c2d06', black: '#111111', bone: '#f6ead6', boneShade: '#d9c4a3', white: '#ffffff', mouth: '#4a0b0e',
  steel: '#d3d8dc', steelDark: '#7b848b', nose: '#1b1b1b', rust: '#8a3a12', rustDeep: '#5c260b', eye: '#ffc62a', scar: '#f4b6a6' };
// a closed polygon from its right half, run from a point on the centre line round to another
const sym = (half) => poly([...half, ...half.slice(1, -1).reverse().map(([x, y]) => [100 - x, y])]);
// both halves of a shape drawn on one side of the centre line
const pair = (pts) => poly(pts) + poly(pts.map(([x, y]) => [100 - x, y]).reverse());
const pairLine = (pts) => {
  const one = (p) => 'M' + p.map(([x, y]) => P(x, y)).join('L');
  return one(pts) + one(pts.map(([x, y]) => [100 - x, y]));
};
// points along a quadratic, a to b about c, without the first point
const qp = (a, c, b, n = 6) => Array.from({ length: n }, (_, i) => qAt(a, c, b, (i + 1) / n));
function bulldogs() {
  // Traced from the club's own art (crests/bulldogs.json): the head front-on and glaring,
  // a spiked collar under the jowls, on a dark-orange cog.
  // Flat colours over a black base that is the whole crest grown into an outline.
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/content/crests/bulldogs.json'), 'utf8'));
  const layers = [
    L(tr.ink, BD.black),
    L(tr.dark, '#b04a10'),
    L(tr.orange, BD.orange),
    L(tr.cream, BD.bone),
    L(tr.eye, BD.eye),
  ];
  return { box: 100, layers };
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

// COLDWATER HIGHLANDERS. A ginger maniac in the Malcolm sett, full length and mid-charge:
// roaring, woad down half his face, a hockey stick raised two-handed over his head like a
// claymore, the loose end of his plaid flying behind him. Cel-shaded from the upper left.
const HL = { navy: '#16244f', field: '#efe4c8', fieldRay: '#e2d3ae', green: '#0d5a32', black: '#141414', ginger: '#e2621b', gingerDeep: '#a33f0c', gingerLight: '#f6a24d',
  skin: '#f2c49d', skinShade: '#d9a074', skinDeep: '#b97a52', woad: '#2f63c4', woadDeep: '#1d3f8a', white: '#ffffff', mouth: '#4a0d0d', tongue: '#c0444a',
  wood: '#d4a464', woodDeep: '#93683a', tapeWhite: '#eeeeee', hose: '#efe7d6', hoseShade: '#cbbfa6', red: '#c8102e', boot: '#1a1a1a',
  silver: '#cfd5da', silverDeep: '#8a949c', fur: '#f3efe6', furShade: '#cfc8ba', leather: '#6b4226', leatherDeep: '#3e2414' };
function highlanders() {
  const C = 50, ink = HL.black;
  // ── the skeleton ──
  const SL = [39.6, 38.6], EL = [30.2, 24.6], WL = [40.2, 10.4], FL = [42.6, 7.7];
  const SR = [60.4, 38], ER = [69.2, 22.4], WR = [56.2, 8.4], FR = [53.4, 6.2];
  const HPL = [45.4, 62], KL = [38.6, 77], AL = [32.6, 90.6], TL = [25.4, 94.4];
  const HPR = [54.6, 62], KR = [62.8, 75.2], AR = [64, 90.2], TR = [71.6, 94.4];
  // ── the stick ──
  // the grip sits clear above his head: hands in the hair read as hands in the hair. The
  // shaft runs through both fists, and the blade turns up off the heel at a real stick's
  // lie, about 135° to the shaft. Shaft and blade are inked as one piece, so the heel has
  // no seam.
  const butt = [36.6, 8.6], heel = [74.6, 3.3];
  const sa = Math.atan2(heel[1] - butt[1], heel[0] - butt[0]);
  const shaft = bar(...butt, ...heel, 2.8);
  const grain = `M${P(butt[0] + 12 * Math.cos(sa), butt[1] + 12 * Math.sin(sa) + 0.5)}L${P(butt[0] + 30 * Math.cos(sa), butt[1] + 30 * Math.sin(sa) + 0.5)}`;
  const grip = `M${P(butt[0] - Math.cos(sa) * 0.6, butt[1] - Math.sin(sa) * 0.6)}L${P(butt[0] + Math.cos(sa) * 4.4, butt[1] + Math.sin(sa) * 4.4)}`;
  // the blade's frame: x from the heel to the toe, +y the top edge, the side the shaft is on
  const bt = T({ tx: heel[0], ty: heel[1], rot: sa - Math.PI / 4, sy: -1 }), BL = 14.6;
  const blade = shape([['M', -0.64, 2.62], ['Q', 1, 1.5, 3.2, 1.5], ['L', BL - 1.6, 1.5], ['C', BL + 0.4, 1.5, BL + 1, -0.6, BL - 0.2, -2], ['L', 2.2, -2.4],
    ['C', 0.2, -2.4, -1.6, -1.6, -1.9, -0.05], ['Z']], bt);
  const bladeTape = shape([['M', 3.4, 1.5], ['L', BL - 1.6, 1.5], ['C', BL + 0.4, 1.5, BL + 1, -0.6, BL - 0.2, -2], ['L', 3.4, -2.38], ['Z']], bt);
  const tapeLines = [5.2, 7.2, 9.2, 11.2, 13.2].map((x) => shape([['M', x, 1.5], ['L', x - 0.7, -2.38]], bt)).join('');
  // ── the roundel: a parchment field inside the tartan ring, so the dark sett on him
  // reads, with a burst behind him that stops at the field's edge ──
  const FIELD = 38.2, burstAt = [50, 40];
  const toEdge = (a) => {
    const dx = Math.cos(a), dy = Math.sin(a), ox = burstAt[0] - C, oy = burstAt[1] - C;
    const b = ox * dx + oy * dy, c = ox * ox + oy * oy - FIELD * FIELD;
    const t = -b + Math.sqrt(b * b - c);
    return [burstAt[0] + dx * t, burstAt[1] + dy * t];
  };
  let rays = '';
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * TAU, a1 = a0 + TAU / 40;
    rays += poly([burstAt, toEdge(a0), toEdge((a0 + a1) / 2), toEdge(a1)]);
  }
  const disc = (r) => circle(C, C, r);
  // ── the plaid's loose end, flying back off his left shoulder ──
  const plaid = [['M', 58.4, 34.6], ['C', 66.4, 33.2, 73.4, 38, 75.6, 46], ['C', 77.4, 53.6, 76.2, 61.4, 81.4, 67.6], ['C', 75.4, 67.4, 71.4, 63.4, 69.4, 58.6],
    ['C', 67.6, 64.4, 63.8, 67.8, 59.2, 68.8], ['C', 63.2, 62.8, 64, 54.6, 62.8, 46.6], ['Z']];
  const plaidFolds = [['M', 66.4, 38.6], ['C', 70, 45, 70.6, 52, 69.4, 58.6], ['M', 72.6, 44.6], ['C', 74, 52, 74.6, 59.6, 78.6, 65.6]];
  // ── arms ──
  const uaL = limb(SL, EL, 7.6, 5.8, { bulge: 0.1, at: 0.45 }), faL = limb(EL, WL, 6, 4.4, { bulge: 0.08, at: 0.25 });
  const uaR = limb(SR, ER, 7.6, 5.8, { bulge: 0.1, at: 0.45 }), faR = limb(ER, WR, 6, 4.4, { bulge: 0.08, at: 0.25 });
  const delts = circle(39.4, 38.4, 4.6) + circle(60.6, 37.8, 4.6);
  const elbows = circle(...EL, 3) + circle(...ER, 3);
  const bracer = (e, w) => { const p0 = add(e, mul(sub(w, e), 0.62)), p1 = add(e, mul(sub(w, e), 0.96)); return limb(p0, p1, 5.6, 5, { bulge: 0, ext: 0 }); };
  const brL = bracer(EL, WL), brR = bracer(ER, WR);
  const studs = (e, w) => [0.7, 0.82, 0.94].map((f) => { const q = add(e, mul(sub(w, e), f)); return circle(q[0], q[1], 0.55); }).join('');
  const bicepLines = shape([['M', 33.6, 33.4], ['Q', 35.4, 31, 34.6, 28.4], ['M', 66.4, 32.6], ['Q', 64.6, 30.2, 65.6, 27.4]]);
  // fists, each a clenched block wrapped on the shaft, knuckles toward us
  const fist = (c) => { const t = T({ tx: c[0], ty: c[1], rot: sa }); return shape([['M', -3.2, -2.8], ['L', 2.8, -3], ['Q', 3.8, -2.8, 3.8, -1.6], ['L', 3.8, 2], ['Q', 3.6, 3.2, 2.2, 3.2], ['L', -3, 3], ['Q', -3.8, 2.6, -3.8, 1.4], ['L', -3.8, -1.6], ['Q', -3.8, -2.6, -3.2, -2.8], ['Z']], t); };
  const knuckles = (c) => { const t = T({ tx: c[0], ty: c[1], rot: sa }); return shape([['M', -1.4, -2.8], ['L', -1.4, 1.2], ['M', 0.6, -2.9], ['L', 0.6, 1.2], ['M', 2.4, -2.8], ['L', 2.4, 1]], t); };
  // ── torso ──
  const torso = [['M', 38, 36.2], ['C', 44, 33.8, 56, 33.6, 61.6, 35.6], ['C', 62.4, 38.6, 61.4, 41.6, 59.6, 43.6], ['C', 59.4, 48.6, 58.2, 53.4, 57.6, 57.8],
    ['L', 42.6, 57.8], ['C', 41.8, 53.4, 40.6, 48.6, 40.4, 44], ['C', 38.6, 41.8, 37.4, 39, 38, 36.2], ['Z']];
  const torsoShade = [['M', 57.2, 41], ['C', 58.6, 46, 57.8, 52, 57.4, 57.6], ['L', 54.4, 57.6], ['C', 55.4, 52, 55.8, 46.4, 57.2, 41], ['Z']];
  const pecL = [['M', 41.4, 44.6], ['C', 43.6, 46.8, 47.8, 46.8, 49.6, 44.4]], pecR = [['M', 50.4, 44.4], ['C', 52.2, 46.8, 56.4, 46.8, 58.4, 44.4]];
  const pecShade = [['M', 41.6, 44.8], ['C', 43.8, 47.4, 47.8, 47.4, 49.6, 44.8], ['C', 47.6, 46.2, 43.8, 46.2, 41.6, 44.8], ['Z'], ['M', 50.4, 44.8], ['C', 52.2, 47.4, 56.2, 47.4, 58.2, 44.8], ['C', 56.2, 46.2, 52.4, 46.2, 50.4, 44.8], ['Z']];
  const abs = [['M', 50, 46.8], ['L', 50, 56.6], ['M', 46.4, 49.6], ['Q', 48, 50.4, 49.4, 49.6], ['M', 50.6, 49.6], ['Q', 52, 50.4, 53.6, 49.6], ['M', 46.6, 52.6], ['Q', 48, 53.4, 49.4, 52.6],
    ['M', 50.6, 52.6], ['Q', 52, 53.4, 53.4, 52.6], ['M', 46.8, 55.4], ['Q', 48.2, 56, 49.4, 55.4], ['M', 50.6, 55.4], ['Q', 52, 56, 53.2, 55.4], ['M', 43.4, 50.4], ['Q', 44.6, 53.6, 44.8, 57], ['M', 56.6, 50.4], ['Q', 55.4, 53.6, 55.2, 57]];
  const sash = [['M', 56.8, 35], ['L', 62.6, 37.8], ['L', 45.4, 59.2], ['L', 40.8, 56.4], ['Z']];
  const sashFolds = [['M', 58.6, 38.6], ['L', 44.4, 56.8], ['M', 60.2, 39.8], ['L', 46.4, 57.6]];
  const brooch = circle(60.2, 37.6, 2.8), broochRing = ring(60.2, 37.6, 1.5, 2.2), gem = circle(60.2, 37.6, 1);
  const freckles = [[41.6, 40.6], [43, 41.6], [57.4, 40], [44.4, 39.4], [40.8, 42.4]].map(([x, y]) => circle(x, y, 0.38)).join('');
  // ── belt, sporran, kilt ──
  const belt = [['M', 42.2, 56.6], ['Q', 50, 57.6, 57.9, 56.6], ['L', 58.2, 60.4], ['Q', 50, 61.4, 41.9, 60.4], ['Z']];
  const buckle = rrect(47.4, 56.4, 5.2, 4.8, 0.7), buckleIn = rrect(48.6, 57.6, 2.8, 2.4, 0.4);
  const kiltTop = 60;
  // the kilt stops above the knee and swings out to his left as he braces
  const kilt = [['M', 42, kiltTop], ['L', 58.2, kiltTop], ['C', 60.6, 62.8, 63, 65.6, 66.6, 68.4], ['L', 63.8, 68.4], ['L', 61.4, 70], ['L', 58.8, 69.2], ['L', 56.4, 70.8],
    ['L', 53.8, 69.8], ['L', 51.2, 71.2], ['L', 48.6, 70.2], ['L', 46, 71.4], ['L', 43.4, 70.2], ['L', 40.8, 71.2], ['L', 38.4, 70], ['L', 36, 70.6], ['C', 38.4, 67.2, 40.2, 63.8, 42, kiltTop], ['Z']];
  const pleats = [['M', 44.6, 61], ['L', 42, 70.6], ['M', 48, 61], ['L', 46.6, 71], ['M', 51.4, 61], ['L', 51.2, 71], ['M', 54.6, 61], ['L', 56, 70.4], ['M', 57.6, 61], ['L', 61, 69.6]];
  const apron = [['M', 56.2, 60.6], ['C', 57.2, 63.6, 58, 66.6, 58.6, 69.6]];
  const fringe = [0, 1, 2, 3, 4].map((i) => { const y = 62 + i * 1.6, x = 56.6 + (y - 61) * 0.22; return shape([['M', x, y], ['L', x + 1.2, y + 0.6]]); }).join('');
  const kiltPin = bar(56.6, 65, 57.4, 68.4, 0.9) + circle(57.5, 68.6, 0.8);
  const sporranCantle = [['M', 46.8, 61.2], ['Q', 50, 59.8, 53.2, 61.2], ['L', 52.8, 62.6], ['Q', 50, 61.6, 47.2, 62.6], ['Z']];
  const sporran = [['M', 47.2, 62.4], ['L', 52.8, 62.4], ['C', 54, 65.2, 53.8, 68.6, 50, 70.4], ['C', 46.2, 68.6, 46, 65.2, 47.2, 62.4], ['Z']];
  const sporranHair = [['M', 48.4, 63.4], ['L', 48, 69], ['M', 50, 63.2], ['L', 50, 70], ['M', 51.6, 63.4], ['L', 52, 69]];
  const tassels = [47.6, 50, 52.4].map((x) => bar(x, 64.8, x, 70.6, 1) + circle(x, 71, 0.9)).join('');
  // ── legs ──
  const thL = limb(HPL, KL, 8.8, 6.4, { bulge: 0.06, at: 0.4 }), shL = limb(KL, AL, 6.4, 4.2, { bulge: 0.11, at: 0.28 });
  const thR = limb(HPR, KR, 8.8, 6.4, { bulge: 0.06, at: 0.4 }), shR = limb(KR, AR, 6.4, 4.2, { bulge: 0.11, at: 0.28 });
  const knees = circle(...KL, 3.3) + circle(...KR, 3.3);
  const kneeLines = shape([['M', 36.8, 76.4], ['Q', 38.8, 75.2, 40.8, 76.6], ['M', 60.8, 74.8], ['Q', 62.8, 73.6, 64.8, 75]]);
  const quadLines = shape([['M', 43.6, 72.4], ['Q', 41.6, 74.2, 40.8, 76], ['M', 56.4, 72.2], ['Q', 59.4, 73.6, 60.6, 74.8]]);
  // the hose covers the shin from just under the knee; the turn-down is the tartan
  const hoseL = limb(add(KL, mul(sub(AL, KL), 0.14)), AL, 6.6, 4.4, { bulge: 0.1, at: 0.22, ext: 0.6 });
  const hoseR = limb(add(KR, mul(sub(AR, KR), 0.14)), AR, 6.6, 4.4, { bulge: 0.1, at: 0.22, ext: 0.6 });
  const turn = (k, a2) => limb(add(k, mul(sub(a2, k), 0.12)), add(k, mul(sub(a2, k), 0.3)), 7.2, 7, { bulge: 0, ext: 0 });
  const tdL = turn(KL, AL), tdR = turn(KR, AR);
  const flashes = shape([['M', 35.6, 80.6], ['L', 33, 84.8], ['L', 35.8, 83.8], ['Z'], ['M', 66.2, 79.8], ['L', 68.8, 84], ['L', 66, 83], ['Z']]);
  const sgian = shape([['M', 60, 79.4], ['L', 61.8, 74.8], ['L', 63.2, 75.2], ['L', 61.6, 79.8], ['Z']]), sgianTop = circle(62.4, 74.6, 0.9);
  const bootL = [['M', 35.4, 89.4], ['L', 30.2, 89.4], ['C', 29.8, 91, 28.2, 92.2, 25.6, 92.8], ['C', 22.6, 93.4, 21.8, 95.2, 23.4, 96.2], ['L', 34.2, 96.2], ['C', 35.6, 94.6, 35.8, 91.8, 35.4, 89.4], ['Z']];
  const bootR = [['M', 61.4, 89], ['L', 66.6, 89], ['C', 67, 90.6, 68.6, 91.8, 71.2, 92.4], ['C', 74.2, 93, 75, 94.8, 73.4, 95.8], ['L', 62.6, 95.8], ['C', 61.2, 94.2, 61, 91.4, 61.4, 89], ['Z']];
  const laces = shape([['M', 30.6, 86.6], ['L', 35.2, 88.4], ['M', 35, 86.4], ['L', 30.4, 88.6], ['M', 31.2, 84.4], ['L', 34.8, 86], ['M', 61.4, 86.2], ['L', 66, 88], ['M', 66, 86], ['L', 61.4, 88.2], ['M', 62, 84], ['L', 65.6, 85.6]]);
  const welts = shape([['M', 24, 95.4], ['L', 33.8, 95.4], ['M', 63, 95], ['L', 72.8, 95]]);
  // ── the head ──
  const head = (t) => {
    const k = t ? t.sx : 1, Q = (x, y) => ap(t, x, y);
    // hair: a mass of locks blown back and to the right, darker behind, with light strands
    const lock = (ang, len, w, curl) => {
      const base = [49.6 + 6.8 * Math.cos(ang), 22 + 8.2 * Math.sin(ang)];
      const dir = [Math.cos(ang + curl * 0.5), Math.sin(ang + curl * 0.5)], tip = add(base, mul(dir, len));
      const nn = [-Math.sin(ang), Math.cos(ang)], mid = add(base, mul(dir, len * 0.55));
      const bend = mul([Math.cos(ang + curl), Math.sin(ang + curl)], len * 0.25);
      return [['M', ...add(base, mul(nn, w / 2))], ['Q', ...add(add(mid, bend), mul(nn, w * 0.3)), ...tip], ['Q', ...add(add(mid, bend), mul(nn, -w * 0.3)), ...add(base, mul(nn, -w / 2))], ['Z']];
    };
    const backLocks = [], frontLocks = [], strands = [];
    for (let i = 0; i <= 12; i++) {
      const ang = Math.PI * (0.95 + i * 0.095), crown = ang > Math.PI * 1.3 && ang < Math.PI * 1.72;
      const len = (7.2 + (i % 3) * 2.1 + (i > 6 ? 1.6 : 0)) * (crown ? 0.45 : 1), curl = 0.5;
      backLocks.push(...lock(ang, len + 1.8, 5.8, curl));
      if (i % 2 === 0 && i > 1 && i < 12) frontLocks.push(...lock(ang + 0.05, len * 0.7, 4.4, curl));
      if (i % 3 === 1) { const b0 = [49.6 + 7.4 * Math.cos(ang), 22 + 8.8 * Math.sin(ang)]; strands.push(['M', ...b0], ['Q', ...add(b0, mul([Math.cos(ang + 0.5), Math.sin(ang + 0.5)], len * 0.4)), ...add(b0, mul([Math.cos(ang + 0.3), Math.sin(ang + 0.3)], len * 0.75))]); }
    }
    const sideLocks = [['M', 43.4, 21], ['C', 41, 25, 40.6, 30, 41.6, 34.6], ['C', 42.6, 31.6, 43.2, 28, 44.2, 25.4], ['Z'], ['M', 55.8, 21], ['C', 58.4, 25, 58.8, 30, 57.8, 34.6], ['C', 56.8, 31.6, 56.2, 28, 55.2, 25.4], ['Z']];
    const face = [['M', 43.4, 20], ['C', 43.6, 15.6, 46.6, 13.6, 49.6, 13.6], ['C', 52.8, 13.6, 55.8, 15.6, 55.8, 20], ['L', 55.8, 25.6], ['C', 55.8, 29.8, 53, 32.8, 49.6, 32.8], ['C', 46.2, 32.8, 43.4, 29.8, 43.4, 25.6], ['Z']];
    const woad = poly(ellipseSide(49.4, 23.2, 6.1, 9.2, 49.9, 23, -0.99, 0.12), t);
    const woadTex = shape([['M', 44.6, 17.6], ['L', 46.4, 27.4], ['M', 46.6, 15.6], ['L', 48.2, 24.2], ['M', 44.2, 23.6], ['L', 45.4, 29.6]], t);
    const brows = poly([[43.6, 18.2], [49.2, 20.6], [49, 22.2], [43.4, 20.2]], t) + poly([[55.8, 18.2], [50.2, 20.6], [50.4, 22.2], [56, 20.2]], t);
    const furrow = shape([['M', 49.2, 17.2], ['L', 49.5, 19.8], ['M', 50.3, 17.2], ['L', 50, 19.8], ['M', 47.6, 16.4], ['Q', 49.7, 15.6, 51.8, 16.4]], t);
    const eyes = poly(ellipsePts(46.7, 22.6, 2, 1.45, 0.12, 24), t) + poly(ellipsePts(52.7, 22.6, 2, 1.45, -0.12, 24), t);
    const pupils = circle(...Q(47, 22.7), 0.62 * k) + circle(...Q(52.4, 22.7), 0.62 * k);
    const crows = shape([['M', 44.2, 23.4], ['L', 43.2, 24], ['M', 55.2, 23.4], ['L', 56.2, 24], ['M', 45.4, 24.6], ['Q', 46.8, 25.2, 48.2, 24.6], ['M', 51.2, 24.6], ['Q', 52.6, 25.2, 54, 24.6]], t);
    const nose = shape([['M', 49.6, 22.4], ['L', 51.4, 26.6], ['C', 51, 27.4, 48.4, 27.4, 48, 26.6], ['Z']], t);
    const nostrils = circle(...Q(48.7, 26.6), 0.35 * k) + circle(...Q(50.6, 26.6), 0.35 * k);
    const mouth = shape([['M', 46, 28.2], ['C', 47.4, 27.2, 52, 27.2, 53.4, 28.2], ['C', 53.8, 32, 51.8, 34.8, 49.7, 34.8], ['C', 47.6, 34.8, 45.6, 32, 46, 28.2], ['Z']], t);
    const upperTeeth = shape([['M', 46.5, 28.4], ['L', 52.9, 28.4], ['L', 52.6, 29.8], ['L', 46.8, 29.8], ['Z']], t);
    const lowerTeeth = shape([['M', 47.4, 33.2], ['L', 52, 33.2], ['L', 51.4, 34.2], ['L', 48, 34.2], ['Z']], t);
    const toothLines = shape([['M', 48.4, 28.4], ['L', 48.4, 29.8], ['M', 49.7, 28.4], ['L', 49.7, 29.8], ['M', 51, 28.4], ['L', 51, 29.8]], t);
    const tongue = poly(ellipsePts(49.7, 32.4, 2, 1, 0, 20), t);
    const tache = shape([['M', 49.7, 26.8], ['C', 47.4, 25.8, 44.4, 26.4, 43.2, 29.6], ['C', 45.4, 28.6, 47.6, 28.4, 49.7, 28.8], ['C', 51.8, 28.4, 54, 28.6, 56.2, 29.6], ['C', 55, 26.4, 52, 25.8, 49.7, 26.8], ['Z']], t);
    const beard = shape([['M', 43.2, 24], ['C', 42, 30, 42.6, 36, 45.4, 40.6], ['L', 46.8, 38.4], ['L', 48.2, 42.4], ['L', 49.7, 39], ['L', 51.2, 42.4], ['L', 52.6, 38.4],
      ['L', 54, 40.6], ['C', 56.8, 36, 57.4, 30, 56.2, 24], ['C', 55, 28.6, 52.8, 30.6, 49.7, 30.6], ['C', 46.6, 30.6, 44.4, 28.6, 43.2, 24], ['Z']], t);
    const beardStrands = shape([['M', 44.4, 30], ['Q', 44.6, 34.6, 46.4, 38], ['M', 55, 30], ['Q', 54.8, 34.6, 53, 38], ['M', 47.6, 35.4], ['L', 48.2, 39.6], ['M', 51.8, 35.4], ['L', 51.2, 39.6]], t);
    const beardLight = shape([['M', 45.2, 27.6], ['Q', 44.8, 31.6, 46, 34.4], ['M', 54.4, 27.6], ['Q', 54.8, 31.6, 53.6, 34.4]], t);
    const cheekFreckles = [[53.6, 25.4], [54.4, 24.8], [55, 25.8], [52.8, 24.8]].map(([x, y]) => circle(...Q(x, y), 0.3 * k)).join('');
    const scar = shape([['M', 52.6, 15.4], ['L', 55.2, 20.2], ['M', 52.8, 16.8], ['L', 54.2, 16], ['M', 53.6, 18.2], ['L', 55, 17.4], ['M', 54.4, 19.6], ['L', 55.8, 18.8]], t);
    return [
      ...group([backLocks.length ? shape(backLocks, t) : ''], HL.gingerDeep, 2.2 * k),
      L(shape(sideLocks, t), HL.gingerDeep, { stroke: ink, sw: 0.9 * k }),
      ...group([shape(face, t)], HL.skin, 2.2 * k),
      L(woad, HL.woad),
      L(woadTex, 'none', { stroke: HL.woadDeep, sw: 0.7 * k }),
      L(crows, 'none', { stroke: HL.skinDeep, sw: 0.45 * k }),
      L(furrow, 'none', { stroke: HL.skinDeep, sw: 0.5 * k }),
      L(cheekFreckles, HL.skinDeep),
      L(scar, 'none', { stroke: '#b5484a', sw: 0.55 * k }),
      L(eyes, HL.white, { stroke: ink, sw: 0.5 * k }),
      L(pupils, ink),
      L(brows, HL.gingerDeep, { stroke: ink, sw: 0.5 * k }),
      L(nose, HL.skinShade, { stroke: HL.skinDeep, sw: 0.35 * k }),
      L(nostrils, HL.skinDeep),
      L(beard, HL.ginger, { stroke: ink, sw: 1 * k }),
      L(beardStrands, 'none', { stroke: HL.gingerDeep, sw: 0.55 * k }),
      L(beardLight, 'none', { stroke: HL.gingerLight, sw: 0.5 * k }),
      L(mouth, HL.mouth, { stroke: ink, sw: 0.6 * k }),
      L(tongue, HL.tongue),
      L(upperTeeth, HL.white),
      L(lowerTeeth, HL.white),
      L(toothLines, 'none', { stroke: '#9a9a9a', sw: 0.25 * k }),
      L(tache, HL.gingerDeep, { stroke: ink, sw: 0.6 * k }),
      L(shape(frontLocks, t), HL.ginger, { stroke: ink, sw: 0.7 * k }),
      L(shape(strands, t), 'none', { stroke: HL.gingerLight, sw: 0.5 * k }),
    ];
  };
  const figure = [
    L(shape(plaid), 'sett', { stroke: ink, sw: 1.1 }),
    L(shape(plaidFolds), 'none', { stroke: 'rgba(0,0,0,0.4)', sw: 0.8 }),
    ...group([shaft, blade], HL.wood, 1.8),
    L(grain, 'none', { stroke: HL.woodDeep, sw: 0.5 }),
    L(grip, 'none', { stroke: HL.tapeWhite, sw: 3.4 }),
    L(bladeTape, HL.tapeWhite),
    L(tapeLines, 'none', { stroke: '#9a9a9a', sw: 0.35 }),
    // arms
    ...group([uaL.outline, faL.outline, uaR.outline, faR.outline, delts, elbows], HL.skin),
    L(shape(uaL.shade) + shape(faL.shade) + shape(uaR.shade) + shape(faR.shade), HL.skinShade),
    L(bicepLines, 'none', { stroke: HL.skinDeep, sw: 0.7 }),
    L(shape(brL.outline) + shape(brR.outline), HL.leather, { stroke: ink, sw: 0.9 }),
    L(studs(EL, WL) + studs(ER, WR), HL.silver),
    // legs
    ...group([bootL, bootR], HL.boot),
    L(welts, 'none', { stroke: '#4d4d4d', sw: 0.5 }),
    ...group([hoseL.outline, hoseR.outline], HL.hose),
    L(shape(hoseL.shade) + shape(hoseR.shade), HL.hoseShade),
    L(laces, 'none', { stroke: ink, sw: 0.55 }),
    ...group([thL.outline, thR.outline, knees], HL.skin),
    L(shape(thL.shade) + shape(thR.shade), HL.skinShade),
    L(kneeLines + quadLines, 'none', { stroke: HL.skinDeep, sw: 0.6 }),
    L(shape(tdL.outline) + shape(tdR.outline), 'sett', { stroke: ink, sw: 0.9 }),
    L(flashes, HL.red, { stroke: ink, sw: 0.5 }),
    L(sgian, ink), L(sgianTop, HL.silver, { stroke: ink, sw: 0.4 }),
    // kilt
    ...group([kilt], 'sett', 2.3),
    L(shape(pleats), 'none', { stroke: 'rgba(0,0,0,0.42)', sw: 0.75 }),
    L(shape(apron), 'none', { stroke: ink, sw: 0.7 }),
    L(fringe, 'none', { stroke: HL.gingerLight, sw: 0.45 }),
    L(kiltPin, HL.silver, { stroke: ink, sw: 0.35 }),
    // torso
    ...group([torso], HL.skin),
    L(shape(torsoShade), HL.skinShade),
    L(shape(pecShade), HL.skinShade),
    L(shape(pecL) + shape(pecR), 'none', { stroke: HL.skinDeep, sw: 0.8 }),
    L(shape(abs), 'none', { stroke: HL.skinDeep, sw: 0.6 }),
    L(freckles, HL.skinDeep),
    L(shape(sash), 'sett', { stroke: ink, sw: 1 }),
    L(shape(sashFolds), 'none', { stroke: 'rgba(0,0,0,0.4)', sw: 0.6 }),
    L(brooch, HL.silver, { stroke: ink, sw: 0.6 }),
    L(broochRing, HL.silverDeep),
    L(gem, HL.red),
    // belt and sporran
    L(shape(belt), HL.leatherDeep, { stroke: ink, sw: 0.8 }),
    L(buckle, HL.silver, { stroke: ink, sw: 0.6 }),
    L(buckleIn, HL.leatherDeep),
    L(shape(sporranCantle), HL.silver, { stroke: ink, sw: 0.6 }),
    L(shape(sporran), HL.fur, { stroke: ink, sw: 0.8 }),
    L(shape(sporranHair), 'none', { stroke: HL.furShade, sw: 0.5 }),
    L(tassels, ink),
    // the head, and the fists over the shaft
    ...head(null),
    ...group([fist(FL), fist(FR)], HL.skin, 2),
    L(knuckles(FL) + knuckles(FR), 'none', { stroke: HL.skinDeep, sw: 0.5 }),
  ];
  // the man set down a touch from his boots, for headroom over the raised stick
  const FK = 0.9;
  const layers = [
    L(disc(48.6), ink),
    L(disc(47.4), 'sett'),
    L(disc(39.4), ink),
    L(disc(38.2), HL.field),
    L(rays, HL.fieldRay),
    L(ring(50, 50, 38.2, 39.4), ink),
    ...figure.map((l) => ({ ...l, d: xfD(l.d, FK, 50, 97), ...(l.sw ? { sw: +(l.sw * FK).toFixed(2) } : {}) })),
  ];
  // small: the head alone, big, with the stick crossing behind it, on a plain disc
  const k = 2.2, s = T({ sx: k, sy: k, tx: 50 - 49.7 * k, ty: 52 - 27 * k });
  const small = [
    L(disc(49.5), HL.green),
    L(disc(44), HL.navy),
    L(bar(84, 86, 16, 14, 8), HL.wood, { stroke: ink, sw: 2 }),
    ...head(s),
  ];
  // 0.24 a thread puts about two repeats across the badge, so the guards are a line you can see
  // at card size rather than a tint.
  return { box: 100, layers, small, settUnit: 0.24 };
}

// DISTRICT 9 GOONS. Precinct 9's club: cops, serving and retired. A dented shield badge
// with two side-handle nightsticks crossed behind it, and on its enamel the taped fist
// coming straight at you, knuckles bloodied, D9 in marker on the tape where the badge
// number goes.
const GN = { purple: '#4b2a72', purpleDeep: '#2c1846', purpleLight: '#8e68c0', bone: '#efe5d2', boneLight: '#faf5ea', boneShade: '#cdbb9d', boneDeep: '#a8977a', black: '#121014', stick: '#2a2530',
  tape: '#f7f4ee', tapeShade: '#c9c2b4', blood: '#a3141c' };
function goons() {
  // the badge: a peaked top with two shoulders, flared sides, a point at the bottom
  const badge = shape([['M', 50, 3.6], ['C', 54.4, 3.6, 57.6, 6.2, 59.2, 9.6], ['L', 66.6, 8.2], ['L', 76.4, 12.6], ['C', 77.6, 19, 80.6, 24.4, 86, 27.2],
    ['C', 82.4, 40, 82.2, 53, 85, 64.8], ['C', 79, 79, 66, 88.6, 50, 96.4], ['C', 34, 88.6, 21, 79, 15, 64.8], ['C', 17.8, 53, 17.6, 40, 14, 27.2],
    ['C', 19.4, 24.4, 22.4, 19, 23.6, 12.6], ['L', 33.4, 8.2], ['L', 40.8, 9.6], ['C', 42.4, 6.2, 45.6, 3.6, 50, 3.6], ['Z']]);
  const inset = (k, oy = 52) => xfD(badge, k, 50, oy);
  const star = (cx, cy, r1, r0) => poly(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? r0 : r1; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }));
  // two side-handle nightsticks crossed behind it
  const stick = (x0, y0, x1, y1) => {
    const u = nrm([x1 - x0, y1 - y0]), n = [-u[1], u[0]], h = add([x0, y0], mul(u, 9));
    return { body: bar(x0, y0, x1, y1, 5) + circle(x0, y0, 2.5) + circle(x1, y1, 2.5), handle: bar(...h, ...add(h, mul(n, n[1] > 0 ? 7.4 : -7.4)), 3.4),
      shine: `M${P(...add(add([x0, y0], mul(u, 3)), mul(n, -1.2)))}L${P(...add(add([x1, y1], mul(u, -3)), mul(n, -1.2)))}` };
  };
  const sticks = [stick(7, 91, 93, 11), stick(93, 91, 7, 11)];
  // the fist, raised and coming at you: four fingers curled, bent knuckles up and bloodied,
  // the tips of the pinky and ring tucked under them, the thumb locked across the index
  // and middle and running back into the heel of the hand, the wrist taped. Drawn in its
  // own frame with the thumb on the right, lit from the upper left; `fist(k, cx, cy)` sets
  // it down k big with the middle of its frame (51, 57) at (cx, cy).
  const FING = [[22, 33.4, 34, 50.4], [32.6, 45.4, 29, 53.2], [44.6, 58, 27.4, 54.2], [57.2, 70.6, 29.4, 53.2]]; // pinky to index: x0, x1, top, bottom
  const capOf = ([x0, x1]) => (x1 - x0) * 0.5;
  const fingerD = (fg) => {
    const [x0, x1, t, b] = fg, r = capOf(fg), rb = 3.4;
    return shape([['M', x0, t + r], ['C', x0, t - r * 0.3, x1, t - r * 0.3, x1, t + r], ['L', x1, b - rb], ['Q', x1, b, x1 - rb, b], ['L', x0 + rb, b], ['Q', x0, b, x0, b - rb], ['Z']]);
  };
  // the shade down each finger's right side, and a fold where the knuckle turns into the face
  const shadeD = (fg) => {
    const [, x1, t, b] = fg, r = capOf(fg);
    return shape([['M', x1 - 0.2, t + r * 0.7], ['L', x1 - 0.2, b - 3], ['Q', x1 - 0.4, b - 0.3, x1 - 3.4, b - 0.3], ['C', x1 - 3, b - 6, x1 - 3, t + r * 1.6, x1 - 3.2, t + r * 0.9],
      ['C', x1 - 2.8, t + r * 0.5, x1 - 1.6, t + 0.6, x1 - 1, t + 0.8], ['Z']]);
  };
  const foldD = (fg) => { const [x0, x1, t] = fg, r = capOf(fg), y = t + r * 1.15; return shape([['M', x0 + 2.4, y], ['Q', (x0 + x1) / 2, y + 1.8, x1 - 3.4, y]]); };
  // the curled tips of the pinky and ring, showing under them
  const tips = rrect(23.2, 46.6, 9.6, 9.4, 4.2) + rrect(33.8, 49.4, 11, 9.6, 4.4);
  // the heel of the hand behind the fingers, pinky side, down to the wrist
  const palm = shape([['M', 22.4, 40], ['L', 22.6, 52], ['C', 23.6, 58.6, 27.6, 62.4, 33, 63.4], ['L', 68, 63.6], ['L', 70, 40], ['Z']]);
  // the thumb across the fingers and the mound at its root, as one piece
  const thumb = shape([['M', 81.4, 41], ['C', 74, 38.6, 61.6, 40.2, 52, 42.8], ['C', 46.6, 44.2, 44.4, 48.4, 45.4, 51.8], ['C', 46.4, 55.2, 50, 57, 54, 56.6],
    ['L', 63.4, 55.8], ['C', 68, 58.4, 68.6, 61.6, 67.6, 64.2], ['C', 75, 62.8, 81.8, 57.2, 82.2, 49.6], ['C', 82.4, 45.4, 82.2, 42.8, 81.4, 41], ['Z']]);
  const thumbShade = shape([['M', 46.2, 53.2], ['C', 48, 56, 50.8, 57, 54, 56.6], ['L', 63.4, 55.8], ['C', 66.8, 55.6, 70.8, 56.4, 74.2, 58.6],
    ['C', 71.6, 55.2, 67.6, 53.6, 63.4, 53.6], ['L', 53.4, 54.2], ['C', 50.4, 54.4, 48, 54.2, 46.2, 53.2], ['Z'],
    ['M', 67.6, 64.2], ['C', 75, 62.8, 81.8, 57.2, 82.2, 49.6], ['C', 80, 55.6, 75.6, 59.4, 70.2, 60.8], ['C', 69.6, 62, 68.8, 63.2, 67.6, 64.2], ['Z']]);
  const nail = shape([['M', 51.8, 43.2], ['C', 48.2, 44.2, 46.2, 46.6, 46.6, 49.2], ['L', 51.6, 48.6], ['C', 52.4, 46.8, 52.6, 44.8, 51.8, 43.2], ['Z']]);
  const thumbLines = shape([['M', 59.6, 41.4], ['Q', 61, 45.2, 60, 48.6], ['M', 63.4, 55.8], ['C', 67.4, 55.6, 71, 56.8, 74.6, 59.4]]);
  const wristD = (bottom) => shape([['M', 32.6, 61.6], ['C', 42, 65.2, 58, 65.2, 67.8, 61.4], ['L', 68.4, bottom], ['C', 58, bottom + 3, 42, bottom + 3, 31.8, bottom], ['Z']]);
  const wraps = shape([['M', 32.2, 69.4], ['C', 42, 73.4, 58, 71.8, 68, 67.6], ['M', 32, 77.2], ['C', 42, 81, 58, 79.4, 68.2, 75.4], ['M', 31.9, 85], ['C', 42, 88.6, 58, 87, 68.3, 83.2]]);
  const d9 = glyph('D', T({ tx: 36.4, ty: 70.8, sx: 2, sy: 1.85, rot: -0.06 })) + glyph('9', T({ tx: 50.6, ty: 70, sx: 2, sy: 1.85, rot: -0.06 }));
  // blood on the knuckles that landed (middle, ring, index), run down the faces, and spray
  const blood = ellipse(51.2, 29, 3.2, 1.5, 0.05) + ellipse(38.8, 30.6, 2.8, 1.3, -0.1) + ellipse(63.8, 31, 2.2, 1.1, 0.1)
    + circle(57.4, 23.4, 0.9) + circle(44.6, 23.6, 0.7) + circle(61.6, 25.2, 0.55) + circle(35.4, 25.6, 0.55) + circle(48.2, 21.6, 0.5);
  const drips = shape([['M', 49.8, 29.4], ['C', 49.6, 32.6, 50, 35.4, 50.8, 37], ['C', 51.8, 35.4, 52.2, 32.6, 52, 29.4], ['Z'], ['M', 38, 31], ['C', 37.8, 33.2, 38.2, 34.8, 38.8, 35.8], ['C', 39.6, 34.8, 39.8, 33.2, 39.6, 31], ['Z']]);
  const fist = (k, cx, cy, sw, bottom) => {
    const ox = (cx - 51 * k) / (1 - k), oy = (cy - 57 * k) / (1 - k), f = (d) => xfD(d, k, ox, oy), w = (s) => +(s * k).toFixed(2);
    const each = (fn) => FING.map((fg) => f(fn(fg))).join('');
    return { w, sw: w(sw), wrist: f(wristD(bottom)), palm: f(palm), tips: f(tips), fingers: each(fingerD), shades: each(shadeD), folds: each(foldD),
      thumb: f(thumb), thumbShade: f(thumbShade), nail: f(nail), thumbLines: f(thumbLines), wraps: f(wraps), d9: f(d9), blood: f(blood), drips: f(drips) };
  };
  const fz = fist(0.76, 50, 52, 2, 90);
  // knocks and a splash it has taken
  const dents = shape([['M', 20.4, 37.6], ['L', 23.2, 40.4], ['M', 21.2, 46], ['L', 22.6, 47.2], ['M', 79.4, 66.6], ['Q', 81, 68.6, 80, 71], ['M', 62.4, 88.2], ['L', 64.4, 86.4]]);
  const dentRing = ring(73.6, 31.4, 1.2, 2);
  const splash = ellipse(26.6, 25.4, 1.6, 1.1, 0.5) + ellipse(29.4, 22.6, 0.8, 0.6) + ellipse(24.2, 29.2, 0.6, 0.5) + ellipse(31.2, 26.8, 0.5, 0.4);
  const layers = [
    // the sticks behind the badge
    ...sticks.flatMap((st) => [L(st.handle, GN.stick, { stroke: GN.black, sw: 1.6 }), L(st.body, GN.stick, { stroke: GN.black, sw: 1.6 })]),
    L(sticks.map((st) => st.shine).join(''), 'none', { stroke: '#5a5262', sw: 0.9 }),
    // the badge, bevelled: shade showing down the right and along the bottom
    L(badge, GN.boneShade, { stroke: GN.black, sw: 2.6 }),
    L(xfD(badge, 0.97, 47, 47), GN.bone),
    L(inset(0.86), 'none', { stroke: GN.boneDeep, sw: 1 }),
    L(inset(0.8), GN.black),
    L(inset(0.775), GN.purple),
    L(star(50, 9.6, 3.4, 1.4), GN.purple, { stroke: GN.black, sw: 0.7 }),
    L(dents, 'none', { stroke: GN.boneDeep, sw: 0.7 }),
    L(dentRing, GN.boneDeep),
    L(splash, GN.blood),
    // the fist on the enamel
    L(fz.wrist, GN.tape, { stroke: GN.black, sw: fz.sw }),
    L(fz.wraps, 'none', { stroke: GN.tapeShade, sw: fz.w(1.4) }),
    L(fz.d9, GN.purpleDeep, { rule: 'evenodd' }),
    L(fz.palm, GN.boneShade, { stroke: GN.black, sw: fz.sw }),
    L(fz.tips, GN.bone, { stroke: GN.black, sw: fz.sw }),
    L(fz.fingers, GN.bone),
    L(fz.shades, GN.boneShade),
    L(fz.folds, 'none', { stroke: GN.boneDeep, sw: fz.w(1.2) }),
    L(fz.fingers, 'none', { stroke: GN.black, sw: fz.sw }),
    L(fz.blood, GN.blood),
    L(fz.drips, GN.blood),
    L(fz.thumb, GN.bone),
    L(fz.thumbShade, GN.boneShade),
    L(fz.nail, GN.boneLight, { stroke: GN.boneDeep, sw: fz.w(0.9) }),
    L(fz.thumbLines, 'none', { stroke: GN.boneDeep, sw: fz.w(1.2) }),
    L(fz.thumb, 'none', { stroke: GN.black, sw: fz.sw }),
  ];
  // small: the badge and the fist, bigger and inked heavier, D9 on its tape
  const fm = fist(0.88, 50, 48.4, 3.4, 87.4);
  const small = [
    L(badge, GN.bone, { stroke: GN.black, sw: 3.4 }),
    L(inset(0.78), GN.purple),
    L(fm.wrist, GN.tape, { stroke: GN.black, sw: fm.sw }),
    L(fm.d9, GN.purpleDeep, { rule: 'evenodd' }),
    L(fm.palm, GN.boneShade, { stroke: GN.black, sw: fm.sw }),
    L(fm.tips, GN.bone, { stroke: GN.black, sw: fm.sw }),
    L(fm.fingers, GN.bone, { stroke: GN.black, sw: fm.sw }),
    L(fm.shades, GN.boneShade),
    L(fm.fingers, 'none', { stroke: GN.black, sw: fm.sw }),
    L(fm.blood, GN.blood),
    L(fm.drips, GN.blood),
    L(fm.thumb, GN.bone, { stroke: GN.black, sw: fm.sw }),
    L(fm.thumbShade, GN.boneShade),
    L(fm.thumb, 'none', { stroke: GN.black, sw: fm.sw }),
  ];
  return { box: 100, layers, small };
}

// WATERFRONT WHARF RATS. A dock rat crouched on an anchor's stock, in silhouette against
// the harbour fog: back up and bristling, head down, one eye lit red, incisors out, claws
// hooked over the iron, and its tail wound round the shank. Silver is the rim light the
// harbour lamps put on it, and the club's; the fog is grey, so the red eye is the only
// colour on it. Rat and anchor are drawn large and set down inside the silver piping, so
// nothing of either crosses the rope.
const WRAT = { field: '#1d1f22', fog: '#3a3e44', fogLight: '#5f656d', water: '#16181b', wave: '#3a3e44', rope: '#b39062', ropeDark: '#6e5532', rim: '#d3d9de', rimDeep: '#7d868d',
  rat: '#0d0f11', steel: '#8b949b', steelLight: '#c3cbd0', claw: '#d9cfb6', tooth: '#e9b23f', eye: '#ff3a2e', eyeCore: '#ffd9c8', gums: '#3a0a10', ink: '#141414' };
// a tapered tube along a chain of cubic segments, for tails and ropes
function taper(segs, w0, w1, n = 18) {
  const pts = [];
  segs.forEach(([p0, c1, c2, p1], si) => {
    for (let i = si ? 1 : 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const bx = (k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k];
      const dk = (k) => 3 * u * u * (c1[k] - p0[k]) + 6 * u * t * (c2[k] - c1[k]) + 3 * t * t * (p1[k] - c2[k]);
      pts.push([bx(0), bx(1), dk(0), dk(1)]);
    }
  });
  const N = pts.length, left = [], right = [], ticks = [];
  pts.forEach(([x, y, dx, dy], i) => {
    const l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w = (w0 + (w1 - w0) * (i / (N - 1))) / 2;
    left.push([x + nx * w, y + ny * w]); right.push([x - nx * w, y - ny * w]);
    if (i % 3 === 1 && i < N - 3) ticks.push(['M', x + nx * w * 0.85, y + ny * w * 0.85], ['L', x - nx * w * 0.85, y - ny * w * 0.85]);
  });
  return { d: poly([...left, ...right.reverse()]), ticks: shape(ticks) };
}
// points along a chain of cubics, with the unit normal on the left of travel
function chainPts(segs, n = 16) {
  const out = [];
  segs.forEach(([p0, c1, c2, p1], si) => {
    for (let i = si ? 1 : 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const at = (k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k];
      const dt = (k) => 3 * u * u * (c1[k] - p0[k]) + 6 * u * t * (c2[k] - c1[k]) + 3 * t * t * (p1[k] - c2[k]);
      const d = nrm([dt(0), dt(1)]);
      out.push({ p: [at(0), at(1)], d, n: [d[1], -d[0]] });
    }
  });
  return out;
}
// a polygon pulled inside a disc: points outside it are moved onto its edge
const inDisc = (pts, cx, cy, R) => poly(pts.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy); return d > R ? [cx + ((x - cx) * R) / d, cy + ((y - cy) * R) / d] : [x, y]; }));
// a finished polygon path (M and L only) cut to a disc: each edge is split finely first, so
// the part pulled onto the rim follows the circle instead of cutting a chord across it
function clipToDisc(d, cx, cy, R) {
  return d.split('Z').filter((s) => s.trim()).map((sub) => {
    const nums = (sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number), pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    const fine = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.8));
      for (let j = 0; j < n; j++) fine.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    });
    return inDisc(fine, cx, cy, R);
  }).join('');
}
function wharfRats() {
  const C = 50, ink = WRAT.ink;
  // A headshot traced from the club's own art (crests/wharf-rats.json): a black
  // rat over the anchor's stock, drawn only by its grey rim light and fur, between two
  // pilings, on black in a silver ring. Traced as three greys by brightness, plus the eye
  // and the teeth, so the fur stays and the shapes stay the art's.
  const tr = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/content/crests/wharf-rats.json'), 'utf8'));
  const layers = [
    L(circle(C, C, 49.4), ink),
    L(circle(C, C, 47.6), WRAT.rim),
    L(circle(C, C, 43.4), ink),
    L(circle(C, C, 42.2), '#0e0f11'),
    { ...L(tr.dim, '#3a3f45'), rule: 'evenodd' },
    { ...L(tr.steel, WRAT.steel), rule: 'evenodd' },
    { ...L(tr.hi, WRAT.rim), rule: 'evenodd' },
    L(tr.red, '#ff2e22'),
    L(tr.gold, WRAT.tooth),
  ];
  return { box: 100, layers };
}

// YARD BIRDS. A red pyle fighting cock squared up and furious: white, with his hackle and
// the bows of his wings red. Wings thrown wide, hackles up in a ruff round his head,
// glaring down his beak with a scar through his brow, spurs out, and the chicken wire
// behind him torn open where he came through it. Red, white and black: the club's colours.
const YB = { red: '#c8201c', redDeep: '#8a130f', hackle: '#dc4a1e', white: '#f6f4ef', shade: '#d6d1c7', shadeDeep: '#9f998d',
  field: '#161616', wire: '#3e3e45', wireLight: '#64646e', horn: '#ecd28a', hornDeep: '#a88f50', iris: '#f6d23a', scar: '#f4b6a6',
  black: '#141414', ink: '#141414', mouth: '#4a0b0b', tongue: '#e0606a' };
// a feather or a sickle: a vane along a cubic, pointed at both ends, fullest a little
// before the middle
function vane(p0, c1, c2, p1, W, n = 24) {
  const left = [], right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const at = (k) => u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p1[k];
    const dt = (k) => 3 * u * u * (c1[k] - p0[k]) + 6 * u * t * (c2[k] - c1[k]) + 3 * t * t * (p1[k] - c2[k]);
    const x = at(0), y = at(1), dx = dt(0), dy = dt(1), l = Math.hypot(dx, dy) || 1;
    const w = (W / 2) * Math.pow(Math.sin(Math.PI * t), 0.6) * (1 - 0.3 * t);
    left.push([x - (dy / l) * w, y + (dx / l) * w]); right.push([x + (dy / l) * w, y - (dx / l) * w]);
  }
  return poly([...left, ...right.reverse()]);
}
const quill = (p0, c1, c2, p1) => shape([['M', ...p0], ['C', ...c1, ...c2, ...p1]]);
// a straight-ish feather from base to tip, bowed a little to one side
const feather = (b, t, W, bow = 0.7) => {
  const d = sub(t, b), n = mul(nrm([-d[1], d[0]]), bow);
  return vane(b, add(add(b, mul(d, 0.33)), n), add(add(b, mul(d, 0.66)), n), t, W, 9);
};
function yardBirds() {
  const C = 50, ink = YB.ink, FR = 39.8;
  // ── chicken wire over the field, torn open where he came through it ──
  const HC = [51, 50];
  const holeR = (a) => 27.4 + 2.4 * Math.sin(7 * a) + 1.4 * Math.sin(11 * a + 0.7);
  const inField = ([x, y]) => Math.hypot(x - C, y - C) < FR - 0.3;
  const inHole = ([x, y]) => Math.hypot(x - HC[0], y - HC[1]) < holeR(Math.atan2(y - HC[1], x - HC[0]));
  const hs = 4.6, hw = Math.sqrt(3) * hs, edges = new Map();
  for (let row = 0; row * 1.5 * hs < 100 + hs; row++) {
    for (let col = -1; col * hw < 100 + hw; col++) {
      const cx = col * hw + (row % 2 ? hw / 2 : 0), cy = row * 1.5 * hs;
      const v = Array.from({ length: 6 }, (_, k) => { const a = -Math.PI / 2 + (k * Math.PI) / 3; return [cx + hs * Math.cos(a), cy + hs * Math.sin(a)]; });
      for (let k = 0; k < 6; k++) {
        const e = [v[k], v[(k + 1) % 6]];
        const key = e.map((p) => p.map((n) => Math.round(n * 10)).join(',')).sort().join('|');
        if (!edges.has(key)) edges.set(key, e);
      }
    }
  }
  let wire = '', twists = '', curls = '', flip = 0;
  for (const [a, b] of edges.values()) {
    const N = 12, pts = Array.from({ length: N + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / N, a[1] + ((b[1] - a[1]) * i) / N]);
    const mid = (i) => [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    const keep = Array.from({ length: N }, (_, i) => inField(mid(i)) && !inHole(mid(i)));
    const torn = Array.from({ length: N }, (_, i) => inField(mid(i)) && inHole(mid(i)));
    let d = '';
    for (let i = 0; i < N; i++) {
      if (!keep[i]) continue;
      let j = i;
      while (j + 1 < N && keep[j + 1]) j++;
      d += `M${P(...pts[i])}L${P(...pts[j + 1])}`;
      // a cut end at the tear curls back on itself
      for (const [pi, ni, dir] of [[i, i - 1, -1], [j + 1, j + 1, 1]]) {
        if (ni < 0 || ni >= N || !torn[ni]) continue;
        const p = pts[pi], u = nrm([(b[0] - a[0]) * dir, (b[1] - a[1]) * dir]), side = (flip++ % 2) ? 1 : -1, n = [-u[1] * side, u[0] * side];
        curls += `M${P(...p)}Q${P(p[0] + u[0] * 2.2 + n[0] * 0.3, p[1] + u[1] * 2.2 + n[1] * 0.3)} ${P(p[0] + u[0] * 1.6 + n[0] * 1.8, p[1] + u[1] * 1.6 + n[1] * 1.8)}`;
      }
      i = j;
    }
    if (Math.abs(a[0] - b[0]) < 0.01) twists += d; else wire += d;
  }
  // ── the wings, thrown up and out. Drawn for his right wing (on our left); the other is
  // its mirror. Primaries fan from the wrist, secondaries hang off the trailing edge, and
  // the coverts lie over both in rows, gold along the shoulder. ──
  const wing = (m) => {
    const t = T({ fn: (x, y) => m([x, y]) });
    const prim = [[[17.6, 22.4], [6.4, 24.6]], [[18, 25], [5.2, 32]], [[18.8, 27.6], [6, 39.6]], [[19.8, 30.2], [8.6, 46.6]], [[21, 32.8], [12.6, 52.6]], [[22.6, 35.2], [18, 56.8]]];
    const sec = [[[24.6, 37.8], [22.4, 60.2]], [[27.6, 41.2], [26.8, 62.4]], [[30.8, 44.2], [31.2, 63.4]], [[34, 47], [35.6, 63]], [[37.4, 49.6], [39.6, 61.2]]];
    const prims = prim.map(([b, tp]) => feather(m(b), m(tp), 5.2, 0.9)).join('');
    const secs = sec.map(([b, tp]) => feather(m(b), m(tp), 5.4, 0.6)).join('');
    const shafts = [...prim, ...sec].map(([b, tp]) => { const B = m(b), E = m(add(b, mul(sub(tp, b), 0.86))); return `M${P(...B)}L${P(...E)}`; }).join('');
    const coverts = shape([['M', 41.4, 47.4], ['C', 38, 34, 28.6, 19.8, 17.2, 21], ['L', 18.6, 27.2], ['L', 22.6, 35.4], ['L', 26.2, 39.8], ['L', 30.2, 44], ['L', 34.2, 47.6],
      ['L', 38.2, 50.6], ['L', 42, 51.6], ['Z']], t);
    const shoulder = shape([['M', 41.4, 47.4], ['C', 38, 34, 28.6, 19.8, 17.2, 21], ['L', 18.8, 25.4], ['C', 27.6, 25.6, 33.6, 34.6, 36.4, 47.8], ['Z']], t);
    // rows of covert scallops, following the leading edge
    let rows = '';
    for (const [inset, n0, n1] of [[7.4, 0.16, 0.82], [12.4, 0.1, 0.66]]) {
      for (let i = 0; i <= 5; i++) {
        const u = n0 + ((n1 - n0) * i) / 5, w = 1 - u;
        const pt = (k) => w * w * w * [41.4, 47.4][k] + 3 * w * w * u * [38, 34][k] + 3 * w * u * u * [28.6, 19.8][k] + u * u * u * [17.2, 21][k];
        const dk = (k) => 3 * w * w * ([38, 34][k] - [41.4, 47.4][k]) + 6 * w * u * ([28.6, 19.8][k] - [38, 34][k]) + 3 * u * u * ([17.2, 21][k] - [28.6, 19.8][k]);
        const tg = nrm([dk(0), dk(1)]), inward = [tg[1], -tg[0]], c = add([pt(0), pt(1)], mul(inward, inset));
        const a0 = add(c, mul(tg, -2)), a1 = add(c, mul(tg, 2)), cc = add(c, mul(inward, 2.2));
        rows += shape([['M', ...a0], ['Q', ...cc, ...a1]], t);
      }
    }
    return { prims, secs, shafts, coverts, shoulder, rows };
  };
  const WL = wing((p) => p), WR = wing(([x, y]) => [102.4 - x, y - 1.2]);
  // ── the tail, sickles sweeping out low behind him ──
  const sickles = [[[38.6, 67], [30, 60], [15.6, 58.4], [10.4, 68.4], 6.6, YB.white], [[39, 69.6], [30.6, 67], [18, 70.4], [14.6, 79.4], 5.8, YB.red], [[39.6, 72.4], [33, 74], [25, 79], [22.6, 86.4], 5, YB.white]];
  // ── legs, wide, spurs out ──
  const legL = limb([43.4, 76.4], [38.8, 85.2], 3, 2.5, { bulge: 0, ext: 0.6 }), legR = limb([58.4, 76.4], [63, 85.2], 3, 2.5, { bulge: 0, ext: 0.6 });
  const toes = bar(38.8, 85.2, 32.8, 87.2, 1.5) + bar(38.8, 85.2, 37, 88.8, 1.5) + bar(38.8, 85.2, 42.6, 88.4, 1.5) +
    bar(63, 85.2, 59.2, 88.4, 1.5) + bar(63, 85.2, 64.8, 88.8, 1.5) + bar(63, 85.2, 69, 87.2, 1.5);
  const claws = [[32.8, 87.2, -1], [37, 88.8, -0.3], [42.6, 88.4, 0.4], [59.2, 88.4, -0.4], [64.8, 88.8, 0.3], [69, 87.2, 1]]
    .map(([x, y, d]) => poly([[x - 0.6, y - 0.6], [x + 0.6, y + 0.4], [x + d * 1.4, y + 1.2]])).join('');
  const spurs = poly([[40.8, 80.4], [47, 83.6], [41.2, 82.6]]) + poly([[61, 80.4], [54.8, 83.6], [60.6, 82.6]]);
  const scales = shape([['M', 41, 79.2], ['L', 43.2, 79.8], ['M', 40.2, 81.8], ['L', 42.2, 82.4], ['M', 60.8, 79.2], ['L', 58.6, 79.8], ['M', 61.6, 81.8], ['L', 59.6, 82.4]]);
  const thighs = poly(ellipsePts(44.4, 72.6, 6.2, 5.6, 0.25)) + poly(ellipsePts(57.4, 72.6, 6.2, 5.6, -0.25));
  // ── the body: a black breast, puffed ──
  const body = [['M', 35.2, 56], ['C', 34.8, 48.6, 42, 44.4, 51, 44.4], ['C', 60, 44.4, 67.2, 48.6, 66.8, 56], ['C', 66.4, 64.6, 60.8, 76.6, 51, 77.4], ['C', 41.2, 76.6, 35.6, 64.6, 35.2, 56], ['Z']];
  const breastSheen = [['M', 62.8, 53.6], ['C', 64.6, 61.6, 63, 70, 56.6, 75.4], ['C', 60.6, 69.2, 61.4, 61.6, 60.2, 54.8], ['Z']];
  const scallops = [[44.6, 56.6], [50.6, 57.4], [56.6, 56.6], [47.6, 63], [53.6, 63], [42.8, 62.6], [59, 62.4], [50.6, 69], [45.6, 68.8], [55.8, 68.6]]
    .map(([x, y]) => `M${P(x - 2.2, y)}Q${P(x, y + 2.2)} ${P(x + 2.2, y)}`).join('');
  // ── the hackle stood up in a ruff round his head: two layers of points ──
  const ruff = (cx, cy, r0, r1, n, rot, jit) => poly(Array.from({ length: n * 2 }, (_, i) => {
    const a = rot + (i / (n * 2)) * TAU, r = i % 2 ? r0 : r1 + Math.sin(i * 2.3) * jit;
    return [cx + r * Math.cos(a), cy + r * 0.92 * Math.sin(a)];
  }));
  const ruffBack = ruff(55.6, 32, 13.4, 21.4, 17, 0.1, 1.4), ruffFront = ruff(55.6, 33, 11, 17, 15, 0.32, 0.9);
  const ruffLines = Array.from({ length: 15 }, (_, i) => {
    const a = 0.32 + ((i + 0.5) / 15) * TAU;
    return `M${P(55.6 + 10.4 * Math.cos(a), 33 + 9.6 * Math.sin(a))}L${P(55.6 + 15.6 * Math.cos(a), 33 + 14.4 * Math.sin(a))}`;
  }).join('');
  // ── the head, three-quarters on, glaring down the beak ──
  const headParts = (t) => {
    const k = t ? t.sx : 1, sh = (cmds) => shape(cmds, t), el = (cx, cy, rx, ry, r = 0, n = 28) => poly(ellipsePts(cx, cy, rx, ry, r, n), t);
    const ln = (sw) => +(sw * k).toFixed(2);
    const head = [['M', 51, 34.6], ['C', 48.6, 33, 47.6, 31, 47.8, 29.2], ['L', 44.8, 27.8], ['L', 47.8, 26.2], ['L', 45.4, 23.2], ['L', 49, 23.4], ['L', 47.8, 20.2],
      ['L', 51.6, 21.4], ['C', 55.4, 18.8, 60.6, 18.8, 63.2, 21.6], ['C', 64.8, 23.6, 65, 27, 64.2, 30], ['C', 63.2, 34, 60, 36.8, 56.4, 37], ['C', 54.2, 37.1, 52.4, 36.2, 51, 34.6], ['Z']];
    const face = [['M', 51.2, 26.4], ['C', 53.6, 23.4, 60, 23, 63.4, 25.6], ['C', 64.6, 29, 63.6, 33.6, 60.2, 36], ['C', 56.8, 37.4, 53, 36, 51.6, 32.8], ['Z']];
    // a single comb like a sawblade, swept back, one point broken off in a fight
    const comb = [['M', 51.4, 22.4], ['L', 46.4, 17.6], ['L', 51.8, 18.4], ['L', 49.4, 12.2], ['L', 54.6, 16], ['L', 53.8, 12.6], ['L', 55.4, 13], ['L', 56.2, 11.8], ['L', 58.4, 14.4],
      ['L', 59.6, 8.6], ['L', 61.6, 14.4], ['L', 64.6, 10.6], ['L', 64.4, 16.2], ['L', 67.6, 15.4], ['L', 64.8, 19.8], ['C', 64.4, 21.6, 63, 22.6, 61.4, 22.6], ['Z']];
    const mouthIn = [['M', 58.8, 33.6], ['L', 69.4, 37], ['L', 67.6, 40.8], ['L', 58.8, 38.2], ['Z']];
    const tongue = [['M', 60.2, 37], ['C', 62.8, 37, 65.2, 37.8, 66.6, 39.4], ['C', 63.8, 39.6, 61.6, 38.8, 60.2, 38.2], ['Z']];
    const upper = [['M', 58.6, 28.8], ['C', 62.6, 28.6, 68.4, 30.6, 70.6, 35.4], ['C', 70.8, 36.8, 70.2, 37.8, 69.2, 38.2], ['C', 68.6, 36.4, 66.4, 34.8, 63.4, 34.4], ['L', 59.4, 34.2], ['Z']];
    const lower = [['M', 59.2, 36], ['C', 62.2, 36.2, 65.6, 37.6, 67.4, 40.6], ['C', 64.2, 41, 61, 39.8, 58.8, 38.4], ['Z']];
    const wattle = [['M', 58.6, 38.2], ['C', 61.8, 39.6, 62.6, 44.8, 60.2, 48], ['C', 58.4, 50, 55.4, 49, 55.4, 45.8], ['C', 55.2, 42.8, 56.4, 40, 58.6, 38.2], ['Z']];
    const wattleFar = [['M', 61.6, 39.4], ['C', 63.8, 40.8, 64.2, 44, 62.6, 46], ['C', 61.8, 46.6, 61, 45.8, 61.2, 44.6], ['Z']];
    // the eyes, set hard under brows that come down to the beak
    const irisN = el(54.4, 29.2, 2.7, 2.6), irisF = el(60.8, 28.4, 2.1, 2.2), pupN = el(55.3, 29.7, 1.05, 1.05, 0, 14), pupF = el(61.1, 29, 0.85, 0.85, 0, 12);
    const browN = [['M', 49.4, 23.4], ['L', 58.6, 27], ['L', 58, 29.4], ['L', 49.8, 26.2], ['Z']];
    const browF = [['M', 65, 22.8], ['L', 59.2, 26.8], ['L', 59.8, 28.8], ['L', 65.2, 25.6], ['Z']];
    const scar = sh([['M', 51.2, 21.4], ['L', 56, 34], ['M', 51.6, 24.4], ['L', 53.4, 23.6], ['M', 53, 28.4], ['L', 54.8, 27.6], ['M', 54.4, 32], ['L', 56.2, 31.2]]);
    return [
      ...group([head], YB.white, ln(2), '', ink),
      L(sh(comb), YB.red, { stroke: ink, sw: ln(1.1) }),
      L(sh(face), YB.red),
      L(sh(mouthIn), YB.mouth, { stroke: ink, sw: ln(0.7) }),
      L(sh(tongue), YB.tongue),
      L(sh(lower), YB.horn, { stroke: ink, sw: ln(0.9) }),
      L(sh(upper), YB.horn, { stroke: ink, sw: ln(0.9) }),
      L(sh([['M', 59.4, 30.6], ['Q', 64.8, 31, 69.2, 34.8]]), 'none', { stroke: YB.hornDeep, sw: ln(0.5) }),
      L(el(62.4, 31, 0.5, 0.34, 0.3, 10), ink),
      L(sh(wattleFar), YB.redDeep, { stroke: ink, sw: ln(0.7) }),
      L(sh(wattle), YB.red, { stroke: ink, sw: ln(1) }),
      L(irisF, YB.iris, { stroke: ink, sw: ln(0.7) }),
      L(irisN, YB.iris, { stroke: ink, sw: ln(0.8) }),
      L(pupN + pupF, ink),
      L(sh(browN) + sh(browF), YB.black, { stroke: ink, sw: ln(0.5) }),
      L(scar, 'none', { stroke: YB.scar, sw: ln(0.55) }),
    ];
  };
  // ── a few feathers knocked loose ──
  const loose = [[77.6, 70.4, 7.4, 0.5, YB.white], [83.4, 58.6, 6.4, -0.8, YB.red], [29.4, 8.6, 6.4, 2.8, YB.white]];
  const looseD = loose.map(([x, y, len, rot, col]) => {
    const t = T({ tx: x, ty: y, rot }), [a, c1, c2, b] = [[0, 0], [len * 0.3, -0.9], [len * 0.7, -0.9], [len, 0.4]].map(([px, py]) => ap(t, px, py));
    const split = shape([['M', len * 0.55, -1.2], ['L', len * 0.42, -0.3], ['M', len * 0.7, 0.6], ['L', len * 0.56, 0.1]], t);
    return [L(vane(a, c1, c2, b, 2.8, 8), col, { stroke: ink, sw: 0.6 }), L(quill(a, c1, c2, b) + split, 'none', { stroke: col === YB.red ? YB.redDeep : YB.shadeDeep, sw: 0.4 })];
  }).flat();
  const layers = [
    L(circle(C, C, 49.2), ink),
    L(circle(C, C, 48), YB.red),
    L(circle(C, C, 41.8), YB.white),
    L(circle(C, C, 40.6), ink),
    L(circle(C, C, FR), YB.field),
    L(wire, 'none', { stroke: YB.wire, sw: 0.5 }),
    L(twists, 'none', { stroke: YB.wire, sw: 1 }),
    L(curls, 'none', { stroke: YB.wireLight, sw: 0.55 }),
    // tail, then the wings behind the body
    ...sickles.map(([p0, c1, c2, p1, W, col]) => L(vane(p0, c1, c2, p1, W, 14), col, { stroke: ink, sw: 1.1 })),
    L(sickles.map(([p0, c1, c2, p1]) => quill(p0, c1, c2, p1)).join(''), 'none', { stroke: YB.shadeDeep, sw: 0.5 }),
    ...[WL, WR].flatMap((w) => [
      L(w.prims, YB.white, { stroke: ink, sw: 0.9 }),
      L(w.secs, YB.shade, { stroke: ink, sw: 0.9 }),
      L(w.shafts, 'none', { stroke: YB.shadeDeep, sw: 0.45 }),
      L(w.coverts, YB.red, { stroke: ink, sw: 1.1 }),
      L(w.rows, 'none', { stroke: YB.redDeep, sw: 0.6 }),
      L(w.shoulder, YB.hackle, { stroke: ink, sw: 0.9 }),
    ]),
    // legs under the body
    ...group([legL.outline, legR.outline, toes], YB.horn, 1.6),
    L(claws + spurs, YB.hornDeep, { stroke: ink, sw: 0.5 }),
    L(scales, 'none', { stroke: YB.hornDeep, sw: 0.45 }),
    L(thighs, YB.white, { stroke: ink, sw: 1.2 }),
    ...group([body], YB.white, 2.4),
    L(shape(breastSheen), YB.shade),
    L(scallops, 'none', { stroke: YB.shade, sw: 0.7 }),
    // the ruff, then the head over it
    L(ruffBack, YB.redDeep, { stroke: ink, sw: 1.2 }),
    L(ruffFront, YB.hackle, { stroke: ink, sw: 0.9 }),
    L(ruffLines, 'none', { stroke: YB.redDeep, sw: 0.6 }),
    ...headParts(T({ sx: 1.14, sy: 1.14, tx: 56 * -0.14, ty: 30 * -0.14 })),
    ...looseD,
  ];
  // small: the ring and his head in its ruff, big
  // st carries (57, 30.4) to the middle at scale sk; xfD only scales about a point, so the
  // ruff is scaled about the one point that st leaves where it is
  const sk = 1.9, st = T({ sx: sk, sy: sk, tx: 50 - 57 * sk, ty: 50 - 30.4 * sk }), fx = (50 - 57 * sk) / (1 - sk), fy = (50 - 30.4 * sk) / (1 - sk);
  const small = [
    L(circle(C, C, 49.4), ink),
    L(circle(C, C, 48), YB.red),
    L(circle(C, C, 43.6), ink),
    L(circle(C, C, 42.4), YB.field),
    L(clipToDisc(xfD(wire, sk, fx, fy), C, C, 42.4), 'none', { stroke: YB.wire, sw: 1 }),
    L(clipToDisc(shape(body, st), C, C, 42.4), YB.white, { stroke: ink, sw: 2.4 }),
    L(clipToDisc(xfD(ruffBack, sk, fx, fy), C, C, 42.4), YB.redDeep, { stroke: ink, sw: 1.8 }),
    L(clipToDisc(xfD(ruffFront, sk, fx, fy), C, C, 42.4), YB.hackle, { stroke: ink, sw: 1.4 }),
    L(clipToDisc(xfD(ruffLines, sk, fx, fy), C, C, 42.4), 'none', { stroke: YB.redDeep, sw: 1 }),
    ...headParts(st),
  ];
  return { box: 100, layers, small };
}

// ST GARNEAU GUILLOTINES. Father Jerome's club, out of St Garneau's in Nine Elms. A solid
// G whose spur and serif are a guillotine: where a G's bowl turns up at the lower right
// into a short upright capped by a serif, the upright is the guillotine's two posts, the
// serif its beam (running in across the counter as the G's crossbar), and between the
// posts hang the raised blade and, low down, the lunette. One ink, one silhouette.
const SG = { red: '#af1e2d', blue: '#192168', white: '#ffffff' };
function guillotines() {
  // the bowl: a heavy ring, open on the right, from its top terminal over the top, down the
  // left and round the bottom, where it turns up into the guillotine's left post. Both ends
  // are cut square, on verticals: the top one is the G's beak, the bottom one the post.
  const EO = [47, 48.5, 31, 35.5], EI = [48.5, 48.5, 18.5, 23];          // outer, inner ellipses
  const onX = ([cx, cy, a, b], x, sign) => { const c = (x - cx) / a; return (sign < 0 ? -1 : 1) * Math.acos(c) * 180 / Math.PI; };
  const arc = ([cx, cy, a, b], from, to, n = 72) => Array.from({ length: n + 1 }, (_, k) => {
    const t = (from + (to - from) * (k / n)) * Math.PI / 180;
    return [cx + a * Math.cos(t), cy + b * Math.sin(t)];
  });
  const BEAK = 65, POST = 61.4;
  // angles (screen y down): the foot end is below the centre, the beak end above it
  // the bowl runs a little way into the post: two layers meeting edge to edge show a seam
  const oFoot = onX(EO, POST + 1.6, 1), iFoot = onX(EI, POST + 1.6, 1);
  const oTop = 360 + onX(EO, BEAK, -1), iTop = 360 + onX(EI, BEAK, -1);
  const bowlD = poly([...arc(EO, oFoot, oTop), ...arc(EI, iFoot, iTop).reverse()]);
  // the guillotine: the right post is the G's heavy stroke, the left a lighter one; the
  // beam is the serif, bracketed at both ends; the blade hangs a hair below it with its
  // edge on the slant; the lunette sits low with the neck hole through it
  const yb = 46.2, yf = 81.4;                       // beam top, foot
  const L0 = 61.4, L1 = 64.4, R0 = 74, R1 = 79;     // left and right post edges
  // the platform the posts stand on, level with the bottom of the bowl; its left end climbs
  // inside the bowl's curve so the two meet without a gap
  const foot = poly([[51, 83.4], [56, 82], [POST, 79.2], [POST + 1.5, yf], [81.8, yf], [82.6, yf + 2.6], [51, yf + 2.6]]);
  const posts = poly([[L0, yb + 4], [L1, yb + 4], [L1, yf], [L0, yf]]) + poly([[R0, yb + 4], [R1, yb + 4], [R1, yf], [R0, yf]]);
  const beam = shape([['M', 52, yb + 4.4], ['Q', 52.6, yb + 1.4, 55.4, yb], ['L', 81, yb], ['Q', 84, yb + 1, 84.4, yb + 4.4], ['L', 79, yb + 4.4], ['L', 79, yb + 4],
    ['L', 61.4, yb + 4], ['L', 61.4, yb + 4.4], ['Z']]);
  const blade = poly([[L1, yb + 5.6], [R0, yb + 5.6], [R0, yb + 10.6], [L1, yb + 14.6]]);
  const lunette = poly([[L1, yf - 10.6], [R0, yf - 10.6], [R0, yf - 5.2], [L1, yf - 5.2]]) + circle((L1 + R0) / 2, yf - 7.9, 2);
  // set down a touch smaller in the roundel, so the guillotine's foot clears the ring. The
  // pen's strokes and the guillotine's polygons wind opposite ways, so they're separate
  // layers in the same ink: in one path their overlap would cancel to a hole.
  const set = (d) => xfD(d, 0.9, 49, 50);
  const G = set(bowlD), frame = set(foot + posts + beam + blade + lunette);
  const layers = [
    L(circle(50, 50, 49.5), SG.blue),
    L(circle(50, 50, 46), SG.white),
    L(ring(50, 50, 42.6, 43.8), SG.red),
    L(G, SG.red),
    L(frame, SG.red),
  ];
  // small: the same mark, a touch heavier so the posts survive
  const small = [
    L(circle(50, 50, 49.5), SG.blue),
    L(circle(50, 50, 45), SG.white),
    L(G, SG.red, { stroke: SG.red, sw: 1 }),
    L(frame, SG.red, { stroke: SG.red, sw: 1.2 }),
  ];
  return { box: 100, layers, small };
}

// ── the Malcolm sett ────────────────────────────────────────────────────────────
// The Malcolm tartan as W. & A. Smith recorded it in 1850, transcribed from the Tartan
// Dictionary: K/4 Y4 K4 G24 K24 DB24 R4 DB4 R4 DB24 K24 G24 K4 LB/4, 344 threads to the
// repeat. Modern dyes: green, black and blue, with the red pair in the blue and the yellow
// and azure guards in the black. The green and blue are a shade brighter than the cloth:
// woven at a badge's size the true dyes sat so close to the black that the check read as one
// dark purple mass, and the guards that make it the Malcolm were lost in it.
const MALCOLM = {
  name: 'Malcolm',
  threads: 'K/4 Y4 K4 G24 K24 DB24 R4 DB4 R4 DB24 K24 G24 K4 LB/4',
  colours: { K: '#101010', Y: '#f4cf1a', G: '#16884c', DB: '#2a48a8', R: '#e0243e', LB: '#62b0ee' },
};

// ── the kits ────────────────────────────────────────────────────────────────────
// A kit is what a body wears. `jersey`/`trim`/`pants`/`sock`/`glove`/`helmet` are the
// solid colours every renderer understands. `number` and `numberEdge` letter the back.
// `hem`, `sleeve` and `socks` are bands: `at` and `w` as fractions of the hem-to-collar,
// elbow-to-wrist or knee-to-ankle run, `col` the colour, and `pattern` ('gems', 'sett',
// or 'dice' with an `alt` colour and `rows`) a richer fill where the renderer can paint
// one: the sweater's atlas paints them on the hem; sleeves and socks are flat rings on
// the mesh, so bands there must not overlap. `yoke` is the shoulder band's colour.
// `body: 'sett'` weaves the whole sweater in the club's tartan.
const band = (at, w, col, pattern, more) => (pattern ? { at, w, col, pattern, ...more } : { at, w, col });

function kit(o) { return o; }

// ── the keepers' masks ──────────────────────────────────────────────────────────
// A keeper wears a goalie mask (gl/arena-mesh.js builds it), painted the way real ones are,
// and each club's is its own. The art is layers in a 512 x 256 box that is the mask flattened
// (maskUV): x once round his head from behind his right ear, through the face (256) and his
// left side (384), to behind his left ear (512, the same place as 0); y from the crown (0) to
// below the chin (256). A line of constant height runs straight across and a meridian
// straight down, but a shape drawn there flat is squeezed sideways toward the crown, so
// `surf` draws in a frame on the mask's own surface, in radians of arc. The opening over the
// face is cut out of the shell (maskOutline), so art can run under it.
// ⚠ THE ART IS IN THE ENGINE'S FLATTENING. Change maskUV or the opening and every club's
// mask moves: run this script (its --check gate fails until you do).
// A mask is { w, h, base, trim, edge, layers, number: { at, size, fill, edge }, settUnit }:
// `base` fills the shell under the layers, `trim` and `edge` are what a renderer with no
// art uses (the 2-D one), and `number` is where the keeper's own number is lettered.
const MW = 512, MH = 256;
const mxy = (az, el) => { const [u, v] = maskUV(az, el); return [u * MW, v * MH]; };
const mpoly = (pts) => poly(pts.map(([a, e]) => mxy(a, e)));
// A frame on the mask's surface at (az0, el0): x across toward his left and y down, in
// radians of arc, turned by `rot` (positive turns +x downward). `sd` -1 mirrors it onto his
// right side.
const surf = (az0, el0, rot = 0, sd = 1) => T({ fn: (x, y) => {
  const c = Math.cos(rot), s = Math.sin(rot), X = x * c - y * s, Y = x * s + y * c, el = el0 - Y;
  return mxy(sd * (az0 + X / Math.max(0.2, Math.cos(el))), el);
} });
// an ellipse and a star as commands, for drawing in a frame. A radian is about 85px in the
// box, so a glint under a pixel across gets 4 corners, a stud 6 and a big shape 24.
const ellN = (r) => (r < 0.012 ? 4 : Math.max(6, Math.min(24, Math.round(r * 200))));
const ell = (rx, ry, cx = 0, cy = 0, n = ellN(Math.max(rx, ry))) => [...Array.from({ length: n }, (_, i) => [i ? 'L' : 'M', cx + rx * Math.cos((i / n) * TAU), cy + ry * Math.sin((i / n) * TAU)]), ['Z']];
const lstar = (r0, r1, n, cx = 0, cy = 0, rot = -Math.PI / 2) => [...Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? r0 : r1, a = rot + (i / (n * 2)) * TAU; return [i ? 'L' : 'M', cx + r * Math.cos(a), cy + r * Math.sin(a)]; }), ['Z']];
// a band of the mask between two heights (el0 above el1) and two azimuths: a rectangle in the box
const mband = (el0, el1, az0 = -Math.PI, az1 = Math.PI) => { const [x0, y0] = mxy(az0, el0), [x1, y1] = mxy(az1, el1); return poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); };
// the opening, and a ring round it pushed out by `d` radians of arc
const OPEN = maskOutline(24).opening;
const openRing = (d, centre = -0.22) => OPEN.map(([a, e]) => {
  const da = a * Math.cos(e), de = e - centre, l = Math.hypot(da, de) || 1, e2 = e + (de / l) * d;
  return [a + ((da / l) * d) / Math.max(0.2, Math.cos(e2)), e2];
});
// A crest's small drawing laid on the mask at (az, el), `size` radians across, round on the
// surface (wider in the box away from the equator).
function crestOn(crest, az, el, size) {
  const ky = (size * MH) / (Math.PI / 2 - MASK_EL_MIN) / 100, kx = (size * MW) / TAU / Math.max(0.2, Math.cos(el)) / 100, [cx, cy] = mxy(az, el);
  const map = (d) => {
    const out = [];
    for (const m of d.matchAll(/([MLQCZa])([^MLQCZa]*)/g)) {
      const cmd = m[1], nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
      if (cmd === 'Z') { out.push('Z'); continue; }
      if (cmd === 'a') {
        const r = [];
        for (let i = 0; i < nums.length; i += 7) r.push([nums[i] * kx, nums[i + 1] * ky, nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5] * kx, nums[i + 6] * ky].map(n2).join(' '));
        out.push('a' + r.join(' '));
        continue;
      }
      const pts = [];
      for (let i = 0; i < nums.length; i += 2) pts.push(P(cx + (nums[i] - 50) * kx, cy + (nums[i + 1] - 50) * ky));
      out.push(cmd + pts.join(' '));
    }
    return out.join('');
  };
  return (crest.small || crest.layers).map((l) => ({ ...l, d: map(l.d) }));
}
// The backplate behind the seams (past 2.15 rad either side), the strap across it, the seams,
// and the ear holes. The plate's top is rounded over the back of the crown.
function backplate(fill, { seam = '#141414', strap = '#141414', more = [] } = {}) {
  const top = (az) => 0.95 - 0.35 * ((Math.PI - Math.abs(az)) / (Math.PI - 2.15)) ** 2;
  const side = (s) => { const pts = []; for (let i = 0; i <= 12; i++) { const az = s * (2.15 + ((Math.PI - 2.15) * i) / 12); pts.push([az, top(az)]); } return [...pts, [s * Math.PI, -1.3], [s * 2.15, -1.3]]; };
  const seamLine = (s) => { const pts = []; for (let i = 0; i <= 12; i++) { const az = s * (2.15 + ((Math.PI - 2.15) * i) / 12); pts.push([az, top(az)]); } return pts; };
  const ly = [L(mpoly(side(1)) + mpoly(side(-1)), fill)];
  for (const s of [1, -1]) {
    const edgePts = [[s * 2.15, -1.3], ...seamLine(s), [s * Math.PI, top(s * Math.PI)]].map(([a, e]) => mxy(a, e));
    ly.push(L('M' + edgePts.map((p) => P(...p)).join('L'), 'none', { stroke: seam, sw: 2.6 }));
    ly.push(L(mband(-0.02, -0.1, s > 0 ? 2.15 : -Math.PI, s > 0 ? Math.PI : -2.15), strap, { op: 0.9 }));
  }
  for (const s of [1, -1]) ly.push(L(shape(ell(0.05, 0.075), surf(1.72, -0.18, 0, s)), '#101012', { op: 0.92 }));
  return [...ly, ...more];
}
const numberAt = (fill, edge, size = 30) => ({ at: [0, n2v(mxy(Math.PI, 0.22)[1])], size, fill, edge });
const n2v = (v) => Math.round(v * 10) / 10;
// Many copies of one small drawing (a stud, a bulb, a set stone) as one layer per part: the
// k-th layer of every copy joined into one path. The copies mustn't overlap.
const stack = (copies) => copies[0].map((l, k) => ({ ...l, d: copies.map((c) => c[k].d).join('') }));
// a mask, its runs of layers painted alike joined into one path each
const mask = (o) => ({ w: MW, h: MH, ...o, layers: o.layers.reduce((out, l) => {
  const p = out[out.length - 1], paint = (x) => JSON.stringify({ ...x, d: 0 });
  if (p && paint(p) === paint(l)) p.d += l.d; else out.push({ ...l });
  return out;
}, []) });

// The Yard Birds: the fighting cock. A black mask, the comb red over the crown, white hackles
// swept back over both cheeks, the horn beak driven down at the cage, yellow eyes under a
// glare, red wattles off the chin.
function yardBirdsMask() {
  const ly = [];
  const FEATHERS = [[0.6, 0.66, 1.15, 0.15], [0.66, 0.4, 1.45, 0.17], [0.68, 0.12, 1.55, 0.17], [0.62, -0.18, 1.45, 0.16], [0.52, -0.48, 1.2, 0.14]];
  for (const sd of [1, -1]) for (const [az0, el0, len, w] of FEATHERS) {
    const t = surf(az0, el0, -0.2, sd);
    const f = [['M', 0, -w * 0.45], ['C', len * 0.35, -w * 1.15, len * 0.75, -w * 0.9, len, -w * 0.12], ['C', len * 0.7, w * 0.4, len * 0.3, w * 0.75, 0, w * 0.5], ['Z']];
    ly.push(...group([shape(f, t)], YB.white, 2.6, '', YB.black));
    ly.push(L(shape([['M', 0.05, 0.02], ['Q', len * 0.5, -w * 0.3, len * 0.93, -w * 0.16]], t), 'none', { stroke: YB.red, sw: 2.2 }));
  }
  // the comb, scalloped, a constant width on the mask, from the brow over the top to the plate
  const comb = (azC, elLow) => {
    const hw = (el) => (0.11 + 0.045 * Math.abs(Math.sin(el * 30))) / Math.max(0.18, Math.cos(el));
    const up = [], down = [];
    for (let el = elLow; el <= 1.45; el += 0.025) { up.push([azC - hw(el), el]); down.unshift([azC + hw(el), el]); }
    return mpoly([...up, ...down]);
  };
  ly.push(...group([comb(0, 0.5), comb(Math.PI, 0.75), comb(-Math.PI, 0.75), mband(1.6, 1.42)], YB.red, 2.4, '', YB.black));
  // the beak, horn, its point at the cage
  const tb = surf(0, 0.52);
  ly.push(...group([shape([['M', -0.15, 0], ['Q', -0.12, 0.13, 0, 0.265], ['Q', 0.12, 0.13, 0.15, 0], ['Q', 0, -0.06, -0.15, 0], ['Z']], tb)], YB.horn, 2.6, '', YB.black));
  ly.push(L(shape([['M', -0.11, 0.06], ['Q', 0, 0.1, 0.11, 0.06]], tb), 'none', { stroke: YB.hornDeep, sw: 2 }));
  // the eyes, set wide and slanted down at the beak, a red glare over each
  for (const sd of [1, -1]) {
    const t = surf(0.36, 0.53, 0.3, sd);
    ly.push(...group([shape(ell(0.12, 0.055), t)], YB.iris, 2.2, '', YB.black));
    ly.push(L(shape(ell(0.016, 0.05), t), YB.black));
    ly.push(L(shape([['M', -0.17, -0.05], ['Q', 0, -0.16, 0.19, -0.1], ['L', 0.18, -0.05], ['Q', 0, -0.09, -0.16, -0.01], ['Z']], t), YB.red));
  }
  // the wattles
  for (const sd of [1, -1]) ly.push(...group([shape([['M', -0.055, 0], ['C', -0.11, 0.13, -0.07, 0.32, 0, 0.34], ['C', 0.08, 0.32, 0.1, 0.13, 0.055, 0], ['Z']], surf(0.1, -0.72, -0.12, sd))], YB.red, 2.2, '', YB.black));
  ly.push(...backplate(YB.red));
  return mask({ base: YB.black, trim: YB.red, edge: YB.white, layers: ly, number: numberAt(YB.white, YB.black) });
}

// The Wharf Rats: the rat. Black, a grey snout down the middle to a black nose over the cage,
// round ears (the left one torn), red slit eyes under a heavy brow, whiskers, and the yellow
// incisors under the cage. A silver anchor on the plate.
function wharfRatsMask() {
  const ly = [], base = '#1f2124', grey = '#8e8a84', greyDeep = '#55524d';
  for (const sd of [1, -1]) {
    const t = surf(1.1, 0.86, -0.3, sd);
    ly.push(...group([shape(ell(0.31, 0.27), t)], grey, 2.6, '', WRAT.ink));
    ly.push(L(shape(ell(0.21, 0.18, 0.02, 0.02), t), greyDeep));
    ly.push(L(shape(ell(0.12, 0.1, 0.04, 0.05), t), WRAT.ink, { op: 0.45 }));
  }
  ly.push(L(shape([['M', 0.18, -0.22], ['L', 0.34, -0.12], ['L', 0.23, -0.04], ['L', 0.33, 0.05], ['L', 0.18, 0.0], ['Z']], surf(1.1, 0.86, -0.3, 1)), base));
  // fur, swept back off the brow
  for (const sd of [1, -1]) for (const [el, len] of [[0.7, 0.5], [0.55, 0.6], [0.4, 0.55]]) ly.push(L(shape([['M', 0, 0], ['Q', len * 0.5, -0.05, len, -0.02]], surf(0.62, el, -0.1, sd)), 'none', { stroke: greyDeep, sw: 2 }));
  // the snout and the nose
  const tsn = surf(0, 0.95);
  ly.push(...group([shape([['M', -0.07, 0], ['L', 0.07, 0], ['Q', 0.21, 0.3, 0.17, 0.6], ['Q', 0, 0.68, -0.17, 0.6], ['Q', -0.21, 0.3, -0.07, 0], ['Z']], tsn)], grey, 2.4, '', WRAT.ink));
  ly.push(L(shape([['M', -0.11, 0.2], ['Q', -0.16, 0.42, -0.13, 0.58], ['Q', -0.17, 0.42, -0.15, 0.2], ['Z'], ['M', 0.11, 0.2], ['Q', 0.16, 0.42, 0.13, 0.58], ['Q', 0.17, 0.42, 0.15, 0.2], ['Z']], tsn), greyDeep, { op: 0.8 }));
  ly.push(L(shape([['M', -0.025, 0.06], ['L', 0.025, 0.06], ['Q', 0.06, 0.3, 0.045, 0.52], ['Q', 0, 0.56, -0.045, 0.52], ['Q', -0.06, 0.3, -0.025, 0.06], ['Z']], tsn), '#b3afa8', { op: 0.75 }));
  const tn = surf(0, 0.33);
  ly.push(...group([shape(ell(0.08, 0.048), tn)], '#2b2d31', 2.2, '', WRAT.ink));
  ly.push(L(shape(ell(0.016, 0.011, -0.03, 0.012), tn) + shape(ell(0.016, 0.011, 0.03, 0.012), tn), WRAT.ink));
  for (const sd of [1, -1]) {
    const t = surf(0.37, 0.53, 0.3, sd);
    ly.push(L(shape([['M', -0.17, -0.07], ['Q', 0, -0.15, 0.18, -0.1], ['L', 0.16, -0.04], ['Q', 0, -0.08, -0.15, -0.02], ['Z']], t), greyDeep));
    ly.push(...group([shape(ell(0.13, 0.055), t)], WRAT.eye, 2, '', WRAT.ink));
    ly.push(L(shape(ell(0.07, 0.028), t), WRAT.eyeCore, { op: 0.85 }));
    ly.push(L(shape(ell(0.013, 0.048), t), WRAT.ink));
  }
  // whiskers, three a side, out from the sides of the cage
  for (const sd of [1, -1]) for (const [e0, e1, bend] of [[0.1, 0.32, -0.08], [-0.02, 0.0, -0.03], [-0.14, -0.3, 0.05]]) {
    ly.push(L(shape([['M', 0, 0], ['Q', 0.45, bend, 0.95, e0 - e1]], surf(0.62, e0, 0, sd)), 'none', { stroke: '#d9d4cc', sw: 1.6 }));
  }
  // the incisors
  for (const sd of [1, -1]) ly.push(...group([shape([['M', 0.006, 0], ['L', 0.08, 0], ['L', 0.075, 0.25], ['Q', 0.043, 0.3, 0.01, 0.25], ['Z']], surf(0, -0.69, 0, sd))], WRAT.tooth, 2.2, '', WRAT.ink));
  // a stitched scar over his right temple
  const ts = surf(0.95, 0.35, 0.5, -1);
  ly.push(L(shape([['M', -0.25, 0], ['Q', 0, -0.04, 0.25, 0.02]], ts), 'none', { stroke: WRAT.rimDeep, sw: 2.4 }));
  for (let i = -2; i <= 2; i++) ly.push(L(shape([['M', i * 0.1, -0.05], ['L', i * 0.1 + 0.01, 0.05]], ts), 'none', { stroke: WRAT.rim, sw: 1.4 }));
  // the anchor on the plate, left of the number
  const ta = surf(2.62, 0.18);
  const anchor = [shape([['M', -0.012, -0.2], ['L', 0.012, -0.2], ['L', 0.012, 0.16], ['L', -0.012, 0.16], ['Z']], ta), shape([['M', -0.08, -0.13], ['L', 0.08, -0.13], ['L', 0.08, -0.105], ['L', -0.08, -0.105], ['Z']], ta),
    shape([['M', -0.15, 0.05], ['Q', -0.12, 0.2, 0, 0.21], ['Q', 0.12, 0.2, 0.15, 0.05], ['L', 0.12, 0.07], ['Q', 0.09, 0.17, 0, 0.18], ['Q', -0.09, 0.17, -0.12, 0.07], ['Z']], ta), shape(ell(0.035, 0.035, 0, -0.235), ta)];
  ly.push(...backplate(grey, { more: group(anchor, WRAT.rim, 2, '', WRAT.ink) }));
  return mask({ base, trim: WRAT.rim, edge: grey, layers: ly, number: numberAt(WRAT.rim, WRAT.ink) });
}

// The Westside Warlords: the warlord's helm. Gold, a black faceplate round the cage and down
// over the jaw, gold rivets round its edge, a row of set stones across the brow, a black crown
// with a stone in every point, and the W on the chin.
function warlordsMask() {
  const ly = [], gem = (t, r) => [L(shape(ell(r * 1.35, r * 1.35), t), WL.goldDeep), L(shape(ell(r * 1.15, r * 1.15), t), WL.black), L(shape(ell(r, r), t), WL.gem), L(shape([['M', -r * 0.6, -r * 0.1], ['L', 0, -r * 0.75], ['L', r * 0.6, -r * 0.1], ['Z']], t), WL.facet), L(shape(ell(r * 0.28, r * 0.28, -r * 0.35, -r * 0.35), t), WL.glint)];
  // the faceplate, round the cage and down over the jaw to the edge
  const ring = openRing(0.2);
  const jaw = mpoly([[-0.72, -0.25], [0.72, -0.25], [0.72, -1.3], [-0.72, -1.3]]);
  ly.push(...group([mpoly(ring), jaw], WL.black, 2.4, '', WL.goldDark));
  // rivets round the plate's edge
  for (let i = 0; i < ring.length; i += 2) { const [a, e] = ring[i]; if (e < -0.3) continue; ly.push(L(shape(ell(0.018, 0.018), surf(a * 0.93, e - 0.025)), WL.gold)); }
  for (const sd of [1, -1]) for (const el of [-0.45, -0.65, -0.85]) ly.push(L(shape(ell(0.018, 0.018), surf(sd * 0.66, el)), WL.gold));
  // the stones across the brow
  ly.push(...stack([-3, -2, -1, 0, 1, 2, 3].map((i) => gem(surf(i * 0.19, 0.44), 0.045))));
  // the crown: a band with five points, a stone in each
  const crown = [[-1.35, 0.6], [-1.35, 0.72]];
  for (let i = -2; i <= 2; i++) { const a = i * 0.45; crown.push([a - 0.18, 0.72], [a, 1.02], [a + 0.18, 0.72]); }
  crown.push([1.35, 0.72], [1.35, 0.6]);
  ly.push(...group([mpoly(crown)], WL.black, 2.2, '', WL.goldDark));
  ly.push(...stack([-2, -1, 0, 1, 2].map((i) => gem(surf(i * 0.45, 0.86), 0.035))));
  ly.push(...crestOn(warlords(), 0, -0.98, 0.32));
  ly.push(...backplate(WL.black, { seam: WL.goldDeep }));
  return mask({ base: WL.gold, trim: WL.black, edge: WL.goldDeep, layers: ly, number: numberAt(WL.gold, WL.goldDark) });
}

// The Coldwater Highlanders: woad and tartan. Green at the front, the Malcolm sett over the
// sides and the back, woad over the left half of his face, a ginger beard round the chin and
// ginger brows in a scowl. A saltire on the plate.
function highlandersMask() {
  const ly = [];
  for (const sd of [1, -1]) ly.push(L(sd > 0 ? mband(1.6, -1.3, 1.08, Math.PI) : mband(1.6, -1.3, -Math.PI, -1.08), 'sett'));
  for (const sd of [1, -1]) ly.push(L(mband(1.6, -1.3, sd > 0 ? 1.06 : -1.1, sd > 0 ? 1.1 : -1.06), HL.white));
  // the woad, from the crown down his left cheek, ragged where it was smeared on
  const woad = [];
  for (let el = 1.2; el >= -0.95; el -= 0.08) woad.push([0.02 + 0.06 * Math.sin(el * 23) + (el < -0.2 ? 0.04 : 0), el]);
  for (let el = -0.95; el <= 1.2; el += 0.12) woad.push([1.0 + 0.05 * Math.cos(el * 17), el]);
  ly.push(L(mpoly(woad), HL.woad));
  for (const [a, e] of [[0.45, 0.85], [0.75, 0.55], [0.5, -0.1], [0.85, -0.45]]) ly.push(L(shape(ell(0.09, 0.03), surf(a, e, 0.3)), HL.woadDeep, { op: 0.7 }));
  // the beard: round the jaw and over the chin, in strands
  const beard = [[-0.62, -0.05], [-0.5, -0.35], [-0.38, -0.62], [-0.2, -0.7], [0.2, -0.7], [0.38, -0.62], [0.5, -0.35], [0.62, -0.05], [0.78, -0.4], [0.7, -0.8], [0.45, -1.1], [0.15, -1.32], [-0.15, -1.32], [-0.45, -1.1], [-0.7, -0.8], [-0.78, -0.4]];
  ly.push(...group([mpoly(beard)], HL.ginger, 2.2, '', HL.gingerDeep));
  for (let i = 0; i < 18; i++) {
    const a = -0.66 + (i * 1.32) / 17, e0 = -0.62 - 0.25 * (1 - (a / 0.66) ** 2) * 0.2, e1 = e0 - 0.32 - 0.12 * Math.cos(i * 1.7);
    ly.push(L(shape([['M', 0, 0], ['Q', 0.02, (e0 - e1) * 0.5, 0.01 * Math.sign(a), e0 - e1]], surf(a, e0)), 'none', { stroke: i % 2 ? HL.gingerDeep : HL.gingerLight, sw: 1.6 }));
  }
  for (const sd of [1, -1]) ly.push(...group([shape([['M', -0.17, 0.02], ['Q', 0, -0.12, 0.2, -0.08], ['L', 0.2, -0.02], ['Q', 0, -0.05, -0.16, 0.06], ['Z']], surf(0.35, 0.47, 0.32, sd))], HL.ginger, 2, '', HL.gingerDeep));
  ly.push(...crestOn(highlanders(), -0.62, 0.62, 0.34));
  const ts = surf(Math.PI, 0.18), saltire = [shape([['M', -0.3, -0.24], ['L', -0.22, -0.3], ['L', 0.3, 0.24], ['L', 0.22, 0.3], ['Z']], ts), shape([['M', 0.3, -0.24], ['L', 0.22, -0.3], ['L', -0.3, 0.24], ['L', -0.22, 0.3], ['Z']], ts)];
  const ts2 = surf(-Math.PI, 0.18), saltire2 = [shape([['M', -0.3, -0.24], ['L', -0.22, -0.3], ['L', 0.3, 0.24], ['L', 0.22, 0.3], ['Z']], ts2), shape([['M', 0.3, -0.24], ['L', 0.22, -0.3], ['L', -0.3, 0.24], ['L', -0.22, 0.3], ['Z']], ts2)];
  ly.push(...backplate(HL.navy, { more: [L(saltire.join('') + saltire2.join(''), HL.white)] }));
  return mask({ base: HL.green, trim: HL.white, edge: HL.navy, layers: ly, number: { at: [0, n2v(mxy(Math.PI, -0.32)[1])], size: 24, fill: HL.white, edge: HL.navy }, settUnit: 0.17 });
}

// The St Garneau Guillotines: the drop. Red, the posts in navy up either side of the cage to
// the beam across the brow, the blade hanging from it slanted over his eyes, blood off its
// edge. The crest on the chin.
function guillotinesMask() {
  const ly = [], steel = '#c3cad2', steelHi = '#eef2f5', steelDark = '#6a737c', blood = '#5c0a12';
  for (const sd of [1, -1]) ly.push(...group([mband(0.92, -1.0, sd > 0 ? 0.7 : -0.86, sd > 0 ? 0.86 : -0.7)], SG.blue, 2.2, '', SG.white));
  ly.push(...group([mband(0.95, 0.8, -0.98, 0.98)], SG.blue, 2.2, '', SG.white));
  ly.push(L(mband(1.3, 0.95, -0.03, 0.03), '#2a2116'));
  // the blade: its top under the beam, its edge slanted
  const blade = [[-0.62, 0.78], [0.62, 0.78], [0.62, 0.52], [-0.62, 0.36]];
  ly.push(...group([mpoly(blade)], steel, 2.4, '', steelDark));
  ly.push(L(mpoly([[-0.62, 0.4], [0.62, 0.56], [0.62, 0.52], [-0.62, 0.36]]), steelHi));
  ly.push(L(mband(0.78, 0.7, -0.62, 0.62), steelDark));
  for (let i = -2; i <= 2; i++) ly.push(L(shape(ell(0.02, 0.02), surf(i * 0.25, 0.74)), '#3a3f45'));
  // blood off the edge
  for (const [a, len] of [[-0.42, 0.14], [-0.15, 0.22], [0.12, 0.1], [0.38, 0.18]]) {
    const e = 0.36 + ((a + 0.62) / 1.24) * 0.16;
    ly.push(L(shape([['M', -0.025, 0], ['L', 0.025, 0], ['L', 0.018, len], ['Q', 0.03, len + 0.05, 0, len + 0.06], ['Q', -0.03, len + 0.05, -0.018, len], ['Z']], surf(a, e)), blood));
  }
  ly.push(...crestOn(guillotines(), 0, -0.98, 0.34));
  ly.push(...backplate(SG.blue, { seam: SG.white }));
  return mask({ base: SG.red, trim: SG.blue, edge: SG.white, layers: ly, number: numberAt(SG.white, SG.blue) });
}

// The District 9 Goons: the riot squad. Purple, the police chequer round the head at the brow,
// the badge on the forehead with the precinct's number, a black riot frame round the cage,
// D9 stencilled on the chin.
function goonsMask() {
  const ly = [];
  // the chequer, three rows of it, all the way round
  const rows = 3, cols = 64, e0 = 0.62, e1 = 0.4, rh = (e0 - e1) / rows;
  let dark = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ((r + c) % 2 === 0) dark += mband(e0 - r * rh, e0 - (r + 1) * rh, -Math.PI + (c * TAU) / cols, -Math.PI + ((c + 1) * TAU) / cols);
  ly.push(L(mband(e0, e1), GN.bone), L(dark, GN.black));
  ly.push(L(mband(e0 + 0.025, e0), GN.black), L(mband(e1, e1 - 0.025), GN.black));
  // the riot frame round the cage
  ly.push(L(mpoly(openRing(0.09)), GN.black));
  // the badge: a six-point star on a disc, the 9 in it
  const tb = surf(0, 0.88);
  ly.push(...group([shape(lstar(0.11, 0.2, 6), tb)], GN.bone, 2.4, '', GN.black));
  ly.push(L(shape(ell(0.085, 0.085), tb), GN.purpleDeep));
  ly.push(L(shape(GLYPH['9'], T({ fn: (x, y) => tb.fn((x - 3) * 0.018, (y - 4.3) * 0.018) })), GN.bone, { rule: 'evenodd' }));
  // D9 on the chin
  const tc = surf(0, -0.82);
  ly.push(L(shape(GLYPH.D, T({ fn: (x, y) => tc.fn((x - 7.2) * 0.022, (y - 4) * 0.022) })) + shape(GLYPH['9'], T({ fn: (x, y) => tc.fn((x + 1.2) * 0.022, (y - 4.3) * 0.022) })), GN.bone, { rule: 'evenodd' }));
  ly.push(...backplate(GN.black, { seam: GN.bone }));
  return mask({ base: GN.purple, trim: GN.bone, edge: GN.black, layers: ly, number: numberAt(GN.bone, GN.purpleDeep) });
}

// The Boomtown Bulldogs: the bulldog. Orange, black jowls round the cage and over the chin with
// the underbite's fangs pointing up at the bars, a furrowed brow, rose ears, and a spiked collar
// all the way round the bottom edge.
function bulldogsMask() {
  const ly = [];
  const jowl = [[-0.66, 0.05], [-0.74, -0.3], [-0.72, -0.7], [-0.55, -1.0], [-0.2, -1.3], [0.2, -1.3], [0.55, -1.0], [0.72, -0.7], [0.74, -0.3], [0.66, 0.05], [0.5, -0.1], [0.36, -0.5], [0.3, -0.62], [-0.3, -0.62], [-0.36, -0.5], [-0.5, -0.1]];
  ly.push(L(mpoly(jowl), BD.black));
  for (const [a, h, w] of [[-0.21, 0.2, 0.06], [-0.1, 0.1, 0.035], [0, 0.09, 0.03], [0.1, 0.1, 0.035], [0.21, 0.2, 0.06]]) {
    ly.push(...group([shape([['M', -w, 0], ['L', w, 0], ['Q', w * 0.4, -h * 0.6, 0, -h], ['Q', -w * 0.4, -h * 0.6, -w, 0], ['Z']], surf(a, -0.86))], BD.bone, 1.8, '', BD.black));
  }
  for (const sd of [1, -1]) for (const [el, k] of [[0.42, 1], [0.52, 0.85], [0.62, 0.7]]) ly.push(L(shape([['M', -0.2 * k, 0.03], ['Q', 0, -0.06, 0.2 * k, 0.04]], surf(0.3, el, 0.25, sd)), 'none', { stroke: BD.black, sw: 2.8 }));
  for (const sd of [1, -1]) ly.push(...group([shape([['M', -0.18, 0.12], ['Q', -0.2, -0.12, 0.02, -0.2], ['Q', 0.24, -0.16, 0.22, 0.06], ['Q', 0.05, -0.02, -0.18, 0.12], ['Z']], surf(1.2, 0.78, -0.2, sd))], BD.black, 2, '', BD.orangeDark));
  // the collar
  const collar = [], spikes = [];
  for (let i = 0; i <= 96; i++) { const az = -Math.PI + (i * TAU) / 96; collar.push([az, edgeAt(az) + 0.16]); }
  const band2 = [...collar, ...collar.slice().reverse().map(([a, e]) => [a, e - 0.3])];
  ly.push(L(mpoly(band2), BD.black));
  for (let i = 0; i < 24; i++) {
    const az = -Math.PI + ((i + 0.5) * TAU) / 24, e = edgeAt(az) + 0.11;
    spikes.push(shape([['M', -0.045, -0.04], ['L', 0.045, -0.04], ['L', 0, 0.06], ['Z']], surf(az, e)));
  }
  ly.push(...group(spikes, BD.steel, 1.4, '', BD.steelDark));
  ly.push(...crestOn(bulldogs(), 0, 0.82, 0.3));
  ly.push(...backplate(BD.black, { seam: BD.orangeDark }));
  return mask({ base: BD.orange, trim: BD.black, edge: BD.bone, layers: ly, number: numberAt(BD.orange, BD.black) });
}
const edgeAt = (az) => maskOutline(24).edge.reduce((b, p) => (Math.abs(p[0] - az) < Math.abs(b[0] - az) ? p : b))[1];

// The Marquee Marauders: the marquee. Navy, a silver frame round the cage studded with lit
// bulbs, searchlights swept back over both sides, stars, and the crest over the brow.
function maraudersMask() {
  const ly = [], bulb = '#fff4cf', glow = '#ffe08a';
  for (const sd of [1, -1]) ly.push(L(mpoly([[sd * 0.95, 0.2], [sd * 2.1, 0.85], [sd * 2.1, -0.35]]), MM.blue, { op: 0.55 }));
  const outer = openRing(0.17), inner = openRing(0.05);
  ly.push(...group([mpoly(outer) + mpoly(inner.slice().reverse())], MM.silver, 2, '', MM.ink));
  const mid = openRing(0.11).filter((_, i) => i % 2 === 0);
  ly.push(...stack(mid.map(([a, e]) => { const t = surf(a, e); return [L(shape(ell(0.042, 0.042), t), glow, { op: 0.45 }), L(shape(ell(0.024, 0.024), t), bulb), L(shape(ell(0.008, 0.008, -0.008, -0.008), t), '#ffffff')]; })));
  for (const [a, e, r] of [[0.95, 0.95, 0.07], [-0.95, 0.95, 0.07], [1.55, 0.35, 0.06], [-1.55, 0.35, 0.06], [1.3, -0.45, 0.05], [-1.3, -0.45, 0.05], [0, 1.2, 0.06]]) ly.push(L(shape(lstar(r * 0.42, r, 5), surf(a, e)), MM.white));
  ly.push(...crestOn(marauders(), 0, 0.78, 0.32));
  ly.push(...backplate(MM.white, { seam: MM.silver }));
  return mask({ base: MM.navy, trim: MM.white, edge: MM.silver, layers: ly, number: numberAt(MM.navy, MM.silver) });
}

// ── the league ──────────────────────────────────────────────────────────────────
export const CLUBS = {
  'Westside Warlords': {
    district: 'glasshouse', home: 'the Glasshouse',
    colours: ['#f6b51e', '#0e0e0f'],
    crest: warlords(),
    mask: warlordsMask(),
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
    mask: bulldogsMask(),
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
    mask: maraudersMask(),
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
    mask: highlandersMask(),
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
    mask: goonsMask(),
    // a police kit: dark shoulders, a chequered band at the hem like a cap's, and two
    // stripes on every cuff and sock
    kit: {
      home: kit({ jersey: '#4b2a72', trim: '#efe5d2', number: '#efe5d2', numberEdge: '#121014', pants: '#121014', sock: '#4b2a72', glove: '#121014', helmet: '#121014',
        yoke: '#121014', hem: [band(0.0, 0.03, '#121014'), band(0.03, 0.1, '#121014', 'dice', { alt: '#efe5d2', rows: 2 }), band(0.13, 0.015, '#efe5d2')],
        sleeve: [band(0.26, 0.04, '#121014'), band(0.3, 0.03, '#efe5d2'), band(0.33, 0.04, '#121014'), band(0.37, 0.03, '#efe5d2'), band(0.4, 0.04, '#121014')],
        socks: [band(0.24, 0.04, '#121014'), band(0.28, 0.03, '#efe5d2'), band(0.31, 0.04, '#121014'), band(0.35, 0.03, '#efe5d2'), band(0.38, 0.04, '#121014')] }),
      road: kit({ jersey: '#efe5d2', trim: '#4b2a72', number: '#4b2a72', numberEdge: '#121014', pants: '#121014', sock: '#efe5d2', glove: '#121014', helmet: '#121014',
        yoke: '#4b2a72', hem: [band(0.0, 0.03, '#4b2a72'), band(0.03, 0.1, '#4b2a72', 'dice', { alt: '#efe5d2', rows: 2 }), band(0.13, 0.015, '#121014')],
        sleeve: [band(0.26, 0.04, '#4b2a72'), band(0.3, 0.03, '#efe5d2'), band(0.33, 0.04, '#4b2a72'), band(0.37, 0.03, '#efe5d2'), band(0.4, 0.04, '#4b2a72')],
        socks: [band(0.24, 0.04, '#4b2a72'), band(0.28, 0.03, '#efe5d2'), band(0.31, 0.04, '#4b2a72'), band(0.35, 0.03, '#efe5d2'), band(0.38, 0.04, '#4b2a72')] }),
    },
  },
  'Waterfront Wharf Rats': {
    district: 'docks', home: 'the Docks',
    // Black and silver, with the red of the rat's eye as a pinstripe.
    colours: ['#1f2124', '#c9d0d5'],
    crest: wharfRats(),
    mask: wharfRatsMask(),
    kit: {
      home: kit({ jersey: '#1f2124', trim: '#c9d0d5', number: '#c9d0d5', numberEdge: '#141414', pants: '#1f2124', sock: '#1f2124', glove: '#1f2124', helmet: '#1f2124',
        yoke: '#c9d0d5', hem: [band(0.0, 0.05, '#c9d0d5'), band(0.055, 0.03, '#c8202c'), band(0.09, 0.05, '#c9d0d5')], sleeve: [band(0.28, 0.07, '#c9d0d5'), band(0.35, 0.04, '#c8202c'), band(0.39, 0.07, '#c9d0d5')], socks: [band(0.26, 0.07, '#c9d0d5'), band(0.33, 0.04, '#c8202c'), band(0.37, 0.07, '#c9d0d5')] }),
      road: kit({ jersey: '#e8e9ea', trim: '#1f2124', number: '#1f2124', numberEdge: '#c8202c', pants: '#1f2124', sock: '#e8e9ea', glove: '#1f2124', helmet: '#1f2124',
        yoke: '#1f2124', hem: [band(0.0, 0.05, '#1f2124'), band(0.055, 0.03, '#c8202c'), band(0.09, 0.05, '#1f2124')], sleeve: [band(0.28, 0.07, '#1f2124'), band(0.35, 0.04, '#c8202c'), band(0.39, 0.07, '#1f2124')], socks: [band(0.26, 0.07, '#1f2124'), band(0.33, 0.04, '#c8202c'), band(0.37, 0.07, '#1f2124')] }),
    },
  },
  'St Garneau Guillotines': {
    district: 'residential', home: 'Nine Elms',
    colours: ['#af1e2d', '#192168'],
    crest: guillotines(),
    mask: guillotinesMask(),
    kit: {
      home: kit({ jersey: '#af1e2d', trim: '#192168', number: '#ffffff', numberEdge: '#192168', pants: '#192168', sock: '#af1e2d', glove: '#192168', helmet: '#192168',
        yoke: '#192168', hem: [band(0.0, 0.02, '#ffffff'), band(0.025, 0.07, '#192168'), band(0.1, 0.02, '#ffffff')], sleeve: [band(0.28, 0.03, '#ffffff'), band(0.31, 0.1, '#192168'), band(0.41, 0.03, '#ffffff')], socks: [band(0.24, 0.04, '#ffffff'), band(0.28, 0.12, '#192168'), band(0.4, 0.04, '#ffffff')] }),
      road: kit({ jersey: '#f6f6f4', trim: '#af1e2d', number: '#af1e2d', numberEdge: '#192168', pants: '#192168', sock: '#f6f6f4', glove: '#192168', helmet: '#192168',
        yoke: '#af1e2d', hem: [band(0.0, 0.02, '#af1e2d'), band(0.025, 0.07, '#192168'), band(0.1, 0.02, '#af1e2d')], sleeve: [band(0.28, 0.03, '#af1e2d'), band(0.31, 0.1, '#192168'), band(0.41, 0.03, '#af1e2d')], socks: [band(0.24, 0.04, '#af1e2d'), band(0.28, 0.12, '#192168'), band(0.4, 0.04, '#af1e2d')] }),
    },
  },
  'Yard Birds': {
    district: 'yards', home: 'the Yards',
    colours: ['#c8201c', '#f6f4ef', '#141414'],
    crest: yardBirds(),
    mask: yardBirdsMask(),
    kit: {
      home: kit({ jersey: '#c8201c', trim: '#141414', number: '#f6f4ef', numberEdge: '#141414', pants: '#141414', sock: '#c8201c', glove: '#141414', helmet: '#141414',
        yoke: '#141414', hem: [band(0.0, 0.05, '#141414'), band(0.055, 0.03, '#f6f4ef'), band(0.09, 0.05, '#141414')], sleeve: [band(0.28, 0.06, '#141414'), band(0.34, 0.03, '#f6f4ef'), band(0.37, 0.06, '#141414')], socks: [band(0.26, 0.06, '#141414'), band(0.32, 0.03, '#f6f4ef'), band(0.35, 0.06, '#141414')] }),
      road: kit({ jersey: '#f6f4ef', trim: '#c8201c', number: '#c8201c', numberEdge: '#141414', pants: '#141414', sock: '#f6f4ef', glove: '#141414', helmet: '#141414',
        yoke: '#141414', hem: [band(0.0, 0.05, '#c8201c'), band(0.055, 0.03, '#141414'), band(0.09, 0.05, '#c8201c')], sleeve: [band(0.28, 0.06, '#c8201c'), band(0.34, 0.03, '#141414'), band(0.37, 0.06, '#c8201c')], socks: [band(0.26, 0.06, '#c8201c'), band(0.32, 0.03, '#141414'), band(0.35, 0.06, '#c8201c')] }),
    },
  },
};

// ── the copy GLASS draws ────────────────────────────────────────────────────────
// Golden Goose Gardens carries a shield for every club on its east stand
// (client/game/js/panels/glass/models/ashway.js). The renderer runs with no server and never sees
// sports_pools.clubs, which club-crest.js only gets when the TV asks for it, so the shields read
// this copy: each club's colours and the small drawing of its crest (the one the jerseys wear), in
// league order. A shield is a hand's width across from the street, which is the size `small` is for.
const CRESTS = path.join(ROOT, 'client/shared/cphl-crests.js');
function crestsModule(teams) {
  // A club with a tartan carries its sett too: the shield's field is woven in it.
  const rows = teams.map((name) => {
    const c = CLUBS[name], small = Array.isArray(c.crest.small) && c.crest.small.length ? c.crest.small : c.crest.layers;
    const row = { name, colours: c.colours, crest: { box: c.crest.box || 100, layers: small } };
    if (c.sett) { row.sett = c.sett; if (c.crest.settUnit) row.crest.settUnit = c.crest.settUnit; }
    return `  ${JSON.stringify(row)},`;
  });
  return [
    '// GENERATED by scripts/content/build-cphl-clubs.mjs. Never edit by hand.',
    '//',
    "// The CPhL's clubs as Golden Goose Gardens shows them: each club's colours and the small drawing of",
    "// its crest, in league order. The clubs are content (sports_pools.clubs on the Cluster Puck row);",
    '// this is the copy GLASS paints, because the renderer has no server to ask. Re-run the script after',
    '// editing a club. Its --check gate fails while this file is behind.',
    'export const CPHL_CRESTS = [',
    ...rows,
    '];',
    '',
  ].join('\n');
}

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
  const crests = crestsModule(teams);
  let crestsNow = '';
  try { crestsNow = fs.readFileSync(CRESTS, 'utf8').replace(/\r\n/g, '\n'); } catch { /* not written yet */ }
  if (process.argv.includes('--check')) {
    if (next !== cur) { console.error('✗ sports_pools.clubs is out of date: run node scripts/content/build-cphl-clubs.mjs'); process.exit(1); }
    if (crests !== crestsNow) { console.error(`✗ ${path.relative(ROOT, CRESTS)} is out of date: run node scripts/content/build-cphl-clubs.mjs`); process.exit(1); }
  } else {
    sp.clubs = CLUBS;
    row.sports_pools = sp;
    fs.writeFileSync(ROW, `${JSON.stringify(row, null, 2)}\n`, 'utf8');
    console.log(`  wrote ${Object.keys(CLUBS).length} clubs into ${path.relative(ROOT, ROW)} (${(next.length / 1024).toFixed(1)} KB)`);
    if (crests !== crestsNow) {
      fs.writeFileSync(CRESTS, crests, 'utf8');
      console.log(`  wrote ${teams.length} crests into ${path.relative(ROOT, CRESTS)} (${(crests.length / 1024).toFixed(1)} KB)`);
    }
  }
}
