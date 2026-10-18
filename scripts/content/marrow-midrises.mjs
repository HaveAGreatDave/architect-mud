/**
 * KESTREL COURT, MARROW HOUSE AND CORBETT MANSIONS: two mid-rises and a low glass office round
 * Solenne Residences, and a block of mansion flats on Lever Lane.
 *
 *   node scripts/content/marrow-midrises.mjs [--dry-run]
 *
 * The block had two towers and five low shops, and David wanted it to read as a street of
 * buildings people live in. Kestrel Court (12) and Marrow House (6) flank Solenne on Marrow
 * Street in Solenne's own champagne glass, pale stone and bronze. Corbett Mansions (12, stepped
 * back twice) stands on Lever Lane next to Watts The Damage, on the tile The Slip had; all of them
 * stay well under the Meridian's 22.
 *
 * Five moves, in this order, because each one frees a tile the next one needs:
 *
 *   0. THE SLIP MOVES TO THE OLD WEIGH-HOUSE at 917,917, on the lay-by off The Gate Road where the
 *      weighbridge stood. Its rooms, door, fence and furniture keep their ids; only the shell moves.
 *
 *   1. UNIT 4 MOVES ACROSS THE ROAD. It's one of four storefronts a player can buy, so it isn't
 *      deleted: `zone_sf_marrow4` keeps its id (and with it any deed in the storefront tables) and
 *      moves into the shell Cash & Carrion leaves at 916,910. Its authored model is bound by name,
 *      so the building goes with it.
 *   2. CASH & CARRION GOES. It was the third fence within four tiles. Hock's two items nobody else
 *      sells (the radio and the watch) go to Kade at Sentimental Value Pawn, next door but three.
 *   3. NUTS TO THAT GOES. Watts The Damage sells hardware one tile behind it. The twelve items
 *      Watts didn't stock go onto Watts's list, and Wendel Corry is retired.
 *   4. THE BLOCKS GO UP: Kestrel on 913,908 and Corbett on 916,906, with three landings each, two
 *      flats a landing, an en suite in every flat, a roof, and Mixed Bag Variety Store off Corbett's
 *      lobby. Marrow House, a lobby and one empty office floor, goes on 915,908.
 *
 * ⚠ CORBETT WAS FIRST BUILT ON 915,908 FACING SOUTH, with the shop EAST of the lobby. Facing east
 * onto Lever Lane, the lobby's east slot is the street door, so the shop is SOUTH of it now. A
 * re-run cleans what the first site left: the shop's east link, the lobby's south exit to the old
 * facade, and the connection file for the old shop link.
 *
 * ⚠ ROOMS ARE NAMED WITH A COMMA, NOT THE LIB'S DASH. `authorBuilding` writes `<name> — <room>`;
 * the house rule is no em dashes in player-facing text, so every room is renamed after it runs.
 * A flat ends in `Unit 3A` so `floorDesignation` (scripts/content/derive.mjs) gives it a marker.
 *
 * ⚠ THE LANDINGS SKIP STOREYS ON PURPOSE. The interior has three landings and the building is
 * twelve storeys tall, so each landing is a storey number four apart (3, 7, 11 and 4, 8, 12) and
 * the stair between them says how far it is. The Meridian does the same thing with
 * six interior floors under twenty drawn storeys.
 *
 * Idempotent: every new id derives from a slug, and every deletion only fires while the file
 * still says what it used to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { authorBuilding, loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

// ── 0. The Slip moves to the old weigh-house at 917,917 ──────────────────────
// Its shop, back room, utility room, map, door, furniture and Sluice all keep their ids; the
// facade moves and everything that names the facade follows it. The tile it leaves, 916,906, is
// written over by Corbett in step 4.
const SLIP = 'zone_district_917_917';
const SLIP_STREET = 'zone_district_918_917';
const SLIP_OLD = 'zone_district_916_906';
const SLIP_CONN = 'conn_district_917_917_west_slip';
{
  const prev = store.get('zones', SLIP);
  const flags = { ...prev.flags };
  delete flags.terrain; delete flags.scavenging_table_id; delete flags.street_life;
  store.patch('zones', SLIP, {
    name: 'The Slip',
    description: 'The old weigh-house at the top of the lay-by, one squat brick room where a clerk wrote tickets for the lorries on the plates. His hatch is plated over with steel. The door is good: steel core, three hinges, a spyhole at the height of a short woman\'s eye. No sign. People who need to find it find it.',
    ambient_theme: 'urban', bg_color: '#1c1a20', color: '#6a6275', marker: 'SL',
    map_id: 'map_world', parent_zone: null,
    exits: { east: SLIP_STREET, west: 'zone_slip_shop' },
    flags: { ...flags, building_name: 'The Slip', building_type: 'fence', entrance: 'east', facade: true,
      is_building: true, region_id: 'region_coldwater', world_exit_zone: SLIP_STREET },
  });
  // A facade forwards anyone who steps on it, so every neighbour but the street loses its link in.
  for (const z of store.all('zones')) {
    if (z.id === SLIP || z.map_id === 'map_int_slip') continue;
    const links = Object.entries(z.exits || {}).filter(([, t]) => t === SLIP);
    if (!links.length && z.id !== SLIP_STREET) continue;
    const exits = { ...z.exits };
    for (const [dir] of links) delete exits[dir];
    if (z.id === SLIP_STREET) exits.west = SLIP;
    store.patch('zones', z.id, { exits });
  }
  for (const id of ['zone_slip_shop', 'zone_slip_back', 'zone_util_zone_slip_shop']) {
    const z = store.get('zones', id);
    const exits = id === 'zone_slip_shop' ? { ...z.exits, east: SLIP } : z.exits;
    const room = { zone_slip_shop: 'Shop', zone_slip_back: 'Behind the Curtain', zone_util_zone_slip_shop: 'Utility Room' }[id];
    store.patch('zones', id, { parent_zone: SLIP, exits, name: `The Slip, ${room}`, flags: { ...z.flags, world_exit_zone: SLIP } });
  }
  store.patch('maps', 'map_int_slip', { parent_zone_id: SLIP, name: 'The Slip, Interior' });
  store.patch('connections', SLIP_CONN, { id: SLIP_CONN, a: SLIP, b: 'zone_slip_shop', dir: 'west', blocked: false, lockable: true, one_way: false });
  store.patch('doors', 'door_shop_slip_shop', { zone_id: SLIP, connection_id: SLIP_CONN, exit_dir: 'west' });
  // The furniture the weigh-house came with.
  store.patch('furniture', 'furn_slip_dial', {
    id: 'furn_slip_dial', zone_id: 'zone_slip_shop', name: 'the weigh dial', object_type: 'decoration',
    description: 'A big brass-rimmed dial from the weighbridge, still on the wall where the clerk could read it. The needle rests on nothing. Sluice looks at it while she names a price, and never at you.',
    flags: { aliases: ['dial', 'weigh dial', 'needle', 'scale', 'gauge'] },
  });
  store.patch('furniture', 'furn_slip_hatch', {
    id: 'furn_slip_hatch', zone_id: 'zone_slip_shop', name: 'the plated hatch', object_type: 'decoration',
    description: 'The clerk\'s hatch onto the lay-by, a sliding window with a brass tray under it, plated over from outside with a sheet of steel. The tray is still there. A ticket for forty tonnes of aggregate is still in it, dated before the Curtain.',
    flags: { aliases: ['hatch', 'tray', 'ticket', 'window'] },
  });
  // The plates' tile names the hut now standing beside it.
  const plates = store.get('zones', 'zone_district_917_918');
  if (!plates.description.includes('weigh-house')) {
    store.patch('zones', 'zone_district_917_918', {
      description: `${plates.description} The weigh-house that went with them is still standing at the top of the lay-by, with a better door than it used to have.`,
    });
  }
}

// ── 1. Unit 4 moves to 916,910 ───────────────────────────────────────────────
const U4 = 'zone_district_916_910';
const U4_STREET = 'zone_district_916_909';
const unit4Moved = store.get('zones', 'zone_sf_marrow4')?.parent_zone === U4;

{
  const prev = store.get('zones', U4);
  const flags = { ...prev.flags };
  delete flags.sign_trade;   // PAWNBROKER was Hock's
  delete flags.floors;       // the parade shop is the shop default, three storeys
  store.patch('zones', U4, {
    name: 'Unit 4, Marrow Street',
    description: 'A wide, low brick shopfront with its window whitewashed from the inside and a letting notice taped to the glass. Four bright screw-holes and a ghost of a name show where the fascia came off. Solenne\'s glass goes up across the road. Whoever takes it gets the busiest forty feet of pavement on Marrow Street.',
    ambient_theme: 'indoors',
    bg_color: '#3a3550', color: '#e8e0ff',
    marker: 'M4',
    exits: { north: U4_STREET, south: 'zone_sf_marrow4' },
    flags: { ...flags, building_name: 'Unit 4, Marrow Street', building_type: 'shop', entrance: 'north', world_exit_zone: U4_STREET },
  });
  const room = store.get('zones', 'zone_sf_marrow4');
  store.patch('zones', 'zone_sf_marrow4', {
    parent_zone: U4,
    exits: { north: U4 },
    flags: { ...room.flags, world_exit_zone: U4 },
    description: room.description.replace('the studio crowd goes past', 'Marrow Street goes past'),
    ambient_events: [
      'Somebody tries the door handle from the street, looks through the whitewash, and moves on.',
      'The extractor housing in the ceiling ticks as it cools, though nothing has been running.',
      'A delivery van idles at the kerb outside, its warning tone flattening through the glass.',
      'The letting notice on the inside of the window peels another centimetre from the tape.',
    ],
  });
  const util = store.get('zones', 'zone_util_zone_sf_marrow4');
  store.patch('zones', 'zone_util_zone_sf_marrow4', { parent_zone: U4, flags: { ...util.flags, world_exit_zone: U4 } });
  store.patch('maps', 'map_int_sf_marrow4', { parent_zone_id: U4 });
  // Hock's street link is the right shape already (facade south into the shop); it now lands in Unit 4.
  store.patch('connections', 'conn_district_916_910_south_4osj', { b: 'zone_sf_marrow4' });
  const door = store.get('doors', 'door_sf_marrow4');
  store.patch('doors', 'door_sf_marrow4', {
    connection_id: 'conn_district_916_910_south_4osj', exit_dir: 'north', target_zone: U4,
    flags: door.flags || {},
  });
  // Denna Sorrel sits on the step of the empty shop. She goes where the shop goes.
  if (store.get('npcs', 'npc_lapsed_client')) {
    store.patch('npcs', 'npc_lapsed_client', { home_zone: U4, work_zone_id: U4 });
  }
}

// ── 2. Cash & Carrion: Hock's unique stock goes to Kade ──────────────────────
{
  const kade = store.get('npcs', 'npc_fence_kade');
  const have = new Set((kade.vendor_inventory || []).map((i) => i.item_id));
  const add = [{ item_id: 'item_pawn_radio', price: 35 }, { item_id: 'item_pawn_watch', price: 40 }].filter((i) => !have.has(i.item_id));
  if (add.length) store.patch('npcs', 'npc_fence_kade', { vendor_inventory: [...kade.vendor_inventory, ...add] });
  // Hock was the registered resident of Meridian 404. Dell Fry lives there too and takes the row.
  const res = store.get('npc_residences', 'zone_meridian_unit_404');
  if (res && res.npc_id === 'npc_pawn_fence') store.patch('npc_residences', 'zone_meridian_unit_404', { npc_id: 'npc_ration_cook' });
}

// ── 3. Nuts to That: Wendel's stock goes to Watts ────────────────────────────
{
  const watts = store.get('npcs', 'npc_repairman_watts');
  const have = new Set((watts.vendor_inventory || []).map((i) => i.item_id));
  const bolt = store.get('npcs', 'npc_bolt_keeper');
  const add = (bolt?.vendor_inventory || []).filter((i) => !have.has(i.item_id));
  if (add.length) {
    const inv = [...watts.vendor_inventory, ...add].sort((a, b) => a.price - b.price);
    store.patch('npcs', 'npc_repairman_watts', { vendor_inventory: inv });
  }
}

// ── 4. The two blocks ────────────────────────────────────────────────────────

// A resident who isn't a vendor: home, out, home. The vendor graph's off-shift half.
const RESIDENT_GRAPH = {
  _start: 'start',
  nodes: {
    start:          { type: 'start', next: 'off_home_check' },
    off_home_check: { type: 'condition', condition_type: 'AT_HOME', yes: 'home_idle', no: 'off_random' },
    off_random:     { type: 'random', options: ['go_home', 'have_life'] },
    go_home:        { type: 'action', action_type: 'GO_HOME', next: 'wait' },
    home_idle:      { type: 'action', action_type: 'AT_HOME_LIFE', next: 'wait' },
    have_life:      { type: 'action', action_type: 'HAVE_LIFE', next: 'wait' },
    wait:           { type: 'wait', seconds: 60, jitter: 60, next: 'off_home_check' },
  },
};

const ORD = { 3: 'Third', 4: 'Fourth', 7: 'Seventh', 8: 'Eighth', 11: 'Eleventh', 12: 'Twelfth' };

// One block: a lobby, three landings, two flats a landing, an en suite each, and a roof.
// `look` holds the per-building prose; everything else is the same plan twice.
function block(b) {
  const rooms = [{ key: 'lobby', name: 'Lobby', floor: b.lobbyFloor, description: b.lobby, window: b.lobbyWindow }];
  const lights = {};
  const props = [...(b.lobbyProps || [])];
  const flats = [];
  let below = 'lobby';
  b.floors.forEach((n, i) => {
    const land = `f${n}`;
    rooms.push({ key: land, name: `${ORD[n]} Floor Landing`, floor: b.landingFloor, from: below, dir: 'up', description: b.landing(n, i) });
    lights[land] = b.landingLight;
    for (const [side, dir] of [['a', 'west'], ['b', 'east']]) {
      const key = `${n}${side}`;
      const label = `${n}${side.toUpperCase()}`;
      rooms.push({ key, name: `Unit ${label}`, floor: b.flatFloor, from: land, dir, description: b.flat(n, side, i), window: b.flatWindow(n, side, i) });
      rooms.push({ key: `${key}_bath`, name: `Unit ${label} Bathroom`, floor: 'tile', from: key, dir: 'north', description: b.bath(n, side, i) });
      lights[key] = b.flatLight;
      lights[`${key}_bath`] = b.bathLight;
      props.push(...b.flatProps(key, label), ...b.bathProps(`${key}_bath`, label));
      flats.push({ key, label, n, side, i, rent: b.rent[i] });
    }
    below = land;
  });
  rooms.push({ key: 'roof', name: 'Roof', floor: 'concrete', from: below, dir: 'up', description: b.roof });
  lights.roof = b.roofLight;
  props.push(...(b.roofProps || []));
  if (b.shop) { rooms.push(b.shop.room); lights[b.shop.room.key] = b.shop.light; props.push(...b.shop.props); }
  return { rooms, lights, props, flats };
}

// ── Kestrel Court ──
const KESTREL = 'Kestrel Court';
const kestrel = block({
  floors: [3, 7, 11],
  rent: [180, 200, 220],
  lobbyFloor: 'tile', landingFloor: 'linoleum', flatFloor: 'boards',
  lobby: 'A lobby faced in Solenne\'s pale stone for the first three metres and painted plasterboard after that. Steel mailboxes line one wall, half the names out of date. The lift doors are taped shut with "out of order" on the tape. The stair climbs a glass tower you can see the street through.',
  lobbyWindow: { name: 'the stair glass', description: 'The stair tower is glazed from the pavement to the roof, so the lobby gets daylight down the full height of the building. Marrow Street goes past on the other side of it.', light: 0.85, visibility: 0.8 },
  lobbyProps: [
    { key: 'mailboxes', room: 'lobby', name: 'the mailboxes', objectType: 'decoration',
      description: 'Two rows of steel mailboxes with a slot and a name strip each. Most strips are typed. A few are written in biro over the old name, and one just says "not him".',
      flags: { aliases: ['mailboxes', 'mailbox', 'boxes', 'post', 'names'] } },
    { key: 'lift', room: 'lobby', name: 'the lift', objectType: 'decoration',
      description: 'Brushed steel doors with a button panel beside them. Somebody has taped them shut and written "out of order" on the tape, and somebody else has added "since when" underneath.',
      flags: { aliases: ['lift', 'elevator', 'button', 'doors'],
        examine_detail: 'The inspection card behind the scratched plastic by the buttons was signed nine years ago. The space for the next signature is empty.' } },
    { key: 'notice', room: 'lobby', name: 'the residents\' notice', objectType: 'decoration',
      description: 'A laminated sheet pinned by the mailboxes. Bins out Tuesday. No bikes on the landings. The roof is not a beer garden. Flats to let: ask at the door.',
      flags: { aliases: ['notice', 'sheet', 'board', 'rules'] } },
  ],
  landing: (n, i) => [
    `The ${ORD[n].toLowerCase()} floor landing: brown lino between two flat doors, A to the west and B to the east, and a fire door back to the stair. Through the stair glass Marrow Street runs off in both directions. A dead spider plant stands under the window. Somebody still waters it.`,
    `The ${ORD[n].toLowerCase()} floor landing, four flights up and the same as the last, except for a pushchair folded against the wall and the smell of somebody's dinner. Doors A and B face each other across the lino. Through the stair glass you can see over Adequate!'s roof to the green.`,
    `The ${ORD[n].toLowerCase()} floor landing, the top one. The stair carries on to a steel door marked Roof. The lino is newer up here, because the old lot curled in the heat under the roof. Below the stair glass the whole of Marrow Street is laid out, with Solenne going up past you like a wall of water.`,
  ][i],
  flat: (n, side, i) => {
    const view = [
      'Below it the grass and the Strand run down to the Basin.',
      'From here the Basin fills the bottom half of the window.',
      'From this high the Basin is the whole view.',
    ][i];
    const wall = side === 'a'
      ? 'You can hear the stairs through the west wall.'
      : 'Solenne, next door, blocks the morning sun.';
    return `A two-room flat with a galley kitchen, a bed and a woodblock floor lifting at the corners. A picture window opens onto a balcony just wide enough for a chair. ${view} ${wall} The bathroom is through a door at the back.`;
  },
  flatWindow: (n, side, i) => ({
    name: 'the balcony window',
    description: ['A bronze-framed picture window onto a narrow balcony with a glass rail, the Strand below and the Basin beyond.', 'A bronze-framed picture window onto the balcony. From up here the Basin is most of the view.', 'A bronze-framed picture window onto the balcony, and nothing above you but the roof. The Basin is all the view there is.'][i],
    light: 0.85, visibility: 0.9,
  }),
  bath: () => 'A narrow bathroom in white tile, the grout already going grey: a short bath with a shower over it, a basin under a mirror cabinet, and a toilet you have to flush twice. The fan comes on with the light and runs for ten minutes after it goes off.',
  landingLight: { name: 'the landing light', description: 'A round bulkhead light in a wire guard over the fire door. It comes on when you open the door and stays on longer than it needs to.', lumens: 900 },
  flatLight: { name: 'the ceiling light', description: 'A paper lantern shade over a bare bulb in the middle of the ceiling. Every tenant has meant to replace it.', lumens: 1400 },
  bathLight: { name: 'the bathroom light', description: 'A sealed bulkhead light over the mirror, on a pull-cord with a plastic acorn on the end.', lumens: 800 },
  roofLight: { name: 'the stair-head lamp', description: 'A caged lamp over the roof door, bright enough to find the door by and not much else.', lumens: 600 },
  flatProps: (key, label) => [
    { key: `${key}_bed`, room: key, name: 'the bed', objectType: 'furniture', description: 'A divan bed with a sprung mattress gone soft at the edge you sit on.', flags: { aliases: ['bed', 'divan', 'mattress'], interactions: ['lie', 'sit'] } },
    { key: `${key}_wardrobe`, room: key, name: 'the wardrobe', objectType: 'container', description: 'A built-in wardrobe with sliding doors that stick halfway. A rail, a shelf, and a smell of mothballs from three tenants ago.', flags: { aliases: ['wardrobe', 'closet', 'cupboard'], container: 60000, wardrobe: true, interactions: ['lean'] } },
    { key: `${key}_sink`, room: key, name: 'the kitchen sink', objectType: 'sink', description: 'A steel sink and drainer at the end of the galley worktop, with a mixer tap that runs hot after a long wait.', flags: { aliases: ['sink', 'kitchen sink', 'tap', 'drainer'], water_source: true, interactions: ['lean'] } },
    { key: `${key}_hob`, room: key, name: 'the hob', objectType: 'fixture', description: 'Two electric rings on the worktop. One of them heats.', powerKw: 0.3, flags: { aliases: ['hob', 'rings', 'cooker', 'stove'], stove_tier: 'low', interactions: ['lean'] } },
    { key: `${key}_fridge`, room: key, name: 'the fridge', objectType: 'container', description: 'An undercounter fridge that hums in a low key and shudders when it stops.', powerKw: 0.1, flags: { aliases: ['fridge', 'refrigerator'], appliance_grade: 'consumer', container: 40000, preserves: 'refrigerated', interactions: ['lean'] } },
  ],
  bathProps: (key) => [
    { key: `${key}_shower`, room: key, name: 'the shower', objectType: 'shower', description: 'An electric shower box on the wall over the bath. The water comes out warm, then hot, then warm again.', flags: {} },
    { key: `${key}_toilet`, room: key, name: 'the toilet', objectType: 'toilet', description: 'A wall-hung toilet with a push button. It flushes like a train going past.', flags: {} },
    { key: `${key}_basin`, room: key, name: 'the basin', objectType: 'sink', description: 'A pedestal basin under a mirror cabinet, the mirror going black at the edges.', flags: { aliases: ['basin', 'sink', 'mirror', 'tap'], water_source: true } },
  ],
  roof: 'Grey membrane inside a stone parapet with a bronze rail, and the lift motor room padlocked in the middle. The brochure called it a roof terrace. Washing lines run from the motor room to the rail. The Basin lies to the north, Marrow Street to the south, and Solenne\'s glass goes up and up to the east.',
  roofProps: [
    { key: 'washing', room: 'roof', name: 'the washing lines', objectType: 'decoration', description: 'Three plastic lines between the motor room and the bronze rail. A sheet, two shirts and a towel that has gone stiff in the wind.', flags: { aliases: ['washing', 'lines', 'sheet', 'shirts', 'towel'] } },
    { key: 'motorroom', room: 'roof', name: 'the lift motor room', objectType: 'decoration', description: 'A stone-clad box with a steel door and a padlock, a grille in the wall, and a danger sign for the lift machinery. Nothing inside it has turned in years.', flags: { aliases: ['motor room', 'box', 'door', 'padlock', 'machinery'] } },
  ],
});

// ── Corbett Mansions ──
const CORBETT = 'Corbett Mansions';
const SHOP = 'Mixed Bag Variety Store';
const corbett = block({
  floors: [4, 8, 12],
  rent: [240, 260, 280],
  lobbyFloor: 'tile', landingFloor: 'boards', flatFloor: 'boards',
  lobby: 'A long hall with a black-and-white tiled floor and a dado of brown glazed tile. A stone stair with a brass rail climbs past a birdcage lift that hasn\'t moved in years. Brass letter flaps are set into the wall in rows. To the south a bead curtain opens into Mixed Bag Variety Store, smelling of firelighters and boiled sweets.',
  lobbyWindow: { name: 'the fanlight', description: 'A half-moon of coloured glass over the street door, the lead between the panes black with age. The light comes through it red and green on the tiles.', light: 0.6, visibility: 0.3 },
  lobbyProps: [
    { key: 'letterflaps', room: 'lobby', name: 'the letter flaps', objectType: 'decoration',
      description: 'Rows of brass letter flaps in the wall, one per flat, each with a number engraved on a little brass plate. The polish has gone from all of them but 4A\'s.',
      flags: { aliases: ['letter flaps', 'flaps', 'letterbox', 'post', 'mail'] } },
    { key: 'lift', room: 'lobby', name: 'the birdcage lift', objectType: 'decoration',
      description: 'An iron lift cage with a folding gate, painted black, in a shaft of iron lattice up the middle of the stair. The cage sits at the ground floor with its gate pulled shut.',
      flags: { aliases: ['lift', 'cage', 'elevator', 'gate'],
        examine_detail: 'A card in a brass frame on the gate says the lift is out of use until the residents\' committee decides otherwise. The card is older than anyone on the committee.' } },
  ],
  landing: (n, i) => [
    `The ${ORD[n].toLowerCase()} floor landing, at the top of a long stone flight: polished boards, a runner down the middle and a tall sash window onto Lever Lane. Front doors with brass numbers face each other, 4A to the west and 4B to the east. The lift cage hangs dark in its lattice shaft.`,
    `The ${ORD[n].toLowerCase()} floor landing, four long flights higher. The runner here is a different colour, as if somebody ran out and bought the nearest thing. Doors 8A and 8B face each other across it. The window looks down into Watts's yard next door, and the blue flash of the welder comes up the wall when he works late.`,
    `The ${ORD[n].toLowerCase()} floor landing, the top one. The stair narrows and goes on up to a door in the roof. The doors to 12A and 12B are the original panelled oak. The window at the end has the whole of Lever Lane in it, and the Meridian's copper crown off to the south-east.`,
  ][i],
  flat: (n, side, i) => {
    const view = side === 'a'
      ? ['The sash window looks over the grass to the Basin.', 'The sash window looks over the Strand to the boats.', 'From up here you watch the lights come on round the Basin.'][i]
      : ['The sash window looks across Lever Lane at Salvage Rites.', 'The sash window looks over the roofs across Lever Lane.', 'The sash window looks down Lever Lane to the Meridian.'][i];
    const wall = side === 'a'
      ? 'In the afternoon the light off the water goes gold on the picture rail.'
      : 'The lane is loud until two and busy again by six.';
    return `A high-ceilinged flat with a picture rail and a boarded-up fireplace. A kitchenette fills the old scullery. ${view} ${wall} The bathroom is through a panelled door at the back.`;
  },
  flatWindow: (n, side, i) => ({
    name: 'the sash window',
    description: ['A tall sash window, its cords replaced with string.', 'A tall sash window over the rooftops. It rattles in a north wind.', 'A tall sash window with the city spread out under it.'][i],
    light: 0.8, visibility: 0.85,
  }),
  bath: () => 'Small black-and-white hexagonal tiles, a claw-foot bath under a ring rail with a shower on a hose, a basin on chrome legs and a toilet with a pull-chain. The frosted window has a ventilator in the top pane that clatters in the wind. The hot water comes up from the basement and takes its time.',
  landingLight: { name: 'the landing pendant', description: 'A milk-glass pendant on a brass chain over the stairhead. It lights the landing yellow.', lumens: 1000 },
  flatLight: { name: 'the ceiling rose', description: 'A fabric-shaded pendant hanging from a plaster ceiling rose, the plaster painted over so many times the leaves have gone soft.', lumens: 1500 },
  bathLight: { name: 'the bathroom light', description: 'A glass globe on the ceiling with a pull-cord switch.', lumens: 800 },
  roofLight: { name: 'the stair-head lamp', description: 'A bulkhead lamp over the roof door with a moth trapped in the glass.', lumens: 600 },
  flatProps: (key) => [
    { key: `${key}_bed`, room: key, name: 'the bed', objectType: 'furniture', description: 'An iron bedstead with brass knobs, a horsehair mattress and a lot of blankets.', flags: { aliases: ['bed', 'bedstead', 'mattress'], interactions: ['lie', 'sit'] } },
    { key: `${key}_wardrobe`, room: key, name: 'the wardrobe', objectType: 'container', description: 'A mahogany wardrobe with a long mirror in its door, too big to have come up the stairs, so it must have come in through the window.', flags: { aliases: ['wardrobe', 'closet', 'mirror'], container: 70000, wardrobe: true, interactions: ['lean'] } },
    { key: `${key}_sink`, room: key, name: 'the kitchen sink', objectType: 'sink', description: 'A deep white butler sink with a brass tap, in the old scullery corner.', flags: { aliases: ['sink', 'kitchen sink', 'butler sink', 'tap'], water_source: true, interactions: ['lean'] } },
    { key: `${key}_hob`, room: key, name: 'the cooker', objectType: 'fixture', description: 'A small enamel cooker with two rings and an oven nobody trusts.', powerKw: 0.3, flags: { aliases: ['cooker', 'hob', 'rings', 'stove', 'oven'], stove_tier: 'low', interactions: ['lean'] } },
    { key: `${key}_fridge`, room: key, name: 'the fridge', objectType: 'container', description: 'A round-shouldered cream fridge with a chrome handle like a car door.', powerKw: 0.1, flags: { aliases: ['fridge', 'refrigerator'], appliance_grade: 'consumer', container: 40000, preserves: 'refrigerated', interactions: ['lean'] } },
  ],
  bathProps: (key) => [
    { key: `${key}_shower`, room: key, name: 'the bath', objectType: 'shower', description: 'A claw-foot bath with a shower head on a hose and a curtain on a ring rail above it.', flags: { aliases: ['bath', 'bathtub', 'shower', 'tub', 'curtain'] } },
    { key: `${key}_toilet`, room: key, name: 'the toilet', objectType: 'toilet', description: 'A toilet with a high cistern and a pull-chain with a china handle that says Pull.', flags: {} },
    { key: `${key}_basin`, room: key, name: 'the basin', objectType: 'sink', description: 'A white basin on chrome legs, with separate hot and cold taps and a crack in the glaze.', flags: { aliases: ['basin', 'sink', 'taps'], water_source: true } },
  ],
  roof: 'A flat roof behind a brick parapet with a stone coping. A big timber water tank stands in the middle on steel legs, banded with iron hoops and streaked white by gulls. Chimney pots line the party walls. The Meridian\'s copper crown is to the south-east, Solenne\'s glass to the south-west and the Basin to the north-west.',
  roofProps: [
    { key: 'tank', room: 'roof', name: 'the water tank', objectType: 'decoration', description: 'A round tank of timber staves on four steel legs, held together with iron hoops and dripping slowly from one seam. A ladder goes up the side to a hatch in the lid.', flags: { aliases: ['tank', 'water tank', 'ladder', 'hoops', 'lid'],
      examine_detail: 'Painted on a stave near the bottom, almost gone: Corbett & Sons, 1931.' } },
    { key: 'chimneys', room: 'roof', name: 'the chimney pots', objectType: 'decoration', description: 'Rows of clay chimney pots on the party walls. None of them has had smoke out of it in years. One has a gull\'s nest in it.', flags: { aliases: ['chimneys', 'chimney', 'pots', 'nest'] } },
  ],
  shop: {
    room: { key: 'shop', name: 'Mixed Bag Variety Store', floor: 'boards', from: 'lobby', dir: 'south',
      description: 'A deep, narrow shop with shelves to the ceiling on both sides and a counter at the back under hanging cards of batteries, earplugs and cigarettes. Soap, socks, mugs, mops, tea, drain cleaner: it\'s all in here somewhere. The handwritten card over each shelf says what it holds, and none of them is right.',
      window: { name: 'the shop window', description: 'The shop window onto Lever Lane, crammed with sun-faded boxes and a cardboard sign that says IF WE HAVEN\'T GOT IT YOU DON\'T NEED IT.', light: 0.75, visibility: 0.5 } },
    light: { name: 'the strip lights', description: 'Two long fluorescent tubes down the middle of the ceiling, one of them flickering at the end.', lumens: 2200 },
    props: [
      { key: 'shelves', room: 'shop', name: 'the shelves', objectType: 'decoration', description: 'Floor-to-ceiling shelving on both walls, packed two deep. A handwritten card over each section: KITCHEN, BATHROOM, SMOKES, MISC, MORE MISC.', flags: { aliases: ['shelves', 'shelving', 'cards', 'stock'],
        examine_detail: 'Behind the drain cleaner on the MORE MISC shelf there is a single boxed snow globe of a city that isn\'t this one. It has no price on it.' } },
      { key: 'counter', room: 'shop', name: 'the counter', objectType: 'fixture', description: 'A wooden counter worn pale at the front edge, with a glass jar of boiled sweets on one end and a spike of receipts on the other.', flags: { aliases: ['counter', 'sweets', 'jar', 'receipts', 'spike'] } },
      { key: 'bell', room: 'shop', name: 'the shop bell', objectType: 'decoration', description: 'A brass bell on a coiled spring over the doorway. It rings when anybody comes through the bead curtain, and Effie looks up every time.', flags: { aliases: ['bell', 'curtain', 'bead curtain'] } },
      { key: 'till', room: 'shop', name: 'the till', objectType: 'fixture', description: 'A heavy old cash register with round keys and a drawer that comes out with a bang.', flags: { aliases: ['till', 'register', 'cash register', 'drawer'], vendor_safe: true, vendor_npc_id: 'npc_mixedbag_lark', hack_difficulty: 3 } },
    ],
  },
});

const MIX_INV = [
  { item_id: 'item_salt_ration', price: 3 },
  { item_id: 'item_pocket_chalk', price: 3 },
  { item_id: 'item_soap_block', price: 4 },
  { item_id: 'item_chipped_mug', price: 4 },
  { item_id: 'item_reagent_acid', price: 5 },
  { item_id: 'item_foam_earplugs', price: 6 },
  { item_id: 'item_condom', price: 6 },
  { item_id: 'item_iced_tea_carton', price: 6 },
  { item_id: 'item_rag_bandage', price: 7 },
  { item_id: 'item_tea_leaves_black', price: 7 },
  { item_id: 'item_battery', price: 8 },
  { item_id: 'item_enamel_mug', price: 8 },
  { item_id: 'item_current_fuse', price: 9 },
  { item_id: 'item_wooden_spoon', price: 9 },
  { item_id: 'item_soup_bowl', price: 8 },
  { item_id: 'item_duct_tape', price: 11 },
  { item_id: 'item_towel_rough', price: 11 },
  { item_id: 'item_coffee_grounds', price: 13 },
  { item_id: 'item_skipping_rope', price: 14 },
  { item_id: 'item_cigarettes', price: 16 },
  { item_id: 'item_mop', price: 17 },
  { item_id: 'item_wool_socks', price: 20 },
  { item_id: 'item_flashlight', price: 34 },
].filter((i) => store.get('items', i.item_id));

// Nuts to That's trade word would otherwise ride along on the tile and print HARDWARE under the tower.
{
  const z = store.get('zones', 'zone_district_915_908');
  if (z.flags.sign_trade) { const f = { ...z.flags }; delete f.sign_trade; store.patch('zones', z.id, { flags: f }); }
}

const idsK = await authorBuilding(store, {
  slug: 'kestrel', name: KESTREL, type: 'apartment',
  x: 913, y: 908, entrance: 'south', floors: 12, marker: 'KC', district: 'marrow',
  facade: {
    bgColor: '#2e2a22', color: '#ecdcb8',
    description: 'Twelve storeys of champagne glass between pale stone fins, put up by Solenne\'s developers on the rest of the plot. From the street it could be Solenne\'s little sister. Behind the glass the flats are the size flats always were. A glass stair tower climbs the east end, and KESTREL COURT is set in bronze letters over the door.',
  },
  rooms: kestrel.rooms, lights: kestrel.lights, props: kestrel.props,
  utility: { name: 'The Boiler Room', floor: 'concrete',
    description: 'A low concrete room under the lobby, warm and loud, with the boiler and the pumps along one wall and the junction box on the other. The bins live here in winter, which is why it smells the way it does.' },
});

const idsC = await authorBuilding(store, {
  slug: 'corbett', name: CORBETT, type: 'apartment',
  x: 916, y: 906, entrance: 'east', floors: 12, marker: 'CN', district: 'yards',
  facade: {
    bgColor: '#2e1e1a', color: '#e8c8a8',
    description: 'Twelve storeys of red brick banded in stone, stepped back twice, with a bay of windows up the middle. CORBETT MANSIONS is cut across the stone ground floor in letters a foot high. Below it are a carved doorcase and a shopfront under a striped awning: MIXED BAG over VARIETY STORE. A timber water tank stands on the roof.',
  },
  rooms: corbett.rooms, lights: corbett.lights, props: corbett.props,
  utility: { name: 'The Basement', floor: 'concrete',
    description: 'A brick-vaulted basement under the hall, with the boiler in one vault and the junction box in the next. The shop\'s stock overflows down here in boxes stacked to the vaults, labelled in Effie\'s hand.' },
  npc: {
    id: 'npc_mixedbag_lark', name: 'Effie Lark', sex: 'female', hp: 38,
    homeRoom: '4a', workRoom: 'shop', shopName: SHOP,
    description: 'A small, quick woman in her fifties in a cardigan with the sleeves pushed up, reading glasses on a chain and a pencil through her bun. She knows where everything in the shop is without looking, and she watches everybody who comes in as if she\'s trying to remember where she put them.',
    clothing: [
      'a green cardigan with the sleeves pushed up',
      'a flowered blouse buttoned to the neck',
      'a brown pleated skirt and sensible shoes',
      'reading glasses on a beaded chain',
    ],
    // Corner-shop hours. She opens before the trams and shuts after the pubs.
    schedule: {
      mon: [{ from: 7, to: 22 }], tue: [{ from: 7, to: 22 }], wed: [{ from: 7, to: 22 }],
      thu: [{ from: 7, to: 22 }], fri: [{ from: 7, to: 23 }], sat: [{ from: 8, to: 23 }], sun: [{ from: 9, to: 18 }],
    },
    inventory: MIX_INV,
    chitchat: [
      'Effie climbs the stepladder, takes a box down from the top shelf, looks in it, and puts it back.',
      'She moves a card that says KITCHEN from one shelf to the next one along.',
      '"If you can\'t see it, ask," she says, without looking up. "If I can\'t see it, it\'s in the basement."',
      'She sorts a handful of coins into the till by feel, reading the paper.',
      'The bell over the curtain rings. Effie looks up, sees who it is, and goes back to the paper.',
      'She shouts something up the stairwell and somebody several floors up shouts something back.',
    ],
    dialogue: {
      root: {
        text: '"What are you after?" She lowers the paper an inch.',
        text_by_relation: {
          first: 'The woman behind the counter looks at you over her glasses for longer than is comfortable, then folds the paper.\n\n"Effie. Mixed Bag. If it\'s small and you need it, I\'ve got it. If it\'s big you\'re in the wrong shop." She nods at the shelves. "What are you after?"',
          known: '"You again." She\'s already got the stepladder out. "What is it this time?"',
          familiar: '"Don\'t tell me." She looks you up and down. "Batteries." She\'s usually right.',
        },
        options: [
          { label: 'What have you got?', next: '__shop__' },
          { label: 'What sort of shop is this?', next: 'what' },
          { label: 'Where do I get proper tools?', next: 'watts' },
          { label: 'Are there flats going upstairs?', next: 'flats' },
          { label: 'Who lives up there?', next: 'bram' },
          { label: 'Nothing, thanks.', next: 'bye', enabled: true, actions: [], conditions: [] },
        ],
      },
      what: {
        text: '"Variety store." She says it as if it\'s obvious. "Everything a flat needs that you forgot you needed. Soap, socks, fuses, tea. Bandages for when the fuse goes wrong."\n\n"Proper tools are next door at Watts. I\'m for the stuff in between, and there\'s a lot of in between."',
        options: [
          { label: 'Let\'s see it, then.', next: '__shop__' },
          { label: 'Back up.', next: 'root' },
        ],
      },
      watts: {
        text: '"Next door, south. The one with the bench in the street." She points through the wall. "Sledgehammers, lockpicks, whatever you want, and he won\'t ask why. Mind the welder."',
        actions: [{ action: 'GPS_TO', zone: 'zone_district_916_907' }],
        options: [{ label: 'Back up.', next: 'root' }],
      },
      flats: {
        text: '"Sometimes." She jerks a thumb at the ceiling. "Go up and look. If a door\'s on the latch and nobody\'s in, it\'s going. Rent\'s paid by the week and the agent doesn\'t care who you are, which round here is a selling point."\n\n"Kestrel Court on Marrow Street\'s cheaper, and it\'s got glass like Solenne\'s and walls like paper. We\'ve got no lift either, but ours is nicer to look at."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bram: {
        text: '"Me, on four. And my uncle Bram, who had this shop before I did, and who still comes down and tells me I\'ve put everything in the wrong place." She doesn\'t sound like she minds. "He does the books. He\'s better at sums than he is at stairs."',
        options: [{ label: 'Back up.', next: 'root' }],
      },
      bye: {
        text: '"Mind the bell," she says. The bell rings anyway.',
        options: [],
      },
    },
  },
});

// ── Marrow House ──
// Solenne's style at a quarter of its height: champagne glass in pale stone fins, a bronze canopy.
// Corbett has to be authored first: until it is, its rooms still name 915,908 as their parent,
// and `authorBuilding` would leave their exits pointing at an office.
const MARROW = 'Marrow House';
const idsM = await authorBuilding(store, {
  slug: 'marrowhouse', name: MARROW, type: 'office',
  x: 915, y: 908, entrance: 'south', floors: 6, marker: 'MO', district: 'marrow',
  facade: {
    bgColor: '#2e2a22', color: '#ecdcb8',
    description: 'Six storeys of champagne glass in pale stone fins, Solenne\'s style at a quarter of its height. A bronze canopy runs out over a revolving door, and MARROW HOUSE is set in bronze letters on the stone above it. The directory board by the door has room for twelve tenants and lists two.',
  },
  rooms: [
    { key: 'lobby', name: 'Reception', floor: 'tile',
      description: 'A double-height reception hall in pale stone and bronze, with a long desk nobody sits behind and a fig tree in a planter that somebody waters. Two lifts work, which on this street makes it the most expensive building per square foot. The stair is behind a frosted glass door.',
      window: { name: 'the front glass', description: 'Floor-to-ceiling champagne glass onto Marrow Street, tinted so that the street looks like late afternoon at any hour.', light: 0.8, visibility: 0.8 } },
    { key: 'suite', name: 'Fourth Floor, To Let', floor: 'carpet', from: 'lobby', dir: 'up',
      description: 'A whole open floor with nobody on it: grey carpet tiles, a raised floor with the access panels showing, columns in a grid and the glass on every side. A letting agent\'s board leans on a column: AVAILABLE, 4,200 SQ FT, WILL DIVIDE. The view of Solenne is the selling point, and it\'s mostly Solenne.',
      window: { name: 'the curtain wall', description: 'Glass on every side. To the west, Solenne goes up out of sight. To the north, the Basin.', light: 0.95, visibility: 0.95 } },
  ],
  lights: {
    suite: { name: 'the ceiling panels', description: 'Recessed light panels in a grid across the ceiling, all of them on, for nobody.', lumens: 2400 },
  },
  props: [
    { key: 'directory', room: 'lobby', name: 'the directory board', objectType: 'decoration',
      description: 'A bronze board by the lifts with twelve slots for tenants\' names. Two are filled: a production company on the second floor and a firm of loss adjusters on the fifth.',
      flags: { aliases: ['directory', 'board', 'tenants', 'names'] } },
    { key: 'desk', room: 'lobby', name: 'the reception desk', objectType: 'fixture',
      description: 'A long curved desk in pale stone with a bronze lip, a bell and a sign that says PLEASE RING. Nobody comes.',
      flags: { aliases: ['desk', 'reception', 'bell', 'sign'] } },
    { key: 'fig', room: 'lobby', name: 'the fig tree', objectType: 'decoration',
      description: 'A weeping fig in a bronze planter, real and healthy, with a watering can hidden behind it.',
      flags: { aliases: ['fig', 'tree', 'plant', 'planter', 'watering can'] } },
    { key: 'agentboard', room: 'suite', name: 'the letting board', objectType: 'decoration',
      description: 'A letting agent\'s board propped against a column: AVAILABLE, 4,200 SQ FT, WILL DIVIDE, and a phone number with the last two digits worn off.',
      flags: { aliases: ['board', 'letting board', 'sign', 'agent'] } },
  ],
  utility: { name: 'The Plant Room', floor: 'concrete',
    description: 'A clean, cold plant room under reception: the air handlers, the lift motors and the junction box, all labelled, all humming in tune. It\'s the only part of the building that\'s fully occupied.' },
});
store.patch('zones', 'zone_marrowhouse_lobby', { name: `${MARROW}, Reception` });
store.patch('zones', 'zone_marrowhouse_suite', { name: `${MARROW}, Fourth Floor, To Let`, grid_z: 1 });
store.patch('zones', idsM.utilityRoomId, { name: `${MARROW}, The Plant Room` });
store.patch('maps', idsM.mapId, { name: MARROW });

// ── names, flats, doors, the roof ────────────────────────────────────────────
const GRID = { lobby: [0, 0, 0], shop: [0, 1, 0], roof: [0, 0, 4] };
function finish(slug, name, plan) {
  const rid = (k) => `zone_${slug}_${k}`;
  for (const r of plan.rooms) {
    const z = store.get('zones', rid(r.key));
    const f = { ...z.flags };
    let grid = GRID[r.key] || [0, 0, 0];
    const m = /^f(\d+)$/.exec(r.key);
    const lvl = (n) => [3, 4].includes(n) ? 1 : [7, 8].includes(n) ? 2 : 3;
    if (m) grid = [0, 0, lvl(+m[1])];
    const flat = plan.flats.find((x) => r.key === x.key || r.key === `${x.key}_bath`);
    if (flat) {
      const gx = flat.side === 'a' ? -1 : 1;
      grid = [gx, r.key.endsWith('_bath') ? -1 : 0, lvl(flat.n)];
    }
    if (flat && r.key === flat.key) { f.is_apartment = true; f.rent_cost = flat.rent; }
    if (r.key === 'roof') { f.open_sky = true; }
    store.patch('zones', rid(r.key), {
      name: `${name}, ${r.name}`,
      ambient_theme: r.key === 'roof' ? 'outdoors' : 'indoors',
      grid_x: grid[0], grid_y: grid[1], grid_z: grid[2],
      flags: f,
    });
  }
  // The roof is in the building network but never indoors; its lamp still needs a power row.
  const lobbyPower = store.get('power_zones', rid('lobby'));
  if (lobbyPower) {
    for (const r of plan.rooms) {
      if (store.get('power_zones', rid(r.key))) continue;
      store.patch('power_zones', rid(r.key), { ...lobbyPower, id: rid(r.key), name: `${name}, ${r.name}` });
    }
  }
  // A hololock on every flat, a privacy bolt on every bathroom.
  for (const fl of plan.flats) {
    const dir = fl.side === 'a' ? 'west' : 'east';
    const back = fl.side === 'a' ? 'east' : 'west';
    store.patch('doors', `door_${slug}_${fl.key}`, {
      id: `door_${slug}_${fl.key}`, zone_id: rid(fl.key), exit_dir: back, target_zone: rid(`f${fl.n}`),
      connection_id: `conn_hf_${slug}_f${fl.n}_${dir}`, door_type: 'basic', flags: {},
      hololock_difficulty: 5, hp: 1000, hp_max: 1000, is_locked: 0, is_open: 0, lock_state: 'locked',
      name: `Unit ${fl.label} door`,
      tags: { 'lock:hololock': { canHack: true, difficulty: 5 } },
    });
    store.patch('doors', `door_${slug}_${fl.key}_bath`, {
      id: `door_${slug}_${fl.key}_bath`, zone_id: rid(`${fl.key}_bath`), exit_dir: 'south', target_zone: rid(fl.key),
      connection_id: `conn_hf_${slug}_${fl.key}_north`, door_type: 'basic', flags: {},
      hololock_difficulty: 5, hp: 1000, hp_max: 1000, is_locked: 0, is_open: 0, lock_state: 'unlocked',
      name: null,
      tags: { 'lock:privacylock': { privacySide: rid(`${fl.key}_bath`), messages: {
        denied: 'The bolt is on the other side.',
        lock: 'You slide the bolt across.',
        unlock: 'You slide the bolt back.' } } },
    });
  }
}
finish('kestrel', KESTREL, kestrel);
finish('corbett', CORBETT, corbett);

store.patch('zones', 'zone_util_zone_kestrel_lobby', { name: `${KESTREL}, The Boiler Room` });
store.patch('zones', 'zone_util_zone_corbett_lobby', { name: `${CORBETT}, The Basement` });

// The first site's leftovers: the shop's way back was east, and the lobby's south was the street.
store.patch('zones', 'zone_corbett_shop', { exits: { north: 'zone_corbett_lobby' } });

// The shop door off the lobby locks when Effie goes home.
store.patch('doors', 'door_shop_corbett_shop', {
  id: 'door_shop_corbett_shop', zone_id: 'zone_corbett_lobby', exit_dir: 'south', target_zone: 'zone_corbett_shop',
  connection_id: 'conn_hf_corbett_lobby_south', door_type: 'basic', flags: {},
  hololock_difficulty: 5, hp: 1000, hp_max: 1000, is_locked: 0, is_open: 0, lock_state: 'locked', name: null,
  tags: { 'lock:shoplock': { canHack: true, difficulty: 4, messages: {
    denied: 'The shop lock reads your hand and declines to recognise it.',
    lock: 'The bolt drops. The bell over the curtain gives one last ring.',
    unlock: 'The bolt lifts. The bell over the curtain rings.' } } },
});

// Effie lives on four with her uncle, who had the shop before her.
store.patch('npcs', 'npc_mixedbag_lark', { flags: { ...(store.get('npcs', 'npc_mixedbag_lark').flags || {}), personality: 'vendor' } });
store.patch('npcs', 'npc_mixedbag_tolley', {
  id: 'npc_mixedbag_tolley', name: 'Bram Tolley', sex: 'male', hp: 26, hp_max: 26,
  description: 'A thin old man in a three-piece suit gone shiny at the knees, with a ledger under his arm and a pencil behind his ear. He takes the stairs one at a time with a hand on the rail and a pause on every landing, and he has opinions about where everything in the shop should go.',
  npc_type: 'npc', faction: null,
  home_zone: 'zone_corbett_4a', work_zone_id: null,
  behaviour_graph: RESIDENT_GRAPH,
  dialogue_tree: {
    root: {
      text: '"Mm?" He looks up from the ledger and keeps his finger on the line.',
      text_by_relation: {
        first: 'The old man looks up from a ledger, finger on the line he was reading.\n\n"Tolley. Bram. Fourth floor, the polished one." He taps the ledger. "Did my niece charge you right? She rounds down. Forty years I had that shop and I never once rounded down."',
        known: '"Mm. You." He goes back to the ledger. "She\'s moved the candles again, I suppose."',
        familiar: '"Sit down a minute," he says, "these stairs aren\'t getting any shorter."',
      },
      options: [
        { label: 'You had the shop?', next: 'shop' },
        { label: 'Never mind.', next: 'bye', enabled: true, actions: [], conditions: [] },
      ],
    },
    shop: {
      text: '"Forty years. It was a tobacconist when I took it, and a sweet shop, and then whatever people asked for." He shrugs. "That\'s all a variety store is. You keep saying yes. Effie says yes faster than I did."',
      options: [{ label: 'Back up.', next: 'root' }],
    },
    bye: { text: '"Mind the third step down," he says. "It\'s loose. It\'s been loose since the war."', options: [] },
  },
  chitchat: [
    'Bram turns a page of the ledger and runs his pencil down a column, lips moving.',
    'He stops on the landing, puts a hand on the rail, and gets his breath back.',
    '"Rounded down again," he says to nobody, and makes a note.',
  ],
  banter: [], home_activities: [],
  flags: { clothing_layers: ['a brown three-piece suit shiny at the knees', 'a collarless shirt with a stud', 'braces and polished black boots'], personality: 'gruff' },
  studio_zone_id: null, wander_zones: [], wanders: 0,
});
store.patch('npc_residences', 'zone_corbett_4a', { zone_id: 'zone_corbett_4a', npc_id: 'npc_mixedbag_lark', note: null });

// ── Everything that was Nuts to That and Cash & Carrion, and Unit 4's old link ─
// ⚠ EACH ONE IS DELETED ONLY WHILE IT STILL SAYS WHAT IT USED TO.
const boltZ = (o) => ['zone_bolt_shop', 'zone_bolt_yard', 'zone_util_zone_bolt_shop'].includes(o.zone_id);
const hockZ = (o) => ['zone_hock_pawn', 'zone_util_zone_hock_pawn'].includes(o.zone_id);
const gone = [
  // Nuts to That
  ['zones/zone_bolt_shop.json', (o) => o.parent_zone === 'zone_district_915_908'],
  ['zones/zone_bolt_yard.json', (o) => o.parent_zone === 'zone_district_915_908'],
  ['zones/zone_util_zone_bolt_shop.json', (o) => o.parent_zone === 'zone_district_915_908'],
  ['maps/map_int_bolt.json', (o) => o.parent_zone_id === 'zone_district_915_908'],
  ['connections/conn_bolt_shop_down_wsn9.json', (o) => o.a === 'zone_bolt_shop'],
  ['connections/conn_bolt_shop_south_fh0e.json', (o) => o.a === 'zone_bolt_shop'],
  ['doors/door_basic_zone_bolt_shop_out.json', boltZ],
  ['generators/gen_zone_util_zone_bolt_shop.json', boltZ],
  ['power_zones/zone_bolt_shop.json', (o) => o.id === 'zone_bolt_shop'],
  ['power_zones/zone_bolt_yard.json', (o) => o.id === 'zone_bolt_yard'],
  ['power_zones/zone_util_zone_bolt_shop.json', (o) => o.id === 'zone_util_zone_bolt_shop'],
  ...['bolt_alarm', 'bolt_bench', 'bolt_drawers', 'bolt_pegboard', 'jbox_zone_util_zone_bolt_shop', 'light_zone_bolt_shop',
    'light_zone_bolt_yard', 'light_zone_util_zone_bolt_shop', 'safe_npc_bolt_keeper'].map((k) => [`furniture/furn_${k}.json`, boltZ]),
  ['npcs/npc_bolt_keeper.json', (o) => o.work_zone_id === 'zone_bolt_shop'],
  ['building_models/nutstothat.json', (o) => o.id === 'nutstothat'],
  // Cash & Carrion
  ['zones/zone_hock_pawn.json', (o) => o.parent_zone === U4],
  ['zones/zone_util_zone_hock_pawn.json', (o) => o.parent_zone === U4],
  ['maps/map_int_hock.json', (o) => o.parent_zone_id === U4],
  ['connections/conn_util_zone_hock_pawn_up_a7yv.json', (o) => o.a === 'zone_util_zone_hock_pawn'],
  ['doors/door_shoddy_zone_district_916_910_in.json', (o) => o.target_zone === 'zone_hock_pawn'],
  ['generators/gen_zone_util_zone_hock_pawn.json', hockZ],
  ['generators/gen_zone_util_zone_hock_pawn_1784350438849.json', hockZ],
  ['power_zones/zone_hock_pawn.json', (o) => o.id === 'zone_hock_pawn'],
  ['power_zones/zone_util_zone_hock_pawn.json', (o) => o.id === 'zone_util_zone_hock_pawn'],
  ...['hock_alarm', 'jbox_zone_util_zone_hock_pawn', 'light_zone_hock_pawn', 'light_zone_util_zone_hock_pawn', 'pawncase_hock',
    'safe_npc_pawn_fence'].map((k) => [`furniture/furn_${k}.json`, hockZ]),
  ['npcs/npc_pawn_fence.json', (o) => o.work_zone_id === 'zone_hock_pawn'],
  ['building_models/cashcarrion.json', (o) => o.id === 'cashcarrion'],
  // Unit 4's old street link at 913,908
  ['connections/conn_district_913_908_north_x4s1.json', (o) => o.b === 'zone_sf_marrow4'],
  // The Slip's old street link at 916,906, and Corbett's shop link from its first site
  ['connections/conn_district_916_906_west_6af3.json', (o) => o.a === SLIP_OLD && o.b === 'zone_slip_shop'],
  ['connections/conn_hf_corbett_lobby_east.json', (o) => o.a === 'zone_corbett_lobby' && o.b === 'zone_corbett_shop'],
];

const written = store.flush({ dryRun: DRY });
const removed = [];
for (const [rel, stale] of gone) {
  const p = path.join(store.baseDir, rel);
  if (!fs.existsSync(p)) continue;
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  // A generator's zone is its `zone_id`; a power row's is its id. Either answers `stale`.
  if (stale(o)) { if (!DRY) fs.unlinkSync(p); removed.push(rel); }
  else console.warn(`  ! kept ${rel}: it no longer says what it used to`);
}
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}, ${removed.length} ${DRY ? 'would be ' : ''}removed${unit4Moved ? ' (Unit 4 had already moved)' : ''}`);
for (const r of removed) console.log('  - ' + r);
console.log(`  ${KESTREL}: ${idsK.facadeId}  ${idsK.mapId}  ${idsK.utilityRoomId}`);
console.log(`  ${CORBETT}: ${idsC.facadeId}  ${idsC.mapId}  ${idsC.utilityRoomId}`);
console.log(`  ${MARROW}: ${idsM.facadeId}  ${idsM.mapId}  ${idsM.utilityRoomId}`);
