// Rinkside · what both renderers share besides the camera: the kits that aren't a club's,
// the options a body is built from, and the HUD (the fight pips and the big banner) drawn
// over the picture in 2-D. render.js draws the HUD onto its own canvas; gl/arena.js onto a
// 2-D canvas laid over the WebGL one.

import { paintCrest } from '../club-crest.js';
import { TAU, clamp } from './util.js';

const FACE = '"Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
export const OFFICIAL_KIT = { jersey: '#f1f1ee', trim: '#141414', pants: '#141414', sock: '#141414', glove: '#e2b896', helmet: '#141414', stripes: true };
// the ice crew, who take the nets off for the Zamboni: the arena's navy, no helmet
export const CREW_KIT = { jersey: '#1f2f4f', trim: '#9fc4ff', pants: '#22262c', sock: '#22262c', glove: '#3a3f46', helmet: '#1f2f4f' };
export const MEDIC_KIT = { jersey: '#eeeeea', trim: '#b8141c', pants: '#2a2e36', sock: '#2a2e36', glove: '#d8d8d8', helmet: '#eeeeea' };

// A keeper's mask colours, for both renderers. ⚠ THE CLUB'S, NOT THE KIT'S: a mask is the same
// home and away, and several kits wear the helmet and the trim in one colour. A club whose mask
// is authored (`club.mask`) says its own; otherwise the shell in the club's first colour, the
// art in its second (or black or white, if the two are too close to tell apart), edged in its
// third (or whichever of black and white shows on the art). A kit with no club uses its sweater
// and trim.
const rgbOf = (h) => { const n = parseInt(String(h || '#808080').slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lumOf = (h) => { const [r, g, b] = rgbOf(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const apart = (a, b) => { const p = rgbOf(a), q = rgbOf(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
export function maskColours(K) {
  const club = K && K.club, m = club && club.mask;
  if (m && m.base && m.trim && m.edge) return { base: m.base, trim: m.trim, edge: m.edge };
  const cols = club && Array.isArray(club.colours) && club.colours.length ? club.colours : [K.jersey, K.trim];
  const base = cols[0] || '#eef0f2';
  let trim = cols[1] || K.trim || '#f1efe8';
  if (apart(base, trim) < 110) trim = lumOf(base) > 0.5 ? '#141414' : '#f1efe8';
  const edge = cols[2] && apart(cols[2], trim) > 80 && apart(cols[2], base) > 80 ? cols[2] : lumOf(trim) > 0.5 ? '#141414' : '#f1efe8';
  return { base, trim, edge };
}

export const kitOf = (W, b) => (b.kind === 'official' ? OFFICIAL_KIT : b.crew ? CREW_KIT : b.kind === 'medic' ? MEDIC_KIT : (W.kits[b.side] || W.kits.a));

// The options figure.js (and arena-mesh.js) build a body from.
export function bodyOpts(W, b) {
  return { kit: kitOf(W, b), goalie: b.kind === 'goalie', kind: b.kind, seed: b.seed, num: b.num, name: b.name, skin: b.skin, hair: b.hair,
    gloves: b.gloves !== false, helmet: b.helmet !== false, jerseyUp: b.jerseyUp || 0, react: b.react || 0, blood: b.blood || 0,
    face: b.faceGear, missing: b.missing || {} };
}

// ── between steps ───────────────────────────────────────────────────────────
// The world steps at 120 Hz and the screen draws at its own rate, so each frame is drawn
// between the world's last two steps (`W.alpha`, see sim.js). A man is moved back along
// his last step; the puck has its own drawn position, which also never jumps. A replay's
// stand-in world has neither and is drawn as it is.
const shiftOf = (W, b) => {
  const a = W.alpha;
  if (a == null || a >= 1 || b.x0 == null) return null;
  const dx = (b.x0 - b.x) * (1 - a), dy = (b.y0 - b.y) * (1 - a);
  // (a man who has just come on, or a step that was a jump, is drawn where he is)
  return (dx || dy) && Math.abs(dx) + Math.abs(dy) < 4 ? [dx, dy] : null;
};
export function drawnJoints(W, b) {
  const J = W.rigOf(b), d = shiftOf(W, b);
  if (!d) return J;
  const mv = (p) => (p ? [p[0] + d[0], p[1] + d[1], p[2]] : p);
  const out = J.map(mv);
  if (J.meta) out.meta = { ...J.meta, bend: mv(J.meta.bend), bottle: mv(J.meta.bottle) };
  return out;
}
export function drawnAt(W, b) {
  const p = b.rag ? b.rag.pts[0] : b, d = shiftOf(W, b);
  return d ? [p.x + d[0], p.y + d[1]] : [p.x, p.y];
}
export const drawnPuck = (W) => (W.puckAt ? W.puckAt() : [W.puck.x, W.puck.y, W.puck.z]);

// ── the glowing puck ───────────────────────────────────────────────────────
// A viewer's option (the button on the picture): a blue halo round the puck so it can't be
// lost against the boards and the crowd, and behind a fast one a comet tail, blue, going
// red over 100 ft/s (a slapshot or a one-timer). Both renderers draw it from this.
export const GLOW = { halo: [0.42, 0.72, 1], fast: [1, 0.24, 0.16], slow: [0.38, 0.66, 1], tailFrom: 40, red: 100 };
// The comet tail: the drawn puck's last quarter second, while it's moving fast. Points
// [x, y, z] oldest first, ending at the puck, and how fast it's going.
export function glowTail(W) {
  const tr = W.puck.trail;
  if (!tr || tr.length < 2 || W.puck.hidden) return null;
  let i = tr.length - 1;
  while (i > 0 && tr[i - 1][3] > GLOW.tailFrom) i--;
  const pts = tr.slice(i).map((q) => [q[0], q[1], q[2]]);
  const sp = tr[tr.length - 1][3];
  if (pts.length < 2 || sp < GLOW.tailFrom) return null;
  pts.push(drawnPuck(W));
  const k = Math.min(1, Math.max(0, (sp - GLOW.tailFrom) / (GLOW.red - GLOW.tailFrom)));
  return { pts, sp, col: GLOW.slow.map((c, j) => c + (GLOW.fast[j] - c) * (sp >= GLOW.red ? 1 : k * 0.35)) };
}

// True while the HUD has anything to draw, so a renderer with its own overlay can leave it
// cleared the rest of the time. `live` is the world being played, whose wipe it draws even
// while a replay is on the screen.
export function hudActive(W, live = W) {
  const B = W.banner, Wp = live.wipe;
  return !!(W.replayOn || lapsing(W) || (W.fight && W.fight.hud) || (B && W.t - B.t0 < (B.dur || 1.3)) || (Wp && live.t - Wp.t0 < Wp.dur));
}

// THE TIME-LAPSE BUG, while the Zamboni is out: the sheet is being shown sped up, and says so.
const lapsing = (W) => !!(W.zamboni && !W.zamboni.leaving && W.zamboni.lapse > 1.5);
function drawLapse(ctx, W, w, h, u) {
  const bw = 150 * u, bh = 26 * u, bx = w - bw - 16 * u, by = 14 * u;
  ctx.save(); ctx.transform(1, 0, -0.18, 1, by * 0.18, 0);
  ctx.fillStyle = 'rgba(8,10,14,0.82)'; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#c8141c'; ctx.fillRect(bx, by, 6 * u, bh);
  // two arrows, fast-forward
  ctx.fillStyle = '#f4efe2';
  for (const ox of [0, 9]) { ctx.beginPath(); ctx.moveTo(bx + (14 + ox) * u, by + bh * 0.28); ctx.lineTo(bx + (22 + ox) * u, by + bh * 0.5); ctx.lineTo(bx + (14 + ox) * u, by + bh * 0.72); ctx.closePath(); ctx.fill(); }
  ctx.font = `800 ${16 * u}px ${FACE}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('TIME-LAPSE', bx + 38 * u, by + bh * 0.54, bw - 44 * u);
  ctx.restore();
}

// THE WIPE: the league's band swept across the picture, in and out of a replay, with REPLAY
// on it (it said the league's name, which read as anything but a replay). It covers
// the whole frame at its midpoint, which is when the director switches the picture.
function drawWipe(ctx, live, w, h, u) {
  const Wp = live.wipe; if (!Wp) return;
  const k = (live.t - Wp.t0) / Wp.dur;
  if (k <= 0 || k >= 1) return;
  const slant = h * 0.35, span = w + 2 * slant, lead = -slant + k * 2 * span, tail = lead - span;
  ctx.save();
  const band = (x0, x1, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x0 + slant, 0); ctx.lineTo(x1 + slant, 0); ctx.lineTo(x1, h); ctx.lineTo(x0, h); ctx.closePath(); ctx.fill(); };
  band(tail - 18 * u, lead + 18 * u, '#f4efe2');
  band(tail, lead, '#c8141c');
  band(tail + span * 0.42, tail + span * 0.58, '#141414');
  const cx = tail + span / 2 + slant / 2;
  ctx.font = `800 ${Math.min(120, h * 0.28)}px ${FACE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.transform(1, 0, -0.18, 1, h * 0.5 * 0.18, 0);
  ctx.fillStyle = '#f4efe2'; ctx.fillText('REPLAY', cx, h * 0.5, span * 0.5);
  ctx.restore();
}

export function drawHud(ctx, W, w, h, u, live = W) {
  if (lapsing(W)) drawLapse(ctx, W, w, h, u);
  if (W.replayOn) {
    // the replay: letterboxed, with the bug in the corner and its light blinking
    const bar = h * 0.07;
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
    const bx = 14 * u, by = bar + 12 * u, bw = 132 * u, bh = 30 * u;
    ctx.save(); ctx.transform(1, 0, -0.18, 1, by * 0.18, 0);
    ctx.fillStyle = '#c8141c'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#f4efe2'; ctx.fillRect(bx + bw, by, 6 * u, bh);
    ctx.font = `800 ${19 * u}px ${FACE}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText('REPLAY', bx + 30 * u, by + bh * 0.53);
    if (Math.sin((W.t || 0) * 9) > -0.2) { ctx.beginPath(); ctx.arc(bx + 16 * u, by + bh / 2, 5 * u, 0, TAU); ctx.fill(); }
    // what it's a replay of, when it isn't the goal just scored (a hit the picture missed)
    if (W.label) {
      ctx.font = `800 ${14 * u}px ${FACE}`;
      const lw = Math.max(bw + 6 * u, ctx.measureText(W.label).width + 24 * u), ly = by + bh + 4 * u, lh = 22 * u;
      ctx.fillStyle = 'rgba(8,10,14,0.88)'; ctx.fillRect(bx, ly, lw, lh);
      ctx.fillStyle = '#f4efe2'; ctx.fillText(W.label, bx + 12 * u, ly + lh * 0.54);
    }
    ctx.restore();
  }
  const F = W.fight;
  if (F && F.hud) {
    const pw = Math.min(w * 0.4, 330 * u), ph = 34 * u, pad = 12 * u;
    for (const [b, left] of [[F.l, true], [F.r, false]]) {
      if (!b) continue;
      const K = W.kits[b.side] || W.kits.a, x = left ? pad : w - pad - pw;
      ctx.fillStyle = 'rgba(6,9,12,0.78)'; ctx.fillRect(x, pad, pw, ph);
      ctx.fillStyle = K.jersey; ctx.fillRect(left ? x : x + pw - 6 * u, pad, 6 * u, ph);
      // his club's crest beside the colour strip, when the club has one
      const cw = K.badge && paintCrest(ctx, K.club, left ? x + 14 * u + ph * 0.4 : x + pw - 14 * u - ph * 0.4, pad + ph * 0.5, ph * 0.8, { small: true }) ? ph * 0.9 : 0;
      ctx.fillStyle = '#f4efe2'; ctx.font = `800 ${16 * u}px ${FACE}`; ctx.textBaseline = 'middle'; ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(`${String(b.name || '').toUpperCase()}  #${b.num}`, left ? x + 14 * u + cw : x + pw - 14 * u - cw, pad + ph * 0.5, pw * 0.6 - cw);
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
  drawWipe(ctx, live, w, h, u);
}
