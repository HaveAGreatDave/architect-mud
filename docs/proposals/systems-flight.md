# Flight System — Design Blueprint (Exploration)

> Status: **BUILT** (stamped 2026-07-24 by doc audit; was "design exploration, not yet
> committed to build"). Flight shipped as `plugins/flight/` (14 modules) and was then
> overhauled onto a continuous energy model — see
> [docs/systems-flight.md](../systems-flight.md) for the as-built system (note the
> filename collision: that doc, not this one, is the running source) and
> [flight-overhaul.md](flight-overhaul.md) for the overhaul. This doc remains the
> **original locked design** — read it for intent and the fork table, never for behaviour.
>
> This is the agreed shape of an
> Architect flight/aircraft system borrowing HellMOO's overworld-aircraft concepts and adapting
> them to Architect's room-graph world. Sequenced to land alongside the Coldwater expansion.

## Context

The user wants a flight system that feels like **operating a machine** with genuine **freedom of
movement**, in the HellMOO tradition (cockpit-as-room, control verbs, altitude, fuel/skill tension,
brutal + funny crashes). HellMOO flies aircraft across a coarse **overworld tile field** that sits
apart from fine-grained room movement. Architect has no overworld and no vehicle/occupancy model at
all — zones are a discrete **exits graph** with only a loose spatial grid (`grid_x/grid_y/grid_z`,
`map_world` = z0 surface) underneath. The whole design problem is giving flight a *spatial, machine-like*
feel without an authored continuous world and without a vehicle system to extend.

### Decisions locked with the user

| Fork | Decision |
|---|---|
| What flight traverses | **Overworld sky-layer** (spatial, not menu fast-travel) |
| Sky representation | **Hybrid** — computed overlay + a few authored special-airspace zones |
| Sim depth | **Rich cockpit** (throttle/altitude/heading/fuel/stall/damage/instruments) |
| Purpose | **All four** — fast travel, cargo/economy, combat, exploration |
| World-size timing | **Flight is the reason to build Coldwater** — design now, ship with the expansion |
| Acquisition | **All four** — buy, rent/charter, salvage wrecks, corp/faction assets |
| Lethality | **Brutal everywhere** — HellMOO-lethal weather/fuel/failure/hostiles |
| Time model | **Real-time tick loop** (a `flying` posture loop like fishing/scavenging) |
| Occupancy | **Pilot + passengers**, with the state model built to **support full crew seats later** |
| Crash stakes | **Lethal + craft destroyed** — pilot/passengers can die, craft becomes salvageable wreck |
| Centrality | **Headline pillar** — a marquee system alongside combat/economy; build the full rig |
| HUD fidelity | **Hybrid** — graphical tilting horizon + smooth moving map, glyph/box-art gauges |
| Passenger view | **Window view** — passengers get the moving map only, no gauges/controls, by seat |
| Platform | **Desktop-first, mobile-playable** — d-pad maps to controls, simplified/assisted touch landings; rich experience on desktop |
| PC controls | **Mouse + keyboard hybrid** — pointer for glideslope/reticle/map/sliders (doubles as mobile touch), keyboard hotkeys for throttle/heading, typed bar for discrete verbs |
| PvP shootdowns | **Open everywhere** — any craft downable anywhere; city/Core just means faster/harsher police response |
| Parked security | **Hangar-safe, open-lot vulnerable** — secure in a hangar; boardable/stealable/strippable on an open ramp (a crime) |
| Ground-to-air | **AA sites + armed players** — NPC emplacements and grounded players can hit low/slow overflights |

## Core architecture

### 1. The aircraft as a first-class object (new)

There is no occupancy model today, so the aircraft is a new persistent entity carrying its own flight
state. Store it in a new `aircraft` table (deliberate schema addition — one-shot script **and** edit
`SCHEMA_SQL` in [server/models/schema.js](server/models/schema.js); never a boot migration):

- identity: `id`, `type` (references an aircraft-type template), `owner_id` / `corp_id`, `name`/tail number
- location: `grid_x`, `grid_y`, `altitude_band`, `heading`, `parked_zone_id` (null when airborne)
- machine state: `fuel`, `throttle`, `engine_temp`, `damage`, `condition`, `airborne` bool
- cabin: **NO per-aircraft `zones` row.** Runtime zone creation conflicts with the project's
  "content is deliberate, never created at runtime" rule (**verified** against `docs/architecture.md` —
  apartments are pre-authored, there is no runtime-zone precedent). Instead the **aircraft object owns
  its occupant set** (its own membership list, mirroring the live zone-membership sets); "being aboard"
  is player state (`player.aircraftId` + `seat`). The cabin "room" a player sees is **synthesized from
  the aircraft object** (cabin description + co-occupants + HUD/window view), not from a zone. Crew
  *seats* (pilot/gunner/nav) are the `seat` field: pilot+passengers now, crew roles slot in later. This
  keeps the whole aircraft a synthesized context — consistent with both the "deliberate content" rule
  and the computed-overlay philosophy.

Aircraft-type templates (ultralight, scout heli, bush plane, heavy lifter, gunship, wreck) are
**content**, not engine — a small template table or seed, defining tank size, cargo, VTOL vs runway,
altitude ceiling, weapon hardpoints, handling modifiers. Keep it out of engine files.

### 2. The sky as a computed overlay (hybrid)

Do **not** author a sky zone per surface cell per band. Instead, an airborne aircraft's position is
its own `(grid_x, grid_y, altitude_band, heading)`. Flying a cardinal mutates `x/y`; the "view" is
**synthesized** from the surface zone at the same `(x,y)` on `map_world` (name, terrain, weather,
who/what is below), degraded by altitude. This reuses `grid_x/grid_y` as a real coordinate field,
carries zero content cost, and stays correct as the surface map grows. **Verified:** `grid_x/grid_y` are
populated + actively used on `map_world`; cells with no zone (water, gaps) read as **open air —
fly-over, no obstacle.**

The **hybrid** part: a small set of **authored special-airspace zones** layered on top for places that
need bespoke content — restricted police airspace over the Core, storm cells, an aerial landmark, the
offshore approach. These are real zones flagged as airspace; when the aircraft enters their `(x,y)`
they override the synthesized view.

Reuse for the overlay: a small **`coordToZone(map_id, grid_x, grid_y)` lookup** — cache `map_world`
zones by coord at boot (the dev-panel map editor `client/devpanel/js/panels/maps.js` already builds
exactly this `byCoord` map, and the weather sampler already queries by coord — **verified feasible**);
`getMinimapData` ([server/engine/world.js](server/engine/world.js)) style BFS for an **aerial minimap**
(wider radius at higher bands); and the `describeZone` light/weather gating in
[server/engine/environment.js](server/engine/environment.js) for the synthesized look-out text.

### 3. Altitude bands (the up/down axis with teeth)

`ground → low → cruise → high`. `climb`/`dive` step between bands (piloting-checked, burns fuel).
- higher band = overfly ground obstacles/threats, wider aerial minimap, faster ground-coverage
- higher band = stronger wind/weather buffeting (hooks the extreme-weather severity scalar) and you
  **cannot land** — must be `low` over an airfield cell to `land`
- `ground` is the transitional band at an airfield for takeoff/landing rolls

### 4. Real-time tick loop (the "machine" feel)

A `flying` posture/activity loop modeled on the fishing/scavenging posture loops
([plugins/fishing/index.js](plugins/fishing/index.js), [plugins/scavenging/index.js](plugins/scavenging/index.js)).
Every few seconds the engine ticks each airborne craft:
- drain `fuel` scaled by throttle × altitude × wind; advance `(x,y)` at current throttle/heading
- roll hazards via `skillCheck(pilot, 'piloting', difficulty)`: stall (low throttle high band), fuel
  starvation, engine fire/overheat, bird strike, weather buffeting, hostile fire
- push updated gauges to the client cockpit panel; broadcast to cabin occupants

## Player-facing surface

### Verbs (new `plugins/flight/` plugin — verbs declared in its `plugin.json`)
`board` / `disembark`, `startup` / `shutdown`, `throttle <0-100>`, `climb` / `dive`, cardinal flight
while airborne, `heading <dir>`, `takeoff`, `land` (piloting-checked + fuel/altitude/airfield gated),
`refuel`, plus combat verbs for armed craft. Precedence: plugin verbs win over engine builtins — check
[docs/plugins.md](docs/plugins.md) before touching any existing verb.

### Client cockpit panel
New `client/game/js/panels/cockpit.js`, modeled on [client/game/js/panels/fishing.js](client/game/js/panels/fishing.js)'s
reel overlay: live gauges (altitude, airspeed, fuel, heading, engine temp, damage) armed when you're
airborne, disarmed on landing. Preserve UTF-8 glyphs.

### Piloting skill (pure data)
Add to `SKILLS` in [server/engine/skills.js](server/engine/skills.js):
`piloting: { id:'piloting', name:'Piloting', category:'tech', stats:['stat_reflexes','stat_brains'], desc:'…' }`.
Every takeoff/landing/hazard/maneuver runs through `skillCheck(player, 'piloting', difficulty)`.

### Move gate for no-fly / restricted airspace
Register a move gate ([server/engine/movement-gates.js](server/engine/movement-gates.js)
`registerMoveGate`) so entering restricted airspace (police no-fly over the Core) triggers a
wanted-raise / hostile response rather than silently allowing it.

## Deep-dive: cockpit verbs, gauge panel & aircraft templates

### Full verb set (grouped by flight phase)

**Pre-flight — parked at an airfield, engine cold:**
- `board [craft]` — enter the cockpit zone. `disembark` / `deplane` — leave (parked/landed only).
- `preflight` — inspect craft; a piloting check surfaces hidden faults (fuel leak, cracked rotor).
- `startup` / `shutdown` — spin up / kill the engine. Startup is a piloting check; damaged craft can
  flood, misfire, or refuse.
- `refuel [amount]` — at a field with fuel service; costs credits; `fuel_type` must match.
- `load <item>` / `unload <item>` — cargo hold; feeds **weight & balance** (affects takeoff + fuel).

**Takeoff — gated:** engine running · on a runway/pad cell that matches `takeoff_mode` · fuel ≥ reserve ·
weight ≤ strip's max-takeoff-weight. `takeoff` rolls piloting (difficulty scaled by weight, weather,
damage, strip length); success → airborne at `low` band. Overloaded/short-strip → abort or crash.

