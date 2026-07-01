# AI Behaviour System (As Built)

VINE-powered behaviour trees for enemies and NPCs. Each entity can carry a `behaviour_graph` — a JSON graph authored in the dev panel — that is ticked once per second by `tickEntityAI`. The graph drives what the entity does each tick: patrol, attack, say something, flee, call allies.

Primary file: [ai-behaviour.js](../server/engine/ai-behaviour.js). Uses [pathfinding.js](../server/engine/pathfinding.js) for BFS movement and is ticked from [gameLoop.js](../server/engine/gameLoop.js).

---

## Runtime Model

Each entity (enemy or NPC) that has a `behaviour_graph` gets a **blackboard** — a per-instance mutable state bag — stored in `entity._ai`:

```js
{
  currentNode:  null,   // execution cursor — node ID to resume from next tick (null = restart from _start)
  waitUntil:    null,   // timestamp — entity is suspended until this time
  patrolTarget: null,   // zone_id currently walking toward
  patrolPath:   [],     // remaining BFS path steps to patrolTarget
  patrolMode:   'walk',
  patrolIndex:  0,      // current index into PATROL.waypoints
  alertCooldown: 0,     // timestamp — CALL_BACKUP debounce
  lastSay:      0,      // timestamp — SAY debounce
  flags:        {},     // SET_FLAG scope:self values
  // Vendor-specific
  vendor_was_working: false, // true while on a scheduled shift
  vendor_carrying:    0,     // credits extracted from safe, en route to ATM
  vendor_atm_zone:    null,  // cached nearest ATM zone for deposit run
  // Home life
  homeSleeping:    false,    // true while asleep at home (AT_HOME_LIFE)
  lastHomeSay:     0,        // passive home activity cooldown (30s)
}
```

`initBlackboard()` creates a fresh blackboard. Blackboards are in-memory only — they do not persist across server restarts.

### Tick

`tickEntityAI(entity, ctx)` is called each second (via `gameLoop.js`) for every live enemy and NPC that has a `behaviour_graph`. It:

1. Returns immediately if `ai.waitUntil` is in the future (WAIT node suspension).
2. Resumes from `ai.currentNode` if set, otherwise restarts from `_start`.
3. Walks the graph up to 50 steps.
4. Stops at the first `action` node, executes it, and saves the cursor to the next node.
5. WAIT nodes stop the walk, set `ai.waitUntil`, and save the cursor to the node after WAIT.

Execution is **stateful**: `ai.currentNode` persists between ticks so sequential graphs (`ATTACK → WAIT → SAY`) execute in order. When `ai.currentNode` is null (natural end or graph restart), the next tick starts from `_start`.

`ctx` carries `{ broadcast, query }`.

---

## Graph Format

The stored JSON differs slightly from the VINE save format — the runtime uses `_start` rather than `start` and edges are resolved inline:

```js
{
  _start: 'nodeId',
  nodes: {
    nodeId: { type, data: { ... } }
  },
  edges: [
    { fromNode: 'n1', fromPort: 'next', toNode: 'n2' }
  ]
}
```

Edges are looked up by `(fromNode, fromPort)` to find the `toNode`. This is the same edge model used by [VINE](vine.md).

---

## Node Types

### `start`

Entry point. No data. Out port: `next`.

### `condition`

Evaluates a condition and branches.

**Data:** `{ condition_type, params }`

Out ports: `ifTrue`, `ifFalse`.

