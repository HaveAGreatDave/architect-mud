// DEADBALL · THE COMIC REPLAY. With the comic look on (gl/house-style.js comicOn), a big play's
// replay (diamond/replay.js) plays as a comic would draw it (docs/proposals/comic-ink.md, comic
// replays):
//
//   1. run    the play in slow motion up to its moment, from down on the grass looking up at it
//             (wormShot), the picture leaning one way and graded like ink on newsprint;
//   2. freeze the moment held, redrawn as a printed panel (printPanel): an impact flash and a
//             negative frame, the picture shaking, focus lines in to an explosion balloon round the
//             ball, motion streaks behind it, and its sound hand-lettered over it, letter by letter;
//   3. after  the rest in slow motion from the replay's own second camera, leaning the other way;
//   4. page   the three beats as a printed comic page: the moment big, with its burst and its word,
//             the run-up and what followed beside it, each panel captioned, and the play told in a
//             narration box, then back to the live game.
//
// The live game is never held: the replay plays in its own world, as every replay does, and the
// grandstand gives it a longer slot (comicLength) before the next payload. The camera never rolls
// (diamond/camera.js), so the lean is the picture's: the grandstand tilts its canvas (COMIC.tilt).
// With reduced motion a replay is a still, as ever, and none of this happens.
//
// The painters draw on a 2D context the grandstand lays over the picture, in its pixels.
// printPanel and loadComicFaces need a document; nothing else here touches the DOM, and every
// painter draws without one (the gate's counting context).

import { REPLAY } from './replay.js';
import { onField } from './play.js';
import { HUD_FACES } from './hud.js';

// freeze, page: how long each holds (s of the game's clock); tilt: the picture's lean (degrees);
// zoom: how much the leaning picture is enlarged so its corners stay off the screen; flash: the
// white of the impact (s); negative: the inverted frame after it (s); pop: how long the burst takes
// to land (s); letter: how far apart the sound's letters land (s); shake: how long the picture
// shakes (s) and by how much of its short side.
export const COMIC = Object.freeze({ freeze: 1.4, page: 2.8, tilt: 6, zoom: 1.14, flash: 0.04, negative: 0.07, pop: 0.18, letter: 0.045, shake: 0.28, shakeBy: 0.012 });

