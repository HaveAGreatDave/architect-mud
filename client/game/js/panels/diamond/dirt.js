/**
 * DEADBALL — the infield canvas.
 *
 * The skin of the infield as one painted canvas, the way Rinkside paints its ice: the dirt
 * arc, the base paths, the cut-outs round home, the bags and the mound, the on-deck circles,
 * then the chalk (foul lines, the batter's and catcher's boxes, the coach's boxes, the
 * running lane) and the scuffs a game leaves. gl/ballpark.js lays it over the grass the
 * shader paints, premultiplied, so where it's clear the grass shows.
 *
 * It covers DIRT_RECT, 256 ft square from 128 ft either side of the plate and 40 ft behind
 * it, at `px` texels (2048 by default, 8 a foot). Vector operations only, no pixel loop, so
 * it paints in a few milliseconds; the grain comes from the shader's noise.
 */

import { BAGS, MOUND } from './geo.js';

export const DIRT_RECT = Object.freeze({ x0: -128, z0: -40, size: 256 });
const TAU = Math.PI * 2, DEG = Math.PI / 180;

// A small seeded stream, so every TV paints the same scuffs.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function paintInfield(doc, { px = 2048, seed = 77 } = {}) {
  const c = doc.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  const S = px / DIRT_RECT.size;
  const X = (x) => (x - DIRT_RECT.x0) * S, Z = (z) => (z - DIRT_RECT.z0) * S;
  const circle = (x, z, r) => { g.moveTo(X(x) + r * S, Z(z)); g.arc(X(x), Z(z), r * S, 0, TAU); };
  const B1 = [BAGS[1][0], BAGS[1][2]], B2 = [BAGS[2][0], BAGS[2][2]], B3 = [BAGS[3][0], BAGS[3][2]];
  const DIRT = '#9a6a45';

  // the infield arc: 95 ft from the rubber, out to the lines and a little past
  g.fillStyle = DIRT;
  g.beginPath();
  g.moveTo(X(0), Z(0));
  for (let i = 0; i <= 64; i++) {
    const a = (-48 + 96 * i / 64) * DEG, dx = Math.sin(a), dz = Math.cos(a);
    const bq = 2 * (dz * -60.5), cq = 60.5 * 60.5 - 95 * 95, t = (-bq + Math.sqrt(bq * bq - 4 * cq)) / 2;
    g.lineTo(X(dx * t), Z(dz * t));
  }
  g.closePath(); g.fill();
  g.beginPath(); circle(0, 0.7, 13); g.fill();
  const lane = (a, b, w) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
    g.beginPath(); g.moveTo(X(a[0] + nx), Z(a[1] + nz)); g.lineTo(X(b[0] + nx), Z(b[1] + nz)); g.lineTo(X(b[0] - nx), Z(b[1] - nz)); g.lineTo(X(a[0] - nx), Z(a[1] - nz)); g.fill();
  };
  lane([0, 0], B1, 3.2); lane([0, 0], B3, 3.2);
  // the infield grass, cut back out of the dirt
  g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
  const ins = 4.24;
  g.beginPath(); g.moveTo(X(0), Z(ins + 1)); g.lineTo(X(B1[0] + ins), Z(B1[1])); g.lineTo(X(0), Z(B2[1] - ins)); g.lineTo(X(B3[0] - ins), Z(B3[1])); g.closePath(); g.fill();
  g.restore();
  // and the cut-outs put back: round home, round each bag, the mound
  g.fillStyle = DIRT;
  g.beginPath(); circle(0, 0.7, 13); g.fill();
  for (const b of [B1, B2, B3]) { g.beginPath(); circle(b[0], b[1], 9.5); g.fill(); }
  g.beginPath(); circle(MOUND[0], MOUND[1], 9); g.fill();
  // the on-deck circles sit in foul ground on the grass
  g.fillStyle = '#966846';
  g.beginPath(); circle(31, -9, 2.6); g.fill();
  g.beginPath(); circle(-31, -9, 2.6); g.fill();

  // what's painted from here on lands only on dirt
  g.globalCompositeOperation = 'source-atop';
  // damp round the plate and the mound, where the crew waters it
  const damp = (x, z, r, a) => {
    const rg = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * S);
    rg.addColorStop(0, `rgba(40,24,12,${a})`); rg.addColorStop(1, 'rgba(40,24,12,0)');
    g.fillStyle = rg; g.fillRect(X(x - r), Z(z - r), 2 * r * S, 2 * r * S);
  };
  damp(0, 0.5, 11, 0.22); damp(MOUND[0], MOUND[1], 8, 0.16);
  // the rake: faint rings round the rubber
  g.lineWidth = 1.1 * S;
  for (let r = 3, k = 0; r < 100; r += 1.5, k++) {
    g.strokeStyle = k % 2 ? 'rgba(255,230,200,0.035)' : 'rgba(30,18,8,0.045)';
    g.beginPath(); g.arc(X(0), Z(60.5), r * S, 0, TAU); g.stroke();
  }
  // pebbles and clods
  const r = rng(seed);
  for (let i = 0; i < 26000; i++) {
    const x = DIRT_RECT.x0 + r() * DIRT_RECT.size, z = DIRT_RECT.z0 + r() * DIRT_RECT.size, k = r();
    g.fillStyle = k < 0.6 ? 'rgba(60,36,18,0.35)' : 'rgba(210,170,130,0.3)';
    const s = (0.06 + r() * 0.1) * S;
    g.fillRect(X(x), Z(z), s, s);
  }

  // chalk, on everything
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(245,244,236,0.95)'; g.lineCap = 'butt'; g.lineWidth = 0.28 * S;
  const line = (a, b) => { g.beginPath(); g.moveTo(X(a[0]), Z(a[1])); g.lineTo(X(b[0]), Z(b[1])); g.stroke(); };
  line([1.2, 1.2], [140, 140]); line([-1.2, 1.2], [-140, 140]);
  // the batter's boxes (4 by 6 ft, six inches off the plate) and the catcher's box
  g.lineWidth = 0.25 * S;
  const rect = (x0, z0, x1, z1) => { g.beginPath(); g.rect(X(x0), Z(z0), (x1 - x0) * S, (z1 - z0) * S); g.stroke(); };
  rect(1.21, -2.3, 5.21, 3.7); rect(-5.21, -2.3, -1.21, 3.7);
  line([1.21, -2.3], [1.79, -10]); line([-1.21, -2.3], [-1.79, -10]); line([1.79, -10], [-1.79, -10]);
  // the coach's boxes and the running lane
  rect(-87, 40, -67, 50); rect(67, 40, 87, 50);
  line([-31.8, 31.8], [B1[0] + 2, B1[1] - 2]);

  // the game's wear: the back of the right-handers' box dug out, the pitcher's landing
  // spot, the base path to first
  g.globalCompositeOperation = 'source-atop';
  const scuff = (x, z, rx, rz, a) => { g.fillStyle = `rgba(110,72,44,${a})`; g.beginPath(); g.ellipse(X(x), Z(z), rx * S, rz * S, 0, 0, TAU); g.fill(); };
  for (let i = 0; i < 40; i++) scuff(3.4 + (r() - 0.5) * 2.2, -0.9 + r() * 2.8, 0.25 + r() * 0.4, 0.15 + r() * 0.3, 0.5);
  // (where the deliveries' front feet land, diamond/marks.js strideOf: a right-hander's a little to
  // the third-base side, a left-hander's to the first)
  for (let i = 0; i < 30; i++) scuff((i % 2 ? 0.3 : -0.3) + (r() - 0.5) * 1.4, 56 + (r() - 0.5) * 1.4, 0.2 + r() * 0.4, 0.15 + r() * 0.3, 0.55);
  for (let i = 0; i < 120; i++) { const t = r(); scuff(B1[0] * t + (r() - 0.5) * 2, B1[1] * t + (r() - 0.5) * 2, 0.2, 0.12, 0.25); }
  g.globalCompositeOperation = 'source-over';
  return c;
}

