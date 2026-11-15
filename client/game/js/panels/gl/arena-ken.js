// Rinkside · Ken Raven at the Zamboni's wheel, as the close-up figure.
//
// He's the Room Stage's person (gl/figure-hd.js, built by gl/room-people.js figurePeople), not the
// arena's own box-and-tube men: a body with muscles under separate clothes, hair cards and an inked
// face, drawn in the comic manner. figurePeople poses him in a room's frame (metres, Y up); here that
// frame is carried onto the machine's seat, and the picture's view matrix is scaled so the figure's
// shader works in metres while the arena works in feet.
//
// He drives with both hands on the wheel (actor3d.js sitDrive), and for three seconds in every
// thirty-nine he eases his left hand off it and waves to the stands (sitDriveWave, rink/livery.js
// kenWave). Glasses aren't in the figure's kit, so their frames are built on his head bone into the
// arena's own batch.
//
// His look is his NPC's flags.figure (content/npcs/npc_slush_raven.json), copied here because the
// broadcast has no NPC rows; change both.

import { figurePeople } from './room-people.js';
import { createFigureLayer } from './figure-hd.js';
import { HOUSE } from './house-style.js';
import { kenWave } from '../rink/livery.js';
import { actorSkinAt } from '../actor3d.js';
import { FIGURE_BONE, buildFigure, figureKey } from '../figure.js';

const FT = 3.2808;
export const KEN_FIGURE = {
  head: 0, build: 'average', weight: 0.6, cut: 'hoodie', gear: false, hair_style: 4, facial: 'trimmed', age: 0.15,
  brow: 1.05, mouth: 1.05, beard: 1.4, smile: 1, layout: 0,
  skin: [228, 164, 128], hair: [96, 62, 38], iris: [96, 128, 104], top: [112, 116, 122], legs: [54, 72, 104], shoes: [36, 36, 40], shirt: [24, 30, 46], trim: [210, 210, 210],
  fabric_top: 'knit', fabric_legs: 'denim', fabric_shoes: 'canvas',
};
const BODY = { id: 'npc_slush_raven', pose: 'sit', sculpt: true, sex: 'male', figure: KEN_FIGURE, gaze: [0, 0], at: [0, 0], yaw: 0 };
// Where his figure's origin sits on the machine, in the machine's frame (feet: u forward, v left, w up):
// the deck under his seat, which is where figurePeople puts the soles of his boots.
export const KEN_SEAT = { u: -3.25, v: 1.5, w: 2.7 };
const L = { world: () => [0, 0, 0] };

// The seat and wheel in the machine's frame, off the sitDrive pose: the wheel's hub between his hands, the
// seat's top under his hips. { hub: [u, v, w], seat: w }, feet.
let rigAt = null;
export function kenRig() {
  if (rigAt) return rigAt;
  const S = actorSkinAt('sitDrive', 0);
  // a bone's joint where the pose puts it: its skin matrix applied to the bind joint
  const J = (name, p) => { const m = S[FIGURE_BONE[name]]; return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]); };
  const hl = J('handL', [0.195, 0.83, -0.01]), hr = J('handR', [-0.195, 0.83, -0.01]), hip = J('pelvis', [0, 0.95, 0]);
  // figurePeople stands the soles on the deck: the lowest of the two ankles, less the foot
  const sole = Math.min(J('footL', [0.095, 0.08, 0])[1], J('footR', [-0.095, 0.08, 0])[1]) - 0.08;
  const mid = [(hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2 - sole, (hl[2] + hr[2]) / 2 + 0.05];
  rigAt = { hub: [KEN_SEAT.u + mid[2] * FT, KEN_SEAT.v + mid[0] * FT, KEN_SEAT.w + mid[1] * FT], seat: KEN_SEAT.w + (hip[1] - sole - 0.1) * FT };
  return rigAt;
}

