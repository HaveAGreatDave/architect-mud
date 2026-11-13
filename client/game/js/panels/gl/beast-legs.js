// FOUR LEGS AS AN ANIMAL'S: the mammal leg and its gaits, for the beast kit's quadruped (gl/beast-kit.js).
//
// A leg is its bones, each a loft with its own section: the front leg a shoulder blade, the upper arm, the forearm
// (swollen behind the elbow, with the point of the elbow showing), the metacarpus and the paw; the hind leg a deep
// thigh, the tibia with the gaskin swelling behind it, the point of the hock, the metatarsus and the paw. The foot
// is one of three postures (docs/proposals/bestiary-art-direction.md, Legs):
//   paw          digitigrade, a dog's or a cat's: up on the toes, the wrist and the hock well off the ground
//   hoof         unguligrade, a bull's: a long cannon, a fetlock, a sloped pastern and a cloven hoof
//   plantigrade  a rat's hind foot: the whole sole down, heel and all
//
// The joints come from the foot. The gait puts each foot somewhere and pitches it; the foot's own bones are a fixed
// shape for its posture, which fixes the wrist or the hock; a two-bone solve (law of cosines) bends the elbow back
// and the stifle forward to reach it from the shoulder or the hip. So a planted foot is always on the floor, and
// the leg lengths are worked out from the body they're under, not written in.
//
// ⚠ IMPORT CYCLE: beast-kit.js imports this file and this file imports beast-kit's primitives. It's safe only while
// nothing here reads one of them at load time: every use is inside a function.
import { add, sub, mul, madd, dot, cross, vlen, norm, lerp3, clamp, smooth, rot, C, mix, sweep, blob, spike, tube, tuft, keys } from './beast-kit.js';
import { MAT } from './ballpark-mesh.js';

// ── gaits ────────────────────────────────────────────────────────────────────────────────────────────
// Hildebrand's terms: `duty` is the share of the stride a foot is down, `phase` when each foot comes down. A walk is
// lateral-sequence (left hind, left fore, right hind, right fore, a quarter apart), a trot diagonal pairs together.
// `f` is strides a second for an animal whose shoulder stands 0.45 m, scaled by √(0.45/h) for any other (Froude);
// `stride`, `lift`, `bob` and `crouch` are fractions of the leg's height, `roll` and `nod` radians.
export const GAITS = {
  stand: { duty: 1, f: 0.16, stride: 0, lift: 0.08, bob: 0.004, roll: 0.02, nod: 0.025 },
  walk: { duty: 0.65, f: 1.15, stride: 0.42, lift: 0.1, bob: 0.014, roll: 0.03, nod: 0.05, phase: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 } },
  trot: { duty: 0.42, f: 1.9, stride: 0.62, lift: 0.14, bob: 0.02, roll: 0.014, nod: 0.025, phase: { LH: 0, RF: 0.03, RH: 0.5, LF: 0.53 } },
  stalk: { duty: 0.78, f: 0.5, stride: 0.3, lift: 0.07, bob: 0.004, roll: 0.02, nod: 0.01, crouch: 0.13, phase: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 } },
};
export const LEG_KEYS = ['LF', 'RF', 'LH', 'RH'];
const frac = (v) => ((v % 1) + 1) % 1;

/**
 * Where one foot is at `cyc` strides into the gait: `dz` along the stride (+ forward), `y` its lift and `theta` its
 * pitch (toes down). Down, it slides back the length of the stride, the heel rising at the end; up, it lifts, the
 * paw folding back at the wrist (a forefoot right over, a hind foot less), and reaches forward before it lands.
 * Standing, one forefoot (`fidget`) lifts, turns its paw and sets down where it was, once a cycle.
 */
