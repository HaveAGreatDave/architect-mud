# Flight System — As Built (Phases A–D)

> Status: **Phases A–D built 2026-07-03.** This is the running source for flight
> *as actually built*. The full locked design lives in the blueprint:
> [docs/proposals/systems-flight.md](proposals/systems-flight.md). Read that for
> intent; read this for what exists.
>
> Author-direction reference docs (the vision the continuous overhaul reconciles):
> [Flight](reference/Flight_Implementation.md) · [Rendering](reference/Rendering_Implementation.md) ·
> [Sound](reference/Sound_Implementation.md) · [Weather](reference/Weather_Implementation.md).

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
- **Takeoff** (`flight_takeoff` → `takeoffresolve`): a hand-flown departure on two
  drag controls — a **THROTTLE lever** (0–100%, holds where you leave it) and a
  **CONTROL COLUMN** (drag up = push forward = pitch down; drag down = pull back =
  pitch up; holds). Roll begins once the throttle's up; at **80% of runway with
  ≥60% throttle** the centre flashes **V1 — ROTATE!**, and a *gentle* pull-back
  (~20–30%) lifts you off. Over-rotate → **STALL** (level out or crash); nose-down
  → **nose-first crash**; no rotation before the end → **overrun**. On success the
  server sets climb power (throttle → 70) since the deck flew it off the runway.
  (Throttle is no longer a takeoff precondition — you set it *in* the run.)
- **Landing** (`flight_land` → `landresolve`): **unified with takeoff** — the same
  **THROTTLE lever + CONTROL COLUMN** pair. Throttle trades energy, column trades
  pitch; hold the **glidepath diamond** centred (HIGH/ON/LOW) as the approach clock
  runs, then a *gentle* pull-back **FLARE** at the threshold. Fail modes mirror
  takeoff: pitch-up + idle → **STALL on final**, nose-down near the ground →
  **nose-first**, too much sink at touchdown → **hard landing**, off the glidepath →
  miss, dropping it in before ~80% of the approach → **short**. Emergency
  (dead-stick) approaches are narrower and faster (no engine energy to trade).
- **VTOL lift** (rotorcraft, e.g. the **Dragonfly**): both takeoff and landing route
  to a dedicated **collective + cyclic** deck. Raise/lower the **COLLECTIVE** lever
  for vertical rate; nudge **◀ ▶ (cyclic)** to hold station over the pad against a
  wind that scales with difficulty. Takeoff = climb off the pad to altitude; landing
  = ease the collective down to settle onto it. **Drift off the pad** or **thump it
  down too hard (V/S)** and you wreck it. `takeoff_mode = 'vtol'` on the aircraft
  type flips both decks; the server tags `flight_takeoff`/`flight_land` with `vtol`.

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
  gain scaled by wind, with the odd thunderclap in a storm). It appears in **three
  places**, all fed the same way (eased pitch/bank/height/speed): a **canopy band**
  atop the pilot HUD, the **whole cabin window** in the passenger view, and a slim
  **FWD VIEW band** in each takeoff/landing/VTOL deck (driven by that deck's own
  physics loop, so the ground rushes up on takeoff and sinks toward you on landing).
  Time-of-day + weather ride in a new `sky:{hour,weather,wind}` field on the gauge
  payload (`state.js`, from `getEnvironmentState()`).
- **Area-pane avionics HUD:** a graphical **artificial horizon** (SVG, pitched by
  altitude band), a rotating **compass card**, a **5×5 moving-map** nav display
  (the server pushes a `map` window each tick; north-up, craft glyph oriented by
  heading, land/air cells + a radar sweep), colour-graded **FUEL/THR/HULL/ENG**
  gauges, an ALT/SPD/HDG/surface-below readout, and a flashing warning strip.
  Parked shows a pre-flight checklist; passengers get the cabin-window layout
  (the windshield fills the pane above a dest/alt/spd/hdg strip — no controls).
- **Takeoff deck** (`flight_takeoff`): full `mg-chassis`/`mg-bezel`/`mg-screen`
  with a perspective **runway** SVG (scrolling centreline, Vr gate, sliding
  craft), an airspeed tape, and a live `deckStrip` (RWY-used tension).
- **Approach deck** (`flight_land`): the takeoff hardware reused — the same
  **THROTTLE lever + CONTROL COLUMN**, a side-view of the craft sinking toward a
  growing runway, a right-hand **glidepath diamond** (HIGH/ON/LOW), a live SINK
  readout, a big centre call-out (ON GLIDEPATH / FLARE / STALL …), and a `deckStrip`
  deviation meter.
