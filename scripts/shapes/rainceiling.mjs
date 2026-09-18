// rainceiling — is the rain where the cloud is, and nowhere else?
//
//   node scripts/shapes/rainceiling.mjs
//   node scripts/shapes/rainceiling.mjs --report    # the full table
//
// `drawWeather` is a full-screen particle curtain keyed off the day's weather STRING. It knew
// nothing about altitude and nothing about where the cells are, so it fell in clear air on top of
// an overcast and it fell over the half of the map with no cell above it. Both of those look
// exactly like rain working, which is why the report that arrived was not "the weather is wrong" —
// it was "it rains above the clouds".
//
// ⚠ COUNT THE CURTAIN, NOT THE FRAME. The obvious test is the delta in canvas calls between two
// altitudes, and it measures almost anything else: the LOD sheds buildings, the cloud deck grows,
// the ground raster changes size. The curtain identifies itself — rain sets `strokeStyle` to
// `rgba(196,216,242,…)`, snow sets `fillStyle` to `rgba(240,246,255,…)` and ash and dust set it to
// `rgba(200,140,90,…)` — so the instrument is a `set` trap on the context that counts those three
// and nothing else. That is exact, and it is the only reading here that does not move when the
// scene does.
//
// ⚠ AND THE MUTATION CONTROL IS THE WHOLE VALUE OF IT. "No rain above the deck" is also what comes
// back when a guard higher up returned early, when the field never reached the renderer, or when
// the weather string was not one that precipitates — three ways to pass while measuring nothing.
// So every ceiling case is run twice, `RENDER_TUNE.rainGate` 1 and 0, and the 0 run has to RAIN.
// A case that is dry both ways is reported as a failure of this file rather than a pass.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');

// The packet shape is `weatherFieldForClient` in plugins/flight/state.js. Two fields: one overcast
// day that is raining on the whole map (a high `baseCloud` and a `precipFloor`), and one clear day
// with a single shower cell in the corner of it — which is the pair the second half of the gate is
// about, because on the second one most of the map must stay dry.
const OVERCAST = {
  tick: 30, bounds: { minX: 80, maxX: 120, minY: 80, maxY: 120 }, wind: { dir: 220, kph: 18 },
  baseCloud: 0.75, precipFloor: 0.5, floorType: 'rain',
  cells: [{ x: 100, y: 100, r: 16, vx: 0, vy: 0, type: 'precip', intensity: 0.8, precip: 'rain' }],
};
const ONE_SHOWER = {
  tick: 30, bounds: { minX: 80, maxX: 120, minY: 80, maxY: 120 }, wind: { dir: 220, kph: 18 },
  baseCloud: 0, precipFloor: 0, floorType: 'none',
  cells: [{ x: 92, y: 92, r: 7, vx: 0, vy: 0, type: 'precip', intensity: 0.9, precip: 'rain' }],
};

// The four weathers that actually put something in the air. `clear`, `cloudy` and `fog` have no
// curtain to gate and would pass this file by drawing nothing at either altitude.
const WET = ['rain', 'storm', 'snow', 'ash'];

const R = 8, N = R * 2 + 1;
const SCENE = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome: 'citycore', flr: 0 })));

// ⚠ A WRAPPER, NEVER A PATCH. The stub's own context is a proxy that synthesises members on `get`
// and silently discards anything written onto it — the trap `floorfallback.mjs` records, and it
// reads exactly like the curtain never drawing.
function watch(el) {
  const real = el.getContext('2d');
  const seen = { drops: 0 };
  const isPrecip = (v) => typeof v === 'string'
    && (v.startsWith('rgba(196,216,242,') || v.startsWith('rgba(240,246,255,') || v.startsWith('rgba(200,140,90,'));
  const wrapped = new Proxy(real, {
    get(o, k) { const v = o[k]; return typeof v === 'function' ? (...a) => v.apply(o, a) : v; },
    set(o, k, v) { if ((k === 'strokeStyle' || k === 'fillStyle') && isPrecip(v)) seen.drops++; o[k] = v; return true; },
  });
  el.getContext = () => wrapped;
  return seen;
}

const ws = await loadWindshield();
const el = stubCanvas('__rain', 1000, 560);
const seen = watch(el);

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

