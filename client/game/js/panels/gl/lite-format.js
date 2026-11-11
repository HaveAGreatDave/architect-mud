// GLASS LITE · THE CHUNK FORMAT.
//
// The baked city is one file per 32×32 tiles of the surface map, `client/game/assets/lite/c_<cx>_<cy>.bin`,
// written by scripts/lite/bake.mjs and read by gl/lite.js and scripts/lite/smoke.mjs. Each file holds,
// for every building tile in it the bake could capture:
//   - its faces exactly as gl/world.js `tileMesh` builds them (positions, normal, day and night
//     colour, surface key, material, baked occlusion), so the GL pass draws the same mesh with the
//     same atlas, and the phone never runs the model's arm to get it;
//   - its signs, lights and masts as the arm pushes them into a frame's sinks, captured from all four
//     sides at noon and at midnight and stored relative to the tile's centre;
//   - the recipe for each sign's artwork (a sign, a marquee board, a tag, a flat panel), which the
//     phone bakes itself, because a file can't hold a canvas and the lettering needs the device's
//     own font metrics.
//
// Layout: 'GLT1', the header's byte length (u32), the header as JSON, padding to 4 bytes, then the
// faces (FACE_BYTES each) and the vertices (VERT_BYTES each). Positions are int16 against a scale per
// tile, so a building a tile wide is held to about 3e-5 of a tile.
//
// Pure: no DOM, no WebGL, so the bake and the gate run it in Node.

export const LITE_CHUNK = 32;
const MAGIC = 0x31544c47;   // 'GLT1', little-endian
const FACE_BYTES = 20, VERT_BYTES = 8;
const NO_TEX = 0xffff;

export const chunkOf = (x, y) => [Math.floor(x / LITE_CHUNK), Math.floor(y / LITE_CHUNK)];
export const chunkName = (cx, cy) => `c_${cx}_${cy}.bin`;

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// A sink record moved to tile-local coordinates (the tile's centre at the origin) and trimmed for the
// file: every number to four places, the artwork replaced by an index into the chunk's recipes.
export function localRecord(kind, r, dx, dy) {
  const P = (q) => (q ? [r4(q[0] - dx), r4(q[1] - dy), r4(q[2])] : q);
  const out = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'img' || k === 'key' || k === '_who' || typeof v === 'function') continue;
    out[k] = typeof v === 'number' ? r4(v) : v;
  }
  if (kind === 'd') {
    out.p = r.p.map(P);
    if (r.rp) out.rp = r.rp.map(P);
    if (r.rc) out.rc = r.rc.map(P);
  } else if (kind === 'sp') {
    out.x = r4(r.x - dx); out.y = r4(r.y - dy); out.z = r4(r.z);
  } else if (kind === 'st') {
    out.a = P(r.a); out.b = P(r.b);
    if (r.ra) out.ra = P(r.ra);
    if (r.rb) out.rb = P(r.rb);
  }
  return out;
}