- **VTOL deck** (`openVtolLift`, rotorcraft): a **COLLECTIVE lever + ◀ ▶ cyclic**,
  a 2-D pad view (craft glyph climbs/descends and drifts), an altitude tape, and
  ALT/DRIFT/VS readouts — one function serves both takeoff (`'takeoff'`) and landing
  (`'landing'`).
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

**Phase D — contracts** (`contracts.js`). A field's board lazily tops up to ~4
open jobs drawn from an **authored job-type table** (`JOB_TYPES`) — a spread of
legal and illegal work, each with its own flavour, load, deadline and pay:
- **Legal:** Freight · Priority Courier (tight deadline premium) · Cold-Chain Meds ·
  Passenger/VIP Charter · Medevac (urgent) · Relief Run (dangerous but honest) · Survey Drop.
- **Illegal** (contraband → **run dark**, +heavy pay, higher risk): Smuggling ·
  Gun-Running · Chop-Shop Parts · Disposal · Toxic Dump · Exfil (hot) · Data Mule.

Illegal jobs only appear at **lawless fields** (`airfield_lawless` — Slagworks,
Redline, Smuggler's Slip) and prefer a lawless drop; honest fields (Core, Regional,
Marshalling) carry legal work only. `accept` loads the weight onto the craft (fed
through `effStats` → takeoff difficulty + fuel burn + overweight gate); `manifest`
tracks active jobs; delivery is detected on landing at the destination (on-time =
full, late = half; contraband pays in "unmarked cash"). Payout = distance × weight
(or passenger rate) × risk × the job's `payMult`. The board tags each job
LEGAL/ILLEGAL and shows the deadline.

**Phase D — combat** (`combat.js`). `tickCombat()` each airborne tick: AA sites in
range fire on low/slow overflights (altitude, speed, `evade`, and a piloting jink
cut the hit chance); a hit walks the hull-damage ladder → breakup → `crash`.
`arm`/`safe` toggle weapons (hardpoints only); `strafe`/`fire` arms the **targeting-
reticle deck** (`flight_target` → `strafresolve`) to silence a site.

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
The three **charter pilots sit at the ops desk inside** their hangar while on shift
(`syncPilots` seats them via `setPosture(...,'sitting')`, `forceStand` on any move
out); `inHangar` counts a pilot present at the ramp **or** the interior. Chartering
happens **entirely from inside the hangar**: you book a ride and a destination at the
desk, the pilot **taxis the machine up to the hangar door**, and `embark` (reachable
from inside, resolved to the ramp aircraft) is what rolls it. Content:
`scripts/seed-hangar-interiors.js` (all 6 fields; idempotent).
Room text: `describeAirfield`/`describeHangarInterior` share a `serviceBits` builder.

**Phase D — ownership** (`hangars.js`). `hangar rent/store/pull` (stored = theft-
proof; an owned craft on an open ramp can be stolen — grand theft, +3 stars);
`repair` (Fabrication + credits); `salvage` a wreck for scrap; `rebuild` a Carcass
(Fabrication + Chemistry + 1500c → a random flyable type).

**Customisation is owner-only** — the umbrella verb `modify` (alias `customize`)
adjusts everything on a craft you *own outright* (not a charter rental), at a field,
on the ground: the **tune curves** (mixture / pitch / boost / CG, Fabrication widens
the safe range, feeding `effStats` → the tick-loop hazard math + HUD), the **tail
name**, the **livery**, and **saveable tune profiles** (`modify save/load <name>`).
`modify` with no argument prints the full customisation sheet. `tune` remains the
quick curve shortcut, now equally owner-gated (`ownedCraft`); rentals and
other people's aircraft can't be modified.

**Acquisition** (`acquisition.js`). `buy <type>` purchases at a dealer field (`buy`
routes back to commerce for ordinary shopping).

