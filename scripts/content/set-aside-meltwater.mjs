/**
 * Midway Parks Cinema takes Florist Gump's plot, facing Fisherman's Green, and four buildings come
 * off the map for now: Florist Gump (909,914), Rod Almighty (908,914), Loafing Around (907,914) and
 * the Grind House (912,913).
 *
 *   node scripts/content/set-aside-meltwater.mjs [--dry-run]
 *
 * The four are SET ASIDE, not deleted, as the Hughson Coliseum's block and the Kettle three were
 * (docs/proposals/stored-buildings.md): each facade moves onto `map_set_aside` with its id, prose,
 * flags, interior, furniture and keeper, and its `world_exit_zone` names itself. They sit on row 7
 * of the holding grid, clear of the Coliseum's block (rows 1 to 3) and the Kettle three (row 5), two
 * columns apart so no two touch. Grass lots with new ids (`zone_lot_<x>_<y>`) take the three plots
 * the cinema doesn't, and the cinema's old one.
 *
 * ⚠ MIDWAY MOVES WITH ITS ID. `zone_district_912_914` stands at 909,914 now, facing north onto
 * Meltwater Row, so its rooms, door, deck and anything a player holds keep pointing at it. The
 * door's connection keeps its id (a lock grant is keyed by it) and turns from east to south, and the
 * auditorium moves behind the foyer so you walk in front to back, the way the model is drawn.
 *
 * The Grind House's tape, Sister Steel, was already in the cinema's deck and never played. It
 * becomes the late show on Friday and Saturday (`deck_programme`), and the auditorium's screen
 * takes its picture from the deck in the projection box (`deck_feed`): a deck only ever answered
 * for a set in its own room, so the screen showed nothing.
 *
 * Run `node scripts/content/mint-connections.mjs --write` afterwards. Idempotent.
 */
import fs from 'fs';
import path from 'path';
import { loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const HOLD = 'map_set_aside';
const MIDWAY = 'zone_district_912_914';
const oldId = (x, y) => `zone_district_${x}_${y}`;
const lotId = (x, y) => `zone_lot_${x}_${y}`;
const STEPS = [['north', 0, -1, 'south'], ['south', 0, 1, 'north'], ['east', 1, 0, 'west'], ['west', -1, 0, 'east']];

// [x, y, holding grid x, holding grid y, keeper set aside]
const ASIDE = [
  [909, 914, 1, 7, 'npc_florist_fairweather'],
  [908, 914, 3, 7, 'npc_rod_prendergast'],
  [907, 914, 5, 7, 'npc_loafing_coyne'],
  [912, 913, 7, 7, null],
];
// Vessa Orme lives in the Meridian, which stays, so she isn't set aside: she just has no shop to go to.
const NO_WORK = ['npc_smith_vessa'];

// [x, y, district, description]
const LOTS = [
  [907, 914, 'commercial', 'Cleared ground behind builder\'s mesh, two shopfronts wide, rolled flat and already going green at the edges. The next wall still carries the pale outline of a pitched roof, and a capped gas main stands up out of the rubble on a post.'],
  [908, 914, 'commercial', 'The other half of the cleared plot. A pallet of reclaimed brick waits under a tarp in the middle of it, and across the road the bronze fisherman has a clear view of nothing at all.'],
  [912, 913, 'nightlife', 'Scrub on the corner of Foundry Way with the slab of a long shed still in it, black and gritty at one end where a forge stood. Nothing grows on that end.'],
  [912, 914, 'nightlife', 'Rough grass over broken tarmac, running back from Meltwater Row to a line of fence posts where a hoarding stood. Past it the road gives up and the ground starts to mean it.'],
];

const MIDWAY_DESC = 'It faces Fisherman\'s Green and the bronze fisherman across Meltwater Row, and it\'s the only front on this side of the green that was built to be looked at. It went up as a music hall: cream faience between oxblood pilasters, three tall round-headed windows where the circle bar was, and a copper dome on each corner like a pair of hatpins. Behind it the stage house climbs two storeys past the roof. MIDWAY PARKS runs across the front in tubes, and off the corner a blade four storeys tall spells CINEMA downwards, a third of its bulbs out in a pattern that hasn\'t changed in years. Under it all a canopy on chained rods, lamps let into its underside, over glazed doors with brass push-plates worn to the white metal. The letter board reads THE METER READER 8PM FRI SAT LATE SISTER STEEL. The first half has been up long enough to fade round the letters, and the second half is in newer letters that don\'t match.';

const LATE_SHOW = {
  label: 'And the late show?',
  node: {
    options: [{ label: 'Back.', next: 'film' }],
    text: '"Sister Steel," he says. "Friday and Saturday, ten o\'clock. Auggie Prine, Meltwater Drive-In Releasing, certified unsuitable for corporate viewing, which is the only review it\'s ever had."\n\nHe makes a note in the ledger.\n\n"The tape\'s Vessa Orme\'s. She ran it on the set in her shop until her customers knew it by heart, and then she lent it me, because a picture like that wants a screen. It does better than the eight o\'clock. I\'ve stopped asking why."',
  },
};

// Replace `from` with `to` in `text`, once. Already replaced is fine (the script is idempotent);
// neither present means the prose moved under us, and guessing would write the wrong line.
function swap(text, from, to, what) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`${what}: neither the old nor the new line is there`);
  return text.replace(from, to);
}

