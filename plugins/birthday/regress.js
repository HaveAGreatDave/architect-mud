// Birthday — the date is an IN-WORLD one, latched into a player flag on first
// ask, and derived at that moment from the account's registration date pushed
// through the game clock's speed. That splits what has to be tested in three:
// the pure calendar maths (directly), the verb (by writing the birth flag), and
// the LATCH itself (by putting a known `created_at` on the player and reading
// back what got written).
//
// The re-latch is the case worth guarding. A stored date with no basis stamp is
// a pre-extrapolation row and must be rewritten exactly once; a stored date WITH
// one must never move again.
import { query } from '../../server/models/db.js';
import { setFlags } from '../../server/engine/flags.js';
import { _test, gameNow, gameToday, DECANT_AGE, addDays, gameDaysSince, birthDateFor } from './index.js';

const { parseGameDate, fmtGameDate, ageOn, daysUntil, daysInMonth, BASIS_FLAG } = _test;

export default async function ({ run, check, getPlayer }) {
  const player = getPlayer();
  const PID = player.id;
  const pouches = async () => (await query(
    'SELECT COALESCE(SUM(quantity),0)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2',
    [PID, 'item_soylent_manyhappy'],
  )).rows[0]?.n ?? 0;

  // ── Calendar maths, with no world and no database ──────────────────────────
  //
  // Parsed by hand on purpose: `new Date('2076-01-01')` drags the host timezone
  // into a calendar that has nothing to do with it, and a world date must not
  // shift because the server moved.
  check('a game date parses to its own fields',
    JSON.stringify(parseGameDate('2076-07-13')) === JSON.stringify({ y: 2076, mo: 6, d: 13 }),
    JSON.stringify(parseGameDate('2076-07-13')));
  check('…and round-trips', fmtGameDate(parseGameDate('2076-07-13')) === '2076-07-13', '');
  check('a malformed date is null rather than 1970', parseGameDate('nonsense') === null, '');

  // The latch: today minus twenty-five years.
  const born = birthDateFor({ y: 2076, mo: 6, d: 13 });
  check('a fresh birth date is 25 years back',
    born.y === 2076 - DECANT_AGE && born.mo === 6 && born.d === 13, JSON.stringify(born));
  check('…and that reads as an age of 25',
    ageOn(born, { y: 2076, mo: 6, d: 13 }) === DECANT_AGE, `${ageOn(born, { y: 2076, mo: 6, d: 13 })}`);
  check("age hasn't ticked over the day before",
    ageOn(born, { y: 2076, mo: 6, d: 12 }) === DECANT_AGE - 1, `${ageOn(born, { y: 2076, mo: 6, d: 12 })}`);
  check('and is 26 a year later',
    ageOn(born, { y: 2077, mo: 6, d: 13 }) === DECANT_AGE + 1, '');

  // A 29 February decanting walks back to the 28th rather than landing on a date
  // the calendar refuses three years in four.
  const leapBorn = birthDateFor({ y: 2076, mo: 1, d: 29 });
  check('a leap-day latch lands on a date every year actually has',
    leapBorn.d <= daysInMonth(leapBorn.y, leapBorn.mo), JSON.stringify(leapBorn));

  // ── Walking the calendar ────────────────────────────────────────────────────
  check('a day back from the first of a month lands on the last of the previous one',
    JSON.stringify(addDays({ y: 2076, mo: 6, d: 1 }, -1)) === JSON.stringify({ y: 2076, mo: 5, d: 30 }),
    JSON.stringify(addDays({ y: 2076, mo: 6, d: 1 }, -1)));
  check('a day back from new year crosses the year',
    JSON.stringify(addDays({ y: 2076, mo: 0, d: 1 }, -1)) === JSON.stringify({ y: 2075, mo: 11, d: 31 }), '');
  check('walking back and forward again is the same date',
    fmtGameDate(addDays(addDays({ y: 2076, mo: 10, d: 6 }, -437), 437)) === '2076-11-06', '');
  check('February gains a day in a leap year',
    fmtGameDate(addDays({ y: 2076, mo: 1, d: 28 }, 1)) === '2076-02-29', '');

  // ── The extrapolation: real days × the game-speed knob ─────────────────────
  //
  // The whole reason the birthday is not simply "today". At 3×, an account
  // registered a real fortnight ago has lived through six in-world weeks.
  const now = 1_800_000_000_000;
  check('a fortnight of real time is 42 world days at 3×',
    gameDaysSince(now / 1000 - 14 * 86400, now, 3) === 42,
    `${gameDaysSince(now / 1000 - 14 * 86400, now, 3)}`);
  check('…and 14 at a 1× clock',
    gameDaysSince(now / 1000 - 14 * 86400, now, 1) === 14, '');
  check('an account registered this second has lived through no world days',
    gameDaysSince(now / 1000, now, 3) === 0, '');
  // null, not zero: "registered today" and "we do not know" get stamped differently.
  check('a missing timestamp is null rather than zero',
    gameDaysSince(null, now, 3) === null && gameDaysSince(0, now, 3) === null, '');
  check("a nonsense scale doesn't throw the date into the void",
    gameDaysSince(now / 1000 - 86400, now, 0) === 1, `${gameDaysSince(now / 1000 - 86400, now, 0)}`);

  // Counting forward.
  check('the day itself is zero days away',
    daysUntil({ y: 2051, mo: 6, d: 13 }, { y: 2076, mo: 6, d: 13 }) === 0, '');
  check('tomorrow is one',
    daysUntil({ y: 2051, mo: 6, d: 14 }, { y: 2076, mo: 6, d: 13 }) === 1, '');
  check('a date already past this year wraps to next year',
    daysUntil({ y: 2051, mo: 6, d: 12 }, { y: 2076, mo: 6, d: 13 }) > 300,
    `${daysUntil({ y: 2051, mo: 6, d: 12 }, { y: 2076, mo: 6, d: 13 })}`);
  check('the wrap is never negative and never a year or more',
    [[0, 1], [11, 31], [1, 28], [5, 30]].every(([mo, d]) => {
      const n = daysUntil({ y: 2051, mo, d }, { y: 2076, mo: 6, d: 13 });
      return n >= 0 && n < 366;
    }), '');

  // ── The verb, driven off the flag ──────────────────────────────────────────
  const today = await gameToday();
  check('the world clock has a date to work from', !!today, JSON.stringify(today));
  if (!today) return;

  try {
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']).catch(() => {});

    // NOT the day: six months out, so the answer can never accidentally be today.
    const away = { y: today.y - 30, mo: (today.mo + 6) % 12, d: 14 };
    // Stamped, because an unstamped date is a pre-extrapolation row and the verb
    // would (correctly) rewrite it out from under the test.
    await setFlags(PID, { birth_date: fmtGameDate(away), [BASIS_FLAG]: 'account', birthday_gift_year: '' });

    let r = await run('birthday');
    check('a non-birthday reports the date without granting anything',
      r?.type === 'output' && /days from now|tomorrow/.test(r.message || ''), JSON.stringify(r)?.slice(0, 160));
    check('…and states an age', /That makes you \d+/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 160));
    check('no pouch off the day', await pouches() === 0, '');

    // IS the day.
    await setFlags(PID, { birth_date: fmtGameDate({ y: today.y - 5, mo: today.mo, d: today.d }), [BASIS_FLAG]: 'account' });
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=$2', [PID, 'birthday_gift_year']).catch(() => {});

    r = await run('birthday');
    check('on the day it says so', r?.type === 'output' && /Today, in fact/.test(r.message || ''), JSON.stringify(r)?.slice(0, 200));
    check('…and the age is right', /That makes you 5\b/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 200));
    check('the pouch is granted on the day', await pouches() === 1, '');

    // ONE per GAME year — the reason the flag stores a year and not a boolean.
    r = await run('birthday');
    check('a second ask the same year is refused politely',
      /already had your pouch/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 200));
    check('and grants no second pouch', await pouches() === 1, '');

    // A claim stamped for LAST game year must not block this one.
    await setFlags(PID, { birthday_gift_year: String(today.y - 1) });
    await run('birthday');
    check("last year's claim doesn't block this year", await pouches() === 2, '');

    // ── The latch ────────────────────────────────────────────────────────────
    //
    // Not "today minus 25" — the account's own age, run through the clock. A
    // player registered a real fortnight ago was decanted 42 world-days before
    // today at 3×, so their birthday is emphatically NOT the day they asked.
    const { scale } = await gameNow();
    const savedCreated = player.created_at;
    const clear = () => query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=ANY($2)',
      [PID, ['birth_date', BASIS_FLAG, 'birthday_gift_year']]).catch(() => {});

    player.created_at = Math.floor(Date.now() / 1000) - 14 * 86400;
    const expected = birthDateFor(addDays(today, -gameDaysSince(player.created_at, Date.now(), scale)));
    await clear();
    await run('birthday');
    const stamped = async (key) => (await query(
      'SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [PID, key])).rows[0]?.flag_value;

    let latched = parseGameDate(await stamped('birth_date'));
    check('an unlatched player is given a birth date on first ask', !!latched, String(await stamped('birth_date')));
    check('…extrapolated from the account rather than from today',
      latched && fmtGameDate(latched) === fmtGameDate(expected),
      `${latched && fmtGameDate(latched)} vs ${fmtGameDate(expected)}`);
    check("…which at 3× isn't today", !latched || scale <= 1 || fmtGameDate(latched) !== fmtGameDate({ ...today, y: today.y - DECANT_AGE }),
      `scale ${scale}`);
    check('…and still reads as twenty-five, a fortnight being no age at all',
      latched && ageOn(latched, today) === DECANT_AGE, latched ? `${ageOn(latched, today)}` : 'none');
    check('…and records what wrote it', await stamped(BASIS_FLAG) === 'account', String(await stamped(BASIS_FLAG)));

    // Latched means LATCHED: asking again must not move it.
    const first = await stamped('birth_date');
    await run('birthday');
    check("a second ask doesn't re-latch it", await stamped('birth_date') === first,
      `${first} -> ${await stamped('birth_date')}`);

    // THE ONE-TIME RE-LATCH. A stored date with no basis against it is a row from
    // before this rule existed — every one of those said "today", which is the bug
    // this replaced. It is rewritten once and stamped, and then it is left alone.
    await clear();
    await setFlags(PID, { birth_date: fmtGameDate({ ...today, y: today.y - DECANT_AGE }) });
    await run('birthday');
    latched = parseGameDate(await stamped('birth_date'));
    check('an unstamped date left by the old rule is re-derived',
      latched && fmtGameDate(latched) === fmtGameDate(expected),
      `${latched && fmtGameDate(latched)} vs ${fmtGameDate(expected)}`);
    check('…and stamped so it never moves again', await stamped(BASIS_FLAG) === 'account', '');

    // An account with no readable timestamp falls back to today minus 25 — and is
    // stamped anyway, so it does not recompute on every single ask forever.
    await clear();
    player.created_at = null;
    await run('birthday');
    latched = parseGameDate(await stamped('birth_date'));
    check('an unreadable registration date falls back to twenty-five years flat',
      latched && ageOn(latched, today) === DECANT_AGE && latched.mo === today.mo && latched.d === today.d,
      JSON.stringify(latched));
    check('…and says so rather than claiming the account for it',
      await stamped(BASIS_FLAG) === 'unknown', String(await stamped(BASIS_FLAG)));

    // The shared fake player outlives this suite. Put it back as it was found.
    if (savedCreated === undefined) delete player.created_at; else player.created_at = savedCreated;
  } finally {
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']).catch(() => {});
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=ANY($2)',
      [PID, ['birth_date', BASIS_FLAG, 'birthday_gift_year']]).catch(() => {});
  }
}
