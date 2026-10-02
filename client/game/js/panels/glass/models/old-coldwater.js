// Old Coldwater: building-model arms for the south-east slums and the old civic buildings.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  ADORN_NEAR, ADORN_TIER, DECO_LIFT, FACE_EPS, LCK_ROOF_Z, SLUM_PULL, SLUM_RUST, SLUM_TIN, TARPS,
  TR, awning, bakeSignText, blinkLight, clamp, draw3DBoxAt, drawBarrelRoof, drawFacetDrum, drawRing,
  emitDecoFill, emitSurfaceText, emitWire, faceYaw, frac, glowPool, hfChrome, hfGlass, marqueeBand,
  neonBlade, roofClutter, slumCurtain, slumDrape, slumFaceVis, slumHole, slumOpening, slumRope,
  slumScrawl, slumSheet,
} from '../../windshield.js';

export const OLD_COLDWATER_ARMS = {
  // ── OLD COLDWATER (docs/proposals/old-coldwater.md) ──────────────────────
  // The Shingles: five trades and a ruin, on the oldest ground in the city. What holds the six
  // together is a rule rather than a palette — NOT ONE OF THEM CARRIES A SIGN WITH WORDS ON IT,
  // lit or painted. Every other arm in this switch ends in a marquee, a blade or a fascia; these
  // end in a window, a bulb or nothing, because a district where the buildings advertise is a
  // district with money in it. The kit is held to the same rule (SLUM_DECLINE, UNSIGNED_TRADE).
  // After dark this block is five small warm rectangles and a brazier, and that is the whole
  // read of it from the air.
  //
  // ⚠ AND EVERY ONE OF THEM IS SHORT OF A PIECE (the shanty pass). A corner storey gone, a roof
  // open to the sky, a breach nailed over, and a tarp from the Pitch over whatever came off,
  // through the helpers beside `drawTentCamp` so the sheets on the buildings match the sheets
  // on the tents. The rule for what is broken: MASS is never gated on the camera or the tier (the
  // mesh is captured once and shared by every tile), and everything painted on is.
  ruin(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A house that came down and was never cleared, because clearing it would mean
    // agreeing whose it was. The one arm here with no door, no window, no sign and no light: a
    // `ruin` tile carries no `facade` tag, so it never reaches the icon path or
    // resolveFacadeTransit, and there is nothing behind it to enter.
    //
    // THE CHIMNEY BREAST IS THE SILHOUETTE. When a terrace goes, the party walls and the stacks
    // are what stay up, because they are the only part of it that was ever more than one brick
    // thick. From the air the tile reads as a low broken rectangle with one finger out of it,
    // and from the lane as a wall with sky where the windows were.
    // ⚠ THE FIRST CUT WAS A LOW BOX WITH A FINGER OUT OF IT AND IT READ AS AN UNFINISHED SHED.
    // What was missing is that a terrace does not come down LEVEL. It goes in sections: half the
    // house is still standing under its own roof and the half beside it is open to the sky with
    // the floor it used to have still spanning the gap. So the read is an ASYMMETRY — one box
    // with a roof flag and one without — and everything else here is dressing on that.
    const gable = h * 0.66, mid = h * 0.34, stack = h * 0.96;
    const hiX = -fh * 0.46, loX = fh * 0.46, HW = fh * 0.40, FD = fh * 0.80;
    // 1) THE HALF THAT IS STILL STANDING, roof and all. Somebody is probably in it.
    { const [ax, ay] = F(hiX, 0); draw3DBoxAt(ctx, cam, ax, ay, HW, 0, gable, pal, seed, night, alpha, true, faceYaw(E), FD); }
    // 2) THE HALF THAT IS NOT: no lid, and no higher than the first floor. ⚠ NO ROOF FLAG on
    //    this one, deliberately — the absence of a lid is the whole of what "a large section of
    //    its roof missing" means to a renderer that only draws boxes.
    { const [bx, by] = F(loX, 0); draw3DBoxAt(ctx, cam, bx, by, HW, 0, mid, pal, seed + 9, night, alpha, false, faceYaw(E), FD); }
    // 3) THE TEETH. Three short lengths of wall left standing proud of the break at three
    //    different heights, which is what turns a level top edge into a collapse. They are
    //    boxes and cost nothing, and they are the whole difference between a wall that was
    //    never finished and a wall that came down.
    for (let i = 0; i < 3; i++) {
      const tz = mid + h * (0.05 + frac(seed * 17 + i * 23) * 0.22);
      const [tx, ty] = F(loX + (i - 1) * HW * 0.62, (frac(seed * 29 + i * 11) - 0.5) * FD * 1.1);
      draw3DBoxAt(ctx, cam, tx, ty, HW * 0.26, mid, tz, 'ty_oc_brick_dk', seed + 30 + i, night, alpha, true, faceYaw(E), fh * 0.07);
    }
    // 4) THE JOISTS. The floor is still there where the roof is not — six timbers spanning the
    //    open half, which is the one detail that says this was a HOUSE and not a yard. Near tier
    //    only: at range six dark lines over an open box is noise on top of the break line.
    if (ADORN_TIER >= ADORN_NEAR) for (let i = 0; i < 6; i++) {
      const jx = loX - HW * 0.84 + (i / 5) * HW * 1.68;
      emitWire(ctx, cam, W3(jx, -FD * 0.9, mid - h * 0.03), W3(jx, FD * 0.9, mid - h * 0.03), 2, 'rgb(38,32,26)', alpha, { lift: DECO_LIFT * 0.2 });
    }
    // 5) THE STACK, on the party wall between the two halves and taller than either. A chimney
    //    breast is the only part of a terrace that was ever more than one brick thick, so it is
    //    what is left standing once everything hung off it has gone.
    { const [cx, cy] = F(0, -fh * 0.22); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.11, 0, stack, 'ty_oc_brick_dk', seed + 2, night, alpha, true); }
    // 6) The rubble the neighbours tidied into a wall, which has stood long enough to be a wall.
    { const [bx, by] = F(0, fh * 0.92); draw3DBoxAt(ctx, cam, bx, by, fh * 0.86, 0, h * 0.10, 'ty_oc_brick_dk', seed + 3, night, alpha, true, faceYaw(E), fh * 0.08); }
    // 7) THE SPILL — what nobody tidied, out over the lane at three sizes. A ruin with a clean
    //    frontage is a building site, and this one has been here eleven years.
    for (let i = 0; i < 3; i++) {
      const [sx, sy] = F((frac(seed * 7 + i * 13) - 0.5) * fh * 1.5, fh * (1.04 + frac(seed * 5 + i * 3) * 0.16));
      draw3DBoxAt(ctx, cam, sx, sy, fh * (0.10 + frac(seed + i * 9) * 0.07), 0, h * (0.04 + frac(seed + i * 5) * 0.05),
        'ty_oc_brick_dk', seed + 40 + i, night, alpha, true, faceYaw(E), fh * 0.09);
    }
    // 8) THE BOARDING. Every opening in the standing half is shut with whatever was to hand: a
    //    dead panel with two planks nailed across it at an angle nobody measured. ⚠ A BOARDED
    //    opening is pale timber and a DEAD one is black, and the tile wants both — the first is
    //    a house somebody still owns and the second is a hole in a wall. ⚠ And these stand PROUD
    //    of the wall by FACE_EPS: coplanar is a tie on the depth buffer and a tie is a loss, so
    //    a board authored flush is a board that is simply not there.
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
        // The planks. Two, and deliberately not level: a nailed-up window is the one thing on a
        // building nobody has ever bothered to line up.
        for (const k of [0.32, 0.68]) {
          const zz = z0 + (z1 - z0) * k, tilt = (frac(seed * 13 + k * 97) - 0.5) * (z1 - z0) * 0.30;
          emitWire(ctx, cam, W3(ox - w * 1.14, fy + 0.002, zz - tilt), W3(ox + w * 1.14, fy + 0.002, zz + tilt),
            3, 'rgb(96,82,60)', alpha, { lift: DECO_LIFT * 0.2 });
        }
      }
    }
    // 9) THE PAINT. A ruin is the wall every reference photograph of graffiti was ever taken
    //    against: no glazing, no sign, no camera, nobody to complain to, and eleven years of it.
    //    ⚠ IT IS PAINTED HERE RATHER THAN LEFT TO THE DERIVED KIT, which declines paint for the
    //    whole slum (SLUM_DECLINE). ⚠ AND IT HAS NO WORDS IN IT. This drew five throw-ups off
    //    `bakeTagText`, and a bubble-letter word on a black opening read from the lane as a shop
    //    board, lit after dark. `slumScrawl` is the same five patches of paint with the letters
    //    taken out of them.
    const nightF = night ? clamp(night, 0, 1) : 0;
    if (frontVis) {
      const fy = FD + FACE_EPS * 2;
      const P = (u, z, o) => [u, fy + o, z];
      for (let i = 0; i < 5; i++) {
        const hi = i < 2;
        const bz = (hi ? gable : mid) * (0.22 + frac(seed * 31 + i * 17) * 0.30);
        const bh = fh * (0.035 + frac(seed * 37 + i * 7) * 0.025);
        const bw = fh * (0.10 + frac(seed * 41 + i * 5) * 0.07);
        const bx = (hi ? hiX : loX) + (frac(seed * 43 + i * 19) - 0.5) * HW * 0.9;
        slumScrawl(ctx, cam, W3, P, bx, bz, bw, bh, seed * 3 + i * 29, nightF, alpha);
      }
    }
    // 9b) AND THE BACK GETS THE SAME, because on both ruins the back is what the lane sees. A
    //     ruin has no door, so its front is `faceVec`'s default (south, onto the Pitch), and
    //     Ropewalk and Rag Row were looking at the one bare wall in the district. Giving the tiles
    //     an `entrance` would fix the facing and make each a door the map audit then looks for.
    if (slumFaceVis(cam, dx, dy, E, 0, -1, FD)) {
      const by = -FD - FACE_EPS * 2;
      const P = (u, z, o) => [u, by - o, z];
      slumOpening(ctx, cam, W3, P, hiX - HW * 0.44, gable * 0.29, HW * 0.26, gable * 0.13, 0, seed + 3, nightF, alpha);
      slumOpening(ctx, cam, W3, P, hiX + HW * 0.44, gable * 0.71, HW * 0.26, gable * 0.13, 1, seed + 4, nightF, alpha);
      slumOpening(ctx, cam, W3, P, loX + HW * 0.35, mid * 0.5, HW * 0.26, mid * 0.24, 1, seed + 5, nightF, alpha);
      slumScrawl(ctx, cam, W3, P, hiX + HW * 0.25, gable * 0.24, fh * 0.14, fh * 0.045, seed * 3 + 7, nightF, alpha);
      slumScrawl(ctx, cam, W3, P, loX - HW * 0.35, mid * 0.30, fh * 0.12, fh * 0.04, seed * 3 + 11, nightF, alpha);
    }
    // 10) SOMEBODY LIVES IN THE OPEN HALF. A tarp is slung off the standing half's party wall and
    //     over the broken one, resting on the teeth, with its far edge hanging down the outside
    //     wall. It is the one thing that turns a heap into an address, and the camp's own
    //     colours are the reason it reads as the Pitch having moved indoors. The teeth come up
    //     through it; nobody here was going to cut holes in a good sheet.
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
      // The lamp under it: the spill at the open end, which is the only way out of a tarp a lamp
      // has (the camp's gable-mouth rule).
      if (warm) { const [gx, gy] = F(loX, yf + FD * 0.08); glowPool(ctx, cam, gx, gy, mid * 0.45, '255,186,104', 8, alpha * 0.34 * nightF); }
    }
    // 11) THE STOVEPIPE through the tarp, the tell that the lamp is not the only thing in there.
    { const [px, py] = F(loX + HW * 0.35, -FD * 0.45); draw3DBoxAt(ctx, cam, px, py, fh * 0.018, 0, mid + h * 0.26, 'ty_oc_tin', seed + 50, night, alpha, true); }
    // 12) A SHEET OF TIN LEANED ON THE FRONT of the open half, over what used to be a doorway.
    //     A lean is a slope this projection's boxes cannot draw, so it is a sheet: foot out in the
    //     lane, head against the wall, and three corrugations down it where you are close enough
    //     to see them.
    if (frontVis) {
      // The foot stands on the near edge of the rubble rather than on the lane, a hand up: at the
      // lane it was behind the spill from a cab, and the tie-breaker brought it through.
      const x0 = loX + HW * 0.05, x1 = loX + HW * 0.62, top = mid * 0.72, fy = FD + FACE_EPS * 3;
      const ft = fy + fh * 0.07, fz = h * 0.03;
      slumSheet(ctx, cam, W3, [[x0, fy, top], [x1, fy, top], [x1, ft, fz], [x0, ft, fz]], SLUM_TIN, nightF, alpha, 0, 'tin');
      if (ADORN_TIER >= ADORN_NEAR) for (let i = 1; i < 4; i++) {
        const x = x0 + (x1 - x0) * i / 4;
        emitWire(ctx, cam, W3(x, fy + FACE_EPS, top), W3(x, ft + FACE_EPS, fz), 1, 'rgba(40,40,36,0.7)', alpha, { lift: DECO_LIFT * 0.1, pull: SLUM_PULL });
      }
    }
  },
  water_seller(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // MAINS SQUEEZE — A TANK ON LEGS, a silhouette Coldwater has nowhere
    // else. The Curtain cut the mains when it came down and the standpipe has been dry since, so
    // somebody put a header tank up on a trestle and sells what is in it by the measure.
    const hutTop = h * 0.30, deck = h * 0.52, tankTop = h * 0.88;
    // 1) THE HUT. One room of tarred board under the tank, low enough that tall customers stoop.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.52, 0, hutTop, pal, seed, night, alpha, true);
    // 2) THE TRESTLE. Four legs standing OUTSIDE the hut, which is what makes this a trestle
    //    carrying a tank rather than a tank sitting on a shed: the load goes past the walls and
    //    into the ground, and you can see daylight between the legs and the room.
    for (let i = 0; i < 4; i++) {
      const [px, py] = F((i & 1) ? fh * 0.66 : -fh * 0.66, (i & 2) ? fh * 0.66 : -fh * 0.66);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, deck, 'ty_oc_board_dk', seed + 1 + i, night, alpha, false);
    }
    // 3) THE TANK. Riveted plate, tapering a little, with two hoops on it. `ty_oc_tank` is in
    //    PLATE_WALL, which is the family that draws the laps and the rivet lines a vessel is
    //    recognised by — the one thing that stops this reading as a grain silo.
    drawFacetDrum(ctx, cam, dx, dy, deck, tankTop, fh * 0.62, fh * 0.58, 11, alpha,
      (f) => 'rgb(' + (84 + f.nl * 46 | 0) + ',' + (88 + f.nl * 46 | 0) + ',' + (84 + f.nl * 42 | 0) + ')', 'rgb(62,66,62)', 'ty_oc_tank');
    drawRing(ctx, cam, dx, dy, deck + h * 0.08, fh * 0.625, 11, 'rgba(22,24,22,0.55)', 2, alpha);
    drawRing(ctx, cam, dx, dy, tankTop - h * 0.07, fh * 0.595, 11, 'rgba(22,24,22,0.55)', 2, alpha);
    // 4) THE DOWNPIPE, tank to counter. The only part of the plumbing anybody can check.
    { const [dpx, dpy] = F(fh * 0.34, fh * 0.40); draw3DBoxAt(ctx, cam, dpx, dpy, fh * 0.035, hutTop, deck, 'ty_oc_tank', seed + 6, night, alpha, false); }
    // 5) THE QUEUE RAIL. A bar on the front, and the only piece of street furniture in the
    //    district that somebody bolted down on purpose.
    { const [qx, qy] = F(0, fh * 0.74); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.48, h * 0.13, h * 0.16, 'ty_oc_tank', seed + 7, night, alpha, true, faceYaw(E), fh * 0.03); }
    // 6) THE HUT'S LEFT FLANK HAS BEEN KICKED IN and mended with two sheets of tin, one newer
    //    than the other. They are mass, a hair proud of the boards, because a patch you can see
    //    the edge of from the lane is a patch.
    { const [ax, ay] = F(-fh * 0.53, fh * 0.12); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.012, h * 0.03, h * 0.22, 'ty_oc_tin', seed + 8, night, alpha, true, faceYaw(E), fh * 0.20); }
    { const [bx, by] = F(-fh * 0.535, -fh * 0.24); draw3DBoxAt(ctx, cam, bx, by, fh * 0.012, h * 0.08, h * 0.26, 'ty_oc_tin', seed + 9, night, alpha, true, faceYaw(E), fh * 0.14); }
    const nightF = night ? clamp(night, 0, 1) : 0;
    const hw = fh * 0.52 + FACE_EPS * 2;
    // 7) THE HUT'S ROOF IS A TARP NOW, because the tank sweats and the lid under it rotted first.
    //    Flat on the lid, pulled over the back edge and hanging down it, and tied off to the
    //    trestle legs, which are the only things here strong enough to tie to.
    slumSheet(ctx, cam, W3, [[-hw, -hw, hutTop + FACE_EPS], [hw * 0.55, -hw, hutTop + FACE_EPS], [hw * 0.55, hw, hutTop + FACE_EPS], [-hw, hw, hutTop + FACE_EPS]], TARPS[0], nightF, alpha);
    slumCurtain(ctx, cam, W3, [-hw, -hw], [hw * 0.55, -hw], hutTop, h * 0.16, 4, TARPS[0], seed, nightF, alpha);
    // Tied round the inner corner of each leg, never at its centre, which is inside the post.
    slumRope(ctx, cam, W3, [-hw, -hw, hutTop], [-fh * 0.60, -fh * 0.60, deck * 0.5], alpha);
    slumRope(ctx, cam, W3, [-hw, hw, hutTop], [-fh * 0.60, fh * 0.60, deck * 0.5], alpha);
    // 8) THE QUEUE GETS A SHEET OVER IT, from the hut's eaves out past the rail to two sticks, in
    //    a different tarp from the roof because it came from a different place.
    for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.58, fh * 0.96); draw3DBoxAt(ctx, cam, px, py, fh * 0.015, 0, h * 0.19, 'ty_oc_board_dk', seed + 10, night, alpha, true); }
    slumDrape(ctx, cam, W3, [-fh * 0.62, hw, hutTop - h * 0.02], [fh * 0.62, hw, hutTop - h * 0.02],
      [fh * 0.62, fh * 0.96, h * 0.19], [-fh * 0.62, fh * 0.96, h * 0.19], h * 0.02, TARPS[3], nightF, alpha, 0, TARPS[1]);
    // 9) THE TANK WEEPS RUST from under its top hoop, in three streaks that taper as they run.
    //    Each point sits on the tank's own taper, a hair proud, so a streak follows the plate
    //    down rather than standing off it at the bottom. Near tier: at range it is a few pixels of
    //    a colour the tank already nearly is. (It was a riveted patch first, and a square of rust
    //    with a drip under it read from the lane as a board on a post.)
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
  weigh_station(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE GLACIS WEIGH — THE LOCK'S CONTROL ROOM, BUILT INTO ITS WALL.
    // It used to be a municipal box under a canopy on two posts, standing apart from the covered
    // lane like a bus shelter somebody forgot. Now it is part of the Outer Lock: the same grey
    // plate, the same roof line (LCK_ROOF_Z), and its glass face IS the lock's wall on the booth
    // side, carried out to the tile edge so the deck and the room are one closed interior.
    //
    // ⚠ THE PLATES ARE NOT DRAWN HERE. The weighbridge is the tile next door, a `gate_lock` deck,
    // and deliberately not a building. This arm is the room only.
    const plinth = h * 0.16, sill = h * 0.30, eaves = LCK_ROOF_Z - 0.02;   // the lock's roof line, a constant, so the capture stays affine
    const edge = 0.5;   // the tile edge on the lane side, in tiles
    // 1) THE PLINTH: dark steel, flush with the room, one blunt block.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.46, 0, plinth, 'ty_stack_dk', seed, night, alpha, false);
    // 2) THE ROOM: grey plate, the lock's own, full height to the lock's roof.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.44, plinth, eaves, 'ty_gantry', seed + 1, night, alpha, true);
    // 3) THE BRIDGE: the room carried out to the lane's edge at the lock's height, so no sky and
    //    no gap shows between the booth and the deck's roof.
    { const reach = edge - fh * 0.44, [bx, by] = F(0, fh * 0.44 + reach / 2);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.44, eaves - 0.12, LCK_ROOF_Z, 'ty_gantry', seed + 2, night, alpha, true, faceYaw(E), reach / 2 + FACE_EPS);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.44, 0, plinth, 'ty_stack_dk', seed + 3, night, alpha, false, faceYaw(E), reach / 2 + FACE_EPS); }
    // 4) THE GLASS: one continuous band across the lane face, sill to eaves, proud of the plate.
    { const [gx, gy] = F(0, fh * 0.44 + FACE_EPS);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.40, sill, eaves - 0.14, 'ty_lh_eye', seed + 4, night, alpha, false, faceYaw(E), fh * 0.02); }
    // 5) THE LIGHT LINE: a cyan strip under the glass and one along the roof edge. The only
    //    colour on it, and the lock's scanner colour.
    { const [lx, ly] = F(0, fh * 0.44 + FACE_EPS * 2);
      glowPool(ctx, cam, lx, ly, sill - h * 0.02, '120,244,255', 10, alpha * (night ? 0.45 : 0.22));
      glowPool(ctx, cam, lx, ly, eaves - h * 0.06, '120,244,255', 8, alpha * (night ? 0.35 : 0.15)); }
    if (night) { const [wx, wy] = F(0, fh * 0.30); glowPool(ctx, cam, wx, wy, sill + h * 0.2, '226,240,255', 9, alpha * 0.30); }
  },
  vehicle_pound(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // LONG STAY — A COMPOUND, WHICH IS A SILHOUETTE WITH A HOLE IN IT.
    // Every other building in this city is mass you cannot see into. This one is a fence with
    // rows of trailer tops standing behind it, and `ty_bond_fence` is in LATTICE_CUT — the
    // openings are alpha-tested holes rather than painted dark — so the palisade genuinely has
    // the yard behind it. That is the whole reason this reads as a pound and not as a shed.
    const fence = h * 0.62, boxTop = h * 0.50;
    // 1) THE PALISADE, on all four sides, drawn as four thin slabs rather than as one box: a box
    //    would have a LID, and a compound with a roof on it is a warehouse.
    for (const [sx, sy, w, d] of [[0, 1, 0.92, 0.04], [0, -1, 0.92, 0.04], [1, 0, 0.04, 0.92], [-1, 0, 0.04, 0.92]]) {
      const [fx, fy] = F(sx * fh * 0.92, sy * fh * 0.92);
      draw3DBoxAt(ctx, cam, fx, fy, fh * w, 0, fence, 'ty_bond_fence', seed + 1 + sx * 2 + sy, night, alpha, false, faceYaw(E), fh * d);
    }
    // 2) THE ROWS. Trailer tops nose-in, lower than the fence, so from the air it is a yard full
    //    of boxes and from the road it is a fence with boxes showing over it. Four of them, at
    //    the same height, because the one thing a pound is is UNIFORM — nothing in here is being
    //    used, and nothing in here has been moved since it arrived.
    for (let i = 0; i < 4; i++) {
      const [rx, ry] = F((i - 1.5) * fh * 0.42, -fh * 0.16);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.16, 0, boxTop, 'ty_stack_dk', seed + 10 + i, night, alpha, true, faceYaw(E), fh * 0.58);
    }
    // 3) THE GATE. A wider, shorter panel in the entrance face with a post either side of it —
    //    the one place the palisade is interrupted, and the only part of this building anybody
    //    ever deals with.
    { const [gx, gy] = F(0, fh * 0.94 + FACE_EPS);
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.34, 0, fence * 0.88, 'ty_gantry', seed + 20, night, alpha, false, faceYaw(E), fh * 0.03); }
    for (const s of [-1, 1]) {
      const [px, py] = F(s * fh * 0.38, fh * 0.94);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.06, 0, fence + h * 0.10, 'ty_gantry', seed + 22 + s, night, alpha, false);
    }
    // 4) THE GATEHOUSE, inside the wire beside the gate. One room, and the hatch in this arm's
    //    own prose. Small enough that the fence is still the thing you see.
    { const [hx, hy] = F(fh * 0.56, fh * 0.60);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.24, 0, h * 0.38, 'ty_guard', seed + 30, night, alpha, true); }
    if (night) {
      // A floodlight on the gate post aimed down into the rows, and the hut's one window. The
      // yard is lit because a pound is watched, not because anybody is meant to look at it.
      { const [lx, ly] = F(-fh * 0.38, fh * 0.94); glowPool(ctx, cam, lx, ly, fence + h * 0.08, '255,238,198', 12, alpha * 0.34); }
      { const [hx, hy] = F(fh * 0.56, fh * 0.60); glowPool(ctx, cam, hx, hy, h * 0.28, '255,214,150', 5, alpha * 0.22); }
    }
  },
  flophouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // BED ROCK — the oldest building in Coldwater and the only JETTIED one.
    // Each timber storey oversails the one below it, which is how a town with narrow plots and a
    // tax on frontage built upward for four hundred years. From the lane it leans out over you;
    // from the air it is a stepped pyramid the wrong way up, which nothing else here is.
    const ground = h * 0.26, s1 = h * 0.50, s2 = h * 0.72, eaves = h * 0.90;
    // 1) THE GROUND FLOOR in brick, because the bottom storey is the only part anybody could
    //    afford to build out of something that does not rot.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.80, 0, ground, 'ty_oc_brick', seed, night, alpha, false);
    // 2) THREE JETTIED TIMBER STOREYS, each wider than the one under it. The oversail is small
    //    and it is cumulative, which is exactly how the real thing looks.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, ground, s1, pal, seed + 1, night, alpha, false);
    // ⚠ THIS ONE HAS A LID NOW, because the storey above it no longer covers all of it: where
    //    the top floor came down, its floor is what you see from the air, open to the weather.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, s1, s2, pal, seed + 2, night, alpha, true);
    // THE TOP STOREY IS TWO-THIRDS OF ONE. The left corner came down years ago and took its
    // share of the roof with it; the right two-thirds stands, and the chimney breast stands on
    // its own in the gap, because a stack is the only part of a timber house that was brick.
    const brk = -fh * 0.25;   // the line the top floor broke along
    { const [ax, ay] = F((brk + fh * 0.97) / 2, 0); draw3DBoxAt(ctx, cam, ax, ay, (fh * 0.97 - brk) / 2, s2, eaves, pal, seed + 3, night, alpha, false, faceYaw(E), fh * 0.97); }
    // What is left of the fallen corner: a stub of wall a hand high with no lid, and three
    // lengths of front and back wall standing proud of it at three heights, the ruin's teeth.
    { const [bx, by] = F((brk - fh * 0.97) / 2, 0); draw3DBoxAt(ctx, cam, bx, by, (fh * 0.97 + brk) / 2, s2, s2 + h * 0.04, pal, seed + 11, night, alpha, false, faceYaw(E), fh * 0.97); }
    for (let i = 0; i < 3; i++) {
      const [tx, ty] = F(-fh * (0.86 - i * 0.24), (i === 1 ? -1 : 1) * fh * 0.93);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.09, s2, s2 + h * (0.06 + frac(seed * 19 + i * 7) * 0.08), pal, seed + 12 + i, night, alpha, true, faceYaw(E), fh * 0.035);
    }
    // 3) THE ROOF, in split shingles, and the reason the district is called the Shingles. Drawn
    //    as two courses with the upper one NARROW AND BARELY PROUD, because the ridge has given:
    //    a sag is not a curve this projection can draw, and a roof that steps down toward its
    //    own middle reads as one from every angle you can actually see this building from.
    //    Over the standing two-thirds only.
    { const [rx, ry] = F((brk + fh * 0.97) / 2, 0);
      draw3DBoxAt(ctx, cam, rx, ry, (fh * 0.97 - brk) / 2, eaves, eaves + h * 0.07, 'ty_oc_shake', seed + 4, night, alpha, true, faceYaw(E), fh * 0.97);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.38, eaves + h * 0.07, eaves + h * 0.10, 'ty_oc_shake', seed + 5, night, alpha, true, faceYaw(E), fh * 0.60); }
    // 4) THE EXTERNAL STAIR, bolted to the flank. There is no diagonal in this projection, so it
    //    is drawn as its LANDINGS, boxes stepping up the side, which is what a stair actually
    //    reads as from any distance at which this building is on screen at all. ⚠ THE THIRD ONE
    //    IS MISSING and that is the point of it: it went, nobody put it back, and the top floor
    //    is reached from inside or not at all.
    for (let i = 0; i < 4; i++) {
      if (i === 2) continue;
      const [lx, ly] = F(fh * 0.90, fh * (0.40 - i * 0.26));
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.09, h * (0.10 + i * 0.20), h * (0.14 + i * 0.20), 'ty_oc_board_dk', seed + 6 + i, night, alpha, true, faceYaw(E), fh * 0.14);
    }
    // 5) THE CHIMNEY off the front-desk stove, which never goes out.
    { const [cx, cy] = F(-fh * 0.48, -fh * 0.40); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.09, s2, eaves + h * 0.26, 'ty_oc_brick_dk', seed + 10, night, alpha, true); }
    // 6) TIN OVER THE WORST OF THE BOARDS: one sheet across the second floor's front where a
    //    window was, and one down the first floor's flank, mass and a hair proud, because the
    //    edge is the patch.
    { const [px, py] = F(fh * 0.56, fh * 0.932); draw3DBoxAt(ctx, cam, px, py, fh * 0.15, s1 + h * 0.03, s1 + h * 0.15, 'ty_oc_tin', seed + 16, night, alpha, true, faceYaw(E), fh * 0.012); }
    { const [px, py] = F(-fh * 0.872, -fh * 0.18); draw3DBoxAt(ctx, cam, px, py, fh * 0.012, ground + h * 0.02, ground + h * 0.15, 'ty_oc_tin', seed + 17, night, alpha, true, faceYaw(E), fh * 0.17); }
    const nightF = night ? clamp(night, 0, 1) : 0;
    // 7) THE TARP OVER THE GAP. Head nailed along the standing wall under the eaves, foot on the
    //    teeth, and the far edge let down the west flank in strips. It covers the front of the
    //    break and not the back, so from the air you see sheet, then open floor, then the stack.
    {
      const xh = brk - FACE_EPS * 2, xf = -fh * 0.97 - FACE_EPS * 2, yb = -fh * 0.28, yf = fh * 0.97 + FACE_EPS * 2;
      const zh = eaves - h * 0.04, zf = s2 + h * 0.07;
      slumDrape(ctx, cam, W3, [xh, yb, zh], [xh, yf, zh], [xf, yf, zf], [xf, yb, zf], h * 0.05, TARPS[0], nightF, alpha, 0, TARPS[4]);
      // The fall stops short of the front corner: its hem there hangs past the jetty of the storey
      // below, where a cab sees it through that storey's corner, and the tie-breaker brings it out.
      slumCurtain(ctx, cam, W3, [xf - FACE_EPS, yb], [xf - FACE_EPS, fh * 0.30], zf, h * 0.16, 4, TARPS[0], seed, nightF, alpha);
      slumRope(ctx, cam, W3, [xf, yf, zf], [-fh * 0.86 - FACE_EPS, fh * 0.45, s1 - h * 0.05], alpha);
      slumRope(ctx, cam, W3, [xf, yb, zf], [-fh * 0.86 - FACE_EPS, yb, s1 - h * 0.05], alpha);
      // The rafters the roof left behind over the open back of the break, hanging off the wall
      // plate toward the teeth. Near tier, the ruin's joists' reason.
      for (let i = 0; i < 3; i++) {
        const ry = -fh * (0.60 + i * 0.13);
        slumRope(ctx, cam, W3, [brk - FACE_EPS, ry, eaves], [brk - fh * (0.34 + frac(seed * 23 + i) * 0.30), ry, s2 + h * 0.08], alpha);
      }
    }
    // 8) THE OPENINGS. The front had none drawn, and a doss house with no windows reads as a
    //    shed. Every storey gets a few, rolled per tile across the three states, and the door
    //    is a tarp hung across a hole, which is what the door of a place like this is.
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
      // Lit windows up the front, small and few. Most of the beds are taken and most of the
      // people in them are asleep; the landing lamp is the only thing burning all night.
      const [gx, gy] = F(0, fh * 0.88);
      glowPool(ctx, cam, gx, gy, s1 - h * 0.07, '255,206,132', 6, alpha * 0.18);
      glowPool(ctx, cam, gx, gy, s2 - h * 0.07, '255,206,132', 6, alpha * 0.13);
      glowPool(ctx, cam, gx, gy, eaves - h * 0.07, '255,206,132', 6, alpha * 0.09);
    }
  },
  soup_kitchen(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // NO SUCH THING — A LONG LOW HALL WITH A CANOPY OVER THE QUEUE, which
    // is the shape of every mission, drill hall and works canteen ever built: one span, no upper
    // floor, and all of the money in the roof. The canopy is the part that matters. It exists
    // because the queue is outside and the queue is always there, and it is the only cantilever
    // in the district.
    const wallTop = h * 0.44, ridge = h * 0.56;
    // 1) THE HALL, deliberately deeper than it is wide: the long axis runs BACK from the lane,
    //    so from the street this is a narrow gable and from the air it is a shed.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.70, 0, wallTop, pal, seed, night, alpha, false, faceYaw(E), fh * 0.96);
    // 2) THE ROOF, one span of galvanised sheet, proud all round. It was. The back third rusted
    //    through over the range and came in, so the tin stops a third of the way short of the
    //    back wall and what is over the kitchen is a tarp, with a hole left round the stack
    //    because nobody wanted a sheet that close to a flue.
    const rb = -fh * 0.30;   // where the tin gives out
    { const [rx, ry] = F(0, (rb + fh * 1.00) / 2); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.76, wallTop, ridge, 'ty_oc_tin', seed + 1, night, alpha, true, faceYaw(E), (fh * 1.00 - rb) / 2); }
    // 3) THE CHIMNEY. A range with four pots on it needs a real stack, and it is the tallest
    //    thing on the building by a long way.
    { const [cx, cy] = F(fh * 0.40, -fh * 0.70); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.13, 0, ridge + h * 0.34, 'ty_oc_brick_dk', seed + 2, night, alpha, true); }
    // 4) THE QUEUE CANOPY, a slab on two posts over the pavement at head height. A soffit down
    //    there is a shape nothing else in this district has, and after dark it is what the light
    //    out of the serving hatch actually lands on. ⚠ HALF OF IT IS TIN AND HALF IS A TARP: the
    //    east end blew off in a storm and was put back with what the Pitch could spare.
    { const [ax, ay] = F(-fh * 0.30, fh * 1.00); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.42, h * 0.22, h * 0.25, 'ty_oc_tin', seed + 3, night, alpha, true, faceYaw(E), fh * 0.20); }
    for (const px of [-fh * 0.62, fh * 0.62]) {
      const [qx, qy] = F(px, fh * 1.14); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.035, 0, h * 0.22, 'ty_oc_board_dk', seed + 4, night, alpha, false);
    }
    // 5) THE WEAR, painted on. ⚠ THE NAME BOARD THAT USED TO BE HERE IS GONE ON PURPOSE: nothing in
    //    the Shingles has words on it, and she has never needed a sign to tell the queue where it
    //    is standing. Where it hung is a boarded-up window now.
    const nightF = night ? clamp(night, 0, 1) : 0;
    // The tarp over the kitchen, from the torn edge of the tin down over the back wall, stopping
    // short of the stack; and the rafters that are left over the hole round it.
    {
      const yh = rb - FACE_EPS * 2, yf = -fh * 1.00 - FACE_EPS * 2, xl = -fh * 0.78, xr = fh * 0.24;
      slumDrape(ctx, cam, W3, [xl, yh, ridge], [xr, yh, ridge], [xr, yf, wallTop + h * 0.01], [xl, yf, wallTop + h * 0.01],
        h * 0.04, TARPS[1], nightF, alpha, 0, TARPS[3]);
      slumCurtain(ctx, cam, W3, [xl, yf - FACE_EPS], [xr, yf - FACE_EPS], wallTop + h * 0.01, h * 0.15, 4, TARPS[1], seed, nightF, alpha);
      slumRope(ctx, cam, W3, [xl, yf, wallTop], [-fh * 0.70 - FACE_EPS, -fh * 0.80, h * 0.20], alpha);
      for (const rx of [fh * 0.60, fh * 0.68]) slumRope(ctx, cam, W3, [rx, rb, wallTop + h * 0.02], [rx, -fh * 0.94, wallTop - h * 0.02], alpha);
    }
    // The tarp half of the queue canopy, and the strip of it that hangs off the front.
    {
      const x0 = fh * 0.12, x1 = fh * 0.72, yw = fh * 0.97, yo = fh * 1.18;
      slumDrape(ctx, cam, W3, [x0, yw, h * 0.25], [x1, yw, h * 0.25], [x1, yo, h * 0.215], [x0, yo, h * 0.225], h * 0.02, TARPS[4], nightF, alpha);
      slumCurtain(ctx, cam, W3, [x0, yo + FACE_EPS], [x1, yo + FACE_EPS], h * 0.215, h * 0.05, 3, TARPS[4], seed + 1, nightF, alpha);
    }
    // A tin sheet over a hole in one flank, and a tarp nailed over a worse one in the other.
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
    if (night) { const [gx, gy] = F(0, fh * 0.92); glowPool(ctx, cam, gx, gy, h * 0.20, '255,198,126', 9, alpha * 0.26); }
  },
  bonesetter(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A STITCH IN TIME — ONE ROOM AND ONE WINDOW, and the window is the
    // model. It is the brightest thing on Ropewalk after dark and it is not advertising: the
    // work needs the light, and the light being on is how the street knows she is in. There is
    // no name on this building anywhere, which is the other half of the same fact.
    const wallTop = h * 0.34, ridge = h * 0.44;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.68, 0, wallTop, pal, seed, night, alpha, false);
    // THE ROOF is tin with its back corner gone, as two slabs in an L round the hole. The flue
    // comes up through the gap, which is how the gap started.
    { const [ax, ay] = F(0, fh * 0.32); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.74, wallTop, ridge, 'ty_oc_tin', seed + 1, night, alpha, true, faceYaw(E), fh * 0.42); }
    { const [bx, by] = F(fh * 0.32, -fh * 0.42); draw3DBoxAt(ctx, cam, bx, by, fh * 0.42, wallTop, ridge, 'ty_oc_tin', seed + 7, night, alpha, true, faceYaw(E), fh * 0.32); }
    // THE WINDOW: one opening, sill to head, filling most of the front of a very small building.
    { const [wx, wy] = F(0, fh * 0.58); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.40, h * 0.12, h * 0.28, 'ty_oc_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.14); }
    // THE LEAN-TO over the bench, where the queue sits. Lower and shallower than the canteen's
    // canopy two doors down, and the same idea, because it is the same problem. It was tin; it
    // is a tarp on two sticks now (see below), so only the sticks and the bench are mass.
    for (const px of [fh * 0.20, fh * 0.80]) { const [qx, qy] = F(px, fh * 1.00); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.03, 0, h * 0.22, 'ty_oc_board_dk', seed + 4, night, alpha, false); }
    { const [bx, byy] = F(fh * 0.50, fh * 0.88); draw3DBoxAt(ctx, cam, bx, byy, fh * 0.30, h * 0.07, h * 0.10, 'ty_oc_board_dk', seed + 5, night, alpha, true, faceYaw(E), fh * 0.07); }
    { const [fx2, fy2] = F(-fh * 0.40, -fh * 0.42); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.06, wallTop, ridge + h * 0.22, 'ty_oc_brick_dk', seed + 6, night, alpha, true); }
    // Tin over a kicked-in panel on the far flank, mass and a hair proud.
    { const [px, py] = F(fh * 0.692, -fh * 0.30); draw3DBoxAt(ctx, cam, px, py, fh * 0.012, h * 0.04, h * 0.24, 'ty_oc_tin', seed + 8, night, alpha, true, faceYaw(E), fh * 0.16); }
    const nightF = night ? clamp(night, 0, 1) : 0;
    // The tarp over the missing corner of the roof, off the edge of the tin and down the flank.
    {
      const xh = -fh * 0.10 - FACE_EPS * 2, xf = -fh * 0.74 - FACE_EPS * 2, y0 = -fh * 0.76, y1 = -fh * 0.10;
      slumDrape(ctx, cam, W3, [xh, y0, ridge], [xh, y1, ridge], [xf, y1, wallTop + h * 0.01], [xf, y0, wallTop + h * 0.01], h * 0.04, TARPS[0], nightF, alpha, 0, TARPS[2]);
      slumCurtain(ctx, cam, W3, [xf - FACE_EPS, y0], [xf - FACE_EPS, y1], wallTop + h * 0.01, h * 0.16, 3, TARPS[0], seed, nightF, alpha);
      slumRope(ctx, cam, W3, [xf, y0, wallTop], [-fh * 0.68 - FACE_EPS, y0 + fh * 0.1, h * 0.06], alpha);
    }
    // The lean-to's sheet, from over the window head out to the sticks.
    slumDrape(ctx, cam, W3, [fh * 0.16, fh * 0.72 + FACE_EPS * 2, h * 0.30], [fh * 0.84, fh * 0.72 + FACE_EPS * 2, h * 0.30],
      [fh * 0.84, fh * 1.02, h * 0.215], [fh * 0.16, fh * 1.02, h * 0.215], h * 0.02, TARPS[1], nightF, alpha);
    if (slumFaceVis(cam, dx, dy, E, -1, 0, fh * 0.68)) {
      slumScrawl(ctx, cam, W3, (u, z, o) => [-fh * 0.68 - FACE_EPS * 2 - o, u, z], fh * 0.22, h * 0.13, fh * 0.18, h * 0.03, seed + 9, nightF, alpha);
    }
    // A pane that went and was taped rather than replaced: glass costs what a week of her work
    // costs, and tape is tape. Near tier, and only on the side you can see.
    if (frontVis && ADORN_TIER >= ADORN_NEAR) {
      const ty = fh * 0.72 + FACE_EPS * 2, tape = 'rgba(214,206,176,0.85)';
      const [ax, bx, z0, z1] = [fh * 0.06, fh * 0.34, h * 0.14, h * 0.26];
      emitWire(ctx, cam, W3(ax, ty, z0), W3(bx, ty, z1), 2, tape, alpha, { lift: DECO_LIFT * 0.1, pull: SLUM_PULL });
      emitWire(ctx, cam, W3(ax, ty, z1), W3(bx, ty, z0), 2, tape, alpha, { lift: DECO_LIFT * 0.1, pull: SLUM_PULL });
    }
    if (night) { const [gx, gy] = F(0, fh * 0.72); glowPool(ctx, cam, gx, gy, h * 0.20, '255,236,196', 11, alpha * 0.38); }
  },
  shebeen(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // STILL STANDING — HALF A ROOM. The front wall stops at waist height and
    // the rest is a tarpaulin on a frame, so you drink standing in the lane with your elbows
    // inside. Nothing else in Coldwater is deliberately unfinished, and from the air the tile
    // reads as a building with its front torn off, which is exactly what it is.
    const counter = h * 0.16, backTop = h * 0.46, ridge = h * 0.56;
    // 1) THE BACK ROOM, full height. The still is in there and it is the only part with walls,
    //    and not all of those: the corner round the still went (nobody will say how), so the
    //    room stands two-thirds of its width under its roof and the last third is a wall a
    //    little over head height with teeth along the top, open to the sky.
    const brk = fh * 0.30;   // where the back room broke
    { const [bx, byy] = F((brk - fh * 0.72) / 2, -fh * 0.34); draw3DBoxAt(ctx, cam, bx, byy, (brk + fh * 0.72) / 2, 0, backTop, pal, seed, night, alpha, false, faceYaw(E), fh * 0.50); }
    { const [bx, byy] = F((brk + fh * 0.72) / 2, -fh * 0.34); draw3DBoxAt(ctx, cam, bx, byy, (fh * 0.72 - brk) / 2, 0, h * 0.26, pal, seed + 6, night, alpha, false, faceYaw(E), fh * 0.50); }
    for (let i = 0; i < 3; i++) {
      const [tx, ty] = F(i < 2 ? fh * (0.42 + i * 0.20) : fh * 0.70, i < 2 ? -fh * 0.82 : -fh * 0.20);
      draw3DBoxAt(ctx, cam, tx, ty, i < 2 ? fh * 0.07 : fh * 0.025, h * 0.26, h * (0.30 + frac(seed * 29 + i * 5) * 0.09), pal, seed + 7 + i, night, alpha, true, faceYaw(E), i < 2 ? fh * 0.025 : fh * 0.08);
    }
    { const [rx, ry] = F((brk - fh * 0.78) / 2 + fh * 0.03, -fh * 0.34); draw3DBoxAt(ctx, cam, rx, ry, (brk + fh * 0.78) / 2 + fh * 0.03, backTop, ridge, 'ty_oc_tin', seed + 1, night, alpha, true, faceYaw(E), fh * 0.56); }
    // 2) THE COUNTER — the front wall, waist high and no higher. A wall that stops at h*0.16 in
    //    a city where every other wall goes to a roof IS the silhouette; there is nothing else
    //    to this building and nothing else needed.
    { const [cx, cy] = F(0, fh * 0.56); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.76, 0, counter, 'ty_oc_board_dk', seed + 2, night, alpha, true, faceYaw(E), fh * 0.30); }
    // 3) THE TARPAULIN on its frame, over the whole open half. It was a canvas slab; it is a sheet
    //    now (below), draped off the back room's eaves to the two front posts with a sag in it and
    //    a hem torn to strips, because the frame is the only rigid thing about it.
    for (const px of [-fh * 0.74, fh * 0.74]) {
      const [px2, py2] = F(px, fh * 0.86); draw3DBoxAt(ctx, cam, px2, py2, fh * 0.035, 0, h * 0.38, 'ty_oc_board_dk', seed + 4, night, alpha, false);
    }
    // 4) THE FLUE off the still, up the back wall and out. It is the only part of the operation
    //    visible from the lane, and it is the part that would convict her. It stands in the
    //    broken corner now, on its own, which has not made it any less obvious.
    { const [fx2, fy2] = F(fh * 0.48, -fh * 0.70); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.05, h * 0.20, ridge + h * 0.28, 'ty_oc_tin', seed + 5, night, alpha, true); }
    const nightF = night ? clamp(night, 0, 1) : 0;
    // The bulb over the counter lights the sheet above it from underneath, the camp's lit-tent
    // rule, so the front tarp is a warm tarp after dark rather than a black one with a glow in it.
    const warm = nightF > 0.3 ? 0.5 : 0;
    {
      const yh = fh * 0.16 + FACE_EPS * 2, yf = fh * 0.90;
      slumDrape(ctx, cam, W3, [-fh * 0.82, yh, h * 0.44], [fh * 0.82, yh, h * 0.44], [fh * 0.82, yf, h * 0.37], [-fh * 0.82, yf, h * 0.37],
        h * 0.03, TARPS[3], nightF, alpha, warm, TARPS[0]);
      slumCurtain(ctx, cam, W3, [-fh * 0.82, yf + FACE_EPS], [fh * 0.82, yf + FACE_EPS], h * 0.37, h * 0.07, 6, TARPS[3], seed, nightF, alpha, warm);
      // One side screened off with a second sheet, which is the only wall the bar has.
      slumCurtain(ctx, cam, W3, [-fh * 0.80, yh], [-fh * 0.80, yf], h * 0.37, h * 0.24, 3, TARPS[2], seed + 4, nightF, alpha);
      slumRope(ctx, cam, W3, [fh * 0.82, yf, h * 0.37], [fh * 0.92, fh * 1.02, 0], alpha);
      slumRope(ctx, cam, W3, [-fh * 0.82, yf, h * 0.37], [-fh * 0.92, fh * 1.02, 0], alpha);
    }
    // …and the broken corner of the back room under a third, off the edge of the roof and down
    // the flank.
    {
      const xh = brk + FACE_EPS * 2, xf = fh * 0.74 + FACE_EPS * 2, y0 = -fh * 0.86, y1 = fh * 0.14;
      slumDrape(ctx, cam, W3, [xh, y0, backTop - h * 0.03], [xh, y1, backTop - h * 0.03], [xf, y1, h * 0.29], [xf, y0, h * 0.29], h * 0.04, TARPS[1], nightF, alpha);
      slumCurtain(ctx, cam, W3, [xf + FACE_EPS, y0], [xf + FACE_EPS, y1], h * 0.29, h * 0.17, 4, TARPS[1], seed + 2, nightF, alpha);
    }
    if (frontVis) slumScrawl(ctx, cam, W3, (u, z, o) => [u, fh * 0.86 + FACE_EPS * 2 + o, z], fh * 0.30, h * 0.085, fh * 0.20, h * 0.025, seed + 3, nightF, alpha);
    if (night) {
      // One bulb over the counter. It is the last light before the Curtain, and everybody in
      // the district can tell you whether it is on from the far end of Ropewalk.
      const [gx, gy] = F(0, fh * 0.40); glowPool(ctx, cam, gx, gy, h * 0.36, '255,224,160', 6, alpha * 0.20);
    }
  },
  taxidermist(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // STUFF IT — two shapes Coldwater has never drawn, and both of them are
    // about the window. A taxidermist's trade is entirely display, so the glass LEANS OUT at the
    // top: it takes the sky off the surface and shows you the room instead, which is why every
    // real one is built that way and why no ordinary shopfront here is. And there is a MOUNT ON
    // THE ROOF, which is the silhouette: from the air this tile has a creature standing on it.
    const cill = h * 0.12, headHi = h * 0.46;
    const shopTop = h * 0.64, eaves = h * 0.86;
    // 1) THE SHELL — cream render over whatever it used to be, two low storeys, nothing clever.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, shopTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, shopTop, eaves, pal, seed + 1, night, alpha, true);
    // 2) THE CANT, as two steps rather than as a lean. There is no pitch term in this projection,
    //    so a sloping pane cannot be expressed as one box — but a pane that stands further out at
    //    the head than at the cill reads as a cant from anywhere you can actually see it, and it
    //    stays affine in fh, which a real rotation would not. `ty_stuff_glass` joins SHOP_GLASS:
    //    one sill, one head, a lit interior with things in it, and no floor plates.
    { const [lx, ly] = F(0, fh * 0.52); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.80, cill, h * 0.30, 'ty_stuff_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.10); }
    { const [ux, uy] = F(0, fh * 0.62); draw3DBoxAt(ctx, cam, ux, uy, fh * 0.84, h * 0.30, headHi, 'ty_stuff_glass', seed + 3, night, alpha, false, faceYaw(E), fh * 0.12); }
    // 3) THE SIGN GROUND — black painted render above the head of the window, which is what the
    //    lettering is on. Painted, not lit: this shop shuts at six and does not care who knows.
    { const [sx, sy] = F(0, fh * 0.60); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.90, headHi, h * 0.58, 'ty_stuff_dk', seed + 4, night, alpha, false, faceYaw(E), fh * 0.14); }
    // 4) THE MOUNT. A body and a span, as two boxes, which is all a silhouette needs: from the
    //    street it is a shape on a bracket and from the air it is a cruciform on a roofline, and
    //    there is nothing else like it in Coldwater. It is weathering, and everybody has an
    //    opinion about what it is, and the woman inside has never said.
    { const [bx, by] = F(0, fh * 0.56); draw3DBoxAt(ctx, cam, bx, by, fh * 0.06, eaves, eaves + h * 0.16, 'ty_stuff_dk', seed + 5, night, alpha, false); }
    { const [wx, wy] = F(0, fh * 0.56); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.34, eaves + h * 0.09, eaves + h * 0.12, 'ty_stuff_dk', seed + 6, night, alpha, true, faceYaw(E), fh * 0.05); }
    // 5) THE FLUE off the workroom stove, at the back where the chemistry happens. A tannery is
    //    the half of this trade nobody wants in the window, and the flue is the only sign of it.
    { const [fx2, fy2] = F(fh * 0.40, -fh * 0.52); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.07, shopTop, eaves + h * 0.30, 'ty_stuff_dk', seed + 7, night, alpha, true); }
    // THE SIGN IS PAINTED, AND THAT IS THE POINT OF IT. Every other name in this switch goes on
    // through `marqueeBand` or `neonBlade`, both of which light up after dark. This one is black
    // and cream brushed straight onto the render, so it goes through the surface-lettering path
    // with ⚠ `dn: 0` RATHER THAN `night ? 1 : 0` — which every other caller passes. The result is
    // the one shopfront on The Gate Road that is genuinely dark at night, in a city where the
    // default is that a shop announces itself. Nobody coming up from the South Gate after six
    // can read it, and she has never once thought that was a problem worth money.
    if (frontVis) {
      const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
      const bz0 = headHi + h * 0.018, bz1 = h * 0.566, bhw = fh * 0.76, by = fh * 0.746;
      const TL = P(-bhw, by, bz1), TR = P(bhw, by, bz1), BR = P(bhw, by, bz0), BL = P(-bhw, by, bz0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'STUFF IT', '#efe3c6', 0, false);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      // The picture lights, seen through the cant. Small and warm, and the only light on this
      // building: there is no fascia lighting, no blade and no spill onto the road.
      const [gx, gy] = F(0, fh * 0.58); glowPool(ctx, cam, gx, gy, h * 0.26, '255,206,140', 8, alpha * 0.22);
    }
  },
  lending_library(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // FINE PRINT — the only building in Coldwater that is lit from ABOVE.
    // Every other lit thing in this city throws its light sideways at the street: a fascia, a
    // blade, a shopfront, a marquee. A top-lit reading room does the opposite, and the roof is
    // therefore the whole model — at night this tile is a bar of pale light lying along its own
    // ridge, visible from the air and from nowhere at street level, which is the point of it.
    const plinth = h * 0.10, cill = h * 0.52;
    const wallTop = h * 0.88, cornice = h * 0.98;
    const lantern = h * 1.12;
    // 1) THE PLINTH. A civic building stands ON something, and five steps up to the door is the
    //    part of the elevation that says you are entering rather than walking in.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, 0, plinth, 'ty_fprint_stone', seed, night, alpha, false);
    // 2) THE BOX. Blind to head height and deliberately so: `ty_fprint` is in STONE_WALL, which
    //    is the family for the buildings whose whole argument is that they were here before you.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, plinth, wallTop, pal, seed + 1, night, alpha, false);
    // 3) THE HIGH WINDOW BAND. It starts above head height because a reading room does not want
    //    the street in it, and it is drawn as one recessed band rather than as punched openings.
    { const [bx, by] = F(0, fh * 0.60); draw3DBoxAt(ctx, cam, bx, by, fh * 0.80, cill, h * 0.78, 'ty_fprint_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.06); }
    // 4) THE CORNICE, oversailing, which is the one piece of expense on the whole elevation.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, wallTop, cornice, 'ty_fprint_stone', seed + 3, night, alpha, true);
    // 5) THE LANTERN. A long glazed monitor down the ridge — narrow across, nearly the full depth
    //    of the building along it, which is what makes it a RIDGE rather than a box on a roof.
    //    Non-square, so it takes faceYaw(E): leave that off and it is right on a north-facing
    //    tile and a diamond on the other three.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.30, cornice, lantern, 'ty_fprint_glass', seed + 4, night, alpha, true, faceYaw(E), fh * 0.82);
    // 6) THE CHIMNEY, off the boiler, because the reading room is the only warm public building
    //    in the Filaments and that is a fact about the district rather than about the library.
    { const [cx2, cy2] = F(-fh * 0.62, -fh * 0.58); draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.10, wallTop, lantern + h * 0.14, 'ty_fprint_stone', seed + 5, night, alpha, true); }
    // The name is CUT INTO THE LINTEL rather than hung on the front, so the band sits low, at the
    // head of the doors, and it is stone-coloured. There is no neon on this building at all.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.76, h * 0.40, m.neon || '#d8d2bc', night, alpha);
    if (night) {
      // ⚠ THE POOL SITS AT THE LANTERN, NOT AT THE PAVEMENT, and that is the entire model. Every
      // other glowPool in this switch is placed at the front face to wash the street; this one is
      // on the ridge, because what this building does after dark is glow along its own roof.
      glowPool(ctx, cam, dx, dy, lantern, '238,230,196', 16, alpha * 0.40);
      const [wx, wy] = F(0, fh * 0.62); glowPool(ctx, cam, wx, wy, h * 0.64, '226,214,170', 7, alpha * 0.16);
    }
  },
  pool_hall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // POCKET MONEY — THE FRONT DOOR IS ON THE FIRST FLOOR, and nothing else in
    // Coldwater does that. Every other entrance in this switch is a hole in a ground-floor wall
    // with a canopy or an awning over it; this one is a steel stair bolted to the flank, and what
    // it reaches is a long low hall with a glazed ribbon down the side of it. The two together
    // are the read: a dead shutter at street level, and a lit band above it.
    const lockTop = h * 0.40, hallTop = h * 0.88, hallPar = h * 0.96;
    // 1) THE DEAD LOCK-UP. Not part of the business and drawn so: a shuttered box in overlapping
    //    steel (PLATE_WALL, which is what a roller shutter actually is) with nothing on it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, lockTop, 'ty_pocket_shut', seed, night, alpha, false);
    // 2) THE HALL, oversailing the lock-up a little, which is what makes the first floor read as
    //    the building and the ground floor as the thing it happens to stand on.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, lockTop, hallTop, pal, seed + 1, night, alpha, false);
    // 3) THE CLERESTORY. One continuous glazed band near the top of the hall, running its whole
    //    length — the band, not punched openings, because that is how a room lit for tables is
    //    glazed: you want the sky and none of the street. SHOP_GLASS, so it is one opening with a
    //    room behind it rather than a grid of floor plates.
    { const [gx, gy] = F(0, fh * 0.50); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.92, h * 0.66, h * 0.80, 'ty_pocket_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.50); }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, hallTop, hallPar, pal, seed + 3, night, alpha, true);
    // 4) THE STAIR, as four steps up the flank plus a landing. Stepped boxes rather than one ramp
    //    because there is no way to tilt a box in this projection, and four is enough: from the
    //    street it is a stair and from the air it is a stair, which is the whole job. It sits on
    //    the local +x flank, so it lands on the correct side at every entrance facing.
    for (let i = 0; i < 4; i++) {
      const [sx, sy] = F(fh * 0.86, fh * (0.34 - i * 0.30));
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.12, 0, lockTop * (0.30 + i * 0.24), 'ty_pocket_stair', seed + 4 + i, night, alpha, true, faceYaw(E), fh * 0.15);
    }
    { const [lx, ly] = F(fh * 0.86, -fh * 0.60); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.16, lockTop * 0.96, lockTop, 'ty_pocket_stair', seed + 8, night, alpha, true, faceYaw(E), fh * 0.20); }
    if (frontVis) { const [nx, ny] = F(fh * 0.56, fh * 1.00); neonBlade(ctx, cam, nx, ny, h * 0.28, h * 0.74, m.neon || '#6effa8', night, alpha); }
    if (night) {
      // ⚠ THE POOL IS AT THE CLERESTORY, NOT AT THE PAVEMENT. Eight shaded lamps hung low over
      // eight tables put almost nothing on the ceiling and nothing at all on the street; what
      // escapes goes out sideways through the band. A pool at the door would be a lit entrance,
      // and the entrance to this building is a dark stair with one bulb at the turn.
      const [gx, gy] = F(0, fh * 0.56); glowPool(ctx, cam, gx, gy, h * 0.74, '186,255,206', 11, alpha * 0.30);
      const [bx, by] = F(fh * 0.86, -fh * 0.60); glowPool(ctx, cam, bx, by, lockTop, '255,226,170', 5, alpha * 0.20);
    }
  },
  amusements(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE PENNY DROPS — THE BUILDING WITH NO FRONT WALL. Every other shopfront
    // in this city is glass in a frame; this one is an opening, and after dark the light comes out
    // at ankle height and lies across the road. So the front is not drawn as a wall at all: two
    // piers, a lintel across them, and the lit back of the room standing in the gap between.
    // ⚠ AND THE OPENING HAS TO BE ONE A PERSON WALKS THROUGH. See the ⚠ on the fishmonger: this
    // tile is authored at one floor, so the old `lintel = 0.50 h` was **6.0 ft** — an arcade you
    // stoop to enter, under a 8.9 ft fascia. The whole read of this building is a wide lit gap in
    // a street of glass, and the gap was the one part too small to be a gap.
    const shedTop = h * 0.98, lintel = h * 0.78, fascia = h * 1.16;
    // 1) THE SHED, SET BACK. Pushed away from the street so the piers in front of it have depth to
    //    stand in, which is what turns three boxes into an opening rather than a stripe.
    { const [bx, by] = F(0, -fh * 0.22); draw3DBoxAt(ctx, cam, bx, by, fh * 0.92, 0, shedTop, pal, seed, night, alpha, true, faceYaw(E), fh * 0.72); }
    // 2) THE LIT BACK OF THE ROOM, in the gap. PLAIN_WALL: no courses, no laps, no board lines,
    //    because what you are looking at is eleven cabinets lit from inside and the wash they put
    //    on the wall behind them. Any rhythm in it would be a lie about what is making the light.
    { const [ix, iy] = F(0, fh * 0.28); draw3DBoxAt(ctx, cam, ix, iy, fh * 0.70, 0, lintel, 'ty_penny_lit', seed + 1, night, alpha, false, faceYaw(E), fh * 0.10); }
    // 3) THE PIERS either side of the opening, and the lintel over them. The piers are what stop
    //    the building reading as a hole in the ground.
    for (const t of [-1, 1]) { const [px, py] = F(t * fh * 0.82, fh * 0.44); draw3DBoxAt(ctx, cam, px, py, fh * 0.16, 0, fascia, pal, seed + 2 + t, night, alpha, true, faceYaw(E), fh * 0.22); }
    { const [hx, hy] = F(0, fh * 0.44); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.98, lintel, fascia, pal, seed + 5, night, alpha, true, faceYaw(E), fh * 0.22); }
    // 4) THE SHUTTER, ROLLED UP, sitting in its box under the lintel. It is the reason the front
    //    can be open at all and it is visible from the street every day of the year.
    { const [rx, ry] = F(0, fh * 0.50); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.78, lintel - h * 0.07, lintel, 'ty_pocket_shut', seed + 6, night, alpha, false, faceYaw(E), fh * 0.07); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.88, h * 0.98, m.neon || '#ffb03a', night, alpha);
    if (night) {
      // ⚠ AND THIS ONE'S POOL IS ON THE PAVEMENT, which is the opposite of the pool hall's and for
      // the same reason in reverse: there is no wall to stop it. The light out of an open front
      // lands on the road, and from the top of Meltwater Row it is the brightest patch of ground
      // in the district. Two pools, because the near one is the spill and the far one is the room.
      const [ox, oy] = F(0, fh * 1.16); glowPool(ctx, cam, ox, oy, h * 0.06, '255,206,128', 18, alpha * 0.46);
      const [cx2, cy2] = F(0, fh * 0.30); glowPool(ctx, cam, cx2, cy2, h * 0.30, '198,150,255', 12, alpha * 0.34);
    }
  },
  fishmonger(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CODFATHER — A COUNTER WITH A ROOF ON IT. There is no glazing on this
    // building anywhere, which on a street of shopfronts is what you notice before you smell
    // anything. The slab is the elevation: a marble shelf the full width of the frontage, canted
    // at the street, the awning over it, and the ice melting off the front edge all day.
    //
    // ⚠ AND THE ENVELOPE IS SPENT NEAR 1.0 OF `h` BECAUSE THIS TILE IS AUTHORED AT ONE STOREY.
    // `h` is the STOREY STACK, so a fraction that reads as modest on a two-floor building is a
    // different building at one: this shell was `0.58 h` with eaves at `0.70`, which at
    // `flags.floors: 1` is a shop **8.4 ft to the top of the fascia** — under the 7.3 ft a truck
    // cab's eye sits at. From the road you looked straight over the whole thing and saw a name
    // band and a rooftop hoarding standing on nothing, which is what was reported. The COUNTER
    // was always right (the slab at 2.4–3.6 ft, the ice on top of it) and stays exactly where it
    // was; it is the walls, the awning and the fascia that were built to the wrong number.
    // Same defect as the `fuel_yard` row in TYPE_FLOORS, arrived at from the other end — there
    // the number was too big for the fractions, here the fractions are too small for the number.
    const shopTop = h * 0.96, codEaves = h * 1.15;
    // 1) THE SHELL, tiled to shoulder height and blind on every side. TILE_WALL: the one material
    //    family whose main event is a highlight rather than a shadow, which is what a wall that
    //    gets hosed down twice a day looks like, and which is why a clinic and a butcher share it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, shopTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, shopTop, codEaves, pal, seed + 1, night, alpha, true);
    // 2) THE SLAB, standing out over the pavement on its own. Marble in STONE_WALL, and the one
    //    horizontal surface in this switch that is the POINT of its building rather than a lid on
    //    it — so it is thick enough to read as a shelf from above as well as from the road.
    { const [sx, sy] = F(0, fh * 0.92); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.96, h * 0.20, h * 0.30, 'ty_cod_marble', seed + 2, night, alpha, true, faceYaw(E), fh * 0.28); }
    // 3) THE BED OF ICE on the slab, which is what everybody is actually looking at. A shallow lid
    //    of its own, a shade off white, and the reason the whole frontage reads cold.
    { const [ix, iy] = F(0, fh * 0.90); draw3DBoxAt(ctx, cam, ix, iy, fh * 0.86, h * 0.30, h * 0.34, 'ty_cod_ice', seed + 3, night, alpha, true, faceYaw(E), fh * 0.22); }
    // 4) THE AWNING, let down on two poles over the slab. `awning` rather than a box, for the
    //    reason that helper exists: it spans the whole frontage and comes out about a third of a
    //    tile, and one square footprint cannot do both without standing in the road.
    awning(ctx, cam, dx, dy, E, fh * 0.96, fh * 1.14, h * 0.63, h * 0.68, 'ty_cod_awn', seed + 4, night, alpha, fh * 0.36);
    // The name on the fascia, which is where the prose puts it — under the eaves and above the
    // awning, not floating at the old `0.62 h` where the awning now is.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.84, h * 1.00, m.neon || '#8fd8ff', night, alpha);
    if (night) {
      // The shop shuts at one and the cold store does not. What is lit after dark is the ice
      // itself, off the tubes he leaves on over the bed, and it is the only cold-coloured light
      // on Filament Street.
      const [gx, gy] = F(0, fh * 0.92); glowPool(ctx, cam, gx, gy, h * 0.34, '178,226,255', 7, alpha * 0.22);
    }
  },
  cobbler(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SOLE SURVIVOR — THE SMALLEST BUILDING IN COLDWATER, and drawn at a scale
    // nothing else here is: eleven feet wide, one slope of roof off the neighbour's gable, and a
    // window at BENCH height rather than at eye height. From the cab it reads as a shed somebody
    // has squeezed into the gap where a terrace steps down, which is exactly what it is.
    // ⚠ SMALLEST IS NOT FIVE FEET TALL. See the ⚠ on the fishmonger: `h` is the storey stack and
    // this tile is authored at one floor, so `0.42 h` put the ridge at **5.0 ft** — not a shed
    // squeezed into a gap, a doll's house you could step over, and the shortest thing in
    // Coldwater by a factor of four. Eaves at 9 ft and a ridge at 11 keep it the smallest
    // building in the city and make it one somebody can stand up in.
    const soleTop = h * 0.76, soleRidge = h * 0.92;
    // 1) THE LEAN-TO. Offset onto the local +x side, because a lean-to leans on something: it is
    //    built into the gap at the end of a terrace, and centring it would make it a hut in a yard.
    { const [bx, by] = F(fh * 0.30, 0); draw3DBoxAt(ctx, cam, bx, by, fh * 0.38, 0, soleTop, pal, seed, night, alpha, false, faceYaw(E), fh * 0.62); }
    // 2) THE ROOF, one slope, oversailing on the low side. Two boxes rather than a pitch, which at
    //    this scale is the whole of what a mono-pitch reads as from the street.
    { const [rx, ry] = F(fh * 0.30, 0); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.44, soleTop, soleRidge, 'ty_sole_dk', seed + 1, night, alpha, true, faceYaw(E), fh * 0.68); }
    // 3) THE BENCH WINDOW. Low, wide, and the reason the building is worth drawing at all: it is
    //    set at the height of the work, so what the street sees through it is a pair of hands.
    { const [wx, wy] = F(fh * 0.30, fh * 0.62); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.28, h * 0.22, h * 0.46, 'ty_sole_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.05); }
    // 4) THE BOOT ON ITS BRACKET — iron, the size of a coal scuttle, repaired twice itself. An arm
    //    out of the wall and a body hanging off it, which is enough: at any distance where you can
    //    see it at all, an object standing off a wall at head height over a door is a trade sign.
    { const [ax, ay] = F(fh * 0.30, fh * 0.60); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.14, h * 0.60, h * 0.64, 'ty_sole_dk', seed + 3, night, alpha, false, faceYaw(E), fh * 0.03); }
    { const [kx, ky] = F(fh * 0.30, fh * 0.70); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.07, h * 0.64, h * 0.86, 'ty_sole_dk', seed + 4, night, alpha, true, faceYaw(E), fh * 0.05); }
    if (night) {
      // He works late and the bench lamp is nine inches off the work, so what reaches the street
      // is a low bar of light at knee height and nothing above it. Small on purpose.
      const [gx, gy] = F(fh * 0.30, fh * 0.64); glowPool(ctx, cam, gx, gy, h * 0.17, '255,214,150', 5, alpha * 0.26);
    }
  },
  photographer(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // NEGATIVE EQUITY — A ROOF THAT IS NOT A ROOF. The whole north slope is
    // glass, tilted AWAY from the sun rather than toward it, which is the one thing every purpose
    // built studio in history has in common and which reads from the air as a building with a
    // mistake in it. Fine Print has the only other glazed roof in Coldwater and it is a narrow
    // ridge monitor; this is a whole pitch, and the two are not the same silhouette at all.
    const shopTop = h * 0.50, ridge = h * 0.94;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, shopTop, pal, seed, night, alpha, false);
    // THE SLOPE, as three steps of glass falling away from the ridge. There is no way to tilt a
    // box in this projection, so a pitch is a stair, and three treads is enough to read as one at
    // any distance where the building is more than a smudge.
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      const [gx, gy] = F(0, fh * (0.46 - i * 0.30));
      draw3DBoxAt(ctx, cam, gx, gy, fh * 0.86, shopTop, shopTop + (ridge - shopTop) * (0.34 + t * 0.66), 'ty_negeq_glass', seed + 1 + i, night, alpha, true, faceYaw(E), fh * 0.16);
    }
    // …and the solid back wall it leans against, which is what makes the glass read as a SLOPE
    // rather than as a stack of lit boxes.
    { const [bx, by] = F(0, -fh * 0.60); draw3DBoxAt(ctx, cam, bx, by, fh * 0.90, shopTop, ridge, pal, seed + 5, night, alpha, true, faceYaw(E), fh * 0.24); }
    // The display case beside the door, lit, eleven portraits and a card.
    { const [cx2, cy2] = F(-fh * 0.50, fh * 0.94); draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.20, h * 0.16, h * 0.38, 'ty_negeq_case', seed + 6, night, alpha, true, faceYaw(E), fh * 0.06); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.80, h * 0.44, m.neon || '#cfe0ff', night, alpha);
    if (night) {
      // ⚠ THE GLOW IS ON THE ROOF. A studio works by daylight and she is printing after dark, so
      // what is lit at night is the slope, dimly, from the safelight and the enlarger bulb behind
      // it — and the case by the door, brightly, because that is the only advertising she does.
      const [gx, gy] = F(0, fh * 0.10); glowPool(ctx, cam, gx, gy, ridge * 0.92, '206,220,255', 9, alpha * 0.24);
      const [cx3, cy3] = F(-fh * 0.50, fh * 0.98); glowPool(ctx, cam, cx3, cy3, h * 0.28, '255,236,206', 6, alpha * 0.30);
    }
  },
  locksmith(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SKELETON CREW — THE SIGN IS BIGGER THAN THE BUILDING, which is the entire
    // composition: one bay of frontage, and a nine-foot iron key hanging off the corner of it. The
    // proportion is the joke and it is also just true of every locksmith that has ever existed,
    // because a shop four feet wide has to be found from the end of the street somehow.
    const wallTop = h * 0.78, lockPar = h * 0.88;
    // ⚠ A THIRD OF A TILE WIDE. Most arms here sit near fh * 0.9; this one is deliberately the
    // narrowest mass in the switch, because the building is a slot between two others and drawing
    // it at ordinary width would delete the only thing about it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.32, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.38, wallTop, lockPar, 'ty_skel_dk', seed + 1, night, alpha, true);
    // The four feet of window, with the board of blanks across it.
    { const [wx, wy] = F(fh * 0.08, fh * 0.34); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.16, h * 0.18, h * 0.46, 'ty_skel_glass', seed + 2, night, alpha, false, faceYaw(E), fh * 0.04); }
    // THE KEY. Drawn as a blade, because a blade is what it is: a flat board standing off the
    // corner, taller than the shopfront, turning very slightly in a wind nobody has modelled.
    if (frontVis) { const [nx, ny] = F(fh * 0.40, fh * 0.42); neonBlade(ctx, cam, nx, ny, h * 0.30, h * 1.22, m.neon || '#d8c88a', night, alpha); }
    if (night) { const [gx, gy] = F(0, fh * 0.40); glowPool(ctx, cam, gx, gy, h * 0.30, '255,228,164', 5, alpha * 0.22); }
  },
  tattooist(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // NO REGERTS — A VERTICAL STRIP OF LIGHT UP A DARK BUILDING, and nothing else
    // in Coldwater is that shape. The trade is on the first floor and the way up is a stair with a
    // window running the full height of the flight, with the flash pinned across the glass and lit
    // all night. So the elevation is: a shuttered unit, a dark wall, and one bright vertical line.
    const unitTop = h * 0.44, wallTop = h * 0.92, inkPar = h * 1.00;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, 0, unitTop, 'ty_pocket_shut', seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, unitTop, wallTop, pal, seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, wallTop, inkPar, pal, seed + 2, night, alpha, true);
    // THE STAIR WINDOW. Narrow, and running from the pavement to the first floor in one piece,
    // which is what makes it a STRIP rather than two windows above each other.
    { const [sx, sy] = F(fh * 0.62, fh * 0.50); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.13, h * 0.06, h * 0.86, 'ty_regerts_glass', seed + 3, night, alpha, false, faceYaw(E), fh * 0.05); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.70, h * 0.50, m.neon || '#ff5ac8', night, alpha);
    if (night) {
      // ⚠ TWO POOLS, ONE TALL AND ONE SMALL, and the tall one is the building. It sits at the
      // MIDDLE of the strip rather than at the pavement, so the light reads as coming off a
      // vertical thing rather than out of a door.
      const [sx, sy] = F(fh * 0.62, fh * 0.54); glowPool(ctx, cam, sx, sy, h * 0.46, '255,196,236', 8, alpha * 0.34);
      const [dx2, dy2] = F(-fh * 0.30, fh * 0.52); glowPool(ctx, cam, dx2, dy2, h * 0.14, '255,150,210', 4, alpha * 0.18);
    }
  },
  vet(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // PAWS FOR THOUGHT — THE ONLY DOMESTIC BUILDING IN COLDWATER DOING BUSINESS. It is
    // a house: brick, a pitched roof, a chimney that is lit most evenings, and a square BAY WINDOW
    // standing out from the front wall with a waiting room behind it. Everything else in this
    // switch is a shop or a works or an institution; this is somebody's front room with eight
    // chairs in it, and drawing it at house scale is the whole read.
    const eaves = h * 0.56, apex = h * 0.80;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, eaves, pal, seed, night, alpha, false);
    // The pitched roof, as two steps. A house roof and a warehouse roof differ in exactly one
    // thing at this distance, which is that a house has a ridge and a chimney on it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.70, eaves, h * 0.70, 'ty_paws_roof', seed + 1, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.44, h * 0.70, apex, 'ty_paws_roof', seed + 2, night, alpha, true);
    { const [cx4, cy4] = F(-fh * 0.48, -fh * 0.30); draw3DBoxAt(ctx, cam, cx4, cy4, fh * 0.11, eaves, apex + h * 0.16, pal, seed + 3, night, alpha, true); }
    // THE BAY, standing proud of the front wall on three sides of glass with a deep sill. This is
    // the part that says house rather than shop: a shopfront is flush and a bay is not.
    { const [bx, by] = F(-fh * 0.34, fh * 0.76); draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, h * 0.10, h * 0.42, 'ty_paws_glass', seed + 4, night, alpha, true, faceYaw(E), fh * 0.16); }
    // The canopy over the door on two posts, and the bench under it.
    awning(ctx, cam, dx, dy, E, fh * 0.30, fh * 0.94, h * 0.40, h * 0.44, 'ty_paws_roof', seed + 5, night, alpha, fh * 0.20);
    if (night) {
      // A lit front room and a lit chimney, and nothing on the road. She does not advertise and
      // the people who need her at three in the morning already know which house it is.
      const [gx, gy] = F(-fh * 0.34, fh * 0.80); glowPool(ctx, cam, gx, gy, h * 0.26, '255,220,168', 6, alpha * 0.30);
    }
  },
  off_licence(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SPIRIT LEVEL — ONE LIT RECTANGLE ON A BLACK BUILDING. The last shop before
    // the South Gate, built like it knows that: a folding grille over the whole frontage, glass
    // BLOCK instead of glass, and the only opening is a hatch cut in a steel shutter at chest
    // height. After dark the entire elevation is dead except one small bright hole, which is a
    // night silhouette nothing else in the city has.
    const wallTop = h * 0.72, offPar = h * 0.84;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, wallTop, offPar, 'ty_spirit_dk', seed + 1, night, alpha, true);
    // THE SHUTTER across the whole frontage — steel, drawn down, and the reason there is nothing
    // else to look at.
    { const [sx, sy] = F(0, fh * 0.52); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.86, 0, h * 0.52, 'ty_pocket_shut', seed + 2, night, alpha, false, faceYaw(E), fh * 0.06); }
    // THE HATCH. Small, at chest height, and the only thing on this building that is not shut.
    { const [hx, hy] = F(fh * 0.14, fh * 0.58); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.15, h * 0.22, h * 0.36, 'ty_spirit_hatch', seed + 3, night, alpha, false, faceYaw(E), fh * 0.04); }
    // The glass block above it, which lets light out and nothing else through.
    { const [bx, by] = F(-fh * 0.36, fh * 0.56); draw3DBoxAt(ctx, cam, bx, by, fh * 0.26, h * 0.30, h * 0.48, 'ty_spirit_block', seed + 4, night, alpha, false, faceYaw(E), fh * 0.05); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.78, h * 0.60, m.neon || '#ffd27a', night, alpha);
    if (night) {
      // ⚠ ONE SMALL POOL AND IT IS AT THE HATCH. Every instinct says light a shopfront; this
      // building's whole argument is that it does not. The pool is deliberately tight, so from
      // up the road it is a bright hole rather than a lit shop.
      const [gx, gy] = F(fh * 0.14, fh * 0.62); glowPool(ctx, cam, gx, gy, h * 0.29, '255,226,158', 4, alpha * 0.38);
    }
  },
  museum(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // PAST PERFECT — FOUR COLUMNS AND A PEDIMENT ON A BUILDING ONE ROOM DEEP. The
    // portico is about two and a half times the architectural seriousness the shed behind it can
    // support, which is a joke somebody BUILT rather than told, and it is the only classical order
    // in Coldwater outside the bank and the Hall of Records — both of which are the real thing and
    // three times the size. The gap between the front and the back is the building.
    const hallTop = h * 0.64, colTop = h * 0.74, ped = h * 0.92;
    // 1) THE SHED. Plain, cheap, and honest about it, set back behind the portico.
    { const [bx, by] = F(0, -fh * 0.26); draw3DBoxAt(ctx, cam, bx, by, fh * 0.80, 0, hallTop, pal, seed, night, alpha, true, faceYaw(E), fh * 0.64); }
    // 2) THE STYLOBATE — the stepped platform the columns stand on, because a portico standing
    //    straight on the pavement is a porch.
    { const [px, py] = F(0, fh * 0.62); draw3DBoxAt(ctx, cam, px, py, fh * 0.92, 0, h * 0.09, 'ty_past_stone', seed + 1, night, alpha, true, faceYaw(E), fh * 0.34); }
    // 3) FOUR COLUMNS. Four, not six: the front is the width of a shed and the order has been
    //    squeezed to fit it, which is a thing you can see and is the point.
    for (const t of [-0.66, -0.22, 0.22, 0.66]) {
      const [cx5, cy5] = F(t * fh, fh * 0.70);
      draw3DBoxAt(ctx, cam, cx5, cy5, fh * 0.09, h * 0.09, colTop, 'ty_past_stone', seed + 3 + t * 10, night, alpha, false);
    }
    // 4) THE ENTABLATURE AND THE PEDIMENT, as two steps of decreasing width. A pediment is a
    //    triangle and a triangle is two boxes at this distance, and the lettering goes on the
    //    lower of them where there is room for it.
    { const [ex, ey] = F(0, fh * 0.66); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.94, colTop, h * 0.83, 'ty_past_stone', seed + 8, night, alpha, false, faceYaw(E), fh * 0.30); }
    { const [fx2, fy2] = F(0, fh * 0.66); draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.58, h * 0.83, ped, 'ty_past_stone', seed + 9, night, alpha, true, faceYaw(E), fh * 0.26); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.84, h * 0.78, m.neon || '#e2dcc4', night, alpha);
    if (night) {
      // Eleven lit cases in a dark room, seen through two tall windows shuttered to two-thirds.
      // It is open in the day and he is in there most of the night writing labels.
      const [gx, gy] = F(0, fh * 0.30); glowPool(ctx, cam, gx, gy, h * 0.40, '244,226,170', 7, alpha * 0.20);
    }
  },
  concert_hall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SOUND INVESTMENT — THE ONLY FLY TOWER IN COLDWATER, and that is the
    // whole silhouette. Every performance building in this city so far is a box with a sign on it;
    // this one has a blind windowless slab standing two storeys clear of its own roof, set back off
    // the street, because scenery has to go somewhere and the somewhere is up. From the road you
    // read a stone front; from the air you read the tower, and the two do not look like the same
    // building, which is true of every real one.
    const hallTop = h * 0.66, flyTop = h * 1.24, frontTop = h * 0.52, lintel = h * 0.60;
    // 1) THE AUDITORIUM — a glazed DRUM, which is what an auditorium is: a room with no corners
    //    in it, wrapped in the vacuum jacket that lets it sit inside a quarter this loud. That
    //    jacket is the glass, which is why a hall you cannot hear through does not have to be
    //    blind. `ty_sound_hall` is in GLASS_WALL, so it takes the floor-plate striping and the
    //    sky sheen rather than a tenement window grid — there are no floors behind it at all.
    drawFacetDrum(ctx, cam, dx, dy, 0, hallTop, fh * 0.88, fh * 0.84, 20, alpha, hfGlass(night, [44, 66, 90]), null, 'ty_sound_hall');
    // 2) THE FLY TOWER, set back over the platform end: a chrome drum standing two storeys clear
    //    of the hall's own crown. It is the tallest thing on the plot and the cheapest surface on
    //    it, which is the building's joke, and a cylinder is what you actually fly scenery in.
    { const [tx, ty2] = F(0, -fh * 0.30);
      drawFacetDrum(ctx, cam, tx, ty2, hallTop, flyTop, fh * 0.50, fh * 0.46, 16, alpha, hfChrome([104, 118, 132], [222, 234, 242], 1.9), hfChrome([112, 126, 140], [196, 210, 220], 1.4), 'ty_sound_fly'); }
    // 3) THE FRONT — a low chrome canopy across the width of the plot, standing clear of the
    //    drum, with a drum at each end so the plan reads as a lozenge rather than as a slab
    //    pushed up against a cylinder. This is the part the endowment paid for.
    { const [fx, fy] = F(0, fh * 0.60); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.82, 0, frontTop, pal, seed + 2, night, alpha, true, faceYaw(E), fh * 0.30); }
    for (const t of [-1, 1]) { const [qx, qy] = F(t * fh * 0.82, fh * 0.60);
      drawFacetDrum(ctx, cam, qx, qy, 0, frontTop, fh * 0.30, fh * 0.30, 14, alpha, hfChrome([116, 132, 148], [230, 240, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_sound'); }
    // 4) THE FASCIA the name is cut into, oversailing the canopy below it by a little so the
    //    shadow under it reads as a separate plate rather than as a painted band. ⚠ IT STAYS A
    //    FLAT BOX, and that is the one square thing left on this building: the lettering below is
    //    a planar quad through `emitSurfaceText`, and a name mapped onto a curve would arrive
    //    sheared. A curved fascia is a glyph atlas, which this renderer does not have.
    { const [lx, ly] = F(0, fh * 0.64); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.90, frontTop, lintel, pal, seed + 3, night, alpha, true, faceYaw(E), fh * 0.26); }
    // 5) THE PODIUM the whole thing stands on. A drum straight off the gravel is a tank.
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.06, fh * 1.00, fh * 0.96, 20, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [200, 214, 224], 1.4), 'ty_sound');
    // 6) THE NAME IS CUT, NOT LIT. It goes through the surface-lettering path rather than through
    //    `marqueeBand` or `neonBlade`, because an endowed hall does not advertise and this one has
    //    never needed to: the forty people who come already know when.
    //    ⚠ `dn: 0, solid, tight` — all three, and each one is a different failure. Without `solid`
    //    the default `put` lays a white core over the ink and cream letters come out WHITE with a
    //    halo; without `dn: 0` they are backlit, which is a neon tube and not a chisel; and without
    //    `tight` the reservation is one MONO cell per character, so this serif face fills about
    //    half its own texture and the name draws at half the size the lintel has room for.
    //    What makes it legible after dark is the lamp at (7), which is a separate light on a
    //    separate surface — exactly how a building that cut its name into a plate lights it.
    if (frontVis) {
      const P = (lx2, ly2, z) => { const [wx, wy] = F(lx2, ly2); return cam.proj(wx, wy, z); };
      const bz0 = frontTop + h * 0.012, bz1 = lintel - h * 0.012, bhw = fh * 0.84, by = fh * 0.94;
      const TL = P(-bhw, by, bz1), TR = P(bhw, by, bz1), BR = P(bhw, by, bz0), BL = P(-bhw, by, bz0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'SOUND INVESTMENT', '#dfe8ee', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      // 7) The fascia lamp, washing UP the cut letters from a bracket over the doors, and the
      //    foyer behind the glazing. The foyer is the brighter of the two and is on whether or
      //    not there is a concert, because the terms say a season and the season says lit.
      //    ⚠ THE LAMPS STAY WARM in a quarter that is otherwise entirely cyan, and that is the
      //    one thing the restyle did not touch: the endowment predates the estate by decades and
      //    the hall lights itself the way it always did, which is most of what still tells you
      //    it was here first.
      const [nx, ny] = F(0, fh * 0.92); glowPool(ctx, cam, nx, ny, h * 0.20, '242,230,194', 9, alpha * 0.30);
      const [gx, gy] = F(0, fh * 0.74); glowPool(ctx, cam, gx, gy, h * 0.26, '255,226,168', 11, alpha * 0.26);
      glowPool(ctx, cam, dx, dy, hallTop - h * 0.08, '186,220,240', 10, alpha * 0.16);
    }
  },
  members_club(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // VESTED INTEREST — THE ONLY BUILDING IN COLDWATER THAT LETTERS NOTHING.
    // Every other arm in this switch ends in a marquee, a blade or a name cut somewhere; this one
    // is a townhouse front with a portico, one lamp, and no sign of any kind, and the whole read is
    // that absence. It works because the street it stands on is full of buildings that shout.
    const groundTop = h * 0.46, firstTop = h * 0.82, parTop = h * 0.90;
    // 1) THE HOUSE. One chrome drum, unbroken from the pavement to the coping. `ty_vested` is in
    //    PLAIN_WALL, so it is a seamless clad cylinder that draws no opening anywhere — which is
    //    the same argument the ashlar version was making and is better made in a material that
    //    could have had a window in it and does not.
    drawFacetDrum(ctx, cam, dx, dy, 0, firstTop, fh * 0.88, fh * 0.84, 20, alpha, hfChrome([96, 108, 124], [206, 218, 232], 2.1), null, pal);
    // 2) THE COPING, a shallow step at the top, because a house ends in a cornice and not in a
    //    roofline, and that one step is most of what says "house" rather than "block" at range.
    drawFacetDrum(ctx, cam, dx, dy, firstTop, parTop, fh * 0.92, fh * 0.90, 20, alpha, hfChrome([106, 120, 136], [230, 240, 248], 1.8), hfChrome([112, 126, 142], [198, 212, 222], 1.4), 'ty_hf_chrome');
    // 3) THE PORTICO — two chrome columns and a flat hood over four steps, and it is the one
    //    part of the building that still has a corner in it. Shallow, because this is not making
    //    a civic claim; it is making a domestic one, expensively.
    for (const t of [-0.34, 0.34]) {
      const [cx3, cy3] = F(t * fh, fh * 0.80);
      drawFacetDrum(ctx, cam, cx3, cy3, h * 0.05, h * 0.34, fh * 0.07, fh * 0.065, 10, alpha, hfChrome([88, 102, 118], [232, 242, 248], 2.3), null, 'ty_hf_chrome');
    }
    { const [hx, hy] = F(0, fh * 0.80); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.46, h * 0.34, h * 0.40, 'ty_hf_chrome', seed + 5, night, alpha, true, faceYaw(E), fh * 0.20); }
    { const [sx3, sy3] = F(0, fh * 0.86);
      drawFacetDrum(ctx, cam, sx3, sy3, 0, h * 0.05, fh * 0.46, fh * 0.44, 16, alpha, hfChrome([116, 130, 146], [226, 238, 246], 1.8), hfChrome([124, 138, 154], [198, 212, 222], 1.4), 'ty_hf_deck'); }
    // 4) THE DOOR. Smoked glass with nothing behind it lit, recessed under the hood, and the only
    //    dark thing on the elevation. ⚠ It is the club's whole argument and it survives the
    //    restyle unchanged: absence reads the same in any material.
    { const [dx4, dy4] = F(0, fh * 0.74); draw3DBoxAt(ctx, cam, dx4, dy4, fh * 0.13, h * 0.05, h * 0.30, 'ty_vested_dk', seed + 7, night, alpha, false, faceYaw(E), fh * 0.03); }
    // 5) ONE LAMP, over the door, in a bracket. ⚠ No `marqueeBand`, no `neonBlade`, no
    //    `bakeSignText` anywhere in this arm — deliberately, and it is the point of the building.
    if (night) { const [gx, gy] = F(0, fh * 0.84); glowPool(ctx, cam, gx, gy, h * 0.42, '255,202,122', 7, alpha * 0.34); }
  },
  auction_house(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // GOING CONCERN — LIT FROM ABOVE, WHICH DECIDES THE WHOLE SHAPE. A
    // saleroom needs even light on the lots and no light in the bidders' eyes, so the long walls
    // carry nothing at all and the glazing is a band under the eaves. That is why this reads as a
    // shed with a good front rather than as a shop: the only opening at street level is a door big
    // enough to walk a piano through.
    const wallTop = h * 0.70, clerTop = h * 0.86, ridge = h * 0.94;
    // 1) THE SHELL — a blind chrome drum, `ty_going` in PLAIN_WALL so it is seamless panelling
    //    with no opening in it anywhere. ⚠ THE ROUND PLAN MAKES THE ARGUMENT BETTER, not merely
    //    differently: what a saleroom wants is even light on the lots from above and none in the
    //    bidders' eyes, and a cylinder under a ring of clerestory has no corner for the light to
    //    fall away in. The square version had four.
    drawFacetDrum(ctx, cam, dx, dy, 0, wallTop, fh * 0.94, fh * 0.90, 20, alpha, hfChrome([108, 122, 138], [216, 228, 238], 2.0), null, pal);
    // 2) THE CLERESTORY, a ring of glazing under the eaves, set in very slightly so the panelling
    //    below it throws a shadow line and the band reads as glass rather than as a paler chrome.
    drawFacetDrum(ctx, cam, dx, dy, wallTop, clerTop, fh * 0.90, fh * 0.88, 20, alpha, hfGlass(night, [50, 76, 100]), null, 'ty_going_glass');
    drawFacetDrum(ctx, cam, dx, dy, clerTop, ridge, fh * 0.96, fh * 0.92, 20, alpha, hfChrome([116, 130, 146], [234, 244, 250], 1.8), hfChrome([124, 138, 154], [200, 214, 224], 1.4), 'ty_hf_chrome');
    // 3) THE GOODS DOOR — wide, tall, and on the entrance face, with the ordinary door beside it.
    //    The rail let into the apron at ankle height is drawn as a thin sill because trolleys have
    //    been running into it for years and it is the most-used part of the building.
    { const [gx5, gy5] = F(-fh * 0.28, fh * 0.92); draw3DBoxAt(ctx, cam, gx5, gy5, fh * 0.30, h * 0.02, h * 0.44, 'ty_door', seed + 3, night, alpha, false, faceYaw(E), fh * 0.03); }
    { const [px5, py5] = F(fh * 0.40, fh * 0.92); draw3DBoxAt(ctx, cam, px5, py5, fh * 0.10, 0, h * 0.26, 'ty_door', seed + 4, night, alpha, false, faceYaw(E), fh * 0.03); }
    { const [sx5, sy5] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, sx5, sy5, fh * 0.86, 0, h * 0.02, pal, seed + 5, night, alpha, true, faceYaw(E), fh * 0.05); }
    // 4) THE NAME, painted straight onto the panelling. Paint, not neon: `dn: 0, solid, tight`.
    //    ⚠ The quad is FLAT against a curved wall and that is deliberate — see the fascia note on
    //    `concert_hall`. At this arc it reads as a plate bolted across the face, which is what a
    //    painted name on a cylinder actually is.
    if (frontVis) {
      const P = (lx6, ly6, z) => { const [wx, wy] = F(lx6, ly6); return cam.proj(wx, wy, z); };
      const z0 = h * 0.48, z1 = h * 0.64, bhw = fh * 0.78, by = fh * 0.96;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'GOING CONCERN', '#dce6ee', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    // 5) Extract and a roof tank. A saleroom full of people in wet coats needs moving air.
    roofClutter(ctx, cam, dx, dy, fh * 0.94, ridge, 'citycore', seed + 6, night, alpha, now);
    if (night) {
      // The clerestory, lit from inside while she is cataloguing, which is most evenings. The
      // pool sits at the BAND rather than at the pavement: this building spills no light downward.
      const [lx7, ly7] = F(0, fh * 0.90); glowPool(ctx, cam, lx7, ly7, (wallTop + clerTop) * 0.5, '226,232,228', 8, alpha * 0.22);
    }
  },
  institute(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // COURSE CORRECTION — A GIANT ORDER ON A BUILDING ONE LECTURE ROOM DEEP.
    // Past Perfect already puts four columns on a shed and that is the joke there; this is the
    // other version of it, which is a serious classical front on a serious little building that is
    // genuinely doing the thing it is dressed for. The pilasters are ENGAGED — flat against the
    // wall rather than standing free — which is what separates an institute from a portico.
    const bodyTop = h * 0.78, entab = h * 0.88, ped = h * 1.00;
    // 1) THE BODY, the palest drum in Coldwater, standing on a chrome step ring.
    drawFacetDrum(ctx, cam, dx, dy, h * 0.06, bodyTop, fh * 0.84, fh * 0.80, 24, alpha, hfChrome([132, 148, 164], [242, 248, 252], 1.7), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, 0, h * 0.06, fh * 0.96, fh * 0.92, 24, alpha, hfChrome([124, 140, 156], [232, 242, 248], 1.8), hfChrome([132, 148, 164], [206, 220, 230], 1.4), 'ty_course_dk');
    // 2) A GIANT ORDER, RENDERED AS CHROME FINS RATHER THAN STONE PILASTERS — the palette's own
    //    words for this building, and until now it had six of them flat against a flat wall. On a
    //    drum they go the whole way round, which is what an order in the round is, and the light
    //    steps off each one as the camera swings. Twelve of them, at the drum's own radius.
    //    ⚠ Solved against the FOOTPRINT rather than against the body's clamped half-width, and
    //    each fin is a narrow drum rather than a box so its own plan is round too.
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.2832 + faceYaw(E), r = fh * 0.84;
      drawFacetDrum(ctx, cam, dx + Math.cos(a) * r, dy + Math.sin(a) * r, h * 0.06, bodyTop, fh * 0.055, fh * 0.050, 8, alpha, hfChrome([116, 132, 148], [246, 250, 252], 2.0), null, 'ty_course_dk');
    }
    // 3) THE ENTABLATURE, a chrome ring over the fins, and a SHALLOW DOME where the pediment was.
    //    ⚠ A dome rather than a ring, because the pediment was carrying the building's whole
    //    "this is an institute" read and a flat cap takes it away: a dome is the other classical
    //    tell and it is the one that is already round.
    drawFacetDrum(ctx, cam, dx, dy, bodyTop, entab, fh * 0.94, fh * 0.90, 24, alpha, hfChrome([120, 136, 152], [222, 234, 242], 1.9), null, 'ty_course_dk');
    drawFacetDrum(ctx, cam, dx, dy, entab, entab + (ped - entab) * 0.55, fh * 0.86, fh * 0.60, 24, alpha, hfChrome([130, 146, 162], [244, 250, 252], 1.7), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, entab + (ped - entab) * 0.55, ped, fh * 0.60, fh * 0.14, 24, alpha, hfChrome([130, 146, 162], [244, 250, 252], 1.7), hfChrome([136, 152, 168], [214, 228, 236], 1.4), pal);
    // …and the FRIEZE PLATE the inscription is cut into, flat across the entrance side of the
    // ring, for the reason the fascia note on `concert_hall` gives.
    // ⚠ THE PLATE STANDS PROUD OF THE DRUM (face at 0.95; the drum's facets reach 0.93 and its rim
    // 0.94). It was set at 0.92, inside the drum, and only a stand-off on the lettering hid that.
    { const [ex, ey] = F(0, fh * 0.83); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.76, bodyTop, entab, 'ty_course_dk', seed + 9, night, alpha, false, faceYaw(E), fh * 0.12); }
    // 4) THE INSCRIPTION, cut into the frieze plate. Paint flags: a chisel is not a tube.
    if (frontVis) {
      const P = (lx10, ly10, z) => { const [wx, wy] = F(lx10, ly10); return cam.proj(wx, wy, z); };
      const z0 = bodyTop + h * 0.012, z1 = entab - h * 0.012, bhw = fh * 0.72, by = fh * 0.95;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'THE HALCYON INSTITUTE', '#efeadb', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      // Twelve green desk lamps in the reading room, switched on before opening whether or not
      // anybody is expected. It is the least light of any lit building on this row.
      const [gx11, gy11] = F(0, fh * 0.30); glowPool(ctx, cam, gx11, gy11, h * 0.44, '198,224,186', 6, alpha * 0.16);
    }
  },
  land_office(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // PLOT TWIST — THE HOARDING IS THE BUILDING. The office is a glazed shed
    // about a storey high; the board bolted to the front of it on a scaffold frame is twice that
    // and three times as wide, and from anywhere on the boulevard the board is the only thing you
    // read. That inversion is the entire silhouette and it is why this passed the "new shape, not
    // a recoloured shopfront" test with a shopfront in it.
    const officeTop = h * 0.40, boardZ0 = h * 0.16, boardZ1 = h * 0.94;
    // 1) THE OFFICE — one glazed drum with a chrome cap, which is about as much building as a
    //    hoarding needs behind it.
    drawFacetDrum(ctx, cam, dx, dy, 0, officeTop, fh * 0.62, fh * 0.58, 16, alpha, hfGlass(night, [56, 86, 112]), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, officeTop, officeTop + h * 0.03, fh * 0.66, fh * 0.62, 16, alpha, hfChrome([116, 132, 148], [230, 240, 248], 1.8), hfChrome([126, 142, 156], [204, 218, 228], 1.4), 'ty_hf_chrome');
    // 2) THE SCAFFOLD — four chrome legs carrying the board, standing clear of the office in
    //    front of it. Drums rather than boxes: at this width the difference is one facet of
    //    highlight travelling round each leg as you drive past, which is the whole tell.
    for (const t of [-0.86, -0.30, 0.30, 0.86]) {
      const [lx12, ly12] = F(t * fh, fh * 0.94);
      drawFacetDrum(ctx, cam, lx12, ly12, 0, boardZ1, fh * 0.035, fh * 0.030, 8, alpha, hfChrome([84, 100, 116], [224, 236, 244], 2.3), null, 'ty_gantry');
    }
    // 3) THE BOARD. Wider than the building and standing a good way proud of it, which is what a
    //    hoarding is: an advertisement with a shed behind it. ⚠ THE ONE FLAT THING LEFT ON THIS
    //    PLOT, and it has to be: the artist's impression below is a planar quad, and a hoarding
    //    bent round a drum is a thing no printer in this city could produce.
    { const [bx13, by13] = F(0, fh * 0.98); draw3DBoxAt(ctx, cam, bx13, by13, fh * 1.00, boardZ0, boardZ1, 'ty_plot_board', seed + 6, night, alpha, true, faceYaw(E), fh * 0.05); }
    // 4) THE ARTIST'S IMPRESSION, painted on the board. The name goes on it large, because that is
    //    what the board is for and the building behind it has no room for a sign at all.
    if (frontVis) {
      const P = (lx14, ly14, z) => { const [wx, wy] = F(lx14, ly14); return cam.proj(wx, wy, z); };
      const z0 = boardZ0 + h * 0.08, z1 = boardZ1 - h * 0.08, bhw = fh * 0.92, by = fh * 1.04;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'HALCYON FIELDS', '#2e4a3c', 0, false, true, true, { sub: 'PLOTS RELEASED' });
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    if (night) {
      // He leaves the office lit. There is a model in the window and he wants it seen, and the
      // board above it is not illuminated at all, which is the one thing he could not get funded.
      const [gx15, gy15] = F(0, fh * 0.56); glowPool(ctx, cam, gx15, gy15, h * 0.22, '255,238,196', 10, alpha * 0.30);
    }
  },
  hydro(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // SECOND WIND — A STEPPED SECTION, WHICH IS A SHAPE COLDWATER HAS NOWHERE ELSE.
    // Every floor is set back from the one below it so that every floor gets a balcony and every
    // balcony faces south. From the front that reads as a stack of decreasing slabs; from the side
    // it reads as a staircase, and the side is what a driver on Kettle Lane actually sees.
    const tiers = [0.00, 0.26, 0.50, 0.72], tops = [0.26, 0.50, 0.72, 0.92];
    // 1) FOUR TIERS, each narrower in DEPTH than the one below, stepping back off the sunny side.
    //    ⚠ The setback is on the entrance face here rather than on a fixed axis, so the balconies
    //    face the street the building was sited to face whichever way its tile is turned.
    for (let i = 0; i < 4; i++) {
      const back = i * fh * 0.13;
      const [tx16, ty16] = F(0, -back);
      draw3DBoxAt(ctx, cam, tx16, ty16, fh * 0.90, h * tiers[i], h * tops[i], pal, seed + i, night, alpha, true, faceYaw(E), fh * (0.78 - i * 0.13));
    }
    // 2) THE RAILS — a lit line along the front edge of each balcony, which is the tell. They are
    //    cleaned more often than they need and read paler than anything else on the building.
    for (let i = 0; i < 4; i++) {
      const front = fh * (0.78 - i * 0.13) - i * fh * 0.13;
      const [rx17, ry17] = F(0, front);
      draw3DBoxAt(ctx, cam, rx17, ry17, fh * 0.90, h * tops[i], h * tops[i] + h * 0.035, 'ty_wind_rail', seed + 20 + i, night, alpha, true, faceYaw(E), fh * 0.03);
    }
    // 2b) THE ROUNDED ENDS. A drum at each end of every tier, so a stepped section that was four
    //    rectangles becomes four lozenges and the building joins the quarter it stands in. Same
    //    move `chrome_slab` makes to bend a wall and `cascade_block` makes to soften a terrace:
    //    it is the cheapest rounding in this renderer and the only one that reads in silhouette.
    // ⚠ `d` IS UNITLESS AND `fh` IS APPLIED ONCE. Written `const d = fh * (0.78 - …)` and then
    //    spent as `fh * (d + 0.04)`, the radius is quadratic in the footprint — which the shape
    //    capture cannot express, because a captured field has to be affine in `[fh, h, 1]`. It
    //    does not throw and it does not look broken in one frame: it solves to a NEGATIVE
    //    constant term, the drums come out about half the size the tiers are, and `shapes:smoke`
    //    reports it as sixteen absolute terms in a model that should have none.
    for (let i = 0; i < 4; i++) {
      const back = i * fh * 0.13, d = 0.78 - i * 0.13;
      for (const t of [-1, 1]) {
        const [qx, qy] = F(t * fh * 0.90, -back);
        drawFacetDrum(ctx, cam, qx, qy, h * tiers[i], h * tops[i] + h * 0.035, fh * (d + 0.04), fh * (d + 0.04), 12, alpha, hfChrome([118, 134, 150], [236, 244, 250], 1.9), hfChrome([126, 142, 158], [206, 220, 230], 1.4), 'ty_wind');
      }
    }
    // 3) THE CANOPY over the door at street level, glass on two rods. Small: this is a door people
    //    arrive at slowly and often on somebody's arm, not a frontage anybody is being sold.
    awning(ctx, cam, dx, dy, E, fh * 0.34, fh * 0.44, h * 0.16, h * 0.20, 'ty_soffit', seed + 30, night, alpha, fh * 0.18);
    if (night) {
      // Balcony lamps under each soffit, kept low so the glass does not become a mirror, plus the
      // day room behind the south glass. Four small warm bands up the face of the building.
      for (let i = 0; i < 4; i++) {
        const front = fh * (0.72 - i * 0.13) - i * fh * 0.13;
        const [gx18, gy18] = F(0, front);
        glowPool(ctx, cam, gx18, gy18, h * tops[i] - h * 0.05, '255,232,196', 6, alpha * 0.17);
      }
    }
  },
  winter_garden(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // GLASS HALF FULL — A BARREL OF GLASS ON A BRICK KNEE-WALL, which is the
    // Terminus glasshouse shape used inside a city for the first time. The difference is the HEAT
    // MAIN: a lagged pipe as thick as a thigh coming up out of the ground on brick piers and going
    // in through the north wall, which is the whole reason this building can exist here and is the
    // one adornment it has.
    const glass = [168, 196, 176];
    const knee = h * 0.20, archH = h * 0.62;
    // 1) THE PLINTH, chrome, low, in PLAIN_WALL so it is seamless panelling and draws no opening.
    //    ⚠ The vault above it was ALWAYS the rounded half of this building — a barrel roof is the
    //    only curved primitive in the renderer older than `drawFacetDrum` — so all the restyle
    //    had to do here was take the masonry out from under it and round the plinth's ends.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, knee, pal, seed, night, alpha, false);
    for (const t of [-1, 1]) { const [qx, qy] = F(0, t * fh * 0.92);
      drawFacetDrum(ctx, cam, qx, qy, 0, knee, fh * 0.86, fh * 0.84, 14, alpha, hfChrome([94, 110, 126], [228, 238, 246], 2.0), hfChrome([104, 120, 136], [200, 214, 224], 1.4), pal); }
    // 2) THE VAULT. Deeper than it is wide, because a glass house is a long thing you walk down.
    drawBarrelRoof(ctx, cam, F, 0, fh * 0.86, fh * 0.92, knee, archH, 12, alpha, glass);
    // 3) THE RIDGE VENT, cracked open along the whole length, which is the detail that says this is
    //    worked rather than decorative. Three boxes along the top is enough to read at range.
    for (const s of [-0.46, 0, 0.46]) {
      const [vx19, vy19] = F(s * fh * 0.7, 0);
      draw3DBoxAt(ctx, cam, vx19, vy19, fh * 0.09, knee + archH * 0.92, knee + archH * 1.02, 'ty_door', seed + 3 + s * 10, night, alpha, false);
    }
    // 4) THE HEAT MAIN — up out of the ground at the back, across two piers, in through the wall.
    //    Lagged, so it is drawn pale rather than as pipework, and it is the thickest single thing
    //    on the plot. ⚠ Its own palette, not the building's: a part in a shade of its host's wall
    //    is invisible, and this one is the point of the building. The piers are chrome now like
    //    everything else, and the pipe is a drum, which is what a pipe is.
    { const [m1x, m1y] = F(-fh * 0.30, -fh * 0.98);
      drawFacetDrum(ctx, cam, m1x, m1y, 0, knee * 1.4, fh * 0.09, fh * 0.09, 10, alpha, hfChrome([132, 148, 162], [246, 250, 252], 1.8), hfChrome([138, 154, 168], [216, 228, 236], 1.3), 'ty_wind_rail'); }
    { const [m2x, m2y] = F(-fh * 0.30, -fh * 0.60); draw3DBoxAt(ctx, cam, m2x, m2y, fh * 0.09, knee * 1.1, knee * 1.4, 'ty_wind_rail', seed + 13, night, alpha, true, faceYaw(E), fh * 0.40); }
    if (night) {
      // ⚠ NOT grow-lamps. Terminus lights its glasshouses from inside and that is a creed; this one
      // has no lamps at all and what you see after dark is the heat: the vault holds a dull warmth
      // that the cold glass all round it does not, and the far end where the pipe comes in is the
      // warmest. One pool, low, at the north end, and nothing anywhere else on the plot.
      const [gx20, gy20] = F(-fh * 0.30, -fh * 0.40); glowPool(ctx, cam, gx20, gy20, knee + archH * 0.30, '160,220,176', 9, alpha * 0.18);
    }
  },
  pumping_station(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // MAINS ATTRACTION — A CAMPANILE ON A WATERWORKS. Everything else in
    // the plant half is a shed with machinery in it; this is the one building down here that was
    // built by people who were proud of what it did, so it has two orders of arched openings, a
    // terracotta course under the eaves and a chimney standing off the end like a bell tower.
    const hallTop = h * 0.74, eaves = h * 0.82, stack = h * 1.36;
    // 1) THE ENGINE HALL — one tall glazed drum, PLAIN_WALL chrome below a band of glass, and
    //    the pride is still in it: this is the only plant building in the quarter whose main
    //    volume is something you can see into.
    drawFacetDrum(ctx, cam, dx, dy, 0, hallTop * 0.54, fh * 0.80, fh * 0.78, 18, alpha, hfChrome([110, 126, 142], [220, 232, 240], 1.9), null, pal);
    drawFacetDrum(ctx, cam, dx, dy, hallTop * 0.54, hallTop, fh * 0.78, fh * 0.76, 18, alpha, hfGlass(night, [46, 76, 100]), null, 'ty_mains_engine');
    // 2) THE COURSE under the eaves and a shallow cap over it — a chrome ring where a terracotta
    //    band used to be. It is the one part of this building that is purely ornament and it is
    //    what makes the silhouette read.
    drawFacetDrum(ctx, cam, dx, dy, hallTop, eaves, fh * 0.84, fh * 0.80, 18, alpha, hfChrome([126, 142, 156], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [210, 224, 232], 1.4), 'ty_mains_terra');
    // 3) THE STACK, standing off the north end clear of the hall so it reads as its own thing
    //    rather than as a chimney coming out of a roof. It is the tallest mass on the plot, and
    //    it is round now, which is what a flue is and what a campanile in this quarter would be.
    { const [cx, cy] = F(fh * 0.66, -fh * 0.62);
      drawFacetDrum(ctx, cam, cx, cy, 0, stack, fh * 0.16, fh * 0.13, 12, alpha, hfChrome([102, 118, 134], [228, 238, 246], 2.0), null, pal); }
    { const [cx2, cy2] = F(fh * 0.66, -fh * 0.62);
      drawFacetDrum(ctx, cam, cx2, cy2, stack, stack + h * 0.05, fh * 0.19, fh * 0.17, 12, alpha, hfChrome([126, 142, 156], [242, 248, 252], 1.7), hfChrome([132, 148, 162], [210, 224, 232], 1.4), 'ty_mains_terra'); }
    // 4) THE DOORS on the entrance face, tall and round-headed, standing open in working hours.
    //    Drawn as one deep opening rather than as a grid: this wall has three holes in it.
    { const [ax, ay] = F(0, fh * 0.78); draw3DBoxAt(ctx, cam, ax, ay, fh * 0.22, 0, h * 0.40, 'ty_mains_engine', seed + 4, night, alpha, false, faceYaw(E), fh * 0.04); }
    if (night) {
      // The hall, lit from inside through the glazed band, and warm rather than white: the lamps
      // in there are old and the engine is maroon. ⚠ IT KEPT ITS WARM LIGHT through the restyle,
      // for `concert_hall`'s reason — the plant was commissioned by people who were proud of it
      // and lights itself the way they left it. Nothing on this building lights the road.
      const [gx, gy] = F(0, fh * 0.70); glowPool(ctx, cam, gx, gy, h * 0.46, '255,206,138', 9, alpha * 0.24);
    }
  },
  cooling_plant(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // COLD COMFORT — EIGHT FANS ON A LATTICE DECK, and the deck is the whole
    // building. The slab underneath is deliberately featureless because a cooling plant is a box
    // you are not meant to look at with the interesting part bolted to the roof.
    const slabTop = h * 0.62, deckTop = h * 0.74;
    // 1) THE BLOCK. Chrome panelling, no opening in the lower two thirds, which is what it is —
    //    but with the corners taken off it, because a cooling plant built to the same standard
    //    as the money gets the same corners as the money.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, slabTop, pal, seed, night, alpha, true);
    for (const t of [-1, 1]) { const [qx, qy] = F(t * fh * 0.78, 0);
      drawFacetDrum(ctx, cam, qx, qy, 0, slabTop, fh * 0.92, fh * 0.90, 14, alpha, hfChrome([100, 116, 132], [222, 234, 242], 2.0), hfChrome([110, 126, 142], [196, 210, 220], 1.4), pal); }
    // 2) THE DECK the fans stand on, set in a little so the block below throws a shadow.
    { const [kx, ky] = F(0, 0); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.86, slabTop, deckTop, 'ty_gantry', seed + 1, night, alpha, false); }
    // 3) FOUR COWLS along the deck, which reads as eight at any distance you would ever see it
    //    from. ⚠ THEY ARE DRUMS NOW AND ALWAYS SHOULD HAVE BEEN: an axial fan cowl is a circle,
    //    and the only reason these were boxes is that the arm was written before this quarter had
    //    a rounded vocabulary. Each takes its own position, because the whole tell of this
    //    building is that the fans are separate things.
    for (let i = 0; i < 4; i++) {
      const t = -0.60 + i * 0.40;
      const [fx, fy] = F(t * fh, 0);
      drawFacetDrum(ctx, cam, fx, fy, deckTop, deckTop + h * 0.12, fh * 0.17, fh * 0.20, 14, alpha, hfChrome([122, 138, 152], [238, 246, 250], 1.8), hfChrome([130, 146, 160], [204, 218, 228], 1.3), 'ty_cold_cowl');
    }
    // 4) THE HEAT MAIN leaving the north-west corner at head height on brick piers, which is the
    //    other half of the arrangement Glass Half Full is warm because of. Same palette both ends.
    { const [mx, my] = F(-fh * 0.72, -fh * 0.40); draw3DBoxAt(ctx, cam, mx, my, fh * 0.09, h * 0.16, h * 0.24, 'ty_wind_rail', seed + 8, night, alpha, true, faceYaw(E), fh * 0.60); }
    if (night) {
      // Two floods on the deck handrail, pointed DOWN at the catwalk rather than out, because a
      // light pointed north from up there would be seen from the Spire and she knows it.
      const [gx, gy] = F(0, 0); glowPool(ctx, cam, gx, gy, deckTop + h * 0.06, '206,226,230', 7, alpha * 0.20);
    }
  },
  gasholder(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // HOLDING PATTERN — THE ONLY BUILDING IN COLDWATER THAT CHANGES HEIGHT, and
    // the drum is drawn two thirds up because that is where the city usually holds it. A lattice
    // guide frame, a steel drum inside it, and a gauge house at the foot that the frame dwarfs.
    const frameTop = h * 1.18, drumTop = h * 0.78, gaugeTop = h * 0.16;
    // 1) THE GUIDE FRAME — a tall open CYLINDER of standards, which is what a guide frame is and
    //    what it has never been drawn as. ⚠ THIS BUILDING WAS ALREADY THE ROUND ONE and the arm
    //    was drawing it square: everything anybody knows about a gasholder is that it is a circle,
    //    and a box round a box was the single worst mismatch between name and shape in the
    //    registry. `ty_holder` is PLAIN_WALL chrome, so the frame reads as structure.
    drawFacetDrum(ctx, cam, dx, dy, 0, frameTop, fh * 0.86, fh * 0.84, 16, alpha, hfChrome([84, 100, 116], [200, 214, 226], 2.2), null, pal);
    // 2) THE HOLDER, inside the frame and narrower than it, riding at two thirds. Its top is a
    //    lid, which is the one surface of this building anybody ever looks down on.
    drawFacetDrum(ctx, cam, dx, dy, 0, drumTop, fh * 0.74, fh * 0.72, 16, alpha, hfChrome([118, 134, 148], [232, 242, 248], 1.9), hfChrome([126, 142, 156], [200, 214, 224], 1.4), 'ty_holder_drum');
    // 3) THE GAUGE HOUSE at the foot, small and chrome, pushed out to the entrance side so the
    //    door is on the street rather than inside the frame.
    { const [gx2, gy2] = F(0, fh * 0.92);
      drawFacetDrum(ctx, cam, gx2, gy2, 0, gaugeTop, fh * 0.26, fh * 0.24, 14, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [198, 212, 222], 1.4), 'ty_engine_brick'); }
    if (night) {
      // ⚠ ONE RED OBSTRUCTION LIGHT ON THE CROWN AND NOTHING ELSE ANYWHERE ON THE PLOT. There is
      // no lit sign, no yard flood and no window glow: this is a hundred-year-old steel can full
      // of gas and the one thing anybody has ever agreed to put on it is a warning to aircraft.
      blinkLight(ctx, cam, dx, dy, frameTop, '255,122,90', now, seed, alpha, 1.0);
      const [lx, ly] = F(0, fh * 0.92); glowPool(ctx, cam, lx, ly, gaugeTop * 0.7, '255,214,150', 4, alpha * 0.14);
    }
  },
  substation(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // CURRENT AFFAIRS — A YARD, NOT A BUILDING. The only enclosed thing on the
    // plot is a single-storey switch room in one corner; everything else is tanks standing in the
    // open behind a palisade under a lattice gantry, which is a silhouette nothing else here has.
    const tankTop = h * 0.46, gantry = h * 0.92, roomTop = h * 0.34;
    // 1) THE PALISADE, low, LATTICE_WALL so it reads as a fence rather than as a wall.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, h * 0.16, 'ty_current_fence', seed, night, alpha, false);
    // 2) THREE TRANSFORMER TANKS in a row inside it, drawn as drums so they read as three round
    //    objects. ⚠ SAME CORRECTION AS THE FAN COWLS: a transformer tank is a cylinder, and it
    //    was a box only because the arm predates this quarter having a rounded vocabulary.
    for (let i = 0; i < 3; i++) {
      const t = -0.46 + i * 0.46;
      const [tx2, ty3] = F(t * fh, -fh * 0.20);
      drawFacetDrum(ctx, cam, tx2, ty3, 0, tankTop, fh * 0.17, fh * 0.16, 12, alpha, hfChrome([98, 114, 130], [218, 230, 240], 2.0), hfChrome([108, 124, 140], [194, 208, 218], 1.4), pal);
    }
    // 3) THE GANTRY carrying the busbars in, dead straight, above the tanks. Two legs and a beam.
    for (const t of [-0.74, 0.74]) {
      const [lx2, ly2] = F(t * fh, -fh * 0.20);
      draw3DBoxAt(ctx, cam, lx2, ly2, fh * 0.05, 0, gantry, 'ty_gantry', seed + 6 + t * 10, night, alpha, false);
    }
    { const [bx, by] = F(0, -fh * 0.20); draw3DBoxAt(ctx, cam, bx, by, fh * 0.80, gantry, gantry + h * 0.05, 'ty_gantry', seed + 9, night, alpha, false); }
    // 4) THE SWITCH ROOM in the corner nearest the street, chrome, low, with the only door. It
    //    is finished like a bank because the Spire cannot afford for it to fail, which is the
    //    quarter's own joke about its plant and the reason this yard is not works green.
    { const [rx2, ry2] = F(fh * 0.56, fh * 0.70);
      drawFacetDrum(ctx, cam, rx2, ry2, 0, roomTop, fh * 0.30, fh * 0.28, 14, alpha, hfChrome([112, 128, 144], [226, 238, 246], 1.8), hfChrome([122, 138, 152], [198, 212, 222], 1.4), 'ty_engine_brick'); }
    if (night) {
      // A yard flood on the gantry leg and the switch room's own window. Nothing warm: this is the
      // one plot in the quarter lit entirely in sodium, because nobody is meant to linger on it.
      const [gx3, gy3] = F(-fh * 0.74, -fh * 0.20); glowPool(ctx, cam, gx3, gy3, gantry * 0.8, '255,210,74', 8, alpha * 0.26);
    }
  },
  exchange(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // CROSSED WIRES — A BLANK SLAB WITH A LOUVRE BAND AT THE TOP, and the absence
    // of any opening at all in the first four storeys is the entire building. Every other tall
    // thing in Coldwater carries a window grid; this one carries brick, and it hums.
    const blank = h * 0.84, louvre = h * 0.98, parapet = h * 1.04;
    // 1) THE SHAFT. Four storeys of unbroken glass with nothing behind it lit — `ty_wires` is in
    //    GLASS_WALL, so it takes the floor-plate striping and the sky sheen and never punches an
    //    opening. ⚠ THE ARGUMENT SURVIVES THE MATERIAL EXACTLY. It was "every other tall thing
    //    here carries a window grid and this one carries brick"; it is now "every other tall
    //    thing here has somebody in it and this one has nothing you can see", which is the same
    //    sentence about a building full of switching gear and no people.
    drawFacetDrum(ctx, cam, dx, dy, 0, blank, fh * 0.88, fh * 0.86, 18, alpha, hfGlass(night, [46, 68, 90]), null, pal);
    // 2) THE LOUVRE BAND round the whole of the fifth, METAL_WALL, set very slightly proud so it
    //    catches a different value from the glass and reads as the one thing on the elevation.
    drawFacetDrum(ctx, cam, dx, dy, blank, louvre, fh * 0.90, fh * 0.90, 18, alpha, hfChrome([104, 118, 130], [206, 220, 230], 2.0), null, 'ty_wires_louvre');
    drawFacetDrum(ctx, cam, dx, dy, louvre, parapet, fh * 0.92, fh * 0.88, 18, alpha, hfChrome([112, 128, 142], [226, 238, 246], 1.8), hfChrome([120, 136, 150], [198, 212, 222], 1.4), 'ty_hf_chrome');
    // 3) THE DOOR. One, flush, steel, no handle, and drawn narrow because that is what it is.
    { const [dx2, dy2] = F(0, fh * 0.88); draw3DBoxAt(ctx, cam, dx2, dy2, fh * 0.07, 0, h * 0.20, 'ty_wires_louvre', seed + 3, night, alpha, false, faceYaw(E), fh * 0.02); }
    // 4) THE NUMBER beside the door at waist height. ⚠ Not a name: this building has no name on it
    //    anywhere, and the six-figure number is the only marking it carries. Paint flags, and the
    //    quad is small on purpose — it is a stencil at waist height, not signage.
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
      // ⚠ THE LOUVRE BAND IS THE ONLY LIT THING, and it is lit from INSIDE rather than washed from
      // outside — a pale cold line across the top of a building that is otherwise completely dark.
      // No door lamp: the one way in has no light over it at all and that is deliberate.
      const [gx4, gy4] = F(0, 0); glowPool(ctx, cam, gx4, gy4, (blank + louvre) * 0.5, '143,180,200', 6, alpha * 0.18);
    }
  },
  fire_station(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // ENGINE TROUBLE — THREE DOORS AND A TOWER. The hose tower is the tell: a
    // square louvred shaft going up well past the roof with a hoist beam at the top, because wet
    // hose has to hang somewhere and the only direction available is up.
    const bayTop = h * 0.44, blockTop = h * 0.86, towerTop = h * 1.44;
    // 1) THE BLOCK — chrome above, with the bay at ground level, and a drum at each end so the
    //    plan is a lozenge rather than a rectangle. One mass; the doors are drawn on.
    //
    // ⚠ THE RED STAYS, AND THAT IS NOT THE RESTYLE BEING SELECTIVE. "Glass and chrome" is an
    // argument about form and material; `ty_engine` is neither — it is appliance red on three
    // doors, and the palette block's own note says why it may never go: in a quarter of cyan and
    // pearl the one red thing on the skyline is the thing you look for when something is burning.
    // A modern fire station is chrome with red doors. That is exactly what this now is.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.76, 0, blockTop, pal, seed, night, alpha, true);
    for (const t of [-1, 1]) { const [qx, qy] = F(t * fh * 0.76, 0);
      drawFacetDrum(ctx, cam, qx, qy, 0, blockTop, fh * 0.90, fh * 0.88, 14, alpha, hfChrome([104, 120, 136], [224, 236, 244], 2.0), hfChrome([114, 130, 146], [198, 212, 222], 1.4), pal); }
    // 2) THREE BAY DOORS in appliance red across the entrance face, each on its own seed so they
    //    read as three doors and not as one red band with lines in it.
    for (let i = 0; i < 3; i++) {
      const t = -0.50 + i * 0.50;
      const [bx2, by2] = F(t * fh, fh * 0.92);
      draw3DBoxAt(ctx, cam, bx2, by2, fh * 0.21, h * 0.02, bayTop, 'ty_engine', seed + 2 + i, night, alpha, false, faceYaw(E), fh * 0.03);
    }
    // 3) THE HOSE TOWER, off the north end, going up past everything. Louvred, so it takes the
    //    metal palette rather than the block's chrome and reads as a shaft rather than a flue —
    //    and round, because the one thing this quarter does not need is a second square tower.
    { const [tx3, ty4] = F(-fh * 0.70, -fh * 0.46);
      drawFacetDrum(ctx, cam, tx3, ty4, 0, towerTop, fh * 0.18, fh * 0.155, 12, alpha, hfChrome([96, 110, 124], [210, 224, 234], 2.1), hfChrome([106, 120, 134], [188, 202, 214], 1.4), 'ty_wires_louvre'); }
    { const [hx, hy] = F(-fh * 0.70, -fh * 0.18); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.05, towerTop - h * 0.06, towerTop - h * 0.02, 'ty_gantry', seed + 7, night, alpha, false, faceYaw(E), fh * 0.28); }
    // 4) THE APRON, swept down to bare concrete in front of the doors, which is the one piece of
    //    ground in this quarter that is kept clean on purpose and reads as such from the air.
    { const [ax2, ay2] = F(0, fh * 1.16); draw3DBoxAt(ctx, cam, ax2, ay2, fh * 0.88, 0, h * 0.008, 'ty_cold_slab', seed + 9, night, alpha, true, faceYaw(E), fh * 0.24); }
    if (night) {
      // The bay, lit all night behind the glazed tops of the doors, because a watch is a watch.
      // Plus the red over the middle door, which is a call light rather than a sign.
      const [gx5, gy5] = F(0, fh * 0.98); glowPool(ctx, cam, gx5, gy5, h * 0.30, '255,228,190', 11, alpha * 0.30);
      blinkLight(ctx, cam, dx, dy, bayTop + h * 0.06, '255,90,74', now, seed, alpha, 0.7);
    }
  },
  incinerator(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // ASH MANAGEMENT — THE TALLEST CHIMNEY IN COLDWATER, standing off the back
    // of a brick hall with a road ramp up one flank. The ramp is the part that says what this is:
    // no other building in the city has a road going into its first floor.
    const hallTop = h * 0.66, rampTop = h * 0.30, stack = h * 1.86;
    // 1) THE TIPPING HALL — brick, tall, blind. The only holes in it are the ramp and the door.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, 0, hallTop, pal, seed, night, alpha, true);
    // 2) THE RAMP up one flank to the tipping floor, drawn as a wedge of two boxes, because a
    //    lorry has to get to first-floor level and this is how it does it.
    { const [r1x, r1y] = F(fh * 0.74, fh * 0.30); draw3DBoxAt(ctx, cam, r1x, r1y, fh * 0.20, 0, rampTop * 0.5, 'ty_ash_stack', seed + 1, night, alpha, true, faceYaw(E), fh * 0.44); }
    { const [r2x, r2y] = F(fh * 0.74, -fh * 0.22); draw3DBoxAt(ctx, cam, r2x, r2y, fh * 0.20, 0, rampTop, 'ty_ash_stack', seed + 2, night, alpha, true, faceYaw(E), fh * 0.30); }
    // 3) THE STACK. Off the back of the hall, square at the base and stepping in twice, and it is
    //    the tallest mass in the whole registry outside the Ascendant campus. ⚠ Its own palette:
    //    a stack washed by its own plume is paler than the hall it stands on, permanently.
    { const [s1x, s1y] = F(-fh * 0.50, -fh * 0.70); draw3DBoxAt(ctx, cam, s1x, s1y, fh * 0.22, 0, h * 0.40, 'ty_ash_stack', seed + 3, night, alpha, false); }
    { const [s2x, s2y] = F(-fh * 0.50, -fh * 0.70); draw3DBoxAt(ctx, cam, s2x, s2y, fh * 0.16, h * 0.40, stack, 'ty_ash_stack', seed + 4, night, alpha, false); }
    // 4) THE GATE PLATE, works lettering on green, at the foot of the ramp. Paint, never lit: this
    //    is a municipal notice board and the only marking on the plot.
    if (frontVis) {
      const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
      const z0 = h * 0.16, z1 = h * 0.26, bhw = fh * 0.42, by = fh * 0.86;
      const TL = P(-bhw, by, z1), TR = P(bhw, by, z1), BR = P(bhw, by, z0), BL = P(-bhw, by, z0);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const tex = bakeSignText(sign || 'ASH MANAGEMENT', '#c8d0b4', 0, false, true, true);
        if (tex) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
    }
    // 5) Plume plant on the hall roof — the induced-draught fans and the grit arrester.
    roofClutter(ctx, cam, dx, dy, fh * 0.82, hallTop, 'industrial', seed + 6, night, alpha, now);
    if (night) {
      // ⚠ ONE AVIATION LIGHT AND ONE LAMP OVER THE WEIGHBRIDGE. The hall itself is not lit from
      // outside at all — the only glow on this plot is the charging door, which is orange, low,
      // and comes from inside the building rather than from anything anybody switched on.
      blinkLight(ctx, cam, dx, dy, stack, '255,138,74', now, seed, alpha, 1.3);
      const [gx, gy] = F(fh * 0.74, fh * 0.40); glowPool(ctx, cam, gx, gy, rampTop, '255,224,168', 6, alpha * 0.20);
      const [cx, cy] = F(0, fh * 0.20); glowPool(ctx, cam, cx, cy, h * 0.12, '255,150,70', 5, alpha * 0.22);
    }
  },
  water_tower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // HIGH WATER MARK — FOUR LEGS AND A TANK, and almost all of the silhouette
    // is the air between them. Nothing else in Coldwater is mostly gap: every other tall thing here
    // is a solid, and this one you can see the sky through up to the skirt.
    const legTop = h * 0.92, tankTop = h * 1.26, dome = h * 1.36, houseTop = h * 0.22;
    // 1) FOUR LEGS on pads, cross-braced. Drawn as four narrow boxes rather than as one open box,
    //    because the whole read is that you can see between them.
    for (const [sx, sy] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]]) {
      const [lx, ly] = F(sx * fh, sy * fh);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.055, 0, legTop, pal, seed + 2 + sx * 7 + sy * 3, night, alpha, false);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.09, 0, h * 0.04, 'ty_hwm_pad', seed + 20 + sx * 7 + sy * 3, night, alpha, true);
    }
    // 2) THE TANK, riveted plate, wider than the legs stand, with a walkway skirt under it and a
    //    domed top. The skirt overhangs, which is what stops it reading as a box on sticks.
    { const [kx, ky] = F(0, 0); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.62, legTop, legTop + h * 0.04, 'ty_gantry', seed + 8, night, alpha, false); }
    { const [tx, ty2] = F(0, 0); draw3DBoxAt(ctx, cam, tx, ty2, fh * 0.56, legTop + h * 0.04, tankTop, pal, seed + 9, night, alpha, false); }
    { const [dx3, dy3] = F(0, 0); draw3DBoxAt(ctx, cam, dx3, dy3, fh * 0.44, tankTop, dome, pal, seed + 10, night, alpha, true); }
    // 3) THE PUMP HOUSE at the foot, brick, one door, pushed to the entrance side.
    { const [px, py] = F(0, fh * 0.76); draw3DBoxAt(ctx, cam, px, py, fh * 0.28, 0, houseTop, 'ty_engine_brick', seed + 12, night, alpha, true, faceYaw(E), fh * 0.22); }
    // 4) COLDWATER, on the tank, in letters that were white and are now the colour of the tank.
    //    Paint flags, and it is deliberately LOW CONTRAST — the ink is barely off the plate.
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
      // One aviation light on the dome, and the bulkhead by the hatch, which is on a switch inside
      // the leg — so it is lit only when she is actually up there, which is most mornings.
      blinkLight(ctx, cam, dx, dy, dome, '159,210,224', now, seed, alpha, 1.6);
      const [gx2, gy2] = F(0, fh * 0.76); glowPool(ctx, cam, gx2, gy2, houseTop * 0.8, '255,226,176', 5, alpha * 0.18);
    }
  },
};
