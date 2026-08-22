/**
 * One-shot: stand up trailers that are hitched to a truck that no longer exists.
 *
 * WHY THIS EXISTS. `trailers.towed_by` names a `trucks.id` and is a plain TEXT
 * column with no foreign key, and `sellTruck` was a bare DELETE — so selling a
 * tractor with a box on the pin left the box pointing at an id nothing will ever
 * answer to. `yardSell` drops the trailer first now (plugins/trucking/index.js),
 * which stops it happening again; this is for the rows that already did.
 *
 * ⚠ AND THE ROW IS NOT MERELY MISLABELLED, IT IS UNREACHABLE. A towed box holds
 * no `parked_zone`, so `trailersAt` cannot see it and it is standing in no yard;
 * it holds a `towed_by`, so `hitchTrailer` and `sellTrailer` (both guarded on
 * `towed_by IS NULL`) and both branches of `yardSellTrailer` refuse it. The
 * depot panel goes on listing it as "on the pin" forever, behind a tractor its
 * owner sold months ago. That is what this repairs: four figures of somebody's
 * capital, visible and untouchable.
 *
 * WHERE IT PUTS THEM. In the YARD of a real depot — the drivable hardstand, not
 * the bay, which is a building interior at grid 0,0 and cannot be drawn at even
 * in principle. Preference order, so a box comes back where its owner works:
 *   1. the depot another of their trailers is already standing in
 *   2. the depot one of their remaining trucks is parked at
 *   3. the first depot by zone id, deterministically, and it says so
 * The pose is left NULL on purpose: `standStock` walks a placeless box onto the
 * hardstand the next time anybody opens that yard, in the same alternating rank
 * bought stock is stood in, which is a better answer than a coordinate invented
 * here. The load stays on it — a repair that emptied somebody's reefer would be
 * worse than the fault.
 *
 * Local:  node scripts/oneshots/repark-orphan-trailers.mjs
 * Prod:   node --env-file=.env.prod scripts/oneshots/repark-orphan-trailers.mjs
 *
 * Converging: the LEFT JOIN can only ever match a trailer whose truck row is
 * gone, so a box legitimately on a fifth wheel is invisible to it and this is a
 * permanent no-op once the world is consistent.
 */
import { query } from '../../server/models/db.js';

// EVERY ZONE ONE DEPOT OWNS, read from the world rather than listed here — the
// same three tiles `depotZonesOf` unions (the shed, its facade, the hardstand),
// so "which depot is this truck at" gets the same answer the game would give.
const { rows: depots } = await query(
  `SELECT id, name, flags->'truck_depot'->>'yard' AS yard, flags->>'world_exit_zone' AS facade
     FROM zones WHERE flags ? 'truck_depot' ORDER BY id`
);
if (!depots.length) {
  console.error('[repark-orphans] no depots in this database — nothing to stand a trailer in.');
  process.exit(1);
}
const yardOfZone = new Map();
for (const d of depots) {
  if (!d.yard) continue;
  for (const z of [d.id, d.yard, d.facade]) if (z) yardOfZone.set(z, d.yard);
}
const fallback = depots.find(d => d.yard)?.yard;

const { rows: orphans } = await query(
  `SELECT tr.id, tr.name, tr.owner_id, tr.towed_by
     FROM trailers tr LEFT JOIN trucks tk ON tk.id = tr.towed_by
    WHERE tr.towed_by IS NOT NULL AND tk.id IS NULL
    ORDER BY tr.created_at`
);

let moved = 0;
for (const t of orphans) {
  // Where this owner's other kit lives. Both reads are per orphan and there are
  // only ever a handful of these — this is a repair script, not a hot path.
  let home = null;
  if (t.owner_id) {
    const { rows: near } = await query(
      `SELECT parked_zone FROM trailers
        WHERE owner_id = $1 AND id <> $2 AND parked_zone IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`, [t.owner_id, t.id]);
    home = yardOfZone.get(near[0]?.parked_zone) || null;
    if (!home) {
      const { rows: rig } = await query(
        'SELECT depot_zone FROM trucks WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1', [t.owner_id]);
      home = yardOfZone.get(rig[0]?.depot_zone) || null;
    }
  }
  const zone = home || fallback;
  // Guarded on `towed_by IS NOT NULL` rather than on the id alone, so a driver
  // who backed under this very box between the read and the write keeps it.
  const { rowCount } = await query(
    `UPDATE trailers SET towed_by = NULL, parked_zone = $1, park_x = NULL, park_y = NULL, park_heading = NULL
      WHERE id = $2 AND towed_by IS NOT NULL`, [zone, t.id]);
  if (!rowCount) { console.log(`[repark-orphans] ${t.id} was taken while we looked at it — left alone`); continue; }
  console.log(`[repark-orphans] ${t.id} (${t.name}) was on ghost ${t.towed_by} → standing in ${zone}`
    + `${home ? '' : ' (no owner kit anywhere — first depot)'}`);
  moved++;
}

console.log(`[repark-orphans] ${moved} trailer(s) stood back up, ${orphans.length - moved} left alone.`);
process.exit(0);
