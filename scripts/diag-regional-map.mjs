// Diagnostic: why the regional map shows missing chunks.
// Measures the two places the regional payload drops tiles:
//   1) server landmassTiles() — the 4-connected flood fill from your tile
//   2) client renderMap()      — the `t.district === yours` land-use filter
// Read-only. Run: node scripts/diag-regional-map.mjs [startZoneId]
//   (add --env-file=.env.prod before the script path to hit prod)
import { query } from '../server/models/db.js';
import { districtFor } from '../server/engine/districts.js';

const startArg = process.argv[2] || null;

const { rows } = await query(
  `SELECT id, grid_x, grid_y, grid_z, flags FROM zones
   WHERE map_id='map_world' AND COALESCE((grid_z)::int,0)=0
     AND grid_x IS NOT NULL AND grid_y IS NOT NULL`
);
console.log(`map_world floor-0 placed tiles: ${rows.length}`);

// District (land-use func) distribution across the whole floor.
const byFunc = new Map();
for (const z of rows) {
  const k = districtFor(z).key;
  byFunc.set(k, (byFunc.get(k) || 0) + 1);
}
console.log('\nLand-use district distribution (what the regional filter keys on):');
for (const [k, n] of [...byFunc].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${n}`);
}

// 4-connected landmass flood fill (mirrors server landmassTiles).
const byXY = new Map(rows.map(z => [`${z.grid_x},${z.grid_y}`, z]));
const start = startArg ? rows.find(z => z.id === startArg)
  : rows.slice().sort((a, b) => a.grid_y - b.grid_y || a.grid_x - b.grid_x)[0];
if (!start) { console.log(`\nStart zone ${startArg} not found.`); process.exit(0); }
console.log(`\nStart tile: ${start.id} @ (${start.grid_x},${start.grid_y}) — district '${districtFor(start).key}'`);

const seen = new Set([`${start.grid_x},${start.grid_y}`]);
const queue = [start];
while (queue.length) {
  const z = queue.shift();
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const key = `${z.grid_x+dx},${z.grid_y+dy}`;
    if (byXY.has(key) && !seen.has(key)) { seen.add(key); queue.push(byXY.get(key)); }
  }
}
const landmass = rows.filter(z => seen.has(`${z.grid_x},${z.grid_y}`));
console.log(`\n[Drop #1] landmassTiles (4-connected flood from start):`);
console.log(`  on landmass: ${landmass.length}   dropped off-landmass: ${rows.length - landmass.length}`);

// The client regional filter, applied to the landmass tiles.
const cd = districtFor(start).key;
const kept = landmass.filter(z => districtFor(z).key === cd);
console.log(`\n[Drop #2] regional filter (t.district === '${cd}') over the landmass:`);
console.log(`  kept (rendered): ${kept.length}   dropped (blank cells): ${landmass.length - kept.length}`);
const droppedByFunc = new Map();
for (const z of landmass) {
  const k = districtFor(z).key;
  if (k !== cd) droppedByFunc.set(k, (droppedByFunc.get(k) || 0) + 1);
}
if (droppedByFunc.size) {
  console.log('  dropped tiles by their district:');
  for (const [k, n] of [...droppedByFunc].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(12)} ${n}`);
}

console.log(`\nNet: of ${rows.length} placed tiles, ${kept.length} would render on the regional map centered here.`);
process.exit(0);
