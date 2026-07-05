# Flight Simulator Overhaul — Blueprint

> Status: **Proposed / not built.** This is the locked blueprint agreed before Phase 1.
> It captures the architecture, the resolved decisions, the phased plan, the shared
> state contract, and the risks. Read this for intent.
>
> Companion sources:
> - [docs/systems-flight.md](../systems-flight.md) — the flight system **as currently built** (Phases A–D).
> - [docs/proposals/systems-flight.md](systems-flight.md) — the original locked design.
> - Direction docs (author-supplied): Flight Overhaul, Flight Feel & Game Feel,
>   Environmental Rendering, Flight Audio Design. This blueprint reconciles all four
>   against the running code.

## What this is — and what it isn't

This is a **comprehensive overhaul** of the flight *experience*, bringing it to the
polish tier of Splicing / ATM / AMP. It is **not** a rewrite of the flight *plugin*.

- **The plugin scaffolding survives untouched:** the aircraft-owns-occupants registry,
  the computed sky overlay (`surfaceAt`), hangars, contracts, charters, combat/AA,
  acquisition, the six aircraft + six airfields, the `aircraft` / `aircraft_types`
  tables. None of that is on the table.
- **The flight *model* is rearchitected.** Today it is discrete and tick-based:
  `altitude_band` (low/cruise/high) stepped by `climb`/`dive`; heading/throttle as
  discrete `set` commands; a ~3s tick advancing position; **pitch and bank are not
  flight state** (they exist only inside modal takeoff/landing minigame decks). The
  overhaul replaces that central abstraction with a **continuous energy model** and
  **always-live cockpit controls**, with no modal phases.

So "evolve, don't rewrite" is literally true for the scaffolding and honestly *not*
true for the model core. Naming that plainly is the point of this doc.

## Resolved decisions (the four forks)

1. **Simulation authority → client-sim + server-reconcile.**
   The physics loop runs on the **client at 60fps** (rAF). The **server stays
   authoritative over consequences, not feel**: it validates client snapshots against
   the physical envelope on a slower tick and owns everything that touches other
   players or the economy — fuel decrement, crash→death, no-fly `WANTED_RAISE`, AA
   hits, contract delivery, ground-noise emission, persistence. Cheating a solo
   joyride is a non-event; the moment it touches law/economy/combat, the server
   arbitrates. Justified because air-to-air PvP is not built (low cheat stakes) and it
   yields the best possible feel on raw WebSockets.

2. **Modal takeoff/landing/VTOL decks → retire and harvest.**
   Delete the four modal decks. Fold their good bits into the always-on cockpit: the
   Vr rotate callout and flare/sink evaluation become inline flight events; the VTOL
   collective+cyclic control model **becomes** the live helicopter controls. Nothing
   good is discarded; it stops being a separate screen.

3. **First vertical slice → one fixed-wing (Mayfly), end-to-end.**
   Prove throttle/pitch/bank/stall/ground-roll/flare all the way through on the
   simplest airframe (no VTOL, no weapons, no adaptive multi-engine panel) before
   generalizing. De-risks the hardest part first with a clean reference case.

4. **Input device → touch matters.**
   All draggable SVG controls use **Pointer Events** (mouse + touch unified) with
   large drag targets from day one. Text commands remain the secondary path.

## Architecture: client-sim + server-reconcile

### The client feel loop (60fps rAF)
Evolves the easing loop already in `cockpit.js`. It holds the real continuous state
and integrates it every frame:

- **State:** `airspeed`, `altitude` (float), `pitch`, `bank`, `heading`, `rpm`
  (per engine), plus control inputs `elevator`, `aileron`, `throttleLever`, `flaps`,
  `collective`, `cyclic`.
- **Per-frame integration (arcade energy model, not 6-DOF):**
  - `rpm` eases toward `throttleLever` (engine inertia; turbines lag more, keep rising
    briefly after the lever stops).
  - thrust ← `rpm`; drag ← `airspeed²` + flaps + AoA.
  - `airspeed` integrates `thrust − drag − gravity·sin(pitch)`.
  - lift ← f(`airspeed²`, AoA, flaps). lift < weight → sink; pitch trades speed for
    climb.
  - AoA ≈ `pitch − flightPathAngle`. **Stall = high AoA + low airspeed → lift
    collapses** (never "throttle low").
  - attitude (`pitch`/`bank`) eases toward commanded control deflection with
    **rate limits scaled by aircraft mass** (heavy = slower). Controls modify
    *behavior*, never set state instantly.
  - `heading` integrates from `bank` (coordinated turn).
  - wind adds subtle constant drift + gusts.

