// One-shot content: give drugs an `effects.onset_seconds` — how long the dose
// takes to HIT. 0 = instant snap (cocaine-types); >0 defers the instant block +
// the hallucination trigger so most drugs "come on" instead of snapping. The
// come-up ramp of a buff still lives in phases; onset is only for the one-shot
// instant hit + trip. See server/engine/drugs.js (useDrug/tickOnsets).
//
//   Run once:  node scripts/add-drug-onset.mjs
//   Restart the server (or /world/reload) after — drugs are cached at boot.
//
// Patches BOTH the git source (content/drugs/*.json) and the live DB drugs rows.
// Idempotent — safe to re-run. Phased drugs already ramp via comeup, so they
// stay onset 0; this only ramps the instant-only snappers.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../server/models/db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRUGS_DIR = join(ROOT, 'content', 'drugs');

// drug_id -> onset seconds (only the instant-only snappers; phased drugs omitted = 0)
const ONSET = {
  drug_ether:       2,   // fast inhalant
  drug_buzz:        3,   // quick stim rush
  drug_glasshollow: 6,
  drug_slow:        8,   // gradual wash — the name is the brief
  drug_khole:       8,   // sink into the hole
  drug_deadair:    8,   // dissociative drift
  drug_screamers:  10,   // dread builds
  drug_blotter:    20,   // long LSD come-up + trip
  drug_mescaline:  25,
  drug_psilocybin: 30,   // slowest come-up
};
// Explicit onset 0 (instant) — documented so the intent is on the record, not absence.
const INSTANT = ['drug_laughers', 'drug_threshold', 'drug_alcohol', 'drug_coffee'];

// Also tighten poppers: a 4s come-up reads slow for a nitrite rush.
const COMEUP_FIX = { drug_amyls: 2 };

async function main() {
  let jsonPatched = 0, dbPatched = 0;

  for (const [id, secs] of [...Object.entries(ONSET), ...INSTANT.map(id => [id, 0])]) {
    // git source
    const file = join(DRUGS_DIR, `${id}.json`);
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      d.effects = d.effects || {};
      d.effects.onset_seconds = secs;
      writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
      jsonPatched++;
    } catch (e) { console.warn(`  ! ${id}: no content file (${e.code || e.message})`); }

    // live DB
    const r = await query(
      `UPDATE drugs SET effects = jsonb_set(COALESCE(effects,'{}'::jsonb), '{onset_seconds}', to_jsonb($1::int), true) WHERE id=$2`,
      [secs, id]
    );
    if (r.rowCount) dbPatched++;
    console.log(`  onset ${String(secs).padStart(2)}s  ${id}${r.rowCount ? '' : '  (not in DB)'}`);
  }

  for (const [id, comeup] of Object.entries(COMEUP_FIX)) {
    const file = join(DRUGS_DIR, id + '.json');
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      if (d.effects?.phases) { d.effects.phases.comeup_seconds = comeup; writeFileSync(file, JSON.stringify(d, null, 2) + '\n'); jsonPatched++; }
    } catch (e) { console.warn(`  ! ${id}: ${e.message}`); }
    const r = await query(
      `UPDATE drugs SET effects = jsonb_set(effects, '{phases,comeup_seconds}', to_jsonb($1::int), true) WHERE id=$2 AND effects->'phases' IS NOT NULL`,
      [comeup, id]
    );
    if (r.rowCount) dbPatched++;
    console.log(`  comeup ${comeup}s ${id}`);
  }

  console.log(`\nDone: ${jsonPatched} content files, ${dbPatched} DB rows. Restart / /world reload to load.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
