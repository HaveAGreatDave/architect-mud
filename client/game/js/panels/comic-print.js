// THE PRINTED COMIC: the painters every sport's comic replay draws with (docs/proposals/comic-ink.md,
// comic replays). Deadball's (diamond/comic.js) and the rink's (rink/comic.js) each run a replay in
// four beats, the run, the freeze, what follows and the page, and paint them with these: the print
// (printPanel), the explosion balloon, the hand-lettered sound word, the freeze over a held frame,
// the page of three panels and the slow-motion frame. Nothing here knows a sport: the words, the
// captions, the inks and the masthead are the caller's.
//
// printPanel and loadComicFaces need a document; nothing else here touches the DOM, and every
// painter draws without one (the gates' counting context).

// freeze, page: how long each holds (s of the game's clock); tilt: the picture's lean (degrees);
// zoom: how much the leaning picture is enlarged so its corners stay off the screen; flash: the
// white of the impact (s); negative: the inverted frame after it (s); pop: how long the burst takes
// to land (s); letter: how far apart the sound's letters land (s); shake: how long the picture
// shakes (s) and by how much of its short side.
export const COMIC = Object.freeze({ freeze: 1.4, page: 2.8, tilt: 6, zoom: 1.14, flash: 0.04, negative: 0.07, pop: 0.18, letter: 0.045, shake: 0.28, shakeBy: 0.012 });

// The sets of inks a sound word and its burst can be lettered in: [the face's top, its foot, the
// extrusion, the burst's outer]. A sport picks one per kind of moment.
export const COMIC_INKS = Object.freeze({
  hot: Object.freeze(['#ffd23a', '#ff8a1c', '#7a1410', '#d8321f']),
  cold: Object.freeze(['#eafcff', '#3cc8f2', '#0b2f6b', '#1b6fd0']),
  dust: Object.freeze(['#fff1bf', '#f2a03a', '#4f260c', '#b4541c']),
});
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ── the faces ─────────────────────────────────────────────────────────────────────────────────────
// The sound words are in Bungee; the captions and the narration are hand lettered, in Permanent
// Marker (client/shared/fonts), with fallbacks that keep the shape.
const HAND = (px) => `${px}px "Permanent Marker", "Comic Sans MS", "Chalkboard SE", cursive`;
const WORD = (px) => `${px}px Bungee, "Arial Black", Impact, sans-serif`;
const FACE_URL = (file) => new URL('../../../shared/fonts/' + file, import.meta.url);
const facesP = {};
/**
 * Loads the hand-lettering face once, and with `word` the sound words' Bungee too (a sport whose HUD
 * hasn't loaded it already). Resolves either way; a painter before it lands falls back.
 */
export function loadComicFaces(doc, { word = false } = {}) {
  const key = word ? 'word' : 'hand';
  if (facesP[key]) return facesP[key];
  if (!doc?.fonts || typeof FontFace === 'undefined') return (facesP[key] = Promise.resolve(false));
  const files = [['Permanent Marker', 'permanent-marker.woff2'], ...(word ? [['Bungee', 'bungee.woff2']] : [])];
  facesP[key] = Promise.all(files.map(([fam, file]) => new FontFace(fam, `url(${FACE_URL(file)})`).load().then((f) => { doc.fonts.add(f); return true; }, () => false)))
    .then((ok) => ok.every(Boolean));
  return facesP[key];
}

