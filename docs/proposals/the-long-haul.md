# Concept: THE LONG HAUL — a truck sim on the flight sim's world

## Context

The flight sim already contains a complete 3D world renderer that nothing but aircraft use.
`paintWindshield` draws a Mode-7 ground, extruded buildings, **and roads with lane markings and
correct junction pieces** (`drawGroundSurfaces` reads a `rd` connector string — `'nes'`, `'ew'`)
from a server-built map window. Its camera (`makeCam`) is a flat-ground pinhole whose eye height is
`RENDER_TUNE.eh + height * climbLift` — pass `height: 0` and it is already a ground camera. The
yacht (`plugins/yacht/` + `helm-view.js`) has already proved a non-flying vehicle can drive that
renderer with its own console.

Meanwhile `plugins/voidwalking/` turns the space between regions into transient procedural rooms —
5–15 nodes at `TILES_PER_ROOM = 90`, seeded purely from (route, weekly window, node), with
encounters, detours and death-traces. Right now crossing it on foot is a hard gauntlet you endure.

The concept: **the road between regions becomes a thing you drive**, Cross Country Canada by way of
a post-singularity waste. Long empty hauls, a rig that has weight, and a city that resolves out of
the haze at the end of it.

Decisions taken: **driving-sim-first** (freight is the excuse to drive) and **region-to-region over
the void routes** (not city delivery).

---

## The shape of it

You buy or lease a rig, take a haul at a depot on a region's rim, and roll out onto the highway
between Coldwater and The Reach. The drive is continuous and first-person out the windshield: a
two-lane ribbon of cracked asphalt, gravel shoulders, terrain changing under the wheels room by
room, a grain elevator or a dead motel every forty tiles. You manage fuel, gears, brake temperature
and a load that changes how the truck stops. Twenty-odd minutes later the Reach comes up out of the
fog and you dismount at a depot.

The road is not empty of consequence. Every void node you pass is a real place — an encounter rolls,
the rig halts, and you are standing in the room you were already in, so `look`, `fight`, `loot` and
`flee` all just work. The detour limbs off the spine become gravel spurs you can actually steer onto.
Ghost-traces from players who died out there become roadside wrecks.

---

## The three ideas the whole thing rests on

