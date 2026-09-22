# Extreme Weather (as built)

> **Status: BUILT — all of steps 1–7d shipped.** Weather is a live survival threat: the severity
> scalar, the lethal thermal tail with no indoor safe haven, power scars, the wind stamina gate,
> ashfall, the ⚠ telegraph band, and the named hero events **including acid rain (7b) and the
> EMP/ion storm (7c)**, each with the full presentation kit (7d). The per-step notes in the roadmap
> at the bottom are the authoritative record of what each piece does.
>
> *(This header read "Design — Not Yet Built" until 2026-07-27, long after the body had been marked
> ✅ step by step. It was still saying acid rain and EMP were pending while both were shipped and
> regress-covered — which is exactly how they got reported as outstanding work.)*
>
> Originally a design sketch, 2026-07-01. It deliberately adds **no new subsystem** — every piece rides an
> existing seam in [environment.js](../server/engine/environment.js), [plugins/weather](../plugins/weather/index.js),
> [gameLoop.js](../server/engine/gameLoop.js), [effects.js](../server/engine/effects.js), and the
> power sim. Read [systems-world.md](systems-world.md) (weather field, apparent temp) and
> [systems-survival.md](systems-survival.md) (body temperature, thermal comfort) first — this doc
> assumes both.

## Design decisions (settled)

| Decision | Choice |
|---|---|
| **Model** | Tail-first hybrid — extremes derive from the forecast tail now; named "hero" events layer on top later |
| **Danger** | Gear-gated lethal — weather can kill, but only the unprepared; gear turns a killer into an inconvenience |
| **World scars** | Persistent aftermath (v1 ships one: power stays out) |
| **Safe haven** | **None free** — a blacked-out interior loses HVAC and can kill via cold too |
| **Wind** | Attrition (extra stamina on outdoor moves), never a hard movement block |
| **Telegraph** | Vague `⚠ severe` forecast band; exact onset stays a surprise |
| **Hero event (phase 2)** | EMP / ion storm — grid-wide blackout, fries electronics/cyberware/ATMs/TVs *(built — see 7c)* |

## The spine: a `severity` scalar

Everything hangs off **one derived number** so the four threat channels don't each grow their own
trigger logic. `sampleWeatherAt(gx, gy)` in [plugins/weather/index.js](../plugins/weather/index.js)
already returns `{ cloudCover, precipRate, precipType, tempOffset, stormIntensity }`. Add **`severity`
(0..1)** alongside it, derived from the day's tail:

```
severity = clamp01(max(
  cold  : (COLD_LETHAL_C − apparentTemp) / COLD_RANGE,
  heat  : (apparentTemp − HEAT_LETHAL_C) / HEAT_RANGE,
  wind  : (windKph − GALE_KPH) / WIND_RANGE,
  precip: (precipRate − PRECIP_SEVERE) / (1 − PRECIP_SEVERE),
  type  : floor for blizzard / storm / ash
))
```

- **Tail-first:** severity is *derived* from `forecast[0]` + the local cell — no authoring needed to get
  extremes; a −30°C night with a gale simply *is* severe.
- **Named events (phase 2):** a hero event *forces* a severity preset + type instead of deriving it, so
  the same downstream channels light up without new per-channel code.

Every channel below, the telegraph, and the scar all read this single value.

## The four threat channels

### 1. Thermal siege (nearly free)
The lethal path already exists in `resourceTick` ([gameLoop.js](../server/engine/gameLoop.js)): core temp
`<30°C` or `>42°C` for **5 continuous minutes** → **−10 HP/min**. The gate already exists too:
`player.insulation` + `player.exposurePenalty` (`recomputeInsulation` in
[inventory.js](../server/engine/commands/inventory.js)). The tail just has to *reach* the threshold.

- **Not built, and deliberately not:** an earlier plan had a high-`severity` cell add extra `tempOffset`
  beyond `K_TEMP = 4`, so a cold snap would pull harder than an ordinary cloud. `sampleWeatherAt`
  ([weather/index.js](../plugins/weather/index.js)) applies only `−f × K_TEMP` plus the static region
  `bias.temp`, and nothing feeds severity back into the field. **It would be circular if it did:**
  severity is *derived from* temperature (see the tail-first note above), so letting it re-cool the tile
  would be a feedback loop with no fixed point. The cold tail is already carried by the climate base,
  the ±11°C anomaly, the −9°C diurnal trough and wind chill — a severe night is severe because it *is*
  cold, not because severity made it colder.
- **No free safe haven** *(built, step 2):* when the grid is down, HVAC stops and the interior bleeds toward
  outdoor temp by **passive conduction proportional to the gap** (`step = (outdoor − current) × 0.01`/min in
  `stepIndoorTemps`). A mild outage barely drifts (survivable), but a −30°C snap drops an unheated flat to
  10°C in ~23 min and 0°C in ~51 min — after which an unprotected body freezes, while `insulation` gear buys
  hours. Backup heat, gear, or relocation become real decisions.
- **Open-sky interiors get no shelter at all:** a zone flagged `open_sky` on an `is_interior`/`is_building`
  tile (an open roof, deck, or helipad) is treated as **climatically outdoors** by `isIndoorZone` — it skips
  `stepIndoorTemps` HVAC entirely and takes raw outdoor temp + weather exposure, even though it stays on the
  building's power/network for lighting. Standing on the pad in a storm is standing in the storm.

