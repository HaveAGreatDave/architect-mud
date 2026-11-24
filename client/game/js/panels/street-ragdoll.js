// STREET RAGDOLL: somebody the vehicle you're in has hit, limb by limb.
//
// Verlet points on the close-up figure's joints (figure.js FIGURE_BONES) and five tips (the top of the
// head, each hand and each toe), held together by the bones and by braces that keep the torso, the head,
// each hand and each foot in one piece. Started from the pose they were in, pushed harder at the legs than
// the shoulders (the bumper takes them below the hips), they fall under gravity onto the ground and
// slide to a stop. The rink's ragdoll (rink/rig.js makeRag, stepRag) is the model.
//
// It runs in the frame the close-up figure is placed in (gl/room-people.js placeOf with a yaw of 0):
// metres, Y up, X along a tile's x and Z along its y, with the origin on the ground where they were hit.
// `ragSkin` turns the points into the figure's skin matrices, one a bone, which figurePeople takes in
// place of a clip. Each bone's turn comes from the way it points and the torso's sideways line, against
// the same two at rest, so nothing goes through Euler angles.
//
// Getting up (`ragRise`) moves every point from where the ragdoll left it to a standing pose over the
// pelvis, eased, through the same matrices. Pure: no DOM, no GL, no clock of its own.

import { actorSkinAt } from './actor3d.js';
import { FIGURE_BONES } from './figure.js';

const NB = FIGURE_BONES.length;
const BI = {};
FIGURE_BONES.forEach((b, i) => { BI[b[0]] = i; });
// Each bone's joint at rest, in metres.
const REST = [];
FIGURE_BONES.forEach(([, p, o], i) => { REST[i] = p < 0 ? o.slice() : [REST[p][0] + o[0], REST[p][1] + o[1], REST[p][2] + o[2]]; });
// The tips past the last joints: what a leaf bone points at. [bone it rides, offset from that joint at rest]
const TIPS = [['head', [0, 0.22, 0.02]], ['handL', [0, -0.17, 0]], ['handR', [0, -0.17, 0]], ['toeL', [0, 0, 0.07]], ['toeR', [0, 0, 0.07]]];
const TIP = { head: NB, handL: NB + 1, handR: NB + 2, toeL: NB + 3, toeR: NB + 4 };
const NP = NB + TIPS.length;
const REST_P = REST.concat(TIPS.map(([b, o]) => { const r = REST[BI[b]]; return [r[0] + o[0], r[1] + o[1], r[2] + o[2]]; }));

// What each bone points at, and which sideways line gives its twist: the hips' for the legs, the
// shoulders' for everything above.
const AIM = {};
const kidOf = {};
FIGURE_BONES.forEach(([n, p], i) => { if (p >= 0 && kidOf[p] === undefined && !n.startsWith('uarm')) kidOf[p] = i; });
kidOf[BI.chest] = BI.neck;
kidOf[BI.pelvis] = BI.spine;
for (let i = 0; i < NB; i++) {
  const n = FIGURE_BONES[i][0];
  const aim = TIP[n] ?? kidOf[i];
  const low = /pelvis|thigh|shin|foot|toe/.test(n);
  AIM[i] = { aim, side: low ? [BI.thighL, BI.thighR] : [BI.uarmL, BI.uarmR] };
}

