// GLASS 2 · WHAT MOVES ON THE CHEM STAGE: liquids and powders, and the hands that move them
// (docs/proposals/chem-stage.md, phase 2).
//
// The models are small and pure: a liquid's surface tilts on a damped spring when its vessel is
// knocked (`slosh`), a powder piles on a radial heightfield that slumps to its angle of repose
// (`heap`), colours mix by volume, bubbles rise on a clock the caller hands in. `drawStage` then
// draws one stage's moving pieces (the level in the cylinder, the stream off the bottle, the mercury,
// the vapour ring, the heap on the boat, the pestle, the punch) into a batch for gl/room.js
// `setProps`, in the room's world frame, at the places gl/lab-mesh.js `benchOf` gives. What doesn't
// move, the glass included, is in the set (lab-mesh.js `workingSet`).
//
// ⚠ PICTURE ONLY. The score is client/shared/chem-chain.js's; nothing here decides anything, and the
// stage's `view` is all it reads.
//
// ⚠ NO WALL CLOCK, NO Math.random, NO DOM. `t` is handed in, so scripts/shapes/chem-stage-smoke.mjs
// builds every stage in Node.

import { createBatch, vtx, lin, MAT } from './ballpark-mesh.js';
import { facing } from '../../../../shared/room-layout.js';
import { benchOf, gradeOf, separatorProfile } from './lab-mesh.js';

const { GLOSS, METAL, SATIN, MATTE } = MAT;
const GLOW = 40;
// a liquid in gl/room.js's glass pass: tinted, lit and see-through (its props glass, setPropsGlass)
export const LIQUID = 44;
// Where this frame's liquids go: the props glass when the caller hands one in (o.glass), else drawn solid
// with everything else. Set at the top of drawStage.
let W = null, LQ = GLOSS;

// ── the models ──────────────────────────────────────────────────────────────────────────────────────
// A liquid's surface as a plane through its middle, tilted [x, z] (rise per metre), on a damped spring.
export function createSlosh() { return { tilt: [0, 0], vel: [0, 0] }; }
export function stepSlosh(s, accel = [0, 0], dt = 1 / 60) {
  const K = 60, C = 2.2, PUSH = 0.012;
  for (let i = 0; i < 2; i++) {
    s.vel[i] += (-K * s.tilt[i] - C * s.vel[i] - accel[i] * PUSH * 60) * dt;
    s.tilt[i] = Math.max(-0.35, Math.min(0.35, s.tilt[i] + s.vel[i] * dt));
  }
  return s;
}

// A powder piled in a round dish of radius R: n rings, each a height. What's poured lands on a ring and
// slides outward wherever a step is steeper than the angle of repose, so it keeps its mass and its cone.
export function createHeap(R = 0.035, n = 16, repose = 0.6) { return { R, n, dr: R / n, repose, hgt: new Float32Array(n) }; }
const ringArea = (h, i) => Math.PI * (2 * i + 1) * h.dr * h.dr;
export function addToHeap(h, volume, at = 0) {
  const i = Math.max(0, Math.min(h.n - 1, Math.floor(at / h.dr)));
  h.hgt[i] += volume / ringArea(h, i);
}
export function settleHeap(h, passes = 3) {
  const tan = Math.tan(h.repose) * h.dr;
  for (let k = 0; k < passes; k++) for (let i = 0; i + 1 < h.n; i++) {
    const over = h.hgt[i] - h.hgt[i + 1] - tan;
    if (over <= 0) continue;
    const a = ringArea(h, i), b = ringArea(h, i + 1), dv = over / (1 / a + 1 / b);
    h.hgt[i] -= dv / a; h.hgt[i + 1] += dv / b;
  }
}
export const heapMass = (h) => { let m = 0; for (let i = 0; i < h.n; i++) m += h.hgt[i] * ringArea(h, i); return m; };

// A colour as linear rgb, whether it came as #rrggbb or already as rgb.
const rgbOf = (c) => (Array.isArray(c) ? c : lin(c));

// Colours mixed by volume: mixColour([rgb, vol], [rgb, vol], ...)
export function mixColour(...parts) {
  let v = 0; const o = [0, 0, 0];
  for (const [c, k] of parts) { v += k; for (let i = 0; i < 3; i++) o[i] += c[i] * k; }
  return v > 0 ? o.map((x) => x / v) : [0, 0, 0];
}

// A seeded number in 0..1 for (i, salt), steady from frame to frame.
const hash = (i, salt = 0) => { const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return s - Math.floor(s); };

// ── drawing, in a piece's own frame ─────────────────────────────────────────────────────────────────
// x across the piece, y up off the floor, z out of its front (room-kit.js `frame`), to the world.
function frameOf(L, p) {
  const [fu, fv] = facing(p.turn), su = -fv, sv = fu;
  const P = (x, y, z) => L.world(p.u + su * x + fu * z, p.v + sv * x + fv * z, y);
  const N = (x, y, z) => { const du = su * x + fu * z, dv = sv * x + fv * z; return [L.r[0] * du - L.f[0] * dv, y, L.r[2] * du - L.f[2] * dv]; };
  return { P, N };
}
// A local frame inside the piece: an origin and three axes, so a bottle can tip.
const upright = (o) => ({ o, ax: [1, 0, 0], ay: [0, 1, 0], az: [0, 0, 1] });
// tipped by `a` about the piece's z (its top toward +x for a negative a)
// turned by `a` about the piece's y, for a leaf lying on the screen
const turnedY = (o, a) => { const c = Math.cos(a), s = Math.sin(a); return { o, ax: [c, 0, -s], ay: [0, 1, 0], az: [s, 0, c] }; };
const tippedZ = (o, a) => { const c = Math.cos(a), s = Math.sin(a); return { o, ax: [c, s, 0], ay: [-s, c, 0], az: [0, 0, 1] }; };
const apply = (X, l) => [X.o[0] + X.ax[0] * l[0] + X.ay[0] * l[1] + X.az[0] * l[2], X.o[1] + X.ax[1] * l[0] + X.ay[1] * l[1] + X.az[1] * l[2], X.o[2] + X.ax[2] * l[0] + X.ay[2] * l[1] + X.az[2] * l[2]];
const turn = (X, n) => [X.ax[0] * n[0] + X.ay[0] * n[1] + X.az[0] * n[2], X.ax[1] * n[0] + X.ay[1] * n[1] + X.az[1] * n[2], X.ax[2] * n[0] + X.ay[2] * n[1] + X.az[2] * n[2]];

