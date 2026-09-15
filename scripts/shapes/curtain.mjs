// curtain — is the Architect's wall a thing a vehicle stops at, and is the gate still a way through?
//
//   node scripts/shapes/curtain.mjs
//   node scripts/shapes/curtain.mjs --detail
//
// ⚠ THIS EXISTS BECAUSE `flags.curtain` WAS A PICTURE AND NOTHING ELSE. The seal on the perimeter
// is 133 authored `blocked: true` exits, which stop a WALKER; both sims collide against BUILDING
// MASS, which a Curtain tile has none of. So for as long as there has been a truck, you could
// drive a forty-tonne rig through a floor-to-sky sheet of hard light and out into the waste, with
// the wall visibly in front of you the whole way. Nothing could have caught it: `shapes:smoke`
// asks whether a model throws, `glmesh` compares the mesh to the shape a building COLLIDES as —
// and the Curtain is not a building, so it was absent from both questions rather than wrong in
// either.
//
// What is gated here is the two-sided claim, because each half is a way of shipping the other
// broken: the wall stops you, AND the one break in it does not.
//
// ⚠ AND IT DRIVES THE SWEEP RATHER THAN ASSERTING THE EXPRESSION. `curtainTopZAt` is a POINT test
// with a thickness, and both sims sample four points along a frame's movement — so "is the band
// wide enough" is a question about the sampling, not about the band, and the only honest way to
// ask it is to cross the wall the way a vehicle crosses it. Restoring a zero-thickness plane
// passes every containment assertion anyone would write by hand and fails every case below.
import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';
import { blank } from '../lib/blank-scanner.mjs';

const DETAIL = process.argv.includes('--detail');
const ws = await loadWindshield();
const { curtainSegs, curtainTopZAt, curtainRoofFtAt, groundObstructionAt, CURTAIN_H, CURTAIN_HALF_W, TRUCK_STEP_Z } = ws;

const fails = [];
const check = (name, ok, detail = '') => {
  if (!ok) fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  else if (DETAIL) console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
};

// Every run a perimeter tile can carry. `curtainRun` returns the directions that CARRY ON the wall,
// so these are the sixteen subsets of nesw — and 'ns'/'ew' are the straight runs that make up
// almost all of the 63 authored tiles, while the corners and the endpoints are the ones where an
// arm rule can quietly be wrong.
const RUNS = [];
for (const n of ['', 'n']) for (const e of ['', 'e']) for (const s of ['', 's']) for (const w of ['', 'w']) RUNS.push(n + e + s + w);

const cell = (cur, extra = {}) => ({ kind: 'land', biome: 'wilds', cur, ...extra });

// ── 1. A VEHICLE CANNOT CROSS AN ARM ─────────────────────────────────────────
//
// Drive a straight line across the tile, perpendicular to the arm under test, at the sampling both
// sims use: four sub-samples per frame, and a frame's movement set to the WORST either sim gets
// near. A truck flat out is 0.86 tiles per second (`tileMph` 112, `topSpeed` 96), so a tenth of a
// tile in one frame is already a sixth of a second of frame time; an aircraft on the deck is a few
// hundredths. 0.25 is several times either, and is here so the gate fails before a player does.
const SWEEP = 4, WORST_FRAME = 0.25;
const STEP = WORST_FRAME / SWEEP;   // the finest either sim ever looks at its own path, on its worst frame
function crosses(cur, fromX, fromY, toX, toY, c = cell(cur)) {
  const L = Math.hypot(toX - fromX, toY - fromY);
  const ux = (toX - fromX) / L, uy = (toY - fromY) / L;
  // ⚠ THE WALK STARTS OFF THE GRID, AND THE FIRST CUT OF THIS FILE DID NOT. Stepping a path that is
  // symmetric about the wall in even fractions puts a sample EXACTLY on the wall's own line — so a
  // plane of ZERO thickness passed every crossing case, which is the harness agreeing with the bug
  // it was written to catch. (Found by mutation: setting the half-width to 0.0001 and getting a
  // green run.) The offset is a fraction of a step that divides nothing, so no sample lands on a
  // nice number; the invariant that actually guarantees a hit is asserted separately below.
  for (let d = STEP * 0.317; d <= L; d += STEP) {
    if (curtainTopZAt(0, 0, c, fromX + ux * d, fromY + uy * d) > 0) return true;
  }
  return false;
}

// The crossing for each arm: start outside the tile on one side of the arm's own line and finish
// outside on the other. An 'n' arm runs from the centre to the north edge, so it is crossed by
// going east-west through the northern half.
const CROSSING = {
  n: [-0.9, -0.25, 0.9, -0.25],
  s: [-0.9, 0.25, 0.9, 0.25],
  e: [0.25, -0.9, 0.25, 0.9],
  w: [-0.25, -0.9, -0.25, 0.9],
};

