# Flight System — As Built

> This is the running source for flight *as actually built*. Blueprints:
> [proposals/systems-flight.md](proposals/systems-flight.md) (the locked design),
> [proposals/flight-overhaul.md](proposals/flight-overhaul.md) (the continuous
> client-sim/server-reconcile model), [proposals/flight-unified-model.md](proposals/flight-unified-model.md)
> (collapsing onto that one model), [proposals/systems-flight-pvp.md](proposals/systems-flight-pvp.md).
>
> Author-direction reference docs (the vision the continuous overhaul reconciles):
> [Flight](reference/Flight_Implementation.md) · [Rendering](reference/Rendering_Implementation.md) ·
> [Sound](reference/Sound_Implementation.md) · [Weather](reference/Weather_Implementation.md).

## Plugin layout (multi-file)

`plugins/flight/` is composed of a wiring hub + shared state + one module per system:
- **state.js** — the shared substrate: the live-aircraft registry (the aircraft
  owns its occupant set), the computed-overlay coord index (`surfaceAt`), the
  synthesized HUD payload, `effStats` (tune + weight-&-balance → effective numbers),
  `reconcile` (client telemetry → authoritative state), `CONTINUOUS_TYPES`, and the
  `parkAt` / `crash` transitions. Every module imports this.
- **index.js** — the verbs + the `flightsync`/`flightevent` seam + the airborne tick
  loop + move gate + cardinal input matcher + no-fly.
- **hazards.js** — hazards + emergency/utility verbs.
- **combat.js** — AA fire, the armed gun pass, and the air-to-air PvP damage path.
- **contracts.js** — the freight economy.
- **hangars.js** — ownership: hangars, repair, salvage, rebuild, tuning.
- **acquisition.js** — buy / rent / refuel.
- **charter.js** — NPC-piloted charter flights (see §Charter below).
- **checkride.js** — the guided-checkride tutorial (`checkride`).
- **biomes.js** — overflight biomes.
- **collateral.js** — ground collateral (crash/strike effects).
- **livery.js** — aircraft liveries.
- **snapshot.js** — flight-world snapshot/export helpers.

## Airfields (live)

Flagged onto fitting zones (the `zones.flags.airfield_id` pattern):

| Field | `airfield_id` | Ramp zone (x,y) | Services |
|---|---|---|---|
| Threshold Helipad | `af_helipad` | `zone_district_893_909` (893,909) | charter + rental · avgas/jet · **VTOL-only** |
| **Coldwater Regional** | `af_regional` | `zone_district_925_903` (925,903) | **dealer + charter + rental** · all fuels |
| The Echelon — Helipad | `echelon_helipad` | `zone_echelon_exterior` (897,898) | charter only · VTOL-only |
| Buzzard Field | `buzzard_field` | `zone_the_reach_870_1958` (910,986) | charter only · **lawless** · dust strip |
| **Solenne Sky Pad** | `af_solenne` | `zone_district_914_908` (914,908) | **private** — residents only · avgas/jet · **VTOL-only** |

**Private fields.** `flags.airfield_residents_only: "<building name>"` makes a field the
building's own: `fieldFor()` returns null for anyone who doesn't hold a unit there, so an
outsider gets no bay, no `hangar rent`/`store`, no fuel and no services — the field simply
isn't there for them. The pad ROOM is walled separately by `flags.residents_only`
(the residency plugin), which also gates the lift. See
[reference/world-rendering.md](reference/world-rendering.md) for how a rooftop pad renders
as field *and* building on one tile.

Nine aircraft types (Mayfly · Dragonfly · Mule · Leviathan · Reaper · Carcass ·
Grasshopper · Locust · **Viper**), three fuel types (avgas/jet/biofuel), four ground AA
sites (Redline SAM / wastes autocannon / Slagworks flak / Clone Vats guardian), a Core
no-fly cluster, and one downed Carcass to salvage/rebuild. All of it is CODEX content
(`content/aircraft_types/`, `content/aa_sites/`, `content/zones/`), not a seed script.

## Architecture (the load-bearing decisions)

### The aircraft is a first-class object that owns its occupants
There is **no runtime-created cabin `zones` row** — runtime zone creation would break
the "content is deliberate" rule. Instead:
- `aircraft` table = per-craft runtime state (position, fuel, throttle, band,
  heading, damage, airborne/engine flags, wreck flag). Schema exported, rows
  production-owned (like `generators`/`atm_units`).
- `aircraft_types` table = per-template **content** (Dragonfly, …): tank, burn,
  speed, ceiling, seats, hull, handling, noise, prices. CODEX content
  (`content/aircraft_types/`), dev-panel editable.
- "Being aboard" is **player state**: `player.aircraftId` + `player.seat`
  (`pilot` | `passenger`). The plugin keeps an in-memory `liveAircraft` registry
  where each craft owns an `occupants` Set (mirrors live-zone membership).
- The cockpit the player sees is **synthesized** from the live aircraft object (the
  `flight_sim` open + `flight_ctx` per-tick push; passengers get `cockpit_update`) —
  not rendered from a zone.
- **Exception — walkable cabins** (`state.WALKABLE_CABINS`, today just the Leviathan,
  state.js:1077): the interior is *authored* content (`content/zones/zone_leviathan_*`,
  `map_aircraft_leviathan`, matched by `flags.aircraft_cabin`) that occupants walk on
  foot instead of riding the cabin-window HUD. Every instance of the type shares the
  one authored shell — privacy comes from the occupant Set, so still no runtime rows.
  See [proposals/leviathan-flying-base.md](proposals/leviathan-flying-base.md).
- **Text-only passenger travel** (`textmode.js`): a passenger who has set Flight Display to
  *Text only* (Tablet → Vehicles; persisted as the `flight_text_only` player flag) is sent
  **no client panel at all** — not the HUD, not the cabin audio feed — and rides on narrated
  flight instead, on its own 45s schedule (the 3s physics tick is far too fast for prose).
  The preference is read ONCE at board time and latched as `player.textTravel`, because
  `pushHud` is sync and on the tick path; it is cleared by `detach`. `window` still works
  mid-flight and outranks it (`cabinWindowOpen`), so the mode is a default, not a lockout.
  **Passengers only** — a pilot has no server-side flight to narrate (the sim IS the model),
  so a text-mode pilot is a separate system, not this flag. A walkable cabin deliberately
  does not latch it: those rooms are already graphics-free and latching would only cost
  the occupant their engine audio.
