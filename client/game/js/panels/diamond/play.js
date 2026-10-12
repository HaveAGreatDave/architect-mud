/**
 * DEADBALL — a ball in play: where it goes, how long it takes, and who can get to it.
 *
 * The broadcast decides every ball in play on the server (synthPlay in
 * plugins/broadcast/sports/baseball.js), so the booth's line can agree with the picture, and the
 * 3-D park stages what it decided. Both judge a play from here: where the nine stand, how far a
 * ball in the air carries and how long it hangs, how long a ball on the ground takes to get
 * somewhere, and how far a fielder can get in that time. A play's grade (routine, ranging,
 * diving) is the share of his reach the fielder needed, so the grade on the wire is one the
 * picture can show.
 *
 * Spray is in degrees from straightaway centre: negative toward the left-field line (-45),
 * positive toward the right-field line (+45), and past either in foul ground. The park's frame is
 * geo.js's, with +x toward third, so a ball to left field has +x.
 *
 * Fielders are numbered the way a scorer numbers them: 1 the pitcher, 2 the catcher, 3 to 6
 * first, second, third and short, 7 to 9 left, centre and right.
 *
 * Pure: no DOM and no GL. The server imports it.
 */

import { BAGS, DEG, fenceDistance, VENUE_DEFAULTS, FOUL_GROUND } from './geo.js';
import { GRAVITY, MPH } from './flight.js';

