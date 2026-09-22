// ONE-SHOT: point every junction box at the city plant in its OWN region.
//
//   node scripts/content/repoint-junction-boxes.mjs [--dry-run]
//
// Repairs the rows left behind by the `installGenerator` bug fixed in the same commit
// (server/engine/environment.js, "Pick the city plant this junction box answers to").
// A junction box lives in a utility ROOM, every interior sits at grid 0,0, and the old
// auto-assign tested `grid_x != null` — which 0 passes — so it measured every box from
// the origin. Two of the four city plants are themselves interiors at 0,0, both scored
// distance 0, and a strict `d < minDist` handed the tie to whichever row Postgres
// returned first. Power still flowed, because distribution does not care about distance.
//
// ⚠ THE RULE HERE MIRRORS `powerAnchorOf` + the plant choice IN THE ENGINE, and it has to,
// because a content script cannot call them: resolving an anchor needs `world.zones`
// populated, which means booting the world. The two are therefore a second implementation
// of one rule, so they are written the same way deliberately and the engine's copy is the
// one under test (regress pins it). If you change the rule, change both.
//
//   anchor(zone) = the zone itself when it sits on a real tile (0,0 is UNSET, never a
//                  tile), else its `flags.world_exit_zone`, which on an interior names the
//                  FACADE. Failing that, any zone the box SERVES that resolves — a plant
//                  cupboard often has no street door while its own lobby does.
//   plant        = the one whose anchor shares the box's region; nearest among those;
//                  ties broken by id so the answer is the same on every machine.
//
// ⚠ TWO KINDS OF BOX ARE DELIBERATELY LEFT ALONE, and both look like the bug.
//   `flags.offgrid` — the Echelon's engine room. A ship makes her own power and is not
//   on anybody's grid; `city_generator_id: null` there is the authored answer, not a
//   missing one. Anything else carrying a null is treated the same way and reported.
//   Unanchorable — a box whose building names no street tile anywhere (the airfield
//   hangars, the Leviathan's cabin). If the rule cannot tell, neither can this script.

import { loadContentStore } from '../../tools/lib/content-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const store = loadContentStore();

const zoneById = new Map(store.all('zones').map(z => [z.id, z]));
// ⚠ `map_world`, never the coordinates. Every interior sits at 0,0, and 251 zones carry
// NON-zero coordinates on a map that is not the world (apartments at (1,0) on
// `map_interior_*`, the Leviathan's flight deck at (0,-1)). Those are local layout
// positions. A rule that merely excluded 0,0 measured the Leviathan from one tile off the
// origin, which is the original bug with a different number in it.
const placed = (z) => z && z.map_id === 'map_world' && z.grid_x != null && z.grid_y != null;
const asAnchor = (z) => ({ x: z.grid_x, y: z.grid_y, region: z.flags?.region_id || null });
function anchorOf(zone) {
  if (!zone) return null;
  if (placed(zone)) return asAnchor(zone);
  const facade = zoneById.get(zone.flags?.world_exit_zone);
  return placed(facade) ? asAnchor(facade) : null;
}

// The content-side stand-in for getBuildingNetwork: the zones this box actually feeds.
const servedBy = new Map();
for (const p of store.all('power_zones')) {
  if (!p.generator_id) continue;
  (servedBy.get(p.generator_id) || servedBy.set(p.generator_id, []).get(p.generator_id)).push(p.id);
}

const plants = store.all('generators')
  .filter(g => g.generator_type === 'city_plant')
  .map(g => ({ id: g.id, anchor: anchorOf(zoneById.get(g.zone_id)) }))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
if (plants.some(p => !p.anchor)) {
  console.error('REFUSING: a city plant has no anchor, so no box can be resolved against it:');
  for (const p of plants.filter(x => !x.anchor)) console.error(`  ${p.id}`);
  process.exit(1);
}

function plantFor(me) {
  const same = me?.region ? plants.filter(p => p.anchor.region === me.region) : [];
  const pool = same.length ? same : plants;
  let best = null, min = Infinity;
  for (const p of pool) {
    const d = Math.hypot(me.x - p.anchor.x, me.y - p.anchor.y);
    if (d < min) { min = d; best = p; }
  }
  return (best || pool[0]).id;
}

let moved = 0, offgrid = 0, unanchored = 0, already = 0;
const summary = new Map();
for (const g of store.all('generators')) {
  if (g.generator_type !== 'junction_box') continue;
  if (g.flags?.offgrid || g.city_generator_id == null) { offgrid++; continue; }
  const me = anchorOf(zoneById.get(g.zone_id))
    || (servedBy.get(g.id) || []).map(id => anchorOf(zoneById.get(id))).find(Boolean)
    || null;
  if (!me) { unanchored++; console.log(`  unanchored, left alone: ${g.id}`); continue; }
  const want = plantFor(me);
  if (want === g.city_generator_id) { already++; continue; }
  const key = `${g.city_generator_id} -> ${want}`;
  summary.set(key, (summary.get(key) || 0) + 1);
  store.patch('generators', g.id, { city_generator_id: want });
  moved++;
}

const written = store.flush({ dryRun });
console.log(`\n${dryRun ? 'would write' : 'wrote'} ${written.length} file(s)`);
for (const [k, n] of [...summary].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log(`  re-pointed ${moved}, already correct ${already}, off-grid ${offgrid}, unanchored ${unanchored}`);