export function footAt(gait, key, cyc, o) {
  const g = GAITS[gait] || GAITS.stand, front = key[1] === 'F';
  if (!g.phase) {
    if (key !== (o.fidget || 'RF')) return { dz: 0, y: 0, theta: 0, down: true };
    const p = frac(cyc + 0.5), w = 0.09;
    if (p > w) return { dz: 0, y: 0, theta: 0, down: true };
    const s = Math.sin(Math.PI * (p / w));
    return { dz: 0.03 * o.H * s, y: g.lift * o.H * s, theta: 1.0 * s, down: false };
  }
  const phi = frac(cyc + g.phase[key]), push = front ? 0.32 : 0.24;
  if (phi < g.duty) { const k = phi / g.duty; return { dz: o.S * (0.5 - k), y: 0, theta: push * smooth(0.7, 1, k), down: true }; }
  const u = (phi - g.duty) / (1 - g.duty), e = u * u * (3 - 2 * u), fold = front ? 1.45 : 0.8;
  const theta = push * (1 - smooth(0, 0.22, u)) + fold * Math.sin(Math.PI * Math.min(1, u * 1.2)) * smooth(0, 0.18, u) - 0.22 * Math.sin(Math.PI * smooth(0.55, 1, u));
  return { dz: o.S * (e - 0.5), y: g.lift * o.H * (front ? 1.1 : 0.9) * Math.sin(Math.PI * u), theta, down: false };
}

/** The body over the legs at `cyc`: `dy` (a dip twice a stride, or breath standing), `roll` toward the swinging side, `nod` of the head. */
export function bodyAt(gait, cyc, H) {
  const g = GAITS[gait] || GAITS.stand;
  if (!g.phase) return { dy: g.bob * H * Math.sin(cyc * Math.PI * 2 * 3), roll: g.roll * Math.sin(cyc * Math.PI * 2), pitch: 0, nod: g.nod * Math.sin(cyc * Math.PI * 2 + 1) };
  return {
    dy: -g.bob * H * (1 - Math.cos(cyc * Math.PI * 4)) / 2 - (g.crouch || 0) * H,
    roll: g.roll * Math.sin(cyc * Math.PI * 2),
    pitch: 0.012 * Math.sin(cyc * Math.PI * 4 + 0.6),
    nod: g.nod * Math.sin(cyc * Math.PI * 4 + 0.8),
  };
}

// ── proportions ──────────────────────────────────────────────────────────────────────────────────────
// Per posture and end (F fore, H hind), as fractions of the socket's height h (the shoulder joint or the hip):
// `meta` the metapodial's length and `dir` its lean (paw to wrist), `k` how much longer the two upper bones are than
// the straight line to the wrist at rest (more is a more angled leg) and `ra` the upper bone's share of them. An
// ungulate's cannon is long against its femur, a carnivore's metatarsus shorter (Garland and Janis 1993).
export const LEG_PROPS = {
  paw: { F: { k: 1.1, ra: 0.47, meta: 0.2, dir: [0, 1, -0.3] }, H: { k: 1.2, ra: 0.5, meta: 0.3, dir: [0, 1, -0.16] } },
  hoof: { F: { k: 1.05, ra: 0.5, meta: 0.27, dir: [0, 1, -0.03], pastern: 0.1, hoofH: 0.065 }, H: { k: 1.16, ra: 0.52, meta: 0.32, dir: [0, 1, -0.06], pastern: 0.1, hoofH: 0.065 } },
  plantigrade: { F: { k: 1.1, ra: 0.47, meta: 0.2, dir: [0, 1, -0.3] }, H: { k: 1.32, ra: 0.52, meta: 0.24, ankle: 0.08 } },
};

// The foot's bones in its own frame ([side, up, forward] from the ground point T): the wrist or hock `W`, the joints
// between for drawing, and its outline (`hull`, [up, forward] pairs: the sole's ends, the toe tips, the top) to keep
// it out of the floor however it's pitched.
function footShape(post, pr, h, look) {
  const lw = look.lw, pw = 0.028 * lw * (look.pawK || 1) * (pr.pawK || 1), toe = look.toeLen || 1;
  if (post === 'hoof') {
    const hw = 0.034 * lw, hh = pr.hoofH * h, cn = [0, hh, 0.004 * lw], fk = add(cn, mul(norm([0, 1, -0.8]), pr.pastern * h));
    return { W: add(fk, mul(norm(pr.dir), pr.meta * h)), coronet: cn, fetlock: fk, hw, hull: [[0, -0.72 * hw], [0, 0.85 * hw], [hh * 0.25, 1.02 * hw], [hh * 0.5, 1.06 * hw], [hh, 1.0 * hw], [hh * 1.2, -0.95 * hw]] };
  }
  if (post === 'plantigrade') {
    const heel = [0, 0, -pr.meta * h], toeL = 0.022 * lw * toe;
    return { W: add(heel, [0, pr.ankle * h, 0.02 * h]), heel, pw, toeL, hull: [[0, -pr.meta * h - 0.016 * lw], [0, toeL + 0.004 * lw], [0.018 * lw, 0], [0.018 * lw, -pr.meta * h]] };
  }
  const tz = 0.98 * (1 + 0.6 * (toe - 1));
  const hull = [[0, -0.75], [0.6, -1.15], [1.22, -0.15], [0.84, tz], [0.42, tz + 0.44 * toe], [0, tz]];
  if (!look.retract) hull.push([0.1, tz + 0.8 * toe]);
  return { W: mul(norm(pr.dir), pr.meta * h * (look.metaK || 1)), pw, toe, hull: hull.map(([y, z]) => [y * pw, z * pw]) };
}

