// GATE · DEADBALL'S PLAYERS AS THE CLOSE-UP FIGURE (diamond/figure-rig.js, docs/proposals/deadball-players-v2.md
// phase 1). Every clip in the library, sampled through, is solved by the rig as the park solves it and turned
// into the figure's bone rows, and each row must take the figure's own joint to where Deadball put that joint:
// the hips, knees and ankles, the shoulders, elbows and wrists, and the head where ballplayer-mesh.js puts the
// skull its caps are grown off. A row that missed would hang a limb off the wrong place, or a cap off the head.
// It also checks every row is finite and the limbs aren't mirrored (a row that turned a hand inside out).
//
// No DOM, no GL: node scripts/shapes/figure-rig.mjs

import { CLIPS } from '../../client/game/js/panels/diamond/clips.js';
import { sampleClip } from '../../client/game/js/panels/diamond/anim.js';
import { solvePose, boneFrames, BONES, FRAME_FLOATS, scalePose, POSES } from '../../client/game/js/panels/diamond/rig.js';
import { figureRows, atRow, FIG_JOINT, HEAD_BIND_C, headScaleOf, FIG_ROW_FLOATS, figureFit } from '../../client/game/js/panels/diamond/figure-rig.js';
import { FIGURE_BONE } from '../../client/game/js/panels/figure.js';
import { FT_M } from '../../client/shared/world-scale.js';

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
    const p = atRow(rows, FIGURE_BONE[bone], FIG_JOINT[joint]), d = dist(p, at);
    if (d > TOL) fail(`${label}: ${bone} puts ${joint} ${d.toFixed(3)} ft off`);
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

if (fails.length) {
  console.log(`✗ figure-rig: ${fails.length}${fails.length >= 40 ? '+' : ''} failures over ${n} poses`);
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
