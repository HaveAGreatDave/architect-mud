/**
 * DEADBALL — the baseball sport module.
 *
 * Extracted verbatim from plugins/broadcast/index.js with NO behaviour change:
 * same tables, same tunables, same RNG call order, so `sportsGameForSlot(script, N)`
 * still returns byte-identical games. `plugins/broadcast/regress.js` asserts that
 * determinism, which is what makes this extraction safe to verify.
 *
 * WHAT BELONGS HERE: anything that only makes sense for baseball — the at-bat
 * table, the base/out situational rules, innings, pitch synthesis, play labels.
 *
 * WHAT DOES NOT: the slot clock, the round-robin schedule, the standings fold,
 * line pacing, the recap reel, the graph cache, the heartbeat. Those are
 * sport-agnostic and stay in index.js, which is the whole point of the split —
 * a second sport should add a file here and change nothing there.
 *
 * The default export is a SPORT DESCRIPTOR. The registry only has one entry today,
 * but the shape is what a second sport plugs into, so it exists now rather than
 * being retrofitted around hockey later.
 */
import { sportsRng, sportsShuffle, sportsHash } from '../rng.js';
import {
  fieldSpots, groundChances, airChances, carry, evFor, hangTime, gradeOf, toPark, sprayOf, fenceAt,
  toFirst, throwTime, railRoom, RANGING, TRANSFER, POSITIONS,
} from '../../../client/game/js/panels/diamond/play.js';
import { BAGS } from '../../../client/game/js/panels/diamond/geo.js';

// ── At-bat outcomes ──────────────────────────────────────────────────────────
// One plate appearance → an outcome. Weights are tuned to real MLB per-PA rates:
// K ~22.7%, reach-base ~32% (the single weight also absorbs reach-on-error so run
// production lands right), HR ~3%, 2B ~4.2%, 3B ~0.4%. Ground outs outnumber fly
// outs so double-play chances land near MLB. See the sim-tuning notes.
export const ATBAT_TABLE = [
  { kind: 'strikeout', w: 225, bases: 0, out: true },
  { kind: 'groundout', w: 240, bases: 0, out: true },
  { kind: 'flyout',    w: 160, bases: 0, out: true },
  { kind: 'popout',    w: 60,  bases: 0, out: true },
  { kind: 'single',    w: 162, bases: 1, out: false },
  { kind: 'walk',      w: 94,  bases: 1, out: false },
  { kind: 'double',    w: 42,  bases: 2, out: false },
  { kind: 'triple',    w: 4,   bases: 3, out: false },
  { kind: 'homerun',   w: 31,  bases: 4, out: false },
];
const ATBAT_TOTAL = ATBAT_TABLE.reduce((s, o) => s + o.w, 0);
export function rollAtBat(rand = Math.random) {
  let roll = rand() * ATBAT_TOTAL;
  for (const o of ATBAT_TABLE) { roll -= o.w; if (roll <= 0) return o; }
  return ATBAT_TABLE[0];
}

// Situational-out tunables — base/out-aware outcomes layered over the flat at-bat
// roll. Double plays kill rallies (and tame blowouts); sac flies and productive
// groundouts trade an out for a run or a base.
const DP_CHANCE = 0.38;              // groundout, runner on 1st, <2 outs → two (~0.75 DP/team/game)
// Triple play. The rarest thing in the sport that isn't a perfect game: roughly five a
// season across the whole league, so it must stay a genuine event and never a party
// trick. It needs the ONE alignment that makes three force-outs legal — nobody out,
// runners on first and second, ball on the ground — and even then it almost never
// happens. That gate is doing most of the work; the number just trims what's left.
const TP_CHANCE = 0.007;             // groundout, 1st AND 2nd occupied, 0 outs → all three (measures to ~1 per 500 games; MLB is ~1 per 490)
const SACFLY_CHANCE = 0.90;          // flyout, runner on 3rd, <2 outs → run scores, out
const FORCE_ADVANCE_CHANCE = 0.60;   // non-DP groundout, runner on 1st → batter out at first, runners forced up (else fielder's choice, bases hold)
const PRODUCTIVE_OUT_CHANCE = 0.35;  // other groundout nudges a runner on 2nd/3rd up (3rd scores)

// Extra innings. There is ALWAYS a winner — no ties, ever. The 10th plays out free;
// after that, each extra frame that ends still tied carries an escalating chance the
// next big swing simply decides it — a walk-off, or a go-ahead that holds. The chance
// climbs every inning, so the tie can never drag on and always resolves to a winner —
// you just don't know which side breaks it until it happens. STEP is the per-inning rise.
const EXTRAS_DECIDE_STEP = 0.34;     // +34%/inning past the 10th; forced-decisive by ~the 13th
const MAX_INNINGS = 20;              // safety cap; a winner is forced if it's ever reached

export const DEFAULT_NAMES = ['Rodriguez', 'Kane', 'Okafor', 'Bishop', 'Hale', 'Vance', 'Cruz', 'Doyle', 'Reyes', 'Park', 'Sato', 'Mundt', 'Nagy', 'Flynn', 'Ruiz', 'Abara', 'Cole', 'Voss', 'Dunn', 'Marsh'];

// ── Handedness ───────────────────────────────────────────────────────────────
// Which side a player bats from and which arm he throws with, from his name alone, so
// he is the same in every game and on every TV. Cosmetic: the sim never reads it, since
// a platoon split would change games that have already aired. The mix is the 1990s
// one: about six in ten bat right, three left and one both ways; a quarter throw left.
const nameHash = (name, salt) => sportsHash(...[...String(name || '')].map((c) => c.charCodeAt(0)), salt);
export function handOf(name) {
  const h = nameHash(name, 0x4a4e);
  const b = (h & 0xffff) / 65536, t = (h >>> 16) / 65536;
  return { bats: b < 0.6 ? 'R' : b < 0.9 ? 'L' : 'S', throws: t < 0.75 ? 'R' : 'L' };
}
// The side a batter stands on against this pitcher: a switch hitter bats from the side
// away from the pitcher's arm.
export function battingSide(batter, pitcher) {
  const b = handOf(batter).bats;
  return b !== 'S' ? b : (handOf(pitcher).throws === 'L' ? 'R' : 'L');
}

// ── Gameday: synthesized pitch-by-pitch + play descriptions ───────────────────
// The DEADBALL sim resolves at the AT-BAT level — it has no pitch data. For the
// animated Gameday sub-screen we synthesize a plausible pitch sequence per at-bat,
// PURELY from a seed, so every TV renders the identical sequence and it always ends
// on the pitch that matches Chip's called outcome (a K ends on strike three, a walk
// on ball four, everything else on a ball put in play). This is cosmetic colour, not
// a change to the game result — the outcome still comes solely from simGame.
const PITCH_TYPES = [
  { type: 'Four-Seam Fastball', lo: 92, hi: 99, w: 34 },
  { type: 'Sinker',             lo: 90, hi: 96, w: 16 },
  { type: 'Slider',             lo: 82, hi: 89, w: 20 },
  { type: 'Changeup',           lo: 82, hi: 89, w: 12 },
  { type: 'Curveball',          lo: 74, hi: 82, w: 10 },
  { type: 'Cutter',             lo: 87, hi: 92, w: 8  },
];
const PITCH_TOTAL = PITCH_TYPES.reduce((s, o) => s + o.w, 0);
// Neutral, factual play-card label (distinct from Chip's flavour narration).
const PLAY_DESC = {
  strikeout: 'Strikeout', groundout: 'Groundout', flyout: 'Flyout', popout: 'Pop Out',
  single: 'Single', double: 'Double', triple: 'Triple', walk: 'Walk', homerun: 'Home Run',
  doubleplay: 'Double Play', tripleplay: 'Triple Play', sacfly: 'Sacrifice Fly', productout: 'Groundout',
  // Sim v2.
  hitbypitch: 'Hit by Pitch', steal: 'Stolen Base', caughtstealing: 'Caught Stealing', pickoff: 'Picked Off',
  throwover: 'Throw Over', doublesteal: 'Double Steal', wildpitch: 'Wild Pitch', passedball: 'Passed Ball',
};
// Scorers' numbers, for an error's E6.
const POSITION_NUMBER = { P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };
export function playDesc(b) {
  if (b.kind === 'homerun') return b.rbi >= 4 ? 'Grand Slam' : (b.rbi > 1 ? `Home Run, ${b.rbi} RBI` : 'Home Run');
  if (b.kind === 'error') return `Reached on E${POSITION_NUMBER[b.fielder] || ''}${b.runs > 0 ? `, ${b.runs} ${b.runs > 1 ? 'runs score' : 'run scores'}` : ''}`;
  if (b.type === 'run') return `${PLAY_DESC[b.kind] || 'Play'}${b.runs > 0 ? ', run scores' : ''}`;
  const base = PLAY_DESC[b.kind] || 'In Play';
  return (b.rbi > 0 && b.kind !== 'walk') ? `${base}, ${b.rbi} RBI` : base;
}

