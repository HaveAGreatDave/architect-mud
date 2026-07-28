# knock

**Purpose** — knocking on a door. Sound reaches **only the adjacent room on the same floor**, and never propagates outdoors — a knock is a private thing between two rooms.

## Commands
- `knock <dir>` — resolves the exit door via `exitTargets`.

## Discovery gap (known)
A directional, door-gated verb with no per-object tag anchor. The door examine set is a fixed hardcoded list that does not include `knock`. Same structural class as `shove`/`drag`.
