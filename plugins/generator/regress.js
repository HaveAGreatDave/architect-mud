// Generator plugin regression — the `plug`/`connect` fallback to a room
// appliance (vending machine, fridge) when no generator is deployed, and
// confirms a real deployed generator still takes priority over that fallback.
import { query } from '../../server/models/db.js';
import { insertFurniture, deleteFurniture, getFurnitureById } from '../../server/engine/world.js';
import { isPluggedIn } from '../appliances/index.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_generator_regress';
  const APPLIANCE = 'furn_generator_regress_appliance';

  try {
    await insertFurniture({
      id: APPLIANCE, name: 'test toaster', description: 'a test toaster', object_type: 'fixture',
      zone_id: Z, power_draw_kw: 0.1, flags: JSON.stringify({ plugged_in: false }),
    }, 'ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, power_draw_kw=EXCLUDED.power_draw_kw, flags=EXCLUDED.flags');
    player.current_zone = Z;

    let r = await run('plug test toaster');
    check('plug falls through to a room appliance when no generator is deployed', r?.type === 'output', JSON.stringify(r));
    let f = await getFurnitureById(APPLIANCE);
    check('the fallback actually plugs the appliance in', isPluggedIn(f) === true, JSON.stringify(f.flags));

    r = await run('plug nothing_here_at_all');
    check('neither a generator nor a matching appliance gives a combined, clean error', r?.type === 'error' && /no generator deployed/i.test(r.message || ''), JSON.stringify(r));
  } finally {
    await deleteFurniture(APPLIANCE).catch(() => {});
    player.current_zone = saved;
  }
}