// His Highlanders scarf: wrapped twice round the neck and knotted at the front left, the two ends hanging
// down his chest into his lap. The wrap rides the neck and chest as his collar does; the ends are cloth, a
// Verlet chain each (metres, on the ice's frame), under gravity and the air's drag, held to their length,
// pushed out of his chest, belly and thighs. So they swing when the machine turns or brakes, stream back
// on the straights, and fall on his knees. In the Highlanders' green-and-navy tartan, as his NPC
// description has it.
//
// Both are sized off his own mesh (scarfFit), not typed in: the wrap's turns rest on the hoodie, its
// collar, the hood down behind his neck and his neck, at every angle round it, and the ends hit spheres
// laid along the front of the sweater and round his trousers. Change his cut and the scarf still sits on it.
const SCARF = {
  seg: 0.05, w: 0.12, damp: 0.985, drag: 0.5, flutter: 0.35, n: [13, 11],
  // the two turns: the height each sits at, how far up the shoulders' slope it may ride, the roll's thickness
  turns: [{ y: 1.47, lift: 0.01, th: 0.032 }, { y: 1.43, lift: 0.03, th: 0.036 }],
  gap: 0.005, // the cloth's clearance over what it lies on
  green: '#1f5a36', green2: '#2c7046', navy: '#1b2744', red: '#a3262c',
};
const NA = 28, NB = 8;
const atBone = (R, bone, p) => { const o = (typeof bone === 'number' ? bone : FIGURE_BONE[bone]) * 12; return [0, 1, 2].map((i) => R[o + i * 4] * p[0] + R[o + i * 4 + 1] * p[1] + R[o + i * 4 + 2] * p[2] + R[o + i * 4 + 3]); };
// a bind point carried as the collar is (figure.js TORSO_CHAIN): the neck above, the chest below
const neckK = (y) => { const t = Math.max(0, Math.min(1, (y - 1.405) / 0.05)); return t * t * (3 - 2 * t); };
const atNeck = (R, p) => {
  const k = neckK(p[1]), a = atBone(R, 'neck', p);
  if (k >= 1) return a;
  const b = atBone(R, 'chest', p);
  return [0, 1, 2].map((i) => a[i] * k + b[i] * (1 - k));
};

