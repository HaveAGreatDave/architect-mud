# Overland Void Travel — crossing the waste between regions on foot

**STATUS: BUILT** (`plugins/voidwalking/`). Sections marked **BUILT** describe live behaviour;
everything else is the design intent behind it. The system lets players travel *on foot* between
[regions](reference/land-taxonomy.md#region--the-spatial-place-renamed-2026-07-19-from-district)
that are otherwise only reachable by air, reusing the survival, weather, danger, and perimeter
systems already shipped.

Related: [[project_wildlands_curtain]] (the near leg), [[project_the_reach]] (first destination),
[docs/systems-survival.md](systems-survival.md), [docs/systems-weather-extreme.md](systems-weather-extreme.md),
[docs/reference/land-taxonomy.md](reference/land-taxonomy.md).

---

## The pitch

Regions are islands. Between Coldwater and The Reach there is no road, no bridge, no authored grid —
just **the void**: a killing waste you cross on foot when you can't afford wings. A crossing is a
**branching roguelike gauntlet** generated on demand, thrown away when you arrive. Water is the
currency of distance; the void's wildlife and its feral people are the tax on every extra step. You
either come out the far side, or you die out there and leave your pack for the next fool to find.

Flight stays the *fast, expensive* way in. The void is the *slow, brutal, cheap* way in — and because
its salvage exists nowhere else, even pilots walk it on purpose.

---

## Core model: regions as islands, the crossing as the bridge

There is **no authored corridor** between regions. The space between them is genuinely empty on the
grid. A crossing **is** the connective tissue — a generated instance you enter at a region's edge and
exit at the destination's edge: you never traverse the grid, you traverse an *instance*.

⚠ **The distances this was argued from are no longer the distances.** The pitch here used to read
"this is what lets *The Reach is ~1,000 tiles south of Coldwater* stop mattering", and the gap is
**93 tiles**. Measured gate to gate against `content/zones/`, every leg is: Coldwater–Reach 93,
Reach–Deadwater 99, Coldwater–Deadwater 108, Reach–Scarletwastes 108, Terminus–Scarletwastes 109,
Coldwater–Terminus 282. The world compacted and the argument did not follow it.

That does not make the abstraction wrong — a seeded weekly gauntlet is a good system on its own
terms, and the room count has been *derived* from these real distances since `registerCrossingDistance`
(the fiction and the geometry agree now, which they did not when the picker was reporting 240 miles
for a 31-mile road). But the reason it exists changed by an order of magnitude, and the same gap a
walker abstracts over is one a truck now drives every tile of — and, since the road network overlay,
one a **pilot can see out of the canopy**.

## The premise, decided *(2026-08-21)*

**The gap is a country. The road is what a truck can do with it; the trail is what a person can do
with it.** One description, two readings — and the crossing is a walking trail, not a wander through
trackless nothing.

This was the last place the space between regions was still an abstraction sitting beside a thing a
truck drives every tile of. It is decided rather than inherited. Three statements, in order of how
much they carry:

**1. The country is the seed, and both systems have been holding it all along.** The road network is
rebuilt per window (`roadNetwork(window)`, [plugins/trucking/roadnet.js](../plugins/trucking/roadnet.js))
and the void is `f(route, window, node)`. **They have always shared a seed and have never shared a
single derived fact.** So the gap gets one seeded landform field per (gate pair, window) — mesas
(cliff-ringed plateau, with ramps as the only breaks in the rim), washes, scree, salt — and *both*
readings come off it. The road's bends stop being arbitrary heading changes with a leash on them:
**the road bends because there is a mesa there.** The trail's shortcut is that same mesa. One fact
seen twice, which is the whole of what "one geometry, two presentations" has to mean to be worth
saying.

**2. The trail is SHORTER than the road, and that is the trade.** The road is long *because it is
drivable* — a minimum turn radius (a correctness invariant: a tighter bend folds the verge through
itself and the odometer runs backwards through the fold), no `cliff` (the one terrain
`engine:impassable-terrain` refuses), and a gradient a loaded truck can take. It goes **round**. A
person goes **over**: up a ramp, across the plateau, down the far side. So the trail is always fewer
tiles than the road, and the currency is honest — **fewer tiles, each one worth far more.** You can
beat the truck to Terminus on foot. You probably will not arrive.

This is not invented for the void; it is the pattern the hand-painted world already uses. The
Scarletwastes road "goes round the plateau, not over it" — dropping south down the Deadleg's column
to run west *under* the cliff-ringed mesa at x1011–1017 — and Terminus' own west rim is cliff from
y943 south for the same reason. The generator does in the gap what an author already did in the
region.

**3. Every fork is one question with a number on both sides.** *Save twenty tiles, lose the road.*
That is the branching graph, and it beats "left branch or right branch" because both sides are
quantities a player can hold. What the weekly window rotates is **which cuts are open and how much
they save** — same gates, same country, different shortcuts. The map that gets solved and re-lost
each week (see the window-cadence table below) is now a map of *cuts*, which is the thing players
will actually trade in the bar.

### What it buys, and the one knob

A crossing room holds a position in the gap: `s` along the corridor from the origin gate, `t` off it.
**Numbers, not a tile** — the room stays transient, stays off `map_world`, and `surfaceAt` never
learns it exists (see the ⚠ below on why that line cannot move). `t` is a single axis, and it is
*how much you cut*:

| | length | danger | lifeline |
|---|---|---|---|
| **hug the road** | ≈ the road's own | lowest | mile boards, the verge, a truck going past |
| **the trail** | shorter | real | intermittent sight of the road |
| **a hard cut** | shortest | worst | none — ground no vehicle can reach |

Four things listed below as open or unbuilt fall out of that with no new mechanism:

- **Water math** finally has a denominator. Drain-per-tile against a known total, and a cut's saving
  *is* its tile count. The gamble is priced by the map instead of by a hand-picked multiplier.
- **The loot-detour value curve** is a function of how far off the road you are: the good salvage is
  out where nobody drives, because nobody drives there.
- **The flight off-world read** decides itself. Visible from the air is a low offset; a hard cut is
  not. No flag, no rule — distance from the centreline.
- **Retreat** becomes a decision rather than a reversal: run for the road, or back to the gate you
  left, with different costs depending on where you stand.

And a consequence worth stating rather than discovering: **wings make cuts nobody else can take.**
Flight is the single named exemption to `engine:impassable-terrain`, so a winged mutant crosses a
cliff a walker has to go round — a mutation payoff landing in a system that was never built for it.

⚠ **The two lines that must not move.** `corridorAt` must never become `surfaceAt`: `regionGates` and
`isMapRim` both find the edge of the world by testing that `surfaceAt` *stops*, so synthesised ground
under the index deletes every road mouth, the whole rim and the void's only entrance in one move. And
void rooms must stay transient and off `map_world` — the moment they are real tiles the gap has
become a place by accident, and every argument above is describing something else.

### The four decisions *(settled 2026-08-21)*

**1. The road bends around the landform field. BUILT 2026-08-21.** The gap carries a seeded field of
landforms (`landformsFor` in [corridor.js](../plugins/trucking/corridor.js)) — mesas, the cliff-ringed
kind the hand-painted world already uses — as a pure function of the seed, the window and the straight
line between the two gates. **It is the COUNTRY, not the road's private data**: anything else crossing
the same gap asks the same question and gets the same answer, which is the whole point. The road bends
because there is a mesa there, and the walker's shortcut is that same mesa.

⚠ **THE CHANGE IS ONE LINE, AND THAT IS DELIBERATE.** The builder already chose a turn direction; it
chose it with a coin flip. `avoidTurn` replaces the flip and nothing else — arc length, tightness, the
minimum-radius floor, the leash and the termination rule are all untouched, which is what keeps the
fold invariant and the convergence proof intact. The leash still wins outright wherever it is engaged,
so a mesa can bias where the road goes and can never drag it off the target or stop it arriving.

⚠ **AND IT IS A PREFERENCE, NOT A PROHIBITION.** Measured over six windows on the 282-tile
Coldwater→Terminus gap, the road spends about **40% less of itself inside a landform than the straight
line between the same two gates does** (26.9% vs 40.5% on one window, 35.7% vs 69.5% on another). A
road that NEVER crossed high ground would be a maze rather than a highway; regress asserts the
proportion, not an absolute, and asserts it holds in most weeks rather than on average by luck.

⚠ **THE LEGACY FRAME IS UNTOUCHED.** An unanchored corridor has no real coordinates for a landform to
sit at, so the field is empty there and the turn is the coin flip it always was — which is what keeps
every pinned route in the suite identical, character for character.

The original ⚠ on this decision, kept because it is still the thing to be careful about:

> ⚠ **The road everyone already drives is under test, and those tests are the spec.** Routing around
> landforms must keep every corridor invariant intact — the **minimum turn radius** (cells are
> classified by distance from the centreline out to `OFFROAD_R`, and a bend tighter than that folds
> the verge through itself so the odometer runs backwards through the fold), the **8-connected paved
> set** (regress flood-fills it and demands one piece; a one-tile band on a diagonal renders as a
> dotted line of squares), and the **surface tuning invariant** `thrustMax × drive > rollFric × drag`.
> A landform that forces a tighter bend than the radius allows must move the *road*, never relax the
> radius. Expect the generator to need a reject-and-reseed pass, and expect the weekly corridor to
> change for live drivers the week it ships.

> ### ✅ RESOLVED 2026-08-21: the walk is shorter than the drive
>
> **Decisions 2 and 3 rest on the trail being shorter than the road, and it now is.** The section below
> records the measurement that said it could not be, and the two changes that made it wrong. Both are
> kept, because the reasoning in the first is still the reasoning that constrains the second.
>
> ⚠ **MY EARLIER CONCLUSION WAS TOO PESSIMISTIC.** I said the cost was a longer gap between regions or
> a narrower corridor. It was neither: **the radius floor was never the binding constraint, the HOMING
> BIAS was.** Two changes, and the second is the one that mattered:
>
> **1. The country outranks the homing bias.** Past 24° off course the leash forced a turn back toward
> the far gate even with a mesa directly in the way, so the road leaned away from the country and
> immediately straightened. Letting `avoidTurn` win inside the budget — with the hard `HOME_MAX` clamp
> at 46° **untouched**, so the convergence proof stands — plus holding the turn while the same
> obstruction is still ahead, takes road sinuosity from about **1.05 to 1.17**.
>
> **2. A camp is where the road is back ON COURSE, not at a fixed spacing.** This was the real blocker
> and it is the sort that hides: camps sat at a fixed arc-length, so one could land **in the middle of
> a detour**, and because the trail must touch every camp it then walked round the mesa as dutifully as
> the road did. Anchoring them where the road's heading matches the bearing to its gate (`campsOf`)
> puts them at the ENDS of detours, so the chord between two of them crosses what the road avoided.
> Change 1 alone bought nothing. Both together buy the shortcut.
>
> It is also the better rule on its own terms: a camp is derived from the road's own geometry rather
> than from a constant, which is the "derived, never sprinkled" law the waysides were built on, applied
> one level deeper.
>
> ⚠ **THE ROOM COUNT STILL COMES FROM THE GATE DISTANCE, AND THAT QUESTION IS NOW CLOSED.** A seam sat
> unused promising to become the room count "the day the road earns it". It has, and the answer is
> still no, for a reason the promise missed: the trail is shorter than the **road**, never than the
> straight line between the gates. It is an offset path that swings in to every camp, so the spine runs
> about 338 tiles where the gates are 282 apart — making a crossing as long as the walk would make
> every crossing longer. The seam has been removed rather than left promising something the evidence
> answered.
>
> ⚠ **AND THE FIRST NUMBER I QUOTED WAS THE CEILING.** "5 to 10% shorter" summed the chord of every
> stretch, which is what you get if every cut is open. Under the real seeded chance only some are, and
> an uncut stretch actively costs — the trail still swings in to each camp and out again. **As shipped,
> measured over six legs × six windows: the walk is 2.9% shorter on average, 8.9% in a good week, and
> 4.7% LONGER in a bad one.** The spread is the point, not a defect.
>
> ⚠ **THE PRICE WAS SUPPOSED TO BE FUEL, AND MEASURED IT IS NOTHING.** Roads are 5 to 17% longer and
> fuel burns over the real road, so this was flagged as a live balance change. Costed out at
> `FUEL_FULL = 380` over a 1,050-tile tank: the longest haul in the game went from **115₵ of diesel to
> 121₵**, against a crossing contract paying 676₵ to 1,664₵. **Six credits.** The concern was real to
> raise and did not survive arithmetic.
>
> ⚠ **BUT COSTING IT FOUND SOMETHING ELSE, AND THAT ONE IS PRE-EXISTING AND REAL: HAUL PAY IS
> DISTANCE-BLIND.** A contract pays `load × 2.6` for ANY crossing (index.js, the job generator), so
> Coldwater→Terminus and Coldwater→The Reach pay identically — while Terminus is **3.4× the distance,
> 3.4× the driving time and 3.4× the diesel** (121₵ against 36₵). There is no reason to ever take the
> long contract, and the region designed around truck range is the one nobody hauls to. Not caused by
> the road change; only made easier to see by measuring it. A distance term in that multiplier is the
> obvious fix and it is a balance decision rather than a bug fix, so it is written down here rather
> than taken.
>
> <details><summary>The superseded measurement, kept for its reasoning</summary>
>
> ### ⚠ MEASURED EARLIER: the road is too straight for a shortcut to exist
>
> Decisions 2 and 3 both rest on the trail being **shorter** than the road. It is not, and this is a
> measurement rather than a tuning miss.
>
> The trail is its own polyline now (`trailFor` in [corridor.js](../plugins/trucking/corridor.js)),
> built camp to camp: between two waysides it either runs STRAIGHT across the chord or shadows the
> road the long way, seeded per window. That machinery works. What it has nothing to bite on is the
> road: **every leg's built road is only 1.03 to 1.10 times the straight line between its gates.**
> There are no corners worth cutting, because the chord between two camps IS the road — and once the
> trail's swings in to each camp are counted it comes out a few per cent LONGER.
>
> ⚠ **AND THE CAUSE IS THE FOLD INVARIANT, WHICH IS WHY NO AMOUNT OF TUNING FIXES IT.** A landform
> now cuts a straight short and starts a bend where the rock is, rather than only choosing the
> direction of a bend that was going to happen anyway — and it barely moved the number. Denser
> landforms and a longer look-ahead moved it less. Here is why:
>
> | leg | straight | min radius | approach | free to wander over |
> |---|---|---|---|---|
> | Coldwater→Reach | 93 | 43 | 45 | **48 tiles (51%)** |
> | Terminus→Scarletwastes | 109 | 43 | 45 | 64 tiles (58%) |
> | Coldwater→Terminus | 282 | 43 | 45 | 237 tiles (84%) |
>
> `minRadius` is floored at `OFFROAD_R * 1.8` = **43 tiles**, and that floor is the fold invariant:
> cells are classified by distance from the centreline out to `OFFROAD_R`, so a tighter bend folds the
> verge through itself and the odometer runs backwards through the fold. The approach cut-off is that
> same radius again (a curve cannot converge on a point tighter than the circle it can draw; without
> it the road orbits its own destination). **So on a 93-tile crossing the road has a 43-tile turning
> radius and 48 tiles to use it in.** It is not straight by choice, it is straight because it cannot
> physically be anything else at that scale.
>
> **The distance half therefore costs one of two things, and both are real decisions:** a LONGER gap
> between regions, or a NARROWER corridor (`OFFROAD_R` is what sets the radius floor, and it is the
> drivable verge — narrowing it changes how a truck handles). Neither is a tweak to the trail, and
> neither should be made to buy a shortcut without wanting it for its own sake.
>
> Until then:
>
> - **the DANGER half of decision 3 ships** — a cut is a real place, off the road with no lifeline,
>   and every tile of it rolls encounters at `CUT_ENCOUNTER_MULT` (3×) the ambient rate: something
>   every ~7 tiles out there against ~22 on the road
> - **the DISTANCE half does not** (superseded — see the resolution above; it does now)
> - decision 2's "a cut can refuse you" is untouched by this and still unbuilt: it needs impassable
>   ground on the cut, which is the same landform work
>
> </details>

> ### ✅ BUILT 2026-08-21 — decision 2, and the room graph gained a loop
>
> **Both ways now exist at once, and that is the whole of it.** A cut used to REPLACE its stretch of
> the trail: the seed decided whether you got a shortcut, and if a cut had been able to refuse you
> there would have been nowhere to go. Now the SPINE is always the shadow — the long way, in sight of
> the road — and a cut is a BRANCH that leaves it at one camp and rejoins at the next. So the week
> decides which cuts are OPEN and **you** decide whether to take one: distance on one side, risk on
> the other. It is also what keeps the promise that a refused cut is a loss and never a dead end.
>
> ⚠ **THE SPINE IS STILL A SIMPLE ORDERED LINE, AND IT HAD TO BE.** `crossingChain` maps a driver's
> odometer onto a room, and a driver is on the ROAD — so the chain is the shadow, the cut hangs off it,
> and nothing about the drive learns that walkers have another way round. That is what let the graph
> grow a loop without the trucking side noticing.
>
> ⚠ **A CUT LEAVES BY `east`, THE ONLY LATERAL LEFT** — `west` is the detour's, and a limb's first room
> already spends one lateral on the way back to the fork. A camp that IS a limb's first room gets no
> cut. That trap has now bitten twice in this file and is guarded in both places.
>
> ⚠ **THE PITCH IS THE ENGINE'S OWN RULE, NOT A NEW ONE.** Some rooms on a cut carry `void_pitch`: the
> way on goes up a face. It is refused by exactly the mechanism `engine:impassable-terrain` already
> uses, carrying exactly the one named exemption that gate's own comment defends — **a body that grew
> wings**. Nothing purchasable opens it, no roll retries it. Seeded per room, so a cut is neither
> reliably walkable nor reliably shut, and you learn where the pitch is by walking to it.
>
> **What that costs you** is the water it took to get there, and the long way round afterwards. The
> spine never stopped being the spine.

**2. A cut is sometimes cheap, sometimes expensive, and sometimes refuses you.** All three costs are
live, and the mix is the point: **the challenge is what walking is about.** So a cut may be a clean
saving; may charge more than it saves once it is walked; or may be **genuinely impassable to the body
attempting it** — a cliff pitch, a flooded wash — in which case you turn back having spent the water
to find out. Two rules keep that from being a trap rather than a gamble:

- **The safe limb is always there.** A refused cut costs tiles and water; it never strands you and
  never removes the route. Turning back is a loss, not a dead end.
- **A gate is a body, not a purchase.** Wings clear a cliff pitch because flight is the one named
  exemption to `engine:impassable-terrain`. That exemption must never become a *gear* exemption —
  nothing purchasable may open a cut, or the shortcut becomes a shopping list.

**3. A cut is fewer rooms, and every one of them rolls hot.** Not "same rooms, cheaper" — the cut limb
is genuinely shorter *and* rolls at the hard rate rather than the 0.45 baseline. Total risk is roughly
preserved and **compressed**, which makes the gamble a bet on **variance rather than expected value**:
the same crossing with fewer, worse rooms. This is the hardest of the three to tune and the most
interesting to play. Floors that must hold: a limb is never shorter than one room, and the crossing's
own `[MIN_ROOMS, MAX_ROOMS]` clamp still applies to the safe route.

**4. Every void gets detours; today only Coldwater has any.** This was found by charting the generator
rather than reading it. Detours hang off *interior* trunk rooms —
`for (let i = 1; i < trunkLen - 1; i++)` — and the fallback that forces one when none rolled requires
`trunkLen >= 3`. **Coldwater's trunk is 4; the Reach, Deadwater and the Scarletwastes are 2, and
Terminus is 1**, so four of the five voids can never produce a detour and nothing said so. That is a
bug, not a design.

> The fix is **to let detours hang off limb rooms as well as trunk rooms**, rather than to raise the
> short trunks — raising a trunk changes crossing lengths that are currently derived correctly from
> real gate distances, and would be a content change dressed as a bug fix. ⚠ Note what moves: a
> trunk detour is **shared by every destination** out of that void, while a limb detour is seen only
> by walkers who declared that heading. Both are seeded and both are stable for the window; the limb
> version is simply narrower, and that is the trade to accept knowingly.

### The shape it takes: a weekly path drawn on the map *(settled 2026-08-21)*

**The void is a weekly generated walking path, overlaid on the world map in the gap between regions —
a third way to travel, beside the truck and the aircraft, with a dungeon's rhythm.** Its ground is the
same procedurally generated country the windshield and the canopy already render, so a walker, a
driver and a pilot in the same place describe the same place.

**1. A room IS a tile.** One `south` is one tile of ground, exactly as it is inside a region. The void
stops being the one place in the game where movement means something private: a tile is a tile in
Coldwater, under a truck, under an aircraft, and now on the trail. `ROOM_TILES`, `MIN_ROOMS`,
`MAX_ROOMS`, `DEFAULT_ROOMS` and the walker's half of `roomLen` all delete, and **"room positions"
stops being a design item** because a room is a position. A shortcut then shortens the walk in the
only unit anyone counts: tiles saved are steps not taken.

**2. It carries real coordinates and is still not placed ground — and that already works.** ⚠ The
critical fact, verified rather than assumed: **`getAllZones()` excludes transient zones by the
`world.transientZones` MARKER, not by the absence of coordinates**
([server/engine/world.js](../server/engine/world.js)), and `placedCoords` (voidwalking's own rim
index), `buildCoordIndex` (the flight sim) and `regionGates` all read the world through it. So a void
room may carry `grid_x`/`grid_y` today and remain invisible to every placement test, with
`map_id: 'map_void'` as a second guard. **Nothing has to be weakened to put the trail on the map**,
and the two lines above — `surfaceAt` stays placed-only, void rooms stay transient — both hold
untouched.

**3. It reaches the map through the seam the road already uses.** `registerCellOverlay`
([plugins/flight/state.js](../plugins/flight/state.js)) exists precisely because the corridor is real
ground that the `zones` table does not place; it is handed to `mapWindow` as a cell provider and never
to `surfaceAt`. The trail is a **second contributor to that same seam**, with the same guarantee. Which
buys the thing that makes it a travel *method* rather than a side tunnel: the trail is visible from the
air and from a cab, a truck and a walker can be in the same gap at the same time, and the road is a
lifeline you can actually see from the path.

**4. The terrain is the country's, not a random pick.** `mkRoom` currently chooses from a hardcoded
`['scrub','ash','redrock','marsh']` with no relation to anything. Under the landform field it reads
the ground it is standing on, which hands the trail four shipped systems for free: procedural
footsteps voice the surface, the minimap colours it, `speed_mult` paces it, and the description
matches what a pilot sees out of the canopy over the same tile.

**5. ⚠ Lazy windowing is load-bearing, not an optimisation.** At one room per tile a crossing is 93 to
282 rooms rather than 8 to 15. The generator is already a pure function of `(route, window, node)`, so
a room is a **lookup, not a build** — register a window around the walker and drop what is behind. Do
this first or the room count is a memory and teardown problem instead of a pacing one.

**6. ⚠ The encounter model is the real work, and it is a retune rather than a constant.** 0.45 per
room is tuned for eight rooms; across 282 it is roughly 127 fights. Per-tile it wants to be a couple
of per cent — better, a distance-since-last-encounter model, so pacing is even rather than streaky.
That is the same job the water math needs, and they should be done together.

**Still open, and worth deciding before the build rather than during it:** what a tile that is *both*
road and trail is (they will cross, and that crossing is the lifeline); how a party's window behaves
when members are far apart on the same instance; and what weather does in the gap, since
`climate_bias` is authored per region and the void is between them.

### The three seams, settled *(2026-08-21)*

**A. Where the trail meets the road is a WAYSIDE — its own room kind, and the place people meet.**
Not a road tile the walker happens to be standing on and not scenery: a third kind beside trunk, limb
and detour. It is where you come down onto the tarmac, read a mile board and know exactly where you
are, rest, pick over a wreck — and where a truck can stop.

- ⚠ **A wayside is DERIVED from where the trail actually enters the corridor's band, never sprinkled.**
  Placing them by seed would be a second answer to where the road is, and the two would drift. The
  trail's path and the corridor's polyline already exist; a wayside is where the first comes inside
  `OFFROAD_R` of the second.
- ⚠ **It must not be a safe room.** A lifeline that costs nothing turns the crossing into a series of
  hops between rest stops. The road is also where the things that work roads are: `enemy_prybar_nomad`
  already carries `flags.hijacker` and already works a stopped cab, and a wayside is exactly where that
  reads right for a walker too. The relief is *information and a way out*, not safety.

#### A1. What a wayside looks like from a cab, and what you can do at one

**A camp, not a facility.** Tents at the side of the road, a water barrel, a campfire, a crossing sign
where the foot path meets the tarmac, and the path itself worn into the ground either side of it.
Seen from a truck or an aircraft it should read as **temporary** — guy lines, mismatched fabric,
nothing founded, no concrete, nothing that took a machine to put there.

> **And it is temporary, which is the good part.** The trail reseeds every window, so the camp
> genuinely will not be there next week. The art direction and the mechanism agree without either
> being bent to fit the other: it looks like this week's camp because it *is* this week's camp.

⚠ **It is a `mark`, never a `building_type`.** This is the mile board's rule, and the reason is not
that a truck might plough through the middle of a camp: the camp is on the **verge**, off the paved
band, which is exactly where it should be. The reason is that **the verge is drivable**. Past the
tarmac you are slow, never blocked, and pulling onto it is a normal thing to do. `building_type`
tiles are extruded into collision volumes, so a camp built as one would mean that **the driver who
pulls over to pick somebody up crashes into the thing they stopped for.** A wayside has to be
somewhere a rig can come to rest beside, which is the whole point of it.

⚠ **The model goes through `drawTypeModel` / `SHAPE_SINK`, and `shapes:smoke` is the only automated
coverage the windshield has.** See [reference/building-shapes.md](reference/building-shapes.md): the
shapes are recorded as data so distance LOD, occlusion culling, ground shadows and CFIT collision all
read the model's own geometry rather than a second copy of it. Run `npm run shapes:smoke` after
touching it — the Battery Acid roaster passed a palette KEY where a style FUNCTION was wanted and
froze the whole sim the first time that cafe came into view, which is exactly what that check exists
to stop. **And the map icon ships in the same commit as the model, never backfilled.**

**Sleep, cook, water — and none of it is a new mechanic.** A wayside is a room with the right things
in it, so the verbs that already exist do the work: the campfire is a heat source the cooking plugin
already understands, the barrel is a `water_source` that `fill <vessel>` already reads, and sleeping
is the sleep system unchanged. That last one also resolves the tension with *no safe haven* by
itself: the void is `lawless`, and a sleeping body **stays in the room, lootable and killable**, which
is the dreams system's own mind/body split. Resting at a wayside is not safety. It is a decision to be
unconscious next to a road, in a place other people know about.

#### A2a. The passenger seat *(BUILT 2026-08-21)*

**A truck can carry people now** — `ride [driver]` to climb into a stopped rig in your room, `hop` to
get down. An aircraft has done this since charter (`live.occupants`); a truck was a single-occupancy
object, so two people crossing the void together had to walk it. Two seats, and the seeded hitcher in
the sleeper takes one.

⚠ **`rig.passengers` IS DELIBERATELY NOT `rig.rider`.** The rider is the seeded HITCHER — a pure fact
about a stretch of road (`hitcherAt`), stored as `{ id, look, line }` and read in eleven places
including `scale.js`, where clearing it is the whole fugitive-at-the-weighbridge mechanic. A passenger
is a person with an account. Collapsing them would have put a player through code that expects a
description string and a weight. They are separate fields that happen to share a bench.

⚠ **STOPPED TO BOARD, AND THAT IS THE SAFETY MODEL RATHER THAN A COURTESY.** The rig is
client-simulated and reconciled four times a second, so boarding one mid-move puts a second player's
`current_zone` under a position that is already stale. It is also the condition a HIJACKER boards
under (`hijack.js`, `STOPPED_MPH`), so a cab is boardable by a stranger exactly when it is workable by
one.

⚠ **BUT `hop` WORKS AT ANY SPEED.** Refusing would make a passenger the only person in the game who
can be held somewhere by another player, and no narration makes that a feature. Stepping down at
speed simply costs you.

Two invariants carry the rest, and both are single-path by construction. **Riders are carried inside
the two zone movers** (`driveToZone` for city tiles, `crossToNode` for the corridor) and nowhere else,
so nobody is left standing in a street the truck drove out of an hour ago — and the durable write is
NOT done there, because that is the hot drive path; it lands once when the wheels stop. **And
everybody is released through `dismountRig`**, so parking, a tow, a breakdown recovery and the driver
logging out all set passengers down by one path rather than four that each have to remember. A stale
back-reference to a rig that no longer exists resolves to null and clears itself, because a passenger
riding a ghost is the failure that would be hardest to see.

#### A2b. What flagging a truck down still costs *(surveyed 2026-08-21, not built)*

The verbs are free: **`flag` and `thumb` collide with nothing** in any of the three classes that can
shadow a command (plugin manifests, engine builtins, specialized actions — checking `plugin.json`
alone is not sufficient, see the psionics note in CLAUDE.md). `hitch` is trucking's TRAILERS and
`wave` is `interactions`, so neither is available.

⚠ **The hard part is not the beacon, it is that a HITCHER IS NOT AN ENTITY.** `hitcherAt` is a pure
seeded lookup — "a fact about a stretch of road", by its own file header — and `pickup` stores the
result as `rig.rider = { id, look, line, inTrailer, boarded }`. A person with an account is a
different kind of thing, and `rig.rider` is read in **eleven places across four files**, including
`scale.js`, where clearing it is the whole fugitive-at-the-weighbridge mechanic. Every one of those
has to answer "what if the rider is a player" before this is safe.

**The shape that makes it tractable: boarding ENDS your crossing.** You are not a walker being carried
through the void, you are a passenger in a truck — `leaveCrossing` fires, the instance releases you,
and where the rig arrives is where you arrive. That is also exactly the extraction the decision above
describes, it removes the whole class of questions about a rider whose own crossing tears down under
them, and it means the only new state is a rider who happens to have a player id.

⚠ **And it is the one piece here the suite cannot verify.** Regress drives a single fake player; two
live players sharing a moving vehicle is not a thing it can express. Everything else in this system
shipped because a test could hold it — this wants two people and a road.

#### A2. Flagging down a truck — the crossing's social half

A walker at a wayside can **flag down passing traffic**. A player truck coming up on a flagged walker
gets a notification with time to slow, and may stop and take them aboard. `hitchers.js`
(plugins/trucking) already carries NPC hitchhikers, so the boarding half exists; what is new is that
the hitchhiker is a person, and that the offer is broadcast rather than rolled.

**This is also the answer to the escape-hatch question above, and it is a better one than any rule.**
A lift out of the void stops being something the system grants and becomes something *another player
chooses to give*. The gauntlet has no back door; it has other people in it. Three constraints so it
stays that way:

- ⚠ **Flagging is a beacon with a lifetime, not a state you sit in.** A permanent flag turns every
  wayside into a taxi rank and every driver's HUD into a list. It expires, and re-flagging costs the
  time it costs.
- ⚠ **One notification per truck per walker, and only with room to react.** A rig reconciles four
  times a second and the cab already knows what is ahead; the alert has to fire far enough out that
  slowing is a choice rather than a reflex, and never twice for the same person.
- **Getting in a stranger's cab in the waste is a risk, and it should be.** A driver who stops and
  then robs you is not an exploit, it is the game. Say nothing to discourage it and build nothing to
  prevent it.

**B. Windows are per member, unioned, and reference-counted per ROOM.** Each walker carries their own
window of registered rooms; the instance holds the union and drops what nobody is near. Geometry is a
pure function of `(route, window, node)`, so this is a diff on each move — register what came into
range, evict what fell out — and a party may split as far as it likes.

- ⚠ **Teardown counts MEMBERS today, not rooms** (`if (c.members.size === 0) teardownInstance(c)`), and
  that is no longer sufficient: a room now leaves while the crossing continues. It needs a per-room
  keep test — is any member's window over it — and **never an eviction of a room with an occupant in
  it**, which would strand a player in a zone that no longer exists.
- `registerTransientZone` preserves occupant Sets across a re-register, so walking back into a room
  that fell out of the window and came back is already safe.

**C. The gap's weather is INTERPOLATED between its two neighbours.** Blend by distance across the
crossing, so acid fades in as you approach the Scarletwastes and heat builds toward Terminus. The gap
is the country between two climates, and this is derived rather than authored — it lands as a fallback
in one function, `regionBiasAt(gx, gy)` ([plugins/weather/index.js](../plugins/weather/index.js)),
which is already coordinate-based (region bounding boxes, smallest first) rather than membership-based.

Two traps found while checking it, both of which would make the blend quietly wrong:

- ⚠ **COLDWATER HAS NO WEATHER BOX AT ALL, AND NEITHER DOES ANY BASELINE REGION.**
  `computeRegionBoxes` filters on `eff &&`, and `effectiveBias` returns `null` when a region has no
  temp, dryness or acid — so a region at baseline contributes no box. Coldwater's `climate_bias` is
  `null` and it has no `REGION_BIAS` default, so **it is not in the list**. "Blend the two nearest
  boxes" near Coldwater would therefore blend Deadwater with the Reach and skip the region you are
  standing next to. The interpolation needs baseline regions present as explicit **zero** boxes; a
  region with no opinion must contribute *baseline*, not *absence*.
- ⚠ **THIS CHANGES WEATHER FOR DRIVERS TOO, NOT JUST WALKERS.** The corridor runs through the same
  gap and is equally outside every box, so today a truck crosses in baseline weather. Interpolating
  gives the road real weather for the first time — which is right, and is a live behaviour change for
  everyone already driving.

**D. A walker and a driver in the same place can meet, both ways.** A driver sees a figure on the
verge and can stop; a walker can flag one down, be robbed, or be run down on the paved band. This is
the payoff for putting the trail on the map at all, and it reuses plumbing that exists —
`plugins/trucking/hitchers.js` for the pickup and `collide.js` for the other outcome.

> ⚠ **The open question this creates, and it is a gameplay one rather than a technical one: can a
> truck carry a walker out of the void?** A lift that reaches the destination is an escape hatch
> through the entire gauntlet, and the crossing's whole design is that there is no going back to a
> saved path — only forward or back out the gate. A rescue is a *good story*; a reliable taxi is not a
> crossing. Decide it before the pickup is wired, not after. The obvious middle is that a lift takes
> you to the **road's** destination gate rather than yours, on the road's schedule, which is a rescue
> that costs you the crossing rather than completing it.

### What of this is built *(2026-08-21)*

**BUILT — a room is a tile.** `totalLength` returns the gate distance itself: no division, no ceiling.
Crossings are their real lengths (Reach 93, Reach–Deadwater 99, Coldwater–Deadwater 108,
Terminus–Scarletwastes 109, Coldwater–Terminus 282). `ROOM_TILES` and `MAX_ROOMS` are gone;
`MIN_ROOMS` stays as a guard against a degenerate route, not as a knob.

**BUILT — the trunk is derived, in tiles.** The authored `VOIDS[].trunk` room counts (4, 2, 2, 1, 2)
were tuned when a room was a twelfth of a leg; read as tiles they would put the fork four steps off
the rim of a ninety-three tile walk. It is a bounded fraction of the nearest destination now
(`trunkTilesFor`), and `bigScoreSalt` and `crossingInfo` both read the derived value.

**BUILT — the plan/window split, and lazy materialisation.** `plan` is the route as a pure function of
the seed with nothing registered; `roomSet` is what currently exists. A room is made when somebody is
within `WINDOW_R` hops of it and evicted when nobody is, never while it holds a player, an enemy or a
corpse. ⚠ `crossingChain` and the relog re-derive read the PLAN — the first is THE LONG HAUL's
odometer-to-room mapping over the whole route, and the second would otherwise return every
reconnecting walker to the threshold.

**BUILT — encounters are per tile, and a moving truck meets nothing.** 0.045 per tile puts something
every ~22 tiles (about 4 to the Reach, 13 to Terminus, against 3.6 and 6.7 before); hard nodes drop
0.22 → 0.02. Detour and hard-node odds are deliberately unscaled: a discrete gamble should read the
same at any crossing length. ⚠ Driver immunity is an explicit `mounted` flag on `zone.entered` now.
It used to be done by pre-marking `_crossing.seen` from trucking's `crossToNode`, which skipped the
roll and SPENT it in the same move, so ground you had driven stayed quiet for the rest of the
crossing — at one room per tile that would have let a lift launder every tile it covered.

**BUILT — two things on the road that the flip would have broken silently.** `crossToNode` awaited a
DB write per node boundary (fine at fifteen; several a second at 282, which the persistence tiers
forbid) and now marks `zoneDirty` like its sibling `driveToZone`. And road terrain was keyed on the
NODE INDEX, which only looked right because a node happened to be about nineteen tiles: at one node
per tile the highway would have re-rolled its ground every tile. It bands on distance now
(`terrainAt`), which is also where the landform field will plug in.

**BUILT — the country has things in it, and their mechanics are ordinary zone tags.**
[flavour.js](../plugins/voidwalking/flavour.js) holds 54 room names and 36 descriptions keyed by the
GROUND (so a marsh never crunches underfoot again), plus 32 highlights across six kinds: salvage,
respite, water, shelter, hazard and marker. ⚠ `kind` is the mechanical contract and the prose is not,
so a fifteenth salvage site is a content change and a new kind is a code change. A highlight's
`flags` merge onto the room, and nothing there is new: a rad pocket sets `radiation` and the engine's
own `getZoneRadiation` charges for it. Regress lints the whole file for em dashes, because that rule
erodes one edit at a time and nothing else in the suite would notice.

**BUILT — a zone can be its own water source.** `water_source` was a FURNITURE flag, read by a direct
`SELECT … FROM furniture WHERE zone_id = $1`, which is exactly what a transient room can never have:
a hot spring or a camp's barrel out in the waste would have been invisible to `fill` forever. Cooking
and drinks now check the zone's own tag first (same tag NAME, so there is nothing new to author, and
no round trip). ⚠ The tag catalog still scopes `water_source` to furniture; void rooms are transient
and never reach `content:lint`, so nothing breaks today, but a hand-authored wayside zone will want
that scope widened.

