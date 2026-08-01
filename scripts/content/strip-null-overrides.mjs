// Drop absent-by-default keys that a file spells out as null.
//
//   node scripts/content/strip-null-overrides.mjs [--dry-run]
//
// IDEMPOTENT — a second run writes nothing. Files only; there is no database in
// this process.
//
// An `omitWhenNull` column (content-registry) means "no override": the value
// comes from the region's defaults, or from the terrain preset, or is derived.
// A file that writes `"marker": null` says exactly the same thing the absent key
// says — except it is 5,788 copies of a non-statement, and it reads like an
// authored decision to anyone diffing it. rowToFileObject has always omitted
// these on export, so a tree that came out of `content:export` never has them;
// only hand-authored files, and files written by a branch that predates the
// column joining the list, carry them.
//
// That last case is why this exists as a committed one-shot rather than a
// footnote: merging a long-lived branch brings in content authored before the
// rule, and the fix is mechanical but touches a hundred files. content:lint
// reports each one as an error and names the remedy; this is the remedy.
//
// It only ever DELETES a null-valued key on the registry's own list. It never
// writes a value, so it cannot invent an override or erase an authored one — a
// key holding any non-null value is left exactly where it is.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { contentEntries } from '../../server/models/content-registry.js';

const DRY = process.argv.includes('--dry-run');

let scanned = 0, changed = 0;
const perTable = [];

for (const entry of contentEntries()) {
  const cols = entry.omitWhenNull || [];
  if (!cols.length) continue;
  const dir = join(CONTENT_DIR, entry.dir || entry.table);
  let files;
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }

  let hits = 0;
  const seen = new Map();   // column -> how many files spelled it out
  for (const name of files) {
    scanned++;
    const path = join(dir, name);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const dropped = cols.filter(c => c in data && data[c] === null);
    if (!dropped.length) continue;
    for (const c of dropped) { delete data[c]; seen.set(c, (seen.get(c) || 0) + 1); }
    if (!DRY) writeFileSync(path, canonicalJson(data), 'utf8');
    hits++; changed++;
  }
  if (hits) perTable.push(`  ${entry.table}: ${hits} file(s) — ${[...seen].map(([c, n]) => `${c} ×${n}`).join(', ')}`);
}

console.log(`scanned ${scanned} file(s) across the omitWhenNull tables`);
for (const line of perTable) console.log(line);
console.log(changed
  ? (DRY ? `\n(dry run — ${changed} file(s) would be rewritten)` : `\n✓ ${changed} file(s) rewritten.`)
  : '\n✓ nothing to do — no file spells out a null override.');
