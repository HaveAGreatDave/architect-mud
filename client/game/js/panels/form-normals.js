// FORM NORMALS: a mesh's normals with its small forms smoothed away, for the comic light
// (gl/comic-light.js), which decides lit from shadow on the form so a head or a limb takes one clean
// shadow shape. Used by the close-up figure (figure.js), and baked into the sports' heads
// (gl/ballplayer-mesh.js, gl/arena-heads.js), whose bodies are smooth lofts already. No DOM, no GL.

// The normals the comic light decides lit from shadow with (gl/comic-light.js): each part's own
// normals diffused over its triangles `iters` times, so the small forms (a nose, a fold, a muscle,
// a knuckle) are gone and the big ones (the head's egg, a limb's cylinder) stay. A comic shadow is
// one clean shape on a form; tested against the real normals it broke into an island per bump.
// Parts share no vertices, so nothing bleeds from one into the next.
// `keep` (iteration, mask): vertices the mask picks keep the normals they had at that iteration, so a
// face holds its planes (cheekbones, jaw) while a body's long forms smooth on.
export function formNormals(F, iters, keep = null) {
  const { nv, I, N } = F, deg = new Uint32Array(nv + 1);
  for (let t = 0; t < I.length; t++) deg[I[t] + 1] += 2;
  for (let v = 0; v < nv; v++) deg[v + 1] += deg[v];
  const adj = new Uint32Array(deg[nv]), fill = deg.slice(0, nv);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b;
  }
  let cur = Float32Array.from(N), nxt = new Float32Array(nv * 3);
  let held = null;
  for (let it = 0; it < iters; it++) {
    if (keep && it === keep.at) held = Float32Array.from(cur);
    for (let v = 0; v < nv; v++) {
      let x = cur[v * 3], y = cur[v * 3 + 1], z = cur[v * 3 + 2];
      for (let k = deg[v]; k < deg[v + 1]; k++) { const u = adj[k] * 3; x += cur[u]; y += cur[u + 1]; z += cur[u + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      nxt[v * 3] = x / l; nxt[v * 3 + 1] = y / l; nxt[v * 3 + 2] = z / l;
    }
    [cur, nxt] = [nxt, cur];
  }
  if (held) for (let v = 0; v < nv; v++) if (keep.mask(v)) { cur[v * 3] = held[v * 3]; cur[v * 3 + 1] = held[v * 3 + 1]; cur[v * 3 + 2] = held[v * 3 + 2]; }
  // Held within about 70° of the surface's own. On a small closed part (a finger, a thumb, an ear)
  // the diffusion runs to the end and every normal round it averages toward one direction, so half
  // of them would face away and light from behind; there it falls back toward the surface's own.
  for (let v = 0; v < nv; v++) {
    let x = cur[v * 3], y = cur[v * 3 + 1], z = cur[v * 3 + 2];
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2], d = x * nx + y * ny + z * nz;
    if (d < 0.35) { const k = (0.35 - d) * 2; x += nx * k; y += ny * k; z += nz * k; }
    let l = Math.hypot(x, y, z);
    if (l < 1e-6) { x = nx; y = ny; z = nz; l = Math.hypot(x, y, z); }
    if (l < 1e-6) { x = 0; y = 1; z = 0; l = 1; }
    cur[v * 3] = x / l; cur[v * 3 + 1] = y / l; cur[v * 3 + 2] = z / l;
  }
  return cur;
}

