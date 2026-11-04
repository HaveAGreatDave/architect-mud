// scale:check: the numbers in world-scale.js still mean what the sims take them to mean.
//
// scale:lint stops a new copy of a number. This stops the two halves of one drifting apart: the
// truck on the road's pace on both sides of the wire, and the eye and the contacts on one curve.
// Pure: it imports the shared modules and the flight model, which are DOM-free.
import { TYPES } from '../../client/game/js/panels/flight-model.js';
import { heightToZ, tileMph, FT_M, CURVE_TOP_FT } from '../../client/shared/world-scale.js';
import { altitudeTiles } from '../../client/shared/flight-height.js';
import { litresPerKm } from '../../client/shared/road-units.js';

let bad = 0;
const say = (ok, msg) => { if (!ok) { bad++; console.log('  ✗ ' + msg); } };

for (const [id, t] of Object.entries(TYPES)) {
  if (t.ground) say(t.tileMph === tileMph('road'), `${id} reads ${t.tileMph} mph a tile, the road is ${tileMph('road')}`);
}

// Every vehicle that stores a fraction of a tank says how many litres that tank is, and a truck's
// burn comes out somewhere a road vehicle's would.
for (const [id, t] of Object.entries(TYPES)) {
  if (t.ground || t.water) say(t.tankL > 0, `${id} has no tankL`);
  if (t.ground) say(litresPerKm(t) > 0.2 && litresPerKm(t) < 1, `${id} burns ${litresPerKm(t).toFixed(2)} L/km`);
}

for (let ft = 0; ft <= CURVE_TOP_FT; ft += 50) {
  say(Math.abs(heightToZ(ft * FT_M) - altitudeTiles(ft)) < 1e-9, `the eye and heightToZ disagree at ${ft} ft`);
}
let last = -1;
for (let ft = 0; ft <= 30000; ft += 25) {
  const z = heightToZ(ft * FT_M);
  say(z > last, `heightToZ stops rising at ${ft} ft`);
  last = z;
}
say(Math.abs(heightToZ((CURVE_TOP_FT + 1) * FT_M) - heightToZ(CURVE_TOP_FT * FT_M)) < 0.01, 'heightToZ jumps at the top of the curve');

if (bad) { console.log(`scale:check: ${bad} failed`); process.exit(1); }
console.log('scale:check: the road, the height curve and the tanks agree.');
