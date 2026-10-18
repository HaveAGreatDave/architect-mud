// Hololock at the `log` rung: does the turn-based lock win as often as the dice?
//
//   node scripts/a11y/hololock-odds.mjs              the report, and the gate
//   node scripts/a11y/hololock-odds.mjs --games N    Monte Carlo games per row (default 20000)
//   node scripts/a11y/hololock-odds.mjs --table      print a freshly calibrated CAPACITY table
//   node scripts/a11y/hololock-odds.mjs --explain    best play's moves from a fresh pin
//
// The `log` rung used to settle a hololock with one 2d8-2d8 skillCheck. The
// turn-based lock in client/shared/hololock-turns.js replaces that roll
// (docs/proposals/hololock-turn-based.md). The rule from
// docs/systems-display-mode.md is that an accessibility rung may move the
// interface but never the odds on a contested outcome, so this script does the
// arithmetic the Reaction Time slider never had done.
//
// It imports the shipped rules and:
//   1. Solves the lock exactly (dynamic programming over every state a player can
//      be in) for the best possible win rate at each capacity, and checks the
//      committed CAPACITY table still lands best play on the dice. Because the
//      solver finds the BEST play, no strategy beats the dice; worse play only
//      falls below them, as clumsy play does on the reflex lock.
//   2. Plays the shipped rules game by game with random locks, using best play
//      and two policies a person would use. That's the independent check: it
//      runs the rules, not the solver's model of them.
//   3. Sweeps effective skill 0-15 against difficulty 1-12.
// Exits 1 if best play, solved or played, misses the dice by more than 3 points,
// or if the committed table has drifted from a fresh calibration.
//
// No database, no network, no files written: safe beside anything.
import {
  TRACK, WIDTH, COST, CAPACITY, GAP_MIN, GAP_MAX, pinsFor, boardFor, newLock, act,
} from '../../client/shared/hololock-turns.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : dflt);
const GAMES = opt('--games', 20000);
const LIMIT = 0.03;

// ── The target: skillCheck's curve ───────────────────────────────────────────
// skills.js: margin = (effective - difficulty) + (2d8 - 2d8), success at >= 0.
// So the chance depends only on the gap, and a fractional gap acts as its floor.
const SWING = (() => {
  const two = new Map();
  for (let a = 1; a <= 8; a++) for (let b = 1; b <= 8; b++) two.set(a + b, (two.get(a + b) || 0) + 1);
  const d = new Map();
  for (const [x, nx] of two) for (const [y, ny] of two) d.set(x - y, (d.get(x - y) || 0) + nx * ny);
  return d;   // swing -> ways out of 4096
})();
function diceWinChance(gap) {
  const need = -Math.floor(gap);
  let ways = 0;
  for (const [s, n] of SWING) if (s >= need) ways += n;
  return ways / 4096;
}

// ── Knowledge ────────────────────────────────────────────────────────────────
// A player's knowledge of the current pin is an interval of possible window
// starts, every one equally likely (`lock.known` in the rules). The board says
// it as a sentence, so nothing has to be remembered.
function outcomes(lo, hi, width, cell) {
  const hit = Math.max(0, Math.min(hi, cell) - Math.max(lo, cell - width + 1) + 1);
  const right = Math.max(0, hi - Math.max(lo, cell + 1) + 1);     // starts above the cell
  const left = Math.max(0, Math.min(hi, cell - width) - lo + 1);  // windows ending below it
  return { hit, right, left };
}

// ── Exact solver ─────────────────────────────────────────────────────────────
// V(left, lo, hi, budget) = best achievable win chance with `left` pins still to
// set, the window somewhere in [lo, hi], and `budget` feedback still to spend
// before the meter trips (capacity - feedback). Keyed on what's LEFT, one table
// serves every pin count and capacity. It models the rules in hololock-turns.js;
// the played games below are what catch a disagreement between the two.
const memo = new Map();
const maxStart = TRACK - WIDTH;
const id = (left, lo, hi, budget) => ((left * 32 + lo) * 32 + hi) * 4096 + budget;
function V(left, lo, hi, budget) {
  if (budget <= 0) return 0;
  if (left <= 0) return 1;
  const k = id(left, lo, hi, budget);
  const got = memo.get(k);
  if (got !== undefined) return got.v;
  const m = hi - lo + 1;
  let best = -1, move = null;
  for (let cell = 0; cell < TRACK; cell++) {
    const o = outcomes(lo, hi, WIDTH, cell);
    if (o.hit === 0 && (o.left === 0 || o.right === 0)) continue;   // tells you nothing
    const miss = (cost) =>
      (o.right ? o.right / m * V(left, Math.max(lo, cell + 1), hi, budget - cost) : 0) +
      (o.left ? o.left / m * V(left, lo, Math.min(hi, cell - WIDTH), budget - cost) : 0);
    const vSet = o.hit / m * V(left - 1, 0, maxStart, budget) + miss(COST.miss);
    const vProbe = o.hit / m * V(left - 1, 0, maxStart, budget - COST.probe) + miss(COST.probe);
    if (vSet > best + 1e-12) { best = vSet; move = { move: 'set', cell }; }
    if (vProbe > best + 1e-12) { best = vProbe; move = { move: 'probe', cell }; }
  }
  memo.set(k, { v: best, move });
  return best;
}
const valueAt = (pins, capacity) => V(pins, 0, maxStart, capacity);
const bestMove = (left, lo, hi, budget) => { V(left, lo, hi, budget); return memo.get(id(left, lo, hi, budget)).move; };

