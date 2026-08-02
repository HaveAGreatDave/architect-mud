# World, Ambience, Sound & Scheduling (As Built)

Live world state, zone navigation, ambient events, sound propagation, spawning, the minimap, the
scheduler, and balance tunables. Primary files: [world.js](../server/engine/world.js),
[sounds.js](../server/engine/sounds.js), [scheduler.js](../server/engine/scheduler.js),
[tunables.js](../server/engine/tunables.js), [commands/describe.js](../server/engine/commands/describe.js),
[commands/movement.js](../server/engine/commands/movement.js).

## In-memory world state

[world.js](../server/engine/world.js) holds the live mirror of the DB (the DB remains source of truth):

```
world = { zones, players, enemies, npcs, corpses, spawnTimers,   // all Maps except transientZones
          apartments, doors, orgs, orgMembers, zoneControl, orgAssets, orgVentures,
          maps, furniture, regions,
          transientZones }   // Set of synthetic non-DB zone ids (registerTransientZone)
```

Zones carry live membership Sets (`players`, `enemies`, `npcs`, `corpses`) layered over the DB row.
`initWorld()` loads zones, NPCs, spawn templates, apartments, and the global ambient pool at boot.
`reloadZone(id)` re-reads a single zone while preserving its live membership Sets — this is what the
dev panel's "reload" uses so editing a zone doesn't evict the players standing in it.

## Movement

`cmdMove` ([movement.js](../server/engine/commands/movement.js)) resolves the destination via the exits
substrate (below), updates the live membership and `players.current_zone`, persists the new zone, and
broadcasts departure/arrival events (with the opposite-direction phrasing where applicable). Entry
applies zone radiation (see [systems-survival.md](systems-survival.md)). `go <name>` resolves **any named
connected destination — building, interior room, or plain exit with a zone name** — via
`resolveNamedDestination` ([describe.js](../server/engine/commands/describe.js)), handling exact,
unique-prefix, and ambiguous matches, and passes the resolved target back into `cmdMove`
(`opts.targetZoneId`) so a name reaches a
specific exit even when several share a direction.

### The exits substrate

> **`zones.exits` is still the source of truth the engine boots from.** As of the map
> pipeline's step 6 there is a second, generated representation — `zone_edges`, the whole
> traversal graph projected at build time from grid geometry plus `content/connections/`
> ([spec §2.2/§7.5](proposals/map-pipeline-spec.md)). Nothing at runtime reads it yet;
> `content:lint` and regress hold it to `exits` on all 21,203 edges so that it *can* be
> read later. **Do not add a reader** — when the cutover happens (spec §5) the merge
> happens once, at boot, the same way `zone_exit_overrides` already merges, and the
> accessors below do not change shape.

A zone's `exits` is a direction-keyed map whose value is **either a zone-id string (the common single
exit) or an array of zone-ids when a direction holds two or more exits** (e.g. two `north` exits to
different zones). Storage stays backward compatible — single exits are bare strings and a direction only
becomes an array when a second exit is added. **All reads go through
[server/engine/exits.js](../server/engine/exits.js)** — never index `zone.exits[dir]` raw (that's the
split-source bug class): `exitTargets(zone, dir)` → always an array; `allExits(zone)` → flat
`[{dir, target}]`; `neighborZoneIds(zone)` → flat destination list; `primaryExits(zone)` → dir→first-id
map for the client minimap (grids are spatial and can only place one cell per cardinal); mutation via
`addExit`/`removeExit` (collapse to string at one target, expand to array at 2+). The dev panel keeps a
byte-identical mirror in `client/devpanel/js/core/state.js`.

**Only non-cardinal directions (`in`/`out`/`up`/`down`) may be authored with multiple exits** — cardinals
(`north`/`south`/`east`/`west`) map to grid cells and can't hold two, so the dev-panel exit builder culls
a cardinal once it has an exit and stacks only `in/out/up/down` (`MULTI_EXIT_DIRS` in
`client/devpanel/js/panels/zones.js`). The accessor and movement law stay shape-agnostic (they handle an
array on any direction), so this is an authoring policy, not an engine constraint.

When a player types a bare direction that has 2+ exits, `cmdMove` opens a **numbered SIFT picker**
("Several ways lead up." → `[1] … [2] …`). The exits are numbered in a **stable order (destination
name)** via `orderedExitCandidates`, so three inputs always agree on which is #2: replying `2` to the
picker, the inline shortcut **`up 2`** (jump straight to the Nth exit without seeing the list —
`exitIndexOpts` on the `in/out/up/down` handlers and in `cmdGo`/`go up 2`), and a repeated look. Picking a
number moves **straight to that destination's zone id** (the selection state carries `moveDirection` +
`candidate.id`; the intercept in `commands/index.js` calls `cmdMove(dir, …, { targetZoneId })`) — never a
`go <name>` text round-trip, which fails on long or duplicate destination names. `go <name>` still works
independently via `resolveNamedDestination`. **Clicking an exit link** in the game client sends
`go <name>` (the link carries `data-dest`; `data-target` stays the raw direction for the dpad highlight),
so a click lands on that specific location by name rather than firing the bare direction and reopening the
picker. Doors bind to one specific exit via `doors.target_zone`
(NULL = legacy, resolves by `(zone_id, exit_dir)` alone); pass the resolved target to
`getDoorForExit(zone, dir, targetId)`. **Known limits:** the map grid editor
(`client/devpanel/js/panels/maps.js`) and the minimap are single-exit-per-direction by geometry; and
player-facing door commands still disambiguate two doors sharing a direction by direction only, not
destination name.

NPC and enemy movement flows through the shared `moveEntity` ([ai-behaviour.js](../server/engine/ai-behaviour.js)),
which mirrors `cmdMove`'s depart/arrive announcements (same phrasing, door handling, follower-drag) for
both graph-driven and fallback-wander NPCs. Enemy spawns announce via `pickSpawnMessage` (scheduler and
dev-panel spawn alike, gated on players present); NPC respawn and MIS flee-to-home announce arrival at the
destination. Admin teleports (dev-panel and phase-shift) broadcast both departure and arrival. The intent
is that **every** arrival/departure — player, NPC, or enemy, including spawn/respawn — emits a `zone_event`;
the only silent path is corpse/enemy *expiry* (cleanup, not a move).

