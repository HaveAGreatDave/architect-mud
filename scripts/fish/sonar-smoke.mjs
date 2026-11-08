// THE SOUNDER, HELD AGAINST THE FISH.
//
//   node scripts/fish/sonar-smoke.mjs
//
// client/game/js/panels/sonar-scene.js has to show the fish the server bites on, or a mark you cast at
// is a lie. So every mark here is checked against fishNear, the question the server asks. It also has
// to do the things your eyes can't and stay honest about what it can't: it works with no daylight,
// and it never says what a fish is.

import { sonarScan, sonarCells, chartGrid, inBeam, screenDepth, RANGES_M, GAIN_NAMES } from '../../client/game/js/panels/sonar-scene.js';
import { lureFish, resetShadowScene } from '../../client/game/js/panels/fish-shadow-scene.js';
import { habitatFor, fishNear, SPECIES, SHADOW_R } from '../../client/shared/fish.js';
import { SEA_TILE_M } from '../../client/shared/sea-swell.js';

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`); } };

// A coast along the north, water to the south, as the seat's own gates use.
const isLand = (ix, iy) => iy < 880;
const habitat = habitatFor(isLand);
const env = { hour: 12, doy: 120, weather: 'clear', rough: 0.1 };
const now = 1_780_000_000_000;

// Somewhere with fish in reach.
let at = null;
for (let y = 884; y < 930 && !at; y += 1) for (let x = 880; x < 930 && !at; x += 3) {
  if (fishNear(x + 0.5, y + 0.5, SHADOW_R, now, env, habitat).length >= 6) at = { x, y };
}
check('the test water holds fish', !!at);
const q = { ...at, heading: 40, bearing: 0, now, env, habitat, thinned: null, rangeM: 70, gain: 2, lureTo: null };

const scan = sonarScan(q);
check('a scan finds marks', scan.marks.length > 0);
const real = new Map(fishNear(q.x + 0.5, q.y + 0.5, SHADOW_R, now, env, habitat).map((f) => [f.school.id + ':' + f.i, f]));
check('every mark is a fish the server would bite on', scan.marks.every((m) => real.has(m.key)), scan.marks.find((m) => !real.has(m.key))?.key);
{
  const m = scan.marks[0], f = real.get(m.key);
  check('a mark is where the fish is, to the centimetre', Math.abs(m.r - f.dist * SEA_TILE_M) < 0.01 && Math.abs(m.depth - f.depth) < 1e-9, `${m.r} vs ${f.dist * SEA_TILE_M}`);
  const dx = (f.x - 0.5 - q.x) * SEA_TILE_M, dy = (f.y - 0.5 - q.y) * SEA_TILE_M, h = 40 * Math.PI / 180;
  check('ahead is over the bow, whatever her heading', Math.abs(m.ahead - (dx * Math.sin(h) - dy * Math.cos(h))) < 1e-6);
}
check('it never names a fish', !scan.marks.some((m) => Object.values(m).some((v) => typeof v === 'string' && !v.includes(':'))
  || Object.keys(SPECIES).some((id) => Object.values(m).includes(id))));

// The gain.
const count = (gain) => sonarScan({ ...q, gain }).marks.length;
check('the gain has three steps, and more gain shows more', GAIN_NAMES.length === 3 && count(0) <= count(1) && count(1) <= count(2), `${count(0)} ${count(1)} ${count(2)}`);
// The range.
check('a mark past the range is off the screen', sonarScan({ ...q, rangeM: RANGES_M[0] }).marks.every((m) => m.r <= RANGES_M[0]));
check('the top of the range is what the shadows reach', Math.max(...RANGES_M) <= SHADOW_R * SEA_TILE_M + 1e-6, `${SHADOW_R * SEA_TILE_M}`);

// The floor.
check('the floor is under her', scan.underM > 0 && scan.bottomM >= scan.underM * 0.5, `${scan.underM} ${scan.bottomM}`);
check('the screen goes deeper than the floor', screenDepth(scan.bottomM) > scan.bottomM);
const profile = Array.from(scan.profile);
check('the profile is all water or land, no NaN', profile.every((d) => Number.isFinite(d) && d >= 0));

// The beam.
check('a mark dead ahead is in the beam at its range', inBeam({ brg: 3, r: 20 }, 0) > 19 && inBeam({ brg: 50, r: 20 }, 0) === -1);
check('the beam wraps round the stern', inBeam({ brg: 178, r: 20 }, -178) > 19);

// The block of cells the unit in the seat shows.
const box = { w: 34, h: 22, cells: null, depthM: 0 };
sonarCells(scan, q, box);
check('the seat\'s cells are the size it asked for, levels 0 to 3', box.cells.length === 34 * 22 && box.cells.every((v) => v >= 0 && v <= 3));
check('…with the floor in them', box.cells.some((v) => v === 3) && box.depthM === scan.underM);
const c0 = box.cells;
sonarCells(scan, q, box);
check('a frame fills the same cells in place', box.cells === c0);

// The chart.
const g = chartGrid(q, 12);
check('the sweep\'s chart is n by n', g.length === 144 && g.every((d) => Number.isFinite(d)));
{
  const nearLand = chartGrid({ ...q, x: 900, y: 882, heading: 0, rangeM: 70 }, 12);
  check('land shows as land, ahead of her at the top of the chart', nearLand[5] === 0 && nearLand[12 * 11 + 5] > 0, `${nearLand[5]} ${nearLand[12 * 11 + 5]}`);
}

// Fish that have noticed the lure.
{
  const f = { x: 10, y: 10, depth: 4, heading: 0 };
  const to = { x: 12, y: 10, depth: 8, k: new Map([['s:1', 0.5]]) };
  lureFish(f, 's:1', to);
  check('a following fish closes on the lure', f.x === 11 && f.depth === 6, JSON.stringify(f));
  const g2 = { x: 10, y: 10, depth: 4, heading: 0 };
  lureFish(g2, 's:2', to);
  check('a fish that hasn\'t noticed stays where it is', g2.x === 10);
}
{
  const m = scan.marks[0];
  const k = new Map([[m.key, 1]]);
  resetShadowScene();
  const moved = sonarScan({ ...q, lureTo: { x: q.x + 0.5, y: q.y + 0.5, depth: 2, k } });
  const mm = moved.marks.find((a) => a.key === m.key);
  check('the sounder sees a fish come to the lure', !!mm && mm.r < 0.01 && mm.depth === 2, JSON.stringify(mm));
}

if (failed) { console.error(`sonar smoke: ${failed} failed, ${passed} passed`); process.exit(1); }
console.log(`sonar smoke: ${passed}/${passed} passed`);
