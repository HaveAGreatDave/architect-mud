// padcatch — a lift-off off a rooftop helipad is not an arrival at it.
//
//   node scripts/shapes/padcatch.mjs
//   node scripts/shapes/padcatch.mjs --detail
//
// ⚠ THIS EXISTS BECAUSE THE SAME NINE LINES HAVE NOW SHIPPED BROKEN TWICE, THE SAME WAY BOTH TIMES.
// A rooftop pad lands you by catch volume, which means the climb-out flies straight up through the
// very column that grabs you, and the only thing between a take-off and being set straight back
// down is a departure latch. The first break was the latch reading a frame with no pad in the
// window as a departure. The second was subtler and is what this gate is really for: the latch
// cleared the instant you were outside the column, and on a tall tower the column is a LONG time —
//
//     the Solenne's deck is at 1,498 ft and its column 318 ft tall, 0.45 tiles wide, so a
//     helicopter climbing out at 800 fpm is inside it for 24 seconds and at 400 fpm for 48
//
// — which nobody holds half a tile of station through. Drift out, the latch says "departed"; drift
// back, the deck says "arrival" and puts you on the roof. For ever, if you kept taking off.
//
// So the gate flies the profiles rather than asserting the expression: a climb-out that wanders,
// a real approach, a hover, an overflight. The numbers it flies are the RENDERER's own column
// (ROOF_CATCH_R / ROOF_CATCH_CEIL_Z through altRestingOnZ), so a retune of the ring retunes the
// test with it and the two can never drift.
import { loadWindshield } from './dom-stub.mjs';
import { padCatchStep, ROOF_CATCH_VS, ROOF_DEPART_R, ROOF_DEPART_FT } from '../../client/game/js/panels/pad-catch.js';

const DETAIL = process.argv.includes('--detail');
const ws = await loadWindshield();
const { ROOF_CATCH_R, ROOF_CATCH_CEIL_Z, altRestingOnZ } = ws;
const padCeilFt = (padZ, padFt) => Math.max(60, altRestingOnZ(padZ + ROOF_CATCH_CEIL_Z) - padFt);

// The three real pad shapes in the game: a ground helipad, a low roof, and the Solenne's crown.
function padAt(z) {
  const padFt = altRestingOnZ(z);
  return { padZ: z, padFt, ceil: padCeilFt(z, padFt) };
}
let solZ = 0; { let lo = 0, hi = 20; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (altRestingOnZ(m) < 1498) lo = m; else hi = m; } solZ = (lo + hi) / 2; }
const PADS = [['ground pad', padAt(0)], ['low roof', padAt(1.0)], ['Solenne crown', padAt(solZ)]];

// Fly a profile at 4 Hz (the cockpit's own reconcile cadence is finer; this is the coarse case and
// the coarse case is the one that can step over a window). Each sample is [seconds, dist, altitude]
// resolved by the profile; `vs` is derived from the altitude the profile actually flew, never
// asserted alongside it, so a profile cannot claim to be climbing while standing still.
function fly(pad, profile, { departed = undefined, dt = 0.25, secs = 60 } = {}) {
  let prev = departed, lastAlt = null, caught = null;
  for (let t = 0; t <= secs; t += dt) {
    const p = profile(t, pad);
    if (!p) break;
    const vs = lastAlt == null ? 0 : (p.alt - lastAlt) / dt * 60;
    lastAlt = p.alt;
    const s = { onGround: !!p.onGround, altitude: p.alt, vs };
    const prox = p.prox === null ? null : { dist: p.dist, padFt: pad.padFt };
    const r = padCatchStep(prev, prox, pad.ceil, s, ROOF_CATCH_R);
    prev = r.departed;
    if (r.armed && !caught) caught = { t, dist: p.dist, alt: p.alt, vs };
  }
  return { caught, departed: prev };
}

