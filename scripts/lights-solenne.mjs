// One-shot: switch ON the interior lights of Solenne Residences.
// Interior light_on / light_on_intended are runtime (export-excluded) columns, so the additive
// CODEX insert lands them at the DB default (off) → rooms read "gloomy". This sets them lit.
// (Solenne was converted off flags.always_lit onto the real power sim — junction box + lights.)
// Local:  node scripts/lights-solenne.mjs
// Prod:   node --env-file=.env.prod scripts/lights-solenne.mjs   (run once, after the deploy)
import { query } from '../server/models/db.js';

const ZONES = [
  'zone_solenne_lobby', 'zone_solenne_elevator', 'zone_solenne_residences',
  'zone_solenne_apt_a', 'zone_solenne_apt_b', 'zone_solenne_apt_c',
  'zone_solenne_apt_a_bath', 'zone_solenne_apt_b_bath', 'zone_solenne_apt_c_bath',
  'zone_solenne_penthouse', 'zone_solenne_penthouse_bath', 'zone_solenne_ph_landing',
  'zone_solenne_gym', 'zone_solenne_skydeck',
  'zone_util_zone_solenne_lobby',
];

const r = await query(
  `UPDATE furniture SET light_on = 1, light_on_intended = 1
   WHERE object_type = 'light' AND zone_id = ANY($1)`,
  [ZONES],
);
console.log(`Lit ${r.rowCount} interior fixtures across ${ZONES.length} rooms.`);
process.exit(0);
