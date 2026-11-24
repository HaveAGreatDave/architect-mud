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
  TILE_REACH, nearOrMesh, reserveSignBand, rgb, roofCross, windWheel,
} from '../../windshield.js';
import { drawEntrance } from '../entrance.js';

// ── Shared flat faces for the small shop arms ──────────────────────────────────────────────────────
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
// O'Toole's Surplus's badge: a brass-ringed green roundel with O'Toole's above a pair of stars and
// Surplus below them, both in one script on one rising slant, and a stitched red ribbon across the
// foot carrying EST. 1924. Baked per day/night; by night the decal is lit ('_lit'), as its lamp is.
// ⚠ BAKED ONLY ONCE THE FACES HAVE ARRIVED. Before Yellowtail and Playfair Display SC load, the
// fallbacks set different widths, and a cached bake would keep them. Until then it bakes fresh, at
// most every two seconds, and nothing is cached.
const _otBadge = new Map();
let _otTry = 0, _otPending = null;
function otooleBadgeTex(lit) {
  const k = lit ? 1 : 0;
  if (_otBadge.has(k)) return _otBadge.get(k);
  if (typeof document === 'undefined') return null;
  const ready = !!document.fonts?.check?.('40px Yellowtail') && !!document.fonts?.check?.('700 20px "Playfair Display SC"');
  const t = Date.now();
  if (!ready && _otPending && t - _otTry < 2000) return _otPending;
  // ⚠ BAKED WIDE ON PURPOSE. The sign fit makes the quad the texture's shape in WORLD units, and a
  // world height draws about 1.65 times a world width on this face, so a 320 by 256 roundel came out
  // a tall oval. The art is laid out at 320 by 256 and stretched across by OT_STRETCH to come out round.
  const OT_STRETCH = 1.65, W = 320, H = 256, c = document.createElement('canvas'); c.width = Math.round(W * OT_STRETCH); c.height = H;
  const g = c.getContext('2d');
  if (g) {
    g.scale(OT_STRETCH, 1);
    const cx = W / 2, cy = 118, R = 112;
    const GREEN = lit ? '#24543f' : '#1f4a38', BRASS = lit ? '#f0c66a' : '#c89a46', CREAM = lit ? '#fff1cf' : '#efe2c2';
    const RED = lit ? '#b8322a' : '#9c2a22', RED_DK = lit ? '#7a1e18' : '#661812';
    // The roundel: a brass ring, the green field, a thin cream line inside the ring.
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = BRASS; g.fill();
    g.beginPath(); g.arc(cx, cy, R - 9, 0, Math.PI * 2); g.fillStyle = GREEN; g.fill();
    g.beginPath(); g.arc(cx, cy, R - 15, 0, Math.PI * 2); g.lineWidth = 2.5; g.strokeStyle = CREAM; g.stroke();
    // Two small stars on the ring's horizontal, which is all the ornament it gets.
    for (const sx of [-1, 1]) {
      const x = cx + sx * (R - 30), y = cy - 4;
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3.2 : 8; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      g.closePath(); g.fillStyle = BRASS; g.fill();
    }
    // O'Toole's above the stars and Surplus under them, both in the script and on one rising slant.
    const ang = -0.22, FACE = 'Yellowtail,"Brush Script MT","Segoe Script",cursive';
    const line = (word, px, x, y, maxW) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.font = px + 'px ' + FACE; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const sc = Math.min(1, maxW / g.measureText(word).width); g.scale(sc, sc);
      g.lineJoin = 'round'; g.lineWidth = 7; g.strokeStyle = GREEN; g.strokeText(word, 0, 0);
      g.fillStyle = CREAM; g.fillText(word, 0, 0);
      g.restore();
    };
    line("O'Toole's", 76, cx - 4, cy - 26, 2 * R - 60);
    line('Surplus', 62, cx + 4, cy + 34, 2 * R - 84);
    // The ribbon along the foot: a red band wider than the roundel with a cream stitch along each edge,
    // a shaded fold where it turns back, notched tails behind, and the year on it.
    const ry = cy + 66, rh = 34, rx0 = 18, rx1 = W - 18;
    for (const side of [-1, 1]) {   // the tails, darker, behind
      const xa = side < 0 ? rx0 : rx1, xb = xa - side * 30, xo = xa + side * 16;
      g.beginPath(); g.moveTo(xb, ry + 9); g.lineTo(xo, ry + 9); g.lineTo(xo - side * 9, ry + 9 + rh / 2); g.lineTo(xo, ry + 9 + rh); g.lineTo(xb, ry + 9 + rh); g.closePath();
      g.fillStyle = RED_DK; g.fill(); g.lineWidth = 1.5; g.strokeStyle = BRASS; g.stroke();
      // the fold: a dark wedge where the band turns under into its tail
      const xf = side < 0 ? rx0 + 14 : rx1 - 14;
      g.beginPath(); g.moveTo(xf, ry + rh); g.lineTo(xf, ry + rh + 9); g.lineTo(xf - side * 14, ry + rh + 9); g.closePath();
      g.fillStyle = '#3e0e0a'; g.fill();
    }
    const band = (dy) => { g.beginPath(); g.moveTo(rx0 + 14, ry + dy); g.quadraticCurveTo(cx, ry - 10 + dy, rx1 - 14, ry + dy); };
    band(0); g.lineTo(rx1 - 14, ry + rh); g.quadraticCurveTo(cx, ry + rh - 10, rx0 + 14, ry + rh); g.closePath();
    g.fillStyle = RED; g.fill(); g.lineWidth = 3; g.strokeStyle = BRASS; g.stroke();
    // a lighter sheen along the upper third, as silk catches the light
    g.save(); g.clip(); g.globalAlpha = 0.18; g.fillStyle = '#ffffff'; g.fillRect(rx0, ry - 12, rx1 - rx0, rh * 0.42); g.restore();
    // the stitches, a dashed cream line just inside each edge
    g.save(); g.setLineDash([5, 4]); g.lineWidth = 1.4; g.strokeStyle = CREAM; g.globalAlpha = 0.85;
    for (const dy of [5, rh - 5]) { g.beginPath(); g.moveTo(rx0 + 20, ry + dy); g.quadraticCurveTo(cx, ry - 10 + dy, rx1 - 20, ry + dy); g.stroke(); }
    g.restore();
    // EST. 1924, in serif capitals, sat on the band's curve, with a small diamond either side
    g.save(); g.translate(cx, ry + rh / 2 - 4);
    g.font = '700 21px "Playfair Display SC",Georgia,serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (g.letterSpacing !== undefined) g.letterSpacing = '3px';
    g.fillStyle = CREAM; g.fillText('EST. 1924', 0, 0);
    const tw = g.measureText('EST. 1924').width / 2 + 16;
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(sx * tw, -5); g.lineTo(sx * tw + 5, 0); g.lineTo(sx * tw, 5); g.lineTo(sx * tw - 5, 0); g.closePath(); g.fillStyle = BRASS; g.fill(); }
    g.restore();
  }
  c._lit = lit ? 1 : 0;
  if (ready) _otBadge.set(k, c); else { _otPending = c; _otTry = t; }
  return c;
}

