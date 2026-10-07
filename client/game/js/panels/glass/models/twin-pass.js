// The Twin Pass: building-model arms for the characterful half of each pair of Coldwater buildings that shared a type.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  DETAIL_LIFT, FACE_EPS, MESH_SINK, SHAPE_SINK, awning, bakeSignText, clamp, draw3DBoxAt, drawFacetDrum, drawRing,
  drawSmoke, emitFlat, emitSurfaceText, emitWire, faceYaw, frac, glowPool, marqueeBand, motionOn,
  nearOrMesh, reserveSignBand, rgb, roofCross, windWheel,
} from '../../windshield.js';

// ── Two-Cell Supply's faces and its mark ──────────────────────────────────────────────────────
// Newell's normal, turned to point along `out` — the sum `emitFlat` shades a lit face off.
function tcFacing(q, out) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * out[0] + ny * out[1] + nz * out[2] < 0 ? q.slice().reverse() : q;
}
// ⚠ tcUnder: A FACE THAT LOOKS DOWN IS UNDER SOMETHING. On the canvas it is skipped while the eye is
// above it, or the painter lays the lean-to's soffit and its lamps over the roof they hang under.
// The mesh keeps it, because a depth buffer settles that per pixel.
// A face in the model's own frame, facing the local direction `out`, lit on the GPU as `fam`. A
// pale face carries its own dusk, because the shader's night dim spares anything brighter than
// about 0.55 luminance (see the clone facility's dome).
function tcFlat(ctx, cam, W3, pts, out, alb, fam, alpha, dn) {
  if (SHAPE_SINK) return;
  if (!MESH_SINK && out[2] < -0.5 && (cam.EH || 0) > Math.max(...pts.map((p) => p[2]))) return;   // see tcUnder
  const O = W3(0, 0, 0), D = W3(out[0], out[1], out[2]);
  const ox = D[0] - O[0], oy = D[1] - O[1], oz = D[2] - O[2], ol = Math.hypot(ox, oy, oz) || 1;
  const lum = (0.299 * alb[0] + 0.587 * alb[1] + 0.114 * alb[2]) / 255;
  const d = lum > 0.42 ? 1 - 0.55 * dn : 1, a = [alb[0] * d, alb[1] * d, alb[2] * d];
  const k = clamp(0.64 + 0.28 * oz / ol - 0.14 * (ox + oy) / ol, 0.32, 1.12) * (1 - 0.55 * dn);
  emitFlat(ctx, cam, tcFacing(pts.map((p) => W3(p[0], p[1], p[2])), [ox, oy, oz]), rgb([a[0] * k, a[1] * k, a[2] * k]), alpha,
    { lit: fam, albedo: a, lift: DETAIL_LIFT, cullN: Math.abs(oz / ol) < 0.8 ? [ox, oy] : undefined });
}
// A lamp or an opening: unlit, so it holds `day` by day and `lit` after dark.
function tcGlow(ctx, cam, W3, pts, out, day, lit, dn, alpha) {
  if (SHAPE_SINK) return;
  if (!MESH_SINK && out[2] < -0.5 && (cam.EH || 0) > Math.max(...pts.map((p) => p[2]))) return;   // see tcUnder
  const O = W3(0, 0, 0), D = W3(out[0], out[1], out[2]);
  const ox = D[0] - O[0], oy = D[1] - O[1], oz = D[2] - O[2], ol = Math.hypot(ox, oy, oz) || 1;
  const c = [0, 1, 2].map((i) => day[i] + (lit[i] - day[i]) * dn);
  emitFlat(ctx, cam, tcFacing(pts.map((p) => W3(p[0], p[1], p[2])), [ox, oy, oz]), rgb(c), alpha,
    { lift: DETAIL_LIFT, cullN: Math.abs(oz / ol) < 0.8 ? [ox, oy] : undefined });
}
// Two-Cell's mark: two upright cells side by side on a lightbox, with their charge bars. Baked per
// number of bars lit and per day or night. By day the box is a painted panel and every bar is full;
// after dark it is lit from inside (`_lit` makes the decal emissive) and the bars fill in turn.
// ⚠ ITS OWN CANVAS, NOT A `picto:` SIGN. Pictograms are off city-wide (`bakeSignText` has
// `draw = null`), so a picto plate bakes an empty roundel with no error.
const _tcLogo = new Map();
function twoCellLogoTex(bars, lit) {
  const k = bars + (lit ? 10 : 0);
  if (_tcLogo.has(k)) return _tcLogo.get(k);
  if (typeof document === 'undefined') return null;
  const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  if (g) {
    const ink = lit ? '#9fe8ff' : '#f2c94c', dim = lit ? 'rgba(159,232,255,0.16)' : 'rgba(242,201,76,0.20)';
    const rr = (x, y, w, hh, r) => {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    };
    rr(4, 4, S - 8, S - 8, 14); g.fillStyle = lit ? '#0e1c22' : '#1a1e20'; g.fill();
    g.lineWidth = 5; g.strokeStyle = lit ? '#c4f2ff' : '#c9d1d4'; g.stroke();
    g.shadowColor = ink; g.shadowBlur = lit ? 10 : 0;
    for (const x0 of [24, 72]) {
      const w = 32, y0 = 34, hh = 78;
      g.fillStyle = ink; g.fillRect(x0 + 9, y0 - 10, 14, 10);   // the terminal
      rr(x0, y0, w, hh, 6); g.lineWidth = 5; g.strokeStyle = ink; g.stroke();
      for (let i = 0; i < 4; i++) { g.fillStyle = i < bars ? ink : dim; g.fillRect(x0 + 8, y0 + hh - 20 - i * 17, w - 16, 12); }
    }
    g.shadowBlur = 0;
  }
  c._lit = lit ? 1 : 0;
  _tcLogo.set(k, c);
  return c;
}

