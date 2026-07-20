// Forward-slip verification harness. A slip must do ONE distinctive thing: make the aircraft
// SINK STEEPLY WITHOUT gaining speed (the crossed-control drag eats the descent's energy) — that's
// what makes it the approach-salvage / crosswind tool. This flies a steady powered approach with
// and without a slip (a held 20° bank + full OPPOSITE rudder) and prints steady-state sink + speed.
//
// PASS criteria per airframe:
//   · slip sink is clearly steeper (more negative vs) than the same approach un-slipped
//   · slip airspeed is NOT higher than un-slipped (ideally equal-or-lower) — you drop, you don't dive
//
// Run:  node scripts/slip-check.mjs

import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';

const DT = 0.05;

// A steady approach at part power; optionally crossed into a slip (hold 20° bank vs full opposite
// rudder). Force the bank each step to hold the slip attitude (isolating the slip's own effect from
// the roll controller), read the settled sink + airspeed.
function approach(p, slip) {
  const s = createState(p); s.onGround = false; s.altitude = 8000; s.airspeed = p.cruise * 0.9;
  let vs = 0, ias = 0;
  for (let t = 0; t < 50 && s.altitude > 600; t += DT) {
    if (slip) s.bank = -20;                                  // hold a 20° bank into the slip
    step(s, { elevator: 0, aileron: 0, throttle: 0.3, flaps: 0, pedal: slip ? 1 : 0 }, p, DT);
    vs = s.vs; ias = s.airspeed;
  }
  return { vs: Math.round(vs), ias: Math.round(ias), slip: +s.slip.toFixed(2) };
}

console.log('\nFORWARD-SLIP CHECK — a slip must SINK STEEPLY without gaining SPEED');
console.log('='.repeat(88));
console.log('aircraft     | clean:  sink(fpm)  speed(kt) | slipped:  sink(fpm)  speed(kt)  slip | verdict');
console.log('-'.repeat(88));
let allPass = true;
for (const [id, p] of Object.entries(TYPES)) {
  if (p.heli) continue;
  const a = approach(p, false), b = approach(p, true);
  const steeper = b.vs < a.vs - 100;          // clearly more sink
  const noSpeedGain = b.ias <= a.ias + 2;      // not faster (small tolerance)
  const pass = steeper && noSpeedGain;
  allPass = allPass && pass;
  console.log(`${p.name.padEnd(12)} | ${String(a.vs).padStart(7)}    ${String(a.ias).padStart(4)}      | ${String(b.vs).padStart(8)}    ${String(b.ias).padStart(4)}     ${b.slip.toFixed(2)} | ${pass ? 'PASS' : 'FAIL'}  ${steeper ? '' : '(not steeper) '}${noSpeedGain ? '' : '(sped up!)'}`);
}
console.log('='.repeat(88));
console.log(allPass ? 'ALL PASS — slips sink harder and never speed up.' : 'FAIL — see rows above.');
console.log('');
