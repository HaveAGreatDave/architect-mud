// delete-ghost-clone-bathroom.mjs — remove the orphaned clone-facility Bathroom.
//
// Background: the clone facility's Bathroom was COPIED to the Embassy
// (`zone_embassy_lobby_bathroom`, wired off `zone_residential_lobby`) and the
// original was left behind — commit 2f084f02 dropped `zone_start`'s `west` exit
// but nothing deleted the row. It's unreachable, yet it still renders on the
// minimap: getMinimapData's second pass (server/engine/world.js) surfaces every
// same-map/same-floor tile within Chebyshev radius 4 regardless of reachability,
// and the ghost sits at map_int_1782352518150 (-1,0,0) — one tile west of spawn.
//
// The CODEX deploy is additive (INSERT … ON CONFLICT DO NOTHING) and can never
// delete a row, so this is the sanctioned path: a one-shot data transformation.
// Its content JSON is deleted in the same commit.
//
//   Local:  node scripts/delete-ghost-clone-bathroom.mjs
//   Prod:   node --env-file=.env.prod scripts/delete-ghost-clone-bathroom.mjs
//   Then restart / hit /world/reload so the zone leaves the in-memory world.
//
// One-shot, NOT converging — do not add it to scripts/oneshots.bat. Idempotent
// only in the trivial sense: a second run finds nothing and reports so.
//
// It refuses to run if anything still points at the zone (an exit, furniture, an
// NPC home) — that would mean the room is live again and this is the wrong fix.
import { query } from '../server/models/db.js';

const ZONE_ID = 'zone_clone_facility_bathroom';

const zone = await query('SELECT id, name, map_id FROM zones WHERE id = $1', [ZONE_ID]);
if (!zone.rows.length) {
  console.log(`${ZONE_ID}: already gone — nothing to do.`);
  process.exit(0);
}

// Safety: refuse if the room is reachable or still furnished/inhabited.
const blockers = [];
const referrers = await query(
  "SELECT id FROM zones WHERE exits::text LIKE '%' || $1 || '%' AND id <> $1", [ZONE_ID],
);
if (referrers.rows.length) blockers.push(`exits from: ${referrers.rows.map(r => r.id).join(', ')}`);

for (const [table, col] of [['furniture', 'zone_id'], ['npcs', 'zone_id'], ['npcs', 'home_zone']]) {
  const r = await query(`SELECT count(*)::int n FROM ${table} WHERE ${col} = $1`, [ZONE_ID]);
  if (r.rows[0].n) blockers.push(`${r.rows[0].n} row(s) in ${table}.${col}`);
}

if (blockers.length) {
  console.error(`REFUSING: ${ZONE_ID} is still referenced —\n  ${blockers.join('\n  ')}`);
  console.error('The room is live again; delete is the wrong fix. Nothing changed.');
  process.exit(1);
}

// lighting_states rows are runtime residue keyed by zone; they'd outlive the zone.
const lights = await query('DELETE FROM lighting_states WHERE zone_id = $1', [ZONE_ID]);
await query('DELETE FROM zones WHERE id = $1', [ZONE_ID]);

console.log(`Deleted ${ZONE_ID} ("${zone.rows[0].name}", map ${zone.rows[0].map_id})`);
console.log(`  lighting_states rows removed: ${lights.rowCount}`);
console.log('Restart the server or hit /world/reload to drop it from the live world.');
process.exit(0);