// The sound of each kind of replay's moment, a few to choose between so a run of home runs doesn't
// say the same thing every time.
export const COMIC_WORDS = Object.freeze({
  homerun: ['KRAKK!', 'CRACK!', 'KA-BLAM!', 'THWOCK!', 'KA-POW!', 'BLAMMO!'], walkoff: ['KA-BOOM!', 'KRAKK!', 'CRACK!', 'BA-DOOM!'],
  catch: ['THWAP!', 'SNAG!', 'WHUMP!', 'FWUMP!', 'SNATCH!'], robbed: ['YOINK!', 'DENIED!', 'SNAG!', 'NOPE!'],
  doubleplay: ['SNAP!', 'ZIP-ZIP!', 'POP-POP!'], tripleplay: ['SNAP-SNAP!', 'ZIP-ZIP-ZIP!'],
  triple: ['FWOOSH!', 'ZOOOM!', 'VROOSH!'], close: ['BANG-BANG!', 'WHAM!', 'THUD!'],
  plate: ['SKRRSH!', 'WHUMP!', 'KA-THUD!'], caught: ['SLAP!', 'GOTCHA!', 'THWAP!'], steal: ['ZIP!', 'SKRRT!', 'FWISH!'],
  strikeout: ['WHIFF!', 'SWOOSH!', 'POP!'],
});
// What the page's two small panels say, the run-up's and what followed's, by kind.
export const COMIC_CAPTIONS = Object.freeze({
  homerun: ['THE PITCH...', '...AND IT\'S OUTTA HERE!'], walkoff: ['IT ALL COMES DOWN TO THIS...', '...BALLGAME!'],
  catch: ['HE\'S GOING BACK...', '...HE GOT IT!'], doubleplay: ['TWO ON THE BAGS...', '...TURNED TWO!'],
  tripleplay: ['NOBODY BELIEVES IT...', '...ALL THREE OF THEM!'], triple: ['HE\'S NOT STOPPING...', '...IN STANDING UP!'],
  close: ['DOWN THE LINE...', '...AND THE CALL IS IN!'],
  robbed: ['THAT ONE\'S GOING...', '...NOT TODAY!'], plate: ['THEY\'RE SENDING HIM...', '...AT THE PLATE!'],
  caught: ['HE\'S GOING...', '...AND HE\'S GONE!'], steal: ['HE\'S GOING...', '...UNDER THE TAG!'],
  strikeout: ['TWO STRIKES...', '...SIT DOWN!'],
});
// The page's headline for the kinds the HUD has no words for (hud.js HUD_THEME.words has the rest).
export const COMIC_HEADLINES = Object.freeze({
  catch: 'WHAT A CATCH!', robbed: 'ROBBED!', plate: 'PLAY AT THE PLATE!', close: 'BANG-BANG PLAY!',
  caught: 'CAUGHT STEALING!', steal: 'STOLEN BASE!', strikeout: 'STRIKE THREE!', triple: 'TRIPLE!',
});
/** The headline for a replay of `kind` of the play `p`: a grand slam says so. Null where the HUD's own words do. */
export function comicHeadlineOf(kind, p = null) {
  if (p?.kind === 'homerun' && (p.rbi | 0) >= 4) return p.walkoff ? 'WALK-OFF GRAND SLAM!' : 'GRAND SLAM!';
  return COMIC_HEADLINES[kind] || null;
}
// The inks a kind is lettered and burst in: [the face's top, its foot, the extrusion, the burst's
// outer]. Off the bat it's the hot set; into a glove, the cold; in the dirt at a bag, the dust.
export const COMIC_INKS = Object.freeze({
  hot: Object.freeze(['#ffd23a', '#ff8a1c', '#7a1410', '#d8321f']),
  cold: Object.freeze(['#eafcff', '#3cc8f2', '#0b2f6b', '#1b6fd0']),
  dust: Object.freeze(['#fff1bf', '#f2a03a', '#4f260c', '#b4541c']),
});
const INK_OF = { catch: 'cold', robbed: 'cold', strikeout: 'cold', close: 'dust', plate: 'dust', caught: 'dust', steal: 'dust', triple: 'dust', doubleplay: 'dust', tripleplay: 'dust' };
/** The inks for a replay of `kind` (COMIC_INKS). */
export const comicInksOf = (kind) => COMIC_INKS[INK_OF[kind] || 'hot'];
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/** The sound for a replay of `kind`, picked off `seed` (the play's words, say), so it's the same every time. */
export function comicWordOf(kind, seed = '') {
  const list = COMIC_WORDS[kind] || COMIC_WORDS.homerun;
  return list[hashStr(`${kind}|${seed}`) % list.length];
}
/** The two small panels' captions for a replay of `kind`. */
export const comicCaptionsOf = (kind) => COMIC_CAPTIONS[kind] || COMIC_CAPTIONS.homerun;

/**
 * How long a comic replay of `spec` (replayOf's) takes, in seconds of the game's clock. `page`
 * false is the shorter one: the freeze without the page at the end, for a slot with room for
 * the freeze but not both (comicFit).
 */
export function comicLength(spec, page = true) {
  return (spec.to - spec.from) / REPLAY.rate + COMIC.freeze + (page ? COMIC.page : 0);
}

/**
 * What a slot of `room` seconds has room for: 'page' (the whole comic replay), 'freeze' (no page),
 * or null (only the plain replay, if that). A home run spends most of its hold on the trot and the
 * fireworks, so the comic replay steps down rather than costing the play its replay.
 */
export function comicFit(spec, room) {
  if (comicLength(spec, true) <= room) return 'page';
  if (comicLength(spec, false) <= room) return 'freeze';
  return null;
}