**Airborne — the tick-loop controls:**
- `throttle <0-100>` — power; trades speed vs fuel burn vs engine heat vs stall margin.
- `climb` / `dive` — step altitude band (piloting-checked, fuel cost). `level` — cancel climb/dive.
- bare cardinal or `heading <dir>` — set heading; the craft advances on each tick, not per-command.
- `hover` — VTOL only; hold position at high burn. `spot` / `scan` — **aerial spotting** (mark ground
  loot/wrecks for later retrieval; scavenging tie-in), resolution scaled by altitude + visibility.
- `look` / `look out` / `look down` — synthesized surface view (degraded by altitude & weather).
- `chart` — dead-reckoning nav plot: position (as good as instruments + weather allow), heading, drift,
  known beacons. `home <airfield>` / `tune <beacon>` — lock a homing beacon within range.
- `squawk <code>` / `squawk off` — transponder; running dark evades SPECTER cameras but flags a crime.

**Landing & emergencies:**
- `land` — `low` band over a valid cell (airfield; any cleared cell for VTOL/emergency), fuel for the
  flare; piloting check scaled by weather/damage/weight/approach. Botch → hard landing (damage) → crash.
- `recover` (stall), `extinguish` / `cut fuel` (engine fire), `eject` / `bail` (abandon aloft — parachute
  if equipped, else fall). These are the "brutal" high-stakes discrete prompts.

