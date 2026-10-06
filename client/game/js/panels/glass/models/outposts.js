// Outposts: building-model arms for the three walls, the seven civics, Terminus, the Thornwarren and Deadwater.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  DETAIL_LIFT, FACE_EPS, SHAPE_SINK, awning, bakeSignText, blinkLight, clamp, draw3DBoxAt, drawFacetDrum,
  drawRing, drawSmoke, easeIO, emitFlat, emitSurfaceText, emitWire, faceYaw, frac, glowPool,
  marqueeBand, motionPhase, movingBox,
} from '../../windshield.js';
// Second Helpings and the clone facility share a main and a clock; the clone's arm owns both.
import { GUT, flatOut, gutPhase, slugLine, tubeRun } from './downtown.js';

// The hazard placard on Second Helpings' party wall. Baked here and not by `bakeSignText`, which
// letters names: this is a label, black on safety yellow, and it never lights. Like that function
// it bakes nothing during shape capture.
let _placard = null;
function placardTex() {
  if (SHAPE_SINK) return null;
  if (_placard) return _placard;
  const c = document.createElement('canvas'); c.width = 128; c.height = 72;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#e2b42a'; g.fillRect(0, 0, 128, 72);
    g.strokeStyle = '#141414'; g.lineWidth = 5; g.strokeRect(5, 5, 118, 62);
    g.fillStyle = '#141414'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 18px sans-serif';
    g.fillText('NOT FOR HUMAN', 64, 27, 106);
    g.fillText('CONSUMPTION', 64, 47, 106);
  }
  c._lit = 0;
  _placard = c;
  return c;
}

