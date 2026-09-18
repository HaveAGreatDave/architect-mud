// Is this open tile a LEGAL place to put a building?
//
// A facade is a non-standable revolving door: turning tile T into one REMOVES T from the walkable
// graph. Four ways that goes wrong, and the first one cost a real revert — 921,912 looked like a
// perfect hole in a finished block and was Citadel Financial's only street access.
//
//   1. T is some other facade's `world_exit_zone`  → that building loses its way out.
//   2. T has no standable road neighbour           → the new building has no entrance.
//   3. T is a cut vertex of the walk graph         → removing it splits the map.
//   4. T carries something that belongs to it      → an NPC home/work zone, a spawn, a scav table
//                                                    somebody's quest points at.
//
const ROAD = /road|asphalt/;
// usage: node scripts/content/sitecheck.mjs [x,y ...]   (no args: sweep every open core tile)
import fs from 'node:fs';
import path from 'node:path';

const C = path.resolve(process.cwd(), 'content');
const Z = path.join(C, 'zones');
const zones = new Map();
for (const f of fs.readdirSync(Z)) {
  if (!f.endsWith('.json')) continue;
  try { const j = JSON.parse(fs.readFileSync(path.join(Z, f), 'utf8')); zones.set(j.id, j); } catch {}
}

// Every facade's declared street tile.
const exitOf = new Map();          // streetZoneId -> [facade names]
for (const z of zones.values()) {
  const w = z.flags?.world_exit_zone;
  if (w && z.flags?.facade) (exitOf.get(w) || exitOf.set(w, []).get(w)).push(z.flags.building_name || z.id);
}

// Anything that references a zone by id, outside content/zones.
const refs = new Map();            // zoneId -> Set(reason)
const addRef = (id, why) => { if (!id) return; (refs.get(id) || refs.set(id, new Set()).get(id)).add(why); };
for (const dir of ['npcs', 'zone_spawns', 'furniture', 'quests', 'job_boards', 'npc_residences', 'security_devices', 'doors', 'connections', 'incidents']) {
  const d = path.join(C, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    const raw = fs.readFileSync(path.join(d, f), 'utf8');
    for (const m of raw.matchAll(/"(zone_district_\d+_\d+)"/g)) addRef(m[1], dir);
  }
}

// The walkable graph: every zone that is not a facade. Facades are traversed THROUGH, never onto,
// so they are not vertices — which is exactly why removing one can cut the map.
const walkable = (z) => z && !z.flags?.facade;
function neighbours(z) {
  const out = [];
  for (const t of Object.values(z.exits || {})) { const n = zones.get(t); if (walkable(n)) out.push(n.id); }
  return out;
}
// Would removing `id` disconnect its own neighbourhood? Flood from one neighbour with `id` deleted
// and see whether the others are still reachable. Bounded to 4000 tiles, which is the whole city.
function cutsGraph(id) {
  const me = zones.get(id);
  const nb = neighbours(me);
  if (nb.length <= 1) return false;
  const seen = new Set([id, nb[0]]);
  const stack = [nb[0]];
  let steps = 0;
  while (stack.length && steps++ < 20000) {
    const cur = zones.get(stack.pop());
    for (const n of neighbours(cur)) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return nb.some((n) => !seen.has(n));
}

function check(id) {
  const z = zones.get(id);
  if (!z) return { id, fail: ['no such tile'] };
  const fail = [], warn = [];
  if (z.flags?.is_building) fail.push('already a building');
  // ⚠ A ROAD IS NOT A SITE, and the sweep's own filter hides this: it skips road tiles before it
  // ever gets here, so the rule only exists for a coordinate somebody names on the command line —
  // which is exactly how a roster written before this script got a shop sited on Meltwater Row.
  if (ROAD.test(z.flags?.terrain || '')) fail.push(`the tile itself is road (${z.name}) — build beside it, not on it`);
  if (z.flags?.terrain === 'water') fail.push('the tile itself is water');
  if (exitOf.has(id)) fail.push(`is the street exit for: ${exitOf.get(id).join(', ')}`);
  const roads = [];
  for (const [dir, t] of Object.entries(z.exits || {})) {
    const n = zones.get(t);
    if (n && walkable(n) && ROAD.test(n.flags?.terrain || '')) roads.push(`${dir}=${n.name}`);
  }
  if (!roads.length) fail.push('no standable road neighbour (nowhere to put the door)');
  if (cutsGraph(id)) fail.push('removing it splits the walk graph');
  if (refs.has(id)) warn.push(`referenced by ${[...refs.get(id)].join(', ')}`);
  if (z.flags?.mark) warn.push(`carries mark: ${z.flags.mark}`);
  return { id, x: z.grid_x, y: z.grid_y, name: z.name, district: z.flags?.district, terrain: z.flags?.terrain, roads, fail, warn };
}

const args = process.argv.slice(2);
let ids;
if (args.length) ids = args.map((a) => { const [x, y] = a.split(','); return `zone_district_${x}_${y}`; });
else {
  ids = [];
  for (const z of zones.values()) {
    if (z.map_id !== 'map_world' || (z.grid_z || 0) !== 0) continue;
    if (z.grid_x < 891 || z.grid_x > 928 || z.grid_y < 898 || z.grid_y > 921) continue;
    if (z.flags?.is_building || z.flags?.mark) continue;
    if (/water|dock|park/.test(z.flags?.terrain || '') || ROAD.test(z.flags?.terrain || '')) continue;
    ids.push(z.id);
  }
}
let ok = 0;
for (const id of ids) {
  const r = check(id);
  const tag = r.fail.length ? '✗' : '✓';
  if (!r.fail.length) ok++;
  if (args.length || !r.fail.length) {
    console.log(`${tag} ${String(r.x)},${String(r.y)} [${(r.district || '-').padEnd(11)}] ${(r.terrain || '-').padEnd(9)} ${(r.name || '').padEnd(24)} roads: ${(r.roads || []).join(' | ') || 'none'}`);
    for (const f of r.fail) console.log(`     FAIL  ${f}`);
    for (const w of r.warn) console.log(`     warn  ${w}`);
  }
}
if (!args.length) console.log(`\n${ok} legal site(s) of ${ids.length} open core tiles.`);
