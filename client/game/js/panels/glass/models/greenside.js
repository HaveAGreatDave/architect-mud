// Greenside Row: Grounds for Concern, the corner café, and the car park beside it.
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// How a tile becomes a building is in docs/reference/world-rendering.md; the content is written by
// scripts/content/grounds-for-concern.mjs and described in docs/proposals/grounds-for-concern.md.
//
// `car_park` is a TYPE arm and carries nothing of Coldwater's: any walkable lot tile with
// `building_type: car_park` draws through it (the Codfather's staff lot points at it too).
// `groundscafe` is bound to the café by name in NAMED_MODELS, with `trade: 'coffee_shop'`.
import {
  DETAIL_LIFT, FACE_EPS, MESH_SINK, SHAPE_SINK, bakeSignText, clamp, draw3DBoxAt, drawFacetDrum,
  drawSmoke, emitFlat, emitSurfaceText, emitWire, faceYaw, glowPool, groundPaint, marqueeBand,
  nearOrMesh, reserveSignBand, rgb,
} from '../../windshield.js';
import { drawEntrance } from '../entrance.js';

// Newell's normal, turned to point along `out`, so a cull normal means what it says (twin-pass.js
// `tcFacing`, the same sum).
function facing(q, out) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * out[0] + ny * out[1] + nz * out[2] < 0 ? q.slice().reverse() : q;
}
// A face in the model's own frame, facing the local direction `out`. `lit` [r,g,b] is what it
// shows after dark (a window, a lamp); without it the face takes the dusk like any painted surface.
// ⚠ ADORNMENT: it never reaches the shape capture, so collision and shadows never see it.
function flat(ctx, cam, W3, pts, out, day, alpha, dn, lit) {
  if (SHAPE_SINK) return;
  if (!MESH_SINK && out[2] < -0.5 && (cam.EH || 0) > Math.max(...pts.map((p) => p[2]))) return;   // an underside, seen from above
  const O = W3(0, 0, 0), D = W3(out[0], out[1], out[2]);
  const ox = D[0] - O[0], oy = D[1] - O[1], oz = D[2] - O[2], ol = Math.hypot(ox, oy, oz) || 1;
  let c;
  if (lit) c = [0, 1, 2].map((i) => day[i] + (lit[i] - day[i]) * dn);
  else {
    const k = clamp(0.66 + 0.26 * oz / ol - 0.12 * (ox + oy) / ol, 0.34, 1.1) * (1 - 0.55 * dn);
    c = day.map((v) => v * k);
  }
  emitFlat(ctx, cam, facing(pts.map((p) => W3(p[0], p[1], p[2])), [ox, oy, oz]), rgb(c), alpha,
    { lift: DETAIL_LIFT, cullN: Math.abs(oz / ol) < 0.8 ? [ox, oy] : undefined });
}
// A drum's shading off a base colour: lit per facet, darkened with the night.
const drumSkin = (base, dusk) => (f) => { const s = (0.58 + f.nl * 0.46) * dusk; return rgb([base[0] * s, base[1] * s, base[2] * s]); };

