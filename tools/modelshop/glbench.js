// WHAT DOES A SKYLINE COST, DRAWN EACH WAY?
//
// The GL spike's deciding criterion, and the one that cannot be answered headlessly: node has no
// GPU, and a canvas call count is not comparable to a triangle count. So this runs in the browser,
// on the machine the game runs on, and times the same city twice.
//
// ⚠ IT MEASURES THE BUILDING PASS, NOT THE FRAME. paintWindshield also draws ground, sky, roads,
// lamps, weather and the cab; GL here draws building mass and nothing else. Timing one against the
// other would be comparing a whole frame with a fifth of one. So the 2-D side is measured as a
// DIFFERENCE — the same map with the buildings and without them — which is the cost of the thing
// being replaced and nothing else.
//
// ⚠ AND GL IS FORCED TO FINISH. Draw calls return long before the GPU has done the work; without
// `finish()` the GL side measures the time to fill a command buffer, which is a number that makes
// any renderer look infinitely fast.
//
// Re-run it from the console with `__glBench()`. It is a measurement, not a gate: the numbers move
// with the machine, so what belongs in a commit message is the RATIO and the conditions.
import { murmurReset, murmurStats } from '/client/game/js/panels/murmur.js';
import { createGLView } from '/client/game/js/panels/gl/context.js';
import { installGL, glLastFrame, glCapabilities } from '/client/game/js/panels/gl/install.js';
import { LIGHT_TUNE } from '/client/game/js/panels/gl/world.js';
import { flocksNear, flockState, speciesAt, flockSize, hawkStoop } from '/client/shared/birds.js';
import { faunaPaintCount } from '/client/game/js/panels/fauna3d.js';
import { paintWindshield, pushLightningStrike, foamReset, shapeModelRegistry, captureModelMesh, wallPaletteInfo, makeCam, RENDER_TUNE, glWorldInstalled, setWindshieldProfiler, perfSnapshot } from '/client/game/js/panels/windshield.js';

const R = 16, N = R * 2 + 1;

// The same shape of city the headless budget uses: a road with a crossroads, a terrace either side,
// bigger stuff behind, and towers out past the LOD ring.
// ⚠ THE RADIUS IS A PARAMETER, because a truck asks for a 33-tile window and an aeroplane asks for
// 73, and the GL buffer holds the WHOLE window — so the aircraft case is four times the geometry
// and is the one that decides whether a rebuild is a hitch. The city pattern is written against
// the window centre, so it fills whatever size it is given.
function scene(withBuildings, r = R) {
  const n = r * 2 + 1;
  const R = r, N = n;
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    if (x === R && y === R - 3) return { kind: 'land', biome: 'citycore', road: 1, rd: 'nesw', flr: 0, pw: 1 };
    if (x === R) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1, sl: y % 3 === 0 ? 1 : 0 };
    if (y === R - 3) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ew', flr: 0, pw: 1 };
    if (!withBuildings) return { kind: 'land', biome: 'citycore', flr: 0 };
    if (x === R - 1 && y % 2 === 0) return { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'east', flr: 2 };
    if (x === R + 1 && y % 2 === 1) return { kind: 'land', biome: 'citycore', bt: 'office', ent: 'west', flr: 6 };
    if (x === R - 4 && y % 3 === 0) return { kind: 'land', biome: 'freight', bt: 'warehouse', ent: 'east', flr: 1 };
    if (x === R + 4 && y % 4 === 0) return { kind: 'land', biome: 'citycore', bt: 'apartment', ent: 'west', flr: 4 };
    if (x === R - 11 && y % 3 === 0) return { kind: 'land', biome: 'citycore', bt: 'office', ent: 'east', flr: 8 };
    if (x === R + 11 && y % 3 === 1) return { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'west', flr: 2 };
    if (x === R + 14 && y === R - 6) return { kind: 'land', biome: 'citycore', bt: 'luxtower', ent: 'west', flr: 30 };
    return { kind: 'land', biome: 'citycore', flr: 0 };
  }));
}

// Every building tile in the scene, as one merged mesh in world coordinates. Built once, exactly as
// a GL renderer would: a city is static geometry and the whole point of a vertex buffer is that it
// is uploaded before the first frame rather than rebuilt during it.
function cityMesh(map) {
  const reg = shapeModelRegistry();
  const byType = new Map(reg.filter((r) => r.key.startsWith('type:')).map((r) => [r.key.slice(5), r.m]));
  const pal = new Map(wallPaletteInfo().map((p) => [p.key, p.rgb]));
  const out = [];
  let tiles = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = map[y][x];
      if (!c.bt) continue;
      const m = byType.get(c.bt);
      if (!m) continue;
      tiles++;
      // Tile centres relative to the camera, the same frame drawWorldObjects works in.
      const dx = x - R, dy = y - R;
      const h = 0.28 + (c.flr || 1) * 0.24;
      for (const f of captureModelMesh(m, { fh: 0.4, h, seed: 3 })) {
        out.push({ ...f, rgb: f.rgbOverride || pal.get(f.pal) || [120, 126, 134], p: f.p.map((p) => [p[0] + dx, p[1] + dy, p[2]]) });
      }
    }
  }
  return { faces: out, tiles };
}

const SYNC_PX = new Uint8Array(4);
function median(a) { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; }

export async function runBench({ frames = 40, W = 1280, H = 720 } = {}) {
  const el = document.createElement('canvas');
  el.width = W; el.height = H;
  el.style.cssText = 'position:fixed;left:-10000px;top:0';
  el.id = '__bench2d';
  document.body.append(el);

  const withB = scene(true), noB = scene(false);
  const view = { cls: 'prop', phase: 'cruise', height: 0.5, worldBlend: 1, hour: 13, weather: 'clear', speed: 0.4 };

  const time2d = (map) => {
    const t = [];
    for (let i = 0; i < frames; i++) {
      const heading = (i * 9) % 360;
      const t0 = performance.now();
      paintWindshield('__bench2d', { ...view, map, heading });
      t.push(performance.now() - t0);
    }
    return median(t);
  };
  time2d(withB);                       // warm every lazy cache the renderer has
  const msFull = time2d(withB);
  const msBare = time2d(noB);

  // ── GL ──
  const cg = document.createElement('canvas');
  cg.width = W; cg.height = H;
  cg.style.cssText = 'position:fixed;left:-10000px;top:0';
  document.body.append(cg);
  const gv = createGLView(cg);
  if (!gv) return { error: 'no webgl2' };
  const { faces, tiles } = cityMesh(withB);
  const tUp0 = performance.now();
  const verts = gv.upload(faces);
  const upload = performance.now() - tUp0;

  // ⚠ TIMED IN BATCHES, BECAUSE ONE FRAME IS BELOW THE CLOCK. The first cut timed a single GL
  // draw and reported 0.00 ms — which is not a result, it is `performance.now()`'s granularity
  // (coarsened to 0.1 ms, and further under cross-origin isolation) being wider than the work. A
  // ratio computed against that is arithmetic on noise: it said 3600x. Batches of draws, divided
  // back out, give a number the clock can actually see.
  // The readback that forces the sync is not free, and it is the same cost at every scale — so it
  // is measured once against an empty scene and subtracted, rather than being quietly folded into
  // every GL number as if it were rendering.
  const syncCost = (() => {
    gv.upload([]);
    const per = [];
    for (let b = 0; b < 5; b++) {
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        gv.draw(makeCam(W, H * 0.42, H * 0.55, { heading: 0, height: 0, eyeH: 1.9, map: null }), {});
      }
      gv.gl.readPixels(0, 0, 1, 1, gv.gl.RGBA, gv.gl.UNSIGNED_BYTE, SYNC_PX);
      per.push((performance.now() - t0) / frames);
    }
    return median(per);
  })();

  const glBatch = (mesh) => {
    gv.upload(mesh);
    const per = [];
    for (let b = 0; b < 5; b++) {
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        const cam = makeCam(W, H * 0.42, H * 0.55, { heading: (i * 9) % 360, height: 0, eyeH: 1.9, map: null });
        gv.draw(cam, {});
      }
      // ⚠ finish() IS NOT ENOUGH ON A CANVAS NOBODY LOOKS AT. With the bench canvas parked off
      // screen and never composited, finish() returned instantly and every scale reported an
      // identical 0.005 ms — 2,866 triangles and 286,600 triangles cannot cost the same, which is
      // how the measurement announced that it was not one. Reading a pixel back stalls the caller
      // until the GPU has actually produced the frame, which is the sync that cannot be elided.
      gv.gl.readPixels(0, 0, 1, 1, gv.gl.RGBA, gv.gl.UNSIGNED_BYTE, SYNC_PX);
      per.push((performance.now() - t0) / frames);
    }
    return Math.max(0, median(per) - syncCost);
  };
  // ── THE CEILING QUESTION ────────────────────────────────────────────────
  // The reason for the whole spike is an order of magnitude more detail, so the same city is
  // replicated into a block and drawn again. One city is far too little to measure: 2,866
  // triangles is a rounding error to any GPU, and the first attempt duly reported the 10x case as
  // FASTER than the 1x one — the clearest possible sign that the clock, not the renderer, was
  // being measured. So it climbs until the number stops being noise.
  // ⚠ THE COPIES GO ON THE SAME BUILDINGS, NOT BESIDE THEM. Tiling the city outward put almost
  // all the extra geometry outside the frustum, where the GPU throws it away before shading a
  // single pixel — and the 100x case duly measured FASTER than the 10x one. What the ceiling
  // question actually asks is what happens when the buildings you can see carry ten times the
  // detail, so a copy is jittered within its own footprint and stays on screen.
  const replicate = (n) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = k * 2.399963, r = 0.22 * Math.sqrt(k / n);
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r, oz = (k % 7) * 0.012;
      for (const f of faces) out.push({ ...f, p: f.p.map((p) => [p[0] + ox, p[1] + oy, p[2] + oz]) });
    }
    return out;
  };
  // ⚠ ONE WARM-UP FIRST, DISCARDED. The first batch through a fresh context pays for shader
  // compilation, buffer allocation and whatever the driver does the first time it sees this
  // geometry, and it lands entirely on whichever scale happens to run first — which is how a run
  // reported the 1x city as twenty times more expensive than the 10x one.
  glBatch(faces);
  const scales = {};
  for (const n of [1, 10, 100]) {
    const mesh = n === 1 ? faces : replicate(n);
    scales[n + 'x'] = { triangles: mesh.reduce((a, f) => a + f.p.length - 2, 0), ms: +glBatch(mesh).toFixed(3) };
  }
  const glMs = scales['1x'].ms, glMs10 = scales['10x'].ms;
  el.remove(); cg.remove();

  const build2d = Math.max(0, msFull - msBare);
  return {
    tiles, faces: faces.length, triangles: verts / 3, uploadMs: +upload.toFixed(1), syncMs: +syncCost.toFixed(3),
    frame2dMs: +msFull.toFixed(3), ground2dMs: +msBare.toFixed(3), buildings2dMs: +build2d.toFixed(3),
    gl: scales,
    // A ratio is only reported where the GL side is above the clock. Below ~0.05 ms per frame the
    // browser timer is quantising rather than measuring, and dividing by it manufactures a number
    // with three digits of confidence and none of accuracy.
    ratio: glMs >= 0.05 ? +(build2d / glMs).toFixed(1) : null,
    ratio10x: glMs10 >= 0.05 ? +(build2d / glMs10).toFixed(1) : null,
    note: glMs < 0.05 ? 'the GL side is below the browser clock resolution at this scale — read the 100x row' : null,
  };
}

// ── GLASS 2, STAGE ONE, END TO END ──────────────────────────────────────────
// Paints a real frame with RENDER_TUNE.gl on: the mass goes to a GL canvas under the 2-D one and
// the arms run with MASS_OFF, so what is left on the 2-D canvas is the lights. The check is that
// BOTH happen — a 2-D pass that got cheaper and a GL canvas that filled — because either alone is
// a way for this to look like it works while doing nothing.
export async function runStage1({ frames = 20, W = 1280, H = 720 } = {}) {
  const el = document.createElement('canvas');
  el.id = '__stage1'; el.width = W; el.height = H;
  el.style.cssText = 'position:fixed;left:-10000px;top:0';
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px';
  holder.append(el); document.body.append(holder);

  const uninstall = installGL(() => el);
  const map = scene(true);
  const view = { cls: 'prop', phase: 'cruise', height: 0.5, worldBlend: 1, hour: 13, weather: 'clear', speed: 0.4, map };
  const time = () => {
    const t = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      paintWindshield('__stage1', { ...view, heading: (i * 9) % 360 });
      t.push(performance.now() - t0);
    }
    return median(t);
  };
  RENDER_TUNE.gl = 0; time(); const ms2d = time();
  RENDER_TUNE.gl = 1; time(); const msGl = time();
  // What ended up on the GL canvas, and what is left on the 2-D one.
  // What the pass says it drew, rather than what a pixel read claims: the drawing buffer of a
  // composited canvas is not preserved, so reading it back after the fact reports an empty city.
  paintWindshield('__stage1', { ...view, heading: 45 });
  const last = glLastFrame();
  const glCanvas = last && last.canvas;
  RENDER_TUNE.gl = 0;
  uninstall();
  holder.remove();
  return {
    installed: glWorldInstalled(), glCanvas: !!glCanvas,
    frame2dMs: +ms2d.toFixed(2), frameGlMs: +msGl.toFixed(2),
    saved: +(ms2d - msGl).toFixed(2), savedPct: +((1 - msGl / ms2d) * 100).toFixed(1),
    glFaces: last ? last.faces : 0,
  };
}

// ── WHERE DOES THE TIME GO WHEN THE MASS LEAVES? ────────────────────────────
// Stage one moved the walls to the GPU and bought about a fifth of the frame, which is a lot
// less than the isolated benchmark implies — the arms still RUN, and only their mass is
// suppressed. So before stage two moves anything else, this asks the renderer own profiler which
// phase is actually left, with the flag off and on, on one scene.
//
// ⚠ THE PHASES ARE INCLUSIVE. `world:build` contains everything the arms do; a child is inside
// its parent number and the columns must not be summed.
export function runPhases({ frames = 40, W = 1280, H = 720, radius = R } = {}) {
  const el = document.createElement('canvas');
  el.id = '__phases'; el.width = W; el.height = H;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const map = scene(true, radius);
  const view = { cls: 'prop', phase: 'cruise', height: 0.5, worldBlend: 1, hour: 13, weather: 'clear', speed: 0.4, map };
  // The profiler accumulates; frames are counted here rather than through perfTick, which prints
  // and RESETS on its own two-second clock and would silently halve a long run.
  const run = (gl) => {
    RENDER_TUNE.gl = gl;
    setWindshieldProfiler(false);
    for (let i = 0; i < 8; i++) paintWindshield('__phases', { ...view, heading: (i * 9) % 360 });   // warm caches, meshes, atlases
    setWindshieldProfiler(true);
    for (let i = 0; i < frames; i++) paintWindshield('__phases', { ...view, heading: (i * 9) % 360 });
    const s = perfSnapshot();
    setWindshieldProfiler(false);
    const last = glLastFrame();
    return { t: s.t, n: s.n, builds: last ? last.builds : 0, glFaces: last ? last.faces : 0 };
  };
  const a = run(0), b = run(1);
  // A buffer rebuilt on every frame draws the same picture as one rebuilt once, so this is the only
  // way to see the difference: `builds` over `frames` should be a small number, not `frames`.
  const rebuilds = b.builds - a.builds;
  RENDER_TUNE.gl = 0; uninstall(); holder.remove();
  const keys = [...new Set([...Object.keys(a.t), ...Object.keys(b.t)])];
  const rows = keys.map((k) => ({
    phase: k,
    '2-D ms': +((a.t[k] || 0) / frames).toFixed(3),
    'GL ms': +((b.t[k] || 0) / frames).toFixed(3),
    delta: +(((b.t[k] || 0) - (a.t[k] || 0)) / frames).toFixed(3),
  })).sort((x, y) => y['2-D ms'] - x['2-D ms']);
  const counts = [...new Set([...Object.keys(a.n), ...Object.keys(b.n)])].map((k) => ({
    count: k, '2-D': +((a.n[k] || 0) / frames).toFixed(0), GL: +((b.n[k] || 0) / frames).toFixed(0),
  }));
  console.table(rows); console.table(counts);
  console.log(`   GL: ${b.glFaces} faces, ${rebuilds} buffer rebuild(s) over ${frames} frames`);
  return { rows, counts, rebuilds, glFaces: b.glFaces };
}

// ── DOES IT LOOK LIKE THE SAME BUILDING? ────────────────────────────────────
//
// The spike answered this once, by eye and by hand, and the answer did not survive as anything
// re-runnable — so "mean colour difference 6.8-12.7%" became a number in a README that nothing
// could check. This is that measurement as a function.
//
// ⚠ IT COMPARES ONE BUILDING, ALONE, FROM A FIXED SEAT, and that restriction is the whole point.
// A whole-frame diff of a city measures COVERAGE, not fidelity: with the flag on, GL draws the
// entire map window while the 2-D pass drops everything off the side of the canvas or behind a
// nearer block, and the lights reach twenty-two tiles instead of eight. Every one of those is an
// improvement and all of them would land in the number as error. One building on an empty map
// draws the same set in both renderers, so what is left is shading, texture and geometry.
//
// The mask is taken from a THIRD render with no building at all: the pixels where the 2-D frame
// differs from the empty one are the building, and nothing else is measured.
//
// ⚠ AND THE CLOCK IS FROZEN, or none of it means anything. Two renders of the SAME empty scene
// differ by ninety-eight thousand pixels, because the clouds drift, the birds fly and the water
// moves — every one of them off `performance.now()`. A pixel comparison across a moving sky
// measures the sky. `framecost` froze the clock for the same reason and this borrows the trick.
export async function runFidelity({ keys = null, hours = [13, 23], W = 640, H = 360 } = {}) {
  const realNow = performance.now.bind(performance);
  performance.now = () => 1e6;
  try {
  const el = document.createElement('canvas');
  el.id = '__fid'; el.width = W; el.height = H;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:360px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const R = 16, N = 33;
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const map = (bt) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
    bt && x === R && y === R - 2 ? { kind: 'land', biome: 'citycore', bt, ent: 'south', flr: 4 }
      : { kind: 'land', biome: 'citycore', flr: 0 })));
  const types = keys || ['shop', 'office', 'apartment', 'warehouse', 'club', 'police', 'hotel', 'clinic'];
  const rows = [];
  for (const bt of types) {
    for (const hour of hours) {
      const view = { cls: 'truck', phase: 'cruise', height: 0, eyeH: 0.24, worldBlend: 1, hour, weather: 'clear', speed: 0, heading: 0, mapOffset: { x: 0, y: -0.4 } };
      RENDER_TUNE.gl = 0;
      paintWindshield('__fid', { ...view, map: map(null) }); paintWindshield('__fid', { ...view, map: map(null) });
      const bare = shot();
      paintWindshield('__fid', { ...view, map: map(bt) }); paintWindshield('__fid', { ...view, map: map(bt) });
      const two = shot();
      RENDER_TUNE.gl = 1;
      paintWindshield('__fid', { ...view, map: map(bt) }); paintWindshield('__fid', { ...view, map: map(bt) });
      const three = shot();
      let n = 0, sum = 0, over = 0, worst = 0;
      for (let i = 0; i < bare.length; i += 4) {
        const d0 = Math.abs(two[i] - bare[i]) + Math.abs(two[i + 1] - bare[i + 1]) + Math.abs(two[i + 2] - bare[i + 2]);
        if (d0 < 12) continue;                      // not the building
        const d = (Math.abs(three[i] - two[i]) + Math.abs(three[i + 1] - two[i + 1]) + Math.abs(three[i + 2] - two[i + 2])) / 3;
        n++; sum += d; if (d > 16) over++; if (d > worst) worst = d;
      }
      rows.push({ model: bt, hour, px: n, meanPct: n ? +(sum / n / 255 * 100).toFixed(1) : null,
        overPct: n ? +(over / n * 100).toFixed(1) : null, worst: Math.round(worst) });
    }
  }
  RENDER_TUNE.gl = 0; uninstall(); holder.remove();
  const lit = rows.filter((r) => r.px > 200);
  const mean = lit.length ? +(lit.reduce((a, r) => a + r.meanPct, 0) / lit.length).toFixed(1) : null;
  console.table(rows);
  console.log(`   mean colour difference over the building: ${mean}% across ${lit.length} cases`);
  return { rows, mean };
  } finally { performance.now = realNow; }
}

// ── DOES GLASS 2 TOUCH THE GROUND? ──────────────────────────────────────────
//
// It should not: the pass draws building MASS and lights, and the Mode-7 floor is painted before
// the blit and never suppressed. But "the terrain looks wrong with it on" is a report that arrives
// naturally — the flag changes the picture, so everything in the picture falls under suspicion —
// and the only way to answer it is to measure the ground on its own.
//
// The split is the point: the building mask comes from a 2-D pair with and without buildings, and
// everything OUTSIDE it is ground. Then the same frame is compared flag-off against flag-on, and
// the two halves are reported separately. Ground differing and buildings differing are completely
// different findings and a whole-frame number tells them apart not at all.
export function runTerrain({ W = 800, H = 400 } = {}) {
  const el = document.createElement('canvas');
  el.id = '__terrain'; el.width = W; el.height = H;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const realNow = performance.now.bind(performance);
  performance.now = () => 1e6;                       // see runFidelity: a moving sky is not a finding
  try {
    const R = 16, N = 33;
    const mk = (withB) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      if (x === R) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (y === R - 4) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ew', flr: 0, pw: 1 };
      if (withB && x === R - 2 && y % 3 === 0) return { kind: 'land', biome: 'citycore', bt: 'office', ent: 'east', flr: 6 };
      if (withB && x === R + 2 && y % 3 === 1) return { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'west', flr: 3 };
      if (x > R + 5) return { kind: 'land', biome: 'grass', flr: 0 };
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
    const v = { cls: 'heli', phase: 'cruise', height: 0.18, worldBlend: 1, hour: 18, weather: 'clear', speed: 0.3, heading: 0, mapOffset: { x: 0.1, y: -0.2 }, pitch: 4, bank: -6 };
    const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
    const paint = (g, m) => { RENDER_TUNE.gl = g; paintWindshield('__terrain', { ...v, map: m }); paintWindshield('__terrain', { ...v, map: m }); return shot(); };
    const bare = paint(0, mk(false)), two = paint(0, mk(true)), three = paint(1, mk(true));
    let gN = 0, gSum = 0, gBad = 0, bN = 0, bSum = 0;
    for (let i = 0; i < bare.length; i += 4) {
      const isB = Math.abs(two[i] - bare[i]) + Math.abs(two[i + 1] - bare[i + 1]) + Math.abs(two[i + 2] - bare[i + 2]) >= 12;
      const d = (Math.abs(three[i] - two[i]) + Math.abs(three[i + 1] - two[i + 1]) + Math.abs(three[i + 2] - two[i + 2])) / 3;
      if (isB) { bN++; bSum += d; } else { gN++; gSum += d; if (d > 16) gBad++; }
    }
    const out = {
      groundPx: gN, groundMeanPct: +(gSum / gN / 255 * 100).toFixed(2), groundBadPct: +(gBad / gN * 100).toFixed(2),
      buildingPx: bN, buildingMeanPct: +(bSum / bN / 255 * 100).toFixed(2),
    };
    console.log(`   ground ${out.groundMeanPct}% over ${gN} px · buildings ${out.buildingMeanPct}% over ${bN} px`);
    return out;
  } finally { RENDER_TUNE.gl = 0; performance.now = realNow; uninstall(); holder.remove(); }
}


// ── IS THE GPU FLOOR THE SAME GROUND? ────────────────────────────────────────
//
// `__glFloor()` — the floor's own fidelity question, and it is NOT runFidelity's. That one masks a
// single building out of the frame, because a whole-frame diff would measure coverage rather than
// shading. The floor IS the whole frame below the horizon, so here the whole frame is the subject
// and the two sides are the SAME renderer with the ground drawn two ways: GLASS 2 over the 2-D
// Mode-7 raster, and GLASS 2 over the shader. Nothing else moves.
//
// ⚠ FREEZE THE CLOCK, AND NOT ONLY FOR THE SKY. `performance.now` is also what drives the dynamic
// resolution dial and `PERF_DS`, and both are per-CANVAS state that `sceneFor` caches by element id
// and keeps across a page reload. Measured on a live clock the two canvases shed resolution at
// different rates, the comparison silently starts holding a 576-wide frame against a 640-wide one,
// and every scene reports a fidelity regression that is really a scale mismatch. That cost most of
// an afternoon and produced a "road scenes are 35% wrong" finding that was never true. A frozen
// clock pins frameMs at 0, which pins resTarget at 1 and PERF_DS at 0 — so the dial is held by the
// same trick that already holds the weather.
//
// ⚠ AND THE CANVAS GETS AN EXPLICIT CSS SIZE. Without one its layout size follows its width
// ATTRIBUTE, which paintWindshield rewrites — so on a hidpi display every frame resizes the canvas
// from the size the last frame gave it, and the harness spirals instead of measuring.
const FLOOR_SCENES = (R) => ({
  city: () => ({ kind: 'land', biome: 'citycore', flr: 0 }),
  park: () => ({ kind: 'land', biome: 'parkland', flr: 0 }),
  scrub: () => ({ kind: 'land', biome: 'scrub', flr: 0 }),
  redrock: () => ({ kind: 'land', biome: 'redrock', flr: 0 }),
  // Water dead ahead, land behind: the swell, the glitter path, the surf band and the shore emboss
  // are all placed against waterness, so a coast has to be IN the frame for any of them to be read.
  sea: (x, y) => (y <= R ? { kind: 'water', biome: 'water' } : { kind: 'land', biome: 'parkland', flr: 0 }),
  // Unbuilt tiles ahead, so what gets measured is fillOffMap's wildlands extension.
  offmap: (x, y) => (y > R - 4 ? { kind: 'land', biome: 'scrub', flr: 0 } : null),
  road: (x, y) => {
    const dx = x - R;
    if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
    if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
    if ((x + y) % 4 === 0) return { kind: 'land', biome: 'parkland', flr: 0 };
    return { kind: 'land', biome: 'citycore', flr: 0 };
  },
  town: (x, y) => {
    const dx = x - R;
    if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
    if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
    return { kind: 'land', biome: 'citycore', bt: 'shop', bn: 'S' + x + '_' + y, ent: 'west', flr: 3 };
  },
});

// Two cases the map alone cannot reach, because what they exercise is the SEAT rather than the
// ground: the things GLASS 1 still paints on the canvas underneath the blit. Both were found by
// looking for what else is drawn between drawGroundSurfaces and drawWorldObjects, not by noticing
// them in a picture — the headlight pool only exists at night with the lamps on, and the own-ship
// shadow only reaches the screen from an external camera.
const FLOOR_SEATS = [
  { tag: 'headlights', scene: 'road', hour: 2, view: { landingLight: true } },
  { tag: 'ownshadow-air', scene: 'scrub', hour: 8, view: { external: true, cls: 'prop', height: 0.05 } },
  { tag: 'ownshadow-parked', scene: 'scrub', hour: 12, view: { external: true, cls: 'prop', phase: 'ground', height: 0 } },
  { tag: 'ownshadow-heli', scene: 'scrub', hour: 8, view: { external: true, cls: 'heli', height: 0.04 } },
];

export function runFloor({ W = 640, H = 360, R = 20, hours = [13, 2] } = {}) {
  const realNow = performance.now.bind(performance);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const mk = (id) => {
    const c = document.createElement('canvas');
    c.id = id; c.width = W; c.height = H;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    holder.append(c); return c;
  };
  const a2 = mk('__floor2d'), aG = mk('__floorGL');
  document.body.append(holder);
  // The hook hands back whichever canvas is being painted, so one install serves both.
  let live = a2;
  const uninstall = installGL(() => live);
  performance.now = () => 1e6;
  const N = R * 2 + 1, S = FLOOR_SCENES(R);
  const rows = [];
  const cases = [];
  for (const name of Object.keys(S)) for (const hour of hours) cases.push({ tag: name + '@' + hour, scene: name, hour, view: null });
  for (const s of FLOOR_SEATS) cases.push(s);
  try {
    {
      for (const { tag, scene, hour, view: seat } of cases) {
        const fn = S[scene];
        const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => fn(x, y)));
        const view = {
          cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour,
          weather: 'clear', speed: 0.4, map, heading: 0, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
          ...(seat || {}),
        };
        RENDER_TUNE.gl = 1;
        // Painted twice on each side: the first frame builds every lazy cache the renderer has.
        live = a2; RENDER_TUNE.glFloor = 0;
        paintWindshield('__floor2d', view); paintWindshield('__floor2d', view);
        live = aG; RENDER_TUNE.glFloor = 1;
        paintWindshield('__floorGL', view); paintWindshield('__floorGL', view);
        RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;
        if (a2.width !== aG.width || a2.height !== aG.height) {
          rows.push({ scene: tag, badPct: 'SIZE ' + a2.width + '/' + aG.width, meanPct: '-' });
          continue;
        }
        const A = a2.getContext('2d').getImageData(0, 0, a2.width, a2.height).data;
        const B = aG.getContext('2d').getImageData(0, 0, aG.width, aG.height).data;
        let bad = 0, sum = 0, n = 0;
        for (let i = 0; i < A.length; i += 4) {
          const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
          n++; sum += d; if (d > 24) bad++;
        }
        rows.push({ scene: tag, badPct: +(bad / n * 100).toFixed(2), meanPct: +(sum / n / 255 * 100).toFixed(2) });
      }
    }
  } finally {
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0; performance.now = realNow; uninstall(); holder.remove();
  }
  const worst = rows.reduce((m, r) => (typeof r.badPct === 'number' && r.badPct > m ? r.badPct : m), 0);
  console.table(rows);
  console.log('   worst scene ' + worst + '% of pixels differing by more than 24 levels, over ' + rows.length + ' scenes');
  return { rows, worst };
}

// ── AND WHAT DOES THE GROUND COST? ───────────────────────────────────────────
//
// `__glFloorCost()`. The Mode-7 raster is a fixed per-pixel software loop and it is the single
// biggest thing in the frame — which is the whole reason `PERF_DS` exists — so the number that
// matters is wall clock, and unlike the fidelity run this one cannot freeze the clock.
//
// ⚠ SO THE RESOLUTION DIAL IS PINNED BY HAND INSTEAD (`resFloor: 1`, `perfDS: 0`). Left alone, the
// slow renderer sheds resolution and the fast one does not, and the comparison flatters whichever
// side is already losing: it measures the dial rather than the floor.
export function runFloorCost({ W = 640, H = 360, R = 20, frames = 40 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__floorCost'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const N = R * 2 + 1, S = FLOOR_SCENES(R);
  const rows = [];
  const perf = RENDER_TUNE.perfDS;
  try {
    RENDER_TUNE.perfDS = 0;
    for (const name of ['city', 'town', 'sea', 'road']) {
      const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => S[name](x, y)));
      const view = {
        cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour: 13,
        weather: 'clear', speed: 0.4, map, heading: 0, mapCenter: { x: 100, y: 100 },
        mapOffset: { x: 0.2, y: -0.3 }, resFloor: 1,
      };
      const run = (g, f) => {
        RENDER_TUNE.gl = g; RENDER_TUNE.glFloor = f;
        for (let i = 0; i < 12; i++) paintWindshield('__floorCost', view);
        const t0 = performance.now();
        // The heading walks, so nothing measures a frame whose every cache is already warm for
        // exactly that camera - which is not a frame anybody ever flies.
        for (let i = 0; i < frames; i++) paintWindshield('__floorCost', { ...view, heading: i * 0.7 });
        return +((performance.now() - t0) / frames).toFixed(2);
      };
      const g1 = run(0, 0), g2 = run(1, 0), g2f = run(1, 1);
      rows.push({
        scene: name, 'GLASS 1': g1, 'GLASS 2, 2-D floor': g2, 'GLASS 2, GPU floor': g2f,
        speedup: +(g1 / Math.max(0.01, g2f)).toFixed(1) + 'x',
      });
    }
  } finally {
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0; RENDER_TUNE.perfDS = perf; uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   ms per frame at ' + W + 'x' + H + '; the middle column is why the floor had to follow the mass');
  return rows;
}

// ── AND IS THE NAME STILL ON THE BUILDING? ───────────────────────────────────
//
// __glSign(). World text — a name across a parapet, a stencilled bay number, a price board — was
// the last thing GLASS 1 still drew in the world, at eight affine strips a sign because a 2-D
// canvas cannot map a texture through a perspective divide. On the GPU it is one depth-tested
// quad, which is cheaper and correct per pixel where the probe was correct per surface.
//
// ⚠ AND ITS FAILURE MODE IS SILENCE, WHICH IS WHY THIS EXISTS. A sign is PAINT ON A WALL, exactly
// coplanar with it, so a tie in the depth test loses and the lettering is simply not there: no
// error, no warning, no gap in the picture, just a building with no name — which looks exactly
// like a building that never had one. The 2-D queue could not fail that way, because DECO_LIFT
// sorts an adornment 0.6 tiles in front of its own host and it drew whatever it was standing
// behind. So the two sides here are the SAME renderer with the signage drawn two ways
// (RENDER_TUNE.glSign), which is __glFloor's shape and for the same reason: nothing else moves,
// so every pixel of difference IS the lettering.
//
// ⚠ ONE SIGNED BUILDING, ALONE, ON EMPTY GROUND. Every subject is a model whose arm letters
// itself, and nothing stands anywhere near it — a whole-frame diff of a city would measure how
// much of the name a nearer building correctly covers, which is the improvement rather than the
// error. It found the bug it was written for: The Dry Goods letters its false front on a plane a
// tenth of a footprint INSIDE the board, and the lift had covered for that since it was written.
//
// ⚠ FREEZE THE CLOCK, for the reasons written out over __glFloor — it drives the resolution dial
// and PERF_DS as well as the sky, both are per-canvas state cached across a page reload, and two
// canvases measured on a live clock quietly end up different sizes.
const SIGN_SUBJECTS = [
  ['the dry goods', { bt: 'shop', bn: 'The Dry Goods', flr: 3 }],
  ['the assay', { bt: 'shop', bn: 'The Assay', flr: 3 }],
  ['the last load', { bt: 'shop', bn: 'The Last Load', flr: 2 }],
  ['ration nine', { bt: 'shop', bn: 'Ration Nine', flr: 2 }],
  ['the meridian', { bt: 'shop', bn: 'The Meridian Lobby', flr: 8 }],
  ['buzzard field', { bt: 'shop', bn: 'Buzzard Field', flr: 2 }],
  ["the coyote's rest", { bt: 'shop', bn: "The Coyote's Rest", flr: 2 }],
  ['the layover', { bt: 'shop', bn: 'The Layover', flr: 2 }],
  ['adequate!', { bt: 'dept_store', flr: 4 }],
];

