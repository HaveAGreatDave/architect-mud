// Can a murmuration be thinned without anybody seeing it happen?
//
// The boids step is the one fauna cost the detail budget cannot reach: everything the controller in
// windshield.js gives back is FACES, and the simulation underneath is paid in full whichever rung a
// bird is drawn at. `show` makes it sheddable — and every way it can go wrong is either invisible
// in a still frame or invisible altogether.
//
// ⚠ THE FOUR THINGS THAT MUST BE TRUE, and why none of them can be seen in a screenshot:
//
//   nothing reseeds      the guard at the top of murmur() reseeds on a changed bird count, and a
//                        reseed teleports every SURVIVOR. A screenshot of a reseeded flock is a
//                        perfectly good picture of a murmuration — just not the same one, and the
//                        frame it happened on is the only evidence.
//   nothing blinks       a bird must reach transparent BEFORE it stops being stepped. A still frame
//                        cannot show an opacity that went from 0.4 to 0 between two frames.
//   nothing pops in      a returning bird must arrive at its own station at zero opacity, not
//                        resume from wherever it was abandoned several seconds ago.
//   no ghosts            a dormant bird holds a stale position. Left in the neighbour search, live
//                        birds separate from, align with and steer around something that is not in
//                        the sky — and NOTHING would look wrong. The flock would simply move a
//                        little incorrectly, for ever.
//
// The last one is the reason this file exists rather than a note saying it was checked by eye.
import { murmur, murmurReset, murmurStats, K_NEIGHBOURS } from '../../client/game/js/panels/murmur.js';

const problems = [];
const notes = [];
const REPORT = process.argv.includes('--report') || !!process.env.REPORT;

const OPT = { spread: 1.1, trail: 0.3 };
// Fly the flock so the trail is real and the stations mean something — a stationary cloud never
// builds a path, and the respawn-on-its-station check would then be testing the fallback.
const run = (key, n, frames, show, t0 = 1e6, cb = null) => {
  let t = t0, out = null;
  for (let f = 0; f < frames; f++) {
    t += 16.7;
    out = murmur(key, n, 100 + (t - 1e6) / 1000 * 0.55, 100, 1.4, 0, t, { ...OPT, show });
    if (cb) cb(out, f, t);
  }
  return { pts: out, t };
};
const snap = (pts) => pts.map((p) => ({ x: p.x, y: p.y, z: p.z, vis: p.vis, rank: p.rank }));
const visible = (pts) => pts.filter((p) => (p.vis ?? 1) > 0).length;