- **Text-native PILOTING** (`textpilot.js`) — the same preference, applied to the pilot's
  seat. Instead of `sendFlightSim`, the server runs the physics itself and the player
  flies by command. What makes this affordable is that `flight-model.js` is a **pure,
  DOM-free module** already stepped headless by this suite and by `scripts/*-tune.mjs`:
  the identical physics the 3D client runs, run server-side. The tick is its own `1s`
  sweep over `liveAircraft` (NOT the `registerActivity` posture sweep — posture only
  becomes `flying` at wheels-up, and a text pilot must be simulated through startup,
  taxi and the takeoff roll), sub-stepped 10× so the model sees the small `dt` it was
  tuned at. World position is integrated from heading × speed at the **charter
  autopilot's** tile pace (`CRUISE_TILES`), the existing server-side answer for how
  fast an aircraft crosses the map.
  - **ASSISTED, not raw.** The player sets intent — `climb to 3000`, `turn to heading
    090`, `throttle 70`, `level`, `flaps`, `gear`, `takeoff`, `land`, `status` — and a
    proportional autopilot flies the surfaces toward it. Exposing `elevator 0.3` would
    punish a text pilot for a control scheme the model was never tuned for. **Stall
    recovery outranks every commanded target**, because a text pilot has no stick to
    catch a departure with.
  - **It writes the same `live.cont` contract `reconcile` does**, which is the whole
    reason hazards, air-to-air contacts, AA and missiles work unchanged — none of them
    can tell a text-flown craft from a client-flown one. None of reconcile's anti-spoof
    clamping applies here (the server generated the numbers), so `reconcile` itself is
    untouched and the 60fps path is unaffected.
  - **Takeoff and landing reuse `cmdFlightEvent`**, injected via `wireTextPilot` to
    avoid an import cycle — so parking, cargo delivery, checkride grading, landing IP
    and detaching everyone are shared, not reimplemented. The landing grade comes from
    `landingGrade(fpm)`, the cockpit report card's curve ported server-side.
  - **The checkride is flyable entirely in text**: `checkGateProximity` tests the ring
    course server-side (the `GATES` list already carried `r`/`altTol`; only the 3D
    client ever tested them), and `startup` fires the `engineon` stage advance the
    cockpit's switch used to.
  - **The live panel** is a `text_cockpit` payload pushed once a tick and drawn by
    `client/game/js/panels/textcockpit.js` in the same top pane as the room description
    — box-drawing rules, a sliding compass tape, `█░` bars, an ASCII attitude ladder and
    a character-glyph minimap. **No canvas anywhere in that path.** Most of its content
    is lifted from `contextPayload`, the same payload feeding the 3D cockpit: one source
    of truth, two renderers. `cockpit_close` hands the pane back.
  - **Known gaps (v1):** air-to-air GUNS (`cmdAirFire` needs the client reticle's
    `aimQuality`) and lock-dwell timing remain 3D-only. AA and missiles are fully
    available, being server-authoritative dice already. RWR lock/launch warnings reach a
    text pilot as text rather than as an instrument strip.

### The sky is a computed overlay
An airborne craft carries its own `(grid_x, grid_y, altitude, heading)`.
Flying advances `x/y`; the "view below" is read from the `map_world` zone at that
coord via a cached coord index (`surfaceAt(x,y)`); **empty cells = open air**
(fly-over, no obstacle). Zero content cost, stays correct as the map grows.

### One model: continuous client sim, server-reconciled
**There is no banded/server-side flight model any more.** Every seeded airframe is
in `state.CONTINUOUS_TYPES` (state.js:93), and `flightTick` treats a craft outside
that set as a content error (index.js:1363). The live model is the 60 fps client
energy integrator [`client/game/js/panels/flight-model.js`](../client/game/js/panels/flight-model.js);
the server owns the consequences:
- The client streams packed telemetry via **`flightsync`** (`gx gy alt ias hdg thr vs
  onGround stalled [bank pitch]`) and reports discrete transitions (wheels-up,
  touchdown, crash, `engineon`) via **`flightevent`**.
- `state.reconcile` (state.js:928) clamps that into `live.cont` + `live.row`, applies
  a **damage-aware envelope** (a craft that's shed a wing can hold height or lose it,
  never climb) and a lenient anti-spoof stall read (`stalledState`). `altitude_band`
  survives only as a derived compat field (`bandFromAltitude`).
- `flightTick` (`TICK_MS = 3000`) owns fuel burn, hazards, engine noise, contracts and
  persistence, and pushes the world context (`flight_ctx`) back each tick.
- `posture === 'flying'` on the pilot is the activity flag (inherits engine
  force-stand interruptions for free).

### The wing: angle of attack, stalls, sink rates (2026-07-28)
The aerodynamics in `flight-model.js` are an **arcade energy model**, not 6-DOF — but the
wing itself now runs on the one variable a wing actually runs on. `s.aoa = pitch − γ` (§6)
is a definition, not an estimate, and it is the single input to lift, drag, the stall, the
buffet and the g-meter. Before this pass the model carried *two* unreconciled angles of
attack — one for drag, a separately-solved `aoaTrim` for lift — and neither was the stall
trigger; the stall fired on `airspeed < stallSpeed`, which is why `aoaCrit` existed on every
airframe while doing nothing but anchoring `weightOf()`.

What that buys, and what it means when you're tuning:

- **The stall is an AoA event.** `s.aoa > p.aoaCrit`, full stop (§6b). `STALL_ARM` (0.12 s)
  only rejects single-frame spikes; recovery is `REATTACH` (3.5°) of genuine hysteresis,
  which is what the old 1.9 s `STALL_HOLD` grace was standing in for. **The stall speed is
  now an OUTPUT** — every airframe measures within 4% of its authored `vs0`, emergently.
- **Accelerated stalls exist.** A hard pull outruns the flight path (γ chases the nose over
  `vsTau`), α spikes, and she departs at a perfectly healthy speed. The old speed trigger made
  this literally impossible. Measured breaks match the textbook √n rule against the derived g.
- **Load factor is real** (§6a) — the bank's own demand plus the α the pilot is pulling above
  trim. A level 60° bank reads 2g on its own. Exceeding a type's `gLimit` fires an `overg`
  event: the airframe groans (`creak('stress')`) and the master lamp calls it.
