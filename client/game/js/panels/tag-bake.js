// THE SPRAY-PAINT BAKE: every piece of graffiti GLASS puts on a wall, and the spray can's preview of
// the player's own. Moved out of windshield.js so the spray can (and the boot graph under it) can
// draw a throw-up without fetching all of GLASS, about 3 MB brotli, for one canvas.
//
// ⚠ A LEAF. It imports only the shared glyph tables, never windshield.js or anything under glass/,
// or the spray can drags the renderer back in. windshield.js imports from here and wraps
// `bakeTagText` in its capture guard (a canvas must never be allocated under SHAPE_SINK or
// MESH_SINK); the preview below never runs under a capture, so it calls the bake directly.

import { TAG_GLYPHS } from '../../../shared/tag-glyphs.js';
import { TAG_STROKES, TAG_FACES } from '../../../shared/tag-strokes.js';

// windshield.js's own one-liners, copied rather than imported, which is what keeps this a leaf.
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const dRand = (seed, salt) => { const x = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };
function texCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function lruSweep(map, max, keep) {
  if (map.size <= max) return;
  let n = map.size - keep;
  for (const k of map.keys()) { if (n-- <= 0) break; map.delete(k); }
}

// A throw-up hand, and the one lettering face here that is deliberately NOT in `SIGN_FONT`. That
// table is a table of TRADES — what a foundry, a chapel or a chrome clinic letters itself in — and
// `signFontOf` derives from it. A tag is the opposite of a trade saying its own name, so it is kept
// out of the table where nothing can pick it by accident.
//
// ⚠ A BUBBLE LETTER IS NOT A TYPEFACE, WHICH IS WHY THIS IS THE LEAST IMPORTANT LINE IN THE BAKE.
// The first cut asked a script face to do the whole job and got handwriting: thin, joined, and
// nothing like paint. What makes a letterform read as spray is the HEAVY ROUND-JOINED OUTLINE
// stroked round it (see the passes below) — so all this has to supply is something fat and wide,
// and every reference piece would look the same set in any of them.
// ⚠ NAMES A FACE THAT SHIPS WITH WINDOWS FIRST, then a generic family — the rule SIGN_FONT states:
// a missing font must fall back to a different HAND, never to body text.
const TAG_FONT = (C) => `900 ${Math.round(C * 0.78)}px "Arial Rounded MT Bold","Segoe UI Black","Arial Black",Impact,sans-serif`;
// The scrawled handstyle beside the piece — a date, a crew, somebody else's name. Every reference
// board has two or three of these round the edges of the big one, and they are what stops a wall
// reading as ONE commissioned mural: a piece is a thing somebody spent an hour on, the scrawls are
// what the wall collects in between.
const TAG_SCRAWL_FONT = (C) => `italic 700 ${Math.round(C * 0.30)}px "Segoe Script","Brush Script MT","Ink Free","Comic Sans MS",cursive,sans-serif`;
// How many characters go on a line before the next starts. A can holds 48 characters and a wall is
// about a tile wide: set as one strip, a full-length tag maps onto a quad thirty times wider than
// it is tall, which on a shopfront is a hairline nobody can read. Three short lines is also simply
// what a tag looks like.
const TAG_WRAP = 14, TAG_LINES = 3;
// Keyed on the tag's own words, so the working set is the tags you can see. Capped for the reason
// `_signTexCache` is: a table with a three-day turnover on a server that never restarts is a slow
// leak otherwise, and a cap makes that impossible rather than unlikely.
export const _tagTexCache = new Map();
const TAG_TEX_MAX = 96;

// Style runs → one colour per character. `plugins/graffiti/paint.js` validates and pads them to
// exactly the text's length, so this trusts the COUNT and not the strings: a colour is re-checked
// here because a texture is the one place a bad value throws rather than merely looking wrong.
function tagInks(text, runs, fallback) {
  const out = new Array(text.length).fill(fallback);
  if (!Array.isArray(runs)) return out;
  let i = 0;
  for (const r of runs) {
    const n = Math.max(0, Math.floor(Number(r && r.n) || 0));
    const c = /^#[0-9a-f]{6}$/i.test(String((r && r.c) || '')) ? r.c : fallback;
    for (let k = 0; k < n && i < out.length; k++, i++) out[i] = c;
  }
  return out;
}

// Wrap on spaces where there is one, and mid-word where there is not — a forty-character word is a
// thing a player can type, and a line running off the canvas is not an option.
export function tagLines(text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= TAG_WRAP) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
    while (cur.length > TAG_WRAP && lines.length < TAG_LINES) { lines.push(cur.slice(0, TAG_WRAP)); cur = cur.slice(TAG_WRAP); }
    if (lines.length >= TAG_LINES) { cur = ''; break; }
  }
  if (cur && lines.length < TAG_LINES) lines.push(cur);
  return lines.slice(0, TAG_LINES);
}

// ── FOUR COLOURS OUT OF ONE ─────────────────────────────────────────────────────────────────
//
// A piece is never one colour and an author only ever states one. `plugins/graffiti` gives a
// player a can and per-letter runs; `DETAIL_SCHEMA.tag` gives a model a single `color`; and every
// reference photograph of a throw-up has four — a body, a darker body at the foot of the letter, a
// near-black for the outline and the block, and a CONTRASTING cloud sprayed round the whole thing.
// So the rest are derived here rather than authored anywhere.
//
// ⚠ THE CLOUD IS A CHANNEL ROTATION, WHICH IS A HUE ROTATION WITHOUT A COLOUR SPACE TO GET WRONG.
// (r,g,b) → (b,r,g) is 120° of hue for anything saturated and the identity for a grey, which is
// exactly the behaviour wanted: acid green gets a blue cloud, hot pink gets a green one, and a tag
// sprayed in dirty white gets no cloud worth the name. No conversion, no clamp, no round trip.
const tagHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export const tagMix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return tagHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); };
// ⚠ SILVER IS ONLY REACHABLE WITHOUT RUNS, and that is a rule about consent rather than taste. A
// player who picked four colours letter by letter in the spray can has said what the letters are;
// a scheme that then paints them all off-white would be the tool ignoring them. So a tag carrying
// runs is always `solid` — their colour, in the letters — and the two schemes that move the body
// colour into the cloud are for the walls nobody chose, which is the whole derived kit.
const TAG_SCHEMES = ['solid', 'silver', 'bone'];
function tagPalette(colour, variant, dn) {
  const base = /^#[0-9a-f]{6}$/i.test(String(colour || '')) ? String(colour) : '#b8f03a';
  const [r, g, b] = hexRgb(base);
  const turned = tagHex(b, r, g);
  const scheme = TAG_SCHEMES[Math.abs(variant | 0) % TAG_SCHEMES.length];
  const body = scheme === 'silver' ? '#e6ecf2' : scheme === 'bone' ? '#efe3cc' : base;
  const halo = scheme === 'solid' ? turned : base;
  // Paint after dark is still paint — it is the LIGHT that has gone, and the wall wash is what puts
  // it back. So night pulls everything a little toward a cold dim rather than changing the hue.
  const dim = (h) => (dn ? tagMix(h, '#3a3f4a', 0.28) : h);
  return {
    top: dim(tagMix(body, '#ffffff', 0.34)),
    mid: dim(body),
    bot: dim(tagMix(body, '#000000', 0.30)),
    line: dn ? '#0d0b12' : '#15111a',       // the outline and the block: near-black, never black
    halo: dim(halo),
  };
}

// What a wall that nobody authored says. Handles first and slogans second, in that proportion,
// because that is the proportion on a real wall: a throw-up is almost always a NAME — somebody
// saying they were here — and the political ones are the exception that gets photographed.
// ⚠ SHORT, AND THE LIMIT IS THE PATCH RATHER THAN THE TASTE. The kit reserves about a tenth of a
// frontage for this, so at the range a cab reads it a six-letter word is already at the edge of
// legible and a sentence is a smudge with a shape. The long ones belong to the player's own can,
// which gets four times the area and three lines to put them on.
// ⚠ AND THE LIST GREW WHEN THE PLACEMENT DID. A wall now gets paint on four elevations instead of
// one, so the same twenty-five words are read four times as often and off a pool a quarter the size
// it needs to be: a street where three buildings in a row say OSKA is not a city with graffiti on
// it, it is a texture repeating. The proportion is held — handles first, slogans second — because
// that is the proportion on a real wall and it is the reason the slogans land.
export const TAG_WORDS = [
  'OSKA', 'VREN', 'KILT', 'SKRT', 'MOTH', 'HUSK', 'VANE', 'SLAG', 'GRIT', 'ZEK',
  'RUST', 'CINDR', 'FLUX', 'SCAB', 'KRUD', 'TALO', 'WIRE', 'OXIDE', 'DRIP', 'NULL',
  'BRAK', 'SOOT', 'KOLD', 'SPUR', 'GNAW', 'SHUNT', 'PYRE', 'CLAG', 'MURK', 'SKIV',
  'RIVET', 'THAW', 'VOLT', 'SCRIM', 'LATCH', 'BRIG', 'TOLL', 'ACHE', 'FERAL', 'KELP',
  'WAKE UP', 'NO GODS', 'STILL HERE', 'NOT A BODY', 'COLD WATER',
  'STILL MEAT', 'NO SPIRE', 'WE WERE HERE', 'NOT SAFE', 'STAY DOWN',
];
const TAG_SCRAWLS = ['one love', 'rip', 'ykn', 'ost', 'crew', '2 much', 'again', 'toy',
  'was here', 'no cams', 'kings', 'fresh', 'seen', 'sorry', 'oi', 'x2'];
export const tagWordFor = (v) => TAG_WORDS[Math.abs(v | 0) % TAG_WORDS.length];

