// THE STREET CUT DOWN FROM THE CLOSE-UP FIGURE (actor3d.js ACTOR_BAKE.hd).
//
//   node scripts/shapes/actors-hd.mjs            # gate
//   node scripts/shapes/actors-hd.mjs --report   # the numbers behind it
//
// This turns the switch on (it's on in the game too, but the gate shouldn't depend on that) and checks
// what the street gets: a near and a far body for every silhouette,
// each inside its triangle budget and the guaranteed texture size, finite, standing on the ground,
// the near bodies on one ground so the one set of head bones fits all of them, the body types
// actually moving the mesh, and every cut a street person can roll landing on one of them.
import { actorBake, actorBakeReset, actorSilhouette, ACTOR_BAKE, ACTOR_SILHOUETTES } from '../../client/game/js/panels/actor3d.js';
import { FIGURE_CIVIL_CUTS } from '../../client/game/js/panels/figure.js';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };

const wasOn = ACTOR_BAKE.hd;
actorBakeReset();
ACTOR_BAKE.hd = true;
const t0 = performance.now();
const bk = actorBake();
report(`baked ${bk.sils.length} silhouettes in ${(performance.now() - t0).toFixed(0)} ms`);

if (!bk.sils || bk.sils.length !== ACTOR_SILHOUETTES.length) problems.push(`the bake has ${bk.sils?.length} silhouettes; expected ${ACTOR_SILHOUETTES.length}`);
if (bk.sils && bk.sils[0].pos !== bk.pos) problems.push('the bake itself is not its first silhouette');

let bytes = 0;
function check(b, label, maxT) {
  const { nv, nt, W, H, rows, frames, preview } = b;
  bytes += b.pos.byteLength + b.nrm.byteLength;
  report(`${label}: ${nv} vertices, ${nt} triangles, ${W}×${H} texels, top ${b.top.toFixed(3)} m`);
  if (nt > maxT) problems.push(`${label} has ${nt} triangles; the budget is ${maxT}`);
  if (W > 2048 || H > 2048) problems.push(`${label}'s pose texture is ${W}×${H}, past WebGL2's guaranteed 2048`);
  if (W * rows < nv) problems.push(`${label}: ${W}×${rows} texels a frame can't hold ${nv} vertices`);
  if (nv >= 65536) problems.push(`${label} has ${nv} vertices, too many for UNSIGNED_SHORT`);
  let bad = 0;
  for (let i = 0; i < preview.length; i++) if (!Number.isFinite(preview[i])) bad++;
  if (bad) problems.push(`${label} has ${bad} non-finite coordinates`);
  for (let i = 0; i < b.idx.length; i++) if (b.idx[i] >= nv) { problems.push(`${label} indexes past its vertices`); break; }
  if (!(b.top > 1.65 && b.top < 1.9)) problems.push(`${label} stands ${b.top.toFixed(3)} m tall; the sizing in windshield.js assumes about 1.75`);
  // the idle's first frame stands on the ground: its lowest point within a few millimetres of zero
  const r0 = b.clips.idle.row0;
  let low = Infinity;
  for (let v = 0; v < nv; v++) low = Math.min(low, preview[(r0 * nv + v) * 3 + 1]);
  if (Math.abs(low) > 0.02) problems.push(`${label}'s lowest point at idle is ${low.toFixed(3)} m off the ground`);
  return frames;
}
for (const [s, S] of (bk.sils || []).entries()) {
  const name = ACTOR_SILHOUETTES[s].name;
  check(S, `${name} near`, 3600);
  if (!S.far) { problems.push(`${name} has no far body`); continue; }
  // the far body keeps the old head's lump on top of its 430
  check(S.far, `${name} far`, 700);
  if (Math.abs(S.far.top - S.top) > 0.03) problems.push(`${name}'s far body stands ${S.far.top.toFixed(3)} m against its near ${S.top.toFixed(3)}; the swap would pop`);
  if (s && S.ground !== bk.sils[0].ground) {
    let d = 0;
    for (let f = 0; f < S.ground.length; f++) d = Math.max(d, Math.abs(S.ground[f] - bk.sils[0].ground[f]));
    if (d > 1e-6) problems.push(`${name} stands on its own ground, so the heads won't fit it`);
  }
  let moved = 0;
  for (let i = 0; i < S.body.length; i++) moved = Math.max(moved, Math.abs(S.body[i]));
  if (moved < 0.02) problems.push(`${name}'s body types move it at most ${moved.toFixed(3)} m: they've come out flat`);
  for (const k of ['walk', 'idle', 'wave', 'talk', 'listen', 'wait', 'phone', 'smoke', 'sit', 'cheer']) if (!S.clips[k]) problems.push(`${name} has no ${k} clip`);
}
report(`${(bytes / 1e6).toFixed(1)} MB of pose textures`);

const seen = new Set();
for (const c of FIGURE_CIVIL_CUTS) {
  const s = actorSilhouette(c);
  if (!(s >= 0 && s < ACTOR_SILHOUETTES.length)) problems.push(`the cut ${c} has no silhouette (${s})`);
  seen.add(s);
  report(`  ${c} → ${ACTOR_SILHOUETTES[s]?.name}`);
}
for (let s = 0; s < ACTOR_SILHOUETTES.length; s++) if (!seen.has(s)) problems.push(`no street cut wears the ${ACTOR_SILHOUETTES[s].name} silhouette, so its bake is wasted`);

ACTOR_BAKE.hd = false;
if (actorSilhouette('trench') !== 0) problems.push('with the switch off a cut still picks a silhouette other than the coat');
ACTOR_BAKE.hd = wasOn;
actorBakeReset();

if (problems.length) {
  console.error(`actors-hd: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
