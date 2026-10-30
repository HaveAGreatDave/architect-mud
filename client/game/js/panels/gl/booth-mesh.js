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
  const w = spec.w || 30, d = spec.d || 32, h = spec.h || 8.5, floor = spec.floor || 0;
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
  // the buffet along the right-hand wall, its back end clear of the corner palm, a tray every 2 ft
  const buffet = { u: [hu - 2.4, hu], v: [d - 14, d - 4.5] };
  buffet.trays = [];
  for (let v = buffet.v[0] + 1.2; v < buffet.v[1] - 0.8; v += 2.05) buffet.trays.push(v);
  // what a click or E helps you to: `stands fetch <target>` (plugins/stands), the furniture's alias
  const stations = [
    { target: 'bar', u: -7.5, v: d - 2.4, y: 3.6, reach: 5 },
    { target: 'buffet', u: hu - 2.4, v: (buffet.v[0] + buffet.v[1]) / 2, y: 3.2, reach: 5.5 },
    { target: 'smokes', u: -3, v: 5.5, y: 2.1, reach: 3 },
  ];
  const sofa = { u: [-7.6, -4.8], v: [8.4, 15.6] };
  // on the left-hand wall, clear of the bar and its fridge at the back
  const tv = { u: -hu + 0.15, v: 12, y: 5.1, w: 8.4, h: 4.7 };
  // [u0, u1, v0, v1]: what a walker can't stand in
  const solid = [
    ...plants.map(([u, v]) => [u - 0.8, u + 0.8, v - 0.8, v + 0.8]),
    [-hu, -3, d - 2.4, d],
    [buffet.u[0], buffet.u[1], buffet.v[0], buffet.v[1]],
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
  return { spec, w, d, h, floor, f, r, at, yaw, world, local, step, chairs, stools, plants, sofa, tv, buffet, stations, solid, climb, seats,
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
  // a gilt button on a face of the leather, proud of it by its own depth
  const button = (bx, u, v, y) => bx(u - 0.045, u + 0.045, v - 0.045, v + 0.045, y - 0.045, y + 0.045, LOOK.gilt, 1.2);
  // a cut-glass drop: an octahedron, each facet its own brightness so it glints from any side
  const drop = (u, v, y, r, len, k = 1) => {
    const top = [u, v, y], bot = [u, v, y - len], m = y - len * 0.42;
    const ring = [[u + r, v, m], [u, v + r, m], [u - r, v, m], [u, v - r, m]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4], g = 1.15 + ((i * 7 + Math.round(u * 13 + v * 5)) % 5) * 0.12;
      quad(solid, [top, a, b, b], [0, 1, 0], C(LOOK.crystal, g * k), E, null, true);
      quad(solid, [bot, b, a, a], [0, -1, 0], C('#cfe0f4', (2.3 - g) * k), E, null, true);
    }
  };
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
  // THE CHANDELIER: a gilt canopy and stem, a glass bowl of hanging drops under three rings of
  // candle-cups, swags of beads looped between the arms, and a long faceted pendant at the bottom
  const ch = { u: 1.5, v: 12 };
  box(ch.u - 1.0, ch.u + 1.0, ch.v - 1.0, ch.v + 1.0, H - 0.1, H - 0.02, LOOK.gilt, 0.95);
  box(ch.u - 0.45, ch.u + 0.45, ch.v - 0.45, ch.v + 0.45, H - 0.35, H - 0.1, LOOK.gilt, 1.0);
  box(ch.u - 0.04, ch.u + 0.04, ch.v - 0.04, ch.v + 0.04, H - 1.9, H - 0.35, LOOK.gilt, 0.9);
  for (let y = H - 1.75; y < H - 0.5; y += 0.32) drop(ch.u, ch.v, y + 0.12, 0.09, 0.22, 0.9);
  for (const [rad, y, n] of [[1.75, H - 2.2, 14], [1.2, H - 1.75, 10], [0.7, H - 1.35, 7]]) {
    // the ring as a thin gilt band of segments, a glass cup and a candle at each arm
    for (let i = 0; i < n * 2; i++) {
      const a0 = i / (n * 2) * Math.PI * 2, a1 = (i + 1) / (n * 2) * Math.PI * 2;
      const p0 = [ch.u + Math.cos(a0) * rad, ch.v + Math.sin(a0) * rad], p1 = [ch.u + Math.cos(a1) * rad, ch.v + Math.sin(a1) * rad];
      quad(solid, [[p0[0], p0[1], y], [p1[0], p1[1], y], [p1[0], p1[1], y - 0.06], [p0[0], p0[1], y - 0.06]], [0, 0, 1], C(LOOK.gilt, 1.0), E, null, true);
    }
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI * 2, u = ch.u + Math.cos(a) * rad, v = ch.v + Math.sin(a) * rad;
      box(u - 0.13, u + 0.13, v - 0.13, v + 0.13, y, y + 0.06, LOOK.crystal, 1.3);
      box(u - 0.035, u + 0.035, v - 0.035, v + 0.035, y + 0.06, y + 0.34, LOOK.cloth, 1.4);
      box(u - 0.05, u + 0.05, v - 0.05, v + 0.05, y + 0.34, y + 0.46, LOOK.lamp, 2.0);
      // the drops: one long under each arm, a strand of beads between it and the next
      drop(u, v, y - 0.06, 0.1, 0.5 + (i % 2) * 0.18);
      const b = (i + 1) / n * Math.PI * 2, nu = ch.u + Math.cos(b) * rad, nv = ch.v + Math.sin(b) * rad;
      for (let t = 1; t < 6; t++) {
        const f = t / 6, sag = Math.sin(f * Math.PI) * 0.32;
        drop(u + (nu - u) * f, v + (nv - v) * f, y - 0.06 - sag, 0.045, 0.1, 0.95);
      }
    }
  }
  // the bowl: rings of drops narrowing to the pendant
  for (const [rad, y, n] of [[0.55, H - 2.35, 9], [0.35, H - 2.65, 6], [0.16, H - 2.9, 4]]) {
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; drop(ch.u + Math.cos(a) * rad, ch.v + Math.sin(a) * rad, y, 0.07, 0.34); }
  }
  drop(ch.u, ch.v, H - 2.95, 0.18, 0.75, 1.05);
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
    // a row of three across the back where it meets the seat, one up the middle, one on each arm
    for (const du of [-0.6, 0, 0.6]) button(box, c.u + du, c.v + 0.97, y + 1.6);
    button(box, c.u, c.v + 0.97, y + 2.55);
    for (const sd of [-1, 1]) button(box, c.u + sd * 1.11, c.v - 1.13, y + 1.65);
    // a gilt piping along the top of the back
    box(c.u - 1.3, c.u + 1.3, c.v + 0.98, c.v + 1.04, y + 3.24, y + 3.3, LOOK.gilt, 1.0);
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
  for (let v = so.v[0] + 1.2; v < so.v[1] - 0.9; v += 1.2) button(box, so.u[1] - 0.73, v, 1.8);
  for (const v of [so.v[0] + 0.3, so.v[1] - 0.3]) button(box, so.u[0] - 0.03, v, 1.9);
  box(so.u[1] - 0.7, so.u[1] - 0.64, so.v[0], so.v[1], 2.94, 3.0, LOOK.gilt, 1.0);
  // brass feet under it
  for (const [u, v] of [[so.u[0] + 0.2, so.v[0] + 0.2], [so.u[1] - 0.2, so.v[0] + 0.2], [so.u[0] + 0.2, so.v[1] - 0.2], [so.u[1] - 0.2, so.v[1] - 0.2]]) box(u - 0.09, u + 0.09, v - 0.09, v + 0.09, -0.01, 0.12, LOOK.gilt, 0.95);
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
  const BU = [-hu + 2.4, -3];
  box(-hu, -3, D - 2.4, D - 0.9, 0, 3.4, LOOK.wood, 0.75, 'boothWood');
  // the front: a black kick plate, raised walnut panels framed in brass, a brass band under the top
  box(-hu + 2.4, -3, D - 2.46, D - 2.4, 0, 0.35, LOOK.frame, 0.8);
  for (let u = -hu + 2.5; u < -3.3; u += 1.6) {
    const u1 = Math.min(u + 1.4, -3.1);
    box(u, u1, D - 2.46, D - 2.4, 0.55, 3.0, LOOK.gilt, 0.95);
    box(u + 0.06, u1 - 0.06, D - 2.5, D - 2.4, 0.61, 2.94, LOOK.wood, 0.85, 'boothWood');
    box(u + 0.3, u1 - 0.3, D - 2.53, D - 2.5, 0.9, 2.65, LOOK.wood, 0.95, 'boothWood');
  }
  box(-hu, -3, D - 2.47, D - 2.4, 3.1, 3.2, LOOK.gilt, 1.0);
  // the marble top with its rounded nosing, and a brass rail along the front to lean on
  box(-hu, -2.8, D - 2.7, D - 0.9, 3.4, 3.62, LOOK.marble, 1, 'boothMarble');
  box(-hu, -2.8, D - 2.78, D - 2.7, 3.44, 3.58, LOOK.marble, 0.95, 'boothMarble');
  box(-hu + 2.4, -3, D - 2.85, D - 2.75, 0.45, 0.55, LOOK.gilt, 1.0);
  for (let u = -hu + 3; u < -3; u += 2.5) box(u - 0.05, u + 0.05, D - 2.8, D - 2.4, 0.2, 0.5, LOOK.gilt, 0.9);
  // on the top: three brass taps with black handles, a drip tray, a shaker and a pair of coupes
  for (const u of [-8.6, -7.8, -7.0]) {
    box(u - 0.08, u + 0.08, D - 1.4, D - 1.24, 3.62, 4.5, LOOK.gilt, 1.05);
    box(u - 0.05, u + 0.05, D - 1.62, D - 1.4, 4.32, 4.42, LOOK.gilt, 1.05);
    box(u - 0.04, u + 0.04, D - 1.36, D - 1.28, 4.5, 5.0, LOOK.frame, 0.6);
  }
  box(-8.9, -6.7, D - 1.8, D - 1.5, 3.62, 3.66, LOOK.silver, 0.9);
  box(-5.3, -5.0, D - 1.9, D - 1.6, 3.62, 4.25, LOOK.silver, 1.1);
  box(-5.24, -5.06, D - 1.84, D - 1.66, 4.25, 4.4, LOOK.silver, 1.0);
  for (const u of [-4.4, -3.9]) {
    box(u - 0.03, u + 0.03, D - 1.78, D - 1.72, 3.62, 3.95, LOOK.crystal, 1.2);
    box(u - 0.17, u + 0.17, D - 1.92, D - 1.58, 3.95, 4.12, LOOK.crystal, 1.3);
  }
  // the back bar: walnut base, lit onyx in three panels between brass pilasters, the mirror over
  box(BU[0], BU[1], D - 0.6, D, 0, 2.8, LOOK.wood, 0.7, 'boothWood');
  box(BU[0], BU[1], D - 0.66, D - 0.6, 2.7, 2.8, LOOK.gilt, 1.0);
  quad(solid, [[BU[0], D - 0.04, 2.8], [BU[1], D - 0.04, 2.8], [BU[1], D - 0.04, 6.4], [BU[0], D - 0.04, 6.4]], nrmOf(0, 0, -1), C(LOOK.onyx, 1.25), E, null, true);
  for (let i = 0; i <= 3; i++) { const u = BU[0] + (BU[1] - BU[0]) * i / 3; box(u - 0.09, u + 0.09, D - 0.14, D - 0.04, 2.8, 7.6, LOOK.gilt, 1.0); }
  quad(solid, [[BU[0], D - 0.05, 6.5], [BU[1], D - 0.05, 6.5], [BU[1], D - 0.05, 7.6], [BU[0], D - 0.05, 7.6]], nrmOf(0, 0, -1), C(LOOK.mirror, 0.8));
  box(BU[0], BU[1], D - 0.12, D - 0.04, 6.4, 6.5, LOOK.gilt, 1.0);
  box(BU[0], BU[1], D - 0.2, D - 0.04, 7.6, 7.75, LOOK.wood, 0.8, 'boothWood');
  // bottles on glass shelves: a body, a shoulder, a neck, a cap and a label
  const bottles = ['#1f4a2a', '#7a4a18', '#c9a83e', '#4a1622', '#d8d8d8', '#22385e', '#9a3820', '#2a2a2a'];
  for (const [y, n] of [[2.8, 12], [4.05, 11], [5.3, 10]]) {
    box(BU[0], BU[1], D - 0.55, D - 0.05, y, y + 0.05, LOOK.crystal, 0.95);
    for (let i = 0; i < n; i++) {
      const u = BU[0] + 0.4 + i * (6.3 / n), hb = 0.5 + (i % 3) * 0.12, col = bottles[(i * 3 + n) % bottles.length], v = D - 0.28, sq = i % 4 === 1;
      const r = sq ? 0.12 : 0.1;
      box(u - r, u + r, v - r, v + r, y + 0.05, y + 0.05 + hb, col, 1.0);
      box(u - r * 0.6, u + r * 0.6, v - r * 0.6, v + r * 0.6, y + 0.05 + hb, y + 0.13 + hb, col, 0.95);
      box(u - 0.035, u + 0.035, v - 0.035, v + 0.035, y + 0.13 + hb, y + 0.36 + hb, col, 0.95);
      box(u - 0.045, u + 0.045, v - 0.045, v + 0.045, y + 0.36 + hb, y + 0.42 + hb, i % 2 ? LOOK.gilt : LOOK.frame, 1.0);
      box(u - r - 0.005, u + r + 0.005, v - r - 0.005, v - r + 0.002, y + 0.18, y + 0.18 + hb * 0.45, i % 3 ? LOOK.cloth : LOOK.gilt, 0.95);
    }
  }
  // a rack over the bar top with stemware hanging upside down from it
  box(-11.4, -3.6, D - 1.9, D - 1.4, 6.6, 6.7, LOOK.wood, 0.8, 'boothWood');
  for (const u of [-11.2, -3.8]) box(u - 0.03, u + 0.03, D - 1.68, D - 1.62, 6.7, H, LOOK.gilt, 0.9);
  for (let u = -11.1; u < -3.8; u += 0.42) for (const v of [D - 1.8, D - 1.5]) {
    if (u > -10.0 && u < -9.2 || u > -7.5 && u < -6.7 || u > -5.0 && u < -4.2) continue;  // room for the globes
    box(u - 0.14, u + 0.14, v - 0.14, v + 0.14, 6.28, 6.48, LOOK.crystal, 1.25);
    box(u - 0.02, u + 0.02, v - 0.02, v + 0.02, 6.48, 6.6, LOOK.crystal, 1.2);
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
  // the smokes on the table between the left-hand pair: a silver cigarette box with its lid up and
  // a row of white filters showing, and a cut-glass ashtray with a cigarette left burning in it
  {
    const tu = -3.25, tv = 5.68, ty = 2.05;
    box(tu - 0.16, tu + 0.16, tv - 0.11, tv + 0.11, ty, ty + 0.1, LOOK.silver, 1.1);
    box(tu - 0.16, tu + 0.16, tv + 0.1, tv + 0.12, ty + 0.1, ty + 0.3, LOOK.silver, 1.2);
    for (let k = 0; k < 7; k++) { const u = tu - 0.12 + k * 0.04; box(u - 0.015, u + 0.015, tv - 0.08, tv + 0.08, ty + 0.1, ty + 0.13, k % 3 ? LOOK.cloth : '#d9a860', 1.15); }
    const au = -2.75, av = 5.78;
    box(au - 0.17, au + 0.17, av - 0.17, av + 0.17, ty, ty + 0.06, LOOK.crystal, 1.2);
    box(au - 0.11, au + 0.11, av - 0.11, av + 0.11, ty + 0.06, ty + 0.065, '#5a5a5e', 0.9);
    box(au - 0.02, au + 0.18, av - 0.012, av + 0.012, ty + 0.065, ty + 0.085, LOOK.cloth, 1.15);
    box(au - 0.03, au - 0.01, av - 0.013, av + 0.013, ty + 0.065, ty + 0.086, LOOK.heat, 1.6);
  }
  // THE BUFFET on the right-hand wall: a long table under a white cloth with a gilt-fringed skirt,
  // heat lamps on brass stems over silver chafing trays, and the food on them in turn: shrimp on
  // crushed ice, sliders in rows, franks on china. Plates, napkins and a carving board at the ends.
  const bf = L.buffet, bu0 = bf.u[0], bu1 = bf.u[1], BT = 3.0;
  box(bu0, bu1, bf.v[0], bf.v[1], 0, BT, LOOK.cloth, 0.9);
  box(bu0 - 0.04, bu0, bf.v[0], bf.v[1], 0.35, 0.45, LOOK.gilt, 1.0);
  box(bu0 - 0.02, bu1, bf.v[0], bf.v[1], BT - 0.05, BT, LOOK.cloth, 1.0);
  const FOOD = { shrimp: '#f08a6a', shrimpTail: '#e0583e', ice: '#e6f4fa', bun: '#c98a45', bunTop: '#b5722f', patty: '#4a2a1a', cheese: '#f0b830',
    lettuce: '#6aa84a', frank: '#a8452e', mustard: '#e0b020', china: '#f4f4f0', napkin: '#efe8da', lemon: '#f2dc50' };
  bf.trays.forEach((v, i) => {
    const kind = i % 3, tu = bu0 + 1.2;
    // the chafing dish: a silver pan on a stand, its lid tilted open behind
    box(tu - 0.75, tu + 0.75, v - 0.85, v + 0.85, BT, BT + 0.08, LOOK.silver, 0.8);
    box(tu - 0.7, tu + 0.7, v - 0.8, v + 0.8, BT + 0.08, BT + 0.3, LOOK.silver, 1.05);
    box(tu + 0.55, tu + 0.75, v - 0.8, v + 0.8, BT + 0.3, BT + 1.1, LOOK.silver, 1.1);
    const top = BT + 0.3;
    if (kind === 0) {
      // shrimp on ice: a mound of crushed ice, the shrimp ringed round it, lemon wedges
      box(tu - 0.62, tu + 0.62, v - 0.72, v + 0.72, top - 0.05, top + 0.08, FOOD.ice, 1.15);
      box(tu - 0.35, tu + 0.35, v - 0.4, v + 0.4, top + 0.08, top + 0.18, FOOD.ice, 1.2);
      for (let k = 0; k < 14; k++) {
        const a = k / 14 * Math.PI * 2, su = tu + Math.cos(a) * 0.48, sv = v + Math.sin(a) * 0.58;
        box(su - 0.07, su + 0.07, sv - 0.07, sv + 0.07, top + 0.08, top + 0.16, FOOD.shrimp, 1.0);
        const tu2 = tu + Math.cos(a) * 0.6, tv2 = v + Math.sin(a) * 0.7;
        box(tu2 - 0.035, tu2 + 0.035, tv2 - 0.035, tv2 + 0.035, top + 0.08, top + 0.13, FOOD.shrimpTail, 1.0);
      }
      for (const dv of [-0.15, 0.15]) box(tu - 0.06, tu + 0.06, v + dv - 0.1, v + dv + 0.1, top + 0.18, top + 0.24, FOOD.lemon, 1.1);
    } else if (kind === 1) {
      // sliders: three rows of little burgers, a bun, a patty, a slice of cheese, the top bun
      for (let a = -1; a <= 1; a++) for (let b = -2; b <= 2; b++) {
        const su = tu + a * 0.38, sv = v + b * 0.3;
        box(su - 0.13, su + 0.13, sv - 0.12, sv + 0.12, top, top + 0.06, FOOD.bun, 0.95);
        box(su - 0.14, su + 0.14, sv - 0.13, sv + 0.13, top + 0.06, top + 0.11, FOOD.patty, 1.0);
        box(su - 0.15, su + 0.15, sv - 0.1, sv + 0.1, top + 0.11, top + 0.125, FOOD.cheese, 1.1);
        box(su - 0.13, su + 0.13, sv - 0.12, sv + 0.12, top + 0.125, top + 0.2, FOOD.bunTop, 1.0);
        box(su - 0.09, su + 0.09, sv - 0.08, sv + 0.08, top + 0.2, top + 0.24, FOOD.bunTop, 1.05);
      }
    } else {
      // franks in buns on a white china platter, a line of mustard down each
      box(tu - 0.6, tu + 0.6, v - 0.72, v + 0.72, top, top + 0.03, FOOD.china, 1.1);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b += 2) {
        const su = tu + a * 0.36, sv = v + b * 0.3;
        box(su - 0.09, su + 0.09, sv - 0.26, sv + 0.26, top + 0.03, top + 0.12, FOOD.bun, 1.0);
        box(su - 0.045, su + 0.045, sv - 0.3, sv + 0.3, top + 0.08, top + 0.15, FOOD.frank, 1.0);
        box(su - 0.012, su + 0.012, sv - 0.24, sv + 0.24, top + 0.15, top + 0.165, FOOD.mustard, 1.1);
      }
    }
    // the heat lamp: a brass stem from the ceiling, a hood, the glow under it
    box(tu - 0.05, tu + 0.05, v - 0.05, v + 0.05, 6.4, H, LOOK.gilt, 0.9);
    box(tu - 0.55, tu + 0.55, v - 0.45, v + 0.45, 6.2, 6.4, LOOK.gilt, 0.95);
    quad(solid, [[tu - 0.5, v + 0.4, 6.19], [tu + 0.5, v + 0.4, 6.19], [tu + 0.5, v - 0.4, 6.19], [tu - 0.5, v - 0.4, 6.19]], [0, -1, 0], C(LOOK.heat, 1.4), E, null, true);
  });
  // a stack of plates and the napkins at the near end, a carving board at the far end
  const pv = bf.v[0] + 0.45, nu = bu0 + 0.6;
  for (let k = 0; k < 8; k++) box(nu - 0.3, nu + 0.3, pv - 0.3, pv + 0.3, BT + k * 0.035, BT + k * 0.035 + 0.03, FOOD.china, 1.1 - (k % 2) * 0.05);
  for (let k = 0; k < 5; k++) box(nu + 0.8 - 0.22, nu + 0.8 + 0.22, pv - 0.22 + k * 0.01, pv + 0.22 + k * 0.01, BT + k * 0.02, BT + k * 0.02 + 0.02, FOOD.napkin, 1.05);
  const cv = bf.v[1] - 0.6;
  box(bu0 + 0.5, bu0 + 1.9, cv - 0.4, cv + 0.4, BT, BT + 0.12, LOOK.wood, 1.0, 'boothWood');
  box(bu0 + 0.8, bu0 + 1.6, cv - 0.25, cv + 0.25, BT + 0.12, BT + 0.42, FOOD.patty, 1.15);
  box(bu0 + 1.7, bu0 + 1.75, cv - 0.3, cv + 0.3, BT + 0.12, BT + 0.16, LOOK.silver, 1.2);
  // a scoreboard on the back wall between the bar and the door: the park's own board in little
  // (diamond/board.js), the line score by inning, R H E, the count and the outs, lit lamp by lamp
  {
    const bu0 = -2.4, bu1 = 4.4, by0 = 4.9, by1 = by0 + (bu1 - bu0) * 84 / 240;
    box(bu0 - 0.25, bu1 + 0.25, D - 0.3, D, by0 - 0.25, by1 + 0.25, LOOK.wood, 0.85, 'boothWood');
    box(bu0 - 0.1, bu1 + 0.1, D - 0.34, D - 0.3, by0 - 0.1, by1 + 0.1, LOOK.gilt, 1.0);
    quad(solid, [[bu1, D - 0.35, by0], [bu0, D - 0.35, by0], [bu0, D - 0.35, by1], [bu1, D - 0.35, by1]], nrmOf(0, 0, -1), [1, 1, 1], MAT.BOARD, [[0, 1], [1, 1], [1, 0], [0, 0]], true);
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
    ...L.buffet.trays.map((v) => [hu - 1.2, v, 6.0, 0.22, 3.5, [1, 0.7, 0.42]]),
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
  const N = key === 'boothRug' ? 1024 : 512, c = doc.createElement('canvas');
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
    // white nappa: a fine pebbled grain, a soft sheen that wanders, and faint creases. The buttons
    // are geometry (buildBooth button), so the tile has none and repeats unseen
    g.fillStyle = '#ece7dc'; g.fillRect(0, 0, N, N);
    specks(40000, 2, ['#e2dccf', '#f6f2ea', '#dcd5c6'], 0.6);
    specks(9000, 4, ['rgba(255,255,255,0.6)', 'rgba(170,158,136,0.45)'], 0.22);
    for (const [cx, cy, rad] of [[N * 0.3, N * 0.35, N * 0.35], [N * 0.75, N * 0.7, N * 0.3], [N * 0.8, N * 0.15, N * 0.2]]) {
      for (const [ox, oy] of [[0, 0], [-N, 0], [0, -N], [-N, -N], [N, 0], [0, N]]) {
        const grd = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
        grd.addColorStop(0, 'rgba(255,253,248,0.45)'); grd.addColorStop(1, 'rgba(255,253,248,0)');
        g.fillStyle = grd; g.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
      }
    }
    g.lineWidth = 1.2;
    for (let i = 0; i < 40; i++) {
      const x = r() * N, y = r() * N, a = r() * 6.28, l = 20 + r() * 50;
      g.strokeStyle = r() < 0.6 ? 'rgba(150,136,112,0.35)' : 'rgba(255,255,255,0.6)';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.4) * l / 2, y + Math.sin(a + 0.4) * l / 2, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
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
    // a hand-knotted silk rug in ivory, navy and gold: a fringe at each end, a guard stripe, a main
    // border of running scrolls, an ivory field of fine vines, and a navy medallion with a gold
    // star at its heart. Drawn mirrored four ways, as a rug is knotted.
    const IV = '#e9e0cc', NV = '#141b30', GD = '#b8913f', RD = '#6e1c26', SK = '#cfc3a6';
    const fr = 28;
    g.fillStyle = '#d9cfba'; g.fillRect(0, 0, N, N);
    // the fringe
    g.strokeStyle = '#efe7d4'; g.lineWidth = 2;
    for (let x = 4; x < N; x += 6) for (const [y0, y1] of [[0, fr], [N - fr, N]]) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (r() - 0.5) * 3, y1); g.stroke(); }
    const R = [fr, fr, N - fr * 2, N - fr * 2], [X0, Y0, W, Hh] = R;
    const rect = (m, col) => { g.fillStyle = col; g.fillRect(X0 + m, Y0 + m, W - 2 * m, Hh - 2 * m); };
    rect(0, NV); rect(6, GD); rect(10, NV); rect(16, RD); rect(20, NV);
    // the main border's scroll: a running wave in gold with ivory buds
    rect(70, GD); rect(74, IV);
    g.save(); g.beginPath(); g.rect(X0 + 20, Y0 + 20, W - 40, Hh - 40); g.rect(X0 + 70, Y0 + 70, W - 140, Hh - 140); g.clip('evenodd');
    g.strokeStyle = GD; g.lineWidth = 4;
    const scroll = (len, place) => {
      g.beginPath();
      for (let t = 0; t <= len; t += 4) { const [x, y] = place(t, Math.sin(t / 40 * Math.PI) * 14); if (t) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      for (let t = 20; t < len; t += 40) {
        const up = Math.round(t / 40) % 2 ? 1 : -1, [x, y] = place(t, up * 8);
        g.fillStyle = IV; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = RD; g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      }
    };
    const mid = 45;
    scroll(W, (t, o) => [X0 + t, Y0 + mid + o]); scroll(W, (t, o) => [X0 + t, Y0 + Hh - mid - o]);
    scroll(Hh, (t, o) => [X0 + mid + o, Y0 + t]); scroll(Hh, (t, o) => [X0 + W - mid - o, Y0 + t]);
    g.restore();
    rect(76, NV); rect(80, GD); rect(83, IV);
    // the field: ivory with an all-over lattice of fine vines and leaves, mirrored
    const fx0 = X0 + 83, fy0 = Y0 + 83, fw = W - 166, fh = Hh - 166, cx = N / 2, cy = N / 2;
    g.save(); g.beginPath(); g.rect(fx0, fy0, fw, fh); g.clip();
    specks(30000, 2, ['#e2d8c2', '#efe8d6', '#ddd2ba'], 0.6);
    g.strokeStyle = 'rgba(110,120,140,0.55)'; g.lineWidth = 1.6;
    for (let k = -8; k <= 8; k++) for (const s of [1, -1]) {
      g.beginPath();
      for (let t = -N; t <= N; t += 6) { const x = cx + t, y = cy + s * t + k * 70 + Math.sin(t / 22) * 9; if (t > -N) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 260; i++) {
      const x = fx0 + r() * fw / 2, y = fy0 + r() * fh / 2, a = r() * 6.28, col = [RD, NV, GD, '#5a6a50'][i % 4];
      for (const [mx, my] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const px = cx + (x - cx) * mx, py = cy + (y - cy) * my;
        g.fillStyle = col; g.globalAlpha = 0.75;
        g.beginPath(); g.ellipse(px, py, 7, 3, a * mx * my, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
    // corner spandrels: navy quarter-medallions with a gold edge
    for (const [x, y] of [[fx0, fy0], [fx0 + fw, fy0], [fx0, fy0 + fh], [fx0 + fw, fy0 + fh]]) {
      g.fillStyle = GD; g.beginPath(); g.ellipse(x, y, 150, 110, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = NV; g.beginPath(); g.ellipse(x, y, 142, 102, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = SK; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, 110, 78, 0, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    // the medallion: a lobed navy star in gold, an ivory ring, a red heart with a gold star
    const lobed = (rx, ry, lobes, depth, col) => {
      g.fillStyle = col; g.beginPath();
      for (let i = 0; i <= 360; i++) { const a = i / 360 * Math.PI * 2, k = 1 - depth * (0.5 - 0.5 * Math.cos(a * lobes)); const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.fill();
    };
    lobed(270, 200, 16, 0.12, GD); lobed(262, 192, 16, 0.12, NV); lobed(200, 146, 8, 0.1, SK); lobed(192, 138, 8, 0.1, IV);
    lobed(140, 100, 12, 0.14, GD); lobed(134, 94, 12, 0.14, RD);
    g.strokeStyle = 'rgba(184,145,63,0.8)'; g.lineWidth = 2;
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 22); g.lineTo(cx + Math.cos(a) * 120, cy + Math.sin(a) * 84); g.stroke(); }
    g.fillStyle = GD; g.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = i % 2 ? 22 : 52; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.75; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.closePath(); g.fill();
    g.fillStyle = NV; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
    // the pile: a faint sheen across it, and wear in the knots
    const sh = g.createLinearGradient(0, 0, N, N);
    sh.addColorStop(0, 'rgba(255,250,235,0.08)'); sh.addColorStop(0.5, 'rgba(0,0,0,0.06)'); sh.addColorStop(1, 'rgba(255,250,235,0.06)');
    g.fillStyle = sh; g.fillRect(fr, fr, N - 2 * fr, N - 2 * fr);
    g.globalAlpha = 0.12;
    for (let i = 0; i < 60000; i++) { g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.fillRect(fr + r() * (N - 2 * fr), fr + r() * (N - 2 * fr), 1, 1); }
    g.globalAlpha = 1;
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
