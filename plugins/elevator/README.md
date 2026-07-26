# elevator

**Purpose** — Lets a building stack its floors on separate z-levels and connect them with an elevator car instead of a stairwell, and lets that car present its stops as arbitrary display floor numbers (e.g. 50+) decoupled from the real `grid_z`. The car is an ordinary interior zone; the whole feature is data-driven off two zone flags.

## The contract

An elevator car zone carries:

```jsonc
"flags": {
  "elevator": true,
  "hide_exits": true,                                // suppress the engine exit list (see below)
  "elevator_floors": [
    { "n": 54, "zone": "zone_halcyon_exec",        "label": "Executive Suite" },
    { "n": 50, "zone": "zone_halcyon_concourse",   "label": "Halcyon Arcade" }
  ]
}
```

**Gated floors.** A ride is a teleport, so it would otherwise skip every law a walked
step obeys. `cmdFloor` runs the move-gate chain (`runMoveGates`) against the destination
before the doors seal, marked `bypassEncumbrance` so the walking laws (pacing cadence,
carry weight) stay out of it. A blocking gate refuses at the panel — that's how a
`flags.residents_only` amenity floor (the Solenne sky pad) is private by lift as well as
by door, with nothing to author here.

`n` is the number shown on the panel and typed by the player (`floor 54`); it is **independent** of the destination zone's `grid_z`. The content is still responsible for wiring real exits (an `up` multi-exit to every floor, each floor's `in` back to the car, and an `out` to the lobby) so NPC pathfinding and the zone-connectivity validator stay happy — this plugin only adds the numbered, teleporting convenience layer on top.

**Ground floor is implicit.** The panel always includes a **Floor 1 — Lobby** stop synthesized from the car's `out` exit, so the content never lists it and every car has a way down. Riding to it runs the same timed board→chime path (and reads as *descending*).

**NPCs use the real exits, not the panel.** The `floor` command / panel is a player convenience; NPCs (and the connectivity validator) path over the real `up`/`in`/`out` graph, which `hide_exits` does **not** touch — so keep those exits wired. Hiding is display-only. Their pathing works on destination **zone IDs**, so the shared `up` label never causes ambiguity — the planner already knows which floor. When an NPC steps into or out of a car, `moveEntity` (engine) reads `flags.elevator` and swaps the default "climbs the stairs" flavour for elevator lines ("*steps into the elevator*" / "*The elevator chimes and X steps out*").

## Player verbs

- `floor <n>` — while standing in the car, rides to floor `n`'s zone. The ride is **timed** (`travelMs()` scales with distance from the ground floor — a hop to the gym is quick, the penthouse is a haul, clamped 1.6–5s) with the counter ticking by mid-ride, and lands with an **arrival chime** (an actual bing-bong SFX to the rider, `SFX_ELEVATOR_CHIME`, plus the flavour line). Bare `floor` reprints the directory. Refuses cleanly when you're not in an elevator or the number isn't on the panel.
- **Bare number** — typing just `44` in a car is the same as `floor 44` ("enter the number only"). Outside a car a stray number is left alone (stays "unknown command").
- `up` / `down` in a car — do **not** ride the raw exit; they reprint the panel and point you at the number entry, so the timed ride is the only way between floors. Outside a car they're normal movement.
- **`1` / `floor 1`** — rides down to the ground-floor lobby (the implicit default stop).

## Hooks consumed

- `zone.describeRoom` — renders the clickable floor directory into an elevator car's room description, so LOOK always shows the buttons (each `[NN]` is an `action-link` sending `floor <n>`).

## Input matchers registered

- `/^\d+$/` — bare-number floor entry (car-only; falls through otherwise).
- `/^(up|down)$/i` — the in-car raw-direction redirect (car-only; falls through to movement otherwise).

## Events emitted

- `zone.entered` — on a successful ride, so movement-reactive systems (ambience, weather, quests) treat the arrival like any other move.

## Data schema

None. State is entirely in-content (the two zone flags).

## Extension points

- `zones.flags.elevator` / `zones.flags.elevator_floors` — any building can opt in by flagging a zone; nothing is hardcoded to Halcyon.
- `zones.flags.hide_exits` — a generic engine (describe.js) convention, not elevator-specific: any zone can suppress its player-facing exit/room/building list while keeping the graph intact. The elevator car opts in so the floor panel is the sole exit UI.