// ── THE CUP ON THE ROOF ───────────────────────────────────────────────────────────────────────
// Glazed white on a saucer, a green band round it, and steam out of the top, because the roaster's
// flue comes up through its plinth. The cup is the café's sign: it says what the place sells from
// three streets away and from the air, before any lettering can be read. A handle on the street
// side, built of three bars so nothing hangs in the air.
const CUP = { saucerR: 0.140, rb: 0.082, rt: 0.114, plinthH: 0.030, saucerH: 0.016, bodyH: 0.160, band: [0.52, 0.68] };
function roofCup(ctx, cam, F, W3, cx, cy, z0, seed, night, alpha, now, E) {
  const dn = night ? clamp(night, 0, 1) : 0, dusk = 1 - 0.5 * dn;
  const [px, py] = F(cx, cy), yaw = faceYaw(E);
  const WHITE = [236, 232, 222], GREEN = [40, 92, 64], COFFEE = 'rgb(70,42,26)';
  // the plinth the flue runs into
  draw3DBoxAt(ctx, cam, px, py, 0.05, z0, z0 + CUP.plinthH, 'ty_gfc_green', seed + 80, night, alpha, true, yaw, 0.05);
  const zs = z0 + CUP.plinthH, zb = zs + CUP.saucerH, zt = zb + CUP.bodyH;
  drawFacetDrum(ctx, cam, px, py, zs, zb, CUP.saucerR, CUP.saucerR * 0.92, 16, alpha, drumSkin(WHITE, dusk), rgb(WHITE.map((v) => v * dusk)), 'ty_fuel_white');
  const za = zb + CUP.bodyH * CUP.band[0], zc = zb + CUP.bodyH * CUP.band[1];
  const rAt = (z) => CUP.rb + (CUP.rt - CUP.rb) * (z - zb) / CUP.bodyH;
  drawFacetDrum(ctx, cam, px, py, zb, za, CUP.rb, rAt(za), 16, alpha, drumSkin(WHITE, dusk), null, 'ty_fuel_white');
  drawFacetDrum(ctx, cam, px, py, za, zc, rAt(za), rAt(zc), 16, alpha, drumSkin(GREEN, dusk), null, 'ty_gfc_green');
  drawFacetDrum(ctx, cam, px, py, zc, zt, rAt(zc), CUP.rt, 16, alpha, drumSkin(WHITE, dusk), COFFEE, 'ty_fuel_white');
  // The handle, on the cup's street side: two arms out of the wall of the cup and an upright joining them.
  const hx = CUP.rt + 0.020, hz0 = zb + CUP.bodyH * 0.22, hz1 = zb + CUP.bodyH * 0.80, bar = 0.011;
  for (const z of [hz0, hz1 - bar * 2]) {
    const [ax, ay] = F(cx, cy + rAt(z) * 0.82 + (hx - rAt(z) * 0.82) / 2);
    draw3DBoxAt(ctx, cam, ax, ay, bar * 0.9, z, z + bar * 2, 'ty_fuel_white', seed + 81, night, alpha, true, yaw, (hx - rAt(z) * 0.82) / 2 + bar);
  }
  { const [ax, ay] = F(cx, cy + hx);
    draw3DBoxAt(ctx, cam, ax, ay, bar * 0.9, hz0, hz1, 'ty_fuel_white', seed + 82, night, alpha, true, yaw, bar); }
  drawSmoke(ctx, cam, px, py, zt + 0.004, '242,240,236', alpha * 0.62, now, seed + 83);
  // After dark two lamps on the plinth light it from below, so it still reads against the sky.
  if (night) {
    const [gx, gy] = F(cx, cy + CUP.rt * 1.1);
    glowPool(ctx, cam, gx, gy, zb + CUP.bodyH * 0.45, '255,236,200', 11, alpha * 0.5 * dn, { air: true });
  }
}