// ⚠ SQUARE ON IS NOT ENOUGH, AND THAT IS WHERE THE FIRST DRAFT OF THIS STOPPED. Head-on, a sign
// clears its own facade or it does not. At a GRAZING angle the building's own parapet, cornice and
// porch cross in front of the lettering plane, so the inset that matters is the one along the view
// RAY rather than the one along the wall normal — which is a different number at every heading. So
// the sweep carries four entrance facings seen from three tiles off the axis, the same reason
// gl:mesh captures all four rather than the canonical one.
const SIGN_SEATS = [
  { tag: '3T day', ent: 'south', off: 0, dist: 3, hour: 13 },
  { tag: '3T night', ent: 'south', off: 0, dist: 3, hour: 2 },
  { tag: '6T day', ent: 'south', off: 0, dist: 6, hour: 13 },
  { tag: '6T night', ent: 'south', off: 0, dist: 6, hour: 2 },
  { tag: 'oblique S', ent: 'south', off: 3, dist: 4, hour: 13 },
  { tag: 'oblique E', ent: 'east', off: 3, dist: 4, hour: 13 },
  { tag: 'oblique W', ent: 'west', off: 3, dist: 4, hour: 13 },
  { tag: 'oblique N', ent: 'north', off: 3, dist: 4, hour: 13 },
];

export function runSign({ W = 640, H = 360, RAD = 12, seats = SIGN_SEATS } = {}) {
  const realNow = performance.now.bind(performance);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const mk = (id) => {
    const c = document.createElement('canvas');
    c.id = id; c.width = W; c.height = H;
    c.style.width = W + 'px'; c.style.height = H + 'px';
    holder.append(c); return c;
  };
  const a2 = mk('__sign2d'), aG = mk('__signGL');
  document.body.append(holder);
  let live = a2;
  const uninstall = installGL(() => live);
  performance.now = () => 1e6;
  const N = RAD * 2 + 1;
  const rows = [];
  try {
    for (const [tag, cell] of SIGN_SUBJECTS) {
      for (const seat of seats) {
        const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) =>
          (x === RAD + seat.off && y === RAD - seat.dist)
            ? { kind: 'land', biome: 'citycore', ...cell, ent: seat.ent }
            : { kind: 'land', biome: 'citycore', flr: 0 }));
        const view = { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour: seat.hour,
          weather: 'clear', speed: 0.4, map, heading: 0, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 } };
        RENDER_TUNE.gl = 1;
        // Painted twice on each side: the first frame builds every lazy cache the renderer has.
        live = a2; RENDER_TUNE.glSign = 0;
        paintWindshield('__sign2d', view); paintWindshield('__sign2d', view);
        live = aG; RENDER_TUNE.glSign = 1;
        paintWindshield('__signGL', view); paintWindshield('__signGL', view);
        RENDER_TUNE.gl = 0;
        if (a2.width !== aG.width || a2.height !== aG.height) {
          rows.push({ subject: tag, seat: seat.tag, badPct: 'SIZE ' + a2.width + '/' + aG.width });
          continue;
        }
        const A = a2.getContext('2d').getImageData(0, 0, a2.width, a2.height).data;
        const B = aG.getContext('2d').getImageData(0, 0, aG.width, aG.height).data;
        let bad = 0, n = 0;
        for (let i = 0; i < A.length; i += 4) {
          const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
          n++; if (d > 24) bad++;
        }
        rows.push({ subject: tag, seat: seat.tag, badPct: +(bad / n * 100).toFixed(3) });
      }
    }
  } finally {
    RENDER_TUNE.gl = 0; RENDER_TUNE.glSign = 1; performance.now = realNow; uninstall(); holder.remove();
  }
  const worst = rows.reduce((m, r) => (typeof r.badPct === 'number' && r.badPct > m ? r.badPct : m), 0);
  console.table(rows.filter((r) => typeof r.badPct !== 'number' || r.badPct > 0));
  console.log('   worst subject ' + worst + '% of pixels differing by more than 24 levels, over ' + rows.length + ' cases');
  return { rows, worst };
}


// ── WHERE DOES THE FRAME GO, NOW THAT MOST OF IT IS ON THE GPU? ──────────────
//
// `__glFrame()`. Every other bench here answers "is this one thing faithful" or "what does this
// one thing cost". This one answers the question you ask before deciding what to port NEXT, and
// it exists because that question was got wrong three times running on ad-hoc scenes.
//
// ⚠ THE SCENE COMES FROM THE WHOLE REGISTRY, NEVER FROM HAND-PICKED NAMES. A city built from
// eight chosen models reported the 2-D adornment queue at 1,597 faces a frame, and that number
// was used to call the queue the last big thing left to port. Swept properly it is 43 — because
// one of those eight was The Meridian Lobby, whose gargoyles alone are 44% of every face all 173
// models emit. Picking the names by hand picks the answer.
//
// ⚠ PIN THE RESOLUTION DIAL, OR A SLOW FRAME MEASURES FAST. `resFloor: 1` and `perfDS: 0`. Left
// alone the dial sheds resolution exactly where the frame is expensive, so a storm measured
// CHEAPER than clear sky and night cheaper than day — the dial being read as the renderer. The
// fidelity runs freeze the clock for the same reason; a timing run cannot, so it pins the dial
// by hand instead.
//
// ⚠ AND IT REPORTS A SPREAD, WHICH IS THE POINT. Medians here move by two to three times between
// runs on one machine — warm-up, the driver, and whatever else has the GPU. A single number
// invites a decision it cannot support: the same seat gave the occluder pre-pass an 8.4 ms COST
// and a 6.7 ms SAVING in two consecutive runs. Independent medians with the spread printed beside
// them is what says whether a difference is real. If the spread straddles the thing you are
// trying to measure, the answer is "measure again", not "port it".
const FRAME_SEATS = [
  { tag: 'cab, sparse', R: 14, density: 0.06, hour: 2, cls: 'truck' },
  { tag: 'cab, dense', R: 14, density: 0.18, hour: 2, cls: 'truck' },
  { tag: 'cab, dense day', R: 14, density: 0.18, hour: 13, cls: 'truck' },
  { tag: 'air, sparse', R: 36, density: 0.02, hour: 2, cls: 'prop' },
  { tag: 'air, dense', R: 36, density: 0.05, hour: 2, cls: 'prop' },
];

export function runFrame({ W = 640, H = 360, reps = 3, frames = 20, warm = 8 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__frame'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  // Deterministic, unlike the clock: the canvas2d call count is the same every run, so it is the
  // half of this report that can be compared against a number written down last month.
  const realGet = HTMLCanvasElement.prototype.getContext;
  let calls = null;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    const ctx = realGet.call(this, t, o);
    if (this.id !== '__frame' || t !== '2d') return ctx;
    return new Proxy(ctx, {
      get(o2, k) { const v = o2[k]; if (typeof v !== 'function') return v; return (...a) => { if (calls) calls.n++; return v.apply(o2, a); }; },
      set(o2, k, v) { o2[k] = v; return true; },
    });
  };

  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0, n = 0;
    const m = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        n++;
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6), ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
    m._buildings = n;
    return m;
  };
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };

  const rows = [];
  try {
    for (const seat of FRAME_SEATS) {
      const built = mk(seat.R, seat.density), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      const once = (map) => {
        const v = view(map);
        for (let i = 0; i < warm; i++) paintWindshield('__frame', v);
        const t = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield('__frame', v); t.push(performance.now() - t0); }
        return mid(t);
      };
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      const bs = [], rs = [];
      for (let r = 0; r < reps; r++) { bs.push(once(built)); rs.push(once(bare)); }
      // The call count comes from ONE painted frame, after every lazy cache is warm.
      paintWindshield('__frame', view(built));
      calls = { n: 0 }; paintWindshield('__frame', view(built)); const nCalls = calls.n; calls = null;
      const L = glLastFrame() || {};
      RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;
      const b = mid(bs), r0 = mid(rs);
      rows.push({
        seat: seat.tag, window: seat.R * 2 + 1, buildings: built._buildings,
        ms: +b.toFixed(2),
        spread: Math.min(...bs).toFixed(1) + '-' + Math.max(...bs).toFixed(1),
        bareMs: +r0.toFixed(2), cityMs: +(b - r0).toFixed(2),
        calls2d: nCalls, glFaces: L.faces || 0, lights: L.lights || 0, decals: L.decals || 0,
      });
    }
  } finally {
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;
    HTMLCanvasElement.prototype.getContext = realGet;
    uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   ⚠ ms moves with warm-up and the driver — read the spread before believing a difference.');
  console.log('   calls2d is deterministic and is the number to compare across days.');
  return rows;
}
// ── DOES A SIGN LIGHT THE WALL IT IS BOLTED TO? ─────────────────────────────
//
// `__glLights()`. The mass shader takes the frame own light list now, so a neon sign washes the
// facade behind it instead of hanging in front of a wall that has never heard of it. Two
// questions, and they need two different runs.
//
// ⚠ FIRST, DID IT REACH ANY PIXELS AT ALL — because the failure mode is silence, exactly as it
// was for the signage. A uniform location that came back null is a legal no-op, a light list that
// arrived in the wrong frame falls off the building, and a reach that resolves too small lights
// nothing. Every one of those draws the city correctly and looks like the feature being subtle.
// So the first half is a PIXEL DIFF of the same frame with the flag off and on, over the mask of
// what the buildings cover, with the clock frozen (the sky drifts, and a diff across a moving sky
// measures the sky).
//
// ⚠ SECOND, WHAT IT COSTS, which is a fill question and not a geometry one: twelve lights is
// twelve distance tests on every wall pixel, so the number moves with resolution and with how
// much of the frame is building. Measured on the same seats __glFrame uses, with the resolution
// dial pinned for the reason given there.
const LIGHT_SEATS = [
  { tag: 'cab, dense night', R: 14, density: 0.18, hour: 2, cls: 'truck' },
  { tag: 'cab, dense day', R: 14, density: 0.18, hour: 13, cls: 'truck' },
  { tag: 'air, dense night', R: 36, density: 0.05, hour: 2, cls: 'prop' },
];

// The settings swept. An empty `set` is whatever LIGHT_TUNE currently holds, so the shipping row is
// always in the table beside the alternatives rather than being a number in a comment somebody
// wrote down once.
// ⚠ A ROW NAMED AS A MULTIPLE AND WRITTEN AS AN ABSOLUTE GOES STALE SILENTLY. 'gain x1.5' held a
// literal 2.25, which was x1.5 of the 1.5 that shipped when it was written — and after the gain was
// cut to 0.45 the same row was x5, still printing "x1.5" above a number nobody would have chosen.
// The gain rows are named by their VALUE now, because the value is what is being decided.
const LIGHT_SWEEP = [
  { tag: 'lambert (wrap 0)', set: { wrap: 0 } },
  { tag: 'shipping', set: {} },
  { tag: 'wrap 1.0', set: { wrap: 1 } },
  { tag: 'wrap 0.45', set: { wrap: 0.45 } },
  { tag: 'wrap 0.35', set: { wrap: 0.35 } },
  { tag: 'wrap 0.25', set: { wrap: 0.25 } },
  { tag: 'span x1.5', set: { span: 4.8 } },
  { tag: 'minR 2.0', set: { minR: 2 } },
  // ── THE BLOOM AXIS ─────────────────────────────────────────────────────────────────────────
  //
  // ⚠ AND `litPct` SCORES THIS ONE BACKWARDS, WHICH IS WHY `conc` EXISTS. Every row below moves
  // FEWER wall pixels than the wash it replaced, and that is the change rather than a regression:
  // a sign is supposed to light the wall it is bolted to and not the block. The column to read on
  // these rows is `conc` — peak over mean across the pixels that moved, so a flat tint sits near
  // 1 and a bloom climbs. See the ⚠ on LIGHT_TUNE for why the gain and the reach move together.
  { tag: 'old broad wash', set: { wallR: 1, focus: 2, gain: 0.18 } },
  { tag: 'wallR 0.22', set: { wallR: 0.22 } },
  { tag: 'wallR 0.45', set: { wallR: 0.45 } },
  { tag: 'wallR 0.65', set: { wallR: 0.65 } },
  { tag: 'focus 2.0 (shipped shape)', set: { focus: 2 } },
  { tag: 'focus 4.0', set: { focus: 4 } },
  // ⚠ AND THE GAIN ROWS HAVE TO BRACKET THE SHIPPING VALUE ON BOTH SIDES. They were 0.70/1.00/1.40
  // — every one of them brighter than what ships — which is fine while the question is "how much
  // headroom is left" and useless the moment the answer is another cut. The shipping row is 0.18.
  // ⚠ AND THEY MOVED WITH THE BLOOM. The shipping gain is 2.5 now, not 0.18 — a gain is only ever
  // meaningful against the reach it is spread over, so the old rows (0.12 … 1.00) all sit below a
  // setting that would now be most of the way to switching the feature off.
  { tag: 'gain 1.20', set: { gain: 1.20 } },
  { tag: 'gain 1.80', set: { gain: 1.80 } },
  { tag: 'gain 3.20', set: { gain: 3.20 } },
  { tag: 'gain 4.50', set: { gain: 4.50 } },
];

// ── A FROZEN CLOCK HIDES THE LIGHTS, AND EVERY LIGHT MEASUREMENT HERE WAS BLIND ────────────────
//
// ⚠ THESE HARNESSES ALL PIN `performance.now`, for the good reason the fidelity rig records: two
// renders of the same empty scene differ by ninety-eight thousand pixels because the clouds drift
// and the birds fly, so a moving sky is not a finding. Then `fadeLights` shipped, and the light set
// became a function of ELAPSED TIME — a light ramps into its slot over a few frames rather than
// appearing in it. Under a clock that never advances, dt is 0 on every frame, no light ever ramps,
// and `glLastFrame().lit` is 0 for ever.
//
// So every seat in `__glLights` has been reporting 0.0% of wall pixels moved since that landed, at
// every setting of its own sweep — which is precisely what the feature being switched off looks
// like, and precisely what its own documentation warns about for the shader end of the same wire.
// The numbers in the tree for that pass (43% on a dense night cab frame, 23.5% from the air) were
// measured before the fade existed and cannot be reproduced by the harness that produced them.
//
// The fix keeps both properties: STEP the clock until the fade reaches its steady state, then FREEZE
// it and take the A and B renders at the same instant. The sky is still still; the lights are on.
function settleFade(paint, frames = 24, step = 33, t0 = 1e6) {
  let t = t0;
  for (let i = 0; i < frames; i++) { t += step; performance.now = () => t; paint(); }
  performance.now = () => t;      // frozen from here, so A and B differ only by the thing under test
  return t;
}

export function runLights({ W = 640, H = 360, frames = 30, warm = 10 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith("named:"));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__lights'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };

  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0, n = 0;
    const m = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        n++;
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6), ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
    m._buildings = n;
    return m;
  };

  const rows = [], swept = [];
  const realNow = performance.now.bind(performance);
  try {
    for (const seat of LIGHT_SEATS) {
      // ⚠ A SEAT OF ITS OWN, BECAUSE A FROZEN CLOCK CANNOT SETTLE A SCENE. `sceneFor(id)` keeps
      // smoothed per-view state and advances it by dt — which under a stubbed `performance.now` is
      // ZERO for ever, so the aeroplane seat inherited the truck seat that ran before it and its
      // with-buildings and without-buildings frames came back IDENTICAL. That reads as wallPx 0 and
      // litPct null, which looks exactly like the lights doing nothing rather than like the harness
      // measuring the wrong camera. It was right on the first call of a fresh page and wrong on
      // every one after, which is the worst way for a harness to be wrong.
      const ID = '__lights' + LIGHT_SEATS.indexOf(seat) + '_' + (runLights.n = (runLights.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;

      // ── the picture, clock settled then frozen — see settleFade ──
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };
      RENDER_TUNE.glLights = 0;
      performance.now = () => 1e6;
      paint2(view(bare)); const empty = shot();
      paint2(view(built)); const off = shot();
      // ⚠ THE MASK IS THE BUILDINGS, TAKEN FROM A THIRD RENDER WITH NONE IN IT. Measured against the
      // whole frame the answer would be divided by a sky and a road the lights are not allowed to
      // touch, and it would fall as the window got bigger — a fidelity number measuring coverage,
      // which is the trap runFidelity above is written around.
      const isWall = new Uint8Array(off.length >> 2);
      let mask = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d0 = Math.abs(off[i] - empty[i]) + Math.abs(off[i + 1] - empty[i + 1]) + Math.abs(off[i + 2] - empty[i + 2]);
        if (d0 >= 12) { isWall[i >> 2] = 1; mask++; }
      }
      RENDER_TUNE.glLights = 1;
      const held = { ...LIGHT_TUNE };
      const sweep = [];
      let stats = {};
      for (const cfg of LIGHT_SWEEP) {
        Object.assign(LIGHT_TUNE, held, cfg.set);
        // ⚠ SETTLED AFTER THE SETTING IS APPLIED, NOT ONCE AT THE TOP — see settleFade. The fade is
        // a function of elapsed time AND of which lights are wanted, so a settle taken before
        // `glLights` is switched on, or before this sweep's own tuning, ramps nothing and the row
        // comes back at 0.0% exactly as if the feature were off.
        settleFade(() => paintWindshield(ID, view(built)));
        paint2(view(built));
        const on = shot();
        if (!sweep.length) stats = glLastFrame() || {};
        let moved = 0, sum = 0, worst = 0;
        for (let i = 0; i < off.length; i += 4) {
          if (!isWall[i >> 2]) continue;
          const d = (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2])) / 3;
          if (d >= 2) { moved++; sum += d; }
          if (d > worst) worst = d;
        }
        sweep.push({ seat: seat.tag, setting: cfg.tag, wallPx: mask,
          litPct: mask ? +(moved / mask * 100).toFixed(1) : null,
          meanOnLit: moved ? +(sum / moved / 255 * 100).toFixed(1) : null,
          worst: Math.round(worst),
          // ⚠ THE COLUMN THE OTHER THREE COULD NOT PROVIDE. This file's own note records that
          // `litPct` says how far a setting is from SATURATING a wall and says nothing about
          // whether the effect draws attention to itself — and every live complaint about this
          // pass has been the second thing. Peak over mean across the moved pixels is not that
          // question either, but it is the axis the complaint sits on: a light smeared evenly over
          // a whole facade lands near 1, and a pool with a hot centre and a dark edge climbs. It
          // is a ratio, so it does not move when the gain does — only the SHAPE reaches it.
          conc: moved ? +(worst / Math.max(1e-6, sum / moved)).toFixed(2) : null });
      }
      Object.assign(LIGHT_TUNE, held);
      performance.now = realNow;
      swept.push(...sweep);
      const chosen = sweep.find((r) => r.setting === 'shipping') || sweep[0];

      // ── the cost, clock real ──
      //
      // ⚠ ALTERNATED, AND THE BEST OF EACH SIDE IS TAKEN, NOT THE MEDIAN OF THE PAIR. A first cut ran
      // off, on, off, on and took the median of each side, which for two samples is the LARGER — so
      // any drift across the sequence (thermal, GC, whatever else has the GPU) landed entirely on
      // whichever side ran last. It reported the lights costing 2.4-2.6 ms on the DAY seat, where
      // the night scale means there are no lights at all and both sides run identical work. A number
      // that big out of a case that is provably free is the whole reason to distrust the other two.
      // The minimum is the least-disturbed run of each side, which is the standard way out.
      const run = (g) => {
        RENDER_TUNE.glLights = g;
        const v = view(built);
        for (let i = 0; i < warm; i++) paintWindshield(ID, v);
        const t = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, { ...v, heading: i * 0.7 }); t.push(performance.now() - t0); }
        return mid(t);
      };
      const offs = [], ons = [];
      for (let r = 0; r < 3; r++) { offs.push(run(0)); ons.push(run(1)); }
      const msOff = Math.min(...offs), msOn = Math.min(...ons);
      RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0; RENDER_TUNE.glLights = 1;

      const L = stats.lit || [];
      const rr = L.map((x) => x.r).sort((a, b) => a - b);
      rows.push({
        seat: seat.tag, buildings: built._buildings,
        sprites: stats.lights || 0, lit: L.length,
        rTiles: rr.length ? rr[0].toFixed(2) + '-' + rr[rr.length - 1].toFixed(2) : '-',
        wallPx: mask, litPct: chosen.litPct, meanOnLit: chosen.meanOnLit, worst: chosen.worst,
        msOff: +msOff.toFixed(2), msOn: +msOn.toFixed(2), fill: +(msOn - msOff).toFixed(2),
        spread: offs.map((x) => x.toFixed(1)).join('/') + ' vs ' + ons.map((x) => x.toFixed(1)).join('/'),
      });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0; RENDER_TUNE.glLights = 1;
    uninstall(); holder.remove();
  }
  console.table(swept);
  console.table(rows);
  console.log('   litPct is the share of WALL pixels the lights actually changed — a zero there is the silent failure, whatever the frame looks like.');
  console.log('   fill is msOn - msOff on two independent medians; if it is inside the run-to-run spread, measure again.');
  return { rows, swept };
}

// ── IS THE CLOUD DECK STILL THE SAME SKY? ───────────────────────────────────
//
// `__glClouds()`. The fly-through deck is a swarm of small puffs, each a stack of cards, and every
// card is a radial gradient and an ellipse fill — measured headlessly by `npm run shapes:clouds` at
// 2,757 to 9,460 canvas calls a frame. On the GPU each card is a quad, depth-tested against the
// city the world pass just wrote, so a tower can finally stand IN a cloud instead of the painter
// having to pick a side.
//
// ⚠ THE WHOLE FRAME IS COMPARED HERE, unlike __glFidelity, and that is deliberate rather than
// sloppy: the deck covers the sky and the sky is most of the frame, so masking it to "the clouds"
// would mean deciding where the clouds are, which is the thing under test. The scene is a bare
// plain with no buildings for the same reason — a city in the frame would put the mass, the trim
// and the lights into a number that is supposed to be about vapour.
//
// ⚠ AND THE CLOCK IS FROZEN. The cells drift, the birds fly. A diff across a moving sky measures
// the sky, which is the trap runFidelity is written around and this borrows.
const CLOUD_FIELD = (baseCloud, kinds) => ({
  tick: 30, bounds: { minX: 80, maxX: 120, minY: 80, maxY: 120 }, wind: { dir: 220, kph: 18 },
  baseCloud, precipFloor: 0, floorType: 'none',
  cells: kinds.map((k, i) => ({
    x: 100 + (i - 1) * 9, y: 88 + i * 8, r: 13 - i * 2, vx: 0.4 - i * 0.3, vy: 0.2 + i * 0.2,
    type: k, intensity: 0.9 - i * 0.1, precip: k === 'cloud' ? 'none' : 'rain',
  })),
});
const CLOUD_SEATS = [
  { tag: 'cumulus, from below', wx: 'clear', h: 0.6, ay: 106, hour: 11, field: CLOUD_FIELD(0.15, ['cloud', 'cloud']) },
  { tag: 'cumulus, in the deck', wx: 'clear', h: 1.6, ay: 98, hour: 11, field: CLOUD_FIELD(0.15, ['cloud', 'cloud']) },
  { tag: 'overcast, in the deck', wx: 'cloudy', h: 0.9, ay: 100, hour: 13, field: CLOUD_FIELD(0.55, ['cloud', 'precip', 'storm']) },
  { tag: 'storm, alongside', wx: 'storm', h: 1.1, ay: 112, hour: 13, field: CLOUD_FIELD(0.6, ['storm', 'precip', 'cloud']) },
  { tag: 'overcast at night', wx: 'cloudy', h: 0.9, ay: 100, hour: 2, field: CLOUD_FIELD(0.55, ['cloud', 'precip', 'storm']) },
];

export function runCloudDeck({ W = 640, H = 360, frames = 24, warm = 10 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__clouds'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  const flat = Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => ({ kind: 'land', biome: 'grass', flr: 0 })));

  // The 2-D call count, which is deterministic and is the half of this that can be compared across
  // days. Only the frame canvas is counted; the GL canvas has no 2-D context.
  const realGet = HTMLCanvasElement.prototype.getContext;
  let calls = null;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    const cx = realGet.call(this, t, o);
    if (!String(this.id).startsWith('__clouds') || t !== '2d') return cx;
    return new Proxy(cx, {
      get(a, k) { const v = a[k]; if (typeof v !== "function") return v; return (...z) => { if (calls) calls.n++; return v.apply(a, z); }; },
      set(a, k, v) { a[k] = v; return true; },
    });
  };

  const rows = [];
  const realNow = performance.now.bind(performance);
  try {
    for (const seat of CLOUD_SEATS) {
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      const view = {
        cls: 'prop', phase: 'cruise', worldBlend: 1, height: seat.h, hour: seat.hour, weather: seat.wx,
        speed: 0.4, map: flat, heading: 0, mapCenter: { x: 100, y: seat.ay },
        wxField: seat.field, acX: 100, acY: seat.ay,
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      };
      // ⚠ A SEAT OF ITS OWN, for the reason spelled out in runLights: sceneFor(id) advances smoothed
      // state by dt, which under a frozen clock is zero for ever, so a second seat inherits the first.
      const ID = '__clouds' + CLOUD_SEATS.indexOf(seat) + '_' + (runCloudDeck.n = (runCloudDeck.n || 0) + 1);
      el.id = ID;
      const paint = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };

      performance.now = () => 1e6;
      RENDER_TUNE.glClouds = 0;
      for (let i = 0; i < warm; i++) paintWindshield(ID, view);
      paint(view); const two = shot();
      calls = { n: 0 }; paintWindshield(ID, view); const calls2 = calls.n; calls = null;
      RENDER_TUNE.glClouds = 1;
      for (let i = 0; i < warm; i++) paintWindshield(ID, view);
      paint(view); const gl = shot();
      const st = glLastFrame() || {};
      calls = { n: 0 }; paintWindshield(ID, view); const callsGL = calls.n; calls = null;
      // ⚠ AND A THIRD RENDER WITH NO DECK AT ALL, which is what makes the first number mean
      // anything. "The two renderers agree to 0.15%" is also exactly what comes back when the new
      // one draws NOTHING and the old one drew very little — the same trap the light pass fell into
      // one section up, where a whole feature measured as agreeing beautifully because it was
      // invisible. `vsNone` is how much the deck is worth at all, and `meanPct` is only readable
      // beside it: 0.15 against 2.57 says the port is faithful, 0.15 against 0.15 would say it is
      // absent.
      RENDER_TUNE.volClouds = 0;
      for (let i = 0; i < warm; i++) paintWindshield(ID, view);
      paint(view); const none = shot();
      RENDER_TUNE.volClouds = 1;
      performance.now = realNow;

      let n = 0, sum = 0, over = 0, worst = 0, sumNone = 0;
      for (let i = 0; i < two.length; i += 4) {
        const d = (Math.abs(gl[i] - two[i]) + Math.abs(gl[i + 1] - two[i + 1]) + Math.abs(gl[i + 2] - two[i + 2])) / 3;
        n++; sum += d; if (d > 16) over++; if (d > worst) worst = d;
        sumNone += (Math.abs(gl[i] - none[i]) + Math.abs(gl[i + 1] - none[i + 1]) + Math.abs(gl[i + 2] - none[i + 2])) / 3;
      }

      // Alternated, minimum of each side — see the ⚠ in runLights, where a fixed order reported a
      // 2.5 ms cost on a seat that was provably free.
      const run = (g) => {
        RENDER_TUNE.glClouds = g;
        for (let i = 0; i < warm; i++) paintWindshield(ID, view);
        const t = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, { ...view, heading: i * 0.7 }); t.push(performance.now() - t0); }
        return mid(t);
      };
      const offs = [], ons = [];
      for (let r = 0; r < 3; r++) { offs.push(run(0)); ons.push(run(1)); }
      RENDER_TUNE.glClouds = 1;

      rows.push({
        seat: seat.tag, cards: st.cloudCards || 0,
        calls2d: calls2, callsGL, saved: calls2 - callsGL,
        meanPct: +(sum / n / 255 * 100).toFixed(2), vsNone: +(sumNone / n / 255 * 100).toFixed(2),
        overPct: +(over / n * 100).toFixed(1), worst: Math.round(worst),
        msOff: +Math.min(...offs).toFixed(2), msOn: +Math.min(...ons).toFixed(2),
        gain: +(Math.min(...offs) - Math.min(...ons)).toFixed(2),
      });
    }
  } finally {
    performance.now = realNow;
    HTMLCanvasElement.prototype.getContext = realGet;
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0; RENDER_TUNE.glClouds = 1; RENDER_TUNE.volClouds = 1;
    uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   cards is what the GPU actually drew — a zero there with the flag on is the silent failure.');
  console.log('   meanPct is only readable beside vsNone: a small difference from the 2-D deck means a faithful port only if the deck is worth something in the first place.');
  console.log('   saved is deterministic and is the number to compare across days; gain is not.');
  return rows;
}

// ── IS THE CITY FLICKERING? ─────────────────────────────────────────────────
//
// `__glFlicker()`. Every other bench here compares one frame against another frame of a DIFFERENT
// renderer. This one compares consecutive frames of the SAME renderer, because "the lights strobe"
// and "the buildings pulse" are complaints about the difference between frame n and frame n+1, and
// no amount of looking at a single frame can see them.
//
// Two conditions, because they catch different bugs and a run that mixes them can name neither:
//
//   STILL — the camera does not move and the clock does. Anything that changes is animated: a
//   blinking beacon, a bloom, a drifting cloud. A stable renderer still moves here, so the number
//   is only meaningful against the same scene with the feature switched off.
//
//   CREEP — the camera moves a fraction of a tile a frame and the clock is FROZEN. Nothing in the
//   world is animated, so a difference between consecutive frames is the renderer changing its
//   mind: a set that got re-chosen, a tier that flipped, a buffer that got rebuilt differently.
//   This is the one that finds a disco.
//
// ⚠ MEASURED OVER THE WALL MASK, not the whole frame — the sky, the clouds and the ground all move
// on their own and would bury a building-lighting difference in weather.
export function runFlicker({ W = 640, H = 360, frames = 30 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);

  const R = 13, N = 27;
  let k = 0;
  const city = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    const dx = x - R;
    if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
    if (Math.abs(dx) === 1) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
    if (Math.abs(dx) >= 2 && Math.abs(dx) <= 4 && ((x * 3 + y * 5) % 3) !== 0) {
      const r = named[(k++) % named.length];
      return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6), ent: dx < 0 ? 'east' : 'west', flr: 2 + ((x * 7 + y * 13) % 5) };
    }
    return { kind: 'land', biome: 'citycore', flr: 0 };
  }));
  const bare = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ kind: 'land', biome: 'citycore', flr: 0, pw: 1 })));

  const rows = [];
  const realNow = performance.now.bind(performance);
  let seat = 0;
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
    const base = (map, off) => ({
      cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour: 2, weather: 'clear',
      speed: 0.4, map, heading: 0, mapCenter: { x: 100, y: 104 },
      mapOffset: { x: 0.2 + off, y: -0.3 + off * 0.6 },
      resFloor: 1, tune: { gl: 1, perfDS: 0 },
    });

    // The mask: what the buildings cover, from a pair with and without them.
    const ID0 = '__flick' + (seat++) + '_' + (runFlicker.n = (runFlicker.n || 0) + 1);
    el.id = ID0;
    performance.now = () => 1e6;
    for (let i = 0; i < 10; i++) paintWindshield(ID0, base(bare, 0));
    paintWindshield(ID0, base(bare, 0)); const empty = shot();
    for (let i = 0; i < 10; i++) paintWindshield(ID0, base(city, 0));
    paintWindshield(ID0, base(city, 0)); const built = shot();
    performance.now = realNow;
    // ⚠ TWO MASKS, BECAUSE "the terrain is flashing" AND "the lights are strobing" are different
    // reports and one number cannot tell them apart. Wall = where the buildings changed the frame.
    // Ground = below the horizon and NOT a building. Sky is measured by neither: it has clouds and
    // birds in it and they move on purpose.
    const isWall = new Uint8Array(empty.length >> 2);
    const isGround = new Uint8Array(empty.length >> 2);
    let mask = 0, gmask = 0;
    const horizon = Math.round(H * 0.52);   // below this band the empty scene is ground, not sky
    for (let i = 0; i < empty.length; i += 4) {
      const px = (i >> 2) % W, py = (i >> 2 - 0) / W | 0;
      const d = Math.abs(built[i] - empty[i]) + Math.abs(built[i + 1] - empty[i + 1]) + Math.abs(built[i + 2] - empty[i + 2]);
      if (d >= 12) { isWall[i >> 2] = 1; mask++; }
      else if (py > horizon) { isGround[i >> 2] = 1; gmask++; }
      void px;
    }

    // One condition, one flag setting: paint `frames` frames and measure consecutive differences
    // over the mask. `creep` moves the camera and freezes the clock; `still` does the reverse.
    const measure = (label, creep, set) => {
      for (const [key, val] of Object.entries(set)) RENDER_TUNE[key] = val;
      const ID = '__flick' + (seat++) + '_' + (runFlicker.n = (runFlicker.n || 0) + 1);
      el.id = ID;
      if (creep) performance.now = () => 1e6;
      for (let i = 0; i < 12; i++) paintWindshield(ID, base(city, 0));
      let prev = null, sum = 0, worst = 0, gsum = 0, gworst = 0, n = 0;
      for (let f = 0; f < frames; f++) {
        paintWindshield(ID, base(city, creep ? f * 0.004 : 0));
        const cur = shot();
        if (prev) {
          let s2 = 0, w2 = 0, g2 = 0, gw2 = 0;
          for (let i = 0; i < cur.length; i += 4) {
            const w = isWall[i >> 2], g = isGround[i >> 2];
            if (!w && !g) continue;
            const d = (Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2])) / 3;
            if (w) { s2 += d; if (d > w2) w2 = d; } else { g2 += d; if (d > gw2) gw2 = d; }
          }
          sum += s2 / Math.max(1, mask); if (w2 > worst) worst = w2;
          gsum += g2 / Math.max(1, gmask); if (gw2 > gworst) gworst = gw2;
          n++;
        }
        prev = cur;
      }
      performance.now = realNow;
      return { case: label, wall: +(sum / Math.max(1, n)).toFixed(2), wallWorst: Math.round(worst),
        ground: +(gsum / Math.max(1, n)).toFixed(2), groundWorst: Math.round(gworst) };
    };

    const held = { glLights: RENDER_TUNE.glLights, glClouds: RENDER_TUNE.glClouds, gl: RENDER_TUNE.gl, glFloor: RENDER_TUNE.glFloor };
    rows.push(measure('creep: everything off', true, { glLights: 0, glClouds: 0, glFloor: 1, gl: 1 }));
    rows.push(measure('creep: lights ON', true, { glLights: 1, glClouds: 0, glFloor: 1, gl: 1 }));
    rows.push(measure('creep: clouds ON', true, { glLights: 0, glClouds: 1, glFloor: 1, gl: 1 }));
    rows.push(measure('creep: both ON', true, { glLights: 1, glClouds: 1, glFloor: 1, gl: 1 }));
    rows.push(measure('creep: 2-D floor', true, { glLights: 1, glClouds: 1, glFloor: 0, gl: 1 }));
    rows.push(measure('creep: GLASS 1', true, { glLights: 0, glClouds: 0, glFloor: 0, gl: 0 }));
    rows.push(measure('still: everything off', false, { glLights: 0, glClouds: 0, glFloor: 1, gl: 1 }));
    rows.push(measure('still: both ON', false, { glLights: 1, glClouds: 1, glFloor: 1, gl: 1 }));
    RENDER_TUNE.gl = held.gl; RENDER_TUNE.glLights = held.glLights; RENDER_TUNE.glClouds = held.glClouds; RENDER_TUNE.glFloor = held.glFloor;
  } finally {
    performance.now = realNow;
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0; RENDER_TUNE.glLights = 1; RENDER_TUNE.glClouds = 1;
    uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   wall/ground are the mean colour change per pixel between CONSECUTIVE frames. A creeping camera with a frozen clock should be small and smooth;');
  console.log('   a row that jumps against the one above it names the flag that is flickering.');
  return rows;
}

