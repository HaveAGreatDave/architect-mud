// GLASS 2 · A BOX AT THE PARK. A private suite drawn round a seat in the Grandstand (gl/ballpark.js
// setRoom), so a box's chair is a room you can get up out of and walk round (panels/stands.js).
// Pure: the layout and the mesh, no GL.
//
// The room comes from content: a stands section's `room` (plugins/stands), { at: [x, z], face, floor,
// w, d, h } in the field's feet, `at` the middle of the glass on the ground, `face` the way the glass
// looks (degrees from +z toward +x), `floor` its height. Everything in it is laid out here in the
// room's own frame: u across (right as you face the glass), v back from the glass, y up off the floor.
//
// ⚠ THE ROOM LIGHTS ITSELF. It's under the park's floods but in none of their shadow maps, so lit
// by them its walls would shine through its own ceiling. Every face is MAT.EMISSIVE with its light
// baked in (shade by which way it faces), which is what a room under its own lamps looks like at
// any hour. Keep baked colours under 1 or the bloom takes them; the lamps are over it on purpose.

import { createBatch, vtx, lin, MAT } from './ballpark-mesh.js';

const DEG = Math.PI / 180;

// Where a body can stand and sit, and what's in the way, for a room spec.
export function boothLayout(spec) {
  const w = spec.w || 30, d = spec.d || 25, h = spec.h || 8.5, floor = spec.floor || 0;
  const yaw = (spec.face || 0) * DEG, f = [Math.sin(yaw), 0, Math.cos(yaw)], r = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const at = [spec.at[0], floor, spec.at[1]];
  const world = (u, v, y) => [at[0] + r[0] * u - f[0] * v, floor + y, at[2] + r[2] * u - f[2] * v];
  const local = (p) => { const q = [p[0] - at[0], p[2] - at[2]]; return [q[0] * r[0] + q[1] * r[2], -(q[0] * f[0] + q[1] * f[2]), p[1] - floor]; };
  const hu = w / 2;
  // no step: three club chairs back from the glass and the floor open behind them, and one more
  // by the sofa turned to the big screen ('turn': it faces -u, the screen's wall)
  const step = { u: [0, -1], v: [0, -1], y: 0 };
  const chairs = [...[-6, 0, 6].map((u) => ({ u, v: 5.5, y: 0, row: 0 })), { u: -6.2, v: 18.6, y: 0, turn: true }];
  const stools = [-10, -7.4, -4.8].map((u) => ({ u, v: d - 3.3 }));
  const plants = [[-hu + 1.3, 1.6], [hu - 1.3, 1.6], [hu - 1.3, d - 1.3]];
  const sofa = { u: [-7.6, -4.8], v: [8.4, 15.6] };
  // on the left-hand wall, clear of the bar and its fridge at the back
  const tv = { u: -hu + 0.15, v: 12, y: 5.1, w: 8.4, h: 4.7 };
  // [u0, u1, v0, v1]: what a walker can't stand in
  const solid = [
    ...plants.map(([u, v]) => [u - 0.8, u + 0.8, v - 0.8, v + 0.8]),
    [-hu, -3, d - 2.4, d],
    [hu - 2.4, hu, 12.5, 18.1],
  ];
  // [u0, u1, v0, v1, y]: what a walker climbs over rather than getting stuck on, y its top
  const climb = [
    ...chairs.map((c) => (c.turn ? [c.u - 1.2, c.u + 1.6, c.v - 1.4, c.v + 1.4, 1.7] : [c.u - 1.4, c.u + 1.4, c.v - 1.2, c.v + 1.6, 1.7])),
    ...[-3, 3].map((u) => [u - 0.5, u + 0.5, 5.0, 6.0, 2.05]),
    ...stools.map((t) => [t.u - 0.4, t.u + 0.4, t.v - 0.4, t.v + 0.4, 2.6]),
    [sofa.u[0], sofa.u[1], sofa.v[0], sofa.v[1], 1.45],
    [-11.8, -9.6, 10, 14, 1.4],
  ];
  const yawTo = (dir) => Math.atan2(dir[0], dir[2]);
  const seats = [
    ...chairs.map((c, i) => (c.turn
      ? { kind: 'armchair', i, u: c.u + 0.25, v: c.v, y: c.y + 3.85, pitch: -0.05 }
      : { kind: 'chair', i, u: c.u, v: c.v + 0.25, y: c.y + 3.85, yaw: yawTo(f), pitch: -0.12 })),
    ...[9.8, 12, 14.2].map((v, i) => ({ kind: 'sofa', i, u: -6.6, v, y: 3.6, yaw: yawTo(r.map((x) => -x)), pitch: 0 })),
  ];
  for (const s of seats) s.eye = world(s.u, s.v, s.y);
  // the turned chair looks at the middle of the screen
  for (const s of seats) if (s.kind === 'armchair') { const t = world(tv.u, tv.v, s.y); s.yaw = Math.atan2(t[0] - s.eye[0], t[2] - s.eye[2]); }
  // the floor under a walker: the top of whatever he's climbed onto, felt a little past its edge
  const groundAt = (u, v) => {
    let y = u >= step.u[0] && u <= step.u[1] && v >= step.v[0] && v <= step.v[1] ? step.y : 0;
    for (const [a, b, c, e, t] of climb) if (u > a - 0.3 && u < b + 0.3 && v > c - 0.3 && v < e + 0.3) y = Math.max(y, t);
    return y;
  };
  return { spec, w, d, h, floor, f, r, at, yaw, world, local, step, chairs, stools, plants, sofa, tv, solid, climb, seats,
    bounds: [-hu + 0.9, hu - 0.9, 0.9, d - 0.9], radius: 0.6, groundAt };
}