const fails = [];
const check = (name, ok, detail) => {
  if (!ok) fails.push(`${name} — ${detail}`);
  if (DETAIL || !ok) console.log(`  ${ok ? '·' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};

for (const [label, pad] of PADS) {
  if (DETAIL) console.log(`\n${label}: deck ${pad.padFt.toFixed(0)} ft, column ${pad.ceil.toFixed(0)} ft tall, ${ROOF_CATCH_R} tiles wide`);

  // 1. THE BUG. Lift off the deck and climb out at 500 fpm while wandering a tile and a half off
  //    the pad and back — the ordinary shape of a helicopter departure. Nothing may catch us.
  const wanderClimb = (t) => ({
    onGround: t < 0.5,
    alt: pad.padFt + Math.max(0, (t - 0.5)) * (500 / 60),
    dist: Math.abs(Math.sin(t * 0.55)) * 1.5,
  });
  check(`${label}: wandering 500 fpm climb-out is never grabbed`,
    fly(pad, wanderClimb, { departed: false, secs: 90 }).caught === null,
    `column is ${(pad.ceil / 500 * 60).toFixed(0)} s tall at that rate`);

  // 2. The same climb-out from a latch nobody seeded — the parked-on-a-deck seed not having run is
  //    a real state (`roofDeparted` undefined), and `!== false` read it as clearance to grab.
  check(`${label}: climb-out with an unseeded latch is never grabbed`,
    fly(pad, wanderClimb, { departed: undefined, secs: 90 }).caught === null, '');

  // 3. A REAL ARRIVAL STILL WORKS, which is the regression this whole change risks. Fly in from
  //    four tiles out at pad height and descend the last of it — the deck must take us.
  const approach = (t) => ({ alt: pad.padFt + Math.max(0, 200 - t * 40), dist: Math.max(0, 4 - t * 0.5) });
  const arr = fly(pad, approach, { departed: undefined, secs: 40 });
  check(`${label}: a normal approach is still caught`, !!arr.caught,
    arr.caught ? `at ${arr.caught.t.toFixed(1)}s, ${arr.caught.dist.toFixed(2)} tiles, ${(arr.caught.alt - pad.padFt).toFixed(0)} ft over the deck` : 'NEVER CAUGHT');

  // 4. An approach that arrives from directly above — down the column, no lateral leg at all.
  const overhead = (t) => ({ alt: pad.padFt + pad.ceil + 400 - t * 60, dist: 0.05 });
  const ovh = fly(pad, overhead, { departed: undefined, secs: 40 });
  check(`${label}: a descent straight down the column is caught`, !!ovh.caught,
    ovh.caught ? `at ${(ovh.caught.alt - pad.padFt).toFixed(0)} ft over the deck` : 'NEVER CAUGHT');

  // 5. A hover held over the pad, arrived at from outside, is an arrival — no rate gate on a
  //    stationary aircraft, which is the contract the pad shipped with.
  const hoverIn = (t) => ({ alt: pad.padFt + 30, dist: Math.max(0.05, 3 - t * 0.6) });
  check(`${label}: a hover flown in from outside is caught`, !!fly(pad, hoverIn, { secs: 30 }).caught, '');

  // 6. Overflying the tower well above its column must not reach down for us.
  const over = (t) => ({ alt: pad.padFt + pad.ceil + ROOF_DEPART_FT + 200, dist: Math.abs(4 - t * 0.5) });
  check(`${label}: an overflight above the column is never grabbed`,
    fly(pad, over, { secs: 40 }).caught === null, '');

  // 7. Passing UNDER the deck (the street at the tower's foot) is not an arrival at its roof.
  if (pad.padFt > 200) {
    const under = (t) => ({ alt: 60, dist: Math.abs(4 - t * 0.5) });
    check(`${label}: passing below the deck is never grabbed`, fly(pad, under, { secs: 40 }).caught === null, '');
  }

  // 8. Sitting on the deck can never read as having departed it — the frame where a drifting climb
  //    finds a taller crown box under it sets onGround while the pad is still in the window.
  const parked = () => ({ onGround: true, alt: pad.padFt, dist: 0.02 });
  check(`${label}: parked on the deck never counts as departed`,
    fly(pad, parked, { departed: false, secs: 10 }).departed === false, '');
}

// The two buffers have to be buffers: a zero on either is the pre-fix behaviour wearing the new
// code's clothes, and every case above would still pass with the latch alone doing the work.
check('the vertical buffer is non-zero', ROOF_CATCH_VS > 0, `${ROOF_CATCH_VS} fpm`);
check('the departure margin is non-zero', ROOF_DEPART_R > 1 && ROOF_DEPART_FT > 0,
  `${(ROOF_CATCH_R * ROOF_DEPART_R).toFixed(2)} tiles / ${ROOF_DEPART_FT} ft`);

if (fails.length) {
  console.error(`\n✗ padcatch — ${fails.length} failure${fails.length === 1 ? '' : 's'}:`);
  for (const f of fails) console.error(`    ${f}`);
  process.exit(1);
}
const sol = PADS[2][1];
console.log(`✓ padcatch: ${PADS.length} pad heights — a climb-out is never taken for an arrival, and every approach still lands. `
  + `Solenne deck ${sol.padFt.toFixed(0)} ft, column ${sol.ceil.toFixed(0)} ft over ${(ROOF_CATCH_R * 2).toFixed(1)} tiles wide `
  + `(${(sol.ceil / 500 * 60).toFixed(0)} s of climb at 500 fpm).`);
