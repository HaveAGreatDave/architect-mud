// Authoritative map-layout validator. Exits remain the source of truth for
// traversability (adjacency never implies a connection); this checks that the
// exits a builder has drawn stay consistent with where zones sit on the grid.
//
// Three failure classes:
//   - dangling     (error)   : an exit points at a zone id that doesn't exist.
//   - geometry     (error)   : an intra-map exit in a grid direction whose
//                              target isn't the grid-adjacent zone that way.
//                              Cross-map exits are PORTALS (building entrances,
//                              stairs between maps) and are exempt.
//   - missing-reciprocal (warning): A->B exists but B->A(opposite) doesn't.
//                              One-way exits are allowed, so this only warns.
//
// The dev panel mirrors a lightweight version of these checks for live
// cell-flagging, but this is the gate every save passes through.

const DIR_OFFSET = { north:[0,-1,0], south:[0,1,0], east:[1,0,0], west:[-1,0,0], up:[0,0,1], down:[0,0,-1] };
const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up' };

// zones: array of { id, map_id, grid_x, grid_y, grid_z, exits }.
// exitsOverride: optional { zoneId: exitsObj } applied on top of each zone's
//   stored exits — lets the layout-save endpoint validate the PROPOSED state
//   before writing anything.
export function validateMapLayout(zones, exitsOverride = {}) {
  const byId = new Map();
  for (const z of zones) {
    byId.set(z.id, {
      id: z.id,
      map_id: z.map_id ?? null,
      grid_x: z.grid_x ?? null,
      grid_y: z.grid_y ?? null,
      grid_z: z.grid_z ?? 0,
      exits: exitsOverride[z.id] !== undefined ? (exitsOverride[z.id] || {}) : (z.exits || {}),
    });
  }

  const errors = [];
  const warnings = [];
  for (const z of byId.values()) {
    for (const [dir, targetId] of Object.entries(z.exits || {})) {
      const target = byId.get(targetId);
      if (!target) {
        errors.push({ zoneId: z.id, direction: dir, targetId, reason: 'dangling' });
        continue;
      }
      const off = DIR_OFFSET[dir];
      if (off) {
        const sameMap = target.map_id != null && target.map_id === z.map_id;
        const positioned = z.grid_x != null && z.grid_y != null && target.grid_x != null && target.grid_y != null;
        if (sameMap && positioned) {
          const expected = `${z.grid_x + off[0]},${z.grid_y + off[1]},${z.grid_z + off[2]}`;
          const actual = `${target.grid_x},${target.grid_y},${target.grid_z}`;
          if (expected !== actual) {
            errors.push({ zoneId: z.id, direction: dir, targetId, reason: 'geometry' });
          }
        }
        // cross-map (portal) exits are exempt from the geometry rule.
      }
      const opp = OPPOSITE[dir];
      if (opp && (target.exits || {})[opp] !== z.id) {
        warnings.push({ zoneId: z.id, direction: dir, targetId, reason: 'missing-reciprocal' });
      }
    }
  }
  return { errors, warnings };
}
