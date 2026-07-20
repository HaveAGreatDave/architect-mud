// One-shot: fold every unassigned surface (floor-0) map_world tile into the Coldwater
// region. Legacy bay-water/sand tiles predate the region system and carry no
// flags.region_id, so the World Map editor hides them (they only show with "Show
// legacy tiles") and the bay flanks read brown instead of blue. There is exactly one
// region (region_coldwater), so every unassigned surface tile belongs to it.
//
// Edits the git source of truth (content/zones/*.json) in the pipeline's canonical
// format; run `npm run content:import` afterward to sync the local DB. Sub-level tiles
// (grid_z < 0 — The Under) are deliberately left alone.
//
//   node scripts/assign-coldwater-region.mjs

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { canonicalJson } from './content/lib.mjs';

const REGION = 'region_coldwater';
const dir = new URL('../content/zones/', import.meta.url);
let changed = 0, skipped = 0;

for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
  const path = join(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'), f);
  const z = JSON.parse(readFileSync(path, 'utf8'));
  if (z.map_id !== 'map_world') continue;
  if (!(z.grid_z === 0 || z.grid_z == null)) continue;   // surface only
  z.flags = z.flags || {};
  if (z.flags.region_id) { skipped++; continue; }
  z.flags.region_id = REGION;
  writeFileSync(path, canonicalJson(z));
  changed++;
}

console.log(`assigned ${changed} surface tiles to ${REGION} (${skipped} already assigned)`);
