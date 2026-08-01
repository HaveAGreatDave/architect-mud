// MOVING AND TURNING A BUILDING — the two structural operations, as pure planners.
//
// PURE. No fs, no DB, no clock — the same contract derive.mjs and map-anchor.mjs
// keep, and for the same reason: the Studio, `npm run test:regress` and anything
// that grows a CLI later must all be answering the same question. A planner takes
// the content tree and returns the rows it would write; the caller decides whether
// to write them.
//
// WHY A BUILDING IS NOT A TILE YOU DRAG
// ─────────────────────────────────────
// A building is one facade tile on the world map plus a whole interior MAP hanging
// off it (`maps.parent_zone_id`), and roughly a dozen other rows naming that facade
// — the front door, the utility generator, every interior tile's `parent_zone`.
// So neither operation is a coordinate edit:
//
//   MOVE  is an IDENTITY SWAP, not a coordinate swap. The destination row gains the
//         building and the old facade row becomes backfill ground; no `grid_x` ever
//         changes. That is not squeamishness about writing a number — a world-map
//         zone id ENCODES its position (`zone_district_<x>_<y>`, 58 of the 62
//         facades), and map-audit rule GEO-1 calls a coord/id disagreement "the
//         signature of a botched move", refusing to run its other fixers over the
//         tile afterwards. Swapping coordinates would brand two tiles per move.
//         Swapping ids as well would reach the identical end state on disk while
//         additionally renaming two `power_zones` files — and a power_zone is a fact
//         about the CELL (`{id, name, source_type: 'city_grid', generator_id}`), so
//         it must not follow the building anywhere.
//
//   ROTATE turns the whole building rigidly. It is tempting to treat "the door is on
//         the wrong side" as a one-field edit, but the interior's way-out faces the
//         door by convention (world.js's third facade↔interior invariant), and the
//         template rooms hold the other cardinals off the lobby — so turning only the
//         door drops the way-out on top of a room. Turning the interior grid with it
//         is collision-free by construction: the room that was north is now east.
//
// WHAT THE DOOR IS ALLOWED TO DO
// ──────────────────────────────
// `flags.entrance` is AUTHORED, and world.js:190 records what it cost to learn that:
// while the door was inferred from the road graph, painting a dirt track west of
// Pawn & Pity silently moved its door off Marrow Street. So MOVE PRESERVES THE DOOR
// and refuses a destination where that side is not a street. Rotate is the only
// thing in this file that turns one, and rotate is never a side effect.

import { CARDINAL, OPPOSITE, gridKey } from './derive.mjs';

// ── Direction algebra ────────────────────────────────────────────────────────
// One ring, eight spokes, so a quarter turn is a shift of two — cardinals and
// diagonals fall out of the same table rather than needing a second one that can
// disagree with it. 40 interior exits and 20 interior connections are diagonal.
const RING = Object.freeze(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);
const RING_AT = new Map(RING.map((d, i) => [d, i]));

/**
 * Turn a direction by `k` quarter turns, positive = clockwise on screen.
 * `up`, `down`, `in` and `out` are not on the ring and come back untouched —
 * a staircase does not care which way the building faces.
 */
export function rotateDir(dir, k) {
  const i = RING_AT.get(dir);
  if (i == null) return dir;
  return RING[(((i + 2 * k) % 8) + 8) % 8];
}

/**
 * Turn a grid point about the origin. NORTH IS y−1 (directions.js), so clockwise
 * on screen is (x, y) → (−y, x): north (0,−1) lands on east (1,0). Every interior
 * map's entry zone sits at (0,0) — all 68 of them — so the origin is the pivot
 * without anyone having to choose one.
 */
export function rotatePoint(x, y, k) {
  let [px, py] = [x, y];
  for (let i = (((k % 4) + 4) % 4); i > 0; i--) [px, py] = [-py, px];
  return [px, py];
}