// Build the pitch sequence for one at-bat. Returns pitches ending in the terminal
// pitch that produces `kind`. Each pitch: {n, type, velo, x, y, result, balls, strikes}
// where x,y ∈ [0,1] (the strike zone is the box ~0.25–0.75) and result is one of
// ball | called | swinging | foul | inplay, or hbp for the pitch that hits a batter (sim
// v2). balls/strikes are the count AFTER the pitch.
export function synthPitches(seed, kind) {
  const rand = sportsRng(seed);
  const pickType = () => { let r = rand() * PITCH_TOTAL; for (const p of PITCH_TYPES) { r -= p.w; if (r <= 0) return p; } return PITCH_TYPES[0]; };
  const zone = (result) => {
    // A hit batter: well inside, at the hands or the hip.
    if (result === 'hbp') return { x: rand() < 0.5 ? 0.02 + rand() * 0.04 : 0.94 + rand() * 0.04, y: 0.35 + rand() * 0.35 };
    if (result === 'ball') {
      // At least one axis off the plate.
      const out = () => (rand() < 0.5 ? 0.04 + rand() * 0.16 : 0.80 + rand() * 0.16);
      return rand() < 0.5 ? { x: out(), y: 0.20 + rand() * 0.60 } : { x: 0.20 + rand() * 0.60, y: out() };
    }
    // In or on the edge of the zone (fouls hug the edge a bit more).
    const edge = result === 'foul' ? 0.16 : 0.24;
    return { x: 0.5 + (rand() - 0.5) * (1 - edge), y: 0.5 + (rand() - 0.5) * (1 - edge) };
  };
  const terminal = kind === 'strikeout' ? 'strike' : (kind === 'walk' ? 'ball' : (kind === 'hitbypitch' ? 'hbp' : 'inplay'));
  let preBalls, preStrikes;
  if (terminal === 'strike') { preBalls = Math.floor(rand() * 4); preStrikes = 2; }      // K on strike three
  else if (terminal === 'ball') { preBalls = 3; preStrikes = Math.floor(rand() * 3); }    // BB on ball four
  else { preBalls = Math.floor(rand() * 4); preStrikes = Math.floor(rand() * 3); }        // in play, any count

  const pre = [];
  for (let i = 0; i < preBalls; i++) pre.push('ball');
  for (let i = 0; i < preStrikes; i++) pre.push(rand() < 0.45 ? 'called' : 'swinging');
  for (let i = pre.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pre[i], pre[j]] = [pre[j], pre[i]]; }
  // A little texture: an extra foul or two once there are two strikes.
  if (preStrikes === 2) { let extra = 0; while (rand() < 0.30 && extra++ < 2) pre.push('foul'); }

  const terminalResult = terminal === 'strike' ? (rand() < 0.5 ? 'called' : 'swinging')
    : (terminal === 'ball' ? 'ball' : (terminal === 'hbp' ? 'hbp' : 'inplay'));
  const results = [...pre, terminalResult];

  let balls = 0, strikes = 0;
  return results.map((result, i) => {
    if (result === 'ball') balls++;
    else if (result === 'foul') { if (strikes < 2) strikes++; }
    else if (result !== 'hbp') strikes++;   // the pitch that hits him counts as neither
    const p = pickType();
    const z = zone(result);
    return {
      n: i + 1, type: p.type,
      velo: Math.round(p.lo + rand() * (p.hi - p.lo)),
      x: Math.round(z.x * 1000) / 1000, y: Math.round(z.y * 1000) / 1000,
      result, balls, strikes,
    };
  });
}

// ── The play ─────────────────────────────────────────────────────────────────
// Where a ball in play goes and who fields it, decided here so the booth's line can agree with
// the picture: the broadcast opens the line pools whose tags the play carries (playTags, and
// docs/bsm-format.md), and the 3-D park stages it. The field it's judged on (where the nine
// stand, how far a ball carries or rolls, how far a fielder can get) is
// client/game/js/panels/diamond/play.js, which the picture reads too, so a play the server calls
// a dive is one the park can show as a dive.
//
// Seeded from the at-bat's seed with a salt of its own, as the pitches are, so it never touches
// the sim's stream and no game in the season changes. Cosmetic: nothing in the sim reads it.
//
// Every candidate is drawn round the man who has to make the play and kept with the chance a
// play that hard gets made, so most outs are routine, a dive is rare, and a hit goes where
// nobody could get to it.
//
// Returns null for a plate appearance with no ball in play, else:
//
//   t     off the bat: 'gb' a ground ball, 'ld' a line drive, 'fb' a fly, 'pu' a pop-up
//   dir   spray in degrees: -45 the left-field line, 0 straightaway centre, +45 the right-field
//         line, and past either in foul ground (a pop-up only)
//   ev    exit speed (mph) and `la` launch angle (degrees)
//   d     feet from the plate: where it's fielded on the ground, caught, or first comes down
//   f     the fielders in the order the ball goes through them, numbered as a scorer numbers
//         them: [6, 4, 3] is a 6-4-3 double play. The first fields it.
//   g     how the first got to it: routine, ranging, diving, sliding, leaping (at the wall),
//         barehand (a slow roller charged) or rail (a foul pop at the stands)
//   mi    on a hit, the man who dove for it and missed
//   th    the throw that decided it, where it wasn't clean: dirt (scooped), wide (pulled him
//         off the bag), late (beaten out), home (to the plate on a sac fly)
//   x     where an extra-base hit got to: wall (off it on the fly) or roll (rolled to it)
//   sl    the batter slid into his bag
//   hr    a home run: nodoubt, plain, scraper, leap (an outfielder jumping at the wall), pole
//   foul  a pop-up caught in foul ground
//   e     an error: boot, legs or drop when he fields it, past or stands when he throws it
//   sp    the batter's legs (speedOf), which the picture runs him at
//
// `o` is { bats, before, fielder, errorType, speed, fence }: the side he bats from, the bags
// before the play, sim v2's error, his legs and the venue's fence (diamond/geo.js venueField).
const PLAY_SALT = 0x504c4159;
const BATTED = new Set(['groundout', 'productout', 'doubleplay', 'tripleplay', 'flyout', 'sacfly', 'popout', 'single', 'double', 'triple', 'homerun', 'error']);
// The double plays, by how often each comes up for a right-handed and a left-handed hitter. The
// last throw is to first.
const DP_TYPES = {
  R: [['643', 34], ['463', 18], ['543', 16], ['163', 10], ['63', 7], ['363', 6], ['43', 3]],
  L: [['463', 32], ['643', 20], ['363', 15], ['163', 10], ['543', 7], ['43', 6], ['63', 4]],
};
// Who fields a groundout and who catches a flyout, for a right-handed hitter; a left-hander's
// are the mirror. Three grounders in five go to the pull side; fly balls spread more evenly.
const GROUND_TO = [[6, 33], [5, 21], [4, 20], [3, 13], [1, 11], [2, 2]];
const FLY_TO = [[7, 30], [8, 36], [9, 34]];
const MIRROR = { 1: 1, 2: 2, 3: 5, 4: 6, 5: 3, 6: 4, 7: 9, 8: 8, 9: 7 };

