// One-shot: switch ON the lights in the two new Precinct 9 cell-block rooms.
// light_on / light_on_intended are runtime (export-excluded) columns, so the additive
// CODEX insert lands them at the DB default (off) → the rooms read "gloomy" on a fresh
// import. This sets them lit, once, after the deploy.
// Local:  node scripts/lights-precinct-block.mjs
// Prod:   node --env-file=.env.prod scripts/lights-precinct-block.mjs   (run once, after the deploy)
import { query } from '../server/models/db.js';

const ZONES = ['zone_mq_precinct_showers', 'zone_mq_precinct_gym'];

const r = await query(
  `UPDATE furniture SET light_on = 1, light_on_intended = 1
   WHERE object_type = 'light' AND zone_id = ANY($1)`,
  [ZONES],
);
console.log(`Lit ${r.rowCount} fixtures across ${ZONES.length} rooms.`);
process.exit(0);
