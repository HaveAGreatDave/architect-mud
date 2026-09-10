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
const LIGHT_SWEEP = [
  { tag: 'lambert (wrap 0)', set: { wrap: 0 } },
  { tag: 'shipping', set: {} },
  { tag: 'wrap 1.0', set: { wrap: 1 } },
  { tag: 'span x1.5', set: { span: 4.8 } },
  { tag: 'minR 2.0', set: { minR: 2 } },
  { tag: 'gain x1.5', set: { gain: 2.25 } },
];

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

      // ── the picture, clock frozen ──
      performance.now = () => 1e6;
      const paint2 = (v) => { paintWindshield(ID, v); paintWindshield(ID, v); };
      RENDER_TUNE.glLights = 0;
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

if (typeof window !== 'undefined') { window.__glBench = runBench; window.__glStage1 = runStage1; window.__glPhases = runPhases; window.__glFidelity = runFidelity; window.__glTerrain = runTerrain; window.__glCaps = glCapabilities; window.__glFloor = runFloor; window.__glFloorCost = runFloorCost; window.__glSign = runSign; window.__glFrame = runFrame; window.__glLights = runLights; window.__glClouds = runCloudDeck; }
