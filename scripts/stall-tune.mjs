// STALL / SINK-RATE diagnostic — the measurement rig for the AoA flight model.
//
// The flight model stalls on ANGLE OF ATTACK, not on airspeed (flight-model.js §6b), so the
// 1g stall speed, the accelerated stall speed and the post-stall sink are all OUTPUTS now.
// This harness measures them, per fixed-wing airframe, so a tuning change to aoaCrit, vs0,
// CL_COLLAPSE, MUSH_DEG or a type's ldMax can be checked instead of guessed at.
//
// It reports, per airframe:
//   · 1g STALL     — decelerate wings-level until she breaks; measured break speed vs the
//                    authored vs0, plus the g and AoA at the break.
//   · ACCELERATED  — hard pull out of a 55° bank at cruise. The old speed-triggered stall
//                    could NOT produce this at all; it must break well above the 1g speed,
//                    and near the √n rule (a 2g break sits at ~1.41 × Vs).
//   · MAX G        — peak load factor in a hard pull at cruise, against the type's gLimit.
//   · POST-STALL   — the settled sink in a held stall (now a consequence of the CL collapse,
//                    so it must differ per airframe) and the height lost recovering hands-off.
//   · RECOVERY     — seconds to unstall by (a) releasing the stick and (b) holding it, which
//                    must NOT recover: a held pull is a developed departure.
//   · SPIN/RUDDER  — yaw rate in a held departure with the pedals neutral vs full opposite.
//                    Opposite rudder is the recovery input and must substantially arrest it.
//
// Run:  node scripts/stall-tune.mjs

import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';

const DT = 1 / 60;
const airborne = (p, spd, alt = 6000) => {
  const s = createState(p);
  s.onGround = false; s.altitude = alt; s.airspeed = spd; s.rpm = 0.6; s.pitch = 0;
  return s;
};
const IN = (o = {}) => ({ elevator: 0, aileron: 0, throttle: 0.6, flaps: 0, pedal: 0, ...o });

// 1g break: idle power, wings level, a gentle pull to hold height as she decelerates.
function stall1g(p) {
  const s = airborne(p, p.cruise);
  for (let t = 0; t < 180; t += DT) {
    // Hold altitude with an increasing pull as the speed decays — the classic power-off stall entry.
    const elev = Math.min(1, Math.max(0, -s.vs / 400) + 0.06);
    step(s, IN({ elevator: elev, throttle: 0 }), p, DT);
    if (s.stalled) return { spd: s.airspeed, g: s.g, aoa: s.aoa, vs: s.vs, t };
  }
  return null;
}

// Accelerated break: full power, roll into a hard bank at cruise and haul.
function stallAccel(p) {
  const s = airborne(p, p.cruise);
  for (let t = 0; t < 60; t += DT) {
    const elev = t > 1.5 ? 1 : 0.1;
    step(s, IN({ elevator: elev, aileron: 1, throttle: 1 }), p, DT);
    if (s.stalled) return { spd: s.airspeed, g: s.g, aoa: s.aoa, bank: s.bank, t };
  }
  return null;
}

// Peak load factor in a hard wings-level pull from cruise (before any break).
function maxG(p) {
  const s = airborne(p, p.cruise); let peak = 0;
  for (let t = 0; t < 8; t += DT) { step(s, IN({ elevator: 1, throttle: 1 }), p, DT); peak = Math.max(peak, s.g); }
  return peak;
}

// Held LOW-SPEED departure — the classic one. Decelerate to the 1g stall first (a hard pull
// straight from cruise breaks at high speed and 2g, which is a different, much milder event),
// then hold full back stick and read the settled sink and the rotation.
function departure(p) {
  const s = airborne(p, p.cruise, 12000);
  let t = 0;
  for (; t < 120 && !s.stalled; t += DT) {
    const elev = Math.min(1, Math.max(0, -s.vs / 400) + 0.06);
    step(s, IN({ elevator: elev, throttle: 0 }), p, DT);
  }
  if (!s.stalled) return null;
  const entryAlt = s.altitude;
  const h0 = s.heading;
  const yawOf = (a, b) => ((b - a + 540) % 360) - 180;
  for (let i = 0; i < 180; i++) step(s, IN({ elevator: 1, throttle: 0 }), p, DT);   // 3 s held
  const sink = s.vs, stillStalled = s.stalled, heldYaw = yawOf(h0, s.heading) / 3;
  // Full opposite rudder against the rotation, stick still back. Signed, so an over-correction
  // reads as a sign flip rather than as a bigger number.
  const sr = JSON.parse(JSON.stringify(s)); const hr = sr.heading;
  for (let i = 0; i < 180; i++) step(sr, IN({ elevator: 1, throttle: 0, pedal: -Math.sign(sr.stallDir || -1) }), p, DT);
  const rudYaw = yawOf(hr, sr.heading) / 3;
  // Release the stick — she must unstall on her own.
  let rec = null;
  for (let i = 0; i < 60 * 30; i++) { step(s, IN({ elevator: 0, throttle: 0 }), p, DT); if (!s.stalled) { rec = i * DT; break; } }
  return { sink, stillStalled, heldYaw, rudYaw, rec, lost: entryAlt - s.altitude };
}

