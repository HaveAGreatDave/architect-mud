// duskbuild: does the hour through dusk rebuild the city (RENDER_TUNE.glDuskGPU)?
//
//   node scripts/shapes/duskbuild.mjs
//
// Paints a Halcyon cab through the real GL world pass under a fake WebGL2, a game minute at a time
// from 17:25 to 18:35, as the server sends the hour. That crosses the whole dusk band, where the
// night blend climbs through wallTexMixed's 64 steps. With glDuskGPU 1 the shader blends the hour, so
// no minute may rebuild the mass buffer or the atlas. With it 0 the blend is baked, and the sweep must
// see rebuilds, or it never reached the band and the first check proved nothing. On the baked path
// each one repacked about 8 million floats and cost 70 ms or more of a headless frame.
// It also reads the packed mass: on the shader's path the vertices must carry night colours and the
// "the city's blend" marker (aColorN.w = -1), or the hour would rebuild nothing because the colours
// were frozen at whatever blend the last build had.
import { openScene, PLACES } from '../perf/scene.mjs';

const scene = await openScene({ record: false });
const MASS_STRIDE = 25;
let ab = null, atlasUploads = 0, massData = null;
const strideOf = new Map(), bufData = new Map();
const massNow = () => { for (const [b, d] of bufData) if (strideOf.get(b) === MASS_STRIDE) massData = d; return massData; };
const fns = {
  createBuffer: () => ({}), createVertexArray: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
  createShader: () => ({}), createProgram: () => ({}),
  bindBuffer: (t, b) => { if (t === 'ARRAY_BUFFER') ab = b; },
  vertexAttribPointer: (l, n, ty, norm, stride) => { if (ab) strideOf.set(ab, stride / 4); },
  // The mass buffer arrives whole through bufferData before its pointers are set, so keep every
  // array upload and pick the mass's once the stride is known.
  bufferData: (t, data) => { if (t === 'ARRAY_BUFFER' && data && data.length) bufData.set(ab, data); },
  // A page-sized upload is an atlas page (wall, material, surface or night); the per-frame ones are small.
  texImage2D: (...a) => { const src = a[a.length - 1]; if (src && src.width >= 256 && src.height >= 256) atlasUploads++; },
  getUniformLocation: () => ({}),
  getProgramParameter: () => true, getShaderParameter: () => true, isContextLost: () => false,
  getExtension: (n) => (n === 'WEBGL_multi_draw' ? { multiDrawArraysWEBGL() {} } : null),
  getAttribLocation: () => 1, checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',   // the proxy's constants are their own names
  getParameter: (q) => (q === 'MAX_TEXTURE_SIZE' ? 8192 : 16), getContextAttributes: () => ({ antialias: true }),
  getShaderInfoLog: () => '', getProgramInfoLog: () => '', getSupportedExtensions: () => ['WEBGL_multi_draw'],
  getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
  fenceSync: () => ({}), clientWaitSync: () => 0x911A, getSyncParameter: () => 0x9119,
};
const host = { id: 'duskbuild', width: 640, height: 360, clientWidth: 640, clientHeight: 360, style: {}, addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ width: 640, height: 360, left: 0, top: 0 }) };
const gl = new Proxy({}, { get: (o, k) => (k in fns ? fns[k] : k === 'canvas' ? host : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? k : () => ({})) });
host.getContext = (t) => (t === 'webgl2' ? gl : null);
const ce = document.createElement.bind(document);
document.createElement = (t, ...a) => {
  const el = ce(t, ...a);
  if (String(t).toLowerCase() === 'canvas') { const g0 = el.getContext; el.getContext = (type, ...b) => (type === 'webgl2' ? gl : g0.call(el, type, ...b)); }
  return el;
};
const { installGL, glLastFrame } = await import(new URL('../../client/game/js/panels/gl/install.js', import.meta.url).href);
installGL(() => host);

// Minutes since midnight, swept with the switch at `on`. Returns rebuilds and atlas uploads.
const sweep = (on) => {
  scene.ws.RENDER_TUNE.glDuskGPU = on;
  // Settle on the first minute: the switch itself changes the atlas, which is one rebuild.
  const v0 = scene.view(PLACES.halcyon, 'cab', { hour: 17 + 25 / 60, heading: 30 });
  for (let i = 0; i < 3; i++) scene.ws.paintWindshield('__perf', v0);
  const b0 = glLastFrame().builds;
  atlasUploads = 0;
  for (let m = 17 * 60 + 26; m <= 18 * 60 + 35; m++) scene.ws.paintWindshield('__perf', scene.view(PLACES.halcyon, 'cab', { hour: m / 60, heading: 30 }));
  // What the last pack wrote: vertices told to take the city's blend, and ones whose night differs.
  const d = massNow(), n = d ? Math.floor(d.length / MASS_STRIDE) : 0;
  let city = 0, nightDiff = 0;
  for (let i = 0, o = 0; i < n; i++, o += MASS_STRIDE) {
    if (d[o + 24] === -1) city++;
    if (d[o + 21] !== d[o + 6] || d[o + 22] !== d[o + 7] || d[o + 23] !== d[o + 8]) nightDiff++;
  }
  return { builds: glLastFrame().builds - b0, atlas: atlasUploads, city, nightDiff };
};
let gpu, baked;
try { gpu = sweep(1); baked = sweep(0); }
finally { scene.ws.RENDER_TUNE.glDuskGPU = 1; scene.close(); }
let bad = 0;
if (gpu.builds || gpu.atlas) { bad++; console.error(`  ✗ glDuskGPU 1: ${gpu.builds} mass rebuilds and ${gpu.atlas} atlas uploads across dusk; the hour must rebuild nothing`); }
if (!gpu.city || !gpu.nightDiff) { bad++; console.error(`  ✗ glDuskGPU 1: ${gpu.city} vertices take the city's blend and ${gpu.nightDiff} carry a night colour; the buffer was packed with the blend baked in`); }
if (baked.city) { bad++; console.error(`  ✗ glDuskGPU 0: ${baked.city} vertices are told to take the shader's blend on the baked path`); }
if (baked.builds < 30) { bad++; console.error(`  ✗ glDuskGPU 0: only ${baked.builds} rebuilds across dusk, so the sweep didn't cross the band and the check above proved nothing`); }
if (bad) process.exit(1);
console.log(`✓ duskbuild: 70 game minutes across dusk rebuild nothing with the shader's blend (the baked blend rebuilt ${baked.builds} times).`);
