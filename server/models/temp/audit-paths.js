import 'dotenv/config';
import { query } from '../db.js';
import { validateMapLayout } from '../../engine/mapValidation.js';

const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };

const { rows: zones } = await query(
  `SELECT id, name, map_id, parent_zone, grid_x, grid_y, grid_z, exits FROM zones`
);
const { rows: maps } = await query(`SELECT id, name, parent_zone_id, entry_zone_id FROM maps`);

const byId = new Map(zones.map(z => [z.id, z]));
const mapById = new Map(maps.map(m => [m.id, m]));

console.log(`Zones: ${zones.length}  Maps: ${maps.length}\n`);

// 1. Core validator (dangling / geometry / missing-reciprocal)
const { errors, warnings } = validateMapLayout(zones);

const label = id => { const z = byId.get(id); return z ? `${id} ("${z.name}")` : `${id} <MISSING>`; };

const byReason = r => arr => arr.filter(x => x.reason === r);
const dangling = byReason('dangling')(errors);
const geometry = byReason('geometry')(errors);
const reciprocal = byReason('missing-reciprocal')(warnings);

console.log(`=== DANGLING EXITS (target zone doesn't exist) — ${dangling.length} ===`);
dangling.forEach(e => console.log(`  ${label(e.zoneId)} --${e.direction}--> ${e.targetId}`));

console.log(`\n=== GEOMETRY MISMATCHES (intra-map exit not pointing at grid-adjacent cell) — ${geometry.length} ===`);
geometry.forEach(e => console.log(`  ${label(e.zoneId)} --${e.direction}--> ${label(e.targetId)}`));

console.log(`\n=== MISSING RECIPROCAL / ONE-WAY EXITS — ${reciprocal.length} ===`);
reciprocal.forEach(e => {
  const t = byId.get(e.targetId);
  const backDir = OPPOSITE[e.direction];
  const has = t && t.exits && t.exits[backDir];
  console.log(`  ${label(e.zoneId)} --${e.direction}--> ${label(e.targetId)}   (no ${backDir} back${has ? `, but ${backDir} goes to ${has}` : ''})`);
});

// 2. Map membership / positioning problems
const noMap = zones.filter(z => !z.map_id);
const noGrid = zones.filter(z => z.map_id && (z.grid_x == null || z.grid_y == null));
console.log(`\n=== ZONES WITH NO map_id — ${noMap.length} ===`);
noMap.forEach(z => console.log(`  ${label(z.id)}`));
console.log(`\n=== ZONES ON A MAP BUT UNPOSITIONED (no grid_x/y) — ${noGrid.length} ===`);
noGrid.forEach(z => console.log(`  ${label(z.id)} (map ${z.map_id})`));

// 3. Grid collisions: two zones sharing the same cell on the same map
const cellMap = new Map();
for (const z of zones) {
  if (!z.map_id || z.grid_x == null || z.grid_y == null) continue;
  const key = `${z.map_id}@${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`;
  if (!cellMap.has(key)) cellMap.set(key, []);
  cellMap.get(key).push(z);
}
const collisions = [...cellMap.entries()].filter(([, zs]) => zs.length > 1);
console.log(`\n=== GRID COLLISIONS (multiple zones on one cell) — ${collisions.length} ===`);
collisions.forEach(([key, zs]) => console.log(`  ${key}: ${zs.map(z => label(z.id)).join(', ')}`));

// 4. Map integrity: entry_zone_id / parent_zone_id resolve
console.log(`\n=== MAP REFERENCE PROBLEMS ===`);
for (const m of maps) {
  if (m.entry_zone_id && !byId.has(m.entry_zone_id))
    console.log(`  map ${m.id} ("${m.name}") entry_zone_id ${m.entry_zone_id} <MISSING>`);
  if (m.entry_zone_id && byId.has(m.entry_zone_id) && byId.get(m.entry_zone_id).map_id !== m.id)
    console.log(`  map ${m.id} ("${m.name}") entry_zone_id ${m.entry_zone_id} is on a different map (${byId.get(m.entry_zone_id).map_id})`);
  if (m.parent_zone_id && !byId.has(m.parent_zone_id))
    console.log(`  map ${m.id} ("${m.name}") parent_zone_id ${m.parent_zone_id} <MISSING>`);
}

// 5. Reachability: which zones are unreachable from the world entry point.
// Build an undirected-ish adjacency from exits + cross-map portals, then BFS
// from every map entry zone.
const adj = new Map(zones.map(z => [z.id, new Set()]));
for (const z of zones) {
  for (const target of Object.values(z.exits || {})) {
    if (byId.has(target)) adj.get(z.id).add(target);
  }
}
// Seed roots: entry zones of maps + any zone with no map (assume world root candidates)
const roots = new Set();
maps.forEach(m => { if (m.entry_zone_id && byId.has(m.entry_zone_id)) roots.add(m.entry_zone_id); });
// Also treat the world map's zones as reachable seeds via parent portals already in exits.
const seen = new Set();
const stack = [...roots];
while (stack.length) {
  const id = stack.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const n of adj.get(id) || []) stack.push(n);
}
const unreachable = zones.filter(z => !seen.has(z.id));
console.log(`\n=== POTENTIALLY UNREACHABLE ZONES (no directed exit path from any map entry) — ${unreachable.length} ===`);
console.log(`    (heuristic — a zone reached only via a portal FROM its interior may show here)`);
unreachable.forEach(z => console.log(`  ${label(z.id)} (map ${z.map_id ?? 'none'})`));

// 6. Dead-end zones: no outgoing exits at all
const deadEnds = zones.filter(z => Object.keys(z.exits || {}).length === 0);
console.log(`\n=== ZONES WITH NO OUTGOING EXITS — ${deadEnds.length} ===`);
deadEnds.forEach(z => console.log(`  ${label(z.id)} (map ${z.map_id ?? 'none'})`));

process.exit(0);
