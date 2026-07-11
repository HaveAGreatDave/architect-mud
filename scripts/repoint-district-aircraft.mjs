// One-shot: repoint aircraft parked at the retired legacy airfield ramps onto the
// district ramps they relocated to. The airfield relocation shipped as content, but
// aircraft are runtime/player rows the content deploy doesn't carry — so on any DB
// that already had planes parked at the legacy fields, those planes are left sitting
// on a now-de-airfielded tile until this runs.
//
// Idempotent: only touches aircraft still parked at a legacy ramp. Grounded craft move
// to the district ramp tile (grid + heading down the strip); airborne craft only get
// their parking target repointed, so nothing gets teleported mid-flight.
//
// Run against prod:  node --env-file=.env.prod scripts/repoint-district-aircraft.mjs
//   (omit the flag to run against your local dev DB)
import { query } from '../server/models/db.js';

const MOVES = [
  { from: 'zone_outskirts', to: 'zone_district_925_903', gx: 925, gy: 903, heading: '0' },  // Coldwater Regional — face N down the runway
  { from: 'zone_threshold', to: 'zone_district_893_909', gx: 893, gy: 909, heading: null }, // Threshold Helipad — VTOL, heading irrelevant
];

// Guard: the district ramps must exist and be airfields on this DB (i.e. the district
// content is deployed here). Refuse to run otherwise, so this can't strand planes on a
// tile that doesn't exist yet.
const rampIds = MOVES.map(m => m.to);
const { rows: ramps } = await query(
  `SELECT id FROM zones WHERE id = ANY($1::text[]) AND flags->>'airfield_id' IS NOT NULL`, [rampIds]);
if (ramps.length !== rampIds.length) {
  const have = ramps.map(r => r.id).join(', ') || 'none';
  console.error(`Aborting: district ramps not present/airfielded on this DB (found: ${have}). Deploy the district content first.`);
  process.exit(1);
}

let moved = 0;
for (const m of MOVES) {
  const { rows } = await query('SELECT id, name, airborne FROM aircraft WHERE parked_zone_id = $1', [m.from]);
  for (const a of rows) {
    if (a.airborne) {
      await query('UPDATE aircraft SET parked_zone_id = $2 WHERE id = $1', [a.id, m.to]);
    } else if (m.heading != null) {
      await query('UPDATE aircraft SET parked_zone_id = $2, grid_x = $3, grid_y = $4, heading = $5 WHERE id = $1',
        [a.id, m.to, m.gx, m.gy, m.heading]);
    } else {
      await query('UPDATE aircraft SET parked_zone_id = $2, grid_x = $3, grid_y = $4 WHERE id = $1',
        [a.id, m.to, m.gx, m.gy]);
    }
    console.log(`  ${a.id} "${a.name}"  ${m.from} → ${m.to}${a.airborne ? '  (airborne: parking target only)' : ''}`);
    moved++;
  }
}
console.log(moved ? `Repointed ${moved} aircraft off the legacy ramps.` : 'No aircraft parked at the legacy ramps — nothing to do.');
process.exit(0);
