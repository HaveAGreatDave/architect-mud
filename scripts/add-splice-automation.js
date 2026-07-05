// One-shot content: create the six splice-automation rigs. Each carries a
// `tags.automates:<stage>` that the splice minigame reads — hold the rig and that
// stage auto-clears at a Chemistry-scaled score instead of being played by hand.
//
//   node scripts/add-splice-automation.js
//
// DELIBERATELY NOT PLACED: these items exist in the DB but aren't sold, looted, or
// dropped anywhere yet — decide how players earn them later. To TEST them without
// sourcing the items, flip the `splice_auto_test` tunable (combat_config) on, which
// force-automates every stage. Idempotent (ON CONFLICT DO UPDATE).
import { query } from '../server/models/db.js';

// stage keys are the minigame's INTERNAL keys ('charge' is the player-facing "Decant").
const RIGS = [
  { id: 'item_auto_decant', stage: 'charge', name: 'auto-decanter',       value: 900,  desc: 'A gimballed cradle-arm that carries and tips each reagent into the beaker with a machinist\'s steadiness. Automates the DECANT stage of a splice.' },
  { id: 'item_auto_mix',    stage: 'mix',    name: 'auto-mixer',          value: 850,  desc: 'A vortex head that shears every solid down to a clean liquid on its own. Automates the MIX stage of a splice.' },
  { id: 'item_auto_pour',   stage: 'pour',   name: 'auto-pour rig',       value: 1100, desc: 'A metering pump that hits each pour level dead-on, every time. Automates the POUR stage of a splice.' },
  { id: 'item_auto_stir',   stage: 'stir',   name: 'auto-stirrer',        value: 800,  desc: 'A magnetic stir plate that holds a perfect RPM band. Automates the STIR stage of a splice.' },
  { id: 'item_auto_heat',   stage: 'heat',   name: 'thermal regulator',   value: 1200, desc: 'A PID-controlled burner that pins the reaction in its thermal window. Automates the HEAT stage of a splice.' },
  { id: 'item_auto_rhythm', stage: 'rhythm', name: 'lattice sequencer',   value: 1400, desc: 'A phase-locked pulse driver that sets the compound\'s lattice on the beat, hands-free. Automates the SET (rhythm) stage of a splice.' },
];

async function main() {
  let n = 0;
  for (const r of RIGS) {
    await query(
      `INSERT INTO items (id, name, description, type, weight, value, tags)
       VALUES ($1,$2,$3,'device',2,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
         type=EXCLUDED.type, weight=EXCLUDED.weight, value=EXCLUDED.value, tags=EXCLUDED.tags`,
      [r.id, r.name, r.desc, r.value, JSON.stringify({ automates: r.stage, lab_upgrade: true })]
    );
    console.log(`  → ${r.name} (${r.id}) — automates:${r.stage}`);
    n++;
  }
  console.log(`✓ ${n} splice-automation rigs built (NOT placed — source them into the world when ready; or flip splice_auto_test to test).`);
  process.exit(0);
}
main().catch((e) => { console.error('✗ add-splice-automation failed:', e.message); process.exit(1); });
