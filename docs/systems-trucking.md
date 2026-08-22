# THE LONG HAUL — driving the void

**STATUS: Built — buy a truck, keep it running, take work, haul it. Four models, contracts, a commodity market, fuel, solid buildings, an eight-speed box with a diesel voice, and the rig — trailer articulation, reverse and brake fade. The depot is now a building you walk into, with a garage floor you can click a rig on, a walkaround, a dealer's line and a maintenance bench (condition, repair, four tuning dials, kits, paint). The scale house, trailers as world objects, hitchhikers and city driving are all built too — every phase of the design has shipped, and so are the four things the build itself turned up: breakdowns with a roadside `fix`, the fork as a junction you can take (`route`), wipers, and a CB that reports real wrecks. The junction is now a fork you can SEE — the corridor synthesises the limbs you did *not* take, so the highway branches toward each region instead of ending in open waste — and the road signs its own bends in MILES. The road is laid in REAL WORLD COORDINATES, so a driver, a pilot and a walker all describe the same place with the same numbers, the world outside the windscreen is the actual world, and you can turn round and drive home. Distances are consequently the real gaps between regions and are pending a tuning pass. See [proposals](proposals/the-long-haul.md).**

Freight hauling by road. You take a load at a depot in Coldwater, drive it through the city to the
edge of the map, cross the waste on a highway that does not exist until you drive it, and back onto
a dock in The Reach to get paid. A crossing that was a hard walk becomes a job.

Cross Country Canada by way of a post-singularity waste: long empty hauls, a truck that has weight,
and a city that resolves out of the haze at the end of it.

---

## Where the code is

| Piece | File |
| --- | --- |
| Corridor geometry + cell synthesis, the sibling limbs, the signs | [plugins/trucking/corridor.js](../plugins/trucking/corridor.js) |
| **The week's whole road network, for everybody who is not driving it** | [plugins/trucking/roadnet.js](../plugins/trucking/roadnet.js) |
| The highway sign, drawn | `drawRoadSign` in [windshield.js](../client/game/js/panels/windshield.js) · `sgn` in [plugins/flight/state.js](../plugins/flight/state.js) |
| Rig state, the clamp, node crossings, the cab push | [plugins/trucking/state.js](../plugins/trucking/state.js) |
| Verbs (`drive`, `hitch`, `unhitch`, `stash`, `pickup`, `galley`, `lock`/`unlock` (routers — see the doors section), `revs`, `boot`, `cruise`, `coast`, `brake`, `jake`, `park`, `fix`, `route`, `cb`, `haul`, `market`, `yard`, `rig`, `fuel`, `truckpump`, `trucksync`, `truckevent`) | [plugins/trucking/index.js](../plugins/trucking/index.js) |
| The physics (`stepTruck`, the gearbox, the articulation angle, `SURFACES`) | [client/game/js/panels/flight-model.js](../client/game/js/panels/flight-model.js) |
| The cab (60fps loop, gauges, wheel) | [client/game/js/panels/cab-view.js](../client/game/js/panels/cab-view.js) |
| Cab interior + mirrors | `drawCabInterior` in [windshield.js](../client/game/js/panels/windshield.js) |
| Ground collision | `groundObstructionAt` + `segContains` in [windshield.js](../client/game/js/panels/windshield.js) |
| The scale house, customs, impound | [plugins/trucking/scale.js](../plugins/trucking/scale.js) |
| Trailers as world objects | [plugins/trucking/trailers.js](../plugins/trucking/trailers.js) · `trailers` table in SCHEMA_SQL |
| People on the shoulder | [plugins/trucking/hitchers.js](../plugins/trucking/hitchers.js) |
| The sleeper cab as a place you can sleep | [plugins/trucking/bunk.js](../plugins/trucking/bunk.js) |
| The cab heater (20°C while the engine runs) | [plugins/trucking/hvac.js](../plugins/trucking/hvac.js) |
| Text-rung driving + its gearbox verbs | [plugins/trucking/textdrive.js](../plugins/trucking/textdrive.js) |
| Breakdowns, the roadside `fix`, the fork (`route`), the CB | [rig.js](../plugins/trucking/rig.js) · `announceBreak`/`cbLine`/`switchLimb` in [state.js](../plugins/trucking/state.js) |
| Ownership + the dealer | [plugins/trucking/fleet.js](../plugins/trucking/fleet.js) · `trucks` table in SCHEMA_SQL |
| The bench — condition, tuning, kits, paint, and the ONE place a tune becomes physics | [plugins/trucking/rig.js](../plugins/trucking/rig.js) |
| The depot app — garage floor, walkaround, dealer's line, bench | [client/game/js/panels/truck-depot.js](../client/game/js/panels/truck-depot.js) |
| The truck meshes (four shapes, bobtail + hitched) | `buildTruck` / `TRUCK_SHAPES` in [aircraft3d.js](../client/game/js/panels/aircraft3d.js) |
| The dispatcher | [content/npcs/npc_kessler_dispatcher.json](../content/npcs/npc_kessler_dispatcher.json) |
| Commodities + prices | [plugins/trucking/market.js](../plugins/trucking/market.js) |
| Zone flags | `truck_depot` / `truck_yard` / `truck_fuel` / `weigh_station` / `loading_dock` in [tagCatalog.js](../client/shared/tagCatalog.js) |

---

## The four rules

Three of these are decisions NOT to build something. The fourth is the one place it was cheaper to
borrow than to abstain.

### 1. The corridor synthesises ZONES, never render cells

The void has no placed tiles — void rooms carry `grid_x: null`, because walking a chain of rooms
never needed coordinates. Driving does.

So `corridorAt(route, x, y)` returns **the same shape `surfaceAt` returns** — `{ id, name, flags,
danger }` with `flags.terrain: 'road'` — and hands it to `mapWindow` in
[plugins/flight/state.js](../plugins/flight/state.js), which is the one place that decides what a
tile looks like. Road auto-tiling, lane markings, biome, buildings, fog and the Curtain all come
for free and stay correct when somebody improves the renderer without knowing trucking exists.

The seam is one parameter: **`mapWindow(a, radius, at = surfaceAt)`**. Flight passes `surfaceAt`,
trucking passes a provider that composes the world with the corridor — see the coordinate note
below for why that composition is now both possible and necessary, and which way round it goes.

#### What the road LOOKS like, and where all three answers live

| question | answer | why there |
|---|---|---|
| **how far can you see it?** | `CAB_RADIUS` (30) in state.js; `drawGroundSurfaces` derives its far limit from `(map.length − 1) / 2` | The buildings already derived their draw distance from the window (`drawWorldObjects`); the **ground pass did not**, so on a haul the towers ghosted up out of the haze exactly as intended while the road they stand beside **ended in a hard diagonal line at the edge of the window**. A pilot never saw it — a 36-tile window is bigger than the 34-tile view, so the constant bit first. A driver saw nothing else, because out there the road *is* the ground. Both now fade to zero **at** whatever limit the data actually supports, so the radius is a free view-distance dial. ⚠ It is a square, and out here almost every cell is a real one (the verge runs to `OFFROAD_R`), so the cost is **measured, not guessed**: ≈109 KB at 22, ≈158 KB at 30, ≈183 KB at the renderer's own 34-tile ceiling, one payload a second |
| **how wide is it, and where does it start being that wide?** | `pavedAt(route, s)` / `lanesAt(route, s)` in corridor.js → `road_w` / `road_lanes` per tile | It was one constant, and one constant is what made the join read wrong: a city street is one tile across, the highway was 2.4, and because a cell either *is* carriageway or is not, the change happened between two adjacent tiles — you came off a two-lane street and were abruptly on something four lanes wide. Both the width and the lane count **ramp** over the first stretch and close again on the approach to the far end (you arrive at a town as well as leaving one; `d` from the *nearer* end gets both from one expression). The renderer needed no change at all — every tile has always shipped its own `road_w` and the markings have always scaled off it. ⚠ **The narrow end is bounded by the 8-connectivity invariant, not by taste**: a band one tile across rasterises into tiles touching only at their corners the moment the centreline runs diagonally. ⚠ And **the shoulder is a fixed width, not a ratio** — at 2:1 the narrowed road left a graded band about ¾ of a tile across, and at some headings *no tile centre fell inside it*, so you crossed from road straight to verge with nothing in between: the band that exists so drifting off READS before it costs |
| **why does it look like dirt?** | `flags.road_dirt` → `ft: 'dust'` | ⚠ **`terrain` stays `road`.** Authoring `terrain: 'dirt_road'` is the obvious way and is wrong twice: `surfaceUnder` reads terrain to pick the physics surface, so the highway would silently acquire the *shoulder's* grip penalty for its whole length (that exact bucketing bug has been fixed there once already), and `isCarriageway` would lose the ability to tell the road from the band beside it. What changes is what it *looks* like, so what is authored is what it looks like. The renderer lays a pair of wheel ruts down each lane's middle — a multi-lane unmade road, where nothing is painted and you can still see where the traffic goes. ⚠ The one-lane case is byte-identical, so every farm track and frontier strip in the world draws exactly what it drew |
| **why does it look unmaintained?** | `flags.road_wear` on the paved band → `wr` on the cell → `drawGroundSurfaces` | Nobody has resurfaced this since the basin emptied, and it has to *look* like that or the void reads as a municipal street laid across a desert. **One authored bit, everything else derived**: sun-bleached tar, sand drifting in off the verge, tar patches, cracks, paint that is thinned *and missing outright in places* — a faded line still reads as a line somebody maintains, and a broken one does not. Shipping the detail per tile would be authoring a texture over the wire at 3,700 cells a push and would put the road's appearance in two places. **A highway also gets no kerb and no pavement band** — that is a city thing the street-actor pass stands people on. ⚠ Every scrap of variation is hashed off the tile's **world** coordinate, never its index in the window: the window travels with you, so a window-relative hash makes the ground crawl and shimmer as you drive (which is what the older dirt-road shade jitter was doing) |
| **why do the headlamps light nothing?** | they do now — `drawVehicleGround` §4 | `drawHeadlightBeam` has thrown a beam down the tarmac since the first night run, but it is built in the **camera's** frame: it is the light you drive *by*, and it belongs to whoever is looking rather than to a truck. So every rig seen from outside — yours in the chase view, and every other rig on the corridor — had two lit lenses and no light. The new pair is built from the lamp **stations** in the mesh's own coordinates, exactly as the lifter cones are, so it turns and leans with the vehicle for free; it is painted **before** the model, like everything else on the road, so the bodywork masks its own beam by paint order. ⚠ Deliberately **not** run through the articulation frame, unlike every other station in that file — headlamps are on the tractor, and hinging them would swing the beam with the trailer |

### 1a-0. The network: gate → interchange → interchange → gate

*(2026-08-19. **Live** — `routeForRig` builds every driven road this way.)*

A road used to be *wander from a gate to a target*, identified by `voidKey|destKey`. That made
Coldwater→Reach and Reach→Coldwater **two different roads on different ground**: each fine alone,
and the pair of them a lie, because drive out and drive back and you are not retracing anything.

A road is now four points and three segments:

| piece | seeded on | why |
|---|---|---|
| **spoke** (gate → interchange) | the **gate** | every road leaving that gate lays the *same* tarmac, so the fork stops being a room boundary and becomes a **place** you can see |
| **middle** (interchange → interchange) | the **pair** of gates | both directions are one road |
| **spoke** (interchange → gate), reversed | the far **gate** | same, at the other end |

The **interchange** is placed, not authored: `SPOKE_LEN` tiles out along the mean bearing to
everywhere that gate can reach, so it is ahead of you as you leave, roughly on the way to all your
options, and it moves by itself when a destination is added. **A hub is just an interchange several
roads meet at** — it falls out of the model rather than being built into it, and multi-exit works
because an interchange belongs to the *gate*, not the region.

⚠ **The middle is built once, canonically, and reversed for the other direction.** Building it from
each end with the same seed is the obvious thing and does not work: the wander integrates a heading
from wherever it starts, so A→B is not the mirror of B→A — same seed, same endpoints, **two
different curves, nine tiles apart at worst**. Regress caught it on the first run, and it is the
exact bug this whole phase exists to kill. The lower-sorted gate id is the road's own direction.

⚠ **A GATE GROWS AS MANY INTERCHANGES AS ITS DESTINATIONS NEED.** One per gate is the tidy model and
it does not survive Coldwater: the Reach is south, Terminus east, Deadwater west — a fan of over
120° — so whichever way a single junction faced, at least one road had to leave it through a
**hairpin**, and that is not merely ugly. Cells are classified by distance from the centreline out
to `OFFROAD_R`, so a turn tighter than that radius folds the verge through itself and `locate`
begins handing out two positions for one tile. Aiming at the mean of destination *positions* gave
**101°** (the furthest destination drags the answer); the mean of *directions* gave **90°**; no
single point does better, because the spread is the problem and placement cannot divide it. So
destinations are grouped by bearing (`GROUP_HALF`), each group gets its own junction, and **roads
share a spoke exactly when they genuinely start off the same way** — which is what a shared spoke
was always supposed to mean. It is the same answer as "a region has several exits", one level down,
and reached the same way: the map says how many there should be, so nothing authors a number.

**The interchange is a place you can SEE.** The junction line has said *"the graded road splits
around a stand of dead pylons"* for a long time and there were no pylons — it fired on a node
crossing and the windscreen showed the same empty verge as everywhere else. That gap got worse
rather than better when the fork stopped being a room boundary, because **a place you cannot see is
a room boundary with a better comment**. `joinRoutes` snaps a stand of them to tiles at each seam,
on the verge. ⚠ Not `mast()`, though it is right there — that helper ends in `blinkLight`, a red
aviation beacon, and the one thing these are is *dead*: a pylon that still winks at aircraft is a
pylon somebody is maintaining. ⚠ Not a `building_type` either, same argument as the sign — a lattice
tower has no mass worth extruding, and a landmark at the one place you are choosing a road is the
worst possible thing to make solid.

⚠ **An interchange never sits past the halfway point.** On a short hop the two would overshoot and
the middle would run *backwards* between them — a road doubling back, which `locate` resolves by
handing out two positions for one tile.

⚠ **Built by concatenation, not by teaching the wander about waypoints.** That loop holds the leash,
the fold-radius floor, the sinuosity cap and the exact landing, and its output is pinned by a dozen
cases that would all have to be re-derived at once to know whether a change was faithful. Each
segment is built by the **same unmodified builder**; `joinRoutes` owns only the joining — `s` runs
continuously across the seam, a room is a fraction of the **whole** road, and **the seam registers
as a bend** so `signsFor` boards the interchange, which is the one turn a driver most needs warning
about.

⚠ **Cell seeding follows the SEGMENT, not the road.** A spoke cell must roll the same whichever
destination this driver is bound for, or the shared spoke is only shared *geometrically* and grows
different buildings per road; a middle cell must roll the same both ways, or one road has two sets
of scenery. An unjoined road has no segments and falls back to the string it always used, which
keeps every pinned road in the suite byte-identical.

⚠ **The pre-network builder is still there as a fallback**, for a crossing that cannot supply a gate
at both ends. That is right, and it means the network could be built, proven, wired and *silently
not used* with a green suite throughout — so regress asserts the road a real crossing hands a driver
**has three segments**, and re-asserts the shape invariants (unbroken tarmac *through the seams*,
every room reachable, boards present) about **that** road. The older shape cases build with
`corridorFor` directly and now describe the fallback.

**Distance:** Coldwater→Reach goes 95 → 130 tiles. Against a ~1,050-tile tank that changes no fuel
maths; the fleet ladder is untouched.

### 1a-i. The gate: where a region's road leaves it

*(2026-08-19.)* **The road is there as you drive up to it, instead of switching on when you cross
the edge.** That was never a rendering gate that could simply be opened — a crossing is anchored to
`leader.current_zone`, the rim tile you happened to be standing on when you struck out, so until you
had *already left* the game did not know where the road started. There was nothing to draw.

So the road gets a gate of its own: **the tile where the region's own road runs off the map**
(`regionGates`). Not an arbitrary rim tile and not a derived midpoint — the highway is the
continuation of a street that is already there, which is what makes the join read as a road leaving
town rather than as tarmac beginning in a field. It is found by *looking at the world* rather than by
authoring a zone id anywhere, because the world already says it: a rim tile carrying road **is** the
way out.

⚠ **This changes the anchor and nothing else.** The crossing's rooms still hang off the tile you
actually walked out of, `originSign` still names the place, and a walker's void is untouched. All
that becomes canonical is where the road's *geometry* starts — precisely the thing that has to be
knowable before you get there. With it static, `previewRoute` builds the same road from the same
seed and anchor before any crossing exists, and the **city leg composes it** (`providerFor`), so the
highway comes up out of the haze while you are still on the map.

⚠ **It must be the same road, not a similar one** — a preview differing by so much as its seed is a
road that visibly jumps at the exact moment the pop-in used to happen, which is the bug wearing a
different hat. Regress pins the gate's stability too: `getAllZones()` yields a Map's insertion order
and a content import can reshuffle it, so ties are broken on the **coordinate**, never on iteration
order — otherwise a re-import would silently move every road in the game.

⚠ **GATES ARE PLURAL, from the first line, and that is deliberate.** The obvious shape is one gate
per region; it is simpler and it would have to be torn out. The design this is heading for is a road
**network** where a region has several exits and a neighbour is reached through whichever one faces
it, worked out from the map rather than authored. A singular gate bakes the opposite assumption into
every caller — so there is no singular gate. A region *publishes* its exits (`regionGates`), a road
is a **pair** of them, and which pair two regions use is a question with an answer (`gatePair`:
nearest pair wins, which is what "nearby regions share a road and use the exits facing it" means in
arithmetic) rather than a constant. Every region publishes exactly one today, and every path reads
identically for that case — which is what makes this a *step* rather than a promise. Regress pins
the contract now, while it is still cheap to get wrong and impossible to notice: gates come back as
a list, **one road mouth is one gate** (a road is two or three tiles wide by the time it reaches the
rim, so unclustered candidates publish a single way out of town as four), the chosen pair really is
the pair that faces, and asking from the far end names **the same two exits** — without which the
road between two towns is two roads again.

⚠ **A gate is a CONTENT requirement.** The fallback (anchor on the tile the driver left from) still
exists and still works, and that is exactly the danger: a region whose road never reaches its rim
would go on quietly popping its highway in, with a green suite and nothing to say which region it
was. Regress therefore sweeps **every** void and names the ones without a gate. The Reach failed it
on the first run — its only road surfaces were the airstrip and four tiles of main street — and was
fixed in content rather than in code: Main Street simply keeps going west to the rim, along five
tiles of scrub the layout had already joined by exits. **A new region with a void needs a road out
to its edge**, not a special case here.

### 1a. The road is laid in REAL WORLD COORDINATES

*(Changed 2026-08-19. It used to have a private frame — origin at the gate, heading due south,
length `nodes × 90`.)*

`corridorFor` takes an **anchor**: the `grid_x`/`grid_y` of the rim zone you drove off and of the
destination zone. Both already existed on rows the crossing already knew about, so **nothing is
authored and nothing is stored** to make this work.

The old private frame was internally consistent and it made the truck the only thing in the game
using those numbers. A pilot overhead, a walker in the same crossing and a driver on the same road
each had a different idea of where *here* was, and no two of them could be converted into each
other. One frame fixes that, and it pays for itself immediately in two places:

- **The world shows through.** `providerFor` used to swap `corridorProvider` **in place of**
  `surfaceAt` — the only honest thing to do while the road was somewhere else, since the world's
  tiles were in a different frame. Same frame, and that swap becomes a lie by omission: everything
  off the corridor's own band answered `null` and `mapWindow` painted it as air, so the city
  vanished the instant the road began. The two are composed instead — the corridor owns the tarmac,
  the verge, the signs and the wrecks, and everything else is the world that was always there. The
  basin recedes in the mirrors and the Reach comes up out of the haze, with no work done by either.

  ⚠ **THE COMPOSITION IS PER-CLAIM, NOT ONE ORDER FOR EVERYTHING.** Both obvious orders are wrong,
  and each shipped and was found by driving:

  | order | what it deleted |
  |---|---|
  | `road(x, y) \|\| surfaceAt(x, y)` | **Coldwater Basin.** The corridor claims every tile within `OFFROAD_R` (24) of a centreline — that is what makes driving off the road *driving* rather than a stall — and the three limbs out of a void all leave from the **same rim tile**, heading south, east and west. A tile twenty tiles inside the basin is barely along the east limb's centreline and well within its verge, so `locate` answered and forty-eight tiles of the city's southern edge came back as synthesised hardpan. Driving out you never saw it, because it was behind you |
  | `surfaceAt(x, y) \|\| road(x, y)` | **the highway.** A region's grid is placed ground for a long way past anything anybody would call a town, so a blanket veto took the tarmac with it: you came off the end of the Coldwater road into open desert with no road on it at all — worse than the bug it fixed |

  So the question is asked of the **cell**, not of the provider. A corridor cell is one of two
  completely different claims: the **carriageway** (tarmac and graded shoulder) is a road, and a road
  is *laid on* ground that already exists, so it wins; everything else the corridor synthesises —
  verge terrain, the roadside sheds, the wrecks, the boards — is **filler for ground the world does
  not place**, and loses. `isCarriageway` lives in corridor.js so the two terrains that file chooses
  are not restated by the caller. Nothing about the drive reads this window — the odometer, the node
  and the collision all go through `locate` — so it decides what you *see*.
- **You can turn round.** See [the odometer](#the-odometer) — a road with a real near end has a real
  way back out of it.

| decision | why |
|---|---|
| **the leash is re-centred, not removed** | `off` was the heading's deviation from due south, a FIXED direction, which is exactly why the road needed a fixed length to stop at. It is now the deviation from the bearing **to the target**, recomputed each segment, so the existing `HOME_BIAS`/`HOME_MAX` rules do the homing for free. No convergence term, no blend weight — the leash was always a homing device, it was just homing on a compass point instead of on a place |
| **⚠ the approach threshold is the TURN RADIUS** | a curve cannot converge on a point tighter than the circle it can draw. Terminating a few tiles out put the builder in a **limit cycle**: it homed beautifully to ~8 tiles and then orbited its own destination for the rest of its budget, sweeping a full 360° of heading, because it was correcting an 8-tile miss on a 43-tile circle. It only ever arrived because the cap ran out and the final leg dragged it in — so every road ended in a kink nothing had chosen |
| **the bend constants scale with the road** | `ARC_MIN`, `STRAIGHT_MIN` and `MIN_RADIUS` are absolute tile counts chosen for a 720-tile haul. On a 98-tile one a single minimum arc was two thirds of the journey. Same for the sign constants — `FORK_SPREAD` at 210 aimed the junction arrow past the far end of the road it was describing |
| **`MIN_RADIUS` scales but is FLOORED** | the fold invariant is not negotiable: cells are classified by distance from the centreline out to `OFFROAD_R`, so a bend tighter than that band folds the verge through itself and `locate` hands out two answers for one tile |
| **unanchored still builds the old frame** | one code path, and a missing coordinate on either end degrades to the road that always shipped rather than putting a road somewhere real and wrong. Much of the regress suite is built on it |

> ⚠ **Hauls are now as long as the gap actually is.** Coldwater's south rim and the Reach are 95
> tiles apart, not the 720 that `length: 8` produced — about 33 miles against 240. That also means
> **the Terminus fleet gate is gone** (it worked because 1080 tiles was beyond any truck's round
> trip; the real gap is 245) and the tank tuning in `flight-model.js`, sized against 765 tiles, is
> now slack. This is a deliberate deferral, not an oversight: a road that lies about where it is
> cannot be tuned into honesty first. The dials are `MAX_SINUOSITY` and moving the regions apart.

> **Why this is a rule and not a preference.** [snapshot.js](../plugins/flight/snapshot.js) used to
> keep its own copy of that per-cell derivation. It drifted twice — the baked flight world silently
> lost 144 painted-only street tiles, then lost authored park features. Both copies now call the
> shared `deriveSurfaceCell`.

**Author the road icon explicitly.** `corridorAt` always sets `flags.icon`. The auto-tiler ORs
together every adjacent road cell, and the corridor's shoulder is `dirt_road` — which counts as
road — so an unauthored corridor comes back `nesw` on *every* tile and the renderer paints a
crossroads for the entire length of the highway. Verified both ways.

### 1b. The road BENDS, and the bend is a heading rather than an icon

*(2026-08-16.)* The corridor used to be a polyline of **axis-aligned legs**: long southbound runs
broken by hard 90° jogs. Driving it needed no steering at all. It is now a **curve** — a heading
integrated along arc length and sampled into 4-tile segments (`SEG`), alternating genuine straights
with sweeping arcs.

The stated reason it was built straight was that the renderer paints lane markings toward connected
tile *edges* (`rd`), so a diagonal would come out as a staircase of hairpins. That was true of the
**icon** and was never true of the **paint**: `stripeA`/`dashedA` in `drawGroundSurfaces` always took
an arbitrary axis vector and had only ever been handed `[1,0]` or `[0,1]`. So a paved tile now ships
three new flags and the renderer draws along them:

| flag | is | why it exists |
|---|---|---|
| `road_deg` | the segment's heading, degrees | the marking axis — a curve is a *straight* pointing between two compass letters, never an elbow |
| `road_t` | this tile's lateral offset from the centreline | every tile of a multi-tile band paints the **same** world-space lines; without it each tile lays its own double-yellow and the highway gets three centrelines |
| `road_w` | the paved half-width | marking spacing is derived, not a second copy of corridor.js's numbers living in the client |

They travel through `deriveSurfaceCell` as `rdeg`/`rt`/`rw`. Every baked world tile leaves them
undefined and keeps the icon path untouched. The icon is still authored, always, but only ever as
the **nearest axis** (`road_ns`/`road_ew`) and **never as a bend piece**.

Three things about this are load-bearing:

⚠ **The minimum turn radius is a correctness invariant, not a taste setting.** Every cell out here is
classified by its *distance from the centreline*, out to `OFFROAD_R`. Bend tighter than that and the
verge band folds through itself: two distant stretches of one route claim the same tile, `locate`
answers with whichever is nearer, and the odometer jumps backwards through the fold. `MIN_RADIUS` is
110 tiles against a 24-tile verge, and regress asserts it.

⚠ **The tarmac had to get wider, and that is correctness rather than generosity.** A one-tile band
(`|t| < 0.5`) is fine on an axis and comes apart the instant it isn't — the tiles of a diagonal band
touch only at their *corners*, so the highway renders as a dotted line of squares. It is `|t| < 1.2`
now (≈2.4 tiles), and regress flood-fills the whole paved set demanding a single 8-connected piece.

⚠ **The leash is applied when a bend is CHOSEN, never while one is driven.** The heading may not
stray more than `HOME_MAX` from due south, or the road eventually doubles back. The obvious way to
write that is to pull the heading toward south a little every tile — which quietly ruins the feature,
because then the *straights* are not straight either, the wheel is never still, and no bend registers
as an event because everything is one. Instead, past `HOME_BIAS` the next bend simply has to turn
back. Regress asserts a good third of segments are dead straight.

Two consequences elsewhere in the file. Roadside structures and wrecks are placed with a
**tolerance band** (`|t − off| < 0.7`), never `Math.round(t) === off` — on a curve that perpendicular
row is a diagonal and an equality test places them intermittently or not at all. And the fork's arc
gets its length **and** its tightness from the destination seed: where the leash forces both limbs
the same way, identical curvature kept them on the same tiles for a full void room past the junction.

### 1c. The junction is a fork you can SEE, and the road tells you how far *(2026-08-18)*

*(2026-08-18.)* A route is a trunk plus **one** limb, because that is all a driver's odometer runs
along — and `corridorAt` only ever asked that one road what was at a tile. So the two roads you were
choosing between at the junction did not exist out the windscreen: the highway came down the trunk,
swung once, and **ended in open waste**. A highway that just stops.

A route now carries its **siblings** (`route.branches`), built from the identical trunk seed and
their own limb seeds, and `corridorAt` falls through to them for any tile this road does not claim.
Nothing about the drive changed — `corridorLocate`, the odometer clamp, the node crossing and the
fuel burn all still read `rig.route` and only `rig.route`.

⚠ **A sibling's cell carries no odometer.** `corridor_s` and `corridor_node` are stripped and
replaced with `corridor_branch`. They are the two numbers the whole drive derives from, and a cell
handing out *another limb's* reading is wrong in a way that would look right — the exact shape of
bug the corridor is arranged to avoid. Regress sweeps a window past the fork asserting no branch
cell carries either.

⚠ **The siblings are built without a plan of their own.** That terminates the recursion, and it
leaves them with no signs — a sign is a thing the road you are ON tells you, and sixty boards facing
a road nobody is driving are texture with a per-tile cost.

**The boards.** One at the gate, one on the approach to the junction, one before each bend, deduped
to no closer than 40 tiles. A row is `{ n, m, a }` — name, **miles**, and an arrow index 0–7 measured
from the driver's own heading, clockwise from straight ahead. Rows list every destination still
reachable from that post plus the **origin**, pointing back; past the junction a board stops naming
the towns you can no longer get to, because there is no cutting across out here and a board naming
one would be a board that lies.

| decision | why |
|---|---|
| **miles, not tiles** | `TILES_PER_MILE = 3` lives in [client/shared/road-units.js](../client/shared/road-units.js) and nowhere else, re-exported by corridor.js. The board, the `route` verb and the GPS all print the same number; a board saying 240 while the dash says 60 means a driver cannot budget a tank against either. ⚠ **It moved out of corridor.js because one of those three surfaces is drawn in the browser** — the dash strip re-derives its own distance every frame from live `s`, could not import a server plugin, and so carried a `/12` that printed a QUARTER of the truth for months while looking entirely plausible |
| **a sign is one TILE, snapped at build time** | the wreck and the roadside sheds match on a tolerance band because they are a whole tile wide anyway. A post matched on a band comes out as three or four identical boards in a row, which reads as a mistake rather than as a sign |
| **⚠ the junction board looks 210 tiles PAST the fork** | a board stands 16 tiles short of the junction, so an ordinary 80-tile look lands barely 60 tiles into a bend of radius 110 — the limbs have separated by about ten degrees, which rounds to the same arrow, and the board points every limb straight on. ⚠ **All four of those numbers now scale with the road** (`route.bendK`), because 210 tiles past a fork on a 99-tile road aims the arrow past the destination it is naming, and `SIGN_APART` at 40 collapses every board on the route into one |
| **the arrow is drawn, not typed** | a glyph would depend on a monospace font having ↗ in it at a legible weight. It is a polygon in the board's own surface coordinates, so it leans and foreshortens with the panel exactly as the lettering does |
| **a sign is a `mark`, not a `building_type`** | a panel on two legs has no mass worth extruding and nothing to occlude behind — and a building would enter the collision sweep, where a board on the verge becomes a thing that stops a truck |
| **⚠ the legs are hand-built, not `draw3DBoxAt`** | that primitive is the **building** primitive: it takes a wall palette and textures every face with that palette's wall, which for `ty_gate_dk` is a grid of lit windows — so each post came out as a slim skyscraper with rows of offices in it, at the one distance you actually read a sign from. A post is a length of tube: flat shade, one bright edge, nothing else. They are also much thinner (0.075 → 0.024 of the footprint); the old pair were as wide as the lettering was tall, which reads as a gantry rather than as a sign on two poles |
| **the board is a SCREEN, and deliberately still almost the old board** | same green, same layout, same white-on-green reading, because a sign's job is to be recognisable as a sign at three hundred metres and a panel that abandoned the highway palette to prove it was a display would be a worse sign that happened to be a better gadget. What changes is that the face **emits**: a dark bezel, a panel darkest where it is unlit, glyphs through `bakeSignText`'s *lit* branch (`solid: false` — a colour halo, dark edge, blown-out core) instead of its painted one, and a pixel grid ruled in the panel's own `(u, v)` space so it foreshortens with the face. ⚠ A screen-space hatch would slide across the sign as you drove past, which is the one thing that would give it away — and the grid is skipped once the board is small, where the lines land under a pixel apart and become a haze over the lettering |
| **the distance is a SEVEN-SEGMENT readout** | the one change that makes the board read as a machine rather than as a lit sign. A number in a font is a number somebody painted; a number made of seven bars is a number something is *counting*, and it is the most recognisable piece of digital furniture there is. ⚠ **The dark segments are drawn too** — leaving them out is what makes a fake seven-segment look like a stencil, because on a real display every bar is physically there, and the unlit ones are most of why a `1` reads as a digit rather than as a stray stroke. Right-aligned and unpadded: a leading zero on a mileage is a clock, and the point is to borrow a machine's *typeface*, not to pretend the board is one |
| **a cyan inner line, a refresh sweep and a status LED** | the cheapest cyberpunk tells available. The cyan is a second colour belonging to the machine rather than to the highway, so the inner edge reads as a screen sitting in a housing. The sweep is one band a shade brighter crawling down the face — what a display does and a board never does. ⚠ Both ride the panel's own `(u, v)`; a screen-space sweep would slide across the sign as you drove past, which is the one thing that would give the whole effect away |
| **a solar panel on top, three lamps under the face** | a lit sign in a place with no grid has to say where the power comes from or it is a magic board, and the one implies the other: the reason the lamps come on after dark is sitting on the roof where you can see it. The panel is **tilted back** off the top edge — the tilt is the whole read, since a rectangle lying in the board's own plane is indistinguishable from more board. The lamp **housings** are drawn day and night (an unlit fitting is still a thing bolted to the sign — the same argument the streetlights make about not popping in and out as the sun goes down); the wash is additive, so three overlapping cones build one lit board rather than three bright patches |
| **⚠ a board has TWO faces, authored server-side** | a real motorway board is blank steel on the back because the other carriageway has boards of its own. This road is one lane each way and one post, so a driver running home was passing a board they could not read — and the renderer, mapping one set of lettering onto a quad seen from behind, drew it **mirrored**. `signsFor` authors `back` as well as `rows`: the same places at the same distances (a distance along the road does not care which way you face) with **the arrows re-measured against the reversed heading**, which is the only part of a row that is about the driver rather than about the road. The renderer picks the face off which side of the panel the camera is on and negates the panel's across-axis so the text runs left-to-right for whoever is looking. Mirroring alone would give a legible board pointing every destination the wrong way |

The rows travel to the client as `sgn` on the surface cell, exactly the way a forecourt's prices
travel as `brd`: **nothing in the renderer works out a distance.** And the same rows reach the
**log** as prose when you pass a post (`passSign`), because a board painted only on the windscreen
does not exist for anyone on the bottom rung of the display ladder — and out here the board is the
only statement of how far anything is.

⚠ **Passing a board is a SWEPT range, not "am I near one".** The cab reconciles four times a second
and a text run covers a whole slab of road per tick, so a proximity test has the cab reading every
board and the text rung stepping over most of them. `signsBetween(route, from, to)` asks what was
*passed*, which is the same question at both rates.

⚠ **…and the sweep is UNSIGNED.** It answered nothing at all when the odometer went *down*, so a
driver running back toward the origin passed every board on the road without one of them reaching
the log — boards that existed for traffic going one way, on a road that has always been drivable
both. The range is order-agnostic now; **which face was read is the caller's business** (`passSign`
picks `back` when `s` fell), because that is a fact about the driver and not about the road.

