// Rinkside · THE COMIC REPLAY. With the comic look on (gl/house-style.js comicOn), the rink's big
// moments are replayed as a comic draws them (docs/proposals/comic-ink.md, comic replays), the way
// Deadball's are (diamond/comic.js), in the same four beats:
//
//   1. run    the play in slow motion up to its moment, framed in ink with speed lines;
//   2. freeze the moment held and printed (comic-print.js printPanel): a flash and a negative frame,
//             focus lines in to an explosion balloon, and its sound hand lettered over it;
//   3. after  the rest in slow motion, `AND THEN...`;
//   4. page   the moment as a story (comic-print.js paintStory): the action big on the right (the
//             freeze's own frame, with its burst, its word and the play told in a narration box),
//             and down the left, small, just before it and just after it (the puck in the net and
//             the lamp on, the puck in his glove, the man flat on the ice), under the RINKSIDE
//             COMICS masthead, numbered by the period.
//
// Four kinds of moment earn one (rink/director.js keeps and shows them):
//
//   goal   every goal, on the booth's replay cue, in place of the plain replay; a shot off the
//          post is a big shot too, shown at the next stoppage;
//   save   a glove save, a pad save and a breakaway stopped, at the next stoppage;
//   hit    a hit on the boards, at the draw the booth brings it up over, seen or not;
//   fight  the punch that knocks a man down, once they're on their way to the box. A fight that
//          ends with his sweater over his head has no finish to draw (nobody goes down), so it
//          gets none.
//
// The action is what the freeze is on: for a goal the puck going past the goalie, with its flight
// from the stick inked in behind it (rink/replay.js `past`, `inkPath` here); the puck into the
// glove or off the post, its line inked in too; the impact; the punch landing. Each clip runs on long enough past it (`RINK_COMIC.after`)
// for its last frame, the page's "after", to be the end of it. A replay framed on a goalie (a save,
// and a goal's from the freeze on) has the men between the camera and him left out (rink/replay.js
// `clear`), or the crowd in front of his crease hid him.
//
// The live game is never held: the replay plays in its own world (rink/replay.js), which holds its
// clock for the freeze and the page. A slot too short for the page drops it, and one too short for
// the freeze plays the plain replay (`comicPlan`). With reduced motion there's no comic replay.
//
// The painters are every sport's (comic-print.js). This file is the rink's words and the overlay
// that drives them over either renderer (rink/hud.js drawHud calls `drawComic`).

import { COMIC, COMIC_INKS, printPanel, paintFreeze, paintStory, paintRun } from '../comic-print.js';

// run: the least slow motion worth a comic replay (s of the game's clock); room: the most a
// stoppage gives one, when nothing else bounds it; capW: how wide a panel is taken (px); after:
// how long the clip runs on past the moment (s of the play), so its last frame is the finish (a
// goal's past the puck going in, to the lamp; a man hit or punched is on the ice by then); before:
// how far through the run-up the page's "before" is taken.
export const RINK_COMIC = Object.freeze({ run: 2.5, room: 11, capW: 1280, after: 1.8, goalAfter: 2.2, before: 0.6 });

// The inks the rink adds to the shared ones: a hit's bruise and a fight's blood.
export const RINK_INKS = Object.freeze({
  bruise: Object.freeze(['#f6e9ff', '#b26bff', '#2a0b4f', '#6d2bd0']),
  blood: Object.freeze(['#fff0e0', '#ff4a2e', '#4a0606', '#a3121a']),
});

