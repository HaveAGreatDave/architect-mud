// One-shot content: loose cannabis + loose tobacco — leaf-form drugs, sold by
// the gram (quantity = grams). Raw, they do almost nothing; you ROLL them into
// joints / cigarettes (1 gram → 1, via the `rolling` plugin). They're also
// leaf-form on the splice bench (flags.form='leaf').
//   Run once:  node scripts/add-loose-leaf.js
//   Restart the server (or /world/reload) after — drugs are cached at boot.
//
// Deliberate, run-once (the sanctioned CLAUDE.md path). Idempotent (ON CONFLICT
// DO UPDATE). Deliberately NOT flags.cannabis (that's the joint's stoned layer)
// and NOT flags.smokeable — loose leaf is raw material, not a lit smoke.
import { query } from '../server/models/db.js';

const LEAVES = [
  {
    itemId: 'item_loose_cannabis', drugId: 'drug_loose_cannabis',
    itemName: 'loose cannabis', drugName: 'loose cannabis',
    desc: 'A gram of dried, sticky cannabis flower in a little baggie. Useless as-is — roll it into a joint.',
    weight: 1, value: 10,
    effects: { instant: { hunger: -3 } },
    flags: { legal: true, form: 'leaf', sub: 'dried', color: '#5a8a3a' },
  },
  {
    itemId: 'item_loose_tobacco', drugId: 'drug_loose_tobacco',
    itemName: 'loose tobacco', drugName: 'loose tobacco',
    desc: 'A gram of shredded cured tobacco in a pouch. Roll it into a cigarette — or chew it, if you must.',
    weight: 1, value: 8,
    effects: { instant: { sanity: 1 } },
    flags: { legal: true, form: 'leaf', sub: 'dried', color: '#8a6a3a' },
  },
];

// Stock the loose leaf with whatever vendor already sells joints/cigarettes
// (Sully). Robust: no hardcoded NPC id — we target vendors whose catalogue holds
// item_joint or item_cigarettes, and add to both the catalogue (priced) and the
// active shelf (buyable now). Idempotent.
async function stockVendors() {
  const { rows } = await query('SELECT id, name, vendor_inventory, vendor_stock FROM npcs WHERE vendor_inventory IS NOT NULL');
  const asArr = (v) => Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })();
  let n = 0;
  for (const npc of rows) {
    const inv = asArr(npc.vendor_inventory);
    if (!inv.some(e => e.item_id === 'item_joint' || e.item_id === 'item_cigarettes')) continue;
    const shelf = asArr(npc.vendor_stock);
    for (const L of LEAVES) {
      if (!inv.find(e => e.item_id === L.itemId)) inv.push({ item_id: L.itemId, price: L.value });
      if (!shelf.find(e => e.item_id === L.itemId)) shelf.push({ item_id: L.itemId });
    }
    await query('UPDATE npcs SET vendor_inventory=$1, vendor_stock=$2 WHERE id=$3', [JSON.stringify(inv), JSON.stringify(shelf), npc.id]);
    console.log(`  → stocked ${npc.name} (${npc.id}) with loose cannabis + tobacco`);
    n++;
  }
  if (!n) console.log('  (no vendor currently sells joints/cigarettes — spawn loose leaf via the dev panel instead)');
  return n;
}

async function main() {
  for (const L of LEAVES) {
    await query(
      `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, tags)
       VALUES ($1,$2,$3,'consumable','drug',$4,$5,1,$6::jsonb)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
         type=EXCLUDED.type, subtype=EXCLUDED.subtype, weight=EXCLUDED.weight,
         value=EXCLUDED.value, is_stackable=EXCLUDED.is_stackable, tags=EXCLUDED.tags`,
      [L.itemId, L.itemName, L.desc, L.weight, L.value, JSON.stringify({ drug: true })]
    );
    await query(
      `INSERT INTO drugs (id, name, description, item_id, duration_seconds, effects, addiction_chance, overdose_threshold, withdrawal_effects, flags)
       VALUES ($1,$2,$3,$4,60,$5::jsonb,0,5,'{}'::jsonb,$6::jsonb)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
         item_id=EXCLUDED.item_id, duration_seconds=EXCLUDED.duration_seconds, effects=EXCLUDED.effects,
         addiction_chance=EXCLUDED.addiction_chance, overdose_threshold=EXCLUDED.overdose_threshold, flags=EXCLUDED.flags`,
      [L.drugId, L.drugName, L.desc, L.itemId, JSON.stringify(L.effects), JSON.stringify(L.flags)]
    );
    console.log(`✓ ${L.itemName} added (${L.drugId} + ${L.itemId}).`);
  }
  await stockVendors();
  console.log('Restart the server (or /world/reload) so the drug cache + vendor shelves pick these up.');
  console.log('Buy loose leaf by the gram, then `roll` it into joints/cigarettes.');
  process.exit(0);
}

main().catch((e) => { console.error('✗ add-loose-leaf failed:', e.message); process.exit(1); });