One honest limitation, so nobody "fixes" it into a lie: where the leash forces every limb the same
way out of the junction, the board really does point them all the same way, and they separate later.
The arrow is the road's geometry. Choosing between them is what `route` is for.

### 2. The drive IS the crossing

`player.current_zone` stays the void room the whole way. The odometer crossing a node boundary
walks the player one room down the spine and emits `zone.entered` — exactly what a footstep does.

So voidwalking's encounters, ghost-traces, hard nodes, detours and teardown are **triggered here
and implemented nowhere here**. A trucker who breaks down finishes the crossing on foot at a cost
of zero extra code.

`nodeAt(route, s)` maps an odometer reading back to a room. It was `floor(s / TILES_PER_ROOM)`
written out in five files, which was fine while the road's length was DEFINED as `nodes × 90` — the
division could not disagree with anything. A room is a **fraction of the road's real length** now
(`route.roomLen`), so five copies of a stale division would put the cab, the text rung, the renderer
and the node-crossing handler in four different rooms.

The two plugins meet through named exports on voidwalking's
public surface — `crossingChain`, `crossingDest`, `crossingInfo` — never by reaching into its
internals. `player._crossing` deliberately carries only `{ instanceId, seen }`; everything else
about a crossing is shared state and lives on the crossing.

### 3. One rig, two legs — the provider is the only difference

A haul is driven in two different worlds and the rig moves between them by swapping **one function**:

| Leg | `x`/`y` are | Provider | A tile is |
| --- | --- | --- | --- |
| `city` | real world grid coords | `surfaceAt` | a real zone you are standing in |
| `corridor` | **real world grid coords** | `corridorProvider(route)` → falls through to `surfaceAt` | `route.roomLen` tiles — one *n*th of a real road |

`joinCorridor` fires when you drive off the rim (through voidwalking's own `launchCrossing`, not a
copy of it); `leaveCorridor` fires on arrival, so you come off the highway **still driving** and the
last mile into the yard is part of the haul.

City zone changes are **RAM-only** — at cruise a tile passes every ~1.3 s, so a `current_zone` write
per tile would be a DB round trip on the hottest path in the system. The row is flushed once, on
park/arrive, exactly as voidwalking flushes `crossing_room` on logout.

### 4. Buildings are solid, and you can drive under things

`groundObstructionAt` is the flight sim's CFIT geometry at ground level. Both probes share
`segContains`, so **what you can see is what you can hit** and a seed-varying model collides as it
is actually drawn.

The one addition is a `z0` gate. `modelTopAt` asks "how tall is the mass over this point", which is
the right question for an aircraft and the wrong one for a truck — it ignores `z0`, so an
overhanging attic or a canopy reads as solid to the ground. A segment only blocks you if its
underside comes down to your roofline. **A third of the model set has mass over a truck's head**
(678 drive-under cells across 89 models), so this is load-bearing, not a nicety.

Four aviation gates are dropped: the `onGround` bail, `climbOutClear`/the departure corridor, the
"must be visible on the glass" window, and the altitude penetration test. The **sweep is kept** — at
68 mph a truck covers most of a tile between frames and would tunnel through a wall.

Off the *road* is still a law rather than a wall, though:

| Where | Effect | Room crossing time |
| --- | --- | --- |
| Paved centreline | full speed | ~1.8 min |
| Shoulder (`dirt_road`, renders as packed dirt) | rumbles, loses grip | ~2.5 min |
| Verge | speed clamped, grip poor | ~5.2 min |
| Past the half-width (`CORRIDOR_R = 6`) | **bogged** — stalled, put back on the shoulder facing the right way | — |

> **The tuning trap.** Every surface must satisfy `thrustMax × drive > rollFric × drag`. An early
> off-road `drag` of 4.2 put rolling resistance (8.8) above everything the engine could deliver off
> pavement (5.6), so the truck would not move at all — a wall wearing a penalty's clothes. There is
> now a regress invariant asserting this for every surface of every ground type.

---

## The fleet — you have to own one

`drive` requires a truck you own, parked in **this** yard. Phase 1 handed anybody a free rig because
the question then was whether the *drive* was worth doing; it is, so the question now is whether the
run is worth **owning** — and that only bites if the truck cost you something you could have spent
elsewhere.

| | price | deck | tank | top | 0–60 |
| --- | --- | --- | --- | --- | --- |
| **Krell Barrow** | 1,300₵ | 1,200 kg | 850 tiles | 57 | — |
| **Ostrek Courier** | 3,400₵ | 1,800 kg | 1,100 | 74 | 9.9 s |
| **Vachon Drayman** | 7,200₵ | 3,500 kg | 1,400 | 66 | 17.2 s |
| **Orlov Continental** | 16,500₵ | 6,200 kg | 2,100 | 63 | 18.2 s |

> **Repriced 2026-08-21 — the top of the ladder was indexed to an economy that does not exist.**
> Courier 4,200 → 3,400 · Drayman 11,500 → 7,200 · Continental 31,000 → **16,500**. The Barrow's
> 1,300₵ entry rung is deliberately untouched. The problem was never the entry price, it was the
> **shape**: every cost in the system is derived from the truck's list price (resale, `repairCost`,
> `paintCost`, `trimCost`, `towFee`'s `heft`) while every income is a flat load table or a fixed
> market return, so climbing the ladder scaled the bills linearly and left the earnings where they
> were. A crossing haul pays 676–1,664₵; the old Continental was ~19 of them **before** running
> costs, and a single professional repair from half-condition was 13,020₵ — eight crossings to undo
> one bad week. At 16,500₵ the top rung is ~10 crossings and its worst repair is 6,930₵. Every
> derived cost fell with it for free, which is the payoff for having derived them.

**The spread is in different directions, not one "better" axis.** The Mule is the *fastest* thing in
the fleet and can't carry a full commodity load; the Continental is slower than the Drayman and
swallows a whole market. Range is the other half of the ladder — **and it is currently slack**, see
the warning below.

> ⚠ **These range figures are pre-anchoring and no longer bite.** They were tuned against a run of
> **765 tiles one way** (44 of Coldwater road, 720 of corridor, one into the yard), which is what
> made only the Orlov round-trip on a fill, forced everything below it to refuel at the far end, and
> had the Barrow arriving on 10%. Since the road was anchored to real coordinates
> ([§1a](#1a-the-road-is-laid-in-real-world-coordinates)) the Coldwater→Reach corridor is about 99
> tiles, so every truck in the fleet round-trips comfortably and the ladder's range rung does
> nothing. Retuning it is part of the distance pass, together with the Terminus gate.

> **Naming.** Trucks are an invented **maker + haulage model** — a drayman drove a brewery cart, a
> barrow is the humblest cart there is. Deliberately a different family from the aircraft, which are
> animals and insects (Mayfly, Locust, Dragonfly, **Mule**). An early cut called the light one the
> *Kestrel Mule* and collided with `ac_mule` on both halves at once; a regress case now asserts no
> truck borrows an airframe's name.

A truck is a `trucks` row with an owner and a place, exactly as an aircraft is — everything *about*
the model (speed, deck, tank, price) lives in `TYPES` and nothing is duplicated in the table.
Resale is 55% minus odometer wear, capped at a
quarter off: a commitment, not a savings account to shuffle money through.

**A yard holds as many of yours as you can pay for** *(2026-08-18)*. It held exactly **one**, and
the second buy was refused with "move it or sell it" — a rule whose stated justification was that
saying so is cheaper than a disambiguation prompt on every mount. It was, right up until owning a
*fleet* became the point: a yard is where a fleet lives, and a rule that scattered six trucks across
six towns so one verb never had to ask a question made "own several" mean "own several, somewhere
else". So `fleet.js` lost its `LIMIT 1` (`truckAt` → **`trucksAt`**, a list — that limit was never a
performance choice, it was the fleet rule wearing SQL's clothes, and over two parked trucks it is a
silent answer to a question nobody asked), and the ambiguity is answered **where it arises and only
when it arises**: with one truck standing there nothing asks anything, which is the case every
player who owns one truck is in forever. With two, `drive` prints a **menu** — every line is the
command that takes that truck, because anything you can click you can type — and `drive <plate>`,
`drive <model>` or `drive <id>` picks. The panel's CLIMB IN and *Take it out* buttons carry the id
of the truck on the turntable, so clicking is never ambiguous however many stand behind it. The
bench is deliberately **id-only** (`rig paint <id> …`): everything after the subcommand there is an
argument, so a truck picked by plate would be a plate competing with a colourway for the same token,
and the loser is somebody who called their truck *Walnut*.

**And each of them is painted separately**, which was always true (paint lives in the truck's own
`custom_data`) and is now *asserted* — one bag per truck is only true until something writes the
wrong row, and the symptom of that would be a whole fleet turning the colour of the last respray.

> **A gauge that never bites is decoration.** For a long time fuel counted down to zero and the
> truck simply carried on, which made every tank number a label rather than a constraint. Running
> dry now stops the rig dead — `park` and walk, which on a crossing means finishing it on foot
> exactly as a breakdown always did — with a low-fuel warning once on the way past. The stop is
> announced but **must not short-circuit the sync handler**: an early return there skipped every
> arrival and delivery below it, so a rig that ran dry one tile from the dock could never finish.
> The text rung burns and dries identically; a rung must never be a way to dodge a constraint.

> **The pump handle, and why you never leave the seat for it.** Fuelling used to be a verb you
> typed after climbing down: `fuel`, all of it, at the full price, or a refusal if you were short.
> A driver at a pump with 90₵ got an error message instead of 90₵ of diesel, which is the version
> of that transaction nobody has ever had. So the cab grew a **held handle** on the switch panel —
> present only when the server says there is a pump under the nose, the same "the world affords it
> or it is not on the panel" rule the trailer air valve follows. It fills while you hold it, the
> face is the **running total in credits**, and it clicks off at a full tank *or* at the end of
> your money, whichever comes first.
>
> **The handle is not a server-side pour, and the client is not trusted with the money.** The
> obvious build is an interval adding fuel and taking credits every 200ms: a per-player timer, a
> second place fuel moves outside the drive loop, and a teardown case for every way a session can
> end mid-pour. Instead the cab does what it already does with everything else — simulate the feel,
> then report — and `truckpump <fraction>` is the commit. The only thing the client is believed
> about is **how long the trigger was down**; pump, tank space and affordability are all re-derived
> server-side. That is safe by construction rather than by vigilance: the worst a lying client can
> ask for is `1`, a full tank at the price the verb has always charged for exactly that.
>
> ⚠ **A push mid-pour must not touch the gauge.** `pushCab` lands about once a second, carrying the
> server's *pre-pour* fuel, so accepting it while the handle is down drags the needle back to where
> the tank was, once a second, while the driver watches it rise. `st.pumping` gates that one field
> and nothing else.
>
> The typed `fuel` verb is now the same commit asked for everything, which is what makes it fill as
> far as you can afford rather than refusing you. **The affordability cap is a clamp, never a
> refusal** — that is what stops the system stranding somebody who had enough to reach the next
> town.

> **And `fuel` also works with both feet on the apron.** The handle above is the *driving* half, and
> for a while it was the only half: `fuel` opened with `if (!rigOf(player))` and answered "You are
> not driving anything" to anyone who had parked under a canopy and climbed down. That is most of
> the people standing at a pump. It is also a room advertising an action it then refuses — the pump
> furniture's own `examine` line offers `fuel the rig` as a click-link (see
> [plugins/fuelstation](../plugins/fuelstation/README.md)), and the click landed on that error.
>
> `rig fuel` was not the way out of it. That is the **depot bench**, and it opens with a `depotHere`
> gate, so it refuses on every forecourt in the world. A pump is not a workshop: you do not need a
> bay, a fitter or a dealer to put diesel in a tank, you need a pump and a truck standing at it. So
> `fuel` on foot (`pumpParked`) asks the same two questions of the same two functions the cab path
> uses — **`pumpAt` decides whether this tile sells diesel and `pumpClamp` decides what a balance
> buys** — and finds the truck by the `depot_zone` that `park` already wrote. Nothing here holds a
> second opinion about either, so retuning `FUEL_FULL` or adding a pump flag moves this path with
> the rest of them. Off a pump tile the old refusal is unchanged, and regress pins that: a street
> with no pump on it still says you are not driving anything.

> **Parking on the road, and why the rig is still there.** `park` means park *everywhere*, including
> out on the corridor. For a while it did not: a healthy rig stopped mid-crossing was silently turned
> round and driven back to the gate it came in by (`retreat`), which was safe and was not what the
> verb says. It also made the one thing the corridor exists to allow — **stop, climb down, walk
> about, climb back up** — unreachable, because `mountOnCrossing` could always put a driver back into
> their own cab out there and nothing could get them *out* of it in the first place. `retreat` keeps
> its other caller: driving back to `s = 0` under your own power still leaves the corridor at the
> gate, which is the honest way to change your mind.
>
> ⚠ **The room the truck stops in is transient, so the truck names somewhere real to be dragged to.**
> A void room is unregistered the moment the last member walks out of the crossing
> ([voidwalking teardownInstance](../plugins/voidwalking/index.js)), and a rig holding that id as its
> `depot_zone` is a row pointing at nothing: not findable, not drivable, not sellable. So parking on
> the corridor writes `custom_data.void_home` — the depot the haul set out from — at the one moment
> both facts are in hand, and `recoverTrucksFrom` drags the truck there on the **same impound path a
> breakdown uses**. Nothing new is invented to charge you; abandonment, confiscation and a crossing
> that ended without you all finish in the same lot. Two triggers, because one is not enough: the new
> `crossing.ended` event (emitted *before* the rooms go, or there is no way to ask what was in them)
> and a boot sweep for `depot_zone LIKE 'xing_%'`, since crossings live in RAM and a restart leaves
> every such truck dangling with no teardown to fire.
>
> ⚠ **`impound_fee` is truthy-tested, and 0 means *not impounded*.** `recoverTruck` clears a lot by
> writing a **zero** fee rather than a NULL, and every reader here agrees (`if (owned.impound_fee)`,
> `t.impound_fee || 0`). A plain `COALESCE(impound_fee, …)` in the sweep therefore preserves the 0
> and never charges at all — it must be `COALESCE(NULLIF(impound_fee, 0), …)`. Regress caught this.

> **The heavy-truck trap.** A ponderous truck is `mass`, `engineLag` and `wheelbase` — **never**
> starving it of power. The first cut gave the Continental `thrustMax: 7.4` against a rolling
> resistance of 2.6 and the drivability invariant caught it: it could not move off the pavement at
> all. Same bug as the original off-road tuning, two months of design apart, caught by the same
> assertion.

---

## A truck exists to other people

Every one of these was **false** when the system first worked end to end. A rig could be parked in a
public yard, driven through a street full of people, and flown over by a pilot, and none of them saw
anything at all. A vehicle nobody else can perceive is a private view, not a thing in the world.

**…and the road exists to other people too** *(2026-08-21)*. The last place this was still false was
the one that mattered most. `truckContactsNear` dropped every rig on the corridor — honestly, on the
grounds that *"the corridor is not in anybody's world window"* — and the cab returned no aircraft off
the city leg for the same reason. So the empty waste between regions, the one stretch where passing
another human being is an event, was the only place in the game with no traffic in it at all.

The corridor has been anchored in real world coordinates since the frame change, so that reason had
already expired. [`roadnet.js`](../plugins/trucking/roadnet.js) builds the week's whole network from
the gates — nothing new is authored, and no geometry is invented: `networkRoute` already seeds the
middle on the sorted gate pair and reverses it for the other direction, so **one road per pair of
gates** is a fact about the existing builder rather than a rule this file imposes. Flight takes it as
a cell provider through `registerCellOverlay`, and both halves of the traffic picture now use one
test (`inWorldFrame`): on the highway a driver and a pilot see each other, in the legacy local frame
neither does.

Three things worth knowing before touching it:

- ⚠ **Nearest centreline wins, and both simpler rules are wrong.** `corridorAt` answers for the whole
  band a road claims — carriageway, shoulder, and open filler out to `OFFROAD_R`, 24 tiles either
  side — so roads overlap in their *filler* long before their tarmac. *First answer wins* put a hole
  in the Scarletwastes highway wherever the Coldwater–Terminus road passed near it. *Carriageway
  beats verge* looks like the fix and is not, because `isCarriageway` is true of the **shoulder** as
  well as the tarmac — it picked one road's dirt margin over another road's highway. The rule is the
  one corridor.js already applies between segments of one route, one level up.
- **Roads genuinely share tarmac, by design.** Every road leaving a gate runs down the same spoke to
  its interchange, which is what makes the fork a place. About a third of tarmac tiles are claimed by
  more than one road; on those the pilot gets the nearest centreline, and what regress asserts is
  that it is still *road*, never air.
- **Direction-of-travel fields differ by direction, and always did.** `road_deg` is the heading as
  driven and `road_t` the offset to the right of it, so a road built from the far end reports both
  flipped — 9.3° vs 189.3° on the same tarmac. That is what two drivers passing each other have
  always seen; the renderer takes `road_deg` as an undirected line and both flips cancel. Compare
  them modulo 180 and by magnitude, or you will chase a bug that is not there. (I did.)

**Parked rigs are in the room.** `describeDepot` lists them off the `depot_zone` the `trucks` table
had carried since day one and nothing displayed — modelled on flight's `On the ramp:`, same shape,
same click-to-examine, because it is the same fact.

**You hear one go past.** `driveToZone` never went through `cmdMove`, so it never inherited the
engine's departure/arrival lines and a rig crossed a city tile in **total silence**. It now sends
rig-flavoured lines both ways — the room experiences the vehicle, not the person inside it — gated
on speed so parking and creeping into a bay don't spam a yard.

**A driver reads as a driver.** Added to `bodyTell`, which already owns the qualifier beside a
player's name, and expressed in **posture** — so it names no system and fixed `flying` for free. A
pilot sat on a ramp had exactly the same problem.

**Traffic runs both ways.**

| | how | rule |
| --- | --- | --- |
| Pilot sees trucks | `vehicle.contacts` gather hook | flight has never heard of trucking; it asks who else is out there and whatever answers, answers |
| Driver sees aircraft | `aircraftNearCoord`, which already existed for the yacht helm | one call, no new channel |

Only a **moving** rig is traffic — a parked one is scenery and belongs in the room description, or
it would sit in every pilot's contact list as a permanent blip. Mirrors flight's own `isGroundRolling`
rule for taxiing aircraft.

> **The renderer needed a truck.** `drawAircraftModel` is per-class and every class in
> `aircraft3d.js` has wings, so a truck relayed as a contact would have rendered as an aeroplane
> sliding along the road. `buildTruck()` is the first ground-vehicle mesh in the file: cab, sleeper
> hump, flat deck, a row of hover lifters, in the same normalised box the airframes use so
> `CONTACT_SIZE` scales it like anything else.

**The trucks ride on lifters, not wheels** *(2026-08-11)*. The first cut drew a wheel as a dark box
with a hub plate on it, which is a wheel with the roundness sanded off — the whole fleet read as a
20th-century semi somebody had forgotten to finish. A hover pod needs three things and all three:
it is **chamfered** (a wide housing over a drawn-in shroud, never a brick), **lit low** (an emitter
band round the skirt plus a bloom on the road under it — from any angle above the beltline that
bloom is the only part of the lift you can see), and it **hangs off an arm** with daylight above it.
The drive groups no longer draw a doubled pair: dual rims are an artefact of a tyre's contact patch
and a lifter has none, so a light rig gets one *long* pod and a heavy one gets two spaced along the
frame — the same "rated to pull" read without pretending there are tyres involved.

Same pass, the rest of the fleet's visual ladder: **headlamps moved outboard of the grille**
(they used to sit inside the grille surround's fore-aft slice, so the painter's sort showed one lamp
and ate the other — a one-eyed truck is the first thing anybody notices), cab-overs got a face
(radiator panel + vents, where the two cheapest trucks had a blank wall under the screen), the
tractor got a rear lamp cluster because **bobtail is a real way to drive** and that face is what
another driver looks at for an hour, and a bobtail now **carries something on its bare deck** —
a scrap cage on the Barrow, a strapped load on the hauler, nothing on the long-haul tractors, which
run clean because they are built to pull.

**Headlights are gated on gloom, not on night** *(2026-08-11)*. `paintWindshield`'s lamp throw used
to test `sky.night` alone, which is exactly backwards for a truck: the one time a driver reaches for
the headlights is midday fog, and the lamps stayed off in the only condition that made them matter.
The gate is now `max(night, wxGloom(wx))` off the same `WX_HAZE` scalar that decides how far you can
see. The cab passes `landingLight: true` unconditionally and there is deliberately **no switch on
the dash** — a rig runs lit, and the renderer decides when that is visible.

⚠ **…and until 2026-08-18 none of that could ever fire, because the cab was never told the time.**
`cabContext` carried the map, the traffic, the trailer, the fuel and the damage, and not one of
`hour` / `weather` / `moon` — so the client's `?? 12` / `'clear'` defaults stood in and **every haul
in the game was driven at high noon in clear air**. Nothing threw and nothing looked broken; the
world simply had no nights or weather in it from behind a wheel, and the gloom rule above, the
wipers, the rain on the glass and the whole night sky were all unreachable code. It is now one call
to the **same `skyState()` the cockpit uses**, so a driver and a pilot over their head can never
disagree about the time or the weather. The spatial weather **field** is deliberately left off — the
cab doesn't wire it, and a payload nothing reads is how a push gets expensive for nothing. Regress
asserts presence rather than a value, since absence was the entire failure mode.

**…and the first thing that weather did was rain indoors** *(2026-08-21)*. A haul **starts inside a
shed** — `drive` mounts you on the bay tile and you drive out of the building — so the very first
frame of a wet run was a full-screen curtain of rain falling through a roof and a windscreen beading
up under cover. The precip passes had no idea where the vehicle was; they only ever knew what the
sky was doing. **The cell under the wheels already answered it**: `mark === 'bay'` is put on a tile
by the world derivation *only* where content authored `flags.vehicle_bay` (five facades, and the one
hole in the truck collision model — see the drive verb), which makes it the game's existing
statement that *here is inside*. `paintWindshield` reads it off the centre of the map window exactly
as `deckLift` reads the yacht deck, so **nothing new goes on the wire** and the picture cannot
disagree with the geometry it is parked on. Two rules keep it honest. **It is the water only** — the
falling precip and the on-glass beads/frost stop; the sky, the gloom, the haze, the lightning and
the lamps are untouched, because it is still filthy out of the open door and a shed that turned the
weather off would be a bigger lie than the rain indoors was. (Which is why `roofed` is passed to
`drawGlass` as its own argument rather than folded into `wx` — handing that layer `'clear'` would
have taken the storm's flash with the rain.) And **not in the chase view**: `roofed` is a fact about
the truck's tile, and in the external orbit the camera is out in the yard in the wet, looking at the
shed. Trails already on the glass still fade and still wipe, so a rig that pulls in after a wet run
gets a *drying* windscreen rather than a dry one.

**Both light switches now exist, and they point in opposite directions** *(2026-08-19)*. The
paragraph above is superseded on its last clause: the headlights got a **latching `LAMPS` rocker**
(key `L`, default ON, carried on the telemetry packet's lamp bitfield so other drivers see your
actual lamps), because the renderer deciding for you meant there was no way to drive dark and no way
to forget your lights. The gloom gate is unchanged — it is now what the *default* is, not what the
truth is.

The second switch is the **dome lamp** (`CAB`, key `I`, default ON, `dome` on the frame options).
It lights the inside and nothing else, and unlike the headlights it never leaves the client — nobody
outside the cab can see it, so there is no packet field and no column. Three rules:

- **The panel lamps are a separate circuit, and switching the cab light off winds them UP.** That is
  the whole feature. A dial sitting at its daylight backlight in a black cab reads flat, because the
  eye judges an instrument against what is around it — so `glowK` (the one entry on the trim row
  that is not a colour) scales the dial's own backlight and adds a soft spill *outside* the bezel
  onto the plate. It is carried on `T`, which every dial already receives, rather than as a
  thirteenth positional argument to `drawCabDial`.
- **The flood over the vinyl is wound DOWN, never off.** The dash wash IS the interior light
  spilling onto the board, so with the lamp off it has no source — but a real cab at night is still
  lit by its instruments and by what the headlights throw back off the bonnet, and you can find the
  park brake by shape. Dark, never blind.
- **Absent means ON.** `v.dome !== false`, so the depot turntable, the shape smoke and any older
  caller render exactly the cab they always did. `interiorRenderSmoke` has a `cab:dark` case
  because dome-off is a genuine second branch (no roof lozenges, no shell wash, the wound-up
  backlight), not a dimmer setting.

---

## The market — two ways to earn

**`haul` is wages. `market` is enterprise.** A contract pays a fixed fee to move somebody else's
box; the market is your own capital on your own guess, and it is the only place in the system where
you can finish a run poorer than you started it. That gradient is the ladder: contracts fund the
first trailer-load, and trading beats contracts once you can afford to fill one.

**Prices are derived, never stored.** A price is a pure function of `(commodity, region, game-day)`
— no table, no tick, no DB row, and no way for a restart to reroll the market under somebody
mid-run. Same discipline as the freight board and as `zone-filth`'s stateless cadence: a market
that ticks is a market that needs persistence, a scheduler, and a story about what happens while
nobody is logged in.

| Good | kg | Runs | Full load costs | Clears |
| --- | --- | --- | --- | --- |
| potable water | 100 | out | ~860₵ | ~280₵ |
| baled alloy | 90 | **back** | ~1,090₵ | ~340₵ |
| protein slurry | 60 | out | ~2,780₵ | ~440₵ |
| industrial chems | 55 | **back** | ~5,160₵ | ~1,580₵ |
| machine parts | 50 | out | ~6,920₵ | ~2,740₵ |
| medical stock | 35 | out | ~19,500₵ | ~4,400₵ |

> **The regional multipliers are deliberately uniform** — about 0.78 producing, 1.28 consuming, for
> every commodity. That is not laziness, it is the balance: it holds RETURN near a constant ~30% and
> leaves CAPITAL as the only thing separating the goods, so the table above is a ladder you climb
> rather than a lookup you memorise.
>
> The first cut tuned spreads "by character", from 0.60 to 1.85. It produced a market where medical
> stock returned **10,500₵ a load against 731₵** for the best backhaul, and where potable water —
> picked to be the cheap boring one — returned 150%, because it was dirt in Coldwater and gold in
> the Reach. **Wide spreads read as flavour and play as a single correct answer.** A regress case
> now asserts no commodity returns more than 75% and none less than 2%.

**Every good runs exactly one way**, which is what makes the backhaul real: Coldwater makes things
and sits on a basin (water, protein, parts, medical go out); the Reach is a salvage economy with a
chemistry problem (baled alloy and industrial chems come back). An empty return trip is a mistake
you can make, not a shape the game forces on you. A regress case asserts no good pays both ways
(free money) or neither (dead weight on the board).

**The spread is what makes the road matter.** A depot buys off you for 12% under mid and sells at
12% over, so buying and selling on the spot always loses — the only way to profit is to be
somewhere else.

**You learn the map by driving it.** Reading a board writes it to one `truck_markets` player flag,
and every board you read afterwards shows the spread against the last one you saw, with its age in
days. A market you have not visited is one you do not know. That is the whole telex.

---

## How a player finds it

**A system nobody can find is a system nobody has.** Before this was wired, the only route into the
whole of THE LONG HAUL was typing `drive` blind while standing on one of three specific street
tiles — no prose mentioned it, no furniture offered it, and `help` is **hand-maintained**
(`HELP_GROUPS`, a literal array in `server/engine/commands/world.js`) so a plugin verb never appears
there on its own.

Three routes in, all asserted by the regress suite:

1. **The yard says what it is.** A `zone.describeRoom` hook — the same seam voidwalking's rim
   warning uses — adds a line to any `truck_depot` tile, with `teachVerb` shimmers on `drive`,
   `haul` and `market` so they are click-to-run links rather than words to notice and retype.
2. **A dispatcher.** *Rennie Vasch* sits at Kessler Street Yard with a `first`/`text`/`known`/
   `familiar`/`close` greeting ladder. She explains the two kinds of work (wages vs enterprise),
   where the road goes, and what it costs you to find out a wall is a wall at fifty.
3. **The help book** gained a `HAULING` row.

> **Author's note:** the dialogue tree is **flat and rooted at `root`** — `tree[nodeKey]`, options
> carrying `next`, `label` for the choice text. Not `{ nodes, edges }`, despite the VINE editor's
> own graph format.

---

## Display Mode — both axes

The system spans **both** rungs of `systems-display-mode.md`, and gets them from different sides:

| Surface | Axis | Why | Fallback |
| --- | --- | --- | --- |
| The cab | `prefersTextMinigames` | Delete it and the player is **stuck** — they cannot make the run at all | `textdrive.js`: the server runs the same `stepTruck` and the same transitions on a 2s clock |
| Board + exchange | `prefersLoggedPanels` | Delete it and you only have to remember numbers | The text `market`/`haul` output, which is the authoritative record |

**The text drive is assisted, and more so than flight's.** A text pilot sets intent (`climb to
3000`) because an aircraft has somewhere to be in three dimensions; a truck on a road does not — the
route *is* the road, so hand-steering a corridor by typed command would be busywork dressed as
agency. The rig drives itself over `findPath`'s roads-only mode and the player's decisions stay the
ones that were always real: which load, when to stop, when to fuel, and what to do about whatever
just walked out of the haze.

**Every transition is the shared one.** `textdrive.js` owns narration and a clock, nothing else —
node crossings go through `crossToNode`, city tiles through `driveToZone`, the rim and arrival
through the same functions the graphical cab uses. If that stops being true, the two rungs have
become two games.

**The depot is ONE panel, and it opens when you walk in.** Fleet, dealer, freight board and exchange
on four tabs of one screen — `yard` and `market` are two questions about one *place*, and answering
them on two screens made a player compare panels to decide one thing. It auto-opens on
`zone.entered` at a `truck_depot` and closes when you leave, exactly as flight's hangar bay does;
the verbs survive as the deliberate way in, walking through the gate is the discovered one. Skipped
while driving, so rolling through a yard doesn't throw a shop window over the windscreen.

**The panel is a skin, not a second implementation.** It renders the identical payload the log
rung reads as prose, computes nothing (no prices, no profit, no affordability — a client that works
out what a thing is worth can be wrong about it in a way the server never hears), and every button
fires an ordinary verb string a player could have typed. Shape borrowed from the **cards machine**
rather than the hangar bay: the verb *returns* the payload instead of pushing it, so there is no
race against a player who drove off mid-await.

**And it is now the whole application, not a table** *(2026-08-11)*. The depot was a 250-line modal
with three numbers per truck while the hangar it was modelled on was a full-screen app with a 3-D
floor, a walkaround camera, a dealer's lot and a mechanic's bench — and that gap *was* the
difference between owning an aircraft and owning a truck. It is the same application now, and
almost none of it is new code:

| screen | drawn by |
|---|---|
| the garage floor — every rig you own in one room, one camera, click-selected | `drawHangarScene` (`aircraft3d.js`), `venue: 'garage'` |
| the room it all stands in | `drawDepotBackdrop` — the depot's own building, not the hangar |
| the walkaround — turntable, or the eye on the concrete beside it | `drawHangarFloorBay` with a free camera |
| the dealer's line | `drawWireframe3D`, big enough to read the thing you are buying |
| the bench hero shot | the same floor bay, with the dials underneath |

**…and it is now the same DEVICE, in the same place** *(2026-08-12)*. The screens matched; nothing
else did. Four things, and each one is a rule rather than a tweak:

- **It mounts in `#area-pane`, like the hangar and the cockpit** — not as a fixed overlay dimming
  the game behind it. Every button here is a command and the **log is where its reply lands**, so a
  modal hid the other half of its own interaction. It carries the same ⊟/⛶ immersive toggles, which
  are added to the *existing* `body.hb-*` selector lists in `styles.css` rather than given a third
  copy to drift out of sync with, and Escape now backs out one screen at a time. `setAreaPane`
  rebuilds the subtree, so the delegated handlers are re-bound per render on a node that is always
  brand new — which is why they cannot stack up. This also finally wired **`isTruckDepotWalkActive`**
  into `main.js`/`input.js`: `preventDefault` does not stop propagation, so holding W to walk down
  your own truck's flank was also sending you north, and the overlay had been hiding it.
- **It follows the player's theme.** The hangar's every surface is the theme's accent at a different
  intensity over the theme's own bg tiers (the tablet's `--tos-*` bevel recipe); the depot was a
  hardcoded `#0e1114` slab. On a light theme one read light and the other stayed a black box. Same
  palette now, aliased to `--td-*`. The exceptions are deliberate and the hangar's: **condition
  bands stay fixed hex** (green→red cannot follow a theme) and **the viewports stay dark glass**,
  because a real screen does not relight for your wallpaper.
