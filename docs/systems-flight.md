# Flight System — As Built (Phases A–D)

> Status: **Phases A–D built 2026-07-03.** This is the running source for flight
> *as actually built*. The full locked design lives in the blueprint:
> [docs/proposals/systems-flight.md](proposals/systems-flight.md). Read that for
> intent; read this for what exists.

## Plugin layout (multi-file)

`plugins/flight/` is composed of a wiring hub + shared state + one module per system:
- **state.js** — the shared substrate: the live-aircraft registry (the aircraft
  owns its occupant set), the computed-overlay coord index (`surfaceAt`), the
  synthesized HUD payload, `effStats` (tune + weight-&-balance → effective numbers),
  and the `parkAt` / `crash` transitions. Every module imports this.
- **index.js** — the verbs (board/startup/throttle/heading/climb/dive/takeoff/land/
  refuel) + the airborne tick loop + move gate + cardinal input matcher + no-fly.
- **hazards.js** — Phase B hazards + emergency/utility verbs.
- **combat.js** — AA fire + the armed gun pass.
- **contracts.js** — the freight economy.
- **hangars.js** — ownership: hangars, repair, salvage, rebuild, tuning.
- **acquisition.js** — charter / buy / refuel.

## Six airfields (live)

Flagged onto fitting zones (the `zones.flags.airfield_id` pattern):

| Field | Zone | Services |
|---|---|---|
| Threshold Helipad | The Threshold (0,0) | charter · avgas/jet |
| **Coldwater Regional** | The Rust Quarter (−2,0) | **dealer + charter** · all fuels |
| Marshalling Field | The Marshalling Yard (7,−1) | charter · avgas/jet |
| Slagworks Strip | Slagworks Gate (−8,0) | charter · avgas/biofuel |
| Redline Airstrip | The Scald (−5,−6) | derelict · biofuel only |
| Smuggler's Slip Pad | Smuggler's Slip (4,−3) | charter · avgas/biofuel |

Six aircraft types seeded (Mayfly · Dragonfly · Mule · Leviathan · Reaper · Carcass),
three fuel types (avgas/jet/biofuel), standing charter rentals at several fields,
three ground AA sites (Redline/Wastes/Slagworks), a Core no-fly cluster, and one
downed Carcass to salvage/rebuild. Content: [`scripts/seed-flight.js`](../scripts/seed-flight.js).

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

## Phases B–D as built

**Phase B — hazards & instruments** (`hazards.js`). The tick loop calls
`rollHazards()`: **STALL** (high + slow → buffet → stall → spin → crash, cleared by
`recover` after powering up) and **ENGINE FIRE** (overheat → fire, cleared by
`extinguish`/`cut fuel`) are persistent escalating ladders; **WEATHER buffeting**
(hooked to `getZoneSeverity`, amplified by altitude) and **BIRD STRIKE** (low/slow)
are one-shot per-tick events. Utility verbs: `preflight`, `hover` (VTOL), `spot`
(aerial spotting → wrecks/AA on the ground), `chart` (dead-reckoning + nearest
field + fuel range), `squawk` (transponder; running dark evades cameras but is a
crime), and `eject`/`bail` (parachute-gated — a pilot bailing dooms the craft).

**No-fly enforcement** (`index.checkAirspace`). Over an `airspace_restricted` cell:
tower warning → `WANTED_RAISE` (+2) + interceptor scramble message. No-fly cells
render as a red hatch on the moving-map.

**Phase D — contracts** (`contracts.js`). A field's board lazily tops up to ~3
open jobs (cargo/passenger, origin→dest airfield, weight, deadline, risk stars,
payout = distance × weight × risk). `accept` loads weight onto the craft (fed
through `effStats` → takeoff difficulty + fuel burn + an overweight gate);
`manifest` tracks active jobs; delivery is detected on landing at the destination
(on-time = full, late = half). Contraband jobs pay ~1.8× but want you dark.

**Phase D — combat** (`combat.js`). `tickCombat()` each airborne tick: AA sites in
range fire on low/slow overflights (altitude, speed, `evade`, and a piloting jink
cut the hit chance); a hit walks the hull-damage ladder → breakup → `crash`.
`arm`/`safe` toggle weapons (hardpoints only); `strafe`/`fire` arms the **targeting-
reticle deck** (`flight_target` → `strafresolve`) to silence a site.

**Phase D — ownership** (`hangars.js`). `hangar rent/store/pull` (stored = theft-
proof; an owned craft on an open ramp can be stolen — grand theft, +3 stars);
`repair` (Fabrication + credits); `salvage` a wreck for scrap; `rebuild` a Carcass
(Fabrication + Chemistry + 1500c → a random flyable type); `tune` mixture/pitch/
boost/CG curves (Fabrication widens the safe range) feeding `effStats`.

**Acquisition** (`acquisition.js`). `charter <type>` rents, `buy <type>` purchases
at a dealer field (`buy` routes back to commerce for ordinary shopping).

**Client** — the HUD gains a no-fly map hatch + ARMED indicator; a fourth
**targeting** deck joins takeoff/glideslope (all shared chassis + `flight` SFX).

## Verb-collision routers

Flight wins several verbs by manifest `after` and delegates by context:
`board`→gametable (poker), `refuel`→generator, `buy`→commerce, `eject`/`tune`→
broadcast, and `repair` falls through to the engine gear-repair builtin off-context.

## Still lighter / follow-on

Full PvP air-to-air (the AA/reticle seam exists; player-vs-player interception is a
message today), authored storm-cell/offshore special-airspace *content*, comms/ATC
channel flavor, corp-owned aircraft + insurance, and discrete parts-as-items slots
(the continuous tune curves are in). See the blueprint.
