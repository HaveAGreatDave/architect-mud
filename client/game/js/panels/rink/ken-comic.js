// Rinkside · KEN RAVEN, THE COMIC. In the first intermission, with comic replays on (the comic look,
// and motion allowed), the broadcast leaves the time-lapse for half a minute to thank the man on
// the Zamboni, as a comic hails its hero: six live shots of him and his work, each framed as a
// panel while it plays and then taken and held as a printed one, and then all six as a page,
// THANK YOU, KEN! in RINKSIDE COMICS No. 1, with confetti. Then back to the time-lapse. On Cup
// final night the machine is in its Cup colours (rink/livery.js CUP_NIGHT) and some lines change
// to say so (a shot's `cup`).
//
//   1. run   the shot, live, from a camera on the ice riding with the machine (rink/camera.js
//            `shotFrame`), in an ink border with its narration;
//   2. hold  its last frame printed (comic-print.js printPanel) and held, with his line in a
//            balloon; under it the camera moves on to the next shot;
//   3. page  the six panels as one page (paintSheet), fading back to the ice at the end.
//
// THE MACHINE GOES AT HIS PACE FOR THE SHOTS. The time-lapse would have him across the sheet in a
// shot, so the Zamboni runs at a lapse of 1 while they're on, and once they're done its lapse is set
// so it's through the gate when it would have been (`due`). The page hides the picture anyway.
//
// HE WAVES ON CUE. kenWave (rink/livery.js) has him wave 3 s in every 39; a shot that wants it sets
// `z.wave` so a wave starts as the shot does, and the frame taken at its end has his arm up.
//
// The live game is never held, and nothing here moves anything but the camera, the machine's lapse
// and his arm: the sheet is done the same with or without it. A seat in the stands never sees it;
// nor does a viewer who joins the break late, or a break the period comes back from early.
//
// rink/director.js starts and steps it (stageIntermission); rink/hud.js draws it over either renderer.
// The 2-D renderer has no camera on the ice, so it shows each shot from the broadcast side, close.

import { printPanel, paintLive, paintSnap, paintSheet } from '../comic-print.js';
import { RL, RW, RC } from './geo.js';
import { grab } from './comic.js';

// hold: how long each taken shot is held (s); page: the page; fade: the page's fade back to the
// ice, inside its time; after: how long the machine is out before it starts; room: how much of the
// break must be left for it to start (it's about 30 s, and the machine has the rest to finish in).
export const KEN_COMIC = Object.freeze({ hold: 1.3, page: 7.5, fade: 0.5, after: 4, room: 60 });

// Where Ken is on the machine, in its frame (feet: u forward, v to its left, w up): his head, from
// gl/arena-ken.js KEN_SEAT (the deck under his seat) and the height of a man sitting.
const HEAD = Object.freeze([-3.1, 1.5, 6.6]);

