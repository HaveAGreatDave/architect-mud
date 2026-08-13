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
// ── LATCHED, NOT DERIVED. Read this before "simplifying" it. ─────────────────
//
// The old implementation stored NOTHING and recomputed from `players.created_at`
// every time, which was genuinely better and is no longer possible. `created_at`
// is a real-world unix timestamp, and the world clock advances at a configurable
// scale that has changed and will change again — so there is no function from a
// real timestamp back to "what the in-world date was when this account was
// made". That information was never recorded and cannot be recovered.
//
// So the birth date is LATCHED into a player flag the first time anybody asks
// for it, and read from the flag forever after. The reference for that first
// latch is the in-world date TODAY, minus 25 years.
//
// The consequence, stated plainly because it is visible in play: every character
// who existed before this change shares a commencement date with everybody else
// who first asked on the same in-world day, and their birthday is the day they
// asked. In a city that grows its people in tanks, a shared decanting date reads
// as a batch rather than as a bug — but it IS a consequence of the migration and
// not an authored fact, and if it ever needs scattering, scatter it at the latch
// (birthDateFor) rather than anywhere downstream.
//
// HIDDEN BY DEFAULT, deliberately. It is on no sheet, in no panel, and in no
// examine. `birthday` is the only thing that will tell you, which is what makes
// it worth typing — and it means anything built on top of this later (a card, an
// NPC who remembers, a discount) gets to be the one that reveals it.
import { query } from '../../server/models/db.js';
import { getFlag, setFlags } from '../../server/engine/flags.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getGameDateTime } from '../../server/engine/environment.js';

const GIFT = 'item_soylent_manyhappy';
const CLAIM_FLAG = 'birthday_gift_year';   // holds the GAME year last claimed
const BIRTH_FLAG = 'birth_date';           // 'YYYY-MM-DD' on the game calendar

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
 * Today, on the world's own calendar.
 *
 * Two sources, in order. The live clock (`environment.js` module state) is the
 * production path and costs nothing. The `world_clock` row is the fallback for
 * any process that has not run `initEnvironment` — the regress harness boots the
 * world and the plugins but not the environment, and a verb that refused because
 * a module-level cache was cold would be untestable AND wrong: the date exists,
 * it is simply in the database rather than in memory.
 *
 * That fallback matters beyond tests, because this function LATCHES a permanent
 * value. Refusing on a cold cache would be survivable; guessing on one would
 * write somebody a wrong birth date forever.
 */
export async function gameToday() {
  try {
    const live = parseGameDate(getGameDateTime()?.date);
    if (live) return live;
  } catch { /* environment not initialised — fall through to the row */ }

  try {
    const { rows } = await query('SELECT game_date FROM world_clock WHERE id = 1');
    const raw = rows[0]?.game_date;
    // The column is a DATE, so the driver may hand back a Date object. Format it
    // from its UTC parts rather than through toISOString-on-local, which is the
    // usual way a calendar loses a day.
    if (raw instanceof Date) {
      return { y: raw.getUTCFullYear(), mo: raw.getUTCMonth(), d: raw.getUTCDate() };
    }
    return parseGameDate(raw);
  } catch {
    return null;
  }
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
 * This player's birth date, latching it on first ask. See the header.
 * Returns null only when the world clock has not booted.
 */
export async function birthDateOf(player) {
  const stored = parseGameDate(await getFlag('player', BIRTH_FLAG, player));
  if (stored) return stored;

  const today = await gameToday();
  if (!today) return null;
  const born = birthDateFor(today);
  await setFlags(player, { [BIRTH_FLAG]: fmtGameDate(born) });
  return born;
}

async function cmdBirthday(args, raw, player, broadcast) {
  const today = await gameToday();
  if (!today) {
    return { type: 'error', message: 'The registry cannot reach the calendar. Try again in a moment.' };
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
      message: `${head}\n<span style="color:var(--yellow)">Today, in fact.</span> <span class="text-dim">You have already had your pouch. There is one, and you have had it.</span>`,
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
      + `Somewhere a dispenser you are not standing near clunks anyway, and a bronze pouch you did not ask for is in your hands. `
      + `MANY HAPPY RETURNS. <span class="text-dim">Issued once annually per registered instance. Nobody signed it.</span>`,
  };
}

export const commands = { birthday: cmdBirthday };
export const _test = { parseGameDate, fmtGameDate, birthDateFor, ageOn, daysUntil, dayOfYear, daysInMonth, BIRTH_FLAG, CLAIM_FLAG };
