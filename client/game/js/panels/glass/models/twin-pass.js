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
  awning, draw3DBoxAt, drawFacetDrum, drawRing, drawSmoke, frac, glowPool, marqueeBand,
  reserveSignBand, roofCross,
} from '../../windshield.js';

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
  tine(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // TINE & TEMPER — kitchenware, and the room description is a SMITHY: "a low brick
    // smithy with a slate roof and a chimney that never quite goes cold. Racks of blackened pans and
    // bright new tines hang either side of the door." None of that was on the building, which was a
    // flat grey box with eight grey lumps hung on it — the pans were `rgb(74,72,70)` drums against a
    // `ty_kitchen` wall of [74,68,58], which is the same value, so the one feature the arm had went
    // invisible the moment it was drawn. The palette is warm brick now and the ironmongery is dark
    // and bright against it, which is what makes a rail of pans read as a rail of pans.
    //
    // ⚠ THE FIRE IS THE WHOLE BUILDING AND IT IS ALSO THE ONLY THING ON THIS STREET THAT MOVES.
    // Ironside Street is a junkyard, a clone vat, a chem supply and a depot — all of them cold. A
    // chimney that never quite goes cold is the one warm thing on the block, so the stack, its
    // smoke and the forge glow at its foot are day-and-night rather than gated on `night`: a
    // smithy with a dead chimney is a shop that shut.
    const BRICK = pal, SLATE = 'ty_dw_slate', IRON = 'ty_dw_iron', STEEL = 'ty_wh_metal';
    const plinth = h * 0.09, wallTop = h * 0.60, eaves = h * 0.69, ridge = h * 0.80;
    const WALL = fh * 0.86;
    // 1) THE BRICK, ON A STONE PLINTH. Low and wide: two storeys of workshop, not a shopfront.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, plinth, SLATE, seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, WALL, plinth, wallTop, BRICK, seed, night, alpha, false);
    // 2) THE SLATE ROOF — an overhanging eaves course and a ridge block on top of it, so the
    //    silhouette steps twice instead of stopping dead at a parapet like everything else here.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.97, wallTop, eaves, SLATE, seed + 2, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.60, eaves, ridge, SLATE, seed + 3, night, alpha, true);
    // 3) THE CHIMNEY. Brick, at the back corner where the forge is, with an iron cowl on it. The
    //    smoke is thin and constant rather than a plume — a banked fire, not a working one.
    { const [kx, ky] = F(-fh * 0.42, -fh * 0.46), stack = h * 1.32;
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.15, plinth, stack, BRICK, seed + 4, night, alpha, false);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.19, stack, stack + h * 0.07, IRON, seed + 5, night, alpha, true);
      drawSmoke(ctx, cam, kx, ky, stack + h * 0.07, '186,176,166', alpha * 0.34, now, seed + 6);
      glowPool(ctx, cam, kx, ky, plinth, '255,132,48', 7, alpha * (night ? 0.55 : 0.22)); }
    // 4) THE SHOPFRONT — one wide lit window in an iron frame, under an iron canopy.
    //    ⚠ THE GLASS IS A LAMP PALETTE AND NOT A GLAZING ONE, which looks like a mistake and is
    //    the whole of why this frontage works. Every `window grid` key in the registry is DARK —
    //    the brightest is `ty_junk` at [94,70,48] — because they are all walls-with-windows-in,
    //    read at city distance. What is wanted here is the opposite object: the light itself,
    //    seen from the pavement through one sheet of glass, which is what a shop with its lights
    //    on looks like from the other side of a road. Dark pans in front of a dark window is the
    //    bug this arm shipped with; dark pans in front of a lit one is the shop.
    //    ⚠ AND A WIDE PANEL ON A WALL MUST CARRY ITS OWN `yaw` AND `fd`. `draw3DBoxAt`'s depth
    //    DEFAULTS TO ITS HALF-WIDTH, so a shopfront asked for at `fh * 0.46` is a cube 0.92fh on
    //    a side — it stood half a footprint out into the road and read as a gold shipping
    //    container parked against the brick. `awning` has always passed both for this reason; a
    //    small square box (papertomb's window slots) gets away without them and a wide one cannot.
    const sill = plinth + h * 0.04, glassTop = h * 0.34, canopy = h * 0.38;
    const YAW = Math.atan2(-E[0], E[1]);
    //    ⚠ AND IT HAS TO STAND PROUD, WHICH LOOKS WRONG AND IS THE ONLY THING THAT WORKS. A shop
    //    window is flush with its brickwork in life and flush here means COPLANAR, which on a
    //    depth buffer is a coin toss the wall wins — at `fh * 0.01` of clearance the whole lit
    //    front simply did not draw. Every arm in this file that puts something on a wall pushes
    //    it out; this is that rule at shopfront size.
    { const [gx, gy] = F(0, WALL + fh * 0.015);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.46, sill, glassTop, 'ty_dw_lamp', seed + 8, night, alpha, false, YAW, fh * 0.05);
      glowPool(ctx, cam, gx, gy, (sill + glassTop) * 0.5, '255,198,132', 9, alpha * (night ? 0.5 : 0.20)); }
    { const [bx, by] = F(0, WALL + fh * 0.03);    // the stallriser, which a shopfront stands on
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.48, plinth, sill, IRON, seed + 9, night, alpha, false, YAW, fh * 0.06); }
    for (const mx of [-0.235, 0, 0.235]) {   // iron mullions, which make it a shopfront and not a panel
      const [px, py] = F(mx * fh, WALL + fh * 0.06);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.018, sill, glassTop + h * 0.012, IRON, seed + 12, night, alpha, false, YAW, fh * 0.035);
    }
    { const [tx, ty] = F(0, WALL + fh * 0.06);    // …and a transom across them, or it is one lit sheet
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.47, glassTop - h * 0.10, glassTop - h * 0.082, IRON, seed + 13, night, alpha, false, YAW, fh * 0.035); }
    // …and the clerestory. A workshop is lit from high up on the long walls, not from the street.
    for (const side of [-1, 1]) for (const ly of [-0.40, -0.02, 0.36]) {
      const [wx, wy] = F(side * WALL * 0.99, ly * fh);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.07, wallTop - h * 0.14, wallTop - h * 0.07, 'ty_dw_lamp', seed + 14, night, alpha, false);
    }
    //    ⚠ GALVANISED RATHER THAN IRON, and that is contrast rather than taste: the canopy is the
    //    thing the pans hang UNDER, so at the palette of the pans themselves the two merge into one
    //    dark mass with no rail in it. A light slab over dark pots is the only arrangement in which
    //    the rail is a rail.
    awning(ctx, cam, dx, dy, E, WALL * 1.04, fh * 1.06, canopy, canopy + h * 0.045, STEEL, seed + 7, night, alpha, fh * 0.30);
    // 5) THE PAN RAIL — five hanging masses in graded sizes, slung from the canopy soffit in
    //    FRONT of the lit glass. Graded, because the shop racks by size and a random scatter reads
    //    as junk rather than as stock.
    //    ⚠ NEAR-BLACK AGAINST A LIT WINDOW, which is the only arrangement in which "blackened"
    //    is a thing you can see. The first cut hung them at the same value as the wall behind
    //    them and the row disappeared — which is the bug this arm shipped with for months, in the
    //    opposite direction: grey pans on a grey wall.
    //    ⚠ AND THE RADIUS HAS TO CLEAR THE PITCH, which is not obvious until it is drawn. Eight
    //    pans at a 0.195fh pitch means anything over ~0.085fh of radius touches its neighbour,
    //    and eight overlapping near-black drums are not a rail of pans — they are one black slab
    //    a metre and a half wide, which reads as a hole in the building. Five at 0.31 with a
    //    0.115 top radius leaves daylight between every one of them.
    for (let i = 0; i < 5; i++) {
      const g = 0.115 - i * 0.012, [px, py] = F((-0.62 + i * 0.31) * fh, WALL * 1.13);
      //    ⚠ AND THE TRAILING `pal` IS NOT OPTIONAL HERE. A drum paints through the style closure
      //    above and RECORDS itself with the ambient `SHAPE_PAL` — the building's own — so without
      //    it every reader downstream of the capture (distance LOD, the cold open) draws eight
      //    brick pots on a brick wall, which is the exact bug this arm already had once.
      //    ⚠ AND A PAN IS WIDER THAN IT IS DEEP. Hung as a column from the soffit to head height
      //    these read as eight black sacks; a shallow drum with a hook of daylight above it reads
      //    as a pan. The hang height is what varies, not the body.
      const hang = canopy - h * (0.055 + i * 0.011);
      drawFacetDrum(ctx, cam, px, py, hang - h * 0.048, hang, fh * g, fh * g * 0.88, 8, alpha,
        (f) => 'rgb(' + (30 + f.nl * 40 | 0) + ',' + (28 + f.nl * 37 | 0) + ',' + (26 + f.nl * 34 | 0) + ')', 'rgb(168,150,116)', 'ty_reach_iron');
    }
    // 6) THE TINES — bright new steel, stood on end in a rack either side of the door, from the
    //    pavement to shoulder height. They sit OUTSIDE the glazing, against the brick, so the two
    //    halves of the stock read against two different backgrounds: dark iron on light glass,
    //    bright steel on dark brick. That pairing is the whole shop — second-hand iron cleaned
    //    back to bare — and it is the thing no other frontage on Ironside Street has.
    for (const side of [-1, 1]) {
      const [rx, ry] = F(side * fh * 0.62, WALL * 1.06);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.14, plinth, plinth + h * 0.03, IRON, seed + 40 + side, night, alpha, true);
      for (let i = 0; i < 5; i++) {
        const [tx, ty] = F(side * fh * (0.50 + i * 0.06), WALL * 1.09);
        draw3DBoxAt(ctx, cam, tx, ty, fh * 0.013, plinth + h * 0.02, h * (0.26 + frac(seed * 5 + i + side * 3) * 0.06),
          STEEL, seed + 30 + i + side * 7, night, alpha, false);
      }
    }
    // 7) THE NAME, across the brick above the canopy.
    //    ⚠ `marqueeBand`'s `half` IS BOTH THE WIDTH AND THE STAND-OFF (`ox = E[0] * half * 0.94`),
    //    so a band sized to the wall sits INSIDE it — the trap ff_kiln's own note records. At the
    //    old `fh * 0.80` against a `fh * 0.90` wall the sign was a tenth of a tile behind its own
    //    brickwork and only survived on `DECO_PULL`'s tie-breaker.
    const tnSgnW = WALL * 1.09, tnSgnZ = wallTop * 0.86;
    const tnRoom = { floor: canopy + h * 0.07, wallTop, wall: WALL };
    reserveSignBand(tnSgnW, tnSgnZ, tnRoom);   // nothing the kit hangs may cross the name — see reserveSignBand
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, tnSgnW, tnSgnZ, m.neon || '#ff9a3e', night, alpha, 'TINE & TEMPER', tnRoom);
    // 8) THE LIDS, stacked against the flank where the shop runs out of wall to hang things on.
    //    ⚠ SQUAT DRUMS, NOT SLABS. These were three tall iron boxes and read as three ducts: a lid
    //    is a circle, nothing else about it says lid, and a rectangle is simply a different object.
    //    A drum wider than it is tall IS a stack of lids, and `drawFacetDrum` already draws one.
    for (const [i, ly] of [[0, -0.34], [1, 0.02], [2, 0.38]]) {
      const [lx, ly2] = F(-fh * 0.88, ly * fh), r = fh * (0.19 - i * 0.022);
      drawFacetDrum(ctx, cam, lx, ly2, plinth, plinth + h * (0.07 - i * 0.012), r, r * 0.92, 12, alpha,
        (f) => 'rgb(' + (44 + f.nl * 46 | 0) + ',' + (42 + f.nl * 43 | 0) + ',' + (40 + f.nl * 39 | 0) + ')', 'rgb(150,136,106)', 'ty_reach_iron');
    }
  },
  twocell(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // TWO-CELL SUPPLY — a cramped front room of corrugated sheet and honest
    // intentions. The one thing worth rendering is that its salvaged emergency-lighting strip stays
    // lit when the block is dark, so at night it is the only window on the street that is still on.
    const wallTop = h * 0.62, roof = h * 0.70;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, wallTop, roof, pal, seed + 1, night, alpha, true);
    // 1) THE CRATE COUNTER, visible through the open front — stacked scavenged boxes.
    { const [cx, cy] = F(0, fh * 0.66);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.34, 0, h * 0.22, 'ty_2cell_crate', seed + 2, night, alpha, true);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.22, h * 0.22, h * 0.34, 'ty_2cell_crate', seed + 3, night, alpha, true); }
    // 2) GOODS ON NAILS — canteens and coils hung right across the outside of the front wall.
    for (let i = 0; i < 6; i++) { const g = frac(seed * 3 + i), [hx, hy] = F((-0.60 + i * 0.24) * fh, fh * 0.84);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.055, wallTop * (0.42 + g * 0.10), wallTop * 0.78, 'ty_2cell_crate', seed + 10 + i, night, alpha, false); }
    // 3) THE STRIP. Deliberately not gated on `night` for its existence, only for its strength:
    //    the point of an emergency fitting is that it is on when nothing else is.
    { const [lx, ly] = F(0, fh * 0.86);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.62, wallTop * 0.80, wallTop * 0.88, 'ty_2cell_crate', seed + 20, night, alpha, true, 0, fh * 0.05);
      glowPool(ctx, cam, lx, ly, wallTop * 0.80, '196,232,255', 10, alpha * (night ? 0.66 : 0.24)); }
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
  stitch(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // STITCH 'N' BITCH — the twin of Co-Pay & Pray on the `clinic` mesh, and the
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
    // difference is that Watts works IN THE STREET: the roller door is UP, the bench is pulled half
    // out of the shop, and the whole frontage is open. Nuts to That is a closed room full of drawers.
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
  hulls(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // HULLS ANGELS — the twin of The Wet Handoff on the `wharf` mesh, and the joke
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