// tiles: [{ x, y, key, bt, bn, faces, recs: { n0: { d, sp, st }, n1: { d, sp, st } } }]
// A face is tileMesh's: { p, n, rgb, rgbN, kind, flat, alpha, mat, texKey, ao }. A decal in `recs`
// carries `art`, an index into `arts`.
export function encodeChunk({ cx, cy, tiles, arts }) {
  const tex = [], texIx = new Map(), kinds = [], kindIx = new Map();
  const ix = (tab, map, s) => { let i = map.get(s); if (i == null) { i = tab.length; tab.push(s); map.set(s, i); } return i; };
  let nf = 0, nv = 0;
  for (const t of tiles) for (const f of t.faces) {
    if (f.p.length > 255) throw new Error(`lite: a face with ${f.p.length} points at ${t.x},${t.y}`);
    nf++; nv += f.p.length;
  }
  const faceBuf = new DataView(new ArrayBuffer(nf * FACE_BYTES)), vertBuf = new DataView(new ArrayBuffer(nv * VERT_BYTES));
  let fo = 0, vo = 0, fi = 0, vi = 0;
  const head = [];
  for (const t of tiles) {
    let m = 0;
    for (const f of t.faces) for (const p of f.p) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
    const s = Math.max(m, 1e-6) / 32767;
    head.push({ x: t.x, y: t.y, k: t.key, bt: t.bt, bn: t.bn || undefined, an: t.an ? 1 : undefined, s, f0: fi, nf: t.faces.length, v0: vi, r: t.recs });
    for (const f of t.faces) {
      const flat = f.flat === undefined || f.flat === null ? 255 : f.flat === 2 ? 2 : f.flat ? 1 : 0;
      // Unit length before it's quantised, so a long normal keeps its direction.
      const nl = f.n ? Math.hypot(f.n[0], f.n[1], f.n[2]) : 0;
      const n = nl > 1e-9 ? [f.n[0] / nl, f.n[1] / nl, f.n[2] / nl] : [0, 0, 0];
      const rgb = f.rgb || [128, 128, 128], rgbN = f.rgbN;
      faceBuf.setUint8(fo, ix(kinds, kindIx, String(f.kind || '')));
      faceBuf.setUint8(fo + 1, flat);
      faceBuf.setUint8(fo + 2, f.alpha == null ? 255 : u8(f.alpha * 254));
      faceBuf.setUint8(fo + 3, f.mat | 0);
      faceBuf.setUint16(fo + 4, f.texKey ? ix(tex, texIx, f.texKey) : NO_TEX, true);
      faceBuf.setUint8(fo + 6, f.p.length);
      faceBuf.setUint8(fo + 7, (rgbN ? 1 : 0) | (f.ao ? 2 : 0));
      faceBuf.setInt8(fo + 8, q8(n[0])); faceBuf.setInt8(fo + 9, q8(n[1])); faceBuf.setInt8(fo + 10, q8(n[2]));
      faceBuf.setUint8(fo + 12, u8(rgb[0])); faceBuf.setUint8(fo + 13, u8(rgb[1])); faceBuf.setUint8(fo + 14, u8(rgb[2]));
      if (rgbN) { faceBuf.setUint8(fo + 15, u8(rgbN[0])); faceBuf.setUint8(fo + 16, u8(rgbN[1])); faceBuf.setUint8(fo + 17, u8(rgbN[2])); }
      fo += FACE_BYTES; fi++;
      f.p.forEach((p, k) => {
        vertBuf.setInt16(vo, Math.round(p[0] / s), true); vertBuf.setInt16(vo + 2, Math.round(p[1] / s), true); vertBuf.setInt16(vo + 4, Math.round(p[2] / s), true);
        vertBuf.setUint8(vo + 6, f.ao ? u8((f.ao[k] == null ? 1 : f.ao[k]) * 255) : 255);
        vo += VERT_BYTES; vi++;
      });
    }
  }
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, cx, cy, n: LITE_CHUNK, tex, kinds, arts, tiles: head, nf, nv }));
  const pad = (4 - ((8 + json.length) % 4)) % 4;
  const out = new Uint8Array(8 + json.length + pad + faceBuf.byteLength + vertBuf.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(new Uint8Array(faceBuf.buffer), 8 + json.length + pad);
  out.set(new Uint8Array(vertBuf.buffer), 8 + json.length + pad + faceBuf.byteLength);
  return out;
}

// The header alone (the gate checks a chunk's tiles without decoding a vertex).
export function chunkHeader(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('lite: not a GLASS Lite chunk');
  const len = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + len)));
  head.bodyAt = 8 + len + ((4 - ((8 + len) % 4)) % 4);
  return head;
}

// Every tile's faces in tileMesh's shape, less `uv` and `edge`, which `finish` (when given) adds.
export function decodeChunk(buf, finish = null) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const head = chunkHeader(u);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const F = head.bodyAt, V = F + head.nf * FACE_BYTES;
  const tiles = head.tiles.map((t) => {
    const faces = [];
    let vo = V + t.v0 * VERT_BYTES;
    for (let i = 0; i < t.nf; i++) {
      const fo = F + (t.f0 + i) * FACE_BYTES;
      const flatB = dv.getUint8(fo + 1), alphaB = dv.getUint8(fo + 2), texI = dv.getUint16(fo + 4, true);
      const np = dv.getUint8(fo + 6), flags = dv.getUint8(fo + 7);
      const p = new Array(np), ao = flags & 2 ? new Array(np) : null;
      for (let k = 0; k < np; k++) {
        p[k] = [dv.getInt16(vo, true) * t.s, dv.getInt16(vo + 2, true) * t.s, dv.getInt16(vo + 4, true) * t.s];
        if (ao) ao[k] = dv.getUint8(vo + 6) / 255;
        vo += VERT_BYTES;
      }
      const f = {
        p, kind: head.kinds[dv.getUint8(fo)],
        n: [dv.getInt8(fo + 8) / 127, dv.getInt8(fo + 9) / 127, dv.getInt8(fo + 10) / 127],
        rgb: [dv.getUint8(fo + 12), dv.getUint8(fo + 13), dv.getUint8(fo + 14)],
        rgbN: flags & 1 ? [dv.getUint8(fo + 15), dv.getUint8(fo + 16), dv.getUint8(fo + 17)] : null,
        mat: dv.getUint8(fo + 3), texKey: texI === NO_TEX ? null : head.tex[texI],
      };
      if (flatB !== 255) f.flat = flatB === 2 ? 2 : !!flatB;
      if (alphaB !== 255) f.alpha = alphaB / 254;
      if (ao) f.ao = ao;
      faces.push(f);
    }
    if (finish) finish(faces);
    return { x: t.x, y: t.y, key: t.k, bt: t.bt, bn: t.bn, an: !!t.an, faces, recs: t.r };
  });
  return { cx: head.cx, cy: head.cy, arts: head.arts || [], tiles };
}