if (typeof window !== 'undefined') { window.__glBench = runBench; window.__glStage1 = runStage1; window.__glPhases = runPhases; window.__glFidelity = runFidelity; window.__glTerrain = runTerrain; window.__glCaps = glCapabilities; window.__glFloor = runFloor; window.__glFloorCost = runFloorCost; window.__glSign = runSign; window.__glFrame = runFrame; window.__glLights = runLights; window.__glClouds = runCloudDeck; window.__glFlicker = runFlicker; window.__glAO = runAO; window.__glBakedAO = runBakedAO; }

// ── CONTACT OCCLUSION: DOES IT MOVE ANYTHING, AND WHAT DOES IT COST ─────────
//
// `RENDER_TUNE.glAO` darkens a surface by how close it stands to the ground. The question a
// strength knob always raises is whether the value in the file is a considered one or the first
// thing somebody typed, so this sweeps it and reports what share of the BUILDING pixels each
// setting actually moves — the same mask runLights uses, and for the same reason: measured against
// the whole frame the answer is divided by a sky the effect is not allowed to touch, and it would
// fall as the window got bigger.
//
// ⚠ THE DAY SEAT IS THE CONTROL AND THE NIGHT SEAT IS NOT. Unlike the city lights, occlusion is
// NOT scaled by the night — the ground takes sky away at noon as much as at midnight — so both
// seats should move, and a night-only or day-only result means the term has been wired to
// something it should not depend on.
//
// ⚠ AND THE ZERO ROW IS THE PROOF THE SWITCH IS A SWITCH. At `glAO` 0 the shader multiplies by
// exactly 1.0, so that row must come back 0.0% moved — not 'small', zero. Anything else means the
// off state is not off, which is the property that makes the knob safe to ship at any value.
const AO_SWEEP = [0, 0.2, 0.34, 0.5, 0.7];

export function runAO({ W = 640, H = 360, frames = 24, warm = 8 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0;
    return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6), ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
  };

  const rows = [], realNow = performance.now.bind(performance);
  const heldAO = RENDER_TUNE.glAO;
  try {
    for (const seat of LIGHT_SEATS) {
      const ID = '__ao' + LIGHT_SEATS.indexOf(seat) + '_' + (runAO.n = (runAO.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      performance.now = () => 1e6;
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };

      RENDER_TUNE.glAO = 0;
      paint2(view(bare)); const empty = shot();
      paint2(view(built)); const off = shot();
      const isWall = new Uint8Array(off.length >> 2);
      let mask = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d0 = Math.abs(off[i] - empty[i]) + Math.abs(off[i + 1] - empty[i + 1]) + Math.abs(off[i + 2] - empty[i + 2]);
        if (d0 >= 12) { isWall[i >> 2] = 1; mask++; }
      }
      for (const s of AO_SWEEP) {
        RENDER_TUNE.glAO = s;
        paint2(view(built));
        const on = shot();
        let moved = 0, sum = 0, worst = 0;
        for (let i = 0; i < off.length; i += 4) {
          if (!isWall[i >> 2]) continue;
          const d = (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2])) / 3;
          if (d >= 2) { moved++; sum += d; }
          if (d > worst) worst = d;
        }
        rows.push({ seat: seat.tag, glAO: s, wallPx: mask,
          movedPct: mask ? +(moved / mask * 100).toFixed(1) : null,
          meanOnMoved: moved ? +(sum / moved / 255 * 100).toFixed(1) : null,
          worst: Math.round(worst) });
      }
      // Cost, clock live: off against the shipping value, same scene, same seat.
      performance.now = realNow;
      const t = (s) => {
        RENDER_TUNE.glAO = s;
        const v = view(built);
        for (let i = 0; i < warm; i++) paintWindshield(ID, v);
        const a = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, v); a.push(performance.now() - t0); }
        return mid(a);
      };
      const msOff = t(0), msOn = t(heldAO);
      rows.push({ seat: seat.tag, glAO: `cost 0 -> ${heldAO}`, wallPx: null,
        movedPct: null, meanOnMoved: null, worst: null,
        ms: `${msOff.toFixed(2)} -> ${msOn.toFixed(2)}` });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.glAO = heldAO;
    uninstall && uninstall(); holder.remove();
  }
  return rows;
}


// ── THE BAKED OCCLUSION: DOES IT LAND, AND ONLY WHERE IT SHOULD? ────────────
//
// `__glBakedAO()`. The sibling of `__glAO()` above and the answer to what that one measured itself
// out of: world-height occlusion has no setting that is both visible and correct, because height is
// an axis GLASS already covers twice. This term is per-VERTEX and sampled against the building's own
// solid volume, so it sees the axis that one cannot — a recessed doorway, the underside of a sill,
// the inner corner of a setback.
//
// ⚠ FIRST, DID IT REACH ANY PIXELS AT ALL, and that is not a formality — it is the failure this
// feature actually shipped with for its first hour. The attribute was in the buffer, the varying was
// declared, the uniform existed, the strength was 0.55, and the sweep reported 0.0% moved at every
// setting, because `installGL`'s option list is an ALLOWLIST and `glBakedAo` was not on it. The note
// above that list had been written for the identical bug in contact occlusion. A correctly wired
// feature doing nothing looks exactly like a feature that is switched off.
//
// ⚠ SECOND, DID IT STAY ON THE BUILDINGS. It is a term in the mass shader, so the ground must not
// move. A whole-frame number tells those apart not at all, and "everything went dark" is what a
// strength that has become an exposure control looks like.
//
// ⚠ THIRD, IS IT THE SAME BY DAY AND BY NIGHT — which is the OPPOSITE of what the wall-wash lights
// want. Those are scaled by the night, because a sign is a light source and the sun outshines it.
// Occlusion is a statement about how much SKY a surface can see, and a corner is just as enclosed at
// noon. A day-only or night-only reading means somebody has scaled it by the wrong thing.
const BAO_SEATS = [
  { tag: 'cab, day', R: 12, density: 0.3, hour: 13, cls: 'truck' },
  { tag: 'cab, night', R: 12, density: 0.3, hour: 23, cls: 'truck' },
  { tag: 'air, day', R: 30, density: 0.06, hour: 13, cls: 'prop' },
];
const BAO_SWEEP = [0.3, 0.55, 0.8];

export function runBakedAO({ W = 640, H = 360, frames = 24, warm = 8 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0;
    return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6),
          ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
  };

  const rows = [], realNow = performance.now.bind(performance);
  const held = RENDER_TUNE.glBakedAo;
  try {
    for (const seat of BAO_SEATS) {
      const ID = '__bao' + BAO_SEATS.indexOf(seat) + '_' + (runBakedAO.n = (runBakedAO.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        // ⚠ The dials are pinned for the reason every bench here pins them: a loose resolution step
        // sheds pixels exactly where the frame is expensive and gets read as the feature.
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };
      // ⚠ SETTLED, NOT MERELY FROZEN — see settleFade above. Occlusion does not depend on the light
      // set, but the frame it is measured against does: with the fade never ramping, the night seats
      // were being compared on a city with no wall wash on it at all, which is not the city.
      settleFade(() => paintWindshield(ID, view(built)));

      RENDER_TUNE.glBakedAo = 0;
      paint2(view(bare)); const empty = shot();
      paint2(view(built)); const off = shot();
      // What the buildings cover, and what they do not. The split is the whole second question.
      const isWall = new Uint8Array(off.length >> 2);
      let mask = 0, ground = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d = Math.abs(off[i] - empty[i]) + Math.abs(off[i + 1] - empty[i + 1]) + Math.abs(off[i + 2] - empty[i + 2]);
        if (d > 18) { isWall[i >> 2] = 1; mask++; } else ground++;
      }
      for (const s of BAO_SWEEP) {
        RENDER_TUNE.glBakedAo = s;
        paint2(view(built)); const on = shot();
        let moved = 0, sum = 0, worst = 0, outside = 0;
        for (let i = 0; i < on.length; i += 4) {
          const d = (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2])) / 3;
          if (!isWall[i >> 2]) { if (d >= 2) outside++; continue; }
          if (d >= 2) { moved++; sum += d; }
          if (d > worst) worst = d;
        }
        rows.push({ seat: seat.tag, glBakedAo: s, wallPx: mask,
          movedPct: mask ? +(moved / mask * 100).toFixed(1) : null,
          meanOnMoved: moved ? +(sum / moved / 255 * 100).toFixed(1) : null,
          worst: Math.round(worst),
          offBuildingPct: ground ? +(outside / ground * 100).toFixed(2) : null });
      }
      // Cost, clock live. The bake itself is inside the tileMesh memo, so a warmed scene is the
      // honest steady-state reading and the first-sight cost is glao.mjs's number, not this one.
      performance.now = realNow;
      const t = (s) => {
        RENDER_TUNE.glBakedAo = s;
        const v = view(built);
        for (let i = 0; i < warm; i++) paintWindshield(ID, v);
        const a = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, v); a.push(performance.now() - t0); }
        return mid(a);
      };
      const msOff = t(0), msOn = t(held);
      rows.push({ seat: seat.tag, glBakedAo: `cost 0 -> ${held}`, wallPx: null,
        movedPct: null, meanOnMoved: null, worst: null, offBuildingPct: null,
        ms: `${msOff.toFixed(2)} -> ${msOn.toFixed(2)}` });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.glBakedAo = held;
    uninstall && uninstall(); holder.remove();
  }
  return rows;
}

// ── THE SUN'S OWN SHADOWS: DO THEY LAND, AND ON WHAT? ───────────────────────
//
// `__glShadow()`. GLASS has had exactly one building shadow since it was written: a footprint hull
// on the ground. The depth pass adds the half a painter's queue could never do — a building shading
// its neighbour's wall, a setback shading the storey below it. Three questions, and they are three
// different runs because they fail in three different ways.
//
// ⚠ FIRST, DID IT REACH ANY PIXELS. The failure mode is silence, as it is for the signage and the
// lights: a framebuffer the driver would not complete, a matrix that came out NaN at noon, a
// comparison running the wrong way — every one of those draws a correct, unshadowed city and looks
// like a day with nothing casting. So the first half is a pixel diff of one frame with the strength
// at 0 and at its shipping value, over the mask of what the buildings cover.
//
// ⚠ SECOND, DID IT REACH PIXELS IT HAS NO BUSINESS REACHING. The ground hulls are untouched by this
// change and must stay untouched, so the frame is split the way __glTerrain splits it — inside the
// building mask and outside it — and the OUTSIDE number is the one that has to be near zero. A
// whole-frame figure tells those two apart not at all, and "the ground went dark" is exactly the
// report a mis-projected shadow map produces.
//
// ⚠ THIRD, IS IT FREE AT NIGHT. The pass is skipped outright once the sun is down, so a night seat
// must come back at 0.0% moved — not small, zero. That is also the cheapest possible check that the
// strength uniform is written on every frame rather than only on the frames that set it: a uniform
// holds its last value, and a city wearing this afternoon's shadows at midnight is what forgetting
// that looks like.
const SHADOW_SEATS = [
  { tag: 'cab, low morning sun', R: 14, density: 0.18, hour: 8, cls: 'truck' },
  { tag: 'cab, high noon sun', R: 14, density: 0.18, hour: 12.5, cls: 'truck' },
  { tag: 'air, afternoon', R: 36, density: 0.05, hour: 15.5, cls: 'prop' },
  { tag: 'cab, night (control)', R: 14, density: 0.18, hour: 2, cls: 'truck' },
];

const SHADOW_SWEEP = [0.35, 0.7, 1];

export function runShadow({ W = 640, H = 360, frames = 30, warm = 10 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };

  // The same generated city runLights uses — a road, a couple of clear tiles either side of it, and
  // real named models at 'density' beyond that, so what casts a shadow here is the buildings the
  // game actually has rather than boxes invented for the harness.
  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0, n = 0;
    const m = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        n++;
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6), ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
    m._buildings = n;
    return m;
  };

  const rows = [], swept = [];
  const realNow = performance.now.bind(performance);
  const heldStr = RENDER_TUNE.glShadow;
  try {
    for (const seat of SHADOW_SEATS) {
      // A scene id of its own per seat — see the warning in runLights: a frozen clock cannot advance
      // the smoothed per-view state, so a second seat on one id inherits the first seat's camera and
      // its two frames come back identical, which reads as the feature doing nothing.
      const ID = '__shadow' + SHADOW_SEATS.indexOf(seat) + '_' + (runShadow.n = (runShadow.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;

      performance.now = () => 1e6;
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };
      RENDER_TUNE.glShadow = 0;
      paint2(view(bare)); const empty = shot();
      paint2(view(built)); const off = shot();
      const statsOff = glLastFrame() || {};
      // The building mask, from the pair with and without buildings. Everything outside it is
      // ground, sky and road — the half that must not move.
      const isWall = new Uint8Array(off.length >> 2);
      let mask = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d0 = Math.abs(off[i] - empty[i]) + Math.abs(off[i + 1] - empty[i + 1]) + Math.abs(off[i + 2] - empty[i + 2]);
        if (d0 >= 12) { isWall[i >> 2] = 1; mask++; }
      }
      let chosen = null, size = 0;
      for (const str of SHADOW_SWEEP) {
        RENDER_TUNE.glShadow = str;
        paint2(view(built));
        const on = shot();
        const st = glLastFrame() || {};
        if (str === 0.7) size = st.shadowSize || 0;
        let moved = 0, sum = 0, worst = 0, gMoved = 0, gTot = 0;
        for (let i = 0; i < off.length; i += 4) {
          const d = (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2])) / 3;
          if (isWall[i >> 2]) {
            if (d >= 2) { moved++; sum += d; }
            if (d > worst) worst = d;
          } else { gTot++; if (d >= 2) gMoved++; }
        }
        const row = { seat: seat.tag, str, wallPx: mask,
          shadedPct: mask ? +(moved / mask * 100).toFixed(1) : null,
          meanOnShaded: moved ? +(sum / moved / 255 * 100).toFixed(1) : null,
          worst: Math.round(worst),
          groundPct: gTot ? +(gMoved / gTot * 100).toFixed(2) : null };
        swept.push(row);
        if (str === 0.7) chosen = row;
      }
      performance.now = realNow;

      // The cost, on a real clock. Alternated with the minimum of each side taken, for the reason
      // written out in runLights: a median of two samples is the larger of them, so any drift across
      // the sequence lands on whichever side ran last and invents a cost for a provably free case.
      const run = (s) => {
        RENDER_TUNE.glShadow = s;
        const v = view(built);
        for (let i = 0; i < warm; i++) paintWindshield(ID, v);
        const t = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, { ...v, heading: i * 0.7 }); t.push(performance.now() - t0); }
        return mid(t);
      };
      const offs = [], ons = [];
      for (let r = 0; r < 3; r++) { offs.push(run(0)); ons.push(run(0.7)); }
      const msOff = Math.min(...offs), msOn = Math.min(...ons);
      RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;

      rows.push({
        seat: seat.tag, buildings: built._buildings, faces: statsOff.faces || 0,
        map: size ? size + 'sq' : '-',
        wallPx: mask, shadedPct: chosen && chosen.shadedPct, meanOnShaded: chosen && chosen.meanOnShaded,
        worst: chosen && chosen.worst, groundPct: chosen && chosen.groundPct,
        msOff: +msOff.toFixed(2), msOn: +msOn.toFixed(2), cost: +(msOn - msOff).toFixed(2),
        spread: offs.map((x) => x.toFixed(1)).join('/') + ' vs ' + ons.map((x) => x.toFixed(1)).join('/'),
      });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.glShadow = heldStr;
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;
    uninstall(); holder.remove();
  }
  console.table(swept);
  console.table(rows);
  console.log('   shadedPct is the share of BUILDING pixels the sun pass changed. A zero on a daylight seat is the silent failure —');
  console.log('   a driver that refused the depth framebuffer, a NaN matrix, or a comparison running the wrong way all look like this.');
  console.log('   groundPct must stay near zero: the ground hulls are not touched by this change, and a mis-projected map darkens them.');
  console.log('   The night row is the control. It must read 0 on every column — the pass is skipped, so nothing may move.');
  console.log('   map is the shadow texture actually allocated; a dash means the driver refused it and the frame fell back.');
  return { rows, swept };
}

if (typeof window !== 'undefined') window.__glShadow = runShadow;

// ── DOES ANYTHING SHOW THROUGH A WALL? ──────────────────────────────────────
//
// `__glLeak()` — the question the depth-buffer port exists to answer, as a number that can be
// re-run rather than a screenshot somebody looked at.
//
// ⚠ THE WALL HAS TO BE LOWER THAN THE SUBJECT, AND THE FIRST DRAFT GOT THAT EXACTLY BACKWARDS.
// Stood behind a row of thirty-storey towers, every model in the city reports zero — and that is a
// true answer to the wrong question. `decoHidden` is ALL-OR-NOTHING: it hides an adornment when the
// WHOLE of it is covered, which is precisely the case a wall of towers makes, and it gets that case
// right. What it cannot do is the partial one: a blade standing proud of a roofline, a mast whose
// tip is in clear air, a helideck ring whose far edge clears a shed. The anchor clears, the probe
// answers "draw", and the half that is genuinely behind the building draws with it. Every leak
// anybody has ever reported here is that case, so the wall is a NINE-STOREY WAREHOUSE and the
// subject is taller than it. The comments in windshield.js that quote leak figures all say
// "behind a nine-storey warehouse" for this reason.
//
// The measurement is then exact and needs no threshold:
//
//   mask   = the pixels the WALL covers          (wall-only frame vs bare ground)
//   leak   = pixels INSIDE that mask that change when the subject is added behind it
//   crown  = pixels OUTSIDE it that change       (the subject peeking over — legitimate, the control)
//
// A leak pixel is the subject reaching the screen through a building that is in front of it. Zero
// is the whole of the answer.
//
// ⚠ AND THE CROWN IS HALF THE MEASUREMENT. "0 leaked" is also what a subject that drew nothing at
// all reports — a model that failed to resolve, a night whose lights never came on, a camera
// pointing the wrong way. A row with a big crown and no leak is a pass; a row with neither measured
// nothing and proves nothing, which is why they are counted separately and reported.
//
// ⚠ AND THE CLOCK IS FROZEN, for the reason every bench here freezes it: two renders of the same
// EMPTY scene differ by tens of thousands of pixels, because the clouds drift, the birds fly and
// the water moves. On a live clock the sky reports as a leak.
//
//   __glLeak()                                            // every model, at night
//   __glLeak({ keys: ['named:solenneresidences'] })
//   __glLeak({ hours: [2, 13] })
// ⚠ AND IT CANNOT SEE THE DERIVED DETAIL KIT AT ALL, WHICH IS MOST OF WHAT A BUILDING WEARS. The
// 2-D painter runs `detailLayer` only within `RENDER_TUNE.detailNear` — THREE tiles — and the
// subject here stands at eight, so not one board, blade, canopy, pipe, lamp or neon run in the city
// is ever emitted into a frame this sweep measures. That is the same blindness `glresidue` was
// carrying one layer up, and it is why a blade painting straight down the front of its own bar
// survived a green 173-model run of this.
//
// ⚠ AND IT IS NOT A PARAMETER, WHICH WAS TRIED. Moving the subject inside three tiles was measured
// and it is degenerate at every value the geometry can express: the wall is THREE rows deep, so a
// subject close enough for the kit lands IN the wall rather than behind it, and pulled back one row
// the wall no longer covers it (98 of 173 subjects then draw almost nothing over it and prove
// nothing). Restoring the bug and re-running finds zero. Seeing this class needs a different
// arrangement — ONE low occluder between the camera and a subject two tiles out — rather than a
// knob on this one, and until somebody builds that, the picture is the instrument: put the sign on
// the far face (`ent` reversed) and look.
export function runLeak({ keys = null, hours = [2], W = 640, H = 360, top = 16, wallFlr = 9, subjFlr = 16 } = {}) {
  const realNow = performance.now.bind(performance);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);

  const LR = 16, LN = 33;
  // ⚠ THREE ROWS DEEP, AND THAT IS NOT BELT AND BRACES. A building is 0.88 of its tile, so a wall of
  // them has a 0.12-tile SLOT between every pair — nine screen pixels at three tiles. Rays diverge,
  // so a ray through the slot at x = ±0.5 in the first row lands at ±0.67 in the second, which is
  // solid wall. One row leaks legitimately and would bury the finding in noise; three seal it.
  const WALL_Y = [LR - 3, LR - 4, LR - 5];
  const SUBJ_Y = LR - 8;
  const all = shapeModelRegistry().filter((r) => r.key.startsWith('named:') || r.key.startsWith('type:'));
  const subjects = keys ? all.filter((r) => keys.includes(r.key)) : all;

  const cell = (r) => (r.key.startsWith('named:')
    ? { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6), ent: 'south', flr: subjFlr }
    : { kind: 'land', biome: 'citycore', bt: r.key.slice(5), ent: 'south', flr: subjFlr });

  const build = (subj, withWall) => Array.from({ length: LN }, (_, y) => Array.from({ length: LN }, (_, x) => {
    if (withWall && WALL_Y.includes(y)) return { kind: 'land', biome: 'citycore', bt: 'warehouse', ent: 'south', flr: wallFlr };
    if (subj && y === SUBJ_Y && x === LR) return subj;
    return { kind: 'land', biome: 'citycore', flr: 0 };
  }));

  const rows = [];
  let restoreRandom = () => {};
  try {
    RENDER_TUNE.gl = 1;
    const id = '__leak' + (runLeak.n = (runLeak.n || 0) + 1);
    el.id = id;
    const view = (map, hour) => ({
      cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.24, hour,
      weather: 'clear', speed: 0, map, heading: 0, mapCenter: { x: 100, y: 100 },
      mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 },
    });
    // ⚠ SETTLED, NOT MERELY FROZEN — see settleFade. `fadeLights` ramps a light in and out over
    // ELAPSED time, so under a clock that never advances no light ever reaches its slot: the frame
    // caught mid-ramp differs from the next one for reasons that have nothing to do with the map,
    // and the same model measured 24, then 14, then 37 leaked pixels on three consecutive runs. The
    // clock is walked forward until the ramp is done and frozen there, so A and B differ only by the
    // thing under test. And the map changes between every pair here, which is exactly what the ramp
    // responds to — so it is settled for EVERY frame, not once at the top.
    // ⚠ AND Math.random IS PINNED, WHICH IS NOT THE SAME THING AS FREEZING THE CLOCK. GLASS throws a
    // METEOR across a clear night sky on a random timer, and lightning on a random one in a storm —
    // and settling the fade means walking the clock forward, which is exactly what advances them. So
    // two renders of the same map differ by a streak of sky, and the same model measured 25 and then
    // 63 leaked pixels on consecutive runs of an otherwise identical test. A seeded generator, reset
    // before every frame, makes the sky the same sky in all four.
    let rngS = 0;
    const realRandom = Math.random;
    Math.random = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };
    restoreRandom = () => { Math.random = realRandom; };
    const paint = (map, hour) => { rngS = 12345; settleFade(() => { rngS = 12345; paintWindshield(id, view(map, hour)); }); return shot(); };
    for (const hour of hours) {
      const bare = paint(build(null, false), hour);
      const wallOnly = paint(build(null, true), hour);
      // ⚠ AND THE HARNESS MEASURES ITS OWN NOISE FLOOR, because it HAS one and it is not zero. The
      // same map rendered twice under the same settled clock and the same pinned generator still
      // differs by a few pixels along the wall own roofline — a handful at night, a few dozen by
      // day. Nobody has run that down, and until somebody does, a leak inside it is not a finding.
      // Reported beside every row rather than subtracted, so the reader can see which it is.
      const wallAgain = paint(build(null, true), hour);
      // The mask, built ONCE per hour: it is a property of the wall, and the wall never changes.
      const mask = new Uint8Array(bare.length >> 2);
      let maskN = 0;
      for (let i = 0, k = 0; i < bare.length; i += 4, k++) {
        if (Math.abs(wallOnly[i] - bare[i]) + Math.abs(wallOnly[i + 1] - bare[i + 1]) + Math.abs(wallOnly[i + 2] - bare[i + 2]) >= 12) { mask[k] = 1; maskN++; }
      }
      let noise = 0;
      for (let i = 0, k = 0; i < wallOnly.length; i += 4, k++) {
        if (!mask[k]) continue;
        if (Math.abs(wallAgain[i] - wallOnly[i]) + Math.abs(wallAgain[i + 1] - wallOnly[i + 1]) + Math.abs(wallAgain[i + 2] - wallOnly[i + 2]) >= 12) noise++;
      }
      for (const r of subjects) {
        const map = build(cell(r), true);
        const withSubj = paint(map, hour);
        // ⚠ AND THE FLOOR IS MEASURED WITH THE SUBJECT IN THE SCENE, NOT WITHOUT IT. The wall-only
        // pair above is a floor for the WALL, and nothing the subject makes vary is in it — a blink
        // light's phase, a stack's smoke, a wind wheel's step, and whatever the decal and billboard
        // caches were holding when this row came up. Measured the old way the floor reads 0 while
        // the same sweep re-run on a fresh page moves between 0 and 300 px, which is a reading that
        // invites the one mistake this column exists to stop: quoting it. One extra render per row,
        // and the floor is the row's own.
        // ⚠ THE FLOOR ITSELF STILL MOVES — two fresh-page runs of the same sweep measured it at 65
        // and 79 px, and the four rows the first called leaks (44-47) were gone in the second. So a
        // row just over its floor is a QUESTION, and the answer is a screenshot. Nobody has run down
        // what is unpinned; it is not the clock and it is not Math.random, both of which are.
        const again = paint(map, hour);
        let leak = 0, crown = 0, own = 0;
        for (let i = 0, k = 0; i < wallOnly.length; i += 4, k++) {
          if (mask[k] && Math.abs(again[i] - withSubj[i]) + Math.abs(again[i + 1] - withSubj[i + 1]) + Math.abs(again[i + 2] - withSubj[i + 2]) >= 12) own++;
          const d = Math.abs(withSubj[i] - wallOnly[i]) + Math.abs(withSubj[i + 1] - wallOnly[i + 1]) + Math.abs(withSubj[i + 2] - wallOnly[i + 2]);
          if (d < 12) continue;
          if (mask[k]) leak++; else crown++;
        }
        rows.push({ model: r.key, hour, leakPx: leak, noisePx: Math.max(noise, own), crownPx: crown, wallPx: maskN });
      }
    }
  } finally { RENDER_TUNE.gl = 0; performance.now = realNow; restoreRandom(); uninstall(); holder.remove(); }

  // Above the floor, not merely above zero — see the ⚠ on the noise floor.
  const bad = rows.filter((x) => x.leakPx > x.noisePx * 2 + 8).sort((a, b) => b.leakPx - a.leakPx);
  const blind = rows.filter((x) => x.crownPx < 40);
  console.table(bad.slice(0, top));
  console.log(`   ${rows.length} case(s) · ${bad.length} leaking above the noise floor (${Math.max(0, ...rows.map((x) => x.noisePx))} px) · worst ${bad.length ? bad[0].leakPx : 0} px` +
    (blind.length ? ` · ⚠ ${blind.length} drew almost nothing over the wall and prove nothing` : ''));
  return { rows, bad, blind, leaks: bad.reduce((a, b) => a + b.leakPx, 0) };
}
if (typeof window !== 'undefined') window.__glLeak = runLeak;

// ── DOES THE NEON TONE ACTUALLY CHANGE THE NIGHT CITY, AND LEAVE THE DAY ALONE? ────────────────
//
// `RENDER_TUNE.neon` widens one ratio: how dark an unlit wall is against how bright the lit things
// on it are. It reaches the baked wall textures (the night dim, the lit-pane fraction, the lit-pane
// colour, and the accent each palette burns), so the honest test is a whole street rather than one
// surface — the effect is supposed to be a property of the skyline, not of a swatch.
//
// Two columns, and the SECOND one is what makes the first mean anything:
//   night  — how much of the frame moves between neon 0 and neon 1 at 23:00. Should be large.
//   noon   — the same pair at 13:00. Should be ZERO. The tone is a night grade; if this is not
//            flat, something has reached the day texture and the change is bigger than intended.
//
// ⚠ THE TEXTURE CACHE IS KEYED ON THE TONE, WHICH IS THE ONLY REASON AN A/B IS POSSIBLE AT ALL.
// `wallTex` memoises one canvas per palette for the life of the page; before the tone went into
// that key (and into `texEpoch`, which is what the GL atlas copies on), flipping the knob between
// two renders would have measured the same cached pixels twice and reported a confident 0.0%.
//
// ⚠ SETTLED, NOT MERELY FROZEN, and Math.random PINNED — see settleFade and the ⚠ in runLeak. The
// same two traps: a light that never ramps reads as a feature switched off, and a meteor across a
// clear night sky reads as a finding.
export function runNeon({ W = 640, H = 360, hours = [23, 13] } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__neon' + (runNeon.n = (runNeon.n || 0) + 1);
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const realNow = performance.now, realRandom = Math.random;
  const was = RENDER_TUNE.neon, wasGl = RENDER_TUNE.gl;
  const map = scene(true);
  const rows = [];
  let rngS = 0;
  try {
    RENDER_TUNE.gl = 1;
    Math.random = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };
    // ⚠ Eye height 0 and the truck class: this is tuned for the cab, which is the seat the tone was
    // authored against and the one the reference boards are all shot from.
    const view = (hour) => ({
      cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.24, hour,
      weather: 'clear', speed: 0, map, heading: 0, mapCenter: { x: 100, y: 100 },
      mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 },
    });
    const paint = (neon, hour) => {
      RENDER_TUNE.neon = neon;
      rngS = 12345;
      settleFade(() => { rngS = 12345; paintWindshield(el.id, view(hour)); });
      return shot();
    };
    for (const hour of hours) {
      const a = paint(0, hour), b = paint(1, hour);
      // The noise floor this harness has of its own: the same setting rendered twice. Reported
      // rather than subtracted, for the reason runLeak gives — a reader can see which it is.
      const a2 = paint(0, hour);
      let moved = 0, sum = 0, noise = 0, dark = 0, lit = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d >= 12) moved++;
        sum += d / 3;
        if (Math.abs(a[i] - a2[i]) + Math.abs(a[i + 1] - a2[i + 1]) + Math.abs(a[i + 2] - a2[i + 2]) >= 12) noise++;
        const lA = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
        const lB = b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114;
        if (lB < lA - 6) dark++; else if (lB > lA + 6) lit++;
      }
      const px = a.length / 4;
      rows.push({
        hour: hour + ':00',
        'moved': (100 * moved / px).toFixed(2) + '%',
        'mean Δ': (sum / px).toFixed(2),
        'darker': (100 * dark / px).toFixed(2) + '%',
        'brighter': (100 * lit / px).toFixed(2) + '%',
        'noise floor': (100 * noise / px).toFixed(2) + '%',
      });
    }
  } finally {
    RENDER_TUNE.neon = was; RENDER_TUNE.gl = wasGl;
    performance.now = realNow; Math.random = realRandom;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   neon 0 → 1. The night row is the feature; the noon row is the control and wants to be ~0.');
  return rows;
}
if (typeof window !== 'undefined') window.__glNeon = runNeon;

// ── DOES A RESIZE THROW THE RENDERER AWAY? ─────────────────────────────────────────────────────
//
// `sceneGL` used to drop `g.view` whenever the canvas changed size, which rebuilt every program,
// buffer, texture and layer in the view — and nothing in gl/ deletes the old ones, because there is
// no dispose path in the module at all. The canvas is resized by the ADAPTIVE RESOLUTION DIAL,
// which steps whenever smoothed frame time crosses a tenth, so turning toward a heavy view churned
// views and leaked their GPU objects until the browser force-lost the context. The frame after that
// reports `drew nothing — no context, a lost context, or a zero-sized host`, sets RENDER_TUNE.gl
// to 0, and the session finishes on the CPU renderer.
//
// ⚠ NOTHING ELSE CAN SEE THIS. It is not a picture — every frame is correct right up until the
// context dies — and it is not headless, because there is no GL context in node. It is a COUNTER,
// and `glLastFrame().builds` is the only place it shows.
//
// ⚠ AND THE STEADY-SIZE ROW IS HALF THE TEST. A run that reported 0 rebuilds across resizes would
// also report 0 if the pass had stopped drawing, so the control is that a MOVING WINDOW still
// rebuilds: the buffer is keyed on the tile set, and that genuinely changes when the world scrolls.
export function runResize({ W = 600, H = 300, n = 40 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__resize' + (runResize.n = (runResize.n || 0) + 1);
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor };
  const realNow = performance.now;
  const rows = [];
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
    const map = scene(true);
    let t = 1e6;
    const paint = (w, h, centre) => {
      el.width = w; el.height = h; el.style.width = w + 'px'; el.style.height = h + 'px';
      t += 33; performance.now = () => t;
      paintWindshield(el.id, { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.2,
        hour: 22, weather: 'clear', speed: 0, map, heading: 0, mapCenter: centre || { x: 100, y: 100 },
        mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 } });
      return glLastFrame();
    };
    for (let i = 0; i < 12; i++) paint(W, H);
    const at = () => (glLastFrame() || {}).builds || 0;
    let b = at(); for (let i = 0; i < n; i++) paint(W, H); rows.push({ case: 'steady size', frames: n, rebuilds: at() - b });
    b = at(); for (let i = 0; i < n; i++) paint(i % 2 ? W : W - 4, i % 2 ? H : H - 2); rows.push({ case: 'alternating resize', frames: n, rebuilds: at() - b });
    b = at(); for (let i = 0; i < n; i++) paint(W - 40 + (i % 8) * 10, H - 20 + (i % 8) * 5); rows.push({ case: 'size ramp', frames: n, rebuilds: at() - b });
    // The control: a moving window MUST still rebuild, or "0 rebuilds" means the pass died.
    b = at(); for (let i = 0; i < 8; i++) paint(W, H, { x: 100 + i * 3, y: 100 + i * 3 });
    rows.push({ case: 'CONTROL: window moves', frames: 8, rebuilds: at() - b });
    const f = glLastFrame();
    rows.push({ case: 'alive at the end', frames: '-', rebuilds: f ? 'yes, ' + f.faces + ' faces' : 'NO — the pass died' });
  } finally {
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor;
    performance.now = realNow; uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   a resize must NOT rebuild the vertex buffer; a moving window MUST. Both rows matter.');
  return rows;
}
if (typeof window !== 'undefined') window.__glResize = runResize;

