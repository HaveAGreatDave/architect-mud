// GATE · DEADBALL'S PLAYERS AS THE CLOSE-UP FIGURE (diamond/figure-rig.js, docs/proposals/deadball-players-v2.md
// phase 1). Every clip in the library, sampled through, is solved by the rig as the park solves it and turned
// into the figure's bone rows, and each row must take the figure's own joint to where Deadball put that joint:
// the hips, knees and ankles, the shoulders, elbows and wrists, and the head where ballplayer-mesh.js puts the
// skull its caps are grown off. A row that missed would hang a limb off the wrong place, or a cap off the head.
// It also checks every row is finite and the limbs aren't mirrored (a row that turned a hand inside out), and that
// the figures the park dresses keep to their triangle budget with their hair cut back under the cap's band.
//
// No DOM, no GL: node scripts/shapes/figure-rig.mjs

import { CLIPS } from '../../client/game/js/panels/diamond/clips.js';
import { sampleClip } from '../../client/game/js/panels/diamond/anim.js';
import { solvePose, boneFrames, BONES, FRAME_FLOATS, scalePose, POSES } from '../../client/game/js/panels/diamond/rig.js';
import { GRIP_HOLD, BAT_HANDLE_R, gripWrist, figureRows, atRow, FIG_JOINT, HEAD_BIND_C, headScaleOf, FIG_ROW_FLOATS, figureFit, forearmTwist, HAND_HOLD } from '../../client/game/js/panels/diamond/figure-rig.js';
import { FIGURE_BONE } from '../../client/game/js/panels/figure.js';
import { bendPoint, holdPush, handPose, POSE_LEN } from '../../client/game/js/panels/gl/figure-hands.js';
import { HANDS, BAT_HANDS, HAND_NAMES } from '../../client/game/js/panels/diamond/hands.js';
import { FT_M } from '../../client/shared/world-scale.js';

