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

// Shots: blade wound back to `back`, through the puck at `hit`, out to `fol`. `wind` is the
// fraction of the action spent loading; the puck leaves at `release`.
export const SHOTS = {
  slap:     { wind: 0.55, back: [-1.7, 1.6, 3.9], hit: [1.45, 1.0, 0.08], fol: [3.0, 0.3, 3.5], dur: 0.7 },
  onetimer: { wind: 0.32, back: [-1.1, 1.5, 3.0], hit: [1.5, 1.0, 0.08], fol: [3.0, 0.3, 3.2], dur: 0.45 },
  wrist:    { wind: 0.45, back: [-0.6, 1.3, 0.25], hit: [1.6, 0.9, 0.1], fol: [2.8, 0.4, 2.2], dur: 0.5 },
  snap:     { wind: 0.3, back: [0.2, 1.2, 1.0], hit: [1.5, 0.9, 0.08], fol: [2.6, 0.4, 1.6], dur: 0.4 },
  backhand: { wind: 0.4, back: [-0.2, -1.3, 0.5], hit: [1.4, -0.7, 0.1], fol: [2.2, -0.4, 2.6], dur: 0.5 },
  tip:      { wind: 0.2, back: [1.8, 0.8, 0.6], hit: [2.2, 0.6, 0.5], fol: [2.4, 0.5, 0.9], dur: 0.3 },
  wrap:     { wind: 0.35, back: [-0.8, 1.4, 0.2], hit: [0.6, 1.6, 0.08], fol: [1.8, 1.0, 1.2], dur: 0.5 },
  pass:     { wind: 0.35, back: [0.7, 1.45, 0.1], hit: [1.9, 0.7, 0.08], fol: [2.5, 0.4, 0.5], dur: 0.32 },
  dump:     { wind: 0.4, back: [-0.2, 1.4, 0.6], hit: [1.5, 0.9, 0.08], fol: [2.8, 0.4, 2.0], dur: 0.45 },
};
export const releaseAt = (type) => { const s = SHOTS[type] || SHOTS.wrist; return s.dur * (s.wind + 0.08); };

export function bladeLocal(s, T, carrying) {
  return carrying
    ? [2.45 + 0.25 * Math.cos(T * 5.1 + s.seed * 1.7), 0.85 + 0.5 * Math.sin(T * 7.3 + s.seed)]
    : [2.3, 0.75 + 0.18 * Math.sin(s.phase * TAU)];
}
export function bladeWorld(s, T, carrying) {
  const [u, v] = bladeLocal(s, T, carrying), c = Math.cos(s.h), n = Math.sin(s.h);
  return [s.x + u * c - v * n, s.y + u * n + v * c];
}

const toLocalFn = (s) => { const ch = Math.cos(s.h), sn = Math.sin(s.h); return (X, Y, Z) => { const dx = X - s.x, dy = Y - s.y; return [dx * ch + dy * sn, -dx * sn + dy * ch, Z]; }; };
const toWorld = (s, loc) => { const ch = Math.cos(s.h), sn = Math.sin(s.h); return loc.map((p) => (p ? [s.x + p[0] * ch - p[1] * sn, s.y + p[0] * sn + p[1] * ch, p[2]] : null)); };

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