/** Rotate the KEYS of an exits bag. The values are zone ids and never move. */
function rotateExitKeys(exits, k) {
  const out = {};
  for (const [dir, target] of Object.entries(exits || {})) out[rotateDir(dir, k)] = target;
  return out;
}

// ── Reading the tree ─────────────────────────────────────────────────────────
// Accepts the Studio's `{ zones: Map, … }` or plain arrays, so a test can hand it
// literals and the server can hand it what it already holds.
const rowsOf = (t) => !t ? [] : (t instanceof Map ? [...t.values()] : Array.isArray(t) ? t : Object.values(t));
const indexOf = (t) => t instanceof Map ? t : new Map(rowsOf(t).map(r => [r.id, r]));

/**
 * Every field in every table that names a zone. Used twice: to repoint the
 * building's references at its new facade, and to ask whether a destination cell
 * already has something standing on it.
 *
 * `power_zones` is deliberately ABSENT. Its id IS the zone id and its row is a
 * fact about the cell — the grid it draws from, and the tile's own name. It stays
 * where it is when a building moves over or off it.
 */
export const ZONE_REF_FIELDS = Object.freeze({
  maps: ['parent_zone_id', 'entry_zone_id'],
  doors: ['zone_id', 'target_zone'],
  furniture: ['zone_id'],
  npcs: ['zone_id', 'home_zone', 'work_zone_id', 'studio_zone_id'],
  generators: ['zone_id'],
  security_devices: ['zone_id'],
  zone_spawns: ['zone_id'],
  job_boards: ['zone_id'],
  media_cameras: ['zone_id'],
  media_channels: ['studio_zone_id'],
  npc_residences: ['zone_id'],
  aa_sites: ['zone_id'],
  windows: ['zone_interior', 'zone_exterior'],
});

/**
 * The subset that means SOMETHING IS STANDING HERE, as opposed to something
 * elsewhere naming this tile. The distinction is the whole of whether a move is
 * refused: a streetlight on the cell would be sealed inside a facade nobody can
 * enter, but a door whose `target_zone` is the cell keeps working — it now opens
 * onto a building, which is a thing doors do.
 *
 * Without the split this refused 81 destinations over `doors.target_zone` alone,
 * which is a reference and not an occupant.
 */
const OCCUPANT_FIELDS = Object.freeze({
  doors: ['zone_id'],
  furniture: ['zone_id'],
  npcs: ['zone_id', 'home_zone'],
  generators: ['zone_id'],
  security_devices: ['zone_id'],
  zone_spawns: ['zone_id'],
  job_boards: ['zone_id'],
  media_cameras: ['zone_id'],
  npc_residences: ['zone_id'],
  aa_sites: ['zone_id'],
  windows: ['zone_interior', 'zone_exterior'],
});

// Zone-flag keys whose value is a zone id. `world_exit_zone` is handled separately
// because on a facade it means the street and on an interior tile it means the
// facade — two different facts sharing one key (see map-anchor.mjs).
const ZONE_ID_FLAGS = ['hangar_ramp', 'hangar_interior_zone', 'gps_suggest'];

/** A tile nothing can be built on top of, and nothing can be walked through. */
export const isBuildingish = (z) => !!z && !!(
  z.flags?.facade || z.flags?.is_building || z.flags?.is_interior
  || z.flags?.is_apartment || z.flags?.building_type
);
export const terrainOf = (z) => z?.flags?.terrain || (z?.flags?.water ? 'water' : null);
/** Plain ground: somewhere a player stands and a door can open onto. */
export const isStreet = (z) => !!z && z.grid_x != null && !isBuildingish(z) && terrainOf(z) !== 'water';

function cellIndex(zones) {
  const m = new Map();
  for (const z of zones) {
    if (z.grid_x == null || z.grid_y == null) continue;
    const k = gridKey(z.map_id, z.grid_x, z.grid_y, z.grid_z);
    if (!m.has(k)) m.set(k, z);   // 6 cells legitimately hold more than one; first wins, as derive does
  }
  return m;
}

