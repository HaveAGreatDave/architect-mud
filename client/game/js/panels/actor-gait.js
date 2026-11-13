// ROOM's gaits: walks solved from where the feet go, not from joint curves.
//
// actor3d.js's `walk` is a set of hand-tuned joint curves after clinical gait data. It's good, but it's
// one walk, and its comments say what happens when you change it: shorten the stride and the trailing
// toe and the leading heel swap as the lowest point and the foot skates. So the gaits here start from
// the other end. Each one says where each foot is through the cycle (stride, stance share, step width,
// how high it clears, how the heel strikes and the toe pushes off), and a two-bone IK puts the thigh
// and the shin there. The hip height comes out of the legs: the pelvis rides as high as the loaded leg
// can reach, so the body vaults over a nearly straight stance leg and sinks into double support, which
// is where the bob in a real walk comes from. The weight goes over the loaded foot because the root
// moves sideways over it while the feet stay where they were put.
//
// On top of the legs each gait sets the pelvis (tilt, turn, drop on the swing side), the trunk (lean,
// counter-turn, bend over the stance leg), the head (held level against all of it) and the arms (how far
// they swing, how bent, how wide). A limp or a stagger warps the clock, so one leg's stance is short.
//
// They're ROOM clips: actorSkinAt poses them on the CPU, and solveRoot gives each its own stride and
// surge, so a planted foot stays planted. The street's baked `walk` doesn't change.
//
// Every number is a gait's; nothing here knows a person. gl/room-people.js picks the gait (gaitFor).

import { figureSole } from './figure.js';

// Defaults are an ordinary walk. Lengths in metres, angles in degrees.
const BASE = {
  step: 0.62,      // one step; a stride (a whole cycle) is two
  duty: 0.6,       // share of the cycle a foot is down
  ahead: 0.44,     // how much of the stance travel is in front of the hip at heel strike
  lift: 0.05,      // how high the swing foot clears
  width: 0.065,    // ankle out from the midline
  give: 0.975,     // the stance leg's reach as a share of its length: under 1 keeps a soft knee
  crouch: 0,       // the hips held this much lower
  bounce: 0,       // an extra lift of the hips at mid-stance
  strike: 9,       // toe up at heel strike
  push: 20,        // toe down at toe-off
  toeOut: 6,
  tilt: 3,         // pelvis forward
  yaw: 4.5,        // pelvis turn toward the swing leg
  list: 2.2,       // pelvis drop on the swing side after each strike
  sway: 0.022,     // the hips over the stance foot
  lean: 2.5,       // trunk forward (negative is back)
  roll: 4.5,       // shoulders against the hips
  bend: 1.5,       // trunk over the stance leg
  head: -2,        // head pitch: positive looks down
  arm: 17,         // arm swing, each way
  elbow: 15,       // elbow bend
  elbowSwing: 20,  // more bend going forward
  abduct: 0.1,     // arms off the body (radians)
  across: 4,       // forward, an arm swings in across the body
  limp: 0,         // 0..1: the right leg hurts
  stagger: 0,      // 0..1: drunk
  phase: 0,        // the arms' lag behind the legs, as a share of the cycle
};

