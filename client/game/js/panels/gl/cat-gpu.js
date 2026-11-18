// A CAT SKINNED ON THE GPU. The Room Stage's cats (gl/room-beasts.js) move every frame: breathing, ears, tail, the
// clips (gl/cat-clips.js) and walking across the room. Skinning a carve on the CPU (skinCat) costs 60 to 130 ms, so here
// each carve is laid into a vertex buffer once, every vertex carrying the bones that own it, and only the bones go up
// each frame: up to 40 rows of 3×4 (catBoneRows in gl/cat-kit.js), from where each bone was on the carve to where it is now,
// in metres and in the room.
//
// The layout is the room's own (STRIDE 12: position, normal, palette, colour, material) with three more attributes:
// the four bones (5), their weights (6), and (7) the fur's length there and how much the breath lifts it. The room's
// ink, depth and beast shaders take the skin through skinVariant(), which only renames their inputs and calls
// catSkin() first, so a cat is lit and inked exactly as the beasts batch is.
//
// The body is indexed (about 30k vertices, 65k triangles). The fur is the same vertices drawn again, instanced, one
// instance a shell: the triangles with fur on them have their own index list, and each instance rides out along the
// normal by its height times the fur's length there, as furShells (gl/beast-kit.js) lays shells, with the material
// that tells the beast shader which layer it is. Only the beast shader draws shells; the ink and depth skip fur.
//
// The eyes, lids, whiskers and ear tufts (catBits) are small buffers of their own in the same layout, each quad on the
// one bone it rides on, built again only when their own number moves (a blink rebuilds the lids alone).
import { MAT } from './ballpark-mesh.js';
import { catBits, catBoneRows, solveRig } from './cat-kit.js';

export const CAT_STRIDE = 22;
export const CAT_BONES_MAX = 40;
export const CAT_ATTRS = [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 3, 32], [4, 1, 44], [5, 4, 48], [6, 4, 64], [7, 2, 80]];
const FUR = 50;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The skin, put before a vertex shader's main. aPos and aNor become the skinned position and normal (and the
// material, for a shell), so the rest of the shader is untouched. A normal keeps its length: a short one is an
// uninked piece, and a shell's is its fur's length, as furShells writes it.
const skinGlsl = (mat) => `
layout(location = 5) in vec4 aBones;
layout(location = 6) in vec4 aWeights;
layout(location = 7) in vec2 aRide;
uniform vec4 uCatBone[${CAT_BONES_MAX * 3}];
uniform float uCatBreath;   // the breath's lift, metres, times each vertex's own share of it
uniform float uCatShells;   // the shells this draw is (one an instance), or 0 for the body
uniform float uCatFurInk;   // the ink: how far out through the coat its line sits, of the fur's length (0 elsewhere)
vec3 aPos; vec3 aNor;${mat ? ` float ${mat};` : ''}
void catSkin() {
  vec3 p = vec3(0.0), n = vec3(0.0);
  vec4 q = vec4(aPos0, 1.0);
  for (int k = 0; k < 4; k++) {
    float w = aWeights[k];
    if (w <= 0.0) continue;
    int b = int(aBones[k] + 0.5) * 3;
    vec4 r0 = uCatBone[b], r1 = uCatBone[b + 1], r2 = uCatBone[b + 2];
    p += w * vec3(dot(r0, q), dot(r1, q), dot(r2, q));
    n += w * vec3(dot(r0.xyz, aNor0), dot(r1.xyz, aNor0), dot(r2.xyz, aNor0));
  }
  vec3 u = n * inversesqrt(max(dot(n, n), 1e-12));
  float h = uCatShells > 0.5 ? float(gl_InstanceID + 1) / uCatShells : 0.0;
  aPos = p + u * (aRide.x * max(h, uCatFurInk) + uCatBreath * aRide.y);
  aNor = h > 0.0 ? u * clamp(aRide.x, 1e-4, 0.09) : u * length(aNor0);${mat ? `
  ${mat} = h > 0.0 ? ${FUR}.0 + floor(h * 15.0 + 0.5) : ${mat}0;` : ''}
}
`;

