// THE GATE FOR THE HOVER CAR CLASS (docs/proposals/hover-cars.md).
//
// Two questions about every car in client/shared/hover-cars.js:
//
//   BALANCE   Is it a starting car beside the others? Eight numbers a player can feel are read out of
//             its flight rows and its type row (this file keeps no copy). No number may be more than
//             10% from the Merlin's, no car may be at least as good as another on all eight, every car
//             has to lead the class on something and trail it on something, and the eight percentages
//             against the Merlin have to add up to within 4 points of nothing.
//   MODES     Do HOVER, LOCK, BOOST and PIT work for it on its own rows, as scripts/merlin-modes.mjs
//             checks they do for the Merlin?
//
// `node scripts/hover-cars.mjs`, exit 1 on failure. `--table` prints the balance table as markdown.
import { readFileSync } from 'node:fs';
import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';
import { MR, newMerlinState, merlinHover, merlinLock, merlinBoostOn, stepMerlin, CAR_PARK_PADS } from '../client/game/js/panels/merlin-modes.js';
import { HOVER_CARS, HOVER_CAR_IDS } from '../client/shared/hover-cars.js';

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL  ' + m); } };
const typeRow = (id) => JSON.parse(readFileSync(new URL('../content/aircraft_types/ac_' + id + '.json', import.meta.url), 'utf8'));

// ── BALANCE ──────────────────────────────────────────────────────────────────
// The road's top speed is measured, not read: drag stops the Merlin a few knots short of its limiter.
function roadTop(id) {
  const P = TYPES[HOVER_CARS[id].road], s = createState(P);
  Object.assign(s, { onGround: false, altitude: P.rideFt, airspeed: 0, groundFt: 0 });
  for (let i = 0; i < 60 * 60; i++) step(s, { power: true, throttle: 1 }, P, 1 / 60);
  return s.airspeed;
}
const NUMBERS = [
  ['Cruise (kt)', (id, A) => A.cruise],
  ['Roll (deg/s)', (id, A) => A.rollRate],
  ['Yaw (deg/s)', (id, A) => A.yawRate],
  ['Climb (ft/min)', (id, A) => A.vsMax],
  ['Road pull-away (kt/s)', (id, A, Rd) => Rd.accel],
  ['Road top speed (kt)', (id) => Math.round(roadTop(id))],
  ['Endurance (charge over burn)', (id, A, Rd, T) => Math.round(T.fuel_capacity / T.fuel_burn_base)],
  ['Hull', (id, A, Rd, T) => T.hull_hp],
];
const table = {};
for (const id of HOVER_CAR_IDS) {
  const car = HOVER_CARS[id], A = TYPES[car.air], Rd = TYPES[car.road];
  ok(!!A && A.heli, id + ': no heli row "' + car.air + '" in flight-model.js');
  ok(!!Rd && Rd.road, id + ': no road row "' + car.road + '" in flight-model.js');
  let T = null;
  try { T = typeRow(id); } catch { ok(false, id + ': no content/aircraft_types/ac_' + id + '.json'); }
  if (!A || !Rd || !T) continue;
  ok(T.class === id, id + ': its type row\'s class is "' + T.class + '"');
  table[id] = NUMBERS.map(([, fn]) => fn(id, A, Rd, T));
  // What every car in the class shares.
  const M = typeRow('merlin'), MRd = TYPES.merlin_road, MA = TYPES.merlin;
  for (const k of ['price_buy', 'price_rent_hourly', 'seats', 'fuel_type', 'takeoff_mode', 'engines', 'hardpoints']) ok(T[k] === M[k], id + ': ' + k + ' is ' + T[k] + ', the class\'s is ' + M[k]);
  for (const k of ['rideFt', 'pitKt', 'brake']) ok(Rd[k] === MRd[k], id + ': road ' + k + ' is ' + Rd[k] + ', the class\'s is ' + MRd[k]);
  ok(A.ceiling === MA.ceiling, id + ': ceiling ' + A.ceiling + ', the class\'s is ' + MA.ceiling);
  ok(Math.abs(T.cargo_capacity - M.cargo_capacity) <= 2, id + ': cargo ' + T.cargo_capacity + ' is more than 2 from the Merlin\'s');
}
const ids = Object.keys(table), base = table.merlin;
const pct = (id) => table[id].map((v, i) => (v / base[i] - 1) * 100);
for (const id of ids) {
  const p = pct(id);
  p.forEach((d, i) => ok(Math.abs(d) <= 10.05, id + ': ' + NUMBERS[i][0] + ' is ' + d.toFixed(1) + '% from the Merlin\'s (' + table[id][i] + ' against ' + base[i] + ')'));
  const sum = p.reduce((a, b) => a + b, 0);
  ok(Math.abs(sum) <= 4, id + ': its eight numbers add up to ' + sum.toFixed(1) + ' points against the Merlin; more than 4 is a better or worse car');
  for (const other of ids) if (other !== id) ok(!table[id].every((v, i) => v >= table[other][i]), id + ' is at least as good as ' + other + ' on every number: it dominates');
  if (ids.length > 1) {
    ok(table[id].some((v, i) => ids.every((o) => o === id || v > table[o][i])), id + ' leads the class on nothing');
    ok(table[id].some((v, i) => ids.every((o) => o === id || v < table[o][i]) || ids.filter((o) => table[o][i] < v).length === 0 && ids.some((o) => o !== id && table[o][i] > v)), id + ' trails the class on nothing');
  }
}
if (process.argv.includes('--table')) {
  const lead = (i, v) => (ids.length > 1 && ids.every((o) => table[o][i] <= v) && ids.filter((o) => table[o][i] === v).length === 1 ? '**' + v + '**' : String(v));
  console.log('| | ' + ids.map((id) => HOVER_CARS[id].name).join(' | ') + ' |');
  console.log('| --- | ' + ids.map(() => '---').join(' | ') + ' |');
  NUMBERS.forEach(([name], i) => console.log('| ' + name + ' | ' + ids.map((id) => lead(i, table[id][i])).join(' | ') + ' |'));
  console.log('\nagainst the Merlin, points: ' + ids.map((id) => HOVER_CARS[id].name + ' ' + pct(id).reduce((a, b) => a + b, 0).toFixed(1)).join(', '));
}

