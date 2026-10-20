// movecost: what a MOVING camera re-sends and re-runs, frame by frame.
//
//   node scripts/perf/movecost.mjs [place] [seat] [--resend N] [--recentre] [--intern] [--frames N]
//     [--turn deg] [--speed tiles] [--prof] [--why] [--rows] [--tune k=v,...] [--gl]
//
// Every other perf tool turns the heading over a fixed tile, which never moves `mapOffset`. A real
// flight or drive moves it every frame, and the server sends a fresh map window (fresh cell objects)
// on every context push, every TICK_MS (3 s). This flies straight ahead at the seat's speed, hands the
// sprite, stroke and decal sinks to a gl/context.js view under a fake WebGL2 that counts the floats
// written per frame, and with `--resend N` replaces the map with a deep copy every N frames, as the
// wire does. `--recentre` also moves the window's centre to the craft's tile at each resend, as the
// server does, and `--intern` takes each resend through panels/map-intern.js as the client does.
// Prints per-frame floats written, decal draws, kept-arm counters and, with `--prof`, phase times.
//
// `--gl` runs the real GL world pass (gl/install.js, world.js, context.js) under the fake WebGL2
// instead of a stub hook, so `world:gl` and the floats written include the mass buffer: the cost a
// recentre pays there (RENDER_TUNE.massKeep) is invisible without it. The sprite, stroke and decal
// counts are then the pass's own, not a separate view's.
import { openScene, PLACES } from './scene.mjs';
import { internMap } from '../../client/game/js/panels/map-intern.js';
const { createGLView } = await import(new URL('../../client/game/js/panels/gl/context.js', import.meta.url).href);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
const place = pos[0] || 'halcyon', seat = pos[1] || 'cockpit';
const FRAMES = Number(opt('--frames', 240)), RESEND = Number(opt('--resend', 0));

function fakeView() {
  let written = 0, draws = 0, binds = 0;
  const fns = {
    createBuffer: () => ({}), createVertexArray: () => ({}), createTexture: () => ({}),
    bufferData: (t, size) => { if (t === 'ARRAY_BUFFER' && typeof size !== 'number' && size) written += size.length; },
    bufferSubData: (t, off, data, src = 0, len) => { if (t === 'ARRAY_BUFFER') written += len ?? data.length - src; },
    drawArrays: () => { draws++; }, bindTexture: () => { binds++; },
    getProgramParameter: () => true, getShaderParameter: () => true, getExtension: () => null, isContextLost: () => false,
    getUniformLocation: () => ({}), getAttribLocation: () => 1, getParameter: () => 0, checkFramebufferStatus: () => 'COMPLETE',
    getContextAttributes: () => ({}),
  };
  const gl = new Proxy({}, { get: (o, k) => (k in fns ? fns[k] : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? k : () => ({})) });
  const view = createGLView({ width: 640, height: 360, getContext: () => gl, addEventListener() {} }, {});
  return { view, take: () => { const r = { written, draws, binds }; written = draws = binds = 0; return r; } };
}

