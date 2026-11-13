// GLASS LITE · THE BAKED CITY ON THE DEVICE.
//
// GLASS 2 on a phone pays nearly the whole desktop CPU bill every frame, and most of it is each
// building's arm: run to capture its mesh when it comes into the window, and run again every frame
// for its signs, lights and masts. GLASS Lite draws those buildings from the bake instead
// (scripts/lite/bake.mjs writes client/game/assets/lite/, gl/lite-format.js is the file), through the same
// GL pass, atlas and shader, so the picture is GLASS 2's and only the CPU work goes:
//   - `liteFacesFor(it, key)` hands gl/world.js `tileMesh` a tile's baked faces, when the bake built
//     it exactly the way the pass is asking for (its meshParams);
//   - `liteView(wcx, wcy)` is what windshield.js asks each Lite frame (installGLLite): which tiles
//     the bake holds, and the tile's signs, lights and masts pushed into the frame's sinks.
// The artwork for each sign is baked here, once per chunk, from the recipe the bake recorded
// (windshield.js `liteArtTex`), so lettering uses this device's own fonts.
//
// Chunks load on demand round the window and stay loaded; the whole map is under 10 MB decoded.
// Until the chunk under the window has loaded, the frame is plain GLASS 2.

import { decodeChunk, chunkOf, chunkName, LITE_CHUNK } from './lite-format.js';
import { faceUVs } from './atlas.js';
import { faceEdges } from './world.js';
import { liteArtTex, liteFitQuad } from '../windshield.js';

// client/game/assets/lite/, from here (client/game/js/panels/gl/): /assets/lite/ in the game, and
// inside the Modelshop's served tree.
const BASE = new URL('../../../assets/lite/', import.meta.url);
// How far round the window's centre chunks are fetched, in tiles: the aircraft window's radius and a margin.
const REACH = 40;

let index = null, indexState = 'idle';
const chunks = new Map();   // 'cx,cy' → { state, tiles: Map('x,y' → tile), arts, tex }
const tiles = new Map();    // 'x,y' → tile, for every loaded chunk
const stats = { chunks: 0, tiles: 0, decodeMs: 0, failed: 0, faceHits: 0, faceMisses: 0, missKeys: [] };

function loadIndex() {
  if (indexState !== 'idle') return;
  indexState = 'loading';
  fetch(new URL('index.json', BASE)).then((r) => (r.ok ? r.json() : null)).then((j) => {
    index = j && Array.isArray(j.chunks) ? new Set(j.chunks.map((c) => c.cx + ',' + c.cy)) : new Set();
    indexState = 'ready';
  }).catch(() => { index = new Set(); indexState = 'ready'; });
}

// Faces in tileMesh's shape: the UVs and bevel distances it adds, and the strip's two summaries.
function finishFaces(faces) {
  let r = 0, g = 0, b = 0, n = 0, top = -1e9;
  for (const f of faces) {
    f.uv = faceUVs(f);
    f.edge = faceEdges(f);
    for (const p of f.p) if (p[2] > top) top = p[2];
    if (f.kind === 'wall' && f.rgb) { r += f.rgb[0]; g += f.rgb[1]; b += f.rgb[2]; n++; }
  }
  if (n) faces.avgRgb = [r / n, g / n, b / n];
  if (top > -1e8) faces.topZ = top;
}

