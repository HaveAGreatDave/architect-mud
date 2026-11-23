// The hover car dealership: a glass showroom for mini VTOLs (docs/proposals/vtol-dealership.md).
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
//
// `vtol_dealer` is a TYPE arm and carries nothing of Coldwater's: any facade with
// `building_type: vtol_dealer` draws through it, and the name on its roof edge is the tile's own.
// Which car stands on which bay is client/shared/dealer-display.js, the table the showroom in ROOM
// reads too.
//
// Local frame: +y is the street the door is on, -x the other glazed side (a dealership wants a corner
// plot) and +x the party wall. The plan's numbers are DEALER_PLAN's, which the room in ROOM is laid out from.
//
// ⚠ IN TILE UNITS, NEVER fh AND h, the `car_park` arm's reason: a car is 4.6 m whatever the tile
//    rolled, and the showroom is built round the cars. About 18 m to the tile, and z is the same unit.
// ⚠ THE ROOF PAD IS AT THE TILE'S CENTRE, ON THE ROOF. A facade that is also a VTOL-only field is a
//    rooftop pad to the cockpit, caught at `modelTopZAt` of the tile's middle (windshield.js
//    drawRoofPadCatch). So nothing taller than the slab may stand over the middle of the tile.
// ⚠ THE CARS ARE ADORNMENT. They're flats, so the shape capture, the collision and the shadows
//    never see them, and the model stays the same whoever is parked on the pad.
// ⚠ NO FACE EXISTS BY NIGHT ONLY (lot-buildings.js): the night mesh pairs with the day one face
//    for face, so every flat is always emitted and only its colour follows the hour.
// ⚠ NOTHING MOVES. The turntables stand still: building-styles §4.5 keeps movement rare, and a
//    turning car would have to be a decal.
import {
  DETAIL_LIFT, FACE_EPS, SHAPE_SINK, SIGN_WORD, bakeSignText, clamp, draw3DBoxAt, drawFacetDrum,
  drawRing, emitFlat, emitSurfaceText, emitWire, faceYaw, flatsDropped, glowPool, helideck,
  marqueeBand, massDropped, nearOrMesh, reserveSignBand, rgb,
} from '../../windshield.js';
import { aircraftFaces, faceBaseRgb, liveryPalette, standFaces } from '../../aircraft3d.js';
import { drawEntrance } from '../entrance.js';
import { DEALER_BAYS, DEALER_PLAN, dealerBay, dealerCar, dealerEmblem, dealerPylonCar } from '../../../../../shared/dealer-display.js';

const TILE_M = DEALER_PLAN.tileM;
// The plan, in tile units.
const D = {
  XW: DEALER_PLAN.x0, XE: 0.44, XI: DEALER_PLAN.x1,                    // the other glazed side, the party wall's outer and inner faces
  YF: DEALER_PLAN.yFront, YB: -0.44, YC: DEALER_PLAN.yBack,           // the front glass, the back wall, the core's showroom face
  FLOOR: DEALER_PLAN.floor, CEIL: DEALER_PLAN.ceil, ROOF: 0.320, FASCIA: 0.440,   // the slab is CEIL to ROOF; the sign fascia stands on its street edges
  EDGE: 0.44,                            // the roof slab's edge, front and west
  DOOR_X: DEALER_PLAN.doorX, DOOR_W: DEALER_PLAN.doorHalf, DOOR_TOP: 0.130,
  TABLE_R: DEALER_PLAN.tableR,
  PAD_R: 0.17,
  MAST: [-0.300, 0.290], MAST_TOP: 0.500,
};
// The turntables behind the glass: where, and which way each car's nose points (the shared plan).
const TABLES = DEALER_PLAN.tables;
const STONE = 'ty_marble_col', CORE = 'ty_sdeck_black', STEEL = 'ty_hf_mirror';
const STEEL_RGB = [176, 190, 204], CORE_RGB = [26, 28, 34], STONE_RGB = [206, 204, 198];

