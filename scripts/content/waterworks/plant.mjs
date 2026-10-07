/**
 * The Coldwater Waterworks (919,901), at the head of Ironside Street on the Basin shore, and its two
 * settling beds (920,901 and 921,901). See docs/systems-water-supply.md.
 *
 * The plant is the `waterworks` plugin's content: the pump set carries `waterworks`, the intake
 * screens `water_intake` (in an open-sky room, so rain reaches them) and the board `water_gauges`,
 * each naming region_coldwater. The plugin finds the plant by those flags and names nothing.
 *
 * The water goes from here into the mains, which the Halcyon Fields Pumping Station lifts into the
 * Coldwater Water Tower (Orla Kemp's and Roke's dialogue already say so), and the tower feeds the
 * city by gravity.
 *
 * The beds are mass, like the Old Coldwater ruins: no door, no exits, a name and a model. Re-runnable.
 *
 *   node scripts/content/waterworks/plant.mjs [--dry-run]
 *   node scripts/content/mint-connections.mjs --write
 *   npm run content:lint
 */
import { authorBuilding, loadContentStore } from '../halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const REGION = 'region_coldwater';

const plant = {
  slug: 'waterworks', name: 'Coldwater Waterworks', type: 'pumping_station',
  x: 919, y: 901, entrance: 'south', floors: 2, marker: 'WW', district: 'docks',
  facade: {
    bgColor: '#1a2226', color: '#bcd8e0',
    description: 'A long brick engine house at the end of Ironside Street, with tall arched windows and a slate roof. Two open concrete beds lie behind it along the shore, full of still brown water. Every tap in Coldwater starts here.',
  },
  rooms: [
    { key: 'pumphall', name: 'Pump Hall', floor: 'tile',
      description: 'A tall hall in white tile, with three blue pumps bolted to the floor in a row and a fat main leaving through the end wall. Two of them are running. The noise is steady and so loud that people in here talk with their hands.' },
    { key: 'filters', name: 'Filter Gallery', floor: 'concrete', from: 'pumphall', dir: 'north',
      description: 'A long gallery over six sand filters, each a concrete tank with a walkway down one side. The water comes in grey at one end and goes out clear at the other. A brass sampling tap stands at the outlet with a tin cup on a chain.' },
    { key: 'intake', name: 'Intake Screens', floor: 'concrete', from: 'filters', dir: 'north',
      description: 'An open concrete channel where the Basin comes in under a row of steel screens. A rake on a gantry drags the screens clean, and whatever it lifts goes in a skip: weed, plastic, a shoe, the occasional fish. There is no roof. When it rains hard the channel runs brown.' },
    { key: 'control', name: 'Control Room', floor: 'linoleum', from: 'pumphall', dir: 'up',
      description: 'A glass box on a mezzanine over the pump hall, with a gauge board along one wall, a desk, a kettle and a logbook open to today. You can see all three pumps from here. The window is greasy where people lean on it.' },
  ],
  utility: { name: 'Cable Pit', floor: 'concrete', description: 'A low pit under the pump hall where the motor cables come up through the floor. The junction box is on the wall, and the floor is wet.' },
  lights: {
    filters: { name: 'cage lamps', lumens: 900, description: 'Caged lamps along the walkway, one over each filter, each with a moth or two.' },
    intake: { name: 'floodlight', lumens: 1400, description: 'A floodlight on the gantry, pointed at the screens so the rake man can see what he is lifting.' },
    control: { name: 'strip light', lumens: 1100, description: 'One strip light over the desk. The gauge board has its own small lamps.' },
  },
  props: [
    { key: 'pumps', room: 'pumphall', name: 'pump set', objectType: 'fixture', flags: { waterworks: REGION },
      description: 'Three electric pumps painted blue, each the size of a car, on concrete plinths. Brass plates say MAIN, STANDBY and STANDBY. The one marked MAIN has a pencil tally on its casing of every time it has been stripped down.' },
    { key: 'tap', room: 'filters', name: 'sampling tap', objectType: 'fixture', flags: { water_source: true },
      description: 'A brass tap on the outlet main, for drawing samples. The tin cup is chained to it. The water is cold and tastes of nothing, which is the point.' },
    { key: 'screens', room: 'intake', name: 'intake screens', objectType: 'fixture', flags: { water_intake: REGION },
      description: 'Steel bar screens across the channel, a hand apart, with a toothed rake that rides down them on a chain. The bars are polished bright where the rake runs.' },
    { key: 'board', room: 'control', name: 'gauge board', objectType: 'fixture', flags: { water_gauges: REGION },
      description: 'A steel board with a dial for each pump, a tall tower gauge and a turbidity needle, each with a little lamp over it. Notes in grease pencil run down the margin. Type gauges to read it.' },
    { key: 'logbook', room: 'control', name: 'logbook', objectType: 'fixture',
      description: 'A ledger with a pencil on a string. Every hour has a line: pump hours, tower level, a word for the water. Most of the words are "clear".' },
    { key: 'kettle', room: 'control', name: 'kettle', objectType: 'fixture',
      description: 'An electric kettle with a limescale ring halfway up, and three mugs. One says ENGINEER.' },
  ],
  npc: {
    id: 'npc_waterworks_holm', name: 'Dagny Holm', sex: 'female', hp: 38,
    homeRoom: 'control', workRoom: 'control', shopName: 'Coldwater Waterworks',
    description: 'A broad woman in her forties in blue overalls, with ear defenders round her neck and a torch in the bib pocket. She reads the gauge board the way other people read a clock, without seeming to look at it.',
    clothing: [
      'blue overalls, oil on the knees, with a torch in the bib pocket',
      'ear defenders hung round her neck',
      'steel-capped boots, the laces doubled',
      'a grey work shirt and plain underthings',
    ],
    inventory: [
      { item_id: 'item_jerry_can_water', price: 60 },
    ],
    chitchat: [
      'Holm taps the tower gauge with a fingernail and writes a number in the log.',
      'She looks down through the glass at the pumps, listening rather than looking.',
      'She puts the kettle on and forgets it, and it clicks off by itself.',
      '"Two pumps running, one resting. That is the whole secret," she says, to nobody.',
    ],
    dialogue: {
      root: {
        text: '"Shut the door, it keeps the noise down." She doesn\'t look away from the board. "If you want water, there is a tap in the gallery. If you want a can of it, I sell those."',
        options: [
          // Only while the mains are failing (the engine's water_supply condition).
          { label: 'The taps are running thin.', next: 'thin', conditions: [{ water_supply: REGION, state: 'low' }] },
          { label: 'The taps are dry.', next: 'dry', conditions: [{ water_supply: REGION, state: 'dry' }] },
          { label: "The water's coming out grey.", next: 'grey', conditions: [{ water_supply: REGION, state: 'flowing', quality: ['cloudy', 'foul'] }] },
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What happens here?', next: 'works' },
          { label: 'What if it stops?', next: 'stops' },
          { label: "I'll leave you to it.", next: 'bye' },
        ],
      },
      works: {
        text: '"The Basin comes in through the screens, settles in the beds out back, goes through the sand and comes out clean." She points at each wall in turn. "Then the pumps put it in the mains, the station up at Halcyon lifts it, and Orla Kemp\'s tower sends it down to everybody. Every tap in Coldwater. One pipe."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      stops: {
        text: '"Then the tower holds the city for about four hours, and the taps run thin while it does." She shrugs. "Most faults I have fixed by then. If the power goes, or a motor burns out, the city goes dry and Quell gets rich."\n\n"Type <b>gauges</b> at the board if you want to know where we are. I do not mind people reading it. I mind people touching it."',
        options: [{ label: 'Back.', next: 'root' }],
      },
      thin: { text: "\"I know.\" She taps the tower gauge without looking at it. \"Something on the line has stopped. The tower is covering for it, and the tower has four hours in it when it's full. Read the gauges if you want the minutes.\"", options: [{ label: 'Back.', next: 'root' }] },
      dry: { text: "\"I know. I knew before you did.\" She doesn't stop writing. \"The tower's empty. When the pumps come back the water will run grey for a few minutes while the pipes fill. Don't drink that bit.\"\n\n\"Quell's prices went up an hour ago. They always do.\"", options: [{ label: 'Back.', next: 'root' }] },
      grey: { text: "\"Silt. Heavy rain stirs the Basin up and the beds can't settle it fast enough.\" She looks at the turbidity needle. \"Boil it. Or don't drink it. Those are the two choices, and only one of them is good.\"", options: [{ label: 'Back.', next: 'root' }] },
      bye: { text: 'She is already writing in the log.', options: [] },
    },
  },
};

