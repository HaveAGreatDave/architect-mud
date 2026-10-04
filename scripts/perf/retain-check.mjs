// retain-check: do retained groups draw exactly what the same records draw unretained?
//
//   node scripts/perf/retain-check.mjs
//
// Stage 3 phase 4 of docs/proposals/glass-headroom.md. Paints real Coldwater headless, then hands
// each frame's lights, wires and decals to two gl/context.js views under a fake WebGL2 that mirrors
// every buffer and records every draw: one with no groups, one with chunks of the list marked as
// retained groups (some fresh each frame, some the same arrays frame after frame, so both placing and
// reusing are exercised). The triangles drawn have to be the same multiset; the order may differ (a
// retained range is drawn before the frame's own). Exits 1 on any difference.
import { pathToFileURL } from 'node:url';
import { openScene, PLACES } from './scene.mjs';
const ctxUrl = new URL('../../client/game/js/panels/gl/context.js', import.meta.url);
const { createGLView } = await import(ctxUrl.href);

function fakeView() {
  let vao = null, ab = null;
  const vaoBuf = new Map(), mirrors = new Map(), strideOf = new Map(), draws = [];
  const fns = {
    createBuffer: () => ({ buf: 1 }), createVertexArray: () => ({ vao: 1 }), createTexture: () => ({ tex: 1 }),
    bindVertexArray: (v) => { vao = v; },
    bindBuffer: (t, b) => { if (t === 'ARRAY_BUFFER') { ab = b; if (vao) vaoBuf.set(vao, b); } },
    vertexAttribPointer: (l, n, ty, norm, stride) => { if (ab) strideOf.set(ab, stride / 4); },
    bufferData: (t, size) => { if (t === 'ARRAY_BUFFER' && typeof size === 'number') mirrors.set(ab, new Float32Array(size / 4)); },
    bufferSubData: (t, off, data, src = 0, len) => { if (t !== 'ARRAY_BUFFER') return; const m = mirrors.get(ab); if (!m) return; const n = len ?? data.length - src; m.set(data.subarray(src, src + n), off / 4); },
    drawArrays: (mode, first, n) => { const b = vao && vaoBuf.get(vao); const st = strideOf.get(b); if (b && st && mirrors.get(b)) draws.push({ st, f: mirrors.get(b).slice(first * st, (first + n) * st) }); },
    getProgramParameter: () => true, getShaderParameter: () => true, getExtension: () => null, isContextLost: () => false,
    getUniformLocation: () => ({}), getAttribLocation: () => 1, getParameter: () => 0, checkFramebufferStatus: () => 'COMPLETE',
    getContextAttributes: () => ({}),
  };
  const gl = new Proxy({}, { get: (o, k) => (k in fns ? fns[k] : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? k : () => ({})) });
  return { view: createGLView({ width: 640, height: 360, getContext: () => gl, addEventListener() {} }, {}), draws };
}
const tris = (draws) => {
  const out = [];
  for (const { st, f } of draws) for (let i = 0; i + 3 * st <= f.length; i += 3 * st) out.push(st + ':' + Array.from(new Int32Array(f.slice(i, i + 3 * st).buffer)).join(','));
  return out.sort();
};

const A = fakeView(), B = fakeView();
const scene = await openScene({ record: false });
let hook = null;
scene.ws.installGLWorld((cells, cam, o) => { hook = { cam, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });
// Arrays kept alive across frames: the "same group as last frame" case. Built from the first frame's
// records at each view and handed back on every frame after.
let frames = 0, bad = 0, grouped = 0, total = 0;
const shown = [];
const layers = [['sprites', 'drawSprites', (v, l, c) => v.drawSprites(c, l, 360, 1)], ['strokes', 'drawStrokes', (v, l, c) => v.drawStrokes(c, l, 360)], ['decals', 'drawDecals', (v, l, c) => v.drawDecals(c, l, 360, 0, null, null)]];
try {
  for (const place of Object.keys(PLACES)) for (const seat of ['cab', 'cockpit']) {
    const keep = {};
    for (let i = 0; i < 6; i++) {
      const v = scene.view(place, seat, { hour: 22, heading: 20 + i * 2 });
      scene.ws.paintWindshield('__perf', v); scene.ws.paintWindshield('__perf', v);
      const { cam, o } = hook;
      for (const [name, , call] of layers) {
        const list = (o[name] || []).slice();
        if (o[name] && o[name].deep) list.deep = o[name].deep;
        // Stable groups: the first frame's first chunk, handed back unchanged every frame.
        if (!keep[name]) keep[name] = list.slice(0, Math.min(40, list.length));
        const withG = [...keep[name], ...list];
        if (list.deep) withG.deep = list.deep;
        withG.groups = [{ recs: keep[name], at: 0 }];
        // Fresh groups: chunks of this frame's own records.
        for (let at = keep[name].length + 10; at + 25 <= withG.length; at += 60) withG.groups.push({ recs: withG.slice(at, at + 25), at });
        const plain = withG.slice();
        if (withG.deep) plain.deep = withG.deep;
        grouped += withG.groups.reduce((s, g) => s + g.recs.length, 0); total += withG.length;
        A.draws.length = 0; B.draws.length = 0;
        call(A.view, plain, cam); call(B.view, withG, cam);
        const a = tris(A.draws), b = tris(B.draws);
        frames++;
        if (a.length !== b.length || a.some((t, j) => t !== b[j])) { bad++; if (shown.length < 4) shown.push(`${name} ${place} ${seat} frame ${i}: ${a.length} triangles plain, ${b.length} with groups`); }
      }
    }
  }
} finally { scene.close(); }
for (const l of shown) console.error('  ✗ ' + l);
if (bad) { console.error(`retain-check: ${bad} of ${frames} frames differ`); process.exit(1); }
console.log(`✓ retain-check: ${frames} layer-frames identical with ${(100 * grouped / total).toFixed(0)}% of records in retained groups.`);
