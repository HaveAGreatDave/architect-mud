// FLORA DRAWERS: one painter per growth form, for the wildlands plants (client/shared/flora.js).
//
// A species is content (content/map/flora.json): a name, a growth form, two colours and a size. This
// file knows how to draw each FORM, and nothing about which species use it, so a creosote and a
// sagebrush are the same drawer in two colours, and a new species is a content row.
//
// Every painter draws on a 2-D context at a ground point (x, by), sized in metres through `S`
// (pixels per metre at the plant's depth), lit from the upper left like the rest of the scatter. It
// is called twice over: into a billboard texture once per species, variant and lighting (GLASS 2,
// through windshield.js `drawPlantBB`), and straight onto the canvas on the 2-D path. So it must
// take everything from its arguments: `col(rgb, k)` returns the CSS colour of `rgb` scaled by `k`,
// dimmed for night and fogged for distance by the caller, and `rnd(i)` is the plant's own die.
//
// ⚠ NO BACKTICKS IN COMMENTS HERE EITHER: client:smoke parses this as a module, and the habit of
// quoting identifiers with them is how a template literal elsewhere once ended early.

// Height of each form in metres at scale 1, for sizing the billboard it is baked into.
export const FLORA_FORM_H = {
  shrub: 1.3, columnar: 7.5, paddle: 1.5, cholla: 1.7, barrel: 1.1, rosette: 1.2, yucca: 3.6, joshua: 6.2,
  ocotillo: 4.6, juniper: 4.6, broadtree: 7.2, feathery: 3.8, grass: 0.8, flowers: 0.5, snag: 5.2, thorn: 3.2,
};
// How wide, as a share of the height, so the texture is big enough for the crown.
export const FLORA_FORM_W = {
  shrub: 2.2, columnar: 0.9, paddle: 1.8, cholla: 1.3, barrel: 1.2, rosette: 2.4, yucca: 1.2, joshua: 1.4,
  ocotillo: 1.4, juniper: 1.3, broadtree: 1.5, feathery: 1.3, grass: 2.6, flowers: 4.2, snag: 1.1, thorn: 1.5,
};
// How much snow each form keeps (see SNOW_HOLD in windshield.js): a flat crown catches it, canes
// and stems hardly any.
export const FLORA_FORM_SNOW = {
  shrub: 0.5, columnar: 0.55, paddle: 0.6, cholla: 0.35, barrel: 0.7, rosette: 0.3, yucca: 0.4, joshua: 0.45,
  ocotillo: 0.12, juniper: 0.7, broadtree: 0.8, feathery: 0.35, grass: 0.25, flowers: 0.2, snag: 0.25, thorn: 0.3,
};

