// One-shot migration: collapse the old 1–5 layer model to the three-layer model
// (underwear/outerwear/armor) and drop the retired `allowed_layer_range` tag.
//
// SCHEMA_SQL already adds player_inventory.equipped_at; run `npm run db:schema`
// first (or let this script rely on it being applied). Then run once against
// production: node scripts/migrate-gear-layers.js
//
// What it does:
//  1. items: for every body-slot piece (head/torso/hands/legs/feet), set a `layer`
//     tag — `armor` if the piece already has `armor` or `armor_soak`, else
//     `outerwear`. Removes `allowed_layer_range` from every item.
//  2. player_inventory: remap equipped body-slot rows to the new integer layer
//     (underwear=1, outerwear=2, armor=3) from the item's freshly-set tag; assign
//     equipped accessories sequential indices 1..N and stamp equipped_at.
import { query } from '../server/models/db.js';

const BODY_SLOTS = ['head', 'torso', 'hands', 'legs', 'feet'];
const LAYERS = { underwear: 1, outerwear: 2, armor: 3 };

// 1a. Tag body-slot items with a layer.
const { rows: items } = await query(`SELECT id, tags FROM items WHERE tags ? 'slot'`);
let tagged = 0;
for (const it of items) {
  const t = it.tags || {};
  const slot = t.slot;
  let changed = false;
  if (BODY_SLOTS.includes(slot) && !t.layer) {
    t.layer = (t.armor != null || t.armor_soak) ? 'armor' : 'outerwear';
    changed = true;
  }
  if ('allowed_layer_range' in t) { delete t.allowed_layer_range; changed = true; }
  if (changed) {
    await query(`UPDATE items SET tags=$1 WHERE id=$2`, [JSON.stringify(t), it.id]);
    tagged++;
  }
}
console.log(`items: updated ${tagged} of ${items.length} slot items`);

// 1b. Strip allowed_layer_range from any remaining items that carry it.
const stripped = await query(`UPDATE items SET tags = tags - 'allowed_layer_range' WHERE tags ? 'allowed_layer_range'`);
console.log(`items: stripped allowed_layer_range from ${stripped.rowCount} more`);

// 2. Remap equipped inventory rows.
const { rows: worn } = await query(
  `SELECT pi.id, pi.player_id, i.tags FROM player_inventory pi JOIN items i ON i.id=pi.item_id
   WHERE pi.is_equipped=1`
);
const accByPlayer = {};
let bodyRemapped = 0;
for (const row of worn) {
  const slot = row.tags?.slot;
  if (BODY_SLOTS.includes(slot)) {
    const layer = LAYERS[row.tags?.layer] || LAYERS.outerwear;
    await query(`UPDATE player_inventory SET layer=$1, equipped_at=COALESCE(equipped_at, now()) WHERE id=$2`, [layer, row.id]);
    bodyRemapped++;
  } else if (slot === 'weapon_hand') {
    await query(`UPDATE player_inventory SET layer=1, equipped_at=COALESCE(equipped_at, now()) WHERE id=$1`, [row.id]);
  } else if (slot === 'accessory') {
    (accByPlayer[row.player_id] ||= []).push(row.id);
  }
}
let accRemapped = 0;
for (const [, ids] of Object.entries(accByPlayer)) {
  for (let i = 0; i < ids.length; i++) {
    await query(`UPDATE player_inventory SET layer=$1, equipped_at=now() WHERE id=$2`, [i + 1, ids[i]]);
    accRemapped++;
  }
}
console.log(`player_inventory: remapped ${bodyRemapped} body-slot + ${accRemapped} accessory equipped rows`);

process.exit(0);