// The skin of a hand round a bat, in its bind space: the built figure's own finger and thumb vertices (figure.js tags
// them in aux, -(1 + finger + 0.9 t)), bent as the shader bends them (gl/figure-hands.js bendPoint) and pressed onto the
// handle as it presses them (holdPush, figure-rig.js GRIP_HOLD). The left hand's; the right's is its mirror, and every
// grip a clip may key round a bat (hands.js BAT_HANDS), each tested. On the skin, so touching the handle is 0.
const FINGER_R = 0;
const HANDLE_R = BAT_HANDLE_R;
// How far each grip presses a finger flat before it's laid on the wood (the most, 4.5 mm: past that a finger reads as
// crushed), and what a camera sees of the handle through the hand along the grip: the 3 mm cells round it (24 a row)
// and along it, with no hand skin outside them out to 25 mm past the wood, a row on average. Fitted 2026-11-15 at two
// cells a row for the grip and three for the waggle's; the grip before showed nine, and from behind the batter you
// saw the bat across his hands.
const PRESS_MAX = 0.0045, SEEN_MAX = { bat: 2.5, batLoose: 3.5 };
const PRESS = {}, SEEN = {};
const GRIP_PTS = await (async () => {
  const { buildFigure } = await import('../../client/game/js/panels/figure.js');
  const F = buildFigure({ cut: 'jersey', style: 0, level: 'hd', sculpt: true, head: 1, build: 'average', weight: 0.5, gear: { belt: true }, beard: '', bottoms: '', hat: 'ballcap', scarf: '' });
  const out = { L: [], R: [] }, HR = GRIP_HOLD.r, u = GRIP_HOLD.dir, c0 = GRIP_HOLD.at, e2 = [0, u[2], -u[1]];
  const rad = (q) => { const v = [q[0] - c0[0], q[1] - c0[1], q[2] - c0[2]], t = v[0] * u[0] + v[1] * u[1] + v[2] * u[2], r = [v[0] - u[0] * t, v[1] - u[1] * t, v[2] - u[2] * t]; return { t, r, l: Math.hypot(...r) }; };
  const HP = F.parts.find((q) => q.name === 'handL'), inHand = (v) => v >= HP.v0 && v < HP.v0 + HP.nv;
  const tris = [];
  for (let i = 0; i < F.I.length; i += 3) if (inHand(F.I[i]) && inHand(F.I[i + 1]) && inHand(F.I[i + 2])) tris.push([F.I[i], F.I[i + 1], F.I[i + 2]]);
  const isF = (v) => F.A[v] <= -0.5 && Math.floor(-F.A[v] - 1 + 1e-4) < 4;
  for (const name of BAT_HANDS) {
    const at = new Map();
    let deep = 0;
    for (let v = 0; v < F.nv; v++) {
      const aa = F.A[v], q0 = [F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]];
      if (aa > -0.5 || q0[0] < 0.1) { if (inHand(v)) at.set(v, q0); continue; }
      const q = -aa - 1, f = Math.floor(q + 1e-4), t = Math.min(1, Math.max(0, (q - f) / 0.9));
      const bent = bendPoint(q0, 1, Math.min(4, f), t, HANDS[name]);
      deep = Math.max(deep, HR - rad(bent).l);
      const pr = holdPush(bent, 1, GRIP_HOLD);
      out.L.push(pr); out.R.push([-pr[0], pr[1], pr[2]]);
      if (inHand(v)) at.set(v, pr);
    }
    PRESS[name] = deep;
    // the camera's measure: every hand triangle sampled a millimetre apart
    const cells = new Set();
    let zmin = Infinity, zmax = -Infinity;
    for (const [i, j, k] of tris) {
      const A = at.get(i), B = at.get(j), C = at.get(k), fin = isF(i) && isF(j) && isF(k);
      const e = Math.max(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]), Math.hypot(B[0] - C[0], B[1] - C[1], B[2] - C[2]), Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2])), n = Math.max(2, Math.ceil(e / 0.001));
      for (let ia = 0; ia <= n; ia++) for (let ib = 0; ib <= n - ia; ib++) {
        const s1 = ia / n, s2 = ib / n, q = [0, 1, 2].map((x) => A[x] * s1 + B[x] * s2 + C[x] * (1 - s1 - s2)), g = rad(q);
        if (g.l - HR > 0.025) continue;
        if (fin) { zmin = Math.min(zmin, g.t); zmax = Math.max(zmax, g.t); }
        cells.add(Math.floor(g.t / 0.003) * 24 + (Math.floor(((Math.atan2(g.r[0] * e2[0] + g.r[1] * e2[1] + g.r[2] * e2[2], g.r[0]) + Math.PI) / (2 * Math.PI)) * 24) % 24));
      }
    }
    let open = 0, rowsN = 0;
    for (let z = Math.floor(zmin / 0.003); z <= Math.floor(zmax / 0.003); z++) { let m = 0; for (let x = 0; x < 24; x++) m += cells.has(z * 24 + x) ? 1 : 0; rowsN++; open += 24 - m; }
    SEEN[name] = open / rowsN;
  }
  return out;
})();

// Ry about the forearm's line through the wrist, in bind space, as gl/figure-hd.js handXf turns a forearm
const turnY = (p, a, side) => { const c = Math.cos(a), s = Math.sin(a), x = p[0] - side * 0.195, z = p[2] + 0.01; return [side * 0.195 + c * x + s * z, p[1], -0.01 - s * x + c * z]; };

