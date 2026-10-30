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
  const w = spec.w || 24, d = spec.d || 19, h = spec.h || 8.5, floor = spec.floor || 0;
  const yaw = (spec.face || 0) * DEG, f = [Math.sin(yaw), 0, Math.cos(yaw)], r = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const at = [spec.at[0], floor, spec.at[1]];
  const world = (u, v, y) => [at[0] + r[0] * u - f[0] * v, floor + y, at[2] + r[2] * u - f[2] * v];
  const local = (p) => { const q = [p[0] - at[0], p[2] - at[2]]; return [q[0] * r[0] + q[1] * r[2], -(q[0] * f[0] + q[1] * f[2]), p[1] - floor]; };
  const hu = w / 2;
  // the step under the back row, which raises whoever stands on it
  const step = { u: [-hu + 2, hu - 2], v: [5.6, 9.6], y: 0.7 };
  const chairs = [];
  for (const [row, v, y] of [[0, 3.4, 0], [1, 7.4, step.y]]) for (const u of [-6, -2, 2, 6]) chairs.push({ u, v, y, row });
  const sofa = { u: [3.1, 5.9], v: [10.4, 17.6] };
  const tv = { u: hu - 0.15, v: 14, y: 5.1, w: 8.4, h: 4.7 };
  // [u0, u1, v0, v1]: what a walker can't stand in
  const solid = [
    ...chairs.map((c) => [c.u - 1.15, c.u + 1.15, c.v - 1.1, c.v + 1.4]),
    [sofa.u[0], sofa.u[1], sofa.v[0], sofa.v[1]],
    [7.4, 9.6, 12, 16],
    [-hu, -3, d - 2.4, d],
    [-hu, -hu + 2.4, 10, 15.6],
  ];
  const yawTo = (dir) => Math.atan2(dir[0], dir[2]);
  const seats = [
    ...chairs.map((c, i) => ({ kind: 'chair', i, u: c.u, v: c.v + 0.25, y: c.y + 3.85, yaw: yawTo(f), pitch: -0.12 })),
    ...[11.8, 14, 16.2].map((v, i) => ({ kind: 'sofa', i, u: 4.9, v, y: 3.6, yaw: yawTo(r), pitch: 0 })),
  ];
  for (const s of seats) s.eye = world(s.u, s.v, s.y);
  return { spec, w, d, h, floor, f, r, at, yaw, world, local, step, chairs, sofa, tv, solid, seats,
    bounds: [-hu + 0.9, hu - 0.9, 0.9, d - 0.9], radius: 0.9,
    groundAt: (u, v) => (u >= step.u[0] && u <= step.u[1] && v >= step.v[0] && v <= step.v[1] ? step.y : 0) };
}

// A walker's next spot: the move tried whole, then each axis on its own, so you slide along what you
// meet. `p` and the answer are [u, v].
export function boothStep(L, p, du, dv) {
  const ok = (u, v) => u >= L.bounds[0] && u <= L.bounds[1] && v >= L.bounds[2] && v <= L.bounds[3]
    && !L.solid.some(([a, b, c, e]) => u > a - L.radius && u < b + L.radius && v > c - L.radius && v < e + L.radius);
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
  screen: '#111318', fridge: '#bfe4f0', lamp: '#fff2d6', heat: '#ffb060',
});
// how much of a face's light it gets, by the way it faces
const SHADE = { up: 0.92, down: 0.55, side: 0.74, back: 0.66 };

// The surfaces with a material of their own (paintBoothTexture), each its own batch so its texture
// can repeat, and how many feet one repeat covers.
export const BOOTH_TEXTURES = Object.freeze({ boothCarpet: 3, boothLeather: 1.2, boothWood: 3.5, boothMarble: 2.5, boothWall: 4 });

