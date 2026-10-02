// The Yards: building-model arms for the semi-industrial freight district.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  DECO_LIFT, DECO_PULL, SHAPE_SINK, arcStrike, blinkLight, clamp, draw3DBoxAt, drawBarrelRoof,
  drawBrandBand, drawFacetDrum, drawPriceBoard, drawRing, drawSmoke, emitDecoFill, emitFlat,
  emitWire, faceY, faceYaw, frac, glowPool, groundPaint, hoistLine, latticeBoom, marqueeBand,
  motionOn, motionPhase, moveSeg, movingBox, nearOrMesh, roofHatch,
} from '../../windshield.js';
import { FLOOR_Z } from '../../../../../shared/skyline-scale.js';

export const YARDS_ARMS = {
  // ── The Yards — semi-industrial freight district (docs/proposals/yards.md) ──
  warehouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE YARDS SHED — a freight warehouse, and until now the plainest thing in
    // the district: one box, a barrel dropped on it, a glow, and three door-coloured slabs standing
    // a third of a tile out into the road. Everything a player could actually see on it — the roller
    // shutter, the name board, the louvre bank, the duct run, the lamp — came out of the derived
    // kit, so the arm was contributing a silhouette and nothing else, and the silhouette was two
    // shapes.
    //
    // ⚠ AND IT WAS WRONG AT THE EAVES. The walls were drawn at `hw` and the barrel sprang at
    // `hw * 0.92`, so at both gables the WALL stood about 0.014 of a tile proud of the roof that is
    // supposed to cover it — a bare flat ledge of steel running up past the roofline with the arched
    // tympanum set back behind it. From a cab that reads as a wall panel sticking out of the side of
    // the building for no reason, which is how it was reported. A shed roof OVERHANGS: the barrel is
    // the widest thing on it and the wall is set back inside it, so there is no ledge left to stand
    // proud and the eaves read as an eaves rather than as a step somebody forgot to finish.
    const YAW = Math.atan2(-E[0], E[1]);
    const EAVE = fh * 0.98;               // gutter line — the widest thing on the building
    const WALL = fh * 0.92;               // ribbed steel, set back inside the eaves
    const kerb = h * 0.055;               // concrete dock kerb the walls stand on
    const top = h * 0.50;                 // eaves height
    const fasc = top - h * 0.030;         // where the gutter runs and the clerestory head sits
    const archH = fh * 0.46, ridge = top + archH;
    const dock = kerb + h * 0.045;        // the loading platform a trailer bed lines up with
    // ⚠ EVERY WIDTH HERE IS UNDER draw3DBoxAt's 0.44 CLAMP AT THE LIVE FOOTPRINT, and that is why
    // the shed is a touch narrower than it was. `fh * 1.12` resolves to 0.463 and is clamped flat to
    // 0.44 — so is anything else authored above about 1.06, which means a base course, a wall and
    // an eaves overhang authored at three widths would all have come back at the SAME width and the
    // relief would have been invisible. Author under the clamp and the step is a step.
    // ⚠ AND MOVING THE WALL PLANE MEANS MOVING `D_WAREHOUSE` WITH IT. That list is hand-authored at
    // a `cy` this arm used to draw a wall at, and it is the one thing in the detail pass that does
    // not follow the mass on its own — see the ⚠ over it.
    // ⚠ AND THE STEEL WALL IS THE ONLY BOX THAT REACHES `top`. derivedTrim sorts its wall
    // candidates by z1 and hangs the shutter, the window bay and the boards on the first one, so a
    // second box ending at the same height would be a coin toss for where this building's front
    // door goes — and a shallow one winning it puts the door on a gutter.
    draw3DBoxAt(ctx, cam, dx, dy, EAVE, 0, kerb, 'ty_precast_dk', seed + 1, night, alpha, false);      // dock kerb
    draw3DBoxAt(ctx, cam, dx, dy, WALL, kerb, top, pal, seed, night, alpha, false);                    // ribbed-steel walls (the barrel is their lid)
    drawBarrelRoof(ctx, cam, F, 0, EAVE, EAVE, top, archH, 12, alpha, [104, 110, 118]);                // curved corrugated roof + arched gables
    // ⚠ THE LINE BETWEEN MASS AND TRIM HERE IS `framecost`, NOT TASTE. The 2-D painter draws every
    // arm in the window, so a part authored as mass is paid for by every warehouse on the map; the
    // near tier is only reached inside `RENDER_TUNE.detailNear`, and the GL mesh is not gated at
    // all. A first cut with the louvres, the clerestory, the downpipes and the apron all unguarded
    // put a cab frame up 19%, on a scene that is a quarter warehouses. What is mass here is what
    // carries the SILHOUETTE; everything that only reads from across the street is `NEAR`.
    const NEAR = nearOrMesh();
    // THE RIDGE MONITOR — a louvred lantern running the crown. This is the one thing that stops a
    // barrel roof reading as a smooth grey blister, and it has to run the LENGTH of the ridge to do
    // it: four separate vents were four beads on a dome from anywhere the building is seen from.
    { const [mx, my] = F(0, 0);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.135, ridge - h * 0.025, ridge + h * 0.055, 'ty_fab_steel', seed + 8, night, alpha, true, YAW, fh * 0.74);
      if (NEAR) for (const s of [-1, 1]) for (let k = 1; k < 4; k++) {   // louvre blades down each flank of the lantern
        const bz = ridge - h * 0.014 + h * 0.016 * k, [b0x, b0y] = F(s * fh * 0.138, -fh * 0.72), [b1x, b1y] = F(s * fh * 0.138, fh * 0.72);
        emitWire(ctx, cam, [b0x, b0y, bz], [b1x, b1y, bz], 1.2, 'rgba(24,28,34,0.8)', alpha, { pull: DECO_PULL });
      }
    }
    if (NEAR) {
      const [r0x, r0y] = F(0, -EAVE), [r1x, r1y] = F(0, EAVE);                                          // ridge cap, so the crown carries a line
      emitWire(ctx, cam, [r0x, r0y, ridge + h * 0.004], [r1x, r1y, ridge + h * 0.004], 1.4, 'rgba(38,44,52,0.85)', alpha, { pull: DECO_PULL });
      for (const s of [-1, 1]) { const [g0x, g0y] = F(s * EAVE, -EAVE), [g1x, g1y] = F(s * EAVE, EAVE);  // the gutter itself, both flanks
        emitWire(ctx, cam, [g0x, g0y, fasc - h * 0.004], [g1x, g1y, fasc - h * 0.004], 1.6, 'rgba(30,34,40,0.85)', alpha, { pull: DECO_PULL }); }
    }
    // THE LOADING DOCK — a raised platform at trailer-bed height, a concrete lintel across the lot
    // on two piers, and three roller shutters under it with one of them up. Concrete against ribbed
    // steel is the second wall material this building never had, and the dock is what makes it a
    // building somebody works in rather than a shed somebody drew.
    // ⚠ THE LINTEL AND THE PIERS CARRY A YAW, WHICH KEEPS THEM OUT OF THE KIT. derivedTrim skips any
    // box with a yaw, so these cannot become the wall the shutter and the boards are hung on — which
    // is what we want: the kit goes on the steel wall, never on a pier.
    { const pierH = top + h * 0.05, faceY = WALL - fh * 0.03, shutZ = dock + h * 0.235;
      for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.76, faceY);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.14, 0, pierH, 'ty_precast', seed + 4 + (s > 0 ? 1 : 0), night, alpha, true, YAW, fh * 0.085); }
      const [lx2, ly2] = F(0, faceY);
      draw3DBoxAt(ctx, cam, lx2, ly2, fh * 0.86, top - h * 0.055, pierH, 'ty_precast', seed + 6, night, alpha, true, YAW, fh * 0.085);
      const [pfx, pfy] = F(0, WALL + fh * 0.05);                                                       // the platform, out under the canopy
      draw3DBoxAt(ctx, cam, pfx, pfy, fh * 0.80, kerb, dock, 'ty_precast_dk', seed + 10, night, alpha, true, YAW, fh * 0.11);
      if (NEAR) emitFlat(ctx, cam, [W3(-fh * 0.625, WALL + fh * 0.014, shutZ), W3(fh * 0.625, WALL + fh * 0.014, shutZ),
                                   W3(fh * 0.625, WALL + fh * 0.014, dock), W3(-fh * 0.625, WALL + fh * 0.014, dock)],
        'rgba(30,32,38,0.96)', alpha, { cullN: [E[0], E[1]] });
      // The three leaves, and the middle one is up: a dark bay with the floor of the shed behind it,
      // which is the whole read of a working dock and the only thing on this face with depth in it.
      if (NEAR) for (const s of [-1, 0, 1]) {
        const lz = s ? shutZ : dock + h * 0.17, px2 = s * fh * 0.42, py2 = WALL + fh * 0.026;
        emitFlat(ctx, cam, [W3(px2 - fh * 0.155, py2, lz), W3(px2 + fh * 0.155, py2, lz),
                            W3(px2 + fh * 0.155, py2, dock + h * 0.006), W3(px2 - fh * 0.155, py2, dock + h * 0.006)],
          s ? 'rgba(52,56,62,0.97)' : 'rgba(16,18,22,0.97)', alpha, { cullN: [E[0], E[1]], stroke: 'rgba(10,12,16,0.85)', lw: 1 });
      }
    }
    if (NEAR) {
      // GABLE LOUVRES + BRACING. A tympanum this size is a blank half-disc of sheet unless the
      // extract fan is in it, which on a shed is where it goes.
      const gz0 = top + archH * 0.22, gz1 = top + archH * 0.56, gxw = fh * 0.20;
      for (const s of [-1, 1]) {
        const gy3 = s * (EAVE + fh * 0.012);
        emitFlat(ctx, cam, [W3(-gxw, gy3, gz1), W3(gxw, gy3, gz1), W3(gxw, gy3, gz0), W3(-gxw, gy3, gz0)],
          'rgba(28,32,38,0.95)', alpha, { cullN: [s * E[0], s * E[1]], stroke: 'rgba(104,112,120,0.7)', lw: 1.2 });
        const [b0x, b0y] = F(-gxw, gy3), [b1x, b1y] = F(gxw, gy3);
        for (let k = 1; k < 4; k++) { const bz = gz0 + (gz1 - gz0) * (k / 4);
          emitWire(ctx, cam, [b0x, b0y, bz], [b1x, b1y, bz], 1.3, 'rgba(126,134,142,0.75)', alpha, { pull: DECO_PULL }); }
      }
      // CLERESTORY. A shed this size is daylit from high on the long walls, and after dark that band
      // is the only thing on it that says anybody is inside.
      const cz1 = fasc - h * 0.016, cz0 = cz1 - h * 0.058;
      const pane = night ? 'rgba(236,200,132,0.95)' : 'rgba(126,146,164,0.9)';
      for (const s of [-1, 1]) for (const ly of [-0.62, -0.21, 0.21, 0.62]) {
        const px = s * (WALL + fh * 0.012);
        emitFlat(ctx, cam, [W3(px, (ly - 0.155) * fh, cz1), W3(px, (ly + 0.155) * fh, cz1),
                            W3(px, (ly + 0.155) * fh, cz0), W3(px, (ly - 0.155) * fh, cz0)],
          pane, alpha, { cullN: [s * E[1], -s * E[0]], stroke: 'rgba(12,16,20,0.8)', lw: 1 });
      }
      // Downpipes at the corners. A blank steel wall gets its vertical scale from what is bolted to it.
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const [wx, wy] = F(sx * (WALL + fh * 0.022), sy * WALL * 0.9);
        emitWire(ctx, cam, [wx, wy, kerb], [wx, wy, fasc], 2.2, 'rgba(48,54,60,0.95)', alpha, { pull: DECO_PULL });
      }
      // The hardstand a trailer reverses across, painted rather than built — a shed with nothing in
      // front of it is a shed nobody loads.
      const ay = WALL + fh * 0.17, ay2 = WALL + fh * 0.52;
      groundPaint(ctx, cam, [F(-fh * 0.62, ay), F(fh * 0.62, ay), F(fh * 0.62, ay2), F(-fh * 0.62, ay2)], 0.012, 'rgba(38,40,44,0.55)', alpha);
      for (const s of [-1, 1]) { const [e0x, e0y] = F(s * fh * 0.62, ay), [e1x, e1y] = F(s * fh * 0.62, ay2);
        emitWire(ctx, cam, [e0x, e0y, 0.016], [e1x, e1y, 0.016], 1.6, 'rgba(226,196,96,0.7)', alpha, { pull: DECO_PULL }); }
    }
    if (night) {
      for (const s of [-1, 1]) { const [lx3, ly3] = F(s * fh * 0.46, WALL + fh * 0.04); glowPool(ctx, cam, lx3, ly3, dock + h * 0.28, '255,198,128', 7, alpha * 0.38); }   // dock lamps over the shutters
      { const [dgx, dgy] = F(0, WALL + fh * 0.02); glowPool(ctx, cam, dgx, dgy, dock + h * 0.10, '255,186,110', 9, alpha * 0.30); }                                        // the open bay, lit from inside
      if (NEAR) for (const s of [-1, 1]) { const [gx3, gy3] = F(s * WALL, 0); glowPool(ctx, cam, gx3, gy3, fasc - h * 0.04, '255,206,150', 11, alpha * 0.22); }            // clerestory spill
      glowPool(ctx, cam, dx, dy, h * 0.16, '255,196,120', 13, alpha * 0.12);
    }
  },
  truck_depot(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LONG HAUL — a haulage shed: one clear-span bay tall enough to stand a
    //                       rig in, a deep-shadowed roller door wide enough to drive one through, a
    //                       lit name band over it, and a fuel island and a hardstand out front. The
    //                       read from the air is DOOR SIZE: everything else on the block has a door
    //                       for a person, and this one has a door for a truck.
    // ── ⚠ A SHED IS FOUR WALLS AND A ROOF, NOT A SOLID BOX ──────────────────
    // This was one `draw3DBoxAt` — correct while a depot was scenery you drove past, and useless
    // the moment `drive` started putting the player INSIDE it. A solid box seen from within has
    // every face pointing away from you, so the backface cull removes the entire building and you
    // are sitting on a bare grey slab with the sky where the roof should be. Nothing was missing
    // from the model; there was simply no inward-facing surface anywhere in it.
    //
    // So it is built as a real shell now: four thin wall slabs and a roof, each of which has an
    // inside face as well as an outside one. It reads the same from the road and it exists from
    // the driver's seat, and the clear span between the walls is what makes it a hangar you park
    // a rig and a trailer in rather than a garage the truck fills.
    //
    // ⚠ TALL, AND `floors` IS NOT THE UNIT. A shed is one storey by occupancy and three by
    // height — that is the whole shape of the building type — so the wall height has a FLOOR
    // under it rather than being h × a fraction. A 1-floor depot was drawing about half a storey:
    // an ankle-high kerb you could see over, which is exactly what the screenshot showed.
    const hw = fh * 1.10, wallTop = Math.max(h * 0.62, FLOOR_Z * 2.6);
    const wt = fh * 0.10;                              // wall thickness — thin, but it has two sides
    const doorHW = fh * 0.62, lintel = wallTop * 0.82;
    // The three blind walls, drawn as slabs. Back first, then the sides, so the far wall is behind
    // whatever is standing in the shed and the near ones frame it.
    {
      const [bx, by] = F(0, -hw + wt);
      draw3DBoxAt(ctx, cam, bx, by, hw, 0, wallTop, pal, seed + 11, night, alpha, false);           // back wall
      for (const s of [-1, 1]) {
        const [sx, sy] = F(s * (hw - wt), 0);
        draw3DBoxAt(ctx, cam, sx, sy, wt, 0, wallTop, pal, seed + 12 + s, night, alpha, false);     // side walls
      }
      // THE FRONT WALL IS TWO PIERS AND A LINTEL, and the gap between them is the doorway. This is
      // the aperture a truck drives through, so it is left genuinely open rather than covered by a
      // door-coloured panel: what closes it is the leaf below, and the leaf moves.
      for (const s of [-1, 1]) {
        const pierHW = (hw - doorHW) / 2;
        const [px2, py2] = F(s * (doorHW + pierHW), hw - wt);
        draw3DBoxAt(ctx, cam, px2, py2, pierHW, 0, wallTop, pal, seed + 14 + s, night, alpha, true, 0, wt);
      }
      const [lx2, ly2] = F(0, hw - wt);
      draw3DBoxAt(ctx, cam, lx2, ly2, doorHW, lintel, wallTop, pal, seed + 16, night, alpha, true, 0, wt);  // over the door
    }
    drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.94, wallTop, hw * 0.30, 12, alpha, [112, 118, 124]);       // shallow curved roof + gables
    if (frontVis) {
      // ── THE DOOR OPENS BECAUSE YOU ARE COMING ─────────────────────────────
      // A roller door standing permanently open is a hole in a wall, and a permanently shut one is
      // a building you drive through. It should be shut until somebody wants it, and the only
      // thing that has ever wanted it is a truck moving toward it — so the leaf rides the distance
      // from the vehicle to this tile. `dx`/`dy` are already the tile's offset from the camera's
      // focus, which IS the vehicle, so this needs no new state, no message and no timer: it is
      // derived from where you are, every frame, and it shuts again behind you for free.
      // ⚠ CLOSED WHILE CAPTURING. `SHAPE_SINK` bakes this model's geometry for the LOD and the
      // distance passes, and a door whose height depends on where the player happens to be is not
      // a function of (footprint, height) — it would poison a cache that must stay affine. The
      // capture always sees the door shut, which is also the honest resting state.
      const dist = Math.hypot(dx, dy);
      const open = SHAPE_SINK ? 0 : clamp((2.2 - dist) / 1.3, 0, 1);
      if (open < 0.985) {
        const [gx, gy] = F(0, fh * 1.04);
        // The leaf rolls UP into the lintel: its bottom edge lifts, so at full open there is
        // nothing left of it to draw and the doorway is the clear span the piers already framed.
        draw3DBoxAt(ctx, cam, gx, gy, doorHW, lintel * open, lintel, 'ty_door', seed + 3, night, alpha, true, 0, fh * 0.06);
      }
      const [nx, ny] = F(0, fh * 1.06);
      draw3DBoxAt(ctx, cam, nx, ny, fh * 0.74, wallTop * 0.86, wallTop * 0.99, 'ty_garage_bay', seed + 5, night, alpha, true, 0, fh * 0.05);  // name band over it
      // The fuel island on the apron: a low kerb and a pump, because a depot without diesel is a shed.
      const [px, py] = F(fh * 0.72, fh * 1.5);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.30, 0, h * 0.04, 'ty_garage', seed + 7, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.09, h * 0.04, h * 0.20, 'ty_garage_bay', seed + 8, night, alpha, false);
    }
    if (night) glowPool(ctx, cam, dx, dy, wallTop * 0.5, '255,186,110', 15, alpha * 0.20);
  },
  container_yard(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    // THE STACKING YARD, AND THE SECOND MODERN CRANE. What was here was nine cubes on a 3×3 grid
    // in four colours, and the thing wrong with it was not the count — it was that a container is
    // not a cube. At fh·0.26 square by h·0.26 tall these were 10 ft × 10 ft × 36 ft HIGH, so the
    // one object in the world whose proportions everybody already knows was drawn as a stack of
    // dice, and no amount of colour was going to make it read as freight.
    //
    // A container is 8 ft by 8.5 ft by 40 ft, which on this city's scale (a tile is about a
    // hundred feet) is fh·0.46 long, fh·0.115 wide and h·0.124 high. Get that ratio right and the
    // yard reads before anything else is added — and it is what makes the crane over it legible,
    // because an RTG is defined by being exactly one stack wider and one box taller than what it
    // is standing over.
    //
    // ⚠ THE RTG IS NOT A SMALLER SHIP-TO-SHORE. The quay crane reaches out over water it cannot
    // stand on, so it is a cantilever with a pylon and stays; this one stands on both sides of
    // what it lifts, so it is a plain portal and needs none of that. Drawing it as a little STS
    // would have been the wharf/quay mistake again — one machine twice.
    const CL = fh * 0.46, CW = fh * 0.115, CH = h * 0.124;   // a container, as half-length, half-width and height
    const YAW = faceYaw(E);
    const cols = ['ty_cont_r', 'ty_cont_b', 'ty_cont_g', 'ty_cont_y'];
    const hsh = (a) => { a = (a ^ 61) ^ (a >> 16); a += a << 3; a ^= a >> 4; a = Math.imul(a, 0x27d4eb2d); return (a ^ (a >> 15)) >>> 0; };   // deterministic (no per-frame Math.random flicker)
    // The hardstanding. A container yard is not a field — it is a slab, because a loaded box is
    // thirty tons on four corner castings and anything softer than concrete turns into ruts.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.26, 0, h * 0.02, 'ty_yard_tarmac', seed + 1, night, alpha, true);

    // ── 1. THE BLOCK ────────────────────────────────────────────────────────────────────────
    // Four rows across, two boxes deep along each, stacked one to three. Rows rather than a grid:
    // freight is stored in RANKS with a machine's wheelbase between the outer two and nothing
    // between the rest, and that rhythm is what tells a yard from a tip.
    const ROWS = [-0.60, -0.30, 0.00, 0.30];
    for (let r = 0; r < ROWS.length; r++) for (const lx of [-0.50, 0.50]) {
      const stack = 1 + hsh(seed + r * 7 + (lx > 0 ? 13 : 0)) % 3;
      const [bx, by] = F(lx * fh, ROWS[r] * fh);
      for (let k = 0; k < stack; k++) {
        draw3DBoxAt(ctx, cam, bx, by, CL, h * 0.02 + CH * k, h * 0.02 + CH * (k + 1),
          cols[hsh(seed + r * 3 + (lx > 0 ? 5 : 0) + k * 11) & 3], seed + r + k, night, alpha, true, YAW, CW);
      }
    }

    // ── 2. THE RUBBER-TYRED GANTRY ──────────────────────────────────────────────────────────
    // ⚠ ITS LEGS RUN IN THE AISLES, WHICH IS THE ONE CONSTRAINT THE WHOLE LAYOUT IS BUILT ROUND.
    // The portal has to clear the block it straddles, so the rows above stop at ±0.60 and the legs
    // stand at ±0.92 — outside the outermost container's own half-width. Get that wrong and the
    // machine is parked through its own freight, which draws perfectly well and is nonsense.
    const RGL = 0.92, RGX = 0.34, RBEAM = h * 0.60, RTOP = h * 0.68;
    for (const s2 of [-1, 1]) for (const rx of [-RGX, RGX]) {
      const [gx, gy] = F(rx * fh, s2 * RGL * fh);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.048, h * 0.02, RBEAM, 'ty_crane_body', seed + 30, night, alpha, false, YAW, fh * 0.048);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.075, h * 0.02, h * 0.075, 'ty_crane_cw', seed + 31, night, alpha, true, YAW, fh * 0.095);   // the bogie and its tyres
    }
    // The two portal beams. ⚠ RECTANGULAR, SO THEY TAKE `YAW` — see the crane on the quay.
    for (const rx of [-RGX, RGX]) {
      const [px, py] = F(rx * fh, 0);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.055, RBEAM, RTOP, 'ty_crane_body', seed + 32, night, alpha, true, YAW, fh * RGL);
    }
    // The end ties across the tops of each leg pair, which is what stops the portal being two
    // separate frames standing near each other.
    for (const s2 of [-1, 1]) {
      const [px, py] = F(0, s2 * RGL * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * RGX, RBEAM + h * 0.01, RTOP - h * 0.01, 'ty_crane_body', seed + 33, night, alpha, true, YAW, fh * 0.042);
    }
    // ── 3. THE ONLY PART THAT MOVES ─────────────────────────────────────────────────────────
    // The trolley runs ACROSS the block and the spreader hoists — the same two movements the quay
    // crane has, on the axis this machine has them. See the ⚠ over `motionOn` for why everything
    // above is boxes and this is not.
    const rp = motionPhase(now, seed + 41, 36000, 0.38), ru = rp < 0 ? 0 : rp;
    let rtr = moveSeg(ru, 0.06, 0.26, -0.44, 0.44);   // across to the far rank
    rtr = moveSeg(ru, 0.60, 0.80, rtr, -0.10);
    rtr = moveSeg(ru, 0.92, 1.00, rtr, -0.44);
    let rhk = moveSeg(ru, 0.26, 0.40, 0.90, 0.30);    // down onto the stack
    rhk = moveSeg(ru, 0.46, 0.58, rhk, 0.90);         // lift
    rhk = moveSeg(ru, 0.80, 0.90, rhk, 0.34);         // set down
    rhk = moveSeg(ru, 0.90, 0.97, rhk, 0.90);
    const rLaden = ru > 0.48 && ru < 0.86;
    const [rtx, rty] = F(0, rtr * fh);
    movingBox(ctx, cam, rtx, rty, RBEAM - h * 0.03, RBEAM, fh * RGX, fh * 0.09, [104, 110, 120], alpha, night, YAW);
    const rHookZ = h * 0.04 + (RBEAM - h * 0.14) * rhk;
    for (const ox of [-1, 1]) for (const oy of [-1, 1]) {
      const [wx, wy] = F(ox * fh * 0.26, (rtr + oy * 0.07) * fh);
      emitWire(ctx, cam, [wx, wy, RBEAM - h * 0.03], [wx, wy, rHookZ + h * 0.026], 1.1, 'rgba(38,40,44,0.92)', alpha, { pull: 0 });
    }
    movingBox(ctx, cam, rtx, rty, rHookZ + h * 0.026, rHookZ + h * 0.048, CL, fh * 0.085, [198, 158, 44], alpha, night, YAW);   // the spreader
    if (rLaden) movingBox(ctx, cam, rtx, rty, rHookZ - CH + h * 0.026, rHookZ + h * 0.026, CL, CW, [92, 116, 78], alpha, night, YAW);

    // ── 4. THE FLOODLIGHT MASTS ─────────────────────────────────────────────────────────────
    // What a container terminal looks like from a mile away after dark, and the tallest thing on
    // the plot by a long way. A yard works round the clock because a ship alongside is costing
    // somebody money by the hour, so the lighting is not decoration — it is the second shift.
    for (const [mx3, my3] of [[-1.06, 0.92], [1.06, -0.92]]) {
      const [px, py] = F(mx3 * fh, my3 * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.030, 0, h * 1.02, 'ty_crane_body', seed + 50, night, alpha, false, YAW, fh * 0.030);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.115, h * 1.02, h * 1.08, 'ty_crane_cw', seed + 51, night, alpha, true, YAW, fh * 0.055);   // the lamp rack
      if (night) {
        glowPool(ctx, cam, px, py, h * 1.04, '255,226,180', 13, alpha * 0.40);
        glowPool(ctx, cam, px, py, h * 0.03, '255,214,160', 26, alpha * 0.26);   // …and the pool it throws on the slab
      }
    }
    // The lane paint between the ranks — laid flat through the decal layer so the depth buffer
    // settles it against the slab rather than a probe guessing.
    { const z = h * 0.02 + 0.0012, w = fh * 0.012;
      for (const ly3 of [-0.75, 0.45]) {
        const y3 = ly3 * fh;
        emitDecoFill(ctx, cam, [W3(-fh * 1.10, y3 - w, z), W3(fh * 1.10, y3 - w, z), W3(fh * 1.10, y3 + w, z), W3(-fh * 1.10, y3 + w, z)],
          'rgba(226,212,148,0.50)', alpha, DECO_LIFT, 'yardlane');
      } }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.03, '255,206,150', 16, alpha * 0.16);
  },
  junkyard(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // bales of crushed car in uneven rows, a grabber crane over them, a site shack
    const hsh = (a) => { a = (a ^ 61) ^ (a >> 16); a += a << 3; a ^= a >> 4; a = Math.imul(a, 0x27d4eb2d); return (a ^ (a >> 15)) >>> 0; };   // deterministic — no per-frame flicker
    // The stacks: squat, rust-toned, deliberately not squared off like the container yard's.
    for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
      if (gx === 0 && gy === 0) continue;                                                                  // keep the middle clear for the crane
      const stack = 1 + hsh(seed + gx * 11 + gy * 17) % 3;
      const [bx, by] = F(gx * fh * 0.58, gy * fh * 0.58);
      const w = fh * (0.2 + (hsh(seed + gx + gy * 3) % 5) * 0.014);                                        // uneven bale widths
      for (let k = 0; k < stack; k++) {
        draw3DBoxAt(ctx, cam, bx, by, w, h * 0.2 * k, h * 0.2 * (k + 1),
          (hsh(seed + gx * 5 + gy + k * 7) & 1) ? 'ty_junk_bale' : 'ty_junk_bale_dk', seed + k, night, alpha, true);
      }
    }
    // ── THE GRABBER, WHICH NOW GRABS ────────────────────────────────────────────────────────
    //
    // ⚠ THE JIB STOPS BEING MASS HERE, AND THAT IS THE PRICE OF IT MOVING — see the ⚠ over
    // `motionOn`. It was a flat slab nearly two footprints wide bolted across the yard at one
    // bearing, which is a thing you could fly into that was never where it looked. What you can
    // fly into now is the MAST, which is the part that is genuinely always there.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.12, 0, h * 1.15, 'ty_junk_crane', seed + 21, night, alpha, true);   // the lattice mast
    { const jp = motionPhase(now, seed + 29, 30000, 0.54), ju = jp < 0 ? 0 : jp;
      let jsl = moveSeg(ju, 0.00, 0.16, 0, 0.90);          // swing over a pile
      jsl = moveSeg(ju, 0.50, 0.68, jsl, -1.10);           // …and round to the baler with it
      jsl = moveSeg(ju, 0.90, 1.00, jsl, 0);
      let jhk = moveSeg(ju, 0.16, 0.30, 0.88, 0.14);       // down into the scrap
      jhk = moveSeg(ju, 0.38, 0.50, jhk, 0.88);            // up with a bite
      jhk = moveSeg(ju, 0.68, 0.78, jhk, 0.30);
      jhk = moveSeg(ju, 0.84, 0.90, jhk, 0.88);
      // ⚠ THE SHELLS CLOSE AT THE BOTTOM OF THE DROP AND OPEN AT THE BOTTOM OF THE NEXT ONE, which
      // is what makes this a grab rather than a hook: the whole read is that it takes a bite and
      // lets go of it somewhere else. Open, it is two shells a gap apart; shut, they meet.
      const jShut = ju > 0.34 && ju < 0.74;
      const jw = jsl + faceYaw(E), jc = Math.cos(jsl), jsn = Math.sin(jsl);
      const jat = (r) => F(jc * r, jsn * r);
      const jTip = jat(fh * 1.15), jHeel = jat(fh * 0.12), jTail = jat(-fh * 0.42);
      movingBox(ctx, cam, dx, dy, h * 1.15, h * 1.25, fh * 0.26, fh * 0.17, [168, 140, 48], alpha, night, jw);              // the operator's house on the ring
      movingBox(ctx, cam, jTail[0], jTail[1], h * 1.12, h * 1.22, fh * 0.12, fh * 0.11, [92, 84, 52], alpha, night, jw);    // counterweight
      latticeBoom(ctx, cam, [jHeel[0], jHeel[1], h * 1.12], [jTip[0], jTip[1], h * 0.96], h * 0.09, 4, 1.8, 'rgba(178,150,58,0.95)', alpha, night);
      const grabZ = h * 0.18 + h * 0.70 * jhk;
      emitWire(ctx, cam, [jTip[0], jTip[1], h * 0.96], [jTip[0], jTip[1], grabZ + fh * 0.09], 1.3, 'rgba(38,40,44,0.92)', alpha, { pull: 0 });
      const gap = jShut ? fh * 0.03 : fh * 0.13;
      for (const s of [-1, 1]) movingBox(ctx, cam, jTip[0] + Math.cos(jw) * s * gap, jTip[1] + Math.sin(jw) * s * gap,
        grabZ, grabZ + fh * 0.09, fh * 0.055, fh * 0.07, [120, 104, 48], alpha, night, jw);
      if (jShut) movingBox(ctx, cam, jTip[0], jTip[1], grabZ - fh * 0.06, grabZ + fh * 0.02, fh * 0.08, fh * 0.07, [126, 72, 44], alpha, night, jw); }   // the bale in the jaws
    // Site shack at the gate — the only part of this you can actually walk into.
    { const [sx, sy] = F(-fh * 0.55, fh * 0.72); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.42, 0, h * 0.34, pal, seed + 23, night, alpha, true); }
    if (frontVis) { const [gx2, gy2] = F(-fh * 0.55, fh * 0.94); draw3DBoxAt(ctx, cam, gx2, gy2, fh * 0.18, 0, h * 0.22, 'ty_door', seed + 24, night, alpha, false); }
    if (night) glowPool(ctx, cam, dx, dy, 0.02, '255,180,90', 11, alpha * 0.13);                            // one sodium lamp over the gate
  },
  fuel_yard(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A FORECOURT: a lit canopy on four columns over two pump islands, a shop behind.
    // THE DEFINING FEATURE OF A GAS STATION IS THAT YOU CAN SEE THROUGH IT. This was a tank farm
    // — three solid drums filling the tile — and read from the air as an industrial block like
    // every other lot in the Yards. A forecourt is a ROOF AND NOTHING ELSE: the mass is up at
    // canopy height, the ground plane is open on all four sides, and a truck is meant to be
    // visible standing underneath it. So there are deliberately no walls here at all, and the one
    // solid volume left is the shop, pushed to the back edge where it does not close the lot.
    //
    // ── ⚠ EVERYTHING HERE IS A MULTIPLE OF ONE STOREY, AND FOR MONTHS THAT STOREY WAS FOUR ────
    // `fuel_yard` had no row in TYPE_FLOORS, so `h` arrived as a FOUR-STOREY building's height and
    // every fraction below was measured against it: a dispenser at 0.30h stood a storey and a
    // quarter tall, and the canopy cleared two. That is the "gas pumps are massive" report, and
    // the fix was one line in client/shared/skyline-scale.js rather than anything in this arm.
    // Now `h` is one storey and the numbers say what they mean — a canopy soffit at 1.52 storeys,
    // a pump at half of one, a price pylon at three. If you retune anything in here, keep reading
    // it that way: THESE ARE STOREYS, and a fraction under ~0.1 is ankle height.
    //
    // ── ⚠ THE ISLANDS ARE PAINT AND A LOW KERB, NOT A PLATFORM ────────────────
    // The first cut drew each pump island as `draw3DBoxAt(…, fh * 0.44, 0, h * 0.04)`. That is a
    // half-width of 0.44fh — 0.88 of a tile across — TWICE, so the two islands met in the middle
    // and became one raised yellow slab covering the whole forecourt with four pumps standing on
    // top of it. There was nowhere left to drive, and from the road it read as a plinth rather
    // than as a place you pull into. The lesson is not "make it smaller": it is that a marked bay
    // is PAINT, an island is a KERB, and neither of them is a box the height of a step.
    //
    // ── ⚠ AND THE LANES ARE THE SPEC, NOT THE LEFTOVERS ───────────────────────
    // A truck has to be able to drive in, so the clear widths come first and the furniture is
    // fitted between them: a wide central pull-through, an outer lane down each side, the columns
    // outside both, and the working half (shop, tank, vents, bollards) behind the canopy line.
    // `forecourtDriveSmoke` sweeps all three lanes end to end at the truck's own clearance and
    // fails the build if any of them is blocked, so move something in here and run the smoke —
    // the numbers below and the numbers in that test are one layout described twice.
    //
    //   x (fh)  0.265 ── 0.455   pump island kerb
    //           0.425 ── 0.525   the hose boom reaching out over the lane
    //           0.770 ── 0.910   column collar
    //   ⇒ centre lane  |x| < 0.265      outer lanes  0.525 < |x| < 0.770
    //
    // ⚠ THE COLUMNS ARE THINNER THAN THEY WERE, and the reason is the outer lane rather than the
    // columns. A collar at ±0.10fh with a 0.135 ring of yellow round its foot is a metre and a
    // half of obstruction on each side of a lane that has to take a tractor unit and a trailer
    // through a turn, and the smoke only proves a lane is CLEAR — it cannot say whether it is
    // comfortable. Taking the collar in to 0.07 and the capital to 0.075 widens each outer lane
    // by 6% of a tile at the pinch point without moving anything else, and a steel column that
    // reads as slim reads more like a canopy support and less like a pier.
    const steel = (r, g, b) => (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${r * sh | 0},${g * sh | 0},${b * sh | 0})`; };
    const canopyZ = h * 1.52, deckT = h * 0.32;          // underside clearance, and the fascia+deck sandwich above it
    const canY = fh * 0.06;                              // the canopy is pushed toward the road, off the back strip
    const yaw = Math.atan2(-E[0], E[1]);                 // the entrance yaw every rectangular box here turns to
    // A rectangular box in the model's own frame — `hw` across the frontage, `hd` into the lot.
    // draw3DBoxAt's footprint is square unless it is handed both, and almost everything on a
    // forecourt is longer one way than the other.
    const boxL = (lx, ly, hw, hd, z0, z1, p, sd, roof = true) => {
      const [wx, wy] = F(lx, ly);
      draw3DBoxAt(ctx, cam, wx, wy, hw, z0, z1, p, sd, night, alpha, roof, yaw, hd);
    };
    // A rectangle of paint in the model frame, given as a centre and two half-extents.
    const paintL = (lx, ly, hw, hd, fill, a = alpha) => groundPaint(ctx, cam,
      [F(lx - hw, ly - hd), F(lx + hw, ly - hd), F(lx + hw, ly + hd), F(lx - hw, ly + hd)], 0.0016, fill, a);
    const nite = night > 0.4;
    const BRAND_RED = '#b8352a';                         // the house colour, and the same red ty_fuel_red paints

    // 1) THE APRON. A concrete pad under the whole lot, a shade lighter than the road it meets, so
    // the forecourt has an edge without a kerb round it. This is the thing that says "the surface
    // changes here", which is most of what tells a driver where the station is. Two washes and a
    // set of saw-cut joints, because a single flat fill reads as a hole rather than as ground.
    paintL(0, 0, fh * 0.94, fh * 0.96, nite ? 'rgba(94,96,100,0.86)' : 'rgba(152,154,153,0.82)');
    paintL(0, 0, fh * 0.88, fh * 0.90, nite ? 'rgba(82,84,88,0.72)' : 'rgba(140,142,141,0.72)');
    for (let i = -2; i <= 2; i++) paintL(i * fh * 0.44, 0, fh * 0.006, fh * 0.90, 'rgba(0,0,0,0.16)', alpha * 0.7);
    // Twenty years of drips under the nozzles, which is the one thing that stops a forecourt
    // reading as a car park with a roof. Deterministic off the tile seed — no per-frame flicker.
    for (let i = 0; i < 7; i++) {
      const ox = (frac(seed + i * 3.7) - 0.5) * 1.0, oy = (frac(seed + i * 7.3) - 0.5) * 0.9;
      paintL(ox * fh, oy * fh, fh * (0.03 + frac(seed + i) * 0.05), fh * (0.02 + frac(seed + i * 2) * 0.04), 'rgba(28,26,24,0.30)', alpha * 0.55);
    }

    // 2) THE MARKINGS. A bay each side of each island, boxed in yellow with the lanes left bare —
    // the yellow is where you STOP, and every square metre of it is somewhere a vehicle is meant
    // to stand rather than somewhere it is kept out of.
    const YEL = nite ? 'rgba(198,166,60,0.85)' : 'rgba(228,192,64,0.9)';
    const YEL_D = nite ? 'rgba(150,124,44,0.78)' : 'rgba(196,162,50,0.82)';
    const WHT = nite ? 'rgba(196,200,204,0.7)' : 'rgba(238,240,238,0.78)';
    for (const s of [-1, 1]) {
      {
        const bx = s * fh * 0.62, by = canY;                        // one bay in each outer lane, beside its pump
        paintL(bx, by, fh * 0.10, fh * 0.30, YEL_D, alpha * 0.34);  // the bay itself, a wash
        // …boxed. Four strips rather than a stroked path, because a stroke on the ground plane
        // keeps a constant SCREEN width and a marking has to foreshorten with the tarmac it is
        // painted on.
        paintL(bx, by - fh * 0.30, fh * 0.10, fh * 0.014, YEL);
        paintL(bx, by + fh * 0.30, fh * 0.10, fh * 0.014, YEL);
        paintL(bx - fh * 0.10, by, fh * 0.014, fh * 0.30, YEL);
        paintL(bx + fh * 0.10, by, fh * 0.014, fh * 0.30, YEL);
      }
      // Hazard hatching off the outboard edge — the strip between the lane and the column line,
      // which is the one part of a forecourt nothing is allowed to stand on.
      for (let i = 0; i < 5; i++) paintL(s * fh * 0.895, (-0.52 + i * 0.27) * fh, fh * 0.04, fh * 0.05, YEL_D, alpha * 0.7);
    }
    // The centre pull-through, and the chevrons that say which way through it. They point INTO the
    // lot (away from the road), because the whole reason to paint a direction on a forecourt is
    // that everybody wants to leave by the way they came in and there is not room for it.
    for (let i = 0; i < 4; i++) {
      const cy2 = (0.42 - i * 0.30) * fh;
      paintL(-fh * 0.055, cy2, fh * 0.055, fh * 0.016, WHT, alpha * 0.55);
      paintL(fh * 0.055, cy2, fh * 0.055, fh * 0.016, WHT, alpha * 0.55);
    }
    // A drain channel across the mouth — every forecourt has one, and it is the detail that makes
    // the apron read as a slab that was poured rather than a rectangle that was filled.
    paintL(0, fh * 0.80, fh * 0.86, fh * 0.022, 'rgba(24,26,28,0.55)', alpha * 0.8);

    // 3) THE ISLANDS. A real kerb, and a low one — 5% of a storey, which is under the step-over
    // height a rig is allowed (see TRUCK_STEP_Z), so a wheel that clips one rides over it instead
    // of stopping dead on a shin-high edge nobody can see from the cab. Narrow across, long into
    // the lot: that is what makes the lanes either side of it lanes. The kerb palette is ALREADY
    // the painted yellow, so nothing paints a stripe under it — see the note on groundPaint about
    // why paint under an object is not paint on top of it.
    // ⚠ TWO DISPENSERS, ONE PER ISLAND, AND THE ISLANDS ARE SHORT. Four pumps on two long islands
    // filled the lot: correct for a city forecourt and wrong for a freight one, where the space
    // between the furniture is the product. Shortening the islands to a single dispenser each
    // opens the whole back half of the pad to manoeuvring, which is what a rig actually needs.
    for (const s of [-1, 1]) boxL(s * fh * 0.36, canY, fh * 0.095, fh * 0.30, 0, h * 0.05, 'ty_kerb', seed + 30 + s * 3);

    // 4) THE DISPENSERS. Two per island, standing on it — a plinth, the case, a lit topper, a hose
    // boom out over the bay and the hose hanging off it. The case carries the whole of the detail
    // as a texture (see PUMP_WALL): display, keypad, grade select, two nozzle boots.
    //
    // ⚠ THE PLINTH RISES FROM z=0, NOT FROM THE KERB TOP. It looks like it ought to sit on the
    // kerb, and modelling it that way puts its underside above the truck's clearance probe — at
    // which point the whole island becomes something you drive THROUGH, since the kerb under it is
    // deliberately step-over. A pump has to be solid; the kerb is wider, so nothing shows.
    for (const s of [-1, 1]) {
      const px2 = s * fh * 0.36, py2 = canY;
      boxL(px2, py2, fh * 0.085, fh * 0.115, 0, h * 0.10, 'ty_pump_dk', seed + 40 + s * 5);              // plinth
      boxL(px2, py2, fh * 0.072, fh * 0.098, h * 0.10, h * 0.52, 'ty_pump', seed + 44 + s * 5);          // the case
      boxL(px2, py2, fh * 0.086, fh * 0.112, h * 0.52, h * 0.62, 'ty_fuel_red', seed + 48 + s * 5);      // the lit topper it wears
      // The boom reaching out over the bay, and the hose slung off the end of it — the one part of
      // a pump that tells you which way the vehicle is meant to be facing.
      boxL(px2 + s * fh * 0.115, py2, fh * 0.05, fh * 0.016, h * 0.42, h * 0.47, 'ty_pump_dk', seed + 52 + s * 5, false);
      boxL(px2 + s * fh * 0.155, py2, fh * 0.014, fh * 0.014, h * 0.18, h * 0.44, 'ty_pump_dk', seed + 56 + s * 5, false);
      if (night) glowPool(ctx, cam, ...F(px2, py2), h * 0.58, '255,196,120', 4, alpha * 0.40);
    }
    // A bin at each island tail, because somebody empties the footwells here.
    for (const s of [-1, 1]) boxL(s * fh * 0.36, canY - fh * 0.24, fh * 0.05, fh * 0.05, 0, h * 0.26, 'ty_pump_dk', seed + 58 + s);

    // 5) THE COLUMNS, and they are columns now rather than blocks of flats — `ty_fab_steel` joined
    // STRUCT_WALL, which is the family that does not paint windows on things that are not walls.
    // A red crash collar at the foot and a white capital under the deck give each one a top and a
    // bottom, and the collar is the thing a reversing trailer actually meets.
    for (const [sx, sy] of [[-0.84, -0.52], [0.84, -0.52], [-0.84, 0.64], [0.84, 0.64]]) {
      const [cx2, cy2] = F(sx * fh, sy * fh);
      draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.070, 0, h * 0.20, 'ty_fuel_red', seed + 60 + sx * 3 + sy, night, alpha, true);
      draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.044, h * 0.20, canopyZ, 'ty_fab_steel', seed + 11 + sx * 3 + sy, night, alpha, false);
      draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.075, canopyZ - h * 0.10, canopyZ, 'ty_fuel_white', seed + 64 + sx * 3 + sy, night, alpha, true);
      paintL(sx * fh, sy * fh, fh * 0.105, fh * 0.105, YEL, alpha * 0.5);   // …and the ring of yellow round its foot
    }

    // 6) THE CANOPY. A soffit, a deep coloured fascia rail standing proud of it on all four sides,
    // and the white deck above — a forecourt roof is three planes, and drawing it as one slab is
    // what made the old one read as a plank on sticks. RECTANGULAR and pushed toward the road, so
    // it covers the pumps and stops short of the shop behind them rather than roofing the lot.
    boxL(0, canY, fh * 0.86, fh * 0.71, canopyZ + deckT * 0.58, canopyZ + deckT, 'ty_fuel_white', seed);          // the deck
    boxL(0, canY, fh * 0.90, fh * 0.74, canopyZ + deckT * 0.04, canopyZ + deckT * 0.70, 'ty_fuel_red', seed + 70, false);   // the house-red fascia
    boxL(0, canY, fh * 0.80, fh * 0.66, canopyZ, canopyZ + deckT * 0.18, 'ty_soffit', seed + 71, false);          // the soffit, stepped in
    // The lights in it. Twelve recessed panels — the reason a forecourt at night is the brightest
    // thing on a dark road is that its entire ceiling is a light fitting, and one lamp in the
    // middle would read as a porch.
    for (let i = -2; i <= 1; i++) for (let t = -1; t <= 1; t++) {
      const [lx2, ly2] = F((i + 0.5) * fh * 0.40, canY + t * fh * 0.30);
      draw3DBoxAt(ctx, cam, lx2, ly2, fh * 0.085, canopyZ - h * 0.014, canopyZ + h * 0.008, 'ty_soffit', seed + 80 + i * 3 + t, night, alpha, false);
      if (night) glowPool(ctx, cam, lx2, ly2, canopyZ - h * 0.02, '255,238,206', 7, alpha * 0.30);
    }
    // The brand band across the front of the canopy — the one bit of signage a forecourt has, and
    // at night it is the whole silhouette from a mile out. White enamel, house-red lettering and
    // the bolt mark; see drawBrandBand for why this is not the shared `marqueeBand` (that helper
    // derives its height from its width, so halving one halves the other, and it paints neon on a
    // colour-lit face where this wants paint on white).
    if (frontVis) drawBrandBand(ctx, cam, ...F(0, canY + fh * 0.79), E, fh * 0.44,
      canopyZ + deckT * 0.36, deckT * 1.30, name || 'FUEL', BRAND_RED, night, alpha);

    // 7) BEHIND THE CANOPY. The shop, the bulk tank, its vent stacks and the bollards that keep a
    // reversing trailer out of all three — the working half of a station, kept on the back strip
    // where it does not close the lot off.
    { const [tx, ty] = F(-fh * 0.56, -fh * 0.84);
      drawFacetDrum(ctx, cam, tx, ty, 0, h * 1.10, fh * 0.17, fh * 0.17, 12, alpha, steel(150, 148, 140), 'rgb(120,120,112)');
      drawRing(ctx, cam, tx, ty, h * 0.62, fh * 0.17 + 0.003, 12, 'rgba(0,0,0,0.25)', 1, alpha);          // the strap band round it
      drawRing(ctx, cam, tx, ty, h * 1.10 + 0.001, fh * 0.11, 10, 'rgba(30,32,36,0.6)', 1.4, alpha);      // the manway on top
      for (const s of [-1, 1]) {                                                                          // vent stacks off its shoulder
        const [vx, vy] = F(-fh * 0.56 + s * fh * 0.24, -fh * 0.72);
        draw3DBoxAt(ctx, cam, vx, vy, fh * 0.022, 0, h * 1.70, 'ty_fab_steel', seed + 90 + s, night, alpha, false);
        draw3DBoxAt(ctx, cam, vx, vy, fh * 0.040, h * 1.70, h * 1.78, 'ty_pump_dk', seed + 92 + s, night, alpha, true);
      } }
    // The shop. Somebody works here, and a forecourt with nobody in it is a fuel dump. A white box
    // under a red parapet with its whole front in glass, which is the second-brightest thing on
    // the lot after dark — see SHOP_GLASS for why that is a texture and not fifteen more boxes.
    boxL(fh * 0.44, -fh * 0.84, fh * 0.42, fh * 0.14, 0, h * 1.05, 'ty_fuel_kiosk', seed + 96);
    boxL(fh * 0.44, -fh * 0.84, fh * 0.45, fh * 0.17, h * 1.05, h * 1.22, 'ty_fuel_red', seed + 97);          // its parapet
    boxL(fh * 0.44, -fh * 0.695, fh * 0.36, fh * 0.012, h * 0.16, h * 0.86, 'ty_fuel_glass', seed + 98, false);   // the glazed front, facing the pumps
    boxL(fh * 0.10, -fh * 0.695, fh * 0.07, fh * 0.016, 0, h * 0.72, 'ty_pump_dk', seed + 99, false);         // the door in it
    if (night) glowPool(ctx, cam, ...F(fh * 0.44, -fh * 0.66), h * 0.50, '255,226,170', 9, alpha * 0.42);
    // The air-and-water bay out on the far side, where nobody is queuing for fuel.
    boxL(-fh * 0.90, canY + fh * 0.04, fh * 0.055, fh * 0.085, 0, h * 0.52, 'ty_fuel_red', seed + 101);
    boxL(-fh * 0.90, canY + fh * 0.04, fh * 0.062, fh * 0.092, h * 0.52, h * 0.58, 'ty_fuel_white', seed + 102);

    // 8) BOLLARDS in front of the shop and the tank, and off the island ends — the things that
    // stop a reversing rig putting a trailer through a window, and the detail that reads as a
    // working forecourt rather than a diagram of one. Deliberately NOT across the middle: the
    // centre of the back strip is where the lanes run out, and a post there is a wall.
    for (const bx2 of [-0.88, -0.62, -0.36, 0.14, 0.40, 0.66, 0.88]) {
      const [px3, py3] = F(bx2 * fh, -fh * 0.68);
      draw3DBoxAt(ctx, cam, px3, py3, fh * 0.028, 0, h * 0.30, 'ty_kerb', seed + 104 + bx2 * 7, night, alpha, true);
    }
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const [bx3, by3] = F(s * fh * 0.36, canY + t * fh * 0.38);
      draw3DBoxAt(ctx, cam, bx3, by3, fh * 0.026, 0, h * 0.26, 'ty_kerb', seed + 110 + s * 3 + t, night, alpha, true);
    }

    // 9) THE PRICE PYLON, out by the kerb on the entrance side — the thing you read from the road,
    // and until now the thing that was blank. The cabinet is mass; the numbers on its face are
    // live tile data gathered from whoever is actually charging (see drawPriceBoard, and the rule
    // in plugins/fuelstation). It stands taller than the canopy on purpose: a pylon that only
    // cleared the roof it belongs to would be unreadable from the one place it is for.
    if (frontVis) {
      const [sx2, sy2] = F(fh * 0.80, fh * 0.92);
      draw3DBoxAt(ctx, cam, sx2, sy2, fh * 0.05, 0, h * 2.10, 'ty_fab_steel', seed + 51, night, alpha, false, yaw, fh * 0.05);        // post
      draw3DBoxAt(ctx, cam, sx2, sy2, fh * 0.24, h * 2.10, h * 3.05, 'ty_pump_dk', seed + 53, night, alpha, true, yaw, fh * 0.055);   // the cabinet
      const [bx4, by4] = F(fh * 0.80, fh * 0.92 + fh * 0.058);
      drawPriceBoard(ctx, cam, bx4, by4, E, fh * 0.22, h * 2.16, h * 3.00, (name || '').trim().toUpperCase() || 'FUEL', board, night, alpha);
      if (night) glowPool(ctx, cam, sx2, sy2, h * 2.58, '255,180,90', 6, alpha * 0.5);
    }
    // A forecourt at night is the brightest thing on a dark road, and the light comes from UNDER
    // the canopy — a pool on the deck, not a glow on the roof.
    if (night) glowPool(ctx, cam, ...F(0, canY), 0.02, '255,215,150', 15, alpha * 0.34);
  },
  cold_storage(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // windowless insulated block, rooftop condenser units, a cold blue breath
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, h * 0.7, pal, seed, night, alpha, true);                 // insulated metal block
    for (const s of [-0.5, 0, 0.5]) { const [cx, cy] = F(s * fh * 0.6, -fh * 0.2); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.2, h * 0.7, h * 0.85, 'ty_cold_unit', seed + 3 + s * 3, night, alpha, true); }   // rooftop condensers
    if (frontVis) { const [gx, gy] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.4, 0, h * 0.38, 'ty_door', seed + 1, night, alpha, true, 0, fh * 0.06); }   // loading-dock door
    glowPool(ctx, cam, dx, dy, h * 0.34, '150,200,230', 12, alpha * (night ? 0.3 : 0.16));               // cold breath
  },
  fabrication(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // open fab shed straddled by a gantry crane, a smoking flue + welding spark glow
    // The bay stays open and the gantry stays the point. A fab shed is a steel frame on a concrete
    // pad with a clerestory over the bay — the pad and the clerestory are what say "this is a
    // building somebody works in" rather than "this is a box with legs beside it".
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, h * 0.06, pal, seed + 6, night, alpha, false);        // concrete pad
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, h * 0.06, h * 0.46, pal, seed, night, alpha, false);     // shed
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.46, h * 0.55, 'ty_fab_steel', seed + 7, night, alpha, true);   // clerestory band over the bay
    for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 0.8, 0); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.06, 0, h * 0.85, 'ty_fab_steel', seed + s + 2, night, alpha, false); }   // gantry legs
    { const [l0x, l0y] = F(-fh * 0.8, 0), [l1x, l1y] = F(fh * 0.8, 0);
      emitWire(ctx, cam, [l0x, l0y, h * 0.85], [l1x, l1y, h * 0.85], 3, 'rgba(90,96,104,0.95)', alpha, { pull: DECO_PULL }); }   // crane spanning beam
    // The hoist that runs that beam. A fab shed's gantry exists to pick a fabrication up off the
    // pad and put it on a truck, and this one had a beam with nothing hanging from it.
    { const fp = motionPhase(now, seed + 23, 22000, 0.52), fu = fp < 0 ? 0 : fp;
      let ftx = moveSeg(fu, 0.00, 0.22, 0, -0.62);
      ftx = moveSeg(fu, 0.54, 0.78, ftx, 0.58);
      ftx = moveSeg(fu, 0.92, 1.00, ftx, 0);
      let fhk = moveSeg(fu, 0.22, 0.36, 0.94, 0.18);
      fhk = moveSeg(fu, 0.42, 0.54, fhk, 0.94);
      fhk = moveSeg(fu, 0.78, 0.88, fhk, 0.26);
      fhk = moveSeg(fu, 0.90, 0.92, fhk, 0.94);
      const [ftx2, fty2] = F(ftx * fh * 0.8, 0), fz = h * 0.85;
      movingBox(ctx, cam, ftx2, fty2, fz - h * 0.07, fz, fh * 0.09, fh * 0.07, [92, 98, 108], alpha, night, faceYaw(E));
      hoistLine(ctx, cam, ftx2, fty2, fz - h * 0.07, h * 0.58 + (fz - h * 0.74) * fhk, fh, alpha, night,
        fu > 0.39 && fu < 0.86 ? { h: h * 0.08, hx: fh * 0.12, hy: fh * 0.09, rgb: [104, 96, 86] } : null, faceYaw(E)); }
    { const [fx, fy] = F(fh * 0.55, -fh * 0.3); drawSmoke(ctx, cam, fx, fy, h * 0.55, '90,86,80', alpha * 0.7, now, seed + 5); }   // flue smoke
    // The welder. This was a steady orange pool called "welding spark glow", which is the one
    // thing a welding arc is not — the whole read is the stutter, and a night frame of the Yards
    // with one shed stammering blue-white in an open bay is most of what this district is for.
    { const [wx, wy] = F(-fh * 0.25, fh * 0.55), strike = motionOn() && arcStrike(now, seed);
      if (night) glowPool(ctx, cam, dx, dy, h * 0.2, '255,150,70', 10, alpha * 0.24);                       // the hearth behind it, steady, and night-only exactly as it was
      if (strike) {
        glowPool(ctx, cam, wx, wy, h * 0.18, '190,235,255', 13, alpha * (night ? 0.5 : 0.22));              // the arc itself — blue-white, not orange
        blinkLight(ctx, cam, wx, wy, h * 0.18, '235,248,255', now, seed + 9, alpha, 2.2);
      } }
  },
  garage(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Halloran's Fix-It: a low grease-and-steel repair shop — three roll-up bays under a lit name
    //                  band, an engine-hoist jib over the forecourt, a rooftop extractor, warm worklight from the bays
    const wall = h * 0.5;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, wall, pal, seed, night, alpha, true);                     // workshop block
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, wall * 1.02, m.neon || '#ffb14a', night, alpha);   // lit name band over the bays
    if (frontVis) for (const s of [-0.62, 0, 0.62]) { const [bx, by] = F(s * fh, fh * 1.03); draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, 0, wall * 0.72, 'ty_garage_bay', seed + 4 + s * 5, night, alpha, true, 0, fh * 0.05); }   // roll-up bay doors
    { const [mx, my] = F(fh * 0.55, fh * 0.35); draw3DBoxAt(ctx, cam, mx, my, fh * 0.05, 0, wall * 1.5, 'ty_fab_steel', seed + 2, night, alpha, false);   // engine-hoist post
      const [jx, jy] = F(fh * 0.55, fh * 1.1);
      emitWire(ctx, cam, [mx, my, wall * 1.5], [jx, jy, wall * 1.22], 2.2, 'rgba(80,84,92,0.95)', alpha, { pull: DECO_PULL });     // hoist jib over the forecourt
      // The chain block on it. A jib over a forecourt is there to pull an engine out of something,
      // and this one had nothing hanging from it — so it read as a bracket rather than as a hoist.
      //
      // ⚠ AND THEN BOTH ENDS OF THE STROKE WERE NOWHERE. The engine was hooked on in mid-air and
      // deleted again in mid-air over the roof, which reads as a bug however well the machine
      // itself moves — the one complaint this arm has ever drawn. Both ends are a PLACE now: it
      // comes off a pad on the forecourt and it goes into the shop through a hatch in the roof.
      //
      // ⚠ THE TROLLEY HAD TO REACH THE JIB TIP FOR THAT TO BE POSSIBLE. It ran to 0.86 of the
      // jib, which is `v = 0.35 + 0.86 * 0.75` = 0.995 of the footprint — INSIDE a front wall at
      // 1.06 — so the "forecourt" end of the stroke was over the roof as well, and the pick-up
      // was as impossible as the drop. It runs to the tip, where the jib was always drawn.
      const gp = motionPhase(now, seed + 13, 16000, 0.5), gu = gp < 0 ? 0 : gp;
      let gt = moveSeg(gu, 0.00, 0.13, 0.25, 1.00);     // out to the tip, over the pavement
      gt = moveSeg(gu, 0.46, 0.60, gt, 0.25);           // …and home over the hatch
      let gk = moveSeg(gu, 0.13, 0.26, 0.94, 0.02);     // hook down to the pad
      gk = moveSeg(gu, 0.32, 0.46, gk, 0.94);           // hoist the engine clear of the roof
      gk = moveSeg(gu, 0.62, 0.80, gk, 0.76);           // ease it down INTO the hatch — the shot, so it gets a fifth of the stroke to itself
      gk = moveSeg(gu, 0.80, 0.88, gk, 0.16);           // …and run on down into the shop
      gk = moveSeg(gu, 0.90, 0.96, gk, 0.94);           // empty hook back up, clear of the roof before the leaves move
      let ho = moveSeg(gu, 0.52, 0.62, 0, 1);           // the leaves are open before the load arrives…
      ho = moveSeg(gu, 0.96, 1.00, ho, 0);              // …and shut behind the hook, not on the rope
      const jibV = 0.35 + gt * 0.75, HATCH_V = 0.35 + 0.25 * 0.75;   // where the trolley is, and where it comes home to
      roofHatch(ctx, cam, W3, E, fh * 0.55, fh * HATCH_V, fh * 0.13, fh * 0.14, wall, ho, alpha, night);
      if (night && ho > 0.05) glowPool(ctx, cam, ...F(fh * 0.55, fh * HATCH_V), wall + 0.01, '255,176,96', 6, alpha * 0.34 * ho);   // the shop floor, seen up through the opening
      // ⚠ THE CLIP IS A PLANE AND THE HATCH IS A HOLE, so it may only be handed to the hoist
      // while the trolley is over the BUILDING. Out at the tip the hook is over the pavement,
      // where a floor at roof height would bury an engine standing on it.
      const zClip = jibV < 1.02 ? wall : -Infinity;
      const [bx, by] = F(fh * 0.55, fh * jibV), bz = wall * (1.5 - gt * 0.28);
      movingBox(ctx, cam, bx, by, bz - wall * 0.07, bz, fh * 0.045, fh * 0.04, [96, 100, 108], alpha, night, faceYaw(E));
      // ⚠ AND THE ENGINE HAD TO GET LIGHTER TO GO IN. It was [74,70,66], which is a perfectly good
      // oily lump against a roof and is INVISIBLE against the hole it now descends into — the one
      // moment the whole pass exists to show. Bare alloy with oil on it: light enough to read
      // against black, warm enough not to be mistaken for one of the leaves.
      const ENG = { h: wall * 0.15, hx: fh * 0.10, hy: fh * 0.09, rgb: [132, 118, 94] }, slung = gu > 0.30 && gu < 0.86;
      hoistLine(ctx, cam, bx, by, bz - wall * 0.07, wall * 0.12 + (bz - wall * 0.30) * gk, fh, alpha, night,
        slung ? ENG : null, faceYaw(E), zClip);   // …and the engine on the end of it
      // ⚠ THE HAND-OFF IS SILENT BECAUSE THE TWO BOXES COINCIDE. The engine waiting on the pad is
      // the same box in the same place as the one on the hook at the bottom of its stroke, so the
      // swap happens at the instant nothing is moving — which is why `padTop` is SOLVED from the
      // hook's low stop rather than chosen. Pick a round number for it instead and the pick-up is
      // a pop at ankle height, which is the bug this whole pass is about, moved six feet down.
      if (!slung && (gu >= 0.93 || gu <= 0.30)) {
        const padTop = wall * 0.12 + (wall * 1.22 - wall * 0.30) * 0.02, [px, py] = F(fh * 0.55, fh * 1.10);
        movingBox(ctx, cam, px, py, padTop - ENG.h, padTop, ENG.hx, ENG.hy, ENG.rgb, alpha, night, faceYaw(E)); } }   // the next one, waiting its turn
    { const [vx, vy] = F(-fh * 0.4, -fh * 0.3); draw3DBoxAt(ctx, cam, vx, vy, fh * 0.14, wall, wall + h * 0.14, 'ty_fab_steel', seed + 6, night, alpha, true);
      drawSmoke(ctx, cam, vx, vy, wall + h * 0.14, '110,104,96', alpha * 0.5, now, seed + 7); }           // rooftop extractor vent
    if (night) { glowPool(ctx, cam, dx, dy, wall * 0.3, '255,170,90', 11, alpha * 0.26);                  // warm worklight
      for (const s of [-0.62, 0, 0.62]) { const [bx, by] = F(s * fh, fh * 1.03); glowPool(ctx, cam, bx, by, wall * 0.18, '255,180,100', 5, alpha * 0.3); } }   // bay-door light spill
  },
  wharf(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // low open-sided transfer shed with a cantilevered loading crane reaching over the water
    // The shed stays low and open-sided; the crane is still the tallest thing on the plot. What a
    // working wharf has that this did not is the DOCK EDGE it stands on and an eaves course — the
    // shed was a slab landing straight on the water line.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, h * 0.05, pal, seed + 5, night, alpha, false);        // dock edge
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.05, h * 0.4, pal, seed, night, alpha, false);      // transfer shed
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, h * 0.4, h * 0.46, pal, seed + 6, night, alpha, true);   // eaves course
    // ── THE CRANE, WHICH WORKS ───────────────────────────────────────────────────────────────
    //
    // Four buildings in the Yards are named after this thing doing something — Crane Damage, The
    // Boom Economy, Load of Old Rope, The Wet Handoff — and what they shared was a pole with one
    // straight line leaning off it, at the same bearing for ever.
    //
    // ⚠ THE SPLIT IS THE PEDESTAL AGAINST EVERYTHING ABOVE THE SLEW RING, and it is forced rather
    // than chosen. The pedestal is the only part that never turns, so it is the only part that can
    // be MASS — see the ⚠ over `motionOn`: the shape capture and the per-model mesh are both taken
    // at a frozen clock, so a machinery house that slews would be nailed to one bearing in GLASS 2,
    // animated in GLASS 1, and collided with at a third bearing again, with nothing to say so.
    // Above the ring it is strokes and decals, which are collected fresh every frame. What you can
    // fly into is therefore the tower, which is the part that is actually always there.
    const [mx, my] = F(-fh * 0.4, -fh * 0.2), towerTop = h * 1.2;
    draw3DBoxAt(ctx, cam, mx, my, fh * 0.15, 0, h * 0.14, 'ty_wharf_steel', seed + 8, night, alpha, false);   // pedestal on the quay
    draw3DBoxAt(ctx, cam, mx, my, fh * 0.08, 0, towerTop, 'ty_wharf_lattice', seed + 2, night, alpha, false);   // the tower — a lattice, not a plated shaft; see the key
    // ⚠ EVERYTHING BOLTED TO THE TOWER IS SIZED OFF `fh`, AND ONLY THE TOWER ITSELF OFF `h`. This
    // arm was tuned against `TYPE_FLOORS.default` — four storeys — and the map then authored Crane
    // Damage at SIXTEEN storeys, The Boom Economy at fourteen and Load of Old Rope at ten. `h`
    // quadrupled and `fh` did not, so the tower went to 3.8 tiles while the jib stayed at fh·1.42,
    // half a tile: a flagpole with a lattice stub on it that never left its own plot, let alone
    // reached the water it stands beside. Every fitting stretched the same way — a machinery house
    // taller than it is wide, a counterweight drawn as a sliver, a load the shape of a wardrobe,
    // and a hook that hung four storeys over the deck for the whole cycle. The ⚠ over TYPE_FLOORS
    // records this failure on a forecourt, where the number was too big; this is the same one with
    // the number too small, and the rule out of both is that a fitting is a property of the
    // MACHINE and a storey count is not.
    //
    // The programme: slew out over the water, pay out, take a load, lift, slew in over the shed,
    // set it down, and stand there. `work` is under half, so a crane is parked most of the time,
    // and the phase is seeded off the tile, so no two on one quay are ever in step.
    const ph = motionPhase(now, seed + 17, 34000, 0.46), u = ph < 0 ? 0 : ph;
    // THE REACH, SOLVED OFF THE TOWER RATHER THAN OFF THE PLOT. What a dock crane is FOR is getting
    // its hook out past the quay edge and over a hull — half a tile to the plot line and as much
    // again beyond it — so the jib is a fraction of the machine's own height, floored at the old
    // fh·1.42 so a four-storey wharf is bit-for-bit the crane it already was, and capped so no tile
    // can author a mile of lattice. It reaches out over open water by design, the same way the quay
    // crane's boom does; the jib is strokes and decals, so `segFit` never sees it and the plot-line
    // trim it would otherwise fall foul of does not apply.
    const REACH = Math.min(Math.max(fh * 1.42, towerTop * 0.62), 2.6);
    // ⚠ AND THE SLEW IS AN ARC LENGTH, NOT AN ANGLE. Half a radian on a half-tile jib is a nudge;
    // on a two-tile jib it is a tip travelling a tile and a quarter, and the two cranes on this quay
    // stand one tile apart. The programme keeps its shape and the sweep is solved so the tip covers
    // about the same ground whatever the machine's size — with a floor under it, because a crane
    // you cannot see moving is not animated.
    const SW = clamp(fh * 1.42 * 0.55 / REACH, 0.26, 0.55) / 0.55;
    // ⚠ EVERY MOVEMENT STARTS AND ENDS AT THE u = 0 POSE, which is what makes "parked" free: the
    // home pose is not written out anywhere, it is what this programme evaluates to at zero.
    let slew = moveSeg(u, 0.00, 0.14, 0, 0.55 * SW);
    slew = moveSeg(u, 0.52, 0.66, slew, -0.45 * SW);
    slew = moveSeg(u, 0.92, 1.00, slew, 0);
    let tr = moveSeg(u, 0.14, 0.30, 0.46, 0.92);        // the trolley, as a fraction of the reach
    tr = moveSeg(u, 0.66, 0.80, tr, 0.52);
    let hk = moveSeg(u, 0.14, 0.30, 0.86, 0.00);        // the hook, 1 = chocked up under the trolley, 0 = down on the water
    hk = moveSeg(u, 0.36, 0.52, hk, 0.86);
    hk = moveSeg(u, 0.66, 0.80, hk, 0.30);
    hk = moveSeg(u, 0.84, 0.92, hk, 0.86);
    const laden = u > 0.33 && u < 0.82;
    // ⚠ AIMED SQUARE OUT OVER THE BERTH RATHER THAN DIAGONALLY ACROSS THE PLOT. The old bearing sat
    // 51° off the quay's own normal, which at half a tile of reach kept the tip inside the tile and
    // at two tiles would swing it along the quay instead of out over the water. Local +y is the
    // ENTRANCE, which on all three of the Yards' waterside wharves is the dock side — Crane Damage,
    // The Boom Economy and Load of Old Rope all face east onto the channel. The Wet Handoff faces
    // its street instead and points its jib inland; an arm is handed its tile and nothing about its
    // neighbours, so finding the water would take a frame state the way `LIGHT_STATE` is one.
    const th = Math.PI / 2 + slew, ct = Math.cos(th), st = Math.sin(th);
    const at = (r) => F(-fh * 0.4 + ct * r, -fh * 0.2 + st * r);
    const thW = th + faceYaw(E);   // ⚠ the same bearing in WORLD terms, for everything that TURNS rather than just sits somewhere
    // ⚠ THE DECLINE AND THE TRUSS DEPTH ARE FRACTIONS OF THE JIB, NOT OF THE BUILDING. At h·0.24
    // over a half-tile run this was a 54° ski jump, which is the whole reason the thing read as a
    // second tower beside the first rather than as a boom.
    const jibZ0 = towerTop - h * 0.06, jibZ1 = jibZ0 - REACH * 0.20, RISE = REACH * 0.10;
    const tip = at(REACH), heel = at(REACH * 0.10), tail = at(-fh * 0.65);   // ⚠ far enough back to READ as a counterweight: at 0.34 it sat 0.05 of a footprint clear of the house and the two merged into one orange blob — and it stays in FOOTPRINT units, because a longer jib does not put the counterweight further out over the yard
    const STEEL = 'rgba(120,128,140,0.95)', PAINT = [156, 100, 44];   // galvanised lattice, painted house — amber, the Yards' own end of the palette
    movingBox(ctx, cam, mx, my, towerTop, towerTop + fh * 0.30, fh * 0.32, fh * 0.20, PAINT, alpha, night, thW);                       // machinery house on the ring — wider than it is tall, or it reads as a pointed cap
    movingBox(ctx, cam, tail[0], tail[1], towerTop - fh * 0.05, towerTop + fh * 0.27, fh * 0.11, fh * 0.10, [88, 92, 98], alpha, night, thW);   // counterweight
    // ⚠ A LATTICE, NOT A LINE, AND THAT IS WHAT MAKES THE SLEW READABLE. A single stroke rotating
    // in plan barely changes shape — it is the same line at a slightly different angle — so the
    // old jib would have looked broken rather than moving. A trussed boom changes completely.
    // ⚠ AND THE BAY COUNT FOLLOWS THE LENGTH. Five bays over half a tile is a truss; five bays over
    // two and a half tiles is a ladder with its rungs a storey apart.
    latticeBoom(ctx, cam, [heel[0], heel[1], jibZ0], [tip[0], tip[1], jibZ1], RISE,
      Math.round(clamp(REACH / 0.22, 5, 14)), 2.4, STEEL, alpha, night);
    emitWire(ctx, cam, [tail[0], tail[1], towerTop + fh * 0.27], [tip[0], tip[1], jibZ1 + RISE], 1.2, 'rgba(70,76,84,0.9)', alpha, { pull: 0 });   // backstay
    const car = at(REACH * (0.10 + tr * 0.88)), carZ = jibZ0 + (jibZ1 - jibZ0) * tr;
    movingBox(ctx, cam, car[0], car[1], carZ - fh * 0.12, carZ, fh * 0.07, fh * 0.06, [96, 102, 112], alpha, night, thW);             // the trolley
    // ⚠ THE HOOK RUNS BETWEEN TWO REAL HEIGHTS, NOT DOWN A FRACTION OF THE LIFT. A fraction was
    // right at four storeys and leaves a sixteen-storey crane's block hanging four storeys over the
    // water for the whole cycle — a crane that lifts nothing, which is the animation not READING
    // rather than the animation not running.
    const hookLo = h * 0.05 + fh * 0.12, hookZ = hookLo + (carZ - fh * 0.30 - hookLo) * hk;
    hoistLine(ctx, cam, car[0], car[1], carZ - fh * 0.12, hookZ, fh, alpha, night,
      laden ? { h: fh * 0.34, hx: fh * 0.15, hy: fh * 0.13, rgb: [150, 128, 54] } : null, thW);
    blinkLight(ctx, cam, tip[0], tip[1], jibZ1 + RISE, '255,90,70', now, seed, alpha, 1.5);           // the tip light, on the tip it is actually on
    if (night) {
      glowPool(ctx, cam, car[0], car[1], carZ - fh * 0.14, '255,214,150', 8, alpha * 0.34);                // the trolley's work lamp
      glowPool(ctx, cam, car[0], car[1], hookZ, '255,206,140', 10, alpha * 0.26);                         // and what it is lighting
    }
  },
};
