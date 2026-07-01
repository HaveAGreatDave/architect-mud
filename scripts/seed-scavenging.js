// One-shot script: seed scavengeable "junk" items, a sample scavenging table,
// and attach it to zone_start.
// Run once (after `npm run db:schema` has created the scavenging tables):
//   node scripts/seed-scavenging.js
//
// Re-runnable: items are skipped if they already exist; the table + entries are
// upserted; existing per-zone stock is left untouched.
import { randomUUID } from 'crypto';
import { query } from '../server/models/db.js';

const TABLE_ID = 'scav_roadside_junk';
const ZONE = 'zone_start';

// weight = grams. difficulty = opposing value in the 2d8-2d8 Scavenging check.
// pick_weight biases both the per-attempt draw and the replenish draw (higher =
// shows up more often). max_qty caps how much of it a zone can hold.
const JUNK = [
  { id: 'item_rusted_can',       name: 'Rusted Can',            weight: 120, value: 1,  rarity: 'common',
    description: 'A dented steel can, label long gone to rust. Empty, but the metal is still good for something.',
    difficulty: 3, pick_weight: 16, max_qty: 3 },
  { id: 'item_scrap_metal',      name: 'Scrap Metal',           weight: 800, value: 3,  rarity: 'common',
    description: 'A jagged offcut of sheet metal, edges sharp enough to remind you to be careful. Raw fabrication stock.',
    difficulty: 4, pick_weight: 15, max_qty: 3 },
  { id: 'item_tangled_wire',     name: 'Tangled Wire',          weight: 200, value: 4,  rarity: 'common',
    description: 'A fist-sized snarl of copper wire, half its insulation cracked away. Worth untangling.',
    difficulty: 5, pick_weight: 12, max_qty: 3 },
  { id: 'item_cracked_circuit',  name: 'Cracked Circuit Board', weight: 150, value: 12, rarity: 'uncommon',
    description: 'A scorched circuit board with a hairline crack across it. A few components might still be salvageable.',
    difficulty: 6, pick_weight: 9,  max_qty: 3 },
  { id: 'item_depleted_battery', name: 'Depleted Battery',      weight: 400, value: 15, rarity: 'uncommon',
    description: 'A heavy industrial cell, mostly dead. Trace charge left — and the casing alone is worth hauling.',
    difficulty: 7, pick_weight: 6,  max_qty: 2 },
  { id: 'item_mystery_component', name: 'Mystery Component',    weight: 90,  value: 60, rarity: 'rare',
    description: 'A sleek, unlabeled module of pre-Collapse make. You have no idea what it does, but someone will pay to find out.',
    difficulty: 9, pick_weight: 3,  max_qty: 1 },
];

const { rows: zoneRows } = await query('SELECT id FROM zones WHERE id=$1', [ZONE]);
if (!zoneRows.length) { console.error(`Zone ${ZONE} not found — pick a real zone id.`); process.exit(1); }

// 1) Items (skip existing).
for (const it of JUNK) {
  const { rows: existing } = await query('SELECT id FROM items WHERE id=$1', [it.id]);
  if (existing.length) { console.log(`SKIP  item ${it.id}`); continue; }
  await query(
    `INSERT INTO items (id,name,description,type,weight,value,rarity,is_stackable,is_unique,tags)
     VALUES ($1,$2,$3,'misc',$4,$5,$6,1,0,$7)`,
    [it.id, it.name, it.description, it.weight, it.value, it.rarity,
     JSON.stringify({ description: it.description, misc: true })]
  );
  console.log(`CREATED item ${it.id}`);
}

// 2) Table template.
await query(
  `INSERT INTO scavenging_tables (id, name, replenish_interval_seconds, messages)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
     replenish_interval_seconds=EXCLUDED.replenish_interval_seconds`,
  [TABLE_ID, 'Roadside Junk', 120, JSON.stringify({})]
);

// 3) Entries (rebuild).
await query('DELETE FROM scavenging_table_items WHERE table_id=$1', [TABLE_ID]);
for (const it of JUNK) {
  await query(
    `INSERT INTO scavenging_table_items (id, table_id, item_id, difficulty, weight, max_qty)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), TABLE_ID, it.id, it.difficulty, it.pick_weight, it.max_qty]
  );
}
console.log(`Table '${TABLE_ID}' built with ${JUNK.length} entries.`);

// 4) Attach to the zone.
await query(
  `UPDATE zones SET flags = jsonb_set(COALESCE(flags,'{}'::jsonb), '{scavenging_table_id}', to_jsonb($1::text)) WHERE id=$2`,
  [TABLE_ID, ZONE]
);
console.log(`Attached to ${ZONE}. In-game: stand in ${ZONE} and type \`scavenge\`.`);
process.exit(0);