// { solid, screen, glass, textured }: batches in the field's feet; 'textured' maps a
// BOOTH_TEXTURES key to its batch, whose colours are the light alone (the texture is the colour).
export function buildBooth(L) {
  const solid = createBatch(8192), screen = createBatch(16), glass = createBatch(64), textured = new Map();
  const TB = (k) => { let b = textured.get(k); if (!b) { b = createBatch(2048); textured.set(k, b); } return b; };
  const E = MAT.EMISSIVE, UV = [0, 0];
  const C = (hex, k = 1) => lin(hex).map((c) => c * k);
  const nrmOf = (du, dy, dv) => { const x = L.r[0] * du - L.f[0] * dv, z = L.r[2] * du - L.f[2] * dv; return [x, dy, z]; };
  const quad = (b, ps, n, col, mat = E, uvs = null) => {
    const q = ps.map(([u, v, y]) => L.world(u, v, y)), U = uvs || [UV, UV, UV, UV];
    vtx(b, q[0], n, U[0], col, mat); vtx(b, q[1], n, U[1], col, mat); vtx(b, q[2], n, U[2], col, mat);
    vtx(b, q[0], n, U[0], col, mat); vtx(b, q[2], n, U[2], col, mat); vtx(b, q[3], n, U[3], col, mat);
  };
  // a box from its corners in the room's frame, each face shaded by the way it faces
  // 'tex' puts it on a material (BOOTH_TEXTURES), mapped flat onto each face by the room's feet;
  // the texture is then the colour, and 'hex' is unused
  const box = (u0, u1, v0, v1, y0, y1, hex, k = 1, tex = null) => {
    const b = tex ? TB(tex) : solid, t = tex ? BOOTH_TEXTURES[tex] : 1;
    const c = (s) => C(tex ? '#ffffff' : hex, k * s);
    const face = (ps, n, col, i, j) => quad(b, ps, n, col, E, tex ? ps.map((q) => [q[i] / t, q[j] / t]) : null);
    face([[u0, v0, y1], [u1, v0, y1], [u1, v1, y1], [u0, v1, y1]], [0, 1, 0], c(SHADE.up), 0, 1);
    face([[u0, v0, y0], [u0, v1, y0], [u1, v1, y0], [u1, v0, y0]], [0, -1, 0], c(SHADE.down), 0, 1);
    face([[u0, v0, y0], [u1, v0, y0], [u1, v0, y1], [u0, v0, y1]], nrmOf(0, 0, -1), c(SHADE.side), 0, 2);
    face([[u1, v1, y0], [u0, v1, y0], [u0, v1, y1], [u1, v1, y1]], nrmOf(0, 0, 1), c(SHADE.back), 0, 2);
    face([[u0, v1, y0], [u0, v0, y0], [u0, v0, y1], [u0, v1, y1]], nrmOf(-1, 0, 0), c(SHADE.side * 0.92), 1, 2);
    face([[u1, v0, y0], [u1, v1, y0], [u1, v1, y1], [u1, v0, y1]], nrmOf(1, 0, 0), c(SHADE.side * 0.92), 1, 2);
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
  // the glass's frame: a low sill, the header, a mullion every six feet
  box(-hu, hu, -0.2, 0.3, 0, 0.9, LOOK.frame);
  box(-hu, hu, -0.2, 0.3, H - 0.5, H, LOOK.frame);
  for (let u = -hu; u <= hu + 1e-6; u += 6) box(u - 0.12, u + 0.12, -0.2, 0.15, 0.9, H - 0.5, LOOK.frame);
  quad(glass, [[-hu, 0, 0.9], [hu, 0, 0.9], [hu, 0, H - 0.5], [-hu, 0, H - 0.5]], nrmOf(0, 0, -1), C('#cfe3ea', 0.8));
  // the lamps in the ceiling, bright enough to bloom
  for (const [u, v] of [[-6, 4.5], [6, 4.5], [-6, 13], [6, 13]]) {
    quad(solid, [[u - 1.6, v + 1.6, H - 0.03], [u + 1.6, v + 1.6, H - 0.03], [u + 1.6, v - 1.6, H - 0.03], [u - 1.6, v - 1.6, H - 0.03]], [0, -1, 0], C(LOOK.lamp, 1.6));
  }
  // the step and the chairs on it and in front of it
  const st = L.step;
  box(st.u[0], st.u[1], st.v[0], st.v[1], 0, st.y, LOOK.carpet, 1.15, 'boothCarpet');
  for (const c of L.chairs) {
    const y = c.y;
    box(c.u - 1.05, c.u + 1.05, c.v - 1.0, c.v + 1.0, y, y + 1.55, LOOK.leather, 0.9, 'boothLeather');
    box(c.u - 1.05, c.u + 1.05, c.v + 0.8, c.v + 1.3, y + 1.55, y + 3.4, LOOK.leather, 0.85, 'boothLeather');
    for (const s of [-1, 1]) box(c.u + s * 1.05 - (s > 0 ? 0.3 : 0), c.u + s * 1.05 + (s < 0 ? 0.3 : 0), c.v - 0.9, c.v + 1.0, y + 1.55, y + 2.3, LOOK.leather, 0.8, 'boothLeather');
    box(c.u + 0.75, c.u + 1.0, c.v - 0.8, c.v - 0.5, y + 2.3, y + 2.42, LOOK.silver);   // the cup holder
    box(c.u - 0.2, c.u + 0.2, c.v + 1.31, c.v + 1.34, y + 2.8, y + 3.1, '#c8a446', 1.1);  // the brass number
  }
  // the sofa facing the big screen, and the low table between them
  const so = L.sofa;
  box(so.u[0], so.u[1], so.v[0], so.v[1], 0, 1.45, LOOK.leather, 0.88, 'boothLeather');
  box(so.u[0], so.u[0] + 0.7, so.v[0], so.v[1], 1.45, 3.0, LOOK.leather, 0.82, 'boothLeather');
  for (const v of [so.v[0], so.v[1] - 0.6]) box(so.u[0], so.u[1], v, v + 0.6, 1.45, 2.2, LOOK.leather, 0.8, 'boothLeather');
  box(7.4, 9.6, 12, 16, 1.2, 1.4, LOOK.wood, 0.9, 'boothWood');
  for (const [u, v] of [[7.6, 12.2], [9.4, 12.2], [7.6, 15.8], [9.4, 15.8]]) box(u - 0.1, u + 0.1, v - 0.1, v + 0.1, 0, 1.2, LOOK.frame);
  // the big screen on the right-hand wall: its bezel, and the picture on its own batch
  const tv = L.tv, tu = tv.u;
  box(tu - 0.25, tu, tv.v - tv.w / 2 - 0.25, tv.v + tv.w / 2 + 0.25, tv.y - tv.h / 2 - 0.25, tv.y + tv.h / 2 + 0.25, LOOK.frame, 0.7);
  {
    const v0 = tv.v - tv.w / 2, v1 = tv.v + tv.w / 2, y0 = tv.y - tv.h / 2, y1 = tv.y + tv.h / 2, u = tu - 0.27;
    // facing the wall (+u), your right is +v, so the picture runs from the glass end to the back
    quad(screen, [[u, v0, y0], [u, v1, y0], [u, v1, y1], [u, v0, y1]], nrmOf(-1, 0, 0), [1, 1, 1], E, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // the bar along the back wall, its bottles, and the fridge lit behind glass
  box(-hu, -3, D - 2.4, D, 0, 3.4, LOOK.wood, 0.8, 'boothWood');
  box(-hu, -2.8, D - 2.6, D, 3.4, 3.6, LOOK.marble, 1, 'boothMarble');
  const bottles = ['#2f6b3a', '#8a5a20', '#d8b84a', '#5a1f2a', '#e6e6e6', '#2a4a7a'];
  for (let i = 0; i < 9; i++) { const u = -10.6 + i * 0.85; box(u - 0.14, u + 0.14, D - 0.9, D - 0.62, 3.6, 4.5 + (i % 3) * 0.2, bottles[i % bottles.length], 0.9); }
  box(-hu, -hu + 2.4, D - 2.4, D, 0, 6.6, LOOK.frame, 0.8);
  quad(solid, [[-hu + 0.2, D - 2.42, 0.4], [-hu + 2.2, D - 2.42, 0.4], [-hu + 2.2, D - 2.42, 6.2], [-hu + 0.2, D - 2.42, 6.2]], nrmOf(0, 0, -1), C(LOOK.fridge, 0.95));
  // the buffet on the left-hand wall: its cloth, its trays and the heat lamps over them
  box(-hu, -hu + 2.4, 10, 15.6, 0, 3.0, LOOK.cloth, 0.9);
  for (const v of [11, 12.6, 14.2]) {
    box(-hu + 0.4, -hu + 2.0, v - 0.6, v + 0.6, 3.0, 3.3, LOOK.silver, 1.0);
    quad(solid, [[-hu + 0.5, v + 0.5, 6.2], [-hu + 1.9, v + 0.5, 6.2], [-hu + 1.9, v - 0.5, 6.2], [-hu + 0.5, v - 0.5, 6.2]], [0, -1, 0], C(LOOK.heat, 1.4));
    box(-hu + 1.15, -hu + 1.25, v - 0.05, v + 0.05, 6.2, H, LOOK.frame);
  }
  // the door at the back, shut
  box(5, 8.6, D - 0.05, D, 0, 7, LOOK.wood, 0.75, 'boothWood');
  return { solid, screen, glass, textured };
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
    // cream hide buttoned in diamonds, the pleats running out from each button
    g.fillStyle = '#ece5d6'; g.fillRect(0, 0, N, N);
    specks(9000, 3, ['#e4dccb', '#f4eee2', '#ddd4c2'], 0.5);
    const S = N / 2;
    for (let y = -1; y <= 3; y++) for (let x = -1; x <= 3; x++) {
      const cx = x * S + (y & 1 ? S / 2 : 0), cy = y * S / 2;
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
  } else {
    // a linen wall covering: a fine weave, and a panel seam each repeat
    g.fillStyle = '#e8e1d2'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < N; i += 3) {
      g.fillStyle = `rgba(150,140,120,${0.05 + r() * 0.07})`; g.fillRect(i, 0, 1, N);
      g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`; g.fillRect(0, i, N, 1);
    }
    specks(5000, 2, ['#d8cfbe', '#f2ece0'], 0.4);
    g.fillStyle = 'rgba(120,108,90,0.45)'; g.fillRect(0, 0, 3, N);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(3, 0, 2, N);
  }
  return c;
}