/** The vertex shader `vs` (one of the room's: ink, depth, beasts) taking a skinned cat's buffer. */
export function skinVariant(vs) {
  let s = vs.replace('layout(location = 0) in vec3 aPos;', 'layout(location = 0) in vec3 aPos0;');
  s = s.includes('layout(location = 1) in vec3 aNor;')
    ? s.replace('layout(location = 1) in vec3 aNor;', 'layout(location = 1) in vec3 aNor0;')
    : s.replace('layout(location = 0) in vec3 aPos0;', 'layout(location = 0) in vec3 aPos0;\nlayout(location = 1) in vec3 aNor0;');
  // the material (aMat, or aTex in the ink): a shell's is its layer
  const m = /layout\(location = 4\) in float (\w+);/.exec(s);
  if (m) s = s.replace(m[0], `layout(location = 4) in float ${m[1]}0;`);
  if (!s.includes('void main() {')) throw new Error('skinVariant: no main');
  return s.replace('void main() {', skinGlsl(m?.[1]) + 'void main() {\n  catSkin();');
}

// one vertex into `d` at float offset `o`
function put(d, o, p, n, c, mat, bones, weights, fur, breath) {
  d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
  d[o + 3] = n[0]; d[o + 4] = n[1]; d[o + 5] = n[2];
  d[o + 6] = 0; d[o + 7] = 0;
  d[o + 8] = c[0]; d[o + 9] = c[1]; d[o + 10] = c[2];
  d[o + 11] = mat;
  d[o + 12] = bones[0]; d[o + 13] = bones[1]; d[o + 14] = bones[2]; d[o + 15] = bones[3];
  d[o + 16] = weights[0]; d[o + 17] = weights[1]; d[o + 18] = weights[2]; d[o + 19] = weights[3];
  d[o + 20] = fur; d[o + 21] = breath;
}

/**
 * A carve (bakeCat) as the GPU's buffers: { data (CAT_STRIDE a vertex), verts, index (the body's triangles, each quad
 * split along its shorter diagonal as skinCat splits it), fur ([{ index, layers }]: the triangles with shells, and how many) }.
 * The shells are chosen once, on the carve's own pose, as furShells chooses them: matte coat with fur on it, clear of
 * the floor by its own length; the short fur gets two layers and the long as many as the budget leaves (2 to 8).
 */