**1. Synthesise the *zone*, never the render cell.**
The void has no world tiles, so a driving sim there needs a world from nowhere. The trap is to
synthesise the finished render cell (`{kind, biome, road, rd, bt…}`) — that is a second derivation of
every rendering rule, and `plugins/flight/snapshot.js` already proves it drifts (its `deriveCell` is
a hand-maintained copy of `mapWindow`'s logic and has fallen behind twice). Instead a
`corridorAt(route, x, y)` returns a **surface-cell-shaped** object — `{ id, name, flags, danger }`
with `flags.terrain: 'road'`, `flags.icon: 'road_ns'` — pure and seeded exactly as `mkRoom` is. Then
road auto-tiling, lane markings, biome, extrusion, curtain, all of it works untouched.

The seam: `mapWindow(a, radius, at = surfaceAt)` — thread the cell lookup as a parameter. Flight
passes `surfaceAt`, trucking passes `corridorAt`, and `snapshot.js` loses its duplicate. One
mechanical change unlocks the whole idea.

**2. The drive IS the void crossing, not a parallel one.**
`current_zone` stays the void room the entire time. The truck is a pacing-and-rendering layer over
the existing room chain exactly as walking is. The odometer crossing a node boundary is a `move`.
So the route table, encounters, hard nodes, detours, traces, frontier-charting and the five
`player_flags` are all reused rather than re-implemented — and a trucker who breaks down finishes
the crossing on foot at zero extra cost.

**3. The edge of the road is a law, not a wall.**
No building collision — the corridor has no buildings except at its ends, so the hard version buys
nothing. Paved is fast, shoulder rumbles and loses grip, off-road clamps speed and damages the load,
and past the corridor's half-width you are simply bogged: stalled, penalised in time and fuel, put
back on the shoulder. Never a crash you can't read.

---

## The terminal loop — leaving, parking, arriving, and getting searched

The drive is the middle. The ends are where the game is, and none of it needs new invention: the
flight sim already solved "vehicle in a yard, owner-gated, rent a bay, board from the office", and
the Reach fence already solved "you landed somewhere policed carrying something dirty".

### The yard (copied wholesale from `hangars.js`)

A **truck yard** is a `hangar`-shaped row — `(yard_zone, owner_id, rent_paid_until, rent_per_period)`.
Two zones per yard, exactly as an airfield has them: a **yard office** interior
(`flags.yard_interior`) and an outdoor **apron** tile on the region rim (`flags.yard_apron`,
`flags.yard_interior_zone` pointing back). This mirrors `flags.hangar_interior` / `hangar_ramp`
verbatim, so `boardFound()`'s retarget logic — stand in the office and `board` puts you on the apron,
stand on the apron and it tells you to go `in` — is copied, not designed.

Same two-state ownership bit that already means something for aircraft: `truck.yard_id` set = stored
and safe; `parked_zone_id` set = sitting on the apron and **stealable**. Boarding someone else's rig
on an open apron is `WANTED_RAISE 3` grand theft, same as an aircraft on an open ramp.

Coldwater's yard sits on a southern rim tile of the district grid (the `dir: 'south'` fork in `VOIDS`).
There is already a bonded-warehouse zone in the tree with exactly the right prose —
`content/zones/zone_yard_bonded.json`, "Bonded & Bothered", customs seals and a caged clerk's office —
which is either the yard office or its neighbour. The Reach end lands beside
`zone_the_reach_870_1958`, which is Buzzard Field, which is **`lawless: true`** — and that asymmetry
is the whole customs design (below).

### Departure

`board` in the yard office → you're on the apron in the cab, engine off, windshield up but static.
`load <contract>` puts freight on. `depart` (or just rolling forward) is the moment the truck leaves
real tiles for the corridor: it hands off to `launchCrossing` in `plugins/voidwalking/`, which is the
same function a walker uses — the truck is a crossing, so the five `player_flags` are written and a
relog puts you back in the cab mid-route. The corridor's first two rooms delegate to `surfaceAt` on
real region tiles, so the city physically recedes in the mirror rather than cutting.

### Parking and arrival

Arrival is `parkAt`'s pattern rather than `parkAt` itself: the odometer passing `L` snaps the rig to
the destination apron, kills airborne-equivalent state, and moves every occupant into
`flags.yard_interior_zone`. Mid-route you can also **pull off** — `truckevent pulloff` at a shoulder
or a roadside stop parks the rig *in the void room you're standing in*, which is what makes sleeping
in the cab, roadside encounters and breakdowns all one mechanic instead of three. `disembark` on the
corridor is legal and slightly reckless; the rig is still there when you come back, unless something
found it first.

### Contraband searches — the scale house

Two gates, and they are not the same shape.

**Outbound, Coldwater — the checkpoint.** A `flags.checkpoint_cfg` on the yard apron tile. That
system already exists (`plugins/checkpoint/`, one `registerMoveGate`, no verbs, `checks: [wanted,
smuggle, contraband]`), and the whole point of it is that **a checkpoint is a tile flag, not a
plugin**. Leaving a policed yard with a wanted star or a dirty trailer is a gate roll before you ever
touch the highway. Nothing new is written.

**Inbound and roadside — the weigh station.** This is the one idea worth building rather than
borrowing, and it is native to trucks in a way the flight customs scan isn't: **the scale detects
weight, not contraband.** Your manifest says the trailer holds 4,200 kg of crop. The scale says
5,000. It doesn't know what the other 800 kg is — it knows you lied. Which means:

- Detection difficulty keys off **discrepancy**, not off a tier lookup, so the counter-play is
  *hauling less* or *declaring more*, both of which cost money. `item_contraband_crate` already
  weighs 800 kg — the numbers are sitting there.
- A legal overweight load fails the same scale. Getting fined for honest greed and getting caught
  smuggling are the same interaction, which is exactly the Cross Country Canada texture.
- `runRawScan` in `plugins/smuggle/` still fires for what's on your *person* (it deliberately has no
  container filter — "bags beat glances, not scanners"), so the trailer and the cab are two separate
  risks with two different counter-plays.

