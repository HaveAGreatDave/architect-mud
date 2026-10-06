// The Reach: building-model arms for Main Street, the motel, the genset and Buzzard Field.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import {
  DECO_PULL, TR, awning, bakeSignText, blinkLight, draw3DBoxAt, drawBarrelRoof, drawFacetDrum,
  drawRing, drawSmoke, emitDecoFill, emitFace, emitFlat, emitRecessBay, emitSurfaceText, emitWire,
  glowPool, markHidden, mast, perchBird, verticalMarquee, westClutter, westGable, westHangSign,
  westPorch, windWheel, windsockLimp,
} from '../../windshield.js';

export const REACH_ARMS = {
  buzzard(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // BUZZARD FIELD (The Reach) — a patched-steel smuggler's hangar on a cracked
    // strip: a sagging corrugated shed with an open bay, a stilted spotter's shack, a dead-still
    // windsock, a hand-lettered board, scattered salvage, and a lone buzzard on the ridge.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const wallTop = h * 0.6, hw = fh * 0.86, archH = hw * 0.4;
    // 1) The shed — corrugated patched-steel walls under a low rusted tin barrel roof.
    draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, 'ty_reach_hangar', seed, night, alpha, false);
    drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.94, wallTop, archH, 9, alpha, [120, 92, 66]);
    { const [px, py] = F(-hw * 0.52, -hw * 0.1); draw3DBoxAt(ctx, cam, px, py, hw * 0.26, wallTop * 0.18, wallTop * 0.86, 'ty_reach_rust', seed + 3, night, alpha, false); }   // riveted rust plate slapped over a corner
    // 2) OPEN BAY on the entrance (+y) gable — a dark recessed interior + a parked-craft tail hint.
    if (frontVis) {
      const odw = hw * 0.56, oTop = wallTop * 0.84, inset = hw * 0.6;
      const o = [P(-odw, hw + 0.003, 0), P(odw, hw + 0.003, 0), P(odw, hw + 0.003, oTop), P(-odw, hw + 0.003, oTop)];
      // ⚠ THE RECESS IS SLID INTO THE GABLE, NOT BAKED ONTO A CARD — see emitRecessBay. A
      // recessed opening is painted as a dark rectangle with the back wall and the floor laid
      // OVER it, which is the painter's own trick and is not what the geometry says: the back
      // wall is BEHIND the opening, so handed over at its own depth the buffer hides it and the
      // recess comes out flat. Sliding each corner along its own eye ray into the plane of the
      // gable moves no pixel and puts every layer in the one place a decal can live. The canvas
      // composite below is the fallback for the angles where that solve is degenerate.
      const bayArt = (g) => {
        const trace = (pp) => { g.beginPath(); pp.forEach((p, i) => i ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)); g.closePath(); };
        g.globalAlpha = alpha;
        g.fillStyle = night ? 'rgba(44,36,26,0.96)' : 'rgba(14,15,18,0.97)'; trace(o); g.fill();
        const bk = [P(-odw * 0.86, hw - inset, 0), P(odw * 0.86, hw - inset, 0), P(odw * 0.86, hw - inset, oTop * 0.9), P(-odw * 0.86, hw - inset, oTop * 0.9)];
        if (bk.every(p => p.f > 0.1)) { g.fillStyle = night ? 'rgba(66,52,34,0.95)' : 'rgba(26,27,30,0.96)'; trace(bk); g.fill(); }   // recessed back wall
        const fl = [P(-odw, hw + 0.003, 0.006), P(odw, hw + 0.003, 0.006), P(odw * 0.86, hw - inset, 0.006), P(-odw * 0.86, hw - inset, 0.006)];
        if (fl.every(p => p.f > 0.1)) { g.fillStyle = 'rgba(40,40,44,0.9)'; trace(fl); g.fill(); }   // oil-stained floor
        const tb = P(odw * 0.2, hw - inset * 0.7, 0.01), tt = P(odw * 0.2, hw - inset * 0.7, oTop * 0.66), tn = P(-odw * 0.36, hw - inset * 0.55, oTop * 0.24);
        if ([tb, tt, tn].every(p => p.f > 0.1)) { g.fillStyle = 'rgba(118,110,96,0.5)'; g.beginPath(); g.moveTo(tb.sx, tb.sy); g.lineTo(tt.sx, tt.sy); g.lineTo(tn.sx, tn.sy); g.closePath(); g.fill(); }   // parked-craft tail
        g.strokeStyle = 'rgba(8,8,10,0.9)'; g.lineWidth = 1.4; trace(o); g.stroke();
        g.globalAlpha = 1;
      };
      if (o.every(p => p.f > 0.1) && !emitRecessBay(ctx, cam, W3, 0, hw, odw, oTop, inset,
        { open: night ? 'rgba(44,36,26,0.96)' : 'rgba(14,15,18,0.97)',
          back: night ? 'rgba(66,52,34,0.95)' : 'rgba(26,27,30,0.96)',
          floor: 'rgba(40,40,44,0.9)', tail: 'rgba(118,110,96,0.5)', edge: 'rgba(8,8,10,0.9)' },
        { x: odw * 0.2, t: 0.66, nx: -odw * 0.36, b: 0.24 }, alpha)) {
        const [bfx, bfy] = F(0, hw);
        if (!markHidden(cam, bfx, bfy, oTop, odw * 1.25)) emitFace(o.reduce((s, p) => s + p.f, 0) / 4 - 0.002, () => bayArt(ctx));
      }
      // hand-lettered NO MANIFESTS board bolted beside the bay (surface text on the gable)
      { const bz0 = oTop + wallTop * 0.02, bz1 = oTop + wallTop * 0.16, bhw = hw * 0.5;
        const TL = P(-bhw, hw + 0.006, bz1), TR = P(bhw, hw + 0.006, bz1), BR = P(bhw, hw + 0.006, bz0), BL = P(-bhw, hw + 0.006, bz0);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const tex = bakeSignText('BUZZARD FIELD', '#e8c25a', night ? 1 : 0, false); emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha); } }
      if (night) { const [obx, oby] = F(0, hw); glowPool(ctx, cam, obx, oby, wallTop * 0.3, '255,200,132', 13, alpha * 0.34); }
    }
    // 3) STILTED SPOTTER'S SHACK — a tin box on four legs standing back-right, clear of the shed.
    { const [sx, sy] = F(fh * 0.72, -fh * 0.5), legTop = h * 0.85, cabTop = legTop + h * 0.42, r = fh * 0.13;
      for (const [lx, ly] of [[-r, -r], [r, -r], [r, r], [-r, r]]) { const [px, py] = F(fh * 0.72 + lx, -fh * 0.5 + ly); draw3DBoxAt(ctx, cam, px, py, fh * 0.02, 0, legTop, 'ty_reach_shack', seed + 5, night, alpha, false); }   // four legs
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.2, legTop, cabTop, 'ty_reach_shack', seed + 6, night, alpha, false);   // cabin
      draw3DBoxAt(ctx, cam, sx, sy, fh * 0.24, cabTop, cabTop + h * 0.07, 'ty_reach_rust', seed + 7, night, alpha, true);   // overhanging tin roof
      perchBird(ctx, cam, sx, sy, cabTop + h * 0.1, alpha);   // the buzzard, watching who lands
      blinkLight(ctx, cam, sx, sy, cabTop + h * 0.09, '255,72,60', now, seed + 6, alpha, 1.5);
      if (night) glowPool(ctx, cam, sx, sy, legTop + h * 0.2, '255,196,120', 7, alpha * 0.34);   // warm window
    }
    // 4) WINDSOCK — a tall pole front-left, sock hanging dead-still (no wind in the Reach).
    { const [wx, wy] = F(-fh * 0.86, fh * 0.7); windsockLimp(ctx, cam, wx, wy, 0, h * 1.05, alpha); }
    // 5) SALVAGE — a couple of fuel drums and a broken prop leaned on the apron.
    for (const [s, i] of [[-0.5, 0], [-0.34, 1]]) { const [bx, by] = F(fh * s, fh * 0.95); drawFacetDrum(ctx, cam, bx, by, 0, h * 0.18, fh * 0.08, fh * 0.08, 8, alpha, (f) => `rgb(${100 + f.nl * 60 | 0},${64 + f.nl * 40 | 0},40)`, 'rgb(70,46,30)'); }
    // 6) Apron: a cracked, faded taxi lead-in.
    { ctx.globalAlpha = alpha; ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) { const a = F(0, fh * (0.5 - i * 0.34)), b = F(0, fh * (0.5 - i * 0.34) - fh * 0.16); const pa = cam.proj(a[0], a[1], 0.02), pb = cam.proj(b[0], b[1], 0.02); if (pa.f > 0.1 && pb.f > 0.1) { ctx.strokeStyle = 'rgba(196,168,88,0.5)'; ctx.lineWidth = Math.max(1.4, 5 / (cam.proj(dx, dy, 0.02).f || 1)); ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy); ctx.stroke(); } }
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    }
    if (night) { glowPool(ctx, cam, dx, dy, 0.02, '255,214,150', 24, alpha * 0.14); const [lx, ly] = F(fh * 0.8, fh * 0.7); glowPool(ctx, cam, lx, ly, h * 0.6, '255,208,140', 7, alpha * 0.4); }   // one sodium lamp on a bent pole
  },
  saloon(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE COYOTE'S REST (The Reach) — a wild-west FALSE-FRONT saloon: a low welded-
    // plate body behind a tall flat parapet, a boardwalk porch on posts, batwing doors, warm lantern
    // windows, a hitching rail, and a busted neon 'COYOTE'S REST' buzzing over the door.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const bodyTop = h * 0.72, frontTop = h * 1.16, FR = fh * 1.0;
    // 1) Saloon body (welded plate) + 2) the FALSE FRONT parapet — a taller block pulled forward to
    //    the entrance face so it rises as a flat wall above the low roof behind (the classic western tell).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.9, 0, bodyTop, pal, seed, night, alpha, true);
    // THE SHAKE ROOF BEHIND THE FALSE FRONT. The front is a flat board wall and everything behind
    // it is what you actually see from the air, so the body gets a shingled cap — otherwise the
    // one surface a flight sim spends the whole flight looking down at is generic roof felt.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.95, bodyTop, bodyTop + h * 0.05, 'ty_reach_shake', seed + 200, night, alpha, true);
    { const [fx, fy] = F(0, fh * 0.16); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.86, 0, frontTop, 'ty_reach_saloon_dk', seed + 1, night, alpha, true); }
    // 3) PORCH — a shed awning over the boardwalk on three posts, along the front.
    { const canZ0 = bodyTop * 0.5, canZ1 = bodyTop * 0.58, [cx, cy] = F(0, fh * 1.18);
      awning(ctx, cam, dx, dy, E, fh * 0.94, fh * 1.50, canZ0, canZ1, 'ty_reach_board', seed + 2, night, alpha, fh * 1.05);   // awning, reaching out over the boardwalk to the posts
      for (const s of [-0.82, 0, 0.82]) { const [px, py] = F(fh * s, fh * 1.42); draw3DBoxAt(ctx, cam, px, py, fh * 0.03, 0, canZ0, 'ty_reach_saloon_dk', seed + 8 + s, night, alpha, false); }   // posts
    }
    // boardwalk plank strip on the ground in front
    { const pl = [P(-fh * 0.9, fh * 1.02, 0.02), P(fh * 0.9, fh * 1.02, 0.02), P(fh * 0.9, fh * 1.46, 0.02), P(-fh * 0.9, fh * 1.46, 0.02)]; if (pl.every(p => p.f > 0.1)) { ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(78,60,42,0.85)'; ctx.beginPath(); pl.forEach((p, i) => i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; } }
    // 4) Batwing doorway — a dark recessed opening + warm spill.
    { const [gx, gy] = F(0, fh * 0.94); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.2, 0, bodyTop * 0.44, 'ty_door', seed + 4, night, alpha, false); }
    // 5) HITCHING RAIL out front — a low bar on two posts.
    { const rz = bodyTop * 0.16; for (const s of [-0.6, 0.6]) { const [px, py] = F(fh * s, fh * 1.34); draw3DBoxAt(ctx, cam, px, py, fh * 0.02, 0, rz, 'ty_reach_saloon_dk', seed + 12 + s, night, alpha, false); }
      emitWire(ctx, cam, W3(-fh * 0.6, fh * 1.34, rz), W3(fh * 0.6, fh * 1.34, rz), 1.4, 'rgba(52,40,28,0.9)', alpha, { pull: DECO_PULL }); }
    // 6) Busted neon on the false front — 'COYOTE'S REST' with half its letters dead (blanked out),
    //    the survivors buzzing on an irregular flicker (the sign the flavour text promises).
    if (frontVis) {
      const bz0 = frontTop * 0.58, bz1 = frontTop * 0.82, bhw = fh * 0.78;
      const TL = P(-bhw, FR + 0.006, bz1), TR = P(bhw, FR + 0.006, bz1), BR = P(bhw, FR + 0.006, bz0), BL = P(-bhw, FR + 0.006, bz0);
      if ([TL, TR, BR, BL].every(p => p.f > 0.12)) {
        const t = now || 0, buzz = (Math.sin(t * 0.03) + Math.sin(t * 0.017) > -0.7) ? 0.74 + 0.26 * Math.abs(Math.sin(t * 0.05)) : 0.14;
        const live = bakeSignText('C YOT ’S R ST', m.neon || '#ff6a3a', night ? 1 : 0, false);   // dead tubes → blank cells
        emitSurfaceText(ctx, cam, [TL, TR, BR, BL], live, false, alpha * buzz);
      }
      if (night) { const [wx, wy] = F(0, fh * 0.9); glowPool(ctx, cam, wx, wy, bodyTop * 0.5, '255,190,110', 12, alpha * 0.4); }   // warm windows
    }
    if (night) glowPool(ctx, cam, dx, dy, frontTop * 0.72, '255,106,58', 14, alpha * 0.2);
    // ── THE GALLERY, THE GABLE AND THE WALK ────────────────────────────────
    // A saloon is the one building on a frontier street with an UPSTAIRS you can stand on, and
    // the balcony over the walk is what says so from a quarter of a mile out. Built as the porch
    // helper with its roof suppressed (the balcony deck IS the porch roof) plus a rail on top.
    { const gallZ = h * 0.68;
      westPorch(ctx, cam, dx, dy, E, seed + 60, night, alpha,
        { fh, h, halfW: 1.00, depth: 0.50, postTop: gallZ, posts: 5, roof: false });
      // The balcony deck, standing proud of the posts, and its own rail above.
      { const [bx, by] = F(0, fh * 1.25);
        draw3DBoxAt(ctx, cam, bx, by, fh * 1.04, gallZ, gallZ + h * 0.05, 'ty_reach_porch', seed + 70, night, alpha, true); }
      // ⚠ The balcony rails take the post thickness and a lid, for `westPorch`'s reason: with no
      //   `fd` a rail is a CUBE, and these two were half-tile slabs floating over the walk.
      for (const [i2, z] of [[0, 0.30], [1, 0.16]]) { const [rx, ry] = F(0, fh * 1.48);
        draw3DBoxAt(ctx, cam, rx, ry, fh * 1.00, gallZ + h * (0.05 + z * 0.5), gallZ + h * (0.08 + z * 0.5), 'ty_reach_porch', seed + 74 + i2, night, alpha, true, 0, fh * 0.03); }
      for (const t of [-1, -0.4, 0.4, 1]) { const [px, py] = F(t * fh * 0.94, fh * 1.48);
        draw3DBoxAt(ctx, cam, px, py, fh * 0.03, gallZ + h * 0.05, gallZ + h * 0.26, 'ty_reach_porch', seed + 80 + t, night, alpha, false); }
      // The upstairs doors onto it — two, warm, because the rooms up there are always let.
      if (frontVis) for (const t of [-1, 1]) { const [dx2, dy2] = F(t * fh * 0.40, fh * 1.02);
        draw3DBoxAt(ctx, cam, dx2, dy2, fh * 0.11, gallZ + h * 0.05, gallZ + h * 0.34, 'ty_door', seed + 90 + t, night, alpha, false);
        glowPool(ctx, cam, dx2, dy2, gallZ + h * 0.20, '255,196,120', 5, alpha * (night ? 0.40 : 0.12)); } }
    // THE GABLE over it, with the fan light in the peak — the reference's one piece of carpentry
    // anybody was ever proud of, and the saloon is where it would be.
    westGable(ctx, cam, dx, dy, E, seed + 100, night, alpha,
      { fh, h, halfW: 0.52, base: h * 1.06, peak: h * 1.46, ly: 1.02 });
    // Barrels and a hitching rail. A saloon with nothing tied up outside is a saloon nobody is in.
    westClutter(ctx, cam, dx, dy, E, seed + 120, night, alpha, { fh, h, items: [
      ['barrel', -0.78, 1.30], ['barrel', -0.62, 1.42], ['hitch', 0.34, 1.74], ['bench', 0.70, 1.24]] });
    westHangSign(ctx, cam, dx, dy, E, seed + 140, night, alpha, { fh, h, u: -0.70, ly: 1.28, z: 0.60, w: 0.32 });
  },
  dynamo(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE DYNAMO (The Reach) — a jury-rigged genset that 'argues with storms': a
    // scorched bolted-plate shack, a leaning smokestack belching black smoke, a slow tin windmill
    // on a lattice mast, patchwork fuel tanks, tangled cables, and blue arc-flashes at the junction.
    const shackTop = h * 0.72;
    // 1) Shack (bolted plate) + a SCORCH fan up the front wall (the storm's calling card).
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.82, 0, shackTop, pal, seed, night, alpha, true);
    if (frontVis) { const [lx, ly] = F(-fh * 0.3, fh * 0.83), [mx, my] = F(fh * 0.1, fh * 0.83), [tx, ty] = F(-fh * 0.1, fh * 0.83); emitFlat(ctx, cam, [[lx, ly, 0], [mx, my, 0], [tx, ty, shackTop * 0.92]], 'rgba(30,26,22,0.7)', alpha, { cullN: E, lift: 0.02 }); }
    // 2) LEANING SMOKESTACK — stacked boxes drifting sideways as they rise, black smoke + red tip.
    { let px = fh * 0.5, py = -fh * 0.3, z = 0, w = fh * 0.16; for (let i = 0; i < 4; i++) { const z1 = z + h * 0.42, [wx, wy] = F(px, py); draw3DBoxAt(ctx, cam, wx, wy, w, z, z1, 'ty_reach_tank', seed + 20 + i, night, alpha, i === 3); z = z1; px += fh * 0.07; w *= 0.9; }
      const [sx, sy] = F(px, py); drawSmoke(ctx, cam, sx, sy, z, '58,52,46', alpha, now, seed + 4); blinkLight(ctx, cam, sx, sy, z, '255,74,60', now, seed, alpha, 1.4); }
    // 3) WINDMILL — a lattice mast with a slow tin wheel, back-left; the wild-west power take-off.
    { const [wx, wy] = F(-fh * 0.6, -fh * 0.35), hubZ = h * 1.5; mast(ctx, cam, wx, wy, 0, hubZ, alpha, now, seed + 9); windWheel(ctx, cam, wx, wy, hubZ, fh * 34, now, alpha, seed); }
    // 4) FUEL TANKS — a big riveted upright tank on the flank + two small drums.
    { const [tx, ty] = F(-fh * 0.5, fh * 0.55); drawFacetDrum(ctx, cam, tx, ty, 0, h * 0.5, fh * 0.22, fh * 0.22, 10, alpha, (f) => `rgb(${104 + f.nl * 50 | 0},${72 + f.nl * 36 | 0},46)`, 'rgb(74,52,34)'); drawRing(ctx, cam, tx, ty, h * 0.3, fh * 0.225, 10, 'rgba(0,0,0,0.3)', 1, alpha); }
    for (const s of [0.4, 0.62]) { const [bx, by] = F(fh * s, fh * 0.5); drawFacetDrum(ctx, cam, bx, by, 0, h * 0.2, fh * 0.08, fh * 0.08, 8, alpha, (f) => `rgb(${96 + f.nl * 50 | 0},${88 + f.nl * 44 | 0},${72 + f.nl * 30 | 0})`, 'rgb(66,62,52)'); }
    // 5) CABLES — a couple of sagging lines from the shack eave to a short pole.
    { const [ex, ey] = F(fh * 0.2, fh * 0.4); const a = cam.proj(ex, ey, shackTop), pole = F(fh * 0.86, fh * 0.7); const pb = cam.proj(pole[0], pole[1], h * 0.34);
      draw3DBoxAt(ctx, cam, pole[0], pole[1], fh * 0.02, 0, h * 0.34, 'ty_reach_shack', seed + 30, night, alpha, false);
      // ⚠ THE SAG IS NOW IN THE WORLD, NOT IN SCREEN Y. It was a quadratic curve bulging eight
      // pixels DOWN THE CANVAS, which is a cable that sags less the further away it is and not at
      // all if you look at it from above. A catenary is a shape a cable has; drawn as five world
      // segments it hangs correctly from every angle and goes on the depth buffer for free.
      { const SEGN = 5, sagZ = h * 0.05;
        for (const dz of [0, -h * 0.012]) {
          let prev = null;
          for (let i = 0; i <= SEGN; i++) {
            const u = i / SEGN;
            const q = [ex + (pole[0] - ex) * u, ey + (pole[1] - ey) * u,
                       shackTop + (h * 0.34 - shackTop) * u - Math.sin(u * Math.PI) * sagZ + dz];
            if (prev) emitWire(ctx, cam, prev, q, 1, 'rgba(20,18,18,0.85)', alpha);
            prev = q;
          }
        } } }
    // 6) ARC JUNCTION — a fast blue-white flash + an electric hum glow at the shack shoulder.
    { const [jx, jy] = F(fh * 0.3, fh * 0.5); const t = now || 0, arc = (Math.sin(t * 0.09) + Math.sin(t * 0.061)) > 1.2; blinkLight(ctx, cam, jx, jy, shackTop * 0.8, '150,230,255', now, seed + 2, alpha, arc ? 2.6 : 1.2); if (night) glowPool(ctx, cam, jx, jy, shackTop * 0.7, '108,240,255', 8, alpha * 0.3); }
  },
  layover(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LAYOVER (The Reach) — a slag-and-glass desert motel: a low cabin row under
    // one long shed roof with repeating warm doors, a beat-up water tower on legs, and a roadside
    // pylon — a vertical MOTEL blade + a pink 'VA ANCY' sign flickering with its long-dead 'C'.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const wallTop = h * 0.5;
    // 1) CABIN STRIP — a low wide body + a shallow overhanging shed roof, repeating doors + windows.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.1, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.18, wallTop, wallTop + h * 0.07, 'ty_reach_motel_roof', seed + 1, night, alpha, true);   // overhanging shed roof
    for (const s of [-0.72, -0.24, 0.24, 0.72]) { const [gx, gy] = F(fh * s, fh * 1.12); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.12, 0, wallTop * 0.62, 'ty_door', seed + 10 + s * 3, night, alpha, true, 0, fh * 0.04); if (night) { const [wx, wy] = F(fh * (s + 0.14), fh * 1.1); glowPool(ctx, cam, wx, wy, wallTop * 0.55, '255,196,120', 6, alpha * 0.34); } }   // doors + warm cabin windows
    // 2) WATER TOWER — four splayed legs + a riveted tank + a conical cap, standing back-left.
    { const cxL = -fh * 0.7, cyL = -fh * 0.55, [wx, wy] = F(cxL, cyL), legTop = h * 1.0, tankTop = legTop + h * 0.34, r = fh * 0.24;
      for (const [ox, oy] of [[-r, -r], [r, -r], [r, r], [-r, r]]) { const [px, py] = F(cxL + ox, cyL + oy); draw3DBoxAt(ctx, cam, px, py, fh * 0.02, 0, legTop, 'ty_reach_water', seed + 20, night, alpha, false); }   // legs
      drawFacetDrum(ctx, cam, wx, wy, legTop, tankTop, r * 1.05, r * 1.05, 10, alpha, (f) => `rgb(${96 + f.nl * 46 | 0},${84 + f.nl * 40 | 0},${68 + f.nl * 30 | 0})`, 'rgb(66,58,46)');   // tank
      drawRing(ctx, cam, wx, wy, legTop + h * 0.17, r * 1.06, 10, 'rgba(0,0,0,0.28)', 1, alpha);
      drawFacetDrum(ctx, cam, wx, wy, tankTop, tankTop + h * 0.16, r * 1.05, 0.001, 10, alpha, (f) => `rgb(${74 + f.nl * 30 | 0},${52 + f.nl * 24 | 0},34)`);   // conical cap
      blinkLight(ctx, cam, wx, wy, tankTop + h * 0.18, '255,74,60', now, seed + 21, alpha, 1.3); }
    // 3) ROADSIDE PYLON — a tall post carrying a vertical MOTEL blade + a flickering 'VA ANCY' board.
    { const [px, py] = F(fh * 0.86, fh * 0.9); draw3DBoxAt(ctx, cam, px, py, fh * 0.04, 0, h * 1.5, 'ty_reach_saloon_dk', seed + 30, night, alpha, false);   // post
      verticalMarquee(ctx, cam, px, py, h * 0.86, h * 1.62, 'MOTEL', m.neon || '#ff5a86', night, alpha, E);
      // VA ANCY (dead 'C') on a small board facing the strip — surface text with a buzz flicker.
      const bz0 = h * 0.58, bz1 = h * 0.8, bhw = fh * 0.3;
      const [blx, bly] = F(fh * 0.86 - bhw, fh * 0.9 + 0.05), [brx, bry] = F(fh * 0.86 + bhw, fh * 0.9 + 0.05);
      const TL = cam.proj(blx, bly, bz1), TR = cam.proj(brx, bry, bz1), BR = cam.proj(brx, bry, bz0), BL = cam.proj(blx, bly, bz0);
      if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const t = now || 0, buzz = (Math.sin(t * 0.02) > -0.6) ? 0.85 : 0.2; const tex = bakeSignText('VA ANCY', '#ff8fb0', night ? 1 : 0, false); emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha * buzz); } }
    // 4) A porch light kept burning like a habit.
    { const [lx, ly] = F(-fh * 0.95, fh * 1.14); glowPool(ctx, cam, lx, ly, wallTop * 0.7, '255,206,140', 6, alpha * (night ? 0.5 : 0.28)); }
    // ONE LONG WALK PAST EVERY DOOR, which is the whole plan of a lodging house and the reason
    // it reads as one from above: not a building with an entrance, a row of entrances with a
    // roof over them. No rail — you are carrying a bag.
    westPorch(ctx, cam, dx, dy, E, seed + 60, night, alpha,
      { fh, h, halfW: 1.04, depth: 0.44, postTop: h * 0.58, posts: 6, rail: false });
    westClutter(ctx, cam, dx, dy, E, seed + 90, night, alpha, { fh, h, items: [
      ['butt', -0.94, 1.26], ['bench', 0.20, 1.18], ['crate', 0.86, 1.22]] });
  },
  mercantile(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE DRY GOODS (The Reach) — the widest front on Main Street and the only
    // one whose boards are still true: a squared false-front parapet lettered in white, a canvas
    // awning on posts over a swept boardwalk, barrels either side of the door, warm goods-lit windows.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const bodyTop = h * 0.62, frontTop = h * 1.22;
    // ⚠ THE LETTERING PLANE IS THE FALSE FRONT’S OWN FACE, SOLVED RATHER THAN GUESSED. It was
    // `fh * 1.0` — a plausible number that is not where that board is: the parapet box below is
    // centred fh*0.2 forward of the tile and reaches min(fh*0.92, 0.44) beyond that, so the name
    // was painted about a tenth of a footprint INSIDE the wall it is supposed to be painted on.
    // A painter’s queue never noticed, because DECO_LIFT sorts an adornment 0.6 tiles in front of
    // its own host and it drew anyway; a depth buffer compares, the board wins, and the widest
    // shopfront on Main Street loses its name. The clamp has to be re-applied here for the same
    // reason every other consumer of a raw half-width re-applies it.
    const FR = fh * 0.2 + Math.min(fh * 0.92, 0.44);
    // 1) Body + the FALSE FRONT — a taller squared parapet pulled forward to the entrance face.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.94, 0, bodyTop, pal, seed, night, alpha, true);
    // THE SHAKE ROOF BEHIND THE FALSE FRONT. The front is a flat board wall and everything behind
    // it is what you actually see from the air, so the body gets a shingled cap — otherwise the
    // one surface a flight sim spends the whole flight looking down at is generic roof felt.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.99, bodyTop, bodyTop + h * 0.05, 'ty_reach_shake', seed + 200, night, alpha, true);
    { const [fx, fy] = F(0, fh * 0.2); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.92, 0, frontTop, 'ty_reach_merc_dk', seed + 1, night, alpha, true); }
    // A cornice board capping the parapet — the one bit of carpentry anybody in town is proud of.
    { const [cx, cy] = F(0, fh * 0.2); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.98, frontTop, frontTop + h * 0.05, 'ty_reach_merc', seed + 2, night, alpha, true); }
    // 2) THE COVERED BOARDWALK — deck, five posts, a two-rail fence and a shake roof over the
    //    lot. The widest frontage on the street gets the most posts, which is the only reason
    //    anybody would read it as the biggest shop without being told.
    westPorch(ctx, cam, dx, dy, E, seed + 3, night, alpha,
      { fh, h, halfW: 0.96, depth: 0.52, postTop: bodyTop * 0.74, posts: 5 });
    // …and the name on a board hung ACROSS the walk, at right angles to the front, so it reads
    //    from up the street rather than only from square on. The parapet keeps its lettering too:
    //    a shop this size says its name twice, and that is exactly what the photograph shows.
    westHangSign(ctx, cam, dx, dy, E, seed + 40, night, alpha, { fh, h, u: 0.62, ly: 1.30, z: bodyTop * 0.68 / h, w: 0.34 });
    // 3) Doorway + BARRELS either side of it, standing on the boardwalk under the canvas.
    { const [gx, gy] = F(0, fh * 0.98); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, bodyTop * 0.5, 'ty_door', seed + 4, night, alpha, false); }
    // Barrels either side of the door, a crate of stock somebody has not carried in yet, and a
    // hitching rail at the kerb — the frontier equivalent of parking.
    westClutter(ctx, cam, dx, dy, E, seed + 60, night, alpha, { fh, h, items: [
      ['barrel', -0.60, 1.18], ['barrel', -0.44, 1.30], ['crate', 0.58, 1.20], ['hitch', 0.10, 1.66]] });
    // 4) THE DRY GOODS painted across the parapet in white, and a smaller price board by the door.
    if (frontVis) {
      const bz0 = frontTop * 0.62, bz1 = frontTop * 0.86, bhw = fh * 0.84;
      const TL = P(-bhw, FR + 0.006, bz1), TR = P(bhw, FR + 0.006, bz1), BR = P(bhw, FR + 0.006, bz0), BL = P(-bhw, FR + 0.006, bz0);
      if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const tex = bakeSignText('THE DRY GOODS', '#f2ead6', night ? 1 : 0, false); emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha); }
      if (night) { const [wx, wy] = F(-fh * 0.4, fh * 0.96); glowPool(ctx, cam, wx, wy, bodyTop * 0.52, '255,198,124', 11, alpha * 0.42); }   // goods-lit window
    }
    if (night) glowPool(ctx, cam, dx, dy, bodyTop * 0.6, '255,208,132', 12, alpha * 0.18);
  },
  assay(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE ASSAY (The Reach) — a squat poured blockhouse wearing a two-storey false
    // front that fools nobody: ASSAY a foot high, a steel shutter on rails beside the door, a fume
    // stack breathing something thin, and a hard blue-white burner glow behind the one window.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const bodyTop = h * 0.5, frontTop = h * 1.3, FR = fh * 1.0;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.84, 0, bodyTop, pal, seed, night, alpha, true);
    { const [fx, fy] = F(0, fh * 0.18); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.82, 0, frontTop, 'ty_reach_assay_dk', seed + 1, night, alpha, true); }
    // 0) THE WALK. Narrow, no rail — this is a place you go IN to, not one you sit outside.
    westPorch(ctx, cam, dx, dy, E, seed + 30, night, alpha,
      { fh, h, halfW: 0.82, depth: 0.34, postTop: bodyTop * 0.80, posts: 3, rail: false });
    westHangSign(ctx, cam, dx, dy, E, seed + 50, night, alpha, { fh, h, u: -0.62, ly: 1.16, z: bodyTop * 0.72 / h, w: 0.26 });
    // 1) STEEL SHUTTER on rails beside the door — a proud slab of plate that comes down fast.
    { const [sx, sy] = F(fh * 0.46, fh * 0.94); draw3DBoxAt(ctx, cam, sx, sy, fh * 0.2, bodyTop * 0.06, bodyTop * 0.78, 'ty_reach_skin', seed + 5, night, alpha, false); }
    { const [gx, gy] = F(-fh * 0.2, fh * 0.9); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.15, 0, bodyTop * 0.56, 'ty_door', seed + 4, night, alpha, false); }
    // 2) FUME STACK — a thin pipe off the back shoulder with a colourless wisp coming off it.
    { const [px, py] = F(fh * 0.5, -fh * 0.42), stackTop = h * 1.02;
      draw3DBoxAt(ctx, cam, px, py, fh * 0.05, 0, stackTop, 'ty_reach_assay_dk', seed + 6, night, alpha, true);
      drawSmoke(ctx, cam, px, py, stackTop, '176,180,168', alpha * 0.6, now, seed + 6); }
    // 3) The balance sits on a stone plinth inside; from outside it reads as one hard-lit window.
    { const [wx, wy] = F(-fh * 0.44, fh * 0.9); glowPool(ctx, cam, wx, wy, bodyTop * 0.6, '190,232,255', 8, alpha * (night ? 0.46 : 0.2)); }
    // 4) ASSAY, and under it in a different hand and a different decade, the disclaimer.
    if (frontVis) {
      const bhw = fh * 0.7;
      for (const [txt, col, z0, z1, hwm] of [['ASSAY', '#dfe6ea', frontTop * 0.66, frontTop * 0.9, 1],
                                             ['WE DO NOT ASK WHERE', '#9aa4a8', frontTop * 0.5, frontTop * 0.6, 1.04]]) {
        const w = bhw * hwm;
        const TL = P(-w, FR + 0.006, z1), TR = P(w, FR + 0.006, z1), BR = P(w, FR + 0.006, z0), BL = P(-w, FR + 0.006, z0);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const tex = bakeSignText(txt, col, night ? 1 : 0, false); emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha); }
      }
    }
    if (night) glowPool(ctx, cam, dx, dy, bodyTop * 0.7, '150,200,224', 10, alpha * 0.16);
  },
  undertaker(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE QUIET TRADE (The Reach) — the one building on the street with no sign
    // on it, and everybody knows what it is: a narrow flat-grey false front gone chalky, a shuttered
    // window, a length of black ribbon over the door, and the pipe stock leaning against the flank.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const bodyTop = h * 0.56, frontTop = h * 1.1, FR = fh * 1.0;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.62, 0, bodyTop, pal, seed, night, alpha, true);
    // THE SHAKE ROOF BEHIND THE FALSE FRONT. The front is a flat board wall and everything behind
    // it is what you actually see from the air, so the body gets a shingled cap — otherwise the
    // one surface a flight sim spends the whole flight looking down at is generic roof felt.
    draw3DBoxAt(ctx, cam, dx, dy, fh * 0.66, bodyTop, bodyTop + h * 0.04, 'ty_reach_shake', seed + 200, night, alpha, true);
    { const [fx, fy] = F(0, fh * 0.3); draw3DBoxAt(ctx, cam, fx, fy, fh * 0.6, 0, frontTop, 'ty_reach_grey_dk', seed + 1, night, alpha, true); }
    // 1) SHUTTERED WINDOW — boarded from the inside, so it reads as a flat dead panel, not glass.
    if (frontVis) { const wz0 = bodyTop * 0.3, wz1 = bodyTop * 0.72, whw = fh * 0.24;
      const q = [P(-whw - fh * 0.18, FR + 0.004, wz1), P(-fh * 0.18 + whw, FR + 0.004, wz1), P(-fh * 0.18 + whw, FR + 0.004, wz0), P(-whw - fh * 0.18, FR + 0.004, wz0)];
      emitDecoFill(ctx, cam, [W3(-whw - fh * 0.18, FR + 0.004, wz1), W3(-fh * 0.18 + whw, FR + 0.004, wz1), W3(-fh * 0.18 + whw, FR + 0.004, wz0), W3(-whw - fh * 0.18, FR + 0.004, wz0)], 'rgba(38,38,40,0.94)', alpha); }
    // 2) The door, and the BLACK RIBBON nailed above it and replaced whenever it frays.
    { const [gx, gy] = F(fh * 0.24, fh * 0.94); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.14, 0, bodyTop * 0.54, 'ty_door', seed + 4, night, alpha, false); }
    if (frontVis) { const rz0 = bodyTop * 0.58, rz1 = bodyTop * 0.66, rhw = fh * 0.2;
      const q = [P(fh * 0.24 - rhw, FR + 0.005, rz1), P(fh * 0.24 + rhw, FR + 0.005, rz1), P(fh * 0.24 + rhw, FR + 0.005, rz0), P(fh * 0.24 - rhw, FR + 0.005, rz0)];
      emitDecoFill(ctx, cam, [W3(fh * 0.24 - rhw, FR + 0.005, rz1), W3(fh * 0.24 + rhw, FR + 0.005, rz1), W3(fh * 0.24 + rhw, FR + 0.005, rz0), W3(fh * 0.24 - rhw, FR + 0.005, rz0)], 'rgba(14,12,14,0.95)', alpha); }
    // 2b) THE WALK, and DELIBERATELY NO BOARD HANGING OVER IT. Every other frontage on this
    //     street now swings a painted sign; this one has an empty bracket with nothing on it,
   //     which says what it is far better than a sign could. Nobody needs telling.
    westPorch(ctx, cam, dx, dy, E, seed + 30, night, alpha,
      { fh, h, halfW: 0.62, depth: 0.40, postTop: bodyTop * 0.78, posts: 3 });
    { const [ex, ey] = F(fh * 0.44, fh * 1.10);
      draw3DBoxAt(ctx, cam, ex, ey, fh * 0.02, bodyTop * 0.62, bodyTop * 0.74, 'ty_reach_iron', seed + 44, night, alpha, false);
      const [ax2, ay2] = F(fh * 0.44, fh * 1.24);
      draw3DBoxAt(ctx, cam, ax2, ay2, fh * 0.10, bodyTop * 0.72, bodyTop * 0.74, 'ty_reach_iron', seed + 45, night, alpha, false); }
    // 3) PIPE STOCK — cut lengths leaned against the flank, waiting to be given a name.
    for (const [i, s] of [[0, -0.86], [1, -0.78], [2, -0.7]]) {
      const [px, py] = F(fh * s, -fh * 0.1 + i * fh * 0.06);
      draw3DBoxAt(ctx, cam, px, py, fh * 0.025, 0, bodyTop * (0.62 + i * 0.06), 'ty_reach_skin', seed + 12 + i, night, alpha, false);
    }
    // 4) One lamp over the door, left on. The chiller cabinet's draw is the only load in the building.
    { const [lx, ly] = F(fh * 0.24, fh * 1.02); glowPool(ctx, cam, lx, ly, bodyTop * 0.8, '210,214,220', 5, alpha * (night ? 0.42 : 0.16)); }
  },
  bathhouse(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LONG SOAK (The Reach) — the only building in town that spends water on
    // purpose: a long low shed under a shallow roof, a boiler stack leaning a permanent thread of
    // steam off the ridge, header tanks on the roof, and mismatched bolted letters, one upside down.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const wallTop = h * 0.44, FR = fh * 1.0;
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.06, 0, wallTop, pal, seed, night, alpha, false);
    draw3DBoxAt(ctx, cam, dx, dy, fh * 1.14, wallTop, wallTop + h * 0.06, 'ty_reach_bath_roof', seed + 1, night, alpha, true);
    // The walk, and a bench on it. The bench is the building's whole social function made visible:
    // this is the one place in the Reach with a queue that is glad to be in it.
    westPorch(ctx, cam, dx, dy, E, seed + 40, night, alpha,
      { fh, h, halfW: 1.00, depth: 0.42, postTop: wallTop * 0.86, posts: 4, rail: false });
    westClutter(ctx, cam, dx, dy, E, seed + 70, night, alpha, { fh, h, items: [
      ['bench', -0.52, 1.20], ['bench', 0.36, 1.20], ['butt', 0.86, 1.24]] });
    // 1) BOILER STACK off the back corner, breathing steam that never quite stops.
    { const [px, py] = F(-fh * 0.62, -fh * 0.5), stackTop = h * 0.98;
      drawFacetDrum(ctx, cam, px, py, 0, stackTop, fh * 0.08, fh * 0.07, 8, alpha, (f) => `rgb(${86 + f.nl * 40 | 0},${78 + f.nl * 34 | 0},${66 + f.nl * 26 | 0})`, 'rgb(58,50,42)');
      drawSmoke(ctx, cam, px, py, stackTop, '212,214,210', alpha * 0.8, now, seed + 7); }
    // 2) HEADER TANKS on the roof — two drums on a cradle, feeding the manifold by gravity.
    for (const [i, s] of [[0, -0.3], [1, 0.28]]) { const [tx, ty] = F(fh * s, -fh * 0.16), z0 = wallTop + h * 0.06;
      drawFacetDrum(ctx, cam, tx, ty, z0, z0 + h * 0.2, fh * 0.16, fh * 0.16, 9, alpha, (f) => `rgb(${100 + f.nl * 44 | 0},${92 + f.nl * 40 | 0},${76 + f.nl * 30 | 0})`, 'rgb(66,60,50)');
      drawRing(ctx, cam, tx, ty, z0 + h * 0.12, fh * 0.165, 9, 'rgba(0,0,0,0.28)', 1, alpha); void i; }
    // 3) Door, and a low step off the boardwalk.
    { const [gx, gy] = F(0, fh * 1.08); draw3DBoxAt(ctx, cam, gx, gy, fh * 0.16, 0, wallTop * 0.66, 'ty_door', seed + 4, night, alpha, true, 0, fh * 0.05); }
    // 4) THE LONG SOAK in bolted-on letters. The 'A' is fitted upside down and has been for so long
    //    that it counts as the name now: its quad is drawn with the top and bottom corners swapped.
    if (frontVis) {
      const bz0 = wallTop * 1.02, bz1 = wallTop * 1.4, x0 = -fh * 0.92, span = fh * 1.84, N = 13;   // 'THE LONG SOAK'
      const cell = (i, n) => [x0 + span * (i / N), x0 + span * ((i + n) / N)];
      for (const [txt, i, n, flip] of [['THE LONG SO', 0, 11, false], ['A', 11, 1, true], ['K', 12, 1, false]]) {
        const [xa, xb] = cell(i, n);
        const tl = P(xa, FR + 0.006, bz1), tr = P(xb, FR + 0.006, bz1), br = P(xb, FR + 0.006, bz0), bl = P(xa, FR + 0.006, bz0);
        if (![tl, tr, br, bl].every(p => p.f > 0.12)) continue;
        const tex = bakeSignText(txt, '#cfe9df', night ? 1 : 0, false);
        const [A, B, C, D] = flip ? [bl, br, tr, tl] : [tl, tr, br, bl];
        emitSurfaceText(ctx, cam, [A, B, C, D], tex, false, alpha);
      }
    }
    // 5) Steam glow at the eaves and a warm wet light out of the doorway.
    if (night) { const [lx, ly] = F(0, fh * 1.04); glowPool(ctx, cam, lx, ly, wallTop * 0.6, '190,255,232', 9, alpha * 0.34); }
    glowPool(ctx, cam, dx, dy, wallTop + h * 0.12, '214,226,220', 10, alpha * (night ? 0.2 : 0.12));
  },
  lastload(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // THE LAST LOAD (The Reach) — the freight shed at the south end, mismatched
    // sheet with half of it aircraft skin, roller door up because it is always up, and THE LAST LOA
    // hand-painted across the lintel by somebody who ran out of wall before they ran out of word.
    const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
    const wallTop = h * 0.66, hw = fh * 0.92, archH = hw * 0.3;
    draw3DBoxAt(ctx, cam, dx, dy, hw, 0, wallTop, pal, seed, night, alpha, false);
    drawBarrelRoof(ctx, cam, F, 0, hw, hw * 0.96, wallTop, archH, 8, alpha, [126, 122, 114]);
    // 1) The mismatched panels — two salvaged plates of a different metal slapped over the flank.
    { const [px, py] = F(-hw * 0.58, -hw * 0.18); draw3DBoxAt(ctx, cam, px, py, hw * 0.24, wallTop * 0.14, wallTop * 0.7, 'ty_reach_rust', seed + 3, night, alpha, false); }
    { const [px, py] = F(-hw * 0.58, hw * 0.34); draw3DBoxAt(ctx, cam, px, py, hw * 0.2, wallTop * 0.3, wallTop * 0.92, 'ty_reach_hangar', seed + 4, night, alpha, false); }
    // 2) ROLLER DOOR, up. A dark bay wide enough to take a truck, with the door itself rolled into
    //    a drum above the opening.
    if (frontVis) {
      const odw = hw * 0.6, oTop = wallTop * 0.76;
      const o = [P(-odw, hw + 0.003, 0), P(odw, hw + 0.003, 0), P(odw, hw + 0.003, oTop), P(-odw, hw + 0.003, oTop)];
      // A plain dark rectangle on the gable, in the wall's own plane — a flat world quad, which is
      // the one shape the decal layer was written for.
      emitDecoFill(ctx, cam, [W3(-odw, hw + 0.003, oTop), W3(odw, hw + 0.003, oTop), W3(odw, hw + 0.003, 0), W3(-odw, hw + 0.003, 0)],
        night ? 'rgba(40,36,30,0.96)' : 'rgba(16,16,18,0.97)', alpha, 0.002);
      { const [rx, ry] = F(0, hw * 0.96); drawFacetDrum(ctx, cam, rx, ry, oTop, oTop + h * 0.08, odw, odw, 6, alpha, (f) => `rgb(${118 + f.nl * 44 | 0},${114 + f.nl * 40 | 0},${106 + f.nl * 34 | 0})`, 'rgb(70,68,64)'); }
      // THE LAST LOA — freehand, and then they gave up on the second D.
      { const bz0 = oTop + h * 0.1, bz1 = oTop + h * 0.22, bhw = hw * 0.66;
        const TL = P(-bhw, hw + 0.006, bz1), TR = P(bhw, hw + 0.006, bz1), BR = P(bhw, hw + 0.006, bz0), BL = P(-bhw, hw + 0.006, bz0);
        if ([TL, TR, BR, BL].every(p => p.f > 0.12)) { const tex = bakeSignText('THE LAST LOA', m.neon || '#ffb14a', night ? 1 : 0, false); emitSurfaceText(ctx, cam, [TL, TR, BR, BL], tex, false, alpha); } }
      if (night) { const [bx, by] = F(0, hw); glowPool(ctx, cam, bx, by, wallTop * 0.34, '255,200,132', 12, alpha * 0.36); }
    }
    // 3) TWO TRAILERS on their legs alongside, grass grown up through the axles.
    for (const [i, s] of [[0, 0.78], [1, 1.18]]) {
      const [tx, ty] = F(fh * s, -fh * 0.1);
      draw3DBoxAt(ctx, cam, tx, ty, fh * 0.16, h * 0.14, h * 0.46, 'ty_reach_hangar', seed + 20 + i, night, alpha, true);
      for (const o of [-0.1, 0.1]) { const [lx, ly] = F(fh * s + fh * o, -fh * 0.1); draw3DBoxAt(ctx, cam, lx, ly, fh * 0.02, 0, h * 0.14, 'ty_reach_grey_dk', seed + 24 + i, night, alpha, false); }
    }
    // 4) A fuel can wedging something open, which is how everything here is held.
    { const [cx, cy] = F(-hw * 0.5, hw * 1.06); draw3DBoxAt(ctx, cam, cx, cy, fh * 0.05, 0, h * 0.1, 'ty_reach_rust', seed + 30, night, alpha, true); }
  },
};
