// WHERE DOES THE FRAME GO, IN A REAL PLACE?
//
// Every cost bench in glbench.js builds a SYNTHETIC city, and `__glFrame`'s own ⚠ records that
// costing three wrong conclusions in a row — a scene picked by hand picks the answer. That is the
// right trade for a bench that has to mean the same thing across days, and it is useless for the
// one question a player ever actually asks: **why is it choppy HERE and not there?**
//
// So this is `runPhases` pointed at the baked world instead of at a generated terrace:
//
//   __glWhere({ x: 892, y: 906, seat: 'cab' })      // the Glasshouse
//   __glWhere({ x: 916, y: 909 })                   // Marrow Street, for comparison
//   __glWheres()                                    // every district, worst first
//
// ⚠ IT IS A MEASUREMENT AND `__street` IS A PICTURE, which is why this is not in street.js. The
// two adaptive dials (`resFloor`, `perfDS`) are forced, and that is the trap `runFloorCost`
// records: left loose the dial sheds pixels exactly where the frame is expensive and gets read as
// the renderer, so the choppy district measures about the same as every other one and the
// difference shows up as blur instead of as milliseconds.
//
// ⚠ AND THE CLOCK IS NOT FROZEN HERE, WHICH IS THE OPPOSITE OF EVERY PIXEL BENCH IN THIS REPO. A
// pixel diff has to freeze it or it measures the drifting sky; this reads `PERF`, and `perfBegin`
// keeps time with `performance.now()` — so a stubbed clock makes every phase measure exactly
// **0.000 ms** while every count stays correct, which reads as a profiler that is not wired up at
// all. It cost the first run of this file.
//
// ⚠ AND THE PHASES ARE INCLUSIVE — `world:build` contains everything the arms do. A child sits
// inside its parent's number and the columns must never be summed.
import { paintWindshield, RENDER_TUNE, setWindshieldProfiler, perfSnapshot } from '/client/game/js/panels/windshield.js';
import { installGL, glLastFrame } from '/client/game/js/panels/gl/install.js';

let _world = null;
async function world() {
  if (_world) return _world;
  const res = await fetch('/api/world');
  if (!res.ok) throw new Error('no baked flight world (' + res.status + ') — run `npm run snapshot:flight`');
  _world = await res.json();
  return _world;
}

// The same two seats `__street` offers, for the same reason: a cab at eye height 0 and an
// aeroplane at half a tile are looking at different buildings, and a district judged only from the
// air is judged on its roofs.
const SEATS = {
  cab: { cls: 'truck', height: 0, eyeH: 0.12, speed: 0.15, r: 14 },
  air: { cls: 'prop', height: 0.5, eyeH: undefined, speed: 0.4, r: 36 },
};

// Everywhere worth standing, as the district landmarks in content/districts/*.json.
export const PLACES = {
  glasshouse: [892, 906], halcyon: [899, 916], marrow: [916, 909], docks: [905, 895],
  nightlife: [909, 903], industrial: [921, 899], civic: [911, 912], residential: [903, 913],
};

// ── ⚠ ONE CANVAS FOR THE WHOLE SESSION, AND THAT IS NOT TIDINESS ───────────────────────────────
//
// A GL scene is keyed on the canvas's id, so a fresh canvas per call is a fresh WebGL2 context per
// call — and a context holds its programs, its atlas page, its HDR chain, its shadow map and its
// mirror target, measured elsewhere in this repo at ~156 MB apiece. The browser caps a page at
// **16** live contexts and force-loses the OLDEST past that, so a sweep of eight districts over
// three reps quietly runs the page out of contexts a third of the way in.
//
// What that does to the numbers is worse than the leak: the same unchanged config measured
// 40.2 → 38.4 → 45.1 → 56.1 → 59.7 ms over five consecutive runs — monotonically UPWARD, which is
// the exact mirror image of the JIT warm-up drift the sweep above is written around, and reads
// just as convincingly like a real finding about whatever was being toggled at the time.
let _rig = null;
function rig(W, H) {
  if (!_rig) {
    const el = document.createElement('canvas');
    el.id = '__where';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0';
    holder.append(el); document.body.append(holder);
    _rig = { el, holder };
  }
  _rig.el.width = W; _rig.el.height = H;
  _rig.holder.style.width = W + 'px'; _rig.holder.style.height = H + 'px';
  return { el: _rig.el, uninstall: installGL(() => _rig.el) };
}

function pinned(fn) {
  const res = RENDER_TUNE.resFloor, ds = RENDER_TUNE.perfDS;
  RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0;
  try { return fn(); } finally { RENDER_TUNE.resFloor = res; RENDER_TUNE.perfDS = ds; }
}

