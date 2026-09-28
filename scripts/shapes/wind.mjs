// THE WIND THE RENDERER READS: gusts, direction, units.
//
// Four things that are silent when wrong, each of which shipped wrong at least once:
//   1. A gust must keep the MEAN at 1, or the sea state reservoir and every drift integrate a
//      different wind from the one the server reports.
//   2. The veer must be zero-mean, or the wind slowly turns away from the direction the weather
//      cells are drifting.
//   3. Bad weather must gust harder than good, and it must be a function of the wall clock alone,
//      so two clients see one gust.
//   4. No windsock may fall back to a fixed bearing, and none may read kph as knots. Both were true
//      of every windsock the cockpit did not feed until 2026-09-27.
//
//   node scripts/shapes/wind.mjs
import { readFileSync } from 'node:fs';
import { windGust, windVeer, stormOf, GUST_CALM, GUST_STORM } from '../../client/shared/wind-gust.js';
import { blank } from '../lib/blank-scanner.mjs';

const fail = [], ok = [];
const T0 = 1750000000000;

// 1 and 2: means over an hour of one-second samples.
for (const storm of [0, 0.5, 1]) {
  let sg = 0, sv = 0, n = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 3600; i++) {
    const g = windGust(T0 + i * 1000, storm);
    sg += g; sv += windVeer(T0 + i * 1000, storm); n++;
    lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  const mg = sg / n, mv = sv / n;
  if (Math.abs(mg - 1) > 0.02) fail.push(`storm ${storm}: the gust's mean is ${mg.toFixed(3)}, not 1`);
  else if (Math.abs(mv) > 1) fail.push(`storm ${storm}: the veer's mean is ${mv.toFixed(2)} degrees, not 0`);
  else ok.push(`storm ${storm}: mean ${mg.toFixed(3)}, veer mean ${mv.toFixed(2)} deg, gusts ${lo.toFixed(2)}-${hi.toFixed(2)}`);
}

// 3: storms gust harder, and the answer is the clock's alone.
const spread = (storm) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < 600; i++) { const g = windGust(T0 + i * 1000, storm); lo = Math.min(lo, g); hi = Math.max(hi, g); } return hi - lo; };
if (!(spread(1) > spread(0) * 2)) fail.push(`a squall does not gust harder than a calm (${spread(1).toFixed(2)} vs ${spread(0).toFixed(2)})`);
else ok.push(`a squall swings ${spread(1).toFixed(2)} of the mean against a calm day's ${spread(0).toFixed(2)}`);
if (windGust(T0 + 12345, 0.7) !== windGust(T0 + 12345, 0.7)) fail.push('the gust is not a pure function of the clock');
if (!(stormOf('thunderstorm') > stormOf('rain') && stormOf('rain') > stormOf('clear'))) fail.push('stormOf does not rank thunderstorm > rain > clear');
if (!(GUST_STORM > GUST_CALM)) fail.push('GUST_STORM is not above GUST_CALM');

// 4: the windsocks read windFromView.
const W = blank(readFileSync('client/game/js/panels/windshield.js', 'utf8'));
if (/windDeg = v\.windVec\?\.dir \?\? 250/.test(W)) fail.push('windshield.js: a windsock still falls back to a fixed 250 degrees');
if (/windKt = v\.wind \|\| 0/.test(W)) fail.push('windshield.js: a windsock still reads v.wind (kph) as knots');
if (!/windKt = _wv\.kt, windDeg = _wv\.dir/.test(W)) fail.push('windshield.js: the windsocks no longer read windFromView');
else ok.push('the windsocks read windFromView: the weather\'s direction, in knots, gusting');
const C = blank(readFileSync('client/game/js/panels/cockpit.js', 'utf8'));
if (/sev \* 13/.test(C)) fail.push('cockpit.js: the weather baseline is back, counting a storm twice');
if (!/windGust\(wallNow, storm\)/.test(C)) fail.push('cockpit.js: the flight model no longer takes the shared gust');
else ok.push('the flight model takes the shared gust, and no second weather baseline');

for (const s of ok) console.log('  ✓ ' + s);
if (fail.length) {
  for (const s of fail) console.error('  ✗ ' + s);
  console.error('\nwind FAILED');
  process.exit(1);
}
console.log('\n✓ wind: gusts keep the mean, storms gust harder, and every windsock reads the weather.');
