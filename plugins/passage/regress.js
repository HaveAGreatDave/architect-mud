// Passage regression: a grate takes you down, the ladder brings you back,
// and `use` on anything else falls through.
import { insertFurniture, deleteFurniture, getZone } from '../../server/engine/world.js';
import { passageHere, specializedActions } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const top = 'zone_district_925_917', bottom = 'zone_under_925_917';
  if (!getZone(top) || !getZone(bottom)) { check('passage: seam zones loaded', false, 'missing'); return; }
  const saved = player.current_zone;
  const ids = ['furn_passage_regress_grate', 'furn_passage_regress_ladder'];
  const up = 'ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, flags=EXCLUDED.flags, name=EXCLUDED.name';
  await insertFurniture({ id: ids[0], zone_id: top, name: 'test drain grate', description: 't', object_type: 'decoration', flags: JSON.stringify({ passage: 'down' }) }, up);
  await insertFurniture({ id: ids[1], zone_id: bottom, name: 'test iron ladder', description: 't', object_type: 'decoration', flags: JSON.stringify({ passage: 'up' }) }, up);
  try {
    const use = specializedActions[0].handler;
    // The second move lands inside the walking pace and gets queued; clear it.
    const calm = () => { if (player._moveTimer) clearTimeout(player._moveTimer); player._moveTimer = null; player._moveQueue = []; player._lastMoveAt = 0; player._lastStepAt = 0; player._moveQueueZone = null; };
    check('passage: a word matches the piece', !!passageHere(top, 'grate'));
    check('passage: bare use matches nothing', passageHere(top, '') === null);
    player.current_zone = top;
    check('passage: use on something else falls through', (await use(['toaster'], 'use toaster', player, () => {})) === undefined);
    await run('use grate');
    check('passage: use grate goes down into the Under', player.current_zone === bottom, player.current_zone);
    calm();
    const r = await use(['ladder'], 'use ladder', player, () => {});
    check('passage: use ladder comes back up', player.current_zone === top, player.current_zone + ' ' + JSON.stringify(r).slice(0, 300));
  } finally {
    if (player._moveTimer) clearTimeout(player._moveTimer);
    player._moveTimer = null; player._moveQueue = [];
    for (const id of ids) await deleteFurniture(id);
    player.current_zone = saved;
  }
}
