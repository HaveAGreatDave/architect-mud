// One-shot content: stock the four cook reagents at open, legit vendors so the cook
// step is actually reachable.
//   Run once (after scripts/add-raw-supply.js creates the items):
//     node scripts/add-reagent-supply.js
//   Restart / world-reload after.
//
// The reagents (drain cleaner / industrial solvent / fuel cylinder / growth nutrient)
// are dual-use industrial goods, NOT contraband — sold over the counter at a general
// hardware store (Cassius Drum) and a wasteland tool-seller (Ma Cinder), so acquiring
// them isn't a tell that you cook. Buying raw is the crime; buying solvent isn't.
//
// (Deferred: also seeding these into a scavenging pool. The industrial scav keys fall
// back to the scavenging plugin's built-in pools rather than DB table rows, so a safe
// merge belongs in that plugin, not a content script that would replace the pool.)
import { query } from '../server/models/db.js';

const REAGENTS = ['item_reagent_acid', 'item_reagent_solvent', 'item_reagent_feedstock', 'item_reagent_nutrient'];
const VENDORS = ['npc_cassius_drum', 'npc_ma_cinder'];
const PRICE = 6; // small retail markup over the item value (3)

const asArr = (v) => Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })();

async function main() {
  // Confirm the items exist (add-raw-supply.js must have run).
  const { rows: have } = await query(`SELECT id FROM items WHERE id = ANY($1)`, [REAGENTS]);
  const present = new Set(have.map(r => r.id));
  const missing = REAGENTS.filter(id => !present.has(id));
  if (missing.length) console.warn(`⚠ reagent items missing (run add-raw-supply.js first): ${missing.join(', ')}`);

  let n = 0;
  for (const id of VENDORS) {
    const { rows } = await query('SELECT id, name, vendor_inventory, vendor_stock FROM npcs WHERE id=$1', [id]);
    if (!rows.length) { console.warn(`⚠ vendor ${id} not found — skipped`); continue; }
    const npc = rows[0];
    const inv = asArr(npc.vendor_inventory), shelf = asArr(npc.vendor_stock);
    for (const r of REAGENTS) {
      if (!inv.find(e => e.item_id === r)) inv.push({ item_id: r, price: PRICE });
      if (!shelf.find(e => e.item_id === r)) shelf.push({ item_id: r });
    }
    await query('UPDATE npcs SET vendor_inventory=$1, vendor_stock=$2 WHERE id=$3', [JSON.stringify(inv), JSON.stringify(shelf), id]);
    console.log(`  → stocked ${npc.name} (${id}) with the four reagents`);
    n++;
  }
  console.log(`✓ reagents stocked at ${n} vendor(s). Restart / reload the world.`);
  process.exit(0);
}
main().catch((e) => { console.error('✗ add-reagent-supply failed:', e.message); process.exit(1); });