// The numbers, in metres and seconds.
export const RAG_LIMB = {
  g: 9.81,
  legs: 1.2,          // the legs' speed off the bumper, as a share of the vehicle's
  chest: 0.7,         // and the shoulders', so the body turns over the bonnet
  up: 0.32,           // upward, as a share of the vehicle's speed
  iters: 8,           // constraint passes a step
  step: 1 / 120,      // the integrator's step
  grip: 0.18,         // how much of a point's slide the ground takes each step it's down
  radius: 0.07, head: 0.11,
  still: 0.12,        // m/s average below which they've come to rest
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The braces: [a, b, stiffness]. Bones first, then what keeps each part in one piece.
function bracesOf(P) {
  const out = [], seen = new Set();
  const add = (a, b, k = 1) => { const key = a < b ? a * 64 + b : b * 64 + a; if (a === b || seen.has(key)) return; seen.add(key); out.push([a, b, Math.hypot(...sub(P[a], P[b])), k]); };
  FIGURE_BONES.forEach(([, p], i) => { if (p >= 0) add(p, i); });
  TIPS.forEach(([b], t) => add(BI[b], NB + t));
  const all = (list, k) => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i], list[j], k); };
  const hips = [BI.pelvis, BI.spine, BI.thighL, BI.thighR], ribs = [BI.spine, BI.chest, BI.neck, BI.uarmL, BI.uarmR];
  all(hips, 1); all(ribs, 1);
  // the waist gives a little
  for (const a of hips) for (const b of ribs) add(a, b, 0.25);
  all([BI.neck, BI.head, TIP.head], 1); add(BI.chest, BI.head, 0.5); add(BI.chest, TIP.head, 0.4);
  all([BI.farmL, BI.handL, TIP.handL], 1); all([BI.farmR, BI.handR, TIP.handR], 1);
  all([BI.shinL, BI.footL, BI.toeL, TIP.toeL], 1); all([BI.shinR, BI.footR, BI.toeR, TIP.toeR], 1);
  return out;
}
// No knee or elbow folds flat: a hip stays this far from its ankle, a shoulder from its wrist.
const REACH = [[BI.thighL, BI.footL, 0.5], [BI.thighR, BI.footR, 0.5], [BI.uarmL, BI.handL, 0.26], [BI.uarmR, BI.handR, 0.26],
  // and the two knees, the two feet and the two hands keep out of each other
  [BI.shinL, BI.shinR, 0.12], [BI.footL, BI.footR, 0.12], [BI.handL, BI.handR, 0.1]];

// The joints of a clip at a phase, turned by `yaw` (placeOf's) and set down at `at` (metres), in the frame above.
function posedPoints(clip, ph, yaw, at = [0, 0, 0]) {
  const S = actorSkinAt(clip, ph);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const place = (p) => [at[0] + c * p[0] + s * p[2], at[1] + p[1], at[2] - s * p[0] + c * p[2]];
  const by = (m, r) => [m[0] * r[0] + m[4] * r[1] + m[8] * r[2] + m[12], m[1] * r[0] + m[5] * r[1] + m[9] * r[2] + m[13], m[2] * r[0] + m[6] * r[1] + m[10] * r[2] + m[14]];
  const out = [];
  for (let i = 0; i < NB; i++) out.push(place(by(S[i], REST[i])));
  TIPS.forEach(([b], t) => out.push(place(by(S[BI[b]], REST_P[NB + t]))));
  return out;
}

// A new ragdoll. `clip`, `ph` and `yaw` are what the figure was doing and which way it faced (placeOf's
// yaw); `vel` is the vehicle's velocity in this frame, metres a second ([x, z]).
export function makeLimbRag(clip, ph, yaw, vel) {
  const P = posedPoints(clip, ph, yaw);
  const R = RAG_LIMB, sp = Math.hypot(vel[0], vel[1]), up = sp * R.up, dt = R.step;
  const pts = P.map((p, i) => {
    // below the waist takes the bumper; the shoulders and head are carried less, so they turn over it
    const k = p[1] < 0.95 ? R.legs : R.chest + (R.legs - R.chest) * Math.max(0, (1.5 - p[1]) / 0.55);
    const vx = vel[0] * k, vz = vel[1] * k, vy = up * (p[1] < 0.95 ? 0.6 : 1);
    return { x: p[0], y: p[1], z: p[2], px: p[0] - vx * dt, py: p[1] - vy * dt, pz: p[2] - vz * dt, r: i === BI.head || i === TIP.head ? R.head : R.radius };
  });
  return { pts, cons: bracesOf(P), acc: 0, still: 0, age: 0 };
}

