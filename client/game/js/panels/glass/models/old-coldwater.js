// Old Coldwater: building-model arms for the south-east slums and the old civic buildings.
// drawTypeModelArm (windshield.js) picks the arm and runs the shared prologue and detail pass; an
// arm draws only its own building. See docs/reference/world-rendering.md.
import {
  ADORN_NEAR, ADORN_TIER, DECO_LIFT, DECO_PULL, DETAIL_LIFT, FACE_EPS, LCK_ROOF_Z, SHAPE_SINK, SLUM_PULL,
  SLUM_RUST, SLUM_TIN, TARPS, TR, WALL_COL, awning, bakeSignText, blinkLight, clamp, draw3DBoxAt,
  drawBarrelRoof, drawFacetDrum, drawRing, drawSmoke, emitDecoFill, emitFlat, emitSurfaceText, emitWire,
  faceAway, faceYaw, frac, glowPool, hfChrome, hfGlass, litStyle, marqueeBand, nearOrMesh, neonBlade, rgb,
  roofClutter, slumCurtain, slumDrape, slumFaceVis, slumHole, slumOpening, slumRope, slumScrawl,
  slumSheet, TILE_REACH,
} from '../../windshield.js';
import { drawEntrance } from '../entrance.js';

// Lit flat faces for Ash Management.
// Newell's normal turned along `out` (the sum `emitFlat` uses): a polygon wound backwards is lit from behind.
function ashFacing(q, out) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * out[0] + ny * out[1] + nz * out[2] < 0 ? q.slice().reverse() : q;
}
// A face in the model's frame facing `out`, GPU-lit as `fam` from albedo `alb`.
// ⚠ A pale face carries its own dusk: the mass shader only dims faces darker than ~0.55 luminance.
function ashFlat(ctx, cam, W3, pts, out, alb, fam, alpha, dn) {
  if (SHAPE_SINK) return;
  const O = W3(0, 0, 0), D = W3(out[0], out[1], out[2]);
  const ox = D[0] - O[0], oy = D[1] - O[1], oz = D[2] - O[2], ol = Math.hypot(ox, oy, oz) || 1;
  const lum = (0.299 * alb[0] + 0.587 * alb[1] + 0.114 * alb[2]) / 255;
  const d = lum > 0.42 ? 1 - 0.55 * dn : 1, a = [alb[0] * d, alb[1] * d, alb[2] * d];
  const k = clamp(0.64 + 0.28 * oz / ol - 0.14 * (ox + oy) / ol, 0.32, 1.12) * (1 - 0.55 * dn);
  emitFlat(ctx, cam, ashFacing(pts.map((p) => W3(p[0], p[1], p[2])), [ox, oy, oz]), rgb([a[0] * k, a[1] * k, a[2] * k]), alpha,
    { lit: fam, albedo: a, lift: DETAIL_LIFT, cullN: Math.abs(oz / ol) < 0.8 ? [ox, oy] : undefined });
}
// A window or an opening: unlit, so it holds `day` by day and `lit` after dark whatever the sun does.
function ashGlow(ctx, cam, W3, pts, out, day, lit, dn, alpha) {
  if (SHAPE_SINK) return;
  const O = W3(0, 0, 0), D = W3(out[0], out[1], out[2]);
  const ox = D[0] - O[0], oy = D[1] - O[1], oz = D[2] - O[2], ol = Math.hypot(ox, oy, oz) || 1;
  const c = [0, 1, 2].map((i) => day[i] + (lit[i] - day[i]) * dn);
  emitFlat(ctx, cam, ashFacing(pts.map((p) => W3(p[0], p[1], p[2])), [ox, oy, oz]), rgb(c), alpha,
    { lift: DETAIL_LIFT, cullN: Math.abs(oz / ol) < 0.8 ? [ox, oy] : undefined });
}
// An iron band round a drum, eye-facing half only. ⚠ Not `drawRing`: it pulls the back half out (`glself`).
function ashBand(ctx, cam, cx, cy, z, r, N, css, lw, alpha) {
  for (let i = 0; i < N; i++) {
    const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832;
    // faceAway: a kept building has to know when the arc turns (ARM_FACE).
    const away = (a) => { const nx = Math.cos(a), ny = Math.sin(a); return faceAway(cam, cx + nx * r, cy + ny * r, nx, ny); };
    if (away(a0) || away(a1)) continue;
    emitWire(ctx, cam, [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z], lw, css, alpha, { pull: 0.01 });
  }
}

// The pod both Outer Lock rooms are built as: a chrome housing (back slab, two cheeks, hood) so the
// room sits in a bay of the lock, and a round glass pod in it. `accent` is the room's light colour.
function lockPod(ctx, cam, dx, dy, fh, seed, night, alpha, E, F, accent) {
  // ⚠ The hood is as high as the arch allows at the back of the tile (~0.92 of LCK_ROOF_Z, less a hand).
  const R = LCK_ROOF_Z, zp = R * 0.04, zb = R * 0.08, zg = R * 0.58, zk = R * 0.64, zh = R * 0.72, zt = R * 0.78;
  const yaw = faceYaw(E);
  draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, zp, 'ty_hf_mirror_dk', seed, night, alpha, true, yaw, fh * 0.98);
  { const [bx, by] = F(0, -fh * 0.80);
    draw3DBoxAt(ctx, cam, bx, by, fh * 0.98, zp, zh, 'ty_hf_mirror', seed + 1, night, alpha, false, yaw, fh * 0.18); }
  for (const s of [-1, 1]) {
    const [cx, cy] = F(s * fh * 0.88, -fh * 0.02);
    draw3DBoxAt(ctx, cam, cx, cy, fh * 0.10, zp, zh, 'ty_hf_mirror', seed + 2, night, alpha, false, yaw, fh * 0.94);
  }
  { const [hx, hy] = F(0, -fh * 0.02);
    draw3DBoxAt(ctx, cam, hx, hy, fh * 1.0, zh, zt, 'ty_hf_mirror_dk', seed + 3, night, alpha, true, yaw, fh * 0.96); }
  // The prow sits forward so the back half of the drum is buried in the slab.
  const [px, py] = F(0, fh * 0.12);
  drawFacetDrum(ctx, cam, px, py, zp, zb, fh * 0.68, fh * 0.66, 14, alpha, hfChrome([84, 96, 110], [196, 210, 222], 2.0), null, 'ty_hf_chrome_dk');
  drawFacetDrum(ctx, cam, px, py, zb, zg, fh * 0.62, fh * 0.62, 14, alpha, hfGlass(night, [44, 78, 108]), null, 'ty_hf_glass');
  drawFacetDrum(ctx, cam, px, py, zg, zk, fh * 0.66, fh * 0.58, 14, alpha, hfChrome([112, 128, 144], [236, 244, 250], 2.2), hfChrome([120, 136, 150], [214, 226, 236], 1.4), 'ty_hf_chrome');
  // Light lines: adornment, so none of it reaches the capture.
  const line = 'rgb(' + accent + ')';
  drawRing(ctx, cam, px, py, zb + R * 0.006, fh * 0.635, 18, line, 1.4, alpha);
  drawRing(ctx, cam, px, py, zg - R * 0.006, fh * 0.635, 18, line, 1.0, alpha * 0.7);
  // ⚠ DECO_PULL, not emitWire's default lift, which pokes through the next building (glneighbour).
  for (const s of [-1, 1]) {
    const [ex, ey] = F(s * fh * 0.80, fh * 0.93);
    emitWire(ctx, cam, [ex, ey, zp + R * 0.02], [ex, ey, zh - R * 0.02], 1.4, line, alpha, { pull: DECO_PULL });
  }
  { const a = F(-fh * 0.96, fh * 0.95), b = F(fh * 0.96, fh * 0.95);
    emitWire(ctx, cam, [a[0], a[1], zh + R * 0.004], [b[0], b[1], zh + R * 0.004], 1.6, line, alpha, { pull: DECO_PULL }); }
  const [lx, ly] = F(0, fh * 0.80);
  glowPool(ctx, cam, lx, ly, R * 0.10, accent, 10, alpha * (night ? 0.45 : 0.18));
  if (night) glowPool(ctx, cam, px, py, R * 0.30, '226,240,255', 9, alpha * 0.32);
}