const zoneAt = (x, y, notId) => store.all('zones').find((q) => q.map_id === 'map_world'
  && q.grid_x === x && q.grid_y === y && (q.grid_z ?? 0) === 0 && q.id !== notId);
const open = (z) => z && !z.flags?.facade && !z.flags?.building_type;

// 1. The four facades go to the holding map, keeping only their links into their own rooms.
for (const [x, y, gx, gy, keeper] of ASIDE) {
  const id = oldId(x, y), z = store.get('zones', id);
  if (!z) throw new Error(`${id} does not exist`);
  if (z.map_id === 'map_world') {
    if (z.grid_x !== x || z.grid_y !== y) throw new Error(`${id} is at ${z.grid_x},${z.grid_y}, not ${x},${y}`);
    const exits = {};
    for (const [dir, to] of Object.entries(z.exits || {})) {
      const t = store.get('zones', to);
      if (t && t.map_id !== 'map_world' && t.parent_zone === id) exits[dir] = to;
    }
    store.put('zones', {
      ...z, map_id: HOLD, grid_x: gx, grid_y: gy, grid_z: 0, exits,
      flags: { ...z.flags, set_aside: true, set_aside_from: `${x},${y}`, world_exit_zone: id },
    });
  }
  if (keeper) {
    const n = store.get('npcs', keeper);
    if (!n) throw new Error(`${keeper} does not exist`);
    store.patch('npcs', keeper, { flags: { ...(n.flags || {}), set_aside: true } });
  }
}
for (const id of NO_WORK) store.patch('npcs', id, { work_zone_id: null });

// Nothing on the world points at a set-aside facade any more.
const gone = new Set(ASIDE.map(([x, y]) => oldId(x, y)));
for (const z of store.all('zones')) {
  if (z.map_id !== 'map_world') continue;
  const exits = { ...(z.exits || {}) };
  let changed = false;
  for (const [dir, to] of Object.entries(exits)) if (gone.has(to)) { delete exits[dir]; changed = true; }
  if (changed) store.patch('zones', z.id, { exits });
}

// 2. Midway Parks takes the florist's plot, door north onto Meltwater Row.
{
  const z = store.get('zones', MIDWAY);
  store.put('zones', {
    ...z, grid_x: 909, grid_y: 914, grid_z: 0, description: MIDWAY_DESC,
    exits: { north: 'zone_district_909_913', south: 'zone_reel_foyer' },
    flags: { ...z.flags, entrance: 'north', world_exit_zone: 'zone_district_909_913' },
  });
  const street = store.get('zones', 'zone_district_909_913');
  store.patch('zones', street.id, { exits: { ...(street.exits || {}), south: MIDWAY } });
  store.patch('connections', 'conn_district_912_914_east_7om9', { dir: 'south' });
  store.patch('doors', 'door_shop_reel_foyer', { exit_dir: 'south' });

  // In through the foyer and on into the auditorium behind it, rather than off to one side.
  const foyer = store.get('zones', 'zone_reel_foyer');
  store.put('zones', { ...foyer, exits: { down: 'zone_util_zone_reel_foyer', north: MIDWAY, south: 'zone_reel_house', up: 'zone_reel_box' } });
  const house = store.get('zones', 'zone_reel_house');
  store.put('zones', { ...house, grid_x: 0, grid_y: 1, grid_z: 0, exits: { north: 'zone_reel_foyer' } });
  store.patch('connections', 'conn_reel_foyer_east_xe6k', { dir: 'south' });
}