// ── `__glWet()` ────────────────────────────────────────────────────────────────────────────────
//
// The wet road, and specifically whether it reads as PUDDLES or as a tint. Phase 6's four
// confounded measurement attempts are all recorded in the plan and they share one cause: there was
// no way to switch the wetness on. It is integrated from live precipitation the SERVER sends, so a
// Modelshop scene sits at 0 for ever and every A/B of it compares two dry roads — a correctly wired
// feature and a harness with no switch look the same from here. `RENDER_TUNE.wetForce` is that
// switch and exists for this function.
//
// Four columns, and the last one is the one the feature is actually about:
//   moved   — share of the frame that differs from a dry road. The road is roughly a third of this
//             frame, so this saturates well below 100%.
//   darker  — wet tarmac scatters less light back. Should dominate 'brighter' by day.
//   neon    — the reflections, isolated by SATURATION rather than by brightness. A first cut
//             counted pixels that got brighter and reported 0.00% at every setting, because the
//             wetness darkens the whole road and a streak on a darkened road is still darker than
//             dry tarmac: the reflection was there and the metric could not see it. Wet tarmac
//             darkens near-neutrally and a neon streak is coloured, so the colour is the signal.
//             ⚠ AND IT READS 0 AT NIGHT, WHICH IS NOT THE REFLECTIONS BEING ABSENT. Zeroing the
//             light list moves 73.4% of the drawn ground at 23:00, so they are there and large;
//             saturation just does not RISE, because the same lights already colour that tarmac
//             through the wall bounce and the ambient. The column is a day instrument and the
//             honest night measure is the gain A/B. Left in rather than deleted: a metric with a
//             known blind spot beats one whose blind spot nobody has found yet.
//   puddles — connected components of the DEEP-water mask, which is not the same as the darkened
//             mask: the whole road is damp when it rains, so 'darker than dry' is the road and
//             reports one component the size of it. The deep mask takes the pixels darkened more
//             than 55% of the 90th percentile, which is the standing water. ONE enormous component
//             is a sheet and is the failure this term was rewritten to fix.
//
// ⚠ THE wetForce 0 ROW IS THE CONTROL AND MUST BE ~0. It is the same code path with the water level
// above every hollow, so anything it moves is the harness's own noise, not the term.
//
// ⚠ AND IT READS THE GL CANVAS, NOT THE COMPOSITED FRAME, WHICH IS THE WHOLE REASON IT WORKS. A
// low eye puts every mirror image close to the viewer — angle of incidence equals angle of
// reflection, so a sign three storeys up images about a tile from the truck — and the near road in
// a cab is behind the DASH, which the 2-D pass paints on afterwards. Read from the finished frame
// this bench reported 0.00% coloured pixels at every wetness and every hour while the term was
// covering three quarters of the drawn ground: measured against the GL canvas, zeroing the light
// list moves 73.4% of it at 23:00 and 57.8% at 13:00, most of it in the near half of the frame.
// The dash is not a bug and the picture is right; it is the INSTRUMENT that was pointed at the
// wrong surface, and that cost four rounds of chasing a shader that was already correct.
//
// ⚠ SETTLED, NOT MERELY FROZEN, and Math.random PINNED — the neon streaks are drawn from the light
// list, which ramps over ELAPSED time, so an unsettled clock measures a road with nothing to
// reflect. Same trap as runLeak and runNeon.
export function runWet({ W = 640, H = 360, hours = [23, 13], levels = [0, 0.35, 1] } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__wet' + (runWet.n = (runWet.n || 0) + 1);
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  // The world pass's own buffer, copied off before the 2-D overlay goes on top of it.
  const scratch = document.createElement('canvas');
  const shot = () => {
    const g = glLastFrame() && glLastFrame().canvas;
    if (!g) throw new Error('__glWet: the GL pass drew nothing — RENDER_TUNE.gl is ' + RENDER_TUNE.gl);
    scratch.width = g.width; scratch.height = g.height;
    const c = scratch.getContext('2d'); c.drawImage(g, 0, 0);
    return new Uint8ClampedArray(c.getImageData(0, 0, g.width, g.height).data);
  };
  const realNow = performance.now, realRandom = Math.random;
  const wasForce = RENDER_TUNE.wetForce, wasWet = RENDER_TUNE.glWet, wasGl = RENDER_TUNE.gl;
  const map = scene(true);
  const rows = [];
  let rngS = 0;
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glWet = 1;
    Math.random = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };
    // Eye height 0 and the truck class: a reflection is a grazing-angle effect and the Fresnel gate
    // in ground.js all but deletes it from a cockpit. This is the seat it is for.
    const view = (hour) => ({
      cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.24, hour,
      weather: 'clear', speed: 0, map, heading: 0, mapCenter: { x: 100, y: 100 },
      mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 },
    });
    const paint = (wet, hour) => {
      RENDER_TUNE.wetForce = wet;
      rngS = 12345;
      settleFade(() => { rngS = 12345; paintWindshield(el.id, view(hour)); });
      return shot();
    };
    // ⚠ SIZED FROM THE SHOT, NOT FROM W/H. The GL buffer is in DEVICE pixels and the canvas is in
    // CSS ones; they agree at dpr 1, which is every machine this has been run on and not a promise.
    let GW = 0, GH = 0;
    // 4-connected components over a boolean mask, so 'is this a sheet or a scatter of puddles' is
    // a number rather than a look at a screenshot.
    const components = (mask) => {
      const seen = new Uint8Array(GW * GH), sizes = [], stack = [];
      for (let i = 0; i < GW * GH; i++) {
        if (!mask[i] || seen[i]) continue;
        let n = 0; stack.length = 0; stack.push(i); seen[i] = 1;
        while (stack.length) {
          const q = stack.pop(); n++;
          const qx = q % GW, qy = (q / GW) | 0;
          if (qx > 0 && mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
          if (qx < GW - 1 && mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
          if (qy > 0 && mask[q - GW] && !seen[q - GW]) { seen[q - GW] = 1; stack.push(q - GW); }
          if (qy < GH - 1 && mask[q + GW] && !seen[q + GW]) { seen[q + GW] = 1; stack.push(q + GW); }
        }
        if (n >= 4) sizes.push(n);   // a 3-pixel speck is aliasing, not a puddle
      }
      sizes.sort((a, b) => a - b);
      return { n: sizes.length, med: sizes.length ? sizes[sizes.length >> 1] : 0, max: sizes.length ? sizes[sizes.length - 1] : 0 };
    };
    const sat = (a, i) => Math.max(a[i], a[i + 1], a[i + 2]) - Math.min(a[i], a[i + 1], a[i + 2]);
    for (const hour of hours) {
      const dry = paint(0, hour);
      GW = scratch.width; GH = scratch.height;
      const dry2 = paint(0, hour);
      let noise = 0, opaque = 0;
      for (let i = 0; i < dry.length; i += 4) {
        if (dry[i + 3] < 200) continue;
        opaque++;
        if (Math.abs(dry[i] - dry2[i]) + Math.abs(dry[i + 1] - dry2[i + 1]) + Math.abs(dry[i + 2] - dry2[i + 2]) >= 12) noise++;
      }
      for (const lv of levels) {
        const b = paint(lv, hour);
        const drop = new Float32Array(GW * GH);
        let moved = 0, darker = 0, neon = 0, sum = 0;
        for (let i = 0, q = 0; i < dry.length; i += 4, q++) {
          if (dry[i + 3] < 200) continue;
          const d = Math.abs(dry[i] - b[i]) + Math.abs(dry[i + 1] - b[i + 1]) + Math.abs(dry[i + 2] - b[i + 2]);
          if (d >= 12) moved++;
          sum += d / 3;
          const lA = dry[i] * 0.299 + dry[i + 1] * 0.587 + dry[i + 2] * 0.114;
          const lB = b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114;
          if (lB < lA - 6) darker++;
          drop[q] = Math.max(0, lA - lB);
          if (sat(b, i) - sat(dry, i) >= 8) neon++;
        }
        // The deep end of the darkening, which is the standing water. A fixed threshold would be a
        // guess about how dark a road is; the distribution's own 90th percentile is not.
        const sorted = Float32Array.from(drop).sort();
        const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
        const deep = new Uint8Array(GW * GH);
        if (p90 > 1) for (let i = 0; i < deep.length; i++) deep[i] = drop[i] > p90 * 0.55 ? 1 : 0;
        const cc = components(deep);
        rows.push({
          hour: hour + ':00',
          wet: lv.toFixed(2),
          moved: (100 * moved / opaque).toFixed(2) + '%',
          'mean Δ': (sum / opaque).toFixed(2),
          darker: (100 * darker / opaque).toFixed(2) + '%',
          neon: (100 * neon / opaque).toFixed(2) + '%',
          puddles: cc.n,
          'median px': cc.med,
          'largest px': cc.max,
          'noise floor': (100 * noise / opaque).toFixed(2) + '%',
        });
      }
    }
  } finally {
    RENDER_TUNE.wetForce = wasForce; RENDER_TUNE.glWet = wasWet; RENDER_TUNE.gl = wasGl;
    performance.now = realNow; Math.random = realRandom;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   wet 0.00 is the control and wants to be flat. `puddles` is the feature: one huge');
  console.log('   component is a sheet of water, a few dozen is a street with puddles in it.');
  return rows;
}
if (typeof window !== 'undefined') window.__glWet = runWet;

// ── `__glMirror()` ─────────────────────────────────────────────────────────────────────────────
//
// Is there a CITY in the puddles, or only a smear?
//
// The wet road has reflected the lights since the wet-tarmac pass shipped, as two Gaussians drawn
// out along the line from each light's ground point to the eye. That is what rough damp tarmac
// does. Standing water is a mirror and holds an IMAGE — the lettering, the frame, the row of bulbs
// — and a smear cannot become one by being tuned, because it has never seen any of that: it is a
// colour and a radius. So the signage and the lights are rendered a second time through a camera
// that reflects the world about the water's plane (gl/mirror.js), and this is the A/B of that.
//
// ⚠ IT READS THE GL CANVAS, NOT THE COMPOSITED FRAME, FOR THE REASON runWet RECORDS ABOVE. A
// reflection is a grazing-angle effect, so the image of a sign three storeys up lands about a tile
// in front of a truck — which is behind the DASH. Pointed at the finished frame this measures the
// dashboard.
//
// ⚠ AND IT REPORTS `decals` AND `lights`, WHICH IS NOT DECORATION. The whole pass reflects exactly
// two layers, and a synthetic scene assembled out of bare `bt` tiles carries almost no signage —
// `modelFor` prefers a building NAME over a type, and the named models are where the marquees, the
// blades and the lettered boards live. A scene with nothing to reflect reports a weak effect and
// looks exactly like a weak effect, which is the confound runWet needed four attempts to escape.
// Named models, therefore, and the counts printed so the reader can see there was something there.
//
// ⚠ AND THE MASK IS THE WET ROAD, TAKEN FROM A DRY RENDER. Measured over the whole frame the answer
// is divided by a sky, a set of buildings and a verge that the water is not allowed to touch, and
// it falls as the window grows — a number measuring coverage rather than the term, which is the
// trap runFidelity is written around.
//
// Columns:
//   roadPx  — how many pixels the wetness itself moves. The denominator, and the sanity check.
//   touched — share of those the mirror moves at all. Climbs steadily with the gain and is the
//             wrong column to tune on: it counts a pixel that moved by one level.
//   visible — share it moves by 8/255 or more. THE number, and the one that caught the first cut
//             shipping at a gain sixteen times too low: 2.1% touched against 0.01% visible.
//   roadLum — the road's own mean brightness. The guard against tuning into a wash — across a
//             sixteen-fold gain change this moves under half a level, which is what makes a large
//             gain safe here.
//   worst   — the brightest single contribution. ⚠ It pins near 60 whatever the gain, which is the
//             HDR tonemap compressing highlights and not a clamp in this pass.
//   dryCtl  — the same gain with the road DRY. Must be ~0: the reflection lives in the water, and
//             anything here is the prepass leaking into a frame that has no puddles in it.
// ⚠ THE ROWS BRACKET THE SHIPPING VALUE ON BOTH SIDES, which is the rule LIGHT_SWEEP had to learn
// the hard way: a sweep entirely above or entirely below what ships answers "how much headroom is
// left" and cannot answer "should this move".
const MIRROR_GAINS = [0, 4, 8, 16, 32];

// ── THE TEST STREET, DEFINED ONCE ──────────────────────────────────────────────────────────────
//
// ⚠ A STREET CANYON, NOT A SCATTER, AND SHARED BY THE TABLE AND THE PICTURE. `runLights` builds its
// map by firing a hash at every tile, which at any sane density is a handful of sheds set well back
// from a road running through open ground — and a reflection needs something STANDING OVER THE
// WATER to reflect. Copied into this pass it produced a table of flat zeros beside a picture with
// two visible reflections in it, because the table and the shot had each grown their own street and
// only one of them was a street. Shoulder to shoulder on both kerbs, which is the arrangement every
// reference board for this work is of, and ONE builder so they cannot drift again.
function mirrorStreet(R, named) {
  const N = R * 2 + 1;
  let k = 0, n = 0;
  const m = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    const dx = x - R;
    if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
    if (Math.abs(dx) === 1) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    if (Math.abs(dx) >= 2 && Math.abs(dx) <= 4) {
      const r = named[(k++) % named.length];
      n++;
      return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6), ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 4) };
    }
    return { kind: 'land', biome: 'citycore', flr: 0 };
  }));
  m._buildings = n;
  return m;
}

export function runMirror({ W = 640, H = 360, hour = 23, R = 14, density = 0.18, gains = MIRROR_GAINS } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__mirror' + (runMirror.n = (runMirror.n || 0) + 1);
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  const scratch = document.createElement('canvas');
  const shot = () => {
    const g = glLastFrame() && glLastFrame().canvas;
    if (!g) throw new Error('__glMirror: the GL pass drew nothing — RENDER_TUNE.gl is ' + RENDER_TUNE.gl);
    scratch.width = g.width; scratch.height = g.height;
    const c = scratch.getContext('2d'); c.drawImage(g, 0, 0);
    return new Uint8ClampedArray(c.getImageData(0, 0, g.width, g.height).data);
  };

  // A street of NAMED buildings, which is where the signage is — see the ⚠ above.
  const realNow = performance.now, realRandom = Math.random;
  const was = { force: RENDER_TUNE.wetForce, wet: RENDER_TUNE.glWet, gl: RENDER_TUNE.gl, mir: RENDER_TUNE.glMirror };
  const map = mirrorStreet(R, named);
  const rows = [];
  let rngS = 0, stats = {}, probe = null;
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glWet = 1;
    Math.random = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };
    const view = () => ({
      cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.24, hour,
      weather: 'clear', speed: 0, map, heading: 0, mapCenter: { x: 100, y: 100 },
      mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 },
    });
    // ⚠ SETTLED AFTER EACH SETTING, NOT ONCE AT THE TOP. The light list ramps over ELAPSED time, so
    // a settle taken before the setting under test ramps nothing and every row reports 0.0% — the
    // same trap that made runLights report the lights costing nothing at a seat with no lights.
    const paint = (wet, gain) => {
      RENDER_TUNE.wetForce = wet; RENDER_TUNE.glMirror = gain;
      rngS = 12345;
      settleFade(() => { rngS = 12345; paintWindshield(el.id, view()); });
      return shot();
    };

    const dry = paint(0, 0);
    const off = paint(1, 0);
    // The wet road: whatever the water itself changes. Buildings, sky and verge are excluded by
    // construction rather than by a guess at where the road is on screen.
    const isRoad = new Uint8Array(off.length >> 2);
    let roadPx = 0;
    for (let i = 0; i < off.length; i += 4) {
      const d = Math.abs(off[i] - dry[i]) + Math.abs(off[i + 1] - dry[i + 1]) + Math.abs(off[i + 2] - dry[i + 2]);
      if (d >= 9) { isRoad[i >> 2] = 1; roadPx++; }
    }

    for (const gain of gains) {
      const on = paint(1, gain);
      // ⚠ TAKEN ON A LIVE ROW, NOT ON THE CONTROL. Read after the gain-0 paint this says `mirror 0`
      // every time — which is correct for that row and is indistinguishable from the pass never
      // running, and it is the number the reader is going to use to decide exactly that.
      if (gain > 0) { stats = glLastFrame() || stats; probe = (stats.mirrorPeak && stats.mirrorPeak()) || probe; }
      let moved = 0, sum = 0, worst = 0, vis = 0, lum = 0;
      for (let i = 0; i < on.length; i += 4) {
        if (!isRoad[i >> 2]) continue;
        lum += (on[i] + on[i + 1] + on[i + 2]) / 3;
        const d = (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2])) / 3;
        if (d >= 2) { moved++; sum += d; }
        // ⚠ THE COLUMN THAT DECIDES THE GAIN. 'touched' counts anything over the noise floor and
        // climbs steadily with the gain; what a player can actually SEE is a pixel that moved by a
        // reasonable fraction of a level, and that is the one that separates a reflection from a
        // tint. At gain 1 the first read 2.1% touched and 0.01% visible — a feature that measured
        // as present and could not be found on screen.
        if (d >= 8) vis++;
        if (d > worst) worst = d;
      }
      // The control, on the same gain: a dry road must not acquire a reflection.
      const dctl = paint(0, gain);
      let dm = 0;
      for (let i = 0; i < dctl.length; i += 4) {
        const d = Math.abs(dctl[i] - dry[i]) + Math.abs(dctl[i + 1] - dry[i + 1]) + Math.abs(dctl[i + 2] - dry[i + 2]);
        if (d >= 9) dm++;
      }
      rows.push({
        gain: gain.toFixed(2) + (gain === was.mir ? ' (shipping)' : ''),
        roadPx,
        touched: roadPx ? (moved / roadPx * 100).toFixed(2) + '%' : '—',
        visible: roadPx ? (vis / roadPx * 100).toFixed(2) + '%' : '—',
        roadLum: roadPx ? (lum / roadPx).toFixed(2) : '—',
        mean: moved ? (sum / moved / 255 * 100).toFixed(1) : '0.0',
        worst: Math.round(worst),
        dryCtl: ((dm / (dctl.length >> 2)) * 100).toFixed(2) + '%',
      });
    }
  } finally {
    RENDER_TUNE.wetForce = was.force; RENDER_TUNE.glWet = was.wet;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glMirror = was.mir;
    performance.now = realNow; Math.random = realRandom;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log(`   scene: ${map._buildings} named buildings, ${stats.decals || 0} signage quads, `
    + `${stats.lights || 0} lights, mirror ${stats.mirror || 0}`);
  console.log('   reflection buffer: ' + (probe ? `${probe.w}x${probe.h}, peak ${probe.max}/255, ${probe.litPct}% of it lit` : 'NOT PROBED'));
  console.log('   gain 0 is the control and wants to be flat — it is the smear that shipped.');
  console.log('   ⚠ decals 0 means there was nothing to reflect and every row below is measuring the lights alone.');
  return rows;
}
if (typeof window !== 'undefined') window.__glMirror = runMirror;

// ── `__glMirrorShot()` ─────────────────────────────────────────────────────────────────────────
//
// The same street, painted into a canvas you can actually look at.
//
// ⚠ BECAUSE THE AGGREGATE IS THE WRONG INSTRUMENT FOR THIS ONE, and the table above proves it. A
// mirror image is a few BRIGHT PATCHES — a sign, legible, in one puddle — and "share of road pixels
// moved" divides that by a whole street of tarmac that has nothing over it to reflect. The first
// sweep read 94.3% at every gain from 0.35 to 3.0, which is not the reflection at all: it is the
// streak reweighting, which flips once and then stops caring. The same mistake `__glLights` records
// one system over — the bench was answering a question nobody had asked.
//
// So this paints and stops. `wet`, `gain` and `hour` are the three knobs worth moving, the canvas is
// left on the page at 2x so it can be read, and nothing is measured.
export function paintMirrorShot({ W = 640, H = 360, hour = 23, gain = null, wet = 1, R = 14, density = 0.18, zoom = 2, eyeH = 0.24, height = 0, cls = 'truck', resFloor = 1, off = 0, superSample = 1, resFloorPx = null } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  let holder = document.getElementById('__mirshot');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = '__mirshot';
    holder.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000;padding:0;line-height:0';
    document.body.append(holder);
  }
  holder.innerHTML = '';
  const el = document.createElement('canvas');
  el.id = '__mirshotC' + (paintMirrorShot.n = (paintMirrorShot.n || 0) + 1);
  el.width = W; el.height = H;
  el.style.cssText = `width:${W * zoom}px;height:${H * zoom}px;image-rendering:pixelated`;
  holder.append(el);
  const uninstall = installGL(() => el);
  const realNow = performance.now, realRandom = Math.random;
  const was = { force: RENDER_TUNE.wetForce, gl: RENDER_TUNE.gl, wet: RENDER_TUNE.glWet, mir: RENDER_TUNE.glMirror };
  let rngS = 0;
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glWet = 1;
    RENDER_TUNE.wetForce = wet;
    if (gain != null) RENDER_TUNE.glMirror = gain;
    Math.random = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };
    const map = mirrorStreet(R, named);

    const view = {
      cls, phase: 'cruise', worldBlend: 1, height, eyeH, hour,
      weather: 'clear', speed: 0, map, heading: 0, mapCenter: { x: 100, y: 100 },
      mapOffset: { x: 0, y: off }, resFloor, resFloorPx, superSample, tune: { gl: 1, perfDS: 0 },
    };
    rngS = 12345;
    settleFade(() => { rngS = 12345; paintWindshield(el.id, view); });
    const st = glLastFrame() || {};
    const p = st.mirrorPeak && st.mirrorPeak();
    console.log(`__glMirrorShot: hour ${hour}, wet ${wet}, gain ${RENDER_TUNE.glMirror}, `
      + `${st.decals || 0} signage quads, ${st.lights || 0} lights`
      + (p ? ` — buffer ${p.w}x${p.h}, peak ${p.max}/255, ${p.litPct}% lit` : ' — no reflection buffer'));
    return { canvas: el, stats: st, probe: p };
  } finally {
    RENDER_TUNE.wetForce = was.force; RENDER_TUNE.gl = was.gl;
    RENDER_TUNE.glWet = was.wet; RENDER_TUNE.glMirror = was.mir;
    performance.now = realNow; Math.random = realRandom;
    uninstall && uninstall();
    // ⚠ THE CANVAS STAYS. This function exists to be looked at, so the holder is deliberately not
    // removed — call it again to replace it, or remove '#__mirshot' by hand when you are done.
  }
}
if (typeof window !== 'undefined') window.__glMirrorShot = paintMirrorShot;

// ── DOES THE CITY LOOK LIKE IT IS MADE OF ANYTHING? ─────────────────────────
//
// `__glMaterials()`. Every surface in GLASS answered the light identically until the material table
// landed: one half-lambert key and two overlay tints, for brick, sheet copper, curtain glass and
// weathered board alike. This is the A/B on that — the same street with `RENDER_TUNE.glMat` at 0 and
// at each step of a sweep — and it asks the three questions that have caught every previous term in
// this file out.
//
// ⚠ FIRST, DOES IT REACH ANY PIXELS AT ALL. This is the fourth feature here to be wired at both ends
// and dropped in the middle (see the allowlist note in install.js), and the symptom every time is
// 0.0% moved at every strength — which is indistinguishable from restraint if nobody sweeps it.
//
// ⚠ SECOND, DOES IT STAY ON THE BUILDINGS. The material block multiplies by `solid`, so the flat
// adornment layer — most of the faces in the city — must be untouched, and the ground, the sky and
// the road are not in this pass at all. The off-building number is the one that has to be ~0.
//
// ⚠ THIRD, IS THE NIGHT SEAT DIFFERENT FROM THE DAY ONE. A specular lobe keyed off `uKeyDir` and an
// environment taken off the sky both collapse after dark, so a night seat that moved exactly as far
// as a noon seat would mean the terms are being driven by something that is not the light.
//
// ⚠ AND THE DIALS ARE PINNED, as in every bench here: a loose resolution step sheds pixels exactly
// where the frame is expensive and gets read as the feature under test.
const MAT_SEATS = [
  { tag: 'cab, noon', R: 14, density: 0.20, hour: 12.5, cls: 'truck' },
  { tag: 'cab, night', R: 14, density: 0.20, hour: 23, cls: 'truck' },
  { tag: 'air, afternoon', R: 34, density: 0.06, hour: 15.5, cls: 'prop' },
];
const MAT_SWEEP = [0.35, 0.7, 1];

export function runMaterials({ W = 640, H = 360, frames = 26, warm = 8 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  // ⚠ THE BUILDINGS COME FROM THE NAMED REGISTRY AND NOT FROM ONE TYPE, which is the whole point of
  // this particular bench: a city of `citycore` boxes is ONE material, and a material system
  // measured against one material measures nothing. Cycling the registry gives the street sheet
  // metal, curtain glass, brick, riveted plate and weathered board in the proportions the city has.
  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0;
    return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6),
          ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
  };

  const rows = [], realNow = performance.now.bind(performance);
  const heldMat = RENDER_TUNE.glMat, heldBump = RENDER_TUNE.glBump;
  try {
    for (const seat of MAT_SEATS) {
      const ID = '__mat' + MAT_SEATS.indexOf(seat) + '_' + (runMaterials.n = (runMaterials.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };
      // ⚠ SETTLED, NOT MERELY FROZEN. The wall wash ramps over ELAPSED time, so under a clock that
      // never advances no light ever reaches its slot — and the night seat would be compared against
      // a city with no lights on it, which is not the city. That is the bug that had every row of
      // __glLights() reading 0.0% for weeks.
      settleFade(() => paintWindshield(ID, view(built)));

      RENDER_TUNE.glMat = 0; RENDER_TUNE.glBump = heldBump;
      paint2(view(bare)); const empty = shot();
      paint2(view(built)); const off = shot();
      // What the buildings cover. Everything outside it is ground, sky, road and cab, none of which
      // this term is allowed to touch.
      const isWall = new Uint8Array(off.length >> 2);
      let mask = 0, ground = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d = Math.abs(off[i] - empty[i]) + Math.abs(off[i + 1] - empty[i + 1]) + Math.abs(off[i + 2] - empty[i + 2]);
        if (d > 18) { isWall[i >> 2] = 1; mask++; } else ground++;
      }
      // ⚠ THE BASELINE IS AN ARGUMENT, AND THE FIRST CUT HAD ONE BASELINE FOR EVERYTHING. Measured
      // against the no-material frame, the relief row came back LOWER than the row without it —
      // 25.2% against 23.7% — which reads as the term doing nothing, or worse than nothing. It is
      // not: relief both brightens and darkens, so some of the pixels it touches land back NEAR the
      // baseline it is being compared to, and the count goes down while the picture changes. A term
      // has to be measured against the frame it is actually added to.
      const measure = (label, from, capture) => {
        paint2(view(built)); const on = shot();
        let moved = 0, sum = 0, worst = 0, outside = 0;
        for (let i = 0; i < on.length; i += 4) {
          const d = (Math.abs(on[i] - from[i]) + Math.abs(on[i + 1] - from[i + 1]) + Math.abs(on[i + 2] - from[i + 2])) / 3;
          if (!isWall[i >> 2]) { if (d >= 2) outside++; continue; }
          if (d >= 2) { moved++; sum += d; }
          if (d > worst) worst = d;
        }
        rows.push({ seat: seat.tag, setting: label, wallPx: mask,
          movedPct: mask ? +(moved / mask * 100).toFixed(1) : null,
          meanOnMoved: moved ? +(sum / moved / 255 * 100).toFixed(1) : null,
          worst: Math.round(worst),
          offBuildingPct: ground ? +(outside / ground * 100).toFixed(2) : null });
        return capture ? on : null;
      };
      for (const s of MAT_SWEEP) { RENDER_TUNE.glMat = s; measure('glMat ' + s + ' vs none', off); }
      // ── AND THE RELIEF ON ITS OWN ─────────────────────────────────────────────────────────
      //
      // Swept separately because it is the half most likely to be silently doing nothing: it needs
      // an atlas, a texel size and a per-family strength, and any one of the three missing leaves
      // every other term working perfectly. It was also written in the wrong PLACE first — inside
      // the material block, perturbing a normal the key shading had already finished with, so it
      // reached the reflection and not the diffuse. This row is what said so.
      //
      // ⚠ EXPECT FEW PIXELS AND A BIG MOVE ON THEM. A brick wall is mostly flat brick with thin
      // joints, so the luminance gradient is near zero almost everywhere and large on the joint, the
      // lap and the rivet line. A row here reading 2% moved at mean 5 is the term working; the same
      // row reading 25% would mean it had embossed the whole wall.
      RENDER_TUNE.glMat = heldMat; RENDER_TUNE.glBump = 0;
      const matOnly = measure('glMat ' + heldMat + ', no relief', off, true);
      RENDER_TUNE.glBump = heldBump; measure('relief ' + heldBump + ' vs no relief', matOnly);

      // Cost, clock live.
      performance.now = realNow;
      const t = (m, b) => {
        RENDER_TUNE.glMat = m; RENDER_TUNE.glBump = b;
        const v = view(built);
        for (let i = 0; i < warm; i++) paintWindshield(ID, v);
        const a = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, v); a.push(performance.now() - t0); }
        return mid(a);
      };
      const msOff = t(0, 0), msMat = t(heldMat, 0), msBoth = t(heldMat, heldBump);
      rows.push({ seat: seat.tag, setting: 'cost off -> mat -> +bump', wallPx: null,
        movedPct: null, meanOnMoved: null, worst: null, offBuildingPct: null,
        ms: msOff.toFixed(2) + ' -> ' + msMat.toFixed(2) + ' -> ' + msBoth.toFixed(2) });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.glMat = heldMat; RENDER_TUNE.glBump = heldBump;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   offBuildingPct is the control and wants to be ~0: this term may only touch mass.');
  console.log('   the night row moving LESS than noon is correct — the lobe and the sky both go with the light.');
  return rows;
}
if (typeof window !== 'undefined') window.__glMaterials = runMaterials;

// `__glBevel()`. The shading bevel, in pixels.
//
// The BEVEL is the answer to a sentence already in the material shader: "a highlight on a flat box
// is not a highlight". Every model here is boxes and drums, every edge is a hard 90°, and there is
// no surface anywhere on a building turned part-way toward the light. Real corners carry a chamfer,
// and that chamfer is the bright line down the edge of every masonry building ever photographed. It
// is normals only — not one vertex moves and the face budget does not change — so the ONLY way to
// see whether it is doing anything is in pixels, which is what this is for.
//
// ⚠ FIRST QUESTION, AS ALWAYS: DOES IT REACH ANY PIXELS. This is the fifth feature to go through
// the allowlist in install.js, and that note now records four separate occasions where a term was
// wired at both ends, correct in the shader, swept — and dropped one hop short, reporting 0.0% at
// every strength. A sweep with every row at zero is that signature, not a disappointment.
//
// ⚠ SECOND: IT BELONGS ON THE BUILDINGS. It rides the same mass pass the material block does, so
// the ground, the road, the sky and the cab are not in this pass at all and must not move.
//
// ⚠ THIRD: EXPECT THE NIGHT ROW TO BE NEAR ZERO, AND THAT IS THE SCENE RATHER THAN A FAULT. The
// bevel reaches the picture through the key term, and after dark there is barely a key to steer —
// which is the same arithmetic that makes the material rows collapse at night.
//
// ⚠ AND AN EMISSION CHANNEL WAS SWEPT HERE TOO, AND REMOVED. It read 0.0% at every seat because
// every emissive face in the city is flat and a flat face is already unshaded. See world.js.
//
// ⚠ AND A SETTLED CLOCK, not merely a frozen one — the whole reason __glLights() read 0.0% for
// weeks. The night seat has to be compared against a city whose lights reached their slots.
const BEV_SEATS = [
  { tag: 'cab, noon', R: 14, density: 0.20, hour: 12.5, cls: 'truck' },
  { tag: 'cab, night', R: 14, density: 0.20, hour: 23, cls: 'truck' },
  { tag: 'air, afternoon', R: 34, density: 0.06, hour: 15.5, cls: 'prop' },
];
const BEV_SWEEP = [0.01, 0.02, 0.04];