`describeZone` is the heavy renderer: light level gating (8-step ladder blazing→bright→clear→dim→gloomy→dark→murk→pitch-dark; darker levels degrade what's visible — gloomy drops ground items, dark hides creatures/items, murk also hides NPCs, pitch-dark leaves only feel-for-exits — via the `LIGHT_GATE` table),
danger/RAD/SANCTUARY tags, building-discovery flavour, apartment status, the Custodian outcast/turret
response, ground items, furniture, windows, exits, other players, NPCs, enemies, and corpses. It fires
the `zone.describeRoom` plugin hook for optional injected prose.

**Zone properties are tags, danger is inferred (2026-07).** `zones.flags` is the catalog-validated
zone tag bag (see [tags.md](tags.md)); the legacy `danger_rating`/`pvp_enabled`/`radiation_level`/
`is_safe_zone` columns are gone. The header's `[SAFE]…[LETHAL]` chip is **inferred** by
`engine/danger.js` — max enemy threat among the zone's `zone_spawns` (`hp_max + 8 × avg weapon dmg`,
bucketed at 60/100/180), floored by heavy `radiation` (≥25 → high, ≥40 → lethal), overridable with a
`danger` tag, forced `safe` by `sanctuary`. The inference is cached on the world zone object at boot
and recomputed on spawn edits (`computeZoneDanger` in `world.js`). PvP is the default law everywhere;
the `sanctuary` tag registers zone protection through the protection substrate (`engine:sanctuary`
provider) and additionally grants safe sleep, AI safe-flee targeting, and spawn suppression. NPC
wanderers avoid zones whose inferred danger is high+.

### Movement pacing (stamina) — the `pacing` plugin