// Advance by `dt` seconds. Returns true once they've lain still a moment.
export function stepLimbRag(rag, dt) {
  const R = RAG_LIMB;
  rag.acc += Math.min(dt, 0.1);
  let moved = 0, steps = 0;
  while (rag.acc >= R.step) {
    rag.acc -= R.step; rag.age += R.step; steps++;
    const h = R.step, g = R.g * h * h;
    for (const p of rag.pts) {
      const vx = (p.x - p.px) * 0.998, vy = (p.y - p.py) * 0.998, vz = (p.z - p.pz) * 0.998;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x += vx; p.y += vy - g; p.z += vz;
    }
    for (let it = 0; it < R.iters; it++) {
      for (const [a, b, l, k] of rag.cons) {
        const A = rag.pts[a], B = rag.pts[b];
        let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6, f = (d - l) / d * 0.5 * k;
        dx *= f; dy *= f; dz *= f;
        A.x += dx; A.y += dy; A.z += dz; B.x -= dx; B.y -= dy; B.z -= dz;
      }
      for (const [a, b, l] of REACH) {
        const A = rag.pts[a], B = rag.pts[b];
        let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d >= l) continue;
        const f = (d - l) / d * 0.5;
        dx *= f; dy *= f; dz *= f;
        A.x += dx; A.y += dy; A.z += dz; B.x -= dx; B.y -= dy; B.z -= dz;
      }
      for (const p of rag.pts) if (p.y < p.r) { p.y = p.r; if (p.py < p.y) p.py = p.y + (p.py - p.y) * -0.15; }
    }
    // the ground holds what's on it: asphalt, not ice
    for (const p of rag.pts) if (p.y <= p.r + 0.01) { p.px += (p.x - p.px) * R.grip; p.pz += (p.z - p.pz) * R.grip; }
  }
  if (steps) {
    for (const p of rag.pts) moved += Math.hypot(p.x - p.px, p.y - p.py, p.z - p.pz);
    const v = moved / rag.pts.length / R.step;
    rag.still = v < R.still ? rag.still + dt : 0;
  }
  return rag.still > 0.5 && rag.age > 1;
}

// Where the pelvis is ([x, y, z], metres), for the anchor and the far fallback.
export const ragPelvis = (rag) => { const p = rag.pts[BI.pelvis]; return [p.x, p.y, p.z]; };
// The torso's line, pelvis to neck, unit length: the crowd body's tumble when it draws them instead.
export const ragTorso = (rag) => norm(sub([rag.pts[BI.neck].x, rag.pts[BI.neck].y, rag.pts[BI.neck].z], ragPelvis(rag)));

// One bone's frame: its aim and the sideways line, square to it.
function frameOf(P, i) {
  const A = AIM[i], j = P[i], d = norm(sub(P[A.aim], j));
  let s = sub(P[A.side[0]], P[A.side[1]]);
  s = sub(s, d.map((v) => v * dot(s, d)));
  if (Math.hypot(s[0], s[1], s[2]) < 1e-5) s = Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]);
  s = norm(s);
  return [d, s, cross(d, s)];
}
const REST_F = Array.from({ length: NB }, (_, i) => frameOf(REST_P, i));

// The skin matrices (column-major 4×4, bind space to this frame), one a bone, for points `P`
// ([x, y, z] each), with `off` taken off every translation (the anchor the figure is placed at).
function skinOf(P, off) {
  const out = [];
  for (let i = 0; i < NB; i++) {
    const [d, s, n] = frameOf(P, i), [d0, s0, n0] = REST_F[i];
    // R = [d s n] · [d0 s0 n0]ᵀ
    const m = new Float64Array(16);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = d[r] * d0[c] + s[r] * s0[c] + n[r] * n0[c];
    const rest = REST[i], j = P[i];
    for (let r = 0; r < 3; r++) m[12 + r] = j[r] - off[r] - (m[r] * rest[0] + m[4 + r] * rest[1] + m[8 + r] * rest[2]);
    m[15] = 1;
    out.push(m);
  }
  return out;
}

// The figure's skin as it lies, about the pelvis's spot on the ground: { skin, at } with `at` [x, z] metres.
export function ragSkin(rag) {
  const P = rag.pts.map((p) => [p.x, p.y, p.z]), pl = P[BI.pelvis], off = [pl[0], 0, pl[2]];
  return { skin: skinOf(P, off), at: [pl[0], pl[2]] };
}

// Getting up: `k` 0..1 from where they lie to standing over the pelvis, facing `yaw`.
export function ragRise(rag, k, yaw) {
  const pl = ragPelvis(rag);
  if (!rag.stand) rag.stand = posedPoints('idle', 0, yaw, [pl[0], 0, pl[2]]);
  // the hips first, the head last: a body gets up from the middle
  const e = (x) => x * x * (3 - 2 * x);
  const P = rag.pts.map((p, i) => {
    const t = rag.stand[i], lag = i === BI.head || i === TIP.head || i === BI.neck ? 0.25 : /hand|farm/.test(FIGURE_BONES[i]?.[0] || 'hand') ? 0.15 : 0;
    const q = e(Math.max(0, Math.min(1, (k - lag) / (1 - lag))));
    return [p.x + (t[0] - p.x) * q, p.y + (t[1] - p.y) * q, p.z + (t[2] - p.z) * q];
  });
  const off = [pl[0], 0, pl[2]];
  return { skin: skinOf(P, off), at: [pl[0], pl[2]] };
}
