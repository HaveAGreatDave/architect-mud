// Rinkside · the renderer. Draws a world (sim.js) through a perspective broadcast camera.
//
// THE CAMERA NEVER YAWS OR ROLLS, it only pans, climbs, tilts and zooms. That one
// constraint is what makes the ice cheap: every screen row is a single line of constant
// depth across the sheet, so the whole painted ice texture maps onto the screen with one
// drawImage per row (GLASS's Mode-7 floor, the same trick). The crowd rows and the far
// boards are planes of constant depth too and map the same way.
//
// Draw order: the bowl, the boards and glass behind the ice, the ice, the reflection of
// everything in it, the shadows of the light banks, then bodies, nets, the puck and the
// loose things back to front, then the near boards in front of all of it, then the overlays.
//
// THE REFLECTION is the whole scene again through a mirrored camera (z flipped), drawn into
// a half-size canvas and scaled back up, which is what softens it the way ice softens it.
// How strong it is depends on the sheet: fresh ice is a mirror, a period of skating dulls
// it (`ice.wear`), and the Zamboni's wet strip shines until it freezes off.

import { TAU, V, clamp, lerp, rng } from './util.js';
import { RL, RW, RC, BOARD_H, GLASS_H, GOAL_X, MID_Y, NET_HALF, NET_DEPTH, NET_H, SEGS, PANELS, PANEL_X0, PANEL_W } from './geo.js';
import { TPX, WPX, BPX, CPX, CX0, CX1, CROWS, ROWH, sharedTextures } from './textures.js';
import { drawBody, drawSevered } from './figure.js';
import { createRinkCamera } from './camera.js';
import { bodyOpts, drawHud } from './hud.js';

const FACE = '"Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';

function quad(ctx, a, b, c, d) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); }
function line(ctx, a, b, w, col) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + 0.01, b.y); ctx.stroke(); }