// ── the print ─────────────────────────────────────────────────────────────────────────────────────
// A frame of the picture redrawn as a printed comic panel, once a grab: the colour pushed and
// flattened to a few inks, solid black where it's darkest, Ben-Day dots through the deep shadow,
// and a thin ink line along each real edge. Done once per panel, never per frame. `src` is a canvas
// or image; returns a new canvas, or the source untouched if there's no document or its pixels
// can't be read.
//
// CLEAN, NOT NOISY (2026-11-11: the first prints were speckled and their lines thick). The picture
// is smoothed first (`soft`, a box blur of that radius at 720 wide, scaled with the frame) so the
// crowd's and the ice's texture make neither specks of ink nor blotches of colour; the flats are
// flattened from the smoothed colour; and a line is inked only on an edge's crest (the gradient's
// local maximum across it), so it's one pixel wide however soft the step, faded in between `edge`
// and `edgeHi` so a faint step gets a faint line rather than a broken one.
//
// THE MODELS' OWN COLOUR (2026-11-11, Dave: it blew the colours out, and the models are comic
// already). The print barely touches colour now: a light lift, saturation and contrast near 1, and
// the flattening to `levels` inks only `flat` of the way, so a kit stays its kit's colour and the
// shading the cel look gave it stays. It was a gamma of 0.66, saturation 1.35 and six hard levels.
// lift: a gamma under 1 brightens the mid-tones first (a night game is dark); black: below it is
// solid ink; dots: below it the Ben-Day screen starts; flat: how far each channel goes to its level.
export const PRINT = Object.freeze({ levels: 8, flat: 0.35, lift: 0.9, sat: 1.05, contrast: 1.0, black: 0.02, dots: 0.12, cell: 4, edge: 0.4, edgeHi: 0.9, soft: 1, dotInk: 0.78 });
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// a box blur of radius `r` across and then down, into `out` (`tmp` the same size)
function boxBlur(src, out, tmp, w, h, r) {
  if (r < 1) { out.set(src); return; }
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s * k;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s * k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}
export function printPanel(doc, src, o = PRINT) {
  const w = src?.width | 0, h = src?.height | 0;
  if (!doc?.createElement || !(w > 0 && h > 0)) return src;
  const c = doc.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext?.('2d');
  // ⚠ ANY CANVAS THAT CAN'T HAND BACK ITS PIXELS (a tainted one, a context lost, a stub) GIVES THE
  // PLAIN SHOT BACK. This runs inside the grandstand's frame, and a throw there stops the game.
  let im;
  try { g.drawImage(src, 0, 0); im = g.getImageData(0, 0, w, h); } catch { return src; }
  if (!im?.data || im.data.length < w * h * 4) return src;
  const d = im.data, n = w * h, scale = Math.max(w, h * 16 / 9) / 720;
  // lifted first, so the thresholds below are against the brightened picture; then smoothed
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.pow(v / 255, o.lift);
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), tmp = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) { R[i] = lut[d[p]]; G[i] = lut[d[p + 1]]; B[i] = lut[d[p + 2]]; }
  const rad = Math.round((o.soft ?? 1) * scale);
  const Rs = new Float32Array(n), Gs = new Float32Array(n), Bs = new Float32Array(n), L = new Float32Array(n);
  boxBlur(R, Rs, tmp, w, h, rad); boxBlur(G, Gs, tmp, w, h, rad); boxBlur(B, Bs, tmp, w, h, rad);
  for (let i = 0; i < n; i++) L[i] = 0.2126 * Rs[i] + 0.7152 * Gs[i] + 0.0722 * Bs[i];
  // the edges: the Sobel gradient of the smoothed brightness, kept only on its crest
  // (scaled back up by the blur's width, so a step of brightness Δ reads about 4Δ at any size, as
  // it does unblurred: the thresholds are in those units)
  const M = new Float32Array(n), DIR = new Uint8Array(n), mk = rad >= 1 ? (2 * rad + 1) / 2 : 1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      M[i] = Math.hypot(gx, gy) * mk;
      // the gradient's way, to the nearest of four: 0 across, 1 one diagonal, 2 down, 3 the other
      const a = Math.atan2(gy, gx), q4 = Math.round(((a < 0 ? a + Math.PI : a) / Math.PI) * 4) % 4;
      DIR[i] = q4;
    }
  }
  const STEP = [1, w + 1, w, w - 1];
  const q = (v) => Math.round(Math.max(0, Math.min(1, v)) * (o.levels - 1)) / (o.levels - 1);
  // the dot screen keeps its size against the picture, whatever the frame's is (o.cell is at 720 wide)
  const cell = Math.max(3, o.cell * scale), half = cell / 2, hi = o.edgeHi ?? o.edge * 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4, l = L[i];
      if (l < o.black) { d[p] = 18; d[p + 1] = 15; d[p + 2] = 12; continue; }
      // the inks, from the smoothed colour: saturation and contrast pushed, then each channel to a few levels
      let r = Rs[i], gg = Gs[i], b = Bs[i];
      r = l + (r - l) * o.sat; gg = l + (gg - l) * o.sat; b = l + (b - l) * o.sat;
      r = (r - 0.5) * o.contrast + 0.5; gg = (gg - 0.5) * o.contrast + 0.5; b = (b - 0.5) * o.contrast + 0.5;
      const fl = o.flat ?? 1;
      r += (q(r) - r) * fl; gg += (q(gg) - gg) * fl; b += (q(b) - b) * fl;
      // Ben-Day: a dot of ink on a 45° screen, bigger the darker it is, through the deep shadow
      if (l < o.dots) {
        const u = (x + y) * 0.7071, v = (x - y) * 0.7071;
        const du = ((u % cell) + cell) % cell - half, dv = ((v % cell) + cell) % cell - half;
        if (Math.hypot(du, dv) < half * 1.1 * (o.dots - l) / (o.dots - o.black)) { const k = o.dotInk ?? 0.7; r *= k; gg *= k * 0.92; b *= k * 0.85; }
      }
      // the line: on the crest only, faded in with the step's strength
      const m = M[i];
      if (m > o.edge) {
        const s = STEP[DIR[i]];
        if (m >= M[i - s] && m > M[i + s]) {
          const a = smoothstep(o.edge, hi, m);
          r += (0.07 - r) * a; gg += (0.06 - gg) * a; b += (0.05 - b) * a;
        }
      }
      d[p] = r * 255; d[p + 1] = gg * 255; d[p + 2] = b * 255;
    }
  }
  g.putImageData(im, 0, 0);
  return c;
}

// ── the painters ──────────────────────────────────────────────────────────────────────────────────
const INK = '#120f0c', PAPER = '#efe6d2', YELLOW = '#ffd23a', RED = '#d8321f', WHITE = '#fffaf0';
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const ease = (t) => 1 - Math.pow(1 - clamp01(t), 3);
// a little overshoot, for a thing that slaps down
const pop = (t) => { const x = clamp01(t); return x < 0.7 ? ease(x / 0.7) * 1.18 : 1.18 - 0.18 * ease((x - 0.7) / 0.3); };
// a seeded 0..1, so every frame of the freeze draws the same burst and the same lines
const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// Ben-Day dots over the current path (clipped to it) in `colour`, `step` px apart, `r` their radius.
function dots(g, x0, y0, x1, y1, step, r, colour) {
  g.fillStyle = colour;
  for (let y = y0 + step / 2, row = 0; y < y1; y += step, row++) {
    for (let x = x0 + (row % 2) * step / 2; x < x1; x += step) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  }
}

