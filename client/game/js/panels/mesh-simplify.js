// A MESH CUT DOWN TO A TRIANGLE BUDGET, KEEPING ONLY ITS OWN VERTICES.
//
// Garland and Heckbert's quadric error, collapsing one end of an edge onto the other (a half-edge
// collapse) rather than onto a new point between them. Every vertex left is one of the input's, so
// whatever the caller keeps per vertex (bone weights, a material, how far it moves for a body type)
// carries over by index with no blending. actor3d.js uses it to make the street's crowd and far bodies
// out of the close-up figure.
//
// - Points that sit on top of each other in the same class are welded first: a seam in the figure's
//   UVs would otherwise read as an edge of the surface and hold the mesh open there.
// - An edge of the surface (a hem, a cuff) only collapses along itself, and costs more to move off its
//   line, so a coat keeps its hem.
// - Vertices of different classes never merge. The caller's class is the material, so a sleeve never
//   eats the hand.
// - A collapse that would flip a triangle, or pinch the surface (the link condition), is refused.
// - `skin` is a per-vertex list of weights; a collapse between vertices weighted differently costs more,
//   so joints keep their rings.
//
// No DOM, no GL: a pure function of its input, run by the street's bake and its gate in Node.

// The symmetric 4x4 quadric as its ten distinct entries.
function addPlane(Q, o, a, b, c, d, w) {
  Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
  Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
  Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
}
function qErr(Q, o, R, r, x, y, z) {
  const q = (k) => Q[o + k] + R[r + k];
  return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x
    + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y
    + q(7) * z * z + 2 * q(8) * z + q(9);
}

// A binary heap of [cost, u, v, stamp u, stamp v], smallest cost first.
function makeHeap() {
  const H = [];
  const up = (i) => { const e = H[i]; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= e[0]) break; H[i] = H[p]; i = p; } H[i] = e; };
  const down = (i) => {
    const e = H[i], n = H.length;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && H[c + 1][0] < H[c][0]) c++;
      if (H[c][0] >= e[0]) break;
      H[i] = H[c]; i = c;
    }
    H[i] = e;
  };
  return {
    push(e) { H.push(e); up(H.length - 1); },
    pop() { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; down(0); } return top; },
    get size() { return H.length; },
  };
}

/**
 * @param {object} m
 * @param {ArrayLike<number>} m.P      positions, three a vertex
 * @param {ArrayLike<number>} m.I      triangles, three indices each
 * @param {ArrayLike<number>} [m.cls]  a class a vertex; vertices of different classes never merge
 * @param {(v:number)=>Map<number,number>|Array} [m.skin]  a vertex's bone weights as [[bone, w], ...]
 * @param {number} m.target            triangles to stop at
 * @param {number} [m.edge]            how much more an edge of the surface costs to move off its line (default 8)
 * @param {number} [m.skinCost]        cost per unit of weight difference, times the edge's length squared (default 4)
 * @returns {{ ids: Int32Array, I: Uint32Array }}  the input vertices kept, and the triangles over them
 */
