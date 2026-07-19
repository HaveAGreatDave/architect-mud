// One-shot content transform: a building facade should have exactly ONE street
// link — its authored door (flags.entrance). The district planner left every
// facade with the generic 4-way connectivity of the tile it replaced, so most
// have 2-3 street doors (only one of which the map draws). Prune every
// standable-neighbour ↔ facade link that isn't the door side, BOTH directions,
// and guarantee the door link is reciprocal. The facade↔interior link is NEVER
// touched (it lives on the interior map, not between grid tiles). Pass --write.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east' };
const DIR_OFFSET = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
const CARDINAL = new Set(['north','south','east','west']);

const zdir = join(ROOT, 'content', 'zones');
const files = readdirSync(zdir).filter(f => f.endsWith('.json'));
const byFile = new Map(files.map(f => [f, JSON.parse(readFileSync(join(zdir, f), 'utf8'))]));
const zones = new Map([...byFile.values()].map(z => [z.id, z]));
const fileOf = new Map([...byFile].map(([f, z]) => [z.id, f]));
const at = new Map();
for (const z of zones.values()) if (z.grid_x != null) at.set(`${z.grid_x},${z.grid_y},${z.grid_z ?? 0}`, z);
const nbr = (z, dir) => { const o = DIR_OFFSET[dir]; return at.get(`${z.grid_x + o[0]},${z.grid_y + o[1]},${z.grid_z ?? 0}`); };

const facades = [...zones.values()].filter(z => z.flags?.facade && z.flags?.entrance);
const dirty = new Set();
const diff = [];
for (const f of facades) {
  const door = f.flags.entrance;
  // 1. Prune non-door street links on the facade side.
  for (const dir of Object.keys(f.exits || {})) {
    if (!CARDINAL.has(dir) || dir === door) continue;
    const t = nbr(f, dir);
    if (!t || t.flags?.facade === undefined && !CARDINAL.has(dir)) {}
    // Only prune links to a standable STREET neighbour (not an interior — interiors
    // aren't grid-adjacent, so nbr() wouldn't return them anyway).
    if (t && f.exits[dir] === t.id) {
      diff.push(`  - ${f.flags.building_name||f.name} [${f.id}] drop ${dir} -> ${t.id}`);
      delete f.exits[dir]; dirty.add(f.id);
    }
  }
  // 2. Prune the reverse (neighbour -> facade) for every non-door side.
  for (const dir of [...CARDINAL]) {
    if (dir === door) continue;
    const t = nbr(f, dir);
    if (!t) continue;
    const back = OPPOSITE[dir];
    if (t.exits?.[back] === f.id) {
      diff.push(`  - ${t.id} drop ${back} -> ${f.flags.building_name||f.name} [${f.id}]`);
      delete t.exits[back]; dirty.add(t.id);
    }
  }
  // 3. Guarantee the door link is reciprocal both ways.
  const door_t = nbr(f, door);
  if (door_t) {
    if (f.exits?.[door] !== door_t.id) { (f.exits ??= {})[door] = door_t.id; diff.push(`  + ${f.id} add ${door} -> ${door_t.id} (door)`); dirty.add(f.id); }
    if (door_t.exits?.[OPPOSITE[door]] !== f.id) { (door_t.exits ??= {})[OPPOSITE[door]] = f.id; diff.push(`  + ${door_t.id} add ${OPPOSITE[door]} -> ${f.id} (door)`); dirty.add(door_t.id); }
  }
}
diff.sort();
console.log(diff.join('\n'));
console.log(`\n${diff.length} edge changes across ${dirty.size} zones (${facades.length} facades).`);
if (WRITE) {
  for (const id of dirty) writeFileSync(join(zdir, fileOf.get(id)), JSON.stringify(zones.get(id), null, 2) + '\n');
  console.log('WROTE.');
} else console.log('(dry run — pass --write)');
