// Videostore regression suite — run by tests/regress.js (never loaded in production).
//
// The load-bearing thing here is NOT the verb, it is `feeFor`: the entire late-fee
// system is that one pure function over two integers, because nothing ticks. If it
// is wrong, a debt is wrong forever and no scheduled job will ever correct it. So
// it is driven directly, at every boundary, including the two that only occur once
// per rental (the due day itself, and the write-off cliff).
//
// The verbs are checked for ROUTING and for the refusal path a player hits first —
// standing nowhere near a rental wall — because a borrow that silently succeeded
// off a wall would hand out free tapes.
import { _test, LOAN_DAYS, RENTAL_FEE, LATE_FEE_PER_DAY, REPLACEMENT_FEE, WRITE_OFF_DAYS } from './index.js';
import { gameDayIndex } from '../../server/engine/zone-filth.js';

export default async function regress({ run, check }) {
  const { feeFor, shelfOf, wallHere } = _test;

  // --- routing + the no-wall refusal ---------------------------------------
  // The fake player is not standing at a rental wall, so every verb must answer
  // with that and nothing else. A borrow that fell through to a success here
  // would be a free tape.
  for (const verb of ['rentals', 'borrow sister', 'returntape', 'settle']) {
    const r = await run(verb);
    check(`${verb.split(' ')[0]}: routed and refused off a wall`,
      r?.type === 'error' && /no rental wall here/i.test(r?.message || ''),
      JSON.stringify(r));
  }

  // --- feeFor: the whole clock ---------------------------------------------
  const due = gameDayIndex('2026-08-07');
  const row = { due_day: due };

  check('nothing owed before the due day', feeFor(row, due - 3).fee === 0);
  // The boundary that actually bites: the due day itself is free, the day after
  // is not. An off-by-one here charges every borrower a day they did not use.
  check('the due day itself is free', feeFor(row, due).fee === 0 && feeFor(row, due).over === 0);
  check('one day over is exactly one day of fee',
    feeFor(row, due + 1).fee === LATE_FEE_PER_DAY && feeFor(row, due + 1).over === 1,
    JSON.stringify(feeFor(row, due + 1)));
  check('the fee is linear in days overdue',
    feeFor(row, due + 4).fee === LATE_FEE_PER_DAY * 4);

  // The write-off cliff. Below it, linear; at and above it, the accrual STOPS and
  // the replacement price is added instead — so a tape somebody never returns has
  // a finite, knowable price rather than an unbounded one.
  const justUnder = feeFor(row, due + WRITE_OFF_DAYS - 1);
  const atCliff = feeFor(row, due + WRITE_OFF_DAYS);
  const wayOver = feeFor(row, due + WRITE_OFF_DAYS + 500);
  check('just under the cliff is still linear and not written off',
    !justUnder.writtenOff && justUnder.fee === LATE_FEE_PER_DAY * (WRITE_OFF_DAYS - 1),
    JSON.stringify(justUnder));
  check('at the cliff it writes off',
    atCliff.writtenOff && atCliff.fee === LATE_FEE_PER_DAY * WRITE_OFF_DAYS + REPLACEMENT_FEE,
    JSON.stringify(atCliff));
  check('past the cliff the fee STOPS growing — a lost tape has a finite price',
    wayOver.fee === atCliff.fee, `${wayOver.fee} vs ${atCliff.fee}`);

  // A row with a junk due_day must not produce NaN — that would write NaN into a
  // debt column and poison the wall for that player permanently.
  const junk = feeFor({ due_day: null }, due);
  check('a missing due_day yields a number, never NaN', Number.isFinite(junk.fee), String(junk.fee));

  // --- the shelf is authored, never inferred -------------------------------
  check('a wall with no shelf list stocks nothing', shelfOf({ flags: {} }).length === 0);
  check('a non-array shelf is rejected rather than coerced',
    shelfOf({ flags: { tape_shelf: 'item_betatape_form_nine' } }).length === 0);
  check('a shelf list passes through, strings only',
    shelfOf({ flags: { tape_shelf: ['item_a', 7, null, 'item_b'] } }).join(',') === 'item_a,item_b');
  check('wallHere on a zone with no furniture is null, not a throw',
    wallHere('__no_such_zone__') == null);

  // --- the authored wall in the world --------------------------------------
  // Mint Condition's wall is the only one that ships. If its shelf ever empties or
  // its flag is renamed, the whole feature is unreachable and nothing else notices.
  const { getZoneFurniture } = await import('../../server/engine/world.js');
  const wall = getZoneFurniture('zone_mintcond_back').find(f => f.flags?.tape_rental);
  check('the Mint Condition tape wall exists and is flagged', !!wall, 'zone_mintcond_back');
  if (wall) {
    const shelf = shelfOf(wall);
    check('its shelf is stocked', shelf.length >= 3, String(shelf.length));
    // Every title on a shelf must be a real item carrying a broadcast, or `borrow`
    // hands over a row that no deck can play.
    const { getItem } = await import('../../server/engine/items-cache.js');
    const bad = shelf.filter((id) => {
      const it = getItem(id);
      return !it || !(it.tags?.media_cassette) || !(it.tags?.broadcast_id);
    });
    check('every shelved title is a real playable cassette', bad.length === 0, bad.join(','));
  }

  // --- tunables stay sane relative to each other ---------------------------
  // Being late for a few days must cost more than the loan did, or the due date is
  // decoration. This is the one balance property worth welding down.
  check('a few days late costs more than the rental itself',
    LATE_FEE_PER_DAY * 3 > RENTAL_FEE, `${LATE_FEE_PER_DAY * 3} vs ${RENTAL_FEE}`);
  check('the loan is a whole number of days', Number.isInteger(LOAN_DAYS) && LOAN_DAYS > 0);
}