// ── THE PIECE ───────────────────────────────────────────────────────────────────────────────
//
// Spray paint is not signage, and all three of `bakeSignText`'s passes are wrong for it: a bright
// core inside a dark edge is how a NEON TUBE reads, and a tag has neither.
//
// What it has instead is a throw-up, and a throw-up is a stack of passes rather than a typeface.
// In the order it goes on the wall, which is the order it is drawn:
//
//   1. the CLOUD — a second colour sprayed round the whole word to lift it off the brick. It is the
//      letters stroked absurdly wide, so it takes THEIR shape rather than being a rectangle
//      somebody drew behind them, with a soft outer overspray for the paint that missed.
//   2. the BLOCK — the piece's own shadow, offset down and to one side in the outline colour, which
//      is what makes flat paint read as letters standing off a wall.
//   3. the OUTLINE — a thick round-joined stroke in near-black, drawn per letter, left to right.
//      ⚠ THIS IS WHAT MAKES A LETTERFORM A BUBBLE LETTER and the face underneath barely matters.
//   4. the FILL — the body, with a vertical fade through it, and a gloss across the top third.
//   5. the DRIPS — off the OUTLINE, not off the fill, because the outline is sprayed last and
//      heaviest, and each one ends in a bead rather than tapering to nothing.
//   6. the SCRAWLS — somebody else's handstyle round the edges. See TAG_SCRAWL_FONT.
//
// ⚠ PASSES 1 AND 2 ARE GLOBAL AND 3–5 ARE PER LETTER, WHICH IS NOT AN OPTIMISATION. Throw-up
// letters overlap, so a letter's outline has to sit ON TOP of the one before it — that interlock is
// most of what the shape reads as. Drawn as three global passes the outlines all go under all the
// fills and the word comes out as one merged blob. Drawn wholly per letter, the cloud and the block
// tile behind each letter and the piece grows internal seams. Each pass belongs at its own scope.
//
// ⚠ NOT TRANSLUCENT ANY MORE, and the note it replaces argued the opposite: paint was drawn at 0.42
// and 0.92 alpha so the wall texture came through it. That is true of a thin tag and false of a
// throw-up, which is two or three coats of enamel and hides whatever is under it — and the brick
// showing through the WHOLE piece is exactly what made the old one read as a stain rather than as
// something somebody made. The wall still comes through at the edges, where the overspray is.
//
// ⚠ AND THE JITTER IS DETERMINISTIC OFF THE WORDS, never off a clock or a draw counter. The canvas
// is cached and a tag is baked once for the life of the page, so a wobble that moved could only
// ever show up as two walls of the same words disagreeing with each other.
// ── SIX HANDS, AND ONLY ONE OF THEM IS A TYPEFACE ───────────────────────────────────────────────
//
// `bakeTagText` draws a THROW-UP: bubble letters, a cloud, a block, drips. It is one thing a wall
// gets, and for a while it was the only thing, so every piece of paint in Coldwater was the same
// piece of paint in a different colour — which reads as a texture repeating rather than as a city
// people write on.
//
// ⚠ AND THE ANSWER IS NOT A FONT, WHICH IS THE QUESTION THIS GETS ASKED. The note on `TAG_FONT`
// already settles it for the throw-up — what makes a letterform read as spray is the heavy
// round-joined outline stroked round it, not the face underneath — and it generalises: a handstyle
// is a marker held at a slant, a stencil is a flat fill with BRIDGES in it, a roller is two tones
// and no outline at all. Every one of those is a different set of PASSES over the same system
// faces, and a downloaded typeface would not supply any of them.
//
// The one exception is `gothic`, where the face IS the style: Old English lettering is what a
// placa is written in, and no recipe over a sans gets there. It uses the self-hosted
// UnifrakturMaguntia that `loadNeonFaces` fetches, and it's the only place that face is allowed;
// signs gave it up (see the ⚠ in SIGN_FONT).
//
// So a hand is a recipe:
//
//   throw    the piece. Bubble letters, cloud, block, outline, fill, drips. `bakeTagText`.
//   hand     somebody's signature, in marker, at a slant, with a tail thrown off the last letter.
//            What is actually on most walls, and what the throw-up's tiny `TAG_SCRAWLS` imitate.
//   stencil  cut out of card and sprayed through: one flat colour, a soft overspray edge, speckle,
//            and the little bridges that hold the counters of the letters in. Where a slogan goes.
//   roller   a blockbuster. Emulsion on an extension pole, two flat tones, no outline, no drips,
//            nap streaks across the letters. Wide, and high enough that the pole is why it is there.
//   buff     not graffiti: the city painting OVER graffiti. A rectangle of paint that does not
//            match the wall, a ghost of what was under it, and often somebody back the same week.
//   gothic   a placa. Blackletter in one enamel, a hard keyline and a drop shadow, set straight
//            and title-cased, because all-caps blackletter can't be read. No cloud and no drips:
//            it's done slowly and it's done clean.
//
// ⚠ THE ASPECT IS HALF THE PLACEMENT, AND IT COSTS NOTHING. `fitSignPts` seats a texture inside the
// quad it is given and only ever takes LESS of it, so a roller baked three times as wide as it is
// tall occupies a wide band of its reserved patch and a handstyle a narrow one, with no placement
// code knowing either exists. What the placement DOES decide is where on the wall the patch is —
// see `TAG_HAND_BAND`, which is the other half: a roller goes high because that is what the pole is
// for, and a handstyle goes low because that is arm's length.
export const TAG_HANDS = ['throw', 'hand', 'stencil', 'roller', 'buff', 'gothic'];
// ⚠ WEIGHTED, BECAUSE A WALL IS NOT AN EVEN SPLIT OF FIVE THINGS. Reference photographs of any
// street are mostly scrawled names with a few pieces among them; a blockbuster is a landmark and a
// buff is whatever the council got round to. An even roll makes every street read as a gallery.
// A placa is common on purpose: about one wall in five.
const TAG_HAND_ROLL = ['hand', 'hand', 'hand', 'hand', 'hand', 'throw', 'throw', 'throw',
  'gothic', 'gothic', 'gothic', 'stencil', 'stencil', 'roller', 'buff'];
export const tagHandFor = (v) => TAG_HAND_ROLL[Math.abs(v | 0) % TAG_HAND_ROLL.length];
// ⚠ A PLAYER'S WORDS ARE NEVER ROLLED ONTO THE LAST TWO. A roller is two flat tones with no outline
// and a buff is paint over the top of somebody — both are deliberately hard to read, which is right
// for texture on a wall nobody wrote and wrong for a sentence another player is meant to read. See
// the ⚠ on TAG_HALF_W: legibility is the whole of what the player's own paint is for.
export const TAG_HANDS_PLAYER = ['throw', 'hand', 'stencil'];
export const tagHandForPlayer = (v) => TAG_HANDS_PLAYER[Math.abs(v | 0) % TAG_HANDS_PLAYER.length];
// Where on the wall each hand goes, and how big a patch it asks for. `lift` is a multiple of the
// throw-up's own band height, measured up from it; `w` and `hh` are multiples of its half-width and
// half-height.
// ⚠ THE ROLLER IS THE ONLY ONE THAT LEAVES ARM'S REACH, and that is the entire reason it looks the
// way it does — no outline and no drips because it is emulsion off a nine-inch roller, and up there
// because the pole is why anybody bothered. A blockbuster at chest height is just a wide throw-up.
const TAG_HAND_BAND = {
  throw: { lift: 0, w: 1, hh: 1 },
  hand: { lift: -0.35, w: 0.74, hh: 0.62 },
  stencil: { lift: 0.25, w: 0.58, hh: 0.72 },
  roller: { lift: 2.6, w: 1.9, hh: 0.9 },
  buff: { lift: 0.1, w: 1.5, hh: 1.05 },
  gothic: { lift: 0.1, w: 0.95, hh: 0.9 },
};
export const tagBandFor = (hand) => TAG_HAND_BAND[hand] || TAG_HAND_BAND.throw;
// A marker. NOT the piece's own face — a handstyle is written with the side of a nib, so it wants
// something whose stroke already varies, and the same family the throw-up's scrawls use.
const TAG_HAND_FONT = (C) => `italic 700 ${Math.round(C * 0.92)}px "Segoe Script","Brush Script MT","Ink Free","Comic Sans MS",cursive,sans-serif`;
// Cut out of card: flat, heavy, condensed. Which is what every stencil anybody has ever cut is set
// in, because it is what survives having bridges taken out of it.
const TAG_STENCIL_FONT = (C) => `900 ${Math.round(C * 0.80)}px "Arial Narrow",Haettenschweiler,Impact,"Arial Black",sans-serif`;
// A roller does not draw letters, it fills them. The widest, heaviest face available.
const TAG_ROLLER_FONT = (C) => `900 ${Math.round(C * 0.86)}px "Arial Black","Segoe UI Black",Impact,sans-serif`;
// A placa. Gabriola is the Windows fallback: calligraphic rather than blackletter, but still a pen
// hand, where the next thing down the stack is a body serif.
const TAG_GOTHIC_FONT = (C) => `${Math.round(C * 0.98)}px UnifrakturMaguntia,"Old English Text MT","Blackadder ITC",Gabriola,serif`;
// Blackletter capitals in a row are the least legible thing in the alphabet, so a placa is set the
// way it's written: a capital to open each word and the rest lower case.
const titleWords = (s) => String(s).toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());

