// ── THE MEDIA LOT'S GROUND: THE GATE COURT AND THE CAR PARK ──────────────────────────────────────
//
// KSAB's block between Marrow Street, Meltwater Row and Foundry Way is walled like a studio lot
// (docs/proposals/media-lot.md). Its four buildings are drawn by their own models; this draws the
// two tiles of open ground inside the wall, which are the `lot` mark (plugins/flight/state.js):
//
//   court    913,911  the gate on Foundry Way (two rendered piers, a slab carrying the station's
//                    name, a raised barrier arm, a round gatehouse), lamp standards, painted walks
//                    to the stage door and the Writers' Wing, a directory board and a lot cart
//   parking  914,911  the wall along Foundry Way and against the music shop, painted bays, two KSAB
//                    news vans, a satellite van, the Sentinel's van at the paper's dock, and the
//                    water tower with the station's disc on its tank
//
// The lot's hand is the Deadline's: cream render over a darker plinth, a coping, and the station's
// cyan as a band along the foot of every wall and three speed lines round each gate pier.
//
// ⚠ NO IMPORTS, BY DESIGN, as glass/aa-emplacement.js has none. The renderer hands this a face sink,
// a light sink and a lettering sink (drawLotMark in windshield.js), so the same geometry goes to the
// depth buffer on GLASS 2 and to a sorted canvas on GLASS 1, and markRenderSmoke can run it on a
// stub. It shades its own faces, because a solid on BAY_SINK arrives pre-lit.
//
// ⚠ THE WALL A TRUCK HITS IS THIS FILE'S WALL. `lotSolidAt` answers from the same constants the
// drawing uses, and groundObstructionAt asks it through lotWallZAt. Move a pier here and the
// collision moves with it.
//
// Scale: 17.857 m to a tile (client/shared/birds.js), a storey 0.196. `M(m)` is metres to tiles.
// Frame: x east, y SOUTH, z up, in tiles, camera-relative (the frame cam.proj takes).

const M = (m) => m / 17.857;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

// ── THE LOT, IN CONSTANTS ──
// The wall stands just inside its own tile, so a neighbour's mass and this never share a plane.
export const LOT = Object.freeze({
  WALL_C: 0.478,          // the wall's centre line, out from the tile centre
  WALL_T: M(0.55),        // thickness
  WALL_H: M(3.6),         // about a storey
  PLINTH_H: M(0.55),      // the darker base course
  COPE_H: M(0.22), COPE_O: M(0.12),
  BAND_Z0: M(0.62), BAND_Z1: M(0.86),   // the cyan band, just over the plinth
  GATE_HALF: M(4.3),      // half the opening, pier face to pier face
  PIER_R: M(0.8), PIER_H: M(5.4),
  SLAB_Z0: M(4.55), SLAB_Z1: M(5.0), SLAB_D: M(1.6),
  BOARD_Z0: M(5.0), BOARD_Z1: M(6.15), BOARD_HW: M(3.1),
  BOOTH_U: 0.165, BOOTH_V: 0.335, BOOTH_R: M(1.3), BOOTH_H: M(2.9),
  TOWER_X: 0.315, TOWER_Y: 0.29, TOWER_LEG: M(1.9), TOWER_TANK_Z: M(8.2), TOWER_TOP_Z: M(11.6), TOWER_R: M(2.5),
  VAN_L: M(5.6), VAN_W: M(2.15), VAN_H: M(2.6),
});
const PIER_U = LOT.GATE_HALF + LOT.PIER_R;            // a pier's centre, along the wall from the gate's middle
const PIER_OUT = PIER_U + LOT.PIER_R;                  // where the wall either side of the gate starts
const OUT = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

// What stands on the car park: each van is [x, y, along-y?, facing sign, kind]. `along` vans lie
// north-south; the sign says which end the cab is at. Shared with lotSolidAt.
const VANS = [
  [-0.37, 0.30, true, -1, 'ksab'],      // south rank, backed in, nose to the aisle
  [-0.03, 0.30, true, -1, 'ksab'],
  [0.335, -0.24, true, 1, 'dish'],      // along the east wall
  [0.05, -0.245, true, 1, 'paper'],     // backed up to the paper's dock, cab to the aisle
];
// The backlot's flats along each wall, [u0, u1, paint], and its crates, [x, y, height].
const FLATS = [[-0.42, -0.25, 0], [-0.23, -0.04, 1], [-0.02, 0.16, 2], [0.18, 0.34, 3]];
const CRATES = [[0.18, 0.40, M(1.5)], [0.27, 0.40, M(0.75)], [0.18, 0.31, M(0.75)], [0.40, 0.12, M(1.5)]];
const DOCK = { x0: -0.08, x1: 0.18, y0: -0.5, y1: -0.405, z: M(1.2) };