function standRig(s, T) {
  const at = s.actT, act = s.act;
  const official = s.kind === 'official' || s.kind === 'medic';
  const a = s.amp, P = s.phase * TAU;
  let crouch = s.crouch + 0.22 * a + s.duck * 0.5;
  let lean = (official ? 0.08 : 0.2) + 0.38 * a + 0.18 * crouch;
  let twist = -0.28 * a * Math.sin(P);
  let stance = s.stance, tilt = 0;
  const shot = SHOTS[act];
  if (shot) {
    const w = shot.wind;
    if (at < w) { const k = easeIO(at / w); twist += (act === 'backhand' ? -0.8 : 0.95) * k; crouch += 0.35 * k; }
    else if (at < w + 0.15) { const m = (at - w) / 0.15; twist += (act === 'backhand' ? -0.8 : 0.95) * (1 - m) - 0.4 * m; crouch += 0.35; }
    else { const m = (at - w - 0.15) / (0.85 - w); twist -= 0.4 * (1 - m); crouch += 0.35 * (1 - m); }
    if (act === 'pass' || act === 'tip') { twist *= 0.4; crouch -= 0.2; }
  }
  if (act === 'check' || act === 'checkElbow' || act === 'checkHip') {
    if (at < 0.35) crouch += 0.45 * easeIO(at / 0.35);
    else {
      const m = clamp((at - 0.35) / 0.2, 0, 1), f = 1 - clamp((at - 0.7) / 0.3, 0, 1);
      crouch += 0.45 * (1 - m);
      if (act === 'checkHip') { crouch += 0.7 * m * f; twist += 1.3 * m * f; tilt = 0.35 * m * f; }
      else { lean += 0.4 * m * f; twist -= 0.85 * m * f; }
    }
  }
  if (act === 'block') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); crouch += 1.2 * k; stance = Math.max(stance, k); lean += 0.2 * k; }
  if (act === 'faceoff') { crouch += 0.75; lean += 0.35; stance = Math.max(stance, 0.9); }
  if (act === 'stop') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); crouch += 0.55 * k; lean -= 0.35 * k; stance = Math.max(stance, 0.7 * k); }
  if (act === 'poke') { lean += 0.35 * Math.sin(clamp(at, 0, 1) * Math.PI); }
  if (act === 'cover') { crouch += 1.1; lean += 0.8; }
  if (act === 'slumped') { lean += 0.5; crouch += 0.3; }
  if (s.guard) { crouch = Math.max(crouch, 0.18); lean = 0.12 + 0.2 * crouch; }
  let pk = 0;
  if (act === 'punchR' || act === 'punchL' || act === 'jab' || act === 'uppercut') {
    pk = act !== 'uppercut'
      ? (at < 0.36 ? easeOut(at / 0.36) : 1 - easeIO((at - 0.36) / 0.64))
      : (at < 0.35 ? -easeIO(at / 0.35) : at < 0.6 ? -1 + 2 * easeOut((at - 0.35) / 0.25) : 1 - easeIO((at - 0.6) / 0.4));
    const sideSign = act === 'punchL' || act === 'jab' ? -1 : 1;
    twist += sideSign * (0.55 * Math.max(0, pk)) - 0.25 * Math.max(0, -pk);
    if (act === 'uppercut') crouch += 0.3 * Math.max(0, -pk) - 0.1 * Math.max(0, pk);
  }
  if (act === 'pull') lean += 0.3 * Math.sin(Math.min(1, at * 1.5) * Math.PI / 2);
  if (act === 'shove' || act === 'break') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); lean += 0.3 * k; }
  if (act === 'stagger') { lean -= 0.4 * Math.sin(clamp(at, 0, 1) * Math.PI); }
  lean -= 0.65 * s.react;
  const zp = 3.3 - 0.62 * crouch;
  const pelvis = [0, 0, zp];
  const sd = [Math.sin(lean), Math.sin(tilt), Math.cos(lean)];
  const chest = V.add(pelvis, V.mul(sd, 1.1)), neck = V.add(pelvis, V.mul(sd, 2.0));
  const hl = lean * 0.45 - (act === 'slumped' ? 0.6 : 0);
  const head = V.add(neck, [Math.sin(hl) * 0.55 - s.react * 0.32, 0, Math.cos(hl) * 0.55 + s.react * 0.05]);
  const shL = V.add(neck, rotZ([-0.05, 1.1, -0.26], twist)), shR = V.add(neck, rotZ([-0.05, -1.1, -0.26], twist));
  const hipL = V.add(pelvis, rotZ([0, 0.55, -0.05], -twist * 0.4)), hipR = V.add(pelvis, rotZ([0, -0.55, -0.05], -twist * 0.4));
  const legs = [];
  const stopping = act === 'stop';
  for (const sg of [1, -1]) {
    const p = P + (sg > 0 ? 0 : Math.PI);
    let fu = 0.15 + 0.78 * a * Math.cos(p);
    let fv = sg * (0.68 + 0.3 * stance + 0.55 * a * (1 - Math.cos(p)) / 2);
    let fz = 0.55 + 0.38 * a * Math.max(0, -Math.sin(p));
    if (stance) fu += sg * 0.38 * stance;
    if (stopping) { fu = sg * 0.5 + 0.6; fv = sg * 0.8; fz = 0.55; }
    if (act === 'block' && sg < 0) { fu -= 1.0 * Math.sin(clamp(at, 0, 1) * Math.PI); fz = 0.6; }
    const [kn, an] = ik(sg > 0 ? hipL : hipR, [fu, fv, fz], 1.55, 1.5, [1, sg * 0.25, 0.1]);
    const yaw = stopping ? sg * 1.4 : sg * (0.22 + 0.35 * a * Math.max(0, Math.sin(p)));
    legs.push([kn, an, V.add(an, [0.95 * Math.cos(yaw), 0.95 * Math.sin(yaw), -0.32])]);
  }
  const toLocal = toLocalFn(s);
  let L, R, blade = null;
  const carrying = !!s.carrying;
  if (s.stick && !official) {
    const [bu, bv] = bladeLocal(s, T, carrying);
    blade = [bu, bv, 0.08];
    R = [0.55 + 0.22 * a * Math.sin(P), -0.32, zp + 0.72];
    if (shot) {
      const w = shot.wind;
      blade = at < w ? V.lerp(blade, shot.back, easeIO(at / w)) : at < w + 0.15 ? V.lerp(shot.back, shot.hit, (at - w) / 0.15) : V.lerp(shot.hit, shot.fol, easeOut((at - w - 0.15) / (0.85 - w)));
      R = act === 'backhand' ? [0.5, 0.25, zp + 0.95] : [0.35, -0.25, zp + 0.95];
    }
    if (act === 'poke') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); blade = V.lerp(blade, [3.7, 0.25, 0.05], k); R = V.lerp(R, [1.2, -0.1, zp + 0.5], k); }
    if (act === 'faceoff') { blade = [1.9, 0.25, 0.05]; R = [0.75, -0.2, zp + 0.45]; }
    if (act === 'block') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); blade = V.lerp(blade, [1.4, 1.8, 0.06], k); R = V.lerp(R, [1.0, -1.0, zp + 0.2], k); }
    if ((act === 'check' || act === 'checkElbow') && at > 0.3 && at < 0.9) {
      const m = Math.sin(clamp((at - 0.3) / 0.6, 0, 1) * Math.PI);
      R = V.lerp(R, [0.95, -0.4, zp + 1.45], m); blade = V.lerp(blade, [1.15, 2.4, zp + 1.25], m);
    }
    if (act === 'celebrate') { const k = easeOut(clamp(at * 3, 0, 1)); R = V.lerp(R, [0.45, -0.55, zp + 2.9], k); blade = V.lerp(blade, [0.9, 0.4, zp + 6.2], k); }
    if (act === 'slumped') { blade = [1.6, 0.4, 0.06]; R = [0.6, -0.4, zp + 0.3]; }
    L = V.add(R, V.mul(V.sub(blade, R), shot ? 0.28 : 0.36));
    if (act === 'checkElbow' && at > 0.3 && at < 0.9) {
      // the elbow comes up: right hand off the stick, elbow levelled at the victim's head
      const m = Math.sin(clamp((at - 0.3) / 0.6, 0, 1) * Math.PI);
      R = V.lerp(R, [0.2, -0.7, zp + 2.3], m);
    }
    if (act === 'hug' && s.target) { const t = s.target; L = toLocal(t.x, t.y, 4.6); L[1] += 0.9; R = toLocal(t.x, t.y, 4.4); R[1] -= 0.9; blade = null; }
  } else if (s.guard || (act && !official) || s.jerseyUp > 0.5) {
    const bob = Math.sin(T * 6.5 + s.seed) * 0.07;
    L = [1.0, 0.36, zp + 1.78 + bob]; R = [0.78, -0.4, zp + 1.58 - bob];
    if (s.grab) L = toLocal(s.grab.x, s.grab.y, 4.35);
    if (pk && s.foe) {
      const tgt = toLocal(s.foe.x, s.foe.y, act === 'uppercut' ? 5.0 : 5.35);
      const left = act === 'punchL' || act === 'jab';
      const k = act === 'jab' ? pk * 0.8 : pk;
      if (left) L = pk >= 0 ? V.lerp(L, tgt, k) : L;
      else R = pk >= 0 ? V.lerp(R, tgt, k) : V.lerp(R, [0.5, -0.4, zp + 0.55], -pk);
    }
    if (act === 'pull' && s.foe) {
      const k = Math.min(1, at * 1.4);
      L = toLocal(s.foe.x, s.foe.y, 5.0 - 2.2 * k); L[1] += 0.55; R = toLocal(s.foe.x, s.foe.y, 5.0 - 2.2 * k); R[1] -= 0.55;
    }
    if (act === 'celebrate') R = [0.4, -0.5, zp + 3.0 + Math.sin(T * 9) * 0.25];
    if (act === 'stagger') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); L = V.lerp(L, [0.2, 1.6, zp + 1.5], k); R = V.lerp(R, [0.2, -1.6, zp + 1.5], k); }
    if (s.jerseyUp > 0.5) { L = [0.55, 0.6, zp + 2.3 + bob * 3]; R = [0.6, -0.6, zp + 2.2 - bob * 3]; }
  } else if (official || !s.stick) {
    const sw = 0.3 * a * Math.sin(P);
    L = [0.25 - sw, 0.85, zp - 0.1]; R = [0.25 + sw, -0.85, zp - 0.1];
    if (act === 'drop') { const k = at < 0.6 ? easeIO(at / 0.6) : 1; R = V.lerp([0.9, -0.3, zp + 1.2], [1.1, -0.25, zp + 0.35], k); }
    if ((act === 'break' || act === 'shove') && s.target) { const t = s.target; L = toLocal(t.x, t.y, 4.4); L[1] += 0.4; R = toLocal(t.x, t.y, 4.3); R[1] -= 0.4; }
    if (act === 'carry') { L = [1.25, 0.65, zp - 0.5]; R = [1.25, -0.65, zp - 0.5]; }
    if (act === 'point') R = [0.6, -0.5, zp + 2.9];
  }
  if (act === 'shove' && s.target && s.stick) { const t = s.target; L = toLocal(t.x, t.y, 4.4); L[1] += 0.4; R = toLocal(t.x, t.y, 4.3); R[1] -= 0.4; blade = null; }
  const [elL, hL] = ik(shL, L, 1.15, 1.1, [-0.3, 1, -0.8]);
  const [elR, hR] = ik(shR, R, 1.15, 1.1, [-0.3, -1, -0.8]);
  let butt = null, heel = null, toe = null;
  if (blade) {
    const sh = V.sub(blade, hR);
    butt = V.add(hR, V.mul(V.norm(sh), -0.4));
    heel = blade;
    const perp = V.norm([-sh[1] * 0.6 + 0.8, sh[0] * 0.6, 0]);
    toe = act === 'celebrate' ? V.add(blade, [0.3, 0.2, 0.7]) : V.add(blade, V.mul(perp, 0.95));
  }
  return toWorld(s, [pelvis, chest, neck, head, shL, elL, hL, shR, elR, hR, hipL, legs[0][0], legs[0][1], hipR, legs[1][0], legs[1][1], legs[0][2], legs[1][2], butt, heel, toe]);
}