// 3. The late show, and a screen that shows what the box is playing.
{
  const deck = store.get('furniture', 'furn_reel_deck');
  if (!deck.flags.deck_cassettes.includes('bc_sister_steel')) throw new Error('furn_reel_deck has no Sister Steel to show');
  const late = [{ from: 22, to: 24, tape: 'bc_sister_steel' }];
  store.put('furniture', { ...deck, flags: { ...deck.flags, deck_programme: { fri: late, sat: late } } });
  const screen = store.get('furniture', 'furn_reel_screen');
  store.put('furniture', { ...screen, flags: { ...screen.flags, deck_feed: 'furn_reel_deck' } });
}

// 4. The prose that pointed at the old site or at a shop that's gone.
{
  const n = store.get('npcs', 'npc_reel_nissen');
  const tree = JSON.parse(JSON.stringify(n.dialogue_tree));
  tree.theatre.text = swap(tree.theatre.text, 'running the fair on the waste ground opposite', 'running the fair on the green opposite', 'Nissen theatre');
  if (!tree.film.options.some((o) => o.next === 'film_late')) {
    tree.film.options.splice(tree.film.options.length - 1, 0, { label: LATE_SHOW.label, next: 'film_late' });
  }
  tree.film_late = LATE_SHOW.node;
  store.put('npcs', {
    ...n, dialogue_tree: tree,
    description: swap(n.description, 'the flats upstairs and the shop next door', 'the flats upstairs and a shop round the corner', 'Nissen description'),
  });

  const ludd = store.get('npcs', 'npc_print_ludd');
  const lt = JSON.parse(JSON.stringify(ludd.dialogue_tree));
  lt.writs.text = swap(lt.writs.text, 'the black-edged cards for the florist over the park at cost', 'the black-edged cards for funerals at cost', 'Ludd writs');
  store.put('npcs', { ...ludd, dialogue_tree: lt });

  const line = store.get('furniture', 'furn_justmytype_3');
  store.put('furniture', { ...line, description: swap(line.description, 'a stack of small black-edged cards for the florist across the park', 'a stack of small black-edged mourning cards', 'drying line') });
}

// 5. Grass on the four empty plots, joined both ways to every open neighbour, the other lot included.
for (const [x, y, district, description] of LOTS) {
  const id = lotId(x, y);
  const was = zoneAt(x, y, id);
  if (was) throw new Error(`${x},${y} still holds ${was.id}`);
  const exits = {};
  for (const [dir, dx, dy, back] of STEPS) {
    const nb = zoneAt(x + dx, y + dy, id);
    if (!open(nb)) continue;
    exits[dir] = nb.id;
    store.patch('zones', nb.id, { exits: { ...(store.get('zones', nb.id).exits || {}), [back]: id } });
  }
  const prev = store.get('zones', id) || {};
  store.put('zones', {
    ambient_events: [], ambient_theme: 'city', ...prev,
    id, name: 'Waste Ground', description, exits,
    map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, parent_zone: null,
    flags: { district, region_id: 'region_coldwater', terrain: 'grass' },
  });
  const pz = store.get('power_zones', oldId(x, y));
  if (pz) store.patch('power_zones', id, { ...pz, id, name: 'Waste Ground' });
}

const written = store.flush({ dryRun: DRY });
const removed = [];
// The cinema's old street link, from 912,914 west to 911,914. Left in, it would walk you from the
// door at 909,914 three tiles east.
for (const id of ['conn_district_912_914_west_cv4h']) {
  const p = path.join(store.baseDir, 'connections', `${id}.json`);
  if (fs.existsSync(p)) { removed.push(p); if (!DRY) fs.unlinkSync(p); }
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s), ${removed.length} connection file(s) removed`);
for (const p of [...written, ...removed]) console.log('  ' + path.relative(process.cwd(), p));
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
