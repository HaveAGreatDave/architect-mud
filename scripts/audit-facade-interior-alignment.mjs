// Read-only audit: for every enterable building facade, does the map's ENTRANCE
// arrow (buildingEntranceDir — the road-facing door side, from the exit graph)
// agree with the INTERIOR's out-exit direction (interiorExitDirs)? These are
// derived independently, so a planner can ship them disagreeing. Pure over the
// content/ JSON tree — no DB, no server boot.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east' };
const DIR_OFFSET = { north:[0,-1,0], south:[0,1,0], east:[1,0,0], west:[-1,0,0] };
const CARDINAL = new Set(['north','south','east','west']);

const load = (sub) => readdirSync(join(ROOT, 'content', sub))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(ROOT, 'content', sub, f), 'utf8')));

const zones = new Map(load('zones').map(z => [z.id, z]));
const maps = load('maps');
const mapByParent = new Map(maps.map(m => [m.parent_zone_id, m]));

const hasFacade = (z) => z?.flags?.facade === true;
const isEnterable = (z) => {
  if (!hasFacade(z)) return false;
  const m = mapByParent.get(z.id);
  return !!(m?.entry_zone_id && zones.has(m.entry_zone_id));
};
const terrainRoad = (z) => /^(road_|runway_)/.test(z?.flags?.icon || '');

// buildingEntranceDir replica: road-first door side from standable neighbours
// that step INTO the facade.
function buildEntranceIndex() {
  const cands = new Map();
  for (const z of zones.values()) {
    if (z.grid_x == null || hasFacade(z)) continue;
    const zIsRoad = terrainRoad(z);
    for (const [dir, targetId] of Object.entries(z.exits || {})) {
      const off = DIR_OFFSET[dir];
      if (!off) continue;
      const t = zones.get(targetId);
      if (!t || t.grid_x == null || !hasFacade(t)) continue;
      if (t.grid_x - z.grid_x === off[0] && t.grid_y - z.grid_y === off[1] && (t.grid_z ?? 0) === (z.grid_z ?? 0)) {
        (cands.get(t.id) || cands.set(t.id, []).get(t.id)).push({ side: OPPOSITE[dir], road: zIsRoad });
      }
    }
  }
  const idx = new Map();
  for (const [fid, list] of cands) idx.set(fid, (list.find(c => c.road) || list[0]).side);
  return idx;
}
const entranceIdx = buildEntranceIndex();

// interiorExitDirs replica: cardinal exits from the interior that leave its map.
function interiorOutDirs(interior) {
  const dirs = [];
  for (const [dir, target] of Object.entries(interior.exits || {})) {
    if (!CARDINAL.has(dir)) continue;
    const t = zones.get(target);
    if (t && (t.map_id || null) !== (interior.map_id || null)) dirs.push(dir);
  }
  return dirs;
}

const rows = [];
for (const facade of zones.values()) {
  if (!isEnterable(facade)) continue;
  const door = entranceIdx.get(facade.id) || null;      // map entrance arrow
  const interior = zones.get(mapByParent.get(facade.id).entry_zone_id);
  const outs = interiorOutDirs(interior);               // interior exit arrow(s)
  rows.push({ facade: facade.id, name: facade.name, door, outs, interior: interior.id });
}

const bad = rows.filter(r => {
  if (!r.door) return false;                 // no road-facing door → engine leaves it
  if (r.outs.length !== 1) return true;      // 0 or >1 cardinal outs = also suspect
  return r.outs[0] !== r.door;               // single out that disagrees with the door
});

console.log(`Enterable facades: ${rows.length}`);
console.log(`Misaligned: ${bad.length}\n`);
for (const r of bad) {
  const why = !r.door ? 'no-door' : r.outs.length === 0 ? 'no cardinal out'
    : r.outs.length > 1 ? `multi-out [${r.outs}]` : `door=${r.door} but interior out=${r.outs[0]}`;
  console.log(`  ${r.name}  (${r.facade})\n     ${why}`);
}
