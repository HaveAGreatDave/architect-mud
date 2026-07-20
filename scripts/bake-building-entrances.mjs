// One-shot: bake flags.entrance onto every enterable building facade from the
// road-ICON graph (road_/runway_ connectors — NOT painted flags.terrain, which
// is ground-surface paint that must not steal a building's door). Pass --write
// to persist into content/zones/*.json; default is a dry-run preview.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east' };
const DIR_OFFSET = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };

const zdir = join(ROOT, 'content', 'zones');
const files = readdirSync(zdir).filter(f => f.endsWith('.json'));
const byFile = new Map(files.map(f => [f, JSON.parse(readFileSync(join(zdir, f), 'utf8'))]));
const zones = new Map([...byFile.values()].map(z => [z.id, z]));
const maps = readdirSync(join(ROOT, 'content', 'maps')).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(ROOT, 'content', 'maps', f), 'utf8')));
const parents = new Map();
for (const m of maps) if (m.parent_zone_id) (parents.get(m.parent_zone_id) ?? parents.set(m.parent_zone_id, []).get(m.parent_zone_id)).push(m);

const roadIcon = (z) => /^(road_|runway_)/.test(z?.flags?.icon || '');

// Candidate door sides = standable neighbours that step INTO the facade.
function candidates(f) {
  const list = [];
  for (const z of zones.values()) {
    if (z.grid_x == null || z.flags?.facade) continue;
    for (const [dir, tid] of Object.entries(z.exits || {})) {
      const off = DIR_OFFSET[dir]; if (!off) continue;
      if (tid !== f.id) continue;
      if (z.grid_x + off[0] === f.grid_x && z.grid_y + off[1] === f.grid_y && (z.grid_z ?? 0) === (f.grid_z ?? 0))
        list.push({ side: OPPOSITE[dir], road: roadIcon(z), from: z.id });
    }
  }
  return list;
}

const resolved = [], ambiguous = [], noroad = [];
for (const f of zones.values()) {
  if (!f.flags?.facade || !parents.has(f.id)) continue;
  const list = candidates(f);
  const roads = list.filter(c => c.road);
  if (roads.length === 1) resolved.push([f, roads[0].side, list]);
  else if (roads.length > 1) ambiguous.push([f, roads.map(c => c.side), list]);
  else noroad.push([f, list.map(c => c.side)]);
}

const name = (f) => (f.flags.building_name || f.name || f.id).slice(0, 26).padEnd(27);
console.log(`\n== RESOLVED (single road-icon door) : ${resolved.length} ==`);
for (const [f, side] of resolved) console.log('  ' + name(f) + side);
console.log(`\n== AMBIGUOUS (>1 road-icon side — needs hand pick) : ${ambiguous.length} ==`);
for (const [f, sides] of ambiguous) console.log('  ' + name(f) + sides.join(' / '));
console.log(`\n== NO ROAD ICON (needs hand-authored entrance) : ${noroad.length} ==`);
for (const [f, sides] of noroad) console.log('  ' + name(f) + '(non-road neighbours: ' + (sides.join(',') || 'none') + ')');

if (WRITE) {
  let n = 0;
  for (const [f, side] of resolved) {
    for (const [file, z] of byFile) if (z.id === f.id) { z.flags.entrance = side; writeFileSync(join(zdir, file), JSON.stringify(z, null, 2) + '\n'); n++; }
  }
  console.log(`\nWROTE flags.entrance to ${n} zone files (resolved only; ambiguous + no-road left for hand-authoring).`);
} else {
  console.log('\n(dry run — pass --write to persist the RESOLVED set)');
}