export function synthPlay(seed, kind, o = {}) {
  if (!BATTED.has(kind)) return null;
  const rand = sportsRng(sportsHash(seed >>> 0, PLAY_SALT));
  const bats = o.bats === 'L' ? 'L' : 'R', pull = bats === 'L' ? 1 : -1;
  const spots = fieldSpots(bats);
  const speed = Number.isFinite(o.speed) ? o.speed : 0.5;
  const legs = toFirst(speed, bats);
  const U = (a, b) => a + (b - a) * rand();
  const tri = (a, b) => a + ((b - a) * (rand() + rand())) / 2;
  const coin = (p) => rand() < p;
  const weighted = (list) => {
    let r = rand() * list.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of list) if ((r -= w) <= 0) return k;
    return list[list.length - 1][0];
  };
  const mine = (list) => (bats === 'R' ? list : list.map(([n, w]) => [MIRROR[n], w]));
  // The chance a play that took `ratio` of his reach gets made: certain to about a third, none at
  // the end of it. A ball in the air can come down anywhere round him, so there are more far from
  // him than near, and its chance is weighed against that.
  const made = (ratio) => (ratio <= 0.3 ? 1 : Math.max(0, 1 - (ratio - 0.3) / 0.7) ** 1.4);
  const caught = (ratio) => (ratio <= 0.3 ? 1 : Math.max(0, 1 - (ratio - 0.3) / 0.7) ** 1.6) * Math.min(1, 0.15 / Math.max(ratio, 0.01));
  // A spray to the pull side `share` of the time, `lo` to `hi` degrees off centre.
  const spray = (share, lo = 0, hi = 45) => Math.round((coin(share) ? pull : -pull) * U(lo, hi));
  const depth = (n) => Math.hypot(spots[n][0], spots[n][2]);
  const wallAt = (dir) => fenceAt(dir, o.fence);
  // Who a ball in the outfield goes back in to: the shortstop on the left side, the second
  // baseman on the right.
  const cutoff = (dir) => (dir < -4 ? 6 : dir > 4 ? 4 : coin(0.5) ? 6 : 4);
  const corner = (dir) => (dir < 0 ? 7 : 9);
  const ev3 = (x) => Math.round(x);

  // ── on the ground ──
  const evGround = (slow) => ev3(slow ? U(46, 62) : coin(0.06) ? U(48, 62) : tri(64, 110));
  const laGround = () => Math.round(tri(-22, 6));
  // A ball on the ground that `n` gets to first and makes the play on, kept when `keep(chance, ev)`.
  // It's drawn within `spread` degrees of `aim`, his own spot unless the play needs it somewhere.
  const grounder = (n, keep, slow = false, aim = null, spread = 15) => {
    const fdir = sprayOf(spots[n]), centre = aim ?? fdir;
    for (let k = 0; k < 120; k++) {
      const dir = Math.round(centre + U(-spread, spread)), ev = evGround(slow), la = laGround();
      if (Math.abs(dir) > 45) continue;
      const c = groundChances(spots, dir, ev, la)[0];
      if (!c || c.n !== n || !c.can || rand() > made(c.ratio) || !keep(c, ev)) continue;
      return { dir, ev, la, c };
    }
    // Nothing fitted: about at him.
    const dir = Math.round(fdir + U(-3, 3)), ev = ev3(tri(76, 98)), la = Math.round(U(-8, 0));
    const all = groundChances(spots, dir, ev, la);
    return { dir, ev, la, c: all.find((x) => x.n === n && x.can) || all.find((x) => x.n === n) };
  };
  const groundGrade = (n, c, ev) => (ev < 63 && n !== 3 && depth(n) - c.s > 15 ? 'barehand' : gradeOf(c.ratio));
  const onGround = (r, f, g, more = {}) => ({ t: 'gb', dir: r.dir, ev: r.ev, la: r.la, d: Math.round(r.c.s), f, g, ...more });
  // A dribbler the catcher pounces on in front of the plate.
  const dribbler = () => ({
    t: 'gb', dir: Math.round(U(-38, 38)), ev: ev3(U(44, 58)), la: Math.round(U(-30, -16)), d: Math.round(U(6, 24)),
    f: [2, 3], g: coin(0.55) ? 'barehand' : 'routine',
  });
  const groundout = (n) => {
    if (n === 2) return dribbler();
    const r = grounder(n, (c) => c.out < legs - 0.1);
    const f = n === 3 ? (r.c.ratio <= 0.45 && coin(0.75) ? [3] : [3, 1]) : [n, 3];
    return onGround(r, f, groundGrade(n, r.c, r.ev), f[0] !== 3 && coin(0.1) ? { th: 'dirt' } : {});
  };
  const doubleplay = () => {
    const f = [...weighted(DP_TYPES[bats])].map(Number), n = f[0], pivot = f.length === 3 ? f[1] : n;
    // the 6-3 and 4-3: he takes it to the bag himself, so it's hit near second
    const self = f.length === 2;
    const r = grounder(n, (c) => {
      const bag = Math.hypot(BAGS[2][0] - c.at[0], BAGS[2][2] - c.at[2]);
      if (self && bag > 20) return false;
      const toSecond = self ? bag / 20 : throwTime(n, c.at, BAGS[2]);
      return c.t + TRANSFER[gradeOf(c.ratio)] + toSecond + 0.35 + throwTime(pivot, BAGS[2], BAGS[1]) < legs + 0.3;
    }, false, self ? 0 : null, self ? 9 : 15);
    return onGround(r, f, gradeOf(r.c.ratio));
  };
  // Always 5-4-3: the third baseman gloves it at the bag and steps on it.
  const tripleplay = () => {
    const r = grounder(5, (c) => Math.hypot(BAGS[3][0] - c.at[0], BAGS[3][2] - c.at[2]) < 16);
    return onGround(r, [5, 4, 3], gradeOf(r.c.ratio));
  };

  // ── in the air ──
  // A fly ball that `n` catches, at least `minD` deep: drawn round him, kept with the chance a
  // catch that hard is made, only if he's the man it's easiest for, and when `keep(chance, d, wall)`.
  const flyTo = (n, minD = 170, keep = () => true) => {
    const fdir = sprayOf(spots[n]), fd = depth(n);
    for (let k = 0; k < 120; k++) {
      const dir = Math.round(fdir + U(-24, 24));
      if (Math.abs(dir) > 45) continue;
      const wall = wallAt(dir), d = Math.round(fd + U(-110, 88));
      if (d < minD || d > wall + 3) continue;
      const la = Math.round(tri(22, 48)), ev = ev3(evFor(d, la));
      if (!(ev >= 60 && ev <= 112)) continue;
      const T = hangTime(ev, la), c = airChances(spots, toPark(dir, d), T, [7, 8, 9])[0];
      if (c.n !== n || c.ratio > 1 || !keep(c, d, wall)) continue;
      const atWall = d >= wall - 2;
      if (rand() > caught(c.ratio) * (atWall ? 2.5 : 1) * (d > wall ? 0.4 : 1)) continue;
      let g = atWall ? 'leaping' : gradeOf(c.ratio);
      if (g === 'diving' && d < fd - 10 && la < 32) g = 'sliding';
      return { t: 'fb', dir, ev, la, d, f: [n], g };
    }
    const dir = Math.round(fdir), d = Math.round(fd), ev = ev3(evFor(d, 34));
    return { t: 'fb', dir, ev, la: 34, d, f: [n], g: 'routine' };
  };
  const popup = () => {
    for (let k = 0; k < 160; k++) {
      const foul = coin(0.55), back = foul && coin(0.3);
      const dir = Math.round(!foul ? U(-45, 45) : (coin(0.5) ? -1 : 1) * (back ? U(140, 180) : U(47, 105)));
      const la = Math.round(U(52, 72)), ev = ev3(tri(52, 90)), d = Math.round(carry(ev, la));
      if (d < 15 || d > 175) continue;
      // past the rail it's a foul ball in the seats, not an out, unless he reaches in for it
      const room = foul ? railRoom(dir, d) : Infinity;
      if (room < -2) continue;
      // The infielders call for it: the catcher takes the ones round the plate and behind it, and
      // the pitcher gets out of the way.
      const T = hangTime(ev, la), near = d < 40 || Math.abs(dir) >= 90;
      const lean = (c) => c.ratio * (c.n === 1 ? 4 : c.n === 2 && !near ? 1.6 : 1);
      const c = airChances(spots, toPark(dir, d), T, [2, 3, 4, 5, 6, 1]).sort((a, b) => lean(a) - lean(b))[0];
      if (c.ratio > 1 || rand() > caught(c.ratio) * (room < 10 ? 3 : 1)) continue;
      const g = room <= 2 || (room < 10 && coin(0.6)) ? 'rail' : gradeOf(c.ratio);
      return { t: 'pu', dir, ev, la, d, f: [c.n], g, ...(foul ? { foul: 1 } : {}) };
    }
    return { t: 'pu', dir: 10, ev: 70, la: 66, d: Math.round(carry(70, 66)), f: [6], g: 'routine' };
  };

  // ── base hits ──
  // Whether a hit gets past the man with the best chance at it: a ball he'd make every time
  // never does, and a dive that comes up empty is his `mi`.
  const gotPast = (c, air = false) => {
    if (!c || c.ratio > 1) return {};
    if (rand() < (air ? caught(c.ratio) / Math.min(1, 0.15 / Math.max(c.ratio, 0.01)) : made(c.ratio))) return null;
    return c.ratio > RANGING && c.ratio < 0.95 && coin(0.5) ? { mi: c.n } : {};
  };
  // The outfielder who picks up a ball that's come down at `at` `T` seconds after it was hit.
  const pickUp = (at, T, who = [7, 8, 9]) => airChances(spots, at, T, who)[0].n;
  const single = () => {
    const how = weighted([['hole', 44], ['liner', 30], ['bloop', 13], ['infield', 10], ['wide', 3]]);
    if (how === 'infield' || how === 'wide') {
      const n = weighted(how === 'wide' ? [[6, 34], [5, 30], [4, 26], [1, 10]] : [[6, 32], [5, 28], [4, 22], [2, 8], [1, 5], [3, 5]]);
      if (n === 2) return { ...dribbler(), th: 'late' };
      // beaten out: a slow roller, or a ball deep enough in the hole that the throw can't get there
      const late = how === 'infield', deep = late && coin(0.5);
      const r = grounder(n, (c) => (late ? c.out > legs && (!deep || c.ratio > 0.45) : c.out < legs - 0.1), late && !deep);
      return onGround(r, n === 3 ? [3, 1] : [n, 3], groundGrade(n, r.c, r.ev), { th: late ? 'late' : 'wide' });
    }
    for (let k = 0; k < 120; k++) {
      if (how === 'hole') {
        const dir = spray(0.6), ev = ev3(tri(72, 112)), la = Math.round(tri(-14, 6));
        const past = gotPast(groundChances(spots, dir, ev, la).find((c) => c.can));
        if (!past) continue;
        // the outfielder comes in and meets it
        const s = 250, n = pickUp(toPark(dir, s), 3, [7, 8, 9]);
        const meet = Math.round(Math.hypot(spots[n][0], spots[n][2]) * Math.cos((dir - sprayOf(spots[n])) * Math.PI / 180) - U(15, 40));
        return { t: 'gb', dir, ev, la, d: meet, f: [n, cutoff(dir)], ...past };
      }
      const liner = how === 'liner';
      const dir = spray(liner ? 0.55 : 0.5, 0, 44);
      const la = Math.round(liner ? U(7, 20) : U(24, 42)), ev = ev3(liner ? tri(80, 112) : U(55, 76)), d = Math.round(carry(ev, la));
      if (d < 120 || d > (liner ? wallAt(dir) - 70 : 245)) continue;
      const T = hangTime(ev, la), at = toPark(dir, d);
      const past = gotPast(airChances(spots, at, T, liner ? [3, 4, 5, 6, 7, 8, 9] : [1, 3, 4, 5, 6, 7, 8, 9])[0], true);
      if (!past) continue;
      const n = pickUp(at, T + 1.5, liner ? [7, 8, 9] : [3, 4, 5, 6, 7, 8, 9]);
      return { t: liner ? 'ld' : 'fb', dir, ev, la, d, f: n >= 7 ? [n, cutoff(dir)] : [n], ...past };
    }
    return { t: 'ld', dir: 0, ev: 92, la: 12, d: Math.round(carry(92, 12)), f: [8, 6] };
  };
  // Doubles and triples: into a gap, down a line into the corner, or over a man's head.
  const extraBases = (bases) => {
    const how = weighted(bases === 2 ? [['gap', 38], ['wall', 18], ['line', 32], ['over', 12]] : [['gap', 40], ['wall', 22], ['line', 38]]);
    for (let k = 0; k < 160; k++) {
      let dir, t, la, ev, d, past = {}, n, x;
      if (how === 'line') {
        dir = spray(0.62, 38, 45);
        const wall = wallAt(dir);
        if (coin(bases === 2 ? 0.4 : 0.3)) {
          // a hard grounder past the man at the corner, rolling into it
          t = 'gb'; ev = ev3(tri(92, 114)); la = Math.round(tri(-6, 6));
          past = gotPast(groundChances(spots, dir, ev, la).find((c) => c.can));
          if (!past) continue;
          d = Math.round(wall - U(5, 20));
        } else {
          t = 'ld'; la = Math.round(U(9, 20)); ev = ev3(tri(88, 114)); d = Math.round(carry(ev, la));
          if (d < 170 || d > wall - 4) continue;
          past = gotPast(airChances(spots, toPark(dir, d), hangTime(ev, la), [3, 5, 7, 9])[0], true);
          if (!past) continue;
        }
        n = corner(dir); x = 'roll';
      } else if (how === 'wall') {
        // a liner that hits the wall on the fly, short of the top
        dir = spray(0.55, 0, 44);
        const wall = wallAt(dir);
        t = 'ld'; la = Math.round(U(13, 22)); ev = ev3(evFor(wall + U(0, 22), la));
        if (!(ev >= 88 && ev <= 116)) continue;
        d = Math.round(wall - 1); x = 'wall';
        const T = hangTime(ev, la), c = airChances(spots, toPark(dir, wall), T, [7, 8, 9])[0];
        past = gotPast(c, true);
        if (!past) continue;
        n = c.n;
      } else {
        dir = how === 'gap' ? spray(0.55, bases === 2 ? 8 : 6, bases === 2 ? 27 : 30) : spray(0.5, 0, 44);
        const wall = wallAt(dir);
        t = coin(how === 'gap' ? 0.55 : 0.2) ? 'ld' : 'fb';
        la = Math.round(t === 'ld' ? U(12, 21) : U(21, 33));
        const lo = how === 'over' ? Math.hypot(spots[8][0], spots[8][2]) : wall - (bases === 2 ? 80 : 40);
        d = Math.round(U(lo, wall - 3));
        ev = ev3(evFor(d, la));
        if (!(ev >= 82 && ev <= 116)) continue;
        const T = hangTime(ev, la), at = toPark(dir, d);
        const c = airChances(spots, at, T, [7, 8, 9])[0];
        if (how === 'over' && c.ratio <= 0.8) continue;
        past = gotPast(c, true);
        if (!past) continue;
        x = d >= wall - 2 ? 'wall' : d >= wall - 60 && (bases === 3 || coin(0.7)) ? 'roll' : undefined;
        n = pickUp(x ? toPark(dir, wall - 6) : at, T + 2);
      }
      const f = bases === 3 ? [n, cutoff(dir), 5] : [n, cutoff(dir)];
      return { t, dir, ev, la, d, f, ...past, ...(x ? { x } : {}), ...(coin(bases === 3 ? 0.7 : 0.45) ? { sl: 1 } : {}) };
    }
    const d = Math.round(wallAt(18) - 20);
    return { t: 'ld', dir: 18, ev: ev3(evFor(d, 18)), la: 18, d, f: bases === 3 ? [9, 4, 5] : [9, 4], x: 'roll' };
  };
  const homer = () => {
    for (let k = 0; k < 80; k++) {
      const hr = weighted([['nodoubt', 30], ['plain', 30], ['scraper', 18], ['leap', 14], ['pole', 8]]);
      const dir = hr === 'pole' ? (coin(0.75) ? pull : -pull) * 45 : spray(0.62, 0, 44);
      const wall = wallAt(dir);
      const d = Math.round(wall + (hr === 'nodoubt' ? U(45, 95) : hr === 'plain' ? U(14, 44) : hr === 'scraper' ? U(1, 10) : hr === 'leap' ? U(1, 5) : U(2, 18)));
      const la = Math.round(tri(19, 38)), ev = ev3(evFor(d, la));
      if (!(ev >= 92 && ev <= 118)) continue;
      // the outfielder who goes back to the wall and watches it go, or jumps for it
      const c = airChances(spots, toPark(dir, wall), hangTime(ev, la), [7, 8, 9])[0];
      if (hr === 'leap' && c.ratio > 1) continue;
      return { t: la < 20 ? 'ld' : 'fb', dir, ev, la, d, f: [c.n], hr, ...(hr === 'leap' ? { g: 'leaping' } : {}) };
    }
    const d = Math.round(wallAt(0) + 30);
    return { t: 'fb', dir: 0, ev: ev3(evFor(d, 28)), la: 28, d, f: [8], hr: 'plain' };
  };
  // Sim v2's error, on the man the sim charged: a makeable ball he boots, lets through his legs
  // or drops, or fields and throws away.
  const error = () => {
    const n = POSITION_NUMBER[o.fielder] || 6, throwing = o.errorType === 'throwing';
    if (n === 2) return { ...dribbler(), f: throwing ? [2, 3] : [2], e: throwing ? 'past' : 'boot' };
    if (n >= 7) {
      if (!throwing) return { ...flyTo(n, 170, (c, d, wall) => c.ratio <= RANGING && d < wall - 2), e: 'drop' };
      // a base hit he fields clean and throws into the stands
      const dir = Math.round(sprayOf(spots[n]) + U(-12, 12)), la = Math.round(U(8, 18)), ev = ev3(tri(84, 104));
      return { t: 'ld', dir, ev, la, d: Math.round(carry(ev, la)), f: [n, cutoff(dir)], e: 'stands' };
    }
    const r = grounder(n, (c) => c.ratio <= RANGING);
    const e = throwing ? (n === 3 || coin(0.38) ? 'stands' : 'past') : coin(0.6) ? 'boot' : 'legs';
    return onGround(r, throwing ? [n, 3] : [n], groundGrade(n, r.c, r.ev), { e });
  };

  let p;
  switch (kind) {
    case 'groundout': p = groundout(weighted(mine(GROUND_TO))); break;
    case 'productout': {
      // With a man forced, the sure out at first; with nobody on first, behind the runner, on
      // the right side, most of the time.
      const right = !o.before?.[0] && coin(0.8);
      p = groundout(right ? weighted([[3, 40], [4, 60]]) : weighted(mine(GROUND_TO.filter(([n]) => n !== 2))));
      break;
    }
    case 'doubleplay': p = doubleplay(); break;
    case 'tripleplay': p = tripleplay(); break;
    case 'flyout': p = flyTo(weighted(mine(FLY_TO))); break;
    case 'sacfly': { p = flyTo(weighted(mine(FLY_TO)), 230); if (p.d < 345) p.th = 'home'; break; }
    case 'popout': p = popup(); break;
    case 'single': p = single(); break;
    case 'double': p = extraBases(2); break;
    case 'triple': p = extraBases(3); break;
    case 'homerun': p = homer(); break;
    case 'error': p = error(); break;
    default: return null;
  }
  return { ...p, sp: Math.round(speed * 100) / 100 };
}

