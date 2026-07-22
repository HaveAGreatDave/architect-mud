// Appliances plugin regression — plug/unplug toggling, the unplugged-broken
// examine hook, and the backward-compatible default (no flag = plugged in).
import { query } from '../../server/models/db.js';
import { insertFurniture, updateFurniture, deleteFurniture, getFurnitureById } from '../../server/engine/world.js';
import { isPluggedIn } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_appliances_regress';
  const FURN = 'furn_appliances_regress';
  const DECOR = 'furn_appliances_regress_decor';

  try {
    await insertFurniture({
      id: FURN, name: 'test dispenser', description: 'a test dispenser', object_type: 'fixture',
      zone_id: Z, power_draw_kw: 0.1, flags: JSON.stringify({ vends: 'item_soylent' }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, power_draw_kw=EXCLUDED.power_draw_kw');
    // Furniture with no power_draw_kw at all — plug/unplug must leave it alone.
    await insertFurniture({
      id: DECOR, name: 'test poster', description: 'a test poster', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({}),
    }, 'ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id');

    player.current_zone = Z;

    let f = await getFurnitureById(FURN);
    check('absent plugged_in flag defaults to plugged in', isPluggedIn(f) === true, JSON.stringify(f.flags));

    let r = await run('power off test dispenser');
    check('power off succeeds', r?.type === 'output', JSON.stringify(r));
    f = await getFurnitureById(FURN);
    check('power off sets plugged_in false', isPluggedIn(f) === false, JSON.stringify(f.flags));

    r = await run('power off test dispenser');
    check('powering off an already-unplugged machine is a no-op message', r?.type === 'message', JSON.stringify(r));

    r = await run('examine test dispenser');
    check('unplugged appliance reads as broken on examine', /unplugged/i.test(r?.message || ''), r?.message);

    r = await run('power on test dispenser');
    check('power on succeeds', r?.type === 'output', JSON.stringify(r));
    f = await getFurnitureById(FURN);
    check('power on sets plugged_in true', isPluggedIn(f) === true, JSON.stringify(f.flags));

    r = await run('power off test poster');
    check('furniture with no power_draw_kw is not a valid power target', r?.type === 'error', JSON.stringify(r));
  } finally {
    await deleteFurniture(FURN).catch(() => {});
    await deleteFurniture(DECOR).catch(() => {});
    player.current_zone = saved;
  }
}