export function createRenderer(canvas, W, ice) {
  const main = canvas.getContext('2d');
  let ctx = main;                       // swapped to the reflection canvas for that pass
  const doc = canvas.ownerDocument;
  let rc = null, rctx = null;
  const tex = sharedTextures(doc);
  const camera = createRinkCamera(W);
  const cam = camera.cam;
  let flash = 0, pat = null;
  const st = {};

  function fit() {
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
    const dpr = Math.min(api.quality.dpr, (doc.defaultView && doc.defaultView.devicePixelRatio) || 1);
    const w = Math.max(2, Math.round((r.width || canvas.width || 640) * dpr)), h = Math.max(2, Math.round((r.height || canvas.height || 360) * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, u: w / 900 };
  }

  function render(now) {
    const { w, h, u } = fit();
    camera.view = api.view;
    const { C, P, camPos } = camera.update(w, h);
    if (camera.flash) { flash = camera.flash; camera.flash = 0; }
    P0 = P;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#05070a'); bg.addColorStop(1, '#0d1218');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    // whatever the bowl doesn't cover (past the end boards on a tight shot) is more crowd,
    // in the dark, rather than a void
    if (!pat) try { pat = ctx.createPattern(tex.crowdSit, 'repeat'); } catch { pat = null; }
    if (pat) { ctx.globalAlpha = 0.4; ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(5,7,10,0.55)'; ctx.fillRect(0, 0, w, h); }
    // shake is a smooth wobble, not a fresh random offset every frame: random jitter at the
    // display rate reads as the frame rate dropping
    const sh = W.shake * 5 * u, sx = sh * (Math.sin(W.t * 47) + 0.5 * Math.sin(W.t * 83 + 1)) / 1.5, sy = sh * (Math.sin(W.t * 59 + 2) + 0.5 * Math.sin(W.t * 97)) / 1.5;
    ctx.setTransform(1, 0, 0, 1, sx, sy);

    stands(P);
    const inner = (sg) => sg.nx * (C.x - (sg.x0 + sg.x1) / 2) + sg.ny * (C.y - (sg.y0 + sg.y1) / 2) > 0;
    boards(P, inner, 'back');
    drawIce(C, w, h, P);

    // the sheet reflects
    const camR = [C.x, C.y, -C.z];
    const PR = (X, Y, Z) => P(X, Y, -Z);
    reflect(PR, camR, w, h, sx, sy);
    ctx.save(); clipSheet(P);
    // the light banks overhead each cast a soft shadow
    for (const b of W.bodies()) { const p = b.rag ? b.rag.pts[0] : b; shadow(P, p.x, p.y, b.rag ? 2.6 : b.kind === 'goalie' ? 1.7 : 1.3); }
    shadow(P, W.puck.x, W.puck.y, 0.35);
    if (W.zamboni) shadow(P, W.zamboni.x, W.zamboni.y, 6.5);
    ctx.restore();

    const items = [];
    const push = (x, y, z, f, bias = 0) => { const p = P(x, y, z); if (p) items.push({ d: p.d + bias, f }); };
    for (const b of W.bodies()) push(b.x, b.y, 3, () => drawBody(ctx, P, W.rigOf(b), opts(b, camPos, 'full')));
    for (const [gx, dir, side] of [[GOAL_X[0], -1, 'a'], [GOAL_X[1], 1, 'h']]) push(gx + dir * NET_DEPTH / 2, MID_Y, 2, () => net(P, gx, dir, side));
    if (!W.puck.hidden) push(W.puck.x, W.puck.y, 0, () => puck(P), -0.3);
    for (const d of W.debris) push(d.x, d.y, 0, () => debris(P, d));
    for (const l of W.limbs) push(l.pts[0].x, l.pts[0].y, 0, () => drawSevered(ctx, P, l, opts(l.owner || { side: l.side }, camPos, 'full')));
    if (W.stretcher) push(W.stretcher.x, W.stretcher.y, 1, () => stretcher(P, W.stretcher), 0.1);
    if (W.zamboni) push(W.zamboni.x, W.zamboni.y, 3, () => zamboni(P, W.zamboni, camPos));
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.f();
    particles(P);
    boards(P, inner, 'front');

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (W.lamp > 0 && W.lampSide) {
      // the goal lamp: red light washing over the building, pulsing
      const k = (Math.sin(W.t * 18) > 0 ? 0.1 : 0.035) * Math.min(1, W.lamp);
      ctx.fillStyle = `rgba(255,30,40,${k})`; ctx.fillRect(0, 0, w, h);
    }
    const vg = ctx.createRadialGradient(w / 2, h * 0.5, h * 0.35, w / 2, h * 0.5, w * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.42 + 0.3 * W.mourning})`); ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    if (W.mourning > 0.01) {
      // a death drains the colour out of the building
      ctx.save(); ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = `rgba(128,128,128,${0.75 * W.mourning})`; ctx.fillRect(0, 0, w, h); ctx.restore();
      ctx.fillStyle = `rgba(0,0,0,${0.22 * W.mourning})`; ctx.fillRect(0, 0, w, h);
    }
    drawHud(ctx, W, w, h, u);
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`; ctx.fillRect(0, 0, w, h); flash = Math.max(0, flash - 0.12); }
  }

  const opts = (b, camPos, style) => ({ ...bodyOpts(W, b), camPos, style });

  // How much of the scene the ice gives back right now.
  const reflStrength = () => clamp(0.3 - 0.2 * ice.wear + 0.14 * ice.wetness, 0.08, 0.42) * (1 - 0.35 * W.mourning);

  function reflect(PR, camR, w, h, sx, sy) {
    const k = 0.5, rw = Math.max(2, Math.round(w * k)), rh = Math.max(2, Math.round(h * k));
    if (!rc) { rc = doc.createElement('canvas'); rctx = rc.getContext('2d'); }
    if (rc.width !== rw || rc.height !== rh) { rc.width = rw; rc.height = rh; }
    rctx.setTransform(1, 0, 0, 1, 0, 0); rctx.clearRect(0, 0, rw, rh);
    rctx.setTransform(k, 0, 0, k, sx * k, sy * k);
    ctx = rctx;
    // the far dasherboard hangs upside down in the ice, its ads fading out below it
    const a = PR(RC, RW, 0), b = PR(RL - RC, RW, BOARD_H);
    if (a && b && b.y > a.y) {
      ctx.save(); ctx.translate(0, a.y + b.y); ctx.scale(1, -1);
      ctx.drawImage(tex.boards, a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      const g = ctx.createLinearGradient(0, a.y, 0, b.y); g.addColorStop(0, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = g; ctx.fillRect(a.x - 2, a.y - 1, b.x - a.x + 4, b.y - a.y + 2);
      ctx.restore();
    }
    const items = [];
    const push = (x, y, z, f) => { const p = PR(x, y, z); if (p) items.push({ d: p.d, f }); };
    if (api.quality.reflBodies) for (const bd of W.bodies()) push(bd.x, bd.y, 3, () => drawBody(ctx, PR, W.rigOf(bd), opts(bd, camR, 'refl')));
    for (const [gx, dir, side] of [[GOAL_X[0], -1, 'a'], [GOAL_X[1], 1, 'h']]) push(gx + dir * NET_DEPTH / 2, MID_Y, 2, () => net(PR, gx, dir, side));
    if (W.zamboni) push(W.zamboni.x, W.zamboni.y, 3, () => zamboni(PR, W.zamboni, camR));
    items.sort((p, q) => q.d - p.d);
    for (const it of items) it.f();
    ctx = main;
    ctx.save(); clipSheet(P0);
    ctx.globalAlpha = reflStrength();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(rc, 0, 0, w, h);
    ctx.restore();
  }
  let P0 = null;

  function stands(P) {
    const crowd = W.crowd > 0.45 ? tex.crowdUp : tex.crowdSit;
    for (let i = CROWS - 1; i >= 0; i--) {
      const y = 89 + i * 3, z0 = 4.2 + i * 2.2;
      const bob = W.crowd > 0.45 ? W.crowd * 0.35 * Math.max(0, Math.sin(W.t * 13 + i * 1.7)) : 0;
      const a = P(CX0, y, z0 + bob), b = P(CX1, y, z0 + 2.2 + bob);
      if (!a || !b) continue;
      ctx.drawImage(crowd, 0, i * ROWH, crowd.width, ROWH, a.x, b.y, b.x - a.x, a.y - b.y + 1);
    }
    if (W.crowd > 0.5 && W.mourning < 0.2) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < 6; i++) { if (W.rand() > W.crowd * 0.5) continue; const p = P(CX0 + W.rand() * (CX1 - CX0), 89 + W.rand() * 40, 6 + W.rand() * 30); if (p) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + W.rand() * 2, 0, TAU); ctx.fill(); } }
    }
    if (!pat) try { pat = ctx.createPattern(tex.crowdSit, 'repeat'); } catch { pat = null; }
    for (const [x0, x1] of [[0, -45], [RL, RL + 45]]) {
      const a = P(x0, -10, BOARD_H), b = P(x0, 95, BOARD_H), c = P(x1, 95, 40), d = P(x1, -10, 40);
      if (!a || !b || !c || !d) continue;
      ctx.save(); quad(ctx, a, b, c, d); ctx.clip();
      const mx = Math.min(a.x, b.x, c.x, d.x), my = Math.min(a.y, b.y, c.y, d.y);
      if (pat) { ctx.fillStyle = pat; ctx.globalAlpha = 0.55; ctx.fillRect(mx, my, 4000, 4000); ctx.globalAlpha = 1; }
      ctx.fillStyle = 'rgba(5,7,10,0.45)'; ctx.fillRect(mx, my, 4000, 4000);
      ctx.restore();
    }
  }

  function boards(P, inner, layer) {
    const list = [];
    for (const sg of SEGS) {
      if ((layer === 'back') !== inner(sg)) continue;
      const m = P((sg.x0 + sg.x1) / 2, (sg.y0 + sg.y1) / 2, 2); if (!m) continue;
      list.push([m.d, sg]);
    }
    list.sort((a, b) => b[0] - a[0]);
    const by = W.boardShake * 0.25 * Math.sin(W.t * 60);
    for (const [, sg] of list) {
      if (sg.kind === 'far' && layer === 'back') {
        const a = P(RC, RW + by, BOARD_H), b = P(RL - RC, RW + by, 0);
        if (a && b) ctx.drawImage(tex.boards, a.x, a.y, b.x - a.x, b.y - a.y);
        farGlass(P);
        continue;
      }
      const p00 = P(sg.x0, sg.y0, 0), p10 = P(sg.x1, sg.y1, 0), p11 = P(sg.x1, sg.y1, BOARD_H), p01 = P(sg.x0, sg.y0, BOARD_H);
      const g01 = P(sg.x0, sg.y0, GLASS_H), g11 = P(sg.x1, sg.y1, GLASS_H);
      if (!p00 || !p10 || !p11 || !p01 || !g01 || !g11) continue;
      if (layer === 'back') {
        const lit = 0.82 + 0.18 * Math.abs(sg.nx);
        ctx.fillStyle = `rgb(${(232 * lit) | 0},${(236 * lit) | 0},${(240 * lit) | 0})`; quad(ctx, p00, p10, p11, p01); ctx.fill();
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.stroke();
        const k0 = P(sg.x0, sg.y0, 0.55), k1 = P(sg.x1, sg.y1, 0.55);
        if (k0 && k1) { ctx.fillStyle = '#d9b032'; quad(ctx, p00, p10, k1, k0); ctx.fill(); }
        ctx.fillStyle = 'rgba(190,222,242,0.09)'; quad(ctx, p01, p11, g11, g01); ctx.fill();
        line(ctx, p01, g01, 1, 'rgba(255,255,255,0.22)');
        line(ctx, p01, p11, Math.max(1, 0.3 * p01.s), '#c3c9cf');
      } else {
        ctx.fillStyle = 'rgba(190,222,242,0.07)'; quad(ctx, p01, p11, g11, g01); ctx.fill();
        ctx.fillStyle = 'rgba(24,30,38,0.92)'; quad(ctx, p00, p10, p11, p01); ctx.fill();
        line(ctx, p01, p11, Math.max(1.5, 0.35 * p01.s), '#9aa3ac');
        line(ctx, g01, g11, Math.max(1, 0.15 * g01.s), 'rgba(220,235,245,0.4)');
      }
    }
  }
  function farGlass(P) {
    for (let i = 0; i < PANELS; i++) {
      const x0 = PANEL_X0 + i * PANEL_W, x1 = x0 + PANEL_W, f = W.flex[i], y = RW + f * 0.9;
      const a = P(x0, y, BOARD_H), b = P(x1, y, BOARD_H), c = P(x1, y, GLASS_H), d = P(x0, y, GLASS_H);
      if (!a || !b || !c || !d) continue;
      if (W.broken.has(i)) {
        // a shattered pane: an empty frame with teeth of glass left in it
        const r = rng(i * 131 + 7); ctx.fillStyle = 'rgba(200,232,250,0.35)';
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        for (let k = 0; k <= 6; k++) { const t = k / 6; ctx.lineTo(lerp(a.x, b.x, t), lerp(a.y, b.y, t) - (0.3 + r() * 1.2) * a.s); }
        ctx.lineTo(b.x, b.y); ctx.closePath(); ctx.fill();
        line(ctx, a, d, Math.max(1, 0.12 * a.s), 'rgba(20,26,32,0.7)');
        continue;
      }
      ctx.fillStyle = `rgba(190,222,242,${0.09 + f * 0.25})`; quad(ctx, a, b, c, d); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = Math.max(1, 0.25 * a.s);
      ctx.beginPath(); ctx.moveTo(lerp(a.x, b.x, 0.2), a.y); ctx.lineTo(lerp(d.x, c.x, 0.45), d.y); ctx.stroke();
      line(ctx, a, d, Math.max(1, 0.12 * a.s), 'rgba(20,26,32,0.6)');
    }
    const t0 = P(PANEL_X0, RW, GLASS_H), t1 = P(RL - PANEL_X0, RW, GLASS_H);
    if (t0 && t1) line(ctx, t0, t1, Math.max(1, 0.12 * t0.s), 'rgba(220,235,245,0.5)');
    for (const g of W.glassBlood) {
      const c = P(g.x, RW - 0.05, g.z); if (!c) continue;
      const r = rng(g.seed); ctx.fillStyle = 'rgba(130,8,14,0.8)';
      ctx.beginPath(); ctx.ellipse(c.x, c.y, g.r * c.s, g.r * c.s * 0.8, 0, 0, TAU); ctx.fill();
      for (let k = 0; k < 3; k++) { const dx = (r() - 0.5) * g.r * 2, len = 0.6 + r() * 1.6; line(ctx, { x: c.x + dx * c.s, y: c.y }, { x: c.x + dx * c.s, y: c.y + len * c.s }, Math.max(0.8, 0.12 * c.s), 'rgba(130,8,14,0.75)'); }
    }
    for (const k of W.cracks) {
      const c = P(k.x, RW + 0.02, k.z); if (!c) continue;
      const r = rng(k.seed); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = Math.max(0.6, 0.05 * c.s);
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const an = r() * TAU, l = (0.8 + r() * 2.2) * c.s; let x = c.x, y = c.y;
        ctx.moveTo(x, y);
        for (let j = 0; j < 3; j++) { x += Math.cos(an + (r() - 0.5) * 0.6) * l / 3; y += Math.sin(an + (r() - 0.5) * 0.6) * l / 3; ctx.lineTo(x, y); }
      }
      ctx.stroke(); ctx.beginPath(); ctx.arc(c.x, c.y, 0.35 * c.s, 0, TAU); ctx.stroke();
    }
  }

  // Mode-7: one drawImage per screen row, each row a line of constant depth across the sheet
  function drawIce(C, w, h, P) {
    const top = P(RL / 2, RW, 0), bot = P(RL / 2, 0, 0);
    const y0 = Math.max(0, Math.floor(top ? top.y : 0)), y1 = Math.min(h, bot ? Math.ceil(bot.y) : h);
    const cp = Math.cos(C.pitch), sp = Math.sin(C.pitch), step = api.quality.iceStep;
    ice.flush?.();
    const img = ice.canvas;
    for (let sy = y0; sy < y1; sy += step) {
      const v = (C.cy - (sy + step / 2)) / C.f;
      const dz = -sp + v * cp; if (dz >= -1e-4) continue;
      const t = -C.z / dz, Y = C.y + t * (cp + v * sp);
      if (Y < 0 || Y > RW) continue;
      const sx0 = C.cx + C.f * (0 - C.x) / t, sx1 = C.cx + C.f * (RL - C.x) / t;
      ctx.drawImage(img, 0, Math.min(img.height - 1, (RW - Y) * TPX), img.width, 1, sx0, sy, sx1 - sx0, step + 0.7);
    }
    // the Zamboni's wet strip: water over the ice reads darker and bluer until it freezes
    if (ice.wetness > 0.01) {
      const wi = ice.wet, kk = WPX / TPX;
      ctx.save(); ctx.globalAlpha = 0.22 * Math.min(1, ice.wetness * 1.5);
      for (let sy = y0; sy < y1; sy += step) {
        const v = (C.cy - (sy + step / 2)) / C.f;
        const dz = -sp + v * cp; if (dz >= -1e-4) continue;
        const t = -C.z / dz, Y = C.y + t * (cp + v * sp);
        if (Y < 0 || Y > RW) continue;
        const sx0 = C.cx + C.f * (0 - C.x) / t, sx1 = C.cx + C.f * (RL - C.x) / t;
        ctx.drawImage(wi, 0, Math.min(wi.height - 1, (RW - Y) * TPX * kk), wi.width, 1, sx0, sy, sx1 - sx0, step + 0.7);
      }
      ctx.restore();
    }
    // the light banks shine in the sheet: brightest on fresh or wet ice, dull by the end
    // of a period
    const gloss = (0.07 + 0.09 * (1 - ice.wear) + 0.08 * ice.wetness) * (1 - W.mourning * 0.7);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const lx of [40, 70, 100, 130, 160]) {
      const c = P(lx, 50, 0), e = P(lx + 13, 50, 0), f = P(lx, 62, 0); if (!c || !e || !f) continue;
      const rx = Math.abs(e.x - c.x), ry = Math.max(4, Math.abs(f.y - c.y));
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rx);
      g.addColorStop(0, `rgba(255,255,255,${gloss})`); g.addColorStop(0.4, `rgba(235,245,255,${gloss * 0.45})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function clipSheet(P) {
    ctx.beginPath(); let first = true;
    for (const sg of SEGS) { const p = P(sg.x0, sg.y0, 0); if (!p) continue; if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y); }
    ctx.closePath(); ctx.clip();
  }
  function shadow(P, x, y, r) {
    for (const [ox, oy, a] of [[0, 0, 0.22], [1.3, 0.9, 0.07], [-1.3, 0.9, 0.07]]) {
      const c = P(x + ox, y + oy, 0), e = P(x + ox + r, y + oy, 0), f = P(x + ox, y + oy + r * 0.7, 0);
      if (!c || !e || !f) continue;
      ctx.fillStyle = `rgba(14,24,38,${a})`; ctx.beginPath(); ctx.ellipse(c.x, c.y, Math.abs(e.x - c.x), Math.max(0.5, Math.abs(f.y - c.y)), 0, 0, TAU); ctx.fill();
    }
  }

  function net(P, gx, dir, side) {
    const bul = (W.netBulge[side] || 0) * 0.7;
    const pts = (zz, k, bk) => [[gx, MID_Y - NET_HALF], [gx + dir * 1.6 * k, MID_Y - NET_HALF - 0.6], [gx + dir * (NET_DEPTH + bk) * k, MID_Y - NET_HALF + 1.4], [gx + dir * (NET_DEPTH + bk) * k, MID_Y + NET_HALF - 1.4], [gx + dir * 1.6 * k, MID_Y + NET_HALF + 0.6], [gx, MID_Y + NET_HALF]].map(([x, y]) => P(x, y, zz));
    const base = pts(0, 1, bul), top = pts(NET_H, 0.45, bul * 0.5);
    if (base.some((p) => !p) || top.some((p) => !p)) return;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(base[i].x, base[i].y); ctx.lineTo(base[i + 1].x, base[i + 1].y); ctx.lineTo(top[i + 1].x, top[i + 1].y); ctx.lineTo(top[i].x, top[i].y); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = 'rgba(240,244,248,0.55)'; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let i = 0; i < 6; i++) { ctx.moveTo(base[i].x, base[i].y); ctx.lineTo(top[i].x, top[i].y); }
    for (let k = 0.2; k < 1; k += 0.2) for (let i = 0; i < 6; i++) { const x = lerp(base[i].x, top[i].x, k), y = lerp(base[i].y, top[i].y, k); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(250,250,250,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); base.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    const pl = [P(gx, MID_Y - NET_HALF, 0), P(gx, MID_Y - NET_HALF, NET_H), P(gx, MID_Y + NET_HALF, NET_H), P(gx, MID_Y + NET_HALF, 0)];
    if (pl.some((p) => !p)) return;
    ctx.strokeStyle = '#d42e28'; ctx.lineWidth = Math.max(1.6, 0.2 * pl[1].s); ctx.beginPath(); pl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    if (W.lamp > 0 && W.lampSide === side) {
      // the lamp behind the net
      const l = P(gx + dir * (NET_DEPTH + 6), MID_Y, GLASS_H + 1);
      if (l) { const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 3 * l.s); g.addColorStop(0, 'rgba(255,60,50,0.95)'); g.addColorStop(1, 'rgba(255,40,40,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(l.x, l.y, 3 * l.s, 0, TAU); ctx.fill(); }
    }
  }
  function puck(P) {
    const pk = W.puck;
    const c = P(pk.x, pk.y, pk.z + 0.08); if (!c) return;
    const e = P(pk.x + 0.42, pk.y, pk.z + 0.08), f = P(pk.x, pk.y + 0.42, pk.z + 0.08);
    if (!e || !f) return;
    const rx = Math.max(1.6, Math.abs(e.x - c.x)), ry = Math.max(0.9, Math.abs(f.y - c.y));
    const spd = Math.hypot(pk.vx, pk.vy);
    if (spd > 30 && !pk.carrier && !pk.held) {
      const b = P(pk.x - pk.vx * 0.05, pk.y - pk.vy * 0.05, pk.z + 0.08);
      if (b) { const g = ctx.createLinearGradient(b.x, b.y, c.x, c.y); g.addColorStop(0, 'rgba(20,24,30,0)'); g.addColorStop(1, 'rgba(20,24,30,0.45)'); line(ctx, b, c, rx * 1.6, g); }
    }
    const th = Math.max(1, rx * 0.5);
    ctx.fillStyle = '#0b0c0f'; ctx.beginPath(); ctx.ellipse(c.x, c.y + th * 0.5, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.fillRect(c.x - rx, c.y, rx * 2, th * 0.5);
    ctx.fillStyle = '#2c2f36'; ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, TAU); ctx.fill();
    if (rx > 2.5) { const a = pk.rot || 0; line(ctx, { x: c.x + Math.cos(a) * rx * 0.6, y: c.y + Math.sin(a) * ry * 0.6 }, { x: c.x - Math.cos(a) * rx * 0.6, y: c.y - Math.sin(a) * ry * 0.6 }, Math.max(1, rx * 0.18), 'rgba(200,210,220,0.5)'); }
  }
  function debris(P, d) {
    const K = W.kits[d.side] || W.kits.a, c = P(d.x, d.y, d.z); if (!c) return;
    if (d.kind === 'stick') {
      const dx = Math.cos(d.rot) * 2.3, dy = Math.sin(d.rot) * 2.3;
      const a = P(d.x - dx, d.y - dy, d.z), b = P(d.x + dx, d.y + dy, d.z), t = P(d.x + dx + Math.cos(d.rot + 1.5) * 0.9, d.y + dy + Math.sin(d.rot + 1.5) * 0.9, d.z);
      if (!a || !b || !t) return;
      line(ctx, a, b, Math.max(1.2, 0.12 * c.s), '#24262c'); line(ctx, b, t, Math.max(1.4, 0.24 * c.s), '#1c1d22');
    } else if (d.kind === 'glove') {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(d.rot % TAU * 0.3);
      const gw = 0.75 * c.s, gh = 0.5 * c.s;
      ctx.fillStyle = 'rgba(8,10,14,0.6)'; ctx.fillRect(-gw / 2 - 1, -gh / 2 - 1, gw + 2, gh + 2);
      ctx.fillStyle = K.glove; ctx.fillRect(-gw / 2, -gh / 2, gw, gh);
      ctx.fillStyle = K.trim; ctx.fillRect(-gw / 2, gh * 0.05, gw * 0.35, gh * 0.25);
      ctx.restore();
    } else if (d.kind === 'helmet') {
      const r = 0.44 * c.s;
      ctx.fillStyle = K.helmet; ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * 0.8, d.rot * 0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(210,214,220,0.9)'; ctx.lineWidth = Math.max(0.7, r * 0.1); ctx.beginPath(); ctx.arc(c.x + r * 0.3, c.y, r * 0.55, -1.2, 1.2); ctx.stroke();
    }
  }
  // Particles in one pass after the bodies, a path per kind and colour, so a burst of a few
  // hundred is a handful of draw calls. They are small and quick; one drawn over a body it is
  // behind for a frame or two is not something anyone sees.
  function particles(P) {
    if (!W.parts.length) return;
    const streak = new Map(), dots = new Map();
    const add = (m, k) => { let a = m.get(k); if (!a) { a = []; m.set(k, a); } return a; };
    for (const p of W.parts) {
      const c = P(p.x, p.y, p.z); if (!c) continue;
      if (p.type === 'blood') {
        const b = P(p.x - p.vx * 0.025, p.y - p.vy * 0.025, p.z - p.vz * 0.025);
        if (b) add(streak, p.col).push(b.x, b.y, c.x, c.y, Math.max(0.8, p.size * 0.7 * c.s));
        continue;
      }
      const col = p.type === 'spray' ? 'rgba(245,250,255,0.7)' : p.type === 'tooth' ? '#f4f1e6' : p.type === 'sweat' ? 'rgba(220,235,255,0.7)' : 'rgba(200,232,250,0.85)';
      add(dots, col).push(c.x, c.y, Math.max(0.8, p.size * c.s));
    }
    ctx.lineCap = 'round';
    for (const [col, v] of streak) {
      // two widths are enough: thin drops and fat ones
      for (const fat of [false, true]) {
        ctx.beginPath(); let any = false, w = 0;
        for (let i = 0; i < v.length; i += 5) if ((v[i + 4] > 2) === fat) { ctx.moveTo(v[i], v[i + 1]); ctx.lineTo(v[i + 2] + 0.01, v[i + 3]); any = true; w = Math.max(w, v[i + 4]); }
        if (any) { ctx.strokeStyle = col; ctx.lineWidth = fat ? Math.min(w, 6) : 1.4; ctx.stroke(); }
      }
    }
    for (const [col, v] of dots) {
      ctx.fillStyle = col; ctx.beginPath();
      for (let i = 0; i < v.length; i += 3) { ctx.moveTo(v[i] + v[i + 2], v[i + 1]); ctx.arc(v[i], v[i + 1], v[i + 2], 0, TAU); }
      ctx.fill();
    }
  }
  function stretcher(P, s) {
    const ch = Math.cos(s.h), sn = Math.sin(s.h);
    const pt = (u, v, z) => P(s.x + u * ch - v * sn, s.y + u * sn + v * ch, z);
    const c = [pt(-3.2, -0.9, 1.6), pt(3.2, -0.9, 1.6), pt(3.2, 0.9, 1.6), pt(-3.2, 0.9, 1.6)];
    if (c.some((p) => !p)) return;
    ctx.fillStyle = '#e9e5d8'; quad(ctx, c[0], c[1], c[2], c[3]); ctx.fill();
    ctx.strokeStyle = '#7a7466'; ctx.lineWidth = Math.max(1, 0.1 * c[0].s); ctx.stroke();
    if (s.body) { const pr = s.body.rag ? s.body.rag.pts : null; void pr; }
  }
  // The ice resurfacer: chassis, snow tank, open cab with its driver, the conditioner
  // dragging behind, four wheels and an amber beacon. Boxes are culled by facing and drawn
  // back to front, so it reads as a solid machine from any camera. `bands` are stripes
  // painted round a box's sides; `label` is lettering on the tank's flanks.
  const ZB = [
    { b: [-6.1, -4.6, -3.7, 3.7, 0.12, 1.2], col: '#7d848c', bands: [[0.12, 0.35, '#2a2e34']] },          // conditioner
    { b: [-4.7, 4.7, -3.45, 3.45, 0.55, 2.7], col: '#eceff2', bands: [[1.45, 1.95, '#1f4fbf'], [0.55, 0.8, '#3a3f46']] }, // chassis
    { b: [0.2, 4.75, -3.35, 3.35, 2.7, 5.9], col: '#f4f6f8', bands: [[5.55, 5.9, '#1f4fbf'], [2.7, 2.95, '#c9ced3']], label: 'ICE CREW' }, // snow tank
    { b: [-4.05, -1.6, 0.2, 2.8, 2.7, 3.2], col: '#30343b' },                                              // seat base
    { b: [-4.25, -3.85, 0.4, 2.6, 3.2, 4.9], col: '#30343b' },                                             // seat back
    { b: [-3.6, -2.7, 0.95, 2.05, 3.2, 5.2], col: '#2c3a4e' },                                             // driver
    { b: [-1.0, -0.65, 1.25, 1.55, 2.7, 4.4], col: '#22262c' },                                            // steering column
    { b: [4.1, 4.45, -0.25, 0.25, 5.9, 6.25], col: '#f0a020' },                                            // beacon
  ];
  function zamboni(P, z, camPos) {
    const ch = Math.cos(z.h), sn = Math.sin(z.h);
    const W3 = (u, v, zz) => [z.x + u * ch - v * sn, z.y + u * sn + v * ch, zz];
    const pt = (u, v, zz) => P(...W3(u, v, zz));
    const boxes = ZB.map((o) => { const b = o.b, c = W3((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2); return { o, d: Math.hypot(c[0] - camPos[0], c[1] - camPos[1], c[2] - camPos[2]) }; });
    boxes.sort((p, q) => q.d - p.d);
    const L = V.norm([0.3, -0.5, 0.8]);
    for (const { o } of boxes) {
      const [u0, u1, v0, v1, z0, z1] = o.b, col = o.col;
      const side = (n, a0, a1) => n[0] ? [[n[0] > 0 ? u1 : u0, v0, a0], [n[0] > 0 ? u1 : u0, v1, a0], [n[0] > 0 ? u1 : u0, v1, a1], [n[0] > 0 ? u1 : u0, v0, a1]]
        : [[u0, n[1] > 0 ? v1 : v0, a0], [u1, n[1] > 0 ? v1 : v0, a0], [u1, n[1] > 0 ? v1 : v0, a1], [u0, n[1] > 0 ? v1 : v0, a1]];
      const faces = [[[0, 0, 1], [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]]], ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]].map((n) => [n, side(n, z0, z1)])];
      for (const [n, q] of faces) {
        const nw = [n[0] * ch - n[1] * sn, n[0] * sn + n[1] * ch, n[2]];
        const fc = W3((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2);
        if (V.dot(nw, V.sub(camPos, fc)) <= 0) continue;
        const pp = q.map((p) => pt(...p)); if (pp.some((p) => !p)) continue;
        const lit = 0.6 + 0.4 * Math.max(0, V.dot(nw, L));
        ctx.fillStyle = shadeHex(col, lit); quad(ctx, pp[0], pp[1], pp[2], pp[3]); ctx.fill();
        if (n[2] === 0) {
          for (const [a0, a1, bc] of o.bands || []) {
            const bq = side(n, a0, a1).map((p) => pt(...p)); if (bq.some((p) => !p)) continue;
            ctx.fillStyle = shadeHex(bc, lit); quad(ctx, bq[0], bq[1], bq[2], bq[3]); ctx.fill();
          }
          if (o.label && n[1] !== 0) {
            // lettering laid on the flank: an affine map from the face's corners is near
            // enough at this size
            const a = pt(n[1] > 0 ? u1 - 0.3 : u0 + 0.3, n[1] > 0 ? v1 : v0, 4.6), b = pt(n[1] > 0 ? u0 + 0.3 : u1 - 0.3, n[1] > 0 ? v1 : v0, 4.6), c = pt(n[1] > 0 ? u1 - 0.3 : u0 + 0.3, n[1] > 0 ? v1 : v0, 3.6);
            if (a && b && c && a.s > 3) {
              ctx.save(); ctx.transform(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y, a.x, a.y);
              ctx.fillStyle = '#1f4fbf'; ctx.font = '800 0.9px ' + FACE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.save(); ctx.scale(1, 1.1); ctx.fillText(o.label, 0.5, 0.42, 0.95); ctx.restore();
              ctx.restore();
            }
          }
        }
        ctx.strokeStyle = 'rgba(20,24,30,0.3)'; ctx.lineWidth = Math.max(0.5, 0.035 * pp[0].s); quad(ctx, pp[0], pp[1], pp[2], pp[3]); ctx.stroke();
      }
    }
    // the driver's head and cap, his hands on the wheel, and the wheels on the side we see
    const hd = pt(-3.15, 1.5, 5.75);
    if (hd) {
      ctx.fillStyle = '#d9a27e'; ctx.beginPath(); ctx.arc(hd.x, hd.y, 0.42 * hd.s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1f4fbf'; ctx.beginPath(); ctx.arc(hd.x, hd.y - 0.1 * hd.s, 0.45 * hd.s, Math.PI, TAU); ctx.fill();
      ctx.fillRect(hd.x - 0.05 * hd.s, hd.y - 0.14 * hd.s, 0.62 * hd.s * Math.sign(Math.cos(z.h) || 1), 0.1 * hd.s);
    }
    const sh = pt(-2.7, 1.5, 4.9), wh = pt(-0.85, 1.4, 4.45);
    if (sh && wh) line(ctx, sh, wh, Math.max(1, 0.28 * sh.s), '#2c3a4e');
    for (const sv of [-1, 1]) {
      const nw = [-sn * sv, ch * sv, 0], c0 = W3(0, sv * 3.5, 0.9);
      if (V.dot(nw, V.sub(camPos, c0)) <= 0) continue;
      for (const wu of [-3.0, 2.8]) {
        ctx.fillStyle = '#16181c'; ctx.beginPath();
        for (let k = 0; k <= 14; k++) { const a = k / 14 * TAU, p = pt(wu + Math.cos(a) * 0.95, sv * 3.5, 0.95 + Math.sin(a) * 0.95); if (p) (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); }
        ctx.fill();
        const hub = pt(wu, sv * 3.55, 0.95); if (hub) { ctx.fillStyle = '#9aa2aa'; ctx.beginPath(); ctx.arc(hub.x, hub.y, 0.32 * hub.s, 0, TAU); ctx.fill(); }
      }
    }
    // the beacon turns
    const bc = pt(4.27, 0, 6.3);
    if (bc && Math.sin(W.t * 7) > 0) {
      const g = ctx.createRadialGradient(bc.x, bc.y, 0, bc.x, bc.y, 2.4 * bc.s); g.addColorStop(0, 'rgba(255,190,60,0.85)'); g.addColorStop(1, 'rgba(255,170,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bc.x, bc.y, 2.4 * bc.s, 0, TAU); ctx.fill();
    }
  }
  function shadeHex(hex, k) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
  }

  const api = { render, stats: st, cam, view: 'broadcast', quality: { reflBodies: true, dpr: 1.5, iceStep: 2 } };
  return api;
}