// ── SHADING ──
// The AA batteries' shading, so the two kinds of mark sit in one light: diffuse off the sun, a
// hemisphere sky term, a cooler read after dark, a tight highlight on metal and glass. `lit` is
// its own colour at every hour.
function makeShade(o) {
  const sun = o.sun, night = clamp(o.night || 0, 0, 1), wet = clamp(o.wet || 0, 0, 1);
  const se = sun ? clamp(sun.elev, 0, 1) : 0.6, fl = Math.sqrt(Math.max(0, 1 - se * se));
  const L = sun && sun.dir ? [sun.dir[0] * fl, sun.dir[1] * fl, se] : [0.35, -0.5, 0.79];
  const day = 1 - night, sunUp = sun ? clamp(se * 4, 0, 1) * day : day;
  return (base, n, v, mat) => {
    if (mat === 'lit') return base;
    const nl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
    const sky = 0.5 + 0.5 * n[2];
    let k = (0.34 + 0.20 * sky) * (0.50 + 0.50 * day) + 0.62 * nl * sunUp;
    if (mat !== 'metal' && mat !== 'glass') k *= 1 - 0.22 * wet;
    let spec = 0;
    if (mat === 'metal' || mat === 'glass') {
      const hx = L[0] + v[0], hy = L[1] + v[1], hz = L[2] + v[2], hl = Math.hypot(hx, hy, hz) || 1;
      const nh = Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl);
      spec = Math.pow(nh, mat === 'glass' ? 40 : 18) * (mat === 'glass' ? 0.9 : 0.42 + 0.4 * wet) * sunUp * 255;
    }
    const nb = night * 0.32;
    return [
      clamp(base[0] * k * (1 - nb) + 30 * nb + spec, 0, 255),
      clamp(base[1] * k * (1 - nb) + 38 * nb + spec, 0, 255),
      clamp(base[2] * k * (1 - nb) + 58 * nb + spec, 0, 255),
    ];
  };
}

const PAL = {
  render: [206, 196, 172], plinth: [150, 142, 124], coping: [224, 216, 196],
  cyan: [57, 214, 255], cyanLit: [132, 238, 255],
  board: [22, 32, 42], steel: [118, 124, 130], steelDk: [74, 78, 84],
  glass: [64, 88, 102], glassLit: [255, 214, 150],
  tank: [178, 186, 192], cone: [148, 156, 164], disc: [57, 214, 255], discLit: [120, 232, 255], seven: [244, 248, 250],
  van: [226, 230, 232], vanDk: [196, 200, 204], tyre: [30, 30, 32], vanGlass: [40, 52, 62],
  paper: [58, 66, 86], paperBand: [222, 210, 178],
  concrete: [152, 150, 142], bay: [232, 218, 152], walk: [218, 212, 196],
  red: [196, 40, 36], white: [236, 232, 224], lamp: [255, 226, 170],
  cart: [214, 216, 210], cartRoof: [57, 214, 255],
  flats: [[168, 92, 74], [92, 120, 104], [196, 172, 120], [88, 104, 140], [150, 132, 160]],
  timber: [140, 112, 78], timberTop: [166, 138, 100],
};