// The sound of each moment, a few to pick from so a night of them doesn't say one thing. By kind,
// then by what happened (the save's kind, the hit's style, the fight's ending).
export const RINK_WORDS = Object.freeze({
  goal: ['KRAKK!', 'SNIPE!', 'KA-BLAM!', 'BOOM!', 'SWISH!', 'TWINE!'],
  post: ['PINGG!', 'CLANG!', 'DOINK!', 'TWANGG!'],
  glove: ['THWAP!', 'SNAG!', 'FWAP!', 'YOINK!'],
  pad: ['WHUMP!', 'THUNK!', 'KA-THUD!'],
  breakaway: ['DENIED!', 'STONED!', 'NOPE!', 'THWAP!'],
  hit: ['KA-RUNCH!', 'WHAM!', 'SMASH!', 'KRUNCH!', 'THUD!', 'BOOM!'],
  glass: ['KER-RASH!', 'SMASH!', 'WHAM!'],
  knockdown: ['POW!', 'BAM!', 'SOCK!', 'BIFF!', 'KA-POW!', 'WHAP!'],
});
// The page's two small frames: just before the action, and just after it (how it ended). A goal
// has a few.
export const RINK_CAPTIONS = Object.freeze({
  goal: [['HE WINDS UP...', '...LIGHT THE LAMP!'], ['ONE CHANCE...', '...IT\'S IN!'], ['HE LETS IT GO...', '...TWINE!']],
  post: [['HE LETS IT GO...', '...AND OUT!']],
  glove: [['HE PICKS HIS SPOT...', '...AND HE HOLDS IT!']],
  pad: [['LOW AND HARD...', '...AND CLEARED!']],
  breakaway: [['ALL ALONE...', '...NOTHING DOING!']],
  hit: [['HEAD DOWN...', '...FLAT ON THE ICE!']],
  glass: [['ALONG THE BOARDS...', '...AND DOWN HE GOES!']],
  knockdown: [['THE GLOVES COME OFF...', '...LIGHTS OUT!']],
});
export const RINK_HEADLINES = Object.freeze({
  goal: 'GOAL!', post: 'OFF THE POST!', glove: 'GLOVE SAVE!', pad: 'PAD SAVE!', breakaway: 'BREAKAWAY STOPPED!',
  hit: 'BIG HIT!', glass: 'INTO THE GLASS!', knockdown: 'KNOCKOUT!',
});
const INK_OF = { goal: 'hot', post: 'cold', glove: 'cold', pad: 'cold', breakaway: 'cold', hit: 'bruise', glass: 'bruise', knockdown: 'blood' };
// The saves and shots that are kept for a comic replay at the next stoppage (a goal has its own).
export const COMIC_CHANCES = new Set(['post', 'glove', 'pad', 'breakaway']);

/** A play's period, 1 to 3 or 4 for overtime: its own `period`, or its `section` ('2nd', 'OT'). */
export function periodOf(p) {
  if (Number.isFinite(p?.period)) return p.period;
  const s = String(p?.section || '');
  return /OT/i.test(s) ? 4 : parseInt(s, 10) || null;
}
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const up = (s) => String(s || '').trim().split(/\s+/).pop().toUpperCase();
const ORD = ['', 'FIRST', 'SECOND', 'THIRD'];

// What a moment's style is, for its words: a hit into the glass has its own, every other hit is a hit.
const styleOf = (kind, sub) => (kind === 'hit' ? (sub === 'glass' ? 'glass' : 'hit') : kind === 'fight' ? 'knockdown' : kind === 'goal' ? 'goal' : sub);

// The play in a sentence, for the page's narration box.
function tell(kind, sub, f) {
  const a = up(f.a) || 'HE', b = up(f.b);
  if (kind === 'goal') {
    if (f.strength === 'en' || !b) return `${a} PUTS IT INTO THE EMPTY NET`;
    return f.shot ? `${a} BEATS ${b} WITH A ${String(f.shot).toUpperCase()}` : `${a} BEATS ${b} AND THE PLACE GOES UP`;
  }
  if (kind === 'post') return `${a} RINGS ONE OFF THE POST`;
  if (kind === 'save') {
    const g = b || 'THE GOALIE';
    if (sub === 'glove') return `${g} ROBS ${a} WITH THE GLOVE`;
    if (sub === 'pad') return `${g} GETS A PAD ON ${a}`;
    return `${g} STONES ${a} ALL ALONE`;
  }
  if (kind === 'hit') {
    const v = b || 'HIM';
    return {
      glass: `${a} PUTS ${v} INTO THE GLASS`, elbow: `${a} GETS AN ELBOW UP ON ${v}`, behind: `${a} HITS ${v} FROM BEHIND`,
      hip: `${a} HIP-CHECKS ${v} OFF HIS SKATES`, crosscheck: `${a} CROSS-CHECKS ${v} IN OPEN ICE`,
    }[sub] || `${a} LAYS OUT ${v} WITH THE SHOULDER`;
  }
  return `${a} PUTS ${b || 'HIM'} ON THE ICE`;
}

/**
 * Everything a comic replay of one moment says, picked off its facts so every TV says the same:
 * `kind` goal, post, save, hit or fight; `sub` the save's kind, the hit's style or the fight's
 * ending; `f` { a, b } the names (the shooter and the goalie, the hitter and the man hit, the
 * winner and the loser), and for a goal its `shot` label and `strength`; `period`; `note` what the
 * run's foot says instead of the period (a hit's HITTER ON VICTIM).
 */
