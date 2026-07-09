// One-shot: generalize alcohol. Renames the `drug_beer` drug → `drug_alcohol`
// ("alcohol") — the single shared alcohol drug that every served drink applies —
// and laces the bar-drink consumables (rust whiskey, embassy reserve, glow
// cocktail) with it via the general `tags.laced_drug` mechanism, at per-drink
// strength (`tags.laced_potency`). Beer stays the plain drug delivery of alcohol;
// the fancier drinks keep their own restores and add the shared intoxication on
// top (meter → slur/stumble/blackout + band stat impairment, shared tolerance +
// alcohol-poisoning OD). `laced_drug` is general — any consumable can carry any
// drug, so non-alcohol drugged drinks/food are now possible too.
//
//   Run once:  node scripts/rework-alcohol.mjs
//   Restart / /world reload after — drugs + items are cached at boot.
// Patches BOTH content/*.json (git source) and the live DB. Idempotent.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../server/models/db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(ROOT, ...a);

// The shared alcohol drug (was drug_beer). Beer's baseline bodily effect lives in
// its instant block (used when beer is drunk directly); laced drinks skip that and
// supply their own restores. flags.alcoholic + intox_per_dose feed the meter.
const ALCOHOL = {
  id: 'drug_alcohol',
  name: 'alcohol',
  description: 'Ethanol, in whatever form it reaches you. Loosens you up, blurs the edges, then quietly takes your legs and the lights with them.',
  item_id: 'item_drug_beer',
  duration_seconds: 240,
  effects: {
    diuretic: 2,
    onset_seconds: 0,
    instant: { hunger: 3, sanity: 3, thirst: 12 },
    overdose: { lethal: true, message: "You've had far too much, far too fast. The room spins hard, your stomach heaves, and then everything just… stops. Alcohol poisoning." },
  },
  addiction_chance: 0,
  overdose_threshold: 8,
  withdrawal_effects: {},
  flags: { alcoholic: true, intox_per_dose: 22, legal: true },
};

// item_id -> alcohol strength (multiplier on intox_per_dose 22)
const LACED = {
  item_drink_rust_whiskey:   1.6,   // ~35 — strong spirit
  item_drink_embassy_reserve: 1.3,  // ~29 — aged cocktail
  item_drink_glow_cocktail:  1.1,   // ~24 — mild (and mildly radioactive)
};

async function main() {
  // 1) rename the drug in git source: drug_beer.json -> drug_alcohol.json
  const oldFile = p('content', 'drugs', 'drug_beer.json');
  const newFile = p('content', 'drugs', 'drug_alcohol.json');
  writeFileSync(newFile, JSON.stringify(ALCOHOL, null, 2) + '\n');
  if (existsSync(oldFile)) unlinkSync(oldFile);
  console.log('  content: drug_beer.json → drug_alcohol.json');

  // 1b) DB: replace drug_beer row with drug_alcohol (PK swap; no FK, no content
  //     references — player_drug_state is runtime and re-keys itself on next use).
  await query('DELETE FROM drugs WHERE id=$1', ['drug_beer']);
  await query('DELETE FROM drugs WHERE id=$1', ['drug_alcohol']);
  await query(
    `INSERT INTO drugs (id, name, description, item_id, duration_seconds, effects, addiction_chance, overdose_threshold, withdrawal_effects, flags)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb)`,
    [ALCOHOL.id, ALCOHOL.name, ALCOHOL.description, ALCOHOL.item_id, ALCOHOL.duration_seconds,
     JSON.stringify(ALCOHOL.effects), ALCOHOL.addiction_chance, ALCOHOL.overdose_threshold,
     JSON.stringify(ALCOHOL.withdrawal_effects), JSON.stringify(ALCOHOL.flags)]
  );
  console.log('  DB: drugs row drug_beer → drug_alcohol');

  // 2) lace the bar drinks — content + DB
  for (const [itemId, potency] of Object.entries(LACED)) {
    const file = p('content', 'items', `${itemId}.json`);
    try {
      const it = JSON.parse(readFileSync(file, 'utf8'));
      it.tags = it.tags || {};
      it.tags.laced_drug = 'drug_alcohol';
      it.tags.laced_potency = potency;
      writeFileSync(file, JSON.stringify(it, null, 2) + '\n');
    } catch (e) { console.warn(`  ! ${itemId}: ${e.message}`); }

    const r = await query(
      `UPDATE items SET tags = COALESCE(tags,'{}'::jsonb) || jsonb_build_object('laced_drug','drug_alcohol','laced_potency',$1::real) WHERE id=$2`,
      [potency, itemId]
    );
    console.log(`  laced ${potency}×  ${itemId}${r.rowCount ? '' : '  (not in DB)'}`);
  }

  console.log('\nDone. Restart / /world reload to load. (add-drug-onset.mjs INSTANT list references updated separately.)');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
