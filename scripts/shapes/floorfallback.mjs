// floorfallback — the one property that makes `glFloor: 1` safe to ship.
//
//   node scripts/shapes/floorfallback.mjs
//
// `drawMode7Floor` hands its LUT and its camera to a shader and RETURNS, drawing nothing itself.
// Every way GLASS 2 can fail to draw the replacement — no WebGL2, a lost context, a shader that
// will not compile, a pass that simply answers nothing — ends at `RENDER_TUNE.gl = 0`. This
// function runs BEFORE the pass every frame, so it has to test that flag as well as `glFloor`:
//
//     if (TUNE.gl && TUNE.glFloor && GL_HOOK && LUT) { …hand it over…; return; }
//
// Drop the `TUNE.gl` term and the early return keeps firing for ever on a machine that cannot draw
// the replacement. Not a degraded floor — NO floor, permanently, on exactly the hardware with no
// way to tell you why, and the failure is quiet because a backstop sky-to-ground gradient is still
// painted underneath: it is smooth, it is the right colour, and it looks like ground until you put
// it beside the real thing. Measured in a browser at the moment of the flip, the control without
// the term differed from the software raster over 69% of the ground; with it, 0%.
//
// ⚠ THE SIGNAL IS THE PER-TEXEL RASTER, NOT THE FRAME. The floor is one `drawImage` onto the main
// canvas whichever way it is drawn, so counting calls there says nothing at all. What only happens
// when the CPU rasters is `putImageData` onto the Mode-7 scratch buffer, so that is what is
// counted, across every context the frame creates.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const W = 640, H = 360;

// Count putImageData across every canvas the renderer makes for itself. document.createElement is
// the only way it gets one.
// ⚠ THROUGH A PROXY, NOT BY ASSIGNMENT. The stub's context is itself a Proxy that synthesises
// its methods on `get`, so writing a counting wrapper onto it is quietly discarded and the tally
// stays at zero - which reads exactly like "the floor never rastered" and would have failed this
// check for its own reason rather than the renderer's.
const realCreate = globalThis.document.createElement;
let puts = 0;
globalThis.document.createElement = (t) => {
  const el = realCreate.call(globalThis.document, t);
  if (t !== 'canvas') return el;
  const getCtx = el.getContext.bind(el);
  el.getContext = (...a) => {
    const c = getCtx(...a);
    if (!c) return c;
    return new Proxy(c, {
      get(target, k) {
        const v = target[k];
        if (k === 'putImageData') return (...q) => { puts++; return typeof v === 'function' ? v.apply(target, q) : undefined; };
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set(target, k, v) { target[k] = v; return true; },
    });
  };
  return el;
};

const ws = await loadWindshield();
stubCanvas('__ff', W, H);

const R = 20, N = 41;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (
  { kind: 'land', biome: (x + y) % 5 === 0 ? 'redrock' : 'parkland', flr: 0 })));
const VIEW = {
  cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.12, hour: 13,
  weather: 'clear', speed: 0.4, map, heading: 0, mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.2, y: -0.3 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

function rasterCalls(setup) {
  setup();
  ws.paintWindshield('__ff', VIEW);          // settle every lazy cache
  puts = 0;
  ws.paintWindshield('__ff', VIEW);
  return puts;
}

const problems = [];
const glFloorWas = ws.RENDER_TUNE.glFloor, glWas = ws.RENDER_TUNE.gl;

// 1. Plain GLASS 1: the raster is the floor, so this is what "drawn" looks like.
const base = rasterCalls(() => {
  ws.installGLWorld(null); ws.RENDER_TUNE.gl = 0; ws.RENDER_TUNE.glFloor = 0;
});
if (base < 1) problems.push('the 2-D floor made no putImageData at all — the signal this checks is wrong, not the renderer');

// 2. A hook that answers NOTHING, which is what no WebGL2 and a lost context both look like.
const nulled = rasterCalls(() => {
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld(() => null);
});
if (nulled < base) problems.push(`the floor stopped rastering when the GL pass answered nothing (${nulled} vs ${base}) — a machine with no WebGL2 gets no ground`);

// 3. A hook that THROWS.
const threw = rasterCalls(() => {
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld(() => { throw new Error('context lost'); });
});
if (threw < base) problems.push(`the floor stopped rastering when the GL pass threw (${threw} vs ${base})`);

// 4. And with no hook installed at all — the cold open loads this file and must never touch a GPU.
const bare = rasterCalls(() => {
  ws.installGLWorld(null); ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
});
if (bare < base) problems.push(`the floor stopped rastering with no GL hook installed (${bare} vs ${base})`);

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = glFloorWas;
globalThis.performance = clock;

if (problems.length) {
  console.error('\n✗ floorfallback — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ floorfallback: the Mode-7 raster still runs when the GL pass answers nothing, throws, or was never installed — ${base}/${nulled}/${threw}/${bare} buffer writes.`);
