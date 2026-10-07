// Halcyon Fields: building-model arms for the second, third and fourth campaigns.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  DECO_PULL, TR, bakeSignText, blinkLight, clamp, draw3DBoxAt, drawFacetDrum, emitLightRunner,
  emitSurfaceText, emitWire, faceYaw, frac, glowPool, helixRunner, hfChrome, hfGlass, hoistLine,
  latticeBoom, mast, motionPhase, moveSeg, movingBox, neonBlade, roofClutter,
} from '../../windshield.js';

export const HALCYON_ARMS = {
  // ══ HALCYON FIELDS, THE SECOND CAMPAIGN ════════════════════════════════════════════════
  // Six types over fourteen plots, which is the ratio on purpose. An estate is a thing one
  // developer put up in one campaign, and what makes it read as one from a cockpit is that it
  // REPEATS — the same tower on four plots at four heights is an estate, and fourteen unique
  // buildings on fourteen plots is a high street. Every one of these arms is written against
  // `h`, which is `floors × FLOOR_Z`, so the only thing separating two plots carrying the same
  // type is `flags.floors` and the seed, and both of those live in content rather than here.
  //
  // ⚠ WHICH IS ALSO THE TRAP: get `flags.floors` right BEFORE tuning a single fraction in one
  // of these, because every z below is a share of a height the world file decides. A tower
  // authored against 18 floors and then placed on a tile that says 6 is not a short tower, it
  // is a set of proportions nobody chose.
  chrome_tower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ESTATE'S RESIDENTIAL TOWER — a glass cylinder on a chrome
    // podium, tapering, with a lit collar at every fifth floor and a mast on top. It is the
    // Halcyon Towers argument made four more times at four more heights, which is what an
    // estate is: the Ascendants did not design a building here, they designed a product.
    const podium = h * 0.06, shaft = h * 0.93, crown = h * 0.97, mast = h * 1.10;
    // 1) THE PODIUM — a wide chrome disc, oversailing the shaft, with the lobby in it.
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    // 2) THE SHAFT. A single glass drum the whole way up with a slight taper, because a
    //    perfectly parallel cylinder this tall reads as a flue rather than as a building.
    drawFacetDrum(ctx, cam, dx, dy, podium, shaft, fh * 0.66, fh * 0.56, 18, alpha, hfGlass(night), null, pal);
    // 3) THE COLLARS — a chrome band every fifth floor, which is the plant level and also the
    //    only thing that gives a smooth cylinder a scale you can count storeys against.
    for (let z = 0.24; z < 0.90; z += 0.22) {
      const r = 0.66 + (0.56 - 0.66) * (z / 0.93);
      drawFacetDrum(ctx, cam, dx, dy, h * z, h * (z + 0.014), fh * (r + 0.035), fh * (r + 0.035), 18, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
    }
    // 4) THE CROWN and the mast. ⚠ The mast is a DRUM and not the `mast` adornment, because an
    //    adornment is invisible to SHAPE_SINK — this one is 0.13 of the building's height and
    //    a pilot should collide with it.
    drawFacetDrum(ctx, cam, dx, dy, shaft, crown, fh * 0.62, fh * 0.48, 18, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, crown, mast, fh * 0.07, fh * 0.035, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    // 5) THE ENTRANCE — a chrome canopy off the front of the podium.
    { const [cx1, cy1] = F(0, fh * 0.80);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.34, fh * 0.34, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 3, alpha, 1.5);
      helixRunner(ctx, cam, dx, dy, podium + h * 0.02, shaft - h * 0.02, fh * 0.67, fh * 0.57, 1.25, 0.7854, 24, '74,168,255', night, alpha);
      glowPool(ctx, cam, dx, dy, crown - h * 0.02, '150,226,255', 13, alpha * 0.26);
      const [gx, gy] = F(0, fh * 0.82); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  chrome_slab(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ESTATE'S OFFICE BUILDING — a CRESCENT, which is the one plan
    // shape this city has nowhere at all. A slab with rounded ends is a stadium; a slab that
    // BENDS is a curve you read differently from every angle, and it is the cheapest way in
    // this renderer to make a building that does not look the same from the road as from the
    // air. Three boxes on three yaws with drums at every joint, which is how you bend a wall
    // when the only primitive you have is straight.
    const top = h * 0.88, cope = h * 0.94;
    const bend = 0.17;   // radians per segment — a gentle arc, not a dog-leg
    for (const [i, [u, v, yw]] of [[-0.62, -0.13, bend], [0, 0.05, 0], [0.62, -0.13, -bend]].entries()) {
      const [bx, by2] = F(u * fh, v * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.40, 0, top, pal, seed + i, night, alpha, false, faceYaw(E) + yw, fh * 0.34);
      // The coping over each segment, in chrome, which is what ties three boxes into one wall.
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.43, top, cope, 'ty_hf_chrome', seed + 10 + i, night, alpha, true, faceYaw(E) + yw, fh * 0.37);
    }
    // THE JOINTS. Full-height drums where the segments meet and at both ends — they hide the
    // mitre, and they are what makes the plan read as an arc rather than as three sheds.
    for (const [u, v] of [[-0.98, -0.30], [-0.31, -0.04], [0.31, -0.04], [0.98, -0.30]]) {
      const [qx, qy] = F(u * fh, v * fh);
      drawFacetDrum(ctx, cam, qx, qy, 0, cope, fh * 0.20, fh * 0.19, 12, alpha, hfChrome([86, 102, 118], [234, 244, 250], 2.2), hfChrome([98, 114, 130], [204, 218, 228], 1.4), 'ty_hf_chrome');
    }
    // THE PODIUM the whole crescent stands on, following it loosely as one wide disc.
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.05, fh * 1.00, fh * 0.98, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    // THE ROOF ARMATURE — a low chrome frame on the deck, which is what the Ascendants put on
    // everything they own and is most of what says "campus" from the air.
    { const [ax, ay] = F(0, 0); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.30, cope, cope + h * 0.07, 'ty_hf_chrome_dk', seed + 20, night, alpha, true, faceYaw(E), fh * 0.14); }
    if (night) {
      helixRunner(ctx, cam, dx, dy, top, top + h * 0.012, fh * 0.92, fh * 0.92, 1, 0, 28, '140,214,255', night, alpha);
      blinkLight(ctx, cam, dx, dy, cope + h * 0.07, '255,90,120', now, seed + 21, alpha, 1.2);
      glowPool(ctx, cam, dx, dy, h * 0.04, '130,206,255', 17, alpha * 0.22);
    }
  },
  pavilion(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ESTATE'S PARK BUILDING — a low glass dome on a chrome ring, and it
    // is the only thing in Halcyon Fields that is WIDER than it is tall. That matters more than
    // it sounds: the quarter is a stack of vertical objects, so a two-storey disc sitting in the
    // middle of them is what stops the skyline being a bar chart. Inside is planting and a
    // couple of benches and no commerce at all, which is the developer's contribution to the
    // public realm and is exactly the minimum a planning condition would have asked for.
    const ring = h * 0.20, dome = h * 0.86;
    // 1) THE RING — a chrome plinth, wide, with the whole thing standing on it.
    drawFacetDrum(ctx, cam, dx, dy, 0, ring, fh * 1.02, fh * 0.98, 20, alpha, hfChrome([116, 132, 148], [230, 240, 248], 1.8), null, 'ty_hf_chrome');
    // 2) THE DOME. ⚠ `drawFacetDrum` draws a CONE and not a sphere — `rb` to `rt` is linear —
    //    so a dome is three lifts with a decreasing radius and an increasing rate of decrease.
    //    Two lifts read as a marquee tent and four cost faces for a curve nobody can see.
    drawFacetDrum(ctx, cam, dx, dy, ring, h * 0.46, fh * 0.96, fh * 0.86, 20, alpha, hfGlass(night, [38, 72, 66]), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, h * 0.46, h * 0.70, fh * 0.86, fh * 0.62, 20, alpha, hfGlass(night, [38, 72, 66]), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, h * 0.70, dome, fh * 0.62, fh * 0.16, 20, alpha, hfGlass(night, [38, 72, 66]), null, pal);
    // 3) THE OCULUS — a chrome cap over the top of the dome, and the vent for it.
    drawFacetDrum(ctx, cam, dx, dy, dome, dome + h * 0.09, fh * 0.20, fh * 0.15, 12, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.8), hfChrome([110, 126, 142], [204, 218, 228], 1.3), 'ty_hf_ice');
    // 4) THE DOOR, cut into the ring on the entrance side, and the two benches outside it.
    { const [dx1, dy1] = F(0, fh * 0.98); draw3DBoxAt(ctx, cam, dx1, dy1, fh * 0.16, 0, ring * 0.86, 'ty_hf_deck', seed + 2, night, alpha, false, faceYaw(E), fh * 0.05); }
    for (const t of [-0.62, 0.62]) { const [bx, by2] = F(t * fh, fh * 1.14);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.20, h * 0.03, h * 0.055, 'ty_hf_chrome', seed + 30 + t * 10, night, alpha, true, faceYaw(E), fh * 0.06); }
    if (night) {
      // Lit from the floor, which is how you light planting and is why this reads green at
      // night in a quarter where everything else reads cyan.
      glowPool(ctx, cam, dx, dy, ring + h * 0.04, '140,236,186', 18, alpha * 0.30);
      glowPool(ctx, cam, dx, dy, dome, '164,242,200', 9, alpha * 0.24);
      helixRunner(ctx, cam, dx, dy, ring, ring + h * 0.012, fh * 0.99, fh * 0.99, 1, 0, 30, '120,230,176', night, alpha);
    }
  },
  sky_court(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LANDMARK — TWO TOWERS AND A BRIDGE BETWEEN THEM, which is the only
    // building in Coldwater with a hole through it above ground level. The Ascension Gate is
    // the other one with a hole in it and that one is at street level; this is the same idea
    // three hundred feet up, and ⚠ IT IS REAL TO EVERYTHING DOWNSTREAM — the mass primitives
    // are what `modelSolid` cuts CFIT collision from, so an aircraft genuinely flies UNDER the
    // link and the ground shadow falls in two pieces with a bar across them. That is the whole
    // reason it is worth building: a silhouette you can fly through is a landmark, and one you
    // merely look at is a picture.
    const podium = h * 0.07, top = h * 0.92, linkZ0 = h * 0.58, linkZ1 = h * 0.70;
    // 1) THE PODIUM both towers stand on, spanning the plot.
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([116, 132, 148], [230, 240, 248], 1.8), hfChrome([124, 140, 156], [202, 216, 226], 1.4), 'ty_hf_deck');
    // 2) THE TWO SHAFTS, unequal — the near one shorter, because two identical towers read as
    //    a mistake and a pair with a step between them reads as a composition.
    for (const [i, [u, tz]] of [[-0.50, 1.00], [0.50, 0.84]].entries()) {
      const [tx, ty2] = F(u * fh, 0);
      drawFacetDrum(ctx, cam, tx, ty2, podium, top * tz, fh * 0.40, fh * 0.35, 14, alpha, hfGlass(night), null, pal);
      drawFacetDrum(ctx, cam, tx, ty2, top * tz, top * tz + h * 0.04, fh * 0.43, fh * 0.34, 14, alpha, hfChrome([102, 118, 134], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_chrome');
      if (night) { blinkLight(ctx, cam, tx, ty2, top * tz + h * 0.04, '255,90,120', now, seed + 4 + i, alpha, 1.4);
        helixRunner(ctx, cam, tx, ty2, podium, top * tz - h * 0.03, fh * 0.41, fh * 0.36, 1.1, 0.7854 + i * 3.14, 20, '74,168,255', night, alpha); }
    }
    // 3) THE LINK. A glazed box slung between them, and the two chrome bands that carry it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.52, linkZ0, linkZ1, pal, seed + 8, night, alpha, false, faceYaw(E), fh * 0.24);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.54, linkZ1, linkZ1 + h * 0.025, 'ty_hf_chrome', seed + 9, night, alpha, true, faceYaw(E), fh * 0.26);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.54, linkZ0 - h * 0.025, linkZ0, 'ty_hf_chrome', seed + 10, night, alpha, true, faceYaw(E), fh * 0.26);
    // 4) THE ENTRANCE, between the towers at ground level — you walk in UNDER the gap.
    { const [cx1, cy1] = F(0, fh * 0.74);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.062, h * 0.082, fh * 0.44, fh * 0.44, 14, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      helixRunner(ctx, cam, dx, dy, linkZ1 + h * 0.026, linkZ1 + h * 0.034, fh * 0.55, fh * 0.55, 1, 0, 20, '150,226,255', night, alpha);
      glowPool(ctx, cam, dx, dy, (linkZ0 + linkZ1) * 0.5, '176,232,255', 12, alpha * 0.28);
      const [gx, gy] = F(0, fh * 0.76); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 13, alpha * 0.28);
    }
  },
  vertical_farm(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ESTATE FEEDS ITSELF, ALLEGEDLY — a chrome core with glazed
    // growing trays cantilevered off it in pairs, every one of them lit magenta from under the
    // tray above. ⚠ IT IS THE ONLY MAGENTA THING IN THE QUARTER and that is the same argument
    // the fire station's red is making: in a district of cyan and pearl, one object on a
    // different hue is findable from anywhere, and grow lights are the one place a pink glow is
    // the literal truth rather than a decision about mood.
    const core = h * 0.96, trays = 6;
    // 1) THE CORE — a chrome cylinder the whole height, with the lift and the water in it.
    drawFacetDrum(ctx, cam, dx, dy, 0, core, fh * 0.30, fh * 0.26, 14, alpha, hfChrome([86, 102, 118], [236, 246, 250], 2.3), hfChrome([98, 114, 130], [204, 218, 228], 1.4), 'ty_hf_chrome');
    // 2) THE TRAYS, in opposed pairs up the core, each one a shallow glazed box on a chrome
    //    shelf. They alternate axis so the stack spirals, which is what stops six identical
    //    slabs reading as a shelving unit and is also how a real one shades itself least.
    for (let i = 0; i < trays; i++) {
      const z = 0.10 + i * 0.14, ax = i % 2 === 0;
      for (const t of [-1, 1]) {
        const [u, v] = ax ? [t * 0.64, 0] : [0, t * 0.64], [tx, ty2] = F(u * fh, v * fh);
        draw3DBoxAt(ctx, cam, tx, ty2, fh * (ax ? 0.34 : 0.56), h * z, h * (z + 0.075), pal, seed + i * 4 + t, night, alpha, false, faceYaw(E), fh * (ax ? 0.56 : 0.34));
        draw3DBoxAt(ctx, cam, tx, ty2, fh * (ax ? 0.36 : 0.58), h * (z + 0.075), h * (z + 0.09), 'ty_hfv_tray', seed + 40 + i * 4 + t, night, alpha, true, faceYaw(E), fh * (ax ? 0.58 : 0.36));
        if (night) glowPool(ctx, cam, tx, ty2, h * (z + 0.03), '224,130,236', 8, alpha * 0.30);
      }
    }
    // 3) THE HEAD — the tank and the plant room, capping the core.
    drawFacetDrum(ctx, cam, dx, dy, core, core + h * 0.10, fh * 0.34, fh * 0.30, 14, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.8), hfChrome([110, 126, 142], [206, 220, 230], 1.3), 'ty_hf_ice');
    // 4) THE DOOR, at the foot of the core on the entrance side.
    { const [dx1, dy1] = F(0, fh * 0.34); draw3DBoxAt(ctx, cam, dx1, dy1, fh * 0.13, 0, h * 0.09, 'ty_hf_deck', seed + 2, night, alpha, false, faceYaw(E), fh * 0.04); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, core + h * 0.10, '255,90,120', now, seed + 7, alpha, 1.3);
      glowPool(ctx, cam, dx, dy, h * 0.02, '200,120,214', 15, alpha * 0.22);
    }
  },
  transit_halt(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE HALT — a chrome canopy over a platform up on legs, and the one
    // piece of infrastructure in the quarter that admits the estate is not finished. There is
    // no line through it. The platform is built, the canopy is up, the indicator board is
    // powered and reads the same thing every day, and the developer's own hoarding two streets
    // away shows trains on it. ⚠ It is a BUILDING rather than a mark, which is deliberate: it
    // has a room you can stand in out of the rain, and a mark has no interior to enter.
    const deck = h * 0.36, deckTop = h * 0.44, canopy = h * 0.86;
    // 1) SIX LEGS under the platform, and daylight between them.
    for (const [u, v] of [[-0.78, -0.34], [0, -0.34], [0.78, -0.34], [-0.78, 0.34], [0, 0.34], [0.78, 0.34]]) {
      const [lx, ly] = F(u * fh, v * fh);
      drawFacetDrum(ctx, cam, lx, ly, 0, deck, fh * 0.09, fh * 0.08, 9, alpha, hfChrome([74, 88, 104], [222, 234, 242], 2.4), null, pal);
    }
    // 2) THE PLATFORM — a chrome slab, oversailing.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, deck, deckTop, pal, seed, night, alpha, true, faceYaw(E), fh * 0.48);
    // 3) THE CANOPY, on four slim columns, standing clear of the platform on every side. The
    //    columns are drums so the whole thing reads as one piece of kit rather than as a shed.
    for (const [u, v] of [[-0.70, -0.30], [0.70, -0.30], [-0.70, 0.30], [0.70, 0.30]]) {
      const [cx1, cy1] = F(u * fh, v * fh);
      drawFacetDrum(ctx, cam, cx1, cy1, deckTop, canopy, fh * 0.055, fh * 0.045, 8, alpha, hfChrome([82, 98, 114], [232, 242, 248], 2.4), null, 'ty_hf_chrome');
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, canopy, canopy + h * 0.05, 'ty_hf_ice', seed + 1, night, alpha, true, faceYaw(E), fh * 0.46);
    // 4) THE WAITING ROOM — a glazed box on the platform, which is the part you can enter.
    { const [wx, wy] = F(-fh * 0.30, 0); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.30, deckTop, canopy - h * 0.06, 'ty_hft_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.26); }
    // 5) THE STAIR up to the platform from the entrance side, and the indicator board on the
    //    canopy fascia, which is the only lettering on the building.
    { const [sx1, sy1] = F(fh * 0.52, fh * 0.62);
      draw3DBoxAt(ctx, cam, sx1, sy1, fh * 0.18, 0, deckTop, 'ty_hf_chrome_dk', seed + 3, night, alpha, true, faceYaw(E), fh * 0.22); }
    if (frontVis) {
      const P = (lx1, ly1, z) => { const [wx, wy] = F(lx1, ly1); return cam.proj(wx, wy, z); };
      const z0 = canopy + h * 0.008, z1 = canopy + h * 0.045, bhw = fh * 0.62, by = fh * 0.47;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'HALCYON FIELDS', '#bfe8ff', night ? 1 : 0, false, true, true, { sub: 'SERVICE COMMENCING' });   // powered: it lights after dark
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      glowPool(ctx, cam, dx, dy, canopy - h * 0.04, '176,226,255', 14, alpha * 0.28);
      glowPool(ctx, cam, dx, dy, deck - h * 0.02, '120,196,255', 13, alpha * 0.18);
    }
  },
  // ══ HALCYON FIELDS, THE THIRD CAMPAIGN ═══════════════════════════════════════════════════
  // Eight more types on the same four values of chrome and two of glass, and the quarter's own
  // palette note is the whole brief: an estate one developer put up in one campaign looks like
  // ONE thing, so the variety cannot come out of colour. It comes out of the SILHOUETTE, which
  // is the only part of a building that survives fog, distance and a cockpit doing 180 knots.
  //
  // The second campaign's six were a cylinder, a crescent, a dome, a pair-and-a-bridge, a core
  // with trays, and a canopy on legs. What none of them is: twisted, bulged, stepped, pointed,
  // lens-shaped, arched, courtyarded, or visibly unfinished. That is the list below.
  //
  // ⚠ EVERY ONE OF THEM IS WRITTEN AGAINST `h`, WHICH IS `floors × FLOOR_Z`, so get
  // `flags.floors` right on the tile BEFORE tuning a fraction in here — the second campaign's
  // own warning, and it applies identically. A shaft authored against 16 floors and placed on a
  // tile that says 5 is not a short tower, it is a set of proportions nobody chose.
  torque_tower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE TWISTED SHAFT — a stack of floor plates each turned a few
    // degrees on the one below, so a straight tower shears as it rises and presents a different
    // plan from every side of the block. Coldwater has nothing else whose shape changes with
    // height, and that is the whole reason to build it: a twist is legible in silhouette at a
    // range where a facade is one grey shape, which is where every other kind of detail has
    // already given up.
    //
    // ⚠ THE CORE IS WHAT MAKES IT WATERTIGHT, and it is not decoration. Two boxes at different
    // yaws share their centre and nothing else, so between one lift's corner and the next one's
    // flank there is a real wedge of nothing and you can see daylight through the building. A
    // drum inside them, wider than the boxes' own half-depth, closes every one of those gaps at
    // every angle for one primitive — and it is the same drum a real one has the lifts in.
    const LIFTS = 9, TWIST = 0.115;   // radians per lift; nine of them comes to about 60° end to end
    const podium = h * 0.07, shaftTop = h * 0.94, crown = h * 0.99, tip = h * 1.09;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.94, fh * 0.90, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, shaftTop, fh * 0.36, fh * 0.30, 14, alpha, hfChrome([84, 100, 116], [214, 228, 238], 2.0), null, 'ty_hf_chrome_dk');
    for (let i = 0; i < LIFTS; i++) {
      const k = 1 - i / LIFTS * 0.22;                       // the shaft narrows as it goes up
      const z0 = podium + (shaftTop - podium) * (i / LIFTS);
      // ⚠ THE LIFTS OVERLAP IN z BY A TWELFTH. Two boxes meeting exactly at a plane and turned
      //   against each other leave a sliver of sky at every corner of every floor.
      const z1 = Math.min(shaftTop, podium + (shaftTop - podium) * ((i + 1.08) / LIFTS));
      const yw = faceYaw(E) + i * TWIST;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.44 * k, z0, z1, pal, seed + i, night, alpha, false, yw, fh * 0.36 * k);
      // The floor band at each turn: chrome, oversailing a little, and the thing that lets you
      // COUNT the twist instead of merely noticing it.
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.47 * k, z0, z0 + h * 0.012, 'ty_hf_chrome', seed + 20 + i, night, alpha, true, yw, fh * 0.39 * k);
    }
    drawFacetDrum(ctx, cam, dx, dy, shaftTop, crown, fh * 0.40, fh * 0.30, 14, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    drawFacetDrum(ctx, cam, dx, dy, crown, tip, fh * 0.06, fh * 0.03, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.80);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.062, h * 0.080, fh * 0.32, fh * 0.32, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, tip, '255,90,120', now, seed + 5, alpha, 1.5);
      // ⚠ THE RUNNER WINDS THE WAY THE BUILDING DOES, and its pitch is the building's own twist
      //   rather than a number. Wound the other way it reads as a second, contradictory spiral
      //   and takes the shear out of the silhouette entirely.
      helixRunner(ctx, cam, dx, dy, podium, shaftTop, fh * 0.54, fh * 0.44, LIFTS * TWIST / 6.2832, faceYaw(E), 22, '74,168,255', night, alpha);
      glowPool(ctx, cam, dx, dy, crown - h * 0.02, '150,226,255', 12, alpha * 0.24);
      const [gx, gy] = F(0, fh * 0.82); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  bead_tower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE BEADED SHAFT — six glazed bulges threaded on a chrome spine, each
    // pinched to a collar between them. It is the estate's cheapest tower and the one that
    // looks least like an office: the bulge is where the flats are and the pinch is where the
    // plant and the lift lobby go, which is a diagram of the plan you can read from the street.
    //
    // ⚠ `drawFacetDrum` IS A CONE, so a bulge is two of them back to back — out to the belly,
    // then in to the next neck. Written as one drum with a fat middle it is a barrel, and a
    // barrel is what a silo looks like.
    const BEADS = 6, NECK = 0.30, BELLY = 0.58;
    const podium = h * 0.06, top = h * 0.92, cap = h * 0.98, tip = h * 1.05;
    const span = (top - podium) / BEADS;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.90, fh * 0.84, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, cap, fh * 0.20, fh * 0.15, 12, alpha, hfChrome([80, 96, 112], [206, 220, 232], 2.1), null, 'ty_hf_chrome_dk');   // the spine, seen only at the pinches
    for (let i = 0; i < BEADS; i++) {
      // ⚠ THE BEADS SHRINK. Six identical bulges read as a stack of tyres rather than as a
      //   building — a tower narrows, and a bead tower has to narrow in steps.
      const k = 1 - i / BEADS * 0.30, k2 = 1 - (i + 1) / BEADS * 0.30;
      const z0 = podium + span * i, zm = z0 + span * 0.52, z1 = z0 + span;
      drawFacetDrum(ctx, cam, dx, dy, z0, zm, fh * NECK * k, fh * BELLY * k, 16, alpha, hfGlass(night), null, pal);
      drawFacetDrum(ctx, cam, dx, dy, zm, z1, fh * BELLY * k, fh * NECK * k2, 16, alpha, hfGlass(night), null, pal);
      // The collar at the pinch, chrome and standing proud of the neck, so the waist reads as a
      // joint rather than as glass that happens to be narrow there.
      drawFacetDrum(ctx, cam, dx, dy, z0 - h * 0.008, z0 + h * 0.012, fh * (NECK * k + 0.05), fh * (NECK * k + 0.05), 16, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
      if (night) glowPool(ctx, cam, dx, dy, zm, '150,214,255', 9, alpha * 0.16);   // one wash per bead, so the stack is countable after dark
    }
    drawFacetDrum(ctx, cam, dx, dy, cap, tip, fh * 0.05, fh * 0.025, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx2, cy2] = F(0, fh * 0.76);
      drawFacetDrum(ctx, cam, cx2, cy2, h * 0.055, h * 0.072, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, tip, '255,90,120', now, seed + 7, alpha, 1.4);
      const [gx, gy] = F(0, fh * 0.78); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },
  cascade_block(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE STEPPED TERRACES — four masses of falling height, each one
    // further forward than the one behind it, so the building comes down to the pavement in
    // stages instead of standing on it. Every terrace is planted, which is the thing the
    // brochure sells and the thing the service charge is actually for.
    //
    // ⚠ THE STEPS GO TOWARD THE ENTRANCE AND NOWHERE ELSE. A cascade that steps down on all
    // four sides is a ziggurat, which is a different building and a symmetrical one — the whole
    // point of this arm is that it has a front and a back, so the terraces face the street and
    // the tall mass sits at the rear of the plot where it shades its own back yard.
    const STEPS = [
      [-0.34, 0.98, 0.26],   // [local y of the mass centre, top as a share of h, half-depth]
      [-0.04, 0.74, 0.22],
      [0.24, 0.50, 0.19],
      [0.50, 0.28, 0.16],
    ];
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.045, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    for (const [i, [ly, tz, fd]] of STEPS.entries()) {
      const [bx, by2] = F(0, ly * fh), top = h * tz;
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.42, h * 0.045, top, pal, seed + i, night, alpha, false, faceYaw(E), fh * fd);
      // THE TERRACE SLAB, oversailing the glass below it on every side. This is the part that
      // reads: a stack of boxes is a stack of boxes, and a stack of boxes with a lip on each
      // one is a building with balconies.
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.48, top, top + h * 0.022, 'ty_hf_chrome', seed + 10 + i, night, alpha, true, faceYaw(E), fh * (fd + 0.07));
      // ⚠ THE ROUNDED ENDS ARE WHAT PUT THIS BUILDING IN THIS QUARTER. Without them it is a
      //   stepped block, which is a shape every city has; the drums at both ends of every
      //   terrace are the same trick `chrome_slab` uses to bend a wall, spent on softening a
      //   corner instead.
      for (const t of [-1, 1]) {
        const [qx, qy] = F(t * fh * 0.42, ly * fh);
        drawFacetDrum(ctx, cam, qx, qy, h * 0.045, top + h * 0.022, fh * (fd + 0.05), fh * (fd + 0.05), 12, alpha, hfChrome([96, 112, 128], [234, 244, 250], 2.0), hfChrome([106, 122, 138], [204, 218, 228], 1.4), 'ty_hf_chrome');
      }
      if (night) {
        // Planting, lit from the slab below it — green, which in this quarter means vegetation
        // and nothing else. Five cyan buildings and one green terrace is a garden; five green
        // terraces would be a colour scheme.
        const [px, py] = F(0, (ly + fd + 0.05) * fh);
        glowPool(ctx, cam, px, py, top + h * 0.03, '140,232,182', 8, alpha * 0.22);
      }
    }
    { const [cx3, cy3] = F(0, fh * 0.74);
      drawFacetDrum(ctx, cam, cx3, cy3, h * 0.05, h * 0.068, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      const [gx, gy] = F(0, fh * 0.76); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
      glowPool(ctx, cam, dx, dy, h * 0.02, '130,206,255', 15, alpha * 0.16);
    }
  },
  glass_prism(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SPIRE THAT IS NOT THE SPIRE — a six-sided glass shaft drawn out
    // to an actual point. Every tall thing in Coldwater ends in a flat roof with plant on it,
    // including the Ascendant Spire, which is a lit drum with a cap; this one ends in nothing
    // at all, and a needle on a skyline of flat tops is findable from anywhere in the Basin.
    //
    // ⚠ SIX FACETS, NOT EIGHTEEN, AND THAT IS THE BUILDING. A drum with enough sides is a
    // cylinder and reads as one; at six you can see the arrises, the light steps hard from one
    // face to the next as the camera swings, and the thing reads as CUT rather than rolled. It
    // is also the only reason the point at the top is legible — an eighteen-facet cone tapering
    // to zero is a pencil, and a six-facet one is a crystal.
    const plinth = h * 0.06, shaft = h * 0.78, spire = h * 1.18;
    drawFacetDrum(ctx, cam, dx, dy, 0, plinth, fh * 0.92, fh * 0.84, 12, alpha, hfChrome([114, 130, 146], [228, 240, 246], 1.8), hfChrome([124, 140, 154], [202, 216, 226], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, plinth, shaft, fh * 0.76, fh * 0.34, 6, alpha, hfGlass(night), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, shaft, spire, fh * 0.34, fh * 0.012, 6, alpha, hfGlass(night), null, pal);
    // THE ARRIS FINS — one chrome sliver up each of the six corners, stopping where the spire
    // starts. They are what stop a tinted cone reading as a single dark shape at dusk, and they
    // are boxes rather than strokes so they are in the mesh and a pilot collides with the shape
    // he can see.
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * 6.2832 + 6.2832 / 12;
      const rm = fh * 0.55;
      draw3DBoxAt(ctx, cam, dx + Math.cos(a) * rm, dy + Math.sin(a) * rm, fh * 0.035, plinth, shaft, 'ty_hf_chrome', seed + i, night, alpha, false, a, fh * 0.035);
    }
    { const [cx4, cy4] = F(0, fh * 0.78);
      drawFacetDrum(ctx, cam, cx4, cy4, h * 0.052, h * 0.070, fh * 0.34, fh * 0.34, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      // ⚠ THE AVIATION LIGHT IS BELOW THE POINT, not on it. There is nothing at the tip wide
      //   enough to bolt a fitting to, and a red light floating a storey above the building is
      //   the one thing that would make the point look like a mistake.
      blinkLight(ctx, cam, dx, dy, shaft + (spire - shaft) * 0.82, '255,90,120', now, seed + 9, alpha, 1.6);
      helixRunner(ctx, cam, dx, dy, plinth, shaft, fh * 0.78, fh * 0.36, 0, faceYaw(E), 12, '120,206,255', night, alpha);
      glowPool(ctx, cam, dx, dy, shaft, '164,230,255', 11, alpha * 0.22);
      const [gx, gy] = F(0, fh * 0.80); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  atrium_court(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LOW ONE — two curved wings round a glazed drum, and it is
    // WIDER THAN IT IS TALL on purpose. The quarter is a bar chart: every type in the second
    // campaign but the pavilion goes up, and a district made only of vertical objects has no
    // ground to it. This is the shape that gives the towers something to stand next to.
    const wingTop = h * 0.62, wingCope = h * 0.68, drumTop = h * 0.88, lantern = h * 0.97;
    // 1) THE ATRIUM — a glazed drum through the middle, taller than the wings, with a chrome
    //    lantern on it. What you are looking at is the roof of the space between the wings.
    drawFacetDrum(ctx, cam, dx, dy, 0, drumTop, fh * 0.46, fh * 0.42, 18, alpha, hfGlass(night, [70, 102, 128]), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, drumTop, lantern, fh * 0.30, fh * 0.16, 18, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    // 2) THE TWO WINGS, set on opposed yaws so they close round the drum like a pair of hands.
    //    Each one gets a drum at its outer end, which is the crescent's trick and the reason
    //    this reads as curved rather than as two sheds either side of a silo.
    for (const [i, [u, v, yw]] of [[-0.62, 0.16, 0.30], [0.62, 0.16, -0.30]].entries()) {
      const [bx, by2] = F(u * fh, v * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.34, 0, wingTop, pal, seed + i, night, alpha, false, faceYaw(E) + yw, fh * 0.28);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.38, wingTop, wingCope, 'ty_hf_chrome', seed + 4 + i, night, alpha, true, faceYaw(E) + yw, fh * 0.32);
      const [qx, qy] = F((u < 0 ? -1 : 1) * fh * 0.94, -fh * 0.06);
      drawFacetDrum(ctx, cam, qx, qy, 0, wingCope, fh * 0.26, fh * 0.24, 14, alpha, hfChrome([92, 108, 124], [234, 244, 250], 2.1), hfChrome([102, 118, 134], [204, 218, 228], 1.4), 'ty_hf_chrome');
    }
    // 3) THE PODIUM the whole thing stands on, and the canopy over the way in between the wings.
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.04, fh * 1.04, fh * 1.00, 20, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    { const [cx5, cy5] = F(0, fh * 0.84);
      drawFacetDrum(ctx, cam, cx5, cy5, h * 0.046, h * 0.064, fh * 0.42, fh * 0.42, 14, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      // ⚠ THE ATRIUM IS LIT FROM INSIDE AND THE WINGS ARE NOT. That asymmetry is the whole
      //   night read: a lantern standing over two dark arms says "one big room and offices
      //   round it", which is what the building is. Washing all three equally says nothing.
      glowPool(ctx, cam, dx, dy, drumTop - h * 0.10, '186,234,255', 16, alpha * 0.34);
      glowPool(ctx, cam, dx, dy, lantern, '206,242,255', 9, alpha * 0.26);
      helixRunner(ctx, cam, dx, dy, wingCope, wingCope + h * 0.012, fh * 1.02, fh * 1.02, 1, 0, 30, '140,214,255', night, alpha);
      const [gx, gy] = F(0, fh * 0.86); glowPool(ctx, cam, gx, gy, h * 0.03, '206,238,255', 12, alpha * 0.30);
    }
  },
  lens_hall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LENS — a glazed disc lying on a ring of chrome pylons, thickest
    // through the middle and drawn to an edge all round. It is the only building in Coldwater
    // whose widest point is off the ground, and from the air it is the only round thing that is
    // round the OTHER way: every drum in the quarter is a circle in plan, and this is a circle
    // in section.
    //
    // ⚠ TWO CONES BASE TO BASE, WHICH IS WHAT A LENS IS. One drum with a big bottom and a small
    // top is a cooling tower; the whole read depends on the underside sloping the other way,
    // and on being able to SEE the underside, which is what the pylons are for.
    const legTop = h * 0.30, eq = h * 0.54, lensTop = h * 0.78, boss = h * 0.88;
    // 1) THE PYLONS — six of them on a ring, and daylight between them. Wider apart than they
    //    need to be, because the gap is the point.
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * 6.2832 + 0.52, r = fh * 0.56;
      drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, 0, legTop, fh * 0.075, fh * 0.060, 9, alpha, hfChrome([78, 94, 110], [226, 238, 246], 2.4), null, 'ty_hf_chrome_dk');
    }
    // 2) THE LENS. Up from the ring to the equator, then in to the rim.
    drawFacetDrum(ctx, cam, dx, dy, legTop, eq, fh * 0.34, fh * 1.02, 24, alpha, hfGlass(night, [70, 102, 128]), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, eq, lensTop, fh * 1.02, fh * 0.30, 24, alpha, hfGlass(night, [70, 102, 128]), null, pal);
    // 3) THE RIM BAND at the equator, chrome, standing proud of the glass on both sides. It is
    //    the one horizontal on the building and it is what stops the two cones reading as a
    //    diamond.
    drawFacetDrum(ctx, cam, dx, dy, eq - h * 0.018, eq + h * 0.018, fh * 1.06, fh * 1.06, 24, alpha, hfChrome([96, 112, 128], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
    // 4) THE BOSS on top — the plant, the lift head and whatever the glass hangs from.
    drawFacetDrum(ctx, cam, dx, dy, lensTop, boss, fh * 0.30, fh * 0.22, 16, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    // 5) THE WAY IN — a stair core up to the underside, on the entrance side, because there is
    //    no ground floor to have a door in.
    { const [sx1, sy1] = F(0, fh * 0.42);
      drawFacetDrum(ctx, cam, sx1, sy1, 0, legTop + h * 0.04, fh * 0.22, fh * 0.20, 14, alpha, hfChrome([116, 132, 148], [230, 240, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome'); }
    if (night) {
      // ⚠ LIT FROM UNDERNEATH. Every other building in the quarter throws its light out of a
      //   window or down onto its own forecourt; this one is a disc on legs with nothing under
      //   it, so the only place a lamp can go is up into the soffit — which also makes it the
      //   one building here you can find by the light on the ground around it.
      glowPool(ctx, cam, dx, dy, legTop - h * 0.02, '176,232,255', 20, alpha * 0.30);
      glowPool(ctx, cam, dx, dy, eq, '196,238,255', 14, alpha * 0.26);
      helixRunner(ctx, cam, dx, dy, eq + h * 0.019, eq + h * 0.028, fh * 1.07, fh * 1.07, 1, 0, 34, '150,226,255', night, alpha);
      blinkLight(ctx, cam, dx, dy, boss, '255,90,120', now, seed + 11, alpha, 1.2);
    }
  },
  chrome_arch(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ARCH — two legs that lean together and meet, with nothing under
    // them but the road. It is the quarter's second building with a hole in it and the first
    // one you can WALK through: `sky_court`'s gap is three hundred feet up and this one starts
    // at the pavement, so the hole is a thing you use rather than a thing you notice.
    //
    // ⚠ A LEG IS A STACK OF SHORT BOXES BECAUSE THERE IS NO WAY TO TILT ONE. `draw3DBoxAt`
    // extrudes vertically and `yaw` only spins a box about z, so a leaning member has to be
    // approximated — and a parabola sampled at ten lifts is indistinguishable from a curve at
    // any range this is seen from, which is the same argument the cliff faces make.
    // ⚠ THE LIFTS OVERLAP, for the twisted shaft's reason: consecutive boxes at different x
    // meeting exactly at a plane leave a notch on the outside of the curve at every joint.
    // ⚠ THE LEGS STOP SHORT OF THE APEX AND THE KEY SWALLOWS THE REST, which is the fix for the
    // one thing this construction gets visibly wrong. A parabola is nearly HORIZONTAL at its
    // crown, so up there each lift steps sideways further than a leg is wide however many lifts
    // you use — a staircase of notches exactly where the eye goes. Below `T_MAX` the curve is
    // steep enough that a fat overlapping drum bridges its own step; above it, there is one box.
    const LIFTS = 14, SPAN = 0.86, T_MAX = 0.84, apex = h * 0.92, crown = h * 1.00;
    const legX = (t) => SPAN * (1 - t * t);     // the parabola, in footprint units
    const legW = (t) => 0.150 - 0.075 * t;      // …and it thins as it rises, which is what an arch does
    for (let i = 0; i < LIFTS; i++) {
      const t0 = T_MAX * i / LIFTS, t1 = T_MAX * (i + 1) / LIFTS;
      // ⚠ EACH LIFT OVERLAPS HALF THE NEXT ONE. Butted exactly at a plane, two drums at
      //    different x leave a step you can see the sky through on the outside of the curve; run
      //    long and interpenetrating, the one in front of the joint hides it.
      const z0 = apex * t0, z1 = apex * Math.min(T_MAX, t1 + T_MAX * 0.5 / LIFTS);
      const xm = (legX(t0) + legX(t1)) / 2, w = legW((t0 + t1) / 2);
      for (const s of [-1, 1]) {
        const [lx, ly] = F(s * xm * fh, 0);
        drawFacetDrum(ctx, cam, lx, ly, z0, z1, fh * w, fh * legW(t1), 10, alpha, hfChrome([96, 112, 128], [236, 246, 250], 2.0), null, 'ty_hf_chrome');
      }
    }
    // THE KEY — one box across the top where the two legs arrive, and the glazed room in it.
    // The arch is structure and this is the only part of it anybody occupies. ⚠ IT IS WIDE
    // ENOUGH TO REACH THE LEGS: half-width 0.30 against a leg centred at legX(T_MAX) = 0.25, so
    // the last lift lands inside the box rather than beside it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.30, apex * T_MAX - h * 0.05, apex, pal, seed, night, alpha, false, faceYaw(E), fh * 0.14);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.34, apex, crown, 'ty_hf_chrome', seed + 1, night, alpha, true, faceYaw(E), fh * 0.17);
    // THE FEET — a pad under each leg, wider than the leg, which is what stops the thing
    // reading as though it had been pushed into the ground.
    for (const s of [-1, 1]) {
      const [px, py] = F(s * SPAN * fh, 0);
      drawFacetDrum(ctx, cam, px, py, 0, h * 0.05, fh * 0.21, fh * 0.17, 12, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    }
    if (night) {
      blinkLight(ctx, cam, dx, dy, crown, '255,90,120', now, seed + 13, alpha, 1.5);
      // A runner up the inside of each leg, which is the only way to light an arch without
      // putting a lamp where somebody has to walk under it.
      //
      // ⚠ IT FOLLOWS THE PARABOLA, WHICH `helixRunner` CANNOT DO. That helper interpolates a
      // radius between two heights about ONE fixed centre, so asked to light a leaning leg it
      // draws a straight vertical line at whatever x you hand it — which on this building is
      // not the leg at all but a rod standing in the middle of the opening, with the arch dark
      // behind it. The points are the leg's own, and `emitLightRunner` is what `helixRunner`
      // calls anyway, so this is the same stroke with an honest path under it.
      for (const s of [-1, 1]) {
        // ⚠ ON THE LEG'S INNER FACE, NOT ITS CENTRELINE. A leg is a drum about a tenth of a
        //    tile across, so a runner on its axis is buried inside it and `DECO_PULL` has to
        //    drag the whole line out through the front of its own mass to be seen at all —
        //    which `glself` counts, correctly, as a stroke coming out in front of its host
        //    (54 points on this one arm). Laid on the surface it merely has to win a tie.
        const pts = [];
        for (let i = 0; i <= LIFTS; i++) {
          const t = T_MAX * i / LIFTS;
          const [lx, ly] = F(s * (legX(t) - legW(t) * 0.55) * fh, legW(t) * 0.82 * fh);
          pts.push([lx, ly, apex * t]);
        }
        emitLightRunner(ctx, cam, pts, 'rgba(110,200,255,0.9)', alpha * (night ? 0.95 : 0.55), night, '110,200,255', undefined, DECO_PULL);
      }
      glowPool(ctx, cam, dx, dy, apex - h * 0.06, '186,234,255', 12, alpha * 0.30);
      glowPool(ctx, cam, dx, dy, h * 0.02, '130,206,255', 17, alpha * 0.18);
    }
  },
  shell_tower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // TOPPED OUT, NOT FITTED OUT — a tower clad as far as the money went
    // and bare floor plates the rest of the way, with the crane still standing beside it. It is
    // the one type in the quarter that admits what the district blurb has said all along:
    // Halcyon Fields is a building site with a sales suite on it.
    //
    // ⚠ IT IS THE ONLY DARK THING HERE AND THAT IS THE JOB. `models:quality` counts fourteen
    // models in the whole registry that emit nothing after dark, and a quarter where every
    // single object glows has no depth to it — the lit ones only read as lit because something
    // beside them is not. A shell has two work lamps and an aviation light on the crane, and
    // that is all it is allowed.
    // ⚠ HOW FAR THE GLASS GOT IS SEEDED, AND THE CRANE FOLLOWS FROM IT. A fixed fraction made
    // eleven identical machines standing over eleven identically half-clad towers, which reads
    // as one building repeated rather than as a site — and eleven bright yellow lattice masts is
    // a great deal of noise in a quarter whose whole palette argument is that it is narrow. A
    // shell whose cladding has nearly caught up has had its crane taken down, because that is
    // the order the work actually happens in, so the fleet thins as the phase finishes.
    const clad = 0.34 + frac(seed * 1.7 + 0.31) * 0.44;   // the fraction of the shaft the glass reached
    const podium = h * 0.05, cladTop = h * (0.05 + (0.88 - 0.05) * clad), shaftTop = h * 0.88;
    const PLATES = Math.max(3, Math.round((1 - clad) * 13));
    const craneUp = clad < 0.68;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([104, 118, 132], [214, 226, 236], 1.8), hfChrome([112, 126, 140], [190, 204, 214], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, podium, shaftTop, fh * 0.26, fh * 0.22, 12, alpha, hfChrome([74, 88, 102], [196, 210, 222], 2.1), null, 'ty_hf_chrome_dk');   // the lift core, which goes up first and is the only part that is finished
    drawFacetDrum(ctx, cam, dx, dy, podium, cladTop, fh * 0.62, fh * 0.56, 16, alpha, hfGlass(night), null, pal);
    // ⚠ THE BARE FLOORS ARE SLABS WITH AIR BETWEEN THEM, and the air is the whole read. A
    //   stack of plates on a core says "no walls yet" at a glance from a mile off; the same
    //   floors drawn as one dull box say "a building somebody painted grey".
    for (let i = 0; i < PLATES; i++) {
      const z = cladTop + (shaftTop - cladTop) * (i / PLATES);
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.016, fh * 0.58, fh * 0.58, 16, alpha, hfChrome([92, 102, 112], [178, 190, 200], 1.5), hfChrome([98, 108, 118], [162, 174, 184], 1.2), 'ty_hf_slab');
    }
    // THE HOARDING — a low box round the foot, wider than the podium, printed on the street
    // side with the building that is going to be here. It is also why there is no door.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.055, 'ty_hf_ice', seed + 2, night, alpha, true, faceYaw(E), fh * 0.96);
    // THE TOWER CRANE, standing off the corner of the plot and tied to the core. ⚠ Everything
    // that MOVES here is strokes and decals rather than mass: `motionPhase` is parked during
    // either capture, so a jib built out of boxes would be collided and meshed at whatever
    // angle `now = 1000` happened to put it, for ever. See the ⚠ on `movingBox`.
    //
    // ⚠ THE MAST IS A BOX IN `ty_junk_crane`, NOT `latticeTower`. That helper is strokes only, it
    // records no mass, and it returns below ADORN_RICH, so past close range the mast vanished while
    // the cab and jib (which draw at every tier) went on hanging in the air with nothing under
    // them. `ty_junk_crane` is in LATTICE_CUT, so the box is see-through lattice on both
    // renderers, draws whenever the building does, and is mass the CFIT sweep can hit.
    const mastTop = shaftTop + h * 0.16;
    const [mx1, my1] = F(-fh * 0.78, -fh * 0.72);
    if (craneUp) {
      draw3DBoxAt(ctx, cam, mx1, my1, fh * 0.065, 0, mastTop, 'ty_junk_crane', seed + 41, night, alpha, true, faceYaw(E));
      blinkLight(ctx, cam, mx1, my1, mastTop + fh * 0.26, '255,80,80', now, seed, alpha, 1.8);
    }
    if (craneUp) { const ph = motionPhase(now, seed + 19, 38000, 0.40), u = ph < 0 ? 0 : ph;
      // The programme: slew out over the plot, pay out, take a load, lift, slew back over the
      // core, set down, stand. Every movement starts and ends at u = 0, which is what makes
      // `RENDER_TUNE.motion = 0` free — parked is simply this evaluated at zero.
      let slew = moveSeg(u, 0.00, 0.16, 0, 0.62);
      slew = moveSeg(u, 0.54, 0.70, slew, -0.28);
      slew = moveSeg(u, 0.90, 1.00, slew, 0);
      let tr = moveSeg(u, 0.16, 0.32, 0.44, 0.90);
      tr = moveSeg(u, 0.70, 0.84, tr, 0.50);
      let hk = moveSeg(u, 0.16, 0.32, 0.88, 0.04);
      hk = moveSeg(u, 0.38, 0.54, hk, 0.88);
      hk = moveSeg(u, 0.70, 0.84, hk, 0.34);
      hk = moveSeg(u, 0.86, 0.94, hk, 0.88);
      const laden = u > 0.35 && u < 0.86;
      const REACH = Math.min(Math.max(fh * 1.30, mastTop * 0.48), 2.2);
      const th = Math.PI / 2 + slew, ct = Math.cos(th), st = Math.sin(th);
      const at = (r) => F(-fh * 0.78 + ct * r, -fh * 0.72 + st * r);
      const thW = th + faceYaw(E);   // ⚠ the same bearing in WORLD terms, for everything that TURNS
      const jibZ0 = mastTop - h * 0.02, jibZ1 = jibZ0 - REACH * 0.16, RISE = REACH * 0.09;
      const tip = at(REACH), heel = at(REACH * 0.10), tail = at(-fh * 0.58);
      const STEEL = 'rgba(126,134,146,0.95)', PAINT = [176, 150, 62];
      movingBox(ctx, cam, mx1, my1, mastTop, mastTop + fh * 0.26, fh * 0.26, fh * 0.17, PAINT, alpha, night, thW);
      movingBox(ctx, cam, tail[0], tail[1], mastTop - fh * 0.04, mastTop + fh * 0.23, fh * 0.10, fh * 0.09, [88, 92, 98], alpha, night, thW);
      latticeBoom(ctx, cam, [heel[0], heel[1], jibZ0], [tip[0], tip[1], jibZ1], RISE,
        Math.round(clamp(REACH / 0.22, 5, 14)), 2.2, STEEL, alpha, night);
      emitWire(ctx, cam, [tail[0], tail[1], mastTop + fh * 0.23], [tip[0], tip[1], jibZ1 + RISE], 1.1, 'rgba(70,76,84,0.9)', alpha, { pull: 0 });
      const car = at(REACH * (0.10 + tr * 0.88)), carZ = jibZ0 + (jibZ1 - jibZ0) * tr;
      movingBox(ctx, cam, car[0], car[1], carZ - fh * 0.10, carZ, fh * 0.06, fh * 0.055, [96, 102, 112], alpha, night, thW);
      const hookLo = h * 0.08 + fh * 0.10, hookZ = hookLo + (carZ - fh * 0.26 - hookLo) * hk;
      hoistLine(ctx, cam, car[0], car[1], carZ - fh * 0.10, hookZ, fh, alpha, night,
        laden ? { h: fh * 0.28, hx: fh * 0.13, hy: fh * 0.12, rgb: [150, 156, 166] } : null, thW);
      blinkLight(ctx, cam, tip[0], tip[1], jibZ1 + RISE, '255,90,70', now, seed + 3, alpha, 1.5);
      if (night) glowPool(ctx, cam, car[0], car[1], carZ - fh * 0.12, '255,214,150', 7, alpha * 0.26);
    }
    if (night) {
      // Two work lamps on the top deck and nothing else. The clad floors are dark because
      // nobody has moved in and the bare ones are dark because there is nothing to light.
      blinkLight(ctx, cam, dx, dy, shaftTop, '255,90,120', now, seed + 21, alpha, 1.3);
      glowPool(ctx, cam, dx, dy, shaftTop + h * 0.01, '255,226,176', 8, alpha * 0.20);
    }
  },
  // ══ HALCYON FIELDS, THE FOURTH CAMPAIGN — ONE BUILDING, ONE SILHOUETTE ═══════════════════
  // The third campaign gave the quarter fourteen types for sixty-nine plots, so forty-two of
  // those plots were drawing a building somebody else was already drawing. That is fine on a
  // street of shops and wrong on a skyline: a quarter whose whole variety argument is the
  // SILHOUETTE cannot have six towers with one outline between them, and from the boulevard
  // you could stand at a spot where three identical shells stood in a row.
  //
  // These bind by NAME rather than by type, which is the rule `modelFor` already follows and is
  // what lets the type arm stay exactly where it is: every type keeps the one building that
  // best exemplifies it and the rest get their own. Nothing in `content/` changed, no tile
  // moved, no map icon is new — a map glyph says what a building IS FOR and all of these are
  // still the programme their type says they are.
  //
  // ⚠ NO NEW COLOURS, WHICH IS THE PALETTE BLOCK'S OWN RULE AND THE REASON THIS IS SAFE TO DO
  // AT THIS SCALE. Four values of chrome and two of glass across forty-two more buildings; an
  // estate one developer put up in one campaign has to go on looking like one thing, and the
  // only way to add this much variety without the quarter coming apart is to spend all of it on
  // shape. A forty-third palette key would undo every one of them at once.
  //
  // ⚠ AND EVERY ONE IS WRITTEN AGAINST `h`, the third campaign's warning and the second's before
  // it: `h` is `floors × FLOOR_Z` off the tile, so the proportions here are proportions and not
  // heights. Check `flags.floors` before tuning a fraction.

  // ── THE SITE. Eleven plots carry `shell_tower`, and a building site is the one subject in this
  // quarter with real variety in it for free: work stops at a different place on every plot, and
  // WHERE it stopped is a shape. The type arm keeps the commonest case — clad from the bottom to
  // wherever the money reached, crane alongside — and these are ten other places to stop.
  // ⚠ THEY STAY THE DARK ONES. `shell_tower`'s own note is that fourteen models in the registry
  // emit nothing after dark and that a quarter where everything glows has no depth to it. Ten
  // more lit towers would have deleted that, so every arm below is work lamps and nothing else.
  hf_frame(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // NOTHING BUT THE FRAME — no cladding anywhere, so you see the whole
    // structure at once: four corner columns, a core, and the floor plates stacked between
    // them with daylight through every one. It is the earliest thing on the site that is
    // already tower-shaped, and from a mile off it is a tower you can see the sky through,
    // which nothing else in Coldwater is.
    const podium = h * 0.04, top = h * 0.90, FLOORS = 14;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.94, fh * 0.90, 16, alpha, hfChrome([104, 118, 132], [214, 226, 236], 1.8), hfChrome([112, 126, 140], [190, 204, 214], 1.4), 'ty_hf_deck');
    // The core, which goes up first and is the only part of a shell that is ever finished.
    drawFacetDrum(ctx, cam, dx, dy, podium, top + h * 0.04, fh * 0.24, fh * 0.21, 12, alpha, hfChrome([74, 88, 102], [196, 210, 222], 2.1), hfChrome([80, 94, 108], [178, 190, 202], 1.4), 'ty_hf_chrome_dk');
    // The four columns. ⚠ THEY TAPER, because a column carries the floors above it and there
    // are fewer of those at the top — and because four parallel sticks read as scaffolding.
    for (const [u, v] of [[-0.62, -0.58], [0.62, -0.58], [-0.62, 0.58], [0.62, 0.58]]) {
      const [px, py] = F(u * fh, v * fh);
      drawFacetDrum(ctx, cam, px, py, podium, top, fh * 0.085, fh * 0.062, 8, alpha, hfChrome([88, 100, 112], [198, 210, 220], 1.9), null, 'ty_hf_slab');
    }
    // The plates. Every one the same, which is the point: an unfinished tower is a diagram of
    // its own repetition and a finished one hides it behind a facade.
    for (let i = 0; i <= FLOORS; i++) {
      const z = podium + (top - podium) * (i / FLOORS);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.72, z, z + h * 0.014, 'ty_hf_slab', seed + i, night, alpha, true, faceYaw(E), fh * 0.68);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.05, 'ty_hf_ice', seed + 30, night, alpha, true, faceYaw(E), fh * 0.96);   // the hoarding, and why there is no door
    if (night) {
      blinkLight(ctx, cam, dx, dy, top + h * 0.04, '255,90,120', now, seed + 31, alpha, 1.3);
      glowPool(ctx, cam, dx, dy, podium + (top - podium) * 0.45, '255,226,176', 7, alpha * 0.18);
    }
  },
  hf_jumpform(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CORE RUNNING AHEAD — the lift core climbing four floors above
    // the last plate, with the jump-form shield still round its head. This is the shape a tower
    // actually spends most of its life in and the one nobody draws: a chimney with a building
    // arriving underneath it.
    const podium = h * 0.05, floors = h * 0.62, coreTop = h * 0.92, shield = h * 1.00;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([104, 118, 132], [214, 226, 236], 1.8), hfChrome([112, 126, 140], [190, 204, 214], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, podium, coreTop, fh * 0.30, fh * 0.27, 10, alpha, hfChrome([72, 86, 100], [192, 206, 218], 2.1), null, 'ty_hf_chrome_dk');
    // The shield: a box round the core's head, wider than the core, and the only bright thing
    // on the building. ⚠ It is what says the core is still MOVING rather than merely tall.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.40, coreTop - h * 0.10, shield, 'ty_hf_ice', seed + 1, night, alpha, true, faceYaw(E), fh * 0.38);
    // The floors that have caught up, glazed for the bottom third and bare above it.
    drawFacetDrum(ctx, cam, dx, dy, podium, floors * 0.45, fh * 0.60, fh * 0.58, 16, alpha, hfGlass(night), null, pal);
    for (let i = 0; i < 6; i++) {
      const z = floors * 0.45 + (floors - floors * 0.45) * (i / 6);
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.016, fh * 0.58, fh * 0.58, 16, alpha, hfChrome([92, 102, 112], [178, 190, 200], 1.5), hfChrome([98, 108, 118], [162, 174, 184], 1.2), 'ty_hf_slab');
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.05, 'ty_hf_ice', seed + 2, night, alpha, true, faceYaw(E), fh * 0.96);
    if (night) {
      blinkLight(ctx, cam, dx, dy, shield, '255,90,120', now, seed + 3, alpha, 1.4);
      glowPool(ctx, cam, dx, dy, shield - h * 0.04, '255,226,176', 9, alpha * 0.24);   // they pour at night
    }
  },
  hf_wrap(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // CLAD FROM THE TOP DOWN — a protection wrap hung off the roof and coming
    // DOWNWARD, with the finished glass above it and bare plates below. Every other shell in
    // the quarter fills from the bottom, which is the order the money arrives in; this one is
    // the order the WEATHER makes you work in, and it inverts the whole read.
    const podium = h * 0.05, wrapLo = h * 0.40, wrapHi = h * 0.58, top = h * 0.90;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([104, 118, 132], [214, 226, 236], 1.8), hfChrome([112, 126, 140], [190, 204, 214], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, podium, top, fh * 0.26, fh * 0.22, 12, alpha, hfChrome([74, 88, 102], [196, 210, 222], 2.1), null, 'ty_hf_chrome_dk');
    drawFacetDrum(ctx, cam, dx, dy, wrapHi, top, fh * 0.60, fh * 0.56, 16, alpha, hfGlass(night), null, pal);        // done
    // The wrap itself — a pale sheeted band, slightly proud of the glass above it, which is what
    // makes it read as hung ON the building rather than as a paler storey of it.
    drawFacetDrum(ctx, cam, dx, dy, wrapLo, wrapHi, fh * 0.64, fh * 0.64, 16, alpha, hfChrome([150, 162, 174], [244, 249, 252], 1.3), null, 'ty_hf_ice');
    for (let i = 0; i < 7; i++) {
      const z = podium + (wrapLo - podium) * (i / 7);
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.016, fh * 0.58, fh * 0.58, 16, alpha, hfChrome([92, 102, 112], [178, 190, 200], 1.5), hfChrome([98, 108, 118], [162, 174, 184], 1.2), 'ty_hf_slab');
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.05, 'ty_hf_ice', seed + 4, night, alpha, true, faceYaw(E), fh * 0.96);
    if (night) {
      blinkLight(ctx, cam, dx, dy, top, '255,90,120', now, seed + 5, alpha, 1.3);
      glowPool(ctx, cam, dx, dy, (wrapLo + wrapHi) * 0.5, '255,226,176', 8, alpha * 0.20);
    }
  },
  hf_scaffold(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CAGE — a tower inside a full scaffold, which is a building
    // wearing a second, coarser building. The glass is all on and none of it can be seen: what
    // you read at any distance is the standards and the lift lines, a rectangular grid laid
    // over a cylinder, and that contradiction is the whole silhouette.
    const podium = h * 0.05, top = h * 0.88, cage = h * 0.93, LIFTS = 11, POSTS = 12;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.96, fh * 0.92, 16, alpha, hfChrome([104, 118, 132], [214, 226, 236], 1.8), hfChrome([112, 126, 140], [190, 204, 214], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, podium, top, fh * 0.58, fh * 0.52, 16, alpha, hfGlass(night), null, pal);
    // The standards, on a ring outside the glass. ⚠ THEY ARE MASS AND NOT STROKES, because a
    // scaffold is the thing you would hit and a stroke is invisible to `SHAPE_SINK`.
    for (let i = 0; i < POSTS; i++) {
      const a = i / POSTS * 6.2832, r = fh * 0.68;
      drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, 0, cage, fh * 0.030, fh * 0.028, 6, alpha, hfChrome([96, 100, 106], [188, 196, 204], 1.7), null, 'ty_hf_slab');
    }
    // The lifts — one working platform every four storeys, a ring rather than a plate, because
    // a solid disc would hide the building the cage is wrapped round.
    for (let i = 1; i <= LIFTS; i++) {
      const z = podium + (cage - podium) * (i / (LIFTS + 1));
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.010, fh * 0.71, fh * 0.71, 16, alpha, hfChrome([104, 110, 118], [196, 204, 212], 1.4), null, 'ty_hf_slab');
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, 0, h * 0.06, 'ty_hf_ice', seed + 6, night, alpha, true, faceYaw(E), fh * 0.98);
    if (night) {
      blinkLight(ctx, cam, dx, dy, cage, '255,90,120', now, seed + 7, alpha, 1.3);
      glowPool(ctx, cam, dx, dy, h * 0.05, '255,226,176', 9, alpha * 0.18);
    }
  },
  hf_stalled(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // WORK STOPPED — no crane, no hoarding worth the name, and a bare
    // frame that has been standing long enough to weather. The quarter's own blurb is that
    // nothing the generator powers is finished, and this is the plot where that stopped being
    // a stage of the work and became the condition of the building.
    //
    // ⚠ THE CRANE IS ABSENT AND THAT IS THE BUILDING. Every other shell here has a machine on
    // it, so the one with nothing standing beside it reads as abandoned at a glance — which no
    // amount of rust on the frame could say from the air.
    const podium = h * 0.05, top = h * 0.84, PLATES = 9;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.90, fh * 0.86, 14, alpha, hfChrome([96, 104, 112], [186, 196, 204], 1.7), hfChrome([102, 110, 118], [168, 178, 186], 1.3), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, podium, top + h * 0.03, fh * 0.25, fh * 0.23, 10, alpha, hfChrome([70, 78, 84], [166, 174, 182], 2.0), null, 'ty_hf_chrome_dk');
    // Two storeys of glass that did get fitted, at the bottom, where the sales suite was going.
    drawFacetDrum(ctx, cam, dx, dy, podium, h * 0.20, fh * 0.56, fh * 0.55, 14, alpha, hfGlass(night, [46, 62, 74]), null, pal);
    for (let i = 0; i < PLATES; i++) {
      const z = h * 0.20 + (top - h * 0.20) * (i / PLATES);
      // ⚠ THE PLATES ARE THE DULLEST RAMP IN THE QUARTER. A stalled frame that still catches
      //   the light reads as new steel; what says "two winters" is that it has stopped doing so.
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.015, fh * 0.54, fh * 0.54, 14, alpha, hfChrome([84, 84, 82], [150, 146, 138], 1.3), hfChrome([88, 88, 86], [138, 134, 128], 1.1), 'ty_hf_slab');
    }
    // The site fence, lower and meaner than a hoarding, and a skip that never went back.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, 0, h * 0.030, 'ty_hf_slab', seed + 8, night, alpha, true, faceYaw(E), fh * 0.98);
    { const [kx, ky] = F(fh * 0.62, fh * 0.66);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.20, 0, h * 0.045, 'ty_hf_chrome_dk', seed + 9, night, alpha, true, faceYaw(E), fh * 0.13); }
    if (night) blinkLight(ctx, cam, dx, dy, top + h * 0.03, '255,90,120', now, seed + 10, alpha, 1.1);
  },
  hf_hoist(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE HOIST AND THE LANDINGS — an external lift tower bolted up one
    // flank with a loading platform cantilevered off the building at every third floor. It is
    // the only shell whose outline is ASYMMETRIC, and the platforms are what do it: a stack of
    // trays sticking out of one side reads as a building being fed, from any range.
    const podium = h * 0.05, top = h * 0.88, clad = h * 0.52;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([104, 118, 132], [214, 226, 236], 1.8), hfChrome([112, 126, 140], [190, 204, 214], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, podium, clad, fh * 0.58, fh * 0.55, 16, alpha, hfGlass(night), null, pal);
    for (let i = 0; i < 7; i++) {
      const z = clad + (top - clad) * (i / 7);
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.016, fh * 0.56, fh * 0.56, 16, alpha, hfChrome([92, 102, 112], [178, 190, 200], 1.5), hfChrome([98, 108, 118], [162, 174, 184], 1.2), 'ty_hf_slab');
    }
    // The hoist mast, on the flank rather than the front — a loading face is a working face and
    // the developer would not put one where the boulevard can see it.
    { const [hx, hy] = F(-fh * 0.74, fh * 0.10);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.14, 0, top + h * 0.06, 'ty_hf_ice', seed + 11, night, alpha, true, faceYaw(E), fh * 0.12);
      // The cage, parked where it stopped, which is different on every tile because the seed is.
      const cz = podium + (top - podium) * (0.18 + frac(seed * 2.3) * 0.6);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.17, cz, cz + h * 0.055, 'ty_hf_chrome', seed + 12, night, alpha, true, faceYaw(E), fh * 0.15);
      if (night) glowPool(ctx, cam, hx, hy, cz + h * 0.03, '255,226,176', 6, alpha * 0.26); }
    // The landings, on the same flank and stepping out further as they go up.
    for (let i = 0; i < 4; i++) {
      const z = podium + (top - podium) * (0.20 + i * 0.21);
      const [lx, ly] = F(-fh * (0.78 + i * 0.03), fh * 0.10);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.26, z, z + h * 0.020, 'ty_hf_slab', seed + 13 + i, night, alpha, true, faceYaw(E), fh * 0.22);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.05, 'ty_hf_ice', seed + 18, night, alpha, true, faceYaw(E), fh * 0.96);
    if (night) blinkLight(ctx, cam, dx, dy, top, '255,90,120', now, seed + 19, alpha, 1.3);
  },
  hf_halfbuilt(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // HALF A BUILDING ON A WHOLE PODIUM — one wing up and glazed, the
    // other wing's footprint still a raft with starter bars standing out of it. The plot was
    // sold as a pair and only one half found a buyer, which is the most Halcyon Fields thing
    // that can happen to a site. In outline it is an L where every other tower here is a point.
    const podium = h * 0.05, top = h * 0.90, cope = h * 0.95;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([108, 122, 136], [218, 230, 240], 1.8), hfChrome([116, 130, 144], [194, 208, 218], 1.4), 'ty_hf_deck');
    // The half that got built, offset off the plot's centre — which is what makes the podium
    // read as having been drawn for something bigger.
    { const [bx, by2] = F(-fh * 0.34, 0);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.44, podium, top, pal, seed + 20, night, alpha, false, faceYaw(E), fh * 0.52);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.48, top, cope, 'ty_hf_chrome', seed + 21, night, alpha, true, faceYaw(E), fh * 0.56);
      if (night) { blinkLight(ctx, cam, bx, by2, cope, '255,90,120', now, seed + 22, alpha, 1.3);
        helixRunner(ctx, cam, bx, by2, podium, top, fh * 0.50, fh * 0.50, 0.6, faceYaw(E), 16, '74,168,255', night, alpha); } }
    // The half that did not: the raft, and the starter bars left sticking out of it for the
    // day somebody pays. ⚠ THEY ARE SHORT AND MANY. Two or three tall ones read as a fence.
    { const [rx, ry] = F(fh * 0.46, 0);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.44, podium, podium + h * 0.035, 'ty_hf_slab', seed + 23, night, alpha, true, faceYaw(E), fh * 0.52); }
    for (let i = 0; i < 10; i++) {
      const [sx1, sy1] = F(fh * (0.20 + (i % 5) * 0.13), fh * (i < 5 ? -0.30 : 0.30));
      drawFacetDrum(ctx, cam, sx1, sy1, podium + h * 0.035, podium + h * 0.085, fh * 0.015, fh * 0.013, 5, alpha, hfChrome([96, 88, 76], [168, 152, 130], 1.5), null, 'ty_hf_slab');
    }
    if (night) glowPool(ctx, cam, dx, dy, podium + h * 0.02, '255,226,176', 8, alpha * 0.14);
  },
  hf_climber(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CRANE INSIDE THE BUILDING — an internal climbing crane standing
    // in the core's own shaft, so the mast comes out of the middle of the roof instead of off
    // the corner of the plot. That is a real distinction and a visible one: an external crane
    // makes a tower look attended, and one growing out of the roof makes it look SELF-BUILDING.
    const podium = h * 0.05, top = h * 0.86, clad = h * 0.44;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([104, 118, 132], [214, 226, 236], 1.8), hfChrome([112, 126, 140], [190, 204, 214], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, podium, clad, fh * 0.60, fh * 0.57, 16, alpha, hfGlass(night), null, pal);
    // The lift core, up through the bare plates to the roof the mast climbs from. Without it the
    // top plate is a sixth of the bare height below `top` and the mast stood on nothing.
    drawFacetDrum(ctx, cam, dx, dy, clad, top, fh * 0.24, fh * 0.22, 12, alpha, hfChrome([74, 88, 102], [196, 210, 222], 2.1), hfChrome([80, 94, 108], [178, 190, 202], 1.4), 'ty_hf_chrome_dk');
    for (let i = 0; i < 6; i++) {
      const z = clad + (top - clad) * (i / 6);
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.016, fh * 0.58, fh * 0.58, 16, alpha, hfChrome([92, 102, 112], [178, 190, 200], 1.5), hfChrome([98, 108, 118], [162, 174, 184], 1.2), 'ty_hf_slab');
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.05, 'ty_hf_ice', seed + 24, night, alpha, true, faceYaw(E), fh * 0.96);
    // The mast, dead centre, and the jib over it. Only the mast is mass. Everything that turns
    // is strokes and decals, because `motionPhase` is parked during both captures and a jib built
    // out of boxes would be meshed and collided at whatever angle `now = 1000` left it.
    // ⚠ The mast is a `ty_junk_crane` box for the reason given on `shell_tower`'s crane: drawn
    // with `latticeTower` it disappeared below ADORN_RICH and left the jib floating over the roof.
    // A collar at the roof is the climbing frame that ties it into the core.
    const mastTop = top + h * 0.26;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.06, top, mastTop, 'ty_junk_crane', seed + 41, night, alpha, true, faceYaw(E));
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.11, top, top + h * 0.03, 'ty_hf_slab', seed + 42, night, alpha, true, faceYaw(E));
    { const ph = motionPhase(now, seed + 25, 44000, 0.34), u = ph < 0 ? 0 : ph;
      let slew = moveSeg(u, 0.00, 0.20, 0, 0.90);
      slew = moveSeg(u, 0.62, 0.82, slew, -0.35);
      slew = moveSeg(u, 0.92, 1.00, slew, 0);
      let hk = moveSeg(u, 0.20, 0.36, 0.86, 0.10);
      hk = moveSeg(u, 0.44, 0.60, hk, 0.86);
      const REACH = Math.min(Math.max(fh * 1.15, mastTop * 0.40), 1.9);
      const th = Math.PI / 2 + slew, ct = Math.cos(th), st = Math.sin(th);
      const at = (r) => F(ct * r, st * r);
      const thW = th + faceYaw(E);
      const jibZ0 = mastTop - h * 0.02, jibZ1 = jibZ0 - REACH * 0.14, RISE = REACH * 0.08;
      const tip = at(REACH), heel = at(REACH * 0.10), tail = at(-fh * 0.50);
      movingBox(ctx, cam, dx, dy, mastTop, mastTop + fh * 0.22, fh * 0.22, fh * 0.15, [176, 150, 62], alpha, night, thW);
      latticeBoom(ctx, cam, [heel[0], heel[1], jibZ0], [tip[0], tip[1], jibZ1], RISE,
        Math.round(clamp(REACH / 0.22, 5, 12)), 2.2, 'rgba(126,134,146,0.95)', alpha, night);
      emitWire(ctx, cam, [tail[0], tail[1], mastTop + fh * 0.20], [tip[0], tip[1], jibZ1 + RISE], 1.1, 'rgba(70,76,84,0.9)', alpha, { pull: 0 });
      const car = at(REACH * 0.72), carZ = jibZ0 + (jibZ1 - jibZ0) * 0.72;
      const hookLo = top, hookZ = hookLo + (carZ - fh * 0.24 - hookLo) * hk;
      hoistLine(ctx, cam, car[0], car[1], carZ - fh * 0.08, hookZ, fh, alpha, night,
        u > 0.30 && u < 0.72 ? { h: fh * 0.22, hx: fh * 0.11, hy: fh * 0.10, rgb: [150, 156, 166] } : null, thW);
      blinkLight(ctx, cam, tip[0], tip[1], jibZ1 + RISE, '255,90,70', now, seed + 26, alpha, 1.5); }
    if (night) glowPool(ctx, cam, dx, dy, top + h * 0.01, '255,226,176', 8, alpha * 0.20);
  },
  hf_flood(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE HOLE THAT FILLED UP — a sheet-piled box with water standing in it
    // and the core going up out of the middle, the podium never poured. It is the only building
    // in the quarter whose ground floor is BELOW the pavement, and the only one with a surface
    // at the bottom that reflects anything.
    const water = h * 0.012, pileTop = h * 0.075, top = h * 0.86;
    // The piles — a ring of narrow flutes, which is what sheet piling looks like from outside.
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * 6.2832, r = fh * 0.90;
      drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, 0, pileTop, fh * 0.055, fh * 0.050, 5, alpha, hfChrome([84, 84, 80], [156, 152, 142], 1.4), null, 'ty_hf_slab');
    }
    // The water. ⚠ IT IS A LID AND NOT A DRUM: a disc with a flat top inside the pile ring, so
    // what you see over the edge is a surface rather than the inside of a tank.
    drawFacetDrum(ctx, cam, dx, dy, 0, water, fh * 0.86, fh * 0.86, 20, alpha, hfChrome([38, 52, 62], [96, 128, 146], 1.2), hfChrome([44, 62, 76], [128, 168, 190], 1.0), 'ty_hf_glass');
    drawFacetDrum(ctx, cam, dx, dy, water, top, fh * 0.28, fh * 0.24, 12, alpha, hfChrome([74, 88, 102], [196, 210, 222], 2.1), hfChrome([80, 94, 108], [178, 190, 202], 1.4), 'ty_hf_chrome_dk');
    // A working deck part-way up the core, cantilevered, because a core with nothing on it is a
    // chimney — and two plates of floor that were poured before the pumps failed.
    for (const z of [top * 0.30, top * 0.44]) {
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, z, z + h * 0.018, 'ty_hf_slab', seed + 27 + (z > top * 0.35 ? 1 : 0), night, alpha, true, faceYaw(E), fh * 0.58);
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, 0, h * 0.055, 'ty_hf_ice', seed + 29, night, alpha, true, faceYaw(E), fh * 0.98);
    if (night) {
      blinkLight(ctx, cam, dx, dy, top, '255,90,120', now, seed + 32, alpha, 1.2);
      glowPool(ctx, cam, dx, dy, water, '120,180,206', 10, alpha * 0.16);   // a work lamp on the water, which is the only light on it
    }
  },
  hf_topout(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // TOPPED OUT AND BEING STRIPPED — the crane down and lying across its
    // own roof in sections, the last of the scaffold gone from the bottom half. It is the shell
    // at the far end of the sequence and the only one where the site is leaving rather than
    // arriving, which from the air is a roof with a machine dismantled on it.
    const podium = h * 0.05, top = h * 0.92, cope = h * 0.97;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.94, fh * 0.90, 16, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([120, 136, 150], [200, 214, 224], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, top, fh * 0.62, fh * 0.56, 16, alpha, hfGlass(night), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, top, cope, fh * 0.66, fh * 0.60, 16, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_chrome');
    // The last two floors, still bare, at the top where the work finishes.
    for (const z of [top - h * 0.10, top - h * 0.05]) {
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.014, fh * 0.64, fh * 0.64, 16, alpha, hfChrome([92, 102, 112], [178, 190, 200], 1.5), null, 'ty_hf_slab');
    }
    // The crane, on the roof, in three pieces. ⚠ LYING DOWN IS THE WHOLE POINT, so these are
    // boxes rather than a `latticeTower`: a mast on its side is a load, and a load does not
    // move, which is what makes it safe to build out of mass.
    for (const [i, [u, v, l, w2]] of [[-0.30, -0.28, 0.46, 0.070], [0.06, -0.30, 0.38, 0.060], [0.26, 0.20, 0.30, 0.055]].entries()) {
      const [bx, by2] = F(u * fh, v * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * l, cope, cope + h * 0.030, 'ty_hf_slab', seed + 33 + i, night, alpha, true, faceYaw(E) + i * 0.6, fh * w2);
    }
    if (night) {
      blinkLight(ctx, cam, dx, dy, cope + h * 0.03, '255,90,120', now, seed + 36, alpha, 1.3);
      glowPool(ctx, cam, dx, dy, cope, '255,226,176', 9, alpha * 0.20);
      // Two floors lit inside, low down, where the fit-out has started. It is the first light
      // in a shell anywhere in the quarter and it is the point of putting it last in the run.
      glowPool(ctx, cam, dx, dy, podium + h * 0.10, '176,222,255', 10, alpha * 0.20);
    }
  },

  // ── THE LOW ONES. Six plots carry `atrium_court`, whose own note is that the quarter is a bar
  // chart and needs buildings that give the towers something to stand next to. That argument
  // works exactly as well five more times and the shapes are all different, because there are
  // a great many ways to put a hole in a low building and only one of them is a drum in a court.
  hf_cloister(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE SQUARE COURT — four low wings round an open middle, with an
    // arcade at ground on the inner face. No drum anywhere: the atrium type roofs its court in
    // glass and this one leaves it open to the sky, which is the difference between a mall and
    // a quadrangle and is legible from directly above and nowhere else.
    const top = h * 0.82, cope = h * 0.92;
    for (const [i, [u, v, hw, hd]] of [[0, -0.66, 0.92, 0.22], [0, 0.66, 0.92, 0.22], [-0.70, 0, 0.20, 0.46], [0.70, 0, 0.20, 0.46]].entries()) {
      const [bx, by2] = F(u * fh, v * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * hw, 0, top, pal, seed + i, night, alpha, false, faceYaw(E), fh * hd);
      draw3DBoxAt(ctx, cam, bx, by2, fh * (hw + 0.05), top, cope, 'ty_hf_chrome', seed + 4 + i, night, alpha, true, faceYaw(E), fh * (hd + 0.05));
    }
    // The corner drums, which tie four boxes into one building — the crescent's trick again,
    // and the only reason this is not four sheds facing each other across a yard.
    for (const [u, v] of [[-0.70, -0.66], [0.70, -0.66], [-0.70, 0.66], [0.70, 0.66]]) {
      const [qx, qy] = F(u * fh, v * fh);
      drawFacetDrum(ctx, cam, qx, qy, 0, cope, fh * 0.26, fh * 0.24, 12, alpha, hfChrome([96, 112, 128], [236, 246, 250], 2.0), hfChrome([106, 122, 138], [206, 220, 230], 1.4), 'ty_hf_chrome');
    }
    // The arcade — a colonnade standing INSIDE the court, holding the inner edge of each wing
    // up off the paving. It is what you would walk under and it is why the middle reads as a
    // room with no roof rather than as a gap between buildings.
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.2832, r = fh * 0.40;
      drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, 0, h * 0.30, fh * 0.045, fh * 0.040, 8, alpha, hfChrome([110, 126, 142], [238, 246, 250], 1.9), null, 'ty_hf_chrome');
    }
    if (night) {
      glowPool(ctx, cam, dx, dy, h * 0.02, '140,232,182', 12, alpha * 0.26);   // the planting in the middle, and green means vegetation here and nothing else
      const [gx, gy] = F(0, fh * 0.90); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },
  hf_ring(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE DOUGHNUT — one continuous glazed ring with a real hole straight
    // down through the middle of it. ⚠ THE HOLE IS BUILT RATHER THAN CUT: there is no way to
    // subtract a volume from a drum here, so the ring is twelve fat segments on a circle, each
    // yawed to its own tangent, and the middle is somewhere nothing was ever drawn. That is
    // also what makes it honest to everything downstream — `modelSolid` cuts CFIT collision
    // from these primitives, so the hole is a hole to an aircraft as well as to the eye.
    const SEGS = 12, top = h * 0.86, cope = h * 0.94, R = 0.62;
    for (let i = 0; i < SEGS; i++) {
      const a = i / SEGS * 6.2832;
      const [bx, by2] = F(Math.cos(a) * R * fh, Math.sin(a) * R * fh);
      // ⚠ THE SEGMENTS OVERLAP. Twelve boxes butted at their corners leave twelve slots of
      //   daylight through the wall of the ring, which reads as a ruin rather than as a curve.
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.20, 0, top, pal, seed + i, night, alpha, false, a + faceYaw(E), fh * 0.22);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.24, top, cope, 'ty_hf_chrome', seed + 20 + i, night, alpha, true, a + faceYaw(E), fh * 0.25);
    }
    // The inner and outer rims, which is what turns twelve segments into one ring.
    drawFacetDrum(ctx, cam, dx, dy, top, cope, fh * 0.42, fh * 0.42, 24, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
    { const [cx1, cy1] = F(0, fh * 0.84);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.07, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      helixRunner(ctx, cam, dx, dy, cope, cope + h * 0.012, fh * 0.86, fh * 0.86, 1, 0, 30, '150,226,255', night, alpha);
      glowPool(ctx, cam, dx, dy, h * 0.02, '176,232,255', 13, alpha * 0.22);
      const [gx, gy] = F(0, fh * 0.86); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },
  hf_scissor(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // TWO BARS CROSSING — an X in plan with a glazed lantern where they
    // meet, so the building makes four triangular yards instead of one court. It is the only
    // plan in the quarter that is not made of rectangles and circles, and the reason to build
    // it is that from the air the diagonal disagrees with the street grid it sits in.
    const top = h * 0.70, cope = h * 0.80, lantern = h * 0.98;
    for (const [i, yw] of [0.62, -0.62].entries()) {
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, 0, top, pal, seed + i, night, alpha, false, faceYaw(E) + yw, fh * 0.24);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, top, cope, 'ty_hf_chrome', seed + 2 + i, night, alpha, true, faceYaw(E) + yw, fh * 0.28);
      // A drum at each of the four arm ends, which softens the point where two bars cross at an
      // angle and leave a wedge — the crescent's joint trick spent on a corner instead.
      for (const s of [-1, 1]) {
        const [qx, qy] = F(Math.cos(yw) * s * fh * 0.94, Math.sin(yw) * s * fh * 0.94);
        drawFacetDrum(ctx, cam, qx, qy, 0, cope, fh * 0.22, fh * 0.20, 12, alpha, hfChrome([96, 112, 128], [236, 246, 250], 2.0), hfChrome([106, 122, 138], [206, 220, 230], 1.4), 'ty_hf_chrome');
      }
    }
    // The lantern over the crossing — the one tall thing, and the only part of the building you
    // can see from outside the block.
    drawFacetDrum(ctx, cam, dx, dy, cope, lantern * 0.90, fh * 0.34, fh * 0.30, 16, alpha, hfGlass(night, [70, 102, 128]), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, lantern * 0.90, lantern, fh * 0.30, fh * 0.16, 16, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    if (night) {
      glowPool(ctx, cam, dx, dy, cope + h * 0.04, '186,236,255', 12, alpha * 0.28);
      const [gx, gy] = F(0, fh * 0.70); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.26);
    }
  },
  hf_forecourt(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE U — three wings round a forecourt that OPENS TO THE STREET,
    // which is the one thing none of the other courtyard buildings here does: a cloister, a
    // ring and a crossing all keep their middle to themselves, and this one hands it to the
    // pavement. The canopy across the mouth is what stops it reading as a building with a bite
    // taken out of it.
    const top = h * 0.76, cope = h * 0.86;
    for (const [i, [u, v, hw, hd]] of [[0, -0.66, 0.94, 0.24], [-0.72, 0.10, 0.20, 0.52], [0.72, 0.10, 0.20, 0.52]].entries()) {
      const [bx, by2] = F(u * fh, v * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * hw, 0, top, pal, seed + i, night, alpha, false, faceYaw(E), fh * hd);
      draw3DBoxAt(ctx, cam, bx, by2, fh * (hw + 0.05), top, cope, 'ty_hf_chrome', seed + 3 + i, night, alpha, true, faceYaw(E), fh * (hd + 0.05));
    }
    for (const [u, v] of [[-0.72, -0.62], [0.72, -0.62]]) {
      const [qx, qy] = F(u * fh, v * fh);
      drawFacetDrum(ctx, cam, qx, qy, 0, cope, fh * 0.26, fh * 0.24, 12, alpha, hfChrome([96, 112, 128], [236, 246, 250], 2.0), hfChrome([106, 122, 138], [206, 220, 230], 1.4), 'ty_hf_chrome');
    }
    // The canopy across the open end, on two slender posts, held clear of the wings so the
    // forecourt is still open above it.
    { const [nx, ny] = F(0, fh * 0.62);
      draw3DBoxAt(ctx, cam, nx, ny, fh * 0.76, h * 0.26, h * 0.30, 'ty_hf_ice', seed + 7, night, alpha, true, faceYaw(E), fh * 0.16);
      for (const s of [-1, 1]) {
        const [px, py] = F(s * fh * 0.68, fh * 0.62);
        drawFacetDrum(ctx, cam, px, py, 0, h * 0.26, fh * 0.055, fh * 0.048, 8, alpha, hfChrome([88, 104, 120], [230, 240, 248], 2.2), null, 'ty_hf_chrome_dk');
      } }
    if (night) {
      const [gx, gy] = F(0, fh * 0.60); glowPool(ctx, cam, gx, gy, h * 0.22, '206,238,255', 13, alpha * 0.30);
      glowPool(ctx, cam, dx, dy, h * 0.02, '140,232,182', 10, alpha * 0.20);
    }
  },
  hf_bridgecourt(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CAMPION COURT — two parallel bars with a public passage
    // between them at ground and a glazed bridge over it at the top, so the building is a thing
    // you walk THROUGH on your way somewhere else. `sky_court`'s hole is three hundred feet up
    // and `chrome_arch`'s is structural; this one is a route, and it is at the scale of a person
    // rather than of an aircraft.
    const top = h * 0.74, cope = h * 0.84, brZ0 = h * 0.58, brZ1 = h * 0.74;
    for (const [i, u] of [-0.60, 0.60].entries()) {
      const [bx, by2] = F(u * fh, 0);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.30, 0, top, pal, seed + i, night, alpha, false, faceYaw(E), fh * 0.86);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.34, top, cope, 'ty_hf_chrome', seed + 2 + i, night, alpha, true, faceYaw(E), fh * 0.90);
      // The end drums, which is how both bars finish where the passage comes out.
      for (const s of [-1, 1]) {
        const [qx, qy] = F(u * fh, s * fh * 0.84);
        drawFacetDrum(ctx, cam, qx, qy, 0, cope, fh * 0.30, fh * 0.28, 12, alpha, hfChrome([96, 112, 128], [236, 246, 250], 2.0), hfChrome([106, 122, 138], [206, 220, 230], 1.4), 'ty_hf_chrome');
      }
    }
    // The bridge, at the top and set back from both ends of the passage so the route is open to
    // the sky for most of its length.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, brZ0, brZ1, pal, seed + 5, night, alpha, false, faceYaw(E), fh * 0.22);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, brZ1, brZ1 + h * 0.024, 'ty_hf_chrome', seed + 6, night, alpha, true, faceYaw(E), fh * 0.24);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, brZ0 - h * 0.024, brZ0, 'ty_hf_chrome', seed + 7, night, alpha, true, faceYaw(E), fh * 0.24);
    if (night) {
      // Lit down the passage rather than out of a lobby, because the passage is the building.
      glowPool(ctx, cam, dx, dy, h * 0.03, '186,236,255', 11, alpha * 0.30);
      glowPool(ctx, cam, dx, dy, (brZ0 + brZ1) * 0.5, '150,226,255', 9, alpha * 0.22);
    }
  },

  // ── THE ESTATE'S TOWERS. Six plots carry `chrome_tower`, which is a glass cylinder on a chrome
  // podium and is the product the Ascendants designed rather than a building. These five are the
  // same product with one decision changed each time — how it steps, how it is ribbed, what it is
  // clad in, which way it tapers, how it is wound — which is what a developer's range looks like.
  hf_stepdrum(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE TELESCOPE — three cylinders of falling radius stacked with hard
    // steps between them, instead of one shaft with a smooth taper. A taper is a proportion and
    // a step is an EVENT: you can count three of these from the far side of the basin, and the
    // roof of each step is a terrace with something on it.
    const podium = h * 0.06, mast = h * 1.08;
    const STAGE = [[0.06, 0.40, 0.70, 0.66], [0.40, 0.70, 0.56, 0.53], [0.70, 0.94, 0.42, 0.38]];
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.96, fh * 0.92, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    for (const [i, [z0, z1, rb, rt]] of STAGE.entries()) {
      drawFacetDrum(ctx, cam, dx, dy, h * z0, h * z1, fh * rb, fh * rt, 18, alpha, hfGlass(night), null, pal);
      // The step itself — a chrome deck standing proud of the stage BELOW it, which is what
      // makes the setback read as a terrace rather than as the glass simply getting narrower.
      drawFacetDrum(ctx, cam, dx, dy, h * z1, h * z1 + h * 0.022, fh * (rt + 0.10), fh * (rt + 0.10), 18, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), hfChrome([108, 124, 140], [210, 224, 232], 1.4), 'ty_hf_chrome');
      if (night) glowPool(ctx, cam, dx, dy, h * z1 + h * 0.03, '150,226,255', 9, alpha * 0.20);
    }
    drawFacetDrum(ctx, cam, dx, dy, h * 0.94, mast, fh * 0.07, fh * 0.035, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.82);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.34, fh * 0.34, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 3, alpha, 1.5);
      const [gx, gy] = F(0, fh * 0.84); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  hf_fluted(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE FLUTED SHAFT — sixteen chrome fins the whole height of the
    // building with the glass set back between them, so the tower has no smooth face anywhere.
    // ⚠ THE FINS ARE THE SILHOUETTE AND NOT THE SURFACE. A fin standing proud of the glass
    // breaks the OUTLINE into teeth, which survives at a range where a facade is one grey
    // shape — the same argument the twist makes, spent vertically instead of in plan.
    const FINS = 16, podium = h * 0.06, top = h * 0.92, cap = h * 0.97, mast = h * 1.06;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.94, fh * 0.90, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, top, fh * 0.56, fh * 0.48, FINS, alpha, hfGlass(night), null, pal);
    for (let i = 0; i < FINS; i++) {
      const a = i / FINS * 6.2832 + 6.2832 / (FINS * 2), r = fh * 0.60;
      // ⚠ THE FIN TAPERS WITH THE SHAFT, or the flutes stand further and further off the glass
      //   as they rise and the top of the tower grows a fringe.
      drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, podium, top, fh * 0.055, fh * 0.040, 6, alpha, hfChrome([98, 114, 130], [240, 248, 252], 2.0), null, 'ty_hf_chrome');
    }
    drawFacetDrum(ctx, cam, dx, dy, top, cap, fh * 0.62, fh * 0.44, FINS, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    drawFacetDrum(ctx, cam, dx, dy, cap, mast, fh * 0.06, fh * 0.03, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.80);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.32, fh * 0.32, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 5, alpha, 1.4);
      // ⚠ THE RUNNER IS VERTICAL AND NOT A HELIX. A spiral across sixteen verticals reads as a
      //   mistake in one of them; a ring at the cap reads as the thing the flutes arrive at.
      helixRunner(ctx, cam, dx, dy, top, top + h * 0.012, fh * 0.70, fh * 0.70, 1, 0, 26, '150,226,255', night, alpha);
      const [gx, gy] = F(0, fh * 0.82); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  hf_pale(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // NO GLASS AT ALL — a solid pale shaft with one lit slot up its face, and
    // the only tower in Halcyon Fields you cannot see into. Everything else here is a glazed
    // object whose whole argument is transparency, so a blank white one is the loudest thing on
    // the street precisely because it says nothing.
    //
    // ⚠ IT IS STILL THE HOUSE PALETTE. `ty_hf_ice` and `ty_hf_marble` are already in the block
    // and neither is new; what makes this building different is that it uses NONE of the glass,
    // which is a subtraction rather than an addition and is the only kind the palette rule
    // allows at this point in the quarter.
    const podium = h * 0.05, top = h * 0.94, cap = h * 1.00;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.88, fh * 0.84, 12, alpha, hfChrome([132, 138, 144], [238, 240, 242], 1.6), hfChrome([140, 146, 152], [214, 218, 222], 1.3), 'ty_hf_marble');
    // The shaft: eight facets, so it is cut rather than rolled, and hardly any taper.
    drawFacetDrum(ctx, cam, dx, dy, podium, top, fh * 0.52, fh * 0.48, 8, alpha, hfChrome([146, 150, 154], [246, 247, 248], 1.4), null, 'ty_hf_marble');
    drawFacetDrum(ctx, cam, dx, dy, top, cap, fh * 0.55, fh * 0.50, 8, alpha, hfChrome([126, 132, 138], [236, 238, 240], 1.5), hfChrome([134, 140, 146], [212, 216, 220], 1.2), 'ty_hf_ice');
    // The slot — one narrow glazed strip up the entrance face, the only opening on the building.
    { const [sx1, sy1] = F(0, fh * 0.50);
      draw3DBoxAt(ctx, cam, sx1, sy1, fh * 0.09, podium, top, 'ty_hf_glass', seed + 1, night, alpha, false, faceYaw(E), fh * 0.06); }
    { const [cx1, cy1] = F(0, fh * 0.72);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.066, fh * 0.26, fh * 0.26, 12, alpha, hfChrome([138, 144, 150], [244, 246, 248], 1.5), hfChrome([146, 152, 158], [220, 224, 228], 1.2), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, cap, '255,90,120', now, seed + 2, alpha, 1.4);
      // ⚠ THE SLOT IS THE ONLY LIT THING AND IT IS WARM. A cold light here would read as one
      //   more cyan building seen edge-on; a warm line up a white shaft reads as the inside.
      const [wx, wy] = F(0, fh * 0.54); glowPool(ctx, cam, wx, wy, top * 0.55, '255,216,168', 8, alpha * 0.24);
      glowPool(ctx, cam, dx, dy, h * 0.03, '236,240,244', 11, alpha * 0.20);
    }
  },
  hf_chamfer(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // WIDER AS IT RISES — a square shaft with its corners cut off,
    // flaring outward the whole way up. Every other tower in the quarter tapers in, because
    // that is what a tower does; this one does the opposite, and an inverted taper on a
    // skyline of narrowing shafts is the one profile you cannot mistake for its neighbours.
    const podium = h * 0.07, top = h * 0.90, cope = h * 0.96, mast = h * 1.05;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.78, fh * 0.74, 8, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    // ⚠ EIGHT FACETS IS A CHAMFERED SQUARE AND NOT AN OCTAGON, because the four cut corners
    //   are drawn at the same radius as the four faces — which is what a chamfer is, and is
    //   also why the drum has to be turned 22.5° so a face rather than an arris meets the street.
    drawFacetDrum(ctx, cam, dx, dy, podium, top, fh * 0.42, fh * 0.66, 8, alpha, hfGlass(night), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, top, cope, fh * 0.70, fh * 0.62, 8, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_chrome');
    // The bands, which step out with the shaft and are what let you read the flare as
    // deliberate rather than as a drawing error.
    for (let i = 1; i <= 4; i++) {
      const t = i / 5, r = 0.42 + (0.66 - 0.42) * t;
      drawFacetDrum(ctx, cam, dx, dy, podium + (top - podium) * t, podium + (top - podium) * t + h * 0.014, fh * (r + 0.035), fh * (r + 0.035), 8, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
    }
    drawFacetDrum(ctx, cam, dx, dy, cope, mast, fh * 0.06, fh * 0.03, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.66);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.062, h * 0.080, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 4, alpha, 1.5);
      helixRunner(ctx, cam, dx, dy, podium, top, fh * 0.44, fh * 0.68, 0, faceYaw(E), 14, '74,168,255', night, alpha);
      glowPool(ctx, cam, dx, dy, cope, '150,226,255', 14, alpha * 0.26);
      const [gx, gy] = F(0, fh * 0.68); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  hf_scarf(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE WOUND RIBBON — a plain glass cylinder with one broad chrome band
    // spiralling round it from the podium to the crown. The twisted shaft shears its own floor
    // plates and this does not move at all: the building underneath is the estate's standard
    // product and the spiral is a thing laid ON it, which is a different kind of difference and
    // the cheaper one an estate would actually have paid for.
    //
    // ⚠ THE RIBBON IS MASS. A stroke wound round a tower is a light and vanishes by day, and
    // this has to be the building's outline at noon — so it is a run of short boxes on a helix,
    // each yawed to its own tangent, standing proud of the glass.
    const TURNS = 2.2, STEPS = 30, podium = h * 0.06, top = h * 0.92, cap = h * 0.97, mast = h * 1.06;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.94, fh * 0.90, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, top, fh * 0.58, fh * 0.50, 18, alpha, hfGlass(night), null, pal);
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS, a = t * TURNS * 6.2832, r = fh * (0.60 + (0.52 - 0.60) * t);
      // ⚠ THE SEGMENTS OVERLAP IN z BY HALF, or the ribbon is a dotted line of chevrons.
      const z0 = podium + (top - podium) * t, z1 = z0 + (top - podium) / STEPS * 2.0;
      const [bx, by2] = F(Math.cos(a) * r, Math.sin(a) * r);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.17, z0, Math.min(top, z1), 'ty_hf_chrome', seed + i, night, alpha, false, a + 1.5708 + faceYaw(E), fh * 0.05);
    }
    drawFacetDrum(ctx, cam, dx, dy, top, cap, fh * 0.60, fh * 0.44, 18, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    drawFacetDrum(ctx, cam, dx, dy, cap, mast, fh * 0.06, fh * 0.03, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.80);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.32, fh * 0.32, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 40, alpha, 1.4);
      // The runner follows the ribbon, which is the twisted shaft's rule: a spiral of light
      // wound against a spiral of chrome is two contradictory helices and reads as neither.
      helixRunner(ctx, cam, dx, dy, podium, top, fh * 0.70, fh * 0.62, TURNS, faceYaw(E), 30, '74,168,255', night, alpha);
      const [gx, gy] = F(0, fh * 0.82); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  // ── THE STEPPED ONES. Six plots carry `cascade_block`, whose rule is that it steps toward the
  // entrance and nowhere else so it has a front and a back. These five keep the front-and-back
  // and change what the stepping is FOR: daylight, offset, a splay, a seam, a balcony.
  hf_sawtooth(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE NORTH LIGHT — a stepped block whose roof is a row of sawteeth,
    // each with a glazed face turned one way and a solid slope the other. It is the only roof
    // in the quarter that is not flat, and a sawtooth is the roof of a WORKSHOP, which is a
    // thing the estate would rather you did not notice about the floorspace it is letting.
    const base = h * 0.045, body = h * 0.66, TEETH = 5;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, base, body, pal, seed, night, alpha, false, faceYaw(E), fh * 0.72);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, body, body + h * 0.020, 'ty_hf_chrome', seed + 1, night, alpha, true, faceYaw(E), fh * 0.76);
    // The teeth. ⚠ EACH ONE IS TWO PIECES — a glazed riser and a chrome slope leaning off it —
    // because a tooth drawn as one box is a parapet, and what makes a sawtooth read is that one
    // side of every tooth catches the light and the other never does.
    for (let i = 0; i < TEETH; i++) {
      const ly = (-0.56 + i * 0.28) * fh;
      const [gx1, gy1] = F(0, ly);
      draw3DBoxAt(ctx, cam, gx1, gy1, fh * 0.86, body, body + h * 0.115, 'ty_hf_glass', seed + 2 + i, night, alpha, false, faceYaw(E), fh * 0.045);
      const [sx1, sy1] = F(0, ly + fh * 0.10);
      draw3DBoxAt(ctx, cam, sx1, sy1, fh * 0.86, body + h * 0.020, body + h * 0.072, 'ty_hf_chrome', seed + 10 + i, night, alpha, true, faceYaw(E), fh * 0.085);
      if (night) glowPool(ctx, cam, gx1, gy1, body + h * 0.08, '176,226,255', 7, alpha * 0.16);
    }
    { const [cx1, cy1] = F(0, fh * 0.80);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) { const [gx, gy] = F(0, fh * 0.82); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28); }
  },
  hf_pixel(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE STAGGER — eight boxes of one size stacked with each one shoved off
    // the last, so the tower has a different plan at every floor and no two elevations of it
    // agree. The cascade steps in one direction and this one steps in four, which turns a
    // stack into something you have to walk round to understand.
    const base = h * 0.05, top = h * 0.88, N = 8;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 0.98, fh * 0.94, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    // The core, which is what all eight boxes have in common and the only reason the stack
    // stands up — the twisted shaft's rule, for the same reason: without it you can see daylight
    // through the building wherever two offset boxes fail to overlap.
    drawFacetDrum(ctx, cam, dx, dy, base, top + h * 0.03, fh * 0.26, fh * 0.24, 12, alpha, hfChrome([84, 100, 116], [214, 228, 238], 2.0), hfChrome([92, 108, 124], [196, 210, 220], 1.4), 'ty_hf_chrome_dk');
    const OFF = [[0, 0], [0.22, -0.10], [-0.06, 0.20], [-0.24, 0.02], [0.10, 0.22], [0.24, -0.06], [-0.10, -0.22], [0.02, 0.10]];
    for (let i = 0; i < N; i++) {
      const [u, v] = OFF[i];
      const [bx, by2] = F(u * fh, v * fh);
      // ⚠ THE BOXES OVERLAP IN z. Butted at a plane and offset in plan, consecutive boxes leave
      //   an open slot along two edges of every floor.
      const z0 = base + (top - base) * (i / N), z1 = base + (top - base) * ((i + 1.14) / N);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.50, z0, Math.min(top, z1), pal, seed + i, night, alpha, false, faceYaw(E), fh * 0.44);
      // The lip on each one, which is what makes an offset read as a terrace you could stand on.
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.54, Math.min(top, z1) - h * 0.016, Math.min(top, z1), 'ty_hf_chrome', seed + 20 + i, night, alpha, true, faceYaw(E), fh * 0.48);
      if (night && i % 2 === 0) glowPool(ctx, cam, bx, by2, Math.min(top, z1), '150,226,255', 7, alpha * 0.16);
    }
    { const [cx1, cy1] = F(0, fh * 0.72);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, top + h * 0.03, '255,90,120', now, seed + 30, alpha, 1.3);
      const [gx, gy] = F(0, fh * 0.74); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  hf_splay(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE V — two slabs hinged off a shared core and swung apart, so every
    // flat in the building looks out at something other than the flat opposite. It is the plan
    // the brochure means by dual aspect and the first thing a developer gives up when the plot
    // gets tight; the reason it is here is that from the air it is a chevron, and there is not
    // another one in the Basin.
    const base = h * 0.05, top = h * 0.86, cope = h * 0.92;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 1.00, fh * 0.94, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, base, cope, fh * 0.28, fh * 0.25, 14, alpha, hfChrome([96, 112, 128], [232, 242, 248], 2.0), hfChrome([104, 120, 136], [206, 220, 230], 1.4), 'ty_hf_chrome');
    for (const [i, s] of [-1, 1].entries()) {
      const yw = s * 0.46;
      // Each wing runs OUT from the core rather than through it, so the two meet at the hinge
      // and open away from it.
      const [bx, by2] = F(Math.sin(yw) * fh * 0.02 + s * fh * 0.46, -Math.cos(yw) * fh * 0.34);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.52, base, top, pal, seed + i, night, alpha, false, faceYaw(E) + yw, fh * 0.22);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.56, top, cope, 'ty_hf_chrome', seed + 2 + i, night, alpha, true, faceYaw(E) + yw, fh * 0.26);
      // A drum at the open end of each wing, which is where the two of them are furthest apart
      // and is the only place the plan can be read from the ground.
      const [qx, qy] = F(s * fh * 0.94, -fh * 0.62);
      drawFacetDrum(ctx, cam, qx, qy, base, cope, fh * 0.24, fh * 0.22, 12, alpha, hfChrome([96, 112, 128], [236, 246, 250], 2.0), hfChrome([106, 122, 138], [206, 220, 230], 1.4), 'ty_hf_chrome');
      if (night) helixRunner(ctx, cam, qx, qy, base, top, fh * 0.25, fh * 0.25, 0, faceYaw(E), 12, '74,168,255', night, alpha);
    }
    { const [cx1, cy1] = F(0, fh * 0.40);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, cope, '255,90,120', now, seed + 5, alpha, 1.3);
      const [gx, gy] = F(0, fh * 0.42); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.26);
    }
  },
  hf_partywall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // ONE BUILDING, TWO HALVES, AND A WALL DOWN THE MIDDLE THEY DO NOT
    // AGREE ABOUT. Identical masses either side of a blank chrome fin: the near half glazed to
    // the ground and the far half clad solid with punched openings, because they were sold to
    // two owners who each finished their own side. The joke is the building's name and it is
    // also the only honest way a quarter this uniform can contain a disagreement.
    const base = h * 0.045, top = h * 0.82, cope = h * 0.90, wall = h * 0.98;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    for (const [i, s] of [-1, 1].entries()) {
      const [bx, by2] = F(s * fh * 0.48, 0);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.44, base, top, i === 0 ? pal : 'ty_hf_slab', seed + i, night, alpha, false, faceYaw(E), fh * 0.62);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.48, top, cope, 'ty_hf_chrome', seed + 2 + i, night, alpha, true, faceYaw(E), fh * 0.66);
      // ⚠ THE TWO HALVES DIFFER IN WHAT THEY ARE MADE OF AND NOT IN WHAT SHAPE THEY ARE. A
      //   stepped half and a flat half is two buildings; identical masses in two claddings is
      //   one building with an argument in it, which is the thing being drawn.
      if (i === 1) for (let k = 0; k < 4; k++) {
        const [wx, wy] = F(s * fh * 0.48, (-0.36 + k * 0.24) * fh);
        draw3DBoxAt(ctx, cam, wx, wy, fh * 0.46, base + (top - base) * (0.22 + k * 0.02), top - h * 0.10, 'ty_hf_glass', seed + 10 + k, night, alpha, false, faceYaw(E), fh * 0.07);
      }
      if (night && i === 0) glowPool(ctx, cam, bx, by2, base + h * 0.08, '176,226,255', 10, alpha * 0.24);
    }
    // The party wall itself, standing above both copings and running the full depth of the plot.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.07, base, wall, 'ty_hf_chrome', seed + 20, night, alpha, true, faceYaw(E), fh * 0.70);
    { const [cx1, cy1] = F(-fh * 0.48, fh * 0.66);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.26, fh * 0.26, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, wall, '255,90,120', now, seed + 21, alpha, 1.2);
      const [gx, gy] = F(-fh * 0.48, fh * 0.68); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },
  hf_lowterrace(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THREE STOREYS AND A BALCONY THE WHOLE WAY ALONG — the smallest
    // thing the estate built, and the only one where the horizontal is longer than anything
    // vertical on it. Against sixty towers a low run of flats with a continuous deck is what
    // gives the quarter a street rather than a set of objects standing in one.
    const base = h * 0.05, top = h * 0.84, cope = h * 0.96;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, base, top, pal, seed, night, alpha, false, faceYaw(E), fh * 0.40);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, top, cope, 'ty_hf_chrome', seed + 1, night, alpha, true, faceYaw(E), fh * 0.44);
    // The decks — three of them, oversailing the glass on the entrance side only, because a
    // balcony on the back of a building is a fire escape.
    for (let i = 1; i <= 3; i++) {
      const z = base + (top - base) * (i / 3.4);
      const [bx, by2] = F(0, fh * 0.18);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.96, z, z + h * 0.028, 'ty_hf_chrome', seed + 2 + i, night, alpha, true, faceYaw(E), fh * 0.30);
      if (night) glowPool(ctx, cam, bx, by2, z + h * 0.03, '150,226,255', 8, alpha * 0.16);
    }
    // ⚠ THE SCAFFOLD IS STILL ON ONE END, and that is the building's name rather than a leftover
    //   from the shells. A snagging list is the punch list on a building that is FINISHED, so
    //   this is one bay of tower at the far end and nothing else — not a shell, a complaint.
    { const [px, py] = F(fh * 0.90, 0);
      for (const s of [-1, 1]) {
        const [qx, qy] = F(fh * 0.90, s * fh * 0.36);
        drawFacetDrum(ctx, cam, qx, qy, 0, cope + h * 0.06, fh * 0.028, fh * 0.026, 6, alpha, hfChrome([96, 100, 106], [188, 196, 204], 1.7), null, 'ty_hf_slab');
      }
      for (let i = 1; i <= 3; i++) draw3DBoxAt(ctx, cam, px, py, fh * 0.05, base + (cope - base) * (i / 4), base + (cope - base) * (i / 4) + h * 0.012, 'ty_hf_slab', seed + 10 + i, night, alpha, true, faceYaw(E), fh * 0.40); }
    { const [cx1, cy1] = F(0, fh * 0.46);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.28, fh * 0.28, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) { const [gx, gy] = F(0, fh * 0.48); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28); }
  },

  // ── THE THREADED ONES. Five plots carry `bead_tower`, which is six glazed bulges on a chrome
  // spine. The spine is the good idea and the bead is only one of the things you can thread on
  // it, so these four thread something else: one big one, a chain of flat links, drums with
  // daylight between them, and a plan that is not a circle at all.
  hf_spindle(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // ONE BULGE, NOT SIX — a single vast belly at mid-height drawn to a
    // point at both ends, so the tower is widest where every other tower here is already
    // narrowing. The bead tower is a diagram of its own floor plan repeated; this is the same
    // construction spent entirely on one gesture, which is what makes it read as a landmark
    // rather than as a product.
    const podium = h * 0.05, neck0 = h * 0.14, belly = h * 0.50, neck1 = h * 0.88, cap = h * 0.94, tip = h * 1.04;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.90, fh * 0.86, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, neck0, fh * 0.30, fh * 0.22, 18, alpha, hfGlass(night), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, neck0, belly, fh * 0.22, fh * 0.74, 18, alpha, hfGlass(night), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, belly, neck1, fh * 0.74, fh * 0.20, 18, alpha, hfGlass(night), null, pal);
    // The spine, visible only at the two necks, which is what says the glass is hung on
    // something rather than standing on itself.
    drawFacetDrum(ctx, cam, dx, dy, podium, cap, fh * 0.17, fh * 0.13, 12, alpha, hfChrome([80, 96, 112], [206, 220, 232], 2.1), null, 'ty_hf_chrome_dk');
    // Three collars on the belly — the only horizontals, and the thing that lets you count
    // storeys on a shape with no floor lines anywhere else.
    for (const t of [0.30, 0.50, 0.70]) {
      const z = neck0 + (neck1 - neck0) * t;
      const r = t <= 0.5 ? 0.22 + (0.74 - 0.22) * (t / 0.5) : 0.74 + (0.20 - 0.74) * ((t - 0.5) / 0.5);
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.014, fh * (r + 0.035), fh * (r + 0.035), 18, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
    }
    drawFacetDrum(ctx, cam, dx, dy, neck1, cap, fh * 0.20, fh * 0.16, 12, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    drawFacetDrum(ctx, cam, dx, dy, cap, tip, fh * 0.05, fh * 0.025, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.76);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, tip, '255,90,120', now, seed + 6, alpha, 1.4);
      glowPool(ctx, cam, dx, dy, belly, '164,230,255', 14, alpha * 0.24);
      const [gx, gy] = F(0, fh * 0.78); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  hf_links(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CHAIN — flat glazed plates threaded on the spine at alternating
    // yaws, each one a long lozenge rather than a drum, so the tower presents a wide face and
    // then a narrow one all the way up. It is the twist argument at one turn per floor instead
    // of a few degrees, and the shear is a rhythm rather than a slope.
    const LINKS = 7, podium = h * 0.06, top = h * 0.90, cap = h * 0.96, tip = h * 1.04;
    const span = (top - podium) / LINKS;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, cap, fh * 0.18, fh * 0.14, 12, alpha, hfChrome([80, 96, 112], [206, 220, 232], 2.1), null, 'ty_hf_chrome_dk');
    for (let i = 0; i < LINKS; i++) {
      const k = 1 - i / LINKS * 0.24, yw = faceYaw(E) + (i % 2 ? 1.5708 : 0);
      const z0 = podium + span * i, z1 = z0 + span * 0.82;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.66 * k, z0, z1, pal, seed + i, night, alpha, false, yw, fh * 0.28 * k);
      // A drum at each end of every link, which is what makes a box read as a lozenge — and
      // what stops two links at right angles showing a corner where they cross.
      for (const s of [-1, 1]) {
        const [qx, qy] = F(Math.cos(yw - faceYaw(E)) * s * fh * 0.62 * k, Math.sin(yw - faceYaw(E)) * s * fh * 0.62 * k);
        drawFacetDrum(ctx, cam, qx, qy, z0, z1, fh * 0.28 * k, fh * 0.28 * k, 12, alpha, hfGlass(night), null, pal);
      }
      // The pinch between links, standing proud of the spine, so the stack reads as threaded.
      drawFacetDrum(ctx, cam, dx, dy, z1 - h * 0.006, z0 + span + h * 0.006, fh * 0.22, fh * 0.22, 12, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
      if (night) glowPool(ctx, cam, dx, dy, (z0 + z1) * 0.5, '150,214,255', 9, alpha * 0.14);
    }
    drawFacetDrum(ctx, cam, dx, dy, cap, tip, fh * 0.05, fh * 0.025, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.76);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, tip, '255,90,120', now, seed + 8, alpha, 1.4);
      const [gx, gy] = F(0, fh * 0.78); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },
  hf_voidstack(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // DRUMS WITH DAYLIGHT BETWEEN THEM — four glazed blocks of flats
    // carried on the spine with an open plant floor at every joint, so the tower has gaps in
    // it you can see the sky through. The bead tower pinches at the plant level; this one
    // leaves it out altogether, which is a far louder version of the same diagram.
    const BLOCKS = 4, podium = h * 0.06, top = h * 0.88, cap = h * 0.94, tip = h * 1.02;
    const span = (top - podium) / BLOCKS;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, podium, cap, fh * 0.20, fh * 0.16, 12, alpha, hfChrome([80, 96, 112], [206, 220, 232], 2.1), null, 'ty_hf_chrome_dk');
    for (let i = 0; i < BLOCKS; i++) {
      const k = 1 - i / BLOCKS * 0.20;
      const z0 = podium + span * i + span * 0.16, z1 = podium + span * (i + 1);
      drawFacetDrum(ctx, cam, dx, dy, z0, z1, fh * 0.60 * k, fh * 0.56 * k, 16, alpha, hfGlass(night), null, pal);
      drawFacetDrum(ctx, cam, dx, dy, z1, z1 + h * 0.018, fh * (0.64 * k), fh * (0.64 * k), 16, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), hfChrome([108, 124, 140], [210, 224, 232], 1.4), 'ty_hf_chrome');
      drawFacetDrum(ctx, cam, dx, dy, z0 - h * 0.018, z0, fh * (0.64 * k), fh * (0.64 * k), 16, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
      // ⚠ THE VOID NEEDS COLUMNS OR THE BLOCK ABOVE IT IS FLOATING. Four of them on a ring,
      //   narrow enough that the gap still reads as a gap from a mile off.
      if (i > 0) for (let c = 0; c < 4; c++) {
        const a = c / 4 * 6.2832 + 0.7854, r = fh * 0.44 * k;
        drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, z0 - span * 0.16, z0, fh * 0.045, fh * 0.042, 6, alpha, hfChrome([90, 106, 122], [228, 238, 246], 2.1), null, 'ty_hf_chrome_dk');
      }
      if (night) glowPool(ctx, cam, dx, dy, z0 - span * 0.08, '186,236,255', 8, alpha * 0.22);   // the void is the lit part, which is the whole read after dark
    }
    drawFacetDrum(ctx, cam, dx, dy, cap, tip, fh * 0.05, fh * 0.025, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.76);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, tip, '255,90,120', now, seed + 9, alpha, 1.4);
      const [gx, gy] = F(0, fh * 0.78); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },
  hf_lozenge(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // NOT A CIRCLE — a stadium in plan, wide to the street and thin from
    // the side, which is the one thing a quarter drawn almost entirely with `drawFacetDrum`
    // cannot do by accident. Every other tower here looks the same from every direction; this
    // one is a slab from the boulevard and a blade from the mews, and the name on the tile is
    // the ratio it is sold on.
    const podium = h * 0.06, top = h * 0.92, cope = h * 0.97, mast = h * 1.06;
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 0.96, fh * 0.90, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    // The straight run, and a full-height drum at each end of it. ⚠ THE DRUMS ARE THE PLAN.
    // A box on its own is a slab and this quarter has one of those already; the round ends are
    // what put a stadium plan in a district of cylinders rather than a warehouse in it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.56, podium, top, pal, seed, night, alpha, false, faceYaw(E), fh * 0.26);
    for (const s of [-1, 1]) {
      const [qx, qy] = F(s * fh * 0.56, 0);
      drawFacetDrum(ctx, cam, qx, qy, podium, top, fh * 0.26, fh * 0.23, 14, alpha, hfGlass(night), null, pal);
    }
    // The floor bands, running round the whole lozenge — one box and two drums per band, which
    // is the only way a horizontal can follow a plan made of three pieces.
    for (let i = 1; i <= 5; i++) {
      const z = podium + (top - podium) * (i / 6);
      draw3DBoxAt(ctx, cam, dx, dy, fh * 0.59, z, z + h * 0.012, 'ty_hf_chrome', seed + i, night, alpha, true, faceYaw(E), fh * 0.29);
      for (const s of [-1, 1]) {
        const [qx, qy] = F(s * fh * 0.56, 0);
        drawFacetDrum(ctx, cam, qx, qy, z, z + h * 0.012, fh * 0.29, fh * 0.29, 14, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
      }
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.60, top, cope, 'ty_hf_chrome', seed + 10, night, alpha, true, faceYaw(E), fh * 0.30);
    drawFacetDrum(ctx, cam, dx, dy, cope, mast, fh * 0.06, fh * 0.03, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.44);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 11, alpha, 1.4);
      const [gx, gy] = F(0, fh * 0.46); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },

  // ── THE BENT ONES. Five plots carry `chrome_slab`, which is a crescent — a wall that bends,
  // built out of straight boxes with drums at the joints. That construction is good for far more
  // than one curve, and these four spend it on a curve that changes its mind, a corner taken out,
  // a fan, and a building that was something else first.
  hf_scurve(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CURVE THAT CHANGES ITS MIND — a crescent that bends one way for
    // half its length and the other way for the rest, so the plan is an S. From the road it is
    // a curve; from the air it is two, which is a thing you cannot tell about the crescent
    // itself from any angle at all.
    const top = h * 0.86, cope = h * 0.93, bend = 0.20;
    const SEG = [[-0.76, -0.24, bend], [-0.26, -0.03, bend * 0.4], [0.26, 0.03, -bend * 0.4], [0.76, 0.24, -bend]];
    for (const [i, [u, v, yw]] of SEG.entries()) {
      const [bx, by2] = F(u * fh, v * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.32, 0, top, pal, seed + i, night, alpha, false, faceYaw(E) + yw, fh * 0.32);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.35, top, cope, 'ty_hf_chrome', seed + 10 + i, night, alpha, true, faceYaw(E) + yw, fh * 0.35);
    }
    // The joints, and both ends. ⚠ THE MIDDLE JOINT IS THE ONE THAT MATTERS — it is where the
    // curvature reverses, which is the one place three straight boxes cannot hide a mitre.
    for (const [u, v] of [[-1.00, -0.40], [-0.52, -0.12], [0, 0], [0.52, 0.12], [1.00, 0.40]]) {
      const [qx, qy] = F(u * fh, v * fh);
      drawFacetDrum(ctx, cam, qx, qy, 0, cope, fh * 0.19, fh * 0.18, 12, alpha, hfChrome([86, 102, 118], [234, 244, 250], 2.2), hfChrome([98, 114, 130], [204, 218, 228], 1.4), 'ty_hf_chrome');
    }
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.05, fh * 1.00, fh * 0.98, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    if (night) {
      blinkLight(ctx, cam, dx, dy, cope, '255,90,120', now, seed + 20, alpha, 1.2);
      glowPool(ctx, cam, dx, dy, h * 0.04, '130,206,255', 17, alpha * 0.22);
    }
  },
  hf_notch(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A SQUARE TAKEN OUT OF THE TOP CORNER — a plain slab with a void cut
    // out of one end of its roof, so a fifth of the building is missing and the missing part is
    // the part you look at. ⚠ THE NOTCH IS BUILT RATHER THAN CUT, like the ring's hole: an L of
    // two boxes plus a low third, and what makes it read is the chrome lining the reveal, which
    // is the only surface on the building facing into the void.
    const base = h * 0.05, top = h * 0.92, low = h * 0.52, cope = h * 0.98;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    // The tall part…
    { const [bx, by2] = F(-fh * 0.34, 0);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.60, base, top, pal, seed, night, alpha, false, faceYaw(E), fh * 0.56);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.64, top, cope, 'ty_hf_chrome', seed + 1, night, alpha, true, faceYaw(E), fh * 0.60); }
    // …and the low part under the notch, with its own coping, which is the floor of the void.
    { const [bx, by2] = F(fh * 0.56, 0);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.36, base, low, pal, seed + 2, night, alpha, false, faceYaw(E), fh * 0.56);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.40, low, low + h * 0.024, 'ty_hf_chrome', seed + 3, night, alpha, true, faceYaw(E), fh * 0.60); }
    // The reveal — the face of the tall part that looks into the notch, lined in chrome so the
    // void has an edge rather than being a place the glass happens to stop.
    { const [rx, ry] = F(fh * 0.20, 0);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.035, low, cope, 'ty_hf_chrome', seed + 4, night, alpha, true, faceYaw(E), fh * 0.58); }
    { const [cx1, cy1] = F(-fh * 0.34, fh * 0.60);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.052, h * 0.070, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, cope, '255,90,120', now, seed + 5, alpha, 1.3);
      // Lit INTO the notch, which is the only way anybody would ever see a roof terrace a
      // hundred feet up from the pavement.
      { const [nx, ny] = F(fh * 0.50, 0); glowPool(ctx, cam, nx, ny, low + h * 0.03, '186,236,255', 10, alpha * 0.30); }
      const [gx, gy] = F(-fh * 0.34, fh * 0.62); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.26);
    }
  },
  hf_fan(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE FAN — five blocks radiating from one hinge at the back of the plot,
    // each a little taller and a little longer than the last, so the building opens like a hand
    // of cards. The crescent bends a wall along a constant radius; this swings whole masses
    // about a point, which is the same primitive making a completely different plan.
    const base = h * 0.05, HINGE = -0.58;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    for (let i = 0; i < 5; i++) {
      const a = (-0.58 + i * 0.29);                 // the swing of this leaf, about the hinge
      const len = 0.46 + i * 0.075, top = h * (0.42 + i * 0.115);
      const [bx, by2] = F(Math.sin(a) * len * fh, HINGE * fh + Math.cos(a) * len * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.12, base, top, pal, seed + i, night, alpha, false, faceYaw(E) + a, fh * len);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.15, top, top + h * 0.022, 'ty_hf_chrome', seed + 10 + i, night, alpha, true, faceYaw(E) + a, fh * (len + 0.03));
      if (night) glowPool(ctx, cam, bx, by2, top + h * 0.02, '150,226,255', 7, alpha * 0.16);
    }
    // The hinge itself — a full-height drum at the back of the plot, taller than every leaf,
    // which is where the lifts are and the only thing holding the fan together.
    { const [hx, hy] = F(0, HINGE * fh);
      drawFacetDrum(ctx, cam, hx, hy, 0, h * 0.98, fh * 0.26, fh * 0.22, 14, alpha, hfChrome([96, 112, 128], [236, 246, 250], 2.0), hfChrome([106, 122, 138], [206, 220, 230], 1.4), 'ty_hf_chrome');
      if (night) { blinkLight(ctx, cam, hx, hy, h * 0.98, '255,90,120', now, seed + 20, alpha, 1.3);
        helixRunner(ctx, cam, hx, hy, base, h * 0.94, fh * 0.27, fh * 0.24, 0.8, faceYaw(E), 16, '74,168,255', night, alpha); } }
    { const [cx1, cy1] = F(0, fh * 0.30);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.28, fh * 0.28, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) { const [gx, gy] = F(0, fh * 0.32); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.26); }
  },
  hf_converted(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ONE THAT WAS HERE FIRST — a plain grey shed from before the
    // estate with a chrome-and-glass building landed on top of it and hanging over the back.
    // Halcyon Fields was a meadow with sheds on it and the brochure does not mention them, so
    // the one surviving shed is the only thing in the quarter that is OLDER than the quarter,
    // and the join is where you can see what happened.
    //
    // ⚠ THE BASE IS THE DULL PALETTE ON PURPOSE. `ty_hf_slab` is already the bare-floor grey
    // the shells use; spending it on a survivor gives the join a real value step without a new
    // colour, which is the rule the whole campaign runs on.
    const shed = h * 0.38, para = h * 0.44, top = h * 0.90, cope = h * 0.96;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, 0, shed, 'ty_hf_slab', seed, night, alpha, false, faceYaw(E), fh * 0.80);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, shed, para, 'ty_hf_chrome_dk', seed + 1, night, alpha, true, faceYaw(E), fh * 0.82);
    // The parasite: set back at the front so the old parapet still reads from the street, and
    // cantilevered out over the back where nobody was going to complain.
    { const [bx, by2] = F(0, -fh * 0.22);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.76, para, top, pal, seed + 2, night, alpha, false, faceYaw(E), fh * 0.64);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.80, top, cope, 'ty_hf_chrome', seed + 3, night, alpha, true, faceYaw(E), fh * 0.68);
      // The props under the overhang, which is the only structure in the quarter that had to be
      // added to a building that did not expect it.
      for (const s of [-1, 1]) {
        const [px, py] = F(s * fh * 0.62, -fh * 0.78);
        drawFacetDrum(ctx, cam, px, py, 0, para, fh * 0.070, fh * 0.060, 8, alpha, hfChrome([88, 104, 120], [230, 240, 248], 2.2), null, 'ty_hf_chrome_dk');
      }
      if (night) helixRunner(ctx, cam, bx, by2, para, top, fh * 0.78, fh * 0.78, 0.5, faceYaw(E), 18, '74,168,255', night, alpha); }
    // The old loading door, still in the base, still where it was.
    { const [dx1, dy1] = F(-fh * 0.30, fh * 0.80);
      draw3DBoxAt(ctx, cam, dx1, dy1, fh * 0.26, 0, shed * 0.62, 'ty_hf_chrome_dk', seed + 4, night, alpha, false, faceYaw(E), fh * 0.04); }
    { const [cx1, cy1] = F(fh * 0.34, fh * 0.80);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.26, fh * 0.26, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, cope, '255,90,120', now, seed + 5, alpha, 1.3);
      const [gx, gy] = F(fh * 0.34, fh * 0.82); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },

  // ── THE SHEARED ONES. Four plots carry `torque_tower`, the twisted shaft. Three other things
  // a tower can do to its own plan as it rises: sit on something heavier than itself, come to a
  // point on one side, or grow a head.
  hf_vault(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE STRONGBOX — a heavy battered chrome plinth, four storeys of it,
    // with the glass standing on top. Everything else in the quarter meets the pavement in
    // glass because glass is what the estate is selling; this one meets it in a sloping wall
    // with no openings at all, which is what a building says when the thing inside it is money.
    const vault = h * 0.24, plinth = h * 0.28, top = h * 0.90, cope = h * 0.96, mast = h * 1.05;
    // ⚠ THE BATTER IS THE BUILDING. A vertical plinth is a podium and every tower here has one;
    // a wall that leans IN as it rises is a fortification, and that is the whole read.
    drawFacetDrum(ctx, cam, dx, dy, 0, vault, fh * 1.00, fh * 0.80, 8, alpha, hfChrome([92, 104, 116], [206, 218, 228], 2.2), null, 'ty_hf_chrome_dk');
    drawFacetDrum(ctx, cam, dx, dy, vault, plinth, fh * 0.84, fh * 0.82, 8, alpha, hfChrome([116, 132, 148], [236, 244, 250], 1.8), hfChrome([124, 140, 156], [208, 222, 230], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, plinth, top, fh * 0.58, fh * 0.50, 16, alpha, hfGlass(night), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, top, cope, fh * 0.62, fh * 0.46, 16, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    drawFacetDrum(ctx, cam, dx, dy, cope, mast, fh * 0.06, fh * 0.03, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    // The one opening: a slot of a doorway cut into the batter, with a chrome surround as deep
    // as the wall is thick. A door in a sloping wall has to be a tunnel and looks like one.
    { const [ex, ey] = F(0, fh * 0.90);
      draw3DBoxAt(ctx, cam, ex, ey, fh * 0.22, 0, h * 0.13, 'ty_hf_ice', seed + 1, night, alpha, true, faceYaw(E), fh * 0.10);
      if (night) glowPool(ctx, cam, ex, ey, h * 0.07, '206,238,255', 9, alpha * 0.34); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 2, alpha, 1.4);
      helixRunner(ctx, cam, dx, dy, plinth, plinth + h * 0.012, fh * 0.86, fh * 0.86, 1, 0, 24, '150,226,255', night, alpha);
      glowPool(ctx, cam, dx, dy, cope, '150,226,255', 12, alpha * 0.24);
    }
  },
  hf_prow(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE PROW — a wedge in plan with its point turned at the boulevard, so
    // the tower is a blade from one end of the street and a slab from the other. It is the one
    // building in the quarter that is a different WIDTH depending on where you are standing
    // rather than a different shape, and on the tallest plot here that is a lot of difference.
    const base = h * 0.06, top = h * 0.94, cope = h * 0.99, mast = h * 1.08;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 0.98, fh * 0.94, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    // The wedge, as three boxes of falling width stacked FORWARD rather than upward — which is
    // how you draw a triangle in plan out of a primitive that only makes rectangles.
    for (const [i, [ly, hw]] of [[-0.30, 0.60], [0.10, 0.40], [0.42, 0.20]].entries()) {
      const [bx, by2] = F(0, ly * fh);
      draw3DBoxAt(ctx, cam, bx, by2, fh * hw, base, top, pal, seed + i, night, alpha, false, faceYaw(E), fh * 0.28);
      draw3DBoxAt(ctx, cam, bx, by2, fh * (hw + 0.035), top, cope, 'ty_hf_chrome', seed + 10 + i, night, alpha, true, faceYaw(E), fh * 0.31);
    }
    // The nose — a narrow full-height drum right at the point, which rounds the wedge off and
    // is the part of the building the boulevard actually sees.
    { const [nx, ny] = F(0, fh * 0.66);
      drawFacetDrum(ctx, cam, nx, ny, base, cope, fh * 0.20, fh * 0.17, 12, alpha, hfGlass(night), null, pal);
      if (night) helixRunner(ctx, cam, nx, ny, base, top, fh * 0.28, fh * 0.25, 0, faceYaw(E), 18, '120,206,255', night, alpha); }
    drawFacetDrum(ctx, cam, dx, dy, cope, mast, fh * 0.07, fh * 0.035, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(-fh * 0.40, fh * 0.34);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.062, h * 0.080, fh * 0.28, fh * 0.28, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 20, alpha, 1.5);
      const [gx, gy] = F(-fh * 0.40, fh * 0.36); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28);
    }
  },
  hf_hammerhead(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // ALL THE FLOORSPACE AT THE TOP — a slender shaft carrying a crown
    // four times its own width, cantilevered out on every side. Every other tower in the
    // quarter puts its best floor at the top and keeps it the same size as the rest; this one
    // is a building whose whole purpose is the last five storeys, and the shaft is a stalk.
    const base = h * 0.06, stalk = h * 0.62, headTop = h * 0.92, cope = h * 0.97, mast = h * 1.06;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 0.86, fh * 0.80, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, base, headTop, fh * 0.28, fh * 0.24, 14, alpha, hfChrome([88, 104, 120], [222, 234, 242], 2.0), null, 'ty_hf_chrome_dk');
    // The head. ⚠ IT FLARES OUT RATHER THAN SITTING ON A SHELF — a box dropped on a stick is a
    // hammer, and the splayed course under it is what makes it read as carried.
    drawFacetDrum(ctx, cam, dx, dy, stalk, stalk + h * 0.09, fh * 0.30, fh * 0.80, 16, alpha, hfChrome([100, 116, 132], [238, 246, 250], 1.9), null, 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, stalk + h * 0.09, headTop, fh * 0.80, fh * 0.74, 16, alpha, hfGlass(night), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, headTop, cope, fh * 0.84, fh * 0.70, 16, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
    drawFacetDrum(ctx, cam, dx, dy, cope, mast, fh * 0.06, fh * 0.03, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    { const [cx1, cy1] = F(0, fh * 0.60);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.055, h * 0.072, fh * 0.28, fh * 0.28, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 3, alpha, 1.5);
      // ⚠ LIT UNDER THE OVERHANG. A cantilever this deep is a soffit, and a soffit nobody
      //   lights is a black lid over a lit shaft, which reads as the head being a hole.
      glowPool(ctx, cam, dx, dy, stalk, '176,232,255', 16, alpha * 0.28);
      helixRunner(ctx, cam, dx, dy, base, stalk, fh * 0.29, fh * 0.25, 1.2, faceYaw(E), 16, '74,168,255', night, alpha);
      const [gx, gy] = F(0, fh * 0.62); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.26);
    }
  },

  // ── THE CUT ONES. Three plots carry `glass_prism`, the six-facet needle. One of the two below
  // is the quarter's hero and the other is the needle knocked off true.
  hf_shard(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CRYSTAL — an irregular faceted prism with a flat cut top, leaning
    // off vertical. Nothing else in Coldwater leans: the arch's legs curve and the twist
    // shears, but every shaft in the Basin is plumb, so a tower visibly off true is the one
    // silhouette here that reads as WRONG at a glance and then turns out to be deliberate.
    //
    // ⚠ THE LEAN IS A STACK OF OFFSETS AND NOT A ROTATION. `drawFacetDrum` extrudes straight up
    // the z axis, so a leaning shaft is drums walking sideways as they rise — the same
    // approximation `chrome_arch` makes for its legs, and the overlap rule that comes with it.
    const LIFTS = 12, plinth = h * 0.06, top = h * 0.94, LEAN = 0.34;
    drawFacetDrum(ctx, cam, dx, dy, 0, plinth, fh * 0.92, fh * 0.84, 12, alpha, hfChrome([114, 130, 146], [228, 240, 246], 1.8), hfChrome([124, 140, 154], [202, 216, 226], 1.4), 'ty_hf_chrome');
    for (let i = 0; i < LIFTS; i++) {
      const t0 = i / LIFTS, t1 = (i + 1) / LIFTS;
      const [bx, by2] = F(LEAN * t0 * fh * 0.5 + LEAN * t1 * fh * 0.5, -LEAN * 0.4 * (t0 + t1) * 0.5 * fh);
      // ⚠ THE LIFTS OVERLAP IN z, or every course of a leaning stack shows a wedge of sky on
      //   the outside of the lean.
      const z0 = plinth + (top - plinth) * t0, z1 = plinth + (top - plinth) * Math.min(1, t1 + 0.5 / LIFTS);
      const r0 = 0.66 + (0.30 - 0.66) * t0, r1 = 0.66 + (0.30 - 0.66) * t1;
      drawFacetDrum(ctx, cam, bx, by2, z0, z1, fh * r0, fh * r1, 5, alpha, hfGlass(night), null, pal);
    }
    // The cut — a chrome plate on top, and it is NOT level: a crystal snapped across is what
    // gives the lean something to end in, where a flat cap would read as a roof.
    { const [tx, ty2] = F(LEAN * fh, -LEAN * 0.4 * fh);
      drawFacetDrum(ctx, cam, tx, ty2, top, top + h * 0.04, fh * 0.32, fh * 0.26, 5, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), hfChrome([112, 128, 144], [206, 220, 230], 1.3), 'ty_hf_ice');
      if (night) { blinkLight(ctx, cam, tx, ty2, top + h * 0.04, '255,90,120', now, seed + 4, alpha, 1.5);
        glowPool(ctx, cam, tx, ty2, top, '164,230,255', 11, alpha * 0.24); } }
    // The buttress on the low side, which is the only thing that makes a leaning tower look
    // like it was meant rather than like it is going over.
    { const [px, py] = F(-fh * 0.52, fh * 0.30);
      drawFacetDrum(ctx, cam, px, py, 0, h * 0.44, fh * 0.16, fh * 0.09, 8, alpha, hfChrome([88, 104, 120], [228, 238, 246], 2.2), null, 'ty_hf_chrome_dk'); }
    { const [cx1, cy1] = F(0, fh * 0.76);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.052, h * 0.070, fh * 0.30, fh * 0.30, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) { const [gx, gy] = F(0, fh * 0.78); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 11, alpha * 0.28); }
  },
  hf_ceiling(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // ★ HALCYON POINT — THE QUARTER'S HERO. Two shafts of unequal height
    // carrying one enormous glazed plate across the top of both, oversailing them on every
    // side. It stands on the tallest plot in Halcyon Fields, at the east end of the boulevard
    // frontage, and it is the thing the estate is sold on: the brochure's photograph is taken
    // from underneath.
    //
    // Why this shape and not another tall one. The quarter already has a pair-and-a-bridge
    // (`sky_court`), and that building's link is a CORRIDOR — a box slung between two towers at
    // two-thirds height with sky above it. This is the opposite move: the plate is the top of
    // the building, it is far wider than what holds it up, and it turns the whole composition
    // into one object with a lid rather than two objects with a connection. From the Basin it
    // is the only flat horizontal on a skyline of points, masts and copings, which is exactly
    // what makes a landmark findable — `glass_prism`'s argument, inverted.
    //
    // ⚠ THE OVERHANG IS THE BUILDING AND IT IS EXPENSIVE TO GET RIGHT. A plate that merely
    // spans the two shafts is a bridge; what makes it a ceiling is that it reaches well past
    // both of them on all four sides, so from under it you cannot see the sky and from the air
    // the shafts are hidden by their own roof.
    // ⚠ AND IT IS LIT FROM UNDERNEATH FOR `lens_hall`'s REASON. A deep soffit nobody lights is
    // a black lid, and a black lid on two lit shafts reads as damage.
    const podium = h * 0.07, plateZ0 = h * 0.84, plateZ1 = h * 0.92, cope = h * 0.97, mast = h * 1.10;
    // 1) THE PODIUM, spanning the plot, with the lobby between the two shafts.
    drawFacetDrum(ctx, cam, dx, dy, 0, podium, fh * 1.02, fh * 0.98, 20, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_deck');
    // 2) THE TWO SHAFTS. ⚠ UNEQUAL, `sky_court`'s rule — two identical towers read as a
    //    mistake — and BOTH STOP BELOW THE PLATE, because a shaft that pokes through its own
    //    ceiling is a tower with a collar rather than a building with a lid.
    for (const [i, [u, tz, rb, rt]] of [[-0.44, 0.84, 0.34, 0.30], [0.44, 0.72, 0.28, 0.25]].entries()) {
      const [tx, ty2] = F(u * fh, 0);
      drawFacetDrum(ctx, cam, tx, ty2, podium, plateZ0 * tz, fh * rb, fh * rt, 16, alpha, hfGlass(night), null, pal);
      // The shoulder where each shaft meets the plate's underside — a splayed chrome course, so
      // the plate is visibly CARRIED rather than balanced.
      drawFacetDrum(ctx, cam, tx, ty2, plateZ0 * tz, plateZ0, fh * rt, fh * (rt + 0.16), 16, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), null, 'ty_hf_chrome');
      if (night) {
        helixRunner(ctx, cam, tx, ty2, podium, plateZ0 * tz, fh * (rb + 0.02), fh * (rt + 0.02), 1.1, 0.7854 + i * 3.1416, 20, '74,168,255', night, alpha);
        glowPool(ctx, cam, tx, ty2, plateZ0 * tz, '150,226,255', 9, alpha * 0.20);
      }
    }
    // 3) THE PLATE. Glass, with a chrome fascia round it and a chrome soffit under it, drawn as
    //    three courses so the edge has a real thickness — a single box reads as a sheet of card.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, plateZ0, plateZ0 + h * 0.018, 'ty_hf_chrome', seed + 1, night, alpha, true, faceYaw(E), fh * 0.86);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, plateZ0 + h * 0.018, plateZ1, pal, seed + 2, night, alpha, false, faceYaw(E), fh * 0.84);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, plateZ1, cope, 'ty_hf_chrome', seed + 3, night, alpha, true, faceYaw(E), fh * 0.88);
    // 4) THE ROOFTOP ARMATURE and the mast, which is what the Ascendants put on everything they
    //    own — and on the quarter's tallest building it is the last thing above the plate.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.34, cope, cope + h * 0.055, 'ty_hf_chrome_dk', seed + 4, night, alpha, true, faceYaw(E), fh * 0.16);
    drawFacetDrum(ctx, cam, dx, dy, cope + h * 0.055, mast, fh * 0.055, fh * 0.028, 8, alpha, hfChrome([84, 100, 116], [222, 234, 242], 2.4), null, 'ty_hf_chrome_dk');
    // 5) THE ENTRANCE — between the shafts, under the middle of the plate, which is the one
    //    place in Halcyon Fields where the thing above your head is eight hundred feet of glass.
    { const [cx1, cy1] = F(0, fh * 0.82);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.062, h * 0.085, fh * 0.40, fh * 0.40, 14, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    // 6) THE NAME, on the plate's fascia. ⚠ IT IS THE ONLY LETTERING ON ANY OF THE FORTY-TWO
    //    AND THAT IS WHAT MAKES IT THE HERO — `SIGN_WORD`'s own rule is that what makes a street
    //    read is that the signs say different things, and in a quarter of identical developer
    //    product one named building is a landmark while forty-two are a catalogue.
    if (frontVis) {
      const P = (lx1, ly1, z) => { const [wx, wy] = F(lx1, ly1); return cam.proj(wx, wy, z); };
      const z0 = plateZ1 + h * 0.008, z1 = cope - h * 0.008, bhw = fh * 0.72, by = fh * 0.88;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'HALCYON POINT', '#bfe8ff', night ? 1 : 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      blinkLight(ctx, cam, dx, dy, mast, '255,90,120', now, seed + 5, alpha, 1.7);
      // The soffit, lit right across — the plate's underside is the biggest single surface in
      // the quarter and after dark it is the only one anybody looks up at.
      glowPool(ctx, cam, dx, dy, plateZ0 - h * 0.02, '186,236,255', 26, alpha * 0.32);
      helixRunner(ctx, cam, dx, dy, cope, cope + h * 0.012, fh * 1.03, fh * 1.03, 1, 0, 40, '150,226,255', night, alpha);
      const [gx, gy] = F(0, fh * 0.84); glowPool(ctx, cam, gx, gy, h * 0.05, '206,238,255', 15, alpha * 0.32);
    }
  },

  // ── AND FIVE SINGLES, one for each remaining type with two plots on it.
  hf_sunkdrum(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // HALF IN THE GROUND — a shallow glazed drum sunk into its own
    // podium, so what stands above the pavement is a band of glass and a lid and nothing else.
    // `lens_hall` lifts its disc onto pylons and this one drops the same disc into a hole,
    // which is the opposite gesture with the same primitive and reads nothing like it.
    const rim = h * 0.30, glass = h * 0.66, lid = h * 0.80, boss = h * 0.92;
    // The sunken forecourt: a wide ring of paving standing proud, which is what tells you the
    // building goes DOWN rather than being short.
    drawFacetDrum(ctx, cam, dx, dy, 0, rim, fh * 1.02, fh * 1.00, 20, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, rim, glass, fh * 0.74, fh * 0.72, 20, alpha, hfGlass(night, [70, 102, 128]), null, pal);
    // The lid — a shallow chrome dome over the glass, oversailing it, which is the only part of
    // the building visible from more than a street away.
    drawFacetDrum(ctx, cam, dx, dy, glass, lid, fh * 0.80, fh * 0.52, 20, alpha, hfChrome([104, 120, 136], [242, 248, 252], 1.8), null, 'ty_hf_chrome');
    drawFacetDrum(ctx, cam, dx, dy, lid, boss, fh * 0.50, fh * 0.26, 16, alpha, hfChrome([112, 128, 144], [244, 249, 252], 1.7), hfChrome([120, 136, 150], [212, 226, 234], 1.3), 'ty_hf_ice');
    // The stair down into the sunken court, on the entrance side.
    { const [sx1, sy1] = F(0, fh * 0.88);
      draw3DBoxAt(ctx, cam, sx1, sy1, fh * 0.30, 0, rim * 0.55, 'ty_hf_ice', seed + 1, night, alpha, true, faceYaw(E), fh * 0.16); }
    if (night) {
      // ⚠ THE LIGHT COMES OUT OF THE GROUND. A ring of glass at ankle height washing a paved
      //   rim is the one lighting condition this quarter has nowhere else, and it is the entire
      //   reason to put a building in a hole.
      glowPool(ctx, cam, dx, dy, rim, '186,236,255', 20, alpha * 0.34);
      glowPool(ctx, cam, dx, dy, lid, '150,226,255', 10, alpha * 0.18);
      blinkLight(ctx, cam, dx, dy, boss, '255,90,120', now, seed + 2, alpha, 1.1);
    }
  },
  hf_palmhouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ACTUAL GLASSHOUSE — a long barrel-vaulted glass shed on a low
    // chrome plinth, with planting the whole length of it. The district next door is called the
    // Glasshouse and there has never been one anywhere in it, which is the sort of thing this
    // quarter should be allowed exactly one joke about.
    //
    // ⚠ THE VAULT IS A STACK OF BOXES, because nothing here extrudes an arch: seven courses of
    // falling width over a constant depth reads as a barrel at any range this is seen from, and
    // the chrome ribs across it are what stop it reading as a ziggurat.
    const plinth = h * 0.08, RINGS = 11, vault = h * 0.92;
    drawFacetDrum(ctx, cam, dx, dy, 0, plinth, fh * 1.00, fh * 0.98, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    for (let i = 0; i < RINGS; i++) {
      const t = (i + 0.5) / RINGS;
      const hw = 0.66 * Math.cos(t * 1.5708) + 0.06;     // the half-width of this course of the barrel
      const z0 = plinth + (vault - plinth) * (i / RINGS), z1 = plinth + (vault - plinth) * ((i + 1.1) / RINGS);
      draw3DBoxAt(ctx, cam, dx, dy, fh * hw, z0, Math.min(vault, z1), pal, seed + i, night, alpha, false, faceYaw(E), fh * 0.88);
    }
    // The ribs — five chrome hoops across the vault, each one a short stack of its own, which is
    // what tells you the glass is held in something.
    for (let r = 0; r < 5; r++) {
      const ly = (-0.68 + r * 0.34) * fh;
      for (let i = 0; i < RINGS; i++) {
        const t = (i + 0.5) / RINGS, hw = 0.66 * Math.cos(t * 1.5708) + 0.06;
        const z0 = plinth + (vault - plinth) * (i / RINGS), z1 = plinth + (vault - plinth) * ((i + 1.1) / RINGS);
        const [bx, by2] = F(0, ly);
        draw3DBoxAt(ctx, cam, bx, by2, fh * (hw + 0.025), z0, Math.min(vault, z1), 'ty_hf_chrome', seed + 20 + r * 8 + i, night, alpha, false, faceYaw(E), fh * 0.035);
      }
    }
    // The porch at the end, which is the door and the only opaque thing on the building.
    { const [px, py] = F(0, fh * 0.92);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.28, plinth, plinth + h * 0.34, 'ty_hf_ice', seed + 70, night, alpha, true, faceYaw(E), fh * 0.10); }
    if (night) {
      // ⚠ GREEN, AND THE ONLY GREEN BUILDING IN THE QUARTER. `cascade_block`'s own rule is that
      //   one green terrace is a garden and five are a colour scheme; a whole glasshouse lit
      //   from the inside is what that rule was saving the colour for.
      glowPool(ctx, cam, dx, dy, plinth + h * 0.22, '140,232,182', 18, alpha * 0.34);
      const [gx, gy] = F(0, fh * 0.94); glowPool(ctx, cam, gx, gy, h * 0.06, '206,238,255', 10, alpha * 0.26);
    }
  },
  hf_rootfarm(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE FARM UPSIDE DOWN — growing trays hung UNDER a stack of
    // cantilevers instead of standing on them, so the crop is seen from below and the roots are
    // the lit part. `vertical_farm` is a core with trays on it; this is the same core with the
    // trays on the wrong side, which turns a tower of shelves into a tower of chandeliers.
    const base = h * 0.05, top = h * 0.90, ARMS = 6;
    drawFacetDrum(ctx, cam, dx, dy, 0, base, fh * 0.92, fh * 0.88, 16, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    drawFacetDrum(ctx, cam, dx, dy, base, top + h * 0.04, fh * 0.30, fh * 0.26, 14, alpha, hfChrome([88, 104, 120], [226, 238, 246], 2.0), hfChrome([96, 112, 128], [202, 216, 226], 1.4), 'ty_hf_chrome');
    for (let i = 0; i < ARMS; i++) {
      const z = base + (top - base) * ((i + 0.6) / ARMS), k = 1 - i / ARMS * 0.18;
      // The cantilever — a chrome deck standing out well past the core…
      drawFacetDrum(ctx, cam, dx, dy, z, z + h * 0.020, fh * 0.86 * k, fh * 0.86 * k, 16, alpha, hfChrome([100, 116, 132], [240, 248, 252], 1.9), hfChrome([108, 124, 140], [210, 224, 232], 1.4), 'ty_hf_chrome');
      // …and the tray slung underneath it, which is the crop. ⚠ IT HANGS BELOW THE DECK RATHER
      //   THAN SITTING ON IT, and that one sign is the whole building.
      drawFacetDrum(ctx, cam, dx, dy, z - h * 0.055, z, fh * 0.80 * k, fh * 0.84 * k, 16, alpha, hfChrome([84, 52, 96], [214, 132, 226], 1.6), null, 'ty_hfv_tray');
      if (night) glowPool(ctx, cam, dx, dy, z - h * 0.06, '212,128,226', 12, alpha * 0.30);   // the grow lamps, which point DOWN here and are the only magenta in Halcyon Fields
    }
    { const [cx1, cy1] = F(0, fh * 0.76);
      drawFacetDrum(ctx, cam, cx1, cy1, h * 0.05, h * 0.068, fh * 0.28, fh * 0.28, 12, alpha, hfChrome([122, 138, 152], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [214, 228, 236], 1.3), 'ty_hf_ice'); }
    if (night) {
      blinkLight(ctx, cam, dx, dy, top + h * 0.04, '255,90,120', now, seed + 3, alpha, 1.3);
      const [gx, gy] = F(0, fh * 0.78); glowPool(ctx, cam, gx, gy, h * 0.04, '206,238,255', 10, alpha * 0.26);
    }
  },
  hf_stophalt(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE END OF THE LINE — one platform, one mast, a wire, and no
    // canopy. `transit_halt` is a station the estate built to prove the quarter is connected;
    // this is the other one, at the far end, where the money ran out one stop early — so it is
    // a halt with nothing over it and a line that visibly STOPS, which is a silhouette made
    // almost entirely of what is missing.
    const deck = h * 0.30, deckTop = h * 0.38;
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.05, fh * 1.00, fh * 0.96, 18, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_hf_deck');
    // The viaduct piers and the deck they carry — the same structure as the other halt, so the
    // two read as one line rather than as two unrelated buildings.
    for (const u of [-0.70, -0.24, 0.24, 0.70]) {
      const [px, py] = F(u * fh, 0);
      drawFacetDrum(ctx, cam, px, py, 0, deck, fh * 0.13, fh * 0.11, 10, alpha, hfChrome([96, 112, 128], [230, 240, 248], 2.1), null, 'ty_hf_chrome_dk');
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, deck, deckTop, 'ty_hf_chrome', seed, night, alpha, true, faceYaw(E), fh * 0.26);
    // The buffer stop at the far end, which is the thing that makes it the end of the line.
    { const [bx, by2] = F(fh * 0.86, 0);
      draw3DBoxAt(ctx, cam, bx, by2, fh * 0.10, deckTop, deckTop + h * 0.09, 'ty_hf_slab', seed + 1, night, alpha, true, faceYaw(E), fh * 0.24); }
    // The mast and its wire, and a single lamp. ⚠ THE WIRE IS A STROKE AND THE MAST IS MASS:
    // one is structure you would hit and the other is a line in the air.
    { const [mx1, my1] = F(-fh * 0.60, -fh * 0.20), [ex, ey] = F(fh * 0.80, -fh * 0.20);
      drawFacetDrum(ctx, cam, mx1, my1, deckTop, deckTop + h * 0.34, fh * 0.045, fh * 0.035, 8, alpha, hfChrome([90, 106, 122], [228, 238, 246], 2.2), null, 'ty_hf_chrome_dk');
      emitWire(ctx, cam, [mx1, my1, deckTop + h * 0.32], [ex, ey, deckTop + h * 0.12], 1.1, 'rgba(70,76,84,0.9)', alpha, { pull: DECO_PULL });
      if (night) glowPool(ctx, cam, mx1, my1, deckTop + h * 0.30, '206,238,255', 8, alpha * 0.30); }
    // The stair up, and a shelter the size of a door, which is all there is.
    { const [sx1, sy1] = F(-fh * 0.40, fh * 0.44);
      draw3DBoxAt(ctx, cam, sx1, sy1, fh * 0.16, 0, deckTop, 'ty_hf_chrome_dk', seed + 2, night, alpha, true, faceYaw(E), fh * 0.20); }
    { const [wx, wy] = F(fh * 0.24, 0);
      draw3DBoxAt(ctx, cam, wx, wy, fh * 0.20, deckTop, deckTop + h * 0.16, 'ty_hft_glass', seed + 3, night, alpha, true, faceYaw(E), fh * 0.14); }
    if (night) glowPool(ctx, cam, dx, dy, deckTop + h * 0.02, '150,214,255', 9, alpha * 0.20);
  },
  sentinel(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Coldwater Sentinel — a narrow storefront newsroom under a guyed press mast, its window a wall of feed-screens
    const body = h * 1.02;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, body, pal, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, body * 0.74, body * 0.84, 'ty_door', seed + 1, night, alpha, false);   // the stencilled masthead band
    mast(ctx, cam, dx, dy, body, body + h * 0.62, alpha, now, seed);                                                // how the news actually gets out
    roofClutter(ctx, cam, dx, dy, fh * 0.96, body, 'citycore', seed + 2, night, alpha, now);
    if (frontVis) { const [nx, ny] = F(fh * 0.52, fh * 1.00); neonBlade(ctx, cam, nx, ny, body * 0.80, body + h * 0.30, m.neon || '#5fd0ff', night, alpha); }
    if (night) { const [wx, wy] = F(0, fh * 1.00); glowPool(ctx, cam, wx, wy, h * 0.24, '120,200,255', 13, alpha * 0.34); }   // feed-screens through the glass
  },
};
