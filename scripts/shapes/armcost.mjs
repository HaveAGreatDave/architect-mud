// armcost — what is the 2-D pass STILL DOING once GLASS 2 owns the mass?
//
//   node scripts/shapes/armcost.mjs
//
// GLASS 2 draws the city's mass, trim, lights, signage, Curtain and scatter. It does NOT stop the
// model arms running: every building's arm is executed every frame with MASS_OFF/FLAT_OFF set, and
// the only thing it produces is entries in the sprite, decal, curtain and scatter sinks. The
// geometry it would have drawn is already on the GPU, cached, and uploaded once.
//
// That is the shape of the remaining cost, and it is worth measuring before anybody spends a
// refactor on it: a real frame runs at 18.3 ms while the GPU draws 4,756 faces in a fraction of a
// millisecond, so the frame is not GPU-bound and the arms are the obvious suspect.
//
// ⚠ THIS COUNTS CALLS AND ENTRIES, NEVER MILLISECONDS. Wall-clock in node against a stub canvas
// measures the stub — framecost.mjs says so at length and it is right. What survives the machine is
// how many canvas calls the frame makes and how many sink entries the arms produce, and both are
// exactly the quantities the caching work would move.
//
// ⚠ AND IT INSTALLS A STUB GL HOOK, because `RENDER_TUNE.gl` alone does nothing: with no hook
// installed `glOn` is false, the sinks are never opened, MASS_OFF is never set, and the measurement
// silently becomes the 2-D renderer measuring itself. The hook returns a canvas so the composite
// does not decide the pass drew nothing and switch the flag back off.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const W = 1280, H = 720;

// A city with buildings on both sides of the LOD thresholds, the same reasoning framecost uses: a
// window where everything is near measures one half of the renderer.
const R = 16, N = R * 2 + 1;
const TYPES = ['shop', 'office', 'apartment', 'warehouse', 'hotel', 'store', 'club', 'clinic'];
const SCENE = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  // ⚠ A STRAIGHT ROAD IS NOT A CROSSROADS. The first cut of this scene marked every road tile
  // 'nesw', which is the icon for a four-way junction — so a 33x33 window carried sixty-five sets
  // of traffic signals and the measurement reported signals as half the frame. A city has junctions
  // where roads MEET; everywhere else the road runs straight past.
  if (x === R && y === R - 3) return { kind: 'land', biome: 'citycore', road: 1, rd: 'nesw', flr: 0, pw: 1 };
  if (x === R) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
  if (y === R - 3) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ew', flr: 0, pw: 1 };
  if ((x + y) % 5 === 0) return { kind: 'land', biome: 'parkland', flr: 0 };
  return {
    kind: 'land', biome: 'citycore', bt: TYPES[(x * 7 + y * 11) % TYPES.length],
    bn: 'B' + x + '_' + y, ent: ['north', 'east', 'south', 'west'][(x + y) % 4],
    flr: 2 + ((x * 3 + y) % 14),
  };
}));

// The same counting Proxy shape pathreuse and framecost use: getContext is REPLACED rather than
// wrapped, because paintWindshield asks for the context itself.
function counted(el) {
  const byName = new Map();
  let calls = 0;
  const real = el.getContext('2d');
  el.getContext = () => new Proxy({}, {
    get(_t, k) {
      const v = real[k];
      if (typeof v !== 'function') return v;
      return (...a) => { calls++; byName.set(k, (byName.get(k) || 0) + 1); return v.apply(real, a); };
    },
    set(_t, k, v) { real[k] = v; return true; },
  });
  return { reset() { calls = 0; byName.clear(); }, read: () => ({ calls, byName: new Map(byName) }) };
}

const ws = await loadWindshield();
const el = stubCanvas('__armcost', W, H);
const C = counted(el);

// Frozen, for framecost's reasons: an animated world measures a call or two apart every run, and a
// 0 ms frame pins the adaptive dials at their expensive end rather than letting the gate relax.
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

const VIEW = { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, weather: 'clear', speed: 0.4, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 } };

let sinks = null;
const glCanvas = stubCanvas('__armcost_gl', W, H);

function run(glOn) {
  ws.RENDER_TUNE.gl = glOn ? 1 : 0;
  sinks = null;
  const out = {};
  for (const [lbl, hour] of [['day', 13], ['night', 2]]) {
    // Painted twice, second frame counted — the first builds every lazy cache the renderer has.
    for (let i = 0; i < 2; i++) {
      if (i === 1) C.reset();
      ws.paintWindshield('__armcost', { ...VIEW, map: SCENE, heading: 24, hour });
    }
    const T = C.read();
    out[lbl] = { calls: T.calls, byName: T.byName, sinks: sinks && { ...sinks } };
  }
  return out;
}

const off = run(false);

ws.installGLWorld((cells, cam, opts) => {
  sinks = {
    cells: cells.length,
    sprites: opts.sprites ? opts.sprites.length : 0,
    decals: opts.decals ? opts.decals.length : 0,
    scatter: opts.scatter ? opts.scatter.length : 0,
    curtain: opts.curtain ? opts.curtain.length : 0,
  };
  return { canvas: glCanvas };
});
const on = run(true);
ws.installGLWorld(null);
ws.RENDER_TUNE.gl = 0;
globalThis.performance = clock;

const pct = (a, b) => (b ? ((a - b) / b * 100).toFixed(1) + '%' : '—');
console.log('── armcost — one 33x33 frame, truck cab, GLASS 2 on vs off ─────────────');
console.table([
  { frame: 'day',   'GLASS 1 calls': off.day.calls,   'GLASS 2 calls': on.day.calls,   change: pct(on.day.calls, off.day.calls) },
  { frame: 'night', 'GLASS 1 calls': off.night.calls, 'GLASS 2 calls': on.night.calls, change: pct(on.night.calls, off.night.calls) },
]);
console.log('\n── what the arms produced, per frame, purely to fill the sinks ──');
console.table([
  { frame: 'day',   ...(on.day.sinks || {}) },
  { frame: 'night', ...(on.night.sinks || {}) },
]);
// WHAT THE 2-D PASS IS STILL DOING.
// The actionable half: with mass, trim, lights, signage and scatter on the GPU, whatever is left
// in this table is the next thing worth porting - measured rather than guessed.
for (const lbl of ['day', 'night']) {
  const mine = on[lbl].byName, theirs = off[lbl].byName;
  const rows = [...mine].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, n]) => ({
    call: name, 'GLASS 2': n, 'GLASS 1': theirs.get(name) || 0,
    share: (n / on[lbl].calls * 100).toFixed(1) + '%',
  }));
  console.log("\n-- " + lbl + ": busiest calls REMAINING with GLASS 2 on --");
  console.table(rows);
}
