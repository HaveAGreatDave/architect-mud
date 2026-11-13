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
// The painters are every sport's, in ../comic-print.js; this file is Deadball's words, captions,
// inks and cameras, and the page under its own masthead.

import { REPLAY } from './replay.js';
import { onField } from './play.js';
import { COMIC, COMIC_INKS, paintPage as paintSheet } from '../comic-print.js';
export { COMIC, COMIC_INKS, PRINT, printPanel, loadComicFaces, paintBurst, paintWord, freezeLayout, paintFreeze, pageLayout, tellsMore, paintRun } from '../comic-print.js';

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

/** The page (comic-print.js paintPage) under Deadball's own masthead. */
export function paintPage(g, w, h, shots, word, words, t, o = {}) {
  return paintSheet(g, w, h, shots, word, words, t, { masthead: 'DEADBALL COMICS', ...o });
}