/**
 * The building a facade names: its interior map and every tile on it.
 * `error` is set rather than thrown so a caller can render it beside the tile.
 */
export function buildingOf(tree, facadeId) {
  const zones = rowsOf(tree.zones);
  const facade = indexOf(tree.zones).get(facadeId);
  if (!facade) return { error: `no zone "${facadeId}"` };
  if (!facade.flags?.facade) return { error: `${facade.name || facadeId} is not a building facade (no flags.facade)` };
  // The yacht sails, and plugins/yacht/index.js writes her flags.entrance as she
  // docks. An authored turn would be overwritten by the next docking.
  if (facade.flags?.yacht) return { error: `${facade.name || facadeId} is a vessel — the yacht plugin owns her entrance` };

  // THE DUP-MAP GUARD, at the front. getMapByParentZone is a linear scan returning
  // the FIRST match, so a second map parented on one facade is invisible at runtime
  // — it hid the Ration Nine diner/grocery bug for months. regress hard-fails on it,
  // so a planner that quietly picked one would be authoring a broken tree.
  const maps = rowsOf(tree.maps).filter(m => m.parent_zone_id === facadeId);
  if (maps.length > 1) return { error: `${facade.name || facadeId} has ${maps.length} interior maps (${maps.map(m => m.id).join(', ')}) — only one is reachable; fix that first` };
  const map = maps[0] || null;
  const interior = map ? zones.filter(z => z.map_id === map.id) : [];
  const ids = new Set([facadeId, ...interior.map(z => z.id)]);
  return { facade, map, interior, ids };
}

// ── Rotate ───────────────────────────────────────────────────────────────────

const DIRECTION_WORDS = /\b(north|south|east|west|northern|southern|eastern|western|northeast|northwest|southeast|southwest|left of the door|right of the door)\b/i;

/**
 * Turn one building by `k` quarter turns.
 *
 * The facade's street exit is RETARGETED rather than rotated — it names a
 * neighbour, and the neighbour to the east is not the neighbour to the north.
 * Everything else genuinely turns: the interior grid about (0,0), every exit key,
 * every connection direction whose `a` end is inside the building, every door's
 * `exit_dir` and every camera's `direction`.
 *
 * @returns {{errors: string[], warnings: string[], writes: Array<{table,id,row}>, label: string}}
 */
