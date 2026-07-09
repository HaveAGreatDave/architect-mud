// One-shot: recolor every zone's stored map colour by its district, keyed off the
// real zone-id prefix scheme (zone_<cat>_<name>). Overwrites bg_color for all
// zones and clears foreground `color` so tiles auto-derive text. The prefix→
// district mapping and the colours are the single source of truth in
// server/engine/districts.js — this script is just a consumer of it.
import { query } from '../server/models/db.js';
import { districtFor } from '../server/engine/districts.js';

const { rows } = await query(`SELECT id, danger_rating, flags FROM zones`);
const tally = {};
for (const z of rows) {
  const d = districtFor(z);
  await query(`UPDATE zones SET bg_color = $1, color = NULL WHERE id = $2`, [d.color, z.id]);
  tally[d.key] = (tally[d.key] || 0) + 1;
}
console.log(`Recoloured ${rows.length} zones:`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ×${v}`);
}
process.exit(0);
