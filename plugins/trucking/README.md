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

## Inside the cab (`rig cab`)

[fittings.js](fittings.js) dresses the OUTSIDE of a truck and everything on that shelf is for other
people. [client/shared/cab-trinkets.js](../../client/shared/cab-trinkets.js) is the other half — the
dice on the header, the nodding head on the dash, the skull where the horn button is — and nobody
but the driver ever sees any of it. Fifteen rows across three places, `rig cab` at any depot bench,
stored as a list of ids on `trucks.custom_data.cab`, one per place, owned once and free to swap.

⚠ **Nothing interior reaches the wire, and that is why it's a SECOND catalogue rather than three
more slots on `FITTINGS`.** A fitting rides the mesh variant as `^ab.cd` because every pilot within
`CONTACT_RANGE` has to draw your bull bar four times a second. One merged catalogue would mean
`fitSuffix` filtering interior codes out of that string — right until somebody adds a place and
forgets, at which point a pair of fuzzy dice is being broadcast to every aircraft in the basin,
permanently, with nothing anywhere to say so. Two catalogues make it unwriteable: `fitSuffix` reads
`fits`, this reads `cab`, and neither can see the other. `plugins/trucking/regress.js` §4c fails on
it directly.

⚠ **The swing is driven by the truck's own acceleration, and the cab is the only place that can
derive it.** `v.gee` is two numbers in g — `lat` from `speed × yawRate` (which is exact, so no
frame-to-frame differencing) and `lon` from `d(speed)/dt`, one-poled at about a tenth of a second
because the gearbox steps `speed` and the raw difference spikes to several g on every shift. Signed
speed, not its magnitude: `yawRate` already carries the direction of travel.

⚠ **Two mounts, one integrator, and it lives in the shared file because the renderer can't be
tested.** A pendant settles along apparent gravity and holds the bend; a head on a stiff spring
leans a fraction of that and rings. Both deflect AGAINST the acceleration — inertia doesn't care
which side of the pivot the mass is. Integrated semi-implicitly, or a dropped frame winds the
oscillator up and a bobblehead tuned at 60fps spins on a slow machine.

⚠ **`data-motion=off` stops the swing and keeps the object.** Deleting a trinket somebody bought
would be an accessibility setting taking away a purchase.

⚠ **The cab interior had never run headlessly before this.** `paintCabDash` opens with
`dashCanvas(id)` — `getElementById(id + '-dash')` — and returns on that line when it finds nothing.
Every cab view in `viewRenderSmoke` registers the WORLD canvas and not that one, so thirteen hundred
lines of dials, wheel and mirrors were reachable only from a browser.
[scripts/shapes/cabtrinkets.mjs](../../scripts/shapes/cabtrinkets.mjs) registers both and is the
gate: every row must put ink on the canvas, no two rows in a place may draw the same shape, and the
wheel must be dressed on BOTH wheel renderers (`RENDER_TUNE.cabWheel3d` picks between them, so a
dressing wired into one is a wheel that vanishes when a flag flips).

⚠ **The wheel is real geometry, and so is everything standing on it.** `cabWheelFaces` builds the
rim, the eight spear spokes and the boss drum as faces that project and shade per face and turn with
the steering; `cabPadFaces` builds the maker's plaque and the skull the same way, extruded from the
silhouette the 2-D drawer replays (`SKULL_UPPER` / `SKULL_LOWER` — one definition, read by the path
and by the extrusion, or the painted face does not sit inside its own walls). What is still PAINT is
the detail on the front faces: the wordmark, and the skull's sockets, brow and teeth. That is the
right split — a skull's relief is a couple of hundred faces on a concave object, and the painter
sorts by face centre, which a torus forgives and a concave casting does not.

⚠ **The pad furniture is its own mesh in its own pass, and does NOT turn.** A boss is bolted to the
column, so it is built with the wheel's rake and no steer — `drawMakeBadge`'s own note already said
why (a maker's mark upside down at full lock). Keeping it out of the wheel's face array is the sort
argument above: it stands clear in front of the pad and nothing on the wheel can interleave with it,
so sorting the two together could only lose. `PAD_LIFT` is how far it stands proud, spent by both
prisms AND by the paint mapping — three readers, one number, or the wordmark is scaled for a plane
it is not on.

⚠ **`RENDER_TUNE.cabWheel3d = 0` keeps the painted boss** (`drawCabWheelBoss`), which is not dead
code: that renderer has no geometry to extrude into.

[tools/modelshop/cabtrinkets.html](../../tools/modelshop/cabtrinkets.html) (`npm run modelshop`,
then `/cabtrinkets.html`) is the surface for looking at it; the gate above is what checks it.

## ⚠ An ion storm can take the dash, and never the driveline

An EMP pulse that lands within twelve tiles of the rig cooks the nav head and the CB for the
duration of the blackout. **The engine, the gearbox and the brakes are untouched** — a diesel is
compression and fuel, and a pulse that stopped the drive would strand somebody four hundred miles
into the void with no recourse. What goes is everything that was *listening to something*: the GPS
tablet's three apps and its face on the dash (`elecOut` on the cab payload), the `route` verb, the
CB in both directions, and the ambient CB chatter **including the wreck-ahead warning**, which is
the only line on that channel that is information rather than flavour.

Three rules worth knowing before you touch it. **The clock is the RIG's, not the driver's** —
`rig.empUntil`, RAM-only, so climbing out and back in does not reboot it and a passenger who takes
the wheel inherits a dead dash. **`dead` is carried beside `on`, never folded into it**: `on` is
the squelch, a knob somebody turned, and a set reported as switched-off invites a driver to press
a button that does nothing for six minutes. And **the payload sends no rows rather than rows the
panel is trusted to ignore** — a payload something else will read is a payload something else will
read. The law and the geometry are the engine's (`empReaches`); this plugin answers
`vehicle.crewed` with its rigs and a `knockOut` each. See
[systems-weather-extreme.md](../../docs/systems-weather-extreme.md).