for (const cur of RUNS) {
  if (!cur) continue;                                  // curtainRun never returns '' (it falls back to 'ns')
  for (const d of cur) {
    check(`run '${cur}': the ${d} arm stops a vehicle`, crosses(cur, ...CROSSING[d]),
      `crossed at ${WORST_FRAME} tiles/frame × ${SWEEP} samples and never touched it`);
  }
  // …and the mirror: an arm that is NOT in the run must not be there. This is the "no stray stub
  // poking into empty air" half of the drawing rule, checked from the collision side — a corner
  // that blocked all four ways would wall off a tile the wall only turns on.
  for (const d of 'nesw') {
    if (cur.includes(d)) continue;
    // A single-arm run pairs nothing, so its half-arm still starts at the centre: crossing the
    // OPPOSITE half at a quarter tile out is clear of it either way.
    check(`run '${cur}': there is no ${d} arm`, !crosses(cur, ...CROSSING[d]),
      'the wall reaches into a direction it does not continue in');
  }
}

// ── 2. A STRAIGHT RUN IS ONE UNBROKEN SPAN ───────────────────────────────────
// The arms pair at the centre precisely so a straight run has no seam in it. A gap of one sample
// in the middle of a perimeter is a gap a rig finds.
for (const [cur, ax] of [['ns', 'y'], ['ew', 'x']]) {
  let gap = null;
  for (let t = -0.5; t <= 0.5 + 1e-9; t += 0.01) {
    const z = ax === 'y' ? curtainTopZAt(0, 0, cell(cur), 0, t) : curtainTopZAt(0, 0, cell(cur), t, 0);
    if (z <= 0) { gap = t; break; }
  }
  check(`run '${cur}' is solid edge to edge`, gap === null, gap === null ? '' : `a hole at ${ax} = ${gap.toFixed(2)}`);
}

// ── 3. DRIVING ALONGSIDE IT IS NOT DRIVING INTO IT ───────────────────────────
// The wall stands on the tile's centre line, so the tile's own body either side of it is ground you
// can be on. A band that grew to swallow the tile would pass every case above and make the whole
// perimeter impassable a tile early.
check('a tile is clear either side of the wall',
  curtainTopZAt(0, 0, cell('ns'), 0.3, 0) === 0 && curtainTopZAt(0, 0, cell('ns'), -0.3, 0) === 0,
  `half-width ${CURTAIN_HALF_W} has spread across the tile`);
check('the field is thin enough to stop AT rather than short of',
  CURTAIN_HALF_W > 0 && CURTAIN_HALF_W < 0.12, `${CURTAIN_HALF_W} tiles`);
// ⚠ AND THE OTHER END OF THE SAME NUMBER, WHICH IS THE ONE THE CROSSINGS ABOVE CANNOT PROVE. Those
// walk a particular path and can only ever say "this line hit it"; what stops EVERY line hitting it
// is that the field is wider than the gap between two sub-samples. Stated rather than sampled,
// because a crossing test that happens to land on the plane passes with no thickness at all.
check('the field is wider than a frame of sampling',
  CURTAIN_HALF_W * 2 > STEP, `${(CURTAIN_HALF_W * 2).toFixed(3)} tiles thick against ${STEP.toFixed(3)} between samples`);

// ── 4. THE GATE IS THE ONE BREAK, AND IT STAYS OPEN ──────────────────────────
//
// ⚠ THE GATE TILE CARRIES `cur`. `deriveSurfaceCell` hands a `perimeter_gate` tile the run of its
// Curtain neighbours so the flanking wall butts into the pylons instead of stopping a tile short —
// which makes it the one tile in the world whose `cur` must NOT be solid. The renderer already
// decides this (`mark === 'gate'` takes the drawSouthGate branch and never reaches the wall), and
// the probe reads the same mark. Get this wrong and the perimeter has no way through it at all.
const gate = cell('ew', { mark: 'gate' });
check('the perimeter gate is open to a vehicle', !crosses('ew', 0, -0.9, 0, 0.9, gate),
  'the one break in the Curtain has been sealed');
check('the gate reports no obstruction at all',
  groundObstructionAt(0, 0, gate, 0, 0, 0.01, TRUCK_STEP_Z) === 0 && curtainRoofFtAt(0, 0, gate, 0, 0) === 0, '');

