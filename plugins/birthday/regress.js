// Birthday — the date is an IN-WORLD one now, latched into a player flag on
// first ask rather than derived from `players.created_at`. That changes what has
// to be tested: the pure calendar maths is unit-testable directly, and the verb
// is driven by writing the birth flag rather than by moving an account's
// creation timestamp.
//
// No `players` row is needed any more, because nothing reads one.
import { query } from '../../server/models/db.js';
import { setFlags } from '../../server/engine/flags.js';
import { _test, gameToday, DECANT_AGE } from './index.js';

const { parseGameDate, fmtGameDate, birthDateFor, ageOn, daysUntil, daysInMonth } = _test;

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
  check('age has not ticked over the day before',
    ageOn(born, { y: 2076, mo: 6, d: 12 }) === DECANT_AGE - 1, `${ageOn(born, { y: 2076, mo: 6, d: 12 })}`);
  check('and is 26 a year later',
    ageOn(born, { y: 2077, mo: 6, d: 13 }) === DECANT_AGE + 1, '');

  // A 29 February decanting walks back to the 28th rather than landing on a date
  // the calendar refuses three years in four.
  const leapBorn = birthDateFor({ y: 2076, mo: 1, d: 29 });
  check('a leap-day latch lands on a date every year actually has',
    leapBorn.d <= daysInMonth(leapBorn.y, leapBorn.mo), JSON.stringify(leapBorn));

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
    await setFlags(PID, { birth_date: fmtGameDate(away), birthday_gift_year: '' });

    let r = await run('birthday');
    check('a non-birthday reports the date without granting anything',
      r?.type === 'output' && /days from now|tomorrow/.test(r.message || ''), JSON.stringify(r)?.slice(0, 160));
    check('…and states an age', /That makes you \d+/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 160));
    check('no pouch off the day', await pouches() === 0, '');

    // IS the day.
    await setFlags(PID, { birth_date: fmtGameDate({ y: today.y - 5, mo: today.mo, d: today.d }) });
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
    check("last year's claim does not block this year", await pouches() === 2, '');

    // ── The latch ────────────────────────────────────────────────────────────
    //
    // The migration behaviour, asserted rather than assumed: a player with no
    // stored birth date gets one written on first ask, and it is today minus 25.
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=ANY($2)',
      [PID, ['birth_date', 'birthday_gift_year']]).catch(() => {});
    await run('birthday');
    const { rows } = await query('SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [PID, 'birth_date']);
    const latched = parseGameDate(rows[0]?.flag_value);
    check('an unlatched player is given a birth date on first ask', !!latched, JSON.stringify(rows));
    check('…and it is twenty-five in-world years back',
      latched && ageOn(latched, today) === DECANT_AGE,
      latched ? `${ageOn(latched, today)}` : 'none');

    // Latched means LATCHED: asking again must not move it.
    const first = rows[0]?.flag_value;
    await run('birthday');
    const { rows: again } = await query('SELECT flag_value FROM player_flags WHERE player_id=$1 AND flag_key=$2', [PID, 'birth_date']);
    check('a second ask does not re-latch it', again[0]?.flag_value === first, `${first} -> ${again[0]?.flag_value}`);
  } finally {
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [PID, 'item_soylent_manyhappy']).catch(() => {});
    await query('DELETE FROM player_flags WHERE player_id=$1 AND flag_key=ANY($2)',
      [PID, ['birth_date', 'birthday_gift_year']]).catch(() => {});
  }
}
