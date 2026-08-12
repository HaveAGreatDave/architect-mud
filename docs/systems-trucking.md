# THE LONG HAUL — driving the void

**STATUS: Built — buy a truck, keep it running, take work, haul it. Four models, contracts, a commodity market, fuel, solid buildings, an eight-speed box with a diesel voice, and the rig — trailer articulation, reverse and brake fade. The depot is now a building you walk into, with a garage floor you can click a rig on, a walkaround, a dealer's line and a maintenance bench (condition, repair, four tuning dials, kits, paint). The scale house, trailers as world objects, hitchhikers and city driving are all built too — every phase of the design has shipped, and so are the four things the build itself turned up: breakdowns with a roadside `fix`, the fork as a junction you can take (`route`), wipers, and a CB that reports real wrecks — see [proposals](proposals/the-long-haul.md).**

Freight hauling by road. You take a load at a depot in Coldwater, drive it through the city to the
edge of the map, cross the waste on a highway that does not exist until you drive it, and back onto
a dock in The Reach to get paid. A crossing that was a hard walk becomes a job.

Cross Country Canada by way of a post-singularity waste: long empty hauls, a truck that has weight,
and a city that resolves out of the haze at the end of it.

---

## Where the code is

| Piece | File |
| --- | --- |
| Corridor geometry + cell synthesis | [plugins/trucking/corridor.js](../plugins/trucking/corridor.js) |
| Rig state, the clamp, node crossings, the cab push | [plugins/trucking/state.js](../plugins/trucking/state.js) |
| Verbs (`drive`, `hitch`, `unhitch`, `stash`, `pickup`, `revs`, `boot`, `cruise`, `coast`, `brake`, `jake`, `park`, `fix`, `route`, `cb`, `haul`, `market`, `yard`, `rig`, `fuel`, `trucksync`, `truckevent`) | [plugins/trucking/index.js](../plugins/trucking/index.js) |
| The physics (`stepTruck`, the gearbox, the articulation angle, `SURFACES`) | [client/game/js/panels/flight-model.js](../client/game/js/panels/flight-model.js) |
| The cab (60fps loop, gauges, wheel) | [client/game/js/panels/cab-view.js](../client/game/js/panels/cab-view.js) |
| Cab interior + mirrors | `drawCabInterior` in [windshield.js](../client/game/js/panels/windshield.js) |
| Ground collision | `groundObstructionAt` + `segContains` in [windshield.js](../client/game/js/panels/windshield.js) |
| The scale house, customs, impound | [plugins/trucking/scale.js](../plugins/trucking/scale.js) |
| Trailers as world objects | [plugins/trucking/trailers.js](../plugins/trucking/trailers.js) · `trailers` table in SCHEMA_SQL |
| People on the shoulder | [plugins/trucking/hitchers.js](../plugins/trucking/hitchers.js) |
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
trucking passes `corridorProvider(route)`.

> **Why this is a rule and not a preference.** [snapshot.js](../plugins/flight/snapshot.js) used to
> keep its own copy of that per-cell derivation. It drifted twice — the baked flight world silently
> lost 144 painted-only street tiles, then lost authored park features. Both copies now call the
> shared `deriveSurfaceCell`.

**Author the road icon explicitly.** `corridorAt` always sets `flags.icon`. The auto-tiler ORs
together every adjacent road cell, and the corridor's shoulder is `dirt_road` — which counts as
road — so an unauthored corridor comes back `nesw` on *every* tile and the renderer paints a
crossroads for the entire length of the highway. Verified both ways.

### 2. The drive IS the crossing

`player.current_zone` stays the void room the whole way. The odometer crossing a node boundary
walks the player one room down the spine and emits `zone.entered` — exactly what a footstep does.

So voidwalking's encounters, ghost-traces, hard nodes, detours and teardown are **triggered here
and implemented nowhere here**. A trucker who breaks down finishes the crossing on foot at a cost
of zero extra code.

`node = floor(s / TILES_PER_ROOM)`. The two plugins meet through named exports on voidwalking's
public surface — `crossingChain`, `crossingDest`, `crossingInfo` — never by reaching into its
internals. `player._crossing` deliberately carries only `{ instanceId, seen }`; everything else
about a crossing is shared state and lives on the crossing.

### 3. One rig, two legs — the provider is the only difference

A haul is driven in two different worlds and the rig moves between them by swapping **one function**:

| Leg | `x`/`y` are | Provider | A tile is |
| --- | --- | --- | --- |
| `city` | real world grid coords | `surfaceAt` | a real zone you are standing in |
| `corridor` | corridor coords | `corridorProvider(route)` | 1/90th of a void room |

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
| **Ostrek Courier** | 4,200₵ | 1,800 kg | 1,100 | 74 | 9.9 s |
| **Vachon Drayman** | 11,500₵ | 3,500 kg | 1,400 | 66 | 17.2 s |
| **Orlov Continental** | 31,000₵ | 6,200 kg | 2,100 | 63 | 18.2 s |

**The spread is in different directions, not one "better" axis.** The Mule is the *fastest* thing in
the fleet and can't carry a full commodity load; the Continental is slower than the Drayman and
swallows a whole market. Range is the other half of the ladder. **The run is 765 tiles one way** (44 of Coldwater road, 720
of corridor, one into the yard), so only the Orlov round-trips on a fill — everything below it must
refuel at the far end, and the Barrow arrives on 10%.

> **Naming.** Trucks are an invented **maker + haulage model** — a drayman drove a brewery cart, a
> barrow is the humblest cart there is. Deliberately a different family from the aircraft, which are
> animals and insects (Mayfly, Locust, Dragonfly, **Mule**). An early cut called the light one the
> *Kestrel Mule* and collided with `ac_mule` on both halves at once; a regress case now asserts no
> truck borrows an airframe's name.

A truck is a `trucks` row with an owner and a place, exactly as an aircraft is — everything *about*
the model (speed, deck, tank, price) lives in `TYPES` and nothing is duplicated in the table. **One
truck to a yard**, so `drive` never has to ask which. Resale is 55% minus odometer wear, capped at a
quarter off: a commitment, not a savings account to shuffle money through.

> **A gauge that never bites is decoration.** For a long time fuel counted down to zero and the
> truck simply carried on, which made every tank number a label rather than a constraint. Running
> dry now stops the rig dead — `park` and walk, which on a crossing means finishing it on foot
> exactly as a breakdown always did — with a low-fuel warning once on the way past. The stop is
> announced but **must not short-circuit the sync handler**: an early return there skipped every
> arrival and delivery below it, so a rig that ran dry one tile from the dock could never finish.
> The text rung burns and dries identically; a rung must never be a way to dodge a constraint.

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

### A depot is a building you walk into *(2026-08-11)*

The depot flag used to live on the **street**, and the whole shop — the dealer's line, the freight
board, the commodities exchange — bloomed over the road because you crossed a particular kerb.
Nothing else in the game does that: a shop is somewhere you go inside, and the hangar this entire
system was modelled on has been a walk-in interior since the day it was written.

So `flags.truck_depot` now belongs on an **interior zone behind a facade**, and it carries one more
key:

```json
"truck_depot": { "name": "The Roadhead Depot", "yard": "zone_terminus_1202_916" }
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
truck in the game drove exactly like the 4,200₵ Courier — same gears, same top speed, same brakes,
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
all key off it, and nothing else does. It is clamped against elapsed wall-clock and is monotonic
(phase 1 has no reverse, so a decreasing odometer is an attempt to re-drive paid road).

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

**Hitchhikers are seeded facts, not NPC rows** — a corridor node is transient, so an NPC whose home
is deleted when the crossing ends is the wrong machinery. `hitcherAt` is a pure function of route
and node, so the same stretch has the same person on it for everyone this week and both rungs see
them with nothing to keep in step. Four kinds, and you cannot tell which from the roadside.

**The fugitive closes the design.** They ask where they should ride, and the fork is the whole
system pointed at a person: **the sleeper** is fast and free and anyone who looks in the cab finds
them; **the trailer** is invisible to a look and is *eighty kilos the weighbridge can see*. Letting
them out a mile short of the plates is a real, unscripted play, and it is free.

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

**A crash in a city is a crime; a crash in the waste is a bad afternoon.** Same impact, same speed,
different consequence, and the difference is only whether anybody was there to see it. Past
`RECKLESS_MPH` on the city leg it charges `vandalism` — you have destroyed somebody's property in
the street — and the witnessed-crime system does the rest with nothing bespoke. The corridor is
charged with nothing at all, because the waste has no owners and no witnesses. The load takes it
either way: freight that has just been through a wall is worth less, and the contract pays on what
arrives.

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
polyline *without* the destination and only the limb with it, and never lets a leg straddle the
boundary. Before that, the two roads diverged from the gate — and changing your mind would have
teleported the rig sideways onto tarmac that had been somewhere else the whole way. The boundary
also forces a jog, so **the junction is a bend you can see** rather than a room name changing.

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