// THE SHOTS, in order. `eye` and `look` in the machine's frame; `side` 1 keeps the eye on its own
// side of the machine and -1 mirrors it (sideFor picks, a shot that needs his side not unless it
// must); `fov` degrees across; `run` seconds live; `at` the subject, which the page crops round and
// the balloon's tail points at; `wave` he waves through it; `say` his line; `cup` the narration
// and line in their place on Cup final night.
export const KEN_SHOTS = Object.freeze([
  { eye: [26, 13, 5.5], look: [0, 0, 3.5], fov: 52, run: 2.6, at: [0, 0, 4], narration: 'Meanwhile, the ice lies in ruins...',
    cup: { narration: 'Cup final night. The ice lies in ruins...' } },
  { eye: [9, 7, 8.6], look: [-3.1, 1.6, 6.6], fov: 50, run: 2.3, at: HEAD, wave: true, his: true, zoom: 1.3,
    narration: 'But one man answers the call. Ken Raven!', say: 'Evening, everybody!', cup: { say: 'Big night, everybody!' } },
  // the fresh ice behind the conditioner, wet and dark, and the machine going on
  { eye: [-24, -10, 5], look: [-7, 0, 0.8], fov: 50, run: 2.4, at: [-6, 0, 1], narration: 'Every gouge. Every chip. Every drop of blood. Gone.' },
  { eye: [2.5, 15, 4.6], look: [2.4, 0, 4.2], fov: 44, run: 2.3, at: [2.4, 3.4, 4.2], narration: 'He painted her himself.',
    cup: { narration: 'And on Cup night, she wears the gold.' } },
  // high over the sheet, looking back down at the strips he's laid
  { eye: [22, 14, 62], look: [-16, 0, 0], fov: 62, run: 2.4, at: [0, 0, 3], narration: 'Big loops, every pass over the last. Not one line left.' },
  // (high enough to see him over the snow tank, which hides him from anywhere low in front)
  { eye: [14, 12, 9], look: [-1.5, 1.2, 5.2], fov: 44, run: 2.3, at: HEAD, wave: true, his: true, zoom: 1.2,
    narration: 'The players get the cheers. The ice is all his.', say: 'See you in the second!' },
]);
// The page: the opening, his wave and his work across the top, the other three under them.
const PAGE_ROWS = [{ h: 1.1, cols: [0.3, 0.44, 0.26] }, { h: 1, cols: [0.32, 0.32, 0.36] }];
// a shot's words on the night: its own, or its Cup night's over them
const wordsOf = (S, final) => (final && S.cup ? { ...S, ...S.cup } : S);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// A point in the machine's frame `p` ([u, v, w], feet) on the ice, the machine `z` where it is now.
export function onMachine(z, p) {
  const ch = Math.cos(z.h), sn = Math.sin(z.h);
  return [z.x + p[0] * ch - p[1] * sn, z.y + p[0] * sn + p[1] * ch, p[2]];
}
// Whether (x, y) is on the ice with `m` ft to spare: inside the boards and their rounded corners.
function onIce(x, y, m = 2.5) {
  if (x < m || x > RL - m || y < m || y > RW - m) return false;
  const cx = clamp(x, RC, RL - RC), cy = clamp(y, RC, RW - RC);
  return Math.hypot(x - cx, y - cy) <= RC - m;
}
/**
 * A shot's eye and what it looks at, on the ice, with the machine `z` where it is now and the eye on
 * `side` (1 or -1). An eye that would be past the boards is pulled in along its line toward what
 * it looks at, down to 55% of the way; `k` is how far out it is, `ok` whether it made the ice.
 */
export function shotEye(S, z, side = 1) {
  const L = onMachine(z, S.look), E0 = onMachine(z, [S.eye[0], S.eye[1] * side, S.eye[2]]);
  const at = (k) => [L[0] + (E0[0] - L[0]) * k, L[1] + (E0[1] - L[1]) * k, L[2] + (E0[2] - L[2]) * k];
  if (onIce(E0[0], E0[1])) return { E: E0, L, k: 1, ok: true };
  let lo = 0.55, hi = 1;
  if (!onIce(...at(lo).slice(0, 2))) return { E: at(lo), L, k: lo, ok: false };
  for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (onIce(...at(m).slice(0, 2))) lo = m; else hi = m; }
  return { E: at(lo), L, k: lo, ok: true };
}
// Which side a shot is taken from: its own, unless that's against the boards and the other isn't.
// One that's on him (`his`, his wave is his outside arm) keeps his side unless it really can't.
function sideFor(S, z) {
  const a = shotEye(S, z, 1), b = shotEye(S, z, -1);
  const need = S.his ? 0.7 : 0.9;
  if (a.ok && a.k >= need) return 1;
  if (b.ok && (b.k > a.k + 0.05 || !a.ok)) return -1;
  return 1;
}

/** Whether a break can have it: the first, the machine out long enough, and room left. */
export function kenComicDue(W, period, left) {
  const z = W.zamboni;
  return period === 1 && !!z && !z.leaving && (left == null || left > KEN_COMIC.room);
}