export function runBevel({ W = 640, H = 360, frames = 26, warm = 8 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  // The named registry rather than one building type, for the reason __glMaterials gives: a street
  // of one model is one shape, and an edge treatment measured on one shape measures nothing.
  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0;
    return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6),
          ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
  };

  const rows = [], realNow = performance.now.bind(performance);
  const heldBevel = RENDER_TUNE.glBevel;
  try {
    for (const seat of BEV_SEATS) {
      const ID = '__bev' + BEV_SEATS.indexOf(seat) + '_' + (runBevel.n = (runBevel.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };
      settleFade(() => paintWindshield(ID, view(built)));

      RENDER_TUNE.glBevel = 0;
      paint2(view(bare)); const empty = shot();
      paint2(view(built)); const off = shot();
      const isWall = new Uint8Array(off.length >> 2);
      let mask = 0, ground = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d = Math.abs(off[i] - empty[i]) + Math.abs(off[i + 1] - empty[i + 1]) + Math.abs(off[i + 2] - empty[i + 2]);
        if (d > 18) { isWall[i >> 2] = 1; mask++; } else ground++;
      }
      const measure = (label, from) => {
        paint2(view(built)); const on = shot();
        let moved = 0, sum = 0, worst = 0, outside = 0;
        for (let i = 0; i < on.length; i += 4) {
          const d = (Math.abs(on[i] - from[i]) + Math.abs(on[i + 1] - from[i + 1]) + Math.abs(on[i + 2] - from[i + 2])) / 3;
          if (!isWall[i >> 2]) { if (d >= 2) outside++; continue; }
          if (d >= 2) { moved++; sum += d; }
          if (d > worst) worst = d;
        }
        rows.push({ seat: seat.tag, setting: label, wallPx: mask,
          movedPct: mask ? +(moved / mask * 100).toFixed(1) : null,
          meanOnMoved: moved ? +(sum / moved / 255 * 100).toFixed(1) : null,
          worst: Math.round(worst),
          offBuildingPct: ground ? +(outside / ground * 100).toFixed(2) : null });
      };
      for (const s of BEV_SWEEP) { RENDER_TUNE.glBevel = s; measure('glBevel ' + s + ' vs none', off); }

      performance.now = realNow;
      const t = (b) => {
        RENDER_TUNE.glBevel = b;
        const v = view(built);
        for (let i = 0; i < warm; i++) paintWindshield(ID, v);
        const a = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, v); a.push(performance.now() - t0); }
        return mid(a);
      };
      const msOff = t(0), msBev = t(heldBevel);
      rows.push({ seat: seat.tag, setting: 'cost off -> bevel', wallPx: null,
        movedPct: null, meanOnMoved: null, worst: null, offBuildingPct: null,
        ms: msOff.toFixed(2) + ' -> ' + msBev.toFixed(2) });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.glBevel = heldBevel;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   offBuildingPct is the control and wants to be ~0: this term may only touch mass.');
  console.log('   a near-zero NIGHT row is correct — the bevel steers the key term, and there is barely a key.');
  return rows;
}
if (typeof window !== 'undefined') window.__glBevel = runBevel;

// `__glSsao()`. The occlusion neither of the other two terms can see.
//
// `glAO` is a height above the ground and `glBakedAo` is sampled against a model's OWN solid, so
// both stop at the edge of the building they belong to. What neither answers is the gap between two
// DIFFERENT buildings — an alley, a canopy over a neighbour's frontage, a light well — which is
// most of what a dense street is made of. This is the A/B on that.
//
// ⚠ THE SEATS ARE CHOSEN TO SEPARATE IT FROM THE TERMS IT SITS ON TOP OF. A dense street is where
// it should do most of its work and an isolated building is where it should do almost none, so the
// pair is the measurement: a term that moved both equally would be a vignette rather than occlusion.
//
// ⚠ AND THE OTHER TWO OCCLUSION TERMS ARE HELD AT THEIR SHIPPED VALUES, not zeroed. This lands on
// top of them, so the frame it is actually added to is the one with them in it — the lesson the
// relief row cost in __glMaterials, where a term measured against a baseline it is not added to
// came back LOWER than the term without it.
//
// ⚠ FIRST QUESTION, AS ALWAYS: DOES IT REACH ANY PIXELS. Sixth feature through the allowlist in
// install.js. This one has more ways to silently do nothing than any of the others — a framebuffer
// the driver will not complete, a depth texture it will not allocate, three programs that have to
// link, a resize that failed — and every one of them is caught and turned into "strength 0", which
// is correct behaviour and indistinguishable from the term being pointless.
const SSAO_SEATS = [
  { tag: 'cab, dense street', R: 12, density: 0.42, hour: 12.5, cls: 'truck' },
  { tag: 'cab, one building', R: 12, density: 0.0, hour: 12.5, cls: 'truck', solo: true },
  { tag: 'cab, dense, night', R: 12, density: 0.42, hour: 23, cls: 'truck' },
  { tag: 'air, afternoon', R: 30, density: 0.12, hour: 15.5, cls: 'prop' },
];
const SSAO_SWEEP = [0.25, 0.5, 1];

export function runSsao({ W = 640, H = 360, frames = 26, warm = 8 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  const mk = (R, density, solo) => {
    const N = R * 2 + 1;
    let k = 0;
    return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R, dy = y - R;
      // One building on open ground, for the control seat: nothing near it to be occluded by.
      if (solo) {
        if (dx >= 0 && dx <= 1 && dy >= -4 && dy <= -3) {
          return { kind: 'land', biome: 'citycore', bt: 'shop', bn: named[3].name || named[3].key.slice(6), ent: 'south', flr: 6 };
        }
        return { kind: 'land', biome: 'citycore', road: dx === -1 ? 1 : 0, rd: 'ns', flr: 0, pw: 1 };
      }
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) === 1) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6),
          ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 5) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
  };

  const rows = [], realNow = performance.now.bind(performance);
  const held = RENDER_TUNE.glSsao;
  try {
    for (const seat of SSAO_SEATS) {
      const ID = '__ssao' + SSAO_SEATS.indexOf(seat) + '_' + (runSsao.n = (runSsao.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density, seat.solo), bare = mk(seat.R, 0);
      const view = (map) => ({
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      });
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };
      settleFade(() => paintWindshield(ID, view(built)));

      RENDER_TUNE.glSsao = 0;
      paint2(view(bare)); const empty = shot();
      paint2(view(built)); const off = shot();
      const isWall = new Uint8Array(off.length >> 2);
      let mask = 0, ground = 0;
      for (let i = 0; i < off.length; i += 4) {
        const d = Math.abs(off[i] - empty[i]) + Math.abs(off[i + 1] - empty[i + 1]) + Math.abs(off[i + 2] - empty[i + 2]);
        if (d > 18) { isWall[i >> 2] = 1; mask++; } else ground++;
      }
      const measure = (label) => {
        paint2(view(built)); const on = shot();
        let moved = 0, sum = 0, worst = 0, outside = 0, darker = 0;
        for (let i = 0; i < on.length; i += 4) {
          const s = (on[i] - off[i]) + (on[i + 1] - off[i + 1]) + (on[i + 2] - off[i + 2]);
          const d = Math.abs(s) / 3;
          if (!isWall[i >> 2]) { if (d >= 2) outside++; continue; }
          if (d >= 2) { moved++; sum += d; if (s < 0) darker++; }
          if (d > worst) worst = d;
        }
        rows.push({ seat: seat.tag, setting: label, wallPx: mask,
          movedPct: mask ? +(moved / mask * 100).toFixed(1) : null,
          meanOnMoved: moved ? +(sum / moved / 255 * 100).toFixed(1) : null,
          darkerPct: moved ? +(darker / moved * 100).toFixed(0) : null,
          worst: Math.round(worst),
          offBuildingPct: ground ? +(outside / ground * 100).toFixed(2) : null });
      };
      for (const s of SSAO_SWEEP) { RENDER_TUNE.glSsao = s; measure('glSsao ' + s + ' vs none'); }

      performance.now = realNow;
      const t = (s) => {
        RENDER_TUNE.glSsao = s;
        const v = view(built);
        for (let i = 0; i < warm; i++) paintWindshield(ID, v);
        const a = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, v); a.push(performance.now() - t0); }
        return mid(a);
      };
      const msOff = t(0), msOn = t(held);
      rows.push({ seat: seat.tag, setting: 'cost off -> ssao', wallPx: null,
        movedPct: null, meanOnMoved: null, darkerPct: null, worst: null, offBuildingPct: null,
        ms: msOff.toFixed(2) + ' -> ' + msOn.toFixed(2) });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.glSsao = held;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   darkerPct wants to be ~100: occlusion only ever removes light.');
  console.log('   the dense seat must move MORE than the one-building seat, or this is a vignette, not occlusion.');
  return rows;
}
if (typeof window !== 'undefined') window.__glSsao = runSsao;

// `__glHdr()`. The float target, the bloom and the tone curve — and the three separate ways this
// one managed to be correct, wired, measurable and completely inert.
//
// ⚠ THE HEADROOM IS REAL AND THE CITY DOES NOT USE IT. That is the finding the whole feature turns
// on, and `peak` is the column that says so: every shader in GLASS was written against an 8-bit
// target and saturates by construction, so before the emissive gain the brightest pixel in a night
// street measured **1.016**, with 0.01% of the frame over 1.0. A bright-pass at 1.0 therefore found
// nothing — not because the buffer was wrong, not because the chain was wrong, but because there was
// nothing above white to find.
//
// ⚠ AND LOWERING THE THRESHOLD IS NOT THE FIX, WHICH THE PICTURE SAID AND THE NUMBERS DID NOT. At
// 0.72 the bloom came back — on the ROAD MARKINGS, which in a dark street are the palest thing in
// frame and are not lights. A bloom that cannot tell a neon sign from painted tarmac is worse than
// no bloom. The emitters are pushed past white instead (EMISSIVE_GAIN in world.js) and the
// threshold means what it says again.
//
// ⚠ WHICH COSTS A LOOK CHANGE, and the 'bloom 0' row is where to watch it. The composite clamps, so
// a glow already at 1.0 is unchanged — but one BELOW 1.0 is brighter now, and that row measures
// exactly that and nothing else. It is a deliberate trade and not a free one.
//
// ⚠ AND THE DIALS ARE PINNED AND THE CLOCK SETTLED, as in every bench here.
const HDR_SEATS = [
  { tag: 'cab, night', R: 12, density: 0.34, hour: 23, cls: 'truck' },
  { tag: 'cab, noon', R: 12, density: 0.34, hour: 12.5, cls: 'truck' },
  { tag: 'air, dusk', R: 28, density: 0.12, hour: 19.5, cls: 'prop' },
];

export function runHdr({ W = 640, H = 360, frames = 26, warm = 8 } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const mid = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
  const mk = (R, density) => {
    const N = R * 2 + 1;
    let k = 0;
    return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
      const dx = x - R;
      if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
      if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, pw: 1 };
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (density && (h % 1000) / 1000 < density) {
        const r = named[(k++) % named.length];
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6),
          ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 4) };
      }
      return { kind: 'land', biome: 'citycore', flr: 0 };
    }));
  };

  const rows = [], realNow = performance.now.bind(performance);
  const held = { h: RENDER_TUNE.glHdr, b: RENDER_TUNE.glBloom, t: RENDER_TUNE.glTonemap };
  try {
    for (const seat of HDR_SEATS) {
      const ID = '__hdr' + HDR_SEATS.indexOf(seat) + '_' + (runHdr.n = (runHdr.n || 0) + 1);
      el.id = ID;
      const built = mk(seat.R, seat.density);
      const view = {
        cls: seat.cls, phase: 'cruise', worldBlend: 1,
        height: seat.cls === 'prop' ? 0.5 : 0, eyeH: seat.cls === 'prop' ? undefined : 0.12,
        hour: seat.hour, weather: 'clear', speed: 0.4, map: built, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        resFloor: 1, tune: { gl: 1, perfDS: 0 },
      };
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
      const paint2 = () => { paintWindshield(ID, view); paintWindshield(ID, view); };
      settleFade(() => paintWindshield(ID, view));

      RENDER_TUNE.glHdr = 0; paint2(); const off = shot();
      const cmp = (label) => {
        settleFade(() => paintWindshield(ID, view));
        paint2(); const on = shot();
        let moved = 0, up = 0, sum = 0, worst = 0;
        for (let i = 0; i < on.length; i += 4) {
          const d = ((on[i] - off[i]) + (on[i + 1] - off[i + 1]) + (on[i + 2] - off[i + 2])) / 3;
          if (Math.abs(d) >= 2) { moved++; sum += Math.abs(d); if (d > 0) up++; }
          if (Math.abs(d) > worst) worst = Math.abs(d);
        }
        const st = glLastFrame() || {};
        rows.push({ seat: seat.tag, setting: label,
          movedPct: +(moved / (on.length / 4) * 100).toFixed(1),
          brighterPct: moved ? +(up / moved * 100).toFixed(0) : null,
          mean: +(sum / Math.max(1, moved)).toFixed(1), worst: Math.round(worst),
          peak: st.hdr && st.hdr.peak ? st.hdr.peak().maxUnpremult : null,
          overOnePct: st.hdr && st.hdr.peak ? st.hdr.peak().overOnePct : null });
      };
      RENDER_TUNE.glHdr = 1; RENDER_TUNE.glTonemap = 0;
      RENDER_TUNE.glBloom = 0;   cmp('hdr on, bloom 0 (the emitter gain alone)');
      RENDER_TUNE.glBloom = 0.4; cmp('bloom 0.4');
      RENDER_TUNE.glBloom = 0.8; cmp('bloom 0.8');
      RENDER_TUNE.glBloom = 0;   RENDER_TUNE.glTonemap = 0.25; cmp('curve 0.25, no bloom');
      RENDER_TUNE.glTonemap = 0.6; cmp('curve 0.60, no bloom');

      performance.now = realNow;
      const t = (hdr, bloom) => {
        RENDER_TUNE.glHdr = hdr; RENDER_TUNE.glBloom = bloom; RENDER_TUNE.glTonemap = hdr ? 0.25 : 0;
        for (let i = 0; i < warm; i++) paintWindshield(ID, view);
        const a = [];
        for (let i = 0; i < frames; i++) { const t0 = performance.now(); paintWindshield(ID, view); a.push(performance.now() - t0); }
        return mid(a);
      };
      const msOff = t(0, 0), msBuf = t(1, 0), msAll = t(1, 0.6);
      rows.push({ seat: seat.tag, setting: 'cost off -> buffer -> +bloom', movedPct: null,
        brighterPct: null, mean: null, worst: null, peak: null, overOnePct: null,
        ms: msOff.toFixed(2) + ' -> ' + msBuf.toFixed(2) + ' -> ' + msAll.toFixed(2) });
    }
  } finally {
    performance.now = realNow;
    RENDER_TUNE.glHdr = held.h; RENDER_TUNE.glBloom = held.b; RENDER_TUNE.glTonemap = held.t;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   peak is the whole argument: under 1.0 and a bright-pass at 1.0 has nothing to find.');
  console.log('   the "bloom 0" row is the emitter gain\'s own look change, measured on its own.');
  console.log('   a noon seat blooming nothing is correct — the additive lights are night-gated.');
  return rows;
}
if (typeof window !== 'undefined') window.__glHdr = runHdr;


// ── DO THE GEESE DRAW ON THE GL PATH LIKE EVERY OTHER THING IN THAT LAYER? ────────────────────
//
// The headless gate (scripts/shapes/fauna.mjs) proves the flock ARRIVES: correct sink, correct
// device-pixel sizes, nothing left painting on the canvas, a bounded key space. That is the whole
// of what CI can say, because every harness in the repo installs a GL hook that returns null and so
// never reaches a draw call. Whether a goose is actually VISIBLE through GLASS 2 is only answerable
// here, with a real context.
//
// ⚠ THE CONTROL IS THE TREES, NOT THE 2-D PATH — and that correction is the whole value of this
// function. Measured GL-against-2-D, the geese changed a ninth as many pixels on the GL path and
// the obvious reading was a bug in the flock. It is not: the SCATTER SPECIES measure 0.08 in the
// same scene where the geese measure 0.11. Whatever accounts for it — the compositing arrangement
// in this harness, the layer itself — it is a property of the billboard layer that predates any of
// this, and the only question a goose can answer is whether it behaves like the species that
// already ship. An A/B between two renderers needs a control that is known-good IN THE SAME
// HARNESS, or the harness's own quirks are read as the subject's bugs.
//
// ⚠ AND `geese on vs geese off` ALONE WOULD NOT DO EITHER. A flock that draws nothing reports 0.0%,
// which is indistinguishable from a feature that is inert — the failure the allowlist warnings in
// gl/install.js keep re-recording. Hence four paints per subject and a second subject to compare to.
//
// ⚠ ONE FINDING THIS TURNED UP THAT IS NOT ABOUT GEESE, and somebody should chase it: in this
// arrangement BOTH subjects change far fewer pixels through the GL composite than through the 2-D
// path — the scatter species measure 0.036-0.084 and the geese 0.11-0.25. That is an order of
// magnitude, it is the same for a subject that has shipped for months, and it is either a property
// of how this harness composites or of the billboard layer itself. It is not investigated here
// because a goose cannot answer it; it is written down because a future reader will otherwise
// re-derive it and blame whatever they are measuring at the time.
export function runGeese({ W = 640, H = 360, dist = 2, thresh = 12 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__geesebench'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);

  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese, trees: RENDER_TUNE.treeDensity };
  const out = { ok: false };
  try {
    // A flock that really exists, found by asking the same function the renderer reads — never a
    // hand-picked tile, which is a coin flip that goes vacuous the first time a constant moves.
    const A = flocksNear(900, 900, 30, 1, () => true)[0];
    if (!A) throw new Error('no flock anchor near the seed tile');
    const centre = { x: A.ax, y: A.ay + dist };
    const park = (wx, wy) => (Math.abs(wx - A.ax) <= 6 && Math.abs(wy - A.ay) <= 6
      ? { kind: 'land', biome: 'parkland', flr: 0 }
      : { kind: 'land', biome: 'citycore', flr: 0 });
    const RR = 20, NN = RR * 2 + 1;
    const map = Array.from({ length: NN }, (_, ry) => Array.from({ length: NN }, (_, rx) => park(centre.x - RR + rx, centre.y - RR + ry)));
    const view = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0,
      eyeH: 0.12, fovMul: 1.22, hour: 12, weather: 'clear', speed: 0, resFloor: 1,
      map, heading: 0, mapCenter: { ...centre }, mapOffset: { x: 0, y: -0.5 } };

    // A moment the anchor flock is on the grass. ⚠ Both clocks pinned: the frame animations run on
    // performance.now() and the FLOCK CYCLE runs on wall time (see the ⚠ on drawGeese), so pinning
    // one leaves the half this measures free to move between paints.
    let T = 1e6;
    for (let i = 0; i < 4000; i++) { const t = 1e6 + i * 250; if (!flockState(A, t).airborne) { T = t; break; } }
    performance.now = () => T; Date.now = () => T;

    const paint = (gl, { geese, trees }) => {
      RENDER_TUNE.gl = gl ? 1 : 0; RENDER_TUNE.glFloor = gl ? 1 : 0;
      RENDER_TUNE.geese = geese; RENDER_TUNE.treeDensity = trees;
      paintWindshield('__geesebench', view);   // settle every lazy bake
      paintWindshield('__geesebench', view);
      return shot();
    };
    const changed = (a, b) => {
      let n = 0, sx = 0, sy = 0;
      for (let p = 0, i = 0; i < a.length; i += 4, p++) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d <= thresh) continue;
        n++; sx += p % W; sy += (p / W) | 0;
      }
      return { n, cx: n ? sx / n : 0, cy: n ? sy / n : 0 };
    };
    // Four paints per subject; each pair shares a renderer, so the only thing that moved is the
    // subject. `trees: 0` / `geese: 0` are the off switches, and both are the absence of the pass.
    const subject = (on, off) => {
      const g = changed(paint(true, on), paint(true, off));
      const c = changed(paint(false, on), paint(false, off));
      return { gl: g.n, canvas: c.n, ratio: c.n ? +(g.n / c.n).toFixed(3) : null,
        shiftPx: g.n && c.n ? +Math.hypot(g.cx - c.cx, g.cy - c.cy).toFixed(1) : null };
    };
    out.geese = subject({ geese: was.geese || 1, trees: was.trees }, { geese: 0, trees: was.trees });
    out.trees = subject({ geese: 0, trees: was.trees }, { geese: 0, trees: 0 });

    if (!out.geese.canvas) out.verdict = 'VACUOUS — the 2-D control drew no geese, so the scene is wrong rather than the renderer';
    else if (!out.trees.canvas) out.verdict = 'VACUOUS — no scatter species in the scene, so there is nothing to compare against';
    else if (!out.geese.gl) out.verdict = 'FAILED — the 2-D path drew a flock and GLASS 2 drew nothing at all';
    else {
      // ⚠ A LOWER BOUND ONLY. The question is whether the flock is DISAPPEARING where the shipping
      // species do not; drawing more faithfully than the control is never a bug, and an upper bound
      // fails it for being better. Measured over distances 1-6 the geese sit at 0.11-0.25 against
      // the trees' 0.036-0.084 — consistently the good end — and a two-sided band called three of
      // those four runs a failure.
      const rel = out.geese.ratio / out.trees.ratio;
      out.relativeToTrees = +rel.toFixed(2);
      out.verdict = rel > 0.4
        ? 'OK — the flock survives GLASS 2 at least as well as the scatter species'
        : `FADING — geese ${out.geese.ratio} against trees ${out.trees.ratio} on the same scene, so the flock is being lost where the species are not`;
    }
    out.anchor = `${A.ax},${A.ay}`;
    out.ok = true;
  } finally {
    performance.now = realNow; Date.now = realDate;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor;
    RENDER_TUNE.geese = was.geese; RENDER_TUNE.treeDensity = was.trees;
    uninstall(); holder.remove();
  }
  console.table([{ verdict: out.verdict, geese: out.geese && out.geese.ratio, trees: out.trees && out.trees.ratio, rel: out.relativeToTrees }]);
  return out;
}
if (typeof window !== 'undefined') window.__glGeese = runGeese;

// `__glGooseSky()`. Reported as "the clouds seem to be appearing in front of the geese", and the
// mechanism is two lines of GL state in two files: a billboard writes no depth, the cloud deck
// clears COLOUR ONLY and tests against the depth the world left behind, so at a bird's own pixels
// the buffer still holds the ground a few hundred tiles away and every card passes. Reading that is
// not the same as measuring it, because the deck also lays a screen-space HAZE BAND and a whiteout
// flood over the whole frame — both of them correct, neither of them depth-testable — and a
// screenshot cannot tell one from the other.
//
// So the subject is THE BIRDS' OWN PIXELS and nothing else. The mask comes from a render with the
// deck switched off entirely, which is the only way to know where a goose is without asking the
// thing under test; `survives` is then how many of those pixels still differ from the same frame
// with no geese in it once the deck is drawn over them. A wash that dims the birds and the sky
// together leaves them differing and scores high; a card that covers one deletes it.
//
// ⚠ BOTH CLOCKS PINNED, for the reason runGeese records: the frame animates on performance.now()
// and the flock cycle runs on wall time, so pinning one leaves the half this measures free to move.
// ⚠ AND `offBirds` IS THE CONTROL THAT MAKES THE REST WORTH READING — the pixels outside the mask
// must be IDENTICAL with the flag on and off, or the change is not confined to what flies and the
// headline number is measuring the sky.
export function runGooseSky({ W = 640, H = 360, wx = 'rain', dist = 3, thresh = 10, shots = false } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__goosesky'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);

  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese,
    clouds: RENDER_TUNE.glClouds, vol: RENDER_TUNE.volClouds, air: RENDER_TUNE.glAirDepth };
  const out = { ok: false, wx };
  try {
    const A = flocksNear(900, 900, 30, 1, () => true)[0];
    if (!A) throw new Error('no flock anchor near the seed tile');
    // ⚠ THE WHOLE FLIGHT, NOT ONE INSTANT, AND TWO DRAFTS PICKED THE ANSWER BEFORE THIS ONE. Taking
    // the FIRST airborne moment measures a flock that has just left the grass at a hundredth of a
    // tile, with a field behind it and no cloud within reach — and it reported a large fix for a
    // case it was not testing. Taking the PEAK measures the opposite extreme, a flock well above the
    // camera with the deck behind rather than in front, and it reported no fix at all. Both are
    // true, both are one frame of a cycle the player watches all of, and neither is the answer. The
    // climb, the circuit and the descent are sampled evenly and the pixels are pooled.
    const moments = [];
    for (let i = 0; i < 6000; i++) {
      const t = 1e6 + i * 250;
      if (flockState(A, t).airborne) moments.push(t);
    }
    if (!moments.length) throw new Error('the anchor flock is never airborne in the search window');
    const SAMPLES = 9;
    const times = Array.from({ length: SAMPLES }, (_, i) => moments[Math.min(moments.length - 1, Math.round(i * (moments.length - 1) / (SAMPLES - 1)))]);
    out.samples = SAMPLES;

    const centre = { x: A.ax, y: A.ay + dist };
    const RR = 20, NN = RR * 2 + 1;
    const cell = (wxT, wyT) => (Math.abs(wxT - A.ax) <= 6 && Math.abs(wyT - A.ay) <= 6
      ? { kind: 'land', biome: 'parkland', flr: 0 }
      : { kind: 'land', biome: 'grass', flr: 0 });
    const map = Array.from({ length: NN }, (_, ry) => Array.from({ length: NN }, (_, rx) => cell(centre.x - RR + rx, centre.y - RR + ry)));
    const field = {
      tick: 30, bounds: { minX: centre.x - 20, maxX: centre.x + 20, minY: centre.y - 20, maxY: centre.y + 20 },
      wind: { dir: 220, kph: 18 }, baseCloud: 0.55, precipFloor: 0, floorType: 'none',
      cells: [0, 1, 2].map((i) => ({ x: centre.x + (i - 1) * 9, y: centre.y - 12 + i * 8, r: 13 - i * 2,
        vx: 0, vy: 0, type: i === 1 ? 'precip' : 'cloud', intensity: 0.9 - i * 0.1, precip: 'rain' })),
    };
    const view = { cls: 'prop', phase: 'cruise', worldBlend: 1, height: 0.08, hour: 12, weather: wx,
      speed: 0.2, resFloor: 1, map, heading: 0, mapCenter: { ...centre }, mapOffset: { x: 0, y: 0 },
      wxField: field, acX: centre.x, acY: centre.y, tune: { gl: 1, perfDS: 0 } };

    const paint = ({ geese, vol, air }) => {
      RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.glClouds = 1;
      RENDER_TUNE.geese = geese; RENDER_TUNE.volClouds = vol; RENDER_TUNE.glAirDepth = air;
      paintWindshield('__goosesky', view);   // settle every lazy bake
      paintWindshield('__goosesky', view);
      return shot();
    };
    const differs = (a, b, i) => (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) > thresh;

    let mask = 0, survBefore = 0, survAfter = 0, offBirds = 0, cards = 0, worst = null;
    const perSample = [];
    for (const t of times) {
      performance.now = () => t; Date.now = () => t;
      const birdsNoDeck = paint({ geese: 1, vol: 0, air: 0 });
      const bareNoDeck = paint({ geese: 0, vol: 0, air: 0 });
      const bareDeck = paint({ geese: 0, vol: 1, air: 0 });
      const before = paint({ geese: 1, vol: 1, air: 0 });
      const beforePng = shots ? el.toDataURL('image/png') : null;
      const after = paint({ geese: 1, vol: 1, air: 1 });
      // ⚠ READ BEFORE ANY FURTHER PAINT. `glLastFrame()` is the LAST frame, so taking it at the
      // bottom of the function reports whatever the shots repaint drew — which is a deck-off frame,
      // and `cards: 0` there reads exactly like the deck having silently stopped working.
      cards = Math.max(cards, (glLastFrame() || {}).cloudCards || 0);
      let afterPng = null, noDeckPng = null;
      if (shots) { afterPng = el.toDataURL('image/png'); paint({ geese: 1, vol: 0, air: 0 }); noDeckPng = el.toDataURL('image/png'); }

      // The mask: where a goose is, measured with nothing drawn over it.
      //
      // ⚠ TWO MASKS, AND THE SECOND ONE IS NOT PEDANTRY. The survival statistic wants the pixels a
      // goose is legible on, so it uses `thresh`. The confinement test wants the pixels a goose
      // TOUCHES, and those are not the same set: a bird is dark grey against a grey overcast, so
      // its own body can cover the sky and differ from it by almost nothing — an opaque texel that
      // writes depth and scores below the bar. Counting those as "outside the flock" reports the
      // fix leaking into the sky when what it did was remove a cloud from behind a bird you can
      // barely see. Anything the flock touched at all, grown by a pixel for the quad's rim.
      const touched = new Uint8Array(W * H);
      for (let p = 0, i = 0; i < birdsNoDeck.length; i += 4, p++) {
        if (birdsNoDeck[i] !== bareNoDeck[i] || birdsNoDeck[i + 1] !== bareNoDeck[i + 1] || birdsNoDeck[i + 2] !== bareNoDeck[i + 2]) touched[p] = 1;
      }
      const near = new Uint8Array(W * H);
      for (let p = 0; p < touched.length; p++) {
        if (!touched[p]) continue;
        const X = p % W, Y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = X + dx, ny = Y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) near[ny * W + nx] = 1;
        }
      }
      let m = 0, sb = 0, sa = 0;
      for (let p = 0, i = 0; i < birdsNoDeck.length; i += 4, p++) {
        if (differs(birdsNoDeck, bareNoDeck, i)) {
          m++;
          if (differs(before, bareDeck, i)) sb++;
          if (differs(after, bareDeck, i)) sa++;
        }
        if (!near[p] && differs(before, after, i)) offBirds++;
      }
      mask += m; survBefore += sb; survAfter += sa;
      const st = flockState(A, t);
      const row = { z: +st.z.toFixed(2), px: m, before: m ? +(sb / m * 100).toFixed(0) : null, after: m ? +(sa / m * 100).toFixed(0) : null };
      perSample.push(row);
      // The frame the deck took the most of, which is the one the report is actually about — an
      // average over a whole flight hides the moment somebody screenshots.
      // ⚠ AND IT IS THE FRAME THE SHOTS COME FROM. A fixed sample index is a coin toss: the first
      // draft shot the middle one, which in rain is a frame the flag moves nothing on, so the
      // comparison image was two identical panels of a working fix.
      if (m >= 8 && (worst == null || row.before < worst.before)) {
        worst = row;
        if (shots) { out.beforePng = beforePng; out.afterPng = afterPng; out.noDeckPng = noDeckPng; }
      }
    }
    out.perSample = perSample;
    out.worstFrame = worst;
    out.deckCards = cards;
    out.birdPx = mask;
    out.survivesBefore = mask ? +(survBefore / mask * 100).toFixed(1) : null;
    out.survivesAfter = mask ? +(survAfter / mask * 100).toFixed(1) : null;
    out.offBirds = offBirds;
    out.anchor = `${A.ax},${A.ay}`;

    if (!mask) out.verdict = 'VACUOUS — no goose reached the frame, so the scene is wrong rather than the renderer';
    else if (!out.deckCards) out.verdict = 'VACUOUS — the deck drew no cards, so there is nothing in front of anything';
    else if (offBirds) out.verdict = `LEAKED — ${offBirds} px outside the flock moved with the flag, so this is not confined to what flies`;
    else if (out.survivesAfter <= out.survivesBefore) out.verdict = 'NO CHANGE — the deck takes the same share of the flock either way';
    else out.verdict = `FIXED — ${out.survivesBefore}% of the flock survived the deck over a whole flight, ${out.survivesAfter}% does now`
      + (worst ? ` (worst frame ${worst.before}% → ${worst.after}%)` : '');
    out.ok = true;
  } finally {
    performance.now = realNow; Date.now = realDate;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.geese = was.geese;
    RENDER_TUNE.glClouds = was.clouds; RENDER_TUNE.volClouds = was.vol; RENDER_TUNE.glAirDepth = was.air;
    uninstall(); holder.remove();
  }
  console.table([out]);
  console.log('   survivesBefore/After is the share of the BIRDS OWN PIXELS still readable under the deck; offBirds must be 0.');
  return out;
}
if (typeof window !== 'undefined') window.__glGooseSky = runGooseSky;

