// One-shot: three real walk-in buildings were left with placeholder "Grasslands"/no
// building_type on their map_world surface tile, so the flight sim drew them as bare
// ground (only building_type tiles extrude). Stamp the missing surface flags so each
// renders its (already-authored) bespoke model out the canopy — Voltage + Aurelia have
// named models; Halloran's Fix-It now has a bespoke `garage` model in windshield.js.
import { query } from '../server/models/db.js';

const FIXES = [
  { id: 'zone_district_895_907', name: 'Aurelia',            bt: 'boutique',    bn: 'Aurelia' },
  { id: 'zone_district_895_908', name: 'Voltage',            bt: 'nightclub',   bn: 'Voltage' },
  { id: 'zone_district_924_912', name: "Halloran's Fix-It",  bt: 'fabrication', bn: "Halloran's Fix-It" },
];

for (const f of FIXES) {
  const { rowCount } = await query(
    `UPDATE zones
       SET name = $2,
           flags = COALESCE(flags, '{}'::jsonb) || jsonb_build_object('building_type', $3::text, 'building_name', $4::text)
     WHERE id = $1 AND map_id = 'map_world'`,
    [f.id, f.name, f.bt, f.bn]
  );
  console.log(`${rowCount ? 'OK  ' : 'MISS'} ${f.id} -> ${f.bn} (${f.bt})`);
}

// Verify
const { rows } = await query(
  `SELECT id, grid_x x, grid_y y, name, flags->>'building_type' bt, flags->>'building_name' bn
     FROM zones WHERE id = ANY($1) ORDER BY id`,
  [FIXES.map(f => f.id)]
);
console.log('\nAfter:');
for (const r of rows) console.log(`  ${r.x},${r.y}  "${r.name}"  bt=${r.bt}  bn=${r.bn}`);
process.exit(0);
