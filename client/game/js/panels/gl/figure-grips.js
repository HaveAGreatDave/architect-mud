// THE CLOSE-UP FIGURE'S GRIPS. How a hand holds each small thing, worked out against the thing itself: where it sits
// in the hand (a frame in the hand's bind space), what shape it is (a distance field), and the hand's pose round it.
// A wrapped grip (a bottle, a phone, a mug's body) is found by closing the fingers on it the way a real hand does:
// every finger's three hinges fold together, and as each bone of it meets the surface the hinges behind that bone
// stop while the ones past it go on, so a finger wraps an edge rather than stopping straight at it. A precise grip (a
// pen, a fork held like one, a note) sets the fingers by hand and puts the thing where those fingers actually are,
// so it sits in them and not in the air beside them. Both read the fingers through bendPoint (gl/figure-hands.js),
// which bends a point as gl/figure-hd.js's shader does, so what's worked out here is what's drawn.
//
// Every grip is worked out once for each side and hand scale and kept. gl/figure-reach.js poses the hand with it,
// and gl/room-held.js draws the thing on the hand's bone in the frame it gives.
//
// The hand's frame, as gl/figure-reach.js has it: `a` across toward the palm's side, `d` down the fingers, `f`
// forward toward the thumb, from the wrist, in metres of a hand of scale 1.

import { fingerTipsOf, fingerJointsOf, thumbJointsOf } from '../figure.js';
import { bendPoint, POSE_FINGER, POSE_THUMB, POSE_LEN } from './figure-hands.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const WRIST = (s) => [s * 0.195, 0.868, -0.004];
// a point in the hand's frame as bind space, for side s and a hand scaled by k about the wrist
export const handAt = (s, [a, d, f], k = 1) => { const W = WRIST(s); return [W[0] - s * k * a, W[1] - k * d, W[2] + k * f]; };
// a way in the hand's frame as bind space
export const handDir = (s, [a, d, f]) => unit([-s * a, -d, f]);
// A frame from its origin and two ways, squared up, its third way X × Y, so the thing it carries isn't mirrored
// in the left hand.
export function frameOf(o, X, Y) {
  const x = unit(X), y = unit(sub(Y, mul(x, dot(Y, x))));
  return { o, X: x, Y: y, Z: cross(x, y) };
}
const toLocal = (F, p) => { const d = sub(p, F.o); return [dot(d, F.X), dot(d, F.Y), dot(d, F.Z)]; };
export const fromLocal = (F, [x, y, z]) => [F.o[0] + F.X[0] * x + F.Y[0] * y + F.Z[0] * z, F.o[1] + F.X[1] * x + F.Y[1] * y + F.Z[1] * z, F.o[2] + F.X[2] * x + F.Y[2] * y + F.Z[2] * z];

// ── What a thing is, as a distance field in its own frame (x along it, y its face, z across) ────────────────────
// Each part is one of: { box: [hx, hy, hz], at }, { cyl: r, x0, x1, at } (round about x, flat ends), { cap: r, x0, x1,
// at } (round about x, round ends), { ell: [rx, ry, rz], at }, or { ring: R, r, at } (a ring in the x-y plane, a
// mug's handle). `at` is where its middle is, [0, 0, 0] if left out.
function partDist(P, q0) {
  const at = P.at || [0, 0, 0], q = sub(q0, at);
  if (P.box) {
    const d = q.map((v, i) => Math.abs(v) - P.box[i]), out = Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0));
    return out + Math.min(Math.max(d[0], d[1], d[2]), 0);
  }
  if (P.cyl !== undefined) {
    const mid = (P.x0 + P.x1) / 2, h = (P.x1 - P.x0) / 2, dr = Math.hypot(q[1], q[2]) - P.cyl, dx = Math.abs(q[0] - mid) - h;
    return Math.min(Math.max(dr, dx), 0) + Math.hypot(Math.max(dr, 0), Math.max(dx, 0));
  }
  if (P.cap !== undefined) { const x = Math.max(P.x0, Math.min(P.x1, q[0])); return Math.hypot(q[0] - x, q[1], q[2]) - P.cap; }
  if (P.ell) { const k = Math.hypot(q[0] / P.ell[0], q[1] / P.ell[1], q[2] / P.ell[2]); return (k - 1) * Math.min(...P.ell); }
  if (P.ring !== undefined) { const r = Math.hypot(q[0], q[1]) - P.ring; return Math.hypot(r, q[2]) - P.r; }
  return Infinity;
}
export function distOf(parts, F) {
  return (p) => { const q = toLocal(F, p); let d = Infinity; for (const P of parts) d = Math.min(d, partDist(P, q)); return d; };
}