function pen(b, F) {
  const UV = [0, 0];
  const col = (hex, k = 1) => (Array.isArray(hex) ? hex : lin(hex)).map((c) => c * k);
  const quad = (ps, n, c, mat) => { const w = ps.map((q) => F.P(...q)), nn = F.N(...n); for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, w[i], nn, UV, c, mat); };
  // a turned piece round the frame's y: `prof` is [radius, y] from the bottom up
  const lathe = (X, prof, hex, k = 1, n = 14, mat = GLOSS) => {
    const c = col(hex, k);
    for (let i = 0; i + 1 < prof.length; i++) {
      const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
      if (Math.abs(dr) + Math.abs(dy) < 1e-6) continue;
      for (let j = 0; j < n; j++) {
        const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
        const at = (r, a, y) => apply(X, [Math.cos(a) * r, y, Math.sin(a) * r]);
        quad([at(r0, a0, y0), at(r0, a1, y0), at(r1, a1, y1), at(r1, a0, y1)], turn(X, [(Math.cos(am) * dy) / l, -dr / l, (Math.sin(am) * dy) / l]), c, mat);
      }
    }
  };
  const box = (X, x0, x1, y0, y1, z0, z1, hex, k = 1, mat = SATIN) => {
    const c = col(hex, k), A = (x, y, z) => apply(X, [x, y, z]), T = (n) => turn(X, n);
    quad([A(x0, y1, z0), A(x1, y1, z0), A(x1, y1, z1), A(x0, y1, z1)], T([0, 1, 0]), c, mat);
    quad([A(x0, y0, z0), A(x0, y0, z1), A(x1, y0, z1), A(x1, y0, z0)], T([0, -1, 0]), c, mat);
    quad([A(x0, y0, z1), A(x0, y1, z1), A(x1, y1, z1), A(x1, y0, z1)], T([0, 0, 1]), c, mat);
    quad([A(x1, y0, z0), A(x1, y1, z0), A(x0, y1, z0), A(x0, y0, z0)], T([0, 0, -1]), c, mat);
    quad([A(x0, y0, z0), A(x0, y1, z0), A(x0, y1, z1), A(x0, y0, z1)], T([-1, 0, 0]), c, mat);
    quad([A(x1, y0, z1), A(x1, y1, z1), A(x1, y1, z0), A(x1, y0, z0)], T([1, 0, 0]), c, mat);
  };
  // a round bar from a to b, in the piece's frame
  const rod = (a, bb, r, hex, k = 1, mat = METAL, n = 6) => {
    const d = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], l = Math.hypot(...d) || 1, ay = d.map((x) => x / l);
    const ref = Math.abs(ay[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ax = [ay[1] * ref[2] - ay[2] * ref[1], ay[2] * ref[0] - ay[0] * ref[2], ay[0] * ref[1] - ay[1] * ref[0]];
    const al = Math.hypot(...ax); ax = ax.map((x) => x / al);
    const az = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]];
    lathe({ o: a, ax, ay, az }, [[r, 0], [r, l]], hex, k, n, mat);
  };
  const ball = (o, r, hex, k = 1, mat = GLOSS, n = 8) => lathe(upright(o), Array.from({ length: 7 }, (_, i) => { const a = -Math.PI / 2 + (i / 6) * Math.PI; return [Math.cos(a) * r, Math.sin(a) * r]; }), hex, k, n, mat);
  // a flat disc of radius r at height y, its surface tilted [x, z]
  const surface = (x, z, r, y, tilt, hex, k = 1, mat = GLOSS, n = 18) => {
    const c = col(hex, k), at = (a) => { const dx = Math.cos(a) * r, dz = Math.sin(a) * r; return [x + dx, y + tilt[0] * dx + tilt[1] * dz, z + dz]; };
    const n0 = [-tilt[0], 1, -tilt[1]];
    for (let j = 0; j < n; j++) { const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2; quad([[x, y, z], at(a0), at(a1), at(a1)], n0, c, mat); }
  };
  return { col, quad, lathe, box, rod, ball, surface };
}

// A liquid standing in an upright round vessel at (x, z) from y0: a column up to `level`, its top tilted.
function liquidIn(D, x, z, y0, r, level, hex, tilt = [0, 0], k = 1) {
  if (level <= 0.0005) return;
  const P = W || D;
  P.lathe(upright([x, y0, z]), [[0, 0], [r, 0], [r, level]], hex, k, 18, LQ);
  P.surface(x, z, r, y0 + level, tilt, hex, k * 1.08, LQ);
}
// Bubbles rising through a column of liquid: `count` of them, each on its own clock.
function bubbles(D, x, z, y0, r, h, count, t, k = 1) {
  for (let i = 0; i < count; i++) {
    const ph = (t * (0.6 + hash(i, 3) * 0.9) + hash(i, 1)) % 1, a = hash(i, 2) * Math.PI * 2, d = Math.sqrt(hash(i, 4)) * r * 0.8;
    (W || D).ball([x + Math.cos(a) * d, y0 + ph * h, z + Math.sin(a) * d], 0.0018 + hash(i, 5) * 0.002, '#fffaf0', k * 1.3, LQ, 6);
  }
}
// The part of a turned profile between heights ya and yb, pulled in by `inset` and closed at both ends:
// one layer of what's in a vessel.
export function profileSlice(prof, ya, yb, inset = 0.9) {
  const rAt = (y) => {
    for (let i = 0; i + 1 < prof.length; i++) { const [r0, y0] = prof[i], [r1, y1] = prof[i + 1]; if (y >= y0 && y <= y1) return y1 === y0 ? r1 : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); }
    return y < prof[0][1] ? prof[0][0] : prof[prof.length - 1][0];
  };
  const out = [[0, ya], [rAt(ya) * inset, ya]];
  for (const [r, y] of prof) if (y > ya && y < yb) out.push([r * inset, y]);
  out.push([rAt(yb) * inset, yb], [0, yb]);
  return out;
}

// A heap as a lathe: the ring heights, out from the middle.
function heapShape(D, x, z, y0, H, hex, k = 1) {
  const prof = [[0, y0 + H.hgt[0]]];
  for (let i = 0; i < H.n; i++) prof.push([(i + 0.5) * H.dr, y0 + H.hgt[i]]);
  prof.push([H.R, y0]);
  D.lathe(upright([x, 0, z]), prof, hex, k, 20, MATTE);
}

// The hotplate's dial: a knob on its front with a pointer turned by the setting, and a lamp lit when it's on.
function plateDial(D, B, dial) {
  const { x, z } = B.plate, kx = x + 0.045, ky = B.top + 0.035, kz = z + 0.095, a = -2.4 + dial * 4.8;
  D.box(upright([kx, ky, kz]), -0.014, 0.014, -0.014, 0.014, 0, 0.012, '#1c1e20', 1, SATIN);
  D.rod([kx, ky, kz + 0.012], [kx + Math.sin(a) * 0.012, ky + Math.cos(a) * 0.012, kz + 0.014], 0.0022, '#f4f2ea', 1.3, MATTE, 4);
  if (dial > 0.02) D.box(upright([x - 0.06, B.top + 0.05, z + 0.095]), 0, 0.008, 0, 0.006, 0, 0.002, '#ff4a2a', 1.6, GLOW);
}