// The explosion balloon: a jagged star round (cx, cy), `R` its reach, built off `seed` so it's the
// same every frame, scaled by `s`. Red with its inside dotted, then orange, then yellow, then a white
// core, each with an ink edge.
function burstPath(g, cx, cy, R, spikes, inner, seed) {
  const r = rnd(seed);
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const rad = i % 2 ? R * inner * (0.85 + r() * 0.3) : R * (0.78 + r() * 0.34);
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}
export function paintBurst(g, cx, cy, R, s = 1, seed = 7, inks = COMIC_INKS.hot) {
  if (!(s > 0.01) || !(R > 1)) return;
  const [top, foot, deep, outer] = inks || COMIC_INKS.hot;
  g.save();
  g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy);
  const lw = Math.max(1.5, R * 0.03);
  // red, its inside dotted darker
  burstPath(g, cx, cy, R, 16, 0.62, seed);
  g.fillStyle = outer; g.fill();
  g.save(); g.clip(); dots(g, cx - R, cy - R, cx + R, cy + R, Math.max(5, R * 0.07), Math.max(1.2, R * 0.022), deep); g.restore();
  g.lineWidth = lw; g.strokeStyle = INK; g.lineJoin = 'miter'; g.stroke();
  // orange, yellow, the white core
  burstPath(g, cx, cy, R * 0.74, 14, 0.66, seed + 1);
  g.fillStyle = foot; g.fill(); g.lineWidth = lw * 0.7; g.stroke();
  burstPath(g, cx, cy, R * 0.5, 12, 0.7, seed + 2);
  g.fillStyle = top; g.fill(); g.lineWidth = lw * 0.6; g.stroke();
  burstPath(g, cx, cy, R * 0.24, 9, 0.68, seed + 3);
  g.fillStyle = WHITE; g.fill();
  g.restore();
}

// Focus lines: tapered ink wedges from past the frame in toward a clear ring round (cx, cy), each
// its own weight and reach, sliding in over `grow` (0..1).
function focusLines(g, w, h, cx, cy, clear, grow, seed) {
  const R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.08, r = rnd(seed);
  g.fillStyle = INK;
  for (let i = 0; i < 110; i++) {
    const a = (i / 110) * Math.PI * 2 + (r() - 0.5) * 0.05;
    const heavy = r() < 0.25, spread = (heavy ? 0.01 : 0.004) + r() * 0.004;
    const inner = clear * (1.05 + r() * 0.75) + (R - clear) * (1 - grow);
    g.beginPath();
    g.moveTo(cx + Math.cos(a - spread) * R, cy + Math.sin(a - spread) * R);
    g.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a + spread) * R, cy + Math.sin(a + spread) * R);
    g.fill();
  }
}

// Motion streaks: a fan of tapered lines trailing (cx, cy) the way it came from, `dir` the way it's
// going on screen (normalised here), `len` their reach.
function streaks(g, cx, cy, dir, len, k, seed) {
  const l = Math.hypot(dir[0], dir[1]);
  if (!(l > 1e-6)) return;
  const ux = dir[0] / l, uy = dir[1] / l, nx = -uy, ny = ux, r = rnd(seed);
  g.fillStyle = INK;
  for (let i = 0; i < 13; i++) {
    const off = (i / 12 - 0.5) * len * 0.42 + (r() - 0.5) * 6 * k, back = len * (0.55 + r() * 0.45), start = len * 0.12 + r() * 10 * k;
    const sx = cx - ux * start + nx * off, sy = cy - uy * start + ny * off, wd = (0.8 + r() * 1.4) * k;
    g.beginPath();
    g.moveTo(sx + nx * wd, sy + ny * wd);
    g.lineTo(sx - ux * back, sy - uy * back);
    g.lineTo(sx - nx * wd, sy - ny * wd);
    g.fill();
  }
}

/**
 * A sound word, hand lettered: each letter its own tilt and a little bigger than the one before, on
 * a slight arc, with a deep red extrusion behind it, a thick ink outline and a yellow-to-orange
 * face. The letters land one after another `t` seconds in (COMIC.letter apart), each slapping down.
 * `size` px at the first letter, centred on (x, y), turned `rot`. A `t` of Infinity draws it whole.
 */
export function paintWord(g, word, x, y, size, t = Infinity, rot = -0.12, seed = 3, inks = COMIC_INKS.hot) {
  const letters = [...String(word)];
  if (!letters.length || !(size > 1)) return;
  const [top, foot, deep] = inks || COMIC_INKS.hot;
  const r = rnd(seed + hashStr(word));
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.font = WORD(Math.round(size));
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  // each letter's size, tilt, rise and advance, then the whole fitted to four fifths of the picture
  const L = letters.map((ch, i) => {
    const sc = 0.86 + 0.4 * (letters.length > 1 ? i / (letters.length - 1) : 1);
    const adv = ((g.measureText?.(ch)?.width) || size * 0.8) * sc * 0.92;
    return { ch, sc, adv, tilt: (r() - 0.5) * 0.32, rise: (r() - 0.5) * size * 0.14 - Math.sin((i + 0.5) / letters.length * Math.PI) * size * 0.16 };
  });
  const total = L.reduce((s, l) => s + l.adv, 0), cap = (g.canvas?.width || size * 12) * 0.82;
  const fit = total > cap ? cap / total : 1;
  g.scale(fit, fit);
  let cx = -total / 2;
  const ext = Math.max(3, Math.round(size * 0.1)), ow = size * 0.14;
  // three passes over the letters, so no letter's outline sits over its neighbour's face
  const placed = L.map((l, i) => { const at = cx + l.adv / 2; cx += l.adv; return { ...l, at, s: Number.isFinite(t) ? pop((t - i * COMIC.letter) / 0.16) : 1 }; });
  const each = (fn) => { for (const l of placed) { if (!(l.s > 0.01)) continue; g.save(); g.translate(l.at, l.rise); g.rotate(l.tilt); g.scale(l.sc * l.s, l.sc * l.s); fn(l); g.restore(); } };
  // the extrusion, down and to the right, deep red with an ink edge
  each((l) => {
    g.fillStyle = deep; g.strokeStyle = INK; g.lineWidth = ow * 0.9;
    for (let k = ext; k >= 1; k--) { g.strokeText(l.ch, k, k); }
    for (let k = ext; k >= 1; k--) { g.fillText(l.ch, k, k); }
  });
  // the outline
  each((l) => { g.lineWidth = ow; g.strokeStyle = INK; g.strokeText(l.ch, 0, 0); });
  // the face: yellow at the top to orange at the foot, and a white glint along the top
  each((l) => {
    const gr = g.createLinearGradient?.(0, -size * 0.45, 0, size * 0.45);
    if (gr) { gr.addColorStop(0, top); gr.addColorStop(0.55, top); gr.addColorStop(1, foot); g.fillStyle = gr; } else g.fillStyle = top;
    g.fillText(l.ch, 0, 0);
    g.lineWidth = Math.max(1, size * 0.03); g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.strokeText(l.ch, -size * 0.02, -size * 0.03);
  });
  g.restore();
}

