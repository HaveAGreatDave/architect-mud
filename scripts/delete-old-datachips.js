// One-shot: delete pre-unification datachips — the "old chips" that predate the
// chip↔cassette merge, i.e. datachip items WITHOUT the media_cassette tag. Their
// inventory rows (carried, in containers, or seated in a media deck) go with them.
//
// The underlying security_clips rows are left intact: any clip that no longer has
// a chip becomes `collect`-able again, regenerating it in the new MicroReel
// (media_cassette + broadcast_id) format. New chips are untouched.
//
//   node scripts/delete-old-datachips.js                       (local)
//   node --env-file=.env.prod scripts/delete-old-datachips.js  (prod)
import { query } from '../server/models/db.js';

const { rows } = await query(
  `SELECT id FROM items WHERE jsonb_exists(tags,'datachip') AND NOT jsonb_exists(tags,'media_cassette')`
);
const ids = rows.map(r => r.id);

if (!ids.length) {
  console.log('No old datachips to delete — all datachips are already MicroReel-format (or none exist).');
  process.exit(0);
}

const inv = await query('DELETE FROM player_inventory WHERE item_id = ANY($1)', [ids]);
const items = await query('DELETE FROM items WHERE id = ANY($1)', [ids]);
console.log(`Deleted ${items.rowCount} old datachip item(s) and ${inv.rowCount} inventory row(s).`);
console.log('Underlying security_clips kept — auto-banked footage can be re-collected as a MicroReel.');
process.exit(0);