// One stage's moving pieces, into `out` (or a fresh batch). `view` is the stage's own (chem-chain.js),
// `o` is { t (seconds, the caller's clock), grade, liquid, product (hex or linear rgb), slosh, heap, glass (a
// batch for the liquids, drawn see-through in the room's glass pass) }.
export function drawStage(L, p, stage, view, o = {}, out = null) {
  const b = out || createBatch(4096);
  if (out) b.n = 0;
  const g = typeof o.grade === 'number' ? o.grade : gradeOf(o.grade), B = benchOf(p, g), D = pen(b, frameOf(L, p));
  if (o.glass) o.glass.n = 0;
  W = o.glass ? pen(o.glass, frameOf(L, p)) : D; LQ = o.glass ? LIQUID : GLOSS;
  const t = o.t || 0, liquid = rgbOf(o.liquid || '#c83a3a'), product = rgbOf(o.product || '#f0f0ea'), tilt = o.slosh?.tilt || [0, 0], top = B.top;
  switch (stage) {
    case 'measure': {
      const { x, z, r, h } = B.cyl, y0 = top + 0.012;
      liquidIn(D, x, z, y0, r * 0.92, view.level * h, liquid, tilt);
      // the line to stop at, painted on the glass
      D.lathe(upright([x, y0 + view.target * h, z]), [[r * 1.04, -0.0012], [r * 1.04, 0.0012]], '#e83a2a', 1.25, 20, MATTE);
      // the bottle, tipping toward the cylinder about a point by its shoulder
      const bt = B.bottle, ang = -view.tip * 1.9, pivot = [bt.x + 0.02, top + 0.13, bt.z];
      const X = tippedZ(pivot, ang), base = [-0.02, -0.13, 0];
      const prof = [[0, 0], [bt.r, 0], [bt.r, bt.h * 0.66], [bt.r * 0.4, bt.h * 0.82], [bt.r * 0.34, bt.h], [0, bt.h]].map(([rr, y]) => [rr, y]);
      D.lathe({ ...X, o: apply(X, base) }, prof, '#6a3a14', 0.95, 14, GLOSS);
      D.lathe({ ...X, o: apply(X, base) }, [[bt.r * 1.02, bt.h * 0.2], [bt.r * 1.02, bt.h * 0.5]], '#f4f2ea', 1, 14, MATTE);
      // the stream: from the lip, falling onto the surface; a thin one breaks into drops
      if (view.flow > 0.002) {
        const lip = apply(X, [base[0], base[1] + bt.h, 0]), land = y0 + view.level * h;
        const w = 0.0015 + view.flow * 0.03, v0 = 0.25 + view.flow * 1.2, fall = Math.max(0.01, lip[1] - land);
        const tf = (-v0 * 0 + Math.sqrt(2 * 9.8 * fall)) / 9.8, path = (s) => [lip[0] + (x - lip[0]) * s, lip[1] - 0.5 * 9.8 * (s * tf) ** 2 - (lip[1] - land - 0.5 * 9.8 * tf * tf) * s, lip[2] + (z - lip[2]) * s];
        if (view.flow > 0.03) for (let i = 0; i < 8; i++) W.rod(path(i / 8), path((i + 1) / 8), w * (1 - i * 0.05), liquid, 1.05, LQ, 6);
        else for (let i = 0; i < 4; i++) W.ball(path((t * 2.2 + i / 4) % 1), 0.0028, liquid, 1.05, LQ, 6);
      }
      return b;
    }
    case 'heat': {
      const { x, z } = B.plate, { r, h } = B.beaker, y0 = B.plate.y + 0.004, T = B.therm, lv = h * 0.6;
      liquidIn(D, x, z, y0, r * 0.92, lv, liquid, tilt);
      bubbles(D, x, z, y0, r, lv, Math.round(view.boiling * 18 + view.temp * 4), t * (0.5 + view.temp));
      // the mercury, and the mark it has to sit on (green, its width the band)
      const span = T.y1 - T.y0 - 0.05, yOf = (v) => T.y0 + 0.03 + span * Math.max(0, Math.min(1, v));
      D.lathe(upright([T.x, T.y0 + 0.012, T.z]), [[0.0022, 0], [0.0022, yOf(view.temp) - T.y0 - 0.012]], '#c8303a', 1.15, 8, GLOSS);
      D.lathe(upright([T.x, yOf(view.target - view.band), T.z]), [[0.0068, 0], [0.0068, Math.max(0.002, span * 2 * view.band)]], '#3ad06a', 1.3, 12, MATTE);
      plateDial(D, B, view.dial);
      return b;
    }
    case 'reflux': {
      const R = B.reflux, { x, z } = R, len = R.cy1 - R.cy0;
      // the ring of condensing vapour, a pale band where it's climbed to; above the top it's escaping
      const ry = R.cy0 + Math.min(1, view.ring) * len;
      D.lathe(upright([x, ry - 0.012, z]), [[0.019, 0], [0.019, 0.024]], view.ring >= 1 ? '#ffd0c0' : '#f4f8fa', 1.15, 14, GLOSS);
      if (view.ring >= 1) for (let i = 0; i < 6; i++) D.ball([x + (hash(i, 7) - 0.5) * 0.03, R.cy1 + 0.02 + ((t * 0.8 + hash(i, 8)) % 1) * 0.12, z + (hash(i, 9) - 0.5) * 0.03], 0.006 + hash(i, 6) * 0.006, '#e8eef0', 1.1, MATTE, 6);
      // the water in the jacket, moving up in stripes as fast as it's running
      for (let i = 0; i < 6; i++) { const y = R.cy0 + 0.02 + (((i / 6) + t * view.flow * 0.6) % 1) * (len - 0.04); D.lathe(upright([x, y, z]), [[0.0205, 0], [0.0205, 0.012]], '#5aa8e8', 0.9 + view.flow * 0.4, 12, GLOSS); }
      // the flask boiling as hard as the heat, and the drips coming back down the inner tube
      bubbles(D, x, z, R.seat + 0.01, R.r * 0.7, R.r * 0.7, Math.round(4 + view.heat * 14), t);
      for (let i = 0; i < 3; i++) D.ball([x, ry - ((t * 1.4 + i / 3) % 1) * (ry - R.mouth), z], 0.0022, '#e8f0f4', 1.1, GLOSS, 6);
      // the water tap on its riser beside the rig: the lever turned as far as it's open, and the hose to the jacket
      const tp = R.tap, a = -1.4 + view.flow * 1.4;
      D.rod([tp.x, top, tp.z], [tp.x, tp.y, tp.z], 0.008, '#b8bcc0', 1.05, METAL, 8);
      D.box(upright([tp.x, tp.y, tp.z]), -0.014, 0.014, -0.012, 0.016, -0.014, 0.014, '#3a6aa8', 1, METAL);
      D.rod([tp.x, tp.y + 0.016, tp.z], [tp.x + Math.sin(a) * 0.05, tp.y + 0.016 + Math.cos(a) * 0.05, tp.z], 0.0045, '#3a6aa8', 1.05, METAL, 6);
      D.ball([tp.x + Math.sin(a) * 0.05, tp.y + 0.016 + Math.cos(a) * 0.05, tp.z], 0.008, '#1c1e20', 1, SATIN, 8);
      D.rod([tp.x - 0.014, tp.y, tp.z], [x + 0.06, R.cy0 + 0.03, z], 0.006, '#2a2c30', 0.9, SATIN, 6);
      return b;
    }
    case 'evaporate': {
      const { x, z } = B.plate, { r, h } = B.dish, y0 = B.plate.y + 0.006;
      plateDial(D, B, view.boiling ? 0.7 : 0);
      const fill = 0.002 + view.vol * h * 0.6, rr = r * (0.55 + view.vol * 0.33);
      const hex = view.beat === 'wet' ? liquid : view.beat === 'dry' ? product : '#4a2a14';
      D.surface(x, z, rr, y0 + fill, view.beat === 'wet' ? tilt : [0, 0], hex, view.beat === 'wet' ? 1 : 0.95, view.beat === 'wet' ? GLOSS : MATTE);
      if (view.beat !== 'wet') for (let i = 0; i < 18; i++) { const a = hash(i, 11) * 6.28, d = Math.sqrt(hash(i, 12)) * rr * 0.9; D.box(upright([x + Math.cos(a) * d, y0 + fill, z + Math.sin(a) * d]), -0.003, 0.003, 0, 0.002 + hash(i, 13) * 0.003, -0.003, 0.003, hex, 0.9 + hash(i, 14) * 0.2, MATTE); }
      if (view.boiling) {
        bubbles(D, x, z, y0 + fill - 0.002, rr * 0.8, 0.004, 10, t * 2);
        // (the steam is lightStage's: soft wisps in the halo pass)
      }
      return b;
    }
    case 'weigh': {
      const S = B.scale, by = S.pan + 0.002, bx = S.x, bz = S.z - 0.012;
      if (o.heap) heapShape(D, bx, bz, by, o.heap, product);
      // the spatula over the boat, tipping as it's held, with what's left on it
      const pv = [bx + 0.06, by + 0.06, bz], X = tippedZ(pv, view.tip * 0.6);
      D.box(X, -0.07, 0.0, -0.002, 0.0, -0.011, 0.011, '#c8ccd0', 1.05, METAL);
      D.box(X, 0.0, 0.11, -0.003, 0.003, -0.004, 0.004, '#c8ccd0', 1.05, METAL);
      D.box(X, -0.06, -0.012, 0.0, 0.004 * (1 - view.tip * 0.6), -0.008, 0.008, product, 1, MATTE);
      // what's falling, a column of grains from the blade's tip to the boat
      if (view.falling > 0.002 || view.tip > 0.25) {
        const tip = apply(X, [-0.07, 0, 0]), n = Math.min(14, 3 + Math.round(view.falling * 40));
        for (let i = 0; i < n; i++) { const ph = (t * 3 + hash(i, 20)) % 1; D.box(upright([tip[0] + (hash(i, 21) - 0.5) * 0.008, tip[1] - ph * (tip[1] - by - 0.004), tip[2] + (hash(i, 22) - 0.5) * 0.008]), -0.0012, 0.0012, -0.0012, 0.0012, -0.0012, 0.0012, product, 1, MATTE); }
      }
      return b;
    }
    case 'grind': {
      const { x, z } = B.mortar, y0 = top + 0.024;
      // the powder: coarse lumps that wear down to a fine bed as it's ground
      D.surface(x, z, 0.04, y0 + 0.004 + view.fine * 0.004, [0, 0], product, 0.95, MATTE);
      const lumps = Math.round((1 - view.fine) * 22);
      for (let i = 0; i < lumps; i++) { const a = hash(i, 30) * 6.28 + view.angle * 0.3 * hash(i, 31), d = Math.sqrt(hash(i, 32)) * 0.034, s = 0.003 + hash(i, 33) * 0.004 * (1 - view.fine); D.box(upright([x + Math.cos(a) * d, y0 + 0.004, z + Math.sin(a) * d]), -s, s, 0, s * 1.4, -s, s, product, 0.85 + hash(i, 34) * 0.2, MATTE); }
      // what's flown out of the bowl when it's ground too fast
      const spilt = Math.round(view.spill * 60);
      for (let i = 0; i < spilt; i++) { const a = hash(i, 35) * 6.28, d = 0.075 + hash(i, 36) * 0.06; D.box(upright([x + Math.cos(a) * d, top, z + Math.sin(a) * d]), -0.002, 0.002, 0, 0.0015, -0.002, 0.002, product, 0.9, MATTE); }
      // the pestle: its head circling the bowl at the angle, its handle leaning out past the rim
      const hx = x + Math.cos(view.angle) * 0.022, hz = z + Math.sin(view.angle) * 0.022;
      D.ball([hx, y0 + 0.012, hz], 0.014, '#f0eee8', 1, SATIN, 10);
      D.rod([hx, y0 + 0.012, hz], [x + Math.cos(view.angle) * 0.06, y0 + 0.13, z + Math.sin(view.angle) * 0.06], 0.008, '#f0eee8', 1, SATIN, 8);
      if (view.fast) for (let i = 0; i < 5; i++) { const ph = (t * 3 + hash(i, 37)) % 1, a = view.angle + (hash(i, 38) - 0.5) * 2; D.ball([x + Math.cos(a) * (0.05 + ph * 0.05), y0 + 0.04 + ph * 0.05, z + Math.sin(a) * (0.05 + ph * 0.05)], 0.004 * (1 - ph) + 0.001, product, 1.1, MATTE, 6); }
      return b;
    }
    case 'press': {
      const { x, z } = B.press, y0 = top;
      // the punch, coming down as the force builds; the die is at y0 + 0.05
      const py = y0 + 0.2 - view.force * 0.14;
      D.rod([x, y0 + 0.32, z - 0.01], [x, py, z - 0.01], 0.008, '#c8ccd0', 1.05, METAL, 10);
      D.lathe(upright([x, py - 0.012, z - 0.01]), [[0.012, 0], [0.012, 0.012]], '#9aa0a6', 1.05, 12, METAL);
      // the gauge on the frame: the mark, and the needle
      const gx = x - 0.05, gy = y0 + 0.22, gz = z + 0.012, ang = (v) => -2.2 + v * 4.4;
      D.box(upright([gx, gy, gz]), -0.028, 0.028, -0.028, 0.028, 0, 0.007, '#f4f2ea', 1, MATTE);
      for (const v of [view.mark - view.band, view.mark + view.band]) D.rod([gx, gy, gz + 0.008], [gx + Math.sin(ang(v)) * 0.026, gy + Math.cos(ang(v)) * 0.026, gz + 0.008], 0.0012, '#3ad06a', 1.3, MATTE, 4);
      D.rod([gx, gy, gz + 0.009], [gx + Math.sin(ang(view.force)) * 0.024, gy + Math.cos(ang(view.force)) * 0.024, gz + 0.01], 0.0016, view.force > 1 ? '#ff2a1a' : '#1c1e20', 1, MATTE, 4);
      // the tablets made so far on the tray, a cracked one in two halves
      view.made.forEach((s, i) => {
        const tx = x - 0.045 + i * 0.03, tz = z + 0.055;
        if (s > 0) D.lathe(upright([tx, y0 + 0.05, tz]), [[0, 0], [0.008, 0], [0.008, 0.004], [0, 0.005]], product, 0.9 + s / 1000, 12, SATIN);
        else for (const sx of [-1, 1]) D.box(upright([tx + sx * 0.004, y0 + 0.05, tz]), -0.0035, 0.0035, 0, 0.004, -0.007, 0.007, product, 0.8, SATIN);
      });
      return b;
    }
    case 'separate': {
      const S = B.sep, prof = separatorProfile(S.tap), y0 = S.tap + 0.03, span = 0.15;
      // the two layers: what's left of the bottom one, and the top one on it, by volume up the pear
      const yL = y0 + Math.max(0, view.lower) * span, yU = yL + Math.max(0, view.upper) * span;
      if (yL > y0 + 0.001) W.lathe(upright([S.x, 0, S.z]), profileSlice(prof, S.tap + 0.004, yL), liquid, 0.85, 16, LQ);
      if (yU > yL + 0.001) W.lathe(upright([S.x, 0, S.z]), profileSlice(prof, Math.max(yL, S.tap + 0.004), yU), mixColour([liquid, 1], [[0.9, 0.88, 0.7], 2]), 1.05, 16, LQ);
      // the stopcock's key, turned along the stem when it's open, and what's running out of it
      const a = view.open * (Math.PI / 2);
      D.rod([S.x - Math.cos(a) * 0.02, S.tap - 0.004, S.z - Math.sin(a) * 0.02], [S.x + Math.cos(a) * 0.02, S.tap - 0.004, S.z + Math.sin(a) * 0.02], 0.005, '#e8e4dc', 1, GLOSS, 6);
      if (view.open > 0.05) W.rod([S.x, S.tap - 0.05, S.z], [S.x, B.top + 0.012 + 0.02, S.z], 0.0012 + view.open * 0.0014, view.lower > 0 ? liquid : mixColour([liquid, 1], [[0.9, 0.88, 0.7], 2]), 1.05, LQ, 5);
      const drained = Math.max(0, 0.5 - view.lower);
      liquidIn(D, S.x, S.z, B.top + 0.004, 0.036, 0.004 + drained * 0.09, liquid, [0, 0]);
      return b;
    }
    case 'crystallise': {
      const { x, z } = B.ice, y0 = B.top + 0.018;
      // the solution, going from clear to milky as it's cooled too fast, and its level dropping as it comes out
      W.surface(x, z, 0.055, y0 + 0.012 * (1 - view.grown * 0.8), [0, 0], mixColour([liquid, 1 - view.cloud * 0.7], [[0.92, 0.94, 0.95], view.cloud * 0.7 + 0.001]), 1, LQ);
      // the crystals: a crop that grows with the cooling, fewer and bigger the steadier it went
      const n = Math.round(6 + (1 - view.size) * 26), len = (0.008 + view.size * 0.026) * view.grown;
      for (let i = 0; i < n; i++) {
        const a = hash(i, 50 + view.seed) * 6.28, d = Math.sqrt(hash(i, 51)) * 0.048, cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, l = len * (0.6 + hash(i, 52) * 0.6);
        if (l < 0.0015) continue;
        D.rod([cx, y0, cz], [cx + (hash(i, 53) - 0.5) * l, y0 + l * (0.7 + hash(i, 54) * 0.6), cz + (hash(i, 55) - 0.5) * l], 0.002 + view.size * 0.003, product, 1.2 + (1 - view.cloud) * 0.2, GLOSS, 4);
      }
      // the lever that pushes the dish deeper into the ice
      const lx = x + 0.13, lz = z + 0.06, a = -0.8 + view.cool * 1.6;
      D.box(upright([lx, B.top, lz]), -0.015, 0.015, 0, 0.02, -0.015, 0.015, '#3a3c40', 1, METAL);
      D.rod([lx, B.top + 0.02, lz], [lx + Math.sin(a) * 0.06, B.top + 0.02 + Math.cos(a) * 0.06, lz], 0.004, '#3a6aa8', 1.05, METAL, 6);
      D.ball([lx + Math.sin(a) * 0.06, B.top + 0.02 + Math.cos(a) * 0.06, lz], 0.009, '#1c1e20', 1, SATIN, 8);
      return b;
    }
    case 'filter': {
      const F = B.filt, m = B.top + 0.17, fy = m + 0.066;
      // the cake building on the paper, its cracks if it's run dry, and the slurry standing over it
      const cake = Math.max(0, Math.min(1, view.cake)) * 0.012;
      if (cake > 0.0005) D.lathe(upright([F.x, fy, F.z]), [[0, 0], [0.048, 0], [0.047, cake], [0, cake]], product, 0.95, 18, MATTE);
      for (let i = 0; i < Math.min(6, Math.round(view.crack * 3)); i++) { const a = hash(i, 60) * 6.28; D.rod([F.x, fy + cake + 0.0005, F.z], [F.x + Math.cos(a) * 0.045, fy + cake + 0.0005, F.z + Math.sin(a) * 0.045], 0.0012, '#2a1a10', 1, MATTE, 3); }
      if (view.level > 0.005) W.surface(F.x, F.z, 0.05 + view.level * 0.008, fy + cake + view.level * 0.05, [0, 0], liquid, 0.95, LQ);
      // the filtrate in the flask below
      liquidIn(D, F.x, F.z, B.top + 0.004, 0.052, 0.004 + view.poured * 0.03, mixColour([liquid, 1], [[0.85, 0.9, 0.92], 3]), [0, 0]);
      // the beaker of slurry, tipping over the funnel
      const sl = F.slurry, X = tippedZ([sl.x + 0.03, B.top + 0.2, sl.z], -view.tip * 1.5), base = [-0.03, -0.12, 0];
      D.lathe({ ...X, o: apply(X, base) }, [[0, 0], [0.042, 0], [0.044, 0.1], [0.04, 0.1]], '#b8bcc0', 1, 16, METAL);
      D.lathe({ ...X, o: apply(X, base) }, [[0, 0.004], [0.04, 0.004], [0.04, 0.06 * (1 - view.poured)], [0, 0.06 * (1 - view.poured)]], liquid, 1, 16, GLOSS);
      if (view.tip > 0.25 && view.poured < 1) { const lip = apply(X, [base[0] + 0.044, base[1] + 0.1, 0]); W.rod(lip, [F.x - 0.01, fy + 0.02, F.z], 0.002 + view.tip * 0.004, liquid, 1.05, LQ, 6); }
      return b;
    }
    case 'regulate': case 'leak': case 'collect': {
      const G = B.gas, g = G.gauge, gz = g.z + 0.009, ang = (v) => -2.3 + Math.max(0, Math.min(1.1, v)) * 4.6;
      const pv = stage === 'regulate' ? view.p : 0.6, tv = stage === 'regulate' ? view.target : 0.6, bw = stage === 'regulate' ? view.band : 0.08;
      // the gauge: the green arc it should sit in, the red past which the relief blows, and the needle
      for (let v = tv - bw; v <= tv + bw + 1e-6; v += bw / 3) D.rod([g.x + Math.sin(ang(v)) * 0.022, g.y + Math.cos(ang(v)) * 0.022, gz], [g.x + Math.sin(ang(v)) * 0.03, g.y + Math.cos(ang(v)) * 0.03, gz], 0.002, '#3ad06a', 1.3, MATTE, 4);
      for (let v = 0.95; v <= 1.1; v += 0.05) D.rod([g.x + Math.sin(ang(v)) * 0.022, g.y + Math.cos(ang(v)) * 0.022, gz], [g.x + Math.sin(ang(v)) * 0.03, g.y + Math.cos(ang(v)) * 0.03, gz], 0.002, '#e83a2a', 1.3, MATTE, 4);
      D.rod([g.x, g.y, gz + 0.001], [g.x + Math.sin(ang(pv)) * 0.03, g.y + Math.cos(ang(pv)) * 0.03, gz + 0.002], 0.0016, '#1c1e20', 1, MATTE, 4);
      // the regulator's knob, turned as far as it's set
      const kb = G.bottle, ky = B.top + kb.h + 0.045, ka = (stage === 'regulate' ? view.dial : 0.6) * 4;
      D.rod([kb.x + 0.025, ky, kb.z + 0.005], [kb.x + 0.05, ky, kb.z + 0.005], 0.012, '#1c1e20', 1, SATIN, 10);
      D.rod([kb.x + 0.05, ky, kb.z + 0.005], [kb.x + 0.051, ky + Math.cos(ka) * 0.01, kb.z + 0.005 + Math.sin(ka) * 0.01], 0.002, '#f4f2ea', 1.3, MATTE, 4);
      if (stage === 'regulate' && view.popping) for (let i = 0; i < 8; i++) { const ph = (t * 2 + hash(i, 70)) % 1; D.ball([kb.x - 0.03 - ph * 0.05, ky + ph * 0.05, kb.z + (hash(i, 71) - 0.5) * 0.04], 0.006 * (1 - ph) + 0.002, '#e8eef0', 1.1, MATTE, 6); }
      if (stage === 'leak') {
        // foam where a joint's been brushed; bubbles growing out of the one that leaks; the wrench on the one held
        G.joints.forEach((j, i) => {
          if (view.brushed[i]) for (let k = 0; k < 6; k++) D.ball([j.x + (hash(k, 80 + i) - 0.5) * 0.024, j.y + 0.006 + hash(k, 81 + i) * 0.006, j.z + (hash(k, 82 + i) - 0.5) * 0.016], 0.003 + hash(k, 83) * 0.002, '#f8f8f4', 1.1, MATTE, 5);
          if (view.bubbling === i) for (let k = 0; k < 5; k++) { const ph = (t * 0.9 + k / 5) % 1; D.ball([j.x + (hash(k, 84) - 0.5) * 0.01, j.y + 0.01 + ph * 0.012, j.z + 0.01], 0.002 + ph * 0.007, '#f4fbff', 1.15, GLOSS, 8); }
        });
        if (view.joint >= 0) {
          const j = G.joints[view.joint], wa = view.held ? Math.min(1.2, view.tight) * 1.2 : 0;
          D.rod([j.x, j.y, j.z + 0.01], [j.x + Math.sin(wa) * 0.012, j.y + 0.09 * Math.cos(wa * 0.3), j.z + 0.03 + Math.cos(wa) * 0.01], 0.004, view.stripped ? '#e83a2a' : '#8a8e92', 1.05, METAL, 6);
          D.box(upright([j.x, j.y, j.z + 0.008]), -0.012, 0.012, -0.006, 0.006, 0, 0.004, '#8a8e92', 1.05, METAL);
        }
      }
      if (stage === 'collect') {
        // the gas pushing the water down in the jar, the line to stop at, and the bubbles coming up
        const jr = G.jar, y0 = B.top + 0.012, wl = y0 + (1 - Math.min(1, view.gas)) * jr.h;
        liquidIn(D, jr.x, jr.z, y0, jr.r * 0.92, Math.max(0, wl - y0), '#5a9ac8', [0, 0], 0.95);
        D.lathe(upright([jr.x, y0 + (1 - view.target) * jr.h, jr.z]), [[jr.r * 1.04, -0.0012], [jr.r * 1.04, 0.0012]], '#e83a2a', 1.25, 20, MATTE);
        if (view.flow > 0.005) for (let i = 0; i < 8; i++) { const ph = (t * (1.2 + view.flow * 6) + hash(i, 90)) % 1; D.ball([jr.x + (hash(i, 91) - 0.5) * jr.r, y0 + ph * Math.max(0.01, wl - y0), jr.z + (hash(i, 92) - 0.5) * jr.r], 0.002 + view.flow * 0.02, '#f4fbff', 1.1, GLOSS, 6); }
        // the valve on the regulator's outlet, open as far as it's held
        D.rod([kb.x - 0.03, ky, kb.z + 0.03], [kb.x - 0.03 - Math.sin(view.open * 1.4) * 0.03, ky + Math.cos(view.open * 1.4) * 0.03, kb.z + 0.03], 0.004, '#3a6aa8', 1.05, METAL, 6);
      }
      return b;
    }
    case 'dry': {
      const { x, z } = B.screen, y = B.top + 0.115;
      plateDial(D, { plate: { x, z }, top: B.top }, view.heat);
      // the leaves: green and limp when wet, paler and curled as they dry, brown where they've scorched
      const green = [0.12, 0.32, 0.08], dried = [0.32, 0.36, 0.14], burnt = [0.22, 0.12, 0.04];
      const col = mixColour([green, view.wet], [dried, 1 - view.wet + 0.001], [burnt, view.scorch * 2]);
      for (let i = 0; i < 14; i++) {
        const lx = x + (hash(i, 100) - 0.5) * 0.17, lz = z + (hash(i, 101) - 0.5) * 0.12, a = hash(i, 102) * 6.28, l = 0.018 + hash(i, 103) * 0.012, curl = (1 - view.wet) * 0.006;
        D.box(turnedY([lx, y, lz], a), -l, l, 0, 0.0015 + curl, -l * 0.35, l * 0.35, col, 0.9 + hash(i, 104) * 0.2, SATIN);
      }
      return b;
    }
    case 'cure': {
      const J = B.jar, H = B.hygro;
      // the buds, greener while they're fresh; white fur where it's started to mould
      for (let i = 0; i < 16; i++) { const a = hash(i, 110) * 6.28, d = Math.sqrt(hash(i, 111)) * J.r * 0.75; D.ball([J.x + Math.cos(a) * d, B.top + 0.012 + hash(i, 112) * J.h * 0.55, J.z + Math.sin(a) * d], 0.012 + hash(i, 113) * 0.006, '#4a6a2a', 0.9 + hash(i, 114) * 0.2, MATTE, 8); }
      for (let i = 0; i < Math.round(view.mould * 8); i++) { const a = hash(i, 115) * 6.28; D.ball([J.x + Math.cos(a) * J.r * 0.5, B.top + 0.03 + hash(i, 116) * J.h * 0.4, J.z + Math.sin(a) * J.r * 0.5], 0.006, '#f0f0ea', 1.1, MATTE, 6); }
      // the lid: lifted off while it's burped
      const ly = B.top + J.h + view.open * 0.07;
      D.lathe(upright([J.x + view.open * 0.04, ly, J.z]), [[0, 0], [J.r * 0.86, 0], [J.r * 0.86, 0.018], [0, 0.02]], '#c8a050', 1, 18, METAL);
      // the hygrometer's window and its needle
      const hx = H.x, hy = B.top + 0.05, hz = H.z + 0.009, ang = (v) => -1.3 + v * 2.6;
      for (let v = view.win[0]; v <= view.win[1] + 1e-6; v += (view.win[1] - view.win[0]) / 4) D.rod([hx + Math.sin(ang(v)) * 0.02, hy + Math.cos(ang(v)) * 0.02 - 0.012, hz], [hx + Math.sin(ang(v)) * 0.03, hy + Math.cos(ang(v)) * 0.03 - 0.012, hz], 0.002, '#3ad06a', 1.3, MATTE, 4);
      D.rod([hx, hy - 0.012, hz + 0.001], [hx + Math.sin(ang(view.h)) * 0.03, hy + Math.cos(ang(view.h)) * 0.03 - 0.012, hz + 0.002], 0.0015, view.h > 0.82 ? '#e83a2a' : '#1c1e20', 1, MATTE, 4);
      // the burps so far: a tick for each, green when it was on time
      view.burps.forEach((sc, i) => D.box(upright([hx - 0.03 + i * 0.016, B.top + 0.002, H.z + 0.024]), -0.005, 0.005, 0, 0.004, -0.004, 0.004, sc >= 60 ? '#3ad06a' : '#e83a2a', 1.3, MATTE));
      return b;
    }
    case 'stir': {
      const S = B.stir, y0 = B.top + 0.004, lv = S.h * 0.55, dip = Math.min(0.03, view.speed * 0.003);
      // the liquid, its middle pulled down into a vortex the faster it's stirred
      W.lathe(upright([S.x, y0, S.z]), [[0, 0], [S.r * 0.92, 0], [S.r * 0.92, lv], [S.r * 0.5, lv - dip * 0.3], [S.r * 0.18, lv - dip * 0.85], [0, lv - dip]], liquid, 1, 20, LQ);
      // the rod, its foot circling the bottom and its top leaning out past the rim
      const rx = S.x + Math.cos(view.angle) * S.r * 0.5, rz = S.z + Math.sin(view.angle) * S.r * 0.5;
      D.rod([rx, y0 + 0.008, rz], [S.x + Math.cos(view.angle) * S.r * 1.3, y0 + S.h + 0.1, S.z + Math.sin(view.angle) * S.r * 1.3], 0.0035, '#e8f0f2', 1.1, GLOSS, 6);
      if (view.slop) for (let i = 0; i < 6; i++) { const ph = (t * 2.5 + hash(i, 120)) % 1, a = view.angle + hash(i, 121) * 2; W.ball([S.x + Math.cos(a) * (S.r + ph * 0.05), y0 + S.h + Math.sin(ph * 3) * 0.03, S.z + Math.sin(a) * (S.r + ph * 0.05)], 0.003, liquid, 1.05, LQ, 6); }
      return b;
    }
    case 'rhythm': {
      const Fk = B.flask, cy = B.top + 0.07 + Fk.r;
      // the reaction inside, pulsing brighter on each beat and flaring on a strike
      const pulse = 1 + Math.max(0, view.close - 0.85) * 2.5 + (view.flash ? 0.6 : 0);
      // the reaction is its own light: drawn lit from within, in its colour, brighter on the beat
      const sat = product.map((c) => c / Math.max(1e-3, Math.max(...product)));
      D.lathe(upright([Fk.x, B.top + 0.075, Fk.z]), [[0, 0], [Fk.r * 0.6, 0.008], [Fk.r * 0.88, Fk.r * 0.6], [0, Fk.r * 0.9]], sat, 0.45 + pulse * 0.35, 18, GLOW);
      // the ring closing on the flask: from wide open to the mark, where you strike
      const rr = Fk.r * (1.05 + (1 - Math.min(1, view.close)) * 1.4);
      D.lathe(upright([Fk.x, cy - 0.003, Fk.z]), [[rr, 0], [rr, 0.006]], view.close >= 0.9 && view.close <= 1.1 ? '#6af0a0' : '#f4f2ea', 1.35, 28, MATTE);
      D.lathe(upright([Fk.x, cy - 0.002, Fk.z]), [[Fk.r * 1.05, 0], [Fk.r * 1.05, 0.004]], '#3ad06a', 1.2, 28, MATTE);
      view.hits.forEach((sc, i) => D.box(upright([Fk.x - 0.1 + i * 0.04, B.top, Fk.z + 0.09]), -0.012, 0.012, 0, 0.004, -0.008, 0.008, sc >= 60 ? '#3ad06a' : '#e83a2a', 1.3, MATTE));
      return b;
    }
    default: return b;
  }
}

