// Sewer-grid builder — lays a basic z-1 "Under" tile beneath every surface ROAD
// tile (flags.icon starting "road"), so the sewer network mirrors the street grid
// district-wide. Idempotent: re-running only adds what's missing.
//
//  - one content/zones/zone_under_<x>_<y>.json per road coord not already occupied
//  - a matching content/power_zones/<id>.json stub (city_grid, 0 kW → pitch dark)
//  - reciprocal N/S/E/W exits between adjacent under tiles (generated + existing)
//  - the hand-authored bespoke tiles are honored: SEALED seams and scavenge nooks
//    never gain auto-links, and NO existing exit is ever removed (only added)
//  - reachability: any generated component with no path to the existing network
//    gets one storm-drain riser (under `up` <-> surface road `down`)
//
// Run: node scripts/content/build-sewer-grid.mjs   (then content:import + regress)
import { readdirSync, readFileSync, writeFileSync } from 'fs';

const ZDIR = 'content/zones';
const PDIR = 'content/power_zones';
const STAMP = '1784000000';

// Existing hand-authored tiles that must stay as designed — never auto-linked
// (sealed dead-end seams + intentional scavenge nooks / the rat nest).
const SEAL = new Set([
  'zone_under_collapse', 'zone_under_door', 'zone_under_sealedsub',
  'zone_under_alcove', 'zone_under_siltpocket', 'zone_under_cistern',
  'zone_under_warren',
  // The Long Watch's sealed doorstep — its east exit is the rep-gated blast door,
  // so the public grid must not stitch a stray one-way into it.
  'zone_under_watchthresh',
]);

// --- load ------------------------------------------------------------------
const fileOf = {};                     // zoneId -> filename
const zones = {};                      // zoneId -> zone object
for (const f of readdirSync(ZDIR)) {
  if (!f.endsWith('.json')) continue;
  let z; try { z = JSON.parse(readFileSync(`${ZDIR}/${f}`, 'utf8')); } catch { continue; }
  zones[z.id] = z; fileOf[z.id] = f;
}
const all = Object.values(zones);
const surface = all.filter(z => z.map_id === 'map_world' && z.grid_z === 0);
const surfByCoord = {};
for (const z of surface) surfByCoord[`${z.grid_x},${z.grid_y}`] = z;

const isRoad = z => String(z.flags?.icon || '').startsWith('road');
const roadTiles = surface.filter(isRoad);

// under tiles by coord (existing bespoke + newly generated share this index)
const underByCoord = {};
for (const z of all) if (z.map_id === 'map_world' && z.grid_z === -1) underByCoord[`${z.grid_x},${z.grid_y}`] = z;

// --- generate missing under tiles under each road coord --------------------
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };

const NAME_BY_DEG = { 1: 'Drain Sump', 2: 'Sewer Line', 3: 'Drain Junction', 4: 'Trunk Crossing' };
const descTemplates = {
  docks: [
    'A brackish stretch of storm tunnel beneath {street}, the brick furred with salt and barnacle. The tide reaches even down here, rising and falling against your boots.',
    'The sewer runs low and wet under {street}, harbour water backwashing up the line whenever the tide turns. Everything smells of salt and rot.',
  ],
  residential: [
    'A run of domestic storm line under {street}, the walls streaked with a century of household runoff. Somewhere a broken pipe drips with idiot patience.',
    'The tunnel beneath {street} carries the quiet waste of the blocks above — grey water, lost things, the occasional startled scurry at the edge of your light.',
  ],
  wasteland: [
    'A grimy trunk of storm tunnel under {street}, the concrete cracked and weeping, the air thick with the sour breath of the drains.',
    'The sewer beneath {street} is all crumbling grade and standing filth, the kind of dark that has never once been disturbed by anyone with a reason to be here.',
  ],
  yards: [
    'An industrial storm culvert under {street}, wide enough for freight runoff, its floor slick with oil and grit washed down from the yards above.',
    'The tunnel beneath {street} carries the yards’ dirty water — chemical sheen on the surface, rust on every fixture.',
  ],
  _default: [
    'A plain stretch of storm tunnel beneath {street}, brick and standing water and the endless drip of the city draining itself.',
    'The sewer runs on under {street}, low and dark and wet, one more length of the network nobody above ever thinks about.',
  ],
};
const pick = (arr, x, y) => arr[Math.abs(x * 31 + y * 17) % arr.length];
// box-drawing marker from the set of open cardinal directions (pipe look)
const MARK = {
  '': '·', N: '╨', S: '╥', E: '╞', W: '╡',
  NS: '║', EW: '═', NE: '╚', NW: '╝', SE: '╔', SW: '╗',
  NSE: '╠', NSW: '╣', NEW: '╩', SEW: '╦', NSEW: '╬',
};
const markFor = dirs => {
  const key = ['north', 'east', 'south', 'west'].filter(d => dirs.has(d)).map(d => d[0].toUpperCase()).sort((a, b) => 'NESW'.indexOf(a) - 'NESW'.indexOf(b)).join('');
  // normalize to MARK keys (order N,S,E,W)
  const norm = ['N', 'S', 'E', 'W'].filter(c => key.includes(c)).join('');
  return MARK[norm] || '╬';
};

const newTiles = [];   // zone objects we created
for (const rt of roadTiles) {
  const key = `${rt.grid_x},${rt.grid_y}`;
  if (underByCoord[key]) continue;              // already an under tile here
  const id = `zone_under_${rt.grid_x}_${rt.grid_y}`;
  const districtAbove = rt.flags?.district || '_default';
  const tmpl = descTemplates[districtAbove] || descTemplates._default;
  const streetName = rt.name && rt.name !== 'Road' ? rt.name : 'the street';
  const z = {
    ambient_events: [
      'Water moves through the dark somewhere close, then further off.',
      'Your light finds a waterline stain, old and high, and loses it.',
      'The drip here keeps a rhythm the tunnel seems to like.',
    ],
    ambient_theme: 'indoors',
    audio_theme_id: null,
    bg_color: '#141b19',
    color: '#8fae9a',
    created_by: 'sewer-grid',
    description: pick(tmpl, rt.grid_x, rt.grid_y).replace('{street}', streetName),
    exits: {},                                  // filled in the linking pass
    flags: { district: 'sewer', is_interior: true, scavenging_table_id: 'scav_sewer' },
    grid_x: rt.grid_x, grid_y: rt.grid_y, grid_z: -1,
    id,
    map_id: 'map_world',
    marker: '╬',                           // set precisely after linking
    name: 'Sewer Line',                         // refined after linking (by degree)
    parent_zone: null,
    updated_at: STAMP,
  };
  zones[id] = z; underByCoord[`${rt.grid_x},${rt.grid_y}`] = z;
  fileOf[id] = `${id}.json`;
  newTiles.push(z);
}

// --- reciprocal linking pass ----------------------------------------------
const isNew = new Set(newTiles.map(z => z.id));
const touchedExisting = new Set();
let linksAdded = 0;
const freeFor = (z, dir, targetId) => !z.exits?.[dir] || z.exits[dir] === targetId; // dir open or already ours
const setExit = (z, dir, targetId) => {
  if (!z.exits) z.exits = {};
  if (z.exits[dir] === targetId) return false;
  z.exits[dir] = targetId; return true;
};
for (const z of Object.values(underByCoord)) {
  for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
    const nb = underByCoord[`${z.grid_x + dx},${z.grid_y + dy}`];
    if (!nb) continue;
    // Skip any adjacency that touches a sealed seam / nook on either side.
    if (SEAL.has(z.id) || SEAL.has(nb.id)) continue;
    // Only auto-link if at least one side is newly generated (don't re-mesh the
    // hand-authored bespoke network against itself).
    if (!isNew.has(z.id) && !isNew.has(nb.id)) continue;
    // Transactional: only link if BOTH directions can be set — never leave a
    // one-way (e.g. a neighbour whose reciprocal exit is an authored door).
    if (!freeFor(z, dir, nb.id) || !freeFor(nb, OPP[dir], z.id)) continue;
    if (setExit(z, dir, nb.id)) { linksAdded++; if (!isNew.has(z.id)) touchedExisting.add(z.id); }
    if (setExit(nb, OPP[dir], z.id)) { linksAdded++; if (!isNew.has(nb.id)) touchedExisting.add(nb.id); }
  }
}