This one loop delivers the whole Feel doc: momentum, "guiding mass," inputs-modify-
behavior, natural stability-seeking, escalating consequences.

### The server reconcile + consequence tick (~1–3s)
- Receives periodic client state snapshots.
- **Sanity-checks against the physical envelope** (max speed / climb rate / plausible
  fuel burn). Corrects only on *envelope violations*, never routine drift — so
  corrections are invisible, not rubber-banding.
- **Owns consequences:** authoritative fuel decrement, crash→`handlePlayerDeath`,
  no-fly `WANTED_RAISE`, AA/combat hit resolution, contract delivery detection,
  `overflyNoise` ground emission, row persistence.
- Pushes world context back (map window, weather, nearby craft, corrections).

### Continuous altitude, derived band
Altitude becomes a float. A `bandFromAltitude(alt) → 'low'|'cruise'|'high'` accessor
feeds the existing consumers (contracts, combat, hazards, no-fly, ground-noise) so
they are **not** rewritten in the slice. They keep reading a bucket; the bucket is now
derived, not authoritative.

## Shared state contract (name the seams once)

The client sim's per-frame state object — and the reconcile payload — must carry these
from **day one**, so the renderer, instruments, and (Phase 4) audio are pure wiring
later, never a retrofit:

| Field | Consumers |
|---|---|
| `airspeed` | instruments, audio (wind), renderer (scroll) |
| `altitude` (float) | instruments, derived-band, renderer |
| `pitch`, `bank` | attitude indicator, renderer camera, windshield |
| `heading` (deg) | compass, renderer obstacle projection |
| `rpm` (per engine, lagged) | RPM gauges, audio (engine timbre) |
| `verticalSpeed` / `sinkRate` | VSI, audio, hard-landing eval |
| `stallMargin` (AoA vs critical) | stall horn escalation, warning strip |
| `onGround`, `groundRollSpeed` | audio (ground roll), takeoff/land logic |
| `surfaceType` below (asphalt/concrete/dirt/grass) | audio, renderer |
| `gear`, `flaps` (position **+ transition events**) | audio cues, drag model |
| `rotorLoad`, `forwardSpeed` (heli) | audio (rotor slap), hover logic |
| `touchdown` / `impact` events (with severity) | audio, crash-reason feedback |
| weather / wind | already present |

## Phased plan (reordered: depth before breadth)

**Phase 1 — the Mayfly slice (fixed-wing, end-to-end).**
Client sim loop + one draggable control set (yoke / throttle / flap, Pointer Events) +
continuous taxi→takeoff→cruise→descent→land with real Vr rotation, stall, and flare +
server reconcile & consequences + derived-band shim. Includes the **feel-critical
polish** that the model can't be judged without: camera lean/settle/impact, instrument
needle-lag, the stall horn (intermittent→continuous), and specific crash-reason
feedback (stall-after-takeoff / CFIT / nose-first / fuel-exhaustion / excessive-sink /
overrun). *This slice is the whole architectural risk.*

**Phase 2 — rendering.**
Mode-7-inspired evolution of `windshield.js` (perspective, horizon compression,
distance haze, texture scaling, object scaling — **not** literal Mode 7) + the new
**district/biome derivation layer** (see below) + a reusable **building-archetype
library** + richer terrain materials + a larger minimap synced to the walking minimap.
Built against the now-settled continuous state, so it's built once.