export const OUTPOST_ARMS = {

  // ══ THE THREE WALLS ═════════════════════════════════════════
  // ⚠ A WALL SECTION IS SYMMETRIC, AND THAT IS A CORRECTNESS RULE, NOT A STYLE ONE.
  // Every other arm in this switch draws ONE building and leans on F()/frontVis to face its
  // entrance at the street. A wall is the same tile 70 times in a row, each with its own
  // entrance facing derived from a door that isn't there — so any feature placed on the
  // "front" points a different way on every tile and the run reads as noise. These three arms
  // therefore use only CENTRED masses and SYMMETRIC (±) detail pairs, which land in the same
  // place whatever E is. What varies along the run is seeded decoration, never the section.
  trm_wall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE WALL (Terminus) — the Long Watch's rampart, and the thing worth
    // reading off it is that it is MAINTAINED: poured in sections onto a rubble batter, patched
    // in plate wherever it has been hit, and walked every night. Not a ruin despite the type.
    const base = h * 0.24, bodyTop = h * 0.86, walk = h * 0.94, parapet = h * 1.16;
    // 1) Rubble-and-earth batter, then the poured section standing on it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, base, 'ty_trm_base', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, base, bodyTop, pal, seed + 1, night, alpha, false);
    // 2) The walkway slab (wider than the section, so it reads as a lip from below) and a
    //    parapet up BOTH flanks — a walk with a rail on one side is a walk you fall off.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, bodyTop, walk, 'ty_trm_patch', seed + 2, night, alpha, true);
    for (const t of [-1, 1]) {
      const [px, py] = F(0, t * fh * 0.90);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.98, walk, parapet, 'ty_trm_rail', seed + 3 + t, night, alpha, true);
    }
    // 3) One seeded detail per tile, from a set of three. This is the ONLY thing that varies
    //    along the run, which is what keeps 70 identical sections from reading as wallpaper
    //    without ever putting a landmark in the middle of a wall.
    const d = seed % 3;
    if (d === 0) {
      // A patch plate bolted over a hit, on both faces (a hit goes through).
      for (const t of [-1, 1]) {
        const [qx, qy] = F(fh * 0.24, t * fh * 0.92);
        draw3DBoxAt(ctx, cam, qx, qy, fh * 0.30, base + h * 0.18, base + h * 0.44, 'ty_trm_patch', seed + 8, night, alpha, false);
      }
    } else if (d === 1) {
      // An access ladder up the inboard face to the walkway.
      for (const t of [-1, 1]) {
        const [qx, qy] = F(t * fh * 0.30, -fh * 0.94);
        draw3DBoxAt(ctx, cam, qx, qy, fh * 0.035, base, walk, 'ty_trm_rail', seed + 9 + t, night, alpha, false);
      }
    } else {
      // A lamp standard on the walk. Every third-ish tile, so the wall is a dotted line at night.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.05, parapet, parapet + h * 0.26, 'ty_trm_rail', seed + 10, night, alpha, false);
      glowPool(ctx, cam, dx, dy, parapet + h * 0.24, '236,220,176', 7, alpha * (night ? 0.5 : 0.12));
    }
  },
  thornwall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE THORN WALL (the Thornwarren) — GROWN, NOT BUILT, which is the whole
    // point of it and the reason none of this is a clean box: a raw earth berm the thorn is rooted
    // in, three overlapping yawed masses that read as tangle rather than masonry, and a crest of
    // irregular spurs. It closes when you cut it, so nothing here is ever repaired and nothing is
    // ever lit — no lamp, no plate, no beacon. It is the deliberate anti-Curtain.
    const berm = h * 0.26, low = h * 0.78, mid = h * 1.02, crest = h * 1.18;
    // 1) The berm — bare Scarletwastes earth thrown up and then held together by roots.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, 0, berm, 'ty_thorn_berm', seed, night, alpha, false);
    // 2) THE TANGLE. Three masses at different yaws and heights on the same footprint. A single
    //    box here would be masonry with a green paint job; the crossing diagonals are what make
    //    a silhouette that has no straight edge anywhere along the run.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, berm, mid, pal, seed + 1, night, alpha, false, 0.00);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, berm, low, 'ty_thorn_dk', seed + 2, night, alpha, false, 0.34);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, berm, crest, 'ty_thorn_dk', seed + 3, night, alpha, false, -0.42);
    // 3) Two boles — the old growth, thick enough to have been here longer than the town.
    for (const t of [-1, 1]) {
      const [bx, by] = F(t * fh * 0.42, t * fh * 0.16);
      drawFacetDrum(ctx, cam, bx, by, berm, mid, fh * 0.15, fh * 0.09, 7, alpha,
        (f) => 'rgb(' + (28 + f.nl * 26 | 0) + ',' + (38 + f.nl * 30 | 0) + ',' + (26 + f.nl * 20 | 0) + ')', 'rgb(18,24,18)');
    }
    // 4) THE CREST — spurs at four fixed stations, each a seeded height. Fixed stations (not
    //    seeded positions) so neighbouring tiles interlock instead of leaving gaps; seeded
    //    heights so the top line is never level. The pale tips are the only light tone in it.
    for (const [i, lx] of [[0, -0.62], [1, -0.20], [2, 0.22], [3, 0.60]]) {
      const g = frac(seed * 4 + i);
      const [sx, sy] = F(lx * fh, (frac(seed * 4 + i + 40) - 0.5) * fh * 0.7);
      const spur = crest + h * (0.06 + g * 0.30);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.045, low, spur, 'ty_thorn_dk', seed + 20 + i, night, alpha, false, g * 1.2);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.022, spur, spur + h * 0.07, 'ty_thorn_tip', seed + 30 + i, night, alpha, false, g * 1.2);
    }
  },
  damwall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE DAM (Deadwater) — the wall the region is named for not having any more.
    // A battered concrete face stepped back as it rises, buttress ribs down both flanks, rebar
    // combed out of the top where the deck was taken, and water stains that outlast the water.
    const toe = h * 0.20, mid = h * 0.66, top = h * 1.00;
    // 1) THE BATTER — three stacked masses narrowing upward. This is what makes it read as a dam
    //    and not a warehouse: the face leans back, so the top line is inboard of the base.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, toe, 'ty_dam_dk', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, toe, mid, pal, seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, mid, top, pal, seed + 2, night, alpha, true);
    // 2) Buttress ribs, symmetric pairs standing proud of the face.
    for (const t of [-1, 1]) for (const lx of [-0.52, 0.00, 0.52]) {
      const [rx, ry] = F(lx * fh, t * fh * 0.98);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.11, 0, mid, 'ty_dam_dk', seed + 4 + lx, night, alpha, false);
    }
    // 3) WATER STAIN — a dark streak down both faces where the sheet used to come over. Seeded
    //    width, so the run is streaked unevenly rather than pinstriped.
    { const w = 0.16 + frac(seed) * 0.22;
      for (const t of [-1, 1]) {
        const [wx, wy] = F((frac(seed + 7) - 0.5) * fh * 0.9, t * fh * 1.00);
        draw3DBoxAt(ctx, cam, wx, wy, fh * w, toe, top, 'ty_dam_stain', seed + 12 + t, night, alpha, false);
      }
    }
    // 4) REBAR — what is left of the deck, combed out of the crown. Not decoration: it is the
    //    evidence that the top was removed rather than never finished.
    for (const [i, lx] of [[0, -0.58], [1, -0.14], [2, 0.30], [3, 0.66]]) {
      const g = frac(seed * 3 + i);
      const [bx, by] = F(lx * fh, (g - 0.5) * fh * 0.8);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.018, top, top + h * (0.05 + g * 0.16), 'ty_dam_stain', seed + 40 + i, night, alpha, false, g * 0.9);
    }
    // 5) THE SPILLWAY, on one tile in five — a notch cut through the crown, dry. The only place
    //    the section changes shape at all, and rare enough that finding one means something.
    if (seed % 5 === 0) {
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.34, mid, top + h * 0.02, 'ty_dam_dk', seed + 50, night, alpha, false);
    }
  },
  // ══ THE SEVEN CIVICS ════════════════════════════════════════
  // Not one of these carries a sign. Terminus doesn't advertise and the Thornwarren doesn't
  // explain itself — the same reason the Reach's undertaker is the one building on Main Street
  // with nothing written on it. What tells you which is which is the shape and what is outside.
  trm_creche(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CRECHE (Terminus) — the commune's children, and the only building
    // in Terminus that spends warmth on comfort rather than on keeping something alive. Thick
    // lime-washed walls, a deep-eaved roof against the sun, and a walled yard on the entrance side.
    const wallTop = h * 0.72, ridge = h * 0.96;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, wallTop, pal, seed, night, alpha, false);
    // Deep overhanging eaves — wider than the walls, which is the whole silhouette from above.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, wallTop, ridge, 'ty_trm_creche_roof', seed + 1, night, alpha, true);
    // 1) THE YARD — a low wall enclosing swept ground on the entrance side. The reason you can
    //    tell this is a creche and not a store: nothing else here is walled in at knee height.
    { const [yx, yy] = F(0, fh * 1.50);
      draw3DBoxAt(ctx, cam, yx, yy, fh * 1.10, 0, h * 0.16, 'ty_trm_yard', seed + 2, night, alpha, true); }
    for (const t of [-1, 1]) { const [cx, cy] = F(t * fh * 1.06, fh * 1.02);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.07, 0, h * 0.26, 'ty_trm_yard', seed + 3 + t, night, alpha, true); }
    // 2) A chimney at the back — a stove that is lit long before the rest of the commune's are.
    { const [px, py] = F(fh * 0.40, -fh * 0.52);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.11, 0, ridge + h * 0.22, pal, seed + 5, night, alpha, true);
      drawSmoke(ctx, cam, px, py, ridge + h * 0.22, '198,192,178', alpha * 0.5, now, seed + 5); }
    // 3) Two small windows and a door, hand-placed, warm. Low down — they are for short people.
    if (frontVis) for (const t of [-1, 1]) { const [wx, wy] = F(t * fh * 0.40, fh * 0.94);
      glowPool(ctx, cam, wx, wy, wallTop * 0.46, '255,206,150', 6, alpha * (night ? 0.5 : 0.18)); }
    { const [gx, gy] = F(0, fh * 0.94);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, wallTop * 0.60, 'ty_door', seed + 6, night, alpha, true, 0, fh * 0.05); }
  },
  trm_hall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE WAKING HALL (Terminus) — where the commune assembles, so it is the
    // one wide clear-span volume in a settlement of small thick rooms: a long body, a clerestory
    // band under the eaves lighting it without putting windows at ground level, and the bell frame.
    const wallTop = h * 0.82, clerTop = h * 1.00, ridge = h * 1.12;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, wallTop, pal, seed, night, alpha, false);
    // 1) THE CLERESTORY — a lit band set back from the wall line, all the way round.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, wallTop, clerTop, 'ty_trm_hall_glass', seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, clerTop, ridge, 'ty_trm_hall_dk', seed + 2, night, alpha, true);
    glowPool(ctx, cam, dx, dy, (wallTop + clerTop) * 0.5, '244,228,178', 13, alpha * (night ? 0.44 : 0.14));
    // 2) BUTTRESS PIERS down both flanks — a clear span this wide has to be held apart.
    // ⚠ LOCAL x RUNS ACROSS THE FRONT, so the flanks are at x = ±1.06 fh. This loop had x and y the
    // other way round, which put the piers on the front and back walls and the middle front one in
    // the double doors.
    const yaw = faceYaw(E);
    for (const t of [-1, 1]) for (const ly of [-0.56, 0.00, 0.56]) {
      const [bx, by] = F(t * fh * 1.06, ly * fh);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.10, 0, wallTop, 'ty_trm_hall_dk', seed + 6 + ly, night, alpha, true, yaw, fh * 0.04);
    }
    // 3) THE BELL FRAME on the ridge — two posts and a beam. Nothing hangs off it that glows;
    //    the thing that calls the commune together is a sound, and it is drawn as one object.
    for (const t of [-1, 1]) { const [mx, my] = F(t * fh * 0.26, 0);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.05, ridge, ridge + h * 0.30, 'ty_trm_hall_dk', seed + 12 + t, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.34, ridge + h * 0.30, ridge + h * 0.36, 'ty_trm_hall_dk', seed + 14, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.12, ridge + h * 0.18, ridge + h * 0.30, 'ty_trm_hall_dk', seed + 15, night, alpha, false);
    // 4) The double doors — the widest opening in Terminus, because everyone leaves at once.
    if (frontVis) { const [gx, gy] = F(0, fh * 1.06);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.42, 0, wallTop * 0.62, 'ty_door', seed + 16, night, alpha, true, yaw, fh * 0.06); }
  },
  trm_gate(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE GATE HOUSE (Terminus) — the Long Watch's checkpoint on its own wall,
    // and it shares that wall's vocabulary deliberately: same poured grey, same rubble batter. Two
    // blast pylons, a beam across the road between them, and a cabin lifted on legs to see over both.
    const pylon = h * 1.10, cabin0 = h * 0.86, cabin1 = h * 1.24;
    // 1) THE PYLONS — the road runs between them, so they sit at ±x on the entrance axis.
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.74, 0);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.30, 0, h * 0.20, 'ty_trm_gate_dk', seed + 1 + t, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.24, h * 0.20, pylon, pal, seed + 3 + t, night, alpha, true); }
    // 2) THE BEAM — one slab dropped across the gap. The whole point of the building.
    //    ⚠ ACROSS THE ROAD AND THIN (`fd`). With no depth it was a 1.24 fh square slab, a deck
    //    between the pylons rather than a barrier across them.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, h * 0.44, h * 0.54, 'ty_trm_gate_dk', seed + 6, night, alpha, false, faceYaw(E), fh * 0.06);
    // 3) THE CABIN, lifted on four legs so the watch can see over the beam and over the parapet.
    for (const tx of [-1, 1]) for (const ty of [-1, 1]) { const [lx, ly] = F(tx * fh * 0.26, ty * fh * 0.26 - fh * 0.60);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.05, 0, cabin0, 'ty_trm_gate_dk', seed + 8 + tx + ty, night, alpha, false); }
    { const [cx, cy] = F(0, -fh * 0.60);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.40, cabin0, cabin1, pal, seed + 12, night, alpha, true);
      // The slit it watches through, and the lamp it watches by. One lamp, aimed down the road.
      glowPool(ctx, cam, cx, cy, (cabin0 + cabin1) * 0.5, '224,214,180', 7, alpha * (night ? 0.46 : 0.14));
      blinkLight(ctx, cam, cx, cy, cabin1 + h * 0.06, '255,120,90', now, seed, alpha, 0.6); }
  },
  sw_gate(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE THORN GATE (the Thornwarren) — the end of the trophy road, and the
    // whole tell is in the KEEPING of it. The arch is thorn trained over a timber frame, the walk
    // through it is swept, and the masks are on a RACK — hung in a row, evenly spaced, the way a
    // thing is stored by someone who has to put it on again at the start of a shift.
    const post = h * 1.06, lintel = h * 1.22;
    // 1) Two heavy timber posts either side of the road, and the lintel across them.
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.72, 0);
      drawFacetDrum(ctx, cam, px, py, 0, post, fh * 0.15, fh * 0.13, 8, alpha,
        (f) => 'rgb(' + (58 + f.nl * 44 | 0) + ',' + (48 + f.nl * 36 | 0) + ',' + (34 + f.nl * 26 | 0) + ')', 'rgb(38,32,24)'); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, post, lintel, 'ty_sw_gate_dk', seed + 4, night, alpha, true);
    // 2) THE THORN grown over the frame — the same tangle as the wall, so the gate is visibly a
    //    part of it rather than a hole cut in it. Yawed masses, never a clean arch.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, lintel, lintel + h * 0.30, 'ty_thorn', seed + 5, night, alpha, false, 0.28);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.70, lintel, lintel + h * 0.44, 'ty_thorn_dk', seed + 6, night, alpha, false, -0.36);
    for (const [i, lx] of [[0, -0.44], [1, 0.10], [2, 0.50]]) { const g = frac(seed * 5 + i);
      const [sx, sy] = F(lx * fh, (g - 0.5) * fh * 0.5);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.03, lintel + h * 0.30, lintel + h * (0.40 + g * 0.18), 'ty_thorn_tip', seed + 20 + i, night, alpha, false, g); }
    // 3) THE MASK RACK on the inboard post — a rail with the shift's masks hung along it, level
    //    and evenly spaced. The horror is on the road behind you; this is a coat hook.
    // ⚠ A RAIL AND FOUR MASKS HUNG FACING THE ROAD. With no `fd` the rail was a 0.84 fh square
    //    shelf and each mask a cube.
    { const [rx, ry] = F(fh * 0.74, -fh * 0.34);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.30, h * 0.62, h * 0.66, 'ty_sw_gate_dk', seed + 30, night, alpha, false, faceYaw(E), fh * 0.02); }
    for (const [i, lx] of [[0, 0.50], [1, 0.66], [2, 0.82], [3, 0.98]]) { const [mx, my] = F(lx * fh, -fh * 0.34);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.055, h * 0.44, h * 0.62, 'ty_sw_mask', seed + 40 + i, night, alpha, false, faceYaw(E), fh * 0.015); }
    // 4) One low fire in a pan by the post — warmth for a long shift, not a beacon.
    { const [fx, fy] = F(-fh * 0.72, -fh * 0.40);
      drawFacetDrum(ctx, cam, fx, fy, 0, h * 0.22, fh * 0.10, fh * 0.11, 7, alpha,
        (f) => 'rgb(' + (64 + f.nl * 34 | 0) + ',' + (52 + f.nl * 26 | 0) + ',' + (40 + f.nl * 20 | 0) + ')', 'rgb(40,32,26)');
      glowPool(ctx, cam, fx, fy, h * 0.24, '255,152,72', 8, alpha * (night ? 0.6 : 0.2)); }
  },
  sw_den(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CHORUS' DEN (the Thornwarren) — the song house, and the only round thing
    // in the town: a drum of rammed earth half sunk into the ground under a conical hide roof with
    // a smoke hole at the peak. Sunk because it is warm, and because it sounds better that way.
    const wallTop = h * 0.58, eave = h * 0.66, peak = h * 1.12;
    // 1) The sunk drum. A wide low ring of spoil round it is the earth that came out.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.20, 0, h * 0.10, 'ty_thorn_berm', seed, night, alpha, true);
    drawFacetDrum(ctx, cam, dx, dy, 0, wallTop, fh * 0.86, fh * 0.84, 12, alpha,
      (f) => 'rgb(' + (78 + f.nl * 46 | 0) + ',' + (56 + f.nl * 32 | 0) + ',' + (42 + f.nl * 24 | 0) + ')', 'rgb(52,38,28)');
    // 2) THE CONE — hide stretched over rafters, coming to a smoke hole rather than a point.
    drawFacetDrum(ctx, cam, dx, dy, wallTop, eave, fh * 0.98, fh * 0.96, 12, alpha,
      (f) => 'rgb(' + (112 + f.nl * 52 | 0) + ',' + (88 + f.nl * 40 | 0) + ',' + (62 + f.nl * 30 | 0) + ')', 'rgb(70,54,38)');
    drawFacetDrum(ctx, cam, dx, dy, eave, peak, fh * 0.96, fh * 0.14, 12, alpha,
      (f) => 'rgb(' + (108 + f.nl * 50 | 0) + ',' + (84 + f.nl * 38 | 0) + ',' + (58 + f.nl * 28 | 0) + ')', 'rgb(66,50,36)');
    drawRing(ctx, cam, dx, dy, eave, fh * 0.97, 12, 'rgba(0,0,0,0.30)', 1, alpha);
    // 3) THE SMOKE HOLE — lit from underneath whenever anybody is in there, which is most nights.
    drawSmoke(ctx, cam, dx, dy, peak, '206,198,182', alpha * 0.55, now, seed + 3);
    glowPool(ctx, cam, dx, dy, peak, '255,168,96', 7, alpha * (night ? 0.52 : 0.16));
    // 4) A low covered entrance porch, because the door is below ground level.
    { const [gx, gy] = F(0, fh * 0.94);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.26, 0, h * 0.34, 'ty_sw_hide', seed + 8, night, alpha, true); }
  },
  sw_roofwalk(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ROOFWALK (the Thornwarren) — not a building with a roof you can walk
    // on; a WALK that happens to be a building. A plank deck carried on posts above the height of
    // everything around it, with ladders up and a shade cloth over the middle of the run.
    const deck0 = h * 0.92, deck1 = h * 1.02, rail = h * 1.24, shade = h * 1.46;
    // 1) A small locked store at ground level — all the building there actually is.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.52, 0, h * 0.44, 'ty_sw_walk_dk', seed, night, alpha, true);
    // 2) SIX POSTS carrying the deck. Symmetric pairs, so the run lines up tile to tile.
    for (const tx of [-1, 1]) for (const ly of [-0.62, 0.00, 0.62]) {
      const [px, py] = F(tx * fh * 0.78, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.06, 0, deck0, pal, seed + 4 + ly + tx, night, alpha, false);
    }
    // 3) THE DECK, wider than its posts, and a rail up both sides of it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, deck0, deck1, pal, seed + 10, night, alpha, true);
    for (const t of [-1, 1]) { const [rx, ry] = F(t * fh * 0.90, 0);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.05, deck1, rail, 'ty_sw_walk_dk', seed + 12 + t, night, alpha, false); }
    // 4) THE SHADE — cloth on four spindly poles over the middle. A watch here is a long one.
    for (const tx of [-1, 1]) for (const ty of [-1, 1]) { const [sx, sy] = F(tx * fh * 0.44, ty * fh * 0.44);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.025, deck1, shade, 'ty_sw_walk_dk', seed + 20 + tx + ty, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, shade, shade + h * 0.04, 'ty_sw_cloth', seed + 24, night, alpha, true);
    // 5) The ladder up, on the entrance side.
    for (const t of [-1, 1]) { const [lx, ly] = F(t * fh * 0.14, fh * 0.92);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, 0, deck1, 'ty_sw_walk_dk', seed + 30 + t, night, alpha, false); }
  },
  sw_whelp(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE WHELPING ROOM (the Thornwarren) — where the town's children are born,
    // and it is the plainest, quietest, most domestic building in the region. Thick walls, one
    // small high window, a water butt at the corner and washing on a line. NOTHING about it is
    // remarked on, decorated or defended: that refusal is the whole point of the place.
    const wallTop = h * 0.66, ridge = h * 0.84;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.04, wallTop, ridge, 'ty_sw_hide', seed + 1, night, alpha, true);
    // 1) THE WATER BUTT at the corner, under the eave, kept full.
    { const [bx, by] = F(-fh * 0.76, fh * 0.62);
      drawFacetDrum(ctx, cam, bx, by, 0, h * 0.34, fh * 0.13, fh * 0.13, 9, alpha,
        (f) => 'rgb(' + (96 + f.nl * 42 | 0) + ',' + (78 + f.nl * 34 | 0) + ',' + (58 + f.nl * 26 | 0) + ')', 'rgb(58,46,34)');
      drawRing(ctx, cam, bx, by, h * 0.24, fh * 0.135, 9, 'rgba(0,0,0,0.30)', 1, alpha); }
    // 2) THE LINE — two poles and four hung cloths, which is the one thing that tells you from
    //    the air that this building is in daily use by somebody who is not fighting anybody.
    //    ⚠ The line itself is drawn, and each cloth is a sheet rather than a cube (`fd`).
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.94, -fh * 0.86);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.025, 0, h * 0.62, 'ty_sw_walk_dk', seed + 8 + t, night, alpha, false); }
    emitWire(ctx, cam, W3(-fh * 0.94, -fh * 0.86, h * 0.61), W3(fh * 0.94, -fh * 0.86, h * 0.61), 1.2, 'rgba(70,58,46,0.9)', alpha, { pull: 0.02 });
    for (const [i, lx] of [[0, -0.62], [1, -0.20], [2, 0.22], [3, 0.64]]) {
      const g = frac(seed * 6 + i), [cx, cy] = F(lx * fh, -fh * 0.86);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.12, h * (0.30 - g * 0.08), h * 0.60, 'ty_sw_cloth', seed + 40 + i, night, alpha, false, faceYaw(E), fh * 0.008); }
    // 3) One small high window and a door. The light behind it is on at every hour.
    if (frontVis) { const [wx, wy] = F(fh * 0.34, fh * 0.90);
      glowPool(ctx, cam, wx, wy, wallTop * 0.74, '255,214,164', 5, alpha * (night ? 0.5 : 0.18)); }
    { const [gx, gy] = F(-fh * 0.18, fh * 0.90);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, wallTop * 0.62, 'ty_door', seed + 50, night, alpha, true, 0, fh * 0.05); }
  },
  // ══ TERMINUS ════════════════════════════════════════════════
  // A commune that has been here long enough to have replaced everything twice. The house style
  // is that nothing is finished and everything is MAINTAINED: patched glass, matt salvaged steel,
  // lime wash gone chalky. No neon anywhere in the settlement, and no building carries its name.
  trm_glass_new(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE GLASSHOUSE (Terminus) — the good one. A barrel-vaulted growing
    // span on a low block knee-wall, ribs every few feet, and the green under-glow of a full house
    // in a region that cannot afford an empty one.
    const knee = h * 0.26, eave = h * 0.34, crown = h * 0.96;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.04, 0, knee, 'ty_trm_frame', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, knee, eave, pal, seed + 1, night, alpha, false);
    // THE VAULT — a facetted half-drum, which is what makes it a glasshouse and not a shed.
    drawFacetDrum(ctx, cam, dx, dy, eave, crown, fh * 1.00, fh * 0.22, 11, alpha,
      (f) => 'rgb(' + (118 + f.nl * 66 | 0) + ',' + (142 + f.nl * 70 | 0) + ',' + (124 + f.nl * 58 | 0) + ')', 'rgb(96,116,100)');
    drawRing(ctx, cam, dx, dy, eave, fh * 1.01, 11, 'rgba(0,0,0,0.26)', 1, alpha);
    // Ribs over the vault, so it reads as a frame with glass in it rather than a green tube.
    for (const [i, lx] of [[0, -0.62], [1, -0.20], [2, 0.22], [3, 0.62]]) { const [rx, ry] = F(lx * fh, 0);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.035, eave, crown, 'ty_trm_frame', seed + 10 + i, night, alpha, false); }
    // A vent light on the ridge, and the grow-glow the whole settlement steers home by.
    glowPool(ctx, cam, dx, dy, crown * 0.7, '150,255,178', 14, alpha * (night ? 0.5 : 0.16));
    { const [gx, gy] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.20, 0, knee + h * 0.24, 'ty_door', seed + 20, night, alpha, false); }
  },
  trm_glass_old(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // GLASSHOUSE (Terminus) — the OLD one, and the difference is the whole
    // reason it is a separate model: a single-pitch lean-to against a blind back wall, half its
    // panes swapped for board, a lower crop, and a dimmer light. Same settlement, ten years earlier.
    const back = h * 0.86, front = h * 0.40;
    // The blind masonry wall it leans on — the tall side, at the back.
    { const [bx, by] = F(0, -fh * 0.88); draw3DBoxAt(ctx, cam, bx, by, fh * 1.04, 0, back, 'ty_trm_frame', seed, night, alpha, true); }
    // The sloping glazed face, built as four stepped bays so the pitch reads without a ramp primitive.
    for (const [i, ly] of [[0, -0.52], [1, -0.14], [2, 0.24], [3, 0.62]]) {
      const top = back - (back - front) * (i / 3);
      const [gx, gy] = F(0, ly * fh);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.98, 0, top, i === 1 || i === 3 ? pal : 'ty_trm_board', seed + 2 + i, night, alpha, true);
    }
    // The boarded bays are the tell. Two thirds the glow of the new house, and no ridge vent.
    glowPool(ctx, cam, dx, dy, front * 0.9, '140,226,164', 10, alpha * (night ? 0.3 : 0.10));
    { const [dx2, dy2] = F(-fh * 0.60, fh * 0.90); draw3DBoxAt(ctx, cam, dx2, dy2, fh * 0.18, 0, front * 0.8, 'ty_door', seed + 12, night, alpha, false); }
  },
  trm_still(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE STILLHOUSE (Terminus) — where water is made drinkable and where the
    // people it is too late for are kept. A copper column tall enough to be the settlement's
    // landmark, a condenser drum beside it, and a low quiet ward block attached at the back.
    const wallTop = h * 0.60, colTop = h * 1.68;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, wallTop, pal, seed, night, alpha, true);
    // 1) THE COLUMN — the tallest thing in Terminus that isn't the wall.
    { const [cx, cy] = F(-fh * 0.30, -fh * 0.14);
      drawFacetDrum(ctx, cam, cx, cy, 0, colTop, fh * 0.17, fh * 0.13, 10, alpha,
        (f) => 'rgb(' + (120 + f.nl * 60 | 0) + ',' + (84 + f.nl * 42 | 0) + ',' + (52 + f.nl * 28 | 0) + ')', 'rgb(78,54,32)');
      for (const z of [0.5, 0.9, 1.3]) drawRing(ctx, cam, cx, cy, h * z, fh * 0.175, 10, 'rgba(0,0,0,0.32)', 2, alpha);
      drawSmoke(ctx, cam, cx, cy, colTop, '214,214,206', alpha * 0.6, now, seed + 4); }
    // 2) THE CONDENSER — a fat cold drum, lagged, sweating.
    { const [tx, ty] = F(fh * 0.44, -fh * 0.10);
      drawFacetDrum(ctx, cam, tx, ty, 0, h * 0.92, fh * 0.24, fh * 0.24, 9, alpha,
        (f) => 'rgb(' + (96 + f.nl * 46 | 0) + ',' + (100 + f.nl * 46 | 0) + ',' + (96 + f.nl * 40 | 0) + ')', 'rgb(64,68,64)'); }
    // 3) THE WARD — a low blind annexe at the back with one steady light. Nobody names it.
    { const [wx, wy] = F(fh * 0.10, -fh * 0.92);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.72, 0, h * 0.44, 'ty_trm_ward', seed + 8, night, alpha, true);
      glowPool(ctx, cam, wx, wy, h * 0.30, '226,232,224', 7, alpha * (night ? 0.38 : 0.12)); }
    if (frontVis) { const [gx, gy] = F(0, fh * 0.96); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.18, 0, wallTop * 0.6, 'ty_door', seed + 14, night, alpha, true, 0, fh * 0.05); }
  },
  trm_mending(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE MENDING ROOM (Terminus) — the working clinic, and the cleanest
    // building in the settlement by a wide margin: pale washed block, a wide covered ramp instead
    // of a step (you arrive here carried), and the one door that is lit at full brightness all night.
    const wallTop = h * 0.76, parapet = h * 0.88;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, wallTop, parapet, 'ty_trm_ward_dk', seed + 1, night, alpha, true);
    // 1) THE RAMP — a long shallow apron out the front, wider than the door, with a canopy over it.
    { const [rx, ry] = F(0, fh * 1.42); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.80, 0, h * 0.10, 'ty_trm_ward_dk', seed + 2, night, alpha, true); }
    { const [ax, ay] = F(0, fh * 1.16);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.86, h * 0.52, h * 0.58, 'ty_trm_ward', seed + 3, night, alpha, true);
      for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.74, fh * 1.38);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, h * 0.52, 'ty_trm_ward_dk', seed + 4 + t, night, alpha, false); } }
    // 2) A water tank on the roof, because a clinic that runs out is not one.
    { const [tx, ty] = F(fh * 0.42, -fh * 0.34);
      drawFacetDrum(ctx, cam, tx, ty, parapet, parapet + h * 0.26, fh * 0.18, fh * 0.18, 8, alpha,
        (f) => 'rgb(' + (104 + f.nl * 44 | 0) + ',' + (108 + f.nl * 44 | 0) + ',' + (100 + f.nl * 38 | 0) + ')', 'rgb(68,70,66)'); }
    // 3) The lit door. Not a sign — a light, on, always, which is how you find it at three in the morning.
    { const [gx, gy] = F(0, fh * 0.98);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.28, 0, wallTop * 0.58, 'ty_door', seed + 10, night, alpha, true, 0, fh * 0.05);
      glowPool(ctx, cam, gx, gy, wallTop * 0.62, '240,248,244', 10, alpha * (night ? 0.62 : 0.2)); }
  },
  trm_cistern(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CISTERNS (Terminus) — barely a building: three riveted tanks on a
    // poured plinth, a pipe manifold between them and a ladder up the middle one. It is on the map
    // because in a settlement this dry the water store is a landmark, not because anyone goes in it.
    const plinth = h * 0.18, tankTop = h * 1.24;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, 0, plinth, 'ty_trm_frame', seed, night, alpha, true);
    for (const [i, lx] of [[0, -0.60], [1, 0.00], [2, 0.60]]) {
      const [tx, ty] = F(lx * fh, 0), top = tankTop - h * (i === 1 ? 0 : 0.16);
      drawFacetDrum(ctx, cam, tx, ty, plinth, top, fh * 0.30, fh * 0.29, 10, alpha,
        (f) => 'rgb(' + (100 + f.nl * 48 | 0) + ',' + (98 + f.nl * 46 | 0) + ',' + (90 + f.nl * 40 | 0) + ')', 'rgb(66,68,62)');
      drawRing(ctx, cam, tx, ty, plinth + h * 0.44, fh * 0.305, 10, 'rgba(0,0,0,0.30)', 2, alpha);
      drawRing(ctx, cam, tx, ty, plinth + h * 0.84, fh * 0.305, 10, 'rgba(0,0,0,0.30)', 2, alpha);
    }
    // THE COLLAR — one poured band round the three bases, which is the only reason they read as
    // one installation rather than three drums somebody left out. ⚠ IT WAS A PIPE MANIFOLD, and a
    // 2.5 fh square slab for want of an `fd`; Terminus shows no plumbing (building-styles.md 3.4).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, plinth + h * 0.20, plinth + h * 0.28, 'ty_trm_frame', seed + 8, night, alpha, false, faceYaw(E), fh * 0.32);
    // The ladder up the middle tank, and a lamp at the top of it.
    for (const t of [-1, 1]) { const [lx, ly] = F(t * fh * 0.06, fh * 0.30);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.025, plinth, tankTop, 'ty_trm_pipe', seed + 12 + t, night, alpha, false); }
    blinkLight(ctx, cam, dx, dy, tankTop + h * 0.06, '120,200,255', now, seed, alpha, 0.5);
  },
  trm_bench(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE BENCH (Terminus) — the settlement's workshop, and it is deliberately
    // OPEN on three sides: a roof on posts over a line of work tables, a hand gantry down the middle
    // to lift what the tables can't, and the one warm working light anybody is allowed to leave on.
    const post = h * 0.86, roof = h * 0.98;
    // 1) The roof on six posts. No walls — you can see straight through the building.
    for (const tx of [-1, 1]) for (const ly of [-0.66, 0.00, 0.66]) {
      const [px, py] = F(tx * fh * 0.86, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.07, 0, post, 'ty_trm_frame', seed + 2 + ly + tx, night, alpha, false);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, post, roof, pal, seed, night, alpha, true);
    // 2) The only enclosed part — a locked tool store at the back, which is where the value is.
    // ⚠ EVERYTHING BELOW HAS A LENGTH, SO EVERYTHING TAKES AN `fd`. Without one the store ran out
    //    past the back of the tile, the gantry beam was a cube, the tables were squares, and the
    //    block hung 0.20 fh off the beam from nothing. The legs the beam stands on are drawn now.
    const yaw = faceYaw(E);
    { const [sx, sy] = F(-fh * 0.46, -fh * 0.70); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.50, 0, h * 0.62, 'ty_trm_frame', seed + 10, night, alpha, true, yaw, fh * 0.28); }
    // 3) THE GANTRY — a beam down the length of the shed on two legs, with a block hanging off it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.04, post - h * 0.14, post - h * 0.06, 'ty_trm_gantry', seed + 12, night, alpha, false, yaw, fh * 0.80);
    for (const t of [-1, 1]) { const [lx, ly] = F(0, t * fh * 0.80);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, 0, post - h * 0.06, 'ty_trm_gantry', seed + 14 + t, night, alpha, false); }
    { const [hx, hy] = F(0, fh * 0.20); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.06, h * 0.48, post - h * 0.14, 'ty_trm_gantry', seed + 13, night, alpha, false); }
    // 4) THE BENCHES themselves — a row of tables down both flanks, which is the building's name.
    for (const t of [-1, 1]) { const [bx, by] = F(t * fh * 0.58, 0);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.12, h * 0.28, h * 0.34, 'ty_trm_gantry', seed + 20 + t, night, alpha, true, yaw, fh * 0.60); }
    glowPool(ctx, cam, dx, dy, h * 0.40, '255,206,140', 11, alpha * (night ? 0.44 : 0.14));
  },
  trm_charge(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE STANDING CHARGE (Terminus) — the commune's power, and the exact
    // opposite of the Reach's Dynamo, which is a jury-rigged genset that argues with storms. This
    // one is a flywheel house: a squat blockhouse, a cell bank under a shed roof beside it, and
    // cable runs going out on poles. It hums, it is bolted down, and somebody checks it every day.
    const houseTop = h * 0.78, roof = h * 0.90;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.80, 0, houseTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, houseTop, roof, 'ty_trm_frame', seed + 1, night, alpha, true);
    // 1) THE FLYWHEEL, standing proud of the house on its own bearing pedestals — the one moving
    //    part in Terminus big enough to see from the air.
    { const [wx, wy] = F(fh * 0.70, 0);
      drawFacetDrum(ctx, cam, wx, wy, h * 0.24, h * 0.34, fh * 0.40, fh * 0.40, 14, alpha,
        (f) => 'rgb(' + (88 + f.nl * 46 | 0) + ',' + (92 + f.nl * 46 | 0) + ',' + (94 + f.nl * 44 | 0) + ')', 'rgb(58,62,64)');
      drawRing(ctx, cam, wx, wy, h * 0.34, fh * 0.41, 14, 'rgba(0,0,0,0.34)', 2, alpha);
      for (const t of [-1, 1]) { const [px, py] = F(fh * 0.70, t * fh * 0.34);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.08, 0, h * 0.30, 'ty_trm_frame', seed + 4 + t, night, alpha, false); } }
    // 2) THE CELL BANK — rows of salvaged cells under a lean-to, which is the store the flywheel fills.
    { const [cx, cy] = F(-fh * 0.66, fh * 0.30);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.34, 0, h * 0.40, 'ty_trm_cell', seed + 8, night, alpha, true);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.42, h * 0.52, h * 0.58, 'ty_trm_frame', seed + 9, night, alpha, true); }
    // 3) CABLE POLES leaving the site. Power that goes somewhere is what makes this a utility.
    for (const [i, ly] of [[0, 0.80], [1, 1.40]]) { const [px, py] = F(fh * 0.20, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.035, 0, h * (1.10 - i * 0.06), 'ty_trm_frame', seed + 20 + i, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.26, h * (1.02 - i * 0.06), h * (1.06 - i * 0.06), 'ty_trm_frame', seed + 24 + i, night, alpha, false); }
    glowPool(ctx, cam, dx, dy, roof, '150,214,255', 9, alpha * (night ? 0.30 : 0.10));
    blinkLight(ctx, cam, dx, dy, roof + h * 0.06, '120,255,180', now, seed, alpha, 0.4);
  },
  trm_dorm(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LONG DORMITORY (Terminus) — where most of the commune sleeps. LONG and
    // LOW, with one unbroken row of identical small windows, which is a shape no other building in
    // the game has: everything else stacks its rooms and this one lays them in a line.
    const wallTop = h * 0.68, eave = h * 0.84;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, wallTop, eave, 'ty_trm_dorm_roof', seed + 1, night, alpha, true);
    // 1) THE ROW. Seven windows at fixed stations, each seeded on or off — a dormitory at night is
    //    a line of lights with gaps in it, and the gaps are the people on the wall.
    if (frontVis) for (let i = 0; i < 7; i++) {
      const [wx, wy] = F((-0.72 + i * 0.24) * fh, fh * 0.88);
      if (frac(seed * 7 + i) > 0.42) glowPool(ctx, cam, wx, wy, wallTop * 0.62, '255,208,152', 4, alpha * (night ? 0.44 : 0.12));
    }
    // 2) A door at EACH end, because a hundred people cannot leave through one.
    //    ⚠ Flat on the wall (`fd`): with no depth each door was a cube standing out of it.
    const yaw = faceYaw(E);
    for (const t of [-1, 1]) { const [gx, gy] = F(t * fh * 0.66, fh * 0.88);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.14, 0, wallTop * 0.58, 'ty_door', seed + 10 + t, night, alpha, false, yaw, fh * 0.02); }
    // 3) BOOT RACKS along the front wall — low, long, and the reason you know it is a dormitory
    //    and not a store the moment you look down at it. ⚠ Long and shallow (`fd`); it was a 1.56 fh
    //    square slab running out past the tile.
    { const [bx, by] = F(0, fh * 1.00); draw3DBoxAt(ctx, cam, bx, by, fh * 0.78, 0, h * 0.12, 'ty_trm_dorm_roof', seed + 14, night, alpha, true, yaw, fh * 0.06); }
    // 4) A single stove flue at the middle of the ridge. One fire for the whole hall.
    { const [px, py] = F(0, -fh * 0.30);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.08, eave, eave + h * 0.24, 'ty_trm_frame', seed + 18, night, alpha, true);
      drawSmoke(ctx, cam, px, py, eave + h * 0.24, '200,196,186', alpha * 0.45, now, seed + 18); }
  },
  trm_inn(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE OPEN DOOR (Terminus) — the guest house, and its name is a policy. The
    // door frame is drawn with NO DOOR IN IT and the porch light is on: a traveller who arrives at
    // four in the morning is not expected to knock. That is the entire building.
    const wallTop = h * 0.88, eave = h * 1.02;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, wallTop, eave, 'ty_trm_dorm_roof', seed + 1, night, alpha, true);
    // 1) THE PORCH — a deep roof on two posts, a bench under it, and the light.
    { const [ax, ay] = F(0, fh * 1.22);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.72, h * 0.62, h * 0.70, 'ty_trm_dorm_roof', seed + 2, night, alpha, true);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.44, h * 0.16, h * 0.22, 'ty_trm_frame', seed + 3, night, alpha, true); }
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.62, fh * 1.40);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, h * 0.62, 'ty_trm_frame', seed + 4 + t, night, alpha, false); }
    // 2) THE FRAME WITH NO DOOR — two jambs and a head, and nothing between them. Deliberately not
    //    a 'ty_door' box: every other building in the game fills that gap and this one does not.
    for (const t of [-1, 1]) { const [jx, jy] = F(t * fh * 0.19, fh * 0.94);
      draw3DBoxAt(ctx, cam, jx, jy, fh * 0.05, 0, wallTop * 0.62, 'ty_trm_frame', seed + 8 + t, night, alpha, false); }
    { const [hx, hy] = F(0, fh * 0.94); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.42, wallTop * 0.62, wallTop * 0.68, 'ty_trm_frame', seed + 12, night, alpha, true, 0, fh * 0.10);
      glowPool(ctx, cam, hx, hy, wallTop * 0.46, '255,214,158', 12, alpha * (night ? 0.66 : 0.22)); }
    // 3) Upper windows, warm, in the roof space where the beds are.
    if (frontVis) for (const t of [-1, 1]) { const [wx, wy] = F(t * fh * 0.44, fh * 0.90);
      glowPool(ctx, cam, wx, wy, wallTop * 0.80, '255,198,140', 5, alpha * (night ? 0.36 : 0.12)); }
  },
  trm_ground(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE QUIET GROUND (Terminus) — a BURIAL GROUND with a shed on it, which is
    // why it must not share the Reach's undertaker model: that one is a shopfront on a street, a
    // trade with a counter. This is a walled field of markers, and the building is the smallest
    // thing in it. The markers are the same size as each other, and that is the commune's position.
    const wall = h * 0.22, shedTop = h * 0.54, ridge = h * 0.66;
    // 1) THE WALL round the ground — low, dry-laid, complete.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.22, 0, wall, pal, seed, night, alpha, true);
    // 2) THE MARKERS — four rows of four, identical, evenly spaced. Nothing is bigger than anything.
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const [mx, my] = F((-0.66 + c * 0.44) * fh, (-0.60 + r * 0.40) * fh);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.05, wall * 0.4, wall + h * 0.14, 'ty_trm_marker', seed + 20 + r * 4 + c, night, alpha, true);
    }
    // 3) THE SHED, in one corner, small. Tools and the register live in it.
    { const [sx, sy] = F(-fh * 0.72, -fh * 0.74);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.40, 0, shedTop, 'ty_trm_frame', seed + 4, night, alpha, false);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.48, shedTop, ridge, 'ty_trm_dorm_roof', seed + 5, night, alpha, true); }
    // 4) One lamp on the gate post. Not for the dead; for whoever has to be out here at night.
    { const [gx, gy] = F(0, fh * 1.18);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.05, 0, h * 0.48, 'ty_trm_frame', seed + 8, night, alpha, false);
      glowPool(ctx, cam, gx, gy, h * 0.46, '224,220,204', 6, alpha * (night ? 0.34 : 0.10)); }
  },
  trm_vault(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SEED VAULT (Terminus) — the most valuable building in the region and
    // it is almost entirely UNDERGROUND, so from the air it is a grassed-over mound with a concrete
    // throat coming out of it and a blast door at the end. What you can see is the smallest part.
    const mound = h * 0.42, throat = h * 0.62;
    // 1) THE MOUND — a broad low earth cap, wider than anything else on the tile.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, 0, mound * 0.6, 'ty_trm_mound', seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, mound * 0.6, mound, 'ty_trm_mound', seed + 1, night, alpha, true);
    // 2) THE THROAT — a poured entrance passage breaking out of the mound toward the door.
    { const [tx, ty] = F(0, fh * 0.86);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.46, 0, throat, pal, seed + 2, night, alpha, true); }
    // 3) THE BLAST DOOR — one dark slab on visible hinges, thicker than the wall it is set in.
    { const [bx, by] = F(0, fh * 1.10);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.34, 0, throat * 0.86, 'ty_trm_blast', seed + 4, night, alpha, false);
      for (const t of [-1, 1]) { const [hx, hy] = F(t * fh * 0.34, fh * 1.10);
        draw3DBoxAt(ctx, cam, hx, hy, fh * 0.06, 0, throat * 0.86, 'ty_trm_frame', seed + 6 + t, night, alpha, false); } }
    // 4) VENT STACKS out of the mound — the only sign there is anything under it at all.
    for (const [i, lx] of [[0, -0.52], [1, 0.48]]) { const [vx, vy] = F(lx * fh, -fh * 0.46);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.07, mound, mound + h * (0.26 + i * 0.08), 'ty_trm_frame', seed + 12 + i, night, alpha, true); }
    blinkLight(ctx, cam, dx, dy, mound + h * 0.40, '255,150,90', now, seed, alpha, 0.35);
  },
  trm_table(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LONG TABLE (Terminus) — the commune eats together, so this is not a
    // diner: no counter, no booths, no street frontage. It is a long open-sided shelter with one
    // table down the middle of it and a serving block at the end, and the whole settlement fits.
    const post = h * 0.72, roof = h * 0.84;
    // 1) The canvas roof on posts, open on both long sides.
    for (const tx of [-1, 1]) for (const ly of [-0.70, -0.24, 0.24, 0.70]) {
      const [px, py] = F(tx * fh * 0.82, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, post, 'ty_trm_table', seed + 2 + ly + tx, night, alpha, false);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, post, roof, 'ty_trm_canvas', seed, night, alpha, true);
    // 2) THE TABLE — one continuous run down the centre with a bench either side of it. This is the
    //    building's name and the only thing in it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.26, h * 0.24, h * 0.30, 'ty_trm_table', seed + 10, night, alpha, true);
    for (const t of [-1, 1]) { const [bx, by] = F(t * fh * 0.30, 0);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.12, h * 0.14, h * 0.18, 'ty_trm_table', seed + 12 + t, night, alpha, true); }
    // 3) THE SERVING BLOCK at one end — the only enclosed part, with the stove flue and the smoke.
    { const [sx, sy] = F(0, -fh * 0.98);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.66, 0, h * 0.66, 'ty_trm_frame', seed + 16, night, alpha, true);
      const [fx, fy] = F(fh * 0.22, -fh * 0.98);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.09, h * 0.66, h * 1.02, 'ty_trm_frame', seed + 17, night, alpha, true);
      drawSmoke(ctx, cam, fx, fy, h * 1.02, '206,200,188', alpha * 0.6, now, seed + 17);
      glowPool(ctx, cam, sx, sy, h * 0.40, '255,180,110', 9, alpha * (night ? 0.5 : 0.16)); }
    // 4) Lamps strung the length of the ridge — the warmest-lit place in Terminus, on purpose.
    glowPool(ctx, cam, dx, dy, roof * 0.9, '255,206,150', 13, alpha * (night ? 0.42 : 0.12));
  },
  trm_wash(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE WASH HOUSE (Terminus) — the communal wash, and it is a UTILITY, not the
    // Reach's Long Soak: no false front, no bolted letters, nobody spending water on pleasure. A
    // boiler at one end, a long trough shed, and drying lines taking up more ground than the building.
    const wallTop = h * 0.52, roof = h * 0.62;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, wallTop, roof, 'ty_trm_frame', seed + 1, night, alpha, true);
    // 1) THE BOILER — a fat drum in its own lean-to at the end, and the flue over it.
    { const [bx, by] = F(-fh * 0.68, -fh * 0.30);
      drawFacetDrum(ctx, cam, bx, by, 0, h * 0.50, fh * 0.22, fh * 0.22, 9, alpha,
        (f) => 'rgb(' + (96 + f.nl * 44 | 0) + ',' + (92 + f.nl * 42 | 0) + ',' + (84 + f.nl * 36 | 0) + ')', 'rgb(60,62,58)');
      const [fx, fy] = F(-fh * 0.68, -fh * 0.62);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.08, 0, h * 1.06, 'ty_trm_frame', seed + 4, night, alpha, true);
      drawSmoke(ctx, cam, fx, fy, h * 1.06, '210,212,208', alpha * 0.7, now, seed + 4); }
    // 2) ROOF VENTS letting the steam out along the ridge — the shed breathes the whole way along.
    for (const [i, lx] of [[0, -0.30], [1, 0.30]]) { const [vx, vy] = F(lx * fh, 0);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.16, roof, roof + h * 0.10, 'ty_trm_frame', seed + 8 + i, night, alpha, true);
      drawSmoke(ctx, cam, vx, vy, roof + h * 0.10, '218,224,222', alpha * 0.5, now, seed + 8 + i); }
    // 3) THE DRYING LINES — four poles and the washing between them, taking up the whole apron.
    //    ⚠ The line itself is drawn, and each run of washing is a sheet rather than a cube (`fd`).
    emitWire(ctx, cam, W3(-fh * 0.825, fh * 1.14, h * 0.63), W3(fh * 0.845, fh * 1.14, h * 0.63), 1.2, 'rgba(76,78,74,0.9)', alpha, { pull: 0.02 });
    for (const [i, lx] of [[0, -0.86], [1, -0.28], [2, 0.30], [3, 0.88]]) {
      const [px, py] = F(lx * fh, fh * 1.14);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.03, 0, h * 0.66, 'ty_trm_frame', seed + 20 + i, night, alpha, false);
      if (i < 3) { const g = frac(seed * 8 + i), [cx, cy] = F((lx + 0.29) * fh, fh * 1.14);
        draw3DBoxAt(ctx, cam, cx, cy, fh * 0.22, h * (0.34 - g * 0.10), h * 0.62, 'ty_sw_cloth', seed + 30 + i, night, alpha, false, faceYaw(E), fh * 0.008); }
    }
  },
  trm_depot(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // LAST REQUISITION (Terminus) — the haulage shed, and the name is the joke:
    // it is the last place anything gets signed for before the void. A shed with a roller door like
    // any depot, but SANDBAGGED at the corners, a fuel drum rack under the eave, and a tally board
    // by the door that is the closest thing in Terminus to signage.
    const wallTop = h * 0.80, ridge = h * 0.96;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, wallTop, ridge, 'ty_trm_frame', seed + 1, night, alpha, true);
    // 1) THE ROLLER DOOR — one wide opening, the full height of the wall, on the entrance face.
    // ⚠ A roller door is a SLAB in a wall and a tally board is a SHEET: with no `fd` both were
    //   square boxes, the door half a tile of solid steel standing out of the shed and the board a
    //   crate on two legs, neither with a lid. See `scripts/shapes/lidless.mjs`.
    if (frontVis) { const [rx, ry] = F(0, fh * 1.04);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.56, 0, wallTop * 0.86, 'ty_trm_blast', seed + 2, night, alpha, true, 0, fh * 0.06); }
    // 2) SANDBAG REVETMENTS at both front corners. Terminus fortifies the thing it cannot replace.
    for (const t of [-1, 1]) { const [sx, sy] = F(t * fh * 0.90, fh * 0.90);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.24, 0, h * 0.20, 'ty_trm_sand', seed + 4 + t, night, alpha, true);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.18, h * 0.20, h * 0.34, 'ty_trm_sand', seed + 6 + t, night, alpha, true); }
    // 3) THE DRUM RACK down one flank — fuel, standing on end, under the overhang.
    for (const [i, ly] of [[0, -0.52], [1, -0.18], [2, 0.18]]) { const [dx2, dy2] = F(-fh * 0.84, ly * fh);
      drawFacetDrum(ctx, cam, dx2, dy2, 0, h * 0.30, fh * 0.10, fh * 0.10, 8, alpha,
        (f) => 'rgb(' + (92 + f.nl * 40 | 0) + ',' + (78 + f.nl * 34 | 0) + ',' + (58 + f.nl * 26 | 0) + ')', 'rgb(56,48,38)'); }
    // 4) THE TALLY BOARD by the door — a plain board on two legs. Nothing is written on it here;
    //    what it says changes daily and a painted sign would be a lie by the afternoon.
    { const [tx, ty] = F(fh * 0.76, fh * 1.12);
      for (const t of [-1, 1]) { const [lx, ly] = F(fh * (0.76 + t * 0.12), fh * 1.12);
        draw3DBoxAt(ctx, cam, lx, ly, fh * 0.025, 0, h * 0.36, 'ty_trm_frame', seed + 20 + t, night, alpha, false); }
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.30, h * 0.36, h * 0.58, 'ty_trm_board', seed + 24, night, alpha, true, 0, fh * 0.03); }
    glowPool(ctx, cam, dx, dy, wallTop * 0.7, '236,220,170', 8, alpha * (night ? 0.28 : 0.10));
  },
  // ══ THE THORNWARREN ═════════════════════════════════════════
  // ⚠ THE TONE RULE THIS REGION IS BUILT ON: the terror is on the APPROACH and the inside is
  // DOMESTIC, and nothing ever remarks on the difference. So none of these arms carries a trophy,
  // a spike or a skull. They carry washing lines, milk churns, swept yards and a bread oven — and
  // the only thing that gives the town away from the air is how well kept all of it is.
  sw_physic(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE PHYSIC (the Thornwarren) — the everyday doctor. A round-cornered
    // earth building under a hide roof, a herb rack drying along the sunny wall, and a stone bench
    // outside it where people wait, which is the detail that makes it read as a surgery.
    const wallTop = h * 0.68, eave = h * 0.82;
    drawFacetDrum(ctx, cam, dx, dy, 0, wallTop, fh * 0.84, fh * 0.82, 10, alpha,
      (f) => 'rgb(' + (122 + f.nl * 52 | 0) + ',' + (112 + f.nl * 46 | 0) + ',' + (94 + f.nl * 38 | 0) + ')', 'rgb(84,76,64)');
    drawFacetDrum(ctx, cam, dx, dy, wallTop, eave, fh * 1.00, fh * 0.90, 10, alpha,
      (f) => 'rgb(' + (112 + f.nl * 48 | 0) + ',' + (88 + f.nl * 38 | 0) + ',' + (62 + f.nl * 28 | 0) + ')', 'rgb(72,56,40)');
    // 1) THE HERB RACK — a long frame on the sunny flank with bundles hung off it in a row.
    { const [rx, ry] = F(fh * 0.94, 0);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.06, h * 0.30, h * 0.56, 'ty_sw_gate_dk', seed + 2, night, alpha, false); }
    for (const [i, ly] of [[0, -0.44], [1, -0.12], [2, 0.20], [3, 0.50]]) {
      const g = frac(seed * 9 + i), [bx, by] = F(fh * 0.94, ly * fh);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.05, h * (0.34 + g * 0.06), h * 0.52, 'ty_thorn_dk', seed + 10 + i, night, alpha, false); }
    // 2) THE WAITING BENCH by the door — stone, worn, in the shade of the eave.
    { const [bx, by] = F(-fh * 0.30, fh * 0.98);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.34, h * 0.10, h * 0.16, 'ty_sw_kept', seed + 16, night, alpha, true); }
    { const [gx, gy] = F(fh * 0.18, fh * 0.94);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.18, 0, wallTop * 0.60, 'ty_door', seed + 18, night, alpha, false);
      glowPool(ctx, cam, gx, gy, wallTop * 0.56, '255,206,152', 7, alpha * (night ? 0.44 : 0.14)); }
  },
  sw_kept(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE KEPT (the Thornwarren) — long-term care, and its shape is the argument:
    // a low ward wing wrapped around a SHADED COURTYARD, so everyone inside gets outside. The
    // courtyard is the largest single feature and the building is the frame round it.
    const wallTop = h * 0.62, eave = h * 0.74;
    // 1) Three wings round an open square — the fourth side is the way in.
    //    ⚠ EACH WING IS ITS OWN WIDTH AND DEPTH (half-extents below, with `fd`). Every wing used to be
    //    the same 0.69 fh square, which closed the courtyard to a slot and put the plan 1.55 fh out,
    //    past the tile on three sides.
    const yaw = faceYaw(E);
    for (const [lx, ly, hw, hd] of [[0, -0.85, 1.00, 0.15], [-0.85, 0.15, 0.15, 0.85], [0.85, 0.15, 0.15, 0.85]]) {
      const [wx, wy] = F(lx * fh, ly * fh);
      draw3DBoxAt(ctx, cam, wx, wy, fh * hw, 0, wallTop, pal, seed + lx + ly, night, alpha, false, yaw, fh * hd);
      draw3DBoxAt(ctx, cam, wx, wy, fh * (hw + 0.04), wallTop, eave, 'ty_sw_hide', seed + 4 + lx, night, alpha, true, yaw, fh * (hd + 0.04));
    }
    // 2) THE COURTYARD SHADE — cloth on four poles over the open middle. The point of the building.
    for (const tx of [-1, 1]) for (const ty of [-1, 1]) { const [sx, sy] = F(tx * fh * 0.40, ty * fh * 0.34);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.03, 0, h * 0.72, 'ty_sw_gate_dk', seed + 20 + tx + ty, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.46, h * 0.72, h * 0.76, 'ty_sw_cloth', seed + 26, night, alpha, true, yaw, fh * 0.40);
    // 3) A water trough under the shade, and the low warm light of a place nobody leaves at night.
    { const [tx, ty] = F(0, fh * 0.10);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.24, h * 0.06, h * 0.14, 'ty_sw_water', seed + 30, night, alpha, true); }
    glowPool(ctx, cam, dx, dy, h * 0.40, '255,196,140', 11, alpha * (night ? 0.36 : 0.12));
  },
  sw_flesh(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE FLESHERY (the Thornwarren) — the Wildblood's own vat room, and it must
    // NOT be the Coldwater Clone Facility model: that one is a clean lab shell with a reactor dome,
    // corporate medicine. This is the same work done in fired earth and salvaged plate — squat
    // barrel vats standing in the open under a hide awning, and the green of them is the only
    // unnatural colour in the town.
    const wallTop = h * 0.74, roof = h * 0.88;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.80, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, wallTop, roof, 'ty_sw_hide', seed + 1, night, alpha, true);
    // 1) THE VATS — three, in the open beside the building, lit from inside. Nothing hides them.
    for (const [i, lx] of [[0, -0.30], [1, 0.34], [2, 0.90]]) {
      const [vx, vy] = F(lx * fh, fh * 0.86), top = h * (0.56 + (i === 1 ? 0.10 : 0));
      drawFacetDrum(ctx, cam, vx, vy, 0, top, fh * 0.22, fh * 0.21, 10, alpha,
        (f) => 'rgb(' + (64 + f.nl * 40 | 0) + ',' + (96 + f.nl * 56 | 0) + ',' + (76 + f.nl * 40 | 0) + ')', 'rgb(52,74,60)');
      drawRing(ctx, cam, vx, vy, top, fh * 0.225, 10, 'rgba(0,0,0,0.30)', 2, alpha);
      glowPool(ctx, cam, vx, vy, top, '120,255,168', 7, alpha * (night ? 0.5 : 0.18));
    }
    // 2) The awning over them on four poles — the vats are worked outdoors, in shade.
    for (const tx of [-1, 1]) for (const ly of [0.40, 1.32]) { const [px, py] = F(tx * fh * 0.90, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, h * 0.86, 'ty_sw_gate_dk', seed + 20 + tx + ly, night, alpha, false); }
    { const [ax, ay] = F(0, fh * 0.86); draw3DBoxAt(ctx, cam, ax, ay, fh * 1.02, h * 0.86, h * 0.92, 'ty_sw_cloth', seed + 26, night, alpha, true); }
    // 3) A pipe run from the building to the vats, and the flue over the heat under them.
    { const [fx, fy] = F(-fh * 0.34, -fh * 0.40);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.08, roof, roof + h * 0.28, 'ty_sw_plate', seed + 30, night, alpha, true);
      drawSmoke(ctx, cam, fx, fy, roof + h * 0.28, '198,206,196', alpha * 0.5, now, seed + 30); }
  },
  sw_milk(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE MILKHOUSE (the Thornwarren) — cold storage, and it is a DAIRY, which is
    // about as far from a Coldwater refrigerated block as a building gets. Thick lime-washed walls,
    // a half-sunk floor, a stone churn stand outside and the churns standing on it in a row, clean.
    const wallTop = h * 0.70, eave = h * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, 0, h * 0.10, 'ty_sw_milk_dk', seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, h * 0.10, wallTop, pal, seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, wallTop, eave, 'ty_sw_hide', seed + 2, night, alpha, true);
    // 1) THE CHURN STAND — a stone shelf outside the door with five churns on it, evenly spaced.
    //    Evenly, and upright, and the same height: this is a working dairy, not a prop.
    // ⚠ EVERY FLAT THING HERE TAKES A DEPTH. With no `fd` the churn shelf was a 1.7 fh square slab
    //    reaching past the tile, and the vents and the door were cubes standing out of the wall.
    const yaw = faceYaw(E);
    { const [tx, ty] = F(0, fh * 1.14);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.86, 0, h * 0.20, 'ty_sw_milk_dk', seed + 4, night, alpha, true, yaw, fh * 0.12); }
    for (let i = 0; i < 5; i++) { const [cx, cy] = F((-0.66 + i * 0.33) * fh, fh * 1.14);
      drawFacetDrum(ctx, cam, cx, cy, h * 0.20, h * 0.44, fh * 0.09, fh * 0.06, 8, alpha,
        (f) => 'rgb(' + (150 + f.nl * 60 | 0) + ',' + (146 + f.nl * 58 | 0) + ',' + (132 + f.nl * 50 | 0) + ')', 'rgb(100,96,86)'); }
    // 2) VENT SLOTS high on the wall — a cold store breathes at the top or it sweats.
    for (const [i, lx] of [[0, -0.42], [1, 0.42]]) { const [vx, vy] = F(lx * fh, fh * 0.94);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.16, wallTop * 0.76, wallTop * 0.88, 'ty_sw_milk_dk', seed + 20 + i, night, alpha, false, yaw, fh * 0.03); }
    { const [gx, gy] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.20, h * 0.10, wallTop * 0.62, 'ty_door', seed + 24, night, alpha, false, yaw, fh * 0.03); }
  },
  sw_fire(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LONG FIRE (the Thornwarren) — the town eats around an OPEN FIRE TRENCH,
    // so unlike Terminus' Long Table there is no roof over the middle at all: a long stone-lined
    // trench with the fire in it, a bread oven at one end, and a ring of low seating round the lot.
    const oven = h * 0.72;
    // 1) THE TRENCH — a long low stone surround with the fire down the length of it.
    // ⚠ THE TRENCH RUNS FRONT TO BACK, from the open end to the oven, with the benches on its other
    //    three sides. With no `fd` it was a square hearth, and the ember bed sat inside its kerb under
    //    the kerb's own lid, so the fire the building is named for was never drawn.
    const yaw = faceYaw(E);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.16, 0, h * 0.10, 'ty_sw_kept', seed, night, alpha, true, yaw, fh * 0.62);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.11, h * 0.10, h * 0.125, 'ty_sw_ember', seed + 1, night, alpha, true, yaw, fh * 0.56);
    glowPool(ctx, cam, dx, dy, h * 0.14, '255,146,58', 16, alpha * (night ? 0.72 : 0.24));
    drawSmoke(ctx, cam, dx, dy, h * 0.16, '208,198,182', alpha * 0.55, now, seed + 2);
    // 2) THE BREAD OVEN at one end — a fired-earth dome, the one built thing on the tile.
    { const [ox, oy] = F(0, -fh * 0.94);
      drawFacetDrum(ctx, cam, ox, oy, 0, oven, fh * 0.36, fh * 0.10, 11, alpha,
        (f) => 'rgb(' + (126 + f.nl * 52 | 0) + ',' + (84 + f.nl * 36 | 0) + ',' + (58 + f.nl * 26 | 0) + ')', 'rgb(84,54,36)');
      draw3DBoxAt(ctx, cam, ox, oy, fh * 0.14, 0, h * 0.24, 'ty_sw_ember', seed + 6, night, alpha, false);
      glowPool(ctx, cam, ox, oy, h * 0.20, '255,168,80', 8, alpha * (night ? 0.56 : 0.2)); }
    // 3) THE SEATING — low benches ringing the trench on both sides and the open end. Everyone
    //    faces in, which is what makes the shape read as a meal rather than a forge.
    for (const t of [-1, 1]) { const [bx, by] = F(t * fh * 0.72, fh * 0.10);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.10, h * 0.06, h * 0.14, 'ty_sw_gate_dk', seed + 10 + t, night, alpha, true, yaw, fh * 0.40); }
    { const [bx, by] = F(0, fh * 1.04); draw3DBoxAt(ctx, cam, bx, by, fh * 0.60, h * 0.06, h * 0.14, 'ty_sw_gate_dk', seed + 14, night, alpha, true, yaw, fh * 0.08); }
    // 4) A rack of split wood at the back, stacked. Somebody stacked it.
    { const [wx, wy] = F(fh * 0.86, -fh * 0.60);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.24, 0, h * 0.34, 'ty_sw_gate_dk', seed + 18, night, alpha, true); }
  },
  sw_foundry(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE FOUNDRY (the Thornwarren) — where the plate comes from. Deliberately
    // not the Yards' Ferro model, which is a cupola-and-twin-chimneys industrial plant: this is an
    // open-fronted shed round a single squat furnace, with the slag tipped in a heap outside and a
    // quench trough by the door. It is small, and it does one thing.
    const post = h * 0.92, roof = h * 1.04, stack = h * 1.62;
    // 1) The shed: a roof on posts, open on the entrance side, walled at the back against the wind.
    { const [bx, by] = F(0, -fh * 0.88); draw3DBoxAt(ctx, cam, bx, by, fh * 1.00, 0, post, pal, seed, night, alpha, false); }
    for (const tx of [-1, 1]) for (const ly of [-0.30, 0.70]) { const [px, py] = F(tx * fh * 0.86, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.07, 0, post, 'ty_sw_plate', seed + 2 + tx + ly, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, post, roof, 'ty_sw_plate', seed + 8, night, alpha, true);
    // 2) THE FURNACE and its stack — one squat drum with a chimney straight up out of the roof,
    //    and the ember light under it that never goes fully out.
    { const [fx, fy] = F(-fh * 0.34, -fh * 0.34);
      drawFacetDrum(ctx, cam, fx, fy, 0, h * 0.62, fh * 0.26, fh * 0.22, 9, alpha,
        (f) => 'rgb(' + (88 + f.nl * 44 | 0) + ',' + (62 + f.nl * 32 | 0) + ',' + (48 + f.nl * 24 | 0) + ')', 'rgb(52,38,30)');
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.13, h * 0.62, stack, 'ty_sw_plate', seed + 12, night, alpha, true);
      drawSmoke(ctx, cam, fx, fy, stack, '190,176,164', alpha * 0.75, now, seed + 12);
      glowPool(ctx, cam, fx, fy, h * 0.30, '255,132,44', 10, alpha * (night ? 0.64 : 0.22)); }
    // 3) THE SLAG HEAP outside — poured, cooled, and added to for years.
    { const [sx, sy] = F(fh * 0.88, fh * 0.94);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.40, 0, h * 0.24, 'ty_sw_slag', seed + 20, night, alpha, true);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.24, h * 0.24, h * 0.38, 'ty_sw_slag', seed + 21, night, alpha, true); }
    // 4) THE QUENCH TROUGH by the door, steaming whenever anything has just come out.
    { const [qx, qy] = F(fh * 0.20, fh * 0.86);
      draw3DBoxAt(ctx, cam, qx, qy, fh * 0.26, 0, h * 0.16, 'ty_sw_water', seed + 24, night, alpha, true);
      drawSmoke(ctx, cam, qx, qy, h * 0.16, '214,220,216', alpha * 0.4, now, seed + 24); }
  },
  sw_kiln(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE KILN (the Thornwarren) — the town is built out of fired earth, so this
    // is where the town comes from. A pair of bottle kilns, which is a silhouette nothing else in
    // the game has: a fat tapering cone with a mouth at the base and heat coming off the top of it.
    const kiln = h * 1.34;
    for (const [i, lx, sc] of [[0, -0.42, 1.00], [1, 0.52, 0.82]]) {
      const [kx, ky] = F(lx * fh, 0), top = kiln * (i === 0 ? 1 : 0.84);
      // The bottle: a wide base tapering to a narrow throat. Two drums, so the waist reads.
      drawFacetDrum(ctx, cam, kx, ky, 0, top * 0.52, fh * 0.42 * sc, fh * 0.38 * sc, 12, alpha,
        (f) => 'rgb(' + (128 + f.nl * 54 | 0) + ',' + (82 + f.nl * 38 | 0) + ',' + (56 + f.nl * 28 | 0) + ')', 'rgb(88,54,36)');
      drawFacetDrum(ctx, cam, kx, ky, top * 0.52, top, fh * 0.38 * sc, fh * 0.11 * sc, 12, alpha,
        (f) => 'rgb(' + (120 + f.nl * 50 | 0) + ',' + (76 + f.nl * 36 | 0) + ',' + (52 + f.nl * 26 | 0) + ')', 'rgb(82,50,34)');
      // Iron banding round the waist — a kiln that isn't banded comes apart.
      drawRing(ctx, cam, kx, ky, top * 0.34, fh * 0.40 * sc, 12, 'rgba(0,0,0,0.36)', 2, alpha);
      drawRing(ctx, cam, kx, ky, top * 0.52, fh * 0.385 * sc, 12, 'rgba(0,0,0,0.36)', 2, alpha);
      // The stoking mouth at the base, and the heat off the throat.
      { const [mx, my] = F(lx * fh, fh * 0.40 * sc);
        draw3DBoxAt(ctx, cam, mx, my, fh * 0.13 * sc, 0, h * 0.22, 'ty_sw_ember', seed + 10 + i, night, alpha, false);
        glowPool(ctx, cam, mx, my, h * 0.16, '255,140,52', 8, alpha * (night ? 0.6 : 0.2)); }
      drawSmoke(ctx, cam, kx, ky, top, '196,184,170', alpha * 0.7, now, seed + 20 + i);
      glowPool(ctx, cam, kx, ky, top, '255,158,70', 7, alpha * (night ? 0.42 : 0.12));
    }
    // The drying yard between them — racks of unfired ware waiting its turn.
    { const [yx, yy] = F(0, fh * 1.06);
      draw3DBoxAt(ctx, cam, yx, yy, fh * 0.70, 0, h * 0.08, 'ty_sw_kiln_dk', seed + 30, night, alpha, true);
      draw3DBoxAt(ctx, cam, yx, yy, fh * 0.60, h * 0.08, h * 0.24, 'ty_sw_kiln_dk', seed + 31, night, alpha, true); }
  },
  sw_water(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SWEETWATER (the Thornwarren) — the clean well, and the reason the town
    // is where it is. A stone well head under a shingled canopy on four posts, a hand pump, and a
    // long queue-worn apron round it. ⚠ The radiation gradient's HOLE is the town: this is the
    // sweet water, so nothing here glows, ticks, or is fenced off. It is a village pump.
    const post = h * 0.94, roof = h * 1.10;
    // 1) The worn apron — the ground round a well used by everyone every day.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.20, 0, h * 0.05, 'ty_sw_kept', seed, night, alpha, true);
    // 2) THE WELL HEAD — a stone drum you can lean on, waist high.
    drawFacetDrum(ctx, cam, dx, dy, h * 0.05, h * 0.34, fh * 0.30, fh * 0.29, 11, alpha,
      (f) => 'rgb(' + (104 + f.nl * 46 | 0) + ',' + (108 + f.nl * 46 | 0) + ',' + (102 + f.nl * 42 | 0) + ')', 'rgb(70,72,68)');
    drawRing(ctx, cam, dx, dy, h * 0.34, fh * 0.305, 11, 'rgba(0,0,0,0.28)', 2, alpha);
    // 3) The canopy on four posts — shade over the water, which is the whole civic gesture.
    for (const tx of [-1, 1]) for (const ty of [-1, 1]) { const [px, py] = F(tx * fh * 0.62, ty * fh * 0.62);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, post, 'ty_sw_gate_dk', seed + 4 + tx + ty, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, post, roof, 'ty_sw_hide', seed + 10, night, alpha, true);
    // 4) THE PUMP and the trough it fills, and a yoke of buckets left on the rim.
    { const [px, py] = F(fh * 0.30, fh * 0.12);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.06, h * 0.34, h * 0.62, 'ty_sw_plate', seed + 14, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.20, h * 0.56, h * 0.60, 'ty_sw_plate', seed + 15, night, alpha, false); }
    { const [tx, ty] = F(-fh * 0.52, fh * 0.44);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.22, 0, h * 0.16, 'ty_sw_water', seed + 18, night, alpha, true); }
    glowPool(ctx, cam, dx, dy, h * 0.36, '160,220,224', 8, alpha * (night ? 0.22 : 0.08));
  },
  sw_hound(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE HOUNDYARD (the Thornwarren) — building_type junkyard, but nobody here
    // is scrapping cars: it is the DOG YARD, and the salvage is what the runs are built out of. A
    // row of roofed pens off a spine wall, a feed store at one end, and a scratched-bare exercise
    // ring. Kept clean, like everything else in this town.
    const wall = h * 0.54, pen = h * 0.44, roof = h * 0.52;
    // 1) THE SPINE — one long back wall of mismatched plate that every run hangs off.
    { const [bx, by] = F(0, -fh * 0.86);
      draw3DBoxAt(ctx, cam, bx, by, fh * 1.10, 0, wall, 'ty_sw_plate', seed, night, alpha, true); }
    // 2) THE PENS — four, identical, each roofed, each with a gate. Identical is the point.
    for (let i = 0; i < 4; i++) {
      const [px, py] = F((-0.78 + i * 0.52) * fh, -fh * 0.34);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.22, 0, pen, 'ty_sw_pen', seed + 4 + i, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.26, pen, roof, pal, seed + 10 + i, night, alpha, true);
    }
    // 3) THE RING — a low rail round scratched-bare ground out front, and a water trough in it.
    for (const t of [-1, 1]) { const [rx, ry] = F(t * fh * 0.96, fh * 0.66);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.04, 0, h * 0.24, 'ty_sw_gate_dk', seed + 20 + t, night, alpha, false); }
    // ⚠ The rail across the front of the ring is a BAR between those two posts, and with no `fd`
    //   it was a square box: half a tile of solid timber lying across the yard, lidless. It takes
    //   the posts' own thickness. See `scripts/shapes/lidless.mjs`.
    { const [gx, gy] = F(0, fh * 1.18); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.96, h * 0.18, h * 0.22, 'ty_sw_gate_dk', seed + 24, night, alpha, true, 0, fh * 0.04); }
    { const [tx, ty] = F(fh * 0.50, fh * 0.62); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.18, 0, h * 0.12, 'ty_sw_water', seed + 26, night, alpha, true); }
    // 4) THE FEED STORE — the one lockable thing on the tile, because meat is worth more than dogs.
    { const [sx, sy] = F(fh * 0.92, -fh * 0.30);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.30, 0, h * 0.60, 'ty_sw_plate', seed + 30, night, alpha, true); }
  },
  sw_merc(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // RINDLE'S (the Thornwarren) — the town's store, and it must not share the
    // Reach's Dry Goods false front: that is a frontier BOARDWALK building on a street, squared off
    // to look taller than it is. Rindle's is a lean-to trading post built against the thorn — a
    // deep shaded verandah, goods stacked out in the open, and no attempt to look like anything.
    const wallTop = h * 0.76, eave = h * 0.90;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, wallTop, eave, 'ty_sw_merc_dk', seed + 1, night, alpha, true);
    // 1) THE VERANDAH — deep, on five posts, running the whole front. Where the trading happens.
    { const [ax, ay] = F(0, fh * 1.22);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.96, h * 0.56, h * 0.64, 'ty_sw_cloth', seed + 2, night, alpha, true);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.94, 0, h * 0.06, 'ty_sw_merc_dk', seed + 3, night, alpha, true); }
    for (const [i, lx] of [[0, -0.86], [1, -0.44], [2, 0.00], [3, 0.44], [4, 0.86]]) {
      const [px, py] = F(lx * fh, fh * 1.52);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, h * 0.56, 'ty_sw_merc_dk', seed + 10 + i, night, alpha, false); }
    // 2) THE STOCK, out in the open under the verandah: sacks stacked, and a barrel at each end.
    { const [sx, sy] = F(-fh * 0.30, fh * 1.16);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.30, h * 0.06, h * 0.30, 'ty_sw_cloth', seed + 20, night, alpha, true); }
    for (const t of [-1, 1]) { const [bx, by] = F(t * fh * 0.80, fh * 1.20);
      drawFacetDrum(ctx, cam, bx, by, h * 0.06, h * 0.32, fh * 0.10, fh * 0.09, 8, alpha,
        (f) => 'rgb(' + (112 + f.nl * 48 | 0) + ',' + (86 + f.nl * 38 | 0) + ',' + (58 + f.nl * 28 | 0) + ')', 'rgb(72,54,36)'); }
    // 3) A hanging scale on the verandah beam — the only piece of precision equipment out here,
    //    and the one thing anyone in this town argues about.
    { const [hx, hy] = F(fh * 0.44, fh * 1.22);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.03, h * 0.40, h * 0.56, 'ty_sw_plate', seed + 30, night, alpha, false);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.14, h * 0.36, h * 0.40, 'ty_sw_plate', seed + 31, night, alpha, true, 0, fh * 0.06); }
    glowPool(ctx, cam, dx, dy, wallTop * 0.6, '255,204,146', 9, alpha * (night ? 0.36 : 0.12));
  },
  sw_bath(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE BATHHOUSE (the Thornwarren) — an OPEN-AIR bathing pool with a screen
    // wall round it and a fire under the water at one end, which is a different building entirely
    // from the Reach's shed and Terminus' wash trough. The screen is the building; the pool is the
    // point; and the reason the screen exists at all is modesty, which is a domestic idea.
    const screen = h * 0.72;
    // 1) THE SCREEN — a ring wall with one gap in it, open to the sky.
    drawFacetDrum(ctx, cam, dx, dy, 0, screen, fh * 1.02, fh * 1.00, 12, alpha,
      (f) => 'rgb(' + (104 + f.nl * 48 | 0) + ',' + (88 + f.nl * 40 | 0) + ',' + (72 + f.nl * 32 | 0) + ')', 'rgb(66,52,42)');
    // 2) THE POOL inside it, sunk, steaming, warm-lit from the fire end.
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.06, fh * 0.72, fh * 0.72, 12, alpha,
      (f) => 'rgb(' + (72 + f.nl * 40 | 0) + ',' + (100 + f.nl * 50 | 0) + ',' + (102 + f.nl * 46 | 0) + ')', 'rgb(50,72,74)');
    drawSmoke(ctx, cam, dx, dy, h * 0.10, '216,224,222', alpha * 0.65, now, seed + 2);
    glowPool(ctx, cam, dx, dy, h * 0.10, '170,236,232', 12, alpha * (night ? 0.4 : 0.14));
    // 3) THE FIRE END — a stoke hole through the screen wall with the heat under the pool floor.
    { const [fx, fy] = F(0, -fh * 1.00);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.22, 0, h * 0.26, 'ty_sw_ember', seed + 4, night, alpha, false);
      glowPool(ctx, cam, fx, fy, h * 0.18, '255,140,56', 9, alpha * (night ? 0.56 : 0.18));
      const [sx, sy] = F(-fh * 0.24, -fh * 1.06);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.09, 0, h * 1.10, 'ty_sw_plate', seed + 5, night, alpha, true);
      drawSmoke(ctx, cam, sx, sy, h * 1.10, '200,192,180', alpha * 0.6, now, seed + 5); }
    // 4) A bench and pegs by the gap — clothes go somewhere, and somebody built a place for them.
    { const [bx, by] = F(fh * 0.52, fh * 0.96);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, h * 0.08, h * 0.14, 'ty_sw_gate_dk', seed + 8, night, alpha, true); }
  },
  sw_depot(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE DEADLEG (the Thornwarren) — the haulage yard, and the name says what
    // it is: the end of a road that goes nowhere else. An open yard rather than a shed, with a
    // loading ramp built up out of packed earth, a thorn-screened bay, and a spare-wheel rack.
    const ramp = h * 0.34, office = h * 0.66;
    // 1) THE EARTH RAMP — a truck bed is chest height, so the ground comes up to meet it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, ramp * 0.5, 'ty_thorn_berm', seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, ramp * 0.5, ramp, 'ty_sw_depot', seed + 1, night, alpha, true);
    // 2) THE OFFICE — one small hut on the ramp, which is the whole built portion of the depot.
    { const [ox, oy] = F(-fh * 0.66, -fh * 0.50);
      draw3DBoxAt(ctx, cam, ox, oy, fh * 0.36, ramp, office, pal, seed + 4, night, alpha, false);
      draw3DBoxAt(ctx, cam, ox, oy, fh * 0.44, office, office + h * 0.10, 'ty_sw_plate', seed + 5, night, alpha, true);
      glowPool(ctx, cam, ox, oy, office * 0.86, '255,200,146', 6, alpha * (night ? 0.42 : 0.14)); }
    // 3) THE THORN SCREEN down the windward flank — the wall's own material, put to a dull use,
    //    which is the most Thornwarren thing on the tile.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.30, ramp, ramp + h * 0.46, 'ty_thorn_dk', seed + 8, night, alpha, false, 0.30);
    // 4) THE WHEEL RACK — four spares standing on edge in a frame, the commonest failure out here.
    for (const [i, lx] of [[0, 0.26], [1, 0.52], [2, 0.78], [3, 1.02]]) {
      const [wx, wy] = F(lx * fh, fh * 0.58);
      drawFacetDrum(ctx, cam, wx, wy, ramp, ramp + h * 0.28, fh * 0.13, fh * 0.13, 9, alpha,
        (f) => 'rgb(' + (48 + f.nl * 26 | 0) + ',' + (44 + f.nl * 24 | 0) + ',' + (42 + f.nl * 22 | 0) + ')', 'rgb(30,28,28)'); }
  },
  // ══ DEADWATER ═══════════════════════════════════════════════
  // The region that stopped. Two buildings and a dam, and the shared read on all three is that
  // nothing has been maintained for a very long time — the exact inversion of Terminus, which is
  // built out of the same materials and keeps every one of them.
  dw_turbine(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE TURBINE HALL (Deadwater) — and the thing to understand is that it
    // WORKS. It was written first as a dead powerhouse with a hole in the roof, which is exactly
    // the wrong region: the Null are not squatting in a ruin, they are running one. The generators
    // came OUT; the penstocks now turn a line shaft that leaves the building on pillow blocks and
    // goes overhead to the shops, so the works runs on water and belting and not one volt.
    const wallTop = h * 0.94, ridge = h * 1.10;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.04, 0, wallTop, pal, seed, night, alpha, false);
    // 1) A COMPLETE ROOF, swept and sound. Its being intact is the whole argument of the building.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 2) THE PENSTOCKS — three pipes down the back wall, wet and in use.
    for (const [i, lx] of [[0, -0.56], [1, 0.00], [2, 0.56]]) { const [px, py] = F(lx * fh, -fh * 0.98);
      drawFacetDrum(ctx, cam, px, py, 0, h * (0.62 + i * 0.04), fh * 0.19, fh * 0.19, 10, alpha,
        (f) => 'rgb(' + (70 + f.nl * 40 | 0) + ',' + (74 + f.nl * 40 | 0) + ',' + (72 + f.nl * 36 | 0) + ')', 'rgb(44,46,44)');
      drawRing(ctx, cam, px, py, h * 0.40, fh * 0.195, 10, 'rgba(0,0,0,0.30)', 2, alpha); }
    // 3) THE LINE SHAFT — a shaft leaving the gable on pillow blocks and running out over the yard
    //    on trestles, with a belt hanging off the first pulley. This is Deadwater's power grid,
    //    and drawing it as a shaft rather than as a cable is the entire anti-tech statement.
    { const shaftZ = h * 0.86;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.05, shaftZ, shaftZ + h * 0.05, 'ty_dw_iron', seed + 10, night, alpha, true);
      for (const [i, ly] of [[0, 1.02], [1, 1.62]]) { const [tx, ty] = F(0, ly * fh);
        draw3DBoxAt(ctx, cam, tx, ty, fh * 0.05, shaftZ, shaftZ + h * 0.05, 'ty_dw_iron', seed + 12 + i, night, alpha, true);
        for (const t of [-1, 1]) { const [lx2, ly2] = F(t * fh * 0.16, ly * fh);
          draw3DBoxAt(ctx, cam, lx2, ly2, fh * 0.035, 0, shaftZ, 'ty_dw_timber', seed + 16 + i + t, night, alpha, false); } }
      // The pulley and the belt coming off it, running down toward the shops.
      { const [gx, gy] = F(0, fh * 1.02);
        drawFacetDrum(ctx, cam, gx, gy, shaftZ - h * 0.09, shaftZ + h * 0.02, fh * 0.15, fh * 0.15, 10, alpha,
          (f) => 'rgb(' + (96 + f.nl * 44 | 0) + ',' + (76 + f.nl * 36 | 0) + ',' + (54 + f.nl * 26 | 0) + ')', 'rgb(58,46,32)');
        draw3DBoxAt(ctx, cam, gx, gy, fh * 0.04, h * 0.30, shaftZ - h * 0.06, 'ty_dw_belt', seed + 22, night, alpha, false, 0.16); } }
    // 4) THE COVERS OFF. Rule 4 of the region, drawn: two inspection covers stood on edge AGAINST
    //    the wall beside the openings they came out of, rather than lying about as debris.
    for (const [i, lx] of [[0, -0.40], [1, 0.34]]) { const [cx, cy] = F(lx * fh, fh * 1.00);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.16, 0, h * 0.40, 'ty_dw_iron', seed + 30 + i, night, alpha, true, 0.12 + i * 0.06, fh * 0.03); }
    // 5) One oil lamp over the door. Warm, small, and the only light on the building — there is no
    //    electricity in this region and a floodlit powerhouse would say the opposite of the truth.
    { const [lx, ly] = F(0, fh * 1.06);
      glowPool(ctx, cam, lx, ly, h * 0.66, '255,196,118', 6, alpha * (night ? 0.44 : 0.12)); }
  },
  dw_depot(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE DRY RUN (Deadwater) — the works' road head, and it is KEPT: a swept
    // hardstanding, a gantry of scaffold and chain-block instead of a crane, a hand-pumped fuel
    // drum on a stand, and a board with the week's runs chalked on it. Not a derelict truck stop.
    const wallTop = h * 0.82, ridge = h * 0.96;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 1) THE DOORS — timber, hung on strap hinges, standing OPEN and hooked back. Open because
    //    somebody is working, not because the shed has been left.
    if (frontVis) for (const [i, t] of [[0, -1], [1, 1]]) { const [dx2, dy2] = F(t * fh * 0.62, fh * 0.94);
      draw3DBoxAt(ctx, cam, dx2, dy2, fh * 0.30, 0, wallTop * 0.82, 'ty_dw_timber', seed + 4 + i, night, alpha, true, t * 0.42, fh * 0.04); }
    // 2) THE GANTRY — scaffold tube and a chain block. A hand hoist, which is the whole point.
    for (const tx of [-1, 1]) for (const ly of [0.90, 1.60]) { const [px, py] = F(tx * fh * 0.72, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.045, 0, h * 0.92, 'ty_dw_iron', seed + 10 + tx + ly, night, alpha, false); }
    { const [bx, by] = F(0, fh * 1.24);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.76, h * 0.92, h * 0.98, 'ty_dw_iron', seed + 16, night, alpha, false);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.09, h * 0.60, h * 0.92, 'ty_dw_iron', seed + 17, night, alpha, true, 0, fh * 0.03); }
    // 3) THE FUEL DRUM on a stand with a hand pump on top — no dispenser, no dial, no card reader.
    { const [fx, fy] = F(fh * 0.94, fh * 0.50);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.26, 0, h * 0.34, 'ty_dw_timber', seed + 20, night, alpha, true);
      drawFacetDrum(ctx, cam, fx, fy, h * 0.34, h * 0.72, fh * 0.20, fh * 0.20, 10, alpha,
        (f) => 'rgb(' + (84 + f.nl * 40 | 0) + ',' + (72 + f.nl * 36 | 0) + ',' + (62 + f.nl * 28 | 0) + ')', 'rgb(50,44,38)');
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.05, h * 0.72, h * 0.94, 'ty_dw_brass', seed + 21, night, alpha, false); }
    // 4) THE RUN BOARD by the doors — slate, ruled, under its own little roof so the chalk keeps.
    { const [sx, sy] = F(-fh * 0.88, fh * 1.06);
      for (const t of [-1, 1]) { const [lx, ly] = F(fh * (-0.88 + t * 0.20), fh * 1.06);
        draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, 0, h * 0.70, 'ty_dw_timber', seed + 26 + t, night, alpha, false); }
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.42, h * 0.36, h * 0.70, 'ty_dw_slate', seed + 30, night, alpha, true, 0, fh * 0.03);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.48, h * 0.70, h * 0.76, 'ty_dw_timber', seed + 31, night, alpha, true); }
    { const [lx, ly] = F(0, fh * 1.00); glowPool(ctx, cam, lx, ly, h * 0.62, '255,190,112', 6, alpha * (night ? 0.40 : 0.12)); }
  },
  // ══ DEADWATER — THE WORKS ═══════════════════════════════════
  // ⚠ THREE RULES, and every arm below obeys all three.
  //  1. NOTHING IS ELECTRIC. The region is deliberately dark — one orphan `power_zones` row per
  //     tile, offline from the first power cycle — so every light here is flame, oil or carbide,
  //     and there is not one LED, beacon, neon band or blinkLight anywhere in this block. A lamp
  //     is small and warm and close to a door; nothing floodlights anything.
  //  2. IT IS MAINTAINED, NOT SURVIVING. Deadwater is not a ruin the Null are squatting in. Roofs
  //     are whole, ground is swept, paint is fresh, and the difference between this region and a
  //     derelict one has to be legible from the air or the whole faction reads wrong.
  //  3. THE COVERS ARE OFF (the region's own rule 4). Every mechanism is open to inspection, and
  //     the covers stand ON EDGE AGAINST their housings rather than lying about as debris. That
  //     one detail is the difference between 'stripped' and 'being worked on', and it recurs
  //     deliberately across these arms — it is the region's signature, not a repeated asset.
  dw_school(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SCHOOLROOM — a dozen crates facing a slate, and on the wall a clock
    // WITH THE CASE OFF so the class can watch the escapement let go. A timber schoolhouse with
    // big windows, because you cannot teach by lamplight in a region that has no electricity.
    const wallTop = h * 0.70, ridge = h * 0.92;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 1) THE WINDOW WALL — three tall lights down the sunny flank, and they are the lighting plan.
    for (const [i, ly] of [[0, -0.42], [1, 0.00], [2, 0.42]]) { const [wx, wy] = F(fh * 0.92, ly * fh);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.05, h * 0.22, wallTop * 0.90, 'ty_dw_paint', seed + 4 + i, night, alpha, false); }
    // 2) THE BELL on a bracket over the door — rung by hand, on a rope, which is how a school
    //    without a siren starts its day.
    { const [bx, by] = F(0, fh * 0.94);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.03, wallTop * 0.86, wallTop + h * 0.16, 'ty_dw_iron', seed + 10, night, alpha, false);
      drawFacetDrum(ctx, cam, bx, by, wallTop + h * 0.06, wallTop + h * 0.16, fh * 0.09, fh * 0.05, 8, alpha,
        (f) => 'rgb(' + (140 + f.nl * 56 | 0) + ',' + (110 + f.nl * 44 | 0) + ',' + (52 + f.nl * 26 | 0) + ')', 'rgb(96,74,34)'); }
    // 3) THE STOVE FLUE, and a stack of split wood against the gable with a board over it.
    { const [fx, fy] = F(-fh * 0.36, -fh * 0.40);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.07, ridge, ridge + h * 0.22, 'ty_dw_iron', seed + 14, night, alpha, true);
      drawSmoke(ctx, cam, fx, fy, ridge + h * 0.22, '204,198,186', alpha * 0.45, now, seed + 14); }
    { const [wx, wy] = F(-fh * 0.92, fh * 0.30);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.16, 0, h * 0.30, 'ty_dw_timber', seed + 18, night, alpha, true); }
    { const [gx, gy] = F(0, fh * 0.92); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, wallTop * 0.58, 'ty_door', seed + 20, night, alpha, true, 0, fh * 0.05); }
    glowPool(ctx, cam, dx, dy, wallTop * 0.52, '255,206,146', 7, alpha * (night ? 0.30 : 0.12));
  },
  dw_sleepers(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SLEEPERS — the bunkhouse. Two long rows, beds made, a stove at
    // EACH end, and it smells of soap and cold iron. So: long and low with two flues rather than
    // one, and a boot rack and a wash line outside. Made beds are the tell, and the flues carry it.
    const wallTop = h * 0.64, ridge = h * 0.82;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.84, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 1) A STOVE AT EACH END — two flues, symmetric, both alight. One would be a cottage.
    for (const [i, ly] of [[0, -0.66], [1, 0.66]]) { const [fx, fy] = F(0, ly * fh);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.07, ridge, ridge + h * 0.24, 'ty_dw_iron', seed + 4 + i, night, alpha, true);
      drawSmoke(ctx, cam, fx, fy, ridge + h * 0.24, '206,200,188', alpha * 0.42, now, seed + 4 + i); }
    // 2) THE WINDOW ROW — small, high, evenly spaced, and about half of them lit. Half, because
    //    the works runs shifts and the ones not lit are the ones on gate duty.
    if (frontVis) for (let i = 0; i < 6; i++) { const [wx, wy] = F((-0.62 + i * 0.25) * fh, fh * 0.86);
      if (frac(seed * 6 + i) > 0.5) glowPool(ctx, cam, wx, wy, wallTop * 0.66, '255,198,132', 4, alpha * (night ? 0.36 : 0.10)); }
    // 3) THE BOOT RACK under the eave, and a wash line on two poles behind. Boots OFF at the door.
    // ⚠ EVERY BOX HERE TAKES A DEPTH. `draw3DBoxAt` with no `fd` is as deep as it is wide, so the
    //    rack was a 1.4 fh slab, each sheet a cube of canvas and each door a block standing out of
    //    the wall. And the line is drawn now: the sheets used to hang between the poles from nothing.
    const yaw = faceYaw(E);
    { const [bx, by] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, bx, by, fh * 0.70, 0, h * 0.12, 'ty_dw_timber', seed + 12, night, alpha, true, yaw, fh * 0.06); }
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.86, -fh * 0.92);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.025, 0, h * 0.56, 'ty_dw_timber', seed + 16 + t, night, alpha, false); }
    emitWire(ctx, cam, W3(-fh * 0.86, -fh * 0.92, h * 0.53), W3(fh * 0.86, -fh * 0.92, h * 0.53), 1.2, 'rgba(70,62,52,0.9)', alpha, { pull: 0.02 });
    for (const [i, lx] of [[0, -0.48], [1, -0.06], [2, 0.36]]) { const g = frac(seed * 4 + i);
      const [cx, cy] = F(lx * fh, -fh * 0.92);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.16, h * (0.28 - g * 0.06), h * 0.52, 'ty_dw_canvas', seed + 20 + i, night, alpha, false, yaw, fh * 0.008); }
    for (const t of [-1, 1]) { const [gx, gy] = F(t * fh * 0.56, fh * 0.86);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.14, 0, wallTop * 0.58, 'ty_door', seed + 26 + t, night, alpha, false, yaw, fh * 0.02); }
  },
  dw_reckoning(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE RECKONING — one table, four chairs, and every wall covered in the
    // working for a march across the whole width of the world. It is the most important room in
    // the region and it is the SMALLEST BUILDING ON THE PLATFORM, which is the point: a squat
    // windowless stone cell with one door and one flue. No sign. Nothing marks it at all.
    const wallTop = h * 0.60, cap = h * 0.68;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.70, wallTop, cap, 'ty_dw_stone', seed + 1, night, alpha, true);
    // 1) ONE small high window on the door side, lit late. The room works after everything else.
    if (frontVis) { const [wx, wy] = F(fh * 0.20, fh * 0.64);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.10, wallTop * 0.56, wallTop * 0.80, 'ty_dw_slate', seed + 4, night, alpha, false);
      glowPool(ctx, cam, wx, wy, wallTop * 0.68, '255,190,116', 5, alpha * (night ? 0.50 : 0.14)); }
    // 2) The flue, and a water butt at the corner. That is the entire exterior of the building.
    { const [fx, fy] = F(-fh * 0.18, -fh * 0.24);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.06, cap, cap + h * 0.20, 'ty_dw_iron', seed + 8, night, alpha, true);
      drawSmoke(ctx, cam, fx, fy, cap + h * 0.20, '200,194,182', alpha * 0.35, now, seed + 8); }
    { const [bx, by] = F(-fh * 0.56, fh * 0.44);
      drawFacetDrum(ctx, cam, bx, by, 0, h * 0.26, fh * 0.10, fh * 0.10, 8, alpha,
        (f) => 'rgb(' + (88 + f.nl * 40 | 0) + ',' + (72 + f.nl * 34 | 0) + ',' + (56 + f.nl * 26 | 0) + ')', 'rgb(54,44,34)'); }
    { const [gx, gy] = F(0, fh * 0.64); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.15, 0, wallTop * 0.62, 'ty_door', seed + 12, night, alpha, true, 0, fh * 0.05); }
  },
  dw_forge(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE FORGE — an open-fronted smithy with a HAND-CRANKED BLOWER on the
    // hearth and a DROP HAMMER worked off the overhead line shaft. What comes out is pinned or
    // bolted and there is not one weld on any of it, because everything here is made to be taken
    // apart again. The line shaft coming in over the roof is the detail that ties it to the hall.
    const post = h * 0.88, roof = h * 1.00, stack = h * 1.54;
    // 1) Open front: a back wall and a roof on posts, so you see straight into the working bay.
    { const [bx, by] = F(0, -fh * 0.86); draw3DBoxAt(ctx, cam, bx, by, fh * 0.98, 0, post, pal, seed, night, alpha, false); }
    for (const tx of [-1, 1]) for (const ly of [-0.20, 0.76]) { const [px, py] = F(tx * fh * 0.86, ly * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.07, 0, post, 'ty_dw_timber', seed + 2 + tx + ly, night, alpha, false); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, post, roof, 'ty_dw_slate', seed + 8, night, alpha, true);
    // 2) THE HEARTH and its stack, with the blower's wheel standing off the side of it — a big
    //    hand wheel is the single most legible 'no motor' object available.
    { const [hx, hy] = F(-fh * 0.44, -fh * 0.30);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.28, 0, h * 0.36, 'ty_dw_stone', seed + 10, night, alpha, true);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.24, h * 0.36, post, 'ty_dw_iron', seed + 11, night, alpha, false);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.11, roof, stack, 'ty_dw_iron', seed + 12, night, alpha, true);
      drawSmoke(ctx, cam, hx, hy, stack, '186,178,168', alpha * 0.6, now, seed + 12);
      glowPool(ctx, cam, hx, hy, h * 0.32, '255,128,44', 11, alpha * (night ? 0.70 : 0.28));
      const [bx2, by2] = F(-fh * 0.76, fh * 0.02);
      drawFacetDrum(ctx, cam, bx2, by2, h * 0.22, h * 0.28, fh * 0.20, fh * 0.20, 12, alpha,
        (f) => 'rgb(' + (74 + f.nl * 44 | 0) + ',' + (76 + f.nl * 44 | 0) + ',' + (74 + f.nl * 40 | 0) + ')', 'rgb(46,48,46)'); }
    // 3) THE DROP HAMMER — a frame with a head hung in it, and the belt going up to the shaft that
    //    crosses the roof. The belt is the power cable of this region.
    { const [mx, my] = F(fh * 0.42, -fh * 0.20);
      for (const t of [-1, 1]) { const [lx, ly] = F(fh * (0.42 + t * 0.14), -fh * 0.20);
        draw3DBoxAt(ctx, cam, lx, ly, fh * 0.05, 0, h * 0.94, 'ty_dw_iron', seed + 20 + t, night, alpha, false); }
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.34, h * 0.94, h * 1.02, 'ty_dw_iron', seed + 24, night, alpha, false);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.13, h * 0.44, h * 0.72, 'ty_dw_iron', seed + 25, night, alpha, false);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.04, h * 1.02, roof + h * 0.16, 'ty_dw_belt', seed + 26, night, alpha, false, 0.10); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.04, roof + h * 0.14, roof + h * 0.19, 'ty_dw_iron', seed + 30, night, alpha, false);
    // 4) THE QUENCH TROUGH with a skin on it, and the finished rack: everything pinned, no welds.
    { const [qx, qy] = F(fh * 0.10, fh * 0.60);
      draw3DBoxAt(ctx, cam, qx, qy, fh * 0.22, 0, h * 0.14, 'ty_dw_iron', seed + 34, night, alpha, true); }
    { const [rx, ry] = F(fh * 0.80, fh * 0.40);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.14, h * 0.20, h * 0.56, 'ty_dw_timber', seed + 36, night, alpha, true); }
  },
  dw_winding(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE WINDING SHOP — coils of enamelled wire on spindles overhead feeding
    // down to FOUR WINDING JIGS TURNED BY HAND. The old windings are kept, stripped, because the
    // copper is the point. So: a long bench shed with a spindle rack across the front and a copper
    // bin outside, and the only bright colour anywhere in the region is that bin.
    const wallTop = h * 0.72, ridge = h * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.04, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 1) THE SPINDLE RACK — six wire drums on a rail across the front under the eave, graded.
    for (let i = 0; i < 6; i++) { const [sx, sy] = F((-0.62 + i * 0.25) * fh, fh * 0.94);
      drawFacetDrum(ctx, cam, sx, sy, wallTop * 0.62, wallTop * 0.82, fh * 0.09, fh * 0.09, 9, alpha,
        (f) => 'rgb(' + (134 + f.nl * 54 | 0) + ',' + (84 + f.nl * 38 | 0) + ',' + (46 + f.nl * 24 | 0) + ')', 'rgb(88,56,30)'); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, wallTop * 0.84, wallTop * 0.88, 'ty_dw_iron', seed + 8, night, alpha, false);
    // 2) THE WINDOW BENCH — one long light down the front, because winding is close work and the
    //    only light in Deadwater that is any good is daylight.
    if (frontVis) { const [wx, wy] = F(0, fh * 0.90);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.70, wallTop * 0.24, wallTop * 0.56, 'ty_dw_paint', seed + 10, night, alpha, true, 0, fh * 0.05);
      glowPool(ctx, cam, wx, wy, wallTop * 0.42, '255,204,140', 8, alpha * (night ? 0.38 : 0.12)); }
    // 3) THE COPPER BIN outside — stripped old windings, kept. Warm-toned and deliberately the
    //    brightest object in the works.
    { const [bx, by] = F(fh * 0.90, fh * 0.50);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.20, 0, h * 0.22, 'ty_dw_iron', seed + 14, night, alpha, false);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.17, h * 0.22, h * 0.32, 'ty_dw_coal', seed + 15, night, alpha, true); }
    { const [gx, gy] = F(-fh * 0.62, fh * 0.90); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.15, 0, wallTop * 0.56, 'ty_door', seed + 20, night, alpha, true, 0, fh * 0.05); }
  },
  dw_tally(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE TALLY — the middle of the works, and it is a SWEPT YARD with a roofed
    // board at one end, not a building. The board carries the week in chalk, ruled off in columns
    // with a straight edge. Everything in this arm is low, so it never blocks the sight line across
    // the platform: the Tally is a place you look ACROSS, and a mass in the middle would ruin it.
    const boardZ0 = h * 0.34, boardZ1 = h * 0.92, roof = h * 1.02;
    // 1) THE SWEPT YARD — a graded apron, and it is swept, which is why it is drawn at all.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, 0, h * 0.03, 'ty_dw_stone', seed, night, alpha, true);
    // 2) THE BOARD, at ONE END, under its own little roof so the chalk keeps. Two posts, a slate
    //    face and a boarded pediment — the most-read object in the region.
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.54, -fh * 0.86);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.06, 0, roof, 'ty_dw_timber', seed + 2 + t, night, alpha, false); }
    // ⚠ THE BOARD IS A BOARD: thin (`fd`), facing the yard, under a hood that oversails it, and the
    //    benches run down the sides. With no depth the board and its roof were 1.1 fh square blocks.
    const yaw = faceYaw(E);
    { const [bx, by] = F(0, -fh * 0.86);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.56, boardZ0, boardZ1, pal, seed + 6, night, alpha, false, yaw, fh * 0.03);
      { const [hx, hy] = F(0, -fh * 0.80); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.66, boardZ1, roof, 'ty_dw_timber', seed + 7, night, alpha, true, yaw, fh * 0.12); }
      // A hooded oil lamp on the board's own roof, aimed down at it. The one thing lit after dark.
      const [gx, gy] = F(0, -fh * 0.78);
      glowPool(ctx, cam, gx, gy, boardZ1, '255,196,120', 7, alpha * (night ? 0.52 : 0.14)); }
    // 3) BENCHES DOWN BOTH SIDES — people wait here, and the benches are what make it a yard
    //    rather than a gap between sheds.
    for (const t of [-1, 1]) { const [nx, ny] = F(t * fh * 0.86, fh * 0.16);
      draw3DBoxAt(ctx, cam, nx, ny, fh * 0.08, h * 0.08, h * 0.16, 'ty_dw_timber', seed + 12 + t, night, alpha, true, yaw, fh * 0.40); }
  },
  dw_standpipe(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE STANDPIPE — the works' water: a CAST COLUMN with four taps round
    // it and a stone trough beneath, fed off the tailrace through a sand bed you can see the top
    // of. A tin cup hangs on a chain. It is one object, and it is the most public one here.
    const col = h * 0.96;
    // 1) The stone apron and the trough — worn, and standing water in it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, 0, h * 0.04, 'ty_dw_stone', seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.56, h * 0.04, h * 0.20, 'ty_dw_stone', seed + 1, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.46, h * 0.16, h * 0.19, 'ty_sw_water', seed + 2, night, alpha, true);
    // 2) THE COLUMN — cast, fluted, with a moulded cap. A piece of civic ironmongery, cared for.
    drawFacetDrum(ctx, cam, dx, dy, h * 0.20, col, fh * 0.13, fh * 0.10, 10, alpha,
      (f) => 'rgb(' + (74 + f.nl * 44 | 0) + ',' + (76 + f.nl * 44 | 0) + ',' + (74 + f.nl * 42 | 0) + ')', 'rgb(46,48,46)');
    drawFacetDrum(ctx, cam, dx, dy, col, col + h * 0.10, fh * 0.17, fh * 0.06, 10, alpha,
      (f) => 'rgb(' + (80 + f.nl * 46 | 0) + ',' + (82 + f.nl * 46 | 0) + ',' + (80 + f.nl * 44 | 0) + ')', 'rgb(50,52,50)');
    drawRing(ctx, cam, dx, dy, h * 0.30, fh * 0.135, 10, 'rgba(0,0,0,0.30)', 2, alpha);
    // 3) FOUR TAPS, one to each quarter. Four, because the whole works drinks here at once.
    for (const [tx, ty] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const [qx, qy] = F(tx * fh * 0.17, ty * fh * 0.17);
      draw3DBoxAt(ctx, cam, qx, qy, fh * 0.05, h * 0.52, h * 0.60, 'ty_dw_brass', seed + 10 + tx + ty * 2, night, alpha, false); }
    // 4) THE SAND BED beside it, open to view — you can see the top of it, which is the region's
    //    covers-off rule applied to the water supply.
    { const [sx, sy] = F(-fh * 0.74, -fh * 0.52);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.28, 0, h * 0.14, 'ty_dw_stone', seed + 20, night, alpha, true);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.24, h * 0.14, h * 0.18, 'ty_fallow_canvas', seed + 21, night, alpha, true); }
  },
  dw_stores(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE STORES — the most orderly room in the region: racked steel shelving,
    // fasteners by thread and length, bar stock standing in bins by section, and a card index by
    // the door. NOTHING IS LOCKED. So the doors are open, and the racking is visible THROUGH them —
    // an unlocked stores in a region that is planning a war is the whole faction in one building.
    const wallTop = h * 0.86, ridge = h * 0.98;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 1) THE OPEN DOORWAY — a wide gap, no shutter, no door leaf, no hasp. Deliberately no
    //    'ty_door' box: this building's argument is the absence of one.
    if (frontVis) { const [gx, gy] = F(0, fh * 0.98);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.44, 0, wallTop * 0.76, 'ty_dw_slate', seed + 2, night, alpha, true, 0, fh * 0.05);
      // 2) THE RACKING seen through it — three bays of shelf receding into the dark.
      for (const [i, ly] of [[0, 0.84], [1, 0.58], [2, 0.32]]) { const [rx, ry] = F(0, ly * fh);
        draw3DBoxAt(ctx, cam, rx, ry, fh * 0.40, wallTop * (0.20 + i * 0.04), wallTop * (0.26 + i * 0.04), 'ty_dw_iron', seed + 6 + i, night, alpha, true, 0, fh * 0.04); }
      glowPool(ctx, cam, gx, gy, wallTop * 0.40, '255,192,120', 6, alpha * (night ? 0.34 : 0.12)); }
    // 3) BAR STOCK STANDING IN BINS outside the end wall, by section — round, square, flat. Upright
    //    and sorted, which is the difference between a stores and a scrapyard.
    for (const [i, ly] of [[0, -0.30], [1, 0.06], [2, 0.42]]) { const [bx, by] = F(-fh * 0.94, ly * fh);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.09, 0, h * (0.62 + i * 0.08), 'ty_dw_iron', seed + 14 + i, night, alpha, false); }
    // 4) A ventilator on the ridge, turning on the wind, and the slate by the exit for what you took.
    { const [vx, vy] = F(fh * 0.34, -fh * 0.20);
      drawFacetDrum(ctx, cam, vx, vy, ridge, ridge + h * 0.12, fh * 0.10, fh * 0.12, 9, alpha,
        (f) => 'rgb(' + (84 + f.nl * 44 | 0) + ',' + (86 + f.nl * 44 | 0) + ',' + (84 + f.nl * 42 | 0) + ')', 'rgb(52,54,52)'); }
    { const [sx, sy] = F(fh * 0.42, fh * 0.98);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.16, wallTop * 0.32, wallTop * 0.56, 'ty_dw_slate', seed + 24, night, alpha, true, 0, fh * 0.03); }
  },
  dw_surgery(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SURGERY — a scrubbed table, instruments laid out on cloth in order of
    // size, and a HAND-CRANKED DRILL on a stand. On a shelf behind, four finished limbs in plain
    // steel. It is a limb shop, and the region does not pretend otherwise: the building is
    // lime-washed white, which nothing else here is, and that is the whole exterior statement.
    const wallTop = h * 0.78, ridge = h * 0.90;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 1) THE ROOFLIGHT — a raised glazed lantern along the ridge, because you cannot operate by
    //    lamplight and there is no other way to get light into the middle of a room here.
    { const [lx, ly] = F(0, 0);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.36, ridge, ridge + h * 0.16, 'ty_dw_paint', seed + 4, night, alpha, true);
      glowPool(ctx, cam, lx, ly, ridge + h * 0.10, '236,240,232', 8, alpha * (night ? 0.30 : 0.14)); }
    // 2) THE WASH — a tank on the gable with a pipe down to a scrub sink outside the door. Washing
    //    is the visible half of surgery and it is the half you can put on the outside of a building.
    { const [tx, ty] = F(-fh * 0.66, -fh * 0.40);
      drawFacetDrum(ctx, cam, tx, ty, wallTop, wallTop + h * 0.24, fh * 0.15, fh * 0.15, 9, alpha,
        (f) => 'rgb(' + (150 + f.nl * 56 | 0) + ',' + (152 + f.nl * 56 | 0) + ',' + (146 + f.nl * 52 | 0) + ')', 'rgb(100,102,98)');
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.03, h * 0.42, wallTop, 'ty_dw_brass', seed + 10, night, alpha, false);
      const [sx, sy] = F(-fh * 0.66, fh * 0.30);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.16, h * 0.30, h * 0.42, 'ty_dw_paint', seed + 12, night, alpha, true); }
    // 3) A CLEAN WINDOW either side of the door, and the door itself painted the same white.
    if (frontVis) for (const t of [-1, 1]) { const [wx, wy] = F(t * fh * 0.38, fh * 0.90);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.16, wallTop * 0.34, wallTop * 0.72, 'ty_dw_slate', seed + 16 + t, night, alpha, true, 0, fh * 0.04);
      glowPool(ctx, cam, wx, wy, wallTop * 0.54, '255,214,158', 5, alpha * (night ? 0.40 : 0.12)); }
    { const [gx, gy] = F(0, fh * 0.90); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, wallTop * 0.60, 'ty_dw_paint', seed + 20, night, alpha, true, 0, fh * 0.05); }
  },
  dw_gauge(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE GAUGE HOUSE — a stone hut on the dam's east shoulder: one room, one
    // window, one chair. A float on a wire goes down a pipe to the water and up to a DRUM OF PAPER
    // on the wall, and a pen draws the level as the drum turns, driven by a weight on a cord that
    // somebody winds every day. That weight is the model: an instrument powered by gravity.
    const wallTop = h * 0.64, ridge = h * 0.80;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.58, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.68, wallTop, ridge, 'ty_dw_slate', seed + 1, night, alpha, true);
    // 1) THE FLOAT PIPE — a stack going down through the shoulder to the water, with its head
    //    box on the outside wall so the mechanism is inspectable without going in.
    { const [px, py] = F(fh * 0.52, -fh * 0.30);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.09, 0, wallTop * 0.86, 'ty_dw_iron', seed + 4, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.15, wallTop * 0.86, wallTop * 1.02, 'ty_dw_iron', seed + 5, night, alpha, true);
      // The cover, off, on edge against the wall beside it. The region's signature detail.
      const [cx, cy] = F(fh * 0.52, fh * 0.10);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.12, 0, h * 0.30, 'ty_dw_iron', seed + 6, night, alpha, false, 0.16); }
    // 2) ONE WINDOW, facing the water, and a chair-height sill. It is a place somebody sits.
    if (frontVis) { const [wx, wy] = F(0, fh * 0.60);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.20, wallTop * 0.40, wallTop * 0.78, 'ty_dw_slate', seed + 10, night, alpha, true, 0, fh * 0.04);
      glowPool(ctx, cam, wx, wy, wallTop * 0.60, '255,196,124', 5, alpha * (night ? 0.44 : 0.14)); }
    // 3) THE GAUGE BOARD on the outside wall — a painted staff with the levels marked, and one
    //    ringed in white where the water stands today.
    { const [bx, by] = F(-fh * 0.60, fh * 0.16);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.05, 0, h * 0.92, 'ty_dw_paint', seed + 14, night, alpha, false); }
    { const [gx, gy] = F(0, fh * 0.60); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.13, 0, wallTop * 0.60, 'ty_door', seed + 18, night, alpha, true, 0, fh * 0.04); }
  },
  signalbox(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // TRACK MARKS FREIGHT — a dead railway SIGNAL BOX at the top of the cut:
    // three storeys of rusted lever frame, the windows knocked out and replaced by freight
    // manifests, and the name across the boards in yard-marking yellow. It is a tall narrow tower
    // with a walkway and an external stair, which nothing else in Coldwater is.
    const base = h * 0.44, floor2 = h * 0.92, cabTop = h * 1.44, roof = h * 1.58;
    // 1) THE BRICK BASE — the locking room, where the rodding used to come out.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.72, 0, base, 'ty_signal_brick', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.68, base, floor2, 'ty_signal_brick', seed + 1, night, alpha, false);
    // 2) THE CAB — the glazed top storey, overhanging, with the glass GONE and boarded with paper.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, floor2, cabTop, pal, seed + 2, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, cabTop, roof, 'ty_dw_slate', seed + 3, night, alpha, true);
    if (frontVis) for (const [i, lx] of [[0, -0.44], [1, 0.00], [2, 0.44]]) { const [wx, wy] = F(lx * fh, fh * 0.80);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.17, floor2 + h * 0.08, cabTop - h * 0.08, 'ty_fallow_canvas', seed + 8 + i, night, alpha, false); }
    // 3) THE EXTERNAL STAIR — a flight up the flank to a walkway round the cab. The silhouette.
    for (const [i, z] of [[0, 0.30], [1, 0.52], [2, 0.74]]) { const [sx, sy] = F(-fh * 0.86, (0.60 - i * 0.34) * fh);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.16, h * z, h * (z + 0.06), 'ty_signalbox', seed + 14 + i, night, alpha, true); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, floor2 - h * 0.06, floor2, 'ty_signalbox', seed + 20, night, alpha, true);
    // 4) The name in yard-marking yellow across the boards, and a single lamp on the walkway.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.72, base * 0.70, '#c4a830', night, alpha, 'TRACK MARKS FREIGHT');
    { const [lx, ly] = F(0, fh * 0.90); glowPool(ctx, cam, lx, ly, floor2 + h * 0.10, '255,200,130', 6, alpha * (night ? 0.40 : 0.12)); }
  },
  helpings(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SECOND HELPINGS — a single-storey unit let into the flank of the clone
    // facility, which the frontage does not mention and the queue does not discuss. White panel,
    // a thin canopy, and under it one long rank of seven dispensers standing open to the pavement.
    //
    // ⚠ THE PLANT IS WHAT THE BUILDING IS, AND IT WAS ONE PIPE WITH NOTHING ON EITHER END OF IT.
    // What this shop is FOR is that the food comes through the party wall from the vats next
    // door, and the only thing on the frontage that said so was a lagged line along the fascia
    // that came out of a wall and went into a wall. That is a service riser, and every building
    // in the city has one. Two things turn a run of pipe into plant: a MACHINE, so something is
    // being done to what is in it, and a DISTRIBUTION, so it is plainly going somewhere. The
    // main now climbs the south corner into a masher on the roof, comes back down the same
    // corner into a header over the shopfront, and drops a leg into each of the seven
    // dispensers in turn. The supply itself did not change — same main, same party wall, same
    // height it has always crossed at (see the ⚠ above `secondhelpings` in NAMED_MODELS).
    const wallTop = h * 0.66, fascia = h * 0.82, yaw = faceYaw(E);
    const deck = h * 0.04, head = h * 0.30;   // the plinth the rank stands on, and the top of a cabinet
    // The fascia's own front plane. `helpings` is in NO_TILE_FIT, so `segFit` only ever applies
    // the 0.44 half-width cap to that box — which is what everything bolted to the face is
    // measured against, and the reason it is resolved once here rather than written `fh * 1.0`
    // at four sites that would then each be wrong at the top of fh's range.
    const FR = Math.min(fh * 1.00, 0.44);
    const P3 = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, wallTop, fascia, pal, seed + 1, night, alpha, true);
    // 1) THE RANK — six, three either side of the door, because the wall of them is the joke. Each cabinet is a shallow box (`fd`), so a rank wide enough to fill
    //    the frontage does not also reach a third of a tile into the road.
    //
    // ⚠ THERE IS NO GLASS IN FRONT OF IT AND THERE MUST NOT BE. This carried a black slab at
    // `fh * 0.80` — one `draw3DBoxAt`, whose footprint is SQUARE, so a pane wide enough to span
    // the shopfront was also 0.62 of a tile deep, and it stood in the road in front of the
    // machines it existed to show. Nothing in this renderer is transparent, so a pane is an
    // opaque sheet whichever primitive draws it. The rank stands open to the pavement instead,
    // which is what a wall of dispensers on a street actually looks like.
    //
    // ⚠ AND EACH ONE HAS A FACE ON IT NOW. Seven white boxes in a row read as fluting on a white
    // wall, which is exactly how they were reading: a dark serving hatch and a lit panel over it
    // are what say machine. Flat quads, so they go into the per-model mesh and the arm pays for
    // them once — and they stand `FACE_EPS` proud of the cabinet front, because paint exactly
    // coplanar with its host loses the depth test and contributes no pixels at all.
    if (frontVis) {
      { const [kx, ky] = F(0, fh * 1.00);
        draw3DBoxAt(ctx, cam, kx, ky, fh * 0.70, 0, deck, 'ty_helpings_trim', seed + 3, night, alpha, true, yaw, fh * 0.13); }
      const FC = fh * 1.09 + FACE_EPS;   // the cabinets' own front plane (cy + fd), a hair proud
      // THE DOOR, centred under the name with three dispensers either side of it. ⚠ It stands out
      // on the cabinets' own depth, so its paint lands on the same plane as theirs and never on
      // the wall face, where it would fight the wall for the depth test.
      { const [ox, oy] = F(0, fh * 1.00), dh = fh * 0.085, dz1 = head - h * 0.01;
        draw3DBoxAt(ctx, cam, ox, oy, dh, deck, dz1, 'ty_helpings_trim', seed + 9, night, alpha, true, yaw, fh * 0.09);
        const DQ = (uh, z0, z1, y) => [W3(-uh, y, z1), W3(uh, y, z1), W3(uh, y, z0), W3(-uh, y, z0)];   // TL, TR, BR, BL: see the ⚠ on winding below
        emitFlat(ctx, cam, DQ(dh * 0.86, deck + h * 0.005, dz1 - h * 0.012, FC), '#3a4448', alpha, { cullN: E, lift: DETAIL_LIFT });
        const dusk = 1 - 0.55 * (night ? clamp(night, 0, 1) : 0), alb = [200 * dusk, 208 * dusk, 208 * dusk];
        emitFlat(ctx, cam, DQ(dh * 0.76, deck + h * 0.008, dz1 - h * 0.02, FC + 0.002), `rgb(${alb.map((v) => v | 0).join(',')})`, alpha, { cullN: E, lift: DETAIL_LIFT, lit: 'plain', albedo: alb });
        const pz = (deck + dz1) / 2;
        tubeRun(ctx, cam, W3, [dh * 0.55, FC + 0.006, pz - h * 0.025], [dh * 0.55, FC + 0.006, pz + h * 0.025], 0.003, 6, [90, 100, 106], 'chrome', alpha, dusk); }
      for (const cuF of [-0.51, -0.36, -0.21, 0.21, 0.36, 0.51]) {
        const i = Math.round((cuF + 0.51) / 0.15);
        const cu = cuF * fh, [mx, my] = F(cu, fh * 1.00);
        draw3DBoxAt(ctx, cam, mx, my, fh * 0.068, deck, head, 'ty_helpings_mach', seed + 10 + i, night, alpha, true, yaw, fh * 0.09);
        // ⚠ WOUND TL, TR, BR, BL IN (u, w), which is clockwise in the face's own plane and
        // therefore the winding Newell needs for a normal pointing at the street — there is no
        // `faceforward` in the GL shader and a reversed quad is lit from inside. See emblemSlab.
        const Q = (uh, z0, z1) => [W3(cu - uh, FC, z1), W3(cu + uh, FC, z1), W3(cu + uh, FC, z0), W3(cu - uh, FC, z0)];
        emitFlat(ctx, cam, Q(fh * 0.046, deck + h * 0.03, h * 0.17), '#15191c', alpha, { cullN: E, lift: DETAIL_LIFT });
        emitFlat(ctx, cam, Q(fh * 0.051,h * 0.205, h * 0.245), '#a4ecc0', alpha, { cullN: E, lift: DETAIL_LIFT });
        glowPool(ctx, cam, mx, my, h * 0.225, '198,255,208', 4, alpha * (night ? 0.42 : 0.16));
      }
      // 2) THE CANOPY over them — thin, white, and narrower than the frontage, so the header's
      //    end drop still has the north end of the wall to itself.
      awning(ctx, cam, dx, dy, E, fh * 0.68, fh * 1.26, head + h * 0.02, head + h * 0.05,
        'ty_helpings_trim', seed + 30, night, alpha, fh * 0.40);
    }
    // 3) THE PARTY WALL — a blind blade standing proud of the frontage and a little over the
    //    fascia, because the thing on the other side of it is not a shop. At 1.12·h, in the clone's
    //    tile, it read as a third building standing between the two. It is in the clone
    //    facility's tile, because it is the plant's wall, and it is where the clone's glass main
    //    ends. ⚠ ITS PLAN IS IN TILES (`GUT.wall`), NOT fh: the main is drawn by the clone's arm
    //    from the clone's own footprint, and the only way two rolls of fh agree about where a wall
    //    is is for neither of them to decide it. See GUT in downtown.js.
    //    ⚠ PLAIN PANEL, NOT THE FACILITY'S TILE. In `ty_clone_tile` the blade carried a tile grid
    //    big enough to read as windows, and from the street it was a narrow office tower between
    //    two low buildings. It's clad like a plant room now: flush white panels, a steel kick plate
    //    and coping, a hatch, the med-gas alarm panel and a placard. The penetration plates are
    //    where the main goes through, one per side, each drawn by the arm that knows its height.
    const Wl = GUT.wall, dusk = 1 - 0.55 * (night ? clamp(night, 0, 1) : 0);
    const wTop = fascia + h * 0.08, wMid = (Wl.front + Wl.back) / 2, wDeep = (Wl.front - Wl.back) / 2;
    const wS = Wl.lx - Wl.half, wN = Wl.lx + Wl.half, STEEL = [184, 196, 200];
    { const [px, py] = F(Wl.lx, wMid);
      draw3DBoxAt(ctx, cam, px, py, Wl.half, 0, wTop, 'ty_clone_wall', seed + 20, night, alpha, true, yaw, wDeep);
      draw3DBoxAt(ctx, cam, px, py, Wl.half + FACE_EPS, 0, h * 0.07, 'ty_hf_mirror', seed + 21, night, alpha, true, yaw, wDeep + FACE_EPS);
      draw3DBoxAt(ctx, cam, px, py, Wl.half + FACE_EPS, wTop, wTop + h * 0.02, 'ty_hf_mirror', seed + 22, night, alpha, true, yaw, wDeep + FACE_EPS); }
    // The panel joints, on the front and on the clone's side. ⚠ PAINT, NOT STROKES: `emitWire`
    // pulls a stroke toward the eye, so a joint drawn that way ran in front of the placard and,
    // from off-square, across the end of the fascia name (`signfit`). A strip on the face sits
    // where the joint is.
    { const seam = night ? 'rgb(70,84,88)' : 'rgb(118,134,138)', sw = 0.002, yF = Wl.front + FACE_EPS, xS = wS - FACE_EPS;
      const y0 = Wl.back + 0.004, y1 = Wl.front - 0.004;
      for (let z = h * 0.07 + h * 0.13; z < wTop - h * 0.04; z += h * 0.13) {
        flatOut(ctx, cam, W3, [[wS + 0.004, yF, z + sw], [wN - 0.004, yF, z + sw], [wN - 0.004, yF, z - sw], [wS + 0.004, yF, z - sw]], [0, 1, 0], seam, alpha);
        flatOut(ctx, cam, W3, [[xS, y0, z + sw], [xS, y1, z + sw], [xS, y1, z - sw], [xS, y0, z - sw]], [-1, 0, 0], seam, alpha);
      }
      for (let y = Wl.front - 0.18; y > Wl.back + 0.04; y -= 0.18) {
        flatOut(ctx, cam, W3, [[xS, y - sw, wTop - 0.004], [xS, y + sw, wTop - 0.004], [xS, y + sw, h * 0.07 + 0.004], [xS, y - sw, h * 0.07 + 0.004]], [-1, 0, 0], seam, alpha);
      } }
    // The north penetration plate, where the shop's half of the main leaves the wall: a bolted
    // steel square round the pipe. Its centre is held back from the wall's front edge so the plate
    // never hangs off the end of it.
    { const pr = 0.034, pcy = Math.min(fh * 1.02, Wl.front - pr - 0.002), zS0 = h * 0.52;
      const [qx, qy] = F(wN + 0.004, pcy);
      draw3DBoxAt(ctx, cam, qx, qy, 0.004, zS0 - pr, zS0 + pr, 'ty_hf_mirror', seed + 23, night, alpha, true, yaw, pr);
      for (const [by, bz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        tubeRun(ctx, cam, W3, [wN + 0.008, pcy + by * pr * 0.72, zS0 + bz * pr * 0.72], [wN + 0.013, pcy + by * pr * 0.72, zS0 + bz * pr * 0.72], 0.004, 6, [120, 132, 138], 'chrome', alpha, dusk);
      } }
    if (frontVis) {
      const yF = Wl.front + FACE_EPS;
      const Q = (x0, x1, z0, z1, y = yF) => [W3(x0, y, z1), W3(x1, y, z1), W3(x1, y, z0), W3(x0, y, z0)];   // TL, TR, BR, BL: see the rank's ⚠ on winding
      // The door that was here is the shop's, centred in the rank under the name.
      // The medical gas alarm panel: white, three lamps, and the green one is always on. The amber
      // comes up while product is moving in the main.
      // ⚠ ABOVE THE MAIN, NOT BESIDE IT. The clone's half comes in at the clone's own h * 0.50, just
      // round the corner from this face, and a panel at that height looks like the pipe's socket.
      const az0 = h * 0.60, az1 = h * 0.68, ax0 = wS + 0.012, ax1 = wN - 0.012;
      { const alb = [223 * dusk, 230 * dusk, 228 * dusk];   // paint, so it goes dark with the wall; only the lamp stays lit
        emitFlat(ctx, cam, Q(ax0, ax1, az0, az1), `rgb(${alb.map((v) => v | 0).join(',')})`, alpha, { cullN: E, lift: DETAIL_LIFT, lit: 'plain', albedo: alb }); }
      const lampW = (ax1 - ax0) / 7, lz0 = az0 + (az1 - az0) * 0.35, lz1 = az0 + (az1 - az0) * 0.65;
      ['#46e88a', '#5c4a1c', '#561e1a'].forEach((css, k) => {
        const x0 = ax0 + lampW * (1 + k * 2);
        emitFlat(ctx, cam, Q(x0, x0 + lampW, lz0, lz1, yF + 0.002), css, alpha, { cullN: E, lift: DETAIL_LIFT });
      });
      const lampAt = (k) => F(ax0 + lampW * (1.5 + k * 2), yF + 0.006);
      { const [gx, gy] = lampAt(0); glowPool(ctx, cam, gx, gy, (lz0 + lz1) / 2, '90,255,150', 2.5, alpha * (night ? 0.7 : 0.3), { air: true }); }
      { const gu = gutPhase(now);
        if (gu >= 0.50 && gu < 0.70) { const [gx, gy] = lampAt(1); glowPool(ctx, cam, gx, gy, (lz0 + lz1) / 2, '255,184,70', 3, alpha * (night ? 0.85 : 0.5), { air: true }); } }
      // A conduit from the panel up to the coping.
      tubeRun(ctx, cam, W3, [Wl.lx, Wl.front + 0.008, az1], [Wl.lx, Wl.front + 0.008, wTop], 0.005, 6, STEEL, 'chrome', alpha, dusk);
      // The placard, on the main's way into a food shop.
      const tex = placardTex();
      if (tex) {
        const pz0 = h * 0.33, pz1 = h * 0.42;
        const q = [[wS + 0.008, pz1], [wN - 0.008, pz1], [wN - 0.008, pz0], [wS + 0.008, pz0]].map(([u, z]) => P3(u, yF + 0.002, z));
        if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
    }
    // The main's second half: out of the wall's north face at this building's own height, and up
    // the corner to the masher, in the same glass the clone's run is made of. The riser and the
    // downcomer beside it are in tiles for the wall's reason: at fh in it the riser stood inside
    // the wall at the top of the range.
    const RISER = -0.33, DOWN = -0.27, cyR = fh * 1.02, zS = h * 0.52, zIn = fascia + h * 0.10, rR = GUT.r * 0.7;
    tubeRun(ctx, cam, W3, [Wl.lx, cyR, zS], [RISER, cyR, zS], rR, 8, [104, 196, 150], 'glass', alpha, dusk);
    tubeRun(ctx, cam, W3, [RISER, cyR, h * 0.50], [RISER, cyR, zIn], rR, 8, [104, 196, 150], 'glass', alpha, dusk);
    for (const z of [zS, zIn - h * 0.06]) tubeRun(ctx, cam, W3, [RISER, cyR, z - 0.008], [RISER, cyR, z + 0.008], rR * 1.3, 10, [184, 196, 200], 'chrome', alpha, dusk);
    // 4) THE MASHER — the machine the whole frontage is an argument for.
    //
    // What comes through the wall is not food yet, and this is the thing that says so: a mixing
    // drum on the shop's own roof with a ram coming down into its throat on a two-post gantry.
    // It is the tallest thing on the plot and the only part of the building with a silhouette
    // from the air, which is the second job it does.
    //
    // ⚠ THE RAM IS NOT MASS AND MUST NOT BECOME IT. `draw3DBoxAt` and `emitFlat` record into the
    // shape capture and the per-model mesh, both taken at a FROZEN clock, so a box whose z reads
    // `now` is captured at one pose: GLASS 1 animates it, GLASS 2 nails it to `sin(0)`, and the
    // shape you collide with is a third answer. The drum, the throat, the posts and the beam are
    // mass; the ram, its rod and the strike light are the three layers collected fresh every
    // frame. See MOVING PARTS.
    const mrx = -fh * 0.50, mry = fh * 0.52, mR = fh * 0.30;
    const [mcx, mcy] = F(mrx, mry);
    const drumTop = fascia + h * 0.18, throat = fascia + h * 0.215, beamZ = fascia + h * 0.40;
    // ⚠ PALE, AND THE FLOOR IS WHAT KEEPS IT THERE. `drawFacetDrum` lights from a FIXED (−0.7, −0.7)
    // and the facets a street camera sees are the ones turned away from it, so a shading floor set
    // for the sunlit side comes out as a dark boulder on a white roof — the same note the clone
    // facility's own dome carries one arm up. This building is the cleanest thing on the street.
    const steel = (f) => { const s = 0.64 + f.nl * 0.36; return `rgb(${(212 * s) | 0},${(221 * s) | 0},${(223 * s) | 0})`; };
    const collar = (f) => { const s = 0.52 + f.nl * 0.34; return `rgb(${(168 * s) | 0},${(178 * s) | 0},${(182 * s) | 0})`; };
    drawFacetDrum(ctx, cam, mcx, mcy, fascia, drumTop, mR, mR * 0.98, 12, alpha, steel, null);
    drawFacetDrum(ctx, cam, mcx, mcy, drumTop, throat, mR * 0.98, mR * 1.08, 12, alpha, collar, null);   // …and a flared rim on it, which is what makes the mouth read as OPEN rather than as a lid
    // ⚠ AND AN INSIDE, BECAUSE AN OPEN DRUM IS A HOLE. `drawFacetDrum` culls backfaces, so a drum
    // with no cap is a tube you can see the sky through from any camera above it — which from the
    // air is most of them. A short capped disc at the bottom gives it a floor, and the floor is
    // what is IN it: the same green the dispensers glow, because it is the same stuff.
    drawFacetDrum(ctx, cam, mcx, mcy, fascia + h * 0.04, fascia + h * 0.05, mR * 0.88, mR * 0.88, 12, alpha,
      (f) => `rgb(${(46 + f.nl * 34) | 0},${(78 + f.nl * 46) | 0},${(56 + f.nl * 36) | 0})`, 'rgb(52,92,64)');
    // …and the drive that turns it, which is what stops the drum reading as a tank somebody left
    // on a roof. A machine has a motor on the side of it and a tank does not.
    { const [vx, vy] = F(mrx + mR * 1.10, mry - mR * 0.42);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.085, fascia, fascia + h * 0.10, 'ty_helpings_mach', seed + 45, night, alpha, true, yaw, fh * 0.065); }
    for (const s of [-1, 1]) { const [gx, gy] = F(mrx + s * fh * 0.36, mry);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.035, fascia, beamZ, 'ty_helpings_trim', seed + 40 + s, night, alpha, true, yaw, fh * 0.035); }
    draw3DBoxAt(ctx, cam, mcx, mcy, fh * 0.40, beamZ, beamZ + h * 0.035, 'ty_helpings_trim', seed + 43, night, alpha, true, yaw, fh * 0.05);
    // THE STROKE. Three of them and a rest: a masher runs a batch and then stands, which is what
    // stops a roof looking like a fairground. `sp` is the phase inside one stroke — down hard
    // over the first two fifths and back up over the rest, which is a ram rather than a piston.
    // ⚠ AT −1 (parked, mid-capture, or `RENDER_TUNE.motion` at 0) `fall` IS 0 and the head sits
    // at the top of its travel, which is the pose the mass around it was captured with.
    const mp = motionPhase(now, seed + 47, 9400, 0.58), mu = mp < 0 ? 0 : mp;
    const sp = (mu * 3) % 1;
    const fall = mp < 0 ? 0 : (sp < 0.40 ? easeIO(sp / 0.40) : 1 - easeIO((sp - 0.40) / 0.60));
    const ramZ = beamZ - h * 0.09 - fall * h * 0.15;   // the head's UNDERSIDE: 1.13h at rest, 0.98h inside the mouth
    emitWire(ctx, cam, W3(mrx, mry, beamZ), W3(mrx, mry, ramZ + h * 0.085), 2.4, 'rgba(86,94,102,0.95)', alpha, { pull: 0.05 });
    movingBox(ctx, cam, mcx, mcy, ramZ, ramZ + h * 0.085, fh * 0.12, fh * 0.12, [176, 186, 192], alpha, night, yaw);
    // …and the mouth flares as the head lands, and only then. A steady pool says the machine is
    // lit; this says it is working. Modulating a LAMP and never the frame — the no-strobe rule.
    { const strike = mp < 0 ? 0 : clamp((fall - 0.72) / 0.28, 0, 1);
      glowPool(ctx, cam, mcx, mcy, throat, '150,255,186', 5 + strike * 8, alpha * ((night ? 0.14 : 0.03) + strike * (night ? 0.38 : 0.13)));
      drawSmoke(ctx, cam, mcx, mcy, throat + h * 0.01, '206,220,212', alpha * 0.34, now, seed + 44); }
    // ⚠ AND EACH RUN STOPS ON THE SHELL RATHER THAN IN IT. A stroke endpoint inside its own mass
    // is pulled out in FRONT of it by `emitWire`, which is what `glself` counts; at 0.84·mR both
    // of these were a fifth of a drum inside the drum. 1.02·mR is the outside of the shell, which
    // is also where a pipe entering a vessel actually lands.
    // …and the two runs that tie it to the frontage: raw up the south corner into the drum's
    // shoulder, product out of its front and back down into the header. Strokes, because a pipe
    // crossing a roof is a line and a mass box that size would be a wall.
    { const zOut = fascia + h * 0.035;
      emitWire(ctx, cam, W3(RISER, cyR, zIn), W3(mrx - mR * 1.02, mry, zIn), 2.8, 'rgba(170,180,186,0.95)', alpha, { pull: 0.05 });
      emitWire(ctx, cam, W3(mrx + mR * 0.25, mry + mR * 1.00, zOut), W3(DOWN, cyR, zOut), 3.4, 'rgba(182,190,194,0.95)', alpha, { pull: 0.05 }); }
    // The slug from the clone facility, on the second half of its trip (see gutPhase): out of the
    // party wall, up the riser and across the roof into the drum. ⚠ `air`: light on the glass,
    // which must not light the shop as well.
    { const gu = gutPhase(now);
      if (gu >= 0.52 && gu < 0.68) {
        const path = [[Wl.lx + Wl.half, cyR + rR, zS], [RISER, cyR + rR, zS], [RISER, cyR + rR, zIn], [mrx - mR * 1.02, mry, zIn]];
        const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1], p[2] - path[i][2]));
        const total = seg.reduce((a, b) => a + b, 0), lead = total * (gu - 0.52) / 0.16;
        const at = (d) => {
          for (let i = 0; i < seg.length; i++, d -= seg[i - 1]) if (d <= seg[i] || i === seg.length - 1) {
            const t = clamp(d / seg[i], 0, 1), a = path[i], b = path[i + 1];
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          }
        };
        slugLine(ctx, cam, W3, path, lead - 0.10, lead, night, alpha);
        for (let j = 0; j < 4; j++) {
          const d = lead - j * 0.03;
          if (d < 0 || d > total) continue;
          const p = at(d), [gx, gy] = F(p[0], p[1]);
          glowPool(ctx, cam, gx, gy, p[2], '140,255,170', 6 - j * 1.1, alpha * (night ? 0.9 : 0.6) * (1 - j * 0.22), { air: true });
        }
      } }
    // 5) A bin, and it is the fullest object on the tile. Round the north flank rather than on
    //    the frontage: the rank and its canopy occupy the whole of that, and two opaque boxes in
    //    one place is a bin growing out of a vending machine.
    { const [bx, by] = F(fh * 1.06, fh * 0.30);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.14, 0, h * 0.24, 'ty_unit_shut', seed + 24, night, alpha, false);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.16, h * 0.24, h * 0.32, 'ty_fallow_canvas', seed + 25, night, alpha, true); }
    // 6) THE NAME, PAINTED, AND THE SMALL PRINT UNDER IT.
    //
    // This carried a `marqueeBand` at `fh * 1.07`: a neon box wider than the building it was
    // bolted to, taller than the shopfront under it, and the first and last thing anybody saw of
    // the place — the frontage was a sign with a shed behind it. A council feeding station does
    // not advertise. It labels itself and posts the line that makes the label legally true, and
    // the name across the fascia in cheerful municipal green, and nothing under it.
    //
    // ⚠ `dn: 0` — PAINT, NOT NEON, which is the same call Stuff It makes and for the same
    // reason: `night ? 1 : 0` lights the lettering from inside, and this is a stencil on a wall.
    // It goes dark after six with the rest of the frontage. What is still lit down there is the
    // rank, which is the thing worth looking at.
    // ⚠ AND THE HAND IS OVERRIDDEN ON THE CALL. `SIGN_TRADE` answers `slab` here because this
    // arm shares its trade with the diner, and a slab serif is a diner's fascia. A post-war
    // municipal notice is set in condensed gothic and in nothing else.
    // ⚠ THE QUAD IS SIZED TO THE TEXTURE'S OWN ASPECT, roughly — `fitSignPts` insets whichever
    // way it has to, so a board twice as tall as its lettering needs prints the name at half the
    // size it could have been. One line of 15 characters bakes about seven to one.
    // ⚠ HALF-WIDTH 0.60, NOT 0.70: the downcomers in front of the wall stand at -0.70 and 0.84, so a
    // wider band put its end letters behind them and they flickered in and out. The lift keeps the
    // paint off the wall plane, where it lost the depth test every few frames.
    if (frontVis) {
      // Two lines, each at the size the bare name had: the name on the old band, the trade under it.
      const nhw = fh * 0.60, ny = FR + FACE_EPS;
      for (const [label, nz0, nz1] of [['SECOND HELPINGS', h * 0.685, h * 0.795], ['SOYLENT SOLUTIONS', h * 0.575, h * 0.685]]) {
        const q = [P3(-nhw, ny, nz1), P3(nhw, ny, nz1), P3(nhw, ny, nz0), P3(-nhw, ny, nz0)];
        const tex = bakeSignText(label, '#2f9a58', 0, false, true, true, { font: 'condensed' });
        if (tex && q.every((p) => p.f > 0.12)) {
          // Raised letters: dark copies stepped down and right behind the face read as the shaded
          // returns of block letters, the same treatment as the clone facility's name next door.
          const side = bakeSignText(label, '#123d22', 0, false, true, true, { font: 'condensed' });
          if (side) for (let k = 3; k >= 1; k--) {
            const ox = fh * 0.005 * k, oz = -h * 0.004 * k;
            emitSurfaceText(ctx, cam, [P3(-nhw + ox, ny, nz1 + oz), P3(nhw + ox, ny, nz1 + oz), P3(nhw + ox, ny, nz0 + oz), P3(-nhw + ox, ny, nz0 + oz)], side, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * (2.5 - 0.35 * k));
          }
          emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
        }
      }
    }
  },
};
