// One-shot content migration: rename the spatial-district concept to "region" in the
// git content tree. This is the rename half that touches CONTENT (the DB half lives in
// scripts/migrate-district-region-db.mjs).
//
//  - content/zones/*.json : flags.district_id → flags.region_id, and its value
//    `district_<slug>` → `region_<slug>` (so region ids read as region_*).
//  - content/districts/*.json → content/regions/*.json, with each row's `id`
//    remapped `district_<slug>` → `region_<slug>` and the filename following the id.
//
// Zone PRIMARY KEYS (zone_district_<x>_<y>) are deliberately left untouched — they are
// opaque ids that exits reference by string; renaming them is a separate, far larger
// migration with no functional gain.
//
// Git-native (edits the content tree, not the DB). Idempotent: re-running only rewrites
// what still carries the old key/dir. Run once, then `npm run content:import` + regress.
//
//   node scripts/content/rename-districts-to-regions.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const reslug = (v) => (typeof v === 'string' ? v.replace(/^district_/, 'region_') : v);

// ── Zones: rename the flag key + remap its value ─────────────────────────────
const ZDIR = join(CONTENT_DIR, 'zones');
let zChanged = 0;
for (const f of readdirSync(ZDIR)) {
  if (!f.endsWith('.json')) continue;
  const path = join(ZDIR, f);
  let z;
  try { z = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  if (!z.flags || !('district_id' in z.flags)) continue;
  const val = reslug(z.flags.district_id);
  delete z.flags.district_id;
  z.flags.region_id = val;
  writeFileSync(path, canonicalJson(z));
  zChanged++;
}
console.log(`✓ zones: rewrote district_id → region_id on ${zChanged} file(s)`);

// ── Table dir: content/districts → content/regions ───────────────────────────
const DDIR = join(CONTENT_DIR, 'districts');
const RDIR = join(CONTENT_DIR, 'regions');
let rMoved = 0;
if (existsSync(DDIR)) {
  if (!existsSync(RDIR)) mkdirSync(RDIR, { recursive: true });
  for (const f of readdirSync(DDIR)) {
    if (!f.endsWith('.json')) continue;
    const row = JSON.parse(readFileSync(join(DDIR, f), 'utf8'));
    row.id = reslug(row.id);
    writeFileSync(join(RDIR, `${row.id}.json`), canonicalJson(row));
    rMoved++;
  }
  rmSync(DDIR, { recursive: true, force: true });
  console.log(`✓ regions: moved ${rMoved} row file(s) content/districts → content/regions`);
} else {
  console.log('· content/districts already gone — regions dir is authoritative');
}

console.log('Next: npm run content:import  (then npm run test:regress)');