// The tags a play gives the booth's line. A line pool suffixed with one, `atbat.double.wall`,
// airs only on a play that carries it, beside the bare pool's lines, which have to be true of
// every play of their kind (docs/bsm-format.md). `o` is { bats, fence }.
//
//   off the bat    ground, liner, fly, pop, bloop
//   where          left, right, centre (an infield ball by who fields it); pull, oppo; gap, line,
//                  hole, middle, infield, catcher, comebacker; foul, fair
//   how deep       deep, track, wall (got to it, or caught at it), offwall (hit it on the fly),
//                  shallow, robbed (a home run caught over the fence)
//   the fielding   routine, ranging, diving, sliding, leaping, barehand, rail; dove (on a hit,
//                  a dive that came up empty)
//   the throw      dirt, wide, late, home
//   the runner     slide, standup (doubles and triples)
//   the kind       643, 463, 543, 363, 163, 63, 43 (double and triple plays); nodoubt,
//                  scraper, leap, pole (home runs); boot, legs, drop, past, stands (errors)
export const PLAY_TAGS = Object.freeze(new Set([
  'ground', 'liner', 'fly', 'pop', 'bloop', 'left', 'right', 'centre', 'pull', 'oppo', 'gap', 'line', 'hole', 'middle',
  'infield', 'catcher', 'comebacker', 'foul', 'fair', 'deep', 'track', 'wall', 'offwall', 'shallow', 'robbed',
  'routine', 'ranging', 'diving', 'sliding', 'leaping', 'barehand', 'rail', 'dove', 'dirt', 'wide', 'late', 'home',
  'slide', 'standup', '643', '463', '543', '363', '163', '63', '43', 'nodoubt', 'scraper', 'leap', 'pole',
  'boot', 'legs', 'drop', 'past', 'stands',
]));
const HIT_PLAYS = new Set(['single', 'double', 'triple']);
export function playTags(kind, play, o = {}) {
  if (!play) return [];
  const T = new Set();
  const n = play.f?.[0] || 0, dir = play.dir, ad = Math.abs(dir), air = play.t !== 'gb';
  const wall = fenceAt(dir, o.fence);
  T.add({ gb: 'ground', ld: 'liner', fb: 'fly', pu: 'pop' }[play.t]);
  if (kind === 'single' && play.t === 'fb') T.add('bloop');
  // the side: an infield ball by who fields it, anything else by where it went
  if (n && n <= 6 && (play.t === 'gb' || play.t === 'pu')) {
    if (n === 5 || n === 6) T.add('left');
    else if (n === 3 || n === 4) T.add('right');
    if (n === 2) T.add('catcher');
    // a pop-up in foul ground or out on the grass wasn't caught on the infield
    else if (play.t === 'gb' || (!play.foul && play.d < 140)) T.add('infield');
    if (n === 1 && play.t === 'gb') T.add('comebacker');
  } else if (!play.foul) T.add(dir < -15 ? 'left' : dir > 15 ? 'right' : 'centre');
  if (o.bats && ad >= 12 && !play.foul) T.add(Math.sign(dir) === (o.bats === 'L' ? 1 : -1) ? 'pull' : 'oppo');
  if (play.t === 'pu') T.add(play.foul ? 'foul' : 'fair');
  // where in the outfield
  const outfield = air ? play.d >= 150 && !play.foul : n >= 7;
  if (outfield && (air || kind === 'double' || kind === 'triple') && ad >= 9 && ad <= 21 && play.d >= 200) T.add('gap');
  if (outfield && ad >= 36) T.add('line');
  if (kind === 'single' && play.t === 'gb' && n >= 7) T.add(ad < 6 ? 'middle' : 'hole');
  // how deep
  if (kind !== 'homerun' && air && !play.foul) {
    if (play.d >= 0.88 * wall) T.add('deep');
    if (play.d >= wall - 2 && !HIT_PLAYS.has(kind)) T.add('wall');
    else if (play.d >= wall - 16 && play.d < wall - 2) T.add('track');
    if (play.d < 215 && kind !== 'double' && kind !== 'triple' && (outfield || (play.t === 'pu' && play.d >= 140))) T.add('shallow');
    if (play.d > wall && play.g === 'leaping') T.add('robbed');
  }
  if (play.x) { T.add('wall'); if (play.x === 'wall') T.add('offwall'); }
  // how it was fielded, and the throw
  if (HIT_PLAYS.has(kind)) {
    if (play.mi) T.add('dove');
    if (play.th === 'late' && play.g) T.add(play.g);
  } else if (play.g) T.add(play.g);
  if (play.th) T.add(play.th);
  if (kind === 'double' || kind === 'triple') T.add(play.sl ? 'slide' : 'standup');
  if (kind === 'doubleplay' || kind === 'tripleplay') T.add(play.f.join(''));
  if (play.hr && play.hr !== 'plain') T.add(play.hr);
  if (play.e) T.add(play.e);
  return [...T].filter(Boolean);
}

