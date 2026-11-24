// Read-only. Lists every food item a vendor sells, by vendor, so the pantry
// cut (docs/proposals/cooking-basics.md, phase 1) can be reviewed before
// anything moves. Writes nothing.
//
//   node scripts/content/pantry-survey.mjs          table by vendor
//   node scripts/content/pantry-survey.mjs --json   machine-readable
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../content');
const readDir = (d) => fs.readdirSync(path.join(root, d))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(root, d, f), 'utf8')));

export function isFood(it) {
  const t = it?.tags || {};
  return !!(t.food_profile || t.restore_hunger || t.needs_cooking || t.food_noun);
}

export function survey() {
  const items = new Map(readDir('items').map((i) => [i.id, i]));
  const vendors = [];
  for (const n of readDir('npcs')) {
    const inv = n.vendor_inventory || [];
    const food = inv.map((e) => e?.item_id).filter((id) => isFood(items.get(id)));
    if (food.length) vendors.push({ id: n.id, shop: n.vendor_shop_name || n.name, food });
  }
  return { items, vendors };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('pantry-survey.mjs')) {
  const { items, vendors } = survey();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(vendors, null, 2));
  } else {
    for (const v of vendors) {
      console.log(`${v.shop} (${v.id}): ${v.food.length}`);
      console.log('  ' + v.food.map((id) => items.get(id)?.name || id).join(', '));
    }
  }
}
