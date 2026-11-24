// The Reach: building-model arms for Main Street, the motel, the genset and Buzzard Field.
//
// These were `case` arms in drawTypeModelArm (windshield.js) until 2026-10-01. drawTypeModelArm
// still picks the arm (see typeArm there) and runs the shared prologue and the detail pass after
// it; an arm only draws its own building. Every arm takes drawTypeModelArm's arguments and its
// prologue locals, in this order, so a body reads exactly as it did as a case:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// An arm that ends early uses `return` where the case used `break`. How a tile becomes a building
// is in docs/reference/world-rendering.md.
import '../reach-neon.js';
import { drawEntrance } from '../entrance.js';   // registers the Reach's neon signs (the Coyote's badge) with the neon kit
import {
  DECO_PULL, DETAIL_LIFT, FACE_EPS, SHAPE_SINK, TR, awning, bakeNeonArt, clamp, faceYaw, flatsDropped, massDropped, rgb, bakeSignText, blinkLight, draw3DBoxAt, drawBarrelRoof, drawFacetDrum,
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
  saloon(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {
    // THE COYOTE'S REST: four storeys of timber on Main Street, the town's saloon and its parlour,
    // with the rooms over it where the people who work it live (docs/proposals/reach-rebuild.md).
    // Timber and neon: board walls with the 2077 bolted on (dishes, aerials, cameras, air
    // conditioners, a few panels on the roof) and the light on it after dark. The badge on the
    // false front is the town's brightest sign; every other light here answers to it.
    //
    // ⚠ IN TILE UNITS, NEVER fh AND h, the dealership's reason: the rooms will be fitted to this
    //    model (the Embassy's and the Yards' way), and a storey is 3.5 m whatever the tile rolled.
    //    About 18 m to the tile; a storey is 0.196.
    // ⚠ NO FACE EXISTS BY NIGHT ONLY: every flat is emitted day and night and only its colour
    //    follows the hour, because the night mesh pairs with the day one face for face.
    // Local frame: +y is Main Street (the door side), -x the Dynamo, +x the Layover.
    const dn = night ? clamp(+night, 0, 1) : 0, dusk = 1 - 0.55 * dn, yaw = faceYaw(E);
    const XW = -0.40, XE = 0.40, YB = -0.36, YF = 0.28;               // the walls
    const PORCH = 0.43, G0 = 0.022, F2 = 0.24, F3 = 0.43, F4 = 0.62, EAVE = 0.81;   // porch edge, floor levels, roof
    const TIMBER = 'ty_reach_saloon', DARK = 'ty_reach_saloon_dk', DECK = 'ty_reach_porch', TIN = 'ty_reach_rust', SHAKE = 'ty_reach_shake';
    const TRIM = [74, 56, 40], GLASS = [58, 66, 72], WARM = [255, 196, 122], DIM = [34, 30, 34];
    const box = (lx, ly, hx, hy, z0, z1, p, roof = true, s = 0) => {
      if (massDropped()) return;
      const [x, y] = F(lx, ly);
      draw3DBoxAt(ctx, cam, x, y, hx, z0, z1, p, seed + s, night, alpha, roof, yaw, hy);
    };
    const O = W3(0, 0, 0);
    const cl = (c) => c.map((v) => Math.round(clamp(v, 0, 255)));
    const mixc = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
    // A flat in the model's frame, facing local `out`; `day` and `lit` are [r,g,b].
    const flat = (pts, out, day, lit, a = 1, lift = 1) => {
      if (SHAPE_SINK || flatsDropped()) return;
      const Dw = W3(out[0], out[1], out[2]), o = [Dw[0] - O[0], Dw[1] - O[1], Dw[2] - O[2]];
      let q = pts.map((p) => W3(p[0], p[1], p[2]));
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < q.length; i++) { const a2 = q[i], b2 = q[(i + 1) % q.length]; nx += (a2[1] - b2[1]) * (a2[2] + b2[2]); ny += (a2[2] - b2[2]) * (a2[0] + b2[0]); nz += (a2[0] - b2[0]) * (a2[1] + b2[1]); }
      if (nx * o[0] + ny * o[1] + nz * o[2] < 0) q = q.reverse();
      emitFlat(ctx, cam, q, rgb(cl(lit ? mixc(day, lit, dn) : day.map((v) => v * dusk))), alpha * a,
        { lift: DETAIL_LIFT * lift, cullN: Math.abs(o[2]) < 0.8 ? [o[0], o[1]] : undefined });
    };
    // A panel on a wall: side f (front), b (back), w (-x) or e (+x), on the plane `d`, from u0 to u1
    // along the wall and z0 to z1 up.
    const OUTS = { f: [0, 1, 0], b: [0, -1, 0], w: [-1, 0, 0], e: [1, 0, 0] };
    const pane = (side, d, u0, u1, z0, z1, day, lit, a, lift) => {
      const P = side === 'f' || side === 'b' ? (u, z) => [u, d, z] : (u, z) => [d, u, z];
      flat([P(u0, z1), P(u1, z1), P(u1, z0), P(u0, z0)], OUTS[side], day, lit, a, lift);
    };
    const WALL = { f: YF, b: YB, w: XW, e: XE }, SGN = { f: 1, b: -1, w: -1, e: 1 };
    const at = (side, k) => WALL[side] + SGN[side] * FACE_EPS * k;
    // A box standing proud of a wall: `u` along it, `out` away from it.
    const wallBox = (side, u, out, hu, ho, z0, z1, p, s) => {
      if (side === 'f') box(u, YF + out, hu, ho, z0, z1, p, true, s);
      else if (side === 'b') box(u, YB - out, hu, ho, z0, z1, p, true, s);
      else if (side === 'w') box(XW - out, u, ho, hu, z0, z1, p, true, s);
      else box(XE + out, u, ho, hu, z0, z1, p, true, s);
    };
    const wire = (a, b, w, css, o) => { if (!SHAPE_SINK) emitWire(ctx, cam, W3(...a), W3(...b), w, css, alpha, { pull: 0.02, ...(o || {}) }); };
    // A hoop round a barrel or tank. drawRing pulls DECO_PULL (0.05), more than these drums are wide, so
    // its far arc came out through the drum (glself); a hoop lies ON its drum, so a hair of pull will do.
    const hoop = (wx, wy, z, r, N, css) => { if (SHAPE_SINK) return; for (let i = 0; i < N; i++) { const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832; emitWire(ctx, cam, [wx + Math.cos(a0) * r, wy + Math.sin(a0) * r, z], [wx + Math.cos(a1) * r, wy + Math.sin(a1) * r, z], 1, css, alpha, { pull: 0.002 }); } };
    // Which windows are lit tonight: a roll per window off the tile's seed, so it holds frame to frame.
    const roll = (i) => { const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return s - Math.floor(s); };
    const MAGENTA = 'rgba(255,63,180,0.95)', PALE_TUBE = 'rgba(214,218,222,0.85)';

    // A sash window: surround, glass (warm and lit, or dark), a curtain, the bars, a sill and a head,
    // and as asked shutters, an air conditioner under it, or a neon tube round it.
    let wi = 0;
    const win = (side, u, z0, z1, hw, o = {}) => {
      const i = wi++, lit = o.lit ?? roll(i) < 0.62, curtain = roll(i + 40);
      pane(side, at(side, 1), u - hw - 0.009, u + hw + 0.009, z0 - 0.009, z1 + 0.009, TRIM, null, 1, 1.1);
      pane(side, at(side, 2), u - hw, u + hw, z0, z1, GLASS, lit ? WARM : DIM, 1, 1.3);
      const cc = curtain < 0.33 ? [150, 40, 46] : curtain < 0.66 ? [196, 176, 132] : [64, 92, 120];
      pane(side, at(side, 3), u - hw, u - hw * 0.25, z0 + 0.004, z1, cc.map((v) => v * 0.8), lit ? mixc(cc, WARM, 0.55) : cc.map((v) => v * 0.35), 1, 1.4);
      pane(side, at(side, 4), u - hw, u + hw, (z0 + z1) / 2 - 0.0025, (z0 + z1) / 2 + 0.0025, TRIM, null, 1, 1.5);
      pane(side, at(side, 4), u - 0.0025, u + 0.0025, z0, z1, TRIM, null, 1, 1.5);
      wallBox(side, u, 0.010, hw + 0.016, 0.010, z0 - 0.020, z0 - 0.009, DARK, 100 + i);   // sill
      wallBox(side, u, 0.008, hw + 0.018, 0.008, z1 + 0.009, z1 + 0.022, DARK, 200 + i);   // head
      if (o.shutters) for (const s of [-1, 1]) {
        const u0 = u + s * (hw + 0.012), u1 = u + s * (hw + 0.012 + hw * 0.85);
        pane(side, at(side, 1), Math.min(u0, u1), Math.max(u0, u1), z0, z1, [92, 104, 84], null, 1, 1.2);
        for (const zz of [z0 + (z1 - z0) * 0.33, z0 + (z1 - z0) * 0.66]) pane(side, at(side, 2), Math.min(u0, u1), Math.max(u0, u1), zz - 0.002, zz + 0.002, [60, 70, 54], null, 1, 1.3);
      }
      if (o.ac) {   // an air conditioner in the lower sash, a drip stain down the boards under it
        wallBox(side, u + hw * 0.3, 0.018, hw * 0.55, 0.018, z0 - 0.006, z0 + 0.034, 'ty_reach_grey', 300 + i);
        pane(side, at(side, 1), u + hw * 0.15, u + hw * 0.45, z0 - 0.12, z0 - 0.022, [70, 58, 44], null, 0.5, 1.05);
      }
      if (o.neon) {   // a magenta tube round the frame: pale glass by day, lit after dark
        const off = WALL[side] + SGN[side] * 0.006, P = side === 'f' || side === 'b' ? (uu, zz) => [uu, off, zz] : (uu, zz) => [off, uu, zz];
        const css = dn ? MAGENTA : PALE_TUBE, opt = { glow: dn ? 6 : 0, glowCss: 'rgb(255,80,190)' };
        const a = P(u - hw - 0.016, z0 - 0.016), b = P(u + hw + 0.016, z0 - 0.016), c = P(u + hw + 0.016, z1 + 0.016), d = P(u - hw - 0.016, z1 + 0.016);
        wire(a, b, 2, css, opt); wire(b, c, 2, css, opt); wire(c, d, 2, css, opt); wire(d, a, 2, css, opt);
      }
      if (lit && dn && o.spill) { const [gx, gy] = F(...(side === 'f' ? [u, YF + 0.04] : side === 'b' ? [u, YB - 0.04] : side === 'w' ? [XW - 0.04, u] : [XE + 0.04, u])); glowPool(ctx, cam, gx, gy, (z0 + z1) / 2, '255,190,110', 7, alpha * 0.3 * dn); }
    };

    // 1) THE MASS. A stone plinth, four storeys of board, a belt at each floor, corner boards, and a
    //    flat tin roof behind a low parapet. The false front stands on the street face.
    box(0, (YB + YF) / 2, XE + 0.012, (YF - YB) / 2 + 0.012, 0, G0, 'ty_reach_grey_dk', true, 1);
    box(0, (YB + YF) / 2, XE, (YF - YB) / 2, G0, EAVE, TIMBER, false, 2);
    box(0, (YB + YF) / 2, XE, (YF - YB) / 2, EAVE, EAVE + 0.006, TIN, true, 3);
    for (const [k, z] of [F2, F3, F4].entries()) box(0, (YB + YF) / 2, XE + 0.006, (YF - YB) / 2 + 0.006, z - 0.006, z + 0.004, DARK, false, 4 + k);
    for (const [k, [x, y]] of [[XW, YB], [XE, YB], [XW, YF], [XE, YF]].entries()) box(x, y, 0.012, 0.012, G0, EAVE, DARK, false, 8 + k);
    // the parapet round the sides and back, with a coping
    box(XW + 0.008, (YB + YF) / 2, 0.008, (YF - YB) / 2, EAVE, EAVE + 0.05, TIMBER, true, 12);
    box(XE - 0.008, (YB + YF) / 2, 0.008, (YF - YB) / 2, EAVE, EAVE + 0.05, TIMBER, true, 13);
    box(0, YB + 0.008, XE, 0.008, EAVE, EAVE + 0.05, TIMBER, true, 14);

    // 2) THE FALSE FRONT. A board face carried up past the roof and stepped at the top, with a
    //    moulded cap on each step and brackets under the cornice.
    const FFY = YF + 0.008, steps = [[XE + 0.01, EAVE + 0.07], [0.27, EAVE + 0.12], [0.14, EAVE + 0.17]];
    for (const [k, [hx, top]] of steps.entries()) {
      box(0, FFY, hx, 0.008, EAVE - 0.01, top, TIMBER, true, 20 + k);
      box(0, FFY + 0.004, hx + 0.012, 0.014, top, top + 0.014, DARK, true, 24 + k);   // the cap
    }
    for (let k = 0; k < 9; k++) { const x = -0.36 + k * 0.09; box(x, FFY + 0.014, 0.008, 0.008, EAVE + 0.035, EAVE + 0.062, DARK, true, 30 + k); }   // cornice brackets
    box(0, FFY + 0.010, XE + 0.016, 0.012, EAVE + 0.062, EAVE + 0.07, DARK, true, 40);   // the cornice board

    // 3) THE BADGE, on the false front: the town's beacon, a third of the building's height. Its
    //    quad is drawn taller than wide so it reads round through GLASS's camera (building-styles
    //    §2.8). After dark one letter stutters for half a second every nine.
    const BW = 0.23, BH = BW * 1.45, bz0 = EAVE + 0.01, bz1 = bz0 + BH, BY = FFY + 0.028;
    box(0, FFY + 0.014, 0.012, 0.012, bz0 + 0.03, bz1 - 0.06, 'ty_reach_iron', true, 41);   // the standoff it hangs on
    if (frontVis) {
      const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
      const q = [P(-BW / 2, BY, bz1), P(BW / 2, BY, bz1), P(BW / 2, BY, bz0), P(-BW / 2, BY, bz0)];
      if (q.every((p) => p.f > 0.12)) {
        const t = (now || 0) / 1000, stutter = dn && t % 9 < 0.5 && Math.floor(t * 14) % 2 === 0;
        const tex = bakeNeonArt('reach.coyotesrest', dn ? 1 : 0, stutter ? 'name:5' : '', BW / BH);
        emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
      }
    }
    if (dn) { const [gx, gy] = F(0, YF + 0.14); glowPool(ctx, cam, gx, gy, (bz0 + bz1) / 2, '255,140,48', 14, alpha * 0.34 * dn); glowPool(ctx, cam, gx, gy, bz1 - BH * 0.1, '70,220,255', 8, alpha * 0.18 * dn); }

    // 4) THE PORCH AND THE GALLERY. A board deck on the street with two steps at the door; posts
    //    carrying the gallery at the first floor, its rail and balusters; the posts going on up to
    //    a tin roof over the gallery; lanterns under it; a magenta tube along its fascia.
    const PX = [-0.395, -0.24, -0.09, 0.09, 0.24, 0.395], PY = PORCH - 0.012;
    box(0, (YF + PORCH) / 2, XE + 0.02, (PORCH - YF) / 2, 0, G0, DECK, true, 50);
    box(0, PORCH + 0.016, 0.075, 0.016, 0, G0 * 0.66, DECK, true, 51);
    box(0, PORCH + 0.044, 0.075, 0.012, 0, G0 * 0.33, DECK, true, 52);
    for (const [k, x] of PX.entries()) {
      box(x, PY, 0.009, 0.009, G0, F3 - 0.01, DARK, false, 60 + k);
      box(x, PY - 0.016, 0.006, 0.02, F2 - 0.035, F2 - 0.025, DARK, true, 70 + k);   // the bracket under the gallery
    }
    box(0, (YF + PORCH) / 2, XE + 0.02, (PORCH - YF) / 2, F2, F2 + 0.014, DECK, true, 80);            // gallery deck
    box(0, PORCH - 0.002, XE + 0.02, 0.004, F2 - 0.032, F2, DARK, true, 81);                             // its fascia
    box(0, PY, XE + 0.02, 0.005, F2 + 0.078, F2 + 0.088, DARK, true, 82);                                // top rail
    box(0, PY, XE + 0.02, 0.004, F2 + 0.028, F2 + 0.034, DARK, true, 83);                                // bottom rail
    for (let k = 0; k <= 32; k++) { const x = -0.41 + k * (0.82 / 32); flat([[x - 0.003, PY + 0.004, F2 + 0.078], [x + 0.003, PY + 0.004, F2 + 0.078], [x + 0.003, PY + 0.004, F2 + 0.014], [x - 0.003, PY + 0.004, F2 + 0.014]], [0, 1, 0], [86, 66, 46], null, 1, 1.2); }   // balusters
    box(0, (YF + PORCH) / 2 + 0.008, XE + 0.03, (PORCH - YF) / 2 + 0.014, F3 - 0.012, F3 - 0.002, TIN, true, 84);   // the gallery's tin roof
    { const css = dn ? MAGENTA : PALE_TUBE, opt = { glow: dn ? 7 : 0, glowCss: 'rgb(255,80,190)' };
      wire([-0.41, PORCH + 0.003, F2 - 0.012], [0.41, PORCH + 0.003, F2 - 0.012], 2.2, css, opt); }
    for (const x of [-0.24, 0.24]) {   // lanterns under the gallery
      box(x, (YF + PORCH) / 2, 0.012, 0.012, F2 - 0.06, F2 - 0.032, 'ty_reach_iron', true, 90 + x);
      pane('f', (YF + PORCH) / 2 + 0.0125, x - 0.008, x + 0.008, F2 - 0.056, F2 - 0.036, [140, 120, 80], [255, 214, 150], 1, 1.4);
      if (dn) { const [gx, gy] = F(x, (YF + PORCH) / 2); glowPool(ctx, cam, gx, gy, F2 - 0.045, '255,200,130', 10, alpha * 0.5 * dn); }
    }

    // 5) THE STREET FRONT. Batwing doors in the middle with the saloon lit behind them and a dust
    //    curtain shimmering across the opening; a big window either side with neon in it (SALOON
    //    in magenta, a pint in cyan on a holo screen); a shuttered window at each end; a round COLD
    //    BEER lightbox hung under the gallery either side of the door; a chalkboard.
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: 0, y: YF, w: 0.052, z0: G0, top: 0.185, leaves: 2, frameW: 0.008, depth: 0.010,
      frame: TRIM, lobby: { day: [70, 50, 34], night: [255, 182, 104] }, lamp: '255,196,120', mat: false, step: false, frontVis });
    for (const s of [-1, 1]) {   // the batwings: slatted half-doors at waist height, standing proud of the opening
      const u0 = s < 0 ? -0.05 : 0.004, u1 = s < 0 ? -0.004 : 0.05, y = YF + 0.026;
      pane('f', y, u0, u1, G0 + 0.045, G0 + 0.125, [104, 76, 48], null, 1, 1.8);
      for (let k = 1; k < 5; k++) { const z = G0 + 0.045 + k * 0.016; pane('f', y + 0.0008, u0 + 0.004, u1 - 0.004, z - 0.002, z + 0.002, [70, 50, 32], null, 1, 1.9); }
    }
    pane('f', YF + 0.018, -0.052, 0.052, G0, 0.185, [120, 200, 220], [150, 230, 255], 0.08, 1.7);   // the dust curtain
    for (const s of [-1, 1]) {
      const u = s * 0.165;
      win('f', u, G0 + 0.04, 0.19, 0.058, { lit: true, spill: true });
      if (frontVis) {   // the neon in the window: SALOON on the left, the holo pint on the right
        const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
        const y = YF + 0.012;
        if (s < 0) {
          const tex = bakeSignText('SALOON', '#ff3fb4', dn ? 1 : 0, false, false, true, { font: 'western' });
          const q = [P(u - 0.05, y, 0.15), P(u + 0.05, y, 0.15), P(u + 0.05, y, 0.105), P(u - 0.05, y, 0.105)];
          if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 3);
        } else {
          const tex = bakeNeonArt('reach.holopint', dn ? 1 : 0, '', 0.66 / 1.45);
          const q = [P(u - 0.028, y, 0.18), P(u + 0.028, y, 0.18), P(u + 0.028, y, 0.065), P(u - 0.028, y, 0.065)];
          if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 3);
        }
      }
    }
    for (const s of [-1, 1]) win('f', s * 0.32, G0 + 0.05, 0.17, 0.042, { shutters: true });
    for (const s of [-1, 1]) {   // the lightboxes, round, on a bracket under the gallery
      const x = s * 0.24 + s * -0.0, y = PORCH - 0.03;
      box(x, y, 0.004, 0.004, F2 - 0.032, F2 - 0.02, 'ty_reach_iron', true, 95 + s);
      if (frontVis) {
        const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); };
        const tex = bakeNeonArt('reach.colddisc', dn ? 1 : 0, '', 1 / 1.45), r = 0.026;
        const q = [P(x - r, y, F2 - 0.02), P(x + r, y, F2 - 0.02), P(x + r, y, F2 - 0.02 - r * 2 * 1.45), P(x - r, y, F2 - 0.02 - r * 2 * 1.45)];
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 3);
      }
    }
    // the chalkboard by the door, on its easel
    box(0.105, YF + 0.045, 0.022, 0.006, G0, G0 + 0.085, DARK, true, 97);
    pane('f', YF + 0.0515, 0.087, 0.123, G0 + 0.03, G0 + 0.08, [38, 44, 40], null, 1, 1.4);
    if (frontVis) { const P = (lx, ly, z) => { const [wx, wy] = F(lx, ly); return cam.proj(wx, wy, z); }; const tex = bakeSignText('POKER 9PM', '#e8e4d8', 0, false, true, true, { font: 'script' }); const q = [P(0.089, YF + 0.053, G0 + 0.075), P(0.121, YF + 0.053, G0 + 0.075), P(0.121, YF + 0.053, G0 + 0.04), P(0.089, YF + 0.053, G0 + 0.04)]; if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 3); }

    // 6) THE PORCH FURNITURE AND THE STREET EDGE: barrels and a bench on the boards, a trough and a
    //    hitching rail at the edge with a hover bike tied to it, and a charging post with its lamp.
    for (const [k, [x, y]] of [[-0.36, 0.33], [-0.33, 0.36], [0.36, 0.34]].entries()) {
      const [bx, by] = F(x, y);
      drawFacetDrum(ctx, cam, bx, by, G0, G0 + 0.05, 0.019, 0.019, 10, alpha, (f) => rgb(cl([108 + f.nl * 44, 78 + f.nl * 30, 48 + f.nl * 18].map((v) => v * dusk))), rgb(cl([86 * dusk, 64 * dusk, 40 * dusk])));
      hoop(bx, by, G0 + 0.014, 0.0195, 10, 'rgba(40,34,30,0.8)'); hoop(bx, by, G0 + 0.038, 0.0195, 10, 'rgba(40,34,30,0.8)');
    }
    box(0.30, YF + 0.03, 0.05, 0.012, G0 + 0.024, G0 + 0.03, DECK, true, 98);   // bench seat
    for (const x of [0.255, 0.345]) box(x, YF + 0.03, 0.004, 0.01, G0, G0 + 0.024, DARK, true, 99 + x);
    for (const x of [-0.30, -0.14, 0.14, 0.30]) box(x, 0.475, 0.006, 0.006, 0, 0.055, DARK, true, 110 + x);   // hitching posts
    for (const s of [-1, 1]) box(s * 0.22, 0.475, 0.085, 0.004, 0.047, 0.055, DARK, true, 115 + s);       // the rails
    box(-0.22, 0.49, 0.06, 0.012, 0, 0.028, 'ty_reach_water', true, 118);                                  // the trough
    { // a hover bike tied to the right-hand rail: a low body, a saddle, its fan pods, a glow under it after dark
      box(0.22, 0.495, 0.04, 0.011, 0.018, 0.034, 'ty_reach_iron', true, 120);
      box(0.215, 0.495, 0.016, 0.008, 0.034, 0.042, DARK, true, 121);
      for (const s of [-1, 1]) { const [bx, by] = F(0.22 + s * 0.036, 0.495); drawFacetDrum(ctx, cam, bx, by, 0.014, 0.03, 0.013, 0.013, 8, alpha, (f) => rgb(cl([60 + f.nl * 40, 64 + f.nl * 40, 70 + f.nl * 40].map((v) => v * dusk))), 'rgb(30,32,36)'); }
      if (dn) { const [gx, gy] = F(0.22, 0.495); glowPool(ctx, cam, gx, gy, 0.012, '80,220,255', 6, alpha * 0.45 * dn); }
    }
    box(0.43, 0.30, 0.008, 0.008, 0, 0.075, 'ty_reach_grey', true, 122);   // the charging post
    pane('f', 0.308 + FACE_EPS, 0.425, 0.435, 0.055, 0.068, [40, 120, 140], [110, 240, 255], 1, 1.5);
    if (dn) { const [gx, gy] = F(0.43, 0.31); glowPool(ctx, cam, gx, gy, 0.06, '90,230,255', 5, alpha * 0.5 * dn); }

    // 7) THE UPPER FLOORS ON THE STREET. French doors onto the gallery and a window between; the
    //    second and third floors in five bays, shuttered at the ends, two with air conditioners and
    //    two with a magenta tube round them, which is what the street sees lit at night.
    for (const s of [-1, 1]) win('f', s * 0.165, F2 + 0.018, F2 + 0.16, 0.042, { spill: true });
    for (const u of [-0.32, 0, 0.32]) win('f', u, F2 + 0.06, F2 + 0.155, 0.038, { shutters: Math.abs(u) > 0.1 });
    const BAYS = [-0.32, -0.165, 0, 0.165, 0.32];
    for (const u of BAYS) win('f', u, F3 + 0.05, F3 + 0.15, 0.038, { shutters: Math.abs(u) > 0.3, ac: u === -0.32, neon: u === 0.165 });
    for (const u of BAYS) win('f', u, F4 + 0.05, F4 + 0.15, 0.038, { shutters: Math.abs(u) > 0.3, ac: u === 0.165, neon: u === -0.165 });

    // 8) THE SIDES. Windows on every floor; on the Dynamo's side a ghost sign painted across the top
    //    floor in faded letters; on the Layover's side an outside stair up to the second floor's
    //    own door, for the people who live upstairs.
    for (const z of [F2, F3]) for (const y of [-0.22, 0.0, 0.18]) win('w', y, z + 0.05, z + 0.15, 0.036, { shutters: y === 0.0 });
    for (const y of [-0.22, 0.12]) win('w', y, G0 + 0.06, 0.17, 0.036, {});
    { // the ghost sign: faded cream paint on the board, never lit
      const tex = bakeSignText('ROOMS · BATHS · CARDS', 'rgb(206,190,156)', 0, false, true, true, { font: 'western' });
      const P = (u, z) => { const [wx, wy] = F(XW - 0.004, u); return cam.proj(wx, wy, z); };
      const q = [P(-0.30, F4 + 0.15), P(0.22, F4 + 0.15), P(0.22, F4 + 0.04), P(-0.30, F4 + 0.04)];
      const [ax, ay] = F(XW, 0), [bx, by] = F(XW - 1, 0);
      const vis = ((cam.ex || 0) - ax) * (bx - ax) + ((cam.ey || 0) - ay) * (by - ay) > 0;
      if (vis && tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha * 0.62, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2);
    }
    for (const z of [G0, F2, F3, F4]) for (const y of [-0.22, 0.0]) if (z !== G0 || y < 0) win('e', y, z + 0.05, z + 0.15, 0.036, { shutters: z === F4, ac: z === F3 && y === 0 });
    { // the outside stair: a flight up the Layover's side from the street end to a landing at the
      // first floor, a second flight back up to the second floor's door, posts and a hand rail
      const SX = XE + 0.05, N = 9;
      const flight = (y0, y1, z0, z1, s) => {
        for (let k = 0; k < N; k++) { const y = y0 + (y1 - y0) * (k + 0.5) / N, z = z0 + (z1 - z0) * (k + 1) / N; box(SX, y, 0.045, Math.abs(y1 - y0) / N / 2, z - 0.01, z, DECK, true, s + k); }
        wire([SX + 0.045, y0, z0 + 0.07], [SX + 0.045, y1, z1 + 0.07], 1.6, `rgba(${Math.round(70 * dusk)},${Math.round(54 * dusk)},${Math.round(38 * dusk)},0.95)`);
      };
      flight(0.24, -0.08, G0, F2, 130);
      box(SX, -0.16, 0.05, 0.08, F2 - 0.012, F2, DECK, true, 140);   // the landing
      for (const y of [-0.235, -0.085]) box(SX + 0.042, y, 0.006, 0.006, 0, F3 + 0.06, DARK, true, 141 + y);
      flight(-0.08, 0.22, F2, F3, 150);
      box(SX, 0.25, 0.05, 0.04, F3 - 0.012, F3, DECK, true, 160);   // the top landing
      box(SX + 0.042, 0.285, 0.006, 0.006, 0, F3 + 0.06, DARK, true, 161);
      pane('e', at('e', 2), 0.21, 0.27, F3, F3 + 0.15, [86, 64, 44], null, 1, 1.3);   // the door, plain boards
      pane('e', at('e', 3), 0.255, 0.262, F3 + 0.07, F3 + 0.08, [200, 170, 90], null, 1, 1.4);   // its handle
      if (dn) { const [gx, gy] = F(XE + 0.03, 0.24); glowPool(ctx, cam, gx, gy, F3 + 0.17, '255,200,130', 6, alpha * 0.4 * dn); }
    }

    // 9) THE BACK. A plank door with a lamp over it, the cellar's bulkhead doors down to the Stash,
    //    kegs and crates, the windows of the rooms, and a down pipe at each corner.
    for (const z of [F2, F3, F4]) for (const u of [-0.25, 0.0, 0.25]) win('b', u, z + 0.05, z + 0.15, 0.036, { shutters: u === 0 });
    pane('b', at('b', 2), 0.17, 0.24, G0, 0.17, [82, 60, 40], null, 1, 1.3);
    if (dn) { const [gx, gy] = F(0.205, YB - 0.03); glowPool(ctx, cam, gx, gy, 0.19, '255,200,130', 7, alpha * 0.45 * dn); }
    { // the bulkhead: two sloped board doors over the cellar steps
      const y0 = YB - 0.004, y1 = YB - 0.09, z0 = 0.05, z1 = 0.004;
      flat([[-0.20, y0, z0], [-0.11, y0, z0], [-0.11, y1, z1], [-0.20, y1, z1]], [0, -0.5, 0.86], [96, 72, 48], null, 1, 1.2);
      flat([[-0.11, y0, z0], [-0.02, y0, z0], [-0.02, y1, z1], [-0.11, y1, z1]], [0, -0.5, 0.86], [88, 66, 44], null, 1, 1.25);
      box(-0.11, (y0 + y1) / 2, 0.092, 0.045, 0, 0.004, 'ty_reach_grey_dk', true, 170);
    }
    for (const [k, [x, y]] of [[0.30, YB - 0.04], [0.34, YB - 0.05], [0.32, YB - 0.09]].entries()) {
      const [bx, by] = F(x, y);
      drawFacetDrum(ctx, cam, bx, by, 0, 0.045, 0.02, 0.02, 10, alpha, (f) => rgb(cl([150 + f.nl * 60, 154 + f.nl * 60, 160 + f.nl * 60].map((v) => v * dusk))), rgb(cl([120 * dusk, 124 * dusk, 128 * dusk])));
      hoop(bx, by, 0.012, 0.0205, 10, 'rgba(60,62,66,0.9)');
    }
    box(0.08, YB - 0.04, 0.03, 0.03, 0, 0.05, 'ty_reach_board', true, 171);
    box(0.085, YB - 0.045, 0.024, 0.024, 0.05, 0.09, 'ty_reach_board', true, 172);
    for (const [k, [x, y]] of [[XW - 0.004, YB - 0.004], [XE + 0.004, YB - 0.004]].entries()) box(x, y, 0.005, 0.005, 0, EAVE + 0.04, 'ty_reach_iron', true, 175 + k);

    // 10) THE ROOF: a water tank on legs, two dishes, an aerial with its red light, panels propped
    //     facing the sun, an air-conditioner condenser, the hatch, a stovepipe with smoke, cameras on
    //     the front corners, and the cable from the Dynamo coming in over the parapet.
    { const tx = -0.22, ty = -0.20, legTop = EAVE + 0.10, r = 0.06;
      for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(tx + ox * r * 0.8, ty + oy * r * 0.8, 0.005, 0.005, EAVE, legTop, 'ty_reach_iron', true, 180);
      const [wx, wy] = F(tx, ty);
      drawFacetDrum(ctx, cam, wx, wy, legTop, legTop + 0.10, r, r, 12, alpha, (f) => rgb(cl([118 + f.nl * 50, 92 + f.nl * 38, 64 + f.nl * 24].map((v) => v * dusk))), rgb(cl([90 * dusk, 70 * dusk, 48 * dusk])));
      for (const z of [legTop + 0.025, legTop + 0.075]) hoop(wx, wy, z, r * 1.01, 12, 'rgba(40,34,30,0.85)');
      flat([[tx - r, ty, legTop + 0.10], [tx, ty - r, legTop + 0.10], [tx + r, ty, legTop + 0.10], [tx, ty + r, legTop + 0.10]], [0, 0, 1], [80, 62, 42], null, 1, 1.1); }
    const dishAt = (x, y, z, r, aim, s) => {   // a dish on a short post, its bowl tipped toward `aim` (radians in the plan)
      box(x, y, 0.005, 0.005, EAVE, z, 'ty_reach_grey', true, s);
      const ax = Math.cos(aim), ay = Math.sin(aim), tilt = 0.55, ring = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, c = Math.cos(a) * r, sn = Math.sin(a) * r; ring.push([x - ay * c + ax * sn * Math.sin(tilt), y + ax * c + ay * sn * Math.sin(tilt), z + sn * Math.cos(tilt)]); }
      for (let k = 0; k < 10; k += 2) flat([[x, y, z], ring[k], ring[(k + 1) % 10], ring[(k + 2) % 10]], [ax, ay, 0.5], [206, 208, 212], null, 1, 1.2);
      wire([x, y, z], [x + ax * r * 1.2, y + ay * r * 1.2, z + r * 0.4], 1.2, 'rgba(120,124,130,0.95)');
    };
    dishAt(0.30, 0.20, EAVE + 0.06, 0.04, Math.PI * 0.8, 185);
    dishAt(-0.33, 0.05, EAVE + 0.045, 0.028, Math.PI * 1.1, 186);
    { box(0.32, -0.28, 0.006, 0.006, EAVE, EAVE + 0.26, 'ty_reach_grey', true, 187);   // the aerial
      for (const z of [EAVE + 0.16, EAVE + 0.21]) wire([0.29, -0.28, z], [0.35, -0.28, z], 1.4, 'rgba(150,154,160,0.95)');
      const [ax2, ay2] = F(0.32, -0.28); blinkLight(ctx, cam, ax2, ay2, EAVE + 0.265, '255,60,50', now, seed + 7, alpha, 1.2); }
    for (const k of [0, 1, 2]) {   // panels, propped facing the street side's sun
      const x0 = -0.05 + k * 0.1, y0 = -0.30, y1 = -0.20, zLo = EAVE + 0.012, zHi = EAVE + 0.06;
      flat([[x0, y0, zLo], [x0 + 0.085, y0, zLo], [x0 + 0.085, y1, zHi], [x0, y1, zHi]], [0, 0.6, 0.8], [36, 44, 70], [30, 36, 56], 1, 1.1);
      wire([x0 + 0.0425, y0, zLo], [x0 + 0.0425, y1, zHi], 1, 'rgba(150,160,180,0.7)');
      box(x0 + 0.0425, y0 + 0.004, 0.003, 0.003, EAVE, zLo + 0.004, 'ty_reach_iron', true, 190 + k);
      box(x0 + 0.0425, y1 - 0.004, 0.003, 0.003, EAVE, zHi, 'ty_reach_iron', true, 193 + k);
    }
    box(0.18, -0.02, 0.04, 0.03, EAVE, EAVE + 0.045, 'ty_reach_grey', true, 196);   // condenser
    box(-0.05, 0.08, 0.03, 0.03, EAVE, EAVE + 0.025, DARK, true, 197);              // hatch
    { const [sx, sy] = F(0.05, -0.30); box(0.05, -0.30, 0.008, 0.008, EAVE, EAVE + 0.12, 'ty_reach_iron', true, 198); drawSmoke(ctx, cam, sx, sy, EAVE + 0.12, '96,90,84', alpha * 0.7, now, seed + 3); }
    for (const s of [-1, 1]) {   // cameras on the front corners under the cornice, a red dot each after dark
      box(s * 0.385, YF + 0.02, 0.008, 0.014, F4 + 0.16, F4 + 0.172, 'ty_reach_grey', true, 199 + s);
      if (dn) { const [cx2, cy2] = F(s * 0.385, YF + 0.035); glowPool(ctx, cam, cx2, cy2, F4 + 0.166, '255,40,40', 2.5, alpha * 0.8 * dn); }
    }
    // the power cable from the Dynamo's pole, sagging in over the parapet on the -x side
    { const a = [XW - 0.12, 0.10, EAVE - 0.08], b = [XW + 0.01, 0.10, EAVE + 0.04];
      if (!massDropped()) box(XW - 0.12, 0.10, 0.008, 0.008, 0, EAVE - 0.06, DARK, true, 205);
      let prev = a; for (let k = 1; k <= 5; k++) { const u = k / 5, q = [a[0] + (b[0] - a[0]) * u, a[1], a[2] + (b[2] - a[2]) * u - Math.sin(u * Math.PI) * 0.03]; wire(prev, q, 1.3, 'rgba(20,18,18,0.9)'); prev = q; } }
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
