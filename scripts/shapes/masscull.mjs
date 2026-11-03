// masscull: does culling the mass to the view (RENDER_TUNE.glMassCull) drop only what can't be seen?
//
//   node scripts/shapes/masscull.mjs
//
// Paints real Coldwater headless through the real GL world pass (gl/install.js, world.js, context.js)
// under a fake WebGL2 that mirrors the mass buffer. A pass is one binding of the mass VAO, with the
// draws made inside it and the program's uViewProj and uMassShift at the time, so a pass that culled
// everything shows up with no draws rather than not at all. For each culled pass (the depth prepass,
// the main pass, the puddle mirror), every triangle of the buffer it didn't draw must be degenerate or
// wholly past one clip plane of that pass's matrix, so the GPU would have clipped it whole. The sun
// pass (uLightVP) must draw everything, and so must every pass of one view per seat with glMassCull 0.
// The far dissolve (uFadePass 2) draws only its band by design and is left out, and a binding that
// uploads (massLayout) isn't a pass. Exits 1 on any visible triangle dropped, or when no pass culled
// anything (a gate that checks nothing).
import { openScene, PLACES } from '../perf/scene.mjs';

const MASS_STRIDE = 25;
const scene = await openScene({ record: false });
// A coarse floor: under the stub the Mode-7 ground is a per-texel JS raster, and it draws nothing
// from the mass buffer this gate checks.
scene.ws.RENDER_TUNE.pixel = 16;

