// One-shot script: seed SPECTER crafting — components + recipes (Phase 5 addendum).
// Run once:            node scripts/seed-surveillance-crafting.js
// Grant test parts:    node scripts/seed-surveillance-crafting.js <playerId>
//
// Requires the gear defs first (recipes output those items):
//   node scripts/seed-surveillance-gear.js
// Recipes are cached at boot, so RESTART the server after seeding. Craft with
// `craft <recipe name>` (uses the electronics skill; no station required).
// If npc_glitch exists (vendor seed), the components are added to their stock.

import { randomUUID } from 'crypto';
import { query } from '../server/models/db.js';

const COMPONENTS = [
  { id: 'item_optic_module', name: 'Optic Module', value: 60,
    description: 'A pea-sized camera sensor on a flex ribbon, salvaged from a dead phone. The eye of any cam worth planting.' },
  { id: 'item_signal_board', name: 'Signal Board', value: 45,
    description: 'A scavenged transceiver board, traces green with corrosion but still humming. The brains and the voice.' },
  { id: 'item_micro_cell',   name: 'Micro Cell', value: 30,
    description: 'A slim rechargeable cell, the kind that keeps a bug alive for days. The heartbeat.' },
];

const RECIPES = [
  { id: 'recipe_spec_sticky_cam', name: 'Sticky Cam', out: 'item_sticky_cam', diff: 3, req: { electronics: 1 },
    ing: [['item_optic_module', 1], ['item_signal_board', 1], ['item_micro_cell', 1]] },
  { id: 'recipe_spec_motion_sensor', name: 'Motion Tripwire', out: 'item_motion_sensor', diff: 2, req: { electronics: 1 },
    ing: [['item_signal_board', 1], ['item_micro_cell', 1]] },
  { id: 'recipe_spec_audio_sensor', name: 'Audio Bug', out: 'item_audio_sensor', diff: 2, req: { electronics: 1 },
    ing: [['item_signal_board', 1], ['item_micro_cell', 1]] },
  { id: 'recipe_spec_relay', name: 'Relay Node', out: 'item_relay_node', diff: 4, req: { electronics: 2 },
    ing: [['item_signal_board', 2], ['item_micro_cell', 1]] },
  { id: 'recipe_spec_drone', name: 'Recon Drone', out: 'item_spy_drone', diff: 6, req: { electronics: 3 },
    ing: [['item_optic_module', 1], ['item_signal_board', 2], ['item_micro_cell', 2]] },
  { id: 'recipe_spec_spoofer', name: 'Feed Spoofer', out: 'item_feed_spoofer', diff: 6, req: { electronics: 4 },
    ing: [['item_optic_module', 1], ['item_signal_board', 2], ['item_micro_cell', 1]] },
];

for (const c of COMPONENTS) {
  await query(
    `INSERT INTO items (id, name, description, type, weight, value, rarity, is_stackable, tags)
     VALUES ($1,$2,$3,'component',150,$4,'common',1,$5)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, value=EXCLUDED.value`,
    [c.id, c.name, c.description, c.value, JSON.stringify({ component: true })]
  );
  console.log(`UPSERT component ${c.id}`);
}

for (const r of RECIPES) {
  await query(
    `INSERT INTO recipes (id, name, description, category, requires_station, skill_req, ingredients, base_output, skill_id, base_difficulty)
     VALUES ($1,$2,$3,'tech',NULL,$4,$5,$6,'electronics',$7)
     ON CONFLICT (id) DO UPDATE SET skill_req=EXCLUDED.skill_req, ingredients=EXCLUDED.ingredients,
       base_output=EXCLUDED.base_output, base_difficulty=EXCLUDED.base_difficulty`,
    [r.id, r.name, `Assemble a ${r.name} from salvaged parts.`,
     JSON.stringify(r.req),
     JSON.stringify(r.ing.map(([item_id, quantity]) => ({ item_id, quantity }))),
     JSON.stringify({ item_id: r.out, quantity: 1 }),
     r.diff]
  );
  console.log(`UPSERT recipe ${r.id}`);
}

// Add components to Glitch's stock if the vendor exists.
const { rows: glitch } = await query(`SELECT vendor_inventory FROM npcs WHERE id='npc_glitch'`);
if (glitch.length) {
  const inv = Array.isArray(glitch[0].vendor_inventory) ? glitch[0].vendor_inventory
            : JSON.parse(glitch[0].vendor_inventory || '[]');
  const have = new Set(inv.map(e => e.item_id));
  for (const c of COMPONENTS) if (!have.has(c.id)) inv.push({ item_id: c.id, price: c.value });
  await query(`UPDATE npcs SET vendor_inventory=$1 WHERE id='npc_glitch'`, [JSON.stringify(inv)]);
  console.log('UPDATE npc_glitch vendor stock (+components)');
}

const playerId = process.argv[2];
if (playerId) {
  const { rows } = await query('SELECT id FROM players WHERE id=$1', [playerId]);
  if (!rows.length) console.error(`No player "${playerId}" — skipped granting parts.`);
  else {
    for (const c of COMPONENTS) {
      await query(
        'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,5,1.0)',
        [randomUUID(), playerId, c.id]
      );
      console.log(`GRANT 5x ${c.id} -> ${playerId}`);
    }
  }
}

console.log('Done. Restart the server so recipes load into the craft cache.');
process.exit(0);