/**
 * One leg's rest: its socket P0 (the shoulder joint or the hip), where its foot stands T0, the posture, and the two
 * upper bones' lengths worked out from them. `side` is +1 for the left (+X).
 */
export function legRig(key, P0, T0, post, look, tune = {}) {
  const front = key[1] === 'F', end = front ? 'F' : 'H';
  const pr = { ...LEG_PROPS[post][end], ...(tune[end] || {}) }, h = P0[1];
  const shape = footShape(post, pr, h, look);
  const W0 = add(T0, shape.W), D0 = vlen(sub(W0, P0)), L = D0 * pr.k;
  const rig = { key, front, s: key[0] === 'L' ? 1 : -1, post, pr, h, shape, P0, T0, a: L * pr.ra, b: L * (1 - pr.ra) };
  // the farthest a foot can slide either way at rest and still be reached, for the stride
  let reach = 0;
  for (let dz = 0; dz < h; dz += h * 0.01) {
    const ok = [1, -1].every((sg) => vlen(sub(add(W0, [0, 0, sg * dz]), P0)) < (rig.a + rig.b) * 0.95);
    if (!ok) break;
    reach = dz;
  }
  rig.reach = reach;
  return rig;
}

// two bones from P to W, the knee bent toward `pole`
function solve(P, W, a, b, pole) {
  const d = sub(W, P), D0 = vlen(d), dn = norm(d);
  const D = clamp(D0, Math.abs(a - b) + 1e-4, (a + b) * 0.999);
  const x = (a * a - b * b + D * D) / (2 * D), hh = Math.sqrt(Math.max(0, a * a - x * x));
  let pp = sub(pole, mul(dn, dot(pole, dn)));
  pp = vlen(pp) < 1e-6 ? [0, 0, 1] : norm(pp);
  return { K: add(madd(P, dn, x), mul(pp, hh)), W: madd(P, dn, D) };
}

// A bone: a loft from A to B whose section is keyed down its length, K = [[t, [halfWidth, halfDepth, forward]], …].
// The width is across the animal, the depth front to back; `forward` moves the section forward of the bone.
function bone(M, A, B, K, col, o = {}) {
  const d = norm(sub(B, A)), ext = o.ext ?? 0.004;
  const up = Math.abs(d[2]) > 0.85 ? [0, 1, 0] : [0, 0, 1];
  return sweep(M, [madd(A, d, -ext), madd(B, d, ext)], (t) => { const [w, h, oy] = keys(K, t); return { w, h, oy, e: o.e ?? 2 }; },
    { up, ring: o.ring ?? 12, seg: o.seg ?? 5, col, mat: o.mat ?? MAT.MATTE, dome: o.dome ?? 0.7 });
}

/**
 * Draw one leg. `P` is the socket now (the body moved), `top` the top of the shoulder blade (front legs), `step` the
 * gait's foot (footAt) and `look` the colours and sizes. Returns the joints, for the fur that hangs off them.
 */
