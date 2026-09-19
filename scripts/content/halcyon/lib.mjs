/**
 * Halcyon Fields — the shared authoring helper for the quarter's buildings.
 *
 * A building here is a SPEC (see batch1.mjs) and this turns one into content files.
 * It owns nothing the rest of the pipeline already owns:
 *
 *   - the utility room, junction box, generator, the anchor's light and a
 *     `power_zones` row for every room come from `authorUtilityRoom`, the same
 *     blueprint the dev panel's New Building route runs. A second copy of that is
 *     how a room ends up scored as open air.
 *   - files are written through `loadContentStore`, so runtime columns are stripped
 *     and every file lands canonical.
 *
 * ⚠ `world_exit_zone` MEANS TWO DIFFERENT THINGS and the field name does not say
 * which: on the FACADE it is the STREET, on every INTERIOR room it is the FACADE.
 * `content:lint` only catches the facade half, by comparing it against the interior
 * map's `parent_zone_id`.
 *
 * ⚠ THE ENTRY ROOM'S WAY OUT FACES THE ENTRANCE SIDE, never `in`/`out`.
 * `interiorExitDirs()` only draws way-out arrows for cardinal links, so an `in` link
 * leaves the interior map with no arrow home (audit DIR-1). The facade's link INTO
 * the building is the cardinal OPPOSITE its entrance; the entry room's link back is
 * the entrance direction itself, which makes the pair reciprocal.
 *
 * ⚠ GEOMETRY PROJECTS NO VERTICAL EXIT, so every up/down link needs a connection
 * file or `zone_edges` drops it and the stair does not open.
 */
import { loadContentStore } from '../../../tools/lib/content-store.mjs';
import { authorUtilityRoom } from '../../../tools/lib/utility-room.mjs';

export const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

