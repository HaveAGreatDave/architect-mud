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

**Glass is a rung on the fleet ladder** *(2026-08-14)*. The dials' cover was one flat linear wash,
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
polyline *without* the destination and only the limb with it, and never lets a leg straddle the
boundary. Before that, the two roads diverged from the gate — and changing your mind would have
teleported the rig sideways onto tarmac that had been somewhere else the whole way. The boundary
also forces a jog, so **the junction is a bend you can see** rather than a room name changing.

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

### Retro-future, on purpose *(2026-08-12)*

The mesh had drifted into "20th-century semi with a light strip". The brief is a 1957 idea of what
a truck in 2100 looks like, so: **vertical chrome grille teeth** with a turned **bullet** in the
mouth of them, **dagmars** on the bumper, quad headlamps under a chromed brow, a **chrome spear**
tapering down each flank, **tail fins** off the back corners of the cab with a red lens in each,
stacks that finish in a **flared nozzle** with fins round the base, a **whip aerial** with a ball on
the end, and a chrome trim band round every lifter — which is also what stops a pod looking like a
black brick when its emitter is off, i.e. whenever the truck is parked. All of it is `fine`-gated,
so a distant contact still costs what it did.

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