export function mammalLeg(M, rig, P, top, step, look) {
  const { front, s, post, shape } = rig, lw = look.lw;
  const T = [rig.T0[0], step.y, rig.T0[2] + step.dz], th = step.theta;
  const F0 = norm([s * (look.toeOut ?? 0.08), 0, 1]), Sd = norm(cross([0, 1, 0], F0));
  const U = rot([0, 1, 0], Sd, th), Fw = rot(F0, Sd, th);
  // keep the sole out of the floor: a foot pitched toes-down stands on its toes, heel up
  const ct = Math.cos(th), sn = Math.sin(th), lowest = Math.min(...shape.hull.map(([y, z]) => y * ct - z * sn));
  T[1] = Math.max(T[1], -lowest);
  const at = (v) => [T[0] + Sd[0] * v[0] + U[0] * v[1] + Fw[0] * v[2], T[1] + Sd[1] * v[0] + U[1] * v[1] + Fw[1] * v[2], T[2] + Sd[2] * v[0] + U[2] * v[1] + Fw[2] * v[2]];
  const ik = solve(P, at(shape.W), rig.a, rig.b, front ? [0, -0.15, -1] : [s * 0.15, 0, 1]);
  const K = ik.K, W = ik.W;
  // paint: the coat high, going to the leg colour down it
  const coat = (t0, t1) => (t2, a, p) => look.coat(p, t0 + (t1 - t0) * t2);
  const hk = look.haunch || 1;
  const J = { P, K, W, T, U, F: Fw, Sd };
  if (front) {
    // `arm` is the foreleg's muscle as `haunch` is the thigh's: the shoulder, the upper arm and the top of the forearm
    // take all of it, the wrist half
    const al = lw * (look.arm || 1), wl = lw * (1 + ((look.arm || 1) - 1) * 0.5), wr = look.wrist || 1;
    // the shoulder blade under the skin, then the upper arm: thick, the brachial muscle forward of it
    if (top) bone(M, top, P, [[0, [0.017 * al, 0.045 * al, 0]], [0.6, [0.021 * al, 0.05 * al, 0.004 * al]], [1, [0.026 * al, 0.036 * al, 0]]], coat(0, 0.1));
    bone(M, P, K, [[0, [0.042 * al, 0.05 * al, 0]], [0.35, [0.045 * al, 0.05 * al, 0.006 * al]], [1, [0.028 * al, 0.03 * al, 0]]], coat(0.1, 0.35));
    // the forearm: the point of the elbow behind, the muscle high and behind, the carpus a knot at the wrist
    bone(M, K, W, [[0, [0.027 * al, 0.034 * al, -0.009 * al]], [0.22, [0.029 * al, 0.03 * al, -0.004 * al]], [0.6, [0.02 * wl * wr, 0.019 * wl * wr, 0]], [0.88, [0.015 * wl * wr, 0.014 * wl * wr, 0]], [1, [0.018 * wl * wr, 0.017 * wl * wr, 0.001 * wl]]], coat(0.35, 0.7), { seg: 7 });
    blob(M, madd(K, norm(sub(K, W)), -0.004 * al), [0.02 * al, 0.02 * al, 0.02 * al], { col: look.coat(K, 0.4), nu: 10, nv: 6 });
  } else {
    // the thigh: deep, the hamstrings behind, out of the haunch
    bone(M, P, K, [[0, [0.05 * lw * hk, 0.066 * lw * hk, 0]], [0.35, [0.05 * lw * hk, 0.08 * lw * hk, -0.016 * lw]], [0.8, [0.036 * lw, 0.046 * lw, -0.004 * lw]], [1, [0.027 * lw, 0.03 * lw, 0]]], coat(0, 0.3), { seg: 6 });
    // the tibia: the gaskin swelling behind its top half, down to the hock
    bone(M, K, W, [[0, [0.027 * lw, 0.03 * lw, 0]], [0.3, [0.027 * lw, 0.036 * lw, -0.012 * lw]], [0.7, [0.017 * lw * (look.wrist || 1), 0.019 * lw * (look.wrist || 1), -0.003 * lw]], [1, [0.016 * lw * (look.wrist || 1), 0.016 * lw * (look.wrist || 1), 0]]], coat(0.3, 0.68), { seg: 7 });
  }
  // the foot: a recipe's own (Cathode's steel paw), or the posture's
  if (look.override?.[rig.key]) look.override[rig.key](M, { rig, ...J, at, lw, pw: shape.pw, s, front, theta: th, look });
  else if (post === 'hoof') hoofFoot(M, rig, J, at, look);
  else if (post === 'plantigrade' && !front) soleFoot(M, rig, J, at, look);
  else (look.pawStyle === 'cat' ? catPawFoot : pawFoot)(M, rig, J, at, look);
  // the point of the hock, and the tendon down to it
  if (!front) {
    const md = norm(sub(W, T)), back = norm(cross(md, Sd)), calc = madd(madd(W, back, 0.022 * lw), md, 0.012 * lw);
    blob(M, calc, [0.011 * lw, 0.015 * lw, 0.012 * lw], { axes: [Sd, md, back], col: look.coat(calc, 0.7), nu: 10, nv: 6 });
    tube(M, [madd(lerp3(K, W, 0.35), norm(cross(norm(sub(W, K)), Sd)), 0.02 * lw), calc], [0.009 * lw, 0.007 * lw], { ring: 8, seg: 3, col: look.coat(calc, 0.6) });
  }
  return J;
}