// ── The sim ──────────────────────────────────────────────────────────────────
// Pure and seeded: same (matchup, players, rand) → same game, every time, on every
// client. Returns { away, home, awayScore, homeScore, beats, innings }.
export function simGame(matchup, players, rand = Math.random) {
  const awayName = matchup?.away || 'Away', homeName = matchup?.home || 'Home';
  const names = sportsShuffle((Array.isArray(players) && players.length) ? players : DEFAULT_NAMES, rand);
  const mk = (name, off) => ({
    name, score: 0, idx: 0,
    lineup: Array.from({ length: 9 }, (_, k) => names[(off + k) % names.length]),
    pitcher: names[(off + 9) % names.length],
  });
  const away = mk(awayName, 0);
  const home = mk(homeName, 9 % Math.max(names.length, 1));

  const beats = [];
  let gameOver = false, inning = 0;

  const playHalf = (half, batting, fielding) => {
    beats.push({ type: 'half_start', inning, half, battingName: batting.name, fieldingName: fielding.name, pitcher: fielding.pitcher, awayScore: away.score, homeScore: home.score });
    let outs = 0, walkoff = false;
    const bases = [false, false, false];   // 1st, 2nd, 3rd occupied?
    while (outs < 3) {
      const batter = batting.lineup[batting.idx % 9];
      batting.idx++;
      const ab = rollAtBat(rand);
      let kind = ab.kind, runs = 0;

      if (ab.out) {
        // Base/out-aware outs. A grounder with a man on first can turn two; a fly
        // ball with a man on third can be traded for a run; other grounders can
        // still push a runner over — a "productive out".
        if (ab.kind === 'groundout' && bases[0] && bases[1] && outs === 0 && rand() < TP_CHANCE) {
          kind = 'tripleplay';                 // force at third, force at second, throw to first
          bases[0] = bases[1] = false;
          // A man on third is stranded where he stands — the inning ended before he
          // could score. Deliberately no run, whatever he was doing on the play.
          bases[2] = false;
          outs = 3;
        } else if (ab.kind === 'groundout' && bases[0] && outs < 2 && rand() < DP_CHANCE) {
          kind = 'doubleplay';                 // batter + the force at second
          outs += 2;
          // The other runners are NOT bystanders. A 6-4-3 with a man on third scores
          // him — unless the play was the third out, in which case the run never
          // counts. A man on second is forced up to third by the batter-runner.
          if (outs < 3 && bases[2]) runs += 1;
          bases[2] = bases[1];                 // second → third (forced by the force)
          bases[1] = false;
          bases[0] = false;
        } else if (ab.kind === 'flyout' && bases[2] && outs < 2 && rand() < SACFLY_CHANCE) {
          kind = 'sacfly';                      // runner tags from third and scores
          bases[2] = false; runs = 1;
          outs += 1;
        } else {
          outs += 1;
          // Groundout base-running. A runner on first is FORCED: either the batter is
          // retired at first and every runner is pushed up a base (a run scores from
          // third), or the defense takes the fielder's choice — the lead runner is out
          // at second, the batter reaches, and the runners hold (bases untouched). With
          // no man on first, a right-side grounder still nudges a runner on 2nd/3rd up.
          if (ab.kind === 'groundout' && outs < 3 && bases[0] && rand() < FORCE_ADVANCE_CHANCE) {
            kind = 'productout';                // batter out at first; runners forced up 90 ft
            if (bases[2]) runs += 1;            // forced run scores from third
            bases[2] = bases[1];                // second → third
            bases[1] = bases[0];                // first → second
            bases[0] = false;
          } else if (ab.kind === 'groundout' && outs < 3 && !bases[0] && (bases[1] || bases[2]) && rand() < PRODUCTIVE_OUT_CHANCE) {
            kind = 'productout';                // grounder to the right side moves 'em up
            if (bases[2]) { runs += 1; bases[2] = false; }
            if (bases[1]) { bases[2] = true; bases[1] = false; }
          }
        }
        batting.score += runs;
        walkoff = half === 'bottom' && inning >= 9 && runs > 0 && home.score > away.score;
        beats.push({ type: 'atbat', inning, half, battingName: batting.name, fieldingName: fielding.name, batter, pitcher: fielding.pitcher, kind, out: true, outs, rbi: runs, awayScore: away.score, homeScore: home.score, walkoff, bases: [bases[0], bases[1], bases[2]] });
        if (walkoff) break;
        continue;
      }

      // Reached base. A walk pushes only forced runners; hits advance runners with
      // realistic aggressiveness — a single often scores a man from second and can
      // send the trail runner first-to-third; a double clears second and third and
      // frequently scores one from first. Advancement odds tuned to MLB run output.
      if (ab.kind === 'walk') {
        if (bases[0]) { if (bases[1]) { if (bases[2]) runs = 1; bases[2] = true; } bases[1] = true; }
        bases[0] = true;
      } else {
        const r0 = bases[0], r1 = bases[1], r2 = bases[2];
        bases[0] = bases[1] = bases[2] = false;
        if (ab.kind === 'single') {
          if (r2) runs++;
          if (r1) { if (rand() < 0.72) runs++; else bases[2] = true; }
          if (r0) { if (rand() < 0.42 && !bases[2]) bases[2] = true; else bases[1] = true; }
          bases[0] = true;
        } else if (ab.kind === 'double') {
          if (r2) runs++;
          if (r1) runs++;
          if (r0) { if (rand() < 0.62) runs++; else bases[2] = true; }
          bases[1] = true;
        } else if (ab.kind === 'triple') {
          runs += (r0 ? 1 : 0) + (r1 ? 1 : 0) + (r2 ? 1 : 0);
          bases[2] = true;
        } else { // homerun
          runs += 1 + (r0 ? 1 : 0) + (r1 ? 1 : 0) + (r2 ? 1 : 0);
        }
      }
      batting.score += runs;
      walkoff = half === 'bottom' && inning >= 9 && runs > 0 && home.score > away.score;
      beats.push({ type: 'atbat', inning, half, battingName: batting.name, fieldingName: fielding.name, batter, pitcher: fielding.pitcher, kind, out: false, outs, rbi: runs, awayScore: away.score, homeScore: home.score, walkoff, bases: [bases[0], bases[1], bases[2]] });
      if (walkoff) break;
    }
    beats.push({ type: 'half_end', inning, half, battingName: batting.name, fieldingName: fielding.name, awayScore: away.score, homeScore: home.score });
    return walkoff;
  };

  // Force a decisive frame: one swing ends it — a walk-off for the home side or a
  // go-ahead that holds up for the visitors (coin-flip which). Used both when the
  // extra-inning "decide" roll fires and as the never-a-tie backstop at the cap.
  const forceFinish = () => {
    inning = Math.max(inning, 10);
    const homeWins = rand() < 0.5;
    const bat = homeWins ? home : away, fld = homeWins ? away : home;
    const half = homeWins ? 'bottom' : 'top';
    const r = rand();
    const kind = r < 0.15 ? 'homerun' : (r < 0.5 ? 'double' : 'single');
    bat.score += 1;
    beats.push({ type: 'half_start', inning, half, battingName: bat.name, fieldingName: fld.name, pitcher: fld.pitcher, awayScore: away.score - (homeWins ? 0 : 1), homeScore: home.score - (homeWins ? 1 : 0) });
    beats.push({ type: 'atbat', inning, half, battingName: bat.name, fieldingName: fld.name, batter: bat.lineup[bat.idx % 9], pitcher: fld.pitcher, kind, out: false, outs: 0, rbi: 1, awayScore: away.score, homeScore: home.score, walkoff: homeWins, bases: [false, false, false] });
    beats.push({ type: 'half_end', inning, half, battingName: bat.name, fieldingName: fld.name, awayScore: away.score, homeScore: home.score });
  };

  while (!gameOver && inning < MAX_INNINGS) {
    inning++;
    playHalf('top', away, home);
    // Home already ahead entering the bottom of the 9th+ → they've won; skip the half.
    if (inning >= 9 && home.score > away.score) { gameOver = true; break; }
    if (playHalf('bottom', home, away)) { gameOver = true; break; }   // walk-off
    if (inning >= 9 && away.score !== home.score) { gameOver = true; break; }   // decided after a full inning
    // Still tied in extras. Past the 10th, an escalating chance the next big swing
    // decides it outright — so a tie can never drag on and always ends with a winner.
    if (inning >= 10) {
      const decide = Math.min(1, (inning - 10) * EXTRAS_DECIDE_STEP);
      if (decide > 0 && rand() < decide) { forceFinish(); gameOver = true; break; }
    }
  }

  // Never a tie: if the cap was somehow reached dead even, one swing settles it.
  if (away.score === home.score) forceFinish();

  return { away, home, awayScore: away.score, homeScore: home.score, beats, innings: inning };
}

// ── Sim v2 ───────────────────────────────────────────────────────────────────
// The plays v1 never had: errors, hit batters, the running game (steals, caught
// stealing, pickoffs and the throw over a runner beats back, the double steal), and
// wild pitches and passed balls. A game plays v2 from the slot the league switched it
// on at (sportsGameForSlot picks the version by slot); every game before that replays
// as it aired, because the standings, the recaps and the team cards re-simulate them.
//
// It's v1's game with named runners. Every draw v1 makes, v2 makes in the same order
// from the same stream, and every new decision draws from a stream of its own seeded
// from the game's seed. So with the new plays turned off (SIM_V2_OFF) a v2 game is the
// v1 game play for play, and regress checks that it is. (Only the home side's names
// differ: see below.)
//
// What it adds to the beats:
//   • Every at-bat carries `runs` (scored on the play), `runners` (the names on the
//     bags after it) and `moves` (every man's fate, lead runner first and the batter
//     last, in the shape runnerMoves in baseball-gameday.js describes, with his `name`).
//     `rbi` is the batter's true RBI: none on an error or a double play, which v1
//     credited.
//   • Two at-bat kinds: `hitbypitch`, and `error` (he reached on one) with `fielder`,
//     the position charged, and `errorType`, 'fielding' or 'throwing'.
//   • A beat type, `run`, for a play while a batter is up: steal, caughtstealing,
//     pickoff, throwover, doublesteal, wildpitch or passedball, with `runner` (the man
//     running) and `base` (the bag in play). One that makes the third out ends the half
//     with the batter still up, and he leads off the next inning.
//   • The game carries `version: 2`.
export const SIM_V2_RATES = Object.freeze({
  error: 10 / 162,       // of singles: he reached on an error instead (v1's single weight carried them)
  throwingError: 0.3,    // of errors: thrown away, so the batter takes second and every runner two bags
  hitByPitch: 10 / 94,   // of walks: a hit batter instead (v1's walk weight carried them)
  wildPitch: 0.012,      // per plate appearance with anybody on
  passedBall: 0.003,
  throwOver: 0.05,       // per plate appearance with a man on first and second open
  pickoff: 0.14,         // of throws over: he's caught off the bag
  steal: 0.11,           // per plate appearance with a man on first and second open, scaled by his legs
  stealThird: 0.025,     // per plate appearance with a man on second and nobody else on
  doubleSteal: 0.015,    // per plate appearance with first and second on and third open
  doubleStealOut: 0.15,  // of double steals: the lead runner is thrown out at third
});
export const SIM_V2_OFF = Object.freeze(Object.fromEntries(Object.keys(SIM_V2_RATES).map((k) => [k, 0])));

