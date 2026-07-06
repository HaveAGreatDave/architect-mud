// One-shot script: seed the mining gear (a pick), the ore/salvage items, a gravel-
// pit mining table, and attach the table to a zone. Run once (the scavenging_*
// tables already exist — mining reuses that schema):
//   node scripts/seed-mining.js
// Then reload the running world so the zone flag takes effect:
//   POST /api/world/reload   (or restart the server)
//
// Re-runnable: items are skipped if they already exist; the table + entries are
// rebuilt; existing per-zone stock is left untouched.
import { randomUUID } from 'crypto';
import { query } from '../server/models/db.js';

const TABLE_ID = 'mine_gravel_pit';
const ZONE = 'zone_waste_gravel';           // a gravel pit — the live test spot

// ── Gear ──────────────────────────────────────────────────────────────────────
const GEAR = [
  { id: 'item_mining_pick', name: 'mining pick', type: 'misc', weight: 3200, value: 55, stack: 0, unique: 1,
    description: 'A heavy steel pick, one end a chisel and the other a spike, the haft wrapped in sweat-blackened tape. The head is chipped and rehardened a dozen times over. Stand at a deposit and MINE; it takes it from there.',
    tags: { mining_tool: true, unique: true } },
];

// ── Ore / salvage items ────────────────────────────────────────────────────────
const ORE_ITEMS = [
  { id: 'item_scrap_ore', name: 'chunk of scrap ore', type: 'material', weight: 900, value: 8,
    description: 'A fist of rust-streaked ore, heavy and cold, veins of dull metal threading the stone. Worth something melted down — worth more if you find a buyer who does the melting.',
    tags: { material: true } },
  { id: 'item_slag_glass', name: 'lump of slag glass', type: 'material', weight: 600, value: 14,
    description: 'A knot of black volcanic-looking glass, fused out of whatever the foundries dumped here and left to cool. Sharp, dense, and oddly beautiful in the light.',
    tags: { material: true } },
  { id: 'item_copper_nodule', name: 'copper nodule', type: 'material', weight: 700, value: 32,
    description: 'A knuckle of native copper, green-crusted on the outside and bright as a new coin where the pick broke it open. The wire-runners pay real money for clean copper.',
    tags: { material: true } },
  { id: 'item_buried_strongbox', name: 'buried strongbox', type: 'misc', weight: 2200, value: 160,
    description: 'A dented alloy strongbox, packed in gravel and grit long enough that the pit swallowed it whole. Heavy with whatever someone thought worth burying out here.',
    tags: { misc: true } },
];

// weight = pick bias; difficulty = opposing value in the 2d8-2d8 Mining check.
const ENTRIES = [
  { item_id: 'item_scrap_ore',        difficulty: 2, weight: 16, max_qty: 6 },
  { item_id: 'item_slag_glass',       difficulty: 4, weight: 10, max_qty: 4 },
  { item_id: 'item_copper_nodule',    difficulty: 7, weight: 5,  max_qty: 3 },
  { item_id: 'item_buried_strongbox', difficulty: 9, weight: 2,  max_qty: 1 },
];

const MESSAGES = {
  player: [
    'You set the pick and swing, chips of grey stone spitting off the face.',
    'You lever a slab out of the gravel bank and let it crash aside.',
    'You work the pick along a seam, grit boiling up in a dry cloud.',
    'You crack a promising nodule open and turn the break to the light.',
    'You hammer a wedge deep into the pit wall and rock it until it gives.',
  ],
  broadcast: [
    'sets to work on the gravel face, mining for anything worth hauling out.',
  ],
};

// ── Apply ──────────────────────────────────────────────────────────────────────
const { rows: zoneRows } = await query('SELECT id FROM zones WHERE id=$1', [ZONE]);
if (!zoneRows.length) { console.error(`Zone ${ZONE} not found — pick a real zone id.`); process.exit(1); }

async function insertItem(it) {
  const { rows: existing } = await query('SELECT id FROM items WHERE id=$1', [it.id]);
  if (existing.length) { console.log(`SKIP  item ${it.id}`); return; }
  await query(
    `INSERT INTO items (id,name,description,type,weight,value,is_stackable,is_unique,tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [it.id, it.name, it.description, it.type, it.weight, it.value,
     it.stack ?? 1, it.unique ?? 0,
     JSON.stringify({ description: it.description, ...it.tags })]
  );
  console.log(`CREATED item ${it.id}`);
}

for (const it of GEAR) await insertItem(it);
for (const it of ORE_ITEMS) await insertItem({ ...it, stack: 1, unique: 0 });

// Mining table (reuses the scavenging_tables schema).
await query(
  `INSERT INTO scavenging_tables (id, name, replenish_interval_seconds, messages)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
     replenish_interval_seconds=EXCLUDED.replenish_interval_seconds,
     messages=EXCLUDED.messages`,
  [TABLE_ID, 'Gravel Pit Mining', 120, JSON.stringify(MESSAGES)]
);

await query('DELETE FROM scavenging_table_items WHERE table_id=$1', [TABLE_ID]);
for (const e of ENTRIES) {
  await query(
    `INSERT INTO scavenging_table_items (id, table_id, item_id, difficulty, weight, max_qty)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), TABLE_ID, e.item_id, e.difficulty, e.weight, e.max_qty]
  );
}
console.log(`Table '${TABLE_ID}' built with ${ENTRIES.length} stocked entries.`);

// Attach to the zone via the mining-specific flag (separate from scavenging_table_id).
await query(
  `UPDATE zones SET flags = jsonb_set(COALESCE(flags,'{}'::jsonb), '{mining_table_id}', to_jsonb($1::text)) WHERE id=$2`,
  [TABLE_ID, ZONE]
);
console.log(`Attached to ${ZONE}. Reload the world, then: carry item_mining_pick, stand in ${ZONE}, and type \`mine\`.`);
process.exit(0);
