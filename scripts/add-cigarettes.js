// One-shot content: add cigarettes — a legal, highly addictive smokeable drug.
//   Run once:  node scripts/add-cigarettes.js
//   Restart the server (or hit /world/reload) after — drugs are cached at boot.
//
// Deliberate, run-once (the sanctioned CLAUDE.md path). After this the content
// lives in the DB and is edited via the dev panel (Drugs editor). Idempotent:
// ON CONFLICT DO UPDATE, so re-running re-applies the latest definition.
//
// The stat side (Cool up, Stamina down while lit) is plain phases.peak_mods; the
// three behaviours that aren't stat deltas — appetite suppression, hacking cough,
// onlooker cool-reactions — are owned by the `smoking` plugin, gated on the
// flags below (flags.smokeable + flags.appetite_suppress_seconds).
import { query } from '../server/models/db.js';

const ITEM_ID = 'item_cigarettes';
const DRUG_ID = 'drug_cigarettes';
const ITEM_NAME = 'pack of cigarettes';
const DRUG_NAME = 'a cigarette';   // what the "You take …" line reads
const DESC = 'You slide one from the soft pack of cheap cigarettes and light it. Each one shaves a little off your lungs and hands it to your image. Ten to a pack.';
const PACK_SIZE = 10;   // cigarettes per pack; the pack item is destroyed on the last one (see cmdUse)

const EFFECTS = {
  // A drag settles the nerves a touch.
  instant: { sanity: 3 },
  // Short, sharp: Cool up, Stamina capped down while the cigarette burns.
  phases: {
    comeup_seconds: 4, peak_seconds: 90, comedown_seconds: 40,
    comeup_scale: 0.6, comedown_scale: 0.5,
    peak_mods: { stat_cool: 2, stamina_max: -15 },
    comeup_message: '<span class="msg-system">You light up and draw deep. Your shoulders drop; the edge comes off your hunger.</span>',
    peak_message: '<span class="msg-system">Nicotine hums through you. You feel, briefly, extremely cool and very slightly winded.</span>',
    end_message: '<span class="msg-system">The cigarette burns down to the filter. The cool fades with the last of the smoke; the craving lingers.</span>',
  },
  tolerance: { gain_per_dose: 0.1, max_reduction: 0.5 },
  // Highly addictive (addiction_chance 0.4 → hooked after ~2). Withdrawal bites soon.
  withdrawal: {
    onset_seconds: 600,
    mods: { stat_cool: -2, stamina_max: -10 },
    message: 'Your hands are restless and your mood is fraying. You would kill for a cigarette.',
  },
  // Chain-smoking makes you sick, not dead — non-lethal nausea at a high threshold.
  overdose: { mods: { sanity: -8, hp: -5 } },
};

const FLAGS = { legal: true, smokeable: true, appetite_suppress_seconds: 900 };

async function main() {
  await query(
    `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, tags)
     VALUES ($1,$2,$3,'consumable','drug',20,15,0,$4::jsonb)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       type=EXCLUDED.type, subtype=EXCLUDED.subtype, weight=EXCLUDED.weight,
       value=EXCLUDED.value, is_stackable=EXCLUDED.is_stackable, tags=EXCLUDED.tags`,
    [ITEM_ID, ITEM_NAME, DESC, JSON.stringify({ drug: true, pack_size: PACK_SIZE })]
  );

  await query(
    `INSERT INTO drugs (id, name, description, item_id, duration_seconds, effects, addiction_chance, overdose_threshold, withdrawal_effects, flags)
     VALUES ($1,$2,$3,$4,300,$5::jsonb,0.4,12,'{}'::jsonb,$6::jsonb)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       item_id=EXCLUDED.item_id, duration_seconds=EXCLUDED.duration_seconds, effects=EXCLUDED.effects,
       addiction_chance=EXCLUDED.addiction_chance, overdose_threshold=EXCLUDED.overdose_threshold,
       flags=EXCLUDED.flags`,
    [DRUG_ID, DRUG_NAME, DESC, ITEM_ID, JSON.stringify(EFFECTS), JSON.stringify(FLAGS)]
  );

  console.log(`✓ ${ITEM_NAME} added (${DRUG_ID} + ${ITEM_ID}).`);
  console.log('Restart the server (or /world/reload) so the drug cache picks it up.');
  console.log('Then spawn it via the dev panel to place it in a vendor / on the ground.');
  process.exit(0);
}

main().catch((e) => { console.error('✗ add-cigarettes failed:', e.message); process.exit(1); });