export const GREENSIDE_ARMS = {
  // ══ GROUNDS FOR CONCERN ═════════════════════════════════════════════════════════════════════
  // The brief is the facade prose (zone_district_906_908): a one-storey brick café on the corner of
  // Greenside Row and Meltwater Row, glazed along both streets under a green and cream striped
  // awning, two tables out front, a white cup on the roof that steams when they roast, and the car
  // park to the west. The frontage reads in order from the corner: the corner window, the door, the
  // big window with the tables under the awning, then the car park side with the roaster's flue.
  //
  // Local frame: +y is Greenside Row, +x is the door's right (the car park), −x the Meltwater Row
  // corner, −y the back on Voss Avenue. All four are streets or the lot, so all four are drawn.
  //
  // ⚠ THE BOX IS SET BACK FROM THE STREET, and so is everything on its front: the front wall is at
  // `WF`, not `fh`, which leaves the pavement in front of it for the tables. Anything mounted on the
  // front is measured from `WF`.
  groundscafe(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    const dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh();
    const YAW = faceYaw(E);
    const BRICK = pal || 'ty_gfc_brick', GREEN = 'ty_gfc_green', CREAM = 'ty_gfc_cream';
    const BX = fh * 0.92, WF = fh * 0.70, WB = -fh * 0.92;          // the box across, its front, its back
    const FD = (WF - WB) / 2, CY = (WF + WB) / 2;                    // half-depth and centre in local y
    const plinth = h * 0.06, wallTop = h * 1.00, cornice = h * 1.06, roofZ = h * 1.17;
    const sill = h * 0.13, glassTop = h * 0.64, clere0 = h * 0.68, clere1 = h * 0.78, fascia0 = h * 0.81;
    const box = (lx, ly, hw, z0, z1, p, s, roof, hd) => { const [x, y] = F(lx, ly); draw3DBoxAt(ctx, cam, x, y, hw, z0, z1, p, seed + s, night, alpha, roof, YAW, hd); };
    const GLASS_DAY = [62, 78, 76], GLASS_LIT = [255, 214, 158], CLERE_DAY = [92, 104, 98], CLERE_LIT = [255, 226, 180];

    // 1) THE SHELL: a dark plinth, red brick to the cornice, a cream cornice, and a brick parapet
    //    under a cream coping. One storey, so the silhouette is the parapet and the cup on it.
    box(0, CY, BX * 1.02, 0, plinth, 'ty_dw_slate', 1, false, FD * 1.02);
    box(0, CY, BX, plinth, wallTop, BRICK, 0, false, FD);
    box(0, CY, BX * 1.035, wallTop, cornice, CREAM, 2, false, FD * 1.035);
    box(0, CY, BX * 0.99, cornice, roofZ - h * 0.03, BRICK, 3, false, FD * 0.99);
    box(0, CY, BX * 1.01, roofZ - h * 0.03, roofZ, CREAM, 4, true, FD * 1.01);

    // 2) THE SHOPFRONT, Greenside Row. A green timber frame standing proud of the brick: a stallriser,
    //    the glass, a transom, a clerestory band lit from the café after dark, and the fascia over it
    //    all with the name. The door is left of the big window, near the corner.
    // ⚠ THE GLASS IS UNLIT FACES, NOT A PALETTE SLAB, the terminal's reason: after dark it is a lit room
    //    seen from outside and must hold its warm fill, which a palette slab would dim.
    const DX = -fh * 0.50, DW = fh * 0.085;                           // the door's centre and half-width
    const panes = [[-BX * 0.94, DX - DW - fh * 0.05], [DX + DW + fh * 0.05, BX * 0.94]];
    const yG = WF + fh * 0.012;
    box(0, WF + fh * 0.012, BX * 0.97, plinth, sill, GREEN, 10, true, fh * 0.014);                 // the stallriser
    box(0, WF + fh * 0.016, BX * 0.98, fascia0, wallTop, GREEN, 11, false, fh * 0.018);           // the fascia board
    for (const [a, b] of panes) {
      flat(ctx, cam, W3, [[a, yG + 0.002, glassTop], [b, yG + 0.002, glassTop], [b, yG + 0.002, sill], [a, yG + 0.002, sill]], [0, 1, 0], GLASS_DAY, alpha, dn, GLASS_LIT);
    }
    flat(ctx, cam, W3, [[-BX * 0.94, yG + 0.002, clere1], [BX * 0.94, yG + 0.002, clere1], [BX * 0.94, yG + 0.002, clere0], [-BX * 0.94, yG + 0.002, clere0]], [0, 1, 0], CLERE_DAY, alpha, dn, CLERE_LIT);
    // The frame: a transom bar, a head under the fascia, and mullions splitting the big window in three.
    box(0, WF + fh * 0.022, BX * 0.95, glassTop, clere0, GREEN, 12, true, fh * 0.012);
    box(0, WF + fh * 0.022, BX * 0.95, clere1, fascia0, GREEN, 13, true, fh * 0.012);
    { const [a, b] = panes[1];
      for (const t of [0, 1 / 3, 2 / 3, 1]) box(a + (b - a) * t, WF + fh * 0.024, fh * 0.012, sill, fascia0, GREEN, 14, false, fh * 0.012); }
    for (const x of [panes[0][0], panes[0][1]]) box(x, WF + fh * 0.024, fh * 0.012, sill, fascia0, GREEN, 15, false, fh * 0.012);
    // Inside, after dark: pendant lamps over the tables, and the counter's light along the back.
    if (night) {
      for (const t of [0.2, 0.5, 0.8]) {
        const [gx, gy] = F(panes[1][0] + (panes[1][1] - panes[1][0]) * t, WF - fh * 0.12);
        glowPool(ctx, cam, gx, gy, glassTop * 0.92, '255,206,140', 8, alpha * 0.45 * dn);
      }
      const [wx, wy] = F(0, WF + fh * 0.12);
      glowPool(ctx, cam, wx, wy, plinth + 0.004, '255,214,160', 18, alpha * 0.28 * dn);   // the pavement under the windows
    }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: DX, y: WF + fh * 0.012, w: DW, z0: plinth, top: glassTop, leaves: 1, frameW: fh * 0.014, depth: 0.006,
      frame: [40, 70, 54], lobby: { day: [96, 74, 56], night: [255, 214, 158] }, lamp: '255,214,160', mat: true, frontVis });

    // 3) THE NAME on the fascia, in the tile's own words with the trade under it (`tradeSub`), so the
    //    engine file carries no Coldwater name. The band is measured from the box's centre, because
    //    the front wall is `WF` and `marqueeBand`'s half-width is also its stand-off.
    const SGN = fh * 0.46, sgnZ = (fascia0 + wallTop) / 2, sgnRoom = { floor: fascia0, wallTop, wall: SGN };
    reserveSignBand(SGN, sgnZ, sgnRoom);   // nothing the kit hangs may cross the name
    if (frontVis) { const [nx, ny] = F(fh * 0.20, WF + fh * 0.03 - SGN); marqueeBand(ctx, cam, nx, ny, E, SGN, sgnZ, m.neon || '#ffd9a0', night, alpha, undefined, sgnRoom); }

    // 4) THE AWNING over the big window and the door: green and cream stripes sloping out from under
    //    the clerestory to a scalloped valance, on two folding arms. Paint and cloth, so adornment.
    {
      const a = DX - DW - fh * 0.02, b = BX * 0.95, yW = WF + fh * 0.03, yL = WF + fh * 0.21;
      const zW = clere0 - h * 0.005, zL = glassTop - h * 0.03, val = h * 0.04, n = 9;
      const STRIPE = [[46, 88, 62], [226, 214, 188]];
      for (let i = 0; i < n; i++) {
        const x0 = a + (b - a) * i / n, x1 = a + (b - a) * (i + 1) / n, c = STRIPE[i & 1];
        flat(ctx, cam, W3, [[x0, yW, zW], [x1, yW, zW], [x1, yL, zL], [x0, yL, zL]], [0, 0.6, 0.8], c, alpha, dn);       // the canvas
        flat(ctx, cam, W3, [[x0, yL, zL], [x1, yL, zL], [x1, yL, zL - val], [x0, yL, zL - val]], [0, 1, 0], c, alpha, dn);  // the valance
        flat(ctx, cam, W3, [[x0, yL, zL - val], [x1, yL, zL - val], [x1, yW, zW], [x0, yW, zW]], [0, -0.6, -0.8], c.map((v) => v * 0.7), alpha, dn);   // its underside
      }
      if (near) for (const x of [a + fh * 0.03, b - fh * 0.03]) {
        emitWire(ctx, cam, W3(x, yW, zW - h * 0.12), W3(x, yL, zL - val * 0.5), 1.3, 'rgba(40,46,44,0.95)', alpha, { pull: 0.02 });
      }
    }

    // 5) THE TABLES OUT FRONT: two bistro tables on the pavement under the awning, two chairs each.
    for (const [i, tx] of [[0, fh * 0.12], [1, fh * 0.58]]) {
      const [tX, tY] = F(tx, WF + fh * 0.17), r = fh * 0.05;
      drawFacetDrum(ctx, cam, tX, tY, 0, h * 0.20, r * 0.12, r * 0.12, 6, alpha, drumSkin([44, 46, 48], 1 - 0.5 * dn), null, 'ty_door');
      drawFacetDrum(ctx, cam, tX, tY, h * 0.20, h * 0.215, r, r, 12, alpha, drumSkin([214, 210, 200], 1 - 0.5 * dn), 'rgb(220,216,206)', 'ty_fuel_white');
      for (const s of [-1, 1]) box(tx + s * r * 1.9, WF + fh * 0.17, fh * 0.028, 0, h * 0.13, GREEN, 20 + i * 2 + (s > 0 ? 1 : 0), true, fh * 0.028);
    }
    // The chalk board by the door: four lines chalked on it and three of them struck through.
    { const bx = DX + DW + fh * 0.10, by = WF + fh * 0.13, bw = fh * 0.045, bz0 = h * 0.015, bz1 = h * 0.30;
      box(bx, by, bw, 0, bz1, 'ty_door', 30, true, fh * 0.010);
      if (near && frontVis) {
        const yb = by + fh * 0.010 + 0.0015;
        for (let k = 0; k < 4; k++) {
          const z = bz1 - (bz1 - bz0) * (0.22 + k * 0.19), l = bw * (0.55 + 0.25 * ((seed + k * 3) % 3) / 2);
          emitWire(ctx, cam, W3(bx - bw * 0.7, yb, z), W3(bx - bw * 0.7 + l * 1.4, yb, z), 1.1, 'rgba(232,230,220,0.9)', alpha, { pull: 0.02 });
          if (k < 3) emitWire(ctx, cam, W3(bx - bw * 0.8, yb + 0.0005, z + h * 0.012), W3(bx + bw * 0.75, yb + 0.0005, z - h * 0.010), 1.1, 'rgba(232,230,220,0.75)', alpha, { pull: 0.02 });
        }
      } }

    // 6) THE CORNER: the window turns onto Meltwater Row, so the café reads as glass from the junction,
    //    and a bench stands under it. The back half of the flank is the roastery: brick, one high window.
    {
      const xF = -BX - fh * 0.012, y0 = WF - fh * 0.10, y1 = -fh * 0.25, near1 = WF - fh * 0.02;
      box(-BX - fh * 0.012, (near1 + y1) / 2, fh * 0.014, plinth, sill, GREEN, 40, true, (near1 - y1) / 2);
      box(-BX - fh * 0.016, (near1 + y1) / 2, fh * 0.018, fascia0, wallTop, GREEN, 41, false, (near1 - y1) / 2);
      flat(ctx, cam, W3, [[xF - 0.002, y0, glassTop], [xF - 0.002, y1, glassTop], [xF - 0.002, y1, sill], [xF - 0.002, y0, sill]], [-1, 0, 0], GLASS_DAY, alpha, dn, GLASS_LIT);
      flat(ctx, cam, W3, [[xF - 0.002, near1, clere1], [xF - 0.002, y1, clere1], [xF - 0.002, y1, clere0], [xF - 0.002, near1, clere0]], [-1, 0, 0], CLERE_DAY, alpha, dn, CLERE_LIT);
      for (const t of [0, 0.5, 1]) box(-BX - fh * 0.022, y0 + (y1 - y0) * t, fh * 0.012, sill, fascia0, GREEN, 42, false, fh * 0.012);
      box(-BX - fh * 0.022, (near1 + y1) / 2, fh * 0.012, glassTop, clere0, GREEN, 43, true, (near1 - y1) / 2);
      box(-BX - fh * 0.11, (y0 + y1) / 2, fh * 0.035, 0, h * 0.11, 'ty_dw_timber', 44, true, (y0 - y1) * 0.32);   // the bench
      flat(ctx, cam, W3, [[xF, -fh * 0.52, h * 0.70], [xF, -fh * 0.74, h * 0.70], [xF, -fh * 0.74, h * 0.52], [xF, -fh * 0.52, h * 0.52]], [-1, 0, 0], [70, 60, 50], alpha, dn, [236, 168, 96]);
      if (night) { const [gx, gy] = F(-BX - fh * 0.12, (y0 + y1) / 2); glowPool(ctx, cam, gx, gy, glassTop * 0.6, '255,210,150', 12, alpha * 0.35 * dn); }
    }

    // 7) THE CAR PARK SIDE: two windows into the café, and the roaster's flue. It comes out of the
    //    roastery low on the wall, climbs the brick on brackets, turns over the parapet and runs across
    //    the roof into the cup's plinth, which is why the cup steams.
    const CUPX = fh * 0.10, CUPY = -fh * 0.30;
    {
      const xF = BX + fh * 0.004;
      for (const yc of [WF - fh * 0.32, WF - fh * 0.70]) {
        box(BX + fh * 0.008, yc, fh * 0.010, sill - h * 0.01, glassTop + h * 0.02, GREEN, 50, true, fh * 0.11);
        flat(ctx, cam, W3, [[xF + fh * 0.012, yc + fh * 0.09, glassTop], [xF + fh * 0.012, yc - fh * 0.09, glassTop], [xF + fh * 0.012, yc - fh * 0.09, sill], [xF + fh * 0.012, yc + fh * 0.09, sill]], [1, 0, 0], GLASS_DAY, alpha, dn, GLASS_LIT);
      }
      const r = fh * 0.035, fx = BX + r + fh * 0.01, fz1 = roofZ + h * 0.10;
      const [qx, qy] = F(fx, CUPY);
      drawFacetDrum(ctx, cam, qx, qy, h * 0.30, fz1, r, r, 10, alpha, drumSkin([176, 182, 186], 1 - 0.5 * dn), null, 'ty_wh_metal');
      box(BX + fh * 0.02, CUPY, fh * 0.03, h * 0.24, h * 0.36, 'ty_wh_metal', 51, true, fh * 0.06);    // where it leaves the roastery
      // Across the roof, square duct on two stands, into the plinth.
      const runA = fx + r, runB = CUPX + 0.05, zd0 = fz1 - r * 2, zd1 = fz1;
      box((runA + runB) / 2, CUPY, (runA - runB) / 2, zd0, zd1, 'ty_wh_metal', 52, true, r);
      for (const t of [0.3, 0.75]) box(runB + (runA - runB) * t, CUPY, fh * 0.012, roofZ, zd0, 'ty_wh_metal', 53, false, fh * 0.012);
      if (near) for (const z of [h * 0.50, h * 0.78]) {
        emitWire(ctx, cam, W3(BX, CUPY - r, z), W3(fx, CUPY - r, z), 1.4, 'rgba(60,64,66,0.95)', alpha, { pull: 0.02 });
        emitWire(ctx, cam, W3(BX, CUPY + r, z), W3(fx, CUPY + r, z), 1.4, 'rgba(60,64,66,0.95)', alpha, { pull: 0.02 });
      }
    }
    roofCup(ctx, cam, F, W3, CUPX, CUPY, roofZ, seed, night, alpha, now, E);

    // 8) THE BACK on Voss Avenue: the roastery's steel door, a pallet of jute sacks waiting to go in,
    //    and two bins.
    {
      const yF = WB - fh * 0.004;
      flat(ctx, cam, W3, [[fh * 0.30, yF, plinth], [fh * 0.08, yF, plinth], [fh * 0.08, yF, h * 0.58], [fh * 0.30, yF, h * 0.58]], [0, -1, 0], [44, 66, 52], alpha, dn);
      if (night) emitWire(ctx, cam, W3(fh * 0.19, yF - 0.002, plinth + 0.003), W3(fh * 0.19, yF - 0.002, h * 0.56), 1.6, 'rgba(255,200,140,0.9)', alpha, { pull: 0.02, glow: 4, glowCss: 'rgb(255,200,140)' });
      box(fh * 0.62, WB - fh * 0.12, fh * 0.13, 0, h * 0.035, 'ty_pallet', 60, true, fh * 0.09);
      for (const [k, sx, sy, sz] of [[0, 0.54, -0.10, 0], [1, 0.70, -0.10, 0], [2, 0.62, -0.13, 1]]) {
        const z0 = h * 0.035 + sz * h * 0.085;
        box(fh * sx, WB - fh * 0.12 + fh * sy * 0.2, fh * 0.075, z0, z0 + h * 0.085, 'ty_sw_hide', 61 + k, true, fh * 0.06);
      }
      for (const bx of [-fh * 0.40, -fh * 0.60]) box(bx, WB - fh * 0.08, fh * 0.07, 0, h * 0.24, 'ty_helpings', 65, true, fh * 0.06);
    }
  },

  // ══ THE CAR PARK ════════════════════════════════════════════════════════════════════════════
  // A small lot on one tile: tarmac a shade darker than the road, five bays in white down the far
  // side with a concrete stop at the head of each, a footpath down the near side, kerbs, a lamp
  // column by the way in, a sign, and bollards across the back so it isn't a short cut. Three cars
  // in the bays. The way in is the entrance side (+y).
  //
  // ⚠ IN TILE UNITS, NOT fh AND h. A lot fills its tile and a car is a car whatever the tile rolled,
  //    so every measure here is a constant (about 18 m to the tile, street-life.js), and only the lamp
  //    column takes `h`.
  // ⚠ THE CARS ARE IN FIXED BAYS AND FIXED COLOURS. A car is mass and mass is captured once per type,
  //    so a seeded choice of bays would make the model seed-variant for the sake of a parking pattern.
  car_park(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    const dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh();
    const YAW = faceYaw(E);
    const box = (lx, ly, hw, z0, z1, p, s, roof, hd) => { const [x, y] = F(lx, ly); draw3DBoxAt(ctx, cam, x, y, hw, z0, z1, p, seed + s, night, alpha, roof, YAW, hd); };
    const paint = (x0, y0, x1, y1, z, fill, a = alpha) => groundPaint(ctx, cam, [F(x0, y0), F(x1, y0), F(x1, y1), F(x0, y1)], z, fill, a);
    const SLAB = 0.006, KERB = 0.016;
    // 1) The lot and its kerbs: both flanks and the back. The front is a dropped kerb onto the road.
    box(0, 0, 0.47, 0, SLAB, pal || 'ty_yard_tarmac', 0, true, 0.47);
    for (const s of [-1, 1]) box(s * 0.475, -0.02, 0.012, 0, KERB, 'ty_quay_deck', 1 + s, true, 0.46);
    box(0, -0.475, 0.46, 0, KERB, 'ty_quay_deck', 4, true, 0.012);
    // 2) The paint: bay lines down the +x side, a pale footpath strip down the −x side, and an
    //    arrow on the aisle pointing in.
    const z = SLAB + 0.0012, LINE = dn > 0.5 ? 'rgba(200,204,206,0.62)' : 'rgba(236,238,236,0.80)';
    const BAY = 0.14, Y0 = -0.36, X0 = 0.17, X1 = 0.455;
    for (let i = 0; i <= 5; i++) paint(X0, Y0 + i * BAY - 0.004, X1, Y0 + i * BAY + 0.004, z, LINE);
    paint(X0 - 0.004, Y0, X0 + 0.004, Y0 + 5 * BAY, z, 'rgba(236,238,236,0.35)');
    paint(-0.455, -0.45, -0.33, 0.47, z, dn > 0.5 ? 'rgba(110,112,112,0.7)' : 'rgba(156,158,154,0.75)');   // the footpath
    paint(-0.335, -0.45, -0.325, 0.47, z + 0.0003, LINE);
    paint(-0.035, 0.08, 0.035, 0.26, z, 'rgba(236,238,236,0.55)');        // the arrow's shaft…
    groundPaint(ctx, cam, [F(-0.08, 0.08), F(0.08, 0.08), F(0, -0.02)], z, 'rgba(236,238,236,0.55)', alpha);   // …and head
    // 3) The wheel stops, one at the head of each bay.
    for (let i = 0; i < 5; i++) box(0.425, Y0 + (i + 0.5) * BAY, 0.010, SLAB, SLAB + 0.008, 'ty_quay_deck', 10 + i, true, 0.045);
    // 4) Three cars, nose in to the stops.
    const CARS = [[0, 'ty_fuel_red'], [1, 'ty_crane_cab'], [3, 'ty_fuel_white']];
    for (const [i, paintPal] of CARS) {
      const cy = Y0 + (i + 0.5) * BAY, cx = 0.30;
      for (const wx of [-0.075, 0.075]) for (const wy of [-0.044, 0.044]) box(cx + wx, cy + wy, 0.018, SLAB, SLAB + 0.020, 'ty_door', 20 + i * 4, true, 0.007);
      box(cx, cy, 0.118, SLAB + 0.010, SLAB + 0.040, paintPal, 30 + i, true, 0.046);           // the body
      box(cx - 0.012, cy, 0.064, SLAB + 0.040, SLAB + 0.066, 'ty_yacht_glass', 40 + i, false, 0.039);   // the glasshouse
      box(cx - 0.012, cy, 0.060, SLAB + 0.066, SLAB + 0.069, paintPal, 50 + i, true, 0.037);    // the roof
    }
    // 5) The lamp column by the way in, and its pool on the tarmac after dark.
    { const [lx, ly] = F(-0.40, 0.40), top = h * 1.30;
      drawFacetDrum(ctx, cam, lx, ly, 0, top, 0.009, 0.007, 8, alpha, drumSkin([96, 104, 112], 1 - 0.5 * dn), null, 'ty_pier_steel');
      box(-0.36, 0.40, 0.045, top - 0.012, top, 'ty_pier_steel', 60, true, 0.016);
      glowPool(ctx, cam, ...F(-0.32, 0.40), top - 0.014, '255,224,176', 9, alpha * (night ? 0.7 : 0.1));
      if (night) glowPool(ctx, cam, ...F(-0.15, 0.25), SLAB + 0.003, '255,214,160', 26, alpha * 0.32 * dn); }
    // 6) The sign by the way in: a white P on blue and CUSTOMERS ONLY under it, on a post.
    { const sx = 0.40, sy = 0.43, sz0 = h * 0.42, sz1 = h * 0.66, sw = 0.034;
      box(sx, sy, 0.005, 0, sz0, 'ty_pier_steel', 70, true, 0.005);
      box(sx, sy, sw, sz0, sz1, 'ty_door', 71, true, 0.004);
      flat(ctx, cam, W3, [[sx - sw * 0.92, sy + 0.0045, sz1 - 0.003], [sx + sw * 0.92, sy + 0.0045, sz1 - 0.003], [sx + sw * 0.92, sy + 0.0045, sz0 + 0.003], [sx - sw * 0.92, sy + 0.0045, sz0 + 0.003]], [0, 1, 0], [34, 78, 156], alpha, dn, [60, 110, 200]);
      if (frontVis) {
        const tex = bakeSignText('P', '#ffffff', night ? 1 : 0, false, true, true, { font: 'condensed', sub: 'CUSTOMERS ONLY' });
        if (tex) {
          const q = [[-sw * 0.8, sz1 - 0.006], [sw * 0.8, sz1 - 0.006], [sw * 0.8, sz0 + 0.006], [-sw * 0.8, sz0 + 0.006]]
            .map(([u, zz]) => { const [wx, wy] = F(sx + u, sy + 0.0055); return cam.proj(wx, wy, zz); });
          if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.4);
        }
      } }
    // 7) Bollards across the back, so people can walk through to the far street and cars can't.
    for (const bx of [-0.28, -0.12, 0.04, 0.20, 0.36]) {
      const [px, py] = F(bx, -0.44);
      drawFacetDrum(ctx, cam, px, py, 0, h * 0.20, 0.011, 0.011, 8, alpha, drumSkin([58, 62, 66], 1 - 0.5 * dn), 'rgb(220,200,90)', 'ty_pier_steel');
    }
  },
};
