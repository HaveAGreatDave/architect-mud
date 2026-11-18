// Feet on the floor: a standing pose's legs solved from where the feet are, not from joint angles.
//
// A clip that bends the knees and swings the hips by setting joint angles moves the feet with them, because a
// foot hangs off the pelvis. Turn the hips 10° and both feet swivel 10° on the floor; roll them and one foot
// lifts while the other sinks; shift the weight and both feet slide across. gl/room-people.js then stands the
// pose on whichever sole is lowest, so the body bobs as the feet take turns being lowest, and the other foot
// hovers. On 2026-11-16 the Cherry Pit's dancers slid a planted foot at up to 4 m/s and floated the other
// 7 cm, and plain `idle` held its relaxed foot 2.4 cm off the floor for everybody standing in a room.
//
// So a standing clip says where the feet are and lets the legs follow the body:
//
//   - Footholds. Each foot has a place on the floor (x out to the side, z ahead, metres in the figure's own
//     frame), a heading (`turn`, toe out) and a heel (`heel`, degrees up on the ball; negative is the toe up
//     on the heel). The place is where the ankle would be with the foot flat, so a heel coming up rolls the
//     foot over its ball and the ball stays put. Nothing the hips do moves a foot.
//   - Weight. `weight` is the share on the left foot. The pelvis goes over the support, most of the way
//     (`shift`), because a body stands balanced over what's holding it up: all on one foot, the hips are over
//     that foot. The clip's own sway rides on top (`dx`, `dz`).
//   - Height. The hips go as high as the loaded leg reaches with a soft knee (`give`), then down by `sink`,
//     which is how a clip bends its knees: a dip is the hips going down, and both knees bend because both
//     feet are still on the floor. A free foot doesn't hold the hips down: if the hips leave it, its heel
//     comes up and it stands on the ball, the way a relaxed leg does.
//   - The knee points over the foot, whatever the hips are doing, so a turn of the hips over planted feet
//     turns the thighs in their sockets instead of twisting the feet on the floor.
//   - A foot in the air (`air: true`) is the clip's own: a kick, a leg hooked round a pole. Its joint angles
//     are left as they were set.
//
// What it changes is the legs (thighs, shins, feet, toes) and the root. Everything above the pelvis is the
// clip's. Call it last, after the pelvis is set: plant() reads the pelvis to find the hips.
//
// The street's baked walk and ROOM's gaits (actor-gait.js) solve their own legs; this is for standing still,
// and dancing on the spot. scripts/shapes/actor-feet.mjs holds every standing clip to it.

import { figureSole } from './figure.js';

// The ankle over the floor, and how far ahead of where it stood flat, with the foot pitched `e` degrees (positive
// is the heel up). Heel up, the foot hinges on the ball pad: the front of the flat of the sole (figure.js
// figureSole), just behind the ball joint, which is on the floor when the foot's flat and stays exactly where it
// was as the heel comes up. The toes stay flat over it, held up a little by the shoe's toe spring. Toe up, the foot
// rocks back on whichever point of the heel's curve is lowest.
//
// ⚠ It used to hinge heel-up on the ball joint with the toes flat on the floor. Under the toes the sole is about
// 2.7 mm higher than the flat behind the ball, so every heel-off made the whole foot hop up 2.7 mm and its contact
// jump forward: a 10 cm/s skid on every step of a dance, and in every ROOM gait. Rolling it over the true rocker
// instead skids the same distance a few degrees later, when the contact hands from the pad to the toes.
// K = { B, BONES, REST, DEG }.
export function footPivot(K) {
  const { B, BONES, REST, DEG } = K;
  const BALL = BONES[B.toeL][2];                                // ankle to the ball of the foot, [0, -y, z]
  const SOLE = figureSole().map(([z, y]) => [z, y - REST[B.footL][1]]);
  // the ball pad: the most forward point of the sole's flat that's still behind the ball joint
  const low = Math.min(...SOLE.map(([, y]) => y));
  const PAD = SOLE.filter(([z, y]) => y < low + 3e-4 && z <= BALL[2]).reduce((a, b) => (b[0] > a[0] ? b : a));
  const ankleAt = (e) => {
    const r = e * DEG, c = Math.cos(r), s = Math.sin(r);
    if (e > 0) { const [pz, py] = PAD; return [-(py * c - pz * s), pz - (py * s + pz * c)]; }
    let ay = -Infinity, dz = 0;
    for (const [pz, py] of SOLE) { const yy = py * c - pz * s, zz = py * s + pz * c; if (-yy > ay) { ay = -yy; dz = pz - zz; } }
    return [ay, dz];
  };
  ankleAt.pad = PAD[0];   // how far ahead of the ankle the pad is
  return ankleAt;
}

