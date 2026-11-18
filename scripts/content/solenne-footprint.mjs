// ONE-SHOT: the Solenne Residences on four tiles (docs/proposals/multi-tile-buildings.md). The tower now stands on
// 914-915 by 907-908: its facade is the tile it always had (zone_district_914_908, at 915,908 since the column at
// x 914 went in) and the other three are sealed quarters of it.
//
//   node scripts/content/solenne-footprint.mjs [--write]
//   then: node scripts/content/mint-connections.mjs --write   (walls the three quarters in)
//
//   - 914,908, 914,907 and 915,907 become Solenne Residences: `solenne_sw`, `solenne_nw` and `solenne_ne`, each the
//     glass/models/downtown.js `solenne` arm's own quarter (glass/model-registry.js). No `building_name`: the facade's
//     row is bound by that name and would put the door on every tile. No `is_building`, so no map code, as Golden
//     Goose Gardens' sealed tiles have none. `part_of` names the facade, so ROOM takes the whole tower off the view
//     out of its windows (room-view.js withoutOwnTower) and not just the facade's quarter.
//   - Every tile of it is 45 floors, the floors the lift already stops at.
//   - Their exits go, and so do their neighbours' exits into them; mint-connections then writes the blocked walls,
//     because is_building doesn't stop the grid (hughson-towers.md).
//   - The facade's text and the lobby's street door: a stone portal, a sunburst, sliding doors 3.2 m across, an
//     oxblood runner out to the kerb.
// It refuses to run twice: once 914,908 is solenne_sw there's nothing to do.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';

const WRITE = process.argv.includes('--write');
const Z = path.resolve('content/zones');
const read = (id) => JSON.parse(fs.readFileSync(path.join(Z, `${id}.json`), 'utf8'));
const FACADE = 'zone_district_914_908';
const PARTS = {
  zone_seam_914_908: { type: 'solenne_sw', at: [914, 908], text: "The west half of the Solenne's frontage on Marrow Street: champagne glass in bronze frames over a glazed podium, and the stone pier at its corner." },
  zone_seam_914_907: { type: 'solenne_nw', at: [914, 907], text: "The back of the Solenne Residences, its glass stepping in three times on the way up, the lap pool's glass rail along the terrace forty floors over the grass." },
  zone_district_914_907: { type: 'solenne_ne', at: [915, 907], text: "The east flank of the Solenne Residences, a gold light running up every corner of its glass to the lantern on top." },
};

const facade = read(FACADE);
if (read('zone_seam_914_908').flags?.building_type === 'solenne_sw') { console.log('solenne-footprint: already done'); process.exit(0); }
if (facade.grid_x !== 915 || facade.grid_y !== 908) throw new Error(`the Solenne's facade is at ${facade.grid_x},${facade.grid_y}, not 915,908`);

const writes = new Map();
for (const [id, p] of Object.entries(PARTS)) {
  const z = read(id);
  if (z.grid_x !== p.at[0] || z.grid_y !== p.at[1] || z.map_id !== 'map_world') throw new Error(`${id} is at ${z.grid_x},${z.grid_y}, not ${p.at}`);
  if (z.flags?.is_building || z.flags?.facade) throw new Error(`${id} is already a building`);
  const { color: _c, bg_color: _b, marker: _m, ...rest } = z;
  writes.set(id, {
    ...rest, name: 'Solenne Residences', description: p.text, exits: {}, ambient_theme: 'urban', ambient_events: [],
    flags: { building_type: p.type, district: facade.flags.district, entrance: 'south', floors: 45, part_of: FACADE, region_id: facade.flags.region_id },
  });
}
writes.set(FACADE, {
  ...facade,
  description: "Solenne Residences: forty-five floors of champagne glass on a stone podium, stepping in three times before a slender top and a lantern crown, with a landing pad cantilevered off the corner. A stone portal stands out of the podium, a gold sunburst over sliding glass doors and a brass-lettered canopy out to the kerb. Step <b>north</b>.",
  flags: { ...facade.flags, floors: 45 },
});
// the neighbours' ways into the three quarters
const ids = new Set(Object.keys(PARTS));
for (const f of fs.readdirSync(Z)) {
  if (!f.endsWith('.json')) continue;
  const z = JSON.parse(fs.readFileSync(path.join(Z, f), 'utf8'));
  if (ids.has(z.id) || !z.exits) continue;
  const exits = Object.fromEntries(Object.entries(z.exits).filter(([, to]) => !(typeof to === 'string' ? ids.has(to) : Array.isArray(to) && to.some((t) => ids.has(t)))));
  if (Object.keys(exits).length !== Object.keys(z.exits).length) writes.set(z.id, { ...(writes.get(z.id) || z), exits });
}
// the lobby's street door
const lobby = read('zone_solenne_lobby');
writes.set(lobby.id, { ...lobby, flags: { ...lobby.flags, room: { ...lobby.flags.room, street_door: { ...lobby.flags.room.street_door, w: 3.2, runner: '#5a1a1e' } } } });

for (const [id, z] of writes) {
  console.log(`${WRITE ? 'wrote' : 'would write'} content/zones/${id}.json`);
  if (WRITE) fs.writeFileSync(path.join(Z, `${id}.json`), canonicalJson(z));
}
console.log(`solenne-footprint: ${writes.size} files${WRITE ? '' : ' (dry run; pass --write)'}`);
