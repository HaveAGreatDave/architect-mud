// ONE-SHOT: Old Coldwater runs on gas.
//
//   node scripts/content/old-coldwater-gaslight.mjs [--dry-run]
//
// The quarter shipped with five enterable trades, eleven interior rooms, eleven overhead
// lights and a junction box per building, all of it working perfectly. That is the one
// thing this district should not be: it is a shanty against the east Curtain whose shops
// are a roof and a counter better off than the tents forty feet away, and NOT MORE THAN
// THAT. This gives it the vision it was written for and never got.
//
// ⚠ THE SUPPLY IS FINE. The feed reaches every one of these buildings and the city plant
// is carrying a fifth of its capacity. What has failed is the box on the wall, in five
// separate buildings, because nobody has come out to look at any of them. That is why
// the boxes carry `flags.faulted` rather than being cut off their city plant: a building
// disconnected upstream reads as the grid failing to reach a district, which is a much
// bigger claim and the wrong one. The lights are all still installed. None of them work.
//
// ⚠ AND A GAS LANTERN IS NOT A LIGHT FIXTURE WITH THE DRAW SET TO ZERO. The power sim cuts
// every `object_type='light'` in a dead zone, so a lantern authored the obvious way is
// switched off by the grid it does not use, and `drawKwFor` bills an unrecognised light_type
// at DRAW_DEFAULT_W, so a room lit by gas would help brown out its own junction box.
// `OFFGRID_LIGHT_TYPES` in server/engine/environment.js is the seam: gas/oil/candle/carbide/
// flame are exempt from the cut, draw nothing, and raise `has_emergency_lighting`, which is
// already exactly "this room has light when the grid does not" and lands at 0.3 artificial
// light. Dim, and not dark. That is the whole register of the place.
//
// What it does:
//   1. Faults the five junction boxes.
//   2. A gas lantern in each of the eleven rooms, beside the dead overhead, which stays.
//   3. Camping stoves where people actually live, and a butane canister to run them on.
//   4. Prose: the dead overhead and the lantern in every room, and the two ways the quarter
//      earns, which are begging and going out after mutants.
//
// ⚠ THE HUNTING IS WRITTEN WITHOUT A VERDICT. docs/lore-wildblood.md is explicit that the
// Watch calls it cannibalism, the Wildblood call it inheritance, and the game takes no side.
// These are people who need the money or the meat; nothing here tells the player what to
// think about that, and no line is admiring or disgusted.
//
// ⚠ NO EM DASHES. They are an Ascendant voice tell and this is the other end of the city.

import { loadContentStore } from '../../tools/lib/content-store.mjs';

const dryRun = process.argv.includes('--dry-run');
const store = loadContentStore();

// ── 1. the boxes ─────────────────────────────────────────────────────────────
const BUILDINGS = ['919_917', '922_917', '923_917', '924_917', '926_917'];
let faulted = 0;
for (const b of BUILDINGS) {
  const id = `gen_zone_util_zone_bld_${b}_lobby`;
  const g = store.get('generators', id);
  if (!g) { console.error(`MISSING generator ${id}`); process.exit(1); }
  if (g.flags?.faulted) continue;
  store.patch('generators', id, { flags: { ...(g.flags || {}), faulted: true } });
  faulted++;
}