export function simplifyMesh({ P, I, cls = null, skin = null, target, edge = 8, skinCost = 4 }) {
  const nv0 = P.length / 3;
  // ── weld ──
  const rep = new Int32Array(nv0), seen = new Map();
  for (let v = 0; v < nv0; v++) {
    const k = `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)},${cls ? cls[v] : 0}`;
    const r = seen.get(k);
    rep[v] = r === undefined ? v : r;
    if (r === undefined) seen.set(k, v);
  }
  const F = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = rep[I[t]], b = rep[I[t + 1]], c = rep[I[t + 2]];
    if (a !== b && b !== c && a !== c) F.push(a, b, c);
  }
  const nf = F.length / 3;
  const dead = new Uint8Array(nf), alive = new Uint8Array(nv0);
  const vf = Array.from({ length: nv0 }, () => []);
  for (let f = 0; f < nf; f++) for (let j = 0; j < 3; j++) { vf[F[f * 3 + j]].push(f); alive[F[f * 3 + j]] = 1; }
  let live = nf;
  if (live <= target) return finish();

  const X = (v) => P[v * 3], Y = (v) => P[v * 3 + 1], Z = (v) => P[v * 3 + 2];
  function faceNormal(a, b, c, out) {
    const ux = X(b) - X(a), uy = Y(b) - Y(a), uz = Z(b) - Z(a), wx = X(c) - X(a), wy = Y(c) - Y(a), wz = Z(c) - Z(a);
    out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx;
    return Math.hypot(out[0], out[1], out[2]);
  }

  // ── quadrics: each face's plane, weighted by its area ──
  const Q = new Float64Array(nv0 * 10), n3 = [0, 0, 0];
  for (let f = 0; f < nf; f++) {
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2], L = faceNormal(a, b, c, n3);
    if (L < 1e-14) continue;
    const nx = n3[0] / L, ny = n3[1] / L, nz = n3[2] / L, d = -(nx * X(a) + ny * Y(a) + nz * Z(a)), w = L / 2;
    for (const v of [a, b, c]) addPlane(Q, v * 10, nx, ny, nz, d, w);
  }
  // ── edges of the surface: a plane through the edge, upright to its face ──
  const edgeFaces = new Map();
  const ek = (a, b) => (a < b ? a * nv0 + b : b * nv0 + a);
  for (let f = 0; f < nf; f++) for (let j = 0; j < 3; j++) {
    const k = ek(F[f * 3 + j], F[f * 3 + (j + 1) % 3]);
    const e = edgeFaces.get(k);
    if (e) e.push(f); else edgeFaces.set(k, [f]);
  }
  const rim = new Uint8Array(nv0);
  for (const [k, fs] of edgeFaces) {
    if (fs.length !== 1) continue;
    const a = Math.floor(k / nv0), b = k % nv0, f = fs[0];
    rim[a] = rim[b] = 1;
    const L = faceNormal(F[f * 3], F[f * 3 + 1], F[f * 3 + 2], n3);
    if (L < 1e-14) continue;
    const ex = X(b) - X(a), ey = Y(b) - Y(a), ez = Z(b) - Z(a), el = Math.hypot(ex, ey, ez);
    let px = ey * n3[2] - ez * n3[1], py = ez * n3[0] - ex * n3[2], pz = ex * n3[1] - ey * n3[0];
    const pl = Math.hypot(px, py, pz);
    if (pl < 1e-14) continue;
    px /= pl; py /= pl; pz /= pl;
    const d = -(px * X(a) + py * Y(a) + pz * Z(a));
    addPlane(Q, a * 10, px, py, pz, d, edge * el * el);
    addPlane(Q, b * 10, px, py, pz, d, edge * el * el);
  }

  // ── skin: each vertex's weights as a Map, for the difference between two ──
  const SK = skin ? Array.from({ length: nv0 }, (_, v) => (rep[v] === v ? new Map(skin(v)) : null)) : null;
  const skinDiff = (u, v) => {
    if (!SK) return 0;
    const A = SK[u], B = SK[v];
    let d = 0;
    for (const [b, w] of A) d += Math.abs(w - (B.get(b) || 0));
    for (const [b, w] of B) if (!A.has(b)) d += w;
    return d / 2;
  };

  const ver = new Int32Array(nv0);
  const neighbours = (v) => {
    const s = new Set();
    for (const f of vf[v]) if (!dead[f]) for (let j = 0; j < 3; j++) { const w = F[f * 3 + j]; if (w !== v) s.add(w); }
    return s;
  };
  const shared = (u, v) => { let n = 0; for (const f of vf[u]) if (!dead[f] && (F[f * 3] === v || F[f * 3 + 1] === v || F[f * 3 + 2] === v)) n++; return n; };
  const cost = (u, v) => {
    const ex = X(u) - X(v), ey = Y(u) - Y(v), ez = Z(u) - Z(v);
    return Math.max(0, qErr(Q, u * 10, Q, v * 10, X(v), Y(v), Z(v))) + skinCost * skinDiff(u, v) * (ex * ex + ey * ey + ez * ez);
  };
  const heap = makeHeap();
  const offer = (u, v) => {
    if (cls && cls[u] !== cls[v]) return;
    if (rim[u] && !rim[v]) return;
    heap.push([cost(u, v), u, v, ver[u], ver[v]]);
  };
  for (const k of edgeFaces.keys()) { const a = Math.floor(k / nv0), b = k % nv0; offer(a, b); offer(b, a); }

  const nOld = [0, 0, 0], nNew = [0, 0, 0];
  function canCollapse(u, v) {
    const s = shared(u, v);
    if (s === 0) return false;
    // an edge of the surface collapses only along an edge of the surface
    if (rim[u] && s !== 1) return false;
    // the link condition: u and v share no neighbour but the ones across their shared faces
    const Nu = neighbours(u), Nv = neighbours(v);
    let common = 0;
    for (const w of Nu) if (Nv.has(w)) common++;
    if (common !== s) return false;
    // no face round u may turn over or fold to nothing once u is at v
    for (const f of vf[u]) {
      if (dead[f]) continue;
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a === v || b === v || c === v) continue;
      const L0 = faceNormal(a, b, c, nOld);
      const L1 = faceNormal(a === u ? v : a, b === u ? v : b, c === u ? v : c, nNew);
      if (L1 < 1e-12 || L0 < 1e-14) return false;
      if ((nOld[0] * nNew[0] + nOld[1] * nNew[1] + nOld[2] * nNew[2]) / (L0 * L1) < 0.2) return false;
    }
    return true;
  }

  while (live > target && heap.size) {
    const [, u, v, su, sv] = heap.pop();
    if (!alive[u] || !alive[v] || su !== ver[u] || sv !== ver[v]) continue;
    if (!canCollapse(u, v)) continue;
    for (const f of vf[u]) {
      if (dead[f]) continue;
      const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
      if (a === v || b === v || c === v) { dead[f] = 1; live--; continue; }
      for (let j = 0; j < 3; j++) if (F[f * 3 + j] === u) F[f * 3 + j] = v;
      vf[v].push(f);
    }
    vf[v] = vf[v].filter((f) => !dead[f]);
    vf[u] = [];
    alive[u] = 0;
    for (let k = 0; k < 10; k++) Q[v * 10 + k] += Q[u * 10 + k];
    ver[v]++;
    for (const w of neighbours(v)) { offer(v, w); offer(w, v); }
  }
  return finish();

  function finish() {
    const ids = [], at = new Int32Array(nv0).fill(-1), out = [];
    for (let f = 0; f < nf; f++) {
      if (dead[f]) continue;
      for (let j = 0; j < 3; j++) {
        const v = F[f * 3 + j];
        if (at[v] < 0) { at[v] = ids.length; ids.push(v); }
        out.push(at[v]);
      }
    }
    return { ids: Int32Array.from(ids), I: Uint32Array.from(out) };
  }
}