Resolution reuses the Reach's proven fork: a `pendingCustoms`-style timer and the existing verbs
**`customs bribe`** / **`customs bolt`**, with a truck-native third option — **`customs open`**, submit
to the inspection and eat the seizure without the crime charge. Bolting from a *weigh station* means
running the scale, which is a chase on the corridor rather than an abstract roll, and that is Phase 3
content the driving sim earns for free.

**Buzzard Field is `lawless: true`, so the Reach end never scans.** Coldwater→Reach is the smuggling
run; Reach→Coldwater is the one where you sweat. That gradient already exists in the data and costs
nothing to honour.

**Arrest**, if it comes to that, goes through `APPREHEND` → the jail plugin's existing palm-search
minigame (`conceal`, `concealresolve`, `SCAN_DIFFICULTY 6`, the evidence locker). A trucker gets
booked exactly like anyone else. The rig, though, wants the one thing the codebase has never had:
**impound** — a `yard_id` pointing at a police lot with a release fee, which is a two-column
variation on hangar storage and the natural place for that gap to be filled.

---

## The cab, the trailer, and the people on the shoulder

### The cab interior

The windshield's interior is **one hand-authored cockpit with three tiny per-class tables** —
`windowShapeFor(cls, W, H)`, `HULL_SKIN`, `COWL_DEPTH` — and its call sites are already guarded by
`if (!v.windowClass && !ext)`. So a truck cab is a `cls: 'truck'` case in each table plus one
replacement for `drawCanopy` (which is bespoke DA62 glass with no class argument). Everything around
it — the pane clip, hull-skin gradients, rivet seams, bezel, inner-glass darkening and the diagonal
reflection streak — is already parametric on a colour and a rect.