// ── The hand's bones as points to test ────────────────────────────────────────────────────────────────────────────
// Each finger's three bones (the thumb's too), a few points along each with the finger's radius there, for a hand
// of side s and scale k. Cached: the hand's modelled once.
const FR = [0.0088, 0.0093, 0.0087, 0.0075], TR = [0.0112, 0.0101, 0.0092];
const SAMPLES = new Map();
function samplesOf(s, k) {
  const key = s + ':' + k;
  if (SAMPLES.has(key)) return SAMPLES.get(key);
  const J = fingerJointsOf(k), T = thumbJointsOf(k), tips = fingerTipsOf(s, k), mir = (p) => [s * p[0], p[1], p[2]];
  const out = [];
  for (let fi = 0; fi < 5; fi++) {
    const thumb = fi === 4, pts = thumb ? [...T.j.map(mir), tips[4]] : [...J[fi].j.map(mir), tips[fi]];
    const ts = thumb ? [0, T.t[0], T.t[1], 0.999] : [0, J[fi].t[0], J[fi].t[1], 0.999];
    const segs = [0, 1, 2].map((g) => [0.3, 0.65, 1].map((u) => ({
      p: lerp(pts[g], pts[g + 1], u), t: ts[g] + (ts[g + 1] - ts[g]) * u,
      // the radius there: a finger's tapers to its tip, the last point inside the rounded end
      r: k * (thumb ? TR[g] : FR[fi] * [1, 0.95, 0.88][g]) * (g === 2 && u === 1 ? 0.8 : 1),
    })));
    out.push(segs);
  }
  SAMPLES.set(key, out);
  return out;
}
// how far each bone of finger fi is from the thing (its skin's nearest point; under 0 is in it)
function bonesClear(pose, s, k, fi, dist) {
  const segs = samplesOf(s, k)[fi];
  return segs.map((seg) => { let m = Infinity; for (const q of seg) m = Math.min(m, dist(bendPoint(q.p, s, fi, q.t, pose)) - q.r); return m; });
}
// the joints a finger or the thumb folds at, in the pose: three hinges each (the thumb's swing is set, never closed)
const HINGES = (fi) => (fi === 4 ? [POSE_THUMB, POSE_THUMB + 2, POSE_THUMB + 3] : [fi * POSE_FINGER, fi * POSE_FINGER + 1, fi * POSE_FINGER + 2]);

// Close finger fi on the thing: its hinges fold together from `open` at `rate`, and each bone that meets the surface
// stops the hinges behind it. `squeeze` is how far skin goes into what it holds before it counts as touching.
export function closeOn(pose, s, k, fi, dist, { open = [-0.3, -0.1, 0], rate = [1, 1.15, 0.8], max = [1.6, 1.9, 1.35], squeeze = 0.0012, step = 0.02 } = {}) {
  const H = HINGES(fi), lock = [false, false, false];
  H.forEach((ix, j) => { if (open[j] !== null) pose[ix] = open[j]; });
  let d = bonesClear(pose, s, k, fi, dist);
  for (let g = 0; g < 3; g++) if (d[g] <= squeeze) for (let j = 0; j <= g; j++) lock[j] = true;
  for (let n = 0; n < 240 && !lock.every(Boolean); n++) {
    const prev = H.map((ix) => pose[ix]);
    for (let j = 0; j < 3; j++) if (!lock[j]) { pose[H[j]] = Math.min(max[j], pose[H[j]] + step * rate[j]); if (pose[H[j]] >= max[j]) lock[j] = true; }
    d = bonesClear(pose, s, k, fi, dist);
    for (let g = 0; g < 3; g++) {
      if (d[g] > squeeze) continue;
      // in too far: back to the step before for the hinges this bone stops
      for (let j = 0; j <= g; j++) { if (!lock[j] && d[g] < -2.5 * squeeze) pose[H[j]] = prev[j]; lock[j] = true; }
    }
  }
  return pose;
}