- **A truck in the walkaround is showroom-sized and ON THE GROUND** — one derivation, not two
  fixes. `FLOOR_Z = −0.27` is an *aeroplane's* ground plane and a parked rig's lifters rest at
  z≈0, so it floated a full truck-height; built at ±0.22, it was also a die-cast model in an
  aircraft shed. `paintTurntable`'s new **`fit`** scales the mesh so its longest span reads an
  airframe's and then drops it until its own lowest vertex sits exactly on the floor. Callers that
  pass no `fit` are untouched to the pixel, and the room comes out correctly proportioned for free.
  Every camera constant on that screen (the start eye, the exclusion ellipse, the BOARD radius —
  which was **2.6**, and was the real reason you could never get close) is now in honest units.
- **Lighting the lifters.** `drive` is the *end* of a sequence rather than the whole of it:
  contactor, coils, the weight coming off, the settle. **The sound is the clock** —
  `hoverSpoolSeconds` feeds the visuals from the same per-truck table that scores them, so the rise
  cannot drift out of sync with the noise it is making. **The ride height is real** (the mesh's own
  `HOVER`, overshooting once), light comes up *before* movement so it reads as the cause, and the
  shake is on the **camera**, because what actually moves is you. It still sends the identical verb.

**Taking a load has to be visible on the screen you took it from** *(2026-08-21)*. `haul` wrote a
line into the log and re-pushed the panel, and the board **redrew identically** — same four rows,
same live Take it on every one of them — so the only evidence that anything had happened was in the
scrollback, which is the half of the screen a player deep in a pane app is not reading. Worse, the
buttons that stayed live were now buttons the verb was certain to refuse: they are gated on
`canLoad`, which asks *is there a box standing here* and never *is the box empty*. That is the
toolbar rule (a button that is present and refuses is worse than one that is absent and explains
itself) being broken by the one screen that displays the most refusable verb in the system.

Three parts, and each is a fact the server already had:

- **Both boards state the deck.** `deckStrip()` prints what is on the truck above the freight board
  *and* above the exchange — the same read-out the Yard screen carries, in the place where it
  answers the question the buttons under it are about to be asked. It replaces the exchange's old
  "Your deck holds N kg" footnote, which said the capacity and never the contents.
- **Every load button carries the reason it is dim.** One `loadBlock()` for both boards, because
  `haul` and `market buy` refuse for exactly the same reasons, in the verb's own words. The row you
  are **already carrying** says `✔ On the deck` instead of offering itself again — matched on the
  new `cargo.slot` (the board row the contract came off, which travels with the load because the
  load is a copy of the job) **and** on its name and destination, since ⚠ a board index means
  something different at every yard. The same rule reaches the list-dialog rung: a full deck takes
  the Haul and Buy commands off those rows, exactly as unaffordable stock already has no Buy.
- **And the panel says so out loud.** A transient notice over the body when the deck CHANGES. This
  does not break rule 3 (the panel never guesses what changed): the deck is a fact on the payload
  and the only thing derived is that it differs from the previous push, which is why it is also
  correct for `market buy` and `market sell` with nothing written for either. ⚠ It is deliberately
  **not** a live region — the same words already reached `#output`, which is one, and announcing
  them twice in two voices is worse than not announcing them here at all; the accessible half of
  this change is the `disabled` on the buttons, which needs no ARIA.

⚠ And `setDeckCargo` now re-pushes onto **the tab the click came from**. It always said `freight`,
which is right for `haul` and wrong for `market buy` — buying on the Exchange threw the panel onto
the freight board, so the one screen that could have shown you the goods you had just bought was the
screen the purchase navigated away from. ⚠ Related: `.td-body` is a flex **row**, so every top-level
node a screen returns becomes a column of its own; both boards are wrapped in `.td-col` now, which
is also why the exchange's Sell button and footnote had been sitting to the *right* of its table.

**The cockpit nobody has ever seen** *(2026-08-12)*. `openCab` writes straight into `#area-content`
— the same element `setAreaPane` overwrites — and **the cab was never on `paneFreeForRoom()`'s
list** (`dispatch.js`), the one line that tells a room description to keep its hands off the pane.
So the windshield mounted and the very next room render destroyed it, every single time. And `drive`
*causes* one: it pulls you out of the shed onto the apron, which is a move, which paints the room.
It was never a rendering bug — the whole driving view existed and was being deleted milliseconds
after it appeared. The depot joins the list for the same reason now that it lives in the pane, and
because both are pane owners, `truck_sim` hands the pane over explicitly (`closeTruckDepot()` first,
or the depot's DOM is torn out while `isTruckDepotActive()` still answers true — and that flag is
now what suppresses the room, so the room would never have painted again). `truck_depot_close`
re-looks on the way out exactly as `hangar_close` does, skipped when the cab has taken over, because
then you did not walk out, you drove.

**The cab nobody had seen either, for a second reason** *(2026-08-12)*. With the pane fixed, `drive`
*still* left you mounted on a road tile with no windscreen and no error anywhere. The mount payload
was built as `{ type: 'truck_sim', ...cabContext(rig, { mounted: true }) }` — and **`cabContext`
carries its own `type: 'truck_ctx'`**, because it is also the per-tick push. The spread came after
the type and overwrote it. So the message arrived as an ordinary context update, the client's
`truck_ctx` handler returned on its first line (`if (!st) return` — no cab was open), and nothing
threw. **The type goes after the spread**, at both mount sites. The regress case that pins it
captures the real pushes at the turn of the key rather than reading the return value, because the
windscreen is a push and the prose beside it is not: nothing about the returned message was ever
wrong.

**Out through the roller door** *(2026-08-12)*. A haul starts inside a building and **the truck
cannot** — a bay is a building, buildings are solid and carry no grid coordinates, and a rig needs a
tile with a surface under it. So the server has always walked you out to the apron first, and the
run therefore never *began*; it was simply already happening, one frame a shop window and the next
frame a road. **The shed is now drawn in the CAB, not in the world**: an interior, a slatted steel
door and a bar of daylight, laid over the windscreen inside `.ws-wrap` while the real render paints
the yard underneath the whole time. The door goes up and what widens under it is the actual road you
are about to drive on — which is why the light spilling in matches the hour and the weather without
being told either. Nothing was added to the world model: no interior tile, no second camera, no
geometry, nothing to keep in sync.

Three things worth knowing before touching it. **`fromBay` is the only fact the client cannot
derive** (whether you turned the key indoors), and the server must not compute it from `bay` alone —
that flag only means *this tile carries the depot flag*, which the legacy shape puts straight on a
piece of hardstand, so a yard with no shed satisfies it. The discriminator is `fromShed`: that the
truck had to be walked out of somewhere. **The throttle is dead for the first ~2.1s**, not because
anything would stop you (there is no door in the physics, there is no door anywhere but on the
glass) but because a driver who pulls away through a closed shutter has been told the picture is a
lie, and every frame after that is cheaper for it. And **motion-off turns the whole thing off** — it
is two and a half seconds of a large object crossing the entire view, which is precisely what that
setting exists for; the log still says the door went up, at every rung.

**A hover is a condition, not an animation** *(2026-08-12)*. The start-up sequence cleared its own
state when the clock ran out, so the mesh fell back to `~p` and **the rig sat back down on a running
engine**. The sequence now hands over to a RUNNING state (`B.lit`) that holds the ride height, keeps
the emitter bands lit and never stops moving: two detuned sines for the bob so it does not repeat on
a count you can hear, a slow roll about the long axis (`idleRoll`, a real rotation about the model's
centre — lift one end without dropping the other and the illusion dies), looping dust, and a
shimmer on the contact patch. The idle is **cross-faded in over the back third** rather than switched
to at `p === 1`, because a hard hand-over lands the bob wherever its sine happened to be, which is a
visible twitch at the exact moment the machine is supposed to have settled. `enginePhase` answers
for both states in one shape, so the draw path cannot tell them apart and cannot drop a frame back
onto the parked pose. On the floor a lit rig is drawn running among the ones that are not.

**Paint that paints something** *(2026-08-12)*. The depot offered four flashes, wrote the chosen one
to the database, read it back, and rendered it identically every time — `flash` **was never passed
to the renderer at all**, and would not have worked if it had been: `faceWearsTrim`'s patterns are
written for an airframe, whose hull is centred on `h = 0` so a beltline is a sign test. A truck is
built standing ON the ground (`h ∈ [0, 0.28]`), every face reads as "spine", and every aircraft
pattern paints a truck one flat colour. The flashes are now their own branch in the truck's own
frame under a **`truck:` prefix**, so the fleet's `stripe` and the airframes' `stripes` can never be
confused. **And it previews**: the bench drew the SERVER's paint, so the only way to find out what
teal looked like was to buy teal. It reads the pending edit now — and, like the tune slider, does
**not** re-render on `input`, because rebuilding the DOM under a live native colour picker closes it
on the first pixel of movement.

**The whole truck is paintable, and the booth is four screens** *(2026-08-18)*. A player could paint
a rig black and it still had a **white spear down the flank and a blue strip under the glass** —
those were `CHROME` and a literal `[96,196,214]` in `buildTruck`, arrays no paint job could reach. A
colour the booth cannot sell is a colour the booth is refusing to sell, on the one possession in
this game a driver owns outright. Paint is now **seven colours**: the four that existed plus
`bright` (brightwork), `glow` (the decorative running lights — the beltline strip and the roof
scanner) and `glass` (the tint in the panes). Three decisions carry it:

- **A facet carries a PAINT KEY, not a lookup table.** `buildTruck` stamps `pk` on any face drawn in
  its own `CHROME`/`ACCENT` arrays — **by identity, not by value**, so a lamp lens that happens to
  land on the same rgb is never mistaken for chrome, and a new bit of brightwork is paintable the
  moment it is drawn in `CHROME` with no list to keep in step. `faceBaseRgb` reads the key off the
  palette with the array itself as the fallback, so **every aircraft facet takes the path it always
  took** and the defaults are the mesh's own literals to the byte (regress asserts all three).
- **`chrome` finally does something.** It has been stored, sent to the renderer and read by nothing
  at all for months — the tickbox changed no pixel on any truck. It now decides whether brightwork
  takes `bright` or falls back to the **hardware** colour, which is the blacked-out rig the
  `nightrun` scheme was already asking for and never got.
- **Glass is SCALED, never flooded.** Every pane is authored as a shade of the door glass, so a
  retint divides by that reference and multiplies by the chosen colour: the windscreen stays lighter
  than the sleeper porthole, and the default is the exact identity.

⚠ **The lifter emitter bands are deliberately NOT paintable.** They are the propulsion showing — the
same fact the road wash under them is drawn from — and a truck whose thrust you could paint pink is
a truck whose thrust is jewellery.

**Every scheme is now the whole truck** (regress fails a preset that leaves a colour unnamed), and
the tab that sells all this is **four short screens** behind a segmented control — Schemes, Paint,
Graphics, Inside — because seven colours, fifteen jobs, eight coats, eleven pictures, four materials
and seven interiors as one scroll is a wall nobody reads to the bottom of. ⚠ **The line between two
of those screens is "is it paint", not "is it a colour well"** *(2026-08-18)*: the paint job and the
finish coat sat under Graphics because they are LISTS rather than pickers, which is a fact about the
widget and not about the thing being bought. Both are paint — a flash is a second colour laid over
the cab, a coat is what goes on top of the lot — so somebody looking for "the wave one" opened Paint
and found seven colour wells. Paint is the whole respray now; **Graphics is what is *printed* on the
truck**, which is one row and is honest about being one row. **The interior is on it
for the first time**: `rig trim` was a verb that printed a swatch book of seven words, so the only
way to find out what oxblood and chrome looked like was to buy it. It previews now — a CSS still of
the dash in the colourway's own gradient, the material's grain, and two lit dials in its needle and
glow colour, which is the part of a colourway you actually live with. It stays a **separate
purchase** (own button, own price) because it is a different job at a different bench.

Two things the same pass fixed because they were the same bug in different clothes:

- **The paint job never reached the cab at all.** `flash` → `pattern` is one word of translation and
  it lived only in the depot panel, so the cab handed its raw paint straight through, `pat` came out
  `'bare'`, and every flash in the catalogue rendered as one flat colour **on the truck you are
  actually driving**. It is one exported `truckLivery()` now, called by both.
- **Door art was printed over the trim.** The decal rectangle was the door's outline *plus a bit*:
  forward of the B-post is the quarter light, the chrome spear crosses at `S.hi × 0.36…0.40` and the
  beltline strip at `× 0.47…0.505`, so the picture came out with a chrome bar through it. It is now
  the panel the brightwork LEAVES, and every bound is stated against the thing it clears rather than
  as a tuned number — **if you move the spear, move the door.**

⚠ **AND THE DECAL RIDES `modelV`, LIKE EVERY OTHER VERTEX** *(2026-08-18)*. On the bench and the
walkaround the art was drawn through the WORLD projector rather than the model one — one transform
short. Every aircraft view survived that (no aircraft caller passes `fit`, so the transform is the
identity), and the depot did not: it scales the rig to fill the room and then drops it onto the
floor, so the art was painted at a quarter size, at the wrong height, **buried inside the chassis**.
It rendered every frame and never once landed on the door, which is why picking a design in the
booth appeared to do nothing at all. `shapes:smoke` now gates it — see
[scripts/shapes/truck-doorart.mjs](../scripts/shapes/truck-doorart.mjs), which draws the same rig
fitted and unfitted and asserts that **whatever the fit does to the silhouette it does to the
decal**; a decal that ignores the fit scores 0.16–0.19 where a healthy one scores 1.00–1.33. It
measures a ratio rather than a position on purpose: a check that re-derived the transform would
agree with a bug in the transform.

⚠ **AND A DECAL MAY NOT VANISH BEFORE THE PANEL IT IS PRINTED ON** *(2026-08-18)*. The second half
of the same report — *"decals disappear once you zoom in past a certain point"* — and a different
cause. Both painters carried a near plane of their own (`0.18`) that was **stricter than the one the
model is culled at**: `0.15` on the bench, and `0.07` in TILE units out on the road, where a rig you
had pulled alongside lost the picture off its door a fifth of a tile out while the door was still
solid in front of you. The artwork switched itself off exactly as you got close enough to read it.
So the painters take the near plane **from their caller** now (`MODEL_NEAR_Z` in aircraft3d.js,
`CONTACT_NEAR_F` in windshield.js) rather than owning one.

That left one step of gap, and it was the decal standing **proud of the skin**. `drawNoseArt` pushes
its art out by 3.5% because it is wrapping a CURVE and the grid's chords would otherwise sink into
the hull between vertices. A door is flat, and nothing on this path is depth-tested — the art is
painted after every face — so the overhang bought nothing and cost the only thing that showed:
standing proud makes the decal **nearer than its own panel**, so it crosses the near plane first.
It is `1.004` now: enough to stay off the surface, and no more. The walk-up is gated in
[scripts/shapes/truck-doorart.mjs](../scripts/shapes/truck-doorart.mjs), which walks a camera in
along the door's own normal and asserts there is **no standoff at which the truck is still being
painted in quantity and the decal is not** — a face count as the yardstick rather than a distance,
so the threshold moves with the fit transform instead of going quietly green when it changes.


**The horn works** *(2026-08-12)*. Two chrome trumpets were added to every roof, plus cab steps
under the door (the walkaround ends in CLIMB IN and there was nothing there to climb). A horn you
cannot sound is an ornament, so `horn` / `honk` is a real verb: **the room hears it, not you** —
that is the entire point, and the only reason it is a verb rather than a keypress. It works behind
the wheel (H, or the button beside the wipers) and standing in a yard beside a parked rig. The sound
is a **chord, not a note** — a minor third for the big rigs, a wider fourth for the Courier, which
has less pipe — because what you actually hear across a valley is the beat between two trumpets.

**Half a grille, and the rule that keeps eating this one square foot** *(2026-08-12)*. The comb of
chrome teeth started 0.002 *behind* the grille surround's own front face. A face gets **one depth**
in the painter's sort, so a panel whose plane falls inside a detail's fore-aft span is nearer than
half those details and farther than the other half — under any yaw it is drawn over one side and
not the other. That is why the report is always *"one lamp"* or *"where's the other half of the
grille"* and never *"it's gone"*: a symmetric mesh, drawn asymmetrically, which is the shape of bug
a screenshot is worst at attributing. This is now the **third** instance on the same square foot
(two headlamp versions, then the comb), so it is written down as a rule —

> **Nothing on the face may share a fore-aft slice with the panel behind it.**

— and gated: `truckNoseSliceSmoke` (`scripts/shapes/truck-lamps.mjs`) asserts it on the mesh rather
than trying to recognise a comb of chrome in a recorded canvas, which is cheap, exact, and cannot be
flattered by a camera angle. It immediately found a **fourth** instance nobody was looking for: each
headlamp's chrome brow straddled its own pod's front plane. Note it does **not** assert that chrome
exists — a cab-over (the Barrow) has no bonnet, so no comb and no bullet, and that is the shape it
is meant to be. The floating name under each rig went at the same time: the hangar labels aircraft
because a row of white airframes is genuinely hard to tell apart, but a yard is not that — the rig
wears the paint *you* chose, the strip names every one of them and the pane names the selected one.

**The depot is not the hangar with an oil stain on it** *(2026-08-11)*. It was, briefly — one brown
tint and a wider door over `drawHangarBackdrop`, which is a reasonable saving right until you look
at it: an aircraft hangar's fluorescent truss hung exactly where a rig's stacks go, aviation crates
sat on the floor, and the concrete had a polish no yard has ever had. What separates the two
buildings is the work done in them, so `drawDepotBackdrop` is its own painter: **sodium wall floods,
nothing hanging** (the tallest thing in the room is thirteen feet of exhaust), an **inspection pit**
in the floor (the one feature every depot has and no hangar does), **numbered bays** instead of a
single lane, a roller shutter rolled up onto its drum rather than a hangar door, and a stack of
spare **lifter pods** where the hangar keeps crates. It still shares `drawOutsideWorld` and the
hazard stripe, because the weather beyond the door and the paint on the floor really are the same
thing in both buildings. The bench hero draws through the same painter — it used to show the hangar
whatever venue it was handed, so a rig on the bench was parked in an aircraft shed one tab away from
its own depot.

The only change the renderer needed was letting a scene entry carry a **`variant`**, because which
of the four trucks a thing is does not fit in `cls` (which the whole renderer switches on) or
`armed` (which means something else). Click-selection hit-tests the scene's own returned regions —
there is no DOM element per truck to hang a listener on.

> **Re-push after every mutation.** This is the fix for the oldest complaint about this screen:
> **buying a truck worked and looked as though it had not.** `yardBuy` charged you, wrote the row and
> returned a line of prose, while the panel over the top of it still showed the same dealer card with
> the same Buy button, an empty fleet tab and a stale balance. The hangar has never had that problem
> because every one of its bench commands ends in `pushHangarBay`. Nothing in this plugin may end in
> a bare `say()` if it changed the world — `repush()` exists for exactly that, and the panel never
> guesses locally what changed.

---

## Depots, cargo, fuel

A **depot** is any zone carrying `flags.truck_depot` — content decides, the plugin only reads.
`drive` issues a rig there, `haul` shows the load board, and a delivery pays only when the truck is
standing in the depot the load names.

### A depot is three tiles, and the set has to say so *(2026-08-18)*

`depotZonesOf` named **two**: the tile you handed it, and the depot's own `yard`. From inside the
bay that happens to be [bay, apron] and everything worked. From the **apron** it was [apron, apron] —
the bay missing entirely — and `park` stores a rig in the *bay*, because a truck belongs under the
roof rather than on a public street. So parking at a yard and then trying to drive off the hardstand
answered *"Your Ostrek Courier is parked at Kessler Street Yard, not here"* while you stood in
Kessler Street Yard looking at it.

The set is now the whole **place** whichever of its tiles you hand it — the shed, its facade (the
door tile a driver mounts on, which `yardIndex` has resolved to its depot since the walk-in
rebuild) and the hardstand. Ownership, the bench, the pump and the horn all ask through this one
function, so they agree for free. Regress asserts it **from all three tiles**, because the bug was
only ever visible from one.

The same off-by-one tile closed the panel: walking out fired `truck_depot_close` only when the zone
you left was the *bay*, so leaving from the apron left the shop window hanging over the road. It
asks `depotFrom` now — and only closes when you have actually left the place, since stepping from
the bay to its own apron is walking about inside one depot.

### A depot is a building you walk into *(2026-08-11)*

The depot flag used to live on the **street**, and the whole shop — the dealer's line, the freight
board, the commodities exchange — bloomed over the road because you crossed a particular kerb.
Nothing else in the game does that: a shop is somewhere you go inside, and the hangar this entire
system was modelled on has been a walk-in interior since the day it was written.

So `flags.truck_depot` now belongs on an **interior zone behind a facade**, and it carries one more
key:

```json
"truck_depot": { "name": "The Roadhead Depot", "yard": "zone_terminus_1202_940" }
```

`yard` is the **hardstand outside the roller door** — a real, drivable street tile with grid
coordinates. It is the one fact the bay cannot derive, because a building tile is *solid* (buildings
are solid; that rule did not change) and a truck cannot be mounted on a zone with no road under it.

Everything else falls out of that pair, and it is why the change stayed small:

| question | answered by |
|---|---|
| where does the panel open? | the **bay** — `zone.entered` on the tile carrying the flag |
| where is my truck parked? | **either** — `truckAt` takes the pair, so the bay and its apron are one place |
| where does `drive` put me? | the **yard** — the rig is mounted on the apron and `driveToZone` walks you out with it |
| where does `park` store it? | the **bay** — you stop on the apron, but the truck belongs indoors |
| where does a freight board send me? | the **yard** — `allDepots()` resolves every bay to its apron, which is why nothing downstream of it needed changing |

The apron carries `flags.truck_yard` (the yard's spoken name) purely so the street can say there is
a depot through that door. The **truth** about which tile a depot uses lives in the depot's own
`yard` key, never there — so a mismatch between the two is a missing sentence, never a broken door.

Live depots: **Kessler Street Yard** (Coldwater, inside Bonded & Bothered, apron on Kessler Street),
**The Roadhead Depot** (Terminus, inside Last Requisition — a shed that had been standing there with
a painted-on door and no way in, promoted rather than replaced), and **The Last Load** (The Reach,
a new shed on the hardpan east of the freight yard; `lawless: true`, and that gradient is what the
weigh station hangs off). Dray Lane keeps its pump and its apron and lost its shop — the Yards block
is built out on every side, so there was no tile to put a second building on.

`truck_depot` is a real `building_type`: it has a minimap glyph (`BUILDING_TYPE_ICON` in
`scripts/content/derive.mjs`) and a 3-D model in `drawTypeModel` — a clear-span shed whose read from
the air is **door size**, since everything else on the block has a door for a person and this one
has a door for a truck.

The board is seeded per `(depot, game-day)`, so it reads the same for everyone that day and does not
reroll when you look twice. Loads bound across the waste pay **2.6×** — the risk is real, and an
in-town run has to stay the safe, boring option. Fuel burns on **distance, never on the clock**, so
an idling truck at a depot doesn't drain its tank while you read the board (the same rule the
durability system uses for wear). A full tank is ~1400 tiles: a bit under two crossings, so a
one-way run never strands you but the return leg is a decision.

---

## The bench — condition, tuning, kits, paint *(2026-08-11)*