// name + marker each new tile by its final connectivity
for (const z of newTiles) {
  const dirs = new Set(Object.keys(z.exits));
  z.marker = markFor(dirs);
  z.name = NAME_BY_DEG[dirs.size] || 'Sewer Line';
}

// --- reachability: connect isolated generated components to the surface -----
// Build adjacency among under tiles only
const underList = Object.values(underByCoord);
const byId = {}; for (const z of underList) byId[z.id] = z;
const neighbors = z => Object.values(z.exits || {}).filter(t => byId[t]);
// Seed BFS from tiles known reachable from the surface: existing bespoke tiles
// that carry an up/down to a non-sewer zone, plus every existing bespoke tile
// (they hang off the sump entrance already).
const reachable = new Set();
const queue = [];
for (const z of underList) {
  if (isNew.has(z.id)) continue;               // existing bespoke = reachable seed
  reachable.add(z.id); queue.push(z);
}
while (queue.length) {
  const z = queue.shift();
  for (const t of neighbors(z)) if (!reachable.has(t)) { reachable.add(t); queue.push(byId[t]); }
}
// Any generated tile not reachable → find its component, add one riser.
const drains = [];
const seen = new Set();
for (const z of newTiles) {
  if (reachable.has(z.id) || seen.has(z.id)) continue;
  // flood the component
  const comp = []; const q = [z]; seen.add(z.id);
  while (q.length) { const c = q.shift(); comp.push(c); for (const t of neighbors(c)) if (byId[t] && isNew.has(t) && !seen.has(t) && !reachable.has(t)) { seen.add(t); q.push(byId[t]); } }
  // pick the component tile whose surface road tile exists; add a riser there
  const host = comp.find(c => surfByCoord[`${c.grid_x},${c.grid_y}`]) || comp[0];
  const surf = surfByCoord[`${host.grid_x},${host.grid_y}`];
  if (surf) {
    host.exits.up = surf.id;
    if (!surf.exits) surf.exits = {};
    if (!surf.exits.down) { surf.exits.down = host.id; touchedExisting.add(surf.id); }
    drains.push({ under: host.id, surface: surf.id, size: comp.length });
    for (const c of comp) reachable.add(c.id);
  }
}

// --- write -----------------------------------------------------------------
const writeZone = z => writeFileSync(`${ZDIR}/${fileOf[z.id]}`, JSON.stringify(z, null, 2) + '\n');
for (const z of newTiles) {
  writeZone(z);
  writeFileSync(`${PDIR}/${z.id}.json`, JSON.stringify({
    capacity_kw: 0, flags: {}, generator_id: null, id: z.id,
    max_capacity_kw: 0, name: z.name, source_type: 'city_grid',
  }, null, 2) + '\n');
}
for (const id of touchedExisting) if (!isNew.has(id)) writeZone(zones[id]);

console.log(`road tiles: ${roadTiles.length}`);
console.log(`new under tiles: ${newTiles.length}`);
console.log(`reciprocal exits added: ${linksAdded}`);
console.log(`existing/surface tiles touched (exits added): ${touchedExisting.size}`);
console.log(`storm-drain risers added for reachability: ${drains.length}`);
for (const d of drains) console.log(`   riser: ${d.surface} <-> ${d.under} (component ${d.size})`);
