// armkeep-check: do kept buildings draw what running their arms draws?
//
//   node scripts/perf/armkeep-check.mjs
//
// Stage 3 phase 5 of docs/proposals/glass-headroom.md. Flies the same turning sequence twice through
// real Coldwater, once with `armKeep` 0 (every arm every frame) and once with it on, and hands each
// frame's lights, wires, decals and solids to a gl/context.js view under a fake WebGL2 that mirrors
// every buffer and records every draw. The triangles drawn have to be the same multiset frame by
// frame, to 1e-5 (a kept record is shifted each frame, which costs the last bits). Reports how many
// buildings were kept. Exits 1 on any difference.
import { openScene } from './scene.mjs';
const { createGLView } = await import(new URL('../../client/game/js/panels/gl/context.js', import.meta.url).href);

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
  // A GPU-sized light's CPU radius (float 5) is unused when its size spec (floats 11-14) is there, and
  // a kept light keeps the recording's: blanked for those. Sprites are the only 18-float layer.
  for (const { st, f } of draws) for (let i = 0; i + 3 * st <= f.length; i += 3 * st) {
    const v = Array.from(f.slice(i, i + 3 * st));
    if (st === 18) for (let k = 0; k < 3; k++) if (v[k * 18 + 11] > 0) v[k * 18 + 5] = 0;
    out.push(st + ':' + v.map((x) => Math.round(x * 1e5)).join(','));
  }
  return out.sort();
};

const scene = await openScene({ record: false });
let hook = null;
scene.ws.installGLWorld((cells, cam, o) => { hook = { cam, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });
const fly = (place, seat, hour, keep) => {
  scene.ws.RENDER_TUNE.armKeep = keep;
  const G = fakeView(), frames = [];
  // Painted once first: the occlusion pass reads the last frame, and a first frame after another
  // place draws more than one after the same place (see the warm paint in retain-check).
  scene.ws.paintWindshield('__perf', scene.view(place, seat, { hour, heading: 20 }));
  for (let i = 0; i < 60; i++) {
    scene.ws.paintWindshield('__perf', scene.view(place, seat, { hour, heading: 20 + i * 1.5 }));
    const { cam, o } = hook, ship = o.ship || [];
    G.draws.length = 0;
    // The bay sink only: the own ship is not a building, and its first frame after a tune change
    // splits its faces differently (shipLocal), which says nothing about kept arms.
    G.view.uploadSolids([null, o.bay, null]);
    G.view.drawSolids(cam, 360, {});
    G.view.drawSprites(cam, o.sprites, 360, 1);
    G.view.drawStrokes(cam, o.strokes, 360);
    G.view.drawDecals(cam, o.decals, 360, 0, null, null);
    frames.push(tris(G.draws));
  }
  return frames;
};
let bad = 0, n = 0, extras = 0;
const shown = [];
try {
  for (const [place, seat, hour] of [['halcyon', 'cockpit', 22], ['nightlife', 'cab', 22], ['residential', 'cockpit', 13]]) {
    const a = fly(place, seat, hour, 0);
    const s0 = { ...scene.ws.armKeepStats };
    const b = fly(place, seat, hour, 1);
    const st = scene.ws.armKeepStats;
    for (let i = 0; i < a.length; i++) {
      n++;
      // Missing from the kept draw is an error. Extra in it is what the live arm skipped for being
      // behind the eye or behind a nearer building, which the GPU clips or depth-hides: counted.
      const cnt = new Map();
      for (const x of b[i]) cnt.set(x, (cnt.get(x) || 0) + 1);
      let miss = 0;
      for (const x of a[i]) { const k = cnt.get(x) || 0; if (k) cnt.set(x, k - 1); else miss++; }
      let extra = 0; for (const k of cnt.values()) extra += k;
      extras += extra;
      if (miss) { bad++; if (shown.length < 4) shown.push(`${place} ${seat} frame ${i}: ${miss} live triangles missing from the kept draw`); }
    }
    console.log(`  ${place} ${seat} ${hour}h: kept ${st.kept - s0.kept}, live ${st.live - s0.live}, replays ${st.replayed - s0.replayed}, rechecks ${st.rechecked - s0.rechecked}, dropped ${st.dropped - s0.dropped}`);
  }
} finally { scene.ws.RENDER_TUNE.armKeep = 1; scene.close(); }
for (const l of shown) console.error('  ✗ ' + l);
if (bad) { console.error(`armkeep-check: ${bad} of ${n} frames differ`); process.exit(1); }
console.log(`✓ armkeep-check: ${n} frames, no live triangle missing from the kept draw (${(extras / n).toFixed(1)} extra a frame, skipped live for being out of view).`);
