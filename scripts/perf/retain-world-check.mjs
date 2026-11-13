// retain-world-check: does a recentre leave the solids' retained groups where their records are?
//
//   node scripts/perf/retain-world-check.mjs [--tune k=v,...]
//
// With RENDER_TUNE.retainWorld the solids layer keeps its retained groups (the street kit's sets, a
// replayed arm's bays, a park) in world tiles less an anchor and draws them with uRetShift, and the kit
// and armReplay move their points in place on a recentre and hand back the same array (retain in
// gl/solids.js). Get the shift, the anchor or the per-group check wrong and a kept group is drawn where
// the window was some resends ago, which no still-view check can see.
//
// This flies the perf:move route (straight ahead, the map resent and recentred every RESEND frames
// and interned, as the client does) at two places, and hands each frame's bay list to two
// gl/context.js views under a fake WebGL2 that mirrors every buffer and every uRetShift: one with
// the groups and sets flattened into the stream, one with them as they are. The retained view keeps
// its buffer across frames. Each draw's points are moved by the shift it was drawn with, as the
// shader does, and the triangles have to match the streamed view's to 1e-4 of a tile (float32 at
// the window's size is about 1e-5; a stale group is a whole tile out). It also checks the kept prop
// casters (keptCasters in gl/propshadow.js, which cache per array) against a face-by-face walk.
// Exits 1 on any difference, and when no group was ever kept across a recentre, because then the
// run proved nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openScene, PLACES } from './scene.mjs';
import { internMap } from '../../client/game/js/panels/map-intern.js';

