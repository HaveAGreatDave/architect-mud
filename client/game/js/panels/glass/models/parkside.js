// The trades round the Hughson Coliseum: five small buildings on the plots that touch the park
// (scripts/content/hughson-parkside.mjs, docs/proposals/hughson-coliseum.md §10).
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// Each is one tile, drawn in its own frame: local +y is the entrance side and the front wall stands
// a little inside the plot so canopies, awnings and carts fit in front of it.
//
// They're the park's neighbours and they take its language at a smaller size: the box office is the
// Coliseum's own limestone and gilt, and the four shops are the trades a ballpark street has always
// had, each with something on it you can see from the bleacher steps (a neon frank, a copper roaster,
// pennants, a baseball on the parapet). Each says its name once, on its own fascia.
//
// ⚠ NO FACE EXISTS BY NIGHT ONLY. The night mesh is paired to the day one face for face, so glass,
// lamps and neon panels are always emitted and only their colour follows the hour. Strokes, glows and
// smoke aren't mesh and come and go.
// ⚠ THESE ARE IN CONSTANTS, NOT fh AND h. Each type is one plot on the map, and an arm whose awning
// and cart were sized off a rolled footprint stood them in the road or inside the wall.
import {
  DETAIL_LIFT, SHAPE_SINK, bakeSignText, clamp, draw3DBoxAt, drawFacetDrum, drawSmoke, emitSurfaceText,
  emitWire, facePals, faceYaw, glowPool, nearOrMesh, rgb,
} from '../../windshield.js';
import { flatOut, tubeRun } from './downtown.js';
import { drawEntrance } from '../entrance.js';
import { embossText } from './coliseum.js';

const STONE = 'ty_palais_stone', TRIM = 'ty_archive_col', FINC = 'ty_marble_col', BRONZE = 'ty_meridian_bronze';
const COPPER = 'ty_verdigris', GRANITE = 'ty_precast_dk', STEEL = 'ty_fab_steel';
const GILT = [222, 178, 96], BRONZE_RGB = [92, 66, 40], GREEN = [34, 78, 52], CREAM = [226, 214, 186], RED = [168, 36, 30];
const GLASS = [52, 62, 70], WARM = [255, 210, 150];
const cl = (c) => c.map((v) => clamp(v, 0, 255));
const mixRgb = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);

// The tile's kit: boxes and faces in the arm's own frame, the hour, and the front test.
function kit(ctx, cam, F, W3, E, seed, night, alpha) {
  const yaw = faceYaw(E), dn = night ? clamp(+night, 0, 1) : 0, dusk = 1 - 0.55 * dn;
  const B = (x, y, hx, hy, z0, z1, pal, roof = true, s = 0) => {
    const [bx, by] = F(x, y);
    draw3DBoxAt(ctx, cam, bx, by, hx, z0, z1, pal, seed + s, night, alpha, roof, yaw, hy);
  };
  const Q = (pts, out, col, opts) => flatOut(ctx, cam, W3, pts, out, rgb(cl(col)), alpha, opts);
  // A face on the plane y, facing the street, across x0..x1 and up z0..z1.
  const FQ = (y, x0, x1, z0, z1, col, opts) => Q([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], col, opts);
  // A face on the plane x, facing ±x.
  const SQ = (x, s, y0, y1, z0, z1, col) => Q([[x, y0, z1], [x, y1, z1], [x, y1, z0], [x, y0, z0]], [s, 0, 0], col);
  const front = () => {
    const [ax, ay] = F(0, 0), [bx, by] = F(0, 1);
    return (bx - ax) * ((cam.ex || 0) - ax) + (by - ay) * ((cam.ey || 0) - ay) > 0;
  };
  const at = (x, y) => F(x, y);
  // A lit window: glass by day, `lit` after dark by `k`.
  const glass = (k, lit = WARM) => mixRgb(mixRgb(GLASS, [22, 26, 30], dn), lit, dn * k);
  // Neon on a run of points: a painted tube by day, lit with a glow after dark.
  const neon = (pts, rgbOn, lw = 2.2) => {
    const css = dn > 0.3 ? `rgba(${rgbOn},0.95)` : `rgba(${rgbOn.split(',').map((v) => (+v * 0.55) | 0).join(',')},0.9)`;
    for (let i = 1; i < pts.length; i++) emitWire(ctx, cam, W3(...pts[i - 1]), W3(...pts[i]), lw, css, alpha, { pull: 0.01, glow: dn > 0.3 ? 6 : 0, glowCss: `rgb(${rgbOn})` });
  };
  return { yaw, dn, dusk, B, Q, FQ, SQ, front, at, glass, neon };
}

