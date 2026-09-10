// Cleaning plugin regression suite — run by tests/regress.js (never loaded in production).
//
// The load-bearing thing here isn't the verb, it's the FILTH SUBSTRATE underneath
// it: cleanZone's partial-budget arithmetic decides whether a bare-handed scrub
// reads as progress, and isDeepCleanDay decides whether an owned room keeps its
// mess at all. Both are pure and RAM-only, so they can be driven directly.
import { _test } from './index.js';
import {
  cleanZone, filthCount, filthTypes, gameDayIndex, isDeepCleanDay,
  isOwnedZone, registerOwnedZoneProvider, STAIN_KEEP_DAYS,
} from '../../server/engine/zone-filth.js';
import { world } from '../../server/engine/world.js';

export default async function regress({ run, check }) {
  let r = await run('clean');
  check('clean verb routed', r?.type !== undefined, JSON.stringify(r));
  r = await run('mop');
  check('mop is the same verb', r?.type !== undefined, JSON.stringify(r));

  // A spotless floor answers, rather than erroring or falling through to
  // "Unknown command" — the fake player stands in a room with no stains.
  check('cleaning a clean room says so, without erroring',
    r?.type === 'output' && /nothing here worth cleaning/i.test(r?.message || ''), r?.message);

  // --- cleanZone arithmetic (a synthetic zone; never touches a real room) ---
  const zid = '__regress_filth__';
  world.zones.set(zid, { id: zid, name: 'test', stains: { blood: 3, urine: 1 } });

  check('filthCount totals every stain type', filthCount(zid) === 4, String(filthCount(zid)));
  check('filthTypes lists the types present', filthTypes(zid).sort().join(',') === 'blood,urine');

  // One mark, bare-handed: takes from the SMALLEST pile first so partial work
  // visibly shortens the list instead of nibbling the big mess forever.
  let removed = cleanZone(zid, 1);
  check('a one-mark clean removes exactly one', removed === 1, String(removed));
  check('a one-mark clean clears the smallest pile first',
    filthTypes(zid).join(',') === 'blood', filthTypes(zid).join(','));
  check('the emptied type is deleted, not left at zero',
    world.zones.get(zid).stains.urine === undefined);

  // A tool clears the room in one go.
  removed = cleanZone(zid, Infinity);
  check('an unbounded clean clears the floor', removed === 3 && filthCount(zid) === 0, String(removed));
  check('cleaning an already-clean floor removes nothing', cleanZone(zid, Infinity) === 0);

  // Cleaning a zone that doesn't exist must be a no-op, not a throw — the verb
  // can be reached from a transient/void room with no world.zones entry.
  check('cleaning an unknown zone is a safe no-op', cleanZone('__no_such_zone__', 5) === 0);
  check('filthCount on an unknown zone is 0', filthCount('__no_such_zone__') === 0);

  world.zones.delete(zid);

  // --- the 7-day cadence ---
  // Stateless: derived from the game date, so a restart can't reset the cycle.
  const d0 = gameDayIndex('2026-07-27');
  check('gameDayIndex is a number', typeof d0 === 'number' && Number.isFinite(d0), String(d0));
  check('gameDayIndex is monotonic across a day',
    gameDayIndex('2026-07-28') === d0 + 1);
  check('a malformed date yields null', gameDayIndex('not-a-date') === null);
  // Exactly one day in every STAIN_KEEP_DAYS is a deep-clean day — not zero (owned
  // rooms would foul forever) and not all of them (the feature wouldn't exist).
  let deepDays = 0;
  for (let i = 0; i < STAIN_KEEP_DAYS; i++) {
    const day = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
    if (isDeepCleanDay(day)) deepDays++;
  }
  check(`exactly one deep-clean day per ${STAIN_KEEP_DAYS}`, deepDays === 1, String(deepDays));
  // No game date yet (pre-boot) must fail SAFE — sweep everything, i.e. the old
  // behaviour, rather than silently letting the whole world foul up.
  check('an unknown date deep-cleans (fails safe)', isDeepCleanDay(null) === true);

  // --- ownership providers ---
  check("an unowned zone isn't owned", isOwnedZone('__nobodys_room__') === false);
  check("a null zone id isn't owned", isOwnedZone(null) === false);
  registerOwnedZoneProvider((z) => z === '__owned_by_test__');
  check('a registered provider makes a zone owned', isOwnedZone('__owned_by_test__') === true);
  // A provider that throws must not take the nightly sweep down with it.
  registerOwnedZoneProvider(() => { throw new Error('bad provider'); });
  check('a throwing provider is contained', isOwnedZone('__nobodys_room__') === false);
  check("a throwing provider doesn't break a good one", isOwnedZone('__owned_by_test__') === true);

  // Prose selection is worst-first, so mopping blood never reads as sweeping dust.
  check('the worst stain picks the line',
    _test.cleanLine(['dirt', 'feces']) === _test.CLEAN_LINES.feces);
  check('an unlisted stain still gets a line',
    typeof _test.cleanLine(['glitter']) === 'string' && _test.cleanLine(['glitter']).length > 0);
}