// ── the game's marks ───────────────────────────────────────────────────────────
// What a game leaves in the dirt, painted on a park's own copy of this canvas as it happens
// (diamond/marks.js works them out, gl/ballpark.js markDirt paints and uploads them), and only
// where there's dirt: the pitcher's front foot landing on every pitch (`stride`), the batter
// digging his back foot in (`dig`), and the scar a man sliding or diving leaves (`scar`, along
// `pts`, `w` feet wide, with a heap of dirt pushed up ahead of it on its last stretch, `end`).
// `at` is a foot's ground point, [x, z], and `dir` the way it points, degrees about the vertical
// (0 faces +z, as cast.js has a facing); `seed` moves each one a little, so a game's worth of
// strides dig a hole rather than stamping one spot.
//
// Each is a light touch that builds up. paintMark clips to its own rect (markRect), so what goes
// up to the GPU is exactly what changed.
export const MARK_KINDS = Object.freeze(['stride', 'dig', 'scar']);

// Whether (x, z) is dirt on the painted canvas, paintInfield's shapes as a test: a cut-out round
// home, a bag or the mound, a lane up a line, or inside the infield's arc and off its grass.
const GRASS = (() => {
  const ins = 4.24, b1 = BAGS[1], b2 = BAGS[2], b3 = BAGS[3];
  return [[0, ins + 1], [b1[0] + ins, b1[2]], [0, b2[2] - ins], [b3[0] - ins, b3[2]]];
})();
function inside(poly, x, z) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); }
  }
  return true;
}
export function onDirt(x, z) {
  const near = (cx, cz, r) => Math.hypot(x - cx, z - cz) <= r;
  if (near(0, 0.7, 13) || near(MOUND[0], MOUND[1], 9) || [1, 2, 3].some((k) => near(BAGS[k][0], BAGS[k][2], 9.5))) return true;
  for (const k of [1, 3]) {
    const b = BAGS[k], L = Math.hypot(b[0], b[2]), ux = b[0] / L, uz = b[2] / L, along = x * ux + z * uz;
    if (along >= 0 && along <= L && Math.abs(z * ux - x * uz) <= 3.2) return true;
  }
  if (z < 0 || Math.abs(Math.atan2(x, z)) > 48 * DEG || Math.hypot(x, z - 60.5) > 95) return false;
  return !inside(GRASS, x, z);
}
// How far a foot's mark reaches from its point at the most (ft), its jitter and its spray included.
const FOOT_REACH = 1.3;
const SCAR_PILE = 1.4;