/**
 * Where the freeze puts things in a `w` by `h` picture, the ball on screen at (cx, cy) and `subject`
 * the player at it ({ x, y, r }, a circle round him in px; the ball's own neighbourhood if not
 * given). The focus lines close in on him and stop short of him; the burst goes on the far side of
 * the ball from him, so it marks the contact without covering the bat or the glove; and the word
 * takes whichever corner is furthest from both. Returns { fc: [x, y], clear, burst: { x, y, R },
 * word: { x, y, rot } }.
 */
export function freezeLayout(w, h, cx, cy, subject = null, dir = null) {
  const short = Math.min(w, h);
  const S = subject && [subject.x, subject.y, subject.r].every(Number.isFinite) && subject.r > 0 ? subject : { x: cx, y: cy, r: short * 0.12 };
  const R = short * 0.15;
  // the way out from him through the ball: his own side of it if he's off it, else the way the ball's
  // going, else up and away from the nearer side of the frame
  let ux = cx - S.x, uy = cy - S.y, ul = Math.hypot(ux, uy);
  if (ul < S.r * 0.15) {
    if (dir && Math.hypot(dir[0], dir[1]) > 1e-6) { ux = dir[0]; uy = dir[1]; } else { ux = cx < w / 2 ? 1 : -1; uy = -0.7; }
    ul = Math.hypot(ux, uy);
  }
  ux /= ul; uy /= ul;
  const bx = Math.max(R * 0.6, Math.min(w - R * 0.6, cx + ux * R * 0.85)), by = Math.max(R * 0.6, Math.min(h - R * 0.6, cy + uy * R * 0.85));
  const clear = Math.max(short * 0.17, S.r * 1.12, Math.hypot(cx - S.x, cy - S.y) + short * 0.04);
  // the word: the corner furthest from him and from the burst, the top preferred
  const size = short * 0.15, hw = Math.min(w * 0.41, size * 2.6), hh = size * 0.75;
  const away = (x, y, c) => {
    const dx = Math.max(Math.abs(c.x - x) - hw, 0), dy = Math.max(Math.abs(c.y - y) - hh, 0);
    return Math.hypot(dx, dy) - c.r;
  };
  let best = null;
  for (const [fx, fy] of [[0.28, 0.17], [0.72, 0.17], [0.28, 0.83], [0.72, 0.83]]) {
    const x = Math.max(hw, Math.min(w - hw, w * fx)), y = Math.max(hh, Math.min(h - hh, h * fy));
    const score = Math.min(away(x, y, S), away(x, y, { x: bx, y: by, r: R })) + (fy < 0.5 ? short * 0.05 : 0);
    if (!best || score > best.score) best = { x, y, score };
  }
  return { fc: [S.x, S.y], clear, burst: { x: bx, y: by, R }, word: { x: best.x, y: best.y, rot: best.x < w / 2 ? -0.1 : -0.15 } };
}

/**
 * The freeze over the held picture, `t` seconds into it, `w` by `h` px, the moment on screen at
 * (cx, cy) (the middle if it's off screen). `o`:
 *   print  the held frame as a printed panel (printPanel), drawn under everything, shaking;
 *   dir      which way the ball's going on screen, for its motion streaks;
 *   subject  the player at the ball, { x, y, r } in px, kept clear (freezeLayout);
 *   seed     so the burst and the lines are the play's own;
 *   inks     the kind's inks (comicInksOf), for the burst and the word.
 * Under the burst: a white flash, then a negative frame; the picture shaking; focus lines in to a
 * clear ring round the player; the explosion balloon popping out beside the ball; the streaks behind
 * it; a dot screen darkening the corners; and the word, letter by letter, in the clearest corner.
 */
