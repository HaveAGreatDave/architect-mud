// DEADBALL · THE PARK CLOCK. When every pitch is thrown in the park, for a seat in the stands that
// has no camera cuts to hide a jump in time (docs/proposals/coliseum-seats.md).
//
// A payload's window is its line's hold: the time from its line going up to the next payload's
// (`hold`, which the server writes for a sport with `holdSpansGap`). The booth is paced by the park
// (plugins/broadcast/sports/baseball-pacing.js), so the window already covers the play's landing
// and what the park does after it, by the numbers in diamond/timing.js. This lays the pitches out
// inside it, whole: no pitch is left out and nothing is placed on a cut.
//
// Each play's need, at its quickest, from timing.js:
//   - every pitch but the last, a cycle of at least CYCLE_MIN from the start of the pitcher's motion
//     to the start of the next one: the pitch to the plate at its quickest (LAST_PITCH) and the
//     catcher's throw back to a pitcher already on the rubber (THROW_BACK)
//   - the last pitch to the plate (LAST_PITCH), the ball in play or the call (playRoom) and what the
//     park does after the landing (afterLand): a home run's trot and replay, the field walking back
//   - a play on the bases (`phase: 'run'`) the same, on the one pitch it runs on, which isn't in any
//     at-bat's list
//   - a changeover (`phase: 'half'`), CHANGEOVER_MIN
// What the window has over its need is slack, shared out by weight (SHARE): most to the gaps
// between pitches, where a real game spends it, some to the reset after each play and a little
// before the first pitch. A changeover takes its share too. The gaps vary a little from one to the
// next, seeded from the game's seed and CLOCK_SALT, so a pitcher doesn't work like a metronome; the
// stream is this file's own and never touches the sim's.
//
// A play the booth doesn't call (a throw over it leaves out, a plate appearance in extra innings
// that doesn't score) rides the window before it, in that payload's `then` list, after its own play.
//
//   needOf(p)                    one play's need at its quickest: { gaps, pitches, fixed } (s)
//   windowNeed(p)                the window's: its play's and its `then` plays' together
//   cycleOf(p)                   the pitch cycle the window affords, every pitch shown (s); Infinity
//                                for a window with no gap between pitches that fits, and -Infinity
//                                for one that doesn't fit at all
//   parkClock(payloads, { seed })
//       -> [{ at, len, t, end, cycle, slack, over }] for each payload, in ms from the first
//          window's start: `at` and `len` the window, `t` the release of each of its pitches (its
//          own, then its `then` plays', in order) from the window's start, `end` where its last
//          play's reset ends (the window's end, when it fits), `cycle` (s) the slowest the pitches
//          could go, `slack` (s) the window's time over its need at CYCLE_MIN, which is shared
//          out, and `over` true when that's negative: the pitches go at CYCLE_MIN and run past it.
//
// Pure: imports only timing.js, the numbers the server already sizes its lines by. Baseball, not
// Deadball: it names nothing in the world.
import { LAST_PITCH, playRoom, afterLand } from './timing.js';

export const CLOCK_SALT = 0x504b434c;
// The catcher's throw back to a pitcher on the rubber, from the catch to the ball in his glove (s):
// the lob's flight and the catcher coming up to throw it.
export const THROW_BACK = 1.5;
// The quickest a pitch can be seen whole from a seat (s), from the start of one motion to the next.
export const CYCLE_MIN = LAST_PITCH + THROW_BACK;
// The quickest changeover (s): the side in the field off to its dugout and the other side out to
// its places, the furthest man (centre field) jogging about 330 ft.
export const CHANGEOVER_MIN = 30;
// The slack's weights: each gap between pitches, each play's reset, the lead before a window's first
// pitch, a changeover; and how much one gap's weight varies from the next (a share either way).
export const SHARE = Object.freeze({ gap: 1, reset: 1.5, lead: 0.5, change: 1, vary: 0.35 });
// From the release to the plate: the distance the ball flies (ft) at the pitch's speed.
const FLIGHT_FT = 55, FT_PER_MPH = 5280 / 3600;
const flightOf = (q) => FLIGHT_FT / (Math.max(50, Number(q?.velo) || 90) * FT_PER_MPH);

