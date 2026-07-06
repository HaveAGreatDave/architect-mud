// Glide POLAR diagnostic — the honest measurement. For each fixed elevator hold, let the
// engine-off glide reach steady state, then read the settled airspeed + sink rate; the glide
// ratio there is horizontal-speed / sink. The best (max) ratio across the sweep is the real
// best-glide. Run on the BASELINE model (glideDrag unset ⇒ 0) to see what we actually have.
//   node scripts/glide-polar.mjs

import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';
const KT_PER_FPM = 1 / 101.33, DT = 0.05;

function steadyGlide(p, elevator) {
  const s = createState(p); s.onGround = false; s.altitude = 30000; s.airspeed = p.cruise;
  for (let t = 0; t < 60 && s.altitude > 100; t += DT) step(s, { elevator, aileron: 0, throttle: 0, flaps: 0 }, p, DT);
  const vKt = Math.max(0.1, -s.vs) * KT_PER_FPM;                 // sink as knots
  const hKt = Math.sqrt(Math.max(0, s.airspeed * s.airspeed - vKt * vKt));
  return { spd: s.airspeed, sink: -s.vs, ratio: hKt / vKt, stalled: s.stalled };
}

for (const [id, p] of Object.entries(TYPES)) {
  if (p.heli) continue;
  let best = { ratio: 0 };
  const pts = [];
  for (let e = -0.6; e <= 0.4; e += 0.05) {
    const g = steadyGlide(p, e);
    if (g.spd < p.vs0 * 0.9 || g.stalled) continue;            // ignore stalled/mush points
    pts.push(g);
    if (g.ratio > best.ratio) best = { ...best, ...g, e };
  }
  console.log(`\n${p.name} (stall ${p.vs0}kt, cruise ${p.cruise}kt):`);
  console.log(`  BEST GLIDE ≈ ${best.ratio.toFixed(1)}:1 at ${Math.round(best.spd)}kt (sink ${Math.round(best.sink)} fpm)`);
  const lo = pts[pts.length - 1], hi = pts[0];
  if (lo) console.log(`  slow end: ${lo.ratio.toFixed(1)}:1 @ ${Math.round(lo.spd)}kt   fast end: ${hi.ratio.toFixed(1)}:1 @ ${Math.round(hi.spd)}kt`);
}
console.log('');