const FT = 1 / FT_M;
const fails = [];
const fail = (m) => { if (fails.length < 40) fails.push(m); };
// the ball in the pitcher's hand (figure-rig.js BALL_HOLD, true size): no finger of any pitch grip more than a
// millimetre into it, and the four-seamer's index, middle and thumb on it within two; and the director's own copy of
// the spot (hands.js BALL_IN_FINGERS) where figure-rig.js ballInHand puts it, within a hundredth of a foot
{
  const { buildFigure } = await import('../../client/game/js/panels/figure.js');
  const { PITCH_GRIPS, BALL_HOLD, ballInHand } = await import('../../client/game/js/panels/diamond/figure-rig.js');
  const { BALL_R } = await import('../../client/game/js/panels/diamond/flight.js');
  const { BALL_IN_FINGERS } = await import('../../client/game/js/panels/diamond/hands.js');
  const F = buildFigure({ cut: 'jersey', style: 0, level: 'hd', sculpt: true, head: 1, build: 'average', weight: 0.5, gear: { belt: true }, beard: '', bottoms: '', hat: 'ballcap', scarf: '' });
  const BR = BALL_R * FT_M, names = ['index', 'middle', 'ring', 'little', 'thumb'];
  for (const [type, g] of Object.entries(PITCH_GRIPS)) {
    const near = Array(5).fill(Infinity);
    for (let v = 0; v < F.nv; v++) {
      const a = F.A[v];
      if (a > -0.5 || F.P[v * 3] < 0.1) continue;
      const q = -a - 1, f = Math.min(4, Math.floor(q + 1e-4)), t = Math.min(1, Math.max(0, (q - Math.floor(q + 1e-4)) / 0.9));
      const p = bendPoint([F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]], 1, f, t, g);
      near[f] = Math.min(near[f], Math.hypot(p[0] - BALL_HOLD[0], p[1] - BALL_HOLD[1], p[2] - BALL_HOLD[2]) - BR);
    }
    near.forEach((d, i) => { if (d < -0.001) fail(`ball: the ${type}'s ${names[i]} ${(-d * 1000).toFixed(1)} mm into the ball`); });
    if (type === 'four-seam fastball') for (const i of [0, 1, 4]) if (near[i] > 0.002) fail(`ball: the four-seamer's ${names[i]} ${(near[i] * 1000).toFixed(1)} mm off the ball`);
  }
  const { CLIPS } = await import('../../client/game/js/panels/diamond/clips.js');
  const P = { ...sampleClip(CLIPS.pitch_windup_over, 1.5, { scale: 1.08 }), at: [3, 0, 50], yaw: 37, scale: 1.08 }, sol = solvePose(P);
  const fr = boneFrames(sol), dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const S of ['L', 'R']) {
    const w = ballInHand(sol, S), c = BALL_IN_FINGERS[S], o = BONES.indexOf('hand' + S) * FRAME_FLOATS, wr = sol.J['wr' + S];
    const d = [0, 1, 2].map((i) => wr[i] + (fr[o + i] * c[0] + fr[o + 3 + i] * c[1] + fr[o + 6 + i] * c[2]) * 1.08);
    if (dd(w, d) > 0.01) fail(`ball: the director's spot for the ball in the ${S} hand is ${dd(w, d).toFixed(3)} ft off the figure's (hands.js BALL_IN_FINGERS)`);
  }
}
// every shape in the library a sound pose, and every name a clip keys one of them (clip-schema.js holds the files)
for (const n of HAND_NAMES) { const P = handPose(HANDS[n]); if (P.length !== POSE_LEN || !P.every(Number.isFinite)) fail(`hands: ${n} isn't a sound pose`); }
{
  const { CLIPS } = await import('../../client/game/js/panels/diamond/clips.js');
  for (const c of Object.values(CLIPS)) for (const h of c.hands || []) for (const S of ['L', 'R']) if (S in h && h[S] !== '' && !HANDS[h[S]]) fail(`hands: ${c.id} keys ${h[S]}, which isn't in the library`);
}
if (process.env.WRIST_PRINT) console.log('grip seen', JSON.stringify(SEEN), 'pressed', JSON.stringify(PRESS));
for (const name of BAT_HANDS) {
  if (!(SEEN[name] <= SEEN_MAX[name])) fail(`the ${name} grip shows ${SEEN[name].toFixed(1)} cells a row of the handle through the hand, over ${SEEN_MAX[name]}: the bat shows across the hand`);
  if (!(PRESS[name] <= PRESS_MAX)) fail(`the ${name} grip presses a finger ${(PRESS[name] * 1000).toFixed(1)} mm flat on the wood, over ${PRESS_MAX * 1000}`);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const frames = new Float32Array(BONES.length * FRAME_FLOATS), rows = new Float32Array(FIG_ROW_FLOATS);
// how far a joint may land from Deadball's, in feet: a hundredth of a foot is float noise
const TOL = 0.01;
const det3 = (r, b) => { const o = b * 12, a = (i, j) => r[o + i * 4 + j]; return a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)); };

