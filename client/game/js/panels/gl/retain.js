// retain — groups of records kept on the GPU, for the layers whose records are camera-independent
// (Stage 3 phase 4 of docs/proposals/glass-headroom.md).
//
// A group is an array of records its producer promises not to change while it keeps handing the same
// array back. Its vertices are written once into a buffer of its own and drawn from there for as long
// as the group keeps arriving. gl/solids.js has its own copy of this (`retain`), written first; this
// one is the general form for the sprite, stroke and decal layers.
//
// Groups are placed end to end. A full buffer keeps every group seen in the last KEEP frames (not just
// this frame's: a turn brings a new set of tiles into view every frame, and rebuilding from this frame
// alone rebuilt every frame) and grows to twice that if they don't fit.
import { makeVertexStream } from './stream.js';

const KEEP = 120;

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} stride   floats a vertex, as the layer's own stream
 * @param {Array} attrs     the layer's attribute list, recorded into this arena's own VAO
 */
export function createArena(gl, stride, attrs, floor = 1 << 15) {
  const vao = gl.createVertexArray();
  const stream = makeVertexStream(gl, vao, stride, attrs, floor);
  let data = new Float32Array(floor), used = 0, frame = 0;
  const map = new Map();
  let runs = [], verts = 0, spans = [];

  /**
   * This frame's groups. Each is `{ key, floats, write(d, o) }`: `key` is the identity that says
   * "the same group as last frame" (an object, held by the caller), `floats` how many it writes, and
   * `write` writes them into `d` from `o` and returns the offset after.
   * Returns the vertex runs to draw, in buffer order, neighbours merged.
   */
  function retain(groups) {
    const now = ++frame;
    if (!groups || !groups.length) { runs = []; verts = 0; spans = []; return runs; }
    const place = (g, seen) => {
      if (map.has(g.key)) return;
      const at = used, w = g.write(data, at);
      map.set(g.key, { at: at / stride, n: (w - at) / stride, seen, g });
      used = w;
    };
    let add = 0;
    for (const g of groups) { const e = map.get(g.key); if (e) e.seen = now; else add += g.floats; }
    if (add) {
      if (used + add > data.length) {
        const keep = [];
        let need = add;
        for (const e of map.values()) if (now - e.seen < KEEP) { keep.push(e); need += e.n * stride; }
        if (need * 2 > data.length) data = new Float32Array(Math.max(need * 2, data.length * 2));
        map.clear(); used = 0;
        for (const e of keep) place(e.g, e.seen);
        for (const g of groups) place(g, now);
        stream.write(data, used);
      } else {
        const at0 = used;
        for (const g of groups) place(g, now);
        if (used > stream.capacity) stream.write(data, used);
        else stream.writeRange(data, at0, used - at0);
      }
    }
    spans = [];
    const seenKey = new Set();
    for (const g of groups) { const e = map.get(g.key); if (e && e.n && !seenKey.has(g.key)) { seenKey.add(g.key); spans.push({ at: e.at, n: e.n, g }); } }
    spans.sort((a, b) => a.at - b.at);
    runs = []; verts = 0;
    for (const s of spans) {
      const last = runs.length ? runs[runs.length - 1] : null;
      if (last && last[0] + last[1] === s.at) last[1] += s.n;
      else if (!last || s.at >= last[0] + last[1]) runs.push([s.at, s.n]);
      else continue;   // the same group twice in one frame: drawn once
      verts += s.n;
    }
    return runs;
  }
  // `spans` is this frame's ranges one group each, unmerged, with the group that asked for it: a layer
  // whose groups need their own state per draw (a decal's texture) draws these instead of `runs`.
  return { vao, retain, get runs() { return runs; }, get verts() { return verts; }, get spans() { return spans; } };
}
