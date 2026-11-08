// A FISH, DRAWN ON A 2-D CANVAS: for the catch card and the net close-up. Inked outline, two flat tones
// and a pale belly, the comic look the figures have (docs/proposals/comic-ink.md). The shapes and the
// colours are client/shared/fish-look.js, which the fish on the line in 3-D reads too.
import { lookOf, profileOf, curveAt } from '../../../shared/fish-look.js';
import { SPECIES, fishLength } from '../../../shared/fish.js';

const INK = '#14181c';
const css = (c, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
const N = 28;

// A cheap hash for the marks, so one species always wears the same pattern.
const hash = (i) => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); };

function bodyPath(g, Q, W) {
  g.beginPath();
  for (let i = 0; i <= N; i++) { const u = i / N; g.lineTo(u * W, -curveAt(Q.top, u) * W); }
  for (let i = N; i >= 0; i--) { const u = i / N; g.lineTo(u * W, curveAt(Q.bot, u) * W); }
  g.closePath();
}

function finPath(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }

function marks(g, L, Q, W) {
  const m = L.mark;
  g.save();
  if (m === 'scales') {
    g.strokeStyle = css(L.back, 0.72); g.lineWidth = Math.max(0.5, W * 0.003);
    for (let r = -2; r <= 2; r++) for (let c = 2; c < 15; c++) {
      const x = (c + (r & 1) * 0.5) / 16 * W, y = r * W * 0.045;
      g.beginPath(); g.arc(x, y, W * 0.026, -1.1, 1.1); g.stroke();
    }
  } else if (m === 'bars') {
    g.fillStyle = css(L.back, 0.85);
    for (let i = 0; i < 6; i++) { const u = 0.2 + i * 0.12; g.fillRect(u * W, -W * 0.3, W * 0.035, W * 0.34); }
  } else if (m === 'spots') {
    g.fillStyle = css(L.back, 0.8);
    for (let i = 0; i < 30; i++) {
      const u = 0.14 + hash(i) * 0.8, v = -curveAt(Q.top, u) * (0.1 + hash(i + 40) * 0.8);
      g.beginPath(); g.ellipse(u * W, v * W, W * (0.01 + hash(i + 9) * 0.008), W * 0.008, 0, 0, 7); g.fill();
    }
  } else if (m === 'tiger') {
    g.strokeStyle = css(L.back, 0.9); g.lineWidth = W * 0.012;
    for (let i = 0; i < 12; i++) {
      const x0 = (0.2 + i * 0.06) * W;
      g.beginPath(); g.moveTo(x0, -W * 0.2);
      g.quadraticCurveTo(x0 + W * 0.03, -W * 0.09, x0 - W * 0.01, -W * 0.005); g.stroke();
    }
  } else if (m === 'scutes') {
    g.fillStyle = css(L.belly, 0.9); g.strokeStyle = INK; g.lineWidth = Math.max(0.5, W * 0.003);
    for (let i = 0; i < 12; i++) {
      const u = 0.22 + i * 0.062, y = -curveAt(Q.top, u) * 0.42 * W;
      g.beginPath(); g.moveTo(u * W - W * 0.018, y); g.lineTo(u * W, y - W * 0.012); g.lineTo(u * W + W * 0.018, y); g.lineTo(u * W, y + W * 0.012); g.closePath(); g.fill(); g.stroke();
    }
  } else if (m === 'blotch') {
    g.fillStyle = css(L.back, 0.9);
    for (let i = 0; i < 9; i++) {
      const u = 0.18 + hash(i + 3) * 0.72, v = (hash(i + 5) - 0.65) * 0.26;
      g.beginPath(); g.ellipse(u * W, v * W, W * (0.04 + hash(i) * 0.03), W * 0.028, hash(i + 2) * 3, 0, 7); g.fill();
    }
  } else if (m === 'lamp') {
    g.fillStyle = '#f4f0b8';
    for (let i = 0; i < 11; i++) { g.beginPath(); g.arc((0.2 + i * 0.065) * W, W * 0.018, W * 0.008, 0, 7); g.fill(); }
  } else if (m === 'gill') {
    g.fillStyle = css(L.fin);
    g.beginPath(); g.ellipse(0.2 * W, 0, W * 0.016, W * 0.06, 0.1, 0, 7); g.fill();
  }
  g.restore();
}

