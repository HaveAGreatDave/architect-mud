// Build three more residences on the Halcyon tower's Sky Hall and move the five
// Halcyon Assurance staff — who currently sleep at their desks — into proper homes
// one hop from their work, in the same building.
//
//   Sky Hall (zone_halcyon_residences) already opens onto 41-A (north) + 41-B (east).
//   This adds 41-C (south), 41-D (west), 41-E (up), matching the existing units'
//   flags/colour/safe-zone exactly, wired bidirectionally into the hall.
//
//   Homes (each ~2-3 hops from their desk, vs the 16 hops to the nearest existing
//   spare apartment):
//     Priya Anand    (lobby)        → 41-A     Auberon Vale (exec)  → 41-B
//     Delphine Roux  (claims)       → 41-C     Marcus Kell (underwr)→ 41-D
//     Sef            (concourse)    → 41-E
//   All five are registered in npc_residences, so none of the units are rentable.
//
// Zone inserts are additive (ON CONFLICT DO UPDATE, idempotent); the home moves are
// a data-transform on existing rows. Dry-run by default.
//
//   node scripts/build-halcyon-residences.mjs            # local, dry run
//   node scripts/build-halcyon-residences.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/build-halcyon-residences.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';

const APPLY = process.argv.includes('--apply');
const HALL = 'zone_halcyon_residences';

// New units: id, letter, the hall exit that reaches them, the reverse exit back,
// grid delta from the hall, and a description.
const UNITS = [
  { id: 'zone_halcyon_apt_c', letter: 'C', from: 'south', back: 'north', dx: 0,  dy: -1, dz: 0,
    desc: 'A compact sky-apartment, twin to the others on this hall: a fold-away bed, a narrow galley, and the same floor-to-ceiling window selling the cold city back to you as a view. Sparsely fitted, waiting for a tenant.' },
  { id: 'zone_halcyon_apt_d', letter: 'D', from: 'west',  back: 'east',  dx: -1, dy: 0,  dz: 0,
    desc: 'A corner sky-apartment: a little more glass than the others, a fold-away bed, and the whole grey sprawl laid out cold beyond the pane. Engineered calm, and an invoice to match.' },
  { id: 'zone_halcyon_apt_e', letter: 'E', from: 'up',    back: 'down',  dx: 0,  dy: 0,  dz: 1,
    desc: 'The hall’s top unit, a half-floor above its neighbours: a fold-away bed, a slim galley, and a window that turns the basin into weather you watch from above. Quiet, expensive, and empty until now.' },
];

const HOMES = [
  { npc: 'npc_halcyon_reception',   name: 'Priya Anand',  unit: 'zone_halcyon_apt_a' },
  { npc: 'npc_halcyon_vp',          name: 'Auberon Vale', unit: 'zone_halcyon_apt_b' },
  { npc: 'npc_halcyon_adjuster',    name: 'Delphine Roux',unit: 'zone_halcyon_apt_c' },
  { npc: 'npc_halcyon_underwriter', name: 'Marcus Kell',  unit: 'zone_halcyon_apt_d' },
  { npc: 'npc_halcyon_kiosk',       name: 'Sef',          unit: 'zone_halcyon_apt_e' },
];

async function main() {
  console.log(`=== build-halcyon-residences (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const { rows: hall } = await query(`SELECT exits, grid_x, grid_y, grid_z FROM zones WHERE id=$1`, [HALL]);
  if (!hall.length) { console.error(`  ✗ ${HALL} not found — aborting.`); process.exit(1); }
  const hx = hall[0].grid_x ?? 0, hy = hall[0].grid_y ?? 0, hz = hall[0].grid_z ?? 0;
  const hallExits = { ...(hall[0].exits || {}) };

  console.log('New units off the Sky Hall:');
  for (const u of UNITS) {
    const flags = { is_interior: true, is_apartment: true, building_type: 'residential' };
    const exits = { [u.back]: HALL };
    console.log(`  ${u.id}  "Halcyon Residence 41-${u.letter}"  hall.${u.from} ⇄ ${u.id}.${u.back}`);
    if (APPLY) {
      await query(
        `INSERT INTO zones (id, name, description, danger_rating, pvp_enabled, radiation_level, is_safe_zone,
                            ambient_events, exits, flags, map_id, grid_x, grid_y, grid_z, marker, color, bg_color, ambient_theme)
         VALUES ($1,$2,$3,'safe',0,0,1,'[]'::jsonb,$4,$5,'map_int_halcyon',$6,$7,$8,'41','#eae6f0','#2c2340','indoors')
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
           exits=EXCLUDED.exits, flags=EXCLUDED.flags, is_safe_zone=EXCLUDED.is_safe_zone`,
        [u.id, `Halcyon Residence 41-${u.letter}`, u.desc, JSON.stringify(exits), JSON.stringify(flags),
         hx + u.dx, hy + u.dy, hz + u.dz]);
    }
    hallExits[u.from] = u.id;
  }

  console.log(`\nSky Hall exits → ${JSON.stringify(hallExits)}`);
  if (APPLY) await query(`UPDATE zones SET exits=$1 WHERE id=$2`, [JSON.stringify(hallExits), HALL]);

  console.log('\nHousing the Halcyon staff (home_zone + npc_residences):');
  for (const h of HOMES) {
    const { rows: n } = await query(`SELECT home_zone FROM npcs WHERE id=$1`, [h.npc]);
    if (!n.length) { console.log(`  ✗ ${h.name} (${h.npc}) not found — SKIPPED`); continue; }
    console.log(`  ${h.name.padEnd(14)} ${n[0].home_zone} → ${h.unit}`);
    if (APPLY) {
      await query(`UPDATE npcs SET home_zone=$1 WHERE id=$2`, [h.unit, h.npc]);
      await query(`INSERT INTO npc_residences (zone_id, npc_id) VALUES ($1,$2)
                   ON CONFLICT (zone_id) DO UPDATE SET npc_id=$2`, [h.unit, h.npc]);
    }
  }

  console.log(APPLY ? `\n✓ APPLIED. Restart / world reload to load the new rooms + homes.`
                    : `\nRe-run with --apply to write.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
