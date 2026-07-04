# flight (plugin)

**Phase A vertical slice** of the flight system. Full design: [docs/systems-flight.md](../../docs/systems-flight.md) (as-built) and [docs/proposals/systems-flight.md](../../docs/proposals/systems-flight.md) (the locked blueprint).

## Purpose

Board a parked aircraft, spin up the engine, take off through an interactive
rolling-acceleration minigame, fly over the `map_world` tile grid on a real-time
posture tick loop (heading, throttle, altitude bands, fuel burn), and land through
an interactive glideslope minigame.

The aircraft is a **first-class object that owns its occupant set at runtime** —
there is deliberately **no cabin `zones` row** (that would violate "content is
deliberate, never created at runtime"). "Being aboard" is player state
(`player.aircraftId` + `player.seat`); the cockpit HUD is **synthesized** from the
live aircraft object and pushed to occupants each tick as a `cockpit_update`
message. The sky is a **computed overlay**: an airborne craft carries its own
`(grid_x, grid_y, altitude_band, heading)` and the "view below" is read from the
surface zone at that coord (empty cells = open air).

Fuel-out is a lethal **dead-stick crash** (per normal death rules) that leaves a
salvageable **wreck** row at the surface cell. Piloting skill gates every
startup / takeoff / landing and widens the minigame safe bands.

## Commands

`board` · `disembark` / `deplane` · `startup` · `shutdown` · `throttle <0-100>` ·
`heading <dir>` · `climb` · `dive` · `takeoff` · `land` · `refuel [amount]` ·
`takeoffresolve` / `landresolve` (silent — the minigame overlays report their outcome).

Bare compass verbs (`n`/`north`/…) are intercepted by an **input matcher** only
while the pilot is airborne (they set heading); otherwise they fall through to the
normal ground mover.

## Seams

- **commands** — the verbs above (declared in `plugin.json`).
- **input matcher** — cardinal-while-airborne → set heading.
- **move gate** (`flight`) — you can't walk while aboard an aircraft (airborne or parked); `disembark` first.
- **tick** — a `setInterval` airborne loop (advance / burn / thermal / starvation / emit), the fishing/scavenging posture-loop pattern.
- **engine reuse** — `skillCheck`/`effectiveSkill`/`awardSkillUse` (Piloting), `setPosture`/`forceStand` (`flying`), `handlePlayerDeath` (crash), `sendToPlayer`/`sendToZone`.

## Data

- `aircraft_types` — CONTENT: one row per craft template (Dragonfly, …). Seed/dev-panel editable.
- `aircraft` — RUNTIME: one row per physical craft. Schema exported, rows production-owned.
- `zones.flags.airfield_id` / `airfield_fuel` — a zone opts in as an airfield (zone-flag pattern).

Schema lives in `SCHEMA_SQL` (apply via `npm run db:schema`); content via
[`scripts/seed-flight.js`](../../scripts/seed-flight.js).

## Client

[`client/game/js/panels/cockpit.js`](../../client/game/js/panels/cockpit.js) —
area-pane gauge HUD + the rolling-takeoff and glideslope-landing minigames.
Routed in `client/game/js/dispatch.js` (`cockpit_update` / `cockpit_close` /
`flight_takeoff` / `flight_land`). All display-only; the server is authoritative.

## Not yet (Phase B+)

Rich hazards (stall/fire/weather buffeting), the aerial minimap + moving-map
nav, no-fly airspace enforcement, cargo/passenger contracts, air combat + AA,
hangars, wreck-salvage repair, the other five aircraft, and the six authored
airfields. See the as-built doc for the boundary.