// A player's legs, his arm and how quick he is to the plate, from his name as his
// handedness is, so he's the same in every game. Each is 0 to 1.
const traitOf = (name, salt) => (nameHash(name, salt) & 0xffff) / 65536;
export const speedOf = (name) => traitOf(name, 0x5350);
export const armOf = (name) => traitOf(name, 0x4152);
export const quicknessOf = (name) => traitOf(name, 0x5155);

// Where each lineup slot plays (the pitcher doesn't bat; the ninth slot is the DH). In
// v2 the catcher's arm decides steals and an error is charged to a position.
export const LINEUP_POSITIONS = ['CF', 'SS', 'LF', '1B', 'RF', '3B', 'C', '2B', 'DH'];
const CATCHER_SLOT = LINEUP_POSITIONS.indexOf('C');
// Who boots it: infielders mostly, the shortstop most of all.
const ERROR_FIELDERS = [['SS', 30], ['3B', 22], ['2B', 18], ['1B', 10], ['P', 5], ['LF', 5], ['CF', 5], ['RF', 5]];
const ERROR_FIELDERS_TOTAL = ERROR_FIELDERS.reduce((s, [, w]) => s + w, 0);
// A batter thrown out after running it out, rather than retired where he stood.
const RAN_IT_OUT = new Set(['groundout', 'productout', 'doubleplay', 'tripleplay']);

export function simGameV2(matchup, players, rand = Math.random, { seed = 0, rates = SIM_V2_RATES } = {}) {
  const side = sportsRng(sportsHash(seed >>> 0, 0x5132));
  const awayName = matchup?.away || 'Away', homeName = matchup?.home || 'Home';
  const names = sportsShuffle((Array.isArray(players) && players.length) ? players : DEFAULT_NAMES, rand);
  const mk = (name, off) => ({
    name, score: 0, idx: 0,
    lineup: Array.from({ length: 9 }, (_, k) => names[(off + k) % names.length]),
    pitcher: names[(off + 9) % names.length],
  });
  const away = mk(awayName, 0);
  // v1 starts the home nine at the tenth name, which is also the away pitcher, so the
  // home leadoff man could bat against himself. v2 starts them one name on. Names take
  // no draws, so this moves no play.
  const home = mk(homeName, 10 % Math.max(names.length, 1));

  const beats = [];
  let gameOver = false, inning = 0;

  const playHalf = (half, batting, fielding) => {
    beats.push({ type: 'half_start', inning, half, battingName: batting.name, fieldingName: fielding.name, pitcher: fielding.pitcher, awayScore: away.score, homeScore: home.score });
    let outs = 0, walkoff = false;
    const occ = [null, null, null];          // who's on first, second and third
    const on = (i) => occ[i] != null;
    const pitcher = fielding.pitcher, catcher = fielding.lineup[CATCHER_SLOT];
    const head = () => ({ inning, half, battingName: batting.name, fieldingName: fielding.name });
    const tail = () => ({ awayScore: away.score, homeScore: home.score, walkoff, bases: occ.map((n) => n != null), runners: occ.slice() });
    // A play's moves, every runner who didn't move added as holding, lead runner first.
    const settle = (before, moves) => {
      for (let n = 1; n <= 3; n++) if (before[n - 1] != null && !moves.some((m) => m.from === n)) moves.push({ from: n, to: n, name: before[n - 1] });
      return moves.sort((a, b) => b.from - a.from);
    };

    // A play on the bases while `batter` is up, before his at-bat resolves. True when it
    // ended the half or the game.
    const runningGame = (batter) => {
      if (!on(0) && !on(1) && !on(2)) return false;
      const appetite = (name) => 0.3 + 1.4 * speedOf(name) ** 2;
      const r = side();
      let p = 0, kind = null;
      if (r < (p += rates.wildPitch)) kind = 'wildpitch';
      else if (r < (p += rates.passedBall)) kind = 'passedball';
      else if (on(0) && !on(1) && r < (p += rates.throwOver)) kind = 'throwover';
      else if (on(0) && !on(1) && r < (p += rates.steal * appetite(occ[0]))) kind = 'steal';
      else if (on(0) && on(1) && !on(2) && r < (p += rates.doubleSteal)) kind = 'doublesteal';
      else if (!on(0) && on(1) && !on(2) && r < (p += rates.stealThird * appetite(occ[1]))) kind = 'steal';
      if (!kind) return false;
      const before = occ.slice(), moves = [];
      let runs = 0, out = false, runner, base;
      if (kind === 'wildpitch' || kind === 'passedball') {
        // Everybody moves up a bag, and a man on third scores.
        for (let n = 3; n >= 1; n--) if (before[n - 1] != null) moves.push({ from: n, to: n + 1, name: before[n - 1] });
        runs = before[2] != null ? 1 : 0;
        occ[2] = before[1]; occ[1] = before[0]; occ[0] = null;
        runner = moves[0].name; base = moves[0].to;
      } else if (kind === 'throwover') {
        runner = before[0]; base = 1;
        if (side() < rates.pickoff) { kind = 'pickoff'; out = true; occ[0] = null; moves.push({ from: 1, out: 1, name: runner }); }
      } else if (kind === 'steal') {
        const from = before[0] != null ? 1 : 2;
        runner = before[from - 1]; base = from + 1;
        const odds = 0.62 + 0.35 * (speedOf(runner) - 0.5) - 0.2 * (armOf(catcher) - 0.5) - 0.15 * (quicknessOf(pitcher) - 0.5) - (from === 2 ? 0.06 : 0);
        occ[from - 1] = null;
        if (side() < Math.min(0.95, Math.max(0.3, odds))) { occ[from] = runner; moves.push({ from, to: from + 1, name: runner }); }
        else { kind = 'caughtstealing'; out = true; moves.push({ from, out: from + 1, name: runner }); }
      } else {
        // The double steal: first and second go together, and the throw goes to third.
        runner = before[1]; base = 3;
        occ[0] = null; occ[1] = before[0];
        moves.push({ from: 1, to: 2, name: before[0] });
        if (side() < rates.doubleStealOut) { out = true; moves.push({ from: 2, out: 3, name: before[1] }); }
        else { occ[2] = before[1]; moves.push({ from: 2, to: 3, name: before[1] }); }
      }
      if (out) outs += 1;
      batting.score += runs;
      walkoff = half === 'bottom' && inning >= 9 && runs > 0 && home.score > away.score;
      beats.push({ type: 'run', ...head(), batter, pitcher, kind, runner, base, out, outs, rbi: 0, runs, ...tail(), moves: settle(before, moves) });
      return outs >= 3 || walkoff;
    };

    while (outs < 3) {
      const batter = batting.lineup[batting.idx % 9];
      batting.idx++;
      if (runningGame(batter)) {
        if (!walkoff) batting.idx--;   // the third out came on the bases: he leads off the next inning
        break;
      }
      const ab = rollAtBat(rand);
      let kind = ab.kind, runs = 0;
      const before = occ.slice(), moves = [];

      if (ab.out) {
        // v1's outs, draw for draw.
        if (ab.kind === 'groundout' && on(0) && on(1) && outs === 0 && rand() < TP_CHANCE) {
          kind = 'tripleplay';             // force at third, force at second, throw to first
          if (on(2)) moves.push({ from: 3, off: true, name: before[2] });
          moves.push({ from: 2, out: 3, name: before[1] }, { from: 1, out: 2, name: before[0] });
          occ[0] = occ[1] = occ[2] = null;
          outs = 3;
        } else if (ab.kind === 'groundout' && on(0) && outs < 2 && rand() < DP_CHANCE) {
          kind = 'doubleplay';             // the batter and the force at second
          outs += 2;
          // A man on third scores unless it was the third out; a man on second is forced up.
          if (on(2)) {
            if (outs < 3) { runs += 1; moves.push({ from: 3, to: 4, name: before[2] }); }
            else moves.push({ from: 3, off: true, name: before[2] });
          }
          if (on(1)) moves.push({ from: 2, to: 3, name: before[1] });
          moves.push({ from: 1, out: 2, name: before[0] });
          occ[2] = before[1]; occ[1] = null; occ[0] = null;
        } else if (ab.kind === 'flyout' && on(2) && outs < 2 && rand() < SACFLY_CHANCE) {
          kind = 'sacfly';                  // the runner tags from third and scores
          runs = 1; moves.push({ from: 3, to: 4, name: before[2] }); occ[2] = null;
          outs += 1;
        } else {
          outs += 1;
          if (ab.kind === 'groundout' && outs < 3 && on(0) && rand() < FORCE_ADVANCE_CHANCE) {
            kind = 'productout';            // out at first, every runner forced up
            if (on(2)) { runs += 1; moves.push({ from: 3, to: 4, name: before[2] }); }
            if (on(1)) moves.push({ from: 2, to: 3, name: before[1] });
            moves.push({ from: 1, to: 2, name: before[0] });
            occ[2] = before[1]; occ[1] = before[0]; occ[0] = null;
          } else if (ab.kind === 'groundout' && outs < 3 && !on(0) && (on(1) || on(2)) && rand() < PRODUCTIVE_OUT_CHANCE) {
            kind = 'productout';            // a grounder to the right side moves them up
            if (on(2)) { runs += 1; moves.push({ from: 3, to: 4, name: before[2] }); occ[2] = null; }
            if (on(1)) { moves.push({ from: 2, to: 3, name: before[1] }); occ[2] = before[1]; occ[1] = null; }
          }
        }
        batting.score += runs;
        walkoff = half === 'bottom' && inning >= 9 && runs > 0 && home.score > away.score;
        moves.push({ from: 0, out: RAN_IT_OUT.has(kind) ? 1 : 0, name: batter });
        const rbi = kind === 'doubleplay' || kind === 'tripleplay' ? 0 : runs;
        beats.push({ type: 'atbat', ...head(), batter, pitcher, kind, out: true, outs, rbi, runs, ...tail(), moves: settle(before, moves) });
        if (walkoff) break;
        continue;
      }

      // He reached. A hit batter comes out of the walk's share of the table and an error
      // out of the single's, decided on the new stream.
      if (kind === 'walk' && side() < rates.hitByPitch) kind = 'hitbypitch';
      else if (kind === 'single' && side() < rates.error) kind = 'error';
      let fielder = null, errorType = null;
      if (kind === 'walk' || kind === 'hitbypitch') {
        // Only forced runners move.
        if (on(0)) {
          if (on(1)) {
            if (on(2)) { runs = 1; moves.push({ from: 3, to: 4, name: before[2] }); }
            moves.push({ from: 2, to: 3, name: before[1] }); occ[2] = before[1];
          }
          moves.push({ from: 1, to: 2, name: before[0] }); occ[1] = before[0];
        }
        occ[0] = batter; moves.push({ from: 0, to: 1, name: batter });
      } else if (kind === 'error') {
        // Booted, everybody moves up a bag and the batter takes first; thrown away, two
        // bags and second.
        let w = side() * ERROR_FIELDERS_TOTAL;
        fielder = (ERROR_FIELDERS.find(([, n]) => (w -= n) <= 0) || ERROR_FIELDERS[0])[0];
        errorType = side() < rates.throwingError ? 'throwing' : 'fielding';
        const step = errorType === 'throwing' ? 2 : 1;
        occ[0] = occ[1] = occ[2] = null;
        for (let n = 3; n >= 1; n--) {
          const name = before[n - 1];
          if (name == null) continue;
          const to = Math.min(4, n + step);
          moves.push({ from: n, to, name });
          if (to === 4) runs += 1; else occ[to - 1] = name;
        }
        occ[step - 1] = batter; moves.push({ from: 0, to: step, name: batter });
      } else {
        // v1's hits, draw for draw.
        const [n0, n1, n2] = before;
        occ[0] = occ[1] = occ[2] = null;
        if (kind === 'single') {
          if (n2 != null) { runs++; moves.push({ from: 3, to: 4, name: n2 }); }
          if (n1 != null) { if (rand() < 0.72) { runs++; moves.push({ from: 2, to: 4, name: n1 }); } else { occ[2] = n1; moves.push({ from: 2, to: 3, name: n1 }); } }
          if (n0 != null) { if (rand() < 0.42 && occ[2] == null) { occ[2] = n0; moves.push({ from: 1, to: 3, name: n0 }); } else { occ[1] = n0; moves.push({ from: 1, to: 2, name: n0 }); } }
          occ[0] = batter; moves.push({ from: 0, to: 1, name: batter });
        } else if (kind === 'double') {
          if (n2 != null) { runs++; moves.push({ from: 3, to: 4, name: n2 }); }
          if (n1 != null) { runs++; moves.push({ from: 2, to: 4, name: n1 }); }
          if (n0 != null) { if (rand() < 0.62) { runs++; moves.push({ from: 1, to: 4, name: n0 }); } else { occ[2] = n0; moves.push({ from: 1, to: 3, name: n0 }); } }
          occ[1] = batter; moves.push({ from: 0, to: 2, name: batter });
        } else {
          for (const [n, name] of [[3, n2], [2, n1], [1, n0]]) if (name != null) { runs++; moves.push({ from: n, to: 4, name }); }
          if (kind === 'triple') { occ[2] = batter; moves.push({ from: 0, to: 3, name: batter }); }
          else { runs++; moves.push({ from: 0, to: 4, name: batter }); }
        }
      }
      batting.score += runs;
      walkoff = half === 'bottom' && inning >= 9 && runs > 0 && home.score > away.score;
      const rbi = kind === 'error' ? 0 : runs;
      beats.push({ type: 'atbat', ...head(), batter, pitcher, kind, out: false, outs, rbi, runs, ...(fielder ? { fielder, errorType } : {}), ...tail(), moves: settle(before, moves) });
      if (walkoff) break;
    }
    beats.push({ type: 'half_end', inning, half, battingName: batting.name, fieldingName: fielding.name, awayScore: away.score, homeScore: home.score });
    return walkoff;
  };

  // v1's decisive extra-inning frame, with the batter named as the man who scored.
  const forceFinish = () => {
    inning = Math.max(inning, 10);
    const homeWins = rand() < 0.5;
    const bat = homeWins ? home : away, fld = homeWins ? away : home;
    const half = homeWins ? 'bottom' : 'top';
    const r = rand();
    const kind = r < 0.15 ? 'homerun' : (r < 0.5 ? 'double' : 'single');
    bat.score += 1;
    const batter = bat.lineup[bat.idx % 9];
    beats.push({ type: 'half_start', inning, half, battingName: bat.name, fieldingName: fld.name, pitcher: fld.pitcher, awayScore: away.score - (homeWins ? 0 : 1), homeScore: home.score - (homeWins ? 1 : 0) });
    beats.push({ type: 'atbat', inning, half, battingName: bat.name, fieldingName: fld.name, batter, pitcher: fld.pitcher, kind, out: false, outs: 0, rbi: 1, runs: 1, awayScore: away.score, homeScore: home.score, walkoff: homeWins, bases: [false, false, false], runners: [null, null, null], moves: [{ from: 0, to: 4, name: batter }] });
    beats.push({ type: 'half_end', inning, half, battingName: bat.name, fieldingName: fld.name, awayScore: away.score, homeScore: home.score });
  };

  while (!gameOver && inning < MAX_INNINGS) {
    inning++;
    playHalf('top', away, home);
    if (inning >= 9 && home.score > away.score) { gameOver = true; break; }
    if (playHalf('bottom', home, away)) { gameOver = true; break; }
    if (inning >= 9 && away.score !== home.score) { gameOver = true; break; }
    if (inning >= 10) {
      const decide = Math.min(1, (inning - 10) * EXTRAS_DECIDE_STEP);
      if (decide > 0 && rand() < decide) { forceFinish(); gameOver = true; break; }
    }
  }
  if (away.score === home.score) forceFinish();

  return { away, home, awayScore: away.score, homeScore: home.score, beats, innings: inning, version: 2 };
}

