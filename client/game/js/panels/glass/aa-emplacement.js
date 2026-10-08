// ── AA EMPLACEMENTS: THE FOUR BATTERIES, AS THEIR ROOM DESCRIPTIONS SAY THEY ARE ───────────────
//
// An AA battery's gun deck is a map tile people stand on (the `aa` mark, plugins/flight/state.js),
// and this draws what is on it. There are four, and each is its own build because each is described
// as its own thing (content/zones/zone_district_*):
//
//   guardian  Coldwater's Guardian Battery on the basin shore: a horseshoe of poured concrete
//             topped with ballistic bags, a twin autocannon on a powered ring mount, a radar that
//             hands it targets, and a steel blast hatch in the floor.
//   sam       the Redline SAM nest: sandbags and scavenged plate bermed into a rough horseshoe, a
//             launch rail with two red-striped missiles on a groaning mount, a plate hatch held
//             down by a truck spring.
//   flak      the Slagworks flak pit: a ring of rusted plate and rammed earth, one long flak gun
//             on a hand-cranked cruciform cradle, a buckled hatch.
//   truck     the Wastes gun nest: an autocannon bolted to the bed of a dead truck, sandbagged,
//             with a buried container beside it whose roof is the bunker hatch.
//
// Three states, from the battery itself: 1 manned (the guns track the nearest aircraft and fire
// when the server says so), 2 strafed and under repair (slewed, barrels down, a work lamp on), and
// 0 a ruin (canted, a barrel gone, scorched, dark).
//
// ⚠ NO IMPORTS, BY DESIGN. The renderer hands this a face sink and a light sink (see drawAAMark in
// windshield.js), so the same geometry goes to the depth buffer on GLASS 2 and to a sorted canvas
// on GLASS 1, and the shapes gates can run it with nothing but a stub. It shades its own faces,
// as the statue does, because a solid on BAY_SINK arrives pre-lit.
//
// Scale: the world's one scale is BIRD_M_PER_TILE, 17.86 m to a tile (client/shared/birds.js), so a
// person is about a tenth of a tile. `M(m)` turns metres into tiles.

const M = (m) => m / 17.857;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const frac = (v) => v - Math.floor(v);
const TAU = Math.PI * 2;

// Each battery's guns, held between frames so they SLEW to a new mark instead of snapping to it.
// Keyed by world tile. A view that closes leaves its entries; there are four batteries in the world.
const AIM = new Map();
const SLEW = 1.6;   // rad/s: a powered mount; a hand-cranked one is slower (see `crank` below)

// ── SHADING ──────────────────────────────────────────────────────────────────
// Diffuse off the sun, a hemisphere sky term, a darker and cooler read after dark, and a tight
// highlight on metal. Wet ground darkens what is not metal.
function makeShade(env) {
  const sun = env.sun, night = clamp(env.night || 0, 0, 1), wet = clamp(env.wet || 0, 0, 1);
  const se = sun ? clamp(sun.elev, 0, 1) : 0.6, fl = Math.sqrt(Math.max(0, 1 - se * se));
  const L = sun && sun.dir ? [sun.dir[0] * fl, sun.dir[1] * fl, se] : [0.35, -0.5, 0.79];
  const day = 1 - night, sunUp = sun ? clamp(se * 4, 0, 1) * day : day;
  return (base, n, v, mat) => {
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
    // After dark a little of the sky's blue gets into everything, which is what reads as night
    // rather than as somebody turning the brightness down.
    const nb = night * 0.32;
    return [
      clamp(base[0] * k * (1 - nb) + 30 * nb + spec, 0, 255),
      clamp(base[1] * k * (1 - nb) + 38 * nb + spec, 0, 255),
      clamp(base[2] * k * (1 - nb) + 58 * nb + spec, 0, 255),
    ];
  };
}

// ── PALETTES ─────────────────────────────────────────────────────────────────
const PAL = {
  guardian: {
    floor: [132, 130, 124], wall: [156, 153, 146], coping: [176, 173, 165], bag: [124, 120, 98], bagDk: [104, 100, 80],
    gun: [74, 84, 92], gunDk: [52, 58, 64], barrel: [58, 62, 66], ring: [92, 96, 100], hazard: [214, 170, 40],
    hatch: [88, 92, 94], mast: [120, 124, 126], radar: [196, 200, 196],
  },
  sam: {
    floor: [118, 104, 82], wall: [150, 132, 98], coping: [128, 84, 58], bag: [150, 136, 104], bagDk: [126, 112, 84],
    gun: [120, 70, 52], gunDk: [86, 50, 40], barrel: [70, 66, 62], ring: [96, 86, 76], hazard: [178, 34, 30],
    hatch: [112, 72, 50], mast: [96, 90, 84], radar: [184, 178, 160],
    missile: [214, 210, 198], stripe: [184, 30, 28], spring: [70, 70, 72],
  },
  flak: {
    floor: [104, 92, 76], wall: [132, 80, 50], coping: [96, 62, 42], bag: [118, 100, 76], bagDk: [96, 82, 62],
    gun: [96, 92, 70], gunDk: [70, 66, 52], barrel: [64, 62, 58], ring: [84, 76, 64], hazard: [160, 120, 40],
    hatch: [104, 70, 50], mast: [90, 80, 70], radar: [160, 150, 130], earth: [112, 96, 70],
  },
  truck: {
    floor: [146, 132, 100], wall: [168, 150, 110], coping: [150, 134, 98], bag: [168, 152, 112], bagDk: [140, 126, 92],
    gun: [80, 86, 70], gunDk: [58, 62, 52], barrel: [60, 62, 60], ring: [96, 92, 80], hazard: [170, 130, 50],
    hatch: [118, 80, 52], mast: [90, 86, 80], radar: [170, 160, 140],
    cab: [96, 132, 128], cabDk: [70, 96, 94], tyre: [34, 32, 30], rim: [110, 106, 98], glass: [60, 74, 82],
    box: [146, 84, 50], rib: [126, 72, 44],
  },
};
// A ruin is the same build, burnt: everything pulled toward soot.
function scorch(rgb, k) { return [rgb[0] * (1 - k) + 26 * k, rgb[1] * (1 - k) + 24 * k, rgb[2] * (1 - k) + 22 * k]; }

