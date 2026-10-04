// One-shot: give every tenant and every guest a home_zone.
//
//   • A player who rents a unit but whose home_zone is empty, or points somewhere
//     they don't rent, gets their most recently rented unit. Renting sets home
//     itself now (apartments.js cmdRent); this catches the leases signed before.
//   • A guest with no home gets the zone flagged guest_home (the clone hostel).
//
// Converging: a second run changes nothing. Local by default; prod with
//   node --env-file=.env.prod scripts/backfill-home-zone.mjs
// Live players keep their in-memory home_zone until they next log in.
import { query } from '../server/models/db.js';

const tenants = await query(`
  UPDATE players p SET home_zone = a.zone_id
    FROM (SELECT DISTINCT ON (owner_id) owner_id, zone_id
            FROM apartments
           WHERE owner_id IS NOT NULL AND COALESCE(owner_type, 'player') = 'player'
           ORDER BY owner_id, date_rented DESC NULLS LAST) a
   WHERE p.id = a.owner_id
     AND (p.home_zone IS NULL OR NOT EXISTS (
           SELECT 1 FROM apartments x WHERE x.zone_id = p.home_zone AND x.owner_id = p.id))
  RETURNING p.handle, a.zone_id`);
console.log(`tenants rehomed: ${tenants.rowCount}`);
for (const r of tenants.rows) console.log(`  ${r.handle} -> ${r.zone_id}`);

const { rows: hostel } = await query(`SELECT id FROM zones WHERE (flags->>'guest_home')::boolean IS TRUE LIMIT 1`);
if (!hostel.length) {
  console.log('no zone is flagged guest_home; guests left alone');
} else {
  const guests = await query(
    `UPDATE players SET home_zone = $1 WHERE role = 'guest' AND home_zone IS NULL RETURNING handle`,
    [hostel[0].id]);
  console.log(`guests homed to ${hostel[0].id}: ${guests.rowCount}`);
}
process.exit(0);
