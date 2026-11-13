// ROOM's gaits (client/game/js/panels/actor-gait.js): every one poses without a NaN, walks a stride a
// person could, and keeps its planted foot planted. Slip is the lowest sole point's speed along the walk
// against the walk's own speed, as solveRoot pins it; the street's `walk` is about 0.07, and the gate
// fails a gait over 0.25. After changing a gait's numbers, run this.
import { actorStrideM, actorSkinAt } from '../../client/game/js/panels/actor3d.js';
import { GAIT_NAMES } from '../../client/game/js/panels/actor-gait.js';
import { FIGURE_BONES, figureSole } from '../../client/game/js/panels/figure.js';

const B = {};
FIGURE_BONES.forEach((b, i) => { B[b[0]] = i; });
const SOLE = figureSole(), BALL = FIGURE_BONES[B.toeL][2][2];
const at = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const N = 200, MAX = 0.25, problems = [];
for (const name of GAIT_NAMES.map((g) => 'walk' + g)) {
  const stride = actorStrideM(name);
  if (!(stride > 0.5 && stride < 1.9)) problems.push(`${name}: a stride of ${stride.toFixed(2)} m`);
  const frames = [];
  for (let i = 0; i <= N; i++) {
    const S = actorSkinAt(name, i / N), pts = [];
    if (S.some((m) => m.some((v) => !Number.isFinite(v)))) { problems.push(`${name}: a NaN at phase ${(i / N).toFixed(2)}`); break; }
    for (const [f, t, x] of [['footL', 'toeL', 0.095], ['footR', 'toeR', -0.095]]) for (const [z, y] of SOLE) pts.push(at(z > BALL ? S[B[t]] : S[B[f]], [x, y, z]));
    frames.push(pts);
  }
  if (frames.length <= N) continue;
  let slip = 0, where = 0;
  for (let i = 0; i < N; i++) {
    const a = frames[i], b = frames[i + 1];
    let k = 0;
    for (let j = 1; j < a.length; j++) if (a[j][1] < a[k][1]) k = j;
    const v = Math.abs(b[k][2] + stride / N - a[k][2]) * N / stride;
    if (v > slip) { slip = v; where = i / N; }
  }
  if (slip > MAX) problems.push(`${name}: the planted foot slides at ${slip.toFixed(2)} of the walk's speed at phase ${where.toFixed(2)}`);
}
if (problems.length) { console.error(`gaits: ${problems.length} problem(s)\n  ` + problems.join('\n  ')); process.exit(1); }