export function paintFreeze(g, w, h, cx, cy, word, t, o = {}) {
  const k = Math.min(w, h) / 600, short = Math.min(w, h), seed = o.seed ?? 11;
  if (!(cx >= 0 && cx <= w && cy >= 0 && cy <= h)) { cx = w / 2; cy = h / 2; }
  // the shake: hard at the hit, gone by COMIC.shake
  const sh = t < COMIC.shake ? (1 - t / COMIC.shake) * short * COMIC.shakeBy : 0;
  const jx = sh * Math.sin(t * 97), jy = sh * Math.cos(t * 131);
  g.save();
  g.translate(jx, jy);
  // the held frame, printed, a little over-size so the shake never shows an edge
  if (o.print && o.print.width) {
    const s = Math.max(w / o.print.width, h / o.print.height) * 1.03;
    g.drawImage(o.print, (w - o.print.width * s) / 2, (h - o.print.height * s) / 2, o.print.width * s, o.print.height * s);
  }
  // the dot screen in the corners, over the picture
  g.save();
  g.globalAlpha = 0.5 * ease(t / 0.2);
  const F = freezeLayout(w, h, cx, cy, o.subject, o.dir), [fx, fy] = F.fc;
  const R = Math.hypot(Math.max(fx, w - fx), Math.max(fy, h - fy)), step = Math.max(7, 11 * k);
  g.fillStyle = INK;
  for (let y = step / 2, row = 0; y < h; y += step, row++) {
    for (let x = step / 2 + (row % 2) * step / 2; x < w; x += step) {
      const rr = clamp01((Math.hypot(x - fx, y - fy) / R - 0.55) / 0.45) * step * 0.5;
      if (rr > 0.5) { g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); }
    }
  }
  g.restore();
  focusLines(g, w, h, fx, fy, F.clear, ease(t / 0.15), seed);
  if (o.dir) streaks(g, cx, cy, o.dir, short * 0.42, k, seed + 5);
  // the balloon, beside the ball on the far side from the player
  paintBurst(g, F.burst.x, F.burst.y, F.burst.R, pop(t / COMIC.pop), seed + 9, o.inks);
  g.restore();
  // the flash, then the negative
  if (t < COMIC.flash) { g.fillStyle = `rgba(255,255,255,${0.9 * (1 - t / COMIC.flash)})`; g.fillRect(0, 0, w, h); }
  else if (t < COMIC.flash + COMIC.negative) {
    g.save(); g.globalCompositeOperation = 'difference'; g.fillStyle = WHITE; g.fillRect(0, 0, w, h); g.restore();
  }
  // the word, in the corner clearest of the player and the burst, landing as the burst does
  paintWord(g, word, F.word.x + jx, F.word.y + jy, short * 0.15, t - 0.03, F.word.rot, seed, o.inks);
}

// Where the page's three panels go in a `w` by `h` picture: the moment big on the left, the run-up
// above the follow-through on the right, each a little turned, with a gutter between. `flip` puts
// the moment on the right and the two small panels on the left, so two pages running aren't one page.
export function pageLayout(w, h, flip = false) {
  const m = Math.min(w, h) * 0.05, gut = Math.min(w, h) * 0.03, cap = Math.min(w, h) * 0.12;
  const top = m + cap, bh = h - top - m, lw = (w - 2 * m - gut) * 0.6, rw = w - 2 * m - gut - lw, rh = (bh - gut) / 2;
  const bigX = flip ? m + rw + gut : m, smallX = flip ? m : m + lw + gut, k = flip ? -1 : 1;
  return {
    margin: m, caption: { x: m, y: m * 0.6, h: cap },
    panels: [
      { x: smallX, y: top, w: rw, h: rh, rot: 0.025 * k },           // the run-up
      { x: bigX, y: top, w: lw, h: bh, rot: -0.018 * k },             // the moment
      { x: smallX, y: top + rh + gut, w: rw, h: rh, rot: -0.03 * k }, // what followed
    ],
  };
}

// Whether a narration says more than the headline: not the same words again (a bare "Home Run"
// under HOME RUN!), and at least four words of its own.
const lettersOf = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export function tellsMore(desc, headline) {
  const d = lettersOf(desc), hd = lettersOf(headline);
  return d.split(' ').filter(Boolean).length >= 4 && d !== hd && !hd.includes(d);
}
// `text` broken into lines no wider than `maxW` px in the current font (a word too long for a line
// gets one to itself).
function wrap(g, text, maxW, size) {
  const width = (s) => g.measureText?.(s)?.width || size * s.length * 0.6;
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word;
    if (line && width(next) > maxW) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}
// A caption box in a panel's corner: hand lettered on yellow with an ink edge and a hard shadow.
function caption(g, text, x, y, size, maxW, k, alignRight = false) {
  if (!text) return;
  g.save();
  // measured again after every shrink: a font's width doesn't scale exactly with its rounded size
  const boxOf = (sz) => { g.font = HAND(Math.round(sz)); return (g.measureText?.(text)?.width || sz * text.length * 0.6) + sz * 0.8; };
  let tw = boxOf(size);
  for (let n = 0; n < 4 && tw > maxW; n++) { size *= maxW / tw * 0.97; tw = boxOf(size); }
  const bh = size * 1.5, bx = alignRight ? x - tw : x;
  g.fillStyle = INK; g.fillRect(bx + 3 * k, y + 3 * k, tw, bh);
  g.fillStyle = YELLOW; g.fillRect(bx, y, tw, bh);
  g.lineWidth = Math.max(1, 1.8 * k); g.strokeStyle = INK; g.strokeRect(bx, y, tw, bh);
  g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, bx + size * 0.4, y + bh / 2 + size * 0.05);
  g.restore();
}

/**
 * The page, `t` seconds into it: paper, the three panels (`shots`, canvases or null for a blank)
 * coming in one after another, the moment's burst and word breaking out of its frame, a caption in
 * each small panel, and the play told in a narration box. `o`:
 *   desc      the play in a sentence, for the narration box;
 *   captions  the two small panels' captions [run-up, what followed];
 *   at        where the moment is in its shot, as fractions [u, v];
 *   subject   the player at it in the shot, { x, y, r } as fractions of its height (freezeLayout:
 *             the burst goes beside the ball, clear of him);
 *   seed      as the freeze's;
 *   inks      the kind's inks (comicInksOf);
 *   flip      the moment's panel on the right (pageLayout);
 *   issue     the masthead's number, top right (the inning, say); none without it;
 *   masthead  the comic's name over that number (DEADBALL COMICS).
 * `words` is the headline across the top (HOME RUN!).
 */