// The way out of the thing's surface at p (its distance field's slope)
function normalAt(dist, p, e = 0.0005) {
  return unit([0, 1, 2].map((i) => { const a = p.slice(), b = p.slice(); a[i] += e; b[i] -= e; return dist(a) - dist(b); }));
}
// Where each finger touches, and the way out of the surface there: every bone within `near` of it.
function touches(pose, s, k, fingers, dist, near = 0.0025) {
  const out = [], S = samplesOf(s, k);
  for (const fi of fingers) for (const seg of S[fi]) for (const q of seg) {
    const p = bendPoint(q.p, s, fi, q.t, pose);
    if (dist(p) - q.r < near) out.push({ p, n: normalAt(dist, p) });
  }
  return out;
}
// The thumb set against what the fingers hold: from a spread of places it could start (how far it's brought out
// from the palm at its root, how far across it), each closed on the thing, the one whose pad presses back hardest
// against where the fingers press (its surface's way out there most opposite to theirs), touching and nowhere in
// it. Worked out at one hand scale and kept, `start` then closed for any other. Gives [root, swing].
const THUMB_STARTS = new Map();
function thumbStart(key, pose, s, k, dist) {
  if (THUMB_STARTS.has(key)) return THUMB_STARTS.get(key);
  const T = touches(pose, s, k, [0, 1, 2, 3], dist), nf = T.length ? unit(T.reduce((a, t) => add(a, t.n), [0, 0, 0])) : null;
  let best = null;
  for (let root = -0.6; root <= 1.31; root += 0.15) for (let sw = -0.2; sw <= 1.61; sw += 0.15) {
    const P = Float32Array.from(pose);
    P[POSE_THUMB] = root; P[POSE_THUMB + 1] = sw; P[POSE_THUMB + 2] = -0.3; P[POSE_THUMB + 3] = -0.15;
    if (Math.min(...bonesClear(P, s, k, 4, dist)) < 0.0015) continue;
    closeOn(P, s, k, 4, dist, { open: [root, -0.3, -0.15], rate: [0.3, 1, 0.8], max: [root + 0.5, 1.2, 1.25], step: 0.03 });
    const c = bonesClear(P, s, k, 4, dist), tipC = c[2];
    if (tipC > 0.003 || Math.min(...c) < -0.003) continue;
    const segs = samplesOf(s, k)[4], q = segs[2][1], tp = bendPoint(q.p, s, 4, q.t, P), nt = normalAt(dist, tp);
    const score = (nf ? -dot(nt, nf) : 0) + 0.15 * c.filter((v) => v < 0.003).length - 0.08 * Math.abs(root) - 0.04 * Math.abs(sw - 0.9);
    if (!best || score > best.score) best = { score, root, sw };
  }
  const out = best ? [best.root, best.sw] : null;
  THUMB_STARTS.set(key, out);
  return out;
}

// The thumb's tip (the middle of its pad) onto a point, by folding its root, swing, knuckle and last joint: a few
// passes of trying each joint a little either way, smaller each pass. `rest` is the pose it starts from and is drawn
// back toward, so it doesn't take some strange way round. Gives the pose.
const THUMB_PAD = 0.0068;
// `dist`, if given, keeps the thumb's bones out of the thing on the way. fingerOnto is the same for a finger, by its
// three hinges.
export const thumbOnto = (rest, s, k, goal, dist = null) => chainOnto(rest, s, k, 4, goal, dist);
export const fingerOnto = (rest, s, k, fi, goal, dist = null) => chainOnto(rest, s, k, fi, goal, dist);
function chainOnto(rest, s, k, fi, goal, dist) {
  const pose = Float32Array.from(rest), tip = fingerTipsOf(s, k)[fi];
  const J = fi === 4 ? [POSE_THUMB, POSE_THUMB + 1, POSE_THUMB + 2, POSE_THUMB + 3] : HINGES(fi);
  const cost = () => {
    const p = bendPoint(tip, s, fi, 0.999, pose), e = len(sub(p, goal));
    let r = 0;
    for (const ix of J) r += (pose[ix] - rest[ix]) ** 2;
    let inside = 0;
    if (dist) { const c = bonesClear(pose, s, k, fi, dist); inside = Math.min(0, c[0] - 0.001) ** 2 + Math.min(0, c[1] - 0.001) ** 2; }
    return e * e + 0.00002 * r + 4 * inside;
  };
  let best = cost();
  for (const st of [0.16, 0.08, 0.04, 0.02, 0.01, 0.005]) {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const ix of J) {
        const v = pose[ix];
        for (const dv of [st, -st]) { pose[ix] = v + dv; const c = cost(); if (c < best) { best = c; moved = true; break; } pose[ix] = v; }
      }
      if (!moved) break;
    }
  }
  return pose;
}
export const thumbPad = THUMB_PAD;