// The five hands that are not the throw-up. Dispatched from `bakeTagText` so the cache, the key,
// the wrap and the palette are shared and there is one place a piece of paint is made.
//
// ⚠ AND EVERY ONE OF THEM STAMPS `__tagPaint`. Three gates read `signTexKey`'s prefix to mean "a
// sign": that it must not go blank with distance, that it must stand proud of its own board, and
// that nothing may be drawn across it. All three are wrong about paint, and a hand that forgot the
// stamp would fail `signrange` on the day it shipped — see the ⚠ at the foot of `bakeTagText`.
// As many whole words as fit one line of a blockbuster, and never a word cut in half — except a
// single word longer than the line, which is the one case there is nothing else to do with.
const ROLLER_CHARS = 11;
function rollerLine(body) {
  const words = String(body).split(/\s+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? out + ' ' + w : w;
    if (next.length > ROLLER_CHARS) break;
    out = next;
  }
  return out || String(body).slice(0, ROLLER_CHARS);
}
function bakeTagHand(hand, body, colour, dn, variant, marks) {
  const P = tagPalette(colour, variant, dn);
  const R = (salt) => dRand(variant + body.length, 1300 + salt);
  const CELL = 64;

  if (hand === 'buff') return bakeTagBuff(body, P, R, CELL, variant, dn);

  // ⚠ A BLOCKBUSTER IS ONE LINE, AND TAKING THE FIRST WORD IS NOT HOW YOU GET ONE. "NO GODS" came
  // back as "NO", which is half a slogan painted three storeys up with no way to tell it was ever
  // longer. What a roller does is fit what it can across the wall and stop, so whole words are
  // taken until the line is full and the rest is simply not up there.
  const lines = hand === 'roller' ? [rollerLine(body)] : hand === 'gothic' ? tagLines(titleWords(body)) : tagLines(body);
  if (!lines.length || !lines[0]) return null;

  const font = hand === 'hand' ? TAG_HAND_FONT : hand === 'stencil' ? TAG_STENCIL_FONT
    : hand === 'gothic' ? TAG_GOTHIC_FONT : TAG_ROLLER_FONT;
  // Tracking and stretch per hand. A marker runs its letters together, a stencil holds them apart
  // because the card between them has to survive being cut, a roller is nearly touching, and
  // blackletter sets close by nature.
  const TRACK = hand === 'hand' ? 0.88 : hand === 'stencil' ? 1.08 : hand === 'gothic' ? 0.97 : 0.92;
  // ⚠ A BLOCKBUSTER IS WIDE, AND 1.5 IS NOT WIDE. At that stretch it came back as clean flat
  // display type — correct letters, and nothing about them said a roller. The whole read is that
  // the letters are far wider than they are tall, because a nine-inch roller is what drew them.
  const FAT = hand === 'roller' ? 2.1 : 1.0;
  // ⚠ ONE LEAN FOR THE WHOLE WORD ON A HANDSTYLE, never a per-letter wobble. A hand leans because
  // of how the arm is held, so every letter leans the SAME way — a random tilt per letter is the
  // throw-up's trick and here it reads as letters falling over rather than as handwriting.
  const LEAN = hand === 'hand' ? -0.13 - R(3) * 0.08 : 0;

  const probe = texCanvas(8, 8).getContext('2d');
  probe.font = font(CELL);
  const chW = (ch) => (probe.measureText(ch).width || CELL * 0.5) * FAT;
  const lineW = lines.map((ln) => {
    let w = 0;
    for (let i = 0; i < ln.length; i++) w += chW(ln[i]) * (i === ln.length - 1 ? 1 : TRACK);
    return Math.max(w, CELL * 0.6);
  });
  const LH = Math.round(CELL * (hand === 'hand' ? 1.05 : 1.2));
  // Padding per hand, because what spills outside the letters differs every time: a marker drips
  // and flourishes, a stencil oversprays a soft field all round, a roller runs off its own ends.
  const PAD_X = Math.round(CELL * (hand === 'stencil' ? 0.34 : hand === 'roller' ? 0.16 : 0.26));
  const PAD_T = Math.round(CELL * (hand === 'stencil' ? 0.30 : 0.18));
  const PAD_B = Math.round(CELL * (hand === 'hand' ? 0.52 : hand === 'stencil' ? 0.30 : 0.20));
  const W = Math.ceil(Math.max(...lineW)) + PAD_X * 2;
  const H = LH * lines.length + PAD_T + PAD_B;
  const c = texCanvas(W, H);
  const g = c.getContext('2d');
  g.font = font(CELL);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const glyphs = [];
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    let x = PAD_X;
    const yMid = PAD_T + LH * li + LH * 0.5;
    for (let ci = 0; ci < ln.length; ci++) {
      const ch = ln[ci], w = chW(ch);
      if (ch !== ' ') {
        glyphs.push({
          ch, w, li, ci, uw: w / FAT, x: x + w * 0.5,
          // A hand rides up and down its own line; a stencil and a roller do not, because the card
          // and the wall are what hold them straight.
          y: yMid + (hand === 'hand' ? (R(li * 29 + ci * 7) - 0.5) * CELL * 0.14 : 0),
          rot: LEAN,
        });
      }
      x += w * (ci === ln.length - 1 ? 1 : TRACK);
    }
  }
  if (!glyphs.length) return null;
  // Centred on the UNSCALED width inside the scale — the same trap `bakeTagText` records.
  const at = (q, fn) => { g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.scale(FAT, 1); fn(-q.uw * 0.5); g.restore(); };

  if (hand === 'hand') bakeHandstyle(g, glyphs, at, P, R, CELL);
  else if (hand === 'stencil') bakeStencil(g, glyphs, at, P, R, CELL);
  else if (hand === 'gothic') bakePlaca(g, glyphs, at, P, CELL);
  else bakeRoller(g, glyphs, at, P, R, CELL, W, H);

  g.globalAlpha = 1;
  c.__tagPaint = 1;
  return c;
}

// A signature in marker: one ink, one weight, a tail, and a couple of drips. No cloud, no block,
// no outline — every one of those belongs to a piece somebody spent an hour on, and this is the
// thing that gets written in four seconds on the way past.
function bakeHandstyle(g, glyphs, at, P, R, CELL) {
  const ink = P.mid;
  // ⚠ THE TAIL GOES ON FIRST. It runs UNDER the letters — a flourish thrown off the last letter and
  // back along the foot of the word is one continuous motion of the same pen, so where it passes
  // behind a letter the letter is what you see. Drawn afterwards it is a line ruled across the word.
  const last = glyphs[glyphs.length - 1], first = glyphs[0];
  g.save();
  g.strokeStyle = ink;
  g.globalAlpha = 0.9;
  g.lineWidth = CELL * 0.085;
  g.beginPath();
  g.moveTo(last.x + last.w * 0.28, last.y - CELL * 0.1);
  g.quadraticCurveTo(last.x + last.w * 0.9, last.y + CELL * 0.46, (first.x + last.x) * 0.5, last.y + CELL * 0.40);
  g.quadraticCurveTo(first.x - CELL * 0.36, last.y + CELL * 0.34, first.x - CELL * 0.22, last.y - CELL * 0.06);
  g.stroke();
  g.restore();

  // The hand itself. Stroked AND filled in one ink, which is what a wide nib does: the stroke is
  // the width of the tip and the fill is the body of the letter, and there is no second colour
  // anywhere in it.
  g.save();
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = CELL * 0.11;
  for (const q of glyphs) at(q, (ox) => { g.strokeText(q.ch, ox, 0); g.fillText(q.ch, ox, 0); });
  g.restore();

  // Two or three drips, off the letters rather than off an outline — there is no outline here. A
  // marker drip is thinner and longer than a can's and it does not bead.
  g.save();
  g.strokeStyle = ink;
  g.lineCap = 'round';
  let n = 0;
  for (const q of glyphs) {
    if (n >= 3 || R(q.ci * 17 + q.li * 5) <= 0.66) continue;
    n++;
    const dh = CELL * (0.16 + R(q.ci * 3) * 0.30);
    const dx = q.x + (R(q.ci * 11) - 0.5) * q.w * 0.4;
    g.lineWidth = Math.max(1.5, CELL * 0.035);
    g.beginPath();
    g.moveTo(dx, q.y + CELL * 0.24);
    g.lineTo(dx + (R(q.ci * 7) - 0.5) * CELL * 0.04, q.y + CELL * 0.24 + dh);
    g.stroke();
  }
  g.restore();
}

