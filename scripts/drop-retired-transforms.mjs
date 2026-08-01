/**
 * Delete the superseded drug_transforms rows BY ID.
 *
 * The transform pool was rewritten so a psychedelic turns a bed into a lion
 * rather than into "a large animal pretending to be a bed" — the hedge was the
 * whole problem, since it tells the player there is still a bed. The rewritten
 * rows carry new ids; these are the ones they replace. The CODEX deploy is
 * additive and can never remove a row, so without this the retired text stays in
 * the pool on prod and keeps coming up.
 *
 * CONVERGES: deletes by exact id, so once they are gone this is a permanent
 * no-op and it can never match anything authored later.
 *
 *   node scripts/drop-retired-transforms.mjs                (local)
 *   node --env-file=.env.prod scripts/drop-retired-transforms.mjs   (prod)
 */
import { query } from '../server/models/db.js';

const RETIRED = [
  'dx_psilocybin_bed_animal',
  'dx_psilocybin_wall_grown',
  'dx_blotter_seat_lattice',
  'dx_default_soft',
  'dx_default_watching',
  'dxs_default_soft',
];

const { rowCount } = await query('DELETE FROM drug_transforms WHERE id = ANY($1)', [RETIRED]);
console.log(`[drop-retired-transforms] removed ${rowCount} superseded transform row(s).`);
process.exit(0);
