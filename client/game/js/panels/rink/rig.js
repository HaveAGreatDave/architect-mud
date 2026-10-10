// Rinkside · the rig. A body's state (position, heading, stride, the action it is doing
// and how far through it) goes in, 21 world-space joints come out:
//
//   0 pelvis  1 chest  2 neck  3 head
//   4 shoulder L  5 elbow L  6 hand L     7 shoulder R  8 elbow R  9 hand R
//   10 hip L  11 knee L  12 ankle L       13 hip R  14 knee R  15 ankle R
//   16 toe L  17 toe R                    18 stick butt  19 blade heel  20 blade toe
//
// Body space is u forward, v to his left, z up. Every pose is built there and turned into
// the world at the end, so a pose is authored once and works at any heading.
//
// A man knocked flat is a RAGDOLL: verlet particles on the first 18 joints, held together
// by his bones and a few braces, falling under gravity into the ice and the boards. Where he
// hits decides how he lands, which is the whole point of a board check. Getting up blends
// from wherever the ragdoll left him back into his stance.

import { TAU, V, clamp, lerp, ik, rotZ, easeOut, easeIO } from './util.js';
import { insideRink, GLASS_H } from './geo.js';

export const DT = 1 / 120;
export const G = 32;

// Shots and passes: blade wound back to `back`, through the puck at `hit`, out to `fol`.
// `wind` is the fraction of the action spent loading; the puck leaves at `release`. `flex`
// is how far the shaft bows at contact (feet), `bh` marks the backhand side, where the
// weight shifts the other way.
export const SHOTS = {
  slap:     { wind: 0.55, back: [-1.7, 1.6, 3.9], hit: [1.45, 1.0, 0.08], fol: [3.0, 0.3, 3.5], dur: 0.7, flex: 0.55 },
  onetimer: { wind: 0.3, back: [-1.1, 1.5, 3.0], hit: [1.5, 1.0, 0.08], fol: [3.0, 0.3, 3.2], dur: 0.42, flex: 0.5 },
  wrist:    { wind: 0.45, back: [-0.35, 1.95, 0.2], hit: [1.6, 0.9, 0.1], fol: [2.8, 0.4, 2.2], dur: 0.5, flex: 0.22 },
  snap:     { wind: 0.3, back: [0.3, 1.85, 0.9], hit: [1.5, 0.9, 0.08], fol: [2.6, 0.4, 1.6], dur: 0.4, flex: 0.35 },
  backhand: { wind: 0.4, back: [-0.1, -1.95, 0.5], hit: [1.4, -0.7, 0.1], fol: [2.2, -0.4, 2.6], dur: 0.5, flex: 0.15, bh: true },
  tip:      { wind: 0.2, back: [1.8, 0.8, 0.6], hit: [2.2, 0.6, 0.5], fol: [2.4, 0.5, 0.9], dur: 0.3, flex: 0 },
  wrap:     { wind: 0.35, back: [-0.5, 1.95, 0.2], hit: [0.6, 1.6, 0.08], fol: [1.8, 1.0, 1.2], dur: 0.5, flex: 0.1 },
  pass:     { wind: 0.35, back: [0.8, 1.85, 0.1], hit: [1.9, 0.7, 0.08], fol: [2.5, 0.4, 0.5], dur: 0.32, flex: 0.05 },
  saucer:   { wind: 0.3, back: [0.7, 1.85, 0.1], hit: [1.8, 0.8, 0.25], fol: [2.6, 0.3, 1.6], dur: 0.34, flex: 0.05 },
  backpass: { wind: 0.35, back: [0.5, -1.85, 0.1], hit: [1.6, -0.7, 0.08], fol: [2.3, -0.3, 0.6], dur: 0.34, flex: 0.05, bh: true },
  drop:     { wind: 0.35, back: [2.0, 0.7, 0.05], hit: [0.7, 0.6, 0.05], fol: [1.3, 0.6, 0.35], dur: 0.32, flex: 0 },
  dump:     { wind: 0.4, back: [0.0, 1.9, 0.6], hit: [1.5, 0.9, 0.08], fol: [2.8, 0.4, 2.0], dur: 0.45, flex: 0.2 },
};
export const releaseAt = (type) => { const s = SHOTS[type] || SHOTS.wrist; return s.dur * (s.wind + 0.08); };

// Moves a puck carrier makes with the blade, as a path of [u, v, z] the blade follows
// through the action. The puck rides the blade, so the sim reads the same function.
const DEKES = {
  // pull it back across the body with the toe turned over it, then push it out
  toedrag: [[2.4, 1.3, 0.05], [1.5, -0.5, 0.05], [2.8, 0.1, 0.05]],
  // forehand to backhand and back, wide, the move in front of a goalie
  deke: [[2.3, 1.2, 0.05], [2.2, -0.9, 0.05], [2.7, 1.0, 0.05]],
  // a shot that isn't: the blade loads, the goalie bites, the puck goes to the side
  fake: [[2.2, 0.9, 0.05], [0.7, 1.7, 0.5], [2.0, -0.6, 0.05]],
  // between the legs is beyond a CPhL roster; a quick lateral drag is not
  drag: [[2.4, 0.4, 0.05], [2.0, 1.6, 0.05], [2.6, 0.9, 0.05]],
};
const path3 = (pts, t) => {
  const n = pts.length - 1, f = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), k = easeIO(f - i);
  return V.lerp(pts[i], pts[i + 1], k);
};

// THE SKATES ARE SOLID. A blade or a puck that passes through a man's own feet is the
// clipping a viewer notices first, so both are kept outside an ellipse round them.
export const FEET = { u: 0.25, ru: 1.35, rv: 1.0 };
export function keepOut(u, v, pad = 0) {
  const du = (u - FEET.u) / (FEET.ru + pad), dv = v / (FEET.rv + pad), r = Math.hypot(du, dv);
  if (r >= 1) return [u, v];
  if (r < 1e-3) return [FEET.u + FEET.ru + pad, v];
  return [FEET.u + du / r * (FEET.ru + pad), dv / r * (FEET.rv + pad)];
}

// Where the blade (and so the puck) is in body space. One function for the rig and the sim,
// so a carried puck can never drift off the stick.
export function bladeLocal(s, T, carrying) { const [u, v] = bladeRaw(s, T, carrying); return keepOut(u, v, 0.1); }
function bladeRaw(s, T, carrying) {
  if (carrying || s.carrying) {
    if (DEKES[s.act]) { const p = path3(DEKES[s.act], s.actT); return [p[0], p[1]]; }
    const sp = Math.hypot(s.vx || 0, s.vy || 0);
    if (s.protect) return [1.5, -s.protect * 1.35];             // on the far side from the man
    if (sp > 21) return [3.0, 0.45 + 0.15 * Math.sin(T * 4 + s.seed)];  // pushed ahead, one hand
    // the dangle: forehand to backhand and back, a little ahead and behind, never the same twice
    const f = 1.55 + (s.seed % 7) * 0.06;
    return [2.35 + 0.22 * Math.cos(T * f * 2.1 + s.seed), 0.5 + 0.7 * Math.sin(T * f * TAU * 0.5 + s.seed)];
  }
  return [2.3, 0.75 + 0.18 * Math.sin(s.phase * TAU)];
}
export function bladeWorld(s, T, carrying) {
  const [u, v] = bladeLocal(s, T, carrying), c = Math.cos(s.h), n = Math.sin(s.h);
  return [s.x + u * c - v * n, s.y + u * n + v * c];
}

