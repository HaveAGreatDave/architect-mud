// Glide-ratio TUNING harness (dead-stick glideDrag). Glide is engine-OFF, so a drag term
// gated to low rpm sets the engine-out glide ratio WITHOUT touching powered cruise/climb
// (the gate is 0 at any real power setting). We measure the ratio while holding a practical
// best-glide speed (~1.3× stall, a safe real-world best-glide) with a simple pitch hold —
// stable and meaningful, unlike a free trim that drifts toward the stall. Prints baseline vs
// tuned so the powered numbers can be confirmed unchanged, plus values to bake into TYPES.
//
// Run:  node scripts/glide-tune.mjs

import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';

const KT_TO_FTS = 1.68781, KT_PER_FPM = 1 / 101.33, DT = 0.05;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clone = (p, over) => ({ ...p, ...over });

// Ceilings, not exact targets: a plane already gliding under its ceiling is left ALONE
// (glideDrag 0, zero change). Measured honestly, only the Leviathan floats (33:1) — the rest
// are already a realistic 8-10:1, so only it gets tuned down. Heavy freighter → ~13:1.
const TARGET = { mayfly: 14, mule: 14, leviathan: 13, reaper: 14, carcass: 12 };
// A fixed-elevator engine-off glide, run to steady state → the settled airspeed + sink (the
// true glide polar point). This is the honest measurement: no controller fighting the trim,
// no free-drift to a false min-sink.
function steadyGlide(p, elevator) {
  const s = createState(p); s.onGround = false; s.altitude = 30000; s.airspeed = p.cruise;
  for (let t = 0; t < 60 && s.altitude > 100; t += DT) step(s, { elevator, aileron: 0, throttle: 0, flaps: 0 }, p, DT);
  const vKt = Math.max(0.1, -s.vs) * KT_PER_FPM;
  const hKt = Math.sqrt(Math.max(0, s.airspeed * s.airspeed - vKt * vKt));
  return { spd: s.airspeed, ratio: hKt / vKt, stalled: s.stalled };
}
// Best glide = the max-ratio point on the polar → its ratio + the speed it flies (Vbg).
function bestGlide(p) {
  let best = { ratio: 0, speed: 0 };
  for (let e = -0.6; e <= 0.4; e += 0.04) {
    const g = steadyGlide(p, e);
    if (g.spd < p.vs0 * 0.95 || g.stalled) continue;
    if (g.ratio > best.ratio) best = { ratio: g.ratio, speed: Math.round(g.spd) };
  }
  return best;
}
function cruiseTop(p, thr = 1) {
  const s = createState(p); s.onGround = false; s.altitude = 1000; s.airspeed = p.cruise * 0.5;
  for (let t = 0; t < 120; t += DT) step(s, { elevator: 0, aileron: 0, throttle: thr, flaps: 0 }, p, DT);
  return s.airspeed;
}
function climbGain(p) {
  const s = createState(p); s.onGround = false; s.altitude = 500; s.airspeed = p.cruise; s.rpm = 1;   // already at power (steady climb)
  for (let t = 0; t < 40; t += DT) step(s, { elevator: 0.35, aileron: 0, throttle: 1, flaps: 0 }, p, DT);
  return s.altitude - 500;
}
function solveGlideDrag(p, target) {   // more glideDrag → lower best-glide ratio (monotonic)
  let lo = 0, hi = 0.06;
  for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (bestGlide(clone(p, { glideDrag: m })).ratio > target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

console.log('\nGLIDE TUNING — dead-stick induced drag (engine-off only; powered flight must not move)\n' + '='.repeat(94));
console.log('aircraft     | BASELINE best/cruise(full/70)/climb | tgt  glideDrag  TUNED best-ratio  Vbg   cruise(full/70)  climb');
console.log('-'.repeat(94));
const out = {};
for (const [id, p] of Object.entries(TYPES)) {
  if (p.heli) continue;
  const b = bestGlide(p), bTop = cruiseTop(p), bPart = cruiseTop(p, 0.7), bClimb = climbGain(p);
  const tgt = TARGET[id] ?? 9;
  const gd = +solveGlideDrag(p, tgt).toFixed(6);
  const tp = clone(p, { glideDrag: gd });
  const g = bestGlide(tp), top = cruiseTop(tp), part = cruiseTop(tp, 0.7), climb = climbGain(tp);
  out[id] = { glideDrag: gd, bestGlide: g.speed };
  console.log(`${p.name.padEnd(12)} | ${b.ratio.toFixed(0).padStart(2)}:1@${b.speed} ${Math.round(bTop)}/${Math.round(bPart)}kt ${(bClimb >= 0 ? '+' : '') + Math.round(bClimb)}ft`.padEnd(46) +
    `| ${String(tgt).padStart(3)}  ${gd.toFixed(6)}  ${g.ratio.toFixed(1)}:1       ${g.speed}kt  ${Math.round(top)}/${Math.round(part)}kt   ${(climb >= 0 ? '+' : '') + Math.round(climb)}ft`);
}
console.log('='.repeat(94));
console.log('(TUNED cruise & climb must equal BASELINE — the term is 0 at power.)');
console.log('Bake into flight-model.js TYPES:');
for (const [id, v] of Object.entries(out)) console.log(`  ${id}: glideDrag: ${v.glideDrag}, bestGlide: ${v.bestGlide}`);
console.log('');
