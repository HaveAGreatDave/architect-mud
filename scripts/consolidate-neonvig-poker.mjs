// One-shot: consolidate the Neon Vig to a single poker table.
//
// We removed the visual high-stakes table (gametable_neonvig) and moved the
// old-school text table (gametable_neonvig_oldschool) + Margo into the main
// casino room. The furniture/NPC/zone moves ride the CODEX content pipeline, but
// `game_tables` rows are runtime-classified (not carried by content:import), so
// this fixes them directly on any environment:
//   - drop the retired gametable_neonvig row
//   - repoint gametable_neonvig_oldschool at zone_casino_interior
//
// Idempotent. Safe to re-run.
//
//   local:  node scripts/consolidate-neonvig-poker.mjs
//   prod:   node --env-file=.env.prod scripts/consolidate-neonvig-poker.mjs   (after the deploy)
import 'dotenv/config';
import { query } from '../server/models/db.js';

async function main() {
  const del = await query("DELETE FROM game_tables WHERE id='gametable_neonvig'");
  console.log(`[drop]  gametable_neonvig — ${del.rowCount} row(s) removed`);

  const upd = await query(
    "UPDATE game_tables SET zone_id='zone_casino_interior', updated_at=NOW() WHERE id='gametable_neonvig_oldschool'"
  );
  console.log(`[move]  gametable_neonvig_oldschool → zone_casino_interior — ${upd.rowCount} row(s) updated`);

  console.log('Done. Reload the world; The Neon Vig now has one poker table — Margo\'s old-school felt in the main room.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