// One place, one seat, one number per phase.
export async function where(opts = {}) {
  const { seat = 'cab', hour = 13, weather = 'clear', W = 640, H = 360,
    frames = 30, warm = 10, quiet = false } = opts;
  const place = opts.place ? PLACES[opts.place] : null;
  const x = opts.x ?? (place && place[0]), y = opts.y ?? (place && place[1]);
  if (x == null || y == null) { console.warn('__glWhere: pass {x, y} or {place}'); return null; }

  const w = await world();
  const S = SEATS[seat] || SEATS.cab;
  const R = opts.r || S.r, N = R * 2 + 1;
  const bare = { kind: 'land', biome: 'badlands', flr: 0 };
  const map = Array.from({ length: N }, (_, j) => Array.from({ length: N }, (_, i) =>
    w.cells[(x + i - R) + ',' + (y + j - R)] || bare));

  const { el, uninstall } = rig(W, H);

  const view = { ...S, phase: 'cruise', worldBlend: 1, hour, weather, map, wxField: null };
  const out = pinned(() => {
    // ⚠ The heading is swept rather than held. A fixed heading measures one frustum, and the cost
    // that matters is the one you pay while turning — which is also the only way a stale vertex
    // buffer shows up as anything but a correct picture.
    setWindshieldProfiler(false);
    for (let i = 0; i < warm; i++) paintWindshield('__where', { ...view, heading: (i * 11) % 360 });
    // ⚠ `builds` IS A PROCESS-WIDE RUNNING TOTAL, not a per-run count — read straight across a
    // sweep of eight districts it counts 1, 2, 3 … 8 and reads exactly like one rebuild each.
    const b0 = (glLastFrame() || {}).builds || 0;
    setWindshieldProfiler(true, { arms: !!opts.arms });
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) paintWindshield('__where', { ...view, heading: (i * 11) % 360 });
    const wall = (performance.now() - t0) / frames;
    const s = perfSnapshot();
    setWindshieldProfiler(false);
    return { s, last: glLastFrame(), wall, b0 };
  });
  uninstall();

  const { s, last, wall, b0 } = out;
  const per = (k) => +((s.t[k] || 0) / frames).toFixed(3);
  const row = {
    place: opts.place || (x + ',' + y), seat,
    // The wall clock over the whole paint, which is the only honest total: the windshield phases
    // NEST, so summing the columns double-counts (see the ⚠ on inclusive phases above).
    ms: +wall.toFixed(2),
    build: per('world:build'), arms: per('world:arms'), sweep: per('world:sweep'),
    occlude: per('world:occlude'), shadow: per('world:shadow'), gl: per('world:gl'),
    flush: per('world:flush'), ground: per('ground'), weather: per('weather'),
    faces: +((s.n.faces || 0) / frames).toFixed(0), arms_n: +((s.n.arms || 0) / frames).toFixed(0),
    adorn: +((s.n.adorn || 0) / frames).toFixed(0), lod: +((s.n.lod || 0) / frames).toFixed(0),
    culled: +((s.n.culled || 0) / frames).toFixed(0),
    glFaces: last ? last.faces : 0, builds: (last ? last.builds : 0) - b0,
  };
  // Which building models the arm time went into, worst first, with the per-arm cost beside the
  // total — a model drawn forty times for a little each and one drawn twice for a lot are two very
  // different fixes and the total alone cannot tell them apart.
  const arms = Object.entries(s.arm || {}).map(([model, a]) => ({
    model, ms: +(a.ms / frames).toFixed(3), per: +(a.ms / a.n).toFixed(3), drawn: +(a.n / frames).toFixed(1),
  })).sort((x, y) => y.ms - x.ms);
  if (!quiet) { console.table([row]); if (arms.length) console.table(arms.slice(0, 20)); }
  return { row, arms, t: s.t, n: s.n, frames };
}

// Every district, worst first. The comparison is the point — a single district's milliseconds say
// nothing without somewhere ordinary beside them.
//
// ⚠ AND THE SWEEP ORDER DECIDED THE ANSWER THE FIRST TIME IT WAS RUN. Six runs of ONE unchanged
// config went 55.3 → 46.3 → 40.0 → 41.6 → 36.5 → 37.7 ms: monotonic, not noise — the engine is
// still compiling the renderer, the shape and kit memos are still filling and the atlas is still
// packing. So whichever district goes first is charged for all of it, and the first table this
// file ever printed named Halcyon Fields at 96 ms against the docks at 11 purely because Halcyon
// is first in `PLACES`. The per-place `warm` frames do NOT cover it: they warm that place's own
// caches, and what is cold is the process.
//
// Two things fix it and both are needed. A whole-sweep PRE-PASS, which pays the process-wide cost
// once before anything is recorded; and REPS over the whole list with the MINIMUM kept per place,
// because the minimum is the only statistic here that cannot be inflated by a GC landing in the
// middle of one district's turn.
export async function wheres(opts = {}) {
  const { reps = 3, ...rest } = opts;
  const keys = Object.keys(PLACES);
  for (const k of keys) await where({ ...rest, place: k, frames: 4, warm: 2, quiet: true });
  const best = new Map();
  for (let i = 0; i < reps; i++) {
    for (const k of keys) {
      const r = await where({ ...rest, place: k, quiet: true });
      if (!r) continue;
      const prev = best.get(k);
      if (!prev || r.row.ms < prev.ms) best.set(k, r.row);
    }
  }
  const rows = [...best.values()].sort((a, b) => b.ms - a.ms);
  console.table(rows);
  return rows;
}

if (typeof window !== 'undefined') { window.__glWhere = where; window.__glWheres = wheres; }