// Sprayed through cut card. Flat colour, a soft field of overspray round the edge, speckle where
// the can sat too long — and the bridges, which are the whole tell.
function bakeStencil(g, glyphs, at, P, R, CELL) {
  const ink = P.mid;
  // 1. The overspray — paint that went past the card.
  //
  // ⚠ IT IS A HAZE ROUND THE LETTERS, NOT A SECOND SET OF THEM. A first cut stroked it at 0.42 of a
  // cell with a blur on top and 0.20 alpha, and on a dark wall the overlap between neighbouring
  // letters built up into a solid field that the flat fill then sat INSIDE — the piece read as a
  // muddy glowing smear with letter-shaped holes in it, which is the opposite of what a stencil
  // looks like. Narrower, softer, and one pass: what is wanted is a dirty edge, not a glow.
  g.save();
  g.globalAlpha = 0.13;
  g.strokeStyle = ink;
  g.shadowColor = ink;
  g.shadowBlur = CELL * 0.18;
  g.lineWidth = CELL * 0.22;
  for (const q of glyphs) at(q, (ox) => g.strokeText(q.ch, ox, 0));
  g.restore();

  // 2. The letters, flat and OPAQUE. No gradient and no gloss: a stencil is one pass of one colour,
  //    and a vertical fade through it would read as a printed sticker. The paint that went through
  //    the card is the brightest thing in the piece — everything else here is what leaked round it.
  g.save();
  g.globalAlpha = 1;
  g.fillStyle = ink;
  for (const q of glyphs) at(q, (ox) => g.fillText(q.ch, ox, 0));
  g.restore();

  // 3. The speckle — the fine mist that lands outside the card. Cheap, and it is what stops a flat
  //    fill reading as vinyl.
  g.save();
  g.fillStyle = ink;
  for (let i = 0; i < 20; i++) {
    g.globalAlpha = 0.08 + R(400 + i) * 0.14;
    const q = glyphs[Math.floor(R(420 + i * 3) * glyphs.length) % glyphs.length];
    g.beginPath();
    g.arc(q.x + (R(440 + i * 5) - 0.5) * CELL * 1.5, q.y + (R(460 + i * 7) - 0.5) * CELL * 1.3,
      CELL * (0.012 + R(480 + i) * 0.022), 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // 4. THE BRIDGES. ⚠ THIS IS THE ONE PASS THAT MAKES IT A STENCIL. A counter — the hole in an O,
  //    the triangle in an A — has to be held to the rest of the card by a strip, so the paint has a
  //    gap across it exactly there. Punched out with `destination-out` so it takes the overspray
  //    and the speckle with it: a bridge drawn in the wall's colour would be a coloured bar across
  //    the letter, and nothing in a bake knows what colour the wall is.
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (const q of glyphs) {
    const n = 1 + (R(q.ci * 13 + q.li * 3) > 0.55 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const horiz = R(q.ci * 5 + i * 9) > 0.45;
      const t = CELL * (0.055 + R(q.ci * 7 + i) * 0.03);
      const off = (R(q.ci * 11 + i * 3) - 0.5) * CELL * 0.5;
      if (horiz) g.fillRect(q.x - q.w * 0.6, q.y + off - t * 0.5, q.w * 1.2, t);
      else g.fillRect(q.x + off - t * 0.5, q.y - CELL * 0.5, t, CELL);
    }
  }
  g.restore();
  g.globalCompositeOperation = 'source-over';
}

// A placa: blackletter in enamel, keylined, with a hard shadow down and to the right. Every keyline
// goes down before any fill, as the throw-up does, so where two letters touch there's one line
// between them rather than a keyline painted across a neighbour.
function bakePlaca(g, glyphs, at, P, CELL) {
  // 1. The shadow: the keylined letter, offset. Opaque, because it's a second colour somebody chose.
  g.save();
  g.translate(CELL * 0.07, CELL * 0.07);
  g.fillStyle = g.strokeStyle = P.line;
  g.lineWidth = CELL * 0.08;
  for (const q of glyphs) at(q, (ox) => { g.strokeText(q.ch, ox, 0); g.fillText(q.ch, ox, 0); });
  g.restore();
  // 2. Every keyline.
  g.save();
  g.strokeStyle = P.line;
  g.lineWidth = CELL * 0.08;
  for (const q of glyphs) at(q, (ox) => g.strokeText(q.ch, ox, 0));
  g.restore();
  // 3. Every fill, light at the head of the letter and darker at the foot, which is the enamel
  //    catching the street light rather than a gradient anybody painted.
  g.save();
  for (const q of glyphs) at(q, (ox) => {
    const fade = g.createLinearGradient(0, -CELL * 0.42, 0, CELL * 0.34);
    fade.addColorStop(0, P.top);
    fade.addColorStop(0.5, P.mid);
    fade.addColorStop(1, P.bot);
    g.fillStyle = fade;
    g.fillText(q.ch, ox, 0);
  });
  g.restore();
}

// A blockbuster. Emulsion, two flat tones, no outline, no drips — a roller does not drip, it
// STREAKS, and it runs out at the end of a stroke.
function bakeRoller(g, glyphs, at, P, R, CELL, W, H) {
  // ⚠ THE SECOND TONE IS THE ONLY MODELLING THERE IS. With no outline and no cloud, a single flat
  // colour on a dark wall is a shape rather than a word; a roller does two coats and the second one
  // never quite covers the first, which is what gives the letters an edge to be read by.
  g.save();
  g.fillStyle = P.bot;
  for (const q of glyphs) at(q, (ox) => g.fillText(q.ch, ox, 0));
  g.restore();
  // ⚠ THE OFFSET HAS TO BE SEEN FROM A CAB, which 0.03 of a cell is not — at the size a piece of
  // paint is actually drawn that is a fraction of a pixel and the two coats are one flat colour
  // again. A second coat put on by hand misses by an inch, not by a hair.
  g.save();
  g.translate(-CELL * 0.09, -CELL * 0.08);
  g.fillStyle = P.mid;
  for (const q of glyphs) at(q, (ox) => g.fillText(q.ch, ox, 0));
  g.restore();

  // The nap. Bands of slightly thinner paint across the whole word, because a roller is nine inches
  // wide and goes up and down — so the streaks run ACROSS the letters and do not care where one
  // ends and the next begins.
  g.save();
  g.globalCompositeOperation = 'destination-out';
  // ⚠ FEWER AND HEAVIER. Nine faint bands average out into an even wash and disappear the moment
  // the piece is drawn small; what a roller leaves is a handful of obvious dry lines.
  for (let i = 0; i < 6; i++) {
    g.globalAlpha = 0.16 + R(600 + i) * 0.26;
    const y = (i + R(620 + i * 3)) * (H / 6);
    g.fillRect(0, y, W, Math.max(1, CELL * (0.035 + R(640 + i) * 0.07)));
  }
  g.restore();
  g.globalCompositeOperation = 'source-over';

  // …and one end where the roller ran dry. One only, because both looks like a fade somebody
  // applied rather than like a stroke that stopped.
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const dry = R(660) > 0.5;
  const fade = g.createLinearGradient(dry ? W : 0, 0, dry ? W - CELL * 0.7 : CELL * 0.7, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0.75)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, W, H);
  g.restore();
  g.globalCompositeOperation = 'source-over';
}

// ── THE BUFF ────────────────────────────────────────────────────────────────────────────────────
//
// The city answering. A rectangle of paint rolled over somebody's tag in whatever was on the van,
// which is never the colour of the wall — and that mismatch is the whole of what you read, because
// nothing else in a street is a plain rectangle.
//
// ⚠ IT CARRIES NO WORDS OF ITS OWN AND MUST NOT. A buff is defined by what it took away; give it
// something to say and it is another sign. The `body` handed in is what was UNDER it, which is why
// the ghost is drawn from it and then painted over.
//
// ⚠ AND THE COLOUR IS NOT THE TAG'S. Everything else here derives from the paint somebody chose;
// this is the opposite — a council grey, a primer beige, a municipal green — so it comes off its
// own short list and the tag's own colour never reaches it.
const TAG_BUFF_COLS = ['#6f6f6a', '#5a6157', '#7d7468', '#4e5358', '#867b6c'];
function bakeTagBuff(body, P, R, CELL, variant, dn) {
  const W = Math.round(CELL * 4.6), H = Math.round(CELL * 2.0);
  const c = texCanvas(W, H);
  const g = c.getContext('2d');
  let paint = TAG_BUFF_COLS[Math.abs(variant | 0) % TAG_BUFF_COLS.length];
  if (dn) paint = tagMix(paint, '#3a3f4a', 0.30);

  // 1. The ghost — what was under it, at the strength a second coat leaves. Drawn first and at the
  //    size of the patch, so the buff has something to be covering.
  g.save();
  g.globalAlpha = 0.5;
  g.font = TAG_FONT(CELL * 0.8);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = P.line;
  g.lineWidth = CELL * 0.14;
  g.fillStyle = P.mid;
  const word = String(body || '').slice(0, 8) || 'X';
  g.strokeText(word, W * 0.5, H * 0.5);
  g.fillText(word, W * 0.5, H * 0.5);
  g.restore();

  // 2. The paint over it. ⚠ A RAGGED EDGE, NOT A RECTANGLE — a roller is pushed up to the edge of
  //    the patch and no further, so every side of a real buff is a series of overlapping strokes
  //    with the wall showing between them at the corners. A true rectangle reads as a panel bolted
  //    to the wall, which is the one thing it must not look like.
  const m = CELL * 0.14;
  g.save();
  // ⚠ NOT OPAQUE, WHICH IS THE WHOLE POINT OF THE PASS ABOVE IT. One coat of municipal emulsion
  // does not hide a throw-up — the piece comes back through it as a shadow, and that ghost is the
  // only thing that says this rectangle is a buff rather than a painted panel. At alpha 1 the
  // ghost was drawn, covered, and never seen by anybody.
  g.globalAlpha = 0.87;
  g.fillStyle = paint;
  g.beginPath();
  const edge = (n, x0, y0, x1, y1, salt, first) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = (R(salt + i * 3) - 0.5) * CELL * 0.16;
      const px = x0 + (x1 - x0) * t + (y0 === y1 ? 0 : j);
      const py = y0 + (y1 - y0) * t + (y0 === y1 ? j : 0);
      if (first && i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
  };
  edge(5, m, m, W - m, m, 800, true);
  edge(3, W - m, m, W - m, H - m, 820, false);
  edge(5, W - m, H - m, m, H - m, 840, false);
  edge(3, m, H - m, m, m, 860, false);
  g.closePath();
  g.fill();
  g.restore();

  // 3. The nap again — the same roller, so the same streaks. Without them the patch is a flat
  //    colour field and reads as a hole in the wall.
  g.save();
  g.globalAlpha = 0.10;
  g.fillStyle = '#000000';
  for (let i = 0; i < 7; i++) {
    const y = m + (i + R(880 + i)) * ((H - m * 2) / 7);
    g.fillRect(m, y, W - m * 2, Math.max(1, CELL * 0.03));
  }
  g.restore();

  // 4. And somebody was back. Not always — a buff that always has a fresh tag on it is a joke told
  //    every time — but often enough that the patch reads as a round in an argument rather than as
  //    the end of one.
  if (R(900) > 0.45) {
    g.save();
    g.globalAlpha = 0.92;
    g.font = TAG_SCRAWL_FONT(CELL * 1.5);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = dn ? tagMix(P.mid, '#3a3f4a', 0.2) : P.mid;
    g.translate(W * 0.5 + (R(910) - 0.5) * CELL * 0.6, H * 0.5 + (R(920) - 0.5) * CELL * 0.3);
    g.rotate((R(930) - 0.5) * 0.28);
    g.fillText(TAG_SCRAWLS[Math.abs(variant | 0) % TAG_SCRAWLS.length], 0, 0);
    g.restore();
  }
  g.globalAlpha = 1;
  c.__tagPaint = 1;
  return c;
}

// The throw-up draws its letters from TAG_GLYPHS (hand-drawn, traced) and only falls back to
// TAG_FONT for a character the sheet has no letter for. A path is pre-scaled to the bake's cell
// once and cached, so the context transform and every lineWidth stay exactly what the font path
// used — scaling the context instead would scale the keyline and every gradient with it.
const TAG_GLYPH_H = 0.92;        // traced letter height as a fraction of CELL
const _tagGlyphPaths = new Map();
function tagGlyph(ch, cell) {
  const G = TAG_GLYPHS[ch.toUpperCase()];
  if (!G || typeof Path2D === 'undefined') return null;
  const key = ch.toUpperCase() + '|' + cell;
  let hit = _tagGlyphPaths.get(key);
  if (!hit) {
    const k = cell * TAG_GLYPH_H;
    const P2 = (d) => (d ? new Path2D(d.replace(/-?\d*\.?\d+/g, (n) => (parseFloat(n) * k).toFixed(2))) : null);
    const body = P2(G.d);
    hit = { w: G.w * k, d: body, line: P2(G.line) || body, shade: P2(G.shade) };
    _tagGlyphPaths.set(key, hit);
  }
  return hit;
}
// ── FOUR LETTERFORMS FOR THE THROW-UP ───────────────────────────────────────────────────────────
//
// `bubble` is the traced sheet above: fat, soft and hand-drawn. The other three are the stroke
// alphabet in `tag-strokes.js`, stroked three ways:
//
//   round   thick, every corner smoothed off, round ends. A neater, puffier cousin of the bubble.
//   block   square ends and mitred corners. Chunky and upright.
//   sharp   thinner, mitred to points, leaning forward, and every free end cut to a chisel point.
//
// ⚠ A KEYLINE IS THE SAME PATH STROKED WIDER, which is why the stroke alphabet can do this at all:
// every pass of the bake asks for "the letter grown by this much", and for a stroked letter that
// is the stroke plus that much. A mitred letter's keyline and block shadow stay mitred with it.
// Only a grow wider than the letter's own stroke goes round, because that is the cloud, and a
// cloud with corners on it is not overspray.
//
// The list itself (TAG_FACES) lives in tag-strokes.js, because the graffiti plugin checks a
// player's choice against it.
//
// Weighted like the hands, toward the sheet: it is the house style, the others are the variety.
const TAG_FACE_ROLL = ['bubble', 'bubble', 'bubble', 'bubble', 'round', 'round', 'block', 'block', 'sharp', 'sharp', 'sharp'];
const tagFaceFor = (v) => TAG_FACE_ROLL[Math.floor(dRand(v | 0, 4417) * TAG_FACE_ROLL.length) % TAG_FACE_ROLL.length];
// `sw` is the stroke as a share of the letter's ink height and `xs` stretches the letter wide.
// `smooth` is how many rounds of corner cutting the path gets. `shear` leans it forward. `clip` is
// how far a corner's point may reach, in half-strokes (see `tagJoinPoly`); 0 is a round corner.
// `rot` (in radians) and `bob` (in cells) bound how far one letter may tip and ride off the line.
// `bubble` only carries the last two: its own letters come off the sheet, and the few characters
// the sheet lacks are drawn `round`, the nearest stroked face.
// ⚠ THE STROKE WEIGHT DECIDES WHETHER THE COUNTERS SURVIVE. An E has three arms in one letter
// height, so above about 0.3 of it the gaps between them close and the letter is a block with
// notches in it. Each of these was set by rendering the whole alphabet and reading it back.
const TAG_FACE_SPEC = {
  bubble: { rot: 0.08, bob: 0.05 },
  round: { sw: 0.32, xs: 1.1, smooth: 3, clip: 0, cap: 'round', shear: 0.05, rot: 0.09, bob: 0.07 },
  block: { sw: 0.29, xs: 1.06, smooth: 0, clip: 1.5, cap: 'square', shear: 0, rot: 0.035, bob: 0.03 },
  sharp: { sw: 0.25, xs: 0.94, smooth: 0, clip: 2.8, cap: 'butt', shear: 0.24, chisel: 1, rot: 0.05, bob: 0.04 },
};

// Corner cutting: every pass replaces each corner with two points a quarter of the way along its
// sides. Three passes turn a chamfered O into an oval and a Z into a ribbon. The ends of an open
// stroke stay where they are.
function tagChaikin(pts, closed, passes) {
  let p = pts;
  for (let it = 0; it < passes; it++) {
    const out = closed ? [] : [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(closed ? out[0] : p[p.length - 1]);
    p = out;
  }
  return p;
}

// A letter from the stroke alphabet, scaled to the bake's cell and centred on the origin the way a
// traced glyph is. Cached per face and cell like the traced paths.
const _tagStrokeGlyphs = new Map();
function tagStrokeGlyph(ch, face, cell) {
  const S0 = TAG_STROKES[ch.toUpperCase()];
  const S = (S0 && S0[face]) || S0;
  const F = TAG_FACE_SPEC[face];
  if (!S || !F || !F.sw) return null;
  const key = ch.toUpperCase() + '|' + face + '|' + cell;
  const hit = _tagStrokeGlyphs.get(key);
  if (hit) return hit;
  const inkH = cell * TAG_GLYPH_H;
  const sw = inkH * F.sw, k = inkH - sw, half = S.w * F.xs * 0.5;
  // Centred, stretched, and leant: x moves right as y goes up.
  const P = ([x, y]) => { const Y = (y - 0.5) * k; return [(x * F.xs - half) * k - Y * F.shear, Y]; };
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const closed = S.s.map((pl) => pl.length > 2 && same(pl[0], pl[pl.length - 1]));
  const strokes = S.s.map((pl, i) => {
    const pts = pl.map(P);
    return F.smooth ? tagChaikin(pts, closed[i], F.smooth) : pts;
  });
  // The chisel: each free end of a sharp letter carries on past the cut as a right triangle, so the
  // stroke ends in a point on one side and square on the other — the cut of a knife, not an arrow.
  // The point goes to the side that faces up-right, so every end on a letter is cut the same way.
  const spikes = [];
  if (F.chisel) {
    strokes.forEach((pl, i) => {
      if (closed[i] || pl.length < 2) return;
      for (const [e, f] of [[pl[0], pl[1]], [pl[pl.length - 1], pl[pl.length - 2]]]) {
        const dx = e[0] - f[0], dy = e[1] - f[1], L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        let nx = -uy, ny = ux;
        if (nx - ny < 0) { nx = -nx; ny = -ny; }
        const h = sw * 0.5;
        spikes.push([[e[0] + nx * h, e[1] + ny * h], [e[0] - nx * h, e[1] - ny * h],
          [e[0] + nx * h + ux * sw * 0.95, e[1] + ny * h + uy * sw * 0.95]]);
      }
    });
  }
  // Every corner that turns, with the two directions it turns between.
  const corners = [];
  if (F.clip) strokes.forEach((pl, i) => {
    const n = pl.length;
    for (let j = 0; j < n; j++) {
      const at0 = j === 0, atN = j === n - 1;
      if (!closed[i] && (at0 || atN)) continue;
      if (closed[i] && atN) continue;           // the closing point repeats the first
      const a = pl[at0 ? n - 2 : j - 1], p = pl[j], b = pl[j + 1];
      const lu = Math.hypot(p[0] - a[0], p[1] - a[1]), lv = Math.hypot(b[0] - p[0], b[1] - p[1]);
      if (lu < 1e-6 || lv < 1e-6) continue;
      corners.push({ p, u: [(p[0] - a[0]) / lu, (p[1] - a[1]) / lu], v: [(b[0] - p[0]) / lv, (b[1] - p[1]) / lv] });
    }
  });
  const G = { strokes, closed, dots: (S.dot || []).map(P), spikes, corners, sw, key: inkH * 0.075, spec: F };
  _tagStrokeGlyphs.set(key, G);
  return G;
}

// ⚠ A CLIPPED MITRE, BECAUSE THE CANVAS ONLY OFFERS A POINT OR NOTHING. `lineJoin = 'miter'` runs a
// corner out to its full point until the point passes `miterLimit`, then cuts it off flat at the
// stroke. An N or a W at a sharp letter's weight turns through about 30°, where the full point is
// four half-strokes long and the keyline's point is longer again: with a limit high enough to keep
// the point, the letters grew spikes reaching well past their own height, and a limit low enough
// to stop that takes the point off altogether. So corners are drawn bevelled and this polygon adds
// the point back, cut off square at `clip` half-strokes.
// ⚠ THE CUT MOVES OUT WITH THE GROW, not with the width: a keyline must run round the end of the
// point at the keyline's own width, so the clip distance is the body's plus half the grow.
function tagJoinPoly(G, c, grow) {
  const h = (G.sw + grow) * 0.5;
  const [u0, u1] = c.u, [v0, v1] = c.v, [px, py] = c.p;
  const cross = u0 * v1 - u1 * v0;
  if (Math.abs(cross) < 1e-4) return null;
  const sg = cross > 0 ? 1 : -1;
  const c1 = [px + sg * u1 * h, py - sg * u0 * h], c2 = [px + sg * v1 * h, py - sg * v0 * h];
  const s = Math.sqrt(Math.max(0, (1 + (u0 * v0 + u1 * v1)) * 0.5));   // sin of half the inside angle
  if (s < 1e-3) return null;
  let mx = u0 - v0, my = u1 - v1;
  const ml = Math.hypot(mx, my) || 1;
  mx /= ml; my /= ml;
  const dT = h / s, d1 = h * s, L = G.spec.clip * G.sw * 0.5 + grow * 0.5;
  const T = [px + mx * dT, py + my * dT];
  if (dT <= L) return [c.p, c1, T, c2];
  const k = (L - d1) / (dT - d1);
  return [c.p, c1, [c1[0] + (T[0] - c1[0]) * k, c1[1] + (T[1] - c1[1]) * k],
    [c2[0] + (T[0] - c2[0]) * k, c2[1] + (T[1] - c2[1]) * k], c2];
}

// Draw a stroked letter grown by `grow` pixels, in the context's current paint.
function tagStrokeDraw(ctx, G, op, grow) {
  const lw = G.sw + grow;
  const soft = grow > G.sw;
  const F = G.spec;
  ctx.save();
  const paint = op === 'stroke' ? ctx.strokeStyle : ctx.fillStyle;
  ctx.strokeStyle = paint;
  ctx.fillStyle = paint;
  ctx.lineWidth = lw;
  ctx.lineJoin = soft || !F.clip ? 'round' : 'bevel';
  ctx.lineCap = soft ? 'round' : F.cap;
  ctx.beginPath();
  G.strokes.forEach((pl, i) => {
    ctx.moveTo(pl[0][0], pl[0][1]);
    for (let j = 1; j < pl.length; j++) ctx.lineTo(pl[j][0], pl[j][1]);
    if (G.closed[i]) ctx.closePath();
  });
  ctx.stroke();
  for (const [x, y] of G.dots) {
    ctx.beginPath();
    if (soft || F.cap === 'round') ctx.arc(x, y, lw * 0.5, 0, Math.PI * 2);
    else ctx.rect(x - lw * 0.5, y - lw * 0.5, lw, lw);
    ctx.fill();
  }
  if (!soft && G.corners.length) {
    ctx.beginPath();
    for (const c of G.corners) {
      const poly = tagJoinPoly(G, c, grow);
      if (!poly) continue;
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
    }
    ctx.fill();
  }
  if (G.spikes.length) {
    ctx.lineWidth = Math.max(grow, 0);
    ctx.lineJoin = soft ? 'round' : 'miter';
    ctx.miterLimit = 4;
    ctx.beginPath();
    for (const t of G.spikes) { ctx.moveTo(t[0][0], t[0][1]); ctx.lineTo(t[1][0], t[1][1]); ctx.lineTo(t[2][0], t[2][1]); ctx.closePath(); }
    ctx.fill();
    if (grow > 0) ctx.stroke();
  }
  ctx.restore();
}

// One letter, stroked or filled, whichever source it comes from. `ox` is the font path's left
// edge; a traced or stroked glyph is already centred on the origin `at` translates to. `layer`
// picks the body ('d') or the body with its keyline ('line'); a font letter has only the one shape.
function tagGlyphOp(ctx, q, ox, op, layer = 'd') {
  if (q.glyph) { const path = q.glyph[layer] || q.glyph.d; if (op === 'stroke') ctx.stroke(path); else ctx.fill(path); return; }
  if (q.sk) { tagStrokeDraw(ctx, q.sk, op, (layer === 'line' ? q.sk.key * 2 : 0) + (op === 'stroke' ? ctx.lineWidth : 0)); return; }
  if (op === 'stroke') ctx.strokeText(q.ch, ox, 0); else ctx.fillText(q.ch, ox, 0);
}

// ── WHERE A LETTER'S INK IS, AS LINE SEGMENTS ───────────────────────────────────────────────────
//
// The spacing works from the letter's real outline rather than its box, because a box is what put
// the letters on top of each other. An A, a V or an L has most of its box empty, so boxes set
// touching leave gaps, and boxes set overlapping (the old fix for the gaps) drive the full-width
// rows of one letter deep into the next.
//
// Each source gives its body outline as segments in the glyph's own frame, centred on its origin:
// a traced letter from its path, a stroked one from the offset edges of its stroke, and a font
// letter as a box, which is the best that can be said of a face nobody measured.
function tagPathSegs(d, k) {
  const segs = [];
  const tok = String(d || '').match(/[MCLZmclz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let start = null, prev = null, cmd = '';
  const nums = [];
  const flushPt = (x, y) => { if (prev) segs.push([prev[0], prev[1], x, y]); prev = [x, y]; };
  for (const t of tok) {
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t.toUpperCase();
      if (cmd === 'Z') { if (prev && start) segs.push([prev[0], prev[1], start[0], start[1]]); prev = start; }
      nums.length = 0;
      continue;
    }
    nums.push(parseFloat(t) * k);
    if (nums.length < 2) continue;
    const x = nums[0], y = nums[1];
    nums.length = 0;
    if (cmd === 'M') { start = [x, y]; prev = [x, y]; cmd = 'L'; }
    else flushPt(x, y);                 // a curve's control points hug it closely at this density
  }
  return segs;
}
function tagStrokeSegs(G) {
  const segs = [], h = G.sw * 0.5;
  const ring = (x, y, r) => {
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
      segs.push([x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r]);
    }
  };
  G.strokes.forEach((pl, pi) => {
    for (let i = 0; i + 1 < pl.length; i++) {
      const [ax, ay] = pl[i], [bx, by] = pl[i + 1];
      const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L * h, ny = (bx - ax) / L * h;
      segs.push([ax + nx, ay + ny, bx + nx, by + ny], [ax - nx, ay - ny, bx - nx, by - ny]);
    }
    for (let i = 0; i < pl.length; i++) {
      const end = !G.closed[pi] && (i === 0 || i === pl.length - 1);
      const [x, y] = pl[i];
      if (!end || G.spec.cap === 'round') ring(x, y, h);
      else if (G.spec.cap === 'square') {
        const o = pl[i === 0 ? 1 : i - 1], L = Math.hypot(x - o[0], y - o[1]) || 1;
        const ux = (x - o[0]) / L * h, uy = (y - o[1]) / L * h;
        segs.push([x - uy + ux, y + ux + uy, x + uy + ux, y - ux + uy]);
      }
    }
  });
  // A corner's point reaches past the ring: its outline is the same polygon the draw fills.
  for (const c of G.corners) {
    const poly = tagJoinPoly(G, c, 0);
    if (poly) for (let i = 0; i < poly.length; i++) segs.push([...poly[i], ...poly[(i + 1) % poly.length]]);
  }
  for (const [x, y] of G.dots) ring(x, y, h);
  for (const t of G.spikes) for (let i = 0; i < 3; i++) segs.push([...t[i], ...t[(i + 1) % 3]]);
  return segs;
}

// For every band of `step` pixels along one axis, the least and greatest coordinate on the other
// that the segments reach. Bands run from `origin`, `n` of them. `swap` bands along x instead of y.
function tagBands(segs, step, origin, n, swap) {
  const lo = new Float32Array(n).fill(Infinity), hi = new Float32Array(n).fill(-Infinity);
  for (const s of segs) {
    let a0 = swap ? s[1] : s[0], b0 = swap ? s[0] : s[1], a1 = swap ? s[3] : s[2], b1 = swap ? s[2] : s[3];
    if (b0 > b1) { const ta = a0, tb = b0; a0 = a1; b0 = b1; a1 = ta; b1 = tb; }
    const r0 = Math.max(0, Math.floor((b0 - origin) / step)), r1 = Math.min(n - 1, Math.floor((b1 - origin) / step));
    const d = b1 - b0;
    for (let r = r0; r <= r1; r++) {
      const t0 = origin + r * step;
      const ya = Math.max(b0, t0), yb = Math.min(b1, t0 + step);
      const xa = d > 1e-9 ? a0 + (a1 - a0) * (ya - b0) / d : a0;
      const xb = d > 1e-9 ? a0 + (a1 - a0) * (yb - b0) / d : a1;
      if (xa < lo[r]) lo[r] = xa; if (xb < lo[r]) lo[r] = xb;
      if (xa > hi[r]) hi[r] = xa; if (xb > hi[r]) hi[r] = xb;
    }
  }
  return { lo, hi };
}

// Band extents grown by a disc of radius `r`: the shape every point of the outline would sweep if
// it were a coin of that size. Two grown shapes that only just meet are `2r` apart at their
// nearest, in any direction, which is the distance spacing should mean. Two points in bands `k`
// apart are taken to be `k - ½` bands apart in height: between the nearest they could be and the
// centres, since the first set letters loose and the second let a pair come in under the gap.
function tagGrow(b, r, step) {
  const n = b.lo.length, K = Math.ceil(r / step) + 1;
  const lo = new Float32Array(n).fill(Infinity), hi = new Float32Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    for (let k = -K; k <= K; k++) {
      const j = i + k;
      if (j < 0 || j >= n || !(b.hi[j] >= b.lo[j])) continue;
      const dy = Math.max(0, Math.abs(k) - 0.5) * step;
      if (dy > r) continue;
      const w = Math.sqrt(r * r - dy * dy);
      if (b.lo[j] - w < lo[i]) lo[i] = b.lo[j] - w;
      if (b.hi[j] + w > hi[i]) hi[i] = b.hi[j] + w;
    }
  }
  return { lo, hi };
}

// ── THE LAYOUT, ONCE ────────────────────────────────────────────────────────────────────────────
//
// Where every letter of a throw-up goes, solved before anything is painted: five passes over the
// same letters have to agree about where each one is. A pass that re-derived its own positions
// would be a piece whose cloud and whose outline are in different places, which is the one
// artefact a bake cannot recover from.
//
// Each letter gets its source, its tilt and its bob first, and then its outline in that pose.
// Spacing reads the outline, band by band. Answers in the piece's own frame: `ax` is a letter's
// centre along the line and `lineY[li]` the middle of its line; `segs` and `bands` are the
// outline relative to those. `minX`..`maxY` bound every body. Null when nothing is drawable.
//
// ⚠ LETTERS TOUCH; THEY DO NOT OVERLAP. The last version advanced each letter by 0.72–0.84 of its
// box so every letter bit into the one before it, and on a real word that buried a third of each
// letter under its neighbour: COLDWATER read as a row of blobs. What a throw-up actually has is
// letters set so close their outlines meet, with ONE keyline between them. So the letters are
// spaced by their outlines to leave TAG_GAP between two bodies at their nearest, and the bake lays
// every keyline before any fill, so that gap is always keyline and never wall.
// ⚠ NEAREST IN ANY DIRECTION, NOT ACROSS. Spaced so each band had TAG_GAP of wall across it, an A
// against a V left two parallel diagonals under a pixel apart at right angles, and the fills ran
// together. Each outline is grown by half the gap (`tagGrow`) and the grown shapes are set touching.
// `scripts/shapes/tagspace.mjs` holds the layout to that.
export const TAG_GAP = 0.07;
// A word space is a break in the keyline, wide enough that the rim shows through it. The cloud
// still runs across, so the piece stays one piece.
export const TAG_WORD = 0.30;
// ⚠ BUBBLE LETTERS ARE INFLATED, NOT SET IN A FAT FACE. A font letter is grown by a round-joined
// stroke of its own fill colour, which rounds every corner and closes the counters down to slots,
// and the rim, outline and block grow by the same amount so the keyline stays a keyline. A traced
// or stroked letter was drawn fat already and barely takes any.
const TAG_PUFF = 0.08;
// ⚠ THE LETTERS ARE STRETCHED AND THE LAYOUT HAS TO KNOW IT. No face that ships with an operating
// system is as wide as a bubble letter, so a font letter is drawn through a horizontal scale — and
// its outline is measured through the same scale, so the spacing sees what gets drawn.
const TAG_FAT = 1.24;
export function tagLayout(body, lines, face, variant, CELL) {
  const GAP = CELL * TAG_GAP, WORD = CELL * TAG_WORD, PUFF = CELL * TAG_PUFF, FAT = TAG_FAT;
  const spec = TAG_FACE_SPEC[face] || TAG_FACE_SPEC.bubble;
  const FACE_USED = TAG_FACE_SPEC[face] ? face : 'bubble';
  const probe = texCanvas(8, 8).getContext('2d');
  probe.font = TAG_FONT(CELL);
  const R = (salt) => dRand(variant + body.length, 900 + salt);
  const BAND = 2, SPAN = CELL * 1.4, NB = Math.ceil((SPAN * 2) / BAND);
  const glyphs = [];
  const lineGlyphs = lines.map(() => []);
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    let spaces = 0;
    for (let ci = 0; ci < ln.length; ci++) {
      const ch = ln[ci];
      if (ch === ' ') { spaces++; continue; }
      const glyph = FACE_USED === 'bubble' ? tagGlyph(ch, CELL) : null;
      const sk = glyph ? null : tagStrokeGlyph(ch, FACE_USED === 'bubble' ? 'round' : FACE_USED, CELL);
      const uw = glyph || sk ? 0 : (probe.measureText(ch).width || CELL * 0.5);
      const fat = (glyph || sk ? 1 : FAT) * (0.96 + R(li * 17 + ci * 7) * 0.08);
      const rot = (R(li * 31 + ci * 3) - 0.5) * 2 * spec.rot;
      const bob = (R(li * 37 + ci * 5) - 0.5) * 2 * spec.bob * CELL;
      let src;
      if (glyph) src = tagPathSegs(TAG_GLYPHS[ch.toUpperCase()].d, CELL * TAG_GLYPH_H);
      else if (sk) src = tagStrokeSegs(sk);
      else {
        // A font letter is a box a little over cap height, grown by its puff.
        const hx = uw * 0.5 + PUFF, hy = CELL * 0.30 + PUFF;
        src = [[-hx, -hy, hx, -hy], [hx, -hy, hx, hy], [hx, hy, -hx, hy], [-hx, hy, -hx, -hy]];
      }
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const T = (x, y) => [x * fat * cr - y * sr, x * fat * sr + y * cr + bob];
      const segs = src.map((s) => [...T(s[0], s[1]), ...T(s[2], s[3])]);
      const bands = tagBands(segs, BAND, -SPAN, NB, false);
      let lo = Infinity, hi = -Infinity;
      for (let r = 0; r < NB; r++) if (bands.hi[r] >= bands.lo[r]) { lo = Math.min(lo, bands.lo[r]); hi = Math.max(hi, bands.hi[r]); }
      if (!(hi > lo)) continue;
      const grown = tagGrow(bands, GAP * 0.5, BAND);
      const q = { ch, li, ci, glyph, sk, uw, fat, rot, bob, segs, bands, grown, lo, hi, spaces, w: hi - lo };
      spaces = 0;
      glyphs.push(q);
      lineGlyphs[li].push(q);
    }
  }
  if (!glyphs.length) return null;

  // Along the line: each letter goes as far left as it can while its grown outline clears the grown
  // outline of every letter already placed on it. Against every earlier letter and not only the
  // last, so a short letter tucked under a T's arm cannot let the next one run into the T.
  for (const lg of lineGlyphs) {
    for (let j = 0; j < lg.length; j++) {
      const b = lg[j];
      if (!j) { b.lx = -b.lo; continue; }
      let x = -Infinity, words = 0;
      for (let i = j - 1; i >= 0; i--) {
        words += lg[i + 1].spaces;
        const a = lg[i], gap = words ? WORD : 0;
        for (let r = 0; r < NB; r++) {
          if (!(b.grown.hi[r] >= b.grown.lo[r]) || !(a.grown.hi[r] >= a.grown.lo[r])) continue;
          const need = a.lx + a.grown.hi[r] - b.grown.lo[r] + gap;
          if (need > x) x = need;
        }
      }
      // Nothing shared a band (a full stop after a letter with no foot): sit it off the last one.
      const prev = lg[j - 1];
      if (x === -Infinity) x = prev.lx + prev.hi - b.lo + GAP + (b.spaces ? WORD : 0);
      b.lx = x;
    }
  }

  // Down the piece: the same test turned on its side. Each line drops until it is GAP below every
  // column of ink above it, so a short line nests up under a long one and the lines lock together
  // as one piece instead of stacking as a paragraph.
  let minX = Infinity, maxX = -Infinity;
  const lineX = lines.map((_, li) => (li ? (R(li * 7) - 0.5) * CELL * 0.3 : 0));
  for (let li = 0; li < lineGlyphs.length; li++) for (const q of lineGlyphs[li]) {
    q.ax = lineX[li] + q.lx;
    minX = Math.min(minX, q.ax + q.lo); maxX = Math.max(maxX, q.ax + q.hi);
  }
  const NC = Math.ceil((maxX - minX) / BAND) + 1;
  const colsOf = (lg, dy) => {
    const segs = [];
    for (const q of lg) for (const s of q.segs) segs.push([s[0] + q.ax, s[1] + dy, s[2] + q.ax, s[3] + dy]);
    return tagBands(segs, BAND, minX, NC, true);
  };
  const lineY = [0];
  let above = colsOf(lineGlyphs[0], 0);
  for (let li = 1; li < lineGlyphs.length; li++) {
    const me = tagGrow(colsOf(lineGlyphs[li], 0), GAP * 0.5, BAND);
    const over = tagGrow(above, GAP * 0.5, BAND);
    let dy = -Infinity;
    for (let c = 0; c < NC; c++) {
      if (!(me.hi[c] >= me.lo[c]) || !(over.hi[c] >= over.lo[c])) continue;
      dy = Math.max(dy, over.hi[c] - me.lo[c]);
    }
    if (dy === -Infinity) dy = lineY[li - 1] + CELL;
    lineY.push(dy);
    const placed = colsOf(lineGlyphs[li], dy);
    for (let c = 0; c < NC; c++) {
      if (placed.hi[c] > above.hi[c]) above.hi[c] = placed.hi[c];
      if (placed.lo[c] < above.lo[c]) above.lo[c] = placed.lo[c];
    }
  }
  let minY = Infinity, maxY = -Infinity;
  for (let li = 0; li < lineGlyphs.length; li++) for (const q of lineGlyphs[li]) {
    for (let r = 0; r < NB; r++) {
      if (!(q.bands.hi[r] >= q.bands.lo[r])) continue;
      const y = lineY[li] - SPAN + r * BAND;
      if (y < minY) minY = y;
      if (y + BAND > maxY) maxY = y + BAND;
    }
  }

  return { glyphs, lineGlyphs, lineY, minX, maxX, minY, maxY, band: BAND, span: SPAN };
}