What the cab adds on top: a tall flat two-pane screen with a centre post, an A-pillar each side, a
dash that fills the lower third rather than a glareshield, and `drawInstrumentReflection` reused
verbatim for dash glow on the lower glass (it already slides with bank; it'll slide with lean).

**Mirrors are not optional for this game** — you cannot reverse a trailer without them, and they are
the single strongest visual tell that you are in a truck and not a plane. There is no mirror code, but
`drawAircraftModel` already renders your own vehicle from outside, so a mirror is a clipped re-render
with a flipped camera into a small rounded rect on each pillar. It also solves the trailer: the only
way to *see* your own articulation angle is in the mirror, which makes the mirror a gameplay
instrument rather than decoration.

### The wheel

`helm-wheel.js` is a genuinely reusable, vehicle-agnostic turnable wheel — pointer-capture drag with a
branch-cut unwrap so dragging across the left half doesn't flip, a flywheel free-spin with exponential
damping, procedural carbon-fibre twill, a fixed compass bezel and a rotating rim with a king spoke.
Swap the bezel and wordmark, change `gear`, done.

**One real correction, though.** The helm wheel feeds `onSteer(deg)` as a *relative heading delta* —
deliberately, for a boat, where you set a course. A truck wheel must feed an **absolute steering-axis
position** with a self-centring return, because the road is a thing you hold a line on and the front
axle returns to centre when you let go. That's a change to `step()`'s reporting model (report `angle`
against a centre, not against `reported`), not a rewrite — and it should be a mode flag on the widget
so the yacht keeps its behaviour untouched.

### Semi physics — the one genuinely new system

`flight-model.js` is pure, dependency-free and headless-testable, and it already dispatches a
completely separate vehicle model at the top of `step`: `if (p.heli) return stepHeli(...)`. **That is
the precedent** — `stepTruck` goes alongside `stepHeli`, with a `TYPES` entry supplying the knobs and
`readout()` extended for the new gauges. Semi-implicit Euler, one step per frame, same as everything
else in that file.

There is no articulated or towed physics anywhere in the repo (every "tow" hit is narrative —
`retrieveOffField` is a teleport with a fee). So this is new ground, but it's small and
well-understood:

- **Two bodies, one constraint.** Tractor is a bicycle model — front steer angle `δ`, wheelbase `L`,
  yaw rate `v·tan(δ)/L`. Trailer is a second body whose kingpin is rigidly located behind the tractor's
  rear axle, so the only free variable in the whole system is the **articulation angle `φ`** between
  them. One scalar. Its derivative falls out of the two yaw rates and the hitch offset — about fifteen
  lines.
- **Jackknife is emergent, not coded.** At `|φ|` past ~55° the trailer's lateral force flips sign and
  it folds on its own. You don't write a jackknife state; you write the constraint honestly and it
  happens, harder under trailer brakes and on the gravel shoulder. That's why it feels good.
- **Weight lives on the trailer, not the truck.** Load mass raises trailer yaw inertia (slower to swing,
  worse to recover), lengthens stopping distance, and — the key coupling — **feeds brake temperature on
  a downgrade**, which is already in the phase-2 rig. Heavy is not just slow; heavy is a thing you plan
  descents around. And the same load number is what the scale house reads (below).
- **Reverse is the skill ceiling.** Backing a trailer inverts the steering and is unstable by nature —
  it's the whole reason people play these games, it costs nothing extra once `φ` exists, and it makes
  backing into a bay at the yard a real act instead of a menu.

### The gearbox

An 18-speed is not a detail on the rig — it is the *primary* moment-to-moment input, and it's what
makes a loaded truck feel different from an empty one at every second rather than only at the bottom
of a hill. It also needs a real inversion in the model:

**`rpm` has to change meaning.** In `flight-model.js` today, `s.rpm` is a first-order follower of the
throttle (`s.rpm += (throttle - s.rpm) * min(1, dt/p.engineLag)`) — a normalised 0–1 lag, not an engine
speed. For a truck it must run the other way: **engine speed is derived from road speed × gear ratio ×
final drive**, and throttle produces *torque*, not rpm. That inversion is the gearbox. It's a
contained change inside `stepTruck` (§1 of the step order) and it's what causes everything else:

- **A torque curve with a band.** Peak torque across a narrow rpm window; below it you lug, above it
  you're screaming and burning fuel. `readout()` gains rpm and a gear indicator.
- **Splitter box, not eighteen positions.** Low/high range plus a splitter, so the surface is
  `shift up` / `shift down` / `split` (or `,`/`.` and a modifier), never a menu of eighteen. Skip-shifting
  empty is faster and correct; skip-shifting loaded drops you out of the band.
- **The clutch and stalling.** Pull away in too high a gear and you stall — which on a grade means
  rolling back, which with a trailer behind you means `φ` doing something you did not want. That is one
  mechanic producing three consequences, and none of them are scripted.
- **Grade is the whole game.** Climbing, you downshift *before* you need to, because once you're below
  the band under load you cannot get back into it — the classic truck problem, and it costs nothing
  beyond the torque curve to produce.
- **Engine braking closes the loop with the fail state already in the plan.** A Jake brake / engine
  brake on the descent is what keeps the service brakes off, and the service brakes are what
  overheat. So the downgrade becomes: pick a gear at the top, hold it, and if you got it wrong you're
  riding the brakes and watching the temperature climb. That is the single best minute in a truck sim
  and it falls straight out of the two systems already specified.

Input surface: keys for shift up/down/split/clutch, plus an optional **shifter widget** on the same
pattern as `helm-wheel.js` — its own canvas, its own pointer-drag, an H-gate with the range and split
positions. `cockpit.js` already reads keys into a single `F.input` object and already has drag
widgets (throttle lever, trim wheel, flap detent track), so both paths are established shapes.

This moves gears out of phase 2's laundry list: **the gearbox is phase 1.5** — after the drive proves
itself bobtail, before the trailer. Shifting a bobtail tractor through changing country is already the
game; the trailer is what makes shifting *matter*.

**Hitching** is a verb pair at walking speed: `hitch` when the kingpin is within tolerance of the fifth
wheel and the angle is sane, `unhitch` to drop the trailer on its legs. A dropped trailer is a world
object that persists in the yard or on the shoulder — which means you can bobtail (run the tractor
alone, fast and light), drop a loaded trailer somewhere and come back for it, or find someone else's.
A trailer left on the corridor is exactly as safe as an unattended rig, which is to say it isn't.

### Sound — and why it's really part of the gearbox

**This one is a re-skin, not new engineering.** `client/game/js/panels/engine-audio.js` already runs
exactly the thing a truck needs, for aircraft: `createFlightEngine` / `updateFlightEngine` build **one
persistent Web Audio graph** on `AudioEngine.engineNodes()` — twelve layers (combustion core, a
detuned second core for grit, airframe sub, FM bite, exhaust crackle chopped by a saw LFO, **ground-roll
rumble + rattle**, weather beds, a master tone filter for interior-vs-exterior) with every AudioParam
ridden by `setTargetAtTime` from live sim state a few times a second.

Crucially, **adding a vehicle voice is one row in the `FE_VOICE` table** (`coreB/coreS`, `pulseB/pulseS`,
`pDep`, `bite*`, `sub*`, `lp*`, `crk`, `det`, `mas`). A diesel is a low core, a low pulse rate with high
depth (slow cylinder firing is *why* a diesel sounds like a diesel), heavy crackle, almost no bite.

Three pieces, all of which exist:

- **The engine** — one `FE_VOICE` row, driven by `rpm` and a load term the existing formula already
  computes from throttle-vs-speed.
- **Tyre and road noise** — the `rollGate` branch (LP-filtered noise rumble + a square rattle under
  tremolo) is already written; it just needs ungating from `onGround` and a **road-surface table** on
  the `SURFACES` pattern picking cutoff and rattle level for asphalt / gravel / dirt. Which means the
  shoulder *sounds* different the instant you drift onto it, before any penalty text fires — the road
  edge becomes audible rather than announced.
- **Rain on the cab** — `WEATHER_LOOP` + `applyWeather` verbatim, with the yacht's `muffleFor`
  idea (`yacht-ambience.js` filters its diesel by which room you're in: engine 7000 / deck 5200 /
  cabin 650) giving cab-vs-outside. Roll the window down and the world gets louder.

**And here is why it belongs next to the gearbox rather than in a polish phase: you shift by ear.**
An rpm-driven drone *is* the tachometer. Lugging sounds like lugging, over-revving sounds wrong, and
the moment the band feels like a place you're trying to stay in rather than a number you're watching
is the moment gears become fun. Engine braking on a descent is the same argument — the Jake brake is
one of the most recognisable sounds there is, and it's the audible confirmation you picked the right
gear at the top. Ship the gearbox and its voice together or neither lands.

One-shots go the normal route — `procedural-sfx.js` generators with a seed over the existing
`audio_sfx_proc` wire format (semantics + seed, ~70 bytes, never rendered layers): air-brake release
off the `stream` generator, gear-change clunk and pothole hits off `impact` against a road-surface
material, gravel spray off `scrape`. All of these already jitter themselves through `vary()` so
repeats don't sound machine-stamped.

The honest structural note: if trucking is its own vehicle system rather than an aircraft class, lift
`createFlightEngine`/`updateFlightEngine` into `client/shared/vehicle-engine.js` parameterised by a
voice table, and have both `engine-audio.js` and the cab consume it. The graph is already generic —
only `FE_VOICE` and a few airborne layers (stall buffet, wind ∝ airspeed, flaps) are aircraft-flavoured.
Same extraction discipline as the map-window seam: pull the leaf, leave the hub.

*(Care: `engine-audio.js` documents this at its line 184 — never write `master.gain` every frame or
you stomp the start-up ramp.)*

### Hitchhikers

The riding-along mechanism exists and is already generalised: `plugins/flight/companions.js` pulls an
NPC out of the world, sets `npc._aboard` so the game loop freezes their AI tick, and sets them back
down when the vehicle rests — and it asks **who boards** through a gather hook
(`aircraft.companions`) rather than knowing. Rename that seam `vehicle.companions` and a truck cab
gets passengers for free. The roadside walk-up-and-follow half is `plugins/escort/`'s freeze-and-follow.

A figure on the shoulder, thumb out, seeded per corridor node. `stop`, `pick up <them>`, and they ride
in the sleeper. Some of them are worth money, and the interesting ones are worth something else:

- **A mechanic** who fixes a breakdown you'd otherwise have to walk away from.
- **A local** who knows the detour limb — reveals a spur that cuts distance, or a roadside stop.
- **A robbery.** They wait for a pull-off and go for the cab.
- **A fugitive.** They're carrying, or they *are* wanted — and here is the linkage that makes the whole
  design close: **a hitchhiker is contraband with legs.** The scale house weighs the trailer, but
  `runRawScan` already checks what's on your *person* with no container filter, and a wanted passenger
  is exactly the sort of thing a checkpoint's `checks: [wanted]` was built to find. So picking someone
  up is a decision you make *before* the inspection you know is coming, and letting them out a mile
  short of the scale is a real, unscripted play.

They should be readable but not labelled — clothing, posture, what they're carrying, what they say
when they get in. `player_npc_relations` means the good ones remember you.

### Visual polish that already exists and should be turned up

`drawGlass` is the standout, and it is *more* correct for a truck than for a plane:

- **Rain beads already blend between gravity and slipstream by `speed²`.** A stopped truck gets
  straight-down runs; a rolling one gets swept streaks. Zero code change, and it will read
  instantly.
- **Bug splats** accrete with speed and wash off in rain, with smear tails that lengthen as you go
  faster. This is a truck feature that happens to have been written for a plane.
- Frost creeping in from the corners, procedural lightning bolts with a sheet-glow for off-screen
  strikes, `drawLandingBeam` (a headlight cone in all but name), `drawGodRays`, `drawLensFlare`,
  `drawHeatShimmer`, `drawCityBloom` for the arrival, and desert billboards — tumbleweed, cactus,
  mesa, hoodoo — that are already road-trip scenery.
- `drawWeather` samples a *local* weather field and draws precipitation in-scene behind buildings, so
  driving into a cell is already a thing that happens.

**The one gap is wipers**, and it's small: the drop state is already a list of `{x,y,r,life,streak}`,
so a swept sector that culls drops inside it, on a stalk with intermittent/low/high, is a contained
addition to `drawGlass`. It is also the single most evocative thing on this list.

---

## What it reuses vs. what is new

| Reused as-is | New |
| --- | --- |
| `paintWindshield`, `makeCam`, Mode-7 floor, `drawGroundSurfaces` road art | `corridorFor` / `corridorAt` — the seeded highway |
| `mapWindow` (+ one provider parameter) | `plugins/trucking/` — rig state, `drive`, reconcile |
| `helm-view.js` / `helm-mode.js` as the cab-console template | `cab-view.js` / `cab-mode.js` |
| `flightsync` → `reconcile` clamp-don't-resim pattern | `trucksync` (odometer is the clamped value) |
| Fuel / refuel / rental economy from `state.js` + `cmdRefuel` | gears, brake temp, weight handling |
| `plugins/flight/contracts.js` freight economy | payout scaled by cargo condition |
| Everything in `plugins/voidwalking/` | corridor ↔ node mapping only |
| `hangars.js` yard/rent/store/steal model, `boardFound()` retarget | the **weigh station** (weight-discrepancy detection) |
| `plugins/checkpoint/` `flags.checkpoint_cfg` gate | `customs open` (submit + eat the seizure) |
| `runRawScan`, `APPREHEND` → jail palm-search, evidence locker | **impound** — a police lot with a release fee |
| `helm-wheel.js` turnable wheel widget | absolute self-centring steer mode on that widget |
| `flight-model.js` purity + its `if (p.heli)` model dispatch | **`stepTruck`** — bicycle tractor + one articulation angle `φ` |
| `windowShapeFor` / `HULL_SKIN` / `COWL_DEPTH` class tables | a truck-cab canopy, a dash, and **mirrors** |
| `drawGlass` rain beads, bug splats, frost, lightning | **wipers** (cull drops inside a swept sector) |
| `companions.js` `aircraft.companions` gather hook + `escort/` follow | hitchhiker roster, `hitch`/`unhitch`, dropped trailers |
| `createFlightEngine` 12-layer persistent graph, `rollGate`, `WEATHER_LOOP` | a diesel `FE_VOICE` row + a **road-surface** sound table |
| `audio_sfx_proc` semantics+seed wire, `impact`/`scrape`/`stream` generators | torque curve, splitter box, clutch/stall, engine braking |

---

## Phasing

**Phase 1 — the one that has to land.** One route, Coldwater → The Reach. Straight corridor, road
ribbon plus seeded roadside scatter. The truck-cab canopy and the wheel widget in absolute mode.
`stepTruck` **bobtail only — no trailer.** Fuel burn with one stop. Node crossings fire the existing
encounters as full stops. Arrive and dismount. **No contracts, no cargo, no gears, no articulation.**
If a twenty-minute drive through changing country toward a city coming out of the haze isn't fun on
its own, no freight economy fixes it — ship this and find out first.

**Phase 1.5 — the gearbox and its voice, shipped together.** `rpm` inverted to derive from road speed
× gear ratio, a torque curve with a band, splitter box, clutch and stalling, engine braking. The
diesel `FE_VOICE` row, the road-surface sound table, tyre noise ungated from `onGround`. You shift by
ear, so neither half lands alone. Still bobtail.

**Phase 2 — the rig.** The articulation angle `φ`, `hitch`/`unhitch`, dropped trailers as world
objects, mirrors (which the trailer *requires*), reverse. Brake temperature — which is where the
gearbox pays off, since holding a gear down a grade is what keeps the service brakes cool. Load mass
on trailer inertia and stopping distance, off-road penalty, breakdowns, cargo condition. Wipers, rain
on the cab. The yard (office + apron, rent, store-vs-stealable), `board`/`load`/`depart`/`pulloff`,
arrival parking and backing into a bay. Wire `contracts.js` so hauls are real freight — which is what
makes weight mean something, which is what the scale house needs.

**Phase 3 — the law and the road.** The Coldwater checkpoint flag, the weigh station and its
discrepancy roll, `customs bribe|bolt|open`, impound. Hitchhikers, including the fugitive who turns a
scale house into a decision. Then the Exodus limb, the fork drawn as a real junction, detour spurs,
weather over the corridor, CB flavour, wrecks from real deaths.

**Phase 4 — city driving.** Real-tile driving inside regions and actual building collision off
`shapeFootprint`. Only if 1–3 earn it.

---

## Critical files

- `plugins/flight/state.js` — `mapWindow` (738), `curtainRun` (725), `reconcile` (1117), `surfaceAt` (251)
- `plugins/flight/snapshot.js` — `deriveCell`, the duplicate to collapse
- `plugins/voidwalking/index.js` — `VOIDS` (63), `mkRoom` (217), `ensureInstance` (337), the export block (930)
- `client/game/js/panels/windshield.js` — `paintWindshield` (458), `RENDER_TUNE`, `drawGroundSurfaces`
- `client/game/js/panels/helm-view.js` — the non-flying-vehicle client template
- `client/game/js/panels/helm-wheel.js` — `createHelmWheel`, needs an absolute self-centring mode
- `client/game/js/panels/flight-model.js` — `step` (503), the `if (p.heli)` dispatch (343), `TYPES` (49), `readout` (808)
- `client/game/js/panels/windshield.js` — also `drawGlass` (1555), `windowShapeFor` (1202), `HULL_SKIN` (1223), `COWL_DEPTH` (1318), `drawCanopy` (1288), `drawAircraftModel` (4272, the mirror re-render)
- `plugins/flight/companions.js` — the `aircraft.companions` gather hook to generalise; `plugins/escort/index.js` for follow
- `client/game/js/panels/engine-audio.js` — `createFlightEngine` (56), `updateFlightEngine` (138), `FE_VOICE` (46), `WEATHER_LOOP` (248); the note at line 184 about `master.gain`
- `client/game/js/panels/yacht-ambience.js` — `engBuild`, `muffleFor` (the cab-vs-outside filter model)
- `client/shared/procedural-sfx.js` + `client/shared/audio-engine.js` — `buildLayer`, `engineNodes`, `loopSound`/`setLoopGain`
- `plugins/checkpoint/`, `plugins/smuggle/` (`runRawScan`), `plugins/jail/index.js` (palm-search), `plugins/flight/hangars.js`
- New: `plugins/trucking/` (corridor.js, state.js, index.js, regress.js) and `client/game/js/panels/cab-view.js`

## Verification (phase 1)

- `npm run shapes:smoke` after any windshield change; `npm run test:regress` for the plugin + manifest sweep.
- A `plugins/trucking/regress.js` that pins a forced weekly window and asserts `corridorAt` is stable
  and that a full odometer sweep crosses every node exactly once.
- `stepTruck` is headless-testable for free — `flight-model.js` is pure and already stepped without a
  DOM in tests, so the articulation angle gets a direct unit test (steady-state `φ` in a constant-radius
  turn, and jackknife divergence past the limit) with no browser.
- Drive the route in `npm run dev` end to end: leave Coldwater, hit an encounter, refuel, arrive.