const mix = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
const cl = (c) => c.map((v) => Math.round(clamp(v, 0, 255)));
// Newell's normal of a polygon.
function normalOf(q) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// ── A DISPLAY CAR ─────────────────────────────────────────────────────────────────────────────
// One car's faces in model units (f fore, g right, h up) with their paint, per car and detail.
// Fine is the body and glass with the coarse fan ducts and no feet (the fine ducts are two thirds
// of a car's faces, and neither they nor the feet can be seen through a showroom window); coarse is
// the mesh's own far level. The cars are most of this model's faces: scripts/shapes/glmesh.budget.json.
const _cars = new Map();
function carModel(car, fine) {
  const lv = car.livery || {};
  const key = `${car.cls}|${lv.variant || ''}|${lv.base || ''}|${lv.trim || ''}|${fine ? 1 : 0}`;
  let mdl = _cars.get(key);
  if (mdl) return mdl;
  const variant = lv.pattern === 'factory' ? (lv.variant || '') : '';
  let faces;
  try {
    const coarse = aircraftFaces(car.cls, 0, false, variant) || [];
    faces = fine ? (standFaces(car.cls, false, variant) || []).filter((f) => f.role !== 'nacelle' && f.role !== 'gear' && f.role !== 'strut').concat(coarse.filter((f) => f.role === 'nacelle')) : coarse;
  } catch { faces = []; }
  const pal = liveryPalette(lv, car.cls);
  let f0 = Infinity, f1 = -Infinity, g0 = Infinity, g1 = -Infinity, h0 = Infinity;
  const out = [];
  for (const fc of faces) {
    if (!fc.p || fc.p.length < 3 || fc.role === 'rotor') continue;
    for (const p of fc.p) { f0 = Math.min(f0, p[0]); f1 = Math.max(f1, p[0]); g0 = Math.min(g0, p[1]); g1 = Math.max(g1, p[1]); h0 = Math.min(h0, p[2]); }
    // the coarse ducts carry no paint slot, so they'd take the body's colour: a fan housing is cast black
    out.push({ p: fc.p, c: fc.role === 'nacelle' ? [34, 36, 42] : (faceBaseRgb(fc, pal) || [120, 120, 120]) });
  }
  mdl = { faces: out, cf: (f0 + f1) / 2, cg: (g0 + g1) / 2, h0, len: Math.max(1e-6, f1 - f0) };
  if (_cars.size > 24) _cars.delete(_cars.keys().next().value);
  _cars.set(key, mdl);
  return mdl;
}
// Stand `car` with its middle over local (cx, cy), its lowest point at `z`, its nose along `nose`,
// pitched nose-up by `pitch` radians. `glow` 0..1 is how much of its day colour it keeps after dark.
function displayCar(ctx, cam, W3, car, cx, cy, z, nose, pitch, alpha, dn, glow) {
  if (SHAPE_SINK || flatsDropped()) return;
  const mdl = carModel(car, nearOrMesh());
  if (!mdl.faces.length) return;
  const s = (car.metres || 4.6) / TILE_M / mdl.len;
  const [nx, ny] = nose, rx = -ny, ry = nx;          // the car's right, in a frame where +y is toward the viewer's street
  const cp = Math.cos(pitch), sp = Math.sin(pitch), keep = 1 - (1 - glow) * dn;
  for (const fc of mdl.faces) {
    const q = fc.p.map((p) => {
      const f = (p[0] - mdl.cf) * s, g = (p[1] - mdl.cg) * s, hh = (p[2] - mdl.h0) * s;
      const f2 = f * cp - hh * sp, h2 = f * sp + hh * cp;
      return [cx + f2 * nx + g * rx, cy + f2 * ny + g * ry, z + h2];
    });
    const n = normalOf(q), k = clamp(0.62 + 0.30 * Math.abs(n[2]) + 0.10 * (n[1] * 0.8 - n[0] * 0.4), 0.42, 1.08) * keep;
    emitFlat(ctx, cam, q.map((p) => W3(p[0], p[1], p[2])), rgb(cl(fc.c.map((v) => v * k))), alpha, { lift: DETAIL_LIFT });
  }
}