// the colours a foot is drawn in
const pal = (look) => ({ paw: C(look.paws || look.legCol), pad: C(look.pads || '#141010'), claw: C(look.claws || '#1c1816'), leg: C(look.legCol) });

// A cat's paw (`pawStyle: 'cat'`), built as one is. The leg comes down into it thick and its outline runs on into the
// paw, the back of the foot rising straight into the leg and the front reaching out ahead. Four toes stand in an arc,
// the middle two forward and fuller, the outer two curving round the sides, with fur between them. Underneath, a bean
// (the digital pad) sits under each toe, following the arc, and behind them the big pad, its back edge in three lobes.
// A foreleg also has the pea-sized carpal pad up the back of the wrist and the dewclaw on the inside, off the ground.
// The fur covers the top and sides only; the pads are bare. (Catster's paw anatomy; Chris Wilson on drawing paws:
// docs/reference/bibliography.md.)
function catPawFoot(M, rig, J, at, look) {
  const { W, T, U, F: Fw, Sd } = J, lw = look.lw, pw = rig.shape.pw, c = pal(look), s = rig.s, ax = [Sd, U, Fw];
  const coat = (p, k) => look.coat(p, k);
  // the pastern: from the wrist into the back of the paw, as thick as the leg it comes out of
  const heel = at([0, pw * 0.78, -pw * 0.38]);
  const p0 = rig.front ? 0.6 : 0.46;
  bone(M, W, heel, [[0, [pw * p0, pw * p0, 0]], [0.55, [pw * (p0 + 0.06), pw * (p0 + 0.04), pw * 0.04]], [1, [pw * 0.78, pw * 0.7, pw * 0.06]]], (t2, a, p) => coat(p, 0.72 + 0.18 * t2), { seg: 4, ring: 12 });
  // the paw itself, broad and flat underneath
  blob(M, at([0, pw * 0.5, pw * 0.02]), [pw * 1.04, pw * 0.5, pw * 0.98], { axes: ax, col: coat(at([0, pw * 0.6, 0]), 0.92), nu: 16, nv: 9 });
  // four toes in an arc, the middle two forward and fuller, and the beans under them
  const toes = [];
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.46, mid = i === 1 || i === 2, x = Math.sin(a) * pw * 0.84, z = pw * (0.5 + 0.34 * Math.cos(a) + (mid ? 0.1 : 0));
    toes.push([x, z]);
    blob(M, at([x, pw * (mid ? 0.4 : 0.36), z]), [pw * (mid ? 0.34 : 0.3), pw * (mid ? 0.38 : 0.34), pw * (mid ? 0.42 : 0.38)], { axes: ax, col: coat(at([x, pw * 0.5, z]), 0.95), nu: 10, nv: 7 });
    blob(M, at([x * 1.02, pw * 0.075, z + pw * 0.08]), [pw * 0.21, pw * 0.075, pw * 0.26], { axes: [norm(add(Sd, mul(Fw, Math.sin(a) * 0.4))), U, norm(add(Fw, mul(Sd, -Math.sin(a) * 0.4)))], col: c.pad, mat: MAT.SATIN, nu: 10, nv: 5 });
  }
  // fur standing up between the toes
  for (let i = 0; i < 3; i++) {
    const [x0, z0] = toes[i], [x1, z1] = toes[i + 1], root = at([(x0 + x1) / 2, pw * 0.42, (z0 + z1) / 2 - pw * 0.05]);
    const dir = norm(add(add(mul(Fw, 0.7), mul(U, 0.35)), mul(Sd, (x0 + x1) / pw * 0.4)));
    const tf = M.N.length;
    tuft(M, root, dir, pw * 0.42, pw * 0.13, mix(c.paw, '#ffffff', 0.15), U);
    for (let j = tf; j < M.N.length; j++) M.N[j] *= 0.45;
  }
  // the big pad behind the beans, its back edge in three lobes
  blob(M, at([0, pw * 0.07, -pw * 0.12]), [pw * 0.5, pw * 0.07, pw * 0.34], { axes: ax, col: c.pad, mat: MAT.SATIN, nu: 16, nv: 6 });
  for (const x of [-0.3, 0, 0.3]) blob(M, at([x * pw, pw * 0.065, -pw * (x === 0 ? 0.44 : 0.38)]), [pw * 0.2, pw * 0.065, pw * 0.17], { axes: ax, col: c.pad, mat: MAT.SATIN, nu: 12, nv: 5 });
  if (rig.front) {
    // the carpal pad up the back of the wrist, and the dewclaw on the inside, a bean under it
    const md = norm(sub(W, T)), back = norm(cross(md, Sd));
    blob(M, add(madd(W, back, pw * 0.55), mul(md, -pw * 0.1)), [pw * 0.17, pw * 0.22, pw * 0.13], { axes: [Sd, md, back], col: c.pad, mat: MAT.SATIN, nu: 10, nv: 6 });
    const dw = add(madd(W, md, -pw * 0.55), mul(Sd, -s * pw * 0.62));
    blob(M, dw, [pw * 0.17, pw * 0.22, pw * 0.18], { col: coat(dw, 0.85), nu: 10, nv: 6 });
    blob(M, madd(dw, Fw, pw * 0.1), [pw * 0.1, pw * 0.12, pw * 0.08], { col: c.pad, mat: MAT.SATIN, nu: 8, nv: 5 });
  }
}

