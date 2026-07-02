// One-shot seed for drug synthesis: reagent items, a cook kit, a chem-lab
// station, and chemistry recipes that cook into the existing drug items.
//
//   node server/models/temp/seed-synthesis.js          # seed if absent
//   node server/models/temp/seed-synthesis.js --force    # delete + reseed
//
// Depends on seed-drugs.js (recipe outputs are the drug items it created, e.g.
// item_redline). Requires `npm run db:schema` (chemistry skill is in code) and a
// server restart (loadRecipes on boot / dev-panel publish refreshes the cache).
//
// Output potency is NOT fixed here — the synthesis plugin bakes a potency
// multiplier into each cooked batch from the chemistry check + minigame score,
// and useDrug scales the drug's effects by it. A great cook = a stronger drug
// (and higher overdose risk). Cook at the chem lab (bonus) or with the cook kit
// anywhere (penalty). Reagents/kit are created here but NOT placed in loot/
// vendors — distribute them via the dev panel or a scavenging table to test.

import 'dotenv/config';
import { query, getClient } from '../db.js';

// ── Reagent + tool items ─────────────────────────────────────────────────────
const ITEMS = [
  { id: 'item_precursor_stim',   name: 'Stimulant Precursor',   desc: 'A jar of volatile crystalline precursor. Cook feedstock for uppers.', value: 70,  tags: { reagent: true } },
  { id: 'item_precursor_opioid', name: 'Opioid Base Paste',     desc: 'A tar-dark paste that smells of poppies and industrial solvent.',    value: 90,  tags: { reagent: true } },
  { id: 'item_reagent_psycho',   name: 'Psychoactive Extract',  desc: 'A vial of oily extract that shifts colour when you are not looking.',  value: 110, tags: { reagent: true } },
  { id: 'item_solvent',          name: 'Reagent Solvent',       desc: 'Generic cutting solvent. Cheap, nasty, essential.',                    value: 25,  tags: { reagent: true } },
  { id: 'item_catalyst',        name: 'Reaction Catalyst',      desc: 'A sealed ampoule of catalyst. Makes the hard cooks possible.',         value: 140, tags: { reagent: true } },
  { id: 'item_stabilizer',      name: 'Compound Stabilizer',    desc: 'A vial of molecular stabilizer — the only thing that keeps a spliced compound from tearing itself apart.', value: 220, tags: { reagent: true } },
  { id: 'item_cook_kit',         name: 'Portable Cook Kit',     desc: 'A battered case of glassware, burners, and stained tubing. Lets you cook rough anywhere — badly.', value: 300, tags: { cook_kit: true, unique: true } },
];

// ── Recipes (skill_id chemistry → routed through the synthesis plugin) ────────
// base_output.item_id is an existing drug item from seed-drugs.js.
const RECIPES = [
  { id: 'synth_redline',   name: 'Cook Redline',            desc: 'A fast, dirty stimulant cook. Entry-level chemistry.',
    diff: 5, req: { chemistry: 1 }, ingredients: [['item_precursor_stim', 2], ['item_solvent', 1]], out: ['item_redline', 1] },
  { id: 'synth_grey',      name: 'Cook Grey',               desc: 'Rendering opioid base into a usable dose.',
    diff: 5, req: { chemistry: 1 }, ingredients: [['item_precursor_opioid', 2], ['item_solvent', 1]], out: ['item_grey', 1] },
  { id: 'synth_blotter',   name: 'Distill Blotter',         desc: 'Fixing psychoactive extract onto blotter. Delicate work.',
    diff: 6, req: { chemistry: 2 }, ingredients: [['item_reagent_psycho', 2], ['item_solvent', 1]], out: ['item_blotter', 1] },
  { id: 'synth_coldfire',  name: 'Cook Coldfire',           desc: 'A dangerous combat-stim synthesis. One slip and it runs away from you.',
    diff: 7, req: { chemistry: 3 }, ingredients: [['item_precursor_stim', 3], ['item_catalyst', 1], ['item_solvent', 1]], out: ['item_coldfire', 1] },
  { id: 'synth_blacktar',  name: 'Cook Blacktar',           desc: 'Deep, heavy opioid cook. Not for the squeamish or the shaky-handed.',
    diff: 7, req: { chemistry: 3 }, ingredients: [['item_precursor_opioid', 3], ['item_catalyst', 1]], out: ['item_blacktar', 1] },
  { id: 'synth_threshold', name: 'Synthesize the Threshold', desc: 'Vaporised dissociative synthesis at the edge of what a home lab can do.',
    diff: 9, req: { chemistry: 5 }, ingredients: [['item_reagent_psycho', 3], ['item_catalyst', 2]], out: ['item_threshold', 1] },
];

