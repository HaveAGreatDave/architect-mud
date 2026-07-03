// One-shot content update: give beer and coffee an overdose (both lethal) and
// wire them into the intoxication plugin's meter.
//   Run once:  node scripts/rework-beer-coffee.js
//   Restart the server (or hit /world/reload) after — drugs are cached at boot.
//
// Matches drug rows by name (ILIKE '%beer%' / '%coffee%'), so every beer/coffee
// variant is caught. Nothing here is engine code — it edits production content,
// exactly the sanctioned "deliberate one-shot script" path in CLAUDE.md.
//
// Safety: adding an `overdose` key would flip a flat (back-compat) effects blob
// into "structured" mode, which blanks the instant effects. So we first wrap any
// flat effects into an `instant` sub-block, preserving the drink's hunger/thirst
// restore.
import { query } from '../server/models/db.js';

const STRUCTURED = ['instant', 'phases', 'hallucination', 'tolerance', 'withdrawal', 'overdose'];

function asObject(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}

// Preserve a flat effects blob by moving it under `instant` before we add keys.
function normalizeEffects(effects) {
  const eff = asObject(effects);
  const structured = STRUCTURED.some((k) => k in eff);
  return structured ? { ...eff } : { instant: { ...eff } };
}

const BEER_OD = {
  lethal: true,
  message: "You've had far too much, far too fast. The room spins hard, your stomach heaves, and then everything just… stops. Alcohol poisoning.",
};
const COFFEE_OD = {
  lethal: true,
  message: 'Your heart trips, stutters, and seizes. Too much caffeine, too fast — your chest goes tight and cold, and the world tips over.',
};

async function updateMatching(pattern, { overdoseThreshold, overdose, flagPatch }) {
  const { rows } = await query('SELECT id, name, effects, flags, overdose_threshold FROM drugs WHERE name ILIKE $1', [pattern]);
  if (!rows.length) { console.log(`  (no drugs matched ${pattern})`); return 0; }
  for (const r of rows) {
    const effects = normalizeEffects(r.effects);
    effects.overdose = overdose;
    const flags = { ...asObject(r.flags), legal: true, ...flagPatch };
    await query(
      'UPDATE drugs SET effects = $1::jsonb, flags = $2::jsonb, overdose_threshold = $3 WHERE id = $4',
      [JSON.stringify(effects), JSON.stringify(flags), overdoseThreshold, r.id]
    );
    console.log(`  ✓ ${r.name} (${r.id}) → OD@${overdoseThreshold}, flags ${JSON.stringify(flags)}`);
  }
  return rows.length;
}

async function main() {
  console.log('Beer:');
  const beers = await updateMatching('%beer%', {
    overdoseThreshold: 8,
    overdose: BEER_OD,
    flagPatch: { alcoholic: true, intox_per_dose: 22 },
  });

  console.log('Coffee:');
  const coffees = await updateMatching('%coffee%', {
    overdoseThreshold: 6,
    overdose: COFFEE_OD,
    flagPatch: { sobering: true, sober_amount: 30 },
  });

  console.log(`\nDone. Updated ${beers} beer row(s), ${coffees} coffee row(s).`);
  console.log('Restart the server (or /world/reload) so the drug cache picks up the changes.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