// ── light ─────────────────────────────────────────────────────────────────────────────────────────────
// A soft halo round a point, for gl/room.js's halo pass (added over the frame, falling off from its middle):
// a ball whose uv.x is how strong it is. `at` is in the piece's frame.
function halo(b, F, at, r, col, k) {
  const c = F.P(...at), nu = 12, nv = 8, R = Array.isArray(r) ? r : [r, r, r];
  const pt = (i, j) => { const a = (i / nu) * Math.PI * 2, e = -Math.PI / 2 + (j / nv) * Math.PI; return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]; };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
    for (const k2 of [0, 1, 2, 0, 2, 3]) { const d = q[k2]; vtx(b, [c[0] + d[0] * R[0], c[1] + d[1] * R[1], c[2] + d[2] * R[2]], d, [k, 0], col, GLOW); }
  }
}

// What lights the bench this frame: `glows` (up to eight { p, c, r } for gl/room.js setGlows, lighting what's
// round them) and halos into `halos` (a batch, for setStageHalos). From a stage's view, as drawStage draws it,
// and from an outcome while one plays (o.outcome, o.age, o.at).
export function lightStage(L, p, stage, view, o = {}, halos = null) {
  const hb = halos || createBatch(256);
  hb.n = 0;
  const g = typeof o.grade === 'number' ? o.grade : gradeOf(o.grade), B = benchOf(p, g), F = frameOf(L, p), t = o.t || 0;
  const glows = [], liquid = rgbOf(o.liquid || '#c83a3a');
  const glowAt = (at, c, r) => glows.push({ p: F.P(...at), c, r });
  const flick = (i) => 0.82 + 0.18 * Math.sin(t * 23 + i * 1.7) * Math.sin(t * 7.3 + i);
  // a hotplate's element: a red glow on what's over it, as hot as it's turned up
  const plate = (x, z, dial) => {
    if (dial <= 0.05) return;
    glowAt([x, B.top + 0.09, z], [1.6 * dial, 0.42 * dial, 0.12 * dial], 0.35);
    halo(hb, F, [x - 0.06, B.top + 0.053, z + 0.096], 0.012, [1, 0.25, 0.08], 0.9);
  };
  // steam: soft wisps rising and spreading from (x, y, z), `k` how much
  const steam = (x, y, z, k, spread = 0.03, n = 9) => {
    for (let i = 0; i < n; i++) {
      const ph = (t * 0.32 + hash(i, 170)) % 1, sw = Math.sin(t * 1.3 + i * 1.7) * 0.02 * ph;
      halo(hb, F, [x + (hash(i, 171) - 0.5) * spread + sw, y + ph * 0.2, z + (hash(i, 172) - 0.5) * spread * 0.6], 0.008 + ph * 0.026, [0.62, 0.66, 0.72], k * 0.1 * Math.sin(ph * Math.PI));
    }
  };
  switch (stage) {
    case 'heat': plate(B.plate.x, B.plate.z, view.dial); if (view.temp > 0.45) steam(B.plate.x, B.plate.y + B.beaker.h, B.plate.z, Math.min(1, (view.temp - 0.45) * 2.5)); break;
    case 'evaporate': plate(B.plate.x, B.plate.z, view.boiling ? 0.7 : 0); if (view.boiling) steam(B.plate.x, B.plate.y + B.dish.h, B.plate.z, 1, 0.08, 12); break;
    case 'dry': plate(B.screen.x, B.screen.z, view.heat); if (view.heat > 0.25) steam(B.screen.x, B.top + 0.12, B.screen.z, Math.min(1, view.heat * 1.4) * view.wet, 0.16, 10); break;
    case 'reflux': {
      const R = B.reflux;
      // the vapour that gets past the top of the condenser when the water can't keep up
      if (view.ring >= 0.95) steam(R.x, R.cy1 + 0.02, R.z, 1, 0.02, 10);
      if (g === 0) { glowAt([R.x, B.top + 0.08, R.z], [0.35 * flick(1), 0.55 * flick(1), 1.4 * flick(1)], 0.45); halo(hb, F, [R.x, B.top + 0.075, R.z], 0.02, [0.3, 0.6, 1], 0.9); }
      else { glowAt([R.x, R.seat, R.z], [1.2, 0.35, 0.1], 0.4); halo(hb, F, [R.x - 0.012, B.top + 0.036, R.z + 0.091], 0.01, [1, 0.35, 0.1], 0.9); }
      break;
    }
    case 'weigh': halo(hb, F, [B.scale.x, B.top + 0.026, B.scale.z + 0.082], 0.035, [0.2, 1, 0.5], 0.35); break;
    case 'filter': halo(hb, F, [B.filt.x + 0.207, B.top + 0.055, B.filt.z - 0.02], 0.012, [0.2, 1, 0.5], 0.8); break;
    case 'rhythm': {
      // the reaction lights the bench in its own colour, hardest on the beat
      const Fk = B.flask, beat = Math.max(0, view.close - 0.8) * 3 + (view.flash ? 1.2 : 0);
      const k = 0.4 + beat, prod = rgbOf(o.product || "#f0f0ea"), sat = prod.map((c) => c / Math.max(1e-3, Math.max(...prod)));
      glowAt([Fk.x, B.top + 0.1, Fk.z + 0.16], sat.map((c) => c * 0.9 * k), 0.75);
      halo(hb, F, [Fk.x, B.top + 0.07 + Fk.r * 0.8, Fk.z], Fk.r * 1.25, sat.map((c) => c * 0.8), 0.1 + beat * 0.22);
      break;
    }
    case 'crystallise': halo(hb, F, [B.ice.x, B.top + 0.03, B.ice.z], 0.07, [0.6, 0.85, 1], 0.12); break;
    case 'regulate': if (view.popping) glowAt([B.gas.gauge.x, B.gas.gauge.y, B.gas.gauge.z + 0.05], [1.4, 0.2, 0.1], 0.5); break;
    default: break;
  }
  for (let i = 0; i < 16; i++) {
    const mx = B.xo - 0.5 + hash(i, 180) * 1.1 + Math.sin(t * 0.13 + i) * 0.05, my = B.top + 0.1 + ((hash(i, 181) + t * 0.008 * (0.5 + hash(i, 182))) % 1) * 0.8, mz = B.hd * 0.2 + hash(i, 183) * 0.6 + Math.cos(t * 0.11 + i * 2) * 0.04;
    halo(hb, F, [mx, my, mz], 0.0025 + hash(i, 184) * 0.002, [1, 0.92, 0.78], 0.35 * (0.6 + 0.4 * Math.sin(t * 0.7 + i * 3)));
  }
  // an outcome's light: fire floods the room orange and flickers, a flash whites it out, fumes tint it green
  if (o.outcome && o.at) {
    const [x, z] = o.at, a = o.age || 0, y = B.top + 0.12;
    if (o.outcome === 'fire' || o.outcome === 'flash' || (o.outcome === 'burst' && a < 0.5)) {
      const k = o.outcome === 'burst' ? 2 * (1 - a / 0.5) : Math.max(0.3, 1.3 - a * 0.25);
      for (let i = 0; i < 3; i++) glowAt([x + (i - 1) * 0.08, y + 0.05 * i, z + 0.05], [2.4 * k * flick(i), 0.85 * k * flick(i + 3), 0.18 * k], 1.5);
      for (let i = 0; i < 22; i++) {
        const ph = (a * (0.9 + hash(i, 165) * 0.8) + hash(i, 166)) % 1, w = (0.02 + hash(i, 167) * 0.025) * (1 - ph * 0.6) * Math.min(1.4, k);
        halo(hb, F, [x + (hash(i, 160) - 0.5) * 0.16 + Math.sin(a * 7 + i) * 0.01, y - 0.03 + ph * 0.3, z + (hash(i, 161) - 0.5) * 0.08], [w, w * 2.6, w], ph < 0.35 ? [1, 0.85, 0.5] : [1, 0.42, 0.08], 0.55 * (1 - ph) * Math.min(1, k));
      }
    }
    if (o.outcome === 'flash' && a < 0.6) glowAt([x, y + 0.2, z + 0.2], [6 * (1 - a / 0.6), 6 * (1 - a / 0.6), 5.5 * (1 - a / 0.6)], 4);
    if (o.outcome === 'fumes') { glowAt([x, y + 0.2, z + 0.1], [0.5, 1.1, 0.2], 1.8); for (let i = 0; i < 6; i++) halo(hb, F, [x + (hash(i, 163) - 0.5) * 0.4, y + 0.1 + hash(i, 164) * 0.3, z + 0.1], 0.15 + Math.min(1, a * 0.4) * 0.2, [0.4, 1, 0.2], 0.25); }
    if (o.outcome === 'ok') halo(hb, F, [x, B.top + 0.05, z], 0.06, [0.5, 1, 0.7], Math.max(0, 0.6 - a * 0.2));
  }
  return { glows, halos: hb };
}