const clock = globalThis.performance;   // the real one: openScene freezes it
const scene = await openScene({ record: false });
if (args.includes('--why')) scene.ws.armKeepWhy.on = true;
let hook = null;
const GLW = args.includes('--gl');
let glWritten = 0;
if (GLW) {
  // The pass makes its own canvases through document.createElement, so they get the fake context too.
  const fns = {
    createBuffer: () => ({}), createVertexArray: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
    createShader: () => ({}), createProgram: () => ({}),
    bufferData: (t, size) => { if (typeof size !== 'number' && size && size.length) glWritten += size.length; },
    bufferSubData: (t, off, data, src = 0, len) => { glWritten += len ?? (data.length - src); },
    getProgramParameter: () => true, getShaderParameter: () => true, getExtension: () => null, isContextLost: () => false,
    getUniformLocation: () => ({}), getAttribLocation: () => 1, checkFramebufferStatus: () => 0x8CD5,
    getParameter: (q) => (q === 'MAX_TEXTURE_SIZE' ? 8192 : 16), getContextAttributes: () => ({ antialias: true }),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    fenceSync: () => ({}), clientWaitSync: () => 0x911A, getSyncParameter: () => 0x9119,
  };
  const host = { id: 'movecost', width: 640, height: 360, clientWidth: 640, clientHeight: 360, style: {}, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ width: 640, height: 360, left: 0, top: 0 }) };
  const gl = new Proxy({}, { get: (o, k) => (k in fns ? fns[k] : k === 'canvas' ? host : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? k : () => ({})) });
  host.getContext = (t) => (t === 'webgl2' ? gl : null);
  const ce = document.createElement.bind(document);
  document.createElement = (t, ...a) => {
    const el = ce(t, ...a);
    if (String(t).toLowerCase() === 'canvas') { const g0 = el.getContext; el.getContext = (type, ...b) => (type === 'webgl2' ? gl : g0.call(el, type, ...b)); }
    return el;
  };
  const { installGL } = await import(new URL('../../client/game/js/panels/gl/install.js', import.meta.url).href);
  installGL(() => host);
} else scene.ws.installGLWorld((cells, cam, o) => { hook = { cam, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });
for (const kv of (opt('--tune', '') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); scene.ws.RENDER_TUNE[k] = Number(v); }
const G = fakeView();
const v0 = scene.view(place, seat, { hour: Number(opt('--hour', 13)), heading: 0 });
const clone = (map) => map.map((row) => row.map((c) => JSON.parse(JSON.stringify(c))));
let map = v0.map;
const [X0, Y0] = PLACES[place];
let k = 0;   // whole tiles the window's centre has moved north
const t0 = clock.now();
let tNow = t0;
// --prof runs the real clock (the profiler times with it), so the scene clock runs as fast as the
// frames do, as in the game; without it the clock steps 16 ms a frame and runs can be compared exactly.
const PROF = args.includes('--prof'), ROWS = args.includes('--rows');
if (PROF) { globalThis.performance = clock; scene.ws.setWindshieldProfiler(true); }
else globalThis.performance = { ...clock, now: () => tNow };
const PHASES = ['world:build', 'world:sweep', 'world:occlude', 'world:shadow', 'world:arms', 'world:street', 'world:fauna', 'world:gl', 'surfaces', 'ground'];
const st = scene.ws.armKeepStats, snap = () => ({ ...st });
const rows = [];
// Straight north at about the seat's speed in tiles a frame. Between resends the window stays put and
// the craft slides across it (`mapOffset`), as the client does between pushes.
const TURN = Number(opt('--turn', 0));
const SPEED = Number(opt('--speed', seat === 'cab' ? 0.01 : 0.02));
for (let i = 0; i < FRAMES; i++) {
  tNow = t0 + i * 16;
  const dist = i * SPEED;
  if (RESEND && i && i % RESEND === 0) {
    const k0 = k;
    if (args.includes('--recentre')) k = Math.round(dist);
    const fresh = clone(scene.view([X0, Y0 - k], seat).map);
    map = args.includes('--intern') ? internMap(map, X0, Y0 - k0, fresh, X0, Y0 - k) : fresh;
  }
  const y = -(dist - k);
  if (PROF) scene.ws.setWindshieldProfiler(true);
  const s0 = snap(), w0 = clock.now();
  scene.ws.paintWindshield('__perf', { ...v0, map, mapCenter: { x: X0, y: Y0 - k }, heading: i * TURN, mapOffset: { x: 0.3, y } });
  const paintMs = clock.now() - w0;
  let glMs = 0, g, o;
  if (GLW) {
    g = { written: glWritten, draws: 0, binds: 0 }; glWritten = 0;
    o = { sprites: [], strokes: [], decals: [] };
  } else {
    const { cam } = hook; o = hook.o;
    G.take();
    const u0 = clock.now();
    G.view.drawSprites(cam, o.sprites, 360, 1);
    G.view.drawStrokes(cam, o.strokes, 360);
    G.view.drawDecals(cam, o.decals, 360, 0, null, null);
    glMs = clock.now() - u0;
    g = G.take();
  }
  const s1 = snap();
  const ph = {}; if (PROF) { const t = scene.ws.perfSnapshot().t; for (const k of PHASES) ph[k] = t[k] || 0; if (ROWS) for (const k in t) if (!(k in ph)) ph[k] = t[k]; }
  const d = {}; for (const k in s1) d[k] = s1[k] - s0[k];
  rows.push({ i, paintMs, glMs, ...g, ...d, ...ph, nSp: o.sprites.length, nSt: o.strokes.length, nDe: o.decals.length, grp: (o.sprites.groups || []).length + (o.decals.groups || []).length + (o.strokes.groups || []).length });
}
globalThis.performance = clock;
scene.close();
const settled = rows.slice(30);
const med = (k) => { const a = settled.map((r) => r[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
const max = (k) => Math.max(...settled.map((r) => r[k]));
const sum = (k) => settled.reduce((s, r) => s + r[k], 0);
console.log(`${place} ${seat}, ${FRAMES} frames moving${RESEND ? `, map resent every ${RESEND}${args.includes('--recentre') ? ', recentred' : ''}${args.includes('--intern') ? ', interned' : ''}` : ''}${opt('--tune', '') ? ', tune ' + opt('--tune') : ''}`);
console.log(`  paint ms   median ${med('paintMs').toFixed(1)}  max ${max('paintMs').toFixed(1)}`);
console.log(`  layer ms   median ${med('glMs').toFixed(2)}  max ${max('glMs').toFixed(2)}`);
console.log(`  floats written/frame  median ${med('written')}  max ${max('written')}`);
console.log(`  layer draws/frame median ${med('draws')}, texture binds ${med('binds')}`);
console.log(`  records/frame: sprites ${med('nSp')}, strokes ${med('nSt')}, decals ${med('nDe')}, retained groups ${med('grp')}`);
console.log(`  kept arms over ${settled.length} frames: replayed ${sum('replayed')}, probing ${sum('probing')}, kept ${sum('kept')}, live ${sum('live')}, liveRun ${sum('liveRun')}, gap ${sum('gap')}, near ${sum('near')}, rechecked ${sum('rechecked')}`);
if (args.includes('--why')) { const tally = {}; for (const r of Object.values(scene.ws.armKeepWhy.by)) for (const [w, n] of Object.entries(r.why)) tally[w] = (tally[w] || 0) + n; console.log('  why:', JSON.stringify(tally)); }
{ const p = settled.map((r) => r.paintMs).sort((a, b) => a - b), q = (x) => p[Math.floor(x * (p.length - 1))].toFixed(1);
  console.log(`  paint ms   p90 ${q(0.9)}  p99 ${q(0.99)}  total ${p.reduce((a, b) => a + b, 0).toFixed(0)}`); }
if (PROF) console.log('  phases (median ms): ' + PHASES.map((k) => `${k} ${med(k).toFixed(2)}`).join(', '));
if (args.includes('--rows')) for (const r of rows) console.log(JSON.stringify(r));