// A walker's next spot: the move tried whole, then each axis on its own, so you slide along what you
// meet. `p` and the answer are [u, v].
export function boothFree(L, u, v) {
  return u >= L.bounds[0] && u <= L.bounds[1] && v >= L.bounds[2] && v <= L.bounds[3]
    && !L.solid.some(([a, b, c, e]) => u > a - L.radius && u < b + L.radius && v > c - L.radius && v < e + L.radius);
}
export function boothStep(L, p, du, dv) {
  const ok = (u, v) => boothFree(L, u, v);
  // somewhere you shouldn't be (a seat's own spot): any move goes, so you can always walk out
  if (!ok(p[0], p[1])) { const [a, b, c, e] = L.bounds; return [Math.max(a, Math.min(b, p[0] + du)), Math.max(c, Math.min(e, p[1] + dv))]; }
  if (ok(p[0] + du, p[1] + dv)) return [p[0] + du, p[1] + dv];
  if (ok(p[0] + du, p[1])) return [p[0] + du, p[1]];
  if (ok(p[0], p[1] + dv)) return [p[0], p[1] + dv];
  return p;
}

// The seat nearest a point in the room's frame, within `reach` feet, or null.
export function boothSeatNear(L, u, v, reach = 3) {
  let best = null, bd = reach;
  for (const s of L.seats) { const dd = Math.hypot(s.u - u, s.v - v); if (dd < bd) { bd = dd; best = s; } }
  return best;
}

const LOOK = Object.freeze({
  carpet: '#2c3140', ceiling: '#e6e2d8', wall: '#e9e3d6', outside: '#bfbcb4', under: '#3a3d42', wood: '#8a6646',
  leather: '#efeae0', platinum: '#d8dce2', frame: '#2a2d33', marble: '#f1efe9', cloth: '#f4f2ec', silver: '#b9bec6',
  screen: '#111318', gilt: '#c9a24a', crystal: '#e8f2ff', onyx: '#f0b860', mirror: '#9aa6b0',
  pot: '#1f3a3a', trunk: '#6b4a2a', frond: '#3f7a3a', fridge: '#bfe4f0', lamp: '#fff2d6', heat: '#ffb060',
});
// Unused now the light is baked per vertex (bakeLight), kept 1 so a box's k is its whole tint
const SHADE = { up: 1, down: 1, side: 1, back: 1 };

// The surfaces with a material of their own (paintBoothTexture), each its own batch so its texture
// can repeat, and how many feet one repeat covers.
export const BOOTH_TEXTURES = Object.freeze({ boothRug: 1, boothCarpet: 3, boothLeather: 2.4, boothWood: 3.5, boothMarble: 2.5, boothWall: 4 });

