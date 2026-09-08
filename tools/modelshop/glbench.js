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
import { installGL, glLastFrame } from '/client/game/js/panels/gl/install.js';
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

if (typeof window !== 'undefined') { window.__glBench = runBench; window.__glStage1 = runStage1; window.__glPhases = runPhases; }