/**
 * Draws a fish with its nose at (x, y) along +x of the current transform, `W` px long, in side view.
 * `o`: { rot, flip (true: facing left), alpha, ink }.
 */
export function drawFish(g, id, shape, x, y, W, o = {}) {
  if (!g) return;
  const L = lookOf(id), Q = profileOf(shape);
  g.save();
  g.translate(x, y);
  if (o.flip) g.scale(-1, 1);
  if (o.rot) g.rotate(o.rot);
  if (o.alpha != null) g.globalAlpha = o.alpha;
  const lw = Math.max(1, W * 0.012);
  g.lineJoin = 'round'; g.strokeStyle = o.ink || INK; g.lineWidth = lw;
  if (shape === 'skate') {
    // From above: a kite with a whip of a tail.
    g.fillStyle = css(L.back);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.42, -W * 0.46); g.lineTo(W * 0.7, -W * 0.08); g.lineTo(W, 0); g.lineTo(W * 0.7, W * 0.08); g.lineTo(W * 0.42, W * 0.46); g.closePath(); g.fill(); g.stroke();
    g.save(); g.clip(); marks(g, { ...L, mark: 'spots' }, profileOf('deep'), W); g.restore();
    g.fillStyle = INK;
    for (const s of [-1, 1]) { g.beginPath(); g.arc(W * 0.13, s * W * 0.05, W * 0.012, 0, 7); g.fill(); }
    g.restore();
    return;
  }
  // The tail, then the fins, then the body over their roots.
  const th = Q.tail[0] * W, fork = Q.tail[1] * W, r = W;
  g.fillStyle = css(L.fin);
  finPath(g, [[r - W * 0.04, -curveAt(Q.top, 1) * W], [r + W * 0.15, -th], [r + W * 0.15 - fork, 0], [r + W * 0.15, th], [r - W * 0.04, curveAt(Q.bot, 1) * W]]);
  g.fill(); g.stroke();
  const [d0, d1, dh] = Q.dorsal;
  if (dh > 0) {
    const y0 = -curveAt(Q.top, d0) * W, y1 = -curveAt(Q.top, d1) * W;
    finPath(g, [[d0 * W, y0], [(d0 + (d1 - d0) * 0.18) * W, y0 - dh * W], [d1 * W, y1 - dh * W * 0.25], [d1 * W, y1]]);
    g.fill(); g.stroke();
  }
  const [a0, a1, ah] = Q.anal;
  if (ah > 0) {
    const y0 = curveAt(Q.bot, a0) * W, y1 = curveAt(Q.bot, a1) * W;
    finPath(g, [[a0 * W, y0], [(a0 + (a1 - a0) * 0.4) * W, y0 + ah * W], [a1 * W, y1]]);
    g.fill(); g.stroke();
  }
  if (Q.pelvic) {
    const yb = curveAt(Q.bot, Q.pelvic) * W;
    finPath(g, [[Q.pelvic * W, yb * 0.9], [(Q.pelvic + 0.09) * W, yb + W * 0.05], [(Q.pelvic + 0.08) * W, yb * 0.9]]);
    g.fill(); g.stroke();
  }
  // The body in three flat tones, clipped to its outline.
  bodyPath(g, Q, W);
  g.fillStyle = css(L.flank);
  g.fill();
  g.save();
  bodyPath(g, Q, W); g.clip();
  g.fillStyle = css(L.back);
  g.beginPath(); g.moveTo(0, -W); g.lineTo(W * 1.1, -W);
  for (let i = N; i >= 0; i--) { const u = i / N; g.lineTo(u * W, -curveAt(Q.top, u) * W * 0.34 + Math.sin(u * 9) * W * 0.006); }
  g.closePath(); g.fill();
  g.fillStyle = css(L.belly);
  g.beginPath(); g.moveTo(0, W); g.lineTo(W * 1.1, W);
  for (let i = N; i >= 0; i--) { const u = i / N; g.lineTo(u * W, curveAt(Q.bot, u) * W * 0.3); }
  g.closePath(); g.fill();
  marks(g, L, Q, W);
  // The light along the shoulder, one hard shape, as a comic would.
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.beginPath(); g.ellipse(W * 0.42, -curveAt(Q.top, 0.42) * W * 0.62, W * 0.26, W * 0.018, 0, 0, 7); g.fill();
  g.restore();
  bodyPath(g, Q, W);
  g.stroke();
  // The gill, the eye, the mouth.
  const gh = curveAt(Q.top, 0.2) * W;
  g.lineWidth = lw * 0.8;
  g.beginPath(); g.arc(W * 0.1, 0, gh * 0.9, -0.85, 0.85); g.stroke();
  const ey = -curveAt(Q.top, 0.09) * W * 0.42, er = Math.max(1.4, W * 0.02);
  g.fillStyle = '#ece6c8'; g.beginPath(); g.arc(W * 0.075, ey, er, 0, 7); g.fill(); g.stroke();
  g.fillStyle = INK; g.beginPath(); g.arc(W * 0.078, ey, er * 0.55, 0, 7); g.fill();
  g.beginPath(); g.moveTo(0, curveAt(Q.bot, 0.02) * W * 0.3); g.lineTo(W * 0.05, curveAt(Q.bot, 0.05) * W * 0.5); g.stroke();
  g.restore();
}