// By scorer's number.
export const POSITIONS = Object.freeze(['', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);

// Where each man stands as the pitch comes in: the pitcher where his delivery leaves him, a few
// strides off the rubber, and the rest straight up. fieldSpots shades them to the hitter's pull
// side.
const SPOTS = Object.freeze({
  1: [0, 0, 55], 2: [0, 0, -2.75], 3: [-68, 0, 84], 4: [-36, 0, 136], 5: [62, 0, 82], 6: [33, 0, 140],
  7: [135, 0, 262], 8: [-4, 0, 318], 9: [-128, 0, 255],
});
// How far each shades toward the pull side, in degrees round the plate.
const SHADE = Object.freeze({ 3: 1.5, 4: 3, 5: 3, 6: 3, 7: 6, 8: 6, 9: 6 });

// A spray and a distance from the plate as a point in the park, and back.
export const toPark = (dir, d, y = 0) => [-d * Math.sin(dir * DEG), y, d * Math.cos(dir * DEG)];
export const sprayOf = (p) => Math.atan2(-p[0], p[2]) / DEG;
export const fenceAt = (dir, fence = VENUE_DEFAULTS.fence) => fenceDistance(dir * DEG, fence);

// The nine's spots against a hitter who bats from `bats`: a right-hander pulls to left, so the
// fielders shade that way.
export function fieldSpots(bats) {
  const s = bats === 'L' ? 1 : -1;
  const out = {};
  for (let n = 1; n <= 9; n++) {
    const p = SPOTS[n], k = SHADE[n] || 0;
    out[n] = k ? toPark(sprayOf(p) + s * k, Math.hypot(p[0], p[2])) : p.slice();
  }
  return out;
}

// How far into foul ground a ball comes down: past the nearer line, or behind the plate.
export function foulDepth(dir, d) {
  const a = Math.abs(dir);
  if (a <= 45) return 0;
  if (a >= 135) return d;
  return d * Math.sin((a - 45) * DEG);
}
// How far inside the stands a spot in foul ground is: the rail stands FOUL_GROUND.line off the
// lines and the backstop FOUL_GROUND.back behind the plate. Negative is past them, in the seats.
export const railRoom = (dir, d) => (Math.abs(dir) >= 135 ? FOUL_GROUND.back - d : FOUL_GROUND.line - foulDepth(dir, d));

// ── a ball in the air ─────────────────────────────────────────────────────────
// How far it carries before it first comes down, in feet, and how long it hangs, off the bat at
// `ev` mph and `la` degrees: fitted to a broadcast's figures. 100 mph at 30 degrees carries about
// 395 ft and hangs about 4.3 s; at 15 degrees it's a liner that lands about 280 ft out; a pop-up at
// 60 goes up for five seconds and comes down about 110 ft away.
const lift = (la) => (la <= 30 ? Math.sin(Math.max(0, 3 * la) * DEG) : Math.cos((la - 30) * 1.9 * DEG));
export const carry = (ev, la) => Math.max(0, ev - 40) * 6.6 * Math.max(0, lift(la));
// The exit speed that carries `d` feet at `la`.
export const evFor = (d, la) => { const h = lift(la); return h > 0.02 ? 40 + d / (6.6 * h) : Infinity; };
export const hangTime = (ev, la) => (1.9 * ev * MPH * Math.sin(Math.max(1, la) * DEG)) / GRAVITY;

// ── a ball on the ground ──────────────────────────────────────────────────────
// The first bounce takes more of its speed the harder it was driven down, the grass takes the
// rest at a rate that grows as it slows, and a chopper spends its first bounce in the air.
const roll = (ev, la) => ({
  v0: Math.max(25, ev) * MPH * Math.max(0.5, 0.85 - 0.012 * Math.max(0, -la)),
  k: 0.3 + 0.03 * Math.max(0, 70 - ev),
  lag: la < -10 ? 0.45 : 0,
});
// How long it takes to get `d` feet, or Infinity if it stops short.
export function rollTime(ev, la, d) {
  const { v0, k, lag } = roll(ev, la);
  const f = 1 - (d * k) / v0;
  return f > 0.01 ? lag - Math.log(f) / k : Infinity;
}
// How far it gets before it stops.
export const rollStop = (ev, la) => { const { v0, k } = roll(ev, la); return (0.99 * v0) / k; };
// How far it has got `tau` seconds off the bat: rollTime turned round, nothing while a chopper's
// first bounce is in the air. The 3-D ball runs on it (diamond/flight.js groundPath), so it
// reaches a fielder where and when the server said it would.
export function rollAlong(ev, la) {
  const { v0, k, lag } = roll(ev, la);
  return (tau) => (tau <= lag ? 0 : (v0 / k) * (1 - Math.exp(-k * (tau - lag))));
}

// ── the fielders ──────────────────────────────────────────────────────────────
// Each position's first step (seconds), his speed (feet a second) and what a dive or a stretch
// adds at the end (feet).
const LEGS = Object.freeze({
  1: [0.5, 14, 3], 2: [0.55, 15, 3], 3: [0.35, 18, 5], 4: [0.3, 20, 6], 5: [0.3, 18, 5], 6: [0.3, 21, 6],
  7: [0.45, 25, 7], 8: [0.4, 27, 8], 9: [0.45, 25, 7],
});
// How far a fielder can get from his spot in `t` seconds, and how long he takes to move at all.
export const reachIn = (n, t) => { const [r, v, x] = LEGS[n] || LEGS[4]; return Math.max(0, t - r) * v + x; };
export const firstStep = (n) => (LEGS[n] || LEGS[4])[0];

// A play's grade is the share of his reach it took: up to about a third is routine, to three
// quarters he's ranging, and past that it takes the dive.
export const ROUTINE = 0.35, RANGING = 0.75;
export const gradeOf = (ratio) => (ratio <= ROUTINE ? 'routine' : ratio <= RANGING ? 'ranging' : 'diving');

// How hard each position throws (feet a second), and how long he takes to get rid of it after
// the play he made.
const ARM = Object.freeze({ 1: 105, 2: 110, 3: 95, 4: 112, 5: 125, 6: 125, 7: 135, 8: 135, 9: 135 });
export const TRANSFER = Object.freeze({ routine: 0.5, ranging: 0.7, diving: 1.2, barehand: 0.25 });
export const throwTime = (n, from, to) => Math.hypot(to[0] - from[0], to[2] - from[2]) / (ARM[n] || 120);
// Home to first, for a man whose legs are `speed` (0 to 1) batting from `bats`: a left-hander
// starts a step nearer.
export const toFirst = (speed, bats) => 4.55 - 0.55 * speed - (bats === 'L' ? 0.1 : 0);
// A man's legs, 0 to 1, off his name, the same in every game. It's the sim's speedOf
// (plugins/broadcast/sports/baseball.js) worked the same way, which the server can't share with the
// browser, so a runner the sim sends runs at the pace it judged him by; diamond-smoke holds the two
// to each other.
export function legsOf(name) {
  let h = 2166136261 >>> 0;
  for (const ch of String(name || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ 0x5350, 16777619) >>> 0;
  return (h & 0xffff) / 65536;
}
// The fastest a man runs the bases, feet a second, by his legs.
export const topSpeed = (legs) => 25 + 4.5 * legs;
// How long the first baseman takes to get to the bag himself from `at`.
const toBag = (at) => Math.hypot(BAGS[1][0] - at[0], BAGS[1][2] - at[2]) / 20 + 0.1;

// Each infielder's best chance at a ball on the ground along `dir`. How hard it is (`ratio`) is
// how far off its path he starts against how far he can get before it's past him, so a ball hit
// at him is routine however he goes to meet it. Where he meets it (`s`, feet from the plate along
// its path, and `at`) is wherever gets the batter out at first soonest (`out`), so he charges a
// slow one: when (`t`) and how far he runs (`run`). `can` is whether he gets there at all. The
// ones who can come first, soonest first.
export function groundChances(spots, dir, ev, la) {
  const stop = rollStop(ev, la), out = [];
  for (const n of [1, 3, 4, 5, 6]) {
    const p = spots[n], dist = Math.hypot(p[0], p[2]), off = (dir - sprayOf(p)) * DEG;
    const lat = Math.abs(dist * Math.sin(off)), foot = dist * Math.cos(off);
    const tFoot = foot > 0 ? rollTime(ev, la, Math.min(foot, stop * 0.92)) : Infinity;
    const ratio = Number.isFinite(tFoot) ? lat / reachIn(n, tFoot) : Infinity;
    const tries = [];
    for (let k = 0; k <= 14; k++) tries.push(dist * (0.45 + 0.05 * k));
    if (stop < dist * 1.15) tries.push(stop * 0.92);
    let best = null;
    for (const s of tries) {
      const t = rollTime(ev, la, s);
      if (!Number.isFinite(t)) continue;
      const at = toPark(dir, s), run = Math.hypot(at[0] - p[0], at[2] - p[2]);
      if (run > reachIn(n, t)) continue;
      const outAt = t + TRANSFER[gradeOf(Math.min(1, ratio))] + (n === 3 ? toBag(at) : throwTime(n, at, BAGS[1]));
      if (!best || outAt < best.out) best = { n, s, at, t, run, out: outAt };
    }
    if (best && ratio <= 1) out.push({ ...best, ratio, can: true });
    else out.push({ n, s: foot, at: toPark(dir, Math.max(0, foot)), t: tFoot, run: lat, out: Infinity, ratio, can: false });
  }
  return out.sort((a, b) => (b.can - a.can) || (a.t - b.t));
}

// Each fielder's chance at a ball in the air coming down at `at` after `T` seconds: how far he
// runs and how much of his reach that is, the easiest first.
export function airChances(spots, at, T, who = [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  return who.map((n) => {
    const p = spots[n], run = Math.hypot(at[0] - p[0], at[2] - p[2]);
    return { n, run, ratio: run / reachIn(n, T) };
  }).sort((a, b) => a.ratio - b.ratio);
}