function loadChunk(cx, cy) {
  const ck = cx + ',' + cy;
  if (chunks.has(ck) || !index || !index.has(ck)) return;
  const ch = { state: 'loading', tiles: new Map(), arts: [], tex: [] };
  chunks.set(ck, ch);
  fetch(new URL(chunkName(cx, cy), BASE)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then((buf) => {
    const t0 = performance.now();
    const dc = decodeChunk(buf, finishFaces);
    ch.arts = dc.arts;
    for (const t of dc.tiles) {
      t.ck = ck;
      ch.tiles.set(t.x + ',' + t.y, t);
      tiles.set(t.x + ',' + t.y, t);
    }
    ch.state = 'ready';
    stats.chunks++; stats.tiles += dc.tiles.length; stats.decodeMs += performance.now() - t0;
  }).catch((e) => { ch.state = 'failed'; stats.failed++; console.warn('[glass lite] chunk ' + ck + ' did not load:', e && e.message || e); });
}

// A chunk's artwork, baked on first use. Null where the recipe bakes nothing on this device.
function artOf(t, i) {
  const ch = chunks.get(t.ck);
  if (!ch) return null;
  if (ch.tex[i] === undefined) {
    let tex = null;
    try { tex = liteArtTex(ch.arts[i]); } catch { tex = null; }
    ch.tex[i] = tex || null;
  }
  return ch.tex[i];
}

// ── A TILE'S RECORDS, BUILT ONCE AND MOVED EACH FRAME ───────────────────────────────────────────
// Each baked record becomes one live sink record the first time its tile is drawn at that hour, with
// its artwork resolved. A frame then only writes its corners (base + the camera offset) and its fade:
// no copy and no allocation, which on a night street was most of what Lite's emit cost. A live
// record keeps its base points in `_b` and its own alpha in `_a`; the GL passes read neither.
const P3 = (q) => (q ? [q[0], q[1], q[2]] : null);
function liveSet(t, R) {
  const de = [], sp = [], st = [];
  for (const d of R.d) {
    const img = artOf(t, d.art);
    if (!img) continue;
    // A sign's raw board, fitted to the texture this device baked (the bake's stub had no real fonts).
    const rp = d.fit && d.rc ? liteFitQuad(d.rc, img) : d.rp;
    const rec = { ...d, key: 'lite:' + t.ck + '#' + d.art, img };
    delete rec.art; delete rec.fit;
    const base = { p: (d.fit && rp ? rp : d.p).map(P3), rp: rp ? rp.map(P3) : null, rc: d.rc ? d.rc.map(P3) : null };
    rec.p = base.p.map(P3);
    if (base.rp) rec.rp = base.rp.map(P3);
    if (base.rc) rec.rc = base.rc.map(P3);
    rec._b = base; rec._a = d.alpha == null ? 1 : d.alpha;
    de.push(rec);
  }
  for (const s of R.sp) sp.push({ ...s, _b: [s.x, s.y], _a: s.a == null ? 1 : s.a });
  for (const s of R.st) {
    const rec = { ...s, a: P3(s.a), b: P3(s.b), _b: [s.a, s.b, s.ra || null, s.rb || null], _a: s.alpha == null ? 1 : s.alpha };
    if (s.ra) rec.ra = P3(s.ra);
    if (s.rb) rec.rb = P3(s.rb);
    st.push(rec);
  }
  return { de, sp, st };
}
const move = (pts, base, dx, dy) => { for (let i = 0; i < pts.length; i++) { pts[i][0] = base[i][0] + dx; pts[i][1] = base[i][1] + dy; } };
const move1 = (q, b, dx, dy) => { q[0] = b[0] + dx; q[1] = b[1] + dy; };

// One tile's records for one hour, placed at (dx, dy) relative to the camera, `f` tiles ahead of it.
// The ranges are GLASS 2's own: an arm sheds its lettering and fine trim past the near-detail ring
// (`lodNear`) and its window glows past the bloom reach (`glBloomFar`), and keeps a beacon (an `air`
// light) and anything with a glow to the draw limit. Without them Lite pushed half as many records
// again as the GLASS 2 frame it stands in for.
//
// ⚠ ON THE GPU, NOT RE-SENT. `G` is the frame's window ({ ox, oy, w }, null with glRetain off): a tile
// at full strength hands its arrays to the sinks as retained groups (gl/retain.js), as armReplay does,
// so the sprite, stroke and decal layers write it once per map window instead of once per frame. A
// record's x plus the camera's `ox` is the window's own coordinate, which is what the arena keeps.
// ⚠ AND A RECORD MOVES ONLY WITH THE ONE ARRAY IT'S GROUPED IN. An arena that fills re-places the
// groups it's keeping from their live records, with the offset it last saw for each; a record moved
// under another array, or moved and streamed, would be written back in the wrong place. So the
// ranges are disjoint arrays (`groupsOf`), and a tile fading in the haze streams copies (`fadeOf`).
function emitTile(t, dx, dy, alpha, night, SP, DE, ST, f, tune, LV, G) {
  if (!t.recs) return;
  const n = night > 0.5 ? 'n1' : 'n0';
  if (!t.live) t.live = {};
  let L = t.live[n];
  if (!L) {
    const R = t.recs[n];
    if (!R) return;
    L = t.live[n] = liveSet(t, { ...R, st: R.st === 'n0' ? t.recs.n0.st : R.st });
  }
  const near = (tune && tune.lodNear) || 20, bloom = (tune && tune.glBloomFar) || 22;
  const close = !(f > near), lit = !(f > bloom), nite = night > 0.5;
  if (G && alpha === 1) {
    const K = groupsOf(L);
    if (DE) { if (close) keepDe(DE, K.de, dx, dy, G); if (close || nite) keepDe(DE, K.deLit, dx, dy, G); }
    if (SP) { if (lit) keepSp(SP, K.sp, dx, dy, G); keepSp(SP, K.spAir, dx, dy, G); }
    if (ST) keepSt(ST, L.st, dx, dy, G);
  } else {
    if (G) L = fadeOf(L);
    streamTile(L, dx, dy, alpha, SP, DE, ST, close, lit, nite);
  }
  // The moving parts go back to the frame, which draws each with the live clock (liteLiveDraw).
  const R = t.recs[n];
  if (LV && R && R.lv) for (const l of R.lv) LV.push(l);
}

// The ranges as disjoint arrays: the lettering that goes past `lodNear` (`de`) and the lit signs kept
// at night (`deLit`); the window glows that go past `glBloomFar` (`sp`) and the beacons (`spAir`).
function groupsOf(L) {
  return L.keep || (L.keep = {
    de: L.de.filter((d) => !(d.emit > 0)), deLit: L.de.filter((d) => d.emit > 0),
    sp: L.sp.filter((s) => !s.air), spAir: L.sp.filter((s) => s.air),
  });
}
// The tile's records again, with points of their own, for the frames it fades: see emitTile.
function fadeOf(L) {
  return L.fade || (L.fade = {
    de: L.de.map((d) => ({ ...d, p: d.p.map(P3), rp: d.rp ? d.rp.map(P3) : d.rp, rc: d.rc ? d.rc.map(P3) : d.rc })),
    sp: L.sp.map((s) => ({ ...s })),
    st: L.st.map((s) => ({ ...s, a: P3(s.a), b: P3(s.b), ra: s.ra ? P3(s.ra) : s.ra, rb: s.rb ? P3(s.rb) : s.rb })),
  });
}
const group = (sink, recs, G) => { (sink.groups || (sink.groups = [])).push({ recs, at: sink.length, ox: G.ox, oy: G.oy, w: G.w }); };
function keepDe(sink, recs, dx, dy, G) {
  if (!recs.length) return;
  group(sink, recs, G);
  for (const d of recs) {
    move(d.p, d._b.p, dx, dy);
    if (d.rp) move(d.rp, d._b.rp, dx, dy);
    if (d.rc) move(d.rc, d._b.rc, dx, dy);
    d.alpha = d._a;
    sink.push(d);
  }
}
function keepSp(sink, recs, dx, dy, G) {
  if (!recs.length) return;
  group(sink, recs, G);
  for (const s of recs) { s.x = s._b[0] + dx; s.y = s._b[1] + dy; s.a = s._a; sink.push(s); }
}
function keepSt(sink, recs, dx, dy, G) {
  if (!recs.length) return;
  group(sink, recs, G);
  for (const s of recs) {
    move1(s.a, s._b[0], dx, dy); move1(s.b, s._b[1], dx, dy);
    if (s.ra) move1(s.ra, s._b[2], dx, dy);
    if (s.rb) move1(s.rb, s._b[3], dx, dy);
    s.alpha = s._a;
    sink.push(s);
  }
}
// Every record down the stream, with its fade, as before the groups.
function streamTile(L, dx, dy, alpha, SP, DE, ST, close, lit, nite) {
  if (DE) for (const d of L.de) {
    if (!close && !(d.emit > 0 && nite)) continue;
    move(d.p, d._b.p, dx, dy);
    if (d.rp) move(d.rp, d._b.rp, dx, dy);
    if (d.rc) move(d.rc, d._b.rc, dx, dy);
    d.alpha = d._a * alpha;
    DE.push(d);
  }
  if (SP) for (const s of L.sp) {
    if (!lit && !s.air) continue;
    s.x = s._b[0] + dx; s.y = s._b[1] + dy; s.a = s._a * alpha;
    SP.push(s);
  }
  // ⚠ EVERY STROKE, AT EVERY RANGE. A lattice mast is thin strokes and GLASS 2 keeps it to the
  // draw limit (its web LOD thins it); shed past `lodNear`, the helm's view of the harbour lost a
  // lit tower's whole lattice and kept only its glow.
  if (ST) for (const s of L.st) {
    move1(s.a, s._b[0], dx, dy); move1(s.b, s._b[1], dx, dy);
    if (s.ra) move1(s.ra, s._b[2], dx, dy);
    if (s.rb) move1(s.rb, s._b[3], dx, dy);
    s.alpha = s._a * alpha;
    ST.push(s);
  }
}

// The bake holds this tile AS THE LIVE MAP HAS IT: the same building type and name. The bake follows
// the map snapshot, which can lag content; a tile renamed, retyped or built since then isn't Lite's,
// and its own arm draws it.
const same = (t, c) => !!t && (!c || ((t.bt || null) === (c.bt || null) && (t.bn || null) === (c.bn || null)));
// ⚠ AN ANIMATED TILE (`an`, a lighthouse's turning light) ISN'T LITE'S HERE: its arm runs each frame
// for its signs, lights and masts, as a live building's does on GLASS 2. Its mesh still comes from
// the bake (liteFacesFor doesn't ask), since the mesh never moves.
const VIEW = {
  has: (wx, wy, c) => { const t = tiles.get(wx + ',' + wy); return same(t, c) && !t.an; },
  emit: (wx, wy, dx, dy, alpha, night, SP, DE, ST, f, tune, LV, G) => {
    const t = tiles.get(wx + ',' + wy);
    if (t) emitTile(t, dx, dy, alpha, night, SP, DE, ST, f, tune, LV, G || null);
  },
};

// windshield.js asks this each Lite frame (installGLLite). Fetches what the window needs and answers
// null until the chunk under its centre has loaded.
export function liteView(wcx, wcy) {
  if (indexState !== 'ready') { loadIndex(); return null; }
  const [a0, b0] = chunkOf(wcx - REACH, wcy - REACH), [a1, b1] = chunkOf(wcx + REACH, wcy + REACH);
  for (let cy = b0; cy <= b1; cy++) for (let cx = a0; cx <= a1; cx++) loadChunk(cx, cy);
  const [cx, cy] = chunkOf(Math.round(wcx), Math.round(wcy));
  const here = chunks.get(cx + ',' + cy);
  // A window over a chunk the bake doesn't have (open country, the void) has nothing to wait for.
  if (here && here.state === 'loading') return null;
  return VIEW;
}

// gl/world.js `tileMesh` asks this on a Lite frame: the tile's baked faces, or null to capture.
// A build key with every decimal to six places. The bake runs in Node and the frame in a browser,
// whose Math functions agree to about 1e-12 and not bit for bit, so a tile's footprint came back
// 0.8365636871758151 from one and 0.8365636871763854 from the other, and an exact match missed it.
const keyNorm = (k) => String(k).replace(/-?\d+\.\d+/g, (m) => (+m).toFixed(6));
export function liteFacesFor(it, key) {
  const t = tiles.get(it.wx + ',' + it.wy);
  if (t && same(t, it.c) && (t.keyN || (t.keyN = keyNorm(t.key))) === keyNorm(key)) { stats.faceHits++; return t.faces; }
  // A miss is captured live, which is right (a venue in another state, a building moved since the
  // bake) and slow, so it's counted: a bake that misses everywhere is a stale bake.
  stats.faceMisses++;
  if (t && stats.missKeys.length < 8) stats.missKeys.push(it.wx + ',' + it.wy + ' baked ' + t.key + ' asked ' + key);
  return null;
}

// For the perf meter and benches: what's loaded and what decoding it cost.
export function liteStats() { return { ...stats, missKeys: stats.missKeys.slice(), index: indexState, size: LITE_CHUNK }; }
