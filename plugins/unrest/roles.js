// Who is playing, and what makes their work possible — phase 3.
//
// Roles are authored on `orgs.flags.role` and this is the only file that turns
// one into behaviour. `ledger.js` already reads the roster to decide who pushes
// which scalar; this decides who may STAGE, which is the other half of the same
// question and the half phases 1 and 2 answered with a single hardcoded rule.
//
// ⚠ THE POINT OF THIS FILE IS THAT RULE 1 IS NOT ONE RULE. Phase 1's gate — a
// band high enough, plus a perceivable signal from the same order inside the
// window — is correct for the two orders that fight over ground and wrong for
// both orders that do not. The Null do not want the block; they want what is
// bolted to it, so a cell that has gone quiet under a heavy hand is their ideal
// target and phase 1 would refuse it for being quiet. The Wildblood do not read
// the block at all; they come in off their own clock, and phase 1 would refuse
// them until the city had already done something.
//
// So the gate becomes a REGISTRY keyed on an authored `flags.driver`, exactly the
// way the stage vocabulary is a registry keyed on an authored `do`. Phase 1's
// gate is the `ground` driver and is still the default, so every incident that
// already ships is unchanged and un-reauthored.
//
//   ground     (default)  band + a signal from the same order       — rules 1 and 2
//   vendetta   Null       grip, and a signal from THE AUTHORITY     — never heat
//   incursion  Wildblood  the clock, and nothing else at all        — no local state
//
// Each driver declares the authored role that backs it. If the Null are removed
// from `content/orgs/`, vendetta incidents stop staging rather than staging
// anonymously — which is what keeps "roles are data, never a switch statement"
// true of the second half as well as the first.
import { world } from '../../server/engine/world.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import * as ledger from './ledger.js';
import * as signals from './signals.js';
import { allBlocks } from './blocks.js';

const RANK = { quiet: 0, watchful: 1, tense: 2, flashpoint: 3 };

// ── The roster ───────────────────────────────────────────────────────────────

/**
 * Every non-expansion order that declares a role. Moved here from index.js in
 * phase 3, because two things now ask the roster questions and neither of them
 * is the wiring.
 *
 * The four expansion orders (Prometheans, Synthesis, Pioneers, Lucid) carry
 * `flags.expansion` and are preview-only, never winning the lean, so they take no
 * role and the sim skips them.
 */
export function roles() {
  const out = [];
  for (const org of world.orgs.values()) {
    if (org?.flags?.expansion) continue;
    const role = org?.flags?.role;
    if (!role || !role.writes) continue;
    out.push({ id: org.id, writes: role.writes, reads: role.reads || null, drift: role.drift || null });
  }
  return out;
}

/** The first role matching a predicate, or null. Sync — it is a Map walk. */
function roleWhere(pred) {
  return roles().find(pred) || null;
}

// ── The clock the Wildblood keep ─────────────────────────────────────────────
//
// ⚠ Read ONCE per selection pass and threaded down, not per (definition, cell)
// pair: `candidates()` is defs × cells and the dev panel's blocked-reason table
// is the same product again.

/** Night, in minutes-of-day. They come in the dark and are gone by breakfast. */
export const NIGHT_FROM = 22 * 60;
export const NIGHT_TO = 4 * 60;

/**
 * `{ date: 'YYYY-MM-DD', minutes }`, or null when the environment has not been
 * booted — which is the normal case in the regression suite, and is why every
 * caller treats a null clock as "the window is shut" rather than as an error.
 */
export function readClock() {
  try {
    const { date, time } = getGameDateTime();
    if (!date || typeof time !== 'string') return null;
    const [h, m] = time.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return { date, minutes: h * 60 + m };
  } catch { return null; }
}

/**
 * Which night is it, as an integer that increments once a day?
 *
 * ⚠ A night SPANS MIDNIGHT, so the small hours belong to the night before. Get
 * this wrong and the target cell changes at 00:00 — half a raid in one part of
 * town and half in another, on the one system whose whole promise is that it
 * came from somewhere.
 */
export function nightOf(clock) {
  if (!clock?.date) return null;
  const [y, mo, d] = String(clock.date).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const ordinal = Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  return clock.minutes < NIGHT_TO ? ordinal - 1 : ordinal;
}

/** Is the window open at all? */
export function nightOpen(clock) {
  if (!clock) return false;
  return clock.minutes >= NIGHT_FROM || clock.minutes < NIGHT_TO;
}

/**
 * The one cell they come in through tonight.
 *
 * ⚠ Derived from the night, never rolled. A stored roll would be RAM state that
 * does not survive a restart (rule 6) and a fresh roll per pass would let them
 * arrive in four parts of town in one night. Deriving it makes "they came in up
 * the north end last night" a fact about the world that two players agree on and
 * that a restart cannot contradict.
 *
 * Keys are SORTED before indexing: `allBlocks()` follows Map insertion order,
 * which follows whatever order `world.zones` was filled in, and a target that
 * depends on that is a target that can move across a restart for no reason.
 */
export function nightTarget(clock, keys = allBlocks()) {
  const night = nightOf(clock);
  if (night == null || !keys.length) return null;
  const sorted = [...keys].sort();
  return sorted[((night % sorted.length) + sorted.length) % sorted.length];
}

// ── The driver registry ──────────────────────────────────────────────────────
//
// A driver is { requires, gate, onStage }.
//   requires  a predicate over one authored role, or null for "no order needed"
//   gate      (def, key, now, clock) -> null to allow, or a short refusal string
//   onStage   (def, key) -> void, run once when a staging actually happens
//
// The refusal string is what the dev panel prints per cell. An operator who
// cannot see WHY nothing is staging concludes the sim is broken, so every branch
// below returns a word rather than a boolean.

