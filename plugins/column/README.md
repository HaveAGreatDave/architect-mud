# column

The Wildblood column: three rigs that drive a loop of the Scarletwastes on a timetable, with
Bracken's hounds running in front. The design and what's still to come are in
[docs/proposals/wildblood-column.md](../../docs/proposals/wildblood-column.md).

## What it does

- **Where the rigs are** comes from the clock (`columnAt` in `client/shared/column-route.js`), the
  way a flock does. The Howl leads, the Slake cart rides in the middle and the hound-runner comes
  last, 1.3 tiles apart. The loop is about 126 tiles and 19 minutes:
  1. out of the Deadleg yard (6 minutes standing);
  2. south over the scrub to the Slake's north shore (4 minutes, the cart fills);
  3. back up to the row-957 highway and east to the 1053 road, then south to row 967;
  4. west to the North Gate apron (3 minutes; the gate stays shut);
  5. back the same way.
- **Seats see and hear them** through the `vehicle.contacts` hook, as class `column` with a
  `variant` of `howl`, `cart` or `runner`. The meshes are `content/vehicle_models/mesh_column*.json`
  and the engine voice is `rotgas` in `client/game/js/panels/seat-audio.js`. Each contact carries
  `clock`, the server instant it was worked out at.
- **The hounds** aren't contacts and this plugin doesn't publish them. The renderer works them out
  for itself from the same clock (`houndsAt` in `column-route.js`) and draws them as the
  `quadruped`/`hound` fauna row, using a column contact's `clock` to take out its own clock's skew.
  Four to six of them (six, off `HOUND_SEED`) run 0.8 to 1.5 tiles ahead of the Howl along the loop, and lie down in front of it at
  the stops. The cage on the hound-runner stays empty.
- **People on foot** get one line when a rig drives onto their tile, a quieter one from the tile
  next door, and a line when the column stands at a stop. A `2s` tick through
  `scheduler.js`, which only fires while somebody is online, reads only the world Maps.

It's look only. There's no raid, no shadowing, no bark and nothing to fight.

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
  drive through each other. The hounds keep to the same lane, a little either side of the rigs' line.
- An animal isn't a vehicle, so the hounds never go into `vehicle.contacts`.
- No words on the rigs, no em dashes in the lines, and nobody in the column explains it.

## Files

- `client/shared/column-route.js`: the waypoints, the stops, the speed, `columnAt` and `houndsAt`.
  It's in `client/shared/` because the renderer reads it too.
- `index.js`: the contact feed and the passing lines.
- `regress.js`: the route against the ground, the clock, the pack, the feed and the text rung.
- The meshes are written by `scripts/shapes/concepts/wildblood-column.mjs`. The hound's row is
  `content/fauna_models/quadruped_hound.json`, built by `buildHound` in `client/game/js/panels/fauna3d.js`.
