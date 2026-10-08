// THE FACE ATLAS'S PAINTER: EACH LAYOUT AS FOUR MASKS, NO CANVAS.
//
// client/game/js/panels/actor-faces.js says what the masks mean and how the shader colours them.
// This paints them. It's the Actor Lab's paintFace (actor-head.js) step for step, with every colour
// turned into the mask it comes from: a shadow into the shade mask, a brow into the hair mask, a
// lip into the lip mask, and the eye's opening into the eye mask. The order dress (Wildblood marks,
// an Ascendant's implant) stays in the lab: the game's figures carry no order.
//
// It's plain JS over Float32Arrays rather than a 2D canvas, for two reasons: the bake runs in Node,
// so the gate can rebuild the atlas and compare; and a canvas stores premultiplied colour, which
// can't carry four independent masks through an alpha channel.
//
// Painted at the lab's 2560 px a metre (512 x 640 for FACE's box), then averaged down to a 256 x 320
// cell. Coordinates are metres, the figure's left on +x, y up.
import { FACE } from '../../client/game/js/panels/actor-head.js';
import { FACE_ATLAS, FACE_LAYOUTS } from '../../client/game/js/panels/actor-faces.js';

const PW = 512, PH = 640, PXM = PW / (FACE.x1 - FACE.x0);
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function mulberry(s) {
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const toPx = (x, y) => [(x - FACE.x0) * PXM, (FACE.y1 - y) * PXM];
const both = (f) => { f(1); f(-1); };

// ── Curves, sampled to points in metres ─────────────────────────────────────────────────────────────
const quadAt = (p0, p1, p2, t) => [0, 1].map((i) => (1 - t) * (1 - t) * p0[i] + 2 * (1 - t) * t * p1[i] + t * t * p2[i]);
const cubicAt = (p0, p1, p2, p3, t) => [0, 1].map((i) => (1 - t) ** 3 * p0[i] + 3 * (1 - t) ** 2 * t * p1[i] + 3 * (1 - t) * t * t * p2[i] + t ** 3 * p3[i]);
const quad = (p0, p1, p2, n = 16) => Array.from({ length: n + 1 }, (_, i) => quadAt(p0, p1, p2, i / n));
const cubic = (p0, p1, p2, p3, n = 20) => Array.from({ length: n + 1 }, (_, i) => cubicAt(p0, p1, p2, p3, i / n));
// A tapered stroke's outline along a quadratic: width w(t).
function taper(p0, p1, p2, w, steps = 18) {
  const L = [], R = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = quadAt(p0, p1, p2, t), q = quadAt(p0, p1, p2, Math.min(1, t + 0.01)), o = quadAt(p0, p1, p2, Math.max(0, t - 0.01));
    let tx = q[0] - o[0], ty = q[1] - o[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const hw = w(t) / 2;
    L.push([p[0] - ty * hw, p[1] + tx * hw]); R.push([p[0] + ty * hw, p[1] - tx * hw]);
  }
  return [...L, ...R.reverse()];
}

// ── The surface: four masks, and a layer to draw into before it's composited onto them ─────────────
function surface() {
  const N = PW * PH;
  const S = new Float32Array(N).fill(1), H = new Float32Array(N), Lp = new Float32Array(N), E = new Float32Array(N);
  const lay = new Float32Array(N), tmp = new Float32Array(N);
  let bx0 = PW, by0 = PH, bx1 = -1, by1 = -1;
  const grow = (x0, y0, x1, y1) => {
    bx0 = Math.max(0, Math.min(bx0, Math.floor(x0))); by0 = Math.max(0, Math.min(by0, Math.floor(y0)));
    bx1 = Math.min(PW - 1, Math.max(bx1, Math.ceil(x1))); by1 = Math.min(PH - 1, Math.max(by1, Math.ceil(y1)));
  };
  const over = (i, a) => { if (a > 0) lay[i] += (1 - lay[i]) * Math.min(1, a); };
  // Primitives draw coverage into the layer, source-over.
  const draw = {
    // A soft elliptical spot, `a` at its centre falling to nothing at its edge, like a canvas
    // radial gradient.
    blob(x, y, rx, ry, a, rot = 0) {
      const [cx, cy] = toPx(x, y), R = Math.max(rx, ry) * PXM, c = Math.cos(rot), s = Math.sin(rot);
      const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(PW - 1, Math.ceil(cx + R));
      const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(PH - 1, Math.ceil(cy + R));
      if (x1 < x0 || y1 < y0) return;
      grow(x0, y0, x1, y1);
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = (px + 0.5 - cx) / PXM, dy = -(py + 0.5 - cy) / PXM;
          const u = dx * c + dy * s, v = -dx * s + dy * c, r = Math.hypot(u / rx, v / ry);
          if (r < 1) over(py * PW + px, a * (1 - r));
        }
      }
    },
    // A filled closed outline, even-odd, antialiased over four sub-rows with exact spans.
    fill(pts, a) {
      const P = pts.map(([x, y]) => toPx(x, y));
      const ys = P.map((p) => p[1]), xs = P.map((p) => p[0]);
      const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(PH - 1, Math.ceil(Math.max(...ys)));
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(PW - 1, Math.ceil(Math.max(...xs)));
      if (x1 < x0 || y1 < y0) return;
      grow(x0, y0, x1, y1);
      const row = new Float32Array(x1 - x0 + 2);
      for (let py = y0; py <= y1; py++) {
        row.fill(0);
        for (let k = 0; k < 4; k++) {
          const sy = py + (k + 0.5) / 4, hits = [];
          for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
            const [ax, ay] = P[j], [bx, by] = P[i];
            if ((ay > sy) !== (by > sy)) hits.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
          }
          hits.sort((p, q) => p - q);
          for (let h = 0; h + 1 < hits.length; h += 2) {
            const xa = Math.max(x0, hits[h]), xb = Math.min(x1 + 1, hits[h + 1]);
            for (let px = Math.floor(xa); px < xb; px++) {
              const ov = Math.min(px + 1, xb) - Math.max(px, xa);
              if (ov > 0) row[px - x0] += ov / 4;
            }
          }
        }
        for (let px = x0; px <= x1; px++) if (row[px - x0] > 0) over(py * PW + px, a * row[px - x0]);
      }
    },
    // A polyline `w` metres wide. Under a pixel wide it's a fainter one-pixel line, as a canvas
    // draws a hairline.
    stroke(pts, w, a) {
      const P = pts.map(([x, y]) => toPx(x, y)), wp = w * PXM, hw = Math.max(wp, 1) / 2;
      const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
      const x0 = Math.max(0, Math.floor(Math.min(...xs) - hw - 1)), x1 = Math.min(PW - 1, Math.ceil(Math.max(...xs) + hw + 1));
      const y0 = Math.max(0, Math.floor(Math.min(...ys) - hw - 1)), y1 = Math.min(PH - 1, Math.ceil(Math.max(...ys) + hw + 1));
      if (x1 < x0 || y1 < y0) return;
      grow(x0, y0, x1, y1);
      const k = Math.min(1, wp);
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const qx = px + 0.5, qy = py + 0.5;
          let d = Infinity;
          for (let i = 0; i + 1 < P.length; i++) {
            const [ax, ay] = P[i], [bx, by] = P[i + 1], ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
            const t = l2 ? clamp01(((qx - ax) * ex + (qy - ay) * ey) / l2) : 0;
            d = Math.min(d, Math.hypot(qx - ax - t * ex, qy - ay - t * ey));
          }
          const cov = clamp01(hw + 0.5 - d) * k;
          if (cov > 0) over(py * PW + px, a * cov);
        }
      }
    },
    // A vertical ramp over the whole width from alpha a0 at y0 to a1 at y1, held past y1.
    rampY(y0, y1, a0, a1, yEnd) {
      const p0 = toPx(0, y0)[1], p1 = toPx(0, y1)[1], pe = toPx(0, yEnd)[1];
      const top = Math.max(0, Math.floor(Math.min(p0, pe))), bot = Math.min(PH - 1, Math.ceil(Math.max(p0, pe)));
      grow(0, top, PW - 1, bot);
      for (let py = top; py <= bot; py++) {
        const t = clamp01((py + 0.5 - p0) / (p1 - p0)), a = a0 + (a1 - a0) * t;
        for (let px = 0; px < PW; px++) over(py * PW + px, a);
      }
    },
  };
  // A gaussian over the drawn box, `sigma` in pixels, as a canvas filter's blur(Npx).
  function blur(sigma) {
    const pad = Math.ceil(sigma * 3);
    const x0 = Math.max(0, bx0 - pad), x1 = Math.min(PW - 1, bx1 + pad), y0 = Math.max(0, by0 - pad), y1 = Math.min(PH - 1, by1 + pad);
    const K = [];
    for (let i = -pad; i <= pad; i++) K.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
    const ks = K.reduce((s, v) => s + v, 0);
    for (let i = 0; i < K.length; i++) K[i] /= ks;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let s = 0;
        for (let k = -pad; k <= pad; k++) { const xx = Math.min(PW - 1, Math.max(0, x + k)); s += lay[y * PW + xx] * K[k + pad]; }
        tmp[y * PW + x] = s;
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let s = 0;
        for (let k = -pad; k <= pad; k++) { const yy = Math.min(PH - 1, Math.max(0, y + k)); s += tmp[yy * PW + x] * K[k + pad]; }
        lay[y * PW + x] = s;
      }
    }
    bx0 = x0; bx1 = x1; by0 = y0; by1 = y1;
  }
  // Draw with `fn(draw)`, blur, then apply `op(i, alpha)` to each pixel the layer covers.
  function layer(fn, op, blurPx = 0) {
    bx0 = PW; by0 = PH; bx1 = -1; by1 = -1;
    fn(draw);
    if (bx1 < bx0) return;
    if (blurPx > 0) blur(blurPx);
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const i = y * PW + x, a = lay[i];
        if (a > 1e-4) op(i, Math.min(1, a));
        lay[i] = 0;
      }
    }
  }
  // The ways a layer lands on the masks.
  const ops = {
    // Multiply everything by v at opacity a: under 1 shades, over 1 lightens.
    shade: (v) => (i, a) => { S[i] *= 1 + a * (v - 1); },
    hair: (i, a) => { H[i] += (1 - H[i]) * a; },
    // A hair of its own brightness: hair, and the shade it carries.
    strand: (v) => (i, a) => { H[i] += (1 - H[i]) * a; S[i] *= 1 + a * (v - 1); },
    lip: (v = 1) => (i, a) => { Lp[i] += (1 - Lp[i]) * a; S[i] *= 1 + a * (v - 1); },
    // A flush stays under 0.45, so it never reads as lipstick.
    flush: (i, a) => { if (Lp[i] < 0.45) Lp[i] = Math.min(0.45, Lp[i] + a); },
    eye: (i, a) => { E[i] += (1 - E[i]) * a; },
  };
  return { layer, ops, masks: { S, H, L: Lp, E } };
}