// Regression guards: these must NOT have moved much.
function levelTop(p, thr = 1) {
  const s = airborne(p, p.cruise * 0.5, 1000);
  for (let t = 0; t < 200; t += DT) step(s, IN({ throttle: thr }), p, DT);
  return s.airspeed;
}
function takeoffRoll(p) {
  const s = createState(p);
  for (let t = 0; t < 120; t += DT) {
    step(s, IN({ elevator: s.airspeed > p.vr ? 0.9 : (p.groundPitch ? -0.5 : 0), throttle: 1, flaps: 0.3 }), p, DT);
    if (s.altitude > 50) return { t, spd: s.airspeed };
  }
  return null;
}
function climbRate(p) {
  const s = airborne(p, p.cruise * 0.8, 500); let best = 0;
  for (let t = 0; t < 60; t += DT) { step(s, IN({ elevator: 0.35, throttle: 1 }), p, DT); best = Math.max(best, s.vs); }
  return best;
}

const n = (v, w = 5, d = 0) => String(v == null ? '—' : v.toFixed(d)).padStart(w);
console.log('\nSTALL / SINK DIAGNOSTIC — the stall is an AoA event, so every speed below is a MEASUREMENT\n' + '='.repeat(96));
for (const [, p] of Object.entries(TYPES)) {
  if (p.heli) continue;
  const s1 = stall1g(p), sa = stallAccel(p), dep = departure(p);
  console.log(`\n${p.name}  (authored vs0 ${p.vs0}kt · aoaCrit ${p.aoaCrit}° · cruise ${p.cruise}kt · gLimit ${p.gLimit ?? 4.4} · best glide ${p.bestGlide}kt)`);
  if (s1) console.log(`  1g STALL     break @${n(s1.spd)}kt (${(s1.spd / p.vs0).toFixed(2)}× vs0)   α ${n(s1.aoa, 4, 1)}°   ${s1.g.toFixed(2)}g`);
  if (sa) console.log(`  ACCELERATED  break @${n(sa.spd)}kt (${(sa.spd / p.vs0).toFixed(2)}× vs0)   α ${n(sa.aoa, 4, 1)}°   ${sa.g.toFixed(2)}g at ${Math.round(sa.bank)}° bank   [√n predicts ${(Math.sqrt(Math.max(1, sa.g)) * p.vs0).toFixed(0)}kt]`);
  else console.log('  ACCELERATED  no break — the airframe cannot reach aoaCrit at this speed');
  console.log(`  MAX G        ${maxG(p).toFixed(2)}g in a hard pull from cruise`);
  if (dep) console.log(`  DEPARTURE    held sink ${n(dep.sink)} fpm · still stalled after 3s: ${dep.stillStalled ? 'YES' : 'no'} · yaw ${n(dep.heldYaw, 6, 1)}°/s → ${n(dep.rudYaw, 6, 1)}°/s on full opposite rudder`);
  if (dep) console.log(`  RECOVERY     unstalls ${dep.rec == null ? 'NEVER hands-off (!)' : `${dep.rec.toFixed(1)}s after releasing the stick`} · ${Math.round(dep.lost)} ft lost`);
  const to = takeoffRoll(p);
  console.log(`  ENVELOPE     level top ${Math.round(levelTop(p))}kt · best climb ${Math.round(climbRate(p))} fpm · airborne+50ft in ${to ? to.t.toFixed(1) + 's' : 'NEVER'}`);
}
console.log('\n' + '='.repeat(96));
console.log('Sanity: the 1g break should land near 1.0× vs0; the accelerated break well above it and close to');
console.log('the √n prediction; a HELD stall must not self-recover, a RELEASED one must; and opposite rudder');
console.log('must cut the departure yaw substantially. Level top / climb / takeoff are the regression guards.\n');
