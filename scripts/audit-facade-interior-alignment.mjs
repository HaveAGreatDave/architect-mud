// Read-only audit over the content/ JSON tree (no DB, no server boot). Since the
// door is now an AUTHORED property (facade flags.entrance, baked by
// scripts/bake-building-entrances.mjs) rather than inferred from the road graph,
// this checks the three invariants that keep a building's arrows honest:
//   1. every enterable facade has flags.entrance (else it draws no door arrow)
//   2. a facade has exactly ONE interior map (a duplicate hid the Ration Nine
//      diner/grocery bug for months — the resolver silently took the first)
//   3. the interior's out-exit points the SAME way as the door (flags.entrance),
//      NOT the mirror of the facade->interior link (the intuition that kept
//      getting reverted)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CARDINAL = new Set(['north', 'south', 'east', 'west']);

const load = (sub) => readdirSync(join(ROOT, 'content', sub))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(join(ROOT, 'content', sub, f), 'utf8')));

const zones = new Map(load('zones').map(z => [z.id, z]));
const maps = load('maps');
const mapsByParent = new Map();
for (const m of maps) if (m.parent_zone_id) (mapsByParent.get(m.parent_zone_id) ?? mapsByParent.set(m.parent_zone_id, []).get(m.parent_zone_id)).push(m);

const isEnterable = (z) => {
  if (z?.flags?.facade !== true) return false;
  const ms = mapsByParent.get(z.id) || [];
  return ms.some(m => m.entry_zone_id && zones.has(m.entry_zone_id));
};

const noEntrance = [], dupMap = [], misaligned = [];
for (const f of zones.values()) {
  if (!isEnterable(f)) continue;
  const ms = mapsByParent.get(f.id) || [];
  if (ms.length > 1) dupMap.push(`${f.name} [${f.id}]: ${ms.length} interior maps (${ms.map(m => m.id).join(', ')})`);
  if (!f.flags.entrance) { noEntrance.push(`${f.name} [${f.id}]`); continue; }
  const interior = zones.get(ms[0].entry_zone_id);
  if (!interior) continue;
  const outs = Object.entries(interior.exits || {}).filter(([d, t]) => CARDINAL.has(d) && t === f.id).map(([d]) => d);
  if (outs.length === 1 && outs[0] !== f.flags.entrance)
    misaligned.push(`${f.name} [${f.id}]: door=${f.flags.entrance} but interior leaves ${outs[0]}`);
}

const report = (title, arr) => { console.log(`\n== ${title}: ${arr.length} ==`); for (const s of arr) console.log('  ' + s); };
report('Facades missing flags.entrance', noEntrance);
report('Facades with duplicate interior maps', dupMap);
report('Interior out-exit disagreeing with door', misaligned);

const bad = noEntrance.length + dupMap.length + misaligned.length;
console.log(`\n${bad === 0 ? 'All facade/interior arrows aligned. ✓' : bad + ' problem(s) found.'}`);
process.exit(bad === 0 ? 0 : 1);