| `condition_type` | Params | Returns true when |
|---|---|---|
| `HAS_TARGET` | — | entity has a `targetId` set |
| `HP_BELOW` | `pct` (default 30) | entity HP% < pct |
| `HP_ABOVE` | `pct` (default 70) | entity HP% > pct |
| `IN_ZONE` | `zone_id` | entity is in zone_id |
| `PLAYER_IN_ZONE` | `min` (default 1) | zone has ≥ min players |
| `TARGET_HP_BELOW` | `pct` (default 30) | target player HP% < pct |
| `FACTION_MATCH` | `faction` | target player's faction === faction |
| `FLAG_SET` | `scope`, `flag` | blackboard flag is truthy (scope:self only; world flags fall back to blackboard) |
| `RANDOM_CHANCE` | `chance` (default 0.5) | Math.random() < chance |
| `IS_DAYTIME` | — | world timePhase is day/dawn/dusk |
| `CHANNEL_HAS_VIEWERS` | `channel_id` | at least one player is watching `channel_id` on a TV |
| `HOUR_RANGE` | `from`, `to` (0–23) | current game hour is within the range (wraps midnight) |
| `IS_BROADCAST_SCHEDULED` | — | NPC is in npc_staff for a currently-active daily schedule slot |
| `AT_WORK_ZONE` | — | NPC is already in their assigned broadcast studio zone |
| `IS_VENDOR_WORK_TIME` | — | Current day+hour falls within the vendor NPC's `vendor_schedule` |
| `AT_HOME` | — | NPC is in their `home_zone` |

### `action`

Executes one action and stops the tick. The cursor is saved to the `next` port's target so the following tick resumes from there rather than restarting from `_start`. If the action returns `'RUNNING'` (currently only PATROL walk mode does this), the cursor stays at the action node and it re-executes next tick.

**Data:** `{ action_type, params }`

| `action_type` | Params | Effect |
|---|---|---|
| `ATTACK` | — | Attack `entity.targetId`; applies damage, triggers death if HP ≤ 0; respects `first_strike_delay_ms` flag |
| `ACQUIRE_TARGET` | `prefer: 'lowest_hp' \| 'random'` | Pick a player from the current zone as target |
| `DROP_TARGET` | — | Clear `targetId`, `aggroedAt`; reset patrol state |
| `PATROL` | `waypoints: [zone_id]`, `loop: bool`, `mode: 'walk' \| 'teleport'` | Step toward next waypoint; walk mode uses BFS (one zone per tick) |
| `FLEE` | — | Move to an adjacent zone that doesn't contain the target |
| `SAY` | `message`, `cooldown_s`, `once: bool` | Broadcast message to zone; respects cooldown and once-flag |
| `CALL_BACKUP` | `radius`, `faction_only: bool` | Alert same-faction enemies/NPCs within radius to adopt entity's target (30s cooldown) |
| `TELEPORT` | `zone_id` | Instantly move entity; persists `zone_id` to DB for NPCs |
| `IDLE` | — | No-op; useful as the terminal action in a branch |
| `SET_FLAG` | `scope: 'self'`, `flag`, `value` | Write to blackboard flags (self-scope only; world-scope is a no-op currently) |
| `EMOTE` | `message` | Broadcast `"NpcName <message>"` to the NPC's current zone (e.g. `"waves at the camera"`) |
| `BROADCAST_SAY` | `channel_id`, `text` | Inject a line of dialogue into a broadcast channel feed as this NPC |
| `GO_TO_WORK` | — | If scheduled (`IS_BROADCAST_SCHEDULED`) and not already at work zone, walk toward the studio; returns RUNNING while en route. No-ops otherwise. |
| `HAVE_LIFE` | `waypoints?: [zone_id]` | If not scheduled, walk toward `home_zone` or a random waypoint. No-ops when scheduled. Does NOT return RUNNING — graph continues each tick. |
| `AT_WORK` | — | No-op that marks the "at work" position in the graph. Keeps NPC in place during scheduled hours; graph re-checks schedule on next loop. |
| `GO_TO_WORK` (old) | `zone_id`, `arrive_by`, `depart_early_minutes` | Timed commute to a specific zone; superseded by the parameterless `GO_TO_WORK` above for studio NPCs |
| `GO_HOME` | — | Walk toward `entity.home_zone`; returns RUNNING until arrived |
| `GO_TO_STUDIO` | — | Walk toward the studio zone derived from the NPC's broadcast schedule; returns RUNNING until arrived |
| `CHECK_VENDOR_WORK` | — | 4-way branch for vendor NPC routine. Ports: `goToWork` (work time + has work zone), `haveLife` (work time, no zone), `endShift` (shift just ended), `offWork` (off-duty). Reads `npc_type=vendor` schedule from `vendor_schedule`. |
| `VENDOR_CHITCHAT` | — | Say a random line from `entity.chitchat` to the zone; 60s cooldown |
| `VENDOR_COLLECT_SAFE` | — | Find linked vendor-safe furniture in `work_zone_id`, take 25% of `vendor_credits`, broadcast to zone |
| `VENDOR_GO_TO_ATM` | — | Find nearest non-broken ATM furniture globally (BFS), walk toward it; returns RUNNING until arrived |
| `VENDOR_DEPOSIT` | — | Add `blackboard.vendor_carrying` to `vendor_bank_credits` in DB; broadcast confirmation |
| `AT_HOME_LIFE` | — | NPC does random home-life activities when players are watching; 15% chance/tick to fall asleep until 1h before next shift (or 7am for NPCs with no schedule). Handles wake-up on re-entry. |