// ── 2. the lanterns ──────────────────────────────────────────────────────────
// lumen_output is documentation while the box is dead (an unpowered zone reads
// has_emergency_lighting and nothing else), and load-bearing the day somebody repairs one.
// 400 lm is a real pressure lantern; the dead overheads are 1200.
const LANTERNS = {
  zone_bld_919_917_lobby:   ['a gas lantern',        'Standing on the counter with the glass smoked brown up one side. It lights the scales and whoever has their hands on them.'],
  zone_bld_919_917_tank:    ['a gas lantern',        'Hung off a trestle leg on a wire hook, well away from the jerrycans, which is the only rule anybody down here says out loud.'],
  zone_bld_922_917_attic:   ['a gas lantern',        'Wired to the propped tube at head height. Everybody coming up the stair ducks it and nobody has moved it.'],
  zone_bld_922_917_dorm:    ['the hanging lantern',  'One lantern for thirty bunks, hung dead centre so the argument about who gets the light cannot be won by anybody.'],
  zone_bld_922_917_lobby:   ['a gas lantern',        'On the desk, turned to face the pigeonholes rather than the door, so the man behind it can read a name but you cannot read his face.'],
  zone_bld_923_917_kitchen: ['a gas lantern',        'Bracketed over the range where the cook needs it. The mantle has been replaced so often the bracket is polished.'],
  zone_bld_923_917_lobby:   ['two gas lanterns',     'One at the hatch and one halfway down, which leaves the far end of the hall in the dark it was already in.'],
  zone_bld_924_917_lobby:   ['a gas lantern',        'In the window rather than the room, because the window is the advertising and the room can manage.'],
  zone_bld_924_917_table:   ['the swing-arm lantern','Gas, on a counterweighted arm, dragged over the table and set hissing before anything starts. It is the brightest light in Old Coldwater and it is aimed at a tabletop.'],
  zone_bld_926_917_lobby:   ['a gas lantern',        'Lashed to the frame over the counter where the tarpaulin starts. It sways when the weather comes in from the south and everybody has stopped noticing.'],
  zone_bld_926_917_still:   ['a gas lantern',        'Set on the floor in the far corner, as far from the still as the room allows, which is not very far.'],
};
// ⚠ EVERY ROOM, DERIVED RATHER THAN COUNTED. A room left off this list keeps its dead
// overhead and gets no lantern, which is a pitch-black room somebody has to walk into to
// find; the first draft of this file missed The Front Desk exactly that way. The set of
// rooms is a property of the five buildings, so ask for it instead of maintaining a total.
const ROOMS = store.all('zones')
  .filter(z => BUILDINGS.some(b => z.id.startsWith(`zone_bld_${b}_`)) && !z.id.startsWith('zone_util'))
  .map(z => z.id);
const unlit = ROOMS.filter(id => !LANTERNS[id]);
if (unlit.length) {
  console.error(`REFUSING: ${unlit.length} room(s) would be left with no light:`);
  for (const id of unlit) console.error(`  ${id} "${store.get('zones', id).name}"`);
  process.exit(1);
}

let lanterns = 0;
for (const [zoneId, [name, description]] of Object.entries(LANTERNS)) {
  const id = `furn_light_gas_${zoneId}`;
  if (store.get('furniture', id)) continue;
  store.put('furniture', {
    description, flags: {}, hp: null, hp_max: null, id,
    light_type: 'gas', lumen_output: 400, name,
    object_type: 'light', power_draw_kw: 0, price: 40, zone_id: zoneId,
  });
  lanterns++;
}
// ⚠ THE DEAD OVERHEADS ALL STAY, INCLUDING THE ONE IN 924_917_table WHOSE PROSE ALREADY
// NAMED A SWING-ARM LAMP. Removing a fixture is a content DELETION, which has to be
// imported before it is committed or guard-deletions blocks the push; and it would be the
// wrong call anyway. A dead ceiling fitting still screwed to the joist beside a working gas
// lamp is the whole point of the quarter: nothing has been taken out, it has just stopped.

// ── 3. stoves and butane ─────────────────────────────────────────────────────
if (!store.get('items', 'item_butane_canister')) {
  store.put('items', {
    description: null, flags: {}, id: 'item_butane_canister', name: 'butane canister',
    tags: {
      description: 'A blue steel cylinder that clicks into a camping stove. Shake it and you can hear roughly how long you have got.',
      material: true, stackable: true,
    },
    type: 'material', value: 18, weight: 380,
  });
}
// Part-used canisters come out of the camp with the rest of the sorted tipping, which is
// where everybody gets theirs. Converging: matched on table + item, never re-added.
const SCAV = [['scav_consumer_trash', 6, 7], ['scav_roadside_junk', 3, 9]];
let scavRows = 0;
for (const [table_id, weight, difficulty] of SCAV) {
  const exists = store.all('scavenging_table_items')
    .some(r => r.table_id === table_id && r.item_id === 'item_butane_canister');
  if (exists) continue;
  store.put('scavenging_table_items', {
    difficulty, id: `scav_butane_${table_id}`, item_id: 'item_butane_canister',
    max_qty: 1, table_id, weight,
  });
  scavRows++;
}
const STOVES = {
  zone_bld_922_917_dorm: ['a shelf of camping stoves', 'Every bunk that can afford one has a single-burner stove on the shelf above it, and every stove has a name on the base in different handwriting. The house stove is for heat. These are for eating.'],
  zone_district_920_918: ['a camping stove',            'Set on a paving slab outside the oldest tent, with the canister sat in a tin of water to stop it frosting up and cutting out. Somebody has done this before.'],
  zone_district_924_918: ['a camping stove',            'Two burners going under a windbreak made of a car door. Whatever is in the pan has been in it a while.'],
  zone_district_925_915: ['a camping stove',            'Under the washing lines on an upturned crate, lit, with nothing on it. It is doing the job a fire would do if anybody here were allowed a fire.'],
};
let stoves = 0;
for (const [zoneId, [name, description]] of Object.entries(STOVES)) {
  const id = `furn_camp_stove_${zoneId}`;
  if (store.get('furniture', id)) continue;
  if (!store.get('zones', zoneId)) { console.error(`MISSING zone ${zoneId}`); process.exit(1); }
  store.put('furniture', {
    description, flags: { aliases: 'stove,burner,camping stove', interactions: ['examine'] },
    hp: null, hp_max: null, id, light_type: null, lumen_output: null, name,
    object_type: 'appliance', power_draw_kw: null, price: 0, zone_id: zoneId,
  });
  stoves++;
}

