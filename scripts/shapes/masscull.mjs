// masscull: does culling the mass to the view (RENDER_TUNE.glMassCull) drop only what can't be seen?
//
//   node scripts/shapes/masscull.mjs
//
// Paints real Coldwater headless through the real GL world pass (gl/install.js, world.js, context.js)
// under a fake WebGL2 that mirrors the mass buffer and records every draw from it, with the program's
// uViewProj and uMassShift at the time. For each culled pass (the depth prepass, the main pass, the
// puddle mirror), every triangle of the buffer it didn't draw must be degenerate or wholly past one
// clip plane of that pass's matrix, so the GPU would have clipped it whole. The sun pass (uLightVP)
// must draw everything. With glMassCull 0 every pass draws everything. The far dissolve (uFadePass 2)
// draws only its band by design and is left out. Exits 1 on any visible triangle dropped, or when no
// pass culled anything (a gate that checks nothing).
import { openScene, PLACES } from '../perf/scene.mjs';

const MASS_STRIDE = 21;
const scene = await openScene({ record: false });

let vao = null, ab = null, prog = null;
const vaoBuf = new Map(), mirrors = new Map(), strideOf = new Map(), uni = new Map();
let passes = [];
const record = (ranges) => {
  const b = vao && vaoBuf.get(vao);
  if (!b || strideOf.get(b) !== MASS_STRIDE || !mirrors.get(b)) return;
  const u = uni.get(prog) || {};
  if (u.uFadePass === 2) return;
  // The sun pass is the program with uLightVP and no uViewProj: the main program has a uLightVP too.
  passes.push({ prog, buf: mirrors.get(b), ranges, vp: u.uViewProj ? u.uViewProj.slice() : null, light: !!u.uLightVP && !u.uViewProj, shift: u.uMassShift || [0, 0] });
};
const setU = (loc, v) => { if (loc && loc.p) { let u = uni.get(loc.p); if (!u) uni.set(loc.p, u = {}); u[loc.name] = v; } };
const multiDraw = { multiDrawArraysWEBGL: (mode, firsts, fo, counts, co, n) => { const r = []; for (let i = 0; i < n; i++) r.push([firsts[fo + i], counts[co + i]]); record(r); } };
const fns = {
  createBuffer: () => ({}), createVertexArray: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
  createShader: () => ({}), createProgram: () => ({}),
  useProgram: (p) => { prog = p; },
  bindVertexArray: (v) => { vao = v; },
  bindBuffer: (t, b) => { if (t === 'ARRAY_BUFFER') ab = b; },
  vertexAttribPointer: (l, n, ty, norm, stride) => { if (ab) { strideOf.set(ab, stride / 4); if (vao) vaoBuf.set(vao, ab); } },
  bufferData: (t, size) => {
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
  let skipped = 0, live = 0, vis = 0;
  for (let t = 0; t < nV / 3; t++) {
    if (degenerate(p.buf, 3 * t)) continue;
    live++;
    // With the cull off, count what's in view, for the pass count below.
    if (!on && p.vp) {
      clipOf(p.buf, 3 * t, p.vp, p.shift, A); clipOf(p.buf, 3 * t + 1, p.vp, p.shift, B); clipOf(p.buf, 3 * t + 2, p.vp, p.shift, C);
      if (!outside()) vis++;
    }
    if (drawn[t]) continue;
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
  else if (!p.light) { tris += live; culled += skipped; }
  return p.light || !p.vp || vis > 0;
};
const kinds = new Set(), seen = new Map();
let emptied = 0;   // views where a pass with nothing in view was culled away whole

try {
  // Three places: downtown, the Marrow, and old Coldwater, whose cockpit looking south has nothing in view.
  for (const place of ['halcyon', 'marrow', 'oldcoldwater']) for (const seat of ['cab', 'cockpit']) for (const on of [1, 0]) {
    scene.ws.RENDER_TUNE.glMassCull = on;
    const [x, y] = PLACES[place];
    // The last case moves the window three tiles east and two south: the kept buffer holds its
    // anchor, so the pass draws through a non-zero uMassShift (massKeep).
    for (const [i, heading, at] of [[0, 0, place], [1, 70, place], [2, 160, place], [3, 250, place], [4, 30, [x + 3, y + 2]]]) {
      // Rain for the puddle mirror's pass, clear for the sun's. Painted twice: the first frame builds
      // the buffer and the sun map, the second is the kept steady frame. Both are checked.
      const v = scene.view(at, seat, { hour: i % 2 ? 22 : 13, heading, weather: i < 2 || i === 4 ? 'rain' : 'clear' });
      for (let k = 0; k < 2; k++) {
        passes = [];
        scene.ws.paintWindshield('__perf', v);
        let vis = 0;
        for (const p of passes) if (check(p, `${place} ${seat} heading ${heading} glMassCull ${on} frame ${k}`, on)) vis++;
        // ⚠ A pass that culls everything draws nothing, so it never reaches `record`. With the cull
        // on, the same view must make at least as many passes as made, with it off, one with
        // something in view (or the sun's), and no more than it made in all.
        const key = `${place} ${seat} heading ${heading} frame ${k}`;
        if (on) seen.set(key, passes.length);
        else if (seen.get(key) < vis || seen.get(key) > passes.length) { bad++; if (shown.length < 6) shown.push(`${key}: ${seen.get(key)} mass passes with the cull on; with it off ${passes.length}, ${vis} with anything in view`); }
        else if (seen.get(key) < passes.length) emptied++;
      }
    }
  }
} finally { scene.close(); }
for (const l of shown) console.error('  ✗ ' + l);
if (bad) { console.error(`masscull: ${bad} triangles dropped that a pass should have drawn`); process.exit(1); }
if (!culled) { console.error(`masscull: ${checked} passes checked and none culled a triangle; the switch isn't reaching the draw`); process.exit(1); }
if (offFull !== offPasses) { console.error('masscull: a pass culled with glMassCull 0'); process.exit(1); }
if (!shifted) { console.error('masscull: no culled pass drew through a mass shift, so a recentre is unchecked'); process.exit(1); }
if (!sunPasses) { console.error('masscull: no sun pass was seen, so the check that it draws everything checked nothing'); process.exit(1); }
console.log(`✓ masscull: ${checked} mass passes by ${kinds.size} programs (${sunPasses} sun, all whole; ${shifted} culled through a mass shift, ${emptied} culled whole with nothing in view); the culled passes skipped ${(100 * culled / Math.max(1, tris)).toFixed(0)}% of their triangles, each one wholly outside the view.`);