// ── THE BUILD ────────────────────────────────────────────────────────────────
//
// `o` is everything the renderer knows about this tile and this frame:
//   dx, dy        tile centre, camera-relative
//   part          'c' the court, 'p' the car park
//   wall, gate    sides as letters of nesw (state.js keeps only those the movement graph allows)
//   eye           [x, y, z] in the same frame, which way a face's normal is turned
//   near          true within arm's length: the small things are drawn
//   seed, now, night, alpha, wet, sun
//   face(pts, rgb, a)             one convex polygon, points in the same frame, already shaded
//   light(x, y, z, rgb, s, a)     a glow
//   text(quad, label, css, lit)   lettering on a quad wound TL, TR, BR, BL as it is read
export function drawMediaLot(o) {
  const night = clamp(o.night || 0, 0, 1);
  const shade = makeShade(o);
  const alpha = o.alpha == null ? 1 : o.alpha;
  const E = o.eye || [0, 0, 0.2];
  const dx = o.dx, dy = o.dy;
  const lit = night > 0.3;

  const face = (pts, base, mat) => {
    if (pts.length < 3) return;
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    const nl = Math.hypot(nx, ny, nz); if (!(nl > 1e-12)) return;
    nx /= nl; ny /= nl; nz /= nl; cx /= pts.length; cy /= pts.length; cz /= pts.length;
    // On the GPU (`o.gpu`, RENDER_TUNE.marksGPU) the shader turns the normal and shades: the base,
    // the normal as wound and the material go over. A lamp's own colour goes over as it is.
    if (o.gpu) { if (mat === 'lit') o.face(pts, base, alpha); else o.face(pts, base, alpha, [nx, ny, nz], mat || 'paint'); return; }
    let vx = E[0] - cx, vy = E[1] - cy, vz = E[2] - cz;
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    // Closed solids: a back face is hidden by its own front one, so turning the normal toward the
    // eye only decides how it is lit.
    if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    o.face(pts, shade(base, [nx, ny, nz], [vx, vy, vz], mat || 'paint'), alpha);
  };
  const flat = (pts, rgb, a) => o.face(pts, rgb, alpha * a);   // paint on the ground: its own colour

  // A frame turned to a side: `u` along the side (east for the south side), `v` out from the
  // tile centre through it. Every frame is a quarter turn, so a box stays a box.
  const frame = (side) => {
    const out = OUT[side] || OUT.s, al = [out[1], -out[0]];
    return (u, v, z) => [dx + al[0] * u + out[0] * v, dy + al[1] * u + out[1] * v, z];
  };
  const T = (x, y, z) => [dx + x, dy + y, z];
  // A box in a frame: centre (u, v), half-extents (hu, hv), z0 to z1. Five faces: nothing here is
  // seen from underneath.
  const box = (F, u, v, hu, hv, z0, z1, base, mat, top = base) => {
    const A = F(u - hu, v - hv, z0), B = F(u + hu, v - hv, z0), C = F(u + hu, v + hv, z0), D = F(u - hu, v + hv, z0);
    const A1 = F(u - hu, v - hv, z1), B1 = F(u + hu, v - hv, z1), C1 = F(u + hu, v + hv, z1), D1 = F(u - hu, v + hv, z1);
    face([A1, B1, C1, D1], top, mat);
    face([A, B, B1, A1], base, mat); face([B, C, C1, B1], base, mat);
    face([C, D, D1, C1], base, mat); face([D, A, A1, D1], base, mat);
  };
  // An upright drum: n sides, z0 to z1, with a lid.
  const drum = (x, y, r, z0, z1, n, base, mat, lid = base) => {
    const ring = (z) => { const out = []; for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * TAU; out.push(T(x + Math.cos(a) * r, y + Math.sin(a) * r, z)); } return out; };
    const b = ring(z0), t = ring(z1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; face([b[i], b[j], t[j], t[i]], base, mat); }
    face(t, lid, mat);
  };
  // A square strut between two points: a leg, a brace, a pole.
  const strut = (a, b, r, base, mat) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
    if (!(L > 1e-6)) return;
    const u = [d[0] / L, d[1] / L, d[2] / L];
    const s1l = Math.hypot(-u[1], u[0]);
    const s1 = s1l > 1e-6 ? [-u[1] / s1l * r, u[0] / s1l * r, 0] : [r, 0, 0];
    const s2 = [u[1] * s1[2] - u[2] * s1[1], u[2] * s1[0] - u[0] * s1[2], u[0] * s1[1] - u[1] * s1[0]];
    const at = (p, i, j) => [p[0] + s1[0] * i + s2[0] * j, p[1] + s1[1] * i + s2[1] * j, p[2] + s1[2] * i + s2[2] * j];
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [i0, j0] = q[k], [i1, j1] = q[(k + 1) % 4];
      face([at(a, i0, j0), at(a, i1, j1), at(b, i1, j1), at(b, i0, j0)], base, mat);
    }
  };
  const lamp = (x, y) => {
    const top = M(5.6);
    strut(T(x, y, 0), T(x, y, top), M(0.09), PAL.steelDk, 'metal');
    box((u, v, z) => T(x + u, y + v, z), 0, 0, M(0.28), M(0.28), top, top + M(0.35), lit ? PAL.lamp : PAL.steel, lit ? 'lit' : 'metal');
    if (lit) { o.light(dx + x, dy + y, top, '255,226,170', 9, 0.55); o.light(dx + x, dy + y, 0.004, '255,214,150', 22, 0.30); }
  };

  // ── THE WALL ──
  // From `a` to `b` along a side (u in that side's frame), plinth, render, coping, and the band on
  // both faces. The band is paint by day and a lit strip after dark.
  const wallRun = (F, a, b) => {
    const hu = (b - a) / 2, u = (a + b) / 2, hv = LOT.WALL_T / 2, v = LOT.WALL_C;
    box(F, u, v, hu, hv + M(0.05), 0, LOT.PLINTH_H, PAL.plinth, 'paint');
    box(F, u, v, hu, hv, LOT.PLINTH_H, LOT.WALL_H, PAL.render, 'paint');
    box(F, u, v, hu + 0.002, hv + LOT.COPE_O, LOT.WALL_H, LOT.WALL_H + LOT.COPE_H, PAL.coping, 'paint');
    const bandC = lit ? PAL.cyanLit : PAL.cyan, bandM = lit ? 'lit' : 'paint';
    for (const s of [-1, 1]) {
      const vv = v + s * (hv + 0.0015);
      face([F(a, vv, LOT.BAND_Z0), F(b, vv, LOT.BAND_Z0), F(b, vv, LOT.BAND_Z1), F(a, vv, LOT.BAND_Z1)], bandC, bandM);
    }
    if (lit) {
      const n = Math.max(1, Math.round((b - a) / 0.34));
      for (let i = 0; i < n; i++) {
        const p = F(a + (b - a) * (i + 0.5) / n, v + hv + 0.02, LOT.BAND_Z1);
        o.light(p[0], p[1], p[2], '90,220,255', 6, 0.35);
      }
    }
  };
  for (const s of String(o.wall || '')) if (OUT[s]) wallRun(frame(s), -0.5, 0.5);

  // ── THE GATE ──
  if (o.gate && OUT[o.gate]) {
    const G = frame(o.gate), v = LOT.WALL_C;
    wallRun(G, -0.5, -PIER_OUT);
    wallRun(G, PIER_OUT, 0.5);
    for (const su of [-1, 1]) {
      const p = G(su * PIER_U, v, 0);
      drum(p[0] - dx, p[1] - dy, LOT.PIER_R + M(0.08), 0, LOT.PLINTH_H, 10, PAL.plinth, 'paint');
      drum(p[0] - dx, p[1] - dy, LOT.PIER_R, LOT.PLINTH_H, LOT.PIER_H, 10, PAL.render, 'paint', PAL.coping);
      // Three speed lines round the pier, in the band's colour.
      for (let k = 0; k < 3; k++) {
        const z = M(3.0) + k * M(0.42);
        drum(p[0] - dx, p[1] - dy, LOT.PIER_R + 0.0015, z, z + M(0.12), 10, lit ? PAL.cyanLit : PAL.cyan, lit ? 'lit' : 'paint');
      }
      if (lit) o.light(p[0], p[1], LOT.PIER_H + M(0.4), '255,226,170', 7, 0.5);
    }
    // The slab across the piers, and the station's name on a board on top of it, facing the street.
    box(G, 0, v, PIER_OUT, LOT.SLAB_D / 2, LOT.SLAB_Z0, LOT.SLAB_Z1, PAL.render, 'paint', PAL.coping);
    box(G, 0, v + LOT.SLAB_D / 2 - M(0.25), LOT.BOARD_HW, M(0.18), LOT.BOARD_Z0, LOT.BOARD_Z1, PAL.board, 'paint');
    {
      const vf = v + LOT.SLAB_D / 2 - M(0.25) + M(0.18) + 0.0015, inset = M(0.18);
      const rim = lit ? PAL.cyanLit : PAL.cyan, rm = lit ? 'lit' : 'paint';
      face([G(-LOT.BOARD_HW, vf, LOT.BOARD_Z1 - inset * 0.6), G(LOT.BOARD_HW, vf, LOT.BOARD_Z1 - inset * 0.6), G(LOT.BOARD_HW, vf, LOT.BOARD_Z1), G(-LOT.BOARD_HW, vf, LOT.BOARD_Z1)], rim, rm);
      face([G(-LOT.BOARD_HW, vf, LOT.BOARD_Z0), G(LOT.BOARD_HW, vf, LOT.BOARD_Z0), G(LOT.BOARD_HW, vf, LOT.BOARD_Z0 + inset * 0.6), G(-LOT.BOARD_HW, vf, LOT.BOARD_Z0 + inset * 0.6)], rim, rm);
      if (o.text) {
        const z0 = LOT.BOARD_Z0 + inset, z1 = LOT.BOARD_Z1 - inset, hw = LOT.BOARD_HW * 0.82;
        o.text([G(-hw, vf + 0.0008, z1), G(hw, vf + 0.0008, z1), G(hw, vf + 0.0008, z0), G(-hw, vf + 0.0008, z0)],
          'KSAB', lit ? '#78ecff' : '#39d6ff', lit);
      }
      if (lit) { const c = G(0, vf + M(1.2), LOT.BOARD_Z0); o.light(c[0], c[1], c[2], '90,220,255', 14, 0.45); }
    }
    // The gatehouse: a round booth glazed all round under a flat lid, on the court side of the gate.
    {
      const p = G(LOT.BOOTH_U, LOT.BOOTH_V, 0), bx = p[0] - dx, by = p[1] - dy;
      drum(bx, by, LOT.BOOTH_R, 0, M(1.05), 12, PAL.render, 'paint');
      drum(bx, by, LOT.BOOTH_R * 0.97, M(1.05), M(2.35), 12, lit ? PAL.glassLit : PAL.glass, lit ? 'lit' : 'glass');
      drum(bx, by, LOT.BOOTH_R, M(2.35), LOT.BOOTH_H, 12, PAL.render, 'paint');
      drum(bx, by, LOT.BOOTH_R + M(0.35), LOT.BOOTH_H, LOT.BOOTH_H + M(0.25), 12, PAL.coping, 'paint');
      drum(bx, by, LOT.BOOTH_R + M(0.36), LOT.BOOTH_H + M(0.02), LOT.BOOTH_H + M(0.12), 12, lit ? PAL.cyanLit : PAL.cyan, lit ? 'lit' : 'paint');
      if (lit) { o.light(p[0], p[1], M(1.7), '255,214,150', 8, 0.6); o.light(p[0], p[1], 0.004, '255,214,150', 16, 0.3); }
      // The barrier: a post beside the booth and the arm raised, red and white.
      const post = G(LOT.BOOTH_U - LOT.BOOTH_R - M(0.55), v - M(0.8), 0);
      box((u, vv, z) => [post[0] + u, post[1] + vv, z], 0, 0, M(0.22), M(0.22), 0, M(1.1), PAL.steel, 'metal');
      const pivot = [post[0], post[1], M(1.0)];
      const tipU = G(LOT.BOOTH_U - LOT.BOOTH_R - M(0.55) - M(1.0), v - M(0.8), 0);
      const tip = [tipU[0], tipU[1], M(1.0) + M(5.2)];
      for (let k = 0; k < 4; k++) {
        const t0 = k / 4, t1 = (k + 1) / 4;
        const a = [pivot[0] + (tip[0] - pivot[0]) * t0, pivot[1] + (tip[1] - pivot[1]) * t0, pivot[2] + (tip[2] - pivot[2]) * t0];
        const b = [pivot[0] + (tip[0] - pivot[0]) * t1, pivot[1] + (tip[1] - pivot[1]) * t1, pivot[2] + (tip[2] - pivot[2]) * t1];
        strut(a, b, M(0.07), k % 2 ? PAL.white : PAL.red, 'paint');
      }
    }
  }

  // ── THE COURT ──
  if (o.part === 'c') {
    // Walks painted on the concrete: in from the gate, west to the stage door, north to the writers.
    const z = 0.0016, w = M(0.8);
    flat([T(-w, 0.47, z), T(w, 0.47, z), T(w, -0.47, z), T(-w, -0.47, z)], PAL.walk, 0.30);
    flat([T(-0.47, -w + 0.06, z + 0.0004), T(-w, -w + 0.06, z + 0.0004), T(-w, w + 0.06, z + 0.0004), T(-0.47, w + 0.06, z + 0.0004)], PAL.walk, 0.30);
    for (const s of [-1, 1]) {
      flat([T(s * w - 0.004, 0.47, z + 0.0006), T(s * w + 0.004, 0.47, z + 0.0006), T(s * w + 0.004, -0.47, z + 0.0006), T(s * w - 0.004, -0.47, z + 0.0006)], PAL.bay, 0.55);
    }
    lamp(-0.40, 0.36);
    lamp(0.40, 0.36);
    lamp(-0.40, -0.36);
    if (o.near) {
      // The directory board, facing whoever comes in at the gate.
      for (const s of [-1, 1]) strut(T(-0.22 + s * M(0.85), 0.20, 0), T(-0.22 + s * M(0.85), 0.20, M(2.0)), M(0.06), PAL.steelDk, 'metal');
      box((u, v, zz) => T(-0.22 + u, 0.20 + v, zz), 0, 0, M(1.0), M(0.08), M(0.9), M(2.1), PAL.board, 'paint');
      face([T(-0.22 - M(1.0), 0.20 + M(0.081), M(1.92)), T(-0.22 + M(1.0), 0.20 + M(0.081), M(1.92)), T(-0.22 + M(1.0), 0.20 + M(0.081), M(2.08)), T(-0.22 - M(1.0), 0.20 + M(0.081), M(2.08))],
        lit ? PAL.cyanLit : PAL.cyan, lit ? 'lit' : 'paint');
      for (let k = 0; k < 4; k++) {
        const zz = M(1.7) - k * M(0.2);
        face([T(-0.22 - M(0.8), 0.20 + M(0.082), zz), T(-0.22 + M(0.5), 0.20 + M(0.082), zz), T(-0.22 + M(0.5), 0.20 + M(0.082), zz + M(0.08)), T(-0.22 - M(0.8), 0.20 + M(0.082), zz + M(0.08))],
          PAL.white, lit ? 'lit' : 'paint');
      }
      // A lot cart by the stage door: a cab on four wheels under a canopy in the station's colour.
      const cx = -0.30, cy = -0.12, F = (u, v, zz) => T(cx + v, cy + u, zz);
      box(F, 0, 0, M(1.2), M(0.62), M(0.3), M(0.95), PAL.cart, 'paint');
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        box(F, su * M(0.8), sv * M(0.62), M(0.22), M(0.1), 0, M(0.45), PAL.tyre, 'paint');
        strut(F(su * M(1.05), sv * M(0.55), M(0.95)), F(su * M(1.05), sv * M(0.55), M(1.85)), M(0.035), PAL.steel, 'metal');
      }
      box(F, 0, 0, M(1.25), M(0.66), M(1.85), M(1.95), PAL.cartRoof, 'paint');
    }
  }

  // ── THE CAR PARK ──
  if (o.part === 'p') {
    const z = 0.0016, lw = M(0.11);
    // Two ranks of bays either side of an aisle that runs in from the court.
    const rank = (xs, y0, y1) => {
      for (const x of xs) flat([T(x - lw, y0, z), T(x + lw, y0, z), T(x + lw, y1, z), T(x - lw, y1, z)], PAL.bay, 0.62);
      const xa = xs[0], xb = xs[xs.length - 1], ye = y0 < 0 ? y1 : y0;
      flat([T(xa, ye - lw, z), T(xb, ye - lw, z), T(xb, ye + lw, z), T(xa, ye + lw, z)], PAL.bay, 0.45);
    };
    rank([-0.46, -0.28, -0.11], -0.40, -0.12);
    rank([-0.46, -0.28, -0.11, 0.07], 0.16, 0.44);   // the tower's legs stand where a fourth bay would be
    // The paper's dock: a concrete platform against the Sentinel's back wall, rubber bumpers on its face.
    box(T, (DOCK.x0 + DOCK.x1) / 2, (DOCK.y0 + DOCK.y1) / 2, (DOCK.x1 - DOCK.x0) / 2, (DOCK.y1 - DOCK.y0) / 2, 0, DOCK.z, PAL.concrete, 'paint');
    for (const bx of [DOCK.x0 + 0.05, DOCK.x1 - 0.05]) box(T, bx, DOCK.y1 + M(0.12), M(0.3), M(0.12), M(0.3), DOCK.z - M(0.1), PAL.tyre, 'paint');
    for (const v of VANS) van(v);
    tower();
    lamp(-0.45, 0.02);
  }

  // ── THE BACKLOT ──
  // Where the Deadline stood: a scene dock in the lot's north-west corner. Painted flats lean on the
  // inside of both walls, a street of shopfronts with nothing behind it, and crates stand by the
  // stage. Flats are two faces back to back, timber-coloured behind.
  if (o.part === 'b') {
    const top = LOT.WALL_H - M(0.4), inner = LOT.WALL_C - LOT.WALL_T / 2 - 0.002, lean = M(0.9);
    for (const s of String(o.wall || '')) {
      if (!OUT[s]) continue;
      const F = frame(s);
      for (let i = 0; i < FLATS.length; i++) {
        const [u0, u1, k] = FLATS[i];
        const front = [F(u0, inner - lean, 0), F(u1, inner - lean, 0), F(u1, inner, top), F(u0, inner, top)];
        face(front, PAL.flats[(k + (s === 'w' ? 2 : 0)) % PAL.flats.length], 'paint');
        // A painted shopfront: a dark window band and a lighter sign band, by eye only.
        if (o.near) {
          const at = (t, zf) => { const p = F(u0 + (u1 - u0) * t, inner - lean * (1 - zf) - 0.0015, top * zf); return p; };
          face([at(0.12, 0.18), at(0.88, 0.18), at(0.88, 0.55), at(0.12, 0.55)], PAL.board, 'paint');
          face([at(0.08, 0.66), at(0.92, 0.66), at(0.92, 0.80), at(0.08, 0.80)], PAL.paperBand, 'paint');
        }
        for (const t of [0.15, 0.85]) {
          const u = u0 + (u1 - u0) * t;
          strut(F(u, inner - lean - M(0.9), 0), F(u, inner - lean * 0.45, top * 0.55), M(0.05), PAL.timber, 'paint');
        }
      }
    }
    for (const [x, y, h] of CRATES) box(T, x, y, M(0.75), M(0.75), 0, h, PAL.timber, 'paint', PAL.timberTop);
    lamp(0.30, 0.30);
  }

  // A van: a box body on four wheels with a lower cab at one end. `kind` decides the paint and
  // what's on the roof: KSAB's folded mast, the satellite van's dish, the paper's band.
  function van([x, y, along, face1, kind]) {
    const F = along ? (u, v, zz) => T(x + v, y + u * face1, zz) : (u, v, zz) => T(x + u * face1, y + v, zz);
    const L = LOT.VAN_L / 2, W = LOT.VAN_W / 2, H = LOT.VAN_H, cab = LOT.VAN_L * 0.24;
    const body = kind === 'paper' ? PAL.paper : PAL.van, glassC = PAL.vanGlass;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) box(F, su * (L - M(0.9)), sv * (W - M(0.1)), M(0.34), M(0.12), 0, M(0.68), PAL.tyre, 'paint');
    box(F, -cab / 2, 0, L - cab / 2, W, M(0.45), H, body, 'paint', kind === 'paper' ? PAL.paper : PAL.vanDk);
    box(F, L - cab / 2, 0, cab / 2, W * 0.98, M(0.45), H * 0.74, body, 'paint');
    // The windscreen, on the cab's front face, and the side windows.
    face([F(L + 0.0012, -W * 0.85, H * 0.46), F(L + 0.0012, W * 0.85, H * 0.46), F(L + 0.0012, W * 0.85, H * 0.70), F(L + 0.0012, -W * 0.85, H * 0.70)], glassC, 'glass');
    for (const sv of [-1, 1]) {
      const vv = sv * (W * 0.98 + 0.0012);
      face([F(L - cab + M(0.1), vv, H * 0.46), F(L - M(0.1), vv, H * 0.46), F(L - M(0.1), vv, H * 0.70), F(L - cab + M(0.1), vv, H * 0.70)], glassC, 'glass');
    }
    if (kind === 'paper') {
      for (const sv of [-1, 1]) {
        const vv = sv * (W + 0.0012);
        face([F(-L, vv, H * 0.52), F(L - cab, vv, H * 0.52), F(L - cab, vv, H * 0.64), F(-L, vv, H * 0.64)], PAL.paperBand, 'paint');
      }
      return;
    }
    // The station's disc on both flanks.
    for (const sv of [-1, 1]) {
      const vv = sv * (W + 0.0012), cu = -cab / 2 - M(0.3), cz = H * 0.58, r = M(0.62), pts = [];
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; pts.push(F(cu + Math.cos(a) * r, vv, cz + Math.sin(a) * r)); }
      face(pts, PAL.disc, lit ? 'lit' : 'paint');
    }
    if (kind === 'ksab') {
      // The mast, folded flat along the roof on two saddles.
      for (const su of [-0.6, 0.35]) box(F, su * L, 0, M(0.12), M(0.2), H, H + M(0.18), PAL.steelDk, 'metal');
      box(F, -M(0.2), 0, L * 0.85, M(0.09), H + M(0.18), H + M(0.36), PAL.steel, 'metal');
    } else {
      // The dish, on a post, tipped toward the sky.
      const c = F(-L * 0.35, 0, H + M(0.9));
      strut(F(-L * 0.35, 0, H), c, M(0.08), PAL.steelDk, 'metal');
      const r = M(1.05), pts = [];
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU;
        pts.push(F(-L * 0.35 + Math.cos(a) * r * 0.6, Math.sin(a) * r, H + M(0.9) + Math.cos(a) * r * 0.55));
      }
      face(pts, PAL.vanDk, 'metal');
    }
  }

  // The water tower: four legs splayed a little, braced, a riveted tank, a cone, a catwalk, the
  // station's disc on the side facing the street, a red lamp on top.
  function tower() {
    const x = LOT.TOWER_X, y = LOT.TOWER_Y, z0 = LOT.TOWER_TANK_Z, z1 = LOT.TOWER_TOP_Z, R = LOT.TOWER_R;
    const foot = LOT.TOWER_LEG * 1.25, head = LOT.TOWER_LEG * 0.85;
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const at = (s, k) => [s[0] * (foot + (head - foot) * k), s[1] * (foot + (head - foot) * k)];
    for (const s of legs) {
      const [fx, fy] = at(s, 0), [hx, hy] = at(s, 1);
      strut(T(x + fx, y + fy, 0), T(x + hx, y + hy, z0), M(0.16), PAL.steel, 'metal');
    }
    if (o.near) {
      for (let i = 0; i < 4; i++) {
        const s = legs[i], t = legs[(i + 1) % 4];
        for (const [k0, k1] of [[0.12, 0.5], [0.5, 0.88]]) {
          const [ax, ay] = at(s, k0), [bx, by] = at(t, k1), [cx, cy] = at(t, k0), [ex, ey] = at(s, k1);
          strut(T(x + ax, y + ay, z0 * k0), T(x + bx, y + by, z0 * k1), M(0.05), PAL.steelDk, 'metal');
          strut(T(x + cx, y + cy, z0 * k0), T(x + ex, y + ey, z0 * k1), M(0.05), PAL.steelDk, 'metal');
        }
      }
    }
    drum(x, y, R + M(0.45), z0 - M(0.12), z0, 12, PAL.steelDk, 'metal');
    drum(x, y, R, z0, z1, 12, PAL.tank, 'metal');
    for (const k of [0.33, 0.66]) drum(x, y, R + 0.0012, z0 + (z1 - z0) * k, z0 + (z1 - z0) * k + M(0.08), 12, PAL.steelDk, 'metal');
    {
      const n = 12, rim = [], apex = T(x, y, z1 + M(1.7));
      for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * TAU; rim.push(T(x + Math.cos(a) * (R + M(0.1)), y + Math.sin(a) * (R + M(0.1)), z1)); }
      for (let i = 0; i < n; i++) face([rim[i], rim[(i + 1) % n], apex], PAL.cone, 'metal');
    }
    // The disc and its 7, on the street side (south) and the court side (west).
    // ⚠ `t` IS THE VIEWER'S RIGHT, looking at the face from outside: east on the south face, south on
    // the west face. The other way round, the 7 comes out mirrored.
    for (const [ux, uy] of [[0, 1], [-1, 0]]) {
      const nx = ux, ny = uy, tx = uy, ty = -ux;
      const cz = (z0 + z1) / 2, r = (z1 - z0) * 0.38, off = R * Math.cos(Math.PI / 12) + 0.0018;
      const P = (s, t, zz) => T(x + nx * off + tx * s, y + ny * off + ty * s, zz + t);
      const ring = [];
      for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; ring.push(P(Math.cos(a) * r, Math.sin(a) * r, cz)); }
      face(ring, lit ? PAL.discLit : PAL.disc, lit ? 'lit' : 'paint');
      // The 7: a bar across the top and a stroke down to the left, reversed out in white.
      const P2 = (s, t) => T(x + nx * (off + 0.0012) + tx * s, y + ny * (off + 0.0012) + ty * s, cz + t);
      face([P2(-r * 0.42, r * 0.36), P2(r * 0.42, r * 0.36), P2(r * 0.42, r * 0.56), P2(-r * 0.42, r * 0.56)], PAL.seven, lit ? 'lit' : 'paint');
      face([P2(r * 0.22, r * 0.36), P2(r * 0.42, r * 0.36), P2(-r * 0.08, -r * 0.58), P2(-r * 0.30, -r * 0.58)], PAL.seven, lit ? 'lit' : 'paint');
      if (lit) { const f = P(0, 0, cz); o.light(f[0] + nx * 0.06, f[1] + ny * 0.06, cz - M(1.2), '120,232,255', 18, 0.35); }
    }
    box(T, x, y, M(0.18), M(0.18), z1 + M(1.7), z1 + M(2.05), lit ? [255, 70, 60] : PAL.red, lit ? 'lit' : 'paint');
    if (lit) o.light(dx + x, dy + y, z1 + M(1.9), '255,70,60', 6, 0.8);
  }
}