// The standard vendor routine: shift, chitchat, cash up, walk the takings to an ATM,
// go home, have a life. It carries NO zone references at all — every movement node is
// GO_TO_WORK / GO_HOME / VENDOR_GO_TO_ATM, which read the NPC's own `work_zone_id` and
// `home_zone` — so one graph serves every vendor in the quarter.
export const VENDOR_GRAPH = Object.freeze({
  _start: 'start',
  nodes: {
    start:          { type: 'start', next: 'check_work' },
    check_work:     { type: 'action', action_type: 'CHECK_VENDOR_WORK', goToWork: 'go_to_work', endShift: 'cash_up', offWork: 'off_home_check', haveLife: 'have_life' },
    go_to_work:     { type: 'action', action_type: 'GO_TO_WORK', next: 'player_check' },
    player_check:   { type: 'condition', condition_type: 'PLAYER_PRESENT', yes: 'work_say', no: 'work_wait' },
    work_say:       { type: 'action', action_type: 'VENDOR_CHITCHAT', next: 'work_wait' },
    work_wait:      { type: 'wait', seconds: 25, jitter: 20, next: 'check_work' },
    cash_up:        { type: 'wait', seconds: 20, jitter: 900, next: 'collect_safe' },
    collect_safe:   { type: 'action', action_type: 'VENDOR_COLLECT_SAFE', next: 'go_to_atm' },
    go_to_atm:      { type: 'action', action_type: 'VENDOR_GO_TO_ATM', next: 'atm_emote' },
    atm_emote:      { type: 'action', action_type: 'EMOTE', params: { message: 'steps up to the ATM terminal and makes a deposit.' }, next: 'atm_wait' },
    atm_wait:       { type: 'wait', seconds: 10, jitter: 20, next: 'deposit' },
    deposit:        { type: 'action', action_type: 'VENDOR_DEPOSIT', next: 'post_shift' },
    post_shift:     { type: 'random', options: ['go_home_ps', 'home_life_ps'] },
    go_home_ps:     { type: 'action', action_type: 'GO_HOME', next: 'check_work' },
    home_life_ps:   { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
    off_home_check: { type: 'condition', condition_type: 'AT_HOME', yes: 'home_idle', no: 'off_random' },
    off_random:     { type: 'random', options: ['go_home_off', 'have_life'] },
    go_home_off:    { type: 'action', action_type: 'GO_HOME', next: 'check_work' },
    home_idle:      { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
    have_life:      { type: 'action', action_type: 'HAVE_LIFE', next: 'check_work' },
  },
});

export const SHOP_HOURS = Object.freeze({
  mon: [{ from: 9, to: 18 }], tue: [{ from: 9, to: 18 }], wed: [{ from: 9, to: 18 }],
  thu: [{ from: 9, to: 18 }], fri: [{ from: 9, to: 18 }], sat: [{ from: 10, to: 16 }], sun: [],
});

// A connection id has to be stable across re-runs or every run mints a new file and
// leaves the old one behind as an orphan the agreement gate then trips on. It is
// derived from the pair, never rolled.
const connId = (a, dir) => `conn_hf_${a.replace(/^zone_/, '')}_${dir}`;

const conn = (store, a, b, dir, lockable = false) => store.patch('connections', connId(a, dir), {
  a, b, dir, id: connId(a, dir), blocked: false, lockable, one_way: false,
});

/**
 * Author one building. Returns the ids it wrote.
 *
 * spec = {
 *   slug, name, type, x, y, entrance, floors, marker, district,
 *   facade:   { description, bgColor?, color? },
 *   rooms:    [{ key, name, description, floor, window?, from?, dir? }]   // rooms[0] is the entry
 *   lights:   { <roomKey>: { name, description, lumens, type? } }
 *   props:    [{ key, room, name, description, objectType, flags?, powerKw? }]
 *   items:    [{ id, name, description, value, ... }]
 *   npc:      { id, name, sex, description, homeRoom, workRoom, shopName, inventory, chitchat, dialogue }
 * }
 */
export async function authorBuilding(store, spec) {
  const facadeId = `zone_district_${spec.x}_${spec.y}`;
  const mapId = `map_int_${spec.slug}`;
  const streetId = streetFor(store, spec);
  const roomId = (key) => `zone_${spec.slug}_${key}`;
  const entry = spec.rooms[0];

  // ── the facade ────────────────────────────────────────────────────────────
  // ⚠ `terrain` is DELETED: a building footprint is not ground, and painted ground
  // suppresses the tile's map code, which would drop it off the map and the tablet.
  const prev = store.get('zones', facadeId) || {};
  const flags = { ...(prev.flags || {}) };
  delete flags.terrain;
  delete flags.scavenging_table_id;
  delete flags.street_life;
  store.patch('zones', facadeId, {
    name: spec.name,
    description: spec.facade.description,
    ambient_theme: 'urban',
    ...(spec.facade.bgColor ? { bg_color: spec.facade.bgColor } : {}),
    ...(spec.facade.color ? { color: spec.facade.color } : {}),
    marker: spec.marker,
    map_id: 'map_world',
    parent_zone: null,
    exits: { [spec.entrance]: streetId, [OPPOSITE[spec.entrance]]: roomId(entry.key) },
    flags: {
      ...flags,
      building_name: spec.name,
      building_type: spec.type,
      district: spec.district,
      entrance: spec.entrance,
      facade: true,
      floors: spec.floors,
      is_building: true,
      region_id: 'region_coldwater',
      world_exit_zone: streetId,          // ← the STREET
    },
  });
  conn(store, facadeId, streetId, spec.entrance);
  conn(store, facadeId, roomId(entry.key), OPPOSITE[spec.entrance], true);

  // ── the door, from the street side, and ONLY from there ───────────────────
  // ⚠ Turning a tile into a facade does not unlink its neighbours. Every one of them
  // still holds an exit pointing at it, and a facade auto-forwards whoever steps on
  // it into the interior — so each of those is a second door the author never chose,
  // entered through a back wall. That is the audit's BLD-1, and stripping them at the
  // source is the half that cannot be done from the facade's own file.
  for (const z of store.all('zones')) {
    if (z.id === facadeId) continue;
    // This building's own rooms point back at the facade on purpose: that link IS the
    // way out. Only OUTSIDE tiles can hold a second door. (Matters on a re-run.)
    if (z.parent_zone === facadeId || z.map_id === mapId) continue;
    const links = Object.entries(z.exits || {}).filter(([, t]) => t === facadeId);
    if (!links.length) continue;
    const exits = { ...z.exits };
    if (z.id === streetId) {
      const want = OPPOSITE[spec.entrance];          // the street's link back at the door
      for (const [dir] of links) if (dir !== want) delete exits[dir];
      exits[want] = facadeId;
    } else {
      for (const [dir] of links) delete exits[dir];
    }
    store.patch('zones', z.id, { exits });
  }

  // ── the interior map ──────────────────────────────────────────────────────
  store.patch('maps', mapId, {
    id: mapId, name: spec.name,
    parent_zone_id: facadeId,
    entry_zone_id: roomId(entry.key),
  });

  // ── the rooms ─────────────────────────────────────────────────────────────
  for (const r of spec.rooms) {
    const id = roomId(r.key);
    const exits = {};
    if (r === entry) exits[spec.entrance] = facadeId;   // ← the way out faces the entrance side
    else { exits[OPPOSITE[r.dir]] = roomId(r.from); conn(store, roomId(r.from), id, r.dir); }
    store.patch('zones', id, {
      id, name: `${spec.name} — ${r.name}`,
      description: r.description,
      ambient_theme: 'indoors',
      map_id: mapId, parent_zone: facadeId,
      grid_x: 0, grid_y: 0, grid_z: 0,
      exits: { ...(store.get('zones', id)?.exits || {}), ...exits },
      flags: {
        building_name: spec.name, building_type: spec.type,
        floor: r.floor, is_building: true, is_interior: true,
        ...(r.window ? { window: r.window } : {}),
        world_exit_zone: facadeId,        // ← the FACADE
      },
    });
    // The room's exit back toward the entry, for every room past the first.
    if (r !== entry) {
      const src = store.get('zones', roomId(r.from));
      store.patch('zones', roomId(r.from), { exits: { ...src.exits, [r.dir]: id } });
    }
  }

  // ── power, light and the utility room ─────────────────────────────────────
  // Runs AFTER the rooms exist, because `buildingNetwork` walks the exits to decide
  // which zones the junction box feeds.
  //
  // ⚠ `authorUtilityRoom` TAKES ITS ANCHOR'S `down` SLOT, and a zone has exactly one
  // exit per direction — so an authored room that is also `down` from the anchor is a
  // double claim, and because the utility room is written LAST it wins silently. What
  // you get is an authored room with a one-way exit back up into a tile that no longer
  // points at it, which `content:lint` catches only as "zone_edges would lose an exit"
  // and does not name as a collision. Ash Management hit this: a furnace floor under a
  // tipping hall is `down`, and so is an ash pit. The fix is to anchor the utility room
  // further in (the pit belongs under the FURNACE, not under the hall), so `utilityAnchor`
  // names a room and the guard below refuses the collision rather than letting it resolve.
  const anchorKey = spec.utilityAnchor || entry.key;
  for (const r of spec.rooms) {
    if (r !== entry && r.from === anchorKey && r.dir === 'down') {
      throw new Error(`${spec.name}: room "${r.key}" is down from "${anchorKey}", which is where the utility room goes — set utilityAnchor to a deeper room`);
    }
  }
  const util = await authorUtilityRoom(store.sql(), { anchorId: roomId(anchorKey) });
  conn(store, roomId(anchorKey), util.utilityRoomId, 'down');
  if (spec.utility) {
    store.patch('zones', util.utilityRoomId, {
      name: `${spec.name} — ${spec.utility.name}`,
      description: spec.utility.description,
      flags: { ...(store.get('zones', util.utilityRoomId).flags || {}), floor: spec.utility.floor || 'stone' },
    });
  }

  // A light per room past the anchor (authorUtilityRoom only lights the anchor and
  // the utility room). A room with no fixture is not dark, it reads as open air.
  for (const [key, l] of Object.entries(spec.lights || {})) {
    const zid = roomId(key);
    store.patch('furniture', `furn_light_${zid}`, {
      id: `furn_light_${zid}`, zone_id: zid, name: l.name, description: l.description,
      object_type: 'light', light_type: l.type || 'overhead',
      light_on: 1, light_on_intended: 1, power_draw_kw: 0.02, lumen_output: l.lumens, flags: {},
    });
  }

  // ── props ─────────────────────────────────────────────────────────────────
  for (const p of spec.props || []) {
    const id = `furn_${spec.slug}_${p.key}`;
    store.patch('furniture', id, {
      id, zone_id: roomId(p.room), name: p.name, description: p.description,
      object_type: p.objectType, flags: p.flags || {},
      ...(p.powerKw ? { power_draw_kw: p.powerKw } : {}),
      ...(p.lightType ? { light_type: p.lightType } : {}),
    });
  }

  // ── items ─────────────────────────────────────────────────────────────────
  for (const it of spec.items || []) store.patch('items', it.id, it);

  // ── the keeper ────────────────────────────────────────────────────────────
  if (spec.npc) {
    const n = spec.npc;
    store.patch('npcs', n.id, {
      id: n.id, name: n.name, sex: n.sex, description: n.description,
      npc_type: 'vendor', faction: null, hp: n.hp || 40, hp_max: n.hp || 40,
      home_zone: roomId(n.homeRoom), work_zone_id: roomId(n.workRoom),
      behaviour_graph: VENDOR_GRAPH,
      dialogue_tree: n.dialogue,
      chitchat: n.chitchat, banter: [], home_activities: [],
      flags: { clothing_layers: n.clothing },
      vendor_shop_name: n.shopName,
      vendor_inventory: n.inventory,
      vendor_schedule: n.schedule || SHOP_HOURS,
      vendor_restock_rate: 3, vendor_stock_size: 10,
      studio_zone_id: null, wander_zones: [], wanders: 0,
    });
  }

  return { facadeId, mapId, utilityRoomId: util.utilityRoomId };
}

// The street the entrance faces. Derived rather than authored, so a spec cannot name
// a tile the door does not actually open onto.
function streetFor(store, spec) {
  const d = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[spec.entrance];
  const id = `zone_district_${spec.x + d[0]}_${spec.y + d[1]}`;
  const z = store.get('zones', id);
  if (!z) throw new Error(`${spec.name}: no tile ${spec.entrance} of ${spec.x},${spec.y}`);
  if (z.flags?.terrain !== 'road') throw new Error(`${spec.name}: ${spec.entrance} neighbour ${id} is "${z.name}" (terrain ${z.flags?.terrain}), not a road`);
  return id;
}

export { loadContentStore };
