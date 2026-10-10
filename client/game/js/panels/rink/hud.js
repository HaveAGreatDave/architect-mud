// Rinkside · what both renderers share besides the camera: the kits that aren't a club's,
// the options a body is built from, and the HUD (the fight pips and the big banner) drawn
// over the picture in 2-D. render.js draws the HUD onto its own canvas; gl/arena.js onto a
// 2-D canvas laid over the WebGL one.

import { TAU, clamp } from './util.js';

const FACE = '"Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
export const OFFICIAL_KIT = { jersey: '#f1f1ee', trim: '#141414', pants: '#141414', sock: '#141414', glove: '#e2b896', helmet: '#141414', stripes: true };
export const MEDIC_KIT = { jersey: '#eeeeea', trim: '#b8141c', pants: '#2a2e36', sock: '#2a2e36', glove: '#d8d8d8', helmet: '#eeeeea' };

export const kitOf = (W, b) => (b.kind === 'official' ? OFFICIAL_KIT : b.kind === 'medic' ? MEDIC_KIT : (W.kits[b.side] || W.kits.a));

// The options figure.js (and arena-mesh.js) build a body from.
export function bodyOpts(W, b) {
  return { kit: kitOf(W, b), goalie: b.kind === 'goalie', num: b.num, name: b.name, skin: b.skin, hair: b.hair,
    gloves: b.gloves !== false, helmet: b.helmet !== false, jerseyUp: b.jerseyUp || 0, react: b.react || 0, blood: b.blood || 0,
    face: b.faceGear, missing: b.missing || {} };
}

// True while the HUD has anything to draw, so a renderer with its own overlay can leave it
// cleared the rest of the time.
export function hudActive(W) {
  const B = W.banner;
  return !!((W.fight && W.fight.hud) || (B && W.t - B.t0 < (B.dur || 1.3)));
}

export function drawHud(ctx, W, w, h, u) {
  const F = W.fight;
  if (F && F.hud) {
    const pw = Math.min(w * 0.4, 330 * u), ph = 34 * u, pad = 12 * u;
    for (const [b, left] of [[F.l, true], [F.r, false]]) {
      if (!b) continue;
      const K = W.kits[b.side] || W.kits.a, x = left ? pad : w - pad - pw;
      ctx.fillStyle = 'rgba(6,9,12,0.78)'; ctx.fillRect(x, pad, pw, ph);
      ctx.fillStyle = K.jersey; ctx.fillRect(left ? x : x + pw - 6 * u, pad, 6 * u, ph);
      ctx.fillStyle = '#f4efe2'; ctx.font = `800 ${16 * u}px ${FACE}`; ctx.textBaseline = 'middle'; ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(`${String(b.name || '').toUpperCase()}  #${b.num}`, left ? x + 14 * u : x + pw - 14 * u, pad + ph * 0.5, pw * 0.6);
      const shown = F.pipShow[b.seed] ?? 5;
      for (let i = 0; i < 5; i++) {
        const cx = left ? x + pw - 16 * u - i * 15 * u : x + 16 * u + i * 15 * u, cy = pad + ph * 0.5;
        const full = clamp(shown - (4 - i), 0, 1);
        ctx.fillStyle = '#2a2f36'; ctx.beginPath(); ctx.arc(cx, cy, 5.5 * u, 0, TAU); ctx.fill();
        if (full > 0) { ctx.fillStyle = full > 0.5 ? '#f0bd4c' : '#a8402e'; ctx.beginPath(); ctx.arc(cx, cy, 5.5 * u * Math.max(0.35, full), 0, TAU); ctx.fill(); }
      }
    }
  }
  const B = W.banner;
  if (B) {
    const age = W.t - B.t0;
    if (age < (B.dur || 1.3)) {
      const k = age < 0.12 ? age / 0.12 : 1, a = age > (B.dur || 1.3) - 0.3 ? ((B.dur || 1.3) - age) / 0.3 : 1;
      ctx.save(); ctx.globalAlpha = a; ctx.translate(w / 2, h * 0.42); ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k); ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.font = `800 ${Math.min(96, w / 7)}px ${FACE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 9 * u; ctx.strokeStyle = '#120c04'; ctx.strokeText(B.text, 0, 0);
      ctx.fillStyle = B.col || '#f0bd4c'; ctx.fillText(B.text, 0, 0);
      if (B.sub) { ctx.font = `700 ${Math.min(30, w / 24)}px ${FACE}`; ctx.lineWidth = 5 * u; ctx.strokeText(B.sub, 0, Math.min(60, w / 11)); ctx.fillStyle = '#f4efe2'; ctx.fillText(B.sub, 0, Math.min(60, w / 11)); }
      ctx.restore();
    }
  }
}