export function catBodyMesh(bake, o = {}) {
  const sc = bake.look.scale, P = bake.P, N = bake.N, Q = bake.Q, nv = bake.verts;
  const index = new Uint32Array(bake.quads * 6);
  let k = 0;
  for (let q = 0; q < bake.quads; q++) {
    const i0 = Q[q * 4], i1 = Q[q * 4 + 1], i2 = Q[q * 4 + 2], i3 = Q[q * 4 + 3];
    const d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
    const ex = [P[i2 * 3] - P[i0 * 3], P[i2 * 3 + 1] - P[i0 * 3 + 1], P[i2 * 3 + 2] - P[i0 * 3 + 2]], ey = [P[i3 * 3] - P[i1 * 3], P[i3 * 3 + 1] - P[i1 * 3 + 1], P[i3 * 3 + 2] - P[i1 * 3 + 2]];
    const fn = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    const sn = [N[i0 * 3] + N[i2 * 3], N[i0 * 3 + 1] + N[i2 * 3 + 1], N[i0 * 3 + 2] + N[i2 * 3 + 2]];
    const [a0, a1, a2, a3] = fn[0] * sn[0] + fn[1] * sn[1] + fn[2] * sn[2] >= 0 ? [i0, i1, i2, i3] : [i0, i3, i2, i1];
    const t = d2(i0, i2) <= d2(i1, i3) ? [a0, a1, a2, a0, a2, a3] : [a0, a1, a3, a1, a2, a3];
    for (const v of t) index[k++] = v;
  }
  // the fur
  const budget = o.furBudget ?? bake.look.fur.budget ?? 0, floor = 0.004;
  const fur = [];
  if (o.fur !== false && budget > 0) {
    const tris = [];
    for (let t = 0; t < index.length / 3; t++) {
      let len = 0, low = Infinity, ok = true;
      for (let j = 0; j < 3; j++) {
        const v = index[t * 3 + j];
        if (bake.M[v] !== MAT.MATTE) ok = false;
        len = Math.max(len, bake.F[v] || 0);
        low = Math.min(low, P[v * 3 + 1] * sc);
      }
      if (ok && len > 0 && low >= floor + len) tris.push([t, len]);
    }
    // two lots, as furShells' budget falls: the short fur (a face's, the legs') two layers, all it needs, and the long
    // fur (the ruff, the belly, the tail) as many as what's left buys; over budget, the shortest goes first
    tris.sort((p, q) => q[1] - p[1]);
    const long = tris.filter((x) => x[1] >= 0.008), short = tris.filter((x) => x[1] < 0.008);
    const shortKeep = Math.min(short.length, Math.floor(budget / 2 / 2));
    const longLayers = Math.max(2, Math.min(8, Math.floor((budget - shortKeep * 2) / Math.max(1, long.length))));
    const longKeep = Math.min(long.length, Math.floor((budget - shortKeep * 2) / longLayers));
    const lot = (list, n, layers) => {
      if (!n) return;
      const ix = new Uint32Array(n * 3);
      for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) ix[i * 3 + j] = index[list[i][0] * 3 + j];
      fur.push({ index: ix, layers });
    };
    lot(long, longKeep, longLayers);
    lot(short, shortKeep, 2);
  }
  const data = new Float32Array(nv * CAT_STRIDE), bones = [0, 0, 0, 0], weights = [0, 0, 0, 0];
  for (let v = 0; v < nv; v++) {
    for (let j = 0; j < 4; j++) { bones[j] = bake.Wb[v * 4 + j]; weights[j] = bake.Ww[v * 4 + j]; }
    put(data, v * CAT_STRIDE, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], [bake.C[v * 3], bake.C[v * 3 + 1], bake.C[v * 3 + 2]], bake.M[v], bones, weights, bake.F[v] || 0, bake.Bm[v]);
  }
  return { data, verts: nv, index, fur };
}

export const BIT_PARTS = ['eyes', 'lids', 'whiskers', 'tufts', 'mouth'];
/** One part of the eyes, lids, whiskers and ear tufts for `mo` (catBits) as the GPU's buffer: { data, verts }. */
export function catBitsMesh(bake, mo, part) {
  const b = catBits(bake, mo, part), n = b.M.length, d = new Float32Array(n * CAT_STRIDE);
  const bones = [0, 0, 0, 0], weights = [1, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    bones[0] = b.B[i];
    put(d, i * CAT_STRIDE, [b.P[i * 3], b.P[i * 3 + 1], b.P[i * 3 + 2]], [b.N[i * 3], b.N[i * 3 + 1], b.N[i * 3 + 2]], [b.C[i * 3], b.C[i * 3 + 1], b.C[i * 3 + 2]], b.M[i], bones, weights, 0, 0);
  }
  return { data: d, verts: n };
}

/**
 * Skin a mesh's body on the CPU as the shader does, into the room's batch layout ({ data (STRIDE 12), n }, one
 * vertex a triangle corner). For a gate, never per frame in a room.
 */
export function skinOnCpu(mesh, rows, breath = 0) {
  const idx = mesh.index || null, n = idx ? idx.length : mesh.verts, out = new Float32Array(n * 12), d = mesh.data;
  for (let i = 0; i < n; i++) {
    const o = (idx ? idx[i] : i) * CAT_STRIDE, p = [d[o], d[o + 1], d[o + 2]], n0 = [d[o + 3], d[o + 4], d[o + 5]];
    const P = [0, 0, 0], Nn = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = d[o + 16 + k];
      if (w <= 0) continue;
      const b = Math.round(d[o + 12 + k]) * 12;
      for (let r = 0; r < 3; r++) {
        P[r] += w * (rows[b + r * 4] * p[0] + rows[b + r * 4 + 1] * p[1] + rows[b + r * 4 + 2] * p[2] + rows[b + r * 4 + 3]);
        Nn[r] += w * (rows[b + r * 4] * n0[0] + rows[b + r * 4 + 1] * n0[1] + rows[b + r * 4 + 2] * n0[2]);
      }
    }
    const nl = Math.hypot(...n0), ul = Math.hypot(...Nn) || 1, u = Nn.map((v) => v / ul), lift = breath * d[o + 21];
    const q = i * 12;
    out[q] = P[0] + u[0] * lift; out[q + 1] = P[1] + u[1] * lift; out[q + 2] = P[2] + u[2] * lift;
    out[q + 3] = u[0] * nl; out[q + 4] = u[1] * nl; out[q + 5] = u[2] * nl;
    out[q + 6] = 0; out[q + 7] = 0; out[q + 8] = d[o + 8]; out[q + 9] = d[o + 9]; out[q + 10] = d[o + 10]; out[q + 11] = d[o + 11];
  }
  return { data: out, n };
}