// Best play's exact win chance on a board, capacity roll included.
function exactValue(board) {
  const c = Math.floor(board.capacity), q = board.capacity - c;
  return (1 - q) * valueAt(board.pins, c) + (q > 0 ? q * valueAt(board.pins, c + 1) : 0);
}

// ── Calibration ──────────────────────────────────────────────────────────────
// The capacity is a real number, rolled at jack-in to one of the two whole
// numbers beside it, so best play wins exactly (1-q)·V(c) + q·V(c+1). That's how
// it lands on the dice between two whole capacities; a whole-number capacity
// missed by up to 25 points. 0 at gap -15, where the dice never win either.
const CAP_MAX = 200;
function calibrate(pins, gap) {
  const target = diceWinChance(gap);
  if (target <= 0) return { capacity: 0, lo: 0, hi: 0 };
  for (let c = 0; c < CAP_MAX; c++) {
    const a = valueAt(pins, c), b = valueAt(pins, c + 1);
    if (b >= target - 1e-12) return { capacity: c + (b > a ? (target - a) / (b - a) : 1), lo: a, hi: b };
  }
  throw new Error(`no capacity reaches ${target} at ${pins} pins`);
}

if (args.includes('--table')) {
  console.log(`export const CAPACITY = {`);
  for (let pins = 3; pins <= 6; pins++) {
    const cells = [];
    for (let gap = GAP_MIN; gap <= GAP_MAX; gap++) cells.push(calibrate(pins, gap).capacity.toFixed(2));
    console.log(`  ${pins}: [${cells.join(', ')}],`);
  }
  console.log('};');
  process.exit(0);
}

if (args.includes('--explain')) {
  for (let left = 1; left <= 3; left++) {
    for (let m = TRACK; m >= 2; m--) {
      const line = [];
      for (let budget = 1; budget <= 16; budget++) {
        const mv = bestMove(left, 0, m - 1, budget);
        line.push(`${mv.move === 'set' ? 'S' : 'p'}${mv.cell + 1}`.padStart(4));
      }
      console.log(`left ${left} cells ${String(m).padStart(2)}: ${line.join('')}`);
    }
  }
  process.exit(0);
}

// ── Policies ─────────────────────────────────────────────────────────────────
// What a player does, given only what the board has told them: the pin, where
// the window can still be, the feedback so far and the capacity.
//
// `careful`: probe the middle of what's left until a cell is certain, then set
//   it. Never risks a missed set. The obvious play for someone new.
// `sensible`: the rule of thumb `help` teaches, read off the solver's own moves
//   (`--explain`). Probe the fourth cell of what's left (just below the middle
//   when fewer than seven are left), and once the feedback you can still take is
//   down to the number of pins left, stop probing and set.
// `best`: the solver's move, the ceiling the table was calibrated to.
const certainCell = (lock) => (lock.known.hi <= lock.known.lo + lock.width - 1 ? lock.known.hi : -1);
const fourthCell = (k) => k.lo + Math.min(3, Math.ceil((k.hi - k.lo + 1) / 2) - 1);
function middleCell(lock) {
  const k = lock.known;
  let pick = null;
  for (let cell = 0; cell < lock.track; cell++) {
    const o = outcomes(k.lo, k.hi, lock.width, cell);
    if (o.hit === 0 && (o.left === 0 || o.right === 0)) continue;
    const worst = Math.max(o.left, o.right, o.hit);
    if (!pick || worst < pick.worst || (worst === pick.worst && o.hit > pick.hit)) pick = { cell, worst, hit: o.hit };
  }
  return pick.cell;
}
const POLICIES = {
  careful: (lock) => {
    const sure = certainCell(lock);
    return sure >= 0 ? { move: 'set', cell: sure } : { move: 'probe', cell: middleCell(lock) };
  },
  sensible: (lock) => {
    const sure = certainCell(lock);
    if (sure >= 0) return { move: 'set', cell: sure };
    const spare = lock.capacity - lock.feedback;
    return { move: spare <= lock.pins - lock.pin ? 'set' : 'probe', cell: fourthCell(lock.known) };
  },
  best: (lock) => bestMove(lock.pins - lock.pin, lock.known.lo, lock.known.hi, lock.capacity - lock.feedback),
};

function play(board, policy, rng) {
  const lock = newLock(board, rng);
  while (!lock.over) { const { move, cell } = policy(lock); act(lock, move, cell); }
  return lock.won;
}

