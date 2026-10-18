/**
 * GOLDEN GOOSE GARDENS: the CPhL's own barn, on the old South Gate ground in the Ashway. It opened
 * as The Slush Fund (2026-10-11) and was renamed on 2026-10-18; the ids keep the old `slush` slug.
 *
 *   node scripts/content/slush-fund.mjs [--dry-run]
 *
 * Every club in the league plays at its own barn (docs/systems-broadcast.md, the clubs table, and
 * the barn pools in data/scripts/hockey.bsm). This one belongs to the league: the final is played
 * here, the scheduler's teleprinter is in the press box, and KSAB's gantry hangs over the ice. The
 * general `chatter` pool describes "this building", and every fixture in it is here: the goal
 * judge's booth, the frank that is not legally a hot dog, the man in section nine, the records
 * door, the resurfacer with the undisclosed fuel. Change one and change the other.
 *
 * It stands on the open block between Glacier Street and the south wall, where the weighbridge and
 * the gate booth were before the South Gate moved: a block west of the Gate Road and the Shingles,
 * on cheap flat ground at the edge of town (docs/proposals/slush-fund.md).
 *
 * ⚠ SIX TILES, ONE BUILDING, ONE DOOR. 915,916 is the facade (north onto Glacier Street) and the
 * only way in; 915,917 is the back of the hall, and the four tiles either side of the hall are its
 * stands. Those five are sealed mass the way The Dam's tiles are: a name, a type for GLASS,
 * `entrance` for the model's facing, `floors` for its height, empty exits, and NO `is_building`,
 * so they take no map code of their own and the map shows one building with one code. Every
 * neighbour's exit into them goes, or you walk into a solid.
 *
 * ⚠ THE TYPES ARE ROLES, AND GLASS DRAWS EACH ONE. `ice_rink` is the front of the hall,
 * `ice_rink_hall` the back of it, and `ice_rink_stand_w`/`_e`, `ice_rink_plant_w`/`_e` the four
 * wings; the arms are in client/game/js/panels/glass/models/ashway.js and the rows that bind them in
 * model-registry.js. Every tile faces north, so all six share one model frame. Move the building
 * and the arms have to move with it.
 *
 * ⚠ Run `node scripts/content/mint-connections.mjs --write` afterwards: sealing a tile leaves edges
 * geometry still projects and exits no longer declare, and those land as `blocked: true` files.
 *
 * Idempotent: every id derives from the slug or the tile, so a re-run is an upsert.
 */
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const NAME = 'Golden Goose Gardens';
const ROOMS = 'The Gardens';        // room names stay under 30 characters, so docs:prose doesn't count their dash
const MARKER = 'IC';                // the ICE painted along both back wings; see the arms
const DISTRICT = 'ashway';
const REGION = 'region_coldwater';
const idFor = (x, y) => `zone_district_${x}_${y}`;

// The block must still be open ground, or this building belongs to somebody else's plan now.
const SITE = [[914, 916], [915, 916], [916, 916], [914, 917], [915, 917], [916, 917]];
for (const [x, y] of SITE) {
  const z = store.get('zones', idFor(x, y));
  if (!z) throw new Error(`${idFor(x, y)} does not exist`);
  if ((z.flags?.is_building || z.flags?.building_type) && z.flags?.building_name !== NAME) {
    throw new Error(`${idFor(x, y)} is already ${z.name}; the site has been built on since this file was written`);
  }
}