export function planRotate(tree, facadeId, k = 1) {
  const errors = [], warnings = [], writes = [];
  const b = buildingOf(tree, facadeId);
  if (b.error) return { errors: [b.error], warnings, writes, label: 'Rotate' };
  const { facade, map, interior, ids } = b;
  if (!map) return { errors: [`${facade.name || facadeId} has no interior map to turn`], warnings, writes, label: 'Rotate' };

  const zones = rowsOf(tree.zones);
  const byId = indexOf(tree.zones);
  const at = cellIndex(zones);

  // A SECOND SEAM TURNS WITH NOTHING ON THE OTHER END. Halloran's interior has a
  // back way out to zone_under_terminus; rotating this building would swing that
  // door while the tile it opens onto stayed still. Computed, not listed, so a
  // second one authored tomorrow is caught the same way.
  const away = new Set();
  for (const z of interior) {
    for (const target of Object.values(z.exits || {})) {
      const t = byId.get(target);
      if (t && t.map_id && t.map_id !== map.id && t.id !== facadeId) away.add(t.id);
    }
  }
  if (away.size) {
    errors.push(`${facade.name || facadeId}'s interior also opens onto ${[...away].join(', ')} — turning it would swing a door whose far side does not turn`);
    return { errors, warnings, writes, label: 'Rotate' };
  }

  const from = facade.flags.entrance;
  const to = rotateDir(from, k);
  if (!CARDINAL[to]) {
    errors.push(`entrance "${from}" is not a cardinal direction — nothing to turn`);
    return { errors, warnings, writes, from, to, label: 'Rotate' };
  }
  const [dx, dy] = CARDINAL[to];
  const street = at.get(gridKey(facade.map_id, facade.grid_x + dx, facade.grid_y + dy, facade.grid_z));
  if (!isStreet(street)) {
    const open = Object.entries(CARDINAL)
      .filter(([, [ox, oy]]) => isStreet(at.get(gridKey(facade.map_id, facade.grid_x + ox, facade.grid_y + oy, facade.grid_z))))
      .map(([d]) => d);
    errors.push(`nothing to open onto ${to} of ${facade.name || facadeId}${street ? ` — ${street.name || street.id} is not a street` : ''}. Sides that would work: ${open.join(', ') || 'none'}`);
    return { errors, warnings, writes, from, to, label: 'Rotate' };
  }

  // ── the facade ─────────────────────────────────────────────────────────────
  // Its exits are sorted by what they NAME, not by their key: a link into this
  // building's own interior turns with the building, and the one link to the world
  // is re-aimed at the tile the door now faces.
  const oldStreetIds = new Set();
  const exits = {};
  for (const [dir, target] of Object.entries(facade.exits || {})) {
    if (ids.has(target)) { exits[rotateDir(dir, k)] = target; continue; }
    const t = byId.get(target);
    if (t && t.map_id === facade.map_id) { oldStreetIds.add(target); continue; }  // re-aimed below
    exits[rotateDir(dir, k)] = target;   // something else entirely; turn it and say so
    if (t) warnings.push(`${facade.name || facadeId} also leads to ${t.name || target}, which is neither its interior nor a tile on this map — its direction was turned with the building`);
  }
  exits[to] = street.id;
  writes.push({ table: 'zones', id: facade.id, row: {
    ...facade,
    exits,
    flags: { ...facade.flags, entrance: to, world_exit_zone: street.id },
  } });

  // The street it used to face keeps no link to a wall it can no longer open.
  for (const oldId of oldStreetIds) {
    const old = byId.get(oldId);
    if (!old) continue;
    const kept = Object.fromEntries(Object.entries(old.exits || {}).filter(([, t]) => t !== facade.id));
    if (Object.keys(kept).length !== Object.keys(old.exits || {}).length) {
      writes.push({ table: 'zones', id: old.id, row: { ...old, exits: kept } });
    }
  }
  // …and the one it now faces gains the reciprocal, so the door works from outside.
  if (street.exits?.[OPPOSITE[to]] !== facade.id) {
    writes.push({ table: 'zones', id: street.id, row: {
      ...street, exits: { ...(street.exits || {}), [OPPOSITE[to]]: facade.id },
    } });
  }

  // ── the interior ───────────────────────────────────────────────────────────
  for (const z of interior) {
    const [nx, ny] = rotatePoint(z.grid_x ?? 0, z.grid_y ?? 0, k);
    writes.push({ table: 'zones', id: z.id, row: {
      ...z, grid_x: nx, grid_y: ny, exits: rotateExitKeys(z.exits, k),
    } });
    if (DIRECTION_WORDS.test(`${z.name || ''} ${z.description || ''}`)) {
      warnings.push(`${z.name || z.id} names a direction in its prose — the tool turned the geometry, not the words`);
    }
  }
  if (DIRECTION_WORDS.test(`${facade.name || ''} ${facade.description || ''}`)) {
    warnings.push(`${facade.name || facade.id} names a direction in its prose — the tool turned the geometry, not the words`);
  }

  // ── directions held in other tables ────────────────────────────────────────
  // A connection's `dir` is a statement about the `a` end's edge, so it turns iff
  // that end turned. When only `b` is inside the building the far tile is standing
  // still and its edge has not moved.
  for (const c of rowsOf(tree.connections)) {
    if (!ids.has(c.a)) continue;
    const dir = rotateDir(c.dir, k);
    if (dir !== c.dir) writes.push({ table: 'connections', id: c.id, row: { ...c, dir } });
  }
  for (const d of rowsOf(tree.doors)) {
    if (!ids.has(d.zone_id)) continue;
    const exit_dir = rotateDir(d.exit_dir, k);
    if (exit_dir !== d.exit_dir) writes.push({ table: 'doors', id: d.id, row: { ...d, exit_dir } });
  }
  for (const s of rowsOf(tree.security_devices)) {
    if (!ids.has(s.zone_id)) continue;
    const direction = rotateDir(s.direction, k);
    if (direction !== s.direction) writes.push({ table: 'security_devices', id: s.id, row: { ...s, direction } });
  }

  return { errors, warnings, writes, from, to, label: `Turn ${facade.flags.building_name || facade.name || facadeId} — door ${from} → ${to}` };
}

