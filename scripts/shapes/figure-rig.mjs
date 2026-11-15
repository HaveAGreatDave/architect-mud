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
import { figureRows, atRow, FIG_JOINT, HEAD_BIND_C, headScaleOf, FIG_ROW_FLOATS, figureFit, forearmTwist, HAND_HOLD } from '../../client/game/js/panels/diamond/figure-rig.js';
import { FIGURE_BONE } from '../../client/game/js/panels/figure.js';
import { bendPoint } from '../../client/game/js/panels/gl/figure-hands.js';
import { FT_M } from '../../client/shared/world-scale.js';

// The skin of a hand round a bat, in its bind space: the built figure's own finger and thumb vertices (figure.js tags
// them in aux, -(1 + finger + 0.9 t)), bent as the shader bends them (gl/figure-hands.js bendPoint). The left hand's;
// the right's is its mirror. On the skin, so touching the handle is 0.
const FINGER_R = 0;
const GRIP_PTS = await (async () => {
  const { buildFigure } = await import('../../client/game/js/panels/figure.js');
  const F = buildFigure({ cut: 'jersey', style: 0, level: 'hd', sculpt: true, head: 1, build: 'average', weight: 0.5, gear: { belt: true }, beard: '', bottoms: '', hat: 'ballcap', scarf: '' });
  const out = { L: [], R: [] };
  for (let v = 0; v < F.nv; v++) {
    const a = F.A[v];
    if (a > -0.5 || F.P[v * 3] < 0.1) continue;
    const q = -a - 1, f = Math.floor(q + 1e-4), t = Math.min(1, Math.max(0, (q - f) / 0.9));
    const p = bendPoint([F.P[v * 3], F.P[v * 3 + 1], F.P[v * 3 + 2]], 1, Math.min(4, f), t, HAND_HOLD.bat);
    out.L.push(p); out.R.push([-p[0], p[1], p[2]]);
  }
  return out;
})();
// the bat's handle (ballplayer-mesh.js bat): its radius in feet, a unit of scale, where the hands go
const HANDLE_R = 0.046;
// Ry about the forearm's line through the wrist, in bind space, as gl/figure-hd.js handXf turns a forearm
const turnY = (p, a, side) => { const c = Math.cos(a), s = Math.sin(a), x = p[0] - side * 0.195, z = p[2] + 0.01; return [side * 0.195 + c * x + s * z, p[1], -0.01 - s * x + c * z]; };

const FT = 1 / FT_M;
const fails = [];
const fail = (m) => { if (fails.length < 40) fails.push(m); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const frames = new Float32Array(BONES.length * FRAME_FLOATS), rows = new Float32Array(FIG_ROW_FLOATS);
// how far a joint may land from Deadball's, in feet: a hundredth of a foot is float noise
const TOL = 0.01;
const det3 = (r, b) => { const o = b * 12, a = (i, j) => r[o + i * 4 + j]; return a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)); };

let n = 0;
function check(label, pose) {
  const sol = solvePose(pose);
  boneFrames(sol, frames);
  figureRows(sol, frames, figureFit({ role: 'player' }), rows);
  n++;
  for (let i = 0; i < rows.length; i++) if (!Number.isFinite(rows[i])) { fail(`${label}: row ${Math.floor(i / 12)} not finite`); return; }
  const J = sol.J, s = sol.s;
  const want = [
    ['pelvis', 'pelvis', J.pelvis], ['neck', 'neck', J.neck],
    ['thighL', 'thighL', J.hipL], ['thighR', 'thighR', J.hipR], ['shinL', 'shinL', J.knL], ['shinR', 'shinR', J.knR],
    ['footL', 'footL', J.anL], ['footR', 'footR', J.anR],
    ['uarmL', 'uarmL', J.shL], ['uarmR', 'uarmR', J.shR], ['farmL', 'farmL', J.elL], ['farmR', 'farmR', J.elR],
    ['handL', 'handL', J.wrL], ['handR', 'handR', J.wrR],
    // a limb's end on its parent: the knee by the thigh, the ankle by the shin, the elbow and wrist the same
    ['thighL', 'shinL', J.knL], ['thighR', 'shinR', J.knR], ['shinL', 'footL', J.anL], ['shinR', 'footR', J.anR],
    ['uarmL', 'farmL', J.elL], ['uarmR', 'farmR', J.elR], ['farmL', 'handL', J.wrL], ['farmR', 'handR', J.wrR],
  ];
  for (const [bone, joint, at] of want) {
    // a hand round a bat hangs by its grip, on the handle, and its wrist meets the forearm within about a centimetre
    const tol = (bone === 'handL' && J.gripL) || (bone === 'handR' && J.gripR) ? 0.035 : TOL;
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
    const tw = forearmTwist(rows)[S], rot = (b) => { const o = b * 12, sc = Math.hypot(rows[o], rows[o + 1], rows[o + 2]); return [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows[o + i * 4 + j] / sc)); };
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

const STEPS = 12;
for (const [id, clip] of Object.entries(CLIPS)) {
  for (let i = 0; i <= STEPS; i++) {
    const t = (clip.duration * i) / STEPS;
    let pose;
    try { pose = sampleClip(clip, t); } catch (e) { fail(`${id}: sampleClip threw at ${t.toFixed(2)}: ${e.message}`); break; }
    for (const scale of [0.95, 1.06]) check(`${id}@${t.toFixed(2)} x${scale}`, { ...scalePose(pose, scale), at: [0, 0, 0], yaw: 0, scale, build: { sh: 1, girth: 0 } });
  }
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

if (fails.length) {
  console.log(`✗ figure-rig: ${fails.length}${fails.length >= 40 ? '+' : ''} failures over ${n} poses`);
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
