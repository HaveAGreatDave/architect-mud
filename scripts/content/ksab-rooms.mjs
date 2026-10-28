// The KSAB rooms: the Writers' Wing becomes KSAB5's building, and each station gets its own
// writers' lounge, live stage and production room (docs/proposals/media-lot.md §5).
//
//   node scripts/content/ksab-rooms.mjs
//   node scripts/content/mint-connections.mjs --write
//   npm run content:lint
//
// Idempotent: every id is fixed, and a rerun writes the same files. Room ids that already exist
// keep their ids (regress walks the story floor and the vault by them).

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const file = (dir, id) => path.join(CONTENT_DIR, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
const write = (dir, row) => fs.writeFileSync(file(dir, row.id), canonicalJson(row));

const K5 = 'zone_district_913_910', K5_MAP = 'map_int_ksab';
const K7 = 'zone_district_912_911', K7_MAP = 'map_int_1782953094650';
const K5_GEN = 'gen_zone_util_zone_ksab_gallery', K7_GEN = 'gen_zone_util_1782953094650_1782953094650';

// ── KSAB5'S BUILDING ──
const facade = read('zones', K5);
facade.name = 'KSAB5';
facade.flags.building_name = 'KSAB5';
facade.description = "KSAB5, the station's sports channel, in the old writers' building. The marquee reads ALL GAMES LIVE, and through the glass a wall of monitors shows two grounds at once. Its door faces into the lot.";
write('zones', facade);

const map5 = read('maps', K5_MAP);
map5.name = 'KSAB5';
write('maps', map5);

const room = (id, map, parent, gx, gy, gz, name, description, exits, extra = {}) => ({
  ambient_events: [], ambient_theme: 'indoors', bg_color: '#221e2c', description, exits,
  flags: { building_name: extra.building_name, building_type: 'studio', floor: extra.floor || 'boards', is_building: true, is_interior: true, world_exit_zone: parent, ...(extra.flags || {}) },
  grid_x: gx, grid_y: gy, grid_z: gz, id, map_id: map, name, parent_zone: parent,
});

const lounge = read('zones', 'zone_ksab_lobby');
lounge.name = "KSAB5 Writers' Lounge";
lounge.flags.building_name = 'KSAB5';
lounge.description = "The writers' lounge: two sofas that don't match, a coffee urn, and a whiteboard of tonight's games with the scores rubbed out and written in again. The stat sheets are pinned up by club, and somebody has circled every Golden Goose fixture in red. The studio is through the east door.";
lounge.exits = { north: 'zone_ksab_gallery', south: K5, east: 'zone_ksab5_stage' };
write('zones', lounge);

const vault = read('zones', 'zone_ksab_gallery');
vault.flags.building_name = 'KSAB5';
vault.name = 'KSAB5 Script Vault';
write('zones', vault);
const util5 = read('zones', 'zone_util_zone_ksab_gallery');
util5.name = 'KSAB5 Utility Room';
write('zones', util5);

write('zones', room('zone_ksab5_stage', K5_MAP, K5, 1, 0, 0, 'KSAB5 Studio',
  "KSAB5's live stage: a curved sports desk in front of a screen the width of the room, three cameras on pedestals and a lighting grid hung low. The floor is green vinyl painted with a centre line. Two chairs behind the desk, and a third the guest gets, which is shorter. Stairs go up to production.",
  { west: 'zone_ksab_lobby', up: 'zone_ksab5_prod' }, { building_name: 'KSAB5', floor: 'linoleum' }));

write('zones', room('zone_ksab5_prod', K5_MAP, K5, 1, 0, 1, 'KSAB5 Production',
  "The production room over the stage: a long desk, a vision mixer, and a bank of monitors carrying the outside-broadcast feeds from both grounds. The transmitter deck is racked at the end with its tape strip. A clock on the wall shows three time zones, and two of them are wrong.",
  { down: 'zone_ksab5_stage' }, { building_name: 'KSAB5' }));

// ── KSAB-TV'S NEW ROOMS ──
const stage7 = read('zones', 'zone_studio_1782953094650');
stage7.exits = { ...stage7.exits, north: 'zone_ksab7_writers', south: 'zone_ksab7_green' };
write('zones', stage7);

write('zones', room('zone_ksab7_writers', K7_MAP, K7, 0, -1, 0, "KSAB-TV Writers' Room",
  "KSAB-TV's writers' room: a long table with eight chairs and one of them broken, a corkboard of index cards for the week's shows, and a whiteboard that says FUNNY BY FOUR OR IT AIRS SAD. The bin is full of coffee cups. The stage is through the south door.",
  { south: 'zone_studio_1782953094650' }, { building_name: 'KSAB-TV Studio Stage', floor: 'carpet' }));

write('zones', room('zone_ksab7_green', K7_MAP, K7, 0, 1, 0, 'KSAB-TV Green Room',
  "The green room, which is beige. A sofa, a mirror ringed with bulbs, a fruit bowl nobody touches, and a monitor showing the stage floor. The guests wait here before they go on. The stage is through the north door.",
  { north: 'zone_studio_1782953094650' }, { building_name: 'KSAB-TV Studio Stage', floor: 'carpet' }));

// ── POWER AND LIGHT ──
const power = (id, name, gen, kw) => write('power_zones', { capacity_kw: kw, flags: {}, generator_id: gen, id, max_capacity_kw: kw, name, source_type: 'junction_box' });
power('zone_ksab5_stage', 'KSAB5 Studio', K5_GEN, 300);
power('zone_ksab5_prod', 'KSAB5 Production', K5_GEN, 200);
power('zone_ksab7_writers', "KSAB-TV Writers' Room", K7_GEN, 100);
power('zone_ksab7_green', 'KSAB-TV Green Room', K7_GEN, 100);

const light = (zone, lumens, desc) => write('furniture', {
  description: desc, flags: {}, hp: null, hp_max: null, id: `furn_light_${zone}`, light_type: 'overhead',
  lumen_output: lumens, name: 'overhead light', object_type: 'light', power_draw_kw: 0.02, price: 0, zone_id: zone,
});
light('zone_ksab5_stage', 2600, 'A lighting grid hung low over the desk.');
light('zone_ksab5_prod', 900, 'A strip light over the production desk.');
light('zone_ksab7_writers', 1400, 'A recessed overhead light panel.');
light('zone_ksab7_green', 1200, 'A recessed overhead light panel.');

// KSAB5's deck goes to its production room.
const deck = read('furniture', 'furn_deck_ksab5');
deck.zone_id = 'zone_ksab5_prod';
write('furniture', deck);

// The model binds by the building's name, and its signs say what the station is.
const model = read('building_models', 'ksabwriterswing');
for (const b of model.bind || []) if (b.by === 'name') b.key = 'KSAB5';
for (const d of model.detail || []) {
  if (d.label === 'KSAB' && d.kind === 'bladePanel') d.label = 'KSAB5';
  if (d.label === 'NEWS AT NINE') d.label = 'ALL GAMES LIVE';
}
write('building_models', model);
console.log('ksab-rooms: written');
