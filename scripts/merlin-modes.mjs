// THE GATE FOR THE MERLIN'S HOVER, LOCK, BOOST AND PIT (client/game/js/panels/merlin-modes.js).
//
// Drives the flight model's `merlin` and `merlin_road` rows and the mode glue headlessly, the way
// cockpit.js does each frame, and asks what a player would notice:
//   HOVER refuses high, fast and over water, comes down to the road row at ride height, and climbs
//         back to the heli row;
//   the road row accelerates like a car and BOOST makes it faster, then overheats and cuts out;
//   PIT holds the limiter;
//   LOCK finds the car park's painted pads (the same numbers the `car_park` arm paints) and puts it
//         on the pad's centre, squared to the lot, landed, with the collective shut.
// `node scripts/merlin-modes.mjs`, exit 1 on failure.
import { TYPES, createState, step } from '../client/game/js/panels/flight-model.js';
import { MR, newMerlinState, merlinHover, merlinLock, merlinBoostOn, stepMerlin, CAR_PARK_PADS } from '../client/game/js/panels/merlin-modes.js';

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL  ' + m); } };
const toasts = [];
const fx = { toast: (t) => toasts.push(t) };
const last = () => toasts[toasts.length - 1] || '';

const s = createState(TYPES.merlin);
Object.assign(s, { onGround: false, altitude: 40, airspeed: 20, groundFt: 0 });
const F = { s, P: TYPES.merlin, heli: true, engineOn: true, pos: { x: 10, y: 10 }, input: { throttle: 0.5 }, mr: newMerlinState(), biomeBelow: 'urban' };
const cells = { '11,10': { bt: 'car_park', ent: 'north' } };
const cellAt = (x, y) => cells[x + ',' + y] || { biome: 'urban' };
const run = (secs, inp = {}) => {
  for (let i = 0; i < secs * 60; i++) {
    step(s, { power: true, ...F.input, ...inp, boost: merlinBoostOn(F), pit: F.mr.pit }, F.P, 1 / 60);
    stepMerlin(F, s, 1 / 60, fx, cellAt);
  }
};

// HOVER's refusals.
s.altitude = 300; merlinHover(F, fx.toast);
ok(F.mr.mode === 'air' && /100 ft/.test(last()), 'HOVER came down from 300 ft');
s.altitude = 40; s.airspeed = 60; merlinHover(F, fx.toast);
ok(F.mr.mode === 'air' && /32 kt/.test(last()), 'HOVER came down at 60 kt');
s.airspeed = 20; F.waterBelow = true; merlinHover(F, fx.toast);
ok(F.mr.mode === 'air' && /water/.test(last()), 'HOVER came down over water');
F.waterBelow = false;

// Down to the road.
merlinHover(F, fx.toast); ok(F.mr.mode === 'down', 'HOVER did not start the descent');
run(MR.DOWN_S + 0.6);
ok(F.mr.mode === 'road' && F.P === TYPES.merlin_road && !F.heli, 'the descent did not hand over to the road row');
ok(Math.abs(s.altitude - TYPES.merlin_road.rideFt) < 0.3, 'not at ride height on the road (' + s.altitude.toFixed(2) + ' ft)');

// The road: a car's pull-away, then BOOST, then the cut-out.
s.airspeed = 0; F.input.throttle = 1; run(3);
ok(s.airspeed > 45 && s.airspeed < 60, '0 to ~52 kt in 3 s, got ' + s.airspeed.toFixed(1));
run(6);
const flat = s.airspeed;
F.mr.key = true; run(3);
ok(s.airspeed > flat + 10, 'BOOST did not add speed (' + flat.toFixed(1) + ' to ' + s.airspeed.toFixed(1) + ')');
run(MR.BOOST_HEAT_S);
ok(F.mr.over > 0 && !merlinBoostOn(F) && /overheat/.test(last()), 'BOOST did not overheat and cut out');
F.mr.key = false;

// PIT.
F.mr.pit = true; run(6);
ok(Math.abs(s.airspeed - TYPES.merlin_road.pitKt) < 0.5, 'PIT did not hold ' + TYPES.merlin_road.pitKt + ' kt (' + s.airspeed.toFixed(1) + ')');
F.mr.pit = false;

// Brake to a stop, then back up into flight.
F.input.throttle = 0; run(4, { brake: 1 });
ok(s.airspeed <= 0.5, 'the brake did not stop it (' + s.airspeed.toFixed(1) + ' kt)');
merlinHover(F, fx.toast); F.input.throttle = 0.62; run(MR.UP_S + 0.5);
ok(F.mr.mode === 'air' && F.P === TYPES.merlin && F.heli && s.altitude > 5, 'HOVER did not climb back to the heli row');

// LOCK, onto the car park's nearest pad.
merlinLock(F, fx.toast, cellAt);
ok(!F.mr.lock && /no pad|line up/.test(last()), 'LOCK took it away from a pad');
const [lx, ly] = CAR_PARK_PADS[0];
const px = 11 - lx, py = 10 - ly;   // facePt with the entrance north
F.pos = { x: px + 0.05, y: py - 0.03 }; s.airspeed = 2; s.altitude = 10; s.vs = 0;
stepMerlin(F, s, 1 / 60, fx, cellAt);
ok(F.mr.lockReady, 'LOCK is not lit over a pad, slow');
merlinLock(F, fx.toast, cellAt);
ok(!!F.mr.lock, 'LOCK did not take it over a pad');
for (let i = 0; i < (MR.LOCK_S + 0.5) * 60; i++) stepMerlin(F, s, 1 / 60, fx, cellAt);
ok(Math.hypot(F.pos.x - px, F.pos.y - py) < 1e-6, 'LOCK did not centre it on the pad');
ok(s.onGround && s.altitude === 0 && F.input.throttle === 0, 'LOCK did not land it with the collective shut');
ok(s.heading % 90 < 1e-6 || 90 - (s.heading % 90) < 1e-6, 'LOCK did not square it to the lot (' + s.heading + ')');

// The boost's flame: strongest just after it lights, weaker as the heat runs up, out when let go.
{
  const F2 = { s: createState(TYPES.merlin), P: TYPES.merlin, heli: true, engineOn: true, pos: { x: 0, y: 0 }, input: { throttle: 0.5 }, mr: newMerlinState() };
  const tick = (n) => { for (let i = 0; i < n; i++) stepMerlin(F2, F2.s, 1 / 60, fx, () => null); };
  F2.mr.key = true;
  tick(9);
  const flare = F2.mr.flame;
  tick(60);
  const settled = F2.mr.flame;
  tick(Math.round((MR.BOOST_HEAT_S - 1.3) * 60));
  const late = F2.mr.flame;
  ok(flare > 1.2, 'the boost flame does not flare as it lights (' + flare.toFixed(2) + ')');
  ok(flare > settled && settled > late, 'the boost flame does not settle and then die down as the heat runs up (' + [flare, settled, late].map((v) => v.toFixed(2)).join(' > ') + ')');
  F2.mr.key = false; tick(30);
  ok(F2.mr.flame === 0, 'the boost flame is still lit after letting go');
}

console.log('merlin modes: ' + (fails ? fails + ' of ' + checks + ' FAILED' : checks + ' checks passed'));
process.exit(fails ? 1 : 0);
