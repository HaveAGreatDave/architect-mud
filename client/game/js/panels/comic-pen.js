// The comic look's pen: ink painted into a texture on a canvas, as a comic artist inks a page
// (docs/proposals/comic-ink.md, "Ink in the textures"). The baseball kits (diamond/kits.js) and the
// hockey sweaters (gl/arena.js) are inked with these, so a seam or a fold is the same stroke on both.
//
// `g` is a 2-D context and `r` a seeded random (0..1), so a kit inks the same way every time it's
// painted. No DOM of its own: it draws only on what it's handed.

// The ink, and the painted shadow's and the dirt's colours without their alpha ('rgba(r,g,b,').
export const INK = '#14110e';
export const PAINTED = 'rgba(70,40,90,';
export const DIRT = 'rgba(110,70,35,';

// A hand-ruled line: tapered at the ends, a little wobble, never quite straight.
export function inkLine(g, r, x0, y0, x1, y1, w, wob = 1.2) {
  const n = Math.max(4, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 10));
  g.strokeStyle = INK; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tw = Math.sin(Math.PI * (t0 + t1) / 2);
    g.lineWidth = Math.max(0.5, w * (0.35 + 0.65 * tw) * (0.85 + 0.3 * r()));
    g.beginPath();
    g.moveTo(x0 + (x1 - x0) * t0 + (r() - 0.5) * wob, y0 + (y1 - y0) * t0 + (r() - 0.5) * wob);
    g.lineTo(x0 + (x1 - x0) * t1 + (r() - 0.5) * wob, y0 + (y1 - y0) * t1 + (r() - 0.5) * wob);
    g.stroke();
  }
}
// A fold: a short curved stroke, thick in the middle.
export function fold(g, r, x, y, len, ang, w) {
  const bend = (r() - 0.5) * 0.9;
  let px = x, py = y;
  g.strokeStyle = INK; g.lineCap = 'round';
  for (let i = 1; i <= 6; i++) {
    const t = i / 6, a = ang + bend * (t - 0.5);
    const nx = x + Math.cos(a) * len * t, ny = y + Math.sin(a) * len * t;
    g.lineWidth = Math.max(0.5, w * Math.sin(Math.PI * (t - 1 / 12)));
    g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
    px = nx; py = ny;
  }
}
// A soft painted patch, `rx` by `ry`, its colour given without its alpha ('rgba(r,g,b,').
export function patch(g, x, y, rx, ry, colour) {
  const R = Math.max(rx, ry), grd = g.createRadialGradient(0, 0, 1, 0, 0, R);
  grd.addColorStop(0, colour + '0.32)'); grd.addColorStop(1, colour + '0)');
  g.save(); g.translate(x, y); g.scale(rx / R, ry / R);
  g.fillStyle = grd; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
  g.restore();
}
// Lettering inked: an outline drawn outside whatever stroke the kit gives it.
export function inkText(g, text, x, y, w) { g.save(); g.lineJoin = 'round'; g.lineWidth = w; g.strokeStyle = INK; g.strokeText(text, x, y); g.restore(); }
