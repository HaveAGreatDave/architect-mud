# AI Behaviour System (As Built)

VINE-powered behaviour trees for enemies and NPCs. Each entity can carry a `behaviour_graph` — a JSON graph authored in the dev panel — that is ticked once per second by `tickEntityAI`. The graph drives what the entity does each tick: patrol, attack, say something, flee, call allies.

Primary file: [ai-behaviour.js](../server/engine/ai-behaviour.js). Uses [pathfinding.js](../server/engine/pathfinding.js) for BFS movement and is ticked from [gameLoop.js](../server/engine/gameLoop.js).

---

## Runtime Model

Each entity (enemy or NPC) that has a `behaviour_graph` gets a **blackboard** — a per-instance mutable state bag — stored in `entity._ai`:

```js
{
  waitUntil:    null,   // timestamp — entity is suspended until this time
  patrolTarget: null,   // zone_id currently walking toward
  patrolPath:   [],     // remaining BFS path steps to patrolTarget
  patrolMode:   'walk',
  patrolIndex:  0,      // current index into PATROL.waypoints
  alertCooldown: 0,     // timestamp — CALL_BACKUP debounce
  lastSay:      0,      // timestamp — SAY debounce
  flags:        {},     // SET_FLAG scope:self values
}
```

`initBlackboard()` creates a fresh blackboard. Blackboards are in-memory only — they do not persist across server restarts.

### Tick

`tickEntityAI(entity, ctx)` is called each second (via `gameLoop.js`) for every live enemy and NPC that has a `behaviour_graph`. It:

1. Returns immediately if `ai.waitUntil` is in the future (WAIT node suspension).
2. Walks the graph from `_start`, up to 50 steps.
3. Stops at the first `action` node it reaches and executes it (one action per tick).
4. WAIT nodes also stop the walk and set `ai.waitUntil`.

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

### `action`

Executes one action and stops the tick. Out port: `next` (not followed — next tick restarts from `_start`).

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

### `wait`

Suspends the entity for N seconds. On the next tick after `waitUntil` expires, the graph restarts from `_start` (not from the node after `wait`).

**Data:** `{ seconds }` — Out port: `next` (also not followed for the same reason).

### `random`

Weighted random branch. Picks one of N branches by weight and follows that port.

**Data:**
```js
{ branches: [{ weight: number }, ...] }
```
Out ports: `branch_0`, `branch_1`, … (one per entry).

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