const toLocalFn = (s) => { const ch = Math.cos(s.h), sn = Math.sin(s.h); return (X, Y, Z) => { const dx = X - s.x, dy = Y - s.y; return [dx * ch + dy * sn, -dx * sn + dy * ch, Z]; }; };
const toWorld = (s, loc) => { const ch = Math.cos(s.h), sn = Math.sin(s.h); return loc.map((p) => (p ? [s.x + p[0] * ch - p[1] * sn, s.y + p[0] * sn + p[1] * ch, p[2]] : null)); };
const dirWorld = (s, d) => { const ch = Math.cos(s.h), sn = Math.sin(s.h); return [d[0] * ch - d[1] * sn, d[0] * sn + d[1] * ch, d[2]]; };
// roll about the body's forward axis, pivoting at the ice: leaning into a turn
const roll = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
const bump = (t) => Math.sin(clamp(t, 0, 1) * Math.PI);

// ── the stick in his hands ───────────────────────────────────────────────────
// A stick is a fixed length. The old rig put the top hand where the pose wanted it and
// drew the shaft to wherever the blade was, so a stick grew and shrank through a dangle
// and a glove could float a foot off the shaft. Now the BLADE goes where it must (on the
// puck), the TOP HAND sits at the knob a stick's length from it, as close to where the
// pose wants the hand as that allows and never beyond the arm's reach (if it can't reach,
// the blade comes in instead), and the BOTTOM HAND slides along the shaft to wherever the
// other arm reaches it comfortably, near the grip the action asks for.
export const STICK = 4.5;            // top hand to the heel of the blade, feet
const ARM = 2.12;                    // shoulder to glove at full stretch
function fitStick(R0, blade0, shR, shL, wantT, oneHand) {
  let d = V.sub(R0, blade0), len = V.len(d) || 1;
  let hand = V.add(blade0, V.mul(d, STICK / len));
  // look for a grip that keeps the blade where it is AND the hand within reach: alternate
  // between the two constraints, which settles on a point both allow whenever one exists
  for (let i = 0; i < 6; i++) {
    const a = V.sub(hand, shR), al = V.len(a);
    if (al <= ARM) break;
    hand = V.add(shR, V.mul(a, ARM / al));
    const b = V.sub(hand, blade0), bl = V.len(b) || 1;
    hand = V.add(blade0, V.mul(b, STICK / bl));
  }
  let blade = blade0;
  const a = V.sub(hand, shR), al = V.len(a);
  if (al > ARM * 1.01) {
    // no such grip: the hand stays within reach and the blade comes in to meet it
    hand = V.add(shR, V.mul(a, ARM / al));
    const bd = V.sub(blade0, hand), bl = V.len(bd) || 1;
    blade = V.add(hand, V.mul(bd, STICK / bl));
  }
  if (blade0[2] < 0.3) {
    // a blade that belongs on the ice stays on it: keep the shaft's heading, fix its length
    const dz = 0.06 - hand[2], horiz = Math.sqrt(Math.max(0.04, STICK * STICK - dz * dz));
    const hd = V.norm([blade[0] - hand[0], blade[1] - hand[1], 0]);
    blade = [hand[0] + hd[0] * horiz, hand[1] + hd[1] * horiz, 0.06];
  }
  const dir = V.norm(V.sub(blade, hand));
  let L = null;
  if (!oneHand) {
    let bs = 1e9;
    for (let t = 0.9; t <= 2.8; t += 0.1) {
      const p = V.add(hand, V.mul(dir, t)), r = V.len(V.sub(p, shL));
      if (r > ARM * 0.98) continue;
      const sc = Math.abs(t - wantT) + Math.max(0, 1.3 - r) * 2;
      if (sc < bs) { bs = sc; L = p; }
    }
  }
  return { R: hand, blade, L, dir };
}
// keep a hand within a fraction of full arm reach, so elbows stay bent
const reach = (sh, h, frac) => { const d = V.sub(h, sh), l = V.len(d), max = 2.25 * frac; return l > max ? V.add(sh, V.mul(d, max / l)) : h; };
// head direction in body space: yaw left of forward, pitch up
const lookDir = (yaw, pitch) => [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)];

// ── skaters, officials and medics ───────────────────────────────────────────
export function skaterRig(s, T) {
  if (s.rag) return s.rag.pts.map((p) => [p.x, p.y, p.z]);
  const J = standRig(s, T);
  if (s.blend) {
    // getting up: from where the ragdoll left him into his stance, hips first
    const k = easeIO(clamp(s.blend.t, 0, 1));
    for (let i = 0; i < 18; i++) J[i] = V.lerp(s.blend.from[i], J[i], i <= 3 ? k : Math.min(1, k * 1.25));
    if (k < 0.7) J[18] = J[19] = J[20] = null;
  }
  return J;
}

// ── the stride ───────────────────────────────────────────────────────────────
// SKATING IS NOT RUNNING. A runner's feet swing fore and aft and leave the ground; a
// skater's never really do. Each skate PUSHES OUT SIDEWAYS AND A LITTLE BACK on its edge,
// toe turned out, the leg straightening to full extension, then comes back under him
// barely off the ice and glides while the other one pushes. The weight rocks over the
// gliding skate, the hips drop on every push, the free arm swings across the body, and the
// head and shoulders stay level over all of it. The first version of this rig swung the
// feet fore and aft and lifted them, and everybody in the league looked like they were
// stepping across a kitchen floor.
//
// Five strides, each a function of the leg's place in its cycle, BLENDED by weights that
// come from how he is moving, so a man going from a crossover into a glide into a pivot
// backwards never pops between them:
//   forward    push out and back, recover in under the body
//   crossover  in a turn: the inside skate pushes UNDER him to the outside, the outside
//              skate lifts and crosses OVER to land on the inside
//   backward   C-cuts: each heel sweeps out and forward and draws back in, toes in
//   start      the first strides from a stop: short, quick, toes out like a V, all drive
//   glide      a stride with no amplitude: skates under him, staggered, knees bent
const PUSH = 0.56;                                // fraction of a leg's cycle spent pushing
const smooth = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function legCycle(p) { const q = ((p / TAU) % 1 + 1) % 1; return q < PUSH ? { push: true, k: q / PUSH } : { push: false, k: (q - PUSH) / (1 - PUSH) }; }
const pushW = (c) => (c.push ? Math.sin(Math.PI * c.k) : 0);
function strideForward(sg, c, a) {
  // the gliding skate tracks in under his centre; the pushing one drives out to near full
  // extension, about 45 degrees out and a little back, before it comes home
  const base = 0.48 - 0.26 * a;
  const outU = 0.3 - 0.95 * a, outV = base + 1.85 * a;
  if (c.push) {
    const k = c.k * c.k * (3 - 2 * c.k);
    return { u: 0.3 - 0.95 * a * k, v: sg * (base + 1.85 * a * k), z: 0.55 + 0.08 * a * smooth(c.k, 0.82, 1), yaw: sg * (0.12 + 0.6 * a * k) };
  }
  const e = easeIO(c.k), arc = Math.sin(Math.PI * c.k);
  return { u: lerp(outU, 0.34 + 0.2 * a, e), v: sg * (lerp(outV, base, e) - 0.18 * a * arc), z: 0.55 + 0.2 * a * arc, yaw: sg * lerp(0.12 + 0.6 * a, -0.04, e) };
}
function strideCross(sg, c, a, sd) {
  // sd: the side the turn bends toward (+1 = his left). The inside leg is sg === sd.
  if (sg === sd) {
    if (c.push) { const k = easeIO(c.k); return { u: 0.15 - 0.3 * k, v: lerp(sd * 0.45, -sd * (0.35 + 0.35 * a), k), z: 0.55, yaw: -sd * 0.2 * k }; }
    const e = easeIO(c.k), arc = Math.sin(Math.PI * c.k);
    return { u: lerp(-0.15, 0.2, e), v: lerp(-sd * (0.35 + 0.35 * a), sd * 0.45, e), z: 0.55 + 0.16 * arc, yaw: 0 };
  }
  if (c.push) { const k = easeIO(c.k); return { u: 0.25 - 0.5 * k, v: sg * (0.4 + (0.9 + 0.3 * a) * k), z: 0.55, yaw: sg * 0.45 * k }; }
  const e = easeIO(c.k), arc = Math.sin(Math.PI * c.k);
  // over the top: lifted, carried across in front of the inside skate, landing on the inside
  return { u: lerp(-0.25, 0.55, e), v: lerp(sg * (1.3 + 0.3 * a), sd * 0.3, e), z: 0.55 + 0.42 * arc, yaw: lerp(sg * 0.45, sd * 0.25, e) };
}
function strideBack(sg, c, a) {
  if (c.push) { const s1 = Math.sin(Math.PI * c.k); return { u: -0.1 + 0.55 * a * c.k, v: sg * (0.5 + 0.85 * a * s1), z: 0.55, yaw: -sg * 0.45 * s1 }; }
  const e = easeIO(c.k), arc = Math.sin(Math.PI * c.k);
  return { u: lerp(-0.1 + 0.55 * a, -0.1, e), v: sg * 0.5, z: 0.55 + 0.08 * arc, yaw: 0 };
}
function strideStart(sg, c) {
  if (c.push) { const k = easeIO(c.k); return { u: 0.25 - 0.45 * k, v: sg * (0.5 + 0.45 * k), z: 0.55, yaw: sg * 0.8 }; }
  const e = easeIO(c.k), arc = Math.sin(Math.PI * c.k);
  return { u: lerp(-0.2, 0.5, e), v: sg * lerp(0.95, 0.5, e), z: 0.55 + 0.38 * arc, yaw: sg * 0.75 };
}
const strideGlide = (sg) => ({ u: 0.2 + sg * 0.28, v: sg * 0.55, z: 0.55, yaw: sg * 0.08 });
const mixFoot = (list) => {
  let u = 0, v = 0, z = 0, yaw = 0, w = 0;
  for (const [f, k] of list) { if (k <= 0) continue; u += f.u * k; v += f.v * k; z += f.z * k; yaw += f.yaw * k; w += k; }
  return w ? { u: u / w, v: v / w, z: z / w, yaw: yaw / w } : { u: 0.2, v: 0.5, z: 0.55, yaw: 0 };
};
// How far into an action its pose has taken over: up fast, back down at the end, so every
// action layers onto the stride and lets go of it again instead of snapping to a pose.
const envelope = (t, inF, outF) => easeIO(clamp(t / inF, 0, 1)) * easeIO(clamp((1 - t) / outF, 0, 1));