// Watts the Damage's mark: a light bulb over two crossed wrenches, laid out like a skull and
// crossbones, in red and black paint on the cream board. Baked once; it's paint, so never lit.
let _wattsLogo;
function wattsLogoTex() {
  if (_wattsLogo !== undefined) return _wattsLogo;
  if (typeof document === 'undefined') return null;
  const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  if (g) {
    const INK = '#2a2824', BOARD = '#e2d6b6';
    const wrench = (ang) => {   // a shank with an open jaw at each end
      g.save(); g.translate(64, 72); g.rotate(ang);
      g.fillStyle = INK; g.fillRect(-6, -44, 12, 88);
      for (const s of [-1, 1]) {
        g.fillStyle = INK; g.beginPath(); g.arc(0, s * 46, 15, 0, Math.PI * 2); g.fill();
        g.fillStyle = BOARD; g.fillRect(-6, s > 0 ? s * 46 : s * 46 - 16, 12, 16);
      }
      g.restore();
    };
    wrench(Math.PI / 4); wrench(-Math.PI / 4);
    g.fillStyle = '#a3261c'; g.strokeStyle = INK; g.lineWidth = 4;   // the bulb
    g.beginPath(); g.arc(64, 42, 25, Math.PI * 0.78, Math.PI * 2.22); g.lineTo(75, 78); g.lineTo(53, 78); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#6e6a62'; g.fillRect(53, 80, 22, 14);
    g.fillStyle = INK; for (const y of [84, 89]) g.fillRect(53, y, 22, 2);
    g.strokeStyle = '#ffe9a8'; g.lineWidth = 3;   // the filament
    g.beginPath(); g.moveTo(57, 76); g.lineTo(58, 48); g.lineTo(64, 56); g.lineTo(70, 48); g.lineTo(71, 76); g.stroke();
  }
  c._lit = 0;
  _wattsLogo = c;
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
    // …and its door, left of centre so the whitewashed post stands clear of it: a glazed leaf in a
    // steel frame onto the lit shop. ⚠ The shop had no door (the small-building grade, 2026-10-04).
    // ⚠ ITS FACE IS AT THE TILE'S REACH, NOT AT 1.26 fh: the box is trimmed there by `segFit`, so a
    //    door set where the arm asks for the box would stand off the front of it at wide footprints.
    //    The min is safe here because a door is adornment and never reaches the shape capture.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: -fh * 0.14, y: Math.min(fh * 1.26, TILE_REACH), w: fh * 0.08, top: h * 0.30, leaves: 1,
      frame: [92, 96, 100], lobby: { day: [70, 52, 40], night: [255, 186, 120] }, frontVis });
    // 4) The whitewashed name round the curve, and the stoke-hole glow at the base. It reads from
    //    a long way east, which is the point of putting it on a kiln rather than over a door.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.72, waist * 0.86, m.neon || '#ff8a4a', night, alpha, 'FIRED & FORGOTTEN');
    { const [mx, my] = F(fh * 0.40, fh * 0.72);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.12, 0, h * 0.20, 'ty_ff_white', seed + 10, night, alpha, false); }
    drawSmoke(ctx, cam, dx, dy, throat, '198,188,176', alpha * 0.4, now, seed + 12);
  },
  chippy(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // BATTER DAYS FISH & CHIPS: the chip shop on the front
    // of the Codfather's fish works, on Greenside Row. The prose (zone_district_903_906) is the brief:
    // three storeys of harbour-blue render, orange awnings over a wide lit window, BATTER DAYS in
    // orange across the front, picnic tables under the awnings, two floors of flats with a bay over
    // the door, a slate roof, a steel flue up the back breathing steam, and the works behind it.
    //
    // Local frame: +y is Greenside Row, -y is the fish works, +x is Filament Yard, where the side
    // awning and two of the tables are.
    //
    // ⚠ THE BACK WALL IS ON THE PLOT LINE, IN TILE UNITS (`TILE_REACH`), for the `fishworks` arm's
    // reason: two arms each rolled their own `fh`, and only a wall placed on the line meets the
    // other one. The works' roof lantern stands over this roof, so the shed reads as carrying on behind.
    // ⚠ THE STEAM IS DRAWN AT EVERY HOUR. The arm has no opening hours to read, and a chippy with a
    // dead flue reads as shut.
    // ⚠ THREE STOREYS (`flags.floors: 3`): the shop, and two floors of flats over it. The shop is
    // drawn in `S`, one storey, so its window, awnings and tables stay at a person's height; only
    // the flats, the cornice and the roof are fractions of `h`.
    const YAW = faceYaw(E), dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh();
    const R = TILE_REACH, S = h / 3;
    const CREAM = 'ty_bd_cream', NAVY = 'ty_bd_blue_dk', SLATE = 'ty_dw_slate';
    const plinth = S * 0.05, wallTop = h * 0.93, capTop = h * 0.97;
    const SIDE = fh * 0.84, FRONT = fh * 0.78;
    const by = (FRONT - R) * 0.5, bd = (FRONT + R) * 0.5;
    const B = (x, y, hx, hy, z0, z1, p, roof, s) => { const [bx, byy] = F(x, y); draw3DBoxAt(ctx, cam, bx, byy, hx, z0, z1, p, seed + s, night, alpha, roof, YAW, hy); };
    // 1) THE BUILDING: painted render on a navy plinth. A cream cornice caps the shop, a sill course
    //    runs round at the second floor, and a deep cornice under a parapet with a navy coping.
    B(0, by, SIDE + fh * 0.02, bd + fh * 0.01, 0, plinth, NAVY, false, 1);
    B(0, by, SIDE, bd, plinth, wallTop, pal, false, 0);
    B(0, by, SIDE + fh * 0.03, bd + fh * 0.015, S * 0.96, S * 1.04, CREAM, true, 70);
    B(0, by, SIDE + fh * 0.012, bd + fh * 0.006, S * 1.98, S * 2.03, CREAM, true, 71);
    B(0, by, SIDE + fh * 0.035, bd + fh * 0.02, wallTop - S * 0.07, wallTop, CREAM, true, 72);
    B(0, by, SIDE + fh * 0.005, bd, wallTop, capTop, pal, false, 73);
    B(0, by, SIDE + fh * 0.02, bd + fh * 0.01, capTop, capTop + S * 0.025, NAVY, true, 2);
    // Cream pilasters up the two front corners, over the shop.
    for (const s of [-1, 1]) B(s * (SIDE - fh * 0.02), FRONT - fh * 0.02, fh * 0.045, fh * 0.03, S * 1.04, wallTop - S * 0.07, CREAM, false, 74 + s);
    // 2) THE ROOF: slate, hipped low behind the parapet, and two chimney stacks on the west wall.
    B(0, by - fh * 0.04, SIDE * 0.86, bd * 0.84, capTop - S * 0.02, capTop + S * 0.18, SLATE, true, 76);
    B(0, by - fh * 0.04, SIDE * 0.56, bd * 0.46, capTop + S * 0.18, capTop + S * 0.32, SLATE, true, 77);
    for (const [i, cy] of [[0, by + bd * 0.40], [1, by - bd * 0.40]]) {
      const cx = -SIDE + fh * 0.10, top = capTop + S * 0.56;
      B(cx, cy, fh * 0.07, fh * 0.11, wallTop, top, pal, false, 78 + i * 3);
      B(cx, cy, fh * 0.085, fh * 0.125, top, top + S * 0.04, NAVY, true, 79 + i * 3);
      for (const t of [-1, 1]) {
        const [px, py] = F(cx, cy + t * fh * 0.05);
        drawFacetDrum(ctx, cam, px, py, top + S * 0.04, top + S * 0.13, fh * 0.028, fh * 0.022, 8, alpha,
          (f) => 'rgb(' + (150 + f.nl * 50 | 0) + ',' + (78 + f.nl * 30 | 0) + ',' + (54 + f.nl * 20 | 0) + ')', 'rgb(40,30,26)', 'ty_cont_r');
      }
    }
    // 3) THE FLUE: a square galvanised duct up the back corner from the fryer hood, with a rain cap,
    //    standing clear of the roof and the works' eaves, and steam rather than smoke.
    { const [kx, ky] = F(-fh * 0.50, -R + fh * 0.14), stack = h * 1.16;
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.08, plinth, stack, 'ty_wh_metal', seed + 4, night, alpha, false);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.13, stack, stack + S * 0.04, 'ty_wh_metal', seed + 5, night, alpha, true);
      drawSmoke(ctx, cam, kx, ky, stack + S * 0.04, '236,234,230', alpha * 0.46, now, seed + 6); }
    // 4) THE FLATS: two floors of sash windows, cream frames with a meeting rail, a sill and a hood
    //    over each, and a two-storey bay over the door. Each window is lit or dark after dark by its
    //    own roll, so the block reads as homes rather than as a lit box.
    //    `wall` is 'y' for a face on the plane y = at, or 'x' for one on x = at; `s` is its outward sign.
    const GLASS = [40, 50, 58], LAMP = [255, 206, 140], DARK = [30, 34, 40], FRAME = [236, 228, 208];
    const sash = (wall, s, at, u, z0, z1, hw, k, trim) => {
      const out = wall === 'y' ? [0, s, 0] : [s, 0, 0];
      const Q = (o, u0, u1, za, zb) => { const a = at + s * o; return wall === 'y'
        ? [[u0, a, zb], [u1, a, zb], [u1, a, za], [u0, a, za]] : [[a, u0, zb], [a, u1, zb], [a, u1, za], [a, u0, za]]; };
      const fw = fh * 0.014, lit = frac(seed * 13.1 + k * 7.3) < 0.5, zm = (z0 + z1) * 0.5;
      tcFlat(ctx, cam, W3, Q(fh * 0.004, u - hw - fw, u + hw + fw, z0 - fw, z1 + fw), out, FRAME, 'plain', alpha, dn);
      tcGlow(ctx, cam, W3, Q(fh * 0.008, u - hw, u + hw, z0, z1), out, GLASS, lit ? LAMP : DARK, dn, alpha);
      tcFlat(ctx, cam, W3, Q(fh * 0.012, u - hw, u + hw, zm - fw * 0.4, zm + fw * 0.4), out, FRAME, 'plain', alpha, dn);
      if (trim) {   // the sill under it and the hood over it, both proud of the render
        const box = (z0b, z1b, half, dep) => { const c = at + s * dep, [x, y] = wall === 'y' ? [u, c] : [c, u];
          const [hx, hy] = wall === 'y' ? [half, dep] : [dep, half]; B(x, y, hx, hy, z0b, z1b, CREAM, true, 90 + k); };
        box(z0 - fw - S * 0.03, z0 - fw, hw + fw * 1.8, fh * 0.018);
        box(z1 + fw, z1 + fw + S * 0.045, hw + fw * 1.5, fh * 0.012);
      }
      if (night && lit) { const [gx, gy] = wall === 'y' ? F(u, at + s * fh * 0.04) : F(at + s * fh * 0.04, u); glowPool(ctx, cam, gx, gy, zm, '255,206,140', 5, alpha * 0.30); }
    };
    const BW = fh * 0.30, BP = fh * 0.10, YB = FRONT + BP;
    B(0, FRONT + BP * 0.5, BW + fh * 0.02, BP * 0.5 + fh * 0.01, S * 1.04, S * 1.12, CREAM, true, 84);
    B(0, FRONT + BP * 0.5, BW, BP * 0.5, S * 1.12, S * 2.90, pal, false, 85);
    B(0, FRONT + BP * 0.5, BW + fh * 0.02, BP * 0.5 + fh * 0.01, S * 2.90, S * 2.96, NAVY, true, 86);
    for (const f of [1, 2]) {
      const z0 = f * S + S * 0.26, z1 = f * S + S * 0.80, k = f * 20;
      for (const [i, u] of [[0, -fh * 0.58], [1, fh * 0.58]]) sash('y', 1, FRONT, u, z0, z1, fh * 0.085, k + i, true);
      for (const [i, u] of [[0, -fh * 0.18], [1, 0], [2, fh * 0.18]]) sash('y', 1, YB, u, z0 + S * 0.04, z1, fh * 0.062, k + 2 + i, false);
      for (const s of [-1, 1]) sash('x', s, s * BW, FRONT + BP * 0.5, z0 + S * 0.04, z1, BP * 0.30, k + 5 + s, false);
      for (const [i, y] of [[0, fh * 0.46], [1, -fh * 0.02], [2, -fh * 0.50]]) sash('x', 1, SIDE, y, z0, z1, fh * 0.085, k + 8 + i, true);
      for (const [i, y] of [[0, fh * 0.30], [1, -fh * 0.30]]) sash('x', -1, -SIDE, y, z0, z1, fh * 0.085, k + 12 + i, true);
    }
    // 5) THE SHOPFRONT: one wide lit window with the door in the middle, cream frames on a navy
    //    stallriser. ⚠ THE GLASS IS A LAMP PALETTE, NOT A GLAZING ONE (the light seen through one
    //    sheet), it carries its own `yaw` and `fd` (or it is a cube in the road), and it stands
    //    proud of the render (flush is a coin toss the wall wins).
    const sill = plinth + S * 0.06, glassTop = S * 0.50;
    { const [gx, gy] = F(0, FRONT + fh * 0.015);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.64, sill, glassTop, 'ty_dw_lamp', seed + 8, night, alpha, false, YAW, fh * 0.03);
      glowPool(ctx, cam, gx, gy, (sill + glassTop) * 0.5, '255,214,150', 10, alpha * (night ? 0.60 : 0.20)); }
    { const [sx, sy] = F(0, FRONT + fh * 0.03);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.66, plinth, sill, 'ty_bd_blue_dk', seed + 9, night, alpha, false, YAW, fh * 0.04); }
    for (const s of [-1, 1]) {   // the fog on the lower two-thirds of each pane
      const x0 = s * fh * 0.10, x1 = s * fh * 0.62, y = FRONT + fh * 0.047, top = sill + (glassTop - sill) * 0.66;
      tcGlow(ctx, cam, W3, [[x0, y, top], [x1, y, top], [x1, y, sill + S * 0.006], [x0, y, sill + S * 0.006]], [0, 1, 0],
        [214, 206, 188], [255, 232, 196], dn, alpha);
    }
    for (const mx of [-0.64, -0.36, -0.10, 0.10, 0.36, 0.64]) {   // ⚠ none on the centre line: the door is there
      const [px, py] = F(mx * fh, FRONT + fh * 0.04);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.016, sill, glassTop + S * 0.012, 'ty_bd_cream', seed + 12, night, alpha, false, YAW, fh * 0.025);
    }
    { const [tx, ty] = F(0, FRONT + fh * 0.04);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.65, glassTop, glassTop + S * 0.02, 'ty_bd_cream', seed + 13, night, alpha, false, YAW, fh * 0.025); }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      y: FRONT + fh * 0.02, w: fh * 0.075, z0: plinth, top: glassTop - S * 0.01, leaves: 1, frameW: fh * 0.014, depth: 0.006,
      frame: [226, 218, 196], lobby: { day: [176, 144, 100], night: [255, 214, 150] }, mat: false, frontVis });
    // 6) THE NAME, painted in orange straight onto a navy fascia between the awning and the cornice,
    //    lettered from the tile's own name (`sign`), so this file carries no Coldwater words.
    //    ⚠ NOT `marqueeBand`. It stands its band off the FRONTMOST face the model has, and here that
    //    is the awning lip a third of a tile out, so the band floated in front of the awnings and
    //    hid the whole shopfront. Paint on the fascia stays on the fascia.
    const fasciaZ0 = S * 0.64, fasciaZ1 = S * 0.88, fy = FRONT + fh * 0.024;
    { const [fx, fyy] = F(0, FRONT + fh * 0.012);
      draw3DBoxAt(ctx, cam, fx, fyy, SIDE, fasciaZ0, fasciaZ1, 'ty_bd_blue_dk', seed + 14, night, alpha, false, YAW, fh * 0.012); }
    reserveSignBand(SIDE * 0.92, (fasciaZ0 + fasciaZ1) * 0.5, { floor: fasciaZ0, wallTop: S * 0.96, wall: SIDE });
    if (frontVis && sign) {
      const P = (u, z) => { const [wx, wy] = F(u, fy + FACE_EPS); return cam.proj(wx, wy, z); };
      const x0 = -SIDE * 0.90, x1 = SIDE * 0.90, z0 = fasciaZ0 + S * 0.03, z1 = fasciaZ1 - S * 0.03;
      const q = [P(x0, z1), P(x1, z1), P(x1, z0), P(x0, z0)];
      const tex = bakeSignText(sign, m.neon || '#f08a2a', 0, false, true, true, { font: 'block' });
      if (tex && q.every((pp) => pp.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
    }
    // 7) THE AWNINGS: orange canvas on steel arms along the front and down the Filament Yard side,
    //    each with a cream valance under its lip, on four posts at the outer corners.
    //    ⚠ THE SIDE ONE IS SIZED TO THE PLOT, not to fh: what is left between the wall and the tile
    //    edge, so a wide roll cannot push it over the kerb into Filament Yard.
    const awZ0 = S * 0.56, awZ1 = S * 0.60, OUT = fh * 0.36, LIP = FRONT + OUT;
    const OUTS = Math.max(fh * 0.10, R - SIDE - fh * 0.03), SX = SIDE + OUTS, SY0 = -fh * 0.34;
    awning(ctx, cam, dx, dy, E, SIDE + OUTS, LIP, awZ0, awZ1, 'ty_bd_orange', seed + 16, night, alpha, OUT);
    { const [vx, vy] = F(0, LIP - fh * 0.008);
      draw3DBoxAt(ctx, cam, vx, vy, SIDE + OUTS, awZ0 - S * 0.035, awZ0, 'ty_bd_cream', seed + 17, night, alpha, false, YAW, fh * 0.008); }
    { const [ax, ay] = F(SIDE + OUTS * 0.5, (SY0 + FRONT) * 0.5);
      draw3DBoxAt(ctx, cam, ax, ay, OUTS * 0.5, awZ0, awZ1, 'ty_bd_orange', seed + 18, night, alpha, true, YAW, (FRONT - SY0) * 0.5);
      const [ux, uy] = F(SX - fh * 0.008, (SY0 + FRONT) * 0.5);
      draw3DBoxAt(ctx, cam, ux, uy, fh * 0.008, awZ0 - S * 0.035, awZ0, 'ty_bd_cream', seed + 19, night, alpha, false, YAW, (FRONT - SY0) * 0.5); }
    for (const [px, py] of [[-(SIDE + OUTS) + fh * 0.02, LIP - fh * 0.02], [SX - fh * 0.02, LIP - fh * 0.02], [SX - fh * 0.02, SY0 + fh * 0.02]]) {
      const [qx, qy] = F(px, py);
      draw3DBoxAt(ctx, cam, qx, qy, fh * 0.012, 0, awZ0, 'ty_bd_blue_dk', seed + 20, night, alpha, false, YAW, fh * 0.012);
    }
    // 8) THE PICNIC TABLES: two in front either side of the door, two down the side, timber with
    //    the benches built on. Top at 0.21 of a storey is a table, 0.12 is something you sit on.
    const table = (lx, ly, alongX, k) => {
      const L = fh * 0.15, D = fh * 0.055, BN = fh * 0.10;
      const at = (u, v) => alongX ? F(lx + u, ly + v) : F(lx + v, ly + u);
      const w = (a, b) => alongX ? [a, b] : [b, a];
      { const [tx, ty] = at(0, 0), [a, b] = w(L, D);
        draw3DBoxAt(ctx, cam, tx, ty, a, S * 0.195, S * 0.215, 'ty_dw_timber', seed + 30 + k, night, alpha, true, YAW, b); }
      for (const s of [-1, 1]) {
        const [ex, ey] = at(0, s * BN), [a, b] = w(L, fh * 0.025);
        draw3DBoxAt(ctx, cam, ex, ey, a, S * 0.11, S * 0.125, 'ty_dw_timber', seed + 32 + k, night, alpha, true, YAW, b);
        const [lx2, ly2] = at(s * L * 0.80, 0), [c, d] = w(fh * 0.012, BN + fh * 0.02);
        draw3DBoxAt(ctx, cam, lx2, ly2, c, 0, S * 0.195, 'ty_dw_timber', seed + 34 + k, night, alpha, false, YAW, d);
      }
    };
    const TY = FRONT + OUT * 0.52;
    table(-fh * 0.50, TY, true, 0);
    table(fh * 0.50, TY, true, 1);
    if (OUTS > fh * 0.24) { table(SIDE + OUTS * 0.5, fh * 0.30, false, 2); table(SIDE + OUTS * 0.5, -fh * 0.06, false, 3); }
    // 9) THE TIN FISH on its bracket off the corner, painted orange, above the awning so it reads
    //    from up and down Greenside Row. Two convex flats (body, tail) per side, because a fan over a
    //    concave outline draws a wedge across the notch.
    { const fx = SIDE - fh * 0.06, y0 = FRONT + fh * 0.04, y1 = FRONT + fh * 0.36, armZ = S * 0.90;
      const [bx, by2] = F(fx, (FRONT + y1) * 0.5);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.008, armZ, armZ + S * 0.01, 'ty_bd_blue_dk', seed + 50, night, alpha, false, YAW, (y1 - FRONT) * 0.5);
      const zc = armZ - S * 0.10, hz = S * 0.055, L = y1 - y0;
      const P = (u, v, s) => [fx + s * 0.002, y0 + u * L, zc + v * hz];
      const TINC = [236, 128, 40];
      for (const s of [-1, 1]) {
        tcFlat(ctx, cam, W3, [P(0.22, 0, s), P(0.45, -0.95, s), P(0.75, -0.80, s), P(1, 0, s), P(0.75, 0.80, s), P(0.45, 0.95, s)], [s, 0, 0], TINC, 'metal', alpha, dn);
        tcFlat(ctx, cam, W3, [P(0.27, 0, s), P(0, 0.85, s), P(0, -0.85, s)], [s, 0, 0], TINC, 'metal', alpha, dn);
        tcFlat(ctx, cam, W3, [P(0.80, 0.30, s * 2), P(0.86, 0.30, s * 2), P(0.86, 0.18, s * 2), P(0.80, 0.18, s * 2)], [s, 0, 0], [24, 48, 84], 'plain', alpha, dn);   // the eye
      }
      if (near) for (const u of [0.35, 0.80]) {
        emitWire(ctx, cam, W3(fx, y0 + u * L, armZ), W3(fx, y0 + u * L, zc + hz * 0.9), 1, 'rgba(40,46,60,0.9)', alpha, { pull: 0.01 });
      }
    }
    // 10) THE A-BOARD by the door, and the bin chained to the side post.
    { const [ax, ay] = F(fh * 0.24, FRONT + OUT * 0.88);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.05, 0, S * 0.15, 'ty_bd_orange', seed + 60, night, alpha, true, YAW, fh * 0.02); }
    { const [cx, cy] = F(SX - fh * 0.06, SY0 + fh * 0.08);
      drawFacetDrum(ctx, cam, cx, cy, 0, S * 0.16, fh * 0.045, fh * 0.045, 10, alpha,
        (f) => 'rgb(' + (110 + f.nl * 60 | 0) + ',' + (114 + f.nl * 60 | 0) + ',' + (118 + f.nl * 60 | 0) + ')', 'rgb(70,72,74)', 'ty_wh_metal'); }
    // 11) AFTER DARK: the festoon of bulbs under the side awning, and the light the window throws
    //    onto the tables in front.
    if (night) {
      for (let i = 0; i <= 4; i++) {
        const [lx, ly] = F(SX - fh * 0.03, SY0 + (FRONT - SY0) * i / 4);
        glowPool(ctx, cam, lx, ly, awZ0 - S * 0.05, '255,206,140', 4, alpha * 0.8);
      }
      const [tx, ty] = F(0, TY); glowPool(ctx, cam, tx, ty, S * 0.02, '255,206,140', 16, alpha * 0.30);
    }
  },
  otoole(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // O'TOOLE'S SURPLUS: a narrow two-storey brick shop from 1924,
    // the year the Meridian went up, in the plain end of the same style: fluted stone piers, a stepped
    // parapet, the name in brass on a green band, two plate windows and a door under a sunburst.
    // ⚠ RESTRAINT IS THE BRIEF. A family surplus shop, not a picture house: one band of chevrons on
    // the parapet, one fanlight, and the name once. The plaque says EST. 1924 and nothing else.
    // Local frame: +y is the street.
    const yaw = faceYaw(E), dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh();
    const BRASS = [196, 158, 82], GREEN = [34, 70, 56], STONE = [204, 190, 158], DARK = [40, 34, 30];
    const WARM_D = [70, 62, 52], WARM_N = [255, 206, 140];
    const sx = fh * 0.90, yB = -fh * 0.88, yF = fh * 0.62, top = h * 0.62;
    const yf = yF + 0.003;   // the face plane
    // 1) THE MASS: one brick box, two storeys, flat roof behind the parapet.
    { const [cx, cy] = F(0, (yB + yF) / 2); draw3DBoxAt(ctx, cam, cx, cy, sx, 0, top, 'ty_otoole_brick', seed, night, alpha, true, yaw, (yF - yB) / 2); }
    // 2) THE PARAPET, stepped three times up to the middle, brick with a stone coping on each step.
    const steps = [[0.90, h * 0.66], [0.60, h * 0.71], [0.30, h * 0.86]];
    for (const [i, [w, z1]] of steps.entries()) {
      const [cx, cy] = F(0, yF - fh * 0.05);
      draw3DBoxAt(ctx, cam, cx, cy, fh * w, top - h * 0.002, z1, 'ty_otoole_brick', seed + 1 + i, night, alpha, true, yaw, fh * 0.05);
      draw3DBoxAt(ctx, cam, cx, cy, fh * (w + 0.015), z1, z1 + h * 0.012, 'ty_otoole_stone', seed + 4 + i, night, alpha, true, yaw, fh * 0.06);
    }
    // 3) THE PIERS: four stone pilasters, three reeds cut in each, rising to the step above them.
    for (const [u, z1] of [[-0.86, h * 0.66], [-0.32, h * 0.86], [0.32, h * 0.86], [0.86, h * 0.66]]) {
      const [px, py] = F(fh * u, yF + fh * 0.015);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.045, 0, z1, 'ty_otoole_stone', seed + 8, night, alpha, true, yaw, fh * 0.018);
      if (near) for (const k of [-1, 0, 1]) {
        const x = fh * (u + k * 0.022), y = yF + fh * 0.034;
        tcFlat(ctx, cam, W3, [[x - fh * 0.004, y, z1 - h * 0.03], [x + fh * 0.004, y, z1 - h * 0.03], [x + fh * 0.004, y, h * 0.36], [x - fh * 0.004, y, h * 0.36]], [0, 1, 0], [150, 138, 112], 'plain', alpha, dn);
      }
    }
    // 4) THE BADGE on the raised middle of the parapet, where the street sees it first: the roundel,
    //    the script, the ribbon (otooleBadgeTex). Lit by night, with a lamp under it washing it up.
    // It is mounted proud of the piers, so it can overhang them like a sign hung on the face.
    { const zc = h * 0.77, y = yF + fh * 0.05, hb = h * 0.11, wb = fh * 0.6;   // the fit trims the width to the bake
      if (frontVis) {
        const P = (u, z) => { const [wx, wy] = F(u, y + FACE_EPS); return cam.proj(wx, wy, z); };
        const q = [P(-wb, zc + hb), P(wb, zc + hb), P(wb, zc - hb), P(-wb, zc - hb)];
        const tex = otooleBadgeTex(dn > 0.5);
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
      if (dn > 0) { const [gx, gy] = F(0, y + fh * 0.05); glowPool(ctx, cam, gx, gy, zc - hb, '255,214,150', 10, alpha * 0.55 * dn, { air: true }); } }
    // 5) THE UPPER FLOOR: three sash windows of the flat over the shop, six lights each, a stone sill,
    //    curtains drawn back to the sides, and the sky caught in the glass by day. Lit some nights.
    // ⚠ THE GLAZING BARS ARE FACES, NOT WIRES: a wire is near-tier only, and the windows read as blank
    // panels down the street without them.
    const CURTAIN = [[226, 212, 178], [150, 52, 44], [70, 112, 84]];
    for (const [i, u] of [-0.58, 0, 0.58].entries()) {
      const x0 = fh * (u - 0.13), x1 = fh * (u + 0.13), z0 = h * 0.44, z1 = h * 0.58, yg = yf + 0.001;
      tcFlat(ctx, cam, W3, [[x0 - fh * 0.015, yf, z1 + h * 0.01], [x1 + fh * 0.015, yf, z1 + h * 0.01], [x1 + fh * 0.015, yf, z0 - h * 0.012], [x0 - fh * 0.015, yf, z0 - h * 0.012]], [0, 1, 0], STONE, 'stone', alpha, dn);
      const on = frac(seed * 0.37 + i * 0.29) < 0.6 ? dn : dn * 0.15;
      tcGlow(ctx, cam, W3, [[x0, yg, z1], [x1, yg, z1], [x1, yg, z0], [x0, yg, z0]], [0, 1, 0], [56, 66, 74], [236, 190, 128], on, alpha);
      // the sky in the glass: a pale diagonal sheen across the upper sash, gone after dark
      { const k = Math.max(0, 1 - dn / 0.6);   // drawn by night too, gone to the dark glass, so day and night pair by index
        tcGlow(ctx, cam, W3, [[x0 + fh * 0.03, yg + 0.0005, z1], [x0 + fh * 0.11, yg + 0.0005, z1], [x0 + fh * 0.04, yg + 0.0005, z0 + (z1 - z0) * 0.45], [x0, yg + 0.0005, z0 + (z1 - z0) * 0.45]], [0, 1, 0], [110 + 40 * k, 128 + 40 * k, 142 + 40 * k], [56, 66, 74], dn, alpha); }
      // curtains, gathered to each side and tied back, one colour per flat
      const cc = CURTAIN[(i + Math.floor(seed)) % 3];
      for (const sd of [-1, 1]) {
        const xo = sd < 0 ? x0 : x1, xi = xo - sd * fh * 0.065, xt = xo - sd * fh * 0.03;
        tcFlat(ctx, cam, W3, [[xo, yg + 0.001, z1], [xi, yg + 0.001, z1], [xt, yg + 0.001, z0], [xo, yg + 0.001, z0]], [0, 1, 0], cc, 'plain', alpha, dn);
      }
      // the glazing bars: one upright, a meeting rail and a bar in each sash, in white-painted timber
      const bar = (ax, az, bx, bz) => tcFlat(ctx, cam, W3, [[ax, yg + 0.002, az], [bx, yg + 0.002, az], [bx, yg + 0.002, bz], [ax, yg + 0.002, bz]], [0, 1, 0], [212, 206, 190], 'plain', alpha, dn);
      const xm = (x0 + x1) / 2, t = fh * 0.006, zm = (z0 + z1) / 2;
      bar(xm - t, z1, xm + t, z0);
      bar(x0, zm + h * 0.004, x1, zm - h * 0.004);
      for (const zz of [z0 + (z1 - z0) * 0.25, z0 + (z1 - z0) * 0.75]) bar(x0, zz + h * 0.002, x1, zz - h * 0.002);
      // the sill, stone, standing proud
      { const [bx, by] = F((x0 + x1) / 2, yF + fh * 0.015); draw3DBoxAt(ctx, cam, bx, by, fh * 0.15, z0 - h * 0.016, z0 - h * 0.006, 'ty_otoole_stone', seed + 40 + i, night, alpha, true, yaw, fh * 0.03); }
    }
    // 6) THE BAND: green enamel between the floors, carried across the face of the piers, with the
    //    year on it in brass. The name is the badge's; it is said once.
    { const x0 = -fh * 0.82, x1 = fh * 0.82, z0 = h * 0.335, z1 = h * 0.405, yf = yF + fh * 0.045;   // proud of the piers, which it crosses
      tcFlat(ctx, cam, W3, [[x0 - fh * 0.02, yf, z1 + h * 0.008], [x1 + fh * 0.02, yf, z1 + h * 0.008], [x1 + fh * 0.02, yf, z0 - h * 0.008], [x0 - fh * 0.02, yf, z0 - h * 0.008]], [0, 1, 0], BRASS, 'metal', alpha, dn);
      tcFlat(ctx, cam, W3, [[x0, yf + 0.001, z1], [x1, yf + 0.001, z1], [x1, yf + 0.001, z0], [x0, yf + 0.001, z0]], [0, 1, 0], GREEN, 'plain', alpha, dn);
      if (frontVis) {
        const P = (u, z) => { const [wx, wy] = F(u, yf + 0.002 + FACE_EPS); return cam.proj(wx, wy, z); };
        const q = [P(x0 + fh * 0.04, z1 - h * 0.008), P(x1 - fh * 0.04, z1 - h * 0.008), P(x1 - fh * 0.04, z0 + h * 0.008), P(x0 + fh * 0.04, z0 + h * 0.008)];
        const tex = bakeSignText('FAMILY RUN SINCE 1924', '#e2bc62', 0, false, true, true, { font: 'deco', fit: (x1 - x0 - fh * 0.08) / (z1 - z0 - h * 0.016) });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
      // Two brass lamps on short arms over the band, so the name reads after dark.
      for (const u of [-0.50, 0.50]) {
        if (near) emitWire(ctx, cam, W3(fh * u, yf, z1 + h * 0.03), W3(fh * u, yf + fh * 0.06, z1 + h * 0.024), 1.6, 'rgba(120,96,50,0.95)', alpha, { pull: 0.02 });
        if (dn > 0) { const [gx, gy] = F(fh * u, yf + fh * 0.06); glowPool(ctx, cam, gx, gy, z1 + h * 0.01, '255,206,140', 8, alpha * 0.5 * dn); }
      } }
    // 7) THE BAY WINDOWS either side of the door: shallow brass-framed bays standing out from the
    //    front on a stone stall riser, a band of small leaded panes across the head, and three things
    //    from his stock on the display floor in each, as solids, so they turn as you walk past.
    //    Left: a dress form in the kevlar raincoat, a pair of steel-toe boots, a pick on the back wall.
    //    Right: a hand lamp on a crate (lit after dark), a stack of cell packs, the rebreather.
    //    ⚠ NO GLASS FACE: a flat face is opaque here, so the bay is open between its posts, and the
    //    window reads as glass by its frame, its head and one sheen strip across a corner.
    for (const [wi, [a, b]] of [[-0.80, -0.36], [0.36, 0.80]].entries()) {
      const x0 = fh * a, x1 = fh * b, z0 = h * 0.06, z1 = h * 0.29, zt = h * 0.245, W = x1 - x0;
      const yb = yF + fh * 0.10, ym = (yF + yb) / 2, xm = (x0 + x1) / 2;
      const box = (u, v, hw, za, zb, p, hd, sd = 0, turn = 0) => { const [bx, by] = F(u, v); draw3DBoxAt(ctx, cam, bx, by, hw, za, zb, p, seed + 50 + sd, night, alpha, true, yaw + turn, hd); };
      // the back of the bay: the shop seen through it, warm after dark, with the trade in gilt
      tcGlow(ctx, cam, W3, [[x0, yf + 0.001, zt], [x1, yf + 0.001, zt], [x1, yf + 0.001, z0], [x0, yf + 0.001, z0]], [0, 1, 0], [74, 58, 42], WARM_N, 0.2 + 0.8 * dn, alpha);
      if (frontVis) {
        const P = (u, z) => { const [wx, wy] = F(u, yf + 0.003 + FACE_EPS); return cam.proj(wx, wy, z); };
        const za = zt - h * 0.012, zb = zt - h * 0.042;
        const q = [P(x0 + fh * 0.03, za), P(x1 - fh * 0.03, za), P(x1 - fh * 0.03, zb), P(x0 + fh * 0.03, zb)];
        const tex = bakeSignText(wi ? 'LAMPS & CELLS' : 'BOOTS & COATS', '#e8c46a', 0, false, true, true, { font: 'deco' });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
      // the riser and its display floor, the four brass posts and the head over them
      box(xm, ym, W / 2 + fh * 0.01, 0, z0, 'ty_otoole_stone', (yb - yF) / 2, 1);
      for (const [u, v] of [[x0, yb], [x1, yb], [x0, yF + fh * 0.01], [x1, yF + fh * 0.01]]) box(u, v, fh * 0.008, z0, zt, 'ty_ot_brass', fh * 0.008, 2);
      box(xm, ym, W / 2 + fh * 0.012, zt, z1 + h * 0.01, 'ty_ot_brass', (yb - yF) / 2 + fh * 0.004, 3);
      for (let k = 0; k < 8; k++) {   // the leaded panes on the head's face, amber and clear by turns
        const ua = x0 + W * k / 8 + fh * 0.004, ub = x0 + W * (k + 1) / 8 - fh * 0.004, yy = yb + fh * 0.006;
        tcGlow(ctx, cam, W3, [[ua, yy, z1 - h * 0.002], [ub, yy, z1 - h * 0.002], [ub, yy, zt + h * 0.008], [ua, yy, zt + h * 0.008]], [0, 1, 0], k % 2 ? [150, 118, 64] : [120, 134, 140], k % 2 ? [255, 196, 110] : [250, 226, 180], dn, alpha);
      }
      const vy = yF + fh * 0.05;   // where the stock stands, midway into the bay
      if (wi === 0) {
        // a dress form in the kevlar raincoat: a stand, the skirt of the coat, the shoulders, a collar
        { const u = x0 + W * 0.28;
          box(u, vy, fh * 0.006, z0, z0 + h * 0.03, 'ty_ot_dark', fh * 0.006, 4);
          box(u, vy, fh * 0.05, z0 + h * 0.03, z0 + h * 0.10, 'ty_ot_olive', fh * 0.028, 5);
          box(u, vy, fh * 0.042, z0 + h * 0.10, z0 + h * 0.135, 'ty_ot_olive_dk', fh * 0.026, 6);
          box(u, vy, fh * 0.055, z0 + h * 0.135, z0 + h * 0.15, 'ty_ot_olive', fh * 0.03, 7);
          box(u, vy, fh * 0.016, z0 + h * 0.15, z0 + h * 0.165, 'ty_ot_olive_dk', fh * 0.016, 8); }
        // a pair of steel-toe boots on the floor, turned a little toward the door
        for (const [k, du] of [[0, 0], [1, 0.035]]) { const u = x0 + W * 0.66 + fh * du;
          box(u, vy - fh * 0.005, fh * 0.012, z0, z0 + h * 0.05, 'ty_ot_leather', fh * 0.012, 9 + k, 0.25);
          box(u, vy + fh * 0.014, fh * 0.012, z0, z0 + h * 0.018, 'ty_ot_leather', fh * 0.016, 11 + k, 0.25); }
        // the pick, hung on the back wall above the boots: a handle and a steel head
        if (near) { const u = x0 + W * 0.80, yw = yf + 0.004;
          emitWire(ctx, cam, W3(u - fh * 0.02, yw, z0 + h * 0.07), W3(u + fh * 0.03, yw, z0 + h * 0.18), 2.2, 'rgba(130,92,52,1)', alpha, { pull: 0.01 });
          emitWire(ctx, cam, W3(u - fh * 0.03, yw, z0 + h * 0.19), W3(u + fh * 0.07, yw, z0 + h * 0.165), 3, 'rgba(110,116,122,1)', alpha, { pull: 0.012 }); }
      } else {
        // a hand lamp on a crate, its lens toward the street, lit after dark
        { const u = x0 + W * 0.26;
          box(u, vy, fh * 0.04, z0, z0 + h * 0.05, 'ty_2cell_crate', fh * 0.03, 13);
          box(u, vy, fh * 0.016, z0 + h * 0.05, z0 + h * 0.072, 'ty_ot_brass', fh * 0.02, 14);
          box(u, vy, fh * 0.004, z0 + h * 0.072, z0 + h * 0.09, 'ty_ot_dark', fh * 0.004, 15);
          tcGlow(ctx, cam, W3, [[u - fh * 0.012, vy + fh * 0.021, z0 + h * 0.068], [u + fh * 0.012, vy + fh * 0.021, z0 + h * 0.068], [u + fh * 0.012, vy + fh * 0.021, z0 + h * 0.054], [u - fh * 0.012, vy + fh * 0.021, z0 + h * 0.054]], [0, 1, 0], [214, 206, 180], [255, 240, 180], dn, alpha);
          if (dn > 0) { const [gx, gy] = F(u, vy + fh * 0.04); glowPool(ctx, cam, gx, gy, z0 + h * 0.06, '255,236,170', 5, alpha * 0.6 * dn); } }
        // three cell packs stacked, yellow over black, the top one turned
        for (let k = 0; k < 3; k++) { const u = x0 + W * 0.56;
          box(u, vy, fh * 0.03, z0 + h * 0.022 * k, z0 + h * 0.022 * k + h * 0.012, 'ty_ot_yellow', fh * 0.02, 16 + k, k === 2 ? 0.4 : 0);
          box(u, vy, fh * 0.03, z0 + h * 0.022 * k + h * 0.012, z0 + h * 0.022 * (k + 1), 'ty_ot_dark', fh * 0.02, 19 + k, k === 2 ? 0.4 : 0); }
        // the rebreather: a tall yellow cylinder with a red band and a black valve
        { const u = x0 + W * 0.82;
          box(u, vy, fh * 0.018, z0, z0 + h * 0.06, 'ty_ot_yellow', fh * 0.018, 22, 0.785);
          box(u, vy, fh * 0.0185, z0 + h * 0.06, z0 + h * 0.068, 'ty_ot_red', fh * 0.0185, 23, 0.785);
          box(u, vy, fh * 0.018, z0 + h * 0.068, z0 + h * 0.10, 'ty_ot_yellow', fh * 0.018, 24, 0.785);
          box(u, vy, fh * 0.008, z0 + h * 0.10, z0 + h * 0.112, 'ty_ot_dark', fh * 0.008, 25); }
      }
      // one sheen strip across the bay's outer corner, which is how the eye knows there's glass there
      { const k = Math.max(0, 1 - dn / 0.6), yy = yb + 0.001;   // by night too: day/night pair by index
        tcGlow(ctx, cam, W3, [[x0 + W * 0.72, yy, zt], [x0 + W * 0.80, yy, zt], [x0 + W * 0.62, yy, zt - h * 0.07], [x0 + W * 0.54, yy, zt - h * 0.07]], [0, 1, 0], [170 + 30 * k, 176 + 30 * k, 180 + 30 * k], [96, 80, 60], dn, alpha * 0.35); }
    }
    // 8) THE DOOR, set back in a stone surround, oak with a glass panel, under a sunburst fanlight.
    { const x0 = -fh * 0.17, x1 = fh * 0.17, zt = h * 0.27, y = yf;
      tcFlat(ctx, cam, W3, [[x0 - fh * 0.04, y, zt + h * 0.065], [x1 + fh * 0.04, y, zt + h * 0.065], [x1 + fh * 0.04, y, 0.002], [x0 - fh * 0.04, y, 0.002]], [0, 1, 0], STONE, 'stone', alpha, dn);
      tcFlat(ctx, cam, W3, [[x0, y + 0.001, zt], [x1, y + 0.001, zt], [x1, y + 0.001, 0.002], [x0, y + 0.001, 0.002]], [0, 1, 0], [98, 66, 40], 'timber', alpha, dn);
      tcGlow(ctx, cam, W3, [[x0 + fh * 0.05, y + 0.002, zt - h * 0.02], [x1 - fh * 0.05, y + 0.002, zt - h * 0.02], [x1 - fh * 0.05, y + 0.002, h * 0.13], [x0 + fh * 0.05, y + 0.002, h * 0.13]], [0, 1, 0], WARM_D, WARM_N, 0.3 + 0.7 * dn, alpha);
      const cx = 0, cz = zt + h * 0.004, R = fh * 0.15, rays = 7;   // a quad per ray: a lone triangle is dropped by the flat path
      for (let i = 0; i < rays; i++) {   // the fan, lit from inside, in seven glazed rays
        const a0 = Math.PI * i / rays, a1 = Math.PI * (i + 1) / rays;
        tcGlow(ctx, cam, W3, [[cx + Math.cos(a0) * R * 0.12, y + 0.004, cz + Math.sin(a0) * R * 0.042 * (h / fh) * 0.35], [cx + Math.cos(a0) * R, y + 0.004, cz + Math.sin(a0) * R * (h / fh) * 0.35], [cx + Math.cos(a1) * R, y + 0.004, cz + Math.sin(a1) * R * (h / fh) * 0.35], [cx + Math.cos(a1) * R * 0.12, y + 0.004, cz + Math.sin(a1) * R * 0.042 * (h / fh) * 0.35]], [0, 1, 0], [88, 78, 60], [255, 214, 150], 0.3 + 0.7 * dn, alpha);
        if (near) emitWire(ctx, cam, W3(cx, y + 0.002, cz), W3(cx + Math.cos(a0) * R, y + 0.002, cz + Math.sin(a0) * R * (h / fh) * 0.35), 1, 'rgba(150,120,64,0.95)', alpha, { pull: 0.01 });
      }
      const [gx, gy] = F(0, y + fh * 0.06); glowPool(ctx, cam, gx, gy, zt * 0.6, '255,206,140', 10, alpha * (0.15 + 0.35 * dn), { air: true }); }
    // 9) A STONE STEP the width of the door, worn in the middle.
    { const [sx0, sy0] = F(0, yF + fh * 0.06); draw3DBoxAt(ctx, cam, sx0, sy0, fh * 0.22, 0, h * 0.012, 'ty_otoole_stone', seed + 12, night, alpha, true, yaw, fh * 0.05); }
    // 10) THE AWNINGS: green and cream striped canvas over both plate windows, rolled out, with a
    //     scalloped valance. What makes the front look open from across the street.
    for (const [a0, b0] of [[-0.82, -0.34], [0.34, 0.82]]) {
      const za = h * 0.325, zb = h * 0.265, ya = yF + fh * 0.05, yb = yF + fh * 0.20, n = 6;
      for (let i = 0; i < n; i++) {
        const x0 = fh * (a0 + (b0 - a0) * i / n), x1 = fh * (a0 + (b0 - a0) * (i + 1) / n), col = i % 2 ? [226, 214, 182] : [38, 92, 66];
        tcFlat(ctx, cam, W3, [[x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb]], [0, 0.45, 1], col, 'plain', alpha, dn);
        tcFlat(ctx, cam, W3, [[x0, yb, zb], [x1, yb, zb], [x1, yb, zb - h * 0.022], [x0, yb, zb - h * 0.022]], [0, 1, 0], col, 'plain', alpha, dn);
      }
      tcFlat(ctx, cam, W3, [[fh * a0, ya, za], [fh * b0, ya, za], [fh * b0, yb, zb], [fh * a0, yb, zb]], [0, -0.45, -1], [40, 46, 40], 'plain', alpha, dn);
    }
    // 11) WINDOW BOXES under the upper windows, painted green, with geraniums in them.
    for (const u of [-0.58, 0, 0.58]) {
      const x0 = fh * (u - 0.14), x1 = fh * (u + 0.14), z0 = h * 0.415, z1 = h * 0.43, y0 = yF, y1 = yF + fh * 0.05;
      { const [bx, by] = F(fh * u, (y0 + y1) / 2); draw3DBoxAt(ctx, cam, bx, by, fh * 0.14, z0, z1, 'ty_otoole_stone', seed + 20, night, alpha, true, yaw, (y1 - y0) / 2); }
      tcFlat(ctx, cam, W3, [[x0, y1 + 0.002, z1], [x1, y1 + 0.002, z1], [x1, y1 + 0.002, z0], [x0, y1 + 0.002, z0]], [0, 1, 0], [44, 96, 70], 'plain', alpha, dn);
      if (near) for (let k = 0; k < 6; k++) {
        const x = x0 + (x1 - x0) * (k + 0.5) / 6, zz = z1 + h * (0.008 + 0.006 * frac(seed + k * 0.37)), r = fh * 0.016;
        tcFlat(ctx, cam, W3, [[x - r, y1 - fh * 0.01, zz + h * 0.01], [x + r, y1 - fh * 0.01, zz + h * 0.01], [x + r, y1 - fh * 0.01, z1], [x - r, y1 - fh * 0.01, z1]], [0, 1, 0], k % 3 === 1 ? [62, 112, 52] : [206, 52, 48], 'plain', alpha, dn);
      }
    }
    // 12) CARRIAGE LAMPS either side of the door, brass and glass, lit at dusk.
    for (const u of [-0.25, 0.25]) {
      const [lx, ly] = F(fh * u, yF + fh * 0.04), z0 = h * 0.17, z1 = h * 0.215;
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.022, z0, z1, 'ty_otoole_stone', seed + 30, night, alpha, true, yaw, fh * 0.022);
      tcGlow(ctx, cam, W3, [[fh * (u - 0.018), yF + fh * 0.063, z1 - h * 0.006], [fh * (u + 0.018), yF + fh * 0.063, z1 - h * 0.006], [fh * (u + 0.018), yF + fh * 0.063, z0 + h * 0.006], [fh * (u - 0.018), yF + fh * 0.063, z0 + h * 0.006]], [0, 1, 0], [196, 170, 110], [255, 222, 160], dn, alpha);
      if (dn > 0) glowPool(ctx, cam, lx, ly, (z0 + z1) / 2, '255,206,140', 7, alpha * 0.6 * dn, { air: true });
    }
    // 13) THE A-BOARD on the pavement, chalked with the one offer every new clone hears.
    // ⚠ NOT ON THE NEAR TIER: the board is in the mesh at every distance, so it is lettered at every
    // distance too, or it is a blank board down the street (`signrange`).
    { const ya = yF + fh * 0.26, yb = yF + fh * 0.33, xa = fh * 0.42, xb = fh * 0.62, zt = h * 0.11;
      tcFlat(ctx, cam, W3, [[xa, ya, zt], [xb, ya, zt], [xb, yb, 0.002], [xa, yb, 0.002]], [0, 0.6, 0.3], [34, 40, 36], 'timber', alpha, dn);
      if (frontVis) {
        const P = (u, t) => { const [wx, wy] = F(u, ya + (yb - ya) * t + FACE_EPS); return cam.proj(wx, wy, zt * (1 - t)); };
        const q = [P(xa + fh * 0.015, 0.12), P(xb - fh * 0.015, 0.12), P(xb - fh * 0.015, 0.88), P(xa + fh * 0.015, 0.88)];
        const tex = bakeSignText('FIRST CUP FREE', '#efe8d6', 0, false, true, true, { font: 'marker', sub: 'HOT CHICORY. COME IN.' });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      } }
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
    // ⚠ EACH STATE IS A SHALLOW FITTING: a real `fd` plus a lid (`roof`). Without `fd`, `fh * 0.90`
    // is a square box half a tile deep, proud of the facade with an open top a depth buffer shows.
    // The depths also keep these off `deck`, which takes any roofed box within 0.02 of square.
    // ⚠ EACH STATE CENTRES AT `FRONT - fd`, so a depth change can't push the frontage into the street
    // or off the ground ("a floating roller door"). It stands 0.02 tile proud: flush is a z-fight.
    // ⚠ THE DERIVED KIT HANGS THE GROUND FLOOR ON THIS PANEL. `base` is the lowest-topped box (its z0
    // is the pavement, its face the door's plane), and it needs `base.hw > 0.1` or the kit drops the
    // ground floor and the name with it (3b, 3c). Three 0.088 boards failed that, so one panel
    // carries them now, the boards lifted clear of its top edge so they can't take `base` off it.
    // ⚠ THE SHOPFRONT IS ONE STOREY, 0.30h (`h / floors`, all four are `shop` (3)), so it doesn't grow
    // with the floors. ⚠ Not `storeyZ()`: an absolute is a `c` term the capture warns about every bake.
    // ── THE FRONTAGE, AS A LADDER OF PLANES ────────────────────────────────────────────────
    // Four surfaces share this face. The painter sorts them by `DETAIL_LIFT`; a depth buffer compares
    // them, and two at one plane z-fight. Place every part off this ladder:
    //     0.86 fh  the wall            (the mass box above)
    //     0.88 fh  the reveal          (the recess the shopfront is set into)
    //     0.90 fh  the curtain         (the `shutter` in D_VACANT, drawn by the detail layer)
    //     0.92 fh  the state's own surface
    //     0.94 fh  the grille bars
    //     0.95 fh  the letting notice
    // ── …AND THE FRONTAGE IS NOT ALL SHOP ──────────────────────────────────────────────────
    // The flats over the shop get their own street door. ⚠ `SHOPW` and `SHOPX` are mirrored in
    // D_VACANT's `shutter`; if they drift apart, the door overlaps the shutter.
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
  papertomb(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE PAPER TOMB (Hall of Records, Coldwater Municipal) — the twin of
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
  stitch(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // IRONSIDE CLINIC — the twin of Co-Pay & Pray on the `clinic` mesh, and the
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
  watts(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // WATTS THE DAMAGE — the twin of Nuts to That on the `hardware` mesh. The
    // difference is that Watts is a mechanic's garage: a tall workshop filling the tile, a roller
    // door wide enough for a car with one up on the lift inside, tyres stacked by the door and the
    // name on a fascia board fixed to the front wall. It was a small shop behind a kerbside board
    // on posts until 2026-10-29, which read as a sign in a car park.
    // Local frame: +y is the street.
    const yaw = faceYaw(E), dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh();
    const wallTop = h * 0.66, parapet = h * 0.72;
    const sx = fh * 0.92, yB = -fh * 0.92, yF = fh * 0.62, cy0 = (yB + yF) / 2, sd = (yF - yB) / 2;
    // 1) THE GARAGE: one tall storey over most of the tile, a parapet course and two roof vents.
    { const [cx, cy] = F(0, cy0);
      draw3DBoxAt(ctx, cam, cx, cy, sx, 0, wallTop, pal, seed, night, alpha, false, yaw, sd);
      draw3DBoxAt(ctx, cam, cx, cy, sx + fh * 0.03, wallTop, parapet, 'ty_watts_roller', seed + 1, night, alpha, true, yaw, sd + fh * 0.03); }
    for (const [i, u] of [[0, -0.46], [1, 0.40]]) { const [vx, vy] = F(fh * u, cy0 - fh * 0.20);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.09, parapet, parapet + h * 0.07, 'ty_unit_shut', seed + 2 + i, night, alpha, true); }
    // 2) THE ROLLER DOOR, car-wide and two-thirds up, the bay lit behind it, a door for people beside.
    const yW = yF + 0.003, dTop = h * 0.42, dUp = h * 0.28, rx0 = -fh * 0.78, rx1 = fh * 0.22;
    tcFlat(ctx, cam, W3, [[rx0 - fh * 0.03, yW, dTop + h * 0.02], [rx1 + fh * 0.03, yW, dTop + h * 0.02], [rx1 + fh * 0.03, yW, 0.002], [rx0 - fh * 0.03, yW, 0.002]], [0, 1, 0], [44, 44, 46], 'metal', alpha, dn);
    tcFlat(ctx, cam, W3, [[rx0, yW + 0.001, dTop], [rx1, yW + 0.001, dTop], [rx1, yW + 0.001, dUp], [rx0, yW + 0.001, dUp]], [0, 1, 0], [118, 104, 70], 'metal', alpha, dn);
    tcGlow(ctx, cam, W3, [[rx0, yW + 0.001, dUp], [rx1, yW + 0.001, dUp], [rx1, yW + 0.001, 0.003], [rx0, yW + 0.001, 0.003]], [0, 1, 0], [52, 48, 42], [255, 222, 160], dn, alpha);
    if (near) for (let k = 1; k < 5; k++) { const z = dUp + (dTop - dUp) * k / 5;
      emitWire(ctx, cam, W3(rx0, yW + 0.002, z), W3(rx1, yW + 0.002, z), 1, 'rgba(70,62,44,0.8)', alpha, { pull: 0.01 }); }
    // The car on the lift just inside the door, wheels off the floor: what makes it a mechanic's.
    { const [cx, cy] = F((rx0 + rx1) / 2, yF - fh * 0.30), lz = h * 0.10;
      for (const s of [-1, 1]) { const [px, py] = F((rx0 + rx1) / 2 + s * fh * 0.26, yF - fh * 0.30);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.025, 0, lz, 'ty_grind', seed + 4 + s, night, alpha, false); }
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.30, lz, lz + h * 0.07, 'ty_grind', seed + 6, night, alpha, true, yaw, fh * 0.15);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.22, lz + h * 0.07, lz + h * 0.12, 'ty_watts_roller', seed + 7, night, alpha, true, yaw, fh * 0.13); }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: fh * 0.52, y: yF + fh * 0.005, w: fh * 0.08, top: h * 0.30, leaves: 1,
      frame: [60, 58, 54], lobby: { day: [70, 62, 50], night: [255, 214, 150] }, frontVis });
    // 3) THE APRON: tarmac to the kerb, an oil stain, and tyres stacked by the door.
    const yK = fh * 1.04;
    tcFlat(ctx, cam, W3, [[-fh * 0.98, yF, 0.003], [fh * 0.98, yF, 0.003], [fh * 0.98, yK, 0.003], [-fh * 0.98, yK, 0.003]], [0, 0, 1], [58, 58, 60], 'plain', alpha, dn);
    tcFlat(ctx, cam, W3, [[-fh * 0.40, yF + fh * 0.08, 0.004], [-fh * 0.12, yF + fh * 0.08, 0.004], [-fh * 0.16, yF + fh * 0.26, 0.004], [-fh * 0.36, yF + fh * 0.24, 0.004]], [0, 0, 1], [36, 36, 38], 'plain', alpha, dn);
    for (const [i, u] of [[0, 0.78], [1, 0.86]]) { const [tx, ty] = F(fh * u, yF + fh * 0.10 + i * fh * 0.08);
      drawFacetDrum(ctx, cam, tx, ty, 0, h * (0.10 + i * 0.04), fh * 0.06, fh * 0.06, 8, alpha,
        (f) => 'rgb(' + (30 + f.nl * 22 | 0) + ',' + (30 + f.nl * 22 | 0) + ',' + (32 + f.nl * 22 | 0) + ')', 'rgb(18,18,20)'); }
    // 4) THE SIGN: a painted fascia fixed to the front wall over the door, the bulb and crossed
    //    wrenches on the left, the name and the trade in the same red at the same size. Paint, not
    //    tube, so the goosenecks light it after dark.
    const yS = yF + fh * 0.03, z0 = h * 0.45, z1 = h * 0.64, x0 = -fh * 0.86, x1 = fh * 0.86, e = fh * 0.02;
    { const [bx, by] = F(0, yF + fh * 0.015);
      draw3DBoxAt(ctx, cam, bx, by, (x1 - x0) / 2 + e, z0 - h * 0.01, z1 + h * 0.01, 'ty_grind', seed + 10, night, alpha, true, yaw, fh * 0.015); }
    tcFlat(ctx, cam, W3, [[x0, yS + 0.001, z1], [x1, yS + 0.001, z1], [x1, yS + 0.001, z0], [x0, yS + 0.001, z0]], [0, 1, 0], [226, 214, 182], 'timber', alpha, dn);
    if (frontVis) {
      const P = (u, z) => { const [wx, wy] = F(u, yS + 0.002 + FACE_EPS); return cam.proj(wx, wy, z); };
      const m0 = z0 + (z1 - z0) * 0.06, m1 = z1 - (z1 - z0) * 0.06, L = m1 - m0, a = x0 + fh * 0.03, b = a + L;
      const logo = wattsLogoTex();
      const ql = [P(a, m1), P(b, m1), P(b, m0), P(a, m0)];
      if (logo && ql.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, ql, logo, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      // Two rows of one height. `sub: false` keeps the kit from adding its own small trade line.
      const n0 = b + fh * 0.04, n1 = x1 - fh * 0.03, split = m0 + L * 0.48, gap = L * 0.04;
      const name = sign || 'WATTS THE DAMAGE', rowH = m1 - split - gap;
      const t1 = bakeSignText(name, '#a3261c', 0, false, true, true, { font: 'stencil', fit: (n1 - n0) / rowH, sub: false });
      const q1 = [P(n0, m1), P(n1, m1), P(n1, split + gap), P(n0, split + gap)];
      if (t1 && q1.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q1, t1, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      // REPAIRS gets the name's letter height, so its row is as wide as its share of the name's letters.
      const w2 = Math.min(n1 - n0, (n1 - n0) * 7 / Math.max(7, name.length)), c2 = (n0 + n1) / 2;
      const t2 = bakeSignText('REPAIRS', '#a3261c', 0, false, true, true, { font: 'stencil', fit: w2 / rowH, sub: false });
      const q2 = [P(c2 - w2 / 2, split - gap), P(c2 + w2 / 2, split - gap), P(c2 + w2 / 2, m0), P(c2 - w2 / 2, m0)];
      if (t2 && q2.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q2, t2, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
    }
    if (dn > 0) for (const u of [-0.45, 0.45]) {   // two gooseneck lamps off the wall over the board
      if (near) emitWire(ctx, cam, W3(fh * u, yF + fh * 0.006, z1 + h * 0.03), W3(fh * u, yS + fh * 0.08, z1 + h * 0.04), 1.6, 'rgba(48,50,52,0.95)', alpha, { pull: 0.02 });
      const [gx, gy] = F(fh * u, yS + fh * 0.08); glowPool(ctx, cam, gx, gy, z1, '255,226,170', 8, alpha * 0.45 * dn);
    }
    { const [lx, ly] = F((rx0 + rx1) / 2, yF + fh * 0.10);   // the bay light spilling out
      glowPool(ctx, cam, lx, ly, dUp, '255,232,180', 10, alpha * (night ? 0.55 : 0.10)); }
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
    //    ⚠ SIX, NOT SEVEN: the second rack stood where the door is (below).
    if (frontVis) { for (let i = 0; i < 7; i++) { if (i === 1) continue; const [bx, by] = F((-0.64 + i * 0.21) * fh, fh * 0.96);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.022, wallTop * 0.34, wallTop * 0.72, 'ty_sentimental_bar', seed + 20 + i, night, alpha, false); }
      const [cx, cy] = F(fh * 0.30, fh * 0.94);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.26, wallTop * 0.30, wallTop * 0.74, 'ty_tomb_glass', seed + 30, night, alpha, true, 0, fh * 0.05); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.70, ridge * 0.98, m.neon || '#ff8a2a', night, alpha, 'GRIND HOUSE');
    // 4) THE DOOR, at the forge end of the front, a glazed leaf with the hearth's light behind it.
    // ⚠ The shed had no door (the small-building grade, 2026-10-04); the kit's doorway landed inside
    //    the hearth's box and is declined for this trade.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: -fh * 0.43, y: fh * 0.94, w: fh * 0.09, top: h * 0.30, leaves: 1,
      frame: [70, 62, 56], lobby: { day: [84, 54, 36], night: [255, 140, 60] }, spill: '255,150,80', frontVis });
  },
};