Movement is paced so the large map feels large, via the **pacing** plugin (see
[plugins.md](plugins.md)) — attached at the move seams, not baked into `cmdMove`. Two layers:
a **walk cadence** (a per-step cooldown, the `pacing:cadence` move gate — tuned so reading pace
never trips it but direction-spamming is paced; walking costs no stamina), and a **`sprint` toggle**
that spends stamina per step for a faster burst cadence, auto-dropping to "winded" below a floor
(hysteresis: can't re-enable until stamina recovers).

**Steps queue, they don't bounce.** When a step arrives before the cadence elapses, the gate doesn't
reject it — it enqueues `{direction, opts}` (up to a cap) and returns a **silent** block
(`{block:true, silent:true}`; `cmdMove` then returns `null` instead of an error line — the one small
engine seam this needs, see [movement-gates.js](../server/engine/movement-gates.js)). A
self-scheduling drain replays each queued step through `cmdMove` exactly when the cooldown clears,
pushing the result to the player's own socket via `sendToPlayer`. So `n n n e` walks you along at
cadence instead of throwing a wall of "catch your breath" errors; a wall (locked door, encumbrance)
ends the run and drops the rest of the queue. System moves (`opts.bypassEncumbrance` — shove,
`.gohome`, follower drags) and drained steps (`opts._pacingDrain`) skip the queue. The sprint spend +
`sta` HUD push + cadence-clock stamp happen on the `zone.entered` event (gates can't broadcast).

The plugin holds these **transient** (in-memory, never-persisted) fields on the live player, in the
same spirit as `player.posture`: `player._lastStepAt` (epoch ms of the last committed step — the
cadence clock), `player._sprinting` (the toggle), `player._winded` (set on auto-drop; blocks
re-enabling sprint until stamina recovers), `player._moveQueue` (pending steps), and
`player._moveTimer` (the armed drain handle). Only `cmdMove` threads `opts` into its `zone.entered`
emit; scripted/elevator moves emit without it and so read as normal (non-exempt) steps.

## Ambient events & sound

### Ambient pool

`getRandomAmbient(zoneId)` prefers a zone's hand-authored `ambient_events` (loudness 1.0), then falls
back to the global weighted pool keyed by the zone's `ambient_theme` (default `indoors`). A per-zone
recent-window of the last 5 messages avoids immediate repeats. `ambientTick` (every 45s) fires for
~40% of populated zones, after first trying the `zone.describeAmbient` plugin hook (used by the weather
plugin). Exterior zones in active weather may additionally layer a weather-themed ambient.

### Interrupts

A loud sound registers in `zoneInterruptLoudness` for a few seconds (`registerInterrupt`); quieter
ambients are suppressed while a louder sound is "in the air" (`getInterruptLoudness`, with lazy expiry).

### Propagation

[sounds.js](../server/engine/sounds.js) models distance with inverse-square intensity
`loudness / (d² + 1)`:

- `getSoundReach` BFS's zone exits out to the furthest zone where intensity exceeds `HEAR_THRESHOLD` (0.5).
- `dropWords` muffles by randomly dropping/eliding words proportional to attenuation (up to ~55%).
- `distancePrefix` labels remote sounds *Nearby,* / *In the distance,* / *Faintly,*.
- `propagateYell` is the all-caps variant; the sender is excluded from the origin broadcast and gets
  their own echo from the command.

> **Minor bug** (QA report): `dropWords` does a throwaway first random pass only to test emptiness, then
> a second independent random pass for the actual output — the validated string isn't the one returned.

> **Future / unwired (drift audit):** two authored surfaces are intentionally *not* consumed yet and are
> kept pending a design pass — don't assume they do anything:
> - The **`sounds` definition table** (name/category/descriptions/loudness) is authored in the dev panel
>   but no engine path ever `SELECT`s it to emit a sound; sound emission today is code-driven via
>   `propagateSound`. Wiring a tag/event → `playSound(name)` lookup is the open task. (The unread
>   `sounds.tags` ghost column was dropped.)
> - Window **`visibility_transmission`** is authored on windows but every consumer reads only
>   `light_transmission`; peer-through keys off the linked zone's presence, not this value. Either wire it
>   into peer/look opacity or drop the field — needs a look-through design decision first.

## Time, weather & environment

The environmental runtime lives in [environment.js](../server/engine/environment.js): the game clock, day/night phase, the moving weather field, apparent temperature, indoor HVAC, and the power/lighting sim (power grid detail is in [architecture.md](architecture.md) §"Environment System", not repeated here). All live state is held in the in-memory `state` object; Postgres is only written on ticks and dev-tool calls. The 7-day forecast and the drifting weather field are **owned by the weather plugin** ([plugins/weather/index.js](../plugins/weather/index.js)), injected into the engine via hooks — see the weather row in [plugins.md](plugins.md).

### Game clock

The clock is a single `world_clock` row (`id = 1`). `state.minutes` is minutes-since-midnight (server-authoritative). It advances at `state.timeScale` **game minutes per real minute** — the game-speed knob (default `1` = the historical 1:1 clock; `3` = an 8-hour real day). On boot `initEnvironment` catches up on downtime: elapsed real time is scaled to game-minutes, whole missed game-days replay `tick24h` (capped at `MAX_CATCHUP_DAYS = 30`), then `state.minutes` jumps to the exact game-minute.

**Game speed (`timeScale`).** Persisted in `world_clock.time_scale`, published to [gametime.js](../server/engine/gametime.js) — the single source of truth every duration-scaling system reads (`getTimeScale` / `gameMsToReal` / `realMsToGame`). Set live from the dev panel's Time/Weather → **Game Speed** card (`POST /environment/time/scale` → `devSetTimeScale`), which re-anchors the clock with no time jump. The whole world scales off this one value: the day/night clock and calendar, weather ticks, NPC shift scheduling, survival decay (hunger/thirst/body-temp), drug tolerance/addiction recovery, jail sentences & evidence purge, vendor grudges, ATM refills, the hololock lockout, and the two once-per-game-day jobs driven by the `environment.dayRollover` event: `dailyMaintenance` (corpse/ground-item/stain cleanup, vendor restock) and **rent collection** — billed every `RENT_PERIOD_DAYS` **game**-days off the game calendar (`apartments.rent_due_date`), so at 3× rent falls due ~every 2⅓ real days. Deliberately left on **real-world** cadence: the 1s combat tick, ambient/flicker/banter pacing, and minigame windows (hololock pending-TTL).

- **Phase** (`phaseForMinutes`): `dawn` 05:00–07:00, `day` 07:00–17:00, `dusk` 17:00–20:00, `night` 20:00–05:00 (wraps midnight). `ambientLightForMinutes` returns 1.0 in day, 0.0 at night, and ramps 0↔1 across dawn/dusk. `diurnalOffset` is a cosine temp swing peaking +5°C at 14:00, troughing −12°C at 02:00 (amplitude 8.5, midpoint −3.5), added to the base `state.tempC` everywhere temperature is read.
- **Season** (`seasonForDate`): derived from calendar month via `SEASON_BY_MONTH`.

### Tick cadences

Scheduled in `scheduleTicks` off [scheduler.js](../server/engine/scheduler.js). The **`1m` driver is the single time engine**: it advances the clock by the scaled game-minutes elapsed and fires the environmental (`tick30m`) and world (`tick24h`) ticks on **game-minute boundaries** — every 30 game-minutes and every game-day crossed — so they scale with `timeScale` and the date/phase/streetlights can never desync from the sped-up day. Neither is registered on the real `30m`/`24h` cadence; don't add them there.

- **1m** (`tick1m` driver) — advance `state.minutes` by elapsed game-minutes, persist, fire `tick24h` per game-day and `tick30m` per 30-game-minute boundary crossed, `stepIndoorTemps`, broadcast `environment.clockTick` + per-zone `environment.zoneTempTick`, flicker overloaded zones.
- **30s** — `advanceWeatherField()` (advect the field one step), `broadcastZoneWeather(occupied)` to occupied outdoor zones, and snap streetlights for those zones (in-memory; no DB writes).
- **5m** (`tick5m`) — brownout redistribution; only runs when ≥1 zone is `overloaded`.
- **tick30m** (per 30 game-min) — recompute `ambientLight`/`phase`, reconcile streetlights map-wide (`syncStreetlights` → lights on where powered and `zoneAmbientVisibility < VISIBILITY_DIM = 0.35`), roll global precip on/off against `forecast[0].precipChance`, broadcast `environment.sync`, fire `environment.tick30m` / sunrise / sunset hooks.
- **tick24h** (per game-day) — advance calendar, fire `environment.advanceWeather` (plugin shifts the forecast and re-seeds the field), run the power sim, broadcast `environment.daily`, emit `environment.dayRollover` (drives engine `dailyMaintenance`).

### Forecast (plugin-owned, seeded, 7-day)

`generateWeatherForDate(dateStr, climateProfile)` is deterministic: a `mulberry32` PRNG seeded off `"weather:<date>"`. Each day yields `{ weatherType, tempC, precipChance, windKph, humidityPct }`:

- **Type** from a precip roll (`precipTypeForTemp` → rain/thunderstorm/sleet/snow/blizzard by temp) or, on dry days, overcast/cloudy/fog/haze/clear scaled by `precipChance`.
- **Temp** = monthly/seasonal base + an **autocorrelated anomaly** (`tempAnomalyC`, weather plugin):
  three-plus octaves of smooth value noise over the day index (periods 25 / 6.5 / 2.8 / 1.4 days) plus
  a ±2°C per-day mesoscale jitter. σ ≈ 2.7°C, range ≈ ±9°C, **mean day-to-day change ≈ 1.6°C**.
  Still a pure function of the date, so a day forecast a week out matches the day itself. The
  autocorrelation is the point — hot and cold spells persist for days rather than being rerolled
  independently; single-day drama belongs to the
  [extreme-weather severity/event system](systems-weather-extreme.md), not to this curve.
- **Wind** (`windForDay`) = base wind × a per-type ceiling (`WIND_BY_WEATHER`: fog/haze calm, storms/blizzards gale) × a rolled daily windiness (~15% calm, ~15% gusty).
- **Humidity** (`humidityForDay`) = base ± type shift (fog/rain wetter, clear drier) ± jitter.

Bases come from the active **climate profile** (`monthly_temp_c` / `monthly_precip_chance` / `monthly_wind_kph` / `monthly_humidity`, indexed by month) when set, else the `SEASON_BASE_*` fallbacks. The forecast lives in `weather_forecast` (7 rows). At boot `loadForecast` generates it if empty; `environment.advanceWeather` shifts it forward one day and appends a freshly generated day 7. `forecast[0]` is authoritative for the current day — `getWindKph` and `getHumidityPct` read from it.

### Moving weather field

A handful of drifting cloud/precip/storm **cells** over the outdoor map (`map_world`), owned by the plugin, fully re-derivable from `(date, forecast[0])` — no DB table, no per-tick writes. `seedField` builds the day's cells (`systemsForForecast`) from `forecast[0]`: cell count/intensity scale with weather type + `precipChance`, and every cell drifts along one seeded prevailing wind whose speed scales with `windKph` (calm ≈ 0.05 → gale ≈ 0.35 grid-units per 30s). `advectField` (the 30s tick) drifts and torus-wraps them. `sampleWeatherAt(gx, gy)` returns `{ cloudCover, precipRate, precipType, tempOffset, stormIntensity }` — a cell pulls temp down by up to `K_TEMP = 4`°C at its core (smoothstep falloff).

The engine holds the sampler via `registerWeatherField` / `registerWeatherFieldSnapshot` / `registerWeatherFieldAdvance` (never imports the plugin). `fieldAt(zoneId)` samples it for a zone, returning `null` for interiors / off-`map_world` / no-sampler — every consumer then falls back to the global model:

- `getZoneTemperature` — outdoor base + diurnal + `tempOffset` (indoor zones return their HVAC temp instead).
- `getZonePrecip` — the global 30m roll gates whether precip is active at all; the field decides which tiles are actually under it (`precipType`, `precipRate`).
- `getZoneStormIntensity` — local 0..1 storm intensity (drives lightning); fallback 0.5 under a global thunderstorm/storm.
- `getZoneVisibility` — outdoor zones get extra dimming under a local cloud/precip cell (`1 − 0.5·cloudCover − 0.4·precip`), on top of the global weather + fog factors; interiors are lit only through windows.

`getWeatherMap` returns a full per-zone snapshot (plus field bounds/systems) for the dev weather map. `broadcastZoneWeather` pushes local temp/cloud/precip to occupied outdoor zones each 30s and emits `weather.zoneAmbience` for the audio layer.

**Muffled rain bleed.** A tile that isn't directly under a storm cell but is exit-adjacent to one no longer goes silent: if its own local `precipRate` is below `MUFFLE_LOCAL_THRESHOLD` (0.12), `muffledNeighborPrecip` BFS's the outdoor exit graph up to `MUFFLE_RADIUS` (2) hops (mirroring the propagation shape in [sounds.js](../server/engine/sounds.js)) and borrows the loudest nearby cell's rate, attenuated `MUFFLE_FALLOFF` (0.45) per hop. `weather.zoneAmbience` carries the resulting `muffled` flag; the audio plugin cuts the precip bed's gain by `MUFFLE_GAIN_MULT` (0.5) when set. Roofs and other `open_sky` zones live on interior maps (`map_id !== 'map_world'`), so they never enter `broadcastZoneWeather`'s loop at all — they always hear their own zone's precip via `getZonePrecip`'s global fallback at full, unmuffled gain.

### Apparent ("feels like") temperature

`apparentTemperature(tempC, windKph, humidityPct)`: applies **wind chill** when cold and breezy (`tempC ≤ 10 && windKph ≥ 5`, standard wind-chill formula), a **heat index** bump when hot and humid (`tempC ≥ 27`, scaled by humidity over 40%), and a damp-cold penalty when `tempC < 8 && humidity > 70`; otherwise returns the dry-air temp. `getZoneApparentTemperature(zoneId, extraOffsetC)` folds in the day's wind + humidity for outdoor zones (interiors return ambient unchanged). This is what the survival layer reads to drive body-temperature drift — see the thermal section in [systems-survival.md](systems-survival.md).

### Indoor HVAC temps

`stepIndoorTemps` (every 1m tick) drives each indoor zone (`is_interior` / `is_apartment` / `is_building`) toward a target. **Powered** zones head to `INDOOR_HVAC_TARGET_C = 20`°C at `INDOOR_HVAC_RATE_PER_MIN = 2.0`°C/min (heating or cooling, ~10 min from an extreme). **Unpowered** zones drift toward the current outdoor temp by **passive conduction proportional to the indoor↔outdoor gap** (`step = (outdoor − current) × INDOOR_PASSIVE_CONDUCTION`, `= 0.01`): ΔT=10°C ≈ 0.1°C/min, but ΔT=50°C bleeds at ~0.5°C/min — so a mild outage stays survivable while a blackout in an extreme cold snap or heatwave becomes lethal (**no free safe haven**; a −30°C snap drops an interior to 10°C in ~23 min, 0°C in ~51 min). Per-zone temps live in `state.zoneTemps`, seeded at boot by `initIndoorTemps`, and are read via `getZoneTemperature`.

## Spawning & corpses

`tickSpawns` (every 10s) joins `zone_spawns` with `enemies`, and for each timer that's due, spawns if the
live count of that template in the zone is below `max_count` and a `Math.random()×100 < spawn_weight`
roll passes; then it reschedules `nextSpawn` by `respawn_seconds`. Corpses are created by `createCorpse`
on player death (`gameLoop.js`) and enemy kills (weapon plugin via `spawnEnemyCorpse`) — see
[combat.md](combat.md). **Corpse cleanup is wholesale, not per-corpse:** `dailyMaintenance` (the
once-per-game-day `environment.dayRollover` job) removes *every* corpse. `createCorpse` stamps a 1-hour
`expiresAt`, but no sweeper reads it — a corpse survives until the day rolls over.

## Minimap

`getMinimapData(centerZoneId, depth = 8, viewer = null)` BFS's exits up to `depth` hops (every caller
passes 8), staying within the same `map_id` (so interiors and exteriors don't bleed into each other),
and returns node snapshots (grid coords, markers, colours, danger, player counts) for the client's
grid. `cmdMap` returns the full same-`map_id`/same-`grid_z` tile set (a `MAP_WINDOW_HALF = 5` half-window in
[movement.js](../server/engine/commands/movement.js)) for the full-screen map popup and the tablet
bigmap.

### The renderer: canvas, with a camera (as built)

The sidebar/HUD/mobile minimaps are drawn on a **canvas**, by
[minimap-canvas.js](../client/game/js/panels/minimap-canvas.js). The DOM grid renderer still exists as
`renderMinimapDom` in [minimap.js](../client/game/js/panels/minimap.js) and is the fallback —
Settings → Layout → **Minimap** (`smooth` | `classic`) picks between them, `mm_canvas=0` in
localStorage is the hard override, and any throw out of the canvas path disables it for the session.
`renderMinimap` is now a dispatcher: the node cache auto-walk reads, the arrival notify and the
void-crossing branch live there, because anything put inside one renderer dies when the other is picked.

**Why canvas.** The DOM path rebuilt up to 243 spans (81 cells × three grids) per step, then started a
180 ms transform on top of that layout/paint spike — which is why a move read as a pop. What canvas
buys is a **fractional camera**: the beacon is pinned at the canvas centre and the world eases
underneath it over the measured step cadence (~480 ms running, ~1000 ms walking), **retargeting from
where the camera currently is** so a run is continuous motion rather than a sequence of hops. The
camera *snaps* instead — no glide — on a `map_id` change, a `grid_z` change, an `R` change, a teleport
(>2 tiles), a virtual interior layout, or `data-motion="off"`. `up`/`down`/`in`/`out` keep the old
scale/fade flourish, since they have no direction to glide along.

**The buffer is the design.** Tiles are drawn into surface buffers keyed by device tile size and
rebuilt **only when the tiles change** (payload, zoom, overlay, an icon finishing load); a frame is a
blit plus the GPS polyline and the beacon. Each buffer holds `MARGIN = 2` tiles more than it shows —
that margin is what the camera glides across. Rebuild per frame and this is slower than the DOM it
replaced. Three surfaces at three tile sizes deliberately do **not** share one downscaled buffer: the
2 px door edges and the stroked labels are 1–2 device px on the HUD and would not survive it.

**The tile cache** ([minimap-cache.js](../client/game/js/panels/minimap-cache.js)) keeps every node
that arrives with real grid coords, keyed by **absolute** position — absolute is load-bearing, since
payload coords are relative to wherever you were standing. A glide needs tiles the payload's window
doesn't cover, so the leading edge draws from memory. Those are rendered at 55% alpha as **remembered**
and carry no live data: no player counts, no reachability styling, no beacon — things you can only know
by being there now. Interiors laid out by the exit-graph BFS have no stable key (their coords shift
every step), so they run uncached and snap; that costs nothing, because an interior is always fully
inside the window anyway. LRU-capped at 6,000 entries, evicting off-map tiles first.

Canvas has no CSS, so [minimap-assets.js](../client/game/js/panels/minimap-assets.js) reproduces the
one thing the DOM got for free: the ~70 zone icons, tinted per `spec.text` by a `source-in` composite.
It never blocks a paint — a missing asset draws nothing and the ready callback marks the surfaces dirty.

**Terrain has no texture.** Ground is the flat colour `derive.mjs` resolved into `node.spec.fill`, and
nothing is laid over it. Seven terrains (water, grass, dock, scrub, redrock, ash, marsh) once carried a
stretched SVG overlay — ripples, grass blades, plank seams — authored to phase-match at the tile edges.
That art existed in **three** byte-identical copies (`styles.css` for the DOM minimap and the full map,
`minimap-assets.js` for the canvas, `tablet-os.js` for the regional map) which had to be retuned in
lockstep or the same bay painted differently on three surfaces; the Studio, which draws from the same
derived palette, never rendered them at all. All three copies are deleted. The `.mm-<terrain>` /
`.map-<terrain>` / `.terr-<terrain>` classes survive but now only drop the tile border, so a body of
water still reads as one surface. A tile's read is its colour plus whatever a person put on it.

The canvas is appended **inside** the existing `#minimap-grid` divs rather than replacing them, so the
`esp-active` filter, the delegated double-click, and the crossing/message renderers keep working on
the container untouched. Click-to-enter and the hover tooltip are hit-tested from camera coords.

### Tile rendering (the map is drawn, not ASCII)

Each map/minimap node carries four additive rendering fields, all derived server-side in
[world.js](../server/engine/world.js) and mirrored into the `cmdMap` tile payload:

- **`icon_svg`** — a named SVG in `client/game/assets/zone-icons/`. `flags.icon` wins; otherwise a
  building **facade** tile falls back to the top-down rooftop footprint for its `building_type`
  (`buildingIconSvg` → `BUILDING_TYPE_ICON`), so every building reads as itself on the 1:1 map. Road
  tiles get one of 16 connectivity icons (`road_ns`, `road_nesw`, …) matching their road neighbours,
  auto-tiled from adjacent road terrain — a continuous dashed street network with real
  T-junctions. Runways use `runway_ns`/`runway_ew`.
- **`building_type`** (`buildingTypeOf`) — the facade tile's type, `null` for streets/water/interiors.
  Drives the rooftop footprint lookup and the flight-sim 3-D shape.
- **`entrance`** (`buildingEntranceDir`) — which edge (`north`/`south`/`east`/`west`) the door faces,
  reverse-derived from the *real* exit graph (the street tile whose exit leads INTO the facade), **not**
  from the `flags.world_exit_zone` hint. Cached, invalidated on any exit mutation. Drives the
  small amber entrance arrow.
- **`terrain`** (`zoneTerrain`) — the tileable ground surface. The authoritative source is the
  authored **`flags.terrain`** field (`water | road | asphalt | concrete | grass | dirt | sand |
  gravel | dock`), painted in the dev panel **Maps → Terrain mode**; when unset, `zoneTerrain`
  falls back to inference (`flags.pier` → dock, a `road_`/`runway_` icon, or a green `bg_color` → grass).
  Consumed by the minimap/tablet fills and the flight-sim ground tint (`biomes.js` maps each type
  to a ground biome). **Smart roads:** a `road` tile with no authored icon has its connector piece
  (`road_ns`, `road_nesw`, …) auto-tiled live from adjacent road terrain by `roadConnector` in
  [world.js](../server/engine/world.js), so painting roads next to each other forms straights /
  turns / T-junctions / crossroads with no hand-picked piece. An authored `flags.icon` road still
  wins, so hand-tuned roads are untouched.

The client (game sidebar minimap, full-map popup, tablet bigmap in
[minimap.js](../client/game/js/panels/minimap.js) / [tablet-os.js](../client/game/js/panels/tablet-os.js))
shares a **Labels / None overlay** setting (Tablet OS → Settings → Layout → *Map Labels*, stored as
`mapOverlay` in the shared settings object): both modes draw the SVG tile base; *labels* adds the
authored 2-letter building acronym (`zones.marker`) on top. A third *icons* mode, which stamped a
building-type emoji over the rooftop footprint, was removed — it fought the tile art and said less
than the acronym. The you-are-here marker is
transparent so the current tile shows through. The full-map popup uses fixed square tiles that fill its
374px window; the regional view scales tiles to fit the whole district with no panning.

> **STANDARD:** a new `building_type` needs BOTH a 2-D footprint in `BUILDING_TYPE_ICON`
> ([world.js](../server/engine/world.js)) AND a 3-D shape in `BLDG_TYPE_3D`
> ([windshield.js](../client/game/js/panels/windshield.js)) so it reads consistently on the map and
> from the air. Each registry falls back rather than rendering nothing.

### The district — the bulk of map_world

The bulk of the exterior city was **generated**, not hand-authored zone-by-zone: a single painted
blueprint produced a self-contained slice of `map_world` — terrain tiles, polyline-named roads
(inheriting existing artery names at the seam), a connected minimap network, and the city's real
buildings relocated onto the grid as facade markers forwarding `in` to their existing interiors. The
current grid is **888 zones** (shipped 2026-07-11), with the airfields (Coldwater Regional +
Threshold Helipad) on it and the legacy ramps de-airfielded.

The tool that generated it — `tools/zone-planner`, the "District Editor" — was **deleted
2026-08-01**, along with the `flags.planner` / `bp_district` provenance marker it stamped on 5,309
tiles. The [Studio](../tools/studio/README.md) replaces it: it edits `content/` files directly, with
no database in the process and no regenerate step to defend the tiles against. Nothing was
regenerated wholesale after the first ship anyway, which is what made the marker dead weight.

Don't confuse the grid with the **region** (the spatial `regions` table / `flags.region_id` place,
e.g. Coldwater, edited in the dev-panel World Editor) or with the **district *registry*** below
(land-use identity derived from zone-id prefix). See
[reference/land-taxonomy.md](reference/land-taxonomy.md) for the full breakdown and their single
sources of truth. (The generated grid *is* the Coldwater region — but that's the region layer's
concern.)

## Districts (sense of place)

[districts.js](../server/engine/districts.js) is the **district registry** — the substrate that
gives every zone a felt neighborhood identity. **The definitions are content** (`content/districts/`
→ the `districts` table, `readTier: boot`), edited in the Studio's district view and shipped by the
ordinary deploy; this module loads them at boot and owns the *resolution*, not the data.

`districtFor(zone)` returns an entry — **never null, and sync/query-free by contract**, since it runs
per move, per look and per ambience beat. Precedence: `flags.district` (painted) → the district's own
`prefixes` list against `zone_<prefix>_<name>` → a lethal-zone `hazard` fallback → the `residential`
default. The prefix rung is **legacy**: it classifies 154 old zones, and nothing on the modern grid,
whose ids are all `zone_district_<x>_<y>`. A tile with neither reads as Residential — 1,150 do.

Each row carries `id` (aliased `key`) / `name` / `color`, plus `blurb`, `landmark` (a zone id) +
`skyline` phrase, and a `signature` sensory pool. The client's `FUNC_LEGEND` in
[minimap.js](../client/game/js/panels/minimap.js) is **no longer a mirror** — it is filled from
`/api/districts` at boot. It used to be hand-copied and had drifted four districts behind, so
`wilds`, `sewer`, `yards` and `longwatch` drew no regional-map tint, legend row or tooltip at all.
`mapFunc` in [movement.js](../server/engine/commands/movement.js) is a thin wrapper over
`districtFor(z).key`.

> **Skyline lines are dark.** All 14 districts naming a `landmark` name it **without the `zone_`
> prefix** (`nc_spindle`, `drum_shop`), and [describe.js](../server/engine/commands/describe.js)
> looks the value up verbatim — so `getZone()` misses and no "To the north, …" line is ever
> composed. `content:lint` warns per district. Fixing them is authoring work: pick a live landmark
> zone in the Studio.

Four surfaces consume it:

- **Header tag** — `describeZone` ([describe.js](../server/engine/commands/describe.js)) prints a
  district line (`· The Franchise — Commercial Strip ·`) in the district colour under the zone name.
- **Boundary crossing** — `cmdMove` appends `"You cross into <district>."` to the move narration when
  the district key changes, plus the district `blurb` once per district per player (gated in
  `player_flags` as `district_seen_<key>`).
- **Skyline landmark** — `describeZone` appends a light-gated, **outdoor-only** compass line
  (`To the north, the Spindle needles up into the haze`), bearing computed by `skylineBearing` off
  the grid deltas to the district's `landmark` zone. Never fires indoors, in the dark, or when you're
  standing in the landmark zone.
- **Minimap** — `getMinimapData` ([world.js](../server/engine/world.js)) adds `district{key,name,color}`
  to each node; the client tints tiles with the district colour when they have no authored `bg_color`,
  and names the district in the tooltip. The sidebar minimap is **not** clipped to your own district —
  every tile in the window renders, whatever district it belongs to, so neighbouring districts stay in
  place instead of being fogged to void. (It once was clipped, with the tiles one step across a boundary
  drawn as `.mm-gateway` markers carrying the target district's initials. That was disabled behind an
  always-true predicate long before the canvas rewrite, and the dead branch has now been removed along
  with `.mm-boundary`/`.mm-link`.)

**Sensory signatures** are a plugin, not engine: [district-ambience](../plugins/district-ambience/)
answers the `zone.describeAmbient` tick (~35% of outdoor ambient ticks) with a random `signature`
line, abstaining with `undefined` the rest of the time so hand-authored `ambient_events` and the
global pool still carry most of the atmosphere. Interiors are hard-excluded
(`is_interior`/`is_apartment`/`is_building`).

## Scheduler

[scheduler.js](../server/engine/scheduler.js) is the single interval dispatcher. Named cadences
(`CADENCE_MS`: `1s, 4s, 5s, 6s, 10s, 15s, 30s, 45s, 1m, 5m, 10m, 30m, 1h, 24h`) each own one `setInterval`; multiple callbacks share it, and errors
in one callback are caught and logged without killing the timer. The **1-second combat tick is
deliberately not on the scheduler** — it's the latency-critical hot path and uses a raw `setInterval`
in `gameLoop.js`. Plugins and the environment system subscribe via `schedule()`. **Every callback is
idle-gated by default** — it is skipped while `hasActivePlayers()` is false, so an empty world lets
Neon scale to zero; `schedule(cadence, cb, { runWhenEmpty: true })` is the deliberate opt-out. Never use a raw `setInterval` + `query()` for a
scheduled job: that defeats the gate.

## Pathfinding

[pathfinding.js](../server/engine/pathfinding.js) — BFS over the zone exits adjacency graph. Used by the AI behaviour system for PATROL walk mode and CALL_BACKUP radius lookups.

- `findPath(startId, targetId, { maxDistance = 60 })` — returns `[startId, …, targetId]` or `null` if unreachable. Crosses map/interior boundaries freely; exits JSONB is the graph.
- `getZonesInRadius(startId, radius)` — BFS out to `radius` hops; returns a `Map<zone_id, distance>`.

## Channels

[channels.js](../server/engine/channels.js) — radio-style communication channels persisted as recent-message histories.

**Built-in channels:**

| Channel | Access | Notes |
|---|---|---|
| `#system` | All players | Server-only broadcast — players cannot send |
| `#arcnet` | admin/dev/builder/designer roles | Staff chat |
| `#corp:<orgId>` | the player's own corp | **Dynamic, not in `CHANNEL_DEFS`** — derived from `getPlayerMembership`; display label is `#<corp name>` but the id stays `#corp:<orgId>` so renames never break routing |

`CHANNEL_DEFS` is the **static** definition registry (id, `permanent`, `systemOnly`, `isMember(player)`). New fixed channels are added here; membership-derived ones need a `startsWith` branch in `canAccessChannel`/`sendToChatChannel` alongside the corp case.

- `getPlayerChannels(player)` — the channels a player should subscribe to on login.
- `sendToChatChannel(channelId, msg, broadcast)` — send to all eligible online players; persists player-authored messages.
- `getChannelHistory(player)` / `getChannelMessagesSince(player, since)` — replay. Messages live in the **`channel_messages`** table, pruned to the newest `HISTORY_LIMIT` (50) rows per channel on every insert. The writer (`storeChannelMessage`) is module-private — everything goes through `sendToChatChannel`, which is what lets `newestMessageAt()` cache the high-water mark and skip Postgres on idle polls.

## Appearance

[appearance.js](../server/engine/appearance.js) — character physical description, generated once at character creation and stored on the player row.

- `generateAppearance()` — returns a random appearance object: `{ hair_style, hair_length, hair_color, eye_color, height, weight, biological_sex }`. Hair length is constrained by style (mohawks can't be very long, etc.).
- `describeAppearance(player)` — builds a prose description string from the stored appearance fields for use in `look <player>` output.

### Being put out — `streetExitFrom` (as built)

When something ejects a player from a business — closing time
([commerce](../plugins/commerce/index.js) `closingSweep`), a club bouncer
([strippers](../plugins/strippers/index.js) `bouncerEject`) — the destination comes from
**`streetExitFrom(zoneId)`** ([world.js](../server/engine/world.js)). One law: *an ejection lands
outdoors, on a tile a player can stand on, and never on a facade.* Breadth-first out through interiors
(bounded, `EJECT_MAX_HOPS`), so a back room three doors deep still finds the pavement.

**Why a facade is the worst possible answer:** `resolveLanding` forwards a landing on an enterable
facade into that building's interior entry zone. So an "eject" onto a facade tile puts the player
*inside the shop next door*. Every ejector used to pick its own destination and each picked wrong
differently — the bouncer took the first exit it found (which can be the VIP room or an office),
closing time preferred a non-interior tile (which **includes** a facade). `isStreetLanding(zoneId)` is
the shared predicate (outdoors, not a facade, not water), exported so a hand-authored destination
(`flags.bouncer_eject_zone`) is validated by the same rule the search uses.

`streetExitFrom` returns `null` when there is genuinely no way out. **Callers must treat `null` as
"leave them where they are"** rather than inventing a fallback: leaving someone inside is recoverable,
teleporting them into a wall is not. Guarded by an invariant test over the live world in
[plugins/commerce/regress.js](../plugins/commerce/regress.js) — the failure mode is a *content* shape
(a shop whose only exit is a facade), which a hand-built fixture would never contain.

**Residents are exempt.** Coldwater is mixed-use: shops sit under flats. The closing-time gate and the
closing sweep both skip anyone who `isResidentOf` the building, so the hours lock the door to
*customers* and nobody is ever swept out of the building they live in. After hours a mixed-use building
simply belongs to its residents.

## Locks

[locks.js](../server/engine/locks.js) — extensible lock type registry. Separates lock *type* definitions from the *auth logic* that resolves whether a player can open a given lock.

- `registerLockType(shortName, { tagType, kitTag, defaults, authFn })` — registers a lock type. The doors plugin calls this for `hololock`, `keypad`, etc.
- `resolveLockAuth(lockTag, door, player)` — dispatches to the auth function registered for `lockTag.type`. Returns `true` if the player is authorized.
- `getAllLockTypes()` — used by the dev panel's door editor to populate the lock type dropdown.

Lock type definitions live in the doors plugin ([plugins/doors/index.js](../plugins/doors/index.js)); the lock registry in `locks.js` is the extensibility seam, not the implementation.

### A resident is never locked out of their own home (as built)

**`checkLockAuth`** ([commands/doors.js](../server/engine/commands/doors.js)) — the single funnel used by
the `engine:door-lock` move gate, open/close/lock/unlock, `hackDoor` and the describe pane's `data-lock="owned"`
marker — authorises a player on **any** lock hanging on a door that touches a residence they control
(`playerControlsApt`, either side of the door), before consulting the per-lock-type registry at all.

This sits above the registry because the registry is where the lockouts were hiding: each lock type
authored its auth in isolation and only the hololock knew what an apartment was.

| Lock | Its own rule | The lockout it caused |
|---|---|---|
| `keycardlock` | inventory holds `keycard_<doorId>` | `cmdInstallLock` mints exactly ONE card — dropped, lost to a corpse or stolen and the deed holder is out of their own unit **forever** |
| `privacylock` | "am I standing on the private side" | any visitor could throw the bolt and shut the owner out from the street; not hackable either (`hackDoor` is hololock-only) |
| any | — | an NPC arriving at `home_zone` locks whatever door it just used ([ai-behaviour.js](../server/engine/ai-behaviour.js)), so a roommate NPC could bolt a player's own door |

It grants **auth, not passage**: `lockTypePassesWhileLocked` is a separate question, so a manual bolt
still has to be physically undone — the resident can always *unlock* it, and can never be left with no
way in. That's what keeps a privacy latch meaningful. Covered in
[plugins/doors/regress.js](../plugins/doors/regress.js), which asserts both layers: the raw registry
still refuses, and `checkLockAuth` grants anyway.

### Privacy lock (`privacylock`)

A bathroom-stall bolt. Its `authFn` is purely positional: **anyone standing on the door's `privacySide` can lock *and* unlock it**; the far side is shut out while it's occupied. `privacySide` (a zone id, stored on the lock tag) is resolved when the lock is placed — `detectBathroomSide(door)` in [doors.js](../server/engine/commands/doors.js) picks whichever side holds a `toilet` furniture (so "connects to a bathroom" ⇒ unlock from the bathroom side). When **neither** side (or **both**) has a toilet the save is rejected and the builder must set the side explicitly via the door editor's **lock-side switch** ([zone-subeditors.js](../client/devpanel/js/panels/zone-subeditors.js), resolved server-side in `apiUpdateDoor`). Not hackable (no `canHack`); bashing the door is the only forced entry. A `schedule('10m')` sweep in the doors plugin springs every engaged privacy lock — a courtesy release so a player who fell asleep in a public stall doesn't seal it forever.

### Long Watch blast door (`longwatch`)

The Long Watch bunker's reputation-gated blast door — the **first lock type whose auth is live faction
reputation** rather than a key, position, or owner. Its `authFn` reads `player_ideology_rep` for
`ideology_long_watch` (the same read the ATM network gate runs) and opens only at the **`trusted` tier
floor** (`reputation >= 500`, `LW_TRUSTED_REP`). Because the gate re-reads rep every time, it is *live*:
earn trust through the vetting arc and the door knows you; betray the Watch and your standing falls back
below the line and it stops opening. `canHack: false` and the door is marked unbreakable in content —
**there is no lockpick or bash path in, by design**. Denied entry reads *"The blast door does not know
you. It does not move."*

### Hacking a lock (`hack`)

Any lock type whose `defaults` include `canHack: true` (currently just `hololock`) can be bypassed without the normal `authFn` check by hacking it. Implemented in [doors.js](../server/engine/commands/doors.js) (`cmdHackLock` / `cmdHackResolve`), same client/server split as the ATM and security-device hacks (see [systems-atm.md](systems-atm.md)) but with its own **HOLOLOCK BYPASS** minigame — an electronic pin-tumbler lockpick ([client/game/js/panels/hololock.js](../client/game/js/panels/hololock.js)), distinct from the ATM's Circuit Breach:

1. `hack [door] [dir]` arms the attempt — no skill roll gates it, just the lock's `canHack` flag, **carrying any item tagged `hack_device`** (the capability tag, not a specific item id — same gate as the ATM jack; see [tags.md](tags.md)), the apartment's forcefield being down (a sleeping owner's quantum shield makes the lock unhackable), and a per-player 5 **game**-minute lockout after a failure. Returns `{ type: 'hololock_game', resolveCmd: 'hackresolve', doorId, skill, difficulty, … }`, which opens the lockpick minigame client-side (set each tumbler pin while its scanner is in the sweet zone before the feedback meter fills; skill vs. difficulty scales pin count, sweet-zone width, scanner speed, and miss penalty).
2. **The moment the attempt starts** (not on resolve), the lock panel's whine is broadcast directly to the zone(s) on the *other side* of that specific door — bypassing the normal `propagateSound` muffling, which would otherwise treat the door being hacked as also deadening the sound of itself being worked on. Anyone on the far side always hears "A faint electronic whine buzzes from the door — someone is working the lock," regardless of distance/loudness physics.
3. `hackresolve <doorId> <1|0>` — silent; the minigame's own win/loss is authoritative, validated against a per-player pending-arm record (anti-spoof, 180 s TTL). A win **unlocks the door persistently** (via `updateDoor`, which mirrors to `apartments.is_locked`), awards hacking XP, and emits `hololock.breached` → the surveillance plugin raises the **`burglary`** crime (2★, `witness: 'any'` — caught by a live camera, on-duty cop, or bystander). A loss sets the 5-minute lockout.
   - **Resident owner present → guaranteed report.** If an NPC whose `home_zone` is the room on the far side of the door is standing in it when you break in, they witness it and call the cops on the spot: `hololock.breached` carries `ownerWitness: true`, and the surveillance listener passes `forced` to `raiseCrime`, bypassing the generic camera/cop/bystander witness sweep. `residentOwnerInResidence` (doors.js) resolves the resident by `home_zone` matching the specific unit, so it never matches an NPC merely passing through or homed to a shared lobby.

Registered as a `hack` specialized action in the doors plugin. Falls through (`undefined`) whenever there's no door here or its lock isn't hackable, so it composes with other plugins' `hack` targets (e.g. vendor safes, [plugins/vendor-safe/index.js](../plugins/vendor-safe/index.js)) via normal dispatch fallthrough — plain `commands` run before specialized actions, so vendor-safe also falls through when there's no safe in the zone, and a final `hack` builtin in `commands/index.js` catches the case where nothing here is hackable at all.

## Tunables

[tunables.js](../server/engine/tunables.js) caches the `combat_config` table at first use
(`ensureTunables`). `getTunable(key, default)` returns the cached value or the default. The dev panel
edits these rows and calls `reloadTunables()`. Combat, skills, and IP all read their balance knobs here
(body-part weights, crit/dodge/soak factors, learn rates, stat-cost curve). See [combat.md](combat.md)
for the specific keys.