**BUILT — the gap between regions has weather.** `regionBiasAt` interpolates between the two nearest
regions when a point is inside no region's box, so acid drifts out of the Scarletwastes and heat
builds toward Terminus instead of a hundred miles of flat baseline. ⚠ The trap this needed: a
BASELINE region contributes no box at all (`effectiveBias` returns null with nothing to say, and the
list filters those out), so Coldwater — null `climate_bias`, no default — was simply absent, and a
naive "blend the two nearest" would have skipped the busiest region on the map on all three of its
roads. Containment reads `regionBoxes` (regions that bias something); the blend reads `regionSpans`
(every region, zeroed where it has nothing to say). **This gives the ROAD real weather for the first
time too**, since the corridor is equally outside every box.

**BUILT — the trail is somewhere.** A crossing room carries `grid_x`/`grid_y` now, taken from the
anchored road between the same two gates: `registerCrossingPoints` is the seam (the sibling of
`registerCrossingDistance`, pushed in the direction the dependency already runs), a LIST of `{s, t}`
goes out and a list of points comes back, so the road is built once per limb and `corridorPos` never
leaves trucking. A room's odometer reading is its index along the walk, because a room is a tile.
⚠ **And it is still not placed ground** — regress asserts a coordinate-carrying room stays out of
`getAllZones()`, which is what keeps `surfaceAt`, `regionGates` and the rim index exactly where they
were. The trunk takes its points from whichever limb answers first, which is safe by the invariant
trucking's own suite asserts: every road out of a void shares its trunk tile for tile.