export const DEALERSHIP_ARMS = {
  vtol_dealer(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    const dn = night ? clamp(+night, 0, 1) : 0, dusk = 1 - 0.55 * dn, yaw = faceYaw(E);
    const box = (lx, ly, hx, hy, z0, z1, p, roof = true, s = 0) => {
      if (massDropped()) return;
      const [x, y] = F(lx, ly);
      draw3DBoxAt(ctx, cam, x, y, hx, z0, z1, p, seed + s, night, alpha, roof, yaw, hy);
    };
    // A flat in the model's frame, facing local `out`; `day` and `lit` are [r,g,b], and `a` its own alpha.
    const O = W3(0, 0, 0);
    const flat = (pts, out, day, lit, a = 1, lift = 1) => {
      if (SHAPE_SINK || flatsDropped()) return;
      const Dw = W3(out[0], out[1], out[2]), o = [Dw[0] - O[0], Dw[1] - O[1], Dw[2] - O[2]];
      let q = pts.map((p) => W3(p[0], p[1], p[2]));
      const n = normalOf(q);
      if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0) q = q.reverse();
      emitFlat(ctx, cam, q, rgb(cl(lit ? mix(day, lit, dn) : day.map((v) => v * dusk))), alpha * a,
        { lift: DETAIL_LIFT * lift, cullN: Math.abs(o[2]) < 0.8 ? [o[0], o[1]] : undefined });
    };
    // A wall panel: on the plane `axis` = `d`, from `u0` to `u1` along the wall and `z0` to `z1` up.
    const OUTS = { f: [0, 1, 0], b: [0, -1, 0], w: [-1, 0, 0], e: [1, 0, 0] };
    const pane = (side, d, u0, u1, z0, z1, day, lit, a, lift) => {
      const P = side === 'f' || side === 'b' ? (u, z) => [u, d, z] : (u, z) => [d, u, z];
      flat([P(u0, z1), P(u1, z1), P(u1, z0), P(u0, z0)], OUTS[side], day, lit, a, lift);
    };
    const word = (side, d, u0, u1, z0, z1, label, ink, lit) => {
      if (SHAPE_SINK || !label) return;
      const tex = bakeSignText(label, ink, lit && night ? 1 : 0, false, true, true, { font: 'condensed' });
      if (!tex) return;
      // read left to right from outside: from the front the viewer's right is +x, from the -x side it's +y
      const P = side === 'f' ? (u, z) => [...F(u, d), z] : (u, z) => [...F(d, u), z];
      const q = [[u0, z1], [u1, z1], [u1, z0], [u0, z0]].map(([u, z]) => { const [wx, wy, wz] = P(u, z); return cam.proj(wx, wy, wz); });
      if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
    };
    const { XW, XE, XI, YF, YB, YC, FLOOR, CEIL, ROOF, FASCIA, EDGE } = D;
    const ROOM_DAY = [214, 218, 222], ROOM_LIT = [250, 248, 240];

    // 1) THE MASS. A pale floor slab, the dark core across the back, the party wall, and the roof:
    //    a thin slab that stands forward of the glass over the pavement on both street sides.
    box((XW + XE) / 2, (YB + YF) / 2 + 0.01, (XE - XW) / 2 + 0.012, (YF - YB) / 2 + 0.014, 0, FLOOR, STONE, true, 0);
    box((XW + XE) / 2, (YB + YC) / 2, (XE - XW) / 2, (YC - YB) / 2, FLOOR, CEIL, CORE, false, 1);
    box((XI + XE) / 2, (YC + YF) / 2, (XE - XI) / 2, (YF - YC) / 2, FLOOR, CEIL, CORE, false, 2);
    box(0, 0, EDGE, EDGE, CEIL, ROOF, STONE, true, 3);
    // The sign fascia: a dark upstand along the street front and round the corner onto the other street side.
    const FT = 0.012;
    box(0, EDGE - FT, EDGE, FT, ROOF, FASCIA, CORE, true, 4);
    box(-EDGE + FT, 0.17, FT, 0.27 - FT, ROOF, FASCIA, CORE, true, 5);
    // Steel posts at the glass's corners and between its panes, floor to slab.
    const POSTS_F = [XW, -0.12, 0.155, D.DOOR_X - D.DOOR_W - 0.012, D.DOOR_X + D.DOOR_W + 0.012];
    const POSTS_W = [YC, 0.08];
    for (const [i, x] of POSTS_F.entries()) box(x, YF, 0.005, 0.005, FLOOR, CEIL, STEEL, false, 10 + i);
    for (const [i, y] of POSTS_W.entries()) box(XW, y, 0.005, 0.005, FLOOR, CEIL, STEEL, false, 20 + i);

    // 2) THE ROOM BEHIND THE GLASS: the ceiling, the floor's sheen and the core's face, all lit
    //    cool white after dark, so the box is a lantern with the cars standing in it.
    flat([[XW, YC, CEIL - 0.001], [XI, YC, CEIL - 0.001], [XI, YF, CEIL - 0.001], [XW, YF, CEIL - 0.001]], [0, 0, -1], ROOM_DAY, ROOM_LIT);
    flat([[XW, YC, FLOOR + 0.0006], [XI, YC, FLOOR + 0.0006], [XI, YF, FLOOR + 0.0006], [XW, YF, FLOOR + 0.0006]], [0, 0, 1], STONE_RGB, [236, 232, 222]);
    pane('f', YC + FACE_EPS, XW, XI, FLOOR, CEIL, [46, 50, 58], [84, 90, 100]);
    pane('w', XI - FACE_EPS, YC, YF, FLOOR, CEIL, [46, 50, 58], [84, 90, 100]);
    // Light battens in the ceiling, one run over each row of cars.
    if (!SHAPE_SINK) for (const y of [TABLES.a.at[1], TABLES.d.at[1]]) {
      emitWire(ctx, cam, W3(XW + 0.03, y, CEIL - 0.003), W3(XI - 0.03, y, CEIL - 0.003), 2,
        night ? 'rgba(255,252,240,0.95)' : 'rgba(236,238,240,0.8)', alpha, { pull: 0.02, glow: night ? 5 : 0, glowCss: 'rgb(255,250,236)' });
    }

    // 3) THE TURNTABLES AND THEIR CARS. A steel-rimmed disc in the floor, a ring in the maker's
    //    colour, the maker's plate on the core behind, and the car.
    for (const [where, t] of Object.entries(TABLES)) {
      const bay = dealerBay(where);
      if (!bay) continue;
      const [tx, ty] = t.at, [px, py] = F(tx, ty), line = bay.line;
      const skin = (f) => { const s = (0.62 + f.nl * 0.38) * dusk; return rgb(cl(STEEL_RGB.map((v) => v * s))); };
      if (!massDropped()) drawFacetDrum(ctx, cam, px, py, FLOOR, FLOOR + 0.010, D.TABLE_R, D.TABLE_R, 20, alpha, skin, rgb(cl(mix([226, 226, 222], [250, 248, 240], dn))), 'ty_fuel_white');
      drawRing(ctx, cam, px, py, FLOOR + 0.0112, D.TABLE_R * 0.92, 24, `rgba(${line[0]},${line[1]},${line[2]},${night ? 0.95 : 0.7})`, 2, alpha);
      displayCar(ctx, cam, W3, dealerCar(bay), tx, ty, FLOOR + 0.0105, t.nose, 0, alpha, dn, 1.12);
      if (night) glowPool(ctx, cam, px, py, FLOOR + 0.06, '255,250,236', 16, alpha * 0.34 * dn);
      // The maker's plate on the core, behind its car: a dark plate, a bar in the maker's colour, its letter.
      const bx = clamp(tx, XW + 0.09, XI - 0.09), z0 = 0.185, z1 = 0.245, hw = 0.062, yP = YC + FACE_EPS * 2;
      pane('f', yP, bx - hw, bx + hw, z0, z1, [14, 15, 18], [20, 22, 26], 1, 1.3);
      pane('f', yP + FACE_EPS, bx - hw * 0.84, bx + hw * 0.84, z0 + 0.006, z0 + 0.012, line.map((v) => v * 0.8), line, 1, 1.6);
      if (frontVis) word('f', yP + FACE_EPS * 2, bx - hw * 0.8, bx + hw * 0.8, z0 + 0.016, z1 - 0.006, bay.maker.toUpperCase(), '#f0f2f4', true);
    }

    // 4) THE GLASS. Thin sheets with their own alpha, so the room shows through them; a head rail
    //    under the slab and a foot rail on the floor hold them.
    const SHEET_DAY = [118, 150, 166], SHEET_LIT = [150, 176, 190], SHEET_A = 0.10;
    const front = [...POSTS_F.slice(0, 4)], yG = YF + FACE_EPS;
    for (let i = 0; i < front.length - 1; i++) pane('f', yG, front[i] + 0.005, front[i + 1] - 0.005, FLOOR, CEIL, SHEET_DAY, SHEET_LIT, SHEET_A, 1.2);
    pane('f', yG, POSTS_F[4] + 0.005, XI, FLOOR, CEIL, SHEET_DAY, SHEET_LIT, SHEET_A, 1.2);
    pane('f', yG, POSTS_F[3] + 0.005, POSTS_F[4] - 0.005, D.DOOR_TOP + 0.012, CEIL, SHEET_DAY, SHEET_LIT, SHEET_A, 1.2);   // over the door
    pane('w', XW - FACE_EPS, YC + 0.005, 0.08 - 0.005, FLOOR, CEIL, SHEET_DAY, SHEET_LIT, SHEET_A, 1.2);
    pane('w', XW - FACE_EPS, 0.08 + 0.005, YF - 0.005, FLOOR, CEIL, SHEET_DAY, SHEET_LIT, SHEET_A, 1.2);
    for (const z of [FLOOR, CEIL - 0.006]) {
      pane('f', yG + FACE_EPS, XW, XI, z, z + 0.006, STEEL_RGB.map((v) => v * 0.55), null, 1, 1.4);
      pane('w', XW - FACE_EPS * 2, YC, YF, z, z + 0.006, STEEL_RGB.map((v) => v * 0.55), null, 1, 1.4);
    }

    // 5) THE DOOR, a glass pair in the front under the slab's overhang, the showroom lit behind it.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: D.DOOR_X, y: YF, w: D.DOOR_W, z0: FLOOR, top: D.DOOR_TOP, leaves: 2, frameW: 0.006, depth: 0.008,
      frame: [84, 92, 100], lobby: { day: [74, 88, 98], night: [206, 216, 222] }, lamp: '236,244,255', mat: true, step: false, frontVis });

    // 6) THE SIGN FASCIA. The name once, on the street front, with the trade under it (`tradeSub`);
    //    four maker badges in a row left of it; the trade again round the corner; and a light line
    //    under the slab's edge on both street sides.
    const SGN = 0.17, SGN_X = 0.245, sgnZ = (ROOF + FASCIA) / 2, sgnRoom = { floor: ROOF, wallTop: FASCIA, wall: SGN };
    reserveSignBand(SGN, sgnZ, sgnRoom);
    if (frontVis) { const [sx, sy] = F(SGN_X, EDGE + 0.004 - SGN); marqueeBand(ctx, cam, sx, sy, E, SGN, sgnZ, m.neon || '#e8f4ff', night, alpha, undefined, sgnRoom); }
    DEALER_BAYS.forEach((bay, i) => {
      const bx = -0.375 + i * 0.094, hw = 0.038, z0 = ROOF + 0.02, z1 = FASCIA - 0.02, yE = EDGE + FACE_EPS;
      pane('f', yE, bx - hw, bx + hw, z0, z1, [10, 11, 14], [14, 16, 20], 1, 1.3);
      // the maker's emblem (dealer-display.js), in its line colour: quads on the plate, so it's mesh and lit after dark
      const zc = (z0 + z1) / 2, k = Math.min(hw, (z1 - z0) / 2) * 0.82;
      // Pieces come back to front on one plane, so each layer stands a hair off the last: the ground (a dim
      // tint of the line), the device (the line, lit after dark), then anything cut out of it (the plate's black).
      let layer = 0;
      dealerEmblem(bay.maker).forEach((piece, n) => {
        const mark = piece.tone !== 'field';
        if (mark && layer < 1) layer = 1; else if (!mark && n > 0 && layer >= 1) layer = 2;
        const day = !mark ? (layer === 2 ? [10, 11, 14] : bay.line.map((c) => c * 0.22)) : bay.line.map((c) => c * 0.82);
        const lit = !mark ? (layer === 2 ? [14, 16, 20] : bay.line.map((c) => c * 0.30)) : bay.line;
        const pts = piece.p.map(([u, v]) => [bx + u * k, yE + FACE_EPS * (1 + layer * 0.6), zc + v * k]);
        // a flat is three or four points, so a longer convex piece goes out as a fan
        for (let j = 1; j + 1 < pts.length; j += 2) flat([pts[0], pts[j], pts[j + 1], ...(pts[j + 2] ? [pts[j + 2]] : [])], [0, 1, 0], day, lit, 1, 1.6 + layer * 0.2);
      });
    });
    // The trade on the other street side, never the name twice (building-styles §4.1).
    { const [ax, ay] = F(-EDGE, 0), [bx, by] = F(-EDGE - 1, 0);
      const sideVis = ((cam.ex || 0) - ax) * (bx - ax) + ((cam.ey || 0) - ay) * (by - ay) > 0;   // the eye is on the -x side of that edge
      if (sideVis) word('w', -EDGE - FACE_EPS * 3, 0.0, 0.34, ROOF + 0.028, FASCIA - 0.028, SIGN_WORD.vtol_dealer || '', '#e8f4ff', true); }
    if (!SHAPE_SINK) {
      const css = night ? 'rgba(214,236,255,0.95)' : 'rgba(206,214,222,0.7)', opt = { pull: 0.02, glow: night ? 6 : 0, glowCss: 'rgb(200,228,255)' };
      emitWire(ctx, cam, W3(-EDGE, EDGE - 0.004, CEIL - 0.002), W3(EDGE, EDGE - 0.004, CEIL - 0.002), 2, css, alpha, opt);
      emitWire(ctx, cam, W3(-EDGE + 0.004, YB, CEIL - 0.002), W3(-EDGE + 0.004, EDGE, CEIL - 0.002), 2, css, alpha, opt);
    }

    // 7) THE ROOF. The pad in the middle of the tile (see the ⚠ at the top), the lift head that
    //    brings a car up to it, and a condenser.
    helideck(ctx, cam, dx, dy, ROOF + 0.001, D.PAD_R, '214,236,255', '236,239,243', night, alpha, now, seed, yaw);
    box(0.30, -0.33, 0.085, 0.075, ROOF, ROOF + 0.085, CORE, true, 30);                        // the lift head
    pane('f', -0.33 + 0.075 + FACE_EPS, 0.235, 0.365, ROOF + 0.008, ROOF + 0.07, [64, 80, 92], [220, 236, 248], 1, 1.2);   // its door, facing the pad
    box(-0.30, -0.35, 0.05, 0.035, ROOF, ROOF + 0.03, 'ty_wh_metal', true, 31);                 // the condenser
    box(-0.02, -0.40, 0.012, 0.012, ROOF, ROOF + 0.11, STEEL, true, 32);                        // the windsock's post

    // 8) THE PYLON. A steel mast on the corner of the roof carrying a tilted deck, and the fourth
    //    car clamped to it nose-up over the junction, lit from under after dark.
    { const [mx, my] = D.MAST, top = D.MAST_TOP, nose = [-0.7071, 0.7071], pitch = 0.27;
      box(mx, my, 0.034, 0.034, ROOF, ROOF + 0.010, STEEL, true, 40);
      box(mx, my, 0.011, 0.011, ROOF + 0.010, top, STEEL, true, 41);
      // the deck: a plate along the car's length, tilted with it, and two stays back to the mast
      const hl = 0.115, hwd = 0.05, cp = Math.cos(pitch), sp = Math.sin(pitch), rx = -nose[1], ry = nose[0];
      const P = (f, g) => [mx + f * cp * nose[0] + g * rx, my + f * cp * nose[1] + g * ry, top + 0.004 + f * sp];
      const deck = [P(hl, -hwd), P(hl, hwd), P(-hl, hwd), P(-hl, -hwd)];
      flat(deck, [0, 0, 1], STEEL_RGB.map((v) => v * 0.8), null);
      flat(deck.map((p) => [p[0], p[1], p[2] - 0.004]), [0, 0, -1], STEEL_RGB.map((v) => v * 0.45), [150, 160, 178]);
      if (!SHAPE_SINK) for (const s of [-1, 1]) {
        emitWire(ctx, cam, W3(mx, my, top - 0.05), W3(...P(hl * 0.8 * s, 0)), 1.6, 'rgba(150,162,174,0.95)', alpha, { pull: 0.02 });
      }
      displayCar(ctx, cam, W3, dealerPylonCar(), mx, my, top + 0.006, nose, pitch, alpha, dn, 0.98);
      if (night) { const [gx, gy] = F(mx, my); glowPool(ctx, cam, gx, gy, top + 0.03, '214,232,255', 14, alpha * 0.5 * dn, { air: true }); }
    }

    // 9) THE OTHER STREET SIDE past the glass: the workshop's roller door in the core and a charge
    //    cabinet beside it with its lamp.
    { const xF = XW - FACE_EPS;
      pane('w', xF, -0.41, -0.25, FLOOR, 0.17, [92, 98, 106], null, 1, 1.2);
      if (!SHAPE_SINK && nearOrMesh()) for (let k = 1; k < 8; k++) {
        const z = FLOOR + (0.17 - FLOOR) * k / 8;
        emitWire(ctx, cam, W3(XW - 0.002, -0.41, z), W3(XW - 0.002, -0.25, z), 1, 'rgba(48,52,58,0.9)', alpha, { pull: 0.02 });
      }
      box(XW - 0.014, -0.225, 0.012, 0.018, 0, 0.085, 'ty_door', true, 50);
      pane('w', XW - 0.026 - FACE_EPS, -0.238, -0.212, 0.060, 0.066, [70, 150, 170], [120, 236, 255], 1, 1.4);
    }
    // 10) THE BACK: the lift shaft's door, a staff door with a lamp over it, and two high windows.
    { const yF = YB - FACE_EPS;
      pane('b', yF, 0.22, 0.38, FLOOR, 0.15, [70, 76, 84], null, 1, 1.2);
      pane('b', yF, -0.10, -0.045, FLOOR, 0.125, [56, 62, 70], null, 1, 1.2);
      for (const x of [-0.34, -0.22]) pane('b', yF, x - 0.045, x + 0.045, 0.20, 0.25, [52, 66, 76], [226, 238, 246], 1, 1.2);
      if (night) { const [gx, gy] = F(-0.072, YB - 0.02); glowPool(ctx, cam, gx, gy, 0.14, '236,244,255', 8, alpha * 0.4 * dn); }
    }
    // 11) THE PARTY WALL: three slit windows over the neighbour's roofline, lit from the room.
    for (const y of [-0.26, 0.0, 0.24]) pane('e', XE + FACE_EPS, y - 0.03, y + 0.03, 0.20, 0.27, [52, 66, 76], [226, 238, 246], 1, 1.2);
  },
};