let n = 0;
// `grip` is the clip's run's own (figure-rig.js figureRows keeps which way round each hand holds the bat), and
// `run` counts the frames in a row a gripping wrist has stood turned past WRIST_MAX on its forearm. The clips' elbows
// are keyed to their grip (scripts/shapes/elbow-fit.mjs: every key holding a bat has its elbow pole turned till that
// forearm's roll is inside 60°, both hands held thumb to the barrel), so most clips are inside a real wrist all
// through. These four aren't, for a frame or two of the 40 sampled, where the bat whips round a forearm between
// keys faster than a key can hold (the three swings and the strikeout): [worst degrees, longest run of sampled
// frames past WRIST_MAX], measured 2026-11-15 with the grip pressed round the handle (figure-rig.js GRIP_HOLD). A
// clip may not get worse, and no other clip may pass WRIST_MAX at all.
const WRIST_MAX = 120 * Math.PI / 180;
const WRIST_KNOWN = { bat_strikeout: [145, 1], bat_swing_high: [124, 1], bat_swing_low: [126, 1], bat_swing_mid: [142, 2] };
const wristOf = {};   // by clip: { worst (degrees), run }
function check(label, pose, grip = {}, run = null) {
  const sol = solvePose(pose);
  boneFrames(sol, frames);
  figureRows(sol, frames, figureFit({ role: 'player' }), rows, null, grip);
  n++;
  for (let i = 0; i < rows.length; i++) if (!Number.isFinite(rows[i])) { fail(`${label}: row ${Math.floor(i / 12)} not finite`); return; }
  const J = sol.J, s = sol.s;
  const want = [
    ['pelvis', 'pelvis', J.pelvis], ['neck', 'neck', J.neck],
    ['thighL', 'thighL', J.hipL], ['thighR', 'thighR', J.hipR], ['shinL', 'shinL', J.knL], ['shinR', 'shinR', J.knR],
    ['footL', 'footL', J.anL], ['footR', 'footR', J.anR],
    ['uarmL', 'uarmL', J.shL], ['uarmR', 'uarmR', J.shR], ['farmL', 'farmL', J.elL], ['farmR', 'farmR', J.elR],
    ['handL', 'handL', J.gripL ? gripWrist(sol, 'L') : J.wrL], ['handR', 'handR', J.gripR ? gripWrist(sol, 'R') : J.wrR],
    // a limb's end on its parent: the knee by the thigh, the ankle by the shin, the elbow and wrist the same
    ['thighL', 'shinL', J.knL], ['thighR', 'shinR', J.knR], ['shinL', 'footL', J.anL], ['shinR', 'footR', J.anR],
    ['uarmL', 'farmL', J.elL], ['uarmR', 'farmR', J.elR], ['farmL', 'handL', J.gripL ? gripWrist(sol, 'L') : J.wrL], ['farmR', 'handR', J.gripR ? gripWrist(sol, 'R') : J.wrR],
  ];
  for (const [bone, joint, at] of want) {
    // a hand round a bat hangs by its grip, on the handle, and its wrist meets the forearm within about a centimetre
    const tol = TOL;
    const p = atRow(rows, FIGURE_BONE[bone], FIG_JOINT[joint]), d = dist(p, at);
    if (d > tol) fail(`${label}: ${bone} puts ${joint} ${d.toFixed(3)} ft off`);
  }
  // every row a turn and one scale, which is all gl/figure-hd.js's dual-quaternion skinning can take
  for (let b = 0; b < 19; b++) {
    const o = b * 12, col = (j) => [rows[o + j], rows[o + 4 + j], rows[o + 8 + j]], C = [col(0), col(1), col(2)], L = C.map((v) => Math.hypot(...v));
    const dots = [[0, 1], [1, 2], [0, 2]].map(([i, j]) => Math.abs(C[i][0] * C[j][0] + C[i][1] * C[j][1] + C[i][2] * C[j][2]) / (L[i] * L[j]));
    if (Math.max(...L) - Math.min(...L) > 1e-4 * L[0] || Math.max(...dots) > 1e-4) { fail(`${label}: bone ${b}'s row isn't a turn and one scale`); break; }
  }
  for (const [S, side] of [['L', 1], ['R', -1]]) {
    const hb = FIGURE_BONE['hand' + S], fb = FIGURE_BONE['farm' + S];
    // round a bat, no finger in the handle
    if (J['grip' + S]) {
      const k0 = J.batKnob, d = J.batDir;
      let worst = Infinity;
      for (const p of GRIP_PTS[S]) {
        const w = atRow(rows, hb, p), v = [w[0] - k0[0], w[1] - k0[1], w[2] - k0[2]], t = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
        const r = Math.hypot(v[0] - d[0] * t, v[1] - d[1] * t, v[2] - d[2] * t);
        worst = Math.min(worst, r - HANDLE_R * s - FINGER_R * FT * s);
      }
      // the fingers' skin rests on the handle and the thumb lies clear of it (2026-11-15); more than a millimetre in
      // is a hand through the bat
      if (worst < -0.0035) fail(`${label}: a finger of the ${S} hand ${(-worst * 12).toFixed(2)} in into the bat's handle`);
    }
    // the forearm turned to meet its hand (gl/figure-hd.js handXf, by forearmTwist): once it's turned, nothing is
    // left between it and the hand but the wrist's bend, so the wrist doesn't wring
    const tw = forearmTwist(rows)[S];
    // how far a gripping wrist turns on its forearm, and for how long past a real wrist's (WRIST_KNOWN)
    if (run && J['grip' + S]) {
      const id = label.split('@')[0], w = (wristOf[id] ??= { worst: 0, run: 0 });
      run[S] = Math.abs(tw) > WRIST_MAX ? run[S] + 1 : 0;
      w.worst = Math.max(w.worst, Math.abs(tw) * 180 / Math.PI); w.run = Math.max(w.run, run[S]);
    } else if (run) run[S] = 0;
    const rot =(b) => { const o = b * 12, sc = Math.hypot(rows[o], rows[o + 1], rows[o + 2]); return [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows[o + i * 4 + j] / sc)); };
    const F = rot(fb), H = rot(hb), a = side * tw, c = Math.cos(a), sn = Math.sin(a), Ty = [[c, 0, sn], [0, 1, 0], [-sn, 0, c]];
    // the hand's turn on its forearm (Fᵀ H), less the forearm's own turn (· Tyᵀ): the wrist's bend alone
    const Rr = [0, 1, 2].map((i) => [0, 1, 2].map((j) => F[0][i] * H[0][j] + F[1][i] * H[1][j] + F[2][i] * H[2][j]));
    const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => Rr[i][0] * Ty[j][0] + Rr[i][1] * Ty[j][1] + Rr[i][2] * Ty[j][2]));
    const qw = Math.sqrt(Math.max(0, 1 + R[0][0] + R[1][1] + R[2][2])) / 2, left = 2 * Math.atan2((R[0][2] - R[2][0]) / (4 * Math.max(qw, 1e-6)), qw);
    if (Math.abs(left) > 0.03) fail(`${label}: the ${S} wrist is left ${(left * 180 / Math.PI).toFixed(1)}° wrung after the forearm's turn`);
  }
  // the head's middle where ballplayer-mesh.js head() puts it
  const kh = FT * s * headScaleOf(s), c = J.head.map((v, i) => v + sol.W.head[1][i] * (0.31 * s - 0.028 * kh) + sol.W.head[2][i] * 0.03 * s);
  const hc = atRow(rows, FIGURE_BONE.head, HEAD_BIND_C);
  if (dist(hc, c) > TOL) fail(`${label}: the head's middle ${dist(hc, c).toFixed(3)} ft off`);
  // no row may mirror what it carries
  for (const [name, b] of Object.entries(FIGURE_BONE)) if (b < 19 && det3(rows, b) <= 0) fail(`${label}: ${name}'s row turns it inside out`);
}