// ── One layout ──────────────────────────────────────────────────────────────────────────────────────
// Returns the cell as RGBA bytes, 256 x 320, row 0 at the top.
export function paintFaceMasks(layout) {
  const { age, beard, makeup, mood, brow, seed } = layout;
  const R = mulberry(seed);
  const { layer, ops, masks } = surface();
  const blob = (x, y, rx, ry, a, op, rot = 0, blurPx = 0) => layer((d) => d.blob(x, y, rx, ry, a, rot), op, blurPx);
  const SHADE = 0.45, LIGHT = 1.15;

  // ── Tone: a warmer middle of the face, a lighter forehead, and blotches too soft to be marks ──
  for (let i = 0; i < 26; i++) {
    const x = (R() - 0.5) * 0.15, y = 1.53 + R() * 0.2, rx = 0.006 + R() * 0.012, ry = 0.006 + R() * 0.012;
    if (R() < 0.5) blob(x, y, rx, ry, 0.032, ops.flush); else blob(x, y, rx, ry, 0.08, ops.shade(LIGHT));
  }
  both((s) => blob(s * 0.044, 1.607, 0.021, 0.016, 0.1, ops.flush));
  blob(0, 1.6, 0.011, 0.012, 0.09, ops.flush);
  blob(0, 1.69, 0.05, 0.02, 0.12, ops.shade(LIGHT));
  // a darker jaw and the shadow under the chin
  layer((d) => d.rampY(1.54, 1.517, 0, 0.5, 1.515), ops.shade(0.7));

  // ── Shading the geometry can't: sockets, the sides and underside of the nose, the mouth ──
  both((s) => {
    blob(s * 0.02, 1.6455, 0.009, 0.007, 0.35, ops.shade(SHADE));             // inner corner, under the brow
    blob(s * 0.031, 1.6475, 0.018, 0.006, 0.22, ops.shade(SHADE));            // under the brow
    blob(s * 0.031, 1.6342, 0.014, 0.004, 0.18 + 0.32 * age, ops.shade(SHADE)); // under the eye
    blob(s * 0.0125, 1.618, 0.004, 0.02, 0.16, ops.shade(SHADE));             // the side of the nose
    blob(s * 0.0255, FACE.mouthY, 0.004, 0.003, 0.4, ops.shade(SHADE));       // mouth corners
  });
  blob(0, 1.5845, 0.012, 0.003, 0.3, ops.shade(SHADE));                       // under the nose
  blob(0, 1.5525, 0.015, 0.003, 0.32, ops.shade(SHADE));                      // under the lower lip

  // ── Nose: the nostrils, the wings' edges, the light down the bridge and on the tip ──
  both((s) => {
    blob(s * 0.0076, 1.5876, 0.0036, 0.0018, 0.95, ops.shade(0.15), s * 0.35, 1);
    const [a0, a1] = s > 0 ? [-0.9, 1.6] : [Math.PI - 1.6, Math.PI + 0.9];
    const arc = Array.from({ length: 17 }, (_, i) => { const t = a0 + ((a1 - a0) * i) / 16; return [s * 0.0158 + 0.0068 * Math.cos(t), 1.5925 + 0.0068 * Math.sin(t)]; });
    layer((d) => d.stroke(arc, 0.0009, 0.35), ops.shade(SHADE), 1);
  });
  blob(0, 1.6005, 0.0045, 0.004, 0.3, ops.shade(LIGHT));
  layer((d) => d.stroke([[0, 1.632], [0, 1.606]], 0.0022, 0.12), ops.shade(LIGHT));

  // ── Age. Folds, not lines: at this size a hard line reads as a scar, so each is a broad soft shade ──
  const fold = (pts, w, a, blurPx) => layer((d) => d.stroke(pts, w, a), ops.shade(0.5), blurPx);
  both((s) => fold(quad([s * 0.0205, 1.5915], [s * 0.031, 1.58], [s * 0.0298, 1.5635]), 0.003, 0.05 + 0.25 * age, 3));
  if (age > 0.4) {
    for (let k = 0; k < 3; k++) {
      const y = 1.676 + k * 0.0075 + (R() - 0.5) * 0.002;
      fold(quad([-0.032, y - 0.001], [0, y + 0.0015], [0.032, y - 0.001]), 0.0009, (age - 0.4) * 0.4, 1.2);
    }
  }
  if (age > 0.35) both((s) => { for (let k = -1; k <= 1; k++) fold([[s * 0.048, 1.6405 + k * 0.0018], [s * 0.0555, 1.6413 + k * 0.0038]], 0.0006, (age - 0.35) * 0.45, 0.9); });
  if (age > 0.55) both((s) => fold(quad([s * 0.022, 1.6345], [s * 0.031, 1.6315], [s * 0.042, 1.635]), 0.0012, (age - 0.55) * 0.4, 1.5));
  if (age > 0.7) both((s) => blob(s * 0.029, 1.555, 0.004, 0.007, (age - 0.7) * 0.6, ops.shade(0.5)));
  if (age > 0.75) for (let i = 0; i < 9; i++) blob((R() - 0.5) * 0.11, 1.6 + R() * 0.1, 0.0015 + R() * 0.0015, 0.0015, 0.35, ops.shade(0.72));

  // ── Beard: the shadow of the stubble, a full beard's mass, then the hairs ──
  if (beard > 0) {
    const mask = (x, y) => {
      // The jaw, chin and upper lip, up the cheeks to a line from the corner of the nose to the
      // sideburn, never on the lips.
      const ax = Math.abs(x), le = (x / 0.0275) ** 2 + ((y - 1.5648) / 0.0098) ** 2, lip = sstep(1.0, 1.35, le);
      const top = ax < 0.024 ? 1.5835 : ax < 0.066 ? 1.58 + ((ax - 0.024) / 0.042) * 0.028 : 1.608 + ((ax - 0.066) / 0.01) * 0.012;
      return sstep(top + 0.0025, top - 0.0035, y) * lip * sstep(0.075, 0.066, ax);
    };
    layer((d) => {
      for (let i = 0; i < 260; i++) {
        const x = (R() - 0.5) * 0.15, y = 1.517 + R() * 0.095, m = mask(x, y);
        if (m > 0.05) d.blob(x, y, 0.004, 0.004, 0.06 * m);
      }
    }, ops.hair);
    if (beard >= 2) {
      layer((d) => {
        for (let i = 0; i < 900; i++) {
          const x = (R() - 0.5) * 0.15, y = 1.517 + R() * 0.095, m = mask(x, y);
          if (m > 0.1) d.blob(x, y, 0.0025, 0.0025, 0.5 * m);
        }
      }, ops.strand(0.85), 2);
    }
    const n = beard >= 2 ? 7000 : 4000;
    for (let i = 0; i < n; i++) {
      const x = (R() - 0.5) * 0.15, y = 1.517 + R() * 0.095, m = mask(x, y);
      if (R() > m) continue;
      const b = 0.8 * (0.7 + 0.6 * R()), len = beard >= 2 ? 0.0022 + R() * 0.0018 : 0.0007;
      const ang = -Math.PI / 2 + Math.sign(x) * 0.3 + (R() - 0.5) * 0.6;
      layer((d) => d.stroke([[x, y], [x + Math.cos(ang) * len, y + Math.sin(ang) * len]], 0.00028, beard >= 2 ? 0.6 : 0.45), ops.strand(b));
    }
  }

  // ── Lips ──
  const corner = FACE.mouthY + (mood || 0) * 0.0016, mid = [0, FACE.mouthY - 0.0008];
  const upper = [
    ...cubic([-0.0245, corner], [-0.018, 1.5715], [-0.009, 1.5762], [-0.0055, 1.5757]),
    ...quad([-0.0055, 1.5757], [-0.002, 1.5754], [0, 1.5741], 6), ...quad([0, 1.5741], [0.002, 1.5754], [0.0055, 1.5757], 6),
    ...cubic([0.0055, 1.5757], [0.009, 1.5762], [0.018, 1.5715], [0.0245, corner]),
    ...quad([0.0245, corner], mid, [-0.0245, corner]),
  ];
  layer((d) => d.fill(upper, 1), ops.lip(0.84), 0.7);
  const lower = [
    ...quad([-0.0245, corner], mid, [0.0245, corner]),
    ...cubic([0.0245, corner], [0.017, 1.5575], [0.008, 1.5552], [0, 1.5552]),
    ...cubic([0, 1.5552], [-0.008, 1.5552], [-0.017, 1.5575], [-0.0245, corner]),
  ];
  layer((d) => d.fill(lower, 1), ops.lip(), 0.7);
  blob(0.002, 1.5595, 0.008, 0.0018, 0.35, ops.shade(1.35));
  layer((d) => d.stroke(quad([-0.0245, corner], mid, [0.0245, corner]), 0.0008, 0.85), ops.shade(0.28));

  // ── Eyes: the opening (the shader draws what's in it), the lids and the lashes ──
  both((s) => {
    const eye = [...cubic([s * 0.0165, 1.6386], [s * 0.0212, 1.6458], [s * 0.0385, 1.6468], [s * 0.0463, 1.6409]),
      ...cubic([s * 0.0463, 1.6409], [s * 0.0395, 1.6358], [s * 0.0235, 1.635], [s * 0.0165, 1.6386])];
    layer((d) => d.fill(eye, 1), ops.eye);
    blob(s * 0.0172, 1.6388, 0.0013, 0.001, 0.36, ops.flush);
    layer((d) => d.stroke(cubic([s * 0.0175, 1.6405], [s * 0.0225, 1.6492], [s * 0.0395, 1.6504], [s * 0.0478, 1.6432]), 0.0008, 0.5), ops.shade(0.5), 1);
    const lid = [[s * 0.0165, 1.6386], [s * 0.0212, 1.6458], [s * 0.0385, 1.6468], [s * 0.0463, 1.6409]];
    const at = (t) => cubicAt(...lid, t), from = (t0) => Array.from({ length: 21 }, (_, i) => at(t0 + ((1 - t0) * i) / 20));
    const LASH = ops.shade(0.1);
    layer((d) => d.stroke(from(0), 0.001, 0.92), LASH);
    layer((d) => d.stroke(from(0.5), makeup ? 0.0019 : 0.0014, 0.92), LASH);
    layer((d) => { for (let i = 0; i < 12; i++) { const t = 0.45 + (i / 11) * 0.55, q = at(t); d.stroke([q, [q[0] + s * 0.0012 * t, q[1] + 0.0014]], 0.0003, 0.92); } }, LASH);
    if (makeup) {
      layer((d) => d.stroke([[s * 0.044, 1.6418], [s * 0.0528, 1.6452]], 0.0012, 0.92), LASH);
      blob(s * 0.031, 1.6462, 0.016, 0.0055, 0.35, ops.shade(0.75));
    }
    layer((d) => d.stroke(cubic([s * 0.0463, 1.6409], [s * 0.0395, 1.6358], [s * 0.0235, 1.635], [s * 0.0165, 1.6386]), 0.0005, 0.45), ops.shade(0.55));
  });

  // ── Brows: a soft ground, then the hairs, which grow up at the inner end and lie outward along
  // the rest ──
  both((s) => {
    const tilt = brow || 0;
    const P0 = [s * 0.0105, 1.6532 + tilt * 0.003], P1 = [s * 0.03, 1.6607], P2 = [s * 0.0505, 1.6548 - tilt * 0.0015];
    const w = (t) => 0.0044 * (1 - t) + 0.0012 * t + 0.0008 * Math.sin(Math.PI * t);
    layer((d) => d.fill(taper(P0, P1, P2, w), 0.3), ops.strand(0.82), 1);
    for (let i = 0; i < 280; i++) {
      const t = R() ** 0.85, c = quadAt(P0, P1, P2, t), e = quadAt(P0, P1, P2, Math.min(1, t + 0.02));
      const tx = e[0] - c[0], ty = e[1] - c[1], l = Math.hypot(tx, ty) || 1;
      const off = (R() - 0.5) * w(t) * 0.9;
      const x = c[0] - (ty / l) * off, y = c[1] + (tx / l) * off;
      const along = Math.atan2(ty, tx), up = Math.PI / 2 - s * 0.25;
      const ang = (t < 0.15 ? up : along + s * 0.25) + (R() - 0.5) * 0.4;
      const len = 0.0024 + R() * 0.0018, b = 0.82 * (0.8 + 0.4 * R()), a = 0.5 + 0.3 * R();
      layer((d) => d.stroke([[x, y], [x + Math.cos(ang) * len, y + Math.sin(ang) * len]], 0.0003, a), ops.strand(b));
    }
  });

  // ── Down to the cell: each texel the mean of four, packed as RGBA bytes ──
  const { S, H, L, E } = masks, cw = PW / 2, ch = PH / 2, out = new Uint8Array(cw * ch * 4);
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * 2 * PW + x * 2, j = [i, i + 1, i + PW, i + PW + 1], m = (A) => (A[j[0]] + A[j[1]] + A[j[2]] + A[j[3]]) / 4;
      const o = (y * cw + x) * 4;
      out[o] = byte(m(S) / 1.5); out[o + 1] = byte(m(H)); out[o + 2] = byte(m(L)); out[o + 3] = byte(1 - m(E));
    }
  }
  return out;
}

// ── The atlas ───────────────────────────────────────────────────────────────────────────────────────
// Every layout in its cell: RGBA bytes, FACE_ATLAS.w x FACE_ATLAS.h, row 0 at the top. `half` is
// the same at half size, for phones.
export function paintFaceAtlas() {
  const { cols, cellW, cellH, w, h } = FACE_ATLAS;
  const full = new Uint8Array(w * h * 4);
  FACE_LAYOUTS.forEach((L, i) => {
    const cell = paintFaceMasks(L), cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
    for (let y = 0; y < cellH; y++) full.set(cell.subarray(y * cellW * 4, (y + 1) * cellW * 4), ((cy + y) * w + cx) * 4);
  });
  const hw = w / 2, hh = h / 2, half = new Uint8Array(hw * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      for (let c = 0; c < 4; c++) {
        const a = ((y * 2) * w + x * 2) * 4 + c;
        half[(y * hw + x) * 4 + c] = (full[a] + full[a + 4] + full[a + w * 4] + full[a + w * 4 + 4] + 2) >> 2;
      }
    }
  }
  return { full, half };
}