// ── WHAT A TRUCK STOPS AT ────────────────────────────────────────────────────
//
// The height of whatever stands at (lx, ly), tile-local (x east, y south, from the tile centre), on
// a lot tile whose cell carries `ml`; 0 for open ground. Read off the constants the drawing uses.
// ⚠ THIN THINGS ARE FATTENED, ROUND ONES BARELY. A sweep samples a few points a frame and a wall
// thinner than a sample's step is one a rig at speed goes straight through (the South Lock's note),
// so a wall is a band `WALL_BAND` either side of its line. A pier or the gatehouse is solid in its
// own right; fattened like a wall, the two piers and the booth closed the lane between them.
const WALL_BAND = 0.06, ROUND_PAD = 0.012;
export function lotSolidAt(lx, ly, ml) {
  if (!ml) return 0;
  const along = (side) => {
    const out = OUT[side];
    return [lx * out[1] - ly * out[0], lx * out[0] + ly * out[1]];   // [u along the side, v out through it]
  };
  for (const s of String(ml.w || '')) {
    if (!OUT[s]) continue;
    const [u, v] = along(s);
    if (Math.abs(v - LOT.WALL_C) <= LOT.WALL_T / 2 + WALL_BAND && Math.abs(u) <= 0.5) return LOT.WALL_H;
  }
  if (ml.g && OUT[ml.g]) {
    const [u, v] = along(ml.g);
    if (Math.abs(v - LOT.WALL_C) <= LOT.WALL_T / 2 + WALL_BAND && Math.abs(u) >= PIER_OUT && Math.abs(u) <= 0.5) return LOT.WALL_H;
    for (const su of [-1, 1]) if (Math.hypot(u - su * PIER_U, v - LOT.WALL_C) <= LOT.PIER_R + ROUND_PAD) return LOT.PIER_H;
    if (Math.hypot(u - LOT.BOOTH_U, v - LOT.BOOTH_V) <= LOT.BOOTH_R + ROUND_PAD) return LOT.BOOTH_H;
  }
  if (ml.p === 'b') {
    for (const [x, y, h] of CRATES) if (Math.abs(lx - x) <= M(0.75) + ROUND_PAD && Math.abs(ly - y) <= M(0.75) + ROUND_PAD) return h;
  }
  if (ml.p === 'p') {
    const pad = ROUND_PAD;
    for (const [x, y, alongY] of VANS) {
      const hx = (alongY ? LOT.VAN_W : LOT.VAN_L) / 2 + pad, hy = (alongY ? LOT.VAN_L : LOT.VAN_W) / 2 + pad;
      if (Math.abs(lx - x) <= hx && Math.abs(ly - y) <= hy) return LOT.VAN_H;
    }
    if (lx >= DOCK.x0 - pad && lx <= DOCK.x1 + pad && ly >= DOCK.y0 && ly <= DOCK.y1 + pad) return DOCK.z;
    const foot = LOT.TOWER_LEG * 1.25;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      if (Math.hypot(lx - (LOT.TOWER_X + sx * foot), ly - (LOT.TOWER_Y + sy * foot)) <= M(0.16) + 0.03) return LOT.TOWER_TANK_Z;
    }
  }
  return 0;
}
