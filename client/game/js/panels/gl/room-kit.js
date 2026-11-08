// GLASS 2 · THE ROOM KIT. The shapes a first-person room is built from, in the room's own frame
// (client/shared/room-layout.js: u across, v back from the front wall, y up), lifted out of the
// Platinum Box (booth-mesh.js) so a flat is made of the same parts as the suite
// (docs/proposals/room-stage.md). Pure: batches of ballpark-mesh.js vertices, no GL.
//
// Every face is MAT.EMISSIVE with its light baked into its colour by `bake` (the room's own lamps,
// worked out per vertex), and a face is cut into cells about `cell` units across so the light has
// somewhere to fall off. A face whose colour is 1.25 or over is a lamp: drawn raw, uncut, unbaked.
//
// `textures` maps a material key to how many units one repeat of its painted texture covers. A box,
// a rounded block or a turned piece given one of those keys goes in that material's own batch with
// the texture as its colour; a lamp's faces carry `glow` (emissive, as the rest, unless a renderer
// asks for its own code); given a hex colour, it goes in the solid batch. Each takes a
// last `surf`, the MAT code its faces carry (emissive by default), for a renderer that lights steel
// and gloss its own way. A material may
// also be { t: key, c: hex }: that texture tinted by that colour, so one painted weave dresses a
// sofa in any colour.

import { createBatch, vtx, lin, MAT } from './ballpark-mesh.js';

