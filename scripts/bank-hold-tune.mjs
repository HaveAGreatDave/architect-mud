// BANK HOLD diagnostic: the measurement rig for client/game/js/panels/bank-hold.js.
//
// Flies every airframe the cockpit flies, from a settled cruise, through what the arrow keys do:
// a held → that rolls the target to 30°, a step to the type's limit, and a held ← back to level.
// Per airframe it reports:
//   · rise / over / hold   seconds from the key to within 3° of 30°, the worst overshoot past it,
//                          and the error once settled (the integral's job), degrees
//   · lim / rise2 / over2  the same for a step from 30° to the type's limit
//   · alt                  the most height lost or gained across both turns, ft (the pull's job)
//   · bob                  the nose's travel once settled at the limit, degrees. A pull loop that
//                          limit-cycles holds the height on average and nods the nose all the while
//   · g                    peak load factor against the type's gLimit; `stall` if she ever broke
//   · under                the most left bank rolling back with ← held: 0 means the detent held
//   · out                  height gained on the roll-out, ft (back-pressure left on the stick)
//   · level                seconds from the detent to the hold handing the stick back
//
// Run:  node scripts/bank-hold-tune.mjs            the table
//       node scripts/bank-hold-tune.mjs --check    the gate: silent, exits 1 naming what broke
// Try gains without editing the module:  BH='{"vsKi":1}' node scripts/bank-hold-tune.mjs

import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';
import { BANK_HOLD, createBankHold, bankKey, stepBankHold, bankLimit } from '../client/game/js/panels/bank-hold.js';

if (process.env.BH) Object.assign(BANK_HOLD, JSON.parse(process.env.BH));

const DT = 1 / 60;
const fly = Object.entries(TYPES).filter(([, p]) => p.rollRate && p.cruise);

function settled(p) {
  const s = createState(p);
  s.onGround = false; s.altitude = 5000; s.airspeed = p.cruise * (p.heli ? 0.7 : 0.9); s.rpm = 0.6; s.pitch = 0;
  const thr = p.heli ? 0.42 : 0.7;
  const inp = { elevator: 0, aileron: 0, throttle: thr, collRaw: thr, flaps: 0, pedal: 0, power: true };
  for (let t = 0; t < 25; t += DT) step(s, inp, p, DT);
  return { s, inp };
}

// Drive the hold for `secs`; `keys(t)` returns the [dir, down] edges to apply at that moment.
function run(p, s, inp, h, secs, keys, track) {
  for (let t = 0; t < secs; t += DT) {
    for (const [dir, down] of keys(t)) bankKey(h, dir, down, s, p);
    const on = stepBankHold(h, s, p, DT);
    step(s, { ...inp, aileron: on ? h.aileron : 0, elevator: (inp.elevator || 0) + (on ? h.pull : 0) }, p, DT);
    track(t, on);
  }
}

const rows = [];
for (const [name, p] of fly) {
  const { s, inp } = settled(p);
  const h = createBankHold();
  const alt0 = s.altitude;
  const lim = bankLimit(p);
  let altDev = 0, peakG = 0, stalled = false;
  const watch = () => {
    const d = s.altitude - alt0;
    if (Math.abs(d) > Math.abs(altDev)) altDev = d;
    peakG = Math.max(peakG, s.g || 1); stalled ||= !!s.stalled;
  };

  // 1. Hold → for 1.1 s: a 5° step, then rolling at 30°/s, snapped to the step on release.
  let rise = null, over = 0, hold = 0, up1 = false;
  run(p, s, inp, h, 14, (t) => {
    if (t === 0) return [[1, true]];
    if (!up1 && t >= 1.1) { up1 = true; return [[1, false]]; }
    return [];
  }, (t) => {
    watch();
    if (t <= 1.1) return;
    if (rise == null && Math.abs(s.bank - h.target) < 3) rise = t;
    over = Math.max(over, Math.sign(h.target) * (s.bank - h.target));
    if (t > 11) hold = Math.max(hold, Math.abs(s.bank - h.target));
  });
  const tgt1 = h.target;

  // 2. Step to the type's limit and hold it.
  let rise2 = null, over2 = 0, pMin = Infinity, pMax = -Infinity;
  h.target = lim;
  run(p, s, inp, h, 16, () => [], (t) => {
    watch();
    if (rise2 == null && Math.abs(s.bank - lim) < 3) rise2 = t;
    over2 = Math.max(over2, s.bank - lim);
    if (t > 8) { pMin = Math.min(pMin, s.pitch); pMax = Math.max(pMax, s.pitch); }
  });

  // 3. Hold ← all the way back: it must stop at level, then hand the stick back once released.
  let levelAt = null, released = null, under = 0, up3 = false;
  const altOut = s.altitude; let outGain = 0;
  run(p, s, inp, h, 14, (t) => {
    if (t === 0) return [[-1, true]];
    if (!up3 && h.detent) { up3 = true; levelAt = t; return [[-1, false]]; }
    return [];
  }, (t, on) => {
    under = Math.min(under, s.bank);
    outGain = Math.max(outGain, s.altitude - altOut);
    if (up3 && released == null && !on) released = t - levelAt;
  });

  rows.push({
    type: name + (p.heli ? ' (rotor)' : ''),
    tgt: tgt1, rise: rise?.toFixed(2) ?? '-', over: over.toFixed(1), hold: hold.toFixed(1),
    lim, rise2: rise2?.toFixed(2) ?? '-', over2: over2.toFixed(1),
    alt: p.heli ? '-' : Math.round(altDev), bob: p.heli ? '-' : (pMax - pMin).toFixed(1),
    g: `${peakG.toFixed(2)}/${p.gLimit ?? '-'}`, stall: stalled ? 'STALL' : 'ok',
    under: under.toFixed(1), out: p.heli ? '-' : Math.round(outGain), level: released?.toFixed(2) ?? 'never',
  });
}

