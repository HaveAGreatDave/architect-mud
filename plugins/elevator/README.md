# elevator

**Purpose** — Lets a building stack its floors on separate z-levels and connect them with an elevator car instead of a stairwell, and lets that car present its stops as arbitrary display floor numbers (e.g. 50+) decoupled from the real `grid_z`. The car is an ordinary interior zone; the whole feature is data-driven off two zone flags.

## The contract

An elevator car zone carries:

```jsonc
"flags": {
  "elevator": true,
  "elevator_floors": [
    { "n": 54, "zone": "zone_halcyon_exec",        "label": "Executive Suite" },
    { "n": 50, "zone": "zone_halcyon_concourse",   "label": "Halcyon Arcade" }
  ]
}
```

`n` is the number shown on the panel and typed by the player (`floor 54`); it is **independent** of the destination zone's `grid_z`. The content is still responsible for wiring real exits (an `up` multi-exit to every floor, and each floor's `in` back to the car) so NPC pathfinding and the zone-connectivity validator stay happy — this plugin only adds the numbered, teleporting convenience layer on top.

## Player verbs

- `floor <n>` — while standing in the car, rides to floor `n`'s zone (a flavoured teleport). Bare `floor` reprints the directory. Refuses cleanly when you're not in an elevator or the number isn't on the panel.

## Hooks consumed

- `zone.describeRoom` — renders the clickable floor directory into an elevator car's room description, so LOOK always shows the buttons (each `[NN]` is an `action-link` sending `floor <n>`).

## Events emitted

- `zone.entered` — on a successful ride, so movement-reactive systems (ambience, weather, quests) treat the arrival like any other move.

## Data schema

None. State is entirely in-content (the two zone flags).

## Extension points

- `zones.flags.elevator` / `zones.flags.elevator_floors` — any building can opt in by flagging a zone; nothing is hardcoded to Halcyon.
