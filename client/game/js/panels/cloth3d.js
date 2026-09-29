// CLOTH THAT MOVES IN THE WIND, BAKED INTO TEXTURES.
//
// Windsocks, the pier flag and the Pitch's tents used to be rebuilt on the CPU every frame: the sock
// and the flag out of sine terms on `now`, the tents as a pile of flat decal quads. This module is the
// data half of their GPU path. Each kind is one mesh; every frame of its flutter is baked once, at
// three wind strengths (calm, half, gale), and gl/cloth.js plays it back the way gl/fauna.js plays a
// wingbeat: rows picked by gl_VertexID, blended by the instance's wind and phase.
//
// No DOM, no GL. Everything here is a pure function of its constants, so the gate
// (scripts/shapes/cloth.mjs) runs it in Node.
//
// Model space: x across, y forward (the instance's heading), z up. gl/cloth.js maps x to the right of
// the heading, and scales x, y and z by the instance's dims. Every face carries a uv whose v runs from
// its HIGH edge (0) to its foot (1), which is the way the weathering reads: bleached at the top, mud at
// the bottom. A face also carries its index, so a patch or a piece of paint lands on one face only.

const TAU = Math.PI * 2;
export const CLOTH_FRAMES = 16;        // frames a cycle, per wind band
export const CLOTH_BANDS = [0, 0.5, 1]; // wind strengths baked; the shader blends the two either side

function builder() {
  const M = { rest: [], uv: [], face: [], mat: [], i: [], defs: [] };
  return M;
}
// A face as a (nu+1)×(nv+1) grid of `at(u, v)` rest points. `move(u, v, p, n, w, ph)` returns the
// displaced point for wind `w` and phase `ph`; `n` is the face's rest normal at that point.
// `flipU` mirrors only the STORED u, so paint on the face reads left to right from outside it. The
// geometry, winding and normals are untouched.
function grid(M, face, nu, nv, at, move, mat = () => 0, flipU = false) {
  const base = M.rest.length / 3;
  for (let j = 0; j <= nv; j++) for (let k = 0; k <= nu; k++) {
    const u = k / nu, v = j / nv, p = at(u, v);
    // The rest normal off the grid itself, so a sheet billows along whatever way it faces.
    const e = 1e-3, pu = at(Math.min(1, u + e), v), pv = at(u, Math.min(1, v + e));
    const du = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]], dv = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
    let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / L, n[1] / L, n[2] / L];
    M.rest.push(p[0], p[1], p[2]); M.uv.push(flipU ? 1 - u : u, v); M.face.push(face); M.mat.push(mat(u, v));
    M.defs.push({ u, v, p, n, move });
  }
  for (let j = 0; j < nv; j++) for (let k = 0; k < nu; k++) {
    const a = base + j * (nu + 1) + k, b = a + 1, c = a + nu + 1, d = c + 1;
    M.i.push(a, b, d, a, d, c);
  }
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// A quad face from its high edge (h0→h1) to its foot (f0→f1).
const quadAt = (h0, h1, f0, f1) => (u, v) => lerp3(lerp3(h0, h1, u), lerp3(f0, f1, u), v);
// A triangle from its apex down to a base edge: the gable.
const triAt = (apex, b0, b1) => (u, v) => lerp3(apex, lerp3(b0, b1, u), v);

// A pitched sheet breathes: the middle of each face pushes out and falls back, pinned at its edges,
// harder in a wind. `k` is how much of the face's size it may travel at a gale. The wave runs along
// the face so a slope ripples rather than inflating like a balloon.
const billow = (k, seed) => (u, v, p, n, w, ph) => {
  const pin = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const a = (0.12 + 0.88 * w) * k * pin * (Math.sin(TAU * ph + u * 3.1 + seed) * 0.7 + Math.sin(2 * TAU * ph + v * 2.3 + seed * 1.7) * 0.3);
  return [p[0] + n[0] * a, p[1] + n[1] * a, p[2] + n[2] * a];
};
// A tarp's open edge flaps as well: the v = 0 edge between two posts lifts and drops.
const flap = (k, seed) => {
  const b = billow(k, seed);
  return (u, v, p, n, w, ph) => {
    const q = b(u, v, p, n, w, ph);
    const edge = (1 - v) * (1 - v) * Math.sin(Math.PI * u) * w * k * 0.8 * Math.sin(TAU * ph * 2 + u * 4 + seed);
    return [q[0], q[1], q[2] + edge];
  };
};

