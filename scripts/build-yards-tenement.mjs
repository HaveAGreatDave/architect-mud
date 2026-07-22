// build-yards-tenement.mjs — generate "The Yards Tenement": a broken-down 10-storey
// slum block off Dray Lane, 6 identical rentable units per floor = 60, for NPC housing.
// File-authoring: emits content zones/map/power_zones/furniture following the Chrome
// Court pattern exactly. Idempotent. Run: node scripts/build-yards-tenement.mjs
//
// Structure: Dray Lane (921,903) —north— facade(921,902, converted grassland) —in—
// lobby —up— f1..f10 (each: 6 units via n/e/s/w/ne/nw) ; lobby —down— util (junction box).
// Every interior zone gets a power_zone (fed by the util junction box) and a light.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = '1783970000';
const sortKeys = (x) => Array.isArray(x) ? x.map(sortKeys)
  : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sortKeys(x[k])])) : x;
const write = (rel, o) => writeFileSync(join(ROOT, rel), JSON.stringify(sortKeys(o), null, 2) + '\n');
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const FACADE = 'zone_district_921_902';      // grassland → tenement facade
const STREET = 'zone_district_921_903';      // Dray Lane
const MAP = 'map_int_yards_tenement';
const LOBBY = 'zone_yards_tenement_lobby';
const UTIL = 'zone_yards_tenement_util';
const GEN = 'gen_yards_tenement_util';
const FLOORS = 10, PER_FLOOR = 6;
const RENT = 25;
const floorId = (f) => `zone_yards_tenement_f${f}`;
const unitId = (f, i) => `zone_yards_tenement_u${f}_${i}`;
const unitNum = (f, i) => `${f}${String(i).padStart(2, '0')}`;   // 101..106 … 1001..1006
// floor→unit exit dirs and the unit's reciprocal back to the floor
const DIRS = [['north', 'south'], ['east', 'west'], ['south', 'north'], ['west', 'east'], ['northeast', 'southwest'], ['northwest', 'southeast']];

let zones = 0, powers = 0, furns = 0;

const zone = (o) => { write(`content/zones/${o.id}.json`, {
  ambient_events: [], ambient_theme: 'indoors', audio_theme_id: null, bg_color: '#5a5450', color: null,
  created_by: 'tenement-gen', marker: null, parent_zone: LOBBY, updated_at: STAMP, grid_x: 0, grid_y: 0, grid_z: 0, map_id: MAP,
  ...o }); zones++; };
const power = (id, name) => { write(`content/power_zones/${id}.json`, {
  id, name, capacity_kw: 5400, max_capacity_kw: 5400, generator_id: GEN, source_type: 'junction_box', flags: {} }); powers++; };
const light = (zid) => { write(`content/furniture/furn_light_${zid}.json`, {
  id: `furn_light_${zid}`, zone_id: zid, name: 'a bare bulb', object_type: 'light', light_type: 'overhead',
  lumen_output: 900, power_draw_kw: null, price: 40, hp: null, hp_max: null,
  description: 'A bare bulb on a frayed cord, buzzing and browning at the filament — more a threat than a light, but it beats the dark.',
  flags: { interactions: ['switch'] } }); furns++; };

// ── Facade: convert the grassland (keep its street exits, overlay the building) ──
const fac = read(`content/zones/${FACADE}.json`);
fac.name = 'The Yards Tenement';
fac.description = 'A ten-storey slab of stained precast concrete shoved in between the freight lanes, its ground-floor windows bricked over and its upper ones dark, cracked, or gone. A board wired to the door reads ROOMS TO LET, and under it, in a shakier hand, NO REFUNDS NO EXCEPTIONS. It is the closest thing the Yards has to somewhere to live.';
fac.marker = 'TN';
fac.bg_color = '#4a4642';
fac.flags = { ...fac.flags, building_name: 'The Yards Tenement', building_type: 'apartment', district: 'yards',
  entrance: 'south', facade: true, is_building: true, floors: 10, world_exit_zone: STREET };
fac.exits = { ...fac.exits, in: LOBBY };   // keep the 4 grassland neighbour exits; add the door
fac.ambient_events = [
  'Somewhere above, a window bangs open and a voice tells the whole Yards, at length, exactly what it can do with itself.',
  'A sheet of freight manifest tumbles across the mouth of the door and keeps going, headed nowhere in particular.',
  'A light in an upper window flickers on, thinks better of it, and goes back out.',
  'Down the wall, a drainpipe empties a long grey ribbon of water onto the kerb.',
];
fac.updated_at = STAMP;
write(`content/zones/${FACADE}.json`, fac);

// ── Map entity ──
write(`content/maps/${MAP}.json`, {
  id: MAP, name: 'The Yards Tenement — Interior', entry_zone_id: LOBBY, parent_zone_id: FACADE, created_by: null, updated_at: STAMP });