// ── Designed face planes ─────────────────────────────────────────────────────────────────────────────
// A comic face isn't shaded off its real curvature. Its shadows are designed shapes on planes, as an
// inker would cut them (docs/proposals/hd-figure.md, "The face's planes"): the brow's underside faces
// down so the sockets go into shadow; the cheekbone's top faces up and the hollow under it out and
// down, which is the wedge down the cheek; the nose has two side planes, so its shadow falls on the
// one side away from the light, and only a sliver under its tip faces down; the jaw's underside
// faces down. The upper lip is held facing forward and a little up, so it's always lit: shaded off
// the real nose it carried a dark band under the nose that read, head on, as a moustache.
//
// For a head mesh (actor-head.js headMesh: metres, Y up, facing +Z, F 7 the skull's skin): its form
// normals with the planes laid on over the face. Ears, neck and the back of the head keep their form.
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const band = (v, a, b, e) => sstep(a - e, a + e, v) * (1 - sstep(b - e, b + e, v));
const _designed = new WeakMap();
export function faceDesigned(mesh) {
  let out = _designed.get(mesh);
  if (out) return out;
  const nv = mesh.P.length / 3, F0 = formNormals({ nv, I: mesh.I, N: mesh.N }, 10);
  out = Float32Array.from(F0);
  for (let v = 0; v < nv; v++) {
    if (mesh.F && mesh.F[v] !== 7) continue;
    const x = mesh.P[v * 3], y = mesh.P[v * 3 + 1], z = mesh.P[v * 3 + 2], ax = Math.abs(x), sx = Math.sign(x) || 1;
    const front = sstep(0.01, 0.05, z + 0.006) * (1 - sstep(0.068, 0.078, ax));
    if (front <= 0) continue;
    let nx = F0[v * 3], ny = F0[v * 3 + 1], nz = F0[v * 3 + 2];
    const add = (k, tx, ty, tz) => { nx += k * tx; ny += k * ty; nz += k * tz; };
    // the brow's underside and the sockets under it, and the ridge above lit
    add(band(y, 1.633, 1.654, 0.004) * band(ax, 0.012, 0.056, 0.005), 0, -0.45, -0.05);
    add(band(y, 1.656, 1.674, 0.004) * band(ax, 0.006, 0.06, 0.006), 0, 0.35, 0);
    // the cheekbone's top, and the hollow under it, its inner edge running down toward the mouth
    add(band(y, 1.605, 1.632, 0.004) * band(ax, 0.03, 0.068, 0.005), sx * 0.15, 0.3, 0);
    const xin = 0.033 + (y - 1.56) * 0.35;
    add(band(y, 1.558, 1.603, 0.01) * sstep(xin - 0.004, xin + 0.012, ax) * (1 - sstep(0.064, 0.076, ax)), sx * 0.55, -0.85, -0.1);
    // the nose's two side planes, and only a sliver under its tip
    add(band(y, 1.59, 1.648, 0.004) * sstep(0.002, 0.012, ax) * (1 - sstep(0.013, 0.017, ax)), sx * 1.1, 0, -0.35);
    add(band(y, 1.583, 1.594, 0.002) * (1 - sstep(0.008, 0.012, ax)), 0, -0.5, 0);
    // the lower lip's top lit, the shadow under it, the jaw's underside, the face's sides
    add(band(y, 1.553, 1.563, 0.002) * (1 - sstep(0.018, 0.024, ax)), 0, 0.3, 0);
    add(band(y, 1.545, 1.552, 0.002) * (1 - sstep(0.014, 0.02, ax)), 0, -0.5, 0);
    add((1 - sstep(1.536, 1.556, y)) * sstep(0.014, 0.034, ax), sx * 0.3, -0.9, 0);
    add(band(y, 1.58, 1.68, 0.01) * sstep(0.056, 0.064, ax), sx * 0.6, 0, 0);
    let l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // the upper lip, held lit
    const lip = band(y, 1.568, 1.585, 0.002) * (1 - sstep(0.026, 0.032, ax)) * 0.85;
    nx += (0 - nx) * lip; ny += (0.25 - ny) * lip; nz += (0.97 - nz) * lip;
    l = Math.hypot(nx, ny, nz) || 1;
    nx = (F0[v * 3] + (nx / l - F0[v * 3]) * front); ny = (F0[v * 3 + 1] + (ny / l - F0[v * 3 + 1]) * front); nz = (F0[v * 3 + 2] + (nz / l - F0[v * 3 + 2]) * front);
    l = Math.hypot(nx, ny, nz) || 1;
    out[v * 3] = nx / l; out[v * 3 + 1] = ny / l; out[v * 3 + 2] = nz / l;
  }
  // three passes of smoothing over the designed field: the planes' edges are set a vertex at a time,
  // and unsmoothed the terminator stepped along the mesh's triangles
  out = formNormals({ nv, I: mesh.I, N: out }, 3);
  _designed.set(mesh, out);
  return out;
}
// A head mesh's normals leaning onto its designed planes (faceDesigned), for the renderers that draw
// one normal a vertex (the sports' and the street's heads): `k` of the way there.
const _faceLean = new WeakMap();
export function faceLeaned(mesh, k = 0.85) {
  let out = _faceLean.get(mesh);
  if (out) return out;
  const D = faceDesigned(mesh), nv = mesh.P.length / 3;
  out = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const x = mesh.N[v * 3] + (D[v * 3] - mesh.N[v * 3]) * k, y = mesh.N[v * 3 + 1] + (D[v * 3 + 1] - mesh.N[v * 3 + 1]) * k, z = mesh.N[v * 3 + 2] + (D[v * 3 + 2] - mesh.N[v * 3 + 2]) * k;
    const l = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l;
  }
  _faceLean.set(mesh, out);
  return out;
}

// A head mesh's normals leaning onto its form: `k` of the way to the form normal. The sports draw
// one normal a vertex, so a head shades as its form in every look; the features are the inked
// atlas's to draw. Cached per mesh.
const _lean = new WeakMap();
export function formLeaned(mesh, k = 0.8, iters = 28) {
  let out = _lean.get(mesh);
  if (out) return out;
  const nv = mesh.P.length / 3, F = formNormals({ nv, I: mesh.I, N: mesh.N }, iters);
  out = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const x = mesh.N[v * 3] + (F[v * 3] - mesh.N[v * 3]) * k, y = mesh.N[v * 3 + 1] + (F[v * 3 + 1] - mesh.N[v * 3 + 1]) * k, z = mesh.N[v * 3 + 2] + (F[v * 3 + 2] - mesh.N[v * 3 + 2]) * k;
    const l = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l;
  }
  _lean.set(mesh, out);
  return out;
}
