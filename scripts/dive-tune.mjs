// Dive-shed TUNING harness. The `diveShed` knob (flight-model.js) is a FEEL fudge: how much
// parasitic drag a nose-down attitude deletes to make a dive accelerate. High values fake punch
// by removing drag; low values lean on the real energy loop (gravity-along-γ trades height for
// speed). This measures, per fixed-wing airframe and per candidate diveShed:
//   · level top speed at full power  — MUST be identical across diveShed (the term is 0 at pitch≥0)
//   · terminal speed in a held 30° and 45° dive at full power, and a 40° DEAD-STICK dive
// so we can pick the lowest diveShed where a committed dive still builds briskly toward Vne
// (not floaty) — i.e. where real gravity, not deleted drag, is carrying the dive.
//
// Run:  node scripts/dive-tune.mjs

import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';

const DT = 0.05;
const clone = (p, over) => ({ ...p, ...over });

// Terminal airspeed in a HELD dive: force the nose-down attitude each step (isolating the
// drag/gravity/thrust balance from the pitch controller) and run to steady state.
function diveTerminal(p, deg, thr) {
  const s = createState(p); s.onGround = false; s.altitude = 34000; s.airspeed = p.cruise; s.rpm = thr;
  let last = 0;
  for (let t = 0; t < 90 && s.altitude > 400; t += DT) {
    s.pitch = -deg;                                   // hold the dive attitude
    step(s, { elevator: 0, aileron: 0, throttle: thr, flaps: 0 }, p, DT);
    last = s.airspeed;
  }
  return last;
}
// Level top speed at a throttle setting (diveShed-independent sanity: pitch≈0 → no dive shed).
function levelTop(p, thr = 1) {
  const s = createState(p); s.onGround = false; s.altitude = 1000; s.airspeed = p.cruise * 0.5;
  for (let t = 0; t < 150; t += DT) step(s, { elevator: 0, aileron: 0, throttle: thr, flaps: 0 }, p, DT);
  return s.airspeed;
}

const SHEDS = [0.9, 0.6, 0.35, 0.2, 0.0];   // 0.9 = old hardcoded fudge; 0.0 = pure physics
console.log('\nDIVE-SHED TUNING — how much a nose-down attitude fakes drag away (lower = real gravity carries the dive)');
console.log('='.repeat(104));
console.log('Per airframe: cruise / Vne / level-top(full).  Then per diveShed: 30°dive / 45°dive @full · 40°dead-stick  (kt)');
console.log('-'.repeat(104));
for (const [id, p] of Object.entries(TYPES)) {
  if (p.heli) continue;
  const top = Math.round(levelTop(p));
  console.log(`\n${p.name.padEnd(11)} cruise ${p.cruise}  Vne ${p.vne}  level-top(full) ${top}kt`);
  for (const shed of SHEDS) {
    const tp = clone(p, { diveShed: shed });
    const d30 = Math.round(diveTerminal(tp, 30, 1));
    const d45 = Math.round(diveTerminal(tp, 45, 1));
    const dds = Math.round(diveTerminal(tp, 40, 0));
    const pctVne = Math.round((d45 / p.vne) * 100);
    console.log(`   diveShed ${shed.toFixed(2)} :  30°=${String(d30).padStart(3)}  45°=${String(d45).padStart(3)} (${pctVne}% Vne)  · dead-stick40°=${String(dds).padStart(3)}`);
  }
}
console.log('\n' + '='.repeat(104));
console.log('Pick the lowest diveShed where 45°@full still reaches a healthy %Vne (dive stays punchy) and a');
console.log('dead-stick dive still builds speed (you can trade height for a glide to the field). level-top must');
console.log('be identical across all diveShed rows — proof the knob never touches powered level flight.');
console.log('');
