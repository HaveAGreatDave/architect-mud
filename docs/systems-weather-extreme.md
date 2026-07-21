# Extreme Weather (Design — Not Yet Built)

> **Status: design sketch, 2026-07-01.** Nothing here is implemented. This is the agreed plan for
> making weather a survival threat. It deliberately adds **no new subsystem** — every piece rides an
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
| **Hero event (phase 2)** | EMP / ion storm — grid-wide blackout, fries electronics/cyberware/ATMs/TVs |

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

- **Lever:** a high-`severity` cell adds extra `tempOffset` in the field beyond the current `K_TEMP = 4`,
  so a cold snap pulls harder than an ordinary cloud.
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

## Named "hero" events *(step 7a built; 7b/7c pending)*

Rare, announced events that ride **on top of** the forecast/field with an **approach→peak→passing**
lifecycle, forcing a `severity` preset (and, for acid, a precip override) instead of deriving it. Per the
[engine/plugin boundary](proposals/engine-plugin-boundary.md), they live **in the weather plugin** (the
field owner) — the engine just *drives* them, mirroring how the field advance is injected.

- **Definitions** (`NAMED_EVENTS` in [plugins/weather/index.js](../plugins/weather/index.js)): `ion_storm`
  (severity 0.9) and `acid_rain` (severity 0.6, `precipOverride: 'acid'`). Each has per-phase durations +
  announce lines. Severity ramps: half in approach/passing, full at peak.
- **Lifecycle:** `stepWeatherEvent()` advances phases by wall-clock and auto-rolls a new event
  (`AUTO_EVENT_CHANCE_PER_30S ≈ 1 per 2–3 game-days`). The engine calls it on the **30s tick** via the
  `registerWeatherEventStep` provider seam and broadcasts returned lines sky-wide (`.weather-event`).
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
   - 7b. ⬜ **Acid rain** — apply `burning` to outdoor players when `getZonePrecip` reports `precipType: 'acid'` unless `waterproof` (mirror the ashfall/`sealed` pattern); add the `waterproof` tag.
   - 7c. ⬜ **EMP / ion storm** — `forceGridBlackout` engine seam fired at the ion storm's peak + a `weather.empPulse` event; device "fried" flag + repair loop; `atm`/`broadcast` subscribers go dark.

Steps 1–2 alone give a playable, lethal cold snap; 7a makes hero events stageable/emergent (severity + announce), with their teeth landing in 7b/7c.
