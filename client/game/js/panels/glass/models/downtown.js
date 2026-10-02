// Downtown Coldwater: building-model arms for the city core, the airfield and Marrow Street.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  DECO_LIFT, DECO_PULL, DETAIL_LIFT, FACE_EPS, FLAT_OFF, GL_CELLS, MESH_SINK, SHAPE_SINK,
  TILE_REACH, TR, TUNE, WALL_COL, _bladeBasis, awning, bakeSignText, blinkLight, clamp,
  clipToAperture, decoHidden, dish, doorReveal, draw3DBoxAt, drawBarrelRoof, drawFacetDrum,
  drawGargoyle, drawRing, drawSmoke, dutyPhase, emitDecoFill, emitFace, emitFlat, emitLightRunner,
  emitRecessBay, emitSurfaceText, emitWire, facePals, facePt, faceYaw, frac, glowPool, helideck,
  hoistLine, keptOnCanvas, latticeTower, markHidden, marqueeBand, mast, motionOn, motionPhase,
  moveSeg, movingBox, mullions, neonBlade, reserveSignBand, rgb, roofClutter, roofCross, shadeOf,
  slideToPlane, wallBadge, wallDisc, wallRose,
} from '../../windshield.js';

export const DOWNTOWN_ARMS = {
  bank(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Citadel Financial — a windowless marble strongbox pretending to be a temple.
    // Deliberately the archive's austere cousin: same civic vocabulary (stylobate, colonnade,
    // entablature) with every window taken out, because the whole building is one wall. Four
    // columns, a bronze entrance band under the portico, a blank attic block, and a floodlit
    // frontage at night — no neon, nothing that could be switched off.
    const stone = pal, colPal = 'ty_marble_col', bronze = 'ty_marble_bronze';
    const plinth = h * 0.16, colTop = h * 0.88, entTop = h * 1.04, atticTop = h * 1.22;
    // 1) Two broad stone steps up off the deck.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.34, 0, h * 0.08, stone, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.20, h * 0.08, plinth, stone, seed + 1, night, alpha, true);
    // 2) The strongbox itself — one solid windowless mass. This is the whole point of the model.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, plinth, colTop, stone, seed + 2, night, alpha, false);
    // 3) Four fluted columns standing proud of it on the entrance side.
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = F((-0.9 + i * 0.6) * fh * 0.98, fh * 1.10);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.11, plinth, colTop, colPal, seed + 10 + i, night, alpha, false);
    }
    // 4) Heavy entablature over the colonnade, and the blank attic block above it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, colTop, entTop, stone, seed + 3, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, entTop, atticTop, stone, seed + 4, night, alpha, true);
    // 5) The bronze doors — a dark band recessed under the portico, front face only.
    if (frontVis) {
      const [bx, by] = F(0, fh * 0.96);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.30, plinth, plinth + h * 0.30, bronze, seed + 5, night, alpha, false);
      // Floodlights wash the columns from the step line up — the frontage is never dark.
      glowPool(ctx, cam, bx, by, plinth + h * 0.06, '236,226,200', 11, alpha * (night ? 0.75 : 0.3));
    }
    // 6) Rooftop plant and one steady red obstruction light. No beacon theatrics.
    // ⚠ THE ONLY BUILDING IN THE CITY WITH NO TOP. Every box here was drawn `roof: false`, which is
    // right for a face you can never see and wrong for five of them: a flight sim looks DOWN at a
    // building, and this one came back as a stone box you could see straight into from the air. The
    // five capped here are the ones whose tops are exposed — the two step rings, the entablature,
    // the attic and the crown. The main mass and the columns keep theirs, because the entablature
    // is wider than both and covers them.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.30, atticTop, atticTop + h * 0.10, colPal, seed + 6, night, alpha, true);
    blinkLight(ctx, cam, dx, dy, atticTop + h * 0.14, '255,90,80', now, seed, alpha, 1);
  },
  archive(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Hall of Records — the oldest thing on the skyline: a weathered stone
    // civic temple. A stepped stylobate lifts a six-column portico under a heavy entablature and
    // a classical pediment; behind it a drum of clerestory windows carries a verdigris copper
    // dome, a stone lantern and one lonely amber beacon. No neon — it predates all that. At
    // night it's floodlit from below like a monument nobody funds and nobody dares raze.
    const stone = pal, colPal = 'ty_archive_col';
    const plinth = h * 0.22, colTop = h * 1.02, entTop = h * 1.20;
    // 1) Stepped stone plinth (stylobate) — three broad shrinking steps up off the deck.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.42, 0,        h * 0.07, stone, seed,     night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.30, h * 0.07, h * 0.14, stone, seed + 1, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, h * 0.14, plinth,   stone, seed + 2, night, alpha, true);
    // 2) The cella — the solid records block behind the columns, warm windows lit.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, plinth, colTop, stone, seed + 3, night, alpha, true);
    // 3) Front colonnade — six columns standing proud of the cella on the entrance side.
    for (let i = 0; i < 6; i++) {
      const [cx, cy] = F((-1 + i * 0.4) * fh * 0.98, fh * 1.12);
      draw3DBoxAt(ctx, cam, cx, cy, fh * 0.10, plinth, colTop, colPal, seed + 10 + i, night, alpha, false);
    }
    // 4) Heavy entablature capping the columns and cella.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, colTop, entTop, stone, seed + 4, night, alpha, false);
    // 5) Classical pediment — a stone gable triangle over the portico (front face only) + the
    //    great warm rose-window/clock set into it.
    if (frontVis) {
      const [lx, ly] = F(-fh * 1.02, fh * 1.02), [rx, ry] = F(fh * 1.02, fh * 1.02), [ax, ay] = F(0, fh * 1.02);
      const a = cam.proj(lx, ly, entTop), b = cam.proj(rx, ry, entTop), c = cam.proj(ax, ay, entTop + h * 0.17);
      if (a.f > 0.1 && b.f > 0.1 && c.f > 0.1) {
        ctx.globalAlpha = alpha; ctx.fillStyle = night ? 'rgb(70,66,58)' : 'rgb(150,142,124)';
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      const [wx, wy] = F(0, fh * 1.06); glowPool(ctx, cam, wx, wy, entTop + h * 0.02, '255,206,140', 9, alpha * (night ? 0.6 : 0.4));
    }
    // 6) The drum — a round tower of clerestory windows rising behind the pediment.
    const drum1 = entTop + h * 0.5;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.60, entTop, drum1, stone, seed + 5, night, alpha, true);
    // 7) The verdigris copper dome — smooth stacked discs following a hemisphere profile.
    const domeH = h * 0.46, domeR = fh * 0.60, apex = drum1 + domeH;
    // Revolved by hand rather than through a mass primitive, so it records itself: without this the
    // dome is a hole in the captured envelope and the stone lantern above it stands on nothing in
    // any consumer drawing the silhouette. A tapered drum is what a hemisphere is, to a wireframe.
    if (SHAPE_SINK) SHAPE_SINK.push({ kind: 'drum', dx, dy, wz0: drum1, wz1: apex, rb: domeR, rt: domeR * 0.08, n: 12, cap: false, pal: 'ty_verdigris' });
    // ⚠ A DOME IS A SURFACE, NOT A STACK OF PLATES — the same fix the Meridian's cupola got, for
    // the same reason and with the same shape. This was eight flat horizontal discs at eight
    // heights with nothing between them, so from below the crown you looked straight between the
    // layers and the dome read as floating rings.
    //
    // ⚠ AND IT WAS A HOLE IN GLASS 2 ENTIRELY. Those discs went out on a raw `emitFace` and never
    // touched a mass primitive, so the mesh had NOTHING above the drum: measured, 0 mesh faces in
    // the whole 1.72→2.16 span, which on the GPU is a Hall of Records with its lantern and beacon
    // standing on open air. Bands through `drawFacetDrum` reach the mesh the way every other solid
    // does, and carry their own colour there — see `drumSkin`.
    //
    // ⚠ AND IT MUST NOT RUN UNDER A CAPTURE, or eight bands record eight drums on top of the one
    // pushed above. The push is the capture; these are the paint, and they are alternatives.
    if (!SHAPE_SINK) {
      const CU = WALL_COL.ty_verdigris;
      const BANDS = 7;
      const rAt = (t) => domeR * Math.sqrt(Math.max(0, 1 - t * t));
      for (let i = 0; i < BANDS; i++) {
        const t0 = i / BANDS, t1 = (i + 1) / BANDS;
        const sh = 0.72 + 0.28 * t0;   // the old vertical gradient, lighter toward the apex
        const style = (f) => { const k = sh * (0.82 + (f.nl || 0) * 0.36);
          return `rgb(${Math.round(CU[0] * k)},${Math.round(CU[1] * k)},${Math.round(CU[2] * k)})`; };
        drawFacetDrum(ctx, cam, dx, dy, drum1 + domeH * t0, drum1 + domeH * t1, rAt(t0), rAt(t1), 20, alpha, style, null, 'ty_verdigris');
      }
    }
    // 8) Stone lantern + finial, and one amber aviation beacon on the very crown.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.12, apex, apex + h * 0.14, colPal, seed + 6, night, alpha, false);
    blinkLight(ctx, cam, dx, dy, apex + h * 0.18, '255,196,120', now, seed, alpha, 2);
    // 9) Night: floodlit columns from below + warm spill from the tall windows and the drum.
    if (night) {
      glowPool(ctx, cam, dx, dy, plinth + h * 0.04, '255,196,120', 24, alpha * 0.30);
      glowPool(ctx, cam, dx, dy, entTop + h * 0.2, '255,210,150', 14, alpha * 0.18);
    }
  },
  office(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE OFFICE BLOCK — `office` and `corporate_office`, 8 tiles. It was a
    //                  wedding cake: three setbacks of the same palette, each 74% of the last,
    //                  and a mast. Symmetrical, monotone and the same building from every angle.
    //
    //                  A corporate tower's actual signature is the SERVICE CORE standing past the
    //                  glass — the windowless slab holding the lifts and the risers, which is the
    //                  one part of an office block that is never glazed. Giving it that means the
    //                  silhouette is asymmetric, the core can take the second palette, and the
    //                  setbacks stop reading as a stack of hat boxes.
    const glass = pal, core = 'ty_precast_dk', band = 'ty_precast';
    const H = h * 1.7, pz = h * 0.2;
    // 1) A podium the tower rises out of, wider than anything above it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, 0, pz, band, seed + 6, night, alpha, false);
    // 2) Two setbacks rather than three, so each one is tall enough to read as a shaft. The
    //    shoulder is off-centre — pushed back off the street — which is what turns a symmetrical
    //    stack into a building with a front.
    const sh = pz + (H - pz) * 0.58;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, pz, sh, glass, seed, night, alpha, false);
    { const [ux, uy] = F(0, -fh * 0.16);
      draw3DBoxAt(ctx, cam, ux, uy, fh * 0.78, sh, H, glass, seed + 1, night, alpha, true); }
    // 3) THE CORE. A narrow windowless slab up one flank, carried a storey past the top of the
    //    glass — where the lift overrun and the tank room actually are.
    { const [kx, ky] = F(fh * 0.82, -fh * 0.16);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.26, pz, H + h * 0.16, core, seed + 2, night, alpha, true, 0, fh * 0.5); }
    // 4) A spandrel band at each setback, in the pale panel: the horizontal that says storeys.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.09, sh - h * 0.05, sh, band, seed + 3, night, alpha, false);
    mast(ctx, cam, dx, dy, H, H + h * 0.5, alpha, now, seed);
    // The lobby. An office at night is a dark shaft with a lit box at the bottom of it, and that
    // contrast is most of what makes a corporate tower read as one from the street.
    if (frontVis) { const [lx3, ly3] = F(0, fh * 1.14);
      glowPool(ctx, cam, lx3, ly3, pz * 0.55, '190,215,255', 16, alpha * (night ? 0.7 : 0.24)); }
  },
  hotel(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // podium + tall guest slab + entrance marquee + vertical neon blade
    const neon = m.neon || '#ff4a9a';
    const stone2 = 'ty_precast', base2 = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, h * 0.24, stone2, seed + 4, night, alpha, false);    // lit ground-floor podium
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, h * 0.24, h * 1.28, pal, seed, night, alpha, false);    // guest tower
    // A cornice and a set-back roof storey — the top of a hotel is where the bar is, and a slab
    // that simply stops has no top at all.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, h * 1.28, h * 1.34, stone2, seed + 5, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, h * 1.34, h * 1.5, stone2, seed + 6, night, alpha, true);
    // The porte-cochère again, shallower: a hotel sets you down under cover too.
    { const [hx, hy] = F(0, fh * 1.26);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.5, h * 0.2, h * 0.26, base2, seed + 7, night, alpha, true, 0, fh * 0.3);
      if (night) glowPool(ctx, cam, hx, hy, h * 0.16, '255,214,160', 14, alpha * 0.5); }
    if (frontVis) {   // front-face signage — hidden when the marquee side is turned away
      marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.27, neon, night, alpha);                           // marquee sign across the front
      const [nx, ny] = F(-fh * 0.55, fh * 0.55); neonBlade(ctx, cam, nx, ny, h * 0.3, h * 1.35, neon, night, alpha);
    }
    if (night) glowPool(ctx, cam, dx, dy, h * 1.4, '255,120,180', 20, alpha * 0.2);
  },
  embassy(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Embassy Hotel & Bar: a YARD-SIDE COMMERCIAL HOTEL — an engineering-brick
    //                    plinth, a glazed-faience shaft in segmental-arched bays between pilaster
    //                    strips, a cast-iron and glass canopy over the pavement, the BAR lit along
    //                    the street frontage, a deep corbelled cornice, and a lead-roofed clock
    //                    turret on the corner. Its name is cut into the parapet. No neon, no blade.
    //
    // ⚠ IT WAS FOUR BOXES AND A TRIANGULAR-PRISM SIGN, AND THE SIGN WAS DOING THE WORK. A blade
    // that size is what you reach for when the building underneath it has nothing to look at, and
    // it read as generic because it was: base, shaft, cornice, attic, and an EMBASSY prism bolted
    // to the corner. The detail here is the Meridian's — bays, pilasters, a real street entrance,
    // a corbel course, a roof material that differs from the wall — at ABOUT HALF the Meridian's
    // height, because this is a commercial hotel beside the freight yards and not a landmark.
    //
    // ⚠ AND THE BAR IS BACK. The old arm's own comment says the bar podium was 'removed — it
    // wasn't reading right', which left a building called Hotel & Bar with no bar on it and two
    // barkeeps working inside it. It isn't a podium now, it's the ground floor's own frontage lit
    // from within, which is what a hotel bar looks like from the street.
    const brick = 'ty_embassy_brick', faience = 'ty_embassy_faience';
    const iron = 'ty_embassy_iron', lead = 'ty_embassy_lead';
    const trim = 'ty_precast';
    // ⚠ THE ROOF FACE IS LEAD AND THE SIDES ARE NOT — the Meridian's lesson, and it's worth more
    // on a short building than a tall one: almost every horizontal surface here is inside a
    // pilot's view, and a cornice with a stone top reads as a building made of one thing.
    const ledge = facePals(E, { side: trim, roof: lead });
    const deck = facePals(E, { side: faience, roof: lead });
    const zPlinth = h * 0.16, zBar = h * 0.34, zShaft = h * 0.92;
    const zCorb = h * 0.95, zCorn = h * 1.01, zPara = h * 1.09, zTur = h * 1.34;
    // 1) Engineering-brick plinth, capped by a stone band. The band is what a brick building puts
    //    between itself and the pavement, and it's also the shelf the shaft sits back from.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, zPlinth, brick, seed + 10, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.09, zPlinth, zPlinth + h * 0.025, ledge, seed + 11, night, alpha, true);
    // 2) The ground floor — the BAR — in faience, standing a touch proud of the shaft above it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, zPlinth + h * 0.025, zBar, faience, seed + 12, night, alpha, false);
    // 3) The guest shaft.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, zBar, zShaft, faience, seed, night, alpha, false);
    // 4) PILASTER STRIPS up the shaft — corners and mid-face, front-centre skipped so the entrance
    //    bay reads clear between two piers. The same arrangement the Meridian uses and for the
    //    same reason: it's what makes a frontage read from an angle rather than only square on.
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [-1, 0]]) {
      const [px, py] = F(sx * fh * 0.99, sy * fh * 0.99);
      draw3DBoxAt(ctx, cam, px, py, fh * (sx && sy ? 0.11 : 0.085), zPlinth, zCorb, trim, seed + 20 + sx * 3 + sy, night, alpha, false);
    }
    // 5) SEGMENTAL ARCH HEADS over the ground-floor openings on the frontage — a shallow stone
    //    band per bay. Three bays: the entrance in the middle, the bar either side of it.
    if (frontVis) for (const s of [-1, 0, 1]) {
      const [ax, ay] = F(s * fh * 0.56, fh * 1.03);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.22, zBar - h * 0.05, zBar - h * 0.02, trim, seed + 30 + s, night, alpha, false);
    }
    // 6) THE STREET ENTRANCE: glazed doors in a stone surround under a cast-iron and glass canopy
    //    on two brackets, with a lamp either side. The canopy is thin and bracketed because that
    //    is the industrial cousin of the Meridian's bronze marquee rather than a copy of it.
    { const [ex, ey] = F(0, fh * 1.0); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.20, 0, zBar - h * 0.06, iron, seed + 40, night, alpha, false); }
    for (const s of [-1, 1]) { const [jx, jy] = F(s * fh * 0.23, fh * 1.04); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.045, 0, zBar - h * 0.02, trim, seed + 41 + s, night, alpha, true); }
    { const [cx, cy] = F(0, fh * 1.17); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.30, zBar - h * 0.07, zBar - h * 0.055, iron, seed + 44, night, alpha, true); }
    for (const s of [-1, 1]) { const [bx, by] = F(s * fh * 0.26, fh * 1.09); draw3DBoxAt(ctx, cam, bx, by, fh * 0.03, zBar - h * 0.055, zBar - h * 0.02, iron, seed + 46 + s, night, alpha, false); }
    for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 0.30, fh * 1.14); glowPool(ctx, cam, lx, ly, zBar - h * 0.08, '255,186,110', 6, alpha * (night ? 0.5 : 0.24)); }
    // 7) CORBEL COURSE under the cornice — a run of small stone blocks on the frontage and the two
    //    flanks. It's the cheapest detail here and it's the one that says 'brick hotel'.
    for (let i = -3; i <= 3; i++) {
      const [kx, ky] = F(i * fh * 0.27, fh * 1.0);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.055, zCorb - h * 0.035, zCorb, trim, seed + 60 + i, night, alpha, false);
      for (const s of [-1, 1]) { const [qx, qy] = F(s * fh * 1.0, i * fh * 0.27); draw3DBoxAt(ctx, cam, qx, qy, fh * 0.055, zCorb - h * 0.035, zCorb, trim, seed + 68 + i * s, night, alpha, false); }
    }
    // 8) Deep projecting cornice, then the parapet the name is cut into.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, zCorb, zCorn, ledge, seed + 13, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, zCorn, zPara, deck, seed + 14, night, alpha, true);
    // 8b) 'EMBASSY HOTEL' cut into the parapet — surface text on the stone, never billboarded, the
    //     same treatment THE MERIDIAN gets. This is the whole of the building's signage.
    if (frontVis) {
      const nhw = fh * 0.62, [nlx, nly] = F(-nhw, fh * 1.01), [nrx, nry] = F(nhw, fh * 1.01);
      const TL = cam.proj(nlx, nly, zPara - h * 0.012), TR = cam.proj(nrx, nry, zPara - h * 0.012);
      const BR = cam.proj(nrx, nry, zCorn + h * 0.012), BL = cam.proj(nlx, nly, zCorn + h * 0.012);
      if ([TL, TR, BR, BL].every((q) => q.f > 0.12)) {
        const nam = bakeSignText('EMBASSY HOTEL', '#d8cdb4', night ? 1 : 0, false);
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], nam, false, alpha);
      }
    }
    // 9) THE CORNER CLOCK TURRET — a square lead-roofed turret on the front-left corner with a pale
    //     dial facing the street. It's the crown, and on a building this short the crown is the
    //     only part with a silhouette against the sky.
    { const [tx, ty] = F(-fh * 0.62, fh * 0.62);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.30, zPara, zTur - h * 0.10, faience, seed + 70, night, alpha, false);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.34, zTur - h * 0.10, zTur - h * 0.07, ledge, seed + 71, night, alpha, true);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, zTur - h * 0.07, zTur, lead, seed + 72, night, alpha, true);
      // The dial: a pale disc proud of the turret's street face, lit from behind after dark.
      const [fx2, fy2] = F(-fh * 0.62, fh * 0.94);
      draw3DBoxAt(ctx, cam, fx2, fy2, fh * 0.17, zTur - h * 0.21, zTur - h * 0.10, trim, seed + 73, night, alpha, false);
      if (night) glowPool(ctx, cam, fx2, fy2, zTur - h * 0.155, '255,236,196', 7, alpha * 0.4);
    }
    // 10) After dark the bar burns warm along the pavement and the guest floors read cool above it.
    //     Two different lights, because they're two different rooms — and neither of them is a sign.
    if (night) {
      glowPool(ctx, cam, dx, dy, zPlinth + h * 0.10, '255,180,96', 24, alpha * 0.34);
      glowPool(ctx, cam, dx, dy, (zBar + zShaft) * 0.5, '196,214,238', 13, alpha * 0.14);
    }
  },
  clone(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Coldwater Clone Facility: clean lab shell, breathing bio-vats, a reactor dome, the Halcyon seal
    // ⚠ THIS IS THE FIRST BUILDING EVERY PLAYER EVER SEES, and it is worth knowing before you
    // change anything here. `zone_district_918_903`'s own arrival prose opens "The Clone Facility
    // door sighs shut behind you", so this frontage is the establishing shot of the entire game.
    // What stood on it was a pale box, four grey cabinets, and a roof glow commented "reactor
    // dome" with no dome anywhere underneath it.
    const bio = '90,255,200';
    const blockTop = h * 0.8, capTop = blockTop + h * 0.05;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.22, 0, h * 0.06, 'ty_clone_wall', seed + 30, night, alpha, false);     // the plinth it stands on
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, h * 0.06, blockTop, pal, seed, night, alpha, true);                // clinical main block
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.21, blockTop, capTop, 'ty_clone_wall', seed + 31, night, alpha, true); // capping course — a lab is a box, and a box needs an edge
    { const [sx, sy] = F(-fh * 0.36, -fh * 0.1); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.5, capTop, h * 1.15, pal, seed + 1, night, alpha, true); }   // set-back upper lab
    // ── THE REACTOR DOME, WHICH NOW EXISTS ──────────────────────────────────────────────────
    // Two facet drums — a wide shoulder and a small cap — which is the closest GLASS gets to a
    // curve, and the same trick the power plant's cooling towers use. It vents from its own
    // crown rather than from a pipe on the far side of the roof, which is where the steam was.
    const [rx, ry] = F(fh * 0.54, -fh * 0.02);   // forward of the roof's middle, or the frontage never sees it at all
    // ⚠ PALE, NOT DARK. The first cut shaded from 0.46 and came out as a grey-green boulder sitting
    // on a white roof; this building's whole palette is clinical, and the dome is the cleanest
    // thing on it.
    const shell = (f) => { const s = 0.58 + f.nl * 0.42; return `rgb(${(206 * s) | 0},${(222 * s) | 0},${(224 * s) | 0})`; };
    drawFacetDrum(ctx, cam, rx, ry, capTop, capTop + h * 0.20, fh * 0.38, fh * 0.30, 14, alpha, shell, 'rgb(158,180,186)');
    drawFacetDrum(ctx, cam, rx, ry, capTop + h * 0.20, capTop + h * 0.32, fh * 0.30, fh * 0.11, 14, alpha, shell, 'rgb(186,212,208)');
    drawRing(ctx, cam, rx, ry, capTop + h * 0.20, fh * 0.39, 14, night ? 'rgba(120,255,220,0.65)' : 'rgba(140,210,196,0.4)', 2, alpha);   // containment band
    drawSmoke(ctx, cam, rx, ry, capTop + h * 0.32, '206,232,226', alpha * 0.6, now, seed + 2);
    // ── THE PRINT CYCLE ─────────────────────────────────────────────────────────────────────
    // ⚠ THE ONE THING THIS BUILDING HAS NEVER DONE ON SCREEN IS MAKE ANYBODY. It runs one tank at
    // a time, on a long clock, and the dome surges with it — so the facility that printed you is
    // occasionally seen printing somebody else. `work` is a third, so most of the time it is a
    // quiet lab; the tank is picked off the TILE, so two facilities never run the same one.
    const vp = motionPhase(now, seed + 41, 46000, 0.34), vu = vp < 0 ? 0 : vp;
    const run = vp < 0 ? 0 : Math.sin(Math.PI * vu);                    // 0 → 1 → 0 across the print
    const printing = vp < 0 ? -1 : Math.floor(frac(seed + 5) * 4);
    glowPool(ctx, cam, rx, ry, capTop + h * 0.26, '120,255,220', 22 + run * 12, clamp(alpha * (night ? 0.42 : 0.24) * (1 + run * 1.3), 0, 1));
    // ── THE VATS, WHICH BREATHE ─────────────────────────────────────────────────────────────
    // Four tanks that were four grey cabinets with a speck of green in each. A vat holds
    // something alive, so the glow rises and falls — slowly, and each on its own clock, because
    // four tanks pulsing in unison is a fairground ride and four out of step is a plant.
    // ⚠ THE ROW MOVED OFF CENTRE, which is what buys the entrance bay below it: a door needs a
    // gap and the old row left one nine hundredths of a footprint wide, dead centre.
    for (let i = 0; i < 4; i++) {
      const lx = (-0.34 + (-0.75 + i * 0.5) * 0.7) * fh;
      const [vx, vy] = F(lx, fh * 1.32);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.13, 0, h * 0.52, 'ty_clone_vat', seed + 12 + i, night, alpha, true);
      const breath = motionOn() ? 0.72 + 0.28 * Math.sin((now || 0) * 0.0009 + frac(seed + i * 7) * 6.283) : 1;
      const surge = i === printing ? run * 2.1 : 0;
      // The inspection window. ⚠ NOT A `drawRing` — a ring is four facets round a DRUM and these
      // tanks are boxes, so it bakes as a teal lozenge hanging in the air in front of each one.
      // It is a lit strip across the tank's own front face, which is the thing you look through.
      const [wl] = [F(lx - fh * 0.115, fh * 1.455)], wr = F(lx + fh * 0.115, fh * 1.455);
      emitWire(ctx, cam, [wl[0], wl[1], h * 0.31], [wr[0], wr[1], h * 0.31], 2.4,
        `rgba(${bio},${clamp(0.34 + 0.4 * breath + surge * 0.3, 0, 1).toFixed(2)})`, alpha, { pull: 0.03, glow: night ? 7 : 0, glowCss: `rgb(${bio})` });
      // ⚠ AND THE POOL SITS OUTSIDE THE TANK, NOT IN THE MIDDLE OF IT. A glow at the box's own
      // centre is inside a solid, so the depth buffer hides it and the probe hid most of it too —
      // which is why four lit tanks had one green speck each. What a lit tank does is light the
      // yard in front of it.
      glowPool(ctx, cam, wl[0] + (wr[0] - wl[0]) / 2, wl[1] + (wr[1] - wl[1]) / 2, h * 0.30, bio,
        8 * (1 + surge * 0.5), clamp(alpha * (night ? 0.6 : 0.34) * breath * (1 + surge), 0, 1));
    }
    // The service gantry over the row — a handrail on posts, which is what ties four tanks on a
    // forecourt to the building behind them instead of leaving them standing there like bins.
    { const gz = h * 0.58, [ga] = [F(-fh * 0.92, fh * 1.32)], gb = F(fh * 0.26, fh * 1.32);
      emitWire(ctx, cam, [ga[0], ga[1], gz], [gb[0], gb[1], gz], 1.6, 'rgba(150,168,172,0.9)', alpha, { pull: 0.05 });
      emitWire(ctx, cam, [ga[0], ga[1], gz - h * 0.05], [gb[0], gb[1], gz - h * 0.05], 1.1, 'rgba(150,168,172,0.75)', alpha, { pull: 0.05 });
      for (const p of [ga, gb]) emitWire(ctx, cam, [p[0], p[1], h * 0.52], [p[0], p[1], gz], 1.4, 'rgba(150,168,172,0.9)', alpha, { pull: 0.05 });
      if (night) glowPool(ctx, cam, (ga[0] + gb[0]) / 2, (ga[1] + gb[1]) / 2, gz + h * 0.02, '200,240,235', 9, alpha * 0.3); }
    // ── THE HALCYON SEAL ────────────────────────────────────────────────────────────────────
    // ⚠ WHY HALCYON OWNS THIS BUILDING IS ALREADY WRITTEN, and nothing here invents it.
    // `plugins/augments/backup.js` sells the restore policy at Halcyon and then prints you HERE —
    // "That was settled at Halcyon long before today" — and the seal on the adjuster's screen is
    // described as "a calm closed eye". So it goes on the wall of the place the policy is
    // redeemed, which is the one building in the city where that transaction becomes a person.
    // See the ⚠ on the `eye` pictogram.
    if (frontVis) {
      const tex = bakeSignText('', '#7fe8d2', night ? 1 : 0, false, true, true, { picto: 'eye', badge: true, color: '#10202a' });
      if (tex) {
        const q = [[-fh * 0.62, capTop - h * 0.03], [-fh * 0.18, capTop - h * 0.03], [-fh * 0.18, capTop - h * 0.27], [-fh * 0.62, capTop - h * 0.27]]
          .map(([lx, z2]) => { const [wx, wy] = F(lx, fh * 1.18); return cam.proj(wx, wy, z2); });
        if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
    }
    // ── THE NAME ────────────────────────────────────────────────────────────────────────────
    // Beside the seal, on the same band under the capping course. What the place is called by
    // the people it prints is what it is called: YOU AGAIN.
    if (frontVis) {
      const tex = bakeSignText('YOU AGAIN', '#7fe8d2', night ? 1 : 0, false, true, true, { font: 'condensed', sub: 'CLONE FACILITY' });
      if (tex) {
        const q = [[-fh * 0.10, capTop - h * 0.05], [fh * 1.02, capTop - h * 0.05], [fh * 1.02, capTop - h * 0.25], [-fh * 0.10, capTop - h * 0.25]]
          .map(([lx, z2]) => { const [wx, wy] = F(lx, fh * 1.18); return cam.proj(wx, wy, z2); });
        if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
    }
    // The intake bay, at the end of the frontage the tank row leaves clear. This is the door.
    if (frontVis) {
      const [cx2, cy2] = F(fh * 0.70, fh * 1.16);
      draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.30, h * 0.30, h * 0.36, 'ty_clone_wall', seed + 33, night, alpha, false);        // canopy slab
      for (const s of [-1, 1]) { const [px, py] = F(fh * (0.70 + s * 0.24), fh * 1.28); draw3DBoxAt(ctx, cam, px, py, fh * 0.035, 0, h * 0.30, 'ty_clone_wall', seed + 34 + s, night, alpha, false); }
      glowPool(ctx, cam, cx2, cy2, h * 0.12, '190,240,255', 12, alpha * (night ? 0.5 : 0.2));                                 // the light over the door, on at any hour
    }
    { const [mx, my] = F(-fh * 0.9, fh * 0.5); mast(ctx, cam, mx, my, blockTop, h * 1.55, alpha, now, seed + 4); }
    blinkLight(ctx, cam, dx, dy, h * 1.15, bio, now, seed, alpha, 2);
  },
  luxtower(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Halcyon Towers: a CAYAN-style helical glass slab — a slender square curtain-glass tower
    //                    with strong horizontal floor plates, twisting ~80° over its height to a chiselled crown.
    const neonA = '80,230,255', neonB = '255,90,180';   // cyan / magenta cyberpunk edge light
    const baseZ = h * 0.28, topZ = h * 2.7, N = 22;      // many thin floor-groups → a smooth continuous twist
    const twist = 1.4, fwBase = fh * 0.8;                // ~80° total helix + slender square footprint half-width
    const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
    const segW = (i) => fwBase * (1 - 0.44 * (i / N));   // gentle taper to a slender crown
    const segYaw = (i) => twist * (i / N);               // progressive rotation = the helix
    // 1) Lit lobby podium the tower rises out of (no street-overhanging entrance canopy).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.3, 0, baseZ, pal, seed + 4, night, alpha, true);
    // 2) The helical glass slab — thin square curtain-glass boxes, each rotated a touch more than the last.
    //    Its ty_halcyon skin is the glass floor-plate texture (GLASS_WALL), so the twist reads as banded glass.
    for (let i = 0; i < N; i++) draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, i === N - 1, segYaw(i));
    // 3) Spiralling cyan/magenta light-runners — trace two opposite vertical corners up the twisting stack.
    for (const [dir, rgb] of [[[-1, -1], neonA], [[1, 1], neonB]]) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
        pts.push([dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i)]);
      }
      // ⚠ THE TIE-BREAKER, NOT emitWire's DEFAULT PULL. A corner runner LIES ON the shaft it
      // traces, so it only has to win a tie. At the default 0.6 of a tile it is dragged that far
      // toward the eye — more than this tower has to give, since its own near face is about 0.44
      // from the tile centre — so the runner on the FAR corner comes out IN FRONT of the near
      // wall and the helix paints flat across the building instead of going behind it. That is
      // exactly what `helixRunner` already carries for the authored kit, and the three
      // hand-written towers were missed when it was fixed there. `glself` counts it.
      if (pts.length > 1) emitLightRunner(ctx, cam, pts, `rgba(${rgb},0.9)`, alpha * (night ? 0.95 : 0.55), night, rgb, undefined, DECO_PULL);
    }
    // 4) Chiselled crown — a short set-back box continuing the twist — + an antenna spire with a holo beacon.
    draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.9, topZ, topZ + h * 0.2, pal, seed + 20, night, alpha, true, twist * 1.08);
    mast(ctx, cam, dx, dy, topZ + h * 0.2, topZ + h * 0.56, alpha, now, seed);
    if (night) {
      glowPool(ctx, cam, dx, dy, baseZ, '120,220,255', 24, alpha * 0.3);            // cool lobby wash
      glowPool(ctx, cam, dx, dy, baseZ + (topZ - baseZ) * 0.5, neonA, 14, alpha * 0.22);   // mid sky-lobby glow
      glowPool(ctx, cam, dx, dy, topZ + h * 0.08, neonB, 16, alpha * 0.3);          // crown halo
    }
    blinkLight(ctx, cam, dx, dy, topZ + h * 0.56, neonA, now, seed, alpha, 2);      // cyan beacon on the spire
  },
  solenne(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Solenne Residences: an opulent champagne-glass residential spire — three graceful
    //                  setback tiers narrowing to a glowing rooftop sky-pool band + a lantern crown.
    //                  WARM gold light-runners + a gentle quarter-turn — deliberately luxe/warm where
    //                  Halcyon is cold and angular, and taller, so the two read as rival landmarks.
    const gold = '255,206,120', warm = '255,232,190';
    const baseZ = h * 0.30, topZ = h * 3.05, N = 24;         // taller than Halcyon; many thin glass plates
    const twist = 0.52, fwBase = fh * 0.86;                  // ~30° gentle turn (elegant, not a helix)
    const segZ = (i) => baseZ + (topZ - baseZ) * (i / N);
    // Three setback tiers: the footprint steps in at ~1/3 and ~2/3 height, tapering within each tier.
    const tierW = (t) => t < 0.34 ? fwBase * (1 - 0.10 * (t / 0.34))
      : t < 0.68 ? fwBase * 0.80 * (1 - 0.12 * ((t - 0.34) / 0.34))
      : fwBase * 0.62 * (1 - 0.18 * ((t - 0.68) / 0.32));
    const segW = (i) => tierW(i / N);
    const segYaw = (i) => twist * (i / N);
    // 1) THE PODIUM, AND THE ENTRANCE IN IT.
    //
    // ⚠ A LANDMARK THAT DRAWS NO GROUND FLOOR IS HANDED THE KIT'S, AND THE KIT'S IS A SHOP'S.
    // This was one glass box, and everything at street level came from `derivedKit`: a punched
    // shopfront, an awning, a vending machine, a bollard, balconies bolted across the frontage
    // and a slack wire strung over the door. That vocabulary is a commercial street's and it is
    // right nearly everywhere; on the one address in Coldwater that has to read as money it is
    // the whole problem, and the name board ended up in the middle of it. So the arm draws its
    // own entrance and `KIT_DECLINE` keeps the shop's off it — the Meridian's §1b argument,
    // applied to the Meridian's modern sibling.
    const stone = 'ty_marble_col', bronze = 'ty_marble_bronze';   // pale ashlar reveal, warm bronze metalwork
    // ⚠ EVERY PART BELOW IS MEASURED OFF `podW`, NEVER OFF `fh`. `segFit` trims the podium back
    // to the plot line on the entrance side, so an entrance sized off the footprint stands off a
    // wall that is no longer where it was authored. One number, and the reveal, the canopy, the
    // columns and the nameplate all move with the mass they are bolted to.
    const podW = fh * 1.34, eY = faceYaw(E);
    // ⚠ THE CANOPY SITS LOW ON PURPOSE, and it is the nameplate that decides how low. A fascia
    // stands PROUD of the wall it is on, so it is nearer the eye than that wall and projects
    // BIGGER — at a cab's distance a band seated in world-z just under the podium top still
    // straddles the roofline on screen. Measured at ×1.12. So the canopy comes down far enough
    // to leave the plate a whole band of fascia under the parapet rather than a sliver.
    const doorZ = baseZ * 0.46, headZ = baseZ * 0.58;             // the head of the doors, and the lintel over them
    draw3DBoxAt(ctx, cam, dx, dy, podW, 0, baseZ, pal, seed + 4, night, alpha, true);            // the glazed podium
    // 1a) A REVEAL, NOT A SLAB. `draw3DBoxAt` draws a solid, so a one-box "surround" in front of
    //     the doors is a wall across the doorway. Two jambs and a lintel leave an opening.
    // ⚠ AND ALL THREE STAND ON THE SAME PLANE, WHICH IS A DECISION. The obvious reveal sets the
    // doors BACK behind the jambs — and the podium's own front wall is then in front of them, so
    // the doors are simply not there and the entrance reads as an open bay. The jambs, the lintel
    // and the doors are disjoint in x and z, so one plane costs nothing and the depth comes from
    // the canopy standing off it instead.
    for (const s of [-1, 1]) { const [jx, jy] = F(s * podW * 0.42, podW * 0.96);
      draw3DBoxAt(ctx, cam, jx, jy, podW * 0.045, 0, headZ, stone, seed + 30 + s, night, alpha, true, eY, podW * 0.10); }
    { const [lx, ly] = F(0, podW * 0.96);
      draw3DBoxAt(ctx, cam, lx, ly, podW * 0.48, doorZ, headZ, stone, seed + 32, night, alpha, true, eY, podW * 0.10); }
    { const [gx, gy] = F(0, podW * 0.96);                                                        // the glazed bronze doors between the jambs
      draw3DBoxAt(ctx, cam, gx, gy, podW * 0.33, 0, doorZ, bronze, seed + 33, night, alpha, false, eY, podW * 0.10); }
    // 1b) The canopy over the pavement, on two slim columns. `awning` places a slab by its FRONT
    //     edge, which is the edge the tile fit trims, so the part that survives is the part that
    //     overhangs — a shallower canopy rather than one buried in its own facade.
    awning(ctx, cam, dx, dy, E, podW * 0.62, podW * 1.02, headZ, headZ + h * 0.022, bronze, seed + 34, night, alpha, podW * 0.30);
    for (const s of [-1, 1]) { const [cx2, cy2] = F(s * podW * 0.56, podW * 0.92);
      draw3DBoxAt(ctx, cam, cx2, cy2, podW * 0.026, 0, headZ, bronze, seed + 35 + s, night, alpha, false, eY, podW * 0.026);
      glowPool(ctx, cam, cx2, cy2, headZ * 0.94, warm, 5, alpha * (night ? 0.52 : 0.22)); }       // a lamp on each column
    // 1c) AND THE BUILDING SAYS ITS OWN NAME, on the podium fascia over the canopy.
    //
    // ⚠ THE ARM SIGNING ITSELF IS WHAT KEEPS THE KIT OFF THE NAME, and it is one mechanism doing
    // three things: `armSignsItself` rides the same capture, so `wants('sign')` goes false and no
    // second board is hung anywhere; `marqueeStand` solves the stand-off against this building's
    // own captured front plane, so the plate sits ON the podium rather than inside it; and
    // `reserveSignBand` — unconditional, never inside `frontVis`, see the ⚠ there — tells the kit
    // that this band of the facade is spoken for, which is the thing that stops a cable run being
    // strung across the lettering.
    // ⚠ AND IT IS LETTERING ON A BAND, NOT A `marqueeBand`, WHICH WAS THE OBVIOUS FREE ANSWER AND
    // IS THE WRONG SIGN FOR THIS BUILDING. `fasciaKind` rolled this model a backlit lightbox — a
    // bright face with the letters cut dark out of it, which is a good shop sign and which after
    // dark comes out as a flat grey slab with grey writing on it. Measured against the same band
    // on the shop next door, which gets gold on dark and is legible from the road. A residential
    // tower letters its own stone, so this is the Meridian's gilt nameplate instead.
    //
    // ⚠ THE BAND'S FRONT PLANE IS AN ABSOLUTE, AND THAT IS THE ONLY WAY TO KNOW WHERE IT IS.
    // Lettering has to be projected onto the plane the band actually ends up on, and `segFit`
    // trims anything authored past the plot line — so a plane measured off `podW` is a plane the
    // renderer may move out from under the words. A constant is still affine (`[0, 0, c]`, which
    // is what the kit's own `A()` produces), so the band is authored to stop just inside the plot
    // line and the lettering sits a hair in front of it.
    const sgnY = 0.485, sgnZ0 = baseZ * 0.66, sgnZ1 = baseZ * 0.92;
    { const [bx, bz] = F(0, sgnY - 0.016);
      draw3DBoxAt(ctx, cam, bx, bz, podW * 0.50, sgnZ0, sgnZ1, bronze, seed + 37, night, alpha, true, eY, 0.016); }
    reserveSignBand(podW * 0.50, (sgnZ0 + sgnZ1) * 0.5);
    if (frontVis) {
      // ⚠ BAKED UNCONDITIONALLY, because `bakeSignText` is what registers this arm as signing
      // itself and it registers on the way IN — a bake skipped for want of a name during the
      // capture leaves `armSignsItself` false and the kit hangs a second board on the building.
      // ⚠ SCRIPT, AND SO IN THE NAME'S OWN CASE. The Solenne letters its podium in a cursive hand, the
      // one address in the city that signs itself like an invitation. `sign` is the name uppercased
      // for every board that wants capitals, and script set in capitals is a row of loops nobody can
      // read, so this takes `name` as authored.
      const nam = bakeSignText((name || '').trim() || 'Solenne Residences', '#f0d29a', night ? 1 : 0, false, undefined, undefined, { font: 'script' });
      const nhw = podW * 0.42, [nlx, nly] = F(-nhw, sgnY), [nrx, nry] = F(nhw, sgnY);
      const iz0 = sgnZ0 + (sgnZ1 - sgnZ0) * 0.24, iz1 = sgnZ1 - (sgnZ1 - sgnZ0) * 0.24;
      const TL = cam.proj(nlx, nly, iz1), TR = cam.proj(nrx, nry, iz1), BR = cam.proj(nrx, nry, iz0), BL = cam.proj(nlx, nly, iz0);
      if (nam && [TL, TR, BR, BL].every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], nam, false, alpha);
    }
    if (night) { const [sx2, sy2] = F(0, 0.50); glowPool(ctx, cam, sx2, sy2, (sgnZ0 + sgnZ1) * 0.5, gold, 11, alpha * 0.42); }   // the nameplate's own uplight
    // A lobby is lit in the daytime too — weakly, because the sun is doing most of it, but a dark
    // hole behind the glass is the one thing that reads as a building nobody is in.
    // ⚠ AND EVERY ONE OF THESE STANDS AT THE PLOT LINE RATHER THAN WHERE THE LAMP IS. A glow is a
    // depth-TESTED quad, so a lobby wash seated at its own light source — behind the doors, inside
    // the podium — is hidden by the podium's own front wall, which reads exactly like an unlit
    // building. The light a street sees is the light that gets OUT, so it is placed on the glass.
    // ⚠ TWO POOLS AT TWO HEIGHTS, NOT ONE BIG ONE. A single radial in the middle of a doorway is a
    // lamp hanging in it; a lit room is brighter at the ceiling and spills down the glass.
    { const [wx, wy] = F(0, 0.50);
      glowPool(ctx, cam, wx, wy, doorZ * 0.82, warm, 22, alpha * (night ? 0.40 : 0.13));
      glowPool(ctx, cam, wx, wy, doorZ * 0.24, warm, 18, alpha * (night ? 0.34 : 0.10)); }        // the lobby, spilling out across the pavement
    if (night) { const [ux, uy] = F(0, 0.50); glowPool(ctx, cam, ux, uy, headZ * 1.02, gold, 10, alpha * 0.34); }         // downlights in the canopy soffit
    // 2) The champagne-glass shaft — thin plates, gentle quarter-turn, stepping inward at each tier.
    // EVERY PLATE CAPS, not just the top one. `segW` only ever narrows (the taper within each
    // tier plus the two setbacks), so each plate leaves a ring of the plate below it uncovered —
    // and with `capTop` reserved for i === N-1 that ring was an open hole looking straight down
    // into a hollow shell. It reads as the building being see-through along its edges, because
    // the quarter-turn twist is what widens the exposed sliver most at the corners. A ledge has
    // a top surface; this draws it. Only the plates that genuinely step in pay for a cap.
    for (let i = 0; i < N; i++) {
      const capped = i === N - 1 || segW(i + 1) < segW(i) - 1e-6;
      draw3DBoxAt(ctx, cam, dx, dy, segW(i), segZ(i), segZ(i + 1), pal, seed + i, night, alpha, capped, segYaw(i));
    }
    // 3) Warm gold light-runners tracing two opposite corners up the tapering stack.
    for (const dir of [[-1, -1], [1, 1]]) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const w = segW(Math.min(i, N - 1)), ya = segYaw(i), cw = Math.cos(ya), sw = Math.sin(ya), lx = dir[0] * w, ly = dir[1] * w;
        pts.push([dx + lx * cw - ly * sw, dy + lx * sw + ly * cw, segZ(i)]);
      }
      if (pts.length > 1) emitLightRunner(ctx, cam, pts, `rgba(${gold},0.9)`, alpha * (night ? 0.92 : 0.5), night, gold, undefined, DECO_PULL);   // the tie-breaker — see the ⚠ on Halcyon's runners
    }
    // 4) The glowing rooftop SKY-DECK POOL band just below the crown — a bright warm ring + a soft wash.
    { const z = segZ(N) - h * 0.06, r = segW(N - 1) * 1.08;
      drawRing(ctx, cam, dx, dy, z, r, 16, `rgba(${warm},${night ? 0.95 : 0.52})`, 2.2, alpha);
      if (night) glowPool(ctx, cam, dx, dy, z, gold, 15, alpha * 0.3); }
    // 5) Lantern crown — a short bright set-back box continuing the turn — capped by the SKY PAD.
    //    No antenna spire: this roof is a licensed helideck (af_solenne), and a mast over the
    //    touchdown circle is the one thing that must never be there. The obstruction light moves
    //    onto a perimeter post at the pad's edge, where a real helideck carries it.
    draw3DBoxAt(ctx, cam, dx, dy, segW(N) * 0.86, topZ, topZ + h * 0.26, pal, seed + 20, night, alpha, true, twist);
    { const deckZ0 = topZ + h * 0.26, deckZ1 = deckZ0 + h * 0.04, padR = segW(N) * 1.15;
      // The deck slab itself — wider than the lantern it caps, the way a helideck oversails its
      // core. A captured box, so the sim collides with the pad you can see and lands ON it.
      draw3DBoxAt(ctx, cam, dx, dy, padR, deckZ0, deckZ1, pal, seed + 21, night, alpha, true, twist);
      helideck(ctx, cam, dx, dy, deckZ1 + 0.002, padR * 0.86, gold, warm, night, alpha, now, seed);
      // 5b) THE STAIR HEAD: the housing the stair comes up through onto the deck. ⚠ IN A CORNER,
      //     BECAUSE THAT IS THE ONLY PLACE ON THIS ROOF ANYTHING MAY STAND. The touchdown circle is
      //     0.86 of the deck's half-width and the deck is square, so its four corners are the one
      //     ground outside it: set at 0.8 on both axes with a 0.12 half-width, the housing's nearest
      //     face is 0.96 out, clear of the circle. It takes the rear corner, away from the street, and
      //     it is a captured box like the deck, so the sim collides with it rather than landing on it.
      const sw = padR * 0.12, sa = padR * 0.8, sh = h * 0.045, ct = Math.cos(twist), st2 = Math.sin(twist);
      const corners = [[sa, sa], [sa, -sa], [-sa, sa], [-sa, -sa]].map(([lx, ly]) => [lx * ct - ly * st2, lx * st2 + ly * ct]);
      const [cxw, cyw] = corners.reduce((b, c) => (c[0] * E[0] + c[1] * E[1] < b[0] * E[0] + b[1] * E[1] ? c : b));
      draw3DBoxAt(ctx, cam, dx + cxw, dy + cyw, sw, deckZ1, deckZ1 + sh, stone, seed + 23, night, alpha, true, twist);
      // Its door, a bronze leaf on the face toward the middle of the deck, and a lamp over it.
      const inX = -Math.sign(cxw * ct + cyw * st2), dxw = inX * (sw + 0.002) * ct, dyw = inX * (sw + 0.002) * st2;
      draw3DBoxAt(ctx, cam, dx + cxw + dxw, dy + cyw + dyw, 0.002, deckZ1, deckZ1 + sh * 0.74, bronze, seed + 24, night, alpha, false, twist, sw * 0.42);
      if (night) glowPool(ctx, cam, dx + cxw + dxw, dy + cyw + dyw, deckZ1 + sh * 0.82, warm, 5, alpha * 0.5); }
    if (night) {
      glowPool(ctx, cam, dx, dy, baseZ, warm, 22, alpha * 0.3);                     // warm lobby wash
      glowPool(ctx, cam, dx, dy, baseZ + (topZ - baseZ) * 0.5, gold, 13, alpha * 0.2);  // mid sky-lobby glow
      glowPool(ctx, cam, dx, dy, topZ + h * 0.1, gold, 16, alpha * 0.32);            // crown halo
    }
  },
  chrome(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Chrome Court: a HIGH-TECH mirror-steel obelisk — a smooth tapered faceted chrome monolith
    //                 ringed by glowing cyan LED tech-bands, a brighter set-back sky-lounge halo + a beacon spire.
    //                 Deliberately ROUNDED where Halcyon is an angular twisting slab, so the two read as siblings.
    const led = '90,220,255';                              // cyan LED tech accent
    const NF = 10, baseZ = h * 0.22, topZ = h * 2.35;      // decagon: smooth but faceted; slightly shorter than Halcyon
    const rB = fh * 0.88, rShaftB = rB * 0.94, rT = fh * 0.4;   // wide base tapering to a slim crown
    const steelBase = WALL_COL[pal] || [118, 126, 136];    // ty_chrome
    const rAt = (t) => rShaftB + (rT - rShaftB) * t;       // shaft radius at height-fraction t
    // Procedural MIRROR-STEEL skin: a vertical gradient reflecting the sky up top, a dark polished
    // steel mid, and a brighter ground sheen low — modulated per facet by the key light (f.nl).
    const mirror = (f, tp, bt) => {
      const g = ctx.createLinearGradient(0, tp, 0, bt), s = 0.45 + f.nl * 0.6;
      if (night) {
        g.addColorStop(0, `rgba(${72 * s | 0},${96 * s | 0},${122 * s | 0},0.97)`);   // cool night sky on the steel
        g.addColorStop(0.5, `rgba(${38 * s | 0},${48 * s | 0},${60 * s | 0},0.97)`);
        g.addColorStop(1, `rgba(${58 * s | 0},${70 * s | 0},${84 * s | 0},0.97)`);     // city glow reflected low
      } else {
        g.addColorStop(0, `rgba(${182 + f.nl * 48 | 0},${202 + f.nl * 38 | 0},226,0.97)`);   // bright sky mirror
        g.addColorStop(0.44, `rgba(${steelBase[0] * s | 0},${steelBase[1] * s | 0},${steelBase[2] * s | 0},0.97)`);
        g.addColorStop(1, `rgba(${150 + f.nl * 40 | 0},${164 + f.nl * 34 | 0},178,0.97)`);   // ground sheen
      }
      return g;
    };
    const capCol = night ? 'rgba(46,58,72,0.97)' : 'rgba(178,196,216,0.97)';
    // 1) Splayed plinth (no street-overhanging entrance canopy).
    drawFacetDrum(ctx, cam, dx, dy, 0, baseZ, rB * 1.06, rB * 0.96, NF, alpha, mirror, capCol, 'ty_hf_mirror_dk');   // the plinth: a darker mirror, so the monolith stands on something
    // 2) The tapered chrome shaft — one smooth mirror-steel frustum (cone), no window grid.
    drawFacetDrum(ctx, cam, dx, dy, baseZ, topZ, rShaftB, rT, NF, alpha, mirror, null);
    // 3) Glowing horizontal LED tech-bands hugging the shaft at regular tech-floors.
    for (const t of [0.14, 0.3, 0.46, 0.78]) {
      const z = baseZ + (topZ - baseZ) * t;
      drawRing(ctx, cam, dx, dy, z, rAt(t) * 1.015, NF, `rgba(${led},${night ? 0.85 : 0.42})`, 1.6, alpha);
    }
    // 4) Brighter set-back SKY-LOUNGE halo band ~0.6 up — a double ring + a soft glow.
    { const t = 0.6, z = baseZ + (topZ - baseZ) * t, r = rAt(t) * 1.05;
      drawRing(ctx, cam, dx, dy, z, r, NF, `rgba(200,240,255,${night ? 0.95 : 0.5})`, 2.4, alpha);
      drawRing(ctx, cam, dx, dy, z + h * 0.06, r, NF, `rgba(${led},${night ? 0.8 : 0.4})`, 1.4, alpha);
      if (night) glowPool(ctx, cam, dx, dy, z, led, 16, alpha * 0.3); }
    // 5) Slim crown drum (capped) + halo ring + antenna spire with a holo beacon.
    drawFacetDrum(ctx, cam, dx, dy, topZ, topZ + h * 0.22, rT * 1.08, rT * 0.52, NF, alpha, mirror, capCol);
    drawRing(ctx, cam, dx, dy, topZ + h * 0.02, rT * 1.14, NF, `rgba(${led},${night ? 0.9 : 0.45})`, 1.8, alpha);
    mast(ctx, cam, dx, dy, topZ + h * 0.22, topZ + h * 0.58, alpha, now, seed);
    glowPool(ctx, cam, dx, dy, topZ * 0.5, '198,214,230', 20, alpha * (night ? 0.3 : 0.16));   // cold chrome sheen up the face
    if (night) { glowPool(ctx, cam, dx, dy, baseZ, '150,200,240', 22, alpha * 0.28); glowPool(ctx, cam, dx, dy, topZ + h * 0.08, led, 14, alpha * 0.3); }
    blinkLight(ctx, cam, dx, dy, topZ + h * 0.58, led, now, seed, alpha, 2);
  },
  meridian(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Meridian: a VINTAGE ART-DECO residential landmark — a stepped buff-limestone
    //                 ziggurat with a bespoke reeded-window skin (see DECO_WALL), a grand glazed-bronze
    //                 street entrance under a gilt nameplate, corner pilasters + gargoyles up the shaft, a
    //                 finned deco coronet, and a stone lantern under a verdigris copper cupola. No neon.
    const trim = 'ty_archive_col', bronze = 'ty_meridian_bronze';                                     // warm limestone trim + dark bronze entrance metal
    // ⚠ THE ROOF IS A DIFFERENT MATERIAL FROM THE WALL UNDER IT, and on a stepped tower that is
    // most of what you see. Six of these boxes have a top a pilot looks straight down at — the two
    // setback terraces, the crown deck, and the three cornice ledges between them — and every one
    // of them was buff limestone, so from the air the building was one colour with a green hat on.
    // A deco tower of this vintage is roofed in sheet copper: verdigris decks and copper flashing
    // over the ledges, the same metal the cupola already is.
    //
    // The SIDES stay limestone. `facePals` resolves a spec into the box's own side order, so this
    // changes the roof face and nothing else — no new geometry in either renderer, and the mesh
    // carries `biome.roof` to the GPU exactly as the painter reads it here.
    const copper = 'ty_verdigris';
    const deck = facePals(E, { side: pal, roof: copper });                                            // a terrace: limestone walls, copper deck
    const ledge = facePals(E, { side: trim, roof: copper });                                          // a cornice ledge: stone fascia, copper flashing
    const zPod = h * 0.24, zShaft = h * 1.04, zSet1 = h * 1.52, zSet2 = h * 1.86, zCrown = h * 2.06;
    // 1) Stepped lobby podium, capped by a broad projecting cornice ledge.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.34, 0, zPod, pal, seed + 5, night, alpha, true);              // podium
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.40, zPod, zPod + h * 0.045, ledge, seed + 6, night, alpha, true);   // base cornice band
    // 1b) GRAND BRONZE STREET ENTRANCE on the frontage (E): a tall glazed-bronze portal in a fluted stone
    //     surround, a projecting marquee canopy over the sidewalk, and flanking amber torchère pylons. The
    //     front-centre pilaster (§3) is skipped so the bay reads clear between the corner piers.
    { const [ex, ey] = F(0, fh * 1.30); draw3DBoxAt(ctx, cam, ex, ey, fh * 0.30, 0, zPod + h * 0.02, bronze, seed + 40, night, alpha, false); }   // glazed bronze doors / lobby
    for (const s of [-1, 1]) { const [jx, jy] = F(s * fh * 0.34, fh * 1.34); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.055, 0, zPod + h * 0.06, trim, seed + 41 + s, night, alpha, true); }   // fluted stone jambs framing the doors
    { const [cx, cy] = F(0, fh * 1.42); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.34, zPod + h * 0.02, zPod + h * 0.05, bronze, seed + 44, night, alpha, true); }   // projecting bronze marquee canopy over the sidewalk
    for (const s of [-1, 1]) { const [tx, ty] = F(s * fh * 0.5, fh * 1.5); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.05, 0, zPod, trim, seed + 45 + s, night, alpha, true); glowPool(ctx, cam, tx, ty, zPod + h * 0.01, '255,190,110', 6, alpha * (night ? 0.5 : 0.26)); }   // torchère pylons + steady amber lamp
    // 2) Main shaft.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, zPod + h * 0.045, zShaft, pal, seed, night, alpha, true);
    // 2b) Gilt "THE MERIDIAN" engraved on a stone frieze band over the entrance — surface text, never billboarded.
    { const friZ0 = zPod + h * 0.07, friZ1 = zPod + h * 0.17;
      draw3DBoxAt(ctx, cam, dx, dy, fh * 1.10, friZ0, friZ1, trim, seed + 46, night, alpha, false);    // stone frieze band on the lower shaft
      if (frontVis) {
        const nhw = fh * 0.66, [nlx, nly] = F(-nhw, fh * 1.11), [nrx, nry] = F(nhw, fh * 1.11);
        const TL = cam.proj(nlx, nly, friZ1 - h * 0.012), TR = cam.proj(nrx, nry, friZ1 - h * 0.012), BR = cam.proj(nrx, nry, friZ0 + h * 0.012), BL = cam.proj(nlx, nly, friZ0 + h * 0.012);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const nam = bakeSignText('THE MERIDIAN', '#e8c878', night ? 1 : 0, false); emitSurfaceText(ctx, cam, [TL, TR, BR, BL], nam, false, alpha); }
      } }
    // 3) Vertical pilaster ribs standing proud of the shaft — corners + mid-face (front-centre skipped for the
    //    entrance bay), so the deco piers read from any camera angle (each box is backface-culled per face).
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[1,0],[-1,0]]) {
      const [px, py] = F(sx * fh * 1.02, sy * fh * 1.02);
      draw3DBoxAt(ctx, cam, px, py, fh * (sx && sy ? 0.13 : 0.10), zPod, zShaft + h * 0.04, trim, seed + 20 + sx * 3 + sy, night, alpha, false);
    }
    // 4) Shaft cornice ledge → first setback tier.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.13, zShaft, zShaft + h * 0.045, ledge, seed + 7, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, zShaft + h * 0.045, zSet1, pal, seed + 1, night, alpha, true);
    // 5) Second cornice → upper setback tier.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.89, zSet1, zSet1 + h * 0.04, ledge, seed + 8, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.58, zSet1 + h * 0.04, zSet2, pal, seed + 2, night, alpha, true);
    // 6) Crown cornice → set-back penthouse block, ringed by a finned DECO CORONET: vertical limestone fins
    //    stepping proud of the parapet (corners peaking highest) — the crown that reads best from the air.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, zSet2, zSet2 + h * 0.035, ledge, seed + 9, night, alpha, true);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.40, zSet2 + h * 0.035, zCrown, deck, seed + 3, night, alpha, true);   // the crown deck — the roof the cupola stands on, and the one a pilot looks straight down at
    for (const [sx, sy] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[1,0],[0,1],[-1,0]]) {
      const [fx, fy] = F(sx * fh * 0.42, sy * fh * 0.42);
      draw3DBoxAt(ctx, cam, fx, fy, fh * (sx && sy ? 0.06 : 0.05), zSet2 + h * 0.02, zCrown + h * (sx && sy ? 0.11 : 0.06), trim, seed + 50 + sx * 3 + sy, night, alpha, true);
    }
    // 7) Ornamental octagonal stone lantern + a verdigris copper OGEE cupola + a finial with a lonely
    //    amber beacon — the vintage crown that replaces the old rooftop water tank.
    const lantZ0 = zCrown, lantZ1 = zCrown + h * 0.16, lantR = fh * 0.26;
    const stoneRGB = WALL_COL[trim] || [150, 142, 124];
    const lantStyle = (f) => { const s = (night ? 0.44 : 0.78) + f.nl * 0.5; return `rgba(${stoneRGB[0]*s|0},${stoneRGB[1]*s|0},${stoneRGB[2]*s|0},0.97)`; };
    drawFacetDrum(ctx, cam, dx, dy, lantZ0, lantZ1, lantR * 1.04, lantR, 8, alpha, lantStyle, null, trim);   // ⚠ `lantStyle` shades from the TRIM palette, so the capture has to be told that too — see drawFacetDrum
    const cupH = h * 0.30, cupR = lantR * 1.12, apex = lantZ1 + cupH;
    // Records itself for the same reason the Hall of Records' dome does — see there.
    // ⚠ AND IN COPPER, NOT IN `SHAPE_PAL`. This recorded the building's own limestone, so every
    // reader downstream of capture — the distance LOD, the cold-open skyline, and now the GLASS 2
    // mesh, which is the shipping renderer — drew the Meridian's verdigris crown as buff stone.
    // Only the near 2-D painter ever knew it was green, because only the painter runs the bands.
    if (SHAPE_SINK) SHAPE_SINK.push({ kind: 'drum', dx, dy, wz0: lantZ1, wz1: apex, rb: cupR, rt: cupR * 0.08, n: 12, cap: false, pal: copper });
    // ⚠ A DOME IS A SURFACE, NOT A STACK OF PLATES. This was nine flat horizontal discs at nine
    // heights, with nothing between them — so from any angle below the crown you looked straight
    // between the layers and the cupola read as floating rings rather than a solid roof. The
    // ogee profile was right; there were simply no SIDES.
    //
    // Drawn as bands between consecutive rings instead, which is what drawFacetDrum already is —
    // and that also retires the per-disc depth bias the old loop needed, because a band has real
    // facets with real normals and sorts on its own geometry rather than on a tie-break.
    //
    // ⚠ AND IT MUST NOT RUN UNDER A CAPTURE. drawFacetDrum RECORDS itself to SHAPE_SINK and
    // returns, so eight bands would record eight drums on top of the one pushed above — nine
    // where the collision, the distance LOD and the cold open expect one. The push above is the
    // capture; these are the paint, and they are alternatives rather than a sequence.
    if (!SHAPE_SINK) {
      const CU = WALL_COL[copper];   // ⚠ READ, not restated: the decks below are roofed in this palette, and two hand-matched greens drift the moment either is tuned
      const rAt = (t) => cupR * Math.pow(Math.max(0, 1 - t * t), 0.7);
      const BANDS = 8;
      for (let i = 0; i < BANDS; i++) {
        const t0 = i / BANDS, t1 = (i + 1) / BANDS;
        const sh = 0.68 + 0.32 * t0;   // the old vertical gradient, lighter toward the apex
        const style = (f) => { const k = sh * (0.82 + (f.nl || 0) * 0.36);
          return `rgb(${Math.round(CU[0] * k)},${Math.round(CU[1] * k)},${Math.round(CU[2] * k)})`; };
        drawFacetDrum(ctx, cam, dx, dy, lantZ1 + cupH * t0, lantZ1 + cupH * t1, rAt(t0), rAt(t1), 12, alpha, style, null, copper);   // the mesh runs THESE, not the push above — see the ⚠ on drawFacetDrum
      }
    }
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.05, apex, apex + h * 0.12, trim, seed + 4, night, alpha, false);   // stone finial
    blinkLight(ctx, cam, dx, dy, apex + h * 0.16, '255,196,120', now, seed, alpha, 1.8);
    // 8) FOUR high-poly stone gargoyles crouched at the main-shaft cornice corners, each craning out
    //    over the street on the outward diagonal — the grotesques that make it a vintage landmark.
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [gx, gy] = F(sx * fh * 0.9, sy * fh * 0.9);
      drawGargoyle(ctx, cam, gx, gy, zShaft + h * 0.045, fh * 0.42, [gx - dx, gy - dy], alpha, night, seed + 30 + sx * 2 + sy);
    }
    if (night) {
      glowPool(ctx, cam, dx, dy, h * 0.9, '255,200,130', 14, alpha * 0.16);                            // scattered warm windows up the shaft
      glowPool(ctx, cam, dx, dy, zPod + h * 0.04, '255,206,140', 22, alpha * 0.24);                    // floodlit limestone base
      glowPool(ctx, cam, dx, dy, zPod * 0.5, '255,190,120', 12, alpha * 0.30);                         // warm spill from the lobby entrance
      glowPool(ctx, cam, dx, dy, apex, '150,220,190', 10, alpha * 0.16);                               // faint copper-crown wash
    }
  },
  divebar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Sump / The Green Room: it was ONE BOX. A dive bar is small, so there is no
    //                  height to play with — what it has instead is the stuff bolted to it, which
    //                  is exactly what a low building is read by from a cab window.
    const grime = pal, brick = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, 0, h * 0.62, grime, seed, night, alpha, false);
    // A stepped parapet the roof hides behind — the false front every small bar in every city
    // has, and the cheapest possible way to stop a low box reading as a shoebox.
    //
    // ⚠ BOTH OF THESE ARE CENTRED OR ON THE DIAGONAL, AND THAT IS A CORRECTNESS RULE RATHER THAN
    // a composition. `draw3DBoxAt` draws WORLD-AXIS-ALIGNED boxes: `F()` rotates a box's POSITION
    // to the entrance and leaves its footprint pointing north, so an off-centre box that is wider
    // than it is deep gives the model a different extent at each of the four facings — and
    // `gl:mesh` demands they are identical, correctly, because collision and the occluder hull
    // read that extent. The first cut put a false front at (0, 0.78) with its own `fd` and a
    // lean-to at (−0.78, −0.3), and failed on three models: "facing east reaches 0.674, facing
    // north 0.532". A square box on the diagonal has the same reach whichever way it is turned.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, h * 0.62, h * 0.72, brick, seed + 11, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, h * 0.72, h * 0.84, brick, seed + 12, night, alpha, true);
    // The back-of-house lean-to: the cellar hatch, the crates, the bit that smells.
    { const [bx2, by2] = F(-fh * 0.6, -fh * 0.6);
      draw3DBoxAt(ctx, cam, bx2, by2, fh * 0.3, 0, h * 0.34, brick, seed + 13, night, alpha, true); }
    { const [nx, ny] = F(fh * 0.42, fh * 0.5); neonBlade(ctx, cam, nx, ny, h * 0.62, h * 0.98, m.neon || '#5fd0ff', night, alpha); }   // blade over the door
    { const [vx, vy] = F(-fh * 0.6, fh * 0.2); drawSmoke(ctx, cam, vx, vy, h * 0.62, '120,116,110', alpha * 0.4, now, seed + 3); }      // kitchen/vent smoke
    if (night) glowPool(ctx, cam, dx, dy, h * 0.28, '255,180,90', 10, alpha * 0.2);                   // grimy amber window
    if (m.perch) {   // The Dead Pigeon — its stuffed bird on a pole over the register
      // ⚠ ON THE TERRACE, NOT THROUGH THE ROOF: at fh·0.55 the pole stood inside the upper
      // storey (half-width fh·0.74) from foot to tip, and only drew because the wire was pulled
      // 0.6 of a tile toward the eye, far enough to cross the building next door. fh·0.84 is
      // outside the upper storey and inside the lower one, so the pole stands on the setback.
      const [px, py] = F(0, fh * 0.84);
      mast(ctx, cam, px, py, h * 0.72, h * 0.82, alpha, now, seed + 7);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.08, h * 0.82, h * 0.9, 'ty_door', seed + 8, night, alpha, true);   // the pigeon silhouette
    }
  },
  strip(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Cherry Pit: a dark box with two blades on it. The blades were doing all
    //                  the work and the building was doing none — and a club is the ONE type where
    //                  the architecture is supposed to be a windowless wall with a very loud front
    //                  bolted to it, so the fix is not windows, it is a proper ENTRANCE.
    const neon = m.neon || '#ff4a9a';
    const dark = pal, trim2 = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.05, 0, h * 0.8, dark, seed, night, alpha, false);
    // A blank parapet above the roofline — a club never shows you its roof.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.09, h * 0.8, h * 0.9, trim2, seed + 14, night, alpha, true);
    // THE ENTRANCE BLOCK: a projecting porch with a canopy over it, and a queue rail. This is the
    // whole silhouette of a club from the street and the reason two blades on a cube read as a
    // sign shop rather than as a door somebody is standing outside of.
    { const [px2, py2] = F(0, fh * 1.0);
      draw3DBoxAt(ctx, cam, px2, py2, fh * 0.4, 0, h * 0.36, trim2, seed + 15, night, alpha, true, 0, fh * 0.22);
      draw3DBoxAt(ctx, cam, px2, py2, fh * 0.5, h * 0.36, h * 0.4, dark, seed + 16, night, alpha, true, 0, fh * 0.3); }
    { const [ax, ay] = F(-fh * 0.4, 0); neonBlade(ctx, cam, ax, ay, h * 0.8, h * 1.15, neon, night, alpha); }
    { const [bx, by] = F(fh * 0.4, 0); neonBlade(ctx, cam, bx, by, h * 0.8, h * 1.15, neon, night, alpha); }
    { const [gx, gy] = F(0, fh * 0.95); glowPool(ctx, cam, gx, gy, 0.02, '220,40,70', 16, alpha * (night ? 0.5 : 0.3)); }   // cherry-red spill out the entrance
    glowPool(ctx, cam, dx, dy, h * 0.85, '255,74,120', 20, alpha * (night ? 0.36 : 0.16));            // roofline wash
  },
  grocery(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ration Nine: neighbourhood store + a long front awning, stacked crates, and a lit sign
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, h * 0.6, pal, seed, night, alpha, true);
    awning(ctx, cam, dx, dy, E, fh * 1.06, fh * 1.05, h * 0.14, h * 0.28, 'ty_door', seed + 1, night, alpha, fh * 0.30);   // full-width awning
    for (const s of [-0.7, 0.7]) { const [cx, cy] = F(s * fh * 0.7, fh * 0.82); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.22, 0, h * 0.14, 'ty_door', seed + 9 + s * 3, night, alpha, true); }   // crates out front
    neonBlade(ctx, cam, dx, dy, h * 0.55, h * 0.85, m.neon || '#ffcf3e', night, alpha);
    if (night) glowPool(ctx, cam, dx, dy, h * 0.26, '255,214,140', 12, alpha * 0.22);                 // lit aisles through the glass
  },
  church(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // St Garneau's: a twin-tower granite front, a barrel-vaulted nave behind it, and the eye plastered across the middle of it
    // THE CONVERSION IS THE SILHOUETTE. Everything structural here is old and symmetrical —
    // paired towers, a round-headed centre bay, a wheel window, three arched portals — and the
    // one bright thing on it is a steel plate that was screwed on afterwards and is lit all
    // night while the building under it is not. Read from the air that is the whole story of
    // the place, and nothing anywhere says it out loud.
    //
    // ⚠ IT WAS A SHED WITH A CHIMNEY. The first cut was one wide box, a barrel roof and a single
    // squat tower parked off to one side at −0.55 — and a lone stub on one flank does not read as
    // a bell tower from any angle, it reads as a flue, which is exactly what the butcher two arms
    // up actually has. What makes a church legible at the range this sim draws buildings from is
    // the PAIR: two verticals with a gable between them is a shape nothing else in Coldwater
    // makes, and it survives being four pixels wide. Everything below is in service of that
    // outline; the detail on the front only exists for the driver who stops outside it.
    const trim = 'ty_church_trim', slate = [74, 78, 84];
    // ⚠ EVERY NUMBER IN ONE BLOCK, because a twin-tower front only reads if the two halves and
    // the bay between them agree about where the frontage plane is. Three separate masses land on
    // `HD` and every flat detail is placed against it; scattering those through the arm is how a
    // tower ends up a hair proud of the gable it is meant to be flush with.
    const HW = fh * 0.44, HD = fh * 0.94;         // the nave — narrow, and long back off the street
    const PLTH = h * 0.10;                        // the battered base course the whole front stands on
    const EAVE = h * 0.92;                        // where the nave wall stops…
    // ⚠ THE ARCH RISE IS SET AGAINST ITS OWN SPAN, IN WORLD UNITS, AND THAT IS NOT AUTOMATIC.
    // `fh` and `h` are independent — a footprint and a storey stack — so a rise written as a
    // fraction of `h` and a span written as a fraction of `fh` have no fixed relation at all. The
    // first cut spent `h * 0.62` over a half-span of `fh * 0.45`, which on a two-storey tile is a
    // rise half again its own half-width: a lancet spike over a parish church, and the single
    // thing that made the whole front read wrong. At `h * 0.46` the two are within a few per cent
    // of each other and the tympanum comes out round-headed, which is what the reference is.
    const ARCH = h * 0.46;                        // …and the barrel over it. Its FRONT tympanum is the great arch
    const TWHW = fh * 0.26, TWX = fh * 0.71;      // the towers: the pair spans 0.97 of the footprint
    const TWY = HD - TWHW;                        // …front faces flush with the nave front, which is what makes it one facade
    const SHAFT = h * 1.26, BELF0 = h * 1.32;     // the shaft, and the corbel course the belfry stands on
    const BELF1 = h * 1.70, CORN = h * 1.80, CAP = h * 1.96;
    // 1) THE BASE COURSE, then the nave and the barrel vault over it. The tympanum that barrel
    //    presents to the street IS the great arch of the front — the one shape every opening on
    //    this building has in common with every other. `hl` is a hair wider than the wall so the
    //    roof reads as coping rather than as the same stone carrying on upward.
    draw3DBoxAt(ctx, cam, dx, dy, HW * 1.10, 0, PLTH, trim, seed, night, alpha, false, faceYaw(E), HD * 1.04);
    draw3DBoxAt(ctx, cam, dx, dy, HW, PLTH, EAVE, pal, seed + 1, night, alpha, false, faceYaw(E), HD);
    drawBarrelRoof(ctx, cam, F, 0, HW * 1.02, HD, EAVE, ARCH, 16, alpha, slate);
    // 2) THE TOWERS. Square, so no yaw: `draw3DBoxAt` only needs `faceYaw(E)` when the two half
    //    extents differ, and a square box handed one rotates about its own centre for nothing.
    //
    // ⚠ THE BELFRY STAGE IS STONE AND THE OPENINGS ARE PAINTED ON IT — it was a near-black box,
    // and that is the other half of the flue problem. A belfry is open, and there is no primitive
    // here that leaves a face out of a solid, so the obvious move is to draw the stage in the
    // dark this file uses for an interior and stand piers in front of it. What that actually
    // produces is a black slab occupying the top third of a tall thin tower with four thin ribs
    // over it, which is a chimney with a soot stain. The stage is the wall's own stone now and
    // the openings are arched holes cut into it (§3c), which is both what the reference is and
    // the cheaper of the two.
    for (const s of [-1, 1]) {
      const [tx, ty] = F(s * TWX, TWY);
      draw3DBoxAt(ctx, cam, tx, ty, TWHW, 0, SHAFT, pal, seed + 10 + s, night, alpha, false);                // the shaft
      draw3DBoxAt(ctx, cam, tx, ty, TWHW * 1.07, SHAFT, BELF0, trim, seed + 12 + s, night, alpha, false);     // the corbel course under the belfry
      draw3DBoxAt(ctx, cam, tx, ty, TWHW * 0.96, BELF0, BELF1, pal, seed + 14 + s, night, alpha, false);      // the belfry stage
      // The corner buttresses. They carry the cornice, and they are what keeps a belfry's
      // silhouette from being a plain box with holes in it on the two flanks nobody details.
      for (const ux of [-1, 1]) for (const uy of [-1, 1]) {
        const [qx, qy] = F(s * TWX + ux * TWHW * 0.80, TWY + uy * TWHW * 0.80);
        draw3DBoxAt(ctx, cam, qx, qy, TWHW * 0.24, BELF0, BELF1, trim, seed + 16 + ux + uy * 2 + s, night, alpha, false);
      }
      draw3DBoxAt(ctx, cam, tx, ty, TWHW * 1.18, BELF1, CORN, trim, seed + 24 + s, night, alpha, false);      // the corbelled cornice
      // The cap: four merlons with the embrasures between them. It is the CRENELLATION that stops
      // a pair of towers reading as chimneys — a flat lid at this scale is exactly what a flue has.
      for (const ux of [-1, 1]) for (const uy of [-1, 1]) {
        const [qx, qy] = F(s * TWX + ux * TWHW * 0.78, TWY + uy * TWHW * 0.78);
        draw3DBoxAt(ctx, cam, qx, qy, TWHW * 0.32, CORN, CAP, trim, seed + 26 + ux + uy * 2 + s, night, alpha, true);
      }
    }
    // 3) THE FRONT. Everything from here is flat work in the plane of a wall, which is what puts
    //    it in the per-model mesh: a church's arches are the church, they are a property of the
    //    BUILDING rather than of the tile, so they have one answer at capture time and are
    //    uploaded once. `frontVis` is the same gate sixty other arms use, and the mesh capture
    //    runs with the front toward its stub camera, so the detail is captured on every facing.
    if (frontVis) {
      const trimCss = (k) => shadeOf(trim, k);
      const dark = night ? 'rgb(10,11,14)' : 'rgb(20,22,26)';
      // The world direction of a model-local one, taken from `F` itself rather than re-derived
      // off `E`. There is no second expression of the rotation to get the sign wrong in.
      const [o0, o1] = F(0, 0);
      const nOf = (nx, ny) => { const [px, py] = F(nx, ny); return [px - o0, py - o1]; };
      // ⚠ A QUAD'S NORMAL IS ITS WINDING, AND THESE OPENINGS SIT IN THREE DIFFERENT PLANES.
      // `emitFlat` takes the mesh normal off the polygon itself (Newell) and never flips it, so a
      // ring wound for the frontage claims a +y normal wherever it is put — INTO the tower on a
      // flank, where GLASS 2 then shades it as a face turned away from the light. Hand each one
      // the direction it is meant to face and let one function fix the winding: this is the sign
      // argument `derivedKit`'s pier rank lost twice before it was solved rather than reasoned
      // through, and it is safe in the LOCAL frame because `F` is a rotation about z.
      const facing = (pts, nx, ny) => {
        let ax = 0, ay = 0;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          ax += (a[1] - b[1]) * (a[2] + b[2]);
          ay += (a[2] - b[2]) * (a[0] + b[0]);
        }
        return (ax * nx + ay * ny) >= 0 ? pts : pts.slice().reverse();
      };
      // -- WHERE A LAYER PHYSICALLY SITS ---------------------------------------
      //
      // ⚠ A LIFT IS A SORT BIAS AND THE MESH THROWS IT AWAY, WHICH IS THE GREY WASH THIS
      // FRONTAGE WAS REPORTED FOR. `emitFlat` records the polygon, its colour and its normal
      // into the per-model mesh and nothing else — `opts.lift` reorders the 2-D painter's queue
      // and never reaches the GPU. So five nested FILLED polygons all put at one `FACE_EPS` (two
      // orders of arch, the dark reveal, the leaf, and the ironwork on it) arrive at the depth
      // buffer EXACTLY COPLANAR, and which of them owns a pixel is decided in the last bits of
      // the interpolated depth: the grey outer order breaks through the door in fan-shaped
      // slivers radiating from the arch's own fan pivot. `FACE_EPS`'s own note names the failure
      // — "a panel lying exactly in the plane of the wall behind it z-fights into a stipple" —
      // and this arm stacks five of them where the city's next-deepest stack is four.
      //
      // ⚠ AND THE STAND-OFF IS DERIVED FROM THE SAME LIFT rather than authored beside it. Two
      // orderings is two chances to disagree, and they disagree silently: the 2-D painter would
      // go on drawing the picture it always drew while the GPU drew a different one. Half a
      // `FACE_EPS` per layer of lift — enough that no depth format has to choose out past the
      // range this detail is legible at, and small enough that the deepest layer (a strap hinge,
      // at 3.5) still reads as ironwork on a door rather than as ironwork in front of one.
      //
      // ⚠ THE ORDER IS OUTERMOST-BACK, which is the painter's order read as geometry rather than
      // a physical claim about a portal. `arched` FILLS its shape, so an outer order set proud of
      // the leaf it surrounds would simply cover it; nearer-with-lift is the only stacking that
      // keeps the 2-D picture, and it comes out reading as a reveal standing off the wall.
      const LIFT_LAYER = 0.06;                                   // the lift increment one layer is worth
      const standOff = (lift) => FACE_EPS * (1 + (lift / DETAIL_LIFT - 1) / LIFT_LAYER * 0.5);
      // A round-headed opening on a wall: `O` is a point in that wall, `A` the direction across
      // it and `N` its outward normal, all model-local. The head is a real semicircle rather
      // than a stack of quads, because an arch is the whole vocabulary of this building and a
      // stepped one reads as a mistake at every distance. Fourteen segments: this is the part of
      // the model a driver stops in front of, and a curve is where the faces are worth spending.
      // On the GL path these flats are already in the mesh and emitFlat would drop every one
      // (FLAT_OFF, solid rgb fills, no `paint`), so skip building and projecting them at all.
      const flatsDropped = FLAT_OFF && !MESH_SINK && !SHAPE_SINK;
      const arched = (O, A, N, cu, hwd, z0, z1, fill, lift) => {
        if (flatsDropped) return;
        const zs = z1 - hwd, P = [], eps = standOff(lift);
        const put = (u, z) => P.push([O[0] + (cu + u) * A[0] + N[0] * eps,
                                      O[1] + (cu + u) * A[1] + N[1] * eps, z]);
        put(-hwd, zs);
        for (let i = 1; i < 14; i++) { const t = Math.PI - i / 14 * Math.PI; put(Math.cos(t) * hwd, zs + Math.sin(t) * hwd); }
        put(hwd, zs); put(hwd, z0); put(-hwd, z0);
        emitFlat(ctx, cam, facing(P, N[0], N[1]).map(([x, y, z]) => W3(x, y, z)), fill, alpha,
          { lift, cullN: nOf(N[0], N[1]) });
      };
      // A straight panel on the same wall, in the same frame: a door stile, a strap hinge, a
      // mullion. `arched` answers for an opening and this answers for the joinery and the
      // ironwork inside one, and both take their winding from the same `facing` so neither can
      // end up shaded as a face turned into the building.
      const panel = (O, A, N, u0, u1, z0, z1, fill, lift) => {
        if (flatsDropped) return;
        const eps = standOff(lift);
        const put = (u, z) => [O[0] + u * A[0] + N[0] * eps, O[1] + u * A[1] + N[1] * eps, z];
        emitFlat(ctx, cam, facing([put(u0, z1), put(u1, z1), put(u1, z0), put(u0, z0)], N[0], N[1])
          .map(([x, y, z]) => W3(x, y, z)), fill, alpha, { lift, cullN: nOf(N[0], N[1]) });
      };
      // -- A CHAMBER BEHIND AN OPENING ----------------------------------------
      //
      // ⚠ THE BELFRY IS SUPPOSED TO BE OPEN, AND THERE IS NO PRIMITIVE HERE THAT LEAVES A FACE
      // OUT OF A SOLID. §2 records what happens when you try it with boxes: a black slab with
      // four thin ribs over it, which is a chimney with a soot stain. What there is instead is
      // `slideToPlane` — a point slid along its OWN eye ray projects to the same pixel wherever
      // on that ray it sits — so the back wall of the chamber is solved every frame at the LIVE
      // eye and handed over lying in the plane of the tower's own face. The parallax is real and
      // moves as you drive past; the depth buffer only ever sees a flat quad in a wall, so
      // nothing stands in front of anything and there is no bake and no upload.
      //
      // ⚠ IT IS A DECAL AND NOT MESH, AND THAT IS FORCED RATHER THAN CHOSEN. The solve reads the
      // camera, and `emitFlat` records into the per-model mesh, which is captured ONCE at a stub
      // camera and shared by every tile — so a chamber captured that way would be nailed to one
      // eye position for the life of the process. During either capture there is no eye to solve
      // against, `slideToPlane` answers null, and this draws nothing at all, which is correct.
      //
      // ⚠ AND THE LAYERS ARE STAGGERED, for `emitRecessBay`'s own reason: collapsing them onto one
      // plane collapses the painter's order with them, and the back wall has to be covered by the
      // jambs while the bell has to be covered by neither.
      //
      // ⚠ AND THE PLANE IT IS SOLVED ONTO IS THE BACKSTOP'S, NOT THE TOWER'S. It used to be the
      // tower face (`y` measured from 0), which was the same plane the flat dark arch behind it
      // sat in back when every layer took one `FACE_EPS` — so the chamber's own decal pulls were
      // all that separated the two. `standOff` now stands that backstop three and a half of them
      // proud, and a chamber still solved onto the raw face would be BEHIND the very quad it is
      // drawn to replace: the bell and the jambs vanish and the opening goes flat, which is the
      // bug this whole helper exists to fix arriving by the other door. It takes the backstop's
      // own lift, so the two cannot be moved apart by accident.
      const recess = (O, A, N, cu, hwd, z0, z1, depth, lift) => {
        const e0 = standOff(lift);
        const L = (u, y, z) => W3(O[0] + (cu + u) * A[0] + N[0] * (e0 + y), O[1] + (cu + u) * A[1] + N[1] * (e0 + y), z);
        let [nx, ny] = nOf(N[0], N[1]);
        const nl = Math.hypot(nx, ny); if (!(nl > 1e-6)) return;
        nx /= nl; ny /= nl;
        const AW = L(0, 0, z0), NW = [nx, ny];
        // ⚠ A WALL TURNED AWAY HAS NO CHAMBER TO SHOW, and it is the FAR flank of each tower that
        // says so loudest: its opening is on the other side of the stone, so everything solved
        // into it is geometry the tower is standing in front of. The depth buffer would hide it
        // and the 2-D fallback would not, which is the whole reason this is a test here rather
        // than a thing left to the renderer. It also guarantees the solve below is well behaved:
        // with the eye off the plane, `t` comes back in (0, 1) for every corner of a chamber.
        if (((cam.ex || 0) - AW[0]) * nx + ((cam.ey || 0) - AW[1]) * ny <= 0) return;
        const zs = z1 - hwd, iw = hwd * 0.84;
        // THE APERTURE — the hole this chamber is seen through, in the plane's own `[u, z]` frame
        // and wound counter-clockwise for `clipToAperture`: the sill, the two jambs, and the
        // semicircular head over them. It is the opening `arched` cuts, to the number.
        const AP = [[-hwd, z0], [hwd, z0], [hwd, zs]];
        for (let i = 1; i < 12; i++) { const t = i / 12 * Math.PI; AP.push([Math.cos(t) * hwd, zs + Math.sin(t) * hwd]); }
        AP.push([-hwd, zs]);
        // The plane's across-direction, taken from `L` itself so there is no second expression of
        // the rotation to get the sign wrong in — the same argument `nOf` makes one line up.
        const A1 = L(1, 0, z0);
        let ax = A1[0] - AW[0], ay = A1[1] - AW[1];
        const al = Math.hypot(ax, ay); if (!(al > 1e-6)) return;
        ax /= al; ay /= al;
        // Slide each corner onto the wall, clip what comes back to the hole, and hand the survivors
        // back as world points. `null` means the wall covers the whole of it, which is an answer.
        const cut = (pts) => {
          const pl = [];
          for (const pt of pts) {
            const s = slideToPlane(cam, AW, NW, pt);
            if (!s) return null;
            pl.push([(s[0] - AW[0]) * ax + (s[1] - AW[1]) * ay, s[2]]);
          }
          const c = clipToAperture(pl, AP);
          return c.length >= 3 ? c.map((p) => [AW[0] + ax * p[0], AW[1] + ay * p[0], p[1]]) : null;
        };
        const arch = (rr, y) => {
          const o = [[-rr, y, zs]];
          for (let i = 1; i < 12; i++) { const t = Math.PI - i / 12 * Math.PI; o.push([Math.cos(t) * rr, y, zs + Math.sin(t) * rr]); }
          o.push([rr, y, zs], [rr, y, z0], [-rr, y, z0]);
          return o.map(([u, yy, z]) => L(u, yy, z));
        };
        // ⚠ EVERY LAYER STANDS OR FALLS ON ITS OWN. The back wall used to gate the rest of the
        // chamber, which was right when the only way to fail was the solve failing; a clip fails
        // one layer at a time, and at a grazing angle the back wall is the FIRST thing the jamb
        // in front of it hides. Bail on it and the jamb you are looking straight at goes with it.
        const back = cut(arch(iw, -depth));
        if (back) emitDecoFill(ctx, cam, back, night ? 'rgb(6,7,9)' : 'rgb(15,17,21)', alpha, 0.006, 'churchbay');
        for (const sg of [-1, 1]) {
          const j = cut([L(sg * hwd, 0, z0), L(sg * hwd, 0, zs), L(sg * iw, -depth, zs), L(sg * iw, -depth, z0)]);
          if (j) emitDecoFill(ctx, cam, j, trimCss(night ? 0.34 : 0.54), alpha, 0.012, 'churchbay');
        }
        const sl = cut([L(-hwd, 0, z0), L(hwd, 0, z0), L(iw, -depth, z0), L(-iw, -depth, z0)]);
        if (sl) emitDecoFill(ctx, cam, sl, trimCss(night ? 0.42 : 0.68), alpha, 0.018, 'churchbay');
        // And the thing the chamber is FOR. A bell is the only reason anybody would ever want to
        // see the inside of a tower, and at this range it is a waisted trapezoid.
        const bw = hwd * 0.50, bz0 = z0 + (zs - z0) * 0.26, bz1 = zs + hwd * 0.26, by = -depth * 0.55;
        const bl = cut([L(-bw * 0.40, by, bz1), L(bw * 0.40, by, bz1), L(bw, by, bz0), L(-bw, by, bz0)]);
        if (bl) emitDecoFill(ctx, cam, bl, night ? 'rgb(32,30,25)' : 'rgb(80,72,52)', alpha, 0.024, 'churchbay');
      };
      // -- AND THE COLOUR -----------------------------------------------------
      //
      // Stained glass seen from the OUTSIDE is not the thing photographs of stained glass are:
      // with nothing burning behind it, coloured glass is a DARK panel that happens to be blue.
      // `glassCss` is what carries that — near full value in daylight against grey granite, a
      // fifth of it after dark — and it is what stops the one rule this building has (§3e: the
      // plate is what is lit, and nothing else) from quietly becoming untrue the moment somebody
      // wanted colour in the windows.
      //
      // ⚠ AND IT IS MOSTLY TWO COLOURS, WHICH IS THE DIFFERENCE BETWEEN A ROSE AND A DARTBOARD.
      // The first cut was five evenly-spaced hues at even weight, one to a light, and twelve
      // lights of it came out as a colour wheel — every pane a different colour from both its
      // neighbours is a pinwheel, and it was the one thing on the frontage you looked at instead
      // of the eye. A real rose is deep blue and deep red with gold and green as the occasional
      // accent, so the list is WEIGHTED rather than enumerated: blue and red carry it, and the
      // other two turn up about a quarter of the time. The length is coprime with nothing on
      // purpose — 8 against 12 lights gives a pattern that does not close, which is what keeps it
      // from reading as a repeat.
      //
      // ⚠ AND THE VALUES ARE LOW BECAUSE THE SHADER RAISES THEM. GLASS 2 lights and tonemaps a
      // flat quad like any other surface, so a colour picked to look right as a swatch arrives on
      // the wall a good deal paler than it was authored: the first set measured as pastel on the
      // building while looking like real glass in the source.
      const GLASS = ['30,50,98', '88,26,30', '32,54,104', '106,82,28',
                     '26,44,88', '84,24,28', '28,56,44', '90,28,32'];
      const glassCss = (i) => {
        const g = GLASS[((i % GLASS.length) + GLASS.length) % GLASS.length].split(',').map(Number), d = night ? 0.20 : 1;
        return 'rgb(' + Math.round(g[0] * d) + ',' + Math.round(g[1] * d) + ',' + Math.round(g[2] * d) + ')';
      };
      const timber = night ? 'rgb(28,21,16)' : 'rgb(62,45,32)';
      const iron = night ? 'rgb(18,19,22)' : 'rgb(34,36,40)';
      const FRONT = [[0, HD], [1, 0], [0, 1]];   // the frontage: origin, across, outward
      // 3a) THE THREE PORTALS — the big one in the centre bay, one under each tower.
      //
      //     ⚠ THE DOOR IS SOLID TO ITS OWN ARCH, AND WHAT WAS THERE BEFORE READ AS A FANLIGHT.
      //     This used to be a dark arch with nothing in it, and the derived kit then ran a bay of
      //     glazing across the frontage over the head of every one of them — so each portal came
      //     out as a shop door with a window above it, which is the one shape a church door is
      //     not. A parish door is a pair of timber leaves carried to the springing of its own
      //     arch and hung on straps that cross most of the leaf, and it has nothing over it
      //     because the light in this wall is the wheel window forty feet up. The kit's glazing
      //     section is declined for this building now (see `KIT_DECLINE`); this is the other half.
      //
      //     Two orders of arch rather than one: an order is arches standing a little proud of
      //     each other, and at one of them it is a rim round a hole.
      for (const [cx, hwd, top] of [[0, HW * 0.40, PLTH + h * 0.50],
                                    [-TWX, TWHW * 0.52, PLTH + h * 0.38],
                                    [TWX, TWHW * 0.52, PLTH + h * 0.38]]) {
        const [O, A, N] = FRONT;
        arched(O, A, N, cx, hwd * 1.34, PLTH, top + hwd * 0.42, trimCss(1.14), DETAIL_LIFT * 1.00);
        arched(O, A, N, cx, hwd * 1.15, PLTH, top + hwd * 0.20, trimCss(0.86), DETAIL_LIFT * 1.06);
        arched(O, A, N, cx, hwd, PLTH, top, dark, DETAIL_LIFT * 1.12);
        // The leaves, set inside the reveal, so a hair of dark shows round them the way a door
        // hung in a stone opening always does.
        const lw = hwd * 0.92, lz = top - hwd * 0.07, zs = lz - lw;
        arched(O, A, N, cx, lw, PLTH, lz, timber, DETAIL_LIFT * 1.18);
        panel(O, A, N, cx - lw * 0.035, cx + lw * 0.035, PLTH, lz, iron, DETAIL_LIFT * 1.24);   // the meeting stile
        // Three strap hinges a leaf, off each jamb and well across the timber. They are what
        // makes a door read as a DOOR at the range a truck passes it: a plain dark arch is a
        // hole, and a pair of bars across it is hardware.
        for (const f of [0.17, 0.52, 0.85]) {
          const bz = PLTH + (zs - PLTH) * f, bh = hwd * 0.045;
          for (const sg of [-1, 1]) {
            panel(O, A, N, cx + sg * lw * 0.94, cx + sg * lw * 0.12, bz - bh, bz + bh, iron, DETAIL_LIFT * 1.30);
          }
        }
      }
      // 3b) THE BLIND ARCADE. A corbel table under the eaves — the row of little arches that is
      //     the single most Romanesque thing a wall can do, and the detail that tells a stone
      //     front from a rendered one at the range a truck passes it.
      { const n = 9, w = HW * 1.88 / n;
        for (let i = 0; i < n; i++) {
          arched(FRONT[0], FRONT[1], FRONT[2], -HW * 0.94 + w * (i + 0.5), w * 0.38,
            EAVE - h * 0.15, EAVE - h * 0.03, trimCss(0.60), DETAIL_LIFT * 1.05);
        } }
      // 3b2) THE NAVE LIGHTS — four lancets a flank, and the only colour on the building.
      //
      //      ⚠ THE NAVE HAD NOTHING ON ITS SIDES AT ALL, AND THAT IS WHAT THE KIT WAS COVERING.
      //      Declining `wall` takes the shop glazing off the front and takes the window grid off
      //      the flanks with it, and a hundred-foot masonry wall with no openings is a retaining
      //      wall rather than a nave. What belongs there is not a grid — a church is lit down one
      //      side by a row of tall narrow lights at one pitch, and the pitch is the bay, which is
      //      the same bay the blind arcade above the doors is divided at.
      //
      //      ⚠ AND THE COLOUR GOES HERE RATHER THAN OVER THE DOOR. Every window on this building
      //      is glazed the same way and none of them is lit; §3e's rule is about what BURNS, and
      //      coloured glass with nothing behind it burns nothing. See `glassCss`.
      { const s0 = PLTH + (EAVE - PLTH) * 0.30, s1 = PLTH + (EAVE - PLTH) * 0.84, lw = HD * 0.082;
        for (const sd of [-1, 1]) {
          const O = [sd * HW, 0], A = [0, sd], N = [sd, 0];
          for (let i = 0; i < 4; i++) {
            const cu = sd * (-HD * 0.60 + i * HD * 0.40);
            arched(O, A, N, cu, lw * 1.32, s0 - h * 0.025, s1 + lw * 0.36, trimCss(1.10), DETAIL_LIFT * 1.05);
            arched(O, A, N, cu, lw, s0, s1, dark, DETAIL_LIFT * 1.15);
            arched(O, A, N, cu, lw * 0.80, s0 + lw * 0.16, s1 - lw * 0.10, glassCss(i + (sd > 0 ? 0 : 2)), DETAIL_LIFT * 1.22);
            // The mullion. One bar down the middle is what makes a lancet read as glazed rather
            // than as a coloured slot, and it is the cheapest quad on the building.
            panel(O, A, N, cu - lw * 0.055, cu + lw * 0.055, s0 + lw * 0.16, s1 - lw * 0.10, trimCss(0.72), DETAIL_LIFT * 1.28);
          }
        }
      }
      // 3c) THE BELFRY LIGHTS — the pair of round-headed openings the stage exists for, cut into
      //     the front and both flanks of each tower. The back gets none: nothing looks at it, and
      //     a quad is a quad.
      for (const s of [-1, 1]) {
        const CX = s * TWX, W2 = TWHW * 0.96;
        for (const [O, A, N] of [[[CX, TWY + W2], [1, 0], [0, 1]],
                                 [[CX + W2, TWY], [0, 1], [1, 0]],
                                 [[CX - W2, TWY], [0, -1], [-1, 0]]]) {
          for (const u of [-1, 1]) {
            const cu = u * TWHW * 0.34, bz0 = BELF0 + h * 0.08, bz1 = BELF1 - h * 0.11;
            arched(O, A, N, cu, TWHW * 0.28, BELF0 + h * 0.06, BELF1 - h * 0.08, trimCss(1.10), DETAIL_LIFT * 1.2);
            arched(O, A, N, cu, TWHW * 0.21, bz0, bz1, dark, DETAIL_LIFT * 1.3);
            // …and what is behind them. The flat dark arch is still emitted and is still the
            // backstop: it is mesh, so it is what a distant tile and the 2-D fallback get, and
            // the chamber is drawn over it only when there is a live eye to solve against.
            recess(O, A, N, cu, TWHW * 0.21, bz0, bz1, TWHW * 0.62, DETAIL_LIFT * 1.3);
          }
        }
      }
      // 3d) THE WHEEL WINDOW AND THE EYE OVER IT — ONE CENTRE AND ONE RADIUS, READ TWICE.
      //     The plate is glazed over the window rather than standing beside it, so the two are
      //     the same circle and must stay the same circle: written as two literals they would
      //     drift the first time either was nudged, and a plate a few per cent off its window
      //     reads as a mistake rather than as a covering. One pair of constants, two readers.
      const ROSE_Z = EAVE + ARCH * 0.16, ROSE_R = fh * 0.21;
      //     The wheel goes on the wall, unlit, always: see the ⚠ on `wallRose`. It is emitted
      //     BEFORE the eye and that ordering is load-bearing — the mass pass blends premultiplied
      //     with depth writes on, so back to front is what composites the plate over the tracery.
      //     Emit the eye first and it writes its own depth across the window, the wheel fails
      //     `LEQUAL` at every pixel, and the glass goes opaque with nothing to say why.
      { const [rx, ry] = F(0, HD + FACE_EPS); wallRose(ctx, cam, rx, ry, E, ROSE_Z, ROSE_R, '196,200,208', night, alpha, 12, GLASS); }
      // 3e) THE EYE. It is the one thing on this building anybody screwed on, and the one thing on
      //     it that is lit after dark while the church under it is not.
      //
      //     ⚠ IT WAS A `drawRing`, WHICH IS A HORIZONTAL HOOP AND NOT A CIRCLE ON A WALL. That
      //     helper varies x and y at a fixed z — it is for a band round a tank or a tower — so the
      //     eye was a small hoop standing out of the facade, projecting as a thin ellipse you
      //     could see the stone through. The rose window above it had the same problem and now has
      //     its own shape, which is the thing that note said it wanted.
      //
      //     ⚠ AND IT IS GLAZED OVER THE WINDOW RATHER THAN BOLTED BESIDE IT. It used to sit on
      //     the string course below, oversized, clipping the door head and the window sill — a
      //     steel plate screwed across somebody else's stonework. Covering the wheel exactly and
      //     letting it read through is the same story told better: what the order did here was
      //     not hang a sign on the building, it put its mark where the saint was and left the
      //     tracery showing behind it. Nothing anywhere remarks on that either.
      //
      //     ⚠ AND THE STAND-OFF IS THE SMALLEST ONE THAT CLEARS THE WHEEL, NOT A COMFORTABLE
      //     ONE. It was `fh * 0.10`, chosen on the reasoning that the two stacks must not
      //     interleave — which is true, and is satisfied four times over by `FACE_EPS * 4`.
      //     What the comfortable number actually bought was PARALLAX: the plate is half the
      //     wheel's own radius in front of the wheel, so seen from anywhere but straight on it
      //     slides sideways off the window it is supposed to be glazed over, and from a truck
      //     coming down the street it left the facade altogether and hung in the air beside the
      //     building. Reported exactly that way, with a screenshot of an eye floating off its
      //     own wall.
      //
      //     `wallRose` staggers its field, rim, spokes and hub by `FACE_EPS` each, so its
      //     furthest-forward face is at `HD + FACE_EPS * 3` and the plate's own back face —
      //     `emblemSlab` builds forward from the anchor — clears it by one more. Nothing
      //     interleaves, and the two circles stay concentric from every seat.
      { const [ex, ey] = F(0, HD + FACE_EPS * 4);
        wallDisc(ctx, cam, ex, ey, E, ROSE_Z, ROSE_R, '176,196,220', night, alpha,
          { lens: true, pupil: 0.15, iris: 0.34, depth: 0.06, opacity: 0.40, markOpacity: 0.94 }); }
    }
  },
  butcher(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Meat Your Maker: a squat oxblood shopfront under a striped awning, and the smokehouse flue that gives it away from the air
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, h * 0.62, pal, seed, night, alpha, true);              // single-storey shop
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, h * 0.62, h * 0.7, pal, seed + 1, night, alpha, false);    // flat roof with a lipped parapet
    awning(ctx, cam, dx, dy, E, fh * 1.02, fh * 1.05, h * 0.16, h * 0.3, 'ty_door', seed + 2, night, alpha, fh * 0.30);   // awning over the window
    // THE SIGNATURE. Everything above is a low shop and reads like fifty other
    // low shops; the flue is the one thing that says what is happening inside.
    { const [sx, sy] = F(-fh * 0.55, -fh * 0.5); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.16, h * 0.62, h * 1.24, pal, seed + 3, night, alpha, false); }   // smokehouse flue
    { const [cx, cy] = F(-fh * 0.55, -fh * 0.5); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.24, h * 1.24, h * 1.32, 'ty_door', seed + 4, night, alpha, false); }   // rain cap
    { const [px, py] = F(-fh * 0.55, -fh * 0.5); glowPool(ctx, cam, px, py, h * 1.42, '150,150,158', 13, alpha * (night ? 0.2 : 0.3)); }   // the thread of smoke off the cap, heavier by day when it reads against sky
    neonBlade(ctx, cam, dx, dy, h * 0.58, h * 0.88, m.neon || '#ff3e4a', night, alpha);
    if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, h * 0.24, '255,120,110', 12, alpha * 0.26); }   // the case lights through the window, red on red
  },
  techstall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ohm Sweet Ohm: a two-storey electronics shop wedged under an overpass girder, strung with cyan tech-glow
    // ⚠ THIS WAS A KIOSK AND IT READ AS ONE. The first cut was a half-height stall box (0 … 0.5),
    // two thin piers carrying on to 1.5, and a girder deck above — which left a FULL TILE of open
    // air between the top of the shop and the only other thing on the tile, crossed by two sticks
    // 0.048 wide. From the street that is not a building with an overpass over it, it is three
    // objects sharing a tile. The derived kit could do nothing about it either: the kit dresses
    // mass and never adds any (detail must never reach SHAPE_SINK, or a downpipe joins CFIT
    // collision), so a half-height shop keeps a half-height shop's silhouette however much trim
    // it is handed.
    //
    // So the SHOP becomes a building — ground floor, cornice, upper floor, plant box — and the
    // overpass stays, because it is what makes this corner worth looking at. The piers move OUT
    // past the flanks so the shop stands between them rather than inside them: at fh 0.4 the shop
    // spans ±0.368 and a pier 0.408 … 0.488, so they never touch, and the gap either side is what
    // reads as "tucked under".
    const techFront = facePals(E, { side: pal, front: 'ty_shop_b' });
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, h * 0.44, techFront, seed, night, alpha, false);      // shopfront storey, glazing to the street
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.44, h * 0.50, pal, seed + 1, night, alpha, false); // the cornice that separates the two floors
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, h * 0.50, h * 0.96, pal, seed + 3, night, alpha, false); // workshop floor, set back off the shopfront
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.66, h * 0.96, h * 1.06, pal, seed + 4, night, alpha, true);  // roof plant box — and the deck the kit stands its plant on
    for (const s of [-1, 1]) { const [sx, sy] = F(s * fh * 1.12, -fh * 0.1); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.1, 0, h * 1.5, pal, seed + 6 + s, night, alpha, false); }   // overpass piers, clear of the shop
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.4, h * 1.5, h * 1.68, pal, seed + 5, night, alpha, true);    // the girder deck overhead
    neonBlade(ctx, cam, dx, dy, h * 0.44, h * 1.02, m.neon || '#5fd0ff', night, alpha);               // full-height blade up the corner
    glowPool(ctx, cam, dx, dy, h * 0.3, '95,208,255', 12, alpha * (night ? 0.4 : 0.22));              // cyan gear-glow spilling off the counter
  },
  showroom(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Dead Space Interiors: a glazed showroom floor with a big lit display window
    // A glazed showroom drawn as one extrusion with a thin band on top, so the "big lit display
    // window" the comment promises was just the bottom of a wall. A showroom is a tall glazed
    // ground floor with a solid building over it; the change of plane at the head of the glass is
    // the whole look.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, 0, h * 0.44, facePals(E, { side: pal, front: 'ty_shop_c' }), seed, night, alpha, false);   // the glazed showroom floor
    { const [wx4, wy4] = F(0, fh * 0.92); glowPool(ctx, cam, wx4, wy4, h * 0.26, '150,220,190', 20, alpha * (night ? 0.42 : 0.24)); }   // display-window glow
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, h * 0.44, h * 0.50, pal, seed + 2, night, alpha, false);   // fascia at the head of the glass
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.50, h * 0.80, pal, seed + 3, night, alpha, false);   // the solid floor above it
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.66, h * 0.80, h * 0.92, pal, seed + 1, night, alpha, true);    // slim parapet band
    { const [bx, by] = F(0, fh * 1.16); neonBlade(ctx, cam, bx, by, h * 0.92, h * 1.2, m.neon || '#7dff6a', night, alpha); }
  },
  boutique(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Second Skin: a narrow tall shopfront with a full-height neon fashion blade + warm display glow
    // ⚠ A SINGLE BOX 0 … 0.98 WEARING A BLADE. The comment called it "narrow tall shopfront" and
    // the mass was one extrusion, so there was no shopfront — nothing separated the glazed ground
    // floor from the storeys over it, which is the one line every real shop street has. Second
    // Skin is the only building on this arm, and it is a boutique: the whole point is that the
    // display window is a different thing from the building above it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, 0, h * 0.34, facePals(E, { side: pal, front: 'ty_shop_c' }), seed, night, alpha, false);   // the display window
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.88, h * 0.34, h * 0.39, pal, seed + 1, night, alpha, false);   // the fascia over it — where a shop's name goes
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, h * 0.39, h * 0.94, pal, seed + 2, night, alpha, false);   // the floors above, set back off the shopfront
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, h * 0.94, h * 1.02, pal, seed + 3, night, alpha, true);     // parapet cap
    // The blade hangs off the SHOPFRONT face rather than out of the middle of the mass. It was
    // anchored at 0.5 when the building was one box; with a shopfront, a fascia, a setback and a
    // cap it had four things to be inside instead of one, and glself counted it (decal:blade 33
    // to 37). neonBlade pulls its anchor proud by BLADE_PROUD, so starting it outside the facade
    // is the difference between a sign bolted to a wall and one being dragged through it.
    { const [nx, ny] = F(fh * 0.58, fh * 0.86); neonBlade(ctx, cam, nx, ny, h * 0.28, h * 1.05, m.neon || '#ff4a9a', night, alpha); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.22, '255,150,200', 10, alpha * 0.28);                 // lit boutique window
  },
  nightclub(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Voltage: a sleek near-black monolith split by a floor-to-roof blue-white name-arc, chasing crown bulbs, laser-blue wash
    const neon = m.neon || '#5cd6ff';
    const crown2 = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, 0, h * 1.05, pal, seed, night, alpha, false);             // tall near-black slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, h * 1.05, h * 1.2, crown2, seed + 1, night, alpha, true);  // parapet crown band
    // A windowless slab needs SOMETHING at the bottom, or the wall just runs into the pavement.
    // A club's answer is the entrance box and the rail outside it — where the queue stands.
    { const [ex2, ey2] = F(0, fh * 1.02);
      draw3DBoxAt(ctx, cam, ex2, ey2, fh * 0.38, 0, h * 0.3, crown2, seed + 12, night, alpha, true, 0, fh * 0.18); }
    // The plant deck, set back on the roof behind the crown — the one thing a flat-topped
    // monolith can have that changes its outline against the sky.
    { const [rx2, ry2] = F(fh * 0.36, -fh * 0.3);
      draw3DBoxAt(ctx, cam, rx2, ry2, fh * 0.3, h * 1.2, h * 1.34, crown2, seed + 13, night, alpha, true); }
    { const [ax, ay] = F(0, fh * 0.98); neonBlade(ctx, cam, ax, ay, 0, h * 1.2, neon, night, alpha); } // the signature: the name struck floor-to-roof up the frontage like a live power line
    for (const s of [-0.62, -0.2, 0.2, 0.62]) { const [lx, ly] = F(s * fh, fh * 0.98); blinkLight(ctx, cam, lx, ly, h * 1.16, '92,214,255', now, seed + s * 11, alpha, 1.6); }   // chasing crown bulbs
    { const [gx, gy] = F(0, fh * 1.0); glowPool(ctx, cam, gx, gy, 0.02, '70,150,255', 18, alpha * (night ? 0.5 : 0.28)); }   // blue spill out the door
    glowPool(ctx, cam, dx, dy, h * 1.14, '92,150,255', 22, alpha * (night ? 0.42 : 0.2));              // laser-blue roofline wash
  },
  atelier(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Aurelia: a narrow tall graphite-glass couture monolith — one slim violet name-blade, a bright lit cap, a single restrained vitrine glow
    const neon = m.neon || '#b070ff';
    // ⚠ THE MONOLITH IS THE POINT AND IT STAYS A MONOLITH. The shaft still runs 0.31 … 1.12 in one
    // unbroken plane, which is four fifths of the height — what it did not have was anywhere for
    // a couture house to put its window. A vitrine is the one thing this building type is for, and
    // giving the shaft something to land on is also what stops it reading as an extruded rectangle.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, 0, h * 0.26, facePals(E, { side: pal, front: 'ty_shop_c' }), seed + 4, night, alpha, false);   // the vitrine at street level
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.84, h * 0.26, h * 0.31, pal, seed + 5, night, alpha, false);   // the reveal over it
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.74, h * 0.31, h * 1.12, pal, seed, night, alpha, false);       // slender dark-glass shaft
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.8, h * 1.12, h * 1.2, pal, seed + 1, night, alpha, true);      // slim lit parapet cap
    { const [nx, ny] = F(fh * 0.5, fh * 0.86); neonBlade(ctx, cam, nx, ny, h * 0.2, h * 1.16, neon, night, alpha); }   // slim full-height violet name-blade by the door
    if (night) { const [wx, wy] = F(0, fh * 0.72); glowPool(ctx, cam, wx, wy, h * 0.2, '176,112,255', 9, alpha * 0.22); }   // one restrained violet vitrine glow
  },
  // TERMINUS' glasshouses. The one thing the Exodus let you see over their wall, and the whole
  // reason the wall reads as a community rather than a bunker: a creed that renounces the machine
  // and refuses the city's food has to grow its own, and glass is the only part of that which is
  // taller than the wall. Low knee-walls, a long glazed barrel vault, and vent lights cracked
  // along the ridge. It GLOWS at night — grow-lamps are the one machine they forgive, which is a
  // joke you only get if you have talked to the quartermaster.
  greenhouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    const glass = [176, 198, 190];
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, h * 0.16, pal, seed, night, alpha, true);          // stone knee-wall
    drawBarrelRoof(ctx, cam, F, 0, fh * 0.92, fh * 0.72, h * 0.16, h * 0.52, 10, alpha, glass);    // the glazed vault
    // Ridge vents, cracked open. Three little boxes along the top is the whole tell.
    for (const s of [-0.5, 0, 0.5]) {
      const [vx, vy] = F(s * fh * 0.7, 0);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.1, h * 0.66, h * 0.74, 'ty_door', seed + 3 + s * 4, night, alpha, false);
    }
    // A water butt at the gable end. Self-reliance is mostly plumbing.
    { const [bx, by] = F(fh * 0.8, fh * 0.6); draw3DBoxAt(ctx, cam, bx, by, fh * 0.18, 0, h * 0.3, 'ty_door', seed + 9, night, alpha, true); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.5, '150,255,180', 14, alpha * 0.3);   // the grow-lamps
  },
  junkshop(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Velk's Pre-Owned Furnishings: cluttered main shed + lean-to + junk stacked on the roof
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, 0, h * 0.6, pal, seed, night, alpha, true);              // main shed
    { const [lx, ly] = F(fh * 0.95, 0); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.5, 0, h * 0.4, pal, seed + 1, night, alpha, true); }   // lean-to annex
    for (const s of [-0.5, 0.1, 0.6]) { const [jx, jy] = F(s * fh * 0.9, -fh * 0.2); draw3DBoxAt(ctx, cam, jx, jy, fh * 0.18, h * 0.6, h * (0.68 + frac(seed + s * 7) * 0.12), 'ty_door', seed + 10 + s * 5, night, alpha, true); }   // roof junk piles
    neonBlade(ctx, cam, dx, dy, h * 0.6, h * 0.86, m.neon || '#ff8a4a', night, alpha);
    if (night) glowPool(ctx, cam, dx, dy, h * 0.26, '255,170,110', 10, alpha * 0.2);
  },
  apartment(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // residential block — podium + tall slab, stepped roofline, rooftop water tank & lift housing
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.12, 0, h * 0.2, pal, seed + 5, night, alpha, true);          // ground-floor podium
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.2, h * 1.02, pal, seed, night, alpha, true);        // main residential slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.64, h * 1.02, h * 1.18, pal, seed + 4, night, alpha, true);   // set-back top floors → a stepped roofline
    if (m.penthouse) { const [px, py] = F(fh * 0.3, 0); draw3DBoxAt(ctx, cam, px, py, fh * 0.42, h * 1.18, h * 1.32, pal, seed + 2, night, alpha, true); }
    { const [tx, ty] = F(-fh * 0.34, -fh * 0.22); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.16, h * 1.18, h * 1.34, 'ty_door', seed + 6, night, alpha, true); }   // rooftop water tank on stilts
    { const [cx, cy] = F(fh * 0.3, fh * 0.12); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.2, h * 1.18, h * 1.25, 'ty_door', seed + 7, night, alpha, true); }         // lift/AC housing
    if (night) glowPool(ctx, cam, dx, dy, h * 0.6, '255,206,140', 10, alpha * 0.12);                   // scattered lit windows
  },
  police(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // PRECINCT 9 — and it is Precinct 9 ALONE now, whatever the old header here
    //                  said. This arm was written for "21 tiles of Coldwater (civic 18, police 2)"
    //                  and every one of those has since been given a model of its own: the twelve
    //                  tiles left carrying building_type civic or police are all NAMED, `modelFor`
    //                  prefers a name over a type, and the Paper Tomb, the Reckoning, the Creche,
    //                  the Thorn Gate and the rest each answer to their own arm. So the one tile
    //                  that reaches this switch arm is 922,911, and it can stop being a generic
    //                  civic box and be a station house. (`TYPE_MODEL.civic` and `.police` remain
    //                  as the fallback for an unnamed tile, which is why the badge is drawn HERE
    //                  rather than named in `SIGN_TRADE`, where it would reach both.)
    //
    // It had no name on it anywhere and no mark, so the only thing that said what it was, was a
    // blue lamp you cannot see by day — while the derived kit's pier rank ran six fat fins the
    // height of the frontage. That is the report: a wall of columns and nothing to read.
    const stone = pal, base = 'ty_precast_dk', attic = 'ty_precast';
    // ⚠ THE ORDER IS CUT STONE, NOT PRECAST, AND THAT IS A MATERIAL DECISION RATHER THAN A COLOUR
    // ONE. `wallTexMixed` derives the surface generator from the palette key — `ty_precast` is in
    // the `reveal` family, which paints a WINDOW GRID — so a frieze in it comes out as a storey of
    // glazing with a name floating on it. `ty_marble_col` is in `STONE_WALL`, so the columns and
    // the band they carry read as the one thing a portico has to read as.
    const order = 'ty_marble_col';
    const bz = h * 0.13, wallTop = h * 0.86, atticTop = h * 1.04;
    const colTop = h * 0.40, friezeTop = h * 0.50;   // the portico order, and the band it carries
    const sgnW = fh * 0.50, sgnZ = h * 0.45;         // …which is where the station's name is cut
    // ⚠ RESERVED UNCONDITIONALLY, NEVER INSIDE `frontVis` — see reserveSignBand. It is what keeps
    // the kit's rank off the name, and it is a fact about the building rather than about where
    // the camera is; the kit feeds MESH_SINK and `gl:mesh` holds it to one face count at all four
    // facings, so a camera-dependent exclusion would fail the gate as well as look wrong.
    reserveSignBand(sgnW, sgnZ);
    // 1) A base course a storey high, in the dark precast. This is what makes a civic building
    //    look planted rather than placed — and it is the second palette the score is asking for.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, bz, base, seed, night, alpha, false);
    // 2) The main block, set in off the base so the course reads as a plinth and not as a stripe.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, bz, wallTop, stone, seed + 1, night, alpha, false);
    // 3) A PORTICO — a projecting entrance bay under a lettered frieze, on four columns. The one
    //    shape that says "you are expected to come in through here and be seen doing it", and the
    //    reason this reads as civic rather than as an office. It stands proud of the front face,
    //    so the silhouette changes with the entrance facing instead of being a box from every
    //    angle. ⚠ THE COLUMNS STOP AT THE FRIEZE, which is the whole architectural point and also
    //    the fix: a vertical that runs past the band it carries is a vertical with nothing to
    //    carry, and it is what the kit's own rank was doing across the frontage.
    // ⚠ THE THREE DEPTHS ARE A LADDER, AND THEY WERE NOT. A portico is a back wall, columns
    //    standing PROUD of it, and an entablature overhanging THEM, and the first cut authored all
    //    three at depths that collide: the columns spanned y 1.048-1.152 against a bay wall whose
    //    front is at 1.160, so every one of them stood INSIDE the wall it is meant to carry, its
    //    front face 0.008 of a tile behind. That is sub-pixel at any range, so the depth test is a
    //    coin flip decided afresh every time the camera moves - the flashing. And the bay ran to
    //    `friezeTop`, the plane the frieze's own top is at, with its footprint wholly inside the
    //    frieze's: two coplanar roof quads, tying exactly, for the same result.
    //    The ladder now: wall front 1.13, columns 1.073-1.177 (embedded 0.057, proud 0.047),
    //    frieze front 1.20 overhanging the columns by 0.023. Nothing sits within 0.02 of anything
    //    parallel to it, and the bay stops at `colTop` so the frieze is the only thing with a top
    //    at `friezeTop`. The z bands, the palettes and the reserved sign band are unchanged.
    { const [px0, py0] = F(0, fh * 0.86);
      draw3DBoxAt(ctx, cam, px0, py0, fh * 0.46, bz, colTop, stone, seed + 2, night, alpha, true, 0, fh * 0.27);
      for (const s of [-3, -1, 1, 3]) { const [cx2, cy2] = F(s * fh * 0.145, fh * 1.125);
        draw3DBoxAt(ctx, cam, cx2, cy2, fh * 0.052, bz, colTop, order, seed + 3 + s, night, alpha, false, 0, fh * 0.052); }
      // The frieze the name is cut into, overhanging the columns that carry it.
      draw3DBoxAt(ctx, cam, px0, py0, fh * 0.52, colTop, friezeTop, order, seed + 8, night, alpha, true, 0, fh * 0.34); }
    // 4) The attic storey, set back and in the pale panel — the light value along the top that
    //    stops the whole elevation being one tone against the sky.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, wallTop, atticTop, attic, seed + 5, night, alpha, true);
    // 5) A set-back roof house for the plant and the stair head, off centre so the roofline is
    //    not symmetrical about its own mast.
    { const [rx, ry] = F(-fh * 0.3, -fh * 0.22);
      draw3DBoxAt(ctx, cam, rx, ry, fh * 0.3, atticTop, atticTop + h * 0.16, base, seed + 6, night, alpha, true); }
    { const [mx, my] = F(fh * 0.9, 0); mast(ctx, cam, mx, my, atticTop, h * 1.62, alpha, now, seed + 3); }
    { const [bx, by] = F(-fh * 0.7, 0); blinkLight(ctx, cam, bx, by, h, '90,150,255', now, seed, alpha, 1.8); }
    // 6) THE NAME, CUT INTO THE FRIEZE THE COLUMNS CARRY — lettered directly rather than hung on a
    //    `marqueeBand`. The band is the right fitting for a shopfront and the wrong one here twice
    //    over: `fasciaKind` ROLLS the treatment off the building's own seed, so a station house can
    //    come up wearing a backlit lightbox, and what a civic frontage does with its name is cut it
    //    into the stone. The Meridian's gilt-nameplate idiom, which is what `rationnine` already
    //    uses one arm along.
    // ⚠ BAKED UNCONDITIONALLY, AND NEVER SKIPPED FOR A TILE WITH NO NAME. `bakeSignText` registers
    //    the arm as lettering itself on the way IN, which is what keeps the derived kit's own board
    //    off the frontage; skip the call and the kit hangs a second sign on the building.
    // ⚠ `dn: 0` AND `solid` — PAINT, NOT NEON. Without `solid` the bake lays a coloured halo, a
    //    dark edge and then a WHITE CORE over it, which is a neon tube whatever ink it is handed.
    if (frontVis) {
      // ⚠ AND IT STANDS OFF THE FRIEZE, WHICH IS TWO SEPARATE CORRECTIONS AND BOTH ARE SILENT.
      //    Authored at the frieze's own front plane the lettering is COPLANAR with the stone it is
      //    cut into, and a tie on the depth buffer is a loss: the bake ran, the quad reached the
      //    decal layer 275 px wide in the middle of the frame, and the building had no name on it.
      //    Nothing warns — it looks exactly like a frieze nobody lettered.
      //    The second is that `fh * 1.20` is PAST the plot line, so `tileFitBox` trims the frieze
      //    back to `TILE_REACH` while a decal is never trimmed — the two stop agreeing about where
      //    the wall is, and the authored gap of a thousandth of a tile was not the gap it reads
      //    as. `wallFaceAt` over this z band answers 0.5, so that is the plane the stand-off is
      //    measured from.
      // ⚠ AND IT IS `DETAIL_LIFT`, NOT `SIGN_PROUD`, WHICH WAS MEASURED RATHER THAN CHOSEN.
      //    `emitSurfaceText` already stands its finished quad off along that quad's own normal by
      //    `FACE_EPS` (0.006) — and swept here, 0.5011 and 0.508 both stayed invisible while 0.526
      //    read cleanly, which is a threshold an 0.006 tie-breaker cannot account for in the
      //    direction it is meant to push. `DETAIL_LIFT` (0.02) is the constant this file already
      //    uses for a part bolted to a face and it is the magnitude the sweep asked for.
      const nz0 = colTop + h * 0.022, nz1 = friezeTop - h * 0.022, nhw = fh * 0.44;
      const ny = Math.min(fh * 1.20, TILE_REACH) + DETAIL_LIFT;
      const [nlx, nly] = F(-nhw, ny), [nrx, nry] = F(nhw, ny);
      const TL = cam.proj(nlx, nly, nz1), TR = cam.proj(nrx, nry, nz1);
      const BR = cam.proj(nrx, nry, nz0), BL = cam.proj(nlx, nly, nz0);
      // ⚠ BRONZE, BECAUSE ONE INK HAS TO SERVE BOTH HOURS. The bake is keyed on the colour and the
      //    `dn` — and `dn` is 0 here on purpose, so there is exactly ONE texture for this name and
      //    it is the same one at noon and at midnight. A dark ink reads beautifully on pale stone
      //    and disappears into the same stone after dark; a pale ink does the reverse. A warm
      //    metal is the one value that is darker than lit limestone AND lighter than unlit
      //    limestone, which is why a civic building of this kind has always used bronze letters —
      //    the Meridian's gilt-nameplate idiom, and `ty_tomb_brass` one arm over.
      const tex = bakeSignText('PRECINCT 9', '#a8801f', 0, false, true);
      if (tex && [TL, TR, BR, BL].every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      // Cut letters are not lit, so the frieze is — a station board is floodlit from under the
      // cornice, which is also what keeps the name legible after dark without making it neon.
      // ⚠ AND THE WASH GOES IN FRONT OF THE STONE, NOT INSIDE IT. A `glowPool` is a depth-TESTED
      //    sprite, so one placed at the frieze's mounting plane is behind the frieze's own front
      //    face and the band it is meant to light hides most of it — the lamp is on and the sign
      //    is dark, which is the same trap `emitSurfaceText` hit four lines up wearing a different
      //    hat. It shares the lettering's plane, which is already solved and already clear.
      { const [gx, gy] = F(0, ny); glowPool(ctx, cam, gx, gy, (nz0 + nz1) * 0.5, '206,222,250', 12, alpha * (night ? 0.62 : 0.14)); }
      // 7) THE BADGE. A shield over the door is what a station house has instead of a shopfront,
      //    and it is the one thing on this building that says what it is by daylight.
      //    ⚠ THE PLANE IS THE ONE `draw3DBoxAt` RESOLVED, NOT THE ONE THE CALL ASKED FOR. The main
      //    block is authored at `fh * 1.10` and the box hard-caps its half-width at 0.44 of a tile
      //    before drawing, so a badge hung at the authored number floats off the wall by whatever
      //    the cap took — 0.02 of a tile at the default footprint, which reads exactly like a sign
      //    that has come loose. Same expression, asked here.
      const wallY = Math.min(fh * 1.10, 0.44), br = fh * 0.17;
      const [ax, ay] = F(0, wallY + br * 0.16);
      wallBadge(ctx, cam, ax, ay, E, h * 0.66, br, '214,178,96', night, alpha);
      // 8) The blue lamp over the door, under the frieze. Every station in every city has one, it
      //    is the cheapest possible piece of identity, and after dark it is still the thing you
      //    pick the building out by from the far end of the street.
      const [lx2, ly2] = F(0, fh * 1.12);
      glowPool(ctx, cam, lx2, ly2, h * 0.38, '90,150,255', 13, alpha * (night ? 0.85 : 0.3));
    }
  },
  clinic(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CLINIC — 16 tiles, and the same complaint as the civic block: one pale
    //                  box, one pale lid, a cross on top. A clinic's whole argument is that it is
    //                  CLEAN, so the rebuild leans on that rather than on adding grime: a glazed
    //                  ground floor you can see the waiting room through, a banded upper wall, and
    //                  a service wing that is visibly the part nobody is meant to look at.
    const clean = pal, panel = 'ty_precast', dark = 'ty_precast_dk';
    const gf = h * 0.30, wallTop = h * 0.88, capTop = h * 1.06;
    // 1) A glazed ground floor, recessed behind the mass above it — the shadow under the overhang
    //    is most of what makes a building read as having a lobby rather than a front wall.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, 0, gf, 'ty_clone_vat', seed, night, alpha, false);
    // 2) The main block over it, projecting, in the tile.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, gf, wallTop, clean, seed + 1, night, alpha, false);
    // 3) A banding course two thirds up, in the panel grey. One line across a pale wall is the
    //    difference between a slab and a building with floors in it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.21, h * 0.62, h * 0.68, panel, seed + 2, night, alpha, false);
    // 4) The cap, set back and pale.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.72, wallTop, capTop, panel, seed + 3, night, alpha, true);
    // 5) THE SERVICE WING — a lower, darker, windowless block on one flank with a flue off it.
    //    A hospital is a clean front and a back you are not shown, and having both in the
    //    silhouette is what stops this reading as an office with a cross on it.
    { const [wx2, wy2] = F(-fh * 0.96, -fh * 0.42);
      draw3DBoxAt(ctx, cam, wx2, wy2, fh * 0.34, 0, h * 0.54, dark, seed + 4, night, alpha, true);
      // ⚠ `style` IS A FUNCTION OF THE FACET, NOT A COLOUR. Handing it a palette key or a colour
      // string is the failure this file already records against the Battery Acid roaster: it
      // throws mid-frame and takes the whole sim down the first time that building comes into
      // view. `shapes:smoke` catches it now — "style is not a function", twelve times over.
      drawFacetDrum(ctx, cam, wx2, wy2 - fh * 0.1, h * 0.54, h * 0.92, fh * 0.07, fh * 0.06, 8, alpha,
        (f) => 'rgb(' + (62 + f.nl * 30 | 0) + ',' + (66 + f.nl * 32 | 0) + ',' + (72 + f.nl * 34 | 0) + ')', 'rgb(44,48,54)'); }
    // THE CROSS. It is the only thing on this building that says what it is, and it was a
    // sixteen-pixel sticker on the sky; it is a light box on a plinth now, standing off the cap
    // at about forty per cent of the building's own width. Sized off BOTH axes, because a cross
    // is square: on the footprint so it can never overhang the tile, and on the height so a
    // two-storey corner surgery does not wear a sign taller than itself.
    roofCross(ctx, cam, dx, dy, E, capTop, Math.min(fh * 0.44, h * 0.24), '232,62,62', night, alpha);
    // The lobby, lit from inside, and the green wash the vats throw. The lobby light is the one
    // that reads from the street; the wash is what says whose clinic it is.
    if (frontVis) { const [gx, gy] = F(0, fh * 1.0);
      glowPool(ctx, cam, gx, gy, gf * 0.6, '210,240,235', 15, alpha * (night ? 0.6 : 0.22)); }
    glowPool(ctx, cam, dx, dy, h * 0.4, '120,220,150', 16, alpha * (night ? 0.28 : 0.14));
  },
  ksabstudio(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB-9 — the basin's television station, and a TRANSMISSION SITE before it is
    // anything else: a light-tight sound stage, the fly tower over it, a plant deck, a precast
    // production wing carrying the only windows on the plot, a small glazed public front, and the mast
    // that is the whole reason the station is on this corner rather than any other.
    //
    // ⚠ A SOUND STAGE HAS NO ROOFLIGHTS, and the SAWTOOTH north-light roof this arm wore for months
    // said the opposite as loudly as a building can. A north light is a mill's answer to needing
    // daylight on a bench all day; a stage is built to keep out every photon it does not own, which is
    // why the shell here is blind, the roof is a deck of air handling, and all the glass is in the
    // wing where somebody answers the telephone. Swapping the saw for the plant is the single change
    // that stops this reading as a factory with an aerial on it.
    //
    // ⚠ AND THE MARQUEE IS THE ARM THAT FOUND THE FLOATING-SIGN BUG. Its board was pitched at the
    // lobby's own centre and then stood off again from the TILE centre, so it came to rest 0.62 of a
    // tile out from a plot line at 0.44 — over the grass, with daylight between the sign and the
    // building it names. Dead-on that is invisible, because a pure forward offset produces no lateral
    // displacement at all; it only comes adrift as you drive past. The fix is in `marqueeStand` and
    // this caller needs nothing, but see the ⚠ there before moving any band onto a sub-box.
    const KSABc = m.neon || '#39d6ff';                       // the station's own cyan
    const ONAIR = '#ff4a34';                                 // …and the one red on the plot, which is never decoration
    const L = (lx, ly, z) => { const w = facePt(dx, dy, lx, ly, E); return [w[0], w[1], z]; };
    const P = (lx, ly, z) => { const w = facePt(dx, dy, lx, ly, E); return cam.proj(w[0], w[1], z); };
    const apron = h * 0.035;
    // 1) The apron. A plant stands on a yard, and glazing that runs into the pavement is the tell that
    //    a building is an extrusion.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, apron, 'ty_ksab_dk', seed + 9, night, alpha, false);
    // 2) THE SOUND STAGE — one blind ribbed clear-span volume, set back off the street and pushed left
    //    so the production wing gets a frontage of its own.
    const sgx = -fh * 0.16, sgy = -fh * 0.20, mhx = fh * 0.72;
    const [cx, cy] = F(sgx, sgy);
    // ⚠ WIDE AND LOW, WHICH IS THE PROPORTION AND NOT A TASTE. A stage is a room with a lorry door,
    // and at `h * 1.02` this arm drew a grey TOWER with plant on the roof — the height every arm in
    // this file reaches for by default, and the one shape a clear-span shed cannot be. The mast is
    // what makes this plot tall; the building is what makes it read as a plant.
    const mh = apron + h * 0.58, deck = mh + h * 0.03;
    draw3DBoxAt(ctx, cam, cx, cy, mhx, apron, mh, pal, seed, night, alpha, true);
    draw3DBoxAt(ctx, cam, cx, cy, mhx * 1.03, apron, apron + h * 0.13, 'ty_ksab_dk', seed + 1, night, alpha, false);   // the base course it gets reversed into
    draw3DBoxAt(ctx, cam, cx, cy, mhx * 1.04, mh, deck, 'ty_ksab_dk', seed + 2, night, alpha, true);                   // capping course
    const face = sgy + mhx + FACE_EPS;                       // the stage's own front plane, which is what its signage goes on
    // 3) The fly tower — the grid loft over the stage's rear corner, where the lamps and the scenery
    //    bars hang. It is the one part of a studio that has to be taller than the room it serves.
    { const [tx, ty] = F(-fh * 0.36, -fh * 0.44);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, deck, deck + h * 0.30, 'ty_ksab_dk', seed + 3, night, alpha, true); }
    // 4) THE PLANT DECK. A stage is a sealed box with a hundred kilowatts of lamp in it, so the biggest
    //    single object on the roof is the air handling — which is also what a flat stage roof is FOR,
    //    and what the saw was standing in the way of.
    { const [ax, ay] = F(fh * 0.06, fh * 0.06);
      draw3DBoxAt(ctx, cam, ax, ay, fh * 0.24, deck, deck + h * 0.11, 'ty_ksab_dk', seed + 4, night, alpha, true);
      drawRing(ctx, cam, ax, ay, deck + h * 0.11, fh * 0.11, 12, 'rgba(126,138,150,0.55)', 1.4, alpha); }              // the extract cowl
    { const [ex, ey] = F(-fh * 0.50, fh * 0.02);
      draw3DBoxAt(ctx, cam, ex, ey, fh * 0.13, deck, deck + h * 0.07, 'ty_ksab_dk', seed + 6, night, alpha, true); }   // the chiller beside it
    // 5) THE TRANSMITTER. Everything else on this plot could be anywhere; this is why it is here.
    const mx0 = fh * 0.24, my0 = -fh * 0.42;
    const [lx, ly] = F(mx0, my0), mastTop = deck + h * 2.1;
    latticeTower(ctx, cam, lx, ly, deck, mastTop, fh * 0.14, fh * 0.04, alpha, now, seed + 5);
    dish(ctx, cam, lx, ly, deck + h * 0.60, 9, alpha);
    dish(ctx, cam, lx, ly, deck + h * 1.18, 7, alpha);
    blinkLight(ctx, cam, lx, ly, mastTop, '255,80,80', now, seed + 5, alpha, 2.0);
    blinkLight(ctx, cam, lx, ly, deck + h * 1.05, '255,80,80', now, seed + 7, alpha, 1.3);
    // Three stays, at the angles a mast this slender is actually guyed at. They are what stops the
    // lattice reading as a stick somebody stood upright on a roof, and they cost three strokes.
    // ⚠ ANCHORED IN THE ARM'S OWN LOCAL FRAME, never at a world bearing off `lx, ly` — the entrance
    // rotates the whole plot and a world-space fan of stays walks off the deck on three facings.
    for (let i = 0; i < 3; i++) {
      const a = i * 2.0944 + 0.6, r = fh * 0.21;
      const [gx, gy] = F(mx0 + Math.cos(a) * r, my0 + Math.sin(a) * r);
      // ⚠ A TIE-BREAKER PULL, NOT THE FULL LIFT. `emitWire`'s default spends 0.6 of a tile to
      // rescue a part authored INSIDE its host — a mast at the tile centre, a stair bolted into a
      // wall — and a stay is neither: it hangs in open air above the roof and only its anchor
      // touches anything. At the default it is dragged out in front of the building, which
      // `glself` counts and which is the gratuitous half of that budget.
      emitWire(ctx, cam, [lx, ly, deck + (mastTop - deck) * 0.58], [gx, gy, deck], 0.9, 'rgba(170,180,194,0.5)', alpha, { pull: DECO_PULL });
    }
    // 6) THE PRODUCTION WING — two storeys of precast with real windows in it. A broadcaster is half a
    //    plant and half an office, and this is the only wall on the plot that says so.
    { const [px, py] = F(fh * 0.74, -fh * 0.06);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.26, apron, apron + h * 0.42, 'ty_ksab_pc', seed + 8, night, alpha, true);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.28, apron + h * 0.42, apron + h * 0.46, 'ty_ksab_dk', seed + 10, night, alpha, true); }
    // 7) THE PUBLIC FRONT. Reception, and not much of it: a handful of people a day come here to be
    //    interviewed and everything else arrives at the scene dock.
    const lobHalf = fh * 0.30, lobTop = apron + h * 0.22, lobY = fh * 0.50;
    const [ox, oy] = F(-fh * 0.10, lobY);
    draw3DBoxAt(ctx, cam, ox, oy, lobHalf, apron, lobTop, 'ty_ksab_glass', seed + 11, night, alpha, true);
    draw3DBoxAt(ctx, cam, ox, oy, lobHalf * 1.06, lobTop, lobTop + h * 0.04, 'ty_ksab_dk', seed + 12, night, alpha, true);   // the fascia the name goes on
    // 7b) The entrance canopy — a flat slab on two struts with a lit soffit line, which is what a lobby
    //     has. The glass visor this replaces was a canted pane cantilevered to the plot line, and the
    //     one thing it never looked like was a door you walk under.
    { const zc = lobTop - h * 0.06, cw = fh * 0.22, cxo = -fh * 0.10, y0 = lobY + lobHalf * 0.6, y1 = lobY + fh * 0.34;
      emitFlat(ctx, cam, [L(cxo - cw, y0, zc), L(cxo + cw, y0, zc), L(cxo + cw, y1, zc), L(cxo - cw, y1, zc)],
        night ? 'rgba(46,52,58,0.96)' : 'rgba(74,82,88,0.96)', alpha, { stroke: 'rgba(18,22,26,0.6)', lw: 1 });
      emitWire(ctx, cam, L(cxo - cw * 0.9, y1, zc), L(cxo + cw * 0.9, y1, zc), 1.2,
        night ? 'rgba(120,226,255,0.85)' : 'rgba(150,186,204,0.7)', alpha, { pull: DECO_PULL, glow: night ? 6 : 0, glowCss: KSABc });
      for (const s of [-1, 1]) emitWire(ctx, cam, L(cxo + s * cw * 0.86, y1, zc), L(cxo + s * cw * 0.86, y1, apron), 1.3, 'rgba(150,160,170,0.7)', alpha, { pull: DECO_PULL }); }
    // 8) The name, across the lobby fascia.
    marqueeBand(ctx, cam, ox, oy, E, lobHalf, lobTop + h * 0.022, KSABc, night, alpha, 'KSAB-9');
    reserveSignBand(lobHalf, lobTop + h * 0.022);
    // 9) THE CALL LETTERS, painted large on the blind stage wall — the thing a television plant does
    //    with the one enormous blank elevation it owns, and the reason the shell being windowless is
    //    an opportunity rather than a problem.
    { const bz0 = apron + h * 0.34, bz1 = apron + h * 0.51, bx = sgx - fh * 0.16, bw = fh * 0.42;
      // ⚠ THE CALL SIGN, NOT THE TILE'S NAME. `_bladeSign` is "KSAB-TV STUDIO STAGE" here, and the
      // whole point of painting a stage wall is that it is four letters two storeys high; set the
      // full name into the same box and it is a thin grey line nobody can read from the road.
      const tex = bakeSignText('KSAB', KSABc, night ? 1 : 0, false);
      const TL = P(bx - bw, face, bz1), TR = P(bx + bw, face, bz1), BR = P(bx + bw, face, bz0), BL = P(bx - bw, face, bz0);
      if (tex && [TL, TR, BR, BL].every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha); }
    // 10) ON AIR. One lamp, and the only thing on the plot that tells you whether anybody is working.
    // ⚠ PARKED IS ON AIR. `RENDER_TUNE.motion` 0 promises a still city, not a dead one, and a dark
    // ON AIR box is the single state of this machine with nothing to look at — so the pose it comes
    // home to is the station transmitting, which is also what every capture and every gate sees.
    const live = motionOn() ? dutyPhase(now, seed + 21, 210000, 0.66) >= 0 : true;
    // ⚠ THE PANEL IS THE LAMP AND THE LETTERING IS PAINT ON IT, WHICH IS THE OPPOSITE OF EVERY
    // OTHER SIGN HERE AND IS WHAT THE THING ACTUALLY IS. Lettered the usual way round — a dark
    // board with `bakeSignText` ink on it — it measured ZERO red pixels at any hour: the neon
    // treatment lays a white-hot core down the middle of whatever colour it is handed, and at the
    // size of a doorway box that core is the whole glyph. An ON AIR box is a sheet of red glass
    // with opaque letters masked out of it, so the fill carries the colour and the name is
    // `solid` paint (see the ⚠ on `bakeSignText`: `dn: 0` alone is not paint).
    // ⚠ AND IT IS WIDE. A near-square board makes `fitSignPts` shrink a six-character name to a
    // thread down the middle of it; the real article is a letterbox, about two and a half to one.
    { const az0 = apron + h * 0.345, az1 = apron + h * 0.425, ax0 = fh * 0.26, aw = fh * 0.24;
      const pane = live ? (night ? 'rgba(232,58,38,0.95)' : 'rgba(208,50,32,0.95)') : 'rgba(58,26,22,0.95)';
      emitDecoFill(ctx, cam, [L(ax0 - aw, face, az1), L(ax0 + aw, face, az1), L(ax0 + aw, face, az0), L(ax0 - aw, face, az0)],
        pane, alpha, DECO_LIFT, 'onair');
      const tex = bakeSignText('ON AIR', '#180a08', 0, false, true);
      const iz0 = az0 + (az1 - az0) * 0.2, iz1 = az1 - (az1 - az0) * 0.2, iw = aw * 0.86;
      const TL = P(ax0 - iw, face + FACE_EPS, iz1), TR = P(ax0 + iw, face + FACE_EPS, iz1);
      const BR = P(ax0 + iw, face + FACE_EPS, iz0), BL = P(ax0 - iw, face + FACE_EPS, iz0);
      if (tex && [TL, TR, BR, BL].every((p) => p.f > 0.12))
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha * (live ? 1 : 0.55));
      if (live) { const [gx, gy] = F(ax0, face); glowPool(ctx, cam, gx, gy, (az0 + az1) * 0.5, '255,74,52', 11, alpha * (night ? 0.55 : 0.22)); } }
    // 11) The uplink pad in the front corner — two ground dishes on a low plinth, which is the other
    //     half of a transmission site and the part a driver at eye height can actually see.
    { const [ux, uy] = F(-fh * 0.74, fh * 0.56);
      draw3DBoxAt(ctx, cam, ux, uy, fh * 0.22, apron, apron + h * 0.025, 'ty_ksab_pc', seed + 13, night, alpha, true);
      for (const [sx, sy, r] of [[-0.86, 0.54, 9], [-0.62, 0.60, 8]]) {
        const [px2, py2] = F(fh * sx, fh * sy);
        drawFacetDrum(ctx, cam, px2, py2, apron + h * 0.025, apron + h * 0.075, fh * 0.035, fh * 0.028, 8, alpha,
          (f) => { const k = 0.5 + f.nl * 0.5; return `rgb(${(126 * k) | 0},${(134 * k) | 0},${(142 * k) | 0})`; }, null);
        dish(ctx, cam, px2, py2, apron + h * 0.105, r, alpha);
      } }
    // 12) Night. The stage stays dark — it is a box with no windows and there is nothing for it to
    //     leak — so the light on this plot is the wing's offices, the lobby, and the beacon.
    if (night) {
      glowPool(ctx, cam, ox, oy, lobTop * 0.6, '150,200,230', 12, alpha * 0.30);
      const [wx2, wy2] = F(fh * 0.74, -fh * 0.06);
      glowPool(ctx, cam, wx2, wy2, apron + h * 0.26, '226,214,170', 10, alpha * 0.20);
      glowPool(ctx, cam, cx, cy, deck, '96,206,240', 14, alpha * 0.12);
    }
  },
  studio(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB TV studio LOT: a barrel-vaulted hero sound stage (windowless ribbed shell + elephant door), a second scene-dock stage, a glazed production-office public front, broadcast mast + uplink dishes, and the iconic back-lot water tower — a complex, unmistakably-studio composition, all kept inside the tile
    const KSAB = m.neon || '#39d6ff';
    const sfw = fh * 0.6, wallTop = h * 0.82, archH = sfw * 0.6;                                          // hero-stage half-width, eaves height, barrel-vault rise (fh-scaled, like the diner/warehouse sheds)
    const stageBase = [96, 104, 112];                                                                     // cool steel roof/tank base tying the lot to the ty_ksab palette
    const metal = (r, g, b) => (f) => { const s = 0.5 + f.nl * 0.5; return `rgb(${r * s | 0},${g * s | 0},${b * s | 0})`; };
    // ── Hero sound stage — a big WINDOWLESS ribbed clear-span shell (ty_ksab ∈ METAL_WALL) under a curved barrel vault, arched gable facing the street ──
    { const [sx, sy] = F(-fh * 0.05, 0); draw3DBoxAt(ctx, cam, sx, sy, sfw, 0, wallTop, pal, seed, night, alpha, false); }   // roof left open for the barrel
    drawBarrelRoof(ctx, cam, F, -fh * 0.05, sfw, sfw * 0.94, wallTop, archH, 12, alpha, stageBase);
    // ── Fly tower / lighting-grid loft breaking the ridge at the rear ──
    { const [tx, ty] = F(-fh * 0.05, -sfw * 0.5); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, wallTop, wallTop + h * 0.5, pal, seed + 1, night, alpha, true); }
    // ── Elephant door: the huge roll-up scenery door on the front gable (only when that face is toward us) ──
    if (frontVis) { const [gx, gy] = F(-fh * 0.05, sfw * 0.99); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.3, 0, h * 0.52, 'ty_door', seed + 2, night, alpha, true, 0, fh * 0.05); }
    // ── Second stage / scene dock — a lower windowless box to the right with a rooftop HVAC plenum ──
    { const [d2x, d2y] = F(fh * 0.56, -fh * 0.32); draw3DBoxAt(ctx, cam, d2x, d2y, fh * 0.32, 0, h * 0.62, pal, seed + 3, night, alpha, true);
      draw3DBoxAt(ctx, cam, d2x, d2y, fh * 0.2, h * 0.62, h * 0.74, 'ty_door', seed + 4, night, alpha, true); }
    // ── Low glazed production-office wing across the front-right — real curtain glass (ty_ksab_glass ∈ GLASS_WALL), a lit KSAB marquee, warm-lit lobby ──
    { const [ox, oy] = F(fh * 0.4, sfw * 0.62); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.42, 0, h * 0.46, 'ty_ksab_glass', seed + 5, night, alpha, true);
      marqueeBand(ctx, cam, ox, oy, E, fh * 0.44, h * 0.34, KSAB, night, alpha, 'KSAB');
      if (night) glowPool(ctx, cam, ox, oy, h * 0.2, '255,210,150', 12, alpha * 0.24); }
    // ── Broadcast kit — transmitter mast + red beacon on the fly tower, two satellite uplink dishes on the scene-dock roof ──
    { const [mx, my] = F(-fh * 0.05, -sfw * 0.5); mast(ctx, cam, mx, my, wallTop + h * 0.5, wallTop + h * 1.9, alpha, now, seed + 6); }
    { const [e1x, e1y] = F(fh * 0.46, -fh * 0.16); dish(ctx, cam, e1x, e1y, h * 0.62, 9, alpha); }
    { const [e2x, e2y] = F(fh * 0.66, -fh * 0.46); dish(ctx, cam, e2x, e2y, h * 0.62, 8, alpha); }
    // ── The iconic back-lot water tower — a squat tank on four tall spindly legs ──
    { const tcx = -fh * 0.6, tcy = -fh * 0.52, legTop = h * 0.7, [wx, wy] = F(tcx, tcy);
      for (const s of [-1, 1]) for (const t of [-1, 1]) { const [lx, ly] = F(tcx + s * fh * 0.1, tcy + t * fh * 0.1); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, 0, legTop, 'ty_door', seed + 8 + s + t * 2, night, alpha, false); }
      drawFacetDrum(ctx, cam, wx, wy, legTop, legTop + h * 0.26, fh * 0.16, fh * 0.16, 10, alpha, metal(stageBase[0], stageBase[1], stageBase[2]), 'rgb(70,60,92)');
      drawFacetDrum(ctx, cam, wx, wy, legTop + h * 0.26, legTop + h * 0.36, fh * 0.16, fh * 0.02, 10, alpha, metal(78, 68, 100), null); }   // conical cap
    // ── KSAB call-letter blade on the hero-stage crown ──
    { const [bx, by] = F(fh * 0.32, -sfw * 0.2); neonBlade(ctx, cam, bx, by, wallTop + archH, wallTop + archH + h * 0.6, KSAB, night, alpha, 'KSAB'); }
    // ── Night washes — the station's cyan along the roofline + a cool key-light glow off the stage front ──
    if (night) { glowPool(ctx, cam, dx, dy, h * 0.6, '96,206,240', 16, alpha * 0.22);
      const [kx, ky] = F(-fh * 0.05, sfw * 0.6); glowPool(ctx, cam, kx, ky, h * 0.3, '190,200,255', 12, alpha * 0.16); }
  },
  studiogate(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB Writers' Wing: a glazed office annex with a steel KSAB parapet + a steady lit marquee. Deliberately simple and ENTIRELY within its own tile (no cantilevered canopy/turnstiles — those spilled onto the road). Reads low once flags.floors:2 reaches the DB.
    // ⚠ STILL DELIBERATELY SIMPLE AND STILL ENTIRELY WITHIN ITS OWN TILE — the base course below is
    // fh*1.0 against a parapet already at fh*0.98, so nothing new reaches the road. What it buys is
    // the one thing a curtain-glass lobby cannot do without: a solid course for the glass to land
    // on. Glazing that runs into the pavement is the tell that a building is an extrusion.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, h * 0.06, pal, seed + 5, night, alpha, false);
    // Curtain-glass lobby — real glazed skin (ty_ksab_glass ∈ GLASS_WALL: sky sheen, no window grid).
    // No roof cap: the wider parapet below caps the footprint at h*0.9, so a lobby cap here would only
    // z-fight the parapet's own roof (near-identical queue depth → the roof strobed dark↔light purple).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, h * 0.06, h * 0.9, 'ty_ksab_glass', seed, night, alpha, false);
    // The parapet cap, in the plant's own near-black, tying the annex to the stage one tile south.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, h * 0.9, h * 1.02, 'ty_ksab_dk', seed + 1, night, alpha, true);
    // Steady lit marquee across the front — KSAB. Always drawn (the depth queue occludes it when the
    // front faces away), so it no longer flashes on/off as the camera swings past the facing threshold.
    marqueeBand(ctx, cam, dx, dy, E, fh * 0.82, h * 0.6, m.neon || '#39d6ff', night, alpha, 'KSAB');
    // A KSAB call-letter blade set on the roof (back corner, inside the footprint).
    { const [bx, by] = F(-fh * 0.5, -fh * 0.42); neonBlade(ctx, cam, bx, by, h * 1.02, h * 1.34, m.neon || '#39d6ff', night, alpha); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.4, '96,206,240', 12, alpha * 0.24);   // the marquee wash, in the station's cyan
  },
  hangar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // AIRPORT: glazed passenger terminal + hangar shed + ATC tower, floodlit at night
    const top = h * (m.big ? 0.66 : 0.56), NF = 12;
    // Shared surface styles (reused by the terminal + the tower): shaded concrete/steel facets and
    // the procedural curtain glass (a vertical sky-reflection gradient, facet-lit — no window grid).
    const base = WALL_COL[pal] || [96, 102, 112];
    const concrete = (f) => { const s = 0.6 + f.nl * 0.5; return `rgb(${base[0] * s | 0},${base[1] * s | 0},${base[2] * s | 0})`; };
    const steel = (r, gc, b) => (f) => { const s = 0.5 + f.nl * 0.5; return `rgb(${r * s | 0},${gc * s | 0},${b * s | 0})`; };
    const glass = (f, tp, bt) => {
      const g = ctx.createLinearGradient(0, tp, 0, bt), s = 0.55 + f.nl * 0.45;
      if (night) {
        g.addColorStop(0, `rgba(${70 * s | 0},${120 * s | 0},${150 * s | 0},0.95)`);
        g.addColorStop(0.55, `rgba(${52 * s | 0},${92 * s | 0},${120 * s | 0},0.95)`);
        g.addColorStop(1, 'rgba(210,178,120,0.95)');                                                             // warm consoles glimpsed low
      } else {
        g.addColorStop(0, `rgba(${150 + f.nl * 80 | 0},${188 + f.nl * 50 | 0},224,0.96)`);                       // bright sky-reflection crown
        g.addColorStop(0.5, `rgba(${78 + f.nl * 70 | 0},${120 + f.nl * 70 | 0},158,0.95)`);
        g.addColorStop(1, `rgba(${26 + f.nl * 28 | 0},${42 + f.nl * 28 | 0},62,0.96)`);                          // deep sill
      }
      return g;
    };
    // 1. PASSENGER LOUNGE — a curved glass pavilion on the apron with a warm-lit INTERIOR read
    //    through semi-transparent glass (a warm floor, a bench row, a couple of waiting passengers),
    //    a transom band, a slim entrance canopy and a rooftop spill. New procedural interior.
    { const [lx, ly] = F(fh * 0.42, fh * 0.48), lH = top * 0.5, lR = fh * 0.44;
      const loungeGlass = (f, tp, bt) => {   // cooler + MORE TRANSPARENT than the cab glass so the lit interior shows through
        const g = ctx.createLinearGradient(0, tp, 0, bt);
        g.addColorStop(0, `rgba(${168 + f.nl * 60 | 0},${204 + f.nl * 40 | 0},234,0.5)`);
        g.addColorStop(1, `rgba(${58 + f.nl * 40 | 0},${88 + f.nl * 40 | 0},120,0.46)`);
        return g;
      };
      // Interior at the pavilion's CENTRE depth → sorts behind the near (semi-transparent) glass
      // facets and in front of the far ones, so it reads as a lit lounge seen through the glass.
      // ⚠ THE PROBE IS NOT OPTIONAL, and this is the trap emitDeco exists to close: a caller
      // that wants a DEPTH of its own reaches for emitFace and loses the occlusion test on the
      // way past. It cost the two largest signs in the game their test once already. The lit
      // lounge behind the glass is the same mistake — with the mass on the GPU nothing can paint
      // over it, so the terminal interior showed through whatever stood in front of it. Measured
      // behind an eleven-storey warehouse: 53 leaked pixels at night, 76 by day, against 0 on the
      // canvas. Keeping emitFace and asking decoHidden by hand holds the depth EXACTLY where it
      // was (the pavilion’s centre, so it sorts between the near and far glass) and adds nothing
      // but the question.
      // ⚠ AND IT IS THE ONE ADORNMENT IN THE CITY THAT MAY NOT GO ON THE DEPTH BUFFER, because
      // what it is BEHIND is the pavilion's own glass. The mass pass writes depth whatever its
      // alpha, so a lit interior handed over as a quad at the pavilion's centre is hidden by the
      // very glass it is meant to be read through — the lounge simply goes dark. So it keeps the
      // canvas, and gets the strongest probe available instead: markHidden spans the pavilion's
      // whole height and width, where decoHidden was asking about a single point at its middle.
      const loungeD = cam.proj(lx, ly, lH * 0.4);
      if (!(GL_CELLS && TUNE.glDeco ? markHidden(cam, lx, ly, lH, lR) : decoHidden([loungeD]))) keptOnCanvas('departure-lounge', () => emitFace(loungeD.f, () => {
        ctx.globalAlpha = alpha;
        const fp = cam.proj(lx, ly, 0.02);
        if (fp.f > 0.1) { const r = clamp(24 / fp.f, 6, 40), rg = ctx.createRadialGradient(fp.sx, fp.sy, 1, fp.sx, fp.sy, r); rg.addColorStop(0, 'rgba(255,222,166,0.55)'); rg.addColorStop(1, 'rgba(255,222,166,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(fp.sx, fp.sy, r, 0, 7); ctx.fill(); }   // warm floor pool
        for (let i = -2; i <= 2; i++) { const sp = cam.proj(lx + i * fh * 0.12, ly + fh * 0.16, 0.03); if (sp.f <= 0.1) continue; const sz = clamp(3.6 / sp.f, 1.2, 7); ctx.fillStyle = 'rgba(28,26,30,0.8)'; ctx.fillRect(sp.sx - sz * 0.6, sp.sy - sz * 0.55, sz * 1.2, sz * 0.7); }   // bench row
        for (const dxF of [-fh * 0.16, fh * 0.12]) { const gp = cam.proj(lx + dxF, ly + fh * 0.04, 0.02), hp = cam.proj(lx + dxF, ly + fh * 0.04, lH * 0.34); if (gp.f <= 0.1 || hp.f <= 0.1) continue; const bw = clamp(2 / gp.f, 0.8, 5); ctx.fillStyle = 'rgba(22,20,26,0.85)'; ctx.beginPath(); ctx.moveTo(gp.sx - bw, gp.sy); ctx.lineTo(gp.sx + bw, gp.sy); ctx.lineTo(hp.sx + bw * 0.6, hp.sy); ctx.lineTo(hp.sx - bw * 0.6, hp.sy); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.arc(hp.sx, hp.sy - bw * 0.5, bw * 0.7, 0, 7); ctx.fill(); }   // waiting passengers
        ctx.globalAlpha = 1;
      }));
      drawFacetDrum(ctx, cam, lx, ly, 0, lH, lR, lR * 0.98, 16, alpha, loungeGlass, steel(52, 58, 68)({ nl: 0.72 }));   // curved glass envelope (solid roof cap) over the lit interior
      drawRing(ctx, cam, lx, ly, lH * 0.5, lR * 0.99, 16, 'rgba(20,26,34,0.5)', 1, alpha);                         // mullion transom band
      const [cx, cy] = F(fh * 0.42, fh * 0.96); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.4, lH * 0.32, lH * 0.42, 'ty_door', seed + 9, night, alpha, true, 0, fh * 0.12);   // entrance canopy
      glowPool(ctx, cam, lx, ly, lH * 0.62, '255,214,150', 18, alpha * (night ? 0.4 : 0.2));                       // interior spill up top
    }
    // 2. HANGAR — a smaller corrugated-STEEL shed standing to the LEFT (clear of the tower) under a
    //    curved BARREL ROOF, with an OPEN bay on the apron gable — a recessed dark interior, a floor,
    //    a parked-aircraft tail hint and warm spill — instead of a closed door.
    // A terminal standing beside a field's real hangar (`noShed`) leaves this one out.
    if (!m.noShed) { const hxL = -fh * 0.55, hw = fh * 0.5, wallTop = top * 0.52, archH = hw * 0.95;
      const [hx, hy] = F(hxL, 0);
      draw3DBoxAt(ctx, cam, hx, hy, hw, 0, wallTop, 'ty_hangarmetal', seed, night, alpha, false);                 // ribbed-steel walls (roof capped by the barrel)
      drawBarrelRoof(ctx, cam, F, hxL, hw, hw, wallTop, archH, 10, alpha, [138, 146, 156]);                        // curved corrugated roof + arched gables
      // Open bay on the apron-facing (+local-y) gable — only when that gable faces the camera.
      const [ox, oy] = F(0, 0), [f1x, f1y] = F(0, 1), FX = f1x - ox, FY = f1y - oy, [gcx, gcy] = F(hxL, hw);
      if (FX * gcx + FY * gcy - (FX * (cam.ex || 0) + FY * (cam.ey || 0)) < 0) {
        const P = (llx, lly, z) => { const [wx, wy] = F(llx, lly); return cam.proj(wx, wy, z); };
        const odw = hw * 0.58, oTop = wallTop * 0.82, inset = hw * 0.55;
        const o = [P(hxL - odw, hw + 0.003, 0), P(hxL + odw, hw + 0.003, 0), P(hxL + odw, hw + 0.003, oTop), P(hxL - odw, hw + 0.003, oTop)];
        // ⚠ Same missing probe as the lounge above, and the same fix. The MEAN depth minus a hair
        // is what makes this opening read as cut INTO the wall rather than stuck on it, so the
        // depth stays exactly as it was and all that is added is the question.
        // ⚠ THE RECESS IS SLID INTO THE GABLE — see emitRecessBay, and the Reach hangar's bay for
        // the same note at length. The back wall is BEHIND the opening it is painted over, so at
        // its own depth the buffer loses it and the recess comes out flat; slid along its own eye
        // ray into the plane of the gable it moves no pixel and becomes a flat world quad.
        const bayArt = (g) => {
          const trace = (pp) => { g.beginPath(); pp.forEach((p, i) => i ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)); g.closePath(); };
          g.globalAlpha = alpha;
          g.fillStyle = night ? 'rgba(46,40,30,0.96)' : 'rgba(16,18,22,0.97)'; trace(o); g.fill();   // dark opening
          const bk = [P(hxL - odw * 0.86, hw - inset, 0), P(hxL + odw * 0.86, hw - inset, 0), P(hxL + odw * 0.86, hw - inset, oTop * 0.9), P(hxL - odw * 0.86, hw - inset, oTop * 0.9)];
          if (bk.every(p => p.f > 0.1)) { g.fillStyle = night ? 'rgba(70,60,42,0.95)' : 'rgba(28,30,34,0.96)'; trace(bk); g.fill(); }   // recessed back wall = interior depth
          const fl = [P(hxL - odw, hw + 0.003, 0.006), P(hxL + odw, hw + 0.003, 0.006), P(hxL + odw * 0.86, hw - inset, 0.006), P(hxL - odw * 0.86, hw - inset, 0.006)];
          if (fl.every(p => p.f > 0.1)) { g.fillStyle = 'rgba(44,46,50,0.9)'; trace(fl); g.fill(); }   // interior floor
          const tb = P(hxL + odw * 0.15, hw - inset * 0.7, 0.01), tt = P(hxL + odw * 0.15, hw - inset * 0.7, oTop * 0.72), tn = P(hxL - odw * 0.35, hw - inset * 0.55, oTop * 0.28);
          if ([tb, tt, tn].every(p => p.f > 0.1)) { g.fillStyle = 'rgba(122,128,136,0.5)'; g.beginPath(); g.moveTo(tb.sx, tb.sy); g.lineTo(tt.sx, tt.sy); g.lineTo(tn.sx, tn.sy); g.closePath(); g.fill(); }   // parked-aircraft tail hint
          g.strokeStyle = 'rgba(8,10,12,0.9)'; g.lineWidth = 1.4; trace(o); g.stroke();   // opening frame
          g.globalAlpha = 1;
        };
        if (o.every(p => p.f > 0.1) && !emitRecessBay(ctx, cam, W3, hxL, hw, odw, oTop, inset,
          { open: night ? 'rgba(46,40,30,0.96)' : 'rgba(16,18,22,0.97)',
            back: night ? 'rgba(70,60,42,0.95)' : 'rgba(28,30,34,0.96)',
            floor: 'rgba(44,46,50,0.9)', tail: 'rgba(122,128,136,0.5)', edge: 'rgba(8,10,12,0.9)' },
          { x: odw * 0.15, t: 0.72, nx: -odw * 0.35, b: 0.28 }, alpha)) {
          const [bfx, bfy] = F(hxL, hw);
          if (!markHidden(cam, bfx, bfy, oTop, odw * 1.25)) emitFace(o.reduce((s, p) => s + p.f, 0) / 4 - 0.002, () => bayArt(ctx));
        }
        if (night) { const [obx, oby] = F(hxL, hw); glowPool(ctx, cam, obx, oby, wallTop * 0.3, '255,206,140', 12, alpha * 0.3); }   // warm spill from the open bay
      }
    }
    // 3. ATC TOWER — a rounded, high-detail control tower built from FACETED DRUMS (not boxes, so it
    //    doesn't read blocky): a splayed plinth, a banded tapering concrete shaft, a cantilevered
    //    catwalk gallery, and a wide CURTAIN-GLASS control cab drawn with a procedural per-facet
    //    reflection (bright sky sheen up top → deep sill, warm consoles at night) — no window grid —
    //    under an overhanging roof cap. Rooftop mast + whips; red obstruction + green↔white beacon.
    { const [txx, txy] = F(fh * 0.7, -fh * 0.55), big = m.big;   // stands ALONE back-right, clear of the hangar
      const cabTop = h * (big ? 2.0 : 1.65), galZ = cabTop * 0.72, plZ = cabTop * 0.1;
      const cabBot = galZ + cabTop * 0.03, roofTopZ = cabTop + cabTop * 0.05;
      drawFacetDrum(ctx, cam, txx, txy, 0, plZ, fh * 0.3, fh * 0.24, NF, alpha, concrete, concrete({ nl: 0.7 }));   // splayed plinth
      drawFacetDrum(ctx, cam, txx, txy, plZ, galZ, fh * 0.2, fh * 0.14, NF, alpha, concrete);                       // tapering shaft (one smooth cone)
      for (const t of [0.3, 0.55, 0.8]) { const z = plZ + (galZ - plZ) * t, r = fh * (0.2 + (0.14 - 0.2) * t); drawRing(ctx, cam, txx, txy, z, r + 0.004, NF, 'rgba(0,0,0,0.28)', 1, alpha); }   // poured-lift band rings
      drawFacetDrum(ctx, cam, txx, txy, galZ, cabBot, fh * 0.3, fh * 0.3, NF, alpha, steel(40, 44, 50), 'rgb(46,50,58)');   // cantilevered catwalk gallery
      drawRing(ctx, cam, txx, txy, cabBot + cabTop * 0.05, fh * 0.31, NF, 'rgba(150,160,172,0.75)', 1.2, alpha);            // gallery rail
      drawFacetDrum(ctx, cam, txx, txy, cabBot, cabTop, fh * 0.32, fh * 0.3, NF, alpha, glass);                             // curtain-glass control cab
      for (const t of [0.4, 0.72]) drawRing(ctx, cam, txx, txy, cabBot + (cabTop - cabBot) * t, fh * 0.315, NF, 'rgba(14,20,28,0.4)', 1, alpha);   // faint transom rings
      drawFacetDrum(ctx, cam, txx, txy, cabTop, roofTopZ, fh * 0.36, fh * 0.34, NF, alpha, steel(34, 38, 44), 'rgb(40,44,52)');   // overhanging roof cap
      const mastTop = cabTop + h * (big ? 0.5 : 0.4);
      mast(ctx, cam, txx, txy, roofTopZ, mastTop, alpha, now, seed + 6);                                            // antenna mast (draws its own red tip light)
      for (const s of [-0.018, 0.022]) {   // a couple of shorter whip antennas beside the mast
        emitWire(ctx, cam, [txx + s, txy, roofTopZ], [txx + s, txy, cabTop + h * 0.2], 1, 'rgba(40,44,50,0.9)', alpha);
      }
      if (night) {
        glowPool(ctx, cam, txx, txy, (cabBot + cabTop) / 2, '150,220,255', 10, alpha * 0.42);                   // lit cab halo
        // Civil rotating beacon: green & white pulses a half-cycle out of phase (seed + π).
        blinkLight(ctx, cam, txx, txy, cabTop + h * 0.05, '120,255,150', now, seed + 7, alpha, 2.1);
        blinkLight(ctx, cam, txx, txy, cabTop + h * 0.05, '235,245,255', now, seed + 7 + Math.PI, alpha, 1.9);
      }
      blinkLight(ctx, cam, txx, txy, mastTop, '255,70,70', now, seed + 6, alpha, 1.6);                           // red obstruction light at the mast tip
    }
    // 4. APRON — painted ramp markings on the tarmac (a taxiway centreline lead-in + tie-down
    //    circles), floodlit with blue edge lights at night.
    { ctx.globalAlpha = alpha; ctx.lineCap = 'round';
      const seg = (l0, l1, style, lw) => { const a = cam.proj(l0[0], l0[1], 0.02), b = cam.proj(l1[0], l1[1], 0.02); if (a.f > 0.1 && b.f > 0.1) { ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); } };
      for (let i = 0; i < 5; i++) { const y0 = fh * (0.6 - i * 0.3), y1 = y0 - fh * 0.16; seg(F(0, y0), F(0, y1), 'rgba(240,208,70,0.8)', Math.max(1.5, 6 / (cam.proj(dx, dy, 0.02).f || 1))); }   // yellow taxiway lead-in dashes
      for (const s of [-0.62, 0.62]) { const cc = F(s * fh, -fh * 0.1); const pts = []; let ok = true; for (let k = 0; k <= 12; k++) { const a = k / 12 * 6.2832, p = cam.proj(cc[0] + Math.cos(a) * fh * 0.12, cc[1] + Math.sin(a) * fh * 0.12, 0.02); if (p.f <= 0.1) { ok = false; break; } pts.push(p); } if (ok) { ctx.strokeStyle = 'rgba(230,236,240,0.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.stroke(); } }   // parking tie-down circles
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }
    if (night) {
      glowPool(ctx, cam, dx, dy, 0.02, '255,236,190', 30, alpha * 0.16);                                        // sodium apron floods
      for (const s of [-0.7, -0.23, 0.23, 0.7]) { const [ex, ey] = F(fh * s, fh * 0.95); blinkLight(ctx, cam, ex, ey, 0.02, '90,150,255', now, seed + s * 10, alpha, 1.3); }
      if (m.helipad) glowPool(ctx, cam, dx, dy, top + 0.01, '255,210,90', 14, alpha * 0.3);
    }
  },
  atc(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE CONTROL TOWER, about ten storeys (h). A tripod: a slim white core with three legs
    //              splaying out from under a glass equipment drum to a round glass podium, then a neck
    //              and a cab whose glass flares OUT (controllers look down on the apron, not at their
    //              own reflections), a flat roof, a turning radar and the mast. Coldwater dresses it in
    //              neon: magenta up the legs' outer edges and cyan round every rim. No sign: it is a tower.
    const NF = 20, NEON_A = '255,64,200', NEON_B = '80,236,255';
    const white = (f) => { const s = 0.66 + f.nl * 0.38; return `rgb(${226 * s | 0},${226 * s | 0},${222 * s | 0})`; };
    const steel = (r, g2, b) => (f) => { const s = 0.5 + f.nl * 0.5; return `rgb(${r * s | 0},${g2 * s | 0},${b * s | 0})`; };
    const glass = (f, tp, bt) => {
      const g = ctx.createLinearGradient(0, tp, 0, bt), s = 0.55 + f.nl * 0.45;
      if (night) {
        g.addColorStop(0, `rgba(${40 * s | 0},${120 * s | 0},${140 * s | 0},0.96)`);
        g.addColorStop(0.6, `rgba(${30 * s | 0},${84 * s | 0},${104 * s | 0},0.96)`);
        g.addColorStop(1, 'rgba(120,220,210,0.96)');                                          // the consoles, lit teal
      } else {
        g.addColorStop(0, `rgba(${70 + f.nl * 60 | 0},${120 + f.nl * 60 | 0},${120 + f.nl * 50 | 0},0.97)`);   // green-tinted curtain glass
        g.addColorStop(0.5, `rgba(${30 + f.nl * 40 | 0},${80 + f.nl * 50 | 0},${84 + f.nl * 40 | 0},0.97)`);
        g.addColorStop(1, `rgba(${14 + f.nl * 20 | 0},${40 + f.nl * 24 | 0},${46 + f.nl * 20 | 0},0.97)`);
      }
      return g;
    };
    const podH = h * 0.1, legTop = h * 0.595, eqBot = h * 0.6, eqTop = h * 0.7, neckTop = h * 0.735, cabTop = h * 0.9, roofTop = h * 0.915;
    // 1. The podium: a glass drum with a white base ring and a white lid.
    drawFacetDrum(ctx, cam, dx, dy, 0, podH * 0.18, fh * 0.6, fh * 0.6, NF, alpha, white);
    drawFacetDrum(ctx, cam, dx, dy, podH * 0.18, podH * 0.9, fh * 0.56, fh * 0.56, NF, alpha, glass);
    drawFacetDrum(ctx, cam, dx, dy, podH * 0.9, podH, fh * 0.6, fh * 0.6, NF, alpha, white, 'rgb(212,212,208)');
    // 2. The core, a plain white column from the podium to the drum.
    drawFacetDrum(ctx, cam, dx, dy, podH, eqBot, fh * 0.19, fh * 0.16, NF, alpha, white);
    // 3. The legs: three tapered white prisms from the podium's rim to just under the drum, each
    //    with a magenta neon line up its outer edge.
    const E3 = _bladeBasis.E, yaw0 = Math.atan2(E3[1], E3[0]);
    for (let k = 0; k < 3; k++) {
      const a = yaw0 + k * (Math.PI * 2 / 3), ux = Math.cos(a), uy = Math.sin(a), tx = -uy, ty = ux;
      const P = (r, t, d, z) => [dx + ux * (r + d) + tx * t, dy + uy * (r + d) + ty * t, z];
      const Rb = fh * 0.46, Rt = fh * 0.2, wb = fh * 0.15, wt = fh * 0.075, db = fh * 0.1, dt = fh * 0.05;
      const zb = podH + 0.003;   // standing ON the podium's lid and meeting the core at its skin, never inside either
      const b = [P(Rb, -wb, db, zb), P(Rb, wb, db, zb), P(Rb, wb, -db, zb), P(Rb, -wb, -db, zb)];
      const t = [P(Rt, -wt, dt, legTop), P(Rt, wt, dt, legTop), P(Rt, wt, -dt, legTop), P(Rt, -wt, -dt, legTop)];
      const shade = [0.98, 0.84, 0.62, 0.8];   // outer, one flank, inner, the other flank
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4, s = shade[i];
        emitDecoFill(ctx, cam, [b[i], b[j], t[j], t[i]], `rgb(${226 * s | 0},${226 * s | 0},${222 * s | 0})`, alpha, DECO_PULL, 'atc-leg', true);
      }
      const o0 = P(Rb, 0, db + 0.002, zb), o1 = P(Rt, 0, dt + 0.002, legTop);
      emitWire(ctx, cam, o0, o1, 2, `rgba(${NEON_A},0.95)`, alpha, { pull: DECO_PULL });
      if (night) glowPool(ctx, cam, (o0[0] + o1[0]) / 2, (o0[1] + o1[1]) / 2, (podH + legTop) / 2, NEON_A, 12, alpha * 0.35);
    }
    // 4. The equipment drum (glass, with white floor bands) and the neck up to the cab.
    drawFacetDrum(ctx, cam, dx, dy, eqBot, eqTop, fh * 0.3, fh * 0.3, NF, alpha, glass);
    for (const t of [0.34, 0.67]) drawRing(ctx, cam, dx, dy, eqBot + (eqTop - eqBot) * t, fh * 0.305, NF, 'rgba(220,224,222,0.8)', 1.4, alpha);
    drawFacetDrum(ctx, cam, dx, dy, eqTop, neckTop, fh * 0.22, fh * 0.2, NF, alpha, white, 'rgb(212,212,208)');
    // 5. The cab: glass flaring out, a white catwalk ring under it, the flat roof over it.
    drawFacetDrum(ctx, cam, dx, dy, neckTop, neckTop + h * 0.012, fh * 0.34, fh * 0.34, NF, alpha, white);
    drawFacetDrum(ctx, cam, dx, dy, neckTop + h * 0.012, cabTop, fh * 0.34, fh * 0.52, NF, alpha, glass);
    for (let i = 0; i < NF; i += 2) {
      const a = (i / NF) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
      emitWire(ctx, cam, [dx + c * fh * 0.345, dy + s2 * fh * 0.345, neckTop + h * 0.012], [dx + c * fh * 0.525, dy + s2 * fh * 0.525, cabTop], 1, 'rgba(10,20,22,0.7)', alpha, { pull: DECO_PULL });
    }
    drawFacetDrum(ctx, cam, dx, dy, cabTop, roofTop, fh * 0.54, fh * 0.54, NF, alpha, steel(54, 60, 66), 'rgb(66,72,78)');
    // 6. The neon rims: podium, drum top and bottom, the cab's lip.
    for (const [z, r] of [[podH, fh * 0.61], [eqBot, fh * 0.31], [eqTop, fh * 0.31], [cabTop, fh * 0.545]]) {
      drawRing(ctx, cam, dx, dy, z, r, NF, `rgba(${NEON_B},0.95)`, 2, alpha);
      if (night) glowPool(ctx, cam, dx, dy, z, NEON_B, 10, alpha * 0.3);
    }
    // 7. The radar turning on the roof, the mast beside it, and the beacon.
    const ang = (now || 0) * 0.0021 + seed, ca = Math.cos(ang) * fh * 0.22, sa = Math.sin(ang) * fh * 0.22, rz = roofTop + h * 0.05;
    drawFacetDrum(ctx, cam, dx, dy, roofTop, rz - h * 0.01, fh * 0.06, fh * 0.05, 8, alpha, steel(150, 154, 158), 'rgb(160,164,168)');
    emitWire(ctx, cam, [dx - ca, dy - sa, rz], [dx + ca, dy + sa, rz], 4, 'rgba(214,218,222,0.95)', alpha, { pull: DECO_PULL });
    const [mx, my] = F(fh * 0.34, -fh * 0.2), mastTop = roofTop + h * 0.12;
    mast(ctx, cam, mx, my, roofTop, mastTop, alpha, now, seed + 6);
    if (night) {
      glowPool(ctx, cam, dx, dy, (neckTop + cabTop) / 2, '120,230,220', 16, alpha * 0.45);
      blinkLight(ctx, cam, dx, dy, rz + h * 0.01, '120,255,150', now, seed + 7, alpha, 2.1);            // the aerodrome beacon: green and white
      blinkLight(ctx, cam, dx, dy, rz + h * 0.01, '235,245,255', now, seed + 7 + Math.PI, alpha, 1.9);
    }
  },
  arrivals(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // ARRIVALS: the field's passenger hall, two storeys under a shallow barrel roof, glazed
    //                   the full width of the airside front, a kerb canopy on columns, the livery band
    //                   along the fascia and the baggage train standing out on the apron.
    const hallTop = h * 0.78, hw = fh * 0.95, hd = fh * 0.62;
    draw3DBoxAt(ctx, cam, dx, dy, hw, 0, hallTop, 'ty_arrivals', seed, night, alpha, false, 0, hd);
    drawBarrelRoof(ctx, cam, F, 0, hw, hd, hallTop, h * 0.2, 12, alpha, [184, 192, 200]);
    { const [gx, gy] = F(0, hd + 0.003);
      draw3DBoxAt(ctx, cam, gx, gy, hw * 0.92, h * 0.04, hallTop * 0.84, 'ty_tower_slot', seed + 1, night, alpha, false, 0, 0.004);   // the airside glazing
      const [lx, ly] = F(0, hd + 0.006);
      draw3DBoxAt(ctx, cam, lx, ly, hw, hallTop * 0.87, hallTop, 'ty_airport_band', seed + 2, night, alpha, false, 0, 0.005); }       // the livery fascia
    // The kerb canopy: a thin slab out from the glass on four columns.
    { const cz = h * 0.4, [cx, cy] = F(0, hd + fh * 0.17);
      draw3DBoxAt(ctx, cam, cx, cy, hw * 0.8, cz, cz + h * 0.04, 'ty_precast_dk', seed + 3, night, alpha, true, 0, fh * 0.16);
      for (const s of [-0.7, -0.24, 0.24, 0.7]) { const [px, py] = F(hw * s, hd + fh * 0.3); emitWire(ctx, cam, [px, py, 0], [px, py, cz], 2, 'rgba(200,204,210,0.95)', alpha, { pull: DECO_PULL }); }
      if (night) glowPool(ctx, cam, cx, cy, cz * 0.5, '255,226,170', 18, alpha * 0.45); }
    // The baggage train on the apron: a tug in the livery and two trailers behind it.
    for (let i = 0; i < 3; i++) { const [bx, by] = F(-hw * 0.5 + i * fh * 0.2, hd + fh * 0.62);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.07, 0.004, h * 0.06, i ? 'ty_precast_dk' : 'ty_airport_band', seed + 10 + i, night, alpha, true, 0, fh * 0.05); }
    // The tower's neon: cyan along the canopy's front edge, magenta under the fascia, and the
    // airfield's one sign, a lit board on the fascia carrying the building's name.
    if (frontVis) { const cz = h * 0.44, [a0x, a0y] = F(-hw * 0.8, hd + fh * 0.33), [a1x, a1y] = F(hw * 0.8, hd + fh * 0.33);
      emitWire(ctx, cam, [a0x, a0y, cz], [a1x, a1y, cz], 2, 'rgba(80,236,255,0.95)', alpha, { pull: DECO_PULL });
      const [b0x, b0y] = F(-hw, hd + 0.008), [b1x, b1y] = F(hw, hd + 0.008);
      emitWire(ctx, cam, [b0x, b0y, hallTop * 0.86], [b1x, b1y, hallTop * 0.86], 2, 'rgba(255,64,200,0.95)', alpha, { pull: DECO_PULL });
      if (night) { glowPool(ctx, cam, (a0x + a1x) / 2, (a0y + a1y) / 2, cz, '80,236,255', 16, alpha * 0.3); glowPool(ctx, cam, (b0x + b1x) / 2, (b0y + b1y) / 2, hallTop * 0.86, '255,64,200', 16, alpha * 0.3); }
      marqueeBand(ctx, cam, dx, dy, _bladeBasis.E, hw * 0.62, hallTop * 0.935, '#50ecff', night, alpha); }   // flat on the fascia: the building's own name
    if (night) glowPool(ctx, cam, dx, dy, hallTop * 0.5, '255,222,166', 26, alpha * 0.35);   // the hall lit behind its glass
  },
  power(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE POWER PLANT — 5 tiles. It had the mass (five segments) and still scored
    //                  3/4, because all five were the same palette and, worse, the two COOLING
    //                  TOWERS WERE BOXES. A cooling tower is the most recognisable silhouette in
    //                  industry and the one thing about it that matters is that it is a waisted
    //                  drum; drawn as a stacked pair of cubes it reads as two more sheds.
    const shell = pal, deck = 'ty_precast_dk', band = 'ty_precast';
    // ⚠ `style` IS A FUNCTION OF THE FACET — see the ⚠ on the clinic's flue. `f.nl` is the facet's
    // own lambert term, which is what makes a drum read as round rather than as a faceted tube.
    const conc = (r, g2, b) => (f) => 'rgb(' + (r + f.nl * 46 | 0) + ',' + (g2 + f.nl * 46 | 0) + ',' + (b + f.nl * 44 | 0) + ')';
    for (const s of [-1, 1]) {
      const [cx, cy] = F(s * fh * 0.8, 0);
      // The hyperboloid, as two drums meeting at the throat: a wide splayed base pulling in, then
      // the flare back out to the rim. Two calls is the whole shape.
      const throat = h * 0.62, rim = h * 1.05;
      drawFacetDrum(ctx, cam, cx, cy, 0, throat, fh * 0.66, fh * 0.38, 12, alpha, conc(82, 80, 76), null);
      drawFacetDrum(ctx, cam, cx, cy, throat, rim, fh * 0.38, fh * 0.52, 12, alpha, conc(92, 90, 86), 'rgb(38,40,42)');
      // Two lift rings up the shell — the horizontals that say this thing is the size of a church.
      drawRing(ctx, cam, cx, cy, h * 0.22, fh * 0.56, 12, 'rgba(20,20,22,0.45)', 2, alpha);
      drawRing(ctx, cam, cx, cy, h * 0.44, fh * 0.46, 12, 'rgba(20,20,22,0.45)', 2, alpha);
      // The splayed feet — the ring of raking legs the shell actually stands on, and the gap under
      // it that stops the tower looking like it was pushed into the ground.
      for (let i = 0; i < 8; i++) { const a2 = i / 8 * Math.PI * 2;
        const [lx4, ly4] = F(s * fh * 0.8 + Math.cos(a2) * fh * 0.6, Math.sin(a2) * fh * 0.6);
        draw3DBoxAt(ctx, cam, lx4, ly4, fh * 0.05, 0, h * 0.1, deck, seed + 20 + i, night, alpha, false); }
      drawSmoke(ctx, cam, cx, cy, rim, '210,214,220', alpha * 0.8, now, seed + s + 1);
    }
    // The turbine hall between them: a long low shed, which is where the actual machinery is and
    // the reason the towers are there at all.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, 0, h * 0.42, deck, seed + 9, night, alpha, true, 0, fh * 0.5);
    { const [sx, sy] = F(0, -fh * 0.6);
      // The stack, BANDED. A chimney in one tone is a pole; the alternating courses are what give
      // it scale against the sky and they are the second palette the board was asking for.
      const N2 = 6, top = h * 1.7;
      for (let i = 0; i < N2; i++) { const z0 = top * (i / N2), z1 = top * ((i + 1) / N2);
        const r0 = fh * (0.3 - 0.08 * (i / N2)), r1 = fh * (0.3 - 0.08 * ((i + 1) / N2));
        drawFacetDrum(ctx, cam, sx, sy, z0, z1, r0, r1, 10, alpha,
          i % 2 ? conc(96, 52, 46) : conc(136, 134, 128), i === N2 - 1 ? 'rgb(40,38,36)' : null); }
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.34, 0, h * 0.14, band, seed + 10, night, alpha, false);   // the base block
      drawSmoke(ctx, cam, sx, sy, top, '72,66,60', alpha, now, seed + 4);
      blinkLight(ctx, cam, sx, sy, top, '255,80,80', now, seed, alpha); }
    // THE FRONT ENTRANCE. The hall is five tiles of blank precast wearing the kit's window grid,
    // and it had no way IN at all — which from a cab reads as a shed somebody parked two cooling
    // towers behind. A plant gate is the one thing a driver arriving at it looks for, so it gets
    // exactly what every other frontage in this city gets and nothing exotic: a recessed doorway
    // cut into the entrance wall, glazing either side of it so the ground floor is a lobby rather
    // than more precast, a canopy over the door and the lamps that go with it.
    //
    // ⚠ NEAR TIER, AND THAT IS THE POINT RATHER THAN A SAVING. `doorReveal` and `mullions` are
    // no-ops past `RENDER_TUNE.detailNear`, and from the air this building is its towers — the
    // entrance exists for the one seat that can see it.
    //
    // ⚠ AND THE WALL PLANE IS THE HALL'S OWN DEPTH, NOT `fh`. Both helpers take `fh` and resolve
    // the frontage as `min(fh, 0.44)`, which is `draw3DBoxAt`'s own clamp — and this hall is
    // drawn with a DEPTH half-extent of `fh * 0.5`, so handing them the bare `fh` would place the
    // door on a plane the building does not have and float it off the front.
    { const doorHw = fh * 0.16, doorTop = h * 0.24, wallY = Math.min(fh * 0.5, 0.44);
      doorReveal(ctx, cam, dx, dy, E, fh * 0.5, doorHw, 0, doorTop, seed + 30, night, alpha);
      mullions(ctx, cam, dx, dy, E, fh * 0.5, doorHw, h * 0.05, doorTop * 0.92, seed + 31, night, alpha);
      awning(ctx, cam, dx, dy, E, doorHw * 2.1, wallY + fh * 0.09, doorTop, doorTop + h * 0.045, deck, seed + 32, night, alpha, fh * 0.09);
      if (night) {
        const [gx2, gy2] = facePt(dx, dy, 0, wallY + fh * 0.05, E);
        glowPool(ctx, cam, gx2, gy2, doorTop * 0.55, '255,206,140', 12, alpha * 0.40);          // the spill out of the lobby
        for (const s of [-1, 1]) { const [lx2, ly2] = facePt(dx, dy, s * doorHw * 2.4, wallY, E);
          glowPool(ctx, cam, lx2, ly2, doorTop * 1.02, '255,214,150', 7, alpha * 0.5); }        // a bulkhead lamp either side
      }
    }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.42, '255,196,120', 18, alpha * 0.3);   // the hall, lit all night
  },
  bar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // narrow street-corner bar — a taller slim box, a lit door awning + a neon blade
    // A single slim extrusion 0 … 0.95 with a door awning stuck on it. A corner bar is the most
    // street-level building there is — the room you can see into is the whole point — so the one
    // thing it must have is a ground floor that reads as different from the flats over it.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.86, 0, h * 0.30, facePals(E, { side: pal, front: 'ty_shop_e' }), seed + 4, night, alpha, false);   // the bar room, glazed to the street
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, h * 0.30, h * 0.35, pal, seed + 5, night, alpha, false);    // fascia over the window
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, h * 0.35, h * 0.9, pal, seed, night, alpha, false);        // flats above, set back
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.84, h * 0.9, h * 0.97, pal, seed + 6, night, alpha, true);     // parapet
    awning(ctx, cam, dx, dy, E, fh * 0.78, fh * 0.92, h * 0.18, h * 0.30, 'ty_door', seed + 1, night, alpha, fh * 0.26);   // door awning, tucked under the fascia
    { const [nx, ny] = F(fh * 0.5, fh * 0.88); neonBlade(ctx, cam, nx, ny, h * 0.35, h * 1.2, m.neon || '#5fd0ff', night, alpha); }
    if (night) glowPool(ctx, cam, dx, dy, h * 0.2, '120,220,255', 9, alpha * 0.2);
  },
  honkytonk(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // roadhouse — a long low shed behind a raised painted false front, a porch
    // ⚠ IT STILL LIES DOWN — the sill below is FOUR AND A HALF HUNDREDTHS of a storey, and the
    // shape argument above is untouched. A roadhouse stands on a boardwalk, and that step is what
    // separates the shed from the dirt it is parked on; at this scale it reads as a shadow line
    // under the porch, which is exactly what it is.
    const hw = fh * 1.14, wallTop = h * 0.46, frontTop = h * 0.74;
    // ⚠ THE SHED IS NARROWER THAN THE BOARDWALK, AND IT HAS TO BE SET THAT WAY ROUND. `hw` is
    // fh*1.14 = 0.456, and `draw3DBoxAt` CLAMPS a half-width to 0.44 — so a sill authored at
    // `hw * 1.03` clamps to 0.44 as well and comes out exactly the width of the shed on top of it.
    // The step was drawn, costed, and invisible; the width census caught it as "4 segments, ONE
    // distinct half-width", which is a single extrusion wearing a z-band. Everything at or above
    // the clamp is the same width, so articulation there has to be made by bringing the other box
    // IN, never by pushing this one out.
    const shedHw = fh * 1.05;
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.03, 0, h * 0.045, pal, seed + 6, night, alpha, false);        // the boardwalk it stands on
    draw3DBoxAt(ctx, cam, dx, dy, shedHw, h * 0.045, wallTop, pal, seed, night, alpha, false);         // the shed itself
    { const [fx, fy] = F(0, fh * 0.88);                                                                  // false front, standing proud of the roof
      draw3DBoxAt(ctx, cam, fx, fy, hw, wallTop, frontTop, 'ty_honky_front', seed + 1, night, alpha, true, Math.atan2(-E[0], E[1]), fh * 0.20); }
    awning(ctx, cam, dx, dy, E, hw * 0.96, fh * 1.04, wallTop * 0.52, wallTop * 0.80, 'ty_honky_porch', seed + 2, night, alpha, fh * 0.44);   // porch, full width
    if (frontVis) neonBlade(ctx, cam, dx, dy, frontTop, frontTop + h * 0.46, m.neon || '#ff5fa8', night, alpha);   // the boot, in pink
    if (night) { const [gx, gy] = F(0, fh * 1.12); glowPool(ctx, cam, gx, gy, wallTop * 0.42, '255,158,96', 12, alpha * 0.30); }   // warm spill out the door
  },
  club(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // box + twin neon roofline + colour glow
    // ⚠ ONE BOX AND TWO BLADES IS NOT A CLUB, IT IS A BLADE RACK. This arm drew a single slab
    // 0 … 0.8 and hung the whole identity on the neon, so by daylight it was a plain cube and at
    // any angle the twin blades read as standing beside a wall rather than on a building. A
    // silhouette is what carries at street distance, and the kit cannot supply one: it dresses
    // mass and never adds any.
    //
    // A club is a windowless box with a HEAVY base, because the queue, the door and the bouncer
    // all live on the ground floor and that floor is built wider and darker than the slab above
    // it — which is also what gives the blades something to stand on.
    { const [ex, ey] = F(0, fh * 0.2);
      draw3DBoxAt(ctx, cam, ex, ey, fh * 1.12, 0, h * 0.26, facePals(E, { side: pal, front: 'ty_shop_e' }), seed + 7, night, alpha, false); }   // entrance block, out past the slab
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.26, h * 0.78, pal, seed, night, alpha, false);       // the windowless slab itself
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, h * 0.78, h * 0.88, 'ty_precast_dk', seed + 1, night, alpha, true);   // crown band the blades stand on
    { const [ax, ay] = F(-fh * 0.4, 0); neonBlade(ctx, cam, ax, ay, h * 0.88, h * 1.2, m.neon || '#ff4a9a', night, alpha); }
    { const [bx, by] = F(fh * 0.4, 0); neonBlade(ctx, cam, bx, by, h * 0.88, h * 1.2, m.neon || '#ff4a9a', night, alpha); }
    glowPool(ctx, cam, dx, dy, h * 0.9, '255,74,154', 20, alpha * (night ? 0.34 : 0.16));
  },
  diner(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // streamline diner — a long low stainless car under a curved barrel roof, glazed front, counter awning, rooftop neon
    // ⚠ IT IS STILL A STREAMLINE CAR AND THE BARREL IS UNTOUCHED. A diner of this period sits on a
    // stainless skirt with a shadow line under it — the car is meant to look like it could be towed
    // away, and the skirt is what sells that. Without it the body grows out of the tarmac.
    const hw = fh * 1.12, wallTop = h * 0.52, archH = hw * 0.34;
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.03, 0, h * 0.05, pal, seed + 5, night, alpha, false);                     // stainless skirt
    draw3DBoxAt(ctx, cam, dx, dy, hw, h * 0.05, wallTop, pal, seed, night, alpha, false);                          // diner body (roof left open for the barrel)
    drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.9, wallTop, archH, 12, alpha, [150, 150, 156]);                      // curved streamline stainless roof
    awning(ctx, cam, dx, dy, E, fh * 1.06, fh * 1.05, wallTop * 0.42, wallTop * 0.64, 'ty_door', seed + 1, night, alpha, fh * 0.30);   // counter awning faces the street
    neonBlade(ctx, cam, dx, dy, wallTop + archH, wallTop + archH + h * 0.42, m.neon || '#ffcf3e', night, alpha);   // rooftop neon sign
    if (night) { const [wx, wy] = F(0, fh * 0.92); glowPool(ctx, cam, wx, wy, wallTop * 0.5, '255,200,120', 13, alpha * 0.26); }   // warm window band
  },
  laundromat(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Wash: a low flat-roofed shopfront that is mostly window — the one place on Ironside you can see all the way into from the street
    // ⚠ STILL ONE STOREY, AND THAT PART OF THE COMMENT ABOVE IS RIGHT. What it was missing is not
    // height, it is the two courses every shopfront has whatever its height: something at the
    // pavement for the wall to land on, and a fascia at the head of the glass. Without them a
    // glazed box meets the ground on a drawn line and stops at the top on another one.
    const hw = fh * 1.1, wallTop = h * 0.56;
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.04, 0, h * 0.04, pal, seed + 4, night, alpha, false);                     // kerb plinth
    draw3DBoxAt(ctx, cam, dx, dy, hw, h * 0.04, wallTop, pal, seed, night, alpha, false);                          // the single storey
    { const [gx, gy] = F(0, fh * 0.96); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.96, h * 0.04, wallTop * 0.84, 'ty_marble_col', seed + 1, night, alpha, false); }  // the big glazed front
    draw3DBoxAt(ctx, cam, dx, dy, hw * 1.03, wallTop, wallTop + h * 0.05, pal, seed + 5, night, alpha, true);      // fascia at the head of the glass
    neonBlade(ctx, cam, dx, dy, wallTop + h * 0.05, wallTop + h * 0.34, m.neon || '#7fe3ff', night, alpha);        // cold-blue WASH sign
    // Lit all night, deliberately: this is the building that says somebody is still open.
    if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, wallTop * 0.6, '210,235,255', 18, alpha * 0.34); }
  },
  armory(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ironside Arms: a squat riveted blockhouse — heavy overhanging parapet, vault door, slit-window glow
    // A squat blockhouse stays squat. What it gains is the course at the pavement — a bunker is the
    // one building that really does sit on a plinth, and the arm was landing 1.15 of wall straight
    // onto the ground.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.2, 0, h * 0.07, pal, seed + 5, night, alpha, false);         // plinth
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, h * 0.07, h * 0.7, pal, seed, night, alpha, false);      // bunker box
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, h * 0.7, h * 0.82, pal, seed + 1, night, alpha, true);   // thick overhanging parapet
    { const [gx, gy] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.46, h * 0.07, h * 0.4, 'ty_door', seed + 2, night, alpha, false); }   // vault door
    if (night) { const [wx, wy] = F(fh * 0.5, fh * 0.9); glowPool(ctx, cam, wx, wy, h * 0.34, '255,140,80', 6, alpha * 0.22); }   // amber slit window
    neonBlade(ctx, cam, dx, dy, h * 0.82, h * 1.06, m.neon || '#ff6a4a', night, alpha);               // small hard sign
  },
  casino(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // A squat house drowned in neon. The neon was fine and the HOUSE was two boxes
    //                  in one colour — so at noon, when none of the neon is doing anything, it was
    //                  a grey shed. A casino's daytime silhouette is a windowless box with a
    //                  PORTE-COCHÈRE: the covered drive you are set down under, which is the one
    //                  piece of architecture the whole building type is organised around.
    const neon = m.neon || '#ff3e8a';
    const crown = 'ty_precast', plinth = 'ty_precast_dk';
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, 0, h * 0.1, plinth, seed + 7, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.15, h * 0.1, h * 0.7, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.22, h * 0.7, h * 0.9, crown, seed + 1, night, alpha, true); // marquee crown band
    // The porte-cochère: a deep canopy out over the kerb on two columns.
    { const [cx3, cy3] = F(0, fh * 1.28);
      draw3DBoxAt(ctx, cam, cx3, cy3, fh * 0.62, h * 0.30, h * 0.38, crown, seed + 8, night, alpha, true, 0, fh * 0.42);
      for (const s of [-1, 1]) { const [ox, oy] = F(s * fh * 0.5, fh * 1.6);
        draw3DBoxAt(ctx, cam, ox, oy, fh * 0.07, 0, h * 0.30, plinth, seed + 9 + (s > 0 ? 1 : 0), night, alpha, false); }
      if (night) glowPool(ctx, cam, cx3, cy3, h * 0.28, '255,210,150', 15, alpha * 0.55); }   // the drive, lit
    { const [ax, ay] = F(-fh * 0.5, 0); neonBlade(ctx, cam, ax, ay, h * 0.9, h * 1.3, neon, night, alpha); }
    { const [bx, by] = F(fh * 0.5, 0); neonBlade(ctx, cam, bx, by, h * 0.9, h * 1.3, neon, night, alpha); }
    for (const s of [-0.7, -0.24, 0.24, 0.7]) { const [lx, ly] = F(s * fh, fh * 0.9); blinkLight(ctx, cam, lx, ly, h * 0.92, '255,210,90', now, seed + s * 9, alpha, 1.7); }   // chasing marquee bulbs
    glowPool(ctx, cam, dx, dy, h * 0.86, '255,62,138', 22, alpha * (night ? 0.4 : 0.2));           // neon wash
  },
  neonvig(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Lucky Bastard — the city's casino, promoted off the generic `casino` box into a
    //                    landmark: a stepped marquee crown over a squat plum house, a TALL blade-sign
    //                    tower with bulbs chasing up it, a porte-cochère over the entrance, a lit
    //                    rooftop drum, and enough magenta spill to read from the far side of the basin.
    const neon = m.neon || '#ff3e8a';
    const houseTop = h * 0.72, crownTop = h * 0.95;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.16, 0, houseTop, pal, seed, night, alpha, true);                    // the house
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.26, houseTop, crownTop, 'ty_vig_trim', seed + 1, night, alpha, true); // stepped marquee crown
    // Sign tower — the tall vertical that makes it a landmark rather than a shed.
    { const [tx, ty] = F(-fh * 0.72, -fh * 0.2);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.26, 0, h * 1.9, 'ty_vig_trim', seed + 2, night, alpha, true);
      neonBlade(ctx, cam, tx, ty, h * 0.9, h * 2.35, neon, night, alpha);                                     // the blade itself
      for (let k = 0; k < 7; k++) blinkLight(ctx, cam, tx, ty, h * (0.95 + k * 0.2), '255,210,90', now, seed + k * 3, alpha, 1.8);   // bulbs chasing up the tower
      blinkLight(ctx, cam, tx, ty, h * 1.95, '255,80,80', now, seed, alpha, 2.0); }                           // aviation light on top
    // Rooftop drum — a lit cupola over the gaming floor.
    drawFacetDrum(ctx, cam, dx, dy, crownTop, crownTop + h * 0.26, fh * 0.42, fh * 0.42, 12, alpha,
      (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${112 * sh | 0},${62 * sh | 0},${92 * sh | 0})`; }, 'rgb(70,38,58)');
    drawRing(ctx, cam, dx, dy, crownTop + h * 0.26, fh * 0.44, 14, night ? 'rgba(255,62,138,0.85)' : 'rgba(255,140,190,0.45)', 2, alpha);
    // Porte-cochère over the entrance + marquee band on the frontage.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, houseTop * 1.02, neon, night, alpha);
    { const [cx, cy] = F(0, fh * 1.05); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.62, h * 0.30, h * 0.38, 'ty_vig_trim', seed + 6, night, alpha, false);
      for (const s of [-1, 1]) { const [px, py] = F(s * fh * 0.5, fh * 1.05); draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, h * 0.30, 'ty_vig_trim', seed + 7 + s, night, alpha, false); } }   // canopy + its posts
    for (const s of [-0.78, -0.26, 0.26, 0.78]) { const [lx, ly] = F(s * fh, fh * 0.98); blinkLight(ctx, cam, lx, ly, crownTop * 0.99, '255,210,90', now, seed + s * 9, alpha, 1.7); }   // parapet bulbs
    glowPool(ctx, cam, dx, dy, houseTop * 0.9, '255,62,138', 30, alpha * (night ? 0.55 : 0.24));              // the wash
    if (night) glowPool(ctx, cam, dx, dy, h * 0.10, '255,150,200', 16, alpha * 0.3);                          // pavement spill at the doors
  },
  reefer(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Coldline Reefer Depot — twin of Basin Cold Store (a plain insulated block). Reads
    //                   differently by being a PLANT plus a long rank of white reefer containers on
    //                   plug-in racks, each with its own blue compressor light, under one tall ammonia stack.
    const blockTop = h * 0.52;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.78, 0, blockTop, pal, seed, night, alpha, true);                     // compressor plant (smaller than the twin's block)
    for (const s of [-0.3, 0.3]) { const [ux, uy] = F(s * fh * 0.5, -fh * 0.1); draw3DBoxAt(ctx, cam, ux, uy, fh * 0.18, blockTop, blockTop + h * 0.14, 'ty_cold_unit', seed + 3 + s * 5, night, alpha, true); }
    // The rank of reefers — an ordered LINE (the twin's containers are a random 3×3 scatter).
    for (let k = -2; k <= 2; k++) {
      const [bx, by] = F(k * fh * 0.42, fh * 0.72);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.19, 0, h * 0.30, 'ty_reefer', seed + 10 + k, night, alpha, true);
      blinkLight(ctx, cam, bx, by, h * 0.32, '110,190,255', now, seed + k * 7, alpha, 1.4);                   // compressor running light
    }
    { const [sx, sy] = F(fh * 0.55, -fh * 0.35);                                                              // ammonia stack
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.10, 0, h * 1.5, 'ty_cold_unit', seed + 20, night, alpha, false);
      drawSmoke(ctx, cam, sx, sy, h * 1.5, '190,205,215', alpha * 0.5, now, seed + 21); }
    glowPool(ctx, cam, dx, dy, h * 0.20, '150,200,230', 16, alpha * (night ? 0.36 : 0.2));                    // cold breath, pooled low
  },
  interstack(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Interchange Stack — twin of Coldwater Container Yard (a loose 3×3 scatter ≤3 high).
    //                     Reads differently by being ORDERED and TALLER: two regimented rows stacked 4–5
    //                     high, straddled by a blue rail-mounted gantry crane. The crane is the tell.
    const cols = ['ty_cont_r', 'ty_cont_b', 'ty_cont_g', 'ty_cont_y'];
    const hsh = (a) => { a = (a ^ 61) ^ (a >> 16); a += a << 3; a ^= a >> 4; a = Math.imul(a, 0x27d4eb2d); return (a ^ (a >> 15)) >>> 0; };
    for (const row of [-0.5, 0.5]) for (let k = -2; k <= 2; k++) {
      const stack = 4 + hsh(seed + k * 11 + row * 31) % 2;                                                    // 4..5 high — over the twin's 1..3
      const [bx, by] = F(k * fh * 0.40, row * fh * 0.62);
      for (let z = 0; z < stack; z++) draw3DBoxAt(ctx, cam, bx, by, fh * 0.18, h * 0.20 * z, h * 0.20 * (z + 1), cols[hsh(seed + k * 3 + z * 5 + row * 17) & 3], seed + z, night, alpha, true);
    }
    // Rail gantry straddling both rows: two portal legs + a spanning girder + a trolley.
    const gTop = h * 1.25;
    for (const s of [-1, 1]) { const [lx, ly] = F(s * fh * 1.0, -fh * 0.05); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.07, 0, gTop, 'ty_gantry', seed + 40 + s, night, alpha, false); }
    { const [l0x, l0y] = F(-fh * 1.0, -fh * 0.05), [l1x, l1y] = F(fh * 1.0, -fh * 0.05);
      emitWire(ctx, cam, [l0x, l0y, gTop], [l1x, l1y, gTop], 4, 'rgba(58,92,132,0.95)', alpha, { pull: DECO_PULL }); }
    // ⚠ THE TROLLEY IS THIS BUILDING'S OWN TELL AND IT WAS BOLTED DOWN. The comment at the head of
    // this arm says the crane is what separates the Stack from its twin, and the crane's only
    // moving part was a box parked at x = 0.25 for ever. It runs its beam now — which is why it
    // is no longer MASS (see the ⚠ over `motionOn`); the LEGS and the GIRDER still are, and they
    // are what you collide with, because they are the parts that are always in the same place.
    { const gp = motionPhase(now, seed + 31, 28000, 0.5), gu = gp < 0 ? 0 : gp;
      let gx = moveSeg(gu, 0.00, 0.20, 0.25, -0.78);      // out to the far end of the beam
      gx = moveSeg(gu, 0.52, 0.74, gx, 0.62);             // …and back down it with the box
      gx = moveSeg(gu, 0.90, 1.00, gx, 0.25);             // …then home, which is where u = 0 leaves it
      let gk = moveSeg(gu, 0.20, 0.34, 0.94, 0.30);
      gk = moveSeg(gu, 0.40, 0.52, gk, 0.94);
      gk = moveSeg(gu, 0.74, 0.84, gk, 0.36);
      gk = moveSeg(gu, 0.86, 0.90, gk, 0.94);
      const [tx, ty] = F(gx * fh, -fh * 0.05), tz = gTop - h * 0.12;
      movingBox(ctx, cam, tx, ty, tz, gTop, fh * 0.13, fh * 0.10, [58, 92, 132], alpha, night, faceYaw(E));
      hoistLine(ctx, cam, tx, ty, tz, h * 0.18 + (tz - h * 0.34) * gk, fh, alpha, night,
        gu > 0.37 && gu < 0.85 ? { h: h * 0.20, hx: fh * 0.18, hy: fh * 0.16, rgb: [150, 66, 54] } : null, faceYaw(E));
      blinkLight(ctx, cam, tx, ty, gTop + 0.004, '255,190,80', now, seed + 46, alpha, 1.6);                   // the beacon rides the trolley
      if (night) glowPool(ctx, cam, tx, ty, tz - h * 0.04, '255,206,140', 9, alpha * 0.3); }                  // the trolley's work lamp, and the box under it
  },
  foundry(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Ferro Fabrication Works — twin of Fabrication Shed (open shed + gantry + one flue).
    //                    Reads differently as a real FOUNDRY: a fat cupola furnace with a glowing mouth,
    //                    TWIN tall chimneys pushing heavy smoke, and a slag heap cooling out back.
    const shedTop = h * 0.5;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.0, 0, shedTop, pal, seed, night, alpha, true);                       // melt house
    { const [fx, fy] = F(-fh * 0.15, -fh * 0.1);                                                              // cupola furnace — a fat drum
      drawFacetDrum(ctx, cam, fx, fy, 0, h * 1.05, fh * 0.34, fh * 0.30, 12, alpha,
        (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${96 * sh | 0},${84 * sh | 0},${76 * sh | 0})`; }, 'rgb(62,54,50)');
      drawRing(ctx, cam, fx, fy, h * 0.34, fh * 0.35, 12, 'rgba(255,120,40,0.55)', 2, alpha);                 // glowing tap ring
      glowPool(ctx, cam, fx, fy, h * 0.30, '255,120,40', 14, alpha * (night ? 0.55 : 0.3)); }                 // the pour
    for (const s of [-1, 1]) { const [sx, sy] = F(s * fh * 0.62, -fh * 0.45);                                 // twin chimneys
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.12, 0, h * 1.95, 'ty_foundry_stack', seed + 50 + s, night, alpha, false);
      blinkLight(ctx, cam, sx, sy, h * 1.95, '255,80,70', now, seed + 52 + s, alpha, 1.5);
      drawSmoke(ctx, cam, sx, sy, h * 1.95, '86,80,74', alpha * 0.8, now, seed + 54 + s); }
    { const [hx, hy] = F(fh * 0.72, fh * 0.7); draw3DBoxAt(ctx, cam, hx, hy, fh * 0.34, 0, h * 0.18, 'ty_slag', seed + 60, night, alpha, true);
      if (night) glowPool(ctx, cam, hx, hy, h * 0.16, '255,90,40', 8, alpha * 0.35); }                        // slag heap, still cooling
  },
  oldoffice(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Meltwater Freight Office — twin of Yards Freight Office (a tidy 2-storey + sign band).
    //                     Meltwater Row is the older, grimier end of town, so this one is BRICK and taller:
    //                     three storeys with a stepped parapet, a rooftop water tank on legs, and a
    //                     zig-zag external fire stair up the flank.
    const top = h * 1.25;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, top, pal, seed, night, alpha, true);                          // brick block
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.98, top, top + h * 0.09, pal, seed + 1, night, alpha, true);         // stepped parapet cap
    { const [tx, ty] = F(-fh * 0.3, -fh * 0.25);                                                              // rooftop water tank on legs
      for (const [lx0, ly0] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
        const [lx, ly] = F(-fh * 0.3 + lx0 * fh, -fh * 0.25 + ly0 * fh);
        draw3DBoxAt(ctx, cam, lx, ly, fh * 0.03, top + h * 0.09, top + h * 0.30, 'ty_melt_tank', seed + 70, night, alpha, false);
      }
      drawFacetDrum(ctx, cam, tx, ty, top + h * 0.30, top + h * 0.62, fh * 0.22, fh * 0.22, 10, alpha,
        (f) => { const sh = 0.5 + f.nl * 0.5; return `rgb(${88 * sh | 0},${80 * sh | 0},${70 * sh | 0})`; }, 'rgb(60,54,48)'); }
    { const [fx, fy] = F(fh * 0.95, 0);                                                                       // external fire stair — three zig-zag flights
      for (let k = 0; k < 3; k++) {
        emitWire(ctx, cam, [fx, fy, h * (0.2 + k * 0.35)], [fx, fy + (k % 2 ? -fh * 0.3 : fh * 0.3), h * (0.55 + k * 0.35)], 2, 'rgba(58,52,48,0.9)', alpha);
      } }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, h * 0.34, m.neon || '#ffb43a', night, alpha);          // sign band low on the frontage, not up top
    if (night) glowPool(ctx, cam, dx, dy, h * 0.3, '255,190,120', 9, alpha * 0.2);
  },
  bonded(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Customs Bonded Store 7 — twin of Dry Store 12 (the same barrel-roof shed). "Bonded"
    //                   means sealed and watched, so this one sits inside a LIT COMPOUND: perimeter fence,
    //                   four corner floodlight masts, a guard box at the gate, and a green customs seal.
    const hw = fh * 1.0, wallTop = h * 0.46, archH = hw * 0.40;
    draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, pal, seed, night, alpha, false);
    drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.92, wallTop, archH, 12, alpha, [118, 124, 130]);
    // Perimeter fence — a low run around the compound.
    for (const [ax, ay, bx, by] of [[-1.3, -1.3, 1.3, -1.3], [1.3, -1.3, 1.3, 1.3], [1.3, 1.3, -1.3, 1.3], [-1.3, 1.3, -1.3, -1.3]]) {
      const [p0x, p0y] = F(ax * fh, ay * fh), [p1x, p1y] = F(bx * fh, by * fh);
      emitWire(ctx, cam, [p0x, p0y, h * 0.16], [p1x, p1y, h * 0.16], 1.4, 'rgba(70,74,78,0.9)', alpha * 0.8);
    }
    for (const [sx, sy] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {   // corner floodlight masts
      const [mx, my] = F(sx * fh, sy * fh);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.05, 0, h * 0.95, 'ty_bond_fence', seed + 80 + sx * 3 + sy, night, alpha, false);
      if (night) glowPool(ctx, cam, mx, my, h * 0.9, '255,240,200', 10, alpha * 0.34);
    }
    { const [gx, gy] = F(-fh * 0.9, fh * 1.3); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.20, 0, h * 0.26, 'ty_guard', seed + 90, night, alpha, true);
      if (night) glowPool(ctx, cam, gx, gy, h * 0.2, '255,220,160', 5, alpha * 0.3); }                         // guard box at the gate
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh, wallTop * 1.04, m.neon || '#6affa8', night, alpha);      // customs seal band
    glowPool(ctx, cam, dx, dy, h * 0.22, '106,255,168', 12, alpha * (night ? 0.28 : 0.14));
  },
  pawn(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Pawn & Pity: grimy box, barred storefront, three hanging pawn spheres, a half-dead sign
    // One box with a barred band painted across it. A pawnbroker is a shopfront with somebody
    // living over it — the barred window is the ground floor, not the whole building — so it gets
    // the same shopfront / fascia / floors / parapet stack the rest of the street has.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, h * 0.26, pal, seed + 4, night, alpha, false);          // barred shopfront
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, h * 0.26, h * 0.31, pal, seed + 5, night, alpha, false);  // fascia
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, h * 0.31, h * 0.68, pal, seed, night, alpha, false);      // the rooms above
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, h * 0.68, h * 0.75, pal, seed + 6, night, alpha, true);   // parapet
    { const [gx, gy] = F(0, fh * 0.95); draw3DBoxAt(ctx, cam, gx, gy, fh * 1.0, h * 0.08, h * 0.18, 'ty_door', seed + 1, night, alpha, false); }   // barred storefront band
    // ⚠ THE SPHERES COME DOWN WITH THE ROOFLINE. They hung at 0.9/0.78/0.66 against a box that
    // stopped at 0.72, so two of the three were already above the roof; against a parapet at 0.75
    // all three would have been. Three balls hang over a pawnbroker's DOOR, which is where they
    // are now — beside the shopfront, under the fascia.
    { const [px, py] = F(fh * 0.6, fh * 0.62); for (const z of [0.5, 0.41, 0.32]) blinkLight(ctx, cam, px, py, h * z, '255,206,80', now, seed + 20 + z * 10, alpha, 1.5); }   // three hanging spheres
    neonBlade(ctx, cam, dx, dy, h * 0.75, h * 1.02, m.neon || '#ffcf3e', night, alpha);
    if (night) glowPool(ctx, cam, dx, dy, h * 0.2, '210,180,110', 8, alpha * 0.14);                    // dim barred-window glow
  },
  chemsupply(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Screw It: a chem depot — roof storage tank, stacked drums out front, a hazard-green wash
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.25, 0, h * 0.62, pal, seed, night, alpha, true);          // depot shed
    { const [tx, ty] = F(-fh * 0.5, 0); draw3DBoxAt(ctx, cam, tx, ty, fh * 0.34, h * 0.62, h * 0.95, pal, seed + 2, night, alpha, true); }   // roof storage tank
    for (const s of [-0.6, 0, 0.6]) { const [ox, oy] = F(s * fh * 0.7, fh * 0.9); draw3DBoxAt(ctx, cam, ox, oy, fh * 0.2, 0, h * 0.22, 'ty_door', seed + 5 + s * 3, night, alpha, true); }   // drums out front
    neonBlade(ctx, cam, dx, dy, h * 0.62, h * 0.9, m.neon || '#7dff6a', night, alpha);
    glowPool(ctx, cam, dx, dy, h * 0.28, '120,220,120', 12, alpha * (night ? 0.3 : 0.16));         // hazard-green wash
  },
  // ── Marrow Street, the workaday downtown strip ────────────────────────────
  // Deliberately LOW and cluttered where the rest of the skyline is tall and clean:
  // these read as a high street from the air because of what's on the pavement and
  // venting off the roof, not because of height. The Sentinel anchors the row.
  deptstore(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Adequate! — a four-floor discount slab wearing one enormous banner, plant all over the roof
    const body = h * 1.28;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.24, 0, body, pal, seed, night, alpha, true);
    const banZ0 = body * 0.70, banZ1 = body * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.30, banZ0, banZ1, 'ty_door', seed + 1, night, alpha, false);   // the banner, wrapping the whole facade
    roofClutter(ctx, cam, dx, dy, fh * 1.24, body, 'citycore', seed + 2, night, alpha, now);
    // "ADEQUATE!" painted the full width of the banner. The zone prose promises letters
    // tall enough to read from the water, so it's surface text on the banner's real quad
    // — it leans and foreshortens with the face instead of billboarding at the camera.
    if (frontVis) {
      const bhw = fh * 1.14, [blx, bly] = F(-bhw, fh * 1.32), [brx, bry] = F(bhw, fh * 1.32);
      const TL = cam.proj(blx, bly, banZ1 - body * 0.012), TR = cam.proj(brx, bry, banZ1 - body * 0.012);
      const BR = cam.proj(brx, bry, banZ0 + body * 0.012), BL = cam.proj(blx, bly, banZ0 + body * 0.012);
      if ([TL, TR, BR, BL].every(p => p.f > 0.12)) {
        const tex = bakeSignText('ADEQUATE!', m.neon || '#ff8a2e', night ? 1 : 0, false);
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha);
      }
      const [nx, ny] = F(fh * 0.70, fh * 1.02); neonBlade(ctx, cam, nx, ny, body * 0.88, body + h * 0.34, m.neon || '#ff8a2e', night, alpha);
    }
    { const [bx, by] = F(fh * 0.90, -fh * 0.60); blinkLight(ctx, cam, bx, by, body + h * 0.03, '255,150,90', now, seed + 9, alpha, 1.8); }   // one roof bulb nobody ever fixed
    if (night) { const [wx, wy] = F(0, fh * 1.06); glowPool(ctx, cam, wx, wy, h * 0.16, '255,190,120', 16, alpha * 0.30); }   // the mannequin windows
  },
  hardware(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Nuts to That — a low shop under a deep awning with its stock stacked out on the pavement
    const wallTop = h * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.08, 0, wallTop, pal, seed, night, alpha, true);
    // ⚠ THE WORST AWNING-OVER-SIGN OVERLAP OF THE SIX, and the awning cannot give any of it back:
    // its depth is this shop's whole tell, and it is MASS, so it has to stay where the affine
    // capture expects it. The fascia is fitted to the room above it instead — see marqueeBand.
    const hwSgnW = fh * 1.02, hwSgnZ = wallTop * 0.86, hwRoom = { floor: wallTop * 0.74, wallTop, wall: fh * 1.08 };
    reserveSignBand(hwSgnW, hwSgnZ, hwRoom);   // nothing the kit hangs may cross the name — see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 1.18, fh * 1.14, wallTop * 0.66, wallTop * 0.74, 'ty_door', seed + 1, night, alpha, fh * 0.44);   // the deep awning — depth is this shop's whole tell, so it keeps the most of any of them
    for (let i = 0; i < 3; i++) {   // rope coils, the rebar barrel, a pallet of grey buckets
      const [sx, sy] = F((-0.7 + i * 0.7) * fh * 0.80, fh * 1.16);
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.22, 0, h * (0.16 + 0.06 * (i & 1)), 'ty_door', seed + 5 + i, night, alpha, true);
    }
    roofClutter(ctx, cam, dx, dy, fh * 1.08, wallTop, 'citycore', seed + 4, night, alpha, now);   // vents and a water tank break the flat roof
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, hwSgnW, hwSgnZ, m.neon || '#ffcf3e', night, alpha, 'NUTS TO THAT', hwRoom);
  },
  citybathhouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Lather & Lye — a low tiled bathhouse venting steam off the roof all day. The steam IS the sign.
    const wallTop = h * 0.92;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, wallTop, pal, seed, night, alpha, true);
    for (const s of [-1, 1]) {
      const [vx, vy] = F(s * fh * 0.42, -fh * 0.20);
      draw3DBoxAt(ctx, cam, vx, vy, fh * 0.16, wallTop, wallTop + h * 0.16, 'ty_door', seed + 2 + s, night, alpha, true);
      drawSmoke(ctx, cam, vx, vy, wallTop + h * 0.16, '210,225,230', alpha * 0.55, now, seed + s);
      // Backlight the plume from the vent mouth, so at night the steam is a lit column
      // off the roof rather than grey smudges — the one thing you can see this place by.
      glowPool(ctx, cam, vx, vy, wallTop + h * 0.14, '170,240,225', 7, alpha * (night ? 0.34 : 0.12));
    }
    { const [px, py] = F(-fh * 0.70, fh * 1.04); draw3DBoxAt(ctx, cam, px, py, fh * 0.07, h * 0.10, h * 0.60, 'ty_marble_col', seed + 7, night, alpha, false); }   // the barber's pole
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 1.00, wallTop * 0.80, m.neon || '#7fe3c0', night, alpha, 'LATHER & LYE');
    if (night) { const [wx, wy] = F(0, fh * 1.00); glowPool(ctx, cam, wx, wy, h * 0.20, '150,235,215', 12, alpha * 0.26); }
  },
  noodlebar(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Oyelaran's — one storey, front wall folded open, a steam hood dumping the entire advertising budget into the street
    const wallTop = h * 0.74;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, true);
    const nbSgnW = fh * 0.86, nbSgnZ = wallTop * 0.74, nbRoom = { floor: wallTop * 0.62, wallTop, wall: fh * 0.90 };
    reserveSignBand(nbSgnW, nbSgnZ, nbRoom);   // nothing the kit hangs may cross the name — see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 1.02, fh * 1.08, wallTop * 0.52, wallTop * 0.62, 'ty_door', seed + 1, night, alpha, fh * 0.34);   // the counter awning over the open front
    { const [hx, hy] = F(0, -fh * 0.10);
      draw3DBoxAt(ctx, cam, hx, hy, fh * 0.30, wallTop, wallTop + h * 0.20, 'ty_door', seed + 2, night, alpha, true);
      drawSmoke(ctx, cam, hx, hy, wallTop + h * 0.20, '225,215,200', alpha * 0.60, now, seed + 3); }   // the steam hood
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, nbSgnW, nbSgnZ, m.neon || '#ff5a3e', night, alpha, "OYELARAN'S", nbRoom);
    // A row of paper lanterns strung the length of the open front — nine stools, nine lamps.
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = F((-0.72 + i * 0.48) * fh * 0.86, fh * 1.00);
      draw3DBoxAt(ctx, cam, lx, ly, fh * 0.045, wallTop * 0.66, wallTop * 0.76, 'ty_door', seed + 12 + i, night, alpha, false);
      glowPool(ctx, cam, lx, ly, wallTop * 0.70, '255,170,95', 4, alpha * (night ? 0.46 : 0.20));
    }
    if (night) {
      const [lx, ly] = F(fh * 0.55, fh * 1.00); glowPool(ctx, cam, lx, ly, wallTop * 0.80, '255,180,110', 7, alpha * 0.40);    // the paper lantern
      const [wx, wy] = F(0, fh * 0.96); glowPool(ctx, cam, wx, wy, wallTop * 0.45, '255,196,130', 12, alpha * 0.34);            // nine lit stools
    }
  },
  outfitter(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Layers — a narrow workwear shopfront with boots strung up under the awning by their laces
    const wallTop = h * 0.94;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, wallTop, pal, seed, night, alpha, true);
    const ofSgnW = fh * 0.88, ofSgnZ = wallTop * 0.82, ofRoom = { floor: wallTop * 0.68, wallTop, wall: fh * 0.94 };
    reserveSignBand(ofSgnW, ofSgnZ, ofRoom);   // nothing the kit hangs may cross the name — see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 1.04, fh * 1.06, wallTop * 0.60, wallTop * 0.68, 'ty_door', seed + 1, night, alpha, fh * 0.30);
    for (let i = 0; i < 4; i++) {   // the hanging boots
      const [bx, by] = F((-0.75 + i * 0.50) * fh * 0.90, fh * 1.02);
      draw3DBoxAt(ctx, cam, bx, by, fh * 0.05, wallTop * 0.44, wallTop * 0.58, 'ty_door', seed + 6 + i, night, alpha, true, 0, fh * 0.02);
    }
    for (const s of [-1, 1]) {   // two headless forms in the window, each in this season's one coat
      const [mx, my] = F(s * fh * 0.34, fh * 0.86);
      draw3DBoxAt(ctx, cam, mx, my, fh * 0.09, h * 0.06, h * 0.42, 'ty_marble_col', seed + 14 + s, night, alpha, false);
    }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, ofSgnW, ofSgnZ, m.neon || '#ffb43a', night, alpha, 'LAYERS', ofRoom);
    if (night) { const [wx, wy] = F(0, fh * 0.96); glowPool(ctx, cam, wx, wy, h * 0.22, '255,200,140', 11, alpha * 0.24); }
  },
  bodega(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Bodega Vu — a tiny corner shop with awnings on BOTH streets, one warm window and a padlocked cooler outside
    const wallTop = h * 0.82;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, 0, wallTop, pal, seed, night, alpha, true);
    // Both awnings are the same fascia line turning a corner, so the fascia has one room — see marqueeBand.
    const bdSgnW = fh * 0.84, bdSgnZ = wallTop * 0.78, bdRoom = { floor: wallTop * 0.66, wallTop, wall: fh * 0.90 };
    reserveSignBand(bdSgnW, bdSgnZ, bdRoom);   // nothing the kit hangs may cross the name — see reserveSignBand
    awning(ctx, cam, dx, dy, E, fh * 0.98, fh * 1.00, wallTop * 0.58, wallTop * 0.66, 'ty_door', seed + 1, night, alpha, fh * 0.28);
    // It turns the corner — that's the whole building. The side awning is the same call against E
    // rotated a quarter turn, which is what keeps the two of them identical rather than nearly so.
    awning(ctx, cam, dx, dy, [E[1], -E[0]], fh * 0.98, fh * 1.00, wallTop * 0.58, wallTop * 0.66, 'ty_door', seed + 2, night, alpha, fh * 0.28);
    { const [cx, cy] = F(-fh * 0.60, fh * 1.00); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.14, 0, h * 0.24, 'ty_door', seed + 3, night, alpha, true); }              // the chained cooler
    for (let i = 0; i < 2; i++) {   // produce crates out on the pavement, stacked two high
      const [kx, ky] = F((0.30 + i * 0.34) * fh, fh * 1.06);
      draw3DBoxAt(ctx, cam, kx, ky, fh * 0.13, 0, h * (0.12 + 0.07 * i), 'ty_door', seed + 16 + i, night, alpha, true);
    }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, bdSgnW, bdSgnZ, m.neon || '#ffe08a', night, alpha, 'BODEGA VU', bdRoom);
    if (night) { const [wx, wy] = F(0, fh * 0.94); glowPool(ctx, cam, wx, wy, h * 0.20, '255,215,150', 10, alpha * 0.30); }
  },
  comicshop(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // Mint Condition — a narrow deep shopfront: one barred lit window, a gold blade sign, and a roof unit that runs all night
    const wallTop = h * 0.86;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, 0, wallTop, pal, seed, night, alpha, true);                                     // deep and narrow — the plan is a corridor
    { const [wx, wy] = F(0, fh * 0.64); draw3DBoxAt(ctx, cam, wx, wy, fh * 0.66, wallTop * 0.30, wallTop * 0.70, 'ty_office', seed + 1, night, alpha, false); }   // the display window, glazed floor to sign
    { const [sx, sy] = F(0, fh * 0.68); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.70, wallTop * 0.72, wallTop * 0.84, 'ty_door', seed + 2, night, alpha, false); }     // the black board the gold lettering sits on
    { const [gx, gy] = F(-fh * 0.44, fh * 0.66); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, wallTop * 0.66, 'ty_door', seed + 3, night, alpha, false); }         // the security grille rolled up beside the door
    { const [rx, ry] = F(0, -fh * 0.10); draw3DBoxAt(ctx, cam, rx, ry, fh * 0.26, wallTop, wallTop + h * 0.16, 'ty_door', seed + 4, night, alpha, true); }        // the dehumidifier plant on the roof, which never stops
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.58, wallTop * 0.78, m.neon || '#ffd24a', night, alpha, 'MINT CONDITION');
    if (frontVis) { const [nx, ny] = F(fh * 0.34, fh * 0.62); neonBlade(ctx, cam, nx, ny, wallTop * 0.72, wallTop + h * 0.26, m.neon || '#ffd24a', night, alpha); }
    if (night) { const [wx, wy] = F(0, fh * 0.70); glowPool(ctx, cam, wx, wy, h * 0.18, '255,210,120', 10, alpha * 0.34); }   // nine little display lamps, left on
  },
  cinema(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // REEL ESTATE — the only building in Coldwater whose SHAPE is advertising.
    // Everything else on a street here is a box with a sign on it; a picture house is a sign with
    // a box behind it, and the three masses say so in order of how much they cost to build. The
    // auditorium is a blind brick shed, because that is what a cinema mostly is and nobody was
    // ever meant to look at it. The frontage is glazed faience, hosed down, expensive, and one
    // tile deep. And the blade is taller than either, which is the whole argument of the type.
    const foyerTop = h * 0.40, fasciaTop = h * 0.56;
    const houseTop = h * 0.94, loftTop = h * 1.18;
    // 1) THE HOUSE — a blind flank with no fenestration at all. `ty_reel_flank` is in BRICK_WALL
    //    rather than in FACADE_MAT, so it draws courses and NEVER a window grid: an auditorium
    //    with lit windows down the side of it would be a room you could see the film from.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.92, 0, houseTop, 'ty_reel_flank', seed, night, alpha, true);
    // 2) THE FLY LOFT over the screen end, set back off the street and deliberately plainer. It
    //    is the rewind room and the extract plant, and it is the part a pilot sees first.
    { const [lx, ly] = F(0, -fh * 0.40); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.60, houseTop, loftTop, 'ty_reel_loft', seed + 1, night, alpha, true, faceYaw(E), fh * 0.44); }
    // 3) THE FRONTAGE — one tile deep, wider than the house, and the only part of the building
    //    anybody was ever supposed to see. Faced in glazed tile: the family whose main event is
    //    a highlight rather than a shadow, which is what makes it read as wet-looking at night.
    { const [fx, fy] = F(0, fh * 0.62); draw3DBoxAt(ctx, cam, fx, fy, fh * 1.02, 0, foyerTop, pal, seed + 2, night, alpha, true, faceYaw(E), fh * 0.32); }
    // 4) THE FASCIA — the band the title goes on. It OVERSAILS the frontage below it, which is
    //    what throws the shadow that tells you the canopy is a separate thing from the wall.
    { const [bx, by] = F(0, fh * 0.66); draw3DBoxAt(ctx, cam, bx, by, fh * 1.08, foyerTop, fasciaTop, pal, seed + 3, night, alpha, true, faceYaw(E), fh * 0.28); }
    // 5) THE CANOPY. A shop's awning is a strip of canvas; this is a slab with lamps let into the
    //    underside of it, so it is drawn in the soffit palette rather than in the door one and it
    //    reaches further out. `awning` rather than a bare box because the two extents differ: it
    //    spans the whole frontage and comes out about a third of a tile, and a square footprint
    //    wide enough to do the first would put the second in the middle of Meltwater Row.
    awning(ctx, cam, dx, dy, E, fh * 1.04, fh * 1.18, h * 0.29, h * 0.35, 'ty_soffit', seed + 4, night, alpha, fh * 0.40);
    // 6) THE NAME, on the fascia, and THE BLADE, which is the tallest thing on the plot by half
    //    again. Anchored off the corner of the frontage so it stands clear of the fascia band and
    //    reads end-on from up the street, the way the real ones were built to.
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.96, h * 0.48, m.neon || '#ff4a7a', night, alpha);
    if (frontVis) { const [nx, ny] = F(fh * 0.72, fh * 0.80); neonBlade(ctx, cam, nx, ny, h * 0.34, h * 1.62, m.neon || '#ff4a7a', night, alpha); }
    // 7) Extract plant on the house roof. A hundred and eighty people in a sealed brick box need
    //    moving air, and the fans are the only thing on this building that has never been let go.
    roofClutter(ctx, cam, dx, dy, fh * 0.92, houseTop, 'citycore', seed + 5, night, alpha, now);
    if (night) {
      // The canopy lamps, which are the point of a canopy: the light lands on the PAVEMENT, not
      // on the building, so this pool sits out at the lip rather than against the wall.
      const [cx, cy] = F(0, fh * 1.02); glowPool(ctx, cam, cx, cy, h * 0.24, '255,228,178', 14, alpha * 0.42);
      // …and the foyer behind the doors, which is much dimmer than the canopy and always has been.
      const [gx, gy] = F(0, fh * 0.76); glowPool(ctx, cam, gx, gy, h * 0.14, '255,196,140', 9, alpha * 0.20);
    }
  },
  bookmaker(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // PHOTO FINISH — the building that is all fascia and no window, which is
    // the one elevation Coldwater did not have. Every other shop here sells by showing you the
    // stock; a turf accountant sells by NOT showing you the room, so the ground floor is a solid
    // painted panel and everything that tells you what the building is hangs off the front of it:
    // a clock on a bracket, and a lit box of figures above the parapet that is on all night.
    const shopTop = h * 0.50, fasciaTop = h * 0.60;
    const flatTop = h * 0.94, boxTop = h * 1.06;
    // 1) THE PANEL. `ty_pfin` is in STUCCO_WALL, so it takes the one material family here whose
    //    features are irregular rather than on a grid — and, more to the point, it is absent from
    //    FACADE_MAT, so no window is ever drawn in it. A bookmaker's shopfront with a window grid
    //    on it would be a bookmaker you could see into, which is the one thing it is not.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.96, 0, shopTop, pal, seed, night, alpha, false);
    // 2) THE FASCIA, oversailing the panel, carrying the gold-on-black name.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.02, shopTop, fasciaTop, 'ty_pfin_dk', seed + 1, night, alpha, false);
    // 3) THE FLAT ABOVE, set back and in ordinary brick, which DOES take a window grid: somebody
    //    lives up there, and the contrast between a lit first floor and a blind ground floor is
    //    most of what makes the elevation read at all.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.90, fasciaTop, flatTop, 'ty_kessel', seed + 2, night, alpha, false);
    // 4) THE RESULTS BOX across the parapet. PLAIN_WALL: no courses, no laps, no board lines. It
    //    is a sheet of lit glass and any rhythm in it would be a lie about what it is made of.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.00, flatTop, boxTop, 'ty_pfin_box', seed + 3, night, alpha, true);
    // 5) THE CLOCK, out over the pavement on its bracket. Small, and the only thing on this
    //    building that projects: a bookmaker's clock is a public utility the shop pays for, and
    //    it is how the street knows the shop is still there when the lights are off.
    { const [kx, ky] = F(fh * 0.52, fh * 1.04); draw3DBoxAt(ctx, cam, kx, ky, fh * 0.12, h * 0.36, h * 0.52, 'ty_pfin_dk', seed + 4, night, alpha, true); }
    if (frontVis) marqueeBand(ctx, cam, dx, dy, E, fh * 0.92, h * 0.55, m.neon || '#ffc94a', night, alpha);
    if (night) {
      // The results box, which is the whole of this building's night-time contribution to the
      // street. It throws UP as much as down, so the pool sits at the parapet rather than at
      // the pavement, and there is deliberately no glow at the door: nothing inside is lit for
      // the benefit of anybody outside.
      glowPool(ctx, cam, dx, dy, boxTop, '255,236,150', 12, alpha * 0.34);
      const [kx, ky] = F(fh * 0.52, fh * 1.04); glowPool(ctx, cam, kx, ky, h * 0.44, '255,244,206', 6, alpha * 0.22);
    }
  },
};