const built = await authorBuilding(store, plant);

// The plant sells its cans at the plant's price, whatever the city is paying (plugins/waterworks).
const holm = store.get('npcs', 'npc_waterworks_holm');
store.patch('npcs', 'npc_waterworks_holm', { flags: { ...holm.flags, holds_water_price: true } });

// The intake has no roof, so rain and frost reach it. The plugin reads the weather here.
const intake = store.get('zones', 'zone_waterworks_intake');
store.patch('zones', 'zone_waterworks_intake', { ambient_theme: 'outdoors', flags: { ...intake.flags, open_sky: true } });

// ── the settling beds ─────────────────────────────────────────────────────────────────────────
// Mass, like the Old Coldwater ruins. Nothing walks onto them, so every neighbour's link is cut.
// Each bed gets its own map code: a tile with none has one derived for it, which the map check
// reads as a change from what shipped.
const BEDS = ['zone_district_920_901', 'zone_district_921_901'];
const BED_MARKERS = { zone_district_920_901: 'B1', zone_district_921_901: 'B2' };
for (const id of BEDS) {
  const prev = store.get('zones', id);
  const flags = { ...prev.flags };
  delete flags.terrain;
  delete flags.scavenging_table_id;
  delete flags.street_life;
  store.patch('zones', id, {
    name: 'Waterworks Settling Beds',
    description: 'A long open concrete bed full of still brown water, with a walkway along the wall and a sluice at each end. Silt settles here before the water goes on to the filters. Gulls stand on the walkway and watch it.',
    ambient_theme: 'outdoors', marker: BED_MARKERS[id], exits: {},
    flags: { ...flags, building_name: 'Waterworks Settling Beds', building_type: 'pumping_station', is_building: true, region_id: REGION },
  });
}
for (const z of store.all('zones')) {
  if (BEDS.includes(z.id)) continue;
  const links = Object.entries(z.exits || {}).filter(([, t]) => BEDS.includes(t));
  if (!links.length) continue;
  const exits = { ...z.exits };
  for (const [dir] of links) delete exits[dir];
  store.patch('zones', z.id, { exits });
}

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'would write' : 'wrote'} ${written.length} file(s): ${built.facadeId}, utility ${built.utilityRoomId}`);
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
