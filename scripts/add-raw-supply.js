// One-shot content: the raw-drug supply chain (Phase 1).
//   Run once:  node scripts/add-raw-supply.js
//   Restart the server after — recipe/item caches load at boot.
//
// Makes every drug a two-input cook: RAW material + a per-family REAGENT → drug.
//   • 4 per-family reagents (acid=solids, solvent=wet, feedstock=gas, nutrient=botanical)
//   • one RAW item per drug, named by form (seeds / precursor / crude / feedstock / …),
//     flagged tags.raw_drug + contraband — carrying it (seen by a camera/cop) is the
//     new "Manufacturing a controlled substance" crime (server/engine/crimes.js).
//   • RESETS the chemistry cook recipes: one per drug = its raw + its family reagent.
// Idempotent (ON CONFLICT DO UPDATE; recipes fully regenerated each run).
// (Phase 2 will deliver raw via MULE crates to far hangars + a smuggle-into-city loop.)
import { query } from '../server/models/db.js';

const TIER_PRICE = [0, 15, 40, 90, 180, 350];
const COOK_FAMILY = { powder: 'solids', pill: 'solids', crystal: 'solids', liquid: 'wet', gel: 'wet', paste: 'wet', gas: 'gas', leaf: 'botanical', blotter: 'botanical' };
const FAMILY_REAGENT = { solids: 'item_reagent_acid', wet: 'item_reagent_solvent', gas: 'item_reagent_feedstock', botanical: 'item_reagent_nutrient' };
const REAGENTS = [
  { id: 'item_reagent_acid', name: 'concentrated acid', desc: 'A carboy of concentrated acid — the harsh half of a solids cook.' },
  { id: 'item_reagent_solvent', name: 'industrial solvent', desc: 'A jug of industrial solvent for wet cooks and cutting resins.' },
  { id: 'item_reagent_feedstock', name: 'pressurised feedstock', desc: 'A bottle of pressurised feedstock gas — the base of a gas cook.' },
  { id: 'item_reagent_nutrient', name: 'growth nutrient', desc: 'A sack of growth nutrient and curing salts for botanical cooks.' },
];
const REAGENT_NAME = Object.fromEntries(REAGENTS.map(r => [r.id, r.name]));
const RAW = {
  leaf: (n) => ({ name: `${n} seeds`, desc: `A pouch of viable ${n} seeds. Grow, dry and cure them into product.` }),
  blotter: (n) => ({ name: `${n} base + blank tabs`, desc: `A vial of ${n} base and a sheet of blank tabs to soak.` }),
  powder: (n) => ({ name: `${n} precursor`, desc: `A bag of ${n} precursor chemicals. Cut and refine into powder.` }),
  pill: (n) => ({ name: `${n} precursor powder`, desc: `${n} precursor powder, ready to press into tablets.` }),
  crystal: (n) => ({ name: `${n} precursor salt`, desc: `Coarse ${n} precursor salt, ready to recrystallise.` }),
  liquid: (n) => ({ name: `crude ${n}`, desc: `A jerrycan of crude ${n}. Titrate and stabilise into the finished liquid.` }),
  gel: (n) => ({ name: `${n} base gel`, desc: `Unset ${n} base gel. Work it down and set it.` }),
  paste: (n) => ({ name: `raw ${n} resin`, desc: `A sticky brick of raw ${n} resin. Cut it with solvent.` }),
  gas: (n) => ({ name: `${n} feedstock`, desc: `A cylinder of ${n} feedstock gas. Condense it under pressure.` }),
};
const asObj = (v) => (v && typeof v === 'object') ? v : (() => { try { return JSON.parse(v || '{}'); } catch { return {}; } })();
function deriveTier(effects, addiction) { const e = effects || {}; let s = 1; if (e.overdose?.lethal) s += 2; const mag = Object.values(e.instant || {}).reduce((a, v) => a + Math.abs(Number(v) || 0), 0); if (mag > 24) s += 1; if ((addiction || 0) >= 0.3) s += 1; if (e.hallucination) s += 1; return Math.max(1, Math.min(5, s)); }

