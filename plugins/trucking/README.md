# trucking

**Purpose** — THE LONG HAUL: the crossing between regions, driven from a cab rather than walked.
The full as-built account is [docs/systems-trucking.md](../../docs/systems-trucking.md) and the
design record is [proposals/the-long-haul.md](../../docs/proposals/the-long-haul.md); this file is
the signpost and the seams worth knowing before you edit the folder.

## The three rules the plugin is shaped by

Each is a decision **not** to build something.

**The corridor synthesises ZONES, never render cells.** `corridorAt` returns the shape `surfaceAt`
returns and hands it to the flight plugin's `mapWindow` through its cell-provider parameter, so road
auto-tiling, biome, buildings and fog all come from the one derivation that already exists. The
alternative — a second renderer path for the highway — is the thing that drifted twice before
(`snapshot.js` kept its own copy and silently lost 144 street tiles, then park features).

**The drive IS the crossing.** `current_zone` stays the void room and a node boundary emits
`zone.entered`, so voidwalking's encounters, traces, hard nodes and teardown all fire here and are
implemented nowhere here. A breakdown finishes on foot for free.

**The edge of the road is a law, not a wall.** There is no ground collision at all: the verge is
slow, and past the half-width you are bogged rather than blocked.

## What it fires for other plugins

Three of its four manifest hooks are **subscriptions**; `vehicle.contacts`, `hijack.target` and
`fuel.prices` are hooks *other* plugins fire, which trucking answers so that a rig shows up on a
pilot's scope, can be hijacked, and can read a forecourt's prices. See the "Hooks plugins fire"
table in [server.md](../../docs/server.md). ⚠ `fuel.prices` is gathered **synchronously** from the
flight window — a contributor may not `await` and may not `query()`.

## Traps

⚠ **The minimum turn radius is a correctness invariant.** Cells are classified by distance from the
centreline out to `OFFROAD_R`, so a bend tighter than that folds the verge band through itself and
the odometer jumps backwards through the fold.

⚠ **The client reports where it IS, not how far it has come.** The server derives the odometer from
position against its own geometry, because a self-reported distance lets a client weave and get paid
for the tarmac.

⚠ **Surface tuning has an invariant**: `thrustMax × drive > rollFric × drag`, or the verge stops
being a penalty and becomes a wall wearing one's clothes.

⚠ **The road icon is authored as the nearest axis, never as a bend piece.** The auto-tiler ORs
adjacent road cells, so an unauthored corridor paints a crossroads for the entire length of the
highway. The real direction ships as `road_deg` / `road_t` / `road_w`.