// `__glBoardSky()`. Reported from the game as "clouds appear thru billboards", with a shot of a
// hoarding standing against an overcast and cloud puffs drawn across the middle of it.
//
// It is the goose bug one layer along, and the mechanism is the same two lines of GL state. A
// per-tile sign board goes to the DECAL layer rather than into the mesh — a board carrying `$name`
// takes its words off the TILE and a mesh is captured once per MODEL, so there is no single
// appearance to record — and that layer deliberately writes no depth ("a sign is on a wall, not a
// wall"). True of lettering on a facade; false of the one decal that is not on anything, because a
// roof hoarding stands on its own legs against the sky. So at the board's own pixels the buffer
// still held the ground far behind it, and every cloud card passed.
//
// ⚠ THE MASK IS THE FIX'S OWN FOOTPRINT, NOT "WHERE THE BUILDING IS", and that is the difference
// between this and runGooseSky. A flock is the whole subject of its frame; a hoarding is a few
// hundred pixels of a building that is otherwise mass already on the depth buffer, so a
// building-wide mask dilutes the thing being measured into noise. The footprint is the pixels that
// MOVE when the flag flips, and the question asked of each one is which truth it lands on:
//   restored — it matches the deck-off frame now, which is to say the board is back
//   other    — it matches neither, which is what a board occluding something it should not would
//              look like
// ⚠ AND `offCity` IS THE CONTROL THAT MAKES THE REST WORTH READING: a pixel of open sky must never
// be in the footprint, or this is not confined to buildings and the headline is measuring vapour.
const BOARD_SEATS = [
  { tag: 'cab, overcast', cls: 'truck', h: 0, wx: 'cloudy', hour: 13, field: CLOUD_FIELD(0.55, ['cloud', 'precip', 'cloud']) },
  { tag: 'cab, rain', cls: 'truck', h: 0, wx: 'rain', hour: 13, field: CLOUD_FIELD(0.6, ['precip', 'cloud', 'precip']) },
  { tag: 'low pass, overcast', cls: 'prop', h: 0.12, wx: 'cloudy', hour: 13, field: CLOUD_FIELD(0.55, ['cloud', 'precip', 'cloud']) },
];
export function runBoardSky({ W = 640, H = 360, thresh = 10, seats = BOARD_SEATS, shots = false, at = [2, 3], flr = 2, span = 4 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);

  // ⚠ A ROW OF NAMED TILES RATHER THAN ONE CHOSEN BUILDING. Whether a model gets a roof hoarding is
  // a seeded roll inside the derived kit, so "the subject has one" is not something a scene can
  // assert — and a `bn` is what makes the board draw at all, since a `$name` board with no name is
  // deliberately not drawn. Nine frontages at two and three storeys put several boards against the
  // sky whatever any one roll says, and an empty footprint reports VACUOUS rather than passing.
  const RR = 16, NN = RR * 2 + 1;
  const NAMES = ['THE DRY GOODS', 'OHM SWEET OHM', 'BODEGA VU', 'THE LAYOVER', 'WATTS THE DAMAGE',
    'THE TALLY', 'SECOND SKIN', 'LATHER & LYE', 'THE QUIET TRADE'];
  // ⚠ AND IT STANDS TWO TILES AWAY, WHICH IS NOT A TASTE IN FRAMING. `detailLayer` drops a part
  // whose own height projects below its DETAIL_PX floor, so the whole derived kit — every board,
  // canopy, pipe, lamp and neon run — is gone by four tiles out: glresidue measured 0 decals at 8,
  // 4, 3 and 2.5 tiles and 8 at 2. A row at five tiles is a scene with no boards in it, which this
  // reports as VACUOUS and which reads exactly like the flag doing nothing.
  const build = (withCity) => Array.from({ length: NN }, (_, y) => Array.from({ length: NN }, (_, x) => {
    if (!withCity) return { kind: 'land', biome: 'citycore', flr: 0 };
    const row = at.indexOf(RR - y);
    if (row >= 0 && x >= RR - span && x <= RR + span) {
      const i = (x - RR + span + row * 3) % NAMES.length;
      return { kind: 'land', biome: 'citycore', bt: i % 2 ? 'shop' : 'store', bn: NAMES[i],
        ent: 'south', flr: flr + (i % 2) };
    }
    return { kind: 'land', biome: 'citycore', flr: 0 };
  }));

  const realNow = performance.now.bind(performance);
  const realRandom = Math.random;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, clouds: RENDER_TUNE.glClouds,
    vol: RENDER_TUNE.volClouds, board: RENDER_TUNE.glBoardDepth };
  const rows = [];
  try {
    // Pinned, for the two reasons runLeak records: the deck drifts and the sky throws meteors, so
    // two renders of one scene differ for reasons that have nothing to do with the flag.
    performance.now = () => 1e6;
    let rngS = 0;
    Math.random = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
    for (const seat of seats) {
      const ID = '__board' + seats.indexOf(seat) + '_' + (runBoardSky.n = (runBoardSky.n || 0) + 1);
      el.id = ID;
      const view = (map) => ({ cls: seat.cls, phase: 'cruise', worldBlend: 1, height: seat.h, eyeH: 0.24,
        hour: seat.hour, weather: seat.wx, speed: 0, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
        wxField: seat.field, acX: 100, acY: 100, resFloor: 1, tune: { gl: 1, perfDS: 0 } });
      const paint = (map, opt) => {
        RENDER_TUNE.glClouds = 1; RENDER_TUNE.volClouds = opt.vol; RENDER_TUNE.glBoardDepth = opt.board;
        rngS = 12345; paintWindshield(ID, view(map));      // settle every lazy bake — see boarddepth.mjs
        rngS = 12345; paintWindshield(ID, view(map));
        return shot();
      };
      const city = build(true), bare = build(false);
      const noDeck = paint(city, { vol: 0, board: 1 });
      const noDeckPng = shots ? el.toDataURL('image/png') : null;
      const bareNoDeck = paint(bare, { vol: 0, board: 1 });
      const before = paint(city, { vol: 1, board: 0 });
      const beforePng = shots ? el.toDataURL('image/png') : null;
      const after = paint(city, { vol: 1, board: 1 });
      // ⚠ READ BEFORE ANY FURTHER PAINT — glLastFrame() is the LAST frame, and a shots repaint would
      // report a deck-off frame's `cards: 0`, which reads exactly like the deck not working.
      const cards = (glLastFrame() || {}).cloudCards || 0;
      const afterPng = shots ? el.toDataURL('image/png') : null;

      const d = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      // ⚠ NOT "DOES IT MATCH THE DECK-OFF FRAME", AND THE FIRST CUT WAS, WHICH REPORTED 2.6%. The
      // deck is not only cards: it lays a screen-space HAZE BAND and a whiteout flood over the whole
      // frame, and neither of those is depth-testable or should be. So a board the cards no longer
      // cover still does not match the frame drawn with no deck at all — it matches that board seen
      // through haze — and an equality test against it scores the fix at nearly nothing.
      // The haze is the SAME OFFSET in both frames, so it cancels in a comparison of the two: the
      // footprint already has it out, and the direction is what is left to ask. `closer` is the
      // share of the footprint where the flag moved the pixel TOWARD the board's own colour, and the
      // two means say how far — the board coming back out from under the cloud, in 0..765 per pixel.
      let foot = 0, closer = 0, offCity = 0, cityPx = 0, sumB = 0, sumA = 0;
      for (let i = 0; i < noDeck.length; i += 4) {
        const isCity = d(noDeck, bareNoDeck, i) > thresh;
        if (isCity) cityPx++;
        if (d(before, after, i) <= thresh) continue;
        foot++;
        if (!isCity) offCity++;
        const dB = d(before, noDeck, i), dA = d(after, noDeck, i);
        sumB += dB; sumA += dA;
        if (dA < dB) closer++;
      }
      const pct = foot ? closer / foot * 100 : 0;
      rows.push({ seat: seat.tag, cards, cityPx, footprintPx: foot,
        closerPct: foot ? +pct.toFixed(1) : null,
        fromBoardBefore: foot ? +(sumB / foot).toFixed(1) : null,
        fromBoardAfter: foot ? +(sumA / foot).toFixed(1) : null,
        offCityPx: offCity, beforePng, afterPng, noDeckPng,
        verdict: !cards ? 'VACUOUS — the deck drew no cards, so nothing was in front of anything'
          : !foot ? 'VACUOUS — the flag moved no pixel: no board reached this frame, or none was covered'
          : offCity ? offCity + ' px of open sky moved with the flag — this is not confined to buildings'
          : pct < 90 ? 'MIXED — only ' + pct.toFixed(1) + '% of the footprint moved toward the board'
          : 'FIXED — ' + foot + ' px, ' + pct.toFixed(1) + '% of them closer to the board, mean distance ' + (sumB / foot).toFixed(0) + ' → ' + (sumA / foot).toFixed(0) });
    }
  } finally {
    performance.now = realNow; Math.random = realRandom;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.glClouds = was.clouds;
    RENDER_TUNE.volClouds = was.vol; RENDER_TUNE.glBoardDepth = was.board;
    uninstall(); holder.remove();
  }
  console.table(rows.map((r) => ({ ...r, beforePng: undefined, afterPng: undefined, noDeckPng: undefined })));
  console.log('   footprintPx is what the flag moves; offCityPx must be 0; fromBoard* is the mean distance from the board own colour (0..765), before and after.');
  return rows;
}
if (typeof window !== 'undefined') window.__glBoardSky = runBoardSky;

// ── WHAT A FLOCK COSTS A PAINTED FRAME, WITH A REAL CONTEXT ──────────────────
//
// 'BIRD_FACE_BUDGET' was swept with framecost.mjs, which installs no GL hook and therefore paints
// every bird face as a polygon fill on a 2-D canvas. GLASS 2 is the default renderer and sends the
// same faces to gl/solids.js as triangles. Those are not the same cost and the budget was only
// ever measured as one of them, so this measures the other.
//
// ⚠ IT TIMES WITH THE REAL CLOCK WHILE THE SCENE SEES A FROZEN ONE. Both of the renderer's clocks
// have to be pinned or the flock moves between paints -- the ⚠ on BIRD_FACE_BUDGET records four
// runs of an unchanged tree disagreeing by a factor of six for exactly that reason -- but a pinned
// performance.now() is also the thing you would otherwise measure WITH. The real reference is
// captured before the override and the timing is taken through it.
//
// ⚠ AND IT REPORTS A SPREAD. Every other bench in this file does, for the reason written at
// __glFrame: the same seat has handed the occluder pre-pass an 8.4 ms cost and a 6.7 ms saving on
// consecutive runs. A difference inside the spread is not a finding.
//
// ⚠ THE FACES DRAWN ARE COUNTED, NOT ASSUMED. A budget that is not biting looks exactly like a
// budget that is free, and both report a flat line -- so each row prints what the frame actually
// painted. If 'birds' stops climbing with the budget, the scene ran out of flocks and every row
// past that point is measuring nothing.
export function runFaunaCost({ W = 640, H = 360, budgets = [700, 1400, 2800, 5600, 11200], reps = 24 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__faunacost'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese,
    bf: RENDER_TUNE.birdFaces, bg: RENDER_TUNE.birdFacesGL, res: RENDER_TUNE.resFloor };
  const out = { ok: false, rows: [] };
  try {
    const A = flocksNear(900, 900, 30, 1, () => true)[0];
    if (!A) throw new Error('no flock anchor near the seed tile');
    const centre = { x: A.ax, y: A.ay + 3 };
    // Parkland under the whole window, so the scene is as thick with flocks as the world gets.
    const RR = 20, NN = RR * 2 + 1;
    const map = Array.from({ length: NN }, () => Array.from({ length: NN }, () => ({ kind: 'land', biome: 'parkland', flr: 0 })));
    const view = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0,
      eyeH: 0.12, fovMul: 1.22, hour: 12, weather: 'clear', speed: 0, resFloor: 1,
      map, heading: 0, mapCenter: { ...centre }, mapOffset: { x: 0, y: -0.5 } };

    // A moment the anchor flock is UP, because a murmuration is an airborne thing.
    let T = 1e6;
    for (let i = 0; i < 4000; i++) { const t = 1e6 + i * 250; if (flockState(A, t).airborne) { T = t; break; } }
    performance.now = () => T; Date.now = () => T;
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.geese = was.geese || 1;

    const paint = () => paintWindshield('__faunacost', view);
    const measure = (budget, gl) => {
      RENDER_TUNE.gl = gl ? 1 : 0; RENDER_TUNE.glFloor = gl ? 1 : 0;
      RENDER_TUNE.birdFacesGL = budget; RENDER_TUNE.birdFaces = budget;
      paint(); paint();                                   // settle every lazy bake
      const before = faunaPaintCount().total;
      paint();
      const birds = faunaPaintCount().total - before;
      const ts = [];
      for (let r = 0; r < reps; r++) { const t0 = realNow(); paint(); ts.push(realNow() - t0); }
      ts.sort((a, b) => a - b);
      return { birds, med: +ts[ts.length >> 1].toFixed(2), lo: +ts[0].toFixed(2), hi: +ts[ts.length - 1].toFixed(2) };
    };
    // A zero-bird floor for each renderer, so every row can be read as a MARGINAL cost rather than
    // as a frame time that happens to contain some birds.
    RENDER_TUNE.geese = 0;
    const baseGL = measure(1400, true), baseCv = measure(1400, false);
    RENDER_TUNE.geese = was.geese || 1;
    for (const b of budgets) {
      const g = measure(b, true), c = measure(b, false);
      out.rows.push({ budget: b, birdsGL: g.birds, glMs: +(g.med - baseGL.med).toFixed(2), glSpread: g.hi - g.lo,
        birdsCanvas: c.birds, canvasMs: +(c.med - baseCv.med).toFixed(2), canvasSpread: c.hi - c.lo });
    }
    out.emptyFrame = { gl: baseGL.med, canvas: baseCv.med };
    out.ok = true;
  } finally {
    performance.now = realNow; Date.now = realDate;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.geese = was.geese;
    RENDER_TUNE.birdFaces = was.bf; RENDER_TUNE.birdFacesGL = was.bg; RENDER_TUNE.resFloor = was.res;
    uninstall(); holder.remove();
  }
  console.log('empty frame: GL ' + out.emptyFrame.gl + ' ms, canvas ' + out.emptyFrame.canvas + ' ms');
  console.table(out.rows);
  return out;
}
if (typeof window !== 'undefined') window.__faunaCost = runFaunaCost;

// ── __glFlash() — the murmuration's orientation flash, as a picture ───────────
//
// A dotted bird dims by how much wing it is presenting, so a rotating murmuration bands. The gate
// in scripts/shapes/fauna.mjs measures that (spread 0.188 at an instant, neighbours agreeing 3.6x
// better than chance); this is the same claim in pixels.
//
// ⚠ THE DIFF LOCATES THE FLOCK, AND THAT IS ALSO THE PROOF THE LOD IS LIVE. The flash only runs
// past a species' dotPx, so if the camera is close enough for meshes the two frames are identical
// and there is nothing to crop to. An empty diff is a failed setup, never a flat-looking flock.
//
// ⚠ IT MUST BE A SONGBIRD, which is a property of the GROUND rather than something to ask for:
// speciesAt hashes the tile among whatever lives on that biome, so the anchor is SEARCHED for
// rather than set. A goose skein is a dozen birds in a line and has no murmuration to photograph.
//
// ⚠ AND THE FRAMES ARE SPACED IN TIME, because one frame shows a flock with light and dark
// patches in it and could be a flock of two colours. What says it is a FLASH is the bands moving.
export function runFlash({ W = 900, H = 520, frames = 4, stepMs = 900, dist = 5, zoom = 6, SETTLE = 40 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__flashbench'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  const realNow = performance.now.bind(performance), realDate = Date.now, realRnd = Math.random;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese,
    flash: RENDER_TUNE.faunaFlash, res: RENDER_TUNE.resFloor, ds: RENDER_TUNE.perfDS };
  const out = { ok: false, shots: [], notes: [] };
  try {
    // Open citycore ground: placeOf hands back the biome untouched when no building stands on the
    // tile, so the species table answers for a street without a street in the way of the sky.
    const RR = 26, NN = RR * 2 + 1;
    const cell = () => ({ kind: 'land', biome: 'citycore', flr: 0 });
    const map = Array.from({ length: NN }, () => Array.from({ length: NN }, cell));
    const habitat = (wx, wy) => speciesAt('citycore', wx, wy) || false;

    let A = null;
    for (const f of flocksNear(900, 900, 24, 1, habitat)) if (f.sp === 'songbird') { A = f; break; }
    if (!A) throw new Error('no songbird flock within 24 tiles of the seed');
    out.notes.push('anchor ' + A.ax + ',' + A.ay + ' songbird, ' + flockSize(A) + ' birds');

    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.geese = was.geese || 1;
    RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0;

    // A moment the flock is up AND OPEN.
    //
    // ⚠ THE FIRST AIRBORNE INSTANT IS TAKE-OFF, WHICH IS NOT A MURMURATION. `airborne` turns true
    // the moment the birds leave the ground, where the cloud's radius is still ~0.005 tiles and all
    // 546 of them are inside a couple of pixels: the flash is working perfectly and there is
    // nothing on screen wide enough to see it in. Searching for the widest moment instead gives
    // r 2.4 and z 1.4 -- an actual ball of birds over the street. The first cut of this bench took
    // the first true and reported four identical frames, which reads exactly like a dead feature.
    let T0 = 0, bestR = -1;
    for (let i = 0; i < 40000; i++) {
      const t = 1e6 + i * 250, st = flockState(A, t);
      if (st.airborne && st.r > bestR) { bestR = st.r; T0 = t; }
    }
    if (!T0) throw new Error('the anchor flock is never airborne in the window searched');
    out.notes.push('widest at t=' + T0 + ', radius ' + bestR.toFixed(2) + ' tiles');

    const view = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0,
      eyeH: 0.12, fovMul: 1.0, hour: 11, weather: 'clear', speed: 0, resFloor: 1,
      map, heading: 0, mapCenter: { x: A.ax, y: A.ay + dist }, mapOffset: { x: 0, y: -0.5 } };

    // ⚠ A PINNED CLOCK GIVES A MURMURATION NO VELOCITY, AND THE FLASH THEN CORRECTLY READS ZERO.
    // Every bench in this file freezes performance.now so a drifting sky is not mistaken for a
    // finding, and for a boids cloud that is exactly wrong: murmur() integrates on dt, so at a
    // single instant it hands back its SEEDED points with vx = vy = 0, every heading is
    // atan2(0, 0) = 0, every bird is broadside, and dim is 1 for all of them. Measured that way:
    // air dim min 1, max 1, mean 1 over 546 birds, against walk 0.42-1.0 -- the walking flock
    // flashing while the murmuration sat there, which reads exactly like a feature that does not
    // reach the thing it was built for. Same trap as settleFade and for the same reason.
    //
    // ⚠ SO THE CLOUD IS FLOWN BEFORE IT IS PHOTOGRAPHED. The clock advances for SETTLE frames at
    // a real frame interval, which is what gives the boids a velocity to have a heading from; the
    // pair of captures then happens at ONE instant, where dt is 0 and the cloud cannot drift
    // between the two exposures. Pinned and settled, rather than pinned or live.
    const step = (t) => { performance.now = () => t; Date.now = () => t; paintWindshield('__flashbench', view); };
    const settle = (t0) => { for (let i = SETTLE; i > 0; i--) step(t0 - i * 33); };
    const grab = (t, flash) => {
      let s = 0x2545f49; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      RENDER_TUNE.faunaFlash = flash;
      performance.now = () => t; Date.now = () => t;
      paintWindshield('__flashbench', view); paintWindshield('__flashbench', view);
      return el.getContext('2d').getImageData(0, 0, W, H);
    };

    for (let i = 0; i < frames; i++) {
      const t = T0 + i * stepMs;
      settle(t);                                    // fly the cloud up to this instant
      const on = grab(t, 1), off = grab(t, 0);
      // The flock is exactly the set of pixels the flash moved.
      let x0 = W, y0 = H, x1 = -1, y1 = -1, moved = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        const d = Math.abs(on.data[k] - off.data[k]) + Math.abs(on.data[k+1] - off.data[k+1]) + Math.abs(on.data[k+2] - off.data[k+2]);
        if (d > 6) { moved++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { out.notes.push('frame ' + i + ': the two renders are identical -- the flock is drawn as MESHES at this distance, so raise dist'); continue; }
      const pad = 12;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

      const shot = (img, label) => {
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        c.getContext('2d').putImageData(img, -x0, -y0);
        const z = document.createElement('canvas'); z.width = cw * zoom; z.height = ch * zoom;
        const zc = z.getContext('2d'); zc.imageSmoothingEnabled = false;
        zc.drawImage(c, 0, 0, cw * zoom, ch * zoom);
        zc.font = '600 13px system-ui,sans-serif'; zc.fillStyle = 'rgba(0,0,0,.66)';
        zc.fillRect(0, 0, 148, 20); zc.fillStyle = '#fff'; zc.fillText(label, 7, 14);
        return z.toDataURL('image/png');
      };
      out.shots.push({ t, moved, box: [x0, y0, cw, ch],
        on: shot(on, 'flash on  t+' + (i * stepMs) + 'ms'), off: shot(off, 'flash OFF  t+' + (i * stepMs) + 'ms') });
    }
    out.ok = out.shots.length > 0;
  } finally {
    performance.now = realNow; Date.now = realDate; Math.random = realRnd;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.geese = was.geese;
    RENDER_TUNE.faunaFlash = was.flash; RENDER_TUNE.resFloor = was.res; RENDER_TUNE.perfDS = was.ds;
    uninstall(); holder.remove();
  }
  for (const n of out.notes) console.log(n);
  for (const s of out.shots) console.log('t=' + s.t + '  ' + s.moved + ' px moved, flock box ' + s.box.join(','));
  return out;
}
if (typeof window !== 'undefined') window.__glFlash = runFlash;

/**
 * What a stoop does to the shape of a murmuration.
 *
 * ⚠ THE BENCH EXISTS BECAUSE THE FEATURE WAS SILENTLY OFF. `hawkStoop` returned the prey flock's
 * ANCHOR TILE as the stoop point, and an airborne flock sits a median 2.4 tiles from its anchor,
 * while `murmur` pushes birds out of a Gaussian bubble of radius SCARE_R = 1.15. The push reaching
 * the birds was 1.3% of full strength, so the hawk dived at empty sky next door and the cloud never
 * moved -- the shape with the scare and the shape without it differed by ~4%, which is what a dead
 * feature measures like. Nothing threw, nothing logged, and the wave still crossed the cloud, so
 * the one visible half of the effect went on working and hid the other.
 *
 * ⚠ SO IT PHOTOGRAPHS ONE MOMENT TWICE, not two moments. `RENDER_TUNE.faunaScare` is the A/B: a
 * stoop is three seconds long and a murmuration changes shape continuously on its own, so two
 * frames a second apart differ whatever the hawk is doing. Same instant, same seeded dice, one
 * knob -- and then every pixel of difference IS the predator.
 */
export function runStoop({ W = 900, H = 520, ages = [0.4, 0.9, 1.5, 2.2], zoom = 5, SETTLE = 120,
                          dist = 4, eyeH = 1.1 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__stoopbench'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  const realNow = performance.now.bind(performance), realDate = Date.now, realRnd = Math.random;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese,
    scare: RENDER_TUNE.faunaScare, res: RENDER_TUNE.resFloor, ds: RENDER_TUNE.perfDS };
  const out = { ok: false, shots: [], notes: [] };
  try {
    const RR = 30, NN = RR * 2 + 1;
    const cell = () => ({ kind: 'land', biome: 'citycore', flr: 0 });
    const map = Array.from({ length: NN }, () => Array.from({ length: NN }, cell));
    const habitat = (wx, wy) => speciesAt('citycore', wx, wy) || false;
    const anchors = flocksNear(900, 900, RR, 1, habitat);
    const hawks = anchors.filter((f) => f.sp === 'hawk');
    if (!hawks.length) throw new Error('no hawk within ' + RR + ' tiles of the seed');

    // ⚠ A STOOP IS RARE AND MOST OF THEM ARE AT A FLOCK STILL ON THE GROUND, which has no shape
    // to disturb. Scan for one whose prey is airborne AND open (r > 1.5), the same test runFlash
    // makes for the flash -- a cloud 0.005 tiles wide is a take-off, not a murmuration.
    let found = null;
    for (let i = 0; i < 200000 && !found; i++) {
      const now = 1e6 + i * 200;
      for (const h of hawks) {
        const st = hawkStoop(h, now, anchors);
        if (!st) continue;
        const ps = flockState(st.prey, now);
        if (!ps.airborne || ps.r < 1.5) continue;
        found = { at: st.at, prey: st.prey, hawk: h, hit: st.hit };
        break;
      }
    }
    if (!found) throw new Error('no stoop at an airborne flock in the scanned window');
    out.notes.push('hawk ' + found.hawk.ax + ',' + found.hawk.ay + ' stoops at '
      + found.prey.ax + ',' + found.prey.ay + ' (' + flockSize(found.prey) + ' birds), '
      + (found.hit ? 'and takes one' : 'and misses'));

    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.geese = was.geese || 1;
    RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0;

    // The camera is placed off the flock's own centre AT THE STOOP, not off its anchor -- the two
    // are the 2.4 tiles this whole bug was about, and framing on the anchor puts the birds in the
    // corner. mapCenter is a TILE and integer by contract, so it is rounded.
    const c0 = flockState(found.prey, found.at);
    const view = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0,
      eyeH, fovMul: 1.0, hour: 11, weather: 'clear', speed: 0, resFloor: 1, map,
      heading: 0, mapCenter: { x: Math.round(c0.cx), y: Math.round(c0.cy + dist) },
      mapOffset: { x: 0, y: 0 } };

    const step = (t) => { performance.now = () => t; Date.now = () => t; paintWindshield('__stoopbench', view); };
    const grab = (t, scare) => {
      let s2 = 0x2545f49; Math.random = () => { s2 = (s2 * 1103515245 + 12345) & 0x7fffffff; return s2 / 0x7fffffff; };
      RENDER_TUNE.faunaScare = scare;
      // ⚠ FLOWN FROM BEFORE THE STOOP, EVERY TIME, or the two exposures are not of one flock.
      // The cloud is a boids integrator: where it is at t depends on every frame since it took
      // off, so the control has to be re-flown with the knob down rather than reusing the state
      // the scared run left behind. Same reason runFlash settles before each pair.
      for (let i = SETTLE; i > 0; i--) step(t - i * 33);
      performance.now = () => t; Date.now = () => t;
      paintWindshield('__stoopbench', view); paintWindshield('__stoopbench', view);
      return el.getContext('2d').getImageData(0, 0, W, H);
    };

    for (const age of ages) {
      const t = found.at + age * 1000;
      const on = grab(t, 1), off = grab(t, 0);
      let x0 = W, y0 = H, x1 = -1, y1 = -1, moved = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        const d = Math.abs(on.data[k] - off.data[k]) + Math.abs(on.data[k+1] - off.data[k+1]) + Math.abs(on.data[k+2] - off.data[k+2]);
        if (d > 6) { moved++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { out.notes.push('age ' + age + 's: the two renders are IDENTICAL -- the scare is reaching nothing'); continue; }
      const pad = 14;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const shot = (img, label) => {
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        c.getContext('2d').putImageData(img, -x0, -y0);
        const z = document.createElement('canvas'); z.width = cw * zoom; z.height = ch * zoom;
        const zc = z.getContext('2d'); zc.imageSmoothingEnabled = false;
        zc.drawImage(c, 0, 0, cw * zoom, ch * zoom);
        zc.font = '600 13px system-ui,sans-serif'; zc.fillStyle = 'rgba(0,0,0,.66)';
        zc.fillRect(0, 0, 210, 20); zc.fillStyle = '#fff'; zc.fillText(label, 7, 14);
        return z.toDataURL('image/png');
      };
      out.shots.push({ age, moved, box: [x0, y0, cw, ch],
        on: shot(on, 'hawk t+' + age + 's'), off: shot(off, 'no stoop t+' + age + 's') });
    }
    out.ok = out.shots.length > 0;
  } finally {
    performance.now = realNow; Date.now = realDate; Math.random = realRnd;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.geese = was.geese;
    RENDER_TUNE.faunaScare = was.scare; RENDER_TUNE.resFloor = was.res; RENDER_TUNE.perfDS = was.ds;
    uninstall(); holder.remove();
  }
  for (const n of out.notes) console.log(n);
  for (const s2 of out.shots) console.log('t+' + s2.age + 's  ' + s2.moved + ' px moved, box ' + s2.box.join(','));
  return out;
}
if (typeof window !== 'undefined') window.__glStoop = runStoop;

/**
 * Does a murmuration ever band into dark stripes, and what makes them?
 *
 * ⚠ THE QUESTION IS ABOUT PIXELS, SO IT IS MEASURED IN PIXELS. Every other fauna instrument here
 * reads the point cloud -- `murmurStats`, the proportions in 1j, the flash spread in 1h -- and a
 * flock can be perfectly banded in 3-D and read as an even smear on screen, or look striped because
 * two even layers overlap along the line of sight. What a player sees is ink on the sky.
 *
 * ⚠ THE BACKGROUND IS ESTIMATED, NOT ASSUMED. The sky is a vertical gradient with clouds in it,
 * so "darker than some constant" finds the cloud edges as readily as the birds. A grayscale CLOSING
 * (max filter then min filter) at a radius larger than a bird removes dark specks and keeps the
 * gradient and the clouds, so `close - lum` is the bird ink and nothing else -- checked by the ink
 * outside the flock box, which has to come back at roughly zero.
 *
 * ⚠ AND IT IS READ AGAINST THE FLASH RATHER THAN AGAINST NOTHING. A profile with structure in it
 * is not news on its own: a finite number of specks is lumpy, and the lumpiness of a random
 * scatter is exactly what a band has to beat. Rendering the same instant with `faunaFlash` down
 * leaves the DENSITY banding alone and removes the orientation banding, so the pair says which of
 * the two is doing the work rather than just that something is.
 */
export function runBands({ W = 900, H = 520, dist = 5, eyeH = 0.6, SETTLE = 120,
                          samples = 14, stepFrames = 24, zoom = 3, stoop = false, binPx = 8,
                          skyFrac = 0.42 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__bandbench'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  const realNow = performance.now.bind(performance), realDate = Date.now, realRnd = Math.random;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese,
    flash: RENDER_TUNE.faunaFlash, scare: RENDER_TUNE.faunaScare, res: RENDER_TUNE.resFloor, ds: RENDER_TUNE.perfDS };
  const out = { ok: false, rows: [], notes: [], shots: [] };
  try {
    const RR = 30, NN = RR * 2 + 1;
    const cell = () => ({ kind: 'land', biome: 'citycore', flr: 0 });
    const map = Array.from({ length: NN }, () => Array.from({ length: NN }, cell));
    const habitat = (wx, wy) => speciesAt('citycore', wx, wy) || false;
    const anchors = flocksNear(900, 900, RR, 1, habitat);

    // The biggest songbird flock in reach -- banding is a crowd effect and a hundred birds cannot
    // show one however they are arranged.
    let A = null;
    for (const f of anchors) if (f.sp === 'songbird' && (!A || flockSize(f) > flockSize(A))) A = f;
    if (!A) throw new Error('no songbird flock within ' + RR + ' tiles of the seed');

    // ⚠ THE START IS A MOMENT THE CLOUD IS OPEN, not the first airborne instant, which is a
    // take-off 0.005 tiles wide. Same trap runFlash records.
    let T0 = 0, bestR = -1, ev = null;
    if (stoop) {
      const hawks = anchors.filter((f) => f.sp === 'hawk');
      for (let i = 0; i < 200000 && !ev; i++) {
        const now = 1e6 + i * 200;
        for (const h of hawks) {
          const st = hawkStoop(h, now, anchors);
          if (!st) continue;
          const ps = flockState(st.prey, now);
          if (!ps.airborne || ps.r < 1.5) continue;
          ev = { at: st.at, prey: st.prey }; break;
        }
      }
      if (!ev) throw new Error('no stoop at an airborne flock in the scanned window');
      A = ev.prey; T0 = ev.at;
      out.notes.push('stooped at ' + A.ax + ',' + A.ay + ' (' + flockSize(A) + ' birds); sampling the 3s wave');
    } else {
      for (let i = 0; i < 40000; i++) {
        const t = 1e6 + i * 250, st = flockState(A, t);
        if (st.airborne && st.r > bestR) { bestR = st.r; T0 = t; }
      }
      if (!T0) throw new Error('the flock is never airborne in the window');
      out.notes.push('ordinary flight at ' + A.ax + ',' + A.ay + ' (' + flockSize(A) + ' birds)');
    }

    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.geese = was.geese || 1;
    RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0; RENDER_TUNE.faunaScare = 1;

    const c0 = flockState(A, T0);
    const view = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0,
      eyeH, fovMul: 1.0, hour: 11, weather: 'clear', speed: 0, resFloor: 1, map,
      heading: 0, mapCenter: { x: Math.round(c0.cx), y: Math.round(c0.cy + dist) },
      mapOffset: { x: 0, y: 0 } };

    const paint = (t) => { performance.now = () => t; Date.now = () => t; paintWindshield('__bandbench', view); };

    // ── the ink ──────────────────────────────────────────────────────────────
    // ⚠ ABOVE THE HORIZON ONLY, AND THE FIRST CUT CUT IT TOO LOW. The flock has to be read against
    // SKY: below the horizon the ground carries walking birds, scatter and a terrain edge, and the
    // blob-keep happily locks onto the grounded half of the same flock -- which is a genuine lump of
    // ink, is bigger than the airborne one, and bands beautifully in perspective. Measured that way
    // a landed flock scored 0.567 against an airborne 0.108, which is the instrument reading the
    // wrong birds rather than a finding about murmurations.
    const SKY = Math.floor(H * skyFrac);
    const RAD = 6;                            // bigger than a bird, smaller than a cloud
    const lum = new Float32Array(W * SKY);
    const tmp = new Float32Array(W * SKY);
    const bg  = new Float32Array(W * SKY);
    const ink = new Float32Array(W * SKY);
    const passH = (src, dst, r, max) => {
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        let v = max ? -1e9 : 1e9;
        const a = Math.max(0, x - r), b = Math.min(W - 1, x + r);
        for (let k = a; k <= b; k++) { const q = src[y * W + k]; if (max ? q > v : q < v) v = q; }
        dst[y * W + x] = v;
      }
    };
    const passV = (src, dst, r, max) => {
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        let v = max ? -1e9 : 1e9;
        const a = Math.max(0, y - r), b = Math.min(SKY - 1, y + r);
        for (let k = a; k <= b; k++) { const q = src[k * W + x]; if (max ? q > v : q < v) v = q; }
        dst[y * W + x] = v;
      }
    };
    let FRAME = null;
    const putFrame = (img) => { FRAME = img; };
    const inkify = () => {
      const d = (FRAME || el.getContext('2d').getImageData(0, 0, W, SKY)).data;
      for (let i = 0; i < W * SKY; i++) lum[i] = 0.3 * d[i * 4] + 0.6 * d[i * 4 + 1] + 0.1 * d[i * 4 + 2];
      passH(lum, tmp, RAD, true);  passV(tmp, bg, RAD, true);     // dilate: specks gone
      passH(bg, tmp, RAD, false);  passV(tmp, bg, RAD, false);    // erode: bright edges back
      for (let i = 0; i < W * SKY; i++) { const v = bg[i] - lum[i]; ink[i] = v > 4 ? v : 0; }
    };

    // ── the profile ──────────────────────────────────────────────────────────
    // ⚠ ONLY THE FLOCK, AND THE FIRST CUT OF THIS FORGOT TO SAY SO. `ink` is every dark speck
    // above the cut line, and at an eye height that frames a murmuration the horizon is halfway up
    // the frame -- so ground birds, the far shore and the terrain edge all landed in the profile and
    // showed up as structure. They are not part of the flock and they do not move with it, which is
    // the worst kind of contaminant: it is STABLE, so it reads as a persistent band.
    //
    // The flock is the biggest connected lump of ink. Binned coarse so a gap between two birds does
    // not cut it in half, then flood-filled from the densest cell.
    const CELL = 12;
    const keepBlob = () => {
      const gw = Math.ceil(W / CELL), gh = Math.ceil(SKY / CELL);
      const g = new Float32Array(gw * gh);
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        const v = ink[y * W + x]; if (v) g[((y / CELL) | 0) * gw + ((x / CELL) | 0)] += v;
      }
      let seed = 0, best = 0;
      for (let i = 0; i < g.length; i++) if (g[i] > best) { best = g[i]; seed = i; }
      if (!best) return;
      const lim = best * 0.06, keep = new Uint8Array(g.length), st = [seed];
      keep[seed] = 1;
      while (st.length) {
        const i = st.pop(), cx2 = i % gw, cy2 = (i / gw) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx2 + dx, ny = cy2 + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const k = ny * gw + nx;
          if (keep[k] || g[k] < lim) continue;
          keep[k] = 1; st.push(k);
        }
      }
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        if (!keep[((y / CELL) | 0) * gw + ((x / CELL) | 0)]) ink[y * W + x] = 0;
      }
    };

    const analyse = () => {
      let m = 0, mx = 0, my = 0;
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        const w = ink[y * W + x]; if (!w) continue; m += w; mx += w * x; my += w * y;
      }
      if (m < 500) return null;
      mx /= m; my /= m;
      let xx = 0, yy = 0, xy = 0;
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        const w = ink[y * W + x]; if (!w) continue;
        const a = x - mx, b = y - my; xx += w * a * a; yy += w * b * b; xy += w * a * b;
      }
      xx /= m; yy /= m; xy /= m;
      const th = 0.5 * Math.atan2(2 * xy, xx - yy);
      const axes = [{ c: Math.cos(th), s: Math.sin(th) }, { c: -Math.sin(th), s: Math.cos(th) }];
      const best = { strength: -1 };
      for (let ai = 0; ai < 2; ai++) {
        const { c, s: sn } = axes[ai];
        let lo = 1e9, hi = -1e9;
        for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
          if (!ink[y * W + x]) continue;
          const u = (x - mx) * c + (y - my) * sn;
          if (u < lo) lo = u; if (u > hi) hi = u;
        }
        const span = hi - lo; if (span < 24) continue;
        const N = Math.max(10, Math.min(90, Math.round(span / binPx)));
        const prof = new Float64Array(N);
        for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
          const w = ink[y * W + x]; if (!w) continue;
          const u = (x - mx) * c + (y - my) * sn;
          const k = Math.min(N - 1, Math.max(0, Math.floor((u - lo) / span * N)));
          prof[k] += w;
        }
        // Envelope: the shape of the flock. Residual: the banding on top of it.
        const sig = N / 5, envl = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          let acc = 0, wsum = 0;
          for (let k = 0; k < N; k++) {
            const g = Math.exp(-Math.pow((k - i) / sig, 2));
            acc += g * prof[k]; wsum += g;
          }
          envl[i] = acc / wsum;
        }
        let rms = 0, mean = 0;
        for (let i = 0; i < N; i++) { const r = prof[i] - envl[i]; rms += r * r; mean += envl[i]; }
        rms = Math.sqrt(rms / N); mean /= N;
        const strength = mean > 0 ? rms / mean : 0;
        // A band is a run on one side of the envelope that is worth seeing, so count crossings
        // of a threshold rather than every sign flip, which speckle alone would fill.
        let bands = 0, sgn = 0;
        for (let i = 0; i < N; i++) {
          const r = prof[i] - envl[i];
          const t2 = Math.abs(r) > 0.6 * rms ? Math.sign(r) : 0;
          if (t2 && t2 !== sgn) { if (t2 < 0) bands++; sgn = t2; }
        }
        if (strength > best.strength) Object.assign(best, { strength, bands, axis: ai ? 'across' : 'along', N, prof: Array.from(prof), envl: Array.from(envl), mx, my });
      }
      return best.strength >= 0 ? best : null;
    };

    const shoot = (t, flash) => {
      let s2 = 0x2545f49; Math.random = () => { s2 = (s2 * 1103515245 + 12345) & 0x7fffffff; return s2 / 0x7fffffff; };
      RENDER_TUNE.faunaFlash = flash;
      paint(t); paint(t);
      return el.getContext('2d').getImageData(0, 0, W, SKY);
    };

    // ⚠ THE FLOCK IS FOUND BY WHAT THE FLASH MOVES, NEVER BY WHAT IS DARKEST. `keepBlob` took the
    // densest lump of ink in the sky, and the densest dark thing on this canvas is the HUD -- the
    // CLEAR button in the top corner is solid chrome, far denser than any number of birds, and it is
    // in EXACTLY the same place in every frame. So the bench locked onto it and reported an
    // identical 0.108 for every moment of every flight, at two different seats, with the flock
    // filling the frame or absent from it. A reading that never changes is not a stable measurement,
    // it is a measurement of something that never changes.
    //
    // Flipping `faunaFlash` moves birds and moves nothing else, so the difference between the pair
    // is the flock and only the flock. runFlash locates its crop the same way for the same reason.
    const findFlock = (on, off) => {
      let x0 = W, y0 = SKY, x1 = -1, y1 = -1;
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        const d = Math.abs(on.data[k] - off.data[k]) + Math.abs(on.data[k+1] - off.data[k+1]) + Math.abs(on.data[k+2] - off.data[k+2]);
        if (d > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) return null;
      const pad = 10;
      return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad),
               x1: Math.min(W - 1, x1 + pad), y1: Math.min(SKY - 1, y1 + pad) };
    };

    const measure = (img, box) => {
      putFrame(img);
      inkify();
      for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
        if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) ink[y * W + x] = 0;
      }
      keepBlob();
      return analyse();
    };

    // Flown once and then sampled as it goes: the cloud is an integrator and re-settling per
    // sample would photograph fourteen different flocks rather than one flight.
    for (let i = SETTLE; i > 0; i--) paint(T0 - i * 33);
    let bestShot = null;
    for (let i = 0; i < samples; i++) {
      const t = T0 + i * stepFrames * 33;
      for (let k = 0; k < stepFrames; k++) paint(T0 + (i * stepFrames + k) * 33);
      const imgOn = shoot(t, 1), imgOff = shoot(t, 0);
      const box = findFlock(imgOn, imgOff);
      if (!box) { out.notes.push('t+' + Math.round(t - T0) + 'ms: the flash moved nothing, so the flock could not be located'); continue; }
      const on = measure(imgOn, box), off = measure(imgOff, box);
      if (!on) continue;
      // ⚠ THE NUMBER TO BEAT IS SPECKLE, NOT ZERO. A finite scatter of independent specks is
      // already lumpy: with m birds in a bin the count wobbles by sqrt(m), so a profile of N bins
      // over B birds shows a residual of 1/sqrt(B/N) of the mean with NO structure in the flock at
      // all. A band is only a band if it beats that, and at these bird counts it is a large number --
      // which is why the first cut of this bench reported 'banding' of 1.2 on a flock that is
      // visibly an even smear.
      const speckle = Math.sqrt(on.N / Math.max(1, flockSize(A)));
      const row = { t: Math.round(t - T0), on: +on.strength.toFixed(3), bands: on.bands,
        speckle: +speckle.toFixed(3), excess: +(on.strength / speckle).toFixed(2),
        axis: on.axis, off: off ? +off.strength.toFixed(3) : null };
      out.rows.push(row);
      if (!bestShot || on.strength > bestShot.strength) {
        RENDER_TUNE.faunaFlash = 1; paint(t); paint(t);
        const shotOn = el.getContext('2d').getImageData(0, 0, W, H);
        RENDER_TUNE.faunaFlash = 0; paint(t); paint(t);
        const shotOff = el.getContext('2d').getImageData(0, 0, W, H);
        RENDER_TUNE.faunaFlash = 1;
        bestShot = { strength: on.strength, t, img: shotOn, imgOff: shotOff, a: on, box };
      }
    }

    if (bestShot) {
      const a = bestShot.a;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').putImageData(bestShot.img, 0, 0);
      // Cropped to the flock the flash located, so the picture is of the birds rather than of a
      // field with some birds in the corner of it.
      const bx = bestShot.box, cw = bx.x1 - bx.x0 + 1, ch = bx.y1 - bx.y0 + 1;
      const z = document.createElement('canvas'); z.width = cw * zoom; z.height = ch * zoom;
      const zc = z.getContext('2d'); zc.imageSmoothingEnabled = false;
      zc.drawImage(c, bx.x0, bx.y0, cw, ch, 0, 0, cw * zoom, ch * zoom);
      const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
      c2.getContext('2d').putImageData(bestShot.imgOff, 0, 0);
      const z2 = document.createElement('canvas'); z2.width = cw * zoom; z2.height = ch * zoom;
      const zc2 = z2.getContext('2d'); zc2.imageSmoothingEnabled = false;
      zc2.drawImage(c2, bx.x0, bx.y0, cw, ch, 0, 0, cw * zoom, ch * zoom);
      out.shots.push({ label: 'strongest banding', png: z.toDataURL('image/png'), pngOff: z2.toDataURL('image/png'),
        strength: +a.strength.toFixed(3), bands: a.bands, axis: a.axis,
        prof: a.prof, envl: a.envl });
    }
    out.ok = out.rows.length > 0;
  } finally {
    performance.now = realNow; Date.now = realDate; Math.random = realRnd;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.geese = was.geese;
    RENDER_TUNE.faunaFlash = was.flash; RENDER_TUNE.faunaScare = was.scare;
    RENDER_TUNE.resFloor = was.res; RENDER_TUNE.perfDS = was.ds;
    uninstall(); holder.remove();
  }
  for (const n of out.notes) console.log(n);
  for (const r of out.rows) console.log('t+' + r.t + 'ms  band ' + r.on + ' (flash off ' + r.off + ')  ' + r.bands + ' dark bands, ' + r.axis);
  return out;
}
if (typeof window !== 'undefined') window.__glBands = runBands;