### 2. Wind — attrition *(built, step 4)*
Moving into an exposed zone costs **extra stamina** scaled by local `getZoneSeverity(targetId)`, applied at
the end of `cmdMove` in [movement.js](../server/engine/commands/movement.js): `cost = WIND_MOVE_BASE(4) +
severity × WIND_MOVE_SPAN(16)` above `WIND_MOVE_SEVERITY = 0.4` (~10 stamina in a moderate storm, ~20 in a
severe one; ~6 moves empties a full bar, which regenerates ~2/min). The move **always succeeds** — attrition,
never a wall. `getZoneSeverity` is 0 for interiors/off-map, so heading indoors is free; system-driven
relocations (shove, `.gohome`) pass `bypassEncumbrance` and are exempt. Cost keys off overall severity (so a
blizzard, a storm **and** a brutal cold snap all sap you), with condition-neutral flavor. *(Brawn/gear
offsets are a later refinement.)*

### 3. Power & blackout *(built, step 3)*
`simulatePowerNetwork` reads global `severity` from the weather-field snapshot (`baseSeverity` — defined
once in the plugin, no duplicated thresholds). Above `STORM_FAULT_SEVERITY = 0.45`, each **`junction_box`**
independently rolls `STORM_GENERATOR_FAULT_CHANCE × severity` per tick to fault **offline** (not the old
cosmetic `flickering`). Faulting the building-level feeds — not the hardened central plant — gives
**scattered, per-building blackouts** (one block dark while the next stays lit) rather than a city-wide
one. Phase 5 already blacks out an offline box's building zones → lights **and** HVAC die → Channel 1
turns lethal indoors. (A faulted box also drops its demand to 0 so it can't waste city-plant capacity.)

- **Scar:** a faulted box stores `recover_after` in its `flags` JSONB (**no schema change**) and stays
  offline until that window elapses (`STORM_RECOVER_BASE_MIN=10 + severity×STORM_RECOVER_SPAN_MIN=30` →
  10–40 min) — the feed doesn't snap back the instant the weather clears. A module-level `stormFaultActive`
  flag keeps the 5-minute power tick running (its gate now also fires on `severity ≥ threshold` or an
  active recovery) so faults trigger and clear on a 5-min cadence, not the daily tick.
- **Pairing:** a severe cold snap yields ~25–56 min of blackout per faulted building, longer than the
  ~23 min a −30°C interior takes to reach 10°C — so shelter-in-a-blackout becomes a genuine survival
  event, not a free win.

### 4. Breathing / exposure *(built, step 5 — ash only; acid deferred)*
First real caller of the [effects.js](../server/engine/effects.js) framework (previously inert —
`applyEffect` had zero callers). The per-minute `resourceTick` in [gameLoop.js](../server/engine/gameLoop.js):

- Outdoor + `ash` weather + **no `sealed` item** → `applyEffect('choking', 65)`, re-applied each minute so
  it lapses ~5s after masking up or getting indoors. The new `choking` effect drains stamina fast (−4/s),
  then bites HP (−2/s) once winded.
- The gear gate `player.sealed` is computed in `recomputeInsulation` (same pattern as `insulation`), from
  the new `sealed` flag tag (catalog: "Sealed (Respirator)"). Any one equipped sealed item suffices.
- **Plumbing fix:** the per-second status-effect tick now persists **and** broadcasts hp/stamina when an
  effect changed them (previously effect damage was invisible on the HUD until the minute tick).

**Acid rain + `waterproof` are deferred** to the phase-2 named-events layer (acid needs a new weather type
and was itself a hero-event candidate) — see build order step 7.

## Gear tags

Authored in the dev panel, read by the engine — mirroring the existing `insulation` / `gets_wet` pattern
exactly (no new mechanism):

| Tag | Blocks |
|---|---|
| `insulation` (exists) | cold/heat drift |
| `waterproof` | wetness accrual **and** acid `burning` |
| `sealed` (respirator/mask slot) | ash choking |

## Telegraph *(built, step 6)*

Each forecast day now carries a `severity` (attached in the weather plugin's `loadForecast` /
`advanceWeather` via `severityForForecast0` — single source; flows through `getForecast()` → the
`/environment/forecast` route and the `environment.daily` broadcast). The forecast panel
([client/game/js/panels/forecast.js](../client/game/js/panels/forecast.js)) shows an amber **⚠** on any day
whose `severity ≥ SEVERE_THRESHOLD (0.45)`, with the tooltip "Severe conditions likely — gear up." It's a
**boolean band, not the raw number** — warns without revealing exact timing or intensity. The **actual
onset** is still the field roll on the 30s/30m tick — warned, not scheduled.

## Named "hero" events *(built — 7a framework, 7b acid rain, 7c EMP/ion storm, 7d presentation)*

Rare, announced events that ride **on top of** the forecast/field with an **approach→peak→passing**
lifecycle, forcing a `severity` preset (and, for acid, a precip override) instead of deriving it. Per the
[engine/plugin boundary](proposals/engine-plugin-boundary.md), they live **in the weather plugin** (the
field owner) — the engine just *drives* them, mirroring how the field advance is injected.

- **Definitions** (`NAMED_EVENTS` in [plugins/weather/index.js](../plugins/weather/index.js)): `ion_storm`
  (severity 0.9) and `acid_rain` (severity 0.6, `precipOverride: 'acid'`). Each has per-phase durations +
  announce lines. Severity ramps: half in approach/passing, full at peak.
- **Lifecycle:** `stepWeatherEvent()` advances phases by wall-clock and auto-rolls a new event
  (`AUTO_EVENT_CHANCE_PER_30S ≈ 1 per 2–3 game-days`). The engine calls it on the **30s tick** via the
  `registerWeatherEventStep` provider seam and delivers returned lines **by vantage** (`.weather-event`).

### Rainbows — a hero event with no teeth *(built 2026-08-13)*

`rainbow` and `triple_rainbow` are hero events by **machinery only**: same lifecycle, same vantage-keyed
announce, same `weather_event` client signal. Three decisions carry them.

- **`severity: 0`, and regress asserts it.** `currentBaseSeverity()` takes the max of the day floor and
  the active event, so a non-zero value here would put every gear-gated lethal channel on alert because
  the sky looked nice. They are marked `benign: true`, which is also what keeps them out of
  `SCHEDULABLE_EVENTS` — the pool the scheduled-day and ambush rolls pick from.
- **A condition, not a schedule.** Everything else in this file is a property of a DAY, knowable a week
  out, which is what gives the forecast its teeth. A rainbow is a property of a MOMENT at the back edge of
  a shower, so `rollRainbow()` asks the live **field** instead of the date: it rained across the map
  (`RAINBOW_WET_ENOUGH`), it has since moved off, the sky has opened, the day's precip is `rain` and not
  snow, and `ambientLight` says the sun is genuinely up. The field is sampled on a coarse 5×5 grid rather
  than at one point, because "it stopped raining" asked of a single tile is answered by a cell drifting two
  steps sideways. One rainbow per shower — the wet-memory clock resets on firing, and is stepped **every**
  tick (including during another event) so a shower that fell under an ion storm still counts afterwards.
- **Delivered by vantage, not globally.** A severe event's client signal is broadcast to everybody,
  because what an ion storm is doing to the city reaches everybody. A benign one goes per zone, skipping
  `buried` — there is no light nine metres under the street. The engine works that out from the `benign`
  flag on the plugin's event snapshot and never learns the type names (`broadcastEventByVantage`). The
  occupied zones are **re-swept every 30s** while one runs, because the signal is otherwise
  change-detected: walking down into The Under mid-rainbow has to take the colour off, and coming back
  up has to put it back.
- **The payload is the room prose, not an overlay.** `body.rainbow-sky` (+ `.rainbow-peak`,
  `.rainbow-triple`) puts a drifting banded gradient through `.room-desc` and `.weather-event` for the
  couple of minutes the arc stands; `prefers-reduced-motion` stands the bands still rather than removing
  them. The canvas overlay draws 1 or 3 arcs struck from a centre below the pane, the second reversed
  (red inside) because that is what makes a double read as real. Like every other weather FX signal it is
  **global rather than vantage-keyed** — only the prose knows whether you can see the sky, exactly as the
  ion storm's overlay already worked. **In the flight sim** it is drawn where a rainbow actually is:
  centred on the antisolar point at 42° (51° and 58° for the outer arcs), through the same `projSky` the
  sun and stars use, so it sits at a true compass bearing and slides off the canopy when you turn toward
  the sun. It is the one hero event that does **not** outrank the weather type — no canopy cast, no haze
  slot, no on-glass behaviour — and its WX badge is deliberately not an alarm colour. **Silent by design**: the audio route exists, the fallback bed does
  not, because the sky going quiet after a shower is the sound of a rainbow.

### A region can rain acid on its own, without a hero event *(built 2026-08-12)*

A hero event is **global and rare** by design: one world-wide day in ~25 (`HERO_EVENT_DAY_CHANCE`).
That is the wrong shape for a region where acid rain is simply the weather, and raising the global
chance to get one would make the whole world acidic to flavour one corner of it.

So the per-region climate bias gained a third key beside `temp`/`dryness`: **`acid` (0..1)**, the
share of this region's precipitation that falls as acid. `effectiveBias` carries it, `sampleWeatherAt`
applies it, and it is stored on `regions.climate_bias` so it retunes from the dev panel's Weather tab
like the other two. **The Scarletwastes** ships `{ acid: 0.75, dryness: 0.8, temp: 7 }`.

It needed no new machinery downstream, and that is the whole reason it lives here rather than in a
new weather type: the acid **hazard** was already local, not global. `gameLoop`'s `resourceTick` fires
on `getZonePrecip(zone).precipType === 'acid'` per tile, so a region whose sampled precip reads
`acid` gets the `corroding` effect, `player.acidCover` shielding, gear durability wear, the rain
audio route and the forecast copy for free.

**The roll belongs to the weather cell, not the tile.** Each field system carries a stable `seed`
fixed at spawn, so a squall is acid or it is not and stays that way as it drifts. A per-tile roll
would put the boundary between burning and not burning one step apart, which is not weather.

**A global hero acid day still overrides everything, everywhere, including a biased region** — the
`eventPrecipOverride()` line is applied after the bias and was deliberately left alone.

### Vantage — an announce is a thing you are looking at

Every phase line was written from outdoors and broadcast to everybody, so a player in a windowless
bathroom was told that *a sick green glow crawls up the horizon*. `skyVantage(zoneId)`
([environment.js](../server/engine/environment.js)) now answers **three** ways, and
`announceWeatherEvent` delivers per occupied zone:

| Vantage | Who | Gets |
|---|---|---|
| `open` | outdoors or on an `open_sky` deck | the authored `line` |
| `window` | indoors, **with a window you can see out of** | the phase's `window` variant — the same sky, framed |
| `sealed` | indoors with no view out | the phase's `inside` variant — same beat, told through a wall |
| `buried` | `grid_z < 0` | **nothing.** The Under has no horizon and no roof to hear rain on |

- **A window is its own vantage, not a hole in the wall.** Watching an acid storm run down the glass is
  not the same event as standing in it, and the prose says so — the window lines are deliberately calmer,
  because glass between you and a thing is the entire reason going inside was worth doing.
- **See-through** is the same rule the light sim already uses: the window must face outdoors
  (no `zone_exterior`) and be unobstructed (`curtain_open`, or the glass broken). So drawing the curtain
  against an acid storm drops you to `sealed`, which is what a player expects it to do.
- **`window` and `inside` are optional and fall back to `line`**, so a future hero event with no indoor
  prose behaves exactly as today — and regress asserts all three are *different strings* for every
  shipped phase, because a fallback that quietly covers an unwritten line is the bug coming back.
- **An unknown zone reads `open`.** This is the only announce a hero event gets, so the failure mode must
  be saying too much, never leaving somebody standing in an ion storm nobody mentioned.
- **The consequence is not the sightline.** The EMP blackout announce is driven off the zones that
  actually went dark, not off vantage — the lights dying is news wherever you are standing, The Under
  included.

### The EMP takes a SECTION of the city, a minute into the peak

Two changes to the pulse, both about it being an event you are inside rather than a switch being thrown:

- **Epicentre + radius.** `forceGridBlackout` rolls an epicentre (preferentially an *occupied* zone —
  a blackout nobody is present for is a database write) and knocks out every **junction box** whose
  zone falls within `EMP_RADIUS_TILES = 12`, Chebyshev, same map, all `grid_z`. City plants stay up, so
  the dark is the building-level distribution failing in a block — the same layer ordinary storm faults
  take one box at a time. A quarter of the map goes out **with an edge you can walk to**, which makes
  *where was it centred* a question worth asking. `{ all: true }` restores the old whole-grid behaviour,
  and an epicentre that **can't be placed at all** falls back to it rather than no-op: a hero event that
  announces itself and then does nothing is worse than one that overreaches.
  ⚠ **An empty blast is no longer that case.** It used to be — "no junction boxes in reach" also fell
  back to the whole grid — and that stopped being right the moment a pulse could do something other
  than take lights. A pulse centred on a rig four hundred tiles out in the void holds a crewed vehicle
  and no buildings; blacking out every generator in the world because of it is exactly the light-switch
  behaviour the radius exists to end. It returns `generators: 0` with an empty `darkened`, and
  ⚠ **an empty `darkened` announces nothing** — the peak line a minute earlier was the beat, and telling
  the city its lights had died while they were plainly still on is worse than saying nothing.
- **Two announce lines, because the blackout now has an outside.** In it: *"Every light around you dies
  at once."* Out of it, with a view: *"Across the rooftops a whole quarter of the city goes out at once."*
  Sealed or buried outside the blast hear nothing — nothing happened to their lights.
- **It fires ~60s INTO the peak** (`EMP_PULSE_DELAY_MS`), not on the peak's first tick. Peak line and
  blackout in the same tick made the whole storm one beat; the delay leaves time to read the sky, work
  out the lights are about to go, and get somewhere. Re-checked on arrival, so a peak that ended early
  can't fire a pulse into a clear sky.

Player generators are still spared throughout — the unplugged genset in the back room is preparation
that should visibly pay off.

### And it takes the electronics out of whatever was driving through it

*(built 2026-09-21)* An aeroplane, a truck and the Echelon all lose their instruments, their navigation
and their radios when a pulse lands on them. **The engine never stops.** Five things shape it.

- **The pulse carries its own footprint.** `weather.empPulse` used to carry a duration and nothing else,
  so every subscriber's only possible rule was *everybody, everywhere* — which is why a pilot on the far
  side of the Basin lost their avionics to a storm that took a quarter of Coldwater's lights. It now
  carries `{ minutes, mapId, x, y, radius, wholeGrid }`, and ⚠ **`empReaches` in
  [environment.js](../server/engine/environment.js) is the ONE function that reads them**. Three
  consumers ask it — the junction boxes, the fry rule and every vehicle — and a second copy of the
  Chebyshev test anywhere would be a second opinion about where the edge is, which is precisely the
  number a player standing on that edge can see.
- ⚠ **The epicentre can land on a vehicle, and it has to.** `getOccupiedZones` reads `current_zone`, and
  for anybody in a vehicle that field is a lie about where they are: an airborne pilot's is the field
  they left, a trucker's is the void room they are notionally still in. Rolled from zones alone the pulse
  could never land near the three surfaces this feature exists for. So `pulseEpicentre` also gathers
  **`vehicle.crewed`** (sync — three RAM registries) and those positions join the pool.
- **Targets arrive by gather hook and carry their own `apply()`** — the same arrangement `tech.targets`
  uses. Each entry is `{ mapId, x, y, knockOut(untilMs) }`, so the weather plugin runs one loop and never
  learns what an aircraft is; a fourth vehicle joins by answering the hook. ⚠ **CREWED, not merely
  existing**: this list also decides where a pulse can *land*, so offering an empty airframe would be
  rolling the storm's epicentre onto furniture.
- ⚠ **Transient, like chrome, unlike pocket gear.** Carried electronics are fried DURABLY and want a
  bench; a nav head welded into a dash cannot be carried anywhere, so permanently bricking it is the
  crueller game the chrome rule already refuses to play. One timestamp per vehicle, RAM only, and the
  "it comes back" line rides a `setTimeout` rather than a tick — a parked aircraft and a stopped truck
  both have to recover without anything ticking for them. Same `minutes` as the chrome blackout: one
  clock for "a semiconductor that survived the pulse needs this long to come back".
- ⚠ **The engine is never touched, at any of the three.** A magneto needs no bus and a diesel is
  compression and fuel. What dies is everything that was *listening to something*. A pulse that stopped
  the drive would strand a trucker four hundred tiles into the void and would make a hero event whose
  stated rule is "never fatal on its own" exactly that.

Per vehicle:

| | goes | stays |
|---|---|---|
| **Aircraft** | the whole panel (`avionicsOut` → the client already blanks the gauges and drops `F.powered`, so the lamps and backlight go too), `chart`, `squawk` | engine, controls, the view out of the canopy |
| **Truck** | the nav head (the dash unit AND the tablet's three apps), the `route` verb, the CB in both directions, the ambient CB chatter *including the wreck-ahead warning* | engine, gearbox, brakes, the road out of the windscreen, the mirrors |
| **Echelon** | the radar plot, the chart plotter (`sailto`) | the engines, and **`sail <direction>`** — a ship is steered by eye off a compass, and refusing to let her move would strand everybody aboard |

⚠ **The aircraft's blackout moved OFF `live.hazard`, and that was a real bug rather than a tidy-up.**
It used to occupy that slot, and every branch in `rollHazards` opens with `!live.hazard` — so for the
whole of an ion storm an aircraft could not catch fire, could not be told it was overheating, and could
not escalate anything it already had. Minutes of hazard immunity, handed out by the thing that was
supposed to be the emergency. Dark panels *and* a fire in the same minute is the nightmare, and it is
now reachable.

⚠ **The hand-thrown charge is the same pulse with a one-tile reach.** `plugins/nullcraft`'s `emp` verb
already fired `weather.empPulse` scoped by `zoneId`, and a zone id cannot catch a vehicle — a rig at the
kerb is not in anybody's `players` set, it is at a grid coordinate. The charge now names a place and a
radius of 1 alongside its `zoneId`, so the vehicle law is one rule reading one payload rather than two
special cases. A satchel is not the sky, hence 1 against the storm's 12.

⚠ **The powerboat is deliberately not wired.** `plugins/powerboat`'s `rigs` registry has no producers yet
(its own header says so) — contributing an always-empty list would be code that looks tested and is not
exercised by anything. It joins by answering `vehicle.crewed` when the drive verb lands.
- **Field integration:** `currentBaseSeverity() = max(field.baseSeverity, eventSeverity())` feeds both
  `sampleWeatherAt` and the snapshot's `baseSeverity`, so **all four channels + the telegraph light up with
  zero new wiring**. At peak, an acid event stamps `precipType: 'acid'` on any tile already under precip
  (rides existing rain — no new weather type). 7b consumes that; 7c wires the EMP blackout.
- **Trigger:** `devTriggerWeatherEvent(type)` (engine) → `registerWeatherEventTrigger` (plugin), exposed at
  `POST /environment/weather/event {type}` (sibling to Max Storm). Plus the rare auto-roll.
- **Telegraph:** the approach-phase announcement *is* the warning — the sky tells you it's coming.
- **FX + audio signal:** on every phase change, `syncWeatherEventSignal` (environment.js) fires a
  `weather_event` WS message (`{eventType, phase}`) for the client **visual FX** *and* re-emits
  `weather.event` for the **audio plugin**:
  - *Visual* — [weather-fx.js](../client/game/js/panels/weather-fx.js) `setWeatherEventFx(type, phase)`
    composites an overlay over the base precip effect: **ion storm** = sickly-green tint + phase-scaled
    lightning flashes (renders even with no precip); **acid rain** = caustic yellow-green wash over rain
    (acid `precipType` maps to the rain effect in `resolveWeatherFx`, tint on top).
  - *Audio* — the [audio plugin](../plugins/audio/index.js) runs a single sky-wide event bed
    (`reconcileWeatherEventBed`, global via `getBroadcast`): **ion storm** = electrical hum + crackle +
    random arc-zaps (sparkle); **acid rain** = caustic hiss. Route-overridable
    (`weather.event.ion`/`weather.event.acid`) with synth fallbacks; gain full at peak, softer in
    approach/passing; late joiners topped up in `reconcilePlayerWeatherAmbient`.

## What a strike looks like *(built)*

The engine has been the single strike authority since `stormTick` shipped: it picks the tile, tells
the room, and emits `weather.lightningStrike` with world coordinates, which the flight sim turns
into a bolt through `pushLightningStrike`. None of that changed. What changed is everything
downstream of it.

**There were three bolt generators and they were three different phenomena.** windshield.js grew one
for the world channel and a second for the on-glass one; hangar-ambience.js grew a third for the
doorway. Each was a nine-ish-node zigzag with its own jitter constant, its own width and its own
colour, so a storm looked like one thing through the canopy, a slightly different thing on the glass
in front of it, and a third thing from the hangar. There is now one channel in
[client/shared/lightning.js](../client/shared/lightning.js), one painter in
[lightning-draw.js](../client/shared/lightning-draw.js), and three readers that differ only in how
they project it — the world camera, the pane, and the door rect.

**The channel is a recursive tree.** A stepped leader forks, and the forks fork: four generations,
about twenty branches, each thinner and fainter than its parent. Three rules keep it from reading as
a bush. A branch carries a bearing away from its parent and **holds** it, descending more slowly
than the channel it left, which is what draws the long tendrils reaching out across the sky —
re-jittering about the vertical instead gives every fork the trunk's own shape at a shorter length.
⚠ **A child whose bearing points back at the channel is mirrored about the axis** — a pure rotation
turns half of them round and the tips hook home, which in a still frame reads as legs rather than as
lightning. And ⚠ **a branch stops in the air where the channel does not**: the leader that connects
carries the return stroke and the rest run out of charge wherever they happen to be. Left to ground
freely, 4.7 forks a bolt arrive and the bottom of every strike is a bush.

**The brightness is a restrike schedule, not a fade.** A cloud-to-ground flash is a return stroke and
then two or three more up the same channel over a couple of hundred milliseconds. ⚠ **A later stroke
barely touches the side branches** — they belong to the stepped leader, and the first stroke is what
lit them — so the channel stammers while the tree behind it fades once and stays faded. That is most
of what makes a bolt read as flickering rather than as blinking. It is rolled at birth and
deterministic; the old one multiplied by a per-frame coin flip, so a fast machine flickered, a slow
one did not, and neither could be photographed twice.

**The bolt comes out of the cloud the clouds are drawn at.** `topZ` was `max(3.5, cam.EH + 1.5)` — a
fixed 3.5 tiles that followed the eye at altitude — while `cloudBaseZ('storm')` is 5.66. So every
channel began well below the deck it was supposed to be leaving, at about two thirds the height it
should have been, and it was ⚠ **shorter than the buildings**: a thirty-storey tower is 5.9 tiles, so
a strike over the city read as a spark between two roofs. Above the deck the bolt is now below you,
which is right — flying over the top of a storm you should be looking down at the strikes inside it.
Lateral offsets are in channel units and scale with `topZ`, so a taller channel is a proportionally
wider tree and altitude works without a second number.

### ⚠ And it was drawn underneath every grade that could flatten it

A channel is painted very nearly white, and additive white cannot clip past 255 before a wash. It
was drawn inside the world block, and after it ran: `applyStormGrade`, the fog wash, the G-grey, and
the truck's own headlamps-off wash at `rgba(6,8,14,0.62)` **over the whole world**. Measured out of a
real cab frame with `__glBoltLum()`, the hottest pixel in the channel reached a luminance of **102
against a night sky of 15** — a pale grey wire. It is **255** with the draw moved after them.

The headlamps wash is right and its reach was wrong. It exists so a driver who never found the light
switch cannot see FAR, and lightning is the one thing in this game you can see without headlamps; a
strike that got dimmer because the driver forgot the lamps is the feature pointed at the wrong
target. The storm grade is the same argument in the same words, since a storm is the light going out
of the world and this is the light coming back for a quarter of a second. ⚠ **The flood always was
drawn after the grade** — so the renderer already said the LIGHT from a strike is not subject to the
storm's own murk, while the channel that produced it was not. One event, two treatments, and the one
that lost was the one you look at.

Both are now one block, after every grade and still under the glass: the cab trim, the windscreen
post, the dash and the water running down the outside of the pane are in front of **you**, not in
front of the weather. ⚠ The flood is drawn first and the channel over it, or the channel gives away
half its contrast to the light it is itself the source of. The channel is drawn through `bankInto`,
a named closure with two callers, because it is world geometry and has to bank and shudder with
everything else.

### What a strike lights up

Three additive lights, all under the channel and all riding the same envelope, so a restrike lands
on the whole scene at once.

- **The area** — a broad pool centred on the channel, so the street, the buildings and the rain
  within a few tiles brighten more than the far corners. ⚠ Its radius is a **world reach through the
  lens** (`BOLT_LIGHT_TILES`), never a number of pixels: a strike two streets away lights two
  streets, where a fixed disc lights the whole frame from any range and reads as a filter. The flat
  white flood came down from 0.5 to 0.3 when this arrived — a full-frame fill has no position, so it
  cannot light one end of a street more than the other, and the two together blew a night street to
  paper white. What it is genuinely for is the strikes that happen outside the frame, which is most
  of them.
- **The ground it lands on** — a pool lying on the ground plane at the strike point, its ellipse
  solved from four projected points rather than assumed (the lateral world axis is `(cosh, sinh)`
  and the forward one `(sinh, -cosh)`; `cam.proj` says so in the two lines that build `f` and `l`).
  Only when the trunk actually arrived: a branch that ran out of leader in the air must not lay a
  pool of light under it. ⚠ **The flattening is capped**, and it is the one place this light is
  deliberately not honest — an eye 0.12 tiles off the deck looking at a pool ten tiles away sees 1.1
  pixels of height against a hundred of width, which draws as a hard bright bar lying across the
  road. What is being drawn is light scattering in the air above the contact, which has real height.
- **The cloud it came out of** — lit from inside over an area far wider than the channel that lit
  it. ⚠ A **cluster**, not a disc: three concentric circles read as a lamp hanging in the overcast,
  so the blobs scatter off the bolt's own seed and the patch is wider than it is tall, because a
  cloud base is.

⚠ None of the three is `glowPool`, which is the obvious reach and would draw nothing: that helper
gates on `ADORN_TIER` and on `POWER_DUTY` — frame state left wherever the last building put it — so
a bolt after a blacked-out tower would have had its own light switched off by the city's power grid,
and its canvas path goes through a queue that flushed with the world pass two hundred lines earlier.

### Seams

- `RENDER_TUNE.boltDetail` (0–1) is how deep the tree grows. 1 is four generations; 0 is a bare
  trunk, which is very close to what shipped for years. A dial rather than a switch because there is
  a real seat for every value — a storm over the far side of the basin is a dozen strikes a minute
  that are four pixels wide. ⚠ Read at **grow** time, so it takes effect on the next strike and
  never on one already in the air: an A/B is two strikes, not two paints of one.
- `RENDER_TUNE.boltForce` pins the age of every live bolt in ms and suspends the life cull. The
  sibling of `snowForce` and `hourForce`, and ⚠ it is an **age** rather than a seed because every
  bench pins `performance.now` — a bolt drained under a pinned clock is for ever nought milliseconds
  old, which is the one moment of its life showing neither the decay nor the flicker.
- `__glBolt()` in the Modelshop is the picture: one canvas per case, cropped and magnified, left on
  the page for a screenshot. ⚠ It crops rather than rendering bigger, unlike `__glSeaShot` —
  `paintWindshield` sizes its backing store from `clientWidth`, so a CSS width of 2× renders at 2×
  and the shot is the same picture again.
- `__glBoltLum()` is the number, against a control frame with the strike pushed past
  `BOLT_MAX_DIST`. ⚠ It needs that control, because the brightest pixel in a storm frame is a lit
  raindrop or the weather badge about nine times out of ten.
- `npm run gl:bolt` ([scripts/shapes/bolt.mjs](../scripts/shapes/bolt.mjs)) is the gate, in the
  `pretest:regress` chain **and** in `shapes:smoke`. 22 claims, mutation-tested 14 of 14. ⚠ Its
  ordering claim reads **raw** source where every other scan blanks comments first, because `blank`
  wipes a template literal whole and the wash it looks for is one — so every anchor there has to be
  a shape only the code takes: a call with its arguments, never a function name.

## Build order

1. ✅ **`severity` scalar** in the field + surfaced to the client (foundation for everything). *Built:* `severityForForecast0` + `field.baseSeverity` in [plugins/weather/index.js](../plugins/weather/index.js) (day-level floor, intensified per-tile by storm/precip in `sampleWeatherAt`); engine reads it via `getZoneSeverity(zoneId)` in [environment.js](../server/engine/environment.js) and surfaces it through `getWeatherMap` + the `environment.zoneTempTick` broadcast.
2. ✅ **Thermal tail + no-safe-haven**. *Built:* the outdoor tail reaches lethal, gated by `insulation`/`exposurePenalty`; the missing piece was indoors — `stepIndoorTemps` now uses gap-proportional passive conduction so a blacked-out interior can freeze in an extreme snap while mild outages stay survivable.
   - **Both original inputs to that tail were re-tuned on 2026-07-21 and the tail still bites.** The `±20°C extreme day` is gone (day-to-day temperature is now an autocorrelated anomaly — see [systems-world.md](systems-world.md)), and the nighttime diurnal dip softened from −12°C to −9°C (17°C swing → a maritime 11°C; the daily *mean* is unchanged, days cooled 3°C as nights warmed 3°C). Modelled against gameLoop's `0.002 * (10 − warmthTemp)^1.75` drift, a January night (−3°C base) still takes a naked survivor from 37°C core to the 30°C lethal floor in **~16 game minutes**, ~35 in a starter outfit, ~92 in heavy insulation. Sustained killing cold is now the **severity/named-event** system's job rather than an every-night accident of the base curve — which is where the drama belongs.
3. ✅ **Power scar** (`recover_after`). *Built:* severity-scaled per-`junction_box` storm faults in `simulatePowerNetwork` (scattered per-building blackouts) that persist offline for a 10–40 min recovery window (stored in `generators.flags`, no schema change); `stormFaultActive` keeps the 5-min tick alive until recovery.
4. ✅ **Wind stamina gate** (movement.js). *Built:* `cmdMove` drains `4 + severity×16` stamina (above severity 0.4) when moving into an exposed severe-weather zone — attrition, never blocks; interiors and `bypassEncumbrance` relocations exempt. First consumer of `getZoneSeverity`.
5. ✅ **`effects.js` wiring + gear tags** (ash; acid deferred). *Built:* new `choking` effect (stamina→HP); ashfall hazard in `resourceTick` gated by `player.sealed` (new `sealed` flag tag in the shared catalog, computed in `recomputeInsulation`); first-ever `applyEffect` caller; per-second effect tick now persists/broadcasts hp+stamina. Acid rain + `waterproof` moved to step 7's named-events layer.
6. ✅ **Telegraph band.** *Built:* per-day `severity` attached in the weather plugin's forecast builders (flows through `getForecast()`); client forecast panel shows an amber ⚠ (+tooltip) on days ≥ 0.45 severity — a vague band, not the number. The devpanel Time & Weather panel mirrors the ⚠ on its forecast grid and adds a **Schedule Future Weather** tool (`POST /environment/weather/schedule`, `env.devScheduleForecastDay`) that edits an upcoming forecast day (1-6) in place — the `environment.scheduleForecastDay` hook in [plugins/weather/index.js](../plugins/weather/index.js) rewrites that day's `weather_forecast` row and recomputes its severity, letting a GM schedule a severe day ahead of time without touching today's live weather/field. Day 0 stays owned by Override Weather.
7. **Phase 2 — named "hero" events** (the layer above the tail):
   - 7a. ✅ **Named-event framework** (in the weather plugin). *Built:* `NAMED_EVENTS` + approach→peak→passing lifecycle forcing a severity preset; `registerWeatherEventStep`/`registerWeatherEventTrigger` engine seams driven off the 30s tick; sky-wide announces; dev trigger route + rare auto-roll; `ion_storm` + `acid_rain` defined.
   - 7b. ✅ **Acid rain.** *Built:* new `corroding` effect (stamina→HP, next to `choking` in [effects.js](../server/engine/effects.js)) applied by a local hazard block in `resourceTick` when `getZonePrecip(zone).precipType === 'acid'` and the player is outdoors. Protection is **coverage-based**, unlike `sealed`: the new `waterproof` tag marks a garment as shedding, `recomputeInsulation` derives `player.acidCover` as the fraction of `{head, torso, legs, feet}` a waterproof piece sits over, and the effect scales its damage by `1 − acidCover`. Full cover is immunity; a slicker alone just hurts less. Gear corrodes too — the per-item loop in [clothing-wetness](../plugins/clothing-wetness/index.js) calls `wear(…, 'acid rain')` on every equipped non-`waterproof` piece, scaled by `precipRate`, so items can be destroyed through the ordinary durability path. This is the one **sanctioned exception to durability rule 1** ("wear accrues on use, never on the clock"): it is not the clock, it's the player choosing to stand in it, and gear indoors or in a wardrobe is untouched. The effect deliberately **outlasts shelter** (you're still coated) until you `wash` — `clearEffect` in the MIS wash action is the cure. Content gate: `item_acid_slicker` (torso + `covers` legs/head) and `item_acid_waders` (feet).
   - 7c. ✅ **EMP / ion storm.** *Built:* `forceGridBlackout({ minutes })` in [environment.js](../server/engine/environment.js), fired once at the ion storm's peak from `syncWeatherEventSignal` (the only change-detected event seam). It **cannot write `generators.status`** — Phase 1 of `simulatePowerNetwork` resets every non-player generator to `'online'` each cycle — so it stamps the same `flags.recover_after` window ordinary storm faults use, jittered per unit so the city comes back raggedly; Phase 1's recovery hold was widened from junction boxes to every non-`player` generator so city plants stay down too. Per-zone blackout lines are muted (`silentBlackout` → `applyPowerLightEffects({ silent: true })`) in favour of one sky-wide announce. ATMs and broadcast transmitters go dark with **no new code** (they already gate on zone power). `emit('weather.empPulse')` then drives the consequences from the weather plugin: unshielded carried `electronic` items get `custom_data.fried` (durable, cleared only by a **bench** `repair` — priced off `relationHelp`), and chrome is knocked out **transiently in memory** (`player._augFriedUntil`, recompute at both ends) rather than in the DB, because permanently bricking a paid-for augment is a crueller game than intended. The `fried` gate is a **single line in `resolveInventoryItem`** — fried rows are excluded by default, so every device lookup in every plugin is covered at once and each plugin's existing "you don't have one" message does the work. Content gate: `item_faraday_sleeve` (a `shielded` container — anything sealed inside is spared).
   - 7d. ✅ **Presentation kit + triggers.** Every `NAMED_EVENTS` entry now carries a **`present` block** (`icon`/`fx`/`audio`/`pool`/`sky`/`severe`) and every surface reads it instead of keeping its own `if (type === …)`: weather-FX overlay (acid etch marks, ion arc geometry), the audio bed (acid gained the sizzle `sparkle` one-shot the ion zaps already had), forecast icons in **both** the game panel and the devpanel mirror, the flight canopy (`WX_HAZE`/`WX_EVENT_CAST`/badge — hero events ride as pseudo weather types), flight hazards (`ACID` hull bleed with no skill check to pass; `EMP` avionics blackout that is self-clearing and never fatal on its own), tablet news headlines **per phase**, the DOOMCAST `sky.acid`/`sky.ion` + `warn.acid`/`warn.ion` pools, the Coldwater AM `weather.acid`/`weather.ion` beats, and the tablet weather widget. Triggers are three: a **deterministic** `heroEventForDate(date)` (seeded like the rest of the forecast, so a hero day is **knowable a week out** and carries `heroEvent`/`heroEventIcon`/`heroEventLabel` on every forecast row — the hour of arrival stays hidden), the admin `weatherevent <type>` verb in dev-tools, and a `WEATHER_EVENT` script action plus a `generator.destroyed` subscriber that turns wrecking a city plant into an ion storm. The old blind auto-roll survives at a much lower rate so an unscheduled event can still ambush you.

Steps 1–2 alone give a playable, lethal cold snap; 7a made hero events stageable, and 7b–7d gave them teeth, a week's warning, and a voice on every screen in the city.