// The worm's-eye camera on the moment at `s` (the ball then): down on the grass, a dozen feet off,
// looking up at it with a wide lens. At the plate it's out in front, toward the mound and the side
// the batter faces, so the swing comes at you; out on the field it's on the home side of the play,
// moved off along the field so it isn't in a fielder's path. `bats` 'L' or 'R'. A shot by name with
// a track that stays put (camera.js shotAt 'fly'), as replay.js catchShot is.
export function wormShot(s, bats = 'R') {
  if (!Array.isArray(s) || !s.every(Number.isFinite)) return null;
  const r = Math.hypot(s[0], s[2]);
  let eye;
  if (r < 20) {
    const side = bats === 'L' ? 1 : -1;
    eye = [s[0] + side * 5, 0.9, s[2] + 11];
  } else {
    const u = [-s[0] / r, -s[2] / r], q = [-u[1], u[0]];
    eye = [s[0] + u[0] * 12 + q[0] * 5, 0.9, s[2] + u[1] * 12 + q[1] * 5];
    // the other side of the play if that one's off the field
    if (!onField(eye, 2)) eye = [s[0] + u[0] * 12 - q[0] * 5, 0.9, s[2] + u[1] * 12 - q[1] * 5];
  }
  const aim = [s[0], Math.max(2.5, s[1] + 1.2), s[2]];
  // dof 0: the lens's blur off. A wide lens this close blurred the crowd to a smear, and the print
  // then inked every speck of it (camera.js shotAt 'fly' takes a shot's own dof).
  return { shot: 'fly', eye, at: aim, fov: 46, follow: 0, dof: 0, track: () => aim };
}

// What follows a moment at the plate (a home run, a walk-off): watching it go. Low and wide on the
// batter's own side of the plate, a little behind him, looking out over him to the field, so he's
// in the frame finishing his swing and the ball's climbing away above. Straight behind the plate
// the umpire and the catcher stood in front of him (seen on a real replay), so it's out wide of
// both. Out on the field there's no one shot that suits every play, so it's null and the replay
// keeps its own second camera.
export function followShot(s, bats = 'R') {
  if (!Array.isArray(s) || !s.every(Number.isFinite) || Math.hypot(s[0], s[2]) >= 20) return null;
  // aimed out past the batter's own side, so he stands a quarter of the way into the frame: aimed
  // up the middle, he was at its very edge (projected, and seen on a real replay)
  const side = bats === 'L' ? 1 : -1, eye = [-side * 11, 4, -9], aim = [side * 11, 10, 45];
  return { shot: 'fly', eye, at: aim, fov: 48, follow: 0, dof: 0, track: () => aim };
}

// The beats, by the replay world's clock: when the run reaches its moment (`key`) it freezes; the
// first panel is taken halfway into the run, the second at the moment, the third two thirds of the
// way through what follows.
export const panelAt = (spec, i) => (i === 0 ? spec.from + (spec.key - spec.from) * 0.5 : i === 1 ? spec.key : spec.key + (spec.to - spec.key) * 0.67);

// ── the faces ─────────────────────────────────────────────────────────────────────────────────────
// The sound words are in the HUD's Bungee; the captions and the narration are hand lettered, in
// Permanent Marker (client/shared/fonts), with fallbacks that keep the shape.
const HAND = (px) => `${px}px "Permanent Marker", "Comic Sans MS", "Chalkboard SE", cursive`;
let facesP = null;
/** Loads the hand-lettering face once. Resolves either way; a painter before it lands falls back. */
export function loadComicFaces(doc) {
  if (facesP) return facesP;
  if (!doc?.fonts || typeof FontFace === 'undefined') return (facesP = Promise.resolve(false));
  facesP = new FontFace('Permanent Marker', `url(${new URL('../../../../shared/fonts/permanent-marker.woff2', import.meta.url)})`)
    .load().then((f) => { doc.fonts.add(f); return true; }, () => false);
  return facesP;
}

