// One-shot: null out runtime NPC zone_id pointers that reference a zone which no
// longer exists (e.g. the decommissioned `zone_city_west` Franchise Strip).
//
// An NPC's zone_id is RAM-only at runtime — the DB value is just the last
// deliberate placement (a dev-panel move) or null on a fresh import. When the
// zone it points at has since been deleted/remapped, the boot placement already
// falls back to home_zone (see world.js), so the NPC isn't lost — but the dead
// pointer lingers in the row and shows up in the dev panel as a phantom
// location. This clears it so the stored value matches the fallback truth.
//
// Data transformation on existing rows (not additive content), so it's a
// deliberate one-shot, not part of content:import. Idempotent — re-running finds
// nothing once clean.
//
//   local:  node scripts/scrub-dangling-npc-zone.mjs
//   prod:   node --env-file=.env.prod scripts/scrub-dangling-npc-zone.mjs
import { query } from '../server/models/db.js';

const { rows } = await query(`
  SELECT id, name, zone_id FROM npcs
  WHERE zone_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM zones z WHERE z.id = npcs.zone_id)
  ORDER BY zone_id, id
`);

if (!rows.length) {
  console.log('No dangling NPC zone_id pointers — nothing to scrub.');
  process.exit(0);
}

for (const r of rows) console.log(`  ${r.id} (${r.name}) → was ${r.zone_id} [missing]`);

const res = await query(`
  UPDATE npcs SET zone_id = NULL
  WHERE zone_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM zones z WHERE z.id = npcs.zone_id)
`);

console.log(`Cleared ${res.rowCount} dangling NPC zone_id pointer(s). They fall back to home_zone on next world load.`);
process.exit(0);