// ── drawing them ──────────────────────────────────────────────────────────────────────────────────
/**
 * What a renderer with catMesh/freeCatMesh/setCats (gl/room.js) needs each frame for each cat, kept between frames:
 * each carve uploaded once, each part of the eyes once per value it's been at (a blink cycles through the same
 * dozen lids), and only the bones worked out per frame.
 *
 *   const D = catDrawer(R, { furBudget });
 *   R.setCats([D.frame(bake, pose, mo, { O, F })]);
 *   D.forget(bake) when a carve is let go; D.clear() on leaving.
 */
export function catDrawer(R, o = {}) {
  const bodies = new Map(), bits = new Map();
  const q = (v, n) => Math.round(Math.max(0, Math.min(1, v || 0)) * n) / n;
  function body(bake) {
    let h = bodies.get(bake);
    if (!h) { h = R.catMesh(catBodyMesh(bake, { furBudget: o.furBudget })); bodies.set(bake, h); }
    return h;
  }
  // each part kept per value it's been at, the most recently used last; the eyes go through many (their pupil and
  // where they look), so past EYES_KEEP of them the least recently used are let go
  const EYES_KEEP = 48;
  function part(bake, name, key, mo) {
    let m = bits.get(bake);
    if (!m) bits.set(bake, (m = new Map()));
    const k = name + ':' + key;
    let h = m.get(k);
    if (h) { m.delete(k); m.set(k, h); return h; }
    h = R.catMesh(catBitsMesh(bake, mo, name)); m.set(k, h);
    if (name === 'eyes') {
      const eyes = [...m.keys()].filter((x) => x.startsWith('eyes:'));
      for (let i = 0; i < eyes.length - EYES_KEEP; i++) { R.freeCatMesh(m.get(eyes[i])); m.delete(eyes[i]); }
    }
    return h;
  }
  return {
    frame(bake, pose, mo, place) {
      const R0 = bake.rig, Xn = solveRig(R0, pose || bake.pose, mo);
      const ey = bake.look.eyes;
      const lids = q(Math.max(mo.lids || 0, ey.droop || 0), 12), pupil = q(mo.pupil ?? ey.pupil, 16), wh = Math.round((mo.whiskers || 0) * 4) / 4;
      // where the eyes look, in tenths: a saccade passes through a few, a held gaze stays on one
      const gz = (mo.gaze || [0, 0, 0]).map((v, i) => Math.round(clamp(v, i === 2 ? 0 : -1, 1) * 10) / 10);
      const meshes = [body(bake),
        part(bake, 'eyes', pupil + ':' + gz.join(','), { pupil, gaze: gz }), part(bake, 'lids', lids, { lids }),
        part(bake, 'whiskers', wh, { whiskers: wh }), part(bake, 'tufts', 0, {})];
      // the mouth in tenths, a meow passing through a few; shut, nothing
      const gape = q(mo.mouth, 10);
      if (gape > 0.03) meshes.push(part(bake, 'mouth', gape, { mouth: gape }));
      return { meshes, rows: catBoneRows(bake, Xn, place), breath: (mo.breath || 0) * 0.0035 * bake.look.scale };
    },
    forget(bake) {
      R.freeCatMesh(bodies.get(bake)); bodies.delete(bake);
      for (const h of bits.get(bake)?.values() || []) R.freeCatMesh(h);
      bits.delete(bake);
    },
    clear() { for (const b of [...bodies.keys(), ...bits.keys()]) this.forget(b); },
  };
}
