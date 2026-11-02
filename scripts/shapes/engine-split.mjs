// Split throttles: one lever per engine (flight-model.js step, cockpit.js setLever).
//   1. Levers set together fly exactly as the one ganged lever does.
//   2. The mean is the thrust: one engine full and one idle makes the speed of both at half.
//   3. An uneven set yaws her toward the slower side, in the air and on the ground, and full
//      opposite rudder holds it.
//   4. Every cockpit with a lever per engine gives each lever its own hotspot, and draws it where
//      that engine's lever is.
import { TYPES, createState, step } from '../../client/game/js/panels/flight-model.js';
import { shellProfileFor } from '../../client/shared/interior-shell.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); } };
const DT = 1 / 60;
const turn = (h1, h0) => ((h1 - h0 + 540) % 360) - 180;

function fly(p, input, { ground = false, secs = 6 } = {}) {
  const s = createState(p);
  if (!ground) { s.onGround = false; s.altitude = 3000; s.airspeed = p.cruise * 0.8; }
  for (let t = 0; t < secs; t += DT) { step(s, { elevator: 0, ...input }, p, DT); if (!ground) s.altitude = 3000; }
  return s;
}

for (const [id, n] of [['mule', 2], ['reaper', 2], ['leviathan', 4], ['drake_wing', 2]]) {
  const p = TYPES[id];
  const half = new Array(n).fill(0.5), left = new Array(n).fill(0).map((_, i) => (i < n / 2 ? 1 : 0));
  const right = left.map((x) => 1 - x);
  const g = fly(p, { throttle: 0.5 }), sp = fly(p, { throttle: 0.5, throttles: half });
  check(`${id}: an even split flies as the ganged lever`, Math.abs(g.airspeed - sp.airspeed) < 1e-9 && Math.abs(turn(g.heading, sp.heading)) < 1e-9);
  const L = fly(p, { throttle: 0.5, throttles: left }), Rt = fly(p, { throttle: 0.5, throttles: right });
  check(`${id}: the mean is the thrust`, Math.abs(L.airspeed - g.airspeed) < 0.5, `split ${L.airspeed.toFixed(1)} kt, ganged ${g.airspeed.toFixed(1)} kt`);
  check(`${id}: left engines alone yaw her right`, turn(L.heading, 0) > 5, `${turn(L.heading, 0).toFixed(1)} deg`);
  check(`${id}: right engines alone yaw her left`, turn(Rt.heading, 0) < -5, `${turn(Rt.heading, 0).toFixed(1)} deg`);
  const held = fly(p, { throttle: 0.5, throttles: left, pedal: -1 });
  check(`${id}: full opposite rudder holds an engine out`, turn(held.heading, 0) < 0, `${turn(held.heading, 0).toFixed(1)} deg`);
  const taxi = fly(p, { throttle: 0.5, throttles: left }, { ground: true, secs: 4 });
  check(`${id}: a split set turns her on the ground`, turn(taxi.heading, 0) > 5, `${turn(taxi.heading, 0).toFixed(1)} deg`);
  check(`${id}: each engine spools on its own`, Array.isArray(L.rpms) && L.rpms[0] > 0.9 && L.rpms[n - 1] < 0.1);
}

// The cockpits: [seat, class, trim, engines].
for (const [name, cls, trim, n] of [['Mule', 'prop', '', 2], ['Mule 2076', 'prop', '2076', 2], ['Reaper', 'gunship', '', 2], ['Leviathan', 'heavy', '', 4], ['Leviathan 2076', 'heavy', '2076', 4]]) {
  const P = shellProfileFor(cls, false, trim);
  check(`${name}: has a shell profile`, !!P && typeof P.hotspots === 'function');
  if (!P) continue;
  const even = P.hotspots({ powered: true, throttle: 0.5, throttles: new Array(n).fill(0.5) });
  const uneven = P.hotspots({ powered: true, throttle: 0.5, throttles: new Array(n).fill(0).map((_, i) => (i === 0 ? 1 : 0.5)), split: true });
  for (let e = 0; e < n; e++) {
    const a = even.find((h) => h.id === 'thr' + e), b = uneven.find((h) => h.id === 'thr' + e);
    check(`${name}: engine ${e + 1} has its own lever`, !!a && a.kind === 'throttle' && a.engine === e);
    if (a && b) check(`${name}: engine ${e + 1}'s lever stands at its own value`, e === 0 ? a.p.some((v, i) => Math.abs(v - b.p[i]) > 0.01) : a.p.every((v, i) => Math.abs(v - b.p[i]) < 1e-9));
  }
  check(`${name}: the set still has one lever that moves them all`, even.some((h) => h.id === 'throttle' && h.engine == null));
}

console.log(`engine-split: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
