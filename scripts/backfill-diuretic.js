// One-shot content update: backfill a realistic `effects.diuretic` factor onto
// existing drugs (and beer/coffee). The factor is read in server/engine/drugs.js:
//   1   = neutral (plain water)
//   >1  = diuretic — pulls water into the bladder and dehydrates (stims, booze,
//         caffeine). e.g. coffee 2.5, beer 2.
//   <1  = antidiuretic — the body retains water (opioids/benzos → urinary
//         retention). e.g. blacktar 0.4.
//
//   Run once:  node scripts/backfill-diuretic.js
//   Restart the server (or hit /world/reload) after — drugs are cached at boot.
//
// Nothing here is engine code — it edits production content, the sanctioned
// "deliberate one-shot script" path in CLAUDE.md. Only meaningful (≠1) values are
// written; drugs judged pharmacologically neutral are left unset (= 1.0).
import { query } from '../server/models/db.js';

const STRUCTURED = ['instant', 'phases', 'hallucination', 'tolerance', 'withdrawal', 'overdose'];

function asObject(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return {};
}

// Preserve a flat effects blob by moving it under `instant` before we add keys —
// adding a top-level key would otherwise flip it into "structured" mode and blank
// the instant deltas.
function normalizeEffects(effects) {
  const eff = asObject(effects);
  const structured = STRUCTURED.some((k) => k in eff);
  return structured ? { ...eff } : { instant: { ...eff } };
}

// Realistic factors by drug id. Neutral drugs (psychedelics, dissociatives,
// memhack, amyls-are-borderline) are deliberately omitted → they stay at 1.0.
const BY_ID = {
  // Stimulants — sympathomimetic diuresis.
  drug_buzz: 1.5, drug_redline: 1.6, drug_coldfire: 1.5, drug_static: 1.4, drug_overclock: 1.7,
  // Solvent inhalant — mildly diuretic.
  drug_ether: 1.2,
  // Cannabinoid — mild fluid retention.
  drug_dreamsmoke: 0.85,
  // Opioids & benzos — classic urinary retention.
  drug_grey: 0.5, drug_blacktar: 0.4, drug_lull: 0.7,
};

// Beer/coffee are pre-existing rows matched by name (every variant).
const BY_NAME = [
  ['%beer%', 2],
  ['%coffee%', 2.5],
];

async function setDiuretic(where, params, value, label) {
  const { rows } = await query(`SELECT id, name, effects FROM drugs WHERE ${where}`, params);
  if (!rows.length) { console.log(`  (no drugs matched ${label})`); return 0; }
  for (const r of rows) {
    const effects = normalizeEffects(r.effects);
    effects.diuretic = value;
    await query('UPDATE drugs SET effects = $1::jsonb WHERE id = $2', [JSON.stringify(effects), r.id]);
    console.log(`  ✓ ${r.name} (${r.id}) → diuretic ${value}`);
  }
  return rows.length;
}

async function main() {
  let n = 0;
  console.log('By id:');
  for (const [id, value] of Object.entries(BY_ID)) {
    n += await setDiuretic('id = $1', [id], value, id);
  }
  console.log('By name:');
  for (const [pattern, value] of BY_NAME) {
    n += await setDiuretic('name ILIKE $1', [pattern], value, pattern);
  }
  console.log(`\nDone. Set diuretic on ${n} drug row(s). All others stay neutral (1.0).`);
  console.log('Restart the server (or /world/reload) so the drug cache picks up the changes.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