function standRig(s, T) {
  const at = s.actT, act = s.act;
  const official = s.kind === 'official' || s.kind === 'medic';
  const toLocal = toLocalFn(s);
  const carrying = !!s.carrying;
  const shot = SHOTS[act], deke = DEKES[act];

  // ── how he is moving ────────────────────────────────────────────────────
  const sp = Math.hypot(s.vx, s.vy);
  const rel = sp > 1 ? angWrapL(Math.atan2(s.vy, s.vx) - s.h) : 0;
  const turn = clamp(s.turnRate || 0, -3, 3);
  const sd = turn >= 0 ? 1 : -1;
  const a = s.amp, P = s.phase * TAU;
  const wBack = official ? 0 : smooth(Math.abs(rel), 1.5, 2.3) * smooth(sp, 1.5, 4);
  const wCross = official ? 0 : (1 - wBack) * smooth(Math.abs(turn), 0.45, 0.9) * smooth(sp, 7, 12);
  const wStart = official ? 0 : (1 - wBack) * (1 - wCross) * smooth(s.effort, 0.75, 0.95) * (1 - smooth(sp, 9, 14)) * smooth(sp, 0.8, 2);
  const wGlide = (1 - wBack) * (1 - smooth(a, 0.05, 0.22)) * smooth(sp, 3, 6);
  const wFwd = Math.max(0, 1 - wBack - wCross - wStart - wGlide);
  const cyc = [legCycle(P), legCycle(P + Math.PI)];             // left, right
  const stridePush = (pushW(cyc[1]) - pushW(cyc[0])) * a * (wFwd + wCross * 0.6 + wStart);   // + while the right leg drives

  // ── body from the stride: weight over the gliding skate, hips dropping on the push ──
  // knees bent with the work, but never into a squat: the stride's share is capped
  let crouch = s.crouch + Math.min(0.55, 0.4 * a * (1 - wBack) + 0.35 * wBack + 0.06 * wCross + 0.12 * wStart + 0.1 * wGlide) + s.duck * 0.5;
  let lean = (official ? 0.08 : 0.24) + 0.42 * a + 0.12 * crouch + 0.3 * wStart - 0.2 * wBack;
  let twist = -0.16 * stridePush;
  let tilt = official ? 0 : clamp(turn * sp * 0.014, -0.42, 0.42);
  let shiftV = 0.36 * stridePush;
  let bob = 0.13 * a * (pushW(cyc[0]) + pushW(cyc[1])) * (1 - wBack);
  let stance = s.stance;
  let yaw = 0, pitch = -0.12;

  // ── action layer ─────────────────────────────────────────────────────────
  // envU: how much the action owns the upper body; envL: the legs. A wrist shot or a pass
  // is taken in stride, so it only half-owns the legs; a slapshot plants him.
  let envU = 0, envL = 0;
  if (act) {
    envU = shot ? envelope(at, 0.04, 0.22) : deke ? envelope(at, 0.06, 0.15) : envelope(at, 0.12, 0.18);
    const planted = act === 'slap' || act === 'onetimer' || act === 'stop' || act === 'block' || act === 'sweep' || act === 'faceoff' || act === 'checkHip';
    const inStride = shot && !planted;
    envL = planted ? envU : inStride ? envU * 0.5 : 0;
  }
  let weight = 0, wShift = 0;
  if (shot) {
    const w = shot.wind, sg2 = shot.bh ? -1 : 1;
    let tw = 0, cr = 0;
    if (at < w) { const k = easeIO(at / w); tw = 0.95 * sg2 * k; cr = 0.35 * k; weight = -k; }
    else if (at < w + 0.15) { const m = (at - w) / 0.15; tw = 0.95 * sg2 * (1 - m) - 0.4 * sg2 * m; cr = 0.35; weight = -1 + 2 * m; }
    else { const m = (at - w - 0.15) / (0.85 - w); tw = -0.4 * sg2 * (1 - m); cr = 0.35 * (1 - m); weight = 1 - m * 0.6; }
    const light = act === 'pass' || act === 'tip' || act === 'drop' || act === 'backpass' || act === 'saucer';
    if (light) { tw *= 0.45; cr -= 0.2; weight *= 0.4; }
    twist += tw * envU; crouch += cr * envU;
    wShift = -0.28 * weight * sg2;
    pitch = lerp(pitch, -0.05, envU);
  }
  if (deke) { twist += 0.3 * Math.sin(at * TAU) * envU; crouch += 0.2 * envU; pitch = -0.35; }
  if (act === 'check' || act === 'checkElbow' || act === 'checkHip') {
    if (at < 0.35) crouch += 0.45 * easeIO(at / 0.35);
    else {
      const m = clamp((at - 0.35) / 0.2, 0, 1), f = 1 - clamp((at - 0.7) / 0.3, 0, 1);
      crouch += 0.45 * (1 - m);
      if (act === 'checkHip') { crouch += 0.7 * m * f; twist += 1.3 * m * f; tilt += 0.35 * m * f; }
      else { lean += 0.4 * m * f; twist -= 0.85 * m * f; }
    }
  }
  if (act === 'block') { const k = bump(at); crouch += 1.2 * k; stance = Math.max(stance, k); lean += 0.2 * k; }
  if (act === 'sweep') { const k = bump(at); crouch += 1.0 * k; stance = Math.max(stance, k); lean += 0.45 * k; twist += 0.9 * Math.sin(at * Math.PI * 2) * k; }
  if (act === 'lift') lean += 0.2 * bump(at);
  if (act === 'faceoff') { crouch += 0.75 * envU; lean += 0.35 * envU; stance = Math.max(stance, 0.9 * envU); pitch = -0.6; }
  if (act === 'stop') { const k = bump(at); crouch += 0.55 * k; lean -= 0.4 * k; tilt += 0.3 * k * (s.actData || 1); }
  if (act === 'poke') lean += 0.35 * bump(at);
  if (act === 'receive') { crouch += 0.15 * envU; pitch = -0.3; }
  if (act === 'brace') { crouch += 0.3 * envU; lean -= 0.1 * envU; }
  if (act === 'cover') { crouch += 1.1; lean += 0.8; }
  if (act === 'slumped') { lean += 0.5; crouch += 0.3; pitch = -0.7; }
  if (carrying && !shot && !deke) {
    const up = Math.sin(T * 0.9 + s.seed) > 0.25;
    pitch = up ? -0.1 : -0.55; yaw = up ? 0.35 * Math.sin(T * 0.7 + s.seed) : 0.2;
    if (s.protect) { tilt += 0.18 * s.protect; lean += 0.15; crouch += 0.15; yaw = -0.5 * s.protect; }
  }
  if (s.guard) { crouch = Math.max(s.crouch, 0.18); lean = 0.12 + 0.2 * crouch; tilt = 0; pitch = 0; shiftV = 0; bob = 0; twist = 0; }
  let pk = 0;
  if (act === 'punchR' || act === 'punchL' || act === 'jab' || act === 'uppercut') {
    pk = act !== 'uppercut'
      ? (at < 0.36 ? easeOut(at / 0.36) : 1 - easeIO((at - 0.36) / 0.64))
      : (at < 0.35 ? -easeIO(at / 0.35) : at < 0.6 ? -1 + 2 * easeOut((at - 0.35) / 0.25) : 1 - easeIO((at - 0.6) / 0.4));
    const side = act === 'punchL' || act === 'jab' ? -1 : 1;
    twist += side * (0.55 * Math.max(0, pk)) - 0.25 * Math.max(0, -pk);
    if (act === 'uppercut') crouch += 0.3 * Math.max(0, -pk) - 0.1 * Math.max(0, pk);
  }
  if (act === 'pull') lean += 0.3 * Math.sin(Math.min(1, at * 1.5) * Math.PI / 2);
  if (act === 'shove' || act === 'break') lean += 0.3 * bump(at);
  if (act === 'stagger') lean -= 0.4 * bump(at);
  lean -= 0.65 * s.react;
  shiftV = lerp(shiftV, wShift, envL);
  if (s.look) {
    const l = toLocal(s.look[0], s.look[1], s.look[2] ?? 1);
    yaw = clamp(Math.atan2(l[1], l[0]) - twist, -1.4, 1.4);
    pitch = clamp(Math.atan2(l[2] - 5.6, Math.hypot(l[0], l[1])), -0.8, 0.3);
  }

  // ── upper body, upright ──────────────────────────────────────────────────
  const zp = 3.45 - 0.64 * crouch - bob;
  const pelvis = [0, shiftV, zp];
  const lsd = [Math.sin(lean), 0, Math.cos(lean)];
  const chest = V.add(pelvis, V.mul(lsd, 1.1)), neck = V.add(pelvis, V.mul(lsd, 2.0));
  // the head rides level: it takes back most of the hip drop and the sideways rock
  const hl = lean * 0.45 - (act === 'slumped' ? 0.6 : 0) + Math.max(-0.3, pitch * 0.35);
  // neck craned, head up and ahead of the shoulders, which is how a skater looks up the ice
  const head = V.add(neck, [Math.sin(hl) * 0.55 + 0.14 * Math.min(1, lean) - s.react * 0.32, Math.sin(yaw) * 0.06 - shiftV * 0.4, Math.cos(hl) * 0.55 + s.react * 0.05 + bob * 0.6]);
  const shL = V.add(neck, rotZ([-0.05, 0.84, -0.24], twist)), shR = V.add(neck, rotZ([-0.05, -0.84, -0.24], twist));
  const hipL = V.add(pelvis, rotZ([0, 0.44, -0.05], -twist * 0.5)), hipR = V.add(pelvis, rotZ([0, -0.44, -0.05], -twist * 0.5));

  // ── hands and stick: a base from the stride, an action blended over it ───
  let L, R, blade = null, flex = 0, stickDir = null, stickFit = null, oneHanded = false;
  if (s.stick && !official) {
    const [bu, bv] = bladeLocal(s, T, carrying);
    // base: blade on the ice ahead, top hand at the hip swinging a little across with the stride
    let bBlade = [bu, bv, 0.08];
    if (carrying && s.puckAt) {
      // the blade goes to the puck, cupping it from his side, wherever it has slid to
      const pl = toLocal(s.puckAt[0], s.puckAt[1], 0), r = Math.hypot(pl[0], pl[1]);
      if (r < 4.2) {
        const k = 0.12 / (r || 1);
        bBlade = [clamp(pl[0] - pl[0] * k, 0.7, 3.5), clamp(pl[1] - pl[1] * k, -2.2, 2.2), 0.06];
      }
    }
    let bR = [0.55 + 0.1 * stridePush, -0.32 + 0.12 * stridePush, zp + 0.72];
    let bL = null;
    const fast = sp > 21 && !carrying ? true : (carrying && sp > 21 && !s.protect);
    if (s.defend && !carrying) {
      const d = toLocal(s.defend[0], s.defend[1], 0), ang = clamp(Math.atan2(d[1], d[0]), -1.0, 1.3);
      bBlade = [Math.cos(ang) * 3.4, Math.sin(ang) * 3.4, 0.05]; bR = [0.9, -0.15, zp + 0.55];
    }
    if (carrying && s.protect) { bR = [0.7, -s.protect * 0.25, zp + 0.55]; bL = [0.6, s.protect * 1.6, zp + 1.3]; }
    if (fast || (s.defend && !carrying)) {
      // one hand on the stick, the other arm swinging across the body with the stride
      if (fast) bR = [0.95, -0.25, zp + 0.55];
      bL = [0.55 + 0.35 * stridePush, 0.95 - 0.75 * Math.max(0, stridePush), zp + 0.35 + 0.25 * Math.abs(stridePush)];
    }
    // action targets
    let aBlade = null, aR = null, aL = null;
    if (shot) {
      const w = shot.wind;
      aBlade = at < w ? V.lerp(bBlade, shot.back, easeIO(at / w)) : at < w + 0.15 ? V.lerp(shot.back, shot.hit, (at - w) / 0.15) : V.lerp(shot.hit, shot.fol, easeOut((at - w - 0.15) / (0.85 - w)));
      aR = shot.bh ? [0.5, 0.25, zp + 0.95] : [0.35, -0.25, zp + 0.95];
      if (at > w && at < w + 0.18) flex = (shot.flex || 0) * bump((at - w) / 0.18);
    } else if (deke) { aBlade = path3(DEKES[act], at); aR = [0.6, -0.2 + aBlade[1] * 0.2, zp + 0.6]; }
    else if (act === 'receive') {
      const from = s.actData ? toLocal(s.actData[0], s.actData[1], 0) : [6, 2, 0];
      const ang = clamp(Math.atan2(from[1], from[0]), -1.2, 1.4), give = at > 0.75 ? (at - 0.75) * 1.6 : 0;
      aBlade = [Math.cos(ang) * (2.4 - give), Math.sin(ang) * 1.6 + 0.4, 0.06]; aR = [0.6, -0.3, zp + 0.55];
    } else if (act === 'onetimerReady') { aBlade = [-0.9, 1.6, 2.6]; aR = [0.3, -0.25, zp + 0.95]; twist += 0.6 * envU; }
    else if (act === 'poke') { const k = bump(at); aBlade = V.lerp(bBlade, [3.7, 0.25, 0.05], k); aR = V.lerp(bR, [1.2, -0.1, zp + 0.5], k); }
    else if (act === 'sweep') { const k = bump(at); aBlade = V.lerp(bBlade, [2.8 * Math.cos(1.2 - at * 2.4), 2.8 * Math.sin(1.2 - at * 2.4), 0.05], k); aR = V.lerp(bR, [1.0, -0.6, zp + 0.1], k); }
    else if (act === 'lift') { const k = bump(at); aBlade = V.lerp([2.6, 0.3, 0.05], [2.2, 0.1, 1.4], k); aR = [0.7, -0.3, zp + 0.9]; }
    else if (act === 'faceoff') { aBlade = [1.9, 0.25, 0.05]; aR = [0.75, -0.2, zp + 0.45]; }
    else if (act === 'block') { const k = bump(at); aBlade = V.lerp(bBlade, [1.4, 1.8, 0.06], k); aR = V.lerp(bR, [1.0, -1.0, zp + 0.2], k); }
    else if ((act === 'check' || act === 'checkElbow') && at > 0.3 && at < 0.9) { const m = bump((at - 0.3) / 0.6); aR = V.lerp(bR, [0.95, -0.4, zp + 1.45], m); aBlade = V.lerp(bBlade, [1.15, 2.4, zp + 1.25], m); }
    else if (act === 'celebrate') {
      // both arms up and the stick held over his head, the way it has always looked
      const k = easeOut(clamp(at * 3, 0, 1)), pump = Math.sin(T * 7) * 0.12 * k;
      aR = V.lerp(bR, [0.3, -0.62, zp + 2.75 + pump], k); aL = V.lerp(bR, [0.3, 0.62, zp + 2.75 + pump], k); aBlade = V.lerp(bBlade, [0.35, -2.9, zp + 3.4 + pump], k);
    }
    else if (act === 'slumped') { aBlade = [1.6, 0.4, 0.06]; aR = [0.6, -0.4, zp + 0.3]; }
    else if (act === 'brace') { aL = [0.9, 0.7, zp + 1.6]; aR = [0.9, -0.5, zp + 1.5]; }
    const ka = (aBlade || aR || aL) ? envU : 0;
    blade = aBlade ? V.lerp(bBlade, aBlade, ka) : bBlade;
    R = aR ? V.lerp(bR, aR, ka) : bR;
    // the bottom hand rides the shaft unless something has taken it off
    const onShaft = V.add(R, V.mul(V.sub(blade, R), shot ? lerp(0.36, 0.28, ka) : 0.36));
    L = aL ? V.lerp(bL || onShaft, aL, ka) : bL ? V.lerp(bL, onShaft, ka) : onShaft;
    // the stick is fitted after the body leans into the turn (below), so the lean can't bend it
    stickFit = {
      oneHand: !!bL && !aL && ka < 0.5, aL: !!aL, ka,
      wantT: shot ? (act === 'slap' || act === 'onetimer' ? 2.1 : act === 'pass' || act === 'saucer' || act === 'drop' ? 1.5 : 1.75) : act === 'faceoff' ? 2.0 : 1.55,
    };
    if (act === 'checkElbow' && at > 0.3 && at < 0.9) { const m = bump((at - 0.3) / 0.6); R = V.lerp(R, [0.2, -0.7, zp + 2.3], m); }
    if (act === 'hug' && s.target) { const t = s.target; L = toLocal(t.x, t.y, 4.6); L[1] += 0.9; R = toLocal(t.x, t.y, 4.4); R[1] -= 0.9; blade = null; }
    if (act === 'brace' && ka > 0.5) blade = null;
  } else if (s.guard || (act && !official) || s.jerseyUp > 0.5) {
    const gb = Math.sin(T * 6.5 + s.seed) * 0.07;
    L = [1.0, 0.36, zp + 1.78 + gb]; R = [0.78, -0.4, zp + 1.58 - gb];
    if (s.grab) L = toLocal(s.grab.x, s.grab.y, 4.35);
    if (pk && s.foe) {
      const tgt = toLocal(s.foe.x, s.foe.y, act === 'uppercut' ? 5.0 : 5.35);
      const left = act === 'punchL' || act === 'jab', k = act === 'jab' ? pk * 0.8 : pk;
      if (left) L = pk >= 0 ? V.lerp(L, tgt, k) : L;
      else R = pk >= 0 ? V.lerp(R, tgt, k) : V.lerp(R, [0.5, -0.4, zp + 0.55], -pk);
    }
    if (act === 'pull' && s.foe) { const k = Math.min(1, at * 1.4); L = toLocal(s.foe.x, s.foe.y, 5.0 - 2.2 * k); L[1] += 0.55; R = toLocal(s.foe.x, s.foe.y, 5.0 - 2.2 * k); R[1] -= 0.55; }
    if (act === 'celebrate') R = [0.4, -0.5, zp + 3.0 + Math.sin(T * 9) * 0.25];
    if (act === 'stagger') { const k = bump(at); L = V.lerp(L, [0.2, 1.6, zp + 1.5], k); R = V.lerp(R, [0.2, -1.6, zp + 1.5], k); }
    if (s.jerseyUp > 0.5) { L = [0.55, 0.6, zp + 2.3 + gb * 3]; R = [0.6, -0.6, zp + 2.2 - gb * 3]; }
  } else {
    // no stick (officials, medics): arms swing across the body with the stride
    L = [0.3 + 0.3 * stridePush, 0.85 - 0.35 * Math.max(0, stridePush), zp - 0.05];
    R = [0.3 - 0.3 * stridePush, -0.85 + 0.35 * Math.max(0, -stridePush), zp - 0.05];
    if (act === 'drop') { const k = at < 0.6 ? easeIO(at / 0.6) : 1; R = V.lerp([0.9, -0.3, zp + 1.2], [1.1, -0.25, zp + 0.35], k); }
    if ((act === 'break' || act === 'shove') && s.target) { const t = s.target; L = toLocal(t.x, t.y, 4.4); L[1] += 0.4; R = toLocal(t.x, t.y, 4.3); R[1] -= 0.4; }
    if (act === 'carry') { L = [1.25, 0.65, zp - 0.5]; R = [1.25, -0.65, zp - 0.5]; }
    if (act === 'point') R = [0.6, -0.5, zp + 2.9];
    if (act === 'washout') { const k = bump(Math.min(1, at * 1.3)); L = V.lerp(L, [0.6, 2.0, zp + 1.2], k); R = V.lerp(R, [0.6, -2.0, zp + 1.2], k); }
  }
  if (act === 'shove' && s.target && s.stick) { const t = s.target; L = toLocal(t.x, t.y, 4.4); L[1] += 0.4; R = toLocal(t.x, t.y, 4.3); R[1] -= 0.4; blade = null; }
  if (s.grab || act === 'pull' || act === 'hug' || act === 'shove' || act === 'break') { L = reach(shL, L, 0.86); R = reach(shR, R, act === 'pull' || act === 'hug' ? 0.86 : 0.95); }
  else if (s.guard) { L = reach(shL, L, 0.8); R = reach(shR, R, pk > 0.6 ? 0.98 : 0.8); }

  // lean into the turn first: the body and the hands' targets roll together about the ice;
  // a blade on the ice stays on it
  const [rPel, rChest, rNeck, rHead, rShL, rShR, rHipL, rHipR] = [pelvis, chest, neck, head, shL, shR, hipL, hipR].map((p) => roll(p, tilt));
  L = roll(L, tilt); R = roll(R, tilt);
  if (blade) { const onIce = blade[2] < 0.3; blade = roll(blade, tilt); if (onIce) blade[2] = 0.06; }
  if (blade && stickFit) {
    // fit the stick: fixed length, top hand at the knob, bottom hand on the shaft
    if (blade[2] < 1.4) { const ko = keepOut(blade[0], blade[1], 0.05); blade = [ko[0], ko[1], blade[2]]; }
    const fit = fitStick(R, blade, rShR, rShL, stickFit.wantT, stickFit.oneHand);
    R = fit.R; blade = fit.blade; stickDir = fit.dir;
    if (!stickFit.oneHand && !stickFit.aL) {
      // no comfortable grip for the bottom hand: it comes off the stick and swings free
      // rather than hovering beside the shaft
      if (fit.L) L = fit.L; else { L = roll([0.55 + 0.35 * stridePush, 0.95, zp + 0.35], tilt); oneHanded = true; }
    } else if (stickFit.aL && stickFit.ka < 1) L = fit.L ? V.lerp(fit.L, L, stickFit.ka) : L;
    if (stickFit.oneHand) oneHanded = true;
  }
  const [rElL, rHL] = ik(rShL, L, 1.12, 1.05, roll([-0.3, 1, -0.8], tilt));
  const [rElR, rHR] = ik(rShR, R, 1.12, 1.05, roll([-0.3, -1, -0.8], tilt));

  // ── legs: the blended stride, then whatever the action wants of them ─────
  const legs = [];
  for (const sg of [1, -1]) {
    const c = cyc[sg > 0 ? 0 : 1];
    let f = mixFoot([[strideForward(sg, c, a), wFwd], [strideCross(sg, c, a, sd), wCross], [strideBack(sg, c, a), wBack], [strideStart(sg, c), wStart], [strideGlide(sg), wGlide]]);
    if (stance) { f.u += sg * 0.38 * stance; f.v = sg * Math.max(Math.abs(f.v), 0.62 + 0.3 * stance); }
    if (envL > 0) {
      let g = null;
      if (shot) {
        // weight from the back skate to the front, the back leg trailing on its toe at the finish
        const front = (shot.bh ? 1 : -1) === sg;
        g = front ? { u: 0.55, v: sg * 0.75, z: 0.55, yaw: sg * 0.5 } : { u: -0.45 - 0.4 * Math.max(0, weight), v: sg * 0.85, z: 0.55 + 0.25 * Math.max(0, weight), yaw: sg * 0.5 };
      } else if (act === 'stop') g = { u: sg * 0.5 + 0.6, v: sg * 0.8, z: 0.55, yaw: sg * 1.4 };
      else if (act === 'block' && sg < 0) g = { u: f.u - 1.0 * bump(at), v: f.v, z: 0.6, yaw: f.yaw };
      else if (act === 'sweep' && sg < 0) g = { u: f.u - 1.2 * bump(at), v: f.v, z: 0.45, yaw: f.yaw };
      else if (act === 'faceoff' || act === 'checkHip') g = { u: 0.15 + sg * 0.3, v: sg * 0.95, z: 0.55, yaw: sg * 0.35 };
      if (g) f = { u: lerp(f.u, g.u, envL), v: lerp(f.v, g.v, envL), z: lerp(f.z, g.z, envL), yaw: lerp(f.yaw, g.yaw, envL) };
    }
    f.v -= tilt * 1.3;                                         // the skates stay under a leaning man
    const [kn, an] = ik(sg > 0 ? rHipL : rHipR, [f.u, f.v, f.z], 1.62, 1.55, [1, sg * 0.3, 0.1]);
    legs.push([kn, an, V.add(an, [0.74 * Math.cos(f.yaw), 0.74 * Math.sin(f.yaw), -0.3])]);
  }

  let butt = null, heel = null, toe = null, bend = null;
  if (blade) {
    const shf = V.sub(blade, rHR);
    butt = V.add(rHR, V.mul(V.norm(shf), -0.28));
    heel = blade;
    const perp = V.norm([-shf[1] * 0.6 + 0.8, shf[0] * 0.6, 0]);
    toe = act === 'celebrate' ? V.add(blade, [0.3, 0.2, 0.7]) : act === 'toedrag' && at > 0.25 && at < 0.6 ? V.add(blade, [0.5, 0.75, 0]) : V.add(blade, V.mul(perp, 0.95));
    if (flex > 0.01) { const mid = V.lerp(butt, heel, 0.55); bend = V.add(mid, [-flex, 0.1 * flex, flex * 0.3]); }
  }
  const out = toWorld(s, [rPel, rChest, rNeck, rHead, rShL, rElL, rHL, rShR, rElR, rHR, rHipL, legs[0][0], legs[0][1], rHipR, legs[1][0], legs[1][1], legs[0][2], legs[1][2], butt, heel, toe]);
  out.meta = { look: dirWorld(s, roll(lookDir(yaw + twist * 0.8, pitch), tilt)), bend: bend ? toWorld(s, [bend])[0] : null, oneHanded };
  return out;
}