export function comicSpecOf(kind, sub = null, f = {}) {
  const style = styleOf(kind, sub);
  const seed = hashStr(`${kind}|${sub}|${f.a || ''}|${f.b || ''}|${f.clock ?? ''}`);
  const words = RINK_WORDS[style] || RINK_WORDS.goal, caps = RINK_CAPTIONS[style] || RINK_CAPTIONS.goal;
  let headline = RINK_HEADLINES[style] || 'REPLAY!';
  if (kind === 'goal') headline = { pp: 'POWER-PLAY GOAL!', sh: 'SHORTHANDED GOAL!', en: 'EMPTY NET!' }[f.strength] || headline;
  const per = Number.isFinite(f.period) && f.period > 0 ? f.period | 0 : null;
  return {
    kind, sub, word: words[seed % words.length], captions: caps[(seed >>> 8) % caps.length], headline,
    desc: tell(kind, sub, f), inks: RINK_INKS[INK_OF[style]] || COMIC_INKS[INK_OF[style]] || COMIC_INKS.hot,
    seed: seed % 9973, issue: per,
    note: f.note || (per ? (per > 3 ? 'OVERTIME' : `${ORD[per]} PERIOD`) : null),
  };
}

/**
 * What a slot of `room` seconds has room for: 'page' (the whole comic replay), 'freeze' (no page),
 * or null (the plain replay, if that). The slow motion gets what's left (`comicExtra`).
 */
export function comicPlan(room) {
  if (!(room > 0)) return null;
  if (room >= RINK_COMIC.run + COMIC.freeze + COMIC.page) return 'page';
  if (room >= RINK_COMIC.run + COMIC.freeze) return 'freeze';
  return null;
}
/** The seconds a plan adds to the slow motion: the freeze, and the page. */
export const comicExtra = (plan) => (plan === 'page' ? COMIC.freeze + COMIC.page : plan === 'freeze' ? COMIC.freeze : 0);

// ── the overlay ─────────────────────────────────────────────────────────────────────────────────────
// The replay's own comic state (rink/replay.js) is `W.comic` on its stand-in world: the beat it's in
// (`beat`, `bt` seconds into it), the replay's clock (`rt`), where the moment was (`key`), and where
// in the world the moment and the man at it are this frame (`world`). The page's three frames are
// taken off the picture as the beats pass them and kept on it: just before the action
// (RINK_COMIC.before of the way through the run-up), the action (the first frame of the freeze),
// and just after it (the clip's last frame, as the page starts: how it ended).

// a copy of the picture, at most capW wide; null if it can't be read
function grab(doc, picture) {
  const pw = picture?.width | 0, ph = picture?.height | 0;
  if (!doc?.createElement || !(pw > 0 && ph > 0)) return null;
  try {
    const s = Math.min(1, RINK_COMIC.capW / pw), c = doc.createElement('canvas');
    c.width = Math.max(1, Math.round(pw * s)); c.height = Math.max(1, Math.round(ph * s));
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(picture, 0, 0, c.width, c.height);
    return c;
  } catch { return null; }
}

// where the moment and the man at it are on screen this frame, through the replay's camera `P`
function placeOf(C, P, w, h) {
  const M = C.world;
  if (!M || typeof P !== 'function') return null;
  const at = M.at && P(M.at[0], M.at[1], M.at[2]);
  if (!at) return null;
  let dir = null;
  if (M.dir) {
    const l = Math.hypot(M.dir[0], M.dir[1], M.dir[2]);
    const q = l > 1e-6 && P(M.at[0] + M.dir[0] / l * 2, M.at[1] + M.dir[1] / l * 2, M.at[2] + M.dir[2] / l * 2);
    if (q) dir = [q.x - at.x, q.y - at.y];
  }
  let subject = null;
  if (M.head && M.foot) {
    const a = P(M.head[0], M.head[1], M.head[2]), b = P(M.foot[0], M.foot[1], M.foot[2]);
    if (a && b) subject = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.max(Math.min(w, h) * 0.05, Math.hypot(a.x - b.x, a.y - b.y) * 0.58) };
  }
  // the shot's flight, on screen (points behind the camera dropped)
  let path = null;
  if (M.path) {
    path = [];
    for (const p of M.path) { const q = P(p[0], p[1], p[2]); if (q && Number.isFinite(q.x) && Number.isFinite(q.y)) path.push([q.x, q.y]); }
    if (path.length < 2) path = null;
  }
  return { x: at.x, y: at.y, dir, subject, path };
}

