// One-shot: switch ON the interior lights of the Statue/KSAB media-civic quarter.
// Interior light_on / light_on_intended are runtime (export-excluded) columns, so the additive
// CODEX insert lands them at the DB default (off) → rooms read "gloomy". This sets them lit.
// Local:  node scripts/lights-media-civic.mjs
// Prod:   node --env-file=.env.prod scripts/lights-media-civic.mjs   (run once, after the deploy)
import { query } from '../server/models/db.js';

const ZONES = [
  'zone_ksab_lobby', 'zone_ksab_gallery',
  'zone_greenroom_lounge', 'zone_greenroom_booth',
  'zone_sentinel_bullpen', 'zone_sentinel_editor',
  'zone_meltwater_diner', 'zone_stimcafe',
];

const r = await query(
  `UPDATE furniture SET light_on = 1, light_on_intended = 1
   WHERE object_type = 'light' AND zone_id = ANY($1)`,
  [ZONES],
);
console.log(`Lit ${r.rowCount} interior fixtures across ${ZONES.length} rooms.`);
process.exit(0);
