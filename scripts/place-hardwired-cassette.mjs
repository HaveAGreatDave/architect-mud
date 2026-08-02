// Converging one-shot: leave the Hard Wired 4 cassette lying on the floor of
// Solenne Residence 30-B. Ground items are runtime rows (player_inventory owned
// by `_ground_<zone>`), so the content pipeline can't carry this — but the drop
// is idempotent: if a copy is already on that floor, or somebody has since
// picked it up and this runs again, we only ever add the one tape back if the
// floor is empty of it.
import { query } from '../server/models/db.js';
import { randomUUID } from 'crypto';

const ZONE = 'zone_solenne_apt_b';
const ITEM = 'item_cassette_hard_wired_4_the_ductwork';
const OWNER = `_ground_${ZONE}`;

const { rows: item } = await query('SELECT id FROM items WHERE id=$1', [ITEM]);
if (!item.length) {
  console.error(`[hardwired] ${ITEM} is not in the DB yet — run content:import first.`);
  process.exit(1);
}

const { rows: existing } = await query(
  'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2', [OWNER, ITEM]);
if (existing.length) {
  console.log('[hardwired] already on the floor of 30-B — nothing to do.');
} else {
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped) VALUES ($1,$2,$3,1,0)',
    [randomUUID(), OWNER, ITEM]);
  console.log('[hardwired] dropped in 30-B.');
}
process.exit(0);