export function paintPage(g, w, h, shots, word, words, t, o = {}) {
  const L = pageLayout(w, h, !!o.flip), k = Math.min(w, h) / 600, seed = o.seed ?? 11;
  g.save();
  paper(g, w, h, k, t);
  // the panels in reading order: the moment first, as the page's hit, then the two either side of it
  const capts = o.captions || [];
  [1, 0, 2].forEach((i, n) => {
    const P = L.panels[i], a = ease((t - 0.12 - n * 0.22) / 0.3);
    if (a <= 0) return;
    g.save();
    g.translate(P.x + P.w / 2, P.y + P.h / 2); g.rotate(P.rot * a); g.scale(0.85 + 0.15 * a, 0.85 + 0.15 * a);
    g.globalAlpha = a;
    // a hard drop shadow, then the frame
    g.fillStyle = INK; g.fillRect(-P.w / 2 + 7 * k, -P.h / 2 + 7 * k, P.w, P.h);
    g.save(); g.beginPath(); g.rect(-P.w / 2, -P.h / 2, P.w, P.h); g.clip();
    const img = shots[i];
    let sc = 1, ox = 0, oy = 0;
    if (img && img.width) {
      // the shot to cover the panel, cropped from its middle
      sc = Math.max(P.w / img.width, P.h / img.height); ox = -img.width * sc / 2; oy = -img.height * sc / 2;
      g.drawImage(img, ox, oy, img.width * sc, img.height * sc);
    } else { g.fillStyle = '#2a2622'; g.fillRect(-P.w / 2, -P.h / 2, P.w, P.h); }
    // the moment's panel: its burst on the ball, under the frame
    if (i === 1 && img && img.width && Array.isArray(o.at)) {
      const W2 = img.width * sc, H2 = img.height * sc, S = o.subject;
      const F = freezeLayout(W2, H2, o.at[0] * W2, o.at[1] * H2, S ? { x: S.x * W2, y: S.y * H2, r: S.r * H2 } : null, o.dir);
      paintBurst(g, ox + F.burst.x, oy + F.burst.y, Math.min(F.burst.R, Math.min(P.w, P.h) * 0.16), pop((t - 0.2) / COMIC.pop), seed + 9, o.inks);
    }
    g.restore();
    g.lineWidth = Math.max(2, 3.5 * k); g.strokeStyle = INK; g.strokeRect(-P.w / 2, -P.h / 2, P.w, P.h);
    // the narration in the moment's panel, bottom left: the play in a sentence, up to two lines,
    // and none when it would only say the headline again
    if (i === 1 && o.desc && a > 0.6 && tellsMore(o.desc, words)) {
      const text = String(o.desc).toUpperCase();
      // as big as fits in two lines, down to a floor, and then three
      let size = Math.max(10, Math.min(P.w, P.h) * 0.055), lines;
      for (;;) {
        g.font = HAND(Math.round(size));
        lines = wrap(g, text, P.w * 0.78 - size * 0.8, size);
        if (lines.length <= 2 || size <= Math.max(9, Math.min(P.w, P.h) * 0.036)) break;
        size *= 0.9;
      }
      lines = lines.slice(0, 3);
      lines.forEach((ln, j) => caption(g, ln, -P.w / 2 + 6 * k, P.h / 2 - (lines.length - j) * size * 1.5 - 6 * k, size, P.w * 0.84, k));
    }
    // the small panels' captions: the run-up's top left, what followed's bottom right
    if (i !== 1 && a > 0.6) {
      const c = capts[i === 0 ? 0 : 1], size = Math.max(10, Math.min(P.w, P.h) * 0.085);
      if (i === 0) caption(g, c, -P.w / 2 + 6 * k, -P.h / 2 + 6 * k, size, P.w * 0.9, k);
      else caption(g, c, P.w / 2 - 6 * k, P.h / 2 - size * 1.5 - 6 * k, size, P.w * 0.9, k, true);
    }
    g.restore();
  });
  // the word over the moment, breaking out of its frame once its panel's down
  const M = L.panels[1];
  paintWord(g, word, M.x + M.w * 0.6, M.y + M.h * 0.22, Math.min(M.w, M.h) * 0.2, t - 0.3, -0.14, seed, o.inks);
  masthead(g, L, w, k, t - 0.7, o);
  headline(g, L, k, t - 0.55, words);
  g.restore();
}

// The page's paper, fading in over its first 0.15 s: a faint dot screen and a yellowed edge.
function paper(g, w, h, k, t) {
  g.globalAlpha = ease(t / 0.15);
  g.fillStyle = PAPER; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(120,90,50,0.08)';
  const st = Math.max(6, 9 * k);
  for (let y = 0; y < h; y += st) for (let x = ((y / st) % 2) * st / 2; x < w; x += st) g.fillRect(x, y, 1.5 * k, 1.5 * k);
  const edge = g.createRadialGradient?.(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  if (edge) { edge.addColorStop(0, 'rgba(150,110,40,0)'); edge.addColorStop(1, 'rgba(150,110,40,0.28)'); g.fillStyle = edge; g.fillRect(0, 0, w, h); }
  g.globalAlpha = 1;
}
// The masthead, top right: the comic's name and its number, as a cover's corner box has them.
// `t` is seconds since it started to come in; none without `o.issue`.
function masthead(g, L, w, k, t, o) {
  const a = ease(t / 0.25);
  if (o.issue == null || !(a > 0)) return;
  const C = L.caption, bh = C.h * 0.86, size = bh * 0.3, text = String(o.masthead || 'COMICS').toUpperCase(), no = `No. ${o.issue}`;
  g.save(); g.globalAlpha = a;
  g.font = HAND(Math.round(size));
  const bw = Math.max(g.measureText?.(text)?.width || size * text.length * 0.6, size * 4) + size, x = w - L.margin - bw, y = C.y + (C.h - bh) / 2;
  g.fillStyle = INK; g.fillRect(x + 3 * k, y + 3 * k, bw, bh);
  g.fillStyle = WHITE; g.fillRect(x, y, bw, bh);
  g.lineWidth = Math.max(1, 2 * k); g.strokeStyle = INK; g.strokeRect(x, y, bw, bh);
  g.fillStyle = RED; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x + bw / 2, y + bh * 0.32);
  g.fillStyle = INK; g.fillText(no, x + bw / 2, y + bh * 0.72);
  g.restore();
}
// The headline, upper left, in the sound words' face. `t` is seconds since it started to come in.
function headline(g, L, k, t, words) {
  const a = ease(t / 0.25);
  if (!words || !(a > 0)) return;
  const C = L.caption, size = C.h * 0.6;
  g.save(); g.globalAlpha = a;
  g.font = WORD(Math.round(size));
  const tw = (g.measureText?.(words)?.width || size * words.length * 0.8) + size;
  g.fillStyle = INK; g.fillRect(C.x + 4 * k, C.y + 4 * k, tw, C.h);
  g.fillStyle = YELLOW; g.fillRect(C.x, C.y, tw, C.h);
  g.lineWidth = Math.max(1.5, 2.5 * k); g.strokeStyle = INK; g.strokeRect(C.x, C.y, tw, C.h);
  g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(words, C.x + size / 2, C.y + C.h / 2);
  g.restore();
}
// The narration: `text` in a stack of caption boxes as big as fits two lines across `maxW`, down to
// a floor and then three, from (x, y) down, or up from y with `fromFoot`.
function narrate(g, text, x, y, maxW, short, k, fromFoot = false) {
  let size = Math.max(10, short * 0.055), lines;
  for (;;) {
    g.font = HAND(Math.round(size));
    lines = wrap(g, text, maxW - size * 0.8, size);
    if (lines.length <= 2 || size <= Math.max(9, short * 0.036)) break;
    size *= 0.9;
  }
  lines = lines.slice(0, 3);
  lines.forEach((ln, j) => caption(g, ln, x, fromFoot ? y - (lines.length - j) * size * 1.5 : y + j * size * 1.5, size, maxW * 1.08, k));
}