export const OLD_COLDWATER_ARMS = {
  // ── OLD COLDWATER (docs/proposals/old-coldwater.md) ──────────────────────
  // ⚠ Nothing here carries words, painted or lit (SLUM_DECLINE, UNSIGNED_TRADE).
  // ⚠ Every building is short of a piece, tarped with the `drawTentCamp` helpers. Mass is never
  // gated on camera or tier (the mesh is captured once and shared); painted detail is.
  ruin(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A collapsed terrace house. No `facade` tag, so no door.
    // ⚠ The read is the asymmetry: one half roofed, one open to the sky. A level box reads as a shed.
    const gable = h * 0.66, mid = h * 0.34, stack = h * 0.96;
    const hiX = -fh * 0.46, loX = fh * 0.46, HW = fh * 0.40, FD = fh * 0.80;
    { const [ax, ay] = F(hiX, 0); draw3DBoxAt(ctx, cam, ax, ay, HW, 0, gable, pal, seed, night, alpha, true, faceYaw(E), FD); }
    // ⚠ No roof flag on the open half: the missing lid is the missing roof.
    { const [bx, by] = F(loX, 0); draw3DBoxAt(ctx, cam, bx, by, HW, 0, mid, pal, seed + 9, night, alpha, false, faceYaw(E), FD); }
    // The teeth: wall stubs at three heights turn a level top edge into a collapse.
    for (let i = 0; i < 3; i++) {
      const tz = mid + h * (0.05 + frac(seed * 17 + i * 23) * 0.22);
      const [tx, ty] = F(loX + (i - 1) * HW * 0.62, (frac(seed * 29 + i * 11) - 0.5) * FD * 1.1);
      draw3DBoxAt(ctx, cam, tx, ty, HW * 0.26, mid, tz, 'ty_oc_brick_dk', seed + 30 + i, night, alpha, true, faceYaw(E), fh * 0.07);
    }
    // Joists over the open half. Near tier only: at range they're noise.
    if (ADORN_TIER >= ADORN_NEAR) for (let i = 0; i < 6; i++) {
      const jx = loX - HW * 0.84 + (i / 5) * HW * 1.68;
      emitWire(ctx, cam, W3(jx, -FD * 0.9, mid - h * 0.03), W3(jx, FD * 0.9, mid - h * 0.03), 2, 'rgb(38,32,26)', alpha, { lift: DECO_LIFT * 0.2 });
    }
    // The chimney stack on the party wall, taller than either half.
    { const [cx, cy] = F(0, -fh * 0.22); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.11, 0, stack, 'ty_oc_brick_dk', seed + 2, night, alpha, true); }
    // The rubble wall, then the spill over the lane.
    { const [bx, by] = F(0, fh * 0.92); draw3DBoxAt(ctx, cam, bx, by, fh * 0.86, 0, h * 0.10, 'ty_oc_brick_dk', seed + 3, night, alpha, true, faceYaw(E), fh * 0.08); }
    for (let i = 0; i < 3; i++) {
      const [sx, sy] = F((frac(seed * 7 + i * 13) - 0.5) * fh * 1.5, fh * (1.04 + frac(seed * 5 + i * 3) * 0.16));
      draw3DBoxAt(ctx, cam, sx, sy, fh * (0.10 + frac(seed + i * 9) * 0.07), 0, h * (0.04 + frac(seed + i * 5) * 0.05),
        'ty_oc_brick_dk', seed + 40 + i, night, alpha, true, faceYaw(E), fh * 0.09);
    }
    // Boarded (pale) and dead (black) openings. ⚠ Proud of the wall by FACE_EPS: a coplanar face
    // loses the depth tie and vanishes.
    if (frontVis) {
      const fy = FD + FACE_EPS;
      for (const [ox, z0, z1, boarded] of [
        [hiX - HW * 0.44, gable * 0.16, gable * 0.42, 1],
        [hiX + HW * 0.44, gable * 0.16, gable * 0.42, 1],
        [hiX - HW * 0.44, gable * 0.58, gable * 0.84, 1],
        [hiX + HW * 0.44, gable * 0.58, gable * 0.84, 0],
        [loX - HW * 0.40, mid * 0.26, mid * 0.74, 0],
      ]) {
        const w = HW * 0.26;
        emitDecoFill(ctx, cam, [W3(ox - w, fy, z1), W3(ox + w, fy, z1), W3(ox + w, fy, z0), W3(ox - w, fy, z0)],
          boarded ? 'rgba(74,62,46,0.96)' : 'rgba(16,14,13,0.97)', alpha, DECO_LIFT * 0.2, 'ruin|opening');
        if (!boarded || ADORN_TIER < ADORN_NEAR) continue;
        // Two planks, deliberately not level.
        for (const k of [0.32, 0.68]) {
          const zz = z0 + (z1 - z0) * k, tilt = (frac(seed * 13 + k * 97) - 0.5) * (z1 - z0) * 0.30;
          emitWire(ctx, cam, W3(ox - w * 1.14, fy + 0.002, zz - tilt), W3(ox + w * 1.14, fy + 0.002, zz + tilt),
            3, 'rgb(96,82,60)', alpha, { lift: DECO_LIFT * 0.2 });
        }
      }
    }
    // Paint, drawn here because the derived kit declines it for the slum (SLUM_DECLINE).
    // ⚠ No throw-ups (`bakeTagText`): a lettered word reads as a shop board. Use `slumScrawl`.
    const nightF = night ? clamp(night, 0, 1) : 0;
    // ⚠ Two pieces in the bare-brick gaps the boarding leaves. Rolled spots overlap into a smear.
    if (frontVis) {
      const fy = FD + FACE_EPS * 2;
      const P = (u, z, o) => [u, fy + o, z];
      const jit = (k) => frac(seed * 43 + k * 19) - 0.5;
      slumScrawl(ctx, cam, W3, P, hiX + jit(0) * HW * 0.2, gable * 0.5, HW * 0.5, gable * 0.027, seed * 3, nightF, alpha);
      slumScrawl(ctx, cam, W3, P, loX + HW * 0.43 + jit(1) * HW * 0.06, mid * (0.5 + jit(2) * 0.3), HW * 0.4, mid * 0.08, seed * 3 + 29, nightF, alpha);
    }
    // The back too: a ruin's front is `faceVec`'s default (south), so the lanes see the back.
    // ⚠ Don't give the tile an `entrance` to fix facing; the map audit then expects a door.
    if (slumFaceVis(cam, dx, dy, E, 0, -1, FD)) {
      const by = -FD - FACE_EPS * 2;
      const P = (u, z, o) => [u, by - o, z];
      slumOpening(ctx, cam, W3, P, hiX - HW * 0.44, gable * 0.29, HW * 0.26, gable * 0.13, 0, seed + 3, nightF, alpha);
      slumOpening(ctx, cam, W3, P, hiX + HW * 0.44, gable * 0.71, HW * 0.26, gable * 0.13, 1, seed + 4, nightF, alpha);
      slumOpening(ctx, cam, W3, P, loX + HW * 0.35, mid * 0.5, HW * 0.26, mid * 0.24, 1, seed + 5, nightF, alpha);
      slumScrawl(ctx, cam, W3, P, hiX + HW * 0.25, gable * 0.24, fh * 0.14, fh * 0.045, seed * 3 + 7, nightF, alpha);
      slumScrawl(ctx, cam, W3, P, loX - HW * 0.35, mid * 0.30, fh * 0.12, fh * 0.04, seed * 3 + 11, nightF, alpha);
    }
    // A tarp over the open half in the camp's colours, from the party wall down the outside wall.
    const ti = Math.floor(frac(seed * 61) * TARPS.length) % TARPS.length;
    const warm = nightF > 0.3 ? 0.55 : 0;
    {
      const x0 = hiX + HW + FACE_EPS * 2, x1 = loX + HW + FACE_EPS * 2;
      const yb = -FD * 0.92, yf = FD * (0.10 + frac(seed * 67) * 0.22);
      const zh = mid + h * 0.12, zf = mid + h * 0.015;
      slumDrape(ctx, cam, W3, [x0, yb, zh], [x0, yf, zh], [x1, yf, zf], [x1, yb, zf], h * 0.05,
        TARPS[ti], nightF, alpha, warm, TARPS[(ti + 2) % TARPS.length]);
      slumCurtain(ctx, cam, W3, [x1 + FACE_EPS, yb], [x1 + FACE_EPS, yf], zf, mid * 0.55, 4, TARPS[ti], seed, nightF, alpha, warm);
      slumRope(ctx, cam, W3, [x1, yf, zf], [x1 + fh * 0.10, yf + fh * 0.08, 0], alpha);
      slumRope(ctx, cam, W3, [x1, yb, zf], [x1 + fh * 0.10, yb - fh * 0.06, 0], alpha);
      // Lamp spill at the open end only (the camp's gable-mouth rule).
      if (warm) { const [gx, gy] = F(loX, yf + FD * 0.08); glowPool(ctx, cam, gx, gy, mid * 0.45, '255,186,104', 8, alpha * 0.34 * nightF); }
    }
    { const [px, py] = F(loX + HW * 0.35, -FD * 0.45); draw3DBoxAt(ctx, cam, px, py, fh * 0.018, 0, mid + h * 0.26, 'ty_oc_tin', seed + 50, night, alpha, true); }
    // Tin leaned over the old doorway: a sheet, since boxes can't slope.
    if (frontVis) {
      // Foot on the rubble's near edge: at lane level the tie-breaker pulled it through the spill.
      const x0 = loX + HW * 0.05, x1 = loX + HW * 0.62, top = mid * 0.72, fy = FD + FACE_EPS * 3;
      const ft = fy + fh * 0.07, fz = h * 0.03;
      slumSheet(ctx, cam, W3, [[x0, fy, top], [x1, fy, top], [x1, ft, fz], [x0, ft, fz]], SLUM_TIN, nightF, alpha, 0, 'tin');
      if (ADORN_TIER >= ADORN_NEAR) for (let i = 1; i < 4; i++) {
        const x = x0 + (x1 - x0) * i / 4;
        emitWire(ctx, cam, W3(x, fy + FACE_EPS, top), W3(x, ft + FACE_EPS, fz), 1, 'rgba(40,40,36,0.7)', alpha, { lift: DECO_LIFT * 0.1, pull: SLUM_PULL });
      }
    }
  },
  water_seller(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Mains Squeeze: a header tank on a trestle over a hut.
    const hutTop = h * 0.30, deck = h * 0.52, tankTop = h * 0.88;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.52, 0, hutTop, pal, seed, night, alpha, true);
    // Legs stand outside the hut, so it reads as a trestle and not a tank on a shed.
    for (let i = 0; i < 4; i++) {
      const [px, py] = F((i & 1) ? fh * 0.66 : -fh * 0.66, (i & 2) ? fh * 0.66 : -fh * 0.66);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, deck, 'ty_oc_board_dk', seed + 1 + i, night, alpha, false);
    }
    // `ty_oc_tank` is in PLATE_WALL for the laps and rivets; without them it reads as a silo.
    drawFacetDrum(ctx, cam, dx, dy, deck, tankTop, fh * 0.62, fh * 0.58, 11, alpha,
      (f) => 'rgb(' + (84 + f.nl * 46 | 0) + ',' + (88 + f.nl * 46 | 0) + ',' + (84 + f.nl * 42 | 0) + ')', 'rgb(62,66,62)', 'ty_oc_tank');
    drawRing(ctx, cam, dx, dy, deck + h * 0.08, fh * 0.625, 11, 'rgba(22,24,22,0.55)', 2, alpha);
    drawRing(ctx, cam, dx, dy, tankTop - h * 0.07, fh * 0.595, 11, 'rgba(22,24,22,0.55)', 2, alpha);
    { const [dpx, dpy] = F(fh * 0.34, fh * 0.40); draw3DBoxAt(ctx, cam, dpx, dpy, fh * 0.035, hutTop, deck, 'ty_oc_tank', seed + 6, night, alpha, false); }
    { const [qx, qy] = F(0, fh * 0.74); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.48, h * 0.13, h * 0.16, 'ty_oc_tank', seed + 7, night, alpha, true, faceYaw(E), fh * 0.03); }
    // Tin patches on the left flank, mass and a hair proud.
    { const [ax, ay] = F(-fh * 0.53, fh * 0.12); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.012, h * 0.03, h * 0.22, 'ty_oc_tin', seed + 8, night, alpha, true, faceYaw(E), fh * 0.20); }
    { const [bx, by] = F(-fh * 0.535, -fh * 0.24); draw3DBoxAt(ctx, cam, bx, by, fh * 0.012, h * 0.08, h * 0.26, 'ty_oc_tin', seed + 9, night, alpha, true, faceYaw(E), fh * 0.14); }
    const nightF = night ? clamp(night, 0, 1) : 0;
    const hw = fh * 0.52 + FACE_EPS * 2;
    // The hut's roof is a tarp, tied off to the trestle legs.
    slumSheet(ctx, cam, W3, [[-hw, -hw, hutTop + FACE_EPS], [hw * 0.55, -hw, hutTop + FACE_EPS], [hw * 0.55, hw, hutTop + FACE_EPS], [-hw, hw, hutTop + FACE_EPS]], TARPS[0], nightF, alpha);
    slumCurtain(ctx, cam, W3, [-hw, -hw], [hw * 0.55, -hw], hutTop, h * 0.16, 4, TARPS[0], seed, nightF, alpha);
    // Tied round the inner corner of each leg, never at its centre, which is inside the post.
    slumRope(ctx, cam, W3, [-hw, -hw, hutTop], [-fh * 0.60, -fh * 0.60, deck * 0.5], alpha);
    slumRope(ctx, cam, W3, [-hw, hw, hutTop], [-fh * 0.60, fh * 0.60, deck * 0.5], alpha);
    // A sheet over the queue, out to two sticks.
    for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.58, fh * 0.96); draw3DBoxAt(ctx, cam, px, py, fh * 0.015, 0, h * 0.19, 'ty_oc_board_dk', seed + 10, night, alpha, true); }
    slumDrape(ctx, cam, W3, [-fh * 0.62, hw, hutTop - h * 0.02], [fh * 0.62, hw, hutTop - h * 0.02],
      [fh * 0.62, fh * 0.96, h * 0.19], [-fh * 0.62, fh * 0.96, h * 0.19], h * 0.02, TARPS[3], nightF, alpha, 0, TARPS[1]);
    // Rust streaks, each point on the tank's own taper so they follow the plate. Near tier only.
    // ⚠ Not a square patch: it read as a board on a post.
    if (frontVis && ADORN_TIER >= ADORN_NEAR) {
      const rad = (z) => fh * (0.62 - 0.04 * (z - deck) / (tankTop - deck)) * Math.cos(Math.PI / 11) + FACE_EPS * 2;
      const on = (u, z) => [u, Math.sqrt(Math.max(0, rad(z) * rad(z) - u * u)), z];
      const zt = tankTop - h * 0.08;
      for (let i = 0; i < 3; i++) {
        const u = fh * (-0.22 + i * 0.19 + (frac(seed * 17 + i) - 0.5) * 0.06), w = fh * (0.022 + frac(seed * 5 + i) * 0.012);
        const zb = zt - (tankTop - deck) * (0.35 + frac(seed * 13 + i * 7) * 0.40);
        slumSheet(ctx, cam, W3, [on(u - w, zt), on(u + w, zt), on(u + w * 0.3, zb), on(u - w * 0.3, zb)], SLUM_RUST, nightF, alpha * 0.85, 0, null);
      }
    }
    if (slumFaceVis(cam, dx, dy, E, 1, 0, fh * 0.52)) {
      slumScrawl(ctx, cam, W3, (u, z, o) => [fh * 0.52 + FACE_EPS * 2 + o, u, z], fh * 0.10, h * 0.15, fh * 0.20, h * 0.03, seed + 11, nightF, alpha);
    }
    if (night) { const [gx, gy] = F(0, fh * 0.52); glowPool(ctx, cam, gx, gy, h * 0.24, '255,214,150', 7, alpha * 0.20); }
  },
  weigh_station(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // An unnamed weigh office (the void plazas). The Glacis Weigh is `glacis_booth`.
    // ⚠ The room only: the weighbridge plates are the next tile's `gate_lock` deck.
    const plinth = h * 0.16, sill = h * 0.30, eaves = LCK_ROOF_Z - 0.02;   // a constant, so the capture stays affine
    const edge = 0.5;   // the tile edge on the lane side, in tiles
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.46, 0, plinth, 'ty_stack_dk', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.44, plinth, eaves, 'ty_gantry', seed + 1, night, alpha, true);
    // The room carried out to the tile edge so no gap shows under the deck's roof.
    { const reach = edge - fh * 0.44, [bx, by] = F(0, fh * 0.44 + reach / 2);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.44, eaves - 0.12, LCK_ROOF_Z, 'ty_gantry', seed + 2, night, alpha, true, faceYaw(E), reach / 2 + FACE_EPS);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.44, 0, plinth, 'ty_stack_dk', seed + 3, night, alpha, false, faceYaw(E), reach / 2 + FACE_EPS); }
    { const [gx, gy] = F(0, fh * 0.44 + FACE_EPS);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.40, sill, eaves - 0.14, 'ty_lh_eye', seed + 4, night, alpha, false, faceYaw(E), fh * 0.02); }
    // Cyan: the lock's scanner colour.
    { const [lx, ly] = F(0, fh * 0.44 + FACE_EPS * 2);
      glowPool(ctx, cam, lx, ly, sill - h * 0.02, '120,244,255', 10, alpha * (night ? 0.45 : 0.22));
      glowPool(ctx, cam, lx, ly, eaves - h * 0.06, '120,244,255', 8, alpha * (night ? 0.35 : 0.15)); }
    if (night) { const [wx, wy] = F(0, fh * 0.30); glowPool(ctx, cam, wx, wy, sill + h * 0.2, '226,240,255', 9, alpha * 0.30); }
  },
  // ── THE TWO ROOMS INSIDE THE OUTER LOCK ───────────────────────────────────
  // Rooms under the lock hall's roof (deriveSurfaceCell, drawGateLockGL), bound by name.
  // ⚠ Every height is a share of LCK_ROOF_Z, never `h`: they must fit under the roof, and a
  // constant keeps the capture affine.
  glacis_booth(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE GLACIS WEIGH: THE WEIGHMASTER'S POD.
    lockPod(ctx, cam, dx, dy, fh, seed, night, alpha, E, F, '120,244,255');
    // A readout bar over the prow.
    const R = LCK_ROOF_Z, yaw = faceYaw(E);
    { const [rx, ry] = F(0, fh * 0.86);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.42, R * 0.655, R * 0.705, 'ty_hf_mirror_dk', seed + 7, night, alpha, true, yaw, fh * 0.05);
      const [gx, gy] = F(0, fh * 0.91 + FACE_EPS);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.36, R * 0.665, R * 0.695, 'ty_lh_eye', seed + 8, night, alpha, false, yaw, fh * 0.004); }
    // A fin on the hood so the pod reads from above.
    { const [fx, fy] = F(fh * 0.40, -fh * 0.45);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.03, R * 0.78, R * 0.88, 'ty_hf_mirror', seed + 9, night, alpha, true, yaw, fh * 0.34); }
    // The door sits off to the side so the window stays clear for the cabs.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: fh * 0.48, y: fh * 0.48, w: fh * 0.08, z0: R * 0.04, top: R * 0.15, leaves: 1,
      frame: [150, 164, 176], porch: { depth: fh * 0.14, half: fh * 0.13, top: R * 0.19, pal: 'ty_hf_mirror' },
      solid: { fill: [112, 124, 134], handle: [200, 206, 210] },
      lamp: '120,244,255', lampDay: 0.2, lampS: 5, spill: '120,244,255', mat: false, frontVis });
  },
  gate_post(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE GATE POST: THE POLICE WATCH POD.
    lockPod(ctx, cam, dx, dy, fh, seed, night, alpha, E, F, '90,150,255');
    // A watch cupola with the blue lamp on its lid.
    // ⚠ The lamp tops out under 0.97 of LCK_ROOF_Z; the arch here is about 1.12.
    const R = LCK_ROOF_Z, zt = R * 0.78, zc = R * 0.90;
    const [ux, uy] = F(0, -fh * 0.22);
    drawFacetDrum(ctx, cam, ux, uy, zt, zc, fh * 0.40, fh * 0.36, 12, alpha, hfGlass(night, [40, 66, 110]), null, 'ty_hf_glass');
    drawFacetDrum(ctx, cam, ux, uy, zc, zc + R * 0.04, fh * 0.44, fh * 0.30, 12, alpha, hfChrome([112, 128, 144], [236, 244, 250], 2.2), hfChrome([120, 136, 150], [214, 226, 236], 1.4), 'ty_hf_chrome');
    drawRing(ctx, cam, ux, uy, zt + R * 0.006, fh * 0.41, 16, 'rgb(90,150,255)', 1.2, alpha);
    draw3DBoxAt(ctx, cam, ux, uy, fh * 0.06, zc + R * 0.04, zc + R * 0.07, 'ty_cont_b', seed + 12, night, alpha, true, faceYaw(E), fh * 0.06);
    glowPool(ctx, cam, ux, uy, zc + R * 0.06, '90,150,255', 8, alpha * (night ? 0.5 : 0.25));
    if (night) glowPool(ctx, cam, ux, uy, zt + R * 0.08, '200,220,255', 7, alpha * 0.3);
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      y: fh * 0.64, w: fh * 0.10, z0: R * 0.04, top: R * 0.15, leaves: 1,
      frame: [150, 164, 176], porch: { depth: fh * 0.18, half: fh * 0.16, top: R * 0.19, pal: 'ty_hf_mirror' },
      lobby: { day: [56, 70, 86], night: [196, 214, 240] },
      plate: { side: -1, w: 0.012, hh: 0.02, z: R * 0.04 + 0.021, fill: [84, 80, 52], night: [50, 48, 34] },
      lamp: '90,150,255', lampDay: 0.3, lampS: 6, spill: '120,170,255', mat: false, frontVis });
  },
  vehicle_pound(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Long Stay: a fenced compound. `ty_bond_fence` is LATTICE_CUT
    // (alpha-tested holes), so the yard shows through the palisade.
    const fence = h * 0.62, boxTop = h * 0.50;
    // ⚠ Four slabs, never one box: a box has a lid, and a roofed compound is a warehouse.
    for (const [sx, sy, w, d] of [[0, 1, 0.92, 0.04], [0, -1, 0.92, 0.04], [1, 0, 0.04, 0.92], [-1, 0, 0.04, 0.92]]) {
      const [fx, fy] = F(sx * fh * 0.92, sy * fh * 0.92);
      draw3DBoxAt(ctx, cam, fx, fy, fh * w, 0, fence, 'ty_bond_fence', seed + 1 + sx * 2 + sy, night, alpha, false, faceYaw(E), fh * d);
    }
    // Trailer rows, lower than the fence and all one height.
    for (let i = 0; i < 4; i++) {
      const [rx, ry] = F((i - 1.5) * fh * 0.42, -fh * 0.16);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.16, 0, boxTop, 'ty_stack_dk', seed + 10 + i, night, alpha, true, faceYaw(E), fh * 0.58);
    }
    { const [gx, gy] = F(0, fh * 0.94 + FACE_EPS);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.34, 0, fence * 0.88, 'ty_gantry', seed + 20, night, alpha, false, faceYaw(E), fh * 0.03); }
    for (const s of [-1, 1]) {
      const [px, py] = F(s * fh * 0.38, fh * 0.94);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.06, 0, fence + h * 0.10, 'ty_gantry', seed + 22 + s, night, alpha, false);
    }
    // The gatehouse, small enough that the fence still dominates.
    { const [hx, hy] = F(fh * 0.56, fh * 0.60);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.24, 0, h * 0.38, 'ty_guard', seed + 30, night, alpha, true); }
    if (night) {
      { const [lx, ly] = F(-fh * 0.38, fh * 0.94); glowPool(ctx, cam, lx, ly, fence + h * 0.08, '255,238,198', 12, alpha * 0.34); }
      { const [hx, hy] = F(fh * 0.56, fh * 0.60); glowPool(ctx, cam, hx, hy, h * 0.28, '255,214,150', 5, alpha * 0.22); }
    }
  },
  flophouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Bed Rock: the only jettied building, each storey oversailing the one below.
    const ground = h * 0.26, s1 = h * 0.50, s2 = h * 0.72, eaves = h * 0.90;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.80, 0, ground, 'ty_oc_brick', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, ground, s1, pal, seed + 1, night, alpha, false);
    // ⚠ Lidded: the broken top storey no longer covers all of it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, s1, s2, pal, seed + 2, night, alpha, true);
    // The top storey stands on two-thirds of the plan; the left corner is gone.
    const brk = -fh * 0.25;   // the line the top floor broke along
    { const [ax, ay] = F((brk + fh * 0.97) / 2, 0); draw3DBoxAt(ctx, cam, ax, ay, (fh * 0.97 - brk) / 2, s2, eaves, pal, seed + 3, night, alpha, false, faceYaw(E), fh * 0.97); }
    // The fallen corner: a lidless stub and three teeth.
    { const [bx, by] = F((brk - fh * 0.97) / 2, 0); draw3DBoxAt(ctx, cam, bx, by, (fh * 0.97 + brk) / 2, s2, s2 + h * 0.04, pal, seed + 11, night, alpha, false, faceYaw(E), fh * 0.97); }
    for (let i = 0; i < 3; i++) {
      const [tx, ty] = F(-fh * (0.86 - i * 0.24), (i === 1 ? -1 : 1) * fh * 0.93);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.09, s2, s2 + h * (0.06 + frac(seed * 19 + i * 7) * 0.08), pal, seed + 12 + i, night, alpha, true, faceYaw(E), fh * 0.035);
    }
    // Shingle roof as two courses, the upper narrow and barely proud, to read as a sagging ridge.
    { const [rx, ry] = F((brk + fh * 0.97) / 2, 0);
      draw3DBoxAt(ctx, cam, rx, ry, (fh * 0.97 - brk) / 2, eaves, eaves + h * 0.07, 'ty_oc_shake', seed + 4, night, alpha, true, faceYaw(E), fh * 0.97);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.38, eaves + h * 0.07, eaves + h * 0.10, 'ty_oc_shake', seed + 5, night, alpha, true, faceYaw(E), fh * 0.60); }
    // The external stair as landings (no diagonals). The third is missing on purpose.
    for (let i = 0; i < 4; i++) {
      if (i === 2) continue;
      const [lx, ly] = F(fh * 0.90, fh * (0.40 - i * 0.26));
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.09, h * (0.10 + i * 0.20), h * (0.14 + i * 0.20), 'ty_oc_board_dk', seed + 6 + i, night, alpha, true, faceYaw(E), fh * 0.14);
    }
    { const [cx, cy] = F(-fh * 0.48, -fh * 0.40); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.09, s2, eaves + h * 0.26, 'ty_oc_brick_dk', seed + 10, night, alpha, true); }
    // Tin patches, mass and a hair proud.
    { const [px, py] = F(fh * 0.56, fh * 0.932); draw3DBoxAt(ctx, cam, px, py, fh * 0.15, s1 + h * 0.03, s1 + h * 0.15, 'ty_oc_tin', seed + 16, night, alpha, true, faceYaw(E), fh * 0.012); }
    { const [px, py] = F(-fh * 0.872, -fh * 0.18); draw3DBoxAt(ctx, cam, px, py, fh * 0.012, ground + h * 0.02, ground + h * 0.15, 'ty_oc_tin', seed + 17, night, alpha, true, faceYaw(E), fh * 0.17); }
    const nightF = night ? clamp(night, 0, 1) : 0;
    // The tarp over the front of the break; the back stays open to the sky.
    {
      const xh = brk - FACE_EPS * 2, xf = -fh * 0.97 - FACE_EPS * 2, yb = -fh * 0.28, yf = fh * 0.97 + FACE_EPS * 2;
      const zh = eaves - h * 0.04, zf = s2 + h * 0.07;
      slumDrape(ctx, cam, W3, [xh, yb, zh], [xh, yf, zh], [xf, yf, zf], [xf, yb, zf], h * 0.05, TARPS[0], nightF, alpha, 0, TARPS[4]);
      // ⚠ The fall stops short of the front corner, or the tie-breaker pulls it through the jetty below.
      slumCurtain(ctx, cam, W3, [xf - FACE_EPS, yb], [xf - FACE_EPS, fh * 0.30], zf, h * 0.16, 4, TARPS[0], seed, nightF, alpha);
      slumRope(ctx, cam, W3, [xf, yf, zf], [-fh * 0.86 - FACE_EPS, fh * 0.45, s1 - h * 0.05], alpha);
      slumRope(ctx, cam, W3, [xf, yb, zf], [-fh * 0.86 - FACE_EPS, yb, s1 - h * 0.05], alpha);
      // Leftover rafters over the open back.
      for (let i = 0; i < 3; i++) {
        const ry = -fh * (0.60 + i * 0.13);
        slumRope(ctx, cam, W3, [brk - FACE_EPS, ry, eaves], [brk - fh * (0.34 + frac(seed * 23 + i) * 0.30), ry, s2 + h * 0.08], alpha);
      }
    }
    // Openings rolled per tile on every storey; the door is a tarp over a hole.
    if (frontVis) {
      const rows = [[ground, s1, fh * 0.86, [-0.52, 0, 0.52]], [s1, s2, fh * 0.92, [-0.56, -0.04, 0.28]], [s2, eaves, fh * 0.97, [0.12, 0.62]]];
      rows.forEach(([z0, z1, y, xs], r) => xs.forEach((ux, i) => {
        const kind = Math.floor(frac(seed * 31 + r * 7 + i * 13) * 3);
        const P = (u, z, o) => [u, Math.min(y, 0.44) + FACE_EPS * 2 + o, z];
        slumOpening(ctx, cam, W3, P, fh * ux, (z0 + z1) / 2, fh * 0.09, (z1 - z0) * 0.26, kind, seed + r * 5 + i, nightF, alpha);
      }));
      const dy0 = Math.min(fh * 0.80, 0.44) + FACE_EPS * 2;
      slumOpening(ctx, cam, W3, (u, z, o) => [u, dy0 + o, z], -fh * 0.10, h * 0.095, fh * 0.13, h * 0.095, 1, seed, nightF, alpha);
      slumScrawl(ctx, cam, W3, (u, z, o) => [u, dy0 + o, z], fh * 0.42, h * 0.13, fh * 0.20, h * 0.03, seed + 7, nightF, alpha);
      slumCurtain(ctx, cam, W3, [-fh * 0.23, dy0 + FACE_EPS * 2], [fh * 0.03, dy0 + FACE_EPS * 2], h * 0.19, h * 0.19, 3, TARPS[2], seed + 3, nightF, alpha);
    }
    if (night) {
      // ⚠ Each glow just proud of its own storey: the storeys jetty out (0.86, 0.92, 0.97 fh).
      for (const [ly, z, a] of [[0.90, s1, 0.18], [0.96, s2, 0.13], [1.01, eaves, 0.09]]) {
        const [gx, gy] = F(0, fh * ly);
        glowPool(ctx, cam, gx, gy, z - h * 0.07, '255,206,132', 6, alpha * a);
      }
    }
  },
  soup_kitchen(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // No Such Thing: a long low hall with a canopy over the queue.
    const wallTop = h * 0.44, ridge = h * 0.56;
    // Deeper than wide: the long axis runs back from the lane.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.70, 0, wallTop, pal, seed, night, alpha, false, faceYaw(E), fh * 0.96);
    // Tin roof over the front two-thirds; the kitchen end is tarped, clear of the stack.
    const rb = -fh * 0.30;   // where the tin gives out
    { const [rx, ry] = F(0, (rb + fh * 1.00) / 2); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.76, wallTop, ridge, 'ty_oc_tin', seed + 1, night, alpha, true, faceYaw(E), (fh * 1.00 - rb) / 2); }
    { const [cx, cy] = F(fh * 0.40, -fh * 0.70); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.13, 0, ridge + h * 0.34, 'ty_oc_brick_dk', seed + 2, night, alpha, true); }
    // The queue canopy: half tin, half tarp.
    { const [ax, ay] = F(-fh * 0.30, fh * 1.00); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.42, h * 0.22, h * 0.25, 'ty_oc_tin', seed + 3, night, alpha, true, faceYaw(E), fh * 0.20); }
    for (const px of [-fh * 0.62, fh * 0.62]) {
      const [qx, qy] = F(px, fh * 1.14); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.035, 0, h * 0.22, 'ty_oc_board_dk', seed + 4, night, alpha, false);
    }
    // ⚠ No name board: nothing in the Shingles carries words.
    const nightF = night ? clamp(night, 0, 1) : 0;
    {
      const yh = rb - FACE_EPS * 2, yf = -fh * 1.00 - FACE_EPS * 2, xl = -fh * 0.78, xr = fh * 0.24;
      slumDrape(ctx, cam, W3, [xl, yh, ridge], [xr, yh, ridge], [xr, yf, wallTop + h * 0.01], [xl, yf, wallTop + h * 0.01],
        h * 0.04, TARPS[1], nightF, alpha, 0, TARPS[3]);
      slumCurtain(ctx, cam, W3, [xl, yf - FACE_EPS], [xr, yf - FACE_EPS], wallTop + h * 0.01, h * 0.15, 4, TARPS[1], seed, nightF, alpha);
      slumRope(ctx, cam, W3, [xl, yf, wallTop], [-fh * 0.70 - FACE_EPS, -fh * 0.80, h * 0.20], alpha);
      for (const rx of [fh * 0.60, fh * 0.68]) slumRope(ctx, cam, W3, [rx, rb, wallTop + h * 0.02], [rx, -fh * 0.94, wallTop - h * 0.02], alpha);
    }
    {
      const x0 = fh * 0.12, x1 = fh * 0.72, yw = fh * 0.97, yo = fh * 1.18;
      slumDrape(ctx, cam, W3, [x0, yw, h * 0.25], [x1, yw, h * 0.25], [x1, yo, h * 0.215], [x0, yo, h * 0.225], h * 0.02, TARPS[4], nightF, alpha);
      slumCurtain(ctx, cam, W3, [x0, yo + FACE_EPS], [x1, yo + FACE_EPS], h * 0.215, h * 0.05, 3, TARPS[4], seed + 1, nightF, alpha);
    }
    { const [px, py] = F(fh * 0.712, fh * 0.30); draw3DBoxAt(ctx, cam, px, py, fh * 0.012, h * 0.05, h * 0.30, 'ty_oc_tin', seed + 5, night, alpha, true, faceYaw(E), fh * 0.20); }
    if (slumFaceVis(cam, dx, dy, E, -1, 0, fh * 0.70)) {
      slumCurtain(ctx, cam, W3, [-fh * 0.70 - FACE_EPS * 2, -fh * 0.20], [-fh * 0.70 - FACE_EPS * 2, fh * 0.42], h * 0.37, h * 0.27, 3, TARPS[2], seed + 2, nightF, alpha);
    }
    if (frontVis) {
      const fy = fh * 0.96 + FACE_EPS * 2;
      const P = (u, z, o) => [u, fy + o, z];
      slumOpening(ctx, cam, W3, P, -fh * 0.34, h * 0.35, fh * 0.20, h * 0.05, 0, seed, nightF, alpha);
      slumOpening(ctx, cam, W3, P, fh * 0.22, h * 0.13, fh * 0.15, h * 0.04, 2, seed + 1, nightF, alpha);
      slumHole(ctx, cam, W3, P, fh * 0.40, h * 0.35, fh * 0.09, h * 0.045, 'rgb(78,62,50)', seed, alpha);
      slumScrawl(ctx, cam, W3, P, -fh * 0.40, h * 0.12, fh * 0.18, h * 0.03, seed + 5, nightF, alpha);
    }
    if (night) { const [gx, gy] = F(0, fh * 1.00); glowPool(ctx, cam, gx, gy, h * 0.20, '255,198,126', 9, alpha * 0.26); }   // the hall's face is 0.96
  },
  bonesetter(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A Stitch in Time: one room, one big window, the brightest thing
    // on Ropewalk after dark. No name anywhere.
    const wallTop = h * 0.34, ridge = h * 0.44;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.68, 0, wallTop, pal, seed, night, alpha, false);
    // Tin roof as two slabs in an L round the missing back corner.
    { const [ax, ay] = F(0, fh * 0.32); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.74, wallTop, ridge, 'ty_oc_tin', seed + 1, night, alpha, true, faceYaw(E), fh * 0.42); }
    { const [bx, by] = F(fh * 0.32, -fh * 0.42); draw3DBoxAt(ctx, cam, bx, by, fh * 0.42, wallTop, ridge, 'ty_oc_tin', seed + 7, night, alpha, true, faceYaw(E), fh * 0.32); }
    { const [wx, wy] = F(0, fh * 0.58); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.40, h * 0.12, h * 0.28, 'ty_oc_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.14); }
    // The lean-to over the bench: a tarp on two sticks, so only sticks and bench are mass.
    for (const px of [fh * 0.20, fh * 0.80]) { const [qx, qy] = F(px, fh * 1.00); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.03, 0, h * 0.22, 'ty_oc_board_dk', seed + 4, night, alpha, false); }
    { const [bx, byy] = F(fh * 0.50, fh * 0.88); draw3DBoxAt(ctx, cam, bx, byy, fh * 0.30, h * 0.07, h * 0.10, 'ty_oc_board_dk', seed + 5, night, alpha, true, faceYaw(E), fh * 0.07); }
    { const [fx2, fy2] = F(-fh * 0.40, -fh * 0.42); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.06, wallTop, ridge + h * 0.22, 'ty_oc_brick_dk', seed + 6, night, alpha, true); }
    { const [px, py] = F(fh * 0.692, -fh * 0.30); draw3DBoxAt(ctx, cam, px, py, fh * 0.012, h * 0.04, h * 0.24, 'ty_oc_tin', seed + 8, night, alpha, true, faceYaw(E), fh * 0.16); }
    // ⚠ The door is left of the window, never under the lean-to: the bench would block it.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: -fh * 0.54, y: fh * 0.68, w: fh * 0.10, top: h * 0.27, leaves: 1, frameW: fh * 0.012, depth: 0.006,
      frame: [92, 82, 70], solid: { fill: [104, 84, 64], planks: 4, handle: [70, 62, 54], crack: '255,214,150' }, mat: false, frontVis });
    const nightF = night ? clamp(night, 0, 1) : 0;
    {
      const xh = -fh * 0.10 - FACE_EPS * 2, xf = -fh * 0.74 - FACE_EPS * 2, y0 = -fh * 0.76, y1 = -fh * 0.10;
      slumDrape(ctx, cam, W3, [xh, y0, ridge], [xh, y1, ridge], [xf, y1, wallTop + h * 0.01], [xf, y0, wallTop + h * 0.01], h * 0.04, TARPS[0], nightF, alpha, 0, TARPS[2]);
      slumCurtain(ctx, cam, W3, [xf - FACE_EPS, y0], [xf - FACE_EPS, y1], wallTop + h * 0.01, h * 0.16, 3, TARPS[0], seed, nightF, alpha);
      slumRope(ctx, cam, W3, [xf, y0, wallTop], [-fh * 0.68 - FACE_EPS, y0 + fh * 0.1, h * 0.06], alpha);
    }
    slumDrape(ctx, cam, W3, [fh * 0.16, fh * 0.72 + FACE_EPS * 2, h * 0.30], [fh * 0.84, fh * 0.72 + FACE_EPS * 2, h * 0.30],
      [fh * 0.84, fh * 1.02, h * 0.215], [fh * 0.16, fh * 1.02, h * 0.215], h * 0.02, TARPS[1], nightF, alpha);
    if (slumFaceVis(cam, dx, dy, E, -1, 0, fh * 0.68)) {
      slumScrawl(ctx, cam, W3, (u, z, o) => [-fh * 0.68 - FACE_EPS * 2 - o, u, z], fh * 0.22, h * 0.13, fh * 0.18, h * 0.03, seed + 9, nightF, alpha);
    }
    // A taped pane. Near tier only.
    if (frontVis && ADORN_TIER >= ADORN_NEAR) {
      const ty = fh * 0.72 + FACE_EPS * 2, tape = 'rgba(214,206,176,0.85)';
      const [ax, bx, z0, z1] = [fh * 0.06, fh * 0.34, h * 0.14, h * 0.26];
      emitWire(ctx, cam, W3(ax, ty, z0), W3(bx, ty, z1), 2, tape, alpha, { lift: DECO_LIFT * 0.1, pull: SLUM_PULL });
      emitWire(ctx, cam, W3(ax, ty, z1), W3(bx, ty, z0), 2, tape, alpha, { lift: DECO_LIFT * 0.1, pull: SLUM_PULL });
    }
    if (night) { const [gx, gy] = F(0, fh * 0.72); glowPool(ctx, cam, gx, gy, h * 0.20, '255,236,196', 11, alpha * 0.38); }
  },
  shebeen(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Still Standing: half a room. A waist-high front wall and a tarp on
    // a frame; the low counter wall is the silhouette.
    const counter = h * 0.16, backTop = h * 0.46, ridge = h * 0.56;
    // The back room, roofed over two-thirds; the last third is a toothed wall open to the sky.
    const brk = fh * 0.30;   // where the back room broke
    { const [bx, byy] = F((brk - fh * 0.72) / 2, -fh * 0.34); draw3DBoxAt(ctx, cam, bx, byy, (brk + fh * 0.72) / 2, 0, backTop, pal, seed, night, alpha, false, faceYaw(E), fh * 0.50); }
    { const [bx, byy] = F((brk + fh * 0.72) / 2, -fh * 0.34); draw3DBoxAt(ctx, cam, bx, byy, (fh * 0.72 - brk) / 2, 0, h * 0.26, pal, seed + 6, night, alpha, false, faceYaw(E), fh * 0.50); }
    for (let i = 0; i < 3; i++) {
      const [tx, ty] = F(i < 2 ? fh * (0.42 + i * 0.20) : fh * 0.70, i < 2 ? -fh * 0.82 : -fh * 0.20);
      draw3DBoxAt(ctx, cam, tx, ty, i < 2 ? fh * 0.07 : fh * 0.025, h * 0.26, h * (0.30 + frac(seed * 29 + i * 5) * 0.09), pal, seed + 7 + i, night, alpha, true, faceYaw(E), i < 2 ? fh * 0.025 : fh * 0.08);
    }
    { const [rx, ry] = F((brk - fh * 0.78) / 2 + fh * 0.03, -fh * 0.34); draw3DBoxAt(ctx, cam, rx, ry, (brk + fh * 0.78) / 2 + fh * 0.03, backTop, ridge, 'ty_oc_tin', seed + 1, night, alpha, true, faceYaw(E), fh * 0.56); }
    { const [cx, cy] = F(0, fh * 0.56); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.76, 0, counter, 'ty_oc_board_dk', seed + 2, night, alpha, true, faceYaw(E), fh * 0.30); }
    // The tarp's frame posts; the sheet is draped below.
    for (const px of [-fh * 0.74, fh * 0.74]) {
      const [px2, py2] = F(px, fh * 0.86); draw3DBoxAt(ctx, cam, px2, py2, fh * 0.035, 0, h * 0.38, 'ty_oc_board_dk', seed + 4, night, alpha, false);
    }
    // The still's flue, in the broken corner.
    { const [fx2, fy2] = F(fh * 0.48, -fh * 0.70); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.05, h * 0.20, ridge + h * 0.28, 'ty_oc_tin', seed + 5, night, alpha, true); }
    const nightF = night ? clamp(night, 0, 1) : 0;
    // The counter bulb lights the tarp from underneath (the camp's lit-tent rule).
    const warm = nightF > 0.3 ? 0.5 : 0;
    {
      const yh = fh * 0.16 + FACE_EPS * 2, yf = fh * 0.90;
      slumDrape(ctx, cam, W3, [-fh * 0.82, yh, h * 0.44], [fh * 0.82, yh, h * 0.44], [fh * 0.82, yf, h * 0.37], [-fh * 0.82, yf, h * 0.37],
        h * 0.03, TARPS[3], nightF, alpha, warm, TARPS[0]);
      slumCurtain(ctx, cam, W3, [-fh * 0.82, yf + FACE_EPS], [fh * 0.82, yf + FACE_EPS], h * 0.37, h * 0.07, 6, TARPS[3], seed, nightF, alpha, warm);
      slumCurtain(ctx, cam, W3, [-fh * 0.80, yh], [-fh * 0.80, yf], h * 0.37, h * 0.24, 3, TARPS[2], seed + 4, nightF, alpha);
      slumRope(ctx, cam, W3, [fh * 0.82, yf, h * 0.37], [fh * 0.92, fh * 1.02, 0], alpha);
      slumRope(ctx, cam, W3, [-fh * 0.82, yf, h * 0.37], [-fh * 0.92, fh * 1.02, 0], alpha);
    }
    // A third tarp over the back room's broken corner.
    {
      const xh = brk + FACE_EPS * 2, xf = fh * 0.74 + FACE_EPS * 2, y0 = -fh * 0.86, y1 = fh * 0.14;
      slumDrape(ctx, cam, W3, [xh, y0, backTop - h * 0.03], [xh, y1, backTop - h * 0.03], [xf, y1, h * 0.29], [xf, y0, h * 0.29], h * 0.04, TARPS[1], nightF, alpha);
      slumCurtain(ctx, cam, W3, [xf + FACE_EPS, y0], [xf + FACE_EPS, y1], h * 0.29, h * 0.17, 4, TARPS[1], seed + 2, nightF, alpha);
    }
    if (frontVis) slumScrawl(ctx, cam, W3, (u, z, o) => [u, fh * 0.86 + FACE_EPS * 2 + o, z], fh * 0.30, h * 0.085, fh * 0.20, h * 0.025, seed + 3, nightF, alpha);
    if (night) {
      const [gx, gy] = F(0, fh * 0.40); glowPool(ctx, cam, gx, gy, h * 0.36, '255,224,160', 6, alpha * 0.20);
    }
  },
  taxidermist(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Stuff It: a canted shop window and a mount on the roof.
    const cill = h * 0.12, headHi = h * 0.46;
    const shopTop = h * 0.64, eaves = h * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, shopTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, shopTop, eaves, pal, seed + 1, night, alpha, true);
    // The cant as two steps, the head pane further out: stays affine where a rotation wouldn't.
    // ⚠ Everything sits proud of the shell's face at 0.88 fh, or the depth buffer hides it.
    // The kit's ground floor is declined for this trade (KIT_DECLINE).
    { const [lx, ly] = F(0, fh * 0.90); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.80, cill, h * 0.30, 'ty_stuff_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.04); }
    { const [ux, uy] = F(0, fh * 0.94); draw3DBoxAt(ctx, cam, ux, uy, fh * 0.84, h * 0.30, headHi, 'ty_stuff_glass', seed + 3, night, alpha, true, faceYaw(E), fh * 0.06); }   // lidded: it stands out past the sign ground above it, so its top shows
    // The sign ground: black render above the window head.
    { const [sx, sy] = F(0, fh * 0.91); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.90, headHi, h * 0.58, 'ty_stuff_dk', seed + 4, night, alpha, false, faceYaw(E), fh * 0.05); }
    // The roof mount: body and span, two boxes.
    { const [bx, by] = F(0, fh * 0.56); draw3DBoxAt(ctx, cam, bx, by, fh * 0.06, eaves, eaves + h * 0.16, 'ty_stuff_dk', seed + 5, night, alpha, false); }
    { const [wx, wy] = F(0, fh * 0.56); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.34, eaves + h * 0.09, eaves + h * 0.12, 'ty_stuff_dk', seed + 6, night, alpha, true, faceYaw(E), fh * 0.05); }
    { const [fx2, fy2] = F(fh * 0.40, -fh * 0.52); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.07, shopTop, eaves + h * 0.30, 'ty_stuff_dk', seed + 7, night, alpha, true); }
    // ⚠ A painted sign: `dn: 0`, never `night ? 1 : 0`, so it stays dark at night.
    if (frontVis) {
      const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
      const bz0 = headHi + h * 0.018, bz1 = h * 0.566, bhw = fh * 0.76, by = fh * 0.966;
      const TL = P(-bhw, by, bz1), TR = P(bhw, by, bz1), BR = P(bhw, by, bz0), BL = P(-bhw, by, bz0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'STUFF IT', '#efe3c6', 0, false);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      // The picture lights through the cant: the building's only light.
      const [gx, gy] = F(0, fh * 1.02); glowPool(ctx, cam, gx, gy, h * 0.26, '255,206,140', 8, alpha * 0.22);
    }
  },
  lending_library(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Fine Print: a top-lit reading room. At night the lantern down
    // the ridge is the whole read.
    const plinth = h * 0.10, cill = h * 0.52;
    const wallTop = h * 0.88, cornice = h * 0.98;
    const lantern = h * 1.12;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, 0, plinth, 'ty_fprint_stone', seed, night, alpha, false);
    // Blind to head height; `ty_fprint` is in STONE_WALL.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, plinth, wallTop, pal, seed + 1, night, alpha, false);
    // The high window band. ⚠ On the face (0.92 fh), or the wall buries it. `wall` is declined for this trade.
    { const [bx, by] = F(0, fh * 0.93); draw3DBoxAt(ctx, cam, bx, by, fh * 0.80, cill, h * 0.78, 'ty_fprint_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.03); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, wallTop, cornice, 'ty_fprint_stone', seed + 3, night, alpha, true);
    // The lantern down the ridge. ⚠ Non-square, so it needs faceYaw(E) or it's a diamond off-north.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.30, cornice, lantern, 'ty_fprint_glass', seed + 4, night, alpha, true, faceYaw(E), fh * 0.82);
    { const [cx2, cy2] = F(-fh * 0.62, -fh * 0.58); draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.10, wallTop, lantern + h * 0.14, 'ty_fprint_stone', seed + 5, night, alpha, true); }
    // The name is cut into the lintel: low, at the door head, stone-coloured. No neon.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.76, h * 0.40, m.neon || '#d8d2bc', night, alpha);
    // No door lamp: the building has no light at street level.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      y: fh * 0.92, w: fh * 0.15, z0: plinth, top: h * 0.37, leaves: 2,
      frame: [176, 168, 148], solid: { fill: [92, 64, 44], handle: [188, 160, 96], crack: '238,214,160' },
      stepOut: fh * 0.07, mat: false, frontVis });
    if (night) {
      // ⚠ The pool sits at the lantern on the ridge, never at the pavement.
      glowPool(ctx, cam, dx, dy, lantern, '238,230,196', 16, alpha * 0.40);
      const [wx, wy] = F(0, fh * 0.98); glowPool(ctx, cam, wx, wy, h * 0.64, '226,214,170', 7, alpha * 0.16);
    }
  },
  pool_hall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Pocket Money: a first-floor hall up an outside stair, over a dead
    // lock-up. A shutter below and a lit band above is the read.
    const lockTop = h * 0.40, hallTop = h * 0.88, hallPar = h * 0.96;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, lockTop, 'ty_pocket_shut', seed, night, alpha, false);
    // The hall oversails the lock-up a little.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, lockTop, hallTop, pal, seed + 1, night, alpha, false);
    // The clerestory: one band in SHOP_GLASS, so it's one opening, not floor plates.
    { const [gx, gy] = F(0, fh * 0.50); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.92, h * 0.66, h * 0.80, 'ty_pocket_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.50); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, hallTop, hallPar, pal, seed + 3, night, alpha, true);
    // The stair as stepped boxes on the local +x flank, so it lands right at every facing.
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = F(fh * 0.86, fh * (0.34 - i * 0.30));
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.12, 0, lockTop * (0.30 + i * 0.24), 'ty_pocket_stair', seed + 4 + i, night, alpha, true, faceYaw(E), fh * 0.15);
    }
    { const [lx, ly] = F(fh * 0.86, -fh * 0.60); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.16, lockTop * 0.96, lockTop, 'ty_pocket_stair', seed + 8, night, alpha, true, faceYaw(E), fh * 0.20); }
    // The door at the head of the stair, on the hall's flank (0.98 fh).
    { const [ox, oy] = F(fh * 0.99, -fh * 0.60); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.015, lockTop, lockTop + h * 0.22, 'ty_door', seed + 9, night, alpha, false, faceYaw(E), fh * 0.09); }
    if (frontVis) { const [nx, ny] = F(fh * 0.56, fh * 1.00); neonBlade(ctx, cam, nx, ny, h * 0.28, h * 0.74, m.neon || '#6effa8', night, alpha); }
    if (night) {
      // ⚠ Both pools sit outside the walls (inside, they light nothing). The main one is at the
      // clerestory, never the pavement; the stair gets one bulb.
      const [gx, gy] = F(0, fh * 1.04); glowPool(ctx, cam, gx, gy, h * 0.74, '186,255,206', 11, alpha * 0.30);
      const [bx, by] = F(fh * 1.04, -fh * 0.60); glowPool(ctx, cam, bx, by, lockTop + h * 0.24, '255,226,170', 5, alpha * 0.20);
    }
  },
  amusements(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Penny Drops: no front wall. Two piers, a lintel and the lit
    // back of the room in the gap.
    // ⚠ One storey, so the lintel sits near 1.0 h; see docs/reference/world-rendering.md#a-one-storey-arm-spends-its-height-near-10-h
    const shedTop = h * 0.98, lintel = h * 0.78, fascia = h * 1.16;
    // The shed is set back so the piers have depth to stand in.
    { const [bx, by] = F(0, -fh * 0.22); draw3DBoxAt(ctx, cam, bx, by, fh * 0.92, 0, shedTop, pal, seed, night, alpha, true, faceYaw(E), fh * 0.72); }
    // The lit back of the room, PLAIN_WALL. ⚠ On the shed's front (0.50 fh), or the shed hides it.
    { const [ix, iy] = F(0, fh * 0.52); draw3DBoxAt(ctx, cam, ix, iy, fh * 0.70, 0, lintel, 'ty_penny_lit', seed + 1, night, alpha, false, faceYaw(E), fh * 0.02); }
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.82, fh * 0.44); draw3DBoxAt(ctx, cam, px, py, fh * 0.16, 0, fascia, pal, seed + 2 + t, night, alpha, true, faceYaw(E), fh * 0.22); }
    { const [hx, hy] = F(0, fh * 0.44); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.98, lintel, fascia, pal, seed + 5, night, alpha, true, faceYaw(E), fh * 0.22); }
    // The rolled-up shutter under the lintel.
    { const [rx, ry] = F(0, fh * 0.50); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.78, lintel - h * 0.07, lintel, 'ty_pocket_shut', seed + 6, night, alpha, false, faceYaw(E), fh * 0.07); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.88, h * 0.98, m.neon || '#ffb03a', night, alpha);
    if (night) {
      // ⚠ This pool is on the pavement: an open front spills onto the road. The second is the room.
      const [ox, oy] = F(0, fh * 1.16); glowPool(ctx, cam, ox, oy, h * 0.06, '255,206,128', 18, alpha * 0.46);
      const [cx2, cy2] = F(0, fh * 0.58); glowPool(ctx, cam, cx2, cy2, h * 0.30, '198,150,255', 12, alpha * 0.34);
    }
  },
  fishmonger(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Codfather: a counter with a roof on it, and no glazing.
    // ⚠ One storey, so the envelope is spent near 1.0 h; see docs/reference/world-rendering.md#a-one-storey-arm-spends-its-height-near-10-h
    const shopTop = h * 0.96, codEaves = h * 1.15;
    // A blind tiled shell (TILE_WALL).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, shopTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, shopTop, codEaves, pal, seed + 1, night, alpha, true);
    // The marble slab, thick enough to read as a shelf from above.
    { const [sx, sy] = F(0, fh * 0.92); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.96, h * 0.20, h * 0.30, 'ty_cod_marble', seed + 2, night, alpha, true, faceYaw(E), fh * 0.28); }
    { const [ix, iy] = F(0, fh * 0.90); draw3DBoxAt(ctx, cam, ix, iy, fh * 0.86, h * 0.30, h * 0.34, 'ty_cod_ice', seed + 3, night, alpha, true, faceYaw(E), fh * 0.22); }
    // `awning`, not a box: a square footprint can't span the frontage without standing in the road.
    awning(ctx, cam, dx, dy, E, fh * 0.96, fh * 1.14, h * 0.63, h * 0.68, 'ty_cod_awn', seed + 4, night, alpha, fh * 0.36);
    // The name on the fascia, under the eaves and above the awning.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.84, h * 1.00, m.neon || '#8fd8ff', night, alpha);
    if (night) {
      // The ice stays lit after dark.
      const [gx, gy] = F(0, fh * 0.92); glowPool(ctx, cam, gx, gy, h * 0.34, '178,226,255', 7, alpha * 0.22);
    }
  },
  fishworks(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Codfather as a fish works, brief in zone_district_903_905.
    // Three storeys: a brick landing floor on a concrete plinth, two storeys of corrugated tin over a
    // concrete band, a strip of frosted glazing round each upper floor behind steel stanchions, and a
    // glazed lantern down the ridge. The quay end stacks a loading door on each upper floor under a
    // hooded hoist, over the roller door.
    // Local frame: +y car park (east, the staff door), +x quay (north), -x Batter Days, -y Slag & Wares.
    // ⚠ The Batter Days side is at TILE_REACH, never fh: each tile rolls its own fh, and the
    // `chippy` back wall meets it on the plot line.
    // ⚠ No sign; the registry row sets `noKit` so the kit adds none.
    // ⚠ The ground-floor parts (the doors, the lamp, the hose, the boxes) are in `S`, one storey, so
    // they stay at a person's height on a three-storey tile. The shell and the roof are in `h`.
    const YAW = faceYaw(E), NEAR = nearOrMesh(), dn = night ? clamp(night, 0, 1) : 0;
    const R = TILE_REACH, S = h / 3;
    const TIN_DK = 'ty_fw_tin_dk', CONC = 'ty_quay_deck', STEEL = 'ty_wh_metal';
    const plinth = S * 0.04, band = S * 1.06, wallTop = h * 0.92, eaves = h * 0.95, ridge = h * 1.00, lantern = h * 1.05, cap = h * 1.075;
    const XN = fh * 0.82, YE = fh * 0.80, YW = -fh * 0.84;       // the quay, car park and west faces
    const cx = (XN - R) * 0.5, hw = (XN + R) * 0.5, cy = (YE + YW) * 0.5, fd = (YE - YW) * 0.5;
    const B = (x, y, hx, hy, z0, z1, p, roof, s) => { const [bx, by] = F(x, y); draw3DBoxAt(ctx, cam, bx, by, hx, z0, z1, p, seed + s, night, alpha, roof, YAW, hy); };
    // A face on the plane y = at (`wall` 'y') or x = at ('x'), facing `s`, across u0..u1 and z0..z1.
    const quad = (wall, s, at, u0, u1, z0, z1) => wall === 'y'
      ? [[u0, at, z1], [u1, at, z1], [u1, at, z0], [u0, at, z0]] : [[at, u0, z1], [at, u1, z1], [at, u1, z0], [at, u0, z0]];
    // ⚠ The frost is darker than the tin by day. At the tin's own value it read as a curtain wall.
    const FROST = [104, 120, 128], LIT = [214, 232, 240], MULL = [44, 50, 54];
    // 1) THE SHELL: brick on the plinth, the band, tin to the eaves, a shallow roof and the lantern.
    B(cx, cy, hw + fh * 0.03, fd + fh * 0.04, 0, plinth, CONC, true, 1);
    B(cx, cy, hw, fd, plinth, S, 'ty_unit_brick', false, 5);
    B(cx, cy, hw + fh * 0.015, fd + fh * 0.015, S, band, CONC, true, 6);
    B(cx, cy, hw, fd, band, wallTop, pal, false, 0);
    B(cx, cy, hw + fh * 0.02, fd + fh * 0.05, wallTop, eaves, TIN_DK, true, 2);
    B(cx, cy, hw, fd * 0.62, eaves, ridge, TIN_DK, true, 3);
    B(cx - fh * 0.04, cy, hw * 0.86, fd * 0.20, ridge, lantern, 'ty_fw_frost', false, 4);
    B(cx - fh * 0.04, cy, hw * 0.88, fd * 0.27, lantern, cap, TIN_DK, true, 7);
    // 2) THE STANCHIONS: steel columns up the tin at the quay corners and between the bays, standing
    //    proud so the glazing runs behind them. The Batter Days end is hidden by the shop.
    for (const [i, y] of [[0, YE], [1, YW]]) {
      B(XN, y, fh * 0.03, fh * 0.03, band, wallTop, TIN_DK, false, 10 + i);
      for (const [j, t] of [[0, 1 / 3], [1, 2 / 3]]) B(-R + 2 * hw * t, y, fh * 0.025, fh * 0.025, band, wallTop, TIN_DK, false, 12 + i * 2 + j);
    }
    // 3) THE STRIP WINDOWS round both upper floors: frosted glass with a mullion every bay's width,
    //    a sill under it and a drip over it, on the car park and west faces and either side of the
    //    loading doors on the quay end. Frost by day, lit after dark.
    const strip = (wall, s, at, u0, u1, z0, z1, k) => {
      const out = wall === 'y' ? [0, s, 0] : [s, 0, 0];
      ashGlow(ctx, cam, W3, quad(wall, s, at + s * fh * 0.006, u0, u1, z0, z1), out, FROST, LIT, dn, alpha);
      const n = Math.max(1, Math.round((u1 - u0) / (fh * 0.22)));
      for (let i = 1; i < n; i++) {
        const u = u0 + (u1 - u0) * i / n;
        ashFlat(ctx, cam, W3, quad(wall, s, at + s * fh * 0.010, u - fh * 0.008, u + fh * 0.008, z0, z1), out, MULL, 'metal', alpha, dn);
      }
      const mid = (u0 + u1) * 0.5, half = (u1 - u0) * 0.5 + fh * 0.01;
      const ledge = (z0b, z1b, dep) => { const c = at + s * dep, [x, y] = wall === 'y' ? [mid, c] : [c, mid];
        const [hx, hy] = wall === 'y' ? [half, dep] : [dep, half]; B(x, y, hx, hy, z0b, z1b, TIN_DK, true, 100 + k); };
      ledge(z0 - S * 0.035, z0, fh * 0.016);
      ledge(z1, z1 + S * 0.03, fh * 0.012);
      if (night) for (const t of [0.25, 0.75]) {
        const u = u0 + (u1 - u0) * t, [gx, gy] = wall === 'y' ? F(u, at + s * fh * 0.05) : F(at + s * fh * 0.05, u);
        glowPool(ctx, cam, gx, gy, (z0 + z1) * 0.5, '226,240,248', 7, alpha * 0.30);
      }
    };
    for (const f of [1, 2]) {
      const z0 = f * S + S * 0.40, z1 = f * S + S * 0.66, k = f * 10;
      strip('y', 1, YE, -R + fh * 0.05, XN - fh * 0.05, z0, z1, k);
      strip('y', -1, YW, -R + fh * 0.05, XN - fh * 0.05, z0, z1, k + 1);
      strip('x', 1, XN, YW + fh * 0.08, -fh * 0.22, z0, z1, k + 2);
      strip('x', 1, XN, fh * 0.22, YE - fh * 0.08, z0, z1, k + 3);
    }
    // 4) THE ROOF PLANT: two condensers on the ridge beside the lantern, the cold main down the west
    //    wall, and the icemaker's vent.
    for (const [i, lx] of [[0, -fh * 0.10], [1, fh * 0.38]]) {
      const [px, py] = F(lx, -fh * 0.39);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.15, ridge, ridge + S * 0.20, 'ty_fw_plant', seed + 60 + i, night, alpha, true, YAW, fh * 0.12);
      drawFacetDrum(ctx, cam, px, py, ridge + S * 0.20, ridge + S * 0.23, fh * 0.10, fh * 0.10, 12, alpha,
        (f) => 'rgb(' + (40 + f.nl * 30 | 0) + ',' + (44 + f.nl * 30 | 0) + ',' + (48 + f.nl * 30 | 0) + ')', 'rgb(30,32,34)', 'ty_stack_dk');
    }
    { B(fh * 0.38, YW - fh * 0.03, fh * 0.03, fh * 0.03, plinth, ridge + S * 0.06, 'ty_stack_dk', false, 64);
      const [vx, vy] = F(-fh * 0.10, -fh * 0.39);
      drawSmoke(ctx, cam, vx, vy, ridge + S * 0.28, '226,236,240', alpha * 0.22, now, seed + 65); }
    // 5) THE QUAY END: the roller door, open, on the landing floor; a loading door on each floor over
    //    it, each with a guard bar and a steel lip to land a box on; and the hoist under its hood.
    const doorTop = S * 0.80, doorW = fh * 0.34;
    { const [ox, oy] = F(XN + fh * 0.012, 0);
      draw3DBoxAt(ctx, cam, ox, oy, fh * 0.012, plinth, doorTop, night ? 'ty_dw_lamp' : 'ty_stack_dk', seed + 20, night, alpha, false, YAW, doorW);
      B(XN + fh * 0.04, 0, fh * 0.04, doorW + fh * 0.03, doorTop, doorTop + S * 0.10, TIN_DK, true, 21);
      for (const s of [-1, 1]) B(XN + fh * 0.02, s * (doorW + fh * 0.02), fh * 0.02, fh * 0.02, plinth, doorTop, STEEL, false, 22 + s);
      const [gx, gy] = F(XN + fh * 0.16, 0);
      glowPool(ctx, cam, gx, gy, S * 0.30, '226,240,248', 11, alpha * (night ? 0.55 : 0.08));
      if (night) glowPool(ctx, cam, gx, gy, S * 0.01, '220,236,246', 16, alpha * 0.26); }
    for (const f of [1, 2]) {
      const z0 = f * S + S * 0.10, z1 = f * S + S * 0.82;
      B(XN + fh * 0.008, 0, fh * 0.008, fh * 0.15, z0 - S * 0.02, z1 + S * 0.03, TIN_DK, false, 40 + f * 3);
      B(XN + fh * 0.016, 0, fh * 0.008, fh * 0.13, z0, z1, 'ty_stack_dk', false, 41 + f * 3);
      B(XN + fh * 0.03, 0, fh * 0.006, fh * 0.13, z0 + S * 0.40, z0 + S * 0.44, STEEL, true, 42 + f * 3);
      B(XN + fh * 0.04, 0, fh * 0.04, fh * 0.15, z0 - S * 0.05, z0, STEEL, true, 49 + f);
    }
    { const beamZ = wallTop - S * 0.12;
      B(XN + fh * 0.20, 0, fh * 0.20, fh * 0.025, beamZ, beamZ + S * 0.06, STEEL, true, 24);
      B(XN + fh * 0.13, 0, fh * 0.13, fh * 0.16, beamZ + S * 0.08, wallTop + S * 0.02, TIN_DK, true, 25);
      if (NEAR) emitWire(ctx, cam, W3(XN + fh * 0.36, 0, beamZ), W3(XN + fh * 0.36, 0, 2 * S + S * 0.30), 1.2, 'rgba(40,40,42,0.95)', alpha, { pull: DECO_PULL }); }
    // 6) THE STAFF DOOR onto the car park, with its lamp, the hose reel and the fish boxes, and the
    //    one frosted window in the brick.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: fh * 0.36, y: YE, w: fh * 0.07, z0: plinth, top: S * 0.44, leaves: 1,
      frame: [88, 96, 100], lobby: { day: [58, 66, 70], night: [214, 232, 240] }, mat: false, frontVis });
    { const [lx, ly] = F(fh * 0.36, YE + fh * 0.03);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.035, S * 0.50, S * 0.54, 'ty_fw_frost', seed + 26, night, alpha, true, YAW, fh * 0.03);
      if (night) { glowPool(ctx, cam, lx, ly, S * 0.50, '236,244,248', 6, alpha * 0.6); glowPool(ctx, cam, lx, ly, S * 0.01, '230,240,246', 12, alpha * 0.22); } }
    { const [hx, hy] = F(fh * 0.58, YE + fh * 0.03);
      drawFacetDrum(ctx, cam, hx, hy, S * 0.30, S * 0.36, fh * 0.05, fh * 0.05, 10, alpha,
        (f) => 'rgb(' + (150 + f.nl * 60 | 0) + ',' + (40 + f.nl * 20 | 0) + ',' + (36 + f.nl * 20 | 0) + ')', 'rgb(90,30,28)', 'ty_cont_r'); }
    for (const [k, z0] of [[0, plinth], [1, plinth + S * 0.07]]) B(fh * 0.12, YE + fh * 0.08, fh * 0.09, fh * 0.06, z0, z0 + S * 0.065, 'ty_cont_b', true, 27 + k);
    { const [wx, wy] = F(-fh * 0.30, YE + fh * 0.01);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.30, S * 0.54, S * 0.70, night ? 'ty_dw_lamp' : 'ty_fw_frost', seed + 29, night, alpha, false, YAW, fh * 0.012);
      if (night) glowPool(ctx, cam, wx, wy, S * 0.62, '230,240,246', 7, alpha * 0.34); }
    // 7) THE WEST WALL: louvres in the brick and the downpipes from the eaves.
    B(-fh * 0.22, YW - fh * 0.01, fh * 0.20, fh * 0.012, S * 0.52, S * 0.74, TIN_DK, false, 66);
    for (const lx of [XN - fh * 0.10, -R + fh * 0.06]) B(lx, YW - fh * 0.02, fh * 0.018, fh * 0.018, plinth, wallTop, TIN_DK, false, 67);
    // 8) AFTER DARK the lantern shows along the ridge.
    if (night) for (const t of [-0.5, 0, 0.5]) {
      const [lx, ly] = F(cx - fh * 0.04 + t * hw, cy);
      glowPool(ctx, cam, lx, ly, (ridge + lantern) * 0.5, '226,240,248', 9, alpha * 0.28 * dn);
    }
  },
  fish_quay(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The fish quay behind the Codfather. Local frame: +y the works,
    // -y open water, ±x along the shore.
    // ⚠ The deck runs to TILE_REACH along the shore and to the works (as `fishworks`); the water edge is in fh.
    const YAW = faceYaw(E), NEAR = nearOrMesh(), dn = night ? clamp(night, 0, 1) : 0, dusk = 1 - 0.55 * dn;
    const R = TILE_REACH, DECK = h * 0.40, SKIRT = h * 0.32, EDGE = -fh * 1.0;
    const cy = (R + EDGE) * 0.5, fd = (R - EDGE) * 0.5;
    const tar = (f) => { const s = (0.45 + f.nl * 0.40) * dusk; return `rgb(${(70 * s) | 0},${(60 * s) | 0},${(48 * s) | 0})`; };
    for (const ly of [EDGE + fh * 0.06, cy, R - fh * 0.10]) for (const lx of [-R + fh * 0.08, 0, R - fh * 0.08]) {
      const [px, py] = F(lx, ly);
      drawFacetDrum(ctx, cam, px, py, -h * 0.30, SKIRT, fh * 0.05, fh * 0.05, 8, alpha, tar, 'rgb(40,36,30)', 'ty_pier_pile');
    }
    { const [kx, ky] = F(0, cy);
      draw3DBoxAt(ctx, cam, kx, ky, R, SKIRT, DECK, pal, seed, night, alpha, true, YAW, fd); }
    { const [kx, ky] = F(0, EDGE + fh * 0.03);
      draw3DBoxAt(ctx, cam, kx, ky, R, DECK, DECK + h * 0.04, 'ty_dw_timber', seed + 2, night, alpha, true, YAW, fh * 0.03); }
    if (NEAR) {
      for (let k = -5; k <= 5; k++) { const lx = k * R / 5.5;
        emitWire(ctx, cam, W3(lx, EDGE, DECK + 0.002), W3(lx, R, DECK + 0.002), 1, 'rgba(30,24,18,0.5)', alpha, { pull: FACE_EPS }); }
      for (const lx of [-0.75, -0.45, 0.15, 0.45]) {   // the tyres, two to a berth
        emitWire(ctx, cam, W3(lx * R, EDGE - 0.004, DECK), W3(lx * R, EDGE - 0.004, SKIRT - h * 0.08), 6, 'rgba(20,20,20,0.95)', alpha, { pull: DECO_PULL });
      }
    }
    for (const lx of [-0.60, 0.30]) {
      const [bx, by] = F(lx * R, EDGE + fh * 0.12);
      drawFacetDrum(ctx, cam, bx, by, DECK, DECK + h * 0.08, fh * 0.04, fh * 0.05, 10, alpha,
        (f) => { const s = (0.5 + f.nl * 0.45) * dusk; return `rgb(${(46 * s) | 0},${(48 * s) | 0},${(50 * s) | 0})`; }, 'rgb(28,28,30)', 'ty_stack_dk');
    }
    // The hand crane at the east end.
    { const px = R - fh * 0.22, py = EDGE + fh * 0.26, top = DECK + h * 0.70;
      const [cx, cy2] = F(px, py);
      drawFacetDrum(ctx, cam, cx, cy2, DECK, top, fh * 0.035, fh * 0.03, 8, alpha,
        (f) => { const s = (0.5 + f.nl * 0.45) * dusk; return `rgb(${(176 * s) | 0},${(140 * s) | 0},${(40 * s) | 0})`; }, 'rgb(90,72,24)', 'ty_cont_y');
      const [jx, jy] = F(px, py - fh * 0.24);
      draw3DBoxAt(ctx, cam, jx, jy, fh * 0.025, top - h * 0.05, top, 'ty_cont_y', seed + 8, night, alpha, true, YAW, fh * 0.26);
      if (NEAR) emitWire(ctx, cam, W3(px, py - fh * 0.48, top - h * 0.05), W3(px, py - fh * 0.48, DECK + h * 0.12), 1.1, 'rgba(36,36,38,0.95)', alpha, { pull: DECO_PULL }); }
    const BOX = ['ty_cont_b', 'ty_cont_b', 'ty_bd_orange', 'ty_cont_b'];
    for (let i = 0; i < 4; i++) {
      const [bx, by] = F(-R + fh * 0.30, R - fh * 0.30);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.10, DECK + i * h * 0.06, DECK + (i + 1) * h * 0.06 - h * 0.005, BOX[(i + (seed | 0)) % 4], seed + 20 + i, night, alpha, true, YAW, fh * 0.07);
    }
    { const [ix, iy] = F(R - fh * 0.34, R - fh * 0.26);
      draw3DBoxAt(ctx, cam, ix, iy, fh * 0.12, DECK, DECK + h * 0.14, 'ty_wh_metal', seed + 30, night, alpha, true, YAW, fh * 0.10); }
    { const [lx, ly] = F(-fh * 0.10, EDGE + fh * 0.10), top = DECK + h * 0.95;
      drawFacetDrum(ctx, cam, lx, ly, DECK, top, fh * 0.025, fh * 0.022, 6, alpha, tar, 'rgb(40,36,30)', 'ty_dw_timber');
      glowPool(ctx, cam, lx, ly, top, '255,214,150', 7, alpha * (night ? 0.85 : 0.08));
      if (night) glowPool(ctx, cam, lx, ly, DECK + 0.004, '255,200,130', 14, alpha * 0.24); }
  },
  cobbler(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Sole Survivor: the smallest building, a lean-to with a bench-height window.
    // ⚠ One storey, so eaves ~9 ft and ridge ~11; see docs/reference/world-rendering.md#a-one-storey-arm-spends-its-height-near-10-h
    const soleTop = h * 0.76, soleRidge = h * 0.92;
    // Offset to local +x: a lean-to leans on something; centred it's a hut in a yard.
    { const [bx, by] = F(fh * 0.30, 0); draw3DBoxAt(ctx, cam, bx, by, fh * 0.38, 0, soleTop, pal, seed, night, alpha, false, faceYaw(E), fh * 0.62); }
    { const [rx, ry] = F(fh * 0.30, 0); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.44, soleTop, soleRidge, 'ty_sole_dk', seed + 1, night, alpha, true, faceYaw(E), fh * 0.68); }
    { const [wx, wy] = F(fh * 0.30, fh * 0.62); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.28, h * 0.22, h * 0.46, 'ty_sole_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.05); }
    // The iron boot on its bracket: an arm and a body.
    { const [ax, ay] = F(fh * 0.30, fh * 0.60); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.14, h * 0.60, h * 0.64, 'ty_sole_dk', seed + 3, night, alpha, false, faceYaw(E), fh * 0.03); }
    { const [kx, ky] = F(fh * 0.30, fh * 0.70); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.07, h * 0.64, h * 0.86, 'ty_sole_dk', seed + 4, night, alpha, true, faceYaw(E), fh * 0.05); }
    if (night) {
      // The bench lamp: a small, low glow.
      const [gx, gy] = F(fh * 0.30, fh * 0.64); glowPool(ctx, cam, gx, gy, h * 0.17, '255,214,150', 5, alpha * 0.26);
    }
  },
  photographer(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Negative Equity: a studio whose whole north slope is glass.
    const shopTop = h * 0.50, ridge = h * 0.94;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, shopTop, pal, seed, night, alpha, false);
    // The slope as three glass steps (boxes can't tilt).
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      const [gx, gy] = F(0, fh * (0.46 - i * 0.30));
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.86, shopTop, shopTop + (ridge - shopTop) * (0.34 + t * 0.66), 'ty_negeq_glass', seed + 1 + i, night, alpha, true, faceYaw(E), fh * 0.16);
    }
    // The solid back wall makes the steps read as a slope.
    { const [bx, by] = F(0, -fh * 0.60); draw3DBoxAt(ctx, cam, bx, by, fh * 0.90, shopTop, ridge, pal, seed + 5, night, alpha, true, faceYaw(E), fh * 0.24); }
    { const [cx2, cy2] = F(-fh * 0.50, fh * 0.94); draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.20, h * 0.16, h * 0.38, 'ty_negeq_case', seed + 6, night, alpha, true, faceYaw(E), fh * 0.06); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.80, h * 0.44, m.neon || '#cfe0ff', night, alpha);
    // The door, with the darkroom's red safelight over it.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: fh * 0.02, y: fh * 0.92, w: fh * 0.10, top: h * 0.36, leaves: 1,
      frame: [64, 60, 58], lobby: { day: [34, 36, 40], night: [118, 34, 28] },
      lamp: '255,60,40', lampDay: 0, lampS: 6, spill: '255,90,70', frontVis });
    if (night) {
      // ⚠ The glow is on the roof slope (dim) and the display case (bright).
      const [gx, gy] = F(0, fh * 0.10); glowPool(ctx, cam, gx, gy, ridge * 0.92, '206,220,255', 9, alpha * 0.24);
      const [cx3, cy3] = F(-fh * 0.50, fh * 0.98); glowPool(ctx, cam, cx3, cy3, h * 0.28, '255,236,206', 6, alpha * 0.30);
    }
  },
  locksmith(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Skeleton Crew: one narrow bay and a key sign bigger than the building.
    const wallTop = h * 0.78, lockPar = h * 0.88;
    // ⚠ Deliberately a third of a tile wide: the narrowness is the building.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.32, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.38, wallTop, lockPar, 'ty_skel_dk', seed + 1, night, alpha, true);
    { const [wx, wy] = F(fh * 0.08, fh * 0.34); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.16, h * 0.18, h * 0.46, 'ty_skel_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.04); }
    // The key, drawn as a blade.
    if (frontVis) { const [nx, ny] = F(fh * 0.40, fh * 0.42); neonBlade(ctx, cam, nx, ny, h * 0.30, h * 1.22, m.neon || '#d8c88a', night, alpha); }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: -fh * 0.20, y: fh * 0.32, w: fh * 0.085, top: h * 0.36, leaves: 1, frameW: fh * 0.014,
      frame: [70, 66, 58], lobby: { day: [40, 38, 34], night: [236, 210, 150] }, frontVis });
    if (night) { const [gx, gy] = F(0, fh * 0.40); glowPool(ctx, cam, gx, gy, h * 0.30, '255,228,164', 5, alpha * 0.22); }
  },
  tattooist(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // No Regerts: a dark building with one lit vertical stair window.
    const unitTop = h * 0.44, wallTop = h * 0.92, inkPar = h * 1.00;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, unitTop, 'ty_pocket_shut', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, unitTop, wallTop, pal, seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, wallTop, inkPar, pal, seed + 2, night, alpha, true);
    // The stair window, one piece. ⚠ On the face (0.90 fh), or the wall buries it. `wall` is declined.
    { const [sx, sy] = F(fh * 0.62, fh * 0.92); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.13, h * 0.06, h * 0.86, 'ty_regerts_glass', seed + 3, night, alpha, false, faceYaw(E), fh * 0.03); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.70, h * 0.50, m.neon || '#ff5ac8', night, alpha);
    if (night) {
      // ⚠ The tall pool sits mid-strip, never at the pavement, so the light reads as vertical.
      const [sx, sy] = F(fh * 0.62, fh * 0.98); glowPool(ctx, cam, sx, sy, h * 0.46, '255,196,236', 8, alpha * 0.34);
      const [dx2, dy2] = F(-fh * 0.30, fh * 0.94); glowPool(ctx, cam, dx2, dy2, h * 0.14, '255,150,210', 4, alpha * 0.18);
    }
  },
  vet(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Paws for Thought: a house at house scale, with a bay window.
    const eaves = h * 0.56, apex = h * 0.80;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, eaves, pal, seed, night, alpha, false);
    // The pitched roof as two steps, plus a chimney.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.70, eaves, h * 0.70, 'ty_paws_roof', seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.44, h * 0.70, apex, 'ty_paws_roof', seed + 2, night, alpha, true);
    { const [cx4, cy4] = F(-fh * 0.48, -fh * 0.30); draw3DBoxAt(ctx, cam, cx4, cy4, fh * 0.11, eaves, apex + h * 0.16, pal, seed + 3, night, alpha, true); }
    // The bay stands proud of the wall: that says house, not shop.
    { const [bx, by] = F(-fh * 0.34, fh * 0.76); draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, h * 0.10, h * 0.42, 'ty_paws_glass', seed + 4, night, alpha, true, faceYaw(E), fh * 0.16); }
    awning(ctx, cam, dx, dy, E, fh * 0.30, fh * 0.94, h * 0.40, h * 0.44, 'ty_paws_roof', seed + 5, night, alpha, fh * 0.20);
    if (night) {
      // On the bay's glass (0.92 fh); inside the bay it lights nothing.
      const [gx, gy] = F(-fh * 0.34, fh * 0.96); glowPool(ctx, cam, gx, gy, h * 0.26, '255,220,168', 6, alpha * 0.30);
    }
  },
  off_licence(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Spirit Level: a shuttered front with one lit hatch.
    const wallTop = h * 0.72, offPar = h * 0.84;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, wallTop, offPar, 'ty_spirit_dk', seed + 1, night, alpha, true);
    // ⚠ Shutter, hatch and block sit on the face (0.90 fh), or the wall hides them.
    // The kit's `ground` and `wall` are declined for this trade.
    { const [sx, sy] = F(0, fh * 0.91); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.86, 0, h * 0.52, 'ty_pocket_shut', seed + 2, night, alpha, false, faceYaw(E), fh * 0.02); }
    { const [hx, hy] = F(fh * 0.14, fh * 0.94); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.15, h * 0.22, h * 0.36, 'ty_spirit_hatch', seed + 3, night, alpha, false, faceYaw(E), fh * 0.02); }
    { const [bx, by] = F(-fh * 0.36, fh * 0.94); draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, h * 0.30, h * 0.48, 'ty_spirit_block', seed + 4, night, alpha, false, faceYaw(E), fh * 0.02); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.78, h * 0.60, m.neon || '#ffd27a', night, alpha);
    if (night) {
      // ⚠ One tight pool at the hatch, never a lit shopfront.
      const [gx, gy] = F(fh * 0.14, fh * 1.00); glowPool(ctx, cam, gx, gy, h * 0.29, '255,226,158', 4, alpha * 0.38);
    }
  },
  museum(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Past Perfect: a four-column portico in front of a plain shed.
    const hallTop = h * 0.64, colTop = h * 0.74, ped = h * 0.92;
    { const [bx, by] = F(0, -fh * 0.26); draw3DBoxAt(ctx, cam, bx, by, fh * 0.80, 0, hallTop, pal, seed, night, alpha, true, faceYaw(E), fh * 0.64); }
    // The stylobate: without it the portico reads as a porch.
    { const [px, py] = F(0, fh * 0.62); draw3DBoxAt(ctx, cam, px, py, fh * 0.92, 0, h * 0.09, 'ty_past_stone', seed + 1, night, alpha, true, faceYaw(E), fh * 0.34); }
    for (const t of [-0.66, -0.22, 0.22, 0.66]) {
      const [cx5, cy5] = F(t * fh, fh * 0.70);
      draw3DBoxAt(ctx, cam, cx5, cy5, fh * 0.09, h * 0.09, colTop, 'ty_past_stone', seed + 3 + t * 10, night, alpha, false);
    }
    // Entablature and pediment as two narrowing steps.
    { const [ex, ey] = F(0, fh * 0.66); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.94, colTop, h * 0.83, 'ty_past_stone', seed + 8, night, alpha, false, faceYaw(E), fh * 0.30); }
    { const [fx2, fy2] = F(0, fh * 0.66); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.58, h * 0.83, ped, 'ty_past_stone', seed + 9, night, alpha, true, faceYaw(E), fh * 0.26); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.84, h * 0.78, m.neon || '#e2dcc4', night, alpha);
    // ⚠ The doors sit on the hall's face (0.38 fh); the glow sits outside the hall.
    { const [ox, oy] = F(0, fh * 0.39); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.12, h * 0.09, h * 0.52, 'ty_door', seed + 10, night, alpha, false, faceYaw(E), fh * 0.02); }
    if (night) {
      const [gx, gy] = F(0, fh * 0.46); glowPool(ctx, cam, gx, gy, h * 0.40, '244,226,170', 7, alpha * 0.20);
    }
  },
  concert_hall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Coldwater Recital Hall: a glass drum with a chrome fly tower set back
    // on it, the silhouette from the air.
    const hallTop = h * 0.66, flyTop = h * 1.24, frontTop = h * 0.52, lintel = h * 0.60;
    // The auditorium drum. `ty_sound_hall` is GLASS_WALL, so no tenement window grid.
    drawFacetDrum(ctx, cam, dx, dy, 0, hallTop, fh * 0.88, fh * 0.84, 20, alpha, hfGlass(night, [44, 66, 90]), null, 'ty_sound_hall');
    { const [tx, ty2] = F(0, -fh * 0.30);
      drawFacetDrum(ctx, cam, tx, ty2, hallTop, flyTop, fh * 0.50, fh * 0.46, 16, alpha, hfChrome([104, 118, 132], [222, 234, 242], 1.9), hfChrome([112, 126, 140], [196, 210, 220], 1.4), 'ty_sound_fly'); }
    // The front canopy with a drum at each end, so the plan reads as a lozenge.
    { const [fx, fy] = F(0, fh * 0.60); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.82, 0, frontTop, pal, seed + 2, night, alpha, true, faceYaw(E), fh * 0.30); }
    for (const t of [-1, 1]) { const [qx, qy] = F(t * fh * 0.82, fh * 0.60);
      drawFacetDrum(ctx, cam, qx, qy, 0, frontTop, fh * 0.30, fh * 0.30, 14, alpha, hfChrome([116, 132, 148], [230, 240, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_sound'); }
    // ⚠ The fascia stays a flat box: `emitSurfaceText` maps a planar quad, and on a curve the name shears.
    { const [lx, ly] = F(0, fh * 0.64); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.90, frontTop, lintel, pal, seed + 3, night, alpha, true, faceYaw(E), fh * 0.26); }
    // The podium: a drum straight off the gravel reads as a tank.
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.06, fh * 1.00, fh * 0.96, 20, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_sound');
    // The name is cut, not lit. ⚠ Needs all of `dn: 0, solid, tight`: without solid the ink goes
    // white, without dn 0 it's backlit, without tight it draws at half size.
    if (frontVis) {
      const P = (lx2, ly2, z) => { const [wx, wy] = F(lx2, ly2); return cam.proj(wx, wy, z); };
      const bz0 = frontTop + h * 0.012, bz1 = lintel - h * 0.012, bhw = fh * 0.84, by = fh * 0.94;
      const TL = P(-bhw, by, bz1), TR = P(bhw, by, bz1), BR = P(bhw, by, bz0), BL = P(-bhw, by, bz0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'COLDWATER RECITAL HALL', '#dfe8ee', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      // The fascia lamp and the foyer. ⚠ Warm on purpose in a cyan quarter: the hall predates the estate.
      const [nx, ny] = F(0, fh * 0.92); glowPool(ctx, cam, nx, ny, h * 0.20, '242,230,194', 9, alpha * 0.30);
      const [gx, gy] = F(0, fh * 0.74); glowPool(ctx, cam, gx, gy, h * 0.26, '255,226,168', 11, alpha * 0.26);
      glowPool(ctx, cam, dx, dy, hallTop - h * 0.08, '186,220,240', 10, alpha * 0.16);
    }
  },
  members_club(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // 6 Halcyon Boulevard: a members' club with no sign of any kind.
    const groundTop = h * 0.46, firstTop = h * 0.82, parTop = h * 0.90;
    // One chrome drum. `ty_vested` is PLAIN_WALL, so it draws no opening.
    drawFacetDrum(ctx, cam, dx, dy, 0, firstTop, fh * 0.88, fh * 0.84, 20, alpha, hfChrome([96, 108, 124], [206, 218, 232], 2.1), null, pal);
    // The coping step says house, not block, at range.
    drawFacetDrum(ctx, cam, dx, dy, firstTop, parTop, fh * 0.92, fh * 0.90, 20, alpha, hfChrome([106, 120, 136], [230, 240, 248], 1.8), hfChrome([112, 126, 142], [198, 212, 222], 1.4), 'ty_hf_chrome');
    // The portico. ⚠ The drum's face is ~0.86 fh at door height: columns, door and lamp must sit
    // on or outside it.
    for (const t of [-0.34, 0.34]) {
      const [cx3, cy3] = F(t * fh, fh * 0.95);
      drawFacetDrum(ctx, cam, cx3, cy3, h * 0.05, h * 0.34, fh * 0.07, fh * 0.065, 10, alpha, hfChrome([88, 102, 118], [232, 242, 248], 2.3), null, 'ty_hf_chrome');
    }
    { const [hx, hy] = F(0, fh * 0.80); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.46, h * 0.34, h * 0.40, 'ty_hf_chrome', seed + 5, night, alpha, true, faceYaw(E), fh * 0.20); }
    { const [sx3, sy3] = F(0, fh * 0.86);
      drawFacetDrum(ctx, cam, sx3, sy3, 0, h * 0.05, fh * 0.46, fh * 0.44, 16, alpha, hfChrome([116, 130, 146], [226, 238, 246], 1.8), hfChrome([124, 138, 154], [198, 212, 222], 1.4), 'ty_hf_deck'); }
    // The door: smoked glass, unlit.
    { const [dx4, dy4] = F(0, fh * 0.87); draw3DBoxAt(ctx, cam, dx4, dy4, fh * 0.13, h * 0.05, h * 0.30, 'ty_vested_dk', seed + 7, night, alpha, false, faceYaw(E), fh * 0.02); }
    // ⚠ One lamp. Never a `marqueeBand`, `neonBlade` or `bakeSignText` in this arm.
    if (night) { const [gx, gy] = F(0, fh * 0.92); glowPool(ctx, cam, gx, gy, h * 0.42, '255,202,122', 7, alpha * 0.34); }
  },
  auction_house(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // 8 Halcyon Boulevard: a saleroom lit from a clerestory, blind below.
    const wallTop = h * 0.70, clerTop = h * 0.86, ridge = h * 0.94;
    // A blind drum: `ty_going` is PLAIN_WALL, so no openings.
    drawFacetDrum(ctx, cam, dx, dy, 0, wallTop, fh * 0.94, fh * 0.90, 20, alpha, hfChrome([108, 122, 138], [216, 228, 238], 2.0), null, pal);
    // The clerestory, set in slightly so the band reads as glass.
    drawFacetDrum(ctx, cam, dx, dy, wallTop, clerTop, fh * 0.90, fh * 0.88, 20, alpha, hfGlass(night, [50, 76, 100]), null, 'ty_going_glass');
    drawFacetDrum(ctx, cam, dx, dy, clerTop, ridge, fh * 0.96, fh * 0.92, 20, alpha, hfChrome([116, 130, 146], [234, 244, 250], 1.8), hfChrome([124, 138, 154], [200, 214, 224], 1.4), 'ty_hf_chrome');
    // The goods door, the ordinary door and the apron sill.
    { const [gx5, gy5] = F(-fh * 0.28, fh * 0.92); draw3DBoxAt(ctx, cam, gx5, gy5, fh * 0.30, h * 0.02, h * 0.44, 'ty_door', seed + 3, night, alpha, false, faceYaw(E), fh * 0.03); }
    { const [px5, py5] = F(fh * 0.40, fh * 0.92); draw3DBoxAt(ctx, cam, px5, py5, fh * 0.10, 0, h * 0.26, 'ty_door', seed + 4, night, alpha, false, faceYaw(E), fh * 0.03); }
    { const [sx5, sy5] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, sx5, sy5, fh * 0.86, 0, h * 0.02, pal, seed + 5, night, alpha, true, faceYaw(E), fh * 0.05); }
    // The painted name (`dn: 0, solid, tight`). ⚠ A flat quad on a curved wall, deliberately (see `concert_hall`).
    if (frontVis) {
      const P = (lx6, ly6, z) => { const [wx, wy] = F(lx6, ly6); return cam.proj(wx, wy, z); };
      const z0 = h * 0.48, z1 = h * 0.64, bhw = fh * 0.78, by = fh * 0.96;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || '8 HALCYON BOULEVARD', '#dce6ee', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    roofClutter(ctx, cam, dx, dy, fh * 0.94, ridge, 'citycore', seed + 6, night, alpha, now);
    if (night) {
      // The pool sits at the band, never the pavement.
      const [lx7, ly7] = F(0, fh * 0.90); glowPool(ctx, cam, lx7, ly7, (wallTop + clerTop) * 0.5, '226,232,228', 8, alpha * 0.22);
    }
  },
  institute(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Halcyon Institute: a pale drum ringed by a giant order of chrome fins.
    const bodyTop = h * 0.78, entab = h * 0.88, ped = h * 1.00;
    drawFacetDrum(ctx, cam, dx, dy, h * 0.06, bodyTop, fh * 0.84, fh * 0.80, 24, alpha, hfChrome([132, 148, 164], [242, 248, 252], 1.7), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.06, fh * 0.96, fh * 0.92, 24, alpha, hfChrome([124, 140, 156], [232, 242, 248], 1.8), hfChrome([132, 148, 164], [206, 220, 230], 1.4), 'ty_course_dk');
    // Twelve fins round the drum. ⚠ Placed against the footprint, never the body's clamped half-width.
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.2832 + faceYaw(E), r = fh * 0.84;
      drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, h * 0.06, bodyTop, fh * 0.055, fh * 0.050, 8, alpha, hfChrome([116, 132, 148], [246, 250, 252], 2.0), null, 'ty_course_dk');
    }
    // The entablature ring and a shallow dome; a flat cap loses the classical read.
    drawFacetDrum(ctx, cam, dx, dy, bodyTop, entab, fh * 0.94, fh * 0.90, 24, alpha, hfChrome([120, 136, 152], [222, 234, 242], 1.9), null, 'ty_course_dk');
    drawFacetDrum(ctx, cam, dx, dy, entab, entab + (ped - entab) * 0.55, fh * 0.86, fh * 0.60, 24, alpha, hfChrome([130, 146, 162], [244, 250, 252], 1.7), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, entab + (ped - entab) * 0.55, ped, fh * 0.60, fh * 0.14, 24, alpha, hfChrome([130, 146, 162], [244, 250, 252], 1.7), hfChrome([136, 152, 168], [214, 228, 236], 1.4), pal);
    // The flat frieze plate (see `concert_hall`). ⚠ Proud of the drum: face at 0.95, rim at 0.94.
    { const [ex, ey] = F(0, fh * 0.83); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.76, bodyTop, entab, 'ty_course_dk', seed + 9, night, alpha, false, faceYaw(E), fh * 0.12); }
    if (frontVis) {
      const P = (lx10, ly10, z) => { const [wx, wy] = F(lx10, ly10); return cam.proj(wx, wy, z); };
      const z0 = bodyTop + h * 0.012, z1 = entab - h * 0.012, bhw = fh * 0.72, by = fh * 0.95;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'THE HALCYON INSTITUTE', '#efeadb', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    // ⚠ The doors stand in a porch: on the drum itself the leaves would cut into the facets.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      y: fh * 0.74, w: fh * 0.14, z0: h * 0.06, top: h * 0.06 + 0.12, leaves: 2,
      frame: [150, 164, 176], lobby: { day: [52, 62, 58], night: [176, 206, 166] },
      porch: { depth: fh * 0.18, half: fh * 0.24, top: h * 0.28, pal: 'ty_course_dk' },
      transom: { hh: 0.007, day: [70, 82, 78], night: [190, 214, 176] },
      plate: { side: 1, w: 0.012, hh: 0.008, z: h * 0.06 + 0.075, fill: [188, 158, 92], night: [120, 100, 60] },
      stepOut: fh * 0.05, frontVis });
    if (night) {
      const [gx11, gy11] = F(0, fh * 0.30); glowPool(ctx, cam, gx11, gy11, h * 0.44, '198,224,186', 6, alpha * 0.16);
    }
  },
  land_office(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Halcyon Land Office: a small glazed drum behind a hoarding twice its size.
    const officeTop = h * 0.40, boardZ0 = h * 0.16, boardZ1 = h * 0.94;
    drawFacetDrum(ctx, cam, dx, dy, 0, officeTop, fh * 0.62, fh * 0.58, 16, alpha, hfGlass(night, [56, 86, 112]), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, officeTop, officeTop + h * 0.03, fh * 0.66, fh * 0.62, 16, alpha, hfChrome([116, 132, 148], [230, 240, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    // Scaffold legs as drums, so a highlight travels round each one.
    for (const t of [-0.86, -0.30, 0.30, 0.86]) {
      const [lx12, ly12] = F(t * fh, fh * 0.94);
      drawFacetDrum(ctx, cam, lx12, ly12, 0, boardZ1, fh * 0.035, fh * 0.030, 8, alpha, hfChrome([84, 100, 116], [224, 236, 244], 2.3), null, 'ty_gantry');
    }
    // ⚠ The board stays flat: the lettering is a planar quad.
    { const [bx13, by13] = F(0, fh * 0.98); draw3DBoxAt(ctx, cam, bx13, by13, fh * 1.00, boardZ0, boardZ1, 'ty_plot_board', seed + 6, night, alpha, true, faceYaw(E), fh * 0.05); }
    // The board advertises the estate, with the office's name on a painted strap. No puns in Halcyon Fields.
    // ⚠ ENQUIRE WITHIN shares the name's string: tradeSub drops a sub on a label equal to the name.
    if (frontVis) {
      const P = (lx14, ly14, z) => { const [wx, wy] = F(lx14, ly14); return cam.proj(wx, wy, z); };
      const bhw = fh * 0.92, by = fh * 1.04, span = boardZ1 - boardZ0;
      const panel = (z0, z1, text, sub) => {
        const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
        if (![TL, TR, BR, BL].every((q) => q.f > 0.12)) return;
        const tex = bakeSignText(text, '#2e4a3c', 0, false, true, true, sub ? { sub } : undefined);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      };
      panel(boardZ0 + span * 0.34, boardZ1 - span * 0.07, 'HALCYON FIELDS', 'PLOTS RELEASED');
      panel(boardZ0 + span * 0.07, boardZ0 + span * 0.24, (sign || 'HALCYON LAND OFFICE') + ' · ENQUIRE WITHIN');
    }
    // The office is a drum, so the door stands in a shallow porch out of its face.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      y: fh * 0.56, w: fh * 0.10, top: 0.105, leaves: 1,
      frame: [186, 198, 208], lobby: { day: [84, 108, 124], night: [255, 238, 196] },
      porch: { depth: fh * 0.08, half: fh * 0.17, top: h * 0.34, pal: 'ty_hf_chrome' }, frontVis });
    if (night) {
      const [gx15, gy15] = F(0, fh * 0.66); glowPool(ctx, cam, gx15, gy15, h * 0.22, '255,238,196', 10, alpha * 0.30);   // outside the drum's glass (0.60)
    }
  },
  hydro(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // 5 Kettle Lane: a stepped section, every floor set back to make a balcony.
    const tiers = [0.00, 0.26, 0.50, 0.72], tops = [0.26, 0.50, 0.72, 0.92];
    // ⚠ The setback is on the entrance face, never a fixed axis, so balconies face the street.
    for (let i = 0; i < 4; i++) {
      const back = i * fh * 0.13;
      const [tx16, ty16] = F(0, -back);
      draw3DBoxAt(ctx, cam, tx16, ty16, fh * 0.90, h * tiers[i], h * tops[i], pal, seed + i, night, alpha, true, faceYaw(E), fh * (0.78 - i * 0.13));
    }
    // Balcony rails.
    for (let i = 0; i < 4; i++) {
      const front = fh * (0.78 - i * 0.13) - i * fh * 0.13;
      const [rx17, ry17] = F(0, front);
      draw3DBoxAt(ctx, cam, rx17, ry17, fh * 0.90, h * tops[i], h * tops[i] + h * 0.035, 'ty_wind_rail', seed + 20 + i, night, alpha, true, faceYaw(E), fh * 0.03);
    }
    // A drum at each end of every tier, so the tiers read as lozenges.
    // ⚠ `d` is unitless and `fh` is applied once: fh * fh is quadratic, which the affine capture can't hold.
    for (let i = 0; i < 4; i++) {
      const back = i * fh * 0.13, d = 0.78 - i * 0.13;
      for (const t of [-1, 1]) {
        const [qx, qy] = F(t * fh * 0.90, -back);
        drawFacetDrum(ctx, cam, qx, qy, h * tiers[i], h * tops[i] + h * 0.035, fh * (d + 0.04), fh * (d + 0.04), 12, alpha, hfChrome([118, 134, 150], [236, 244, 250], 1.9), hfChrome([126, 142, 158], [206, 220, 230], 1.4), 'ty_wind');
      }
    }
    awning(ctx, cam, dx, dy, E, fh * 0.34, fh * 0.44, h * 0.16, h * 0.20, 'ty_soffit', seed + 30, night, alpha, fh * 0.18);
    if (night) {
      for (let i = 0; i < 4; i++) {
        // Just proud of tier i's face (0.78 - 0.26 i).
        const front = fh * (0.82 - i * 0.13) - i * fh * 0.13;
        const [gx18, gy18] = F(0, front);
        glowPool(ctx, cam, gx18, gy18, h * tops[i] - h * 0.05, '255,232,196', 6, alpha * 0.17);
      }
    }
  },
  winter_garden(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Winter Garden: a glass barrel vault on a plinth, fed by a lagged heat main.
    const glass = [168, 196, 176];
    const knee = h * 0.20, archH = h * 0.62;
    // The plinth, PLAIN_WALL, with rounded ends.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, knee, pal, seed, night, alpha, false);
    for (const t of [-1, 1]) { const [qx, qy] = F(0, t * fh * 0.92);
      drawFacetDrum(ctx, cam, qx, qy, 0, knee, fh * 0.86, fh * 0.84, 14, alpha, hfChrome([94, 110, 126], [228, 238, 246], 2.0), hfChrome([104, 120, 136], [200, 214, 224], 1.4), pal); }
    drawBarrelRoof(ctx, cam, F, 0, fh * 0.86, fh * 0.92, knee, archH, 12, alpha, glass);
    // The ridge vent.
    for (const s of [-0.46, 0, 0.46]) {
      const [vx19, vy19] = F(s * fh * 0.7, 0);
      draw3DBoxAt(ctx, cam, vx19, vy19, fh * 0.09, knee + archH * 0.92, knee + archH * 1.02, 'ty_door', seed + 3 + s * 10, night, alpha, false);
    }
    // The heat main. ⚠ Its own palette: in a shade of the host wall it vanishes.
    { const [m1x, m1y] = F(-fh * 0.30, -fh * 0.98);
      drawFacetDrum(ctx, cam, m1x, m1y, 0, knee * 1.4, fh * 0.09, fh * 0.09, 10, alpha, hfChrome([132, 148, 162], [246, 250, 252], 1.8), hfChrome([138, 154, 168], [216, 228, 236], 1.3), 'ty_wind_rail'); }
    { const [m2x, m2y] = F(-fh * 0.30, -fh * 0.60); draw3DBoxAt(ctx, cam, m2x, m2y, fh * 0.09, knee * 1.1, knee * 1.4, 'ty_wind_rail', seed + 13, night, alpha, true, faceYaw(E), fh * 0.40); }
    // The doors in the south gable, unlit.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      y: fh * 0.92, w: fh * 0.13, z0: knee, top: knee + 0.105, leaves: 2,
      frame: [58, 66, 62], lobby: { day: [74, 112, 78], night: [96, 150, 108] }, mat: false, frontVis });
    if (night) {
      // ⚠ Never grow-lamps (that's Terminus). One low warm pool at the north end, where the main comes in.
      const [gx20, gy20] = F(-fh * 0.30, -fh * 0.40); glowPool(ctx, cam, gx20, gy20, knee + archH * 0.30, '160,220,176', 9, alpha * 0.18);
    }
  },
  pumping_station(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Kettle Lane Pumping Station: a glazed engine hall with a campanile stack.
    const hallTop = h * 0.74, eaves = h * 0.82, stack = h * 1.36;
    drawFacetDrum(ctx, cam, dx, dy, 0, hallTop * 0.54, fh * 0.80, fh * 0.78, 18, alpha, hfChrome([110, 126, 142], [220, 232, 240], 1.9), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, hallTop * 0.54, hallTop, fh * 0.78, fh * 0.76, 18, alpha, hfGlass(night, [46, 76, 100]), null, 'ty_mains_engine');
    // The course under the eaves.
    drawFacetDrum(ctx, cam, dx, dy, hallTop, eaves, fh * 0.84, fh * 0.80, 18, alpha, hfChrome([126, 142, 156], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [210, 224, 232], 1.4), 'ty_mains_terra');
    // The stack stands clear of the hall so it reads as its own tower.
    { const [cx, cy] = F(fh * 0.66, -fh * 0.62);
      drawFacetDrum(ctx, cam, cx, cy, 0, stack, fh * 0.16, fh * 0.13, 12, alpha, hfChrome([102, 118, 134], [228, 238, 246], 2.0), null, pal); }
    { const [cx2, cy2] = F(fh * 0.66, -fh * 0.62);
      drawFacetDrum(ctx, cam, cx2, cy2, stack, stack + h * 0.05, fh * 0.19, fh * 0.17, 12, alpha, hfChrome([126, 142, 156], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [210, 224, 232], 1.4), 'ty_mains_terra'); }
    { const [ax, ay] = F(0, fh * 0.78); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.22, 0, h * 0.40, 'ty_mains_engine', seed + 4, night, alpha, false, faceYaw(E), fh * 0.04); }
    if (night) {
      // Warm on purpose, as `concert_hall`. On the glazed band's face (~0.76 fh), outside the drum.
      const [gx, gy] = F(0, fh * 0.82); glowPool(ctx, cam, gx, gy, h * 0.46, '255,206,138', 9, alpha * 0.24);
    }
  },
  cooling_plant(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Halcyon Cooling Plant: a blank block with fans on a deck.
    const slabTop = h * 0.62, deckTop = h * 0.74;
    // The block, with rounded ends.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, slabTop, pal, seed, night, alpha, true);
    for (const t of [-1, 1]) { const [qx, qy] = F(t * fh * 0.78, 0);
      drawFacetDrum(ctx, cam, qx, qy, 0, slabTop, fh * 0.92, fh * 0.90, 14, alpha, hfChrome([100, 116, 132], [222, 234, 242], 2.0), hfChrome([110, 126, 142], [196, 210, 220], 1.4), pal); }
    { const [kx, ky] = F(0, 0); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.86, slabTop, deckTop, 'ty_gantry', seed + 1, night, alpha, false); }
    // Four fan cowls as separate drums.
    for (let i = 0; i < 4; i++) {
      const t = -0.60 + i * 0.40;
      const [fx, fy] = F(t * fh, 0);
      drawFacetDrum(ctx, cam, fx, fy, deckTop, deckTop + h * 0.12, fh * 0.17, fh * 0.20, 14, alpha, hfChrome([122, 138, 152], [238, 246, 250], 1.8), hfChrome([130, 146, 160], [204, 218, 228], 1.3), 'ty_cold_cowl');
    }
    // The heat main to the Winter Garden; same palette both ends.
    { const [mx, my] = F(-fh * 0.72, -fh * 0.40); draw3DBoxAt(ctx, cam, mx, my, fh * 0.09, h * 0.16, h * 0.24, 'ty_wind_rail', seed + 8, night, alpha, true, faceYaw(E), fh * 0.60); }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: fh * 0.30, y: fh * 0.78, w: fh * 0.08, top: 0.10, leaves: 1,
      frame: [120, 132, 140], solid: { fill: [104, 116, 124], handle: [190, 196, 200] },
      lamp: '206,226,230', lampDay: 0, lampS: 5, spill: '206,226,230', mat: false, frontVis });
    if (night) {
      const [gx, gy] = F(0, 0); glowPool(ctx, cam, gx, gy, deckTop + h * 0.06, '206,226,230', 7, alpha * 0.20);
    }
  },
  gasholder(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Kerbstone Row Gasholder: a guide frame with the holder two-thirds up.
    const frameTop = h * 1.18, drumTop = h * 0.78, gaugeTop = h * 0.16;
    // The guide frame, round. `ty_holder` is PLAIN_WALL.
    drawFacetDrum(ctx, cam, dx, dy, 0, frameTop, fh * 0.86, fh * 0.84, 16, alpha, hfChrome([84, 100, 116], [200, 214, 226], 2.2), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, 0, drumTop, fh * 0.74, fh * 0.72, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.9), hfChrome([126, 142, 156], [200, 214, 224], 1.4), 'ty_holder_drum');
    // The gauge house, pushed to the entrance side so its door is outside the frame.
    { const [gx2, gy2] = F(0, fh * 0.92);
      drawFacetDrum(ctx, cam, gx2, gy2, 0, gaugeTop, fh * 0.26, fh * 0.24, 14, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [198, 212, 222], 1.4), 'ty_engine_brick'); }
    if (night) {
      // ⚠ One obstruction light on the crown; no sign, flood or window glow.
      blinkLight(ctx, cam, dx, dy, frameTop, '255,122,90', now, seed, alpha, 1.0);
      const [lx, ly] = F(0, fh * 0.92); glowPool(ctx, cam, lx, ly, gaugeTop * 0.7, '255,214,150', 4, alpha * 0.14);
    }
  },
  substation(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Halcyon Substation: a fenced yard of tanks under a gantry, and a switch room.
    const tankTop = h * 0.46, gantry = h * 0.92, roomTop = h * 0.34;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.16, 'ty_current_fence', seed, night, alpha, false);
    for (let i = 0; i < 3; i++) {
      const t = -0.46 + i * 0.46;
      const [tx2, ty3] = F(t * fh, -fh * 0.20);
      drawFacetDrum(ctx, cam, tx2, ty3, 0, tankTop, fh * 0.17, fh * 0.16, 12, alpha, hfChrome([98, 114, 130], [218, 230, 240], 2.0), hfChrome([108, 124, 140], [194, 208, 218], 1.4), pal);
    }
    for (const t of [-0.74, 0.74]) {
      const [lx2, ly2] = F(t * fh, -fh * 0.20);
      draw3DBoxAt(ctx, cam, lx2, ly2, fh * 0.05, 0, gantry, 'ty_gantry', seed + 6 + t * 10, night, alpha, false);
    }
    { const [bx, by] = F(0, -fh * 0.20); draw3DBoxAt(ctx, cam, bx, by, fh * 0.80, gantry, gantry + h * 0.05, 'ty_gantry', seed + 9, night, alpha, false); }
    { const [rx2, ry2] = F(fh * 0.56, fh * 0.70);
      drawFacetDrum(ctx, cam, rx2, ry2, 0, roomTop, fh * 0.30, fh * 0.28, 14, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [198, 212, 222], 1.4), 'ty_engine_brick'); }
    // The room is a drum, so the door stands in a shallow porch that meets the curve.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: fh * 0.56, y: fh * 0.94, w: fh * 0.075, top: 0.10, leaves: 1,
      frame: [150, 160, 170], porch: { depth: fh * 0.05, half: fh * 0.13, top: h * 0.31, pal: 'ty_hf_chrome' },
      solid: { fill: [118, 128, 136], handle: [196, 200, 204] },
      lamp: '255,210,74', lampDay: 0, lampS: 5, spill: '255,210,74', mat: false, frontVis });
    if (night) {
      // Sodium only, nothing warm.
      const [gx3, gy3] = F(-fh * 0.74, -fh * 0.20); glowPool(ctx, cam, gx3, gy3, gantry * 0.8, '255,210,74', 8, alpha * 0.26);
    }
  },
  exchange(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Kerbstone Row Exchange: a blind shaft with a louvre band at the top.
    const blank = h * 0.84, louvre = h * 0.98, parapet = h * 1.04;
    // `ty_wires` is GLASS_WALL, so it never punches an opening.
    drawFacetDrum(ctx, cam, dx, dy, 0, blank, fh * 0.88, fh * 0.86, 18, alpha, hfGlass(night, [46, 68, 90]), null, pal);
    // The louvre band, slightly proud of the glass.
    drawFacetDrum(ctx, cam, dx, dy, blank, louvre, fh * 0.90, fh * 0.90, 18, alpha, hfChrome([104, 118, 130], [206, 220, 230], 2.0), null, 'ty_wires_louvre');
    drawFacetDrum(ctx, cam, dx, dy, louvre, parapet, fh * 0.92, fh * 0.88, 18, alpha, hfChrome([112, 128, 142], [226, 238, 246], 1.8), hfChrome([120, 136, 150], [198, 212, 222], 1.4), 'ty_hf_chrome');
    { const [dx2, dy2] = F(0, fh * 0.88); draw3DBoxAt(ctx, cam, dx2, dy2, fh * 0.07, 0, h * 0.20, 'ty_wires_louvre', seed + 3, night, alpha, false, faceYaw(E), fh * 0.02); }
    // ⚠ A small stencilled number, never a name: the building carries no name.
    if (frontVis) {
      const P = (lx3, ly3, z) => { const [wx, wy] = F(lx3, ly3); return cam.proj(wx, wy, z); };
      const z0 = h * 0.10, z1 = h * 0.15, bhw = fh * 0.20, by = fh * 0.90;
      const TL = P(bhw * 0.6, by, z1), TR = P(bhw * 2.2, by, z1), BR = P(bhw * 2.2, by, z0), BL = P(bhw * 0.6, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText('884 021', '#6e7276', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      // ⚠ The louvre band is the only lit thing. No door lamp.
      const [gx4, gy4] = F(0, 0); glowPool(ctx, cam, gx4, gy4, (blank + louvre) * 0.5, '143,180,200', 6, alpha * 0.18);
    }
  },
  fire_station(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Engine Trouble: three bay doors and a hose tower.
    const bayTop = h * 0.44, blockTop = h * 0.86, towerTop = h * 1.44;
    // The block, a lozenge in plan. ⚠ The red doors (`ty_engine`) must stay red.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.76, 0, blockTop, pal, seed, night, alpha, true);
    for (const t of [-1, 1]) { const [qx, qy] = F(t * fh * 0.76, 0);
      drawFacetDrum(ctx, cam, qx, qy, 0, blockTop, fh * 0.90, fh * 0.88, 14, alpha, hfChrome([104, 120, 136], [224, 236, 244], 2.0), hfChrome([114, 130, 146], [198, 212, 222], 1.4), pal); }
    // Each door on its own seed so they read as three, not one band.
    for (let i = 0; i < 3; i++) {
      const t = -0.50 + i * 0.50;
      const [bx2, by2] = F(t * fh, fh * 0.92);
      draw3DBoxAt(ctx, cam, bx2, by2, fh * 0.21, h * 0.02, bayTop, 'ty_engine', seed + 2 + i, night, alpha, false, faceYaw(E), fh * 0.03);
    }
    // The hose tower, louvred so it reads as a shaft, not a flue.
    { const [tx3, ty4] = F(-fh * 0.70, -fh * 0.46);
      drawFacetDrum(ctx, cam, tx3, ty4, 0, towerTop, fh * 0.18, fh * 0.155, 12, alpha, hfChrome([96, 110, 124], [210, 224, 234], 2.1), hfChrome([106, 120, 134], [188, 202, 214], 1.4), 'ty_wires_louvre'); }
    { const [hx, hy] = F(-fh * 0.70, -fh * 0.18); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.05, towerTop - h * 0.06, towerTop - h * 0.02, 'ty_gantry', seed + 7, night, alpha, false, faceYaw(E), fh * 0.28); }
    { const [ax2, ay2] = F(0, fh * 1.16); draw3DBoxAt(ctx, cam, ax2, ay2, fh * 0.88, 0, h * 0.008, 'ty_cold_slab', seed + 9, night, alpha, true, faceYaw(E), fh * 0.24); }
    if (night) {
      const [gx5, gy5] = F(0, fh * 0.98); glowPool(ctx, cam, gx5, gy5, h * 0.30, '255,228,190', 11, alpha * 0.30);
      blinkLight(ctx, cam, dx, dy, bayTop + h * 0.06, '255,90,74', now, seed, alpha, 0.7);
    }
  },
  incinerator(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ash Management: a destructor with a tipping hall, ramp, bunker house
    // and tall stack. ⚠ The hall is BRICK_WALL and the kit's `wall` is declined, or it reads as an office.
    // Local frame: +y is the street, and the ramp is on the -x flank.
    const yaw = faceYaw(E), dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh();
    const BRICK = WALL_COL[pal] || [118, 72, 56], STONE = [172, 162, 142], STEEL = [92, 98, 104];
    const ASPHALT = [56, 58, 62], DARK_BRICK = [58, 42, 38], GLASS_D = [30, 36, 40], SODIUM = [176, 118, 58];
    const hallTop = h * 0.46, ridge = h * 0.62, rampTop = h * 0.16;
    // The tipping hall under a street-facing gable.
    const hx0 = -fh * 0.60, hx1 = fh * 0.98, hy0 = -fh * 0.34, hy1 = fh * 0.62;
    const hcx = (hx0 + hx1) / 2, hcy = (hy0 + hy1) / 2;
    { const [cx, cy] = F(hcx, hcy); draw3DBoxAt(ctx, cam, cx, cy, (hx1 - hx0) / 2, 0, hallTop, pal, seed, night, alpha, true, yaw, (hy1 - hy0) / 2); }
    for (const [y, s] of [[hy1, 1], [hy0, -1]]) ashFlat(ctx, cam, W3, [[hx0, y, hallTop], [hx1, y, hallTop], [hcx, y, ridge]], [0, s, 0], BRICK, 'brick', alpha, dn);
    for (const [x, s] of [[hx0 - fh * 0.035, -1], [hx1 + fh * 0.035, 1]]) {
      ashFlat(ctx, cam, W3, [[x, hy1 + 0.004, hallTop - h * 0.01], [hcx, hy1 + 0.004, ridge], [hcx, hy0 - 0.004, ridge], [x, hy0 - 0.004, hallTop - h * 0.01]], [s * 0.45, 0, 1], [66, 70, 78], 'plain', alpha, dn);
    }
    { const [vx, vy] = F(hcx, hcy); draw3DBoxAt(ctx, cam, vx, vy, fh * 0.07, ridge - h * 0.012, ridge + h * 0.025, 'ty_wires_louvre', seed + 2, night, alpha, true, yaw, (hy1 - hy0) * 0.40); }
    // The street front on the gable wall.
    const yF = hy1 + 0.003;
    ashFlat(ctx, cam, W3, [[hx0, yF, h * 0.045], [hx1, yF, h * 0.045], [hx1, yF, 0.002], [hx0, yF, 0.002]], [0, 1, 0], DARK_BRICK, 'brick', alpha, dn);
    ashFlat(ctx, cam, W3, [[hx0, yF, h * 0.405], [hx1, yF, h * 0.405], [hx1, yF, h * 0.39], [hx0, yF, h * 0.39]], [0, 1, 0], STONE, 'stone', alpha, dn);
    for (const xe of [hx0, hx1]) {
      ashFlat(ctx, cam, W3, [[xe, yF + 0.002, hallTop], [hcx, yF + 0.002, ridge], [hcx, yF + 0.002, ridge + h * 0.02], [xe, yF + 0.002, hallTop + h * 0.02]], [0, 1, 0], STONE, 'stone', alpha, dn);
      const s = xe < hcx ? 1 : -1;
      for (let i = 0; i < 8; i++) {
        const z0 = h * (0.05 + i * 0.05), z1 = z0 + h * 0.04, w = fh * (i % 2 ? 0.05 : 0.08);
        ashFlat(ctx, cam, W3, [[xe, yF + 0.002, z1], [xe + s * w, yF + 0.002, z1], [xe + s * w, yF + 0.002, z0], [xe, yF + 0.002, z0]], [0, 1, 0], STONE, 'stone', alpha, dn);
      }
    }
    { const oz = h * 0.535, r = fh * 0.085, ring = [], pane = [];
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * 6.2832, c = Math.cos(a), s = Math.sin(a);
        ring.push([hcx + c * r * 1.3, yF + 0.002, oz + s * r * 1.3]); pane.push([hcx + c * r, yF + 0.003, oz + s * r]);
      }
      ashFlat(ctx, cam, W3, ring, [0, 1, 0], STONE, 'stone', alpha, dn);
      ashGlow(ctx, cam, W3, pane, [0, 1, 0], GLASS_D, SODIUM, dn, alpha);
      if (near) for (const [ax, az] of [[r, 0], [0, r]]) emitWire(ctx, cam, W3(hcx - ax, yF + 0.004, oz - az), W3(hcx + ax, yF + 0.004, oz + az), 1.4, 'rgba(52,48,44,0.95)', alpha, { pull: 0.02 });
    }
    const sx0 = fh * 0.30, sx1 = fh * 0.86, shTop = h * 0.21;
    ashFlat(ctx, cam, W3, [[sx0, yF + 0.002, shTop], [sx1, yF + 0.002, shTop], [sx1, yF + 0.002, 0.002], [sx0, yF + 0.002, 0.002]], [0, 1, 0], [74, 80, 86], 'metal', alpha, dn);
    ashFlat(ctx, cam, W3, [[sx0 - fh * 0.02, yF + 0.003, shTop + h * 0.02], [sx1 + fh * 0.02, yF + 0.003, shTop + h * 0.02], [sx1 + fh * 0.02, yF + 0.003, shTop], [sx0 - fh * 0.02, yF + 0.003, shTop]], [0, 1, 0], [40, 44, 48], 'metal', alpha, dn);
    if (near) {
      for (let k = 1; k < 8; k++) { const z = shTop * k / 8; emitWire(ctx, cam, W3(sx0, yF + 0.004, z), W3(sx1, yF + 0.004, z), 1, 'rgba(40,44,48,0.7)', alpha, { pull: 0.02 }); }
      for (const x of [sx0 - fh * 0.05, sx1 + fh * 0.05]) emitWire(ctx, cam, W3(x, yF + fh * 0.08, 0), W3(x, yF + fh * 0.08, h * 0.055), 3, 'rgba(214,170,40,0.95)', alpha, { pull: 0.02 });
    }
    { const px0 = -fh * 0.18, px1 = -fh * 0.04, pTop = h * 0.12, e = fh * 0.016;
      ashFlat(ctx, cam, W3, [[px0 - e, yF + 0.002, pTop + h * 0.014], [px1 + e, yF + 0.002, pTop + h * 0.014], [px1 + e, yF + 0.002, 0.002], [px0 - e, yF + 0.002, 0.002]], [0, 1, 0], STONE, 'stone', alpha, dn);
      ashFlat(ctx, cam, W3, [[px0, yF + 0.003, pTop], [px1, yF + 0.003, pTop], [px1, yF + 0.003, 0.002], [px0, yF + 0.003, 0.002]], [0, 1, 0], [34, 78, 56], 'plain', alpha, dn); }
    // The name plate, the only lettering on the plot. Paint, never a lit sign.
    { const x0 = -fh * 0.52, x1 = fh * 0.90, z0 = h * 0.245, z1 = h * 0.355, yP = yF + 0.004, b = fh * 0.02;
      ashFlat(ctx, cam, W3, [[x0 - b, yP - 0.001, z1 + h * 0.012], [x1 + b, yP - 0.001, z1 + h * 0.012], [x1 + b, yP - 0.001, z0 - h * 0.012], [x0 - b, yP - 0.001, z0 - h * 0.012]], [0, 1, 0], [200, 202, 190], 'plain', alpha, dn);
      ashFlat(ctx, cam, W3, [[x0, yP, z1], [x1, yP, z1], [x1, yP, z0], [x0, yP, z0]], [0, 1, 0], [30, 86, 58], 'plain', alpha, dn);
      if (frontVis) {
        const P = (u, z) => { const [wx, wy] = F(u, yP + FACE_EPS); return cam.proj(wx, wy, z); };
        const q = [P(x0 + b, z1 - h * 0.01), P(x1 - b, z1 - h * 0.01), P(x1 - b, z0 + h * 0.01), P(x0 + b, z0 + h * 0.01)];
        const tex = bakeSignText(sign || 'ASH MANAGEMENT', '#eceee2', 0, false, true, true, { font: 'condensed', sub: 'TRADE AND MUNICIPAL · WEIGHBRIDGE IN USE' });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
      for (const u of [-0.16, 0.56]) {
        if (near) emitWire(ctx, cam, W3(fh * u, yF, h * 0.40), W3(fh * u, yF + fh * 0.07, h * 0.395), 1.6, 'rgba(40,44,48,0.95)', alpha, { pull: 0.02 });
        if (dn > 0) { const [gx, gy] = F(fh * u, yF + fh * 0.07); glowPool(ctx, cam, gx, gy, h * 0.385, '255,214,160', 9, alpha * 0.42 * dn); }
      }
    }
    // Flank windows; the ramp side gives up the tipping door's bay.
    for (const s of [-1, 1]) {
      const x = (s < 0 ? hx0 : hx1) + s * 0.003;
      ashFlat(ctx, cam, W3, [[x, hy0, h * 0.045], [x, hy1, h * 0.045], [x, hy1, 0.002], [x, hy0, 0.002]], [s, 0, 0], DARK_BRICK, 'brick', alpha, dn);
      ashFlat(ctx, cam, W3, [[x, hy0, h * 0.405], [x, hy1, h * 0.405], [x, hy1, h * 0.39], [x, hy0, h * 0.39]], [s, 0, 0], STONE, 'stone', alpha, dn);
      for (const v of [-0.20, 0.06, 0.32, 0.54]) {
        if (s < 0 && v < 0) continue;
        const y0 = fh * (v - 0.055), y1 = fh * (v + 0.055), xw = x + s * 0.002;
        ashFlat(ctx, cam, W3, [[x + s * 0.001, y0 - fh * 0.012, h * 0.222], [x + s * 0.001, y1 + fh * 0.012, h * 0.222], [x + s * 0.001, y1 + fh * 0.012, h * 0.21], [x + s * 0.001, y0 - fh * 0.012, h * 0.21]], [s, 0, 0], STONE, 'stone', alpha, dn);
        ashGlow(ctx, cam, W3, [[xw, y0, h * 0.37], [xw, y1, h * 0.37], [xw, y1, h * 0.222], [xw, y0, h * 0.222]], [s, 0, 0], GLASS_D, SODIUM, dn, alpha);
        if (near) {
          emitWire(ctx, cam, W3(xw + s * 0.001, (y0 + y1) / 2, h * 0.222), W3(xw + s * 0.001, (y0 + y1) / 2, h * 0.37), 1.2, 'rgba(48,46,44,0.95)', alpha, { pull: 0.02 });
          emitWire(ctx, cam, W3(xw + s * 0.001, y0, h * 0.31), W3(xw + s * 0.001, y1, h * 0.31), 1.2, 'rgba(48,46,44,0.95)', alpha, { pull: 0.02 });
        }
      }
    }
    // The ramp: the landing is mass, the slope a wedge of faces.
    const rx0 = -fh * 1.00, rx1 = -fh * 0.66, ryB = -fh * 0.32, ryT = -fh * 0.08, ryF = fh * 0.70;
    { const [lx, ly] = F((rx0 + rx1) / 2, (ryB + ryT) / 2); draw3DBoxAt(ctx, cam, lx, ly, (rx1 - rx0) / 2, 0, rampTop, pal, seed + 3, night, alpha, true, yaw, (ryT - ryB) / 2); }
    ashFlat(ctx, cam, W3, [[rx0, ryB, rampTop + 0.002], [rx1, ryB, rampTop + 0.002], [rx1, ryT, rampTop + 0.002], [rx0, ryT, rampTop + 0.002]], [0, 0, 1], ASPHALT, 'concrete', alpha, dn);
    ashFlat(ctx, cam, W3, [[rx0, ryT, rampTop + 0.002], [rx1, ryT, rampTop + 0.002], [rx1, ryF, 0.003], [rx0, ryF, 0.003]], [0, 0.4, 1], ASPHALT, 'concrete', alpha, dn);
    for (const [x, s] of [[rx0, -1], [rx1, 1]]) ashFlat(ctx, cam, W3, [[x, ryT, 0.002], [x, ryT, rampTop], [x, ryF, 0.002]], [s, 0, 0], BRICK, 'brick', alpha, dn);
    ashFlat(ctx, cam, W3, [[rx1, -fh * 0.28, rampTop + 0.003], [hx0, -fh * 0.28, rampTop + 0.003], [hx0, -fh * 0.10, rampTop + 0.003], [rx1, -fh * 0.10, rampTop + 0.003]], [0, 0, 1], STEEL, 'plate', alpha, dn);   // the dock plate over the gap
    { const xr = rx0 + 0.004, hr = h * 0.035, rail = 'rgba(176,180,182,0.95)';
      emitWire(ctx, cam, W3(xr, ryF, hr), W3(xr, ryT, rampTop + hr), 1.8, rail, alpha, { pull: 0.02 });
      emitWire(ctx, cam, W3(xr, ryT, rampTop + hr), W3(xr, ryB, rampTop + hr), 1.8, rail, alpha, { pull: 0.02 });
      if (near) for (const t of [0.15, 0.4, 0.65, 0.9]) { const y = ryF + (ryT - ryF) * t, z = rampTop * t; emitWire(ctx, cam, W3(xr, y, z), W3(xr, y, z + hr), 1.4, rail, alpha, { pull: 0.02 }); } }
    { const x = hx0 - 0.004, y0 = -fh * 0.28, y1 = -fh * 0.10, z0 = rampTop + 0.003, z1 = rampTop + h * 0.15;
      ashGlow(ctx, cam, W3, [[x, y0, z1], [x, y1, z1], [x, y1, z0], [x, y0, z0]], [-1, 0, 0], [24, 22, 20], [200, 136, 64], dn, alpha);
      ashFlat(ctx, cam, W3, [[x - 0.002, y0 - fh * 0.015, z1 + h * 0.035], [x - 0.002, y1 + fh * 0.015, z1 + h * 0.035], [x - 0.002, y1 + fh * 0.015, z1], [x - 0.002, y0 - fh * 0.015, z1]], [-1, 0, 0], [70, 76, 82], 'metal', alpha, dn);
      if (dn > 0) { const [gx, gy] = F(hx0 - fh * 0.05, (y0 + y1) / 2); glowPool(ctx, cam, gx, gy, rampTop + h * 0.06, '255,176,96', 9, alpha * 0.40 * dn); } }
    // The weighbridge, its cabin and a sodium flood.
    { const y0 = fh * 0.74, y1 = fh * 1.08, z = 0.003, e = fh * 0.02;
      ashFlat(ctx, cam, W3, [[rx0 - e, y0 - e, z], [rx1 + e, y0 - e, z], [rx1 + e, y1 + e, z], [rx0 - e, y1 + e, z]], [0, 0, 1], [38, 40, 42], 'concrete', alpha, dn);
      ashFlat(ctx, cam, W3, [[rx0, y0, z + 0.001], [rx1, y0, z + 0.001], [rx1, y1, z + 0.001], [rx0, y1, z + 0.001]], [0, 0, 1], [112, 116, 118], 'plate', alpha, dn);
      for (const y of [y0, y1 - fh * 0.03]) ashFlat(ctx, cam, W3, [[rx0, y, z + 0.002], [rx1, y, z + 0.002], [rx1, y + fh * 0.03, z + 0.002], [rx0, y + fh * 0.03, z + 0.002]], [0, 0, 1], [204, 168, 40], 'plain', alpha, dn);
      if (near) for (let k = 1; k < 4; k++) { const x = rx0 + (rx1 - rx0) * k / 4; emitWire(ctx, cam, W3(x, y0 + fh * 0.03, z + 0.002), W3(x, y1 - fh * 0.03, z + 0.002), 1, 'rgba(60,64,66,0.8)', alpha, { pull: 0.01 }); } }
    { const kx0 = -fh * 0.58, kx1 = -fh * 0.26, ky0 = fh * 0.68, ky1 = fh * 0.96, kTop = h * 0.12;
      const [kx, ky] = F((kx0 + kx1) / 2, (ky0 + ky1) / 2);
      draw3DBoxAt(ctx, cam, kx, ky, (kx1 - kx0) / 2, 0, kTop, 'ty_ash_stack', seed + 4, night, alpha, true, yaw, (ky1 - ky0) / 2);
      ashFlat(ctx, cam, W3, [[kx0 - fh * 0.03, ky0 - fh * 0.02, kTop + 0.003], [kx1 + fh * 0.03, ky0 - fh * 0.02, kTop + 0.003], [kx1 + fh * 0.03, ky1 + fh * 0.05, kTop + 0.003], [kx0 - fh * 0.03, ky1 + fh * 0.05, kTop + 0.003]], [0, 0, 1], [44, 48, 52], 'metal', alpha, dn);
      ashGlow(ctx, cam, W3, [[kx0 - 0.003, ky0 + fh * 0.06, h * 0.095], [kx0 - 0.003, ky1 - fh * 0.06, h * 0.095], [kx0 - 0.003, ky1 - fh * 0.06, h * 0.055], [kx0 - 0.003, ky0 + fh * 0.06, h * 0.055]], [-1, 0, 0], [36, 44, 48], [255, 214, 150], dn, alpha);
      ashGlow(ctx, cam, W3, [[kx0 + fh * 0.06, ky1 + 0.003, h * 0.095], [kx1 - fh * 0.06, ky1 + 0.003, h * 0.095], [kx1 - fh * 0.06, ky1 + 0.003, h * 0.055], [kx0 + fh * 0.06, ky1 + 0.003, h * 0.055]], [0, 1, 0], [36, 44, 48], [255, 214, 150], dn, alpha); }
    { const px = rx0 - fh * 0.04, py = fh * 1.10, top = h * 0.30, pole = 'rgba(70,74,78,0.95)';
      emitWire(ctx, cam, W3(px, py, 0), W3(px, py, top), 2.2, pole, alpha, { pull: 0.03 });
      emitWire(ctx, cam, W3(px, py, top), W3(px + fh * 0.16, py - fh * 0.10, top), 1.8, pole, alpha, { pull: 0.03 });
      if (dn > 0) { const [gx, gy] = F(px + fh * 0.16, py - fh * 0.10); glowPool(ctx, cam, gx, gy, top - h * 0.01, '255,186,104', 12, alpha * 0.55 * dn); } }
    // The bunker house behind the hall.
    const bx0 = -fh * 0.30, bx1 = fh * 1.00, by0 = -fh * 1.00, by1 = -fh * 0.32;
    const bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2, bhw = (bx1 - bx0) / 2, bfd = (by1 - by0) / 2;
    const plinth = h * 0.34, eave = h * 0.92;
    { const [cx, cy] = F(bcx, bcy);
      draw3DBoxAt(ctx, cam, cx, cy, bhw, 0, plinth, pal, seed + 5, night, alpha, false, yaw, bfd);
      draw3DBoxAt(ctx, cam, cx, cy, bhw, plinth, eave, 'ty_ash_stack', seed + 6, night, alpha, true, yaw, bfd);
      draw3DBoxAt(ctx, cam, cx, cy, bhw * 0.82, eave, eave + h * 0.07, 'ty_wires_louvre', seed + 7, night, alpha, true, yaw, bfd * 0.32); }
    { const y = by1 + 0.003, x = bx1 + 0.003, za = h * 0.75, zb = h * 0.81;
      ashGlow(ctx, cam, W3, [[bx0 + fh * 0.08, y, zb], [bx1 - fh * 0.08, y, zb], [bx1 - fh * 0.08, y, za], [bx0 + fh * 0.08, y, za]], [0, 1, 0], GLASS_D, SODIUM, dn, alpha);
      ashGlow(ctx, cam, W3, [[x, by0 + fh * 0.08, zb], [x, by1 - fh * 0.08, zb], [x, by1 - fh * 0.08, za], [x, by0 + fh * 0.08, za]], [1, 0, 0], GLASS_D, SODIUM, dn, alpha);
      if (near) for (let k = 1; k < 8; k++) {
        const u = bx0 + fh * 0.08 + (bx1 - bx0 - fh * 0.16) * k / 8;
        emitWire(ctx, cam, W3(u, y + 0.002, za), W3(u, y + 0.002, zb), 1.2, 'rgba(60,70,66,0.9)', alpha, { pull: 0.02 });
      } }
    const vent = (f) => { const s = (0.50 + f.nl * 0.42) * (1 - 0.5 * dn); return rgb([120 * s, 128 * s, 132 * s]); };
    for (const [u, v] of [[0.10, -0.88], [0.80, -0.86]]) {
      const [vx, vy] = F(fh * u, fh * v);
      drawFacetDrum(ctx, cam, vx, vy, eave, eave + h * 0.06, fh * 0.05, fh * 0.04, 8, alpha, vent, 'rgb(56,60,62)', 'ty_wires_louvre');
    }
    // The stack, 3h, tapering and sooted toward the top.
    // ⚠ On the -x side: behind the bunker house it loses its outline against the tenement.
    const sx = -fh * 0.66, sy = -fh * 0.70, sB = h * 0.10, sT = h * 2.88, sTop = h * 3.0;
    const rB = fh * 0.24, rT = fh * 0.13, rAt = (z) => rB + (rT - rB) * (z - sB) / (sT - sB);
    const brickStyle = (tone) => litStyle((f) => {
      const s = (0.58 + f.nl * 0.44) * tone * (1 - 0.5 * dn);
      return rgb([BRICK[0] * s, BRICK[1] * s, BRICK[2] * s]);
    }, [BRICK[0] * tone, BRICK[1] * tone, BRICK[2] * tone], 'brick');
    const [scx, scy] = F(sx, sy);
    draw3DBoxAt(ctx, cam, scx, scy, fh * 0.28, 0, sB, pal, seed + 8, night, alpha, true);
    for (const [k0, k1, tone] of [[0.10, 1.10, 1.0], [1.10, 2.10, 0.84], [2.10, 2.88, 0.66]]) {
      drawFacetDrum(ctx, cam, scx, scy, h * k0, h * k1, rAt(h * k0), rAt(h * k1), 14, alpha, brickStyle(tone), null, pal);
    }
    drawFacetDrum(ctx, cam, scx, scy, sT, sTop, rT * 1.22, rT * 1.16, 14, alpha, brickStyle(0.40), 'rgb(22,20,20)', pal);
    // ⚠ Each band sits just above its joint: the occlusion solid is a drum at its widest radius, so a
    // band at the top of a tapering section is inside it and pulls through the stack (`glself`).
    for (const k of [1.10, 2.10]) { const z = h * (k + 0.012); ashBand(ctx, cam, scx, scy, z, rAt(z) * 1.05, 14, 'rgba(34,30,28,0.95)', 2, alpha); }
    ashBand(ctx, cam, scx, scy, sT + h * 0.025, rT * 1.22 * 1.04, 14, 'rgba(34,30,28,0.95)', 2, alpha);
    if (near) {
      const lad = 'rgba(64,60,58,0.95)';
      for (const u of [-0.035, 0.035]) emitWire(ctx, cam, W3(sx + fh * u, sy + rB + 0.004, sB), W3(sx + fh * u, sy + rT + 0.004, sT), 1.2, lad, alpha, { pull: 0.02 });
      for (let k = 1; k < 18; k++) { const z = sB + (sT - sB) * k / 18, y = sy + rAt(z) + 0.004; emitWire(ctx, cam, W3(sx - fh * 0.035, y, z), W3(sx + fh * 0.035, y, z), 1, lad, alpha, { pull: 0.02 }); }
    }
    blinkLight(ctx, cam, scx, scy, sTop + h * 0.01, '255,64,52', now, seed, alpha, 1.5);
    { const [bx, by] = F(sx, sy + rAt(h * 1.6) + 0.004); blinkLight(ctx, cam, bx, by, h * 1.6, '255,64,52', now, seed + 1, alpha, 1.1); }
    // The plume goes straight up: four stacked puffs.
    { const puff = dn > 0.5 ? '120,122,126' : '232,234,236';
      for (let i = 0; i < 4; i++) drawSmoke(ctx, cam, scx, scy, sTop + h * 0.14 * i, puff, alpha * (1 - i * 0.2), now, seed + i * 0.31); }
    // The breeching from the boilers to the stack.
    { const x0 = sx + rAt(h * 0.64) - fh * 0.02, x1 = bx0 + fh * 0.02, z0 = h * 0.58, z1 = h * 0.70;
      const [cx, cy] = F((x0 + x1) / 2, sy);
      draw3DBoxAt(ctx, cam, cx, cy, (x1 - x0) / 2, z0, z1, 'ty_gate_plate', seed + 9, night, alpha, true, yaw, fh * 0.07);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.025, 0, z0, 'ty_gate_plate', seed + 10, night, alpha, false, yaw, fh * 0.05); }
  },
  water_tower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // High Water Mark: a tank on four open legs.
    const legTop = h * 0.92, tankTop = h * 1.26, dome = h * 1.36, houseTop = h * 0.22;
    // ⚠ Four separate legs, never one box: the read is the gap between them.
    for (const [sx, sy] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) {
      const [lx, ly] = F(sx * fh, sy * fh);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.055, 0, legTop, pal, seed + 2 + sx * 7 + sy * 3, night, alpha, false);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.09, 0, h * 0.04, 'ty_hwm_pad', seed + 20 + sx * 7 + sy * 3, night, alpha, true);
    }
    // The overhanging skirt stops the tank reading as a box on sticks.
    { const [kx, ky] = F(0, 0); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.62, legTop, legTop + h * 0.04, 'ty_gantry', seed + 8, night, alpha, false); }
    { const [tx, ty2] = F(0, 0); draw3DBoxAt(ctx, cam, tx, ty2, fh * 0.56, legTop + h * 0.04, tankTop, pal, seed + 9, night, alpha, false); }
    { const [dx3, dy3] = F(0, 0); draw3DBoxAt(ctx, cam, dx3, dy3, fh * 0.44, tankTop, dome, pal, seed + 10, night, alpha, true); }
    { const [px, py] = F(0, fh * 0.76); draw3DBoxAt(ctx, cam, px, py, fh * 0.28, 0, houseTop, 'ty_engine_brick', seed + 12, night, alpha, true, faceYaw(E), fh * 0.22); }
    // Faded painted lettering, deliberately low contrast.
    if (frontVis) {
      const P = (lx4, ly4, z) => { const [wx, wy] = F(lx4, ly4); return cam.proj(wx, wy, z); };
      const z0 = legTop + h * 0.12, z1 = tankTop - h * 0.06, bhw = fh * 0.48, by = fh * 0.58;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText('COLDWATER', '#a8bcc4', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      blinkLight(ctx, cam, dx, dy, dome, '159,210,224', now, seed, alpha, 1.6);
      const [gx2, gy2] = F(0, fh * 0.76); glowPool(ctx, cam, gx2, gy2, houseTop * 0.8, '255,226,176', 5, alpha * 0.18);
    }
  },
};
