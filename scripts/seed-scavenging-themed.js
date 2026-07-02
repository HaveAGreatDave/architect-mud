// One-shot script: seed two zone-themed scavenging tables and attach them to the
// zones they fit, overriding the generic "Roadside Junk" table there. Also caps
// the Roadside table's entries at max_qty 3 (1-3 pieces per tile).
// Run once (after `npm run db:schema`):
//   node scripts/seed-scavenging-themed.js
//
// Re-runnable: items skipped if present; tables/entries upserted; zone stock left
// alone (stale stock self-corrects on the next scavenge via lazy replenish).
import { randomUUID } from 'crypto';
import { query } from '../server/models/db.js';

// weight = grams. difficulty = opposing value in the 2d8-2d8 check. pw = pick
// weight (higher shows up more). max = per-zone cap (kept to 1-3).
const TABLES = [
  {
    id: 'scav_irradiated_salvage',
    name: 'Irradiated Salvage',
    replenish: 180,
    zones: ['zone_deep_waste', 'zone_ruins', 'zone_badland_sw_outer', 'zone_badland_w_gate'],
    items: [
      { id: 'item_mutated_bone',    name: 'Mutated Bone',       weight: 300, value: 6,
        description: 'A femur that grew wrong — too many knobs, faintly warm to the touch. Someone in butchering might want it.',
        difficulty: 4, pw: 14, max: 3 },
      { id: 'item_glowing_scrap',   name: 'Glowing Scrap',      weight: 600, value: 10,
        description: 'A chunk of alloy that sweats a sickly green light. Handling it too long is a decision, not an accident.',
        difficulty: 6, pw: 10, max: 3 },
      { id: 'item_cracked_fuel_rod', name: 'Cracked Fuel Rod',  weight: 900, value: 40,
        description: 'A stubby reactor rod, hairline-fractured and leaking. Absurdly valuable, mildly homicidal.',
        difficulty: 8, pw: 5,  max: 1 },
      { id: 'item_hot_isotope',     name: 'Hot Isotope Pellet', weight: 60,  value: 90,
        description: 'A pea of pure isotope in a lead bead. The bead is not thick enough. Nothing is thick enough.',
        difficulty: 10, pw: 2, max: 1 },
    ],
  },
  {
    id: 'scav_consumer_trash',
    name: 'Consumer Trash',
    replenish: 90,
    zones: ['zone_city_west', 'zone_city_north', 'zone_city_ne', 'zone_city_se'],
    items: [
      { id: 'item_crushed_soda',   name: 'Crushed Soda Can',    weight: 40,  value: 1,
        description: 'A flattened can of something that was 90% sweetener and 10% legal threat. The aluminum still counts.',
        difficulty: 2, pw: 16, max: 3 },
      { id: 'item_greasy_wrapper',  name: 'Greasy Wrapper',     weight: 20,  value: 1,
        description: 'Franchise-branded foil, still smelling faintly of whatever they called meat. Surprisingly useful tinder.',
        difficulty: 2, pw: 15, max: 3 },
      { id: 'item_loyalty_chip',   name: 'Cracked Loyalty Chip', weight: 15, value: 8,
        description: 'A consumer rewards chip, cracked but not wiped. There might still be points on it. There might still be debt.',
        difficulty: 5, pw: 9,  max: 2 },
      { id: 'item_busted_datapad', name: 'Busted Datapad',      weight: 300, value: 25,
        description: 'A shattered slab of a personal terminal. The screen is dead but the storage might not be.',
        difficulty: 7, pw: 4,  max: 1 },
    ],
  },
];

async function upsertItem(it) {
  const { rows } = await query('SELECT id FROM items WHERE id=$1', [it.id]);
  if (rows.length) { console.log(`  SKIP item ${it.id}`); return; }
  await query(
    `INSERT INTO items (id,name,description,type,weight,value,is_stackable,is_unique,tags)
     VALUES ($1,$2,$3,'misc',$4,$5,1,0,$6)`,
    [it.id, it.name, it.description, it.weight, it.value,
     JSON.stringify({ description: it.description, misc: true })]
  );
  console.log(`  CREATED item ${it.id}`);
}

for (const t of TABLES) {
  console.log(`\n== ${t.name} ==`);
  for (const it of t.items) await upsertItem(it);

  await query(
    `INSERT INTO scavenging_tables (id, name, replenish_interval_seconds, messages)
     VALUES ($1,$2,$3,'{}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
       replenish_interval_seconds=EXCLUDED.replenish_interval_seconds`,
    [t.id, t.name, t.replenish]
  );
  await query('DELETE FROM scavenging_table_items WHERE table_id=$1', [t.id]);
  for (const it of t.items) {
    await query(
      `INSERT INTO scavenging_table_items (id, table_id, item_id, difficulty, weight, max_qty)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), t.id, it.id, it.difficulty, it.pw, it.max]
    );
  }
  for (const z of t.zones) {
    const r = await query(
      `UPDATE zones SET flags = jsonb_set(COALESCE(flags,'{}'::jsonb), '{scavenging_table_id}', to_jsonb($1::text)) WHERE id=$2`,
      [t.id, z]
    );
    console.log(`  ${r.rowCount ? 'attached ->' : 'MISS      '} ${z}`);
  }
}

// Keep the generic Roadside table within the 1-3 pieces-per-tile rule.
const capped = await query('UPDATE scavenging_table_items SET max_qty=3 WHERE table_id=$1 AND max_qty>3', ['scav_roadside_junk']);
console.log(`\nCapped ${capped.rowCount} Roadside entries to max_qty 3.`);

const summary = await query(
  `SELECT z.flags->>'scavenging_table_id' AS tbl, COUNT(*) AS zones
   FROM zones z WHERE z.flags ? 'scavenging_table_id' GROUP BY 1 ORDER BY 1`
);
console.log('\nTable coverage:'); summary.rows.forEach(r => console.log('  ', r.tbl, '->', r.zones, 'zones'));
process.exit(0);