/**
 * The story page's panels in a `w` by `h` picture: the action big on the right, and down the left,
 * small, just before it and just after it. In order: [before, top left; after, below it; the action,
 * big on the right]. Each a little turned, with a gutter between.
 */
export function storyLayout(w, h) {
  const m = Math.min(w, h) * 0.05, gut = Math.min(w, h) * 0.03, cap = Math.min(w, h) * 0.12;
  const top = m + cap, bh = h - top - m, lw = (w - 2 * m - gut) * 0.38, rw = w - 2 * m - gut - lw, rh = (bh - gut) / 2;
  return {
    margin: m, caption: { x: m, y: m * 0.6, h: cap },
    panels: [
      { x: m, y: top, w: lw, h: rh, rot: -0.03 },                 // before
      { x: m, y: top + rh + gut, w: lw, h: rh, rot: 0.025 },      // after
      { x: m + lw + gut, y: top, w: rw, h: bh, rot: -0.015 },     // the action
    ],
  };
}

/**
 * The page as a story, `t` seconds into it: the action big on the right, with the burst on its
 * moment, the play told in a narration box along whichever edge the burst isn't near, and the sound
 * word breaking out of its frame in the corner clearest of the man, the burst and the narration;
 * and down the left, small, just before it (its caption at its top) and just after it (its caption
 * at its foot). They come in in the order they happened: before, the action, after. `frames` are
 * canvases (or null for a blank) in storyLayout's order [before, after, the action], `word` the
 * sound, `words` the headline. `o`:
 *   desc      the play in a sentence, for the narration box;
 *   captions  [before's, after's];
 *   at        where the moment is in the action's shot, as fractions [u, v];
 *   subject   the man at it in that shot, { x, y, r } as fractions of its height (freezeLayout);
 *   dir       which way it's going on screen, for the burst's side;
 *   seed, inks, issue, masthead  as paintPage's.
 */
