// __benchRoute(): ONE NUMBER PER ROUTE, COMPARABLE ACROSS MACHINES (docs/proposals/gl-core.md, phase 0).
//
//   await __benchRoute('halcyon-cab')          // one route: CPU and GPU per frame, GPU per pass
//   await __benchRoutes()                      // every route, best of three; the baseline's shape
//   copy(JSON.stringify(await __benchRoutes(), null, 2))   // then paste into
//                                              // scripts/perf/baselines/<device>.json
//
// `__glWhere` (districtcost.js) times a turning camera parked on one tile. A player drives, and a
// moving camera pays for what a turning one never does: the map window moving under it, new tiles
// built and kept ones re-sent (reference: perf:move). So this drives the routes in routes.js along
// the real roads at a fixed speed, through the same paint the game calls, on the same one canvas
// districtcost.js keeps for the session, with the adaptive dials pinned off as it pins them.
//
// Each route runs three times: once untimed to warm it, once with a GPU timer round every paint
// (CPU and GPU per frame), and once with gl/core/timer.js's per-pass timers, which can't share a
// frame with the whole-frame timer because timer queries don't nest.
//
// ⚠ THE CLOCK RUNS, AS IN districtcost.js. The profiler keeps time with performance.now(), and a
// frozen clock reads every phase as zero. The hour is fixed on the view, so the sky holds still.
//
// ⚠ THE NUMBERS ARE THE MACHINE'S. The result names the GPU (WEBGL_debug_renderer_info) so a
// baseline says what it was measured on; compare a run only with a baseline from the same device.
import { paintWindshield, RENDER_TUNE, setWindshieldProfiler, perfSnapshot } from '/client/game/js/panels/windshield.js';
import { glLastFrame } from '/client/game/js/panels/gl/install.js';
import { glPassTimer, glPassTimes } from '/client/game/js/panels/gl/context.js';
import { world, SEATS, rig, gpuClock, pinned } from './districtcost.js';
import { ROUTES, routeTiles, routeFrames } from './routes.js';

const ID = '__where';   // districtcost.js's canvas: one WebGL2 context for the whole session

const pct = (sorted, p) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2) : null);
const spreadOf = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? { p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: +s[s.length - 1].toFixed(2) } : null;
};

// What the numbers were measured on.
export function device() {
  const c = (glLastFrame() || {}).canvas;
  const gl = c && c.getContext('webgl2');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : null),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
    timerQuery: !!(gl && gl.getExtension('EXT_disjoint_timer_query_webgl2')),
    dpr: window.devicePixelRatio || 1,
    cores: navigator.hardwareConcurrency || null,
    ua: navigator.userAgent,
  };
}

// The dials that change what a frame costs, so a baseline says which renderer it measured.
function tuneOf() {
  const out = {};
  for (const [k, v] of Object.entries(RENDER_TUNE)) if (/^(gl|glass|lite|pace|dpr|lod|ssao|shadow)/i.test(k) && typeof v !== 'object') out[k] = v;
  return out;
}

// The views for a route, built before anything is timed: the map windows are the harness's work,
// not the renderer's. A window is rebuilt when the camera crosses into a new tile, as the game's is.
function viewsFor(name, w, opts) {
  const route = ROUTES[name];
  const S = SEATS[route.seat] || SEATS.cab;
  const R = opts.r || S.r, N = R * 2 + 1;
  const bare = { kind: 'land', biome: 'badlands', flr: 0 };
  const windows = new Map();
  const windowAt = (cx, cy) => {
    const k = cx + ',' + cy;
    if (!windows.has(k)) {
      windows.set(k, Array.from({ length: N }, (_, j) => Array.from({ length: N }, (_, i) => w.cells[(cx + i - R) + ',' + (cy + j - R)] || bare)));
    }
    return windows.get(k);
  };
  const frames = routeFrames(route, routeTiles(route, w.cells));
  const base = { ...S, phase: 'cruise', worldBlend: 1, hour: route.hour, weather: route.weather || 'clear', wxField: null, resFloor: 1 };
  return {
    route, tiles: windows,
    views: frames.map((f) => {
      const cx = Math.round(f.x), cy = Math.round(f.y);
      return { ...base, map: windowAt(cx, cy), mapCenter: { x: cx, y: cy }, mapOffset: { x: f.x - cx, y: f.y - cy }, heading: f.heading };
    }),
  };
}