// What the scarf lies on, measured once off his built figure (figure.js buildFigure, bind space, metres).
// `turns[j].c[i]` is turn j's centre line at angle i of NA (0 is his front, a quarter on is his left), as
// [x, y, z]; `knot` and `roots` are where the ends come out; `hit` is [bind point, radius, bone] for the
// ends to stay out of. Exported for the check that nothing of the wrap is inside him.
export function scarfFit(F) {
  const pick = (names, keep = () => true) => {
    const out = [];
    for (const p of F.parts) if (names.includes(p.name)) for (let v = p.v0; v < p.v0 + p.nv; v++) {
      const q = [F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]];
      if (!keep(q)) continue;
      let bb = F.B[v * 4], bw = F.W[v * 4];
      for (let k = 1; k < 4; k++) if (F.W[v * 4 + k] > bw) { bw = F.W[v * 4 + k]; bb = F.B[v * 4 + k]; }
      out.push([...q, bb]);
    }
    return out;
  };
  // the neck's centre, off the collar (or the top's neckline, a cut without one)
  const ring = pick(['collar']), neck = ring.length ? ring : pick(['top'], (q) => q[1] > 1.43);
  const cz = (Math.max(...neck.map((q) => q[2])) + Math.min(...neck.map((q) => q[2]))) / 2;
  // round the neck, by angle: everything the wrap could touch (the strings go under it)
  const NBIN = 56, bins = Array.from({ length: NBIN }, () => []);
  const angBin = (x, z) => ((Math.round(Math.atan2(x, z - cz) / (2 * Math.PI) * NBIN) % NBIN) + NBIN) % NBIN;
  for (const q of pick(['top', 'collar', 'hood', 'torso', 'head'], (q) => q[1] > 1.3 && q[1] < 1.53)) bins[angBin(q[0], q[2])].push([q[1], Math.hypot(q[0], q[2] - cz)]);
  const turns = SCARF.turns.map((T) => {
    const h = T.th * 0.85;
    // the least centre radius at angle bin b with the roll's centre at height y, so its round section
    // clears every point under it by the gap
    const need = (b, y) => {
      let r = 0;
      for (let d = -1; d <= 1; d++) for (const [py, pr] of bins[(b + d + NBIN) % NBIN]) {
        const u = (py - y) / h;
        if (u > -1 && u < 1) r = Math.max(r, pr + SCARF.gap + T.th * Math.sqrt(1 - u * u));
      }
      return r;
    };
    const binOf = (i) => Math.round((i / NA) * NBIN) % NBIN;
    // each angle rides as far up the slope as it pays to: a centimetre higher for every one it comes in
    let R = [], Y = [];
    for (let i = 0; i < NA; i++) {
      let best = null;
      for (let l = 0; l <= T.lift + 1e-9; l += 0.0025) {
        const r = need(binOf(i), T.y + l), cost = r + l;
        if (!best || cost < best[0]) best = [cost, r, T.y + l];
      }
      R.push(best[1]); Y.push(best[2]);
    }
    // smoothed round the ring, so it reads as one roll, never smaller than it has to be
    for (let pass = 0; pass < 3; pass++) {
      const sm = (A) => A.map((_, i) => (A[(i + NA - 1) % NA] + 2 * A[i] + A[(i + 1) % NA]) / 4);
      Y = sm(Y); R = sm(R).map((r, i) => Math.max(r, need(binOf(i), Y[i])));
    }
    const c = R.map((r, i) => { const a = (i / NA) * Math.PI * 2; return [Math.sin(a) * r, Y[i], cz + Math.cos(a) * r]; });
    return { c, th: T.th, h };
  });
  // the knot sits on the lower turn at his front left, and the ends come out under it
  const L = turns[1], out = (i, k) => { const a = (i / NA) * Math.PI * 2, P = L.c[i]; return [P[0] + Math.sin(a) * k, P[1], P[2] + Math.cos(a) * k]; };
  const knot = [out(0, L.th * 0.6), out(1, L.th * 0.6)];
  const roots = [[knot[0][0] + 0.004, knot[0][1] - 0.02, knot[0][2] + 0.01], [knot[1][0] + 0.004, knot[1][1] - 0.025, knot[1][2] + 0.008]];
  // down the front of the sweater (and its strings): a ball every 3 cm, touching the cloth's front
  // where the ends hang, on the bone that carries the cloth there
  const hit = [], front = pick(['top', 'strings', 'collar'], (q) => Math.abs(q[0]) < 0.07 && q[2] > cz);
  const RB = 0.16;
  for (let y = 1.45; y > 0.94; y -= 0.03) {
    const band = front.filter((q) => Math.abs(q[1] - y) < 0.014);
    if (!band.length) continue;
    const zf = Math.max(...band.map((q) => q[2])), bones = {};
    for (const q of band) bones[q[3]] = (bones[q[3]] || 0) + 1;
    const bone = +Object.entries(bones).sort((a, b) => b[1] - a[1])[0][0];
    hit.push([[0, y, zf - RB], RB, bone]);
  }
  // round each thigh, off the trousers and the sweater's hem over them
  for (const s of [1, -1]) {
    const tb = FIGURE_BONE[s > 0 ? 'thighL' : 'thighR'];
    const leg = pick([s > 0 ? 'trouserL' : 'trouserR'], (q) => q[1] > 0.5 && q[1] < 0.9);
    for (let y = 0.86; y > 0.52; y -= 0.06) {
      const band = leg.filter((q) => Math.abs(q[1] - y) < 0.02);
      if (!band.length) continue;
      const cx = band.reduce((a, q) => a + q[0], 0) / band.length, czl = band.reduce((a, q) => a + q[2], 0) / band.length;
      hit.push([[cx, y, czl], Math.max(...band.map((q) => Math.hypot(q[0] - cx, q[2] - czl))), tb]);
    }
  }
  return { cz, turns, knot, roots, hit };
}
const axisOf = (R, bone, k) => { const o = FIGURE_BONE[bone] * 12; return [R[o + k], R[o + 4 + k], R[o + 8 + k]]; };
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function createScarf() {
  let ends = null, last = null, fit = null;
  function reset(R) {
    ends = fit.roots.map((at, k) => {
      const n = SCARF.n[k], r = atNeck(R, at), p = [];
      for (let i = 0; i <= n; i++) p.push([r[0], r[1], r[2] - i * SCARF.seg]);
      return { at, n, p, q: p.map((x) => x.slice()) };
    });
  }
  function step(R, dt, t) {
    const g = -9.8, hits = fit.hit.map(([p, r, b]) => [atBone(R, b, p), r]);
    for (const E of ends) {
      const { p, q } = E, root = atNeck(R, E.at);
      for (let i = 1; i < p.length; i++) {
        const P = p[i], Q = q[i], k = i / p.length;
        // the air: drag toward still air, and a little flutter that grows to the end
        const fl = SCARF.flutter * k * Math.sin(t * 9 + i * 0.9 + E.n), fx = fl * 0.6, fy = fl * Math.cos(t * 7 + i);
        for (let c = 0; c < 3; c++) {
          const v = (P[c] - Q[c]) * SCARF.damp, a = (c === 2 ? g : c === 0 ? fx : fy) - SCARF.drag * v / Math.max(dt, 1e-4);
          Q[c] = P[c]; P[c] += v + a * dt * dt;
        }
      }
      for (let it = 0; it < 6; it++) {
        p[0] = root.slice(); q[0] = root.slice();
        for (let i = 1; i < p.length; i++) {
          const A = p[i - 1], B = p[i], d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(d[0], d[1], d[2]) || 1e-6, f = (l - SCARF.seg) / l;
          if (i === 1) { for (let c = 0; c < 3; c++) B[c] -= d[c] * f; }
          else for (let c = 0; c < 3; c++) { A[c] += d[c] * f * 0.5; B[c] -= d[c] * f * 0.5; }
        }
        for (let i = 1; i < p.length; i++) for (const [C, r] of hits) {
          const P = p[i], d = [P[0] - C[0], P[1] - C[1], P[2] - C[2]], l = Math.hypot(d[0], d[1], d[2]), rr = r + 0.012;
          if (l < rr && l > 1e-6) for (let c = 0; c < 3; c++) P[c] = C[c] + d[c] / l * rr;
        }
      }
    }
  }
  return {
    // fit it to the figure he's built as (scarfFit); a new key fits it again
    fit(key, built) { if (!fit || fit.key !== key) { fit = { ...scarfFit(built()), key }; ends = null; } },
    update(R, t) {
      if (!fit) return;
      const dt = last === null ? -1 : t - last;
      last = t;
      if (!ends || dt < 0 || dt > 0.5) { reset(R); for (let k = 0; k < 90; k++) step(R, 1 / 60, t); return; }
      const n = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))));
      for (let k = 0; k < n; k++) step(R, dt / n, t);
      // thrown above the knot (a cut, a replay starting), it settles again from hanging
      const knot = atNeck(R, fit.roots[0])[2];
      if (ends.some((E) => E.p.some((P) => P[2] > knot + 0.12 || !Number.isFinite(P[2])))) { reset(R); for (let k = 0; k < 90; k++) step(R, 1 / 60, t); }
    },
    // into an arena batch, in feet
    build(R, b, quad, tube, rgb) {
      if (!ends) return;
      const F = (p) => [p[0] * FT, p[1] * FT, p[2] * FT];
      const G = rgb(SCARF.green), G2 = rgb(SCARF.green2), N = rgb(SCARF.navy), Rd = rgb(SCARF.red);
      // the wrap: two thick turns round the neck, over the collar and the hood, green with a navy band
      // (each a roll round its fitted centre line, one continuous surface, so it reads as cloth)
      for (const T of fit.turns) {
        const at = (i, k) => {
          const a = (i / NA) * Math.PI * 2, c = (k / NB) * Math.PI * 2, C = T.c[i % NA], r = T.th * Math.cos(c);
          return F(atNeck(R, [C[0] + Math.sin(a) * r, C[1] + T.h * Math.sin(c), C[2] + Math.cos(a) * r]));
        };
        for (let i = 0; i < NA; i++) for (let k = 0; k < NB; k++) quad(b, at(i, k), at(i + 1, k), at(i + 1, k + 1), at(i, k + 1), i % 9 < 2 ? N : (i % 9 === 5 ? G2 : G));
      }
      // the knot, where the ends come out at the front left
      tube(b, F(atNeck(R, fit.knot[0])), F(atNeck(R, fit.knot[1])), 0.045 * FT, 0.04 * FT, G2, 8);
      // the ends: one strip each, sides shared between segments so it reads as one piece of cloth;
      // three bands across, checked green and navy, a red line through every sixth row, fringed
      const fwd = nrm(axisOf(R, 'chest', 2)), lft = nrm(axisOf(R, 'chest', 0)), w = SCARF.w / 2;
      for (const { p } of ends) {
        // across the cloth at each node: his shoulders' line, square to the cloth there, so it never flips
        const side = p.map((_, i) => {
          const A = p[Math.max(0, i - 1)], B = p[Math.min(p.length - 1, i + 1)], dir = nrm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
          const dl = lft[0] * dir[0] + lft[1] * dir[1] + lft[2] * dir[2];
          const sd = [lft[0] - dir[0] * dl, lft[1] - dir[1] * dl, lft[2] - dir[2] * dl];
          return nrm(Math.hypot(...sd) < 0.2 ? crs(dir, fwd) : sd);
        });
        const at = (i, s) => F([p[i][0] + side[i][0] * s, p[i][1] + side[i][1] * s, p[i][2] + side[i][2] * s]);
        for (let i = 0; i < p.length - 1; i++) for (let j = 0; j < 3; j++) {
          const s0 = -w + (2 * w * j) / 3, s1 = -w + (2 * w * (j + 1)) / 3;
          const col = i % 6 === 5 && j === 1 ? Rd : (Math.floor(i / 3) + (j === 1 ? 1 : 0)) % 2 ? N : (j === 1 ? G2 : G);
          quad(b, at(i, s0), at(i, s1), at(i + 1, s1), at(i + 1, s0), col);
        }
        const n = p.length - 1, A = p[n - 1], B = p[n], dir = nrm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
        for (let f = 0; f < 6; f++) {
          const s = -w + (2 * w * (f + 0.5)) / 6, o = [B[0] + side[n][0] * s, B[1] + side[n][1] * s, B[2] + side[n][2] * s];
          tube(b, F(o), F([o[0] + dir[0] * 0.04, o[1] + dir[1] * 0.04, o[2] + dir[2] * 0.04]), 0.005 * FT, 0.004 * FT, f % 2 ? N : G, 4);
        }
      }
    },
  };
}