`TRAIL_OFFSET` is **7 tiles** off the centreline: clear of the ~2-tile paved band and the shoulder,
and deliberately INSIDE the corridor's classified ground (`OFFROAD_R` is 24). That is what makes the
road a lifeline rather than scenery — you can see it, a board is readable when the trail runs close,
and a truck can pull over for you. Push the trail past the corridor and **decision D quietly stops
being possible**. A detour sits at 34, outside the corridor entirely, because taking one means
leaving the road behind and that is the whole of what the gamble costs.

**BUILT — the minimap grid sweep no longer reaches across an instance.** `getMinimapData` charts a
crossing by walking its exits, but if the centre zone has coordinates it ADDITIONALLY sweeps
`world.zones` for anything within four tiles. The `map_id` guard only ever protected half the case: a
player on real ground never sees `map_void`, but every instance's rooms share that one map id, so the
moment a void room carried a `grid_x` the sweep would have drawn whichever OTHER party is walking the
same stretch of gap this window onto your minimap. **Instancing is enforced by room ids, never by
position**, so position must not reach across it. Transient zones are now excluded at both ends: a
transient centre takes no sweep, and a transient zone is never a candidate for anybody else's.

> ⚠ **The historical note, kept because it is the reason the guard exists:**
> ([server/engine/world.js](../server/engine/world.js), the `WIN = 4` block.) The minimap normally
> BFSs a crossing along its exits, which is why the ashen-trail view works at all. But **if the centre
> zone has coordinates it additionally sweeps `world.zones` for anything within four tiles of them**,
> and that changes behaviour the moment a void room gets a `grid_x`.
>
> The `map_id` guard is what makes this safe today, and it only protects half the case. A player
> standing on real ground has `centerMapId = 'map_world'`, so `map_void` rooms are skipped and no
> bystander can ever see somebody else's crossing. **A player INSIDE the void cannot be protected the
> same way**: every instance's rooms share `map_id: 'map_void'`, so once they carry coordinates the
> sweep would pull in whatever OTHER party happens to be walking the same stretch of gap this window,
> and put their rooms on your minimap. Instancing is enforced by room ids, not by position.
>
> The fix is one guard — skip `world.transientZones` in that sweep — and it is small and obviously
> right. It is deliberately NOT made here, because a defensive change to a shared engine function for
> a feature that does not exist yet is speculative, and this is the note that stops it being
> rediscovered the hard way.

