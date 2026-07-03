/**
 * Prose-case name normalization (items + furniture).
 *
 * The engine shows stored names verbatim in prose ("You pick up a <name>.").
 * The convention is prose-case: generic words lowercase, brand/proper words
 * capitalized — so "pipe wrench" reads plainly but "Nexis IX breacher" keeps
 * its brand capital.
 *
 * This one-shot pass lowercases legacy Title-Case names while PRESERVING tokens
 * that carry a proper-noun signal:
 *   - contains a digit        (V3, MK2, X-7, 9mm)
 *   - ALL-CAPS, 2+ letters    (IX, EMP, SMG, ID)
 *   - has an internal capital  (camelCase brands: SynthCorp, NexTech)
 *
 * It CANNOT detect a plain Title-Case brand word ("Nexis") — those get
 * lowercased and must be hand-fixed afterward. That's the accepted tradeoff.
 *
 * Dry-run by default (prints every change). Pass --apply to write.
 *   node server/models/temp/normalize-name-case.js
 *   node server/models/temp/normalize-name-case.js --apply
 */
import 'dotenv/config';
import { query } from '../db.js';

const APPLY = process.argv.includes('--apply');

// Keep a token verbatim if it looks like a brand/model/acronym token.
function isProperToken(tok) {
  const letters = tok.replace(/[^A-Za-z]/g, '');
  if (/\d/.test(tok)) return true;                       // digit anywhere
  if (letters.length >= 2 && letters === letters.toUpperCase()) return true; // ALL-CAPS
  if (/[a-z][A-Z]/.test(tok)) return true;               // camelCase (SynthCorp, NexTech)
  return false;
}

// Lowercase ordinary words, preserve proper tokens, keep original spacing.
function normalize(name) {
  return name
    .split(/(\s+)/)                    // keep whitespace runs as tokens
    .map(tok => (/\s/.test(tok) || isProperToken(tok)) ? tok : tok.toLowerCase())
    .join('');
}

async function run(table) {
  const { rows } = await query(`SELECT id, name FROM ${table} ORDER BY name`);
  let changed = 0;
  for (const r of rows) {
    const next = normalize(r.name);
    if (next === r.name) continue;
    changed++;
    console.log(`  ${table}: "${r.name}"  ->  "${next}"`);
    if (APPLY) await query(`UPDATE ${table} SET name=$1 WHERE id=$2`, [next, r.id]);
  }
  console.log(`${table}: ${changed}/${rows.length} would change${APPLY ? ' (applied)' : ''}.\n`);
}

(async () => {
  console.log(APPLY ? '=== APPLYING ===\n' : '=== DRY RUN (pass --apply to write) ===\n');
  await run('items');
  await run('furniture');
  console.log('Done.');
  process.exit(0);
})();