async function upsertItem(id, name, desc, type, subtype, weight, value, tags, flags) {
  await query(
    `INSERT INTO items (id,name,description,type,subtype,weight,value,is_stackable,tags,flags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8::jsonb,$9::jsonb)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, type=EXCLUDED.type, subtype=EXCLUDED.subtype,
       weight=EXCLUDED.weight, value=EXCLUDED.value, is_stackable=EXCLUDED.is_stackable, tags=EXCLUDED.tags, flags=EXCLUDED.flags`,
    [id, name, desc, type, subtype, weight, value, JSON.stringify(tags || {}), JSON.stringify(flags || {})]
  );
}

async function main() {
  for (const r of REAGENTS) await upsertItem(r.id, r.name, r.desc, 'chemical', 'reagent', 30, 8, { reagent: true }, {});
  console.log(`✓ ${REAGENTS.length} per-family reagents.`);

  await query("DELETE FROM recipes WHERE skill_id='chemistry'"); // reset the cook set — one recipe per drug follows
  const { rows: drugs } = await query('SELECT id,name,item_id,effects,addiction_chance,flags FROM drugs');
  let n = 0;
  for (const d of drugs) {
    if (d.id === 'drug_compound' || !d.item_id) continue;
    const flags = asObj(d.flags), effects = asObj(d.effects);
    const form = flags.form || 'liquid', family = COOK_FAMILY[form] || 'wet', reagent = FAMILY_REAGENT[family];
    const set = Number(flags.cook_tier); const tier = (set >= 1 && set <= 5) ? Math.round(set) : deriveTier(effects, d.addiction_chance);
    const key = d.id.replace(/^drug_/, ''), rawId = 'item_raw_' + key;
    const spec = (RAW[form] || RAW.liquid)(d.name);
    await upsertItem(rawId, spec.name, spec.desc + ' Raw material — contraband; carrying it is manufacturing.', 'chemical', 'raw', 2, Math.max(2, Math.round(TIER_PRICE[tier] * 0.35)), { raw_drug: true, contraband: true }, { raw_of: d.id, cook_tier: tier });
    await query(
      `INSERT INTO recipes (id,name,description,category,requires_station,skill_req,ingredients,base_output,skill_id,base_difficulty)
       VALUES ($1,$2,$3,'synthesis','chem_lab',$4::jsonb,$5::jsonb,$6::jsonb,'chemistry',$7)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category, requires_station=EXCLUDED.requires_station,
         skill_req=EXCLUDED.skill_req, ingredients=EXCLUDED.ingredients, base_output=EXCLUDED.base_output, skill_id=EXCLUDED.skill_id, base_difficulty=EXCLUDED.base_difficulty`,
      ['cook_' + key, 'Cook ' + d.name, `Cook ${d.name} from ${spec.name} + ${REAGENT_NAME[reagent]}.`,
        JSON.stringify({ chemistry: Math.max(0, tier - 2) }), JSON.stringify([{ item_id: rawId, quantity: 1 }, { item_id: reagent, quantity: 1 }]),
        JSON.stringify({ item_id: d.item_id, quantity: 1 }), 2 + tier * 2]
    );
    console.log(`  ${d.name}: ${spec.name} (t${tier}) + ${REAGENT_NAME[reagent]} → ${d.item_id}`);
    n++;
  }
  console.log(`✓ ${n} drugs now cook from raw + reagent (chemistry recipes reset).`);
  console.log('Restart the server so recipe/item caches load. Spawn reagents + raw via the dev panel to test (Phase 2 adds delivery).');
  process.exit(0);
}
main().catch((e) => { console.error('✗ add-raw-supply failed:', e.message); process.exit(1); });
