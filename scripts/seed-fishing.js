// One-shot script: seed the fishing gear (rod + bait), the catch items, a bay
// fishing table, an aquatic monster hook, and attach the table to Fishmarket Dock.
// Run once (the scavenging_* tables already exist — fishing reuses that schema):
//   node scripts/seed-fishing.js
// Then reload the running world so the zone flag takes effect:
//   POST /api/world/reload   (or restart the server)
//
// Re-runnable: items/enemy are skipped if they already exist; the table + entries
// are rebuilt; existing per-zone stock is left untouched.
import { randomUUID } from 'crypto';
import { query } from '../server/models/db.js';

const TABLE_ID = 'fish_coldwater_bay';
const ZONE = 'zone_dock_fishmarket';        // Fishmarket Dock — the live test spot
const MONSTER_ID = 'enemy_cable_eel';

// ── Gear ──────────────────────────────────────────────────────────────────────
const GEAR = [
  { id: 'item_fishing_rod', name: 'fishing rod', type: 'misc', weight: 1200, value: 40, stack: 0, unique: 1,
    description: 'A battered telescopic rod, its guides furred with old salt and the reel gummy but turning. Good enough to pull something out of the bay — if the line holds.',
    tags: { fishing_rod: true, unique: true } },
  { id: 'item_bloodworm_bait', name: 'bloodworm bait', type: 'misc', weight: 40, value: 5, stack: 1, unique: 0,
    description: 'A twist of waxed paper packed with fat, writhing bloodworms. The good stuff — the things down there can smell it through the murk.',
    tags: { bait: true, bait_bloodworm: true } },
];

// ── Catch items (item_fresh_catch already exists and is reused as the staple) ──
const CATCH_ITEMS = [
  { id: 'item_waterlogged_boot', name: 'waterlogged boot', type: 'material', weight: 700, value: 1,
    description: 'A single work boot, swollen and black with bilge water, something small and unhappy still living in the toe. Not what you hoped for.',
    tags: { material: true } },
  { id: 'item_bloated_corpse_part', name: 'bloated hand', type: 'misc', weight: 900, value: 2,
    description: 'A pale, waterlogged hand, severed clean at the wrist and gone soft at the edges. Someone, somewhere, is missing this. Best not to think about it.',
    tags: { misc: true } },
  { id: 'item_drowned_lockbox', name: 'drowned lockbox', type: 'misc', weight: 1800, value: 140,
    description: 'A sealed alloy lockbox, weed-strung and dripping, heavier than it has any right to be. Whatever the bay swallowed with it is still inside.',
    tags: { misc: true } },
  { id: 'item_glass_eel', name: 'glass eel', type: 'misc', weight: 300, value: 55,
    description: 'A translucent ribbon of an eel, its organs a faint glowing knot behind glassy skin. Rare, delicate, and worth real money to the right buyer — it only ever takes live bait.',
    tags: { misc: true } },
];

// weight = pick bias; difficulty = opposing value in the 2d8-2d8 Fishing check.
const NORMAL_CATCHES = [
  { item_id: 'item_fresh_catch',          difficulty: 3, weight: 16, max_qty: 5 },
  { item_id: 'item_waterlogged_boot',     difficulty: 2, weight: 12, max_qty: 4 },
  { item_id: 'item_bloated_corpse_part',  difficulty: 7, weight: 4,  max_qty: 2 },
  { item_id: 'item_drowned_lockbox',      difficulty: 9, weight: 2,  max_qty: 1 },
];

const MESSAGES = {
  player: [
    'You flick the line out over the black water and settle in to wait.',
    'The float bobs on an oily swell. You watch it, and wait.',
    'You reel in a little slack and cast again, further out past the pilings.',
    'A slick of rainbow scum drifts past your line. Something moves under it.',
    'The bay heaves slow and greasy against the dock. Your line hangs slack.',
  ],
  quiet: [
    'Nothing\'s biting.',
    'The line stays slack. Whatever\'s down there isn\'t interested.',
    'You feel a nibble — then slack again. Missed it.',
    'A bubble breaks the surface, and that\'s all.',
  ],
  broadcast: [
    'casts a line out over the bay and settles in to fish.',
  ],
};

// Fishing-only pools ride in dedicated scavenging_tables columns (not messages).
const FISHING_BAIT_CATCHES = [
  { itemId: 'item_glass_eel', requiresBaitTag: 'bait_bloodworm', name: 'glass eel', difficulty: 7, weight: 3 },
];
const FISHING_MONSTERS = [
  { enemyTemplateId: MONSTER_ID, name: 'a cable eel', difficulty: 9, weight: 2 },
];