// ── 5. THE TRUCK PROBE CARRIES IT, AND NEITHER GATE LETS YOU PAST ────────────
//
// `groundObstructionAt` has two ways of answering "clear" that are right for buildings and would be
// wrong here: `clearZ` (a segment whose underside is above your roof is an archway) and `stepZ` (a
// segment whose top is below your step-over is a kerb). The Curtain runs from the ground to 0.9 of
// a world-z, so it is neither, and both have to be tested rather than assumed — a wall you can
// drive under is the same bug as a wall you can drive through.
const wall = cell('ns');
check('the truck probe sees the wall', groundObstructionAt(0, 0, wall, 0, 0, 0.01, TRUCK_STEP_Z) === CURTAIN_H, '');
check('you cannot drive UNDER the wall', groundObstructionAt(0, 0, wall, 0, 0, 0.0001, 0) === CURTAIN_H, '');
check('you cannot ride OVER the wall', groundObstructionAt(0, 0, wall, 0, 0, 0.01, 0.5) === CURTAIN_H, '');
check('and the road beside it is still road', groundObstructionAt(0, 0, wall, 0.3, 0, 0.01, TRUCK_STEP_Z) === 0, '');

// ── 6. THE AIRCRAFT PROBE ANSWERS IN THE ALTITUDE FRAME ──────────────────────
//
// ⚠ AND IT IS A LOW OBSTACLE THERE, WHICH IS THE RIGHT ANSWER RATHER THAN A BUG. `altForRoofZ` is
// the eye-height curve read backwards and it is quadratic, so 0.9 world-z — taller than any
// building on the outskirts it stands among — is ~27 real feet, against a six-storey office's 184.
// That is exactly the picture: a pilot a few hundred feet up is far above the shimmer plane and
// flies over it. What the probe stops is going THROUGH it on the deck.
const curFt = curtainRoofFtAt(0, 0, wall, 0, 0);
check('the wall has a real roof in feet', curFt > 0, `${curFt.toFixed(1)} ft`);
check('and it is low enough to fly over', curFt < 120, `${curFt.toFixed(1)} ft — the perimeter has become a ceiling`);
check('clear air beside it', curtainRoofFtAt(0, 0, wall, 0.3, 0) === 0, '');
// A cell with no Curtain on it must be untouched by any of this — every ordinary tile in the world
// goes through `groundObstructionAt`, and a probe that answered on one of them would be a wall
// across the city.
check('an ordinary tile is not a wall',
  curtainTopZAt(0, 0, { kind: 'land', biome: 'citycore' }, 0, 0) === 0
  && curtainTopZAt(0, 0, null, 0, 0) === 0, '');

// ── 6b. …AND THE CFIT SWEEP ACTUALLY ASKS IT ─────────────────────────────────
//
// Everything above holds the PROBE. The aircraft half is one `Math.max` inside cockpit.js's
// collision sweep, and that file is a DOM-heavy panel there is no way to drive from here — so the
// one thing worth gating is that the call is still in it. `imports:smoke` proves the name resolves;
// this proves somebody is using it. Comments are blanked first, or the paragraph explaining the
// call would satisfy the check on its own. (Same shape as `gl:opts`, same reason.)
{
  const src = blank(readFileSync(new URL('../../client/game/js/panels/cockpit.js', import.meta.url), 'utf8'));
  check('the aircraft CFIT sweep consults the Curtain', /curtainRoofFtAt\s*\(/.test(src),
    'cockpit.js no longer probes it — an aeroplane flies through the perimeter again');
}

// ── 7. THE ARMS ARE ONE LIST ─────────────────────────────────────────────────
// The renderer and the probes read `curtainSegs`; this is the shape of what it returns, so a
// rewrite that quietly changed the frame (tile-absolute instead of tile-relative, say) fails here
// rather than by moving the wall half a tile off the picture.
for (const cur of RUNS.filter(Boolean)) {
  const segs = curtainSegs(cur);
  const axes = (cur.includes('n') || cur.includes('s') ? 1 : 0) + (cur.includes('e') || cur.includes('w') ? 1 : 0);
  check(`run '${cur}' draws one arm per axis`, segs.length === axes, `${segs.length} segments for ${axes} axes`);
  for (const s of segs) {
    check(`run '${cur}' stays inside its own tile`, s.every((v) => Math.abs(v) <= 0.5 + 1e-9), JSON.stringify(s));
    check(`run '${cur}' has no zero-length arm`, Math.hypot(s[2] - s[0], s[3] - s[1]) > 0.4, JSON.stringify(s));
  }
}

if (fails.length) {
  console.error(`\n✗ curtain — ${fails.length} failure${fails.length === 1 ? '' : 's'}:`);
  for (const f of fails) console.error(`    ${f}`);
  process.exit(1);
}
console.log(`✓ curtain: ${RUNS.length - 1} runs × 4 arms crossed at ${WORST_FRAME} tiles/frame — the wall stops a vehicle `
  + `(${CURTAIN_H} world-z, ${curFt.toFixed(0)} ft to the altimeter, ${(CURTAIN_HALF_W * 2).toFixed(2)} tiles thick) `
  + `and the perimeter gate is still a way through.`);