The half of a truck that is not the drive, and the reason it exists: a rig you only ever drive is a
vehicle; a rig you repair, gear for the country you run, and paint is a possession. All of it lives
behind one verb, `rig`, with subcommands — because `repair`, `tune`, `modify` and `paintset` are
each already owned (by the engine's gear repair, by broadcast, and by flight), and a sixth claimant
on `repair` would be a dispatch-order puzzle for anybody standing in a hangar holding a broken coat.

**Condition** (`trucks.condition`, 1 → 0) is the rig's own HP bar and the single number the bench
exists to move. Five bands, the top two mechanically free — a truck that is merely *used* must not
be a chore, or every run ends at a bench instead of at a market. Wear accrues **on use, never on the
clock**, in RAM on the hot path, flushed home by the same coalesced `park` write that already
carried fuel and the odometer. Rough surfaces cost more of it, a hard turbo costs more of it, and
below `Tired` it compounds — which is what turns *I'll fix it next time* into a decision.

Two ways to fix one: your own hands (Fabrication-checked, cheap, botchable, and **capped at
Worked** — there is a limit to what gets done on a concrete floor) or the shop (dearer, certain).
A derelict argues before it starts, and that is deliberately a delay and a noise rather than a
refusal: a truck that will not start strands a player at a yard with their money tied up in it and
nothing to do, which is a punishment with no play in it.

**`effTruckParams` (`rig.js`) is the ONE place a tune, a kit or a worn engine becomes physics**, and
its output is the `p` object the client model already takes. So the bench cannot drift from the
drive — there is no second copy of the tuning maths in `cab-view.js`, and nothing for one to drift
from. It is also what fixed a much older bug: **the cab was hardcoded to `TYPES.hauler`**, so every
truck in the game drove exactly like the 3,400₵ Courier — same gears, same top speed, same brakes,
same turn-in — and buying your way up the fleet bought a price tag and a silhouette and nothing else.

> **A tune is a trade, never an upgrade.** Every knob gives with one hand and takes with the other,
> because a dial whose right answer is always `+1` is not a choice, it is a chore you do once per
> truck. Kits are the things you *buy* that are strictly better — and the best of them buys nothing
> but more room on the dials.

> **The surface invariant is enforced, not asserted.** `thrustMax × drive` must clear
> `rollFric × drag` on the verge, or the edge of the road stops being a law and becomes a wall. The
> first cut of `effTruckParams` claimed that in a comment and was wrong — a derelict, road-geared,
> soft-turbo Barrow came out at 2.07 against a rolling resistance of 3.52 and would have sat on the
> shoulder with the throttle buried and nothing on screen to explain it. There is now a floor, and
> regress checks the worst case the function can produce. Being slow is a consequence; being
> immobile is a bug.

### Trim — the inside of the paint job *(2026-08-17)*

`rig paint` is what other drivers see. **`rig trim`** is what *you* see, for twenty minutes at a
stretch, and it is the only thing on the bench bought purely for the person buying it. Bare, it
prints the swatch book and marks what is fitted; with a material and/or a colourway (order-free —
they cannot be confused for each other) it does the job for a flat fee. Four materials — pressed
steel, moulded plastic, stitched vinyl, book-matched veneer — and seven colourways, of which four
are the stock interiors and three the bench sells.

**⚠ SURFACE ONLY. THE LADDER IS INSTRUMENTS.** A retrim can put walnut and brass in a scrapyard
Barrow and it can **never** put a rev counter in one. `dials` / `band` / `lamps` stay on the fleet
tier row in `windshield.js` and are unreachable from the trim vocabulary. That split is the whole
point: what a cheap truck actually costs you is **information** — the Barrow has no tachometer, so
you drive it on the sound of it — and a cosmetic bench must not be able to file the ladder's teeth
down. The boundary is enforced twice on purpose: `sanitizeTrim` returns exactly two keys, and
`cabTrim` reads those two out of the override **by name** rather than spreading it, so a payload
carrying `dials: 2` is ignored rather than obeyed.

The vocabulary lives in [client/shared/cab-trim.js](../client/shared/cab-trim.js) — materials,
colourways, and `STOCK_TRIM` (what each tier left the factory in) — because **two sides read it and
neither should own it**: the renderer needs the colours, and the bench needs to know what is
buyable so it can refuse anything else. A list in each is a list that drifts, and the symptom would
be a trim a player paid for that the cab cannot draw. Same argument as `skyline-scale.js`; no
imports, no side effects. Regress asserts every buyable key has a full colour set and every stock
interior names keys that exist.

Storage is `trucks.custom_data.trim` — `{ mat, col, cust }`, all nullable, no schema change. It
rides the cab payload beside `paint`, and a truck that has never been to the bench sends `null` and
renders byte-for-byte what it always did.

#### Bonded & Bothered was a warehouse with a truck door in it *(2026-08-18)*

The corner came apart from the driver's seat: flat grey slabs, the signwriting lying on the tarmac,
and sky where the roof is. Nothing was broken in the model — the building was simply **the wrong
model**. `zone_district_922_907` carried `building_type: "warehouse"` while carrying a depot's
`truck_depot` flags, a depot's `vehicle_bay` and a depot's three floors; it was identical to the
other four depots in every respect except the one field that decides which arm of `drawTypeModel`
runs.

And the `warehouse` arm is a **solid box**. That is the exact failure the `truck_depot` arm was
rebuilt to fix and documents at length: a solid box seen from *within* has every face pointing away
from you, so the backface cull removes the whole building and the driver is left on a bare slab.
It was invisible to everything — the flags were all valid, the building rendered fine from the
road, and the fault only existed from inside a cab that had just pulled out of it.

⚠ **So `content:lint` now refuses a `vehicle_bay` on a model that is not a shell.** The list of
shell types is short and deliberately **not derived from the renderer** (lint cannot import the
client), so when you build a second drivable building model, add it to `SHELL_TYPES` in the same
commit. The rule is the general statement of the bug: *a building you drive into has to have an
inside.*

#### …and then twice the ceiling, a third less pull *(2026-08-18)*

A rig that winds up slowly and then holds a real road speed — which is what a heavy truck does.
`topSpeed × 2`, `thrustMax × 0.6`: twice the speed to reach on 60% of the authority, so the climb to
cruise is roughly **four times as long**. Three couplings come with it and none is optional:

- ⚠ **`rollFric × 0.6`.** The verge invariant is `thrustMax × drive > rollFric × drag`. Cut the
  thrust and leave the resistance and a truck **cannot leave tarmac** — regress catches it by name,
  and it caught this.
- ⚠ **`dragP` re-solved.** Terminal velocity is what actually limits these (the speed clamp is a
  backstop), so drag is solved to put terminal exactly *at* the new ceiling. The last few mph then
  take forever, which is the feel being asked for.
- ⚠ **`gears ÷ 2`, `engBrake × 2`.** Redline in a gear is `tileMph / ratio`, so the ladder has to
  come down or top gear's band sits under the new ceiling and the truck over-revs instead of
  reaching it. Engine braking is the one term that multiplies the ratio rather than dividing by it.

⚠ **And the dial is now inflated relative to the world.** `tileMph` did not move, so the needle reads
twice what it did for the same ground covered — **every hardcoded mph in a rule or a test now means
half what it used to**. `RECKLESS_MPH` doubled with it (22 was 42% of a Courier's top end; left
alone it would have been 21%, turning *"far too fast for a street"* into *"moving"*). And a bay
crawl is a **second**-gear job now, because the ladder came down and third is 16–26 mph — exactly
as it would be in a vehicle that tops at a hundred.

| rig | top | pull-away | terminal |
|---|---|---|---|
| Krell Barrow | 82 | 2.60 mph/s | 82 |
| Ostrek Courier | 104 | 3.91 mph/s | 104 |
| Vachon Drayman | 96 | 2.90 mph/s | 96 |
| Orlov Continental | 88 | 2.90 mph/s | 88 |

#### Half pace, same dial, same gearbox *(2026-08-18)*

The world went past too fast. `tps = speed / tileMph`, and a journey is a fixed number of tiles, so
**halving the pace doubles the haul** — there is no version of this that does not. The Reach
crossing goes from about thirteen minutes to about twenty-six, which is the trade that was chosen.

The uniform rescale this file already documents (×k on the speeds **including** `tileMph`)
deliberately leaves tiles-per-second alone — it moves the number under the needle and nothing else.
This is the other edit, and that note's own warning is its specification: *"Scaling topSpeed WITHOUT
tileMph is the version of this change that quietly adds 40% to every haul."*

⚠ **And the gear ladder doubles with `tileMph`, or the top half of the gearbox goes unreachable.**
Every place a ratio meets `tileMph` is a **quotient** — engine speed is `(mph / tileMph) × ratio`,
pulling power is `sqrt(ratio / topRatio)` — so doubling both leaves rpm, the shift points, the band
and the torque curve exactly where they were. The one term that is not a quotient is engine braking
(`ratio × engBrake`), so `engBrake` halves to hold it still. Every rig's top speed still sits inside
its **top** gear's band, which is the check that the ladder survived.

Nothing else moved: `topSpeed`, `thrustMax`, `brake`, `rollFric` and `dragP` are all in mph, so the
needle and the way it climbs are untouched. What changed is how much ground a mile an hour buys.
Turning is unaffected in shape — radius is `wheelbase / tan δ` and carries no speed term, so the
same corner takes the same tiles and twice the seconds.

#### The rig bends at the pin *(2026-08-18)*

**A semi is not a long vehicle.** It is a tractor and a box that share one point, and the only free
variable between them is the angle about that point. The physics has modelled that since phase 1
(`s.phi`), and the mirrors have drawn it at its true value all along — while the view out of the
window welded the two together and swung them as one. So a jackknife could be happening on the
gauge, visible in the mirror, and invisible in front of you.

⚠ **AND IT IS ONE DRAW, NOT TWO.** The obvious build is a second `drawAircraftModel` for the box.
It is wrong, and wrong in a way a smoke that switches the depth blit off **cannot see**: each model
draw runs its own depth pass and blits its own rectangle, so the second paints over the first and
whichever half went down first simply vanishes. That shipped — as *"the trailer isn't spawned with
me even though it's hitched"* — while this file's gate was green, because with the blit off both
halves reached the canvas.

So the hinge lives in the per-face vertex pipeline that already tucks the gear, swings the cargo
visor and deflects the control surfaces. `face.deck` marks the trailer half (stamped in
`buildTruck`), and articulating is a rotation of those faces about the kingpin in the model's own
f/g plane — one model, one depth pass, and the shadow, the occlusion and the draw order inherit it
for free. `buildTruck`'s own comment called that split *"the seam where a future articulated draw
hangs its angle"*; this is that draw. A point one unit ahead of the pin in the TRAILER's frame is
`(cos φ, −sin φ)` in the tractor's, which is the whole derivation.

⚠ **The pin comes from the mesh, never from a constant.** Four rigs are four lengths, each laid out
from its nose and then slid back to centre, so the plate sits at a different station on every one
(−0.041 to +0.064). `TRUCK_META.pin` publishes that station in the centred frame; a guessed offset
articulates three of the four about a point in mid-air.

⚠ **And the box's own origin IS its pin**, so it needs no second offset — a dropped trailer is
already anchored there (`shift` centres a solo mesh on its front station, because the pose the
server stores for one is the coupling point). The two facts meet: put the box's origin on the
tractor's pin and the joint is exact rather than eyeballed.

⚠ **And the ABSOLUTE trailer heading travels, not the angle between.** `phi` is defined as
`heading - trailerHeading`, so a renderer handed the difference has to pick a sign to put it back
together with — and the wrong one makes the box **lead** the turn, which reads as the trailer
steering the truck. It did. The sim owns the absolute angle and now sends it, so nothing downstream
reconstructs it at all; the `heading - phi` fallback is kept only for a payload old enough not to
carry it.

⚠ **The box stops at the plate.** The first cut put its nose at `frame0 + 0.11`, forward of `cab0` —
the box began *inside* the back of the cab and the rig read as a trailer riding up over its own
tractor. A kingpin is at the BACK of the truck: the nose is the plate's own centre, the tractor's
rear axles run under the first few feet of the box, and the gap to the sleeper is the swing
clearance a real one turns in. With the nose on the pin the joint measures **0.1px** against the
welded rig rather than 1.9.

⚠ **Which half is painted first has to be ASKED.** From in front the tractor is nearer; from behind
the box is. A fixed order paints one straight through the other for half of every turn.

⚠ **The gate has two halves, because one observable cannot see both failures.** The geometry is read
with the blit OFF (with it on there are no polygons left to measure) — and the blit is exactly what
broke the two-model build, so a second pass counts **rasters** with it on: one model is one raster,
and two is the bug whatever the geometry says. The geometry half also keys off the BOX'S OWN PAINT
rather than the rig's silhouette, because swung one way the trailer stays inside the tractor's
outline and moves several feet for a tenth of a pixel of bounding box.

The gate is a comparison rather than a look ([truck-artic.mjs](../scripts/shapes/truck-artic.mjs)):
at **φ=0 the two-body rig must occupy the same silhouette as the welded one** — that is the whole
correctness statement, since at no angle an articulated rig *is* the rigid rig — and at φ=40 it must
not. All four land within **1.9px** of the weld and swing 7px+ by 40°. A joint that never moves is a
weld with extra steps, and that is the half which catches the angle being dropped in transit.

⚠ **Collision does not follow the fold, and does not need to.** The truck's obstruction probe
(`obstructionAhead` in cab-view.js) sweeps the rig's own POINT position against world buildings — it
has never used the trailer's geometry for anything — so articulating the draw desyncs nothing. Worth
stating because the opposite is the obvious worry: a box that visibly swings while a rigid hull
collides would be a jackknife that hits nothing.

#### A rig is a rig, and it stands in the shed *(2026-08-18)*

With the contacts finally reaching the glass, the boxes turned up **a seventh of their size, out on
the apron**. Two separate things, and the first is not the one it looks like.

⚠ **The exaggeration is per-VIEW, not per-object.** `CONTACT_SIZE.truck` is 0.030 and honest — from
an aircraft a rig SHOULD be a detail on the road — and the hero model multiplies it by **7** through
`ownExtMul`, because 0.030 of a tile is too small to frame against a four-lane road whose lane
markings are metres across. That argument is about the **road**, so it is just as true of a trailer
standing on it. Only the hero model got the multiplier, so a box parked beside your own cab drew at
a seventh of its size: the rig was not too big, the box was honest and alone. The cab applies
`ROAD_RIG_MUL` to truck-class contacts through **`sizeMul`**, which is the one field that reaches
the draw, the ground anchor and the occlusion size together — scaling the model and not the anchor
is a trailer hovering over the tarmac.

⚠ **And stock stands IN the shed now, in the bays the floor paints.** The slot geometry **is** those
markings, not an approximation of them: `drawVehicleBay` stripes the strip between the left wall and
the drive lane at `lx ∈ [-0.455, -0.15]` and `ly ∈ {-0.45, 0, +0.45}`, which is a bay centred at
`lx = -0.3025` and `ly = ±0.225`. ⚠ **Local `+lx` is the trailer's LEFT** — work `th = atan2(-E[0],
E[1])` through all four entrance faces and it lands on the direction opposite the heading's right
vector every time — so a bay at `-0.3025` is to the trailer's *right*, and getting that sign wrong
parks every box in the numbered tractor stalls on the other side of the lane. It did, once.

⚠ **And a parked box sits ACROSS the lane, not along it.** The bays run down one side of a drive
lane, so a box lying lengthways has its pin at one end of a forty-foot object with a wall behind it
— there is nowhere for a tractor to be when its fifth wheel is under that pin. Turned a quarter, the
body is backed into the bay against the wall and the nose is out over the lane, which is the
manoeuvre the lane exists for. Which quarter is not a choice: the bays are on the trailer's *right*
of the way out, so the middle of the room is to its left. `stockSlots` therefore runs two different
angles — the SPOT is laid out in the shed's frame, the BOX standing on it is turned to face the lane
— and running both off one angle is what parked a trailer somewhere it could never be coupled to.

⚠ **And the fifth wheel reaches under the box**, which is a fact about the two together rather than
about the plate. A tractor and a trailer that merely touch end to end are two vehicles in a queue; a
**semi** is one vehicle because the front of the box is carried ON that plate with the tractor's back
axles underneath it. The plate was 0.07 long and stopped 0.02 short of a box that began aft of the
whole chassis, so there was daylight between them from every angle — and nothing for an articulated
draw to pivot about, because the pivot is the middle of the plate and the box was nowhere near it.
The plate is 0.14 now and the box nose starts forward of its centre.

⚠ **And the frame behind the cab is DERIVED from the swing.** It was a flat `0.10`, which put the
kingpin `0.04` behind the cab — and because the box's nose sits on the pin, its front corners sweep
*forward* by `half-width × sin φ`. Half a width is ~0.18 on a Continental, so the corner reached the
sleeper at about **twelve degrees** of articulation: ordinary steering, and the trailer through the
back of the cab. `frameBack` derives the gap from that sweep, and it clears **at every angle rather than at a design
angle**: `reach = noseHalf · sin φ` peaks at 90°, so a gap of one nose half-width covers the whole
range the sim can reach and the tightest corner in the game cannot make two solids share a space. A
real cab that gets touched deforms; ours interpenetrates, and a box visibly inside a sleeper reads
as a broken model rather than as a bad manoeuvre — the physics already punishes a fold (`PHI_MAX`,
the jackknife event, the constraint that drives it) and the picture does not need to as well.

⚠ **And that is bought with a TAPERED NOSE, not with length.** Clearing 90° on the full body width
needs the frame about half again as long, and **length is not free**: past roughly 45° of equivalent
gap the depot floor's painter's-sort fallback starts losing a headlamp — `shapes:smoke` catches it,
which is exactly what that gate is for, and it is how this was found rather than shipped. A real
trailer's front corners are radiused for this very reason, so the box's nose steps in to 70% of its
body width over the last 30 thousandths. The corner that swings is the NOSE corner, so tapering it
shortens the radius directly and the same clearance costs a third less frame. Both numbers come
from `NOSE_TAPER`, so the mesh and the gap cannot drift.

The margin exists so the smoke is a **test** rather than arithmetic asserting itself: it reads the
pin, the cab back and the nose half-width out of `TRUCK_META` and checks the relation, which is what
catches somebody moving the plate, the cab or the taper without coming back to `frameBack`.

⚠ **And the slot is FOUND, never counted.** Stock was placed at index `trailersAt(zone).length`,
which is right exactly once: sell a box and the next purchase is stood at that index again, inside
the one already there — and two trailers in one spot is two trailers under one pin, so `hitch` takes
whichever the search reached first. `findStockPose` walks the depot's places in preference order —
the shed's two painted bays, then a rank along the apron fence — and returns the first that is clear
of everything standing, so a sold box frees its bay for the next one. Regress asserts exactly that.

Stock left on the apron made a liar of the shed's own floor — while putting the one thing you have
to line up on out of frame the moment you climbed in, because a driver mounts *inside* the shed
facing the door. `standPlaces()` is the one answer to where a box may stand: the shed's own tile
(the facade a truck is parked on, since the bay itself is a room at grid 0,0), then the apron, both
of them zones `hitch` already searches so nothing had to widen.

⚠ **That forced the homeless test to get stricter.** It used to be *"is it in the yard tile"*, which
was fine while that was the only pose there was — and the moment stock moved indoors it would have
swept up every box a driver had deliberately dropped on the apron and shuffled it inside. A box with
a pose has a place and somebody chose it; the only ones `standStock` has any business touching are
the ones with **none**, and the ones sitting in the bay interior at grid 0,0.

#### The cab was never drawing a contact at all *(2026-08-18)*

The boxes standing in a yard were in the payload, posed, ranged and liveried — the server proves
it — and nothing appeared out of the windscreen. So was every aircraft, which this cab was
deliberately given so a driver could watch a Mule come over the yard.

⚠ **`paintWindshield` takes contacts as `{dx, dy, altDiff, rng, …}` — offsets from the eye — and
both server lists arrive in WORLD tiles.** That is the only frame a server can speak in. The
cockpit has always converted before handing them over; the cab concatenated the raw rows straight
through, so every contact reached `drawContacts` with `c.dx` undefined, projected to `NaN`, failed
the on-screen test and fell out through the off-screen chevron branch. Nothing drawn, nothing
logged, no error.

It stayed invisible because both halves were right on their own: the boxes were in the payload, the
renderer draws contacts, and the one line between them was speaking a different coordinate system.
`contactsFor()` in cab-view.js does the conversion now, dead-reckoning the airborne ones over the
age of the payload exactly as the cockpit does — `ias` is 0 on a parked box, which makes the same
line a no-op for the thing it must not move — and pinning ground contacts to `groundZ: 0` so a
dropped trailer rests on the tarmac instead of floating at windscreen height.

#### …and you can sell one *(2026-08-18)*

A trailer could be bought and never sold: the one thing in the yard you could spend four figures on
by mistake and be stuck with forever, and the piece of kit you are most likely to get wrong,
because the whole choice is a capacity number you have not run yet. `yard sell <box>` now takes
either — **one verb, deciding by what the id names**, because a second verb would be a second thing
to discover for the same act.

The price is the truck's own rule reduced to what a box actually has: no odometer, no tune, no
kits, so a trailer's entire history is its **condition**. List × dealer margin × condition, floored
so a wreck is still worth taking away. ⚠ **A loaded box is not for sale**, and neither is one on a
fifth wheel — the load is somebody's freight or your own capital, and a dealer who took the trailer
and kept what was in it is a way to lose a market run to a mis-click.

⚠ **A box on your own pin, in the yard you are standing in, is as much "here" as one on the
concrete.** It is not findable by `trailersAt` — a towed row has no `parked_zone` at all — so a
driver sitting in the yard with the thing they wanted to sell hooked up behind them was told it
was not standing here. It is: it is on the truck, and the truck is here. Selling it **drops it
first**, using the same drop `unhitch` performs, and clears the live rig's own `trailer` before the
row goes — the other order leaves a rig towing a trailer that has been deleted, which every reader
of `rig.trailer` would then answer questions about. `sellTrailer` itself still refuses a towed row
(it is the race `hitchTrailer` refuses from the other side), and the verb leaning on that guard is
what makes the two-step safe.

In the panel it is a button per box in **Your boxes**, which is where a truck's Sell already lives —
deliberately not a second one on the dealer's line, because that would be two places to do one act.
⚠ **The button is absent on a box that is carrying something**, not present-and-refusing: the
toolbar rule on this screen is that a button which refuses is worse than one that explains itself.
The payload says `loaded` rather than sending the contents, because a box holds a declared load AND
a stash and the stash is the entire point of the stash — the panel is told the box is not empty and
deliberately not told what is in it.

#### A box is one colour, and it is the box's *(2026-08-18)*

A trailer used to be drawn in whatever the tractor's `deck` field said, and standing in a yard it
was drawn in nothing at all — the depot floor sent the renderer an id, a class and a mesh key and
no livery, so your boxes were black slabs beside a yellow truck.

⚠ **The colour is stamped on the ROW, not derived from whoever is towing.** The cheap version reads
it off the tractor, and it is wrong for the reason a trailer is a row at all: the same box would be
two colours in one yard depending on which cab happened to be hooked to it, and would change under
you the moment you dropped it. `trailers.paint` is one nullable JSONB column, stamped at purchase
from **the buyer's own cab colour** — a yard hand sprays it to match the rig that is going to pull
it — and repaintable afterwards as its own job, `yard paint <box> #rrggbb`, for a flat fee.

That verb is on `yard` rather than `rig` deliberately: `rig paint` takes eight named surfaces and a
box has one, so half its grammar would be refusals.

⚠ **`deck` IS THE FIELD, NOT `base`.** The solo mesh is the whole rig with the tractor spliced off,
and every face left over is stamped `deck` (see `buildTruck`) — so a livery that set only `base`
would paint a box that is entirely deck faces exactly nothing. `boxLivery` sets both, because
nothing downstream should have to know which one a given mesh reads. The chassis, legs and glass
stay hardware-coloured: a trailer is a painted box on black steel, and washing the whole thing in
one colour reads as a toy.

A null stamp is every box written before this, and renders as plain unbranded haulage grey — a real
answer (an unpainted box off the line) rather than a hole. The stamp wins in **every** view:
standing in a yard (`trailersNear`), towed by you (`cabContext`), towed past somebody else
(`truckContactsNear`) and on the depot floor. Repainting is guarded on the **owner** — a box
standing in a public yard is somebody's, and a spray gun is not a claim on it.

#### The shed stopped being a shed when you looked at it from above *(2026-08-18)*

`drawVehicleBay` had a **cutaway**: with your rig inside and the camera up over the eaves, the roof
and the near wall faded out so you could see your own truck rather than your own roof. It solved a
real problem, and it solved it by making the building stop being a building — which from the
driver's seat reads as *"the walls always vanish depending on angle"*, in those words. A world
where a wall's existence depends on where you are looking from is a worse trade than not being able
to see your truck through a roof, so **`BAY_CUTAWAY_ON` is false** and the shed is always solid.

The ramp is deliberately **left standing** rather than deleted — it is the tuned answer to a
question that may well be asked again, and turning it back on is one constant. Everything
downstream already read `cut` as a number rather than a flag, so nothing else had to change.

⚠ **Except the occlusion gate, and for a reason that is not the cutaway at all.** The mask used to
skip a shed *when it was being opened up*. It skips one you are **standing in** — and "you" is the
SUBJECT, not the eye. Gating it on the eye looks right and is wrong by about a tile: the chase
camera sits ~0.9 tiles astern, so parked in a shed your rig is inside it and the camera is not, the
building masks everything in there with you, and the boxes in the trailer bays you are about to back
under disappear. That shipped, as *"I can see the reefer in the depot and not in the yard"*, the
moment stock moved indoors. `bayOccluderSmoke` asserts both halves: a shed **beside** the rig masks
— from up over the eaves and from down on the road — and the one the rig is standing **in** masks
nothing.

#### A depot must not contain a trailer that is nowhere *(2026-08-18)*

`posed` was written as an optional state — *"no pose, nothing to draw, the yard lists it instead"* —
and that reads as a graceful fallback until you look at what it produces. A box with no pose is on
the fleet list, in the depot panel, in the `hitch` search and on the cab's air knob, and is **on no
picture anywhere**. You are told you own a reefer, told it is here, offered a button that couples to
it, and there is nothing in the yard to walk round. Worse, the row that gets into that state is
parked in the **bay** — a building interior at grid 0,0 — so there is no coordinate to draw it at
even in principle. The dealer standing what it *sells* on the hardstand fixed the new ones and left
everything already in the world exactly where it was.

So **the yard walks them out** (`standStock`). Any box of yours sitting in this depot without a
place gets one, on the hardstand, in the same alternating rank new stock is stood in — and from
that moment it is an ordinary dropped trailer: drawn, driven around, and hitchable only when the
fifth wheel is genuinely under the pin.

⚠ **It is a move within one depot, which is why it needs no permission.** `hitchZones` has always
treated the bay and the yard as one place, so nothing about *finding* your trailer changes — what
changes is that the place it is in now has ground under it. A box parked on a street tile somewhere
else is never touched, because that IS a place and somebody chose it.

⚠ **And it is a cold path only** — opening a yard, and climbing into a cab. Never on the drive. In
the steady state it reads nothing it was not about to read anyway and writes nothing at all: the
`UPDATE` only runs for a box that has no place, which happens once per box, ever. Regress drives
the real converge against a real depot and asserts the second run moves **zero**, because a version
that rewrote a pose each pass would be a write on a read path — and would shuffle a box the driver
had deliberately dropped in the yard. A depot with no drivable yard (the legacy one-tile shape, and
the fixtures) has no hardstand to stand anything on, so it does nothing and the unposed row stays
legal.

#### …and one colourway is yours *(2026-08-18)*

Seven named colourways is a swatch book, and a swatch book is the thing a driver who wanted **purple**
has to be told no by — on the same panel whose *exterior* tab has answered that since it was built,
with seven colour wells and pick what you like. So the inside mixes too:

```
rig trim 1 panel=#4a1f2e needle=#ffd489 glow=#c07a34
```

⚠ **THREE PICKS, AND THE REST IS DERIVED — NOT FOURTEEN WELLS.** A colourway is fourteen values and
eleven of them are the same colour at a different strength: the header, the pillars, the post, the
dial faces and the rim are the panel gone progressively darker, and the lip, the ring and the rim
highlight are the backlight bleeding onto brightwork. Fourteen wells would be eleven ways to make a
cab that does not look like anything. The three that genuinely differ are the three you live with —
**the panel** (most of the cab by area), **the needle** (the one moving thing you look at) and **the
backlight** (what your face is lit by at night). Every derived value is stated as a *relation* to
one of those three, and the relations were read back off the authored rows: walnut's ring is exactly
its glow, slate's is within two counts, and the dash triple falls out of the panel at 1.00 / 0.52 /
0.22 on all seven.

⚠ **A MIX IS A COLOURWAY, NOT A SPECIAL CASE.** `customColourway()` returns the same object shape
`DASH_COLOURWAYS.slate` is, so the forty-odd `T.needle` / `T.dash` reads in `windshield.js` never
learned it exists — `assembleTrim` resolves through one lookup and nothing below it branches.
Regress asserts the shape matches a bought row key for key.

⚠ **AND `custom` IS NOT IN THE SWATCH BOOK.** `isDashColourway` stays strict, so the custom branch is
stated separately in `sanitizeTrim` and `cabTrim`: a stored `col: 'custom'` is only honoured while
three readable picks sit behind it, and otherwise falls back to the colourway the cab already had
rather than rendering as slate on a truck nobody repainted. The mix is **kept when a swatch is
worn**, so trying oxblood does not throw away the colour you spent five minutes on — `rig trim
custom` is the way back, and it appears as one more swatch on the end of the book.

The bench sells it at **the same flat retrim fee**. Mixing is not a premium: what it costs to spray
a dashboard does not depend on whether the colour came off a card, and a surcharge would be the
panel charging for the absence of a limitation. On the Inside screen the three wells preview live —
patched in place rather than re-rendered, because rebuilding the DOM under a native colour picker
closes it on the first pixel of a drag — and the preview runs `customColourway` out of the shared
file rather than a payload row, because the thing being previewed has not been bought yet and so
there is nothing for the server to have sent. It is the same function the cab resolves through, so
the picture and the windscreen cannot disagree.


### The paint reaches everybody who can see the truck *(2026-08-18)*

Every renderer in the game drew a rig in its owner's colours — the cab, the depot floor, the
walkaround — **except the one place anybody else sees it**. `truckContactsNear`
([state.js](../plugins/trucking/state.js)) built its contact without a `livery`, so a paint job was
a thing you bought and were then the only person alive who could see, which is the exact opposite of
what paint is for. Contacts have carried a finished livery since flight and the model painter reads
`c.livery` whatever the `cls`, so the fix is **one field, not a code path**.

The conversion it needs moved to **[client/shared/truck-livery.js](../client/shared/truck-livery.js)**
— the same argument [cab-trim.js](../client/shared/cab-trim.js) makes for the *inside* of the same
paint job. Three readers on both sides of the wire, and the server has no business importing a
7,000-line canvas renderer to answer a ten-line question; `aircraft3d.js` re-exports it so every
caller that already knew where to find it still does. A conversion written down in two places is a
conversion that is wrong in one of them, and that has already happened once here.

**And the last hardcoded colour on the nose is gone.** The strip under the headlamp lenses was drawn
in `GLOW` — the lifter emitter's hot blue-white — so a rig painted white kept a blue bar across its
face that no field in the booth could reach. It is `ACCENT` now, which is the rule this file already
stated: the emitter bands are **propulsion showing** and keep `GLOW` because the road wash under
them is painted from the same fact; anything that is merely a running light takes the paint job's own
`glow` colour.

### The booth — four colours, and a finish you can see *(2026-08-17)*

The paint went from **two colours and four flashes** to four colours, fifteen paint jobs, eight
finish coats and eleven pictures for the door. The old note above called it *"deliberately thinner
than an aircraft's livery"*, and that was the wrong comparison. An aeroplane's paint is a **uniform**
— it says whose it is. A truck's paint is the opposite: it is the one thing in this game a driver
owns outright, walks up to from the outside every time, and cannot be talked out of. Two colours and
a stripe cannot make a rig recognisable across a yard, and being recognisable across a yard is what
it is *for*.

**The four colours are four surfaces, not four slots.** Each is a place a real signwriter treats
separately and — the reason this cost the renderer four lines instead of a system — each is already
a distinct set of faces in the mesh:

| field | what it paints | how the renderer finds it |
| --- | --- | --- |
| `base` | the cab | the fallback: any body face the paint job did not claim |
| `trim` | whatever the paint job puts on it — the flash, the scallop, the flame | `faceWearsTrim` |
| `hw` | the hardware: chassis, tanks, bumper, mirror arms, steps, lifter housings, trailer ribs | the `strut`/`gear`/`gun` roles |
| `deck` | the box on the back — very often not the tractor's colour | a `deck` flag stamped on every face after `tractorFaces` |

> ⚠ **`hw`/`deck`, never `accent`.** An aircraft livery has carried an `accent` since the jazz
> scheme. Hanging structural metal off *that* would turn every undercarriage and every wing strut in
> the game magenta the moment somebody flew a Jazz Wave. They are two keys nothing else sets, absent
> on every aircraft, so the airframes are bit-identical — and regress asserts an airframe strut is
> still `[44,48,54]` under a jazz palette.

> ⚠ **The `deck` flag is stamped BEFORE the solo splice.** `faces.splice(0, tractorFaces)` throws the
> tractor away for a dropped box, and after that there is no boundary left to find — a mark computed
> from an index would call the whole trailer a tractor.

**The finish is a real per-facet effect, not a word on a sheet.** Metallic is the one somebody asks
for by name, and the whole point of flake is that it does something to the light. It lives inside
`faceBaseRgb` — the seam **every** renderer of these meshes colours through, which is the same
reason the patterns ride it, and the reason matters here: there are four renderers of the truck mesh
and this file has been bitten three separate times by a fix landing in exactly one of them.

> ⚠ **Geometry-driven, never camera-driven.** A real flake sparkles as you walk past it, and chasing
> that needs a view-dependent term `faceBaseRgb` has no camera for — and a colour that changes
> between frames is a colour that **shimmers**, which this file already forbids by name (see
> `camoHash`, and why it exists instead of `Math.random`). So a finish reads the **facet**: which way
> it points, and a stable hash of where it is. A flaked panel is one whose flanks fall away harder
> than its roof, which is what metallic actually looks like on a stationary truck, and it is
> identical in every view and every frame. Regress asserts the same facet answers twice.

`satin` and an unset finish are the **exact identity** — asserted, because this runs on every facet
of every mesh in the game and a coat that tinted by a rounding error would repaint the whole fleet
on the day it shipped. `gloss` is a highlight the renderers lay on over the finished colour, so it
takes the identity path too.

