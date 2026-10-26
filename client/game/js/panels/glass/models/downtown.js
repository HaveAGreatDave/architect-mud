// Downtown Coldwater: building-model arms for the city core, the airfield and Marrow Street.
//
// drawTypeModelArm (windshield.js) picks the arm and runs the shared prologue and detail pass; an arm
// draws only its own building. Every arm takes, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// See docs/reference/world-rendering.md.
import {
  DECO_LIFT, DECO_PULL, DETAIL_LIFT, FACE_EPS, FLAT_OFF, GL_CELLS, MESH_SINK, SHAPE_SINK,
  TILE_REACH, TR, TUNE, WALL_COL, _bladeBasis, awning, bakeSignText, blinkLight, clamp,
  clipToAperture, decoHidden, dish, doorReveal, draw3DBoxAt, drawArmPart, drawBarrelRoof, drawFacetDrum,
  drawGargoyle, drawRing, drawSmoke, dutyPhase, emitDecoFill, emitFace, emitFlat, emitLightRunner, faceAway,
  emitRecessBay, emitSurfaceText, emitWire, facePals, facePt, faceYaw, flatsDropped, frac, glowPool, helideck,
  hoistLine, keptOnCanvas, latticeTower, litStyle, markHidden, marqueeBand, mast, motionOn, motionPhase,
  moveSeg, movingBox, mullions, nearOrMesh, neonBlade, reserveSignBand, rgb, roofClutter, roofCross, shadeOf,
  SIGN_PICTO, slideToPlane, wallBadge, wallDisc, wallRose,
} from '../../windshield.js';
import { state } from '../../../state.js';
import { drawEntrance } from '../entrance.js';

// A halo-lit nameplate: a rim just behind the plate's face (its shadow by day). The bars sit outside
// the plate's outline so they never fight it for depth.
function haloRim(ctx, cam, F, y, hw, z0, z1, t, fill, alpha) {
  const L = (x, z) => { const [wx, wy] = F(x, y); return [wx, wy, z]; };
  const Q = (x0, x1, za, zb) => emitFlat(ctx, cam, [L(x0, zb), L(x1, zb), L(x1, za), L(x0, za)], fill, alpha, { lift: DETAIL_LIFT });
  Q(-hw - t, hw + t, z1, z1 + t); Q(-hw - t, hw + t, z0 - t, z0);
  Q(-hw - t, -hw, z0, z1); Q(hw, hw + t, z0, z1);
}
// ── COLDWATER REGIONAL'S TERMINAL: TWO TILES, ONE BUILDING ─────────────────────────────────────
// `arrivals` and `departures` are the two halves of one terminal; this draws what they share. `side`
// is the partner's local x: −1 for arrivals, +1 for departures. Local +y is airside, −y landside, +x north.
// ⚠ Sized from constants (`TERM`), never fh/h: both roll per tile and the halves wouldn't meet.
// ⚠ Every rectangular box takes `yawE` (or its own run's yaw); `gl:mesh` gates this.
// ⚠ Barrel roofs are unlit mesh faces, so their `base` is scaled by `dusk` to darken at night.
// ⚠ Column colour moves, so it can't be mass (captured once): it lives in per-frame neon and halos.
const TERM = {
  HW: 0.42, D: 0.25, top: 0.46, vault: 0.12,            // the hall, the same on both halves
  linkD: 0.23,                                         // the glazed joint to the tile edge, set back under the fascia
  deckY: -0.31, deckD: 0.11, deckZ0: 0.17, deckZ1: 0.19,
  canY: -0.32, canD: 0.1, canZ0: 0.33, canZ1: 0.342,
  colY: -0.4, colR: 0.016,                             // the kerb's glass columns, inside both slabs' edges
  board: 0.1,                                          // the kerb board's half-width, clear of the columns at ±0.125
};
// One column every quarter tile across both halves. ⚠ None at x = 0: the kerb board hangs there (signfit).
const TERM_COLS = [-0.375, -0.125, 0.125, 0.375];
// One hue per column, rolling down the row. `t` is held still when motion is off, for deterministic captures.
const PYLON_HUES = [[255, 60, 190], [150, 80, 255], [60, 130, 255], [40, 220, 220], [255, 170, 60]];
function pylonRgb(i, t) {
  const u = ((t * 0.00006 + i * 0.12) % 1 + 1) % 1 * PYLON_HUES.length, k = Math.floor(u), f = u - k;
  const a = PYLON_HUES[k], b = PYLON_HUES[(k + 1) % PYLON_HUES.length];
  return `${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0}`;
}
// `o.terrace` gives the half's +x vault up to a flat roof for the crown to stand on (arrivals).
function terminalHalf(ctx, cam, dx, dy, fh, h, seed, night, alpha, now, E, F, o) {
  const yawE = faceYaw(E), dusk = 1 - 0.72 * (night ? clamp(night, 0, 1) : 0);
  const { HW, D, top, vault } = TERM, { side } = o;
  const AIR = { air: true };
  const roofRgb = [204 * dusk, 210 * dusk, 216 * dusk];
  draw3DBoxAt(ctx, cam, dx, dy, HW, 0, top, 'ty_arrivals', seed, night, alpha, false, yawE, D);
  // The wave roof: three vaults to the half; on arrivals the north one is the crown's terrace.
  for (const k of [-1, 0, 1]) {
    if (k === 1 && o.terrace) continue;
    drawBarrelRoof(ctx, cam, F, k * HW * 2 / 3, HW / 3, D * 1.14, top, vault, 8, alpha, roofRgb);
  }
  if (o.terrace) { const [tx, ty] = F(HW * 2 / 3, 0);
    draw3DBoxAt(ctx, cam, tx, ty, HW / 3, top, top + 0.012, 'ty_precast', seed + 61, night, alpha, true, yawE, D + 0.01); }
  // The joint to the tile edge: a glazed slot set back under the fascia.
  const jx = side * (HW + 0.5) / 2, jw = (0.5 - HW) / 2;
  { const [kx, ky] = F(jx, 0);
    draw3DBoxAt(ctx, cam, kx, ky, jw, 0, top, 'ty_tower_slot', seed + 30, night, alpha, false, yawE, TERM.linkD);
    draw3DBoxAt(ctx, cam, kx, ky, jw, top, top + 0.012, 'ty_precast_dk', seed + 31, night, alpha, true, yawE, D + 0.01); }
  // Glass, fascia, mullions and transom on both faces. ⚠ The glass is an unlit face holding a warm fill
  // at night. Same faces day and night (the captures pair face for face in gl/world.js); only colour moves.
  const glassFill = night ? 'rgb(236,198,138)' : 'rgb(78,112,128)';
  const jointFill = night ? 'rgb(214,170,112)' : 'rgb(58,86,100)';
  const gz0 = 0.014, gz1 = top * 0.84;
  for (const s of [1, -1]) {
    const [ox, oy] = F(0, 0), [sx, sy] = F(0, s), out = [sx - ox, sy - oy, 0];
    const G = (x, y, z) => { const [wx, wy] = F(x, y); return [wx, wy, z]; };
    const gy = s * (D + 0.003), jy = s * (TERM.linkD + 0.003);
    emitFlat(ctx, cam, outFace([G(-HW * 0.94, gy, gz0), G(HW * 0.94, gy, gz0), G(HW * 0.94, gy, gz1), G(-HW * 0.94, gy, gz1)], out), glassFill, alpha);
    emitFlat(ctx, cam, outFace([G(side * HW, jy, gz0), G(side * 0.5, jy, gz0), G(side * 0.5, jy, gz1), G(side * HW, jy, gz1)], out), jointFill, alpha);
    const [lx, ly] = F(0, s * (D + 0.006)), [bx, by] = F(jx, s * (D + 0.006));
    draw3DBoxAt(ctx, cam, lx, ly, HW, top * 0.87, top, 'ty_airport_band', seed + (s > 0 ? 2 : 22), night, alpha, false, yawE, 0.005);
    draw3DBoxAt(ctx, cam, bx, by, jw, top * 0.87, top, 'ty_airport_band', seed + (s > 0 ? 3 : 23), night, alpha, false, yawE, 0.005);
    for (let i = -4; i <= 4; i++) {
      const [mx, my] = F(i * HW * 0.2, s * (D + 0.008));
      emitWire(ctx, cam, [mx, my, gz0], [mx, my, gz1], 1, 'rgba(30,36,44,0.85)', alpha, { pull: DECO_PULL });
    }
    const [t0x, t0y] = F(-HW * 0.94, s * (D + 0.008)), [t1x, t1y] = F(HW * 0.94, s * (D + 0.008));
    emitWire(ctx, cam, [t0x, t0y, top * 0.45], [t1x, t1y, top * 0.45], 1.4, 'rgba(36,42,50,0.9)', alpha, { pull: DECO_PULL });
  }
  if (night) for (const s of [1, -1]) { const [gx, gy] = F(0, s * (D + 0.02)); glowPool(ctx, cam, gx, gy, top * 0.5, '255,222,166', 30, alpha * 0.3, AIR); }
  // The landside kerb: deck and canopy, two boxes each because a box is never wider than 0.44.
  const kEnd = -side * HW;
  for (const [x, hw] of [[side * 0.25, 0.25], [kEnd / 2, HW / 2]]) {
    const [cx, cy] = F(x, TERM.deckY);
    draw3DBoxAt(ctx, cam, cx, cy, hw, TERM.deckZ0, TERM.deckZ1, 'ty_precast_dk', seed + 50, night, alpha, true, yawE, TERM.deckD);
    const [ux, uy] = F(x, TERM.canY);
    draw3DBoxAt(ctx, cam, ux, uy, hw, TERM.canZ0, TERM.canZ1, 'ty_precast', seed + 51, night, alpha, true, yawE, TERM.canD);
  }
  { const ey = TERM.deckY - TERM.deckD - 0.002, [a0x, a0y] = F(kEnd, ey), [a1x, a1y] = F(side * 0.5, ey);
    emitWire(ctx, cam, [a0x, a0y, TERM.deckZ1], [a1x, a1y, TERM.deckZ1], 2, 'rgba(80,236,255,0.95)', alpha, { pull: DECO_PULL });
    emitWire(ctx, cam, [a0x, a0y, TERM.canZ1 + 0.002], [a1x, a1y, TERM.canZ1 + 0.002], 1.6, 'rgba(255,236,200,0.9)', alpha, { pull: DECO_PULL });
    if (night) { const [mx, my] = F(0, -0.36);
      glowPool(ctx, cam, mx, my, TERM.deckZ0 * 0.5, '255,214,150', 22, alpha * 0.4);          // the arrivals kerb, under the deck
      glowPool(ctx, cam, mx, my, TERM.canZ0 - 0.02, '255,236,200', 20, alpha * 0.3, AIR); } }  // the canopy's soffit lights
  // The kerb board under the canopy. From the landside, local +x is on the reader's left.
  if (o.kerb) {
    const by = -0.425, bz0 = TERM.canZ0 - 0.046, bz1 = TERM.canZ0 - 0.006, bw = TERM.board;
    const [bx, bby] = F(0, by);
    draw3DBoxAt(ctx, cam, bx, bby, bw, bz0, bz1, 'ty_airport_band', seed + 52, night, alpha, true, yawE, 0.004);
    const tex = bakeSignText(o.kerb, night ? '#ffe4a8' : '#f4f6f8', night ? 1 : 0, false);
    const P = (x, z) => { const [wx, wy] = F(x, by - 0.006); return cam.proj(wx, wy, z); };
    const q = [P(bw * 0.9, bz1 - 0.006), P(-bw * 0.9, bz1 - 0.006), P(-bw * 0.9, bz0 + 0.006), P(bw * 0.9, bz0 + 0.006)];
    if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha);
  }
  // The kerb columns, in two lengths that stop at the slabs. ⚠ Keep them below the hall: taller ones
  // show over the vaults from the runway.
  const t = motionOn() ? (now || 0) : 0;
  const colBody = (f) => night ? 'rgb(206,200,222)' : `rgb(${200 + f.nl * 40 | 0},${206 + f.nl * 38 | 0},${214 + f.nl * 36 | 0})`;
  const [o0x, o0y] = F(0, 0), [olx, oly] = F(0, -1), ol = Math.hypot(olx - o0x, oly - o0y) || 1;
  const ux = (olx - o0x) / ol, uy = (oly - o0y) / ol;   // world direction out over the kerb
  TERM_COLS.forEach((px, i) => {
    const [cx, cy] = F(px, TERM.colY), r = TERM.colR;
    drawFacetDrum(ctx, cam, cx, cy, 0, TERM.deckZ0, r, r, 8, alpha, colBody, null, 'ty_atc_white');
    drawFacetDrum(ctx, cam, cx, cy, TERM.deckZ1, TERM.canZ0, r, r, 8, alpha, colBody, null, 'ty_atc_white');
    if (!night) return;
    const rgbP = pylonRgb((side < 0 ? 4 : 0) + i, t);   // departures' four, then arrivals' four, south to north
    for (const a of [-0.6, 0.6]) {   // two tubes up the kerb face of each length
      const c = Math.cos(a), s = Math.sin(a), wx = cx + (ux * c - uy * s) * r * 1.05, wy = cy + (ux * s + uy * c) * r * 1.05;
      emitWire(ctx, cam, [wx, wy, 0.008], [wx, wy, TERM.deckZ0 - 0.004], 2, `rgba(${rgbP},0.85)`, alpha, { pull: DECO_PULL });
      emitWire(ctx, cam, [wx, wy, TERM.deckZ1 + 0.004], [wx, wy, TERM.canZ0 - 0.004], 2, `rgba(${rgbP},0.85)`, alpha, { pull: DECO_PULL });
    }
    glowPool(ctx, cam, cx, cy, TERM.deckZ0 * 0.5, rgbP, 12, alpha * 0.45, AIR);
    glowPool(ctx, cam, cx, cy, (TERM.deckZ1 + TERM.canZ0) / 2, rgbP, 12, alpha * 0.4, AIR);
    glowPool(ctx, cam, cx, cy, 0.01, rgbP, 14, alpha * 0.25);   // and it washes the kerb at its foot
  });
  // Cyan neon under the airside fascia, the joint included.
  if (o.frontVis) { const fz = top * 0.855, [b0x, b0y] = F(-0.5, D + 0.008), [b1x, b1y] = F(0.5, D + 0.008);
    emitWire(ctx, cam, [b0x, b0y, fz], [b1x, b1y, fz], 2, 'rgba(80,236,255,0.95)', alpha, { pull: DECO_PULL });
    if (night) glowPool(ctx, cam, (b0x + b1x) / 2, (b0y + b1y) / 2, fz, '80,236,255', 18, alpha * 0.3, AIR); }
  return { yawE, dusk, t };
}

// Raised capitals on the airside fascia band itself. ⚠ Don't use a `marqueeBand`: it's taller than the fascia.
function fasciaLettering(ctx, cam, F, text, night, alpha) {
  const { D, top } = TERM, y = D + 0.012, hw = TERM.HW * 0.9, zt = top - 0.008, zb = top * 0.87 + 0.008;
  const quad = (ox, oz) => { const yy = y + (ox ? 0.001 : 0.002), sx = ox * 0.003, sz = oz * 0.002;
    const [lx, ly] = F(-hw + sx, yy), [rx, ry] = F(hw + sx, yy);
    return [cam.proj(lx, ly, zt + sz), cam.proj(rx, ry, zt + sz), cam.proj(rx, ry, zb + sz), cam.proj(lx, ly, zb + sz)]; };
  embossText(ctx, cam, quad, text, night ? '#ffe9bc' : '#f2f7f8', '#0b1c22', night, alpha, { font: 'condensed' });
}

// A stowed jet bridge. `x0` is where it leaves the hall, `s` which way it runs. It stays inside the
// tile, which `tileFitBox` trims at 0.5.
function jetBridge(ctx, cam, F, x0, s, seed, night, alpha) {
  const { D } = TERM;
  const [rx, ry] = F(x0, D + 0.03);
  drawFacetDrum(ctx, cam, rx, ry, 0, 0.17, 0.03, 0.03, 8, alpha,
    (f) => night ? 'rgb(150,150,146)' : `rgb(${170 + f.nl * 50 | 0},${172 + f.nl * 50 | 0},${170 + f.nl * 48 | 0})`, () => night ? 'rgb(120,122,124)' : 'rgb(196,198,198)', 'ty_atc_white');
  const th = 58 * Math.PI / 180, ux = s * Math.sin(th), uy = Math.cos(th), L = 0.2;
  const P = (a) => F(x0 + ux * a, D + 0.03 + uy * a);
  const [c0x, c0y] = P(0.03), [c1x, c1y] = P(0.03 + L);
  const yaw = faceYaw([c1x - c0x, c1y - c0y]);
  const [tx, ty] = P(0.03 + L / 2);
  draw3DBoxAt(ctx, cam, tx, ty, 0.022, 0.115, 0.155, 'ty_atc_white', seed, night, alpha, true, yaw, L / 2);
  const cl = Math.hypot(c1x - c0x, c1y - c0y) || 1, nx = -(c1y - c0y) / cl * 0.0235, ny = (c1x - c0x) / cl * 0.0235;
  for (const k of [1, -1]) emitWire(ctx, cam, [c0x + nx * k, c0y + ny * k, 0.133], [c1x + nx * k, c1y + ny * k, 0.133], 1.6, 'rgba(80,236,255,0.9)', alpha, { pull: DECO_PULL });
  const [kx, ky] = P(0.03 + L + 0.02);
  draw3DBoxAt(ctx, cam, kx, ky, 0.03, 0.105, 0.165, 'ty_atc_steel', seed + 1, night, alpha, true, yaw, 0.022);
  // The drive bogie three-quarters out: two legs and the wheel box on the apron.
  const [bx, by] = P(0.03 + L * 0.75);
  for (const o of [-0.016, 0.016]) { const lx = bx - uy * o * s, ly = by + ux * o * s;
    emitWire(ctx, cam, [lx, ly, 0.008], [lx, ly, 0.115], 1.6, 'rgba(120,126,132,0.95)', alpha, { pull: DECO_PULL }); }
  draw3DBoxAt(ctx, cam, bx, by, 0.02, 0, 0.012, 'ty_atc_steel', seed + 2, night, alpha, true, yaw, 0.012);
  if (night) glowPool(ctx, cam, kx, ky, 0.1, '255,214,150', 10, alpha * 0.4);   // the cab's floodlight on the stand
}

// A quad turned so its Newell normal agrees with `want`: emitFlat lights a face off its winding.
function outFace(q, want) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * want[0] + ny * want[1] + nz * want[2] < 0 ? q.slice().reverse() : q;
}

// The arrivals crown: a saucer on a lift core under two crossed parabolic arches, on the roof terrace.
// `x0` is its centre along the terminal. ⚠ Keep the arch feet on the terrace, never the ground.
// ⚠ The saucer is sized to clear the arches (0.03 at the rim): change one and check the other.
const CROWN = { a: 0.1, b: 0.205, rise: 0.6, rib: 0.013, core: 0.028, coreH: 0.27, R: 0.105 };
function observationCrown(ctx, cam, F, x0, seed, night, alpha, t) {
  const dusk = 1 - 0.7 * (night ? clamp(night, 0, 1) : 0);
  const zf = TERM.top + 0.012;   // the terrace's deck
  const [cx, cy] = F(x0, 0);
  const plain = (r, g, b) => litStyle((f) => { const s = (0.62 + f.nl * 0.4) * dusk; return `rgb(${r * s | 0},${g * s | 0},${b * s | 0})`; }, [r * dusk, g * dusk, b * dusk], 'plain');
  const glass = (f) => night ? 'rgb(255,206,140)' : `rgb(${40 + f.nl * 50 | 0},${86 + f.nl * 60 | 0},${100 + f.nl * 54 | 0})`;
  const { R } = CROWN, zc = zf + CROWN.coreH, zr = zc + 0.06, zg = zr + 0.012 + 0.04, zt = zg + 0.03;
  drawFacetDrum(ctx, cam, cx, cy, zf, zc, CROWN.core, CROWN.core, 10, alpha, plain(226, 228, 224), undefined, 'ty_atc_white');
  drawFacetDrum(ctx, cam, cx, cy, zc, zr, CROWN.core, R, 16, alpha, plain(226, 228, 224), undefined, 'ty_atc_white');
  drawFacetDrum(ctx, cam, cx, cy, zr, zr + 0.012, R + 0.006, R + 0.006, 16, alpha, plain(236, 238, 234), undefined, 'ty_atc_white');
  drawFacetDrum(ctx, cam, cx, cy, zr + 0.012, zg, R * 0.94, R * 0.86, 16, alpha, glass, undefined, 'ty_atc_glass');
  drawFacetDrum(ctx, cam, cx, cy, zg, zt, R * 0.86, R * 0.36, 16, alpha, plain(226, 228, 224), plain(236, 238, 234), 'ty_atc_white');
  // The terrace's balustrade.
  { const W3 = (x, y, z) => { const [wx, wy] = F(x, y); return [wx, wy, z]; };
    const x1 = x0 - TERM.HW / 3 + 0.012, x2 = x0 + TERM.HW / 3 - 0.006, yb = TERM.D - 0.008, zr2 = zf + 0.03;
    const rail = [[x1, -yb], [x2, -yb], [x2, yb], [x1, yb]];
    for (let i = 0; i < 3; i++) emitWire(ctx, cam, W3(...rail[i], zr2), W3(...rail[i + 1], zr2), 1.2, 'rgba(206,230,236,0.85)', alpha, { pull: DECO_PULL });
    for (const [px, py] of rail) emitWire(ctx, cam, W3(px, py, zf), W3(px, py, zr2), 1, 'rgba(150,160,168,0.9)', alpha, { pull: DECO_PULL }); }
  // The two arches, each a box-section rib on a parabola from foot to foot, crossing at the finial.
  const peak = zf + 0.02 + CROWN.rise, N = 12, half = CROWN.rib;
  for (const sx of [-1, 1]) {
    const A = [x0 - sx * CROWN.a, -CROWN.b], B = [x0 + sx * CROWN.a, CROWN.b];
    const at = (u) => { const lx = A[0] + (B[0] - A[0]) * u, ly = A[1] + (B[1] - A[1]) * u; const [wx, wy] = F(lx, ly); return [wx, wy, zf + 0.02 + CROWN.rise * (1 - (2 * u - 1) ** 2)]; };
    const [ax, ay] = F(A[0], A[1]), [bx2, by2] = F(B[0], B[1]);
    const run = Math.hypot(bx2 - ax, by2 - ay) || 1, nx = -(by2 - ay) / run * half, ny = (bx2 - ax) / run * half;
    const Hx = (bx2 - ax) / run, Hy = (by2 - ay) / run;
    // A shoe at each foot, so a rib lands on something rather than on the deck's paint.
    for (const [fx, fy] of [[ax, ay], [bx2, by2]]) drawFacetDrum(ctx, cam, fx, fy, zf, zf + 0.022, 0.02, 0.016, 8, alpha, plain(176, 182, 186), plain(196, 200, 204), 'ty_atc_steel');
    // ⚠ Ribs are unlit faces holding a floodlit fill at night; same face count day and night.
    const RIB = night ? [214, 206, 240] : [232, 234, 230];
    const css = (k2) => `rgb(${RIB[0] * k2 | 0},${RIB[1] * k2 | 0},${RIB[2] * k2 | 0})`;
    for (let k = 0; k < N; k++) {
      const p = at(k / N), q = at((k + 1) / N);
      const l = (v, s2, dz = 0) => [v[0] + nx * s2, v[1] + ny * s2, v[2] + dz];
      // Flanks and back, each turned to face out (emitFlat reads the normal off the winding).
      const Th = (q[0] - p[0]) * Hx + (q[1] - p[1]) * Hy, Tz = q[2] - p[2];
      emitFlat(ctx, cam, outFace([l(p, 1), l(q, 1), l(q, 1, -0.02), l(p, 1, -0.02)], [nx, ny, 0]), css(1), alpha, { cullN: [nx, ny] });
      emitFlat(ctx, cam, outFace([l(p, -1), l(q, -1), l(q, -1, -0.02), l(p, -1, -0.02)], [-nx, -ny, 0]), css(0.86), alpha, { cullN: [-nx, -ny] });
      emitFlat(ctx, cam, outFace([l(p, -1), l(q, -1), l(q, 1), l(p, 1)], [-Tz * Hx, -Tz * Hy, Th]), css(0.95), alpha);
    }
    if (night) {
      const rgbA = pylonRgb(sx < 0 ? 8 : 9, t);
      for (const u of [0.14, 0.86]) { const p = at(u); glowPool(ctx, cam, p[0], p[1], p[2], rgbA, 14, alpha * 0.4, { air: true }); }
      const pk = at(0.5); glowPool(ctx, cam, pk[0], pk[1], pk[2] - 0.04, rgbA, 12, alpha * 0.3, { air: true });
    }
  }
  // The finial where the ribs cross, and the obstruction light on it.
  drawFacetDrum(ctx, cam, cx, cy, peak - 0.024, peak + 0.012, 0.018, 0.008, 8, alpha, plain(214, 218, 220), plain(236, 238, 234), 'ty_atc_steel');
  if (night) {
    glowPool(ctx, cam, cx, cy, (zr + zg) / 2, '255,206,140', 18, alpha * 0.45, { air: true });   // the deck's windows, lit
    blinkLight(ctx, cam, cx, cy, peak + 0.018, '255,60,50', t, seed + 5, alpha, 1.6);
  }
}

// Raised lettering: a dark copy offset under the face as its shadow. `quad(dx, dz)` returns the
// projected corners at that offset in plate units.
function embossText(ctx, cam, quad, text, face, shadow, night, alpha, opts) {
  const sh = bakeSignText(text, shadow, 0, false, true, undefined, opts);
  const fc = bakeSignText(text, face, night ? 1 : 0, false, true, undefined, opts);
  const S = quad(1, -1), Fq = quad(0, 0);
  if (sh && S.every((p) => p.f > 0.065)) emitSurfaceText(ctx, cam, S, sh, false, alpha * 0.85);
  if (fc && Fq.every((p) => p.f > 0.065)) emitSurfaceText(ctx, cam, Fq, fc, false, alpha);
}

// ── THE CLONE FACILITY AND SECOND HELPINGS SHARE A MAIN AND A CLOCK ───────────────────────────
// Both arms read this, so the slug leaving the vats is the one climbing the riser next door.
// ⚠ The main's plan position is in tiles, never fh: each tile rolls its own footprint. `ly` is its
// offset in front of centre; `end` is where it stops (inside the party wall) in the clone's frame.
export const GUT = {
  ly: 0.49, r: 0.026, end: 0.60,
  wall: { lx: -0.40, half: 0.045, front: 0.53, back: -0.36 },   // Second Helpings' frame
  seed: 70.31, period: 60000,
};
// The shared minute: 0–0.30 print, 0.30–0.40 doors open, 0.34–0.62 the slug runs (clone side to
// 0.52, then the riser). −1 when parked: every reader draws the still pose.
export function gutPhase(now) { return motionPhase(now, GUT.seed, GUT.period, 1); }
const ease = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

// Turns a polygon so its Newell normal (as `emitFlat` computes it) points along `out`.
function facing(q, out) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * out[0] + ny * out[1] + nz * out[2] < 0 ? q.slice().reverse() : q;
}
// A round tube of `N` lit facets in the model's frame. `dusk` darkens the albedo: a pale lit face sits
// above the shader's night-dim cutoff.
export function tubeRun(ctx, cam, W3, A, B, r, N, col, fam, alpha, dusk) {
  if (SHAPE_SINK || flatsDropped()) return;   // every facet is a plain lit flat, which GLASS 2's mesh already has
  let dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const L = Math.hypot(dx, dy, dz);
  if (!(L > 1e-6)) return;
  dx /= L; dy /= L; dz /= L;
  // Two axes across the tube: d×z for anything that isn't vertical, d×x for anything that is.
  let ux = dy, uy = -dx, uz = 0;
  if (Math.abs(dz) > 0.9) { ux = 0; uy = dz; uz = -dy; }
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const at = (P, a) => { const c = Math.cos(a) * r, s = Math.sin(a) * r; return W3(P[0] + c * ux + s * vx, P[1] + c * uy + s * vy, P[2] + c * uz + s * vz); };
  const A0 = W3(A[0], A[1], A[2]);
  const alb = [col[0] * dusk, col[1] * dusk, col[2] * dusk];
  for (let k = 0; k < N; k++) {
    const a0 = k / N * 6.2832, a1 = (k + 1) / N * 6.2832, m = at(A, (a0 + a1) / 2);
    const ox = m[0] - A0[0], oy = m[1] - A0[1], oz = m[2] - A0[2], ol = Math.hypot(ox, oy, oz) || 1;
    const q = facing([at(A, a0), at(B, a0), at(B, a1), at(A, a1)], [ox, oy, oz]);
    // The same key light as `drawFacetDrum`.
    const k2 = clamp(0.64 + 0.28 * oz / ol - 0.14 * (ox + oy) / ol, 0.32, 1.12);
    emitFlat(ctx, cam, q, rgb([alb[0] * k2, alb[1] * k2, alb[2] * k2]), alpha,
      { lit: fam, albedo: alb, lift: DETAIL_LIFT, cullN: Math.abs(oz / ol) < 0.8 ? [ox, oy] : undefined });
  }
}
// The slug: the stretch of `path` between distances d0 and d1, as a bright line. ⚠ Keep the line:
// a green glow alone vanishes on green glass by day. `pull` brings it out through the tube wall.
export function slugLine(ctx, cam, W3, path, d0, d1, night, alpha) {
  const pts = [];
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const lo = Math.max(d0, run), hi = Math.min(d1, run + L);
    if (hi > lo && L > 0) {
      const p = (d) => { const t = (d - run) / L; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
      if (!pts.length) pts.push(p(lo));
      pts.push(p(hi));
    }
    run += L;
  }
  for (let i = 1; i < pts.length; i++) {
    emitWire(ctx, cam, W3(...pts[i - 1]), W3(...pts[i]), 5, 'rgba(190,255,204,0.95)', alpha,
      { pull: 0.03, glow: night ? 8 : 0, glowCss: 'rgb(120,255,170)' });
  }
}
// A lit band round the near half of a drum. ⚠ Not `drawRing`: its DECO_PULL drags the back half out
// round the silhouette (`glself`).
function frontRing(ctx, cam, cx, cy, z, r, N, css, lw, alpha) {
  for (let i = 0; i < N; i++) {
    const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832;
    // faceAway, so a kept building knows when the facing arc changes (ARM_FACE in windshield.js).
    const away = (a) => { const nx = Math.cos(a), ny = Math.sin(a); return faceAway(cam, cx + nx * r, cy + ny * r, nx, ny); };
    if (away(a0) || away(a1)) continue;   // turned away, or on the silhouette
    emitWire(ctx, cam, [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z], lw, css, alpha, { pull: 0.01 });
  }
}
// A flat face in the model's own frame, turned to face `out` (a local direction).
export function flatOut(ctx, cam, W3, pts, out, fill, alpha, opts = {}) {
  if (SHAPE_SINK) return;
  const O = W3(0, 0, 0), D = W3(out[0], out[1], out[2]);
  const o = [D[0] - O[0], D[1] - O[1], D[2] - O[2]];
  emitFlat(ctx, cam, facing(pts.map((p) => W3(p[0], p[1], p[2])), o), fill, alpha,
    Object.assign({ lift: DETAIL_LIFT, cullN: Math.abs(o[2]) < 0.8 ? [o[0], o[1]] : undefined }, opts));
}
// A body seen through frosted glass: floating (0), adrift (1) or standing in a doorway (2). Baked
// per pose and day/night, painted as a decal. ⚠ Drawn opaque as one outline, alpha applied once, so
// overlaps don't darken. ⚠ The blur is a manual box blur: canvas `filter` isn't in every browser.
const _cloneBody = new Map();
const CLONE_TORSO = [[17, 23], [23, 23], [28, 25.5], [28.5, 31], [26, 43], [27, 52], [20, 57], [13, 52], [14, 43], [11.5, 31], [12, 25.5]];
const CLONE_POSES = [
  // head [x, y, rx, ry, tilt], neck [x0, y0, x1, y1], arm and leg [root, elbow or knee, hand or ankle]
  { head: [20, 14.5, 4.6, 5.4, 0], neck: [20, 18, 20, 23], dy: 0,                   // floating, head bowed, arms off the sides
    arms: [[12.5, 27, 8, 43, 7, 58], [27.5, 27, 32, 43, 33, 58]],
    legs: [[16, 53, 16.5, 75, 17.5, 97], [24, 53, 23.5, 75, 22.5, 97]] },
  { head: [18.3, 14.5, 4.6, 5.6, -0.35], neck: [19.4, 18.5, 20, 23], dy: 0,         // head fallen aside, arms lifted, a knee drawn up
    arms: [[12.5, 27, 5.5, 39, 4.5, 52], [27.5, 27, 34, 37, 35.5, 50]],
    legs: [[16, 53, 14.5, 74, 16, 95], [24, 53, 25.5, 70, 24, 86]] },
  { head: [20, 9.5, 4.6, 5.6, 0], neck: [20, 13, 20, 19], dy: -4,                   // standing, arms at the sides
    arms: [[12.5, 23, 10, 39, 10, 55], [27.5, 23, 30, 39, 30, 55]],
    legs: [[16, 49, 15.5, 74, 15, 100], [24, 49, 24.5, 74, 25, 100]] },
];
function cloneBodyTex(pose, night) {
  const key = pose * 2 + (night ? 1 : 0);
  let c = _cloneBody.get(key);
  if (c) return c;
  const sheet = () => { const s = document.createElement('canvas'); s.width = 80; s.height = 208; return s; };
  c = sheet();
  const g = c.getContext('2d');
  if (g) {
    g.scale(2, 2);   // drawn in a 40 × 104 frame
    const ink = pose === 2 ? 'rgb(12,20,24)' : (night ? 'rgb(10,48,40)' : 'rgb(20,60,52)');
    g.fillStyle = ink; g.strokeStyle = ink;
    const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };
    const limb = (ax, ay, ra, bx, by, rb) => {
      const L = Math.hypot(bx - ax, by - ay) || 1, nx = (ay - by) / L, ny = (bx - ax) / L;
      g.beginPath();
      g.moveTo(ax + nx * ra, ay + ny * ra); g.lineTo(bx + nx * rb, by + ny * rb);
      g.lineTo(bx - nx * rb, by - ny * rb); g.lineTo(ax - nx * ra, ay - ny * ra); g.closePath(); g.fill();
      dot(ax, ay, ra); dot(bx, by, rb);
    };
    const P = CLONE_POSES[pose], [hx, hy, hrx, hry, tilt] = P.head;
    g.beginPath(); g.ellipse(hx, hy, hrx, hry, tilt, 0, 6.2832); g.fill();
    limb(P.neck[0], P.neck[1], 2.1, P.neck[2], P.neck[3], 2.5);
    g.beginPath(); CLONE_TORSO.forEach(([x, y], i) => (i ? g.lineTo(x, y + P.dy) : g.moveTo(x, y + P.dy))); g.closePath(); g.fill();
    for (const [sx, sy, ex, ey, wx, wy] of P.arms) {
      limb(sx, sy, 2.7, ex, ey, 1.9); limb(ex, ey, 1.9, wx, wy, 1.4);
      g.beginPath(); g.ellipse(wx, wy + 1.5, 1.6, 2.6, 0, 0, 6.2832); g.fill();
    }
    for (const [rx, ry, kx, ky, ax, ay] of P.legs) { limb(rx, ry, 3.8, kx, ky, 2.5); limb(kx, ky, 2.5, ax, ay, 1.5); }
    if (pose !== 2) {   // the feed line, up from the vat's foot to the navel
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(6, 104); g.bezierCurveTo(8, 80, 20, 66, 20, 47); g.stroke();
    }
    // The fog: 3 px in the vats, 1 in the doorway.
    const r = pose === 2 ? 1 : 3;
    for (let pass = 0; pass < 4; pass++) {
      const out = sheet(), o = out.getContext('2d');
      o.globalCompositeOperation = 'lighter'; o.globalAlpha = 1 / (2 * r + 1);
      for (let d = -r; d <= r; d++) o.drawImage(c, pass & 1 ? 0 : d, pass & 1 ? d : 0);
      c = out;
    }
    // Densest at the chest. ⚠ Reset `globalAlpha` first: the last blur pass left it at 1/7.
    const m = c.getContext('2d');
    m.globalAlpha = 1; m.globalCompositeOperation = 'destination-in';
    const a = pose === 2 ? [0.92, 0.92, 0.85] : night ? [0.48, 0.72, 0.15] : [0.46, 0.72, 0.12];
    const gr = m.createLinearGradient(0, 0, 0, 208);
    gr.addColorStop(0, `rgba(0,0,0,${a[0]})`); gr.addColorStop(0.4, `rgba(0,0,0,${a[1]})`); gr.addColorStop(1, `rgba(0,0,0,${a[2]})`);
    m.fillStyle = gr; m.fillRect(0, 0, 80, 208);
    m.globalCompositeOperation = 'source-over';
  }
  c._lit = 0;
  _cloneBody.set(key, c);
  return c;
}