- **The post-stall sink is a consequence, not a script.** A developed stall collapses CL by
  `CL_COLLAPSE`, and `MUSH_DEG` (§7) droops the flight path in proportion to the resulting lift
  deficit — so the sink scales with speed, weight, bank and flap instead of being clamped to a
  fixed multiple of `vsMax`. The same term un-caps the ordinary low-speed mush, which used to
  saturate (and stop deepening) the moment `aoaTrim` hit `aoaCrit`.
- **Rudder recovers a spin; aileron makes it worse.** The departure yaw scales with stall depth
  and the pedal is given authority against it. The old wing-over marched heading at a flat
  42°/s while the rudder was worth 4–18°/s, so the actual recovery input could not work.
  Aileron authority drops with stall depth (§4), and fighting the drop deepens it (§6c).
- **Every airframe has a real drag polar.** Induced drag is `kInd·CL²` for all of them,
  replacing both the old `aoa²·V` fudge (wrong exponent on V) and the Leviathan-only,
  rpm-gated `glideDrag` patch. `kInd` is **derived from the authored `ldMax`**, and
  `p.bestGlide` is now a *measured consequence* of the polar rather than a number typed
  beside it — which is why best glide sits at a realistic 1.4–1.6 × Vs across the fleet.
  Adding induced drag cost everyone 3–5% of top speed, so each type's `dragP` was re-solved
  to put its authored level top speed back exactly; the envelope is unchanged.
- **Buffet.** `s.buffet` ramps over `BUFFET_BAND` before the break and sustains a shake in the
  cockpit — the warning you feel before the horn. There was previously nothing at all between
  "flying fine" and "a wing dropped".

**Harnesses** (headless, no DB or browser): [`scripts/stall-tune.mjs`](../scripts/stall-tune.mjs)
measures the 1g and accelerated breaks, max g, the held-departure sink, the hands-off recovery
and the rudder's anti-spin authority per airframe, plus level-top/climb/takeoff as regression
guards. [`scripts/glide-polar.mjs`](../scripts/glide-polar.mjs) measures the polar;
[`scripts/dive-tune.mjs`](../scripts/dive-tune.mjs) the dive shed. The old `glide-tune.mjs`
was deleted — it solved for `glideDrag`, a knob the model no longer reads. The model's own
behaviour is now covered in `plugins/flight/regress.js` (it had none before).

Takeoff and landing are therefore **flown from the cockpit, not commanded**: `takeoff`
and `land` return a nudge ("throttle up … ease back on the yoke") for a continuous
craft (index.js:688). A botched landing does hull damage; enough damage → crash. A
crash kills everyone aboard (`handlePlayerDeath`) and turns the craft into a wreck at
the surface cell. Landing grade → piloting IP (`LANDING_IP`, ≥5 min airborne).


## Player-facing surface

**Verbs** — the manifest [`plugins/flight/plugin.json`](../plugins/flight/plugin.json)
is the authoritative list (~80 verbs across boarding, autopilot/nav, hazards, combat,
contracts, hangar/ownership, charter). Bare compass verbs set heading **only while
airborne** (input matcher; falls through to the ground mover otherwise).

**Piloting skill** (`server/engine/skills.js`, tech, Reflexes+Brains): every
startup/takeoff/landing/climb runs `skillCheck`/`awardSkillUse`.

**Move gate** (`flight`): you can't walk while aboard an aircraft (airborne or
parked) — `disembark` first.

**Client** (`client/game/js/panels/cockpit.js`) — the cockpit is opened by the
`flight_sim` push on `board` and is the *whole* flight interface (engine switch,
throttle, yoke, pedals, flap detent lever, trim):
- **Windshield / out-the-front-window view** (`client/game/js/panels/windshield.js`,
  `paintWindshield(id, view)`): a **canvas** forward scene — a time-of-day sky
  (palette blended from the in-game `hour`; stars, sun/moon, parallax clouds), a
  perspective **ground plane** that scrolls with your speed, the **zones/obstacles
  ahead** projected off the server `map` window (buildings for land, green pads for
  fields, red hazard columns for no-fly airspace), a **runway/landing-pad whose size
  reflects height above ground**, plus rich **weather FX** — rain/storm/snow/ash
  particles, **water droplets clinging to the canopy glass**, **storm lightning
  (full-frame flash + a jagged bolt)**, a dense low **fog bank**, and a top-right
  **WX badge** (weather + wind) — speed streaks, and a static canopy frame + glass
  sheen. Under it all rides an **ambient weather audio bed** (`engine-audio.js`: a
  per-weather loop — rain/storm/snow/ash/fog — layered *beneath* the engine drone,
  gain scaled by wind, with the odd thunderclap in a storm). The same renderer feeds
  the pilot's canopy band, the passenger cabin window, and the Helm chase cam.
  Time-of-day + weather ride in a `sky:{hour,weather,wind}` field on the gauge
  payload (`state.js`, from `getEnvironmentState()`).
- **PFD** (`paintPFD`, cockpit.js:4186): a canvas primary flight display — banking/
  pitching attitude ball with a ±30° pitch ladder, **airspeed and altitude tapes**
  flanking it (airspeed marked with Vr/Vne/Vs0), a VSI bar, a digital heading box, a
  slip/skid ball, and a fuel percentage. **MFD** (`paintMFD`) is the moving map off
  the server's `map` window. **`paintGauges`** draws the engine cluster (one dial per
  `aircraft_types.engines`), the annunciator strip, gear/flap/stores state and the
  stall lamp. Passengers get the cabin-window layout (windshield above a
  dest/alt/spd/hdg strip — no controls) — unless they've opted into text-only travel,
  who get no panel at all (see the walkable-cabin/text-mode bullets above).
- **SFX:** a `flight` group in `client/shared/sfx-catalog.js` (engine start, roll,
  rotate, abort, warble, approach, flare, touchdown, crash) — dev-panel editable.

Routed in `dispatch.js`: `flight_sim` (open) · `flight_ctx` (per-tick world context) ·
`flight_contacts` · `flight_aasites` · `flight_kill` · `flight_target` ·
`cockpit_update`/`cockpit_close` (passenger/cabin HUD). UTF-8 box glyphs preserved.

## Cockpit controls & damage cinematics