// ── A pose by hand: [knuckle, middle joint, last joint, swing] for each finger, the thumb's [root, swing, knuckle, last]
const posed = (index, middle, ring, little, thumb) => Float32Array.from([...index, ...middle, ...ring, ...little, ...thumb]);
// where a finger's pad is, bent, and which way it faces (its skin's outward way on the palm's side)
function padOf(s, k, fi, pose, at = 0.88) {
  const segs = samplesOf(s, k)[fi], q = segs[2][1], p = bendPoint(q.p, s, fi, at, pose);
  const p2 = bendPoint(segs[2][0].p, s, fi, segs[2][0].t, pose), along = unit(sub(p, p2));
  // the pad faces where the palm's side faces, bent as the finger is: across the finger, toward the palm
  const palm = handDir(s, [1, 0, 0]), n = unit(sub(palm, mul(along, dot(palm, along))));
  return { p, along, n, r: q.r };
}

// ── The grips ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Each: `parts` (its shape, metres, in its own frame), `place(s, k, pose)` (its frame in bind space), `pose` the
// hand's start (all hinges at 0 if left out), `wrap` the fingers closed on it, `thumb` 'close' to close the thumb on
// it too, `open` how open each closing finger starts, `hold` the round part the shader flattens the fingers against
// ({ r, x }: its radius and where along x it is, for gl/figure-hd.js's uHold).
const PALM_A = 0.0135;
// something round held across the palm (a power grip): its axis `tilt` from straight across toward the fingers,
// its side on the palm at `d` down from the wrist, `x0` to `x1` its length either side of the hand's middle
const round = (r, d, x0, x1, extra = {}) => ({
  parts: [{ cyl: r, x0, x1 }],
  place: (s, k) => frameOf(add(handAt(s, [PALM_A, d, 0.005], k), mul(handDir(s, [1, 0, 0]), r)), handDir(s, [0, extra.tilt ?? 0.12, 1]), handDir(s, [1, 0, 0])),
  wrap: [0, 1, 2, 3], thumb: 'close', hold: { r },
  pose: posed([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0.85, 0, 0]),
  ...extra,
});
// A phone, portrait: its back on the palm and the fingers' first bones, its long side along the knuckles with the
// top toward the index, the far long edge in the bend of the fingers, which come round it onto the glass's edge.
// The thumb's free over the screen (figure-reach.js puts it where it's touching).
const PHONE = { H: 0.146, W: 0.071, T: 0.0085 };
// A fork, a spoon, a knife: along x from the end of the handle (x < 0) to the business end (x > 0), the handle's flat
// face up (y), measured from where the index presses. A pen the same, round.
const FORK = { handle: [-0.125, 0.02], head: 0.07, w: 0.0085, t: 0.0028 };
const cutlery = (kind) => kind === 'knife'
  ? [{ box: [0.0525, 0.003, 0.0075], at: [-0.068, 0, 0] }, { box: [0.05, 0.0012, 0.009], at: [0.04, 0, -0.002] }]
  : kind === 'spoon'
    ? [{ box: [0.07, FORK.t / 2, FORK.w / 2], at: [-0.05, 0, 0] }, { ell: [0.024, 0.008, 0.017], at: [0.045, 0.004, 0] }]
    : [{ box: [0.07, FORK.t / 2, FORK.w / 2], at: [-0.05, 0, 0] }, { box: [0.034, 0.002, 0.011], at: [0.046, 0, 0] }];

