# column

The Wildblood column: three rigs that drive a loop of the Scarletwastes on a timetable. The design
and what's still to come are in [docs/proposals/wildblood-column.md](../../docs/proposals/wildblood-column.md).

## What it does

- **Where the rigs are** comes from the clock (`columnAt` in `route.js`), the way a flock does. The
  Howl leads, the Slake cart rides in the middle and the hound-runner comes last, 1.3 tiles apart. The
  loop is about 126 tiles and 19 minutes:
  1. out of the Deadleg yard (6 minutes standing);
  2. south over the scrub to the Slake's north shore (4 minutes, the cart fills);
  3. back up to the row-957 highway and east to the 1053 road, then south to row 967;
  4. west to the North Gate apron (3 minutes; the gate stays shut);
  5. back the same way.
- **Seats see and hear them** through the `vehicle.contacts` hook, as class `column` with a
  `variant` of `howl`, `cart` or `runner`. The meshes are `content/vehicle_models/mesh_column*.json`
  and the engine voice is `rotgas` in `client/game/js/panels/seat-audio.js`.
- **People on foot** get one line when a rig drives onto their tile, a quieter one from the tile
  next door, and a line when the column stands at a stop. A `2s` tick through
  `scheduler.js`, which only fires while somebody is online, reads only the world Maps.

It's look only. There's no raid, no shadowing and nothing to fight.

## Hooks

| Hook | What it answers |
|---|---|
| `vehicle.contacts` | the rigs within range of a point, shaped like the podracer's contacts |

## Commands

None.

## Rules

- Nothing is stored and nothing is queried. A restart loses nothing.
- Every leg keeps off cliff, water and any `building_type` tile (the thorn wall is one). The regress
  walks the loop against the zones. The 1053 road between rows 968 and 984 is inside the wall, so
  the water leg goes round by the west.
- The rigs keep to the right of travel, so on the out-and-back legs they pass each other rather than
  drive through each other.
- No words on the rigs, no em dashes in the lines, and nobody in the column explains it.

## Files

- `route.js`: the waypoints, the stops, the speed and `columnAt`.
- `index.js`: the contact feed and the passing lines.
- `regress.js`: the route against the ground, the clock, the feed and the text rung.
- The meshes are written by `scripts/shapes/concepts/wildblood-column.mjs`.