// How much curtain one frame lays down. Painted twice — the first warms every lazy cache, and a
// cache miss is canvas work that has nothing to do with the weather.
const curtain = (view) => {
  ws.paintWindshield('__rain', view);
  const before = seen.drops;
  ws.paintWindshield('__rain', view);
  return seen.drops - before;
};

const problems = [], rows = [];
const run = (tag, view, gate) => {
  ws.RENDER_TUNE.rainGate = gate;
  let n = 0;
  try { n = curtain(view); } catch (e) { problems.push(`${tag}: threw — ${e && e.message}`); return null; }
  rows.push({ tag: `${tag} [gate ${gate}]`, n });
  return n;
};

// ── 1. THE CEILING ──────────────────────────────────────────────────────────
// `height` is `min(1, √(alt/3000))`, and the deck's own base is the same curve — `cloudBaseZ`. The
// lowest deck in the table is fog at 150 ft and the highest is clear at 3,200, so 0.06 (≈11 ft) is
// under every one of them and 1.0 (3,000 ft, where the eye stops climbing) is over all but one.
for (const weather of WET) {
  for (const [ax, ay, where] of [[100, 100, 'under the overcast']]) {
    const base = { cls: 'prop', phase: 'cruise', worldBlend: 1, map: SCENE, heading: 0, speed: 0.4, hour: 13,
      weather, wxField: OVERCAST, acX: ax, acY: ay };
    const low = run(`${weather} ${where} on the deck`, { ...base, height: 0.06 }, 1);
    const high = run(`${weather} ${where} at altitude`, { ...base, height: 1.0 }, 1);
    const highOff = run(`${weather} ${where} at altitude`, { ...base, height: 1.0 }, 0);
    if (low === null || high === null || highOff === null) continue;
    if (!(low > 0)) problems.push(`${weather}: nothing fell at the bottom of an overcast that is raining — the instrument is not seeing the curtain`);
    if (high > 0) problems.push(`${weather}: ${high} of curtain drawn in clear air ABOVE the cloud base`);
    // The control: with the gate off, the same frame has to rain. Dry both ways means this case
    // proves nothing about the ceiling.
    if (!(highOff > 0)) problems.push(`${weather}: the control is dry too — with rainGate 0 the altitude frame drew ${highOff}, so nothing here is measuring the ceiling`);
  }
}

// ── 2. THE COVER ────────────────────────────────────────────────────────────
// One shower, seven tiles across, on an otherwise clear day. Under it, it rains; two dozen tiles
// away on the same map, at the same altitude, in the same weather, it must not.
for (const weather of ['rain', 'storm']) {
  const base = { cls: 'prop', phase: 'cruise', worldBlend: 1, map: SCENE, heading: 0, speed: 0.4, hour: 13,
    weather, wxField: ONE_SHOWER, height: 0.06 };
  const inside = run(`${weather} inside the shower`, { ...base, acX: 92, acY: 92 }, 1);
  const outside = run(`${weather} in the clear`, { ...base, acX: 116, acY: 116 }, 1);
  const outsideOff = run(`${weather} in the clear`, { ...base, acX: 116, acY: 116 }, 0);
  if (inside === null || outside === null || outsideOff === null) continue;
  if (!(inside > 0)) problems.push(`${weather}: nothing fell INSIDE the shower cell`);
  if (outside > 0) problems.push(`${weather}: ${outside} of curtain drawn 24 tiles from the only cloud on the map`);
  if (!(outsideOff > 0)) problems.push(`${weather}: the control is dry too — with rainGate 0 the clear-air frame drew ${outsideOff}, so nothing here is measuring the cover`);
}

ws.RENDER_TUNE.rainGate = 1;
globalThis.performance = clock;

if (REPORT) {
  console.log('\n  curtain drawn, by case (precip style changes per frame):');
  for (const r of rows) console.log(`    ${String(r.n).padStart(5)}   ${r.tag}`);
}

if (problems.length) {
  console.error(`\n✗ rainceiling — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

const lo = rows.filter((r) => r.n > 0).map((r) => r.n);
console.log(`✓ rainceiling: rain stops at the cloud base and outside the cover, across ${WET.length} precipitating weathers `
  + `— ${rows.length} frames, ${Math.min(...lo)}–${Math.max(...lo)} of curtain where it should fall and 0 where it should not.`);
console.log('  Every dry case is mutation-tested with rainGate 0, which rains: the ceiling is what stops it, not a guard higher up.');