⚠ **NOT built: DRAWING the trail, and the country it should cross.** The rooms know where they are;
nothing renders them yet. The landform field and the road routing around it, the cuts, waysides,
player hitchhiking, and the readers behind `salvage` (beyond the existing detour loot), `respite` and
`void_shelter` are all still design — a hot spring reads as one, waters you and is warm, and does not
yet heal.

**BUILT — the road knows where the trail runs, and where the camps are.** `corridorAt` names the band
the walking route crosses: `The Foot Trail`, and `A Wayside Camp` where the path comes in. ⚠ **A
tolerance band, never `Math.round(t) === offset`** — the third feature on this verge to need that rule
after the wreck and the sign, and the one it would have shown worst: at a fixed lateral offset the
tiles form a clean row on a straight and a DIAGONAL on a bend, so an equality test paints a path that
appears for forty tiles, vanishes for twenty and comes back. Regress walks the route and asserts the
longest gap, because a path with holes in it reads as a bug rather than as a trail.

**BUILT — the camp is on the WALK, not just on the road, and you can fill and cook at it.** A room
whose `s` lands on a wayside is the camp: tents, a water barrel, a firepit, a crossing sign, and the
path worn in off the country to meet the road right there. ⚠ **A wayside outranks the highlight roll**,
because it is not a roll — letting a seeded wreck sit on top of the camp would put two landmarks on one
tile and hide the only water on that stretch behind whichever won. It is **not a safe room**: still
`lawless`, a sleeping body still stays in it, and the road is also where the things that work roads are.

⚠ **AND THE CAMP'S MECHANICS ARE THE ORDINARY TAGS, WHICH IS THE POINT.** The barrel is
`water_source` and the firepit is `stove_tier`, the same names furniture uses, so `fill` and `cook`
work out in the waste with nothing taught about the void. Both needed the same one-function change —
a zone may be its own water source (`waterSourceIn`) and its own fire (`stovesInZone`) — because
furniture is a row keyed by `zone_id` and a transient room can never have one.

⚠ **A KIND MAY SHIP WITH NO MECHANIC, AND `shelter` DOES.** Its prose is real; its effect is not. The
engine's SSOT for "climatically sheltered" is `isIndoorZone`, which reads
`is_interior`/`is_apartment`/`is_building`, and setting any of those on a culvert in the waste would
enrol it in the indoor-temperature loop and the building/power network. A `void_shelter` flag nothing
reads is the unconsumed key this project treats as a build failure, so the kind carries description
only until weather exposure grows a seam it can use. Regress asserts every flag that IS present has a
reader — that check is what caught this.

**BUILT — a wayside is derived, not placed, and the geometry is what makes that possible.**
⚠ **The trail's offset is a FUNCTION of `s`, not a constant** (`trailOffsetAt`), and that is the whole
trick: two lines running exactly parallel never meet, so a fixed offset would have left "where the
trail meets the road" with nowhere to happen and a camp would have had to be sprinkled at seeded
intervals — a second answer to where the road is, drifting the first time either was tuned. The path
comes IN instead, every `WAYSIDE_EVERY` (48) tiles, from 7 tiles out to 3, on a cosine so it swings
rather than turning a corner. **A wayside is simply the place where the walking route and the driving
route are the same place** — which is also what makes pulling over for a hitchhiker possible at all.
One definition, exported from voidwalking and read by both sides.