/**
 * The catch card's picture: the fish laid on a measuring board, cut with centimetres, so a big one
 * looks big. `canvas` is the card's own; it's drawn once when the card opens.
 */
export function paintCatch(canvas, id, kg) {
  const g = canvas?.getContext?.('2d');
  if (!g) return;
  const W = canvas.width, H = canvas.height, sp = SPECIES[id];
  const lenM = sp ? fishLength(sp, kg) : 0.4, shape = sp?.shape || 'round';
  // The board's length: the next half metre past the fish.
  const boardM = Math.max(0.5, Math.ceil(lenM * 1.15 / 0.25) * 0.25);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#c9b48a'; g.fillRect(0, 0, W, H);
  // Grain.
  g.strokeStyle = 'rgba(92,66,36,0.22)'; g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const y = (i + 0.5) / 12 * H;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= W; x += 24) g.lineTo(x, y + Math.sin(x * 0.03 + i * 1.7) * 2.2);
    g.stroke();
  }
  // The rule along the bottom edge.
  const px = (m) => 10 + (m / boardM) * (W - 20), ry = H - 16;
  g.fillStyle = '#e6dcc0'; g.fillRect(0, ry - 2, W, 18);
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1;
  g.font = 'bold 9px "Courier New", monospace'; g.textAlign = 'center';
  const stepCm = boardM > 1 ? 10 : 5;
  for (let c = 0; c <= boardM * 100; c += stepCm) {
    const x = px(c / 100), big = c % (stepCm * 2) === 0;
    g.beginPath(); g.moveTo(x, ry - 2); g.lineTo(x, ry + (big ? 6 : 3)); g.stroke();
    if (big && c) g.fillText(String(c), x, ry + 14);
  }
  // The fish, nose on the stop. The outline's length is 0.86 of it; the tail is the rest.
  const Wp = (px(lenM) - px(0)) / 1.15;
  const y = (H - 18) / 2 + 1;
  g.fillStyle = 'rgba(40,28,14,0.28)';
  g.beginPath(); g.ellipse(px(0) + Wp * 0.55, y + Wp * 0.14 + 4, Wp * 0.55, Math.max(4, Wp * 0.07), 0, 0, 7); g.fill();
  drawFish(g, id, shape, px(0), y, Wp);
}