// The Halcyon seal. ⚠ Baked here because `bakeSignText` no longer draws pictograms.
const _seal = [null, null];
function haloSealTex(night) {
  const k = night ? 1 : 0;
  if (_seal[k]) return _seal[k];
  const S = 96, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  if (g) {
    const ink = '#7fe8d2';
    g.fillStyle = '#10202a'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.47, 0, 6.2832); g.fill();
    g.lineWidth = S * 0.035; g.strokeStyle = ink; g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1;
    g.save(); g.translate(S / 2, S / 2); g.scale(S * 0.78, S * 0.78);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = ink; g.lineWidth = 5 / (S * 0.78);
    g.shadowColor = ink; g.shadowBlur = night ? 8 : 0;
    g.beginPath(); SIGN_PICTO.eye(g); g.stroke();
    g.shadowBlur = 0; g.stroke();
    g.restore();
  }
  c._lit = k;
  _seal[k] = c;
  return c;
}

// ── THE COLDWATER PALAIS: THREE TILES, ONE BUILDING ────────────────────────────────────────────
// West to east on Meltwater Row: `palais_foyer`, `palais_stage`, `palais_bar`, all facing north.
// ⚠ Sized from constants, never fh/h, for TERM's reason.
// ⚠ `X` runs along the street: 0 is the stage tile's middle, +X is local +x (west); a tile's centre
// is X = off (1, 0, −1), so a part at X lands at lx = X − off.
// ⚠ Every non-square box takes `yaw` and `fd` (gl:mesh).
// ⚠ No face exists by night only (the night mesh pairs face for face); strokes and glows may.
const PAL = {
  front: 0.30,                                            // the wall plane on the street; the pavement runs on to the plot line
  // the foyers
  wHW: 0.42, wBack: -0.36, podium: 0.20, course: 0.215, wTop: 0.56, cornice: 0.585, atticTop: 0.63, atticHW: 0.34,
  drumX: 0.34, drumY: 0.19, drumR: 0.11, drumTop: 0.70,
  doorX: 0.10, doorW: 0.075, doorTop: 0.15,              // the door stands doorX in from the foyer's centre, toward the stage
  // the auditorium, its frontispiece and the stage house behind it
  aBack: -0.08, aTop: 0.62,
  fHW: 0.17, fBack: 0.24, fFront: 0.34, fTop: 0.84,
  tHW: 0.32, tFront: -0.06, tBack: -0.42, tTop: 1.04,
  // the blade, standing off the frontispiece on the centre line
  bladeT: 0.012, bladeOut: 0.13, bladeZ0: 0.32, bladeZ1: 1.0,
  // the marquee across the stage tile's foot
  mHW: 0.40, mFront: 0.47, mZ0: 0.21, mZ1: 0.27,
};
const PAL_STONE = 'ty_palais_stone', PAL_TRIM = 'ty_archive_col', PAL_BRONZE = 'ty_meridian_bronze', PAL_COPPER = 'ty_verdigris';
const PAL_PINK = '255,122,184';   // the blade's tube and the drums' top ring only
// The tile's kit: boxes, faces and points placed on the building's own X (see PAL).
function palaisKit(ctx, cam, F, W3, E, off, seed, night, alpha) {
  const yaw = faceYaw(E), dn = night ? clamp(+night, 0, 1) : 0;
  const B = (X, y, hw, fd, z0, z1, p, s, roof = true) => {
    const [bx, by] = F(X - off, y);
    draw3DBoxAt(ctx, cam, bx, by, hw, z0, z1, p, seed + s, night, alpha, roof, yaw, fd);
  };
  const P = (X, y, z) => [X - off, y, z];
  // A face that holds `day` by day and `lit` after dark: glass, a poster, the marquee's panel.
  const glow = (pts, out, day, lit) => flatOut(ctx, cam, W3, pts.map(([X, y, z]) => P(X, y, z)), out,
    rgb([0, 1, 2].map((i) => day[i] + (lit[i] - day[i]) * dn)), alpha);
  // A painted face that takes the dusk with the stone round it: a frame, a door, a ground.
  const paint = (pts, out, c) => flatOut(ctx, cam, W3, pts.map(([X, y, z]) => P(X, y, z)), out,
    rgb(c.map((v) => v * (1 - 0.55 * dn))), alpha);
  const at = (X, y) => F(X - off, y);
  return { yaw, dn, B, P, glow, paint, at };
}
// A lit poster case on the face plane `y`, facing the street.
function palaisPoster(k, X, y, hw, z0, z1) {
  const out = [0, 1, 0], f = 0.008;
  k.paint([[X - hw - f, y, z1 + f], [X + hw + f, y, z1 + f], [X + hw + f, y, z0 - f], [X - hw - f, y, z0 - f]], out, [96, 70, 42]);
  k.glow([[X - hw, y + 0.001, z1], [X + hw, y + 0.001, z1], [X + hw, y + 0.001, z0], [X - hw, y + 0.001, z0]], out, [214, 204, 178], [255, 238, 206]);
  const band = (za, zb, day, lit) => k.glow([[X - hw * 0.8, y + 0.002, zb], [X + hw * 0.8, y + 0.002, zb], [X + hw * 0.8, y + 0.002, za], [X - hw * 0.8, y + 0.002, za]], out, day, lit);
  const H = z1 - z0;
  band(z0 + H * 0.70, z0 + H * 0.88, [176, 62, 112], [255, 110, 170]);
  band(z0 + H * 0.46, z0 + H * 0.54, [60, 48, 40], [92, 70, 52]);
  band(z0 + H * 0.28, z0 + H * 0.34, [60, 48, 40], [92, 70, 52]);
}
// The foyer's windows. `dX` is the door's X (piers at dX ± 0.24); `du` is measured away from the
// stage so one table serves both foyers. Every light clears the piers and the drum.
const PAL_LIGHTS = [{ du: -0.13, half: 0.040 }, { du: 0, half: 0.040 }, { du: 0.13, half: 0.040 }];   // the door bay
const PAL_LOW = { z: 0.311, hh: 0.064 }, PAL_HIGH = { z: 0.471, hh: 0.064 };   // two storeys, course to cornice
function palaisLights(ctx, cam, F, E, k, out, off, dX, night, alpha) {
  const glow = '#ffd9a8', y = PAL.front;
  // A light two storeys tall: two bays at the foyer's local `lx` (F's own frame, X − off).
  const bay = (lx, half, ly = y, face) => {
    for (const { z, hh } of [PAL_LOW, PAL_HIGH]) {
      drawArmPart(ctx, cam, F, E, { kind: 'windowBay', ...(face ? { face } : {}), cx: lx, cy: ly, z, half, hh,
        depth: 0.012, pal: PAL_BRONZE, bars: half > 0.03 ? 1 : 0, transom: 0.28, glow }, night, alpha, PAL_BRONZE);
    }
  };
  const sz0 = PAL_LOW.z + PAL_LOW.hh + 0.004, sz1 = PAL_HIGH.z - PAL_HIGH.hh - 0.004;
  for (const { du, half } of PAL_LIGHTS) {
    const X = dX + du * out;
    bay(X - off, half);
    k.paint([[X - half, y + 0.004, sz1], [X + half, y + 0.004, sz1], [X + half, y + 0.004, sz0], [X - half, y + 0.004, sz0]], [0, 1, 0], [104, 76, 46]);
  }
  // One narrow light in each outer bay.
  for (const u of [0.195, -0.43]) bay(u * out, 0.024);
  // Two on the outer flank. A flank part's `cx` runs along −y and `cy` is the flank's plane.
  for (const ly of [-0.24, -0.08]) bay(-ly, 0.034, out * PAL.wHW, 'x');
}
// One foyer. `off` is the tile's centre on X and which way is out: +1 box office, −1 bar.
function palaisFoyer(ctx, cam, F, W3, E, m, seed, night, alpha, now, frontVis, off) {
  const k = palaisKit(ctx, cam, F, W3, E, off, seed, night, alpha), { B, dn } = k;
  const out = off, mid = -off;                        // + is away from the stage, − toward it
  const cy = (PAL.front + PAL.wBack) / 2, fd = (PAL.front - PAL.wBack) / 2;
  const ledge = facePals(E, { side: PAL_TRIM, roof: PAL_COPPER });
  // The mass. ⚠ Plain ashlar, never `ty_meridian`: its painted windows run behind the piers and drum.
  B(off, cy, PAL.wHW, fd, 0, PAL.podium, PAL_STONE, 1);
  B(off, cy, PAL.wHW + 0.01, fd + 0.01, PAL.podium, PAL.course, PAL_TRIM, 2);
  B(off, cy, PAL.wHW, fd, PAL.course, PAL.wTop, PAL_STONE, 3);
  B(off, cy, PAL.wHW + 0.015, fd + 0.015, PAL.wTop, PAL.cornice, ledge, 4);
  B(off, cy, PAL.atticHW, fd - 0.06, PAL.cornice, PAL.atticTop, facePals(E, { side: PAL_STONE, roof: PAL_COPPER }), 5);
  // The joint: ground floor and cornice run on to the tile edge.
  { const jx = off + mid * (PAL.wHW + 0.5) / 2, jw = (0.5 - PAL.wHW) / 2;
    B(jx, cy, jw, fd, 0, PAL.wTop, PAL_STONE, 6);
    B(jx, cy, jw, fd + 0.015, PAL.wTop, PAL.cornice, ledge, 7); }
  // The drum on the outer corner.
  const [rx, ry] = k.at(off + out * PAL.drumX, PAL.drumY), R = PAL.drumR, SC = WALL_COL[PAL_STONE], CU = WALL_COL[PAL_COPPER];
  const shade = (c, k0) => (f) => { const s = (k0 + ((f && f.nl) || 0) * 0.4) * (1 - 0.5 * dn); return `rgb(${c[0] * s | 0},${c[1] * s | 0},${c[2] * s | 0})`; };
  drawFacetDrum(ctx, cam, rx, ry, 0, PAL.drumTop, R, R, 16, alpha, shade(SC, 0.66), null, PAL_STONE);
  drawFacetDrum(ctx, cam, rx, ry, PAL.drumTop, PAL.drumTop + 0.02, R + 0.008, R + 0.008, 16, alpha, shade(WALL_COL[PAL_TRIM], 0.7), null, PAL_TRIM);
  drawFacetDrum(ctx, cam, rx, ry, PAL.drumTop + 0.02, PAL.drumTop + 0.07, R * 0.92, R * 0.35, 16, alpha, shade(CU, 0.72), shade(CU, 0.9), PAL_COPPER);
  draw3DBoxAt(ctx, cam, rx, ry, 0.008, PAL.drumTop + 0.07, PAL.drumTop + 0.12, PAL_BRONZE, seed + 8, night, alpha, false);   // the finial
  // ⚠ Rings draw only the arc outside the block: a pulled stroke inside it shows through (glself).
  const inBlock = (lx, ly) => Math.abs(lx) <= PAL.wHW + 0.015 && ly <= PAL.front + 0.01 && ly >= PAL.wBack;
  const ring = (z, r, css, lw) => {
    const N = 24, cx = out * PAL.drumX, cyy = PAL.drumY;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832;
      const p0 = [cx + Math.cos(a0) * r, cyy + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cyy + Math.sin(a1) * r];
      if (inBlock(...p0) || inBlock(...p1)) continue;
      const A = W3(p0[0], p0[1], z), Bw = W3(p1[0], p1[1], z);
      const away = (q) => faceAway(cam, q[0], q[1], q[0] - rx, q[1] - ry);   // frontRing's test, through faceAway (ARM_FACE)
      if (away(A) || away(Bw)) continue;
      emitWire(ctx, cam, A, Bw, lw, css, alpha, { pull: DECO_PULL });
    }
  };
  const ringBronze = `rgba(${96 * (1 - 0.5 * dn) | 0},${70 * (1 - 0.5 * dn) | 0},${42 * (1 - 0.5 * dn) | 0},0.95)`;
  for (const z of [0.30, 0.38, 0.46]) ring(z, R + 0.003, ringBronze, 2);
  if (dn > 0.3) {
    ring(0.54, R + 0.004, `rgba(${PAL_PINK},0.95)`, 2.2);
    glowPool(ctx, cam, rx, ry, 0.54, PAL_PINK, 10, alpha * 0.32 * dn, { air: true });
  }
  // The door, toward the stage, with a side light either side.
  const dx0 = off + mid * PAL.doorX;
  drawEntrance(ctx, cam, F, W3, E, seed + 20, night, alpha, {
    x: dx0 - off, y: PAL.front, w: PAL.doorW, top: PAL.doorTop, leaves: 2, frameW: 0.012, depth: 0.01,
    frame: [118, 86, 52], lobby: { day: [70, 56, 40], night: [255, 214, 160] },
    transom: { hh: 0.014, day: [64, 52, 38], night: [255, 230, 186], label: m.door, ink: '#2a1c10', font: 'deco' },
    canopy: { out: 0.13, half: 0.15, hh: 0.006, pal: PAL_BRONZE, strip: '255,226,180' },
    lamp: '255,214,160', frontVis });
  for (const s of [-1, 1]) {
    const X = dx0 + s * 0.16, y = PAL.front + 0.003;
    k.paint([[X - 0.04, y, 0.165], [X + 0.04, y, 0.165], [X + 0.04, y, 0.025], [X - 0.04, y, 0.025]], [0, 1, 0], [96, 70, 42]);
    k.glow([[X - 0.032, y + 0.001, 0.157], [X + 0.032, y + 0.001, 0.157], [X + 0.032, y + 0.001, 0.033], [X - 0.032, y + 0.001, 0.033]], [0, 1, 0], [58, 66, 72], [255, 216, 168]);
  }
  // A pier either side of the door bay.
  for (const s of [-1, 1]) {
    const X = dx0 + s * 0.24;
    B(X, PAL.front + 0.012, 0.018, 0.016, PAL.course, PAL.cornice + 0.03, PAL_TRIM, 30 + s);
    B(X, PAL.front + 0.012, 0.010, 0.010, PAL.cornice + 0.03, PAL.cornice + 0.055, PAL_TRIM, 32 + s);
  }
  palaisLights(ctx, cam, F, E, k, out, off, dx0, night, alpha);
  if (dn > 0) {
    const [gx, gy] = k.at(dx0, PAL.front + 0.06);
    glowPool(ctx, cam, gx, gy, 0.08, '255,206,150', 12, alpha * 0.40 * dn);
    // The flood up the stone (a lamp, for the stage tile's reason).
    const [wx, wy] = k.at(off, PAL.front + 0.06);
    glowPool(ctx, cam, wx, wy, 0.32, '255,214,160', 18, alpha * 0.34 * dn);
  }
}
// The blade's lettering on face `s` = ±1. Only the face toward the eye, corners ordered by screen x
// so neither reads mirrored.
function palaisBladeText(ctx, cam, k, s, label, dn, alpha) {
  const X = s * (PAL.bladeT + 0.002), y0 = PAL.fFront + 0.012, y1 = PAL.fFront + PAL.bladeOut - 0.012;
  const z0 = PAL.bladeZ0 + 0.04, z1 = PAL.bladeZ1 - 0.04;
  const [cx, cy] = k.at(X, (y0 + y1) / 2), [nx, ny] = k.at(X + s, (y0 + y1) / 2);
  const ox = nx - cx, oy = ny - cy;
  if (faceAway(cam, cx, cy, ox, oy)) return;
  const pj = (y, z) => { const [wx, wy] = k.at(X, y); return cam.proj(wx, wy, z); };
  const a = pj(y0, z1), b = pj(y1, z1), c = pj(y1, z0), d = pj(y0, z0);
  if (![a, b, c, d].every((p) => p.f > 0.12)) return;
  const sw = a.sx > b.sx;
  const tex = bakeSignText(label, dn > 0.3 ? '#ff7ab8' : '#e8c878', dn > 0.3 ? 1 : 0, true, true, true, { font: 'deco' });
  if (tex) emitSurfaceText(ctx, cam, sw ? [b, a, d, c] : [a, b, c, d], tex, true, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
}

export const DOWNTOWN_ARMS = {
  bank(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Citadel Financial: a windowless marble strongbox.
    const stone = pal, colPal = 'ty_marble_col', bronze = 'ty_marble_bronze';
    const plinth = h * 0.16, colTop = h * 0.88, entTop = h * 1.04, atticTop = h * 1.22;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.34, 0, h * 0.08, stone, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.20, h * 0.08, plinth, stone, seed + 1, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, plinth, colTop, stone, seed + 2, night, alpha, false);
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = F((-0.9 + i * 0.6) * fh * 0.98, fh * 1.10);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.11, plinth, colTop, colPal, seed + 10 + i, night, alpha, false);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, colTop, entTop, stone, seed + 3, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, entTop, atticTop, stone, seed + 4, night, alpha, true);
    if (frontVis) {
      const [bx, by] = F(0, fh * 0.96);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.30, plinth, plinth + h * 0.30, bronze, seed + 5, night, alpha, false);
      glowPool(ctx, cam, bx, by, plinth + h * 0.06, '236,226,200', 11, alpha * (night ? 0.75 : 0.3));
    }
    // ⚠ Every box with an exposed top takes `roof: true`; the mass and columns sit under the entablature.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.30, atticTop, atticTop + h * 0.10, colPal, seed + 6, night, alpha, true);
    blinkLight(ctx, cam, dx, dy, atticTop + h * 0.14, '255,90,80', now, seed, alpha, 1);
  },
  archive(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Hall of Records: a stone civic temple under a copper dome.
    const stone = pal, colPal = 'ty_archive_col';
    const plinth = h * 0.22, colTop = h * 1.02, entTop = h * 1.20;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.42, 0,        h * 0.07, stone, seed,     night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.30, h * 0.07, h * 0.14, stone, seed + 1, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, h * 0.14, plinth,   stone, seed + 2, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, plinth, colTop, stone, seed + 3, night, alpha, true);
    for (let i = 0; i < 6; i++) {
      const [cx, cy] = F((-1 + i * 0.4) * fh * 0.98, fh * 1.12);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.10, plinth, colTop, colPal, seed + 10 + i, night, alpha, false);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, colTop, entTop, stone, seed + 4, night, alpha, false);
    // The pediment and its lit rose window.
    if (frontVis) {
      const [lx, ly] = F(-fh * 1.02, fh * 1.02), [rx, ry] = F(fh * 1.02, fh * 1.02), [ax, ay] = F(0, fh * 1.02);
      const a = cam.proj(lx, ly, entTop), b = cam.proj(rx, ry, entTop), c = cam.proj(ax, ay, entTop + h * 0.17);
      if (a.f > 0.1 && b.f > 0.1 && c.f > 0.1) {
        ctx.globalAlpha = alpha; ctx.fillStyle = night ? 'rgb(70,66,58)' : 'rgb(150,142,124)';
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      const [wx, wy] = F(0, fh * 1.06); glowPool(ctx, cam, wx, wy, entTop + h * 0.02, '255,206,140', 9, alpha * (night ? 0.6 : 0.4));
    }
    const drum1 = entTop + h * 0.5;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.60, entTop, drum1, stone, seed + 5, night, alpha, true);
    const domeH = h * 0.46, domeR = fh * 0.60, apex = drum1 + domeH;
    // The dome records itself as one tapered drum, or it's a hole in the captured envelope.
    if (SHAPE_SINK) SHAPE_SINK.push({ kind: 'drum', dx, dy, wz0: drum1, wz1: apex, rb: domeR, rt: domeR * 0.08, n: 12, cap: false, pal: 'ty_verdigris' });
    // ⚠ Paint the dome as `drawFacetDrum` bands so it reaches the GLASS 2 mesh (raw `emitFace` discs
    // don't). ⚠ Skip them under a capture, or they record on top of the drum pushed above.
    if (!SHAPE_SINK) {
      const CU = WALL_COL.ty_verdigris;
      const BANDS = 7;
      const rAt = (t) => domeR * Math.sqrt(Math.max(0, 1 - t * t));
      for (let i = 0; i < BANDS; i++) {
        const t0 = i / BANDS, t1 = (i + 1) / BANDS;
        const sh = 0.72 + 0.28 * t0;   // lighter toward the apex
        const style = (f) => { const k = sh * (0.82 + (f.nl || 0) * 0.36);
          return `rgb(${Math.round(CU[0] * k)},${Math.round(CU[1] * k)},${Math.round(CU[2] * k)})`; };
        drawFacetDrum(ctx, cam, dx, dy, drum1 + domeH * t0, drum1 + domeH * t1, rAt(t0), rAt(t1), 20, alpha, style, null, 'ty_verdigris');
      }
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.12, apex, apex + h * 0.14, colPal, seed + 6, night, alpha, false);
    blinkLight(ctx, cam, dx, dy, apex + h * 0.18, '255,196,120', now, seed, alpha, 2);
    if (night) {
      glowPool(ctx, cam, dx, dy, plinth + h * 0.04, '255,196,120', 24, alpha * 0.30);
      glowPool(ctx, cam, dx, dy, entTop + h * 0.2, '255,210,150', 14, alpha * 0.18);
    }
  },
  office(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // `office` and `corporate_office`: a glass tower with a windowless service core up one flank.
    const glass = pal, core = 'ty_precast_dk', band = 'ty_precast';
    const H = h * 1.7, pz = h * 0.2;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, 0, pz, band, seed + 6, night, alpha, false);
    // Two setbacks, the upper one pushed back off the street so the tower has a front.
    const sh = pz + (H - pz) * 0.58;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, pz, sh, glass, seed, night, alpha, false);
    { const [ux, uy] = F(0, -fh * 0.16);
      draw3DBoxAt(ctx, cam, ux, uy, fh * 0.78, sh, H, glass, seed + 1, night, alpha, true); }
    // The core, a storey past the glass.
    { const [kx, ky] = F(fh * 0.82, -fh * 0.16);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.26, pz, H + h * 0.16, core, seed + 2, night, alpha, true, 0, fh * 0.5); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.09, sh - h * 0.05, sh, band, seed + 3, night, alpha, false);
    mast(ctx, cam, dx, dy, H, H + h * 0.5, alpha, now, seed);
    // The lit lobby.
    if (frontVis) { const [lx3, ly3] = F(0, fh * 1.14);
      glowPool(ctx, cam, lx3, ly3, pz * 0.55, '190,215,255', 16, alpha * (night ? 0.7 : 0.24)); }
  },
  hotel(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // podium + tall guest slab + entrance marquee + vertical neon blade
    const neon = m.neon || '#ff4a9a';
    const stone2 = 'ty_precast', base2 = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, h * 0.24, stone2, seed + 4, night, alpha, false);    // lit ground-floor podium
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, h * 0.24, h * 1.28, pal, seed, night, alpha, false);    // guest tower
    // A cornice and a set-back roof storey.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, h * 1.28, h * 1.34, stone2, seed + 5, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, h * 1.34, h * 1.5, stone2, seed + 6, night, alpha, true);
    // The porte-cochère.
    { const [hx, hy] = F(0, fh * 1.26);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.5, h * 0.2, h * 0.26, base2, seed + 7, night, alpha, true, 0, fh * 0.3);
      if (night) glowPool(ctx, cam, hx, hy, h * 0.16, '255,214,160', 14, alpha * 0.5); }
    if (frontVis) {   // front-face signage: hidden when the marquee side is turned away
      marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.27, neon, night, alpha);                           // marquee sign across the front
      const [nx, ny] = F(-fh * 0.55, fh * 0.55); neonBlade(ctx, cam, nx, ny, h * 0.3, h * 1.35, neon, night, alpha);
    }
    if (night) glowPool(ctx, cam, dx, dy, h * 1.4, '255,120,180', 20, alpha * 0.2);
  },
  embassy(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Embassy Hotel & Bar: a brick and faience commercial hotel with a corner clock turret.
    // The bar is the lit ground-floor frontage. No neon, no blade; the name is cut in the parapet.
    const brick = 'ty_embassy_brick', faience = 'ty_embassy_faience';
    const iron = 'ty_embassy_iron', lead = 'ty_embassy_lead';
    const trim = 'ty_precast';
    // ⚠ Lead roof faces, stone sides: from the air a stone-topped cornice reads as one material.
    const ledge = facePals(E, { side: trim, roof: lead });
    const deck = facePals(E, { side: faience, roof: lead });
    const zPlinth = h * 0.16, zBar = h * 0.34, zShaft = h * 0.92;
    const zCorb = h * 0.95, zCorn = h * 1.01, zPara = h * 1.09, zTur = h * 1.34;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, zPlinth, brick, seed + 10, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.09, zPlinth, zPlinth + h * 0.025, ledge, seed + 11, night, alpha, true);
    // The bar's ground floor, a touch proud of the shaft.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, zPlinth + h * 0.025, zBar, faience, seed + 12, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, zBar, zShaft, faience, seed, night, alpha, false);
    // Pilasters at the corners and mid-faces, front-centre skipped for the entrance bay.
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [-1, 0]]) {
      const [px, py] = F(sx * fh * 0.99, sy * fh * 0.99);
      draw3DBoxAt(ctx, cam, px, py, fh * (sx && sy ? 0.11 : 0.085), zPlinth, zCorb, trim, seed + 20 + sx * 3 + sy, night, alpha, false);
    }
    // Arch heads over the three ground-floor bays.
    if (frontVis) for (const s of [-1, 0, 1]) {
      const [ax, ay] = F(s * fh * 0.56, fh * 1.03);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.22, zBar - h * 0.05, zBar - h * 0.02, trim, seed + 30 + s, night, alpha, false);
    }
    // The street entrance under an iron and glass canopy.
    { const [ex, ey] = F(0, fh * 1.0); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.20, 0, zBar - h * 0.06, iron, seed + 40, night, alpha, false); }
    for (const s of [-1, 1]) { const [jx, jy] = F(s * fh * 0.23, fh * 1.04); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.045, 0, zBar - h * 0.02, trim, seed + 41 + s, night, alpha, true); }
    { const [cx, cy] = F(0, fh * 1.17); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.30, zBar - h * 0.07, zBar - h * 0.055, iron, seed + 44, night, alpha, true); }
    for (const s of [-1, 1]) { const [bx, by] = F(s * fh * 0.26, fh * 1.09); draw3DBoxAt(ctx, cam, bx, by, fh * 0.03, zBar - h * 0.055, zBar - h * 0.02, iron, seed + 46 + s, night, alpha, false); }
    // A backlit lightbox on the canopy.
    { const sy = fh * 1.40, sw = fh * 0.24, sz0 = zBar - h * 0.055, sz1 = zBar - h * 0.008;
      const L = (x, z) => { const [wx, wy] = F(x, sy); return [wx, wy, z]; };
      const lit = !!night;
      haloRim(ctx, cam, F, sy, sw, sz0, sz1, (sz1 - sz0) * 0.10, 'rgb(34,30,28)', alpha);
      emitFlat(ctx, cam, [L(-sw, sz1), L(sw, sz1), L(sw, sz0), L(-sw, sz0)], lit ? 'rgb(255,236,198)' : 'rgb(214,204,182)', alpha, { lift: DETAIL_LIFT });
      if (frontVis) {
        const iz0 = sz0 + (sz1 - sz0) * 0.2, iz1 = sz1 - (sz1 - sz0) * 0.2, iw = sw * 0.86;
        const [lx, ly] = F(-iw, sy + fh * 0.004), [rx, ry] = F(iw, sy + fh * 0.004);
        const Q = [cam.proj(lx, ly, iz1), cam.proj(rx, ry, iz1), cam.proj(rx, ry, iz0), cam.proj(lx, ly, iz0)];
        const t = bakeSignText('HOTEL & BAR', '#2a1c12', 0, false, true);
        if (t && Q.every((q) => q.f > 0.065)) emitSurfaceText(ctx, cam, Q, t, false, alpha);
      }
      if (lit) { const [gx, gy] = F(0, sy + fh * 0.02); glowPool(ctx, cam, gx, gy, (sz0 + sz1) * 0.5, '255,226,170', 14, alpha * 0.5, { add: true }); }
    }
    for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 0.30, fh * 1.14); glowPool(ctx, cam, lx, ly, zBar - h * 0.08, '255,186,110', 6, alpha * (night ? 0.5 : 0.24)); }
    // The corbel course on the front and flanks.
    for (let i = -3; i <= 3; i++) {
      const [kx, ky] = F(i * fh * 0.27, fh * 1.0);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.055, zCorb - h * 0.035, zCorb, trim, seed + 60 + i, night, alpha, false);
      for (const s of [-1, 1]) { const [qx, qy] = F(s * fh * 1.0, i * fh * 0.27); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.055, zCorb - h * 0.035, zCorb, trim, seed + 68 + i * s, night, alpha, false); }
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, zCorb, zCorn, ledge, seed + 13, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, zCorn, zPara, deck, seed + 14, night, alpha, true);
    // The name cut into the parapet: surface text, never billboarded.
    if (frontVis) {
      const nhw = fh * 0.62, [nlx, nly] = F(-nhw, fh * 1.01), [nrx, nry] = F(nhw, fh * 1.01);
      const TL = cam.proj(nlx, nly, zPara - h * 0.012), TR = cam.proj(nrx, nry, zPara - h * 0.012);
      const BR = cam.proj(nrx, nry, zCorn + h * 0.012), BL = cam.proj(nlx, nly, zCorn + h * 0.012);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.065)) {   // proj clamps at 0.06; 0.12 dropped the name as you walked under it
        const nam = bakeSignText('EMBASSY HOTEL', '#d8cdb4', night ? 1 : 0, false);
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], nam, false, alpha);
      }
    }
    // The parapet name is halo-lit after dark.
    if (night) {
      const [gx, gy] = F(0, fh * 1.03), gz = (zCorn + zPara) * 0.5;
      for (const s of [-0.6, 0, 0.6]) { const [px, py] = F(s * fh, fh * 1.03); glowPool(ctx, cam, px, py, gz, '255,214,150', 12, alpha * 0.38, { add: true }); }
      glowPool(ctx, cam, gx, gy, gz, '255,200,130', 26, alpha * 0.18, { add: true });
    }
    // The corner clock turret.
    { const [tx, ty] = F(-fh * 0.62, fh * 0.62);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.30, zPara, zTur - h * 0.10, faience, seed + 70, night, alpha, false);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.34, zTur - h * 0.10, zTur - h * 0.07, ledge, seed + 71, night, alpha, true);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, zTur - h * 0.07, zTur, lead, seed + 72, night, alpha, true);
      const [fx2, fy2] = F(-fh * 0.62, fh * 0.94);
      draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.17, zTur - h * 0.21, zTur - h * 0.10, trim, seed + 73, night, alpha, false);
      if (night) glowPool(ctx, cam, fx2, fy2, zTur - h * 0.155, '255,236,196', 7, alpha * 0.4);
    }
    // Night: the bar warm, the guest floors cool.
    if (night) {
      glowPool(ctx, cam, dx, dy, zPlinth + h * 0.10, '255,180,96', 24, alpha * 0.34);
      glowPool(ctx, cam, dx, dy, (zBar + zShaft) * 0.5, '196,214,238', 13, alpha * 0.14);
    }
  },
  clone(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Coldwater Clone Facility, YOU AGAIN: a tiled lab block, a door, four vats, the main to Second Helpings
    // ⚠ The first building every player sees (`zone_district_918_903`'s arrival prose).
    // ⚠ Door on the left, vats on the right beside the shop, so the main never crosses the door.
    const yaw = faceYaw(E), dn = night ? clamp(night, 0, 1) : 0, dusk = 1 - 0.55 * dn;
    const bio = '90,255,200', STEEL = [184, 196, 200];
    const blockTop = h * 0.80, capTop = h * 0.85;
    // The front wall's plane: the block is exactly fh wide, so `draw3DBoxAt`'s 0.44 clamp never moves it.
    const WF = fh;
    // The shell, in Halcyon Fields' own materials (`ty_hf_*`) because Halcyon owns it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, h * 0.04, 'ty_hf_marble_dk', seed + 30, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh, h * 0.04, blockTop, 'ty_clone_tile', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.04, blockTop, capTop, 'ty_hf_mirror', seed + 31, night, alpha, true);
    { const [sx, sy] = F(-fh * 0.36, -fh * 0.10);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.50, capTop, h * 1.12, 'ty_hf_glass', seed + 1, night, alpha, false);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.52, h * 1.12, h * 1.14, 'ty_hf_mirror', seed + 2, night, alpha, true); }
    // The dome. ⚠ Keep it pale: shaded darker it reads as a boulder on the roof.
    const [rx, ry] = F(fh * 0.54, -fh * 0.02);
    const shell = (f) => { const s = (0.62 + f.nl * 0.38) * dusk; return `rgb(${(208 * s) | 0},${(228 * s) | 0},${(224 * s) | 0})`; };
    const steelS = (f) => { const s = (0.56 + f.nl * 0.44) * dusk; return `rgb(${(182 * s) | 0},${(196 * s) | 0},${(200 * s) | 0})`; };
    drawFacetDrum(ctx, cam, rx, ry, capTop, capTop + h * 0.025, fh * 0.40, fh * 0.40, 14, alpha, steelS, 'rgb(170,184,188)', 'ty_hf_mirror');
    drawFacetDrum(ctx, cam, rx, ry, capTop + h * 0.025, capTop + h * 0.20, fh * 0.37, fh * 0.30, 14, alpha, shell, null, 'ty_clone_vat');
    drawFacetDrum(ctx, cam, rx, ry, capTop + h * 0.20, capTop + h * 0.32, fh * 0.30, fh * 0.11, 14, alpha, shell, 'rgb(196,220,214)', 'ty_clone_vat');
    frontRing(ctx, cam, rx, ry, capTop + h * 0.20, fh * 0.31, 14, night ? 'rgba(120,255,220,0.7)' : 'rgba(120,196,184,0.45)', 2, alpha);   // containment band
    drawSmoke(ctx, cam, rx, ry, capTop + h * 0.32, '206,232,226', alpha * 0.6, now, seed + 2);
    // The cycle (`gutPhase`): the printing vat moves along the row each minute and the dome surges with it.
    const gu = gutPhase(now);
    const cycle = Math.floor((now || 0) / GUT.period + frac(GUT.seed));
    const printing = gu < 0 ? -1 : (cycle * 3 + (seed | 0)) & 3;
    const run = gu >= 0 && gu < 0.30 ? Math.sin(Math.PI * gu / 0.30) : 0;
    glowPool(ctx, cam, rx, ry, capTop + h * 0.26, '120,255,220', 22 + run * 12, clamp(alpha * (night ? 0.42 : 0.24) * (1 + run * 1.3), 0, 1));
    // The vats. ⚠ They stand on `GUT.ly` because the main runs over their lids.
    const vatR = fh * 0.115, vatLx = [0.02, 0.30, 0.58, 0.86], vb = h * 0.045, vt = h * 0.40, vatTop = h * 0.44;
    const zT = h * 0.50, R = GUT.r;
    // ⚠ Palette `ty_clone_wall`, never a frost family: a textured face keeps its day colour at night.
    const vatGlass = night ? [150, 255, 204] : [150, 196, 182];
    const frost = litStyle((f) => { const s = 0.72 + f.nl * 0.28; return `rgb(${(vatGlass[0] * s) | 0},${(vatGlass[1] * s) | 0},${(vatGlass[2] * s) | 0})`; }, vatGlass, 'frost');
    for (let i = 0; i < 4; i++) {
      const lx = vatLx[i] * fh, [vx, vy] = F(lx, GUT.ly);
      drawFacetDrum(ctx, cam, vx, vy, 0, vb, vatR * 1.14, vatR * 1.14, 12, alpha, steelS, 'rgb(170,184,188)', 'ty_hf_mirror');
      drawFacetDrum(ctx, cam, vx, vy, vb, vt, vatR, vatR, 12, alpha, frost, null, 'ty_clone_wall');
      drawFacetDrum(ctx, cam, vx, vy, vt, vatTop, vatR * 1.10, vatR * 1.04, 12, alpha, steelS, 'rgb(196,208,212)', 'ty_hf_mirror');
      tubeRun(ctx, cam, W3, [lx, GUT.ly, vatTop], [lx, GUT.ly, zT - R * 0.5], fh * 0.028, 6, STEEL, 'chrome', alpha, dusk);   // up into the main
      const breath = motionOn() ? 0.72 + 0.28 * Math.sin((now || 0) * 0.0009 + frac(seed + i * 7) * 6.283) : 1;
      const surge = i === printing ? run * 2.1 : 0;
      // ⚠ The glow sits on the glass: at the drum's centre the depth buffer hides it.
      { const [gx, gy] = F(lx, GUT.ly + vatR * 1.05);
        glowPool(ctx, cam, gx, gy, h * 0.24, bio, 9 * (1 + surge * 0.5), clamp(alpha * (night ? 0.62 : 0.30) * breath * (1 + surge), 0, 1)); }
      const band = night ? `rgba(120,255,214,${clamp(0.55 + 0.3 * breath + surge * 0.2, 0, 1).toFixed(2)})` : 'rgba(150,206,192,0.55)';
      frontRing(ctx, cam, vx, vy, vb + h * 0.012, vatR * 1.02, 12, band, 1.6, alpha);
      frontRing(ctx, cam, vx, vy, vt - h * 0.012, vatR * 1.02, 12, band, 1.6, alpha);
      if (frontVis) {
        // ⚠ The body card turns to the eye round the vat's axis, or it sits on the edge off-axis.
        // `G` is a point `u` across that card at radius `r`.
        const e0 = (cam.ex || 0) - vx, e1 = (cam.ey || 0) - vy;
        const eu = e0 * E[1] - e1 * E[0], ev = e0 * E[0] + e1 * E[1], el = Math.hypot(eu, ev) || 1;
        const bs = eu / el, bc = ev / el, front = clamp(bc, 0, 1);   // the bearing off the vat's front
        const G = (u, r) => F(lx + bs * r + bc * u, GUT.ly + bc * r - bs * u);
        // The body is a decal because it moves.
        let fa = 1;
        if (i === printing && gu >= 0.30) fa = gu < 0.36 ? 1 - (gu - 0.30) / 0.06 : ease((gu - 0.45) / 0.55);
        // Bob and sway, each vat on its own phase. ⚠ The travel stays inside the glass.
        const ph = frac(seed + i * 0.37) * 6.283, tS = (now || 0) * 0.001;
        const bob = motionOn() ? Math.sin(tS * 0.9 + ph) * h * 0.02 : 0;
        const sway = motionOn() ? Math.sin(tS * 0.37 + ph * 1.3) * vatR * 0.07 : 0;
        const tex = fa > 0.02 ? cloneBodyTex((i + (seed | 0)) & 1, night) : null;
        if (tex) {
          // Off the front it narrows and thins.
          const fr = vatR + FACE_EPS * 2, hw = vatR * 0.62 * (0.7 + 0.3 * front), z0 = vb + h * 0.03 + bob, z1 = vt - h * 0.035 + bob;
          const q = [[-hw, z1], [hw, z1], [hw, z0], [-hw, z0]].map(([u, z]) => { const [wx, wy] = G(sway + u, fr); return cam.proj(wx, wy, z); });
          if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha * fa * (night ? 0.95 : 0.8) * (0.6 + 0.4 * front), DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
        }
        if (motionOn()) for (let k = 0; k < 2; k++) {
          const t = ((now || 0) * 0.00011 + k * 0.5 + frac(seed + i * 3.1)) % 1;
          const [bx, by] = G(vatR * 0.45 * Math.sin(t * 9 + i + k * 2), vatR + 0.004);
          glowPool(ctx, cam, bx, by, vb + (vt - vb) * t, '200,255,236', 2.5, alpha * (night ? 0.7 : 0.45) * Math.sin(Math.PI * t), { air: true });
        }
      }
    }
    // The main, from the wall along the vat lids into Second Helpings' party wall (see GUT).
    const lxS = -fh * 0.22, PRODUCT = [104, 196, 150];
    const wallFace = 1 + GUT.wall.lx - GUT.wall.half;   // the party wall's south face, in this frame
    tubeRun(ctx, cam, W3, [lxS, WF - 0.004, zT], [lxS, GUT.ly, zT], R, 8, PRODUCT, 'glass', alpha, dusk);                // out of the wall
    tubeRun(ctx, cam, W3, [lxS, WF - 0.002, zT], [lxS, WF + 0.014, zT], R * 1.6, 10, STEEL, 'chrome', alpha, dusk);   // the wall collar
    tubeRun(ctx, cam, W3, [lxS - R * 1.2, GUT.ly, zT], [GUT.end, GUT.ly, zT], R, 8, PRODUCT, 'glass', alpha, dusk);   // the run
    for (const x of [lxS, ...vatLx.map((u) => u * fh), fh + 0.02, wallFace - 0.009]) {                              // flanges
      tubeRun(ctx, cam, W3, [x - 0.009, GUT.ly, zT], [x + 0.009, GUT.ly, zT], R * 1.28, 10, STEEL, 'chrome', alpha, dusk);
    }
    // The plate on the party wall. ⚠ Its centre is held back so it can't hang off the wall's front edge.
    { const pr = 0.034, pcy = Math.min(GUT.ly, GUT.wall.front - pr - 0.002), [qx, qy] = F(wallFace - 0.004, pcy);
      draw3DBoxAt(ctx, cam, qx, qy, 0.004, zT - pr, zT + pr, 'ty_hf_mirror', seed + 38, night, alpha, true, yaw, pr);
      for (const [by, bz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        tubeRun(ctx, cam, W3, [wallFace - 0.013, pcy + by * pr * 0.72, zT + bz * pr * 0.72], [wallFace - 0.008, pcy + by * pr * 0.72, zT + bz * pr * 0.72], 0.004, 6, [120, 132, 138], 'chrome', alpha, dusk);
      }
      for (const x of [wallFace - 0.07, wallFace - 0.045]) tubeRun(ctx, cam, W3, [x - 0.006, GUT.ly, zT], [x + 0.006, GUT.ly, zT], R * 1.08, 10, [232, 112, 34], 'plain', alpha, dusk); }
    // The valve. ⚠ Kept low, clear of the name plate (`signfit`).
    { const vy2 = (WF + GUT.ly) / 2, [wx, wy] = F(lxS, vy2), wz = zT + R * 1.6, wr = R * 1.25;
      tubeRun(ctx, cam, W3, [lxS, vy2, zT + R * 0.6], [lxS, vy2, wz], R * 0.42, 6, STEEL, 'chrome', alpha, dusk);
      drawRing(ctx, cam, wx, wy, wz, wr, 10, 'rgba(204,54,42,0.95)', 2.2, alpha);
      emitWire(ctx, cam, W3(lxS - wr, vy2, wz), W3(lxS + wr, vy2, wz), 1.4, 'rgba(204,54,42,0.95)', alpha, { pull: 0.03 });
      emitWire(ctx, cam, W3(lxS, vy2 - wr, wz), W3(lxS, vy2 + wr, wz), 1.4, 'rgba(204,54,42,0.95)', alpha, { pull: 0.03 }); }
    for (const u of [0.16, 0.44, 0.72]) {
      const x = u * fh;
      emitWire(ctx, cam, W3(x, WF, zT - R * 2.4), W3(x, GUT.ly, zT - R * 0.9), 1.8, 'rgba(120,132,138,0.95)', alpha, { pull: 0.03 });
      emitWire(ctx, cam, W3(x, WF, zT), W3(x, GUT.ly - R * 0.9, zT), 1.8, 'rgba(120,132,138,0.95)', alpha, { pull: 0.03 });
    }
    { const x = (fh + wallFace) / 2;
      tubeRun(ctx, cam, W3, [x, GUT.ly, 0], [x, GUT.ly, zT - R], 0.008, 6, STEEL, 'chrome', alpha, dusk); }
    // The slug. ⚠ `air`: these glows must not light the building.
    if (night) for (let x = lxS + 0.06; x < wallFace - 0.03; x += 0.11) { const [gx, gy] = F(x, GUT.ly + R); glowPool(ctx, cam, gx, gy, zT, bio, 4, alpha * 0.22, { air: true }); }
    if (gu >= 0.34 && gu < 0.52) {
      const slug = lxS + (GUT.end - lxS) * (gu - 0.34) / 0.18, cut = wallFace - 0.01;
      slugLine(ctx, cam, W3, [[lxS, GUT.ly + R * 0.7, zT + R * 0.25], [cut, GUT.ly + R * 0.7, zT + R * 0.25]], slug - lxS - 0.10, slug - lxS, night, alpha);
      for (let j = 0; j < 4; j++) {
        const x = slug - j * 0.03;
        if (x < lxS || x > wallFace - 0.01) continue;
        const [gx, gy] = F(x, GUT.ly + R * 0.95);
        glowPool(ctx, cam, gx, gy, zT, '140,255,170', 7 - j * 1.3, alpha * (night ? 0.9 : 0.6) * (1 - j * 0.22), { air: true });
      }
    }
    // The door. ⚠ The kit's `wall` section is declined (KIT_DECLINE): its glazing sits where the door is.
    const lxD = -fh * 0.60, dw = fh * 0.13, dz0 = h * 0.04 + 0.002, dTop = h * 0.21, pyl = fh * 0.20, tw = pyl - fh * 0.055;
    for (const s of [-1, 1]) { const [px, py] = F(lxD + s * pyl, fh * 1.12);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.055, 0, h * 0.335, 'ty_hf_mirror', seed + 34 + s, night, alpha, true, yaw, fh * 0.12); }
    { const [cx2, cy2] = F(lxD, fh * 1.19);
      draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.30, h * 0.335, h * 0.37, 'ty_hf_mirror', seed + 33, night, alpha, true, yaw, fh * 0.17); }
    const glowLine = (A, B) => emitWire(ctx, cam, A, B, 2, night ? 'rgba(130,255,222,0.95)' : 'rgba(150,200,190,0.7)', alpha, { pull: 0.02, glow: night ? 6 : 0, glowCss: 'rgb(110,255,214)' });
    for (const s of [-1, 1]) glowLine(W3(lxD + s * pyl, fh * 1.24 + 0.003, h * 0.02), W3(lxD + s * pyl, fh * 1.24 + 0.003, h * 0.32));
    glowLine(W3(lxD - fh * 0.28, fh * 1.355, h * 0.333), W3(lxD + fh * 0.28, fh * 1.355, h * 0.333));   // under the canopy's front edge
    const yD = WF + FACE_EPS * 3;
    flatOut(ctx, cam, W3, [[lxD - dw, yD, dTop], [lxD + dw, yD, dTop], [lxD + dw, yD, dz0], [lxD - dw, yD, dz0]], [0, 1, 0],
      night ? 'rgb(206,240,232)' : 'rgb(46,64,66)', alpha);
    const head = [STEEL[0] * dusk, STEEL[1] * dusk, STEEL[2] * dusk], t0 = dTop + h * 0.024, t1 = h * 0.325;
    flatOut(ctx, cam, W3, [[lxD - tw, yD + 0.002, t0 - h * 0.006], [lxD + tw, yD + 0.002, t0 - h * 0.006], [lxD + tw, yD + 0.002, dTop], [lxD - tw, yD + 0.002, dTop]], [0, 1, 0], rgb(head), alpha, { lit: 'chrome', albedo: head });
    // ⚠ The lightbox is on the pylons' front plane: on the wall their lit edges cross it (`signfit`).
    const yP = fh * 1.24 + 0.002;
    flatOut(ctx, cam, W3, [[lxD - tw, yP, t1], [lxD + tw, yP, t1], [lxD + tw, yP, t0], [lxD - tw, yP, t0]], [0, 1, 0], 'rgb(18,30,32)', alpha);
    flatOut(ctx, cam, W3, [[lxD - tw, yP, t0], [lxD + tw, yP, t0], [lxD + tw, WF, t0], [lxD - tw, WF, t0]], [0, 0, -1], 'rgb(34,44,46)', alpha);   // its soffit, back to the wall
    flatOut(ctx, cam, W3, [[lxD - dw, fh * 1.06 + 0.05, 0.004], [lxD + dw, fh * 1.06 + 0.05, 0.004], [lxD + dw, fh * 1.06, 0.004], [lxD - dw, fh * 1.06, 0.004]], [0, 0, 1], 'rgb(30,34,36)', alpha);   // the mat, at the foot of the step
    if (night) for (const s of [-0.5, 0.5]) { const [gx, gy] = F(lxD + s * dw * 2, fh * 1.22); glowPool(ctx, cam, gx, gy, h * 0.30, '200,246,236', 10, alpha * 0.45); }
    { const [gx, gy] = F(lxD, WF + 0.03); glowPool(ctx, cam, gx, gy, dTop * 0.6, '190,240,255', 12, alpha * (night ? 0.5 : 0.18)); }   // the light over the door, on at any hour
    if (frontVis) {
      const tex = bakeSignText('ARRIVALS', '#8ff3dc', night ? 1 : 0, false, true, true, { font: 'condensed', sub: 'WELCOME BACK' });
      if (tex) {
        const q = [[-tw * 0.9, t1 - h * 0.008], [tw * 0.9, t1 - h * 0.008], [tw * 0.9, t0 + h * 0.008], [-tw * 0.9, t0 + h * 0.008]]
          .map(([u, z]) => { const [wx, wy] = F(lxD + u, yP + 0.002); return cam.proj(wx, wy, z); });
        if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
      // ⚠ The doors are decals because they move: mesh is captured once.
      const open = gu < 0.30 || gu >= 0.40 ? 0 : 0.9 * (gu < 0.32 ? ease((gu - 0.30) / 0.02) : gu < 0.38 ? 1 : 1 - ease((gu - 0.38) / 0.02));
      if (open > 0.15) {   // whoever just came out of a vat, in the doorway
        const q = [[-dw * 0.42, dTop * 0.88], [dw * 0.42, dTop * 0.88], [dw * 0.42, dz0], [-dw * 0.42, dz0]]
          .map(([u, z]) => { const [wx, wy] = F(lxD + u, yD + 0.003); return cam.proj(wx, wy, z); });
        if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, cloneBodyTex(2, night), false, alpha * clamp((open - 0.15) / 0.5, 0, 1), DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.2);
      }
      const leaf = night ? ['rgb(176,230,220)', 'rgb(112,170,160)'] : ['rgb(150,178,186)', 'rgb(64,86,92)'];
      const yL = yD + 0.006;
      for (const s of [-1, 1]) {
        const a = lxD + s * dw * open, b = lxD + s * dw, u0 = Math.min(a, b), u1 = Math.max(a, b);
        if (u1 - u0 < 0.002) continue;
        emitDecoFill(ctx, cam, [W3(u0, yL, dTop), W3(u1, yL, dTop), W3(u1, yL, dz0), W3(u0, yL, dz0)], leaf[1], alpha, 0.012, 'clonedoor', false, leaf);
        emitWire(ctx, cam, W3(a, yL + 0.002, dz0), W3(a, yL + 0.002, dTop), 1.4, 'rgba(150,164,170,0.95)', alpha, { pull: 0.02 });   // the meeting stile
        emitWire(ctx, cam, W3(u0 + (u1 - u0) * 0.15, yL + 0.003, (dz0 + dTop) * 0.45), W3(u1 - (u1 - u0) * 0.15, yL + 0.003, (dz0 + dTop) * 0.45), 1.2, 'rgba(196,208,212,0.95)', alpha, { pull: 0.02 });   // the push bar
      }
    }
    // A clerestory over the door.
    { const c0 = h * 0.41, c1 = h * 0.53, x0 = -fh * 0.90, x1 = -fh * 0.40, y = WF + 0.002;
      flatOut(ctx, cam, W3, [[x0 - 0.006, y, c1 + 0.006], [x1 + 0.006, y, c1 + 0.006], [x1 + 0.006, y, c0 - 0.006], [x0 - 0.006, y, c0 - 0.006]], [0, 1, 0], rgb(head), alpha, { lit: 'chrome', albedo: head });
      flatOut(ctx, cam, W3, [[x0, y + 0.002, c1], [x1, y + 0.002, c1], [x1, y + 0.002, c0], [x0, y + 0.002, c0]], [0, 1, 0], night ? 'rgb(176,240,226)' : 'rgb(126,168,164)', alpha);
      for (let k = 1; k < 4; k++) { const x = x0 + (x1 - x0) * k / 4; emitWire(ctx, cam, W3(x, y + 0.004, c0), W3(x, y + 0.004, c1), 1.4, 'rgba(150,164,170,0.95)', alpha, { pull: 0.02 }); } }
    // The name plate, the Halcyon seal over the door. Halcyon's ownership is canon in
    // `plugins/augments/backup.js`.
    const pz0 = h * 0.575, pz1 = h * 0.785, pY = fh * 1.11;
    { const [px, py] = F(0, fh * 1.055);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.97, pz0, pz1, 'ty_door', seed + 35, night, alpha, true, yaw, fh * 0.055); }
    haloRim(ctx, cam, F, pY + 0.002, fh * 0.97, pz0, pz1, 0.006, rgb(head), alpha);
    if (night) emitWire(ctx, cam, W3(-fh * 0.95, pY + 0.004, pz0 - 0.004), W3(fh * 0.95, pY + 0.004, pz0 - 0.004), 2, 'rgba(130,255,222,0.9)', alpha, { pull: 0.02, glow: 7, glowCss: 'rgb(110,255,214)' });
    if (frontVis) {
      const P = (u, z) => { const [wx, wy] = F(u, pY + FACE_EPS); return cam.proj(wx, wy, z); };
      const seal = haloSealTex(night);
      if (seal) {
        const q = [P(-fh * 0.90, pz1 - h * 0.02), P(-fh * 0.30, pz1 - h * 0.02), P(-fh * 0.30, pz0 + h * 0.02), P(-fh * 0.90, pz0 + h * 0.02)];
        if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, seal, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
      // Raised letters: three dark copies stepped behind the face, unlit after dark.
      const tex = bakeSignText('YOU AGAIN', '#7fe8d2', night ? 1 : 0, false, true, true, { font: 'condensed', sub: 'CLONE FACILITY' });
      const side = bakeSignText('YOU AGAIN', '#14332e', 0, false, true, true, { font: 'condensed', sub: 'CLONE FACILITY' });
      const quad = (ox, oz) => [[-fh * 0.12, pz1 - h * 0.02], [fh * 0.95, pz1 - h * 0.02], [fh * 0.95, pz0 + h * 0.02], [-fh * 0.12, pz0 + h * 0.02]]
        .map(([lx, z2]) => P(lx + ox, z2 + oz));
      if (tex && quad(0, 0).every((p) => p.f > 0.12)) {
        if (side) for (let k = 3; k >= 1; k--) emitSurfaceText(ctx, cam, quad(fh * 0.006 * k, -h * 0.005 * k), side, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * (2.5 - 0.35 * k));
        emitSurfaceText(ctx, cam, quad(0, 0), tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
    }
    // Slit windows down the flanks.
    for (const s of [-1, 1]) for (const v of [-0.60, 0, 0.60]) {
      const y0 = (v - 0.035) * fh, y1 = (v + 0.035) * fh, z0 = h * 0.10, z1 = h * 0.74, e = 0.006;
      flatOut(ctx, cam, W3, [[s * (fh + 0.002), y0 - e, z1 + e], [s * (fh + 0.002), y1 + e, z1 + e], [s * (fh + 0.002), y1 + e, z0 - e], [s * (fh + 0.002), y0 - e, z0 - e]], [s, 0, 0], rgb(head), alpha, { lit: 'chrome', albedo: head });
      flatOut(ctx, cam, W3, [[s * (fh + 0.004), y0, z1], [s * (fh + 0.004), y1, z1], [s * (fh + 0.004), y1, z0], [s * (fh + 0.004), y0, z0]], [s, 0, 0], night ? 'rgb(150,236,214)' : 'rgb(40,72,74)', alpha);
    }
    { const [mx, my] = F(-fh * 0.9, fh * 0.5); mast(ctx, cam, mx, my, blockTop, h * 1.55, alpha, now, seed + 4); }
    blinkLight(ctx, cam, dx, dy, h * 1.15, bio, now, seed, alpha, 2);
  },
  luxtower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Halcyon Towers: a square glass tower twisting about 80° to a chiselled crown.
    const neonA = '80,230,255', neonB = '255,90,180';   // cyan / magenta cyberpunk edge light
    const baseZ = h * 0.28, topZ = h * 2.7, N = 22;      // many thin floor-groups → a smooth continuous twist
    const twist = 1.4, fwBase = fh * 0.8;                // ~80° total helix + slender square footprint half-width
    const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
    const segW = (i) => fwBase * (1 - 0.44 * (i / N));   // gentle taper to a slender crown
    const segYaw = (i) => twist * (i / N);               // progressive rotation = the helix
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.3, 0, baseZ, pal, seed + 4, night, alpha, true);
    for (let i = 0; i < N; i++) draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, i === N - 1, segYaw(i));
    // Light runners up two opposite corners.
    for (const [dir, rgb] of [[[-1, -1], neonA], [[1, 1], neonB]]) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
        pts.push([dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i)]);
      }
      // ⚠ Pass DECO_PULL: the default pull drags the far runner in front of the near wall (`glself`).
      if (pts.length > 1) emitLightRunner(ctx, cam, pts, `rgba(${rgb},0.9)`, alpha * (night ? 0.95 : 0.55), night, rgb, undefined, DECO_PULL);
    }
    draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.9, topZ, topZ + h * 0.2, pal, seed + 20, night, alpha, true, twist * 1.08);
    mast(ctx, cam, dx, dy, topZ + h * 0.2, topZ + h * 0.56, alpha, now, seed);
    if (night) {
      glowPool(ctx, cam, dx, dy, baseZ, '120,220,255', 24, alpha * 0.3);            // cool lobby wash
      glowPool(ctx, cam, dx, dy, baseZ + (topZ - baseZ) * 0.5, neonA, 14, alpha * 0.22);   // mid sky-lobby glow
      glowPool(ctx, cam, dx, dy, topZ + h * 0.08, neonB, 16, alpha * 0.3);          // crown halo
    }
    blinkLight(ctx, cam, dx, dy, topZ + h * 0.56, neonA, now, seed, alpha, 2);      // cyan beacon on the spire
  },
  solenne(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Solenne Residences: a warm champagne-glass spire, taller than Halcyon Towers, its rival.
    const gold = '255,206,120', warm = '255,232,190';
    const baseZ = h * 0.30, topZ = h * 3.05, N = 24;         // taller than Halcyon; many thin glass plates
    const twist = 0.52, fwBase = fh * 0.86;                  // ~30° gentle turn (elegant, not a helix)
    const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
    // Three setback tiers: the footprint steps in at ~1/3 and ~2/3 height, tapering within each tier.
    const tierW = (t) => t < 0.34 ? fwBase * (1 - 0.10 * (t / 0.34))
      : t < 0.68 ? fwBase * 0.80 * (1 - 0.12 * ((t - 0.34) / 0.34))
      : fwBase * 0.62 * (1 - 0.18 * ((t - 0.68) / 0.32));
    const segW = (i) => tierW(i / N);
    const segYaw = (i) => twist * (i / N);
    // The podium and its entrance. ⚠ An arm that draws no ground floor gets the kit's shopfront;
    // this one draws its own and `KIT_DECLINE` keeps the kit's off.
    const stone = 'ty_marble_col', bronze = 'ty_marble_bronze';   // pale ashlar reveal, warm bronze metalwork
    // ⚠ Every part below is measured off `podW`, never `fh`, so it moves with the mass `segFit` trims.
    const podW = fh * 1.34, eY = faceYaw(E);
    // ⚠ The canopy sits low to leave the nameplate room: a proud fascia projects bigger than the wall.
    const doorZ = baseZ * 0.46, headZ = baseZ * 0.58;             // the head of the doors, and the lintel over them
    draw3DBoxAt(ctx, cam, dx, dy, podW, 0, baseZ, pal, seed + 4, night, alpha, true);            // the glazed podium
    // Two jambs and a lintel (a single box would wall the doorway). ⚠ Jambs, lintel and doors share one
    // plane, or the podium wall hides the doors. ⚠ That plane stands off min(podW, 0.44), the wall
    // `segFit` actually leaves.
    const entD = 0.02, entY = Math.min(podW, 0.44) + entD;   // the wall as segFit leaves it (half-width capped at 0.44), and the reveal standing off it
    for (const s of [-1, 1]) { const [jx, jy] = F(s * podW * 0.42, entY);
      draw3DBoxAt(ctx, cam, jx, jy, podW * 0.045, 0, headZ, stone, seed + 30 + s, night, alpha, true, eY, entD); }
    { const [lx, ly] = F(0, entY);
      draw3DBoxAt(ctx, cam, lx, ly, podW * 0.48, doorZ, headZ, stone, seed + 32, night, alpha, true, eY, entD); }
    // The doors, flat and flush with the jambs. ⚠ Not a box: a box wears its palette's window skin.
    { const yDr = entY + entD + 0.002, dw = podW * 0.375;
      const L = (x, z, back = 0) => { const [wx, wy] = F(x, yDr - back); return [wx, wy, z]; };
      const Pq = (x0, x1, z0, z1, fill, back) => emitFlat(ctx, cam, [L(x0, z1, back), L(x1, z1, back), L(x1, z0, back), L(x0, z0, back)], fill, alpha, { lift: DETAIL_LIFT });
      const glass = night ? 'rgba(255,214,150,0.97)' : 'rgba(70,86,96,0.97)', frame = 'rgb(78,58,34)';
      Pq(-dw, dw, 0, doorZ, frame, 0.003);                                                     // the bronze frame, a hair behind the glass
      for (const s of [-1, 1]) { const a = s * podW * 0.012, b = s * (dw - podW * 0.02);
        Pq(Math.min(a, b), Math.max(a, b), doorZ * 0.04, doorZ * 0.94, glass, 0); } }
    // The canopy on two columns. `awning` places by the front edge, so the tile fit trims its back.
    awning(ctx, cam, dx, dy, E, podW * 0.62, podW * 1.02, headZ, headZ + h * 0.022, bronze, seed + 34, night, alpha, podW * 0.30);
    for (const s of [-1, 1]) { const [cx2, cy2] = F(s * podW * 0.56, podW * 0.92);
      draw3DBoxAt(ctx, cam, cx2, cy2, podW * 0.026, 0, headZ, bronze, seed + 35 + s, night, alpha, false, eY, podW * 0.026);
      glowPool(ctx, cam, cx2, cy2, headZ * 0.94, warm, 5, alpha * (night ? 0.52 : 0.22)); }       // a lamp on each column
    // The building signs itself on the podium fascia, which keeps the kit's board and cables off it;
    // see docs/reference/world-rendering.md#an-arm-that-signs-itself.
    // ⚠ The plate's plane is a constant just inside the plot line, so `segFit` can't move it from under the words.
    const sgnY = 0.485, sgnZ0 = baseZ * 0.68, sgnZ1 = baseZ * 0.97, pw = Math.min(podW * 0.66, 0.42);
    // ⚠ The plate is flat: a box would wear its palette's window skin over the lettering.
    { const L = (x, z) => { const [wx, wy] = F(x, sgnY); return [wx, wy, z]; };
      emitFlat(ctx, cam, [L(-pw, sgnZ1), L(pw, sgnZ1), L(pw, sgnZ0), L(-pw, sgnZ0)], 'rgb(30,24,18)', alpha, { lift: DETAIL_LIFT }); }
    reserveSignBand(pw, (sgnZ0 + sgnZ1) * 0.5);
    if (frontVis) {
      // ⚠ Always bake, even without a name: the bake is what sets `armSignsItself` during capture.
      // The first word large, the rest under it (`couture`).
      const words = ((name || '').trim() || 'Solenne Residences').split(/\s+/);
      const nhw = pw * 0.90, iz0 = sgnZ0 + (sgnZ1 - sgnZ0) * 0.10, iz1 = sgnZ1 - (sgnZ1 - sgnZ0) * 0.10;
      const quad = (ox, oz) => { const y = sgnY + (ox ? 0.002 : 0.004), sx = ox * podW * 0.004, sz = oz * (sgnZ1 - sgnZ0) * 0.02;
        const [lx, ly] = F(-nhw + sx, y), [rx, ry] = F(nhw + sx, y);
        return [cam.proj(lx, ly, iz1 + sz), cam.proj(rx, ry, iz1 + sz), cam.proj(rx, ry, iz0 + sz), cam.proj(lx, ly, iz0 + sz)]; };
      embossText(ctx, cam, quad, words[0].toUpperCase(), '#f3dcae', '#0a0704', night, alpha,
        { font: 'couture', sub: words.slice(1).join(' ').toUpperCase() || undefined });
    }
    haloRim(ctx, cam, F, sgnY - 0.012, pw, sgnZ0, sgnZ1, (sgnZ1 - sgnZ0) * 0.05, night ? `rgba(${gold},0.95)` : 'rgba(24,18,10,0.7)', alpha);
    if (night) { const [sx2, sy2] = F(0, sgnY - 0.02); glowPool(ctx, cam, sx2, sy2, (sgnZ0 + sgnZ1) * 0.5, gold, 16, alpha * 0.45, { add: true }); }   // the halo behind the plate
    // The lobby, lit by day too. ⚠ Glows are depth-tested, so they sit on the glass at the plot line,
    // never inside the podium.
    { const [wx, wy] = F(0, 0.50);
      glowPool(ctx, cam, wx, wy, doorZ * 0.82, warm, 22, alpha * (night ? 0.40 : 0.13));
      glowPool(ctx, cam, wx, wy, doorZ * 0.24, warm, 18, alpha * (night ? 0.34 : 0.10)); }        // the lobby, spilling out across the pavement
    if (night) { const [ux, uy] = F(0, 0.50); glowPool(ctx, cam, ux, uy, headZ * 1.02, gold, 10, alpha * 0.34); }         // downlights in the canopy soffit
    // The shaft. ⚠ Every plate that steps in caps, or the ring it leaves exposed is a hole.
    for (let i = 0; i < N; i++) {
      const capped = i === N - 1 || segW(i + 1) < segW(i) - 1e-6;
      draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, capped, segYaw(i));
    }
    for (const dir of [[-1, -1], [1, 1]]) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
        pts.push([dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i)]);
      }
      if (pts.length > 1) emitLightRunner(ctx, cam, pts, `rgba(${gold},0.9)`, alpha * (night ? 0.92 : 0.5), night, gold, undefined, DECO_PULL);   // DECO_PULL: see Halcyon's runners
    }
    // The sky-deck pool band.
    { const z = segZ(N) - h * 0.06, r = segW(N - 1) * 1.08;
      drawRing(ctx, cam, dx, dy, z, r, 16, `rgba(${warm},${night ? 0.95 : 0.52})`, 2.2, alpha);
      if (night) glowPool(ctx, cam, dx, dy, z, gold, 15, alpha * 0.3); }
    // The lantern crown and helideck (af_solenne). ⚠ Never a mast over the touchdown circle.
    draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.86, topZ, topZ + h * 0.26, pal, seed + 20, night, alpha, true, twist);
    { const deckZ0 = topZ + h * 0.26, deckZ1 = deckZ0 + h * 0.04, padR = segW(N) * 1.15;
      // The deck is a captured box, so the sim lands on the pad you see.
      draw3DBoxAt(ctx, cam, dx, dy, padR, deckZ0, deckZ1, pal, seed + 21, night, alpha, true, twist);
      helideck(ctx, cam, dx, dy, deckZ1 + 0.002, padR * 0.86, gold, warm, night, alpha, now, seed);
      // The stair head. ⚠ In the rear corner, the only ground outside the touchdown circle (0.86).
      const sw = padR * 0.12, sa = padR * 0.8, sh = h * 0.045, ct = Math.cos(twist), st2 = Math.sin(twist);
      const corners = [[sa, sa], [sa, -sa], [-sa, sa], [-sa, -sa]].map(([lx, ly]) => [lx * ct - ly * st2, lx * st2 + ly * ct]);
      const [cxw, cyw] = corners.reduce((b, c) => (c[0] * E[0] + c[1] * E[1] < b[0] * E[0] + b[1] * E[1] ? c : b));
      draw3DBoxAt(ctx, cam, dx + cxw, dy + cyw, sw, deckZ1, deckZ1 + sh, stone, seed + 23, night, alpha, true, twist);
      const inX = -Math.sign(cxw * ct + cyw * st2), dxw = inX * (sw + 0.002) * ct, dyw = inX * (sw + 0.002) * st2;
      draw3DBoxAt(ctx, cam, dx + cxw + dxw, dy + cyw + dyw, 0.002, deckZ1, deckZ1 + sh * 0.74, bronze, seed + 24, night, alpha, false, twist, sw * 0.42);
      if (night) glowPool(ctx, cam, dx + cxw + dxw, dy + cyw + dyw, deckZ1 + sh * 0.82, warm, 5, alpha * 0.5); }
    if (night) {
      glowPool(ctx, cam, dx, dy, baseZ, warm, 22, alpha * 0.3);                     // warm lobby wash
      glowPool(ctx, cam, dx, dy, baseZ + (topZ - baseZ) * 0.5, gold, 13, alpha * 0.2);  // mid sky-lobby glow
      glowPool(ctx, cam, dx, dy, topZ + h * 0.1, gold, 16, alpha * 0.32);            // crown halo
    }
  },
  chrome(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Chrome Court: a tapered mirror-steel obelisk ringed with cyan LED bands.
    const led = '90,220,255';                              // cyan LED tech accent
    const NF = 10, baseZ = h * 0.22, topZ = h * 2.35;      // decagon: smooth but faceted; slightly shorter than Halcyon
    const rB = fh * 0.88, rShaftB = rB * 0.94, rT = fh * 0.4;   // wide base tapering to a slim crown
    const steelBase = WALL_COL[pal] || [118, 126, 136];    // ty_chrome
    const rAt = (t) => rShaftB + (rT - rShaftB) * t;       // shaft radius at height-fraction t
    // Mirror-steel skin: sky above, dark steel mid, ground sheen low, shaded per facet.
    const mirror = (f, tp, bt) => {
      const g = ctx.createLinearGradient(0, tp, 0, bt), s = 0.45 + f.nl * 0.6;
      if (night) {
        g.addColorStop(0, `rgba(${72 * s | 0},${96 * s | 0},${122 * s | 0},0.97)`);   // cool night sky on the steel
        g.addColorStop(0.5, `rgba(${38 * s | 0},${48 * s | 0},${60 * s | 0},0.97)`);
        g.addColorStop(1, `rgba(${58 * s | 0},${70 * s | 0},${84 * s | 0},0.97)`);     // city glow reflected low
      } else {
        g.addColorStop(0, `rgba(${182 + f.nl * 48 | 0},${202 + f.nl * 38 | 0},226,0.97)`);   // bright sky mirror
        g.addColorStop(0.44, `rgba(${steelBase[0] * s | 0},${steelBase[1] * s | 0},${steelBase[2] * s | 0},0.97)`);
        g.addColorStop(1, `rgba(${150 + f.nl * 40 | 0},${164 + f.nl * 34 | 0},178,0.97)`);   // ground sheen
      }
      return g;
    };
    const capCol = night ? 'rgba(46,58,72,0.97)' : 'rgba(178,196,216,0.97)';
    drawFacetDrum(ctx, cam, dx, dy, 0, baseZ, rB * 1.06, rB * 0.96, NF, alpha, mirror, capCol, 'ty_hf_mirror_dk');   // the plinth: a darker mirror, so the monolith stands on something
    drawFacetDrum(ctx, cam, dx, dy, baseZ, topZ, rShaftB, rT, NF, alpha, mirror, null);
    for (const t of [0.14, 0.3, 0.46, 0.78]) {
      const z = baseZ + (topZ - baseZ) * t;
      drawRing(ctx, cam, dx, dy, z, rAt(t) * 1.015, NF, `rgba(${led},${night ? 0.85 : 0.42})`, 1.6, alpha);
    }
    { const t = 0.6, z = baseZ + (topZ - baseZ) * t, r = rAt(t) * 1.05;
      drawRing(ctx, cam, dx, dy, z, r, NF, `rgba(200,240,255,${night ? 0.95 : 0.5})`, 2.4, alpha);
      drawRing(ctx, cam, dx, dy, z + h * 0.06, r, NF, `rgba(${led},${night ? 0.8 : 0.4})`, 1.4, alpha);
      if (night) glowPool(ctx, cam, dx, dy, z, led, 16, alpha * 0.3); }
    drawFacetDrum(ctx, cam, dx, dy, topZ, topZ + h * 0.22, rT * 1.08, rT * 0.52, NF, alpha, mirror, capCol);
    drawRing(ctx, cam, dx, dy, topZ + h * 0.02, rT * 1.14, NF, `rgba(${led},${night ? 0.9 : 0.45})`, 1.8, alpha);
    mast(ctx, cam, dx, dy, topZ + h * 0.22, topZ + h * 0.58, alpha, now, seed);
    glowPool(ctx, cam, dx, dy, topZ * 0.5, '198,214,230', 20, alpha * (night ? 0.3 : 0.16));   // cold chrome sheen up the face
    if (night) { glowPool(ctx, cam, dx, dy, baseZ, '150,200,240', 22, alpha * 0.28); glowPool(ctx, cam, dx, dy, topZ + h * 0.08, led, 14, alpha * 0.3); }
    blinkLight(ctx, cam, dx, dy, topZ + h * 0.58, led, now, seed, alpha, 2);
  },
  meridian(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Meridian: a stepped art deco limestone tower under a copper cupola. No neon.
    const trim = 'ty_archive_col', bronze = 'ty_meridian_bronze';                                     // warm limestone trim + dark bronze entrance metal
    // ⚠ Copper roof faces over limestone sides (`facePals`): from the air, roofs are most of what you see.
    const copper = 'ty_verdigris';
    const deck = facePals(E, { side: pal, roof: copper });                                            // a terrace: limestone walls, copper deck
    const ledge = facePals(E, { side: trim, roof: copper });                                          // a cornice ledge: stone fascia, copper flashing
    const zPod = h * 0.24, zShaft = h * 1.04, zSet1 = h * 1.52, zSet2 = h * 1.86, zCrown = h * 2.06;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.34, 0, zPod, pal, seed + 5, night, alpha, true);              // podium
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.40, zPod, zPod + h * 0.045, ledge, seed + 6, night, alpha, true);   // base cornice band
    // The entrance: a portal of three orders built out from the podium face, round bronze doors.
    { const L = (x, y, z) => { const [wx, wy] = F(x, y); return [wx, wy, z]; };
      const yaw = Math.atan2(-E[0], E[1]);
      const RB = (x, y, hw, fd, z0, z1, p, s) => { const [bx, by] = F(x, y); draw3DBoxAt(ctx, cam, bx, by, hw, z0, z1, p, seed + s, night, alpha, true, yaw, fd); };
      const face = Math.min(fh * 1.34, 0.44), open = fh * 0.25, zOpen = zPod * 0.80, zTop = zPod + h * 0.03, dz = (zTop - zOpen) / 3;
      for (let i = 0; i < 3; i++) {                                                                    // the orders, inner first
        const d = fh * 0.035 * (3 - i), yc = face + d / 2, jx = open + fh * 0.06 * (i + 0.5);
        for (const s of [-1, 1]) RB(s * jx, yc, fh * 0.03, d / 2, 0, zOpen + dz * i, trim, 40 + i * 2 + (s > 0));
        RB(0, yc, open + fh * 0.06 * (i + 1), d / 2, zOpen + dz * i, zOpen + dz * (i + 1), trim, 47 + i);
      }
      RB(0, face + fh * 0.15, fh * 0.46, fh * 0.05, 0, h * 0.008, trim, 51);                           // a single broad stone step
      // ⚠ The doors stand flush with the inner order's front: set back, DETAIL_LIFT pulls them through the jambs.
      const yD = face + fh * 0.107, Pq = (pts, fill, back = 0) => emitFlat(ctx, cam, pts.map(([x, z]) => L(x, yD - back, z)), fill, alpha, { lift: DETAIL_LIFT });
      const glass = night ? 'rgba(255,200,128,0.98)' : 'rgba(64,80,94,0.98)';
      const bronzeC = 'rgb(72,52,30)', gilt = 'rgb(214,170,92)';
      const zDoor = zOpen * 0.62, zBar = zDoor + h * 0.008;
      Pq([[-open, zOpen], [open, zOpen], [open, 0], [-open, 0]], bronzeC, fh * 0.003);   // the bronze frame, a hair behind the glass or the two decals fight
      for (const s of [-1, 1]) {                                                                       // two glazed leaves, a brass pull on each
        const a = s * fh * 0.015, b = s * (open - fh * 0.025);
        Pq([[a, zDoor - h * 0.006], [b, zDoor - h * 0.006], [b, h * 0.012], [a, h * 0.012]], glass);
        const px = s * fh * 0.035;
        Pq([[px - fh * 0.004, zDoor * 0.62], [px + fh * 0.004, zDoor * 0.62], [px + fh * 0.004, zDoor * 0.38], [px - fh * 0.004, zDoor * 0.38]], gilt);
      }
      Pq([[-open, zBar], [open, zBar], [open, zDoor], [-open, zDoor]], gilt);                          // the gilt transom bar
      { const r = Math.min(open - fh * 0.025, zOpen - zBar - h * 0.006), N = 16, fan = [[0, zBar]];  // the sunburst fanlight
        for (let k = 0; k <= N; k++) { const t = Math.PI * k / N; fan.push([Math.cos(t) * r, zBar + Math.sin(t) * r]); }
        Pq(fan, glass);
        for (let k = 1; k < 8; k++) {                                                                  // seven bronze rays
          const t = Math.PI * k / 8, c = Math.cos(t), sn = Math.sin(t), w = fh * 0.005;
          Pq([[-sn * w, zBar], [sn * w, zBar], [c * r + sn * w, zBar + sn * r - c * w], [c * r - sn * w, zBar + sn * r + c * w]], bronzeC);
        }
      }
      for (const s of [-1, 1]) {                                                                       // bronze lanterns on the outer order
        const lx = s * (open + fh * 0.24);
        RB(lx, face + fh * 0.12, fh * 0.03, fh * 0.03, zOpen * 0.55, zOpen * 0.80, bronze, 52 + (s > 0));
        const [gx, gy] = F(lx, face + fh * 0.16);
        glowPool(ctx, cam, gx, gy, zOpen * 0.68, '255,196,120', 6, alpha * (night ? 0.55 : 0.22));
      }
      if (night) { const [gx, gy] = F(0, face + fh * 0.2); glowPool(ctx, cam, gx, gy, zOpen * 0.4, '255,190,110', 12, alpha * 0.4); }   // the lobby spilling out
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, zPod + h * 0.045, zShaft, pal, seed, night, alpha, true);
    // The gilt nameplate in the frieze.
    { const friZ0 = zPod + h * 0.07, friZ1 = zPod + h * 0.17, fr = Math.min(fh * 1.10, 0.44);   // the frieze as segFit leaves it: a box never reaches past 0.44, a decal does
      draw3DBoxAt(ctx, cam, dx, dy, fr, friZ0, friZ1, trim, seed + 46, night, alpha, false);    // stone frieze band on the lower shaft
      const L = (x, y, z) => { const [wx, wy] = F(x, y); return [wx, wy, z]; };
      const pz0 = friZ0 + h * 0.008, pz1 = friZ1 - h * 0.008, phw = fh * 0.78, yP = fr + 0.022, yG = yP + 0.002;
      const Pq = (y, pts, fill) => emitFlat(ctx, cam, pts.map(([x, z]) => L(x, y, z)), fill, alpha, { lift: DETAIL_LIFT });
      const giltC = 'rgb(214,170,92)', ft = h * 0.004, fw = fh * 0.008;
      // ⚠ The plate stands 0.022 off the stone to clear the window-skin decals; it can't be a box.
      haloRim(ctx, cam, F, yP - 0.004, phw, pz0, pz1, h * 0.006, night ? 'rgba(255,206,130,0.95)' : 'rgba(30,22,14,0.75)', alpha);
      if (night) glowPool(ctx, cam, ...F(0, yP - 0.006), (pz0 + pz1) * 0.5, '255,200,120', 14, alpha * 0.3, { add: true });
      Pq(yP, [[-phw, pz1], [phw, pz1], [phw, pz0], [-phw, pz0]], 'rgb(40,30,20)');
      Pq(yG, [[-phw, pz1], [phw, pz1], [phw, pz1 - ft], [-phw, pz1 - ft]], giltC);
      Pq(yG, [[-phw, pz0 + ft], [phw, pz0 + ft], [phw, pz0], [-phw, pz0]], giltC);
      for (const s of [-1, 1]) {
        Pq(yG, [[s * phw - s * fw, pz1], [s * phw, pz1], [s * phw, pz0], [s * phw - s * fw, pz0]], giltC);
        const cx = s * fh * 0.66, zc = pz0 + ft * 2, r = (pz1 - pz0) * 0.72;                          // a five-ray sunburst
        for (let k = 1; k < 6; k++) {
          const t = Math.PI * k / 6, c = Math.cos(t), sn = Math.sin(t), w = fh * 0.004;
          Pq(yG, [[cx - sn * w, zc], [cx + sn * w, zc], [cx + c * r + sn * w, zc + sn * r - c * w], [cx + c * r - sn * w, zc + sn * r + c * w]], giltC);
        }
      }
      if (night) { const [gx, gy] = F(0, fr + fh * 0.14); glowPool(ctx, cam, gx, gy, friZ0, '255,214,150', 9, alpha * 0.4); }
      if (frontVis) {
        const nhw = fh * 0.56, zt = friZ1 - h * 0.014, zb = friZ0 + h * 0.014;
        const quad = (ox, oz) => { const y = yG + fh * (ox ? 0.001 : 0.003), sx = ox * fh * 0.006, sz = oz * h * 0.0025;
          const [lx, ly] = F(-nhw + sx, y), [rx, ry] = F(nhw + sx, y);
          return [cam.proj(lx, ly, zt + sz), cam.proj(rx, ry, zt + sz), cam.proj(rx, ry, zb + sz), cam.proj(lx, ly, zb + sz)]; };
        embossText(ctx, cam, quad, 'THE MERIDIAN', '#e8c878', '#120c06', night, alpha);   // solid: cut gilt, not a tube, so no dead letter
      } }
    // Pilasters at the corners and mid-faces, front-centre skipped for the entrance.
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[1,0],[-1,0]]) {
      const [px, py] = F(sx * fh * 1.02, sy * fh * 1.02);
      draw3DBoxAt(ctx, cam, px, py, fh * (sx && sy ? 0.13 : 0.10), zPod, zShaft + h * 0.04, trim, seed + 20 + sx * 3 + sy, night, alpha, false);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.13, zShaft, zShaft + h * 0.045, ledge, seed + 7, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, zShaft + h * 0.045, zSet1, pal, seed + 1, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.89, zSet1, zSet1 + h * 0.04, ledge, seed + 8, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.58, zSet1 + h * 0.04, zSet2, pal, seed + 2, night, alpha, true);
    // The crown block and its finned coronet.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, zSet2, zSet2 + h * 0.035, ledge, seed + 9, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.40, zSet2 + h * 0.035, zCrown, deck, seed + 3, night, alpha, true);   // the crown deck
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[1,0],[0,1],[-1,0]]) {
      const [fx, fy] = F(sx * fh * 0.42, sy * fh * 0.42);
      draw3DBoxAt(ctx, cam, fx, fy, fh * (sx && sy ? 0.06 : 0.05), zSet2 + h * 0.02, zCrown + h * (sx && sy ? 0.11 : 0.06), trim, seed + 50 + sx * 3 + sy, night, alpha, true);
    }
    // The stone lantern and copper ogee cupola.
    const lantZ0 = zCrown, lantZ1 = zCrown + h * 0.16, lantR = fh * 0.26;
    const stoneRGB = WALL_COL[trim] || [150, 142, 124];
    const lantStyle = (f) => { const s = (night ? 0.44 : 0.78) + f.nl * 0.5; return `rgba(${stoneRGB[0]*s|0},${stoneRGB[1]*s|0},${stoneRGB[2]*s|0},0.97)`; };
    drawFacetDrum(ctx, cam, dx, dy, lantZ0, lantZ1, lantR * 1.04, lantR, 8, alpha, lantStyle, null, trim);   // ⚠ `lantStyle` shades from TRIM, so the capture is told too (drawFacetDrum)
    const cupH = h * 0.30, cupR = lantR * 1.12, apex = lantZ1 + cupH;
    // Records itself as the Hall of Records' dome does. ⚠ In copper, never `SHAPE_PAL`, or every
    // capture reader draws it as stone.
    if (SHAPE_SINK) SHAPE_SINK.push({ kind: 'drum', dx, dy, wz0: lantZ1, wz1: apex, rb: cupR, rt: cupR * 0.08, n: 12, cap: false, pal: copper });
    // ⚠ Paint as drum bands, and skip them under a capture (as the Hall of Records does).
    if (!SHAPE_SINK) {
      const CU = WALL_COL[copper];   // ⚠ read, never restated: the decks share this palette
      const rAt = (t) => cupR * Math.pow(Math.max(0, 1 - t * t), 0.7);
      const BANDS = 8;
      for (let i = 0; i < BANDS; i++) {
        const t0 = i / BANDS, t1 = (i + 1) / BANDS;
        const sh = 0.68 + 0.32 * t0;   // lighter toward the apex
        const style = (f) => { const k = sh * (0.82 + (f.nl || 0) * 0.36);
          return `rgb(${Math.round(CU[0] * k)},${Math.round(CU[1] * k)},${Math.round(CU[2] * k)})`; };
        drawFacetDrum(ctx, cam, dx, dy, lantZ1 + cupH * t0, lantZ1 + cupH * t1, rAt(t0), rAt(t1), 12, alpha, style, null, copper);   // the mesh runs these, not the push above (drawFacetDrum)
      }
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.05, apex, apex + h * 0.12, trim, seed + 4, night, alpha, false);   // stone finial
    blinkLight(ctx, cam, dx, dy, apex + h * 0.16, '255,196,120', now, seed, alpha, 1.8);
    // Gargoyles at the shaft cornice corners.
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [gx, gy] = F(sx * fh * 0.9, sy * fh * 0.9);
      drawGargoyle(ctx, cam, gx, gy, zShaft + h * 0.045, fh * 0.42, [gx - dx, gy - dy], alpha, night, seed + 30 + sx * 2 + sy);
    }
    if (night) {
      glowPool(ctx, cam, dx, dy, h * 0.9, '255,200,130', 14, alpha * 0.16);                            // scattered warm windows up the shaft
      glowPool(ctx, cam, dx, dy, zPod + h * 0.04, '255,206,140', 22, alpha * 0.24);                    // floodlit limestone base
      glowPool(ctx, cam, dx, dy, zPod * 0.5, '255,190,120', 12, alpha * 0.30);                         // warm spill from the lobby entrance
      glowPool(ctx, cam, dx, dy, apex, '150,220,190', 10, alpha * 0.16);                               // faint copper-crown wash
    }
  },
  divebar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Sump / The Green Room: a low bar read by what's bolted to it.
    const grime = pal, brick = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, 0, h * 0.62, grime, seed, night, alpha, false);
    // A stepped parapet. ⚠ Unyawed boxes stay square and centred or on the diagonal: `F()` turns the
    // position, not the footprint, and `gl:mesh` needs the same extent at every facing.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, h * 0.62, h * 0.72, brick, seed + 11, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, h * 0.72, h * 0.84, brick, seed + 12, night, alpha, true);
    // The back-of-house lean-to.
    { const [bx2, by2] = F(-fh * 0.6, -fh * 0.6);
      draw3DBoxAt(ctx, cam, bx2, by2, fh * 0.3, 0, h * 0.34, brick, seed + 13, night, alpha, true); }
    { const [nx, ny] = F(fh * 0.42, fh * 0.5); neonBlade(ctx, cam, nx, ny, h * 0.62, h * 0.98, m.neon || '#5fd0ff', night, alpha); }   // blade over the door
    { const [vx, vy] = F(-fh * 0.6, fh * 0.2); drawSmoke(ctx, cam, vx, vy, h * 0.62, '120,116,110', alpha * 0.4, now, seed + 3); }      // kitchen/vent smoke
    if (night) glowPool(ctx, cam, dx, dy, h * 0.28, '255,180,90', 10, alpha * 0.2);                   // grimy amber window
    if (m.perch) {   // The Dead Pigeon: its stuffed bird on a pole over the register
      // ⚠ fh·0.84 puts the pole on the setback terrace, outside the upper storey.
      const [px, py] = F(0, fh * 0.84);
      mast(ctx, cam, px, py, h * 0.72, h * 0.82, alpha, now, seed + 7);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.08, h * 0.82, h * 0.9, 'ty_door', seed + 8, night, alpha, true);   // the pigeon silhouette
    }
  },
  strip(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Cherry Pit: a windowless club with a loud entrance.
    const neon = m.neon || '#ff4a9a';
    const dark = pal, trim2 = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, 0, h * 0.8, dark, seed, night, alpha, false);
    // A blank parapet hides the roof.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.09, h * 0.8, h * 0.9, trim2, seed + 14, night, alpha, true);
    // The entrance porch and canopy.
    { const [px2, py2] = F(0, fh * 1.0);
      draw3DBoxAt(ctx, cam, px2, py2, fh * 0.4, 0, h * 0.36, trim2, seed + 15, night, alpha, true, 0, fh * 0.22);
      draw3DBoxAt(ctx, cam, px2, py2, fh * 0.5, h * 0.36, h * 0.4, dark, seed + 16, night, alpha, true, 0, fh * 0.3); }
    { const [ax, ay] = F(-fh * 0.4, 0); neonBlade(ctx, cam, ax, ay, h * 0.8, h * 1.15, neon, night, alpha); }
    { const [bx, by] = F(fh * 0.4, 0); neonBlade(ctx, cam, bx, by, h * 0.8, h * 1.15, neon, night, alpha); }
    { const [gx, gy] = F(0, fh * 0.95); glowPool(ctx, cam, gx, gy, 0.02, '220,40,70', 16, alpha * (night ? 0.5 : 0.3)); }   // cherry-red spill out the entrance
    glowPool(ctx, cam, dx, dy, h * 0.85, '255,74,120', 20, alpha * (night ? 0.36 : 0.16));            // roofline wash
  },
  grocery(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ration Nine: neighbourhood store + a long front awning, stacked crates, and a lit sign
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, h * 0.6, pal, seed, night, alpha, true);
    awning(ctx, cam, dx, dy, E, fh * 1.06, fh * 1.05, h * 0.14, h * 0.28, 'ty_door', seed + 1, night, alpha, fh * 0.30);   // full-width awning
    for (const s of [-0.7, 0.7]) { const [cx, cy] = F(s * fh * 0.7, fh * 0.82); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.22, 0, h * 0.14, 'ty_door', seed + 9 + s * 3, night, alpha, true); }   // crates out front
    neonBlade(ctx, cam, dx, dy, h * 0.55, h * 0.85, m.neon || '#ffcf3e', night, alpha);
    if (night) glowPool(ctx, cam, dx, dy, h * 0.26, '255,214,140', 12, alpha * 0.22);                 // lit aisles through the glass
  },
  church(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // St Garneau's: a twin-tower granite front, a barrel-vaulted nave behind it, and the eye plastered across the middle of it
    // The eye plate is the only thing lit all night besides the tower lights that frame it.
    // ⚠ Keep the paired towers: a single tower reads as a flue at range.
    const trim = 'ty_church_trim', slate = [74, 78, 84];
    // ⚠ Every dimension lives here so all three masses and the flat detail agree on the frontage `HD`.
    const HW = fh * 0.44, HD = fh * 0.94;         // the nave: narrow, and long back off the street
    const PLTH = h * 0.10;                        // the battered base course the whole front stands on
    const EAVE = h * 0.92;                        // where the nave wall stops…
    // ⚠ The rise (in h) is tuned to the half-span (in fh) so the arch comes out round-headed;
    // fh and h are independent, so check both if either changes.
    const ARCH = h * 0.46;                        // …and the barrel over it; its front tympanum is the great arch
    const TWHW = fh * 0.26, TWX = fh * 0.71;      // the towers: the pair spans 0.97 of the footprint
    const TWY = HD - TWHW;                        // …front faces flush with the nave front
    const SHAFT = h * 1.26, BELF0 = h * 1.32;     // the shaft, and the corbel course the belfry stands on
    const BELF1 = h * 1.70, CORN = h * 1.80, CAP = h * 1.96;
    // The base course, the nave and its barrel vault, a hair wider than the wall.
    draw3DBoxAt(ctx, cam, dx, dy, HW * 1.10, 0, PLTH, trim, seed, night, alpha, false, faceYaw(E), HD * 1.04);
    draw3DBoxAt(ctx, cam, dx, dy, HW, PLTH, EAVE, pal, seed + 1, night, alpha, false, faceYaw(E), HD);
    drawBarrelRoof(ctx, cam, F, 0, HW * 1.02, HD, EAVE, ARCH, 16, alpha, slate);
    // The towers, square so no yaw. ⚠ The belfry stage is stone with openings cut in (§3c); a dark
    // box reads as a soot-stained chimney.
    for (const s of [-1, 1]) {
      const [tx, ty] = F(s * TWX, TWY);
      draw3DBoxAt(ctx, cam, tx, ty, TWHW, 0, SHAFT, pal, seed + 10 + s, night, alpha, false);                // the shaft
      draw3DBoxAt(ctx, cam, tx, ty, TWHW * 1.07, SHAFT, BELF0, trim, seed + 12 + s, night, alpha, false);     // the corbel course under the belfry
      draw3DBoxAt(ctx, cam, tx, ty, TWHW * 0.96, BELF0, BELF1, pal, seed + 14 + s, night, alpha, false);      // the belfry stage
      // The corner buttresses.
      for (const ux of [-1, 1]) for (const uy of [-1, 1]) {
        const [qx, qy] = F(s * TWX + ux * TWHW * 0.80, TWY + uy * TWHW * 0.80);
        draw3DBoxAt(ctx, cam, qx, qy, TWHW * 0.24, BELF0, BELF1, trim, seed + 16 + ux + uy * 2 + s, night, alpha, false);
      }
      draw3DBoxAt(ctx, cam, tx, ty, TWHW * 1.18, BELF1, CORN, trim, seed + 24 + s, night, alpha, false);      // the corbelled cornice
      // Crenellations: a flat lid reads as a flue.
      for (const ux of [-1, 1]) for (const uy of [-1, 1]) {
        const [qx, qy] = F(s * TWX + ux * TWHW * 0.78, TWY + uy * TWHW * 0.78);
        draw3DBoxAt(ctx, cam, qx, qy, TWHW * 0.32, CORN, CAP, trim, seed + 26 + ux + uy * 2 + s, night, alpha, true);
      }
    }
    // The front: flat work in the wall planes, captured once into the per-model mesh.
    if (frontVis) {
      const trimCss = (k) => shadeOf(trim, k);
      const dark = night ? 'rgb(10,11,14)' : 'rgb(20,22,26)';
      // A model-local direction in world space, taken from `F` so the rotation is written once.
      const [o0, o1] = F(0, 0);
      const nOf = (nx, ny) => { const [px, py] = F(nx, ny); return [px - o0, py - o1]; };
      // ⚠ `emitFlat` takes the normal off the winding and never flips it; openings sit in three planes,
      // so `facing` winds each toward its stated normal (safe locally: `F` is a rotation about z).
      const facing = (pts, nx, ny) => {
        let ax = 0, ay = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          ax += (a[1] - b[1]) * (a[2] + b[2]);
          ay += (a[2] - b[2]) * (a[0] + b[0]);
        }
        return (ax * nx + ay * ny) >= 0 ? pts : pts.slice().reverse();
      };
      // ⚠ The mesh ignores `lift`, so stacked layers stand off the wall by a distance derived from
      // their lift, outermost at the back; see docs/reference/world-rendering.md#lift-is-a-sort-bias-the-mesh-ignores.
      const LIFT_LAYER = 0.06;                                   // the lift increment one layer is worth
      const standOff = (lift) => FACE_EPS * (1 + (lift / DETAIL_LIFT - 1) / LIFT_LAYER * 0.5);
      // A round-headed opening: `O` a point in the wall, `A` across it, `N` its outward normal, all
      // model-local. On the GL path these flats are already in the mesh, so skip them (`flatsDropped`).
      const flatsDropped = FLAT_OFF && !MESH_SINK && !SHAPE_SINK;
      const arched = (O, A, N, cu, hwd, z0, z1, fill, lift) => {
        if (flatsDropped) return;
        const zs = z1 - hwd, P = [], eps = standOff(lift);
        const put = (u, z) => P.push([O[0] + (cu + u) * A[0] + N[0] * eps,
                                      O[1] + (cu + u) * A[1] + N[1] * eps, z]);
        put(-hwd, zs);
        for (let i = 1; i < 14; i++) { const t = Math.PI - i / 14 * Math.PI; put(Math.cos(t) * hwd, zs + Math.sin(t) * hwd); }
        put(hwd, zs); put(hwd, z0); put(-hwd, z0);
        emitFlat(ctx, cam, facing(P, N[0], N[1]).map(([x, y, z]) => W3(x, y, z)), fill, alpha,
          { lift, cullN: nOf(N[0], N[1]) });
      };
      // A straight panel in the same frame: a stile, a hinge, a mullion.
      const panel = (O, A, N, u0, u1, z0, z1, fill, lift) => {
        if (flatsDropped) return;
        const eps = standOff(lift);
        const put = (u, z) => [O[0] + u * A[0] + N[0] * eps, O[1] + u * A[1] + N[1] * eps, z];
        emitFlat(ctx, cam, facing([put(u0, z1), put(u1, z1), put(u1, z0), put(u0, z0)], N[0], N[1])
          .map(([x, y, z]) => W3(x, y, z)), fill, alpha, { lift, cullN: nOf(N[0], N[1]) });
      };
      // A chamber behind an opening, solved each frame onto the wall plane with `slideToPlane`.
      // ⚠ Decals, never mesh (the solve needs the live eye); staggered layers; solved onto the
      // backstop's plane via its own lift. See docs/reference/world-rendering.md#a-chamber-behind-an-opening.
      const recess = (O, A, N, cu, hwd, z0, z1, depth, lift) => {
        const e0 = standOff(lift);
        const L = (u, y, z) => W3(O[0] + (cu + u) * A[0] + N[0] * (e0 + y), O[1] + (cu + u) * A[1] + N[1] * (e0 + y), z);
        let [nx, ny] = nOf(N[0], N[1]);
        const nl = Math.hypot(nx, ny); if (!(nl > 1e-6)) return;
        nx /= nl; ny /= nl;
        const AW = L(0, 0, z0), NW = [nx, ny];
        // ⚠ Skip a wall turned away: the 2-D fallback has no depth buffer to hide it, and this keeps
        // the solve's `t` in (0, 1).
        if (faceAway(cam, AW[0], AW[1], nx, ny)) return;
        const zs = z1 - hwd, iw = hwd * 0.84;
        // The aperture in the plane's `[u, z]` frame, counter-clockwise for `clipToAperture`; the
        // same opening `arched` cuts.
        const AP = [[-hwd, z0], [hwd, z0], [hwd, zs]];
        for (let i = 1; i < 12; i++) { const t = i / 12 * Math.PI; AP.push([Math.cos(t) * hwd, zs + Math.sin(t) * hwd]); }
        AP.push([-hwd, zs]);
        // The plane's across-direction, taken from `L` so the rotation is written once.
        const A1 = L(1, 0, z0);
        let ax = A1[0] - AW[0], ay = A1[1] - AW[1];
        const al = Math.hypot(ax, ay); if (!(al > 1e-6)) return;
        ax /= al; ay /= al;
        // Slide corners onto the wall and clip to the hole. `null`: the wall covers all of it.
        const cut = (pts) => {
          const pl = [];
          for (const pt of pts) {
            const s = slideToPlane(cam, AW, NW, pt);
            if (!s) return null;
            pl.push([(s[0] - AW[0]) * ax + (s[1] - AW[1]) * ay, s[2]]);
          }
          const c = clipToAperture(pl, AP);
          return c.length >= 3 ? c.map((p) => [AW[0] + ax * p[0], AW[1] + ay * p[0], p[1]]) : null;
        };
        const arch = (rr, y) => {
          const o = [[-rr, y, zs]];
          for (let i = 1; i < 12; i++) { const t = Math.PI - i / 12 * Math.PI; o.push([Math.cos(t) * rr, y, zs + Math.sin(t) * rr]); }
          o.push([rr, y, zs], [rr, y, z0], [-rr, y, z0]);
          return o.map(([u, yy, z]) => L(u, yy, z));
        };
        // ⚠ Each layer stands alone: at a grazing angle the back wall clips away first.
        const back = cut(arch(iw, -depth));
        if (back) emitDecoFill(ctx, cam, back, night ? 'rgb(6,7,9)' : 'rgb(15,17,21)', alpha, 0.006, 'churchbay');
        for (const sg of [-1, 1]) {
          const j = cut([L(sg * hwd, 0, z0), L(sg * hwd, 0, zs), L(sg * iw, -depth, zs), L(sg * iw, -depth, z0)]);
          if (j) emitDecoFill(ctx, cam, j, trimCss(night ? 0.34 : 0.54), alpha, 0.012, 'churchbay');
        }
        const sl = cut([L(-hwd, 0, z0), L(hwd, 0, z0), L(iw, -depth, z0), L(-iw, -depth, z0)]);
        if (sl) emitDecoFill(ctx, cam, sl, trimCss(night ? 0.42 : 0.68), alpha, 0.018, 'churchbay');
        // The bell.
        const bw = hwd * 0.50, bz0 = z0 + (zs - z0) * 0.26, bz1 = zs + hwd * 0.26, by = -depth * 0.55;
        const bl = cut([L(-bw * 0.40, by, bz1), L(bw * 0.40, by, bz1), L(bw, by, bz0), L(-bw, by, bz0)]);
        if (bl) emitDecoFill(ctx, cam, bl, night ? 'rgb(32,30,25)' : 'rgb(80,72,52)', alpha, 0.024, 'churchbay');
      };
      // Stained glass unlit from behind: full value by day, a fifth after dark (`glassCss`).
      // ⚠ Weighted to blue and red; 8 entries over 12 lights so the pattern never repeats.
      // ⚠ Values are low because GLASS 2's tonemap raises them.
      const GLASS = ['30,50,98', '88,26,30', '32,54,104', '106,82,28',
                     '26,44,88', '84,24,28', '28,56,44', '90,28,32'];
      const glassCss = (i) => {
        const g = GLASS[((i % GLASS.length) + GLASS.length) % GLASS.length].split(',').map(Number), d = night ? 0.20 : 1;
        return 'rgb(' + Math.round(g[0] * d) + ',' + Math.round(g[1] * d) + ',' + Math.round(g[2] * d) + ')';
      };
      const timber = night ? 'rgb(28,21,16)' : 'rgb(62,45,32)';
      const iron = night ? 'rgb(18,19,22)' : 'rgb(34,36,40)';
      const FRONT = [[0, HD], [1, 0], [0, 1]];   // the frontage: origin, across, outward
      // The three portals. Timber leaves fill each arch; the kit's glazing is declined (`KIT_DECLINE`).
      for (const [cx, hwd, top] of [[0, HW * 0.40, PLTH + h * 0.50],
                                    [-TWX, TWHW * 0.52, PLTH + h * 0.38],
                                    [TWX, TWHW * 0.52, PLTH + h * 0.38]]) {
        const [O, A, N] = FRONT;
        arched(O, A, N, cx, hwd * 1.34, PLTH, top + hwd * 0.42, trimCss(1.14), DETAIL_LIFT * 1.00);
        arched(O, A, N, cx, hwd * 1.15, PLTH, top + hwd * 0.20, trimCss(0.86), DETAIL_LIFT * 1.06);
        arched(O, A, N, cx, hwd, PLTH, top, dark, DETAIL_LIFT * 1.12);
        // The leaves, inside the reveal.
        const lw = hwd * 0.92, lz = top - hwd * 0.07, zs = lz - lw;
        arched(O, A, N, cx, lw, PLTH, lz, timber, DETAIL_LIFT * 1.18);
        panel(O, A, N, cx - lw * 0.035, cx + lw * 0.035, PLTH, lz, iron, DETAIL_LIFT * 1.24);   // the meeting stile
        // Three strap hinges a leaf.
        for (const f of [0.17, 0.52, 0.85]) {
          const bz = PLTH + (zs - PLTH) * f, bh = hwd * 0.045;
          for (const sg of [-1, 1]) {
            panel(O, A, N, cx + sg * lw * 0.94, cx + sg * lw * 0.12, bz - bh, bz + bh, iron, DETAIL_LIFT * 1.30);
          }
        }
      }
      // The blind arcade under the eaves.
      { const n = 9, w = HW * 1.88 / n;
        for (let i = 0; i < n; i++) {
          arched(FRONT[0], FRONT[1], FRONT[2], -HW * 0.94 + w * (i + 0.5), w * 0.38,
            EAVE - h * 0.15, EAVE - h * 0.03, trimCss(0.60), DETAIL_LIFT * 1.05);
        } }
      // The nave lights: four lancets a flank (declining the kit's `wall` took its window grid too).
      { const s0 = PLTH + (EAVE - PLTH) * 0.30, s1 = PLTH + (EAVE - PLTH) * 0.84, lw = HD * 0.082;
        for (const sd of [-1, 1]) {
          const O = [sd * HW, 0], A = [0, sd], N = [sd, 0];
          for (let i = 0; i < 4; i++) {
            const cu = sd * (-HD * 0.60 + i * HD * 0.40);
            arched(O, A, N, cu, lw * 1.32, s0 - h * 0.025, s1 + lw * 0.36, trimCss(1.10), DETAIL_LIFT * 1.05);
            arched(O, A, N, cu, lw, s0, s1, dark, DETAIL_LIFT * 1.15);
            arched(O, A, N, cu, lw * 0.80, s0 + lw * 0.16, s1 - lw * 0.10, glassCss(i + (sd > 0 ? 0 : 2)), DETAIL_LIFT * 1.22);
            panel(O, A, N, cu - lw * 0.055, cu + lw * 0.055, s0 + lw * 0.16, s1 - lw * 0.10, trimCss(0.72), DETAIL_LIFT * 1.28);
          }
        }
      }
      // The belfry openings on the front and both flanks of each tower.
      for (const s of [-1, 1]) {
        const CX = s * TWX, W2 = TWHW * 0.96;
        for (const [O, A, N] of [[[CX, TWY + W2], [1, 0], [0, 1]],
                                 [[CX + W2, TWY], [0, 1], [1, 0]],
                                 [[CX - W2, TWY], [0, -1], [-1, 0]]]) {
          for (const u of [-1, 1]) {
            const cu = u * TWHW * 0.34, bz0 = BELF0 + h * 0.08, bz1 = BELF1 - h * 0.11;
            arched(O, A, N, cu, TWHW * 0.28, BELF0 + h * 0.06, BELF1 - h * 0.08, trimCss(1.10), DETAIL_LIFT * 1.2);
            arched(O, A, N, cu, TWHW * 0.21, bz0, bz1, dark, DETAIL_LIFT * 1.3);
            // The flat dark arch stays as the mesh backstop; the chamber draws over it with a live eye.
            recess(O, A, N, cu, TWHW * 0.21, bz0, bz1, TWHW * 0.62, DETAIL_LIFT * 1.3);
          }
        }
      }
      // The wheel window and the eye over it share one centre and radius.
      const ROSE_Z = EAVE + ARCH * 0.16, ROSE_R = fh * 0.21;
      // ⚠ Emit the wheel before the eye: the mass pass writes depth, so the eye first hides the wheel.
      { const [rx, ry] = F(0, HD + FACE_EPS); wallRose(ctx, cam, rx, ry, E, ROSE_Z, ROSE_R, '196,200,208', night, alpha, 12, GLASS); }
      // The eye. ⚠ A `wallDisc`, never `drawRing` (a horizontal hoop). ⚠ Stand-off FACE_EPS * 4 just
      // clears the wheel's front at * 3; more and the eye slides off the window.
      { const [ex, ey] = F(0, HD + FACE_EPS * 4);
        wallDisc(ctx, cam, ex, ey, E, ROSE_Z, ROSE_R, '176,196,220', night, alpha,
          { lens: true, pupil: 0.15, iris: 0.34, depth: 0.06, opacity: 0.40, markOpacity: 0.94 }); }
      // The tower lights: plate tracery, the only glass lit from inside.
      // ⚠ Night colour is the day glass at full value, enough to clear the shader's night dim
      // (`litK` in gl/context.js) without going pastel. ⚠ Same face count day and night (`tileMesh`).
      { const lt = clamp(night, 0, 1);
        const lit = (rgb) => {
          const g = rgb.split(',').map(Number), k = 255 / Math.max(g[0], g[1], g[2]);
          return g.map((v) => Math.min(255, v * k));
        };
        const paneCss = (i) => {
          const day = GLASS[i % GLASS.length];
          const d = day.split(',').map(Number), n = lit(day);
          return 'rgb(' + d.map((v, c) => Math.round(v + (n[c] - v) * lt)).join(',') + ')';
        };
        const SAPPHIRE = paneCss(0), RUBY = paneCss(1), COBALT = paneCss(2), GOLD = paneCss(3);
        const GARNET = paneCss(5), EMERALD = paneCss(6);
        const [O, A, N] = FRONT;
        const disc = (u, z, r, fill, lift) => {
          if (flatsDropped) return;
          const eps = standOff(lift), P = [];
          for (let i = 0; i < 12; i++) {
            const t = -i / 12 * 6.2832, uu = u + Math.cos(t) * r;
            P.push([O[0] + uu * A[0] + N[0] * eps, O[1] + uu * A[1] + N[1] * eps, z + Math.sin(t) * r]);
          }
          emitFlat(ctx, cam, facing(P, N[0], N[1]).map(([x, y, z2]) => W3(x, y, z2)), fill, alpha,
            { lift, cullN: nOf(N[0], N[1]) });
        };
        const L = (k) => DETAIL_LIFT * k;
        // The opening's half-width, sill, crown and springing.
        const W0 = TWHW * 0.62, s0 = ROSE_Z - h * 0.32, s1 = ROSE_Z + h * 0.22, zsR = s1 - W0;
        // A lancet's offset, half-width, sill and crown.
        const LU = W0 * 0.42, lw = W0 * 0.30, l0 = s0 + W0 * 0.16, l1 = zsR - W0 * 0.04;
        const gw = lw * 0.80, gl0 = l0 + lw * 0.14, gl1 = l1 - lw * 0.10, gzs = gl1 - gw;
        const band = (gzs - gl0) / 3, rm = Math.min(gw * 0.50, band * 0.40), bar = lw * 0.045;
        const BEADS = 7, bh = (gzs - gl0) / BEADS;
        const OZ = zsR + W0 * 0.36, OR = W0 * 0.34;
        for (const s of [-1, 1]) {
          const cu = s * TWX;
          arched(O, A, N, cu, W0 * 1.20, s0 - h * 0.025, s1 + W0 * 0.22, trimCss(1.10), L(1.05));   // the hood
          arched(O, A, N, cu, W0, s0, s1, dark, L(1.10));                                            // the reveal
          arched(O, A, N, cu, W0 * 0.90, s0 + W0 * 0.06, s1 - W0 * 0.10, trimCss(0.84), L(1.14));   // the slab
          for (const k of [-1, 1]) {
            const lu = cu + k * LU;
            arched(O, A, N, lu, lw, l0, l1, dark, L(1.18));
            arched(O, A, N, lu, gw, gl0, gl1, SAPPHIRE, L(1.22));
            // The beaded border.
            for (const e of [-1, 1]) {
              const a = lu + e * gw * 0.64, b = lu + e * gw;
              panel(O, A, N, Math.min(a, b), Math.max(a, b), gl0, gzs, iron, L(1.25));
              for (let i = 0; i < BEADS; i++) {
                const c = lu + e * gw * 0.68, d = lu + e * gw * 0.96;
                panel(O, A, N, Math.min(c, d), Math.max(c, d), gl0 + bh * i + bh * 0.08, gl0 + bh * (i + 1) - bh * 0.08,
                  (i + (k > 0 ? 1 : 0)) % 2 ? GOLD : RUBY, L(1.27));
              }
            }
            // Three medallions and the saddle bars.
            for (let i = 0; i < 3; i++) {
              const zc = gl0 + band * (i + 0.5);
              disc(lu, zc, rm * 1.16, iron, L(1.28));
              disc(lu, zc, rm, i === 1 ? GARNET : RUBY, L(1.30));
              disc(lu, zc, rm * 0.46, i === 1 ? EMERALD : GOLD, L(1.33));
            }
            for (let i = 1; i <= 3; i++) {
              const z = gl0 + band * i;
              panel(O, A, N, lu - gw, lu + gw, z - bar, z + bar, iron, L(1.36));
            }
            disc(lu, gzs + gw * 0.40, gw * 0.42, iron, L(1.28));
            disc(lu, gzs + gw * 0.40, gw * 0.34, GOLD, L(1.30));
          }
          // The rose over the two lancets.
          disc(cu, OZ, OR, dark, L(1.18));
          disc(cu, OZ, OR * 0.86, COBALT, L(1.22));
          for (let i = 0; i < 6; i++) {
            const t = i / 6 * 6.2832 + Math.PI / 2, pu = cu + Math.cos(t) * OR * 0.50, pz = OZ + Math.sin(t) * OR * 0.50;
            disc(pu, pz, OR * 0.27, iron, L(1.28));
            disc(pu, pz, OR * 0.22, GARNET, L(1.30));
          }
          disc(cu, OZ, OR * 0.25, iron, L(1.31));
          disc(cu, OZ, OR * 0.19, GOLD, L(1.33));
          // ⚠ The halo sits at the glass (behind it the wall hides it) and is `air` so it doesn't light the tower.
          const [gx, gy] = F(cu, HD + fh * 0.03);
          if (lt > 0.02) {
            glowPool(ctx, cam, gx, gy, (gl0 + gzs) / 2, '170,130,230', 5, alpha * 0.20 * lt, { air: true });
            glowPool(ctx, cam, gx, gy, OZ, '220,140,170', 4, alpha * 0.16 * lt, { air: true });
          }
        }
      }
    }
  },
  butcher(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Meat Your Maker: an oxblood shopfront with a smokehouse flue
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, h * 0.62, pal, seed, night, alpha, true);              // single-storey shop
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, h * 0.62, h * 0.7, pal, seed + 1, night, alpha, false);    // flat roof with a lipped parapet
    awning(ctx, cam, dx, dy, E, fh * 1.02, fh * 1.05, h * 0.16, h * 0.3, 'ty_door', seed + 2, night, alpha, fh * 0.30);   // awning over the window
    { const [sx, sy] = F(-fh * 0.55, -fh * 0.5); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.16, h * 0.62, h * 1.24, pal, seed + 3, night, alpha, false); }   // smokehouse flue
    { const [cx, cy] = F(-fh * 0.55, -fh * 0.5); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.24, h * 1.24, h * 1.32, 'ty_door', seed + 4, night, alpha, false); }   // rain cap
    { const [px, py] = F(-fh * 0.55, -fh * 0.5); glowPool(ctx, cam, px, py, h * 1.42, '150,150,158', 13, alpha * (night ? 0.2 : 0.3)); }   // the thread of smoke off the cap, heavier by day when it reads against sky
    neonBlade(ctx, cam, dx, dy, h * 0.58, h * 0.88, m.neon || '#ff3e4a', night, alpha);
    if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, h * 0.24, '255,120,110', 12, alpha * 0.26); }   // the case lights through the window, red on red
  },
  techstall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ohm Sweet Ohm: a two-storey electronics shop under an overpass girder
    // The piers stand outside the shop's flanks (shop ±0.368, piers 0.408 to 0.488 at fh 0.4).
    const techFront = facePals(E, { side: pal, front: 'ty_shop_b' });
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, h * 0.44, techFront, seed, night, alpha, false);      // shopfront storey, glazing to the street
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.44, h * 0.50, pal, seed + 1, night, alpha, false); // the cornice that separates the two floors
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, h * 0.50, h * 0.96, pal, seed + 3, night, alpha, false); // workshop floor, set back off the shopfront
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.66, h * 0.96, h * 1.06, pal, seed + 4, night, alpha, true);  // roof plant box, the deck the kit stands its plant on
    for (const s of [-1, 1]) { const [sx, sy] = F(s * fh * 1.12, -fh * 0.1); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.1, 0, h * 1.5, pal, seed + 6 + s, night, alpha, false); }   // overpass piers, clear of the shop
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.4, h * 1.5, h * 1.68, pal, seed + 5, night, alpha, true);    // the girder deck overhead
    neonBlade(ctx, cam, dx, dy, h * 0.44, h * 1.02, m.neon || '#5fd0ff', night, alpha);               // full-height blade up the corner
    glowPool(ctx, cam, dx, dy, h * 0.3, '95,208,255', 12, alpha * (night ? 0.4 : 0.22));              // cyan gear-glow spilling off the counter
  },
  showroom(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Dead Space Interiors: a glazed showroom floor with a big lit display window
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, h * 0.44, facePals(E, { side: pal, front: 'ty_shop_c' }), seed, night, alpha, false);   // the glazed showroom floor
    { const [wx4, wy4] = F(0, fh * 0.92); glowPool(ctx, cam, wx4, wy4, h * 0.26, '150,220,190', 20, alpha * (night ? 0.42 : 0.24)); }   // display-window glow
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, h * 0.44, h * 0.50, pal, seed + 2, night, alpha, false);   // fascia at the head of the glass
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.50, h * 0.80, pal, seed + 3, night, alpha, false);   // the solid floor above it
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.66, h * 0.80, h * 0.92, pal, seed + 1, night, alpha, true);    // slim parapet band
    { const [bx, by] = F(0, fh * 1.16); neonBlade(ctx, cam, bx, by, h * 0.92, h * 1.2, m.neon || '#7dff6a', night, alpha); }
  },
  boutique(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Second Skin: a narrow tall shopfront with a full-height neon fashion blade + warm display glow
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, 0, h * 0.34, facePals(E, { side: pal, front: 'ty_shop_c' }), seed, night, alpha, false);   // the display window
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, h * 0.34, h * 0.39, pal, seed + 1, night, alpha, false);   // the fascia over it
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, h * 0.39, h * 0.94, pal, seed + 2, night, alpha, false);   // the floors above, set back off the shopfront
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, h * 0.94, h * 1.02, pal, seed + 3, night, alpha, true);     // parapet cap
    // ⚠ Anchor the blade outside the shopfront face, or it's drawn through the mass (glself).
    { const [nx, ny] = F(fh * 0.58, fh * 0.86); neonBlade(ctx, cam, nx, ny, h * 0.28, h * 1.05, m.neon || '#ff4a9a', night, alpha); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.22, '255,150,200', 10, alpha * 0.28);                 // lit boutique window
  },
  nightclub(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Voltage: a near-black monolith with a floor-to-roof blue name blade
    const neon = m.neon || '#5cd6ff';
    const crown2 = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, 0, h * 1.05, pal, seed, night, alpha, false);             // tall near-black slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, h * 1.05, h * 1.2, crown2, seed + 1, night, alpha, true);  // parapet crown band
    // The entrance box.
    { const [ex2, ey2] = F(0, fh * 1.02);
      draw3DBoxAt(ctx, cam, ex2, ey2, fh * 0.38, 0, h * 0.3, crown2, seed + 12, night, alpha, true, 0, fh * 0.18); }
    // The plant deck, set back on the roof.
    { const [rx2, ry2] = F(fh * 0.36, -fh * 0.3);
      draw3DBoxAt(ctx, cam, rx2, ry2, fh * 0.3, h * 1.2, h * 1.34, crown2, seed + 13, night, alpha, true); }
    { const [ax, ay] = F(0, fh * 0.98); neonBlade(ctx, cam, ax, ay, 0, h * 1.2, neon, night, alpha); } // the floor-to-roof name blade
    for (const s of [-0.62, -0.2, 0.2, 0.62]) { const [lx, ly] = F(s * fh, fh * 0.98); blinkLight(ctx, cam, lx, ly, h * 1.16, '92,214,255', now, seed + s * 11, alpha, 1.6); }   // chasing crown bulbs
    { const [gx, gy] = F(0, fh * 1.0); glowPool(ctx, cam, gx, gy, 0.02, '70,150,255', 18, alpha * (night ? 0.5 : 0.28)); }   // blue spill out the door
    glowPool(ctx, cam, dx, dy, h * 1.14, '92,150,255', 22, alpha * (night ? 0.42 : 0.2));              // laser-blue roofline wash
  },
  atelier(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Aurelia: a tall graphite-glass couture monolith over a street vitrine
    const neon = m.neon || '#b070ff';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, 0, h * 0.26, facePals(E, { side: pal, front: 'ty_shop_c' }), seed + 4, night, alpha, false);   // the vitrine at street level
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.84, h * 0.26, h * 0.31, pal, seed + 5, night, alpha, false);   // the reveal over it
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, h * 0.31, h * 1.12, pal, seed, night, alpha, false);       // slender dark-glass shaft
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, h * 1.12, h * 1.2, pal, seed + 1, night, alpha, true);      // slim lit parapet cap
    { const [nx, ny] = F(fh * 0.5, fh * 0.86); neonBlade(ctx, cam, nx, ny, h * 0.2, h * 1.16, neon, night, alpha); }   // slim full-height violet name-blade by the door
    if (night) { const [wx, wy] = F(0, fh * 0.72); glowPool(ctx, cam, wx, wy, h * 0.2, '176,112,255', 9, alpha * 0.22); }   // one restrained violet vitrine glow
  },
  // Terminus' glasshouses: the one thing the Exodus let you see over their wall. Lit by grow-lamps at night.
  greenhouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    const glass = [176, 198, 190];
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, h * 0.16, pal, seed, night, alpha, true);          // stone knee-wall
    drawBarrelRoof(ctx, cam, F, 0, fh * 0.92, fh * 0.72, h * 0.16, h * 0.52, 10, alpha, glass);    // the glazed vault
    // Ridge vents.
    for (const s of [-0.5, 0, 0.5]) {
      const [vx, vy] = F(s * fh * 0.7, 0);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.1, h * 0.66, h * 0.74, 'ty_door', seed + 3 + s * 4, night, alpha, false);
    }
    // A water butt at the gable end.
    { const [bx, by] = F(fh * 0.8, fh * 0.6); draw3DBoxAt(ctx, cam, bx, by, fh * 0.18, 0, h * 0.3, 'ty_door', seed + 9, night, alpha, true); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.5, '150,255,180', 14, alpha * 0.3);   // the grow-lamps
  },
  junkshop(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Velk's Pre-Owned Furnishings: cluttered main shed + lean-to + junk stacked on the roof
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.6, pal, seed, night, alpha, true);              // main shed
    { const [lx, ly] = F(fh * 0.95, 0); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.5, 0, h * 0.4, pal, seed + 1, night, alpha, true); }   // lean-to annex
    for (const s of [-0.5, 0.1, 0.6]) { const [jx, jy] = F(s * fh * 0.9, -fh * 0.2); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.18, h * 0.6, h * (0.68 + frac(seed + s * 7) * 0.12), 'ty_door', seed + 10 + s * 5, night, alpha, true); }   // roof junk piles
    neonBlade(ctx, cam, dx, dy, h * 0.6, h * 0.86, m.neon || '#ff8a4a', night, alpha);
    if (night) glowPool(ctx, cam, dx, dy, h * 0.26, '255,170,110', 10, alpha * 0.2);
  },
  apartment(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // residential block: podium + tall slab, stepped roofline, rooftop water tank & lift housing
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, h * 0.2, pal, seed + 5, night, alpha, true);          // ground-floor podium
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.2, h * 1.02, pal, seed, night, alpha, true);        // main residential slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, h * 1.02, h * 1.18, pal, seed + 4, night, alpha, true);   // set-back top floors → a stepped roofline
    if (m.penthouse) { const [px, py] = F(fh * 0.3, 0); draw3DBoxAt(ctx, cam, px, py, fh * 0.42, h * 1.18, h * 1.32, pal, seed + 2, night, alpha, true); }
    { const [tx, ty] = F(-fh * 0.34, -fh * 0.22); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.16, h * 1.18, h * 1.34, 'ty_door', seed + 6, night, alpha, true); }   // rooftop water tank on stilts
    { const [cx, cy] = F(fh * 0.3, fh * 0.12); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.2, h * 1.18, h * 1.25, 'ty_door', seed + 7, night, alpha, true); }         // lift/AC housing
    if (night) glowPool(ctx, cam, dx, dy, h * 0.6, '255,206,140', 10, alpha * 0.12);                   // scattered lit windows
  },
  police(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Precinct 9 (922,911), the only tile that reaches this arm; other civic and police tiles are
    // named and have their own. `TYPE_MODEL.civic`/`.police` stay as the fallback for an unnamed tile.
    const stone = pal, base = 'ty_precast_dk', attic = 'ty_precast';
    // ⚠ The order is `ty_marble_col` (STONE_WALL): `ty_precast` paints a window grid on the frieze.
    const order = 'ty_marble_col';
    const bz = h * 0.13, wallTop = h * 0.86, atticTop = h * 1.04;
    const colTop = h * 0.40, friezeTop = h * 0.50;   // the portico order, and the band it carries
    const sgnW = fh * 0.50, sgnZ = h * 0.45;         // …which is where the station's name is cut
    // ⚠ Reserved unconditionally, never inside `frontVis`: `gl:mesh` needs the same faces at every facing.
    reserveSignBand(sgnW, sgnZ);
    // A storey-high base course.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, bz, base, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, bz, wallTop, stone, seed + 1, night, alpha, false);
    // The portico. ⚠ Its depths are a ladder (wall front 1.13, columns 1.073 to 1.177, frieze front
    // 1.20) with nothing within 0.02 of a parallel face, and the bay stops at `colTop`, or they z-fight.
    { const [px0, py0] = F(0, fh * 0.86);
      draw3DBoxAt(ctx, cam, px0, py0, fh * 0.46, bz, colTop, stone, seed + 2, night, alpha, true, 0, fh * 0.27);
      for (const s of [-3, -1, 1, 3]) { const [cx2, cy2] = F(s * fh * 0.145, fh * 1.125);
        draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.052, bz, colTop, order, seed + 3 + s, night, alpha, false, 0, fh * 0.052); }
      // The frieze the name is cut into, overhanging the columns that carry it.
      draw3DBoxAt(ctx, cam, px0, py0, fh * 0.52, colTop, friezeTop, order, seed + 8, night, alpha, true, 0, fh * 0.34); }
    // The pale attic storey.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, wallTop, atticTop, attic, seed + 5, night, alpha, true);
    // An off-centre roof house.
    { const [rx, ry] = F(-fh * 0.3, -fh * 0.22);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.3, atticTop, atticTop + h * 0.16, base, seed + 6, night, alpha, true); }
    { const [mx, my] = F(fh * 0.9, 0); mast(ctx, cam, mx, my, atticTop, h * 1.62, alpha, now, seed + 3); }
    { const [bx, by] = F(-fh * 0.7, 0); blinkLight(ctx, cam, bx, by, h, '90,150,255', now, seed, alpha, 1.8); }
    // The name cut into the frieze, never a `marqueeBand` (`fasciaKind` could roll a lightbox).
    // ⚠ Always bake: the bake keeps the kit's board off. ⚠ `dn: 0` and `solid`, or it bakes as neon.
    if (frontVis) {
      // ⚠ The lettering stands DETAIL_LIFT off the frieze as `tileFitBox` trims it (to TILE_REACH):
      // coplanar it loses the depth test silently, and smaller stand-offs measured invisible.
      const nz0 = colTop + h * 0.022, nz1 = friezeTop - h * 0.022, nhw = fh * 0.44;
      const ny = Math.min(fh * 1.20, TILE_REACH) + DETAIL_LIFT;
      const [nlx, nly] = F(-nhw, ny), [nrx, nry] = F(nhw, ny);
      const TL = cam.proj(nlx, nly, nz1), TR = cam.proj(nrx, nry, nz1);
      const BR = cam.proj(nrx, nry, nz0), BL = cam.proj(nlx, nly, nz0);
      // ⚠ Bronze ink: one texture serves day and night, and bronze reads on both lit and unlit stone.
      const tex = bakeSignText('PRECINCT 9', '#a8801f', 0, false, true);
      if (tex && [TL, TR, BR, BL].every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      // The frieze floodlight. ⚠ On the lettering's plane: a depth-tested glow at the frieze is hidden by it.
      { const [gx, gy] = F(0, ny); glowPool(ctx, cam, gx, gy, (nz0 + nz1) * 0.5, '206,222,250', 12, alpha * (night ? 0.62 : 0.14)); }
      // The badge. ⚠ Hung on the wall `draw3DBoxAt` resolves (half-width capped at 0.44), or it floats.
      const wallY = Math.min(fh * 1.10, 0.44), br = fh * 0.17;
      const [ax, ay] = F(0, wallY + br * 0.16);
      wallBadge(ctx, cam, ax, ay, E, h * 0.66, br, '214,178,96', night, alpha);
      // The blue lamp over the door.
      const [lx2, ly2] = F(0, fh * 1.12);
      glowPool(ctx, cam, lx2, ly2, h * 0.38, '90,150,255', 13, alpha * (night ? 0.85 : 0.3));
    }
  },
  clinic(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The clinic (16 tiles): a clean glazed front and a dark service wing.
    const clean = pal, panel = 'ty_precast', dark = 'ty_precast_dk';
    const gf = h * 0.30, wallTop = h * 0.88, capTop = h * 1.06;
    // A glazed ground floor, recessed under the mass above.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, 0, gf, 'ty_clone_vat', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, gf, wallTop, clean, seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.21, h * 0.62, h * 0.68, panel, seed + 2, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.72, wallTop, capTop, panel, seed + 3, night, alpha, true);
    // The service wing and its flue.
    { const [wx2, wy2] = F(-fh * 0.96, -fh * 0.42);
      draw3DBoxAt(ctx, cam, wx2, wy2, fh * 0.34, 0, h * 0.54, dark, seed + 4, night, alpha, true);
      // ⚠ `style` is a function of the facet, never a colour: a string throws mid-frame (`shapes:smoke`).
      drawFacetDrum(ctx, cam, wx2, wy2 - fh * 0.1, h * 0.54, h * 0.92, fh * 0.07, fh * 0.06, 8, alpha,
        (f) => 'rgb(' + (62 + f.nl * 30 | 0) + ',' + (66 + f.nl * 32 | 0) + ',' + (72 + f.nl * 34 | 0) + ')', 'rgb(44,48,54)'); }
    // The cross, sized off both axes so it never overhangs the tile or outgrows a short building.
    roofCross(ctx, cam, dx, dy, E, capTop, Math.min(fh * 0.44, h * 0.24), '232,62,62', night, alpha);
    // The lobby light and the vats' green wash.
    if (frontVis) { const [gx, gy] = F(0, fh * 1.0);
      glowPool(ctx, cam, gx, gy, gf * 0.6, '210,240,235', 15, alpha * (night ? 0.6 : 0.22)); }
    glowPool(ctx, cam, dx, dy, h * 0.4, '120,220,150', 16, alpha * (night ? 0.28 : 0.14));
  },
  ksabstudio(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB-7, the basin's TV station: a blind sound stage, fly tower, plant deck, a windowed
    // production wing and the transmitter mast. ⚠ No rooflights on a sound stage.
    // ⚠ Read the note on `marqueeStand` before moving a band onto a sub-box.
    const KSABc = m.neon || '#39d6ff';                       // the station's own cyan
    const ONAIR = '#ff4a34';                                 // the one red on the plot, never decoration
    const L = (lx, ly, z) => { const w = facePt(dx, dy, lx, ly, E); return [w[0], w[1], z]; };
    const P = (lx, ly, z) => { const w = facePt(dx, dy, lx, ly, E); return cam.proj(w[0], w[1], z); };
    const apron = h * 0.035;
    // The apron.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, apron, 'ty_ksab_dk', seed + 9, night, alpha, false);
    // The sound stage, set back and pushed left to give the wing a frontage.
    const sgx = -fh * 0.16, sgy = -fh * 0.20, mhx = fh * 0.72;
    const [cx, cy] = F(sgx, sgy);
    // ⚠ Wide and low: at full height a clear-span stage reads as a tower.
    const mh = apron + h * 0.58, deck = mh + h * 0.03;
    draw3DBoxAt(ctx, cam, cx, cy, mhx, apron, mh, pal, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, cx, cy, mhx * 1.03, apron, apron + h * 0.13, 'ty_ksab_dk', seed + 1, night, alpha, false);   // the base course it gets reversed into
    draw3DBoxAt(ctx, cam, cx, cy, mhx * 1.04, mh, deck, 'ty_ksab_dk', seed + 2, night, alpha, true);                   // capping course
    const face = sgy + mhx + FACE_EPS;                       // the stage's own front plane, which is what its signage goes on
    // The fly tower over the rear corner.
    { const [tx, ty] = F(-fh * 0.36, -fh * 0.44);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, deck, deck + h * 0.30, 'ty_ksab_dk', seed + 3, night, alpha, true); }
    // The plant deck.
    { const [ax, ay] = F(fh * 0.06, fh * 0.06);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.24, deck, deck + h * 0.11, 'ty_ksab_dk', seed + 4, night, alpha, true);
      drawRing(ctx, cam, ax, ay, deck + h * 0.11, fh * 0.11, 12, 'rgba(126,138,150,0.55)', 1.4, alpha); }              // the extract cowl
    { const [ex, ey] = F(-fh * 0.50, fh * 0.02);
      draw3DBoxAt(ctx, cam, ex, ey, fh * 0.13, deck, deck + h * 0.07, 'ty_ksab_dk', seed + 6, night, alpha, true); }   // the chiller beside it
    // The transmitter.
    const mx0 = fh * 0.24, my0 = -fh * 0.42;
    const [lx, ly] = F(mx0, my0), mastTop = deck + h * 2.1;
    latticeTower(ctx, cam, lx, ly, deck, mastTop, fh * 0.14, fh * 0.04, alpha, now, seed + 5);
    dish(ctx, cam, lx, ly, deck + h * 0.60, 9, alpha);
    dish(ctx, cam, lx, ly, deck + h * 1.18, 7, alpha);
    blinkLight(ctx, cam, lx, ly, mastTop, '255,80,80', now, seed + 5, alpha, 2.0);
    blinkLight(ctx, cam, lx, ly, deck + h * 1.05, '255,80,80', now, seed + 7, alpha, 1.3);
    // Three guy stays. ⚠ Anchored in the local frame, or they walk off the deck on three facings.
    for (let i = 0; i < 3; i++) {
      const a = i * 2.0944 + 0.6, r = fh * 0.21;
      const [gx, gy] = F(mx0 + Math.cos(a) * r, my0 + Math.sin(a) * r);
      // ⚠ DECO_PULL: a stay hangs in open air, and the default pull drags it in front of the building (`glself`).
      emitWire(ctx, cam, [lx, ly, deck + (mastTop - deck) * 0.58], [gx, gy, deck], 0.9, 'rgba(170,180,194,0.5)', alpha, { pull: DECO_PULL });
    }
    // The production wing.
    { const [px, py] = F(fh * 0.74, -fh * 0.06);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.26, apron, apron + h * 0.42, 'ty_ksab_pc', seed + 8, night, alpha, true);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.28, apron + h * 0.42, apron + h * 0.46, 'ty_ksab_dk', seed + 10, night, alpha, true); }
    // The public front.
    const lobHalf = fh * 0.30, lobTop = apron + h * 0.22, lobY = fh * 0.50;
    const [ox, oy] = F(-fh * 0.10, lobY);
    draw3DBoxAt(ctx, cam, ox, oy, lobHalf, apron, lobTop, 'ty_ksab_glass', seed + 11, night, alpha, true);
    draw3DBoxAt(ctx, cam, ox, oy, lobHalf * 1.06, lobTop, lobTop + h * 0.04, 'ty_ksab_dk', seed + 12, night, alpha, true);   // the fascia the name goes on
    // The entrance canopy.
    { const zc = lobTop - h * 0.06, cw = fh * 0.22, cxo = -fh * 0.10, y0 = lobY + lobHalf * 0.6, y1 = lobY + fh * 0.34;
      emitFlat(ctx, cam, [L(cxo - cw, y0, zc), L(cxo + cw, y0, zc), L(cxo + cw, y1, zc), L(cxo - cw, y1, zc)],
        night ? 'rgba(46,52,58,0.96)' : 'rgba(74,82,88,0.96)', alpha, { stroke: 'rgba(18,22,26,0.6)', lw: 1 });
      emitWire(ctx, cam, L(cxo - cw * 0.9, y1, zc), L(cxo + cw * 0.9, y1, zc), 1.2,
        night ? 'rgba(120,226,255,0.85)' : 'rgba(150,186,204,0.7)', alpha, { pull: DECO_PULL, glow: night ? 6 : 0, glowCss: KSABc });
      for (const s of [-1, 1]) emitWire(ctx, cam, L(cxo + s * cw * 0.86, y1, zc), L(cxo + s * cw * 0.86, y1, apron), 1.3, 'rgba(150,160,170,0.7)', alpha, { pull: DECO_PULL }); }
    // The lobby fascia stays bare (the name goes on the stage wall); reserved so no generic sign takes it.
    reserveSignBand(lobHalf, lobTop + h * 0.022);
    // The station logo on the stage wall. ⚠ The call sign, never the tile's long name (unreadable).
    // ⚠ It ends at x = 0; the ON AIR box starts at fh * 0.02 at the same height.
    { const bz0 = apron + h * 0.33, bz1 = apron + h * 0.52, bxL = sgx - fh * 0.56, bxR = -fh * 0.01;
      const fz = face + FACE_EPS;
      emitDecoFill(ctx, cam, [L(bxL, face, bz1), L(bxR, face, bz1), L(bxR, face, bz0), L(bxL, face, bz0)],
        night ? 'rgba(12,22,30,0.96)' : 'rgba(22,34,44,0.96)', alpha, DECO_LIFT, 'ksablogo');
      const rz0 = bz0 + (bz1 - bz0) * 0.08, rz1 = bz0 + (bz1 - bz0) * 0.14;
      emitDecoFill(ctx, cam, [L(bxL + fh * 0.03, fz, rz1), L(bxR - fh * 0.03, fz, rz1), L(bxR - fh * 0.03, fz, rz0), L(bxL + fh * 0.03, fz, rz0)],
        night ? 'rgba(90,220,255,0.95)' : 'rgba(57,190,230,0.95)', alpha, DECO_LIFT, 'ksabrule');
      const dz = bz0 + (bz1 - bz0) * 0.58, r = Math.min(fh * 0.085, (bz1 - bz0) * 0.38), dcx = bxR - fh * 0.03 - r;
      const ring = [];
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ring.push(L(dcx + Math.cos(a) * r, fz, dz + Math.sin(a) * r)); }
      emitDecoFill(ctx, cam, ring, night ? 'rgba(90,220,255,0.97)' : 'rgba(57,190,230,0.97)', alpha, DECO_LIFT, 'ksabbug');
      const seven = bakeSignText('7', '#0c161e', 0, false, true);
      const s = r * 0.78, f2 = fz + FACE_EPS;
      const sq = [P(dcx - s, f2, dz + s), P(dcx + s, f2, dz + s), P(dcx + s, f2, dz - s), P(dcx - s, f2, dz - s)];
      if (seven && sq.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, sq, seven, false, alpha);
      const tex = bakeSignText('KSAB', KSABc, night ? 1 : 0, false);
      const tx0 = bxL + fh * 0.04, tx1 = dcx - r - fh * 0.04, tz0 = rz1 + (bz1 - bz0) * 0.06, tz1 = bz1 - (bz1 - bz0) * 0.06;
      const TL = P(tx0, f2, tz1), TR = P(tx1, f2, tz1), BR = P(tx1, f2, tz0), BL = P(tx0, f2, tz0);
      if (tex && [TL, TR, BR, BL].every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha); }
    // ON AIR: live from `studio_live` (broadcast plugin), else a duty cycle. ⚠ With motion off it's
    // on, which is what captures and gates see.
    const live = !motionOn() ? true
      : typeof state.studioLive === 'boolean' ? state.studioLive
      : dutyPhase(now, seed + 21, 210000, 0.66) >= 0;
    // ⚠ The red panel is the lamp and the letters are `solid` dark paint: neon ink's white core
    // swallows a glyph this size. ⚠ Keep it about 2.5:1, or `fitSignPts` shrinks the text to a thread.
    { const az0 = apron + h * 0.345, az1 = apron + h * 0.425, ax0 = fh * 0.26, aw = fh * 0.24;
      const pane = live ? (night ? 'rgba(232,58,38,0.95)' : 'rgba(208,50,32,0.95)') : 'rgba(58,26,22,0.95)';
      emitDecoFill(ctx, cam, [L(ax0 - aw, face, az1), L(ax0 + aw, face, az1), L(ax0 + aw, face, az0), L(ax0 - aw, face, az0)],
        pane, alpha, DECO_LIFT, 'onair');
      const tex = bakeSignText('ON AIR', '#180a08', 0, false, true);
      const iz0 = az0 + (az1 - az0) * 0.2, iz1 = az1 - (az1 - az0) * 0.2, iw = aw * 0.86;
      const TL = P(ax0 - iw, face + FACE_EPS, iz1), TR = P(ax0 + iw, face + FACE_EPS, iz1);
      const BR = P(ax0 + iw, face + FACE_EPS, iz0), BL = P(ax0 - iw, face + FACE_EPS, iz0);
      if (tex && [TL, TR, BR, BL].every((p) => p.f > 0.12))
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha * (live ? 1 : 0.55));
      if (live) { const [gx, gy] = F(ax0, face); glowPool(ctx, cam, gx, gy, (az0 + az1) * 0.5, '255,74,52', 11, alpha * (night ? 0.55 : 0.22)); } }
    // The uplink pad.
    { const [ux, uy] = F(-fh * 0.74, fh * 0.56);
      draw3DBoxAt(ctx, cam, ux, uy, fh * 0.22, apron, apron + h * 0.025, 'ty_ksab_pc', seed + 13, night, alpha, true);
      for (const [sx, sy, r] of [[-0.86, 0.54, 9], [-0.62, 0.60, 8]]) {
        const [px2, py2] = F(fh * sx, fh * sy);
        drawFacetDrum(ctx, cam, px2, py2, apron + h * 0.025, apron + h * 0.075, fh * 0.035, fh * 0.028, 8, alpha,
          (f) => { const k = 0.5 + f.nl * 0.5; return `rgb(${(126 * k) | 0},${(134 * k) | 0},${(142 * k) | 0})`; }, null);
        dish(ctx, cam, px2, py2, apron + h * 0.105, r, alpha);
      } }
    // Night: the stage stays dark.
    if (night) {
      glowPool(ctx, cam, ox, oy, lobTop * 0.6, '150,200,230', 12, alpha * 0.30);
      const [wx2, wy2] = F(fh * 0.74, -fh * 0.06);
      glowPool(ctx, cam, wx2, wy2, apron + h * 0.26, '226,214,170', 10, alpha * 0.20);
      glowPool(ctx, cam, cx, cy, deck, '96,206,240', 14, alpha * 0.12);
    }
  },
  studio(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB studio lot: a barrel-vaulted stage, a scene dock, an office wing, mast, dishes and a water tower
    const KSAB = m.neon || '#39d6ff';
    const sfw = fh * 0.6, wallTop = h * 0.82, archH = sfw * 0.6;                                          // hero-stage half-width, eaves height, barrel-vault rise (fh-scaled, like the diner/warehouse sheds)
    const stageBase = [96, 104, 112];                                                                     // cool steel roof/tank base tying the lot to the ty_ksab palette
    const metal = (r, g, b) => (f) => { const s = 0.5 + f.nl * 0.5; return `rgb(${r * s | 0},${g * s | 0},${b * s | 0})`; };
    // The hero stage under a barrel vault.
    { const [sx, sy] = F(-fh * 0.05, 0); draw3DBoxAt(ctx, cam, sx, sy, sfw, 0, wallTop, pal, seed, night, alpha, false); }   // roof left open for the barrel
    drawBarrelRoof(ctx, cam, F, -fh * 0.05, sfw, sfw * 0.94, wallTop, archH, 12, alpha, stageBase);
    { const [tx, ty] = F(-fh * 0.05, -sfw * 0.5); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, wallTop, wallTop + h * 0.5, pal, seed + 1, night, alpha, true); }
    if (frontVis) { const [gx, gy] = F(-fh * 0.05, sfw * 0.99); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.3, 0, h * 0.52, 'ty_door', seed + 2, night, alpha, true, 0, fh * 0.05); }
    { const [d2x, d2y] = F(fh * 0.56, -fh * 0.32); draw3DBoxAt(ctx, cam, d2x, d2y, fh * 0.32, 0, h * 0.62, pal, seed + 3, night, alpha, true);
      draw3DBoxAt(ctx, cam, d2x, d2y, fh * 0.2, h * 0.62, h * 0.74, 'ty_door', seed + 4, night, alpha, true); }
    { const [ox, oy] = F(fh * 0.4, sfw * 0.62); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.42, 0, h * 0.46, 'ty_ksab_glass', seed + 5, night, alpha, true);
      marqueeBand(ctx, cam, ox, oy, E, fh * 0.44, h * 0.34, KSAB, night, alpha, 'KSAB');
      if (night) glowPool(ctx, cam, ox, oy, h * 0.2, '255,210,150', 12, alpha * 0.24); }
    { const [mx, my] = F(-fh * 0.05, -sfw * 0.5); mast(ctx, cam, mx, my, wallTop + h * 0.5, wallTop + h * 1.9, alpha, now, seed + 6); }
    { const [e1x, e1y] = F(fh * 0.46, -fh * 0.16); dish(ctx, cam, e1x, e1y, h * 0.62, 9, alpha); }
    { const [e2x, e2y] = F(fh * 0.66, -fh * 0.46); dish(ctx, cam, e2x, e2y, h * 0.62, 8, alpha); }
    { const tcx = -fh * 0.6, tcy = -fh * 0.52, legTop = h * 0.7, [wx, wy] = F(tcx, tcy);
      for (const s of [-1, 1]) for (const t of [-1, 1]) { const [lx, ly] = F(tcx + s * fh * 0.1, tcy + t * fh * 0.1); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, 0, legTop, 'ty_door', seed + 8 + s + t * 2, night, alpha, false); }
      drawFacetDrum(ctx, cam, wx, wy, legTop, legTop + h * 0.26, fh * 0.16, fh * 0.16, 10, alpha, metal(stageBase[0], stageBase[1], stageBase[2]), 'rgb(70,60,92)');
      drawFacetDrum(ctx, cam, wx, wy, legTop + h * 0.26, legTop + h * 0.36, fh * 0.16, fh * 0.02, 10, alpha, metal(78, 68, 100), null); }   // conical cap
    { const [bx, by] = F(fh * 0.32, -sfw * 0.2); neonBlade(ctx, cam, bx, by, wallTop + archH, wallTop + archH + h * 0.6, KSAB, night, alpha, 'KSAB'); }
    if (night) { glowPool(ctx, cam, dx, dy, h * 0.6, '96,206,240', 16, alpha * 0.22);
      const [kx, ky] = F(-fh * 0.05, sfw * 0.6); glowPool(ctx, cam, kx, ky, h * 0.3, '190,200,255', 12, alpha * 0.16); }
  },
  studiogate(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB Writers' Wing: a glazed annex. ⚠ Keep everything inside its own tile (anything past it reaches the road).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, h * 0.06, pal, seed + 5, night, alpha, false);
    // ⚠ No roof cap on the lobby: it would z-fight the parapet's roof.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, h * 0.06, h * 0.9, 'ty_ksab_glass', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.9, h * 1.02, 'ty_ksab_dk', seed + 1, night, alpha, true);
    // ⚠ The marquee is always drawn (depth hides it), or it flickers at the facing threshold.
    marqueeBand(ctx, cam, dx, dy, E, fh * 0.82, h * 0.6, m.neon || '#39d6ff', night, alpha, 'KSAB');
    { const [bx, by] = F(-fh * 0.5, -fh * 0.42); neonBlade(ctx, cam, bx, by, h * 1.02, h * 1.34, m.neon || '#39d6ff', night, alpha); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.4, '96,206,240', 12, alpha * 0.24);   // the marquee wash, in the station's cyan
  },
  hangar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A small airfield: passenger lounge, hangar shed and control tower
    const top = h * (m.big ? 0.66 : 0.56), NF = 12;
    const base = WALL_COL[pal] || [96, 102, 112];
    const concrete = (f) => { const s = 0.6 + f.nl * 0.5; return `rgb(${base[0] * s | 0},${base[1] * s | 0},${base[2] * s | 0})`; };
    const steel = (r, gc, b) => (f) => { const s = 0.5 + f.nl * 0.5; return `rgb(${r * s | 0},${gc * s | 0},${b * s | 0})`; };
    const glass = (f, tp, bt) => {
      const g = ctx.createLinearGradient(0, tp, 0, bt), s = 0.55 + f.nl * 0.45;
      if (night) {
        g.addColorStop(0, `rgba(${70 * s | 0},${120 * s | 0},${150 * s | 0},0.95)`);
        g.addColorStop(0.55, `rgba(${52 * s | 0},${92 * s | 0},${120 * s | 0},0.95)`);
        g.addColorStop(1, 'rgba(210,178,120,0.95)');                                                             // warm consoles glimpsed low
      } else {
        g.addColorStop(0, `rgba(${150 + f.nl * 80 | 0},${188 + f.nl * 50 | 0},224,0.96)`);                       // bright sky-reflection crown
        g.addColorStop(0.5, `rgba(${78 + f.nl * 70 | 0},${120 + f.nl * 70 | 0},158,0.95)`);
        g.addColorStop(1, `rgba(${26 + f.nl * 28 | 0},${42 + f.nl * 28 | 0},62,0.96)`);                          // deep sill
      }
      return g;
    };
    // The passenger lounge: a glass pavilion with a lit interior seen through it.
    { const [lx, ly] = F(fh * 0.42, fh * 0.48), lH = top * 0.5, lR = fh * 0.44;
      const loungeGlass = (f, tp, bt) => {   // cooler + MORE TRANSPARENT than the cab glass so the lit interior shows through
        const g = ctx.createLinearGradient(0, tp, 0, bt);
        g.addColorStop(0, `rgba(${168 + f.nl * 60 | 0},${204 + f.nl * 40 | 0},234,0.5)`);
        g.addColorStop(1, `rgba(${58 + f.nl * 40 | 0},${88 + f.nl * 40 | 0},120,0.46)`);
        return g;
      };
      // The interior sits at the pavilion's centre depth, between the near and far glass.
      // ⚠ It stays on the canvas (on the depth buffer the pavilion's own glass hides it), so it must
      // ask `markHidden` itself: a raw emitFace skips the occlusion test and shows through buildings.
      const loungeD = cam.proj(lx, ly, lH * 0.4);
      if (!(GL_CELLS && TUNE.glDeco ? markHidden(cam, lx, ly, lH, lR) : decoHidden([loungeD]))) keptOnCanvas('departure-lounge', () => emitFace(loungeD.f, () => {
        ctx.globalAlpha = alpha;
        const fp = cam.proj(lx, ly, 0.02);
        if (fp.f > 0.1) { const r = clamp(24 / fp.f, 6, 40), rg = ctx.createRadialGradient(fp.sx, fp.sy, 1, fp.sx, fp.sy, r); rg.addColorStop(0, 'rgba(255,222,166,0.55)'); rg.addColorStop(1, 'rgba(255,222,166,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(fp.sx, fp.sy, r, 0, 7); ctx.fill(); }   // warm floor pool
        for (let i = -2; i <= 2; i++) { const sp = cam.proj(lx + i * fh * 0.12, ly + fh * 0.16, 0.03); if (sp.f <= 0.1) continue; const sz = clamp(3.6 / sp.f, 1.2, 7); ctx.fillStyle = 'rgba(28,26,30,0.8)'; ctx.fillRect(sp.sx - sz * 0.6, sp.sy - sz * 0.55, sz * 1.2, sz * 0.7); }   // bench row
        for (const dxF of [-fh * 0.16, fh * 0.12]) { const gp = cam.proj(lx + dxF, ly + fh * 0.04, 0.02), hp = cam.proj(lx + dxF, ly + fh * 0.04, lH * 0.34); if (gp.f <= 0.1 || hp.f <= 0.1) continue; const bw = clamp(2 / gp.f, 0.8, 5); ctx.fillStyle = 'rgba(22,20,26,0.85)'; ctx.beginPath(); ctx.moveTo(gp.sx - bw, gp.sy); ctx.lineTo(gp.sx + bw, gp.sy); ctx.lineTo(hp.sx + bw * 0.6, hp.sy); ctx.lineTo(hp.sx - bw * 0.6, hp.sy); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(hp.sx, hp.sy - bw * 0.5, bw * 0.7, 0, 7); ctx.fill(); }   // waiting passengers
        ctx.globalAlpha = 1;
      }));
      drawFacetDrum(ctx, cam, lx, ly, 0, lH, lR, lR * 0.98, 16, alpha, loungeGlass, steel(52, 58, 68)({ nl: 0.72 }));   // curved glass envelope (solid roof cap) over the lit interior
      drawRing(ctx, cam, lx, ly, lH * 0.5, lR * 0.99, 16, 'rgba(20,26,34,0.5)', 1, alpha);                         // mullion transom band
      const [cx, cy] = F(fh * 0.42, fh * 0.96); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.4, lH * 0.32, lH * 0.42, 'ty_door', seed + 9, night, alpha, true, 0, fh * 0.12);   // entrance canopy
      glowPool(ctx, cam, lx, ly, lH * 0.62, '255,214,150', 18, alpha * (night ? 0.4 : 0.2));                       // interior spill up top
    }
    // The hangar shed with an open bay; `noShed` leaves it out beside a field's real hangar.
    if (!m.noShed) { const hxL = -fh * 0.55, hw = fh * 0.5, wallTop = top * 0.52, archH = hw * 0.95;
      const [hx, hy] = F(hxL, 0);
      draw3DBoxAt(ctx, cam, hx, hy, hw, 0, wallTop, 'ty_hangarmetal', seed, night, alpha, false);                 // ribbed-steel walls (roof capped by the barrel)
      drawBarrelRoof(ctx, cam, F, hxL, hw, hw, wallTop, archH, 10, alpha, [138, 146, 156]);                        // curved corrugated roof + arched gables
      // The open bay on the +y gable.
      const [ox, oy] = F(0, 0), [f1x, f1y] = F(0, 1), FX = f1x - ox, FY = f1y - oy, [gcx, gcy] = F(hxL, hw);
      if (!faceAway(cam, gcx, gcy, FX, FY)) {
        const P = (llx, lly, z) => { const [wx, wy] = F(llx, lly); return cam.proj(wx, wy, z); };
        const odw = hw * 0.58, oTop = wallTop * 0.82, inset = hw * 0.55;
        const o = [P(hxL - odw, hw + 0.003, 0), P(hxL + odw, hw + 0.003, 0), P(hxL + odw, hw + 0.003, oTop), P(hxL - odw, hw + 0.003, oTop)];
        // ⚠ The fallback asks `markHidden`, as the lounge does. The recess itself goes through
        // `emitRecessBay`, which slides it into the gable plane (see there).
        const bayArt = (g) => {
          const trace = (pp) => { g.beginPath(); pp.forEach((p, i) => i ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)); g.closePath(); };
          g.globalAlpha = alpha;
          g.fillStyle = night ? 'rgba(46,40,30,0.96)' : 'rgba(16,18,22,0.97)'; trace(o); g.fill();   // dark opening
          const bk = [P(hxL - odw * 0.86, hw - inset, 0), P(hxL + odw * 0.86, hw - inset, 0), P(hxL + odw * 0.86, hw - inset, oTop * 0.9), P(hxL - odw * 0.86, hw - inset, oTop * 0.9)];
          if (bk.every(p => p.f > 0.1)) { g.fillStyle = night ? 'rgba(70,60,42,0.95)' : 'rgba(28,30,34,0.96)'; trace(bk); g.fill(); }   // recessed back wall = interior depth
          const fl = [P(hxL - odw, hw + 0.003, 0.006), P(hxL + odw, hw + 0.003, 0.006), P(hxL + odw * 0.86, hw - inset, 0.006), P(hxL - odw * 0.86, hw - inset, 0.006)];
          if (fl.every(p => p.f > 0.1)) { g.fillStyle = 'rgba(44,46,50,0.9)'; trace(fl); g.fill(); }   // interior floor
          const tb = P(hxL + odw * 0.15, hw - inset * 0.7, 0.01), tt = P(hxL + odw * 0.15, hw - inset * 0.7, oTop * 0.72), tn = P(hxL - odw * 0.35, hw - inset * 0.55, oTop * 0.28);
          if ([tb, tt, tn].every(p => p.f > 0.1)) { g.fillStyle = 'rgba(122,128,136,0.5)'; g.beginPath(); g.moveTo(tb.sx, tb.sy); g.lineTo(tt.sx, tt.sy); g.lineTo(tn.sx, tn.sy); g.closePath(); g.fill(); }   // parked-aircraft tail hint
          g.strokeStyle = 'rgba(8,10,12,0.9)'; g.lineWidth = 1.4; trace(o); g.stroke();   // opening frame
          g.globalAlpha = 1;
        };
        if (o.every(p => p.f > 0.1) && !emitRecessBay(ctx, cam, W3, hxL, hw, odw, oTop, inset,
          { open: night ? 'rgba(46,40,30,0.96)' : 'rgba(16,18,22,0.97)',
            back: night ? 'rgba(70,60,42,0.95)' : 'rgba(28,30,34,0.96)',
            floor: 'rgba(44,46,50,0.9)', tail: 'rgba(122,128,136,0.5)', edge: 'rgba(8,10,12,0.9)' },
          { x: odw * 0.15, t: 0.72, nx: -odw * 0.35, b: 0.28 }, alpha)) {
          const [bfx, bfy] = F(hxL, hw);
          if (!markHidden(cam, bfx, bfy, oTop, odw * 1.25)) emitFace(o.reduce((s, p) => s + p.f, 0) / 4 - 0.002, () => bayArt(ctx));
        }
        if (night) { const [obx, oby] = F(hxL, hw); glowPool(ctx, cam, obx, oby, wallTop * 0.3, '255,206,140', 12, alpha * 0.3); }   // warm spill from the open bay
      }
    }
    // The control tower, back-right, clear of the hangar.
    { const [txx, txy] = F(fh * 0.7, -fh * 0.55), big = m.big;
      const cabTop = h * (big ? 2.0 : 1.65), galZ = cabTop * 0.72, plZ = cabTop * 0.1;
      const cabBot = galZ + cabTop * 0.03, roofTopZ = cabTop + cabTop * 0.05;
      drawFacetDrum(ctx, cam, txx, txy, 0, plZ, fh * 0.3, fh * 0.24, NF, alpha, concrete, concrete({ nl: 0.7 }));   // splayed plinth
      drawFacetDrum(ctx, cam, txx, txy, plZ, galZ, fh * 0.2, fh * 0.14, NF, alpha, concrete);                       // tapering shaft (one smooth cone)
      for (const t of [0.3, 0.55, 0.8]) { const z = plZ + (galZ - plZ) * t, r = fh * (0.2 + (0.14 - 0.2) * t); drawRing(ctx, cam, txx, txy, z, r + 0.004, NF, 'rgba(0,0,0,0.28)', 1, alpha); }   // poured-lift band rings
      drawFacetDrum(ctx, cam, txx, txy, galZ, cabBot, fh * 0.3, fh * 0.3, NF, alpha, steel(40, 44, 50), 'rgb(46,50,58)');   // cantilevered catwalk gallery
      drawRing(ctx, cam, txx, txy, cabBot + cabTop * 0.05, fh * 0.31, NF, 'rgba(150,160,172,0.75)', 1.2, alpha);            // gallery rail
      drawFacetDrum(ctx, cam, txx, txy, cabBot, cabTop, fh * 0.32, fh * 0.3, NF, alpha, glass);                             // curtain-glass control cab
      for (const t of [0.4, 0.72]) drawRing(ctx, cam, txx, txy, cabBot + (cabTop - cabBot) * t, fh * 0.315, NF, 'rgba(14,20,28,0.4)', 1, alpha);   // faint transom rings
      drawFacetDrum(ctx, cam, txx, txy, cabTop, roofTopZ, fh * 0.36, fh * 0.34, NF, alpha, steel(34, 38, 44), 'rgb(40,44,52)');   // overhanging roof cap
      const mastTop = cabTop + h * (big ? 0.5 : 0.4);
      mast(ctx, cam, txx, txy, roofTopZ, mastTop, alpha, now, seed + 6);                                            // antenna mast (draws its own red tip light)
      for (const s of [-0.018, 0.022]) {   // a couple of shorter whip antennas beside the mast
        emitWire(ctx, cam, [txx + s, txy, roofTopZ], [txx + s, txy, cabTop + h * 0.2], 1, 'rgba(40,44,50,0.9)', alpha);
      }
      if (night) {
        glowPool(ctx, cam, txx, txy, (cabBot + cabTop) / 2, '150,220,255', 10, alpha * 0.42);                   // lit cab halo
        // The beacon: green and white half a cycle apart.
        blinkLight(ctx, cam, txx, txy, cabTop + h * 0.05, '120,255,150', now, seed + 7, alpha, 2.1);
        blinkLight(ctx, cam, txx, txy, cabTop + h * 0.05, '235,245,255', now, seed + 7 + Math.PI, alpha, 1.9);
      }
      blinkLight(ctx, cam, txx, txy, mastTop, '255,70,70', now, seed + 6, alpha, 1.6);                           // red obstruction light at the mast tip
    }
    // Apron markings.
    { ctx.globalAlpha = alpha; ctx.lineCap = 'round';
      const seg = (l0, l1, style, lw) => { const a = cam.proj(l0[0], l0[1], 0.02), b = cam.proj(l1[0], l1[1], 0.02); if (a.f > 0.1 && b.f > 0.1) { ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); } };
      for (let i = 0; i < 5; i++) { const y0 = fh * (0.6 - i * 0.3), y1 = y0 - fh * 0.16; seg(F(0, y0), F(0, y1), 'rgba(240,208,70,0.8)', Math.max(1.5, 6 / (cam.proj(dx, dy, 0.02).f || 1))); }   // yellow taxiway lead-in dashes
      for (const s of [-0.62, 0.62]) { const cc = F(s * fh, -fh * 0.1); const pts = []; let ok = true; for (let k = 0; k <= 12; k++) { const a = k / 12 * 6.2832, p = cam.proj(cc[0] + Math.cos(a) * fh * 0.12, cc[1] + Math.sin(a) * fh * 0.12, 0.02); if (p.f <= 0.1) { ok = false; break; } pts.push(p); } if (ok) { ctx.strokeStyle = 'rgba(230,236,240,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.stroke(); } }   // parking tie-down circles
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }
    if (night) {
      glowPool(ctx, cam, dx, dy, 0.02, '255,236,190', 30, alpha * 0.16);                                        // sodium apron floods
      for (const s of [-0.7, -0.23, 0.23, 0.7]) { const [ex, ey] = F(fh * s, fh * 0.95); blinkLight(ctx, cam, ex, ey, 0.02, '90,150,255', now, seed + s * 10, alpha, 1.3); }
      if (m.helipad) glowPool(ctx, cam, dx, dy, top + 0.01, '255,210,90', 14, alpha * 0.3);
    }
  },
  atc(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The control tower: a white tripod core under a glass drum, a flared glass cab, radar and mast. No sign.
    const NF = 20, NEON_A = '255,64,200', NEON_B = '80,236,255';
    // ⚠ Each drum names its palette (`WP`, `SP`, `GP`); white and steel are `litStyle`, the glass an
    // unlit fill that glows at night. ⚠ `dusk` darkens the albedo: a white albedo sits above the
    // shader's night-dim cutoff (about 0.55) and would stay pale all night.
    const WP = 'ty_atc_white', SP = 'ty_atc_steel', GP = 'ty_atc_glass';
    // ⚠ Every glow here is `air`: on the GPU a glowPool is also a point light, and these would light the tower.
    const AIR = { air: true };
    const dusk = 1 - 0.74 * (night ? clamp(night, 0, 1) : 0);
    const WHITE = [212 * dusk, 212 * dusk, 208 * dusk];
    const white = litStyle((f) => { const s = (0.66 + f.nl * 0.38) * dusk; return `rgb(${226 * s | 0},${226 * s | 0},${222 * s | 0})`; }, WHITE, 'plain');
    const whiteCap = litStyle(() => { const s = 0.94 * dusk; return `rgb(${226 * s | 0},${226 * s | 0},${222 * s | 0})`; }, WHITE, 'plain');
    const steel = (r, g2, b) => litStyle((f) => { const s = (0.5 + f.nl * 0.5) * dusk; return `rgb(${r * s | 0},${g2 * s | 0},${b * s | 0})`; }, [r * 0.9 * dusk, g2 * 0.9 * dusk, b * 0.9 * dusk], 'plain');
    const steelCap = (r, g2, b) => litStyle(() => `rgb(${r * dusk | 0},${g2 * dusk | 0},${b * dusk | 0})`, [r * dusk, g2 * dusk, b * dusk], 'plain');
    const glassOf = (glow) => (f, tp, bt) => {
      const g = ctx.createLinearGradient(0, tp, 0, bt), s = (0.55 + f.nl * 0.45) * glow;
      if (night) {
        g.addColorStop(0, `rgba(${40 * s | 0},${120 * s | 0},${140 * s | 0},0.96)`);
        g.addColorStop(0.6, `rgba(${30 * s | 0},${84 * s | 0},${104 * s | 0},0.96)`);
        g.addColorStop(1, `rgba(${120 * glow | 0},${220 * glow | 0},${210 * glow | 0},0.96)`);   // the consoles, lit teal
      } else {
        g.addColorStop(0, `rgba(${70 + f.nl * 60 | 0},${120 + f.nl * 60 | 0},${120 + f.nl * 50 | 0},0.97)`);   // green-tinted curtain glass
        g.addColorStop(0.5, `rgba(${30 + f.nl * 40 | 0},${80 + f.nl * 50 | 0},${84 + f.nl * 40 | 0},0.97)`);
        g.addColorStop(1, `rgba(${14 + f.nl * 20 | 0},${40 + f.nl * 24 | 0},${46 + f.nl * 20 | 0},0.97)`);
      }
      return g;
    };
    const podH = h * 0.1, legTop = h * 0.595, eqBot = h * 0.6, eqTop = h * 0.7, neckTop = h * 0.735, cabTop = h * 0.9, roofTop = h * 0.915;
    drawFacetDrum(ctx, cam, dx, dy, 0, podH * 0.18, fh * 0.6, fh * 0.6, NF, alpha, white, undefined, WP);
    drawFacetDrum(ctx, cam, dx, dy, podH * 0.18, podH * 0.9, fh * 0.56, fh * 0.56, NF, alpha, glassOf(0.4), undefined, GP);
    drawFacetDrum(ctx, cam, dx, dy, podH * 0.9, podH, fh * 0.6, fh * 0.6, NF, alpha, white, whiteCap, WP);
    drawFacetDrum(ctx, cam, dx, dy, podH, eqBot, fh * 0.19, fh * 0.16, NF, alpha, white, undefined, WP);
    // The legs: lit mesh faces, each wound so its normal points out of the leg.
    const E3 = _bladeBasis.E, yaw0 = Math.atan2(E3[1], E3[0]);
    for (let k = 0; k < 3; k++) {
      const a = yaw0 + k * (Math.PI * 2 / 3), ux = Math.cos(a), uy = Math.sin(a), tx = -uy, ty = ux;
      const P = (r, t, d, z) => [dx + ux * (r + d) + tx * t, dy + uy * (r + d) + ty * t, z];
      const Rb = fh * 0.46, Rt = fh * 0.2, wb = fh * 0.15, wt = fh * 0.075, db = fh * 0.1, dt = fh * 0.05;
      const zb = podH + 0.003;   // standing ON the podium's lid and meeting the core at its skin, never inside either
      const b = [P(Rb, -wb, db, zb), P(Rb, wb, db, zb), P(Rb, wb, -db, zb), P(Rb, -wb, -db, zb)];
      const t = [P(Rt, -wt, dt, legTop), P(Rt, wt, dt, legTop), P(Rt, wt, -dt, legTop), P(Rt, -wt, -dt, legTop)];
      const shade = [0.98, 0.84, 0.62, 0.8];   // outer, one flank, inner, the other flank (the 2-D painter's light)
      let lcx = 0, lcy = 0;
      for (const p of [...b, ...t]) { lcx += p[0] / 8; lcy += p[1] / 8; }
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, s = shade[i] * dusk;
        let q = [b[i], b[j], t[j], t[i]], nx = 0, ny = 0, mx = 0, my = 0;
        for (let v = 0; v < 4; v++) { const p0 = q[v], p1 = q[(v + 1) % 4]; nx += (p0[1] - p1[1]) * (p0[2] + p1[2]); ny += (p0[2] - p1[2]) * (p0[0] + p1[0]); mx += p0[0] / 4; my += p0[1] / 4; }
        if (nx * (mx - lcx) + ny * (my - lcy) < 0) { q = q.reverse(); nx = -nx; ny = -ny; }
        emitFlat(ctx, cam, q, `rgb(${226 * s | 0},${226 * s | 0},${222 * s | 0})`, alpha, { lit: 'plain', albedo: WHITE, cullN: [nx, ny] });
      }
      const o0 = P(Rb, 0, db + 0.002, zb), o1 = P(Rt, 0, dt + 0.002, legTop);
      emitWire(ctx, cam, o0, o1, 2, `rgba(${NEON_A},0.95)`, alpha, { pull: DECO_PULL });
      if (night) glowPool(ctx, cam, (o0[0] + o1[0]) / 2, (o0[1] + o1[1]) / 2, (podH + legTop) / 2, NEON_A, 12, alpha * 0.35, AIR);
    }
    drawFacetDrum(ctx, cam, dx, dy, eqBot, eqTop, fh * 0.3, fh * 0.3, NF, alpha, glassOf(0.45), undefined, GP);
    for (const t of [0.34, 0.67]) drawRing(ctx, cam, dx, dy, eqBot + (eqTop - eqBot) * t, fh * 0.305, NF, `rgba(${220 * dusk | 0},${224 * dusk | 0},${222 * dusk | 0},0.8)`, 1.4, alpha);
    drawFacetDrum(ctx, cam, dx, dy, eqTop, neckTop, fh * 0.22, fh * 0.2, NF, alpha, white, whiteCap, WP);
    drawFacetDrum(ctx, cam, dx, dy, neckTop, neckTop + h * 0.012, fh * 0.34, fh * 0.34, NF, alpha, white, undefined, WP);
    drawFacetDrum(ctx, cam, dx, dy, neckTop + h * 0.012, cabTop, fh * 0.34, fh * 0.52, NF, alpha, glassOf(1), undefined, GP);
    for (let i = 0; i < NF; i += 2) {
      const a = (i / NF) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
      emitWire(ctx, cam, [dx + c * fh * 0.345, dy + s2 * fh * 0.345, neckTop + h * 0.012], [dx + c * fh * 0.525, dy + s2 * fh * 0.525, cabTop], 1, 'rgba(10,20,22,0.7)', alpha, { pull: DECO_PULL });
    }
    drawFacetDrum(ctx, cam, dx, dy, cabTop, roofTop, fh * 0.54, fh * 0.54, NF, alpha, steel(54, 60, 66), steelCap(66, 72, 78), SP);
    for (const [z, r] of [[podH, fh * 0.61], [eqBot, fh * 0.31], [eqTop, fh * 0.31], [cabTop, fh * 0.545]]) {
      drawRing(ctx, cam, dx, dy, z, r, NF, `rgba(${NEON_B},0.95)`, 2, alpha);
      if (night) glowPool(ctx, cam, dx, dy, z, NEON_B, 10, alpha * 0.3, AIR);
    }
    const ang = (now || 0) * 0.0021 + seed, ca = Math.cos(ang) * fh * 0.22, sa = Math.sin(ang) * fh * 0.22, rz = roofTop + h * 0.05;
    drawFacetDrum(ctx, cam, dx, dy, roofTop, rz - h * 0.01, fh * 0.06, fh * 0.05, 8, alpha, steel(150, 154, 158), steelCap(160, 164, 168), SP);
    emitWire(ctx, cam, [dx - ca, dy - sa, rz], [dx + ca, dy + sa, rz], 4, 'rgba(214,218,222,0.95)', alpha, { pull: DECO_PULL });
    const [mx, my] = F(fh * 0.34, -fh * 0.2), mastTop = roofTop + h * 0.12;
    mast(ctx, cam, mx, my, roofTop, mastTop, alpha, now, seed + 6);
    if (night) {
      glowPool(ctx, cam, dx, dy, (neckTop + cabTop) / 2, '120,230,220', 16, alpha * 0.45, AIR);   // the cab's glass is lit on its own (glassOf); this is its halo
      blinkLight(ctx, cam, dx, dy, rz + h * 0.01, '120,255,150', now, seed + 7, alpha, 2.1);            // the aerodrome beacon: green and white
      blinkLight(ctx, cam, dx, dy, rz + h * 0.01, '235,245,255', now, seed + 7 + Math.PI, alpha, 1.9);
    }
  },
  arrivals(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Arrivals: the terminal's north half, with the crown and the building's name (see terminalHalf).
    const { D, HW } = TERM, x0 = HW * 2 / 3;
    const { yawE, t } = terminalHalf(ctx, cam, dx, dy, fh, h, seed, night, alpha, now, E, F, { side: -1, kerb: 'ARRIVALS', terrace: true, frontVis });
    observationCrown(ctx, cam, F, x0, seed + 60, night, alpha, t);
    jetBridge(ctx, cam, F, -0.06, -1, seed + 70, night, alpha);
    // The revolving door under a round canopy.
    { const [rx, ry] = F(x0, D + 0.036), [kx, ky] = F(x0, D + 0.072);
      drawFacetDrum(ctx, cam, rx, ry, 0, 0.12, 0.034, 0.034, 12, alpha,
        (f) => night ? 'rgb(240,206,150)' : `rgb(${52 + f.nl * 50 | 0},${88 + f.nl * 56 | 0},${102 + f.nl * 50 | 0})`, null, 'ty_atc_glass');
      drawFacetDrum(ctx, cam, kx, ky, 0.124, 0.136, 0.07, 0.07, 16, alpha,
        (f) => `rgb(${(196 + f.nl * 40) * (night ? 0.5 : 1) | 0},${(200 + f.nl * 40) * (night ? 0.5 : 1) | 0},${(204 + f.nl * 40) * (night ? 0.5 : 1) | 0})`,
        () => night ? 'rgb(118,122,126)' : 'rgb(228,232,234)', 'ty_atc_white');
      if (frontVis) frontRing(ctx, cam, kx, ky, 0.124, 0.071, 16, 'rgba(80,236,255,0.95)', 1.6, alpha);
      if (night) glowPool(ctx, cam, rx, ry, 0.07, '255,226,170', 14, alpha * 0.45); }
    // A baggage train.
    { const yb = 0.462;
      const [gx, gy] = F(0.04, yb);
      draw3DBoxAt(ctx, cam, gx, gy, 0.018, 0.004, 0.03, 'ty_fuel_white', seed + 71, night, alpha, true, yawE, 0.014);
      for (const [x, k] of [[0.095, 0], [0.15, 1]]) {
        const [cx, cy] = F(x, yb);
        draw3DBoxAt(ctx, cam, cx, cy, 0.022, 0.004, 0.012, 'ty_atc_steel', seed + 72 + k, night, alpha, true, yawE, 0.014);
        draw3DBoxAt(ctx, cam, cx, cy, 0.018, 0.012, 0.03, k ? 'ty_airport_band' : 'ty_precast', seed + 74 + k, night, alpha, true, yawE, 0.011);
      } }
    if (frontVis && sign) fasciaLettering(ctx, cam, F, sign, night, alpha);
  },
  departures(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Departures: the terminal's south half. Its fascia says DEPARTURES; the name is on arrivals.
    const { yawE } = terminalHalf(ctx, cam, dx, dy, fh, h, seed, night, alpha, now, E, F, { side: 1, kerb: 'DEPARTURES', frontVis });
    jetBridge(ctx, cam, F, 0.3, -1, seed + 40, night, alpha);
    jetBridge(ctx, cam, F, -0.14, -1, seed + 44, night, alpha);
    // A fuel bowser and a ground-power cart.
    { const [fx, fy] = F(0.4, 0.45);
      draw3DBoxAt(ctx, cam, fx, fy, 0.019, 0.004, 0.048, 'ty_fuel_white', seed + 41, night, alpha, true, yawE, 0.038);
      const [px, py] = F(0.17, 0.465);
      draw3DBoxAt(ctx, cam, px, py, 0.019, 0.004, 0.032, 'ty_airport_band', seed + 42, night, alpha, true, yawE, 0.013); }
    if (frontVis) fasciaLettering(ctx, cam, F, 'DEPARTURES', night, alpha);
  },
  palais_foyer(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Coldwater Palais box office foyer (west third; see PAL).
    palaisFoyer(ctx, cam, F, W3, E, m, seed, night, alpha, now, frontVis, 1);
  },
  palais_bar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Coldwater Palais bar foyer (east third).
    palaisFoyer(ctx, cam, F, W3, E, m, seed, night, alpha, now, frontVis, -1);
  },
  palais_stage(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Coldwater Palais middle third: auditorium, stage house, frontispiece, blade and marquee.
    const k = palaisKit(ctx, cam, F, W3, E, 0, seed, night, alpha), { B, dn } = k;
    const roofed = (side) => facePals(E, { side, roof: PAL_COPPER });
    // The auditorium, two boxes because a box is never wider than 0.44.
    { const cy = (PAL.front + PAL.aBack) / 2, fd = (PAL.front - PAL.aBack) / 2;
      for (const s of [-1, 1]) {
        B(s * 0.25, cy, 0.25, fd, 0, PAL.aTop, roofed(PAL_STONE), 1 + s);
        B(s * 0.25, cy, 0.25, fd + 0.012, PAL.aTop, PAL.aTop + 0.025, roofed(PAL_TRIM), 4 + s);
        // Speed lines either side of the bay.
        for (const z of [0.40, 0.46, 0.52]) B(s * (PAL.fHW + 0.5) / 2, PAL.front + 0.004, (0.5 - PAL.fHW) / 2, 0.006, z, z + 0.012, PAL_TRIM, 12 + s);
      } }
    // The stage house and its smoke vent.
    { const cy = (PAL.tFront + PAL.tBack) / 2, fd = (PAL.tFront - PAL.tBack) / 2;
      B(0, cy, PAL.tHW, fd, 0, PAL.tTop, PAL_STONE, 7);
      B(0, cy, PAL.tHW + 0.015, fd + 0.015, PAL.tTop, PAL.tTop + 0.025, roofed(PAL_TRIM), 8);
      B(0, cy, 0.05, 0.05, PAL.tTop + 0.025, PAL.tTop + 0.075, roofed(PAL_COPPER), 9);
      // The low scene dock either side.
      for (const s of [-1, 1]) B(s * 0.41, cy + 0.01, 0.09, fd - 0.01, 0, 0.34, roofed(PAL_STONE), 10 + s);
      [-0.24, -0.10, 0.10, 0.24].forEach((X, i) => {
        B(X, PAL.tBack - 0.012, 0.02, 0.014, 0.30, PAL.tTop + 0.04, PAL_TRIM, 20 + i);
        B(X, PAL.tBack - 0.012, 0.011, 0.008, PAL.tTop + 0.04, PAL.tTop + 0.065, PAL_TRIM, 24 + i);
      });
      for (const s of [-1, 1]) for (const y of [-0.16, -0.32]) B(s * (PAL.tHW + 0.012), y, 0.014, 0.02, 0.36, PAL.tTop + 0.04, PAL_TRIM, 30 + s + (y < -0.2 ? 3 : 0));
      // The dock door over the park.
      { const y = PAL.tBack - 0.003, out = [0, -1, 0];
        k.paint([[0.09, y, 0.25], [-0.09, y, 0.25], [-0.09, y, 0.004], [0.09, y, 0.004]], out, [74, 72, 66]);
        for (let i = 1; i < 6; i++) { const z = 0.004 + 0.246 * i / 6; k.paint([[0.085, y - 0.001, z + 0.003], [-0.085, y - 0.001, z + 0.003], [-0.085, y - 0.001, z - 0.003], [0.085, y - 0.001, z - 0.003]], out, [52, 50, 46]); }
        if (dn > 0) { const [lx, ly] = k.at(0, y - 0.04); glowPool(ctx, cam, lx, ly, 0.27, '255,214,160', 9, alpha * 0.4 * dn); } } }
    // The stepped frontispiece and its fins.
    { const cy = (PAL.fFront + PAL.fBack) / 2, fd = (PAL.fFront - PAL.fBack) / 2;
      B(0, cy, PAL.fHW, fd, 0, PAL.fTop, roofed(PAL_STONE), 40);
      [[0.13, 0.04], [0.09, 0.04], [0.05, 0.03]].reduce((z, [hw, dz], i) => {
        B(0, cy, hw, fd - 0.01 * (i + 1), z, z + dz, roofed(i === 2 ? PAL_COPPER : PAL_STONE), 41 + i); return z + dz; }, PAL.fTop);
      [[0.045, 0.94], [0.105, 0.89], [0.165, 0.86]].forEach(([X, top], i) => {
        for (const s of [-1, 1]) B(s * X, PAL.fFront + 0.008, 0.012, 0.012, 0.30, top, PAL_TRIM, 45 + i * 2 + (s > 0));
      });
      for (const s of [-1, 1]) for (const [a, b] of [[0.057, 0.093], [0.117, 0.153]]) {
        k.glow([[s * a, PAL.fFront + 0.002, 0.78], [s * b, PAL.fFront + 0.002, 0.78], [s * b, PAL.fFront + 0.002, 0.33], [s * a, PAL.fFront + 0.002, 0.33]],
          [0, 1, 0], [70, 86, 96], [255, 228, 176]);
      } }
    // The blade, the one place the building gives its name.
    { const cy = PAL.fFront + PAL.bladeOut / 2, fd = PAL.bladeOut / 2;
      B(0, cy, PAL.bladeT, fd, PAL.bladeZ0, PAL.bladeZ1, PAL_BRONZE, 50, false);
      [[0.8, 0.025], [0.6, 0.025], [0.4, 0.02]].reduce((z, [f, dz], i) => {
        B(0, PAL.fFront + PAL.bladeOut * f / 2, PAL.bladeT * 0.9, PAL.bladeOut * f / 2, z, z + dz, PAL_BRONZE, 51 + i, i === 2); return z + dz; }, PAL.bladeZ1);
      if (frontVis && m.blade) for (const s of [-1, 1]) palaisBladeText(ctx, cam, k, s, m.blade, dn, alpha);
      if (dn > 0.3 && nearOrMesh()) {
        const yE = PAL.fFront + PAL.bladeOut + 0.003;
        emitWire(ctx, cam, W3(0, yE, PAL.bladeZ0 + 0.01), W3(0, yE, PAL.bladeZ1), 2.4, `rgba(${PAL_PINK},0.95)`, alpha, { pull: DECO_PULL });
        const [gx, gy] = k.at(0, yE);
        glowPool(ctx, cam, gx, gy, (PAL.bladeZ0 + PAL.bladeZ1) / 2, PAL_PINK, 16, alpha * 0.34 * dn, { air: true });
      } }
    // The marquee, with the bill (`m.bill`, two lines) and bulbs.
    { const cy = (PAL.front + PAL.mFront) / 2, fd = (PAL.mFront - PAL.front) / 2;
      B(0, cy, PAL.mHW, fd, PAL.mZ0, PAL.mZ1, PAL_BRONZE, 60);
      const y = PAL.mFront + 0.003, x0 = PAL.mHW - 0.02, z0 = PAL.mZ0 + 0.008, z1 = PAL.mZ1 - 0.008;
      k.glow([[-x0, y, z1], [x0, y, z1], [x0, y, z0], [-x0, y, z0]], [0, 1, 0], [222, 214, 192], [255, 240, 208]);
      for (const s of [-1, 1]) {   // the two ends, the same glass
        const X = s * (PAL.mHW + 0.003);
        k.glow([[X, PAL.front + 0.01, z1], [X, PAL.mFront - 0.01, z1], [X, PAL.mFront - 0.01, z0], [X, PAL.front + 0.01, z0]], [s, 0, 0], [222, 214, 192], [255, 240, 208]);
      }
      if (frontVis && m.bill) m.bill.slice(0, 2).forEach((line, i) => {
        const zt = i ? (z0 + z1) / 2 - 0.002 : z1 - 0.004, zb = i ? z0 + 0.004 : (z0 + z1) / 2 + 0.002;
        const tex = bakeSignText(line, '#2a1a12', 0, false, true, true, { font: 'condensed' });
        const q = [[-x0 + 0.02, zt], [x0 - 0.02, zt], [x0 - 0.02, zb], [-x0 + 0.02, zb]].map(([X, z]) => { const [wx, wy] = k.at(X, y + 0.002); return cam.proj(wx, wy, z); });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      });
      if (nearOrMesh()) {
        const bulb = dn > 0.3 ? 'rgba(255,236,196,0.98)' : 'rgba(204,196,176,0.9)';
        for (const z of [PAL.mZ1 + 0.002, PAL.mZ0 - 0.002]) for (let i = 0; i <= 20; i++) {
          const X = -x0 + 2 * x0 * i / 20;
          emitWire(ctx, cam, W3(X - 0.004, PAL.mFront + 0.004, z), W3(X + 0.004, PAL.mFront + 0.004, z), 2.2, bulb, alpha, { pull: DECO_PULL });
        }
      }
      if (dn > 0) {
        const [gx, gy] = k.at(0, PAL.mFront - 0.02);
        glowPool(ctx, cam, gx, gy, PAL.mZ0 - 0.01, '255,232,190', 18, alpha * 0.45 * dn);                   // the soffit lamps, on the pavement
        glowPool(ctx, cam, gx, gy, (PAL.mZ0 + PAL.mZ1) / 2, '255,240,208', 20, alpha * 0.30 * dn, { air: true });   // the panel's own halo
      } }
    for (const X of [-0.31, 0.31]) palaisPoster(k, X, PAL.front + 0.004, 0.05, 0.035, 0.175);
    palaisPoster(k, 0, PAL.fFront + 0.004, 0.06, 0.035, 0.18);
    // Night floods. ⚠ Lamps, not halos (no `air`): these point lights are what light the stone.
    if (dn > 0) {
      const [fx, fy] = k.at(0, PAL.fFront + 0.05);
      glowPool(ctx, cam, fx, fy, 0.34, '255,222,176', 20, alpha * 0.45 * dn);
      glowPool(ctx, cam, fx, fy, 0.62, '255,222,176', 22, alpha * 0.30 * dn);
      for (const s of [-1, 1]) { const [hx, hy] = k.at(s * 0.33, PAL.front + 0.06); glowPool(ctx, cam, hx, hy, 0.40, '255,214,166', 16, alpha * 0.30 * dn); }
      const [tx, ty] = k.at(0, (PAL.tFront + PAL.tBack) / 2);
      glowPool(ctx, cam, tx, ty, PAL.tTop, '150,220,190', 12, alpha * 0.12 * dn, { air: true });
    }
  },
  power(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The power plant (5 tiles): two waisted cooling towers, a turbine hall and a banded stack.
    const shell = pal, deck = 'ty_precast_dk', band = 'ty_precast';
    // ⚠ `style` is a function of the facet (see the clinic's flue).
    const conc = (r, g2, b) => (f) => 'rgb(' + (r + f.nl * 46 | 0) + ',' + (g2 + f.nl * 46 | 0) + ',' + (b + f.nl * 44 | 0) + ')';
    for (const s of [-1, 1]) {
      const [cx, cy] = F(s * fh * 0.8, 0);
      // The hyperboloid: two drums meeting at the throat.
      const throat = h * 0.62, rim = h * 1.05;
      drawFacetDrum(ctx, cam, cx, cy, 0, throat, fh * 0.66, fh * 0.38, 12, alpha, conc(82, 80, 76), null);
      drawFacetDrum(ctx, cam, cx, cy, throat, rim, fh * 0.38, fh * 0.52, 12, alpha, conc(92, 90, 86), 'rgb(38,40,42)');
      drawRing(ctx, cam, cx, cy, h * 0.22, fh * 0.56, 12, 'rgba(20,20,22,0.45)', 2, alpha);
      drawRing(ctx, cam, cx, cy, h * 0.44, fh * 0.46, 12, 'rgba(20,20,22,0.45)', 2, alpha);
      // The raking legs.
      for (let i = 0; i < 8; i++) { const a2 = i / 8 * Math.PI * 2;
        const [lx4, ly4] = F(s * fh * 0.8 + Math.cos(a2) * fh * 0.6, Math.sin(a2) * fh * 0.6);
        draw3DBoxAt(ctx, cam, lx4, ly4, fh * 0.05, 0, h * 0.1, deck, seed + 20 + i, night, alpha, false); }
      drawSmoke(ctx, cam, cx, cy, rim, '210,214,220', alpha * 0.8, now, seed + s + 1);
    }
    // The turbine hall.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, 0, h * 0.42, deck, seed + 9, night, alpha, true, 0, fh * 0.5);
    { const [sx, sy] = F(0, -fh * 0.6);
      // The banded stack.
      const N2 = 6, top = h * 1.7;
      for (let i = 0; i < N2; i++) { const z0 = top * (i / N2), z1 = top * ((i + 1) / N2);
        const r0 = fh * (0.3 - 0.08 * (i / N2)), r1 = fh * (0.3 - 0.08 * ((i + 1) / N2));
        drawFacetDrum(ctx, cam, sx, sy, z0, z1, r0, r1, 10, alpha,
          i % 2 ? conc(96, 52, 46) : conc(136, 134, 128), i === N2 - 1 ? 'rgb(40,38,36)' : null); }
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.34, 0, h * 0.14, band, seed + 10, night, alpha, false);   // the base block
      drawSmoke(ctx, cam, sx, sy, top, '72,66,60', alpha, now, seed + 4);
      blinkLight(ctx, cam, sx, sy, top, '255,80,80', now, seed, alpha); }
    // The front entrance (near tier only: `doorReveal` and `mullions` skip past `detailNear`).
    // ⚠ Pass the hall's depth `fh * 0.5`, never `fh`, or the door floats off the front.
    { const doorHw = fh * 0.16, doorTop = h * 0.24, wallY = Math.min(fh * 0.5, 0.44);
      doorReveal(ctx, cam, dx, dy, E, fh * 0.5, doorHw, 0, doorTop, seed + 30, night, alpha);
      mullions(ctx, cam, dx, dy, E, fh * 0.5, doorHw, h * 0.05, doorTop * 0.92, seed + 31, night, alpha);
      awning(ctx, cam, dx, dy, E, doorHw * 2.1, wallY + fh * 0.09, doorTop, doorTop + h * 0.045, deck, seed + 32, night, alpha, fh * 0.09);
      if (night) {
        const [gx2, gy2] = facePt(dx, dy, 0, wallY + fh * 0.05, E);
        glowPool(ctx, cam, gx2, gy2, doorTop * 0.55, '255,206,140', 12, alpha * 0.40);          // the spill out of the lobby
        for (const s of [-1, 1]) { const [lx2, ly2] = facePt(dx, dy, s * doorHw * 2.4, wallY, E);
          glowPool(ctx, cam, lx2, ly2, doorTop * 1.02, '255,214,150', 7, alpha * 0.5); }        // a bulkhead lamp either side
      }
    }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.42, '255,196,120', 18, alpha * 0.3);   // the hall, lit all night
  },
  bar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // a corner bar: a glazed bar room under flats, a door awning and a neon blade
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, h * 0.30, facePals(E, { side: pal, front: 'ty_shop_e' }), seed + 4, night, alpha, false);   // the bar room, glazed to the street
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, h * 0.30, h * 0.35, pal, seed + 5, night, alpha, false);    // fascia over the window
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, h * 0.35, h * 0.9, pal, seed, night, alpha, false);        // flats above, set back
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.84, h * 0.9, h * 0.97, pal, seed + 6, night, alpha, true);     // parapet
    awning(ctx, cam, dx, dy, E, fh * 0.78, fh * 0.92, h * 0.18, h * 0.30, 'ty_door', seed + 1, night, alpha, fh * 0.26);   // door awning, tucked under the fascia
    { const [nx, ny] = F(fh * 0.5, fh * 0.88); neonBlade(ctx, cam, nx, ny, h * 0.35, h * 1.2, m.neon || '#5fd0ff', night, alpha); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.2, '120,220,255', 9, alpha * 0.2);
  },
  honkytonk(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // roadhouse: a long low shed on a boardwalk behind a painted false front, with a porch
    const hw = fh * 1.14, wallTop = h * 0.46, frontTop = h * 0.74;
    // ⚠ Half-widths clamp at 0.44, so the step comes from bringing the shed in, never pushing the boardwalk out.
    const shedHw = fh * 1.05;
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.03, 0, h * 0.045, pal, seed + 6, night, alpha, false);        // the boardwalk it stands on
    draw3DBoxAt(ctx, cam, dx, dy, shedHw, h * 0.045, wallTop, pal, seed, night, alpha, false);         // the shed itself
    { const [fx, fy] = F(0, fh * 0.88);                                                                  // false front, standing proud of the roof
      draw3DBoxAt(ctx, cam, fx, fy, hw, wallTop, frontTop, 'ty_honky_front', seed + 1, night, alpha, true, Math.atan2(-E[0], E[1]), fh * 0.20); }
    awning(ctx, cam, dx, dy, E, hw * 0.96, fh * 1.04, wallTop * 0.52, wallTop * 0.80, 'ty_honky_porch', seed + 2, night, alpha, fh * 0.44);   // porch, full width
    if (frontVis) neonBlade(ctx, cam, dx, dy, frontTop, frontTop + h * 0.46, m.neon || '#ff5fa8', night, alpha);   // the boot, in pink
    if (night) { const [gx, gy] = F(0, fh * 1.12); glowPool(ctx, cam, gx, gy, wallTop * 0.42, '255,158,96', 12, alpha * 0.30); }   // warm spill out the door
  },
  club(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // a windowless club on a heavy base, twin blades on its crown band
    { const [ex, ey] = F(0, fh * 0.2);
      draw3DBoxAt(ctx, cam, ex, ey, fh * 1.12, 0, h * 0.26, facePals(E, { side: pal, front: 'ty_shop_e' }), seed + 7, night, alpha, false); }   // entrance block, out past the slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.26, h * 0.78, pal, seed, night, alpha, false);       // the windowless slab itself
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, h * 0.78, h * 0.88, 'ty_precast_dk', seed + 1, night, alpha, true);   // crown band the blades stand on
    { const [ax, ay] = F(-fh * 0.4, 0); neonBlade(ctx, cam, ax, ay, h * 0.88, h * 1.2, m.neon || '#ff4a9a', night, alpha); }
    { const [bx, by] = F(fh * 0.4, 0); neonBlade(ctx, cam, bx, by, h * 0.88, h * 1.2, m.neon || '#ff4a9a', night, alpha); }
    glowPool(ctx, cam, dx, dy, h * 0.9, '255,74,154', 20, alpha * (night ? 0.34 : 0.16));
  },
  diner(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // streamline diner: a stainless car on a skirt under a barrel roof, with rooftop neon
    const hw = fh * 1.12, wallTop = h * 0.52, archH = hw * 0.34;
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.03, 0, h * 0.05, pal, seed + 5, night, alpha, false);                     // stainless skirt
    draw3DBoxAt(ctx, cam, dx, dy, hw, h * 0.05, wallTop, pal, seed, night, alpha, false);                          // diner body (roof left open for the barrel)
    drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.9, wallTop, archH, 12, alpha, [150, 150, 156]);                      // curved streamline stainless roof
    awning(ctx, cam, dx, dy, E, fh * 1.06, fh * 1.05, wallTop * 0.42, wallTop * 0.64, 'ty_door', seed + 1, night, alpha, fh * 0.30);   // counter awning faces the street
    neonBlade(ctx, cam, dx, dy, wallTop + archH, wallTop + archH + h * 0.42, m.neon || '#ffcf3e', night, alpha);   // rooftop neon sign
    if (night) { const [wx, wy] = F(0, fh * 0.92); glowPool(ctx, cam, wx, wy, wallTop * 0.5, '255,200,120', 13, alpha * 0.26); }   // warm window band
  },
  laundromat(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Wash: a one-storey shopfront that's mostly window
    const hw = fh * 1.1, wallTop = h * 0.56;
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.04, 0, h * 0.04, pal, seed + 4, night, alpha, false);                     // kerb plinth
    draw3DBoxAt(ctx, cam, dx, dy, hw, h * 0.04, wallTop, pal, seed, night, alpha, false);                          // the single storey
    { const [gx, gy] = F(0, fh * 0.96); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.96, h * 0.04, wallTop * 0.84, 'ty_marble_col', seed + 1, night, alpha, false); }  // the big glazed front
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.03, wallTop, wallTop + h * 0.05, pal, seed + 5, night, alpha, true);      // fascia at the head of the glass
    neonBlade(ctx, cam, dx, dy, wallTop + h * 0.05, wallTop + h * 0.34, m.neon || '#7fe3ff', night, alpha);        // cold-blue WASH sign
    // Lit all night.
    if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, wallTop * 0.6, '210,235,255', 18, alpha * 0.34); }
  },
  armory(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ironside Arms: a squat blockhouse on a plinth, with a vault door
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, h * 0.07, pal, seed + 5, night, alpha, false);         // plinth
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, h * 0.07, h * 0.7, pal, seed, night, alpha, false);      // bunker box
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, h * 0.7, h * 0.82, pal, seed + 1, night, alpha, true);   // thick overhanging parapet
    { const [gx, gy] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.46, h * 0.07, h * 0.4, 'ty_door', seed + 2, night, alpha, false); }   // vault door
    if (night) { const [wx, wy] = F(fh * 0.5, fh * 0.9); glowPool(ctx, cam, wx, wy, h * 0.34, '255,140,80', 6, alpha * 0.22); }   // amber slit window
    neonBlade(ctx, cam, dx, dy, h * 0.82, h * 1.06, m.neon || '#ff6a4a', night, alpha);               // small hard sign
  },
  casino(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // a windowless casino with a porte-cochère, drowned in neon
    const neon = m.neon || '#ff3e8a';
    const crown = 'ty_precast', plinth = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, 0, h * 0.1, plinth, seed + 7, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, h * 0.1, h * 0.7, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.22, h * 0.7, h * 0.9, crown, seed + 1, night, alpha, true); // marquee crown band
    { const [cx3, cy3] = F(0, fh * 1.28);
      draw3DBoxAt(ctx, cam, cx3, cy3, fh * 0.62, h * 0.30, h * 0.38, crown, seed + 8, night, alpha, true, 0, fh * 0.42);
      for (const s of [-1, 1]) { const [ox, oy] = F(s * fh * 0.5, fh * 1.6);
        draw3DBoxAt(ctx, cam, ox, oy, fh * 0.07, 0, h * 0.30, plinth, seed + 9 + (s > 0 ? 1 : 0), night, alpha, false); }
      if (night) glowPool(ctx, cam, cx3, cy3, h * 0.28, '255,210,150', 15, alpha * 0.55); }   // the drive, lit
    { const [ax, ay] = F(-fh * 0.5, 0); neonBlade(ctx, cam, ax, ay, h * 0.9, h * 1.3, neon, night, alpha); }
    { const [bx, by] = F(fh * 0.5, 0); neonBlade(ctx, cam, bx, by, h * 0.9, h * 1.3, neon, night, alpha); }
    for (const s of [-0.7, -0.24, 0.24, 0.7]) { const [lx, ly] = F(s * fh, fh * 0.9); blinkLight(ctx, cam, lx, ly, h * 0.92, '255,210,90', now, seed + s * 9, alpha, 1.7); }   // chasing marquee bulbs
    glowPool(ctx, cam, dx, dy, h * 0.86, '255,62,138', 22, alpha * (night ? 0.4 : 0.2));           // neon wash
  },
  neonvig(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Lucky Bastard: a plum house under a marquee crown, with a tall blade-sign tower
    const neon = m.neon || '#ff3e8a';
    const houseTop = h * 0.72, crownTop = h * 0.95;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, 0, houseTop, pal, seed, night, alpha, true);                    // the house
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.26, houseTop, crownTop, 'ty_vig_trim', seed + 1, night, alpha, true); // stepped marquee crown
    { const [tx, ty] = F(-fh * 0.72, -fh * 0.2);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, 0, h * 1.9, 'ty_vig_trim', seed + 2, night, alpha, true);
      neonBlade(ctx, cam, tx, ty, h * 0.9, h * 2.35, neon, night, alpha);                                     // the blade itself
      for (let k = 0; k < 7; k++) blinkLight(ctx, cam, tx, ty, h * (0.95 + k * 0.2), '255,210,90', now, seed + k * 3, alpha, 1.8);   // bulbs chasing up the tower
      blinkLight(ctx, cam, tx, ty, h * 1.95, '255,80,80', now, seed, alpha, 2.0); }                           // aviation light on top
    drawFacetDrum(ctx, cam, dx, dy, crownTop, crownTop + h * 0.26, fh * 0.42, fh * 0.42, 12, alpha,
      (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${112 * sh | 0},${62 * sh | 0},${92 * sh | 0})`; }, 'rgb(70,38,58)');
    drawRing(ctx, cam, dx, dy, crownTop + h * 0.26, fh * 0.44, 14, night ? 'rgba(255,62,138,0.85)' : 'rgba(255,140,190,0.45)', 2, alpha);
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, houseTop * 1.02, neon, night, alpha);
    { const [cx, cy] = F(0, fh * 1.05); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.62, h * 0.30, h * 0.38, 'ty_vig_trim', seed + 6, night, alpha, false);
      for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.5, fh * 1.05); draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, h * 0.30, 'ty_vig_trim', seed + 7 + s, night, alpha, false); } }   // canopy + its posts
    for (const s of [-0.78, -0.26, 0.26, 0.78]) { const [lx, ly] = F(s * fh, fh * 0.98); blinkLight(ctx, cam, lx, ly, crownTop * 0.99, '255,210,90', now, seed + s * 9, alpha, 1.7); }   // parapet bulbs
    glowPool(ctx, cam, dx, dy, houseTop * 0.9, '255,62,138', 30, alpha * (night ? 0.55 : 0.24));              // the wash
    if (night) glowPool(ctx, cam, dx, dy, h * 0.10, '255,150,200', 16, alpha * 0.3);                          // pavement spill at the doors
  },
  reefer(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Coldline Reefer Depot: a compressor plant, a rank of reefers and an ammonia stack
    const blockTop = h * 0.52;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, blockTop, pal, seed, night, alpha, true);                     // compressor plant (smaller than the twin's block)
    for (const s of [-0.3, 0.3]) { const [ux, uy] = F(s * fh * 0.5, -fh * 0.1); draw3DBoxAt(ctx, cam, ux, uy, fh * 0.18, blockTop, blockTop + h * 0.14, 'ty_cold_unit', seed + 3 + s * 5, night, alpha, true); }
    for (let k = -2; k <= 2; k++) {
      const [bx, by] = F(k * fh * 0.42, fh * 0.72);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.19, 0, h * 0.30, 'ty_reefer', seed + 10 + k, night, alpha, true);
      blinkLight(ctx, cam, bx, by, h * 0.32, '110,190,255', now, seed + k * 7, alpha, 1.4);                   // compressor running light
    }
    { const [sx, sy] = F(fh * 0.55, -fh * 0.35);                                                              // ammonia stack
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.10, 0, h * 1.5, 'ty_cold_unit', seed + 20, night, alpha, false);
      drawSmoke(ctx, cam, sx, sy, h * 1.5, '190,205,215', alpha * 0.5, now, seed + 21); }
    glowPool(ctx, cam, dx, dy, h * 0.20, '150,200,230', 16, alpha * (night ? 0.36 : 0.2));                    // cold breath, pooled low
  },
  interstack(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Interchange Stack: two rows of containers 4 to 5 high under a rail gantry crane
    const cols = ['ty_cont_r', 'ty_cont_b', 'ty_cont_g', 'ty_cont_y'];
    const hsh = (a) => { a = (a ^ 61) ^ (a >> 16); a += a << 3; a ^= a >> 4; a = Math.imul(a, 0x27d4eb2d); return (a ^ (a >> 15)) >>> 0; };
    for (const row of [-0.5, 0.5]) for (let k = -2; k <= 2; k++) {
      const stack = 4 + hsh(seed + k * 11 + row * 31) % 2;                                                    // 4..5 high: over the twin's 1..3
      const [bx, by] = F(k * fh * 0.40, row * fh * 0.62);
      for (let z = 0; z < stack; z++) draw3DBoxAt(ctx, cam, bx, by, fh * 0.18, h * 0.20 * z, h * 0.20 * (z + 1), cols[hsh(seed + k * 3 + z * 5 + row * 17) & 3], seed + z, night, alpha, true);
    }
    const gTop = h * 1.25;
    for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 1.0, -fh * 0.05); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.07, 0, gTop, 'ty_gantry', seed + 40 + s, night, alpha, false); }
    { const [l0x, l0y] = F(-fh * 1.0, -fh * 0.05), [l1x, l1y] = F(fh * 1.0, -fh * 0.05);
      emitWire(ctx, cam, [l0x, l0y, gTop], [l1x, l1y, gTop], 4, 'rgba(58,92,132,0.95)', alpha, { pull: DECO_PULL }); }
    // ⚠ The trolley moves, so it can't be mass (see `motionOn`); the legs and girder are.
    { const gp = motionPhase(now, seed + 31, 28000, 0.5), gu = gp < 0 ? 0 : gp;
      let gx = moveSeg(gu, 0.00, 0.20, 0.25, -0.78);      // out to the far end of the beam
      gx = moveSeg(gu, 0.52, 0.74, gx, 0.62);             // back with the box
      gx = moveSeg(gu, 0.90, 1.00, gx, 0.25);             // home, where u = 0 leaves it
      let gk = moveSeg(gu, 0.20, 0.34, 0.94, 0.30);
      gk = moveSeg(gu, 0.40, 0.52, gk, 0.94);
      gk = moveSeg(gu, 0.74, 0.84, gk, 0.36);
      gk = moveSeg(gu, 0.86, 0.90, gk, 0.94);
      const [tx, ty] = F(gx * fh, -fh * 0.05), tz = gTop - h * 0.12;
      movingBox(ctx, cam, tx, ty, tz, gTop, fh * 0.13, fh * 0.10, [58, 92, 132], alpha, night, faceYaw(E));
      hoistLine(ctx, cam, tx, ty, tz, h * 0.18 + (tz - h * 0.34) * gk, fh, alpha, night,
        gu > 0.37 && gu < 0.85 ? { h: h * 0.20, hx: fh * 0.18, hy: fh * 0.16, rgb: [150, 66, 54] } : null, faceYaw(E));
      blinkLight(ctx, cam, tx, ty, gTop + 0.004, '255,190,80', now, seed + 46, alpha, 1.6);                   // the beacon rides the trolley
      if (night) glowPool(ctx, cam, tx, ty, tz - h * 0.04, '255,206,140', 9, alpha * 0.3); }                  // the trolley's work lamp, and the box under it
  },
  foundry(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ferro Fabrication Works: a cupola furnace, twin chimneys and a cooling slag heap
    const shedTop = h * 0.5;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, shedTop, pal, seed, night, alpha, true);                       // melt house
    { const [fx, fy] = F(-fh * 0.15, -fh * 0.1);                                                              // cupola furnace: a fat drum
      drawFacetDrum(ctx, cam, fx, fy, 0, h * 1.05, fh * 0.34, fh * 0.30, 12, alpha,
        (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${96 * sh | 0},${84 * sh | 0},${76 * sh | 0})`; }, 'rgb(62,54,50)');
      drawRing(ctx, cam, fx, fy, h * 0.34, fh * 0.35, 12, 'rgba(255,120,40,0.55)', 2, alpha);                 // glowing tap ring
      glowPool(ctx, cam, fx, fy, h * 0.30, '255,120,40', 14, alpha * (night ? 0.55 : 0.3)); }                 // the pour
    for (const s of [-1, 1]) { const [sx, sy] = F(s * fh * 0.62, -fh * 0.45);                                 // twin chimneys
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.12, 0, h * 1.95, 'ty_foundry_stack', seed + 50 + s, night, alpha, false);
      blinkLight(ctx, cam, sx, sy, h * 1.95, '255,80,70', now, seed + 52 + s, alpha, 1.5);
      drawSmoke(ctx, cam, sx, sy, h * 1.95, '86,80,74', alpha * 0.8, now, seed + 54 + s); }
    { const [hx, hy] = F(fh * 0.72, fh * 0.7); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.34, 0, h * 0.18, 'ty_slag', seed + 60, night, alpha, true);
      if (night) glowPool(ctx, cam, hx, hy, h * 0.16, '255,90,40', 8, alpha * 0.35); }                        // slag heap, still cooling
  },
  oldoffice(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Meltwater Freight Office: three brick storeys, a water tank on legs and a fire stair
    const top = h * 1.25;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, top, pal, seed, night, alpha, true);                          // brick block
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, top, top + h * 0.09, pal, seed + 1, night, alpha, true);         // stepped parapet cap
    { const [tx, ty] = F(-fh * 0.3, -fh * 0.25);                                                              // rooftop water tank on legs
      for (const [lx0, ly0] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
        const [lx, ly] = F(-fh * 0.3 + lx0 * fh, -fh * 0.25 + ly0 * fh);
        draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, top + h * 0.09, top + h * 0.30, 'ty_melt_tank', seed + 70, night, alpha, false);
      }
      drawFacetDrum(ctx, cam, tx, ty, top + h * 0.30, top + h * 0.62, fh * 0.22, fh * 0.22, 10, alpha,
        (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${88 * sh | 0},${80 * sh | 0},${70 * sh | 0})`; }, 'rgb(60,54,48)'); }
    { const [fx, fy] = F(fh * 0.95, 0);                                                                       // external fire stair: three zig-zag flights
      for (let k = 0; k < 3; k++) {
        emitWire(ctx, cam, [fx, fy, h * (0.2 + k * 0.35)], [fx, fy + (k % 2 ? -fh * 0.3 : fh * 0.3), h * (0.55 + k * 0.35)], 2, 'rgba(58,52,48,0.9)', alpha);
      } }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.34, m.neon || '#ffb43a', night, alpha);          // sign band low on the frontage, not up top
    if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,190,120', 9, alpha * 0.2);
  },
  bonded(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Customs Bonded Store 7: a barrel-roof shed in a fenced, floodlit compound with a guard box
    const hw = fh * 1.0, wallTop = h * 0.46, archH = hw * 0.40;
    draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, pal, seed, night, alpha, false);
    drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.92, wallTop, archH, 12, alpha, [118, 124, 130]);
    for (const [ax, ay, bx, by] of [[-1.3, -1.3, 1.3, -1.3], [1.3, -1.3, 1.3, 1.3], [1.3, 1.3, -1.3, 1.3], [-1.3, 1.3, -1.3, -1.3]]) {
      const [p0x, p0y] = F(ax * fh, ay * fh), [p1x, p1y] = F(bx * fh, by * fh);
      emitWire(ctx, cam, [p0x, p0y, h * 0.16], [p1x, p1y, h * 0.16], 1.4, 'rgba(70,74,78,0.9)', alpha * 0.8);
    }
    for (const [sx, sy] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {   // corner floodlight masts
      const [mx, my] = F(sx * fh, sy * fh);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.05, 0, h * 0.95, 'ty_bond_fence', seed + 80 + sx * 3 + sy, night, alpha, false);
      if (night) glowPool(ctx, cam, mx, my, h * 0.9, '255,240,200', 10, alpha * 0.34);
    }
    { const [gx, gy] = F(-fh * 0.9, fh * 1.3); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.20, 0, h * 0.26, 'ty_guard', seed + 90, night, alpha, true);
      if (night) glowPool(ctx, cam, gx, gy, h * 0.2, '255,220,160', 5, alpha * 0.3); }                         // guard box at the gate
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, wallTop * 1.04, m.neon || '#6affa8', night, alpha);      // customs seal band
    glowPool(ctx, cam, dx, dy, h * 0.22, '106,255,168', 12, alpha * (night ? 0.28 : 0.14));
  },
  pawn(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Pawn & Pity: a barred shopfront with rooms above and three hanging spheres
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.26, pal, seed + 4, night, alpha, false);          // barred shopfront
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, h * 0.26, h * 0.31, pal, seed + 5, night, alpha, false);  // fascia
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.31, h * 0.68, pal, seed, night, alpha, false);      // the rooms above
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, h * 0.68, h * 0.75, pal, seed + 6, night, alpha, true);   // parapet
    { const [gx, gy] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, gx, gy, fh * 1.0, h * 0.08, h * 0.18, 'ty_door', seed + 1, night, alpha, false); }   // barred storefront band
    // ⚠ The spheres hang beside the door under the fascia; keep them below the roofline.
    { const [px, py] = F(fh * 0.6, fh * 0.62); for (const z of [0.5, 0.41, 0.32]) blinkLight(ctx, cam, px, py, h * z, '255,206,80', now, seed + 20 + z * 10, alpha, 1.5); }   // three hanging spheres
    neonBlade(ctx, cam, dx, dy, h * 0.75, h * 1.02, m.neon || '#ffcf3e', night, alpha);
    if (night) glowPool(ctx, cam, dx, dy, h * 0.2, '210,180,110', 8, alpha * 0.14);                    // dim barred-window glow
  },
  chemsupply(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Screw It: a chem depot with a roof tank and drums out front
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.25, 0, h * 0.62, pal, seed, night, alpha, true);          // depot shed
    { const [tx, ty] = F(-fh * 0.5, 0); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.34, h * 0.62, h * 0.95, pal, seed + 2, night, alpha, true); }   // roof storage tank
    for (const s of [-0.6, 0, 0.6]) { const [ox, oy] = F(s * fh * 0.7, fh * 0.9); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.2, 0, h * 0.22, 'ty_door', seed + 5 + s * 3, night, alpha, true); }   // drums out front
    neonBlade(ctx, cam, dx, dy, h * 0.62, h * 0.9, m.neon || '#7dff6a', night, alpha);
    glowPool(ctx, cam, dx, dy, h * 0.28, '120,220,120', 12, alpha * (night ? 0.3 : 0.16));         // hazard-green wash
  },
  // ── Marrow Street ─────────────────────────────────────────────────────────
  // Low and cluttered: read from the air by what's on the pavement and the roofs.
  deptstore(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Adequate!: a discount slab wearing one enormous banner
    const body = h * 1.28;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, 0, body, pal, seed, night, alpha, true);
    const banZ0 = body * 0.70, banZ1 = body * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.30, banZ0, banZ1, 'ty_door', seed + 1, night, alpha, false);   // the banner, wrapping the whole facade
    roofClutter(ctx, cam, dx, dy, fh * 1.24, body, 'citycore', seed + 2, night, alpha, now);
    // "ADEQUATE!" as surface text on the banner's real quad (the zone prose promises it reads from the water).
    if (frontVis) {
      const bhw = fh * 1.14, [blx, bly] = F(-bhw, fh * 1.32), [brx, bry] = F(bhw, fh * 1.32);
      const TL = cam.proj(blx, bly, banZ1 - body * 0.012), TR = cam.proj(brx, bry, banZ1 - body * 0.012);
      const BR = cam.proj(brx, bry, banZ0 + body * 0.012), BL = cam.proj(blx, bly, banZ0 + body * 0.012);
      if ([TL, TR, BR, BL].every(p => p.f > 0.12)) {
        const tex = bakeSignText('ADEQUATE!', m.neon || '#ff8a2e', night ? 1 : 0, false);
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
      const [nx, ny] = F(fh * 0.70, fh * 1.02); neonBlade(ctx, cam, nx, ny, body * 0.88, body + h * 0.34, m.neon || '#ff8a2e', night, alpha);
    }
    { const [bx, by] = F(fh * 0.90, -fh * 0.60); blinkLight(ctx, cam, bx, by, body + h * 0.03, '255,150,90', now, seed + 9, alpha, 1.8); }   // one roof bulb nobody ever fixed
    if (night) { const [wx, wy] = F(0, fh * 1.06); glowPool(ctx, cam, wx, wy, h * 0.16, '255,190,120', 16, alpha * 0.30); }   // the mannequin windows
  },
  hardware(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Nuts to That: a low shop under a deep awning, stock on the pavement
    const wallTop = h * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, wallTop, pal, seed, night, alpha, true);
    // ⚠ The awning is mass and can't move, so the fascia is fitted to the room above it (marqueeBand).
    const hwSgnW = fh * 1.02, hwSgnZ = wallTop * 0.86, hwRoom = { floor: wallTop * 0.74, wallTop, wall: fh * 1.08 };
    reserveSignBand(hwSgnW, hwSgnZ, hwRoom);   // nothing the kit hangs may cross the name; see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 1.18, fh * 1.14, wallTop * 0.66, wallTop * 0.74, 'ty_door', seed + 1, night, alpha, fh * 0.44);   // the deep awning
    for (let i = 0; i < 3; i++) {   // rope coils, the rebar barrel, a pallet of grey buckets
      const [sx, sy] = F((-0.7 + i * 0.7) * fh * 0.80, fh * 1.16);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.22, 0, h * (0.16 + 0.06 * (i & 1)), 'ty_door', seed + 5 + i, night, alpha, true);
    }
    roofClutter(ctx, cam, dx, dy, fh * 1.08, wallTop, 'citycore', seed + 4, night, alpha, now);   // vents and a water tank break the flat roof
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, hwSgnW, hwSgnZ, m.neon || '#ffcf3e', night, alpha, undefined, hwRoom);
  },
  citybathhouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Lather & Lye: a low tiled bathhouse venting steam
    const wallTop = h * 0.92;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, wallTop, pal, seed, night, alpha, true);
    for (const s of [-1, 1]) {
      const [vx, vy] = F(s * fh * 0.42, -fh * 0.20);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.16, wallTop, wallTop + h * 0.16, 'ty_door', seed + 2 + s, night, alpha, true);
      drawSmoke(ctx, cam, vx, vy, wallTop + h * 0.16, '210,225,230', alpha * 0.55, now, seed + s);
      // Backlight the plume from the vent mouth.
      glowPool(ctx, cam, vx, vy, wallTop + h * 0.14, '170,240,225', 7, alpha * (night ? 0.34 : 0.12));
    }
    { const [px, py] = F(-fh * 0.70, fh * 1.04); draw3DBoxAt(ctx, cam, px, py, fh * 0.07, h * 0.10, h * 0.60, 'ty_marble_col', seed + 7, night, alpha, false); }   // the barber's pole
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 1.00, wallTop * 0.80, m.neon || '#7fe3c0', night, alpha);
    if (night) { const [wx, wy] = F(0, fh * 1.00); glowPool(ctx, cam, wx, wy, h * 0.20, '150,235,215', 12, alpha * 0.26); }
  },
  noodlebar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Nico's Noodle Bar: one open-fronted storey and a steam hood
    const wallTop = h * 0.74;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, true);
    const nbSgnW = fh * 0.86, nbSgnZ = wallTop * 0.74, nbRoom = { floor: wallTop * 0.62, wallTop, wall: fh * 0.90 };
    reserveSignBand(nbSgnW, nbSgnZ, nbRoom);   // nothing the kit hangs may cross the name; see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 1.02, fh * 1.08, wallTop * 0.52, wallTop * 0.62, 'ty_door', seed + 1, night, alpha, fh * 0.34);   // the counter awning over the open front
    { const [hx, hy] = F(0, -fh * 0.10);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.30, wallTop, wallTop + h * 0.20, 'ty_door', seed + 2, night, alpha, true);
      drawSmoke(ctx, cam, hx, hy, wallTop + h * 0.20, '225,215,200', alpha * 0.60, now, seed + 3); }   // the steam hood
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, nbSgnW, nbSgnZ, m.neon || '#ff5a3e', night, alpha, undefined, nbRoom);
    // Paper lanterns along the open front.
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = F((-0.72 + i * 0.48) * fh * 0.86, fh * 1.00);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.045, wallTop * 0.66, wallTop * 0.76, 'ty_door', seed + 12 + i, night, alpha, false);
      glowPool(ctx, cam, lx, ly, wallTop * 0.70, '255,170,95', 4, alpha * (night ? 0.46 : 0.20));
    }
    if (night) {
      const [lx, ly] = F(fh * 0.55, fh * 1.00); glowPool(ctx, cam, lx, ly, wallTop * 0.80, '255,180,110', 7, alpha * 0.40);    // the paper lantern
      const [wx, wy] = F(0, fh * 0.96); glowPool(ctx, cam, wx, wy, wallTop * 0.45, '255,196,130', 12, alpha * 0.34);            // nine lit stools
    }
  },
  outfitter(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Layers: a workwear shopfront with boots hung under the awning
    const wallTop = h * 0.94;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, wallTop, pal, seed, night, alpha, true);
    const ofSgnW = fh * 0.88, ofSgnZ = wallTop * 0.82, ofRoom = { floor: wallTop * 0.68, wallTop, wall: fh * 0.94 };
    reserveSignBand(ofSgnW, ofSgnZ, ofRoom);   // nothing the kit hangs may cross the name; see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 1.04, fh * 1.06, wallTop * 0.60, wallTop * 0.68, 'ty_door', seed + 1, night, alpha, fh * 0.30);
    for (let i = 0; i < 4; i++) {   // the hanging boots
      const [bx, by] = F((-0.75 + i * 0.50) * fh * 0.90, fh * 1.02);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.05, wallTop * 0.44, wallTop * 0.58, 'ty_door', seed + 6 + i, night, alpha, true, 0, fh * 0.02);
    }
    for (const s of [-1, 1]) {   // two headless forms in the window, each in this season's one coat
      const [mx, my] = F(s * fh * 0.34, fh * 0.86);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.09, h * 0.06, h * 0.42, 'ty_marble_col', seed + 14 + s, night, alpha, false);
    }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, ofSgnW, ofSgnZ, m.neon || '#ffb43a', night, alpha, undefined, ofRoom);
    if (night) { const [wx, wy] = F(0, fh * 0.96); glowPool(ctx, cam, wx, wy, h * 0.22, '255,200,140', 11, alpha * 0.24); }
  },
  bodega(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Bodega Vu: a corner shop with awnings on both streets and a chained cooler
    const wallTop = h * 0.82;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, true);
    // Both awnings are the same fascia line turning a corner, so the fascia has one room; see marqueeBand.
    const bdSgnW = fh * 0.84, bdSgnZ = wallTop * 0.78, bdRoom = { floor: wallTop * 0.66, wallTop, wall: fh * 0.90 };
    reserveSignBand(bdSgnW, bdSgnZ, bdRoom);   // nothing the kit hangs may cross the name; see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 0.98, fh * 1.00, wallTop * 0.58, wallTop * 0.66, 'ty_door', seed + 1, night, alpha, fh * 0.28);
    // The side awning: the same call with E turned a quarter.
    awning(ctx, cam, dx, dy, [E[1], -E[0]], fh * 0.98, fh * 1.00, wallTop * 0.58, wallTop * 0.66, 'ty_door', seed + 2, night, alpha, fh * 0.28);
    { const [cx, cy] = F(-fh * 0.60, fh * 1.00); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.14, 0, h * 0.24, 'ty_door', seed + 3, night, alpha, true); }              // the chained cooler
    for (let i = 0; i < 2; i++) {   // produce crates out on the pavement, stacked two high
      const [kx, ky] = F((0.30 + i * 0.34) * fh, fh * 1.06);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.13, 0, h * (0.12 + 0.07 * i), 'ty_door', seed + 16 + i, night, alpha, true);
    }
    // ⚠ `undefined` takes the tile's own name; never hardcode one (other tiles use this arm).
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, bdSgnW, bdSgnZ, m.neon || '#ffe08a', night, alpha, undefined, bdRoom);
    if (night) { const [wx, wy] = F(0, fh * 0.94); glowPool(ctx, cam, wx, wy, h * 0.20, '255,215,150', 10, alpha * 0.30); }
  },
  comicshop(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Mint Condition: a narrow deep shopfront with a gold blade
    const wallTop = h * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, 0, wallTop, pal, seed, night, alpha, true);                                     // deep and narrow: the plan is a corridor
    { const [wx, wy] = F(0, fh * 0.64); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.66, wallTop * 0.30, wallTop * 0.70, 'ty_office', seed + 1, night, alpha, false); }   // the display window, glazed floor to sign
    { const [sx, sy] = F(0, fh * 0.68); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.70, wallTop * 0.72, wallTop * 0.84, 'ty_door', seed + 2, night, alpha, false); }     // the black board the gold lettering sits on
    { const [gx, gy] = F(-fh * 0.44, fh * 0.66); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, wallTop * 0.66, 'ty_door', seed + 3, night, alpha, false); }         // the security grille rolled up beside the door
    { const [rx, ry] = F(0, -fh * 0.10); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.26, wallTop, wallTop + h * 0.16, 'ty_door', seed + 4, night, alpha, true); }        // the dehumidifier plant on the roof, which never stops
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.58, wallTop * 0.78, m.neon || '#ffd24a', night, alpha);
    if (frontVis) { const [nx, ny] = F(fh * 0.34, fh * 0.62); neonBlade(ctx, cam, nx, ny, wallTop * 0.72, wallTop + h * 0.26, m.neon || '#ffd24a', night, alpha); }
    if (night) { const [wx, wy] = F(0, fh * 0.70); glowPool(ctx, cam, wx, wy, h * 0.18, '255,210,120', 10, alpha * 0.34); }   // nine little display lamps, left on
  },
  cinema(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Midway Parks Cinema: an old music hall front on a blind brick house, with a canopy and blade added later.
    const canopy0 = h * 0.29, canopy1 = h * 0.35, nameZ = h * 0.43;
    const winZ0 = h * 0.52, winZ1 = h * 0.72, frontTop = h * 0.78, parTop = h * 0.86;
    const houseTop = h * 0.84, stageTop = h * 1.30, turretTop = h * 0.98;
    const trim = 'ty_reel_trim', faceY = fh * 0.94, yaw = faceYaw(E);
    // The house. ⚠ `ty_reel_flank` (BRICK_WALL, not FACADE_MAT) so it never gets a window grid.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, houseTop, 'ty_reel_flank', seed, night, alpha, true);
    // The stage house.
    { const [sx, sy] = F(0, -fh * 0.46); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.78, houseTop, stageTop, 'ty_reel_loft', seed + 1, night, alpha, true, yaw, fh * 0.40); }
    // The faience front.
    { const [fx, fy] = F(0, fh * 0.62); draw3DBoxAt(ctx, cam, fx, fy, fh * 1.02, 0, frontTop, pal, seed + 2, night, alpha, true, yaw, fh * 0.32); }
    // The cornice and raised centre parapet.
    { const [cx, cy] = F(0, fh * 0.64); draw3DBoxAt(ctx, cam, cx, cy, fh * 1.06, frontTop, frontTop + h * 0.025, trim, seed + 3, night, alpha, true, yaw, fh * 0.33); }
    { const [px, py] = F(0, fh * 0.74); draw3DBoxAt(ctx, cam, px, py, fh * 0.40, frontTop + h * 0.025, parTop, pal, seed + 4, night, alpha, true, yaw, fh * 0.20); }
    { const [px, py] = F(0, fh * 0.74); draw3DBoxAt(ctx, cam, px, py, fh * 0.44, parTop, parTop + h * 0.02, trim, seed + 5, night, alpha, true, yaw, fh * 0.22); }
    for (const s of [-1, 1]) { const [qx, qy] = F(s * fh * 0.34, faceY); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.05, h * 0.49, frontTop, trim, seed + 10 + s, night, alpha, false, yaw, fh * 0.04); }
    // Corner turrets under copper domes, recorded and painted as the Hall of Records' dome is.
    const domeR = fh * 0.18, domeH = h * 0.22, CU = WALL_COL.ty_verdigris;
    for (const s of [-1, 1]) {
      // ⚠ 0.81, not 0.80: at 0.80 a perch point on the cornice line rounds differently in modelTopAt and buildLedges.
      const [tx, ty] = F(s * fh * 0.88, fh * 0.81);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.16, 0, turretTop, trim, seed + 12 + s, night, alpha, true, yaw, fh * 0.16);
      const d0 = turretTop, apex = d0 + domeH;
      if (SHAPE_SINK) SHAPE_SINK.push({ kind: 'drum', dx: tx, dy: ty, wz0: d0, wz1: apex, rb: domeR, rt: domeR * 0.08, n: 12, cap: false, pal: 'ty_verdigris' });
      else {
        const BANDS = 5, rAt = (t) => domeR * Math.sqrt(Math.max(0, 1 - t * t));
        for (let i = 0; i < BANDS; i++) {
          const t0 = i / BANDS, t1 = (i + 1) / BANDS, sh = 0.72 + 0.28 * t0;
          const style = (f) => { const k = sh * (0.82 + (f.nl || 0) * 0.36);
            return `rgb(${Math.round(CU[0] * k)},${Math.round(CU[1] * k)},${Math.round(CU[2] * k)})`; };
          drawFacetDrum(ctx, cam, tx, ty, d0 + domeH * t0, d0 + domeH * t1, rAt(t0), rAt(t1), 14, alpha, style, null, 'ty_verdigris');
        }
      }
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.025, apex, apex + h * 0.05, trim, seed + 14 + s, night, alpha, false);   // the finial
    }
    // The circle bar's round-headed windows, the glass a hair in front of the surround.
    if (frontVis) {
      const dusk = 1 - 0.55 * (+night || 0), TR8 = WALL_COL.ty_reel_trim;
      const surround = `rgb(${Math.round(TR8[0] * dusk)},${Math.round(TR8[1] * dusk)},${Math.round(TR8[2] * dusk)})`;
      const glass = night ? 'rgb(92,68,46)' : 'rgb(38,42,50)';
      const arch = (cx, w, z0, z1, fill, lift) => {
        const zs = z1 - w, P = (x, z) => W3(cx + x, faceY + 0.002, z), N = 6;
        emitFlat(ctx, cam, [P(-w, zs), P(w, zs), P(w, z0), P(-w, z0)], fill, alpha, { lift, cullN: E });
        for (let i = 0; i < N; i++) {
          const a0 = Math.PI * i / N, a1 = Math.PI * (i + 1) / N;
          emitFlat(ctx, cam, [P(0, zs), P(w * Math.cos(a0), zs + w * Math.sin(a0)), P(w * Math.cos(a1), zs + w * Math.sin(a1))], fill, alpha, { lift, cullN: E });
        }
      };
      for (const [cx, w] of [[-fh * 0.60, fh * 0.11], [0, fh * 0.15], [fh * 0.60, fh * 0.11]]) {
        arch(cx, w + fh * 0.03, winZ0 - h * 0.015, winZ1 + fh * 0.03, surround, DETAIL_LIFT);
        arch(cx, w, winZ0, winZ1, glass, DETAIL_LIFT * 2);
      }
    }
    // The canopy, via `awning` because its width and depth differ (a square box would reach the road).
    awning(ctx, cam, dx, dy, E, fh * 1.04, fh * 1.18, canopy0, canopy1, 'ty_soffit', seed + 6, night, alpha, fh * 0.40);
    // The name over the canopy (minus its trade word) and the trade on the blade, which starts above the canopy.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.66, nameZ, m.neon || '#ff4a7a', night, alpha, (sign || '').replace(/\s+CINEMA$/, '') || sign);
    if (frontVis) { const [nx, ny] = F(fh * 0.88, fh * 1.06); neonBlade(ctx, cam, nx, ny, canopy1 + h * 0.02, h * 1.50, m.neon || '#ff4a7a', night, alpha, 'CINEMA'); }
    // Extract plant on the roof.
    roofClutter(ctx, cam, dx, dy, fh * 0.90, houseTop, 'citycore', seed + 7, night, alpha, now);
    if (night) {
      // The canopy lamps light the pavement, so the pool sits at the lip.
      const [cx, cy] = F(0, fh * 1.02); glowPool(ctx, cam, cx, cy, h * 0.24, '255,228,178', 14, alpha * 0.42);
      // The dimmer foyer.
      const [gx, gy] = F(0, fh * 0.76); glowPool(ctx, cam, gx, gy, h * 0.14, '255,196,140', 9, alpha * 0.20);
    }
  },
  bookmaker(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Photo Finish: a bookmaker, all fascia and no window, with a bracket clock and a lit results box
    const shopTop = h * 0.50, fasciaTop = h * 0.60;
    const flatTop = h * 0.94, boxTop = h * 1.06;
    // The blind panel. ⚠ `ty_pfin` isn't in FACADE_MAT, so it never gets a window grid.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, shopTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, shopTop, fasciaTop, 'ty_pfin_dk', seed + 1, night, alpha, false);
    // The flat above, in brick with windows.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, fasciaTop, flatTop, 'ty_kessel', seed + 2, night, alpha, false);
    // The results box (PLAIN_WALL).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, flatTop, boxTop, 'ty_pfin_box', seed + 3, night, alpha, true);
    // The bracket clock.
    { const [kx, ky] = F(fh * 0.52, fh * 1.04); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.12, h * 0.36, h * 0.52, 'ty_pfin_dk', seed + 4, night, alpha, true); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.92, h * 0.55, m.neon || '#ffc94a', night, alpha);
    if (night) {
      // The results box glows at the parapet; no glow at the door, on purpose.
      glowPool(ctx, cam, dx, dy, boxTop, '255,236,150', 12, alpha * 0.34);
      const [kx, ky] = F(fh * 0.52, fh * 1.04); glowPool(ctx, cam, kx, ky, h * 0.44, '255,244,206', 6, alpha * 0.22);
    }
  },
};
