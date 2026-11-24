// WRITES content. Phase 1 of docs/proposals/cooking-basics.md: the pantry cut.
//
//   node scripts/content/pantry-cut.mjs           print what it would change
//   node scripts/content/pantry-cut.mjs --write   change the files
//
// It does three things, and it's safe to run again:
//   1. Tags every pantry item with `tags.aisle`.
//   2. Tags every other raw cooking ingredient `tags.shelved: true`. Nothing is
//      deleted: held copies still cook and eat, loot tables still name them,
//      and taking the tag off brings an item back.
//   3. Takes shelved items out of every vendor's stock and puts the pantry on
//      a grocer (Bodega Vu) and the butcher (Meat Your Maker).
//
// Fish are left alone (fishing catches them, and the fishmonger buys them), as
// are drinks, water and prepared food, which restaurants and stadiums still sell.
// Then run `npm run content:import`.
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

export const PANTRY = {
  dairy: ['item_ration_milk', 'item_butter_analog', 'item_vat_cheese', 'item_battery_egg'],
  meat: ['item_raw_meat', 'item_battery_chicken', 'item_pork_shoulder'],
  bakery: ['item_grey_loaf', 'item_flat_bread'],
  staples: ['item_beef_jerky', 'item_soylent', 'item_soylent_ember', 'item_soylent_citrus', 'item_soylent_family',
    'item_soylent_marrow', 'item_soylent_verdant', 'item_soylent_birthday', 'item_soylent_clinical', 'item_soylent_manyhappy'],
  seasoning: ['item_salt_ration', 'item_black_pepper'],
};

// Liquids that are drinks or water stay; these are the cooking ones.
const COOKING_LIQUIDS = new Set(['item_soup_base', 'item_fish_stock', 'item_bone_broth', 'item_tomato_paste',
  'item_tinned_tomatoes', 'item_synth_cream', 'item_vinegar']);
const ALSO_SHELVE = new Set(['item_cream_pot']);
// Not food: the smoker's fuel.
const NOT_FOOD = new Set(['item_wood_chips']);

// Where the pantry is sold, and at what.
const GROCER = 'npc_kessel_grocer';
const BUTCHER = 'npc_butcher_kroh';
const SELLS = {
  [GROCER]: [...PANTRY.dairy, ...PANTRY.bakery, ...PANTRY.staples, ...PANTRY.seasoning],
  [BUTCHER]: PANTRY.meat,
};

const write = process.argv.includes('--write');
const dir = (d) => path.join(CONTENT_DIR, d);
const load = (d) => fs.readdirSync(dir(d)).filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: path.join(dir(d), f), row: JSON.parse(fs.readFileSync(path.join(dir(d), f), 'utf8')) }));
const save = (file, row) => { if (write) fs.writeFileSync(file, canonicalJson(row)); };

const aisleOf = new Map(Object.entries(PANTRY).flatMap(([a, ids]) => ids.map((id) => [id, a])));

function shouldShelve(item) {
  const t = item.tags || {};
  if (aisleOf.has(item.id) || t.raw_fish || NOT_FOOD.has(item.id)) return false;
  if (ALSO_SHELVE.has(item.id) || COOKING_LIQUIDS.has(item.id)) return true;
  return !!t.food_profile && t.food_profile !== 'liquid';
}

const items = load('items');
const byId = new Map(items.map((x) => [x.row.id, x.row]));
for (const id of aisleOf.keys()) if (!byId.has(id)) throw new Error(`pantry item ${id} has no file`);

const shelved = [], tagged = [];
for (const { file, row } of items) {
  const t = { ...(row.tags || {}) };
  let changed = false;
  if (aisleOf.has(row.id) && t.aisle !== aisleOf.get(row.id)) { t.aisle = aisleOf.get(row.id); changed = true; tagged.push(row.id); }
  if (aisleOf.has(row.id) && t.shelved) { delete t.shelved; changed = true; }
  if (shouldShelve(row) && !t.shelved) { t.shelved = true; changed = true; shelved.push(row.id); }
  if (changed) save(file, { ...row, tags: t });
}

const vendorChanges = [];
for (const { file, row } of load('npcs')) {
  const inv = row.vendor_inventory;
  if (!Array.isArray(inv) || (!inv.length && !SELLS[row.id])) continue;
  const isShelved = (id) => { const it = byId.get(id); return it && (it.tags?.shelved || shouldShelve(it)); };
  const kept = inv.filter((e) => !isShelved(e?.item_id));
  const dropped = inv.filter((e) => isShelved(e?.item_id)).map((e) => e.item_id);
  const added = [];
  for (const id of SELLS[row.id] || []) {
    if (kept.some((e) => e.item_id === id)) continue;
    kept.push({ item_id: id, price: Math.max(1, Math.round(Number(byId.get(id).value) || 1)) });
    added.push(id);
  }
  if (dropped.length || added.length) {
    vendorChanges.push({ id: row.id, dropped, added });
    save(file, { ...row, vendor_inventory: kept });
  }
}

console.log(`${write ? 'Changed' : 'Would change'}:`);
console.log(`  aisle tags: ${tagged.length}`);
console.log(`  shelved (${shelved.length}): ${shelved.join(', ')}`);
for (const v of vendorChanges) {
  console.log(`  ${v.id}: -[${v.dropped.join(', ')}] +[${v.added.join(', ')}]`);
}
if (!write) console.log('\nDry run. Add --write to change the files.');