// What happened when the server came back (plugins/synthesis `chem_outcome`), drawn at (x, z) on the
// bench at `age` seconds: a flash fire, glass bursting, a flood of fumes, a white flash, or a batch gone
// to cloudy waste. Into `out`, after the stage's own pieces.
export function drawOutcome(L, p, kind, at, age, o = {}, out) {
  const b = out, g = typeof o.grade === 'number' ? o.grade : gradeOf(o.grade), B = benchOf(p, g), D = pen(b, frameOf(L, p));
  const [x, z] = at, y = B.top + 0.06, product = rgbOf(o.product || '#f0f0ea');
  const fire = (k) => {
    for (let i = 0; i < 8; i++) {
      const ph = (age * (1.1 + hash(i, 130)) + hash(i, 131)) % 1, sp = 0.03 + hash(i, 132) * 0.05, r = (0.006 + hash(i, 135) * 0.006) * k * (1 - ph * 0.7);
      const o = [x + (hash(i, 133) - 0.5) * sp * 2 + Math.sin(age * 9 + i) * 0.006, y - 0.04 + ph * (0.22 + k * 0.12), z + (hash(i, 134) - 0.5) * sp];
      D.lathe(upright(o), [[0, 0], [r, r * 0.8], [r * 0.55, r * 2.2], [0, r * 3.4]], ph < 0.3 ? '#fff4c0' : ph < 0.65 ? '#ffa030' : '#d8401a', 1.6, 7, GLOW);
    }
  };
  const shards = (n) => { for (let i = 0; i < n; i++) { const a = hash(i, 140) * 6.28, v = 0.4 + hash(i, 141) * 0.8, up = 0.6 + hash(i, 142) * 1.2, tt = Math.min(age, 1.2); const px = x + Math.cos(a) * v * tt, pz = z + Math.sin(a) * v * tt, py = Math.max(B.top, y + up * tt - 4.9 * tt * tt); const sz = 0.004 + hash(i, 143) * 0.008; D.box(turnedY([px, py, pz], a + age * 6), -sz, sz, 0, 0.0015, -sz * 0.6, sz * 0.6, '#e8f4f8', 1.25, GLOSS); } };
  switch (kind) {
    case 'fire': fire(1); break;
    case 'burst': shards(40); if (age < 0.6) fire(0.5); break;
    case 'flash': shards(30); fire(1.4); break;
    case 'fumes': for (let i = 0; i < 40; i++) { const ph = Math.min(1, age * 0.5 + hash(i, 150) * 0.3), a = hash(i, 151) * 6.28, d = ph * (0.15 + hash(i, 152) * 0.5); D.ball([x + Math.cos(a) * d, y + ph * (0.1 + hash(i, 153) * 0.5), z + Math.sin(a) * d * 0.6 + ph * 0.2], 0.02 + ph * 0.07, '#8ac83a', 0.8 + hash(i, 154) * 0.3, MATTE, 8); } break;
    case 'spoiled': D.lathe(upright([x, B.top + 0.005, z]), [[0, 0], [0.05, 0], [0.04, 0.012], [0, 0.016]], '#9a9890', 0.9, 16, MATTE); break;
    case 'ok': D.lathe(upright([x, B.top + 0.005, z]), [[0, 0], [0.012, 0], [0.012, 0.06], [0.006, 0.07], [0.006, 0.08], [0, 0.08]], product, 1.1 + Math.max(0, 0.5 - age) * 0.6, 14, GLOSS); break;
    default: break;
  }
  return b;
}
