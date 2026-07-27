// purge-surface-spawns.mjs — one-shot data fix matching the content change in the
// same commit. The CODEX deploy is additive (INSERT … ON CONFLICT DO NOTHING), so
// deleting content/zone_spawns/*.json can never remove the rows already in prod —
// this does. Idempotent. Run local (no flag) and prod
// (node --env-file=.env.prod scripts/purge-surface-spawns.mjs).
//
// Keeps exactly two things:
//   - every spawn in the Under (zone_under_%), which is meant to be hostile
//   - the clonejackers, the one surface threat we want left standing
// Everything else — 127 ash crawlers, feral dogs, gutter cats and friends strewn
// across the outskirts — comes out, so spawns can be re-placed deliberately.
// The city proper is guarded; it should feel that way.
//
// NOTE: the LIVE server holds spawn templates in memory (world.spawnTimers). This
// fixes the DB; already-standing enemies clear on the next world reload/restart.
import { query } from '../server/models/db.js';

const before = (await query('SELECT COUNT(*)::int n FROM zone_spawns')).rows[0].n;

const del = await query(
  `DELETE FROM zone_spawns
    WHERE zone_id NOT LIKE 'zone_under_%'
      AND enemy_id <> 'enemy_clonejacker'`
);

const left = (await query(
  `SELECT zone_id, enemy_id FROM zone_spawns
    WHERE zone_id NOT LIKE 'zone_under_%' ORDER BY zone_id`
)).rows;

console.log(`zone_spawns: ${before} → ${before - del.rowCount} (deleted ${del.rowCount})`);
console.log(left.length
  ? `surface spawns remaining: ${left.map(r => `${r.enemy_id}@${r.zone_id}`).join(', ')}`
  : '⚠ no surface spawns remain at all — expected the clonejacker tile');

// Same commit renames the unplaced demo boss "The Choirmaster" → "The Tinnitus
// Saint" (id and all). The additive deploy inserts the new row but can't retire
// the old one, so drop it here. It was never spawned anywhere.
const old = await query("DELETE FROM enemies WHERE id='enemy_choirmaster_demo'");
if (old.rowCount) console.log('removed stale enemy_choirmaster_demo row');
process.exit(0);