// ── THE BUILD ────────────────────────────────────────────────────────────────
//
// `o` is everything the renderer knows about this tile and this frame:
//   dx, dy      tile centre, camera-relative (the frame cam.proj takes)
//   wx, wy      the world tile, which keys the slew memory
//   kind, s     the battery's kind and state (see the top of this file)
//   open        unit vector [x, y] the horseshoe opens toward (its way in)
//   shift       unit vector the whole pit is moved along, on a Curtain tile, to clear the wall
//   eye         [x, y, z] in the same frame, which way a face's normal is turned
//   target      [x, y, z] the aircraft to lay the guns on, or null
//   firing      0..1, how recently it opened up (1 = this instant), 0 for not
//   near        true within arm's length: the bags are drawn bag by bag
//   seed, now, night, alpha, wet, sun
//   face(pts, rgb, a)            one convex polygon, points in the same frame, already shaded
//   light(x, y, z, rgb, s, a)    a glow
export function drawAAEmplacement(o) {
  const kind = PAL[o.kind] ? o.kind : 'guardian';
  const pal0 = PAL[kind], s = o.s == null ? 1 : o.s;
  const ruin = s === 0, down = s !== 1;
  const sk = ruin ? 0.55 : 0;
  const pal = sk ? Object.fromEntries(Object.entries(pal0).map(([k, v]) => [k, scorch(v, sk)])) : pal0;
  const night = clamp(o.night || 0, 0, 1);
  const shade = makeShade(o);
  const alpha = o.alpha == null ? 1 : o.alpha;
  const seed = o.seed || 1;
  const rnd = (i) => frac(Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453);
  const E = o.eye || [0, 0, 0.2];
  let faces = 0;

  // ── THE FACE ──
  // Newell's normal, turned toward the eye (these are closed solids; the back face is hidden by
  // its own front one), shaded, handed over.
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
    let vx = E[0] - cx, vy = E[1] - cy, vz = E[2] - cz;
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    o.face(pts, shade(base, [nx, ny, nz], [vx, vy, vz], mat || 'paint'), alpha);
    faces++;
  };

  // ── THE TILE FRAME ──
  // The pit's centre, moved off a Curtain wall when there is one, and its own axes: `u` along the
  // opening, `w` across it. A Curtain battery is drawn a little smaller, because it has half a tile.
  const sh = o.shift ? 0.17 : 0;
  const cx = o.dx + (o.shift ? o.shift[0] * sh : 0), cy = o.dy + (o.shift ? o.shift[1] * sh : 0);
  const sc = o.shift ? 0.78 : 1;
  const op = o.open || [1, 0];
  const ux = op[0], uy = op[1], wx = -uy, wy = ux;
  const T = (u, w, z) => [cx + (u * ux + w * wx) * sc, cy + (u * uy + w * wy) * sc, z * sc];
  const tAng = Math.atan2(uy, ux);

  // A box in the tile frame: centre (u, w), half-extents (hu, hw), z0..z1, yawed by `r` off the
  // opening. Five faces: the underside of something standing on the ground is never seen.
  const tbox = (u, w, hu, hw, z0, z1, r, base, mat, top = base) => {
    const c = Math.cos(r || 0), sn = Math.sin(r || 0);
    const P = (a, b, z) => T(u + a * hu * c - b * hw * sn, w + a * hu * sn + b * hw * c, z);
    const A = P(-1, -1, z0), B = P(1, -1, z0), C = P(1, 1, z0), D = P(-1, 1, z0);
    const Ea = P(-1, -1, z1), F = P(1, -1, z1), G = P(1, 1, z1), H = P(-1, 1, z1);
    face([Ea, F, G, H], top, mat);
    face([A, B, F, Ea], base, mat); face([B, C, G, F], base, mat);
    face([C, D, H, G], base, mat); face([D, A, Ea, H], base, mat);
  };
  // A flat disc on (or just above) the ground: the pit's floor.
  const disc = (u, w, r, z, n, base, mat) => {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push(T(u + Math.cos(a) * r, w + Math.sin(a) * r, z)); }
    face(pts, base, mat);
  };
  // An upright drum: n sides between z0 and z1, with a lid.
  const drum = (u, w, r, z0, z1, n, base, mat, lid = base) => {
    const ring = (z) => { const out = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; out.push(T(u + Math.cos(a) * r, w + Math.sin(a) * r, z)); } return out; };
    const b = ring(z0), t = ring(z1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; face([b[i], b[j], t[j], t[i]], base, mat); }
    face(t, lid, mat);
  };

  // ── THE REVETMENT ──
  // A horseshoe: an arc of wall round the pit, open toward `open` across GAP radians. Each segment
  // is a trapezoid in plan (the inner face shorter than the outer), so the ring closes with no
  // gaps at the joints.
  const R_IN = 0.27, GAP = 1.05;
  const arc = (rIn, rOut, z0, z1, n, base, mat, top, batter = 0) => {
    const a0 = GAP / 2, a1 = TAU - GAP / 2;
    for (let i = 0; i < n; i++) {
      const p = a0 + (a1 - a0) * i / n, q = a0 + (a1 - a0) * (i + 1) / n;
      const ci = (a, r, z) => T(Math.cos(a) * r, Math.sin(a) * r, z);
      const rt = rOut - batter;   // a battered wall leans in at the top
      const ib0 = ci(p, rIn, z0), ib1 = ci(q, rIn, z0), ob0 = ci(p, rOut, z0), ob1 = ci(q, rOut, z0);
      const it0 = ci(p, rIn, z1), it1 = ci(q, rIn, z1), ot0 = ci(p, rt, z1), ot1 = ci(q, rt, z1);
      face([ob0, ob1, ot1, ot0], base, mat);           // outside
      face([ib0, ib1, it1, it0], base, mat);           // inside
      face([it0, it1, ot1, ot0], top || base, mat);    // the top you lean on
      if (i === 0) face([ib0, ob0, ot0, it0], base, mat);       // the two ends at the mouth
      if (i === n - 1) face([ib1, ob1, ot1, it1], base, mat);
    }
  };
  // Bags along the top of an arc. Near, each bag is a pillow (a box with its top drawn in); far,
  // each run is one rounded course, which is what a bag wall is at any distance.
  const bagCourse = (r, z, h, len, wid, base, alt, offset, phase) => {
    const a0 = GAP / 2 + 0.02, a1 = TAU - GAP / 2 - 0.02;
    const runLen = (a1 - a0) * r, n = Math.max(3, Math.round(runLen / len));
    if (!o.near) { arc(r - wid, r + wid, z, z + h, Math.max(6, Math.round(n / 3)), base, 'bag', alt, wid * 0.25); return; }
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i + 0.5 + phase) / n;
      if (a > a1) continue;
      const jit = (rnd(offset + i) - 0.5) * 0.18;
      const col = (i + offset) % 3 === 0 ? alt : base;
      const u = Math.cos(a) * r, w = Math.sin(a) * r;
      const hl = (runLen / n) * 0.47;
      // A filled bag: straight sides to a shoulder, then rounded in to a flattened top. ⚠ NOT A
      // PYRAMID: pinched straight from the foot to the top, a course of them read as a row of teeth.
      const rr = a + Math.PI / 2 + jit;
      const c = Math.cos(rr), sn = Math.sin(rr);
      const P = (aa, bb, zz) => T(u + aa * c - bb * sn, w + aa * sn + bb * c, zz);
      const ring = (kx, kw, zz) => [P(-hl * kx, -wid * kw, zz), P(hl * kx, -wid * kw, zz), P(hl * kx, wid * kw, zz), P(-hl * kx, wid * kw, zz)];
      const r0 = ring(0.96, 0.92, z), r1 = ring(1, 1, z + h * 0.55), r2 = ring(0.88, 0.74, z + h);
      for (let k = 0; k < 4; k++) {
        const j = (k + 1) % 4;
        face([r0[k], r0[j], r1[j], r1[k]], col, 'bag');
        face([r1[k], r1[j], r2[j], r2[k]], col, 'bag');
      }
      face(r2, col, 'bag');
    }
  };

  // ── THE GUN'S FRAME ──
  // The mount sits at (gu, gw) in the tile frame. `az` is the gun's bearing in the world (radians,
  // atan2 of dy over dx), `el` its elevation. `G(a, l, z)` places a point `a` along the barrels,
  // `l` across them and `z` up, rotated about the trunnions at `zt` when `lift` is set.
  const AIMK = o.wx + ',' + o.wy;
  const gu = kind === 'truck' ? -0.02 : 0, gw = 0;
  const gp = T(gu, gw, 0);
  const st = AIM.get(AIMK) || { az: tAng + Math.PI + (rnd(5) - 0.5) * 1.2, el: 0.35, t: o.now || 0 };
  {
    const now = o.now || 0, dt = clamp((now - st.t) / 1000, 0, 0.25);
    st.t = now;
    let wantAz, wantEl;
    if (ruin) { wantAz = tAng + 2.2 + rnd(9) * 1.4; wantEl = -0.06; }
    else if (down) { wantAz = tAng + 0.9 + rnd(7) * 1.2; wantEl = -0.02; }
    else if (o.target) {
      const tx = o.target[0] - gp[0], ty = o.target[1] - gp[1], tz = o.target[2];
      wantAz = Math.atan2(ty, tx);
      wantEl = clamp(Math.atan2(tz, Math.hypot(tx, ty)), 0.05, 1.35);
    } else {
      // Nobody up there: the crew sweep the haze, slowly, off the side the open sky is on.
      const t = now / 1000;
      wantAz = tAng + Math.PI + Math.sin(t * 0.11 + seed) * 1.1 + Math.sin(t * 0.047) * 0.5;
      wantEl = 0.42 + 0.12 * Math.sin(t * 0.07 + seed * 3);
    }
    const crank = kind === 'flak' || kind === 'truck' ? 0.45 : 1;   // a hand-cranked mount is slower
    let d = ((wantAz - st.az) % TAU + TAU * 1.5) % TAU - Math.PI;
    const step = SLEW * crank * dt;
    st.az += clamp(d, -step, step);
    st.el += clamp(wantEl - st.el, -step * 0.6, step * 0.6);
    AIM.set(AIMK, st);
  }
  const az = st.az, el = st.el;
  // The guns are drawn a third over life size against the pit, which is what a gun has to be to read
  // as the point of the place from across a street; the pit and the bags stay true.
  const gs = kind === 'truck' ? 1.15 : 1.3;
  const fx = Math.cos(az), fy = Math.sin(az), lx = -fy, ly = fx;
  const frame = (zBase, zt, lift) => (a, l, z) => {
    let aa = a, zz = z;
    if (lift) { const ce = Math.cos(el), se = Math.sin(el); aa = a * ce - (z - zt) * se; zz = zt + a * se + (z - zt) * ce; }
    return [gp[0] + (aa * fx + l * lx) * sc * gs, gp[1] + (aa * fy + l * ly) * sc * gs, (zBase + zz) * sc * gs];
  };
  // A box in a gun frame (six faces: an elevated part is seen from below).
  const gbox = (G, a0, a1, l0, l1, z0, z1, base, mat, top = base) => {
    const A = G(a0, l0, z0), B = G(a1, l0, z0), C = G(a1, l1, z0), D = G(a0, l1, z0);
    const Ea = G(a0, l0, z1), F = G(a1, l0, z1), Gg = G(a1, l1, z1), H = G(a0, l1, z1);
    face([Ea, F, Gg, H], top, mat); face([A, B, C, D], base, mat);
    face([A, B, F, Ea], base, mat); face([B, C, Gg, F], base, mat);
    face([C, D, H, Gg], base, mat); face([D, A, Ea, H], base, mat);
  };
  // A tube along the gun's `a` axis, from a0 to a1, at (l, z), tapering r0 → r1, with an end cap.
  const gtube = (G, a0, a1, l, z, r0, r1, n, base, mat, cap = base) => {
    const ring = (a, r) => { const out = []; for (let i = 0; i < n; i++) { const t = i / n * TAU + Math.PI / n; out.push(G(a, l + Math.cos(t) * r, z + Math.sin(t) * r)); } return out; };
    const p = ring(a0, r0), q = ring(a1, r1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; face([p[i], p[j], q[j], q[i]], base, mat); }
    face(q, cap, mat);
  };

  const muzzles = [];   // [x, y, z] of each bore, for the flash
  const lamps = [];     // [x, y, z, rgb, size, a] after-dark lights

  // ═══ GUARDIAN ═══════════════════════════════════════════════════════════════
  if (kind === 'guardian') {
    disc(0, 0, 0.36, 0.002, 18, pal.floor, 'concrete');
    // A drain gutter round the inside foot of the wall and the painted arc of the gun's sweep.
    arc(R_IN - 0.012, R_IN, 0.002, 0.0035, 12, [70, 70, 68], 'concrete');
    // The wall: poured concrete, battered, its coping lighter, then two courses of ballistic bag.
    const WH = M(1.1);
    arc(R_IN, R_IN + 0.06, 0, WH, 14, pal.wall, 'concrete', pal.coping, 0.012);
    bagCourse(R_IN + 0.024, WH, M(0.32), M(1.0), M(0.28), pal.bag, pal.bagDk, 0, 0);
    bagCourse(R_IN + 0.024, WH + M(0.32), M(0.30), M(1.0), M(0.27), pal.bagDk, pal.bag, 7, 0.5);
    // Ready-use ammunition lockers against the inside of the wall, either side of the mouth.
    for (const side of [-1, 1]) {
      const a = side * (GAP / 2 + 0.55), r = R_IN - 0.035;
      tbox(Math.cos(a) * r, Math.sin(a) * r, M(0.9), M(0.45), 0, M(0.9), a, [84, 92, 74], 'paint', [96, 104, 84]);
    }
    // ── The blast hatch, in the floor by the mouth: a raised coaming, a plate, a hinge, a wheel.
    {
      const hu = 0.13, hw = 0.0;
      tbox(hu, hw, M(1.0), M(1.0), 0, M(0.12), 0, [70, 72, 72], 'metal');
      tbox(hu, hw, M(0.86), M(0.86), M(0.12), M(0.17), 0, pal.hatch, 'metal');
      tbox(hu - M(0.95), hw, M(0.1), M(0.75), M(0.1), M(0.22), 0, [60, 62, 62], 'metal');        // hinge barrel
      // The wheel: four spokes and a rim, flat on the plate.
      const z = M(0.2), r = M(0.34);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU, b = (k + 1) / 8 * TAU;
        const p0 = T(hu + Math.cos(a) * r, hw + Math.sin(a) * r, z), p1 = T(hu + Math.cos(b) * r, hw + Math.sin(b) * r, z);
        const p2 = T(hu + Math.cos(b) * r * 0.82, hw + Math.sin(b) * r * 0.82, z + M(0.05)), p3 = T(hu + Math.cos(a) * r * 0.82, hw + Math.sin(a) * r * 0.82, z + M(0.05));
        face([p0, p1, p2, p3], [150, 40, 34], 'paint');
      }
    }
    // ── The ring mount: a plinth, a hazard-striped race, and the turntable riding on it.
    drum(gu, gw, M(2.0) * gs, 0, M(0.35) * gs, 16, [120, 118, 112], 'concrete');
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU, b = (k + 1) / 16 * TAU, r0 = M(1.55) * gs, r1 = M(1.95) * gs, z = M(0.355) * gs;
      face([T(gu + Math.cos(a) * r0, gw + Math.sin(a) * r0, z), T(gu + Math.cos(b) * r0, gw + Math.sin(b) * r0, z),
        T(gu + Math.cos(b) * r1, gw + Math.sin(b) * r1, z), T(gu + Math.cos(a) * r1, gw + Math.sin(a) * r1, z)],
      k % 2 ? pal.hazard : [30, 30, 30], 'paint');
    }
    const Gf = frame(M(0.35), 0, false);
    // Turntable and the armoured housing, traversing with the guns.
    {
      const ring = []; const n = 14;
      for (let i = 0; i < n; i++) { const a = i / n * TAU; ring.push([Math.cos(a) * M(1.45), Math.sin(a) * M(1.45)]); }
      const b = ring.map(([a, l]) => Gf(a, l, 0)), t = ring.map(([a, l]) => Gf(a, l, M(0.28)));
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; face([b[i], b[j], t[j], t[i]], pal.ring, 'metal'); }
      face(t, pal.ring, 'metal');
    }
    // The housing: a low armoured box with a sloped glacis toward the guns and a cut-back rear.
    const zH = M(0.28), hH = M(1.25);
    {
      const A0 = -M(1.25), A1 = M(0.55), A2 = M(1.15), L = M(1.05);
      const pts = (l) => [Gf(A0, l, zH), Gf(A1 + M(0.6), l, zH), Gf(A2, l, zH + hH * 0.55), Gf(A1, l, zH + hH), Gf(A0 + M(0.2), l, zH + hH)];
      const pl = pts(-L), pr = pts(L);
      face(pl, pal.gun, 'metal'); face(pr, pal.gun, 'metal');
      for (let i = 0; i < pl.length; i++) { const j = (i + 1) % pl.length; face([pl[i], pl[j], pr[j], pr[i]], i === 3 ? pal.gunDk : pal.gun, 'metal'); }
      // Ammunition feed boxes slung either side, and their chutes up into the housing.
      for (const sd of [-1, 1]) {
        gbox(Gf, -M(0.9), M(0.35), sd * L, sd * (L + M(0.55)), zH + M(0.1), zH + M(0.85), pal.gunDk, 'metal', pal.gun);
        gbox(Gf, M(0.0), M(0.25), sd * (L - M(0.05)), sd * (L + M(0.05)), zH + M(0.85), zH + M(1.05), [40, 44, 48], 'metal');
      }
    }
    // The cradle and the twin barrels, elevating about trunnions at the housing's shoulder.
    const zt = zH + hH * 0.62;
    const Ge = frame(M(0.35), zt, true);
    gbox(Ge, -M(0.35), M(1.35), -M(0.55), M(0.55), zt - M(0.28), zt + M(0.28), pal.gunDk, 'metal');
    const bl = M(4.2);
    for (const l of [-M(0.32), M(0.32)]) {
      if (ruin && l > 0) { gtube(Ge, M(1.2), M(2.0), l, zt, M(0.13), M(0.11), 6, [30, 28, 26], 'metal', [12, 10, 10]); continue; }   // sheared
      gtube(Ge, M(1.2), M(1.6), l, zt, M(0.2), M(0.17), 8, pal.gunDk, 'metal');            // recoil jacket
      gtube(Ge, M(1.6), bl, l, zt, M(0.11), M(0.09), 8, pal.barrel, 'metal');              // the barrel
      gtube(Ge, bl, bl + M(0.45), l, zt, M(0.16), M(0.16), 8, [44, 46, 48], 'metal', [10, 10, 12]);   // muzzle brake
      muzzles.push(Ge(bl + M(0.5), l, zt));
    }
    // The radar that hands it targets: a lattice mast at the back of the pit, and a planar array
    // turning on top of it, a slow full sweep that never stops while the battery is manned.
    {
      const ma = Math.PI + 0.35, mr = R_IN - 0.06;
      const mu = Math.cos(ma) * mr, mw = Math.sin(ma) * mr, mh = M(5.2);
      drum(mu, mw, M(0.6), 0, M(0.6), 8, [120, 118, 112], 'concrete');
      // Four legs, each a square section battered in toward the head.
      for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
        const leg = (z, k, t) => [T(mu + a * k - t, mw + b * k - t, z), T(mu + a * k + t, mw + b * k - t, z), T(mu + a * k + t, mw + b * k + t, z), T(mu + a * k - t, mw + b * k + t, z)];
        const lo = leg(M(0.6), M(0.42), M(0.07)), hi = leg(mh, M(0.16), M(0.05));
        for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; face([lo[k], lo[j], hi[j], hi[k]], pal.mast, 'metal'); }
      }
      // Cross-bracing in three bays.
      for (let k = 0; k < 3; k++) {
        const z0 = M(0.6) + (mh - M(0.6)) * k / 3, z1 = M(0.6) + (mh - M(0.6)) * (k + 1) / 3, w0 = M(0.42 - 0.26 * k / 3), w1 = M(0.42 - 0.26 * (k + 1) / 3);
        for (const sd of [-1, 1]) {
          const p0 = T(mu - w0, mw + sd * w0, z0), p1 = T(mu + w1, mw + sd * w1, z1);
          face([p0, T(mu - w0, mw + sd * w0, z0 + M(0.08)), T(mu + w1, mw + sd * w1, z1 + M(0.08)), p1], pal.mast, 'metal');
        }
      }
      const spin = down ? 1.2 + rnd(3) : ((o.now || 0) / 1000) * 1.7;
      const ca = Math.cos(spin), sa = Math.sin(spin);
      const R = (a, b, z) => T(mu + a * ca - b * sa, mw + a * sa + b * ca, z);
      const zr = mh + M(0.25);
      tbox(mu, mw, M(0.3), M(0.3), mh, zr, 0, [60, 64, 66], 'metal');
      // The array: a tilted flat panel, its face the bright side.
      const W = M(1.15), Hh = M(0.75), tilt = 0.28;
      const Q = (b, h) => R(Math.sin(tilt) * h, b, zr + Math.cos(tilt) * h);
      face([Q(-W, 0), Q(W, 0), Q(W, Hh), Q(-W, Hh)], pal.radar, 'metal');
      const Qb = (b, h) => R(Math.sin(tilt) * h - M(0.18), b, zr + Math.cos(tilt) * h);
      face([Qb(-W, 0), Qb(W, 0), Qb(W, Hh), Qb(-W, Hh)], [70, 74, 76], 'metal');
      face([Q(-W, Hh), Q(W, Hh), Qb(W, Hh), Qb(-W, Hh)], [90, 94, 96], 'metal');
      if (!ruin) lamps.push([...T(mu, mw, zr + M(1.15)), '255,46,36', 26, 0.35 + 0.65 * (Math.sin((o.now || 0) / 260) > 0.2 ? 1 : 0.15), 'beacon']);
    }
    // The turret's status lamp, on the housing's crown.
    if (!ruin) lamps.push([...Gf(-M(0.6), 0, zH + hH + M(0.12)), down ? '255,170,50' : '90,255,140', 9, 0.85, 'status']);
    if (s === 2) lamps.push([...T(-0.05, 0.12, M(2.2)), '255,214,150', 46, 0.5, 'work']);
    // The pit's own light after dark: low red lamps under the coping, which keep a gun crew's night
    // eyes and are what the pit reads as from the street.
    else if (s === 1) for (const a of [Math.PI * 0.7, Math.PI * 1.3]) lamps.push([...T(Math.cos(a) * (R_IN - 0.02), Math.sin(a) * (R_IN - 0.02), M(0.9)), '255,60,44', 30, 0.4, 'pit']);
  }

  // ═══ SAM ════════════════════════════════════════════════════════════════════
  else if (kind === 'sam') {
    disc(0, 0, 0.35, 0.002, 16, pal.floor, 'earth');
    // The berm: earth heaped and faced with scavenged plate, sandbags along its crown.
    const WH = M(1.0);
    arc(R_IN - 0.005, R_IN + 0.07, 0, WH, 12, pal.floor, 'earth', pal.floor, 0.03);
    // Plate facing on the inside, panel by panel, each its own rust and its own lean.
    {
      const a0 = GAP / 2, a1 = TAU - GAP / 2, n = 9;
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (i + 0.5) / n, r = R_IN - 0.006;
        const col = rnd(i + 30) > 0.55 ? pal.coping : [112, 104, 96];
        tbox(Math.cos(a) * r, Math.sin(a) * r, M(0.08), (a1 - a0) / n * r * 0.52 / 1, 0, WH * (0.86 + rnd(i) * 0.25), a + (rnd(i + 3) - 0.5) * 0.12, col, 'metal');
      }
    }
    bagCourse(R_IN + 0.03, WH, M(0.32), M(0.95), M(0.28), pal.bag, pal.bagDk, 3, 0);
    // The plate hatch, held shut by a coiled truck spring.
    {
      const hu = 0.13;
      tbox(hu, 0.02, M(0.95), M(0.85), 0, M(0.1), 0.15, pal.hatch, 'metal');
      const zc = M(0.1), r = M(0.24);
      for (let k = 0; k < 5; k++) drum(hu, 0.02, r, zc + k * M(0.09), zc + k * M(0.09) + M(0.05), 8, pal.spring, 'metal');
    }
    // The powered mount and the launch rail.
    drum(gu, gw, M(1.4) * gs, 0, M(0.45) * gs, 12, pal.ring, 'metal');
    const Gf = frame(M(0.45), 0, false);
    gbox(Gf, -M(0.9), M(0.9), -M(0.8), M(0.8), 0, M(0.55), pal.gun, 'metal', pal.gunDk);
    // A red-striped hazard skirt round the traverse, the Redline's colours.
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * TAU, b = (k + 1) / 10 * TAU, r = M(1.42) * gs, z0 = M(0.12) * gs, z1 = M(0.3) * gs;
      face([T(gu + Math.cos(a) * r, gw + Math.sin(a) * r, z0), T(gu + Math.cos(b) * r, gw + Math.sin(b) * r, z0),
        T(gu + Math.cos(b) * r, gw + Math.sin(b) * r, z1), T(gu + Math.cos(a) * r, gw + Math.sin(a) * r, z1)], k % 2 ? pal.stripe : [220, 214, 200], 'paint');
    }
    // Two posts up to the elevating arm.
    const zt = M(1.8);
    for (const l of [-M(0.55), M(0.55)]) gbox(Gf, -M(0.15), M(0.15), l - M(0.1), l + M(0.1), M(0.55), zt - M(0.1), pal.gunDk, 'metal');
    const Ge = frame(M(0.45), zt, true);
    gbox(Ge, -M(1.6), M(1.8), -M(0.75), M(0.75), zt - M(0.12), zt + M(0.05), pal.gun, 'metal');    // the rail beam
    // The missiles on the rail: white bodies, a red band, the nose cone, four fins.
    const shots = ruin ? 0 : 2;
    for (let m = 0; m < shots; m++) {
      const l = (m ? 1 : -1) * M(0.42), zz = zt + M(0.32);
      gtube(Ge, -M(1.55), M(1.25), l, zz, M(0.2), M(0.2), 8, pal.missile, 'paint');
      gtube(Ge, M(0.15), M(0.5), l, zz, M(0.205), M(0.205), 8, pal.stripe, 'paint');
      gtube(Ge, M(1.25), M(2.05), l, zz, M(0.2), M(0.02), 8, pal.missile, 'paint', pal.missile);
      for (const [fl, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = (a, r) => Ge(a, l + fl * r, zz + fz * r);
        face([p(-M(1.55), M(0.2)), p(-M(1.0), M(0.2)), p(-M(1.25), M(0.55)), p(-M(1.55), M(0.55))], pal.stripe, 'paint');
      }
      muzzles.push(Ge(-M(1.7), l, zz));
    }
    if (ruin) {
      // An empty rail and one missile's burnt-out casing on the floor of the pit.
      const G0 = frame(0, 0, false);
      gtube(G0, M(1.6), M(3.6), M(1.2), M(0.2), M(0.2), M(0.18), 6, [44, 40, 38], 'metal', [20, 18, 16]);
    }
    // The tracking head on a short mast beside the mount, and a red lamp on it.
    {
      const ma = Math.PI - 0.5, mr = R_IN - 0.07, mu = Math.cos(ma) * mr, mw = Math.sin(ma) * mr, mh = M(3.2);
      drum(mu, mw, M(0.1), 0, mh, 6, pal.mast, 'metal');
      const spin = down ? 0.7 : ((o.now || 0) / 1000) * 1.1;
      tbox(mu, mw, M(0.75), M(0.1), mh, mh + M(0.55), spin - tAng, pal.radar, 'metal');   // `r` is off the opening, so this turns it in the world
      if (!ruin) lamps.push([...T(mu, mw, mh + M(0.8)), '255,52,40', 18, 0.35 + 0.65 * (Math.sin((o.now || 0) / 340) > 0.3 ? 1 : 0.2), 'beacon']);
    }
    if (s === 2) lamps.push([...T(0.08, -0.12, M(2.0)), '255,206,140', 40, 0.5, 'work']);
    // A bare bulb on a cable over the hatch, which is how the crew read at night.
    if (!ruin) lamps.push([...T(0.13, 0.02, M(2.4)), '255,196,120', 22, 0.55, 'bulb']);
  }

  // ═══ FLAK ═══════════════════════════════════════════════════════════════════
  else if (kind === 'flak') {
    // Sunk: the floor sits in the earth, and the ring is rammed earth faced with rusted plate.
    disc(0, 0, 0.36, 0.002, 16, pal.earth, 'earth');
    disc(0, 0, R_IN - 0.01, 0.003, 16, pal.floor, 'earth');
    const WH = M(1.25);
    arc(R_IN + 0.02, R_IN + 0.1, 0, WH * 0.8, 12, pal.earth, 'earth', pal.earth, 0.05);     // the earth bank behind
    {
      const a0 = GAP / 2, a1 = TAU - GAP / 2, n = 11;
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (i + 0.5) / n, r = R_IN + 0.008;
        const rust = [pal.wall, [112, 66, 42], [146, 92, 58]][Math.floor(rnd(i + 50) * 3)];
        tbox(Math.cos(a) * r, Math.sin(a) * r, M(0.07), (a1 - a0) / n * r * 0.53, 0, WH * (0.82 + rnd(i + 9) * 0.3), a + (rnd(i + 17) - 0.5) * 0.1, rust, 'metal');
      }
    }
    // The buckled hatch: a plate lying askew on its coaming, one corner sprung up.
    {
      const hu = 0.14, hw = 0.03;
      tbox(hu, hw, M(0.9), M(0.9), 0, M(0.1), 0.2, [64, 58, 52], 'metal');
      const P = (a, b, z) => T(hu + a, hw + b, z);
      face([P(-M(0.85), -M(0.8), M(0.12)), P(M(0.85), -M(0.85), M(0.12)), P(M(0.8), M(0.85), M(0.42)), P(-M(0.8), M(0.8), M(0.14))], pal.hatch, 'metal');
    }
    // The cruciform cradle: four outriggers on jack pads, a pedestal, the hand-crank wheels.
    const Gf = frame(0, 0, false);
    for (let k = 0; k < 4; k++) {
      const a = tAng + Math.PI / 4 + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      const p0 = [gp[0], gp[1]], len = M(2.6);
      const P = (t, side, z) => [p0[0] + (ca * t - sa * side) * sc * gs, p0[1] + (sa * t + ca * side) * sc * gs, z * sc * gs];
      const hw = M(0.16);
      face([P(0, -hw, M(0.42)), P(len, -hw, M(0.12)), P(len, hw, M(0.12)), P(0, hw, M(0.42))], pal.gun, 'metal');
      face([P(0, -hw, M(0.22)), P(len, -hw, 0.002), P(len, -hw, M(0.12)), P(0, -hw, M(0.42))], pal.gunDk, 'metal');
      face([P(0, hw, M(0.22)), P(len, hw, 0.002), P(len, hw, M(0.12)), P(0, hw, M(0.42))], pal.gunDk, 'metal');
      // Jack pad.
      const pad = [P(len - M(0.3), -M(0.3), 0.003), P(len + M(0.3), -M(0.3), 0.003), P(len + M(0.3), M(0.3), 0.003), P(len - M(0.3), M(0.3), 0.003)];
      face(pad, pal.gunDk, 'metal');
    }
    drum(gu, gw, M(0.55) * gs, 0, M(0.9) * gs, 10, pal.gun, 'metal', pal.gunDk);
    // The carriage on top, traversing: a box with the shield plate in front of the layer.
    const zc = M(0.9);
    gbox(Gf, -M(0.9), M(0.8), -M(0.7), M(0.7), zc, zc + M(0.55), pal.gun, 'metal', pal.gunDk);
    // The gun shield: a bent plate, two leaves angled back.
    for (const sd of [-1, 1]) {
      face([Gf(M(0.85), 0, zc + M(0.2)), Gf(M(0.65), sd * M(1.3), zc + M(0.2)), Gf(M(0.65), sd * M(1.3), zc + M(1.9)), Gf(M(0.85), 0, zc + M(1.9))], pal.gun, 'metal');
    }
    // Two crank wheels on the left side, traverse and elevation.
    for (const [a, z] of [[-M(0.3), zc + M(0.5)], [M(0.25), zc + M(0.75)]]) {
      const r = M(0.3), n = 8, ring = [];
      for (let i = 0; i < n; i++) { const t = i / n * TAU; ring.push(Gf(a + Math.cos(t) * r, -M(0.9), z + Math.sin(t) * r)); }
      face(ring, [60, 56, 50], 'metal');
    }
    // The long barrel and its recuperator, elevating about the trunnions.
    const zt = zc + M(0.95);
    const Ge = frame(0, zt, true);
    gbox(Ge, -M(1.3), M(1.1), -M(0.32), M(0.32), zt - M(0.3), zt + M(0.25), pal.gunDk, 'metal');      // cradle
    gtube(Ge, -M(1.0), M(1.4), 0, zt + M(0.42), M(0.14), M(0.14), 6, pal.gun, 'metal');               // recuperator over the barrel
    const bl = ruin ? M(3.0) : M(5.6);
    gtube(Ge, M(1.0), bl, 0, zt, M(0.15), M(0.12), 8, pal.barrel, 'metal', ruin ? [14, 12, 10] : [30, 30, 30]);
    if (!ruin) { gtube(Ge, bl, bl + M(0.4), 0, zt, M(0.19), M(0.17), 8, [46, 44, 42], 'metal', [12, 12, 12]); muzzles.push(Ge(bl + M(0.45), 0, zt)); }
    // Shells stacked in a rack against the wall, brass catching the light.
    {
      const a = -GAP / 2 - 0.5, r = R_IN - 0.04, u = Math.cos(a) * r, w = Math.sin(a) * r;
      tbox(u, w, M(0.5), M(0.9), 0, M(0.45), a, [90, 70, 46], 'paint');
      if (o.near && !ruin) for (let k = 0; k < 5; k++) drum(u + Math.cos(a + Math.PI / 2) * M(-0.7 + k * 0.35), w + Math.sin(a + Math.PI / 2) * M(-0.7 + k * 0.35), M(0.1), M(0.45), M(1.05), 6, [196, 156, 70], 'metal');
    }
    // A hooded lamp on a pole, warm, the only light in the pit.
    if (!ruin) {
      const a = Math.PI * 0.75, r = R_IN - 0.03, u = Math.cos(a) * r, w = Math.sin(a) * r;
      drum(u, w, M(0.07), 0, M(3.0), 5, [60, 58, 54], 'metal');
      tbox(u, w, M(0.28), M(0.2), M(2.9), M(3.15), 0, [70, 66, 58], 'metal');
      lamps.push([...T(u, w, M(2.85)), '255,190,110', s === 2 ? 50 : 30, s === 2 ? 0.6 : 0.42, 'work']);
    }
  }

  // ═══ TRUCK ══════════════════════════════════════════════════════════════════
  else {
    disc(0, 0, 0.36, 0.002, 14, pal.floor, 'earth');
    // The dead truck: a cab and a flatbed, laid along the opening's cross axis, on flat tyres.
    const tr = Math.PI / 2 + 0.12;   // the truck's yaw off the opening
    const TL = M(7.0), TW = M(2.3);
    const tc = Math.cos(tr), ts = Math.sin(tr);
    const P = (a, b, z) => T(gu + a * tc - b * ts, gw + a * ts + b * tc, z);
    const box2 = (a0, a1, b0, b1, z0, z1, base, mat, top = base) => {
      const A = P(a0, b0, z0), B = P(a1, b0, z0), C = P(a1, b1, z0), D = P(a0, b1, z0);
      const Ea = P(a0, b0, z1), F = P(a1, b0, z1), G = P(a1, b1, z1), H = P(a0, b1, z1);
      face([Ea, F, G, H], top, mat); face([A, B, F, Ea], base, mat); face([B, C, G, F], base, mat); face([C, D, H, G], base, mat); face([D, A, Ea, H], base, mat);
    };
    const zf = M(0.55);
    box2(-TL / 2, TL / 2, -M(0.45), M(0.45), M(0.35), zf, [40, 38, 36], 'metal');                            // chassis rails
    box2(-TL / 2, TL / 2 - M(2.3), -TW / 2, TW / 2, zf, zf + M(0.18), pal.cabDk, 'metal', pal.cab);           // the bed
    // Bed sides, one dropped open.
    box2(-TL / 2, TL / 2 - M(2.3), TW / 2 - M(0.08), TW / 2, zf + M(0.18), zf + M(0.65), pal.cab, 'metal');
    // The cab, its windscreen gone grey with dust, the door hanging.
    const ca0 = TL / 2 - M(2.25), ca1 = TL / 2;
    box2(ca0, ca1, -TW / 2, TW / 2, zf, zf + M(1.0), pal.cab, 'metal', pal.cabDk);
    box2(ca0 + M(0.1), ca1 - M(0.7), -TW / 2 + M(0.05), TW / 2 - M(0.05), zf + M(1.0), zf + M(1.85), pal.cab, 'metal', pal.cabDk);
    face([P(ca1 - M(0.7), -TW / 2 + M(0.15), zf + M(1.05)), P(ca1 - M(0.7), TW / 2 - M(0.15), zf + M(1.05)),
      P(ca1 - M(0.72), TW / 2 - M(0.15), zf + M(1.75)), P(ca1 - M(0.72), -TW / 2 + M(0.15), zf + M(1.75))], pal.glass, 'glass');
    // Six wheels, sat down on flat tyres.
    for (const a of [-TL / 2 + M(1.1), -TL / 2 + M(2.4), TL / 2 - M(1.2)]) for (const b of [-1, 1]) {
      const n = 8, r = M(0.5), bb = b * (TW / 2 - M(0.1));
      const ring = (off) => { const out = []; for (let i = 0; i < n; i++) { const t = i / n * TAU; out.push(P(a + Math.cos(t) * r, bb + off, Math.max(0.001, M(0.42) + Math.sin(t) * r * 0.85))); } return out; };
      const o1 = ring(-M(0.18)), o2 = ring(M(0.18));
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; face([o1[i], o1[j], o2[j], o2[i]], pal.tyre, 'paint'); }
      face(b > 0 ? o2 : o1, pal.rim, 'metal');
    }
    // Sandbags walled round the bed's three open sides.
    if (o.near) {
      for (let i = 0; i < 6; i++) {
        const a = -TL / 2 - M(0.5), b = -TW / 2 + (i + 0.5) * TW / 6;
        box2(a - M(0.3), a + M(0.3), b - TW / 13, b + TW / 13, 0, M(0.38), i % 2 ? pal.bag : pal.bagDk, 'bag');
        box2(a - M(0.28), a + M(0.28), b - TW / 13, b + TW / 13, M(0.38), M(0.72), i % 2 ? pal.bagDk : pal.bag, 'bag');
      }
      for (let i = 0; i < 8; i++) {
        const a = -TL / 2 + (i + 0.5) * (TL - M(2.3)) / 8, b = -TW / 2 - M(0.45);
        box2(a - TL / 18, a + TL / 18, b - M(0.3), b + M(0.3), 0, M(0.38), i % 2 ? pal.bag : pal.bagDk, 'bag');
      }
    } else {
      box2(-TL / 2 - M(0.8), -TL / 2 - M(0.2), -TW / 2, TW / 2, 0, M(0.72), pal.bag, 'bag');
      box2(-TL / 2, TL / 2 - M(2.3), -TW / 2 - M(0.75), -TW / 2 - M(0.15), 0, M(0.38), pal.bag, 'bag');
    }
    // The gun on its pintle in the bed, traversed by hand.
    const zb = zf + M(0.18), mu = -M(1.2);
    const gpos = P(mu, 0, 0);
    const G0 = (a, l, z) => [gpos[0] + (a * fx + l * lx) * sc, gpos[1] + (a * fy + l * ly) * sc, z * sc];
    // Pintle post.
    {
      const n = 6, r = M(0.14), ring = (z) => { const out = []; for (let i = 0; i < n; i++) { const t = i / n * TAU; out.push(G0(Math.cos(t) * r, Math.sin(t) * r, z)); } return out; };
      const b = ring(zb), t = ring(zb + M(0.95));
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; face([b[i], b[j], t[j], t[i]], pal.gunDk, 'metal'); }
    }
    const zt = zb + M(1.15);
    const Ge = (a, l, z) => {
      const ce = Math.cos(el), se = Math.sin(el), aa = a * ce - (z - zt) * se, zz = zt + a * se + (z - zt) * ce;
      return G0(aa, l, zz);
    };
    gbox(Ge, -M(0.9), M(0.7), -M(0.28), M(0.28), zt - M(0.25), zt + M(0.25), pal.gun, 'metal', pal.gunDk);   // receiver
    gbox(Ge, -M(0.2), M(0.35), M(0.28), M(0.75), zt - M(0.35), zt + M(0.1), [86, 92, 60], 'metal');          // ammo can
    gbox(Ge, -M(1.5), -M(0.9), -M(0.04), M(0.04), zt - M(0.08), zt + M(0.02), [40, 40, 40], 'metal');        // spade grips
    const bl = ruin ? M(1.6) : M(3.6);
    gtube(Ge, M(0.7), bl, 0, zt, M(0.09), M(0.075), 6, pal.barrel, 'metal', [18, 18, 18]);
    if (!ruin) { gtube(Ge, bl, bl + M(0.3), 0, zt, M(0.13), M(0.13), 6, [44, 44, 44], 'metal', [10, 10, 10]); muzzles.push(Ge(bl + M(0.32), 0, zt)); }
    // The buried container beside the truck: its roof flush with the ground, ribbed, a hatch cut in.
    {
      const bu = M(1.0), bw = -0.2, L = M(6.0), W = M(2.4), z0 = 0.002, z1 = M(0.08);
      const c = Math.cos(tr), sn = Math.sin(tr);
      const Q = (a, b, z) => T(bu + a * c - b * sn, bw + a * sn + b * c, z);
      face([Q(-L / 2, -W / 2, z1), Q(L / 2, -W / 2, z1), Q(L / 2, W / 2, z1), Q(-L / 2, W / 2, z1)], pal.box, 'metal');
      face([Q(-L / 2, -W / 2, z0), Q(L / 2, -W / 2, z0), Q(L / 2, -W / 2, z1), Q(-L / 2, -W / 2, z1)], pal.rib, 'metal');
      face([Q(-L / 2, W / 2, z0), Q(L / 2, W / 2, z0), Q(L / 2, W / 2, z1), Q(-L / 2, W / 2, z1)], pal.rib, 'metal');
      if (o.near) for (let k = 0; k < 7; k++) {
        const a = -L / 2 + (k + 0.5) * L / 7;
        face([Q(a - M(0.08), -W / 2, z1), Q(a + M(0.08), -W / 2, z1), Q(a + M(0.08), W / 2, z1 + M(0.04)), Q(a - M(0.08), W / 2, z1 + M(0.04))], pal.rib, 'metal');
      }
      // The hatch, open on its hinge, a dark square below.
      face([Q(M(1.4), -M(0.5), z1 + 0.0008), Q(M(2.4), -M(0.5), z1 + 0.0008), Q(M(2.4), M(0.5), z1 + 0.0008), Q(M(1.4), M(0.5), z1 + 0.0008)], [16, 14, 12], 'paint');
      face([Q(M(1.4), -M(0.5), z1), Q(M(1.4), M(0.5), z1), Q(M(0.6), M(0.5), z1 + M(0.85)), Q(M(0.6), -M(0.5), z1 + M(0.85))], pal.hatch, 'metal');
    }
    // A storm lantern on the cab roof.
    if (!ruin) lamps.push([...P(ca0 + M(0.8), 0, zf + M(2.1)), '255,186,100', s === 2 ? 40 : 22, s === 2 ? 0.55 : 0.45, 'lantern']);
  }

  // ── SCORCH ── a ruin sits in its own burn.
  if (ruin) {
    const pts = [];
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU, r = 0.2 * (0.75 + rnd(i + 70) * 0.5); pts.push(T(Math.cos(a) * r, Math.sin(a) * r, 0.0045)); }
    face(pts, [24, 22, 20], 'earth');
  }

  // ── LIGHT ──
  // After dark the lamps; and whenever it fires, the muzzles, one bore after the other at the rate
  // a twin autocannon cycles. A SAM's flash is the backblast, once, at the start of the burst.
  const lit = night > 0.25 ? 1 : 0.35;
  for (const [x, y, z, rgb, sz, a, what] of lamps) {
    if (what !== 'beacon' && what !== 'status' && night < 0.2) continue;
    o.light(x, y, z, rgb, sz, a * (what === 'beacon' || what === 'status' ? 1 : lit));
  }
  if (o.firing > 0 && !down && muzzles.length) {
    const t = (o.now || 0) / 1000;
    if (kind === 'sam') {
      if (o.firing > 0.75) for (const m of muzzles) o.light(m[0], m[1], m[2], '255,214,150', 90, (o.firing - 0.75) * 4);
    } else {
      const rate = kind === 'flak' ? 2.2 : 8.5;
      const k = Math.floor(t * rate) % muzzles.length, ph = frac(t * rate);
      if (ph < 0.5) { const m = muzzles[k]; o.light(m[0], m[1], m[2], '255,206,120', kind === 'flak' ? 80 : 52, 0.95 * (1 - ph * 2)); }
    }
  }
  return faces;
}

// For the regress and the shapes gate: the aim memory, so a test can start each case clean.
export function _aaResetAim() { AIM.clear(); }
export const AA_KINDS = Object.keys(PAL);
