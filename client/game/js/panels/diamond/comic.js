// DEADBALL · THE COMIC REPLAY. With the comic look on (gl/house-style.js comicOn), a big play's
// replay (diamond/replay.js) plays as a comic would draw it (docs/proposals/comic-ink.md, comic
// replays):
//
//   1. run    the play in slow motion up to its moment, from down on the grass looking up at it
//             (wormShot), the picture leaning one way;
//   2. freeze the moment held: an impact flash, speed lines and halftone round it, and its sound
//             lettered over it (CRACK! off the bat, THWACK! into the glove);
//   3. after  the rest in slow motion from the replay's own second camera, leaning the other way;
//   4. page   the three beats laid out as a comic page, a big panel and two small, inked, with the
//             play's words in a caption box, then back to the live game.
//
// The live game is never held: the replay plays in its own world, as every replay does, and the
// grandstand gives it a longer slot (comicLength) before the next payload. The camera never rolls
// (diamond/camera.js), so the lean is the picture's: the grandstand tilts its canvas (COMIC.tilt).
// With reduced motion a replay is a still, as ever, and none of this happens.
//
// The painters draw on a 2D context the grandstand lays over the picture, in its pixels. Nothing
// else here touches the DOM.

import { REPLAY } from './replay.js';
import { onField } from './play.js';
import { HUD_FACES } from './hud.js';

// freeze, page: how long each holds (s of the game's clock); tilt: the picture's lean (degrees);
// zoom: how much the leaning picture is enlarged so its corners stay off the screen; flash: the
// impact flash's length (s); pop: how long the sound word takes to land (s).
export const COMIC = Object.freeze({ freeze: 1.4, page: 2.8, tilt: 6, zoom: 1.14, flash: 0.09, pop: 0.22 });

// The sound of each kind of replay's moment, two to choose between so a run of home runs doesn't
// say the same thing every time.
export const COMIC_WORDS = Object.freeze({
  homerun: ['CRACK!', 'KRAK!'], walkoff: ['CRACK!', 'KA-RACK!'],
  catch: ['THWACK!', 'SNAG!'], doubleplay: ['SNAP!', 'ZIP!'], tripleplay: ['SNAP!', 'ZIP!'],
  triple: ['FWOOSH!', 'WHOOSH!'], close: ['BANG-BANG!', 'BANG-BANG!'],
});
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/** The sound for a replay of `kind`, picked off `seed` (the play's words, say), so it's the same every time. */
export function comicWordOf(kind, seed = '') {
  const list = COMIC_WORDS[kind] || COMIC_WORDS.homerun;
  return list[hashStr(`${kind}|${seed}`) % list.length];
}

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
  return { shot: 'fly', eye, at: aim, fov: 46, follow: 0, track: () => aim };
}

// The beats, by the replay world's clock: when the run reaches its moment (`key`) it freezes; the
// first panel is taken halfway into the run, the second at the moment, the third two thirds of the
// way through what follows.
export const panelAt = (spec, i) => (i === 0 ? spec.from + (spec.key - spec.from) * 0.5 : i === 1 ? spec.key : spec.key + (spec.to - spec.key) * 0.67);

// ── the painters ──────────────────────────────────────────────────────────────────────────────────
const INK = '#120f0c', PAPER = '#efe6d2', YELLOW = '#ffd23a', RED = '#d8321f';
const ease = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
// a little overshoot, for a word that slaps down
const pop = (t) => { const x = Math.max(0, Math.min(1, t)); return x < 0.7 ? ease(x / 0.7) * 1.18 : 1.18 - 0.18 * ease((x - 0.7) / 0.3); };

/**
 * The freeze over the held picture, `t` seconds into it, `w` by `h` px, the moment on screen at
 * (cx, cy) (the middle if it's off screen). Speed lines in from the edges to a clear ring round the
 * moment, halftone dots in the corners, the flash, then the word.
 */
export function paintFreeze(g, w, h, cx, cy, word, t) {
  const k = Math.min(w, h) / 600;
  if (!(cx >= 0 && cx <= w && cy >= 0 && cy <= h)) { cx = w / 2; cy = h / 2; }
  const R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)), clear = Math.min(w, h) * 0.2;
  // the speed lines: thin wedges from past the edge in toward the clear ring, each its own length
  g.save();
  g.fillStyle = INK;
  const grow = ease(t / 0.18);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 + ((i * 7919) % 13) * 0.004, spread = 0.006 + ((i * 31) % 5) * 0.0025;
    const inner = clear * (1 + ((i * 17) % 7) * 0.09) + (R - clear) * (1 - grow);
    g.beginPath();
    g.moveTo(cx + Math.cos(a - spread) * R * 1.05, cy + Math.sin(a - spread) * R * 1.05);
    g.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a + spread) * R * 1.05, cy + Math.sin(a + spread) * R * 1.05);
    g.fill();
  }
  // halftone: dots growing toward the corners, in the burst's yellow, over the picture
  g.globalAlpha = 0.55 * ease(t / 0.2);
  g.fillStyle = YELLOW;
  const step = Math.max(8, 14 * k);
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2 + ((y / step) % 2) * step / 2; x < w; x += step) {
      const d = Math.hypot(x - cx, y - cy) / R, r = Math.max(0, (d - 0.45) / 0.55) * step * 0.48;
      if (r > 0.4) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    }
  }
  g.globalAlpha = 1;
  // the flash
  if (t < COMIC.flash) { g.fillStyle = `rgba(255,255,255,${0.75 * (1 - t / COMIC.flash)})`; g.fillRect(0, 0, w, h); }
  g.restore();
  // the word, up and to the open side of the moment
  const sx = cx < w / 2 ? 1 : -1;
  paintWord(g, word, Math.max(w * 0.2, Math.min(w * 0.8, cx + sx * w * 0.16)), Math.max(h * 0.18, cy - h * 0.2), Math.min(w, h) * 0.17, pop(t / COMIC.pop), -0.16 * sx);
}