// A blob, as an ellipse: the unit most crowns are made of.
const blob = (g, x, y, rx, ry, css) => { g.fillStyle = css; g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, 7); g.fill(); };
const line = (g, pts, w, css, cap = 'round') => {
  g.strokeStyle = css; g.lineWidth = Math.max(0.6, w); g.lineCap = cap; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke();
};
// A crown of overlapping blobs: dark underneath, a lit cap pushed up and to the left. `n` blobs over
// an ellipse of half-width w and half-height h centred at (cx, cy).
function crown(g, cx, cy, w, h, n, rgb, col, rnd, k0, airy = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rnd(k0 + i) * Math.PI * 2, r = Math.sqrt(rnd(k0 + 40 + i)) * (1 - airy * 0.2);
    pts.push([cx + Math.cos(a) * w * 0.62 * r, cy + Math.sin(a) * h * 0.55 * r, (0.36 + rnd(k0 + 80 + i) * 0.3) * (1 - airy * 0.45)]);
  }
  pts.sort((p, q) => q[1] - p[1]);
  for (const [x, y, s] of pts) blob(g, x, y, w * s, h * s * 0.9, col(rgb, 0.62));
  for (const [x, y, s] of pts) blob(g, x - w * s * 0.18, y - h * s * 0.22, w * s * 0.62, h * s * 0.55, col(rgb, 1));
  for (const [x, y, s] of pts) if (s > 0.42) blob(g, x - w * s * 0.3, y - h * s * 0.38, w * s * 0.26, h * s * 0.2, col(rgb, 1.22));
}
// A ribbed column from (x, y0) up to (x, y1), half-width hw, lit down its left side.
function column(g, x, y0, y1, hw, rgb, col) {
  g.fillStyle = col(rgb, 0.64); g.beginPath(); g.moveTo(x - hw, y0); g.lineTo(x - hw, y1 + hw); g.arc(x, y1 + hw, hw, Math.PI, 0); g.lineTo(x + hw, y0); g.closePath(); g.fill();
  g.fillStyle = col(rgb, 1); g.beginPath(); g.moveTo(x - hw, y0); g.lineTo(x - hw, y1 + hw); g.arc(x, y1 + hw, hw, Math.PI, Math.PI * 1.5); g.lineTo(x - hw * 0.05, y0); g.closePath(); g.fill();
  if (hw > 2.5) { g.strokeStyle = col(rgb, 0.5); g.lineWidth = Math.max(0.5, hw * 0.12); g.beginPath();
    for (const f of [-0.55, 0.15, 0.6]) { g.moveTo(x + hw * f, y0); g.lineTo(x + hw * f, y1 + hw * 1.2); } g.stroke(); }
}