// { solid, screen, glass, textured }: batches in the field's feet; 'textured' maps a
// BOOTH_TEXTURES key to its batch, whose colours are the light alone (the texture is the colour).
export function buildBooth(L) {
  const solid = createBatch(8192), screen = createBatch(16), glass = createBatch(64), textured = new Map();
  const TB = (k) => { let b = textured.get(k); if (!b) { b = createBatch(2048); textured.set(k, b); } return b; };
  const E = MAT.EMISSIVE, UV = [0, 0];
  const C = (hex, k = 1) => lin(hex).map((c) => c * k);
  const nrmOf = (du, dy, dv) => { const x = L.r[0] * du - L.f[0] * dv, z = L.r[2] * du - L.f[2] * dv; return [x, dy, z]; };
  // a face, lit per vertex by bakeLight unless it's a lamp (raw), cut into cells of about a foot
  // and a half so the light has somewhere to fall off
  const bake = bakeLight(L);
  const quad = (b, ps, n, col, mat = E, uvs = null, raw = false) => {
    const U = uvs || [UV, UV, UV, UV];
    const nl = [n[0] * L.r[0] + n[2] * L.r[2], n[1], -(n[0] * L.f[0] + n[2] * L.f[2])];
    const len = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
    const nu = raw ? 1 : Math.max(1, Math.min(24, Math.ceil(Math.max(len(ps[0], ps[1]), len(ps[3], ps[2])) / 1.5)));
    const nv = raw ? 1 : Math.max(1, Math.min(24, Math.ceil(Math.max(len(ps[0], ps[3]), len(ps[1], ps[2])) / 1.5)));
    const at = (i, j) => {
      const a = i / nu, c = j / nv, mix = (k) => (ps[0][k] * (1 - a) + ps[1][k] * a) * (1 - c) + (ps[3][k] * (1 - a) + ps[2][k] * a) * c;
      const mixU = (k) => (U[0][k] * (1 - a) + U[1][k] * a) * (1 - c) + (U[3][k] * (1 - a) + U[2][k] * a) * c;
      const lp = [mix(0), mix(1), mix(2)];
      return { p: L.world(lp[0], lp[1], lp[2]), uv: [mixU(0), mixU(1)], col: raw ? col : bake(lp, nl, col) };
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const k of [0, 1, 2, 0, 2, 3]) vtx(b, q[k].p, n, q[k].uv, q[k].col, mat);
    }
  };
  // a box from its corners in the room's frame, each face shaded by the way it faces
  // 'tex' puts it on a material (BOOTH_TEXTURES), mapped flat onto each face by the room's feet;
  // the texture is then the colour, and 'hex' is unused
  const box = (u0, u1, v0, v1, y0, y1, hex, k = 1, tex = null) => {
    const b = tex ? TB(tex) : solid, t = tex ? BOOTH_TEXTURES[tex] : 1;
    const c = (s) => C(tex ? '#ffffff' : hex, k * s);
    const face = (ps, n, col, i, j) => quad(b, ps, n, col, E, tex ? ps.map((q) => [q[i] / t, q[j] / t]) : null, k >= 1.25);
    face([[u0, v0, y1], [u1, v0, y1], [u1, v1, y1], [u0, v1, y1]], [0, 1, 0], c(SHADE.up), 0, 1);
    face([[u0, v0, y0], [u0, v1, y0], [u1, v1, y0], [u1, v0, y0]], [0, -1, 0], c(SHADE.down), 0, 1);
    face([[u0, v0, y0], [u1, v0, y0], [u1, v0, y1], [u0, v0, y1]], nrmOf(0, 0, -1), c(SHADE.side), 0, 2);
    face([[u1, v1, y0], [u0, v1, y0], [u0, v1, y1], [u1, v1, y1]], nrmOf(0, 0, 1), c(SHADE.back), 0, 2);
    face([[u0, v1, y0], [u0, v0, y0], [u0, v0, y1], [u0, v1, y1]], nrmOf(-1, 0, 0), c(SHADE.side * 0.92), 1, 2);
    face([[u1, v0, y0], [u1, v1, y0], [u1, v1, y1], [u1, v0, y1]], nrmOf(1, 0, 0), c(SHADE.side * 0.92), 1, 2);
  };
  const boxAt = box;
  const hu = L.w / 2, D = L.d, H = L.h, T = 0.35;
  // the shell: a slab under it, the ceiling's slab over it, the walls with their outsides
  box(-hu - T, hu + T, -0.2, D + T, -0.9, 0, LOOK.under);
  {
    const ps = [[-hu, 0, 0.01], [hu, 0, 0.01], [hu, D, 0.01], [-hu, D, 0.01]], t = BOOTH_TEXTURES.boothCarpet;
    quad(TB('boothCarpet'), ps, [0, 1, 0], C('#ffffff', 0.9), E, ps.map((q) => [q[0] / t, q[1] / t]));
  }
  box(-hu - T, hu + T, -0.2, D + T, H, H + 0.8, LOOK.outside);
  quad(solid, [[-hu, D, H - 0.01], [hu, D, H - 0.01], [hu, 0, H - 0.01], [-hu, 0, H - 0.01]], [0, -1, 0], C(LOOK.ceiling, 0.62));
  for (const s of [-1, 1]) box(s < 0 ? -hu - T : hu, s < 0 ? -hu : hu + T, 0, D, 0, H, LOOK.wall, 0.95, 'boothWall');
  box(-hu, hu, D, D + T, 0, H, LOOK.wall, 0.9, 'boothWall');
  // the platinum stripe round the three walls, a little proud of them
  const sy = [3.3, 3.55];
  quad(solid, [[-hu + 0.02, D, sy[0]], [-hu + 0.02, 0, sy[0]], [-hu + 0.02, 0, sy[1]], [-hu + 0.02, D, sy[1]]], nrmOf(1, 0, 0), C(LOOK.platinum, 1.05));
  quad(solid, [[hu - 0.02, 0, sy[0]], [hu - 0.02, D, sy[0]], [hu - 0.02, D, sy[1]], [hu - 0.02, 0, sy[1]]], nrmOf(-1, 0, 0), C(LOOK.platinum, 1.05));
  quad(solid, [[hu, D - 0.02, sy[0]], [-hu, D - 0.02, sy[0]], [-hu, D - 0.02, sy[1]], [hu, D - 0.02, sy[1]]], nrmOf(0, 0, -1), C(LOOK.platinum, 1.05));
  // the glass's frame: a low sill and the header, the glass between them one pane wall to wall
  box(-hu, hu, -0.2, 0.3, 0, 0.9, LOOK.frame);
  box(-hu, hu, -0.2, 0.3, H - 0.5, H, LOOK.frame);
  quad(glass, [[-hu, 0, 0.9], [hu, 0, 0.9], [hu, 0, H - 0.5], [-hu, 0, H - 0.5]], nrmOf(0, 0, -1), C('#cfe3ea', 0.8), E, null, true);
  // the lights, bright enough to bloom: a cove of warm light round the ceiling's edge, a gilt rose
  // with a two-tier chandelier hung from it, and sconces either side of the screen
  {
    const k = 0.6, y = H - 0.02;
    quad(solid, [[-hu, k + 0.3, y], [hu, k + 0.3, y], [hu, 0.3, y], [-hu, 0.3, y]], [0, -1, 0], C(LOOK.lamp, 1.3), E, null, true);
    quad(solid, [[-hu, D, y], [hu, D, y], [hu, D - k, y], [-hu, D - k, y]], [0, -1, 0], C(LOOK.lamp, 1.3), E, null, true);
    quad(solid, [[-hu, D, y], [-hu + k, D, y], [-hu + k, 0.3, y], [-hu, 0.3, y]], [0, -1, 0], C(LOOK.lamp, 1.3), E, null, true);
    quad(solid, [[hu - k, D, y], [hu, D, y], [hu, 0.3, y], [hu - k, 0.3, y]], [0, -1, 0], C(LOOK.lamp, 1.3), E, null, true);
    box(-hu + k, hu - k, k + 0.3, k + 0.8, H - 0.35, H, LOOK.ceiling, 0.7);
    box(-hu + k, hu - k, D - k - 0.5, D - k, H - 0.35, H, LOOK.ceiling, 0.7);
  }
  const ch = { u: 1.5, v: 12 };
  box(ch.u - 1.4, ch.u + 1.4, ch.v - 1.4, ch.v + 1.4, H - 0.12, H - 0.02, LOOK.gilt, 0.95);
  box(ch.u - 0.05, ch.u + 0.05, ch.v - 0.05, ch.v + 0.05, H - 2.0, H - 0.12, LOOK.gilt, 0.9);
  for (const [rad, y, n] of [[1.6, H - 2.1, 12], [0.95, H - 1.4, 8]]) {
    box(ch.u - rad, ch.u + rad, ch.v - rad, ch.v + rad, y - 0.04, y, LOOK.gilt, 0.9);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, u = ch.u + Math.cos(a) * rad, v = ch.v + Math.sin(a) * rad;
      box(u - 0.07, u + 0.07, v - 0.07, v + 0.07, y - 0.55, y - 0.04, LOOK.crystal, 1.5);
      box(u - 0.11, u + 0.11, v - 0.11, v + 0.11, y, y + 0.28, LOOK.lamp, 1.8);
    }
  }
  box(ch.u - 0.35, ch.u + 0.35, ch.v - 0.35, ch.v + 0.35, H - 2.9, H - 2.1, LOOK.crystal, 1.6);
  for (const v of [L.tv.v - L.tv.w / 2 - 1.2, L.tv.v + L.tv.w / 2 + 1.2]) {
    box(-hu, -hu + 0.12, v - 0.3, v + 0.3, 4.6, 5.2, LOOK.gilt, 0.9);
    box(-hu + 0.12, -hu + 0.5, v - 0.22, v + 0.22, 5.2, 5.9, LOOK.lamp, 1.7);
  }
  // the three club chairs at the glass, on brass feet, a marble drum table between each pair
  for (const c of L.chairs) {
    const y = c.y + 0.35;
    // drawn facing the glass (-v); a turned chair has its frame swung a quarter round to face -u
    const box = c.turn
      ? (u0, u1, v0, v1, y0, y1, ...rest) => boxAt(c.u + (v0 - c.v), c.u + (v1 - c.v), c.v - (u1 - c.u), c.v - (u0 - c.u), y0, y1, ...rest)
      : boxAt;
    for (const [du, dv] of [[-1.1, -0.9], [1.1, -0.9], [-1.1, 1.3], [1.1, 1.3]]) box(c.u + du - 0.08, c.u + du + 0.08, c.v + dv - 0.08, c.v + dv + 0.08, 0, y, LOOK.gilt, 0.9);
    box(c.u - 1.3, c.u + 1.3, c.v - 1.1, c.v + 1.5, y, y + 1.0, LOOK.leather, 0.9, 'boothLeather');
    box(c.u - 0.95, c.u + 0.95, c.v - 1.05, c.v + 1.0, y + 1.0, y + 1.35, LOOK.leather, 0.95, 'boothLeather');
    box(c.u - 1.3, c.u + 1.3, c.v + 1.0, c.v + 1.55, y + 1.0, y + 3.3, LOOK.leather, 0.85, 'boothLeather');
    for (const s of [-1, 1]) box(c.u + s * 1.3 - (s > 0 ? 0.38 : 0), c.u + s * 1.3 + (s < 0 ? 0.38 : 0), c.v - 1.1, c.v + 1.5, y + 1.0, y + 2.1, LOOK.leather, 0.8, 'boothLeather');
    box(c.u - 0.2, c.u + 0.2, c.v + 1.56, c.v + 1.59, y + 2.7, y + 3.0, LOOK.gilt, 1.1);  // the brass number
  }
  for (const u of [-3, 3]) {
    box(u - 0.12, u + 0.12, 5.38, 5.62, 0, 1.9, LOOK.gilt, 0.9);
    box(u - 0.45, u + 0.45, 5.05, 5.95, 1.9, 2.05, LOOK.marble, 1, 'boothMarble');
  }
  // the rug under the sofa's corner, one design end to end
  {
    const ps = [[-13, 7.6, 0.02], [-3.8, 7.6, 0.02], [-3.8, 16.4, 0.02], [-13, 16.4, 0.02]];
    quad(TB('boothRug'), ps, [0, 1, 0], C('#ffffff', 0.9), E, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // potted palms in the corners: a glazed pot, a gilt lip and a crown of fronds
  for (const [u, v] of L.plants) {
    box(u - 0.6, u + 0.6, v - 0.6, v + 0.6, 0, 1.8, LOOK.pot, 0.9);
    box(u - 0.65, u + 0.65, v - 0.65, v + 0.65, 1.8, 1.95, LOOK.gilt, 0.9);
    box(u - 0.08, u + 0.08, v - 0.08, v + 0.08, 1.95, 4.6, LOOK.trunk, 0.8);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2, cu = Math.cos(a), cv = Math.sin(a), eu = u + cu * 1.4, ev = v + cv * 1.4, y1 = 3.9 + (i % 2) * 0.3;
      const L1 = [eu + cv * 0.3, ev - cu * 0.3, y1], R1 = [eu - cv * 0.3, ev + cu * 0.3, y1], tip = [eu + cu * 0.3, ev + cv * 0.3, y1 - 0.5];
      quad(solid, [[u, v, 4.65], L1, tip, R1], [0, 1, 0], C(LOOK.frond, 0.85 + (i % 3) * 0.06));
      quad(solid, [[u, v, 4.65], R1, tip, L1], [0, -1, 0], C(LOOK.frond, 0.6));
    }
  }
  // the sofa facing the big screen, and the low table between them
  const so = L.sofa;
  box(so.u[0], so.u[1], so.v[0], so.v[1], 0, 1.45, LOOK.leather, 0.88, 'boothLeather');
  box(so.u[1] - 0.7, so.u[1], so.v[0], so.v[1], 1.45, 3.0, LOOK.leather, 0.82, 'boothLeather');
  for (const v of [so.v[0], so.v[1] - 0.6]) box(so.u[0], so.u[1], v, v + 0.6, 1.45, 2.2, LOOK.leather, 0.8, 'boothLeather');
  box(-11.8, -9.6, 10, 14, 1.2, 1.4, LOOK.wood, 0.9, 'boothWood');
  for (const [u, v] of [[-9.8, 10.2], [-11.6, 10.2], [-9.8, 13.8], [-11.6, 13.8]]) box(u - 0.1, u + 0.1, v - 0.1, v + 0.1, 0, 1.2, LOOK.frame);
  // the big screen on the left-hand wall: its bezel, and the picture on its own batch
  const tv = L.tv, tu = tv.u;
  box(tu, tu + 0.25, tv.v - tv.w / 2 - 0.25, tv.v + tv.w / 2 + 0.25, tv.y - tv.h / 2 - 0.25, tv.y + tv.h / 2 + 0.25, LOOK.frame, 0.7);
  {
    const v0 = tv.v - tv.w / 2, v1 = tv.v + tv.w / 2, y0 = tv.y - tv.h / 2, y1 = tv.y + tv.h / 2, u = tu + 0.27;
    // facing the wall (-u), your right is -v, so the picture runs from the back to the glass end
    quad(screen, [[u, v1, y0], [u, v0, y0], [u, v0, y1], [u, v1, y1]], nrmOf(1, 0, 0), [1, 1, 1], E, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
  }
  // the bar along the back wall: walnut panelled in brass, a marble top, a brass foot rail, and
  // behind it a back bar of lit onyx with glass shelves of bottles and a mirror over
  box(-hu, -3, D - 2.4, D - 0.9, 0, 3.4, LOOK.wood, 0.8, 'boothWood');
  for (let u = -hu + 2.9; u < -3.2; u += 1.6) box(u - 0.04, u + 0.04, D - 2.43, D - 2.4, 0.4, 3.1, LOOK.gilt, 0.95);
  box(-hu, -3, D - 2.43, D - 2.4, 3.1, 3.18, LOOK.gilt, 0.95);
  box(-hu, -2.8, D - 2.7, D - 0.9, 3.4, 3.62, LOOK.marble, 1, 'boothMarble');
  box(-hu + 2.4, -3, D - 2.85, D - 2.75, 0.45, 0.55, LOOK.gilt, 1.0);
  for (let u = -hu + 3; u < -3; u += 2.5) box(u - 0.05, u + 0.05, D - 2.8, D - 2.4, 0.2, 0.5, LOOK.gilt, 0.9);
  box(-hu + 2.4, -3, D - 0.6, D, 0, 2.8, LOOK.wood, 0.7, 'boothWood');
  quad(solid, [[-hu + 2.4, D - 0.04, 2.8], [-3, D - 0.04, 2.8], [-3, D - 0.04, 6.4], [-hu + 2.4, D - 0.04, 6.4]], nrmOf(0, 0, -1), C(LOOK.onyx, 1.25), E, null, true);
  quad(solid, [[-hu + 2.4, D - 0.05, 6.5], [-3, D - 0.05, 6.5], [-3, D - 0.05, 7.6], [-hu + 2.4, D - 0.05, 7.6]], nrmOf(0, 0, -1), C(LOOK.mirror, 0.8));
  box(-hu + 2.4, -3, D - 0.12, D - 0.04, 6.4, 6.5, LOOK.gilt, 1.0);
  const bottles = ['#2f6b3a', '#8a5a20', '#d8b84a', '#5a1f2a', '#e6e6e6', '#2a4a7a', '#b0442a'];
  for (const [y, n] of [[2.8, 12], [4.05, 11], [5.3, 10]]) {
    box(-hu + 2.4, -3, D - 0.55, D - 0.05, y, y + 0.05, LOOK.crystal, 0.95);
    for (let i = 0; i < n; i++) { const u = -hu + 2.8 + i * (6.3 / n); box(u - 0.12, u + 0.12, D - 0.4, D - 0.16, y + 0.05, y + 0.75 + (i % 3) * 0.15, bottles[(i * 3 + n) % bottles.length], 1.05); }
  }
  // three pendant globes over the bar top, and the stools at it
  for (let u = -9.6; u <= -4.6; u += 2.5) {
    box(u - 0.02, u + 0.02, D - 1.67, D - 1.63, 5.8, H, LOOK.gilt, 0.9);
    box(u - 0.3, u + 0.3, D - 1.95, D - 1.35, 5.2, 5.8, LOOK.lamp, 1.9);
  }
  for (const t of L.stools) {
    box(t.u - 0.07, t.u + 0.07, t.v - 0.07, t.v + 0.07, 0, 2.3, LOOK.gilt, 0.9);
    box(t.u - 0.35, t.u + 0.35, t.v - 0.35, t.v + 0.35, 0, 0.06, LOOK.gilt, 0.9);
    box(t.u - 0.4, t.u + 0.4, t.v - 0.4, t.v + 0.4, 2.3, 2.6, LOOK.leather, 0.9, 'boothLeather');
  }
  box(-hu, -hu + 2.4, D - 2.4, D, 0, 6.6, LOOK.frame, 0.8);
  quad(solid, [[-hu + 0.2, D - 2.42, 0.4], [-hu + 2.2, D - 2.42, 0.4], [-hu + 2.2, D - 2.42, 6.2], [-hu + 0.2, D - 2.42, 6.2]], nrmOf(0, 0, -1), C(LOOK.fridge, 0.95), E, null, true);
  // the buffet on the right-hand wall: its cloth, its trays and the heat lamps over them
  box(hu - 2.4, hu, 12.5, 18.1, 0, 3.0, LOOK.cloth, 0.9);
  for (const v of [13.5, 15.1, 16.7]) {
    box(hu - 2.0, hu - 0.4, v - 0.6, v + 0.6, 3.0, 3.3, LOOK.silver, 1.0);
    quad(solid, [[hu - 1.9, v + 0.5, 6.2], [hu - 0.5, v + 0.5, 6.2], [hu - 0.5, v - 0.5, 6.2], [hu - 1.9, v - 0.5, 6.2]], [0, -1, 0], C(LOOK.heat, 1.4), E, null, true);
    box(hu - 1.25, hu - 1.15, v - 0.05, v + 0.05, 6.2, H, LOOK.frame);
  }
  // the door at the back, shut
  box(5, 8.6, D - 0.05, D, 0, 7, LOOK.wood, 0.75, 'boothWood');
  return { solid, screen, glass, textured };
}

// THE ROOM'S LIGHT, baked into each vertex's colour: a cool fill off the glass, the chandelier,
// the sconces, the bar's pendants, the buffet's heat lamps and the cove round the ceiling, each
// falling off with distance and turned by the way the face looks; then contact shadow where a wall
// meets the floor or the ceiling and on the floor round and under the furniture. Kept under 1 so
// the bloom leaves it alone (the room's header).
function bakeLight(L) {
  const hu = L.w / 2, D = L.d, H = L.h;
  const WARM = [1, 0.84, 0.64], COOL = [0.82, 0.9, 1], AMB = [0.9, 0.9, 0.95];
  // [u, v, y, power, reach, tint]
  const lamps = [
    [1.5, 12, H - 2.4, 0.75, 9, WARM],
    ...[L.tv.v - L.tv.w / 2 - 1.2, L.tv.v + L.tv.w / 2 + 1.2].map((v) => [-hu + 0.8, v, 5.6, 0.32, 4.5, WARM]),
    ...[-9.6, -7.1, -4.6].map((u) => [u, D - 1.65, 5.4, 0.3, 4, WARM]),
    ...[13.5, 15.1, 16.7].map((v) => [hu - 1.2, v, 6.0, 0.25, 3.5, [1, 0.7, 0.42]]),
    ...[-hu * 0.6, 0, hu * 0.6].flatMap((u) => [[u, 0.8, H - 0.5, 0.22, 5, WARM], [u, D - 0.8, H - 0.5, 0.22, 5, WARM]]),
    ...[D * 0.3, D * 0.7].flatMap((v) => [[-hu + 0.8, v, H - 0.5, 0.22, 5, WARM], [hu - 0.8, v, H - 0.5, 0.22, 5, WARM]]),
  ];
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const boxes = [...L.solid, ...L.climb];
  return ([u, v, y], [nu, ny, nv], col) => {
    const lit = AMB.map((c) => c * (0.4 + 0.07 * ny));
    // the park through the glass: on what faces it, and less the deeper into the room
    const win = 0.22 * Math.max(0, -nv * 0.8 + 0.2) * Math.exp(-v / 10) + 0.06 * Math.exp(-v / 6);
    for (let k = 0; k < 3; k++) lit[k] += COOL[k] * win;
    for (const [lu, lv, ly, pw, reach, tint] of lamps) {
      const du = lu - u, dv = lv - v, dy = ly - y, d = Math.hypot(du, dv, dy) || 1;
      const cos = (du * nu + dv * nv + dy * ny) / d;
      const e = pw * Math.max(0, cos * 0.8 + 0.2) / (1 + (d / reach) * (d / reach));
      for (let k = 0; k < 3; k++) lit[k] += tint[k] * e;
    }
    // contact shadow
    let ao = 1;
    const dw = Math.min(u + hu, hu - u, D - v);
    if (ny > 0.9 && y < 0.2) {
      ao *= 0.72 + 0.28 * sstep(0, 2.2, dw);
      for (const [a, b, c, e] of boxes) {
        const ou = Math.max(a - u, 0, u - b), ov = Math.max(c - v, 0, v - e);
        ao *= 0.5 + 0.5 * sstep(0, 1.4, Math.hypot(ou, ov));
      }
    } else if (ny < -0.9 && y > H - 0.3) ao *= 0.78 + 0.22 * sstep(0, 2.5, Math.min(dw, v));
    else if (Math.abs(ny) < 0.5) ao *= (0.7 + 0.3 * sstep(0, 1.8, y)) * (0.85 + 0.15 * sstep(0, 1.2, H - y));
    return col.map((c, k) => Math.min(0.97, c * lit[k] * ao * 1.12));
  };
}

// ── the materials ─────────────────────────────────────────────────────────────
// Each a 512-pixel square that tiles, painted once by the renderer (gl/ballpark.js setRoom). The
// noise is seeded, so it's the same room every time.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function paintBoothTexture(doc, key) {
  const N = 512, c = doc.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), r = rng([...key].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261));
  // specks over the whole tile, each drawn at all four wraps so the tile repeats without a seam
  const specks = (n, size, cols, a) => {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + r() * 0.6); g.fillStyle = cols[(r() * cols.length) | 0];
      const x = r() * N, y = r() * N, w = size * (0.5 + r()), h = size * (0.5 + r());
      for (const [ox, oy] of [[0, 0], [-N, 0], [0, -N], [-N, -N]]) g.fillRect(x + ox, y + oy, w, h);
    }
    g.globalAlpha = 1;
  };
  if (key === 'boothCarpet') {
    // deep navy wool with a silver trellis woven in and a gold stud where the diamonds meet
    g.fillStyle = '#1b2236'; g.fillRect(0, 0, N, N);
    specks(26000, 2, ['#121828', '#26304a', '#1e2740'], 0.8);
    g.strokeStyle = 'rgba(196,204,218,0.55)'; g.lineWidth = 5;
    for (const [x, y] of [[0, 0], [N, 0], [0, N], [N, N], [N / 2, N / 2]]) {
      g.beginPath(); g.moveTo(x, y - N / 4); g.lineTo(x + N / 4, y); g.lineTo(x, y + N / 4); g.lineTo(x - N / 4, y); g.closePath(); g.stroke();
    }
    g.fillStyle = 'rgba(214,190,120,0.75)';
    for (const [x, y] of [[N / 2, 0], [0, N / 2], [N, N / 2], [N / 2, N], [N / 4, N / 4], [3 * N / 4, N / 4], [N / 4, 3 * N / 4], [3 * N / 4, 3 * N / 4]]) { g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill(); }
  } else if (key === 'boothLeather') {
    // cream hide with a pebbled grain and a soft sheen, a button now and then, pleats out from each
    g.fillStyle = '#ece5d6'; g.fillRect(0, 0, N, N);
    specks(22000, 3, ['#e2d9c6', '#f6f1e6', '#d9cfbb'], 0.45);
    specks(5000, 7, ['rgba(255,252,244,0.6)', 'rgba(200,188,166,0.5)'], 0.18);
    const S = N;
    for (const [cx, cy] of [[N / 2, N / 2], [0, 0], [N, 0], [0, N], [N, N]]) {
      const grd = g.createRadialGradient(cx, cy, 2, cx, cy, S * 0.45);
      grd.addColorStop(0, 'rgba(110,90,62,0.5)'); grd.addColorStop(0.3, 'rgba(160,140,110,0.14)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(cx - S, cy - S, S * 2, S * 2);
      g.strokeStyle = 'rgba(120,100,72,0.3)'; g.lineWidth = 3;
      for (const [dx, dy] of [[1, 0.5], [1, -0.5], [-1, 0.5], [-1, -0.5]]) { g.beginPath(); g.moveTo(cx + dx * 12, cy + dy * 12); g.lineTo(cx + dx * S * 0.5, cy + dy * S * 0.5); g.stroke(); }
      g.fillStyle = '#7a6448'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,240,210,0.5)'; g.beginPath(); g.arc(cx - 3, cy - 3, 3, 0, Math.PI * 2); g.fill();
    }
  } else if (key === 'boothWood') {
    // walnut, quarter-sawn: long wavering grain, whole waves across the tile so it repeats
    g.fillStyle = '#5b3a22'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 150; i++) {
      const y0 = r() * N, amp = 2 + r() * 7, ph = r() * 6.28, dark = r() < 0.6;
      g.strokeStyle = dark ? `rgba(40,22,10,${0.25 + r() * 0.35})` : `rgba(160,112,66,${0.15 + r() * 0.25})`;
      g.lineWidth = 0.6 + r() * 2.4;
      for (const oy of [-N, 0, N]) {
        g.beginPath();
        for (let x = 0; x <= N; x += 8) { const y = oy + y0 + Math.sin(x / N * Math.PI * 4 + ph) * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
    }
    specks(3000, 6, ['rgba(180,130,80,0.5)', 'rgba(30,16,8,0.5)'], 0.25);
    // the French polish: a soft highlight that tiles top to bottom
    const sh = g.createLinearGradient(0, 0, 0, N);
    for (const [t, a] of [[0, 0], [0.3, 0.12], [0.5, 0.02], [0.8, 0.1], [1, 0]]) sh.addColorStop(t, 'rgba(255,220,170,' + a + ')');
    g.fillStyle = sh; g.fillRect(0, 0, N, N);
  } else if (key === 'boothMarble') {
    // white Carrara: soft clouds and grey veins that fork as they go
    g.fillStyle = '#f2f0eb'; g.fillRect(0, 0, N, N);
    specks(400, 60, ['rgba(220,218,214,0.5)', 'rgba(250,250,248,0.6)'], 0.3);
    const vein = (x, y, a, len, w) => {
      const pts = [[x, y]];
      for (let i = 0; i < len; i++) {
        a += (r() - 0.5) * 0.5; x += Math.cos(a) * 6; y += Math.sin(a) * 6; pts.push([x, y]);
        if (w > 0.8 && r() < 0.03) vein(x, y, a + (r() - 0.5) * 1.6, len / 2, w * 0.6);
      }
      g.lineWidth = w; g.strokeStyle = `rgba(110,112,118,${0.25 + w * 0.12})`;
      for (const [ox, oy] of [[0, 0], [-N, 0], [N, 0], [0, -N], [0, N]]) {
        g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy))); g.stroke();
      }
    };
    for (let i = 0; i < 5; i++) vein(r() * N, r() * N, r() * 6.28, 90, 1.6 + r() * 1.2);
  } else if (key === 'boothRug') {
    // a hand-knotted rug, the whole of it in one tile: a deep red field, a medallion, gold borders
    g.fillStyle = '#5a1620'; g.fillRect(0, 0, N, N);
    specks(30000, 2, ['#4a1018', '#6a1e28', '#561520'], 0.7);
    const frame = (m, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.strokeRect(m, m, N - 2 * m, N - 2 * m); };
    g.fillStyle = '#1c2236'; g.fillRect(14, 14, N - 28, 44); g.fillRect(14, N - 58, N - 28, 44); g.fillRect(14, 14, 44, N - 28); g.fillRect(N - 58, 14, 44, N - 28);
    frame(10, '#c9a24a', 5); frame(60, '#c9a24a', 4); frame(36, 'rgba(201,162,74,0.6)', 2);
    g.fillStyle = '#c9a24a';
    for (let i = 80; i < N - 60; i += 28) for (const [x, y] of [[i, 36], [i, N - 36], [36, i], [N - 36, i]]) { g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.fill(); }
    const cx = N / 2, cy = N / 2;
    for (const [rx, ry, col] of [[150, 110, '#c9a24a'], [138, 98, '#1c2236'], [100, 70, '#8a2a30'], [60, 42, '#e8d8b0'], [30, 20, '#1c2236']]) { g.fillStyle = col; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(232,216,176,0.7)'; g.lineWidth = 2;
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 64, cy + Math.sin(a) * 45); g.lineTo(cx + Math.cos(a) * 134, cy + Math.sin(a) * 94); g.stroke(); }
    g.fillStyle = '#c9a24a';
    for (const [x, y] of [[96, 96], [N - 96, 96], [96, N - 96], [N - 96, N - 96]]) { g.beginPath(); g.moveTo(x, y - 22); g.lineTo(x + 22, y); g.lineTo(x, y + 22); g.lineTo(x - 22, y); g.fill(); }
  } else {
    // a silk wall covering: a fine weave, a tone-on-tone damask, and a panel seam each repeat
    g.fillStyle = '#e8e1d2'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < N; i += 3) {
      g.fillStyle = `rgba(150,140,120,${0.05 + r() * 0.07})`; g.fillRect(i, 0, 1, N);
      g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; g.fillRect(0, i, N, 1);
    }
    specks(5000, 2, ['#d8cfbe', '#f2ece0'], 0.4);
    g.fillStyle = 'rgba(176,150,100,0.16)';
    for (const [x, y] of [[N / 2, N / 2], [0, 0], [N, 0], [0, N], [N, N]]) {
      for (const k of [1, -1]) { g.beginPath(); g.moveTo(x, y - 110); g.bezierCurveTo(x + k * 90, y - 70, x + k * 60, y + 20, x, y + 110); g.bezierCurveTo(x + k * 25, y + 20, x + k * 40, y - 50, x, y - 110); g.fill(); }
      g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(120,108,90,0.45)'; g.fillRect(0, 0, 3, N);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(3, 0, 2, N);
  }
  return c;
}