export function roomKit(L, bake, { textures = {}, cell = 1.5, glow = MAT.EMISSIVE } = {}) {
  const solid = createBatch(8192), screen = createBatch(16), glass = createBatch(64), textured = new Map();
  const TB = (k) => { let b = textured.get(k); if (!b) { b = createBatch(2048); textured.set(k, b); } return b; };
  const E = MAT.EMISSIVE, UV = [0, 0];
  // how far up or down whatever's drawn next goes: a piece in a sunken floor is drawn as ever and
  // lowered here, so no form has to know. The light is baked as if it hadn't moved
  let raised = 0;
  const lift = (y) => { raised = y; };
  const C = (hex, k = 1) => lin(hex).map((c) => c * k);
  // a material: [texture key or null, the colour its texture is multiplied by]
  const matOf = (m) => (m && typeof m === 'object' ? [textures[m.t] ? m.t : null, m.c || '#ffffff'] : [textures[m] ? m : null, '#ffffff']);
  const nrmOf = (du, dy, dv) => { const x = L.r[0] * du - L.f[0] * dv, z = L.r[2] * du - L.f[2] * dv; return [x, dy, z]; };
  // a face, lit per vertex by bake unless it's a lamp (raw), cut into cells so the light has
  // somewhere to fall off
  const quad = (b, ps, n, col, mat = E, uvs = null, raw = false) => {
    if (raw && mat === E) mat = glow;
    const U = uvs || [UV, UV, UV, UV];
    const nl = [n[0] * L.r[0] + n[2] * L.r[2], n[1], -(n[0] * L.f[0] + n[2] * L.f[2])];
    const len = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
    const nu = raw ? 1 : Math.max(1, Math.min(24, Math.ceil(Math.max(len(ps[0], ps[1]), len(ps[3], ps[2])) / cell)));
    const nv = raw ? 1 : Math.max(1, Math.min(24, Math.ceil(Math.max(len(ps[0], ps[3]), len(ps[1], ps[2])) / cell)));
    const at = (i, j) => {
      const a = i / nu, c = j / nv, mix = (k) => (ps[0][k] * (1 - a) + ps[1][k] * a) * (1 - c) + (ps[3][k] * (1 - a) + ps[2][k] * a) * c;
      const mixU = (k) => (U[0][k] * (1 - a) + U[1][k] * a) * (1 - c) + (U[3][k] * (1 - a) + U[2][k] * a) * c;
      const lp = [mix(0), mix(1), mix(2)];
      return { p: L.world(lp[0], lp[1], lp[2] + raised), uv: [mixU(0), mixU(1)], col: raw ? col : bake(lp, nl, col) };
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const k of [0, 1, 2, 0, 2, 3]) vtx(b, q[k].p, n, q[k].uv, q[k].col, mat);
    }
  };
  // a box from its corners in the room's frame. 'tex' puts it on a material, mapped flat onto each
  // face by the room's units; the texture is then the colour, and 'hex' is unused
  const box = (u0, u1, v0, v1, y0, y1, hex, k = 1, tex = null, surf = E) => {
    const [tk, th] = tex ? matOf(tex) : [null, null];
    const b = tk ? TB(tk) : solid, t = tk ? textures[tk] : 1, tint = tk ? th : hex;
    const c = () => C(tint, k);
    const face = (ps, n, col, i, j) => quad(b, ps, n, col, surf, tk ? ps.map((q) => [q[i] / t, q[j] / t]) : null, k >= 1.25);
    face([[u0, v0, y1], [u1, v0, y1], [u1, v1, y1], [u0, v1, y1]], [0, 1, 0], c(), 0, 1);
    face([[u0, v0, y0], [u0, v1, y0], [u1, v1, y0], [u1, v0, y0]], [0, -1, 0], c(), 0, 1);
    face([[u0, v0, y0], [u1, v0, y0], [u1, v0, y1], [u0, v0, y1]], nrmOf(0, 0, -1), c(), 0, 2);
    face([[u1, v1, y0], [u0, v1, y0], [u0, v1, y1], [u1, v1, y1]], nrmOf(0, 0, 1), c(), 0, 2);
    face([[u0, v1, y0], [u0, v0, y0], [u0, v0, y1], [u0, v1, y1]], nrmOf(-1, 0, 0), C(tint, k * 0.92), 1, 2);
    face([[u1, v0, y0], [u1, v1, y0], [u1, v1, y1], [u1, v0, y1]], nrmOf(1, 0, 0), C(tint, k * 0.92), 1, 2);
  };
  // a cut-glass drop: an octahedron, each facet its own brightness so it glints from any side
  const drop = (u, v, y, r, len, k = 1, top = '#e8f2ff', under = '#cfe0f4') => {
    const tp = [u, v, y], bot = [u, v, y - len], m = y - len * 0.42;
    const ring = [[u + r, v, m], [u, v + r, m], [u - r, v, m], [u, v - r, m]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4], g = 1.15 + ((i * 7 + Math.round(u * 13 + v * 5)) % 5) * 0.12;
      quad(solid, [tp, a, b, b], [0, 1, 0], C(top, g * k), E, null, true);
      quad(solid, [bot, b, a, a], [0, -1, 0], C(under, (2.3 - g) * k), E, null, true);
    }
  };
  // a rounded block: 'a' runs along one axis, its section in (s, t) a rectangle with corners of
  // radius rad cut into facets, so the light rolls round an edge instead of breaking on it. 'to' maps
  // (a, s, t) to the room and 'dir' a normal the same way; ends are capped flat. 'tex' is a texture
  // key or a colour
  const rounded = (to, dir, a0, a1, s0, s1, t0, t1, rad, tex, k = 1, surf = E) => {
    const sec = [];
    for (const [cs, ct, q] of [[s1 - rad, t1 - rad, 0], [s0 + rad, t1 - rad, 1], [s0 + rad, t0 + rad, 2], [s1 - rad, t0 + rad, 3]]) {
      for (let i = 0; i <= 4; i++) { const ang = (q + i / 4) * Math.PI / 2; sec.push([cs + Math.cos(ang) * rad, ct + Math.sin(ang) * rad, Math.cos(ang), Math.sin(ang)]); }
    }
    const [tk, th] = matOf(tex), t = tk ? textures[tk] : 0, b = t ? TB(tk) : solid, col = C(t ? th : tex, k), uv = (q) => (t ? q.map(([x, y]) => [x / t, y / t]) : null);
    let run = 0;
    for (let i = 0; i < sec.length; i++) {
      const p = sec[i], q = sec[(i + 1) % sec.length], seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (seg < 1e-4) continue;
      const n = dir(0, (p[2] + q[2]) / 2, (p[3] + q[3]) / 2);
      quad(b, [to(a0, p[0], p[1]), to(a1, p[0], p[1]), to(a1, q[0], q[1]), to(a0, q[0], q[1])], n, col, surf,
        uv([[a0, run], [a1, run], [a1, run + seg], [a0, run + seg]]), k >= 1.25);
      run += seg;
    }
    const ms = (s0 + s1) / 2, mt = (t0 + t1) / 2;
    for (const [av, sg] of [[a0, -1], [a1, 1]]) for (let i = 0; i < sec.length; i++) {
      const p = sec[i], q = sec[(i + 1) % sec.length], m = to(av, ms, mt);
      quad(b, sg > 0 ? [m, to(av, p[0], p[1]), to(av, q[0], q[1]), to(av, q[0], q[1])] : [m, to(av, q[0], q[1]), to(av, p[0], p[1]), to(av, p[0], p[1])],
        dir(sg, 0, 0), col, surf, uv([[ms, mt], [p[0], p[1]], [q[0], q[1]], [q[0], q[1]]]), k >= 1.25);
    }
  };
  // the room's own frames for rounded: along u with the section in (v, y), or along v with it in
  // (u, y); leanV tips the section toward +u as it rises, for a sofa back
  const onU = [(a, sv, ty) => [a, sv, ty], (da, ns, nt) => nrmOf(da, nt, ns)];
  const onV = [(a, su, ty) => [su, a, ty], (da, ns, nt) => nrmOf(ns, nt, da)];
  const leanV = (lean, y0) => [(a, su, ty) => [su + (ty - y0) * lean, a, ty], (da, ns, nt) => nrmOf(ns - nt * lean, nt, da)];
  // a turned piece round an upright axis at (u, v): 'prof' is [radius, y] from the bottom up, each
  // ring cut into n facets, and a radius of 0 closes an end. 'mat' is a texture key or a colour
  const lathe = (u, v, prof, mat, k = 1, n = 16, surf = E) => {
    const [tk, th] = matOf(mat), t = tk ? textures[tk] : 0, b = t ? TB(tk) : solid, col = C(t ? th : mat, k);
    const P = (r, a, y) => [u + Math.cos(a) * r, v + Math.sin(a) * r, y];
    for (let i = 0; i + 1 < prof.length; i++) {
      const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy);
      if (l < 1e-5) continue;
      for (let j = 0; j < n; j++) {
        const a0 = j / n * Math.PI * 2, a1 = (j + 1) / n * Math.PI * 2, am = (a0 + a1) / 2, rm = Math.max(r0, r1, 0.05);
        quad(b, [P(r0, a0, y0), P(r0, a1, y0), P(r1, a1, y1), P(r1, a0, y1)], nrmOf(Math.cos(am) * dy / l, -dr / l, Math.sin(am) * dy / l), col, surf,
          t ? [[a0 * rm / t, y0 / t], [a1 * rm / t, y0 / t], [a1 * rm / t, y1 / t], [a0 * rm / t, y1 / t]] : null, k >= 1.25);
      }
    }
  };
  const ball = (u, v, y, r, mat, k = 1, n = 12, surf = E) => lathe(u, v, Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 + i / 8 * Math.PI; return [Math.cos(a) * r, y + Math.sin(a) * r]; }), mat, k, n, surf);
  // a piece's own frame: x across it, z out of its front, y up, centred at (u, v) and turned to face
  // [fu, fv] (room-layout.js facing). Returns P(x, y, z) → room point, N(x, y, z) → normal, and the
  // `along` frames for rounded in it.
  const frame = (u, v, fu, fv) => {
    const su = -fv, sv = fu;
    const P = (x, y, z) => [u + su * x + fu * z, v + sv * x + fv * z, y];
    const N = (x, y, z) => nrmOf(su * x + fu * z, y, sv * x + fv * z);
    const alongX = (lean = 0, y0 = 0) => [(a, sz, ty) => P(a, ty, sz + (ty - y0) * lean), (da, ns, nt) => N(da, nt, ns - nt * lean)];
    const alongZ = () => [(a, sx, ty) => P(sx, ty, a), (da, ns, nt) => N(ns, nt, da)];
    const alongY = () => [(a, sx, sz) => P(sx, a, sz), (da, ns, nt) => N(ns, da, nt)];
    // a box in the piece's frame: [x0, x1] across, [y0, y1] up, [z0, z1] out of its front
    const pbox = (x0, x1, y0, y1, z0, z1, hex, k = 1, tex = null, mat = E) => {
      const [tk, th] = tex ? matOf(tex) : [null, null];
      const b = tk ? TB(tk) : solid, t = tk ? textures[tk] : 1;
      const col = (s) => C(tk ? th : hex, k * s);
      const face = (ps, n, s, i, j) => quad(b, ps.map(([x, y, z]) => P(x, y, z)), N(...n), col(s), mat, tk ? ps.map((q) => [q[i] / t, q[j] / t]) : null, k >= 1.25);
      face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], 1, 0, 2);
      face([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [0, -1, 0], 1, 0, 2);
      face([[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], [0, 0, 1], 1, 0, 1);
      face([[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]], [0, 0, -1], 1, 0, 1);
      face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], 0.92, 2, 1);
      face([[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]], [1, 0, 0], 0.92, 2, 1);
    };
    // a flat panel facing out of the piece's front at depth z (a screen's picture, a dial)
    const front = (b, x0, x1, y0, y1, z, col, mat = E, uvs = null, raw = true) => quad(b, [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], N(0, 0, 1), col, mat, uvs, raw);
    return { P, N, alongX, alongZ, alongY, pbox, front };
  };
  return { solid, screen, glass, textured, TB, E, C, nrmOf, lift, quad, box, drop, rounded, onU, onV, leanV, lathe, ball, frame };
}
