// One-shot script: place a Chrome Flatscreen television — a broadcast RECEIVER that
// wears the new 'flatscreen' chassis skin (brushed-chrome bezel, no CRT scanlines).
// Idempotent. Run once: node scripts/add-flatscreen-tv.js
// After running, stand in the zone and `tune <channel number>` to pick a channel.
import { query } from '../server/models/db.js';

const ID = 'furniture_flatscreen_tv_start';
const ZONE = process.argv[2] || 'zone_start';

await query(
  `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
   VALUES ($1,$2,$3,$4,'furniture',$5)
   ON CONFLICT (id) DO UPDATE SET zone_id=$2, name=$3, description=$4, flags=$5`,
  [
    ID,
    ZONE,
    'Chrome Flatscreen',
    'A sleek wall-mounted flatscreen in a thin brushed-chrome bezel — a pre-Collapse luxury set, its flat glass free of the fishbowl bulge and phosphor lines of the salvaged CRTs everyone else watches. It still pulls a crisp signal.',
    // tv/broadcast_receiver make it a receiver; tv_skin picks the chassis the TV
    // panel renders (data-skin="flatscreen"); the CRT sets simply omit tv_skin.
    JSON.stringify({ tv: true, broadcast_device_type: 'tv', broadcast_receiver: true, tv_skin: 'flatscreen' }),
  ]
);

console.log(`Placed Chrome Flatscreen (${ID}) in ${ZONE}.`);
console.log('In-game: stand there and run `tune <channel number>`, then `watch tv`.');
process.exit(0);
