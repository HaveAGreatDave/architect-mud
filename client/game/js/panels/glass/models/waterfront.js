// The waterfront: building-model arms for the Basin jetty, the Beacon and Fairweather Marina.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  BAY, BERTH_LATCH, BERTH_SETDOWN, DECO_LIFT, DECO_PULL, FACE_EPS, TR, WALL_COL, awning,
  bakeSignText, berthBoxColour, berthBoxZ, berthOwnLift, berthPhase, berthPre, berthRow,
  berthRowOut, berthSlot, blinkLight, clamp, cssRgb, draw3DBoxAt, drawBarrelRoof, drawFacetDrum,
  drawRing, drawSmoke, emitDecoFill, emitLightRunner, emitSurfaceText, emitWire, facePals, faceYaw,
  glowPool, hfChrome, lightBeam, marqueeBand, mast, moveSeg, movingBox, reserveSignBand, roofCross,
  windFlag,
} from '../../windshield.js';

export const WATERFRONT_ARMS = {
  // ══ THE BASIN JETTY ══════════════════════════════════════════════════════════════════════
  // Three arms for one structure, because a run of deck, the yard you leave the truck in and the
  // thing on the head are three different buildings that happen to be in a line.
  //
  // ⚠ A DECK SECTION IS SYMMETRIC, and that is a correctness rule rather than a style one — the
  // same argument the three walls make above. This is one tile four times in a row, each with an
  // entrance facing derived from a door that is not there, so any feature placed on a "front"
  // points a different way on every tile and the run reads as litter blown along a jetty. Centred
  // masses and ± pairs only. What varies is the seeded furniture, never the section.
  pier(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    // ⚠ CONCRETE, AND STANDING ON ITS OWN LEGS. This was a timber deck on driven piles, and from
    // the air it read as a tan raft lying ON the basin — the one thing a pier is not. A pier is a
    // slab held CLEAR of the water on columns, and the gap under it is the whole silhouette: it
    // is what tells you at a glance that the water goes on underneath and that this is a
    // structure rather than a spit of sand somebody paved.
    //
    // ⚠ AND THE GAP WAS THERE AND STILL DID NOT READ, WHICH IS A DIFFERENT PROBLEM FROM NOT
    // HAVING ONE. Four bare columns under a slab are four bare columns: from the water at any
    // distance the shadow under the deck closes up into one dark line and the whole run goes back
    // to being a wall standing in the sea. What separates a pier from a causeway is the BRACING —
    // the X between every pair of legs — because a brace is a diagonal, and a diagonal is the one
    // thing that cannot be mistaken for a solid. It costs a stroke each and it is the entire read.
    //
    // ⚠ ALONG THE RUN IS IN TILE UNITS AND ACROSS IT IS IN `fh`, WHICH IS WHY THIS ARM IS THE ONLY
    // ONE `shapes:smoke` REPORTS ABSOLUTE TERMS FOR. `fh` is seeded per tile and varies 0.38..0.44,
    // while the pitch from one section to the next is exactly 1 — so a column bay, a rail post or
    // a bollard placed as a multiple of `fh` walks a little further along on every section and the
    // colonnade zig-zags down the pier. The deck's WIDTH is a property of the deck and stays in
    // `fh`; anything whose neighbour has to line up with it is in tiles, the same argument the rail
    // wire makes by running to ±0.5.
    const SOFFIT = h * 0.42, DECK = h * 0.60;             // the underside of the slab, and its top
    const UPSTAND = h * 0.74, RAIL = h * 1.04;
    const COLX = 0.74, COLY = 0.30;
    // 1) THE COLUMNS. Four square piers to a section, standing out of the water with a capping
    //    beam across them — square because this is poured concrete rather than driven timber, and
    //    because a square column turning its corner to you is what makes the row read as a row.
    for (const ly of [-COLY, COLY]) {
      for (const lx of [-1, 1]) {
        const [px, py] = F(lx * fh * COLX, ly);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.10, 0, SOFFIT, 'ty_pier_pile', seed + 3 + lx + ly * 7, night, alpha, false);
        drawRing(ctx, cam, px, py, h * 0.10, fh * 0.115, 4, 'rgba(26,38,34,0.55)', 1.8, alpha);   // the tide line, which is the only thing on a column that says which way the sea goes
      }
      // The capping beam the slab bears on. A slab with nothing between it and the columns reads
      // as a table top resting on four sticks.
      const [bx2, by2] = F(0, ly);
      draw3DBoxAt(ctx, cam, bx2, by2, fh * 0.92, SOFFIT - h * 0.09, SOFFIT, 'ty_pier_pile', seed + 9 + ly * 5, night, alpha, false, faceYaw(E), fh * 0.10);
    }
    // 1b) THE BRACING — see the ⚠ above. An X across the width at each bay, and one down the run
    //     between the two bays, all of it clear of the deck above and the water below.
    //     ⚠ `pull: 0`. These hang in the open air UNDER the slab with nothing to clear, so the
    //     only thing a pull could do is walk them out from under the deck they belong beneath —
    //     the same argument `latticeBoom` and the crane's knee braces make.
    { const BR = 'rgba(64,70,72,0.9)', zl = h * 0.06, zh = SOFFIT - h * 0.10;
      for (const ly of [-COLY, COLY]) {
        emitWire(ctx, cam, W3(-fh * COLX, ly, zl), W3(fh * COLX, ly, zh), 1.5, BR, alpha, { pull: 0 });
        emitWire(ctx, cam, W3(fh * COLX, ly, zl), W3(-fh * COLX, ly, zh), 1.5, BR, alpha, { pull: 0 });
      }
      for (const lx of [-1, 1]) {
        emitWire(ctx, cam, W3(lx * fh * COLX, -COLY, zl), W3(lx * fh * COLX, COLY, zh), 1.4, BR, alpha, { pull: 0 });
        emitWire(ctx, cam, W3(lx * fh * COLX, COLY, zl), W3(lx * fh * COLX, -COLY, zh), 1.4, BR, alpha, { pull: 0 });
      } }
    // 2) THE SLAB, and a shadow line under its lip. The lip is what a concrete deck has that a
    //    plank deck does not — a cast edge that oversails the beam and throws a hard line along
    //    the whole run.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, SOFFIT, SOFFIT + h * 0.05, 'ty_pier_pile', seed + 11, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.20, SOFFIT + h * 0.05, DECK, pal, seed, night, alpha, true);
    // 3) THE UPSTAND — a low cast kerb up both flanks, which is what stops a wheel and what the
    //    rail is bolted to. ⚠ BOTH FLANKS, AND NOTHING ON A "FRONT": see the ⚠ over this case.
    for (const lx of [-1, 1]) {
      const [kx, ky] = F(lx * fh * 1.12, 0);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.09, DECK, UPSTAND, 'ty_pier_pile', seed + 13 + lx, night, alpha, true, faceYaw(E), fh * 1.20);
    }
    // 3b) THE FENDER PILES. What a hull actually touches, and the reason a boat can lie against a
    //     concrete pier without either of them coming off worse. They stand OUTSIDE the slab edge
    //     and finish above the kerb, so from the water they break the deck line into bays — which
    //     is the second half of the job the bracing does, at the level the eye is actually at.
    for (const lx of [-1, 1]) for (const ly of [-COLY, COLY]) {
      const [fx2, fy2] = F(lx * fh * 1.29, ly);
      draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.048, -h * 0.05, UPSTAND + h * 0.05, 'ty_pier_steel', seed + 15 + lx + ly, night, alpha, true, faceYaw(E), fh * 0.048);
    }
    // 4) THE RAIL, AND IT RUNS THE WHOLE TILE. A mass box is clamped to 0.44 of a tile, so the
    //    slab necessarily carries a joint at every section — a wire does not, so the rail is
    //    authored to ±0.5 and meets its neighbour's exactly. That one continuous line down the
    //    length of the pier is most of what makes four separate tiles read as one structure.
    for (const lx of [-1, 1]) {
      const ex = lx * fh * 1.12;
      // ⚠ NOT ±0.5 FOR THE POSTS. A post on the tile boundary is TWO posts once the run is longer
      // than one section — the neighbour draws its own in the same place, and two coincident boxes
      // are a z-fight rather than a stouter post.
      for (const t of [-0.36, -0.12, 0.12, 0.36]) {
        const [qx, qy] = F(ex, t);
        draw3DBoxAt(ctx, cam, qx, qy, fh * 0.028, UPSTAND, RAIL, 'ty_pier_steel', seed + 17 + t * 10 + lx, night, alpha, false);
      }
      emitWire(ctx, cam, W3(ex, -0.5, RAIL), W3(ex, 0.5, RAIL), 1.6, 'rgba(150,160,170,0.92)', alpha, { pull: DECO_PULL });
      emitWire(ctx, cam, W3(ex, -0.5, UPSTAND + h * 0.14), W3(ex, 0.5, UPSTAND + h * 0.14), 1.1, 'rgba(126,136,146,0.8)', alpha, { pull: DECO_PULL });
    }
    // 5) WHAT A BOAT TIES TO. Bollards on both flanks at the column bays, because a symmetric
    //    section means a hull can come alongside either side of the pier.
    const bollard = (f) => 'rgb(' + (52 + f.nl * 30 | 0) + ',' + (56 + f.nl * 30 | 0) + ',' + (60 + f.nl * 30 | 0) + ')';
    for (const lx of [-1, 1]) for (const ly of [-0.34, 0.34]) {
      const [bx, by] = F(lx * fh * 0.92, ly);
      drawFacetDrum(ctx, cam, bx, by, DECK, DECK + h * 0.16, fh * 0.052, fh * 0.062, 8, alpha, bollard, 'rgb(44,48,52)', 'ty_pier_steel');
    }
    // 6) THE LAMP, AND IT IS ON EVERY SECTION. ⚠ IT USED TO BE ONE ROLL OF THREE, which is the
    //    right device for a FITTING and the wrong one for a lamp: a run of standards at an even
    //    pitch, marching away and getting smaller, is the oldest picture of a pier there is, and
    //    a lamp on one section in three is a lamp somebody left behind. The seeded roll below
    //    keeps the things that genuinely should be occasional.
    //    ⚠ AND THE SIDE ALTERNATES WITH THE SECTION rather than being rolled, so the run reads as
    //    staggered on purpose instead of as a coin toss that happened twice.
    { const side = (Math.abs(Math.round(seed * 13)) % 2) ? 1 : -1;
      const [lpx, lpy] = F(side * fh * 0.98, 0);
      draw3DBoxAt(ctx, cam, lpx, lpy, fh * 0.032, DECK, DECK + h * 0.86, 'ty_pier_steel', seed + 21, night, alpha, false);
      draw3DBoxAt(ctx, cam, lpx, lpy, fh * 0.082, DECK + h * 0.86, DECK + h * 0.94, 'ty_pier_steel', seed + 22, night, alpha, true);
      glowPool(ctx, cam, lpx, lpy, DECK + h * 0.84, '236,222,178', 8, alpha * (night ? 0.58 : 0.10));
      if (night) glowPool(ctx, cam, lpx, lpy, DECK + 0.004, '236,222,178', 13, alpha * 0.22); }
    // 7) ONE FLAG PER SECTION, ON THE OTHER SIDE FROM THE LAMP. ⚠ THERE WERE TWO, one on each
    //    flank, which over a three-section run put SIX of them down a pier that has four columns —
    //    and a flag is 2.3·h tall, so they were the tallest thing on the structure and the run
    //    read as bunting rather than as a jetty. One a side, alternating, is a line of them.
    { const side = (Math.abs(Math.round(seed * 13)) % 2) ? -1 : 1;
      const [gx, gy] = F(side * fh * 1.04, 0.18);
      windFlag(ctx, cam, gx, gy, DECK, DECK + h * 2.30, h * 0.92, 'ty_pier_steel', alpha, night, now, seed * 1.7 + side); }
    // 8) ONE SEEDED FITTING PER SECTION, from a set of two — the same device the rampart uses,
    //    and for the same reason: identical sections read as wallpaper, and a landmark in the
    //    middle of a pier reads as a mistake.
    if (Math.abs(Math.round(seed * 7)) % 2) {
      // A ladder over the west edge, down past the slab and the column to the water. The way off
      // a pier that is not the way you came on, and the one part of it a swimmer can use.
      const sx = -fh * 1.22;
      for (const o of [-0.055, 0.055]) {
        emitWire(ctx, cam, W3(sx, o, UPSTAND), W3(sx, o, -h * 0.04), 1.4, 'rgba(146,156,166,0.9)', alpha, { pull: DECO_PULL });
      }
      for (const t of [0.08, 0.28, 0.48, 0.68, 0.88]) {
        emitWire(ctx, cam, W3(sx, -0.055, UPSTAND - (UPSTAND + h * 0.04) * t), W3(sx, 0.055, UPSTAND - (UPSTAND + h * 0.04) * t), 1.2, 'rgba(160,170,180,0.85)', alpha, { pull: DECO_PULL });
      }
    } else {
      // A stack of creels and a coil of rope somebody has left on the slab. Centred, so they land
      // in the same place whatever this section's entrance turned out to be.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.18, DECK, DECK + h * 0.13, 'ty_pier_deck', seed + 31, night, alpha, true);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.13, DECK + h * 0.13, DECK + h * 0.21, 'ty_pier_deck', seed + 32, night, alpha, true);
    }
  },
  harbour_yard(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LAND END — hardstanding, six marked bays, a kerb, and the reason
    //                        the pier is somewhere you arrive rather than somewhere you end up.
    // This is the one tile in the run that is NOT symmetric: everything about it faces the road
    // (local +y), because a yard is an answer to a road.
    const SLAB = h * 0.07, KERB = h * 0.105;
    const YYAW = faceYaw(E);   // ⚠ see below — every RECTANGULAR box in this arm has to turn with it
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.26, 0, SLAB, pal, seed, night, alpha, true);   // the poured yard
    // 1) THE KERB, ON EVERYTHING BUT THE ROAD SIDE. A yard open on all four edges is a field with
    //    paint on it; the kerb is what says vehicles come in at one place.
    // ⚠ A RECTANGULAR BOX NEEDS THE ENTRANCE YAW AND A SQUARE ONE DOES NOT, which is why almost
    //    no arm in this file passes one. `F()` turns a POINT into the entrance's frame; the box's
    //    own extents are world-axis-aligned until `yaw` turns them too, so a kerb placed down the
    //    west side comes out lying across the yard on an east-facing tile. `gl:mesh` catches it by
    //    comparing the four facings — it reported this one reaching 0.920 east against 0.669 north.
    for (const [klx, kly, khw, kfd] of [[0, -1.20, 1.26, 0.06], [-1.20, 0, 0.06, 1.26], [1.20, 0, 0.06, 1.26]]) {
      const [kx, ky] = F(klx * fh, kly * fh);
      draw3DBoxAt(ctx, cam, kx, ky, fh * khw, SLAB, KERB, 'ty_quay_deck', seed + 3 + klx + kly, night, alpha, true, YYAW, fh * kfd);
    }
    // 2) THE BAYS. Paint, not geometry — six of them in two ranks, which is the whole statement
    //    that this is parking and not an apron. Laid flat on the slab through the decal layer, so
    //    the depth buffer settles them against the kerb rather than a probe guessing.
    { const z = SLAB + 0.0012, w = fh * 0.015;
      const y0 = -fh * 0.92, y1 = -fh * 0.16, y2 = fh * 0.24, y3 = fh * 1.00;
      for (const blx of [-0.96, -0.32, 0.32, 0.96]) for (const [a, b] of [[y0, y1], [y2, y3]]) {
        emitDecoFill(ctx, cam, [W3(blx * fh - w, a, z), W3(blx * fh + w, a, z), W3(blx * fh + w, b, z), W3(blx * fh - w, b, z)],
          'rgba(232,218,152,0.62)', alpha, DECO_LIFT, 'yardbay');
      }
      for (const ey of [y1, y2]) {
        emitDecoFill(ctx, cam, [W3(-fh * 0.96, ey - w, z), W3(fh * 0.96, ey - w, z), W3(fh * 0.96, ey + w, z), W3(-fh * 0.96, ey + w, z)],
          'rgba(228,214,150,0.40)', alpha, DECO_LIFT, 'yardbay');
      }
    }
    // 3) THE HARBOURMASTER'S HUT — a bolted steel cabin in the seaward corner, which is where the
    //    only person who works here sits. It is also the only lit window between the road and the
    //    beacon, and at night that is what tells a driver the yard is the right turning.
    { const [hx, hy] = F(-fh * 0.78, -fh * 0.74);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.32, SLAB, SLAB + h * 0.86, 'ty_yard_hut', seed + 11, night, alpha, false);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.36, SLAB + h * 0.86, SLAB + h * 0.94, 'ty_yard_hut', seed + 12, night, alpha, true);   // eaves
      if (frontVis) marqueeBand(ctx, cam, hx, hy, E, fh * 0.32, SLAB + h * 0.66, m.neon || '#ffc24a', night, alpha);
      if (night) glowPool(ctx, cam, hx, hy, SLAB + h * 0.50, '255,206,140', 7, alpha * 0.40);
    }
    // 4) LIGHT. A yard is a dark rectangle beside a dark basin; two columns are what make it a
    //    place you would leave a vehicle overnight.
    for (const clx of [-1, 1]) {
      const [cx2, cy2] = F(clx * fh * 1.02, fh * 0.30);
      draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.034, SLAB, SLAB + h * 1.30, 'ty_pier_steel', seed + 15 + clx, night, alpha, false);
      draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.10, SLAB + h * 1.30, SLAB + h * 1.38, 'ty_pier_steel', seed + 17 + clx, night, alpha, true);
      glowPool(ctx, cam, cx2, cy2, SLAB + h * 1.28, '255,216,160', 11, alpha * (night ? 0.6 : 0.10));
    }
    if (night) glowPool(ctx, cam, dx, dy, SLAB + 0.004, '255,210,150', 28, alpha * 0.30);
  },
  // ══ THE BEACON ═══════════════════════════════════════════════════════════════════════════
  // What stands on the head of the jetty, and the only thing in Coldwater that nobody in
  // Coldwater built. It reads as a lighthouse because it does a lighthouse's job and stands where
  // one stands; everything else about it is wrong on purpose — a waisted spine rather than a
  // taper, a rib cage rather than a gallery rail, a collar too wide for what it carries, and a
  // crown that closes over the light like something holding it rather than housing it.
  //
  // ⚠ THE CHARACTER IS ONE FIELD. `m.neon` is the ONLY colour this arm reads: the eye, the sweep,
  // the ribs, the collar and the wash on the water all derive from it, so recolouring the beacon
  // is a one-word edit that cannot leave half the tower burning last week's hue. It ships cyan.
  lighthouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    const NB = cssRgb(m.neon || '#4ff0ff') || [80, 240, 255];
    const RGB = NB[0] + ',' + NB[1] + ',' + NB[2];        // the "r,g,b" the light helpers want
    const nbc = (a) => 'rgba(' + RGB + ',' + a + ')';     // …and the css string the wires want
    const CAISSON = h * 0.09, PLINTH = h * 0.13, FOOT = h * 0.31;
    const WAIST = h * 0.60, FLARE = h * 0.84, COLLAR = h * 0.89;
    const EYE0 = COLLAR + h * 0.02, EYE1 = EYE0 + h * 0.13;
    const CROWN = EYE1 + h * 0.15, TIP = CROWN + h * 0.26;
    // Shell and rib skins. Both read only `f.nl`, which is all a facet carries on the mesh path
    // (see drumSkin) — a skin that varied with the beam angle would be baked at one instant and
    // then never move, which is worse than not having one.
    const shell = (r, g2, b) => (f) => 'rgb(' + (r + f.nl * 30 | 0) + ',' + (g2 + f.nl * 32 | 0) + ',' + (b + f.nl * 36 | 0) + ')';
    // ⚠ AND THE 2-D SKINS TRACK THE PALETTE, because they are the same surface drawn by the other
    // renderer. GLASS 2 shades a drum from `pal` and GLASS 1 from `style`, so leaving these where
    // they were would mean the waist reads on the GPU and not on the canvas fallback.
    const lhDark = shell(14, 17, 23), lhBody = shell(40, 47, 58), lhRib = shell(74, 82, 92);
    // The lantern glass. Dark by day and dark between flashes: what is IN it is a light (a sprite
    // on the depth buffer), never a colour baked into the glass, so the mesh stays honest about a
    // surface that never changes and the animation lives where animation can live.
    const eyeSkin = (f) => 'rgb(' + (10 + f.nl * 18 + NB[0] * 0.10 | 0) + ',' + (18 + f.nl * 26 + NB[1] * 0.12 | 0) + ',' + (24 + f.nl * 30 + NB[2] * 0.12 | 0) + ')';
    // 1) THE CAISSON. Six sides, sitting in the water with no step and no plinth course — it does
    //    not meet the basin so much as come out of it.
    drawFacetDrum(ctx, cam, dx, dy, 0, CAISSON, fh * 1.04, fh * 0.94, 6, alpha, lhDark, null, 'ty_lh_shell_dk');
    drawRing(ctx, cam, dx, dy, h * 0.03, fh * 1.00, 6, 'rgba(24,40,44,0.6)', 2, alpha);   // the waterline stain
    drawFacetDrum(ctx, cam, dx, dy, CAISSON, PLINTH, fh * 1.10, fh * 1.10, 6, alpha, lhBody, 'rgb(22,26,33)', 'ty_lh_shell');   // the apron you would stand on
    // 2) THE SPINE — a WAIST, which is the shape doing the work. A lighthouse tapers, because a
    //    lighthouse is masonry and masonry is widest where the load is. This pulls IN to its
    //    middle and flares back out to carry the collar, which is not something stone can do and
    //    reads, correctly, as a thing grown to a specification rather than stacked to a drawing.
    //    Nine facets: an odd count never presents a flat pair square-on, so it never resolves
    //    into a tube.
    drawFacetDrum(ctx, cam, dx, dy, PLINTH, FOOT, fh * 0.72, fh * 0.46, 9, alpha, lhBody, null, 'ty_lh_shell');
    drawFacetDrum(ctx, cam, dx, dy, FOOT, WAIST, fh * 0.46, fh * 0.17, 9, alpha, lhDark, null, 'ty_lh_shell_dk');
    drawFacetDrum(ctx, cam, dx, dy, WAIST, FLARE, fh * 0.17, fh * 0.52, 9, alpha, lhBody, null, 'ty_lh_shell');
    // 3) THE RIBS, AND THEY ARE THE WHOLE BUILDING. Three of them, one line each: off the apron,
    //    in past the waist, out to grip the rim of the collar, then up and over the lantern to the
    //    needle. Each is a stack of short segments rather than one leg, because a rib visibly made
    //    of vertebrae is the cheapest thing here that stops the silhouette reading as architecture.
    //
    // ⚠ THIS USED TO BE TWO STRUCTURES WEARING ONE SILHOUETTE. The shaft had three ribs stopping
    // at the collar and the crown had four spines starting above the lantern, at four unrelated
    // angles — so the cage holding the light had nothing to do with the cage holding the tower,
    // and no line in the model went anywhere. One run from the water to the tip is the whole of
    // what makes it read as grown rather than stacked, and it is also what gives the night a shape
    // to trace: three arcs sweeping up, out round the disc and over the light.
    //
    // ⚠ AND THE COUNT STAYS ODD. Three ribs against nine facets never presents a matched pair
    // square-on, which is what stops the tower resolving into a tube from any heading.
    const RIB_A = [0.3, 2.394, 4.488];       // the primary ribs — structure, and the line that glows
    const WEB_A = [1.347, 3.441, 5.535];     // the secondary cage, interleaved at 60°
    const RT = (t) => PLINTH + (FLARE - PLINTH) * t;
    // The vertebrae, as radius × fh over a height band. The last two are the CLAW: a step out under
    // the collar and a post OUTSIDE its rim, so the disc that is too wide for anything it carries
    // is visibly carried by something. Before them the collar simply floated on the shaft.
    const VERT = [
      [0.80, PLINTH, RT(0.24)], [0.52, RT(0.24), RT(0.50)], [0.40, RT(0.50), RT(0.74)],
      [0.62, RT(0.74), FLARE - h * 0.05], [0.94, FLARE - h * 0.06, FLARE], [1.22, FLARE, COLLAR + h * 0.012],
    ];
    // Where the rib goes ABOVE the collar, where a cage is open by definition and there is nothing
    // to make vertebrae out of. Strokes, because a spine has a screen width and no world thickness.
    // ⚠ IT SPRINGS FROM THE TOP OF THE CLAW AND NOT FROM ITS MIDDLE. The post is a real drum
    // spanning 1.165–1.275, so an arc starting at 1.22 starts INSIDE it and has to be pulled out
    // of its own host to be drawn at all — which is a thing `glself` counts and is right to.
    const ARC = [[1.22, COLLAR + h * 0.016], [0.66, EYE1], [0.30, CROWN], [0.085, CROWN + h * 0.20]];
    const RP = (ca, sa, [rr, z]) => [dx + ca * fh * rr, dy + sa * fh * rr, z];
    for (const ra of RIB_A) {
      const ca = Math.cos(ra), sa = Math.sin(ra);
      for (const [rr, z0, z1] of VERT) {
        drawFacetDrum(ctx, cam, dx + ca * fh * rr, dy + sa * fh * rr, z0, z1, fh * 0.055, fh * 0.045, 5, alpha, lhRib, null, 'ty_lh_rib');
      }
      for (let i = 1; i < ARC.length; i++) {
        emitWire(ctx, cam, RP(ca, sa, ARC[i - 1]), RP(ca, sa, ARC[i]), 2.4 - i * 0.3,
          'rgba(120,132,146,0.92)', alpha, { pull: DECO_PULL });
      }
      // The light running the length of it. It is on the RIBS rather than up the shaft because a
      // rib stands proud of what it is bolted to, and a line drawn on a surface is a line the
      // depth buffer hides — the same reason a mast takes a pull and a painted sign takes a
      // tie-breaker. Dimmed rather than deleted by day: this thing is never entirely off.
      //
      // ⚠ IT PASSES OUTSIDE THE COLLAR AND NOT THROUGH IT. The disc is a real solid a tenth of a
      // storey thick, so a runner cutting the corner from under it to over it is a runner the
      // depth buffer eats in the middle — a line that stops for no reason anybody looking at it
      // could name. Going round the rim is both the honest path and the one that reads.
      //
      // ⚠ AND IT RUNS ALONG THE RIB'S OUTER FACE, NOT DOWN ITS AXIS. Every waypoint here used to
      // be the vertebra's own radius, which puts the light strip inside the post it is supposed
      // to be fixed to: it is then drawn only because `emitWire` pulls it clear of its own host,
      // and `glself` counts every point that has to be rescued that way. `RIB_FACE` is a shade
      // more than the drum's half-width, so the line sits ON the rib the way a light strip does.
      const RIB_FACE = 0.075;
      const RUN = [[0.80 + RIB_FACE, PLINTH + h * 0.04], [0.40 + RIB_FACE, WAIST],
        [0.62 + RIB_FACE, FLARE - h * 0.05], [0.94 + RIB_FACE, FLARE - h * 0.03],
        [1.22 + RIB_FACE, FLARE + h * 0.01], [1.22 + RIB_FACE, COLLAR + h * 0.016], ...ARC.slice(1)];
      emitLightRunner(ctx, cam, RUN.map((p) => RP(ca, sa, p)), nbc(night ? 0.62 : 0.20),
        alpha, night, RGB, undefined, DECO_PULL);
    }
    // The seams where the shaft changes its mind. Three rings, and the one at the WAIST is lit:
    // the pinch is the one place on this tower where something is obviously being held in, and a
    // glowing line round it is what says the shape is doing work rather than being a shape.
    drawRing(ctx, cam, dx, dy, PLINTH, fh * 0.725, 9, 'rgba(58,66,76,0.7)', 1.2, alpha);
    drawRing(ctx, cam, dx, dy, FOOT, fh * 0.465, 9, 'rgba(58,66,76,0.7)', 1.2, alpha);
    drawRing(ctx, cam, dx, dy, WAIST, fh * 0.178, 9, nbc(night ? 0.55 : 0.18), 1.6, alpha);
    // 4) THE COLLAR — a disc wider than anything under it. A lighthouse gallery is a walkway
    //    sized for a keeper to stand on; this is sized for nothing, which is the point of it.
    drawFacetDrum(ctx, cam, dx, dy, FLARE, COLLAR, fh * 1.16, fh * 1.10, 9, alpha, lhRib, 'rgb(46,52,60)', 'ty_lh_rib');
    drawRing(ctx, cam, dx, dy, COLLAR + h * 0.005, fh * 1.12, 9, nbc(night ? 0.5 : 0.16), 1.4, alpha);
    // What the lantern lays on the top of its own disc. The collar sits directly under the light
    // and caught nothing off it, which is the one place a dark surface reads as an oversight
    // rather than as a choice.
    glowPool(ctx, cam, dx, dy, COLLAR + h * 0.01, RGB, fh * 1.5 * (cam.FL || 300),
      alpha * (night ? 0.22 : 0.06), { add: true, max: 260 });
    // 5) THE EYE. One faceted drum of dark glass under a shallow cap — no astragals, no lantern
    //    frame, no ventilator ball, none of the ironmongery that says a person services this.
    //    The two seams are what stop it being a dark bead between two flashes: an optic reads as
    //    an optic because you can see where its glass is held, and nothing else here says so.
    drawFacetDrum(ctx, cam, dx, dy, EYE0, EYE1, fh * 0.56, fh * 0.50, 9, alpha, eyeSkin, null, 'ty_lh_eye');
    drawFacetDrum(ctx, cam, dx, dy, EYE1, EYE1 + h * 0.04, fh * 0.58, fh * 0.42, 9, alpha, lhDark, 'rgb(18,21,27)', 'ty_lh_shell_dk');
    drawRing(ctx, cam, dx, dy, EYE0 + h * 0.004, fh * 0.565, 9, nbc(night ? 0.60 : 0.20), 1.5, alpha);
    drawRing(ctx, cam, dx, dy, EYE1 - h * 0.004, fh * 0.505, 9, nbc(night ? 0.60 : 0.20), 1.5, alpha);
    // 6) THE CAGE. The ribs carry on over the lantern (above); these are the three between them,
    //    springing off the COLLAR rather than off the shaft, so everything above the disc comes
    //    off the disc. Secondary structure: thinner, steel, and never lit — a rib is the line that
    //    glows and a web member is the line that does not, which is what keeps six spines over one
    //    lantern from reading as six of the same thing.
    for (const wa of WEB_A) {
      const ca = Math.cos(wa), sa = Math.sin(wa);
      // ⚠ ON the collar's top face, never IN it. `COLLAR` is the disc's own upper z, so a spine
      // springing from exactly there springs from inside its host and has to be pulled out of it.
      const W = [[1.06, COLLAR + h * 0.009], [0.62, EYE1 + h * 0.02], [0.10, CROWN + h * 0.17]];
      for (let i = 1; i < W.length; i++) {
        emitWire(ctx, cam, RP(ca, sa, W[i - 1]), RP(ca, sa, W[i]), 1.6 - i * 0.2,
          'rgba(120,132,146,0.82)', alpha, { pull: DECO_PULL });
      }
    }
    drawFacetDrum(ctx, cam, dx, dy, CROWN + h * 0.16, TIP, fh * 0.070, fh * 0.012, 5, alpha, lhRib, null, 'ty_lh_rib');   // the needle
    // 7) THE LIGHT. A bi-form optic: two beams a half-turn apart, a revolution about every ten
    //    seconds, which is a real characteristic rather than a guess. They depress toward the
    //    horizon the way a sea light does.
    //
    // ⚠ A BEAM IS LIGHT, SO IT IS DRAWN BY THE LIGHT SYSTEM — see `lightBeam`. This was five
    // strokes stepping their alpha down, and a stroke is sized in SCREEN pixels: the shaft was
    // 3.4px wide at the lantern from the far quay and 3.4px wide with your nose against the
    // caisson, which reads as a scratch on the glass rather than as something in the air. The
    // cone's widths below are in TILES, so it opens out along its own length and swells as you
    // close on it, both of which are what says "light" rather than "wire".
    const spin = (now || 0) * 0.00060;
    const camA = Math.atan2((cam.ey || 0) - dy, (cam.ex || 0) - dx);
    let flash = 0;
    for (const half of [0, Math.PI]) {
      const th = spin + half, ct2 = Math.cos(th), st2 = Math.sin(th);
      // How nearly this beam is pointing at the eye that is looking at it. A lighthouse is a light
      // that is dark most of the time and then, briefly, the brightest thing on the water — and
      // the flash is not a timer, it is the moment the beam comes round to YOU.
      const aim = Math.max(0, Math.cos(th - camA));
      flash = Math.max(flash, Math.pow(aim, 24));
      // ⚠ THE THROW IS WHERE THE LIGHT DIES, NOT WHERE IT WOULD IF IT CARRIED ON. The stroke beam
      // ran to 9.2 tiles at an alpha of 0.02 — a length nobody could see, and a sixth of the nodes
      // to draw it. What is left is what is actually lit.
      //
      // ⚠ AND IT STARTS OUTSIDE THE LANTERN, WHICH IS A DEPTH-BUFFER FACT AND NOT A NICETY. The
      // eye is a faceted drum of radius fh·0.56 with the crown cage standing over it; a node
      // inside that is BEHIND real geometry and the buffer hides it, so a beam rooted at the axis
      // came out of a dark notch the shape of its own lantern. The stroke beam started at 0.45 and
      // never showed it, because the painter's queue sorted the whole shaft in front of the tower.
      //
      // ⚠ AND A BEAM COMING AT YOU IS BRIGHTER THAN ONE CROSSING IN FRONT OF YOU, which is forward
      // scatter and is most of what a sea light looks like. It is a gentle term on purpose: steep
      // enough and the far beam disappears entirely, and two beams of which one is missing reads
      // as a fault rather than as a rotation.
      const BEAM_Z = EYE0 + h * 0.06, THROW = 6.6, DROOP = 0.10, ROOT = fh * 0.72;
      lightBeam(ctx, cam,
        [dx + ct2 * ROOT, dy + st2 * ROOT, BEAM_Z],
        [dx + ct2 * THROW, dy + st2 * THROW, BEAM_Z - THROW * DROOP],
        fh * 0.78, fh * 3.40, RGB,
        (night ? 0.60 : 0.13) * (0.72 + 0.55 * aim) * alpha, { fall: 1.25 });
    }
    // The eye itself: a standing glow with the flash on top of it. Both are sprites, so a building
    // between you and the tower settles them per pixel instead of an all-or-nothing probe.
    //
    // ⚠ ITS SIZE IS IN TILES FOR THE SAME REASON THE BEAM'S IS, AND IT HAD TO MOVE WHEN THE BEAM
    // DID. This was a bare `9 + 16·flash` — a world radius of about a twentieth of a tile once the
    // focal length is divided out — against a shaft that now leaves the lantern two thirds of a
    // tile across. A beam wider than the thing throwing it reads as light coming out of nothing,
    // so the flare is set against the beam's own root rather than being a number of its own.
    // ⚠ AND IT MUST NOT BLOW TO WHITE, WHICH THE FIRST CUT OF IT DID. An additive disc at 0.85
    // alpha and two thirds of a tile across saturates its own middle, and a saturated core is
    // white — so from the pier the beacon was a featureless white ball with a black tower under
    // it, and the one thing the whole arm is built around (`m.neon` is the ONLY colour it reads)
    // was the thing you could not see. The flash lives in REACH now and not in the core: the
    // radius carries it, the alpha barely moves, and the light stays the colour it is.
    glowPool(ctx, cam, dx, dy, (EYE0 + EYE1) / 2, RGB, fh * (0.62 + 0.85 * flash) * (cam.FL || 300),
      alpha * (night ? 0.28 + 0.26 * flash : 0.12 + 0.22 * flash), { add: true, max: 300 });
    glowPool(ctx, cam, dx, dy, COLLAR, RGB, 7, alpha * (night ? 0.26 : 0.08));
    // What it throws on the water it stands in. A sea light with no wash under it reads as a lamp
    // on a pole; this is the part that says the basin is lit by the thing at the end of the pier.
    glowPool(ctx, cam, dx, dy, h * 0.02, RGB, 26, alpha * (night ? 0.26 + 0.18 * flash : 0.07));
    blinkLight(ctx, cam, dx, dy, TIP, RGB, now, seed + 4, alpha, 1.8);   // the needle's own slow pulse
  },
  quay_crane(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    // THE SHIP-TO-SHORE GANTRY — the machine that made a container port a container port, and
    // the one silhouette a modern quay has that nothing else in this city does.
    //
    // ⚠ WHAT WAS HERE WAS A SLEWING MOBILE HARBOUR CRANE, AND IT WAS THE WRONG MACHINE. That is a
    // housing on a slew ring with a jib swinging off it — structurally the same idea as the
    // wharf's lattice derrick, drawn tighter — so the "modern" quay and the "old" wharf were one
    // shape twice, which is exactly what this tile's own comment said it existed NOT to be. It was
    // also small: h·0.56 to the top of the housing put the whole machine below the transfer shed
    // behind it, and from the harbour yard it read as a site cabin with a pole on it.
    //
    // A gantry is not a bigger version of that. It STRADDLES the quay on two rails, it never turns
    // at all, and what reads from a mile off is a horizontal boom carried high on four legs under
    // a pylon and two stays.
    //
    // ⚠ AND BECAUSE IT DOES NOT TURN, NEARLY ALL OF IT IS MASS — which is the real argument for
    // this machine over the other one. The ⚠ over `motionOn` forces a slewing crane to draw
    // everything above the ring as strokes: the shape capture and the per-model mesh are both
    // taken at a frozen clock, so a part that moves is nailed to one bearing in GLASS 2, animated
    // in GLASS 1, and collided with at a third, with nothing anywhere to say so. Here only the
    // TROLLEY and what hangs under it move. The legs, the portal, the boom, the pylon and the
    // machinery house are boxes — so the boom is in the per-model mesh, takes the GL key light,
    // casts a ground shadow, occludes what is behind it, and is a thing a pilot can fly into.
    //
    // ⚠ THE BOOM IS FIVE BOXES BECAUSE `segFit` CAPS A MASS BOX AT 0.44 OF A TILE. It clamps BOTH
    // half-extents, unconditionally, and BEFORE `NO_TILE_FIT` is consulted — that list only skips
    // the entrance-side pullback, it does not lift the cap — so a single three-tile girder would
    // arrive as a 0.88-tile stub with no error, no warning, and a perfectly plausible picture.
    // Five boxes end to end at ONE seed carry one texture across the splice, and a boom is built
    // in bays anyway.
    //
    // ⚠ AND EVERY RECTANGULAR BOX TAKES `YAW`. `F`/`facePt` turns a POSITION into the entrance's
    // frame and says nothing about a box's own extents, so a sill beam authored down the quay
    // comes out lying across it on the other three facings. Everything here is long in one axis.
    const DECK = h * 0.05, SILL = h * 0.11, PORTAL = h * 0.44, PORTAL_T = h * 0.55;
    const BOOM = h * 1.20, BOOM_T = h * 1.33, APEX = h * 1.90;
    // Plan, in multiples of fh. Local +y is the entrance and therefore the land; the water is −y,
    // which is what puts the outreach on the side the hull is.
    const WRAIL = -1.14, LRAIL = 0.94, LEGX = 0.74, TIP = -5.60, HEEL = 2.10;
    const YAW = faceYaw(E);
    const body = 'ty_crane_body', dark = 'ty_crane_cw';

    // ── 1. THE QUAY IT STANDS ON ────────────────────────────────────────────────────────────
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.26, 0, DECK, 'ty_quay_deck', seed + 1, night, alpha, true);
    for (const t of [-0.62, 0, 0.62]) {   // the rubber fenders down the face — why a hull can come alongside
      const [fx, fy] = F(t * fh, -fh * 1.22);
      draw3DBoxAt(ctx, cam, fx, fy, fh * 0.13, 0, DECK + h * 0.012, 'ty_pier_steel', seed + 2 + t * 9, night, alpha, true, YAW, fh * 0.05);
    }
    // ⚠ THE RAILS RUN THE WHOLE TILE, AND THEY ARE IN TILE UNITS RATHER THAN IN `fh`. The same
    // argument the pier's handrail makes: `fh` is seeded per tile and varies 0.38..0.44, so a
    // track laid as a multiple of it steps sideways at every tile boundary — and the two cranes
    // on this quay would be standing on two tracks that do not meet.
    for (const ry of [WRAIL, LRAIL]) {
      const yt = ry * fh, rw = 0.013, rz = DECK + 0.0012;
      emitDecoFill(ctx, cam, [W3(-0.5, yt - rw, rz), W3(0.5, yt - rw, rz), W3(0.5, yt + rw, rz), W3(-0.5, yt + rw, rz)],
        'rgba(86,80,72,0.88)', alpha, DECO_LIFT, 'cranerail');
    }

    // ── 2. WHAT STANDS ON THE RAILS ─────────────────────────────────────────────────────────
    // A sill beam down each side tying its two bogies, the bogies themselves, and the four legs.
    for (const s2 of [-1, 1]) {
      const [gx, gy] = F(s2 * LEGX * fh, (WRAIL + LRAIL) * 0.5 * fh);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.13, DECK, SILL, dark, seed + 10, night, alpha, true, YAW, fh * (LRAIL - WRAIL) * 0.5);
      for (const ry of [WRAIL, LRAIL]) {
        const [lx2, ly2] = F(s2 * LEGX * fh, ry * fh);
        draw3DBoxAt(ctx, cam, lx2, ly2, fh * 0.17, DECK, SILL + h * 0.02, dark, seed + 11, night, alpha, true, YAW, fh * 0.21);
        draw3DBoxAt(ctx, cam, lx2, ly2, fh * 0.115, SILL, BOOM, body, seed + 12, night, alpha, false, YAW, fh * 0.115);
      }
    }
    // The portal beams, one over each rail. This is the opening a lorry drives through, and the
    // reason the machine reads as straddling the quay rather than as standing beside it.
    for (const ry of [WRAIL, LRAIL]) {
      const [px, py] = F(0, ry * fh);
      draw3DBoxAt(ctx, cam, px, py, fh * (LEGX + 0.115), PORTAL, PORTAL_T, body, seed + 14, night, alpha, true, YAW, fh * 0.12);
    }
    // The knee braces in the corners of that opening, as strokes because a brace leans and a box
    // cannot — the same reason the pier's under-deck bracing is wires.
    // ⚠ `pull: 0`, AND A BRACE IS THE CASE THAT RULE IS FOR. `DECO_PULL` is a tie-breaker for a
    // part that merely lies ON a surface; this one is welded INTO the leg at one end and under the
    // beam at the other, so a pull carries both ends out in front of the mass they are fixed to —
    // which `glself` counts, and counted, at exactly four points.
    for (const s2 of [-1, 1]) for (const ry of [WRAIL, LRAIL]) {
      emitWire(ctx, cam, W3(s2 * LEGX * fh, ry * fh, PORTAL - h * 0.17), W3(s2 * (LEGX - 0.30) * fh, ry * fh, PORTAL),
        1.5, 'rgba(150,154,160,0.9)', alpha, { pull: 0 });
    }

    // ── 3. THE BOOM ─────────────────────────────────────────────────────────────────────────
    // One box girder from the back-reach over the yard to the tip out over the water. See the ⚠
    // above for why it is five boxes and why they share a seed.
    const NSEG = 5, BAY = (HEEL - TIP) / NSEG;
    for (let i = 0; i < NSEG; i++) {
      const [bx2, by2] = F(0, (HEEL - BAY * (i + 0.5)) * fh);
      draw3DBoxAt(ctx, cam, bx2, by2, fh * 0.30, BOOM, BOOM_T, body, seed + 40, night, alpha, true, YAW, fh * BAY * 0.5);
    }
    // The machinery house on the back-reach, where the hoist and trolley drives live — and what
    // stops the landward half of the boom reading as a counterweight nobody drew.
    { const [mx2, my2] = F(0, (HEEL - 0.66) * fh);
      draw3DBoxAt(ctx, cam, mx2, my2, fh * 0.44, BOOM_T, BOOM_T + h * 0.15, dark, seed + 55, night, alpha, true, YAW, fh * 0.54);
      if (night) glowPool(ctx, cam, mx2, my2, BOOM_T + h * 0.08, '255,196,130', 7, alpha * 0.22); }

    // ── 4. THE PYLON AND THE STAYS ──────────────────────────────────────────────────────────
    // What holds a horizontal boom up, and the part of the silhouette that still says crane at a
    // distance where the trolley is one pixel.
    { const [yx, yy] = F(0, LRAIL * fh);
      draw3DBoxAt(ctx, cam, yx, yy, fh * 0.19, BOOM_T, APEX, body, seed + 50, night, alpha, false, YAW, fh * 0.19);
      draw3DBoxAt(ctx, cam, yx, yy, fh * 0.25, APEX, APEX + h * 0.045, dark, seed + 51, night, alpha, true, YAW, fh * 0.25);
      blinkLight(ctx, cam, yx, yy, APEX + h * 0.05, '255,80,70', now, seed + 52, alpha, 1.2);
      // ⚠ THE STAYS LAND JUST ABOVE THE BOOM, NOT ON IT. An endpoint exactly in the girder's top
      // surface is coplanar with it, and a depth buffer settles a tie by losing it.
      const top = W3(0, LRAIL * fh, APEX), zs = BOOM_T + h * 0.012, STAY = 'rgba(104,110,118,0.95)';
      emitWire(ctx, cam, top, W3(0, TIP * fh, zs), 2.0, STAY, alpha, { pull: 0 });
      emitWire(ctx, cam, top, W3(0, HEEL * fh, zs), 2.0, STAY, alpha, { pull: 0 });
      // …and the A-frame's own legs, down to the waterside leg heads.
      for (const s2 of [-1, 1]) emitWire(ctx, cam, top, W3(s2 * LEGX * fh, WRAIL * fh, BOOM), 1.5, STAY, alpha, { pull: 0 }); }

    // ── 5. THE ONLY PART THAT MOVES ─────────────────────────────────────────────────────────
    // Down onto the box waiting in the portal, latch, hoist, trolley out over the hull, stack it,
    // let go, hoist, come back in. One stroke is one box.
    //
    // ⚠ IT LOADS, AND IT USED TO UNLOAD. The direction was never visible while the berth was
    // empty water — a box appearing at one end of the stroke and vanishing at the other reads
    // both ways — and it stopped being arbitrary the moment there was a hull to put boxes ON.
    // What made the swap more than a reversal is the HEIGHTS: a quay is low and a weather deck
    // is not, so the two ends of the hoist are no longer one number and a half, they are the
    // quay's own stack top and `berthBoxZ`, which RISES as she fills.
    //
    // ⚠ AND THE STROKE IS THE BERTH'S LIFT, NOT A TIMER OF ITS OWN. It ran on
    // `motionPhase(now, seed + 23, 44000, 0.42)` — its own period, its own duty, its own seed —
    // so a machine forty-four seconds into its cycle was setting boxes down on a hull that was
    // filling at one a second off a separate ramp, and the only thing the two shared was that
    // both were happening. Now the gantry's `u` IS the fraction through a lift and the hull
    // counts the lifts, so a box lands on her deck because this stroke put it there.
    // ⚠ AND IT ONLY RUNS WHEN THERE IS SOMETHING TO WORK, and only on this crane's own lifts —
    // outside either the machine stands, which is the whole of "the ship sails when the cranes
    // stop" and of two gantries taking it in turn rather than lifting the same box together.
    //
    // ⚠ EVERY MOVEMENT STARTS AND ENDS AT THE u = 0 POSE, which is what makes "parked" free: the
    // home pose is not written down anywhere, it is what this programme evaluates to at zero.
    const BRT = berthPhase(now);
    const SLOT = berthSlot(seed);
    const CUR = BRT.alongside ? BRT.lift : -1;                     // the lift being worked, or none
    const MINE = CUR >= 0 && berthOwnLift(SLOT, CUR) === CUR;      // …and is it this crane's?
    const u = MINE ? BRT.lu : 0;
    // WHICH BOX THIS STROKE IS HANDLING, and which one is on the chassis waiting for the next.
    // ⚠ THE WAITING ONE IS THIS CRANE'S NEXT LIFT, NOT THE BERTH'S — the other gantry's box is on
    // the other gantry's chassis, and a lane that showed it would have a container change colour
    // under a crane that never touched it.
    const HOLD = BRT.box;                                          // …read only while laden ⇒ MINE
    const WAIT = berthPre(BRT.ship) + berthOwnLift(SLOT, MINE && u >= BERTH_SETDOWN ? CUR + 1 : Math.max(CUR, 0));
    // The two ends of the run, in TILES outboard of this tile's centre, resolved into the boom's
    // own parameter. ⚠ SOLVED RATHER THAN WRITTEN DOWN: `fh` is seeded per tile over 0.38..0.44,
    // so a FRACTION of the boom is a different world distance on every crane — the fixed 0.88
    // this replaces reaches 1.78 tiles on a narrow tile and 2.06 on a wide one, against an
    // outboard flank at 1.88, so the same machine drops short of one ship and over the far side
    // of the next with nothing authored differently. `BERTH_*` are the numbers the hull places
    // itself by, and solving for them lands the spreader in the same place on every crane.
    const troAt = (d) => clamp((d / fh + HEEL) / (HEEL - TIP), 0.12, 0.98);
    // ⚠ ONE NUMBER FOR THE LANE, because the trolley's inner stop and the box waiting under it
    // are the same place said twice — once as a distance along the boom and once as a point on
    // the deck — and two of them is a gantry lowering onto empty concrete beside a container.
    const STOW_IN = 0.60;                                                // fh, landward: the portal lane
    const TRO_IN = troAt(-STOW_IN * fh);
    // ⚠ AND THE OUTER STOP IS THE BOX'S OWN ROW, NOT ONE FIXED SPOT ON HER BEAM. It was
    // `0.5 + GAP + BEAM − 0.26` — a constant, so every box in the call came down over the same
    // cell while the hull laid them out across six rows, and the two disagreed by up to a third
    // of a tile without either being wrong about anything it could see. `berthRowOut` is the
    // hull's own row geometry, measured from the quay face both of them place themselves off.
    const TRO_OUT = troAt(0.5 + berthRowOut(berthRow(HOLD)));
    // …and a world-z into the hoist's own parameter, so the box's UNDERSIDE lands on `z`.
    const hkAt = (z) => clamp((z + h * 0.058 - DECK - h * 0.09) / (BOOM - h * 0.26 - DECK), 0.04, 0.94);
    const Z_QUAY = DECK + h * 0.062 * 2;        // the top of a presented box, in the portal lane
    const HK_HIGH = 0.94;
    let tro = moveSeg(u, 0.44, 0.66, TRO_IN, TRO_OUT);   // out over the hull, with the box
    tro = moveSeg(u, 0.94, 1.00, tro, TRO_IN);           // …and back in, empty
    let hk = moveSeg(u, 0.10, 0.26, HK_HIGH, hkAt(Z_QUAY));       // down onto what is waiting
    hk = moveSeg(u, 0.30, 0.44, hk, HK_HIGH);                     // hoist
    hk = moveSeg(u, 0.66, BERTH_SETDOWN - 0.02, hk, hkAt(berthBoxZ(HOLD)));   // stack it on her deck
    hk = moveSeg(u, 0.84, 0.94, hk, HK_HIGH);                     // and up again
    // ⚠ THE LATCH AND THE RELEASE ARE THE BERTH'S, NOT TWO LITERALS HERE. The hull starts drawing
    // this box at BERTH_SETDOWN, so a `0.82` written out again beside it is the one number in the
    // whole arrangement that could drift, and the box would blink out of the air.
    const laden = u > BERTH_LATCH && u < BERTH_SETDOWN;
    const trY = (HEEL - (HEEL - TIP) * tro) * fh;
    const [tx2, ty2] = F(0, trY);
    movingBox(ctx, cam, tx2, ty2, BOOM_T, BOOM_T + h * 0.045, fh * 0.25, fh * 0.19, [104, 110, 120], alpha, night, YAW);
    const hookZ = DECK + h * 0.09 + (BOOM - h * 0.26 - DECK) * hk;
    // FOUR FALLS, not one rope. A spreader hangs level on four parts of wire, and the two pairs
    // splaying out of one trolley are most of what makes a container crane read as a container
    // crane rather than as a hoist with a box on it.
    for (const ox of [-1, 1]) for (const oy of [-1, 1]) {
      const [rx2, ry2] = F(ox * fh * 0.30, trY + oy * fh * 0.10);
      emitWire(ctx, cam, [rx2, ry2, BOOM_T], [rx2, ry2, hookZ + h * 0.028], 1.2, 'rgba(38,40,44,0.92)', alpha, { pull: 0 });
    }
    movingBox(ctx, cam, tx2, ty2, hookZ + h * 0.028, hookZ + h * 0.052, fh * 0.62, fh * 0.10, [198, 158, 44], alpha, night, YAW);   // the spreader
    // …and the box under it, in the colour it will be on her deck. See `berthBoxColour`: the
    // crane is not told, it asks.
    if (laden) movingBox(ctx, cam, tx2, ty2, hookZ - h * 0.058, hookZ + h * 0.028, fh * 0.60, fh * 0.13, berthBoxColour(HOLD, BRT.ship), alpha, night, YAW);
    // The driver's cab, slung off the trolley on the water side — on this machine the operator
    // rides out with the box, because there is nowhere else to see the cell from.
    { const [cx2, cy2] = F(fh * 0.30, trY - fh * 0.24);
      movingBox(ctx, cam, cx2, cy2, BOOM - h * 0.095, BOOM - h * 0.008, fh * 0.10, fh * 0.10, [44, 62, 78], alpha, night, YAW);
      if (night) glowPool(ctx, cam, cx2, cy2, BOOM - h * 0.05, '170,215,255', 5, alpha * 0.34); }
    // WHAT IT IS ABOUT TO PICK UP — a box on a chassis in the portal lane. This is how a
    // ship-to-shore crane is actually fed, and it is what the drive-through opening in §2 is an
    // opening FOR; without it the machine invents a container at the bottom of the hoist and
    // makes it vanish again over the water, which is the one way a reversed stroke still reads
    // as unloading. It is here whenever the hook is empty, so the cycle reads as one box after
    // another.
    // ⚠ A `movingBox` AND NOT A MASS ONE. It comes and goes on the clock, and the shape capture
    // and the per-model mesh are both taken at a frozen `now` — see the ⚠ over `movingBox`.
    // ⚠ AND IT IS THE NEXT BOX, IN THE NEXT BOX'S COLOUR. One that stayed the colour of the last
    // lift would be the same container being delivered over and over, which is worse than a
    // painted-on one: it says the machine is on a loop rather than working through a load.
    if (!laden && BRT.alongside) {
      const [qx, qy] = F(0, STOW_IN * fh);
      movingBox(ctx, cam, qx, qy, DECK, DECK + h * 0.030, fh * 0.56, fh * 0.11, [46, 50, 56], alpha, night, YAW);          // the chassis under it
      movingBox(ctx, cam, qx, qy, DECK + h * 0.030, Z_QUAY, fh * 0.60, fh * 0.13, berthBoxColour(WAIT, BRT.ship), alpha, night, YAW);
    }

    // ── 6. WHAT IS ON THE QUAY ──────────────────────────────────────────────────────────────
    // Two short stacks under the back-reach, which is exactly where a gantry lands a box.
    { const KEYS = ['ty_cont_b', 'ty_cont_r', 'ty_cont_g', 'ty_cont_y'];
      for (const [sx3, sy3, n2] of [[-0.80, 1.44, 3], [0.82, 1.30, 2]]) {
        const [bx3, by3] = F(sx3 * fh, sy3 * fh);
        for (let i = 0; i < n2; i++) {
          const k = KEYS[Math.abs(Math.round(seed * 7 + i * 3 + (sx3 > 0 ? 2 : 0))) % 4];
          draw3DBoxAt(ctx, cam, bx3, by3, fh * 0.115, DECK + h * 0.062 * i, DECK + h * 0.062 * (i + 1), k, seed + 60 + i, night, alpha, true, YAW, fh * 0.46);
        }
      } }
    { const [px2, py2] = F(0, TIP * fh);
      blinkLight(ctx, cam, px2, py2, BOOM_T + h * 0.02, '255,80,70', now, seed + 3, alpha, 1.5); }   // boom-tip obstruction light
    if (night) {
      // ⚠ THIS IS THE ONE MACHINE IN THE CITY THAT IS BRIGHTER AFTER DARK, AND THE FIRST CUT OF IT
      // WAS NOT. A container terminal runs three shifts and the men on the deck are forty feet
      // under a swinging box, so it is floodlit end to end — and a 9px pool on a three-tile boom
      // is a spot, which left the whole machine reading as a dark cut-out against the water.
      glowPool(ctx, cam, dx, dy, DECK + 0.004, '255,214,160', 22, alpha * 0.26);
      for (const ly2 of [-4.4, -2.6, -0.9, 0.9]) {   // the boom floods, on the underside where the work is
        const [gx2, gy2] = F(0, ly2 * fh);
        glowPool(ctx, cam, gx2, gy2, BOOM - h * 0.02, '255,212,150', 15, alpha * 0.34);
      }
      for (const s2 of [-1, 1]) {   // …and the pole floods on the portal heads, which light the quay itself
        const [gx3, gy3] = F(s2 * LEGX * fh, LRAIL * fh);
        glowPool(ctx, cam, gx3, gy3, PORTAL_T + h * 0.03, '255,206,140', 13, alpha * 0.30);
      }
    }
  },
  // ══ FAIRWEATHER MARINA ═══════════════════════════════════════════════════════════════════════
  // The Ascendants' own waterfront, off the head of Halcyon Boulevard. Two arms, and the brief
  // for both is §2.1's three words: glass, translucency, chrome. Cyan and violet in the field,
  // never sodium — that belongs to the east.
  //
  // ⚠ A PONTOON SECTION IS SYMMETRIC, for exactly the reason the pier's is. This is one tile
  // twice in a row, each with an entrance facing derived from a door that is not there, so any
  // feature placed on a 'front' points a different way on the two of them. Centred masses and
  // ± pairs only.
  pontoon(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    // ⚠ IT FLOATS, AND THAT IS THE WHOLE SILHOUETTE. The pier two hundred tiles east is a slab
    // held CLEAR of the water on braced columns, and the gap under it is what says 'structure'.
    // A pontoon is the opposite statement: no legs at all, freeboard you could step over, riding
    // the water so closely that from any distance it reads as a pale line lying ON the basin.
    // Drawing this as a low pier — columns, bracing, a rail — gets you a short pier, which is a
    // different building and one the city already has.
    // ⚠ THE FREEBOARD IS SET AGAINST THE SEA, AND THE SEA MOVED UNDER IT. This was 0.05/0.09 of
    //   h — a deck 0.0176 tiles proud of the water — which was right when the basin was a flat
    //   painted plane at z = 0 and became wrong the day the swell got a displaced mesh. Measured
    //   against `seaHeight` at the amplitudes `seaAmpsFor` actually produces, the crest is 0.0405
    //   tiles at FIVE KNOTS, which is the calmest sea the weather can make: 2.3x the deck. At 22 kt
    //   it is 7.3x and in a gale 14.8x. The pontoon was underwater in every sea state in the game,
    //   and what you saw was the swell washing over a pale slab — a drowned pontoon reads as a
    //   rotting timber dock, which is the one thing Ascendant ground should never look like.
    //
    // ⚠ AND IT IS STILL A PONTOON RATHER THAN A PIER, which is the constraint that decides the
    //   number. 0.72·h is 0.141 tiles — about a metre at this scale — which is real marina pontoon
    //   freeboard and still a step down from a boat, so the paragraph above about no legs, no
    //   bracing and no handrail all stands. It clears a working 22-knot sea and a full gale still
    //   washes the deck, which is correct: that is what a gale does to a marina.
    //
    // ⚠ IT CANNOT RIDE THE SWELL, and that is a rule rather than a shortcut. A float that heaved
    //   with the water is the physically right answer and `seaHeight` is a pure function sitting
    //   right there — but `draw3DBoxAt` records into the shape capture and the per-model MESH,
    //   both taken ONCE at a frozen clock, so a z that read the clock would be nailed to whatever
    //   pose the capture caught and GLASS 2 would draw a pontoon frozen mid-wave. Anything that
    //   moves has to leave the mass pass for the stroke/decal/sprite layers, which is a different
    //   and much larger change. A fixed freeboard that clears the working sea is the honest one.
    const FLOAT = h * 0.50, DECK = h * 0.72;   // the top of the buoyancy box, and the walking surface
    // 1) THE FLOATS AND THE DECK. Both run to ±0.5 IN TILE UNITS along the run, never in `fh`:
    //    `fh` is seeded per tile and varies 0.38..0.44, so a run authored in it steps in and out
    //    at every joint. Across the run is a property of the pontoon and stays in `fh`. Same
    //    split, for the same reason, as the pier arm's own note.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, -h * 0.30, FLOAT, 'ty_asc_chrome_dk', seed, night, alpha, false, faceYaw(E), 0.5);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.80, FLOAT, DECK, pal, seed + 1, night, alpha, true, faceYaw(E), 0.5);
    // 2) THE FINGERS, AND THEY ARE WHY THIS READS AS A MARINA. A bare walkway is a jetty; what
    //    makes somebody say 'marina' is the comb — short arms out both sides dividing the water
    //    into boxes one boat wide. Two pairs to a section at ±0.26 along the run, which keeps
    //    them clear of the joint at ±0.5 so a finger never lands on top of its neighbour's.
    //    ⚠ AND A FINGER REACHES JUST PAST THE TILE EDGE, NEVER A WHOLE TILE. The first cut put
    //    the centre at 1.52·fh with a 0.74·fh half-width, which at the top of fh's range is an
    //    outer edge 0.99 tiles from the middle of the pontoon — a walkway reaching clean across
    //    the neighbouring water tile. `tilefit` does not catch it, and correctly: it trims the
    //    ENTRANCE side only, because mass pushed out sideways here is over open basin rather
    //    than over a road. So the number has to be right rather than caught.
    for (const ly of [-0.26, 0.26]) for (const lx of [-1, 1]) {
      const [gx, gy] = F(lx * fh * 1.02, ly);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.30, -h * 0.26, FLOAT, 'ty_asc_chrome_dk', seed + 3 + lx + ly * 9, night, alpha, false, faceYaw(E), 0.085);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.28, FLOAT, DECK, pal, seed + 5 + lx + ly * 9, night, alpha, true, faceYaw(E), 0.075);
    }
    // 3) THE PEDESTALS. A power-and-water post at the root of every finger, which is the fitting
    //    a marina has and a pier does not, and — after dark — the only light source out here.
    //    ⚠ NO LAMP STANDARDS. A run of tall columns marching away is the pier's picture (its own
    //    arm says so), and it is the wrong one twice over: this is Ascendant ground, where the
    //    light comes from inside the thing rather than off a pole, and a pontoon that carried
    //    columns would read as the pier at low tide.
    for (const ly of [-0.26, 0.26]) for (const lx of [-1, 1]) {
      const [px, py] = F(lx * fh * 0.62, ly);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.055, DECK, DECK + h * 0.20, 'ty_asc_chrome', seed + 7 + lx + ly * 11, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.068, DECK + h * 0.20, DECK + h * 0.235, 'ty_aur_frost', seed + 8 + lx + ly * 11, night, alpha, true);
      glowPool(ctx, cam, px, py, DECK + h * 0.21, '120,224,255', 7, alpha * (night ? 0.62 : 0.12));
    }
    // 4) WHAT A BOAT TIES TO. Chrome cleats in ± pairs at the finger roots — small, because the
    //    boats this marina is built for are small, and because a bollard the size of the pier's
    //    is a piece of dock furniture rather than a piece of yacht furniture.
    const cleat = (f) => 'rgb(' + (148 + f.nl * 78 | 0) + ',' + (158 + f.nl * 78 | 0) + ',' + (168 + f.nl * 78 | 0) + ')';
    for (const ly of [-0.40, 0.40]) for (const lx of [-1, 1]) {
      const [bx, by] = F(lx * fh * 0.70, ly);
      drawFacetDrum(ctx, cam, bx, by, DECK, DECK + h * 0.05, fh * 0.030, fh * 0.036, 8, alpha, cleat, 'rgb(120,130,140)', 'ty_asc_chrome');
    }
    // 5) THE EDGE LINE. One continuous cool line down each flank, inset into the deck. ⚠ IT RUNS
    //    TO ±0.5 AND THE POSTS DO NOT: a wire meets its neighbour's exactly, which is what makes
    //    two separate tiles read as one pontoon, and it is the same argument the pier's rail
    //    makes. The pier needs a handrail because it stands three metres over the water; this
    //    does not, and the line is what replaces it — the edge said in light rather than in steel.
    for (const lx of [-1, 1]) {
      const ex = lx * fh * 0.78;
      emitWire(ctx, cam, W3(ex, -0.5, DECK + h * 0.004), W3(ex, 0.5, DECK + h * 0.004), 1.5,
        night ? 'rgba(120,224,255,0.88)' : 'rgba(150,196,214,0.55)', alpha, { pull: DECO_PULL });
    }
    if (night) glowPool(ctx, cam, dx, dy, DECK + 0.004, '120,224,255', 15, alpha * 0.16);
  },
  fuel_dock(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    // FAIRWEATHER MARINA — THE FUEL BERTH. A floating deck moored against the slab's north face,
    // where the channel out of the covered dock (894,902 north through 894,901) meets the basin,
    // so every hull leaving or coming home passes it. The pontoon's float and freeboard under a
    // canopy in the slab's own materials: chrome, the pod-blue glass, champagne on the edges.
    //
    // ⚠ NOT A PUMP ON A DECK. The old float was a grey cabinet and a hose drum, which is a petrol
    //   station somebody towed out onto the water. What makes this read as the marina's is that it
    //   is built out of the same four things the slab is, and that the light comes from inside it
    //   (the canopy soffit and the pylon screens) rather than off a pole. `prp` is left undefined
    //   for this type in state.js, so the red yard pump never stands on it.
    //
    // ⚠ THE BOAT FUELS FROM THE WATER TILE ON THE PYLON SIDE, never on top of the deck: a hull
    //   lies alongside a fuel berth. The pylons stand on local +X, which is always 90 degrees
    //   counter-clockwise of the entrance on the compass (a south entrance puts them EAST). An arm
    //   is handed E and nothing about its own tile, and the mesh is shared by every tile drawing
    //   this model, so the side cannot be a per-tile flag; `fuelSideOf` in
    //   plugins/powerboat/fuel.js derives it from the entrance by the same rule, and that is the
    //   one place the server and the picture have to agree.
    //
    // ⚠ NOTHING ON IT MOVES. Same rule as the pontoon: mass is captured once at a frozen clock.
    const CH = 'ty_asc_chrome', DK = 'ty_asc_chrome_dk', BLUE = 'ty_asc_pod', GOLD = 'ty_fw_gold';
    const metal = hfChrome([96, 112, 130], [232, 242, 250], 1.9);
    const FLOAT = h * 0.50, DECK = h * 0.72;
    const HX = fh * 0.86, HY = fh * 0.80;
    const LF = (u, w) => F(u, w);
    const LW = (u, w, z) => W3(u, w, z);

    // 1) THE FLOAT AND THE DECK, with a champagne lip round the deck edge and a dark fender strip
    //    under it at the waterline — the strip is what a hull actually touches.
    draw3DBoxAt(ctx, cam, dx, dy, HX, -h * 0.30, FLOAT, DK, seed, night, alpha, false, faceYaw(E), HY);
    draw3DBoxAt(ctx, cam, dx, dy, HX * 1.03, FLOAT - h * 0.10, FLOAT, 'ty_pier_steel', seed + 1, night, alpha, false, faceYaw(E), HY * 1.03);
    draw3DBoxAt(ctx, cam, dx, dy, HX * 0.99, FLOAT, DECK, pal, seed + 2, night, alpha, true, faceYaw(E), HY * 0.99);
    // (The champagne edge is a line in section 6, never a box: that palette has a grain in it and a lid of it reads as planking.)
    draw3DBoxAt(ctx, cam, dx, dy, HX * 0.80, DECK, DECK + h * 0.012, pal, seed + 4, night, alpha, true, faceYaw(E), HY * 0.78);

    // 2) THE MAST, on the side away from the pylons, carrying the canopy out over the berth.
    const CANL = DECK + h * 1.55, CANT = CANL + h * 0.07;
    const MU = -HX * 0.55, MW = HY * 0.45;
    { const [mx, my] = LF(MU, MW);
      drawFacetDrum(ctx, cam, mx, my, DECK, CANT + h * 0.18, fh * 0.060, fh * 0.036, 10, alpha, metal, metal, CH); }

    // 3) THE CANOPY — a thin blade of glass in a chrome frame. Square, so it needs no yaw of its
    //    own: frame, a champagne fascia, and the glazing a hair inside so the frame reads as an edge.
    const CU = HX * 0.12, CHX = HX * 0.86;
    { const [cx, cy] = LF(CU, 0);
      draw3DBoxAt(ctx, cam, cx, cy, CHX, CANL, CANT, CH, seed + 6, night, alpha, true, faceYaw(E), CHX);
      draw3DBoxAt(ctx, cam, cx, cy, CHX * 1.02, CANT - h * 0.022, CANT, GOLD, seed + 7, night, alpha, false, faceYaw(E), CHX * 1.02);
      draw3DBoxAt(ctx, cam, cx, cy, CHX * 0.84, CANL - h * 0.012, CANL, BLUE, seed + 8, night, alpha, false, faceYaw(E), CHX * 0.84); }
    for (const sw of [-1, 1]) {
      emitWire(ctx, cam, LW(MU, MW, CANT + h * 0.18), LW(CU + CHX * 0.94, sw * CHX * 0.9, CANT), 1.3,
        'rgba(196,206,218,0.92)', alpha, { pull: FACE_EPS });
    }

    // 4) THE PYLONS. Three slim dispensers along the fuelling edge, each a chrome column with a
    //    frosted screen and a champagne cap. The middle one is race fuel, and its screen is gold.
    const PU = HX * 0.66;
    for (let k = 0; k < 3; k++) {
      const w = (k - 1) * HY * 0.52;
      const [px, py] = LF(PU, w);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.060, DECK, DECK + h * 0.62, CH, seed + 20 + k, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.064, DECK + h * 0.30, DECK + h * 0.52, k === 1 ? GOLD : 'ty_aur_frost', seed + 24 + k, night, alpha, false);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.070, DECK + h * 0.62, DECK + h * 0.66, CH, seed + 28 + k, night, alpha, true);
      glowPool(ctx, cam, px, py, DECK + h * 0.42, k === 1 ? '255,214,140' : '120,224,255', 6, alpha * (night ? 0.75 : 0.18));
      // The hose, docked in a loop down the water side of the pylon.
      emitWire(ctx, cam, LW(PU + fh * 0.065, w, DECK + h * 0.30), LW(PU + fh * 0.11, w, DECK + h * 0.08), 1.6,
        'rgba(24,28,34,0.95)', alpha, { pull: FACE_EPS });
    }

    // 5) CLEATS along the fuelling edge, the pontoon's chrome ones.
    const cleat = (f) => 'rgb(' + (148 + f.nl * 78 | 0) + ',' + (158 + f.nl * 78 | 0) + ',' + (168 + f.nl * 78 | 0) + ')';
    for (const w of [-HY * 0.8, -HY * 0.26, HY * 0.26, HY * 0.8]) {
      const [bx, by] = LF(HX * 0.9, w);
      drawFacetDrum(ctx, cam, bx, by, DECK, DECK + h * 0.05, fh * 0.030, fh * 0.036, 8, alpha, cleat, 'rgb(120,130,140)', CH);
    }

    // 6) THE EDGE LINES — the deck's rim and the canopy's, in the slab's cool light.
    { const rimCol = night ? 'rgba(120,224,255,0.9)' : 'rgba(150,196,214,0.55)';
      const zr = DECK + h * 0.004, zc = CANL + h * 0.004;
      const cw = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = cw[i], [bx, by] = cw[i + 1];
        emitWire(ctx, cam, W3(ax * HX * 1.005, ay * HY * 1.005, zr), W3(bx * HX * 1.005, by * HY * 1.005, zr), 1.4, rimCol, alpha, { pull: FACE_EPS });
        emitWire(ctx, cam, W3(ax * HX * 1.005, ay * HY * 1.005, DECK - h * 0.03), W3(bx * HX * 1.005, by * HY * 1.005, DECK - h * 0.03), 2.2,
          night ? 'rgba(232,206,150,0.92)' : 'rgba(214,190,138,0.95)', alpha, { pull: FACE_EPS });
        emitWire(ctx, cam, LW(CU + ax * CHX * 1.02, ay * CHX * 1.02, zc), LW(CU + bx * CHX * 1.02, by * CHX * 1.02, zc), 1.4, rimCol, alpha, { pull: FACE_EPS });
      } }

    // 7) THE LIGHT. The soffit throws a pool on the deck and the berth at every hour, stronger
    //    after dark, and a lit strip marks the fuelling edge so a skipper can see where to lie.
    { const [cx, cy] = LF(CU, 0);
      glowPool(ctx, cam, cx, cy, CANL - h * 0.02, '206,232,246', 14, alpha * (night ? 0.70 : 0.14));
      emitWire(ctx, cam, LW(HX * 1.01, -HY, FLOAT), LW(HX * 1.01, HY, FLOAT), 2.0,
        night ? 'rgba(255,214,140,0.95)' : 'rgba(200,176,120,0.6)', alpha, { pull: FACE_EPS });
      if (night) glowPool(ctx, cam, cx, cy, DECK + 0.004, '120,224,255', 13, alpha * 0.22); }
  },
  boathouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    // FAIRWEATHER MARINA — a tall slab standing on the quay, banded in champagne metal, with one
    // plate running EAST out of it two storeys up and carrying on the whole width of the next
    // tile as the roof over the dock, and a vertical screen closing that plate's outer end.
    //
    // ⚠ IT IS RECTILINEAR, AND THAT REPLACED A DRUM. The earlier cut was a flared glass cylinder
    // with a waist and a prow; what a tall building on this shore wants is a SLAB — a broad face
    // turned square-on to the quay so the bands read as bands, which is the one thing a cylinder
    // cannot do (every horizontal on a drum is an ellipse seen edge-on, so a champagne course
    // round it reads as a hoop rather than as a floor line).
    //
    // ⚠ NOTHING STANDS IN THE WATER UNDER THE PLATE, AND THAT IS A RULE ABOUT THIS BUILDING
    // RATHER THAN A STYLE CHOICE. The tile it reaches over (894,902) is the FAIRWAY — the dock
    // hall's own east exit — so boats pass under it, and the honest picture is to draw nothing on
    // the water and hang the plate off a mast instead. The end screen hangs DOWN from the plate
    // and stops well short of the surface for the same reason: a screen that reached the water
    // would be a wall across the way in.
    //
    // ⚠ EAST AND NORTH ARE NOT INTERCHANGEABLE. East is the fairway and the hulls; north is open
    // basin. A roof swept north shelters empty water and leaves the pontoon in the rain.
    //
    // ⚠ LOCAL +Y IS THE ENTRANCE SIDE (the quay, south), local -Y is open basin, +X is EAST.
    const CH = 'ty_asc_chrome', DK = 'ty_asc_chrome_dk', BLUE = 'ty_asc_pod';
    // ⚠ GOLD IS TRIM AND NEVER A FACE. `brass` is a conductor at gloss 64 — the hardest glint in
    //   the material table — worth putting on an edge and ruinous on a wall.
    const GOLD = 'ty_fw_gold';
    const metal = hfChrome([96, 112, 130], [232, 242, 250], 1.9);
    const goldSkin = hfChrome([104, 80, 38], [246, 222, 164], 1.6);

    // The slab: wide across the quay, shallow front to back.
    const HX = fh * 0.82, HY = fh * 0.56;
    // ⚠ TWO STOREYS OF NINE, WHICH IS WHERE THE PLATE GOES. `h` is the whole storey stack, so a
    //   floor is h/9 at the floor count this tile is authored with, and the plate's soffit sits on
    //   top of the second one. Written as a fraction rather than as a tile constant because every
    //   other number in an arm is a multiple of fh or h and the capture demands they stay affine.
    const FL = h / 9;
    const PLINTH = h * 0.055, PLATE = FL * 2, PLATE_T = PLATE + h * 0.052;
    const BAND1 = h * 0.335, VOID0 = h * 0.560, VOID1 = h * 0.635, TOP = h * 0.930;

    // ── THE SLAB ──────────────────────────────────────────────────────────
    // A skirt at the ground, a glazed lower block, a champagne course, a taller shaft, a recessed
    // dark storey that lets the top read as a separate thing, and the upper block over it.
    const box = (hx, hy, z0, z1, pal, sd, roof = false, cx = 0) => {
      const [bx, by] = F(cx, 0);
      draw3DBoxAt(ctx, cam, bx, by, hx, z0, z1, pal, seed + sd, night, alpha, roof, faceYaw(E), hy);
    };
    box(HX * 1.06, HY * 1.10, 0, PLINTH, DK, 1);
    box(HX, HY, PLINTH, BAND1, BLUE, 2);
    box(HX * 1.04, HY * 1.06, BAND1, BAND1 + h * 0.026, GOLD, 3);
    box(HX, HY, BAND1 + h * 0.026, VOID0, CH, 4);
    box(HX * 0.86, HY * 0.84, VOID0, VOID1, DK, 5);
    box(HX, HY, VOID1, TOP, BLUE, 6);
    box(HX * 1.04, HY * 1.06, TOP, TOP + h * 0.026, GOLD, 7);
    // ── THE CROWN ─────────────────────────────────────────────────────────
    // A shallow vault laid across the slab, which is what the top of the silhouette is for: the
    // one curve on a building of flat planes, and the thing you pick it out by from the basin.
    drawBarrelRoof(ctx, cam, F, 0, HX, HY, TOP + h * 0.026, h * 0.085, 12, alpha, [214, 222, 232]);

    // ── THE PLATE, EAST, AND IT IS THE DOCK ROOF ──────────────────────────
    // ⚠ TWO BOXES, NOT ONE. `draw3DBoxAt` clamps a half-width to 0.44 of a tile, so a single
    //   1.2-tile plate would be silently trimmed to a third of its length — it reaches from the
    //   slab's east face to the far edge of the next tile, which is more than one box may say.
    const PX0 = HX * 0.55, PX1 = 1.46, PHY = 0.42;
    const plate = (x0, x1, z0, z1, pal, sd, roof) => {
      const [px, py] = F((x0 + x1) / 2, 0);
      draw3DBoxAt(ctx, cam, px, py, (x1 - x0) / 2, z0, z1, pal, seed + sd, night, alpha, roof, faceYaw(E), PHY);
    };
    const PMID = (PX0 + PX1) / 2;
    plate(PX0, PMID, PLATE, PLATE_T, CH, 10, true);
    plate(PMID, PX1, PLATE, PLATE_T, CH, 11, true);
    // The champagne fascia along the plate's outer edge, which is what stops it reading as a raw
    // slab and is the same course the slab carries.
    plate(PX0, PMID, PLATE_T - h * 0.018, PLATE_T, GOLD, 12, false);
    plate(PMID, PX1, PLATE_T - h * 0.018, PLATE_T, GOLD, 13, false);

    // ── THE SCREEN AT THE OUTER END ───────────────────────────────────────
    // ⚠ IT GOES UP AS WELL AS DOWN, AND THE DOWN HALF NOW REACHES THE WATER. A blade standing at
    //   the end of the cantilever is what gives the plate a terminus instead of an edge, and the
    //   skirt under it is the weather screen — the basin's own wind comes down the fairway from
    //   the east.
    //
    // ⚠ IT USED TO STOP AT `PLATE - h*0.055` ON PURPOSE, AND THAT IS REVERSED HERE DELIBERATELY.
    //   The stated reason was that a screen reaching the surface is a wall across the way in, and
    //   that reasoning still holds for the FICTION — but the tile it hangs over is water and
    //   nothing draws there, so what the reader actually saw was a slab of glass stopping in mid
    //   air over open water with no support and no termination, which reads as a model that did
    //   not finish rather than as a clear passage. So it runs to z 0, the surface: a mole at the
    //   outer end of the dock, which is what a real marina puts across its own mouth.
    //
    // ⚠ 0 IS THE WATER AND NOT A GUESS. Every z in an arm is measured from the tile's own ground
    //   plane and a water tile's ground plane IS the surface, which is also why the plate's soffit
    //   height reads correctly against a hull passing under it.
    //
    // ⚠ AND THE WAY IN IS NOW THE FLANKS. The screen spans the plate's own `PHY` depth, a third of
    //   a tile, so the fairway either side of it is open; it closes the end of the dock rather
    //   than the channel. If a boat ever has to pass through THIS line, the answer is a gap cut in
    //   the middle of the skirt rather than lifting the whole thing back into the air.
    const SCREEN_LO = 0, SCREEN_HI = PLATE_T + h * 0.185;
    { const [sx, sy] = F(PX1 - 0.035, 0);
      draw3DBoxAt(ctx, cam, sx, sy, 0.035, SCREEN_LO, SCREEN_HI, BLUE, seed + 14, night, alpha, true, faceYaw(E), PHY);
      const [gx2, gy2] = F(PX1 - 0.035, 0);
      draw3DBoxAt(ctx, cam, gx2, gy2, 0.038, SCREEN_HI - h * 0.020, SCREEN_HI, GOLD, seed + 15, night, alpha, false, faceYaw(E), PHY * 1.02); }

    // ── THE MAST AND THE STAYS ────────────────────────────────────────────
    // ⚠ THIS IS WHAT REPLACES COLUMNS STANDING IN THE FAIRWAY. A cable-stayed plate is the only
    //   way to hold a cantilever this long up without putting anything in the water, and it is
    //   also the most interesting line on the building. The mast is mass; the stays are strokes,
    //   because a cable has a screen width and no world thickness. The mast stands ON the plate
    //   and clear of the slab — an earlier cut authored it inside its own host and every stay root
    //   came out in front of the building on `glself`.
    const MAST_X = PX0 + (PX1 - PX0) * 0.16, MAST_T = PLATE_T + h * 0.52;
    { const [mx, my] = F(MAST_X, 0);
      drawFacetDrum(ctx, cam, mx, my, PLATE_T, MAST_T, fh * 0.052, fh * 0.028, 10, alpha, metal, metal, CH);
      for (const sy of [-1, 1]) {
        for (const t of [1.0, 0.58]) {
          const ex = MAST_X + (PX1 - MAST_X) * t;
          emitWire(ctx, cam, W3(MAST_X, 0, MAST_T), W3(ex, sy * PHY * 0.86, PLATE_T), 1.4,
            'rgba(196,206,218,0.92)', alpha, { pull: FACE_EPS });
        }
      }
      if (night) glowPool(ctx, cam, mx, my, MAST_T, '186,240,250', 7, alpha * 0.5); }

    // ── THE NAME ──────────────────────────────────────────────────────────
    // ⚠ CUT LETTERS ON THE PLATE'S SOUTH FLANK, NEVER A BOARD. `marqueeBand` paints a DARK PLACARD
    //   with lit lettering on it — the Meltwater Row shopfront idiom, right there and wrong on a
    //   chrome-and-glass building with no black anywhere else on it. The facade's own prose has
    //   said the right thing all along — 'cut into the fascia over the doors' — so this is
    //   `emitSurfaceText`, the path The Meridian letters its frieze with. ⚠ THE LETTERS SIT BELOW
    //   THE GOLD FASCIA, which owns the bottom of the beam and stands proud of it.
    if (frontVis) {
      const lx0 = PX0 + (PX1 - PX0) * 0.06, lx1 = PX0 + (PX1 - PX0) * 0.76;
      const [alx, aly] = F(lx0, PHY), [arx, ary] = F(lx1, PHY);
      // ⚠ READING ORDER, FROM OUTSIDE. Standing south looking north, world +x is on your RIGHT, so
      //   the west end is TL. A decal is culled on its winding: wound the other way it is a sign
      //   only visible from inside the building.
      const zt = PLATE_T - h * 0.024, zb = PLATE + h * 0.008;
      const TL = cam.proj(alx, aly, zt), TR = cam.proj(arx, ary, zt),
            BR = cam.proj(arx, ary, zb), BL = cam.proj(alx, aly, zb);
      if ([TL, TR, BR, BL].every((p) => p.f > 0.12)) {
        const nam = bakeSignText(name || 'FAIRWEATHER MARINA', '#e6c98c', night ? 1 : 0, false);
        if (nam) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], nam, false, alpha);
      }
    }

    // ── THE EDGE LINES ────────────────────────────────────────────────────
    // One continuous cool line down each flank of the plate, inset into the fascia, and the same
    // line round the slab's own champagne course. The edge said in light rather than in steel.
    { const rim = PLATE_T - h * 0.006;
      for (const sy of [-1, 1]) {
        emitWire(ctx, cam, W3(PX0, sy * PHY * 1.006, rim), W3(PX1, sy * PHY * 1.006, rim), 1.5,
          night ? 'rgba(186,240,250,0.98)' : 'rgba(150,196,214,0.52)', alpha, { pull: FACE_EPS });
      }
      emitWire(ctx, cam, W3(-HX * 1.05, HY * 1.07, BAND1 + h * 0.013), W3(HX * 1.05, HY * 1.07, BAND1 + h * 0.013), 1.4,
        night ? 'rgba(232,206,150,0.92)' : 'rgba(170,150,112,0.50)', alpha, { pull: FACE_EPS });
      emitWire(ctx, cam, W3(-HX * 1.05, HY * 1.07, TOP + h * 0.013), W3(HX * 1.05, HY * 1.07, TOP + h * 0.013), 1.4,
        night ? 'rgba(232,206,150,0.92)' : 'rgba(170,150,112,0.50)', alpha, { pull: FACE_EPS }); }

    // ── THE FACES, FINNED ─────────────────────────────────────────────────
    // A glass slab with nothing on its faces reads as a coloured box from the basin. Fins down the
    // two long faces (quay and basin) divide it into bays, and a hairline at every floor between
    // the champagne courses says how tall it is. Strokes, not mass: they cost a quad each on the
    // GPU and change nothing the collision or the shadow reads.
    // ⚠ STOOD A HAIR OFF THE GLASS (FACE_EPS), or the depth test takes them.
    { const finCol = night ? 'rgba(212,236,248,0.55)' : 'rgba(210,222,232,0.75)';
      const lineCol = night ? 'rgba(186,240,250,0.40)' : 'rgba(160,184,200,0.45)';
      for (const sy of [-1, 1]) {
        const fy = sy * HY * 1.004;
        for (let k = 1; k < 8; k++) {
          const fx = -HX + (2 * HX) * (k / 8);
          emitWire(ctx, cam, W3(fx, fy, PLINTH), W3(fx, fy, BAND1), 1.2, finCol, alpha, { pull: FACE_EPS });
          emitWire(ctx, cam, W3(fx, fy, BAND1 + h * 0.026), W3(fx, fy, VOID0), 1.2, finCol, alpha, { pull: FACE_EPS });
          emitWire(ctx, cam, W3(fx, fy, VOID1), W3(fx, fy, TOP), 1.2, finCol, alpha, { pull: FACE_EPS });
        }
        for (let f = 1; f < 9; f++) {
          const z = FL * f;
          if (z < PLINTH + h * 0.01 || z > TOP - h * 0.01) continue;
          if (Math.abs(z - BAND1) < h * 0.03 || (z > VOID0 - h * 0.005 && z < VOID1 + h * 0.005)) continue;
          emitWire(ctx, cam, W3(-HX, fy, z), W3(HX, fy, z), 1.0, lineCol, alpha, { pull: FACE_EPS });
        }
      }
      // The four corners carry a continuous light up the whole slab, the marina's edge said in light.
      for (const cx of [-1, 1]) for (const cy of [-1, 1]) {
        emitWire(ctx, cam, W3(cx * HX * 1.004, cy * HY * 1.004, PLINTH), W3(cx * HX * 1.004, cy * HY * 1.004, TOP), 1.5,
          night ? 'rgba(186,240,250,0.85)' : 'rgba(180,206,222,0.55)', alpha, { pull: FACE_EPS });
      } }

    // ── THE SKY TERRACE ───────────────────────────────────────────────────
    // The recessed dark storey is a terrace, not a void: a champagne rail round its edge and a row
    // of planters along the quay side, so the thing that makes the upper block read as its own
    // building also reads as somewhere people stand.
    { const tz = VOID0 + h * 0.004;
      for (const [ax, ay, bx, by] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
        emitWire(ctx, cam, W3(ax * HX * 0.98, ay * HY * 0.98, tz + h * 0.028), W3(bx * HX * 0.98, by * HY * 0.98, tz + h * 0.028), 1.2,
          night ? 'rgba(232,206,150,0.9)' : 'rgba(196,172,124,0.8)', alpha, { pull: FACE_EPS });
      }
      for (let k = 0; k < 4; k++) {
        const [px, py] = F(-HX * 0.66 + HX * 0.44 * k, HY * 0.90);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.07, VOID0, VOID0 + h * 0.014, GOLD, seed + 40 + k, night, alpha, false, faceYaw(E), fh * 0.035);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.06, VOID0 + h * 0.014, VOID0 + h * 0.030, 'ty_greenroom', seed + 44 + k, night, alpha, true, faceYaw(E), fh * 0.028);
      } }

    // ── THE WAY IN ────────────────────────────────────────────────────────
    // A thin chrome blade over the doors on the quay face, edged in champagne, with a downlight
    // under it — what tells somebody on the quay which of the glass bays is the door.
    { const CZ = PLINTH + h * 0.05, CD = fh * 0.16;
      const [cx, cy] = F(0, HY + CD * 0.5);
      draw3DBoxAt(ctx, cam, cx, cy, HX * 0.32, CZ, CZ + h * 0.010, CH, seed + 50, night, alpha, true, faceYaw(E), CD * 0.5);
      draw3DBoxAt(ctx, cam, cx, cy, HX * 0.33, CZ + h * 0.006, CZ + h * 0.010, GOLD, seed + 51, night, alpha, false, faceYaw(E), CD * 0.52);
      glowPool(ctx, cam, cx, cy, CZ - h * 0.004, '236,226,198', 8, alpha * (night ? 0.7 : 0.15)); }

    // ── THE CROWN MAST ────────────────────────────────────────────────────
    // A slim chrome mast off the vault's apex with a red aviation light: the building is the tallest
    // thing on this stretch of shore and the helicopters that use the Glasshouse fly past it.
    { const MB = TOP + h * 0.026 + h * 0.08, MT = MB + h * 0.22;
      drawFacetDrum(ctx, cam, dx, dy, MB, MT, fh * 0.022, fh * 0.010, 8, alpha, metal, metal, CH);
      blinkLight(ctx, cam, dx, dy, MT + h * 0.005, '255,64,56', now, seed + 60, alpha, 2.2); }

    // ── THE SLOT ──────────────────────────────────────────────────────────
    // The water under the plate is the covered dock, and from a helm it read as a channel running
    // straight into Halcyon Quay: nothing said where the water stopped or where a hull lies. So the
    // two quay edges round it get a lit nosing and a chrome rail, with a gangway gap in the side
    // one, fenders on that face where a hull comes alongside, and the hoist's spreaders tucked up
    // under the soffit (the slings that lift her out, in the Dock Hall's own prose).
    // ⚠ STROKES ONLY. The arm's mass is baked (client/shared/building-shapes.js) and none of this is
    //   anything a collision should meet.
    // ⚠ THE QUAY EDGES ARE TILE EDGES, NOT THE SLAB'S FACE. The slab stands back from the edge of
    //   its own tile, so the water starts at local x 0.5 (the slot's side) and stops at local y 0.5
    //   (its head, the north edge of the quay tile).
    { const QX = 0.5, QY = 0.5, RAIL = FL * 0.34, END = PX1 - 0.07;
      const railCol = night ? 'rgba(206,224,236,0.85)' : 'rgba(198,212,224,0.95)';
      const noseCol = night ? 'rgba(120,224,255,0.9)' : 'rgba(150,196,214,0.6)';
      for (const [ax, ay, bx, by] of [[QX, -PHY, QX, -0.13], [QX, 0.13, QX, QY], [QX, QY, END, QY]]) {
        emitWire(ctx, cam, W3(ax, ay, h * 0.004), W3(bx, by, h * 0.004), 2.0, noseCol, alpha, { pull: FACE_EPS });
        emitWire(ctx, cam, W3(ax, ay, RAIL), W3(bx, by, RAIL), 1.4, railCol, alpha, { pull: DECO_PULL });
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 0.16));
        for (let i = 0; i <= n; i++) {
          const px = ax + (bx - ax) * (i / n), py = ay + (by - ay) * (i / n);
          emitWire(ctx, cam, W3(px, py, 0), W3(px, py, RAIL), 1.2, railCol, alpha, { pull: DECO_PULL });
        }
      }
      // The fenders, hung on the side face either side of the gangway, and the ladder in it.
      for (const fy of [-0.32, -0.20, 0.20, 0.32]) {
        emitWire(ctx, cam, W3(QX + 0.008, fy, -FL * 0.12), W3(QX + 0.008, fy, FL * 0.08), 5, 'rgba(30,34,40,0.95)', alpha, { pull: FACE_EPS });
      }
      for (const ly of [-0.05, 0.05]) {
        emitWire(ctx, cam, W3(QX + 0.006, ly, -FL * 0.2), W3(QX + 0.006, ly, RAIL), 1.2, railCol, alpha, { pull: FACE_EPS });
      }
      for (let r = 0; r < 4; r++) {
        const rz = -FL * 0.15 + r * FL * 0.11;
        emitWire(ctx, cam, W3(QX + 0.006, -0.05, rz), W3(QX + 0.006, 0.05, rz), 1.0, railCol, alpha, { pull: FACE_EPS });
      }
      // The hoist: two spreaders across the slot under the soffit, on their falls, raised.
      const SPR = PLATE - FL * 0.16, mid = (QX + END) / 2;
      for (const sy of [-0.13, 0.13]) {
        emitWire(ctx, cam, W3(mid - 0.17, sy, SPR), W3(mid + 0.17, sy, SPR), 2.4, 'rgba(198,158,44,0.95)', alpha, { pull: DECO_PULL });
        for (const sx of [-0.13, 0.13]) {
          emitWire(ctx, cam, W3(mid + sx, sy, PLATE - h * 0.002), W3(mid + sx, sy, SPR), 1.0, 'rgba(60,64,70,0.9)', alpha, { pull: DECO_PULL });
        }
      } }

    // ── THE LIGHT ─────────────────────────────────────────────────────────
    // ⚠ LIT HARDER THAN ITS NEIGHBOURS ON PURPOSE. The facade's prose is 'lit from inside at every
    //   hour and the light does not change colour after dark', and at the draft values it was one
    //   of the darker things on the shore after six.
    { const [dkc, dkcy] = F(PMID, 0);
      glowPool(ctx, cam, dx, dy, (PLINTH + BAND1) * 0.5, '206,230,242', 19, alpha * (night ? 0.86 : 0.18));
      glowPool(ctx, cam, dx, dy, (VOID1 + TOP) * 0.5, '212,226,238', 17, alpha * (night ? 0.88 : 0.16));
      if (night) {
        // The fairway under the plate, lit from the soffit. It is what tells a pilot the way in is
        // open rather than decked over.
        glowPool(ctx, cam, dkc, dkcy, h * 0.03, '90,190,230', 15, alpha * 0.62);
        glowPool(ctx, cam, dx, dy, 0.02, '168,208,228', 16, alpha * 0.34);
        // ── COMING IN AFTER DARK ────────────────────────────────────────
        // ⚠ SUBTLE IS THE SPEC, AND IT IS ALSO THE ONLY THING THAT WORKS. A marina lights the
        //   WATER a skipper is steering over, not the sky: a floodlit apron wrecks the night
        //   vision of the one person who needs it and turns the most expensive frontage in the
        //   quarter into a car park. So this is a run of small downlights under the soffit, each
        //   a fraction of the strength of the building's own interior glow, and nothing above.
        for (let k = 0; k < 5; k++) {
          const [lxp, lyp] = F(PX0 + (PX1 - PX0) * (0.1 + 0.8 * (k / 4)), 0);
          glowPool(ctx, cam, lxp, lyp, PLATE - h * 0.012, '236,226,198', 6, alpha * 0.30);
        }
        // ⚠ AND THE TWO THAT ARE NOT DECORATION. Red to port and green to starboard ON ENTERING,
        //   which is the rule of the road and fixes which side each one goes. ⚠ A BOAT COMES IN
        //   FROM THE BASIN SIDE (local -Y), NOT FROM THE EAST: the screen closes the east end down
        //   to the water and the Slip's concrete is beyond it, so the way in is the mouth along the
        //   plate's basin edge, past the fuel berth. Heading in toward the quay her port hand is
        //   local +X, so red stands at the screen's end of the mouth and green where the plate
        //   meets the slab. They were on the screen's two ends, which was right for a way in that
        //   is a wall.
        { const [rx, ry] = F(PX1 - 0.05, -PHY * 0.92);
          const [gx, gy] = F(HX + 0.06, -PHY * 0.92);
          glowPool(ctx, cam, rx, ry, PLATE + h * 0.010, '255,72,64', 4, alpha * 0.70);
          glowPool(ctx, cam, gx, gy, PLATE + h * 0.010, '64,255,132', 4, alpha * 0.70); }
      } }
  },
  freight_office(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // a small two-storey site office with a lit sign band and a service canopy
    // ⚠ THE COMMENT SAID TWO-STOREY AND THE MASS WAS ONE BOX. A site office is the one building
    // on a freight yard with floors in it — that is what makes it read as an office rather than
    // as another container — so the floor line is the whole point of drawing it at all.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, 0, h * 0.42, pal, seed + 3, night, alpha, false);         // ground floor
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.42, h * 0.47, pal, seed + 4, night, alpha, false);  // the floor band between them
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.95, h * 0.47, h * 0.85, pal, seed, night, alpha, false);      // upper office floor
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, h * 0.85, h * 0.92, pal, seed + 5, night, alpha, true);    // parapet
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.78, m.neon || '#ffb43a', night, alpha);   // sign band, under the parapet rather than inside it
    awning(ctx, cam, dx, dy, E, fh * 0.7, fh * 1.02, h * 0.16, h * 0.26, 'ty_door', seed + 1, night, alpha, fh * 0.30);   // service canopy
    if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,200,120', 9, alpha * 0.2);
  },
  freight_forwarder(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // a forwarding depot with a loading-dock canopy and truck bays facing the apron
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, h * 0.6, pal, seed, night, alpha, true);                 // depot shed
    awning(ctx, cam, dx, dy, E, fh * 1.02, fh * 1.22, h * 0.42, h * 0.5, 'ty_door', seed + 1, night, alpha, fh * 0.40);   // loading-dock canopy — a truck backs under this one, so it keeps real depth
    if (frontVis) for (const s of [-0.6, 0, 0.6]) { const [bx, by] = F(s * fh, fh * 1.02); draw3DBoxAt(ctx, cam, bx, by, fh * 0.28, 0, h * 0.34, 'ty_door', seed + 4 + s * 3, night, alpha, true, 0, fh * 0.05); }   // truck bays
    if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,196,120', 12, alpha * 0.18);
  },
  asc_spire(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Spire: a chrome helix twisting harder than Halcyon, in Ascendant blue,
    //                    with the calm-eye seal glowing on the plaza at its foot.
    const asc = '74,168,255';
    const baseZ = h * 0.24, topZ = h * 3.0, N = 24;
    const twist = 1.8, fwBase = fh * 0.78;
    const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
    const segW = (i) => fwBase * (1 - 0.5 * (i / N));
    const segYaw = (i) => twist * (i / N);
    glowPool(ctx, cam, dx, dy, 0.02, asc, 14, alpha * (night ? 0.5 : 0.28));                 // the calm-eye seal on the plaza
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.28, 0, baseZ, pal, seed + 4, night, alpha, true);   // podium
    { const [cx, cy] = F(0, fh * 1.04); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.8, h * 0.1, h * 0.22, 'ty_door', seed + 5, night, alpha, false); }
    for (let i = 0; i < N; i++) draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, i === N - 1, segYaw(i));
    for (const dir of [[-1, -1], [1, 1]]) {   // spiralling Ascendant-blue corner light-runners
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
        pts.push([dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i)]);
      }
      if (pts.length > 1) emitLightRunner(ctx, cam, pts, `rgba(${asc},0.9)`, alpha * (night ? 0.95 : 0.5), night, asc, undefined, DECO_PULL);   // the tie-breaker — see the ⚠ on Halcyon's runners
    }
    draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.9, topZ, topZ + h * 0.22, pal, seed + 20, night, alpha, true, twist * 1.06);   // crown
    mast(ctx, cam, dx, dy, topZ + h * 0.22, topZ + h * 0.6, alpha, now, seed);
    if (night) { glowPool(ctx, cam, dx, dy, baseZ, asc, 24, alpha * 0.3); glowPool(ctx, cam, dx, dy, topZ + h * 0.08, asc, 16, alpha * 0.3); }
    blinkLight(ctx, cam, dx, dy, topZ + h * 0.6, asc, now, seed, alpha, 2);
  },
  asc_gate(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Ascension Gate: a low fortified chrome slab — flanking pylons, two turret
    //                   housings that track (red blink), and a bright scanline across the frontage.
    const asc = '74,168,255';
    const wall = h * 0.9;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, wall, pal, seed, night, alpha, true);                        // main slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, wall, wall + h * 0.12, pal, seed + 1, night, alpha, true);       // parapet cap
    for (const s of [-1, 1]) { const [px, py] = F(s * fh * 1.0, fh * 1.0); draw3DBoxAt(ctx, cam, px, py, fh * 0.16, 0, wall * 1.25, pal, seed + 2 + (s > 0 ? 1 : 0), night, alpha, true); }   // flanking pylons
    for (const s of [-1, 1]) {   // turret housings + red tracking blink
      const [tx, ty] = F(s * fh * 0.55, fh * 0.2);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.14, wall + h * 0.12, wall + h * 0.26, 'ty_door', seed + 4 + (s > 0 ? 1 : 0), night, alpha, true);
      blinkLight(ctx, cam, tx, ty, wall + h * 0.3, '255,90,80', now, seed + (s > 0 ? 2 : 1), alpha, 1.4);
    }
    if (frontVis) { const [gx, gy] = F(0, fh * 1.06); glowPool(ctx, cam, gx, gy, wall * 0.5, asc, 12, alpha * (night ? 0.6 : 0.35)); }   // scanline wash
  },
  asc_clinic(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Chrome Clinic: a clean pale block, set-back upper, cyan clinical glow + roof emblem.
    const asc = '120,220,255';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.7, pal, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.7, h * 0.7, h * 0.9, pal, seed + 1, night, alpha, true);            // set-back upper
    { const [cx, cy] = F(0, fh * 1.02); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.7, h * 0.06, h * 0.18, 'ty_door', seed + 2, night, alpha, false); }
    roofCross(ctx, cam, dx, dy, E, h * 0.9, Math.min(fh * 0.40, h * 0.22), asc, night, alpha, { frame: [206, 224, 232] });   // roof emblem
    if (night) glowPool(ctx, cam, dx, dy, h * 0.2, asc, 12, alpha * 0.25);
  },
  asc_weave(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Weave: an open fab shed straddled by a gantry, a smoking flue, welding-spark glow.
    const spark = '255,180,90';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.6, pal, seed, night, alpha, true);                     // shed
    for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 0.95, 0); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.08, h * 0.6, h * 0.95, pal, seed + 1 + (s > 0 ? 1 : 0), night, alpha, false); }   // gantry legs
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, h * 0.88, h * 0.95, pal, seed + 3, night, alpha, false);        // gantry span
    { const [fx, fy] = F(-fh * 0.6, -fh * 0.4); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.12, h * 0.6, h * 1.1, 'ty_door', seed + 4, night, alpha, true); drawSmoke(ctx, cam, fx, fy, h * 1.1, '150,150,150', alpha * 0.4, now, seed + 5); }   // flue + smoke
    if (frontVis) { const [gx, gy] = F(0, fh * 1.0); glowPool(ctx, cam, gx, gy, 0.02, spark, 12, alpha * (night ? 0.5 : 0.3)); }   // spark spill
  },
  asc_vats(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Vats: a windowless steel drum, coolant frost-band, vent pipes, cold base breath.
    // The drum is windowless and stays windowless. A pressure vessel of this size stands on a SKIRT
    // and is closed by a COLLAR — both are rings of the same steel, and they are what stop a tank
    // reading as a cylinder somebody extruded out of the ground.
    const cold = '120,200,255';
    const steel = WALL_COL[pal] || [88, 102, 118];
    const skin = (f) => { const s = 0.5 + f.nl * 0.55; return `rgba(${steel[0] * s | 0},${steel[1] * s | 0},${steel[2] * s | 0},0.97)`; };
    const cap = night ? 'rgba(40,52,64,0.97)' : 'rgba(150,168,186,0.97)';
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.09, fh * 1.02, fh * 0.99, 12, alpha, skin, cap);           // base skirt
    drawFacetDrum(ctx, cam, dx, dy, h * 0.09, h * 1.1, fh * 0.95, fh * 0.9, 12, alpha, skin, cap);      // the drum
    drawFacetDrum(ctx, cam, dx, dy, h * 1.1, h * 1.18, fh * 0.98, fh * 0.94, 12, alpha, skin, cap);     // top collar
    for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.4, 0); draw3DBoxAt(ctx, cam, px, py, fh * 0.1, h * 1.18, h * 1.42, 'ty_door', seed + 1 + (s > 0 ? 1 : 0), night, alpha, true); }   // vent pipes
    drawRing(ctx, cam, dx, dy, h * 0.55, fh * 0.97, 12, `rgba(${cold},${night ? 0.7 : 0.35})`, 1.4, alpha);  // coolant band
    glowPool(ctx, cam, dx, dy, 0.02, cold, 14, alpha * (night ? 0.55 : 0.3));                                // cold breath at the base
  },
  asc_shrine(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Architect Shrine: a black-glass slab leaning on the Curtain, server-rack glow,
    // The slab still leans on the Curtain and the uplink is untouched. Two changes: the base and the
    // slab are STACKED rather than drawn through each other — the arm drew a 0…1.5 slab and then a
    // 0…0.2 base inside the bottom of it — and the slab is closed by a cap, so the beam leaves a
    // roof rather than the top of an extrusion.
    const asc = '74,168,255';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.2, 'ty_asc_gate', seed + 1, night, alpha, false);          // base, in the order's dark steel so the black slab stands on something
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.95, h * 0.2, h * 1.42, pal, seed, night, alpha, false);              // tall slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, h * 1.42, h * 1.5, pal, seed + 5, night, alpha, true);            // cap the beam leaves from
    { const [wx, wy] = F(-fh * 0.9, 0); glowPool(ctx, cam, wx, wy, h * 0.8, asc, 10, alpha * (night ? 0.6 : 0.35)); }   // server-rack glow, Curtain side
    mast(ctx, cam, dx, dy, h * 1.5, h * 2.1, alpha, now, seed);
    emitWire(ctx, cam, [dx, dy, h * 1.5], [dx, dy, h * 2.6], 2.4, `rgba(${asc},0.85)`,
      alpha * (night ? 0.8 : 0.4), { glow: night ? 10 : 0, glowCss: `rgb(${asc})` });   // uplink beam
    blinkLight(ctx, cam, dx, dy, h * 2.6, asc, now, seed, alpha, 2);
  },
  stimcafe(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Battery Acid Coffee Co. — a narrow cafe with the roasting drum ON THE ROOF, smoking all day
    const wallTop = h * 0.96;
    // One extrusion with a roaster on it. The drum is the character and it stays exactly where it
    // was; what the cafe under it needed was a GROUND FLOOR — a place for the awning to belong to
    // and for the pavement tables to sit against — because a narrow cafe is read from the pavement
    // and everything above the fascia is somebody's flat.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, h * 0.34, facePals(E, { side: pal, front: 'ty_shop_b' }), seed + 4, night, alpha, false);   // the cafe, glazed to the pavement
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, h * 0.34, h * 0.40, pal, seed + 5, night, alpha, false);   // fascia — where the name band goes
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, h * 0.40, wallTop, pal, seed, night, alpha, false);        // the flat above
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, wallTop, wallTop + h * 0.06, pal, seed + 6, night, alpha, true);   // the parapet the roaster stands on
    // The roaster: a riveted drum on its cradle, venting roast smoke. The whole street smells of it.
    // drawFacetDrum's 11th arg is a STYLE FUNCTION, not a palette key — passing `pal` here threw
    // "style is not a function" and killed the render loop the moment this cafe came into view.
    // Same shading idiom as asc_vats: base RGB off the palette, lit per facet normal.
    const roast = WALL_COL[pal] || [58, 54, 48];
    const roastSkin = (f) => { const s = 0.5 + f.nl * 0.55; return `rgba(${roast[0] * s | 0},${roast[1] * s | 0},${roast[2] * s | 0},0.97)`; };
    drawFacetDrum(ctx, cam, dx, dy, wallTop + h * 0.06, wallTop + h * 0.36, fh * 0.30, fh * 0.26, 10, alpha, roastSkin, night ? 'rgba(36,32,28,0.97)' : 'rgba(96,88,78,0.97)');
    drawSmoke(ctx, cam, dx, dy, wallTop + h * 0.36, '160,140,120', alpha * 0.5, now, seed + 2);
    const scSgnW = fh * 0.90, scSgnZ = h * 0.45, scRoom = { floor: h * 0.34, wallTop: h, wall: fh * 0.96 };
    reserveSignBand(scSgnW, scSgnZ, scRoom);   // nothing the kit hangs may cross the name — see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 1.00, fh * 1.08, h * 0.22, h * 0.34, 'ty_door', seed + 1, night, alpha, fh * 0.34);   // awning over the pavement tables, under the fascia
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, scSgnW, scSgnZ, m.neon || '#5fd0ff', night, alpha, 'BATTERY ACID', scRoom);
    if (night) { const [wx, wy] = F(0, fh * 0.94); glowPool(ctx, cam, wx, wy, h * 0.22, '255,205,150', 12, alpha * 0.30); }
  },
  permits(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // OFFICE OF PERMITTED SUFFERING — Ward Nine's counter, and the tile the
    // "blank signage, and the columns are over the name" report was filed against. Both halves of
    // that were one mistake: the name band sat at 62% of the elevation — the fourth floor of the
    // building, where no fascia has ever been — and the derived kit's pier rank starts above the
    // FASCIA line and runs to the crown, so it went straight through the name. A shopfront band
    // belongs over the counter it advertises, which is also the one stretch of wall the kit
    // leaves clear; see the ⚠ on `pierBot`.
    //
    // What the building is, per its own room description: a squat municipal box on the Meltwater
    // Row verge, a frontage of scuffed institutional glass, a holo-shingle over it, and a queue
    // canopy longer than the door is wide, because the waiting IS the service.
    const body = h * 1.10;
    const kerb = body * 0.05;                       // a base course, so the glass does not start at the pavement
    const head = body * 0.175;                      // the head of the counter hall's glazing
    const canZ0 = body * 0.195, canZ1 = body * 0.240;   // …and the queue canopy's deck over it
    const sgnW = fh * 0.66, sgnZ = body * 0.33;     // the holo-shingle, on the wall above the shelter
    // ⚠ THE `room` IS WHAT KEEPS THE SHINGLE OFF ITS OWN CANOPY, and it is the same trap
    // `marqueeSpan` was given a room for: every shopfront in Coldwater with both put the awning
    // through the bottom of its own sign. A canopy reaches `out` past its mounting plane, so any
    // part of a name inside the canopy's own height is simply not visible from the street whatever
    // the depth test says. Handing the deck over as the band's FLOOR fits it above rather than
    // hoping the two numbers stay apart.
    const sgnRoom = { floor: canZ1, wallTop: body };
    // ⚠ RESERVED UNCONDITIONALLY, NEVER INSIDE `frontVis` — see reserveSignBand. Where the name
    // goes is a camera-independent fact about the building; published from inside a camera test
    // it would exist on the facings that happen to show the door and not on the others, and the
    // kit feeds MESH_SINK, which `gl:mesh` holds to one face count at all four.
    // ⚠ AND WITH THE SAME `room` THE BAND IS DRAWN WITH, or the exclusion protects a stretch of
    // wall the sign is no longer on.
    reserveSignBand(sgnW, sgnZ, sgnRoom);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, 0, body, pal, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, kerb, 'ty_door', seed + 1, night, alpha, false);   // a mean base course
    // 1) THE COUNTER HALL — one run of institutional glass the width of the frontage, with the
    //    wall above it carried on nothing you can see, which is what makes a civic ground floor
    //    read as a place with a queue in it rather than as the bottom of a slab.
    if (frontVis) {
      const [gx, gy] = F(0, fh * 1.06);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.88, kerb, head, 'ty_tomb_glass', seed + 2, night, alpha, true, 0, fh * 0.05);
      // The mullions. Four, evenly, because a counter hall's glazing goes in on a grid and the
      // grid is most of why it reads as institutional rather than as a shopfront.
      for (const [i, lx] of [[0, -0.58], [1, -0.20], [2, 0.20], [3, 0.58]]) {
        const [bx, by] = F(lx * fh, fh * 1.08);
        draw3DBoxAt(ctx, cam, bx, by, fh * 0.03, kerb, head, pal, seed + 10 + i, night, alpha, false, 0, fh * 0.04);
      }
    }
    // 2) THE QUEUE CANOPY — a long low shelter running out from the door, because the waiting is
    //    the building's real function. It is longer than the entrance is wide.
    { const [cx, cy] = F(0, fh * 1.55); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.34, canZ0, canZ1, 'ty_door', seed + 3, night, alpha, false);
      for (let i = 0; i < 4; i++) { const [px, py] = F(fh * 0.26 * (i % 2 ? 1 : -1), fh * (0.95 + i * 0.30));
        draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, canZ0, 'ty_door', seed + 20 + i, night, alpha, false); } }   // canopy posts
    // 3) THE HOLO-SHINGLE. `SIGN_FASCIA` forces the lit treatment for this trade — the prose says
    //    it flickers, and a flicker is a thing only a lit sign can do.
    // ⚠ THE FLICKER IS THE WASH, NEVER THE BOARD. `marqueeBand`'s own ⚠ is explicit that nothing
    //    in its artwork may vary with time: the face is baked once per appearance and cached for
    //    the life of the page, so a flicker there would be a fresh texture every frame on the GPU
    //    side and a failed `models:diff` on the other. A `glowPool` is a sprite, collected afresh,
    //    and is the layer a failing tube belongs in.
    if (frontVis) {
      marqueeBand(ctx, cam, dx, dy, E, sgnW, sgnZ, m.neon || '#9ab08a', night, alpha, 'PERMITS · LICENCES', sgnRoom);
      // Two incommensurate sines, the house idiom, and floored well clear of dark: a tube on its
      // way out reads as a tube on its way out, and nothing here may strobe at any dose.
      const flick = 0.58 + 0.42 * Math.abs(Math.sin(now * 0.0021 + seed) * Math.sin(now * 0.0053));
      const [sx, sy] = F(0, fh * 1.04);
      glowPool(ctx, cam, sx, sy, sgnZ, '154,176,138', 9, alpha * (night ? 0.40 : 0.16) * flick);
      // The counter lights, which are on whether or not there is anybody behind the glass.
      const [cx2, cy2] = F(0, fh * 1.02); glowPool(ctx, cam, cx2, cy2, (kerb + head) * 0.5, '210,225,180', 13, alpha * (night ? 0.34 : 0.14));
    }
    // One lit window at the top, night or day: somebody up there is still processing forms.
    { const [wx, wy] = F(fh * 0.55, fh * 1.12); glowPool(ctx, cam, wx, wy, body * 0.86, '210,225,180', 5, alpha * (night ? 0.42 : 0.18)); }
  },
  rationnine(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ration Nine — a state ration depot: roller shutter, stacked crates, and a stencilled 9 the size of a door
    const wallTop = h * 0.90;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.04, 0, wallTop, pal, seed, night, alpha, true);
    { const [sx, sy] = F(0, fh * 1.06); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.62, 0, wallTop * 0.58, 'ty_door', seed + 1, night, alpha, false); }   // the roller shutter, half down
    for (let i = 0; i < 3; i++) {   // delivery crates nobody has taken in yet
      const [bx, by] = F((-0.8 + i * 0.8) * fh * 0.72, fh * 1.22);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.20, 0, h * (0.14 + 0.05 * (i & 1)), 'ty_door', seed + 8 + i, night, alpha, true);
    }
    // The stencilled 9, painted straight onto the wall as surface text — it leans and
    // foreshortens with the face, never billboards.
    if (frontVis) {
      const nhw = fh * 0.30, z0 = wallTop * 0.62, z1 = wallTop * 0.96;
      const [lx, ly] = F(-nhw - fh * 0.4, fh * 1.05), [rx, ry] = F(nhw - fh * 0.4, fh * 1.05);
      const TL = cam.proj(lx, ly, z1), TR = cam.proj(rx, ry, z1), BR = cam.proj(rx, ry, z0), BL = cam.proj(lx, ly, z0);
      if ([TL, TR, BR, BL].every(p => p.f > 0.12)) {
        const tex = bakeSignText('9', '#d8d2c0', night ? 1 : 0, false);
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha * 0.9);
      }
      marqueeBand(ctx, cam, dx, dy, E, fh * 0.96, wallTop * 0.74, m.neon || '#ffb43a', night, alpha, 'RATION NINE');
    }
    if (night) { const [wx, wy] = F(0, fh * 1.02); glowPool(ctx, cam, wx, wy, h * 0.18, '255,200,140', 10, alpha * 0.22); }
  },
};
