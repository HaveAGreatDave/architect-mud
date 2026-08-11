// Bake Terminus' derived building codes back into the content files.
//
// A building tile SHIPS with the two-letter map code it will derive — that is the invariant the
// regress suite checks ("every tile draws the marker it shipped with"), and the reason every
// Coldwater facade in content/ already carries one.
//
// It cannot live in build-terminus.mjs, because the code is chosen by `assignBuildingMarkers`,
// which can only be right if it sees EVERY building in the world at once: uniqueness is global.
// So the order is build → import → derive → this → import, and after that a rebuild is safe
// because build-terminus.mjs carries any existing marker forward.
//
// Idempotent: writes only the files whose marker actually differs.

import { readFileSync, writeFileSync } from 'fs';
import { query } from '../server/models/db.js';

const canonical = (v) => Array.isArray(v) ? v.map(canonical)
  : (v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]))
      : v);

const { rows } = await query(
  "SELECT zone_id, marker FROM zone_derived WHERE zone_id LIKE 'zone_terminus_%' AND marker IS NOT NULL"
);

let changed = 0;
for (const { zone_id, marker } of rows) {
  const path = `content/zones/${zone_id}.json`;
  let zone;
  try { zone = JSON.parse(readFileSync(path, 'utf8')); }
  catch { console.warn(`  ! ${zone_id} has a derived marker but no content file`); continue; }
  if (zone.marker === marker) continue;
  zone.marker = marker;
  writeFileSync(path, JSON.stringify(canonical(zone), null, 2) + '\n', 'utf8');
  changed++;
}

console.log(`terminus markers: ${rows.length} derived, ${changed} written`);
process.exit(0);
