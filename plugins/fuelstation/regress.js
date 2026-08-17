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

  void rows;
};