// ── 1. SHOW 1 IS THE FLOCK THAT SHIPPED, TO THE BIT ──────────────────────────
//
// ⚠ THE CHECK THAT MAKES THE WHOLE FEATURE FREE BY DEFAULT. Everything below is about what happens
// when it is USED; this is the one saying that a flock nobody thins is not paying for any of it,
// and it is an identity rather than a tolerance because there is no arithmetic it should have run.
{
  murmurReset();
  const a = run('id:a', 300, 200, 1).pts.map((p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.roll]);
  murmurReset();
  const b = run('id:a', 300, 200, undefined).pts.map((p) => [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.roll]);
  let worst = 0;
  for (let i = 0; i < a.length; i++) for (let k = 0; k < a[i].length; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
  if (!(worst === 0)) problems.push(`show 1 is not identical to no show at all — worst component differs by ${worst.toExponential(2)}, so an unthinned flock is being changed by a feature it is not using`);
  else notes.push('show 1 is bit-identical to an unthinned flock');
}

// ── 2. THINNING DOES NOT RESEED THE SURVIVORS ────────────────────────────────
//
// The defect this whole design exists to avoid: handing murmur() a smaller `n` trips
// `c.pts.length !== n` and rebuilds the cloud from scratch.
{
  murmurReset();
  const r = run('id:b', 400, 300, 1);
  const before = new Map(r.pts.map((p) => [p.rank, { x: p.x, y: p.y, z: p.z }]));
  // One frame at a lower show: a survivor must not have moved further than one step of flight.
  const after = murmur('id:b', 400, 100 + (r.t - 1e6) / 1000 * 0.55, 100, 1.4, 0, r.t + 16.7, { ...OPT, show: 0.5 });
  let worst = 0, worstRank = 0;
  for (const p of after) {
    if (!(p.vis > 0) || p.rank >= 0.5) continue;        // survivors only
    const q = before.get(p.rank); if (!q) continue;
    const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    if (d > worst) { worst = d; worstRank = p.rank; }
  }
  // One frame at cruise is about 0.018 tiles; a reseed scatters over the whole spread.
  if (!(worst < 0.05)) problems.push(`thinning moved a surviving bird ${worst.toFixed(3)} tiles in one frame (rank ${worstRank.toFixed(3)}) — the cloud is being reseeded, and every bird a player was looking at has teleported`);
  else notes.push(`survivors move at most ${worst.toFixed(4)} tiles on the frame the flock is thinned`);
}

// ── 3. NOBODY BLINKS OUT, AND NOBODY POPS IN ─────────────────────────────────
//
// ⚠ PER FRAME, NOT AT THE ENDS. Sampling the start and the end of a fade cannot tell a ramp from a
// step: both begin at 1 and end at 0. What says it is a ramp is that no single frame moved it far.
{
  murmurReset();
  run('id:c', 400, 200, 1);
  let worstDrop = 0, worstRise = 0;
  let prev = new Map(murmur('id:c', 400, 100, 100, 1.4, 0, 1e6 + 200 * 16.7, { ...OPT, show: 1 }).map((p) => [p.rank, p.vis]));
  let t = 1e6 + 200 * 16.7;
  for (let f = 0; f < 120; f++) {
    t += 16.7;
    const pts = murmur('id:c', 400, 100 + (t - 1e6) / 1000 * 0.55, 100, 1.4, 0, t, { ...OPT, show: f < 60 ? 0.4 : 1 });
    for (const p of pts) {
      const was = prev.get(p.rank);
      if (was == null) continue;
      const d = p.vis - was;
      if (d < 0) worstDrop = Math.max(worstDrop, -d);
      else worstRise = Math.max(worstRise, d);
    }
    prev = new Map(pts.map((p) => [p.rank, p.vis]));
  }
  // A 0.6 s fade at 60 fps is ~0.028 a frame. Anything approaching 1 is a bird appearing or
  // vanishing between two frames.
  if (!(worstDrop < 0.2)) problems.push(`a bird lost ${worstDrop.toFixed(2)} of its opacity in ONE frame — it is blinking out rather than fading`);
  else if (!(worstRise < 0.2)) problems.push(`a bird gained ${worstRise.toFixed(2)} of its opacity in ONE frame — it is popping in rather than fading`);
  else notes.push(`opacity moves at most ${Math.max(worstDrop, worstRise).toFixed(3)} a frame in either direction`);
}

// ── 4. A RETURNING BIRD ARRIVES WHERE IT BELONGS ─────────────────────────────
//
// ⚠ AND IT IS CHECKED AT THE MOMENT IT REAPPEARS, not once it has settled. A bird resumed from
// where it was abandoned is hauled back to its station by the home pull within a second or so, so
// a check run after the fade finds every bird in the right place whatever happened — and the flight
// across the sky, which is the actual defect, is over by then and invisible to it.
{
  murmurReset();
  run('id:d', 400, 200, 1);
  let t = 1e6 + 200 * 16.7;
  // Thin hard, hold long enough that the dropped birds are dormant and the flock has flown on.
  for (let f = 0; f < 320; f++) { t += 16.7; murmur('id:d', 400, 100 + (t - 1e6) / 1000 * 0.55, 100, 1.4, 0, t, { ...OPT, show: 0.3 }); }
  const cx = 100 + (t - 1e6) / 1000 * 0.55;
  const wasDormant = new Set(murmur('id:d', 400, cx, 100, 1.4, 0, t, { ...OPT, show: 0.3 }).filter((p) => !(p.vis > 0)).map((p) => p.rank));
  if (!wasDormant.size) problems.push('the respawn check is vacuous — nothing was dormant to bring back');
  else {
    t += 16.7;
    const back = murmur('id:d', 400, 100 + (t - 1e6) / 1000 * 0.55, 100, 1.4, 0, t, { ...OPT, show: 1 });
    // The flock's own extent, so "in the right place" is measured against the cloud rather than a
    // number: a returning bird must be inside it, not somewhere along the path it was left on.
    const live = back.filter((p) => p.vis > 0.5);
    const mx = live.reduce((a, p) => a + p.x, 0) / live.length, my = live.reduce((a, p) => a + p.y, 0) / live.length;
    const ext = Math.max(...live.map((p) => Math.hypot(p.x - mx, p.y - my)));
    let worst = 0, n = 0;
    for (const p of back) {
      if (!wasDormant.has(p.rank) || !(p.vis > 0)) continue;
      n++; worst = Math.max(worst, Math.hypot(p.x - mx, p.y - my));
    }
    if (!n) problems.push('the respawn check is vacuous — no dormant bird came back');
    else if (!(worst < ext * 1.15)) problems.push(`a returning bird arrived ${worst.toFixed(2)} tiles from the flock centre against an extent of ${ext.toFixed(2)} — it is resuming from where it was abandoned and flying back in, rather than being put on its station`);
    else notes.push(`${n} returning birds all arrive within ${(worst / ext).toFixed(2)}x the flock's own extent`);
    // …and at nothing, so the arrival cannot be seen.
    const loud = back.filter((p) => wasDormant.has(p.rank) && p.vis > 0.2).length;
    if (loud) problems.push(`${loud} returning bird(s) appeared at more than 0.2 opacity on their first frame — they pop in`);
  }
}

// ── 5. A DORMANT BIRD IS NOT A NEIGHBOUR ─────────────────────────
//
// See the ⚠ on `ghostRefs` in murmur.js for why this is structural rather than behavioural: both
// behavioural readings passed with every loop bound widened, one because the effect is ambiguous in
// sign and the other because topological neighbours can never reach a ghost far enough away to be
// unambiguous.
//
// ⚠ AND IT IS SAMPLED THROUGH THE TRANSITION, NOT AFTER IT — which is the difference between a
// check that catches this and one that cannot. A bird that has been dormant for a few seconds is a
// long way behind a flock that has flown on, so it is not among ANYBODY'S seven nearest and every
// bound in the file can be wrong without a single stale reference existing. The dangerous moment is
// the one just after it stops being flown, when it is still exactly where the cloud is. Settled
// first and then sampled, this missed three separate widenings; sampled every frame across the
// thin, it catches all of them.
{
  murmurReset();
  const a = run('id:e', 300, 300, 1);
  let t = a.t, worstGhost = 0, sawDormant = false, worstMisplaced = 0;
  for (let f = 0; f < 150; f++) {
    t += 16.7;
    murmur('id:e', 300, 100 + (t - 1e6) / 1000 * 0.55, 100, 1.4, 0, t, { ...OPT, show: 0.45 });
    const st = murmurStats();
    if (st.flown < st.birds) sawDormant = true;
    if (st.ghostRefs > worstGhost) worstGhost = st.ghostRefs;
    if (st.misplaced > worstMisplaced) worstMisplaced = st.misplaced;
  }
  // ⚠ AND THE SAME SWEEP AT A SIZE THAT SKIPS THE GRID. `gridFrom` is 80, so a 300-bird flock only
  // ever exercises the binned search and the brute-force fallback beside it is dead code to this
  // check — widening ITS bound was invisible until a small flock was added here. Two paths pick the
  // same neighbours by design; both have to be bounded to the live prefix.
  murmurReset();
  const sm = run('id:e2', 60, 200, 1);
  let t2 = sm.t, smallGhost = 0, smallDormant = false, smallMisplaced = 0;
  for (let f = 0; f < 150; f++) {
    t2 += 16.7;
    murmur('id:e2', 60, 100 + (t2 - 1e6) / 1000 * 0.55, 100, 1.4, 0, t2, { ...OPT, show: 0.45 });
    const st2 = murmurStats();
    if (st2.flown < st2.birds) smallDormant = true;
    if (st2.ghostRefs > smallGhost) smallGhost = st2.ghostRefs;
    if (st2.misplaced > smallMisplaced) smallMisplaced = st2.misplaced;
  }
  if (!smallDormant) problems.push('the small-flock ghost check is vacuous — nothing went dormant');
  else if (smallGhost) problems.push(`${smallGhost} neighbour reference(s) reached a dormant bird on the brute-force search path (a flock under gridFrom)`);
  else notes.push('the brute-force search path is bounded to the live prefix too');
  if (smallMisplaced || worstMisplaced) problems.push(`${smallMisplaced || worstMisplaced} bird(s) sat on the wrong side of the live/dormant split — the partition is not holding, so the flock is flying birds that are not there and skipping ones that are`);
  else notes.push('every bird is on the correct side of the live/dormant split, throughout');
  if (!sawDormant) problems.push('the ghost check is vacuous — nothing ever went dormant, so there was no stale index to find');
  else if (worstGhost) problems.push(`${worstGhost} neighbour reference(s) pointed at a bird that is not being flown — live birds are steering around something that is not in the sky, and nothing on screen would say so`);
  else notes.push(`across a thin to 0.45 and the ${Math.round(150 * 16.7)} ms after it, 0 neighbour references ever reached a dormant bird`);
}

// ── 5b. WHAT IS GIVEN UP IS SPREAD THROUGH THE CLOUD, NOT TAKEN OUT OF ONE PART OF IT ────
//
// ⚠ THE DIFFERENCE BETWEEN A THINNER FLOCK AND A FLOCK WITH A HOLE IN IT, and it is the reason
// `rank` is a golden-ratio sequence rather than the hash every other per-bird constant in this file
// uses. A hash is evenly distributed in VALUE, which is not the property wanted: what has to be
// even is every PREFIX of it, because the prefix is the set that stays. Swapping it for a hash
// changes nothing any other check here measures — the count is the same, the fade is the same,
// nothing is a ghost — and the cloud loses patches instead of getting sparser.
//
// ⚠ MEASURED AT THE MOMENT OF THINNING, on the positions the flock had while it was still whole.
// Sampled later it is circular: which birds are live decides where the live birds end up, so a
// clumpy draw settles into a perfectly even cloud that is simply smaller, and the hole — which is
// what a player would see appear — has closed by the time it is looked for.
{
  murmurReset();
  const whole = run('id:g', 600, 300, 1).pts;
  const SHOW = 0.5;
  // Octants of the cloud's own bounding box: enough cells to catch a patch, few enough that the
  // count in each is big enough to mean something.
  const mx = whole.reduce((a, p) => a + p.x, 0) / whole.length;
  const my = whole.reduce((a, p) => a + p.y, 0) / whole.length;
  const mz = whole.reduce((a, p) => a + p.z, 0) / whole.length;
  const cell = new Map();
  for (const p of whole) {
    const k = (p.x > mx ? 1 : 0) + (p.y > my ? 2 : 0) + (p.z > mz ? 4 : 0);
    const e = cell.get(k) || { all: 0, kept: 0 };
    e.all++; if (p.rank < SHOW) e.kept++;
    cell.set(k, e);
  }
  let worst = 0, worstAt = 0;
  for (const [k, e] of cell) {
    if (e.all < 20) continue;
    const d = Math.abs(e.kept / e.all - SHOW) / SHOW;
    if (d > worst) { worst = d; worstAt = k; }
  }
  if (!(worst < 0.25)) problems.push(`thinning to ${SHOW} kept ${((1 - worst) * SHOW * 100).toFixed(0)}% in one eighth of the cloud against ${SHOW * 100}% overall (octant ${worstAt}, out by ${(worst * 100).toFixed(0)}%) — it is taking a patch out rather than thinning evenly, and a hole is what a player would see`);
  else notes.push(`thinning to ${SHOW} keeps within ${(worst * 100).toFixed(0)}% of that share in every octant of the cloud`);
}

// ── 6. AND IT ACTUALLY SAVES THE THING IT EXISTS FOR ─────────────────────────
//
// ⚠ A THINNED FLOCK THAT STILL SIMULATES EVERYBODY IS THE WHOLE FEATURE DOING NOTHING, and it looks
// exactly like one that works — the picture is identical, because the picture is the live birds
// either way. Only the clock can tell them apart.
{
  const cost = (key, show) => {
    murmurReset();
    let t = 1e6;
    for (let f = 0; f < 120; f++) { t += 16.7; murmur(key, 1700, 100 + (t - 1e6) / 1000 * 0.55, 100, 1.4, 0, t, { ...OPT, show }); }
    let best = Infinity;
    for (let r = 0; r < 25; r++) {
      t += 16.7;
      const a = performance.now();
      murmur(key, 1700, 100 + (t - 1e6) / 1000 * 0.55, 100, 1.4, 0, t, { ...OPT, show });
      const d = performance.now() - a; if (d < best) best = d;
    }
    return best;
  };
  const full = cost('id:f1', 1);
  const half = cost('id:f2', 0.5);
  const ratio = half / full;
  if (!(ratio < 0.75)) problems.push(`thinning a 1,700-bird flock to half costs ${half.toFixed(2)} ms against ${full.toFixed(2)} full (${(ratio * 100).toFixed(0)}%) — the dormant birds are still being simulated, so the feature is buying nothing`);
  else notes.push(`1,700 birds: ${full.toFixed(2)} ms whole, ${half.toFixed(2)} ms at half (${(ratio * 100).toFixed(0)}%)`);
  const vis1 = visible(murmur('id:f2', 1700, 100, 100, 1.4, 0, 2e6, { ...OPT, show: 0.5 }));
  notes.push(`at show 0.5, ${vis1} of 1700 birds are flown`);
}

if (REPORT || problems.length) for (const n of notes) console.log('  · ' + n);
if (problems.length) {
  console.log(`✗ murmurthin — ${problems.length} problem(s):`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('✓ murmurthin — a flock thins without reseeding its survivors, nobody blinks out or pops in, a returning bird arrives on its own station at nothing, dormant birds are out of the neighbour search, and the simulation cost actually falls.');