// Each gait is the base with a few numbers changed. The names are the clips' ('walk' + the key).
export const GAITS = {
  // long, quick steps, leaning in, elbows bent, arms driving
  Brisk: { step: 0.69, duty: 0.58, lift: 0.06, strike: 12, push: 24, tilt: 4, yaw: 6, roll: 6, lean: 5.5, arm: 26, elbow: 48, elbowSwing: 24, abduct: 0.12, head: -1 },
  // wide, slow and rolling: the shoulders roll, the arms held off the lats, the chin up
  Swagger: { step: 0.62, width: 0.105, yaw: 9, list: 3, sway: 0.036, roll: 10, lean: -2.5, bend: 3, arm: 21, elbow: 14, elbowSwing: 10, abduct: 0.2, across: 8, head: -5, toeOut: 13, bounce: 0.006, phase: 0.03 },
  // one foot in front of the other: the hips swing, the shoulders stay quiet
  Poise: { step: 0.57, width: 0.012, list: 4.6, yaw: 7.5, sway: 0.034, roll: 2.5, lean: -1.2, bend: 0.6, arm: 12, elbow: 16, elbowSwing: 10, abduct: 0.07, across: 2, toeOut: 4, strike: 6, head: -3 },
  // light and springy, up on the toes, arms loose
  Jaunty: { step: 0.64, duty: 0.57, lift: 0.07, bounce: 0.016, push: 28, strike: 7, arm: 23, elbow: 20, elbowSwing: 26, head: -3.5, roll: 5, phase: 0.04 },
  // short, low and flat-footed: tired or old, stooped, looking at the floor
  Shuffle: { step: 0.33, duty: 0.67, lift: 0.016, give: 0.965, crouch: 0.035, strike: 3, push: 7, tilt: 6, yaw: 2.5, list: 1.2, sway: 0.03, lean: 10, roll: 2, bend: 2.5, head: 9, arm: 6, elbow: 24, elbowSwing: 8, abduct: 0.08, toeOut: 9 },
  // a normal walk with nothing behind it: head down, shoulders forward, arms barely swinging
  Glum: { step: 0.51, duty: 0.62, lift: 0.035, strike: 6, push: 14, lean: 6, roll: 2.5, head: 14, arm: 7, elbow: 10, elbowSwing: 6, abduct: 0.06, across: 1 },
  // wide and rocking side to side, arms off the body, toes out
  Heavy: { step: 0.51, duty: 0.61, width: 0.1, lift: 0.04, give: 0.975, sway: 0.058, list: 1.4, bend: 5.5, yaw: 3, roll: 3, lean: 1, arm: 11, elbow: 18, abduct: 0.22, across: 0, toeOut: 7, strike: 7, push: 14 },
  // crouched and slow, high soft steps landing on the ball, hands up in front
  Sneak: { step: 0.39, duty: 0.7, lift: 0.085, crouch: 0.16, give: 0.96, strike: -6, push: 10, tilt: 10, yaw: 3, list: 1, sway: 0.03, lean: 17, roll: 3, bend: 1, head: -14, arm: 4, elbow: 70, elbowSwing: 6, abduct: 0.16, across: 10, toeOut: 3 },
  // the right leg hurts: a short quick stance on it, the trunk lurched over it, the hip hitched to swing it
  Limp: { step: 0.49, duty: 0.62, limp: 1, list: 1.5, arm: 12, elbow: 20, lean: 3, strike: 6, push: 11 },
  // drunk: wide, uneven, swaying off line, arms out for balance, the head heavy
  Drunk: { step: 0.49, duty: 0.63, width: 0.11, stagger: 1, sway: 0.05, list: 3, bend: 4, give: 0.975, crouch: 0.02, lean: 4, roll: 6, head: 6, arm: 14, elbow: 26, abduct: 0.26, across: 0, toeOut: 10, strike: 5, push: 12 },
};
export const GAIT_NAMES = Object.keys(GAITS);

