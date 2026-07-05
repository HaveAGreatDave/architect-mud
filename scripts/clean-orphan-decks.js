// One-shot data cleanup: remove media-deck furniture whose linked channel no
// longer exists (an orphaned transmitter can shadow the real deck in a shared
// room). Also clears any cassettes stashed inside the orphan's container.
// Run: node scripts/clean-orphan-decks.js  (add --dry to preview only)
import { query } from '../server/models/db.js';

const dry = process.argv.includes('--dry');

const { rows: orphans } = await query(`
  SELECT f.id, f.name, f.zone_id, f.flags->>'channel_id' AS channel_id
    FROM furniture f
   WHERE f.flags->>'media_deck' = 'true'
     AND f.flags->>'channel_id' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM media_channels c WHERE c.id = f.flags->>'channel_id')
`);

if (!orphans.length) { console.log('No orphaned media decks found.'); process.exit(0); }

console.log(`${dry ? '[dry] Would remove' : 'Removing'} ${orphans.length} orphaned deck(s):`);
for (const o of orphans) console.log(`  ${o.id}  (zone ${o.zone_id}, dangling channel ${o.channel_id})`);

if (!dry) {
  const ids = orphans.map(o => o.id);
  const inv = await query(`DELETE FROM player_inventory WHERE container_id = ANY($1)`, [ids]);
  const furn = await query(`DELETE FROM furniture WHERE id = ANY($1)`, [ids]);
  console.log(`Deleted ${furn.rowCount} furniture row(s) and ${inv.rowCount} stashed cassette(s).`);
}
console.log('Done.');
process.exit(0);