### On-screen rudder pedals
A pair of hold-to-yaw foot plates at the base of the cockpit view, flanking the
stick — press-and-hold (touch **or** mouse) the left plate for left rudder, right
for right, exactly equivalent to the `,`/`.` (X/C) keys and the **only** rudder
input on touch devices. Each plate animates from the **live** pedal deflection
every frame (keyboard use drives the same animation) and springs back on release.
In `cockpit.js`: `PEDALS_HTML` (`.fsim-pedals` / `#fsim-pedal-l|r`),
`wirePedal(el, dir)` (pointer wiring with `setPointerCapture` so a thumb sliding
off still releases; sets `F.pedalKey`), and the `fsimFrame` loop (drives the tilt
via CSS var `--d`, toggles `.act` past ±0.04). Physics: `flight-model.js` `step`
feeds `pedal * rudderYaw * auth` into the heading integrator; a sheared rudder
zeroes pedal authority.

### Crash break-up death-cam
A severe write-off — **CFIT** (into a building), **ditch** (into water), or a
**>800 fpm hard landing** — snaps to the external chase cam and cartwheels the
wreck while a **wing + tailplane + fin shear off and tumble away** over 3.4 s
(`BREAKUP_MS`, cockpit.js:3269), *then* shows the CRASHED card and reports to the server. The
player always sees her come apart. In `cockpit.js`: `beginCrashBreakup(F, reason)`
(freezes physics, forces `F.setExternalView(true)`, snapshots attitude),
`stepCrashBreakup(F, now)` (cartwheel + three shed `parts`, then
`sendCmdSilent('flightevent crash <reason>')`), and an `if (F.crashCine)`
early-out in `fsimFrame`. Render side (`windshield.js`): `drawAircraftModel` takes
a `breakup` descriptor; `shedPartFor(breakup, face)` + `shedVert(v, part)` spin
and drift the shed faces.

### Live sheared-surface asymmetric flight (`917f1ec8`)
A structural hit in air combat now **shears an actual surface** (left/right wing,
tailplane, or rudder), not just hull %. You get a `💥 STRUCTURAL FAILURE` toast, a
hard panel shake, and the aircraft **flies wounded**: a missing wing loses ~half
its lift and rolls + yaws toward the dead side (fight opposite aileron to limp
home); both wings = a brick; a sheared tailplane makes the elevator mushy and
tucks the nose; a sheared rudder kills pedal yaw. The missing piece renders
**gone** (a settled break-up, distinct from the tumbling crash) on your own model
**and** on enemy bogeys. Server is authoritative (`custom_data.surfaces`); the
client reads new `msg.sheared` / `msg.surfaces` fields. In `flight-model.js` `step`:
`input.dmgSurf = {leftWing,rightWing,tail,rudder}`, tunables `WING_ROLL`/`WING_YAW`,
`wingLiftMult`. In `windshield.js`: `surfaceBreakup(surfaces)` converts a sheared
map to a `{t:1, parts}` spec (shared by own-ship, bogeys, **and the Helm chase
cam** — see [systems-helm.md](systems-helm.md)).

### Chase-camera tunables (windshield.js)
`szFac` clamps to `[0.46, 1.15]` (line 491) so heli-class craft aren't cropped tight
at rest; `extZoom` clamps to `[0.15, 2.4]` (line 492 — the floor is what lets the
Echelon deck-cam push in); near top-down the camera pulls proportionally farther out
(`orbRcam = orbR * (1 + topFrac*1.4)`, line 513) so buildings directly below stop
streaking.

## Hazards, airfield flags, contracts & combat

**Hazards** (`hazards.js`). The tick loop calls
`rollHazards()`: **STALL** (high + slow → buffet → stall → spin → crash, cleared by
`recover` after powering up) and **ENGINE FIRE** (overheat → fire, cleared by
`extinguish`/`cut fuel`) are persistent escalating ladders; **WEATHER buffeting**
(hooked to `getZoneSeverity`, amplified by altitude) and **BIRD STRIKE** (low/slow)
are one-shot per-tick events. Utility verbs: `preflight`, `hover` (VTOL), `spot`
(aerial spotting → wrecks/AA on the ground), `chart` (dead-reckoning + nearest
field + fuel range), `squawk` (transponder; running dark evades cameras but is a
crime), and `eject`/`bail` (parachute-gated — a pilot bailing dooms the craft).

**Airfield desks are three independent flags.** `airfield_dealer` sells airframes,
`airfield_rental` opens the self-fly rental desk (`rent`), `airfield_charter` books
an NPC-piloted ride (needs a `charter_pilot` NPC assigned to the field). Any
combination is legal — Buzzard Field and the Echelon pad both charter without
renting. The legacy `charter_vtol_only` flag is folded into `airfield_vtol_only` by
`state.vtolOnlyField`.

**Ground stop** (`index.groundStop`, threshold `GROUND_STOP_SEVERITY = 0.7`). Weather
buffeting is the *in-air* half; this is the other half — past 0.7 severity the
departure field simply doesn't launch. It's checked on the `engineon` flight event
(the panel ENGINE switch) — deliberately *not* the wheels-up event, since refusing
mid-takeoff-roll would be worse than useless — and in the retired banded `cmdTakeoff`
preconditions. An airborne craft has no
`parked_zone_id`, so it can never be caught by it; only departures are blocked.

This is the only weather rule in the game that **blocks** a player action rather than
taxing it (contrast `WIND_MOVE_SEVERITY` in `movement.js`, which only drains stamina).
That's deliberate: above the threshold the alternative isn't a harder flight, it's a
scripted crash. **The Reach feels it hardest by design** — it leans on the sky (the
overland way in is a punishing scrub gauntlet), so a blown field means almost nobody
arrives, almost nobody leaves, and everyone already there is in the bar.

**No-fly enforcement** (`index.checkAirspace`). Over an `airspace_restricted` cell:
tower warning → `WANTED_RAISE` (+2) + interceptor scramble message. No-fly cells
render as a red hatch on the moving-map.

**Contracts** (`contracts.js`). Job archetypes are **DB content, not code**: `quests`
rows with `quest_type='flight_template'`, devpanel/VINE-editable (`contracts.js:42`).
`topUp()` lazily tops a field's board up to ~4 concrete `quest_type='flight'` instances
rolled from those templates — a spread of legal and illegal work, each with its own
flavour, load, deadline and pay:
- **Legal:** Freight · Priority Courier (tight deadline premium) · Cold-Chain Meds ·
  Passenger/VIP Charter · Medevac (urgent) · Relief Run (dangerous but honest) · Survey Drop.