// Raised letters on a face at plane y, across x0..x1 and z0..z1, if the street can see them.
function letters(ctx, cam, F, k, y, x0, x1, z0, z1, text, ink, font, night, alpha, shadow = '#120c06') {
  if (!text || !k.front()) return;
  const quad = (ox, oz) => {
    const yy = y + (ox ? 0.001 : 0.002), sx = ox * 0.0012, sz = oz * 0.0012;
    return [[x0 + sx, z1 + sz], [x1 + sx, z1 + sz], [x1 + sx, z0 + sz], [x0 + sx, z0 + sz]].map(([x, z]) => { const [wx, wy] = F(x, yy); return cam.proj(wx, wy, z); });
  };
  embossText(ctx, cam, quad, text, ink, shadow, night, alpha, { font, fit: (x1 - x0) / (z1 - z0) });
}
// A sign board: a plate, a fillet round it if `fillet`, and its lines of raised letters.
// lines: [[text, z0, z1, halfWidth, font, ink]]
function signBoard(ctx, cam, F, k, y, hw, z0, z1, col, fillet, lines, night, alpha) {
  k.FQ(y, -hw, hw, z0, z1, col.map((c) => c * k.dusk));
  const yg = y + 0.0015;
  if (fillet) {
    const ft = 0.0035, g = fillet.map((c) => c * (1 - 0.35 * k.dn));
    k.FQ(yg, -hw, hw, z1 - ft, z1, g); k.FQ(yg, -hw, hw, z0, z0 + ft, g);
    k.FQ(yg, -hw, -hw + ft, z0, z1, g); k.FQ(yg, hw - ft, hw, z0, z1, g);
  }
  for (const [text, a, b, lhw, font, ink] of lines) letters(ctx, cam, F, k, yg, -lhw, lhw, a, b, text, ink, font, night, alpha);
}
// A striped awning off the wall at plane y: from z0 at the wall out `out` and down to z1, across
// x0..x1 in `n` stripes, with a scalloped valance. Fabric, so its colour takes the dusk.
function stripedAwning(k, y, x0, x1, z0, z1, out, n, a, b) {
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const c = (i % 2 ? b : a).map((v) => v * k.dusk), xa = x0 + w * i, xb = xa + w;
    k.Q([[xa, y, z0], [xb, y, z0], [xb, y + out, z1], [xa, y + out, z1]], [0, 0.6, 0.8], c, { lift: DETAIL_LIFT });
    k.Q([[xa, y + out, z1], [xb, y + out, z1], [xb, y + out, z1 - 0.012], [xa + w * 0.5, y + out, z1 - 0.018], [xa, y + out, z1 - 0.012]], [0, 1, 0], c.map((v) => v * 0.86));
  }
}
// Pennants hung along a string at plane y and height z, x0..x1, every `step`, in turn of `cols`.
function bunting(ctx, cam, W3, k, y, x0, x1, z, step, cols, alpha) {
  if (nearOrMesh()) emitWire(ctx, cam, W3(x0, y, z), W3(x1, y, z), 1, 'rgba(40,36,30,0.9)', alpha, { pull: 0.005 });
  let i = 0;
  for (let x = x0 + step / 2; x < x1; x += step, i++) {
    const c = cols[i % cols.length].map((v) => v * k.dusk);
    k.Q([[x - step * 0.4, y, z], [x + step * 0.4, y, z], [x, y, z - step * 0.9]], [0, 1, 0], c);
  }
}
// A sphere, as bands of a faceted drum (a dome's route: a surface, never a stack of plates).
function ball(ctx, cam, cx, cy, cz, r, rgbC, alpha, dusk) {
  // ⚠ ONE DRUM IN THE SHAPE, AND THE BANDS ONLY OFF IT. The mesh takes the bands as mass, so the shape
  // needs the ball too or `gl:mesh` finds a picture taller than its collision; six bands captured would
  // be six drums where one will do.
  if (SHAPE_SINK) { SHAPE_SINK.push({ kind: 'drum', dx: cx, dy: cy, wz0: cz - r, wz1: cz + r, rb: r, rt: r, n: 12, cap: true, pal: 'ty_marble_col' }); return; }
  const N = 6;
  for (let i = 0; i < N; i++) {
    const t0 = -1 + 2 * i / N, t1 = -1 + 2 * (i + 1) / N;
    const r0 = r * Math.sqrt(Math.max(0, 1 - t0 * t0)), r1 = r * Math.sqrt(Math.max(0, 1 - t1 * t1));
    const style = (f) => { const s = (0.66 + 0.34 * (f.nl || 0)) * (0.8 + 0.2 * (i / N)) * dusk; return `rgb(${(rgbC[0] * s) | 0},${(rgbC[1] * s) | 0},${(rgbC[2] * s) | 0})`; };
    drawFacetDrum(ctx, cam, cx, cy, cz + t0 * r, cz + t1 * r, Math.max(r0, 0.002), Math.max(r1, 0.002), 12, alpha, style, null, 'ty_marble_col');
  }
}