// ── the door, the hall and the rooms ────────────────────────────────────────────────────────
const spec = {
  slug: 'slush', name: NAME, roomName: ROOMS, type: 'ice_rink',
  x: 915, y: 916, entrance: 'north', floors: 5, marker: MARKER, district: DISTRICT,

  facade: {
    bgColor: '#1d1a1a', color: '#c9cfd4',
    description: 'A brick arena under a long vaulted roof of grey steel. The end of the hall is one great arched window between two brick wings, and a gilt goose stands on a stepped plinth at the top of its gable. A canopy on steel posts runs across the front over six glass doors, with flagpoles at either end.',
  },

  rooms: [
    { key: 'concourse', name: 'Concourse', floor: 'linoleum',
      description: 'A curved concourse under the stands, floored in rubber matting gone grey with grit. Turnstiles at the north doors, a concession counter with a fogged glass case, and a trophy cabinet by the stairs. A door marked Records is set in the far wall. The stands are south, the ice plant below.',
      window: {
        name: 'the front doors',
        description: 'Six glass doors in steel frames under the canopy, scuffed at kick height. Glacier Street is out there, and the queue when there is one.',
        light: 0.5, visibility: 0.6,
      } },
    { key: 'stands', name: 'The Stands', floor: 'concrete', from: 'concourse', dir: 'south',
      description: 'Wooden benches climb steeply on all four sides of the ice, numbered in sections, under a roof of steel arches. A scoreboard of four screens hangs over centre ice on chains. An organ stands on a riser in one corner. It is colder in here than on the street.',
      window: {
        name: 'the end window',
        description: 'A great arched window in the north end wall, glazed in a steel grid, three panes of it patched with board. Glacier Street shows through it as a grey band.',
        light: 0.4, visibility: 0.3,
      } },
    { key: 'rinkside', name: 'Rinkside', floor: 'concrete', from: 'stands', dir: 'down',
      description: 'Ice level, behind the boards. The glass above them is scratched to a haze, and one pane behind the north net is newer than the rest. The benches are cut into the boards on the east side, with the penalty box between them. The resurfacer waits by a gate in the south corner.',
      window: null },
    { key: 'pressbox', name: 'Press Box', floor: 'metal', from: 'stands', dir: 'up',
      description: 'A steel gantry slung under the roof arches above the west stands, reached by a ladder and a catwalk. KSAB\'s commentary desk is at the near end, two microphones on it and a cushion on one chair. A teleprinter in a steel case stands on its own table at the far end.',
      window: null },
  ],

  utility: {
    name: 'Ice Plant', floor: 'concrete',
    description: 'Under the concourse: two compressors the size of cars, thumping in turn, and the brine headers that run out under the ice. Every pipe in here wears a coat of frost. A hazard diamond is stencilled on the door, and the building\'s junction box is on the wall beside it.',
  },

  lights: {
    stands: { name: 'the ice lights', description: 'Banks of floodlights slung from the roof arches and aimed at the ice. They hum, and they take a minute to come up to full white.', lumens: 9000 },
    rinkside: { name: 'the bench lamps', description: 'Caged lamps over the benches and the penalty box, on the same circuit as the goal judge\'s light.', lumens: 1800 },
    pressbox: { name: 'the gantry lamp', description: 'A clamp lamp on the gantry rail, angled at the desk.', lumens: 700, type: 'lamp' },
  },

  props: [
    { key: 'counter', room: 'concourse', name: 'the concession counter', objectType: 'furniture',
      description: 'A steel counter with franks turning on rollers behind fogged glass, a tea urn and a till. A sign above it, in small print: Rink frank. Protein baton in a bun. Not a hot dog within the meaning of the Act.',
      flags: { aliases: ['counter', 'concession', 'concession counter', 'franks', 'rollers', 'urn', 'sign'],
        examine_detail: 'The rollers have been turning the same franks since the doors opened. The urn has a brass tap and a dent in it the shape of a puck.' } },
    { key: 'cabinet', room: 'concourse', name: 'the trophy cabinet', objectType: 'decoration',
      description: 'A glass cabinet by the stairs with a velvet plinth in it and nothing on the plinth. A card is propped against the glass: On loan to the champions.',
      flags: { aliases: ['cabinet', 'trophy cabinet', 'plinth', 'card', 'cup', 'trophy'],
        examine_detail: 'A brass plate on the plinth: The Coldwater Cup. The ring in the velvet where it stands is stained dark, as if whatever stood there had been full.' } },
    { key: 'records', room: 'concourse', name: 'the records door', objectType: 'decoration',
      description: 'A door in the far wall with Records stencilled on it. It opens on a broom cupboard: a mop, a bucket, and three shelves with nothing on them.',
      flags: { aliases: ['door', 'records', 'records door', 'cupboard', 'shelves'],
        examine_detail: 'The shelves are clean. Somebody dusts them.' } },
    { key: 'till', room: 'concourse', name: 'the cash drawer', objectType: 'fixture',
      description: 'A steel cash drawer under the counter, chained to the frame, with a key lock and a dent in the front.',
      flags: { aliases: ['cash drawer', 'drawer', 'till', 'cash'], vendor_safe: true, vendor_npc_id: 'npc_slush_agnes', hack_difficulty: 3 } },
    { key: 'scoreboard', room: 'stands', name: 'the scoreboard', objectType: 'tv', powerKw: 0.4,
      description: 'Four screens back to back in a steel box over centre ice, hung on chains, with a clock and two penalty lamps under them. They carry KSAB\'s picture on channel 7, whatever is on.',
      flags: { aliases: 'scoreboard,screens,screen,tv,television,clock',
        broadcast_device_type: 'tv', broadcast_receiver: true, channel_default: 7, interactions: ['watch'],
        tuned_channel: 7, tv: true, tv_dial_freq: 7 } },
    { key: 'organ', room: 'stands', name: 'the rink organ', objectType: 'furniture',
      description: 'A two-manual electric organ on a plywood riser in the south-west corner, with a speaker cabinet the size of a wardrobe behind it. The charge is pencilled on a card taped above the keys.',
      flags: { aliases: 'organ,rink organ,console,riser,keys', instrument: 'organ', interactions: ['examine', 'play'] } },
    { key: 'benches', room: 'stands', name: 'the benches', objectType: 'furniture',
      description: 'Wooden benches bolted to concrete steps and painted with section numbers. The front rows are chipped by skates. One seat in section nine has a flat cushion tied to it with string.',
      flags: { aliases: ['bench', 'benches', 'seat', 'seats', 'section nine', 'cushion'], interactions: ['sit', 'lie'] } },
    { key: 'booth', room: 'rinkside', name: 'the goal judge\'s booth', objectType: 'decoration',
      description: 'A plywood booth behind the north net, a slot cut at eye level and a red lamp on its roof. The lamp works. The door is shut, and the dust on the handle is thick.',
      flags: { aliases: ['booth', 'goal judge', 'goal judge\'s booth', 'lamp', 'red lamp', 'slot'],
        examine_detail: 'Through the slot: the back of a chair, a flask on the sill, and a hat. The hat has not moved.' } },
    { key: 'box', room: 'rinkside', name: 'the penalty box', objectType: 'furniture',
      description: 'A narrow pen between the benches with a bench of its own and a door that latches from the outside. Tally marks are cut into the wood in fives, all the way along.',
      flags: { aliases: ['penalty box', 'box', 'sin bin', 'pen'], interactions: ['sit'] } },
    { key: 'resurfacer', room: 'rinkside', name: 'the resurfacer', objectType: 'decoration',
      description: 'A squat ice resurfacer the colour of an old bruise, parked by the south gate. The tank behind the seat carries a hazard diamond and no other marking. A respirator hangs off the seat back.',
      flags: { aliases: ['resurfacer', 'zamboni', 'machine', 'tank', 'respirator'],
        examine_detail: 'The fuel cap is padlocked. The key is not on the ring hanging from the steering column.' } },
    { key: 'desk', room: 'pressbox', name: 'the commentary desk', objectType: 'furniture',
      description: 'A trestle desk at the gantry rail with two microphones on stands, a monitor and a spotting board of both line-ups. The left chair has a cushion on it and a name on the back: Brennan.',
      flags: { aliases: ['desk', 'commentary desk', 'microphones', 'microphone', 'monitor', 'chair', 'spotting board'], interactions: ['sit'] } },
    { key: 'teleprinter', room: 'pressbox', name: 'the teleprinter', objectType: 'decoration',
      description: 'A teleprinter in a grey steel case on a table of its own, its cable running into the wall. Paper feeds out of it into a wire basket. Taped to the case: Do not switch off.',
      flags: { aliases: ['teleprinter', 'scheduler', 'printer', 'paper', 'basket'],
        examine_detail: 'The sheet hanging out of it is next week\'s pairings, every club and every barn, already printed.' } },
  ],

  items: [
    { id: 'item_rink_frank', name: 'rink frank', type: 'consumable', value: 6, weight: 180,
      description: null,
      flags: {},
      tags: { consumable: true, restore_hunger: 18, stackable: true,
        description: 'A pale protein baton in a split bun, mustard down it in a zigzag, wrapped in wax paper. It tastes of salt and smoke flavouring. The sign at the counter says it is not legally a hot dog.' } },
  ],

  npc: {
    id: 'npc_slush_agnes', name: 'Agnes Prowse', sex: 'female', hp: 38,
    homeRoom: 'concourse', workRoom: 'concourse', shopName: 'Concessions',
    description: 'A woman in her sixties, short and broad, in a quilted coat with the league crest on the sleeve and fingerless gloves. Her hair is pinned up under a paper hat. She keeps one hand near the tongs and watches the franks turn as if they might try something.',
    clothing: [
      'a quilted coat with the league crest on the sleeve',
      'a striped apron over it',
      'fingerless gloves',
      'a paper hat',
      'thermal boots',
    ],
    // Open for the game three nights a week, the way channel 7 carries it, and for the public skate
    // on the other three. Closed Mondays.
    schedule: {
      mon: [], tue: [{ from: 15, to: 23 }], wed: [{ from: 10, to: 18 }], thu: [{ from: 15, to: 23 }],
      fri: [{ from: 10, to: 18 }], sat: [{ from: 10, to: 18 }], sun: [{ from: 15, to: 23 }],
    },
    inventory: [
      { item_id: 'item_rink_frank', price: 6 },
      { item_id: 'item_drug_beer', price: 5 },
      { item_id: 'item_drug_coffee', price: 4 },
      { item_id: 'item_steam_bun', price: 3 },
    ],
    chitchat: [
      'Prowse turns the franks a quarter turn with the tongs. They were already turning.',
      'She tops up the urn and wipes the tap with her sleeve.',
      'She counts the float into the till twice and writes the number on her hand.',
      'Somewhere above, the organ plays four notes and stops. She does not look up.',
      'She straightens the sign over the counter by a fraction of an inch.',
    ],
    dialogue: {
      root: {
        text: '"Frank, tea, beer." She lifts the tongs. "That\'s the menu. What\'ll it be?"',
        text_by_relation: {
          first: 'The woman behind the counter looks up from the rollers.\n\n"Agnes Prowse. I do the counter." She points the tongs at the sign over her head. "Frank, tea, beer. Before you ask, it isn\'t legally a hot dog. It\'s legally a protein baton. Tastes the same as a hot dog did."',
          known: '"Back again." She has a frank on the tongs before you reach the counter.',
          familiar: '"Usual?" She is already wrapping it.',
        },
        options: [
          { label: 'What do you sell?', next: '__shop__' },
          { label: 'What is this place?', next: 'place' },
          { label: 'Who plays here?', next: 'games' },
          { label: 'Where are the league\'s records?', next: 'records' },
          { label: 'Who sits in section nine?', next: 'nine' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      place: {
        text: '"The league\'s barn. Every club has its own, and this one belongs to all of them, so none of them pays for the roof." She glances up at it.\n\n"They put it up on the old gate ground when the gate moved, in a year, on money nobody can account for. Somebody\'s goose laid that egg, so that\'s the name. She\'s up on the roof in gold leaf, and they regild her every spring. The ice has been slush since the ownership changed."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      games: {
        text: '"The final, and any game the scheduler sends here." She points up the stairs with the tongs. "The rest of the time they play in their own barns and it comes in on seven, the same as everywhere. Tuesday, Thursday and Sunday, six o\'clock. I stay open for it."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      records: {
        text: '"Everybody asks." She shrugs. "There\'s a door over there says Records. It\'s a broom cupboard. Twenty-two years I\'ve worked here and I\'ve never found another door."\n\nShe turns a frank. "The scheduler\'s up in the press box, if you want to ask it. It doesn\'t talk."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      nine: {
        text: '"Mr Ostrowski. Nineteen years, every game, the same seat. Never cheered once." She lowers her voice. "He bought a frank on his first night and never came back to the counter. I think about that."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Mind the ice," she says. "It\'s mostly water."',
        options: [],
      },
    },
  },
};

const ids = await authorBuilding(store, spec);

// `authorUtilityRoom` gives the anchor room a stock fixture on insert only.
store.patch('furniture', 'furn_light_zone_slush_concourse', {
  name: 'the concourse lights',
  description: 'Caged bulkhead lamps along the curve of the concourse, every third one out.',
});

// ── the five sealed tiles ───────────────────────────────────────────────────────────────────
// [x, y, building_type, floors, description]. The hall is five storeys to the crown of its vault and
// the wings two; ashway.js draws them to fixed heights so the six tiles meet, and these are what
// collision and the skyline read.
const SEALED = [
  [915, 917, 'ice_rink_hall', 5,
    'The south end of the Gardens\' hall. The vaulted roof comes down to a brick gable with a roller door for the resurfacer at the foot of it, and a heap of grey scraped ice against the wall beside the door.'],
  [914, 916, 'ice_rink_stand_w', 2,
    'The west stand of Golden Goose Gardens: a long brick wall with tall narrow windows, and the box office windows at its north end, facing the forecourt.'],
  [916, 916, 'ice_rink_stand_e', 2,
    'The east stand of Golden Goose Gardens. Its brick end on Glacier Street carries a shield for every club in the league, two rows of four.'],
  [914, 917, 'ice_rink_plant_w', 2,
    'The back of the west stand, with the ice plant\'s condensers on its roof and ICE painted along the wall in letters a storey high.'],
  [916, 917, 'ice_rink_plant_e', 2,
    'The back of the east stand: the players\' door, a loading bay, and ICE painted along the wall in letters a storey high.'],
];
let sealed = 0;
for (const [x, y, type, floors, description] of SEALED) {
  const id = idFor(x, y);
  const prev = store.get('zones', id);
  const flags = { ...(prev.flags || {}) };
  delete flags.terrain;              // a building footprint is not ground
  delete flags.scavenging_table_id;  // and you cannot forage inside a wall
  delete flags.street_life;
  delete flags.is_building;          // no map code of its own: the door tile's IC is the building's
  delete flags.facade;
  delete flags.world_exit_zone;
  Object.assign(flags, { district: DISTRICT, region_id: REGION, building_name: NAME, building_type: type, floors, entrance: 'north' });
  const next = { ...prev, name: NAME, description, flags, exits: {}, ambient_theme: 'urban', ambient_events: [] };
  delete next.marker;
  store.put('zones', next);
  // Every neighbour that pointed at it stops pointing at it, the hall's own facade included.
  for (const z of store.all('zones')) {
    if (z.id === id) continue;
    const links = Object.entries(z.exits || {}).filter(([, t]) => t === id);
    if (!links.length) continue;
    const exits = { ...z.exits };
    for (const [dir] of links) delete exits[dir];
    store.patch('zones', z.id, { exits });
    sealed += links.length;
  }
}

// The city grid's rows for the six tiles keep feeding them; only the name they carry changes.
for (const [x, y] of SITE) {
  if (store.get('power_zones', idFor(x, y))) store.patch('power_zones', idFor(x, y), { name: NAME });
}

// ── the ground round it ─────────────────────────────────────────────────────────────────────
// Glacier Street still read as pasture; the forecourt and the yard were pasture and scrub. The
// terrain and the prose follow the building. 913,915 is left alone: it is Foundry Way's only way
// out (coldwater-infill.md), and 913,916-917 keep their grass with a path worn across it.
// ⚠ 917,917 IS NOT HERE ANY MORE. It was the weighbridge pour when this ran; The Slip took the old
// weigh-house since (scripts/content/marrow-midrises.mjs), and a row here would overwrite it.
const GROUND = [
  [915, 915, 'Glacier Street', null,
    'Glacier Street, paved and gritted, running east to the Gate Road. Golden Goose Gardens fills the south side: two brick wings, and the arched end of its hall set back between them behind a canopy. A gilt goose stands on the gable. Steel crowd barriers lie stacked against the kerb.'],
  [916, 915, 'Glacier Street', null,
    'Glacier Street, along the end of the Gardens\' east stand. Eight enamel shields are bolted to the brick in two rows, one for each club in the league, every one in its club\'s colours on a gilt rim. Grit bins stand at the kerb.'],
  [917, 915, 'Glacier Street', null,
    'The east end of Glacier Street, where it meets the Gate Road. The kerb on the south corner is chipped all along by the back wheels of coaches turning in on game nights.'],
  [914, 915, 'The Forecourt', 'concrete',
    'A concrete forecourt in front of the Gardens\' west stand, where the queue forms on game nights. Box office windows are set in the brick along its south side, each with a steel shutter. Old tickets lie in the cracks.'],
  [913, 916, 'Grasslands', null,
    'Rough grass along the west wall of Golden Goose Gardens, trodden into a path by the crowd coming across from Kerbstone Row. The wall is blank brick, tall enough to cut off the wind.'],
  [913, 917, 'Grasslands', null,
    'Scrub and thin trees against the Gardens\' west wall, where ICE is painted in letters a storey high. A path worn through the scrub leads round to the yard at the back.'],
  [914, 918, 'The Yard', 'gravel',
    'The yard behind the Gardens\' west stand: gravel and puddles, with the ice plant\'s condenser fans roaring on the roof above. Sacks of rock salt are stacked under a tarp against the wall.'],
  [915, 918, 'The Yard', 'gravel',
    'The yard under the south gable of the Gardens\' hall. The resurfacer\'s roller door opens onto it, and the scrapings are tipped in a heap against the wall: grey, crusted, and never quite melted. The staff call the heap the nest egg.'],
  [916, 918, 'The Yard', 'gravel',
    'The east end of the yard behind Golden Goose Gardens. A square of bare concrete where a booth stood on a plinth until they moved it through the wall; the anchor bolts are still in it, sawn off flush. Team coaches back in here.'],
];
for (const [x, y, name, terrain, description] of GROUND) {
  const id = idFor(x, y), prev = store.get('zones', id);
  const flags = { ...(prev.flags || {}) };
  if (terrain) {
    flags.terrain = terrain;
    flags.district = DISTRICT;
    delete flags.scavenging_table_id;   // swept and paved: nothing out here is lying about any more
  }
  store.patch('zones', id, { name, description, flags, ...(terrain ? { ambient_theme: 'city' } : {}) });
}

// MARK-4: a marker is unique across the world, or two buildings share one code on the map.
const clash = store.all('zones').filter((z) => z.marker === MARKER && z.id !== ids.facadeId);
if (clash.length) throw new Error(`map code ${MARKER} is already ${clash.map((z) => `${z.name} (${z.id})`).join(', ')}`);

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
console.log(`  facade ${ids.facadeId}  map ${ids.mapId}  utility ${ids.utilityRoomId}`);
console.log(`  sealed ${SEALED.length} tile(s), ${sealed} neighbour exit(s) removed`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
