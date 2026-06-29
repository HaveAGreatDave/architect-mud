// One-shot script: create a Shoddy Television furniture item in zone_start.
// Run once: node scripts/create-shoddy-tv.js
// After running, use `tune <channel number>` in-game to assign it a broadcast channel.
import { query } from '../server/models/db.js';

const ID = 'furniture_shoddy_tv_start';
const ZONE = 'zone_start';

const { rows: existing } = await query('SELECT id FROM furniture WHERE id=$1', [ID]);
if (existing.length) {
  console.log('Already exists:', ID);
  process.exit(0);
}

await query(
  `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [
    ID,
    ZONE,
    'Shoddy Television',
    'A battered flatscreen bolted to the wall with mismatched screws. The casing is cracked and one corner is held together with duct tape, but the picture still comes through.',
    'furniture',
    JSON.stringify({ tv: true, broadcast_device_type: 'tv', broadcast_receiver: true }),
  ]
);

console.log(`Created: ${ID} in ${ZONE}`);
console.log('In-game, stand in zone_start and run: tune <channel number>');
process.exit(0);