globalThis.fetch = async (u) => {
  try {
    const b = readFileSync(fileURLToPath(String(u)));
    return { ok: true, status: 200, json: async () => JSON.parse(b.toString('utf8')), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  } catch { return { ok: false, status: 404 }; }
};
const { createGLView } = await import(new URL('../../client/game/js/panels/gl/context.js', import.meta.url).href);
const { liteView, liteStats } = await import(new URL('../../client/game/js/panels/gl/lite.js', import.meta.url).href);
const { buildPropCasters, keptGroupsIn, keptAnchor, keptMatrix, PROP_SHADOW_TUNE } = await import(new URL('../../client/game/js/panels/gl/propshadow.js', import.meta.url).href);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

function fakeView() {
  let vao = null, ab = null, shift = [0, 0];
  const vaoBuf = new Map(), mirrors = new Map(), strideOf = new Map();
  let draws = [];
  const fns = {
    createBuffer: () => ({ buf: 1 }), createVertexArray: () => ({ vao: 1 }), createTexture: () => ({ tex: 1 }),
    bindVertexArray: (v) => { vao = v; },
    bindBuffer: (t, b) => { if (t === 'ARRAY_BUFFER') { ab = b; if (vao) vaoBuf.set(vao, b); } },
    vertexAttribPointer: (l, n, ty, norm, stride) => { if (ab) strideOf.set(ab, stride / 4); },
    bufferData: (t, size) => { if (t === 'ARRAY_BUFFER' && typeof size === 'number') mirrors.set(ab, new Float32Array(size / 4)); },
    bufferSubData: (t, off, data, src = 0, len) => { if (t !== 'ARRAY_BUFFER') return; const m = mirrors.get(ab); if (!m) return; const n = len ?? data.length - src; m.set(data.subarray(src, src + n), off / 4); },
    getUniformLocation: (p, name) => ({ name }),
    uniform2f: (loc, x, y) => { if (loc && loc.name === 'uRetShift') shift = [Math.fround(x), Math.fround(y)]; },
    drawArrays: (mode, first, n) => {
      const b = vao && vaoBuf.get(vao), st = strideOf.get(b);
      if (b && st && mirrors.get(b)) draws.push({ st, f: mirrors.get(b).slice(first * st, (first + n) * st), sx: shift[0], sy: shift[1] });
    },
    getProgramParameter: () => true, getShaderParameter: () => true, getExtension: () => null, isContextLost: () => false,
    getAttribLocation: () => 1, getParameter: () => 0, checkFramebufferStatus: () => 'COMPLETE',
    getContextAttributes: () => ({}),
  };
  const gl = new Proxy({}, { get: (o, k) => (k in fns ? fns[k] : typeof k === 'string' && /^[A-Z_0-9]+$/.test(k) ? k : () => ({})) });
  const view = createGLView({ width: 640, height: 360, getContext: () => gl, addEventListener() {} }, {});
  return { view, take: () => { const d = draws; draws = []; return d; } };
}
// Each triangle as its points, moved by its draw's shift in float32 as the shader adds it, and the
// rest of its floats rounded to 1e-6 as a key.
function tris(draws) {
  const out = [];
  for (const { st, f, sx, sy } of draws) for (let i = 0; i + 3 * st <= f.length; i += 3 * st) {
    const P = [], rest = [];
    for (let v = 0; v < 3; v++) {
      const o = i + v * st;
      P.push(Math.fround(f[o] + sx), Math.fround(f[o + 1] + sy), f[o + 2]);
      for (let k = 3; k < st; k++) rest.push(Math.round(f[o + k] * 1e6) || 0);
    }
    out.push({ P, key: rest.join(','), cx: (P[0] + P[3] + P[6]) / 3 });
  }
  return out.sort((a, b) => a.cx - b.cx);
}
const TOL = 1e-4;
// A multiset match with a tolerance: by centroid x, then every point and the key.
function sameTris(A, B) {
  if (A.length !== B.length) return `${A.length} triangles streamed, ${B.length} retained`;
  const used = new Uint8Array(A.length);
  let lo = 0;
  for (const b of B) {
    while (lo < A.length && A[lo].cx < b.cx - TOL) lo++;
    let hit = -1;
    for (let j = lo; j < A.length && A[j].cx <= b.cx + TOL; j++) {
      if (used[j] || A[j].key !== b.key) continue;
      let ok = true;
      for (let k = 0; k < 9 && ok; k++) ok = Math.abs(A[j].P[k] - b.P[k]) <= TOL;
      if (ok) { hit = j; break; }
    }
    if (hit < 0) return `a retained triangle at ${b.P.slice(0, 3).map((x) => x.toFixed(4)).join(',')} has no streamed twin`;
    used[hit] = 1;
  }
  return null;
}
// The bay list with every group and set put into the stream.
function flatOf(bay) {
  const p = bay.slice();
  if (bay.menv) p.menv = bay.menv;
  for (const s of bay.sets || []) for (const q of s) p.push(q);
  for (const q of bay.fades || []) p.push(q);
  return p;
}

const scene = await openScene({ record: false });
const ws = scene.ws;
ws.RENDER_TUNE.glassLite = 1;
ws.installGLLite(liteView);
for (const kv of (opt('--tune', '') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); ws.RENDER_TUNE[k] = Number(v); }
let hook = null;
ws.installGLWorld((cells, cam, o) => { hook = { cam, o }; return { canvas: { width: 640, height: 360 }, faces: 0 }; });
const clone = (map) => map.map((row) => row.map((c) => JSON.parse(JSON.stringify(c))));

const RESEND = 30;
const RUNS = [['halcyon', 'cockpit', 0.03, 92], ['marrow', 'cab', 0.02, 62]];
let frames = 0, bad = 0, kept = 0, casterBad = 0, castKept = 0;
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shown = [];
for (const [place, seat, speed, FRAMES] of RUNS) {
  const A = fakeView(), B = fakeView();
  const [X0, Y0] = PLACES[place];
  const v0 = scene.view([X0, Y0], seat, { hour: 13, heading: 0 });
  for (let k = 0; k < 100 && !(liteStats().faceHits > 0); k++) {
    ws.paintWindshield('__perf', v0);
    await new Promise((r) => setTimeout(r, 20));
  }
  let map = v0.map, k = 0, prevSets = new Set(), prevG = new Set();
  // The kept casters' arena anchor, as one arena in gl/propshadow.js holds it.
  const anchor = {}, noArena = { reset() {} };
  for (let i = 0; i < FRAMES; i++) {
    const dist = i * speed;
    if (i && i % RESEND === 0) {
      const k0 = k;
      k = Math.round(dist);
      map = internMap(map, X0, Y0 - k0, clone(scene.view([X0, Y0 - k], seat).map), X0, Y0 - k);
    }
    ws.paintWindshield('__perf', { ...v0, map, mapCenter: { x: X0, y: Y0 - k }, heading: 0, mapOffset: { x: 0.3, y: -(dist - k) } });
    const { cam, o } = hook, bay = o.bay;
    if (!bay) continue;
    // Groups that came back as the same array across a recentre are what this exists to test.
    const sets = new Set([...(bay.sets || []), ...((bay.groups || []).map((g) => g.recs))]);
    if (i % RESEND === 0 && i) for (const s of sets) if (prevSets.has(s)) kept++;
    prevSets = sets;
    // The streamed view and the retained one, every frame, so the retained one's buffer carries on.
    A.view.uploadSolids([flatOf(bay)]);
    B.view.uploadSolids([bay]);
    // Compared on the frames around a resend, where a stale group would show.
    const look = i % RESEND <= 2 || i === FRAMES - 1;
    for (const film of [false, true]) {
      A.view.drawSolids(cam, 360, { film }); B.view.drawSolids(cam, 360, { film });
      const ta = A.take(), tb = B.take();
      if (!look) continue;
      const why = sameTris(tris(ta), tris(tb));
      if (why) { bad++; if (shown.length < 6) shown.push(`${place} ${seat} frame ${i}${film ? ' film' : ''}: ${why}`); }
    }
    // The kept casters, as the prop and lamp maps' arena has them (keptGroupsIn), every frame so the
    // cache carries on as it does in the game: each group as written about the anchor, moved back by
    // the shift keptMatrix puts in front of the light matrix, against a walk of the same faces.
    const kSets = [...sets];
    const box = { x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9 };
    keptAnchor(noArena, anchor, bay.wc);
    const G = keptGroupsIn(kSets, box, PROP_SHADOW_TUNE, bay.wc, anchor);
    const gSet = new Set(G);
    if (i % RESEND === 0 && i) for (const g of G) if (prevG.has(g)) castKept++;
    prevG = gSet;
    if (look) {
      frames++;
      const M = keptMatrix(IDENT, anchor, new Array(16)), sx = M[12], sy = M[13];
      let n = 0;
      for (const g of G) n += g.floats;
      const d = new Float32Array(n);
      let o = 0;
      for (const g of G) o = g.write(d, o);
      const bufB = { data: new Float32Array(1024) };
      const b = buildPropCasters(bufB, box, { kept: kSets }, { ...PROP_SHADOW_TUNE, keep: 0 });
      let same = b.verts * 3 === n;
      for (let j = 0; same && j < n; j += 3) {
        same = Math.abs(Math.fround(d[j] + sx) - bufB.data[j]) <= TOL && Math.abs(Math.fround(d[j + 1] + sy) - bufB.data[j + 1]) <= TOL && d[j + 2] === bufB.data[j + 2];
      }
      if (!same) { casterBad++; if (shown.length < 6) shown.push(`${place} ${seat} frame ${i}: the kept casters' arena differs from a walk of the same faces`); }
    }
    // And the copy into the frame's buffer (keep 1), once a run: it builds again on any move, so asked
    // every frame it would undo the arena's entries above.
    if (i === FRAMES - 1) {
      const bufA = { data: new Float32Array(1024) }, bufB = { data: new Float32Array(1024) };
      const a = buildPropCasters(bufA, box, { kept: kSets }, { ...PROP_SHADOW_TUNE, keep: 1 });
      const b = buildPropCasters(bufB, box, { kept: kSets }, { ...PROP_SHADOW_TUNE, keep: 0 });
      let same = a.verts === b.verts;
      for (let j = 0; same && j < a.verts * 3; j++) same = bufA.data[j] === bufB.data[j];
      if (!same) { casterBad++; if (shown.length < 6) shown.push(`${place} ${seat} frame ${i}: the kept casters' copy differs from a walk of the same faces`); }
    }
  }
}
scene.close();
for (const s of shown) console.log('  ' + s);
console.log(`retain-world-check: ${frames} frames compared, ${kept} groups kept across a recentre (${castKept} of them casters), ${bad} solid draws differ, ${casterBad} caster sets differ`);
const want = (ws.RENDER_TUNE.retainWorld ?? 0) !== 0;
if (bad || casterBad || (want && !(kept && castKept))) { if (want && !(kept && castKept)) console.log('  no group (or no caster set) came back across a recentre: the run proved nothing'); process.exit(1); }