export function needOf(p) {
  if (!p || p.phase === 'arrive') return { gaps: 0, pitches: 0, fixed: 0 };
  if (p.phase === 'half') return { gaps: 0, pitches: 0, fixed: CHANGEOVER_MIN, change: true };
  const n = p.phase === 'run' ? 0 : (Array.isArray(p.pitches) ? p.pitches.length : 0);
  return { gaps: Math.max(0, n - 1), pitches: n, fixed: LAST_PITCH + playRoom(p) + afterLand(p) };
}
const playsOf = (p) => [p, ...(Array.isArray(p?.then) ? p.then : [])];
export function windowNeed(p) {
  const out = { gaps: 0, pitches: 0, fixed: 0, changes: 0, plays: 0 };
  for (const q of playsOf(p)) {
    const n = needOf(q);
    out.gaps += n.gaps; out.pitches += n.pitches; out.fixed += n.fixed;
    if (n.change) out.changes++;
    if (q && q.phase !== 'arrive' && q.phase !== 'half') out.plays++;
  }
  return out;
}
const lenOf = (p) => Math.max(0, Number.isFinite(p?.hold) ? p.hold / 1000 : 0);
export function cycleOf(p) {
  const L = lenOf(p), n = windowNeed(p);
  if (n.gaps === 0) return L >= n.fixed ? Infinity : -Infinity;
  return (L - n.fixed) / n.gaps;
}

// The cosmetic stream: an integer mix, then xorshift.
function mix(...nums) {
  let h = 0x811c9dc5;
  for (const x of nums) { h = Math.imul(h ^ (x >>> 0), 0x01000193); h ^= h >>> 15; }
  return h >>> 0;
}
function rngOf(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function parkClock(payloads, { seed = 0 } = {}) {
  const out = [];
  let at = 0;
  (payloads || []).forEach((p, k) => {
    const L = lenOf(p), need = windowNeed(p);
    const cycle = need.gaps ? (L - need.fixed) / need.gaps : (L >= need.fixed ? Infinity : -Infinity);
    const minNeed = need.fixed + need.gaps * CYCLE_MIN;
    const over = L + 1e-9 < minNeed;
    // the weights, each gap's varied
    const rand = rngOf(mix(seed, CLOCK_SALT, k));
    const gapW = [];
    for (let i = 0; i < need.gaps; i++) gapW.push(SHARE.gap * (1 + SHARE.vary * (2 * rand() - 1)));
    const plays = playsOf(p).filter((q) => q && q.phase !== 'arrive');
    const resets = plays.filter((q) => q.phase !== 'half').length;
    const totalW = gapW.reduce((a, w) => a + w, 0) + resets * SHARE.reset + need.changes * SHARE.change + SHARE.lead;
    // over its need, the slack is shared out; under it, everything goes at its quickest and the
    // window runs over (`end` past `len`), which is the overrun a gate looks for
    const slack = L - minNeed;
    const share = (w) => (slack >= 0 ? slack * w / totalW : 0);
    const gapAdd = (i) => share(gapW[i]);
    const t = [];
    let cursor = share(SHARE.lead), g = 0;
    for (const q of plays) {
      if (q.phase === 'half') { cursor += CHANGEOVER_MIN + share(SHARE.change); continue; }
      const pitches = q.phase === 'run' ? [] : (Array.isArray(q.pitches) ? q.pitches : []);
      // a play on the bases runs on a pitch of its own, which nobody's list carries
      if (!pitches.length) { cursor += LAST_PITCH + playRoom(q) + afterLand(q) + share(SHARE.reset); continue; }
      pitches.forEach((pitch, i) => {
        const start = cursor;
        t.push(Math.round((start + LAST_PITCH - flightOf(pitch)) * 1000));
        if (i < pitches.length - 1) cursor = start + CYCLE_MIN + gapAdd(g++);
        else cursor = start + LAST_PITCH + playRoom(q) + afterLand(q) + share(SHARE.reset);
      });
    }
    out.push({ at: Math.round(at * 1000), len: Math.round(L * 1000), t, end: Math.round(cursor * 1000), cycle, slack, over });
    at += L;
  });
  return out;
}