// ── 4. prose ─────────────────────────────────────────────────────────────────
// Appended, never rewritten: the existing descriptions are good and they are not mine.
const APPEND = {
  zone_bld_919_917_lobby:   'The overhead has not come on in two years. Nobody has taken it down.',
  zone_bld_919_917_tank:    'The strip light up in the joists is a shape in the dark and has been since before the labelling started.',
  zone_bld_922_917_attic:   'The landing light works the way everything else in the building works, which is to say it is there.',
  zone_bld_922_917_dorm:    'The overhead has been dead so long that the men who complained about it sleeping under it have all moved on.',
  zone_bld_922_917_lobby:   'The ceiling fitting over the desk has not been switched on in the time anybody currently in the building has been here.',
  zone_bld_923_917_kitchen: 'The ceiling light is dead and the list gets written by lantern, which is why the corrections.',
  zone_bld_923_917_lobby:   'The hall was wired for six lights. The box outside has been waiting on a call-out since the spring, and the queue has stopped mentioning it.',
  zone_bld_924_917_lobby:   'The fitting in the ceiling has a bulb in it and has never once been switched on by anybody currently alive in this building.',
  zone_bld_926_917_lobby:   'Nothing electric in here has worked since the box went, which the regulars will tell you makes no difference to the drink.',
  zone_bld_926_917_still:   'No electric light in here at all now, which everybody agrees is a mercy given what the room is full of.',
};
let prosed = 0;
for (const [zoneId, sentence] of Object.entries(APPEND)) {
  const z = store.get('zones', zoneId);
  if (!z) { console.error(`MISSING zone ${zoneId}`); process.exit(1); }
  if (z.description.includes(sentence)) continue;
  store.patch('zones', zoneId, { description: `${z.description} ${sentence}` });
  prosed++;
}
// 924_917_table: the swing-arm lamp is gas now, so the sentence naming it has to say so.
{
  const z = store.get('zones', 'zone_bld_924_917_table');
  const was = 'A scrubbed table under a lamp on a swing arm,';
  const now = 'A scrubbed table under a gas lamp on a swing arm, hissing,';
  if (z && z.description.includes(was)) {
    store.patch('zones', 'zone_bld_924_917_table', { description: z.description.replace(was, now) });
    prosed++;
  }
}
// How the quarter earns. Two sentences, in two places, neither of them a verdict.
const ECONOMY = {
  zone_district_921_918: 'Half the people sat out here have been up at the Gate Road since first light with a cup, and the other half went out through it after something with a bounty on its parts. Which half anybody is in changes week to week.',
  zone_district_927_917: 'The men who work the wastes come back along the wall rather than up the lane, because what they are carrying is either meat or it is worth money, and either way it is nobody\'s business until it is weighed.',
  zone_district_922_916: 'A woman works the lane most mornings with a cup and a folded coat, and gets more out of the queue at No Such Thing than she does out of anybody on Kessler Street.',
};
for (const [zoneId, sentence] of Object.entries(ECONOMY)) {
  const z = store.get('zones', zoneId);
  if (!z) { console.error(`MISSING zone ${zoneId}`); process.exit(1); }
  if (z.description.includes(sentence)) continue;
  store.patch('zones', zoneId, { description: `${z.description} ${sentence}` });
  prosed++;
}

// ── write ────────────────────────────────────────────────────────────────────
const written = store.flush({ dryRun });
console.log(`${dryRun ? 'would write' : 'wrote'} ${written.length} file(s)`);
console.log(`  boxes faulted   ${faulted}`);
console.log(`  gas lanterns    ${lanterns}`);
console.log(`  camping stoves  ${stoves}`);
console.log(`  scav rows       ${scavRows} (butane)`);
console.log(`  prose           ${prosed} room(s)/tile(s)`);
