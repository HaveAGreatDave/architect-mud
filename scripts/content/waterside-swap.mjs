/**
 * THE WATERSIDE SWAP: Any Port goes behind the water tower, Grounds for Concern takes Any Port's
 * plot as an L round its own car park, and the café's old plot on Greenside Row is left to let.
 *
 *   node scripts/content/waterside-swap.mjs [--dry-run]
 *
 *   910,906   ANY PORT, on the Strand behind High Water Mark, its door west onto Meltwater Row.
 *             The tile was sand (`zone_district_910_906`) and the facade takes its id, the way
 *             The Slip took the weigh-house's (marrow-midrises.mjs).
 *   908,907   GROUNDS FOR CONCERN, on Any Port's old plot, its door west onto the end of Greenside
 *             Row. The `groundscafe` arm draws it as an L: the café along Greenside Row, the
 *             roastery down Meltwater Row, and the car park in the corner between them.
 *   906,908   A VACANT PLOT where the café stood, walkable, drawn by the `vacant_plot` arm.
 *
 * Every interior room, map, door, connection, furniture row and NPC keeps its id; only the facades
 * change tiles, and everything that names a facade follows it. The connection files keep their
 * ids too, though the ids still say where they were minted (an id belongs to its file).
 *
 * The plot is fenced on Meltwater Row and Voss Avenue, so geometry projects two links its exits
 * don't have; `mint-connections.mjs --write` writes them as blocked connection files.
 *
 * Run `node scripts/content/mint-connections.mjs --write` and `npm run content:lint` afterwards.
 * Idempotent: every write is a full statement of the end state.
 */
import { loadContentStore } from './halcyon/lib.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();
const tile = (x, y) => `zone_district_${x}_${y}`;
const get = (id) => { const z = store.get('zones', id); if (!z) throw new Error(`${id} does not exist`); return z; };
// Every column a row had, emptied. The import only sets the columns a file carries, so a column the
// new occupant doesn't have has to be written as null or it survives in the DB. `color`, `bg_color`
// and `marker` are the exception: content:lint wants them omitted, and the import nulls them when
// they are (registry omitWhenNull), so they go from the row altogether.
const OMIT_WHEN_NULL = ['color', 'bg_color', 'marker'];
const cleared = (z) => Object.fromEntries(Object.keys(z).filter((k) => !OMIT_WHEN_NULL.includes(k))
  .map((k) => [k, k === 'flags' || k === 'exits' ? {} : (Array.isArray(z[k]) ? [] : null)]));
const putZone = (z) => {
  for (const k of OMIT_WHEN_NULL) if (z[k] == null) delete z[k];
  store.put('zones', z);
};

const AP_NEW = tile(910, 906), AP_STREET = tile(909, 906);
const GC_NEW = tile(908, 907), GC_STREET = tile(907, 907);
const PLOT = tile(906, 908);
const AP_ROOMS = ['zone_bld_908_907_lobby', 'zone_bld_908_907_loft', 'zone_bld_908_907_tide', 'zone_util_zone_bld_908_907_lobby'];
const GC_ROOMS = ['zone_grounds_cafe', 'zone_grounds_roastery', 'zone_util_zone_grounds_cafe'];

// Has this run already? Then the facades are read from where they are now.
const apFrom = get(AP_NEW).flags?.building_name === 'Any Port' ? AP_NEW : tile(908, 907);
const gcFrom = get(GC_NEW).flags?.building_name === 'Grounds for Concern' ? GC_NEW : PLOT;
const ap = structuredClone(get(apFrom)), gc = structuredClone(get(gcFrom));
if (ap.flags?.building_name !== 'Any Port') throw new Error(`Any Port is not on ${apFrom}`);
if (gc.flags?.building_name !== 'Grounds for Concern') throw new Error(`Grounds for Concern is not on ${gcFrom}`);

// A facade forwards anyone who steps on it, so of its world neighbours only its street links in.
function onlyStreetLinksIn(facade, street, dir) {
  for (const z of store.all('zones')) {
    if (z.map_id !== 'map_world' || z.id === facade) continue;
    const exits = { ...(z.exits || {}) };
    let changed = false;
    for (const [d, to] of Object.entries(exits)) if (to === facade && z.id !== street) { delete exits[d]; changed = true; }
    if (z.id === street && exits[dir] !== facade) { exits[dir] = facade; changed = true; }
    if (changed) store.patch('zones', z.id, { exits });
  }
}
// Re-parent a building's rooms onto its new facade; `front` is the room the street door opens into.
function rehome(rooms, facade, front, inDir, mapId) {
  for (const id of rooms) {
    const z = get(id);
    let exits = z.exits;
    if (id === front) {
      exits = Object.fromEntries(Object.entries(z.exits || {}).filter(([, to]) => !/^zone_district_/.test(to)));
      exits[inDir] = facade;
    }
    store.patch('zones', id, { parent_zone: facade, exits, flags: { ...z.flags, world_exit_zone: facade } });
  }
  store.patch('maps', mapId, { parent_zone_id: facade });
}