export const GRIPS = {
  bottle: round(0.031, 0.062, -0.105, 0.115, { tilt: 0.18 }),
  liquor: round(0.036, 0.062, -0.1, 0.19, { tilt: 0.18 }),
  shaker: round(0.045, 0.06, -0.06, 0.13, { tilt: 0.05 }),
  pint: round(0.039, 0.06, -0.065, 0.085, { tilt: 0.04 }),
  can: round(0.033, 0.06, -0.05, 0.07, { tilt: 0.06 }),
  glass: round(0.038, 0.06, -0.04, 0.05, { tilt: 0.04 }),
  pipe: round(0.006, 0.062, -0.06, 0.07, { tilt: 0.3, open: [-0.1, 0.1, 0.1] }),
  lighter: { ...round(0.011, 0.06, -0.03, 0.03, { tilt: 0.1 }), parts: [{ box: [0.03, 0.006, 0.011] }] },
  food: { ...round(0.026, 0.06, -0.045, 0.05, { tilt: 0.25 }), parts: [{ ell: [0.05, 0.026, 0.028], at: [0.003, 0, 0] }] },
  rag: { ...round(0.03, 0.07, -0.03, 0.03), parts: [{ ell: [0.04, 0.03, 0.03] }], hold: null },
  phone: {
    parts: [{ box: [PHONE.H / 2, PHONE.T / 2, PHONE.W / 2] }],
    // its back a millimetre off the palm, its middle where the far edge comes into the fingers' first joints
    place: (s, k) => {
      const N = handDir(s, [1, 0, 0]), back = handAt(s, [PALM_A + 0.002 / k, 0.071, 0.008], k);
      return frameOf(add(back, mul(N, PHONE.T / 2)), handDir(s, [0, 0.24, 1]), N);
    },
    wrap: [0, 1, 2, 3], open: [-0.35, -0.1, 0], rate: [0.7, 1.25, 0.9],
    // the thumb lifted off the glass and turned across it
    pose: posed([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0.05, 0.95, 0.15, 0.1]),
  },
  // In the pencil grip (a pen, a fork or spoon eaten with alone): the handle on the side of the middle finger's last
  // bone, pinched there by the pads of the thumb and index, and lying back over the web between them.
  pen: precision('pen'), forkUp: precision('fork'), spoon: precision('spoon'),
  // Overhand (the fork in the left hand, tines down, as Europe eats; a knife): the index straight along the top of
  // the handle, its end in the heel of the palm, the other three fingers and the thumb round it.
  forkDown: overhand('fork'), knife: overhand('knife'),
  // A banknote folded long, pinched up between the thumb and the side of the index, and a fan of them counted.
  note: pinched([{ box: [0.034, 0.0006, 0.0175], at: [0.02, 0, 0] }], 0.0006, posed([0.55, 0.7, 0.35, 0], [0.8, 1.0, 0.55, 0], [0.95, 1.15, 0.7, 0], [1.05, 1.2, 0.7, 0], [0.05, 0.75, 0.25, 0.15])),
  // A deck held to deal from: face down in the palm, the fingers round its far side, the thumb along the near one.
  deck: flatIn([0.044, 0.0075, 0.032], 0.064, { thumb: 'close' }),
  // A notepad flat on the palm to write on, the fingers under it, the thumb on its edge.
  pad: flatIn([0.075, 0.004, 0.052], 0.085, { thumb: 'close', open: [-0.45, -0.25, -0.1] }),
  // A wad of notes, folded, pinched up to count from.
  wad: null,
  // A mug by its handle: the index and middle through it, the thumb pressed on top, the mug's body out past the
  // knuckles. Its up (x) is the thumb's way.
  // The handle is a ring in the mug's x-y plane out along y; the index hooks through it at its first bone, the
  // palm toward the mug's body, and closes round the ring's near side.
  mug: {
    parts: [{ cyl: 0.041, x0: -0.048, x1: 0.048 }, { ring: 0.026, r: 0.0055, at: [0, 0.058, 0] }],
    pose: posed([0.15, 0, 0, 0], [0.25, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0.6, 0, 0]),
    place: (s, k, pose) => {
      // the ring's middle between the index's and middle finger's first bones, both through it, the body beyond
      const S = samplesOf(s, k), qi = S[0][0][2], qm = S[1][0][2];
      const p = lerp(bendPoint(qi.p, s, 0, qi.t, pose), bendPoint(qm.p, s, 1, qm.t, pose), 0.5), up = handDir(s, [0, 0, 1]);
      const toPalm = handDir(s, [1, 0, 0]), ring = add(p, mul(toPalm, 0.004));
      return frameOf(add(ring, mul(toPalm, 0.058)), up, mul(toPalm, -1));
    },
    wrap: [0, 1, 2, 3], open: [null, -0.1, 0], rate: [0.15, 1.2, 0.9], hold: null,
    // the thumb's pad pressed on top of the handle
    thumbAt: (F) => fromLocal(F, [0.026 + 0.0055 + THUMB_PAD, 0.058, 0]),
  },
  pill: pinched([{ ell: [0.0055, 0.0034, 0.0042] }], 0.0034, posed([0.55, 0.75, 0.35, 0], [0.9, 1.1, 0.6, 0], [1.0, 1.2, 0.7, 0], [1.1, 1.25, 0.7, 0], [0.1, 1.0, 0.2, 0.1])),
};
GRIPS.card = pinched([{ box: [0.044, 0.0004, 0.032], at: [0.03, 0, 0] }], 0.0004, GRIPS.note.pose);
GRIPS.wad = pinched([{ box: [0.034, 0.0035, 0.0175], at: [0.02, 0, 0] }], 0.0035, GRIPS.note.pose);
// Something flat on the palm, its long side along the knuckles like the phone's: `h` its half sizes (long, thick,
// wide), `d` how far down the hand its middle is. The fingers close on it.
function flatIn(h, d, extra = {}) {
  return {
    parts: [{ box: h }],
    place: (s, k) => {
      const N = handDir(s, [1, 0, 0]), back = handAt(s, [PALM_A + 0.002 / k, d, 0.006], k);
      return frameOf(add(back, mul(N, h[1])), handDir(s, [0, 0.24, 1]), N);
    },
    wrap: [0, 1, 2, 3], open: [-0.35, -0.1, 0], rate: [0.7, 1.25, 0.9], hold: null,
    pose: posed([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0.85, 0, 0]),
    ...extra,
  };
}
// Something small or thin pinched between the pads of the index and the thumb: both reach for one point in front of
// the hand where a pinch closes, from either side, the thing between them (its y the index's way to the thumb's).
function pinched(parts, half, pose) {
  const M = (s, k) => handAt(s, [0.05, 0.074, 0.028], k), way = (s) => handDir(s, [0, 0.62, -0.78]);
  return {
    parts, pose,
    place: (s, k) => frameOf(M(s, k), handDir(s, [0.55, 0.45, 0.7]), way(s)),
    fingers: (s, k, pose, F) => {
      const dist = distOf(parts, F);
      pose.set(fingerOnto(pose, s, k, 0, fromLocal(F, [0, -(half + 0.0072), 0]), dist));
    },
    thumbAt: (F) => fromLocal(F, [0, half + THUMB_PAD, 0]),
    hold: null,
  };
}
function precision(kind) {
  const pen = kind === 'pen';
  return {
    parts: pen ? [{ cap: 0.0045, x0: -0.115, x1: 0.026 }] : cutlery(kind),
    // the index's pad and the thumb's on the handle a couple of centimetres back from the business end; the middle
    // finger's last bone under it; the ring and little fingers tucked behind
    pose: posed([0.5, 0.55, 0.3, 0], [0.62, 0.8, 0.45, 0.05], [1.0, 1.25, 0.75, 0], [1.1, 1.3, 0.8, 0], [0.12, 1.05, 0.15, 0.1]),
    place: (s, k, pose) => {
      const I = padOf(s, k, 0, pose), M = padOf(s, k, 1, pose, 0.82);
      // the side of the middle finger's tip, toward the index: the handle rests on it
      const rest = add(M.p, mul(unit(sub(I.p, M.p)), M.r));
      const under = add(I.p, mul(I.n, I.r + (pen ? 0.0045 : FORK.t / 2))), o = lerp(under, rest, 0.45);
      // back over the web between the thumb and the index's knuckle
      const web = handAt(s, [-0.006, 0.058, 0.036], k), X = unit(sub(o, web));
      // the handle's face toward the index's pad
      return frameOf(o, X, sub(under, rest));
    },
    // the thumb's pad on the handle's side toward it, a little back from the index
    thumbAt: (F, s, k, pose) => {
      const w = (pen ? 0.0045 : FORK.w / 2) + THUMB_PAD, tip = bendPoint(fingerTipsOf(s, k)[4], s, 4, 0.999, pose);
      const a = fromLocal(F, [-0.006, 0, w]), b = fromLocal(F, [-0.006, 0, -w]);
      return len(sub(a, tip)) < len(sub(b, tip)) ? a : b;
    },
    hold: null,
  };
}
function overhand(kind) {
  return {
    parts: cutlery(kind),
    pose: posed([0.08, 0.12, 0.05, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0.05, 0.9, 0, 0]),
    place: (s, k, pose) => {
      // under the index's pad, back to the heel of the palm on the little finger's side
      const I = padOf(s, k, 0, pose, 0.7), under = add(I.p, mul(I.n, I.r + FORK.t / 2 + 0.0004));
      const heel = add(handAt(s, [PALM_A, 0.03, -0.02], k), mul(handDir(s, [1, 0, 0]), 0.004));
      // the handle's top toward the index
      const X = unit(sub(under, heel));
      return frameOf(add(under, mul(X, -0.006)), X, mul(I.n, -1));
    },
    wrap: [1, 2, 3], open: [-0.45, -0.1, 0], thumb: 'close', hold: null,
  };
}

