/**
 * fuelstation regress — the board, and the one rule it exists to keep.
 *
 * The load-bearing assertion here is NOT that the sign renders. It is that the sign renders the
 * number the charging system will actually take: if trucking retunes a tank and the board still
 * says 380, this plugin has silently become a second copy of a price, which is the exact failure
 * the gather hook was built to prevent. So the diesel case reads FUEL_FULL out of trucking and
 * demands the board agree with it.
 */
import { hooks as fuelHooks, _test } from './index.js';
import { FUEL_FULL } from '../trucking/state.js';
import { gatherHook, gatherHookSync } from '../../server/engine/plugins.js';

export default async ({ check }) => {
  const FORECOURT = 'zone_district_923_907';

  // The pump's own price, off the authored furniture value rather than a constant here.
  check('a pump prices per unit off its own flag',
    _test.pumpPrice({ flags: { fuel_source: 3 } }) === 3
    && _test.pumpPrice({ flags: { fuel_source: true } }) === 0
    && _test.pumpPrice({ flags: {} }) === 0);

  // ⚠ THE ANTI-DUPLICATION TEST. Reading FUEL_FULL here rather than writing 380 is deliberate: a
  // hardcoded 380 in this file would pass forever while the board drifted away from the till.
  const diesel = await fuelHooks['fuel.prices']?.({ id: FORECOURT });
  const rows = [].concat(diesel || []);
  const board = await fuelHooks['furniture.describe']({
    zone_id: FORECOURT, flags: { fuel_price_sign: true },
  });
  check('the board prints diesel at the price trucking charges',
    typeof board === 'string' && board.includes(`${FUEL_FULL}₵/tank`));
  check('the board prints the forecourt gasoline row',
    typeof board === 'string' && /GASOLINE/.test(board));

  // A board in a room where nothing is sold is DARK, not broken. This is the state every other
  // copy of this furniture in the world would be in, so it is the case worth pinning.
  const dark = await fuelHooks['furniture.describe']({
    zone_id: 'zone_nowhere_at_all', flags: { fuel_price_sign: true },
  });
  check('a board with nothing on sale reads dark rather than erroring',
    typeof dark === 'string' && /dark/i.test(dark));

  // The pump advertises the verbs that work on it, and both are verbs a player could type.
  const pump = await fuelHooks['furniture.describe']({
    zone_id: FORECOURT, flags: { fuel_source: 3 },
  });
  check('a pump offers fill and fuel as real commands',
    typeof pump === 'string' && pump.includes('data-cmd="fill"') && pump.includes('data-cmd="fuel"'));

  // Furniture that is neither is not this plugin's business — returning undefined is how a
  // describe hook declines, and swallowing every piece of furniture in the game would be the
  // loudest possible bug.
  check('unrelated furniture is declined',
    (await fuelHooks['furniture.describe']({ zone_id: FORECOURT, flags: { toilet: true } })) === undefined);

  // The gasoline row is absent where there are no pumps, so a board elsewhere cannot inherit one.
  check('no pumps, no gasoline row',
    (await fuelHooks['fuel.prices']({ id: 'zone_nowhere_at_all' })) == null);

  // The forecourt's NAME comes off the tile, not out of this file. A plugin is THOMAS and
  // "Flash Point" is Architect, so a second forecourt has to get its own header for free.
  check('the board header is the building name off the zone, not a constant',
    typeof board === 'string' && /FLASH POINT FUEL/.test(board));

  // ── ⚠ `fuel.prices` IS A SYNC HOOK, AND THE PYLON YOU SEE FROM THE ROAD DEPENDS ON IT ────────
  // The 3-D price board (drawPriceBoard in the windshield) is fed by `brd` on the map cell, which
  // deriveSurfaceCell gathers with `gatherHookSync` — no await, because that function runs for
  // every cell of a ~73×73 window. A contributor that quietly became async would still satisfy
  // every check above (they all await) and would silently blank the pylon, which is a failure
  // nobody would trace back to this file. So: assert the shape the sync path needs.
  for (const [name, fn] of Object.entries(fuelHooks)) {
    if (name !== 'fuel.prices') continue;
    const raw = fn({ id: FORECOURT });
    check('fuel.prices answers synchronously — the 3-D pylon reads it without an await',
      typeof raw?.then !== 'function' && Array.isArray([].concat(raw || [])));
  }
  const sync = gatherHookSync('fuel.prices', { id: FORECOURT }).filter(r => r && r.grade);
  const asy = (await gatherHook('fuel.prices', { id: FORECOURT })).filter(r => r && r.grade);
  const key = (l) => l.map(r => `${r.grade}:${r.price}:${r.unit}`).sort().join('|');
  check('the pylon and the examined board are gathering the same rows',
    sync.length > 0 && key(sync) === key(asy));
  check('the sync gather carries the same diesel price as the till',
    sync.some(r => r.grade === 'DIESEL' && r.price === FUEL_FULL));

  // ⚠ THE PYLON'S NUMBER IS A DERIVATION OF THE TILL'S, NOT A SECOND ENTRY OF IT. A board by the
  // road quotes a retail rate per pump-unit — 3.80 — while the till takes 380 for the whole tank.
  // Those must stay one number: read `each` back against FUEL_FULL rather than writing 3.8 here, or
  // this passes forever while the sign drifts, which is the exact failure the hook exists to stop.
  const dz = sync.find(r => r.grade === 'DIESEL');
  check('the pylon rate is the tank price over its own hundred, not a typed-in number',
    dz && dz.each === FUEL_FULL / 100);
  // A contributor that quotes by the unit already needs no conversion, and must not be given one.
  check('a per-unit grade has no `each` to convert',
    sync.filter(r => r.grade === 'GASOLINE').every(r => r.each === undefined));
  void rows;
};
