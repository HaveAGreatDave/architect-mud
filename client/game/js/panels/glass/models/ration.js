// Ration Nine: the grocery on Ironside Street.
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// How a tile becomes a building is in docs/reference/world-rendering.md.
//
// `market` is bound to the shop by name in NAMED_MODELS, with `trade: 'grocery'` and `noKit`. It
// carries nothing of Coldwater's: the two words of the logo are the record's `mark` ([word, numeral]),
// and the fascia's word is the tile's own trade word. Any grocer could be bound to it with its own mark.
import {
  DETAIL_LIFT, SHAPE_SINK, SIGN_WORD, _place, bakeSignText, clamp, draw3DBoxAt, drawFacetDrum,
  emitSurfaceText, emitWire, faceYaw, glowPool, groundPaint, nearOrMesh, reserveSignBand, tradeOf,
} from '../../windshield.js';
import { drawEntrance } from '../entrance.js';
import { drumSkin, flat } from './greenside.js';

// What's on the stands, bin by bin. Each is a base colour; a heap shades its own fruit off it.
const PRODUCE = [
  [232, 132, 36],   // oranges
  [190, 40, 36],    // apples
  [238, 210, 64],   // lemons
  [78, 142, 56],    // lettuce
  [224, 62, 44],    // tomatoes
  [98, 52, 116],    // aubergines
  [236, 198, 72],   // bananas
  [128, 176, 58],   // limes
  [226, 112, 34],   // carrots
  [168, 132, 88],   // potatoes
  [150, 190, 118],  // cabbage
  [206, 54, 76],    // red peppers
];
// What shows through the window: packets on shelves, in the colours packets come in.
const PACKETS = [[206, 60, 48], [240, 200, 70], [60, 120, 190], [236, 232, 220], [70, 150, 84], [232, 130, 44], [120, 70, 150]];
const FRUIT_SHADE = [1.0, 0.84, 0.70, 0.90];   // a fruit's four faces: back, right, front, left

// A bin of produce: a sloped bed of one colour, and close up a heap of `nx` by `ny` fruit on it.
// `y0` is the back edge (at `z1`) and `y1` the front (at `z0`), so the bed tips toward the street.
// ⚠ ADORNMENT, every face: `flat` never reaches the shape capture, so nobody collides with an orange.
// ⚠ EVERY FACE PASSES `lit`, pre-shaded here. Without it `flat` dims a face to 45% after dark, and
//    the stands stand under the awning's lamps: fruit is the one thing on this front that stays bright.
function heap(ctx, cam, W3, x0, x1, y0, y1, z0, z1, col, alpha, dn, near, nx, ny, bump) {
  const tone = (k) => col.map((v) => v * k), night = (k) => col.map((v) => v * k * 0.74);
  flat(ctx, cam, W3, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z0], [x0, y1, z0]], [0, 0.3, 1], tone(0.74), alpha, dn, night(0.74));
  if (!near) return;
  const sx = (x1 - x0) / nx, sy = (y1 - y0) / ny;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const ax = x0 + sx * i, bx = ax + sx, ay = y0 + sy * j, by = ay + sy;
    const za = z1 + (z0 - z1) * j / ny, zb = z1 + (z0 - z1) * (j + 1) / ny;
    const wob = 0.82 + 0.36 * (((i * 7 + j * 13 + nx) % 5) / 4);          // no two fruit quite the same size
    const top = [(ax + bx) / 2, (ay + by) / 2, (za + zb) / 2 + bump * wob];
    const c = [[ax, ay, za], [bx, ay, za], [bx, by, zb], [ax, by, zb]];
    const out = [[0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1]];
    for (let f = 0; f < 4; f++) {
      const k = FRUIT_SHADE[f] * (0.92 + 0.16 * ((i + j) & 1));
      flat(ctx, cam, W3, [c[f], c[(f + 1) % 4], top], out[f], tone(k), alpha, dn, night(k));
    }
  }
}

// Lettering on a face of the front, read from the street. `cx`, `zc` are its centre and `hw`, `hz`
// the half-extents of the room it may take, turned `th` radians in the wall (positive lifts the
// right-hand end as you face it); `emitSurfaceText` fits the artwork inside that.
function letter(ctx, cam, F, cx, y, zc, hw, hz, tex, alpha, th = 0) {
  if (!tex) return;
  const c = Math.cos(th), s = Math.sin(th);
  const q = [[-hw, hz], [hw, hz], [hw, -hz], [-hw, -hz]]
    .map(([u, v]) => { const [wx, wy] = F(cx + u * c - v * s, y); return cam.proj(wx, wy, zc + u * s + v * c); });
  if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.4);
}

