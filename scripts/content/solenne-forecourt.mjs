// ONE-SHOT: the Solenne back on one tile (docs/proposals/multi-tile-buildings.md). Its three sealed quarters
// (914,908, 914,907 and 915,907) become the Solenne's forecourt: park ground with the `forecourt` dressing laid
// round the tower, walkable, with reciprocal exits to every walkable neighbour. The blocked walls
// solenne-footprint.mjs had mint-connections write round them are deleted.
//
//   node scripts/content/solenne-forecourt.mjs [--write]
//   then: npm run content:import, and delete the blocked rows the import can't see (it prints the ids)
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';

const WRITE = process.argv.includes('--write');
const Z = path.resolve('content/zones'), C = path.resolve('content/connections');
const FACADE = 'zone_district_914_908';
const TILES = {
  zone_seam_914_908: { name: 'Solenne Forecourt', text: "Pale stone flags along Marrow Street in front of the Solenne Residences, clipped box hedges in bronze troughs and a doorman who watches you not live here." },
  zone_seam_914_907: { name: 'Solenne Gardens', text: "A lawn behind the Solenne, kept short by a machine that does it at night. Benches face the tower, and the tower's glass faces the river." },
  zone_district_914_907: { name: 'Solenne Gardens', text: "Gravel walks and lit planters beside the Solenne Residences. A sign on a brass post says the gardens are for residents, and nobody enforces it." },
};
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const BACK = { north: 'south', south: 'north', east: 'west', west: 'east' };

const all = new Map();
for (const f of fs.readdirSync(Z)) if (f.endsWith('.json')) { const z = JSON.parse(fs.readFileSync(path.join(Z, f), 'utf8')); all.set(z.id, z); }
const at = new Map();
for (const z of all.values()) if (z.map_id === 'map_world' && (z.grid_z ?? 0) === 0) at.set(`${z.grid_x},${z.grid_y}`, z);
const facade = all.get(FACADE);
if (!all.get('zone_seam_914_908')?.flags?.building_type?.startsWith('solenne')) { console.log('solenne-forecourt: already done'); process.exit(0); }

const writes = new Map();
const get = (id) => writes.get(id) || all.get(id);
for (const [id, t] of Object.entries(TILES)) {
  const z = all.get(id);
  writes.set(id, {
    ...z, name: t.name, description: t.text, color: '#8fd08a',
    ambient_events: ['A resident walks a small expensive dog past you without looking down.', 'Somebody on a high balcony shakes out a rug over the gardens.'],
    ambient_theme: 'urban',
    flags: { district: facade.flags.district, region_id: facade.flags.region_id, terrain: 'park', park_feature: 'forecourt', park_focus: { x: facade.grid_x, y: facade.grid_y }, street_life: true },
    exits: {},
  });
}
const ids = new Set(Object.keys(TILES));
const walkable = (n) => ids.has(n.id) || !(n.flags?.building_type || n.flags?.is_building || n.flags?.facade);
for (const id of ids) {
  const z = get(id);
  for (const [d, [ox, oy]] of Object.entries(DIRS)) {
    const n = at.get(`${z.grid_x + ox},${z.grid_y + oy}`);
    if (!n || !walkable(n)) continue;
    z.exits[d] = n.id;
    const nz = get(n.id);
    writes.set(n.id, { ...nz, exits: { ...nz.exits, [BACK[d]]: id } });
  }
}
// the blocked walls round the old quarters
const dead = [];
for (const f of fs.readdirSync(C)) {
  if (!f.endsWith('.json')) continue;
  const c = JSON.parse(fs.readFileSync(path.join(C, f), 'utf8'));
  if (c.blocked && (ids.has(c.a) || ids.has(c.b))) dead.push([f, c.id]);
}
for (const [id, z] of writes) {
  console.log(`${WRITE ? 'wrote' : 'would write'} content/zones/${id}.json  exits ${JSON.stringify(z.exits)}`);
  if (WRITE) fs.writeFileSync(path.join(Z, `${id}.json`), canonicalJson(z));
}
for (const [f, id] of dead) {
  console.log(`${WRITE ? 'deleted' : 'would delete'} content/connections/${f}`);
  if (WRITE) fs.unlinkSync(path.join(C, f));
}
if (dead.length) console.log(`blocked rows to delete from the DB: ${dead.map(([, id]) => `'${id}'`).join(', ')}`);