### `wait`

Suspends the entity for N seconds. The cursor is saved to the `next` port's target; when the timer expires the graph resumes from that node rather than restarting from `_start`.

**Data:** `{ seconds }` — Out port: `next`.

### `loop`

Jumps to the connected node (via `next`) without stopping execution. If unconnected, jumps back to `_start`. Use this at the end of a branch to cycle the graph and re-evaluate conditions each tick, instead of relying on the implicit restart when a graph ends naturally.

**Data:** none — Out port: `next`.

### `random`

Weighted random branch. Picks one of N branches by weight and follows that port.

**Data:**
```js
{ branches: [{ weight: number }, ...] }
```
Out ports: `branch_0`, `branch_1`, … (one per entry).

---

## Default Studio Behaviour Graph

When a broadcast channel's playlist is saved with NPC staff, any NPC that has an empty `behaviour_graph` is automatically assigned the following default graph:

```
start → HAVE_LIFE → GO_TO_WORK → AT_WORK → wait(30) → loop
```

Behaviour per cycle:
- **Off-schedule**: `HAVE_LIFE` walks toward `home_zone` (or supplied waypoints). `GO_TO_WORK` and `AT_WORK` no-op.
- **Scheduled, not at studio**: `HAVE_LIFE` no-ops. `GO_TO_WORK` navigates one step toward studio (RUNNING until arrived). `AT_WORK` no-op.
- **Scheduled, at studio**: All three no-op. NPC stays put.

The 30-second wait keeps the re-check at a reasonable pace without hammering the engine tick. NPCs with hand-authored graphs are unaffected.

---

## Authoring in the Dev Panel

Behaviour graphs are authored in the VINE editor in the dev panel's Enemies or NPCs panel. The VINE schema for behaviour graphs mirrors the node types above.

The stored graph lives in `enemies.behaviour_graph` or `npcs.behaviour_graph` (JSONB). The runtime reads it directly from the in-memory world cache (loaded at boot or zone-reload).

---

## Pathfinding

PATROL's walk mode and FLEE both use BFS over the zone exits graph. [pathfinding.js](../server/engine/pathfinding.js) exports:

- `findPath(startId, targetId, { maxDistance = 60 })` — returns an array of zone IDs from start to target (inclusive), or `null` if unreachable within maxDistance hops.
- `getZonesInRadius(startId, radius)` — BFS out to `radius` hops; returns a Map of `zone_id → distance`. Used by CALL_BACKUP.

Pathfinding crosses map and interior/exterior boundaries freely — exits JSONB already encodes those connections.

---

## Known Limitations

- **World-scope flags** in `FLAG_SET`/`FLAG_SET` conditions fall back to the in-memory blackboard rather than hitting the DB. World flag persistence via `SET_FLAG` for AI is a no-op pending a design decision on async DB writes in the hot tick loop.
- **NPC movement** from PATROL/FLEE/TELEPORT is not broadcast to nearby players (no "arrives/leaves" message), unlike enemies.
- **Blackboards reset on restart** — any runtime AI state (patrol progress, flags) is lost. Persistent cross-restart state needs a DB column.
