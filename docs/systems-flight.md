# Flight System — As Built (Phase A)

> Status: **Phase A vertical slice built 2026-07-03.** This is the running source
> for flight *as actually built*. The full locked design (all phases A–D, the six
> aircraft, purpose systems, combat, hangars) lives in the blueprint:
> [docs/proposals/systems-flight.md](proposals/systems-flight.md). Read that for
> intent; read this for what exists.

## What Phase A gives you

Stand at an airfield, `board` a parked aircraft, `startup`, set a `throttle`,
`takeoff` through an interactive rolling-acceleration bar, fly over the
`map_world` tile grid on a real-time tick loop (heading / throttle / altitude
bands / fuel burn), and `land` through an interactive glideslope minigame. Run the
tank dry and it's a lethal dead-stick crash that leaves a salvageable wreck.

**Live content:** one airfield (The Marshalling Yard, flagged, city-edge freight
yard at 7,−1, named *Coldwater Regional (Marshalling Field)*) and one rentable
**Dragonfly** scout heli, full tank, parked there.

## Architecture (the load-bearing decisions)

### The aircraft is a first-class object that owns its occupants
There is **no cabin `zones` row** — runtime zone creation would break the
"content is deliberate" rule. Instead:
- `aircraft` table = per-craft runtime state (position, fuel, throttle, band,
  heading, damage, airborne/engine flags, wreck flag). Schema exported, rows
  production-owned (like `generators`/`atm_units`).
- `aircraft_types` table = per-template **content** (Dragonfly, …): tank, burn,
  speed, ceiling, seats, hull, handling, noise, prices. Seed/dev-panel editable.
- "Being aboard" is **player state**: `player.aircraftId` + `player.seat`
  (`pilot` | `passenger`). The plugin keeps an in-memory `liveAircraft` registry
  where each craft owns an `occupants` Set (mirrors live-zone membership).
- The cockpit the player sees is **synthesized** from the live aircraft object and
  pushed as a `cockpit_update` HUD payload each tick — not rendered from a zone.

### The sky is a computed overlay
An airborne craft carries its own `(grid_x, grid_y, altitude_band, heading)`.
Flying advances `x/y`; the "view below" is read from the `map_world` zone at that
coord via a cached coord index (`surfaceAt(x,y)`); **empty cells = open air**
(fly-over, no obstacle). Zero content cost, stays correct as the map grows.

### Real-time tick loop (the machine feel)
`posture === 'flying'` on the pilot is the activity flag (inherits engine
force-stand interruptions for free). A `setInterval` (~3s) ticks each airborne
craft: **advance** along heading at throttle → **burn** fuel (scaled by throttle ×
altitude band) → **thermal** drift → **starvation** check → **emit** HUD to
occupants + engine noise to the surface zone below. Modeled on the
fishing/scavenging posture loops.

### Takeoff & landing are interactive, server-authoritative
Both are minigames armed with an anti-spoof token (fishing-reel pattern):
- **Takeoff** (`flight_takeoff` → `takeoffresolve`): a rolling-acceleration bar —
  reach rotation speed before the strip runs out.
- **Landing** (`flight_land` → `landresolve`): a glideslope channel — hold the
  craft inside the drifting glidepath, then FLARE at touchdown. Emergency
  (dead-stick) landings are narrower and faster.

Piloting skill vs. computed difficulty (handling + damage + emergency) **widens or
narrows the band**; the client renders, the server decides. A botched landing does
hull damage; enough damage → crash. A crash kills everyone aboard
(`handlePlayerDeath`) and turns the craft into a wreck at the surface cell.

## Player-facing surface

**Verbs** (`plugins/flight`): `board` · `disembark`/`deplane` · `startup` ·
`shutdown` · `throttle <0-100>` · `heading <dir>` · `climb` · `dive` · `takeoff` ·
`land` · `refuel [amount]`. Bare compass verbs set heading **only while airborne**
(input matcher; falls through to the ground mover otherwise).

**Piloting skill** (`server/engine/skills.js`, tech, Reflexes+Brains): every
startup/takeoff/landing/climb runs `skillCheck`/`awardSkillUse`.

**Move gate** (`flight`): you can't walk while aboard an aircraft (airborne or
parked) — `disembark` first.

**Client** (`client/game/js/panels/cockpit.js`) — dressed in the shared minigame
hardware idiom (Vault Crack / Circuit Breach / the reel), all display-only:
- **Area-pane avionics HUD:** a graphical **artificial horizon** (SVG, pitched by
  altitude band), a rotating **compass card**, a **5×5 moving-map** nav display
  (the server pushes a `map` window each tick; north-up, craft glyph oriented by
  heading, land/air cells + a radar sweep), colour-graded **FUEL/THR/HULL/ENG**
  gauges, an ALT/SPD/HDG/surface-below readout, and a flashing warning strip.
  Parked shows a pre-flight checklist; passengers get a stripped window view.
- **Takeoff deck** (`flight_takeoff`): full `mg-chassis`/`mg-bezel`/`mg-screen`
  with a perspective **runway** SVG (scrolling centreline, Vr gate, sliding
  craft), an airspeed tape, and a live `deckStrip` (RWY-used tension).
- **Glideslope deck** (`flight_land`): an **ILS/attitude instrument** — a pitching
  + banking horizon, a fixed aircraft reference, a right-hand glidepath diamond to
  keep centred, a growing runway, a `deckStrip` deviation meter, and a FLARE arm.
- **SFX:** a `flight` group in `client/shared/sfx-catalog.js` (engine start, roll,
  rotate, abort, warble, approach, flare, touchdown, crash) — dev-panel editable.

Routed in `dispatch.js` (`cockpit_update`/`cockpit_close`/`flight_takeoff`/
`flight_land`). UTF-8 box glyphs preserved.

## Files

- **New:** `plugins/flight/` (index.js, plugin.json, regress.js, README.md),
  `client/game/js/panels/cockpit.js`, `scripts/seed-flight.js`, this doc.
- **Edit:** `server/models/schema.js` (`aircraft` + `aircraft_types` in
  `SCHEMA_SQL`), `server/engine/skills.js` (Piloting),
  `client/game/js/dispatch.js` (4 message routes), `docs/plugins.md`.

## Go-live steps

1. `npm run db:schema` — create the two tables (idempotent).
2. `node scripts/seed-flight.js` — Dragonfly type + rental + airfield flags.
3. Reload the world (`POST /api/world/reload`) or restart — the airfield zone
   flags take effect.
4. Stand in The Marshalling Yard → `board` · `startup` · `throttle 60` · `takeoff`.

## Not built yet (Phase B+)

Rich hazards (stall/fire/weather buffeting hooked to the extreme-weather severity
scalar), the aerial minimap + full moving-map nav display, artificial horizon,
no-fly airspace enforcement (the move-gate/interception ladder), authored
special-airspace zones, cargo/passenger contracts, air-to-ground/air-to-air combat
+ AA sites, hangars-as-housing, wreck-salvage repair, aircraft mods/tuning, comms/
ATC, the other five aircraft, and the six authored airfields. See the blueprint's
phase map for the boundary.