// The booth's words for a sim v2 play: {runner}, {base} (the bag in play) and {fielder}
// (charged with an error), as "second" and "the shortstop".
const BASE_WORDS = { 1: 'first', 2: 'second', 3: 'third', 4: 'home' };
const FIELDER_WORDS = {
  P: 'the pitcher', C: 'the catcher', '1B': 'the first baseman', '2B': 'the second baseman', '3B': 'the third baseman',
  SS: 'the shortstop', LF: 'the left fielder', CF: 'the centre fielder', RF: 'the right fielder',
};
// A ball in play adds its own: {fielder} is the man who fields it (sim v2's error names him
// itself), {diver} the one who dove for a hit and missed, and {feet} how far a home run went.
export function playTokens(b, play) {
  const by = (n) => FIELDER_WORDS[POSITIONS[n]] || '';
  return {
    runner: b.runner || '', base: BASE_WORDS[b.base] || '',
    fielder: FIELDER_WORDS[b.fielder] || (play?.f ? by(play.f[0]) : ''),
    diver: play?.mi ? by(play.mi) : '',
    feet: b.kind === 'homerun' && play?.d ? play.d : '',
  };
}

// The descriptor's sim: v2 when sportsGameForSlot says the slot plays it, else v1.
function simGameFor(matchup, players, rand, opts) {
  return opts?.version === 2 ? simGameV2(matchup, players, rand, opts) : simGame(matchup, players, rand);
}

// ── Sport descriptor ─────────────────────────────────────────────────────────
// The shape a second sport plugs into. `section` is the {section}/{sectionOrd}
// token vocabulary from docs/bsm-format.md — hockey sets this to 'period'.
// ── the season ───────────────────────────────────────────────────────────────
// How a game folds into a league table, and how that table sorts. Lifted verbatim
// out of broadcast/index.js's computeStandings when hockey arrived: a second sport
// counts a different set of things (a hockey table has three result columns, not
// two), and the alternative was a sport branch sitting in the engine forever.
//
// `fold` is called once per scheduled game over the season's slot window. It must
// stay PURE and cheap — the standings are a recomputed fold over thousands of slots,
// never a stored row, so this runs a lot.
// What counts as a hit. Deliberately a set rather than a regex: a new at-bat
// outcome must be classified on purpose, not caught by accident.
const HIT_KINDS = new Set(['single', 'double', 'triple', 'homerun']);
// The plays on the bases that count as a man running: a steal, or caught at it.
const STEAL_PLAYS = new Set(['steal', 'caughtstealing', 'doublesteal']);