// The clips, built with actor3d.js's own skeleton helpers so this file has no copy of the rig.
// K = { newPose, setR, fk, B, REST, BONES, bump, smooth, TAU, DEG }.
export function gaitClips(K) {
  const { newPose, setR, zeroR, fk, B, BONES, REST, bump, smooth, TAU, DEG } = K;
  const len = (b) => Math.hypot(...BONES[B[b]][2]);
  const A = len('shinL'), Bn = len('footL');              // thigh and shin: each bone's offset is its child's
  const BALL = BONES[B.toeL][2];                            // ankle to the ball of the foot, [0, -y, z]
  // the shoe's sole line (figure.js figureSole) about the ankle, heel to toe, as [z, y]: what the foot
  // rolls on. Heel up, the toes stay flat on the ground, so only the sole up to the ball can pivot.
  const SOLE = figureSole().map(([z, y]) => [z, y - REST[B.footL][1]]);
  // heel up, the toes lie flat and still, so the foot hinges on the ball joint, this high off the floor
  const BALL_UP = -Math.min(...SOLE.filter(([z]) => z > BALL[2]).map(([, y]) => y - BALL[1]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // a cycle's clock bent so the right stance is quicker (k > 0), without changing where it starts
  const warp = (p, k) => p + (k * Math.sin(TAU * p)) / TAU;

  // Where one ankle is, in the ground frame (+x the figure's left, +y up, +z ahead), and the foot's pitch
  // (positive toe down), for leg phase q (0 at heel strike). `w` is how loaded the leg is.
  function foot(G, q, side, hurt) {
    const D = hurt ? G.duty - 0.1 * G.limp : G.duty;
    const travel = 2 * G.step * D, zf = travel * G.ahead, zb = travel - zf;
    let z, lift = 0, e, w, circ = 0;
    if (q < D) {
      const u = q / D;
      z = zf - travel * u;
      e = -G.strike * (1 - smooth(0, 0.2, u)) + G.push * Math.pow(smooth(0.5, 1, u), 1.4);
      w = 1 - smooth(0.82, 1, u) * 0.7;
    } else {
      // Hermite from toe-off to strike, leaving and landing at the stance's own speed backwards: the foot
      // swings past where it lands and draws back onto it (terminal swing), so it meets the ground still
      // and doesn't skid in
      const s = (q - D) / (1 - D), m = -travel * (1 - D) / D, s2 = s * s, s3 = s2 * s;
      z = (2 * s3 - 3 * s2 + 1) * -zb + (s3 - 2 * s2 + s) * m + (-2 * s3 + 3 * s2) * zf + (s3 - s2) * m;
      // the knee leads: the foot comes up fast behind and lowers slowly in front
      const clear = hurt ? G.lift * 0.7 : G.lift;
      lift = clear * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 1.3);
      e = G.push * (1 - smooth(0, 0.3, s)) - G.strike * smooth(0.55, 1, s);
      w = smooth(0.88, 1, s) * 0.6;
      // a stiff leg swings round the side instead of bending
      if (hurt) circ = 0.07 * G.limp * Math.sin(Math.PI * s);
    }
    // the pivot. Toe up, whichever point of the sole is lowest at this pitch sits on the ground where it
    // would be with the foot flat at z, so the heel rolls rather than slides; heel up, the foot hinges on
    // the ball joint over its flat toes
    const r = e * DEG, c = Math.cos(r), sn = Math.sin(r);
    let ay = -Infinity, az = z;
    if (e > 0) { ay = BALL_UP - BALL[1] * c + BALL[2] * sn; az = z + BALL[2] - BALL[1] * sn - BALL[2] * c; }
    else for (const [pz, py] of SOLE) {
      const yy = py * c - pz * sn, zz = py * sn + pz * c;
      if (-yy > ay) { ay = -yy; az = z + pz - zz; }
    }
    // a drunk's feet land where they land: every step a little in or out, the same each cycle
    const wob = G.stagger * 0.045 * Math.sin(TAU * q * 1 + side * 1.7 + 0.6 * Math.sin(TAU * q * 2));
    return { x: side * (G.width + circ + wob), y: ay + lift, z: az, e, w, lift };
  }

  // Two-bone IK in the hip's own frame (F, column-major, the thigh's joint before its rotation).
  // Rotations are Rz·Rx·Ry: abduct about Z rolls the leg's plane, flexion about X swings it, positive back.
  function leg(P, F, s, T, toeOut) {
    const dx = T[0] - F[12], dy = T[1] - F[13], dz = T[2] - F[14];
    const lx = F[0] * dx + F[1] * dy + F[2] * dz, ly = F[4] * dx + F[5] * dy + F[6] * dz, lz = F[8] * dx + F[9] * dy + F[10] * dz;
    const g = Math.atan2(lx, -ly), r = Math.hypot(lx, ly);
    const d = clamp(Math.hypot(r, lz), Math.abs(A - Bn) + 1e-3, (A + Bn) * 0.9995);
    const phi = Math.atan2(-lz, r);
    const knee = Math.PI - Math.acos(clamp((A * A + Bn * Bn - d * d) / (2 * A * Bn), -1, 1));
    const hip = phi - Math.acos(clamp((A * A + d * d - Bn * Bn) / (2 * A * d), -1, 1));
    setR(P, 'thigh' + s, hip, (s === 'L' ? -1 : 1) * -toeOut * DEG, g);
    setR(P, 'shin' + s, knee, 0, 0);
    return hip + knee;
  }

  // the lowest point of a foot's sole on the floor's y, posed: the same points solveRoot pins
  const SOLE3 = figureSole().map(([z, y]) => [y - REST[B.footL][1], z]);
  function soleLow(W, sd) {
    const m = W[B['foot' + sd]], t = W[B['toe' + sd]];
    let lo = Infinity;
    for (const [y, z] of SOLE3) {
      const [M, py, pz] = z > BALL[2] ? [t, y - BALL[1], z - BALL[2]] : [m, y, z];
      const h = M[5] * py + M[9] * pz + M[13];
      if (h < lo) lo = h;
    }
    return lo;
  }

  function pose(G, p) {
    const P = newPose();
    // the clock: a limp hurries the right stance, a drunk's steps come unevenly
    const k = 0.18 * G.limp + 0.05 * G.stagger;
    const pr = warp(p, k), pl = (warp(p, k) + 0.5) % 1;
    const c = Math.cos(TAU * p), s = Math.sin(TAU * p);
    // the pelvis: dips on the swing side just after each strike, turns toward the swinging leg; a limp
    // hitches the right hip up to swing it clear
    let list = -G.list * (bump(pr, 0.11, 0.075) - bump(pl, 0.11, 0.075)) - 0.45 * G.list * s;
    list += G.limp * 5 * bump(pr, 0.8, 0.12);
    list += G.stagger * 3 * Math.sin(TAU * p + 0.9);
    setR(P, 'pelvis', G.tilt * DEG, G.yaw * DEG * c, list * DEG);
    // the weight over the stance foot, late because the body lands before it moves across
    const swayX = -G.sway * Math.sin(TAU * (p - 0.04)) + G.stagger * 0.035 * Math.sin(TAU * p * 1 + 2.1);
    P.root[0] = swayX;
    // the feet
    const fR = foot(G, pr, -1, G.limp > 0), fL = foot(G, pl, 1, false);
    // the hips as high as the loaded legs reach (each one's reach given by `give`), soft-minned so double
    // support sinks without a kink, plus any spring a gait puts in
    const W0 = fk(P), reach = (A + Bn) * G.give;
    const need = (f, b) => {
      const H = W0[B['thigh' + b]], dx = f.x - H[12], dz = f.z - H[14];
      const up = f.y + Math.sqrt(Math.max(0.05, reach * reach - dx * dx - dz * dz)) - H[13];
      return up + (1 - f.w) * 0.25;
    };
    const a = need(fR, 'R'), b = need(fL, 'L'), kk = 0.012;
    const lo = -kk * Math.log(Math.exp(-a / kk) + Math.exp(-b / kk));
    const mid = G.bounce * (bump(pr, 0.3, 0.09) + bump(pl, 0.3, 0.09));
    P.root[1] = Math.min(0.02, lo) - G.crouch + mid;
    // the trunk: leans in, the shoulders turn against the hips, bends back over the stance leg against the
    // pelvis's drop; a limp lurches it over the hurt leg while it's loaded
    const lurch = G.limp * 7 * bump(pr, 0.28, 0.14);
    setR(P, 'spine', G.lean * 0.6 * DEG, -G.roll * 0.45 * DEG * c, (-0.6 * list + G.bend * s - lurch) * DEG);
    setR(P, 'chest', G.lean * 0.4 * DEG, -G.roll * 0.55 * DEG * c, (-0.3 * list + G.bend * 0.4 * s - lurch * 0.4) * DEG);
    // the head holds level against the lean and the roll, and pitches where the gait looks
    const nod = 1.4 * Math.cos(2 * TAU * p) + G.stagger * 4 * Math.sin(TAU * p + 0.4);
    setR(P, 'neck', (-G.lean * 0.5 + G.head * 0.4) * DEG, 0.35 * G.roll * DEG * c, 0.4 * list * DEG);
    setR(P, 'head', (-G.tilt * 0.5 - G.lean * 0.3 + G.head * 0.6 + nod) * DEG, 0.3 * G.roll * DEG * c - 1 * DEG, (-1 + 0.5 * list + lurch * 0.6 + G.stagger * 5 * Math.sin(TAU * p + 1.3)) * DEG);
    // the legs, from where the feet are (the hip joints now that the pelvis and the root are set)
    const W = fk(P);
    // Solved twice: the first pass's feet are measured where they really landed (the pelvis's turn and drop
    // and the leg's roll tip the ankle, and a degree there is millimetres at the toe), and the second aims
    // each ankle by what its sole missed by, so two feet down together are both on the floor.
    const fix = { R: 0, L: 0 };
    for (let pass = 0; pass < 2; pass++) {
      for (const sd of ['R', 'L']) for (const b of ['thigh', 'shin', 'foot', 'toe']) zeroR(P, b + sd);
      for (const [f, sd] of [[fR, 'R'], [fL, 'L']]) leg(P, W[B['thigh' + sd]], sd, [f.x, f.y - fix[sd], f.z], G.toeOut);
      // the feet pitched to what the ground wants of them, measured off the leg as solved
      const WL = fk(P);
      for (const [f, sd] of [[fR, 'R'], [fL, 'L']]) {
        const m = WL[B['foot' + sd]], has = Math.atan2(-m[9], Math.hypot(m[8], m[10]));
        // and rolled flat: a wide step's abduction and the pelvis's drop would stand it on an edge
        const roll = Math.asin(Math.max(-1, Math.min(1, m[1])));
        setR(P, 'foot' + sd, f.e * DEG - has, 0, -roll);
        // the toes lie flat on the ground while the heel is up, and let go after toe-off
        setR(P, 'toe' + sd, f.e > 0 && f.w > 0.25 ? -f.e * DEG : 0, 0, 0);
      }
      if (pass) break;
      const WF = fk(P);
      for (const [f, sd] of [[fR, 'R'], [fL, 'L']]) fix[sd] += soleLow(WF, sd) - f.lift;
    }
    // the arms swing against the legs, the right forward with the left leg, lagging a little; forward they
    // come in across the body and bend at the elbow, back they hang straight. Drunk they go out for balance.
    const q = p - 0.05 - G.phase, ca = Math.cos(TAU * q), ce = Math.cos(TAU * (q - 0.07)), sh = Math.sin(TAU * (q - 0.05));
    const fwdR = Math.max(0, -ca), fwdL = Math.max(0, ca), out = G.stagger * 0.12 * (1 + Math.sin(TAU * p + 0.3));
    const sR = G.limp ? 0.6 : 1;
    setR(P, 'uarmR', -(3 - G.arm * 1.1 * sR * ca) * DEG, (5 + G.across * fwdR) * DEG, -(G.abduct + out) + 0.05 * fwdR);
    setR(P, 'uarmL', -(4 + G.arm * 0.9 * ca) * DEG, (-5 - G.across * fwdL) * DEG, G.abduct + out - 0.05 * fwdL);
    setR(P, 'farmR', -(G.elbow + G.elbowSwing * (0.5 - 0.5 * ce)) * DEG, 0, 0);
    setR(P, 'farmL', -(G.elbow + 4 + G.elbowSwing * (0.5 + 0.5 * ce)) * DEG, 0, 0);
    setR(P, 'handR', (-8 - 8 * sh) * DEG, 0, 0);
    setR(P, 'handL', (-9 + 6 * sh) * DEG, 0, 0);
    return P;
  }

  return GAIT_NAMES.map((n) => {
    const G = { ...BASE, ...GAITS[n] };
    // a slower gait's nominal cycle is longer; in the game the phase follows the distance walked
    return { name: 'walk' + n, dur: 1.1 * (G.step / BASE.step) * (G.duty / BASE.duty), fn: (p) => pose(G, p), walk: true };
  });
}

// The gait a body walks with when nobody's said. `gait` (the server's, or flags.figure.gait) wins; then
// how they are (drunk, tired, sad, angry, afraid, happy), their age and weight; then a habit off their id.
// Returns a clip name.
const HABITS = ['', '', '', 'Brisk', 'Brisk', 'Swagger', 'Poise', 'Jaunty', 'Glum'];
export function gaitFor(body, rnd) {
  const g = body.gait || body.figure?.gait;
  if (g) { const k = g[0].toUpperCase() + g.slice(1); return GAITS[k] ? 'walk' + k : 'walk'; }
  const m = body.mood;
  if (m === 'drunk') return 'walkDrunk';
  if (m === 'tired' || (body.age ?? 0) > 0.75) return 'walkShuffle';
  if (m === 'sad') return 'walkGlum';
  if (m === 'angry' || m === 'annoyed' || m === 'afraid' || (body.feel ?? 0) < 0) return 'walkBrisk';
  if (m === 'happy' || m === 'amused') return 'walkJaunty';
  if ((body.weight ?? 0) >= 0.85) return 'walkHeavy';
  const h = HABITS[Math.floor(rnd * HABITS.length) % HABITS.length];
  return h ? 'walk' + h : 'walk';
}
