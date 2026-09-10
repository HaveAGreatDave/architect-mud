// BIRTHDAY — the in-world date you were decanted, and how old that makes you.
//
// THE GAME CALENDAR, NOT THE REAL ONE. This used to be the anniversary of the
// real-world day the account row was written, on the reasoning that an
// accelerated game-year birthday would come round every few days. That reasoning
// was right about the mechanism and wrong about the character: it meant a person
// living in 2076 had a birthday on a calendar nobody in the world can see, and an
// age measured in how long a player had owned the account. Now the date is an
// in-world one (`world_clock.game_date`, seeded 2076-07-13) and the age is a real
// number of in-world years, which is the only reading that means anything to
// somebody standing in Coldwater.
//
// TWENTY-FIVE YEARS. A character begins at 25. That is not derived from anything
// and is not meant to be: it is the age the vats hand you, and it is why every
// tank-grown adult in this city walks out fully formed with no childhood to
// discuss.
//
// ── LATCHED ONCE, DERIVED FROM THE ACCOUNT ───────────────────────────────────
//
// The birth date is written into a player flag the first time anybody asks, and
// read from that flag forever after. What it is derived from at that one moment
// is the account's own age, extrapolated onto the world's calendar:
// `players.created_at` is a real unix timestamp, and the world clock runs at
// `world_clock.time_scale` game-days per real day (3, currently). So the in-world
// date the account was registered is today's game date minus
// (real days since registration × scale), and the commencement date is
// twenty-five years before THAT.
//
// It is latched rather than recomputed on every ask because the scale is a knob
// that has changed and will change again: recomputing would slide a character's
// birthday every time somebody touched the dev panel's game-speed slider. Latch
// once, against the scale in force at that moment, and afterwards it is simply a
// fact about them.
//
// THE ONE-TIME RE-LATCH. The first version of this stored today-minus-25 for
// everybody, which made every existing character's birthday the day they first
// typed the verb — an account a month old reporting "Today, in fact". BASIS_FLAG
// records which rule wrote the stored date, so a birth date with no basis against
// it is one of those: it is recomputed from the account once and stamped. That is
// why overwriting a latched value is correct here and nowhere else, and why the
// stamp must be written in the same call as the date.
//
// An account whose `created_at` cannot be read falls back to today-minus-25 and
// is stamped `unknown` rather than left unstamped, so it does not recompute on
// every ask — and can be told apart from a real derivation later.
//
// HIDDEN BY DEFAULT, deliberately. It is on no sheet, in no panel, and in no
// examine. `birthday` is the only thing that will tell you, which is what makes
// it worth typing — and it means anything built on top of this later (a card, an
// NPC who remembers, a discount) gets to be the one that reveals it.
import { query } from '../../server/models/db.js';
import { getFlag, setFlags } from '../../server/engine/flags.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import { getTimeScale } from '../../server/engine/gametime.js';

const GIFT = 'item_soylent_manyhappy';
const CLAIM_FLAG = 'birthday_gift_year';   // holds the GAME year last claimed
const BIRTH_FLAG = 'birth_date';           // 'YYYY-MM-DD' on the game calendar
const BASIS_FLAG = 'birth_date_basis';     // which rule wrote it: 'account' | 'unknown'

const DAY_MS = 86_400_000;

// The age the vats hand you.
export const DECANT_AGE = 25;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th';
  return `${n}${s}`;
};

// ── Game dates are 'YYYY-MM-DD' strings ──────────────────────────────────────
//
// Parsed by hand rather than through `new Date(str)`, which would drag the host
// machine's timezone into a calendar that has nothing to do with it — a world
// date of 2076-01-01 must not become 2075-12-31 because the server is in Auckland.

function parseGameDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
}