// ── --check: the gate (scripts/gates/manifest.mjs, client group) ─────────────
// What the keys promise, on every airframe, with a little room over the numbers it was tuned to
// (2026-11-09: overshoot ≤ 0.8°, height ±50 ft, nose ≤ 2.3°, roll-out ≤ 25 ft, hand-back ≤ 3.1 s).
if (process.argv.includes('--check')) {
  const fails = [];
  const bad = (r, what) => fails.push(`${r.type}: ${what}`);
  for (const r of rows) {
    const wing = !r.type.includes('(rotor)');
    if (r.rise === '-' || +r.rise > 4.5) bad(r, `never settled on ${r.tgt}° (rise ${r.rise})`);
    if (+r.over > 2) bad(r, `overshot ${r.tgt}° by ${r.over}°`);
    if (+r.hold > 1) bad(r, `drifts ${r.hold}° off a held ${r.tgt}°`);
    if (r.rise2 === '-') bad(r, `never reached its own limit, ${r.lim}°`);
    if (+r.over2 > 2) bad(r, `overshot its limit by ${r.over2}°`);
    if (r.stall !== 'ok') bad(r, 'the hold stalled her');
    const [g, lim] = r.g.split('/');
    if (lim !== '-' && +g >= +lim) bad(r, `pulled ${g}g against a ${lim}g limit`);
    if (+r.under < -2) bad(r, `rolled ${r.under}° past level with ← held: the detent didn't hold`);
    if (r.level === 'never' || +r.level > 6) bad(r, `kept the stick ${r.level} s after level`);
    if (wing && Math.abs(r.alt) > 120) bad(r, `lost or gained ${r.alt} ft in the turns`);
    if (wing && +r.bob > 4) bad(r, `the pull nods the nose ${r.bob}°`);
    if (wing && +r.out > 80) bad(r, `ballooned ${r.out} ft on the roll-out`);
  }
  // The keys themselves: a tap is one step, holding stops at the limit, and level is a detent.
  const p = TYPES.mayfly, s = createState(p); s.onGround = false; s.bank = 0;
  const h = createBankHold();
  bankKey(h, 1, true, s, p); bankKey(h, 1, false, s, p);
  if (h.target !== BANK_HOLD.step) fails.push(`keys: a tap set ${h.target}°, not ${BANK_HOLD.step}°`);
  for (let i = 0; i < 40; i++) { bankKey(h, 1, true, s, p); bankKey(h, 1, false, s, p); }
  if (h.target !== bankLimit(p)) fails.push(`keys: forty taps set ${h.target}°, not the limit ${bankLimit(p)}°`);
  for (let i = 0; i < 40; i++) { bankKey(h, -1, true, s, p); bankKey(h, -1, false, s, p); if (h.target === 0) break; }
  bankKey(h, -1, true, s, p); bankKey(h, -1, false, s, p);
  if (h.target !== -BANK_HOLD.step) fails.push(`keys: a tap from level went to ${h.target}°, not -${BANK_HOLD.step}°`);
  if (fails.length) { console.error('bank-hold: ' + fails.length + ' failure(s)\n  ' + fails.join('\n  ')); process.exit(1); }
  process.exit(0);
}

const cols = Object.keys(rows[0]);
const w = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]));
console.log(cols.map((c) => c.padEnd(w[c])).join('  '));
for (const r of rows) console.log(cols.map((c) => String(r[c]).padEnd(w[c])).join('  '));
