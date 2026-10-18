/**
 * Three Filaments buildings off the map for now: Skeleton Crew (898,905), Rest Assured (900,905)
 * and Corner the Market (897,907).
 *
 *   node scripts/content/set-aside-kettle-three.mjs [--dry-run]
 *
 * They stood on the Glasshouse's edge along Halcyon Boulevard and read wrong beside its towers, and
 * the Filaments-to-Glasshouse transition there wants designing before anything goes back. They're
 * SET ASIDE, not deleted, the way the Hughson Coliseum's block was
 * (docs/proposals/hughson-coliseum.md#3-what-was-set-aside): each facade tile moves onto
 * `map_set_aside` with its id, prose, flags, interior, furniture and keeper, and a grass tile with a
 * new id (zone_kettle_<x>_<y>) takes its plot on the world.
 *
 * ⚠ A SET-ASIDE FACADE HAS NO STREET. Its `world_exit_zone` names itself, so the way out of its
 * rooms stays on the holding map, which regress checks.
 *
 * ⚠ BASIL QUENNELL LIVES IN THE FILAMENT BUILDINGS, which stay, so he isn't set aside. His
 * `work_zone_id` goes to null instead, as Nessa Marrit's did when Lather & Lye was stored.
 *
 * Run `node scripts/content/mint-connections.mjs --write` afterwards. Idempotent.
 */
import fs from 'fs';
import path from 'path';
import { loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const HOLD = 'map_set_aside';
const oldId = (x, y) => `zone_district_${x}_${y}`;
const newId = (x, y) => `zone_kettle_${x}_${y}`;

// [x, y, holding-map grid x, holding-map grid y, keeper set aside, grass name, grass description]
// The holding grid starts at row 5, clear of the Coliseum's old block in 1-3 x 1-3.
const SITES = [
  [898, 905, 1, 5, 'npc_skel_bandy', 'Kettle Green',
    'A strip of rough grass between the Filament Buildings and Kettle Lane, as wide as a shopfront. Pale footings show through the turf where something narrow once stood, and a bent iron bracket is still bolted to the next wall.'],
  [900, 905, 3, 5, 'npc_dilys_trantham', 'Kettle Green',
    'A cleared plot off Kettle Lane, grassed over except for three rectangles of brick where doorways were. A board leans on the fence with the word NIGHTLY on it and the rest painted out.'],
  [897, 907, 5, 5, null, 'Kettle Green',
    'A corner of trodden grass where Filament Street meets the green. A square of paler turf marks where crates used to stand, and a few small ads are still taped to the lamp post, faded past reading.'],
];
const STREET_CONNS = ['conn_district_898_905_south_nqax'];

for (const [x, y, gx, gy, keeper, name, description] of SITES) {
  const id = oldId(x, y), z = store.get('zones', id);
  if (!z) throw new Error(`${id} does not exist`);
  const facade = z.flags?.facade;

  // 1. The facade moves to the holding map, keeping only its link into its own rooms.
  if (z.map_id === 'map_world') {
    const exits = {};
    for (const [dir, to] of Object.entries(z.exits || {})) {
      const t = store.get('zones', to);
      if (t && t.map_id !== 'map_world' && t.parent_zone === id) exits[dir] = to;
    }
    const flags = { ...z.flags, set_aside: true, set_aside_from: `${x},${y}` };
    if (facade) flags.world_exit_zone = id;
    store.put('zones', { ...z, map_id: HOLD, grid_x: gx, grid_y: gy, grid_z: 0, exits, flags });
  }
  if (keeper) {
    const n = store.get('npcs', keeper);
    if (!n) throw new Error(`${keeper} does not exist`);
    store.patch('npcs', keeper, { flags: { ...(n.flags || {}), set_aside: true } });
  }

  // 2. Grass on the plot, joined to every open neighbour both ways.
  const gid = newId(x, y);
  const like = store.get('zones', 'zone_district_896_905');
  const exits = {};
  for (const [dir, dx, dy, back] of [['north', 0, -1, 'south'], ['south', 0, 1, 'north'], ['east', 1, 0, 'west'], ['west', -1, 0, 'east']]) {
    const nx = x + dx, ny = y + dy;
    const nb = store.all('zones').find((q) => q.map_id === 'map_world' && q.grid_x === nx && q.grid_y === ny && (q.grid_z ?? 0) === 0 && q.id !== gid);
    if (!nb || nb.flags?.facade || nb.flags?.building_type) continue;
    exits[dir] = nb.id;
    store.patch('zones', nb.id, { exits: { ...(nb.exits || {}), [back]: gid } });
  }
  const prev = store.get('zones', gid) || {};
  const fill = {};
  for (const k of Object.keys(like)) fill[k] = k === 'flags' || k === 'exits' ? {} : (Array.isArray(like[k]) ? [] : null);
  store.put('zones', {
    ...fill, ...prev, id: gid, name, description,
    map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, parent_zone: null,
    exits, ambient_theme: 'city', ambient_events: prev.ambient_events || [],
    flags: { district: 'filaments', region_id: 'region_coldwater', terrain: 'grass' },
  });
  const pz = store.get('power_zones', id);
  if (pz) store.patch('power_zones', gid, { ...pz, id: gid, name });
}

// Nothing on the world points at a set-aside facade any more.
const gone = new Set(SITES.map(([x, y]) => oldId(x, y)));
for (const z of store.all('zones')) {
  if (z.map_id !== 'map_world') continue;
  const exits = { ...(z.exits || {}) };
  let changed = false;
  for (const [dir, to] of Object.entries(exits)) if (gone.has(to)) { delete exits[dir]; changed = true; }
  if (changed) store.patch('zones', z.id, { exits });
}

// Corner the Market's grocer lives upstairs in the Filament Buildings, which stay.
store.patch('npcs', 'npc_basil_quennell', { work_zone_id: null });

const written = store.flush({ dryRun: DRY });
const removed = [];
for (const id of STREET_CONNS) {
  const p = path.join(store.baseDir, 'connections', `${id}.json`);
  if (fs.existsSync(p)) { removed.push(p); if (!DRY) fs.unlinkSync(p); }
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s), ${removed.length} connection file(s) removed`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