// THE SHOT'S LINE, inked into the action's frame before it's printed, so the freeze and the page's
// big panel both have it: from the stick to the puck as it beats him, a streak that thickens toward
// the puck, black round a bright ink, with a few speed ticks off it. `s` screen to canvas.
function inkPath(c, path, s, inks) {
  const g = c && c.getContext && c.getContext('2d');
  if (!g || !path) return;
  const pts = path.map(([x, y]) => [x * s, y * s]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (len < 12) return;
  const W0 = Math.max(2, c.width * 0.0025), W1 = Math.max(6, c.width * 0.012);
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  const pass = (col, extra) => {
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      run += Math.hypot(b[0] - a[0], b[1] - a[1]);
      g.strokeStyle = col; g.lineWidth = W0 + (W1 - W0) * (run / len) + extra;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
  };
  pass(inks?.[2] || '#111', Math.max(3, c.width * 0.004));
  pass(inks?.[1] || '#ffd23a', 0);
  pass(inks?.[0] || '#fff', -W0 * 0.8);
  // speed ticks: short strokes either side, every so far along
  g.strokeStyle = inks?.[2] || '#111'; g.lineWidth = Math.max(1.5, c.width * 0.002);
  const step = Math.max(24, len / 9);
  let run = 0, next = step;
  for (let i = 1; i < pts.length && next < len - step * 0.5; i++) {
    const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (d > 0 && run + d >= next && next < len - step * 0.5) {
      const f = (next - run) / d, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d, off = W1 * 1.4, tl = W1 * 1.6;
      for (const sd of [-1, 1]) {
        const ox = x - uy * off * sd, oy = y + ux * off * sd;
        g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox - ux * tl, oy - uy * tl); g.stroke();
      }
      next += step;
    }
    run += d;
  }
  g.restore();
}

/**
 * The comic replay's beat over the picture, in place of the plain replay's letterbox and bug. `W`
 * is the replay's stand-in world; `o.P` its camera's projection and `o.picture` the canvas the frame
 * was just drawn on (taken from in the same task, so a WebGL canvas needs no preserved buffer).
 * Returns false when there's no comic replay on, so the caller draws the plain one.
 */
export function drawComic(g, W, w, h, u, o = {}) {
  const C = W && W.comic;
  if (!C || !C.spec) return false;
  const S = C.spec, doc = o.picture?.ownerDocument || g.canvas?.ownerDocument || globalThis.document;
  // shots and prints in the page's order (storyLayout): [before, after, the action]
  const shots = C.shots || (C.shots = [null, null, null]), prints = C.prints || (C.prints = [null, null, null]);
  const ok = (c) => (c && c.width ? c : null);
  if (C.beat === 'run') {
    // (kept raw here and printed under the freeze's flash, so the slow motion never stalls on it)
    if (!shots[0] && C.rt >= C.from + (C.key - C.from) * RINK_COMIC.before) shots[0] = grab(doc, o.picture);
    paintRun(g, w, h, C.bt, 0, { note: S.note });
    return true;
  }
  if (C.beat === 'freeze') {
    // the first frame of the freeze: the action taken, it and the "before" printed under the flash,
    // and where things are on screen kept for the page
    if (!prints[2]) {
      shots[2] = grab(doc, o.picture);
      C.place = placeOf(C, o.P, w, h) || { x: w / 2, y: h / 2, dir: null, subject: null };
      if (shots[2] && C.place.path) inkPath(shots[2], C.place.path, shots[2].width / w, S.inks);
      prints[2] = (shots[2] && printPanel(doc, shots[2])) || shots[2] || o.picture || {};
      prints[0] = (shots[0] && printPanel(doc, shots[0])) || shots[0] || {};
    }
    const L = C.place;
    paintFreeze(g, w, h, L.x, L.y, S.word, C.bt, { print: ok(prints[2]), dir: L.dir, subject: L.subject, seed: S.seed, inks: S.inks });
    return true;
  }
  if (C.beat === 'after') {
    paintRun(g, w, h, C.bt, 1);
    return true;
  }
  if (C.beat === 'page') {
    // the page's first frame is the clip's last: just after the action, how it ended
    if (!prints[1]) {
      shots[1] = grab(doc, o.picture);
      prints[1] = (shots[1] && printPanel(doc, shots[1])) || shots[1] || {};
    }
    const L = C.place || { x: w / 2, y: h / 2 };
    const sub = L.subject ? { x: L.subject.x / w, y: L.subject.y / h, r: L.subject.r / h } : null;
    // the action big on the right, just before it and just after it small down the left
    paintStory(g, w, h, prints.map(ok), S.word, S.headline, C.bt,
      { desc: S.desc, captions: S.captions, at: [L.x / w, L.y / h], subject: sub, dir: L.dir, seed: S.seed, inks: S.inks, issue: S.issue, masthead: 'RINKSIDE COMICS' });
    return true;
  }
  return false;
}