- **Illegal** (contraband → **run dark**, +heavy pay, higher risk): Smuggling ·
  Gun-Running · Chop-Shop Parts · Disposal · Toxic Dump · Exfil (hot) · Data Mule.

Illegal jobs only appear at **lawless fields** (`airfield_lawless` — today only
Buzzard Field) and prefer a lawless drop; every other field carries legal work
only. `accept` loads the weight onto the craft (fed
through `effStats` → takeoff difficulty + fuel burn + overweight gate); `manifest`
tracks active jobs; delivery is detected on landing at the destination (on-time =
full, late = half; contraband pays in "unmarked cash"). Payout = distance × weight
(or passenger rate) × risk × the job's `payMult`. The board tags each job
LEGAL/ILLEGAL and shows the deadline.

### Raw-drug dead drops — the air smuggling run *(as built)*

The top of the raw-supply chain, above the smuggle plugin's ground MULE crates.
It never touches a checkpoint because it never touches the city ground at all.
All of it lives in `contracts.js`.

**Nothing spawns unbidden.** Every pallet out on the hardpan is one the player
**ordered and paid for** at Amos's counter. There is no rotating free pool (there
was, briefly) and no top-up on embark — `ensureFenceDrops` is gone; an ordered
pallet is inserted once, at order time.

- **Three caches, not an airfield.** `FENCE_CACHES` names three tiles out on the
  Reach hardpan — the **Bonepile** (NW), the **Sump** (SE), the **Sisters** (SW) —
  each themed content with its own fixture. Siting them out in the waste is what
  makes the aircraft matter, because `index.js`'s land handler parks a
  **rough-field-rated** craft (VTOL/STOL) where it flares but **tows a fixed-wing
  back to the nearest field**. So the Mule (STOL, 180kg hold) can service a cache
  and the 600kg Leviathan can't — it's `takeoff_mode: strip` with nowhere out
  there to put down. **No new capability check was written for any of that**; it
  falls out of the existing landing physics and the existing `loadcargo` weight
  math. Don't add one.
- **Both ends of the ground trade must vouch** (`hasCacheStanding`): the covert
  dealer's `dealer_inner_circle` **and** `bm_trust ≥ CACHE_TRUST_MIN` (10) earned
  running the fence's crates through a gate. Enforced in the `UNLOCK_AIR_CARGO`
  action *as well as* in Amos's dialogue conditions — the action must never be the
  only thing holding the door, or a hand-authored option hands out the caches.

#### The ladder — legal crop at the bottom

This is the load-bearing idea, and it is a **risk** ladder as much as a price one.
Every `item_raw_*` is tagged `contraband` + `raw_drug`, and carrying one in view of
a camera is **"Manufacturing a controlled substance" — four stars**. So the entry
rung cannot be a precursor. It's baled **tobacco** and **cannabis** leaf
(`item_raw_tobacco_crop` / `item_raw_cannabis_crop`), tagged `crop` and nothing
else, which trips neither the manufacturing scan nor customs. Each **cures** into
the existing `item_loose_*` via a **fabrication** recipe — deliberately not a
chemistry cook, so it lives under `craft`, never appears on the felony `cook`
surface, and survives `add-raw-supply.js` wiping the chemistry recipe set.

Graduating from tier 0 to tier 1 is therefore the moment the player accepts felony
risk for the first time. That alignment is the whole point.

- `TIER_TRUST` gates each rung **on top of** the unlock (tier 0 is +0 — nobody has
  to trust you with a bale of tobacco). `PALLET_UNITS` trades volume for grade, so
  a pallet costs roughly a pallet's worth of money at any tier: **what standing
  buys is access to grade, not a bigger load**, and the payoff is on the far side
  in what the raw cooks into. Don't "fix" the flat price curve.
- Both halves are **content**. A new crop is an item tagged `crop`; a new precursor
  is an item tagged `raw_drug` with a `cook_tier`. Neither needs a code change.

#### Ordering — the counter is a vendor shelf

**The ledger IS the shop panel.** Amos carries `flags.trust_flag: 'bm_trust'` and a
`min_trust` on every `vendor_inventory` entry, so `getVendorStock` (`vendor.js:140`)
switches off the random `vendor_stock` shelf and serves the whole catalogue filtered
per player — **a sealed rung simply isn't on the shelf.** That's the ladder rendered
by the ordinary GUI panel with no client work at all. Quantity on the panel is the
pallet count; entry `price` is priced **per pallet**
(`value × ORDER_MARKUP(1.4) × units`). Sully charges ×2 because he runs a MULE for
you; here you fly it yourself. His `raws_list` dialogue node fires `OPEN_SHOP`.

- **`trust_per_buy` is 0 on the counter, deliberately.** Standing is earned by
  FLYING pallets home (`deliverFenceDrop`), never by paying for them. Leave it at
  the engine default and a rich player buys their way up the ladder without ever
  running the customs risk, which guts the progression.
- **A pallet must never land in a pocket**, so the counter claims the engine's
  **purchase-delivery seam** (`registerPurchaseDelivery`, `vendor.js`) — keyed on the
  **`raws_counter` NPC flag**, not on the goods, because Sully's fence sells the same
  raws through the same seam and would otherwise collide. It runs inside the sale
  transaction *in place of* the inventory insert, writes the `cargo_drops` rows, and
  returns the receipt line naming the cache. `'!reason'` aborts and rolls the sale
  back, so the pallet cap refuses without taking the money; **`null` means "not
  mine"**, which is how Amos still sells a shotgun across the desk normally.
- **`raws`** (the verb) survives as the text surface, and it shows what the panel
  can't: lead time remaining and what's already out there. Amos's dialogue teaches
  it with `teachVerb` per the house convention.
- His existing back-room stock (guns, taser, hack deck) shares the shelf at
  `min_trust: 0` — as a trust vendor **every** entry needs one, or it vanishes.
- **The counter is content-addressed**: `raws` looks for a live NPC in the room
  with `flags.raws_counter`, so a second quartermaster anywhere else is content.
  Amos is deliberately off the night-commute schedule, so the counter never shuts.
- **`raws` is invisible outside the trade.** No counter present *and* no unlock →
  the command falls through as though unregistered, so a player who was never let
  in never learns the surface exists. Unlocked, it answers anywhere and points you
  at him — otherwise learning the verb at the Layover and typing it in Coldwater
  reads as a bug.
