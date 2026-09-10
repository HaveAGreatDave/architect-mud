// clouds — the fly-through deck has never been run by anything but a player flying into a front.
//
//   node scripts/shapes/clouds.mjs
//   node scripts/shapes/clouds.mjs --detail    # the per-case table, and what the deck costs
//
// ⚠ THE REASON THIS DID NOT EXIST IS THE REASON IT HAD TO. `drawVolumetricClouds` opens with
//
//     const cells = st.cells, ax = v.acX, ay = v.acY;
//     if (!cells || !cells.length || ax == null || ay == null) return st.cloudImm = 0;
//
// and NOT ONE harness in this repo passes `wxField`, `acX` or `acY`. `viewRenderSmoke`, `framecost`
// and every bench in the Modelshop hand over a map, an hour and a heading and no weather field at
// all — so the deck returned on its first line every time, and every number ever written down about
// the cost of a frame was a number for a sky with no clouds in it. Measured here for the first time,
// the deck is **5,451 canvas calls on a clear day and 9,649 inside a storm cell**, against a whole
// city block's 17,400. A third of the frame, invisible to the budget gate that exists to hold the
// frame.
//
// Three checks, in the order they are worth having:
//
//   1. IT RUNS. All eight weather types, day and night, below the deck, inside it and above it.
//      Same argument as shapes:smoke: the only thing that ever ran this code was a player who
//      happened to fly into that weather at that altitude.
//   2. NOTHING NON-FINITE REACHES THE CANVAS. This renderer has been bitten by NaN four separate
//      times and the mode is always the same — `ctx.arc(NaN, …)` draws nothing, throws nothing, and
//      ships. The deck is full of `Math.hypot`, `Math.sqrt` and divisions by a distance that can be
//      zero when you are standing inside a cell, which is exactly where a player flies.
//   3. IT DRAWS SOMETHING. A field that produces no cards is the silent failure, and it is what
//      the whole deck looks like when a guard higher up is wrong.
//
// It reports the deck's own cost too, as the delta between a frame with a field and the identical
// frame without one. That number is the argument for moving it to the GPU.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const DETAIL = process.argv.includes('--detail');

// ── THE FIELD ───────────────────────────────────────────────────────────────
// The packet shape is `weatherFieldForClient` in plugins/flight/state.js, copied here rather than
// imported because that function reads live environment state and this is a renderer test. Three
// cells — one cloud, one shower, one storm — laid out so the sweep can sit outside all of them,
// beside one, and inside one.
const FIELD = (precip) => ({
  tick: 30,
  bounds: { minX: 80, maxX: 120, minY: 80, maxY: 120 },
  wind: { dir: 220, kph: 18 },
  baseCloud: 0.55,
  precipFloor: precip ? 0.4 : 0,
  floorType: precip || 'none',
  cells: [
    { x: 100, y: 92, r: 14, vx: 0.4, vy: 0.2, type: 'cloud', intensity: 0.8, precip: 'none' },
    { x: 108, y: 104, r: 10, vx: -0.3, vy: 0.5, type: 'precip', intensity: 0.7, precip: 'rain' },
    { x: 92, y: 110, r: 12, vx: 0.1, vy: -0.4, type: 'storm', intensity: 0.9, precip: 'rain' },
  ],
});

const WEATHER = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'ash', 'dust'];
const PRECIP = { rain: 'rain', storm: 'rain', snow: 'snow', clear: null, cloudy: null, fog: null, ash: 'ash', dust: 'dust' };
// ⚠ THE THREE ALTITUDES ARE THE POINT, not decoration. The deck sits at a per-weather altitude
// (CLOUD_BASE_FT) and the interesting code — the parting, the whiteout, the immersion ease — only
// runs when the eye is AT it. A sweep at cruise height alone would exercise the far half and call
// it covered.
const HEIGHTS = [0.05, 0.9, 2.4];
// Outside every cell, on the rim of one, and dead centre of the storm — where a distance goes to
// zero and every `x / d` in the deck is one guard away from NaN.
const SEATS = [[100, 100, 'between cells'], [96, 96, 'cell rim'], [92, 110, 'inside the storm']];

const R = 8, N = R * 2 + 1;
const SCENE = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome: 'citycore', flr: 0 })));

