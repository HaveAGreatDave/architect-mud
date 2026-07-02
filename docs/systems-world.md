# World, Ambience, Sound & Scheduling (As Built)

Live world state, zone navigation, ambient events, sound propagation, spawning, the minimap, the
scheduler, and balance tunables. Primary files: [world.js](../server/engine/world.js),
[sounds.js](../server/engine/sounds.js), [scheduler.js](../server/engine/scheduler.js),
[tunables.js](../server/engine/tunables.js), [commands/describe.js](../server/engine/commands/describe.js),
[commands/movement.js](../server/engine/commands/movement.js).

## In-memory world state

[world.js](../server/engine/world.js) holds the live mirror of the DB (the DB remains source of truth):

```
world = { zones, players, enemies, npcs, corpses, spawnTimers, apartments }   // all Maps
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
danger/RAD/PVP tags, building-discovery flavour, apartment status, the Custodian outcast/turret
response, ground items, furniture, windows, exits, other players, NPCs, enemies, and corpses. It fires
the `zone.describeRoom` plugin hook for optional injected prose.

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

The clock is a single `world_clock` row (`id = 1`). `state.minutes` is minutes-since-midnight (server-authoritative), advanced 1:1 with real time. On boot `initEnvironment` catches up on downtime: whole missed days replay `tick24h` (capped at `MAX_CATCHUP_DAYS = 30`), then `state.minutes` jumps forward by the exact elapsed minutes.

- **Phase** (`phaseForMinutes`): `dawn` 05:00–07:00, `day` 07:00–17:00, `dusk` 17:00–20:00, `night` 20:00–05:00 (wraps midnight). `ambientLightForMinutes` returns 1.0 in day, 0.0 at night, and ramps 0↔1 across dawn/dusk. `diurnalOffset` is a cosine temp swing peaking +5°C at 14:00, troughing −12°C at 02:00 (amplitude 8.5, midpoint −3.5), added to the base `state.tempC` everywhere temperature is read.
- **Season** (`seasonForDate`): derived from calendar month via `SEASON_BY_MONTH`.

### Tick cadences

Scheduled in `scheduleTicks` off [scheduler.js](../server/engine/scheduler.js):

- **1m** (`tick1m`) — increment minute, persist, `stepIndoorTemps`, broadcast `environment.clockTick` + per-zone `environment.zoneTempTick`, flicker overloaded zones.
- **30s** — `advanceWeatherField()` (advect the field one step), `broadcastZoneWeather(occupied)` to occupied outdoor zones, and snap streetlights for those zones (in-memory; no DB writes).
- **5m** (`tick5m`) — brownout redistribution; only runs when ≥1 zone is `overloaded`.
- **30m** (`tick30m`) — recompute `ambientLight`/`phase`, reconcile streetlights map-wide (`syncStreetlights` → lights on where powered and `zoneAmbientVisibility < VISIBILITY_DIM = 0.35`), roll global precip on/off against `forecast[0].precipChance`, broadcast `environment.sync`, fire `environment.tick30m` / sunrise / sunset hooks.
- **24h** (`tick24h`) — advance calendar, fire `environment.advanceWeather` (plugin shifts the forecast and re-seeds the field), run the power sim, broadcast `environment.daily`.

### Forecast (plugin-owned, seeded, 7-day)

`generateWeatherForDate(dateStr, climateProfile)` is deterministic: a `mulberry32` PRNG seeded off `"weather:<date>"`. Each day yields `{ weatherType, tempC, precipChance, windKph, humidityPct }`:

- **Type** from a precip roll (`precipTypeForTemp` → rain/thunderstorm/sleet/snow/blizzard by temp) or, on dry days, overcast/cloudy/fog/haze/clear scaled by `precipChance`.
- **Temp** = monthly/seasonal base ± variance (±10°C normally, ±20°C on a 5% "extreme" day).
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

`stepIndoorTemps` (every 1m tick) drives each indoor zone (`is_interior` / `is_apartment` / `is_building`) toward a target. **Powered** zones head to `INDOOR_HVAC_TARGET_C = 20`°C at `INDOOR_HVAC_RATE_PER_MIN = 2.0`°C/min (heating or cooling, ~10 min from an extreme). **Unpowered** zones drift toward the current outdoor temp by **passive conduction proportional to the indoor↔outdoor gap** (`step = (outdoor − current) × INDOOR_PASSIVE_CONDUCTION`, `= 0.01`): ΔT=10°C ≈ 0.1°C/min (the old flat rate), but ΔT=50°C bleeds at ~0.5°C/min — so a mild outage stays survivable while a blackout in an extreme cold snap or heatwave becomes lethal (**no free safe haven**; a −30°C snap drops an interior to 10°C in ~23 min, 0°C in ~51 min). Per-zone temps live in `state.zoneTemps`, seeded at boot by `initIndoorTemps`, and are read via `getZoneTemperature`.

## Spawning & corpses

`tickSpawns` (every 10s) joins `zone_spawns` with `enemies`, and for each timer that's due, spawns if the
live count of that template in the zone is below `max_count` and a `Math.random()×100 < spawn_weight`
roll passes; then it reschedules `nextSpawn` by `respawn_seconds`. `cleanCorpses` (every 30s) expires
corpses past their `expiresAt`.

> **Dead system:** `createCorpse` has no callers, so the corpse Map is never populated — see
> [combat.md](combat.md). `cleanCorpses` and corpse rendering run against an always-empty set.

## Minimap

`getMinimapData(centerZoneId, depth=4)` BFS's exits up to 4 hops, staying within the same `map_id`
(so interiors and exteriors don't bleed into each other), and returns node snapshots (grid coords,
markers, colours, danger, player counts) for the client's 5×5 ASCII grid. `cmdMap` returns the full
same-`map_id`/same-`grid_z` tile set for the full-screen map popup.

## Scheduler

[scheduler.js](../server/engine/scheduler.js) is the single interval dispatcher. Named cadences
(`10s, 15s, 30s, 45s, 1m, 5m, 30m, 24h`) each own one `setInterval`; multiple callbacks share it, and errors
in one callback are caught and logged without killing the timer. The **1-second combat tick is
deliberately not on the scheduler** — it's the latency-critical hot path and uses a raw `setInterval`
in `gameLoop.js`. Plugins and the environment system subscribe via `schedule()`.

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

`CHANNEL_DEFS` is the definition registry (id, `permanent`, `systemOnly`, `isMember(player)`). New channels are added here.

- `getPlayerChannels(player)` — the channels a player should subscribe to on login.
- `sendToChatChannel(channelId, msg, broadcast)` — send to all eligible online players.
- `saveChannelMessage(channelId, msg)` / `getChannelHistory(channelId)` — persist and replay last 50 messages per channel (stored in `channel_history` table).

## Appearance

[appearance.js](../server/engine/appearance.js) — character physical description, generated once at character creation and stored on the player row.

- `generateAppearance()` — returns a random appearance object: `{ hair_style, hair_length, hair_color, eye_color, height, weight, biological_sex }`. Hair length is constrained by style (mohawks can't be very long, etc.).
- `describeAppearance(player)` — builds a prose description string from the stored appearance fields for use in `look <player>` output.

## Locks

[locks.js](../server/engine/locks.js) — extensible lock type registry. Separates lock *type* definitions from the *auth logic* that resolves whether a player can open a given lock.

- `registerLockType(shortName, { tagType, kitTag, defaults, authFn })` — registers a lock type. The doors plugin calls this for `hololock`, `keypad`, etc.
- `resolveLockAuth(lockTag, door, player)` — dispatches to the auth function registered for `lockTag.type`. Returns `true` if the player is authorized.
- `getAllLockTypes()` — used by the dev panel's door editor to populate the lock type dropdown.

Lock type definitions live in the doors plugin ([plugins/doors/index.js](../plugins/doors/index.js)); the lock registry in `locks.js` is the extensibility seam, not the implementation.

## Tunables

[tunables.js](../server/engine/tunables.js) caches the `combat_config` table at first use
(`ensureTunables`). `getTunable(key, default)` returns the cached value or the default. The dev panel
edits these rows and calls `reloadTunables()`. Combat, skills, and IP all read their balance knobs here
(body-part weights, crit/dodge/soak factors, learn rates, stat-cost curve). See [combat.md](combat.md)
for the specific keys.