// The texels mark `m` touches on a canvas `px` texels a side: [x, y, w, h], whole texels with a
// margin, clipped to the canvas; null for one off it.
export function markRect(m, px = 2048) {
  const S = px / DIRT_RECT.size;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const take = (x, z, r) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); };
  if (m.kind === 'scar') {
    const pts = m.pts || [];
    for (const q of pts) take(q[0], q[1], (m.w || 1.3) / 2 + 0.2);
    if (m.end && pts.length >= 2) {
      const a = pts[pts.length - 2], b = pts[pts.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      take(b[0] + (b[0] - a[0]) / l * SCAR_PILE * 0.6, b[1] + (b[1] - a[1]) / l * SCAR_PILE * 0.6, SCAR_PILE);
    }
  } else if (Array.isArray(m.at)) take(m.at[0], m.at[1], FOOT_REACH);
  if (!(x1 > x0)) return null;
  const tx0 = Math.max(0, Math.floor((x0 - DIRT_RECT.x0) * S) - 2), ty0 = Math.max(0, Math.floor((z0 - DIRT_RECT.z0) * S) - 2);
  const tx1 = Math.min(px, Math.ceil((x1 - DIRT_RECT.x0) * S) + 2), ty1 = Math.min(px, Math.ceil((z1 - DIRT_RECT.z0) * S) + 2);
  return tx1 > tx0 && ty1 > ty0 ? [tx0, ty0, tx1 - tx0, ty1 - ty0] : null;
}

// Paints mark `m` on `g`, a 2-D context over the whole canvas (`px` texels a side). Returns the
// rect it may have touched (markRect), or null.
export function paintMark(g, m, px = 2048) {
  const rect = markRect(m, px);
  if (!rect) return null;
  const S = px / DIRT_RECT.size, X = (x) => (x - DIRT_RECT.x0) * S, Z = (z) => (z - DIRT_RECT.z0) * S;
  const r = rng(m.seed >>> 0);
  g.save();
  g.beginPath(); g.rect(rect[0], rect[1], rect[2], rect[3]); g.clip();
  g.globalCompositeOperation = 'source-atop';
  // an ellipse `a` feet along heading `deg` and `b` across, at (x, z)
  const oval = (x, z, a, b, deg, fill) => {
    const d = deg * DEG;
    g.fillStyle = fill;
    g.beginPath(); g.ellipse(X(x), Z(z), a * S, b * S, Math.atan2(Math.cos(d), Math.sin(d)), 0, TAU); g.fill();
  };
  if (m.kind === 'stride' || m.kind === 'dig') {
    const deg = (m.dir || 0) + (r() - 0.5) * 24, k = 0.85 + 0.3 * r();
    const x = m.at[0] + (r() - 0.5) * 0.3, z = m.at[1] + (r() - 0.5) * 0.3, d = deg * DEG;
    if (m.kind === 'stride') {
      // the hole his front foot digs, and the loose dirt it throws up toward the plate
      oval(x, z, 0.55 * k, 0.32 * k, deg, 'rgba(58,34,17,0.14)');
      oval(x + Math.sin(d) * 0.5, z + Math.cos(d) * 0.5, 0.32 * k, 0.42 * k, deg, 'rgba(198,158,114,0.07)');
    } else {
      // the back foot dug in, and the dirt kicked out behind it
      oval(x, z, 0.5 * k, 0.3 * k, deg, 'rgba(58,34,17,0.14)');
      oval(x - Math.sin(d) * 0.45, z - Math.cos(d) * 0.45, 0.3 * k, 0.36 * k, deg, 'rgba(198,158,114,0.06)');
    }
  } else if (m.kind === 'scar' && (m.pts || []).length >= 2) {
    const pts = m.pts, w = m.w || 1.3;
    const path = () => { g.beginPath(); g.moveTo(X(pts[0][0]), Z(pts[0][1])); for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Z(pts[i][1])); };
    g.lineJoin = 'round'; g.lineCap = 'butt';
    // the dry top pushed aside to its edges, and the damp dirt under it, darker, where he went
    g.strokeStyle = 'rgba(214,176,134,0.36)'; g.lineWidth = w * S; path(); g.stroke();
    g.strokeStyle = 'rgba(64,38,19,0.52)'; g.lineWidth = w * 0.72 * S; path(); g.stroke();
    if (m.end) {
      // the dry dirt heaped up ahead of him where he stopped
      const a = pts[pts.length - 2], b = pts[pts.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
      const deg = Math.atan2(ux, uz) / DEG;
      oval(b[0] + ux * SCAR_PILE * 0.6, b[1] + uz * SCAR_PILE * 0.6, 0.5, w * 0.6, deg, 'rgba(214,176,134,0.5)');
    }
  }
  g.restore();
  return rect;
}
