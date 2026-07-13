# pacing

**Purpose** — paces player movement so the large world feels large. Two layers: a
short walk cadence (a per-step cooldown via a `registerMoveGate` gate) that paces
travel, and a `sprint` toggle that spends stamina per step for a faster burst
cadence, auto-dropping you to a "winded" walk when stamina runs low. **Roads (and
marked arteries) halve the cadence (`ROAD_SPEEDUP=2`)** so travel along the street
grid is ×2 — the same grid the GPS router prefers; open water is impassable
(handled upstream by the `engine:water` move gate). A too-fast step
is **queued, not rejected** — type `n n n e` and you're walked along at cadence
instead of hitting a wall of errors. System-driven relocations
(`opts.bypassEncumbrance`) and drained steps (`opts._pacingDrain`) are exempt.

## Registered verbs

- `sprint [on|off]` — toggle sprint (bare `sprint` flips it). Refused while winded
  (until stamina recovers to `WINDED_RECOVER`) or below `SPRINT_FLOOR`.

## Events consumed

- `zone.entered` — after a committed move: stamps the cadence clock
  (`player._lastStepAt`), and on a sprint step deducts `SPRINT_COST` stamina, trips
  the winded transition below `SPRINT_FLOOR`, and pushes the `sta` HUD bar via
  `sendToPlayer`. Skipped for system moves (`opts.bypassEncumbrance`).

## Move gate

- `pacing:cadence` — a step that arrives before the walk/sprint cooldown elapses is
  enqueued (`player._moveQueue`, cap `MAX_QUEUE`) and the gate returns a **silent**
  block (`{block, silent}` → `cmdMove` returns null, no error line). A self-scheduling
  drain replays each queued step through `cmdMove` at cadence, pushing the result via
  `sendToPlayer`. A wall (locked door, encumbrance, no exit) ends the run and drops
  the rest of the queue. Exempt for `opts.bypassEncumbrance` and drained
  (`opts._pacingDrain`) steps.

## Transient player state (in-memory, never persisted)

- `player._lastStepAt` — epoch ms of the last committed step (cadence clock)
- `player._sprinting` — sprint toggle
- `player._winded` — set on auto-drop; blocks re-enable until `stamina >= WINDED_RECOVER`
- `player._moveQueue` — pending `[{direction, opts}]` steps
- `player._moveTimer` — the armed drain timeout handle (or null)

## Tunables (module consts in `index.js`)

`WALK_COOLDOWN_MS=900`, `SPRINT_COOLDOWN_MS=350`, `SPRINT_COST=8`,
`SPRINT_FLOOR=15`, `WINDED_RECOVER=40`, `MAX_QUEUE=12`, `ROAD_SPEEDUP=2`.

## Dependencies

None. Reuses the existing stamina resource (`players.stamina`/`stamina_max`, the
`sta` HUD bar, and the `resourceTick` regen in `server/engine/gameLoop.js`).