**Phase 3 — generalize + helicopter.**
Roll the model across all six aircraft (runway length, acceleration, maneuver rate all
scale with mass — the Feel doc's "consistency" rule); re-add **collective + cyclic** as
live heli controls (continuous hover with drift-correction, the hardest feel, done
last); adaptive per-class panel; weapons / cargo / W&B.

**Phase 4 — audio + cosmetic polish.**
Layered procedural FM engine (starter→ignition→idle→low→mid→high→max as a continuous
timbre morph; turbine spool inertia; rotor slap tied to load/forward-flight/maneuver;
surface-dependent ground roll; gear/flap actuators; severity-graded crash audio;
cockpit ambience bed). Reads the local 60fps sim state directly (smooth tonal
evolution, no coarse-push interpolation). Then the global cosmetic sweep: lighting,
shadows, runway lighting, extra atmospheric haze.

## The district / biome derivation layer (shared service)

The Rendering doc's premise — "think in districts, infer the neighborhood" — has **no
backing data**: zones carry `id`, `name`, `description`, `danger_rating`, `flags`, grid
coords, and nothing else. There is no `district`/`terrain`/`biome` field anywhere.

So district classification is a thing we **build**, not read — inferring a biome
(`downtown` / `commercial` / `residential` / `industrial` / `waterfront` / `airport` /
`forest` / `marsh` / `agriculture` / `military` / `ruins` / `parks`) per tile from
zone-id patterns, names, flags, and **neighbor scanning**, extending what
`groundTheme()` in [state.js](../../plugins/flight/state.js) already does in miniature.

Design it as a **shared service, not renderer-private**: the same "what am I flying
over" classification feeds both the visuals (Phase 2) and the environmental ambience
bed in the audio (Phase 4). One derivation, two consumers.

Quality here is the make-or-break of the whole rendering effort and is pure inference
from sparse data — recognizability will only be as good as the heuristics. **Get the
author's eyes on the classifier output early.**

## What survives untouched

Registry / aircraft-owns-occupants · `surfaceAt` computed overlay · hangars & walk-in
hangar interiors · contracts (`JOB_TYPES`) · charters (NPC-pilot rides) · combat / AA /
targeting seam · acquisition (buy/charter/refuel) · the six aircraft + six airfields ·
`aircraft` / `aircraft_types` schema · Piloting skill · verb-collision routers.

Text verbs (`throttle` / `heading` / `climb` / `dive` / etc.) are **retained** as the
secondary control path, remapped to drive the continuous model.

## Risks / watch-items

- **Reconciliation snap.** A visible server correction kills the feel. Mitigation:
  correct only on envelope violations; absorb small drift silently.
- **Touch + drag-to-fly ergonomics** on a dense cockpit at phone size. Prototype the
  control zone early; large hit targets; consider a simplified touch layout.
- **District derivation quality** — inference from sparse data; needs author review of
  classifier output before the renderer leans on it.
- **Heli view-cases built slightly ahead of the heli** (Phase 2 rendering before
  Phase 3 heli). Low risk — `drawPad` VTOL rendering already exists — but design the
  hover/look-down framing defensively.

## Roadmap / later passes

- **Flight asset editor (devpanel Flight tab) — planned.** Today the buildings/terrain
  are *procedural canvas code* (`drawTower`/`drawMesa`/… in `windshield.js`), not
  editable assets. A future pass adds a **data-driven asset registry** (a content
  table + a devpanel Flight tab) mapping each biome/archetype to either a
  parameterised procedural drawer **or** an imported sprite (**SVG** pasted as text, or
  **PNG** uploaded). Renderer rasterises/caches sprites and billboards them
  distance-scaled, falling back to procedural when none is set. PNG pixel-art +
  nearest-neighbour scaling best fits the F-Zero look. Limitations of sprites: flat
  billboards (tint-only lighting, no per-face relight; bake day/night variants),
  scaling blur (need hi-res/LODs), storage (served files vs data-URIs). Recommended
  hybrid: procedural default, sprite override per archetype.
- **Mode-7 / F-Zero effect stack** (in progress, order): (1) **affine ground rotation
  with heading** ← building now, (2) crisp repeating ground texture, (3) roadside
  fast-scaling objects, (4) punchy palette + horizon glow, (5) parallax skyline, (6)
  exaggerated banking + speed lines, (7) light CRT/scanline overlay.

## Discipline

- **`npm run test:regress` is the gate.** Every phase touches verbs, the tick, move
  gates, and/or posture — all covered. Run it after each phase and before any push.
- **No startup migrations.** Any schema change (unlikely; the tables already exist)
  goes through `SCHEMA_SQL` + Relay deploy, never boot.
- **UTF-8, no BOM** — the cockpit/client files use box glyphs; preserve them.
- Update [docs/systems-flight.md](../systems-flight.md) as each phase lands (as-built),
  keeping this proposal as the intent-of-record.

## Success criteria (from the Feel doc)

Players read aircraft state from movement + instruments + sound alone; flight is
continuous from start to shutdown with no modal breaks; small inputs give smooth
predictable response while large inputs have real consequences; every aircraft has
weight and personality without real aerodynamics; the world below reads as the same
persistent Architect explored on foot; takeoffs satisfy, landings reward, helicopters
challenge, weather changes the flight without feeling unfair — a polished late-'90s
cockpit sim that is unmistakably Architect.
