/**
 * clear-longwatch-perimeter-spawns.mjs — ONE-SHOT CLAMP. Run by hand, once, then
 * delete it. Do NOT add it to scripts/oneshots.bat (see the rule at the top of
 * that file): this pins a decision made on one particular day, and re-running it
 * a year from now would delete perimeter spawns somebody deliberately authored.
 *
 * The Long Watch keep the tunnels around their bunker clear — that is the whole
 * point of the patrols. The content tree no longer carries these zone_spawns
 * rows, but the CODEX deploy is additive (INSERT ... ON CONFLICT DO NOTHING), so
 * deleting the files can never remove rows that already reached a database.
 * This does.
 *
 *   node scripts/clear-longwatch-perimeter-spawns.mjs                 (local)
 *   node --env-file=.env.prod scripts/clear-longwatch-perimeter-spawns.mjs   (prod)
 */
import { query } from '../server/models/db.js';

const IDS = [
  'zs_under_923_913_weeper_mutant',
  'zs_under_923_914_weeper_mutant',
  'zs_under_923_915_stilt_mutant',
  'zs_under_924_914_weeper_mutant',
  'zs_under_924_915_weeper_mutant',
  'zs_under_924_916_weeper_mutant',
  'zs_under_925_917_stilt_mutant',
  'zs_under_926_913_weeper_mutant',
];

const { rowCount } = await query('DELETE FROM zone_spawns WHERE id = ANY($1)', [IDS]);
console.log(`cleared ${rowCount} perimeter spawn row(s) around the Long Watch bunker`);
process.exit(0);