const DRIVERS = new Map();

export function registerDriver(name, driver) {
  if (DRIVERS.has(name)) throw new Error(`unrest: driver "${name}" registered twice`);
  DRIVERS.set(name, { requires: null, onStage: null, ...driver });
}

export function driverNames() { return [...DRIVERS.keys()]; }

/**
 * The driver an incident runs on. An unknown authored name falls back to
 * `ground` rather than throwing — half a catalogue is worse than a strict one,
 * and regress is what actually stops the row existing.
 */
export function driverFor(def) {
  const name = def?.flags?.driver;
  if (!name) return DRIVERS.get('ground');
  const d = DRIVERS.get(name);
  if (d) return d;
  console.warn(`[unrest] incident ${def.id} names an unknown driver "${name}"`);
  return DRIVERS.get('ground');
}

/** The name, for the dev panel and for regress. */
export function driverNameFor(def) {
  const name = def?.flags?.driver;
  return name && DRIVERS.has(name) ? name : 'ground';
}

// ── ground: phases 1 and 2, unchanged ────────────────────────────────────────

registerDriver('ground', {
  requires: null,
  gate(def, key, now) {
    if (RANK[ledger.bandOf(key)] < RANK[def.minBand]) return 'band';
    // ⚠ RULE 1. Same order, inside the window. A cell whose mood belongs to the
    // authority cannot host an insurgency incident until heat has actually said
    // something there, which is what makes every staging attributable.
    if (!signals.hadSignal(key, def.writes, signals.SIGNAL_WINDOW_MS, now)) return 'signal';
    return null;
  },
});

// ── vendetta: the Null ───────────────────────────────────────────────────────
//
// The Null's authored role is `{ writes: 'assets', reads: 'grip' }` and both
// halves of that are load-bearing here.
//
// READS GRIP, NOT THE BAND. The band is `heat + grip/2`, so a block the
// authority has finished pacifying reads quiet however heavy the hand on it
// still is — and that is precisely the block with the most licensed machinery
// bolted to it and the fewest people on the street to see it stop working. A
// vendetta is the reply to the squeeze, arriving after the squeeze has worked.
// It never looks at heat at all, which is what makes it the one incident type
// that can land on a cell nothing else can reach.
//
// WRITES ASSETS, SO IT PUTS NOTHING IN THE LEDGER. Every other incident's order
// is fighting over the ground the ledger measures. The Null are not, so there is
// no `onStage` here — a vendetta changes what is broken, not who holds the
// street, and a sim that scored it would be measuring the wrong thing.
//
// ⚠ RULE 1 STILL HOLDS, POINTED AT SOMEBODY ELSE. The signal a vendetta answers
// is the AUTHORITY'S, not its own: the Null have no street voice and want none,
// so requiring a signal from `assets` would require them to announce themselves
// first. What must have happened in this cell is that the player could SEE the
// grip they are being made to pay for.

export const VENDETTA_GRIP = 25;

registerDriver('vendetta', {
  requires: (r) => r.writes === 'assets',
  gate(def, key, now) {
    if (ledger.read(key).grip < VENDETTA_GRIP) return 'grip';
    if (!signals.hadSignal(key, 'grip', signals.SIGNAL_WINDOW_MS, now)) return 'signal';
    return null;
  },
  onStage: null,
});

// ── incursion: the Wildblood ─────────────────────────────────────────────────
//
// Their authored role is `{ writes: 'heat', reads: 'clock' }`, and `reads:
// 'clock'` is why `ledger.step()` deliberately excludes them from the insurgency
// loop: they write the same scalar the Long Watch do and are not doing the same
// thing with it. The Long Watch live here and grind. The Wildblood arrive.
//
// NO LOCAL PRECONDITION, AT ALL. No band, no signal, no grip, no heat. The only
// question is what time it is, because the one thing an incursion must never be
// is a consequence of what the city has been doing. That is the whole difference
// between a fifth participant and something happening TO the participants.
//
// A BURST THAT LEAVES NOTHING BEHIND. `onStage` puts heat in and nothing else —
// never pressure, which is the grievance a block accumulates over days and finally
// ignites from, so adding to it would put the city's next flashpoint on their tab.
// Heat's half-life is twenty minutes, so the block is loud by morning and back to
// exactly what it was by lunchtime, with nothing in the ledger to say they were
// ever there. An incursion that moved pressure would make the Wildblood a
// permanent tenant of a city they do not want.

export const INCURSION_BURST = 35;

registerDriver('incursion', {
  requires: (r) => r.reads === 'clock',
  gate(def, key, now, clock) {
    if (!nightOpen(clock)) return 'clock';
    // One way in per night, derived rather than rolled. Every other cell refuses
    // with 'elsewhere', which is a more useful thing for an operator to read
    // than ten identical 'clock's.
    if (key !== nightTarget(clock)) return 'elsewhere';
    return null;
  },
  onStage(def, key) {
    ledger.bump(key, 'heat', INCURSION_BURST);
  },
});

// ── The universal guards ─────────────────────────────────────────────────────

/**
 * Refusals that apply whatever the driver is. Returns null to continue.
 *
 * ⚠ WITHDRAWN NEVER STAGES. The Exodus's authored role is `{ writes: 'none' }`
 * and that is a position, not a gap: they are not in this fight and nothing
 * attributed to them may ever appear on a street. `writes: 'none'` is truthy, so
 * an order that opted out would otherwise sail through every filter that tests
 * for a role at all.
 */
export function guard(def) {
  if (def.writes === 'none') return 'withdrawn';
  const driver = driverFor(def);
  if (driver.requires && !roleWhere(driver.requires)) return 'no-order';
  return null;
}

export const _test = { DRIVERS, RANK, roleWhere };
