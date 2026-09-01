// The ledger's CELL — a square of grid coordinates, derived, never authored.
//
// The sim needs a unit between tile and region. A tile is too fine (a player
// crosses about twenty in a session, so per-tile heat is noise nobody can read)
// and a region is too coarse (Coldwater is ONE region, so a region-level ledger
// is a single global number, which is weather rather than faction conflict).
//
// The first draft used `flags.district`, and that made the whole system wait on
// content that does not exist — twelve of the twenty authored districts hold zero
// tiles and the built city falls through to the `residential` fallback. See
// docs/proposals/district-repair.md, which is that job, standing on its own.
//
// ⚠ Nothing downstream knows what a cell IS. It is a key from blockKeyOf() and a
// label from blockLabel(). If the districts are ever painted, this file swaps its
// key function for districtFor() and no scalar, incident or regress case changes.
import { world } from '../../server/engine/world.js';

// 12 lands closest to the ~10 cells the district painting would have produced
// while keeping a block walkable end to end in well under a minute. 8 gives 17,
// 16 gives 7 — both defensible, neither better.
export const BLOCK = 12;

// The region the sim runs in. ⚠ Gate on the URBAN filter below and not on this
// alone: region_coldwater is 4,838 tiles of which 2,865 are redrock waste, so a
// region-wide index spends the sim's heat on empty ground.
const REGION = 'region_coldwater';

const URBAN_TERRAIN = new Set(['road', 'asphalt', 'concrete', 'park', 'dirt_road']);

const isUrban = (z) => {
  const f = z?.flags || {};
  return URBAN_TERRAIN.has(f.terrain) || !!f.is_building || !!f.building_name;
};

// ⚠ grid 0,0 is an UNSET COLUMN, never a tile. Interior zones carry it, so a
// coordinate read that trusts it puts every interior in the game into one corner
// of the map. An interior resolves its position by following world_exit_zone out
// to its facade instead; a facade that has itself gone missing yields no cell at
// all, which is correct — a room we cannot place is a room the sim must not touch.
const hasRealCoords = (z) =>
  Number.isFinite(z?.grid_x) && Number.isFinite(z?.grid_y) && !(z.grid_x === 0 && z.grid_y === 0);

function anchorFor(zone) {
  if (hasRealCoords(zone)) return zone;
  const exitId = zone?.flags?.world_exit_zone || zone?.world_exit_zone;
  const facade = exitId ? world.zones.get(exitId) : null;
  return hasRealCoords(facade) ? facade : null;
}

export const blockKeyOf = (x, y) => `${Math.floor(x / BLOCK)},${Math.floor(y / BLOCK)}`;

// Built once and memoised rather than at import. Boot does initWorld() before
// loadPlugins() so a top-level build would work today, but a dev-panel world
// reload replaces zones under us and the regress harness imports modules in its
// own order — lazy costs one branch per read and survives both.
let _index = null;

function build() {
  const zoneToBlock = new Map();
  const cells = new Map(); // key -> { key, zones: [id], cx, cy }

  for (const zone of world.zones.values()) {
    // A void-crossing room is synthetic and off-map; it must never take a cell.
    if (world.transientZones.has(zone.id)) continue;

    const anchor = anchorFor(zone);
    if (!anchor) continue;
    if ((anchor.flags?.region_id || zone.flags?.region_id) !== REGION) continue;
    if (!isUrban(anchor)) continue;

    const key = blockKeyOf(anchor.grid_x, anchor.grid_y);
    zoneToBlock.set(zone.id, key);
    if (!cells.has(key)) {
      const [bx, by] = key.split(',').map(Number);
      cells.set(key, { key, zones: [], cx: bx * BLOCK + BLOCK / 2, cy: by * BLOCK + BLOCK / 2 });
    }
    cells.get(key).zones.push(zone.id);
  }

  return { zoneToBlock, cells };
}

function index() {
  if (!_index) _index = build();
  return _index;
}

/** Drop the memo — the dev panel calls this after a world reload. */
export function reindex() {
  _index = null;
  return index();
}

/** The cell a zone sits in, or null for anything the sim does not cover. */
export function blockOf(zoneId) {
  return index().zoneToBlock.get(zoneId) ?? null;
}

/** Every cell key the sim knows about. */
export function allBlocks() {
  return [...index().cells.keys()];
}

export function blockInfo(key) {
  return index().cells.get(key) ?? null;
}

/**
 * The eight neighbouring cells that actually exist. Displacement reads this —
 * with derived blocks there is a real adjacency for free, which is what let the
 * first draft's authored per-order district list collapse to one compass bearing.
 */
export function neighboursOf(key) {
  const [bx, by] = key.split(',').map(Number);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const k = `${bx + dx},${by + dy}`;
      if (index().cells.has(k)) out.push(k);
    }
  }
  return out;
}
