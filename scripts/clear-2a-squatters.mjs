// clear-2a-squatters.mjs — one-shot data fix. Gets Joe Everydayman, Null, and a
// stale Harbormaster residence OUT of Unit 2A (zone_apt_1), matching the content
// change in the same commit. Idempotent. Run local (no flag) and prod
// (node --env-file=.env.prod scripts/clear-2a-squatters.mjs).
//
// - Joe & Null were homed in 2A via home_zone only (no residence row). Rehome them
//   to non-apartment communal zones so they never compete for a rentable unit:
//   Joe → the Embassy lobby, Null → the Sump (the dive he's from).
// - Drop any residence rows they hold (residue from an earlier bad rehome that
//   collided with existing residents; no-op where none exist).
// - Delete the stale 2A residence registration (Harbormaster — his real home is 2B,
//   which keeps its own residence row). This frees 2A of every NPC association.
//
// NOTE: the LIVE game server caches world.npcs in memory; this fixes the DB, but the
// NPCs only visibly leave 2A after the prod world is reloaded/restarted.
import { query } from '../server/models/db.js';

const JOE = 'joe_everydayman', NUL = 'npc_glitch_null', APT2A = 'zone_apt_1';

await query('UPDATE npcs SET home_zone=$1 WHERE id=$2', ['zone_residential_lobby', JOE]);
await query('UPDATE npcs SET home_zone=$1 WHERE id=$2', ['zone_mq_sump_bar', NUL]);
const dRes = await query('DELETE FROM npc_residences WHERE npc_id = ANY($1)', [[JOE, NUL]]);
const d2a = await query('DELETE FROM npc_residences WHERE zone_id=$1', [APT2A]);

const still = (await query(
  "SELECT id FROM npcs WHERE home_zone=$1 UNION SELECT npc_id FROM npc_residences WHERE zone_id=$1", [APT2A]
)).rows.map(r => r.id);

console.log(`Joe → zone_residential_lobby, Null → zone_mq_sump_bar`);
console.log(`cleared ${dRes.rowCount} stray Joe/Null residence(s), ${d2a.rowCount} stale 2A residence(s)`);
console.log(still.length ? `⚠ still associated with 2A: ${still.join(', ')}` : `✓ 2A is clear of all NPC homes/residences`);
process.exit(0);
