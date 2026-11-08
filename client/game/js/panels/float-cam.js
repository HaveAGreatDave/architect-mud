// THE LENS: a close-up of the float, because from the thwart a float at twenty metres is two pixels and
// the whole of the take is in what it does. It draws what the rules say (boatfish-rules.js floatPose),
// the pose the 3-D float takes too, so it can't show a take the server doesn't judge. The same lens
// shows the fish on the line, and the fish rolling past the net.
//
// All of it is a pure function of the time and the state handed in. No state lives here but the
// canvas's own size.
import { floatPose } from '../../../shared/boatfish-rules.js';
import { drawFish } from './fish-portrait.js';
import { SPECIES } from '../../../shared/fish.js';

const INK = '#12181c';
const POSE = {};

function fit(cv) {
  const r = cv.clientWidth || 168, dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const n = Math.round(r * dpr);
  if (cv.width !== n) { cv.width = n; cv.height = n; }
  return n;
}

// Water seen from low down: dark at the eye, the sky's colour toward the far edge, with the chop as
// bands that slide. `day` is 0 at night to 1 by day.
function water(g, S, t, day) {
  const a = Math.round(10 + 18 * day), b = Math.round(26 + 46 * day), c = Math.round(36 + 56 * day);
  const gr = g.createLinearGradient(0, 0, 0, S);
  gr.addColorStop(0, `rgb(${a + 60 * day},${b + 60 * day},${c + 60 * day})`);
  gr.addColorStop(0.42, `rgb(${a + 14},${b + 18},${c + 20})`);
  gr.addColorStop(1, `rgb(${a},${Math.round(b * 0.7)},${Math.round(c * 0.8)})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  g.lineWidth = Math.max(1, S / 160);
  for (let i = 0; i < 13; i++) {
    const y = S * (0.1 + 0.9 * (i / 13) ** 1.5), k = 0.5 + i / 13;
    g.strokeStyle = `rgba(${Math.round(190 + 40 * day)},${Math.round(214 + 30 * day)},235,${(0.05 + 0.1 * day) * (1 - i / 16)})`;
    g.beginPath();
    for (let x = -8; x <= S + 8; x += 8) {
      const yy = y + Math.sin(x * 0.03 / k + t * 0.0011 + i * 2.1) * 2.4 * k + Math.sin(x * 0.011 + t * 0.0007 + i) * 2 * k;
      if (x < 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
}

function ring(g, x, y, r, a, S) {
  if (a <= 0) return;
  g.strokeStyle = `rgba(232,244,248,${a})`;
  g.lineWidth = Math.max(1, S / 140);
  g.beginPath(); g.ellipse(x, y, r, r * 0.3, 0, 0, 7); g.stroke();
}

function float(g, S, x, y, p, day) {
  const H = S * 0.3, W = S * 0.075;
  const lit = 0.55 + 0.45 * day;
  // The waterline. What's under it is drawn again, faint, so the float sinks rather than shrinks.
  const wl = y + H * 0.02;
  const paint = () => {
    // The stem, the body and the antenna, from the bottom up. y = 0 is the waterline at rest.
    g.lineWidth = Math.max(1.2, S / 110); g.strokeStyle = INK; g.lineJoin = 'round';
    g.fillStyle = `rgb(${Math.round(226 * lit)},${Math.round(66 * lit)},${Math.round(40 * lit)})`;
    g.beginPath(); g.moveTo(0, H * 0.34);
    g.quadraticCurveTo(W * 1.1, H * 0.1, W * 0.75, -H * 0.16);
    g.lineTo(-W * 0.75, -H * 0.16); g.quadraticCurveTo(-W * 1.1, H * 0.1, 0, H * 0.34); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = `rgb(${Math.round(244 * lit)},${Math.round(240 * lit)},${Math.round(226 * lit)})`;
    g.beginPath(); g.moveTo(W * 0.75, -H * 0.16); g.lineTo(W * 0.3, -H * 0.42); g.lineTo(-W * 0.3, -H * 0.42); g.lineTo(-W * 0.75, -H * 0.16); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = `rgb(${Math.round(255 * lit)},${Math.round(150 * lit)},${Math.round(30 * lit)})`;
    g.fillRect(-W * 0.14, -H * 0.72, W * 0.28, H * 0.3); g.strokeRect(-W * 0.14, -H * 0.72, W * 0.28, H * 0.3);
    // The light on the shoulder.
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(-W * 0.5, -H * 0.1, W * 0.2, H * 0.22);
  };
  const dy = p.dip * H * 1.05 - p.lift * H * 0.42;
  const at = () => { g.translate(x, y); g.rotate(p.tilt); g.translate(0, dy); paint(); };
  g.save(); g.beginPath(); g.rect(0, 0, S, wl); g.clip(); at(); g.restore();
  g.save(); g.beginPath(); g.rect(0, wl, S, S - wl); g.clip(); g.globalAlpha = Math.max(0.1, 0.42 - 0.3 * p.dip); at(); g.restore();
  // Its meniscus, which goes when the float does.
  if (p.dip < 0.92) {
    g.strokeStyle = `rgba(240,250,252,${0.8 * (1 - p.dip)})`; g.lineWidth = Math.max(1, S / 130);
    g.beginPath(); g.ellipse(x, wl, W * 1.1, W * 0.32, 0, 0, 7); g.stroke();
  }
}

/**
 * The float. `o`: { t (ms, the wall clock, for the water), day, script, rel (ms since the bite, or
 * null), twitchAge (ms since the last tap, or null) }.
 */
export function paintFloat(cv, o) {
  const g = cv?.getContext?.('2d');
  if (!g) return;
  const S = fit(cv), t = o.t, day = o.day ?? 1;
  water(g, S, t, day);
  const cx = S * 0.5, cy = S * 0.56;
  const p = o.script && o.rel != null ? floatPose(o.script, o.rel, POSE) : { dip: 0, lift: 0, tilt: 0, shiver: 0, under: false };
  // The swell lifts it; a twitch tugs it.
  const bob = Math.sin(t * 0.0021) * S * 0.012 + Math.sin(t * 0.0034 + 1) * S * 0.006;
  let dx = 0, tug = 0;
  if (o.twitchAge != null && o.twitchAge < 500) { const u = o.twitchAge / 500; tug = Math.sin(u * Math.PI) * 0.32; dx = -S * 0.03 * Math.sin(u * Math.PI); }
  if (p.shiver > 0) dx += Math.sin(t * 0.09) * S * 0.012 * p.shiver;
  const S2 = { dip: Math.max(p.dip, tug), lift: p.lift, tilt: p.tilt + Math.sin(t * 0.0017) * 0.05 + dx / S };
  // Rings from everything that touched it.
  if (o.script && o.rel != null) {
    for (const n of o.script.nibbles) {
      const a = o.rel - n.at;
      if (a > 0 && a < 1100) ring(g, cx, cy, S * (0.06 + 0.3 * (a / 1100)), (1 - a / 1100) * 0.7 * n.size * 1.4, S);
    }
    const a = o.rel - o.script.takeAt;
    if (a > 0 && a < 1500) {
      ring(g, cx, cy, S * (0.08 + 0.42 * (a / 1500)), (1 - a / 1500) * 0.9, S);
      if (a > 180) ring(g, cx, cy, S * (0.06 + 0.3 * ((a - 180) / 1500)), (1 - a / 1500) * 0.6, S);
      // A slow take draws the float away along the surface before it goes.
      if (o.script.kind === 'slide') dx += S * 0.1 * Math.min(1, a / 800);
    }
  }
  if (tug > 0.02) ring(g, cx, cy, S * (0.08 + 0.25 * (o.twitchAge / 500)), (1 - o.twitchAge / 500) * 0.5, S);
  float(g, S, cx + dx, cy + bob, S2, day);
}

/**
 * The fight: the line going into the water, what's under it, and the fish when it leaves the water.
 * `o`: { t, day, species, kg, mode, pull (-1..1), tension, jump (0..1 through a jump, or null) }.
 */
export function paintFight(cv, o) {
  const g = cv?.getContext?.('2d');
  if (!g) return;
  const S = fit(cv), t = o.t, day = o.day ?? 1, T = o.tension ?? 0.4;
  water(g, S, t, day);
  const sp = SPECIES[o.species], shape = sp?.shape || 'round';
  const cy = S * 0.56, ex = S * (0.5 + 0.26 * (o.pull || 0));
  const W = S * (0.44 + Math.min(0.26, Math.cbrt(o.kg || 1) * 0.09));
  const dir = (o.pull || 0) >= 0 ? 1 : -1;
  // Its shape under the water, plainer when it's near the top.
  if (o.jump == null) {
    const a = o.mode === 'spent' ? 0.5 : o.mode === 'charge' ? 0.42 : 0.26;
    drawFish(g, o.species, shape, ex - dir * W * 0.1, cy + S * 0.2 + Math.sin(t * 0.005) * S * 0.015, W, { flip: dir > 0, alpha: a, rot: Math.sin(t * 0.009) * 0.1, ink: 'rgba(8,20,26,0.8)' });
  }
  // Where the line goes in, and what it's doing to the water.
  const n = o.mode === 'run' ? 4 : 2;
  for (let i = 0; i < n; i++) { const u = ((t / 900 + i / n) % 1); ring(g, ex, cy, S * (0.03 + 0.2 * u), (1 - u) * (o.mode === 'run' ? 0.7 : 0.4), S); }
  if (o.mode === 'run') {
    g.strokeStyle = 'rgba(236,246,250,0.65)'; g.lineWidth = Math.max(1, S / 120);
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(ex, cy); g.lineTo(ex - dir * S * 0.34, cy + s * S * 0.07); g.stroke(); }
  }
  // The line, from the rod down out of the top of the lens. Slack, it sags; tight, it's straight and
  // near the limit it sings.
  const sag = Math.max(0, 0.34 - T) * S * 0.9, sing = T > 0.7 ? Math.sin(t * 0.08) * S * 0.012 * (T - 0.7) / 0.3 : 0;
  g.strokeStyle = T > 0.72 ? '#ffd2b0' : T < 0.12 ? 'rgba(255,255,255,0.5)' : 'rgba(250,252,254,0.92)';
  g.lineWidth = Math.max(1.2, S / 100);
  let lx = ex, ly = cy;
  if (o.jump != null) {
    const s = Math.min(1, Math.max(0, o.jump));
    lx = S * 0.5 + (s - 0.5) * S * 0.62 * dir; ly = cy - 4 * s * (1 - s) * S * 0.24;
  }
  g.beginPath(); g.moveTo(S * 0.86, 0); g.quadraticCurveTo((S * 0.86 + lx) / 2 + sing, ly * 0.5 + sag, lx, ly); g.stroke();
  // In the air: its whole length, thrown over, with the water coming off it.
  if (o.jump != null) {
    const s = Math.min(1, Math.max(0, o.jump));
    ring(g, S * 0.5 - S * 0.31 * dir, cy, S * (0.05 + 0.2 * s), 0.7 * (1 - s), S);
    if (s > 0.75) ring(g, S * 0.5 + S * 0.31 * dir, cy, S * 0.2 * (s - 0.75) / 0.25, 0.8, S);
    const rot = (0.5 - s) * 1.9;
    g.save();
    g.translate(lx, ly); g.rotate(dir > 0 ? rot : -rot);
    drawFish(g, o.species, shape, -W * 0.5 * (dir > 0 ? -1 : 1), 0, W, { flip: dir > 0, rot: Math.sin(t * 0.03) * 0.12 });
    g.restore();
    g.fillStyle = 'rgba(240,250,252,0.9)';
    for (let i = 0; i < 12; i++) {
      const a = i * 2.399, r = W * (0.3 + 0.5 * ((i * 37) % 10) / 10) * (0.6 + s * 0.6);
      g.beginPath(); g.arc(lx + Math.cos(a) * r, ly + Math.sin(a) * r * 0.7 + s * S * 0.05, Math.max(1, S / 110), 0, 7); g.fill();
    }
  }
}

/**
 * The fish rolling past the net. `o`: { t, day, swing (-1..1, 0 is over the net), width, species, kg,
 * tries, flash ('hit' | 'miss' | null) }.
 */
export function paintNet(cv, o) {
  const g = cv?.getContext?.('2d');
  if (!g) return;
  const S = fit(cv), t = o.t, day = o.day ?? 1;
  water(g, S, t, day);
  const cy = S * 0.56, cx = S * 0.5;
  const sp = SPECIES[o.species];
  // The hoop, seen from over the gunwale: its window is `width` of the fish's swing.
  const span = S * 0.42, hw = Math.max(S * 0.09, span * o.width * 1.25);
  const fx = cx + o.swing * span;
  const W = S * (0.42 + Math.min(0.3, Math.cbrt(o.kg || 1) * 0.1));
  // The fish, its back out of the water, flank to the eye and turning as it comes about.
  const dir = Math.cos((t * 0.0037)) >= 0 ? 1 : -1;
  drawFish(g, o.species, sp?.shape || 'round', fx - dir * W * 0.5, cy + Math.sin(t * 0.004) * S * 0.01, W, { flip: dir < 0, rot: Math.sin(t * 0.0031) * 0.06 });
  // The water over its lower half.
  const gr = g.createLinearGradient(0, cy, 0, S);
  gr.addColorStop(0, 'rgba(16,46,58,0.5)'); gr.addColorStop(1, 'rgba(10,30,40,0.9)');
  g.fillStyle = gr; g.fillRect(0, cy + S * 0.01, S, S);
  ring(g, fx, cy + S * 0.02, W * 0.56, 0.5, S);
  // The hoop. Green when the fish is in it.
  const on = Math.abs(o.swing) <= o.width;
  g.lineWidth = Math.max(3, S / 44);
  g.strokeStyle = o.flash === 'miss' ? '#ff5a4a' : on ? '#7cf08a' : '#e8e2c8';
  g.beginPath(); g.ellipse(cx, cy, hw, S * 0.15, 0, 0, 7); g.stroke();
  g.lineWidth = 1; g.strokeStyle = on ? 'rgba(124,240,138,0.5)' : 'rgba(232,226,200,0.4)';
  for (let i = -3; i <= 3; i++) {
    g.beginPath(); g.moveTo(cx + (i / 4) * hw, cy - S * 0.13); g.lineTo(cx + (i / 4) * hw, cy + S * 0.13); g.stroke();
    g.beginPath(); g.moveTo(cx - hw, cy + (i / 4) * S * 0.14); g.lineTo(cx + hw, cy + (i / 4) * S * 0.14); g.stroke();
  }
  // The handle, coming in from the boat.
  g.lineWidth = Math.max(4, S / 34); g.strokeStyle = INK;
  g.beginPath(); g.moveTo(cx, cy + S * 0.15); g.lineTo(cx + S * 0.06, S); g.stroke();
  g.lineWidth = Math.max(2, S / 70); g.strokeStyle = '#9aa3a8';
  g.beginPath(); g.moveTo(cx, cy + S * 0.15); g.lineTo(cx + S * 0.06, S); g.stroke();
}