**Combat — armed craft only:** `arm` / `safe` (weapons hot/cold), `strafe <target>` / `fire <target>`
(one pass per fly-over, resolved by the existing combat engine), `flare` / `evade` (defend vs AA/lock).

### Cockpit gauge panel (client `cockpit.js`, fishing-overlay style)

Armed when airborne, disarmed on landing. Each gauge colour-codes green→amber→red; alert row flashes
on BINGO fuel / STALL / FIRE / OVERHEAT / LOCK. Illustrative layout (preserve UTF-8 box glyphs):

```
┌─ COCKPIT ── "Gnat-04" ───────────────────┐
│ ALT  ▲ cruise      HDG  N ↑      SPD  84  │
│ FUEL ███████░░░ 62%      ⚠ BINGO @ 20%    │
│ THR  ██████░░░░ 60%      ENG  118°C       │
│ HULL ▓▓░░░░░░░░ 18% dmg  XPDR ● 4721      │
│ WGT  ██████░░ 340/500    WIND →→ 15kt hdw │
│──────────────────────────────────────────│
│ ⚠ ASH HAZE — visibility low, fly on chart │
└──────────────────────────────────────────┘
```

Server pushes a compact gauge-state payload on each tick + on control input; the panel is display-only
(all authority server-side, per the source-of-truth rule — the panel never decides anything).

### Aircraft-type template (content, not engine)

One record per type (ultralight, Gnat scout heli, Mule bush plane, heavy lifter, gunship, salvaged
wreck). Lives in content (template table / seed), read by the flight plugin — never hardcoded in engine:

| Field | Meaning |
|---|---|
| `id`, `name`, `class` | identity; class ∈ ultralight/heli/prop/heavy/gunship/wreck |
| `takeoff_mode`, `strip_rating` | vtol / stol / strip; min strip length it needs |
| `seats`, `cargo_capacity`, `max_takeoff_weight` | crew+pax; hold mass; overload ceiling |
| `fuel_capacity`, `fuel_burn_base`, `fuel_type` | tank; base per-tile burn; avgas/jet/etc. |
| `altitude_ceiling`, `climb_rate`, `cruise_speed` | max band; how fast it changes band; tiles/tick |
| `handling` | piloting-difficulty modifier (agile heli vs ponderous lifter) |
| `hull_hp`, `hardpoints` | crash/AA durability; weapon slots (0 = civilian) |
| `avionics_grade` | instrument reliability + EMP vulnerability |
| `noise` | sound intensity for the stealth/`getSoundReach` tie-in |
| `price_buy`, `price_rent_hourly` | economy; where sold / rentable |
| `hangar_footprint` | size for hangar storage (housing reuse) |

## Live displays & flight-mode UI

Flight leans **hard** into live/interactive client displays — the system's whole pitch ("operate a
machine + freedom of movement") is a UI promise. All displays are **server-authoritative and
display-only** (state pushed each tick; the client never decides outcomes — source-of-truth rule).
Everything reuses existing client infrastructure: the fishing tension-bar overlay, the circuit-breach
SVG minigame, the full-screen map / TV popups, `getMinimapData`, and the custom-sidebar-panel system.