/** A sound word: thick ink outline, a red drop, yellow fill, at `size` px, scaled by `s`, turned `rot`. */
export function paintWord(g, word, x, y, size, s = 1, rot = -0.12) {
  if (!(s > 0.01)) return;
  g.save();
  g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.font = HUD_FACES.big(Math.round(size));
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  // fit it to the frame: no word wider than four fifths of the picture
  const cap = (g.canvas?.width || size * 8) * 0.8 / Math.max(1, s), wd = g.measureText?.(word)?.width || size * word.length * 0.8;
  if (wd > cap) { const f = cap / wd; g.scale(f, f); }
  const o = size * 0.06;
  g.lineWidth = size * 0.2; g.strokeStyle = INK; g.strokeText(word, o, o);
  g.fillStyle = RED; g.fillText(word, o, o);
  g.lineWidth = size * 0.14; g.strokeText(word, 0, 0);
  g.fillStyle = YELLOW; g.fillText(word, 0, 0);
  g.restore();
}

// Where the page's three panels go in a `w` by `h` picture: the moment big on the left, the run-up
// above the follow-through on the right, each a little turned, with a gutter between.
export function pageLayout(w, h) {
  const m = Math.min(w, h) * 0.05, gut = Math.min(w, h) * 0.03, cap = Math.min(w, h) * 0.12;
  const top = m + cap, bh = h - top - m, lw = (w - 2 * m - gut) * 0.6, rw = w - 2 * m - gut - lw, rh = (bh - gut) / 2;
  return {
    margin: m, caption: { x: m, y: m * 0.6, h: cap },
    panels: [
      { x: m + lw + gut, y: top, w: rw, h: rh, rot: 0.025 },          // the run-up
      { x: m, y: top, w: lw, h: bh, rot: -0.018 },                     // the moment
      { x: m + lw + gut, y: top + rh + gut, w: rw, h: rh, rot: -0.03 }, // what followed
    ],
  };
}

/**
 * The page, `t` seconds into it: paper, the three panels (`shots`, canvases or null for a blank)
 * coming in one after another, the word over the moment's panel and the play's `words` in a
 * caption box.
 */
export function paintPage(g, w, h, shots, word, words, t) {
  const L = pageLayout(w, h), k = Math.min(w, h) / 600;
  g.save();
  g.globalAlpha = ease(t / 0.15);
  g.fillStyle = PAPER; g.fillRect(0, 0, w, h);
  // paper grain: a faint dot screen
  g.fillStyle = 'rgba(120,90,50,0.08)';
  const st = Math.max(6, 9 * k);
  for (let y = 0; y < h; y += st) for (let x = ((y / st) % 2) * st / 2; x < w; x += st) g.fillRect(x, y, 1.5 * k, 1.5 * k);
  g.globalAlpha = 1;
  // the panels in reading order: the moment first, as the page's hit, then the two either side of it
  [1, 0, 2].forEach((i, n) => {
    const P = L.panels[i], a = ease((t - 0.12 - n * 0.22) / 0.3);
    if (a <= 0) return;
    g.save();
    g.translate(P.x + P.w / 2, P.y + P.h / 2); g.rotate(P.rot * a); g.scale(0.85 + 0.15 * a, 0.85 + 0.15 * a);
    g.globalAlpha = a;
    // a hard drop shadow, then the frame
    g.fillStyle = INK; g.fillRect(-P.w / 2 + 6 * k, -P.h / 2 + 6 * k, P.w, P.h);
    g.save(); g.beginPath(); g.rect(-P.w / 2, -P.h / 2, P.w, P.h); g.clip();
    const img = shots[i];
    if (img && img.width) {
      // the shot to cover the panel, cropped from its middle
      const s = Math.max(P.w / img.width, P.h / img.height);
      g.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s);
    } else { g.fillStyle = '#2a2622'; g.fillRect(-P.w / 2, -P.h / 2, P.w, P.h); }
    g.restore();
    g.lineWidth = Math.max(3, 6 * k); g.strokeStyle = INK; g.strokeRect(-P.w / 2, -P.h / 2, P.w, P.h);
    g.restore();
  });
  // the word over the moment, once its panel's down
  const M = L.panels[1];
  paintWord(g, word, M.x + M.w * 0.62, M.y + M.h * 0.24, Math.min(M.w, M.h) * 0.22, pop((t - 0.3) / COMIC.pop), -0.14);
  // the caption box: the play's words, upper left, on the house yellow
  if (words) {
    const a = ease((t - 0.55) / 0.25);
    if (a > 0) {
      const C = L.caption, size = C.h * 0.55;
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
