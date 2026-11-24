// Coldwater Regional's landside (docs/proposals/airport-landside.md). WRITES CONTENT FILES.
//
// Before this, the only way to the terminal on foot was up the runway from Kessler Street. This:
//   1. stores Stack Overflow (925,907) as rooms only, so the road can pass (stored-buildings.md);
//   2. lays Airport Road on 925,905..907, north off Kessler Street;
//   3. lays the Departures Forecourt on 925,904 and turns the terminal's door to face it (south);
//   4. builds Airport Parking Plaza on 924,904, a copy of Marrow Street Parking (af_stackeddeck),
//      its door east onto the forecourt.
// The landside tiles keep no exits to the runway: the apron is airside.
// Run once from the repo root: node scripts/content/airport-landside.mjs. It refuses a second run.
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const P = (dir, id) => join(CONTENT_DIR, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(readFileSync(P(dir, id), 'utf8'));
const write = (dir, obj) => writeFileSync(P(dir, obj.id), canonicalJson(obj));
const drop = (dir, id) => { if (existsSync(P(dir, id))) unlinkSync(P(dir, id)); };
const touched = [];
const put = (dir, obj) => { write(dir, obj); touched.push(`${dir}/${obj.id}.json`); };

if (existsSync(P('zones', 'zone_apark_lobby'))) { console.error('Already run: zone_apark_lobby exists.'); process.exit(1); }

// ids east of column 914 are one less than the grid
const Z = (gx, gy) => `zone_district_${gx - 1}_${gy}`;
const ROAD = [Z(925, 905), Z(925, 906), Z(925, 907)], FORE = Z(925, 904), GAR = Z(924, 904), DEP = Z(925, 903);
const setExit = (id, dir, to) => { const z = read('zones', id); z.exits = { ...(z.exits || {}) };
  if (to) z.exits[dir] = to; else delete z.exits[dir]; put('zones', z); };

// ── 1. Stack Overflow off the map ─────────────────────────────────────────────────────────────
{ const y = read('zones', 'zone_yard_container');
  y.parent_zone = null; y.exits = { ...y.exits }; delete y.exits.south; delete y.flags.world_exit_zone;
  put('zones', y);
  const u = read('zones', 'zone_util_zone_yard_container'); u.parent_zone = null; put('zones', u);
  const m = read('maps', 'map_int_yard_container'); m.parent_zone_id = null; put('maps', m);
  for (const n of ['npc_dealer_sorel', 'npc_gantry_lookout']) { const c = read('npcs', n); c.work_zone_id = null; put('npcs', c); }
  drop('connections', 'conn_district_924_907_north_uuse');
  drop('doors', 'door_basic_zone_district_924_907_in'); }

// ── 2. Airport Road ───────────────────────────────────────────────────────────────────────────
const roadProse = {
  [Z(925, 907)]: 'Airport Road leaves Kessler Street between the fuel yard and the runway fence, two lanes of new asphalt with the paint still bright. A sign on a gantry says COLDWATER REGIONAL with an arrow north, and under it, smaller, PARKING.',
  [Z(925, 906)]: 'Airport Road runs north on fill tipped into the Basin, water on the left behind a crash barrier and the runway fence on the right. Jet wash comes over the fence every few minutes and rattles it.',
  [Z(925, 905)]: 'The last stretch of Airport Road, with the wharf off to the west. Ahead the road widens into the terminal forecourt, and the parking garage stands at its west side with its blue sign lit.',
};
for (const id of ROAD) {
  const z = read('zones', id);
  const [gx, gy] = [z.grid_x, z.grid_y];
  Object.assign(z, { name: 'Airport Road', description: roadProse[id], ambient_theme: 'city', ambient_events: [
    'A taxi goes past toward the terminal with its light off.',
    'A jet lifts off beyond the fence and the noise arrives a second later.'] });
  z.flags = { district: 'docks', region_id: 'region_coldwater', terrain: 'road' };
  delete z.marker; delete z.color; delete z.bg_color;
  z.exits = { north: Z(gx, gy - 1), south: Z(gx, gy + 1) };
  if (gy === 905) z.exits.west = Z(924, 905);   // Crane Damage
  if (gy === 906) z.exits.west = Z(924, 906);   // The Boom Economy
  put('zones', z);
}
// the runway fence: no way from the road onto the runway, either way
for (const gy of [904, 905, 906]) setExit(Z(926, gy), 'west', null);
setExit(Z(926, 907), 'west', null);

// ── 3. The forecourt, and the terminal's door onto it ─────────────────────────────────────────
{ const z = read('zones', FORE);
  Object.assign(z, { name: 'Departures Forecourt', ambient_theme: 'city',
    description: 'A drop-off lane under the terminal\'s glass canopy, with a taxi rank, a row of steel benches and a sign that says NO WAITING in four languages. Departures is <b>north</b>, the parking garage <b>west</b> and Airport Road <b>south</b>.',
    ambient_events: ['A taxi pulls up, lets somebody out with two bags and pulls away.',
      'The canopy\'s speakers say the forecourt is for dropping off only.',
      'Somebody runs for the doors with a boarding pass in their teeth.'] });
  z.flags = { district: 'docks', region_id: 'region_coldwater', terrain: 'concrete', airfield_id: 'af_regional' };
  delete z.color; delete z.bg_color;
  z.exits = { north: DEP, south: Z(925, 905), west: GAR };
  put('zones', z); }
{ const d = read('zones', DEP);
  d.flags = { ...d.flags, entrance: 'south' };
  d.exits = { east: Z(926, 903), south: FORE, north: 'zone_cw_checkin' };
  put('zones', d);
  const c = read('connections', 'conn_district_924_903_west_dp01'); drop('connections', c.id);
  put('connections', { ...c, id: 'conn_district_924_903_north_dp01', dir: 'north' });
  const k = read('zones', 'zone_cw_checkin'); k.exits = { ...k.exits }; delete k.exits.east; k.exits.south = DEP;
  k.description = (k.description || '').replace(/<b>east<\/b>/g, '<b>south</b>');
  put('zones', k); }

// ── 4. Airport Parking Plaza: Marrow Street Parking, copied ───────────────────────────────────
const NAME = 'Airport Parking Plaza';
const re = (s) => s
  .replaceAll('zone_seam_914_908', GAR).replaceAll('zone_sdeck_', 'zone_apark_').replaceAll('furn_sdeck_', 'furn_apark_')
  .replaceAll('conn_sdeck_', 'conn_apark_').replaceAll('map_int_stackeddeck', 'map_int_apark')
  .replaceAll('af_stackeddeck', 'af_apark').replaceAll('Marrow Street Parking', NAME)
  .replaceAll('to the street below', 'to the forecourt below').replaceAll('smells of the river', 'smells of jet fuel');
const clone = (dir, prefix) => {
  for (const f of readdirSync(join(CONTENT_DIR, dir)).filter((f) => f.startsWith(prefix))) {
    const o = JSON.parse(re(readFileSync(join(CONTENT_DIR, dir, f), 'utf8')));
    if (dir === 'zones' && o.id === 'zone_apark_lobby') {
      o.exits = { in: 'zone_apark_lift', east: GAR };
      o.flags.world_exit_zone = GAR;
      o.description = 'A concrete room the width of the building, painted the blue of the sign as far as the paint went. A pay station by the lift says PARKING FREE, with a phone number for lost tickets taped under it. The lift is <b>in</b> and the forecourt is <b>east</b>.';
    }
    put(dir, o);
  }
};
clone('zones', 'zone_sdeck_');
clone('connections', 'conn_sdeck_');
clone('furniture', 'furn_sdeck_');
for (const f of readdirSync(join(CONTENT_DIR, 'power_zones')).filter((f) => f.startsWith('zone_sdeck_'))) {
  const o = JSON.parse(re(readFileSync(join(CONTENT_DIR, 'power_zones', f), 'utf8'))); put('power_zones', o); }
{ const c = read('connections', 'conn_apark_facade_north'); drop('connections', c.id);
  touched.splice(touched.indexOf('connections/conn_apark_facade_north.json'), 1);
  put('connections', { ...c, id: 'conn_apark_facade_west', dir: 'west' }); }
put('maps', { ...JSON.parse(re(readFileSync(P('maps', 'map_int_stackeddeck'), 'utf8'))) });
put('airfields', { ...read('airfields', 'af_stackeddeck'), id: 'af_apark', name: NAME });
{ const s = read('zones', 'zone_seam_914_908'), g = read('zones', GAR);
  Object.assign(g, { name: NAME, marker: 'PP', color: s.color, bg_color: s.bg_color, ambient_theme: 'urban',
    description: 'Five open decks of grey precast at the west side of the terminal forecourt, with small aircraft parked on every one behind a steel mesh. A lift tower runs up one corner to a landing pad on the roof. AIRPORT PARKING PLAZA is lit in blue over the door, and a board under it says VTOL PARKING: FREE.',
    ambient_events: ['Somewhere inside the decks a carousel turns with a long hydraulic groan and stops.',
      'A small VTOL drops onto the roof pad and its rotors wind down.',
      'The lift tower\'s red light blinks on top.'] });
  g.flags = { airfield_id: 'af_apark', building_name: NAME, building_type: 'vtol_park', district: 'docks', entrance: 'east',
    facade: true, floors: 5, hangar_interior_zone: 'zone_apark_pad', is_building: true, region_id: 'region_coldwater', world_exit_zone: FORE };
  g.exits = { east: FORE, west: 'zone_apark_lobby' };
  put('zones', g); }
// the garage was water: nothing but the forecourt reaches its tile now
setExit(Z(924, 903), 'south', null);
setExit(Z(924, 905), 'north', null);
setExit(Z(923, 904), 'east', null);
// the model binds by name: give Marrow Street's model the new name too
{ const p = join(CONTENT_DIR, 'building_models', 'stackeddeck.json'), m = JSON.parse(readFileSync(p, 'utf8'));
  if (!m.bind.some((b) => b.key === NAME)) m.bind.push({ by: 'name', key: NAME });
  writeFileSync(p, canonicalJson(m)); touched.push('building_models/stackeddeck.json'); }

console.log([...new Set(touched)].sort().join('\n'));