// 40 frames a clip: at 12, most of a swing's fastest frames fell between the samples
const STEPS = 40;
for (const [id, clip] of Object.entries(CLIPS)) {
  // each height's run through the clip keeps its own grip and its own count, as the park keeps a man's
  const runs = { 0.95: [{ L: false, R: false }, { L: 0, R: 0 }], 1.06: [{ L: false, R: false }, { L: 0, R: 0 }] };
  for (let i = 0; i <= STEPS; i++) {
    const t = (clip.duration * i) / STEPS;
    let pose;
    try { pose = sampleClip(clip, t); } catch (e) { fail(`${id}: sampleClip threw at ${t.toFixed(2)}: ${e.message}`); break; }
    for (const scale of [0.95, 1.06]) check(`${id}@${t.toFixed(2)} x${scale}`, { ...scalePose(pose, scale), at: [0, 0, 0], yaw: 0, scale, build: { sh: 1, girth: 0 } }, ...runs[scale]);
  }
}
if (process.env.WRIST_PRINT) console.log(JSON.stringify(Object.fromEntries(Object.entries(wristOf).filter(([, w]) => w.worst > 120).map(([id, w]) => [id, [Math.ceil(w.worst), w.run]]))));
for (const [id, w] of Object.entries(wristOf)) {
  const known = WRIST_KNOWN[id];
  if (!known) { if (w.worst > WRIST_MAX * 180 / Math.PI) fail(`${id}: a gripping wrist turned ${w.worst.toFixed(0)}° on its forearm (past ${Math.round(WRIST_MAX * 180 / Math.PI)}°)`); continue; }
  if (w.worst > known[0] + 1 || w.run > known[1]) fail(`${id}: a gripping wrist turned ${w.worst.toFixed(0)}°, ${w.run} frames past ${Math.round(WRIST_MAX * 180 / Math.PI)}°, worse than its known ${known[0]}° and ${known[1]}`);
}
for (const [name, P] of Object.entries(POSES)) check(`pose ${name}`, { ...scalePose(P(), 1), at: [0, 0, 0], yaw: 0, scale: 1, build: { sh: 1.04, girth: 0.05 } });

