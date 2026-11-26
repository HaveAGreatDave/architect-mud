// One-shot: Rest Assured, the rooming house set aside from 900,905 on 2026-10-18, back on the map at 917,904 on
// Lever Lane, in the Yards, to house people from the Yards Tenement's refit (docs/proposals/model-plan.md).
//
//   node scripts/content/rest-assured-east.mjs [--write]
//
// 1. The facade (zone_district_900_905, its id kept as every set-aside facade keeps it) leaves the holding map for
//    world grid 917,904, its door east onto Lever Lane, its set-aside flags gone and its district the Yards.
// 2. The grass tile that was there (zone_district_916_904) goes onto the holding map in the cell Rest Assured left,
//    3,5, with `set_aside` and `set_aside_from`, as the Coliseum's displaced greens did. Nothing is deleted.
// 3. The neighbours' exits follow: Lever Lane's west now reaches the facade, and the grass to the north and west lose
//    theirs (a facade is a wall on every side but its door).
// 4. Dilys Trantham, its keeper, who lives in the front hall, is no longer set aside.
// The rooms themselves are the generator's (scripts/content/plans/rest_assured.json, plan-rooms.mjs --replace).
//
// It refuses to run twice: once the facade is on the world map there's nothing to do.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';

const C = path.resolve(process.cwd(), 'content');
const WRITE = process.argv.includes('--write');
const file = (dir, id) => path.join(C, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
const writes = new Map();
const put = (dir, obj) => writes.set(`${dir}/${obj.id}`, obj);

const F = 'zone_district_900_905', GRASS = 'zone_district_916_904', LANE = 'zone_district_917_904';
const facade = read('zones', F);
if (facade.map_id === 'map_world') { console.log('rest-assured-east: already done'); process.exit(0); }
const grass = read('zones', GRASS);
if (grass.map_id !== 'map_world' || grass.flags?.is_building) throw new Error(`${GRASS} isn't open ground any more; run sitecheck again`);

// 1. the facade
const { set_aside, set_aside_from, ...fflags } = facade.flags;
put('zones', {
  ...facade, map_id: 'map_world', grid_x: 917, grid_y: 904, grid_z: 0, parent_zone: null,
  exits: { east: LANE },   // the generator adds the way in, west to the hall
  flags: { ...fflags, district: 'yards', entrance: 'east', world_exit_zone: LANE },
});

// 2. the grass onto the holding map, in the cell Rest Assured left
put('zones', { ...grass, map_id: 'map_set_aside', grid_x: facade.grid_x, grid_y: facade.grid_y, grid_z: 0, exits: {}, parent_zone: null, flags: { ...grass.flags, set_aside: true, set_aside_from: '917,904' } });

// 3. the neighbours
for (const id of Object.keys(grass.exits).map((d) => grass.exits[d])) {
  const z = read('zones', id), exits = { ...z.exits };
  for (const [d, t] of Object.entries(exits)) if (t === GRASS) { if (id === LANE) exits[d] = F; else delete exits[d]; }
  put('zones', { ...z, exits });
}
const stale = fs.readdirSync(path.join(C, 'connections')).filter((f) => { const c = JSON.parse(fs.readFileSync(path.join(C, 'connections', f), 'utf8')); return c.a === GRASS || c.b === GRASS; });
if (stale.length) throw new Error(`connection files name ${GRASS}: ${stale.join(', ')}; deal with them by hand first`);

// 4. the keeper
const dilys = read('npcs', 'npc_dilys_trantham');
const { set_aside: _s, ...dflags } = dilys.flags || {};
put('npcs', { ...dilys, flags: dflags });

for (const [k, obj] of writes) {
  const [dir] = k.split('/');
  console.log(`${WRITE ? 'wrote' : 'would write'} content/${dir}/${obj.id}.json`);
  if (WRITE) fs.writeFileSync(file(dir, obj.id), canonicalJson(obj));
}
if (!WRITE) console.log('dry run: --write to write');