export const PARKSIDE_ARMS = {
  box_office(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE COLISEUM BOX OFFICE: the park's own, beside its main gate
    //                 A low limestone pavilion in the Coliseum's stone, three barred ticket windows
    //                 under a bronze canopy, BOX OFFICE in gilt on a stepped parapet, and a brass queue
    //                 rail on the pavement in front.
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, FQ, SQ, dn, dusk } = k;
    const ledge = facePals(E, { side: TRIM, roof: COPPER }), Y = 0.34;
    B(0, 0, 0.40, 0.36, 0, 0.02, GRANITE, true, 1);
    B(0, 0, 0.38, Y, 0.02, 0.17, STONE, false, 2);
    B(0, 0, 0.39, Y + 0.008, 0.17, 0.185, ledge, true, 3);
    B(0, 0, 0.38, Y, 0.185, 0.21, STONE, true, 4);
    B(0, 0.10, 0.20, Y - 0.10, 0.21, 0.258, STONE, false, 5);
    B(0, 0.10, 0.205, Y - 0.10 + 0.004, 0.258, 0.266, ledge, true, 6);
    for (const s of [-1, 1]) B(s * 0.37, Y - 0.005, 0.012, 0.012, 0.02, 0.232, FINC, true, 7);
    // The canopy, bronze, with a lit edge after dark.
    B(-0.04, Y + 0.035, 0.30, 0.035, 0.128, 0.138, BRONZE, true, 8);
    // Three ticket windows: a bronze frame, the glass lit from the hall, a brass shelf at the slot.
    const frame = BRONZE_RGB.map((c) => c * dusk), win = k.glass(0.85);
    for (const x of [-0.24, -0.04, 0.16]) {
      FQ(Y + 0.002, x - 0.072, x + 0.072, 0.03, 0.124, frame);
      FQ(Y + 0.004, x - 0.062, x + 0.062, 0.042, 0.118, win);
      B(x, Y + 0.012, 0.05, 0.01, 0.038, 0.044, BRONZE, true, 9);
      if (nearOrMesh()) for (let j = -2; j <= 2; j++) emitWire(ctx, cam, W3(x + j * 0.022, Y + 0.006, 0.044), W3(x + j * 0.022, Y + 0.006, 0.116), 1, 'rgba(70,52,30,0.9)', alpha, { pull: 0.004 });
    }
    drawEntrance(ctx, cam, F, W3, E, seed + 20, night, alpha, {
      x: 0.31, y: Y, w: 0.034, top: 0.12, leaves: 1, frameW: 0.008, depth: 0.008,
      frame: [118, 86, 52], lobby: { day: [70, 60, 44], night: [255, 214, 160] }, lamp: '255,214,160', frontVis });
    // The name: COLISEUM over BOX OFFICE, gilt on bronze on the parapet's step.
    const words = ((name || '').trim() || 'Coliseum Box Office').toUpperCase().split(/\s+/);
    const top = words.length > 2 ? words.slice(0, words.length - 2).join(' ') : '', main = words.slice(-2).join(' ');
    signBoard(ctx, cam, F, k, Y + 0.002, 0.18, 0.19, 0.254, [30, 22, 16], GILT,
      top ? [[top, 0.234, 0.249, 0.07, 'deco', '#ecc97e'], [main, 0.196, 0.229, 0.15, 'deco', '#ecc97e']] : [[main, 0.20, 0.245, 0.16, 'deco', '#ecc97e']], night, alpha);
    // A game poster in a bronze case on each flank.
    for (const s of [-1, 1]) {
      SQ(s * 0.381, s, -0.12, 0.12, 0.05, 0.15, frame);
      SQ(s * 0.383, s, -0.10, 0.10, 0.06, 0.14, mixRgb([46, 96, 64], [120, 200, 140], dn * 0.6));
    }
    // The queue rail along the pavement, brass on posts.
    if (nearOrMesh()) {
      const rail = 'rgba(196,160,86,0.95)';
      for (let x = -0.32; x <= 0.22 + 1e-6; x += 0.09) emitWire(ctx, cam, W3(x, 0.465, 0), W3(x, 0.465, 0.036), 1.4, rail, alpha, { pull: 0.004 });
      emitWire(ctx, cam, W3(-0.32, 0.465, 0.036), W3(0.22, 0.465, 0.036), 1.4, rail, alpha, { pull: 0.004 });
    }
    if (dn > 0.05) {
      const [gx, gy] = F(-0.04, Y + 0.06);
      glowPool(ctx, cam, gx, gy, 0.11, '255,214,160', 16, alpha * 0.45 * dn);
      glowPool(ctx, cam, gx, gy, 0.01, '255,214,160', 14, alpha * 0.25 * dn);
      const [px, py] = F(0, Y + 0.05); glowPool(ctx, cam, px, py, 0.18, '255,206,140', 12, alpha * 0.35 * dn);   // the board, floodlit
    }
  },

  frank_stand(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // FITZ'S FRANKS: a white-tiled frank counter by the bleacher gate
    //                 White tile over a dark base course, a serving hatch under a red-and-white
    //                 striped awning, the name in red script on a cream fascia, a neon frank in a bun
    //                 on the roof and a tin chimney with the griddle smoke coming out of it.
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, FQ, dn, dusk } = k;
    const Y = 0.30, TILE = pal || 'ty_cod';
    B(0, -0.04, 0.36, Y + 0.04, 0, 0.17, TILE, true, 1);
    B(0, -0.04, 0.365, Y + 0.045, 0, 0.03, 'ty_sw_milk_dk', true, 2);
    B(0, -0.04, 0.37, Y + 0.05, 0.17, 0.18, facePals(E, { side: 'ty_sw_milk_dk', roof: 'ty_sw_milk_dk' }), true, 3);
    // the fascia and the name
    signBoard(ctx, cam, F, k, Y + 0.002, 0.35, 0.136, 0.168, CREAM, RED, [[((name || '').trim() || 'Fitz\'s Franks'), 0.139, 0.165, 0.27, 'script', '#b22a22']], night, alpha);
    // the serving hatch, lit from the counter, with its steel shelf
    FQ(Y + 0.002, -0.22, 0.10, 0.048, 0.118, [70 * dusk, 72 * dusk, 74 * dusk]);
    FQ(Y + 0.003, -0.21, 0.09, 0.054, 0.114, k.glass(0.9, [255, 226, 180]));
    B(-0.06, Y + 0.022, 0.17, 0.022, 0.048, 0.054, STEEL, true, 4);
    stripedAwning(k, Y, -0.25, 0.13, 0.13, 0.102, 0.085, 8, RED, CREAM);
    drawEntrance(ctx, cam, F, W3, E, seed + 20, night, alpha, {
      x: 0.25, y: Y, w: 0.032, top: 0.115, leaves: 1, frameW: 0.008, depth: 0.008,
      frame: [180, 186, 184], lobby: { day: [66, 70, 72], night: [255, 226, 180] }, frontVis });
    // The frank on the roof: a bun, the frank in it, mustard down it, on a steel frame.
    {
      const fy = 0.04, z = 0.215;
      if (nearOrMesh()) for (const x of [-0.10, 0.10]) emitWire(ctx, cam, W3(x, fy, 0.18), W3(x, fy, z - 0.02), 1.6, 'rgba(110,114,118,0.95)', alpha, { pull: 0.004 });
      const loop = (rx, rz, zc) => Array.from({ length: 17 }, (_, i) => { const a = Math.PI * 2 * i / 16; return [Math.cos(a) * rx, fy, zc + Math.sin(a) * rz]; });
      k.neon(loop(0.14, 0.026, z), '255,190,110', 2.6);          // the bun
      k.neon(loop(0.16, 0.011, z + 0.004), '255,96,90', 2.4);     // the frank
      k.neon(Array.from({ length: 9 }, (_, i) => [-0.12 + i * 0.03, fy + 0.001, z + 0.006 + (i % 2 ? 0.007 : 0)]), '255,226,80', 1.8);   // the mustard
    }
    // the chimney, and the griddle smoke
    const [cx, cy] = F(0.22, -0.22);
    drawFacetDrum(ctx, cam, cx, cy, 0.18, 0.27, 0.02, 0.016, 8, alpha, () => rgb([150 * dusk, 152 * dusk, 156 * dusk]), rgb([120 * dusk, 122 * dusk, 126 * dusk]), STEEL);
    drawSmoke(ctx, cam, cx, cy, 0.28, '210,206,200', alpha * 0.45, now, seed);
    if (dn > 0.05) { const [gx, gy] = F(-0.06, Y + 0.08); glowPool(ctx, cam, gx, gy, 0.09, '255,214,160', 16, alpha * 0.5 * dn); }
  },

  peanut_roaster(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // PRUITT'S PEANUTS & PRETZELS: brick, a copper roaster on the pavement, a pretzel on a bracket
    //                 A red-brick shop with a green shopfront and a green awning, the name in gilt on
    //                 a green fascia, a copper roasting drum on a cart out front with a wisp of smoke
    //                 off it, and a pretzel sign on a bracket turned up and down Vetch Mews.
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, FQ, Q, dn, dusk } = k;
    const Y = 0.30, BRICK = pal || 'ty_corbett';
    B(0, -0.04, 0.36, Y + 0.04, 0, 0.20, BRICK, false, 1);
    B(0, -0.04, 0.37, Y + 0.05, 0.20, 0.222, facePals(E, { side: TRIM, roof: COPPER }), true, 2);
    const green = GREEN.map((c) => c * dusk);
    FQ(Y + 0.002, -0.34, 0.34, 0.0, 0.135, green);
    FQ(Y + 0.004, -0.30, 0.06, 0.03, 0.124, k.glass(0.85));
    signBoard(ctx, cam, F, k, Y + 0.002, 0.34, 0.14, 0.19, GREEN, GILT, [
      ['PRUITT\'S', 0.169, 0.186, 0.10, 'slab', '#ecc97e'],
      [((name || '').replace(/^Pruitt's\s*/i, '').trim() || 'Peanuts & Pretzels').toUpperCase(), 0.145, 0.165, 0.27, 'slab', '#ecc97e'],
    ], night, alpha);
    // the awning, green canvas
    Q([[-0.32, Y, 0.132], [0.08, Y, 0.132], [0.08, Y + 0.08, 0.104], [-0.32, Y + 0.08, 0.104]], [0, 0.6, 0.8], [40 * dusk, 96 * dusk, 62 * dusk], { lift: DETAIL_LIFT });
    FQ(Y + 0.08, -0.32, 0.08, 0.09, 0.104, [32 * dusk, 80 * dusk, 52 * dusk]);
    drawEntrance(ctx, cam, F, W3, E, seed + 20, night, alpha, {
      x: 0.20, y: Y, w: 0.032, top: 0.118, leaves: 1, frameW: 0.008, depth: 0.008,
      frame: GREEN.map((c) => c * 1.3), lobby: { day: [62, 58, 50], night: [255, 214, 160] }, frontVis });
    // The roaster on its cart: a copper drum on a spit over a firebox, smoking a little.
    {
      const y = 0.43, z = 0.078, A = [-0.21, y, z], Bp = [-0.05, y, z];
      B(-0.13, y, 0.07, 0.028, 0.03, 0.05, STEEL, true, 3);
      for (const x of [-0.19, -0.07]) B(x, y, 0.006, 0.006, 0, 0.03, STEEL, false, 4);
      tubeRun(ctx, cam, W3, A, Bp, 0.026, 10, [176, 104, 58], 'brass', alpha, dusk);
      if (dn > 0.05) { const [gx, gy] = F(-0.13, y); glowPool(ctx, cam, gx, gy, 0.045, '255,140,60', 6, alpha * 0.7); }
      const [sx, sy] = F(-0.13, y); drawSmoke(ctx, cam, sx, sy, 0.11, '224,214,196', alpha * 0.35, now, seed + 3);
    }
    // The pretzel on its bracket at the corner, in the plane across the pavement so the mews sees it.
    {
      const x = 0.33, yc = 0.42, zc = 0.24;
      if (nearOrMesh()) emitWire(ctx, cam, W3(x, Y + 0.002, 0.27), W3(x, yc + 0.03, 0.27), 1.6, 'rgba(40,36,30,0.95)', alpha, { pull: 0.004 });
      const circle = (cy, cz, r, a0 = 0, a1 = Math.PI * 2, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [x, cy + Math.cos(a) * r, cz + Math.sin(a) * r]; });
      k.neon(circle(yc - 0.016, zc + 0.006, 0.018), '232,168,84', 2.6);
      k.neon(circle(yc + 0.016, zc + 0.006, 0.018), '232,168,84', 2.6);
      k.neon(circle(yc, zc - 0.006, 0.03, Math.PI * 1.05, Math.PI * 1.95), '232,168,84', 2.6);
    }
    if (dn > 0.05) { const [gx, gy] = F(-0.12, Y + 0.08); glowPool(ctx, cam, gx, gy, 0.08, '255,206,140', 16, alpha * 0.5 * dn); }
  },

  sports_bar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // MULCAHY'S SPORTS BAR: a two-storey corner tavern
    //                 Dark brick over a green-painted shopfront with gold leaf on the glass, the name
    //                 in green neon over the door, the game glowing on a set in the window, sash
    //                 windows upstairs, and pennants in a line under the eaves.
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, FQ, SQ, dn, dusk } = k;
    const Y = 0.32, BRICK = pal || 'ty_embassy_brick';
    B(0, -0.03, 0.38, Y + 0.03, 0, 0.19, BRICK, false, 1);
    B(0, -0.03, 0.38, Y + 0.03, 0.19, 0.36, BRICK, false, 2);
    B(0, -0.03, 0.39, Y + 0.04, 0.36, 0.38, facePals(E, { side: TRIM, roof: COPPER }), true, 3);
    B(-0.25, -0.24, 0.03, 0.03, 0.38, 0.45, BRICK, true, 4);   // the chimney
    const green = GREEN.map((c) => c * dusk);
    FQ(Y + 0.002, -0.37, 0.37, 0.0, 0.19, green);
    // two big windows, the right one with the set glowing in it
    for (const [x, tv] of [[-0.23, false], [0.03, true]]) {
      FQ(Y + 0.004, x - 0.11, x + 0.11, 0.035, 0.14, k.glass(0.75, [255, 196, 130]));
      if (tv) FQ(Y + 0.005, x + 0.02, x + 0.08, 0.08, 0.125, mixRgb([60, 90, 110], [150, 200, 255], 0.4 + 0.4 * dn));
    }
    // the name, green neon on the fascia over the shopfront
    k.FQ(Y + 0.003, -0.36, 0.36, 0.148, 0.186, [22 * dusk, 46 * dusk, 30 * dusk]);
    if (k.front()) {
      const text = ((name || '').trim() || 'Mulcahy\'s Sports Bar').toUpperCase();
      const words = text.split(/\s+/), main = words[0], sub = words.slice(1).join(' ');
      const tex = bakeSignText(main, dn > 0.3 ? '#6dffa8' : '#cfe8d0', dn > 0.3 ? 1 : 0, false, dn <= 0.3, true, { font: 'script', sub: sub || undefined, fit: 0.56 / 0.034 });
      if (tex) {
        const q = [[-0.28, 0.183], [0.28, 0.183], [0.28, 0.151], [-0.28, 0.151]].map(([x, z]) => { const [wx, wy] = F(x, Y + 0.006); return cam.proj(wx, wy, z); });
        if (q.every((p) => p.f > 0.1)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
    }
    drawEntrance(ctx, cam, F, W3, E, seed + 20, night, alpha, {
      x: 0.27, y: Y, w: 0.034, top: 0.13, leaves: 1, frameW: 0.008, depth: 0.008,
      frame: GREEN.map((c) => c * 1.4), lobby: { day: [58, 50, 40], night: [255, 196, 130] }, lamp: '255,196,130', frontVis });
    // upstairs: three sash windows on the front and two on each flank
    for (const x of [-0.24, 0, 0.24]) {
      FQ(Y + 0.002, x - 0.05, x + 0.05, 0.225, 0.325, CREAM.map((c) => c * dusk));
      FQ(Y + 0.004, x - 0.042, x + 0.042, 0.233, 0.317, k.glass(x === 0 ? 0.7 : 0.35, [255, 200, 140]));
    }
    for (const s of [-1, 1]) for (const y of [-0.16, 0.10]) {
      SQ(s * 0.381, s, y - 0.045, y + 0.045, 0.225, 0.325, CREAM.map((c) => c * dusk));
      SQ(s * 0.383, s, y - 0.037, y + 0.037, 0.233, 0.317, k.glass(0.35, [255, 200, 140]));
    }
    bunting(ctx, cam, W3, k, Y + 0.012, -0.37, 0.37, 0.352, 0.062, [GREEN.map((c) => c * 1.6), CREAM, GILT], alpha);
    if (dn > 0.05) {
      const [gx, gy] = F(-0.1, Y + 0.07);
      glowPool(ctx, cam, gx, gy, 0.09, '255,196,130', 18, alpha * 0.5 * dn);
      const [nx, ny] = F(0, Y + 0.02); glowPool(ctx, cam, nx, ny, 0.167, '110,255,160', 14, alpha * 0.35 * dn);
    }
  },

  souvenir_shop(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KIMBLE'S SOUVENIRS & CARDS: pennants, caps and a baseball on the parapet
    //                 Cream glazed tile with a green shopfront, pennants hung in fans in the window, a
    //                 card machine glowing behind the glass, bunting over the door, KIMBLE'S on the
    //                 parapet's step and SOUVENIRS & CARDS on the fascia, and a baseball on top.
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, FQ, Q, dn, dusk } = k;
    const Y = 0.30, TILE = pal || 'ty_reel';
    B(0, -0.04, 0.34, Y + 0.04, 0, 0.18, TILE, false, 1);
    B(0, -0.04, 0.35, Y + 0.05, 0.18, 0.205, facePals(E, { side: TRIM, roof: COPPER }), true, 2);
    B(0, 0.08, 0.16, Y - 0.08, 0.205, 0.238, TILE, false, 3);
    B(0, 0.08, 0.165, Y - 0.08 + 0.004, 0.238, 0.245, facePals(E, { side: TRIM, roof: COPPER }), true, 4);
    const green = GREEN.map((c) => c * dusk);
    FQ(Y + 0.002, -0.32, 0.32, 0.0, 0.13, green);
    FQ(Y + 0.004, -0.30, 0.10, 0.026, 0.122, k.glass(0.8));
    // pennants fanned out in the window, and the card machine glowing behind the glass
    {
      const cols = [[34, 120, 70], [180, 40, 36], [222, 178, 96], [30, 60, 140], [226, 214, 186]];
      for (const [cx, cz] of [[-0.22, 0.034], [-0.07, 0.034]]) for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.18 + 0.16 * i), L = 0.07, c = cols[i].map((v) => v * dusk);
        const tip = [cx + Math.cos(a) * L, cz + Math.sin(a) * L], b0 = [cx + Math.cos(a + 0.12) * 0.012, cz + Math.sin(a + 0.12) * 0.012], b1 = [cx + Math.cos(a - 0.12) * 0.012, cz + Math.sin(a - 0.12) * 0.012];
        Q([[b0[0], Y + 0.005, b0[1]], [tip[0], Y + 0.005, tip[1]], [b1[0], Y + 0.005, b1[1]]], [0, 1, 0], c);
      }
      FQ(Y + 0.0045, 0.03, 0.085, 0.034, 0.11, mixRgb([90, 40, 110], [230, 120, 255], 0.35 + 0.55 * dn));
    }
    signBoard(ctx, cam, F, k, Y + 0.002, 0.32, 0.136, 0.174, GREEN, GILT, [[((name || '').replace(/^Kimble's\s*/i, '').trim() || 'Souvenirs & Cards').toUpperCase(), 0.142, 0.168, 0.25, 'deco', '#ecc97e']], night, alpha);
    signBoard(ctx, cam, F, k, Y + 0.002, 0.14, 0.208, 0.235, CREAM, null, [['KIMBLE\'S', 0.211, 0.233, 0.11, 'deco', '#1f4a30']], night, alpha);
    drawEntrance(ctx, cam, F, W3, E, seed + 20, night, alpha, {
      x: 0.21, y: Y, w: 0.032, top: 0.118, leaves: 1, frameW: 0.008, depth: 0.008,
      frame: GREEN.map((c) => c * 1.4), lobby: { day: [60, 64, 58], night: [255, 214, 160] }, frontVis });
    bunting(ctx, cam, W3, k, Y + 0.012, 0.13, 0.30, 0.128, 0.034, [GREEN.map((c) => c * 1.6), CREAM, RED], alpha);
    // the baseball on the parapet, with its red stitching
    {
      const [bx, by] = F(0, 0.08), r = 0.034, z = 0.245 + r;
      ball(ctx, cam, bx, by, z, r, [236, 230, 214], alpha, dusk);
      if (nearOrMesh() && !SHAPE_SINK) for (const s of [-1, 1]) {
        const pts = Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 + Math.PI * i / 8; return W3(s * r * 0.55 * Math.cos(a) * 0.9, 0.08 + r * 0.98 * Math.cos(a) * 0.4 + 0.012, z + r * 0.9 * Math.sin(a)); });
        for (let i = 1; i < pts.length; i++) emitWire(ctx, cam, pts[i - 1], pts[i], 1.4, `rgba(${(180 * dusk) | 0},40,36,0.95)`, alpha, { pull: 0.004 });
      }
    }
    if (dn > 0.05) { const [gx, gy] = F(-0.1, Y + 0.08); glowPool(ctx, cam, gx, gy, 0.08, '255,214,160', 16, alpha * 0.5 * dn); }
  },
};