> ⚠ **The renderer is deliberately not half-done.** Naming the band is data with a real reader; making
> it LOOK like a track from the air is not. `ft: 'dust'` is gated on `c.road` in all three of its uses,
> so it draws nothing on a non-road cell, and the alternatives are a `flags.trail` nothing reads (the
> unconsumed key this project treats as a build failure) or teaching `deriveSurfaceCell` and the
> windshield a new ground type — client work whose only automated coverage, `shapes:smoke`, tests
> building models rather than ground. It wants eyes on a screen.
> ⚠ And do NOT reach for `terrain: 'dirt_road'` to shortcut it: `surfaceUnder` reads terrain to pick
> the physics surface, so the band would take the shoulder's grip and render as a second highway
> running parallel to the first.

The one new tuning knob the decisions above introduce is **how much of the country a cut may cross** —
how far it may stray and how much it may save — and it is the lever that sets the entire risk curve.

### The crossing is a deterministic, seeded generator — not stored geometry

The void is a **formula, not DB rows.** A crossing's map is a pure function of its seed; the engine
persists almost nothing:

- **Geometry** (rooms, branches, terrain, rad bands, rest sites, loot detours) is derived from the
  **route + window seed** (see below). Given the seed and your position, the current room is
  reconstructable at any time.
- **Per-player state** is five scalars in `player_flags` (written/cleared in one batched
  upsert/DELETE): `crossing_void`, `crossing_window`, `crossing_origin`, `crossing_instance`, and
  `crossing_room` — the current room id, flushed lazily on logout, not per step.
- **Relog-safe by construction:** log out mid-void, log back in, the plugin re-derives the instance
  from `crossing_instance` and replaces you at `crossing_room` (the deterministic graph regenerates
  identical room ids). Nothing about the void geometry is stored, so nothing can desync.
- **Death** clears the five flags → normal clone-vat respawn. The run simply evaporates.

This honors the project rule against new content in the DB and against per-tick DB writes: the void is
computed, not queried.

### The linchpin: seed by **route + rotating window**, not per-player

The geometry seed is a function of **(route, current window)** — *not* of the individual player or
run. Everyone crossing `Coldwater→Reach` during the same window walks the **same generated map.** This
single decision makes the whole social layer fall out for free:

| Consequence | Why it works |
|---|---|
| **Party crossings** | You're together because you're on the same route in the same window — same seed, same rooms. No party-instance coordination hack; shared geometry is automatic. |
| **Ghost-traces are real** | A death at "node 5, left branch" is at node 5, left branch *for everyone this window*. Corpse-packs and ash-scrawls pin to actual rooms, not vibes. |
| **Not permanently memorizable** | The window rotates. Next window's `Coldwater→Reach` void is a different map. |
| **No stored geometry** | The void is `f(route, window, node)`. Only a small **traces** table (deaths) and four player flags persist. |

**Window cadence: weekly (slow).** This is deliberate and gives the system its signature rhythm:

- **Window opens:** fresh geometry. Blind gambles, unknown rad/raider placement. Max terror, high
  death count.
- **Midweek:** ghost-traces have accumulated — *the graves are the map.* Veterans chart the safe
  branches and the loot detours; knowledge spreads. A "known bad crossing" becomes lore.
- **Window closes:** the community has largely tamed this week's void… then it resets and the fear
  returns.

So "slow window" doesn't fight the blind-gamble feel — it makes the void a thing players collectively
**solve and re-lose every week**, with the trace system as shared memory.

### Geometry shared, threat private

Clean split that keeps repeat runs fresh even on a known map:

- **Geometry** comes from the route+window seed → shared, stable for the window (so party + ghosts
  work).
- **Encounters / ambushes** roll **live, per party, per step** (off the carried salt + real time) →
  private, fresh. Two parties can walk the identical layout this window and get jumped completely
  differently. *Same map, different war.*

---

## Topology & destination — how you pick where you're going

### Regions form an adjacency graph

Void-routes are **edges between neighboring region-islands**, not links from anywhere to anywhere. A
crossing takes you to an *adjacent* island; distant regions are reached by **chaining crossings**
(region-hop through intermediates), or stay air-only until a route is authored in. The graph grows
one edge at a time — `Coldwater—Reach` first (via the Wildlands leg), then `Coldwater—Exodus`, then
e.g. `Reach—Exodus` as a lawless-frontier shortcut. No combinatorial explosion: you only build edges
that make fictional sense, and each edge is independent content (its own seed namespace, its own
traces set).

### The graph, as built *(2026-08-21)*

Five regions, six legs, and every one of them symmetrical — anything reachable is leavable, at the
same length, and `regress` asserts both for every row in `VOIDS`:

| From | Limbs |
|---|---|
| Coldwater | The Reach (s) · Terminus (e) · Deadwater (w) — **full** |
| The Reach | Coldwater (n) · Deadwater (w) · **The Scarletwastes (e)** — **full** |
| Deadwater | Coldwater (n) · The Reach (e) |
| Terminus | Coldwater (w) · The Scarletwastes (s) |
| The Scarletwastes | Terminus (e) · **The Reach (w)** |

**The Reach↔Scarletwastes edge closed the loop** *(2026-08-21)*. Until it existed the graph was a
pure chain with the Reach at one end and the Scarletwastes at the other — four crossings apart,
through Coldwater, despite being the two most southerly places on the map. It is the first edge that
is not a spur, and the first that needed **new mouths at both ends**: neither region had a road
facing the other, so `gatePair` would have paired the two they had and laid a highway back across
both regions' own placed ground. Main Street's **Field Road** now runs east to the Reach's east rim
at (922,1043), and the Deadleg's spur drops south and runs west to the Scarletwastes' west rim at
(1000,968).

⚠ **A new mouth can re-aim an old road, silently.** `gatePair` takes the *nearest* facing pair, so
paving anywhere in a region re-routes every road that region already had if the new mouth is closer.
The obvious line — Main Street straight east to (922,1039) — sat 92.1 tiles from Coldwater's gate
against the existing western mouth's 93.2, and the Coldwater highway quietly moved to the far side
of town from the tiles named "The Coldwater Road" after it. Leaving by the Field Road one row south
is further from Coldwater and Deadwater and nearer to the Scarletwastes, so every old pairing holds.
`plugins/trucking/regress.js` now pins **every** region-to-neighbour pairing against a recomputed
nearest pair, plus the two this edge could have stolen by name.

⚠ **And the road round the mesa is not scenic routing.** The Scarletwastes' spur ends at the
Deadleg's apron (x=1024) and due west of it is the cliff-ringed plateau at x1011–1017 — `cliff`
being the one terrain `engine:impassable-terrain` refuses. Same trap as Terminus' west rim, answered
the same way: drop south down the Deadleg's own column to y=968, then west under the mesa.

⚠ **It is a chain, not a hub, and it had to become one.** Coldwater's junction has been full since
Deadwater — a room has four walls and the fourth is the way you came in — so the fourth region could
never hang off the Basin. The Scarletwastes therefore joins at **Terminus**, which is not a
compromise but the only shape that keeps growing: Coldwater–Terminus–Scarletwastes on one side,
Coldwater–Reach–Deadwater on the other. A sixth region joins at a leaf the same way.

**Geometry picks the neighbour, not taste.** The Scarletwastes run x1000–1092 / y950–1001 and
Terminus x1200–1239 / y921–960 — overlapping in latitude, about 108 tiles apart, the same gap
Coldwater and Deadwater are, while Deadwater (x812) and the Reach (y1958) are absurd from there.

⚠ **A gate must land on ground you can stand on** — and it must also land on a ROAD. Terminus'
**west** rim (x1200) is cliff from y943 south, so a limb aimed at the middle of it would have put a
truck on a rock face. That much is true and is still the reason to check rim terrain before adding a
limb: the table will happily point at a cliff.

⚠ **The south gate at (1219,960) is gone, corrected 2026-08-21.** This paragraph used to say the west
rim was cliff *for its whole length*, and that the gate was therefore "the westernmost passable tile
of the **south** rim, (1219,960), painted `dirt_road` to match every other gate in the table". Three
things were wrong with that. The west rim is passable from y921 to y942 and carries **the roadhead at
(1200,940)** — Coldwater's own road comes in there. (1219,960) is not the westernmost passable
south-rim tile (the ramp at x1201 is, and gravel at x1212). And a single tile of `dirt_road` on a
hardpan flat is a *marker*, not a road: it is twenty tiles of open ground from The Gate.

**What kept it invisible is that nothing read it.** `gatePair` takes the nearest pair of mouths off
the map, so the Scarletwastes road has always joined Terminus at the roadhead — 109 tiles, against
the south gate's 127 — while the `VOIDS` table sent the **walker** to (1219,960) and `crossingPlan`
measured that limb's mile boards to it. One region, two arrivals, and the only thing holding the
second one up was one painted tile. The tile is `hardpan` again (which is what its own description,
its name and all eight neighbours already said), **Terminus publishes exactly one gate**, and the
walker now lands where the road ends.

⚠ **This is the general trap, not a Terminus one.** A gate is DERIVED — a rim tile that
`isRoadCell` accepts — so painting road terrain anywhere on a rim *creates* a gate, and the paint is
the whole of the authoring. `gatePair` then quietly prefers whichever mouth is nearest, which need
not be the one you painted. If you want a limb to leave by a particular rim, **build the road to it**;
a tile of paint on its own will be outvoted by the map and nothing will say so.

The road on the Scarletwastes side is **authored, not generated** (the region is uniformly redrock on
purpose so it can be hand-painted): it enters at Talus on the east rim, runs west along y957, and
turns south to ring the Thorn Wall — with a spur running the other way along the same y957 line, west
from the ring at x1053 to the Deadleg's own apron at x1024, so the depot is on the tarmac rather than
29 tiles of open redrock off the end of it. The whole limb is now road from the rim to the yard door.

### Destination = declared heading at the gate, mastery inside the void

You **declare intent when you depart** (an adjacent region — the adjacency graph gates what's a legal
heading), then the void is about **how well you hold that heading versus getting pulled off it.** The
crossing is *not* a labeled hallway to your chosen region — it's a **braided multi-destination map**:
routes to different adjacent regions **share early nodes and diverge deep.** The first stretch out of
a region is directionless waste common to every southern destination; the forks are where it splits.

A fork is a **read, not a label.** Landmarks telegraph direction — a mountain silhouette, a leaning
radio mast, the sun's angle, which way the rad-haze thickens — but nothing is signposted. Read the
signs well and you hold course (and skilled readers can *deliberately divert* toward a different
adjacent region or a loot pocket); read them badly and you **drift**, and drift can surface you
somewhere you didn't intend, or deeper into nowhere. Misrouting isn't a failure state — it's an
adjacent place with its own content, and a story.

