// One-shot: wire reciprocal orthogonal exits between adjacent auto-generated
// district grid tiles (zone_district_<x>_<y>, plus sublevel zone_district_<x>_<y>_z<z>)
// on map_world, mirroring the terrain painter's rule (_conjureTileLocal /
// _isBuildingTile in maps.js). Floor-aware: tiles only wire to same-floor
// neighbours (up/down stay manual, matching the painter), so it also fixes
// z-1/z-2 water tiles that were painted isolated and never got neighbour exits.
//
// SAFE by construction:
//   - only endpoints that are BOTH zone_district_ grid tiles (never touches a
//     hand-authored named zone's exits)
//   - never wires into a building facade (flags.building_type / is_building /
//     has a maps row parented on it)
//   - only same-floor orthogonal neighbours (grid_z must match)
//   - only FILLS an empty direction slot; a slot already pointing elsewhere is
//     reported as a conflict and left untouched (no clobbering, idempotent)
//   - never crosses the city↔wilds boundary (flags.district==='wilds' on one side
//     only) — the curtain stays sealed; existing gates are left as authored
//
// Run:  node scripts/wire-district-exits.mjs          (dry run — reports only)
//       node scripts/wire-district-exits.mjs --apply  (writes)
import { readFileSync } from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const url = (() => { const m = readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m); return m[1].trim().replace(/^["']|["']$/g, ''); })();
const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
await c.connect();

// Building facades (any zone with an interior map or a building flag).
const bset = new Set((await c.query(
  `SELECT z.id FROM zones z
   WHERE z.flags ? 'building_type' OR z.flags ? 'is_building'
      OR EXISTS (SELECT 1 FROM maps mp WHERE mp.parent_zone_id = z.id)`)).rows.map(r => r.id));

const { rows } = await c.query(
  `SELECT id, exits, flags, map_id, grid_x, grid_y, grid_z FROM zones WHERE id ~ '^zone_district_[0-9]+_[0-9]+(_z-?[0-9]+)?$' AND map_id = 'map_world'`);

const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };
const DIRS = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]];
const coord = new Map();          // "z:x,y" -> row (floor-keyed so sublevels never wire across z)
for (const z of rows) { z._x = z.grid_x; z._y = z.grid_y; z._z = z.grid_z ?? 0; z._wilds = z.flags?.district === 'wilds'; coord.set(`${z._z}:${z._x},${z._y}`, z); }

const isBuilding = z => bset.has(z.id);
// Polymorphic exit target reader (string | {target} | [ ... ]).
const targets = (ex, dir) => { const v = ex?.[dir]; if (v == null) return []; if (typeof v === 'string') return [v]; if (Array.isArray(v)) return v.map(e => typeof e === 'string' ? e : e?.target).filter(Boolean); if (typeof v === 'object') return [v.target].filter(Boolean); return []; };

const pending = new Map();        // id -> new exits object (mutated copy)
let filled = 0, conflicts = [];
for (const z of rows) {
  if (isBuilding(z)) continue;
  for (const [dir, dx, dy] of DIRS) {
    const n = coord.get(`${z._z}:${z._x + dx},${z._y + dy}`);
    if (!n || isBuilding(n)) continue;                 // edge, or neighbour is a building
    if (z._wilds !== n._wilds) continue;               // never wire across the sealed city↔wilds boundary
    const cur = pending.get(z.id)?.exits ?? z.exits ?? {};
    if (targets(cur, dir).includes(n.id)) continue;    // already linked this way
    if (cur[dir] !== undefined && cur[dir] !== null) {  // slot taken by something else
      conflicts.push(`${z.id}.${dir} = ${JSON.stringify(cur[dir])} (wanted ${n.id})`);
      continue;
    }
    const rec = pending.get(z.id) || { exits: { ...(z.exits || {}) } };
    rec.exits[dir] = n.id;
    pending.set(z.id, rec);
    filled++;
  }
}

console.log(`grid tiles: ${rows.length}, building facades excluded: ${bset.size} (global)`);
console.log(`exit slots to fill: ${filled}  across ${pending.size} tiles`);
console.log(`conflicts (slot points elsewhere, left untouched): ${conflicts.length}`);
if (conflicts.length) console.log(conflicts.slice(0, 20).map(s => '  ! ' + s).join('\n') + (conflicts.length > 20 ? `\n  … +${conflicts.length - 20} more` : ''));

if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to write.'); await c.end(); process.exit(0); }

await c.query('BEGIN');
let n = 0;
for (const [id, rec] of pending) {
  await c.query('UPDATE zones SET exits = $1 WHERE id = $2', [JSON.stringify(rec.exits), id]);
  if (++n % 200 === 0) console.log(`  … ${n}/${pending.size}`);
}
await c.query('COMMIT');
console.log(`\n✓ wired ${filled} exit slots across ${pending.size} tiles.`);
await c.end();