// ── the print ─────────────────────────────────────────────────────────────────────────────────────
// A frame of the picture redrawn as a printed comic panel, once a grab: the colour pushed and
// flattened to a few inks, solid black where it's dark, Ben-Day dots through the half-tones, and an
// ink line wherever the brightness steps (a Sobel edge). About 30 ms for a 720-wide frame, so it's
// done once per panel, never per frame. `src` is a canvas or image; returns a new canvas, or the
// source untouched if there's no document or its pixels can't be read.
// lift: a gamma under 1 brightens the mid-tones first, because a night game posterized as it comes
// is mostly black; black: below it is solid ink; dots: below it the Ben-Day screen starts; edge: the
// brightness step that's inked.
export const PRINT = Object.freeze({ levels: 5, lift: 0.64, sat: 1.45, contrast: 1.08, black: 0.025, dots: 0.2, cell: 5, edge: 0.5, dotInk: 0.55 });
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
  const d = im.data, n = w * h, L = new Float32Array(n);
  // lifted first, so the thresholds below are against the brightened picture
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.pow(v / 255, o.lift);
  for (let i = 0; i < n * 4; i += 4) { d[i] = lut[d[i]] * 255; d[i + 1] = lut[d[i + 1]] * 255; d[i + 2] = lut[d[i + 2]] * 255; }
  for (let i = 0; i < n; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  const q = (v) => Math.round(Math.max(0, Math.min(1, v)) * (o.levels - 1)) / (o.levels - 1);
  // the dot screen keeps its size against the picture, whatever the frame's is (o.cell is at 720 wide)
  const cell = Math.max(3, o.cell * Math.max(w, h * 16 / 9) / 720), half = cell / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4, l = L[i];
      // the edge: how fast the brightness steps here
      let e = 0;
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
        const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
        e = Math.hypot(gx, gy);
      }
      if (l < o.black || e > o.edge) { d[p] = 18; d[p + 1] = 15; d[p + 2] = 12; continue; }
      // the inks: saturation and contrast pushed, then each channel to a few levels
      let r = d[p] / 255, gg = d[p + 1] / 255, b = d[p + 2] / 255;
      r = l + (r - l) * o.sat; gg = l + (gg - l) * o.sat; b = l + (b - l) * o.sat;
      r = (r - 0.5) * o.contrast + 0.5; gg = (gg - 0.5) * o.contrast + 0.5; b = (b - 0.5) * o.contrast + 0.5;
      r = q(r); gg = q(gg); b = q(b);
      // Ben-Day: a dot of ink on a 45° screen, bigger the darker it is, through the half-tones
      if (l < o.dots) {
        const u = (x + y) * 0.7071, v = (x - y) * 0.7071;
        const du = ((u % cell) + cell) % cell - half, dv = ((v % cell) + cell) % cell - half;
        if (Math.hypot(du, dv) < half * 1.2 * (o.dots - l) / (o.dots - o.black)) { const k = o.dotInk ?? 0.25; r *= k; gg *= k * 0.92; b *= k * 0.85; }
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
  const lw = Math.max(2, R * 0.045);
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
    const heavy = r() < 0.25, spread = (heavy ? 0.016 : 0.006) + r() * 0.006;
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
    const sx = cx - ux * start + nx * off, sy = cy - uy * start + ny * off, wd = (1.2 + r() * 2.2) * k;
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
  g.font = HUD_FACES.big(Math.round(size));
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
  const ext = Math.max(3, Math.round(size * 0.1)), ow = size * 0.2;
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
  g.lineWidth = Math.max(1.5, 2.5 * k); g.strokeStyle = INK; g.strokeRect(bx, y, tw, bh);
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
 *   issue     the masthead's number, top right (the inning, say); none without it.
 * `words` is the headline across the top (HOME RUN!).
 */
export function paintPage(g, w, h, shots, word, words, t, o = {}) {
  const L = pageLayout(w, h, !!o.flip), k = Math.min(w, h) / 600, seed = o.seed ?? 11;
  g.save();
  g.globalAlpha = ease(t / 0.15);
  g.fillStyle = PAPER; g.fillRect(0, 0, w, h);
  // the paper: a faint dot screen and a yellowed edge
  g.fillStyle = 'rgba(120,90,50,0.08)';
  const st = Math.max(6, 9 * k);
  for (let y = 0; y < h; y += st) for (let x = ((y / st) % 2) * st / 2; x < w; x += st) g.fillRect(x, y, 1.5 * k, 1.5 * k);
  const edge = g.createRadialGradient?.(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  if (edge) { edge.addColorStop(0, 'rgba(150,110,40,0)'); edge.addColorStop(1, 'rgba(150,110,40,0.28)'); g.fillStyle = edge; g.fillRect(0, 0, w, h); }
  g.globalAlpha = 1;
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
    g.lineWidth = Math.max(3, 6 * k); g.strokeStyle = INK; g.strokeRect(-P.w / 2, -P.h / 2, P.w, P.h);
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
  // the masthead, top right: the comic's name and its number, as a cover's corner box has them
  if (o.issue != null) {
    const a = ease((t - 0.7) / 0.25);
    if (a > 0) {
      const C = L.caption, bh = C.h * 0.86, size = bh * 0.3, text = 'DEADBALL COMICS', no = `No. ${o.issue}`;
      g.save(); g.globalAlpha = a;
      g.font = HAND(Math.round(size));
      const bw = Math.max(g.measureText?.(text)?.width || size * text.length * 0.6, size * 4) + size, x = w - L.margin - bw, y = C.y + (C.h - bh) / 2;
      g.fillStyle = INK; g.fillRect(x + 3 * k, y + 3 * k, bw, bh);
      g.fillStyle = WHITE; g.fillRect(x, y, bw, bh);
      g.lineWidth = Math.max(1.5, 3 * k); g.strokeStyle = INK; g.strokeRect(x, y, bw, bh);
      g.fillStyle = RED; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, x + bw / 2, y + bh * 0.32);
      g.fillStyle = INK; g.fillText(no, x + bw / 2, y + bh * 0.72);
      g.restore();
    }
  }
  // the headline and the narration, upper left
  if (words) {
    const a = ease((t - 0.55) / 0.25);
    if (a > 0) {
      const C = L.caption, size = C.h * 0.6;
      g.save(); g.globalAlpha = a;
      g.font = HUD_FACES.big(Math.round(size));
      const tw = (g.measureText?.(words)?.width || size * words.length * 0.8) + size;
      g.fillStyle = INK; g.fillRect(C.x + 4 * k, C.y + 4 * k, tw, C.h);
      g.fillStyle = YELLOW; g.fillRect(C.x, C.y, tw, C.h);
      g.lineWidth = Math.max(2, 4 * k); g.strokeStyle = INK; g.strokeRect(C.x, C.y, tw, C.h);
      g.fillStyle = INK; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(words, C.x + size / 2, C.y + C.h / 2);
      g.restore();
    }
  }
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
      const an = r() * Math.PI * 2, spread = 0.005 + r() * 0.009, inner = R0 * (0.5 + r() * 0.3);
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
  const bw = Math.max(3, 6 * k);
  g.lineWidth = bw; g.strokeStyle = INK; g.strokeRect(bw / 2, bw / 2, w - bw, h - bw);
  const size = Math.max(12, 22 * k);
  caption(g, beat ? 'AND THEN...' : 'SLOW MO', beat ? w - bw - 10 * k : bw + 10 * k, bw + 10 * k, size, w * 0.4, k, !!beat);
  if (o.note && !beat) caption(g, String(o.note).toUpperCase(), bw + 10 * k, h - bw - 10 * k - size * 1.2, size * 0.8, w * 0.6, k);
  g.restore();
}