export const TWIN_PASS_ARMS = {
  // ══ THE TWIN PASS ═══════════════════════════════════════════
  // Every arm below exists because two Coldwater buildings of the same type were rendering as the
  // same object. The rule this pass follows is the one in world-rendering.md: promote the more
  // characterful half and LEAVE THE TWIN on the generic type model, so the type keeps a fallback.
  ff_kiln(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // FIRED & FORGOTTEN — a brick bottle-kiln cracked from crown to base, patched
    // with sheet steel, with the shop built into the split. The building IS the kiln; the retail is
    // an afterthought wedged in a structural failure, which is why it cannot be a shop box.
    const waist = h * 0.62, throat = h * 1.46;
    // 1) THE BOTTLE — a fat base tapering to a throat, in two drums so the waist reads.
    drawFacetDrum(ctx, cam, dx, dy, 0, waist, fh * 0.94, fh * 0.80, 13, alpha,
      (f) => 'rgb(' + (112 + f.nl * 56 | 0) + ',' + (66 + f.nl * 40 | 0) + ',' + (50 + f.nl * 30 | 0) + ')', 'rgb(76,46,34)');
    drawFacetDrum(ctx, cam, dx, dy, waist, throat, fh * 0.80, fh * 0.20, 13, alpha,
      (f) => 'rgb(' + (106 + f.nl * 52 | 0) + ',' + (62 + f.nl * 38 | 0) + ',' + (46 + f.nl * 28 | 0) + ')', 'rgb(70,42,30)');
    for (const z of [0.26, 0.60, 0.98]) drawRing(ctx, cam, dx, dy, h * z, fh * (z < 0.5 ? 0.95 : 0.72), 13, 'rgba(0,0,0,0.34)', 2, alpha);
    // 2) THE CRACK, and the sheet steel over it — one tall patch plate running crown to base up
    //    the flank. This is the whole story of the building in one box.
    { const [cx, cy] = F(-fh * 0.78, -fh * 0.24);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.16, 0, throat * 0.86, 'ty_ff_patch', seed + 4, night, alpha, false, 0.12); }
    // 3) THE SHOP in the split — a small glazed box let into the base on the entrance side.
    { const [sx, sy] = F(0, fh * 0.86);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.40, 0, h * 0.44, 'ty_ff_patch', seed + 6, night, alpha, true);
      glowPool(ctx, cam, sx, sy, h * 0.28, '255,186,120', 8, alpha * (night ? 0.5 : 0.18)); }
    // 4) The whitewashed name round the curve, and the stoke-hole glow at the base. It reads from
    //    a long way east, which is the point of putting it on a kiln rather than over a door.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.72, waist * 0.86, m.neon || '#ff8a4a', night, alpha, 'FIRED & FORGOTTEN');
    { const [mx, my] = F(fh * 0.40, fh * 0.72);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.12, 0, h * 0.20, 'ty_ff_white', seed + 10, night, alpha, false); }
    drawSmoke(ctx, cam, dx, dy, throat, '198,188,176', alpha * 0.4, now, seed + 12);
  },
  twocell(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // TWO-CELL SUPPLY — a corrugated shed with a lean-to front room on posts,
    // a tall false front carrying the name and the mark, and a roof that charges its own stock.
    // ⚠ THE STRIP IS STILL THE POINT. Its salvaged emergency lighting stays on when the block is
    // dark, so after dark this is the one front on Ironside still lit. It is drawn at every hour and
    // only its strength follows the night.
    // ⚠ IT WAS A GREY BOX WITH SIX CRATES HUNG ACROSS IT AND NO NAME ON IT. The kit painted the name
    // on the wall behind the crates and the crates hid most of it. The name has its own board above
    // the lean-to now, and the stock hangs on boards under the lean-to where it can't cover anything.
    // Local frame: +y is the street.
    const yaw = faceYaw(E), dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh();
    const TIN = [130, 134, 136], STRIP = [214, 246, 238];
    const shedTop = h * 0.46, roofF = h * 0.55, roofB = h * 0.47, frontTop = h * 0.78;
    const leanHi = h * 0.47, leanLo = h * 0.35;
    const sx = fh * 0.92, yB = -fh * 0.90, yW = fh * 0.30, yFF = fh * 0.36, yL = fh * 1.10;
    const lx0 = -fh * 0.98, lx1 = fh * 0.98;
    // 1) THE SHED and its tall false front, both galvanised corrugated sheet, and the shed's own
    //    roof, one sheet falling to the back.
    { const [cx, cy] = F(0, (yB + yW) / 2); draw3DBoxAt(ctx, cam, cx, cy, sx, 0, shedTop, pal, seed, night, alpha, true, yaw, (yW - yB) / 2); }
    { const [cx, cy] = F(0, (yW - fh * 0.02 + yFF) / 2); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.96, 0, frontTop, pal, seed + 1, night, alpha, true, yaw, (yFF - yW + fh * 0.02) / 2); }
    tcFlat(ctx, cam, W3, [[-fh * 0.97, yFF + 0.003, frontTop], [fh * 0.97, yFF + 0.003, frontTop], [fh * 0.97, yFF + 0.003, frontTop - h * 0.02], [-fh * 0.97, yFF + 0.003, frontTop - h * 0.02]], [0, 1, 0], [168, 172, 170], 'metal', alpha, dn);   // the flashing along the top
    const yR = yB - fh * 0.04, roofZ = (y) => roofF + (roofB - roofF) * (y - yW) / (yR - yW);
    tcFlat(ctx, cam, W3, [[-sx - fh * 0.03, yW, roofF], [sx + fh * 0.03, yW, roofF], [sx + fh * 0.03, yR, roofB], [-sx - fh * 0.03, yR, roofB]], [0, -0.12, 1], TIN, 'metal', alpha, dn);
    for (const s of [-1, 1]) tcFlat(ctx, cam, W3, [[s * sx, yW, shedTop], [s * sx, yW, roofF], [s * sx, yB, roofB], [s * sx, yB, shedTop]], [s, 0, 0], TIN, 'metal', alpha, dn);
    // ⚠ WIRES ON TOP OF A ROOF ARE DRAWN ONLY FROM ABOVE IT. A stroke is pulled toward the eye to win
    // its depth tie, and from under the lean-to that pull takes a seam through the sheet and across
    // the board on its front edge (`signfit`).
    const above = (z) => (cam.EH || 0) > z;
    if (near && above(roofF)) for (let k = 1; k < 8; k++) {
      const x = -sx + 2 * sx * k / 8;
      emitWire(ctx, cam, W3(x, yW, roofF + 0.002), W3(x, yR, roofB + 0.002), 1, 'rgba(92,96,98,0.85)', alpha, { pull: 0.01 });
    }
    // 2) THE LEAN-TO: sheets off the false front on three timber posts, which is the front room
    //    the prose is about. Five sheets from five places: galvanised, a rusted one, an older one
    //    gone dull, and one somebody painted green for something else. Its underside is dark, and
    //    the strip is screwed to it.
    const leanZ = (y) => leanHi + (leanLo - leanHi) * (y - yFF) / (yL - yFF);
    const SHEETS = [TIN, [128, 86, 60], [112, 114, 110], [72, 98, 76], TIN];
    for (let i = 0; i < 5; i++) {
      const a = lx0 + (lx1 - lx0) * i / 5, b = lx0 + (lx1 - lx0) * (i + 1) / 5;
      tcFlat(ctx, cam, W3, [[a, yFF, leanHi], [b, yFF, leanHi], [b, yL, leanLo], [a, yL, leanLo]], [0, 0.35, 1], SHEETS[i], 'metal', alpha, dn);
      if (near && above(leanHi)) for (const t of [0.25, 0.5, 0.75]) {
        const x = a + (b - a) * t;
        emitWire(ctx, cam, W3(x, yFF, leanHi + 0.002), W3(x, yL, leanLo + 0.002), 1, 'rgba(70,72,74,0.7)', alpha, { pull: 0.01 });
      }
    }
    tcFlat(ctx, cam, W3, [[lx0, yFF, leanHi - 0.004], [lx1, yFF, leanHi - 0.004], [lx1, yL, leanLo - 0.004], [lx0, yL, leanLo - 0.004]], [0, -0.35, -1], [62, 64, 66], 'metal', alpha, dn);
    for (const u of [-0.92, 0.34, 0.92]) { const [px, py] = F(fh * u, yL - fh * 0.05); draw3DBoxAt(ctx, cam, px, py, fh * 0.028, 0, leanLo, 'ty_2cell_crate', seed + 3, night, alpha, true); }
    // 3) THE BOARD over the door, hand-lettered, along the front edge of the lean-to, which is where
    //    "over the door" is from the pavement.
    { const z0 = h * 0.295, z1 = leanLo + h * 0.008, y = yL + 0.004;
      tcFlat(ctx, cam, W3, [[lx0, y, z1], [lx1, y, z1], [lx1, y, z0], [lx0, y, z0]], [0, 1, 0], [198, 186, 152], 'timber', alpha, dn);
      if (frontVis) {
        const P = (u, z) => { const [wx, wy] = F(u, y + FACE_EPS); return cam.proj(wx, wy, z); };
        const q = [P(lx0 + fh * 0.05, z1 - h * 0.006), P(lx1 - fh * 0.05, z1 - h * 0.006), P(lx1 - fh * 0.05, z0 + h * 0.006), P(lx0 + fh * 0.05, z0 + h * 0.006)];
        const tex = bakeSignText("IF IT KEEPS YOU BREATHING, WE'VE GOT IT", '#8c2a1c', 0, false, true, true, { font: 'marker' });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      } }
    // 4) THE NAME, once, and the mark: yellow stencil on a sheet painted black and bolted across the
    //    false front, and the two cells beside it on a salvaged lightbox. After dark the box is lit
    //    and its charge bars fill one at a time, which is a charger doing its job.
    { const z0 = h * 0.52, z1 = h * 0.74, y = yFF + 0.003, x0 = -fh * 0.90, x1 = fh * 0.90, e = fh * 0.02;
      tcFlat(ctx, cam, W3, [[x0 - e, y, z1 + h * 0.01], [x1 + e, y, z1 + h * 0.01], [x1 + e, y, z0 - h * 0.01], [x0 - e, y, z0 - h * 0.01]], [0, 1, 0], [150, 156, 158], 'metal', alpha, dn);
      tcFlat(ctx, cam, W3, [[x0, y + 0.001, z1], [x1, y + 0.001, z1], [x1, y + 0.001, z0], [x0, y + 0.001, z0]], [0, 1, 0], [24, 26, 28], 'plain', alpha, dn);
      const m0 = z0 + (z1 - z0) * 0.06, m1 = z1 - (z1 - z0) * 0.06, L = m1 - m0, a = x0 + fh * 0.03, b = a + L;
      if (frontVis) {
        const P = (u, z) => { const [wx, wy] = F(u, y + 0.002 + FACE_EPS); return cam.proj(wx, wy, z); };
        const lit = dn > 0.5, bars = lit && motionOn() ? Math.floor((now || 0) / 650) % 5 : 4;
        const logo = twoCellLogoTex(bars, lit);
        const ql = [P(a, m1), P(b, m1), P(b, m0), P(a, m0)];
        if (logo && ql.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, ql, logo, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
        const n0 = b + fh * 0.05, n1 = x1 - fh * 0.03;
        const tex = bakeSignText(sign || 'TWO-CELL SUPPLY', '#f2c94c', 0, false, true, true, { font: 'stencil', fit: (n1 - n0) / L });
        const qn = [P(n0, m1), P(n1, m1), P(n1, m0), P(n0, m0)];
        if (tex && qn.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, qn, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
      if (dn > 0.5) { const [gx, gy] = F((a + b) / 2, y + fh * 0.03); glowPool(ctx, cam, gx, gy, (m0 + m1) / 2, '159,232,255', 9, alpha * 0.5 * dn, { air: true }); }
      // Two lamps on goosenecks over the board, so the name can be read after dark.
      for (const u of [-0.10, 0.62]) {
        if (near) emitWire(ctx, cam, W3(fh * u, y, z1 + h * 0.03), W3(fh * u, y + fh * 0.07, z1 + h * 0.022), 1.6, 'rgba(48,50,52,0.95)', alpha, { pull: 0.02 });
        if (dn > 0) { const [gx, gy] = F(fh * u, y + fh * 0.07); glowPool(ctx, cam, gx, gy, z1 + h * 0.01, '150,160,170', 8, alpha * 0.45 * dn); }
      } }
    // 5) THE DOOR, standing open, and the room behind it lit by the strip whatever the hour.
    { const x0 = -fh * 0.20, x1 = fh * 0.20, top = h * 0.29, y = yFF + 0.003, e = fh * 0.025;
      tcFlat(ctx, cam, W3, [[x0 - e, y, top + h * 0.02], [x1 + e, y, top + h * 0.02], [x1 + e, y, 0.002], [x0 - e, y, 0.002]], [0, 1, 0], [96, 78, 54], 'timber', alpha, dn);
      tcGlow(ctx, cam, W3, [[x0, y + 0.001, top], [x1, y + 0.001, top], [x1, y + 0.001, 0.002], [x0, y + 0.001, 0.002]], [0, 1, 0], [58, 66, 64], [176, 222, 210], dn, alpha);
      const [gx, gy] = F(0, y + fh * 0.06); glowPool(ctx, cam, gx, gy, top * 0.6, '196,240,226', 10, alpha * (0.18 + 0.40 * dn), { air: true }); }
    // 6) THE STOCK: a pegboard either side of the door hung with torches, cell packs and coils,
    //    and crates stacked in front of it, which is "every nail in reach" from the street.
    for (const [b0, b1] of [[-0.88, -0.28], [0.28, 0.88]]) {
      const y = yFF + 0.003, z0 = h * 0.10, z1 = h * 0.28;
      tcFlat(ctx, cam, W3, [[fh * b0, y, z1], [fh * b1, y, z1], [fh * b1, y, z0], [fh * b0, y, z0]], [0, 1, 0], [150, 128, 96], 'timber', alpha, dn);
      if (!near) continue;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
        const u = fh * (b0 + (b1 - b0) * (c + 0.5) / 5), z = z0 + (z1 - z0) * (r + 0.5) / 3, kind = (c + r * 2 + (b0 > 0 ? 1 : 0)) % 3;
        const yi = y + 0.002, w = fh * 0.035, hh = h * 0.022;
        if (kind === 0) {   // a torch, hung by its lanyard, lens down
          tcFlat(ctx, cam, W3, [[u - w * 0.5, yi, z + hh], [u + w * 0.5, yi, z + hh], [u + w * 0.5, yi, z - hh], [u - w * 0.5, yi, z - hh]], [0, 1, 0], [40, 42, 46], 'metal', alpha, dn);
          tcFlat(ctx, cam, W3, [[u - w * 0.7, yi + 0.001, z - hh * 0.6], [u + w * 0.7, yi + 0.001, z - hh * 0.6], [u + w * 0.7, yi + 0.001, z - hh * 1.1], [u - w * 0.7, yi + 0.001, z - hh * 1.1]], [0, 1, 0], [196, 200, 196], 'metal', alpha, dn);
        } else if (kind === 1) {   // a blister of cells, yellow over black
          tcFlat(ctx, cam, W3, [[u - w, yi, z + hh], [u + w, yi, z + hh], [u + w, yi, z], [u - w, yi, z]], [0, 1, 0], [214, 172, 44], 'plain', alpha, dn);
          tcFlat(ctx, cam, W3, [[u - w, yi, z], [u + w, yi, z], [u + w, yi, z - hh], [u - w, yi, z - hh]], [0, 1, 0], [34, 34, 36], 'plain', alpha, dn);
        } else {   // a coil of cell cable, copper
          const R = fh * 0.032;
          for (let i = 0; i < 6; i++) {
            const a0 = i / 6 * 6.2832, a1 = (i + 1) / 6 * 6.2832;
            emitWire(ctx, cam, W3(u + Math.cos(a0) * R, yi + 0.002, z + Math.sin(a0) * R), W3(u + Math.cos(a1) * R, yi + 0.002, z + Math.sin(a1) * R), 1.6, 'rgba(184,112,58,0.95)', alpha, { pull: 0.015 });
          }
        }
      }
    }
    { const [cx, cy] = F(-fh * 0.62, yFF + fh * 0.20);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.15, 0, h * 0.11, 'ty_2cell_crate', seed + 4, night, alpha, true);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.11, h * 0.11, h * 0.20, 'ty_2cell_crate', seed + 5, night, alpha, true, yaw + 0.3); }
    { const [cx, cy] = F(fh * 0.60, yFF + fh * 0.18);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.13, 0, h * 0.09, 'ty_2cell_crate', seed + 6, night, alpha, true, yaw - 0.15); }
    // An A-board by the right-hand post, chalked with the shop's one guarantee. ⚠ NOT ON THE NEAR
    // TIER: its board is in the mesh at every distance, so lettering it only up close leaves a blank
    // board down the street (`signrange`).
    { const ya = yL - fh * 0.14, yb = yL - fh * 0.06, xa = fh * 0.50, xb = fh * 0.74, zt = h * 0.11;
      tcFlat(ctx, cam, W3, [[xa, ya, zt], [xb, ya, zt], [xb, yb, 0.002], [xa, yb, 0.002]], [0, 0.6, 0.3], [38, 44, 40], 'timber', alpha, dn);
      if (frontVis) {
        const P = (u, t) => { const [wx, wy] = F(u, ya + (yb - ya) * t + FACE_EPS); return cam.proj(wx, wy, zt * (1 - t)); };
        const q = [P(xa + fh * 0.02, 0.12), P(xb - fh * 0.02, 0.12), P(xb - fh * 0.02, 0.88), P(xa + fh * 0.02, 0.88)];
        const tex = bakeSignText('TORCHES', '#e8e6dc', 0, false, true, true, { font: 'marker', sub: 'TESTED. MOSTLY.' });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      } }
    // 7) THE STRIP: salvaged emergency fittings screwed to the underside of the lean-to. They are
    //    drawn lit by day as well, because they are.
    for (const u of [-0.66, -0.22, 0.22, 0.66]) {
      const y0 = fh * 0.74, y1 = fh * 0.80, za = leanZ(y0) - 0.008, zb = leanZ(y1) - 0.008;
      tcGlow(ctx, cam, W3, [[fh * (u - 0.09), y0, za], [fh * (u + 0.09), y0, za], [fh * (u + 0.09), y1, zb], [fh * (u - 0.09), y1, zb]], [0, 0, -1], STRIP, STRIP, dn, alpha);
    }
    // ⚠ THE HALO IS `air` AND THE WASH IS A DIM COLOUR, because a glow's reach on the GPU comes from
    // how bright its colour is. At full strength the strip's own glow lit the road white for three
    // tiles; this lights the front room, the crates and the posts, and stops at the kerb.
    { const [gx, gy] = F(0, fh * 0.86), z = leanZ(fh * 0.86) - h * 0.05;
      glowPool(ctx, cam, gx, gy, z, '196,240,226', 14, alpha * (0.22 + 0.48 * dn), { air: true });
      glowPool(ctx, cam, gx, gy, z, '84,112,104', 10, alpha * (0.30 + 0.60 * dn)); }
    // 8) THE ROOF CHARGES THE STOCK: three salvaged solar panels on angle frames tilted at the
    //    street, and a wind wheel on a pole in the back corner, wired down into the shed.
    for (const u of [-0.58, 0.0, 0.58]) {
      const ya = -fh * 0.06, yb = -fh * 0.50, za = roofZ(ya) + h * 0.012, zb = roofZ(yb) + h * 0.07;
      tcFlat(ctx, cam, W3, [[fh * (u - 0.26), ya, za], [fh * (u + 0.26), ya, za], [fh * (u + 0.26), yb, zb], [fh * (u - 0.26), yb, zb]], [0, 0.6, 1], [40, 58, 96], 'glass', alpha, dn);
      if (near && above(roofF)) {
        for (const t of [1 / 3, 2 / 3]) emitWire(ctx, cam, W3(fh * (u - 0.26), ya + (yb - ya) * t, za + (zb - za) * t + 0.002), W3(fh * (u + 0.26), ya + (yb - ya) * t, za + (zb - za) * t + 0.002), 1, 'rgba(176,186,196,0.85)', alpha, { pull: 0.01 });
        for (const s of [-0.22, 0.22]) emitWire(ctx, cam, W3(fh * (u + s), yb, zb), W3(fh * (u + s), yb, roofZ(yb)), 1.4, 'rgba(88,92,96,0.95)', alpha, { pull: 0.02 });
      }
    }
    { const wx = fh * 0.74, wy = -fh * 0.76, top = h * 1.02, [px, py] = F(wx, wy);
      emitWire(ctx, cam, W3(wx, wy, roofZ(wy)), W3(wx, wy, top), 2, 'rgba(84,88,92,0.95)', alpha, { pull: 0.02 });
      emitWire(ctx, cam, W3(wx, wy, top - h * 0.04), W3(fh * 0.58, -fh * 0.50, roofZ(-fh * 0.50) + h * 0.07), 1, 'rgba(30,30,32,0.9)', alpha, { pull: 0.02 });
      windWheel(ctx, cam, px, py, top, fh * 48, now, alpha, seed); }   // radius in the same px·tile units The Reach's mill uses
  },
  fallow(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // FALLOW PROVISIONS — a roadside stand on ground that has gone back to
    // grassland, on the buried kerb of a road that used to matter. It has no interior and no walls;
    // it is a trestle under a canvas fly, and building it as a shop box would be a lie about the tile.
    const post = h * 0.70, fly = h * 0.80;
    // 1) THE FLY — canvas on four poles. The entire structure.
    for (const tx of [-1, 1]) for (const ty of [-1, 1]) { const [px, py] = F(tx * fh * 0.66, ty * fh * 0.50);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, post, 'ty_2cell_crate', seed + 2 + tx + ty, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, post, fly, 'ty_fallow_canvas', seed, night, alpha, true);
    // 2) THE TRESTLE and the crates on it, and two sacks leaned against a leg.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.56, h * 0.22, h * 0.28, 'ty_2cell_crate', seed + 8, night, alpha, true);
    for (const [i, lx] of [[0, -0.34], [1, 0.02], [2, 0.36]]) { const [cx, cy] = F(lx * fh, 0);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.13, h * 0.28, h * (0.40 + frac(seed + i) * 0.06), 'ty_fallow', seed + 12 + i, night, alpha, true); }
    { const [sx, sy] = F(-fh * 0.62, fh * 0.34);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.14, 0, h * 0.24, 'ty_fallow_canvas', seed + 20, night, alpha, true); }
    // 3) A hand-painted board propped at the roadside, and nothing lit at all — there is no power
    //    out here and a glowing sign would be the wrong answer to 'how do people find it'.
    { const [bx, by] = F(fh * 0.36, fh * 0.86);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.03, 0, h * 0.30, 'ty_2cell_crate', seed + 24, night, alpha, false);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, h * 0.30, h * 0.48, 'ty_fallow_canvas', seed + 25, night, alpha, true, 0.18, fh * 0.03); }
  },
  vacantunit(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE NUMBERED UNITS (Kessler, Marrow ×2, Voss) — four empty ex-tenant
    // shells owned by the same landlord, and LOOKING ALIKE IS CORRECT for them: they are one
    // building type doing one thing, which is standing empty. So this is deliberately a single
    // shared model, and what differs between them is the STATE of the dereliction.
    //
    // ⚠ WHAT IS EMPTY IS THE GROUND FLOOR, AND THIS ARM DREW THE WHOLE BUILDING EMPTY. It was a
    // free-standing lock-up: a box to 0.78h with a shopfront taking 0.66 of it, which on a
    // 3-floor `shop` is a building 0.46 tiles tall wearing a storey-and-a-half-high door. Every
    // one of the four says the opposite in its own prose — Kessler is "a corner unit UNDER THREE
    // FLOORS OF FLATS", Voss is "set into the parade", Marrow 4 is "wedged between the studio
    // blocks", Marrow 9 is "at the pawn end of the street" — so the shop is shut and the block
    // over it is lived in, which is also the only reason any of them is lit after dark.
    //
    // ⚠ AND THAT IS THE WHOLE OF "THE SIGNAGE IS BLOCKED OUT", WHICH IS NOT A SIGNAGE BUG. A name
    // needs a band of clear wall and this arm left none: the shopfront ran to 1.55 storeys, the
    // roofline sat at 2.35, and the only strip the kit could letter was the sliver between them
    // under the parapet. Nothing here moves a sign — the wall under it is built, and the fascia
    // then lands where a fascia goes, above the shopfront and below the first-floor windows.
    // That band is `reserveSignBand`ed below so nothing the kit hangs can cross it.
    //
    // ⚠ THE UPPER STOREYS ARE THE KIT'S AND ARE DELIBERATELY NOT AUTHORED HERE. Two authored
    // `windowBay`s would claim the `wall` section outright (see SECTION_MIN) and this arm would
    // then own the glazing, the lighting and the floor count of every block it is dropped into —
    // for four buildings whose blocks are 2, 3, 4 and 8 storeys in four different streets. The
    // kit already grids, lights and ages a facade off `mod` and the seed; what it could not do
    // was find a facade, because there wasn't one.
    const wallTop = h * 0.94, parapet = h * 1.00;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, wallTop, parapet, 'ty_unit_shut', seed + 1, night, alpha, true);
    // THREE STATES. Shutter down / whitewashed glass / grille over broken glass — the whole
    // variation budget, because a bespoke silhouette each would say they are four businesses.
    //
    // ⚠ AND THE STATE IS AUTHORED PER UNIT NOW, NOT `seed % 3`. The seed is the TILE's, so which
    // dereliction a unit wore was an accident of its grid coordinate, and three of the four
    // landed on one their own prose contradicts — Kessler's says "the shutter is down" and its
    // tile rolled the gutted-glass state. `m.unit` is read off the registry beside `pal`, which
    // is where the rest of a building's authored facts already live.
    const st = ['shutter', 'whitewash', 'grille'].indexOf(m.unit || 'shutter');
    // ⚠ EVERY ONE OF THESE IS A SHALLOW FITTING WITH A LID ON IT, AND ALL THREE WERE DEEP BOXES
    // WITH OPEN TOPS. A shopfront here is authored at `fh * 0.90` with no `fd`, so it was a SQUARE
    // box half a tile deep — the house idiom from before `tileFitBox` existed, when the front face
    // landed a tile and a half into the street and the painter's queue sorted it clear of
    // everything. Trimmed back to the plot line it became a solid standing 0.15 of a tile proud of
    // the facade with nothing on top: on the depth buffer you look down INTO it, and it buried two
    // thirds of the building's own painted name (which section 3c now lifts over anyway — the two
    // fixes are independent, and this one is what was actually reported).
    // A real `fd` is what makes it a shutter, a board and a shopfront rather than three blocks;
    // `roof` is the lid. ⚠ AND THE DEPTHS KEEP THEM OFF `deck`: that list takes a box with a roof
    // whose footprint is within 0.02 of square, so a lid on the old square boards would have stood
    // a coping band on one of them.
    //
    // ⚠ AND THE LID WAS ONLY HALF OF IT — A PANEL ALSO HAS TO STAND ON THE GROUND AND IN THE PLANE
    // OF ITS OWN WALL. `fh * 0.90` is a CENTRE, so with the depths below it the front face landed
    // at 0.95–1.00 against a facade at 0.86: an eighth of a tile of frontage out over the pavement
    // with nothing under it. Two of the three also started part way UP the wall (`wallTop * 0.10`,
    // `wallTop * 0.16`), which the painter's queue hid and a depth buffer does not — a slab in the
    // air with its open underside showing. Reported, in those words, as "a floating roller door
    // and a small piece that juts out for no reason".
    //
    // ⚠ THE CENTRE IS SOLVED FROM THE FACE RATHER THAN CHOSEN, which is what stops it coming back:
    // `FRONT` is where the outer skin has to land and each state centres at `FRONT - fd`, so
    // changing a depth can never push the frontage into the street again. It stands a fiftieth of
    // a tile proud rather than flush, because coplanar with the wall is a z-fight and this is the
    // smallest offset that is not one.
    //
    // ⚠ AND THIS PANEL IS WHAT THE DERIVED KIT HANGS THE WHOLE GROUND FLOOR ON. `base` is the
    // LOWEST-TOPPED candidate box, which is this one — so its z0 is the pavement the roller door
    // stands on, its front face is the plane that door is drawn in, and its half-width has to
    // clear the kit's `base.hw > 0.1` or the ground floor is declined AND the name with it (3b and
    // 3c are both inside that block). The boarded state was three separate `fh * 0.22` boards,
    // which is 0.088 — so that unit has been standing there with no door, no window and no
    // lettering on any of its three elevations. One panel CARRIES the boards now instead of being
    // them, and the boards are lifted clear of its own top edge so they cannot take `base` off it.
    // ⚠ THE SHOPFRONT IS A STOREY, NOT A FRACTION OF THE BLOCK. `wallTop * 0.66` made the door
    // taller every time the building over it gained a floor, which is what produced the
    // storey-and-a-half roller shutter. A storey here is `h / floors` and every one of the four
    // is a `shop` (3), so 0.30h is one — and a unit given a fourth floor gets a grander corner
    // shopfront rather than a broken one. ⚠ IT MAY NOT BE `storeyZ()`, tempting as that reads:
    // an absolute is a `c` term the capture solves fine and then warns about on every bake, and
    // a constant is exactly what a modelling slip looks like. Affine in h, and no constant.
    // ── THE FRONTAGE, AS A LADDER OF PLANES ────────────────────────────────────────────────
    //
    // Four surfaces share this one face — the wall, the arm's reveal, the roller curtain the
    // detail list draws, and whatever the unit's own state hangs on it. On the painter they sort
    // by `DETAIL_LIFT` and the order is free; on a depth buffer they COMPARE, and two at one
    // plane is a z-fight rather than a missing part, which is the one defect here that would
    // read as a driver bug. So the planes are stated once, in order, and every part below is
    // placed off this ladder rather than off a number somebody picked at the call site:
    //
    //     0.86 fh  the wall            (the mass box above)
    //     0.88 fh  the reveal          — the recess the shopfront is set into
    //     0.90 fh  the curtain         — the `shutter` in D_VACANT, drawn by the detail layer
    //     0.92 fh  the state's own surface
    //     0.94 fh  the grille bars
    //     0.95 fh  the letting notice
    // ── …AND THE FRONTAGE IS NOT ALL SHOP ──────────────────────────────────────────────────
    //
    // A walk-up over a shop has its own street door beside the shop's, and it is the one thing
    // at pavement level that says anybody lives here. Without it the whole ground floor is a
    // shut roller door and there is no way into a building with nine windows lit in it.
    // ⚠ `SHOPW` AND `SHOPX` ARE STATED HERE AND MIRRORED IN D_VACANT'S `shutter`. The curtain is
    // a detail part and the reveal under it is mass, so the two are authored in different places
    // and will silently drift apart — the door then overlaps the shutter and reads as a patch on
    // it rather than as a door.
    const FRONT = fh * 0.88, panelTop = h * 0.30;
    const SHOPW = fh * 0.48, SHOPX = fh * -0.13, DOORX = fh * 0.52;
    if (frontVis) {
      // The reveal. One palette for every state, because it is the hole rather than what is in
      // it, and the depth is what makes the frontage read as set back rather than painted on.
      { const [px, py] = F(SHOPX, FRONT - fh * 0.10);
        draw3DBoxAt(ctx, cam, px, py, SHOPW, 0, panelTop, 'ty_unit_shut', seed + 4, night, alpha, true, 0, fh * 0.10); }
      // The street door, recessed in its own reveal, with the stair light over it. ⚠ THE FANLIGHT
      // IS THE ONLY THING ON THIS ELEVATION THAT BURNS ALL NIGHT and it is deliberately the
      // cheapest part here: a communal stair light nobody can switch off is what a building full
      // of flats over a dead shop looks like from the street at four in the morning, and it is
      // the one lamp that may be on when the fascia is paint and the shopfront is shut.
      { const [dxp, dyp] = F(DOORX, FRONT - fh * 0.055);
        draw3DBoxAt(ctx, cam, dxp, dyp, fh * 0.155, 0, panelTop * 0.80, 'ty_unit_shut', seed + 30, night, alpha, true, 0, fh * 0.055);
        const [fx, fy] = F(DOORX, fh * 0.91);
        draw3DBoxAt(ctx, cam, fx, fy, fh * 0.135, panelTop * 0.82, panelTop * 0.94, night ? 'ty_ff_white' : 'ty_tomb_glass', seed + 31, night, alpha, false, 0, fh * 0.010);
        if (night) glowPool(ctx, cam, fx, fy, panelTop * 0.88, '250,228,168', 5, alpha * 0.22); }
      // ⚠ THE SHUTTER STATE ADDS NOTHING HERE, AND THAT IS THE POINT. D_VACANT's curtain is
      // already the closure, with the slats the detail painter draws, so Kessler and Marrow 9 —
      // "the shutter is down", "its roller door tagged twice over" — are finished at this line.
      // The other two states are a surface laid OVER that curtain, which is why they win on both
      // renderers instead of relying on a sort order only one of them has.
      if (st !== 0) { const [gx, gy] = F(0, fh * 0.92 - fh * 0.012);
        draw3DBoxAt(ctx, cam, gx, gy, fh * 0.58, panelTop * 0.06, panelTop * 0.96,
          st === 1 ? 'ty_unit_wash' : 'ty_tomb_glass', seed + 5, night, alpha, true, 0, fh * 0.012); }
      // Voss's grille: the prose is "the security grille is intact and the glass behind it is not",
      // so the bars go OVER the glass rather than instead of it — five uprights standing clear of
      // the pane, which is the only reading in which both halves of that sentence are true.
      //
      // ⚠ AND THEY ARE GALVANISED STEEL, NOT THE SHUTTER'S PAINT. `ty_unit_shut` is [70,68,64]
      // against glass at [38,40,44] — a dark bar on a dark pane, drawn and invisible, which is
      // the detail-parts-need-their-own-palette trap. `ty_wh_metal` is fifty values lighter and
      // in the `metal` family, so a structural bar is never handed a window grid.
      if (st === 2) for (const [i, lx] of [[0, -0.44], [1, -0.22], [2, 0.00], [3, 0.22], [4, 0.44]]) {
        const [bx, by] = F(lx * fh, fh * 0.94);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.030, panelTop * 0.02, panelTop * 0.99, 'ty_wh_metal', seed + 6 + i, night, alpha, false, 0, fh * 0.012);
      }
    }
    // ── THE FASCIA, AND THE NAME ON IT ─────────────────────────────────────────────────────
    //
    // The band over the shopfront and under the first-floor sills. `reserveSignBand` is called
    // BEFORE anything else reaches the frontage so nothing the kit hangs may cross the lettering
    // — the same order `bodega` uses, and the reason the name here cannot come back buried.
    // ⚠ THE WIDTH SETS THE DEPTH — see marqueeSpan, where `hh` is `clamp(half * 0.26, …)`. At
    // `fh * 0.60` the band came out 0.128 of a tile deep against a 0.177 shopfront, which is
    // three quarters of the ground floor in fascia and reads as a hoarding bolted over the shop
    // rather than as the shop's own sign. This lands it on the 0.045 floor, so the board is a
    // sixth of the elevation and the flats over it keep a storey and a half of wall.
    const vuSgnW = fh * 0.48, vuSgnZ = panelTop + h * 0.075;
    const vuRoom = { floor: panelTop, wallTop, wall: fh * 0.86 };
    reserveSignBand(vuSgnW, vuSgnZ, vuRoom);
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, vuSgnW, vuSgnZ, m.neon || '#c8c0aa', night, alpha, undefined, vuRoom);
    // ── THE LETTING NOTICE ──────────────────────────────────────────────────────────────────
    //
    // A board over the parapet was the one thing all four shared, and from the street — which is
    // the only place anybody reads a letting notice — it crested the roofline at a seeded angle
    // and read as a chimney. All four prose blocks put the notice at the door: yellowed on the
    // shutter, taped to the glass at a hopeful angle, cable-tied to the handle, LET AS SEEN. So
    // it is a sheet on the frontage beside the door, skewed off the seed, at eye height.
    //
    // ⚠ AND IT IS PAPER, NOT PLYWOOD. `ty_unit_board` is the tan of the boarding, eight values
    // off the shutter it would be taped to — a notice drawn and unreadable is the same defect as
    // the grille bars above. `ty_ff_white` is a hundred and thirty values lighter, which is what
    // makes it read as a sheet of paper somebody put up rather than as a patch of the door.
    if (frontVis) { const g = frac(seed * 11);
      const [nx, ny] = F(fh * (0.34 - g * 0.10), fh * 0.95);
      draw3DBoxAt(ctx, cam, nx, ny, fh * 0.12, panelTop * 0.34, panelTop * 0.70, 'ty_ff_white', seed + 20, night, alpha, false, (g - 0.5) * 0.14, fh * 0.008); }
  },
  papertomb(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // HALL OF RECORDS (Hall of Records, Coldwater Municipal) — the twin of
    // Precinct 9 on the `police` mesh, one door up the same street, and it is the opposite building:
    // poured concrete with TALL DARK WINDOWS and no beacon, no antenna, no blue light. Nothing about
    // it is on. What it has instead is a chiselled lintel and a brass slot nobody has emptied.
    const plinth = h * 0.14, wallTop = h * 0.92, cornice = h * 1.02;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, plinth, 'ty_tomb', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, plinth, wallTop, pal, seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, wallTop, cornice, 'ty_tomb', seed + 2, night, alpha, true);
    // 1) THE TALL WINDOWS — four narrow full-height slots, DARK. A records hall at night is a
    //    building with nobody in it, and lighting these would make it a working office.
    if (frontVis) for (const [i, lx] of [[0, -0.54], [1, -0.18], [2, 0.18], [3, 0.54]]) {
      const [wx, wy] = F(lx * fh, fh * 0.92);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.11, plinth + h * 0.16, wallTop - h * 0.10, 'ty_tomb_glass', seed + 10 + i, night, alpha, false);
    }
    // 2) THE PORTICO — a heavy lintel slab on two square piers, set back off the street.
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.34, fh * 1.14);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.13, 0, h * 0.66, 'ty_tomb', seed + 20 + t, night, alpha, false); }
    { const [lx, ly] = F(0, fh * 1.14);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.52, h * 0.66, h * 0.80, 'ty_tomb', seed + 24, night, alpha, true); }
    // 3) THE BRASS SLOT beside the door. One small bright thing on an entirely grey building, and
    //    the only reason to look at the frontage at all.
    { const [sx, sy] = F(fh * 0.26, fh * 0.96);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.09, h * 0.30, h * 0.40, 'ty_tomb_brass', seed + 30, night, alpha, false);
      glowPool(ctx, cam, sx, sy, h * 0.36, '212,176,96', 4, alpha * (night ? 0.20 : 0.10)); }
  },
  stitch(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // IRONSIDE WALK-IN CLINIC — the twin of Marrow Street Clinic on the `clinic` mesh, and the
    // difference between them is THE QUEUE: this one has a rail outside and ground worn bare along
    // it, because the line starts before dawn. The building is smaller and the demand is larger.
    const wallTop = h * 0.72, parapet = h * 0.82;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.84, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, wallTop, parapet, 'ty_stitch', seed + 1, night, alpha, true);
    // 1) REINFORCED GLASS — one wide front panel, lit dull green from behind rather than clear.
    if (frontVis) { const [gx, gy] = F(0, fh * 0.88);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.62, h * 0.14, wallTop * 0.82, 'ty_stitch_glass', seed + 2, night, alpha, true, 0, fh * 0.06);
      for (const [i, lx] of [[0, -0.30], [1, 0.00], [2, 0.30]]) { const [bx, by] = F(lx * fh, fh * 0.90);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.03, h * 0.14, wallTop * 0.82, 'ty_stitch', seed + 6 + i, night, alpha, false); } }
    // 2) THE QUEUE RAIL — a switchback of low rail off the door, and the bare ground under it.
    { const [ax, ay] = F(0, fh * 1.30);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.90, 0, h * 0.03, 'ty_unit_shut', seed + 12, night, alpha, true); }
    for (const [i, ly] of [[0, 1.06], [1, 1.52]]) { const [rx, ry] = F(0, ly * fh);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.84, h * 0.14, h * 0.18, 'ty_stitch', seed + 16 + i, night, alpha, true, 0, fh * 0.03); }
    // 3) THE GREEN CROSS, guttering — a small fitting over the door, not a marquee. It is failing,
    //    which is why it is drawn as one weak pool rather than a band of lit letters.
    //    It is a CROSS now rather than a lit box standing in for one — the fitting the clinic
    //    wears on its roof with the stand taken off, at a third of the tube, which is what
    //    guttering looks like once the enamel is the only part still doing its job.
    //    ⚠ AND IT STANDS ON THE PARAPET RATHER THAN ON THE FRONTAGE, WHICH IS NOT A PREFERENCE.
    //    Every plane on the front of this shop is already inside something: the parapet stands
    //    0.92 out and swallows anything nearer, and the reinforced glass is a box CENTRED at
    //    0.88 with a half-width of 0.62, so it reaches 1.50 into the street — a cross bolted to
    //    the shopfront is a cross seen dimly THROUGH the window it is supposed to be over. Set
    //    forward on the roofline it clears both, and it is over the door either way.
    { const [cx, cy] = F(0, fh * 0.58);
      roofCross(ctx, cam, cx, cy, E, parapet, Math.min(fh * 0.28, h * 0.16), '106,255,168', night, alpha,
        { lit: 0.34, frame: [120, 126, 118] }); }
  },
  campgiardia(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // CAMP GIARDIA — the twin of Grease Expectations on the `diner` mesh, and
    // it is not a building at all: a TARPAULIN OVER A BUS SHELL on the pond shore, a cook fire in a
    // cut-down drum, and a row of beans somebody planted. The streamline diner mesh was the single
    // worst mismatch in Coldwater — a chrome dining car standing in for a camp.
    const busTop = h * 0.60, tarp = h * 0.82;
    // 1) THE BUS — a long low body on the ground, wheels gone, sitting on its frame.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, h * 0.06, busTop, 'ty_giardia_bus', seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, h * 0.06, 'ty_unit_shut', seed + 1, night, alpha, false);
    // Window band down the bus flank — the one thing that says 'bus' from above.
    for (const t of [-1, 1]) { const [wx, wy] = F(t * fh * 0.76, 0);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.04, busTop * 0.58, busTop * 0.86, 'ty_tomb_glass', seed + 4 + t, night, alpha, false); }
    // 2) THE TARP over the lot, on two leaning poles, bigger than the bus. It is the roof.
    for (const [i, lx] of [[0, -0.94], [1, 0.94]]) { const g = frac(seed + i);
      const [px, py] = F(lx * fh, fh * 0.40);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, tarp - h * 0.04 * i, 'ty_giardia', seed + 8 + i, night, alpha, false, (g - 0.5) * 0.3); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, tarp, tarp + h * 0.04, 'ty_giardia_tarp', seed + 12, night, alpha, true);
    // 3) THE COOK FIRE — a cut-down drum with a grille over it. The only heat and the only light.
    { const [fx, fy] = F(fh * 0.66, fh * 0.86);
      drawFacetDrum(ctx, cam, fx, fy, 0, h * 0.26, fh * 0.13, fh * 0.13, 8, alpha,
        (f) => 'rgb(' + (72 + f.nl * 34 | 0) + ',' + (60 + f.nl * 28 | 0) + ',' + (48 + f.nl * 22 | 0) + ')', 'rgb(44,36,30)');
      glowPool(ctx, cam, fx, fy, h * 0.26, '255,146,58', 10, alpha * (night ? 0.66 : 0.22));
      drawSmoke(ctx, cam, fx, fy, h * 0.28, '188,182,170', alpha * 0.5, now, seed + 16); }
    // 4) THE BEAN ROW — six canes in a line. Somebody is planning to still be here in the autumn.
    for (let i = 0; i < 6; i++) { const [cx, cy] = F((-0.62 + i * 0.25) * fh, -fh * 0.86);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.02, 0, h * (0.24 + frac(seed * 5 + i) * 0.10), 'ty_fallow', seed + 30 + i, night, alpha, false); }
    // 5) The hand-lettered board. Warning or advertisement, depending on how hungry you are.
    { const [bx, by] = F(-fh * 0.50, fh * 0.94);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.03, 0, h * 0.34, 'ty_giardia', seed + 40, night, alpha, false);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.30, h * 0.34, h * 0.50, 'ty_giardia_tarp', seed + 41, night, alpha, true, 0.12, fh * 0.03); }
  },
  watts(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // WATTS THE DAMAGE — the twin of Marrow Street Hardware on the `hardware` mesh. The
    // difference is that Watts works IN THE STREET: the roller door is UP, the bench is pulled half
    // out of the shop, and the whole frontage is open. Marrow Street Hardware is a closed room full of drawers.
    const wallTop = h * 0.80, parapet = h * 0.90;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, wallTop, parapet, 'ty_watts_roller', seed + 1, night, alpha, true);
    // 1) THE ROLLER, UP — a rolled drum of shutter under the head, not a slab over the opening.
    if (frontVis) { const [rx, ry] = F(0, fh * 0.90);
      drawFacetDrum(ctx, cam, rx, ry, wallTop * 0.72, wallTop * 0.88, fh * 0.10, fh * 0.10, 8, alpha,
        (f) => 'rgb(' + (96 + f.nl * 44 | 0) + ',' + (84 + f.nl * 40 | 0) + ',' + (56 + f.nl * 26 | 0) + ')', 'rgb(62,52,34)');
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.66, 0, wallTop * 0.70, 'ty_grind', seed + 4, night, alpha, true, 0, fh * 0.08); }
    // 2) THE BENCH, HALF IN THE STREET — the building's whole personality, and it crosses the
    //    building line, which nothing else on the strip does.
    { const [bx, by] = F(0, fh * 1.20);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.46, h * 0.20, h * 0.28, 'ty_watts_roller', seed + 8, night, alpha, true);
      for (const t of [-1, 1]) { const [lx, ly] = F(t * fh * 0.40, fh * 1.20);
        draw3DBoxAt(ctx, cam, lx, ly, fh * 0.05, 0, h * 0.20, 'ty_grind', seed + 10 + t, night, alpha, false); } }
    // 3) A work lamp on a stalk over the bench, and a spool of cable running back inside.
    { const [lx, ly] = F(fh * 0.38, fh * 1.20);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, h * 0.28, h * 0.74, 'ty_grind', seed + 14, night, alpha, false);
      glowPool(ctx, cam, lx, ly, h * 0.72, '255,232,180', 9, alpha * (night ? 0.62 : 0.20)); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.74, parapet * 0.96, m.neon || '#ffcf3e', night, alpha, 'WATTS THE DAMAGE');
  },
  hulls(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // LEVER LANE BOATYARD — the twin of Kessler Street Wharf on the `wharf` mesh, and the joke
    // is that it is a BOAT SHED A QUARTER-MILE FROM ANY WATER. So it gets the one thing the working
    // wharf hasn't: mast-height doors, shut, on dry ground, with no crane and no water anywhere.
    const doorTop = h * 1.36, ridge = h * 1.52;
    // 1) THE SHED — tall and narrow, which is a proportion driven entirely by a mast.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, 0, doorTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, doorTop, ridge, 'ty_hulls_door', seed + 1, night, alpha, true);
    // 2) THE DOORS — two leaves the full height of the wall, shut but for a gap. The gap is the
    //    detail: they have not been fully opened in living memory, and one is always ajar.
    if (frontVis) for (const [i, t] of [[0, -1], [1, 1]]) {
      const [dx2, dy2] = F(t * fh * (0.34 + i * 0.04), fh * 0.78);
      draw3DBoxAt(ctx, cam, dx2, dy2, fh * 0.30, 0, doorTop * 0.94, 'ty_hulls_door', seed + 4 + i, night, alpha, true, 0, fh * 0.07);
    }
    if (frontVis) { const [gx, gy] = F(0, fh * 0.80);
      glowPool(ctx, cam, gx, gy, doorTop * 0.34, '255,196,132', 5, alpha * (night ? 0.34 : 0.12)); }   // the gap, lit from inside
    // 3) THE PLANK — the name cut into a board above the doors. It took someone a whole winter,
    //    so it is a carved plank and not a lit sign.
    { const [px, py] = F(0, fh * 0.80);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.62, doorTop * 0.96, doorTop * 1.06, 'ty_slagw_corr', seed + 10, night, alpha, true, 0, fh * 0.10); }
    // 4) A hull on a cradle outside, going nowhere, and the ground round it dry and cracked.
    { const [hx, hy] = F(-fh * 0.92, fh * 0.30);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.18, h * 0.16, h * 0.44, 'ty_hulls_door', seed + 14, night, alpha, true, 0.22);
      for (const t of [-1, 1]) { const [cx, cy] = F(-fh * 0.92, t * fh * 0.24 + fh * 0.30);
        draw3DBoxAt(ctx, cam, cx, cy, fh * 0.05, 0, h * 0.18, 'ty_slagw_corr', seed + 16 + t, night, alpha, false); } }
  },
  slagwares(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SLAG & WARES — one of two junkyard twins promoted off the scrapyard mesh
    // (bales, grabber crane, site shack), which is a plant this is not. It is a PITCH: a hand-cart
    // the size of a room, roofed in corrugate and dug into the hardpan so the wind goes over it,
    // sat where the west road empties out. Sorted salvage on boards, and it could leave tomorrow.
    const cartTop = h * 0.46, roof = h * 0.72;
    // 1) DUG IN — the spoil bank round the pitch, which is why the cart sits low.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.20, 0, h * 0.10, 'ty_slagw', seed, night, alpha, true);
    // 2) THE CART — a long box body, sunk, with the wheels still on it and the shafts down.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, h * 0.04, cartTop, pal, seed + 1, night, alpha, true);
    for (const t of [-1, 1]) { const [wx, wy] = F(t * fh * 0.70, -fh * 0.20);
      drawFacetDrum(ctx, cam, wx, wy, 0, h * 0.06, fh * 0.20, fh * 0.20, 10, alpha,
        (f) => 'rgb(' + (72 + f.nl * 34 | 0) + ',' + (58 + f.nl * 28 | 0) + ',' + (44 + f.nl * 22 | 0) + ')', 'rgb(44,36,30)'); }
    { const [sx, sy] = F(0, fh * 1.10); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.06, 0, h * 0.14, 'ty_slagw_corr', seed + 6, night, alpha, false, 0.10); }
    // 3) THE CORRUGATE ROOF, low and flat over the lot — the wind goes over, not through.
    for (const tx of [-1, 1]) for (const ty of [-1, 1]) { const [px, py] = F(tx * fh * 0.82, ty * fh * 0.60);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, roof, 'ty_slagw_corr', seed + 10 + tx + ty, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, roof, roof + h * 0.05, 'ty_slagw_corr', seed + 16, night, alpha, true);
    // 4) SORTED SALVAGE ON BOARDS — three low trestles of laid-out goods. Sorted, which is the
    //    difference between a pitch and a heap, and the reason anybody stops here.
    for (const [i, lx] of [[0, -0.56], [1, 0.00], [2, 0.56]]) { const [bx, by] = F(lx * fh, fh * 0.66);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.22, h * 0.10, h * 0.16, 'ty_slagw_corr', seed + 20 + i, night, alpha, true);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.16, h * 0.16, h * (0.22 + frac(seed + i) * 0.06), 'ty_slagw', seed + 24 + i, night, alpha, true); }
    if (night) glowPool(ctx, cam, dx, dy, roof, '255,190,130', 8, alpha * 0.22);
  },
  thumbscale(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THUMB ON THE SCALE — the other junkyard twin. A GATEHOUSE HUT beside the
    // Gate Road, one tile short of the South Gate, sited so everything walking out and everything
    // dragging itself back goes past the window. The building is tiny; the SCALE outside it is the
    // landmark, and it is big enough to weigh a person.
    const hutTop = h * 0.66, roof = h * 0.76;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.54, 0, hutTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, hutTop, roof, 'ty_slagw_corr', seed + 1, night, alpha, true);
    // 1) THE WINDOW, facing the road, lit. The whole siting argument of the building in one box.
    if (frontVis) { const [wx, wy] = F(0, fh * 0.58);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.34, hutTop * 0.42, hutTop * 0.80, 'ty_tomb_glass', seed + 2, night, alpha, true, 0, fh * 0.05);
      glowPool(ctx, cam, wx, wy, hutTop * 0.60, '255,206,146', 7, alpha * (night ? 0.52 : 0.18)); }
    // 2) THE SCALE — a gallows frame outside the hut with the beam, the hook and the pan hanging
    //    off it. Person-sized, which is the joke and also not a joke.
    { const [px, py] = F(fh * 0.86, fh * 0.30);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.06, 0, h * 1.18, 'ty_slagw_corr', seed + 8, night, alpha, false);
      const [ax, ay] = F(fh * 0.52, fh * 0.30);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.38, h * 1.10, h * 1.18, 'ty_slagw_corr', seed + 9, night, alpha, false);
      // The brass head, the rod, and the pan. The pan swings whether or not there is any wind.
      const [hx, hy] = F(fh * 0.20, fh * 0.30);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.11, h * 0.94, h * 1.10, 'ty_thumb_brass', seed + 10, night, alpha, false);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.02, h * 0.52, h * 0.94, 'ty_thumb_brass', seed + 11, night, alpha, false);
      drawFacetDrum(ctx, cam, hx, hy, h * 0.46, h * 0.54, fh * 0.26, fh * 0.24, 10, alpha,
        (f) => 'rgb(' + (128 + f.nl * 52 | 0) + ',' + (100 + f.nl * 42 | 0) + ',' + (46 + f.nl * 24 | 0) + ')', 'rgb(88,68,32)');
      glowPool(ctx, cam, hx, hy, h * 1.02, '224,182,86', 5, alpha * (night ? 0.24 : 0.12)); }
  },
  slipback(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SLIP — one of two fences promoted off the `pawn` mesh. It is THE BACK
    // ROOM, and the reason the front is so bare: shelving to the ceiling, nothing labelled, nothing
    // from the same job stored together. So it is drawn as a big blind windowless store with a
    // deliberately undersized frontage stuck on it — the mass is all behind, where it belongs.
    const front = h * 0.62, store = h * 1.06;
    // 1) THE STORE — the real building, set back, blind on every face.
    { const [bx, by] = F(0, -fh * 0.44);
      draw3DBoxAt(ctx, cam, bx, by, fh * 1.00, 0, store, pal, seed, night, alpha, true); }
    // 2) THE FRONT — small, low, and offset, so the two masses obviously do not belong together.
    { const [fx, fy] = F(-fh * 0.30, fh * 0.80);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.42, 0, front, 'ty_sentimental', seed + 2, night, alpha, true);
      const [gx, gy] = F(-fh * 0.30, fh * 1.10);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.14, 0, front * 0.60, 'ty_door', seed + 3, night, alpha, false); }
    // 3) ROOF VENTS on the store and a single service light over the back door. No shopfront glow:
    //    a room with nothing on display does not light itself for the street.
    for (const [i, lx] of [[0, -0.40], [1, 0.40]]) { const [vx, vy] = F(lx * fh, -fh * 0.44);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.12, store, store + h * 0.10, 'ty_unit_shut', seed + 10 + i, night, alpha, true); }
    { const [lx, ly] = F(fh * 0.72, fh * 0.10);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.10, 0, front * 0.52, 'ty_door', seed + 14, night, alpha, false);
      glowPool(ctx, cam, lx, ly, front * 0.66, '226,220,200', 5, alpha * (night ? 0.30 : 0.10)); }
  },
  sentimental(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SENTIMENTAL VALUE PAWN — the other fence. Barred windows, a half-dead
    // sign and no questions, with whatever you lost in the case out front. The bars are the model:
    // it is the only frontage in Coldwater that is entirely behind a grille and still lit for trade.
    const wallTop = h * 0.74, parapet = h * 0.84;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, wallTop, parapet, 'ty_sentimental_bar', seed + 1, night, alpha, true);
    // 1) THE BARS — five uprights across the whole front, standing off the glass behind them.
    if (frontVis) { const [gx, gy] = F(0, fh * 0.88);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.66, h * 0.16, wallTop * 0.84, 'ty_tomb_glass', seed + 2, night, alpha, true, 0, fh * 0.07);
      for (let i = 0; i < 5; i++) { const [bx, by] = F((-0.56 + i * 0.28) * fh, fh * 0.98);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.035, 0, wallTop * 0.88, 'ty_sentimental_bar', seed + 6 + i, night, alpha, false); }
      glowPool(ctx, cam, gx, gy, wallTop * 0.46, '255,196,110', 8, alpha * (night ? 0.40 : 0.14)); }
    // 2) THE CASE OUT FRONT — a lit display box on the pavement, barred like the rest of it.
    { const [cx, cy] = F(fh * 0.60, fh * 1.14);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.20, 0, h * 0.14, 'ty_sentimental_bar', seed + 16, night, alpha, true, 0, fh * 0.06);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.18, h * 0.14, h * 0.40, 'ty_tomb_glass', seed + 17, night, alpha, true);
      glowPool(ctx, cam, cx, cy, h * 0.34, '255,214,138', 5, alpha * (night ? 0.44 : 0.16)); }
    // 3) THE HALF-DEAD SIGN. Half: the band is drawn at reduced strength, so it reads as a fitting
    //    with tubes out rather than as a shop that has closed.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.70, parapet * 0.94, m.neon || '#ffcf3e', night, alpha * 0.55, 'SENTIMENTAL VALUE');
  },
  grindhouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // GRIND HOUSE — the twin of the Second Amendment Superstore on the `armory`
    // mesh, which is a riveted blockhouse with a slit window. This is the opposite: a LONG SHED
    // built round a forge that has not been allowed to go out in eleven years, so it is low, open
    // at the working end, and the warmest-looking building on the street from the air.
    const wallTop = h * 0.68, ridge = h * 0.80, flue = h * 1.44;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, wallTop, ridge, 'ty_grind', seed + 1, night, alpha, true);
    // 1) THE FORGE — a hooded hearth at one end with the flue straight up out of the roof, and the
    //    ember light under it. Eleven years is the whole selling point, so it is never drawn cold.
    { const [hx, hy] = F(-fh * 0.52, -fh * 0.20);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.30, 0, h * 0.34, 'ty_grind_ember', seed + 2, night, alpha, true);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.26, h * 0.34, wallTop, 'ty_grind', seed + 3, night, alpha, false);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.12, ridge, flue, 'ty_grind', seed + 4, night, alpha, true);
      drawSmoke(ctx, cam, hx, hy, flue, '186,176,168', alpha * 0.6, now, seed + 4);
      glowPool(ctx, cam, hx, hy, h * 0.30, '255,124,40', 12, alpha * (night ? 0.70 : 0.28)); }
    // 2) THE OPEN WORKING END — the wall stops short and a roof-only bay carries on past it, which
    //    is where the grinding dust goes and why it is twenty degrees warmer in there.
    { const [ox, oy] = F(fh * 0.72, fh * 0.30);
      for (const ty of [-1, 1]) { const [px, py] = F(fh * 1.02, ty * fh * 0.44 + fh * 0.30);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, wallTop, 'ty_grind', seed + 10 + ty, night, alpha, false); }
      draw3DBoxAt(ctx, cam, ox, oy, fh * 0.44, wallTop, ridge, 'ty_grind', seed + 12, night, alpha, true); }
    // 3) THE BLADE RACKS on the front wall — house work outside, the good marques behind glass.
    if (frontVis) { for (let i = 0; i < 7; i++) { const [bx, by] = F((-0.64 + i * 0.21) * fh, fh * 0.96);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.022, wallTop * 0.34, wallTop * 0.72, 'ty_sentimental_bar', seed + 20 + i, night, alpha, false); }
      const [cx, cy] = F(fh * 0.30, fh * 0.94);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.26, wallTop * 0.30, wallTop * 0.74, 'ty_tomb_glass', seed + 30, night, alpha, true, 0, fh * 0.05); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.70, ridge * 0.98, m.neon || '#ff8a2a', night, alpha, 'GRIND HOUSE');
  },
};