let vao = null, ab = null, prog = null;
const vaoBuf = new Map(), mirrors = new Map(), strideOf = new Map(), uni = new Map();
let passes = [];
// The binding open now: its VAO, its program, its draws, and whether it uploaded instead.
let span = null;
const closeSpan = () => {
  const s = span; span = null;
  if (!s || s.layout) return;
  const b = vaoBuf.get(s.vao);
  if (!b || strideOf.get(b) !== MASS_STRIDE || !mirrors.get(b)) return;
  const u = uni.get(s.prog) || {};
  if (u.uFadePass === 2) return;
  // The sun pass is the program with uLightVP and no uViewProj: the main program has a uLightVP too.
  passes.push({ prog: s.prog, buf: mirrors.get(b), ranges: s.draws, vp: u.uViewProj ? u.uViewProj.slice() : null, light: !!u.uLightVP && !u.uViewProj, shift: u.uMassShift || [0, 0] });
};
const record = (ranges) => { if (span) for (const r of ranges) span.draws.push(r); };
const setU = (loc, v) => { if (loc && loc.p) { let u = uni.get(loc.p); if (!u) uni.set(loc.p, u = {}); u[loc.name] = v; } };
const multiDraw = { multiDrawArraysWEBGL: (mode, firsts, fo, counts, co, n) => { const r = []; for (let i = 0; i < n; i++) r.push([firsts[fo + i], counts[co + i]]); record(r); } };
const fns = {
  createBuffer: () => ({}), createVertexArray: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
  createShader: () => ({}), createProgram: () => ({}),
  useProgram: (p) => { prog = p; },
  bindVertexArray: (v) => { closeSpan(); vao = v; if (v) span = { vao: v, prog, draws: [], layout: false }; },
  bindBuffer: (t, b) => { if (t === 'ARRAY_BUFFER') ab = b; },
  vertexAttribPointer: (l, n, ty, norm, stride) => { if (span) span.layout = true; if (ab) { strideOf.set(ab, stride / 4); if (vao) vaoBuf.set(vao, ab); } },
  bufferData: (t, size) => {
    if (span) span.layout = true;
    if (t !== 'ARRAY_BUFFER') return;
    if (typeof size === 'number') mirrors.set(ab, new Float32Array(size / 4));
    else if (size && size.length != null) mirrors.set(ab, Float32Array.from(size));
  },
  bufferSubData: (t, off, data, src = 0, len) => {
    if (t !== 'ARRAY_BUFFER') return;
    const m = mirrors.get(ab); if (!m) return;
    const n = len ?? data.length - src;
    m.set(data.subarray(src, src + n), off / 4);
  },
  drawArrays: (mode, first, n) => record([[first, n]]),
  getUniformLocation: (p, name) => ({ p, name }),
  uniformMatrix4fv: (loc, tr, m) => setU(loc, Array.from(m)),
  uniform2f: (loc, x, y) => setU(loc, [x, y]),
  uniform1f: (loc, x) => setU(loc, x),
  getProgramParameter: () => true, getShaderParameter: () => true, isContextLost: () => false,
  getExtension: (n) => (n === 'WEBGL_multi_draw' ? multiDraw : null),
  getAttribLocation: () => 1, checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',   // the proxy's constants are their own names
  getParameter: (q) => (q === 'MAX_TEXTURE_SIZE' ? 8192 : 16), getContextAttributes: () => ({ antialias: true }),
  getShaderInfoLog: () => '', getProgramInfoLog: () => '', getSupportedExtensions: () => ['WEBGL_multi_draw'],
  getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
  fenceSync: () => ({}), clientWaitSync: () => 0x911A, getSyncParameter: () => 0x9119,
};
const host = { id: 'masscull', width: 640, height: 360, clientWidth: 640, clientHeight: 360, style: {}, addEventListener() {}, removeEventListener() {},
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

// A clip coordinate of vertex `i` under `m` (column-major) after the mass shift.
const clipOf = (buf, i, m, sh, out) => {
  const o = i * MASS_STRIDE, x = buf[o] + sh[0], y = buf[o + 1] + sh[1], z = buf[o + 2];
  for (let r = 0; r < 4; r++) out[r] = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r];
};
const A = [0, 0, 0, 0], B = [0, 0, 0, 0], C = [0, 0, 0, 0];
const outside = () => {
  for (let r = 0; r < 3; r++) {
    if (A[r] > A[3] && B[r] > B[3] && C[r] > C[3]) return true;
    if (A[r] < -A[3] && B[r] < -B[3] && C[r] < -C[3]) return true;
  }
  return false;
};
const degenerate = (buf, i) => {
  const a = i * MASS_STRIDE, b = a + MASS_STRIDE, c = b + MASS_STRIDE;
  const ux = buf[b] - buf[a], uy = buf[b + 1] - buf[a + 1], uz = buf[b + 2] - buf[a + 2];
  const vx = buf[c] - buf[a], vy = buf[c + 1] - buf[a + 1], vz = buf[c + 2] - buf[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return nx * nx + ny * ny + nz * nz < 1e-18;
};

let shifted = 0, bad = 0, checked = 0, tris = 0, culled = 0, offFull = 0, offPasses = 0, sunPasses = 0;
const shown = [];
const check = (p, where, on) => {
  const nV = Math.floor(p.buf.length / MASS_STRIDE / 3) * 3;
  const drawn = new Uint8Array(nV / 3);
  for (const [f, n] of p.ranges) for (let t = Math.ceil(f / 3); t < (f + n) / 3; t++) drawn[t] = 1;
  // Only an undrawn triangle is tested; the drawn ones count towards the share skipped, holes and all.
  let skipped = 0, live = 0;
  for (let t = 0; t < nV / 3; t++) {
    if (drawn[t]) { live++; continue; }
    if (degenerate(p.buf, 3 * t)) continue;
    live++;
    skipped++;
    if (p.light || !on || !p.vp) { bad++; if (shown.length < 6) shown.push(`${where}: a ${p.light ? 'sun' : on ? 'matrixless' : 'glMassCull 0'} pass skipped triangle ${t}`); continue; }
    clipOf(p.buf, 3 * t, p.vp, p.shift, A); clipOf(p.buf, 3 * t + 1, p.vp, p.shift, B); clipOf(p.buf, 3 * t + 2, p.vp, p.shift, C);
    if (!outside()) { bad++; if (shown.length < 6) shown.push(`${where}: triangle ${t} is in view and wasn't drawn`); }
  }
  checked++;
  if (on && !p.light && (p.shift[0] || p.shift[1])) shifted++;
  kinds.add(p.prog);
  if (p.light) sunPasses++;
  if (!on) { offPasses++; if (!skipped) offFull++; }
  else if (!p.light) { tris += live; culled += skipped; if (!p.ranges.length) emptied++; }
};
const kinds = new Set();
let emptied = 0;   // culled passes that drew nothing, every triangle checked as out of view

try {
  // Downtown from a cab and a cockpit, and old Coldwater from a cockpit, which looking south has
  // nothing in view. ⚠ Each new view is a cold paint, and that's the gate's cost (CPU-profiled
  // 2026-11-03: the paints were 90% of it, the check 8%), so a seat is added only for a case none of
  // these covers.
  for (const [place, seat] of [['halcyon', 'cab'], ['halcyon', 'cockpit'], ['oldcoldwater', 'cockpit']]) {
    const [x, y] = PLACES[place];
    // The fifth case moves the window three tiles east and two south: the kept buffer holds its
    // anchor, so the pass draws through a non-zero uMassShift (massKeep). The last is the first view
    // again with the cull off, whose every pass must draw everything.
    const cases = [[0, 0, place, 1], [1, 70, place, 1], [2, 160, place, 1], [3, 250, place, 1], [4, 30, [x + 3, y + 2], 1], [0, 0, place, 0]];
    for (const [i, heading, at, on] of cases) {
      scene.ws.RENDER_TUNE.glMassCull = on;
      // Rain for the puddle mirror's pass, clear for the sun's; the hour alternates, which moves the
      // sun, so each new view runs the sun pass. The first view is painted twice, so the kept steady
      // frame is checked as well as the one that built the buffer.
      const v = scene.view(at, seat, { hour: i % 2 ? 22 : 13, heading, weather: i < 2 || i === 4 ? 'rain' : 'clear' });
      for (let k = 0; k < (on && i === 0 ? 2 : 1); k++) {
        passes = [];
        scene.ws.paintWindshield('__perf', v);
        closeSpan();
        for (const p of passes) check(p, `${place} ${seat} heading ${heading} glMassCull ${on} frame ${k}`, on);
      }
    }
  }
} finally { scene.ws.RENDER_TUNE.glMassCull = 1; scene.close(); }
for (const l of shown) console.error('  ✗ ' + l);
if (bad) { console.error(`masscull: ${bad} triangles dropped that a pass should have drawn`); process.exit(1); }
if (!culled) { console.error(`masscull: ${checked} passes checked and none culled a triangle; the switch isn't reaching the draw`); process.exit(1); }
if (!offPasses || offFull !== offPasses) { console.error(`masscull: ${offPasses - offFull} of ${offPasses} passes with glMassCull 0 culled something`); process.exit(1); }
if (!shifted) { console.error('masscull: no culled pass drew through a mass shift, so a recentre is unchecked'); process.exit(1); }
if (!sunPasses) { console.error('masscull: no sun pass was seen, so the check that it draws everything checked nothing'); process.exit(1); }
console.log(`✓ masscull: ${checked} mass passes by ${kinds.size} programs (${sunPasses} sun, all whole; ${shifted} culled through a mass shift, ${emptied} culled whole with nothing in view); the culled passes skipped ${(100 * culled / Math.max(1, tris)).toFixed(0)}% of their triangles, each one wholly outside the view.`);
