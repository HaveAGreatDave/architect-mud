// lite-retain: do GLASS Lite's retained groups draw what the same records draw sent plain?
//
//   node scripts/perf/lite-retain.mjs
//
// gl/lite.js `emitTile` hands a tile at full strength to the sprite, stroke and decal sinks as
// retained groups, which the layers write to the GPU once per map window and keep (gl/retain.js). A
// group's arena entry is written from the group's live records with the offset last seen for it, so
// two things in emitTile keep that honest: a record moves only with the one array it's grouped in
// (`groupsOf`), and a tile fading in the haze streams copies (`fadeOf`). Break either and a kept
// group is drawn where the camera was some frames ago.
//
// This paints real Lite frames headless, the camera moving inside its tile and far enough that
// tiles cross the haze band, and hands each frame's sinks to two gl/context.js views under a fake
// WebGL2 that mirrors every buffer: one with the sinks' groups stripped, one with them as they are.
// The grouped view keeps its arenas across frames, so a group written at a stale offset shows. The
// triangles drawn have to be the same multiset each frame. Exits 1 on any difference, and also when
// no Lite tile was grouped or none faded, because then the run proved nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openScene } from './scene.mjs';

// gl/lite.js fetches its chunks relative to its own URL, which in Node is a file URL.
globalThis.fetch = async (u) => {
  try {
    const b = readFileSync(fileURLToPath(String(u)));
    return { ok: true, status: 200, json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  } catch { return { ok: false, status: 404 }; }
};

const { createGLView } = await import(new URL('../../client/game/js/panels/gl/context.js', import.meta.url).href);
const { liteView, liteStats } = await import(new URL('../../client/game/js/panels/gl/lite.js', import.meta.url).href);

// The fake WebGL2 of retain-check.mjs: every ARRAY_BUFFER mirrored, every draw's floats recorded.
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
// To 1e-6 of a tile. A kept record's x + ox and a streamed one's are the same sum to float64
// precision, so away from 0 they land on the same float32; at 0 the cancellation leaves 1e-17 one
// way and 0 (or -0) the other. A stale offset is a fraction of a tile, so it can't hide under this.
const tris = (draws) => {
  const out = [];
  for (const { st, f } of draws) for (let i = 0; i + 3 * st <= f.length; i += 3 * st) {
    out.push(st + ':' + Array.from(f.subarray(i, i + 3 * st), (x) => Math.round(x * 1e6) || 0).join(','));
  }
  return out.sort();
};
const plainOf = (list) => { const p = (list || []).slice(); for (const k of ['deep', 'now', 'atlas']) if (list && list[k] != null) p[k] = list[k]; return p; };

const scene = await openScene({ record: false });
const ws = scene.ws;
ws.RENDER_TUNE.glassLite = 1;
ws.installGLLite(liteView);
let hook = null;
ws.installGLWorld((cells, cam, o) => { hook = { cam, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });

const layers = [['sprites', (v, l, c) => v.drawSprites(c, l, 360, 1)], ['strokes', (v, l, c) => v.drawStrokes(c, l, 360)], ['decals', (v, l, c) => v.drawDecals(c, l, 360, 0, null, null)]];
// Civic at noon, Marrow at night: the lettering kept near, then the lit signs kept far.
const RUNS = [['civic', [911, 912], 13], ['marrow', [916, 909], 23]];
let frames = 0, bad = 0, liteGrouped = 0, faded = 0, broken = 0;
const shown = [];
// The two promises as structure, which the triangles only show when an arena happens to re-place a
// group at the wrong moment: across every frame, a Lite record (it has `_b`) is in one group array
// only, and a record that has been grouped is never streamed, nor a streamed one grouped.
const groupOf = { sprites: new Map(), strokes: new Map(), decals: new Map() };
const streamed = { sprites: new Set(), strokes: new Set(), decals: new Set() };
function promises(name, list) {
  const inGroup = new Set();
  for (const g of list.groups || []) for (const r of g.recs) {
    if (!r || !r._b) continue;
    inGroup.add(r);
    const prev = groupOf[name].get(r);
    if (prev && prev !== g.recs) { broken++; if (shown.length < 4) shown.push(`${name}: a Lite record is in two group arrays`); }
    if (streamed[name].has(r)) { broken++; if (shown.length < 4) shown.push(`${name}: a Lite record was streamed and then grouped`); }
    groupOf[name].set(r, g.recs);
  }
  for (const r of list) {
    if (!r || !r._b || inGroup.has(r)) continue;
    if (groupOf[name].has(r)) { broken++; if (shown.length < 4) shown.push(`${name}: a grouped Lite record was streamed`); }
    streamed[name].add(r);
  }
}
try {
  for (const [place, at, hour] of RUNS) {
    const A = fakeView(), B = fakeView();
    // The chunks load on the first paints; Lite answers null until the one under the window has.
    for (let k = 0; k < 100; k++) {
      ws.paintWindshield('__perf', scene.view(at, 'cab', { hour }));
      if (liteStats().faceHits > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    // ⚠ THE TRAP NEEDS ALL THREE OF THESE, and ten frames in one window had none of them. An arena
    // re-writes the groups it keeps when it fills or grows, from their live records; the window
    // recentring every six frames re-keys every group, which fills it. A tile has to fade while its
    // group is kept and then come back, so the camera swings forward and back along the heading and
    // the haze band sweeps over the same tiles both ways.
    for (let i = 0; i < 20; i++) {
      const c = Math.floor(i / 6) % 2 ? [at[0] + 1, at[1]] : at, h = 40 * Math.PI / 180, s = 1.1 * Math.sin(i * 0.8);
      const v = scene.view(c, 'cab', { hour, heading: 40, mapOffset: { x: s * Math.sin(h), y: -s * Math.cos(h) } });
      ws.paintWindshield('__perf', v);
      const { cam, o } = hook;
      for (const [name, call] of layers) {
        const list = o[name] || [];
        promises(name, list);
        for (const g of list.groups || []) if (g.recs[0] && g.recs[0]._b) liteGrouped += g.recs.length;
        for (const r of list) if (r && r._b && (r.alpha ?? r.a ?? 1) < 0.999 && (r._a ?? 1) >= 0.999) faded++;
        A.draws.length = 0; B.draws.length = 0;
        call(A.view, plainOf(list), cam); call(B.view, list, cam);
        const a = tris(A.draws), b = tris(B.draws);
        frames++;
        if (a.length !== b.length || a.some((t, j) => t !== b[j])) {
          bad++;
          if (shown.length < 4) shown.push(`${name} ${place} ${hour}:00 frame ${i}: ${a.length} triangles plain, ${b.length} with groups${a.length === b.length ? ', ' + a.filter((t, j) => t !== b[j]).length + ' differ' : ''}`);
        }
      }
    }
  }
} finally { scene.close(); ws.installGLLite(null); }
for (const l of shown) console.error('  ✗ ' + l);
if (broken) { console.error(`lite-retain: ${broken} Lite records broke emitTile's promises (one group array each; grouped and streamed never mixed)`); process.exit(1); }
if (bad) { console.error(`lite-retain: ${bad} of ${frames} layer-frames differ between Lite's groups and its records sent plain`); process.exit(1); }
if (!liteGrouped) { console.error('lite-retain: no Lite record was ever grouped, so nothing was checked (is the bake loading? liteStats ' + JSON.stringify(liteStats()) + ')'); process.exit(1); }
if (!faded) { console.error('lite-retain: no Lite record faded in the haze, so the fading path was never checked'); process.exit(1); }
console.log(`✓ lite-retain: ${frames} layer-frames identical, ${liteGrouped} Lite records grouped and ${faded} streamed fading.`);