// A small seeded generator, so a run is reproducible.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Report ───────────────────────────────────────────────────────────────────
const pct = (x) => (x * 100).toFixed(1).padStart(5);
const pts = (x) => ((x >= 0 ? '+' : '') + (x * 100).toFixed(1)).padStart(5);
const rng = mulberry32(20261018);
const t0 = process.hrtime.bigint();
const failures = [];

console.log('Hololock, turn-based, against skillCheck (2d8-2d8)');
console.log(`Track ${TRACK}, probe +${COST.probe}, missed set +${COST.miss}, ${GAMES} games per row.`);
console.log("cap is the committed capacity; roll is best play's chance at the two whole capacities it rolls to.\n");

// Drift: does the committed table still match a fresh calibration?
for (let pins = 3; pins <= 6; pins++) {
  for (let gap = GAP_MIN; gap <= GAP_MAX; gap++) {
    const fresh = calibrate(pins, gap).capacity, shipped = CAPACITY[pins][gap - GAP_MIN];
    if (Math.abs(fresh - shipped) > 0.006) failures.push(`CAPACITY[${pins}] at gap ${gap} is ${shipped}, a fresh calibration says ${fresh.toFixed(2)}: re-run with --table`);
  }
}

const rows = [];
for (let pins = 3; pins <= 6; pins++) {
  // a difficulty that gives this many pins, so boardFor is what's measured
  const difficulty = [...Array(20).keys()].find((d) => pinsFor(d) === pins);
  console.log(`${pins} pins`);
  console.log('  gap    cap     roll      dice | played   diff | careful  diff | sensible diff');
  for (let gap = -12; gap <= 12; gap++) {
    const board = boardFor(difficulty + gap, difficulty);
    const c = Math.floor(board.capacity);
    const lo = valueAt(pins, c), hi = valueAt(pins, c + 1);
    const target = diceWinChance(gap);
    const run = (name) => {
      let w = 0;
      for (let i = 0; i < GAMES; i++) if (play(board, POLICIES[name], rng)) w++;
      return w / GAMES;
    };
    const played = run('best'), careful = run('careful'), sensible = run('sensible');
    rows.push({ pins, gap, target, played, careful, sensible, spread: hi - lo });
    const roll = `${(lo * 100).toFixed(0)}/${(hi * 100).toFixed(0)}`.padStart(7);
    console.log(`  ${String(gap).padStart(3)}  ${board.capacity.toFixed(2).padStart(5)}  ${roll}  ${pct(target)} | ${pct(played)}  ${pts(played - target)} | ${pct(careful)}  ${pts(careful - target)} | ${pct(sensible)}  ${pts(sensible - target)}`);
  }
  console.log('');
}

// The sweep, through the shipped boardFor, exact.
let worst = { err: 0 }, sumErr = 0, n = 0;
for (let skill = 0; skill <= 15; skill++) {
  for (let difficulty = 1; difficulty <= 12; difficulty++) {
    const err = Math.abs(exactValue(boardFor(skill, difficulty)) - diceWinChance(skill - difficulty));
    sumErr += err; n++;
    if (err > worst.err) worst = { err, skill, difficulty };
  }
}
const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
const worstOf = (f) => rows.reduce((w, r) => Math.max(w, Math.abs(f(r))), 0);
const playedWorst = worstOf((r) => r.played - r.target);
console.log(`Sweep: effective skill 0-15 x difficulty 1-12 (${n} inputs), against the dice`);
console.log(`  best, exact:   worst ${(worst.err * 100).toFixed(2)} points${worst.err > 0.0005 ? ` (skill ${worst.skill}, difficulty ${worst.difficulty})` : ''}, mean ${(sumErr / n * 100).toFixed(2)}`);
console.log(`  best, played:  worst ${(playedWorst * 100).toFixed(1)} points, mean ${pts(mean((r) => r.played - r.target))} (noise at ${GAMES} games is about ${(100 / Math.sqrt(GAMES)).toFixed(1)} at worst)`);
console.log(`  sensible:      mean ${pts(mean((r) => r.sensible - r.target))}, worst ${pts(Math.min(...rows.map((r) => r.sensible - r.target)))}`);
console.log(`  careful:       mean ${pts(mean((r) => r.careful - r.target))}, worst ${pts(Math.min(...rows.map((r) => r.careful - r.target)))}`);
console.log(`  roll:          the capacity roll moves best play by ${(mean((r) => r.spread) * 100).toFixed(1)} points on average, ${(worstOf((r) => r.spread) * 100).toFixed(1)} at most`);
console.log(`\n${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1)} s`);

if (worst.err > LIMIT) failures.push(`best play misses the dice by ${(worst.err * 100).toFixed(1)} points (skill ${worst.skill}, difficulty ${worst.difficulty})`);
// Monte Carlo noise is about 0.7 points at 20,000 games, so only judge it there.
if (GAMES >= 20000 && playedWorst > LIMIT) failures.push(`played best play misses the dice by ${(playedWorst * 100).toFixed(1)} points`);
if (failures.length) { for (const f of failures) console.log(`FAIL: ${f}`); process.exit(1); }