This is the destination layer of the **weekly-solve loop**: early in a window nobody knows which fork
goes where; ghost-traces and shared knowledge chart the braid by midweek ("second left past the
overpass for the Reach; the mast fork is a raider trap"); Monday it reshuffles and the signs mean
something new. **Navigation itself becomes a mastered-and-re-lost skill, not just survival.**

> The **declared heading** is the guardrail that keeps this from being pure "where the hell am I"
> griefing: you always leave *aiming* at a legal neighbor, so drift is a risk you took, not a random
> mugging. Intent at the gate, mystery in the void.

**Generator cost:** this is the more expensive shape — one braided graph per region-void (shared trunk,
diverging limbs keyed to each adjacent destination) rather than independent per-route maps. It buys the
only version where the *destination* is part of the unknowable void the community charts weekly.

**BUILT:** a void is a **`VOIDS[regionId] = { origin, trunk, dests[] }`** graph owned by a region — a
shared **trunk** (config room count) that forks toward each destination in that dest's `dir` (n/s/e/w),
then a distance-derived **limb** per region down to its real edge tile. The fork is the real choice —
hold your heading down one limb, or **divert** down another to a different region. Detours hang off
shared-trunk rooms. Void `region_coldwater` forks to **The Reach** (south) and **Exodus** (east).
Regress proves both limbs reach their region and that you can divert at the fork. Still N/S/E/W only
(the engine has no diagonals) and single-fork (no nested forks).

### Where the graph lives — authoring vs. seeing

The adjacency graph has two surfaces, and they are different things (SSOT vs. view):

- **Authored in the dev-panel World Editor.** Regions already live there (`regions` table, New Region /
  Region Maps / drag-to-move — see [land-taxonomy.md](reference/land-taxonomy.md#region--the-spatial-place-renamed-2026-07-19-from-district)).
  The graph is **edges layered on that existing region set** — a mode where you wire a void-edge between
  two regions. Small authored config (which pairs connect), and it keeps the **one-SSOT** rule: the graph
  is region-editor data, *not* inferred from zone-id prefixes or scattered flags. *(As built, there is no
  departure-gate tile at all — the whole region edge is the gate: `VOIDS` is keyed by `flags.region_id`,
  the region SSOT, so any tile in the region can strike out and any unexited region edge is porous to the
  void.)*
- **Seen by players as an abstract *frontier map*, not the grid.** You can't draw this to scale — the
  Reach is ~1,000 tiles from Coldwater and the void between has no real geometry. So the player view is
  a **topology diagram** (region-islands as nodes, void-routes as edges — a subway/travel-network read),
  *not* the tile-grid [Map app](systems-world.md#minimap) bigmap. It surfaces in **two places (both):**
  - **At the gate** (diegetic, in-world): standing at a departure threshold reads out the reachable
    neighbours — *"from here you can strike out toward: The Reach, Exodus."* The local slice, at the
    point of decision.
  - **On the Tablet** (persistent planning): a **Frontier** view/mode showing the whole known topology.
    This is where the weekly-solve knowledge is drawn — which routes you've survived, and the window's
    ghost-trace intel ("3 died on the Reach road this window").

**Fog model: fogged / earned.** You only see regions and routes you've **discovered** — heard of at a
gate, or survived. The frontier map fills in as you explore; a route's current-window danger/trace
intel is likewise earned by scouting or asking, not handed over. Discovery is a real progression layer.

**BUILT:** each void carries an `origin` region, and the adjacency graph is player-visible two ways:
**(1) the frontier readout** — the `frontier` verb anywhere in a void-region reads out the reachable
regions (*"the trail splits toward The Reach, Exodus"*); **(2) the Tablet Frontier app**
([`plugins/tablet/frontier-app.js`](../plugins/tablet/frontier-app.js), 🧭) — an abstract topology
(origin regions → routes), *not* the grid, rendered from `frontierView(player)`. **Fog is per-player
state** in a `frontier_log` flag (`routeId → charted|survived`): reading a gate or striking out
**charts** a route; arriving at a region **upgrades** it to *survived*. Written only on
discovery/arrival (rare). Still a **list**, not a graphical node-and-edge diagram; the window
ghost-trace intel overlay is not built.

---

## The survival gauntlet

### Primary clock: water + attrition

The meter most likely to kill a dawdler is **thirst**, compounded by **combat attrition**. There are no
natural water sources in the void; water is what you carried in, and it's the literal currency of
distance. Every extra step — every wrong branch, every retreat — costs water *and* exposes you to
another fight that chips HP you may not get back. Length compounds both. (Rad and cold/heat still tick
via the existing systems as secondary pressures, but water + fights are the spine.)

### The map: a branching roguelike graph

Movement is through a **branching graph**, forward-biased, with meaningful forks. The decision texture:

- **Risk-for-loot detours** — a branch leads to a wreck / ruin / mutagen cache with real salvage, but
  it's guarded, irradiated, or both. Greed vs. survival.
- **Blind gambles** — you often *can't tell what a branch holds* until you commit. The void is
  unknowable within a fresh window; that's where the dread lives. (Ghost-traces are how the community
  gradually converts blind gambles into informed ones over the week.)

**BUILT:** a **safe spine** (the distance-derived chain) plus seeded **risk-for-loot detours** — off
interior rooms, a lateral `west` exit into a dead-end gamble room (a half-buried wreck, a collapsed
bunker; `east` is the only way back out). Detours carry a **higher encounter chance**
(`DETOUR_ENCOUNTER_CHANCE 0.7` vs `ENCOUNTER_CHANCE 0.45`; a seeded hard node runs
`HARD_ENCOUNTER_CHANCE 0.85`) and hold the richer salvage tiers; their description is a **blind
gamble** ("salvage, maybe; a grave, maybe; both, maybe"). Seeded per `(route, window, node)` so the
forks are the same for everyone this window; **guaranteed ≥1 per crossing** so the choice always shows
up. Entering a detour is *not* progress (no node advance) and the instance reference-counts + tears
down detour rooms too.

### Risky rest sites

No safe haven, but not pure attrition either. Rare rooms (a cave, a wreck, a dead turret's shadow) let
you **rest and heal** — at a price: resting **burns water** and **risks an ambush interrupt**.
Recovery is a gamble you choose to take, not a given. HP otherwise does not passively regenerate in the
void (posture regen suppressed — consistent with "no indoor haven").

### Retreat costs

You can turn back, but the void doesn't care which way you face: re-walking rooms re-rolls their
encounters hot, and the return is as far and as dangerous as going forward. No free abort — a bad run
is a commitment, not a mistake you can casually undo.

### The encounter roster (live-rolled)

The full bestiary, rolled per step:

- **Wildblood raiders** — the renounce-faction mutants from [[project_wildlands_curtain]]; fight, flee,
  or maybe parley.
- **Mutant beasts** — irradiated fauna, territorial, no negotiation. Pure combat.
- **Desperate scavengers** — other broke crossers gone feral; might trade, might rob. Sometimes a
  resupply, sometimes a knife.
- **The void itself** — environmental set-pieces as "encounters": sinkholes, chem pools, a collapsed
  overpass, a turret-ghost still tracking. *(Not yet built — creature encounters are.)*

**BUILT:** on **first arrival** at a non-threshold room a **live roll**
(`ENCOUNTER_CHANCE 0.45`) spawns a **real enemy** from the void roster (`spawnEnemySync` → the normal
combat/AI systems take over — actual fights, real loot on the corpse). The roster is a curated pool of
committed wasteland foes (ash crawlers, rad/bloated mutants, feral dogs, wire jackals, scavengers,
scrap pickers, sprawl gangers, slag wretches), loaded once from the `enemies` table at boot; live-rolled
per step (private/fresh over the shared geometry — "same map, different war"). The crossing
reference-counts what it spawned and **despawns on teardown** (no foe leaks into a torn-down instance);
a room already holding an enemy never stacks another. Environmental "the void itself" hazards + the
retreat-re-rolls-hot rule are **not built**.

### Death and the trace it leaves

Death in the void is **real death** — clone-vat respawn, the run gone. But your **pack is left behind
as a ghost-trace**: because geometry is shared for the window, your corpse-pack sits at a real node
that *other crossers this window can find and loot*. You die for keeps; your gear becomes someone
else's fortune and a marker on the community's slowly-drawn map. (A small **traces** table keyed to
`(route, window, node)` is the only persistent void state besides player flags.)

**BUILT:** the dead are your map. Two trace kinds, keyed by
`(void_key, window, room_salt)` — the salt (`t2`/`reach1`/`d_t2`, carried on `flags.void_salt`) pins a
trace to the same room across **every private instance this window** (async presence, no live
collision — the bloodstain model):
- **Corpses** — dying in the void writes a corpse trace (`handle` + cause) at the death room. *(This is
  also where a void crossing gets torn down — respawn is an in-memory move, not a `cmdMove`, so
  `zone.entered` never fires; the `player.death` handler cleans up the dangling crossing.)* Lootable
  corpse-**packs** (the dead's dropped gear) land with Slice 5's loot economy — for now the corpse is a
  *clue* (where people died = danger intel).
- **Scrawls** — `scrawl <text>` leaves a **four-letter** mark (RUN, GAS, COLD, HELP…) at your room for
  whoever crosses here this window.
Both surface on room entry ("*Scratched into the ground, four letters: RUN*" / "*A body half-buried in
the dust — what's left of Kaz, killed by a rad-mutant.*"). **Near-zero DB** exactly as specced: one
INSERT per scrawl/death (rare), reads served from a per-`(void, window)` **RAM cache**, stale windows
purged on load. Void rooms are `flags.lawless` (die out here → clone-vat, never jail). Table:
`void_traces` (runtime-classified).

### Departure: free to die

Entering is **passive** — the threshold gives a warning read ("you carry 1 water; the far gate is
far") and then **lets you walk in and perish.** No hard supply gate. The player's funeral. Agency over
hand-holding.

**BUILT:** the void is owned by a whole **region**, keyed by `flags.region_id` — `VOIDS` is indexed by
region (`region_coldwater`), not a bespoke per-tile flag. **One way in: walk out of the world.** A
cardinal step off a boundary tile fires the generic engine hook **`movement.edge`** (from `cmdMove`'s
no-exit branch), which the plugin answers by opening the muster. The whole rim of a region is porous —
there is no gate tile, and no `flags.void_gate`. The `movement.edge` seam is a law that names no
system: any edge-of-map transition can use it.

**The rim is missing TILES, not missing exits.** `isMapRim(zone, direction)` resolves the neighbouring
**coordinate** on the same `map_id`/`grid_z` and counts it as rim only when no tile exists there at
all. Do not equate "no exit that way" with "edge of the world" — 483 world tiles sit beside a
neighbour they simply don't connect to (building facades, water margins), and treating those as rim
opens the muster when you bump a wall downtown. Both landmasses are hole-free rectangles
(Coldwater 863-955 × 896-947, The Reach 903-922 × **1032-1051**) → 362 boundary tiles.
*(The Reach's latitude was recorded here as 976-995 until 2026-08-21; the region moved south and
this line did not follow it. Verified against `content/zones/`.)*

**Water is not the rim.** You cross the waste on foot, so a tile whose `zoneTerrain` reads `water` has no
rim in any direction — no line, and no way in. The *entire* northern edge of Coldwater (all 93 tiles of
row y=896) is Coldwater Basin, plus 16 more down the east and west water margins. **109 of the 362
boundary tiles are open water, leaving 253 real land rim tiles.** Whatever is past the far shore belongs
to boats and the leviathan, not to the void.

**Salvage pays for the walk (rebalanced 2026-07-21).** `loot` fires once per room against a
three-tier `LOOT` table (spine rolls tiers 1–2, detours 2–3). The first cut was 4/4/3 items with
`item_scrap_metal` — which vendors buy for **₵0** — on tier 1, so a place that spawns enemy packs and
eats your corpse frequently paid nothing, and when it paid, it paid the same roadside junk you can
scavenge free on the spawn tile. Now:

| tier | diff | pool |
|---|---|---|
| 1 staples | 4 | 11 items, ~₵7.9 |
| 2 salvage | 8 | 20 items, ~₵16.1 |
| 3 rare | 12 | 6 items, ~₵75.1 |

Entries are `[itemId, maxQty]` and the quantity rolls `1..maxQty`, so staples and bulk materials can
come up as a real haul. A **near miss** (`margin >= NEAR_MISS`, −4) yields a tier-1 scrap rather than
nothing — a flat miss is a dead 3.5s in a room that can kill you. The regress `setSalvage` override
stays a hard pass/fail so the dud path is still testable.

**Two balance rules that bind when editing `LOOT`:** nothing worth ₵0 (e.g. `item_scrap_metal`, which
vendors won't buy) goes in a tier the spine can roll, or the void pays nothing for the risk it charges;
and **widen tiers 1–2, never tier 3** — adding ₵20-ish odds and ends to tier 3 dilutes the scrap-pistol
roll and *lowers* the payoff for the hardest check while looking like a reward increase.

**There is no entry verb.** You cannot decide to cross, only walk until the world runs out. `voidwalk`
stays registered solely because the muster overlay's buttons send `voidwalk cancel` /
`voidwalk say <text>` ([`client/game/js/panels/voidwalk-staging.js`](../client/game/js/panels/voidwalk-staging.js));
bare `voidwalk` returns an in-fiction refusal that points at the rim. The muster is a ready-check:
**every member of the cohort must `ready`** before the crossing launches.

**The muster screen is "VOIDWALKING" (renamed 2026-07-25).** It used to be titled *The Crossing* and
badged `ARCHITECT OS`; it now reads as the **VOIDLINK** firmware, matching the tablet out past the rim —
cold slate, scanline haze, survey brackets at the corners, a chromatic-split wordmark, and a rule
stamped `NO ROADS · NO RESCUE · NO RECORD` (`.vwstage-*` in `client/game/styles.css`). Stepping off the
edge also prints a ruled **ENTERING THE VOID** stamp in the message pane (`VOID_ENTRY_BANNER`, sent to
the leader and every follower) — deliberately ruled rather than boxed so no glyph has to line up with a
closing edge.

---

## The social layer

- **Party crossings** — depart and cross as a group. Full model in [Parties](#parties) below.
- **Ghost-traces** — corpse-packs and scrawled messages from the window's dead, pinned to real nodes.
  The accumulating record that turns a fresh-window death-trap into a midweek charted route.
- **The weekly solve-and-reset loop** — see window cadence above. This is the beating heart of the
  system's replayability.

---

## Parties

Parties **reuse the existing follow primitive** ([server/engine/commands/movement.js](../server/engine/commands/movement.js)
`player.following` + `dragFollowers`) — there is no new party object. `dragFollowers` already mirrors a
leader's *exact move* to same-zone followers; the void just extends that into the instance.

- **Formation = `follow` at the gate.** The **leader** declares the heading and departs; followers
  `follow` the leader and are dragged into the void with them. `dragFollowers` mirrors the leader's
  exact direction, so **only the leader reads the forks** — followers ride the leader's navigation node
  by node. Followers inherit the leader's heading; they don't declare their own.
- **Co-presence → one cohort → one shared fight.** The drag keeps everyone at the same node, and
  shared-seed geometry means it's literally the same room. The party is a single **cohort**, so the
  live encounter rolls **once for the group** — you meet the raiders together, more guns on one threat.
  That's the mechanical reason to party. A member who breaks off becomes their own cohort with their
  own rolls.
- **Fork behaviour: auto-drag + a leader "hold" call.** Followers auto-drag through forks by default
  (as follow works everywhere), but the leader can call a **halt at a branch** to regroup/discuss
  before committing. Trust by default, deliberation when the read matters.
- **Survival is pooled, not shared.** Everyone keeps their own water / HP / rad. Depth comes from
  logistics via existing `give`/`trade`: a strong member hauls extra water for the one running dry,
  someone carries the stims. The weakest link (or a leader's bad fork-read draining everyone's water on
  a detour) is the party's real enemy.
- **Death = losing a member for real.** A dead member is real-death'd → clone-vat respawn at the origin
  region, out of the run, follow-link auto-broken. Their **pack drops as a ghost-trace at that node**,
  so the survivors can loot their fallen friend's water and gear on the spot (and another party finds
  it next week).
- **Splitting & regrouping.** Unfollow to peel off (scout a blind loot detour) while the party waits at
  a rest site. Shared-seed geometry lets you navigate back, but retreat re-walks rooms and re-rolls
  their encounters hot — separation is a real gamble. Rest sites are the natural rally points.

### The void, on the Tablet

**BUILT, reworked 2026-07-22, polished 2026-07-25** (`client/game/js/panels/tablet-os.js`): the tablet
used to gate almost every app behind a live "pan the tablet to find a signal pocket" hunt, with apps
flickering out to a "D/C" badge and booting you back to the home screen if reception dropped mid-app —
it read as broken more than atmospheric. It's now a one-shot ritual in two beats, and **no app is ever
gated**:

1. **Void firmware boot** (`runVoidFirmwareBoot`). The first tablet open of a crossing gets the harsher
   voidwalking power-on into the device's *own* firmware terminal instead of the ArchitectOS logo:
   `VOIDLINK FIRMWARE 3.1.7-w` cold-starts line by line, fails the ArchitectOS uplink three times
   (`NO CARRIER`), gives up on grid services and boots into **VOIDLINK LOCAL — NO GRID**. Off-grid the
   chassis header renames itself `VOIDLINK / Local Firmware · Off Grid` for the whole crossing.
2. **Searching → weak lock.** The OS comes up in a **SEARCHING** state: the header reads
   `NO SIGNAL · SEARCHING`, a footer hint says *move the tablet*, and the screen's **text** flickers
   (`.tos-void-searching` animates `.tos-scroll` opacity — the panel itself never strobes; the old
   whole-screen brightness crush is gone). Actually dragging the tablet ≥60px finds the position: one
   soft brightness swell, and the badge locks to `WEAK SIGNAL · OFF GRID` **permanently for that
   crossing** — moving it again afterwards changes nothing.

Off-grid theming (`.tos-void-mode`: scanline haze, a slow drifting interference band, an accent
vignette pulse) persists as long as `isOnCrossing()` holds, purely cosmetic. The **TV app shows dead
air** out here — colour bars + a flickering `NO SIGNAL`, short-circuited in `renderTv` before the
shared tuner view is built, so no portable tuner is opened in the void. Entering a fresh crossing
re-arms both the firmware boot and the signal hunt.

Split-party comms across nodes without co-presence, and a gear-gated radio item to bridge that, remain
**unbuilt design** (not wired to anything today) — see [[project_tablet_chat_app]] for the chat app
itself, which is one of the apps that now Just Works once the tablet's signal locks.

### Party seam note

`dragFollowers` currently passes `bypassEncumbrance` (dragged moves skip the run-stamina toll). In the
void, each follower must still pay their **own per-step water** — a deliberate deviation, or a party
crosses on one member's navigation for free.

---

## Instancing — one void per party

**Each party gets its own instance of the void. Parties never run into each other live.** This is *the
reason the shared `(origin, window)` seed exists*: it makes every party's private instance the **same
map layout**, so cross-party contact happens **asynchronously, through the dead** —

- Party A dies at "overpass-left, node 5" → a ghost-trace pins there.
- Party B, later that week in *their own* instance, walks up to overpass-left node 5 and **finds A's
  corpse-pack and scrawl** — same node, same map.

This is the **Dark Souls bloodstain model**: instanced world, no live collision, shared
messages/ghosts stitched across instances by a common seed. Live co-presence was never the goal — the
shared geometry exists to make *asynchronous* presence geometrically real. (Live co-presence would make
the whole trace system redundant.)

Why instanced is the right default:

- **Grief-proof by construction** — no spawn-camping a broke newbie at the gate.
- **Clean encounter rolls** — "per party per step" only holds if a party's void is theirs alone.
- **Cheap** — no live-occupancy tracking of synthetic rooms, no crowd netcode in generated space; a
  party instance is just its follow-cohort over the memoized geometry. Preserves the near-zero-DB story.
- **Tone** — lonely and haunted, not crowded. You're alone out there except for the dead. Scarier, and
  it matches the "off-grid / NO SIGNAL" mood.

**BUILT:** a crossing is a per-crossing **instance** in the `crossings` registry,
keyed by a unique instance id; room IDs are namespaced by the instance (`xing_<leader>_<n>_<node>`) while
room *content* is seeded by `(route, window, node)` — shared geometry, private instance. A **party shares
one instance**: the cohort is the leader + everyone **following** them (the follow substrate — no party
import) co-present at the origin, all placed into room 0 together and reference-counted, so the transient
rooms tear down only when the **last** member leaves. The current room is RAM-only, flushed to
`crossing_room` on `player.logout` (not per step). Relog re-derives the instance from
`crossing_instance`; the first member back rebuilds it, the rest join.

**Decision: strictly instanced + async for v1.** But leave the door open — architect the instance
seam so **opt-in live overlap can bolt on later** without a rewrite:

- *Later — co-op summon:* a beacon/flare item lets a friend's party deliberately join **your** instance
  (cross-party co-op); random strangers still never appear.
- *Later — PvP invasion:* a hostile player can invade your crossing (full Souls). Maximum tension, but
  opens griefing and needs PvP rules — a deliberate future layer, not v1.

The practical seam requirement: an instance is keyed by an **owning cohort id**, not hard-bound to a
single party — so "admit another cohort into this instance" is later a permission change, not a
re-architecture.

---

## Payoff — why anyone crosses

- **The only cheap way in.** The reward is *access*: you reached The Reach without affording flight +
  licence + fuel. The journey is its own gate. (Foot's primary niche: the broke early-game player.)
- **Salvage that exists nowhere else.** The void's loot — pre-war wrecks, mutagens, contraband — makes
  crossing worthwhile *even for pilots*. This is what widens the audience beyond newbies: the equipped
  walk the void on purpose for the detour caches. Full model in [Loot & scavenging](#loot--scavenging).

---

## Loot & scavenging

The void is where the [Scavenging system](systems-scavenging.md) finally has a frontier to justify it.
**Reuse the Scavenging skill + posture-search UX + the 2D8−2D8 check** — but since the void has no DB
zones, the **generator assigns each room a scavenge table + richness tier deterministically**
(`f(origin, window, node)`), and the check runs **live in RAM**. Same skill, same feel, zero DB, and
"good scav ability" is directly rewarded: a high-Scavenging character finds more, and finds the *rare*
tier a low-scav one walks past. This gives parties a genuine **role split** — navigator (leader),
water-mule, and **scavenger** (turns a deadly detour into a payday).

**BUILT (Slice 5a — ambient scavenging, branch `void-travel`):** the **`loot`** verb reuses
`effectiveSkill(player,'scavenging')` + the 2d8−2d8 check + `awardSkillUse` (a near-miss still trains
you). Loot is generated in RAM — a 3-tier table (`LOOT`: staples `diff 4` → salvage `diff 8` → rare
`diff 12`), drawn from committed items (water/rations up top, wiring/circuits/ore mid, mystery-component/
glowing-scrap/scrap-pistol rare). A room offers a **richness tier** — spine rooms `[1,2]`, **detours
`[2,3]`** (the branching finally pays) — and your Scavenging skill decides whether you reach the good
stuff. **Once per room per crossing.**

**BUILT (Slice 5b — corpse-packs + claim-ledger):** `loot` now resolves in three tiers — **big score →
corpse-pack → ambient scavenging**:
- **Lootable corpse-packs** — the engine's `spawnPlayerCorpse` already strips the dead's gear into a
  `player_corpses` row at the death room; the `player.death` handler **re-homes** those item ids onto the
  shared void trace (`void_traces.pack`) and deletes the orphaned corpse. Another crosser, in their *own*
  instance, sees the corpse at the same `room_salt` and `loot`s it — granted the gear, and the trace's
  `claimed` flag flips **globally first-come** (the async race).
- **Weekly big score** — one telegraphed prize per `(void, window)` at a seeded shared-trunk room ("*The
  hulk of a downed gunship dominates this stretch*"), kept globally scarce by a `bigscore_claim` trace:
  the **first** crosser to `loot` it takes it; everyone after finds it stripped. Same async-scarcity
  mechanic, same cached `void_traces`.
Not built: depth-scaling + the rare-loot-is-heavy extraction tension. Carried *credits* are lost on
void death (not re-homed).

### Loot tiers, scaled to risk

- **Survival staples** (water, rations, scrap) — the *self-sustaining* reward: good scav extends your
  crossing range, so scavenging is a survival tactic, not just greed.
- **Salvage & contraband** — mutagens, components, `contraband`-tagged goods for the Reach fence.
- **Rare void-unique** — pre-war wrecks, prototype gear; the stuff that pulls *pilots* out of the sky.

Rarity scales with **depth** (deeper nodes pay better — the water-gamble of pushing on has a return),
**detour risk** (guarded/irradiated branches hide the best), **node danger**, and **Scavenging skill**.
And it feeds the greed-kills tension: **rare loot is heavy** — extracting it means hauling it back out
(retreat costs) or pushing to the far side, sometimes trading water capacity for salvage. Finding it is
the easy part.

### Two loot classes (because instances aren't naturally scarce)

Each party crosses its **own instance**, so a node's loot exists in *everyone's* run — "rare" would
otherwise mean only "hard to reach," not "few exist." So loot splits:

1. **Ambient scavenging** — per-instance, unlimited, skill-gated. Your run, your finds. (Staples +
   common salvage.) No scarcity needed; everyone scavs their own crossing.
2. **Weekly "big scores"** — a few genuine uniques per window, kept **globally scarce by a claim
   ledger** (see below). The frontier's real prizes, and they *run out*.

### Big scores: telegraphed **and** hidden, gated by a weekly claim ledger

Both kinds coexist:

- **Headline prize** — a telegraphed weekly objective the frontier *knows about and hunts* (e.g. "a
  downed gunship went down on the Reach road this window"). Drives the weekly-solve: everyone races
  (asynchronously) to reach and strip it before the window resets.
- **Hidden finds** — unadvertised rares that reward thorough scavengers who search every corner. No
  hype, pure exploration payoff.

Both are kept scarce by a **claim ledger**: a tiny global counter per `(void_origin, window, prize)`
tracks how many have been extracted. Under the [instancing](#instancing--one-void-per-party) model this
is the *async race* — you never fight another party live, but when you reach the node the prize may be
**already claimed this window** ("someone stripped the gunship before you"). That's real, felt scarcity
without live collision, and ghost-traces cluster around the prize nodes ("people died reaching for
this"). Cost: **one small write on extraction** (rare event) + a per-window claim-state read served
from the same process cache as traces — stays within the near-zero-DB budget.

---

## First build: The Reach, via the Wildlands as the near leg

The Reach is locked as air-only by identity ("the only way in/out is Buzzard Field," Cass Renner
decides who lands). Foot access is a **deliberate identity evolution**: The Reach becomes reachable
**by air OR by the gauntlet** — the brutal poor-person's smuggler trail into the haven. This *fits* the
fiction (lawless contraband haven where the "wrong kind" are welcome) rather than betraying it.

The geography makes The Reach the natural first destination:

- The Reach is **south** (`grid_y ~1948`). The Wildlands are **south** (`grid_y ≥ 920`), with a
  "Deeper Wild" stub already at `919_927` pointing further south.
- So the road to The Reach **runs through the Wildblood badlands and keeps going.** The Wildlands
  aren't a separate project — they're the **near leg** of the Reach crossing. Finishing them *is*
  building the first half of the trail.
- Route: `Coldwater → South Gate (918_919) → the Thornwarren → [the void] → Buzzard Field's back door`.

Because The Reach is `flags.lawless`, dying in the void while wanted-elsewhere does not jail you
(consistent with the existing lawless-respawn gate) — you just clone-vat respawn.

**Then:** the Exodus road (path-mind renounce faction) as the second route, proving the generator
generalizes to a second region pair.

---

## Reuse ledger (what already exists)

| Need | Existing system |
|---|---|
| Thirst/hunger clock | [systems-survival.md](systems-survival.md) hunger/thirst |
| Radiation secondary pressure | survival radiation/mutations |
| Cold/heat exposure | [[project_body_temperature_system]] |
| Weather with no safe haven | [systems-weather-extreme.md](systems-weather-extreme.md) severity |
| Stamina / movement cost | [[project_run_mode_gps_walk]] run/walk + winded |
| Lethality tiers | `server/engine/danger.js` `zoneDanger` |
| Turret hazards (if used) | perimeter turret design in [[project_wildlands_curtain]] |
| Lawless respawn (no jail) | [[project_the_reach]] jail gate |
| Combat / flee / loot | existing combat + [[project_turnin_flee_creditchip_batch]] flee roll |
| Scavenging (skill + search UX + 2D8−2D8 check) | [systems-scavenging.md](systems-scavenging.md) [[project_fishing_system]]-adjacent |
| Renounce-faction NPCs | [[project_wildlands_curtain]] Wildblood roster |
| Party grouping | `follow` / `dragFollowers` in `server/engine/commands/movement.js` |
| Resource pooling in a party | existing `give` / `trade` ([[project_trade_window]]) |
| Party comms (signal-loss + radio) | [[project_tablet_chat_app]] chat app (goes NO SIGNAL) + a radio gear item |
| Region authoring surface | dev-panel **World Editor** ([[project_world_editor_districts]]) — add void-edge mode |
| Player map surface | [[project_tablet_map_app]] Tablet (new **Frontier** topology view) |

---

## Server / DB cost

The seed-based model was chosen precisely so the void is **near-zero DB**, and it scales linearly with
the number of routes. Against the [read/write tiers](architecture.md#read-tiers-where-data-lives-at-runtime):

| Event | Cost | Why |
|---|---|---|
| **Move through the void** (hot path) | **0 DB round trips** | Geometry is computed in memory; the live instance is `player._crossing` and the current room is flushed to the `crossing_room` flag only on `player.logout` (**not per step**); encounters roll from in-RAM tables. Nothing awaits a query per step. |
| **Depart** | ~1 write (deferrable) | Set the crossing `player_flags`; coalesces with the zone-move persistence already happening. |
| **Arrive** | ~1 write | Clear the flags — piggybacks the normal destination-zone move write. |
| **Death** | 1 insert (rare) | Write the ghost-trace. Death is not a hot path. |
| **Scavenge a room** | **0 DB round trips** | Table + tier are generator-derived in RAM; the 2D8−2D8 check + roll run in memory. Per-instance depletion held in the instance object. |
| **Extract a big-score unique** | 1 write (rare) | Increment the `(void_origin, window, prize)` claim ledger. Claim-state reads served from the same process cache as traces. |
| **Read ghost-traces** | **0 per move** | Loaded once per `(voidOrigin, window)` into a process-level cache; served from RAM, shared across all crossers that window. |
| **Window rotate / purge** | 1 scheduled delete / week / void | Idle-gated via `scheduler.js`, weekly. Trivial. |

Two consequences worth stating:

- **Void movement is cheaper than normal grid movement** — no destination-zone lookup at all, just a
  pure function. The instance is CPU, not I/O; and because the seed is shared per `(voidOrigin, window)`
  the geometry is memoized once per window, so even the CPU is amortized across everyone crossing.
- **Multi-region scaling is linear and cheap** — N voids = N independent small trace sets + N memoized
  geometries, none of it touching the DB on the hot path. Growing the adjacency graph adds authored
  config, not runtime load.

---

## The engine work, and what's left

The generator, adjacency graph + its two surfaces, fog state, traces table, and loot/claim-ledger are
covered in the sections above. Two engine-side contracts and the honest remainder:

**Transient-zone substrate (`server/engine/world.js`).** `registerTransientZone(zone)` /
`removeTransientZone(id)` / `isTransientZone(id)` — the engine-owned write API for the zone store. A
transient zone lives in `world.zones` like any zone (movement, `describeZone`, per-player minimap all
read it), is normalized to the full loaded-zone shape (occupant Sets + `exits`/`flags`/`description`
defaults), and is **never persisted**: nothing writes `world.zones`→DB, export queries the DB
directly, and `getAllZones()` (the bulk corps/gps/work scan) excludes it via the `world.transientZones`
marker Set. `removeTransientZone` refuses to evict a real DB zone. **Give a transient room a
non-`map_world` `map_id`** so flag/map-filtered iterators skip it.

**Minimap crossing mode.** `getMinimapData` flags void rooms (`void_crossing` / `void_detour`) on each
node; when the current node is `void_crossing` the client
([client/game/js/panels/minimap.js](../client/game/js/panels/minimap.js) `renderCrossing`) drops the
city grid for a stylized **ashen trail view** — the walked trail behind you (dim, following the
`north`/back exits room to room), a pulsing **◎ you** beacon, and the trail continuing into **fog**
(`⋯`) ahead or onto the **far gate** (`⌂`, when `south` leaves the void map onto a region). Fork/detour
options off your *current* room show as branch ticks (**⋔** divert / **?** gamble). It charts only what
you'd honestly know — the layout **ahead stays fogged**; no per-room "seen" state is needed since
`north` is always "back". All three minimaps (sidebar/HUD/mobile) share the render.

**Not built:** the landform field and room positions (the premise above — the largest of these, and
the one the rest lean on); the party-coordination extras (leader "hold" at forks, per-follower water
toll on drag — `dragFollowers` still passes `bypassEncumbrance` — and the radio gear item for a
split-party channel); environmental "the void itself" hazards; the retreat-re-rolls-hot rule; loot
depth-scaling.

**Decided but unbuilt:** the flight off-world read. It was open between "a crosser is invisible from
the air" and "a deliberate specks-in-the-waste", and the premise settles it without a flag — a
crosser hugging the road is visible and one on a hard cut is not, because that is what distance from
the centreline already means to the canopy.

---

## Open questions (not yet decided)

- **Water math** — **ANSWERED IN PRINCIPLE, UNTUNED.** The premise gives it the denominator it never
  had: drain-per-tile against a known crossing length, so a cut's saving *is* its tile count and the
  gamble is priced by the map rather than by a hand-picked multiplier. What is still open is the
  numbers — drain rate vs. carry capacity — which wants a pass once the landform field exists.
- **Crossing length** — **SETTLED: a room is a tile.** The room count IS the gate-to-gate distance,
  deterministic so a relog regenerates the same walk: **Coldwater→Reach 93, Reach→Deadwater 99,
  Coldwater→Deadwater 108, Terminus→Scarletwastes 109, Coldwater→Terminus 282**. Room count and road
  length used to be two answers to one question — a clamped abstraction beside a road built gate to
  gate in real tiles, with `roomLen` converting between them — and there is now nothing to convert
  and nothing that can disagree. A route's explicit `length` still overrides, and nothing uses one.
  Still open: whether to weight by danger or terrain rather than pure Euclidean.
- **Rest-site frequency** and how much they heal vs. cost.
- **Loot-detour value curve** — **ANSWERED BY GEOMETRY:** value scales with how far off the road the
  detour goes, because the good salvage survives out where nobody drives. Still open is the curve's
  steepness, and the original question behind it — how good must it be to pull a *pilot* off their
  aircraft.
- **Trace purge / griefing** — can a corpse-pack be camped? Does looting a ghost cost anything?
- **Cross-region generality** — does the same generator serve Exodus, future routes, and eventually
  procedural sewers/dungeons (the instancing seam's stretch payoff)?