// K = actor3d.js's own skeleton helpers, so this file has no copy of the rig.
export function planter(K) {
  const { fk, B, BONES, setR, zeroR, DEG } = K;
  const len = (b) => Math.hypot(...BONES[B[b]][2]);
  const A = len('shinL'), Bn = len('footL');                  // thigh and shin: each bone's offset is its child's
  const LEG = A + Bn;
  const BALL = BONES[B.toeL][2];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  const ankleAt = footPivot(K);
  // A foothold is where the ankle stands with the foot flat, or with `ball` where the ball of the foot is, so
  // the foot swivels on its ball pad as it turns, as a dancer's free foot does. Either way, where the ankle goes
  // for heel `e` and heading `h`.
  const flatAt = (f, h) => (f.ball ? [f.x - Math.sin(h) * ankleAt.pad, f.z - Math.cos(h) * ankleAt.pad] : [f.x, f.z]);
  const ankleFor = (f, e, h) => { const [ay, dz] = ankleAt(e), [x, z] = flatAt(f, h); return [x + Math.sin(h) * dz, ay + (f.lift || 0), z + Math.cos(h) * dz]; };
  // what the body balances over on a foot: a little in front of the ankle, between the heel and the ball
  const MID = 0.03;
  const midOf = (f, h) => { const [x, z] = flatAt(f, h); return [x + Math.sin(h) * MID, z + Math.cos(h) * MID]; };

  // 3×3 rotations, row-major, as fk builds them (local Rz·Rx·Ry)
  const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const mul = (a, b) => {
    const o = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  };
  const tr = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
  const rot = (M) => [M[0], M[4], M[8], M[1], M[5], M[9], M[2], M[6], M[10]];   // a column-major 4×4's rotation
  // back to the local angles fk wants, for R = Rz(z)·Rx(x)·Ry(y)
  const euler = (R) => [Math.asin(clamp(R[7], -1, 1)), Math.atan2(-R[6], R[8]), Math.atan2(-R[1], R[4])];

  // Two-bone IK in the hip's frame F (column-major, the thigh's joint before its own rotation), with the
  // thigh turned `tw` about its own length first, so the knee bends toward the foot rather than the hips'
  // front. Exact: the knee's bend comes from the distance, the roll and swing from where the target is.
  function leg(P, F, s, T, tw) {
    const dx = T[0] - F[12], dy = T[1] - F[13], dz = T[2] - F[14];
    let lx = F[0] * dx + F[1] * dy + F[2] * dz, ly = F[4] * dx + F[5] * dy + F[6] * dz, lz = F[8] * dx + F[9] * dy + F[10] * dz;
    const raw = Math.hypot(lx, ly, lz) || 1e-6, d = clamp(raw, Math.abs(A - Bn) + 1e-3, LEG * 0.9995);
    lx *= d / raw; ly *= d / raw; lz *= d / raw;
    const knee = Math.PI - Math.acos(clamp((A * A + Bn * Bn - d * d) / (2 * A * Bn), -1, 1));
    // the chain in the thigh's frame, bent at the knee and turned by the twist
    const vy = -A - Bn * Math.cos(knee), vz = -Bn * Math.sin(knee);
    const ux = Math.sin(tw) * vz, uy = vy, uz = Math.cos(tw) * vz;
    // the roll about z: the one of the two that's nearest the untwisted answer
    const rho = Math.hypot(lx, ly) || 1e-6, phi = Math.atan2(ly, lx), g0 = Math.atan2(lx, -ly);
    const off = Math.acos(clamp(ux / rho, -1, 1)), ga = phi + off, gb = phi - off;
    const g = Math.abs(wrap(ga - g0)) < Math.abs(wrap(gb - g0)) ? ga : gb;
    const yp = -Math.sin(g) * lx + Math.cos(g) * ly;
    const hip = wrap(Math.atan2(lz, yp) - Math.atan2(uz, uy));
    setR(P, 'thigh' + s, hip, tw, g);
    setR(P, 'shin' + s, knee, 0, 0);
    // the shin's rotation in the world, for the foot
    return mul(mul(mul(rot(F), rz(g)), mul(rx(hip), ry(tw))), rx(knee));
  }

  // feet: { L, R }, each { x, z, turn = 6, heel = 0, ball, lift, air } (turn and heel in degrees; `lift` raises the
  // foot straight up off its foothold, metres, so a foot leaving the floor goes up rather than along it)
  // o: { weight = 0.5 (share on the left), shift = 0.8, dx = 0, dz = 0, sink = 0, give = 0.997, y }, `y` the root's
  // height when the clip knows it (kneeling: the hips over knees on the floor), instead of what the legs reach
  function plant(P, feet, o = {}) {
    const weight = clamp(o.weight ?? 0.5, 0, 1), shift = o.shift ?? 0.8, give = o.give ?? 0.997;
    const sides = ['L', 'R'].filter((s) => feet[s] && !feet[s].air);
    if (!sides.length) return P;
    for (const s of sides) for (const b of ['thigh', 'shin', 'foot', 'toe']) zeroR(P, b + s);
    // the hips over what's holding them up
    const head = (s) => (s === 'L' ? 1 : -1) * (feet[s].turn ?? 6) * DEG;
    const mid = Object.fromEntries(sides.map((s) => [s, midOf(feet[s], head(s))]));
    const k = sides.length > 1 ? weight : 1, a = mid[sides[0]], b = mid[sides[1]] || a;   // sides[0] is L when both are down
    P.root[0] = shift * (b[0] + (a[0] - b[0]) * k) + (o.dx || 0);
    P.root[2] = shift * (b[1] + (a[1] - b[1]) * k) + (o.dz || 0);
    P.root[1] = 0;
    const W = fk(P);
    const hipYaw = (F) => Math.atan2(F[8], F[10]);
    const Q = {};
    for (const s of sides) {
      const f = feet[s], sg = s === 'L' ? 1 : -1, h = sg * (f.turn ?? 6) * DEG, e = f.heel ?? 0;
      // how loaded this foot is: the heavier one carries the hips, a free one goes up on its toes
      const w = Math.min(1, 2 * (s === 'L' ? weight : 1 - weight));
      Q[s] = { f, h, e, w, F: Float64Array.from(W[B['thigh' + s]]) };
    }
    // the hips as high as the loaded legs reach, soft-minned so a change of weight doesn't kink, then down by sink
    const needs = sides.map((s) => {
      const { f, h, e, w, F } = Q[s], T = ankleFor(f, e, h), dx = T[0] - F[12], dz = T[2] - F[14], reach = LEG * give;
      return T[1] + Math.sqrt(Math.max(0.0025, reach * reach - dx * dx - dz * dz)) - F[13] + (1 - w) * 0.07;
    });
    const kk = 0.01, lo = needs.length > 1 ? -kk * Math.log(needs.reduce((x, n) => x + Math.exp(-n / kk), 0)) : needs[0];
    const dy = o.y != null ? o.y : lo - (o.sink || 0);
    P.root[1] = dy;
    for (const s of sides) Q[s].F[13] += dy;
    for (const s of sides) {
      const { f, h, F } = Q[s];
      let e = Q[s].e;
      // left behind by the hips, a foot stands up on its ball rather than leaving the floor
      const far = (x) => { const T = ankleFor(f, x, h); return Math.hypot(T[0] - F[12], T[1] - F[13], T[2] - F[14]); };
      const most = LEG * 0.999;
      if (o.y == null && far(e) > most && e < 50) {
        let a = Math.max(e, 0), b = 50;
        if (far(b) > most) e = b;
        else { for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (far(m) > most) a = m; else b = m; } e = b; }
      }
      // the knee over the foot: the thigh turned in its socket by however far the hips have turned from it
      const tw = clamp(wrap(h - hipYaw(F)), -40 * DEG, 40 * DEG);
      const S = leg(P, F, s, ankleFor(f, e, h), tw);
      // the foot flat on the floor (or up on its ball) and pointing where it was put, whatever the leg did
      const want = mul(ry(h), rx(e * DEG));
      const [x, y, z] = euler(mul(tr(S), want));
      setR(P, 'foot' + s, x, y, z);
      // the toes lie along the floor while the heel's up, tipped up a touch, because the pad they hinge behind
      // is lower than their joint and a steep heel would otherwise dip their tips through the floor
      if (e > 0) setR(P, 'toe' + s, -1.12 * e * DEG, 0, 0);
    }
    return P;
  }
  // A foot set to point along heading `h` (radians, positive toward the figure's left) and pitched `e` degrees in
  // the world, whatever its shin is doing: `W` is the shin's world matrix as fk has it. The foot's own rotation is
  // replaced. For a walk, whose planted foot would otherwise turn with the hips.
  function aimFoot(P, W, s, h, e) {
    zeroR(P, 'foot' + s);
    const [x, y, z] = euler(mul(tr(rot(W)), mul(ry(h), rx(e * DEG))));
    setR(P, 'foot' + s, x, y, z);
  }
  return { plant, aimFoot, ankleAt, LEG, BALL };
}