/** Starts it on the machine that's out now. `issue` the masthead's number. */
export function startKenComic(W, issue = 1) {
  const z = W.zamboni;
  if (!z || z.leaving) return null;
  const K = {
    i: 0, beat: 'run', t0: W.t, cut: false, issue, prints: [], ats: [], final: !!W.final,
    // when the machine was going to be through: the time-lapse makes it up after the shots
    due: W.t + Math.max(0, W.zamboniTime() - z.mt) / Math.max(1, z.lapse), lapse0: z.lapse,
  };
  W.kenComic = K;
  z.lapse = 1;
  shoot(W, 0, W.t);
  return K;
}
// The camera on shot `i`, which goes live at `from` (a wave starts with it).
function shoot(W, i, from) {
  const S = KEN_SHOTS[i], z = W.zamboni;
  W.cam.mode = 'ken';
  W.cam.shot = { ...S, side: z ? sideFor(S, z) : 1 };
  if (S.wave && z) z.wave = from - 0.1;
}
// Back to the time-lapse: fast enough to be through the gate when it was going to be.
function release(W, K) {
  const z = W.zamboni;
  if (z && !z.leaving) z.lapse = clamp((W.zamboniTime() - z.mt) / Math.max(1, K.due - W.t), Math.min(3, K.lapse0), 60);
  if (W.cam.mode === 'ken') W.cam.mode = 'zam';
  W.cam.shot = null;
}
/** Ends it now, wherever it's got to. */
export function stopKenComic(W) {
  const K = W.kenComic;
  if (!K) return;
  if (K.beat !== 'page') release(W, K);
  W.kenComic = null;
  if (W.zamboni) W.zamboni.wave = null;
}
/** One step of the world: the beats moved on by the world's clock. */
export function stepKenComic(W) {
  const K = W.kenComic;
  if (!K) return;
  const z = W.zamboni, bt = W.t - K.t0, n = KEN_SHOTS.length;
  // (the machine called off or gone: there's nothing left to shoot)
  if (K.beat !== 'page' && (!z || z.leaving)) { stopKenComic(W); return; }
  if (K.beat === 'run') {
    if (bt >= KEN_SHOTS[K.i].run) { K.beat = 'hold'; K.t0 = W.t; K.cut = false; }
    return;
  }
  if (K.beat === 'hold') {
    // the camera moves on under the held frame once it's been taken (the overlay takes it on the
    // first frame drawn), or after half a second if nothing draws it
    if (!K.cut && (K.prints[K.i] !== undefined || bt > 0.5)) {
      K.cut = true;
      if (K.i + 1 < n) shoot(W, K.i + 1, K.t0 + KEN_COMIC.hold);
    }
    if (bt >= KEN_COMIC.hold) {
      if (K.i + 1 < n) { K.i++; K.beat = 'run'; K.t0 = W.t; }
      else { K.beat = 'page'; K.t0 = W.t; release(W, K); }
    }
    return;
  }
  if (bt >= KEN_COMIC.page) { W.kenComic = null; if (z) z.wave = null; }
}

// where the shot's subject is in the frame just drawn, as fractions; null if it's off it
function placeOf(W, S, P, w, h) {
  const z = W.zamboni;
  if (!z || typeof P !== 'function') return null;
  const q = P(...onMachine(z, S.at));
  if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
  const u = q.x / w, v = q.y / h;
  return u > -0.1 && u < 1.1 && v > -0.1 && v < 1.1 ? [clamp(u, 0, 1), clamp(v, 0, 1)] : null;
}

/**
 * Its beat over the picture (rink/hud.js drawHud), `W` the live world: `o.P` the camera's projection
 * and `o.picture` the canvas just drawn, as for a comic replay. False when it isn't on.
 */
export function drawKenComic(g, W, w, h, u, o = {}) {
  const K = W && W.kenComic;
  if (!K) return false;
  const bt = W.t - K.t0, S = wordsOf(KEN_SHOTS[K.i], K.final);
  if (K.beat === 'run') { paintLive(g, w, h, bt, S.narration); return true; }
  if (K.beat === 'hold') {
    if (K.prints[K.i] === undefined) {
      // the frame just drawn is the shot: taken, printed, and where its subject is on it kept
      const doc = o.picture?.ownerDocument || g.canvas?.ownerDocument || globalThis.document;
      const shot = grab(doc, o.picture);
      K.prints[K.i] = (shot && printPanel(doc, shot)) || shot || null;
      K.ats[K.i] = placeOf(W, S, o.P, w, h);
    }
    const at = K.ats[K.i];
    paintSnap(g, w, h, K.prints[K.i], bt, { narration: S.narration, say: S.say, at: at ? [at[0] * w, at[1] * h] : null });
    return true;
  }
  const frames = KEN_SHOTS.map((s0) => wordsOf(s0, K.final)).map((s, i) => ({ img: K.prints[i] || null, at: K.ats[i] || [0.5, 0.5], narration: s.narration, say: s.say, zoom: s.zoom }));
  paintSheet(g, w, h, frames, bt, {
    rows: PAGE_ROWS, headline: 'THANK YOU, KEN!', masthead: 'RINKSIDE COMICS', issue: K.issue, confetti: true,
    alpha: clamp((KEN_COMIC.page - bt) / KEN_COMIC.fade, 0, 1),
  });
  return true;
}
