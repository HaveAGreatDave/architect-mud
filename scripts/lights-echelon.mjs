// One-shot: switch ON the interior lights of the Echelon superyacht.
// Interior light_on / light_on_intended are runtime (export-excluded) columns, so the additive
// CODEX insert lands them at the DB default (off) → rooms read "gloomy". This sets them lit.
// (The Echelon was converted off flags.always_lit onto the real power sim — the engine-room
//  junction box + a light fixture per room; the backup generator back-feeds the jbox, so the
//  yacht stays lit through a citywide blackout.)
// Local:  node scripts/lights-echelon.mjs
// Prod:   node --env-file=.env.prod scripts/lights-echelon.mjs   (run once, after the deploy)
import { query } from '../server/models/db.js';

const ZONES = [
  'zone_echelon_foyer', 'zone_echelon_bridge', 'zone_echelon_stern',
  'zone_echelon_landing', 'zone_echelon_suite', 'zone_echelon_suite_bath',
  'zone_echelon_suite_boudoir', 'zone_echelon_broadcast', 'zone_echelon_engine',
  'zone_echelon_engineering', 'zone_echelon_helipad',
];

const r = await query(
  `UPDATE furniture SET light_on = 1, light_on_intended = 1
   WHERE object_type = 'light' AND zone_id = ANY($1)`,
  [ZONES],
);
console.log(`Lit ${r.rowCount} light fixtures across ${ZONES.length} Echelon rooms.`);

// Bring the engine-room backup genset online (status is a runtime, export-excluded
// column, so it lands offline from the additive import). With it running, the yacht
// stays lit through a citywide blackout — the jbox falls back to onboard power.
const g = await query(
  `UPDATE generators SET status = 'online'
   WHERE id = 'gen_echelon_engine_portable'`,
);
console.log(`Backup genset online: ${g.rowCount} row.`);
process.exit(0);