// ── MODES ────────────────────────────────────────────────────────────────────
for (const id of HOVER_CAR_IDS) {
  const car = HOVER_CARS[id], A = TYPES[car.air], Rd = TYPES[car.road];
  if (!A || !Rd) continue;
  const toasts = [], fx = { toast: (t) => toasts.push(t) }, last = () => toasts[toasts.length - 1] || '';
  const s = createState(A);
  Object.assign(s, { onGround: false, altitude: 40, airspeed: 20, groundFt: 0 });
  const F = { s, P: A, heli: true, engineOn: true, pos: { x: 10, y: 10 }, input: { throttle: 0.5 }, mr: newMerlinState(id), biomeBelow: 'urban' };
  const cells = { '11,10': { bt: 'car_park', ent: 'north' } };
  const cellAt = (x, y) => cells[x + ',' + y] || { biome: 'urban' };
  const run = (secs, inp = {}) => {
    for (let i = 0; i < secs * 60; i++) {
      step(s, { power: true, ...F.input, ...inp, boost: merlinBoostOn(F), pit: F.mr.pit }, F.P, 1 / 60);
      stepMerlin(F, s, 1 / 60, fx, cellAt);
    }
  };
  ok(F.mr.cls === id, id + ': its state says it is a ' + F.mr.cls);
  // HOVER's refusals, then down to the road on its own row.
  s.altitude = 300; merlinHover(F, fx.toast);
  ok(F.mr.mode === 'air' && /100 ft/.test(last()), id + ': HOVER came down from 300 ft');
  s.altitude = 40; s.airspeed = 20; F.waterBelow = true; merlinHover(F, fx.toast);
  ok(F.mr.mode === 'air' && /water/.test(last()), id + ': HOVER came down over water');
  F.waterBelow = false;
  merlinHover(F, fx.toast); run(MR.DOWN_S + 0.6);
  ok(F.mr.mode === 'road' && F.P === Rd && !F.heli, id + ': the descent did not hand over to its own road row');
  ok(Math.abs(s.altitude - Rd.rideFt) < 0.3, id + ': not at ride height on the road (' + s.altitude.toFixed(2) + ' ft)');
  // The road: a car's pull-away, BOOST, the cut-out, PIT, the brake.
  s.airspeed = 0; F.input.throttle = 1; run(3);
  ok(s.airspeed > 42 && s.airspeed < 62, id + ': 0 to about 52 kt in 3 s, got ' + s.airspeed.toFixed(1));
  run(8);
  const flat = s.airspeed;
  F.mr.key = true; run(3);
  ok(s.airspeed > flat + 10, id + ': BOOST did not add speed (' + flat.toFixed(1) + ' to ' + s.airspeed.toFixed(1) + ')');
  run(MR.BOOST_HEAT_S);
  ok(F.mr.over > 0 && !merlinBoostOn(F) && /overheat/.test(last()), id + ': BOOST did not overheat and cut out');
  F.mr.key = false;
  F.mr.pit = true; run(7);
  ok(Math.abs(s.airspeed - Rd.pitKt) < 0.5, id + ': PIT did not hold ' + Rd.pitKt + ' kt (' + s.airspeed.toFixed(1) + ')');
  F.mr.pit = false;
  F.input.throttle = 0; run(4, { brake: 1 });
  ok(s.airspeed <= 0.5, id + ': the brake did not stop it (' + s.airspeed.toFixed(1) + ' kt)');
  // Back up into flight on its own heli row.
  merlinHover(F, fx.toast); F.input.throttle = 0.62; run(MR.UP_S + 0.5);
  ok(F.mr.mode === 'air' && F.P === A && F.heli && s.altitude > 5, id + ': HOVER did not climb back to its own heli row');
  // LOCK, onto the car park's nearest pad.
  const [lx, ly] = CAR_PARK_PADS[0], px = 11 - lx, py = 10 - ly;
  F.pos = { x: px + 0.05, y: py - 0.03 }; s.airspeed = 2; s.altitude = 10; s.vs = 0;
  stepMerlin(F, s, 1 / 60, fx, cellAt);
  ok(F.mr.lockReady, id + ': LOCK is not lit over a pad, slow');
  merlinLock(F, fx.toast, cellAt);
  for (let i = 0; i < (MR.LOCK_S + 0.5) * 60; i++) stepMerlin(F, s, 1 / 60, fx, cellAt);
  ok(Math.hypot(F.pos.x - px, F.pos.y - py) < 1e-6 && s.onGround && s.altitude === 0 && F.input.throttle === 0 && F.P === A, id + ': LOCK did not land it on the pad on its heli row');
  // In the air it flies: full collective climbs it.
  const h = createState(A);
  Object.assign(h, { onGround: false, altitude: 200, airspeed: 0, groundFt: 0 });
  for (let i = 0; i < 6 * 60; i++) step(h, { power: true, throttle: 1 }, A, 1 / 60);
  ok(h.altitude > 212 && h.vs > 200, id + ': full collective did not climb it (' + h.altitude.toFixed(0) + ' ft after 6 s from 200, ' + h.vs.toFixed(0) + ' ft/min)');
}

console.log('hover cars: ' + HOVER_CAR_IDS.length + ' cars, ' + (fails ? fails + ' of ' + checks + ' FAILED' : checks + ' checks passed'));
process.exit(fails ? 1 : 0);