const angWrapL = (d) => { d = (d + Math.PI) % TAU; if (d < 0) d += TAU; return d - Math.PI; };

// ── goalies ─────────────────────────────────────────────────────────────────
// The stance is the base: crouched, weight on the balls of the feet, glove open at the hip,
// blocker at the side, paddle covering the five-hole, head on the puck. Lateral movement
// reads off his own sideways speed (small shuffles, or a T-push when he has to get across),
// and saves are actions on top:
//
//   butterfly · bslide (sliding butterfly) · rvh (post seal) · kick (stand-up kick save)
//   stack (two-pad stack) · glove (gloveTarget) · blocker · chest · poke · dive · cover
//   recover (up from the butterfly) · playPuck · pass · stretch · drink · tapPosts · slump
//   celebrate · screen (leaning to see round a man)
//
// `actData` carries a side (±1, positive is his glove side) for the moves that have one.
export function goalieRig(g, T) {
  if (g.rag) return g.rag.pts.map((p) => [p.x, p.y, p.z]);
  const act = g.act, at = g.actT, side = g.actData || 1;
  const toLocal = toLocalFn(g);
  // how fast he is moving across his own crease
  const ch = Math.cos(g.h), sn = Math.sin(g.h);
  const lat = -(g.vx || 0) * sn + (g.vy || 0) * ch;
  const tpush = Math.abs(lat) > 7 && !act;
  const shuffle = !tpush && Math.abs(lat) > 1.2 && !act;
  let bf = g.bfly;
  if (act === 'butterfly' || act === 'bslide' || act === 'pad' || act === 'cover') bf = Math.max(bf, easeOut(clamp(at * 3, 0, 1)));
  if (act === 'recover') bf = 1 - easeIO(at);
  if (act === 'dive' || act === 'rvh') bf = Math.max(bf, 0.6);
  let zp = lerp(2.3, 1.3, bf);
  let lean = 0.42 + 0.1 * bf, tilt = 0, twist = 0;
  let yaw = 0, pitch = -0.2;
  if (g.track) { const l = toLocal(g.track[0], g.track[1], g.track[2] ?? 0.2); yaw = clamp(Math.atan2(l[1], l[0]), -1.1, 1.1); pitch = clamp(Math.atan2(l[2] - 4.6, Math.hypot(l[0], l[1])), -0.9, 0.4); }
  if (act === 'cover') { lean += 0.75 * Math.min(1, at * 2); pitch = -1.0; }
  if (act === 'slump') { lean += 0.45 + 0.15 * Math.sin(at * 3); pitch = -0.8; }
  if (act === 'chest') lean -= 0.25 * bump(at);
  if (act === 'screen') { tilt = side * 0.35 * bump(Math.min(1, at * 1.5)); }
  if (act === 'stretch') { tilt = 0.4 * Math.sin(at * TAU * 2); zp -= 0.6 * Math.max(0, Math.sin(at * TAU)); }
  if (act === 'drink') { lean -= 0.15 * bump(at); pitch = 0.5 * bump(at); }
  if (act === 'celebrate') { lean = 0.1; zp = 2.9; }
  if (act === 'kick') { tilt = -side * 0.3 * bump(at); }
  if (act === 'rvh') { tilt = side * 0.35; lean += 0.15; }
  if (tpush) { twist = 0; zp += 0.15; }
  const pelvis = [0, 0, zp], sd = [Math.sin(lean), 0, Math.cos(lean)];
  const chest = V.add(pelvis, V.mul(sd, 1.0)), neck = V.add(pelvis, V.mul(sd, 1.8));
  const head = V.add(neck, [0.18 - (act === 'slump' ? 0.25 : 0) + Math.min(0, pitch) * 0.12, Math.sin(yaw) * 0.08, 0.55 - (act === 'slump' ? 0.12 : 0)]);
  const shL = V.add(neck, rotZ([0, 1.08, -0.25], twist)), shR = V.add(neck, rotZ([0, -1.08, -0.25], twist));
  const hipL = [0, 0.55, zp - 0.05], hipR = [0, -0.55, zp - 0.05];

  // hands: glove left, blocker and stick right
  let L = [1.0, 1.42, zp + 0.25], R = [1.05, -1.3, zp - 0.1];
  let blade = [2.35, -0.35, 0.08], toeOff = [0.1, 1.35, 0];
  if (g.gloveW > 0 && g.gloveTarget) L = V.lerp(L, toLocal(...g.gloveTarget), g.gloveW);
  if (act === 'butterfly' || act === 'bslide') { L = [1.1, 1.65, 2.0]; R = [1.1, -1.55, 1.7]; blade = [1.9, 0.0, 0.06]; toeOff = [0.05, 1.3, 0]; }
  if (act === 'cover') { L = [1.3, 0.35, 0.5]; R = [1.3, -0.35, 0.6]; }
  if (act === 'slump') { L = [0.6, 0.9, zp - 0.5]; R = [0.6, -0.9, zp - 0.6]; }
  if (act === 'chest') { const k = bump(at); L = V.lerp(L, [0.9, 0.5, zp + 1.0], k); R = V.lerp(R, [0.9, -0.5, zp + 0.9], k); }
  if (act === 'blocker') { const k = bump(at); const hi = g.actData2 || 1.0; R = V.lerp(R, [1.0, -2.1, zp + hi], k); }
  if (act === 'poke') { const k = bump(at); blade = V.lerp(blade, [4.6, -0.2, 0.05], k); R = V.lerp(R, [1.8, -0.6, zp - 0.5], k); }
  if (act === 'rvh') { L = [0.8, 1.5 * side, 2.2]; R = [0.9, -0.9 * side, 1.9]; blade = [1.6, -0.2 * side, 0.06]; }
  if (act === 'stack') { L = [0.3, 0.9, zp + 2.2]; R = [0.9, -0.5, zp - 1.1]; blade = [1.2, -0.4, 0.3]; toeOff = [0.4, -0.9, 0]; }
  if (act === 'playPuck' || act === 'pass') {
    const k = act === 'pass' ? bump(at) : 0;
    const sw = act === 'playPuck' ? Math.sin(T * 4) * 0.6 : 0;
    R = [0.9, -0.6, zp + 0.5]; blade = [2.4 - 0.8 * k, 0.2 + sw - 1.0 * k, 0.06]; zp += 0.2;
  }
  if (act === 'drink') { L = V.lerp(L, [0.75, 0.15, zp + 2.55], bump(at)); }
  if (act === 'tapPosts') {
    const ph = at < 0.5 ? 1 : -1, k = bump((at % 0.5) * 2);
    blade = V.lerp(blade, [0.2, ph * 2.6, 1.0], k); R = V.lerp(R, [0.4, ph * 1.2, zp + 0.3], k);
  }
  if (act === 'celebrate') { L = [0.3, 1.0, zp + 3.0]; R = [0.3, -1.0, zp + 3.0]; blade = [0.6, -0.6, zp + 6]; }
  if (act === 'dive') { L = [0.6, 2.4 * side, zp + 1.2]; R = [1.0, 2.0 * side, zp + 0.4]; blade = [1.0, 3.2 * side, 0.06]; toeOff = [0.6, 0.6 * side, 0]; }
  if (act === 'stretch') { L = [0.5, 1.4, zp + 1.6]; R = [0.5, -1.4, zp + 1.6]; }

  const [elL, hL] = ik(shL, L, 1.1, 1.05, [-0.4, 1, -0.6]);
  const [elR, hR] = ik(shR, R, 1.1, 1.05, [-0.4, -1, -0.6]);
  let upper = [pelvis, chest, neck, head, shL, elL, hL, shR, elR, hR, hipL, hipR].map((p) => roll(p, tilt));
  const [rPel, rChest, rNeck, rHead, rShL, rElL, rHL, rShR, rElR, rHR, rHipL, rHipR] = upper;

  // legs
  const legs = [];
  for (const sg of [1, -1]) {
    let kn, an;
    const hip = sg > 0 ? rHipL : rHipR;
    const standKnee = (ank) => ik(hip, ank, 1.5, 1.45, [1, -sg * 0.7, 0]);
    if (act === 'rvh' && sg === side) { kn = [0.5, sg * 0.7, 0.4]; an = [-0.4, sg * 2.3, 0.3]; }        // pad flat along the ice to the post
    else if (act === 'kick' && sg === side) { const k = bump(at); [kn, an] = standKnee(V.lerp([0.25, sg * 1.25, 0.5], [0.4, sg * 2.8, 0.55], k)); }
    else if (act === 'bslide' && sg === side) { kn = [0.75, sg * 0.75, 0.42]; an = [-0.4, sg * 2.5, 0.32]; }
    // the stack is built standing, legs straight and together, then the whole man is rolled
    // onto his side below, which lays one pad on top of the other along the ice
    else if (act === 'stack') { kn = [0.25, sg * 0.32, zp * 0.5]; an = [0.15, sg * 0.32, 0.45]; }
    else if (act === 'recover' && sg === -side) { [kn, an] = standKnee([0.4, sg * 1.2, 0.5]); }
    else {
      let ank = [0.25, sg * 1.25, 0.5];
      if (shuffle) { const q = Math.sin(T * 9 + (sg > 0 ? 0 : Math.PI)); ank = [0.25, sg * 1.25 + Math.sign(lat) * 0.25 * q, 0.5 + 0.12 * Math.max(0, q)]; }
      if (tpush) {
        // T-push: the lead skate turns to point where he's going, the back leg drives
        const lead = Math.sign(lat) === sg;
        ank = lead ? [0.3, sg * 1.0, 0.5] : [0.0, sg * 2.0, 0.5];
      }
      const [kn0, an0] = standKnee(ank);
      kn = V.lerp(kn0, [0.85, sg * 0.6, 0.45], bf); an = V.lerp(an0, [-0.55, sg * 2.0, 0.35], bf);
    }
    const lead = tpush && Math.sign(lat) === sg;
    const toeD = lead ? [0.05, sg * 0.8, -0.3] : [0.8, sg * 0.25, -0.3];
    legs.push([kn, an, V.add(an, toeD)]);
  }
  if (act === 'stack') {
    // the whole man laid on his side, pads stacked toward the shooter's side
    const k = easeOut(clamp(at * 2.5, 0, 1)), ang = side * 1.45 * k;
    const all = [rPel, rChest, rNeck, rHead, rShL, rElL, rHL, rShR, rElR, rHR, rHipL, legs[0][0], legs[0][1], rHipR, legs[1][0], legs[1][1], legs[0][2], legs[1][2]];
    const c = Math.cos(ang), s2 = Math.sin(ang);
    for (const p of all) { const y = p[1], z = p[2]; p[1] = y * c - (z - 0.4) * s2; p[2] = y * s2 + (z - 0.4) * c + 0.4; }
    for (const p of [blade]) { const y = p[1], z = p[2]; p[1] = y * c - (z - 0.4) * s2; p[2] = Math.max(0.06, y * s2 + (z - 0.4) * c + 0.4); }
  }
  const butt = V.add(rHR, V.mul(V.norm(V.sub(blade, rHR)), -0.3));
  const toe = V.add(blade, toeOff);
  let loc = [rPel, rChest, rNeck, rHead, rShL, rElL, rHL, rShR, rElR, rHR, rHipL, legs[0][0], legs[0][1], rHipR, legs[1][0], legs[1][1], legs[0][2], legs[1][2], butt, blade, toe];
  if (act === 'dive') {
    // laid out across the crease toward `side`, then dropped onto the ice
    const k = easeOut(clamp(at * 2.2, 0, 1)), ang = side * 1.25 * k;
    const c = Math.cos(ang), s2 = Math.sin(ang);
    loc = loc.map((p) => [p[0], p[1] * c - (p[2] - 0.4) * s2 + side * 1.2 * k, p[1] * s2 + (p[2] - 0.4) * c + 0.4]);
  }
  const lo = Math.min(...loc.map((p) => p[2]));
  if (lo < 0.22) loc = loc.map((p) => [p[0], p[1], p[2] + 0.22 - lo]);
  const out = toWorld(g, loc);
  out.meta = {
    look: dirWorld(g, roll(lookDir(yaw, pitch), tilt)),
    bottle: act === 'drink' && at > 0.15 && at < 0.85 ? toWorld(g, [V.add(L, [0.25, 0, 0.1])])[0] : null,
  };
  return out;
}