// ── Working a grip out ────────────────────────────────────────────────────────────────────────────────────────────
// gripOf(kind, side, k): { pose (the hand's, gl/figure-hands.js), frame (the thing's, bind space on the hand's bone),
// dist (its distance field), hold (the uHold cylinder, in the left hand's space, or null) }. Null for a kind with no
// grip. Kept per kind, side and the hand's scale to the nearest hundredth.
const MADE = new Map();
export function gripOf(kind, side, k = 1.15) {
  const G = GRIPS[kind];
  if (!G) return null;
  const s = side > 0 ? 1 : -1, kk = Math.round(k * 100) / 100, key = kind + s + kk;
  if (MADE.has(key)) return MADE.get(key);
  const pose = Float32Array.from(G.pose || new Float32Array(POSE_LEN));
  // a precise grip is placed by its fingers, a wrapped one placed first and the fingers closed on it
  const F = G.place(s, kk, pose), dist = distOf(G.parts, F);
  for (const fi of G.wrap || []) closeOn(pose, s, kk, fi, dist, { open: G.open, rate: G.rate });
  if (G.fingers) G.fingers(s, kk, pose, F);
  if (G.thumbAt) {
    // a pinch: the thumb's pad put on the point the grip names, then pressed home
    const goal = G.thumbAt(F, s, kk, pose);
    pose.set(thumbOnto(pose, s, kk, goal, dist));
  } else if (G.thumb === 'close') {
    // where it starts is searched once, at a middling hand, then the thumb closed from there on this one
    const st = thumbStart(kind + s, pose, s, kk, dist) || [pose[POSE_THUMB], pose[POSE_THUMB + 1]];
    pose[POSE_THUMB + 1] = st[1];
    closeOn(pose, s, kk, 4, dist, { open: [st[0], -0.3, -0.15], rate: [0.3, 1, 0.8], max: [st[0] + 0.5, 1.2, 1.25], step: 0.03 });
  }
  const hold = G.hold ? { at: [s * F.o[0], F.o[1], F.o[2]], dir: [s * F.X[0], F.X[1], F.X[2]], r: G.hold.r } : null;
  const out = { kind, side: s, k: kk, pose, frame: F, dist, hold, parts: G.parts };
  MADE.set(key, out);
  return out;
}
// How a grip sits, for the checks: each finger's bones' clearance (under 0 is in it) and the palm's.
export function gripReport(kind, side, k = 1.15) {
  const g = gripOf(kind, side, k);
  if (!g) return null;
  const fingers = [0, 1, 2, 3, 4].map((fi) => bonesClear(g.pose, g.side, g.k, fi, g.dist).map((v) => +v.toFixed(4)));
  let palm = Infinity;
  for (const a of [0.2, 0.5, 0.8]) for (const f of [-0.02, 0, 0.02]) palm = Math.min(palm, g.dist(handAt(g.side, [PALM_A, a * 0.075, f], g.k)));
  return { kind, fingers, palm: +palm.toFixed(4) };
}
export const PHONE_SIZE = PHONE;
export const CUTLERY = FORK;