// ── The tents. Unit shapes: x and y in -1..1, z in 0..1, scaled per pitch. Face 0 is the one a patch
// or paint goes on (the ridge's +x slope, the tarp's +x half, the lean-to's roof). ──────────────────
// ⚠ PAINT HAS TO READ FROM OUTSIDE. Face 0 on the ridge and the tarp runs u from -y to +y, and seen
// from +x (looking west) your right hand is north, -y, so a slogan came out mirrored. Those two faces
// store u flipped; the lean-to's roof faces +y and already reads the right way.
function ridge() {
  const M = builder();
  const P = [[-1, -1, 0], [-1, 1, 0], [1, -1, 0], [1, 1, 0], [0, -1, 1], [0, 1, 1]];
  grid(M, 0, 6, 4, quadAt(P[4], P[5], P[2], P[3]), billow(0.05, 0.3), undefined, true);
  grid(M, 1, 6, 4, quadAt(P[4], P[5], P[0], P[1]), billow(0.05, 1.9));
  grid(M, 2, 3, 3, triAt(P[4], P[0], P[2]), billow(0.03, 3.1));
  return M;
}
function tarp() {
  const M = builder(), s = 0.74, sag = 0.60;
  grid(M, 0, 6, 3, quadAt([1, -1, s], [1, 1, s], [0, -1, sag], [0, 1, sag]), flap(0.07, 0.7), undefined, true);
  grid(M, 1, 6, 3, quadAt([-1, -1, s], [-1, 1, s], [0, -1, sag], [0, 1, sag]), flap(0.07, 2.2));
  return M;
}
function lean() {
  const M = builder();
  grid(M, 0, 6, 4, quadAt([-1, -1, 1], [1, -1, 1], [-1, 1, 0], [1, 1, 0]), billow(0.06, 0.5));
  grid(M, 2, 6, 3, quadAt([-1, -1, 1], [1, -1, 1], [-1, -1, 0], [1, -1, 0]), billow(0.03, 2.6));
  return M;
}

// ── The windsock: a tube on a swivel, in tiles (scale 1). Mouth at the origin, flying along +y. ─────
// The same article windshield.js drew: a 3.5 m sock with a 0.9 m mouth, five bands, droop as the
// wind drops, and a slack one wanders while a taut one barely does.
export const SOCK_LEN = 0.23, SOCK_R0 = 0.034, SOCK_R1 = 0.013;
function sock() {
  const M = builder(), NB = 5, SIDES = 6, SEG = NB * 2;
  const centre = (t, w, ph) => {
    // Integrate the centreline to station t; the droop is the angle, never the length.
    const droop = 1 - Math.max(0.06, w);
    const flut = 0.055 * Math.sin(TAU * ph) + 0.03 * Math.sin(2 * TAU * ph + 1.3);
    const fmax = droop * 1.45 * (1 + 0.07 * Math.sin(TAU * ph + 0.4));
    const yaw = flut * droop;
    const steps = 24;
    let x = 0, y = 0, z = 0;
    for (let s = 0; s < steps; s++) {
      const tm = (s + 0.5) / steps * t, phi = fmax * Math.pow(tm, 1.3), d = t / steps * SOCK_LEN;
      x += Math.sin(yaw) * Math.cos(phi) * d; y += Math.cos(yaw) * Math.cos(phi) * d; z -= Math.sin(phi) * d;
    }
    const phiT = fmax * Math.pow(t, 1.3);
    return { c: [x, y, z], phi: phiT, yaw };
  };
  const at = (u, v) => {
    const r = SOCK_R0 + (SOCK_R1 - SOCK_R0) * v, a = u * TAU;
    return [Math.cos(a) * r, v * SOCK_LEN, Math.sin(a) * r];
  };
  const move = (u, v, p, n, w, ph) => {
    const { c, phi, yaw } = centre(v, w, ph);
    const r = (SOCK_R0 + (SOCK_R1 - SOCK_R0) * v) * (1 + 0.04 * w * Math.sin(TAU * ph * 2 + v * 9));
    const a = u * TAU, ca = Math.cos(a), sa = Math.sin(a);
    // The frame at this station: across is horizontal, up is the tangent crossed with it.
    const fx = Math.sin(yaw), fy = Math.cos(yaw);
    const ux = fy, uy = -fx;
    const vx = Math.sin(phi) * fx, vy = Math.sin(phi) * fy, vz = Math.cos(phi);
    return [c[0] + (ca * ux + sa * vx) * r, c[1] + (ca * uy + sa * vy) * r, c[2] + sa * vz * r];
  };
  grid(M, 0, SIDES, SEG, at, move, (u, v) => (Math.min(NB - 1, Math.floor(v * NB - 1e-6)) % 2));
  return M;
}