// ── goalies ─────────────────────────────────────────────────────────────────
// Actions: 'glove' (reaching for gloveTarget), 'pad' (butterfly), 'chest', 'poke',
// 'dive' (actData = side, ±1, across his body), 'cover', 'slump'.
export function goalieRig(g, T) {
  if (g.rag) return g.rag.pts.map((p) => [p.x, p.y, p.z]);
  const act = g.act, at = g.actT;
  let bf = g.bfly;
  if (act === 'pad' || act === 'cover') bf = Math.max(bf, Math.sin(clamp(at * 1.6, 0, 1) * Math.PI / 2));
  if (act === 'dive') bf = Math.max(bf, 0.6);
  const zp = lerp(2.35, 1.35, bf);
  let lean = 0.4 + 0.1 * bf;
  if (act === 'cover') lean += 0.7 * Math.min(1, at * 2);
  if (act === 'slump') lean += 0.45;
  if (act === 'chest') lean -= 0.25 * Math.sin(clamp(at, 0, 1) * Math.PI);
  const pelvis = [0, 0, zp], sd = [Math.sin(lean), 0, Math.cos(lean)];
  const chest = V.add(pelvis, V.mul(sd, 1.0)), neck = V.add(pelvis, V.mul(sd, 1.8));
  const head = V.add(neck, [0.18 - (act === 'slump' ? 0.25 : 0), 0, 0.55 - (act === 'slump' ? 0.12 : 0)]);
  const shL = V.add(neck, [0, 1.08, -0.25]), shR = V.add(neck, [0, -1.08, -0.25]);
  const hipL = [0, 0.55, zp - 0.05], hipR = [0, -0.55, zp - 0.05];
  const legs = [];
  for (const sg of [1, -1]) {
    const [kn0, an0] = ik(sg > 0 ? hipL : hipR, [0.25, sg * 1.25, 0.5], 1.5, 1.45, [1, -sg * 0.7, 0]);
    const kn = V.lerp(kn0, [0.85, sg * 0.6, 0.45], bf), an = V.lerp(an0, [-0.55, sg * 2.0, 0.35], bf);
    legs.push([kn, an, V.add(an, [0.8, sg * 0.25, -0.3])]);
  }
  const toLocal = toLocalFn(g);
  let L = [1.0, 1.42, zp + 0.25], R = [1.05, -1.3, zp - 0.1];
  if (g.gloveW > 0 && g.gloveTarget) L = V.lerp(L, toLocal(...g.gloveTarget), g.gloveW);
  if (act === 'cover') { L = [1.3, 0.35, 0.5]; R = [1.3, -0.35, 0.6]; }
  if (act === 'slump') { L = [0.4, 1.2, zp - 0.4]; R = [0.4, -1.2, zp - 0.5]; }
  if (act === 'chest') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); L = V.lerp(L, [0.9, 0.5, zp + 1.0], k); R = V.lerp(R, [0.9, -0.5, zp + 0.9], k); }
  let blade = [2.35, -0.35, 0.08];
  if (act === 'poke') { const k = Math.sin(clamp(at, 0, 1) * Math.PI); blade = V.lerp(blade, [4.6, -0.2, 0.05], k); R = V.lerp(R, [1.8, -0.6, zp - 0.5], k); }
  const [elL, hL] = ik(shL, L, 1.1, 1.05, [-0.4, 1, -0.6]);
  const [elR, hR] = ik(shR, R, 1.1, 1.05, [-0.4, -1, -0.6]);
  const butt = V.add(hR, V.mul(V.norm(V.sub(blade, hR)), -0.3));
  const toe = V.add(blade, [0.1, 1.35, 0]);
  let loc = [pelvis, chest, neck, head, shL, elL, hL, shR, elR, hR, hipL, legs[0][0], legs[0][1], hipR, legs[1][0], legs[1][1], legs[0][2], legs[1][2], butt, blade, toe];
  if (act === 'dive') {
    // laid out across the crease: the whole body rolled about his forward axis toward the
    // side he is diving to, then dropped onto the ice
    const side = g.actData || 1, k = easeOut(clamp(at * 2.2, 0, 1)), ang = side * 1.25 * k;
    const c = Math.cos(ang), s = Math.sin(ang);
    loc = loc.map((p) => [p[0], p[1] * c - (p[2] - 0.4) * s + side * 1.2 * k, p[1] * s + (p[2] - 0.4) * c + 0.4]);
    const lo = Math.min(...loc.map((p) => p[2]));
    if (lo < 0.25) loc = loc.map((p) => [p[0], p[1], p[2] + 0.25 - lo]);
  }
  return toWorld(g, loc);
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