export function createArenaKen(gl) {
  const fig = createFigureLayer(gl), scarf = createScarf();
  let rec = null;
  return {
    scarf(b, quad, tube, rgb) { if (rec) scarf.build(rec.rows, b, quad, tube, rgb); },
    // pose him for this frame on the machine `z` ({ x, y, h }, feet); returns his record, or null
    pose(z, t) {
      const wv = kenWave(t, z);
      const body = { ...BODY, clip: 'sitDrive', phase: t / 6, mix: wv > 0 ? { a: 'sitDrive', pa: t / 6, b: 'sitDriveWave', pb: t / 1.6, k: wv } : null };
      const r = figurePeople(L, [body], t, { level: 'hd' })[0];
      if (!r) { rec = null; return null; }
      const ch = Math.cos(z.h), sn = Math.sin(z.h);
      // room x (his left) → machine v, room y (up) → w, room z (ahead) → u; then onto the ice, in metres
      const A = [[-sn, 0, ch], [ch, 0, sn], [0, 1, 0]];
      const T = [(z.x + KEN_SEAT.u * ch - KEN_SEAT.v * sn) / FT, (z.y + KEN_SEAT.u * sn + KEN_SEAT.v * ch) / FT, KEN_SEAT.w / FT];
      const src = r.rows, out = new Float32Array(src.length);
      for (let b = 0; b < src.length / 12; b++) for (let i = 0; i < 3; i++) for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += A[i][k] * src[b * 12 + k * 4 + c];
        out[b * 12 + i * 4 + c] = s + (c === 3 ? T[i] : 0);
      }
      rec = { ...r, rows: out };
      scarf.fit(figureKey(r.key), () => buildFigure(r.key));
      scarf.update(out, t);
      return rec;
    },
    // his glasses, in feet, into a batch of the arena's (gl/arena-mesh.js builders `box`, `tube`)
    glasses(b, box, tube, rgb) {
      if (!rec) return;
      const R = rec.rows, o = FIGURE_BONE.head * 12;
      const P = (x, y, zz) => [0, 1, 2].map((i) => (R[o + i * 4] * x + R[o + i * 4 + 1] * y + R[o + i * 4 + 2] * zz + R[o + i * 4 + 3]) * FT);
      const k = rgb('#111214'), r = 0.0036 * FT;
      const ring = (cx) => {
        const x0 = cx - 0.024, x1 = cx + 0.024, y0 = 1.624, y1 = 1.656, zz = 0.093;
        tube(b, P(x0, y1, zz), P(x1, y1, zz), r * 1.3, r * 1.3, k, 5);
        tube(b, P(x0, y0, zz), P(x1, y0, zz), r, r, k, 5);
        tube(b, P(x0, y0, zz), P(x0, y1, zz), r, r, k, 5);
        tube(b, P(x1, y0, zz), P(x1, y1, zz), r, r, k, 5);
      };
      ring(0.032); ring(-0.032);
      tube(b, P(-0.008, 1.648, 0.096), P(0.008, 1.648, 0.096), r, r, k, 5);
      for (const s of [-1, 1]) tube(b, P(s * 0.056, 1.652, 0.09), P(s * 0.078, 1.645, -0.01), r, r, k, 5);
    },
    // draw him: `vp` the picture's (feet), `eye` the camera (feet), `w`×`h` the canvas
    draw(vp, eye, w, h) {
      if (!rec) return;
      const vpM = new Float32Array(vp);
      for (let i = 0; i < 12; i++) vpM[i] *= FT;
      const eyeM = eye.map((v) => v / FT), recs = [rec], kpx = h / 900;
      fig.ink(vpM, recs, (P) => {
        gl.uniform2f(P.u('uRes'), w, h);
        gl.uniform4f(P.u('uInk'), 0.01, HOUSE.px[0] * kpx, HOUSE.px[1] * kpx, 0);
        gl.uniform3fv(P.u('uEyeI'), eyeM);
        gl.uniform1f(P.u('uBack'), 0.02);
        gl.uniform3fv(P.u('uCol'), HOUSE.ink);
        gl.uniform3f(P.u('uKey'), 0, 0, 1);
        gl.uniform1f(P.u('uWeigh'), HOUSE.weigh);
      });
      // the barn's lights: a bank high over him and a little ahead, and the bowl's spill all round
      const hd = [rec.rows[FIGURE_BONE.head * 12 + 3], rec.rows[FIGURE_BONE.head * 12 + 7], rec.rows[FIGURE_BONE.head * 12 + 11]];
      const lamps = new Float32Array(18); lamps.set([hd[0] + 1.5, hd[1] - 2.5, hd[2] + 4], 0);
      const lampK = new Float32Array(6); lampK[0] = 1;
      fig.draw(vpM, recs, (P) => {
        gl.uniform3fv(P.u('uEye'), eyeM);
        gl.uniform3fv(P.u('uLampP'), lamps); gl.uniform1fv(P.u('uLampK'), lampK); gl.uniform1i(P.u('uLampN'), 1);
        gl.uniform3f(P.u('uLampC'), 2.4, 2.3, 2.15);
        gl.uniform1i(P.u('uWinCount'), 0); gl.uniform1fv(P.u('uWinK'), new Float32Array(3));
        gl.uniform4f(P.u('uAnnex'), 0, 0, 0, 0);
        gl.uniform1f(P.u('uOutZ'), 1e6); gl.uniform3f(P.u('uOutRing'), -1e6, 1e6, -1e6);
        gl.uniform3f(P.u('uWinC'), 0, 0, 0);
        gl.uniform3f(P.u('uAmb'), 0.3, 0.31, 0.34);
        gl.uniform1f(P.u('uExpo'), 1.15);
        gl.uniform1f(P.u('uComic'), 1);
        gl.uniform2f(P.u('uRes'), w, h);
      });
    },
    dispose() { try { fig.dispose(); } catch { /* the context may be gone */ } },
  };
}
