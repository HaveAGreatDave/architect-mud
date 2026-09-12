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
import { createGLView } from '/client/game/js/panels/gl/context.js';
import { installGL, glLastFrame, glCapabilities } from '/client/game/js/panels/gl/install.js';
import { LIGHT_TUNE } from '/client/game/js/panels/gl/world.js';
import { paintWindshield, shapeModelRegistry, captureModelMesh, wallPaletteInfo, makeCam, RENDER_TUNE, glWorldInstalled, setWindshieldProfiler, perfSnapshot } from '/client/game/js/panels/windshield.js';

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
  { tag: 'gain 0.70', set: { gain: 0.70 } },
  { tag: 'gain 1.00', set: { gain: 1.00 } },
  { tag: 'gain 1.40', set: { gain: 1.40 } },
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
          worst: Math.round(worst) });
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
        const withSubj = paint(build(cell(r), true), hour);
        let leak = 0, crown = 0;
        for (let i = 0, k = 0; i < wallOnly.length; i += 4, k++) {
          const d = Math.abs(withSubj[i] - wallOnly[i]) + Math.abs(withSubj[i + 1] - wallOnly[i + 1]) + Math.abs(withSubj[i + 2] - wallOnly[i + 2]);
          if (d < 12) continue;
          if (mask[k]) leak++; else crown++;
        }
        rows.push({ model: r.key, hour, leakPx: leak, noisePx: noise, crownPx: crown, wallPx: maskN });
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