/**
 * What a murmuration costs the WHOLE frame, against how many birds are actually in it.
 *
 * ⚠ THE BOIDS STEP IS NOT THE ANSWER, ONLY THE HALF THAT IS EASY TO TIME. That step is pure JS
 * and can be benched in node; the other half is faces, and 3,200 birds is 176,000 of them. Deciding
 * a bird count off the simulation cost alone is how the face budget stops being the thing that
 * bounds the frame.
 *
 * ⚠ SO THE CLOCK IS PINNED FOR THE SCENE AND REAL FOR THE STOPWATCH. Every other bench here pins
 * performance.now so a drifting sky is not read as a finding, and that also makes the renderer's own
 * profiler report zero elapsed -- which is why `perfSnapshot` comes back empty inside one. The scene
 * clock is advanced by hand at a frame interval so the boids integrate properly, and the elapsed
 * time is taken from a saved reference to the REAL one.
 *
 * ⚠ AND THE BIRD COUNT IS MOVED WITH THE BUDGET, NOT WITH maxFlock. `st.n` is thinned to fit
 * `birdFacesGL` before it ever reaches murmur(), so the budget is what actually decides how many
 * birds exist in a frame; raising maxFlock past the share simply crowds out the next flock.
 */
export function runBirds({ W = 640, H = 360, budgets = [55000, 93500, 165000, 220000, 293000, 400000],
                          warm = 50, frames = 45, dist = 3, eyeH = 0.12 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__birdbench'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  const realNow = performance.now.bind(performance);
  const realDate = Date.now, realRnd = Math.random;
  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese,
    bg: RENDER_TUNE.birdFacesGL, res: RENDER_TUNE.resFloor, ds: RENDER_TUNE.perfDS };
  const out = { ok: false, rows: [], notes: [] };
  try {
    const RR = 30, NN = RR * 2 + 1;
    const cell = () => ({ kind: 'land', biome: 'citycore', flr: 0 });
    const map = Array.from({ length: NN }, () => Array.from({ length: NN }, cell));
    const habitat = (wx, wy) => speciesAt('citycore', wx, wy) || false;
    const anchors = flocksNear(900, 900, RR, 1, habitat);
    let A = null;
    for (const f of anchors) if (f.sp === 'songbird' && (!A || flockSize(f) > flockSize(A))) A = f;
    if (!A) throw new Error('no songbird flock within ' + RR + ' tiles of the seed');

    let T0 = 0, bestR = -1;
    for (let i = 0; i < 40000; i++) {
      const t = 1e6 + i * 250, st = flockState(A, t);
      if (st.airborne && st.r > bestR) { bestR = st.r; T0 = t; }
    }
    out.notes.push('flock ' + A.ax + ',' + A.ay + ' holds ' + flockSize(A) + ' birds at full size');

    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.geese = 1;
    RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0;

    const c0 = flockState(A, T0);
    const view = { cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0,
      eyeH, fovMul: 1.0, hour: 11, weather: 'clear', speed: 0, resFloor: 1, map,
      heading: 0, mapCenter: { x: Math.round(c0.cx), y: Math.round(c0.cy + dist) },
      mapOffset: { x: 0, y: 0 } };

    // A control with no birds at all, so the bird cost is a DIFFERENCE rather than a frame time.
    const measure = (budget, geese) => {
      RENDER_TUNE.birdFacesGL = budget; RENDER_TUNE.geese = geese;
      murmurReset();
      let t = T0 - warm * 16.7;
      let sd = 0x2545f49;
      Math.random = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
      const step = () => { performance.now = () => t; Date.now = () => t; paintWindshield('__birdbench', view); t += 16.7; };
      for (let i = 0; i < warm; i++) step();
      const runs = [];
      for (let r = 0; r < 3; r++) {
        const a = realNow();
        for (let i = 0; i < frames; i++) step();
        runs.push((realNow() - a) / frames);
      }
      runs.sort((x, y) => x - y);
      const birds = murmurStats ? murmurStats().birds : 0;
      Math.random = realRnd;
      return { ms: runs[1], birds };
    };

    const base = measure(165000, 0);
    out.notes.push('empty sky: ' + base.ms.toFixed(2) + ' ms a frame');
    for (const b of budgets) {
      const m = measure(b, 1);
      out.rows.push({ budget: b, birds: m.birds, ms: +m.ms.toFixed(2),
        overEmpty: +(m.ms - base.ms).toFixed(2),
        usPerBird: m.birds ? +((m.ms - base.ms) / m.birds * 1000).toFixed(2) : null,
        fps: +(1000 / m.ms).toFixed(0) });
    }
    out.ok = true;
  } finally {
    performance.now = realNow; Date.now = realDate; Math.random = realRnd;
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.geese = was.geese;
    RENDER_TUNE.birdFacesGL = was.bg; RENDER_TUNE.resFloor = was.res; RENDER_TUNE.perfDS = was.ds;
    uninstall(); holder.remove();
  }
  for (const n of out.notes) console.log(n);
  for (const r of out.rows) console.log(r.budget + ' faces -> ' + r.birds + ' birds, ' + r.ms + ' ms (+' + r.overEmpty + ' over empty), ' + r.fps + ' fps');
  return out;
}
if (typeof window !== 'undefined') window.__glBirds = runBirds;

/**
 * The flight sim, flown at a murmuration, measured by the renderer's own profiler.
 *
 * ⚠ THE CLOCK IS REAL HERE, AND THAT IS THE WHOLE POINT. Every other bench in this file pins
 * `performance.now` so a drifting sky is not read as a finding -- and `setWindshieldProfiler` reads
 * that same clock, so inside one of those benches every phase measures zero elapsed and
 * `perfSnapshot` comes back with `frames: 0`. That was read as "the profiler cannot work in a
 * hidden pane", which is wrong: the pane freezes requestAnimationFrame, and this loop does not use
 * requestAnimationFrame. Drive the frames by hand, leave both clocks alone, and the profiler works.
 *
 * ⚠ AND IT IS A COCKPIT, NOT A TRUCK. A murmuration flies at z 1.4 tiles and the earlier benches
 * sat on the road looking up at it; what the question is actually about is flying INTO one, which is
 * a different seat, a different field of view and the case the mesh cap exists for.
 *
 * ⚠ PHASE TIMES, NOT FRAME TIMES. A whole-frame stopwatch in this environment measured the same
 * configuration at 1.35 ms and 28.85 ms in consecutive runs -- cold V8, a hidden pane and GPU work
 * queueing unpredictably. The profiler times named phases inside the frame, so `world:fauna` is
 * attributable and comparable even when the frame total is not.
 */
export function runFlightFauna({ W = 960, H = 540, seconds = 4, cls = 'twinotter', at = null, shot = false,
                                closeTiles = 2.2, hour = 11 } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__flightfauna'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);

  const was = { gl: RENDER_TUNE.gl, floor: RENDER_TUNE.glFloor, geese: RENDER_TUNE.geese,
    res: RENDER_TUNE.resFloor, ds: RENDER_TUNE.perfDS };
  const out = { ok: false, notes: [], phases: null, withBirds: null, withoutBirds: null };
  try {
    const RR = 30, NN = RR * 2 + 1;
    const cell = () => ({ kind: 'land', biome: 'citycore', flr: 0 });
    const map = Array.from({ length: NN }, () => Array.from({ length: NN }, cell));
    const habitat = (wx, wy) => speciesAt('citycore', wx, wy) || false;
    const anchors = flocksNear(900, 900, RR, 1, habitat);
    let A = null;
    for (const f of anchors) if (f.sp === 'songbird' && (!A || flockSize(f) > flockSize(A))) A = f;
    if (!A) throw new Error('no songbird flock within ' + RR + ' tiles of the seed');

    // A moment the cloud is open, by its own radius -- the first airborne instant is a take-off.
    let T0 = 0, bestR = -1;
    for (let i = 0; i < 40000; i++) {
      const t = 1e6 + i * 250, st = flockState(A, t);
      if (st.airborne && st.r > bestR) { bestR = st.r; T0 = t; }
    }
    if (at) { T0 = at.t; }
    const c0 = at ? { cx: at.x, cy: at.y, z: at.z != null ? at.z : 1.4 } : flockState(A, T0);
    out.notes.push('flock ' + A.ax + ',' + A.ay + ', ' + flockSize(A) + ' birds, centre '
      + c0.cx.toFixed(1) + ',' + c0.cy.toFixed(1) + ' at z ' + c0.z.toFixed(2));

    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0;

    // ⚠ THE SEAT IS PUT AT THE FLOCK'S OWN ALTITUDE. mapCenter is a TILE and integer by
    // contract, so the approach is flown by moving the sub-tile offset rather than the centre.
    const view = { cls, variant: cls, phase: 'cruise', worldBlend: 1,
      // ⚠ height IS A 0..1 FRACTION AND eyeH IS IN TILES. The view contract at the top of
      // windshield.js says so -- "0 = on the deck ... 1 = high" -- and a murmuration flies at z 1.4
      // TILES. Passing the altitude as `height` hands the camera 1.4 of a 0..1 dial, which put the
      // seat somewhere the flock was not and drew 0 birds while every other number in the profile
      // looked reasonable.
      height: 0, eyeH: c0.z, fovMul: 1.0, hour, weather: 'clear', speed: 0.45, hud: 1,
      map, heading: 0, pitch: 0, bank: 0,
      mapCenter: { x: Math.round(c0.cx), y: Math.round(c0.cy + closeTiles) },
      mapOffset: { x: 0, y: 0 } };

    const run = (geese) => {
      RENDER_TUNE.geese = geese;
      murmurReset();
      // ⚠ THE TWO CLOCKS DO DIFFERENT JOBS AND ONLY ONE OF THEM MAY BE REAL.
      //
      // `performance.now` is what `setWindshieldProfiler` reads, so pinning it makes every phase
      // measure zero elapsed -- that is the trap every other bench in this file falls into, and the
      // reason `perfSnapshot` came back with `frames: 0` and looked broken in a hidden pane. It is
      // left alone here.
      //
      // `Date.now` is what `flockState` reads. Leaving THAT real puts the flock wherever the wall
      // clock happens to have it rather than at the open moment this bench went to the trouble of
      // searching for -- and a songbird is on the ground for 55% of its cycle, so a first cut that
      // left both clocks real measured an empty sky in two runs out of three and reported the
      // result as a fauna cost. It is advanced by hand, one frame interval at a time, from T0.
      const realDate = Date.now;
      let t = T0 - 90 * 33;
      for (let i = 0; i < 90; i++) { Date.now = () => t; paintWindshield('__flightfauna', view); t += 33; }

      setWindshieldProfiler(true);
      const until = performance.now() + seconds * 1000;
      let frames = 0, builds = 0, lastB = null, peakBirds = 0, simT = T0;
      while (performance.now() < until) {
        Date.now = () => simT; simT += 16.7;
        paintWindshield('__flightfauna', view); frames++;
        if (murmurStats) { const bb = murmurStats().birds; if (bb > peakBirds) peakBirds = bb; }
        const lf = glLastFrame ? glLastFrame() : null;
        if (lf && lf.builds != null && lf.builds !== lastB) { builds++; lastB = lf.builds; }
      }
      Date.now = realDate;
      const snap = perfSnapshot();
      setWindshieldProfiler(false);
      return { frames, snap, builds, birds: peakBirds };
    };

    // A picture of the seat, for the questions a phase timing cannot answer -- what a far-tier
    // bird actually looks like being the one this bench was extended for.
    const shoot = () => { const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(el, 0, 0); return c.toDataURL('image/png'); };
    const on = run(1);
    if (shot) out.png = shoot();
    const off = run(0);
    out.withBirds = on; out.withoutBirds = off;
    out.ok = true;
  } finally {
    setWindshieldProfiler(false);
    RENDER_TUNE.gl = was.gl; RENDER_TUNE.glFloor = was.floor; RENDER_TUNE.geese = was.geese;
    RENDER_TUNE.resFloor = was.res; RENDER_TUNE.perfDS = was.ds;
    uninstall(); holder.remove();
  }
  for (const n of out.notes) console.log(n);
  return out;
}
if (typeof window !== 'undefined') window.__glFlight = runFlightFauna;

// ── IS THE SEA LIT, AND BY HOW MUCH? ─────────────────────────────────────────
//
// `__glSea()`. Water was the one surface in GLASS with no normal and no lighting at all — the
// hillshade is bypassed on it by name and the swell was spent as a brightness multiplier, which is
// a tint rather than a surface. `RENDER_TUNE.glSeaLit` replaces that tint with a real facet normal
// taken from the closed-form derivative of the same sine trains, plus a specular lobe. This is the
// A/B for it, and there is no headless answer: every harness in the repo installs a GL hook that
// returns null and so never reaches a draw call.
//
// ⚠ IT MEASURES THE FLAG, NEVER THE RENDERER. Both sides are the same GLASS 2 frame with the same
// geometry, so every pixel of difference IS the lighting. Comparing the two RENDERERS instead
// (which is what `__glFloor` does) would fold in every other way they differ.
//
// ⚠ AND IT NEEDS THE ABLATION ROW, which is the `off` pair — a lit sea and an unlit one agreeing to
// "0.2% of pixels" is also exactly what comes back when the term draws nothing. The `off` row is
// the control that says the instrument works at all.
//
// ⚠ THE CLOCK IS SETTLED, NOT MERELY FROZEN. Under a clock that never advances no light reaches
// its slot, so the lights read 0 and a correctly wired feature looks exactly like a dead one —
// `settleFade` runs the frame forward first and freezes after, and it must run AFTER the setting
// under test is applied. `Math.random` is pinned as well, because GLASS throws a meteor across a
// clear night sky on a random timer and settling the fade is what advances it.
// ⚠ AND IT TAKES THE FLAG TO MEASURE, BECAUSE A SECOND NEARLY-IDENTICAL BENCH IS A SECOND PLACE TO
// GET THE SETTLE ORDER AND THE ABLATION ROW WRONG. `flag` names any sea tune key; the defaults are
// the lit term this was written for.
//
// ⚠ AND `headings` IS NOT DECORATION FOR A DIRECTIONAL TERM. A backlit crest needs the sun IN FRONT
// of the eye, so a sweep pinned at heading 0 measures whatever azimuth the clock happens to give it
// and reports a dead flag for a working feature half the time. A term that depends on where you are
// looking has to be measured from more than one direction; one that does not costs one row.
export function runSea({ W = 640, H = 360, R = 20, hours = [13, 20, 2], SEA = 0.6,
                         flag = 'glSeaLit', on = 1, off = 0, headings = [0] } = {}) {
  const realNow = performance.now.bind(performance);
  const realRandom = Math.random;
  // ⚠ AND `Date.now` AS WELL, WHICH `settleFade` DOES NOT PIN AND CANNOT. The sea deliberately runs
  // on the WALL clock rather than on `performance.now`, because `seaClock` is what makes the ocean
  // the same for two players on one tile and verifiable from a server — a per-tab clock would undo
  // all of it. The consequence lands here: freezing `performance.now` freezes the light fade and
  // leaves every wave moving, so the same configuration painted twice differs on most of the frame
  // and a real effect is buried under its own control. Measured before this line existed: a 58.7%
  // noise floor under a 17.6% signal. A sea bench must pin BOTH clocks or it measures the tide.
  const realDateNow = Date.now;
  Date.now = () => 1.75e12;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__sea'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const N = R * 2 + 1;

  // Water dead ahead, land behind — the swell, the glitter, the surf band and the shore emboss are
  // all placed against waterness, so a coast has to be in the frame for any of them to read.
  const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, () =>
    (y <= R ? { kind: 'water', biome: 'water' } : { kind: 'land', biome: 'parkland', flr: 0 })));

  const seats = [
    { tag: 'cab',   eyeH: 0.12, height: 0, cls: 'truck' },
    // The helm chase comes nearly level with the waterline, which is where a grazing sea lives and
    // where the Fresnel term saturates — the seat this feature is most visible from.
    { tag: 'helm',  eyeH: 0.06, height: 0, cls: 'truck' },
    { tag: 'air',   eyeH: 0.24, height: 0.6, cls: 'twin' },
  ];

  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const paintWith = (view, val, state) => {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
    RENDER_TUNE[flag] = val; RENDER_TUNE.glSeaState = state;
    Math.random = () => 0.42;
    // ⚠ AFTER the setting, or the fade settles against the previous configuration.
    settleFade(() => paintWindshield('__sea', view), 24, 33);
    paintWindshield('__sea', view);
    return shot();
  };

  const rows = [];
  const litWas = RENDER_TUNE[flag], stateWas = RENDER_TUNE.glSeaState;
  try {
    for (const seat of seats) {
      for (const hour of hours) for (const heading of headings) {
        const view = {
          cls: seat.cls, phase: 'cruise', worldBlend: 1, height: seat.height, eyeH: seat.eyeH,
          hour, weather: 'clear', speed: 0.4, map, heading,
          mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
        };
        // ⚠ THE SEA STATE IS HELD ON BOTH SIDES, so the only difference is the lighting. It used
        // to move with the flag (`glSeaRoll 0` against `0.016`), which measured the lit term AND a
        // flat-versus-rolling sea at once — and `glSeaRoll` has since been replaced by `glSeaState`
        // anyway, so that argument was landing on a key nothing reads and the roll half was
        // silently absent. A tune key that no longer exists sets nothing and says nothing.
        const base = paintWith(view, off, SEA);      // the flag off — the sea as it shipped
        const lit  = paintWith(view, on,  SEA);      // the flag on
        const ctl  = paintWith(view, off, SEA);      // the control: the same config twice
        let moved = 0, sum = 0, n = 0, noise = 0, peak = 0;
        for (let i = 0; i < base.length; i += 4) {
          const d = Math.max(Math.abs(base[i] - lit[i]), Math.abs(base[i + 1] - lit[i + 1]), Math.abs(base[i + 2] - lit[i + 2]));
          const c = Math.max(Math.abs(base[i] - ctl[i]), Math.abs(base[i + 1] - ctl[i + 1]), Math.abs(base[i + 2] - ctl[i + 2]));
          n++; sum += d; if (d > 6) moved++; if (c > 6) noise++; if (d > peak) peak = d;
        }
        rows.push({
          seat: seat.tag, hour, heading,
          movedPct: +(moved / n * 100).toFixed(2),
          meanLevels: +(sum / n).toFixed(2),
          peak,
          noisePct: +(noise / n * 100).toFixed(2),
        });
      }
    }
  } finally {
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;
    RENDER_TUNE[flag] = litWas; RENDER_TUNE.glSeaState = stateWas;
    performance.now = realNow; Math.random = realRandom; Date.now = realDateNow;
    uninstall(); holder.remove();
  }
  console.table(rows);
  const worstNoise = rows.reduce((m, r) => Math.max(m, r.noisePct), 0);
  const moved = rows.reduce((m, r) => Math.max(m, r.movedPct), 0);
  console.log('   up to ' + moved + '% of the frame moved; the same config twice differs on ' + worstNoise + '%');
  if (worstNoise > 0.05) console.warn('   ⚠ the control is not still — a row near it is a question, not a finding');
  return { rows, moved, worstNoise };
}
if (typeof window !== 'undefined') window.__glSea = runSea;

// ── AND WHAT DOES THE SEA COST? ──────────────────────────────────────────────
//
// __glSeaCost(). `__glSea` above answers whether the water LOOKS different and says nothing about
// what it costs, and the difference matters the moment somebody asks for more wave trains: the
// fragment shader evaluates the whole height field per pixel, so train count multiplies the most
// expensive term in the frame. This is the headroom number that decision needs.
//
// ⚠ IT REPORTS A SPREAD, AND A ROW INSIDE IT IS NOT A FINDING. This file records the occluder
// pre-pass measuring an 8.4 ms COST and a 6.7 ms SAVING on the same seat in two consecutive runs,
// which is how a plan to delete it nearly got made. Every config is run `reps` times and the table
// carries the best and the worst, because one number here has repeatedly been a lie.
//
// ⚠ AND THE DIALS ARE PINNED (`resFloor: 1`, `perfDS: 0`). Left alone the renderer sheds resolution
// exactly where the frame is expensive, so the sea measures cheapest in the storm that makes it
// costliest — the trap this whole file is written around.
//
// ⚠ THE SEA STATE IS FORCED AND HELD. `glSeaState` -1 is weather-driven, which means an unforced
// bench measures whatever the clock's weather happens to be doing and cannot be compared with
// itself an hour later. 1.0 is a full gale: the most expensive sea there is, and the one to size a
// budget against.
//
// ⚠ AND THE REFLECTION ROW CARRIES THE MIRROR PREPASS WITH IT. `glSeaRefl 0` makes `seaWants`
// false, which drops the whole city-mirror render rather than just the lookup — that IS the cost of
// reflections on water and it is right that it lands in this row, but it is not a fragment-shader
// number and must not be read as one.
// ⚠ WHAT IT MEASURED, 2026-09-21, ON ONE RTX 2070 SUPER: NOTHING IT COULD RESOLVE. A GPU-floor sea
// frame is 1.5-1.9 ms at 640x360 and the sea's own three layers land at 0.15, -0.29 and 0.15 ms
// across the three seats against a run-to-run spread of 1.5 ms — a negative reading is the tell.
// Pushing to 1920x1080, and again to 2560x1440 with `allWater`, moved the frame time barely at all,
// so it is not fragment-bound here: what this table is mostly timing is the CPU side of the frame.
// ⚠ AND THE CONTROL SAYS THE INSTRUMENT WORKS, which is the only reason that reading is worth
// anything — `__glFloorCost` on the same page resolves the sea scene at 208 ms on GLASS 1 against
// 1.86 ms on the GPU floor, a 112x difference, and its GPU-floor figure agrees with this bench's
// own frame time. A harness that cannot see a 0.2 ms difference but can see a 200 ms one is not
// broken, it is being asked for a number below its floor.
// ⚠ SO THE HEADROOM ANSWER IS "YES, AND STOP ASKING THIS INSTRUMENT": the height field could carry
// several times the trains it has before this bench would notice. ⚠ But per-pixel trigonometry is
// exactly what an integrated GPU is worst at, and every number here is one discrete NVIDIA card —
// the caveat the whole GLASS 2 flip already carries, and it applies hardest to this shader.
//
// ⚠ AND `allWater` IS FOR HEADROOM, NOT FOR A FRAME ANYBODY SAILS. The default scene is half
// coast because that is what the game draws and what the surf band needs to read at all; but the
// sea's cost is PER PIXEL, so a half-water frame measures half of it, and on a discrete GPU at
// 640x360 the whole stack lands under this bench's own run-to-run spread — which says nothing
// except that the instrument cannot see it. Filling the frame with water and pushing the canvas
// up is how you find out what the shader actually costs when it is the only thing running.
export function runSeaCost({ W = 640, H = 360, R = 20, frames = 30, reps = 3, state = 1,
                             allWater = false } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__seaCost'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const N = R * 2 + 1;

  // Open water dead ahead with a coast behind, the same scene `__glSea` uses: the surf band and the
  // shore emboss are placed against waterness, so a frame of nothing but sea is not a frame the
  // game draws.
  const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, () =>
    ((allWater || y <= R) ? { kind: 'water', biome: 'water' } : { kind: 'land', biome: 'parkland', flr: 0 })));

  const seats = [
    { tag: 'cab',  eyeH: 0.12, height: 0,   cls: 'truck' },
    // Nearly level with the waterline — the grazing seat, where the most sea fills the most pixels.
    { tag: 'helm', eyeH: 0.06, height: 0,   cls: 'truck' },
    { tag: 'air',  eyeH: 0.24, height: 0.6, cls: 'twin' },
  ];

  // lit / swell / refl, cumulative — each row adds one layer to the row above it, so a column of
  // deltas reads as what that layer costs on top of everything already switched on.
  const CONFIGS = [
    { tag: 'flat',   lit: 0, swell: 0, refl: 0 },
    { tag: '+lit',   lit: 1, swell: 0, refl: 0 },
    { tag: '+swell', lit: 1, swell: 1, refl: 0 },
    { tag: '+refl',  lit: 1, swell: 1, refl: 17 },
  ];

  const was = {
    lit: RENDER_TUNE.glSeaLit, swell: RENDER_TUNE.glSwell,
    refl: RENDER_TUNE.glSeaRefl, state: RENDER_TUNE.glSeaState, perf: RENDER_TUNE.perfDS,
  };
  const rows = [];
  try {
    RENDER_TUNE.perfDS = 0;
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.glSeaState = state;
    for (const seat of seats) {
      const view = {
        cls: seat.cls, phase: 'cruise', worldBlend: 1, height: seat.height, eyeH: seat.eyeH,
        hour: 13, weather: 'clear', speed: 0.4, map, heading: 0,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 }, resFloor: 1,
      };
      const time = (c) => {
        RENDER_TUNE.glSeaLit = c.lit; RENDER_TUNE.glSwell = c.swell; RENDER_TUNE.glSeaRefl = c.refl;
        for (let i = 0; i < 12; i++) paintWindshield('__seaCost', view);
        const t0 = performance.now();
        // The heading walks, so nothing measures a frame whose every cache is already warm for
        // exactly that camera — which is not a frame anybody ever sails.
        for (let i = 0; i < frames; i++) paintWindshield('__seaCost', { ...view, heading: i * 0.7 });
        return (performance.now() - t0) / frames;
      };
      const row = { seat: seat.tag };
      const best = {};
      for (const c of CONFIGS) {
        const runs = [];
        for (let r = 0; r < reps; r++) runs.push(time(c));
        runs.sort((a, b) => a - b);
        best[c.tag] = runs[0];
        row[c.tag] = +runs[0].toFixed(2);
        row[c.tag + ' hi'] = +runs[runs.length - 1].toFixed(2);
      }
      // What the water layers cost together, against the same frame with the sea flat.
      row.sea = +(best['+refl'] - best.flat).toFixed(2);
      row['sea %'] = +((best['+refl'] - best.flat) / Math.max(0.01, best['+refl']) * 100).toFixed(1);
      rows.push(row);
    }
  } finally {
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;
    RENDER_TUNE.glSeaLit = was.lit; RENDER_TUNE.glSwell = was.swell;
    RENDER_TUNE.glSeaRefl = was.refl; RENDER_TUNE.glSeaState = was.state;
    RENDER_TUNE.perfDS = was.perf;
    uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   ms per frame at ' + W + 'x' + H + ', sea state ' + state + ', best of ' + reps
    + '; each `hi` beside its column is the worst of the same three runs');
  const worstSpread = rows.reduce((m, r) => Math.max(m,
    ...CONFIGS.map((c) => r[c.tag + ' hi'] - r[c.tag])), 0);
  const seaCost = rows.reduce((m, r) => Math.max(m, r.sea), 0);
  console.log('   the water is up to ' + seaCost + ' ms of a frame; run-to-run spread is up to '
    + worstSpread.toFixed(2) + ' ms');
  if (worstSpread >= seaCost) {
    console.warn('   ⚠ the spread is as large as the thing being measured — this table says the '
      + 'water costs nothing this machine can resolve, and nothing more than that');
  }
  return { rows, seaCost, worstSpread };
}
if (typeof window !== 'undefined') window.__glSeaCost = runSeaCost;

