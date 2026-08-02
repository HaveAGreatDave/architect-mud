# gps

**Purpose** — navigation. Resolve a place by (partial) name through SIFT and plot a route to it, drawn on the minimap and bigmap through the existing route-trace overlay. It adds a router, not a map.

## Commands
- `gps <place>` — plot the route.
- `run` / `walk` — movement mode.

## Actions
- Registers `gps.navigate`.

## Per-hop steps (`dirs`)
A `gps_route` carries `dirs[k]` — what to do at `path[k]` to reach `path[k+1]` — because the
client's minimap node only knows the FIRST target per direction and can't walk a second
same-direction exit on its own.

Almost every entry is a compass/vertical direction. **One is not:** an elevator car wires
every floor as `up` but refuses `up`, so a car→floor hop comes down as the literal
**`floor <n>`** button press (resolved through `floorFor` in `plugins/elevator/floors.js`,
a side-effect-free module so this import doesn't drag the plugin's registrations in). The
client presses it, waits for the server's `elevator_doors`, then steps `out` — see the
elevator README. Anything reading `dirs` must not assume a direction.
