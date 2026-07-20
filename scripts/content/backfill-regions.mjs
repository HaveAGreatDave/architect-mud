// One-shot backfill: give the existing hand-built region a first-class
// `regions` row and tag its member zones with flags.region_id, so the new
// dev-panel World Editor can see/select/move it like any generated region.
//
//  - writes content/regions/region_coldwater.json
//  - adds flags.region_id = "region_coldwater" to every content/zones/*.json
//    tile flagged flags.planner === "bp_district" (leaves flags.planner intact)
//
// Git-native (edits the content tree, not the DB). Idempotent: re-running only
// fills in what's missing. Run once, then `npm run content:import` + regress.
//
//   node scripts/content/backfill-regions.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const REGION_ID = 'region_coldwater';
const REGION_NAME = 'Coldwater';
const STAMP = 1784000000; // fixed, deterministic (matches other content-script stamps)

const ZDIR = join(CONTENT_DIR, 'zones');
const RDIR = join(CONTENT_DIR, 'regions');

let tagged = 0, already = 0;
for (const f of readdirSync(ZDIR)) {
  if (!f.endsWith('.json')) continue;
  const path = join(ZDIR, f);
  let z;
  try { z = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
  if (z.flags?.planner !== 'bp_district') continue;
  if (z.flags.region_id === REGION_ID) { already++; continue; }
  z.flags = { ...z.flags, region_id: REGION_ID };
  writeFileSync(path, canonicalJson(z));
  tagged++;
}

// The region row. base_terrain is null — this region was hand-built tile by
// tile, not seeded from one surface, so there is no single base terrain.
if (!existsSync(RDIR)) mkdirSync(RDIR, { recursive: true });
const regionFile = join(RDIR, `${REGION_ID}.json`);
if (!existsSync(regionFile)) {
  writeFileSync(regionFile, canonicalJson({
    id: REGION_ID,
    name: REGION_NAME,
    base_terrain: null,
    grid_z: 0,
    created_by: 'backfill',
    updated_at: STAMP,
  }));
  console.log(`✓ wrote content/regions/${REGION_ID}.json`);
} else {
  console.log(`· content/regions/${REGION_ID}.json already exists`);
}

console.log(`✓ tagged ${tagged} zone file(s) with region_id=${REGION_ID} (${already} already tagged)`);
console.log('Next: npm run content:import  (then npm run test:regress)');
