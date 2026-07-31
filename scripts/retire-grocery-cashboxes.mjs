// One-shot CLAMP — run once by hand, then delete. Does NOT belong in oneshots.bat.
//
// Ration Nine used to be three shops sharing a room: Dell Fry on the till, the
// Butcher, and Brack the Fishmonger, each with their own catalogue and their own
// cashbox bolted to the same floor. It is now one shop — Dell sells everything,
// the other two do the butchery, and all three feed and draw from a single box
// (`furn_safe_npc_ration_cook`, flags.vendor_staff).
//
// The CODEX deploy is additive, so it can create the shared box but can never
// remove the two it replaces. That's this script.
//
//   node --env-file=.env.prod scripts/retire-grocery-cashboxes.mjs
//   node scripts/retire-grocery-cashboxes.mjs            (local)
import { query } from '../server/models/db.js';

const DEAD = ['furn_safe_npc_butcher', 'furn_safe_npc_fishmonger'];

const { rows: found } = await query(
  'SELECT id, name, zone_id FROM furniture WHERE id = ANY($1::text[])', [DEAD]
);
if (!found.length) {
  console.log('Nothing to do — both cashboxes are already gone.');
  process.exit(0);
}
for (const f of found) console.log(`  removing ${f.id} (${f.name}) in ${f.zone_id}`);

// Anything stashed inside goes to the shared box rather than evaporating.
const { rowCount: moved } = await query(
  `UPDATE player_inventory SET container_id = 'furn_safe_npc_ration_cook'
   WHERE container_id = ANY($1::text[])`, [DEAD]
);
if (moved) console.log(`  moved ${moved} stored item(s) into the shared cashbox`);

const { rowCount } = await query('DELETE FROM furniture WHERE id = ANY($1::text[])', [DEAD]);
console.log(`Removed ${rowCount} cashbox row(s). Reload the world (/world/reload) or restart.`);
process.exit(0);
