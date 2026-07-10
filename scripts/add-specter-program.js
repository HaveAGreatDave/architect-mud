// One-shot: add the purchasable SPECTER install program (the "hack deck").
//   node scripts/add-specter-program.js            (local)
//   node --env-file=.env.prod scripts/add-specter-program.js   (prod)
//
// The program is a consumable item tagged `specter_program`: buy it, `use` it,
// and it flashes SPECTER onto your tablet (player flag specter_installed) then
// destroys itself (see plugins/surveillance/index.js doInstallSpecter). The
// tablet Surveillance app gates on that flag instead of a carried spy_deck.
//
// Stocked at Glitch's black-market rack (npc_glitch) alongside the rest of the
// SPECTER gear. Idempotent — re-running upserts the item and de-dupes the rack row.
import { query } from '../server/models/db.js';

const ITEM_ID = 'item_specter_program';
const NPC_ID = 'npc_glitch';
const PRICE = 1500;

await query(
  `INSERT INTO items (id, name, description, type, weight, value, tags)
   VALUES ($1,$2,$3,'device',$4,$5,$6)
   ON CONFLICT (id) DO UPDATE SET
     name=EXCLUDED.name, description=EXCLUDED.description, weight=EXCLUDED.weight,
     value=EXCLUDED.value, tags=EXCLUDED.tags`,
  [ITEM_ID, 'SPECTER Install Chip',
   "A slab of black storage glass etched with a spider-web sigil. A single-use flasher — jack it into your tablet and it burns the SPECTER surveillance suite onto the OS, then cooks itself into dead plastic. One chip, one install.",
   100, PRICE, JSON.stringify({ specter_program: true })]
);
console.log(`UPSERT item ${ITEM_ID}`);

const { rows } = await query('SELECT vendor_inventory FROM npcs WHERE id=$1', [NPC_ID]);
if (!rows.length) {
  console.log(`NOTE  ${NPC_ID} not found — run scripts/seed-surveillance-vendor.js first, or stock ${ITEM_ID} on whichever vendor should sell it.`);
} else {
  let inv = rows[0].vendor_inventory;
  inv = Array.isArray(inv) ? inv : (() => { try { return JSON.parse(inv || '[]'); } catch { return []; } })();
  inv = inv.filter(e => e && e.item_id !== ITEM_ID);          // de-dupe on re-run
  inv.push({ item_id: ITEM_ID, price: PRICE });
  await query('UPDATE npcs SET vendor_inventory=$1 WHERE id=$2', [JSON.stringify(inv), NPC_ID]);
  console.log(`STOCK ${ITEM_ID} @ ${PRICE} on ${NPC_ID} (Glitch)`);
}

console.log('Done.');
process.exit(0);