// ── AND JUST SHOW ME THE SEA ─────────────────────────────────────────────────
//
// __glSeaShot(). Every other instrument in this file returns a number, which is right for a
// regression and wrong for a judgement: "does this read as water" is not a percentage, and the
// whole sea was built and tuned without anybody once putting it on screen beside itself.
//
// ⚠ IT LEAVES THE CANVAS ON THE PAGE, which is the entire point — the benches all tear their
// canvas down in a `finally` so nothing can be looked at afterwards. This one paints into a fixed
// visible element and returns, so a screenshot catches it.
//
// ⚠ AND IT PINS BOTH CLOCKS, for the reason `runSea` now carries at length: the sea runs on the
// WALL clock so that two players see one ocean, so freezing `performance.now` alone leaves every
// wave moving and two shots of "the same" sea are different seas. A comparison taken that way is
// worthless, and it is not obvious from the picture.
// ⚠ AND `sail` IS THE ONLY WAY TO SEE A TRAIL AT ALL. Foam is the one part of this sea with
// MEMORY — it is a polyline laid down over successive frames — so a single painted frame shows
// exactly nothing of it however correct the shader is. The boat has to be driven first, and driven
// round a bend, because the whole claim is that the foam keeps going straight after she turns away.
export function runSeaShot({ W = 900, H = 500, R = 20, hour = 7, heading = 0, seat = 'cab',
                             state = 0.8, weather = 'clear', tune = {}, label = '',
                             sail = null, shore = false, city = false, clockMs = 1.75e12,
                             mag = 1 } = {}) {
  // ⚠ `helm` IS A TRUCK CAB AT HALF SCALE AND HAS NEVER BEEN A BOAT. `pushInteriorShell` sizes the
  // shell by `cam.EH / eyeMetresOf(profile)`, so the eye height does not move the camera inside a
  // fixed room — it SCALES THE ROOM around it. At `cls: 'truck'` the profile's eye is 2.6 m, so
  // 0.06 draws the cab at 0.0231 against the `cab` seat's 0.0462: a half-size cab around a
  // full-size viewpoint, which is why one flank gapes open and the framing reads as a boat with a
  // missing side. The 0.06 was almost certainly meant as "a low, boat-like eye" — and it is within
  // a whisker of the real one (0.0623) — but the class was left on the truck.
  //
  // `boat` is the real thing: the hydro's pilothouse, the same shell `boat-view.js` mounts, at the
  // eye height it derives (HELM.eyeM = 1.35 m through the shared metre-to-tile bridge).
  const SEATS = {
    cab:  { eyeH: 0.12,   height: 0,   cls: 'truck' },
    helm: { eyeH: 0.06,   height: 0,   cls: 'truck' },
    boat: { eyeH: 0.0623, height: 0,   cls: 'hydro' },
    air:  { eyeH: 0.24,   height: 0.6, cls: 'twin' },
  };
  const s = SEATS[seat] || SEATS.cab;
  let holder = document.getElementById('__seaShotHolder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = '__seaShotHolder';
    holder.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;background:#111;'
      + 'padding:6px;border:1px solid #444;font:11px monospace;color:#ccc';
    document.body.append(holder);
  }
  holder.innerHTML = '';
  const cap = document.createElement('div');
  cap.textContent = label || (seat + '  ' + hour + ':00  hdg ' + heading + '  sea ' + state
    + '  ' + weather + (city ? '  city' : '') + '  ' + JSON.stringify(tune));
  const el = document.createElement('canvas');
  el.id = '__seaShot'; el.width = W; el.height = H;
  // MAGNIFIED IN CSS, NEVER BY RENDERING BIGGER. A screenshot is downsampled to a fixed width, so
  // a 1800px canvas of the same street shows the same detail as a 900px one; what is wanted is more
  // SCREEN pixels per rendered pixel, which is a style width over a fixed backing store. The
  // renderer still draws at W x H, so the shot is of the frame the game paints.
  el.style.width = (W * mag) + 'px'; el.style.height = (H * mag) + 'px'; el.style.display = 'block';
  el.style.imageRendering = mag > 1 ? 'pixelated' : 'auto';
  holder.append(cap, el);

  const realNow = performance.now.bind(performance);
  const realRandom = Math.random;
  const realDateNow = Date.now;
  const uninstall = installGL(() => el);
  const N = R * 2 + 1;
  // ⚠ THE MAP IS CENTRED ON THE BOAT EVERY FRAME, so a half-and-half scene puts her permanently ON
  // the shoreline rather than sailing away from it — which is exactly what the first sail looked
  // like: a field of grass filling most of the frame and open water nowhere near her. A sail wants
  // open water; a still shot wants the coast, because the surf band needs one to read at all.
  // ⚠ A REFLECTION BENCH NEEDS SOMETHING TO REFLECT, and the default coast is PARKLAND — flat
  // ground with no buildings and no lights on it, so the mirror buffer is empty and every
  // reflection setting measures 0.000% against every other one. That reads exactly like a
  // reflection that does nothing, and it was read that way once: 'glMirror' 0 and 'glSeaRefl' 32
  // came back identical on this scene, which is true and says nothing about the feature. 'city'
  // puts a lit skyline on the far shore, far enough back that its reflection lands on open water
  // rather than on the surf band.
  // ⚠ ON THE QUAY, NOT SET BACK. A first cut started the buildings six tiles behind the water's far
  // edge, which is a beach with a town behind it — and a reflection needs the light and the water to
  // be the SAME place, so every streak landed in the last few rows before the horizon and the
  // measurement read it as an effect that does not reach the viewer. A harbour has the city standing
  // at the water.
  const built = (x, y) => {
    if (!city || y > R - 7) return null;
    if (x % 5 === 1) return { kind: 'land', biome: 'citycore', bt: 'luxtower', ent: 'south', flr: 22 };
    if (x % 2 === 0) return { kind: 'land', biome: 'citycore', bt: 'office', ent: 'south', flr: 10 };
    return { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'south', flr: 3 };
  };
  const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) =>
    ((shore ? (y > R - 6 && y < R + 6) : (sail || y <= R))
      ? { kind: 'water', biome: 'water' }
      : (built(x, y) || { kind: 'land', biome: city ? 'citycore' : 'parkland', flr: 0 }))));
  // ⚠ A SHOT STARTS FROM A CLEAN TRAIL. Foam is the one thing in this sea with memory and it is
  // per-session, so a scene painted after a sail carries that boat's wake — ageing by a different
  // amount between each pair of paints, which showed up as a 4.5% noise floor on water with no
  // boat in it and buried every effect smaller than that.
  foamReset();
  const was = {};
  for (const k of Object.keys(tune)) was[k] = RENDER_TUNE[k];
  const stateWas = RENDER_TUNE.glSeaState, perfWas = RENDER_TUNE.perfDS;
  try {
    Date.now = () => clockMs;
    Math.random = () => 0.42;
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.perfDS = 0;
    RENDER_TUNE.glSeaState = state;
    for (const k of Object.keys(tune)) RENDER_TUNE[k] = tune[k];
    const view = {
      cls: s.cls, phase: 'cruise', worldBlend: 1, height: s.height, eyeH: s.eyeH,
      hour, weather, speed: 0.4, map, heading,
      mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 }, resFloor: 1,
    };
    // The exact view the last shot painted, for poking at afterwards — a debug read, not a
    // contract. Foam is stateful, so "did the store fill" is a question only the real view can ask.
    if (typeof window !== "undefined") window.__seaShotView = view;
    // Settled, then frozen — the light fade ramps over ELAPSED time, so a clock that never
    // advanced leaves every lamp at weight 0 and the shot is of a renderer that has not woken up.
    if (sail) {
      // ⚠ THE CLOCK HAS TO RUN WHILE SHE SAILS AND BE FROZEN FOR THE SHOT. Each point is stamped
      // with the wall clock and fades against it, so under a pinned clock the whole trail is laid
      // at one instant and every point is equally fresh — which is a stripe of uniform white, not a
      // wake. It is advanced by the frame step here and pinned again before the last paint.
      const { frames = 90, speed = 0.09, turn = 1.6, dt = 33 } = sail;
      let hdg = heading, px = 100, py = 100, t = clockMs, pnow = 1e6;
      // ⚠ THE CLASS DECIDES WHOSE COCKPIT IS DRAWN, so forcing the boat's fills the lower half of
      // every shot with her own dash — which is right for a helm shot and useless for looking at
      // what she left on the water. 'ownWake' is what lays foam, and it is read whatever the class
      // is, so an aerial camera over a wake needs the wake and not the boat.
      if (sail.cls) view.cls = sail.cls;
      view.speed = speed * 20;
      view.ownWake = { spd: Math.min(1.4, speed * 12), beam: 0.20 };
      for (let i = 0; i < frames; i++) {
        // A straight, then a turn, then a straight — so the picture carries the one thing a rigid
        // wake cannot show: foam still lying along a course the boat is no longer on.
        if (i > frames * 0.35 && i < frames * 0.7) hdg += turn;
        const r = hdg * Math.PI / 180;
        px += Math.sin(r) * speed; py += -Math.cos(r) * speed;
        t += dt; pnow += dt;
        // ⚠ BOTH CLOCKS, AND THIS ONE IS THE TRAIL'S. Foam is stamped with the renderer's own
        // `performance.now` and fades over FOAM_AGE_MS, so a sail left on the real clock ages the
        // trail by however long the BENCH took to paint — measured at 29 seconds for sixty frames
        // on a 900x500 canvas, which is most of a 40-second life. The picture then shows a correct
        // trail at a tenth of its brightness, which reads exactly like the feature not working.
        Date.now = () => t;
        performance.now = () => pnow;
        view.heading = hdg;
        view.mapCenter = { x: Math.round(px), y: Math.round(py) };
        view.mapOffset = { x: px - Math.round(px), y: py - Math.round(py) };
        paintWindshield('__seaShot', view);
      }
      // ⚠ THE CAMERA IS THE BOAT, so the trail is ASTERN and a forward shot shows none of it
      // however well it is working — which is exactly what the first run of this looked like.
      if (sail.lookBack) view.heading = hdg + 180;
      paintWindshield('__seaShot', view);
    } else {
      settleFade(() => paintWindshield('__seaShot', view), 24, 33);
      paintWindshield('__seaShot', view);
    }
  } finally {
    // ⚠ THE CANVAS STAYS, but nothing else does — the tune keys, both clocks and the GL hook all go
    // back, or the next thing anybody runs on this page is measuring whatever this shot set.
    for (const k of Object.keys(tune)) RENDER_TUNE[k] = was[k];
    RENDER_TUNE.glSeaState = stateWas; RENDER_TUNE.perfDS = perfWas;
    RENDER_TUNE.gl = 0; RENDER_TUNE.glFloor = 0;
    performance.now = realNow; Math.random = realRandom; Date.now = realDateNow;
    uninstall();
  }
  return { el, W, H };
}
if (typeof window !== 'undefined') window.__glSeaShot = runSeaShot;

// ── `__glPool()` ───────────────────────────────────────────────────────────────────────────────
//
// What a street lamp actually lights, as a number. Reported from the game as street lights being
// "a bit harsh, almost a ball of bright light instead of spreading out a more gradual cone around
// their area" — and the ball was the whole of what a lamp WAS: a disc of the highest alpha in the
// city, over tarmac that took nothing from it. See `uPool` in gl/ground.js.
//
// Four columns:
//   moved   — share of the frame that differs from `glPool` 0. The road is roughly a third of this
//             frame, so this saturates well below 100%.
//   mean Δ  — how far, averaged over the WHOLE frame. A pool is a large area at a small amplitude,
//             so this is the column that separates a pool from a hot spot; `peak` is the other half.
//   peak    — the single largest change. ⚠ WATCH THIS AGAINST `mean`: a gain that raises `peak`
//             without raising `moved` is not spreading light, it is growing the ball back.
//   flat    — what share of the ROAD's own pixels are inside 8 levels of each other. This is the
//             failure the wall wash was reverted five times for, one surface over: past some gain
//             the pools stop being pools and become a uniform lift, and the road goes flat. It
//             wants to go UP a little and then stop; a jump means the gain is past its knee.
//
// ⚠ THE NOON ROW IS THE CONTROL AND WANTS TO BE EXACTLY 0. The light list carries no night term by
// design (`rgbRaw` is unweighted so a wet road reflects neon in the afternoon), so the only thing
// between this and a pink cast on sunlit tarmac is the `uNight` gate — the bug the wall wash had.
//
// ⚠ AND THE `glPool` 0 PAIR IS THE NOISE FLOOR. Reported rather than subtracted: `__street` is the
// instrument for the PICTURE and it deliberately freezes nothing, so a first attempt to measure
// this there came back with a control moving 5.47% against an effect of 3.93%. This one settles
// the fade and then pins both clocks and `Math.random`, which is the difference.
export function runPool({ W = 640, H = 360, hours = [23, 13], gains = [0.6, 1.2, 2.4] } = {}) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__pool' + (runPool.n = (runPool.n || 0) + 1);
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const realNow = performance.now, realRandom = Math.random, realDate = Date.now;
  const was = RENDER_TUNE.glPool, wasGl = RENDER_TUNE.gl, wasFloor = RENDER_TUNE.glFloor, wasDS = RENDER_TUNE.perfDS;
  // ⚠ A LAMP EVERY THIRD TILE, NOT EVERY TILE. `scene()` lights one in three down its own road,
  // which is the spacing a pool has to look right at: light every tile and the pools overlap into
  // a sheet whatever the gain is, which is the one failure this bench exists to catch.
  const map = scene(true);
  const rows = [];
  let rngS = 0;
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1; RENDER_TUNE.perfDS = 0;
    Date.now = () => 1.75e12;
    Math.random = () => { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; };
    // Eye height 0.12 and the truck class: the seat this was reported from, and the one a street
    // lamp is for. An aeroplane never sees the pool at all.
    const view = (hour) => ({
      cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour,
      weather: 'clear', speed: 0, map, heading: 22, mapCenter: { x: 100, y: 100 },
      mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 },
    });
    const paint = (pool, hour) => {
      RENDER_TUNE.glPool = pool;
      rngS = 12345;
      settleFade(() => { rngS = 12345; paintWindshield(el.id, view(hour)); });
      return shot();
    };
    // How level the bottom third is — the road, from this seat — in its own pixels.
    const flat = (a) => {
      const vals = [];
      for (let y = (H * 0.62) | 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        vals.push(a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114);
      }
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      let near = 0;
      for (const v of vals) if (Math.abs(v - mean) < 8) near++;
      return 100 * near / vals.length;
    };
    for (const hour of hours) {
      const base = paint(0, hour), base2 = paint(0, hour);
      const f0 = flat(base);
      for (const g of [0, ...gains]) {
        const b = g === 0 ? base2 : paint(g, hour);
        let moved = 0, sum = 0, peak = 0;
        for (let i = 0; i < base.length; i += 4) {
          const d = Math.abs(base[i] - b[i]) + Math.abs(base[i + 1] - b[i + 1]) + Math.abs(base[i + 2] - b[i + 2]);
          if (d >= 12) moved++;
          sum += d / 3;
          if (d > peak) peak = d;
        }
        const px = base.length / 4;
        rows.push({
          hour: hour + ':00',
          glPool: g === 0 ? '0 (control)' : g.toFixed(2),
          moved: (100 * moved / px).toFixed(2) + '%',
          'mean Δ': (sum / px).toFixed(3),
          peak,
          'road flat': flat(b).toFixed(1) + '%' + (g === 0 ? ' (was ' + f0.toFixed(1) + '%)' : ''),
        });
      }
    }
  } finally {
    RENDER_TUNE.glPool = was; RENDER_TUNE.gl = wasGl; RENDER_TUNE.glFloor = wasFloor; RENDER_TUNE.perfDS = wasDS;
    performance.now = realNow; Math.random = realRandom; Date.now = realDate;
    uninstall && uninstall(); holder.remove();
  }
  console.table(rows);
  console.log('   The 13:00 rows are the control and want to be flat — the light list carries no');
  console.log('   night term, so uNight is the only thing keeping a lamp off sunlit tarmac.');
  console.log('   `__street({x: 905, y: 909, heading: 90, hour: 23})` is the picture; this is the number.');
  return rows;
}
if (typeof window !== 'undefined') window.__glPool = runPool;

// ══ A STREET WITH ITS FEED DOWN ═══════════════════════════════════════════════════════════════
//
// `gl:power` proves the MECHANISM headlessly — a blackout takes every light to 0, keeps the
// lettering, leaves the ironwork standing — and it cannot see the picture, because every harness in
// the repo installs a GL hook that answers null and never reaches a draw call. This is the picture.
//
// Four states over one night street: the grid up, browning out, dark, dark on an emergency circuit,
// and never wired at all. What separates them is mostly the WALL BAKE — the lit window grid is a
// texture, not a light — so the number that matters is how much of the BUILDINGS moved, masked the
// way runLights masks: against a render with no buildings in it, or the answer is divided by a sky
// and a road none of this is allowed to touch, and it falls as the window grows.
//
// ⚠ NIGHT, AND ONLY NIGHT. The day bake is shared by every grid state on purpose (a building with
// its feed down looks like its neighbours at noon), so midday is a CONTROL that must read near
// zero — which is why it is in the table rather than assumed.
// ⚠ AND THE CLOCK IS SETTLED, THEN FROZEN. `fadeLights` ramps over ELAPSED time, so under a clock
// that never advances no light ever reaches its slot and every state comes back identical: a
// correctly wired feature looking exactly like one that is switched off. Same trap, in the same
// words, as the one recorded on `settleFade` above.
const POWER_STATES = [
  { tag: 'grid up',   cell: { pw: 1 } },
  { tag: 'brownout',  cell: { pw: 2 } },
  { tag: 'dark',      cell: { pw: 0 } },
  { tag: 'emergency', cell: { pw: 0, em: 1 } },
  { tag: 'off-grid',  cell: { pw: 0, og: 1 } },
];

function powerStreet(R, density, named, cell) {
  const N = R * 2 + 1;
  let k = 0;
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    const dx = x - R;
    // ⚠ THE ROAD AND THE VERGE CARRY THE STATE TOO, so the traffic signals and the street lamps
    // answer to the same outage the buildings do — which is the point of the feature and would be
    // missed entirely by a scene that only powered the buildings.
    const sl = Math.abs(dx) === 3 && (y % 5) === 0 ? (cell.pw === 1 || cell.pw === 2 ? 1 : 0) : undefined;
    if (dx === 0) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, ...cell, sl };
    if (Math.abs(dx) <= 2) return { kind: 'land', biome: 'citycore', flr: 0, ...cell, sl };
    const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    if (density && (h % 1000) / 1000 < density) {
      // ⚠ HALF NAMED AND HALF PLAIN, AND A SCENE OF ONLY THE FIRST MEASURES HALF THE FEATURE. A
      // named model binds its own arm and PAINTS ITS OWN FACADE, so the shared biome wall texture —
      // which is where the lit window grid lives — is never reached: on a street of landmarks, dark
      // and emergency came back byte-identical at 90.8% / worst 60, which reads exactly like the
      // emergency bake not being wired. With plain type buildings in the same scene the pair
      // separates by 2,670 px. The named half still earns its place: it is the only half that
      // carries neon, blades and lettering, which is the other thing a blackout has to take out.
      if ((h >> 4) & 1) {
        const r = named[(k++) % named.length];
        return { kind: 'land', biome: 'citycore', bt: 'shop', bn: r.name || r.key.slice(6),
          ent: dx < 0 ? 'east' : 'west', flr: 2 + ((h >> 8) % 3), ...cell };
      }
      return { kind: 'land', biome: 'citycore', bt: 'luxtower',
        ent: dx < 0 ? 'east' : 'west', flr: 6 + ((h >> 8) % 6), ...cell };
    }
    return { kind: 'land', biome: 'citycore', flr: 0, ...cell };
  }));
}

function powerView(map, { hour, cls, R }) {
  return {
    cls, phase: 'cruise', worldBlend: 1,
    height: cls === 'prop' ? 0.5 : 0, eyeH: cls === 'prop' ? undefined : 0.12,
    hour, weather: 'clear', speed: 0.4, map, heading: 0,
    mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
    resFloor: 1, tune: { gl: 1, perfDS: 0 },
  };
}

export function runPower({ W = 640, H = 360, R = 14, density = 0.5, hours = [23, 13] } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0';
  const el = document.createElement('canvas');
  el.id = '__power'; el.width = W; el.height = H;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  holder.append(el); document.body.append(holder);
  const uninstall = installGL(() => el);
  const ctx = el.getContext('2d');
  const shot = () => new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
  const realNow = performance.now.bind(performance);
  const rows = [];
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
    for (const hour of hours) {
      const ID = '__power_' + hour + '_' + (runPower.n = (runPower.n || 0) + 1);
      el.id = ID;
      const seat = { hour, cls: 'truck', R };
      const at = (cell, dens = density) => {
        const v = powerView(powerStreet(R, dens, named, cell), seat);
        settleFade(() => paintWindshield(ID, v));
        paintWindshield(ID, v); paintWindshield(ID, v);
        return shot();
      };
      // The mask: what is a BUILDING, taken from a render with none in it.
      const empty = at({ pw: 1 }, 0);
      const lit = at({ pw: 1 });
      const isWall = new Uint8Array(lit.length >> 2);
      let mask = 0;
      for (let i = 0; i < lit.length; i += 4) {
        const d = Math.abs(lit[i] - empty[i]) + Math.abs(lit[i + 1] - empty[i + 1]) + Math.abs(lit[i + 2] - empty[i + 2]);
        if (d >= 12) { isWall[i >> 2] = 1; mask++; }
      }
      // ⚠ THE CONTROL IS THE SAME STATE RENDERED TWICE, and it is not decoration: two paints of one
      // scene are not bit-identical here (a cache warms, a fade lands a step further on), so a row
      // near the control's own figure is noise rather than a finding.
      const litB = at({ pw: 1 });
      const meas = (a, b) => {
        let moved = 0, sum = 0, worst = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (!isWall[i >> 2]) continue;
          const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
          if (d >= 2) { moved++; sum += d; }
          if (d > worst) worst = d;
        }
        return { pct: mask ? +(moved / mask * 100).toFixed(1) : null,
          mean: moved ? +(sum / moved / 255 * 100).toFixed(1) : null, worst: Math.round(worst) };
      };
      rows.push({ hour, state: 'control (lit twice)', wallPx: mask, ...meas(lit, litB) });
      const shots = {};
      for (const s of POWER_STATES) {
        if (s.tag === 'grid up') continue;
        shots[s.tag] = at(s.cell);
        rows.push({ hour, state: s.tag, wallPx: mask, ...meas(shots[s.tag], lit) });
      }
      // ⚠ AND THE ONE PAIR THAT MUST BE COMPARED TO EACH OTHER RATHER THAN TO `lit`. An emergency
      // circuit is a small thing beside a blackout, so measured against the lit street both land on
      // the same figure to a tenth of a per cent and the row says nothing at all about whether the
      // stairwell is drawn. It is the DIFFERENCE BETWEEN TWO DARK STREETS that is the feature.
      rows.push({ hour, state: 'emergency vs dark', wallPx: mask, ...meas(shots.emergency, shots.dark) });
    }
  } finally { performance.now = realNow; uninstall && uninstall(); holder.remove(); }
  console.table(rows);
  console.log('  A blackout is mostly the WALL BAKE — the lit window grid is a texture, not a light —');
  console.log('  so `dark` should dwarf the control at night and sit ON it at midday, where every grid');
  console.log('  state shares one day texture. `off-grid` must match the control at BOTH hours:');
  console.log('  Deadwater and the Under burn flame, and have never been on anybody else grid.');
  console.log('  `__powerShot({state: "dark"})` is the picture; this is the number.');
  return rows;
}
if (typeof window !== 'undefined') window.__glPower = runPower;

// The same street, painted once and LEFT ON THE CANVAS, because "does a blacked-out block read as a
// blacked-out block" is not a percentage. Every other function in this file returns a number and
// this question is not one of them — the sibling of `__glSeaShot`, for the same reason.
export function runPowerShot({ W = 900, H = 500, R = 14, density = 0.5, hour = 23, state = 'dark' } = {}) {
  const named = shapeModelRegistry().filter((r) => r.key.startsWith('named:'));
  const s = POWER_STATES.find((p) => p.tag === state) || POWER_STATES[2];
  let el = document.getElementById('__powershot');
  if (!el) {
    el = document.createElement('canvas');
    el.id = '__powershot';
    el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;border:1px solid #333;background:#000';
    document.body.append(el);
    installGL(() => el);
  }
  el.width = W; el.height = H; el.style.width = W + 'px'; el.style.height = H + 'px';
  RENDER_TUNE.gl = 1; RENDER_TUNE.glFloor = 1;
  const v = powerView(powerStreet(R, density, named, s.cell), { hour, cls: 'truck', R });
  const realNow = performance.now.bind(performance);
  settleFade(() => paintWindshield('__powershot', v));
  paintWindshield('__powershot', v); paintWindshield('__powershot', v);
  performance.now = realNow;
  console.log(`__powerShot: ${state} at ${hour}:00 — ${W}x${H}, bottom right. States: ${POWER_STATES.map((p) => p.tag).join(', ')}`);
  return el;
}
if (typeof window !== 'undefined') window.__powerShot = runPowerShot;

// ── `__glBolt()` — a strike, as a picture ──────────────────────────────────────────────────────
//
// The sibling of `__glSeaShot`, and here for the same reason: every other instrument in this file
// returns a percentage, and "does that read as lightning" is not one. A bolt is also the one thing
// in this renderer that cannot be caught by playing the game — it lives for a quarter of a second,
// it only happens in a storm, and the strike that produced it was decided on the server.
//
// ⚠ IT LEAVES THE CANVASES ON THE PAGE, one per case in a row, so a screenshot is a contact sheet.
// A single frame of a single bolt says nothing about the restrike envelope; what says it is the
// same seed at four ages beside each other.
//
// ⚠ AND THE AGE IS PINNED THROUGH `RENDER_TUNE.boltForce` RATHER THAN BY LETTING THE CLOCK RUN.
// Every bench here pins `performance.now` so a picture can be compared with itself, and a bolt
// drained under a pinned clock is for ever nought milliseconds old — the first return stroke and
// nothing else, which is the one moment of its life that shows neither the decay nor the flicker.
//
// ⚠ AND IT CROPS AND MAGNIFIES RATHER THAN RENDERING BIGGER, WHICH IS NOT WHAT THE SEA SHOT DOES.
// That one magnifies in CSS on the note that a bigger backing store shows no more detail through a
// downsampled screenshot — and it does not work here, because `paintWindshield` sizes its backing
// store from `clientWidth`, so a CSS width of 2x renders at 2x and the shot is the same picture
// again. The only way to actually look closely is to render at the size the game draws and blit a
// crop of it through a nearest-neighbour upscale.
//
// ⚠ AND THE CROP IS A FIXED WINDOW ON THE CENTRELINE, never a hunt for the brightest pixel. The
// strike is straight ahead unless a case moves it, and the brightest pixel in a storm frame is a
// lit raindrop in the foreground about nine times out of ten.
//
// ⚠ EACH CASE NEEDS ITS OWN CANVAS ID. `st` is per-canvas frame state and `st.bolts` is only culled
// when the clock is live, so a second case painted onto the first one's canvas draws both bolts at
// once — which reads as the generator producing two trees per strike.
let boltRun = 0;
export function runBolt({ W = 420, H = 300, hour = 21, weather = 'storm', dist = 12,
                          cases = null, tune = {}, crop = null } = {}) {
  const CASES = cases || [
    { label: 'age 0 — first return stroke', age: 0 },
    { label: 'age 55 — between strokes', age: 55 },
    { label: 'age 95 — a restrike', age: 95 },
    { label: 'age 180 — dying', age: 180 },
  ];
  const Z = { w: 224, h: 158, y: 0.06, scale: 3.4, ...(crop || {}) };
  const run = ++boltRun;
  let holder = document.getElementById('__boltHolder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = '__boltHolder';
    document.body.append(holder);
  }
  holder.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000;display:flex;'
    + 'gap:2px;flex-wrap:wrap;font:11px monospace;color:#bbb';
  holder.innerHTML = '';

  const realNow = performance.now.bind(performance);
  const realRandom = Math.random;
  const realDate = Date.now;
  const uninstall = installGL();
  const was = { detail: RENDER_TUNE.boltDetail, force: RENDER_TUNE.boltForce,
    res: RENDER_TUNE.resFloor, ds: RENDER_TUNE.perfDS, hour: RENDER_TUNE.hourForce };
  for (const k of Object.keys(tune)) was[k] = RENDER_TUNE[k];
  const map = scene(true, 20);
  const src = document.createElement('canvas');
  src.style.cssText = 'position:fixed;left:-10000px;top:0;display:block;width:' + W + 'px;height:' + H + 'px';
  src.width = W; src.height = H;
  document.body.append(src);
  try {
    RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0; RENDER_TUNE.hourForce = null;
    for (const k of Object.keys(tune)) RENDER_TUNE[k] = tune[k];
    CASES.forEach((c, i) => {
      src.id = '__boltsrc' + run + '_' + i;
      // ⚠ THE DETAIL DIAL IS READ AT GROW TIME, so it has to be set BEFORE the strike is pushed —
      // the drain inside paintWindshield is what builds the tree. Setting it after paints the
      // previous case's setting and reports it as this one's.
      RENDER_TUNE.boltDetail = c.detail ?? 1;
      RENDER_TUNE.boltForce = c.age ?? 0;
      const d = c.dist ?? dist;
      pushLightningStrike(100 + (c.off ?? 0), 100 - d, c.intensity ?? 0.9);
      if (c.second) pushLightningStrike(100 + c.second[0], 100 - c.second[1], 0.7);
      const view = {
        cls: c.cls || 'truck', phase: 'cruise', worldBlend: 1,
        height: c.height ?? 0, eyeH: c.eyeH ?? 0.12,
        hour: c.hour ?? hour, weather: c.weather || weather, speed: 0.3, map,
        heading: 0, acX: 100, acY: 100,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 }, resFloor: 1,
      };
      settleFade(() => paintWindshield(src.id, view), 20, 33);
      paintWindshield(src.id, view);

      const x0 = Math.max(0, Math.min(src.width - Z.w, src.width / 2 + (c.off || 0) * 8 - Z.w / 2));
      const y0 = Math.max(0, Math.min(src.height - Z.h, src.height * Z.y));
      const z = document.createElement('canvas');
      z.width = Z.w * Z.scale; z.height = Z.h * Z.scale;
      z.style.cssText = 'display:block;image-rendering:pixelated';
      const g = z.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(src, x0, y0, Z.w, Z.h, 0, 0, z.width, z.height);
      const cell = document.createElement('div');
      const cap = document.createElement('div'); cap.textContent = c.label || ('case ' + i);
      cell.append(cap, z); holder.append(cell);
    });
  } finally {
    src.remove();
    RENDER_TUNE.boltDetail = was.detail; RENDER_TUNE.boltForce = was.force;
    RENDER_TUNE.resFloor = was.res; RENDER_TUNE.perfDS = was.ds; RENDER_TUNE.hourForce = was.hour;
    for (const k of Object.keys(tune)) RENDER_TUNE[k] = was[k];
    performance.now = realNow; Math.random = realRandom; Date.now = realDate;
    uninstall();
  }
  return { cases: CASES.length };
}
if (typeof window !== 'undefined') window.__glBolt = runBolt;

// ── `__glBoltLum()` — how bright a strike actually lands in the frame ──────────────────────────
//
// The number behind the picture, and the one that found the whole defect. A bolt is painted very
// nearly white and then every full-frame grade in the rest of `paintWindshield` runs over the top
// of it; additive white cannot clip past 255 before a wash, so the only way to know whether any of
// it survived is to read the pixels back.
//
// ⚠ AND IT NEEDS A CONTROL, because "the brightest pixel in the frame" is a lit raindrop or the
// weather badge. The control is the SAME frame with the strike pushed past `BOLT_MAX_DIST`, so it
// is culled at the drain and everything else in the picture — the rain, the city, the grade, the
// flood — is identical; the difference is the channel and nothing else.
//
// It read `peak: 102` against a sky of 15 when the channel was drawn inside the world block, and
// 255 with it drawn after the grades. See the block in windshield.js for the arithmetic.
export function runBoltLum({ W = 420, H = 300, dist = 12, hour = 21, weather = 'storm', tune = {} } = {}) {
  const shots = [];
  for (const d of [dist, 300]) {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0';
    const el = document.createElement('canvas');
    el.id = '__boltlum' + d; el.width = W; el.height = H;
    el.style.width = W + 'px'; el.style.height = H + 'px';
    holder.append(el); document.body.append(holder);
    const uninstall = installGL();
    const realNow = performance.now.bind(performance);
    const was = { detail: RENDER_TUNE.boltDetail, force: RENDER_TUNE.boltForce, res: RENDER_TUNE.resFloor, ds: RENDER_TUNE.perfDS };
    for (const k of Object.keys(tune)) was[k] = RENDER_TUNE[k];
    try {
      RENDER_TUNE.resFloor = 1; RENDER_TUNE.perfDS = 0; RENDER_TUNE.boltDetail = 1; RENDER_TUNE.boltForce = 0;
      for (const k of Object.keys(tune)) RENDER_TUNE[k] = tune[k];
      pushLightningStrike(100, 100 - d, 0.9);
      const view = { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12,
        hour, weather, speed: 0.3, map: scene(true, 20), heading: 0, acX: 100, acY: 100,
        mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 }, resFloor: 1 };
      settleFade(() => paintWindshield(el.id, view), 20, 33);
      paintWindshield(el.id, view);
      shots.push(el.getContext('2d').getImageData(0, 0, W, H).data);
    } finally {
      RENDER_TUNE.boltDetail = was.detail; RENDER_TUNE.boltForce = was.force;
      RENDER_TUNE.resFloor = was.res; RENDER_TUNE.perfDS = was.ds;
      for (const k of Object.keys(tune)) RENDER_TUNE[k] = was[k];
      performance.now = realNow; uninstall(); holder.remove();
    }
  }
  const [A, B] = shots;
  const lum = (d, i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  let peak = 0, sky = 0, at = null, hot = 0;
  for (let i = 0; i < A.length; i += 4) {
    const la = lum(A, i);
    if (la > 230) hot++;
    if (la - lum(B, i) > peak - sky) { peak = la; sky = lum(B, i); at = [(i / 4) % W, ((i / 4) / W) | 0]; }
  }
  const out = { peak: peak | 0, skyAtSamePixel: sky | 0, at, pxOver230: hot };
  console.log('__glBoltLum', JSON.stringify(out));
  return out;
}
if (typeof window !== 'undefined') window.__glBoltLum = runBoltLum;