// A dog's or a cat's paw: the metacarpus down to it, a big pad under a round foot, four toes in an arc (the middle two
// forward), a bean under each and a claw off each (sheathed on a cat); on a foreleg, the carpal pad up behind the wrist
// and the dewclaw on the inside.
function pawFoot(M, rig, J, at, look) {
  const { W, T, U, F: Fw, Sd } = J, lw = look.lw, sh = rig.shape, pw = sh.pw, toe = sh.toe || 1, c = pal(look), s = rig.s;
  const ax = [Sd, U, Fw], ball = at([0, pw * 0.62, -pw * 0.12]);
  bone(M, W, ball, [[0, [0.017 * lw, 0.016 * lw, 0]], [0.6, [0.016 * lw, 0.014 * lw, 0]], [1, [0.018 * lw, 0.016 * lw, 0]]], (t2, a, p) => look.coat(p, 0.7 + 0.2 * t2), { seg: 4 });
  blob(M, at([0, pw * 0.6, -pw * 0.15]), [pw * 0.95, pw * 0.62, pw * 1.0], { axes: ax, col: c.paw, nu: 14, nv: 8 });
  blob(M, at([0, pw * 0.2, -pw * 0.25]), [pw * 0.62, pw * 0.2, pw * 0.5], { axes: ax, col: c.pad, mat: MAT.SATIN, nu: 12, nv: 6 });
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * 0.42, zf = pw * (0.85 + (i === 1 || i === 2 ? 0.13 : 0)) * (1 + 0.6 * (toe - 1));
    const x = Math.sin(a) * pw * 1.02, z = Math.cos(a) * zf;
    blob(M, at([x, pw * 0.42, z]), [pw * 0.36, pw * 0.42, pw * 0.44 * toe], { axes: ax, col: c.paw, nu: 10, nv: 7 });
    blob(M, at([x, pw * 0.15, z + pw * 0.04]), [pw * 0.24, pw * 0.15, pw * 0.26 * toe], { axes: ax, col: c.pad, mat: MAT.SATIN, nu: 8, nv: 5 });
    if (!look.retract) { const b0 = at([x, pw * 0.47, z + pw * 0.32 * toe]); spike(M, b0, at([x * 1.05, pw * 0.1, z + pw * 0.8 * toe]), pw * 0.12, { col: c.claw, mat: MAT.SATIN, ring: 5, bend: mul(U, pw * 0.1) }); }
  }
  if (rig.front) {
    const md = norm(sub(W, T)), back = norm(cross(md, Sd));
    blob(M, add(madd(W, back, 0.014 * lw), mul(md, -0.012 * lw)), [0.008 * lw, 0.011 * lw, 0.007 * lw], { axes: [Sd, md, back], col: c.pad, mat: MAT.SATIN, nu: 8, nv: 5 });
    const dw = add(lerp3(ball, W, 0.38), mul(Sd, -s * 0.015 * lw));
    blob(M, dw, [0.006 * lw, 0.009 * lw, 0.007 * lw], { col: c.paw, nu: 8, nv: 5 });
    if (!look.retract) spike(M, dw, add(dw, add(mul(md, -0.012 * lw), mul(back, 0.006 * lw))), 0.0028 * lw, { col: c.claw, ring: 4 });
  }
}

