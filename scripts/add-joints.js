// One-shot content: add joints — a legal, non-addictive smokeable that mellows
// you out, gives you cotton-mouth, red eyes, the munchies, the giggles, and
// makes music sound impossibly good.
//   Run once:  node scripts/add-joints.js
//   Restart the server (or hit /world/reload) after — drugs are cached at boot.
//
// Deliberate, run-once (the sanctioned CLAUDE.md path). After this the content
// lives in the DB and is edited via the dev panel (Drugs editor). Idempotent:
// ON CONFLICT DO UPDATE, so re-running re-applies the latest definition.
//
// The stat side (relaxation, cotton-mouth, slowed reflexes) is plain content on
// the drug row; the behaviours that AREN'T stat deltas — the munchies, the
// giggles, the red eyes, and the echo-on-everything — are owned by the
// `cannabis` plugin, gated on flags.cannabis. Deliberately NOT flags.smokeable:
// that flag drives the cigarette plugin's appetite SUPPRESSION, which would
// fight the munchies. The `smoke` verb still works (it accepts any drug item).
import { query } from '../server/models/db.js';

const ITEM_ID = 'item_joint';
const DRUG_ID = 'drug_joint';
const NAME = 'joint';
const DESC = 'A hand-rolled joint, a little crooked, twisted off at the end. Smells like a greenhouse and bad decisions.';

const EFFECTS = {
  // A few draws and the world softens: calmer, but your mouth goes dry.
  instant: { sanity: 6, thirst: -10 },
  // Slow, long mellow: reflexes dulled while you're stoned. No cool bump — you
  // are not cool right now, you are on the floor thinking about crisps.
  phases: {
    comeup_seconds: 8, peak_seconds: 240, comedown_seconds: 60,
    comeup_scale: 0.5, comedown_scale: 0.4,
    peak_mods: { stat_reflexes: -1 },
    comeup_message: '<span class="msg-system">You spark it up and draw slow. The room exhales with you; the edges go soft and warm.</span>',
    peak_message: '<span class="msg-system">You are extremely stoned. Everything is faintly hilarious and the music is <em>unbelievable</em>.</span>',
    end_message: '<span class="msg-system">The high tapers off. The colours go back to normal and you are suddenly, urgently thinking about a sandwich.</span>',
  },
  // Non-addictive: no withdrawal block, addiction_chance 0.
  // You cannot fatally overdose — too much just greens you out: dizzy, paranoid,
  // nauseous. Non-lethal (no overdose.lethal), a burst of sanity/HP penalty.
  overdose: {
    mods: { sanity: -12, hp: -4 },
    message: 'You have smoked far too much. The room tilts, your heart hammers, and a cold wave of paranoid nausea rolls over you. You green out.',
  },
};

// legal: no police attention (like coffee/beer).
// cannabis: the hook the cannabis plugin keys off.
// high_seconds: how long the plugin's munchies/giggles/echo/red-eyes last.
const FLAGS = { legal: true, cannabis: true, high_seconds: 300 };

async function main() {
  await query(
    `INSERT INTO items (id, name, description, type, subtype, weight, value, is_stackable, tags)
     VALUES ($1,$2,$3,'consumable','drug',5,20,1,$4::jsonb)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       type=EXCLUDED.type, subtype=EXCLUDED.subtype, weight=EXCLUDED.weight,
       value=EXCLUDED.value, is_stackable=EXCLUDED.is_stackable, tags=EXCLUDED.tags`,
    [ITEM_ID, NAME, DESC, JSON.stringify({ drug: true })]
  );

  await query(
    `INSERT INTO drugs (id, name, description, item_id, duration_seconds, effects, addiction_chance, overdose_threshold, withdrawal_effects, flags)
     VALUES ($1,$2,$3,$4,300,$5::jsonb,0,5,'{}'::jsonb,$6::jsonb)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       item_id=EXCLUDED.item_id, duration_seconds=EXCLUDED.duration_seconds, effects=EXCLUDED.effects,
       addiction_chance=EXCLUDED.addiction_chance, overdose_threshold=EXCLUDED.overdose_threshold,
       flags=EXCLUDED.flags`,
    [DRUG_ID, NAME, DESC, ITEM_ID, JSON.stringify(EFFECTS), JSON.stringify(FLAGS)]
  );

  console.log(`✓ ${NAME} added (${DRUG_ID} + ${ITEM_ID}).`);
  console.log('Restart the server (or /world/reload) so the drug cache picks it up.');
  console.log('Then spawn it via the dev panel to place it in a vendor / on the ground.');
  process.exit(0);
}

main().catch((e) => { console.error('✗ add-joints failed:', e.message); process.exit(1); });
