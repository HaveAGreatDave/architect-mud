// One-shot backfill: give the existing hand-built district a first-class
// `districts` row and tag its member zones with flags.district_id, so the new
// dev-panel World Editor can see/select/move it like any generated district.
//
//  - writes content/districts/district_coldwater.json
//  - adds flags.district_id = "district_coldwater" to every content/zones/*.json
//    tile flagged flags.planner === "bp_district" (leaves flags.planner intact)
//
// Git-native (edits the content tree, not the DB). Idempotent: re-running only
// fills in what's missing. Run once, then `npm run content:import` + regress.
//
//   node scripts/content/backfill-districts.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const DISTRICT_ID = 'district_coldwater';
const DISTRICT_NAME = 'Coldwater';
const STAMP = 1784000000; // fixed, deterministic (matches other content-script stamps)

const ZDIR = join(CONTENT_DIR, 'zones');
const DDIR = join(CONTENT_DIR, 'districts');

let tagged = 0, already = 0;
for (const f of readdirSync(ZDIR)) {
  if (!f.endsWith('.json')) continue;
  const path = join(ZDIR, f);
  let z;
  try { z = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  if (z.flags?.planner !== 'bp_district') continue;
  if (z.flags.district_id === DISTRICT_ID) { already++; continue; }
  z.flags = { ...z.flags, district_id: DISTRICT_ID };
  writeFileSync(path, canonicalJson(z));
  tagged++;
}

// The district row. base_terrain is null — this district was hand-built tile by
// tile, not seeded from one surface, so there is no single base terrain.
if (!existsSync(DDIR)) mkdirSync(DDIR, { recursive: true });
const districtFile = join(DDIR, `${DISTRICT_ID}.json`);
if (!existsSync(districtFile)) {
  writeFileSync(districtFile, canonicalJson({
    id: DISTRICT_ID,
    name: DISTRICT_NAME,
    base_terrain: null,
    grid_z: 0,
    created_by: 'backfill',
    updated_at: STAMP,
  }));
  console.log(`✓ wrote content/districts/${DISTRICT_ID}.json`);
} else {
  console.log(`· content/districts/${DISTRICT_ID}.json already exists`);
}

console.log(`✓ tagged ${tagged} zone file(s) with district_id=${DISTRICT_ID} (${already} already tagged)`);
console.log('Next: npm run content:import  (then npm run test:regress)');