// ── ragdolls ─────────────────────────────────────────────────────────────────
const BONES = [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 6], [2, 7], [7, 8], [8, 9], [0, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [12, 16], [15, 17]];
const BRACE = [[4, 7], [10, 13], [4, 10], [7, 13], [4, 13], [7, 10], [1, 4], [1, 7], [0, 4], [0, 7], [3, 4], [3, 7], [1, 3], [11, 16], [14, 17], [0, 2], [10, 12], [13, 15]];

// impU/impL: velocity added to the upper and lower body (ft/s). A hit that drives the
// shoulders harder than the skates is what tips a man over instead of sliding him.
export function makeRag(s, J, impU, impL) {
  const pts = [];
  for (let i = 0; i < 18; i++) {
    const j = J[i], imp = i <= 9 ? impU : impL, k = i === 3 ? 1.15 : 1;
    const vx = s.vx + imp[0] * k, vy = s.vy + imp[1] * k, vz = imp[2] * k;
    pts.push({ x: j[0], y: j[1], z: j[2], px: j[0] - vx * DT, py: j[1] - vy * DT, pz: j[2] - vz * DT, r: i === 3 ? 0.45 : 0.24 });
  }
  const cons = [...BONES, ...BRACE].map(([a, b]) => [a, b, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y, pts[a].z - pts[b].z)]);
  return { pts, cons, age: 0, lastHit: -1, poolAt: 0, smearAt: 0, still: 0 };
}
// Returns the hardest wall impact this step as { x, y, z, speed } or null.
export function stepRag(r, dt) {
  r.age += dt;
  for (const p of r.pts) {
    const vx = (p.x - p.px) * 0.999, vy = (p.y - p.py) * 0.999, vz = (p.z - p.pz) * 0.999;
    p.px = p.x; p.py = p.y; p.pz = p.z; p.x += vx; p.y += vy; p.z += vz - G * dt * dt;
  }
  let hit = null;
  for (let it = 0; it < 6; it++) {
    for (const [a, b, l] of r.cons) {
      const A = r.pts[a], B = r.pts[b];
      let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
      const d = Math.hypot(dx, dy, dz) || 1e-6, k = (d - l) / d * 0.5;
      dx *= k; dy *= k; dz *= k; A.x += dx; A.y += dy; A.z += dz; B.x -= dx; B.y -= dy; B.z -= dz;
    }
    for (const p of r.pts) {
      if (p.z < p.r) { p.z = p.r; if (p.pz < p.z) p.pz = p.z; }
      if (p.z < GLASS_H + 0.2) {
        const c = insideRink(p.x, p.y, p.r);
        if (c) {
          const vx = p.x - p.px, vy = p.y - p.py, vn = vx * c.nx + vy * c.ny;
          p.x = c.x; p.y = c.y;
          if (vn < 0) {
            const sp = -vn / dt;
            if (!hit || sp > hit.speed) hit = { x: p.x, y: p.y, z: p.z, speed: sp };
            p.px = p.x - (vx - 1.3 * vn * c.nx); p.py = p.y - (vy - 1.3 * vn * c.ny);
          }
        }
      }
    }
  }
  let moving = 0;
  for (const p of r.pts) {
    if (p.z <= p.r + 0.03) { p.px = lerp(p.px, p.x, 0.03); p.py = lerp(p.py, p.y, 0.03); }
    moving += Math.abs(p.x - p.px) + Math.abs(p.y - p.py) + Math.abs(p.z - p.pz);
  }
  r.still = moving / dt < 3 ? r.still + dt : 0;
  if (hit && (hit.speed < 7 || r.age - r.lastHit < 0.25)) hit = null;
  if (hit) r.lastHit = r.age;
  return hit;
}