// ── The season's ledger ──────────────────────────────────────────────────────
// Every man's season, folded play by play out of one game's beats into `acc`:
//
//   acc.bats: name -> { name, team, pa, ab, hits, hr, rbi, sb, cs }
//   acc.arms: name -> { name, team, w, l, outs, er, k }
//
// SEASON.foldExtras runs it over every game in the window; the Gameday payloads run it
// over one game on top of the season so far, with `before` and `after` called round
// each play, to read each man's line as it stood (sports/baseball-gameday.js).
//
// SCORING RULES beyond the hitting race's (see SEASON):
//   • A STOLEN BASE is a man who took the bag he ran for. On a double steal, if either
//     man is thrown out, neither is credited with one; the man thrown out is caught
//     stealing. A pickoff isn't a caught stealing.
//   • A pitcher's OUTS are the outs made while he's on the mound (an inning is three).
//     Each side's pitcher goes the distance, so the winning side's takes the win.
//   • EARNED RUNS, the way a scorer rebuilds an inning without its errors: a run is
//     unearned when it scores on an error or a passed ball, when the man scoring reached
//     on an error, or when the errors, counted as outs, would already have ended the
//     inning. A v1 game has no errors, so all its runs are earned.
export function foldGame(acc, game, { before, after } = {}) {
  acc.bats = acc.bats || new Map();
  acc.arms = acc.arms || new Map();
  // Last team seen wins: the pool is shuffled per game, so a name can turn out for
  // either side across a season and the recent one reads truer.
  const bat = (name, team) => {
    let r = acc.bats.get(name);
    if (!r) { r = { name, team, pa: 0, ab: 0, hits: 0, hr: 0, rbi: 0, sb: 0, cs: 0 }; acc.bats.set(name, r); }
    r.team = team || r.team;
    return r;
  };
  const arm = (name, team) => {
    let r = acc.arms.get(name);
    if (!r) { r = { name, team, w: 0, l: 0, outs: 0, er: 0, k: 0 }; acc.arms.set(name, r); }
    r.team = team || r.team;
    return r;
  };
  // the half so far: its outs, the errors that should have been outs, who reached on one
  let outs = 0, errOuts = 0;
  const onError = new Set();
  const pitcherOf = {};   // team -> the man pitching for it
  for (const b of game.beats || []) {
    if (b.type === 'half_start') {
      outs = 0; errOuts = 0; onError.clear();
      if (b.pitcher && b.fieldingName) pitcherOf[b.fieldingName] = b.pitcher;
      continue;
    }
    if (b.type !== 'atbat' && b.type !== 'run') continue;
    before?.(b);
    if (b.pitcher && b.fieldingName && !pitcherOf[b.fieldingName]) pitcherOf[b.fieldingName] = b.pitcher;
    // the runs on the play, and which of them were earned
    const runs = Number.isFinite(b.runs) ? b.runs : (b.rbi || 0);
    let earned = runs;
    if (runs > 0 && Array.isArray(b.moves)) {
      earned = outs + errOuts >= 3 || b.kind === 'error' || b.kind === 'passedball' ? 0
        : Math.min(runs, b.moves.filter((m) => m.to === 4 && !onError.has(m.name)).length);
    }
    if (b.kind === 'error' && b.batter) { errOuts += 1; onError.add(b.batter); }
    const made = Number.isFinite(b.outs) ? Math.max(0, b.outs - outs) : 0;
    if (Number.isFinite(b.outs)) outs = b.outs;
    if (b.pitcher) {
      const p = arm(b.pitcher, b.fieldingName);
      p.outs += made; p.er += earned;
      if (b.type === 'atbat' && b.kind === 'strikeout') p.k += 1;
    }
    if (b.type === 'atbat' && b.batter) {
      const r = bat(b.batter, b.battingName);
      r.pa += 1;
      if (b.kind !== 'walk' && b.kind !== 'sacfly' && b.kind !== 'hitbypitch') r.ab += 1;
      if (HIT_KINDS.has(b.kind)) r.hits += 1;
      if (b.kind === 'homerun') r.hr += 1;
      r.rbi += b.rbi || 0;
    } else if (b.type === 'run' && STEAL_PLAYS.has(b.kind)) {
      // who ran: the play's named moves, or the runner alone when it has none
      const ran = Array.isArray(b.moves) && b.moves.some((m) => m.name) ? b.moves.filter((m) => m.name)
        : b.runner ? [b.kind === 'caughtstealing' ? { name: b.runner, out: true } : { name: b.runner, from: 0, to: 1 }] : [];
      const caught = ran.some((m) => m.out != null);
      for (const m of ran) {
        if (m.out != null) bat(m.name, b.battingName).cs += 1;
        else if (!caught && m.to > m.from) bat(m.name, b.battingName).sb += 1;
      }
    }
    after?.(b);
  }
  // the decision
  const { awayScore: a, homeScore: h } = game;
  const away = game.away?.name, home = game.home?.name;
  if (Number.isFinite(a) && Number.isFinite(h) && a !== h && away && home) {
    const [win, lose] = a > h ? [away, home] : [home, away];
    if (pitcherOf[win]) arm(pitcherOf[win], win).w += 1;
    if (pitcherOf[lose]) arm(pitcherOf[lose], lose).l += 1;
  }
  return acc;
}
// A pitcher's earned run average: earned runs a nine innings, so 27 outs.
export const eraOf = (r) => (r && r.outs ? (r.er * 27) / r.outs : 0);

export const SEASON = {
  finalName: 'World Series',
  finalShort: 'WS',
  // Column labels for the on-air standings bug and the `standings` command.
  columns: ['W', 'L', 'RD'],
  fold(table, game) {
    const { awayScore, homeScore } = game;
    if (awayScore === homeScore) return;                   // the sim never ties; guard anyway
    const bump = (team, w, l, rf, ra) => {
      const t = table.get(team) || { team, wins: 0, losses: 0, runs_for: 0, runs_against: 0 };
      t.wins += w; t.losses += l; t.runs_for += rf; t.runs_against += ra; table.set(team, t);
    };
    const awayWon = awayScore > homeScore;
    bump(game.away.name, awayWon ? 1 : 0, awayWon ? 0 : 1, awayScore, homeScore);
    bump(game.home.name, awayWon ? 0 : 1, awayWon ? 1 : 0, homeScore, awayScore);
  },
  sort(rows) {
    const rd = (r) => (r.runs_for || 0) - (r.runs_against || 0);
    return rows.sort((a, b) => {
      const pa = a.wins / (a.wins + a.losses), pb = b.wins / (b.wins + b.losses);
      if (pb !== pa) return pb - pa;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (rd(b) !== rd(a)) return rd(b) - rd(a);
      return a.team.localeCompare(b.team);
    });
  },
  // ── The hitting race ───────────────────────────────────────────────────────
  // Deadball's batting leaders, accumulated across the season exactly the way
  // hockey accumulates its scoring race.
  //
  // This costs nothing extra to compute: `simGame` already emits a full at-bat
  // beat for every plate appearance (batter, kind, rbi) on the RESULT-ONLY path
  // too, so the numbers were being generated and thrown away every time the
  // table was folded. Reading them back is a walk over an array the sim just
  // built — no second simulation, no stored rows, and the leaders can never
  // disagree with the games that aired because they are the same games.
  //
  // SCORING RULES, because a batting average computed the naive way is wrong in
  // a way people notice:
  //   • A WALK is not an at-bat. It counts as a plate appearance and nothing else.
  //   • A SACRIFICE FLY is not an at-bat either — you gave yourself up for the run.
  //   • Nor is being HIT BY A PITCH (sim v2). Reaching on an ERROR is an at-bat
  //     without a hit.
  //   • Everything else (including a double play or a productive out, which are
  //     just outs the batter is charged with) is an at-bat.
  // Get those two exclusions wrong and every average in the league reads low.
  // The steals and the pitchers' lines come off the same walk (foldGame has their rules).
  foldExtras(acc, game) {
    foldGame(acc, game);
  },
  summariseExtras(acc) {
    const all = [...(acc.bats || new Map()).values()];
    // A qualifier gate, or the leaderboard is whoever went 2-for-2 in April. Scaled
    // to the season actually played rather than a fixed number, so an early-season
    // table still has names on it instead of being empty for a fortnight.
    const maxAb = all.reduce((m, r) => Math.max(m, r.ab), 0);
    const minAb = Math.max(5, Math.floor(maxAb * 0.4));
    const avg = (r) => (r.ab ? r.hits / r.ab : 0);
    const qualified = all.filter(r => r.ab >= minAb);
    const pool = qualified.length ? qualified : all;   // never show an empty race
    const top = (key, cmp) => [...pool].sort(cmp).slice(0, 5).map(r => ({ ...r, avg: avg(r) }));
    // Steals and strikeouts are counted, not averaged, so they need no qualifier; a man
    // with none isn't in the race.
    const arms = [...(acc.arms || new Map()).values()];
    return {
      batters: top('avg', (a, b) => avg(b) - avg(a) || b.hits - a.hits || a.name.localeCompare(b.name)),
      homers:  top('hr',  (a, b) => b.hr - a.hr || avg(b) - avg(a) || a.name.localeCompare(b.name)),
      rbis:    top('rbi', (a, b) => b.rbi - a.rbi || b.hits - a.hits || a.name.localeCompare(b.name)),
      steals: all.filter(r => r.sb > 0).sort((a, b) => b.sb - a.sb || a.cs - b.cs || a.name.localeCompare(b.name))
        .slice(0, 5).map(r => ({ ...r, avg: avg(r) })),
      strikeouts: arms.filter(r => r.k > 0).sort((a, b) => b.k - a.k || a.outs - b.outs || a.name.localeCompare(b.name))
        .slice(0, 5).map(r => ({ ...r, era: eraOf(r) })),
      minAb,
      // Every man's line, for the Gameday payloads' matchup lines. It stays on the
      // server: the payloads carry only the lines of the men on the field.
      ledger: { bats: acc.bats || new Map(), arms: acc.arms || new Map() },
    };
  },
};

export const BASEBALL = {
  id: 'baseball',
  // How the league names itself on a listing or a table. The TV guide and the
  // standings button read this rather than the word DEADBALL, which used to be
  // written into both and put a ballgame's name on a hockey night.
  brand: 'DEADBALL',
  finalIcon: '⚾',
  season: SEASON,
  section: 'inning',
  sectionPlural: 'innings',
  simGame: simGameFor,
  // The sim versions this sport has. sportsGameForSlot picks one by slot; see the switch
  // in broadcast/index.js.
  simVersions: [1, 2],
  synthDetail: synthPitches,
  synthPlay,
  playTags,
  playDesc,
  playTokens,
  handOf,
  battingSide,
  defaultNames: DEFAULT_NAMES,
};

export default BASEBALL;
