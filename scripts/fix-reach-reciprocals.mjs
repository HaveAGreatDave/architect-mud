// One-shot data transform: The Reach grid was wired one-way (every tile has only
// west/north exits; no east/south returns), so the map validator flags ~549 one-way
// exits. Add the reciprocal return for every reach->reach orthogonal exit, matching
// the Terrain Painter's auto-wire rule (adjacent non-building tiles are bidirectional).
import { query } from '../server/models/db.js';
import { OPPOSITE, DIR_OFFSET } from '../server/engine/directions.js';
import { allExits, exitTargets } from '../server/engine/exits.js';

const DRY = process.argv.includes('--dry');

const { rows: zones } = await query(
  `SELECT id, grid_x, grid_y, exits, flags FROM zones WHERE flags->>'region_id' = 'region_the_reach'`);
const byId = new Map(zones.map(z => [z.id, z]));

const patched = new Map(); // id -> exits object to write
let added = 0, skippedOccupied = 0;

for (const z of zones) {
  for (const { dir, target } of allExits(z)) {
    if (!DIR_OFFSET[dir]) continue;            // orthogonal grid dirs only
    const t = byId.get(target);
    if (!t) continue;                          // cross-region / non-reach target: leave alone
    if (t.flags?.is_building) continue;        // building entrances stay one-way
    const opp = OPPOSITE[dir];
    if (!opp) continue;
    const cur = patched.get(t.id) || { ...(t.exits || {}) };
    if (exitTargets({ exits: cur }, opp).includes(z.id)) continue;   // already returns to us
    if (cur[opp] != null) { skippedOccupied++; console.log(`SKIP occupied: ${t.id} ${opp} -> ${JSON.stringify(cur[opp])} (wanted ${z.id})`); continue; }
    cur[opp] = z.id;
    patched.set(t.id, cur);
    added++;
  }
}

console.log(`reciprocal returns to add: ${added}; tiles touched: ${patched.size}; skipped(occupied): ${skippedOccupied}`);
if (DRY) { console.log('DRY RUN — no writes.'); process.exit(0); }

for (const [id, exits] of patched) {
  await query('UPDATE zones SET exits = $1 WHERE id = $2', [JSON.stringify(exits), id]);
}
console.log(`Wrote ${patched.size} zones.`);
process.exit(0);