// ── Aquatic monster hook (cloned shape from enemy_slag_rat) ────────────────────
const CABLE_EEL = {
  id: MONSTER_ID,
  name: 'Cable Eel',
  description: 'A black, cable-thick eel as long as a man is tall, its hide studded with the barnacled remains of fibre-optic sheathing it has swallowed and grown around. Its jaw is a ring of glassy, back-curved teeth.',
  hp_max: 16,
  loot_table: [{ item: 'item_fresh_catch', qty: [1, 1], weight: 40 }],
  behavior: 'aggressive',
  faction: null,
  death_message: 'The eel thrashes itself still and lies steaming on the boards.',
  flags: {
    attacks_npcs: false,
    battle_cries: [
      '$enemy coils and lunges at $player, jaws wide.',
      '$enemy lashes a whipcrack of muscle across the dock at $player.',
      '$enemy\'s glassy teeth snap shut a hand\'s breadth from $player.',
    ],
    first_strike_delay_ms: 3000,
  },
  hit: 3,
  dodge: 3,
  weapon: [{ min: 2, max: 6, type: 'kinetic' }],
  body_parts: [
    { part: 'head', soak: {}, weight: 20 },
    { part: 'torso', soak: {}, weight: 60 },
    { part: 'tail', soak: {}, weight: 20 },
  ],
  butcher_table: [{ item: 'item_raw_meat', qty: [1, 2], weight: 100 }],
  butcher_difficulty: 4,
  behaviour_graph: {},
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
     it.stack ?? (it.is_stackable ?? 1), it.unique ?? 0,
     JSON.stringify({ description: it.description, ...it.tags })]
  );
  console.log(`CREATED item ${it.id}`);
}

for (const it of GEAR) await insertItem(it);
for (const it of CATCH_ITEMS) await insertItem({ ...it, stack: 1, unique: 0 });

// Monster template.
{
  const { rows: existing } = await query('SELECT id FROM enemies WHERE id=$1', [CABLE_EEL.id]);
  if (existing.length) { console.log(`SKIP  enemy ${CABLE_EEL.id}`); }
  else {
    await query(
      `INSERT INTO enemies (id,name,description,hp_max,loot_table,behavior,faction,death_message,flags,hit,dodge,weapon,body_parts,butcher_table,butcher_difficulty,behaviour_graph)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [CABLE_EEL.id, CABLE_EEL.name, CABLE_EEL.description, CABLE_EEL.hp_max,
       JSON.stringify(CABLE_EEL.loot_table), CABLE_EEL.behavior, CABLE_EEL.faction,
       CABLE_EEL.death_message, JSON.stringify(CABLE_EEL.flags), CABLE_EEL.hit, CABLE_EEL.dodge,
       JSON.stringify(CABLE_EEL.weapon), JSON.stringify(CABLE_EEL.body_parts),
       JSON.stringify(CABLE_EEL.butcher_table), CABLE_EEL.butcher_difficulty,
       JSON.stringify(CABLE_EEL.behaviour_graph)]
    );
    console.log(`CREATED enemy ${CABLE_EEL.id}`);
  }
}

// Fishing table (reuses the scavenging_tables schema; fishing-only pools ride in
// the fishing_monsters / fishing_bait_catches columns).
await query(
  `INSERT INTO scavenging_tables (id, name, replenish_interval_seconds, messages, fishing_monsters, fishing_bait_catches)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,
     replenish_interval_seconds=EXCLUDED.replenish_interval_seconds,
     messages=EXCLUDED.messages,
     fishing_monsters=EXCLUDED.fishing_monsters,
     fishing_bait_catches=EXCLUDED.fishing_bait_catches`,
  [TABLE_ID, 'Coldwater Bay Fishing', 90, JSON.stringify(MESSAGES),
   JSON.stringify(FISHING_MONSTERS), JSON.stringify(FISHING_BAIT_CATCHES)]
);

await query('DELETE FROM scavenging_table_items WHERE table_id=$1', [TABLE_ID]);
for (const e of NORMAL_CATCHES) {
  await query(
    `INSERT INTO scavenging_table_items (id, table_id, item_id, difficulty, weight, max_qty)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), TABLE_ID, e.item_id, e.difficulty, e.weight, e.max_qty]
  );
}
console.log(`Table '${TABLE_ID}' built with ${NORMAL_CATCHES.length} stocked entries (+ bait catch + monster in fishing columns).`);

// Attach to the zone via the fishing-specific flag (separate from scavenging_table_id).
await query(
  `UPDATE zones SET flags = jsonb_set(COALESCE(flags,'{}'::jsonb), '{fishing_table_id}', to_jsonb($1::text)) WHERE id=$2`,
  [TABLE_ID, ZONE]
);
console.log(`Attached to ${ZONE}. Reload the world, then: carry item_fishing_rod, stand in ${ZONE}, and type \`fish\`.`);
process.exit(0);