// ── Lobby (ground) ──
zone({ id: LOBBY, name: 'The Yards Tenement — Lobby', parent_zone: FACADE, grid_z: 0,
  description: 'A cramped ground-floor lobby: a wall of dented mailboxes, half of them hanging open and empty, a buzzer panel with every wire yanked out, and a concrete stairwell that smells of damp, mildew, and somebody else’s dinner three floors up. A strip light overhead flickers like it’s thinking it over.',
  ambient_events: ['A door slams somewhere up the stairwell and the sound rolls all the way down.', 'The strip light buzzes, dies for a second, and grudgingly comes back.'],
  flags: { building_name: 'The Yards Tenement', building_type: 'apartment', is_building: true, is_interior: true, world_exit_zone: FACADE },
  exits: { south: FACADE, up: floorId(1), down: UTIL } });
power(LOBBY, 'The Yards Tenement — Lobby'); light(LOBBY);

// ── Basement utility (the junction box) ──
zone({ id: UTIL, name: 'The Yards Tenement — Sub-basement', grid_z: -1,
  description: 'The tenement’s guts: a low, sweating concrete sub-basement of riser conduits, a long-dead boiler, and a floor drain choked with grit. A single junction box feeds all ten floors and trips if you so much as breathe on it wrong.',
  ambient_events: ['Water ticks off a riser somewhere in the dark.', 'The junction box hums, catches, and settles.'],
  flags: { is_interior: true }, exits: { up: LOBBY } });
power(UTIL, 'The Yards Tenement — Sub-basement');
// the generator the junction box IS — links the tenement's power_zones to the city grid
write(`content/generators/${GEN}.json`, {
  id: GEN, name: 'The Yards Tenement Junction Box', zone_id: UTIL, generator_type: 'junction_box',
  capacity_kw: 5400, connection_range: 0, city_generator_id: 'gen_zone_powerplantnew_1782069598190',
  fuel_burn_rate: 0, fuel_remaining: 0, fuel_type: null, owner_id: null, flags: {} });
write(`content/furniture/furn_jbox_${UTIL}.json`, {
  id: `furn_jbox_${UTIL}`, zone_id: UTIL, name: 'the tenement junction box', object_type: 'junction_box', light_type: 'lamp',
  lumen_output: null, power_draw_kw: null, price: 0, hp: 1200, hp_max: 1200,
  description: 'A grey steel junction cabinet of tired breakers and humming busbars, feeding every floor above. Scorch marks fan from one breaker; a sealed hacking port sits below the latch.',
  flags: { destructible: true, generator_id: GEN } });
furns++;

// ── Floors + units ──
for (let f = 1; f <= FLOORS; f++) {
  const up = f < FLOORS ? floorId(f + 1) : undefined;      // top floor has no 'up'
  const down = f > 1 ? floorId(f - 1) : LOBBY;
  const fExits = { down, ...(up ? { up } : {}) };
  for (let i = 0; i < PER_FLOOR; i++) fExits[DIRS[i][0]] = unitId(f, i + 1);
  zone({ id: floorId(f), name: `The Yards Tenement — Floor ${f}`, grid_z: f,
    description: `A narrow landing off the stairwell, six numbered doors crowded around it, the stencilled numbers worn to grey ghosts. The carpet gave up years ago and the smell never will. A bare bulb buzzes overhead, throwing more shadow than light.`,
    ambient_events: ['Behind one of the doors a radio mutters and cuts out.', 'The stairwell breathes a draught of cold concrete up the landing.'],
    flags: { is_interior: true }, exits: fExits });
  power(floorId(f), `The Yards Tenement — Floor ${f}`); light(floorId(f));

  for (let i = 0; i < PER_FLOOR; i++) {
    const id = unitId(f, i + 1);
    zone({ id, name: `Unit ${unitNum(f, i + 1)}`, parent_zone: floorId(f), grid_z: f,
      description: 'One room. A steel-frame bed with a mattress that has seen things, a hot plate on an upturned crate, a sink that drips on its own schedule, and a window painted shut over a view of the container stacks. The radiator is cold and the lock is cheap — but the door closes, and in the Yards that is the whole of what a home has to do.',
      ambient_events: ['The sink drips. Pauses. Drips.', 'Pipes knock in the wall and go quiet.'],
      flags: { is_apartment: true, rent_cost: RENT }, exits: { [DIRS[i][1]]: floorId(f) } });
    power(id, `Unit ${unitNum(f, i + 1)}`); light(id);
  }
}

console.log(`✓ The Yards Tenement built.`);
console.log(`  zones: ${zones} (facade converted + lobby + util + ${FLOORS} floors + ${FLOORS * PER_FLOOR} units)`);
console.log(`  power_zones: ${powers}  |  furniture (lights + junction box): ${furns}`);
console.log(`  units: ${FLOORS * PER_FLOOR} @ ${RENT}c, all identical, all is_apartment (NPC-housable)`);
console.log(`  map: ${MAP}  |  facade: ${FACADE} (marker "TN", off Dray Lane ${STREET})`);
