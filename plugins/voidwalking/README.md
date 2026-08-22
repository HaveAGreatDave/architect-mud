# voidwalking

**Void-travel, as built.** On-foot travel between regions across the generated waste.
Full design and the movement seam: [docs/systems-overland-void-travel.md](../../docs/systems-overland-void-travel.md).

> This README described a "walking skeleton" with "**no** loot, encounters, parties,
> ghost-traces, or frontier map yet" for months after every one of those shipped, three
> lines above a manifest that declared the verbs for them. `npm run docs:readmes`
> ([scripts/docs/readmes.mjs](../../scripts/docs/readmes.mjs)) is now a push gate on exactly
> that: a verb `plugin.json` declares cannot be filed under work-not-done.

## Purpose

Regions are islands with no authored corridor between them. Step off the **rim** of a
void-region and this plugin generates a **braid** of transient rooms — synthetic zones
that live in the world store with no DB row (via `registerTransientZone` in
`server/engine/world.js`) — a shared trunk that forks toward several regions at once, with
dead-end detours and rejoining cuts hanging off it. You walk it, and it deposits you on
solid ground somewhere else. The waste swallows the road: there is no saved path back,
only forward or out the way you came.

**A room is a tile.** That is the single fact the rest of this follows from. One `south`
is one tile of ground, in the same coordinates a truck and an aircraft use, so a crossing
is 93 rooms to the Reach and 282 to Terminus rather than an abstract five to fifteen. It
is why the route is windowed rather than built in full, why encounters are tuned per tile
rather than per room, and why `march` had to exist.

### How it works

- **Geometry is a pure function** of `(void, window, salt)`, so a relog regenerates
  byte-identical rooms and everybody crossing the same void in the same week walks the same
  country. Room *ids* are namespaced per instance, so occupancy and teardown stay private.
- **The plan is not the window.** `plan` is the whole route, pure and unregistered;
  `roomSet` is the part currently materialised (a BFS skirt around every member). Two
  consumers deliberately read the plan and never the window — `crossingChain`, because a
  driver's odometer maps onto rooms nobody has walked to, and the relog re-derive.
- **Live state** is `player._crossing` (`{ instanceId, seen }`), read on every
  `zone.entered`, never the DB.
- **Durable state** is `crossing_*` in `player_flags` — the minimum to re-derive the
  crossing after a restart, since the rooms are RAM-only. `crossing_room` is flushed on
  logout, not per step. A same-session reconnect needs nothing.
- **Teardown** fires the moment you enter any non-void zone (arrived, bailed, died,
  teleported), announced as `crossing.ended` **before** the rooms go — the one thing that
  leaves this plugin, so trucking can recover what it parked out there without either side
  importing the other.

## Commands

- `march` — **the traversal verb.** Walks the trail and stops when there is something to
  decide. It is the ordinary move (`cmdMove('south')`, the same function `south` is bound
  to), one tile per two-second tick, so it removes the keystrokes and not the journey. See
  [march.js](march.js) for the three rules and the halt list.
- `camp` — the risky rest at a wayside camp or a `respite`/`shelter` highlight. Paid for in
  water, and it rolls for an ambush before it heals.
- `flag` — put your arm out at a wayside camp so a passing rig can see you. Has a lifetime;
  whether anybody stops is somebody else's decision.
- `loot` — scavenge a room, over the Scavenging skill and the 2d8−2d8 check. Detours are
  richer; once per room.
- `scrawl <≤4 chars>` — leave four letters in the hardpan for whoever crosses this week.
- `frontier` — the fogged map of routes you have charted and survived.
- `ready` — the muster's ready-check. Every member of the cohort readies before the
  crossing launches.
- `voidwalk` — **not an entry verb.** It survives only to serve the muster overlay's
  `cancel`/`say` sub-commands; you enter by walking off the rim.

## Hooks and events

- `movement.edge` (hook) — a cardinal step from a boundary tile into a coordinate that
  holds no tile at all. This is the way in.
- `zone.describeRoom` (hook) — the rim's own prose, and what a cut costs at the camp it
  leaves from.
- `zone.entered` — advance the window, show traces, roll an encounter. `mounted` suppresses
  the roll: a passenger in a cab sees the country and is not exposed to it.
- `player.login` / `player.logout` / `player.stop` / `player.command` / `crossing.ended`.

## Files

| file | holds |
|---|---|
| `index.js` | the voids table, the rim, the plan/window, encounters, salvage, the muster, traces, beacons |
| `march.js` | the traversal verb and its tick |
| `flavour.js` | the ground and the 32 authored highlights, keyed by terrain |
| `traces.js` | the ghost-trace store (`void_traces`), per void+window |

## Depends on

- **Transient-zone substrate** (`registerTransientZone` / `removeTransientZone` /
  `isTransientZone`).
- `player_flags` (durable crossing state), `messaging` (relog push, per-tile pane refresh),
  the Scavenging skill, `registerMoveGate`, and `room-brief.js`'s `stampToLog` so a marched
  tile reaches the log rung exactly as a walked one does.
- Optional, and it degrades to what shipped before them: `registerCrossingPoints` and
  `registerTrailCuts`, registered **from trucking** so the road's geometry decides where a
  room stands and where a cut leaves. With no provider the rooms are placeless and behave
  as they always did.

## Still design

Depth-scaling and credits-on-death. Routes remain a hard-coded table in `index.js` rather
than World Editor content.