export function paintStory(g, w, h, frames, word, words, t, o = {}) {
  const L = storyLayout(w, h), k = Math.min(w, h) / 600, seed = o.seed ?? 11, capts = o.captions || [];
  const ORDER = [0, 2, 1];
  g.save();
  paper(g, w, h, k, t);
  let wordAt = null;
  ORDER.forEach((i, n) => {
    const P = L.panels[i], a = ease((t - 0.12 - n * 0.3) / 0.3);
    if (a <= 0) return;
    g.save();
    g.translate(P.x + P.w / 2, P.y + P.h / 2); g.rotate(P.rot * a); g.scale(0.85 + 0.15 * a, 0.85 + 0.15 * a);
    g.globalAlpha = a;
    g.fillStyle = INK; g.fillRect(-P.w / 2 + 7 * k, -P.h / 2 + 7 * k, P.w, P.h);
    g.save(); g.beginPath(); g.rect(-P.w / 2, -P.h / 2, P.w, P.h); g.clip();
    const img = frames[i];
    let sc = 1, ox = 0, oy = 0;
    if (img && img.width) {
      sc = Math.max(P.w / img.width, P.h / img.height); ox = -img.width * sc / 2; oy = -img.height * sc / 2;
      g.drawImage(img, ox, oy, img.width * sc, img.height * sc);
    } else { g.fillStyle = '#2a2622'; g.fillRect(-P.w / 2, -P.h / 2, P.w, P.h); }
    // the action: its burst on the moment, under the frame; the narration's edge; the word's corner
    let narrTop = true;
    if (i === 2 && img && img.width && Array.isArray(o.at)) {
      const W2 = img.width * sc, H2 = img.height * sc, S = o.subject;
      const sub = S ? { x: S.x * W2, y: S.y * H2, r: S.r * H2 } : null;
      const F = freezeLayout(W2, H2, o.at[0] * W2, o.at[1] * H2, sub, o.dir), bR = Math.min(F.burst.R, Math.min(P.w, P.h) * 0.18);
      const bx = ox + F.burst.x, by = oy + F.burst.y;
      paintBurst(g, bx, by, bR, pop((t - 0.5) / COMIC.pop), seed + 9, o.inks);
      // (the narration away from the burst: it once covered a puck at a skater's feet)
      narrTop = by > 0;
      const man = sub ? { x: ox + sub.x, y: oy + sub.y, r: sub.r } : { x: ox + o.at[0] * W2, y: oy + o.at[1] * H2, r: Math.min(P.w, P.h) * 0.15 };
      let best = null;
      for (const [fx, fy] of [[0.3, 0.2], [0.74, 0.2], [0.3, 0.8], [0.74, 0.8]]) {
        // (not the narration's corner)
        if (fx < 0.5 && (fy < 0.5) === narrTop) continue;
        const x = (fx - 0.5) * P.w, y = (fy - 0.5) * P.h;
        const s = Math.min(Math.hypot(x - man.x, y - man.y) - man.r, Math.hypot(x - bx, y - by) - bR) + (fy < 0.5 ? Math.min(P.w, P.h) * 0.05 : 0);
        if (!best || s > best.s) best = { x, y, s };
      }
      wordAt = [P.x + P.w / 2 + best.x, P.y + P.h / 2 + best.y];
    }
    g.restore();
    g.lineWidth = Math.max(2, 3.5 * k); g.strokeStyle = INK; g.strokeRect(-P.w / 2, -P.h / 2, P.w, P.h);
    if (a > 0.6) {
      const size = Math.max(10, Math.min(P.w, P.h) * 0.085);
      if (i === 0) caption(g, capts[0], -P.w / 2 + 6 * k, -P.h / 2 + 6 * k, size, P.w * 0.9, k);
      if (i === 1) caption(g, capts[1], P.w / 2 - 6 * k, P.h / 2 - size * 1.5 - 6 * k, size, P.w * 0.9, k, true);
      // the play told, unless that only says the headline again
      if (i === 2 && o.desc && tellsMore(o.desc, words)) {
        // (no wider than the panel's left half and a bit, so the word has the other corner)
        narrate(g, String(o.desc).toUpperCase(), -P.w / 2 + 6 * k, narrTop ? -P.h / 2 + 6 * k : P.h / 2 - 6 * k, P.w * 0.52, Math.min(P.w, P.h), k, !narrTop);
      }
    }
    g.restore();
  });
  // the sound word, breaking out of the action's frame once it's down
  const A = L.panels[2], ws = Math.min(A.w, A.h) * 0.19;
  if (wordAt) paintWord(g, word, wordAt[0], wordAt[1], ws, t - 0.6, wordAt[0] < A.x + A.w / 2 ? -0.1 : -0.14, seed, o.inks);
  else paintWord(g, word, A.x + A.w * 0.6, A.y + A.h * 0.2, ws, t - 0.6, -0.12, seed, o.inks);
  masthead(g, L, w, k, t - 1.0, o);
  headline(g, L, k, t - 0.85, words);
  g.restore();
}

/**
 * The slow-motion beats' frame, over the moving picture: a dot screen darkening the corners and an
 * ink border with the "SLOW MO" tag, so the replay reads as a comic before it freezes. Cheap enough
 * for every frame: no per-pixel work. `t` is seconds into the beat, `beat` 0 the run, 1 what follows.
 * `o.note`: a narration box along the foot of the run (the inning and the outs, say); `o.lines`
 * false leaves the speed lines out.
 */
export function paintRun(g, w, h, t, beat = 0, o = {}) {
  const k = Math.min(w, h) / 600, a = ease(t / 0.3);
  if (!(a > 0)) return;
  g.save();
  // speed lines in from the edges toward the middle, drawn afresh eight times a second so they
  // flicker the way a page of them reads, and kept out of the middle of the picture
  if (o.lines !== false) {
    const r = rnd(1009 + Math.floor(t * 8) * 31 + beat * 7), cx0 = w / 2, cy0 = h / 2, R0 = Math.hypot(cx0, cy0) * 1.05;
    g.globalAlpha = 0.7 * a;
    g.fillStyle = INK;
    for (let i = 0; i < 60; i++) {
      const an = r() * Math.PI * 2, spread = 0.003 + r() * 0.005, inner = R0 * (0.5 + r() * 0.3);
      g.beginPath();
      g.moveTo(cx0 + Math.cos(an - spread) * R0, cy0 + Math.sin(an - spread) * R0);
      g.lineTo(cx0 + Math.cos(an) * inner, cy0 + Math.sin(an) * inner);
      g.lineTo(cx0 + Math.cos(an + spread) * R0, cy0 + Math.sin(an + spread) * R0);
      g.fill();
    }
  }
  g.globalAlpha = 0.22 * a;
  const step = Math.max(8, 12 * k), cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  g.fillStyle = INK;
  for (let y = step / 2, row = 0; y < h; y += step, row++) {
    for (let x = step / 2 + (row % 2) * step / 2; x < w; x += step) {
      const rr = clamp01((Math.hypot(x - cx, y - cy) / R - 0.62) / 0.38) * step * 0.5;
      if (rr > 0.5) { g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); }
    }
  }
  g.globalAlpha = a;
  const bw = Math.max(2, 3.5 * k);
  g.lineWidth = bw; g.strokeStyle = INK; g.strokeRect(bw / 2, bw / 2, w - bw, h - bw);
  const size = Math.max(12, 22 * k);
  caption(g, beat ? 'AND THEN...' : 'SLOW MO', beat ? w - bw - 10 * k : bw + 10 * k, bw + 10 * k, size, w * 0.4, k, !!beat);
  if (o.note && !beat) caption(g, String(o.note).toUpperCase(), bw + 10 * k, h - bw - 10 * k - size * 1.2, size * 0.8, w * 0.6, k);
  g.restore();
}
