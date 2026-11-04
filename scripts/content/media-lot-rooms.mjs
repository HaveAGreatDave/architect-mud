// The Media Lot, phases 2 and 3 in content: the three buildings' prose, footprints and storeys for
// their redraw, the paper's morgue, and KSAB5's writers' room at the top of the stair
// (docs/proposals/media-lot.md §5, §6).
//
//   node scripts/content/media-lot-rooms.mjs
//   node scripts/content/mint-connections.mjs --write
//   npm run content:lint
//
// Idempotent: every id is fixed, and a rerun writes the same files. Each new room has its
// `power_zones` row off its building's generator and a fixture; authored lights import off, so they
// need `content:seed-runtime` after the deploy (lightAuthoredFixtures).

import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const file = (dir, id) => path.join(CONTENT_DIR, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(fs.readFileSync(file(dir, id), 'utf8'));
const write = (dir, row) => fs.writeFileSync(file(dir, row.id), canonicalJson(row));

const STAGE = 'zone_district_912_911', K5 = 'zone_district_913_910', PAPER = 'zone_district_914_910', PARK = 'zone_medialot_914_911';
const BULLPEN = 'zone_sentinel_bullpen', MORGUE = 'zone_sentinel_morgue';
const LOUNGE = 'zone_ksab_lobby', WRITERS = 'zone_ksab5_writers';
const PAPER_GEN = 'gen_zone_util_zone_sentinel_bullpen', K5_GEN = 'gen_zone_util_zone_ksab_gallery';

// ── THE FACADES ──
const stage = read('zones', STAGE);
stage.description = "KSAB's sound stage: a blind render shell under a barrel roof, the call letters across the Meltwater Row side with one of them dark, a 7 the height of the wall on the Foundry Way end, and the transmitter mast over the plant deck. Its doors face into the lot: the elephant door at the scene dock, the stage door under a red ON AIR lamp, and a box office window with a card taped inside: TICKETS HERE.";
stage.flags.map_icon = 'bldg_soundstage';
write('zones', stage);

const k5 = read('zones', K5);
k5.description = "KSAB5, the station's sports channel, in the old writers' building: three floors of ribbon windows with the blinds down to every height, and a glass-block stair on the corner. The marquee reads ALL GAMES LIVE, and through the glass a wall of monitors shows two grounds at once. One lamp on the top floor is on whatever the hour. The door faces into the lot.";
k5.flags.floors = 3;
k5.flags.map_icon = 'bldg_ksab5';
k5.marker = 'K5';
write('zones', k5);

const paper = read('zones', PAPER);
paper.description = "The Coldwater Sentinel's back door, beside the loading dock where its van backs in: a steel door under a lamp, stencilled NO PARKING, and a roller shutter over the dock. Through a wired window, a wall of feed-screens flickers through headlines, and a printer inside never stops chattering. The paper's front is on Marrow Street, on the far side of the building and the wall.";
paper.flags.floors = 3;
paper.flags.map_icon = 'bldg_sentinel';
paper.flags.media_lot = { ...paper.flags.media_lot, ticker: 'n' };
write('zones', paper);

const front = read('zones', 'zone_district_914_909');
front.description = "Marrow Street outside the Coldwater Sentinel, its gilt masthead over a front door bricked up and rendered over, and the day's headlines running along the building in amber letters over the lot's wall. A card in the old counter window sends deliveries round to the KSAB gate on Foundry Way.";
write('zones', front);

// The vans come and go, so the room's own prose leaves them to the broadcast plugin's line.
const park = read('zones', PARK);
park.description = "Painted bays on concrete behind the lot's wall. KSAB's two news bays are by the aisle, the Sentinel's van is backed up to the paper's loading dock beside the paper's only door, and a satellite van stands along the east wall. A water tower stands in the corner on four legs, the station's disc on its tank.";
write('zones', park);

const room = (id, map, parent, gx, gy, gz, name, description, exits, extra) => ({
  ambient_events: [], ambient_theme: 'indoors', bg_color: extra.bg, description, exits,
  flags: { building_name: extra.building_name, building_type: extra.building_type, floor: extra.floor, is_building: true, is_interior: true, world_exit_zone: parent, ...(extra.flags || {}) },
  grid_x: gx, grid_y: gy, grid_z: gz, id, map_id: map, name, parent_zone: parent,
});
const fixture = (id, zone, name, description, flags, extra = {}) => write('furniture', {
  description, flags, hp: null, hp_max: null, id, light_type: null, lumen_output: null,
  name, object_type: 'decoration', power_draw_kw: 0, price: 0, zone_id: zone, ...extra,
});
const light = (zone, name, lumens, description) => write('furniture', {
  description, flags: {}, hp: null, hp_max: null, id: `furn_light_${zone}`, light_type: 'overhead',
  lumen_output: lumens, name, object_type: 'light', power_draw_kw: 0.02, price: 0, zone_id: zone,
});

// ── THE MORGUE ──
// West of the bullpen, the one wall of it with nothing on the other side.
const bullpen = read('zones', BULLPEN);
bullpen.exits = { ...bullpen.exits, west: MORGUE };
write('zones', bullpen);

write('zones', room(MORGUE, 'map_int_sentinel', PAPER, -1, 0, 0, 'The Morgue',
  "The paper's morgue: steel cabinets from the floor to the ceiling down both long walls, every drawer labelled in a different decade's typing. A reading table stands between them with a pair of scissors chained to it. The oldest clippings have gone brown and the newest are on top of the cabinets, waiting to be filed. The bullpen is back through the east door.",
  { east: BULLPEN },
  { bg: '#221e19', building_name: 'Coldwater Sentinel', building_type: 'office', floor: 'linoleum' }));

write('power_zones', { capacity_kw: 100, flags: {}, generator_id: PAPER_GEN, id: MORGUE, max_capacity_kw: 100, name: 'Coldwater Sentinel Morgue', source_type: 'city_grid' });
light(MORGUE, 'morgue strip lights', 1400, 'Two strip lights over the aisle, one of them slower to come on than the other.');
fixture('furn_sentinel_cabinets', MORGUE, 'the clippings cabinets',
  "Every story the Sentinel ever ran, cut out and filed by name, then by what the name did. The drawer marked CORRECTIONS is the fullest in the room.",
  { aliases: ['cabinets', 'clippings', 'drawers', 'files', 'archive', 'corrections'], notable: true });
fixture('furn_sentinel_reading_table', MORGUE, 'the reading table',
  "A long table with cup rings worn into it. The scissors are chained to the leg, and a card on the chain says they're the tenth pair.",
  { aliases: ['table', 'scissors', 'card'], notable: true });

// ── THE WRITERS' ROOM ──
// At the top of the stair drum, over the lounge. The lit bay on the third floor is this room's lamp.
const lounge = read('zones', LOUNGE);
lounge.exits = { ...lounge.exits, up: WRITERS };
write('zones', lounge);

write('zones', room(WRITERS, 'map_int_ksab', K5, 0, 0, 1, "KSAB5 Writers' Room",
  "The writers' room at the top of the stair: a long table, a corkboard of fixtures, and a sofa with a blanket folded on the arm. Last night's lines are on the whiteboard with the jokes crossed out. A lamp on the end desk is switched on, with tape over the switch. The stairs are down.",
  { down: LOUNGE },
  { bg: '#221e2c', building_name: 'KSAB5', building_type: 'studio', floor: 'carpet',
    flags: { window: { description: "A ribbon window onto the lot: the court, the gatehouse at the gate and the mast on the stage's roof, with the blinds at three different heights.", light: 0.85, name: 'the ribbon window', visibility: 0.9 } } }));

write('power_zones', { capacity_kw: 100, flags: {}, generator_id: K5_GEN, id: WRITERS, max_capacity_kw: 100, name: "KSAB5 Writers' Room", source_type: 'junction_box' });
light(WRITERS, 'overhead light', 1200, 'A recessed overhead light panel, usually off.');
fixture('furn_ksab5_lamp', WRITERS, 'the desk lamp',
  "A desk lamp on the end desk, the one you can see from the street. Somebody has taped over the switch and written ON AIR in marker, which it isn't.",
  { aliases: ['lamp', 'desk lamp', 'switch', 'tape'], notable: true }, { light_type: 'lamp' });
fixture('furn_ksab5_corkboard', WRITERS, 'the fixture board',
  "Every game on the slate on an index card, with the angle for each one written underneath. Most of the angles are the same angle.",
  { aliases: ['board', 'corkboard', 'cards', 'index cards', 'fixtures'], notable: true });
console.log('media-lot-rooms: written');