// A counting, NaN-refusing proxy over the 2-D context. The stub's own context is itself a proxy
// that synthesises methods on `get`, so this has to wrap rather than patch — the same trap
// floorfallback.mjs documents.
function watch(el) {
  const real = el.getContext('2d');
  const seen = { calls: 0, bad: [] };
  const wrapped = new Proxy(real, {
    get(o, k) {
      const v = o[k];
      if (typeof v !== 'function') return v;
      return (...a) => {
        seen.calls++;
        for (let i = 0; i < a.length; i++) {
          const q = a[i];
          if (typeof q === 'number' && !Number.isFinite(q) && seen.bad.length < 6) seen.bad.push(`${String(k)}(arg ${i} = ${q})`);
        }
        return v.apply(o, a);
      };
    },
    set(o, k, v) {
      // A non-finite globalAlpha is the same silent bug wearing a different hat: the canvas ignores
      // the assignment and keeps the previous value, so one bad card poisons every card after it.
      if (typeof v === 'number' && !Number.isFinite(v) && seen.bad.length < 6) seen.bad.push(`${String(k)} = ${v}`);
      o[k] = v; return true;
    },
  });
  el.getContext = () => wrapped;
  return seen;
}

const ws = await loadWindshield();
const el = stubCanvas('__clouds', 1280, 720);
const seen = watch(el);

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

const problems = [], rows = [];
let cases = 0;

const paint = (view) => {
  ws.paintWindshield('__clouds', view);          // warm every lazy cache
  const before = seen.calls;
  ws.paintWindshield('__clouds', view);
  return seen.calls - before;
};

for (const weather of WEATHER) {
  const field = FIELD(PRECIP[weather]);
  for (const [ax, ay, where] of SEATS) {
    for (const height of HEIGHTS) {
      for (const [lbl, hour] of [['day', 13], ['night', 2]]) {
        const base = { cls: 'prop', phase: 'cruise', worldBlend: 1, map: SCENE, heading: 0, speed: 0.4, hour, height };
        const tag = `${weather} ${where} h${height} ${lbl}`;
        cases++;
        let bare = 0, full = 0;
        try {
          bare = paint({ ...base, weather });
          full = paint({ ...base, weather, wxField: field, acX: ax, acY: ay });
        } catch (e) {
          problems.push(`${tag}: threw — ${e && e.message}`);
          continue;
        }
        if (seen.bad.length) { problems.push(`${tag}: non-finite reached the canvas — ${seen.bad.join(', ')}`); seen.bad.length = 0; }
        // ⚠ THE SILENCE CHECK. Every weather here has a field with three live cells in it and a
        // 0.55 cloud floor, so every one of them owes the frame some cloud. A case that costs the
        // same with a field as without it is a deck that returned early, which is what this whole
        // file exists to catch — and is exactly the state the harnesses were in before it.
        if (full - bare < 50) problems.push(`${tag}: a field with three cells in it added ${full - bare} canvas calls — the deck drew nothing`);
        rows.push({ tag, bare, full, deck: full - bare });
      }
    }
  }
}

globalThis.performance = clock;

if (DETAIL) {
  rows.sort((a, b) => b.deck - a.deck);
  console.log('\n  the deck, by case (canvas calls):');
  for (const r of rows.slice(0, 14)) console.log(`    ${String(r.deck).padStart(6)}  of ${String(r.full).padStart(6)}   ${r.tag}`);
  console.log(`    …${rows.length - 14} more`);
}

if (problems.length) {
  console.error(`\n✗ clouds — ${problems.length} problem(s) over ${cases} cases:`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  if (problems.length > 20) console.error(`  …and ${problems.length - 20} more`);
  process.exit(1);
}

const deck = rows.map((r) => r.deck).sort((a, b) => a - b);
const med = deck[deck.length >> 1];
console.log(`✓ clouds: the fly-through deck runs at all ${WEATHER.length} weather types, day and night, below the deck, in it and above it `
  + `— ${cases} cases, nothing non-finite reached the canvas, and every case drew.`);
console.log(`  It costs ${deck[0]}–${deck[deck.length - 1]} canvas calls a frame (median ${med}), which no other gate in this repo can see.`);