export const RATION_ARMS = {
  // ══ THE MARKET ══════════════════════════════════════════════════════════════════════════════
  // A neighbourhood grocer's with the stockroom over it, and it has to say so before any word on it
  // can be read. So, in the order a passer-by takes it in:
  //   · THE ROUNDEL on a raised centre bay over the door: a red disc in a cream ring with a sunburst
  //     on it, the numeral standing in the top of it, and the word on a green ribbon across it on the
  //     diagonal, in script. The rings, the word and the 9 are neon, lit at every hour.
  //   · THE AWNING, green and cream, the whole width of the front, out over the pavement on posts,
  //     its valance well over a person's head.
  //   · THE STANDS under it: tiered timber, a bin of every colour, a price ticket on each.
  //   · THE WINDOWS behind them, stocked shelf by shelf, with sale bills stuck to the glass.
  //   · THE TROLLEYS, nested in a rail bay at the corner.
  //   · THE STOCKROOM FLOOR over the shop: a row of green-framed windows either side of the bay.
  // The fascia between the awning and the shop's cornice says what the place sells, in the tile's own word.
  //
  // Local frame: +y is the street (the door), ±x the flanks, −y the yard door at the back.
  //
  // ⚠ TWO STOREYS (`flags.floors: 2`), so `S` is one storey and `G` the shop floor, which is taller
  //    than a storey because it has an awning under its fascia. The shopfront and the awning are drawn
  //    in `G`; the stands, the trolleys and everything else a person stands beside in `S`; only the
  //    top cornice and the roof are fractions of `h`.
  // ⚠ THE AWNING'S VALANCE IS AT 0.62 `G`, about 2.5 m, and 2.3 m on the shortest roll: over a
  //    person's head. At 0.46 of a one-storey `h` it came down to 1.6 m and you'd have walked into it.
  //    It is a plain fraction, never a max() against metres, so the capture stays affine.
  // ⚠ THE FRONT WALL IS SET BACK to `WF`, the café's reason: the pavement in front of it belongs to
  //    the stands, and the awning's lip still lands inside the plot line. Everything on the front
  //    is measured from `WF`.
  // ⚠ THE ROUNDEL IS MEASURED IN `G` BOTH WAYS. A disc with its width in `fh` and its height in `h`
  //    is an ellipse on any tile that didn't roll the authoring pair.
  // ⚠ MASS NEVER ASKS `near`. A box is captured once for collision and shadow, so only wires and
  //    flats (the fruit, the shelves, the trolley baskets, the window bars) are shed with distance.
  market(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    const dn = night ? clamp(night, 0, 1) : 0, near = nearOrMesh(), dusk = 1 - 0.5 * dn;
    const YAW = faceYaw(E);
    const CREAM = pal || 'ty_r9_cream', GREEN = 'ty_r9_green', RED = 'ty_r9_red', WOOD = 'ty_dw_timber', STEEL = 'ty_pier_steel';
    const S = h / 2, G = S * 1.16;
    const BX = fh * 0.94, WF = fh * 0.54, WB = -fh * 0.94, YC = (WF + WB) / 2, HY = (WF - WB) / 2;
    const plinth = G * 0.04, sill = G * 0.12, glassTop = G * 0.60, head = G * 0.66;
    const fascia0 = G * 0.76, fascia1 = G * 0.94, wallTop = h * 1.00, corn0 = wallTop - S * 0.10, roofZ = h * 1.05;
    const box = (lx, ly, hw, z0, z1, p, s, roof, hd) => { const [x, y] = F(lx, ly); draw3DBoxAt(ctx, cam, x, y, hw, z0, z1, p, seed + s, night, alpha, roof, YAW, hd); };
    const drum = (lx, ly, z0, z1, rb, rt, n, base, cap, p) => { const [x, y] = F(lx, ly); drawFacetDrum(ctx, cam, x, y, z0, z1, rb, rt, n, alpha, drumSkin(base, dusk), cap, p); };
    const wire = (a, b, w, css, o) => emitWire(ctx, cam, W3(a[0], a[1], a[2]), W3(b[0], b[1], b[2]), w, css, alpha, o || { pull: 0.02 });
    const roll = (k) => { const x = Math.sin((seed + k * 7.31) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const GLASS_DAY = [58, 76, 78], GLASS_LIT = [255, 226, 170], HIGH_DAY = [84, 100, 100], HIGH_LIT = [255, 232, 184];
    const UP_DAY = [66, 82, 86], UP_LIT = [255, 214, 150], UP_DARK = [34, 40, 44];
    const o = fh * 0.016;

    // 1) THE SHELL: a slate plinth, cream render to the fascia, the green fascia right round the
    //    building, a red cornice over the shop standing proud of it, the cream stockroom floor, a red
    //    top cornice, and a cream parapet with the roof inside.
    box(0, YC, BX + o * 0.6, 0, plinth, 'ty_dw_slate', 1, false, HY + o * 0.6);
    box(0, YC, BX, plinth, fascia0, CREAM, 0, false, HY);
    box(0, YC, BX + o * 0.5, fascia0, fascia1, GREEN, 2, false, HY + o * 0.5);
    box(0, YC, BX + o * 1.4, fascia1, G, RED, 3, true, HY + o * 1.4);
    box(0, YC, BX, G, corn0, CREAM, 14, false, HY);
    box(0, YC, BX + o * 1.0, corn0, wallTop, RED, 15, false, HY + o * 1.0);
    box(0, YC, BX - o * 0.2, wallTop, roofZ, CREAM, 4, true, HY - o * 0.2);

    // 2) THE STOCKROOM FLOOR's windows: green frames, a cream sill on the front ones, a glazing bar
    //    and a transom close up, and each lit or dark after dark by its own roll.
    //    `wall` is 'y' for a face on the plane y = at, or 'x' for one on x = at; `s` is its outward sign.
    const R = G * 0.50, BW = R * 1.28;   // the roundel's radius, and the half-width of the bay that carries it
    const FD = fh * 0.006, fw = fh * 0.012;
    const pane = (wall, s, at, u, z0, z1, hw, k, sillOn) => {
      const lit = roll(k) < 0.45, g = at + s * (FD * 2 + 0.0015), zm = z0 + (z1 - z0) * 0.62;
      const bar = 'rgba(28,76,48,0.95)';
      if (wall === 'y') {
        box(u, at + s * FD, hw + fw, z0 - fw, z1 + fw, GREEN, 130 + k, true, FD);
        if (sillOn) box(u, at + s * FD * 2, hw + fw * 1.6, z0 - fw - S * 0.035, z0 - fw, CREAM, 150 + k, true, FD * 2);
        const a = u - s * hw, b = u + s * hw;
        flat(ctx, cam, W3, [[a, g, z1], [b, g, z1], [b, g, z0], [a, g, z0]], [0, s, 0], UP_DAY, alpha, dn, lit ? UP_LIT : UP_DARK);
        if (near && !SHAPE_SINK) { wire([u, g + s * 0.0008, z0], [u, g + s * 0.0008, zm], 1.2, bar); wire([a, g + s * 0.0008, zm], [b, g + s * 0.0008, zm], 1.2, bar); }
      } else {
        box(at + s * FD, u, FD, z0 - fw, z1 + fw, GREEN, 130 + k, true, hw + fw);
        const a = u + s * hw, b = u - s * hw;
        flat(ctx, cam, W3, [[g, a, z1], [g, b, z1], [g, b, z0], [g, a, z0]], [s, 0, 0], UP_DAY, alpha, dn, lit ? UP_LIT : UP_DARK);
        if (near && !SHAPE_SINK) { wire([g + s * 0.0008, u, z0], [g + s * 0.0008, u, zm], 1.2, bar); wire([g + s * 0.0008, a, zm], [g + s * 0.0008, b, zm], 1.2, bar); }
      }
    };
    const uz0 = G + S * 0.18, uz1 = G + S * 0.60;
    {
      const a = BW + fh * 0.05, b = BX - fh * 0.07, span = b - a, hw = span * 0.17;
      let k = 0;
      for (const s of [-1, 1]) for (const t of [0.25, 0.75]) pane('y', 1, WF, s * (a + span * t), uz0, uz1, hw, k++, true);
      for (const s of [-1, 1]) for (const t of [-0.56, -0.08, 0.40]) pane('x', s, s * BX, YC + HY * t, uz0, uz1, HY * 0.13, k++, false);
      for (const u of [-0.55, 0, 0.55]) pane('y', -1, WB, fh * u, uz0, uz1, fh * 0.10, k++, false);
    }

    // 3) THE BAY over the door: a cream pier standing proud of the stockroom floor, from the shop's
    //    cornice up through the parapet to a stepped top capped in red, with stepped shoulders on the
    //    parapet either side and a buttress on the roof behind it.
    // ⚠ THE BUTTRESS IS MASONRY, NOT A PAIR OF STAY WIRES. From three headings a raking stay drew
    //    across the roundel, and `signfit` caught it.
    const yP = WF + fh * 0.026, PD = fh * 0.06, PY = yP - PD;      // the bay's face, half-depth and centre line
    const zc = corn0, pedTop = zc + R * 1.16;
    box(0, PY, BW, G, pedTop, CREAM, 8, true, PD);
    box(0, PY, BW + o * 0.6, pedTop, pedTop + S * 0.05, RED, 9, true, PD * 1.15);
    box(0, PY, BW + R * 0.50, wallTop, wallTop + S * 0.20, CREAM, 6, true, PD * 0.8);
    box(0, PY, BW + R * 0.56, wallTop + S * 0.20, wallTop + S * 0.235, GREEN, 7, true, PD * 0.9);
    box(0, PY - PD - fh * 0.07, R * 0.62, roofZ - S * 0.02, pedTop - R * 0.35, CREAM, 5, true, fh * 0.07);

    // 4) THE ROUNDEL. A cream ring with a green line in it, the red disc inside, a sunburst on the
    //    disc, a ring of bulbs, the word on a green ribbon across the upper half, tipped up 15 degrees
    //    with its swallowtails folded behind, and the numeral under it in the lower half.
    // ⚠ THE WORD GOES OVER THE NUMERAL, NEVER UNDER IT. With the 9 on top it read "9 rations".
    // ⚠ EVERY RING IS ITS OWN CONVEX FAN, a hair in front of the one under it, never one annulus: the
    //    mesh fans a face from its first vertex, and a ring handed over whole arrives as a filled disc.
    //    The ribbon's swallowtail is three triangles for the same reason.
    // ⚠ THE NUMERAL STOPS BELOW THE RIBBON. Both are decals with the same lift, so where they overlap
    //    neither is reliably in front.
    const mark = m.mark || [String(name || ''), ''];
    reserveSignBand(R * 1.1, zc, { floor: zc - R, wallTop: zc + R, wall: BW });
    {
      const N = 28, ring = (r, y) => Array.from({ length: N }, (_, k) => { const a = k / N * Math.PI * 2; return [Math.cos(a) * r, y, zc + Math.sin(a) * r]; });
      // After dark the painted faces go down to the colour of an unlit sign, so the tubes are the light.
      flat(ctx, cam, W3, ring(R, yP + 0.0015), [0, 1, 0], [238, 230, 206], alpha, dn, [92, 86, 74]);
      flat(ctx, cam, W3, ring(R * 0.95, yP + 0.0020), [0, 1, 0], [30, 92, 56], alpha, dn, [14, 40, 26]);
      flat(ctx, cam, W3, ring(R * 0.92, yP + 0.0025), [0, 1, 0], [238, 230, 206], alpha, dn, [92, 86, 74]);
      flat(ctx, cam, W3, ring(R * 0.87, yP + 0.0030), [0, 1, 0], [192, 40, 34], alpha, dn, [112, 20, 18]);
      // The sunburst: sixteen rays from the middle, every other one a lighter red.
      for (let k = 0; k < 16; k += 2) {
        const a0 = k / 16 * Math.PI * 2, a1 = (k + 1) / 16 * Math.PI * 2, r = R * 0.86, y = yP + 0.0035;
        flat(ctx, cam, W3, [[0, y, zc], [Math.cos(a0) * r, y, zc + Math.sin(a0) * r], [Math.cos(a1) * r, y, zc + Math.sin(a1) * r]], [0, 1, 0], [214, 70, 52], alpha, dn, [140, 30, 24]);
      }
      if (near && !SHAPE_SINK) for (let k = 0; k < 24; k++) {   // the bulbs round the inside of the ring
        const a = (k + 0.5) / 24 * Math.PI * 2, cx = Math.cos(a) * R * 0.81, cz = zc + Math.sin(a) * R * 0.81, d = R * 0.022, y = yP + 0.0040;
        flat(ctx, cam, W3, [[cx - d, y, cz + d], [cx + d, y, cz + d], [cx + d, y, cz - d], [cx - d, y, cz - d]], [0, 1, 0], [240, 226, 196], alpha, dn, [255, 236, 190]);
      }
      // THE TUBES, on day and night, because the shop never shuts. Each run is drawn twice, the way
      // lit neon looks: a wide halo in the gas's colour and a thin core, two parts white to one of the
      // gas, so it reads as glass with light in it rather than a coloured line, and a red tube still
      // reads red beside a white one. Brighter after dark, never off.
      // ⚠ NEAR ONLY, as every wire here. From further off the halo pools below carry it.
      let tube = null;
      if (near && !SHAPE_SINK) {
        const lift = 0.0045, on = 0.55 + 0.45 * dn;
        tube = (pts, rgb, closed) => {
          const tint = rgb.split(',').map((v) => Math.round(255 * 0.62 + +v * 0.38)).join(',');
          const halo = `rgba(${rgb},${(0.34 * on).toFixed(3)})`, core = `rgba(${tint},${(0.75 + 0.2 * on).toFixed(3)})`;
          for (let k = 0; k < pts.length - (closed ? 0 : 1); k++) {
            const a = pts[k], b = pts[(k + 1) % pts.length];
            wire(a, b, 5.2, halo, { pull: 0.02, glow: 7 + 9 * dn, glowCss: `rgb(${rgb})` });
            wire(a, b, 1.6, core, { pull: 0.021, glow: 3 + 3 * dn, glowCss: `rgb(${rgb})` });
          }
        };
        tube(ring(R * 0.975, yP + lift), '255,214,150', true);    // the outer ring, warm white
        tube(ring(R * 0.895, yP + lift), '255,58,46', true);      // the inner ring, red
      }
      // The ribbon, centred above the middle and tipped up to the right.
      const TH = Math.PI / 12, cs = Math.cos(TH), sn = Math.sin(TH), rz = zc + R * 0.38;
      const P = (u, v, y) => [u * cs - v * sn, y, rz + u * sn + v * cs];
      const quad = (u0, u1, v0, v1, y) => [P(u0, v1, y), P(u1, v1, y), P(u1, v0, y), P(u0, v0, y)];
      if (mark[1]) {
        for (const s of [-1, 1]) {   // the swallowtails, a shade darker and a touch lower, behind the band
          const y = yP + 0.0048, ui = s * R * 0.90, uo = s * R * 1.20, un = s * R * 1.07, vt = R * 0.11, vb = -R * 0.21, vn = -R * 0.05;
          const D = [22, 70, 44], DL = [30, 92, 58];
          flat(ctx, cam, W3, [P(ui, vt, y), P(uo, vt, y), P(un, vn, y)], [0, 1, 0], D, alpha, dn, DL);
          flat(ctx, cam, W3, [P(ui, vb, y), P(un, vn, y), P(uo, vb, y)], [0, 1, 0], D, alpha, dn, DL);
          flat(ctx, cam, W3, [P(ui, vt, y), P(un, vn, y), P(ui, vb, y)], [0, 1, 0], D, alpha, dn, DL);
        }
        flat(ctx, cam, W3, quad(-R * 0.98, R * 0.98, -R * 0.19, R * 0.19, yP + 0.0052), [0, 1, 0], [238, 230, 206], alpha, dn, [92, 86, 74]);
        flat(ctx, cam, W3, quad(-R * 0.96, R * 0.96, -R * 0.165, R * 0.165, yP + 0.0056), [0, 1, 0], [34, 104, 64], alpha, dn, [12, 38, 24]);
        if (tube) tube(quad(-R * 0.965, R * 0.965, -R * 0.175, R * 0.175, yP + 0.0060), '120,255,176', true);   // a mint tube round the ribbon
      }
      // THE NUMERAL AND THE WORD ARE BENT TUBE, lit at every hour (`dn` 1, `solid` false): a pink
      // script word on the ribbon and a warm gold 9, each with a dark outline round it.
      // ⚠ THE DISC IS NOT A LIGHTBOX ANY MORE. A tube 9 on a lit disc bloomed into a white blob from
      //    across the street; on a dark disc the tube is the only light, so the figure keeps its shape.
      // ⚠ THE WORD IS AUTHORED 'Ration', NEVER 'RATION'. `deadNeon` rolls on the label as written, and
      //    'RATION' rolls a dead letter, which a shop open all hours doesn't have.
      // ⚠ THE OUTLINE IS EIGHT PAINTED COPIES, nudged `d` each way round, behind the tube. The sign
      //    baker has no outline of its own, and a painted bake of the same word in the same hand is
      //    laid out exactly as the tube one is, so the copies sit true round the letters.
      const outlined = (label, ink, keyline, font, cx, y, z, hw, hz, th, d) => {
        const tex = bakeSignText(label, ink, 1, false, false, true, { font, sub: false });
        const edge = bakeSignText(label, keyline, 0, false, true, true, { font, sub: false });
        if (edge) for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2;
          letter(ctx, cam, F, cx + Math.cos(a) * d, y - 0.0005, z + Math.sin(a) * d, hw, hz, edge, alpha, th);
        }
        letter(ctx, cam, F, cx, y, z, hw, hz, tex, alpha, th);
      };
      if (frontVis) {
        if (mark[1]) {
          outlined(mark[1], '#ffcf6e', '#1c0605', 'estate', R * 0.16, yP + 0.0047, zc - R * 0.34, R * 0.60, R * 0.60, 0, R * 0.022);
          const [ux, , uz] = P(0, 0, 0);
          outlined(mark[0], '#ff5c8a', '#041a0e', 'script', ux, yP + 0.0066, uz, R * 0.96, R * 0.31, TH, R * 0.013);
        } else {
          outlined(mark[0], '#ff5c8a', '#041a0e', 'script', 0, yP + 0.0045, zc, R * 0.74, R * 0.30, 0, R * 0.013);
        }
      }
      // The light the sign throws: a red halo on the bay round the disc, a pink one off the word, the
      // wash down the stockroom floor, and its colour on the pavement and the awning's top.
      const [gx, gy] = F(0, yP + fh * 0.05), [px, py] = F(0, WF + fh * 0.30);
      glowPool(ctx, cam, gx, gy, zc, '255,70,56', 22, alpha * (night ? 0.34 * dn : 0.06));
      glowPool(ctx, cam, gx, gy, rz, '255,92,138', 16, alpha * (night ? 0.26 * dn : 0.04));
      glowPool(ctx, cam, gx, gy, zc - R * 1.1, '255,190,140', 18, alpha * (night ? 0.18 * dn : 0));
      if (night) glowPool(ctx, cam, px, py, fascia0 + 0.003, '255,96,110', 20, alpha * 0.16 * dn);
    }

    // 5) THE SHOPFRONT. A green stallriser, two runs of plate glass either side of the doors, green
    //    mullions, a transom bar, and cream piers at the corners and the door.
    // ⚠ THE GLASS IS UNLIT FACES, NOT A PALETTE SLAB, the café's reason: after dark it's a lit shop
    //    seen from the street, and a palette slab would dim with the wall.
    const DW = fh * 0.105, yG = WF + fh * 0.012;
    const BAYS = [[-BX * 0.94, -DW - fh * 0.06], [DW + fh * 0.06, BX * 0.94]];
    box(0, WF + fh * 0.012, BX * 0.97, plinth, sill, GREEN, 10, true, fh * 0.014);
    box(0, WF + fh * 0.020, BX * 0.97, glassTop, head, GREEN, 11, true, fh * 0.012);
    for (const [a, b] of BAYS) {
      flat(ctx, cam, W3, [[a, yG + 0.002, glassTop], [b, yG + 0.002, glassTop], [b, yG + 0.002, sill], [a, yG + 0.002, sill]], [0, 1, 0], GLASS_DAY, alpha, dn, GLASS_LIT);
      for (const t of [0, 1 / 3, 2 / 3, 1]) box(a + (b - a) * t, WF + fh * 0.022, fh * 0.011, sill, glassTop, GREEN, 12, false, fh * 0.011);
    }
    for (const x of [-BX * 0.985, BX * 0.985]) box(x, WF + fh * 0.018, fh * 0.03, plinth, fascia0, CREAM, 13, false, fh * 0.02);
    // Behind the glass: three shelves a bay, packed, and the sale bills stuck up in front of them.
    if (near && !SHAPE_SINK) BAYS.forEach(([a, b], bi) => {
      const n = 12, w = (b - a) / n;
      for (let r = 0; r < 3; r++) {
        const z0 = sill + (glassTop - sill) * (0.10 + r * 0.30), z1 = z0 + (glassTop - sill) * 0.19;
        for (let k = 0; k < n; k++) {
          const c = PACKETS[(k * 3 + r * 5 + bi * 2) % PACKETS.length], x0 = a + w * (k + 0.10), x1 = a + w * (k + 0.90);
          flat(ctx, cam, W3, [[x0, yG + 0.0034, z1], [x1, yG + 0.0034, z1], [x1, yG + 0.0034, z0], [x0, yG + 0.0034, z0]], [0, 1, 0], c.map((v) => v * 0.62), alpha, dn, c);
        }
        wire([a, yG + 0.004, z0], [b, yG + 0.004, z0], 1.2, dn > 0.5 ? 'rgba(120,96,60,0.9)' : 'rgba(30,36,36,0.9)');
      }
      // Two bills a bay: a red one and a yellow one, each with a pale band where the price goes.
      [[0.16, 0.30, [214, 44, 38]], [0.60, 0.20, [244, 206, 60]]].forEach(([t, wd, c], pi) => {
        if (bi === 1 && pi === 0) return;   // the OPEN 24 HOURS tube hangs where that bill would be
        const x0 = a + (b - a) * (bi ? 1 - t - wd : t), x1 = x0 + (b - a) * wd;
        const z0 = sill + (glassTop - sill) * (pi ? 0.50 : 0.38), z1 = z0 + (glassTop - sill) * (pi ? 0.34 : 0.44), y = yG + 0.0048;
        flat(ctx, cam, W3, [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], c, alpha, dn, c.map((v) => v * 0.9));
        const b0 = z0 + (z1 - z0) * 0.18, b1 = z0 + (z1 - z0) * 0.52, ix = (x1 - x0) * 0.12;
        flat(ctx, cam, W3, [[x0 + ix, y + 0.0012, b1], [x1 - ix, y + 0.0012, b1], [x1 - ix, y + 0.0012, b0], [x0 + ix, y + 0.0012, b0]], [0, 1, 0], [246, 242, 228], alpha, dn, [250, 244, 224]);
      });
    });
    // OPEN 24 HOURS, in red tube hung inside the right-hand window, lit day and night. It's the one
    // thing on the front that says the hours, and the shop's keeper is on the timetable round the clock.
    if (frontVis) {
      const [a, b] = BAYS[1], cx = a + (b - a) * 0.68, zO = sill + (glassTop - sill) * 0.60;
      const tex = bakeSignText('OPEN 24 HOURS', '#ff3b2e', 1, false, false, true, { font: 'tube', sub: false });
      letter(ctx, cam, F, cx, yG + 0.0056, zO, (b - a) * 0.27, (glassTop - sill) * 0.16, tex, alpha);
      const [ox, oy] = F(cx, yG + fh * 0.02);
      glowPool(ctx, cam, ox, oy, zO, '255,59,46', 9, alpha * (0.10 + 0.30 * dn));
    }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: 0, y: WF + fh * 0.012, w: DW, z0: plinth, top: glassTop, leaves: 2, frameW: fh * 0.014, depth: 0.006,
      frame: [28, 84, 54], lobby: { day: [120, 128, 112], night: [255, 230, 176] }, lamp: '255,230,180', mat: true, frontVis });

    // 6) THE TRADE WORD, once, across the middle of the fascia, in the tile's own word
    //    (`flags.sign_trade`) or the model's. The name is the roundel's; the fascia never repeats it.
    {
      const word = (_place && _place.trd) || SIGN_WORD[tradeOf(m)] || '';
      const zF = (fascia0 + fascia1) / 2, yF = WF + o * 0.5 + 0.004;
      if (word && frontVis) {
        const tex = bakeSignText(word, '#f6ecc8', night ? 1 : 0, false, false, true, { font: 'showcard', sub: false });
        letter(ctx, cam, F, 0, yF, zF, BX * 0.62, (fascia1 - fascia0) * 0.40, tex, alpha);
      }
    }

    // 7) THE AWNING: green and cream stripes from under the fascia out over the pavement, a
    //    scalloped valance, and four steel posts under the lip so it's a market canopy, not a blind.
    //    The valance's points come down to 0.62 `G`: see the ⚠ at the top.
    const yW = WF + fh * 0.03, yL = WF + fh * 0.42, zW = fascia0 - G * 0.005, val = G * 0.06, zL = G * 0.62 + val;
    {
      const n = 15, STRIPE = [[34, 104, 64], [236, 228, 204]];
      for (let i = 0; i < n; i++) {
        // Age: the green has gone a little pale with the sun, the most at the west end, and one
        // panel near the door is a newer replacement, a shade deeper than its neighbours.
        const fade = (i & 1) ? 0 : (i === 8 ? -0.06 : 0.10 + 0.10 * roll(200 + i) + 0.06 * (1 - i / n));
        const x0 = -BX + 2 * BX * i / n, x1 = -BX + 2 * BX * (i + 1) / n, xm = (x0 + x1) / 2;
        const c = STRIPE[i & 1].map((v, j) => Math.round(v + ([236, 228, 204][j] - v) * fade));
        flat(ctx, cam, W3, [[x0, yW, zW], [x1, yW, zW], [x1, yL, zL], [x0, yL, zL]], [0, 0.5, 0.86], c, alpha, dn);
        flat(ctx, cam, W3, [[x0, yL, zL], [x1, yL, zL], [x1, yL, zL - val * 0.55], [xm, yL, zL - val], [x0, yL, zL - val * 0.55]], [0, 1, 0], c.map((v) => v * 0.94), alpha, dn);
        flat(ctx, cam, W3, [[x0, yL, zL - 0.001], [x1, yL, zL - 0.001], [x1, yW, zW - 0.001], [x0, yW, zW - 0.001]], [0, -0.5, -0.86], c.map((v) => v * 0.62), alpha, dn, c.map((v) => v * 0.80));
      }
      for (const s of [-1, 1]) {   // the two ends, closed with a cream gusset
        flat(ctx, cam, W3, [[s * BX, yW, zW], [s * BX, yL, zL], [s * BX, yL, zL - val * 0.55], [s * BX, yW, zL - val * 0.55]], [s, 0, 0], [226, 218, 194], alpha, dn);
      }
      for (const x of [-BX * 0.97, -DW - fh * 0.10, DW + fh * 0.10, BX * 0.97]) box(x, yL - fh * 0.012, fh * 0.008, 0, zL - val * 0.5, STEEL, 20, false, fh * 0.008);
      box(0, yL - fh * 0.012, BX * 0.98, zL - val * 0.5, zL - val * 0.5 + S * 0.012, STEEL, 21, false, fh * 0.008);   // the lip rail the posts carry
      if (night) for (const x of [-BX * 0.6, 0, BX * 0.6]) {
        const [gx, gy] = F(x, WF + fh * 0.24);
        glowPool(ctx, cam, gx, gy, S * 0.30, '255,232,186', 13, alpha * 0.42 * dn);
      }
      if (night) { const [gx, gy] = F(0, WF + fh * 0.30); glowPool(ctx, cam, gx, gy, 0.004, '255,222,170', 26, alpha * 0.30 * dn); }
    }

    // 8) THE STANDS. Three of them under the awning: a back tier against the glass and a front tier
    //    a step lower, three bins to a tier, and two crates on the pavement at the foot of each.
    //    [centre x, half-width] in `fh`; the door and the trolley bay keep the gaps.
    const STANDS = [[-0.735, 0.165], [-0.375, 0.165], [0.375, 0.165]];
    STANDS.forEach(([sx, sw], si) => {
      const cx = sx * fh, hw = sw * fh, s0 = 30 + si * 10;
      const TIERS = [[WF + fh * 0.085, fh * 0.050, S * 0.30], [WF + fh * 0.190, fh * 0.050, S * 0.19]];   // [centre y, half-depth, front rim height]
      TIERS.forEach(([ty, td, tz], ti) => {
        box(cx, ty, hw, 0, tz, WOOD, s0 + ti, true, td);
        box(cx, ty + td + fh * 0.004, hw, tz, tz + S * 0.022, WOOD, s0 + 2 + ti, true, fh * 0.004);       // the front board that keeps the fruit in
        for (let k = 0; k < 3; k++) {
          const x0 = cx - hw + (2 * hw) * k / 3 + fh * 0.006, x1 = cx - hw + (2 * hw) * (k + 1) / 3 - fh * 0.006;
          const col = PRODUCE[(si * 6 + ti * 3 + k) % PRODUCE.length];
          heap(ctx, cam, W3, x0, x1, ty - td, ty + td, tz + S * 0.012, tz + S * 0.070, col, alpha, dn, near, 3, 3, S * 0.022);
          if (near && frontVis) {   // the price ticket, standing on the front board
            const xm = (x0 + x1) / 2, t = fh * 0.016, yT = ty + td + fh * 0.009, z0 = tz + S * 0.024;
            flat(ctx, cam, W3, [[xm - t, yT, z0 + S * 0.040], [xm + t, yT, z0 + S * 0.040], [xm + t, yT, z0], [xm - t, yT, z0]], [0, 1, 0], [246, 242, 226], alpha, dn, [250, 244, 222]);
          }
        }
      });
      for (const [k, ox] of [[0, -0.5], [1, 0.5]]) {   // two crates at its foot, tipped up to show what's in them
        const ccx = cx + ox * hw, cw = hw * 0.42, cy = WF + fh * 0.300;
        box(ccx, cy, cw, 0, S * 0.085, WOOD, s0 + 5 + k, true, fh * 0.040);
        heap(ctx, cam, W3, ccx - cw * 0.9, ccx + cw * 0.9, cy - fh * 0.036, cy + fh * 0.036, S * 0.090, S * 0.118, PRODUCE[(si * 4 + k * 5 + 9) % PRODUCE.length], alpha, dn, near, 3, 2, S * 0.020);
      }
    });
    // The chalk board by the door: today's prices, four lines.
    { const bx = DW + fh * 0.165, by = WF + fh * 0.345, bw = fh * 0.040, bz1 = S * 0.26;
      box(bx, by, bw, 0, bz1, 'ty_door', 60, true, fh * 0.009);
      if (near && frontVis && !SHAPE_SINK) for (let k = 0; k < 4; k++) {
        const z = bz1 * (0.84 - k * 0.19), l = bw * (1.5 - 0.3 * ((k * 3 + 1) % 3));
        wire([bx - bw * 0.75, by + fh * 0.0105, z], [bx - bw * 0.75 + l, by + fh * 0.0105, z], 1.1, 'rgba(236,232,220,0.9)');
      } }

    // 9) THE TROLLEY BAY at the +x corner: five trolleys nested nose to tail between two steel
    //    hoops. The chassis and the red handle are mass; the basket is wire, and only close up.
    {
      const y0 = WF + fh * 0.15, hy = fh * 0.036, len = fh * 0.105, pitch = fh * 0.045, xa = fh * 0.585;
      const zb = S * 0.17, zt = S * 0.40;
      for (let k = 0; k < 5; k++) {
        const x0 = xa + k * pitch, x1 = x0 + len;
        box((x0 + x1) / 2, y0, len / 2, S * 0.045, S * 0.065, STEEL, 70 + k, true, hy * 0.8);                // the chassis
        box(x0 + fh * 0.004, y0, fh * 0.004, zt, zt + S * 0.022, RED, 76 + k, true, hy * 1.05);              // the handle
        if (!near || SHAPE_SINK) continue;
        const C = 'rgba(176,184,190,0.92)', A = [[x0, y0 - hy], [x1, y0 - hy * 0.8], [x1, y0 + hy * 0.8], [x0, y0 + hy]];
        for (let i = 0; i < 4; i++) {
          const p = A[i], q = A[(i + 1) % 4];
          wire([p[0], p[1], zt], [q[0], q[1], zt], 1.2, C);
          if (k === 4 || i !== 1) wire([p[0], p[1], zb], [q[0], q[1], zb], 1.0, C);
          wire([p[0], p[1], zb], [p[0], p[1], zt], 1.0, C);
        }
        wire([x0, y0 - hy, S * 0.065], [x0, y0 - hy, zb], 1.0, C); wire([x0, y0 + hy, S * 0.065], [x0, y0 + hy, zb], 1.0, C);
      }
      const xe = xa + 4 * pitch + len + fh * 0.012;
      for (const s of [-1, 1]) {
        const yy = y0 + s * (hy + fh * 0.022);
        for (const x of [xa - fh * 0.012, xe]) box(x, yy, fh * 0.006, 0, S * 0.24, STEEL, 82, false, fh * 0.006);
        box((xa + xe) / 2 - fh * 0.006, yy, (xe - xa) / 2 + fh * 0.012, S * 0.24, S * 0.255, STEEL, 83, true, fh * 0.006);
      }
    }

    // 10) THE FLANKS: three high windows each into the shop, lit from it after dark, a downpipe at
    //     the back corner, and on the −x side the empties stacked for the morning. The stockroom's
    //     windows over them are in (2).
    for (const s of [-1, 1]) {
      const xF = s * (BX + 0.0025);
      for (const t of [-0.56, -0.08, 0.40]) {
        const yc = YC + HY * t, hw = HY * 0.17;
        box(s * (BX + fh * 0.006), yc, fh * 0.008, G * 0.37, G * 0.59, GREEN, 90, true, hw + fh * 0.012);
        flat(ctx, cam, W3, [[xF + s * fh * 0.016, yc + hw * s, G * 0.57], [xF + s * fh * 0.016, yc - hw * s, G * 0.57], [xF + s * fh * 0.016, yc - hw * s, G * 0.39], [xF + s * fh * 0.016, yc + hw * s, G * 0.39]], [s, 0, 0], HIGH_DAY, alpha, dn, HIGH_LIT);
      }
      const [px, py] = F(s * (BX + fh * 0.022), WB + fh * 0.06);
      drawFacetDrum(ctx, cam, px, py, 0, roofZ, fh * 0.011, fh * 0.011, 6, alpha, drumSkin([70, 78, 76], dusk), null, STEEL);
      if (night) { const [gx, gy] = F(s * (BX + fh * 0.10), YC); glowPool(ctx, cam, gx, gy, S * 0.3, '255,226,176', 12, alpha * 0.26 * dn); }
    }
    for (const [k, y, n] of [[0, -fh * 0.30, 3], [1, -fh * 0.46, 2], [2, -fh * 0.62, 4]]) {
      for (let i = 0; i < n; i++) box(-BX - fh * 0.060, y, fh * 0.050, S * 0.075 * i, S * 0.075 * i + S * 0.066, i & 1 ? GREEN : WOOD, 100 + k * 4 + i, true, fh * 0.060);
    }

    // 11) THE YARD DOOR at the back: a roller shutter a van backs up to, yellow posts either side of
    //     it, a pallet of crates, the bins, and the lamp over the door.
    {
      const yB = WB - 0.0025, a = -fh * 0.60, b = -fh * 0.12, top = G * 0.60;
      box((a + b) / 2, WB - fh * 0.006, (b - a) / 2 + fh * 0.03, top, top + S * 0.07, STEEL, 110, true, fh * 0.016);   // the roller housing
      flat(ctx, cam, W3, [[b, yB, top], [a, yB, top], [a, yB, plinth], [b, yB, plinth]], [0, -1, 0], [128, 134, 136], alpha, dn);
      if (near && !SHAPE_SINK) for (let k = 1; k < 8; k++) {
        const z = plinth + (top - plinth) * k / 8;
        wire([a, yB - 0.001, z], [b, yB - 0.001, z], 1.0, 'rgba(70,76,78,0.85)');
      }
      for (const x of [a - fh * 0.05, b + fh * 0.05]) drum(x, WB - fh * 0.05, 0, S * 0.26, fh * 0.014, fh * 0.014, 8, [226, 190, 52], 'rgb(226,190,52)', 'ty_fuel_white');
      box(fh * 0.20, WB - fh * 0.10, fh * 0.10, 0, S * 0.035, 'ty_pallet', 112, true, fh * 0.08);
      for (const [k, cx, cz] of [[0, 0.145, 0], [1, 0.255, 0], [2, 0.20, 1]]) {
        const z0 = S * 0.035 + cz * S * 0.085;
        box(fh * cx, WB - fh * 0.10, fh * 0.050, z0, z0 + S * 0.08, k === 2 ? WOOD : GREEN, 113 + k, true, fh * 0.060);
      }
      for (const [k, x] of [[0, 0.50], [1, 0.66]]) box(fh * x, WB - fh * 0.075, fh * 0.060, 0, S * 0.25, k ? 'ty_dw_slate' : GREEN, 117 + k, true, fh * 0.060);
      const [lx, ly] = F((a + b) / 2, WB - fh * 0.08);
      glowPool(ctx, cam, lx, ly, top + S * 0.10, '255,226,176', 9, alpha * (night ? 0.6 * dn : 0.05));
    }

    // 12) THE ROOF, which a pilot sees before any of the rest: two cold-store condensers with their
    //     fans, the duct between them, a lit rooflight over the stairs and the hatch.
    {
      const z = roofZ - S * 0.012;   // the deck, inside the parapet
      for (const [k, x] of [[0, -0.52], [1, -0.20]]) {
        box(fh * x, -fh * 0.58, fh * 0.115, z, z + S * 0.19, 'ty_wh_metal', 120 + k, true, fh * 0.10);
        drum(fh * x, -fh * 0.58, z + S * 0.19, z + S * 0.215, fh * 0.070, fh * 0.070, 12, [64, 70, 74], 'rgb(26,30,32)', 'ty_door');
      }
      box(-fh * 0.36, -fh * 0.36, fh * 0.035, z, z + S * 0.10, 'ty_wh_metal', 123, true, fh * 0.14);
      box(fh * 0.34, -fh * 0.22, fh * 0.30, z, z + S * 0.07, CREAM, 124, false, fh * 0.13);                 // the rooflight's kerb
      { const x0 = fh * 0.06, x1 = fh * 0.62, y0 = -fh * 0.33, y1 = -fh * 0.11, zt = z + S * 0.07 + 0.0015;
        flat(ctx, cam, W3, [[x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt]], [0, 0, 1], [150, 172, 178], alpha, dn, [255, 238, 196]);
        if (near && !SHAPE_SINK) for (const t of [0.25, 0.5, 0.75]) wire([x0 + (x1 - x0) * t, y0, zt + 0.001], [x0 + (x1 - x0) * t, y1, zt + 0.001], 1.2, 'rgba(60,70,72,0.9)');
        if (night) { const [gx, gy] = F(fh * 0.34, -fh * 0.22); glowPool(ctx, cam, gx, gy, zt + 0.004, '255,236,190', 12, alpha * 0.34 * dn, { air: true }); } }
      box(fh * 0.66, -fh * 0.02, fh * 0.07, z, z + S * 0.11, 'ty_dw_slate', 125, true, fh * 0.07);          // the hatch
    }

    // 13) THE PAVEMENT under the awning: a pale apron the width of the front, so the stands stand on
    //     the shop's own ground and not the street's.
    if (!SHAPE_SINK) groundPaint(ctx, cam, [F(-BX, WF), F(BX, WF), F(BX, yL + fh * 0.02), F(-BX, yL + fh * 0.02)], 0.0012, dn > 0.5 ? 'rgba(120,112,96,0.55)' : 'rgba(196,188,170,0.62)', alpha);

    // 14) AGE. It's an old shop that somebody looks after: swept, painted, but forty winters on it.
    //     Rain has drawn faint streaks down the render from each upper sill, the bottom of the render
    //     is a shade darker where the splash reaches it, one flank has a newer patch of render that
    //     hasn't weathered to match, and the step in front of the door is worn into a pale hollow.
    //     All flats, so the capture stays affine and the Lite bake keeps them.
    {
      const STREAK = [206, 196, 170], GRIME = [182, 172, 148], PATCH = [240, 234, 212];
      const a = BW + fh * 0.05, span = BX - fh * 0.07 - a, yS = WF + 0.0012;
      for (const s of [-1, 1]) for (const t of [0.25, 0.75]) {
        const u = s * (a + span * t), hw = span * 0.17;
        for (const [k, f] of [[0, -0.55], [1, 0.1], [2, 0.6]]) {
          const x = u + hw * f, w = fh * (0.004 + 0.004 * roll(300 + k + t * 10 + s)), z1 = uz0 - fw - S * 0.035, z0 = z1 - S * (0.12 + 0.16 * roll(310 + k + t * 10 + s));
          flat(ctx, cam, W3, [[x - w, yS, z1], [x + w, yS, z1], [x + w * 0.4, yS, z0], [x - w * 0.4, yS, z0]], [0, 1, 0], STREAK, alpha, dn);
        }
      }
      for (const s of [-1, 1]) {
        const xF = s * (BX + 0.0012), [p, q] = s > 0 ? [WF - fh * 0.02, WB + fh * 0.02] : [WB + fh * 0.02, WF - fh * 0.02];
        flat(ctx, cam, W3, [[xF, p, plinth + G * 0.06], [xF, q, plinth + G * 0.06], [xF, q, plinth], [xF, p, plinth]], [s, 0, 0], GRIME, alpha, dn);
      }
      { const xF = BX + 0.0014, y0 = YC - HY * 0.30, y1 = YC + HY * 0.05, z0 = G * 0.08, z1 = G * 0.30;
        flat(ctx, cam, W3, [[xF, y1, z1], [xF, y0, z1], [xF, y0, z0], [xF, y1, z0]], [1, 0, 0], PATCH, alpha, dn); }
      if (!SHAPE_SINK) {
        groundPaint(ctx, cam, [F(-DW * 0.85, WF + fh * 0.014), F(DW * 0.85, WF + fh * 0.014), F(DW * 0.6, WF + fh * 0.075), F(-DW * 0.6, WF + fh * 0.075)], 0.0016, dn > 0.5 ? 'rgba(150,140,120,0.45)' : 'rgba(226,220,204,0.55)', alpha);
        for (let k = 0; k < 9; k++) {   // old gum, pressed flat into the paving where people wait
          const gx = (roll(400 + k) - 0.5) * BX * 1.6, gy = WF + fh * (0.10 + 0.28 * roll(420 + k)), r = fh * 0.006;
          groundPaint(ctx, cam, [F(gx - r, gy - r), F(gx + r, gy - r), F(gx + r, gy + r), F(gx - r, gy + r)], 0.0018, 'rgba(70,66,60,0.35)', alpha);
        }
      }
    }
  },
};