const FORMS = {
  // A rounded bush. Creosote, bursage, sagebrush, rabbitbrush, saltbush: the colour does the rest.
  shrub(g, x, by, S, p, col, rnd) {
    const h = FLORA_FORM_H.shrub * p.scale * S, w = h * 0.85;
    g.lineCap = 'round';
    line(g, [[x - w * 0.15, by], [x - w * 0.3, by - h * 0.45]], S * 0.05, col([70, 58, 44], 0.8));
    line(g, [[x + w * 0.1, by], [x + w * 0.28, by - h * 0.4]], S * 0.05, col([70, 58, 44], 0.8));
    crown(g, x, by - h * 0.5, w, h * 0.95, 6 + Math.floor(rnd(1) * 3), p.rgb, col, rnd, 10, 0.35);
    if (p.accent && rnd(2) < 0.7) for (let i = 0; i < 7; i++) {
      const a = Math.PI * (1.05 + rnd(30 + i) * 0.9), r = 0.4 + rnd(40 + i) * 0.5;
      blob(g, x + Math.cos(a) * w * 0.7 * r, by - h * 0.5 + Math.sin(a) * h * 0.6 * r, S * 0.07, S * 0.06, col(p.accent, 1));
    }
  },
  // A saguaro: a ribbed trunk and up to three arms that bend up at the elbow.
  columnar(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.columnar * p.scale * S, hw = S * 0.4, ty = by - H;
    const arms = rnd(1) < 0.08 ? 0 : 1 + Math.floor(rnd(2) * 3);
    const armList = [];
    for (let i = 0; i < arms; i++) {
      const side = i === 0 ? (rnd(3) < 0.5 ? -1 : 1) : -armList[i - 1].side;
      const ay = by - H * (0.32 + rnd(10 + i) * 0.28), out = S * (0.75 + rnd(20 + i) * 0.5), up = H * (0.18 + rnd(30 + i) * 0.22);
      armList.push({ side, ay, out, up });
    }
    for (const a of armList) {
      const ex = x + a.side * a.out, aw = hw * 0.8;
      line(g, [[x, a.ay], [ex, a.ay], [ex, a.ay - a.up]], aw * 2, col(p.rgb, 0.64));
      line(g, [[x, a.ay - aw * 0.5], [ex - a.side * aw * 0.5, a.ay - aw * 0.5], [ex - aw * 0.5, a.ay - a.up]], aw * 0.9, col(p.rgb, 0.95));
    }
    column(g, x, by, ty, hw, p.rgb, col);
    if (p.accent && rnd(4) < 0.5) {
      blob(g, x, ty + S * 0.05, S * 0.1, S * 0.08, col(p.accent, 1));
      for (const a of armList) blob(g, x + a.side * a.out, a.ay - a.up + S * 0.05, S * 0.09, S * 0.07, col(p.accent, 1));
    }
  },
  // A prickly pear: oval pads stacked edge on edge, fruit along the top rims.
  paddle(g, x, by, S, p, col, rnd) {
    const pw = S * 0.22 * p.scale, ph = S * 0.3 * p.scale, pads = [];
    const base = 2 + Math.floor(rnd(1) * 2);
    for (let i = 0; i < base; i++) pads.push({ x: x + (i - (base - 1) / 2) * pw * 1.5 + (rnd(10 + i) - 0.5) * pw, y: by - ph * 0.9, r: (rnd(20 + i) - 0.5) * 0.7, t: 0 });
    const n = 4 + Math.floor(rnd(2) * 5);
    for (let i = 0; i < n; i++) {
      const par = pads[Math.floor(rnd(30 + i) * pads.length)];
      const a = par.r - 0.5 + rnd(40 + i) * 1.0;
      pads.push({ x: par.x + Math.sin(a) * ph * 1.4, y: par.y - Math.cos(a) * ph * 1.4, r: a * 0.9, t: par.t + 1 });
    }
    pads.sort((a, b) => b.y - a.y);
    for (const q of pads) {
      g.save(); g.translate(q.x, q.y); g.rotate(q.r);
      blob(g, 0, 0, pw, ph, col(p.rgb, 0.66));
      blob(g, -pw * 0.18, -ph * 0.12, pw * 0.72, ph * 0.78, col(p.rgb, 1));
      if (p.accent && q.t > 0 && rnd(60 + q.t) < 0.6) for (let k = 0; k < 3; k++) blob(g, (k - 1) * pw * 0.55, -ph * 0.95, pw * 0.2, pw * 0.24, col(p.accent, 1));
      g.restore();
    }
  },
  // A cholla: a short dark trunk under jointed, spine-pale arms that catch the light.
  cholla(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.cholla * p.scale * S, jw = S * 0.075;
    line(g, [[x, by], [x + (rnd(1) - 0.5) * S * 0.2, by - H * 0.38]], jw * 2.4, col([62, 52, 40], 1));
    const tips = [];
    const grow = (x0, y0, a, len, depth, k) => {
      const x1 = x0 + Math.sin(a) * len, y1 = y0 - Math.cos(a) * len;
      line(g, [[x0, y0], [x1, y1]], jw * 2, col(p.rgb, 0.7));
      line(g, [[x0 - jw * 0.3, y0], [x1 - jw * 0.3, y1]], jw, col(p.rgb, 1.15));
      if (depth <= 0) { tips.push([x1, y1]); return; }
      const b = 2 + (rnd(k) < 0.45 ? 1 : 0);
      for (let i = 0; i < b; i++) grow(x1, y1, clampA(a + (i - (b - 1) / 2) * 0.85 + (rnd(k + 10 + i) - 0.5) * 0.5), len * (0.68 + rnd(k + 20 + i) * 0.2), depth - 1, k * 3 + i + 7);
    };
    const clampA = (a) => (a < -1.25 ? -1.25 : a > 1.25 ? 1.25 : a);
    grow(x, by - H * 0.34, (rnd(3) - 0.5) * 0.4, H * 0.24, 3, 5);
    if (p.accent) tips.forEach(([tx, ty], i) => { if (rnd(90 + i) < 0.45) blob(g, tx, ty, jw * 0.9, jw * 0.9, col(p.accent, 1)); });
  },
  // A barrel cactus: a squat ribbed drum, a crown of flowers on the top.
  barrel(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.barrel * p.scale * S, w = H * 0.48, lean = (rnd(1) - 0.5) * 0.25;
    g.save(); g.translate(x, by); g.rotate(lean);
    blob(g, 0, -H * 0.48, w, H * 0.52, col(p.rgb, 0.62));
    blob(g, -w * 0.2, -H * 0.52, w * 0.72, H * 0.46, col(p.rgb, 1));
    g.strokeStyle = col(p.rgb, 0.45); g.lineWidth = Math.max(0.5, S * 0.03); g.beginPath();
    for (const f of [-0.6, -0.2, 0.2, 0.6]) { g.moveTo(w * f, -H * 0.03); g.quadraticCurveTo(w * f * 1.35, -H * 0.5, w * f * 0.8, -H * 0.96); } g.stroke();
    if (p.accent) for (let i = 0; i < 5; i++) blob(g, (i - 2) * w * 0.22, -H * 0.98, S * 0.07, S * 0.06, col(p.accent, 1));
    g.restore();
  },
  // An agave: a rosette of stiff spiked leaves, and now and then the one tall flower stalk it dies after.
  rosette(g, x, by, S, p, col, rnd) {
    const L = FLORA_FORM_H.rosette * p.scale * S, n = 11 + Math.floor(rnd(1) * 6);
    const leaves = [];
    for (let i = 0; i < n; i++) leaves.push({ a: -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.9 + (rnd(10 + i) - 0.5) * 0.25, l: L * (0.7 + rnd(20 + i) * 0.4), k: rnd(30 + i) });
    leaves.sort((a, b) => Math.abs(b.a + Math.PI / 2) - Math.abs(a.a + Math.PI / 2));
    if (rnd(2) > 0.86) {
      const sh = L * 3.2;
      line(g, [[x, by - L * 0.2], [x + S * 0.1, by - sh]], S * 0.08, col([116, 104, 70], 1));
      for (let i = 0; i < 4; i++) { const yy = by - sh * (0.72 + i * 0.08); blob(g, x + S * 0.1 + (i % 2 ? 1 : -1) * S * 0.2, yy, S * 0.18, S * 0.08, col([206, 178, 72], 1)); }
    }
    for (const lf of leaves) {
      const tx = x + Math.cos(lf.a) * lf.l, ty = by + Math.sin(lf.a) * lf.l * 0.95, nx = -Math.sin(lf.a), ny = Math.cos(lf.a), bw = S * 0.11;
      g.fillStyle = col(p.rgb, lf.k < 0.5 ? 0.7 : 1.05);
      g.beginPath(); g.moveTo(x + nx * bw, by + ny * bw * 0.4); g.quadraticCurveTo(x + Math.cos(lf.a) * lf.l * 0.5 + nx * bw * 1.4, by + Math.sin(lf.a) * lf.l * 0.48, tx, ty);
      g.quadraticCurveTo(x + Math.cos(lf.a) * lf.l * 0.5 - nx * bw * 1.4, by + Math.sin(lf.a) * lf.l * 0.48, x - nx * bw, by - ny * bw * 0.4); g.closePath(); g.fill();
    }
  },
  // A yucca: a shaggy short trunk, a ball of thin leaves, and a stalk of white bells above it.
  yucca(g, x, by, S, p, col, rnd) {
    const sc = p.scale, trunk = S * (0.3 + rnd(1) * 0.9) * sc, r = S * 0.62 * sc, cy = by - trunk - r * 0.5;
    if (trunk > S * 0.4) line(g, [[x, by], [x, cy + r * 0.3]], S * 0.18, col([88, 74, 56], 1));
    if (p.accent && rnd(2) < 0.75) {
      const top = cy - S * (1.6 + rnd(3) * 1.0) * sc;
      line(g, [[x, cy], [x + S * 0.06, top]], S * 0.06, col([112, 116, 70], 1));
      for (let i = 0; i < 9; i++) { const t = i / 8; blob(g, x + S * 0.06 + (i % 2 ? 1 : -1) * S * (0.1 + (1 - t) * 0.12), top + (cy - top) * t * 0.55, S * 0.09, S * 0.08, col(p.accent, 1)); }
    }
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (rnd(10 + i) - 0.5) * 3.8, l = r * (0.7 + rnd(30 + i) * 0.5);
      line(g, [[x, cy], [x + Math.cos(a) * l, cy + Math.sin(a) * l * 0.9]], S * 0.05, col(p.rgb, rnd(50 + i) < 0.5 ? 0.7 : 1.1), 'butt');
    }
  },
  // A Joshua tree: a shaggy trunk forking two or three times, a spiky tuft on every end.
  joshua(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.joshua * p.scale * S, tw = S * 0.34;
    const bark = p.accent || [110, 92, 70], ends = [];
    const grow = (x0, y0, a, len, w, depth, k) => {
      const x1 = x0 + Math.sin(a) * len, y1 = y0 - Math.cos(a) * len;
      line(g, [[x0, y0], [(x0 + x1) / 2 + Math.sin(a + 0.4) * len * 0.08, (y0 + y1) / 2], [x1, y1]], w, col(bark, 0.7));
      line(g, [[x0 - w * 0.25, y0], [x1 - w * 0.25, y1]], w * 0.4, col(bark, 1.05));
      if (depth <= 0) { ends.push([x1, y1]); return; }
      const nb = 2 + (rnd(k) < 0.3 ? 1 : 0);
      for (let i = 0; i < nb; i++) grow(x1, y1, a + (i - (nb - 1) / 2) * (0.75 + rnd(k + 5 + i) * 0.5) + (rnd(k + 9) - 0.5) * 0.3, len * (0.62 + rnd(k + 13 + i) * 0.25), w * 0.72, depth - 1 - (rnd(k + 17 + i) < 0.25 ? 1 : 0), k * 4 + i + 3);
    };
    grow(x, by, (rnd(1) - 0.5) * 0.2, H * 0.42, tw, 2, 7);
    for (const [ex, ey] of ends) {
      const tr = S * 0.42 * p.scale;
      for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + (i / 11 - 0.5) * 3.6; line(g, [[ex, ey], [ex + Math.cos(a) * tr, ey + Math.sin(a) * tr]], S * 0.06, col(p.rgb, i % 3 === 0 ? 1.15 : 0.78), 'butt'); }
      blob(g, ex, ey + tr * 0.1, tr * 0.32, tr * 0.28, col(bark, 0.6));
    }
  },
  // An ocotillo: a fan of long thin canes from one root, red at the tips when it is in bloom.
  ocotillo(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.ocotillo * p.scale * S, n = 9 + Math.floor(rnd(1) * 7), bloom = p.accent && rnd(2) < 0.6;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 0.95 + (rnd(10 + i) - 0.5) * 0.15, l = H * (0.7 + rnd(20 + i) * 0.35), bend = (rnd(30 + i) - 0.5) * 0.25;
      const mx = x + Math.sin(a) * l * 0.5, my = by - Math.cos(a) * l * 0.5, ex = x + Math.sin(a + bend) * l, ey = by - Math.cos(a + bend) * l;
      line(g, [[x + (rnd(40 + i) - 0.5) * S * 0.2, by], [mx, my], [ex, ey]], S * 0.06, col(p.rgb, rnd(50 + i) < 0.5 ? 0.8 : 1.1));
      if (bloom) line(g, [[ex - Math.sin(a + bend) * S * 0.4, ey + Math.cos(a + bend) * S * 0.4], [ex, ey]], S * 0.1, col(p.accent, 1));
    }
  },
  // A juniper: a short twisted trunk under a lopsided dense crown, and often a dead silver limb.
  juniper(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.juniper * p.scale * S, lean = (rnd(1) - 0.5) * H * 0.3, bark = p.accent || [100, 82, 62];
    line(g, [[x, by], [x + lean * 0.4, by - H * 0.18], [x + lean * 0.2, by - H * 0.32], [x + lean, by - H * 0.45]], S * 0.22, col(bark, 0.85));
    if (rnd(2) < 0.55) { const s = rnd(3) < 0.5 ? -1 : 1; line(g, [[x + lean * 0.3, by - H * 0.3], [x + s * H * 0.3, by - H * 0.62], [x + s * H * 0.36, by - H * 0.8]], S * 0.07, col([176, 168, 156], 1)); }
    crown(g, x + lean, by - H * 0.62, H * 0.42, H * 0.62, 7 + Math.floor(rnd(4) * 4), p.rgb, col, rnd, 20, 0);
  },
  // A broad tree: mesquite low and wide, cottonwood tall and round. The scale tells them apart.
  broadtree(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.broadtree * p.scale * S, bark = p.accent || [86, 70, 54], low = p.scale < 1;
    const forks = low ? 3 : 1;
    for (let i = 0; i < forks; i++) {
      const a = (i - (forks - 1) / 2) * 0.5 + (rnd(10 + i) - 0.5) * 0.2;
      line(g, [[x, by], [x + Math.sin(a) * H * 0.3, by - H * (low ? 0.38 : 0.45)]], S * (low ? 0.16 : 0.34), col(bark, 0.85));
    }
    crown(g, x, by - H * (low ? 0.6 : 0.64), H * (low ? 0.66 : 0.48), H * (low ? 0.42 : 0.62), low ? 9 : 11, p.rgb, col, rnd, 30, low ? 0.5 : 0.1);
  },
  // A tamarisk: arching feathery stems with soft pink plumes.
  feathery(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.feathery * p.scale * S, n = 7 + Math.floor(rnd(1) * 5);
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 1.5, l = H * (0.65 + rnd(10 + i) * 0.4);
      const mx = x + Math.sin(a) * l * 0.55, my = by - Math.cos(a * 0.6) * l * 0.7, ex = x + Math.sin(a) * l * 0.95, ey = by - Math.cos(a) * l * 0.8;
      line(g, [[x, by], [mx, my], [ex, ey]], S * 0.05, col([110, 92, 76], 1));
      blob(g, (mx + ex) / 2, (my + ey) / 2, S * 0.38, S * 0.6, col(p.rgb, 0.75));
      blob(g, (mx + ex) / 2 - S * 0.06, (my + ey) / 2 - S * 0.1, S * 0.26, S * 0.4, col(p.rgb, 1.08));
      if (p.accent && rnd(20 + i) < 0.65) blob(g, ex, ey + S * 0.1, S * 0.2, S * 0.3, col(p.accent, 1));
    }
  },
  // Bunchgrass: three or four tufts of fine blades, pale at the tips.
  grass(g, x, by, S, p, col, rnd) {
    const tufts = 3 + Math.floor(rnd(1) * 2), h = FLORA_FORM_H.grass * p.scale * S;
    for (let t = 0; t < tufts; t++) {
      const tx = x + (t - (tufts - 1) / 2) * h * 0.6 + (rnd(5 + t) - 0.5) * h * 0.3, th = h * (0.7 + rnd(10 + t) * 0.5), n = 11;
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1) - 0.5) * 1.3 + (rnd(20 + t * 13 + i) - 0.5) * 0.2, l = th * (0.6 + rnd(40 + t * 13 + i) * 0.45);
        const ex = tx + Math.sin(a) * l, ey = by - Math.cos(a) * l;
        line(g, [[tx, by], [tx + Math.sin(a) * l * 0.5, by - Math.cos(a * 0.7) * l * 0.55], [ex, ey]], Math.max(0.6, S * 0.025), col(p.rgb, i % 3 === 0 ? 1.18 : 0.82), 'butt');
      }
    }
  },
  // A patch of wildflowers: low leaves and two colours of bloom over a couple of metres.
  flowers(g, x, by, S, p, col, rnd) {
    const w = FLORA_FORM_H.flowers * p.scale * S * 3.4, h = FLORA_FORM_H.flowers * p.scale * S;
    const b2 = [p.accent ? p.accent[2] : 150, 90, p.accent ? p.accent[0] : 200];
    for (let i = 0; i < 14; i++) blob(g, x + (rnd(10 + i) - 0.5) * w * 1.8, by - h * 0.25 - rnd(30 + i) * h * 0.3, S * 0.12, S * 0.08, col(p.rgb, rnd(50 + i) < 0.5 ? 0.75 : 1));
    for (let i = 0; i < 18; i++) {
      const fx = x + (rnd(70 + i) - 0.5) * w * 1.8, fy = by - h * (0.45 + rnd(90 + i) * 0.55);
      line(g, [[fx, by - h * 0.1], [fx, fy]], Math.max(0.5, S * 0.02), col(p.rgb, 0.7));
      blob(g, fx, fy, S * 0.07, S * 0.06, col(rnd(110 + i) < 0.6 ? (p.accent || [230, 170, 60]) : b2, 1.05));
    }
  },
  // A dead tree: a bare grey trunk and a few broken limbs.
  snag(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.snag * p.scale * S, lean = (rnd(1) - 0.5) * H * 0.25;
    line(g, [[x, by], [x + lean * 0.5, by - H * 0.5], [x + lean, by - H]], S * 0.24, col(p.rgb, 0.8));
    line(g, [[x - S * 0.05, by], [x + lean * 0.5 - S * 0.05, by - H * 0.5]], S * 0.08, col(p.rgb, 1.3));
    const n = 2 + Math.floor(rnd(2) * 3);
    for (let i = 0; i < n; i++) {
      const t = 0.4 + rnd(10 + i) * 0.5, sx = x + lean * t, sy = by - H * t, d = i % 2 ? 1 : -1, l = H * (0.18 + rnd(20 + i) * 0.2);
      line(g, [[sx, sy], [sx + d * l * 0.7, sy - l * 0.5], [sx + d * l, sy - l * 0.95]], S * 0.09, col(p.rgb, 0.85));
    }
  },
  // Wildthorn: a head-high tangle of crooked dark stems, red-tipped where it is still growing.
  thorn(g, x, by, S, p, col, rnd) {
    const H = FLORA_FORM_H.thorn * p.scale * S, n = 22;
    // The dense heart of the tangle, as a few dark masses low down rather than one disc.
    for (let i = 0; i < 3; i++) blob(g, x + (rnd(70 + i) - 0.5) * H * 0.45, by - H * (0.12 + rnd(75 + i) * 0.14), H * 0.13, H * 0.1, col(p.rgb, 0.62));
    for (let i = 0; i < n; i++) {
      let px = x + (rnd(10 + i) - 0.5) * H * 0.55, py = by, a = (rnd(20 + i) - 0.5) * 0.9;
      const pts = [[px, py]], segs = 4 + Math.floor(rnd(30 + i) * 3), sl = H / segs * (0.75 + rnd(40 + i) * 0.4);
      for (let k = 0; k < segs; k++) {
        a += (rnd(50 + i * 7 + k) - 0.5) * 1.2; a = a < -0.95 ? -0.95 : a > 0.95 ? 0.95 : a;   // crooked, but it grows UP
        px += Math.sin(a) * sl; py -= Math.cos(a) * sl; pts.push([px, py]);
        if (k > 0 && rnd(80 + i * 5 + k) < 0.5) { const d = rnd(85 + i + k) < 0.5 ? -1 : 1; line(g, [[px, py], [px + d * sl * 0.35, py - sl * 0.12]], S * 0.03, col(p.rgb, 1)); }   // a thorn
      }
      line(g, pts, S * 0.07, col(p.rgb, i % 3 === 0 ? 1.25 : 0.9));
      if (p.accent && rnd(60 + i) < 0.5) blob(g, px, py, S * 0.08, S * 0.08, col(p.accent, 1));
    }
  },
};

// Paint one plant. `p` is { form, rgb, accent, scale, seed }; returns false on a form with no
// drawer, so the caller can say so once rather than draw nothing in silence.
export function paintPlant(g, x, by, S, p, col) {
  const f = FORMS[p.form];
  if (!f) return false;
  const seed = p.seed >>> 0;
  const rnd = (i) => { let h = Math.imul(seed ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  f(g, x, by, S, p, col, rnd);
  return true;
}
export const FLORA_DRAWN_FORMS = Object.keys(FORMS);