// ── Move ─────────────────────────────────────────────────────────────────────

/**
 * What is standing on a cell. A facade is non-standable and auto-forwards into its
 * interior, so anything left on the tile a building lands on becomes unreachable
 * without a single error to say so.
 */
export function attachmentsOf(tree, zoneId) {
  const out = [];
  for (const [table, fields] of Object.entries(OCCUPANT_FIELDS)) {
    for (const r of rowsOf(tree[table])) {
      if (fields.some(f => r[f] === zoneId)) out.push(`${table}/${r.id}`);
    }
  }
  return out;
}

/**
 * The tile the vacated cell heals to look like: the commonest plain ground beside
 * it. Nothing is invented — a building in the grasslands leaves Grasslands behind
 * and one on Ironside Street leaves Ironside Street, because the row is COPIED.
 * The Studio holding a canned "Empty Lot" description would be exactly the opinion
 * about content it is built not to have (and content/map/terrain.json's `_no_default`
 * block refuses a palette-wide default for the same reason).
 */
export function backfillDonorFor(tree, zone, exceptId = null) {
  const at = cellIndex(rowsOf(tree.zones));
  const near = [];
  for (const [, [dx, dy]] of Object.entries(CARDINAL)) {
    const n = at.get(gridKey(zone.map_id, zone.grid_x + dx, zone.grid_y + dy, zone.grid_z));
    // The destination is about to stop being ground, so it cannot be what the hole
    // heals to look like — it is the building.
    if (isStreet(n) && n.id !== exceptId) near.push(n);
  }
  if (!near.length) return null;
  const tally = new Map();
  for (const n of near) tally.set(terrainOf(n), (tally.get(terrainOf(n)) || 0) + 1);
  let best = null;
  for (const n of near) {
    if (!best || tally.get(terrainOf(n)) > tally.get(terrainOf(best))) best = n;
  }
  return best;
}

/**
 * Move a building onto another cell by trading identities, not coordinates.
 *
 * @param {object} tree     the content tree
 * @param {string} facadeId the building to move
 * @param {number} toX
 * @param {number} toY
 * @param {object} [opts]   `donorId` overrides the backfill tile the hole heals from
 */
