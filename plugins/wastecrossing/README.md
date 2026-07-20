# wastecrossing

Void-travel **Slice 1 (walking skeleton)** — on-foot travel between regions across
the generated "void." Full design: [docs/systems-overland-void-travel.md](../../docs/systems-overland-void-travel.md).

## Purpose

Regions are islands with no authored corridor between them. `venture` from a
perimeter gate and this plugin generates a **linear chain of transient rooms** —
synthetic zones that live in the world store without a DB row (via the
`registerTransientZone` substrate in `server/engine/world.js`) — that you walk
south, room by room, until you're deposited at a distant region. The waste
swallows the road: there's no going back to a saved path, only forward or back
out the gate you came in.

This slice is the skeleton that proves the movement seam. It has **no** loot,
encounters, parties, ghost-traces, or frontier map yet — those are later slices
(2–6 in the design doc's build order).

### How it works

- **Geometry is a pure function** of `(gate, window, node)` — a seeded generator,
  so a relog regenerates byte-identical rooms. (The full design shares this seed
  per `(origin, window)` so a later slice can put parties on the same map; Slice 1
  namespaces room ids per player.)
- **Live state** `player._crossing` (roomIds/node) is read on every `zone.entered`
  — never the DB.
- **Durable state** `crossing_gate` / `crossing_window` / `crossing_node` in
  `player_flags` is the minimum to **re-derive** the crossing after a server
  restart (transient rooms are RAM-only). A same-session reconnect needs nothing.
- **Teardown** happens the moment you enter any non-void zone (arrived at the
  destination, bailed back out the gate, died, or teleported): the transient rooms
  are removed and the flags cleared, via the `zone.entered` event.

## Commands

- `venture` — strike out from a perimeter gate into the waste toward the region it
  leads to. No-op anywhere that isn't a configured gate; refused while already
  crossing.

## Events consumed

- `zone.entered` — track the current node as you move; tear the crossing down when
  you leave the void.
- `player.login` — after a server restart, re-derive the crossing and pull you
  back into the room you were in.

## Depends on

- **Transient-zone substrate** (`registerTransientZone` / `removeTransientZone` /
  `isTransientZone` in `server/engine/world.js`).
- `player_flags` (durable crossing state), `messaging.sendToPlayer` (relog push).

## Not yet built (later slices)

Branching map + encounters (2), ghost-traces (3), parties (4), loot/scavenging +
claim ledger (5), frontier map + gate readout (6). Routes are a hard-coded stub
here; later they're authored in the World Editor.