// The figures the park dresses (gl/ballpark-figures.js): the jersey, the umpire's shirt and the crew's, at both
// levels, the heaviest builds and the longest hair, under the cap. Each within its level's budget (about 28 men are
// on the field; `hd` is drawn only close up), and nothing of the hair standing above the cap's band.
const BUDGET = { hd: 26000, lite: 11500 };
const BAND = (a) => 1.684 - 0.03 * (1 - Math.cos(a)) / 2;
const { buildFigure } = await import('../../client/game/js/panels/figure.js');
const { ZC } = await import('../../client/game/js/panels/actor-head.js');
for (const cut of ['jersey', 'oxford', 'shortsleeve']) for (const level of ['hd', 'lite']) for (const [style, build, weight] of [[3, 'dadbod', 0.8], [2, 'average', 0.5]]) {
  const F = buildFigure({ cut, style, level, sculpt: true, head: 1, build, weight, gear: { belt: true }, beard: '', bottoms: '', hat: 'ballcap', scarf: '' });
  if (F.nt > BUDGET[level]) fail(`${cut} ${level} style ${style}: ${F.nt} triangles, over ${BUDGET[level]}`);
  const L = F.parts.find((p) => p.name === 'locks');
  if (L) for (let v = L.v0; v < L.v0 + L.nv; v++) {
    const x = F.P[v * 3], y = F.P[v * 3 + 1], z = F.P[v * 3 + 2];
    if (y > BAND(Math.atan2(x, z - ZC))) { fail(`${cut} ${level} style ${style}: a lock stands ${(y - BAND(Math.atan2(x, z - ZC))).toFixed(3)} m over the cap's band`); break; }
  }
}

// the pitcher's grips: one for every pitch type the flight knows, each a sound shape, and nothing else, so a new
// pitch can't come out of his hand in a four-seamer's grip by default unnoticed
{
  const { SPIN } = await import('../../client/game/js/panels/diamond/flight.js');
  const { PITCH_GRIPS, gripOf } = await import('../../client/game/js/panels/diamond/figure-rig.js');
  for (const t of Object.keys(SPIN)) if (!PITCH_GRIPS[t] || gripOf(t.toUpperCase()) !== PITCH_GRIPS[t]) fail(`grips: no grip for the ${t}`);
  for (const [t, g] of Object.entries(PITCH_GRIPS)) {
    if (!SPIN[t]) fail(`grips: the ${t} isn't a pitch the flight knows (flight.js SPIN)`);
    { const P = handPose(g); if (!(P.length === POSE_LEN && P.every(Number.isFinite))) fail(`grips: the ${t}'s shape isn't sound`); }
  }
  if (gripOf('FF') !== HAND_HOLD.ball || gripOf(null) !== HAND_HOLD.ball) fail('grips: an unknown pitch is a four-seamer');
}

if (fails.length) {
  console.log(`✗ figure-rig: ${fails.length}${fails.length >= 40 ? '+' : ''} failures over ${n} poses`);
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