export function bakeTagText(text, runs, colour, dn, variant = 0, marks = 3, hand = 'throw', face = null, cache = true) {
  const body = String(text || '').trim();
  if (!body) return null;
  const nMarks = clamp(Math.round(Number(marks) || 0), 0, 4);
  const runKey = Array.isArray(runs) ? runs.map((r) => `${r && r.n}:${r && r.c}`).join(',') : '';
  const hasRuns = Array.isArray(runs) && runs.length > 0;
  // ⚠ PER-LETTER RUNS FORCE THE THROW-UP, and that is the same consent rule the silver scheme
  // follows. A player who picked four colours letter by letter in the spray can has SAID what the
  // letters are; a handstyle is one ink, a stencil is one ink and a roller is two tones of one —
  // every other hand would quietly throw those choices away. See the ⚠ on TAG_SCHEMES.
  // A named letterform is the same kind of statement, and it only exists on the throw-up.
  const FACE = TAG_FACES.includes(face) ? face : null;
  const HAND = (hasRuns || FACE || !TAG_HANDS.includes(hand)) ? 'throw' : hand;
  const FACE_USED = FACE || tagFaceFor(variant);
  const key = `${body}|${colour}|${dn}|${variant}|${nMarks}|${HAND}|${HAND === 'throw' ? FACE_USED : ''}|${runKey}`;
  const hit = cache ? _tagTexCache.get(key) : null;
  if (hit) { _tagTexCache.delete(key); _tagTexCache.set(key, hit); return hit; }   // LRU touch
  // ⚠ CACHED HERE RATHER THAN IN THERE, so there is one table, one cap and one key for every piece
  // of paint in the city — a second cache inside `bakeTagHand` is a second thing to get the
  // eviction wrong in. It answers null for a body that leaves it no letters, which is not cached,
  // exactly as this function's own early returns are not.
  // ⚠ `cache` IS FALSE ONLY FOR THE SPRAY CAN'S PREVIEW, which re-bakes on every keystroke: kept,
  // those drafts would evict the walls actually standing in the street.
  const keep = (tex) => {
    if (!cache) return tex;
    lruSweep(_tagTexCache, TAG_TEX_MAX, Math.max(1, TAG_TEX_MAX - (TAG_TEX_MAX >> 2)));
    _tagTexCache.set(key, tex);
    return tex;
  };
  if (HAND !== 'throw') {
    const alt = bakeTagHand(HAND, body, colour, dn, variant | 0, nMarks);
    return alt ? keep(alt) : null;
  }

  const lines = tagLines(body);
  if (!lines.length) return null;
  const P = tagPalette(colour, hasRuns ? 0 : variant, dn);
  const inks = tagInks(body, runs, P.mid);
  // Where each line starts in the original string, so a per-letter colour run survives the wrap.
  // ⚠ `indexOf` FROM A CURSOR, never from zero — a tag reading "NO NO NO" would otherwise hand all
  // three lines the colours of the first one.
  const starts = [];
  let cursor = 0;
  for (const ln of lines) {
    const at = body.indexOf(ln, cursor);
    starts.push(at < 0 ? cursor : at);
    cursor = (at < 0 ? cursor : at) + ln.length;
  }

  // Every dimension below is a fraction of one letter, so the whole piece scales with `CELL` and
  // there is one number to change rather than nine.
  const CELL = 64;
  // ⚠ EVERY STROKE IS CENTRED ON THE GLYPH, SO HALF OF IT EATS THE LETTER. The first cut set the
  // outline at 0.185 of a cell — twelve pixels, six of them inward, on a stem about ten pixels
  // wide — and the fill it was supposed to be containing had nowhere left to go: twenty-five
  // pieces came out as black letters on a coloured pill, which reads as a sticker rather than as
  // paint. In every reference the fill is most of the letter and the outline is a keyline round
  // it, about a twelfth of the cap height.
  const OUT = CELL * 0.085;       // the outline — a keyline, not a casing
  const RIM = OUT * 2.8;          // the cloud's own colour, crisp, right against the outline
  const HALO = CELL * 0.55;       // …and the loose field of overspray outside that
  const BLK = CELL * 0.15;        // how far the block is offset
  const PUFF = CELL * TAG_PUFF;
  const PAD_X = Math.round(HALO * 0.5 + PUFF + CELL * 0.18);
  const PAD_T = Math.round(HALO * 0.5 + PUFF + CELL * 0.12);
  const PAD_B = Math.round(HALO * 0.5 + CELL * 0.52);   // …and the drips hang below all of it

  const R = (salt) => dRand(variant + body.length, 900 + salt);
  const L = tagLayout(body, lines, FACE_USED, variant, CELL);
  if (!L) return null;
  const { glyphs, lineGlyphs, lineY, minX, maxX, minY, maxY } = L;
  for (const q of glyphs) q.ink = inks[starts[q.li] + q.ci] || P.mid;

  const W = Math.ceil(maxX - minX) + PAD_X * 2;
  const H = Math.ceil(maxY - minY) + PAD_T + PAD_B;
  const c = texCanvas(W, H);
  const g = c.getContext('2d');
  g.font = TAG_FONT(CELL);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (let li = 0; li < lineGlyphs.length; li++) for (const q of lineGlyphs[li]) {
    q.x = PAD_X - minX + q.ax;
    q.my = PAD_T - minY + lineY[li];     // the line's own middle; the outline is measured from here
    q.y = q.my + q.bob;
  }
  // ⚠ CENTRED ON THE UNSCALED WIDTH, INSIDE THE SCALE. `fillText` draws the face's own glyph and
  // the transform stretches it, so an origin taken from the STRETCHED width shifts every letter
  // left by half its own stretch — which reads as the whole word drifting off its cloud.
  const at = (q, fn) => { g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.scale(q.fat, 1); fn(-q.uw * 0.5); g.restore(); };

  // 1. THE CLOUD. One pass, so the overlaps merge into a single field instead of stacking alpha
  //    into a darker patch behind every letter. Loose and half-transparent: this is the paint that
  //    MISSED, and a cloud as solid as the rim below it is a badge with a word on it.
  g.save();
  g.globalAlpha = 0.46;
  g.strokeStyle = P.halo;
  g.lineWidth = HALO + PUFF * 2;
  g.shadowColor = P.halo;
  g.shadowBlur = CELL * 0.30;
  for (const q of glyphs) at(q, (ox) => tagGlyphOp(g, q, ox, 'stroke', 'line'));
  // …and a few loose blobs off the edge of it, because a can held at arm's length does not stop
  // where the letters do. Without them the cloud is an offset outline of the word, which is a
  // shape no aerosol makes.
  g.fillStyle = P.halo;
  for (let i = 0; i < 4; i++) {
    const q = glyphs[Math.floor(R(300 + i * 5) * glyphs.length) % glyphs.length];
    const side = R(310 + i * 7) > 0.5 ? 1 : -1;
    g.beginPath();
    g.ellipse(q.x + side * (CELL * 0.30 + R(320 + i * 3) * CELL * 0.30),
      q.y + (R(330 + i * 9) - 0.5) * CELL * 0.85,
      CELL * (0.10 + R(340 + i) * 0.12), CELL * (0.08 + R(350 + i) * 0.10), 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // 2. THE BLOCK — the silhouette of the RIMMED letter, not of the bare one, because that is the
  //    outer edge the shadow is cast by.
  g.save();
  g.translate(BLK, BLK * 0.86);
  g.globalAlpha = 0.9;
  g.strokeStyle = P.line;
  g.fillStyle = P.line;
  g.lineWidth = RIM + PUFF * 2;
  for (const q of glyphs) at(q, (ox) => { tagGlyphOp(g, q, ox, 'stroke', 'line'); tagGlyphOp(g, q, ox, 'fill', 'line'); });
  g.restore();

  // A traced or stroked letter was drawn fat and keeps its own counters; inflating it again fills
  // them in. Only a font fallback gets the full puff.
  const puffOf = (q) => (q.glyph || q.sk ? PUFF * 0.15 : PUFF);
  // 3. The cloud's crisp rim goes round the whole word at once, so it never cuts a letter.
  for (const q of glyphs) at(q, (ox) => { g.strokeStyle = P.halo; g.lineWidth = q.glyph || q.sk ? RIM - OUT : RIM + puffOf(q) * 2; tagGlyphOp(g, q, ox, 'stroke', 'line'); });

  // 4. THE DRIPS. One or two on a piece, never one under every letter — that would read as a fringe
  //    somebody drew rather than as paint that got away.
  // ⚠ UNDER THE LETTERS, FROM THE FOOT OF THE OUTLINE. They used to start a quarter of a cell below
  //    the letter's middle and go on after the fills, which put a black bar down the lower half of
  //    whichever letter they fell from — on a real word that cut an E into an F and an O into a U.
  //    A drip is the outline running, so it starts where the outline is lowest at that point and
  //    goes down, and the letter above it covers its top.
  g.save();
  g.strokeStyle = P.line;
  g.fillStyle = P.line;
  g.lineCap = 'round';
  let drips = 0;
  for (const q of glyphs) {
    if (drips >= 3 || R(q.li * 53 + q.ci * 11) <= 0.68) continue;
    const lx = (q.lo + q.hi) * 0.5 + (R(q.ci * 5) - 0.5) * q.w * 0.5;
    let foot = -Infinity;
    for (const s of q.segs) {
      const x0 = Math.min(s[0], s[2]), x1 = Math.max(s[0], s[2]);
      if (lx < x0 || lx > x1) continue;
      const y = x1 - x0 > 1e-9 ? s[1] + (s[3] - s[1]) * (lx - s[0]) / (s[2] - s[0]) : Math.max(s[1], s[3]);
      if (y > foot) foot = y;
    }
    if (foot === -Infinity) continue;
    drips++;
    const dh = CELL * (0.20 + R(q.ci * 3) * 0.34);
    const dx2 = q.x + lx;
    const top = q.my + foot - OUT;
    const wob = (R(q.ci * 7) - 0.5) * CELL * 0.05;
    g.lineWidth = Math.max(2, CELL * 0.075);
    g.beginPath();
    g.moveTo(dx2, top);
    g.lineTo(dx2 + wob, top + OUT + dh);
    g.stroke();
    g.beginPath();                                    // …and the bead it ends in
    g.arc(dx2 + wob, top + OUT + dh, g.lineWidth * 0.72, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // 5. EVERY KEYLINE, THEN EVERY FILL. ⚠ THIS ORDER IS THE SEAMLESS PART. With the outlines all
  //    down first, no letter's outline is ever drawn across another letter's paint: where two
  //    letters meet, the only thing between them is the strip of keyline the spacing left, so the
  //    word has one continuous outline round the outside and a single line between each pair.
  //    ⚠ THE OLD ORDER WAS OUTLINE-AND-FILL PER LETTER, and it only worked because the letters sat
  //    on top of each other; with them apart it would put a doubled line in every join.
  for (const q of glyphs) at(q, (ox) => {
    if (q.glyph || q.sk) { g.fillStyle = P.line; tagGlyphOp(g, q, ox, 'fill', 'line'); }
    else { g.strokeStyle = P.line; g.lineWidth = OUT + puffOf(q) * 2; tagGlyphOp(g, q, ox, 'stroke'); }
  });
  const fillOf = (q) => {
    const fade = g.createLinearGradient(0, -CELL * 0.5, 0, CELL * 0.46);
    fade.addColorStop(0, hasRuns ? tagMix(q.ink, '#ffffff', 0.30) : P.top);
    fade.addColorStop(0.55, hasRuns ? q.ink : P.mid);
    fade.addColorStop(1, hasRuns ? tagMix(q.ink, '#000000', 0.28) : P.bot);
    return fade;
  };
  // The inflated letter: its glyph plus a round stroke of the same paint round it.
  const blob = (q, ox, paint) => {
    g.fillStyle = paint; g.strokeStyle = paint; g.lineWidth = puffOf(q) * 2;
    tagGlyphOp(g, q, ox, 'stroke'); tagGlyphOp(g, q, ox, 'fill');
  };
  const shadeOf = (q) => tagMix(hasRuns ? q.ink : P.mid, '#000000', 0.34);
  for (let i = glyphs.length - 1; i >= 0; i--) {
    const q = glyphs[i];
    at(q, (ox) => {
      blob(q, ox, fillOf(q));
      // …and the shading drawn on the sheet, in a darker cut of this letter's own ink.
      if (q.glyph && q.glyph.shade) {
        g.save(); g.globalAlpha = 0.8;
        g.fillStyle = shadeOf(q);
        g.fill(q.glyph.shade);
        g.restore();
      }
    });
  }
  // A letter with no drawn shading gets the shadow side of its own stroke instead: the letter minus
  // itself nudged up and left, which leaves a crescent along the bottom and right of every stroke.
  // On its own canvas so the cut-out only removes shading, never paint.
  const unshaded = glyphs.filter((q) => !(q.glyph && q.glyph.shade));
  if (unshaded.length) {
    const sh = texCanvas(W, H), s = sh.getContext('2d');
    s.font = g.font; s.textAlign = 'left'; s.textBaseline = 'middle'; s.lineJoin = 'round'; s.lineCap = 'round';
    const put = (q, dx, dy) => { s.save(); s.translate(q.x + dx, q.y + dy); s.rotate(q.rot); s.scale(q.fat, 1);
      const ox = -q.uw * 0.5; s.lineWidth = puffOf(q) * 2; tagGlyphOp(s, q, ox, 'stroke'); tagGlyphOp(s, q, ox, 'fill'); s.restore(); };
    for (const q of unshaded) { s.fillStyle = s.strokeStyle = shadeOf(q); put(q, 0, 0); }
    s.globalCompositeOperation = 'destination-out';
    s.fillStyle = s.strokeStyle = '#000000';
    for (const q of unshaded) put(q, -CELL * 0.07, -CELL * 0.08);
    g.save(); g.globalAlpha = 0.8; g.drawImage(sh, 0, 0); g.restore();
  }
  // The gloss. Enamel out of a can is shiny at the TOP-LEFT of every stroke, and on a bubble letter
  // that is a crescent: the letter minus itself shifted down and right. Built on its own canvas so
  // the cut-out only removes highlight, never paint.
  {
    const hl = texCanvas(W, H), h = hl.getContext('2d');
    h.font = g.font; h.textAlign = 'left'; h.textBaseline = 'middle'; h.lineJoin = 'round'; h.lineCap = 'round';
    const hat = (q, dx, dy) => { h.save(); h.translate(q.x + dx, q.y + dy); h.rotate(q.rot); h.scale(q.fat, 1);
      const ox = -q.uw * 0.5; h.lineWidth = puffOf(q) * 1.2; tagGlyphOp(h, q, ox, 'stroke'); tagGlyphOp(h, q, ox, 'fill'); h.restore(); };
    h.fillStyle = h.strokeStyle = '#ffffff';
    for (const q of glyphs) hat(q, 0, 0);
    h.globalCompositeOperation = 'destination-out';
    for (const q of glyphs) hat(q, CELL * 0.045, CELL * 0.06);
    g.save(); g.globalAlpha = 0.7; g.drawImage(hl, 0, 0); g.restore();
  }

  // 6. THE SCRAWLS. Placed OUTSIDE the piece's own line boxes, at the four corners of the canvas in
  //    a fixed order — a scrawl over the middle of a throw-up is a thing that happens on a real wall
  //    and looks, at this size, exactly like the bake having gone wrong.
  if (nMarks > 0) {
    g.save();
    g.font = TAG_SCRAWL_FONT(CELL);
    g.globalAlpha = 0.72;
    g.fillStyle = tagMix(P.line, P.halo, 0.35);
    const spots = [
      [PAD_X * 0.25, PAD_T * 0.55], [W - PAD_X * 0.9, PAD_T * 0.55],
      [PAD_X * 0.25, H - PAD_B * 0.28], [W - PAD_X * 0.9, H - PAD_B * 0.28],
    ];
    for (let i = 0; i < nMarks && i < spots.length; i++) {
      const s = spots[(i + (variant | 0)) % spots.length];
      g.save();
      g.translate(s[0], s[1]);
      g.rotate((R(200 + i * 13) - 0.5) * 0.5);
      g.fillText(TAG_SCRAWLS[Math.abs((variant | 0) + i * 3) % TAG_SCRAWLS.length], 0, 0);
      g.restore();
    }
    g.restore();
  }

  g.globalAlpha = 1;
  // ⚠ STAMPED AS PAINT, BECAUSE THE DECAL LAYER'S KEY IS WHAT THE GATES COUNT. `signTexKey` prefixes
  // every baked lettering canvas `st:`, and three gates read that prefix to mean "a sign": that it
  // must not go blank with distance (signrange), that it must stand proud of its own board
  // (boarddepth), and that nothing may be drawn across it (signfit). All three are wrong about a
  // throw-up — it has no board, nothing is written across it that was not already there, and it is
  // MEANT to shed past `detailNear`, because a sign that sheds leaves a blank board while paint
  // that sheds leaves an ordinary wall. Without this every model carrying a tag failed signrange on
  // the day the tag learned to spell.
  c.__tagPaint = 1;
  return keep(c);
}

// The six recipes by name, so `__tagSheet()` can lay one row out per hand rather than hoping the
// variant roll happens to visit all of them. The four throw-up letterforms likewise.
export const tagHandList = () => TAG_HANDS.slice();
export const tagFaceList = () => TAG_FACES.slice();
export const tagWordList = () => TAG_WORDS.slice();
// A throw-up's layout without the bake, for `scripts/shapes/tagspace.mjs`: every letter's outline
// where the bake puts it, plus the spacing it was set to. Needs no canvas beyond a measureText.
export const tagLayoutOf = (text, face, variant = 0) => {
  const body = String(text || '').trim();
  const CELL = 64;
  const L = body ? tagLayout(body, tagLines(body), face, variant, CELL) : null;
  return L && { ...L, cell: CELL, gap: CELL * TAG_GAP, word: CELL * TAG_WORD };
};
// The spray can's preview: the player's words and runs as the throw-up they will go up as, in the
// letterform they picked. Never cached — it re-bakes on every keystroke. See the ⚠ on `cache`.
// ⚠ ONLY THE LETTERS ARE THE WALL'S. The colour scheme and the wobble are rolled off the street tile
// the tag is keyed on, which the dialog does not know, so an unpainted tag can come out silver or
// bone on the wall where this shows it in the can's own green.
export const tagPreview = (text, runs, face = null, colour = '#b8f03a') =>
  bakeTagText(text, runs, colour, 0, 0, 0, 'throw', face || 'bubble', false);