**NPC-pilot charters** (`charter.js`). `charter` is a *ride*, not a self-flown
rental: an on-duty **charter-pilot NPC** (a new `charter_pilot` personality;
three seeded — Ratchet Doyle @ Coldwater Regional 0000–0800, Magpie Soto @
Marshalling Field 0800–1600, Old Kessler @ Smuggler's Slip 1600–0000) flies you as
a passenger. Each pilot works a fixed **8-hour shift** at one field (the three tile
the day). Pilots **physically clock in and out** (`syncPilots` moves the NPC): a
pilot is **at work** when they're **in their hangar** or **out on a flight** —
`available()` = in-hangar + free. On shift they stand at the desk; off shift they
go **home** (desk closed, "back at 08:00"); out on a run they're gone until they
**return**. A flight that **overruns the shift** keeps them at work (flying) until
they land — then the next sync sends them **home, off the clock**. A pilot already
out means you **wait for their return**. `charter` lists **passenger-capable** aircraft (seats ≥ 2)
at **10× the hourly rate**. **The destination is chosen up front, at the desk**:
`charter <ride>` offers a numbered **airport list** (or, for the VTOL **Dragonfly**,
**any exterior tile clicked on the full map** — `flight_pick_dest` carries a `cmd`
the click completes as `charter <ride> <tile>`); `charter <ride> <dest>` (via
`resolveDest`) **books it** — the aircraft is generated at the ramp (narratively
taxied **up to the hangar door**), pilot aboard, bound for your destination and
waiting in the **`boarding`** phase. You are *not* charged and *not* aboard yet.
**`embark` is the trigger for both**: it charges the fare, seats you, and moves the
charter to **`departing`** — the pilot taxis out on the ground for `TAXI_MS`, then
the tick **rotates** her (→ `enroute`) and flies the leg. A charter aircraft is
**locked without its pilot**: `embark` is refused unless the assigned pilot is aboard
(`charterParkedAt` / `embarkCharter`, gated in `index.cmdBoard`). If nobody embarks
within **2 min** the pilot gives up and the craft despawns; orphaned charter rows are
swept on plugin load.
A booked charter is **reserved to the player who chartered it** (`ch.chartererId`):
a second player can't `embark` it (they fall through to normal boarding, the charter
invisible to them). It's **free to cancel before you embark** — type **`cancel`** or
simply **leave the airfield** (the tick sees the charterer is no longer at the field
via `fieldFor` and scrubs it); the fare is only charged at `embark`, so a pre-embark
cancel refunds anything taken (`ch.paid`, normally 0). Once you've embarked she's
committed — rolling. The pilot does everything (a server-driven autoflight tick, no minigames —
the main physics tick skips `live.charter` craft); you have **no controls**. The pilot
**rides along as a real aircraft occupant** — `boardPilot` puts the NPC in
`live.occupants` and pulls them out of the world at departure (so bystanders see
them leave with the plane; the engine `npc._aboard` guard in `gameLoop` freezes
their AI), and `disembarkPilot` sets them back down at the home field on the return. On arrival
they set you down and tell you to `disembark`; if you don't within **20 s** they put
you out automatically, then the craft despawns and the pilot frees up. Payment is
taken on departure; can't-afford cleanly cancels. **Admin:** `.testfly <type>`
spawns any aircraft free at a field and boards you as pilot for normal flight.
**Dev-panel:** a **Flight** panel (`GET /flight/debug`) shows each pilot's
work-status (on duty / off shift / flying → where) and a live flight-request log.

**The glass cockpit** (`cockpit.js` + `engine-audio.js`). The area pane becomes a
brushed-metal/glass instrument panel animated every frame by a local rAF loop that
*eases* toward each server push (the compass spins to a bearing, the horizon banks
into turns, needles glide): artificial horizon · expanded **heading-up RADAR**
(sweep, range rings, land/field/no-fly blips, and the **fuel-guide arrow** to the
nearest field shown below 30% fuel) · a rotating **compass** · **per-engine temp
gauges** · the **real minimap** (`getMinimapData`, danger-coloured) · seven-segment
digital dials. **Engine run-up:** `startup` warms each engine live; the gauges must
settle to green or a cold takeoff runs hot and can fail. **Numeric headings:**
`heading 247` flies a true bearing (sub-tile float advance). **Engine audio:** a
live throttle-tracking drone + slipstream + airframe creaks/gear/gust. The four
decks are deepened — **takeoff** (run-up → centreline + V1/Vr callouts → rotate →
gear up), **glideslope** (two-axis localizer + glideslope, gear, flare, roll-out),
**targeting** — all shared chassis + the `flight` SFX group.
`aircraft_types.engines` sets the powerplant count.

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

Flight wins several verbs by manifest `after` and delegates by context:
`board`→gametable (poker), `refuel`→generator, `buy`→commerce, `eject`/`tune`→
broadcast, and `repair` falls through to the engine gear-repair builtin off-context.

## Still lighter / follow-on

Full PvP air-to-air (the AA/reticle seam exists; player-vs-player interception is a
message today), authored storm-cell/offshore special-airspace *content*, comms/ATC
channel flavor, corp-owned aircraft + insurance, and discrete parts-as-items slots
(the continuous tune curves are in). See the blueprint.