const force = process.argv.includes('--force');
const client = await getClient();

try {
  await client.query('BEGIN');

  if (force) {
    await client.query('DELETE FROM items WHERE id = ANY($1)', [[...ITEMS.map(i => i.id), 'item_compound']]);
    await client.query('DELETE FROM recipes WHERE id = ANY($1)', [RECIPES.map(r => r.id)]);
    await client.query("DELETE FROM drugs WHERE id = 'drug_compound'");
    await client.query("DELETE FROM furniture WHERE id = 'furn_chem_lab'");
  }

  for (const it of ITEMS) {
    await client.query(
      `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, tags)
       VALUES ($1,$2,$3,'chemical','reagent',30,$4,$5,$6::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [it.id, it.name, it.desc, it.value, it.tags.cook_kit ? 0 : 1, JSON.stringify(it.tags)]
    );
  }

  // Carrier item + placeholder drug row for SPLICED compounds. The real,
  // per-batch composed effects ride on each inventory row's custom_data (an
  // inline drug that useDrug reads directly); this pair just lets the
  // item→drug join in cmdUse resolve. Non-stackable so batches never merge.
  await client.query(
    `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, tags)
     VALUES ('item_compound','hand-mixed compound','A hand-mixed compound in an unlabelled vial. Whatever it does, only its maker knows.','drug','compound',15,200,0,'{"drug":true}'::jsonb)
     ON CONFLICT (id) DO NOTHING`
  );
  await client.query(
    `INSERT INTO drugs (id, name, description, item_id, duration_seconds, effects, addiction_chance, overdose_threshold, withdrawal_effects, flags)
     VALUES ('drug_compound','hand-mixed compound','A spliced compound. Effects vary batch to batch.','item_compound',300,'{}'::jsonb,0,3,'{}'::jsonb,'{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`
  );

  for (const r of RECIPES) {
    await client.query(
      `INSERT INTO recipes (id, name, description, category, requires_station, skill_req, ingredients, base_output, skill_id, base_difficulty)
       VALUES ($1,$2,$3,'synthesis','chem_lab',$4::jsonb,$5::jsonb,$6::jsonb,'chemistry',$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        r.id, r.name, r.desc,
        JSON.stringify(r.req),
        JSON.stringify(r.ingredients.map(([item_id, quantity]) => ({ item_id, quantity }))),
        JSON.stringify({ item_id: r.out[0], quantity: r.out[1] }),
        r.diff,
      ]
    );
  }

  // Place a chem lab. Prefer an interior/back/industrial zone; fall back to any overworld zone.
  const { rows: zoneRows } = await client.query(
    `SELECT id FROM zones
     WHERE (name ILIKE ANY('{%lab%,%apartment%,%industrial%,%back%,%workshop%,%warehouse%,%safe%}')
            OR description ILIKE '%workshop%' OR description ILIKE '%lab%')
     ORDER BY random() LIMIT 1`
  );
  let labZone = zoneRows[0]?.id;
  if (!labZone) {
    const fb = await client.query(`SELECT id FROM zones WHERE map_id IS NULL OR map_id='map_world' ORDER BY random() LIMIT 1`);
    labZone = fb.rows[0]?.id;
  }
  if (labZone) {
    await client.query(
      `INSERT INTO furniture (id, zone_id, name, description, flags, object_type)
       VALUES ('furn_chem_lab',$1,'chem lab','A scavenged chemistry bench — ring stands, a fume hood that half works, reagent bottles labelled in three languages and a skull. Smells like ambition and poison.',$2::jsonb,'appliance')
       ON CONFLICT (id) DO NOTHING`,
      [labZone, JSON.stringify({ crafting_station: 'chem_lab', station_quality: 'refined' })]
    );
  }

  await client.query('COMMIT');
  console.log(`✓ Seeded ${ITEMS.length} reagent/tool items (incl. Stabilizer), the spliced-compound carrier, and ${RECIPES.length} chemistry recipes.`);
  console.log(`  Chem lab placed in zone: ${labZone || '(none found — create furniture flags.crafting_station=chem_lab manually)'}`);
  console.log('  Reagents + cook kit are NOT distributed — hand them out via the dev panel or a scavenging table to test.');
  console.log('  Restart the server so recipes load into the cache.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('✗ seed failed:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  process.exit();
}