export function planMove(tree, facadeId, toX, toY, opts = {}) {
  const errors = [], warnings = [], writes = [];
  const b = buildingOf(tree, facadeId);
  if (b.error) return { errors: [b.error], warnings, writes, label: 'Move' };
  const { facade, map, interior, ids } = b;

  const zones = rowsOf(tree.zones);
  const byId = indexOf(tree.zones);
  const at = cellIndex(zones);
  const z0 = facade.grid_z ?? 0;
  const dest = at.get(gridKey(facade.map_id, toX, toY, z0));

  // ── can it land there ──────────────────────────────────────────────────────
  if (!dest) errors.push(`there is no tile at (${toX}, ${toY}) on ${facade.map_id} — the Studio moves a building onto an existing cell, it does not conjure one`);
  else if (dest.id === facade.id) errors.push('that is where it already is');
  else if (isBuildingish(dest)) {
    // REFUSED, not warned. The swap would leave two maps parented on one facade —
    // the dup-map state regress hard-fails, and the Studio's contract is that it
    // cannot author what the deploy gate rejects.
    errors.push(`${dest.name || dest.id} is already a building — two buildings cannot share a cell, and the swap would leave two interior maps on one facade`);
  }
  if (errors.length) return { errors, warnings, writes, label: 'Move' };

  const held = attachmentsOf(tree, dest.id);
  if (held.length) {
    errors.push(`${dest.name || dest.id} has ${held.length} thing(s) standing on it (${held.slice(0, 6).join(', ')}${held.length > 6 ? `, +${held.length - 6} more` : ''}) — a facade is not standable, so they would be sealed inside a building nobody can reach. Move or delete them first (the dev panel owns those tables), or pick another cell.`);
  }

  // THE DOOR DOES NOT MOVE ITSELF. Preserved, and refused when the destination has
  // no street on that side — the refusal names the sides that would work so "turn
  // it, then move it" is one deliberate extra click rather than a silent relocation.
  const ent = facade.flags.entrance;
  const off = CARDINAL[ent];
  const street = off ? at.get(gridKey(facade.map_id, toX + off[0], toY + off[1], z0)) : null;
  // Moving a building one step BACKWARDS puts its own vacated cell on the door
  // side. That cell is a facade in the tree being read and ground by the time the
  // write lands, so judging it as it stands would refuse a legal move.
  const streetIsTheHole = !!street && street.id === facade.id;
  if (!isStreet(street) && !streetIsTheHole) {
    const open = Object.entries(CARDINAL)
      .filter(([, [ox, oy]]) => isStreet(at.get(gridKey(facade.map_id, toX + ox, toY + oy, z0))))
      .map(([d]) => d);
    errors.push(`the door faces ${ent} and there is no street ${ent} of (${toX}, ${toY}). Turn the building first — sides that would work there: ${open.join(', ') || 'none'}`);
  }
  if (terrainOf(dest) === 'water') warnings.push(`${dest.name || dest.id} is water — the building would stand on it`);
  if (terrainOf(dest) === 'road') warnings.push(`${dest.name || dest.id} is a road tile — the lane is consumed and the lanes beside it re-draw`);

  // ── what the hole heals to ─────────────────────────────────────────────────
  const donor = opts.donorId ? byId.get(opts.donorId) : backfillDonorFor(tree, facade, dest.id);
  if (opts.donorId && !donor) errors.push(`no zone "${opts.donorId}" to take the backfill from`);
  else if (!donor) errors.push(`nothing beside ${facade.name || facadeId} to heal the hole from — no plain ground touches it. Pick a donor tile.`);
  else if (!isStreet(donor)) errors.push(`${donor.name || donor.id} is not plain ground — the backfill has to be something a player can stand on`);

  // ── the curtain ────────────────────────────────────────────────────────────
  // While it is a facade the cell's frontier adjacencies are excused by the facade
  // rule (derive's facadeBlocks). Turned back into ground they need an authored wall,
  // and content:lint errors on any that has none — which the Studio cannot author,
  // because it does not create files. Refuse here with the repair rather than letting
  // the save fail on a rule the message would not explain.
  if (donor) {
    const isWilds = (z) => z?.flags?.district === 'wilds';
    const spoken = new Set(rowsOf(tree.connections).map(c => [c.a, c.b].sort().join('~')));
    const opened = [];
    for (const [, [dx, dy]] of Object.entries(CARDINAL)) {
      const n = at.get(gridKey(facade.map_id, facade.grid_x + dx, facade.grid_y + dy, z0));
      if (!n) continue;
      if (isWilds(facade) === isWilds(n)) continue;
      if (spoken.has([facade.id, n.id].sort().join('~'))) continue;
      opened.push(n.name || n.id);
    }
    if (opened.length) {
      errors.push(`turning ${facade.name || facadeId} back into ground would open the city↔wilds curtain onto ${opened.join(', ')} — a player would walk into the waste without passing a gate. Run \`node scripts/content/mint-curtain-walls.mjs --write\` first`);
    }
  }

  if (errors.length) return { errors, warnings, writes, label: 'Move' };

  // ── 1. the destination row becomes the building ────────────────────────────
  // Cell-owned facts stay with the cell (district, region_id, and the tile's own
  // coordinates and id); everything that describes the BUILDING travels. The
  // destination's ground — terrain, a pinned road piece, water — is dropped by
  // construction, because the flags bag is rebuilt from the facade's rather than
  // merged onto the destination's (the strip place-building.mjs:126 performs).
  const cellFlags = {};
  for (const key of ['district', 'region_id']) {
    if (dest.flags?.[key] != null) cellFlags[key] = dest.flags[key];
  }
  const newFacade = {
    ...dest,
    name: facade.name,
    description: facade.description,
    marker: facade.marker ?? null,
    color: facade.color ?? null,
    bg_color: facade.bg_color ?? null,
    ambient_theme: facade.ambient_theme,
    ambient_events: facade.ambient_events ?? [],
    audio_theme_id: facade.audio_theme_id ?? null,
    flags: { ...facade.flags, ...cellFlags, entrance: ent, world_exit_zone: street.id },
    exits: { [ent]: street.id },
  };
  // The interior link keeps the shape all 62 shipped buildings are wired to: the
  // cardinal OPPOSITE the door, never `in` — interiorExitDirs() only draws a way-out
  // arrow for a cardinal link, so an `in` link leaves the interior with no arrow home.
  const entry = map?.entry_zone_id && byId.get(map.entry_zone_id) ? map.entry_zone_id : null;
  if (entry) newFacade.exits[OPPOSITE[ent]] = entry;
  for (const key of ['district', 'region_id']) if (cellFlags[key] == null) delete newFacade.flags[key];
  writes.push({ table: 'zones', id: dest.id, row: newFacade });

  // ── 2. the old cell becomes ground ─────────────────────────────────────────
  const groundFlags = { ...(donor.flags || {}) };
  for (const key of ['district', 'region_id']) {
    if (facade.flags?.[key] != null) groundFlags[key] = facade.flags[key]; else delete groundFlags[key];
  }
  const backfill = {
    ...facade,
    name: donor.name,
    description: donor.description,
    marker: donor.marker ?? null,
    color: donor.color ?? null,
    bg_color: donor.bg_color ?? null,
    ambient_theme: donor.ambient_theme,
    ambient_events: [],
    audio_theme_id: donor.audio_theme_id ?? null,
    flags: groundFlags,
    exits: {},
  };
  // Ground is walkable in every direction ground touches, which is the reciprocity
  // rule the terrain painter already keeps. The cell was a wall on three sides for
  // as long as a building stood on it; leaving it that way would be a hole in the
  // street nothing explains.
  const rewired = new Map();
  for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
    const n = at.get(gridKey(facade.map_id, facade.grid_x + dx, facade.grid_y + dy, z0));
    if (!isStreet(n) || n.id === dest.id) continue;
    backfill.exits[dir] = n.id;
    if (n.exits?.[OPPOSITE[dir]] !== facade.id) {
      rewired.set(n.id, { ...(rewired.get(n.id) || n), exits: { ...((rewired.get(n.id) || n).exits || {}), [OPPOSITE[dir]]: facade.id } });
    }
  }
  // When the vacated cell IS the door's street, it carries the door — and the loop
  // below cannot give it to it, because that loop deliberately skips both cells the
  // swap rewrote.
  if (streetIsTheHole) backfill.exits[OPPOSITE[ent]] = dest.id;
  writes.push({ table: 'zones', id: facade.id, row: backfill });

  // ── 3. the streets on both sides ───────────────────────────────────────────
  // The old door's street loses a link to a building that is no longer there (it
  // keeps a plain ground link instead, wired above); the new one gains the door.
  for (const z of zones) {
    if (z.map_id !== facade.map_id || z.id === facade.id || z.id === dest.id) continue;
    let exits = rewired.get(z.id)?.exits ?? z.exits;
    let changed = rewired.has(z.id);
    // Every inbound link to the destination except the door itself. A ground tile
    // arrives with reciprocal exits to all its walkable neighbours, and keeping them
    // is precisely audit BLD-1 — the building becomes a walkway you enter through
    // its back wall (place-building.mjs:172 seals the same links for the same reason).
    for (const [dir, target] of Object.entries(exits || {})) {
      if (target !== dest.id) continue;
      const wanted = z.id === street.id && dir === OPPOSITE[ent];
      if (wanted) continue;
      exits = { ...exits }; delete exits[dir]; changed = true;
    }
    if (z.id === street.id && exits?.[OPPOSITE[ent]] !== dest.id) {
      exits = { ...exits, [OPPOSITE[ent]]: dest.id }; changed = true;
    }
    if (changed) writes.push({ table: 'zones', id: z.id, row: { ...z, exits } });
  }

  // ── 4. everything that named the old facade now names the new one ──────────
  // Inside the building only, for zones: an EXTERIOR tile pointing at the old cell
  // is pointing at ground that is still there and still walkable, so it keeps its
  // link. That is the difference between "this reference is about the building" and
  // "this reference is about the cell", and it is the whole of why a move is safe
  // without renaming anything.
  const repoint = (v) => (v === facade.id ? dest.id : v);
  for (const z of interior) {
    const row = {
      ...z,
      parent_zone: repoint(z.parent_zone),
      exits: Object.fromEntries(Object.entries(z.exits || {}).map(([d, t]) => [d, repoint(t)])),
    };
    const flags = { ...(z.flags || {}) };
    if (flags.world_exit_zone === facade.id) flags.world_exit_zone = dest.id;
    for (const key of ZONE_ID_FLAGS) if (flags[key] === facade.id) flags[key] = dest.id;
    row.flags = flags;
    if (JSON.stringify(row) !== JSON.stringify(z)) writes.push({ table: 'zones', id: z.id, row });
  }
  for (const [table, fields] of Object.entries(ZONE_REF_FIELDS)) {
    for (const r of rowsOf(tree[table])) {
      if (!fields.some(f => r[f] === facade.id)) continue;
      // A connection is the building's iff its other end is inside it. Nothing on
      // the world map connects to a facade by file today (the door is derived
      // geometry), but a wall authored tomorrow must stay a fact about the cell.
      const row = { ...r };
      for (const f of fields) if (row[f] === facade.id) row[f] = dest.id;
      writes.push({ table, id: r.id, row });
    }
  }
  for (const c of rowsOf(tree.connections)) {
    if (c.a !== facade.id && c.b !== facade.id) continue;
    const other = c.a === facade.id ? c.b : c.a;
    if (!ids.has(other)) { warnings.push(`connection ${c.id} joins this cell to ${other}, which is not part of the building — it was left naming the cell`); continue; }
    writes.push({ table: 'connections', id: c.id, row: { ...c, a: repoint(c.a), b: repoint(c.b) } });
  }
  // `power_zones` IS NOT TOUCHED, and that is the decision rather than an omission.
  // Its id is the zone id and its row is a fact about the cell — which grid feeds it
  // and how much it can draw — so it belongs to the tile a building stands on rather
  // than to the building. Its `name` column mirrors the zone's, and syncing that was
  // tried: the facade cells' copies are already stale across the shipped world (The
  // Vats' still reads "Grasslands"), so every move produced a diff repairing data the
  // move had nothing to do with. Nothing player-facing reads it.

  return {
    errors, warnings, writes,
    from: [facade.grid_x, facade.grid_y, z0], to: [toX, toY, z0],
    facadeId: dest.id, donorId: donor.id, streetId: street.id,
    label: `Move ${facade.flags.building_name || facade.name || facadeId} → (${toX}, ${toY})`,
  };
}