- **Lead time is derived, not ticked.** An order isn't out there for
  `ORDER_LEAD_S` (180s) — somebody has to drive it into the waste. `waitingDropsAt`
  filters on `created_at + lead`, so there is **no scheduler and no extra column**,
  and a restart can't lose it. `openOrders` reports the remaining seconds.
- **Amos is the tracker.** `FENCE_CACHE_REPORT` reads `openOrders()` and emits the
  line through `out()` — deliberately *not* node text, because node text is
  authored content and this is live state.

#### Getting it home

- **A pallet is `CACHE_KG` (150kg)**, one `cargo_drops` row per pallet, all pallets
  of one order in the **same** cache so there's one place to fly. It only ever
  exists as a row — there is no ground item, so it cannot be hand-carried.
- Landing at any field that isn't `airfield_lawless` runs the customs scan:
  Deception vs `3 + maxCookTier + (pallets−1) − (smuggler's hold ? 2 : 0)`. Buzzard
  Field is lawless, which is what makes the Reach a base rather than a target.
- **Legal crop is exempt and is scanned separately from the rest.** Clean pallets
  deliver before the scan runs; the difficulty is then computed over the
  **contraband pallets only**, on their own worst tier and their own count — so
  hiding one crate of Blacktar behind four bales of tobacco doesn't lower it.
- Delivery pays `bm_trust` (`deliverFenceDrop`), which is the same currency the
  ladder is measured in — **you climb it by flying it**. A contraband pallet is
  worth 3–5; legal crop hits the floor of 1, which is what lets a newly-vouched
  pilot climb off the legal rung at all.

**Content is authored by `scripts/reach-dead-drops.mjs`** (idempotent; writes the
DB *and* the content files, because `content:import` is additive and can't rewrite
the existing zone/NPC rows). It's a **clamp, not a converging script**, so it is
deliberately *not* in `oneshots.bat` — **run it by hand, once per environment.**
The crop items and cure recipes are ordinary additive content and ride the import.
The cache ids in that script and in `FENCE_CACHES` must stay in step: the flight
regress suite fails if a cache names a tile that doesn't exist or isn't landable.

**Ground combat** (`combat.js`). `tickCombat()` each airborne tick: AA sites in
range fire on low/slow overflights (altitude, speed, `evade`, and a piloting jink
cut the hit chance); a hit walks the hull-damage ladder → breakup → `crash`.
`arm`/`safe` toggle weapons (hardpoints only); `strafe`/`fire` arms the **targeting-
reticle deck** (`flight_target` → `strafresolve`) to silence a site.

**Air-to-air PvP — fully built and player-attributed** (also `combat.js`; blueprint +
phase log in [proposals/systems-flight-pvp.md](proposals/systems-flight-pvp.md)). Two
real players' aircraft fight each other end-to-end, server-authoritatively:
- **Contacts relay** — `contactsNear`/`relayContacts` push every nearby airborne (or
  ground-rolling) craft to each pilot's cockpit at sync cadence, so bogeys appear on the
  glass with no extra tick latency.
- **Guns** — the client owns aim and reports `airfire guns <targetId> <aimQuality>`;
  the server validates a range/cone/altitude anti-spoof envelope, then lands
  `GUN_DMG × aim` **cut by the defender's own opposed roll** — a jinking target rolls a
  live `piloting` check, an active `evade` break, and a gunship's armour all shave the
  bite. Guns are infinite; a server-enforced cooldown caps the burst rate.