// A bull's foot: the cannon down to the fetlock's knob, the pastern sloping forward, a band of hair at the coronet
// and the hoof cloven in two, each claw a flat-soled block; two dewclaws up behind the fetlock.
function hoofFoot(M, rig, J, at, look) {
  const { W, U, F: Fw, Sd } = J, lw = look.lw, sh = rig.shape, hw = sh.hw, c = pal(look), hc = C(look.hoofCol || '#1a1614');
  const fk = at(sh.fetlock), cn = at(sh.coronet), hh = sh.coronet[1], ax = [Sd, U, Fw];
  bone(M, W, fk, [[0, [0.019 * lw, 0.018 * lw, 0]], [0.5, [0.017 * lw, 0.016 * lw, 0]], [1, [0.021 * lw, 0.02 * lw, 0]]], (t2, a, p) => look.coat(p, 0.7 + 0.1 * t2), { seg: 4 });
  blob(M, fk, [0.022 * lw, 0.022 * lw, 0.024 * lw], { col: c.leg, nu: 10, nv: 7 });
  bone(M, fk, cn, [[0, [0.019 * lw, 0.019 * lw, 0]], [1, [0.024 * lw, 0.022 * lw, 0]]], c.leg, { seg: 3 });
  blob(M, at([0, hh * 0.95, 0.002 * lw]), [hw * 1.0, hh * 0.22, hw * 0.98], { axes: ax, col: c.leg, nu: 14, nv: 6 });
  for (const d of [1, -1]) blob(M, at([d * hw * 0.5, hh * 0.5, hw * 0.12]), [hw * 0.47, hh * 0.5, hw * 0.92], { axes: ax, e1: 0.3, e2: 0.7, col: hc, mat: MAT.SATIN, nu: 14, nv: 8 });
  const md = norm(sub(W, fk)), back = norm(cross(md, Sd));
  for (const d of [1, -1]) blob(M, add(add(madd(fk, back, 0.02 * lw), mul(Sd, d * 0.01 * lw)), mul(md, -0.004 * lw)), [0.006 * lw, 0.008 * lw, 0.006 * lw], { col: hc, mat: MAT.SATIN, nu: 8, nv: 5 });
}

// A rat's hind foot: the whole sole down from the heel to the ball, pink, and five long splayed toes with pale claws.
function soleFoot(M, rig, J, at, look) {
  const { W, U, F: Fw, Sd } = J, lw = look.lw, sh = rig.shape, c = pal(look), ax = [Sd, U, Fw];
  const heel = at([0, 0.009 * lw, sh.heel[2]]), len = -sh.heel[2];
  bone(M, W, heel, [[0, [0.016 * lw, 0.016 * lw, 0]], [1, [0.012 * lw, 0.012 * lw, 0]]], (t2, a, p) => look.coat(p, 0.75), { seg: 3 });
  blob(M, at([0, 0.009 * lw, -len / 2]), [0.016 * lw, 0.009 * lw, len / 2 + 0.008 * lw], { axes: ax, col: c.paw, nu: 14, nv: 7 });
  for (let i = 0; i < 5; i++) {
    const k = i - 2, base = at([k * 0.0065 * lw, 0.006 * lw, -0.004 * lw]), dir = norm(add(Fw, mul(Sd, k * 0.3)));
    const tip = madd(base, dir, sh.toeL * (i === 0 || i === 4 ? 0.7 : 1));
    tube(M, [base, lerp3(base, tip, 0.5), tip], [0.0042 * lw, 0.0036 * lw, 0.003 * lw], { ring: 7, seg: 3, col: c.paw });
    spike(M, tip, madd(madd(tip, dir, 0.006 * lw), U, -0.003 * lw), 0.0018 * lw, { col: c.claw, ring: 4 });
  }
}

/**
 * The body's sway as a transform: roll about the spine and pitch about the side axis through `pivot`, then `dy`.
 * `p`/`n` move a point or a normal; `apply(M, from, keep)` moves everything built since the mark `from` except the
 * ranges in `keep` ([[mark, mark], …]: the legs, which were built where the body is now).
 */