// ── 1. ANY PORT, BEHIND THE WATER TOWER ─────────────────────────────────────────────────────
{
  const flags = { ...ap.flags, district: 'docks', entrance: 'west', world_exit_zone: AP_STREET };
  delete flags.terrain; delete flags.scavenging_table_id;
  putZone({
    ...cleared(get(AP_NEW)), ...ap, id: AP_NEW, grid_x: 910, grid_y: 906, grid_z: 0, map_id: 'map_world', parent_zone: null,
    description: 'A square block of grey brick on the sand behind the water tower, with a lantern on top: eight sides, glazed the whole way round, and a mast standing out of the roof with a black ball on it two thirds of the way up. At one o\'clock the ball drops to the foot of the mast. ANY PORT is on the door in gold leaf, which is the only gold leaf on this stretch of water.',
    exits: { west: AP_STREET, east: 'zone_bld_908_907_lobby' },
    flags,
  });
  onlyStreetLinksIn(AP_NEW, AP_STREET, 'east');
  rehome(AP_ROOMS, AP_NEW, 'zone_bld_908_907_lobby', 'west', 'map_int_bld_908_907');
  store.patch('connections', 'conn_bld_908_907_lobby_south_ckxr', { b: AP_NEW, dir: 'west' });
  store.patch('doors', 'door_basic_zone_district_908_907_in', { zone_id: AP_NEW, exit_dir: 'east' });
}

// ── 2. GROUNDS FOR CONCERN, ON ANY PORT'S PLOT ──────────────────────────────────────────────
{
  putZone({
    ...cleared(get(GC_NEW)), ...gc, id: GC_NEW, grid_x: 908, grid_y: 907, grid_z: 0, map_id: 'map_world', parent_zone: null,
    description: 'A one-storey brick café on the corner of Greenside Row and Meltwater Row, built in an L round its own car park, with the Basin behind it. It\'s glazed along Greenside Row under a green and cream striped awning, and the roastery runs back down Meltwater Row. A white cup the size of a water tank stands on the roof and steams when they roast.',
    exits: { west: GC_STREET, east: 'zone_grounds_cafe' },
    flags: { ...gc.flags, entrance: 'west', world_exit_zone: GC_STREET },
  });
  onlyStreetLinksIn(GC_NEW, GC_STREET, 'east');
  rehome(GC_ROOMS, GC_NEW, 'zone_grounds_cafe', 'west', 'map_int_grounds');
  store.patch('connections', 'conn_district_906_908_south_rz25', { a: GC_NEW, dir: 'east' });
  store.patch('doors', 'door_shop_grounds_cafe', { zone_id: GC_NEW, exit_dir: 'east' });

  const roastery = get('zone_grounds_roastery');
  store.patch('zones', 'zone_grounds_roastery', { flags: { ...roastery.flags, window: {
    ...roastery.flags.window,
    description: 'A small window onto the car park, filmed brown on the inside from years of roasting.',
  } } });

  // Tobiah explains the move instead of what happened next door.
  const tob = store.get('npcs', 'npc_tobiah_gresh');
  const tree = structuredClone(tob.dialogue_tree);
  tree.root.options = tree.root.options.map((o) => (o.next === 'nextdoor' ? { label: 'Didn\'t you used to be up the road?', next: 'moved' } : o));
  delete tree.nextdoor;
  tree.moved = {
    text: '"Greenside Row, by the gardens. The harbour office went round behind the water tower, and its plot came with a car park and a view of the Basin, so I took it." He looks at the roaster. "Moving that took four men and a morning I won\'t get back."',
    options: [
      { label: 'Where do I get medicine round here?', next: 'chemist' },
      { label: 'Back up.', next: 'root' },
    ],
  };
  store.patch('npcs', 'npc_tobiah_gresh', { dialogue_tree: tree });
}

// ── 3. THE CAFÉ'S OLD PLOT, TO LET ──────────────────────────────────────────────────────────
{
  putZone({
    ...cleared(get(PLOT)), id: PLOT, name: 'Vacant Plot', map_id: 'map_world', grid_x: 906, grid_y: 908, grid_z: 0, parent_zone: null,
    description: 'The bare concrete slab where Grounds for Concern stood, fenced off from Greenside Row with mesh panels on concrete feet. One panel is off its foot and leans on the next. A letting board on two posts says PLOT TO LET and gives a number, and under it somebody has written ENGAGED. Bolt holes in the slab mark where the counter was.',
    ambient_theme: 'urban', color: '#8a8478',
    ambient_events: [
      'The wind gets into the mesh panels and they rattle against their feet all along the front.',
      'Somebody stops at the letting board, reads the number, and doesn\'t write it down.',
      'A carrier bag crosses the slab and catches on the fence.',
    ],
    exits: { north: tile(906, 907), west: 'zone_greenside_905_908' },
    flags: { district: 'filaments', region_id: 'region_coldwater', terrain: 'concrete', street_life: true,
      building_name: 'Vacant Plot', building_type: 'vacant_plot', entrance: 'north', floors: 1 },
  });

  const lot = get('zone_greenside_905_908');
  store.patch('zones', 'zone_greenside_905_908', {
    description: 'Five bays of tarmac lined in white, with a concrete stop at the head of each. A blue sign on a post still reserves it for customers of a café that moved to the waterfront. A lamp post stands by the entrance off Greenside Row, bollards close the far end at Voss Avenue, and the empty plot is on the east.',
    ambient_events: [
      'A car noses into a bay, stops, and the driver sits for a minute with the engine off before getting out.',
      'A delivery van stops across two bays with its hazards on.',
      'Somebody parks, walks to where the café was, and stands there.',
    ],
    exits: { ...lot.exits, east: PLOT },
  });
  const garden = get('zone_greenside_904_908');
  store.patch('zones', 'zone_greenside_904_908', {
    description: garden.description.replace('the café\'s car park on the east', 'a car park on the east'),
    ambient_events: garden.ambient_events.map((e) => (/roasting coffee/.test(e) ? 'A dog is let off its lead at the gate and does one lap of the path.' : e)),
  });
}

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'DRY RUN: ' : ''}${written.length} file(s) ${DRY ? 'would be written' : 'written'}`);
for (const p of written) console.log('  ' + p.replace(/.*content[\\/]/, 'content/'));
console.log('\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint');