const fmtGameDate = ({ y, mo, d }) =>
  `${String(y).padStart(4, '0')}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysInMonth = (y, mo) => (mo === 1 && isLeap(y) ? 29 : DAYS_IN[mo]);

// Day-of-year, for counting the gap between two dates on the same calendar.
function dayOfYear({ y, mo, d }) {
  let n = d;
  for (let i = 0; i < mo; i++) n += daysInMonth(y, i);
  return n;
}

/**
 * Today on the world's own calendar, and the speed it is running at.
 *
 * Two sources, in order. The live clock (`environment.js` module state) is the
 * production path and costs nothing. The `world_clock` row is the fallback for
 * any process that has not run `initEnvironment` — the regress harness boots the
 * world and the plugins but not the environment, and a verb that refused because
 * a module-level cache was cold would be untestable AND wrong: the date exists,
 * it is simply in the database rather than in memory.
 *
 * That fallback matters beyond tests, because this function feeds a LATCH.
 * Refusing on a cold cache would be survivable; guessing on one would write
 * somebody a wrong birth date forever — which is also why the scale is read from
 * the same source as the date rather than from `getTimeScale()` alone. That
 * helper answers 1 both when the world really is 1× and when nobody has told it
 * anything yet, and the two are indistinguishable from here.
 */
export async function gameNow() {
  try {
    const live = parseGameDate(getGameDateTime()?.date);
    if (live) return { today: live, scale: getTimeScale() };
  } catch { /* environment not initialised — fall through to the row */ }

  try {
    const { rows } = await query('SELECT game_date, time_scale FROM world_clock WHERE id = 1');
    const raw = rows[0]?.game_date;
    // The column is a DATE, so the driver may hand back a Date object. Format it
    // from its UTC parts rather than through toISOString-on-local, which is the
    // usual way a calendar loses a day.
    const today = raw instanceof Date
      ? { y: raw.getUTCFullYear(), mo: raw.getUTCMonth(), d: raw.getUTCDate() }
      : parseGameDate(raw);
    const scale = Number(rows[0]?.time_scale) > 0 ? Number(rows[0].time_scale) : 1;
    return { today, scale };
  } catch {
    return { today: null, scale: 1 };
  }
}

/** Today alone, for everything that does not care how fast the world is moving. */
export async function gameToday() {
  return (await gameNow()).today;
}

/** N days along the world's calendar. Negative walks backwards. */
export function addDays(date, n) {
  if (!date) return null;
  let { y, mo, d } = date;
  d += Math.trunc(n) || 0;
  while (d > daysInMonth(y, mo)) { d -= daysInMonth(y, mo); if (++mo > 11) { mo = 0; y++; } }
  while (d < 1) { if (--mo < 0) { mo = 11; y--; } d += daysInMonth(y, mo); }
  return { y, mo, d };
}

/**
 * How many days the world has lived through since an account was registered.
 *
 * The whole extrapolation, in one line of arithmetic: real days elapsed × the
 * game-speed knob. Returns null — not zero — when there is no usable timestamp,
 * because "registered today" and "we do not know when" must not collapse into
 * the same answer; the caller stamps them differently.
 */
export function gameDaysSince(createdAtSec, nowMs, scale) {
  const createdMs = Number(createdAtSec) * 1000;
  if (!Number.isFinite(createdMs) || createdMs <= 0) return null;
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const days = ((nowMs - createdMs) / DAY_MS) * s;
  return days > 0 ? Math.floor(days) : 0;
}

/**
 * The date to latch for somebody who has never had one: today, minus 25 years.
 *
 * A 29 February decanting is walked back to the 28th rather than kept, because
 * unlike the old real-calendar version there is no reason to preserve a date the
 * world's calendar will refuse three years in four — nobody is attached to it and
 * nobody has been told it yet.
 */
export function birthDateFor(today) {
  if (!today) return null;
  const y = today.y - DECANT_AGE;
  const d = (today.mo === 1 && today.d === 29 && !isLeap(y)) ? 28 : today.d;
  return { y, mo: today.mo, d };
}

/** Whole in-world years between a birth date and today. */
export function ageOn(born, today) {
  let age = today.y - born.y;
  if (today.mo < born.mo || (today.mo === born.mo && today.d < born.d)) age -= 1;
  return age;
}

const isTodayTheDay = (born, today) => born.mo === today.mo && born.d === today.d;

/** Days from today to the next anniversary, on the world's calendar. */
export function daysUntil(born, today) {
  const thisYear = { y: today.y, mo: born.mo, d: Math.min(born.d, daysInMonth(today.y, born.mo)) };
  const gap = dayOfYear(thisYear) - dayOfYear(today);
  if (gap >= 0) return gap;
  const next = { y: today.y + 1, mo: born.mo, d: Math.min(born.d, daysInMonth(today.y + 1, born.mo)) };
  const yearLen = isLeap(today.y) ? 366 : 365;
  return (yearLen - dayOfYear(today)) + dayOfYear(next);
}

/**
 * The registration timestamp. The live player object IS the `players` row in
 * production, so this normally costs nothing; the query is for the harness and
 * for anything holding a lighter object than a login does.
 */
async function createdAtOf(player) {
  if (player?.created_at != null) return player.created_at;
  if (!player?.id) return null;
  try {
    const { rows } = await query('SELECT created_at FROM players WHERE id = $1', [player.id]);
    return rows[0]?.created_at ?? null;
  } catch {
    return null;
  }
}

/**
 * This player's birth date, latching it on first ask. See the header.
 * Returns null only when the world clock has not booted.
 */
export async function birthDateOf(player) {
  const stored = parseGameDate(await getFlag('player', BIRTH_FLAG, player));
  const basis = await getFlag('player', BASIS_FLAG, player);
  if (stored && basis) return stored;

  const { today, scale } = await gameNow();
  // No clock: hand back whatever is stored rather than latching a guess.
  if (!today) return stored || null;

  const elapsed = gameDaysSince(await createdAtOf(player), Date.now(), scale);
  const born = birthDateFor(elapsed == null ? today : addDays(today, -elapsed));
  // Date and stamp in the SAME write — a date that lands without its basis is
  // indistinguishable from a pre-re-latch row and gets rewritten on the next ask.
  await setFlags(player, {
    [BIRTH_FLAG]: fmtGameDate(born),
    [BASIS_FLAG]: elapsed == null ? 'unknown' : 'account',
  });
  return born;
}

async function cmdBirthday(args, raw, player, broadcast) {
  const { today } = await gameNow();
  if (!today) {
    return { type: 'error', message: "The registry can't reach the calendar. Try again in a moment." };
  }

  const born = await birthDateOf(player);
  if (!born) {
    return { type: 'error', message: 'The registry has no commencement date against you, which is its own kind of answer.' };
  }

  const dateStr = `${ordinal(born.d)} of ${MONTHS[born.mo]}`;
  const age = ageOn(born, today);
  const head = `<span class="text-dim">The registry has you down as commencing on the</span> `
    + `<span style="color:var(--cyan)">${dateStr}</span><span class="text-dim">, ${born.y}. `
    + `That makes you ${age}.</span>`;

  if (!isTodayTheDay(born, today)) {
    const d = daysUntil(born, today);
    return {
      type: 'output',
      message: `${head}\n<span class="text-dim">That is ${d === 1 ? 'tomorrow' : `${d} days from now`}. Nobody else is counting.</span>`,
    };
  }

  // It is the day. One pouch per GAME year, tracked in player_flags rather than
  // a column — the flag holds the year it was claimed, so the check is a
  // comparison and not a reset anybody has to remember to run.
  const claimed = await getFlag('player', CLAIM_FLAG, player);
  if (String(claimed) === String(today.y)) {
    return {
      type: 'output',
      message: `${head}\n<span style="color:var(--yellow)">Today, in fact.</span> <span class="text-dim">You have already had your pouch. There's one, and you have had it.</span>`,
    };
  }

  // once:false on purpose — you should get this year's pouch whether or not last
  // year's is still rattling around in your bag.
  await dispatchAction({
    type: 'GRANT_ITEM',
    actor: player,
    params: { item_id: GIFT, quantity: 1, once: false },
    context: { broadcast },
  });
  await setFlags(player, { [CLAIM_FLAG]: String(today.y) });

  return {
    type: 'output',
    message: `${head}\n<span style="color:var(--yellow)">Today, in fact.</span>\n\n`
      + `Somewhere a dispenser you aren't standing near clunks anyway, and a bronze pouch you didn't ask for is in your hands. `
      + `MANY HAPPY RETURNS. <span class="text-dim">Issued once annually per registered instance. Nobody signed it.</span>`,
  };
}

export const commands = { birthday: cmdBirthday };
export const _test = { parseGameDate, fmtGameDate, birthDateFor, ageOn, daysUntil, dayOfYear, daysInMonth, BIRTH_FLAG, BASIS_FLAG, CLAIM_FLAG };