// ── severed parts ────────────────────────────────────────────────────────────
// A limb that comes off is a short chain of verlet points of its own, thrown from where it
// was attached. Same integrator idea as the ragdoll, so it slides, tumbles off the boards
// and comes to rest where friction leaves it; meat glides far worse than rubber.
export const SEVER = {
  armL: [5, 6], armR: [8, 9], legL: [11, 12, 16], legR: [14, 15, 17], head: [3],
};
export function makeLimb(part, J, vel) {
  const idx = SEVER[part] || [];
  const pts = idx.map((i, k) => ({ x: J[i][0], y: J[i][1], z: Math.max(0.2, J[i][2]), px: 0, py: 0, pz: 0, r: part === 'head' ? 0.45 : 0.2 }));
  // a little spin on the throw, so it doesn't fly off as a rigid stick
  pts.forEach((p, k) => { const sv = 1 + k * 0.35; p.px = p.x - vel[0] * sv * DT; p.py = p.y - vel[1] * sv * DT; p.pz = p.z - vel[2] * DT; });
  const cons = [];
  for (let i = 0; i + 1 < pts.length; i++) cons.push([i, i + 1, Math.hypot(pts[i].x - pts[i + 1].x, pts[i].y - pts[i + 1].y, pts[i].z - pts[i + 1].z)]);
  return { part, pts, cons, age: 0, spin: (Math.random() - 0.5) * 18, rot: 0 };
}
export function stepLimb(l, dt) {
  l.age += dt;
  for (const p of l.pts) {
    const vx = (p.x - p.px) * 0.998, vy = (p.y - p.py) * 0.998, vz = (p.z - p.pz) * 0.998;
    p.px = p.x; p.py = p.y; p.pz = p.z; p.x += vx; p.y += vy; p.z += vz - G * dt * dt;
  }
  for (let it = 0; it < 3; it++) {
    for (const [a, b, len] of l.cons) {
      const A = l.pts[a], B = l.pts[b];
      let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
      const d = Math.hypot(dx, dy, dz) || 1e-6, k = (d - len) / d * 0.5;
      dx *= k; dy *= k; dz *= k; A.x += dx; A.y += dy; A.z += dz; B.x -= dx; B.y -= dy; B.z -= dz;
    }
    for (const p of l.pts) {
      if (p.z < p.r) { p.z = p.r; if (p.pz < p.z) p.pz = p.z + (p.z - p.pz) * 0.35; }
      const c = insideRink(p.x, p.y, p.r);
      if (c && p.z < GLASS_H) { const vx = p.x - p.px, vy = p.y - p.py, vn = vx * c.nx + vy * c.ny; p.x = c.x; p.y = c.y; if (vn < 0) { p.px = p.x - (vx - 1.5 * vn * c.nx); p.py = p.y - (vy - 1.5 * vn * c.ny); } }
    }
  }
  let onIce = false;
  for (const p of l.pts) if (p.z <= p.r + 0.03) { p.px = lerp(p.px, p.x, 0.045); p.py = lerp(p.py, p.y, 0.045); onIce = true; }
  l.spin *= onIce ? Math.exp(-dt * 3) : 1;
  l.rot += l.spin * dt;
  return onIce;
}