export function bodyXf(pose, pivot) {
  const { dy = 0, roll = 0, pitch = 0 } = pose;
  const n = (v) => rot(rot(v, [0, 0, 1], roll), [1, 0, 0], -pitch);
  const p = (v) => { const r = n(sub(v, pivot)); return [r[0] + pivot[0], r[1] + pivot[1] + dy, r[2] + pivot[2]]; };
  const apply = (M, from, keep = []) => {
    if (!dy && !roll && !pitch) return;
    const inKeep = (i, f) => keep.some(([a, b]) => i >= a[f] && i < b[f]);
    for (let tri = from.t; tri < M.M.length / 3; tri++) {
      if (inKeep(tri, 't')) continue;
      for (let v = 0; v < 3; v++) {
        const o = tri * 9 + v * 3, q = p([M.P[o], M.P[o + 1], M.P[o + 2]]), m = n([M.N[o], M.N[o + 1], M.N[o + 2]]);
        M.P[o] = q[0]; M.P[o + 1] = q[1]; M.P[o + 2] = q[2]; M.N[o] = m[0]; M.N[o + 1] = m[1]; M.N[o + 2] = m[2];
      }
    }
    for (let i = from.h; i < M.halos.length; i++) if (!inKeep(i, 'h')) M.halos[i] = { ...M.halos[i], p: p(M.halos[i].p) };
    for (let i = from.l; i < M.lights.length; i++) if (!inKeep(i, 'l')) M.lights[i] = { ...M.lights[i], p: p(M.lights[i].p) };
  };
  return { p, n, apply };
}

/**
 * The four legs of a quadruped standing on its body (beast-kit.js quadruped): their rigs at rest and the gait's
 * clock. `dims` are the body's numbers; `look.foot` 'paw' | 'hoof' | 'rodent' (paws in front, soles behind).
 */
export function quadLegs(q, dims) {
  const { L, W, Hh, cd, bw } = dims, st = q.stance ?? 1;
  const post = (front) => (q.foot === 'hoof' ? 'hoof' : q.foot === 'rodent' && !front ? 'plantigrade' : 'paw');
  const look = { lw: q.legW, pawK: q.pawK, toeLen: q.toeLen, metaK: q.metaK };
  // `foreSet` sets the whole foreleg that far back under the body (shoulder, elbow and paw), leaving the chest round
  // in front of it, as a cat's is; `foreHigh` raises the shoulder joint up the body and `foreWide` takes it out toward
  // the side of the chest, so the upper arm is seen on the side instead of hanging from under it
  // `hindHigh` and `hindWide` do the same for the hip, so the thigh comes out of the flank, not from under it
  const fs = q.foreSet || 0, fh = q.foreHigh || 0, fw = q.foreWide || 1, hh = q.hindHigh || 0, hw = q.hindWide || 1;
  const rest = {
    LF: { top: [0.045 * bw * fw, W - 0.035, L / 2 - 0.085 - fs], P: [0.075 * bw * fw, W - 0.2 * cd + fh, L / 2 + 0.035 - fs], T: [0.07 * bw, 0, L / 2 + 0.05 + 0.035 * st - fs] },
    LH: { P: [0.075 * bw * hw, Hh - 0.075 + hh, -L / 2 + 0.01], T: [0.072 * bw, 0, -L / 2 - 0.06 - 0.02 * st] },
  };
  const rigs = {};
  for (const key of LEG_KEYS) {
    const r = rest[key[1] === 'F' ? 'LF' : 'LH'], s = key[0] === 'L' ? 1 : -1, fl = (v) => (v ? [s * v[0], v[1], v[2]] : null);
    // a right foot set a touch off its left one, as an animal stands
    const T = fl(r.T); T[2] += (key === 'RF' || key === 'LH' ? -1 : 1) * 0.012 * st;
    rigs[key] = { ...legRig(key, fl(r.P), T, post(key[1] === 'F'), look, q.legTune || {}), top: fl(r.top) };
  }
  const H = rigs.LF.h, scale = q.scale || 1, g = GAITS[q.gait] || GAITS.stand;
  const S = Math.min(g.stride * H, 2 * Math.min(...LEG_KEYS.map((k) => rigs[k].reach)));
  return { rigs, H, S, hz: g.f * Math.sqrt(0.45 / Math.max(0.05, H * scale)) * (q.speed || 1) };
}
