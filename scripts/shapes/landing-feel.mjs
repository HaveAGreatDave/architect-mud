// Landing feel: ground effect and the shadow height gauge.
//   1. Ground effect is measured from the deck under her: the same arrival over a field and over a
//      1,700 ft roof flies the same, to the foot. (It once read sea level, so a roof pad had none.)
//   2. Inside the band she makes more lift and less induced drag, so a flare from the same height
//      holds her off longer than the same flare with the ground taken away.
//   3. The shadow cue (client/shared/shadow-cue.js) closes in, darkens and sharpens steadily on the
//      way down, and the contact shadow fades in only over the last stretch.
// Fast (well under a second); the slower whole-approach tuner is scripts/flare-tune.mjs.
import { TYPES, createState, step } from '../../client/game/js/panels/flight-model.js';
import { contactCue, sunCue, CONTACT_BAND_H } from '../../client/shared/shadow-cue.js';

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); } };
const DT = 1 / 60;

// A power-off flare from `agl` ft at 1.4·Vs0 with full flap, the yoke eased back, over a deck at `deck`.
function flare(p, agl, deck, noGround = false) {
  const s = createState(p);
  s.onGround = false; s.groundFt = noGround ? -1e6 : deck; s.altitude = deck + agl;
  s.airspeed = p.vs0 * 1.4; s.vs = -s.airspeed * 101.33 * Math.sin(3 * Math.PI / 180); s.pitch = 0;
  let elev = 0, t = 0;
  for (; t < 30; t += DT) {
    elev = Math.min(0.45, elev + DT * 0.6);
    step(s, { elevator: elev, throttle: 0, flaps: 1, power: true }, p, DT);
    if (s.onGround || s.altitude <= deck) break;
  }
  return { t, alt: s.altitude, vs: s.vs, spd: s.airspeed };
}

for (const [id, p] of Object.entries(TYPES)) {
  if (p.heli || p.ground || p.water || !p.vs0) continue;
  const field = flare(p, 20, 0), roof = flare(p, 20, 1700);
  check(`${id}: a roof deck flares like a field`, Math.abs(field.t - roof.t) < 0.05, `field ${field.t.toFixed(2)} s, roof ${roof.t.toFixed(2)} s`);
  // With the ground gone she is in free air the whole way: time how long she takes to lose 20 ft.
  const s = createState(p);
  s.onGround = false; s.groundFt = -1e6; s.altitude = 20; s.airspeed = p.vs0 * 1.4;
  s.vs = -s.airspeed * 101.33 * Math.sin(3 * Math.PI / 180); s.pitch = 0;
  let elev = 0, t = 0;
  for (; t < 30 && s.altitude > 0; t += DT) { elev = Math.min(0.45, elev + DT * 0.6); step(s, { elevator: elev, throttle: 0, flaps: 1, power: true }, p, DT); }
  check(`${id}: ground effect holds her off longer than free air`, field.t > t, `in GE ${field.t.toFixed(2)} s, free air ${t.toFixed(2)} s`);
}

// The shadow cue, on the way down from 3,000 ft to the deck.
let prev = null;
for (let i = 100; i >= 0; i--) {
  const h = i / 100, sun = sunCue(h), touch = contactCue(h);
  if (prev) {
    check(`sun shadow closes in at h ${h}`, sun.reach <= prev.sun.reach);
    check(`sun shadow sharpens at h ${h}`, sun.soft <= prev.sun.soft);
    check(`sun shadow darkens at h ${h}`, sun.alpha >= prev.sun.alpha - 1e-9);
    check(`contact shadow strengthens at h ${h}`, touch.strength >= prev.touch.strength);
    check(`contact shadow tightens at h ${h}`, touch.spread <= prev.touch.spread && touch.soft <= prev.touch.soft);
  }
  if (h >= CONTACT_BAND_H) check(`no contact shadow above the band (h ${h})`, touch.strength === 0);
  prev = { sun, touch };
}
check('the sun shadow sits under her on the deck', sunCue(0).reach === 0);
check('on the ground the contact shadow is full', contactCue(0.3, true).strength === 1);

console.log(`landing-feel: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
