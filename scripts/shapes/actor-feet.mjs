// FEET ON THE FLOOR: every standing clip in client/game/js/panels/actor3d.js (and actor-moods.js) stood the way
// gl/room-people.js stands it, on its lowest sole point, and held to two things:
//
//   - a foot on the floor stays where it is: the middle of its contact patch (the sole points within a few
//     millimetres of the floor in two frames running) moves no faster than SLIDE. A foot pivoting on its ball turns
//     its patch about its middle, which is allowed; a foot dragged across the floor isn't.
//   - a foot that's meant to be down is down: neither foot's lowest point is ever more than FLOAT off the floor.
//
// On 2026-11-16 the Cherry Pit's dancers failed both by a long way: planted feet sliding at up to 4 m/s, the free
// foot hovering 7 cm, and plain `idle` held its relaxed foot 2.4 cm up for everybody standing in a room. The fix is
// actor-plant.js (plant, footwork in actor3d.js): a clip says where the feet are and the legs are solved to them.
// A clip that bends a knee or moves the hips by setting leg angles will fail here; plant it instead.
//
//   node scripts/shapes/actor-feet.mjs            # gate
//   node scripts/shapes/actor-feet.mjs --report   # every clip's numbers
//
// No DOM, no GL: it poses the clips with actorSkinAt, as the room does.
import { actorSkinAt, ACTOR_ROOM_CLIPS, ACTOR_CLIPS } from '../../client/game/js/panels/actor3d.js';
import { FIGURE_BONES, figureSole } from '../../client/game/js/panels/figure.js';

const REPORT = process.argv.includes('--report');
const SLIDE = 0.12;   // m/s: a dance's free foot swivelling on its ball is about 0.07 at the toe's edge
const FLOAT = 0.006;  // m
// Clips that take a foot off the floor on purpose, and why. Anything else that lifts one fails.
const LIFTS = {
  poleKick: 'the left leg kicks up in a fan',
  poleLean: 'the right leg is hooked round the pole',
  stumble: 'the right foot catches and comes up',
  coldStamp: 'stamping, each foot straight up and down',
  vatFloat: 'floating in the vat',
  sprawl: 'sprawled on the floor, the legs out',
  leanSmoke: 'leaning on a wall, the left foot up flat on it behind',
};
// Not standing on the soles: seated, lying, and the walks, which have their own gates (actors.mjs, gaits.mjs).
const SKIP = /^(sit|lie|sleep|walk)|Wide$/;

const B = {};
FIGURE_BONES.forEach((b, i) => { B[b[0]] = i; });
const REST = [];
FIGURE_BONES.forEach(([, p, o], i) => { REST[i] = p < 0 ? o.slice() : [REST[p][0] + o[0], REST[p][1] + o[1], REST[p][2] + o[2]]; });
const BALL = FIGURE_BONES[B.toeL][2];
// sole points in bind space, each with its bone: three lines along the shoe so a foot rolled onto an edge shows
const pts = { L: [], R: [] };
for (const [z, y] of figureSole(17)) for (const dx of [-0.03, 0, 0.03]) for (const s of ['L', 'R']) {
  const f = REST[B['foot' + s]];
  pts[s].push({ q: [f[0] + dx, y, z], bone: z > BALL[2] ? B['toe' + s] : B['foot' + s] });
}
const xf = (M, q) => [M[0] * q[0] + M[4] * q[1] + M[8] * q[2] + M[12], M[1] * q[0] + M[5] * q[1] + M[9] * q[2] + M[13], M[2] * q[0] + M[6] * q[1] + M[10] * q[2] + M[14]];

const N = 96, problems = [];
const seen = new Set();
for (const c of [...ACTOR_ROOM_CLIPS, ...ACTOR_CLIPS]) {
  if (SKIP.test(c.name) || seen.has(c.name)) continue;
  seen.add(c.name);
  const fr = [];
  for (let i = 0; i <= N; i++) {
    const S = actorSkinAt(c.name, i / N), o = {};
    if (S.some((m) => m.some((v) => !Number.isFinite(v)))) { problems.push(`${c.name}: a NaN at phase ${(i / N).toFixed(2)}`); break; }
    for (const s of ['L', 'R']) o[s] = pts[s].map(({ q, bone }) => xf(S[bone], q));
    o.drop = Math.min(...o.L.map((p) => p[1]), ...o.R.map((p) => p[1]));
    fr.push(o);
  }
  if (fr.length <= N) continue;
  const dt = c.dur / N;
  let slide = 0, slideAt = 0, float = 0, floatAt = 0;
  for (let i = 0; i < N; i++) {
    const a = fr[i], b = fr[i + 1];
    for (const s of ['L', 'R']) {
      const low = Math.min(...a[s].map((p) => p[1])) - a.drop;
      if (low > float) { float = low; floatAt = i / N; }
      let x0 = 0, z0 = 0, x1 = 0, z1 = 0, m = 0;
      for (let k = 0; k < a[s].length; k++) {
        const p = a[s][k], q = b[s][k];
        if (p[1] - a.drop < 0.004 && q[1] - b.drop < 0.004) { x0 += p[0]; z0 += p[2]; x1 += q[0]; z1 += q[2]; m++; }
      }
      if (m >= 2) { const v = Math.hypot(x1 - x0, z1 - z0) / m / dt; if (v > slide) { slide = v; slideAt = i / N; } }
    }
  }
  if (REPORT) console.log(`${c.name.padEnd(16)} slide ${(slide * 100).toFixed(1).padStart(6)} cm/s at ${slideAt.toFixed(2)}   float ${(float * 1000).toFixed(1).padStart(6)} mm at ${floatAt.toFixed(2)}${LIFTS[c.name] ? '   (lifts: ' + LIFTS[c.name] + ')' : ''}`);
  if (slide > SLIDE) problems.push(`${c.name}: a foot on the floor slides at ${slide.toFixed(2)} m/s at phase ${slideAt.toFixed(2)}; plant it (actor-plant.js)`);
  if (float > FLOAT && !LIFTS[c.name]) problems.push(`${c.name}: a foot hangs ${(float * 1000).toFixed(0)} mm off the floor at phase ${floatAt.toFixed(2)}; plant it, or add it to LIFTS with the reason`);
}
for (const k of Object.keys(LIFTS)) if (!seen.has(k)) problems.push(`LIFTS names ${k}, which isn't a standing clip any more`);
if (problems.length) { console.error(`actor-feet: ${problems.length} problem(s)\n  ` + problems.join('\n  ')); process.exit(1); }