**Door art goes on the door**, which is the flat panel under the cab glass at the height of somebody
standing beside the truck — where a haulier signwrites, and the only surface on the rig you *read*
rather than look at.

> ⚠ **`drawTruckDoorArt` is not `drawNoseArt` with different numbers.** Nose art reconstructs a
> fixed-wing hull — radius taper, superellipse cross-section, drooping centreline — from `FW_PARAMS`,
> a table a truck has **no row in**. Pointed at a rig it silently falls back to the Twin Otter and
> maps the art onto the shape of an aeroplane that is not there. A door is flat: four corners and a
> grid for the perspective.

> ⚠ **The rectangle comes from `TRUCK_META`, never from a constant.** The four rigs are four sizes,
> and the whole mesh slides back to centre on its origin after it is laid out — the same transform
> that once left the headlamps hanging in the road ahead of the bumper. Art placed from a hardcoded
> station lands on the wrong panel of three trucks and on the tarmac beside the fourth. Regress
> measures the published door against each rig's own drawn bounds, and asserts a dropped box
> publishes none.

**Nothing is migrated.** Every truck in the database carries the old four keys; the bench payload
reads them back through `sanitizePaint` rather than rewriting the row, and the defaults are chosen
so that read reproduces exactly what that truck has always been drawn as. No row changes and nothing
changes colour on the day this ships — the same net-zero invariant the mutation and augment
migrations were built on. Regress asserts it, and asserts the normalisation is idempotent (which is
what makes the panel's "nothing changed" test honest).

**The verb's grammar had to become named.** Four positional arguments are fine; eight are unusable —
nobody will remember that the seventh slot is the door art. `rig trim` solved the same problem by
inferring a bare word's meaning from which catalogue it appears in, and ⚠ **that trick does not work
here**: `candy` is a paint job *and* a finish coat, `flames` is door art while `flame` is a paint
job. So the keys are written down —

```
rig paint 1 base=#8e0f18 trim=#f0d97a hw=#1c1e22 deck=#8e0f18 flash=scallop finish=candy art=wolf
rig paint 1 preset showrig
```

— and the **old positional form is still accepted exactly as it was**, because it is what every
macro and every line of anyone's notes already says.

**Nine one-click schemes** sit above the pickers, exactly as the hangar does it, because a
four-colour picker with fifteen paint jobs behind it is a *worse* experience than two colours unless
there is a one-click route to something that looks deliberate. ⚠ A scheme is applied **locally**
rather than sent as `rig paint … preset …`, even though that verb exists: sending it would charge
for the respray the instant somebody clicked a swatch to see what it looked like. The preset is a
shortcut through the pickers; the button is the purchase.

**The finish moves the fee** and nothing else does. Flake and candy are coats laid over a base nobody
ever sees again; primer is the absence of the job. Deliberately **not** priced per colour or per
paint job — a bench that charged more for a scallop than a stripe would make the interesting half of
this cost money to look at. The panel re-quotes while you choose, off the gloss price and a
multiplier table the server sends, because a booth that quoted one number and charged another the
moment somebody picked candy would be the panel lying about the only fact on it.

## The loop

Lifted from flight, unchanged in shape: the **client simulates at 60fps** (that is where the feel
lives) and streams packed telemetry; the **server clamps rather than re-simulates**.

```
trucksync <s> <t> <hdg> <spd> <x> <y>      ~4×/s
```

**The client reports where it IS, not how far it has come.** `reconcileTruck` derives the odometer
from the reported position against the server's own corridor geometry. A client that reports its
own progress is a client that can weave and be paid for the extra tarmac. The `s` field survives
only as a fallback for a bogged rig, whose position is off-road and therefore locates nowhere.

`s` is the one number defended hard — arrival, node crossings, and (later) contract clocks and fuel
all key off it, and nothing else does. It is clamped against elapsed wall-clock.

<a id="the-odometer"></a>
**It is NOT monotonic — you can turn round.** *(Changed 2026-08-19.)* `s` used to be floored at its
own previous value, on the reasoning that "phase 1 has no reverse, so a decreasing odometer is an
attempt to re-drive paid road". Both halves of that stopped being true: **phase 2 shipped a reverse
gear**, and **nothing is paid per tile** — a delivery pays a flat `job.pay` on arrival, so
re-driving a stretch buys you nothing.

What the floor actually did was make the truck the only thing out there that could not turn round.
A walker in the same crossing has always been able to: trunk rooms carry a `north` exit back the way
they came, and the move gate seals only the *forward* one, and only while an enemy is in the room.
So the same waste had two rules depending on whether you were on your feet or in a cab, and the
cab's was the strange one.

The anti-cheat survives intact, because **it was never about direction — it was about rate**.
Clamping `|Δs|` against wall-clock says exactly what the old ceiling said and says it both ways.

| decision | why |
|---|---|
| **`retreat()` mirrors `arrive()`** | drive back to `s = 0` and you come out on the rim tile you left, landing on the same zone a walker returns to (read from `crossingInfo().originZone`, not remembered on the rig). The load stays on the deck and the contract stays live — coming back is not a failure state, and the diesel and the time are punishment enough |
| **⚠ the near-end exit must be ARMED** | a rig **joins** the corridor at `s = 0`, so an unguarded test at the near end fires on the first telemetry frame of every haul and bounces the driver straight back off the road they just pulled onto. It did. `rig.sMax` is a high-water mark that never decreases; the exit does not exist until the rig has been more than `RETREAT_ARM` tiles out |
| **`s` floors at 0** | a negative index reads off the front of the room chain as `undefined` |
| **node crossings fire in either direction** | which is exactly what happens when a walker re-enters a room — same encounter roll, same traces. Consistency with the walker is the whole point |

Rig state is **RAM-only**. The crossing's own five `player_flags` already survive a relog.

---

## The cab

`paintWindshield` with **`height: 0`** — the flight renderer's camera height was always
`RENDER_TUNE.eh + height * climbLift`, so a truck is what that function does when you stop
climbing. Nothing was forked; the aircraft overlays (`hud`, `contacts`, `airport`, canopy, cowl)
are separate functions the cab simply does not call.

`cls: 'truck'` selects `drawCabInterior` — flat two-pane screen with a centre post, A-pillars, a
dash across the lower third, and **mirrors**. The mirrors are stubbed with a road-streak that
scales with speed; they become a real instrument in phase 2, because the articulation angle is not
visible from the driver's seat by any other means.

The steering wheel is [helm-wheel.js](../client/game/js/panels/helm-wheel.js) in a new **`absolute`
mode**. The yacht's default reports the *change* in wheel rotation, because a boat sets a course.
A truck holds a line and its front axle self-centres, so absolute mode reports wheel POSITION as a
normalised −1..+1 axle deflection, clamps to a real lock, and returns to centre on release. Passing
no `mode` leaves the yacht untouched.

### You get in, and it is off *(2026-08-18)*

Mounting used to start the engine — `drive` narrated the diesel catching on the second turn — which
meant the one control on the shelf that is a real, two-position, consequential switch had nothing to
do on the only occasion anybody would reach for it. A truck you have just climbed into is **cold**.

Three seams carry it and none of them is new. `mountRig` sets `engineOn: false`; `cabContext` puts
the bit on the wire (read at mount only — the client owns the engine from the first frame and
reports it back through the telemetry's `t`, but without it the browser's fresh `createTruckState`
is always running whatever the server thinks); and the cab seeds `sim.stalled` from it. ⚠ **And it
seeds the box into NEUTRAL**, which is the difference between a cold start and a puzzle: the model
only cranks with the clutch in *or* out of gear, and a fresh state is in first, so the key alone
would churn and refuse — teaching a rule that belongs to a stall recovery rather than to getting in.

⚠ **The text rung has no ignition at all**, so pulling out *is* the start (`startTextDrive`'s caller
sets it). A rung with no key must never be handed one.

The derelict's cold-start line moved with it. The roll still happens at the mount (it is a fact
about the truck's condition), but the **line waits for the key** — it is stashed on the rig and
spent by whichever rung actually turns it, which for the visual rung is the first false→true edge of
the ignition bit `cmdTruckSync` already reads. A truck that has not been started cannot be turning
over.

### The heater, which is the engine's

[hvac.js](../plugins/trucking/hvac.js) registers the rig set as a **vehicle cabin**: while the
engine turns, the cab holds **20°C** and reaches it within a minute or two; kill it and the box
gives all of it back within a few. Nothing here implements heating — the engine owns the
thermometer and both rates ([systems-survival.md](systems-survival.md#vehicle-cabins)), and this
file answers only *which cabs exist, who is in them, and is the engine running*.

It could not be a `registerHeatSource`, because that warms a **zone** and a driver's
`current_zone` is the public road tile the rig is over — heating the zone would heat the street
for the pedestrians on it. It also needed no new state: `rig.engineOn` is already reconciled from
the cab's own telemetry four times a second (see the ⚠ on the ignition in `reconcileTruck`), so
there is no second notion of "is the heater on" to fall out of step with the truck. Which is what
makes a **breakdown in a cold snap** a real problem rather than a long wait somewhere warm.

### The dash, the glass, and who has the keyboard

Four decisions in the cab shell are worth knowing before you move anything on it.

**A hand on the road is the primary steering control.** A pointer drag anywhere on the windscreen
winds the *same* wheel widget (`setDragging`/`wind` on helm-wheel, absolute mode only) — not a
parallel angle, so what you see turning is what you are turning. The travel is scaled to the
glass's own width, so the same physical gesture means the same lock at any window size. In the
**external** view that identical drag orbits the chase camera instead, and the scroll wheel dollies
it; the two meanings never overlap because the two views never do.

**Fullscreen buys road, not dash.** The shelf is a flex row and a taller window fed it as readily
as it fed the glass, which is backwards — the reason to go fullscreen is the view. At
`body.cab-fullscreen` the controls stop being a shelf and become a HUD absolutely positioned over
the bottom of a windscreen that now runs the full viewport. The renderer's camera is untouched and
does not need touching: it fills the canvas it is given.

**There is one dashboard and one wheel, and both are in the scene.** There used to be two of each:
instruments painted on the dash *and* a DOM instrument panel on a shelf below the picture showing
the same numbers in a second visual language, plus a wheel arc drawn on the glass *and* a canvas
wheel widget on the shelf that was the one you actually turned — so the wheel in front of the
driver was the picture. Everything moved into `drawCabInterior` (a full binnacle with hood, two
dials, a lit gear window, four flanking bars and six tell-tales) and `drawCabWheel` (rim, three
spokes, thumb grips, an upright horn boss). The shelf below the glass keeps **only the controls**.

Three things hold that together. `helm-wheel` runs **headless** (`canvas: null`) — it still owns
the angle, the lock clamp, the self-centring and the keyboard, and the renderer only *draws*
`getLock()`, so there is exactly one steering angle in the cab. The horn hit-tests against the
renderer's exported `cabWheelHub()` rather than a second copy of the geometry. And the DOM readouts
are **visually hidden, never deleted** — they are what a screen reader reads and what the log rung
of the display ladder has always had; the frame loop writes them exactly as before. A canvas gauge
is not an accessible instrument; a canvas gauge with that behind it is.

The panel invents nothing: speed, revs, fuel, brake temperature, leg progress, gear and the six
lamps are all values the cab already had. It is still the fleet ladder — `CAB_TRIM.dials`/`.band`
decide what is bolted to it (no tachometer in a Barrow, here either) and what it is made of.

**The panel is laid out across the dash, and the wheel publishes its own top edge** *(2026-08-14)*.
The first version of it put all seven instruments and six lamps inside about a fifth of a very wide
surface, clustered on the column — and drew them *before* the wheel, whose rim came up over the
bottom half of the cluster. Two different mistakes with one look: **bunched, and unreadable**.
Nothing was mis-sized; the two instruments a driver reads most were simply behind a moulded grey
annulus. So `cabWheelGeom(W, H)` is now the **one** definition of where the wheel is — the drawing,
the horn hit-test (`cabWheelHub` derives from it) and the panel layout all read it, and the panel
lays itself out in the band between the dash lip and `top`. A dash is wide and a cab is short, so it
spends the axis it has: binnacle on the column, **gear window beside it** (under it is where the
wheel is), fuel and leg out on the left flank, brake and trailer right of the gear, and the
tell-tales in one spread row on the right of the dash **with labels** — an unlit dot is not an
instrument, it is a hole.

**One instrument row across the whole dash, and the wheel comes back up** *(2026-08-14)*. The layout
below (wheel pushed down to buy a band above it) traded the wrong thing away: it made the wheel a
shallow arc, which is not what sitting behind a truck wheel looks like, and the gauges were still
capped by a strip. **The strip was the problem, not the wheel.** Everything round now sits at ONE
height on the dash flat, where there is full depth and the rim reaches nothing — tachometer
immediately left of the wheel, speedometer immediately right, the four small ones further out, then
the screen. That is the reference photograph's own arrangement, and **it is what lets every gauge be
a real dial**: the bars were never a style choice, they were what fitted in the strip. The strip over
the wheel now carries the GEAR and the six tell-tales and nothing else, so the hub is free to sit at
`1.12H` where a wheel sits. ⚠ **The old binnacle hood is the "egg"** — two quadratic curves meeting
over a pair of dials draws a fat lozenge; cluster surrounds are squared panels with a lip.

**The GPS is a tap target for `route`** *(2026-08-14)*. Tapping the screen opens a picker; every row
sends the ordinary `route <key>` command, the same string a player could type, and that verb owns
**all** the rules — fork still ahead, contracted load overriding the aim, what happens to the
odometer. The panel re-implements none of it and must not start: the moment it decides anything
there are two answers to "can I go there", and they disagree the first time a tank gets smaller.
So `routes.js` holds **one** `routeOptions` that both surfaces read, and six regress cases pin its
shape. Two decisions inside it. **`reach` is three states, not a boolean** — *further than your tank,
one way* is a run you can choose to make, and collapsing it into "no" turns a judgement call into a
locked door; an unreachable row is therefore **shown and greyed, never hidden**, because a missing
row is a mystery where a row that says why is information. And ⚠ **nothing is requested when the
picker opens** — the only channel to hand is `trucksync`, which is telemetry clamped against
wall-clock to defend the odometer, so provoking a refresh with a synthetic one would feed the
anti-cheat envelope a position the truck is not at in order to update a menu. The cab is pushed on
every tile change and once a second as a floor; the list is at most a second old and the verb
re-checks everything anyway. `routes.js` imports nothing from `state.js` (which imports it) — the
zone and the fork flag are passed in, from the same single implementations.

**The GPS screen** *(2026-08-14)*. Far right of the dash, and the rule that keeps it honest: **it
invents nothing and decides nothing.** The map is `v.map` — the very same window the world outside
the windscreen is rendered from — so the screen and the view cannot disagree about what is out
there. Own position is a *heading arrow*, not a dot: a dot tells you where you are, which you knew.
Setting a destination is **not** done here; that is the `route` verb, which already owns the fork
rules and the range check, and the screen is a face for it (the preparation-workspace rule — every
action is a verb string a player could have typed). A HUD that re-derived "can I get there" would be
a second copy of the answer, and the two would disagree the first time a tank got smaller. `aim` is
the route's own `destKey`, added to `cabContext` for naming only.

**The band is the binding constraint on gauge size, so the wheel sits low** *(2026-08-14, superseded
above)*. The
instruments live between the dash lip and the top of the rim, and at `CAB_DASH = 0.30` with the hub
at `1.20H` that band was about a tenth of the frame — dials the size of the word underneath them.
The hub drops to `1.30H` and `CAB_DASH` goes to **0.33**: every 0.01H the wheel drops is 0.01H of
readable dash, and the top arc plus the upper spokes is all you ever see of a wheel you are sitting
behind. Three points of glass for gauges you can read at a glance is a cheap trade; past ~0.36 you
are driving through a letterbox. The flanking bars now space themselves as a **fraction of the gap
they have to fill** rather than a multiple of their own width — "bunched up" was two bars 15px apart
on a 600px stretch of empty vinyl — and the tell-tale wall is solved *before* the right-hand bars,
so two independently laid-out instruments can never overlap.

⚠ **The dash has its own canvas, at native resolution** *(2026-08-14)*. This is the root cause of a
dash that read as *blurred*, and it was not a styling problem. The world canvas runs **dynamic
resolution** — under load its backing store drops to as low as **0.6×** native and CSS scales it
back up. That is the right trade for what it was built for (clouds, buildings, ground: big soft
masses, and every pass gets cheaper at once) and the wrong one for an instrument panel, which is 8px
legends and one-pixel needles a foot from the player's eye. A speedometer rendered at 60% and
upscaled is not a look, it is a blurry speedometer. `windshieldHTML` now emits a second
`<canvas class="ws-dash">` and `paintCabDash` draws the interior onto it at full device-pixel ratio,
outside the scaler entirely. ⚠ **The layer is cleared on every path that is not the cab** — it is
persistent, so a shoulder-check, the external view and a window seat each leave the forward branch
by a different door and every one of them must blank it.

**Glass follows the house recipe, and the house recipe is HARD-EDGED** *(2026-08-14)*. The first
attempt was soft, broad and low-contrast in every particular, which is why it read as smudged. The
AMP deck and the ATM screen (`.amp-glass-cover` / `.atm-crt-glass` in `styles.css`) had the answer
already: a **narrow hard-stopped sheen streak** (bright at 47% of a diagonal, gone by 54%), a
vignette that stays **fully transparent across the readable face** and tightens only at the rim — the
first version started shading at 62% and reached 0.52 alpha, fogging the outer third where the
numbers live — a **small tight** corner catch rather than a half-dial ellipse, and crisp 1px edges.
**Glass is defined by its edges; blur is what you get from trying to define it by its middle.**

**Glass quality is a rung on the fleet ladder** *(2026-08-14)*. The dials' cover was one flat linear wash,
which reads as a circle that has been *shaded* rather than a circle with a lens on it — what sells a
cover is the EDGE: light entering the curve, and the bezel throwing a shadow inward onto the face.
It is four passes now (bezel shade, a tilted elliptical specular, the windscreen's own sweep, and a
rim highlight on the bezel), and `CAB_TRIM.gloss` scales all of them from **0.22 on the Barrow to 1
on the Orlov**. That is exactly the right axis for a luxury: **nobody sells you a faster truck by
fitting better glass**, so it can be as indulgent as it likes without touching a number the physics
read. The Barrow also gets `crazed` — three faint arcs across a forty-year-old cover, seeded off the
dial's own position so they don't crawl between frames, and drawn as *light* rather than dark
because a scratch in plastic catches light instead of blocking it.

⚠ **A poor cab must look plainly equipped, never broken.** A Barrow has `dials: 1` and no
tachometer, and the right-hand cluster plate was still being stretched to the width of the
instrument that was never fitted — an empty recess, which reads as a missing part rather than as a
cheap truck. The plate hugs what is actually mounted on it.

⚠ **Anything hit-testing the painted cab must measure the DASH canvas** *(2026-08-15)*. The horn boss
was solved from the world canvas's height while the wheel was drawn from the dash canvas's, and the
two are not always the same box: `.ws-canvas` is an in-flow block at `height:100%`, which against an
auto-height flex parent resolves from the parent's CONTENT, while `.ws-dash` is `inset:0` and always
takes its USED box. In fullscreen they diverge and the horn sat well above the wheel you could see.
`cabDashCanvas(id)` exists so a hit-test can measure the canvas the thing was actually drawn on —
which is correct by construction, whatever the two boxes are doing.

**The dynamic-resolution floor is the caller's to set** *(2026-08-15)*. Shrinking the backing store
under load is the right trade for a flight sim at altitude — big soft masses, and the alternative is
a stutter — and the wrong one for a cab a metre from painted lane markings where every edge in frame
is a hard one. It also explains the shape of the complaint: **a fullscreen canvas costs several times
the pixels, so the scaler engages there and only there**, and the symptom reads as *the fullscreen
button making the game blurry*. The cab passes `resFloor: 1` and renders at native, taking the frame
cost instead. Everything else keeps the 0.6 floor it always had.

**The fleet hovers, and now it actually leaves the ground** *(2026-08-15)*. The trucks have been hover
hardware since they were modelled — lifter pods with shrouds, a cyan emitter band, a lit patch of
road under each, all already gated on the rig not being parked — but the model never rose, so all of
it read as decoration on a vehicle sitting in the road. `hoverLift` adds the ride height, and the
restraint is the point: **a rig that leaps into the air is a hovercraft, and this is a truck that
happens to float.** About a third of a pod's height, so you can see road under the shrouds and
nowhere near enough to look like flight. It **spools** over ~1.5s off the engine (not the throttle —
an idling rig is up on its air, which is what the lit emitter band already said), so pulling away
sets it up and a dry tank settles it. And it **breathes** on two sines at unrelated periods (2.9s,
4.3s) so the float never lands on a beat you can count. The light pool is drawn on the road *before*
the model — it is the contact shadow's **replacement**, not an addition: a vehicle that is not
touching the road does not cast a hard shadow, it casts a lit patch.

⚠ **A lamp's glow must never be a second opinion about where the lamp is** *(2026-08-15)*. The first
`vehicleLamps` re-derived the stations by eye and got all three wrong in the same direction — the
headlamps 0.028 too far back and 14% too narrow — which at an oblique camera reads as glows floating
off the front of the truck. `truckLampGeom` is now the single derivation and `buildTruck` builds the
lenses from it, so a headlamp that moves takes its glow with it.

⚠ **A held control belongs to the finger that pressed it** *(2026-08-15)*. `hold()` bound its release
to `pointerup` on the *window* with no idea which pointer it was hearing about, so holding the
throttle with one thumb and lifting the other off the wheel released the throttle — **any second
finger anywhere on the glass ended the first one's press**, which is exactly "I cannot accelerate and
steer at the same time". The press now records its pointer id and claims it with `setPointerCapture`.

⚠ **…and a pointer release may only end a press a POINTER started** *(2026-08-19)*. The guard above
read `pid !== null && pid !== 'kb' && e.pointerId !== pid` — "not our finger, leave it held" — and did
the opposite in the case that matters most. A pedal held from the **keyboard** never calls `on` at
all (the key handler writes `st.input` directly), so `pid` is null, the guard collapses to false, and
the window-level `pointerup` net zeroed the throttle. **Any mouse click anywhere on the page dropped
the accelerator out from under a driver holding A** — the middle button swinging the camera, a click
on the gear lever, anything — mid-corner, with nothing on screen to explain it. That net exists only
for a press whose element-level release went missing, so it has no business ending one it never saw
begin; a keyboard release, a blur or the panel tearing down pass no pointer and still end it. The
same guard now covers `steerHold` and `lookHold`, because X/C and Q/E/S write `st.steerKey` and
`st.viewYaw` from the key handler in exactly the same way. Separately, the glass gesture is
**primary-button only** (it excluded the right button and said nothing about the middle one, so a
middle-click silently took hold of the wheel) and refuses Chrome's middle-click autoscroll, which the
flight sim already refuses inside its own view.

⚠ **The cab records which drive keys are physically down** *(2026-08-19)*, and it is one `Set`
answering three bugs that were all the same missing fact. A held control is written straight into
`st.input` by the key handler, so the **only** thing that ever let go of it was the matching keyup
arriving at this window — which made every route by which that keyup can fail to arrive a truck that
never stopped accelerating:

| the route | what happened |
|---|---|
| **clicking into the command box mid-drive** | the typing guard is the first line of `onKey` and is right for a keydown (a driver writing a message must not be shifting gear). For a keyup it was catastrophic: the release for A is addressed to an `INPUT`, gets dropped, and the throttle stays pinned at 1 with no key held and nothing on screen to say so. The **record** is settled before the guard now — a press only counts while the cab has the keyboard, a release always counts, wherever it is delivered |
| **Alt-Tab, or the tab going to the background** | the keyup is delivered to whatever you switched to and this window never hears it, so the rig drives off on its own while you read something else. `blur` *and* `visibilitychange`, because they answer different questions ("this window is no longer taking keys" vs "this tab is not on screen") and a driver can reach either without the other |
| **`O`, the camera coming off its mount** | entering deliberately drops the pedals (the truck is about to belong to the camera, so it latches cruise instead) and `exitFreeCam` **could not put them back** — it carried a comment promising it restored the throttle "from the KEY STATE" and no key state existed. A driver holding A through an `O`…`O` round trip got the pedal back only by releasing and pressing again. Detaching the camera is allowed to take the truck away; it is not allowed to keep it |

The Set is deliberately a record of the **keyboard**, not a second copy of the controls: `st.input`
stays the one statement of what the truck is being told to do. A pedal held by a **pointer** is not
in it at all — that is `hold()`'s business, and it has its own pointer discipline (above). Each entry
in the table undoes exactly what its key's own branch in `onKey` does, guarded the same way, so a
release through this path and a release through the ordinary keyup are the same release and running
both is a no-op.

**Touch controls come back in the chase view** *(2026-08-15)*, on every device. Out there the wheel is
not on screen to drag, the painted dash is behind the camera, and a pointer drag means orbit — so a
desktop driver has no pointer route to steering at all. **The controls a cockpit made redundant stop
being redundant the moment you leave the cockpit.**

**Pictograms, not glyphs** *(2026-08-14)*. The text characters the keys carried were standing in for
meanings they do not have — an arrow is not a wiper, and several of these controls have no character
in Unicode at all. `ICON` is line art on a 24×24 grid, stroke-only in `currentColor` at one weight,
so every pictogram inherits its key's tell-tale colour, hover and dim state with no second copy of
those rules. A truck's switch panel is pictograms for exactly this reason: you read it in peripheral
vision, in a language that does not depend on knowing the word. They are `aria-hidden` — the button
already has a real name and a printed legend, and announcing the icon too would read the label twice.
Nothing is finer than ~2px at render size; hairline detail is a smudge on a dash you glance at.

**Wipers are a column stalk, because that is what they are** *(2026-08-14)*. Not authenticity for its
own sake: **a stalk states its position by where it is pointing**, from the corner of your eye,
without a lamp or a word. A rocker can only say on or off; the wipers have four settings. `--pos`
steps 0–3 and the arm swings 14° per detent. It is still one control that cycles, so the `V` key,
the input path and the rain hint are untouched — what changed is that the thing on screen is the
thing a driver would reach for. The word is printed under it anyway, and rides the `aria-label`
(*"Wipers — low"*), because *"slightly further round than it was"* is not a judgement to ask of
anyone, sighted or otherwise.

**The panel is LIT, not merely coloured** *(2026-08-14)*. An instrument is lit from behind, and that
is the single thing most missing from a dash that read as *"sooo dark"*: a black face with pale marks
on it is a diagram; the same face with light coming through it is an instrument. Three additions,
all in the cab's **own trim colour** so an Orlov glows warm amber and a Drayman green without either
being repainted — a **backlight** low and central behind each dial where the bulb actually sits, an
**instrument flood** on the dash itself (a broad eyebrow wash over the binnacle plus a tighter one
off the column), and **ticks painted as lit marks** rather than hairlines of bezel colour, majors
long and heavy so the scale reads at a glance. All composited `lighter`, so they ADD light instead of
laying a translucent film over the vinyl grain and flattening it.

⚠ **The gate's slots are real buttons, which is what let the ▲▼ pair go.** Those two existed only
because a lever you can work solely by dragging is a lever a keyboard user does not have — and the
answer to that was never a second control beside it, it was making the lever itself operable. The
slots are generated from `CAB_GATE` (hoisted to module scope for exactly this), so the number milled
into the plate **is** the target and no legend can end up where the button is not. Reverse is a slot,
so the `R` key keeps working and its button is gone too. The splitter and range are **knob collars**
beside the gate, because on a real range-change box that is where both live — under your thumb, never
a position you put the lever in.

**Controls a desktop does not need are touch-only** *(2026-08-14)*. Steering, the shoulder-checks and
the horn all have a better desktop route already — drag the wheel or hold an arrow, `Q`/`E`/`S`, and
the horn is the boss in the middle of the wheel you can simply press. Showing them to everybody is
what made the cab read as a gamepad bolted to a picture of a truck: eight on-screen controls for
things two keys already did. ⚠ **Hidden by POINTER, not by width** — `(hover:hover) and
(pointer:fine)` — because a small window on a desktop still has a keyboard and a tablet in landscape
still does not.

**The shelf is spread, not centred** *(2026-08-14)*. `justify-content:center` put every control in
the middle of the pane — which is exactly where the painted wheel and the binnacle are, so the
hardware ended up stacked over the one part of the dash that was already busy. The wheel sits at 42%
of the width (`cabWheelGeom`), so the groups push out to the two ends and a flex `::after` holds the
hole in the middle open, which is what stops anything drifting back into it as groups are added.
Hands out to the sides, wheel in front of you — the arrangement the real thing has.

**Each control is housed as the thing it actually is** *(2026-08-14)*, modelled on a truck control
box: every function is its own moulded key in its own bezel, with a **tell-tale strip across the
top**, a pictogram, and the word under it. The strip is what makes a panel of these readable at a
glance — you are not reading twelve labels, you are looking for the one that is lit — and it is why
each key needs its own housing rather than being a cell in a shared strip. Groups sit in a recessed
black panel, because **what reads as quality is the black BETWEEN the keys** as much as the keys.
The tell-tale carries the colour-coding and the key face never does: a dash of twelve different
coloured plastics is a toy. ⚠ **A rocker stays a rocker** — a real cab has both, and its tell-tale
is drilled into its own bezel, so it is excluded from the key strip; two lamps on one switch is the
tell that a style was applied rather than chosen.

**The controls are switches, and the legends are printed on them** *(2026-08-14)*. They were dialog
buttons carrying a glyph and a `title`, which is the least discoverable arrangement available: a
native tooltip needs a hover a touch device does not have and a second's wait a driver does not
have either. So each one is a moulded control with its legend **silkscreened on** — a rocker is a
bezel screwed to the dash with a paddle that pivots in it (upper half lit and lower half shadowed
when off, inverted when on) and a tell-tale drilled into the *bezel*, not the moving part; a push
switch is domed, sinks when pressed, and carries a glyph over an engraved word (`UP`, `DN`, `SPLIT`,
`REV`, `PORT`, `STBD`, `BACK`). Both children live **inside** the `<button>`, so the accessible name
is untouched and no legend is a caption floating beside a control. ⚠ **A rocker is also a `.cab-btn`**
— `.cab-btn:active` and `.cab-btn.on` tie with `.cab-btn.cab-rocker` on specificity and come later
in the sheet, so the rocker rules restate the bezel or a press hands it a push-button gradient and
loses the pivot.

**Every control's appearance is derived from `st.input`, never from the thing that moved it**
*(2026-08-14)*. The `on` class was added by the pointer handler and by nothing else, so a driver
using `A`/`Z`/`X`/`C` — which is nearly all of them, since the keys are the fast way to drive —
stood on a throttle that never moved. `paintControls` runs in the frame loop off the input state, so
the pointer, the key, a focused button's Space and anything added later all get the animation free.
Same rule as `paintGate`, and the same reason.

**The cab takes the keyboard, and says so.** Key handling is on the `window` and steps aside for a
focused text field — correct, and also how a driver ends up typing `aaazzzx` into the command bar
without finding out, since the bar sits three inches under the glass and every other part of the
game wants focus. The cab now focuses its own wrap on mount and on any press inside the pane, and
the `⌨ KEYS` tag on the glass names who has them. Nothing is trapped: clicking the command bar
hands them straight back and the tag goes amber to say so.

**The chase view is the renderer's own ship** *(2026-08-14)*. It used to pass `hideOwnShip` and then
paint a bespoke box model over the finished frame, and both bugs that came out of that were the same
bug. A box has **no bobtail** — a tractor with nothing behind it read as the same slab as a loaded
one — and its camera was a *restatement* of the renderer's three numbers rather than the renderer's,
so an orbit turned the world underneath a rig that stayed put. `buildTruck` (aircraft3d) had existed
the whole time: it is what the depot floor, the wireframe and a rig seen from somebody's cockpit all
draw, it takes the `<typeId>[+t]` grammar, and **bobtail is a real silhouette in it**. So the cab
asks for the same truck everybody else sees, through the same own-ship chase path the aircraft use —
heading, ground anchoring, scale and the empty silhouette all come from one place. `variant` had to
be plumbed into the own-ship call in `windshield.js` (contacts already carried it); without it the
one vehicle you are actually driving is the only one drawn as a default hauler. All that is left
over the frame is `drawRigOverlay`, which says JACKKNIFING — a fact about the drive, which the
renderer cannot know.

**The own-ship truck needs its own size multiplier** *(2026-08-14)*. Straight after the swap above the
rig read as almost invisible in the chase view — and it was drawing correctly, just far away.
Apparent size is model scale over camera distance; `szFac` is floored at **0.46** on purpose (a
physically tiny airframe pulling the camera all the way in reads as a squashed crop — a trade made
for the small helicopters, and right for them). So a prop gets `(0.11 × 1.9) / 1.00` and a truck got
`(0.030 × 1.9) / 0.46`, about a quarter of the frame a hero craft fills. `CONTACT_SIZE.truck` is
*right as a contact* — a rig seen from an aircraft should be a detail on the road — so the own-ship
chase gets a **different number** (`OWN_EXT_MUL_BY_CLS`, 3.2, solved to put a truck at exactly a
prop's apparent size through the clamped camera) rather than the shared one being bent to cover both
questions. ⚠ Every own-ext site now goes through `ownExtMul(cls)`: an override that reached the draw
but not `ownShipBaseWz`/`modelGroundDrop` would scale the model and leave its wheels at the old
height — a truck hovering over the road.

**A truck lights itself like a truck** *(2026-08-14)*. Straight after the size fix the halos still did
not match the vehicle — two floodlights a wingspan apart either side of a small rig. Two causes, and
the first is a one-liner. `wingtipStation(cls)` falls through to `FW_PARAMS[cls] || FW_PARAMS.prop`,
so a truck was handed **a Twin Otter's wingtips** and its nav lamps were hung at the tips of a wing
that is not there; it returns `null` for `truck` now. The second is the size: the aeroplane lamp is
`clamp(3.2 / q.f, …)`, a screen radius keyed to **depth alone**, which is only right for a craft
whose on-screen size also tracks 1/depth *at the reference scale*. A truck is a small model viewed
from a proportionally closer camera, so the halo came out ~2× larger while the truck came out
smaller. The replacement set (`vehicleLamps` in `aircraft3d.js` — headlamps, tail lamps, roof
markers, every station derived from the constants `buildTruck` lays the mesh out from) sizes its
glow as a **fraction of the vehicle's own projected track width**, so it is correct at any distance,
zoom or class size by construction rather than by tuning. Headlamps ride the LIGHTS switch; the rest
is on whenever the engine is.

**The cab has to be listed in `input.js` as a keyboard owner** *(2026-08-14)*. It owns `A`/`Z`/`X`/`C`,
the arrows, `,` and `.` — nearly the whole letter row, and every one of them is also a printable
character. The document-level handler in `client/game/js/input.js` pulls the caret into the command
box on any single printable keypress, and guards against exactly this for the flight sim, the cabin
HUD, the hangar walk, the depot walk, WASD movement and the piano. The cab was never added, so the
first key of a drive focused the command bar and the rest of it arrived there as `aaaaaaaazzzzzzz`.
The cab's own focus machinery (`grabKeys`, the `⌨ KEYS` tag) was working the whole time and could
not have fixed it — something else was taking the focus back. **Adding a panel that owns keys means
adding it to that list.**

**The chase model's face sort is BUCKETED for road vehicles** *(2026-08-14)*. Orbiting made the
details flash — grille bars, stacks, steps, mirror arms winking in and out. Not z-fighting and not
LOD popping (`sizeMul` ≥ 1.5 pins the truck at full detail): the painter's key is a face's **mean
vertex depth**, which is right for an airframe — big, smooth, mostly convex, so two faces at the same
depth genuinely are. A truck is the opposite shape, **a pile of small boxes sitting on other boxes**,
so a detail and the panel it is bolted to differ by millimetres; rotate the camera and those two
means cross, then cross back, and every crossing swaps which is painted second. So truck depths are
bucketed at a fraction of the model's own size and ties fall back to **mesh order**, which
`buildTruck` emits inside-out — the thing on top stays on top from every angle. Aircraft keep the
exact comparator they always had. ⚠ The bucket size is a tuning constant and there is **no automated
proof** of this one; the existing `truckNoseSliceSmoke` checks mesh geometry, not runtime sort order.

**The orbit's limits belong to the renderer, not the cab** *(2026-08-14)*. Both floors were
hand-shy constants copied from the aircraft camera: pitch stopped at 0.06 rad (~3°), so the one shot
a road vehicle most wants — level with the tarmac, looking down the lane at the rig in profile — was
unreachable, and the zoom floor bottomed out at 0.18 once the cab's own ×1.15 was applied, so the
renderer's 0.15 never bound. `paintWindshield` already solves the true pitch limit (`groundPitch`,
the angle at which the eye would sink into the terrain) and clamps to it, so the cab now asks for
flat and gets exactly as flat as the ground allows.

⚠ **A live rig in RAM is not a reason to skip the cab push — it is the case the push exists for**
*(2026-08-14)*. `restoreDrivingState` opened with `if (rigs.has(player.id)) return false`, on the
reasonable-sounding grounds that somebody already mounted needs no restoring. But **`rigs` is server
memory and the cab is a client panel**, and the event that separates them is the commonest one
there is: a page reload. The socket drops and the browser is back before `player.logout` runs (or it
never fires), so the rig is still in the map — and login pushed nothing. The result is total from the
player's side and invisible from the server's: posture `driving`, every movement verb correctly
refusing with *"You're behind the wheel — you'd have to park and climb down first"*, and **no truck
on the screen**. A fresh socket has no cab by construction, so a live rig now re-pushes
`truck_sim` every time. Pinned by three regress cases (verified to fail against the old line).

⚠ **An inline pane height is what beats fullscreen, and it is not a specificity problem**
*(2026-08-14)*. After the flex rules below were already correct, fullscreen still refused to fill —
because the look-resize handle stores a dragged room-pane height as an **inline style** on
`#area-pane` and restores it from `localStorage` (`lookPaneHeight`) on every boot. An inline height
beats every class rule there is, so for anybody who had ever dragged that handle the immersive modes
grew the pane's *allowance* and left it pinned at the dragged size. Hence `height: auto !important`
on the fullscreen/hide-panel rules. It is **beaten, not cleared**: that height is the player's saved
preference for ordinary rooms, and dispatching `lookpaneauto` (the hangar bay's seam) would delete
it for good on a passing glance at the road. **The flight sim and the helm had the identical bug**
and are fixed in the same commit — if you add an immersive mode, it needs the same line.

**Fullscreen is the flight sim's rules, copied** *(2026-08-14)*. The cab had invented its own and got
both halves wrong: it hid `#sidebar` and `#input-row` (the elements are `#output`,
`#look-resize-handle` and `#bottom-input-wrap`, so two of three selectors matched nothing), and it
took `#area-pane` out of the flex column with `position:fixed` — which left the pane's own 12px
padding and `overflow-y:auto` around a wrap asking for 100% of a height nobody had set. A cab inset
from every edge with a scrollbar, which is exactly what "it doesn't expand" looked like. **Don't
leave the column, grow in it** — the approach already proven on fsim, helm and passenger.

---

## The gearbox, and why it shipped with the sound

Eight speeds and a splitter. `,` and `.` shift, `/` splits, `x` is the clutch, `c` is the Jake.
The cab shows the gear, whether you are in the band, and — as a hint it never acts on — which gear
the band wants. An automatic here would be the game deleted.

**The inversion is the whole system.** In `flight-model.js` an aircraft's `s.rpm` is a first-order
follower of the throttle. For a truck it runs the other way: **engine speed is DERIVED from road
speed × gear ratio**, and the throttle makes *torque*. Everything else falls out of that one change
— lugging, over-revving, why a grade has to be planned at the top, and why skip-shifting is correct
empty and wrong loaded. Nothing enforces any of it but the curve.

Three details that were each wrong once and are load-bearing:

- **Clutch slip is automatic below `LAUNCH_MPH`, and only on the throttle.** Geared rpm at rest is
  zero, so without it every pull-away stalled. But protecting the same window on the way *down*
  made the stall unreachable, so the launch window is throttle-conditional, with a separate,
  slower `CRAWL_MPH` auto-clutch underneath it — because parking must never stall you.
- **`slipping` is keyed on SPEED, not on rpm.** Keyed on rpm, sixth and eighth pulled away
  identically and better than first, which is the opposite of a gearbox. Slip transmits 45% of
  torque, so launching in a tall gear is possible, slow, and eventually a stall.
- **The splitter is written the long way** because the one-liner chained on `truckShift`'s return
  value, which is a GEAR NUMBER — so a split into neutral was falsy and left `split` lying.
- ⚠ **An upshift cannot be gated on reaching the top of the band** *(2026-08-19)*. `autoShift` asked
  for `rpm > hi` and nothing else, which reads as obviously right — wind it out, then take the next
  one. What it misses is that **a gear's terminal speed is wherever drag balances torque**, and
  `torqueAt` is already falling away above the band, so a truck that has stopped accelerating
  plateaus *just under* `hi` and stays there: the dash prints a taller suggested gear, the driver can
  see it, and the box never takes it. On the Courier that put 8th at **97.6 mph against a 104 mph
  top speed** — a figure that assumes bobtail on dry asphalt — so loaded, or anywhere off the paved
  centreline, the top ratios were unreachable and the automatic simply stopped shifting halfway up
  the box. The gate is now `rpm > hi` **or** the next gear still pulling (`rpm × ratioNext/ratioNow
  ≥ lo`), with `bestGear` still having to agree first. Both clauses are load-bearing: the second is
  what escapes the plateau, and the first is what gets **first into second at all**, where the drop
  genuinely does land under the band. 1→2 is unchanged on every truck; everything above it comes
  down about 8%.
- **First gear is boosted past what the ratio says** (`FIRST_BOOST` in `flight-model.js`).
  `ratioBoost` is normalised against top and **square-rooted**, which is right for the middle of the
  box and quietly flattens the one gear every yard manoeuvre and every hill start happens in. It is
  applied to the **ratio term, never to `spool`** — the pedal lag stays as it is, or first goes back
  to being the go-kart switch that `spool` was added to fix. Reverse borrows it, as it borrows the
  ratio.

### The clutch is not optional, and there is a key in the barrel *(2026-08-16)*

The box is **not synchronised** — nothing in a class 8 is — so **a gear only goes in with the clutch
in, and trying it without grinds the box into neutral**. Every route into a gear (the H-gate, the
slot buttons, the range switch, `↑↓`, `,`/`.`, the splitter, `R`) passes one gate, `shiftGate` in
[cab-view.js](../client/game/js/panels/cab-view.js), so the rule is written once. Two things never
grind, because they don't in a truck either: **pulling it OUT into neutral**, and a box already in
neutral.

⚠ **Reverse is the third, and it is the one exception in the gate** *(2026-08-19)*. `R` dips the
clutch for you and lets it straight back up, so selecting reverse can never grind. That is not the
old auto-clutch creeping back: the justification is already written into reverse's own guard, which
is that it can **only be selected stopped**. There is no version of that shift where the automatic
foot is covering for a mistake worth charging for — what it was actually charging for was backing
onto a dock while holding a wheel and a throttle against a pedal. The dip honours a hand that is
genuinely on the clutch (or the latch), so nothing is left holding it down afterwards. Every other
route into a gear is unchanged and still grinds.

What this replaced was an **auto-clutch on both shift paths** — taking hold of the lever dipped the
clutch for you (with a CLUTCH IN plate announcing it) and a sequential key dipped it for 320 ms. The
effect was that the pedal existed and was never the reason anything worked. It also produced the
complaint that closed the loop: *"I keep losing acceleration after shifting."* You weren't — the
shift had put you in neutral and nothing said so.

- **The grind is audible, visible and billed.** A scrape, a red pulse on the plate, and
  `truckevent grind` → `grindSplit` in [damage.js](../plugins/trucking/damage.js). It lands on the
  **engine alone** (a gearbox bar would need a label, an item, a price and a HUD row to say what the
  engine bar already says) and it is deliberately tiny — 0.4% a time, worse under load. One grind is
  nothing; a leg of them is a bill. Server-side rate limit, and it never narrates.
- **The clutch pedal LATCHES on a tap.** That is what pays for the rule on a device with one
  pointer: a hand on the pedal is a hand not on the lever. Same `input.clutch` the pedal and SPACE
  write — a second latched flag would be a second clutch.
- **`K` is the ignition**, and off is a real state rather than a pause: it *is* the stall flag, so
  the audio, the lifter wash, the gear readout and the parked pose all follow without learning a
  second "not running". Starting routes through the same `input.starter` the stall restart uses,
  which is why it only catches with the clutch in or the box in neutral.

### The shifter is an H-gate, because the box is a 4×2 *(2026-08-14)*

Eight forward ratios is not a ladder you climb — it is **four slots in an H with a range lever that
does them twice**, which is what a real range-change box is. The `GATE` table in `cab-view.js` holds
positions in the plate's own 0..1 space and a *slot* number (1-4), never a gear; the gear is
`slot + range*4`. That one line is what makes it a tree rather than eight hard-coded holes, and why
a nine-speed later is a number and not a layout. Reverse has its own dogleg; neutral is the
crossgate everything passes through.

What it replaced was a **throw** — drag up, clunk one gear, spring back. Honest for a sequential box
and wrong for this one: it made eight ratios a queue you had to walk (three drags to drop three
gears for a hill) and told you nothing about where you were. **A gate is also a display**, which is
most of what a gearstick is for.

Three rules hold it together:

- **`truckSelectGear` is a new primitive, not a loop over `truckShift`.** A sequential control says
  "one more"; a gate says "that one", and walking the box up would clunk seven times on the way.
  Same two writes, so the cab's clunk, the audio bump and everything downstream are identical.
- **The range is DERIVED from the gear, never stored beside it.** `,`/`.` and the ▲▼ buttons walk
  the box knowing nothing about a gate, so a remembered range goes stale the first time anyone uses
  a key — the knob sitting in slot 2 while the truck is in 6. `paintGate` re-derives it every frame.
- **One door for choosing a gear.** The gate, the R button and the R key all arrive at `selectGear`,
  so the "reverse only at a stop" rule is written once and cannot drift.

The ▲▼ buttons stay: a lever you can only work by dragging is a lever a keyboard user does not have,
which is the same reason they were added in the first place.

**And the voice is not polish, it is the tachometer.** `FE_VOICE` gained a `truck` row — low core,
low pulse rate at high depth (slow cylinder firing is *why* a diesel sounds like one), heavy
crackle, almost no bite. More importantly the **ground-roll layer was ungated from `onGround`**: it
was written for a taxiing aircraft and a truck is on the ground for the whole drive. It now reads a
`ROLL_SURFACE` table on the `SURFACES` pattern, with a deliberately short tau, so **drifting onto
the shoulder is audible before it is anything else** — half a second before the speed bleeds and
well before any text says so. An aircraft passes no `s.surface` and behaves exactly as before.

---

## The rig — one scalar, and the weight behind it

`hitch` at a depot puts a box on the fifth wheel; `unhitch` drops it. Both ask the **model**, not
the verb, whether they are allowed — `canHitch` is a speed and an angle, and a docking rule enforced
in two places is two rules, of which the player only feels one.

**Everything people mean by "it handles like a semi" is one free variable.** The kingpin sits a
fixed distance behind the tractor's rear axle, so the only thing not already determined is the
articulation angle φ:

```
ψ̇ = (v·sin φ − a·θ̇·cos φ) / Lt        φ = θ − ψ
```

Nothing in there is a rule about trucks. It is the geometry, written down honestly, and three things
fall out of it that are not coded anywhere:

- **Jackknife is emergent.** Past ~55° the sin term stops restoring and starts driving. There is no
  jackknife state and no jackknife check — there is a constraint, and it does what constraints do.
- **Reversing inverts it for the cost of a sign.** Backing up makes `v` negative, which turns the
  restoring term divergent: the trailer stops following and starts running away. That is the whole
  reason backing one is a skill.
- **The mirrors are an instrument, not decoration.** φ is invisible from the driver's seat by every
  other means, so `drawCabMirror` draws the box at its true angle, reddening past the fold. Without
  that, backing a trailer is guesswork and jackknifing is something that happens *to* you.

**Weight is applied where it physically belongs, and that is not everywhere.** Rolling resistance
grows with the weight it is slowing, so it stays a constant deceleration and is **not** divided by
mass — a loaded truck coasts to a stop about as readily as an empty one. Aero, the service brakes
and the engine brake are fixed forces fighting a bigger number, so they are — which is why a load
lengthens the **stop** rather than the roll. Getting that backwards makes a load feel like a debuff
instead of like weight.

Three bugs of one family were found building this, and all three were *the same bug*: **a penalty
large enough to be a wall**. A 20-tonne load could not move; reverse could not back out of a bay;
loaded, first gear could not pull away. The causes were different every time —

- **a gear never multiplied torque.** `drive` read the throttle and the band but never the ratio, so
  every gear pushed identically and the box was distinguished only by where it put the revs.
  Invisible bobtail, fatal loaded. (The regress case that asserted *third beats first* was pinning
  the bug.)
- **a slipping clutch transmitted 100% of the engine's drag but 45% of its drive.** Pulling away,
  the engine was fighting itself.
- **reverse borrowed first gear**, and being capped below the crawl window it never left the
  slipping clutch. It is geared deeper now, as a real box does it.

**Brake temperature is where the gearbox pays off.** The service brakes turn speed into heat; the
Jake dumps it out of the exhaust. Loaded and riding the pedal down a grade, they fade in about five
seconds — the pedal stays where it is and stops doing as much. On the Jake in the right gear they
stay stone cold. The cab shows a word, not a number, and goes amber before it fades, so a driver who
is paying attention gets to do something about it.

**Cargo needs a trailer.** That one line is what makes bobtail a real way to drive rather than the
state you are in before the game starts: no φ to manage, no weight, and the truck is genuinely
quick.

**The text rung drives the box too.** `revs up` / `revs down` / `revs 4` / `revs split` /
`revs neutral`, plus `boot`, `cruise`, `coast`, `brake` and `jake` — each one the typed half of a
key the cab already has, reaching the same `stepTruck`. The distance a tick covers is **derived
from the sim**, not a constant with a gear-shaped modifier bolted on, which is the only reason
picking the wrong gear can cost a text driver anything. The tick prints what the cab shows: the
gear, whether it is pulling or lugging or screaming, the speed, and the brakes when they get hot.

Two things shape it:

- **Every command is one a visual driver's keystroke also sends**, so this is one model with two
  input surfaces rather than two games.
- **Steering, and therefore the trailer, are deliberately absent.** Holding a line needs a
  continuous input and a typed `left a bit` is not one — it would be a chore wearing agency's
  clothes. A text driver runs on the auto-steer that already exists, and nothing a haul is *gated*
  on requires the half they cannot reach.

They are `revs` and `boot`, not `gear` and `throttle`, because the **flight plugin already owns
both of those words** (`gear` is landing gear) and two plugins claiming one verb is a coin-flip
decided by load order. The regress manifest sweep is what catches that class of collision.

---

## Four trucks, four silhouettes — and every control reachable

**The mesh.** `buildTruck` was one crude box set handed to all four types, with the trailer welded
on even bobtail — which quietly undid the fleet ladder, since the whole reason to want the next
truck up is that it is visibly a bigger animal. It is now a **proportion table** (`TRUCK_SHAPES`)
the same builder runs four times, so a fifth truck is a row and never a function. The Barrow is a
stubby cab-over on a single axle; the Continental is a tall conventional with a bonnet, a sleeper
hump, twin stacks and doubled drive wheels. Raked glass, side windows, a grille, headlamps, saddle
tanks and mirrors on arms — and, on a hitched rig, a separate trailer body with its own bogie and
mudflaps, which is also the seam a future articulated draw hangs its angle on.

Two rules that were each a bug first:

- **`variant` is a fourth channel, not a new `cls`.** The whole renderer switches on `cls`, so
  which-of-four-trucks and is-there-a-trailer ride alongside it. Every existing caller passes
  nothing and gets exactly what it got.
- **The mesh centres itself on its own origin, through a `Set`.** The tractor is laid out forward
  from a nose anchor, so a bobtail sat entirely in the front half of the box and would have drawn
  ahead of where the truck actually is. And `box()` shares each corner vertex between the three
  quads that meet at it — walking `faces` and subtracting per reference moves the same corner three
  times and shears the model apart. It did; the regress case caught it.

**The dealer's line now has a schematic.** `drawWireframe3D` — the CRT turntable the aircraft
dealer already used — takes a variant, so every card on the depot panel turns a live wireframe of
the *actual mesh* rather than showing three numbers in a table. Owned trucks draw with a trailer,
dealer stock without: what you have is a working rig, what is on the lot is a bare tractor.

⚠ **It is sized by the CARD, not by the mesh** (`fill` / `fitRef`, [wireframe-plane.js](client/game/js/panels/wireframe-plane.js)).
The mesh library is not drawn to one scale — a truck is about a quarter of an airframe across — so
the focal that frames a Twin Otter left every rig a ~50px doodle adrift in a 440px panel, which is
what the line first shipped. `fill` measures the silhouette and scales it to fill the viewport, and
two things about that measurement are load-bearing. It is taken over a **full turn**, never at the
yaw about to be drawn, or the model breathes as it spins — biggest side-on, smallest nose-on — which
reads as a zoom nobody asked for. And it is taken off **`fitRef`, the biggest mesh in the family**
(the highest tier the dealer stocks, by data — no type id is written into the client), because
fitting each rig to its own frame draws the cheapest one exactly as big as the flagship and deletes
the tier ladder the line exists to show. The fit is cached per mesh+viewport; it projects every face
two dozen times over and must never reach the frame path.

**The cab.** The dash was the one flat fill in a scene otherwise built from procedural canvas
textures, and it is the surface a player looks at for twenty minutes at a stretch. It now takes a
memoised moulded-vinyl texture through the same `getTex` registry every wall in the city uses
(overlay blend, so it adds surface without shifting colour), and carries a **binnacle** — two real
dials in the scene, the tachometer with the torque band painted on its arc — plus the top arc of
the wheel rim cut off by the frame, which is most of what makes the view read as *sat in a seat*
rather than as a camera on a bumper. The DOM readouts stay: they are the accessible record and what
a screen reader gets.

**Every control works by key, mouse and touch.** The gearbox, clutch and Jake were keyboard-only,
which on a tablet meant the whole of phase 1.5 was unreachable — you could drive but not shift, so
you were stuck in whatever gear you started in. There are now on-screen buttons for shift up/down,
the splitter, reverse, clutch, Jake and steering, all on pointer events so mouse and touch are one
code path, sized to 44px on coarse pointers.

**Keyboard steering goes through the wheel widget, not around it.** A keyboard driver could
accelerate, brake and shift, and could not *turn* — which is not a harder way to drive, it is not
driving. `setHeld(±1)` winds the same angle a hand drags and hands straight back to the
self-centring on release, so the wheel you are steering with is always the one on the screen.

---

## The scale house — weight, not contraband

> **Two laws, one gate.** The weighbridge is below. The scale house ALSO runs a cab check, which
> is a separate law that knows nothing about weight — see *And somebody looks in the cab now* in the
> hitchhiker section. Keep them apart: the moment the weighbridge learns to recognise a person, the
> sentence this whole building rests on stops being true.

The one idea in this system that is native to trucks rather than borrowed from somewhere else in
the game. Your manifest says the box holds 3,600 kg of scrap. The weighbridge says 4,400. **It does
not know what the other 800 is — it knows you lied.** Everything worth having follows from that one
sentence:

- **Detection keys off the DISCREPANCY**, never off a tier lookup of what you are carrying. So the
  counter-play is hauling less or declaring more, and both cost money. There is no smuggling skill
  that makes a heavy trailer light.
- **A legal overweight load fails the same scale.** Getting fined for honest greed and getting
  caught smuggling are the same interaction — which is exactly the Cross Country Canada texture, and
  is what makes a trailer's plate rating mean something.
- **It announces itself**, in the room and on the road. The whole design is a decision taken before
  an inspection you can see coming; a scale you cannot see is a dice roll, and a dice roll is not a
  system.

**Why it is not the checkpoint plugin.** `plugins/checkpoint/` is a `registerMoveGate` — it fires
when a player *walks* onto a tile. A driver never walks; trucking's own move gate blocks it. So the
scale hangs off the drive (`afterDrive`, shared by both rungs so the law is literally one function),
and a checkpoint on the same yard still searches the *person* who climbed down. Two laws, two
surfaces, no overlap: one weighs the trailer, the other searches you.

**The asymmetry was already in the content.** Buzzard Field is `lawless: true`, so the Reach end
never scans — Coldwater→Reach is the smuggling run and the return is the one where you sweat.

Three answers, each a real trade: **`customs open`** eats the loss and carries *no charge* (the
professional's move, and the reason being caught is not automatically a disaster), **`bribe`** is
priced off the size of the lie and is worse than opening if it fails, **`bolt`** is free if you make
it and otherwise a charge and an **impound lot** you buy the truck back out of at a fee priced off
the lie, not the truck.

`stash` is what makes any of it a decision: something goes in the trailer that is not on the paper.
There is deliberately **no roll** on stashing — hiding it always works. What it does is add weight,
and weight is the thing the scale can see.

**The verb stays flight's.** `customs` is one player-facing concept and flight already owns the
word; two plugins claiming it is a coin-flip decided by load order. Trucking answers through a
`TRUCK_CUSTOMS` action — the same seam the checkpoint plugin uses to run a drug scan through
smuggle without importing it. Neither direction of dependency is created.

---

## Trailers, and people on the shoulder

**A trailer is a row, not a boolean.** Drop one and it stays dropped, with its load still on it, and
somebody can walk up to it. Two rules shape it: `parked_zone`/`towed_by` are exclusive and the
**database** enforces one-per-truck through a partial unique index (two drivers racing for one box
is a lost `UPDATE`, not a duplicated trailer), and a trailer may only stand where a zone will still
exist tomorrow — **never a transient void room**, which is torn down with the crossing and would
turn somebody's freight into a row pointing at nothing. Deck capacity moved onto the box, too: the
truck pulls, the trailer carries, and buying a bigger tractor no longer buys capacity it does not
have.

**Stock is stood outside, at a pose, because a trailer you cannot see is not a thing in a place.**
`yard buy <flat|box|reefer|tank>` used to park the box in the **bay** with no pose at all, and both
halves of that were invisible: a bay is a building interior with no grid coordinates, and
`trailersNear` draws only *posed* rows. So the cab's trailer-air knob lit, named the trailer, and
there was nothing on the picture to back under — while `hitch`, which waves an unposed row through
by design, coupled to it from across the yard. A bought box now stands on the **hardstand**, nose
out to the road (the same heading `drive` points the truck at, derived from the facade's
`entrance`), stepped alternately either side of the lane out so a second purchase does not land
inside the first. From that moment it is an ordinary dropped trailer and the manoeuvre is the same
one. ⚠ **The pose must stay inside the apron tile** — `hitch` only searches the depot's own three
zones, so a box stood a tile up the street would be drawn, driven up to and then *refused*; hence
`stockPose`'s clamp rather than a longer row of boxes. The unposed path is untouched and still
hitchable from anywhere, which is what stops every trailer already in the world being stranded.

Two consequences worth knowing. The cab now draws standing boxes from **the zone you are in *and*
the yard your rig belongs to** (`drawZones`) — you mount on the *door* tile and the stock stands on
the *hardstand*, so with a single zone id a trailer feet away did not exist until the wheels crossed
the boundary and then appeared out of nothing. And a bare `hitch` takes the **nearest one in reach**
rather than the oldest row, because a yard now routinely holds several of your own boxes a few feet
apart.

**And it is on the floor, in three dimensions** *(2026-08-18)*. The depot's floor scene drew the
FLEET and nothing else, so a trailer standing ten feet outside the roller door appeared on no screen
in the building — the yard is where you buy one, and the yard was the one place it did not exist.
The scene now takes the boxes standing *here* as well, at `~s` (the solo mesh, the same variant
`trailersNear` draws out on the hardstand) and at a length derived from the **rating**, exactly as
the world renderer does it — a trailer row carries no mesh of its own and its capacity already says
how big it is, and if the two derivations disagreed a box would change length when you walked out of
the shed. ⚠ **A box on the floor is not a selection**: every pane, the bench and the toolbar read a
fleet row, so clicking one is ignored rather than emptying all three.

**A box you own is now on a screen** *(2026-08-18)*. `trailersOf(player.id)` was read by the depot
panel and **thrown away** — it existed only to work out which of your *trucks* had something on the
pin — so the rows themselves reached neither rung. A bought reefer had a receipt, a place on the
hardstand and nowhere a player could read: findable only by climbing into a cab and looking out of
the window at it, or by typing `hitch` at a thing you had to take on faith. The payload carries a
`trailers` list now (what it is, where it is, what is on it, with `where` resolved server-side for
the same reason a truck's `whereName` is — the depot names live in zone flags and the panel has
never seen them), the floor screen lists it under the deck read-out, and `textYard` prints the same
list as **YOUR BOXES**. It is a list rather than a second turntable on purpose: a box is a capacity
and a place, and neither of those is a thing you look at from three angles.

**Hitchhikers are seeded facts, not NPC rows** — a corridor node is transient, so an NPC whose home
is deleted when the crossing ends is the wrong machinery. `hitcherAt` is a pure function of route
and node, so the same stretch has the same person on it for everyone this week and both rungs see
them with nothing to keep in step. Four kinds, and you cannot tell which from the roadside.

**The fugitive closes the design.** They ask where they should ride, and the fork is the whole
system pointed at a person: **the sleeper** is fast and free and anyone who looks in the cab finds
them; **the trailer** is invisible to a look and is *eighty kilos the weighbridge can see*. Letting
them out a mile short of the plates is a real, unscripted play, and it is free.

### You can see them now, and the seed was broken *(2026-08-20)*

Everything above was true and almost none of it reached a driver. A hitcher's entire presence was
**one emote at the moment you crossed a node boundary** — so a driver who was looking at the gearbox
drove past a person they were never told about, and nothing on the glass, in the room or out of the
windscreen said otherwise afterwards. Four things changed, and one of them is the reason the feature
read as absent rather than as quiet.

**The seed was broken, and it turned the roll from per-stretch into per-week.** `seed()` hashed
`route.key` — a field a route does not have (it carries `voidKey`, `destKey` and `seedKey`), so every
corridor out of every region hashed the literal string `'road'` and met identical people on
identically numbered stretches. Worse, it took **raw FNV-1a as its fraction**, and FNV's avalanche
across a string whose only variation is the trailing digit is poor: a week's eight nodes came out
inside a band about **0.03 wide**. Against a 0.34 threshold that is not a one-in-three chance per
stretch, it is a coin flip for the **entire road** — twenty-four eligible stretches across three
consecutive windows produced *zero*. It now uses the corridor's own `hashSeed` + `mulberry32` pair
(mulberry32 is the half that avalanches), keyed on the real road identity, with the KIND drawn from
its own stream rather than resliced out of the presence roll. ⚠ **This changes who is on every
existing stretch**, which is unavoidable and costs nothing to migrate — a hitcher is derived at read
and never stored. Regress now samples twenty weeks and asserts both the rate and that no week is
all-or-nothing; every check that existed before passed throughout the bug, because they all asked
whether a hitcher was *well-formed* and none asked whether one *existed*.

**They stand on the road.** `cabContext` ships a `hitcher` — token, kind and an absolute tile
position derived from the corridor (half a room along their node, `t` just past `pavedAt`'s paved
half-width, so on the verge and on the side you would pull onto). ⚠ **Not an entry in `actors`**:
that list is walked by the client's own mover, which interpolates between pushes, picks a gait and
snaps each figure to its tile's KERB — none of which exists out here, and a hitcher is *defined* by
not going anywhere. So they ride their own field and `drawRoadside` paints them standing, through
the same `drawActorFigure` and the same depth sink, with one raised arm. The arm is the only thing
about them that is not the stock silhouette, and it is the difference between a bollard and an ask.

**The alert stays up.** A card on the glass while they are ahead of you, with a PICK UP button that
sends the **bare** verb — the fugitive's sleeper-or-trailer question is the verb's to ask, and a
panel that pre-empted it would be making the one decision the system exists to put in front of you.

**A stretch you have worked is spent.** `hitcherAt` is pure, which is what makes the road consistent
and also means it answers with the same person forever — so dropping somebody off where you found
them put them straight back on the shoulder with their hand out. `rig.hitchDone` is a per-rig,
memory-only set of node indices, deliberately *not* persisted: that you have dealt with them is not
a fact about the road, so another driver still meets them and so do you next window. `state.js`,
`index.js` and `textdrive.js` all consult it, so both rungs agree. `pickup`/`dropoff` now force the
push (`pushCab` is throttled on the centre tile, and a pickup happens at a standstill by definition
— without it the figure went on standing there and the button went on offering to pick up somebody
already in the seat).

**And somebody looks in the cab now** *(2026-08-20)*. The design has always said the sleeper is fast
and free and *anyone who looks in the cab finds them*. Nothing ever looked — every path out of a
hitcher read the TRAILER — so a fugitive in the passenger seat was 400₵ at no risk and `pickup
sleeper` was strictly the right answer, which left the trailer's eighty kilos buying nothing.
`runCabCheck` (scale.js) runs off `afterDrive`, so both rungs get it.

⚠ **It is a separate law, and it must never become the weighbridge.** The one rule this building is
built on is *weight, not contraband* — the scale compares your trailer against your paper and does
not know what the difference is. Teaching it to recognise a person collapses that into "the scale
finds smuggled things", which is exactly the generic scanner the scale house was designed not to be.
So two laws are enforced at one gate and neither knows about the other: one weighs the box, one
looks through the windscreen. The **trailer** rider is still the *scale's* catch, as eighty kilos
that are not on the paper — the right answer, reached without anybody knowing what the eighty kilos
is. Regress asserts a cab check leaves the weighbridge's verdict untouched.

⚠ **It runs bobtail**, which is what made the feature reachable at all: `runScale` returns
immediately with nothing on the pin (correct for a weighbridge), so a driver carrying a person and
no trailer was inspected by nothing.

⚠ **There is no roll, no bribe and no bolt**, and all three absences are the same argument. The
three answers at the weighbridge exist because a discrepancy is *arguable* — a wet load, a long
night. A person sitting in your bunk is not arguable. The design's sentence is that anyone who looks
**finds** them, and a Deception check against an officer holding the door open makes that sentence a
lie. The skill is in the decision a mile back: the trailer, the other route, or not stopping. That
certainty is what the eighty kilos is paying for.

Only the **fugitive**, and only **in the seat** — giving a mechanic a lift is not a crime, and a
check that took everybody would make the other three kinds unpickable on any lawful road for a
reason nobody could name. Charged as `harbouring` (2★, `witness: 'always'` — the officer looking IS
the witness, and there is no version of this where nobody saw it), deliberately below smuggling: you
moved a person, not a product. A lawless region runs neither law, so the Coldwater→Reach direction
is still the free one and the return is still the one where you sweat.

---

### The doors, and letting yourself in *(2026-08-20)*

A hitcher used to arrive exactly one way: you typed `pickup`, which is a decision, made on purpose,
with the whole system in front of you. Real doors do not work like that. Stop with the passenger
side open beside somebody who has been stood on a verge for six hours and they will get in, and you
will find out about it when they shut the door.

So the latch is the actual control and `pickup` becomes the **invitation** rather than the only way
in. Two routes to a passenger, and what separates them is something you did or forgot to do a mile
back — the same shape as everything else on this road. `lock` / `unlock`, the `Y` key, or the latch
button on the glass chrome, which reads out the state it is IN rather than the action pressing it
would take (a control labelled with its own action is fine for a horn and wrong for a lock, where
the entire question a driver has is *is it down right now*).

⚠ **It defaults to UNLOCKED, and that is the feature.** A latch that starts down is a latch nobody
ever meets: the first time it would matter is the first time it saves you, which is to say never,
because nothing would ever have got in. Starting open means the mechanic teaches itself — somebody
climbs into your cab, and from then on you know what the button is for. It persists per truck in
`custom_data` beside paint and trim, so no new column and so learning it only has to happen once.

⚠ **A self-boarder always takes the SEAT, never the trailer.** You did not open the trailer — nobody
climbs into a sealed box off their own bat, and if they could the latch would quietly become a way
to smuggle a person without ever deciding to, with the weighbridge finding people the driver never
chose to hide. So an open door can only hand you the *visible* version of a passenger: the
weighbridge is never surprised and the scale house's cab check always is. **The latch is the thing
standing between an idle fuel stop and a harbouring charge.**

⚠ **The dwell is not decoration.** A speed gate on its own fires on any slow crawl, so a driver who
eased off for a bend beside a hitcher would acquire a passenger they never saw coming and could not
have prevented. Three seconds at a genuine standstill (`BOARD_MS`, `STOPPED_MPH`) is a *stop*, and a
stop beside somebody with their hand out is a thing you did. Driving off resets the clock.

⚠ **`lock`/`unlock` are ENGINE builtins and plugins beat builtins.** They belong to
[commands/doors.js](../server/engine/commands/doors.js), so registering them naively points every
apartment door, shop shutter, cell and hatch in the game at a truck — failing everywhere at once, in
a way nobody would connect back to trucking. `cabLatchRouter` is narrow and **falls through**
(returns `undefined`, the chess `move` pattern): it keeps the verb only when you are behind a wheel
*and* said nothing after it or named the cab. `lock apartment` from a rig parked in your own garage
still locks the apartment, and regress asserts all three cases.

`tryDoorBoard` lives in `state.js` and is called from both drive ticks, for the same reason
`afterDrive` lives in scale.js: a law that is two functions is two laws, and the rungs would drift.
⚠ On the text rung it sits **outside** the node-crossing branch — the event is about standing still,
and a rig that is standing still crosses no boundary, so inside that branch it would have been
unreachable by construction.

The hitcher card on the glass says which it is (*"Doors are open. Stop for a moment and they will
get in by themselves"* vs *"Doors latched — pick them up if you mean to"*), keyed on the person **and**
the latch, because keyed on the person alone a driver who locked up mid-approach went on reading a
card that said the doors were open. It states the fact and never editorialises: stopping with the
doors open is a legitimate way to pick somebody up.

---
## The driver, not the truck *(2026-08-20)*

Every instrument on this glass read out the **truck**. The damage strip covers the rig, the fuel
gauge covers the tank, and the person in the seat had no readout at all — so a driver could die of
thirst on a long haul looking at a full set of green instruments, with food in the bunk, because the
only surface that could answer *"what have I got"* was the tablet and reaching it meant leaving the
windscreen.

**The band.** Top centre, over the road rather than beside it, because it is not a reading — it is
an interruption, and a driver watching the vanishing point has to catch it without looking anywhere.
Two rungs: **amber** early, while there is still road to do something about it, and **red, flashing**
once it bites. Red is `hunger === 0` / `thirst === 0`, which is exactly where `gameLoop.js` starts
taking HP — the flash is not a prediction, it is the damage, reported. Thirst is named first when
both are up, because it kills twice as fast (−2 HP a tick against hunger's −1). It says a WORD, not
a percentage: a number is something you monitor, a word is something you act on.
`prefers-reduced-motion` drops the animation and keeps the colour, and the band writes its text only
on change — it sits in an `aria-live` region, and reassigning identical text is what makes a screen
reader say "HUNGER" forever.

**The galley** (`T`, or the flap on the glass chrome). Bars for food and water over a list of every
consumable in the pack, one button per row, each sending the ordinary **`eat`/`drink` verb string a
player could have typed** — the preparation HUD's rule, and it is why the payload ships literal
commands. There is no cab-only eating path and nothing here re-derives whether a thing is edible.
Eating refreshes the list rather than closing it.

⚠ **It is answered on demand, never on the push.** `cabContext` runs several times a second on the
drive, and an inventory join in it is a remote round trip *per push* on the hottest path this plugin
owns. So the list is the `galley` **verb**: one query when the flap opens, and never again until it
opens again. The vitals cost nothing at all — hunger and thirst are already on the live player
object and already reach the browser on every `player_update`, so the band and the bars are drawn
from what the client had anyway and can never disagree with the log's own vitals rail. They are
polled off the cab's existing frame loop at 4 Hz rather than hooked into `render.js`, because wiring
the log's vitals path to a truck is a wire between two things with no other reason to know about
each other.

⚠ `T`, not `G` — `G` has been cruise control since the box was built, and so had every other obvious
letter for "food". That is what a cab with twenty-odd controls costs.

---

## Ground scatter is sized in pixels, and a pixel is not a unit of the world *(2026-08-20)*

*"The people in the city seem tiny."* They were, for two reasons that compounded.

Every building in `windshield.js` is **projected** — a wall is a world-z height run through
`cam.proj`, so it tracks the focal length and the canvas. The ground scatter is not: trees, bushes,
bollards, street lamps and the figures on the pavement each carry a hardcoded constant over `p.f`,
and those constants were eyeballed once against the flight sim's 560px-tall strip (`focal = H*0.55`,
so ~308). The cab is the **whole window**, so its focal length is larger, everything projected in
the frame grows — and the people stayed the same number of pixels. They did not shrink; the world
grew past them.

And the constants were wrong to begin with. The depot bay is the one building around this camera
with a known real size (`BAY.RIDGE` = 2.2 storeys = 26 ft, so ~61 ft to the world-z unit — the same
unit that fixed the cab's eye height), and the actor drawer's stock `17` works out at **3.4 ft of
person**: a bollard with a head.

So `propS(k, f, lo, hi)` scales those constants by `_propK`, the ratio of this frame's focal length
to the one they assume. At 560px it is exactly 1 and **every existing aircraft frame is unchanged**.
⚠ **The clamps scale with it too** — a floor and ceiling left in raw pixels re-introduce the same bug
at both ends of the range. `v.propMul` is the per-seat override on top, and the cab passes **1.75**,
which puts an adult at about 5 ft 10 and takes the street furniture up with them. It is sent for
**both** seats, unlike `eyeH`/`fovMul` (those are interior-only because they would move the *rig*
when the chase camera anchors its model against them; this moves nothing but the scatter, and the
chase view looks at the same street).

The aircraft is deliberately left at 1. The constants are just as wrong up there, but nothing in
that view is ever close enough to the ground for it to read, and a silent change to nine other
cameras is not what a truck window is for.

---

## City driving — the city as a destination

Phase 4, and worth being precise about what was actually left in it. Both halves as originally
specified — *real-tile driving inside regions* and *building collision off the footprint* — shipped
back in phase 1: the rig has always had a `city` leg on real `map_world` tiles, and
`groundObstructionAt` has always made buildings solid. What was missing was a **reason**. The city
was a corridor: you drove through it to reach the edge of the map and you never had cause to go
anywhere *in* it.

**A loading dock is a business that takes freight** — `flags.loading_dock` on the drivable street
tile outside it, content-authored exactly as a depot is. Docks in a region are mixed into that
region's boards, which does three things at once: the city becomes a map you navigate rather than a
strip you traverse, the fleet ladder gains a bottom rung (a local run pays about a third of an
in-region depot job, needs no crossing, and is affordable in a Barrow with a flatbed — the whole
entry kit), and `market` stops being the only thing to do with a truck you cannot yet afford to
take across the waste.

**Delivery needed no new code.** A contract already keyed on a zone id, so a dock was a destination
for free — the payoff for having written it that way, and a case now keeps it true.

**One slot is always a crossing**, and that rule exists because adding docks nearly broke the system
by accident. Six docks against one other in-region depot meant a seeded four-slot board could come
up *all local*, and a player standing in the yard would never be offered the run across the waste.
The waste run is the game; being shown it has to be a certainty, not a dice roll. The regress suite
found it by no longer being able to find a crossing to take — the test failure and the bug were the
same fact.

## Damage, per component *(2026-08-13)*

⚠ **This supersedes rule 1 at the top of `rig.js`** ("condition is a scalar; there is no damage
model"). That rule was right for the system it was written for — a truck you drove until a bar went
down and then paid to put back up. What broke it is that the truck became a thing you **crash**:
with real collision geometry, four hundred miles of gravel and a rebound off a wall are the same
event to a single scalar, and they are not the same event.

Four components, each earning its place by answering something the others cannot — **engine**
(makes power; wears with distance and abuse), **wheels** (hold the road; wear with distance and
*much* faster off the tarmac), **body** (holds the shape; wears with **nothing but impacts**, so its
bar is a history rather than a maintenance schedule), and **trailer** (its own `trailers.condition`
column, because a box outlives the tractor that towed it and damage that followed the truck would
heal every time you swapped trailers).

Three decisions carry it:

- **The headline number survives, and is now derived.** `trucks.condition` is still a column, still
  persisted, still what resale, the five bands, `repairCost` and the breakdown roll read — it is
  computed by `overall()` instead of written directly. That is the whole reason this was affordable:
  nothing downstream of the truck's health had to learn that components exist. The bag lives in
  `trucks.custom_data.dmg` (no new sparse columns), merged with `jsonb_set` so a flush from the road
  cannot clobber a tune committed at a bench.
- **The weakest link, not a mean** — weighted 0.6 worst / 0.4 average. An average lets a pristine
  engine hide destroyed wheels, and the destroyed wheels are the thing about to end your evening.
  A truck with one dead system reads as a dead truck, because it is one. **At parity the derivation
  returns exactly the old number**, which is the migration invariant that made switching a live
  fleet net-zero; regress asserts it at five points across the range.
- **The body has no mechanical effect, ever.** It costs resale and it costs how the truck looks, and
  it must never quietly make you slower — the moment it does it is a second engine bar with a
  different name. Regress asserts `partEffects` is identity for a destroyed body.

Impacts route off an `area` token the client sends with `truckevent` (`front`/`rear`/`side`, derived
from the direction of travel and how much lock was on). **Every area costs the same total** and only
the destination changes, which is what makes an unverifiable client fact safe to trust: a side
scrape is a tyre bill, a nose-first hit reaches the engine, and reversing a loaded rig into
something is charged 80% to the *trailer*. Nothing is cheaper to hit.

At a bench, `rig repair shop engine` fixes one component and charges a third of the whole-truck
bill, so three targeted repairs cost the same as one whole one and there is no arbitrage. The
default stays whole-truck — nobody should have to learn a parts vocabulary to keep a truck running.
In the cab, a four-pip strip sits bottom-left and opens into labelled bars (`D`); the client
computes no band and no colour, it renders `cabContext.dmg`.

**The bottom of the bar is a wall, not a steeper slope.** At or below `TERMINAL_CONDITION` the next
tile breaks the rig every time and `fix` refuses outright — a truck at zero is not a truck with bad
luck, it is scrap that is still moving. A roadside `fix` now needs a `item_truck_spares` box (spent
on the **attempt**, not the success) and Fabrication ≥ 12, which is what makes `tow` reachable at
all: paid, a low-loader takes you and the rig home; unpaid, it is recovered and held against the
fee on the existing `impound_fee` path that `drive` already settles. So nobody is ever stranded and
nothing new stores the debt.

⚠ **A bay has no coordinates, and `towFee` used to measure from one anyway.** *Fixed 2026-08-21.*
The fee is a call-out plus a rate per tile of the straight line between where the rig sits and
where you are standing — but every depot **bay is an interior**, and all 324 interiors in the world
carry `grid_x`/`grid_y` of **0**, which is not a position, it is the absence of one. That produced
two opposite wrong answers depending on which end happened to be the shed:

- **shed → shed**, across two regions: `hypot(0,0)` = **zero tiles**. A cross-waste recovery cost
  the bare call-out.
- **shed → hardstand** (the common path — `persistTruck` writes `depot_zone = rig.zoneId`, a real
  tile, and `yard recall` is typed *inside* the bay): `hypot(871, 1958)` = **2,143 tiles**. Fetching
  a Krell Barrow quoted **10,038₵** for a truck that costs 1,300₵ new; a Continental quoted 21,365₵.

`towGrid()` resolves a coordinate-less zone to the **hardstand outside its door** — the tile a
recovery driver actually drives to, already named by `truck_depot.yard` — and returns null when
there is honestly no answer (a transient waste node has no row at all), which bills the nominal
40-tile call-out rather than guessing at a long haul. **0,0 is treated as no-coordinates, not as a
place**: the mapped world starts at `grid_x` 726, so a zero pair is always an unset column.

⚠ **`TOW_MAX_FRAC` caps the bill at 40% of the truck's list price, and that cap is the structural
half of the fix.** The measurement now works; the cap is what stops this *class* of mistake from
ever producing an absurd bill again, because the distance term reads content rows and content can
always grow a row whose coordinates are not where the thing is.

Repriced alongside it — call-out 260 → **200₵**, per-tile 7 → **2.2₵**, and the `heft` divisor
9,000 → **5,000** so the spread across the ladder survives the list-price cut below. A full
Coldwater→Reach recovery now runs ~520₵ (Barrow) to ~1,510₵ (Continental), against a crossing haul
that pays 676–1,664₵. It costs you **the run, not the truck** — which is the choice the verb was
always meant to be, where before it was a wall.

---

**A wall pushes back; it does not arrest you.** ⚠ *Revised 2026-08-13 — this section previously
described a crash as a crime and a dead stop, and both halves are gone.*

An impact used to charge `vandalism` through the witnessed-crime system past `RECKLESS_MPH` on the
city leg, on the reasoning that you have destroyed somebody's property in the street. In the
abstract that is correct. In practice it was the one consequence in the sim nobody could consent
to: the corridor is narrow, the **buildings are its walls**, and the collision probe is a geometric
sweep with no notion of intent — so an ordinary bend taken slightly wide put stars on a driver who
was doing the job properly. A wanted level you acquire by *steering* is not a crime system, it is a
tax on the render distance. Nothing is charged now. (If deliberate ramming ever wants charging, it
needs a test for INTENT — repeated impacts on one structure, at speed, off-route — not a speed
threshold on an accident.)

The other half was the physics. Contact put the rig back at its last clear position and set the
speed to zero, which left it nosed **into** the geometry with the throttle still down: the next
frame collided again, at whatever speed the pedal had rebuilt, and the log filled with identical
impact lines. It now **rebounds** — pushed back along its own heading with a fifth of its speed,
reversed and capped at walking pace — so the two bodies separate and you can drive out of it
without hunting for reverse against a wall. Reporting is floored (`REPORT_MPH`) and rate-limited on
both sides: below it the impact still *wears* the rig, it simply does not narrate, because the
jolt on the glass and the rebound have already said it.

The load still takes it: freight that has just been through a wall is worth less, and the contract
pays on what arrives.

---

## Breakdowns, the fork, wipers and the radio *(2026-08-11)*

The four things the proposal named and the build never reached. Each is small; each was the reason
some already-built system did not quite land.

### A truck that can actually fail on you

Condition wore, cost power and brakes, and made a derelict occasionally refuse to start — all of
which are **numbers you read in a yard**. Nothing the bar did could happen to you at sixty miles an
hour with a hundred tiles of nothing in each direction. Now a breakdown rides the same distance the
wear does, off the same number, on the same frame (`breakdownRoll` in [rig.js](../plugins/trucking/rig.js),
applied in `reconcileTruck` and in textdrive's `burn`, so **both rungs obey it**).

Four rules, each a decision not to build the obvious version:

1. **It is always the condition bar's fault, and you were told.** The chance is *zero* above Tired
   and climbs as the square of how far below it you are — roughly 1% per crossing at the bottom of
   Tired, 20% at Ailing, 60% at Derelict. A random failure on a Sound truck would make every haul
   arbitrary and every repair pointless, which is the opposite of what condition is for.
2. **No damage model.** The table picks the *prose*, not a broken component — a coolant hose, a
   dead lifter pod, a bled fuel line, a turbo, a brake line. Condition stays one scalar.
3. **A fix buys distance, not health.** `fix` is a roadside attempt gated on Fabrication whose
   odds *escalate with every failure* (certain by the fourth go, so nobody sits in the dark rolling
   dice). Success clears the failure and grants `FIX_GRACE_TILES` of immunity — it does **not**
   move the bar. So a broken rig limps to a town, and the bench keeps its job.
4. **It never strands anybody.** You can always climb down and walk: the drive *is* the crossing.

**Abandoning it now has a price and leaves a mark.** Parking mid-crossing used to write the *void
room* as the truck's depot — and those rooms are transient, so the instance was torn down behind
you and a rig you owned was parked at an id with nothing on the other side of it: unfindable,
undrivable, unsellable. It now goes back to the yard it left and wants a recovery fee, through the
**`impound_fee` path the scale house already owns and `drive` already knows how to settle**.
Abandonment and confiscation ending in the same lot is exactly right.

### The fork is a junction you can take

Coldwater's void forks toward the Reach and toward Exodus, and `leaveTheMap` took `dests[0]` —
the first row of the table, forever. That quietly made **half the map unreachable by road**:
Terminus is *designed* as a truck destination (deliberately beyond the range of the two cheapest
rigs, so the fleet ladder doubles as a map gate) and no truck could ever be pointed at it.

The aim comes from the **load first** (a contracted run knows where it is going; asking twice would
be ceremony), then from `route`, then the first limb. `route` with no argument lists the
destinations with their distance and whether your tank reaches — in a yard it sets the aim, and out
on the road it **takes the other limb**, which is legal only while the fork is still ahead of you.

The invariant that makes that safe is new and load-bearing: **the trunk is one road**. Every
destination shares the crossing's first `trunk` rooms, so `corridorFor` now seeds the trunk
centreline *without* the destination and only the limb with it, and never lets a segment straddle the
boundary. Before that, the two roads diverged from the gate — and changing your mind would have
teleported the rig sideways onto tarmac that had been somewhere else the whole way. The boundary
also forces a bend, so **the junction is a bend you can see** rather than a room name changing.
(Since the curve rework in §1b that is a real sweeper rather than a 90° jog, and its arc length and
tightness are both destination-seeded — see the note there on why direction alone was not enough.)

### A parked rig sits down, and both headlamps are on the screen *(2026-08-12)*

The variant grammar is now `<typeId>[+t][~p]` — the last flag is **parked**, and it is a real pose
rather than a dimmer switch. A truck that holds itself up on light is holding itself up on
something you can switch off, so a shut-down rig **settles the full ride height onto its lifters**
as one rigid body and the emitter bands and road-glow go out. Standing next to one that was still
hovering with a cold engine was the tell that the hover was decoration. The depot passes `~p` on
every rig it draws, because everything in a shed is parked. (The chin spoiler's lip had to come up
above the ride height for this — a chin that reaches lower than the lifters puts the nose through
the floor when it settles.)

The **walkaround now opens at the door**: the eye starts just off the near-side step at a driver's
height, close enough that CLIMB IN is already lit. It used to open four units out on the diagonal,
outside the board radius, so the first thing anybody did in the walkaround was hold W.

**And the headlamps are now tested, not eyeballed.** The same bug shipped twice — first buried in
the grille surround (the sort showed one lamp and ate the other), then at a fixed height that
cleared a bonneted truck's bumper and sat exactly *behind* a cab-over's, so the two cheapest rigs
had no visible headlamps at all. Neither is catchable by asserting on geometry: the lamp was always
where the code said it was. So [truck-lamps.mjs](../scripts/shapes/truck-lamps.mjs) renders the
depot scene through a **recording context**, replays the polygons in draw order, and asks the only
question that matters — after everything in front of it is painted, is any of this lens still
visible? It runs in `shapes:smoke`, needs no browser, and was verified to catch a deliberate break.
The rule the placement now follows is written down: **a lamp clears the bumper in z and stands
ahead of it in f, on every variant.**

### The shed stopped blinking *(2026-08-18)*

The depot's cutaway — how much of the shed is faded away so you can see your own rig inside it — has
had a continuous distance term since it was written, with a comment saying why: *"the ramp between
them is what stops a wall blinking out on one notch of the wheel."* The other **two** inputs to the
same answer were booleans, and they blink for exactly the same reason:

- **Is the eye above the eaves** — a doorstep at 0.9 × WALL. Orbiting the chase camera walks the eye
  up and down across it, so one notch of pitch flipped the whole shed between solid and opened-up.
- **Is the rig inside it** — a containment test. Rolling out through the door flipped it the instant
  the truck's centre left the footprint, so the walls snapped back on behind you and off again as
  you rolled in.

Both ramp now, and both ramp on the side that used to be a hard zero, so everything that was fully
cut before still is. ⚠ **The eye band bottoms out at 0.80 × WALL, not lower**: the chase camera down
on the road sits a little under the eaves and the shed must be *solid* there — that is the pose the
whole occlusion agreement is built on, and `bayOccluderSmoke` fails the moment the band reaches far
enough down to open the walls a crack. The band only has to be wide enough that the eye cannot cross
it in one notch of the orbit; it does not have to be gentle.

The smoke now sweeps both inputs finely and fails on a step no continuous function could take, which
is the only way this is visible from outside the renderer — and `occludedCount()` joins
`rasterCount()` as a test seam, because a building culled when it should have drawn is a hole in
the city that the frame simply comes back without.

### The thrust reads as thrust *(2026-08-18)*

The lifter cones were already keyed on the **direction of travel** rather than on the gearbox — the
pods behind the middle fire astern to push the truck forward, the ones ahead of it fire forward to
push it back, so reversing looks like reversing from the outside. What they were not was *visible*:
the plume threw about a third of a pod's length and the cone's ramp started nearly-white and washed
out evenly, which reads as a tint on the road rather than as something coming out of the machine.

The gradient now has a **hot core and a long tail** (clipped white at the throat, holding its blue
most of the way down), and the along-plume throws about a truck's own width at speed and starts
hotter than the column underneath, because it is the end doing the work.

### Retro-future, on purpose *(2026-08-12)*

The mesh had drifted into "20th-century semi with a light strip". The brief is a 1957 idea of what
a truck in 2100 looks like, so: **vertical chrome grille teeth** with a turned **bullet** in the
mouth of them, **dagmars** on the bumper, quad headlamps under a chromed brow, a **chrome spear**
tapering down each flank, **tail fins** off the back corners of the cab with a red lens in each,
stacks that finish in a **flared nozzle** with fins round the base, a **whip aerial** with a ball on
the end, and a chrome trim band round every lifter — which is also what stops a pod looking like a
black brick when its emitter is off, i.e. whenever the truck is parked. All of it is `fine`-gated,
so a distant contact still costs what it did.

### The horn is the loudest thing in the yard, and it says so once *(2026-08-18)*

Two changes that pull in opposite directions on purpose. The **sound** has no cooldown and must
never get one — a horn is meant to be leaned on, and three quick blasts is a thing drivers do. The
**sentence** has a 60-second per-player gate, because three identical lines in everybody's log is
not a horn, it is what makes somebody scroll past the line that mattered. The driver's own line is
on the same gate, which is the half that actually matters: their sound already played locally before
the verb ever reached the server, so a suppressed line is a horn that sounds and does not narrate.
Silence, not a refusal — nothing has gone wrong. The stamp lives in RAM on the rig (or on the player,
for somebody honking a parked truck); nothing about a noise deserves a DB write.

And it is **loud**. The gains were doubled once already off a bandpass fix and it still sat under
the engine bed — a driver leaning on the cord could barely hear it over their own idle, which is
exactly the wrong way round for the loudest object bolted to a truck. Doubled again (0.15 → 0.34),
and the held loop went to **priority 4**: a cab already has a bed, a damage loop, weather and
whatever the street is doing, and at 2 the one cue that must be heard was competing with ambience
for a voice and losing it silently — which is indistinguishable from a horn that does not work.

⚠ **Every truck has its own voice.** `HORN[typeId] || HORN.drayman` hides a missing row: a new truck
silently borrows the Drayman's trumpets and nobody ever finds out. The fallback stays (a borrowed
horn beats a silent one) and regress now asserts every ground type in `TYPES` has a row of its own,
so adding a truck without a voice is a red suite rather than a mystery.

### Wipers

The proposal called this the one gap and the most evocative thing left, and it is the smallest: the
drop state was already `{x,y,r,life,streak}` beads that already blend between gravity and
slipstream by speed². The blade **clears the glass it passes**, progressively, re-anchoring swept
drops at the top — without the cull it is a stick waving over unchanged rain, which is worse than
no wiper. And it **parks**: off returns the arm to the bottom rather than freezing it mid-pane.
One stalk (`V`, or the button), off → intermittent → low → high, and the control **asks once** when
rain starts and the stalk is off. Client-side entirely; nothing about a wiper is a fact about the
world.

### The CB, and wrecks from real hauls

Lines fire on **node crossings**, not a tick — the radio costs no scheduler and can never talk over
a truck standing still. Half of it is true: a **wreck ahead is reported by name** before you reach
it. Wrecks are not scenery — one is left on the verge every time a driver gives up on a rig out
there and walks, at the exact tile they stopped, with the model they were in and who they were.
They are **RAM-only on purpose**: the corridor is transient and the window rolls weekly, so a
wreck's address stops existing on the same clock the road does. What that costs is a clean road
after a restart; what it buys is that every hulk out there is from a haul that happened this week,
to somebody you can still ask about it. Capped at twelve, or a corridor stops reading as "somebody
died here" and starts reading as a scrapyard.

### The CB is a channel other drivers are on *(2026-08-16)*

Everything above is *our* voice. This is the half where the voice is somebody else's:
`cb <words>` transmits to every other rig tuned to your channel, anywhere in the world.
Code: [cb.js](../plugins/trucking/cb.js) (server), [cb-radio.js](../client/game/js/panels/cb-radio.js)
(client), a knob on the cab's switch panel, and **Deadhead**, a tablet app
([cb-app.js](../plugins/tablet/cb-app.js)) that is the Chat app pointed at one conversation.

Five decisions, each of them a decision not to build something bigger.

**The set is in the truck, and that is the whole access rule.** A listener is a rig in `rigs` with
the radio on, tuned to your channel — no membership table, no subscribe, no per-player row, and no
way to be on the air while standing in a bar. Mounting puts you on it and dismounting takes you off,
because the state that decides is state the drive already keeps. ⚠ `getPlayerChannels`
([channels.js](../server/engine/channels.js)) is deliberately **not** touched: that list is computed
once at login, and a radio you are on for the eleven minutes of a crossing is not a thing to hand
somebody at login.

**It is RAM-only and nothing is replayed.** A CB is live; what was said while you were off the air
is gone. No `channel_messages` row, no history query, and no DB write on a path players will
absolutely spam — the same call [systems-nullcraft.md](systems-nullcraft.md) makes about trace. The
scrollback in the Deadhead window is the **client's** copy of what it heard this session, which is
exactly what a radio gives you.

**Channels are 1–40 and everybody starts on 19.** A frequency nobody can guess is a frequency nobody
is ever on, so the real CB convention does the discovery: 19 is where the traffic is, 9 reads as the
emergency channel to anyone who has seen a film about trucks, and the other thirty-eight are private
rooms you have to *tell* somebody about — which is the point, because a channel number is a thing
you say out loud on 19.

**⚠ Everything that is not one of four control words is speech.** `on`, `off`, `speaker` and a bare
number are the only reserved forms; everything else transmits, because the commonest thing anybody
does with a radio is talk into it and a verb whose default action is a settings change would be
absurd. The cost is that `cb off` can never be said out loud on the air — a fair trade for `cb on`
meaning what it says, and the four are listed in the bare-`cb` status line so nobody has to guess.

**One event, three sinks, and no sink may be the only one.** A transmission arrives as a single
`cb_msg` and lands in the log (its own `msg-cb` class, so `trigger @cb …`, routes, gagging and
highlights all work on the radio without being taught what a radio is), in the Deadhead window, and
in the **speaker** if it is switched on. Building it as a chat message that also gets logged, or a
log line a window scrapes, would make one of those three the truth and the other two a copy — and
the copy is the one that silently stops working. It is deliberately **not** a `channel_msg`, which
reaches the chat panel and nowhere else: at the `log` rung that would be a radio for some players
only.

**The speaker is the accessibility feature that is also just what a truck radio does.** It reads
incoming traffic aloud through [logreader.js](../client/game/js/logreader.js)'s own queue, voice and
rate — CB traffic only, never the whole log — because the person whose eyes are on the windscreen is
exactly the person who cannot also be reading a chat window. It never reads **your own** transmission
back to you: you know what you just said, and a radio that echoes you is a fault.

Two notes for anyone touching it. The knob is a `role="spinbutton"` and **decides nothing** — it
sends `cb <n>` and moves when the server says it moved, the same contract the hitch button follows;
a dial that snapped locally and then corrected itself would be worse than one that took 40 ms. And
the Deadhead conversation is created **on an arriving message as well as on tuning**, because a
driver at the `textgames`/`log` rung is in [textdrive.js](../plugins/trucking/textdrive.js), which
pushes no cab context at all — traffic arriving is the event they definitely get.

### Parking at a yard opens the yard *(2026-08-18)*

Walking into a depot has thrown the screen up since the walk-in rebuild, and climbing down inside
one did not — which is backwards, because the end of a haul is the moment you have the most to do: a
load to deliver, a tank to fill, a bill at the bench. The reason it never fired is mechanical rather
than considered — the auto-open rides `zone.entered` and is skipped while driving, and **parking
enters no zone**; it is the moment "while driving" stops being true. `parkRig` now builds the same
panel the hook does, through `depotHere` (you stop on the **apron**; the bay is where the truck is
stored, not where the driver is standing) and answering for **both rungs** — `depotPanel` hands the
log rung prose, and prose is a message rather than a panel. Abandoning a rig out in the waste is
deliberately excluded: there is no yard there, and the line about the low-loader is the whole
answer to what happens next.

### The shed you start in

*(2026-08-16.)* `drive` mounts you on the door tile with the engine running, so **the first frame of
every haul is drawn from inside `drawVehicleBay`** — which makes it the first thing a new driver
sees and the only model on the map that has to work as a room. It did not. Four things were wrong at
once and each one has a rule attached now.

**A building's height is measured against the EYE, not against a storey.** The eaves were `0.115`
world-z and the cab's camera sits at `eyeH: 0.17` (cab-view.js), so the driver's head was *above the
roof*: you sat looking over your own building at the far gable, and the shed read as an ankle-high
kerb with a lid. `bldgH × bldgStretch` makes one storey ≈ `0.196` in practice, so the shed is now a
tall single storey — `WALL 0.30` at the eaves, `RIDGE 0.43` — which is overhead from the cab and
still shorter than a three-storey neighbour from the air.

**A room near-clips; a thing you look at does not.** Every other model here is external, so a quad
with any vertex behind the camera can be thrown away whole and nobody sees it. In a room the floor
and the roof both pass *under and over* the eye, and throwing the quad away deletes the floor you are
parked on. `bayFace` clips each polygon against the near plane instead (one convex clipper, also used
to cut the door's hazard hatching to its box — `f` is affine in world x/y, so the crossing point is
exact). ⚠ **Ground paint stacks, it does not sort.** A floor slab's average depth is the middle of
the room, so every marking beyond that point sorts *behind* the slab and vanishes under it — hence
`layer`: floor, then markings, then the world back-to-front.

**The cutaway is keyed on the SUBJECT, not the eye.** In the external chase the camera is 1.6 tiles
astern and well above the eaves, and the own-ship is painted after the entire world pass — so it wins
every argument and reads as a truck seen *through* a roof. When your rig is standing in the shed and
the eye is above its eaves, the roof is not drawn and anything nearer than the tile centre is culled
with it. ⚠ Both halves are needed: cutting only the roof leaves the back wall, and a wall occludes a
truck exactly as well as a roof does.

**The door measures the DOORWAY, not the tile.** `open` came off the distance to the tile centre,
which is ~0 on the frame you mount — so the door was already up and you were already outdoors, in a
building you never saw. It is the distance to the aperture now, with a tight sensor from inside
(`BAY_IN_SENSE` < `HL`, or it lifts on frame one) and the generous street-length one from outside.
It starts shut, comes up as you roll at it, and shuts behind you for free. There is still **no door
in the physics** — `groundObstructionAt` opens the whole bay tile — and that is deliberate: it is
fully up well before your bumper reaches it, and a door that can trap a player in a shed is worse
than one you could theoretically drive through.

What that bought, since the volume had to be rebuilt anyway: the floor is the **road's own asphalt**
(`SURFACE_COL.asphalt`) carried indoors with an apron tongue out past the threshold, so the tarmac
runs unbroken from the shed to the street; yellow **markings** — a drive lane straight out of the
door, two trailer bays down one side, three numbered tractor stalls down the other, and a hatched
keep-clear under the shutter; **portal frames** with rafters to the ridge, which is what the eye uses
to read the volume as tall; **high-bay lighting** that barely dims at night, because a depot that went
black at 8pm is a building you cannot park in; roof lights that are bright by day and dark after it
(they are sky, not lamps); and a site office with a lit window and a row of drums against the back
wall.

**And the mass follows the drawing.** ⚠ **The bay is the one building whose height is a SHAPE, not a
storey stack**, and it has to be: it is the only building with a camera inside it, and a floor count
cannot promise the eaves clear the driver's eye when `bldgStretch` is a live dev-panel slider. So
`floorHeight` returns the shed's real ridge for a bay and `floorsOf` returns what that ridge is
*worth* in storeys (`BAY_FLOORS`) — the first keeps the render, the ground shadow, the occlusion
pre-pass and `buildingHeightZ` on the same roof, the second lands the feet-frame CFIT altitude on it
too. Without the pair the shed drew at `0.43` and collided at `0.196`, and an aircraft flew through
the top two thirds of a building a truck cannot drive through the wall of. Two more things fall out
of that: **`modelFor` returns null for a bay**, because the tile still carries `bt: 'truck_depot'`
and every model consumer would otherwise use that arm's captured segments for a tile the arm never
drew; and `modelTopAt` answers off the gable directly, needing no capture. ⚠ Raise `RIDGE` and you
must raise `BAY_FLOORS` with it — `shapes:smoke`'s **bay** gate fails if they drift, if the eaves or
the door head drop back under the driver's eye, or if the truck-sized hole in `groundObstructionAt`
ever closes.

---

## Filth — the road on the outside of the truck *(2026-08-20)*

*Built.* A rig that had just come four hundred miles up a graded shoulder looked exactly like one
that rolled out of the paint booth that morning. Distance already reached the wear bars, the tank
and the breakdown die; not one of those is a thing you **look at**. This is: the truck goes brown,
the wheels throw dust, and a hose at the depot puts the paint back.

`plugins/trucking/filth.js`, and it is small on purpose. Three rules carry it, and each one is a
decision not to build something.

**It is cosmetic, and that is load-bearing.** Grime touches no parameter, no roll and no price
anywhere in the plugin — it is not a fifth damage component wearing a different label. The moment a
filthy truck is a *slower* truck, washing stops being something you do because you want to and
becomes maintenance you resent, and [the damage model](#damage-per-component-2026-08-13) already
owns "the bar you have been ignoring is the die you are rolling". So `partEffects` never sees this
number, `overall` never sees it, and `trucks.condition` is untouched. Regress asserts it directly:
four hundred tiles of open country moves the grime bar to its cap and moves the condition by
literally nothing.

**It is one scalar, unlike damage — for the mirror of the reason damage is four.** Damage is four
components because a rebound off a wall and four hundred miles of gravel are genuinely different
events a driver must be able to tell apart and price separately. Dirt is not: everything that
dirties a truck dirties all of it, the answer is always the same hose, and a per-panel filth model
would be four numbers that always move together and one bill.

**It accrues on distance, never on the clock** — the rule fuel and wear already follow. A truck
standing in a shed while you read a job board does not get dirty, because nothing is happening to
it. Rain is the one thing that moves the number the other way, and it moves it on distance too: it
is the road throwing water at you, not weather passing over a parked truck.

⚠ **And rain is not a car wash.** It knocks the dust off and leaves the film — anybody who has
driven a wet motorway knows a truck comes out of it grey rather than clean. A downpour can only ever
pull the bar down toward `RAIN_FLOOR`, never to zero. If weather could finish the job, a wash would
be a thing you *wait out* rather than a thing you buy.

The multipliers deliberately read like `WHEEL_SURFACE` in `damage.js` without being it: tyres care
about abrasion and paint cares about what is in the air, which is why the graded shoulder is nearly
as bad as open country here and half as bad there. The tarmac is **not zero** — a highway at speed
does throw grit, and that is half of what makes the effect worth having — but it is tuned so a full
crossing on good road arrives *used* rather than filthy. A number that saturates on every run has
stopped saying anything.

### Where it is drawn

**One conversion, four painters.** `client/shared/truck-livery.js` already existed precisely because
a truck is rendered by the cab, by the depot turntable, by another driver's relayed contact and by a
parked box — and a conversion written down twice is a conversion that is wrong in one of them (it
had already happened once, with `pattern`). So grime is a **second argument to that same function**,
and every renderer inherits the dirt without knowing dirt exists.

It is a **tint, not a texture**. The models are flat-shaded facets and there is no muck map; what
the driver is owed is the flank going brown, the badges going quiet and the chrome dying, and those
are all colour. Three sub-rules:

- ⚠ **It never reaches the muck colour.** `GRIME_MIX_MAX` caps the mix, because mixing all the way
  makes every truck in the fleet the identical brown at the top of the bar — which deletes the paint
  job the player bought, and the whole point of a wash is that there is something underneath worth
  uncovering.
- **Brightwork dies fastest and the lamps do not die at all.** Polished metal is the first thing a
  road takes; a lamp's colour is light coming *out*, so muddying it would read as a bulb failing
  rather than as a dirty truck.
- **The finish is derived.** A gloss coat under enough dirt is a matte coat, and the renderer
  already knows how to draw one — so past the point where a shine could survive, `finish` becomes
  `matte` rather than being a second thing an author has to keep in step with the muck.

### The dust, and the glass

`drawRoadFilm` in `cab-view.js`, over the windscreen canvas after the world and the rig, because it
is between them and the eye. It draws **two things that share a cause and must never disagree**:
`grime` is the history, and `st.dust` is the moment. A single number could not be both — a driver
who came off the shoulder onto tarmac would go on ploughing an invisible field.

It is **drawn, not simulated**: the windscreen is a 2D overlay over a Mode-7 world, so a real dust
volume would need depth it cannot have and a frame budget the cab is the tightest consumer of. What
a driver actually reads is a warm haze low in the frame that pulses with the throttle and dies when
they stop — two corner veils rather than one band across the floor, because a band reads as *fog*
and a pair reads as **wheels**, which is the one thing the effect has to say.

⚠ **The specks are hashed, not rolled.** A `Math.random()` per speck per frame is boiling static
that reads as television snow rather than as dirt; each speck's lane and lifetime come from its own
index through a stable hash and it moves on a clock, so it drifts past you. Same reason the world
renderer's star grain is hashed. They rise, because the air off a turning wheel goes up — dust that
fell would read as snow.

⚠ **And the film never hides a contact.** It is a wash over the outer frame, capped at `FILM_MAX`
and heaviest in the corners and along the bottom of the glass where a blade does not reach. A driver
must never fail to see a truck coming because of a cosmetic system: the moment dirt costs you
information, washing stops being taste and becomes a tax. The wiper stalk **thins** it and never
clears it, because a dry blade on a dusty screen smears, which every driver knows.

### The hose

`rig wash`, at the bench, and the depot panel's Condition tab carries the button and the price.

⚠ **It is a `rig` subcommand and not the verb `wash`** — the same trap `rig strip` documents. `wash`
belongs to the **mis** plugin (it is how you get clean, and it is consent-gated), plugin verbs are
first-come, and a truck one would have silently shadowed it for every player in the game the moment
they stood at a sink. The bench is where the rest of the work on a truck already happens anyway.

**It puts back nothing but the colour.** No condition, no component, no part consumed, no skill
check — there is no version of washing a truck you can be bad at, and a fabrication roll on a hose
would be the system claiming a competence that is not in the fiction. It is priced off the **dirt**
and not off the truck (a Continental is not four times the work of a Krell), and it is cheap on
purpose: it must never compete with diesel for the same credits, or "should I wash it" becomes
arithmetic instead of taste.

⚠ **The row and the live rig are the same truck and must agree.** A wash writes `custom_data.grime`
and *also* zeroes the number on the mounted rig if that is the truck being washed — otherwise the
flush on its next park writes the value it is still holding, and every mile of dirt goes straight
back onto a truck the player just paid to have cleaned. For the same reason the depot panel quotes
the **live** rig's number when it is showing the truck somebody is sitting in: the row's copy is
only ever as fresh as the last park.

Storage is `trucks.custom_data.grime`, beside `dmg`/`tune`/`paint`, flushed by the same coalesced
`persistTruck` UPDATE and nested one `jsonb_set` deeper — so a wash committed at a bench while a rig
is out cannot be clobbered by that rig's flush.

---

## Fittings — thirty-eight things that do nothing *(2026-08-20, widened 2026-08-21)*

*Built.* Paint says what colour your rig is. This says what you are like. A truck is the one
possession in this game a player owns outright, walks around, and sees from the outside every time
they climb into it — and the whole of that expression was seven colours and a flash, so two rigs
with the same paint were the same truck.

Thirty-eight cosmetic fittings across eight slots, running on one deliberate axis: the waste at one
end (ram plate, tusk bar, saw-blade skirt, riveted plate, totem rack, bleached skull) and the strip
at the other (chrome push bar, halogen light bar, underglow tubes, lifter halos, stack sleeves,
chrome runner), with most of the range in the middle where a working truck actually lives — a jerry
rack, a winch, a chain rack, a beacon, a banner pole. `plugins/trucking/fittings.js` is the catalog
and every rule; `rig fit` is the till.

### The waste half, and the eighth slot *(2026-08-21)*

The first cut shipped twenty-four fittings weighted toward the show truck, and **the map is the
argument against that**: the road runs out of Coldwater into the Scarletwastes, and a catalog that
could only dress a strip rig meant every truck on the long haul looked like it had never left the
city. Fourteen more, most of them at the waste end — a **grader blade** hung on an angle so what it
catches goes sideways, a **spike rack** of sharpened rebar, a **roof parapet** cut low at the front,
an **aerial farm** of mismatched whips, **soot pipes**, a **spear rack**, a **hide drape**, **drag
chains**, a **scrap hopper** with a chute pointed at whoever is following, a **water bowser** with a
tap on the outside, and a **wheel idol** stood upright on the bonnet facing the road.

They still say nothing mechanical (rule 3 below): **a bowser carries no water, a hopper drops
nothing, a slit plate stops no bullet.** What they carry is a claim about where you have been, and
the claim is free — the moment the waste kit is the *fast* kit, the look is a tax and everybody
converges again.

The eighth slot is **`glass` — the screen**, holding welded **screen mesh**, a **slit plate** with a
hand's width cut out at eye level, and a **sun strip**. ⚠ **A new slot goes in its walking position
and never moves an existing one past another.** `SLOTS` is the sort key `fitSuffix` makes the wire
string canonical with, so reordering two slots that both have something in them rewrites the
mesh-cache key of every truck already wearing them. `glass` went between `bar` and `roof`, which
leaves every existing pair in the same relative order — that is the only reason it was free.

⚠ **And everything in that slot lives in the windscreen's own raked plane, standing ahead of it.**
The screen is a single `poly`, the painter's sort gives a face *one* depth, and the rule the grille
fins are placed by applies word for word — *nothing on the face may share a fore-aft slice with the
panel behind it*. So the pieces are quads in a parameterised copy of that plane (`scrP`, 0 at the
sill to 1 at the header, pushed forward by `SD`) and not one of them is a box: a box has a fore-aft
thickness, the plane is raked, and a box on it is a brick lying against a slope. Regress asserts
every screen fitting draws on **all four rigs**, which is the one claim that can be made for the
whole fleet — a stack sleeve has nothing to hang off a scrapper and a mascot moves to the cowl on a
cab-over, but every truck in the game has a windscreen.

**Price tracks metal and nothing else, on purpose.** It is not a ladder — a ₵400 skull on the bonnet
is not a worse ₵3,200 light bar, it is a different sentence — because a catalog that reads as a
progression makes everybody feel they are supposed to end up at the top of it, and then everybody's
truck looks the same again.

### The three rules that make it cheap

**1. It is a list of ids and nothing else.** `trucks.custom_data.fits`, an array of short strings in
a JSONB bag that is already written on every bench commit. No table, no column, no join, no tick, no
per-frame server work — the whole feature costs one existing `UPDATE`. Every number that could have
been stored per truck (where a bar sits, how long a stack is, what colour a tube glows) is derived:
geometry from the catalog id and the truck's own shape, colour from the paint the player already
bought.

**2. The wire cost is a suffix on a string that was already being sent.** Every renderer of a truck
— the cab, the depot turntable, the dealer wireframe, another driver's relayed contact — already
threads a `variant` string (`<typeId>[+t][~p]`, aircraft3d's grammar). Fittings ride it as
`^ab.cd.ef`. Nothing new is broadcast, no payload grows a field, and a rig in a pilot's windscreen
wears its owner's bull bar for free. ⚠ That is also why the codes are two characters — this string
is on every contact in every window four times a second — and why `fitSuffix` sorts by slot: the
string is a client **mesh-cache key**, so the same truck described in two orders must produce the
same key or a rig holds one cached mesh per permutation of its own fittings.

**3. Nothing here is mechanical.** Not one fitting touches a parameter, a roll, a price or a
capacity. A ram plate does not help you win a collision and an armour plate does not soak one. Same
rule [filth](#filth--the-road-on-the-outside-of-the-truck-2026-08-20) is built on and load-bearing
for the same reason: the moment the ugly truck is the *fast* truck, a player who wants to look a
particular way is paying for it in lap time, and everyone converges again.

### The rest of the rules

**One per slot, and the slot is the whole conflict model.** Two roof racks is not a look, it is a
bug — fitting into an occupied slot *replaces* what was there and says so. There is deliberately no
compatibility matrix beyond that: a matrix is a thing an author has to keep in step with a mesh, and
the slots already say everything the geometry needs. It is enforced on **read** (`installedFits`),
not only at the write, because a hand-edited bag or a fitting that changes slot in a later build
would otherwise put two bars on one truck.

**You can take it off and it is still yours.** `rig unfit` costs nothing and refitting is free —
what you paid for is *owning* it (`custom_data.owned_fits`), not wearing it. A cosmetic system that
charges rent on your own taste is one nobody experiments with, and "take it off and see" has to be
free or the catalog is a set of one-way doors.

⚠ **It is `rig fit`, not `rig kit`.** A kit is five things that change how a truck *drives*; a
fitting is thirty-eight that change nothing. Collapsed into one shelf, a player scrolls past a bull
bar to find the auxiliary tank with no way to tell which of the two costs them a lap time. The
boundary is exactly "does this reach `effTruckParams`".

⚠ **Every place on the truck must have something you can put there.** The depot renders one cell per
slot and opens that slot's shelf when you click it, so an empty slot is a button that opens nothing
— and the sheet *is* the navigation, so there is no other way back out. Regress asserts it, alongside
the rule that **no fitting is named after a place**: `rig fit roof` is a listing and `rig fit tusks`
is a purchase, and the only thing keeping those apart is that no catalog name collides with a slot's
id or label. A collision would not error, it would silently print a shelf where somebody expected to
buy something.

### Finding what is on your own truck *(2026-08-21)*

Both surfaces were built the same way and had the same fault: eight sections, the whole catalog
under them, in one column. **The commonest question had the longest answer** — *what has this truck
got on it?* is a question about eight facts, and answering it meant scrolling thirty-eight rows
looking for the ones whose button said Remove.

So the eight facts come first, on both rungs.

**The panel** opens the Fittings tab with a **rig sheet**: one cell per place, naming what is in it
or saying *empty*, two across, four lines that never scroll. **The sheet is also the navigation** —
clicking a place opens that place's shelf underneath, four or five rows, which fits. The two halves
cannot disagree about which place you are looking at because one of them *is* the other, which is
why there is no segmented control across the top (that was the obvious alternative and it would have
been a ninth widget saying the same eight words as the cells directly beneath it). `on` (something is
fitted here) and `sel` (this is the one you are reading) must both be legible at once and therefore
cannot share a channel: `on` is the fitted name going green, `sel` is the accent border every other
selected thing in the panel wears. The selection lives on `B.bench.fslot` for the same reason the
booth's section does — a repush lands after every fit and every unfit, and a tab that reset itself
would make trying two roof racks against each other a thing you re-find twice.

**The log rung** is now three answers instead of one, and the default is the short one:

| | |
|---|---|
| `rig fit` | the **sheet** — one line per place, what is in it, and how to open that shelf |
| `rig fit roof` | one place's shelf, **with the descriptions**, which is what makes a single shelf worth asking for |
| `rig fit all` | the wall, deliberately still reachable, because somebody pricing up a whole rig wants it |

⚠ **The panel's sheet and the log's sheet are the same eight facts in the same order**, both derived
from `SLOTS` + `installedFits` — the existing rule that a shelf whose order differs between the panel
and the log is two shelves, now covering the summary as well as the catalog.

**Ownership is read off the price, not off a second list on the wire.** `priceFor` already quotes
zero for anything in this truck's drawer, so `p === 0` is exactly "you own this and putting it back
is free" — the panel's YOURS tag, its *Put it back on* button and the log's `in the drawer` all come
off that one fact, with no `owned_fits` shipped and nothing to fall out of step with the till.

### Where the geometry lives

Inside `buildTruck`, and two ⚠s explain why it could not go anywhere else.

**It is built there rather than composed outside**, because everything after that point *transforms*
the mesh — the centring shift, the parked settle, the solo ground-fit — and a part appended
afterwards is authored in coordinates the model does not stay in. That is the same bug the
`TRUCK_META.shift` note calls "floating headlights", and a bull bar is a bigger thing to have
floating in the road than a lamp.

**And it is built before `tractorFaces`**, the split point a dropped box is cut at — a fitting
emitted after it survives the splice, and a trailer standing on its legs in a yard would be wearing
somebody's roof cage. Regress asserts a solo box with every code in the catalog has exactly the face
count of a bare one.

**Nothing new is coloured.** Every part is drawn in `CHROME`, `ACCENT` or a plain `strut`/`body`
role, so it takes the player's `bright`, `glow` and `hw` colours through the existing `PK` channel —
no new key, no new paint field, nothing for the booth to learn. It is also why the neon fittings need
no colour of their own: they are `ACCENT`, so a rig with a green beltline gets green stack sleeves
for free.

**No fitting is load-bearing geometry.** Nothing publishes a pod, moves a lamp station, changes the
door rectangle or touches the kingpin — regress compares the meta of a *fully fitted* Continental
against a bare one and demands the pin, the door panel, the cab back and the pod count are identical.
That is what keeps thirty-eight parts from being thirty-eight ways to break one mesh.

⚠ **The `^` suffix is stripped before the type is read.** It can follow either the type or the
trailer marker, so the lazy `/~.*$/` strip would hand the parser a tail of `'t^rp'` and every fitted
rig would silently render bobtail — a bug that reads as "the trailer disappears sometimes".

### The light, and the cache

Two fittings are answered at the **lamp layer instead of as faces**, which is the rule written on
`pod()`: a lit patch of road drawn as geometry is a *box*, it takes the shading pass, it has edges,
and four of them read as teal paving slabs bolted to the tarmac. So underglow emits its **fixture**
(a tube has a body, and you see it from alongside) and its light comes from `vehicleLamps.neon`,
where it spills instead of ending at a corner. It wears the owner's `glow` colour — the same value
the tube's own facet is painted with, so the tube and the pool it throws can never disagree — and it
is on with the **lights** rather than with the engine, because it is tubes on a switch and not the
machine being alive. A rig parked dark with its underglow on is a real picture the existing block
cannot produce. The beacon pulses, because a rotating beacon that does not turn reads as a lamp
somebody left on.

⚠ **The truck mesh cache is now bounded, and nothing else is.** Every other class here has a handful
of keys, all resident a minute after boot. A truck's key is a whole sentence — four types × trailer
× parked × thirty-eight fittings in eight slots — and a busy yard is dozens of distinct rigs, so an
unbounded map is a slow leak keyed on *other people's taste*. Past `TRUCK_CACHE_MAX` the oldest key
goes and its `TRUCK_META` entry goes with it (dropping the faces and keeping the meta is the same
leak one field smaller; dropping the *wrong* meta silently un-places another truck's lamps). The cap
is well above any real scene — it is a runaway guard, not a working set, and a tight one would thrash
a depot floor.

---

## The bunkrooms, and not being dumped in the void *(2026-08-21)*

*Built.* Three things that were the same complaint from three directions: a driver who stops should
be somewhere.

**Parking on the road no longer strands you.** `parkRig` treated any stop on a corridor leg as
abandonment — `rig.leg !== 'city' && (broken || dry || s > 2)` — so the truck went to the recovery
lot, a wreck was marked, and the driver was left on foot in a **transient** void room with the sim
closed behind them. It fired on the ordinary act of stopping. A rig that still runs now **turns
round** (`retreat`): back to the tile you left from, still in the cab, load still on the deck and
the contract still live. Losing the diesel and the day is punishment enough for changing your mind.

⚠ **Abandonment now means what the word means** — broken or dry, where the truck genuinely cannot
move. There the void room belongs to a crossing that is still live and walking out is voidwalking's
own designed path: you are stranded by the machine rather than by the verb.

⚠ **And the turn-round happens BEFORE `dismountRig`.** `retreat` hands the driver back a *mounted*
rig, and there is nothing to hand back once park has taken it away.

**Every depot has a bunkroom.** Four cots, a bracketed television, a fridge that hums and a steel
sink, at all five yards — Kessler Street, The Roadhead, The Deadleg, The Dry Run, The Last Load.
They are deliberately **identical**, because the point is that a driver two days out knows exactly
what is waiting at the next one; only what the weather has done to each room differs.

- **Four cot rows, not one "row of cots".** A bed is a thing you lie down *on*, so one furniture row
  holding four beds is four drivers fighting over one object — and the whole point is that the other
  three can be occupied while you take the fourth.
- **The fridge is stocked by the runtime seed, never authored.** Food in a content file is food that
  reappears on every deploy and is gone forever the moment somebody eats it. `stockBunkFridges` in
  `seed-runtime.mjs` **tops up to a floor rather than refilling to a target**, which is what makes it
  safe on every import and is also the right fiction: somebody restocks the fridge, they do not audit
  it.
- ⚠ **The door takes a wall the shed is not already using.** Every shed already spends a compass
  point on the way out to the yard and most spend `down` on the utility room; a second exit on an
  occupied wall silently overwrites the door to the street.
- ⚠ **And each room got a light fixture in the same build.** A new interior authored without one is
  dark forever, and the fault reads as a bug in the lighting engine rather than a missing prop.
  `light_on` stays absent — it is excluded from content on purpose and `lightAuthoredFixtures`
  switches new fixtures on.

`flags.truck_bunkroom` is a **label and nothing more**: the cots are ordinary beds and the fridge is
an ordinary container, so the room works whether or not anything ever reads it. It exists so "where
can somebody sleep on this network" has one thing to ask.

**The lamps matter now.** The headlight numbers were tuned when the only thing that ever threw a beam
was an aeroplane on short finals, where a lamp is a detail. In a cab at night it is the instrument
you drive by, so the throw reaches further (26 → 34 tiles), spreads wider and lands harder, and the
wash it puts on frontages went with it. The dome lamp inside is now most of the interior light after
dark rather than a shade.

⚠ **And the other half is that the world without lamps is worse.** Night alone lit the road well
enough to drive by, so headlamps read as a garnish on a scene you could already see and a driver who
never found the switch never noticed. A truck running dark after dark now gets a wash of the night's
own colour — **truck only** (a landing lamp is not a headlamp), **never reaching black** (a screen
you cannot read is a bug report, not a mood), and painted on the **world** before the cab trim goes
on, so the instruments stay legible while what is beyond the glass falls away.

---

## Testing

- `plugins/trucking/regress.js` drives a **real crossing end to end** — synthetic gate, real muster,
  real `trucksync` frames — asserting every room is visited in order and arrival lands in the
  destination region. The pieces are individually cheap to fake and individually meaningless.
- The suite also pins a weekly window and asserts the road is deterministic, the centreline is
  paved with no gaps, and **every roadside `building_type` is one the renderer actually models**
  (`motel`, `silo` and `shack` were the obvious names and are exactly the ones with no model).
- `shapes:smoke` gained an **INTERIOR** gate covering the canopy, cowls, window frames and the cab,
  for the same reason the model gate exists: the only thing that ever runs one of these is somebody
  sitting in that vehicle, so a throw freezes the sim for one player and is invisible to everyone
  else. Verified to catch a deliberate break.
- Its **VIEW** gate now stands the truck **in a depot bay** (a `mark: 'bay'` tile under the camera)
  for both cab cases, day and night. Nothing else in that suite enters `drawVehicleBay`, and it is
  the one model whose faces straddle the camera — a throw in there is a black cab on the first frame
  of every haul.

**Note for suite authors:** `setLivePlayer(pid, data)` takes two arguments. A one-arg call keys the
map by the object and stores `undefined`, which every `getAllLivePlayers()` consumer then trips
over — it took down `movement.edge` and cost an hour.

---

## What's next

Every phase in [proposals/the-long-haul.md](proposals/the-long-haul.md) has shipped. The design as
written is finished, so what follows are the things the BUILDING of it turned up rather than a
remaining plan:

- **A second region with docks.** The Reach and Terminus have depots but no loading docks, so local
  freight is a Coldwater-only rung. It is content, not code — a `loading_dock` flag on a street tile.
- **A trailer you can steal.** Ownership is the one place trucking currently says no on grounds
  other than physics; an unattended box at a lawless yard arguably should not be safe.
- **The Coldwater checkpoint recipe.** `flags.checkpoint_cfg` on the yard would search the DRIVER on
  foot, complementing the scale that weighs the trailer. It is a content recipe, not a build.