### Interactive takeoff & landing (the signature moment)
`land`/`takeoff` are **live minigames**, not dice rolls — in the fishing-reel / circuit-breach tradition.
- **Landing:** an approach/**glideslope** bar. Hold the craft inside the alignment band while wind,
  weight, and damage shove you off it; `flare` on cue at the bottom. Piloting skill **widens the safe
  band**; weather/overload/damage narrow it. Botch → hard landing (damage) → crash. A felt failure.
- **Takeoff:** a rolling-acceleration bar — reach rotation speed before the strip runs out; overloaded
  or short-strip means you don't, and abort or pile in.
- The check still runs underneath (piloting + modifiers), but skill sets the *difficulty of the bar*
  rather than replacing the play. **Recommended scope:** always interactive, but routine good-weather
  field landings use a wide/forgiving band so they're quick — the bar tightens only when it should
  (storms, damage, wastes strips, emergencies).

### The canonized live displays
- **Moving-map nav display** — the centerpiece. Live scrolling chart of the craft advancing tile-by-tile
  each tick: heading, fuel-range ring, locked beacons, and the surface below (degraded by altitude/
  weather). Presented **both ways**: a compact always-on sidebar strip that **expands to a full-screen
  chart** on `chart`/`map`. Reuses `getMinimapData` + the full-screen map popup.
- **Artificial horizon / attitude** — live tilt indicator during climb/dive/bank; altitude reads visually.
- **Combat targeting reticle** — live lock/reticle overlay for gunship strafing & air-to-air; drives the
  combat-engine wrapper.
- **Camera feed panel** — news/spy-chopper aircraft camera feeding a live view into the broadcast/TV
  display system.

### Flight-mode cockpit HUD in the top pane (the area pane)

**The client already has the perfect surface: the top pane (`#area-pane` / `#area-content`).** It's a
persistent, **resizable** region that today holds the room "look" and **already context-swaps its
content**; the **bottom pane (`#output`)** is the scrolling event log. So flight mode is a clean content
swap, not a risky takeover:

- **Top pane (`#area-content`) → live cockpit HUD** while airborne: moving map, gauge cluster,
  artificial horizon — always live, updated each tick. Can be **graphical** (SVG/canvas — precedent:
  `circuithack.js`, `vaultcrack.js`, `hololock.js` are SVG minigame panels) or glyph art. Player already
  controls how much screen it eats via the existing area-pane resize handle. `disembark`/land swaps it
  back to the room look.
- **Bottom pane (`#output`) → events**, unchanged: bird strikes, AA fire, tells, `#corp` chatter,
  landing results. This is the persistent-state-vs-events split, and the client is *already built this
  way* — no scrollback surgery, no coexistence problem.
- **Input bar unchanged** for discrete typed verbs (`board`, `refuel`, `squawk`, `arm`). Real-time /
  minigame control grabs **direct key input** in the HUD (see below).
- **Fidelity: hybrid.** Graphical where motion sells it — a real **tilting artificial horizon** and a
  **smooth moving map** (SVG/canvas) — with **glyph/box-art gauges** for fuel/throttle/temp (cheap,
  on-aesthetic, readable). Mirrors how the game already mixes the ASCII minimap with SVG minigames.
- **Passenger view (by seat):** a non-pilot in the cabin gets a stripped top pane — the **moving map /
  window view only**, no gauges, no controls. Same surface, role-appropriate render. Good for charters,
  heists, co-op; cheap to add.

Because this is the area pane's designed behavior, the HUD is **baseline from day one**, not a risky
"immersive tier." The glideslope/takeoff minigames render right in the top pane (or as a focused overlay
in the circuit-breach tradition), keeping the whole flight experience in one focused region.

**Input paradigm — PC is mouse + keyboard hybrid, three coordinated channels:**
- **Pointer (mouse)** for the spatial/analog interactions — glideslope drag-to-align, targeting-reticle
  aim, map waypoint click / full-chart pan, hangar tuning sliders. **Key insight: these pointer gestures
  are identical to mobile touch-drag** — so the PC mouse layer *is* the mobile touch layer (one
  pointer-interaction system serves both; satisfies desktop-first, mobile-playable).
- **Keyboard hotkeys** for fast real-time flight control (throttle/climb/dive/heading) — what PC does
  better than touch; the line-at-a-time command input can't keep up with the tick loop.
- **Typed command bar** for discrete verbs (`board`, `refuel`, `squawk`, `arm`) — unchanged MUD input.

Circuit-breach (SVG + pointer) is the in-client precedent that this works. This is the most novel
interaction in the game and the main new client capability to prove out.

Client files this implies (all new, additive): a `flight-mode` top-pane (area-pane) HUD controller
rendering `cockpit`/gauges + `nav-map` (moving map) + `attitude` (horizon) + `targeting` (reticle);
camera reuses the broadcast display. Preserve UTF-8 glyphs throughout.

## Deep-dive: aircraft roster, tick loop & glideslope

### The six named aircraft (relative template values)

Values are **relative** (fuel in tank-units, burn per tile, speed in tiles/tick, weight abstract);
absolute constants get tuned in Phase C against the Coldwater tile map so ranges feel earned. `handling`
is a piloting-difficulty modifier (negative = more forgiving). Ceiling: low=1, cruise=2, high=3.

| Craft | Class | Takeoff | Fuel / burn | Speed | Ceiling | Seats / cargo / maxTOW | Hull | Hardpts | Handling | Noise | Feel |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Mayfly** | ultralight | STOL, tiny | 20 / 1.0 | 1 | low(1) | 1 / 0 / 90 | 8 | 0 | +2 (twitchy) | low | Cheap trainer you'll wreck; wind tosses it |
| **Dragonfly** | scout heli | VTOL | 40 / 1.8 | 2 | cruise(2) | 2 / 40 / 320 | 18 | 0 | −1 (agile) | med | Versatile early pick; thirsty; hovers, lands anywhere flat |
| **Mule** | bush prop | STOL strip | 70 / 1.3 | 2 | cruise(2) | 3 / 180 / 620 | 30 | 0 | 0 | med | Freight workhorse; rugged; rough-strip capable |
| **Leviathan** | heavy lifter | full runway | 160 / 2.6 | 1 | cruise(2) | 6 / 600 / 1400 | 55 | 0 | +3 (ponderous) | high | Economy endgame; slow, hungry, needs real runways |
| **Reaper** | gunship | STOL/VTOL | 90 / 2.2 | 3 | high(3) | 2 / 60 / 500 | 45 | 4 | −1 | high | Combat craft; fast, armed, loud — everyone hears it coming |
| **Carcass** | wreck | (varies) | salvaged | — | — | — | 5–?? | 0–?? | +4 until repaired | — | Found downed; Mechanics/Chemistry to revive; rolls random type |

Content, not engine — one row per type in the aircraft-type template store; the flight plugin reads them.

**Tech register:** grounded-real baseline (props, rotors, avgas — keeps "operating a machine" tactile
and legible), with room for a **rare exotic outlier** (grav-lifter, salvaged pre-collapse AI-avionics,
a drone-swarm craft) as a top-tier or special found aircraft — occasional wonder/horror, not the norm.

### Tick-loop state machine (~3s tick)

States: `PARKED → TAKEOFF(minigame) → AIRBORNE → LANDING(minigame) → PARKED`, with `EMERGENCY` and
`CRASHED/DITCHED` as escalation exits. Each **AIRBORNE** tick, in order:

1. **Advance** — move `(x,y)` by `cruise_speed × throttle%` along heading. Crossing into restricted
   airspace fires the no-fly move gate (wanted/interception).
2. **Burn** — `fuel -= burn_base × throttleFactor × altFactor × headwindFactor × weightFactor`.
3. **Thermal** — high throttle raises `engine_temp`; sustained overload → overheat → fire risk.
4. **Hazard roll** — `skillCheck(pilot,'piloting',diff)` gates each applicable hazard (weather buffeting
   scaled by extreme-weather severity, bird strike at low band, stall at low-throttle/high-band,
   mechanical faults scaled by `damage`). A triggered hazard *enters its escalation ladder* (below).
5. **Emit** — push gauge/nav/horizon state to client; emit engine noise (`noise × altFactor`) into the
   surface zone below (`getSoundReach` — ground enemies may hear); ping SPECTER if squawking.

**Escalation ladders** (each rung is one or more ticks; the listed verb clears it, else it advances):
- **Fuel:** `BINGO`(20%, warn) → `RESERVE`(10%, warn) → `STARVATION`(0%) = engine-out dead-stick glide,
  one shot at an emergency `land` before ground contact.
- **Stall:** `BUFFET`(warn) → `STALL`(losing altitude; `recover` = nose-down + throttle) → `SPIN` → crash.
- **Fire:** `OVERHEAT`(warn) → `ENGINE FIRE` (`extinguish` / `cut fuel` within N ticks) → total loss.
- **Damage/AA:** hit → control degradation (narrows the glideslope band, adds input lag) → if hull ≤ 0,
  breakup → crash.

Crash = **lethal per normal death rules** for everyone aboard; the craft becomes a salvageable **wreck**
object at the surface cell (feeds the wreck-salvage acquisition loop).

### Glideslope minigame spec (landing & takeoff)

Reuses the fishing tension-bar / circuit-breach client pattern; **server-authoritative** (client renders
the band + marker, server validates inputs and decides the outcome).

**Landing — a vertical alignment channel over a short descent:**
- A **safe band** and a **marker** (your approach deviation). Forces shove the marker each frame:
  crosswind (lateral), sink from weight-over-optimal (down), damage (lag / random deflection),
  weather severity (amplifies all). Player nudges back toward center; at the bottom, **`flare`** in a
  timing window.
- **Skill mapping:** effective piloting → band **width** + input responsiveness; weather/overload/damage
  → force magnitude + band narrowing. (Good weather + light + healthy at a real field = wide, forgiving.)
- **Outcomes:** in-band + clean flare = clean landing; band edges / mistimed flare = hard landing (hull
  damage); out-of-band or blown flare = **crash**. With fuel you may `abort` → go-around and re-fly it;
  dead-stick, you get one pass.

**Takeoff — a horizontal acceleration bar:** reach **rotation speed** before the strip end while holding
center against crosswind. Overweight/short-strip/rough-field slows acceleration — fail to rotate in time
→ abort or overrun (crash). `takeoff_mode` VTOL skips the roll (a shorter hover-lift check instead).

## Content: airports & aircraft

### Airfields (plotted over the planned danger rings; authored as zones w/ an `airfield` flag)
| Airfield | Ring | Type | Role |
|---|---|---|---|
| Core rooftop helipad | Safe Core | Heli VTOL | Trainer pad; adjacent police no-fly |
| Coldwater Regional strip | City edge | Fixed-wing + heli | Main hub: fuel vendor, hangar rental, flight-school NPC, dealer |
| The Yards freight field | East freight | Cargo | Freight/passenger contracts |
| Slagworks dirt strip | West frontier | STOL/rough | Salvage hauling |
| Redline abandoned airstrip | ☢ NW wastes | Derelict | Smuggler refuel, no services, contraband runs |
| Offshore rig / bay pad | Coldwater Bay | Heli | Air-only exploration |

Airfield status stored via zone flags (`zones.flags.airfield_id` / hangar pointer), the pattern
established by `scavenging_table_id` / `fishing_table_id`.

### Aircraft tiers (content templates)
1. **Ultralight / paraglider** — 1 seat, tiny tank, fragile, low-band only, no cargo. Trainer.
2. **Scout heli "Gnat"** — VTOL, hover, 2 seats, agile, thirsty. Versatile early pick.
3. **Bush plane "Mule"** — strip-only, rugged, real cargo. Freight workhorse.
4. **Heavy lifter** — big fuel + cargo, slow, real-runway-only. Economy endgame.
5. **Gunship** — weapon hardpoints. Combat craft; ties to being shot down.
6. **Salvaged wreck** — found downed in the wastes; repair via Mechanics/Chemistry. Roguelike.

### Acquisition (all four)
- **Buy** — aircraft-dealer NPC at Coldwater Regional (big credit sink; economy/vendor system)
- **Rent / charter** — per-flight or hourly at airfields; the low-barrier intro path
- **Salvage** — recover + repair downed wrecks (exploration + crafting)
- **Corp assets** — aircraft owned by player corps ([docs/systems-corps.md](docs/systems-corps.md));
  shared hangars, org-level freight ops

## Deep-dive: purpose systems (why flying matters)

Each reuses an existing Architect system rather than inventing a parallel one.

### 1. Cargo & passenger contracts (the freight economy)
*Reuses:* vendors/economy, credits/banking, factions/corps, inventory-container cargo hold, jail
contraband + evidence locker, SPECTER, gossip (`bigBuy`).
- **Contract board** at airfields (dispatcher NPC or terminal-furniture): jobs list cargo/pax type,
  origin→destination airfield, weight, payout, deadline (tick window), and a **risk rating**.
- **Cargo** loads into the hold (`load`/`unload`) feeding weight & balance (fuel/handling/takeoff-distance).
  **Passengers** occupy cabin seats (charter/VIP/medevac variants).
- **Payout** scales with distance × weight × risk (wastes/contested legs pay more) + on-time bonus;
  paid through banking. Better contracts unlock with Piloting + reputation.
- **Smuggling:** contraband cargo (jail system already flags contraband) flown **dark** (transponder off)
  to dodge SPECTER/police; a scan/interception → wanted + confiscation to the evidence locker. Higher
  pay, delivered to derelict strips (Redline). The three-fuel logistics feed this too.
- **Faction/corp freight:** contracts sourced from factions/corps; completion shifts standing; corp
  treasury funds org-level air-freight ops.

### 2. Airspace combat & enforcement (the danger layer)
*Reuses:* combat engine (to-hit/body-part/typed-soak), SPECTER wanted (`WANTED_RAISE`), AI behaviour
trees + sky-grid pathfinding, jail (`respawnZone` → Precinct 9), extreme weather.
- **No-fly enforcement:** the move gate over Core airspace → warning → wanted-raise → **AI interceptors
  scramble** (police craft that pursue over the sky grid) → fired upon if you don't comply/leave.
- **AA sites:** static ground threats in contested/wastes zones fire on aircraft in range; flying **high
  or fast** cuts exposure, **stealth (noise) + running dark** cut detection.
- **Air-to-ground (strafing):** armed craft (Reaper/hardpoints) — one pass per fly-over, resolved by the
  combat engine with the live targeting reticle; ground targets can shoot back.
- **Air-to-air:** vs interceptors or other players — the tick loop + reticle; climb/dive/heading as
  maneuver, `flare`/`evade` vs locks; the damage ladder → breakup → crash.
- **Shot down:** hull ≤ 0 → hard emergency-landing minigame or crash (lethal + wreck); `eject` drops you
  into the surface zone below (often the lethal wastes). Downed-while-wanted → jail.
- **Weather as combat modifier:** storms degrade everyone's targeting/handling; smart pilots weaponize it.

### 3. Hangars & wreck salvage (the ownership layer)
*Reuses:* housing/apartments + furniture (ownable space), crafting (Mechanics/Chemistry), scavenging
(wreck = loot node), corps (shared hangars), vendors (dealer/charter).
- **Hangars:** ownable/rentable space at airfields reusing the apartment stack — park aircraft
  (`parked_zone_id`), store fuel/parts/cargo, customize with furniture. **Corp hangars** = shared org
  space. Rent tiers by field (Coldwater Regional premium; Slagworks/Redline cheap & lawless).
- **Buy / rent:** dealer NPC sells (big credit sink); charter desk rents by the hour (low-barrier intro).
- **Wreck-salvage loop:** crashed craft (player, NPC, or random spawn) become **wreck objects** at a
  surface cell; `salvage` (scavenging) strips parts/fuel/cargo. A recoverable **Carcass** hauled to a
  hangar and **repaired** (Mechanics + Chemistry checks + parts) rolls a random underlying type —
  roguelike acquisition linking exploration → crafting → ownership.
- **Maintenance:** craft accrue wear; hangar repair/refit between flights; neglect raises the
  mechanical-failure hazard odds in the tick loop.
- **Insurance (optional):** pay premiums at a hangar/dealer; a destroyed **insured** craft is replaced
  minus a deductible. A pressure valve that softens the brutal stakes and doubles as an economy credit
  sink — uninsured flying stays pure-brutal (salvage the wreck or start over), so the stakes are a
  *choice*. Premiums scale with craft value + how dangerous the airspace you file for.

### 4. Multiplayer, PvP & security (all maximally brutal/emergent)
*Reuses:* combat engine + targeting wrapper, SPECTER/wanted, crime + jail, sound/stealth, aircraft
proximity by `(x,y,altitude)`.
- **Shootdowns — open everywhere.** Any craft is downable anywhere; over the city/Core the police +
  wanted response is just *faster and harsher*, not absent. Lethal + craft destroyed → wreck. Insurance
  is the mitigation; even the newbie practice corridor isn't truly safe (true to "brutal everywhere").
- **Parked security — hangar-safe, open-lot vulnerable.** In an owned/rented hangar a craft is secure;
  on an open ramp it can be boarded, stolen, stripped, or sabotaged — a **crime** (crime/jail + SPECTER).
  This is what makes hangars worth their rent, and leaving a craft in the open a real gamble.
- **Ground-to-air — AA sites + armed players.** NPC AA emplacements *and* grounded players with suitable
  weapons can hit **low/slow** overflights. This is the payoff for the altitude/stealth/running-dark
  levers: fly high, fast, and quiet to survive; low, slow, and loud gets you shot. Air-to-ground
  strafing is the reciprocal.
- **Aircraft proximity/detection:** two craft share airspace when their `(x,y)` match (altitude bands
  gate whether they can engage); this is the seam air-to-air combat and the moving-map "traffic" blips
  read from — needs a simple proximity index over airborne-aircraft state.

## Deep-dive: onboarding, mods & comms

### Becoming a pilot — OPTIONAL TUTORIAL, RENT TO LEARN (the on-ramp)
*Reuses:* skills IP economy, NPC dialogue (VINE), quests DAG (VINEquest), charter-rental (economy).
- **No hard gate:** anyone can walk up, **rent a Mayfly** at the charter desk, and attempt to fly at
  Piloting 0 — dangerously (narrow glideslope band, more hazards). The Mayfly is forgiving-ish to learn
  in but wind-tossed. Self-directed by default; respects veterans.
- **Optional guided first flight:** the **flight-school NPC** at Coldwater Regional offers a **skippable**
  tutorial charter — a **VINEquest DAG** walking `startup` → takeoff bar → fly to a waypoint → glideslope
  landing — that comps the first rental + fuel and grants **starter Piloting IP**. The mode-shift (top
  pane → HUD) is the onboarding "wow" beat.
- **Piloting acquisition:** everyone starts at 0; the tutorial (if taken) grants the first IP, otherwise
  you earn it from your first real takeoff/landing; thereafter every takeoff/landing/hazard/maneuver
  `awardSkillUse` grinds it (standard skill economy).
- **Soft graduated access:** the **dealer/charter won't rent or sell a novice a Leviathan** — it's an
  economic/reputation gate, not a license wall. Safe practice corridor: Core helipad ↔ Coldwater Regional
  legal airspace before you risk the wastes.

### Aircraft mods & customization — DEEP TUNING (making it *yours*)
*Reuses:* crafting (Mechanics/Chemistry) for parts; drug-synthesis's "value baked into `custom_data`"
pattern for storing the tune; Mechanics skill gates tune quality; salvage loop; `name` field.

**Two layers — parts set the envelope, tuning dials within it:**

1. **Slots + parts (discrete).** Fixed slots on the template — **engine, avionics, fuel tank,
   cargo/armor, hardpoints**. Each takes a tiered **part item** (craftable, buyable, or stripped off a
   wreck), installed at a hangar on a Mechanics check. Parts define the outer envelope (max power, tank
   size, instrument grade, armor, weapon mounts).
2. **Tuning curves (continuous).** Within the installed parts, dial adjustable parameters at a hangar; a
   Mechanics check sets how safely/tightly you can push them (better skill = wider safe zone). Each is a
   trade-off slider, and each **feeds the tick-loop hazard math + the HUD gauges**:
   - **Mixture (fuel richness)** — lean = better economy but hotter + stall-prone; rich = cooler,
     thirstier, more power.
   - **Prop/rotor pitch** — fine = better climb/takeoff, slower cruise; coarse = faster cruise, sluggish climb.
   - **Boost / throttle governor** — raise the power ceiling for more speed at overheat/damage risk.
   - **Weight & balance (CG)** — nose-heavy = stable but sluggish; tail-heavy = agile but stall-prone;
     couples to how you load cargo.
   - **Gear/suspension** — stiff vs soft for rough-strip STOL landings.
   A good tune optimizes for a mission profile (long-haul economy / dogfight agility / heavy-lift); a bad
   one degrades performance or *raises hazard odds* (an over-boosted lean engine narrows your fire margin).
- **Saveable profiles** — store a tune ("bush config," "racing config") and swap it at a hangar.
- **Weapons — freely armable, legality by airspace.** Any craft with a hardpoint slot mounts weapon
  parts (guns = strafe; rockets/missiles = heavier, consume ammo-cargo). **Owning/arming is not itself a
  crime** — legality is *contextual*: firing or flying armed over controlled airspace (Core/city) draws
  SPECTER/wanted; the wastes are lawless. Resolves through the combat-engine wrapper + targeting reticle.
- **Cosmetic:** paint/livery, tail-number `name`, corp liveries.

### Comms & ATC — SOFT-GATING (texture that can bite)
*Reuses:* broadcast system (channels, NPC hosts, dynamic lines), AudioEngine (engine drone / radio
static), SPECTER/no-fly enforcement, the camera-feed news chopper.
- **Flight-comms channel** you tune like a broadcast channel; mostly **automated tower lines** so it never
  becomes a chore.
- **Controlled fields (Core helipad, Coldwater Regional):** expected flow is **squawk a code + `request
  clearance`** → the tower auto-responds with a dynamic line (runway, winds, traffic). **Comply** and
  it's smooth flavor, maybe a small perk (priority slot, no hassle). **Ignore it** — no squawk, no
  clearance, or running dark — and it becomes the **first rung of the no-fly/interception escalation**
  (warning → wanted-raise → interceptors). ATC isn't a separate wall; it's the polite version of enforcement.
- **Uncontrolled fields (Slagworks dirt strip, Redline):** no tower — CTAF-style self-announce flavor
  only, no clearance needed. Lawless skies.
- **Mayday:** going down broadcasts a distress call on the channel — other players/NPCs hear it (rescue /
  medevac contract hook), and it can alert responders.
- **Ambience:** engine-drone audio loop in flight mode, radio chatter/static; the news/spy chopper feeds
  aerial traffic reports into the broadcast system.

## Sequencing (flight drives the Coldwater build)

The live world is a ~41-tile east–west spine — too thin for flight to feel like freedom. Flight is the
motivation to build out the locked 180-tile Coldwater rectangle. (That expansion plan was abandoned
and its doc deleted 2026-07-24; the world was instead grown by the 888-tile district build — see
[legacy-world-decommission.md](legacy-world-decommission.md).)

- **Phase A — substrate (vertical slice):** aircraft table + schema, `flight` plugin, `board`/`land`/
  `takeoff` + basic tick loop, Piloting skill, cockpit zone model, one airfield (Coldwater Regional),
  one aircraft (Scout heli, rented). Prove the machine flies over the *current* map.
- **Phase B — rich cockpit + hazards:** full gauge panel, altitude bands, fuel/stall/damage/weather
  hazards, computed sky overlay + aerial minimap, no-fly move gate.
- **Phase C — Coldwater airspace:** build the expansion tiles; place the six airfields; authored
  special-airspace zones (police no-fly, storm cells, offshore approach).
- **Phase D — purpose systems:** cargo/passenger contracts (economy), combat/AA + shootdowns + wreck
  salvage, corp aircraft ownership. Full crew seats if desired.

## Files to create / touch (when built)
- **New:** `plugins/flight/` (index.js, plugin.json, regress.js), `client/game/js/panels/cockpit.js`,
  `docs/systems-flight.md`, aircraft-type + airfield seed script(s), one-shot schema script.
- **Edit:** [server/models/schema.js](server/models/schema.js) (aircraft table + `SCHEMA_SQL`),
  [server/engine/skills.js](server/engine/skills.js) (Piloting), possibly a small perception/describe
  hook for the computed look-out view. Register move gate + actions via existing seams — no engine
  rewrites.
- **Reuse:** posture-loop pattern (fishing/scavenging), `skillCheck`, move gates, zone flags,
  `getMinimapData`, `exits.js` helpers, cross-plugin action registry, `dpConfirm/dpPrompt` in dev panel.

## Verification (when built)
- `npm run test:regress` after the plugin/verbs/schema land (mandatory: new plugin + verbs + engine
  seam + move gate). Add `plugins/flight/regress.js` driving board→takeoff→fly→land→crash paths.
- Manual: `npm run db:schema`, restart, board the trainer heli at Coldwater Regional, take off, fly a
  few tiles, watch fuel/gauges tick, land; then force a fuel-out crash and confirm lethal + wreck.
- Confirm UTF-8 glyphs intact in the cockpit panel; confirm no-fly gate raises wanted over the Core.

## Resolved design questions

- **Navigation — "instruments always, position earned."** Gauges (altitude/fuel/heading/airspeed) are
  always visible. Map position is *earned*: in clear weather `look out` shows the surface cell below; in
  whiteout/blackout the look-out goes useless and you fly **dead-reckoning + a `chart` command** with
  accumulating drift. Airfields emit a homing **beacon** you can lock within range. Weather makes
  navigation dangerous, clear skies stay readable.
- **Fuel — lock the model, tune numbers in Phase C.** `fuel per tile = base × throttle × altitude ×
  headwind × cargo-weight`. Airfields spaced so a full trainer tank crosses ~one danger ring (not the
  map); bingo-fuel warning on the gauge. Constants tuned once the Coldwater tile map exists.
  **Several fuel types**, gated by the template's `fuel_type`: **avgas** (Mayfly/Mule props), **jet/heavy
  fuel** (Leviathan/Reaper), **scavenged biofuel** (Carcass/jury-rigged). Airfields stock some but not
  all — refueling is real logistics, and the fuel a remote/derelict strip *lacks* is a smuggling angle.
- **Gunship weapons — reuse the combat engine, thin air wrapper.** Air-to-ground/air-to-air runs through
  the existing to-hit / body-part / typed-soak resolution ([docs/combat.md](docs/combat.md)) modified by
  piloting; the only new framing is "one pass per fly-over, AA fires back on the tick." No parallel
  combat system.
- **Disconnect/restart — graceful, never death-by-netdrop.** Clean disconnect while airborne → autopilot
  **loiter/hold** grace period, then auto-land at nearest field if fuel allows, else controlled
  emergency landing (damage, not death). Server restart persists the aircraft row and resumes parked-safe.
  Brutal applies to player *choices*, not connectivity.

## Canonized add-on concepts (each reuses an existing system)

- **Engine-noise stealth** (sound system, `getSoundReach`) — low flight is heard by ground enemies who
  react; high flight is quiet. Altitude is a stealth axis as well as an obstacle axis.
- **Transponder & running dark** (SPECTER surveillance) — craft squawk a transponder; killing it evades
  cameras/police but is itself a crime flag. Backbone of contraband runs to the Redline strip.
- **Instrument flying + EMP hero event** (extreme weather) — the designed EMP event fries avionics
  mid-air and drops you out of the sky; whiteouts force instrument/dead-reckoning flight.
- **Hangars as ownable space** (housing/furniture stack) — rent/buy a hangar like an apartment: park,
  store, customize; corps get shared hangars. Reuses apartments + furniture wholesale.
- **Cargo weight & balance** — mass affects fuel burn, handling, and **takeoff distance** (overloaded =
  can't clear the strip). Reuses encumbrance-gate thinking; makes freight tactile.
- **Aerial spotting** (scavenging) — from altitude, spot & mark ground loot/wrecks/events for retrieval
  on foot or by heli-winch. Fuses exploration + scavenging.
- **News/spy chopper** (broadcast system) — aircraft-mounted camera feeds broadcast channels: aerial
  traffic reports, paparazzi, player-run news.
- **Drone_ops synergy** — the existing `drone_ops` skill becomes the unmanned recon cousin: scout ahead
  with a cheap RC drone before risking a real aircraft.

## Verified load-bearing assumptions
- **Coordinate grid — TRUE.** `grid_x/grid_y` populated + used on `map_world`; `coordToZone` lookup is
  trivial (dev-panel map editor + weather sampler already do it); empty cells = open air. Overlay is sound.
- **Per-aircraft runtime zones — REJECTED.** Would violate "content is deliberate." Design corrected:
  the aircraft object owns its occupant set; cabin is synthesized, no `zones` row. No rule broken.

## Still to nail during the build (not blocking design)
- Fuel-economy constants + airfield tile-coordinates (both need the Coldwater tile map to exist).
- Whether crew seats (gunner/nav) ship in Phase D or stay a future hook.
- **Economy balance target** — contracts (faucet) vs fuel/rent/crashes/premiums (sinks); pick a net so
  flight is neither a money printer nor a poverty trap. Tune against live credit flows.
- **Real-time test seam** — the tick loop + pointer minigames don't fit the headless `regress.js`
  harness; add a way to drive the tick loop deterministically (fake clock, scripted inputs) so flight is
  regressable without a live client.