- **Missiles** — the MSL select builds a seeker lock by holding the bogey in the reticle;
  `airlock` records it server-side and **trips the target's RWR** (`⚠ RWR — MISSILE
  LOCK`); `airfire missile` launches. The shot rides as an inbound on the *target's* live
  object and resolves `MISSILE_FLIGHT_MS` later in `tickMissiles` — so the **defender's**
  state at impact decides it: flares popped mid-flight (`flares`, X key) roll
  `FLARE_DEFEAT` to drag the seeker onto the decoys, a hard `evade` break + a last-second
  piloting notch shave `MISSILE_PK`. Ammo = the airframe's hardpoints per sortie, rearmed
  free on parking (`mslAmmo`). All `MISSILE_*`/`FLARE_*` tunables live in `state.js`.
- **Swarm (the Viper)** — an airframe with `data.salvo > 1` replaces the locked single shot
  with a **no-lock ripple**: no seeker cycle, no RWR lock tone, just point the nose inside a
  wide forward cone (`SWARM_CONE`) and squeeze. `airfire swarm <targetId>` spends `salvo`
  rails at once, each riding the target as its own inbound at reduced `SWARM_PK_MULT` /
  `SWARM_DMG_MULT` — so it overwhelms flares by **numbers, not certainty** (each seeker is
  still individually defeatable). With nothing in the air the client sends
  **`airfire swarm ground`**: the standoff counterpart to the gun pass — where `strafe` must
  overfly at LOW and rakes what's under the belly, a ground swarm reaches `GROUND_SWARM_RANGE`
  tiles ahead, prefers a live AA emplacement in the cone (killing it outright if any warhead
  connects) and otherwise saturates the tile the nose points at, hitting bodies for
  `GROUND_SWARM_DMG` as **`explosive`** (a kinetic vest is far less help than vs cannon fire).
  Crimes are charged in the *target* tile, as with a strafing run.
- **What a shot LOOKS like** (client-side, `cockpit.js` + `windshield.js`). The server owns
  every outcome; the visuals are flown locally and are pure feel.
  - **Missiles in the air** — `launchShots`/`stepShots` fly each round as a real world object
    (`v.missiles` → `drawMissiles`), through the same Mode-7 camera as the buildings: motor
    flare, curving smoke trail, a dark dart on its own heading, and a terminal burst. A swarm
    ripples off one rail at a time on `MSL_STAGGER_MS` (cockpit.js:1110, 120 ms — matched to
    the server's per-seeker resolve stagger in `combat.js`),
    alternating sides. They fly **drunk** — each seeker leaves on its own heading and weaves
    through a decaying sine wander before settling late onto the target: `SWARM_PK_MULT` made
    visible. A *locked* single shot uses the same path with the wander turned nearly off.
    With no bogey the salvo goes to `groundAim` — where the boresight meets the ground.
  - **Chin gun (armed heli)** — `chinGun` puts the muzzle on the centreline **under the nose**
    (one barrel) instead of the fixed-wing pair under the wings, at `GUN_FIRE_MS_LIGHT`
    (~2× cadence), with a smaller tracer/flash. The damage half is the airframe's
    `data.gun_mult` server-side; this is the matching *read*.
  - **Audio** (`engine-audio.js`) — `missileRippleFx(n)` lights *n* staggered, detuned motors
    (a ripple, not one launch played once); `gunFx(external, light)` gains a light chin-turret
    voice: no chest-bass, an octave up, short and dry — a peashooter beside the Reaper's cannon.
  - Not built: other players don't see your missiles (contacts relay `firing` for guns only).
- **Structural shear-off in PvP** — guns *and* missiles both resolve through
  `applyAirDamage`, which rolls `shearRoll(target, amount)`: a heavy hit on an already-
  ravaged airframe can rip an **actual surface off another player's craft** — left/right
  wing, tailplane, or rudder (`💥 STRUCTURAL FAILURE — the left wing tears away`). The
  victim then flies the crippled asymmetric model (`custom_data.surfaces` →
  `flight-model.js`; see §Live sheared-surface asymmetric flight), rolling and yawing
  toward the dead side, and both cockpits render the missing piece gone.
- Ground **AA sites deliberately reuse this same PvP damage path** (`applyAirDamage`), so
  a turret hit gets the identical red-flash / hull-gauge / shear feedback a player gun hit
  does — one damage model, not two.

**Boarding under fire** (`cmdBoard`). Getting into the cockpit mid-fight is a
**Reflexes check** (`stat_reflexes` vs a difficulty that scales with the number of
things attacking you). Fail and you're beaten back into the fight; succeed and you
slam the hatch — `breakOffAttackers` drops every enemy `targetId` / NPC
`_combatTargetId` locked on you and clears your combat state (6 s disengage grace),
so **everything attacking you breaks off**. (Out of combat, boarding is free.)

**Walk-in hangars** — every airfield has an enterable **hangar interior** off its
exterior ramp tile: `look` at a field shows a clickable **`in`** ("step inside"),
`out` returns. The interior carries `flags.hangar_interior + is_interior` (engine
indoor contract; **never** `airfield_id`, so no airfield scan treats it as a flyable
field) and `flags.hangar_ramp` pointing back to the ramp; the ramp carries
`flags.hangar_interior_zone`. A single resolver **`fieldFor(player)`** (`state.js`)
returns the exterior ramp whether you stand on it or inside its hangar, so **every
service works from inside too** (hangar/repair/rebuild/tune/modify, buy/rent,
charter, contracts — all four `fieldOf` copies now import `fieldFor`) and everything
always parks/transacts against the ramp (aircraft never leave the `map_world` grid).
**Charter pilots sit at the ops desk inside** their hangar while on shift
(`syncPilots` seats them via `setPosture(...,'sitting')`, `forceStand` on any move
out); `inHangar` counts a pilot present at the ramp **or** the interior. Chartering
happens **entirely from inside the hangar**: you book a ride and a destination at the
desk, the pilot **taxis the machine up to the hangar door**, and `embark` (reachable
from inside, resolved to the ramp aircraft) is what rolls it. The interiors are CODEX
content (`content/zones/zone_hangar_*.json`).
Room text: `describeAirfield`/`describeHangarInterior` share a `serviceBits` builder.

**Ownership** (`hangars.js`). `hangar rent/store/pull` (stored = theft-
proof; an owned craft on an open ramp can be stolen — grand theft, +3 stars);
`repair` (Fabrication + credits); `salvage` a wreck for scrap; `rebuild` a Carcass
(Fabrication + Chemistry + 1500c → a random flyable type).

**Customisation is owner-only** — the umbrella verb `modify` (alias `customize`)
adjusts everything on a craft you *own outright* (not a charter rental), at a field,
on the ground: the **tune curves** (mixture / pitch / boost / CG), the **tail
name**, the **livery**, and **saveable tune profiles** (`modify save/load <name>`).
`modify` with no argument prints the full customisation sheet. `tune` remains the
quick curve shortcut, now equally owner-gated (`ownedCraft`); rentals and
other people's aircraft can't be modified.

**The tuning model (one source of truth).** `state.computeStats(type, tune, cargo,
kits)` is the single function that bends a template's base numbers by the four
continuous knobs, the cabin load, and any fitted kits — and **both** the flight
systems (`effStats` → tick loop, hazards, HUD) **and** the bench graphs
(`perfAxes`) read it, so the dyno can never disagree with how she flies. Signs are
internally coherent: **lean** (+mixture) saves fuel but runs hot and sheds a little
power; **coarse pitch** and **boost** buy cruise speed (boost also drinks fuel,
heats, and twitches the handling);
**tail-heavy CG** trades stability for agility. Each knob is a signed float; how far
it turns (its "reasonable range") is `tuneRange(fabSkill, kits)` — a base band
widened smoothly by Fabrication and by range-widening kits, hard-capped at
`TUNE_DIAL_MAX`. The dials clamp to that range server-side; `tuneset <id> <mixture>
<pitch> <boost> <cg>` commits all four floats from the panel at once.

**Upgrade kits** (`state.KITS`, an authored in-code catalogue — a mechanic, not DB
content) are bought and fitted per-craft via
`installkit <id> <kitId>`, stored on `custom_data.kits`. Two ship today: the
**Precision Tuning Kit** (`rangeBonus` — widens every dial) and the **Intercooler &
Oil Cooler** (`coolMult` — halves the heat cost of lean/boost). New kits are one
entry in the map (`rangeBonus` to widen the dials, or a coefficient read in
`computeStats` to bend the physics).

**The maintenance bench (client).** The hangar-bay's TUNING tab is a live tuning
rig, not a stack of cycle buttons: four **rotary drag knobs** (mixture / pitch /
boost / CG) feed a **performance graph** — the bench stage becomes a five-axis
**radar** (SPEED · ECON · RANGE · COOL · AGILITY) that morphs against a stock ghost
as you turn a knob, with a row of **delta bars** underneath reading the ± vs stock.
The axis math is mirrored client-side (`hangar-bay.js computeAxesClient`, kept in
sync with `state.perfAxes`) so the graph responds instantly to a drag; **Apply**
commits via `tuneset` and the server re-pushes the authoritative numbers (any drift
self-corrects). The **UPGRADE KITS** shop is folded into the same tab.

**Acquisition** (`acquisition.js`). `buy <type>` purchases at a dealer field (`buy`
routes back to commerce for ordinary shopping).

**NPC-pilot charters** (`charter.js`). `charter` is a *ride*, not a self-flown
rental: an on-duty **charter-pilot NPC** (`charter_pilot` personality + flags) flies
you as a passenger. Four are seeded — Ratchet Doyle (`shift_start` 0), Magpie Soto
(8) and Old Kessler (16) all at **Coldwater Regional**, plus Wren Halloran (0) at the
**Echelon** pad. Each works a fixed **8-hour shift** (`withinShift`, `SHIFT_HOURS`).
Pilots **physically clock in and out** (`syncPilots` moves the NPC): a
pilot is **at work** when they're **in their hangar** or **out on a flight** —
`available()` = in-hangar + free. On shift they stand at the desk; off shift they
go **home** (desk closed, "back at 08:00"); out on a run they're gone until they
**return**. A flight that **overruns the shift** keeps them at work (flying) until
they land — then the next sync sends them **home, off the clock**. A pilot already
out means you **wait for their return**.

**The booking flow is a visual dialog, not typed arguments.** `charter` (alias
`charterinfo`) pushes **`charter_open`** with the field's fare quotes and destination
tiles; the dialog sends **`charterbook <destZoneId> [any]`**. `any` (forced at a
VTOL-only field) is the **Dragonfly** land-anywhere run to any `map_world` tile at ~2×
fare; otherwise it's the **Mule** to another airfield (`resolveDest` rejects
non-airfield destinations). Fare = `charterFare` — `90 + 6 × Chebyshev-tiles`,
doubled for the anywhere run, rounded to 5c.

**The fare is charged at booking** (`cmdCharterBook`, charter.js:317), not at embark.
`charterbook` generates the aircraft at the ramp (narratively taxied up to the hangar
door), pilot aboard, bound for your destination, in the **`boarding`** phase.
`embark` then just goes: it seats you and moves the charter to **`departing`** — the
pilot taxis out on the ground for `TAXI_MS`, then the tick **rotates** her
(→ `enroute`) and flies the leg. A charter aircraft is
**locked without its pilot**: `embark` is refused unless the assigned pilot is aboard
(`charterParkedAt` / `embarkCharter`, gated in `index.cmdBoard`). If nobody embarks
within **`HELD_EXPIRY_MS` (30 min)** the pilot gives up, the craft despawns and the
fare is refunded; orphaned charter rows are swept on plugin load.
A booked charter is **reserved to the player who chartered it** (`ch.chartererId`):
a second player can't `embark` it (they fall through to normal boarding, the charter
invisible to them). Cancelling before you embark **refunds in full** — type
**`cancel`** or simply **leave the airfield** (the tick sees the charterer is no
longer at the field via `fieldFor` and scrubs it). Once you've embarked she's
committed — rolling. The pilot does everything (a server-driven autoflight tick —
the main physics tick skips `live.charter` craft); you have **no controls**. The pilot
**rides along as a real aircraft occupant** — `boardPilot` puts the NPC in
`live.occupants` and pulls them out of the world at departure (so bystanders see
them leave with the plane; the engine `npc._aboard` guard in `gameLoop` freezes
their AI), and `disembarkPilot` sets them back down at the home field on the return. On arrival
they set you down and tell you to `disembark`; if you don't within **20 s**
(`AUTO_DISEMBARK_MS`) they put you out automatically, then the craft despawns and the
pilot frees up. **Admin:** `.testfly <type>`
spawns any aircraft free at a field and boards you as pilot for normal flight.
**Dev-panel:** a **Flight** panel (`GET /flight/debug`) shows each pilot's
work-status (on duty / off shift / flying → where) and a live flight-request log.

**The glass cockpit** (`cockpit.js` + `engine-audio.js`). The area pane is a
brushed-metal/glass instrument panel animated every frame by a local rAF loop that
*eases* toward each server push (the compass spins to a bearing, the horizon banks
into turns, needles glide): the PFD/MFD/gauge cluster above, plus a heading-up
**RADAR** (sweep, range rings, land/field/no-fly blips, and the **fuel-guide arrow**
to the nearest field shown below 30% fuel) and the **real minimap**
(`getMinimapData`, danger-coloured). **Engine audio:** a live throttle-tracking drone
+ slipstream + airframe creaks/gear/gust.

**Per-aircraft adaptive layout.** The panel composes itself from each craft's
capabilities + size (`mountHud`): the engine cluster shows one gauge per engine; a
**weapons** panel appears only on hardpoint craft; a **cargo / W&B** load panel only
on craft with a hold; a **VTOL vertical tape + HOVER lamp** only on rotorcraft; the
radar scales up for gunships/heavies and down for ultralights. Each class carries a
**theme** (accent + chrome): gunship military-red, heavy industrial-amber, heli
rotor-green, ultralight minimal, prop analog-blue, and the **Carcass wreck runs a
degraded panel** (flicker, desaturation, "AVIONICS DEGRADED"). So a Mayfly is a
sparse two-gauge panel and a Leviathan is a dense four-engine freighter console.

## Engine noise → the ground (`overflyNoise`)

Each airborne tick, a craft radiates engine noise to the surface. Loudness =
`type.noise` + engine count + size, boosted by throttle and **cut by altitude**
(high band = inaudible, cruise = muffled, low = loud). That becomes a **reach
radius** over the tile grid: the cell directly below hears an **identified pass**
naming the type + heading (per-class flavour — an ultralight *buzzes*, a heli
*clatters*, a Leviathan *thunders*, a Reaper *screams past*), and nearby cells hear
a fainter **directional** rumble that thins with distance. On a loud low pass,
**ground threats react** — hostiles look up and aggressive enemies throw up
small-arms fire (light hull damage); AA sites engage via `combat.js`. Per-class
timbre also drives the pilot's own audio (idle/power/spool) in `engine-audio.js`.
Fly high, fast, and you're quiet; low and slow over a hostile tile and everyone
below knows exactly what you are and where you're headed.

## Verb-collision routers

Flight wins several verbs by manifest `after`
(`["gametable","generator","commerce","broadcast","interactions","quests"]`) and
delegates by context: `board`/`look`→gametable (poker), `refuel`→generator,
`buy`/`sell`→commerce, `eject`/`tune`→broadcast, `examine`→interactions, and `repair`
falls through to the engine gear-repair builtin off-context.