// ── The flag: hoisted at the origin, flying along +y, hanging down -z. Unit size; scaled by the
// flag's width. The same reach, sag and travelling wave as windshield.js's windFlag. ─────────────
const FLAG_H = 0.62;
function flag() {
  const M = builder();
  const at = (u, v) => [0, u, -v * FLAG_H];
  const move = (u, v, p, n, w, ph) => {
    const reach = u * (0.28 + 0.72 * w), sag = u * u * (1 - w) * 1.05;
    const wav = 0.17 * w * u * Math.sin(u * 5.6 - TAU * ph);
    const rip = 0.07 * w * u * Math.sin(u * 4.4 - 2 * TAU * ph + 1.7);
    return [wav, reach, -sag + rip - v * FLAG_H];
  };
  grid(M, 0, 8, 3, at, move);
  return M;
}

export const CLOTH_KINDS = ['ridge', 'tarp', 'lean', 'sock', 'flag'];
const BUILD = { ridge, tarp, lean, sock, flag };

// ── Half floats, as actor3d.js packs them. ──────────────────────────────────────────────────────────
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  _f[0] = v; const x = _u[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
  if (e >= 31) return sign | 0x7c00;
  let h = sign | (e << 10) | (m >> 13);
  if (m & 0x1000) h++;
  return h;
}

// One kind baked: { nv, nt, W, rows, H, pos, uv, face, mat, idx, preview } where `pos` is RGBA16F
// texels, a column per vertex, a band of CLOTH_FRAMES rows per wind strength in CLOTH_BANDS, and
// `preview` the unhalved positions (band-major, then frame) for the gate.
const _bakes = {};
export function clothBake(kind) {
  if (_bakes[kind]) return _bakes[kind];
  const M = BUILD[kind]();
  const nv = M.rest.length / 3, W = nv;   // every kind is well under 1024 vertices
  if (nv > 1024) throw new Error(`cloth ${kind}: ${nv} vertices is past one texture row`);
  const B = CLOTH_BANDS.length, F = CLOTH_FRAMES, H = B * F;
  const pos = new Uint16Array(W * H * 4), preview = new Float32Array(nv * H * 3);
  for (let b = 0; b < B; b++) for (let f = 0; f < F; f++) {
    const row = b * F + f, w = CLOTH_BANDS[b], ph = f / F;
    for (let v = 0; v < nv; v++) {
      const d = M.defs[v], p = d.move(d.u, d.v, d.p, d.n, w, ph);
      const o = (row * W + v) * 4;
      pos[o] = toHalf(p[0]); pos[o + 1] = toHalf(p[1]); pos[o + 2] = toHalf(p[2]); pos[o + 3] = 0x3c00;
      preview.set(p, (row * nv + v) * 3);
    }
  }
  _bakes[kind] = { kind, nv, nt: M.i.length / 3, W, rows: 1, H, bands: B, frames: F, pos,
    uv: new Float32Array(M.uv), face: new Float32Array(M.face), mat: new Float32Array(M.mat),
    idx: new Uint16Array(M.i), rest: new Float32Array(M.rest), preview };
  return _bakes[kind];
}