export async function benchRoute(name, opts = {}) {
  if (!ROUTES[name]) { console.warn('__benchRoute: no route ' + name + '; one of ' + Object.keys(ROUTES).join(', ')); return null; }
  const { W = 640, H = 360, quiet = false } = opts;
  const w = await world();
  const { route, views, tiles } = viewsFor(name, w, opts);
  const { uninstall } = rig(W, H);
  const run = pinned(() => {
    setWindshieldProfiler(false);
    for (const v of views) paintWindshield(ID, v);                       // warm
    const clock = opts.gpu === false ? null : gpuClock();
    const cpu = [];
    setWindshieldProfiler(true, { arms: false });
    for (const v of views) {
      const t0 = performance.now();
      if (clock) clock.time(() => paintWindshield(ID, v)); else paintWindshield(ID, v);
      cpu.push(performance.now() - t0);
    }
    const snap = perfSnapshot();
    setWindshieldProfiler(false);
    let passT = null;
    if (opts.passes !== false) {
      glPassTimer(true);
      try { for (const v of views) paintWindshield(ID, v); } finally { passT = glPassTimer(false); }
    }
    return { clock, cpu, snap, passT };
  });
  const gpu = run.clock ? await run.clock.read() : null;
  const passMs = run.passT ? await glPassTimes(run.passT) : null;
  const n = views.length;
  const per = (k) => +((run.snap.t[k] || 0) / n).toFixed(3);
  const out = {
    route: name, seat: route.seat, hour: route.hour, weather: route.weather || 'clear', frames: n, windows: tiles.size, W, H,
    // CPU ms for the whole paint, GL submission included; percentiles over the drive.
    cpu: spreadOf(run.cpu),
    // GPU ms for everything the paint issued on the world's context; null with no timer extension
    // or after a disjoint reading.
    gpu: gpu ? { p50: pct(gpu, 0.5), p95: pct(gpu, 0.95), p99: pct(gpu, 0.99) } : null,
    // GPU ms a frame by pass (gl/core/timer.js), worst first.
    passes: passMs ? Object.fromEntries(Object.entries(passMs).map(([k, v]) => [k, +(v / n).toFixed(3)]).sort((a, b) => b[1] - a[1])) : null,
    // The windshield's own phases, ms a frame. They nest: never sum them.
    phases: { build: per('world:build'), arms: per('world:arms'), sweep: per('world:sweep'), occlude: per('world:occlude'), gl: per('world:gl'), ground: per('ground') },
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  };
  uninstall();
  if (!quiet) {
    console.table([{ route: name, frames: n, cpu50: out.cpu?.p50, cpu95: out.cpu?.p95, cpu99: out.cpu?.p99, gpu50: out.gpu?.p50, gpu95: out.gpu?.p95, build: out.phases.build, arms: out.phases.arms }]);
    if (out.passes) console.table([out.passes]);
  }
  return out;
}

// Every route, `reps` times over the whole list, keeping each route's run with the lowest CPU median.
// A pre-pass over the list first pays the process-wide cold costs (compiling, the atlas, the memos),
// which would otherwise land on whichever route went first (districtcost.js `wheres` says why).
export async function benchRoutes(opts = {}) {
  const { reps = 3, ...rest } = opts;
  const names = opts.routes || Object.keys(ROUTES);
  for (const k of names) await benchRoute(k, { ...rest, passes: false, gpu: false, quiet: true });
  const best = {};
  for (let i = 0; i < reps; i++) {
    for (const k of names) {
      const r = await benchRoute(k, { ...rest, quiet: true });
      if (r && (!best[k] || (r.cpu?.p50 ?? Infinity) < (best[k].cpu?.p50 ?? Infinity))) best[k] = r;
    }
  }
  const out = { at: new Date().toISOString(), device: device(), tune: tuneOf(), reps, routes: best };
  console.table(Object.values(best).map((r) => ({ route: r.route, cpu50: r.cpu?.p50, cpu95: r.cpu?.p95, cpu99: r.cpu?.p99, gpu50: r.gpu?.p50, gpu95: r.gpu?.p95, build: r.phases.build })));
  return out;
}

if (typeof window !== 'undefined') { window.__benchRoute = benchRoute; window.__benchRoutes = benchRoutes; window.__benchDevice = device; }
