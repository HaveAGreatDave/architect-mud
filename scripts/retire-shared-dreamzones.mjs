/**
 * Retire the three authored, SHARED drug dreamzones.
 *
 * WHY THIS EXISTS. Drug hallucinations and sleep dreams are both instanced now
 * (`buildDreamscape` → private, RAM-only rooms keyed by player id). The old model
 * teleported every tripper on the same drug into ONE authored zone, so two people
 * in a K-hole met each other in it — which is exactly the thing a hallucination
 * must never be. Nothing has read `hallucination.dreamzone_id` since instancing
 * landed; the rows simply survived because the CODEX deploy is additive and can
 * never delete.
 *
 * CONVERGING and safe to re-run: it deletes three ids that no content file
 * produces any more, so a clean database is a no-op. Anyone whose stored
 * `current_zone` still points at one is moved to their anchor FIRST (the login
 * rescue would do it anyway, but not before an FK would refuse the delete).
 *
 *   node scripts/retire-shared-dreamzones.mjs                  # local
 *   node --env-file=.env.prod scripts/retire-shared-dreamzones.mjs
 */
import { query } from '../server/models/db.js';

const ZONES = ['zone_dream_threshold', 'zone_dream_khole', 'zone_dream_void'];
const MAP = 'map_dream';

const stranded = await query(
  `UPDATE players SET current_zone = COALESCE(anchor_zone, 'zone_start')
    WHERE current_zone = ANY($1) RETURNING id`,
  [ZONES]
);
if (stranded.rows.length) console.log(`- moved ${stranded.rows.length} player(s) out of a shared dreamzone`);

const anchored = await query(
  `UPDATE players SET anchor_zone = NULL WHERE anchor_zone = ANY($1) RETURNING id`,
  [ZONES]
);
if (anchored.rows.length) console.log(`- cleared ${anchored.rows.length} anchor(s) pointing at one`);

const z = await query(`DELETE FROM zones WHERE id = ANY($1) RETURNING id`, [ZONES]);
for (const r of z.rows) console.log(`- deleted zone ${r.id}`);

const m = await query(`DELETE FROM maps WHERE id = $1 RETURNING id`, [MAP]);
for (const r of m.rows) console.log(`- deleted map ${r.id}`);

console.log(z.rows.length || m.rows.length ? 'Shared dreamzones retired.' : 'Nothing to do — already retired.');
process.exit(0);
