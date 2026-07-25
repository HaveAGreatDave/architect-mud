# AI Behaviour System (As Built)

VINE-powered behaviour trees for enemies and NPCs. Each entity can carry a `behaviour_graph` — a JSON graph authored in the dev panel — driven by `tickEntityAI`. The graph drives what the entity does each tick: patrol, attack, say something, flee, call allies.

**Tick rates differ by entity kind** and bound everything below: enemies tick **every 1 s** (the raw combat `tick` in [gameLoop.js:161](../server/engine/gameLoop.js#L161)), NPCs **every 1 minute** (`npcWanderTick`, [gameLoop.js:1243](../server/engine/gameLoop.js#L1243)). An NPC graph that walks one zone per tick moves one zone per game-minute — size waits and commutes accordingly.

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
  _roamNextAt:  0,      // timestamp — ROAM cooldown
  _fleeNextAt:  0,      // timestamp — FLEE retry throttle (one attempt per attack cycle)
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

`tickEntityAI(entity, ctx)` runs for every live enemy and NPC that has a `behaviour_graph`, at the per-kind rates above. It:

1. Yields the whole graph while a plugin has taken the entity over — `ai.alarm` (burglary), `ai.dosedOut` (npc-drugs), `ai.shopPaused` (a player has the shop open) — and skips any entity with no zone ([ai-behaviour.js:1658-1671](../server/engine/ai-behaviour.js#L1658)). Setting one of those flags is the supported way for a plugin to drive an NPC directly.
2. Returns if `ai.waitUntil` is in the future (WAIT node suspension).
3. Resumes from `ai.currentNode` if set, otherwise restarts from `_start`.
4. Walks the graph up to 50 steps (`MAX_STEPS`).
5. Stops at the first `action` node and executes it. A string result names the out port to follow (e.g. `CHECK_WORK`'s `goToWork`); `'RUNNING'` keeps the cursor on the action; anything else follows `next`.
6. WAIT nodes stop the walk, set `ai.waitUntil`, and save the cursor to the node after WAIT.

Execution is **stateful**: `ai.currentNode` persists between ticks so sequential graphs (`ATTACK → WAIT → SAY`) execute in order. When `ai.currentNode` is null (natural end or graph restart), the next tick starts from `_start`.

`ctx` carries `{ broadcast, query }`.

---

## Graph Format

There are **two** shapes, and hand-authored graphs must use the stored one. What lives in `behaviour_graph` (what `toAiGraph` writes) carries its connections **inline on each node** and its params flat — there is no `edges` array:

```js
{
  _start: 'nodeId',
  nodes: {
    check:  { type: 'condition', condition_type: 'AT_HOME', ifTrue: 'idle', ifFalse: 'go_home' },
    go_home:{ type: 'action', action_type: 'GO_HOME', next: 'check' },
  }
}
```

Recognised connection keys are `next`, `ifTrue`, `ifFalse`, `branch_N`, and the four `CHECK_VENDOR_WORK` ports (`goToWork`/`haveLife`/`endShift`/`offWork`); every other key becomes `node.data` ([ai-behaviour.js:524-553](../server/engine/ai-behaviour.js#L524)).

`normalizeGraph()` converts that to the runtime shape on first tick — `{ _start, nodes: { id: { type, data } }, edges: [{ fromNode, fromPort, toNode }], _normalized: true }` — caching it back onto the entity. It **builds the edges array from the inline keys and discards any `edges` array already present**, so a graph authored in VINE's own save format loses every connection. The `_normalized` flag is what keeps the conversion one-shot.

---

## Node Types

**Plugin-registered nodes.** The runner has a node registry
(`registerAICondition(type, fn)` / `registerAIAction(type, fn)` in
`ai-behaviour.js`) — unknown `condition_type`/`action_type` values fall through
to it, so plugins add node types without editing the engine switches.
Conditions are **sync by contract** (`fn(entity, params, { zone, zoneId }) →
boolean` — read caches, never the DB); actions may be async
(`fn(entity, params, { broadcast, query, ai, zone, zoneId, node }) →
port-string | 'RUNNING' | undefined`). The broadcast plugin registers
`CHANNEL_HAS_VIEWERS`, `IS_BROADCAST_SCHEDULED`, `AT_WORK_ZONE`, and
`BROADCAST_SAY` this way. `getRegisteredAINodes()` lists what plugins have added.

The editor's own catalogues (`AI_CONDITIONS`/`AI_ACTIONS` in
`client/devpanel/js/vine/vine-schema-ai.js`) are a separate list — a node type
only appears in the dropdown if it's added there too, and plugin-registered
types have to be added by hand.

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
| `TARGETABLE_IN_ZONE` | — | zone holds something this entity would actually fight — respects `flags.ignores_admins` / `attacks_npcs` / `attacks_enemies` (use this over `PLAYER_IN_ZONE` for aggro gates) |
| `TARGET_HP_BELOW` | `pct` (default 30) | target player HP% < pct |
| `FACTION_MATCH` | `faction` | target player is a member of org (corp/faction) `faction` — reads `org_members`, not a player field. NPC-faction-vs-player reactions key off reputation (a future condition), not this. |
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
| `FLEE` | — | Move to an adjacent zone that doesn't hold the target, then clear aggro. Gated by one break-contact roll per attack cycle (`ai._fleeNextAt`): `flee_skill + (2d8−2d8)` vs difficulty 6, where `flee_skill` = `flags.flee_skill`, else the combat `dodge` stat, else 1; a fail keeps aggro and stays put. **Skipped when a player is actively pressing the attack** — `moveEntity` gates every mob tile-exit itself, so rolling here too would charge two checks for one escape. The editor exposes a `max_distance` param the engine ignores |
| `ROAM` | `interval_s` (default 10) | Step to a random adjacent zone every N seconds, unless something targetable is already here (same flag rules as `TARGETABLE_IN_ZONE`). Hunt-by-wandering, vs. PATROL's fixed route |
| `SAY` | `message`, `cooldown_s`, `once: bool` | Broadcast message to zone; respects cooldown and once-flag. A studio NPC away from its `studio_zone_id` never delivers the authored line — it falls back to chitchat |
| `CALL_BACKUP` | `radius`, `faction_only: bool` | Alert same-faction enemies/NPCs within radius to adopt entity's target (30s cooldown) |
| `TELEPORT` | `zone_id` | Instantly move entity. **Not persisted** — `moveEntity` never writes `zone_id`, so every AI-driven position is RAM-only and boot re-places NPCs at `home_zone` |
| `IDLE` | — | No-op; useful as the terminal action in a branch |
| `SET_FLAG` | `scope: 'self'`, `flag`, `value` | Write to blackboard flags (self-scope only; world-scope is a no-op currently) |
| `EMOTE` | `message` | Broadcast `"NpcName <message>"` to the NPC's current zone (e.g. `"waves at the camera"`) |
| `BROADCAST_SAY` | `channel_id`, `text` | Inject a line of dialogue into a broadcast channel feed as this NPC |
| `START_QUEST` | `quest_id`, `cooldown_s` | Offer a quest (dispatch the quests plugin's `START_QUEST`) to every player in the entity's zone. Per-player/per-quest cooldown via the blackboard so it fires once, not every tick; the plugin no-ops if the player already has it. Editor renders a jump into that quest's VINE editor. |
| `GO_TO_WORK` | `zone_id?`, `arrive_by?` (hour), `depart_early_minutes?` | Commute to `zone_id` ?? `work_zone_id` ?? `studio_zone_id` ?? the broadcast-schedule studio, several zones per tick; returns RUNNING until arrived. **Checks no schedule of its own** — with `zone_id` + `arrive_by` it holds until the commute window opens, otherwise it leaves immediately, so gate it behind `CHECK_WORK`/`CHECK_VENDOR_WORK`. Destinations resolve facade → interior entry |
| `HAVE_LIFE` | `waypoints?: [zone_id]` | If not scheduled, walk toward `home_zone` or a random waypoint. No-ops when scheduled. Does NOT return RUNNING — graph continues each tick. **Studio actors:** when off-shift and still inside their studio building (same interior map as their studio zone), walk out to the exterior world tile first — one step per tick — before any random activity; once outside, the normal wander resumes. |
| `AT_WORK` | — | No-op that marks the "at work" position in the graph. Keeps NPC in place during scheduled hours; graph re-checks schedule on next loop. |
| `CHECK_WORK` | — | 2-way branch for studio NPCs. Ports: `goToWork` (scheduled now), `haveLife` (off-shift, or no studio assigned) |
| `GO_HOME` | — | Walk toward `entity.home_zone`; returns RUNNING until arrived |
| `GO_TO_STUDIO` | — | Walk toward the studio zone derived from the NPC's broadcast schedule; returns RUNNING until arrived |
| `CHECK_VENDOR_WORK` | — | 4-way branch for vendor NPC routine. Ports: `goToWork` (work time + has work zone), `haveLife` (work time, no zone), `endShift` (shift just ended), `offWork` (off-duty). Reads `npc_type=vendor` schedule from `vendor_schedule`. |
| `VENDOR_CHITCHAT` | — | Say a random line from `entity.chitchat` to the zone; 60s cooldown |
| `VENDOR_COLLECT_SAFE` | — | Find linked vendor-safe furniture in `work_zone_id`, take 25% of `vendor_credits`, broadcast to zone |
| `VENDOR_GO_TO_ATM` | — | Find nearest non-broken ATM furniture globally (BFS), walk toward it; returns RUNNING until arrived |
| `VENDOR_DEPOSIT` | — | Add `blackboard.vendor_carrying` to `vendor_bank_credits` in DB; broadcast confirmation |
| `AT_HOME_LIFE` | — | Owns the sleep cycle only (the random home activities come from the passive home-life ticker in `tickEntityAI`). 15% chance/tick to fall asleep until 1 game-hour before the next `vendor_schedule` shift, or 07:00 game time with no schedule. On sleep it sets a real posture through the engine substrate — `setPosture(entity, 'lying', { sittingOn })` bound to a bed/couch/etc. in the room (floor fallback, `sittingOn=null`) — and back to `standing` on wake. `ai.homeSleeping` is the *asleep* flag; `entity.posture === 'lying'` is the *physical stance*, so they stay separable |
| `TALKSHOW_APPEAR` | — | Guest lifecycle (broadcast plugin's default guest graph): materialise out of the off-world backstage `home_zone` into a random **unobserved** zone near the studio, so no player sees it pop in. `GO_TO_WORK` then walks it onstage |
| `TALKSHOW_HIDE` | — | The reverse: vanish back to `home_zone` the moment the current zone has no players and no camera on it; otherwise step toward the studio's exterior and re-check |

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

## Default Behaviour Graphs

`ensureBehaviourGraph(entity, kind)` assigns a type-appropriate default to any entity that has none, at load and at creation. It never touches an entity that already carries a graph, `_phantom` opt-outs, non-aggressive enemies, or plain untyped `npc` set-pieces. Four builders ([ai-behaviour.js:1498-1590](../server/engine/ai-behaviour.js#L1498)):

| Builder | For | Shape |
|---|---|---|
| `buildDefaultStudioGraph` | broadcast staff | `start → HAVE_LIFE → GO_TO_WORK → AT_WORK → GO_HOME → wait(60) → start` |
| `buildDefaultVendorGraph` | vendors + anyone on a `vendor_schedule` | `CHECK_VENDOR_WORK` 4-way loop; end-of-shift branch runs collect-safe → ATM → deposit, then weights home vs. wander |
| `buildDefaultUnemployedGraph` | unemployed NPCs | `HAVE_LIFE` loop, with `AT_HOME_LIFE` taking over at home |
| `buildDefaultAggressiveEnemyGraph` | `aggressive`/`territorial` enemies | attack, but branch to `FLEE` below 20% HP. Target *acquisition* stays with the engine's escalating-aggro ramp in gameLoop, not the graph |

Studio graph per cycle:
- **Off-schedule**: `HAVE_LIFE` walks toward `home_zone` (or supplied waypoints). If the actor is still inside the studio building it first walks out to the exterior tile (one step/tick), so only scheduled actors remain on the stage. `GO_TO_WORK` and `AT_WORK` no-op.
- **Scheduled, not at studio**: `HAVE_LIFE` no-ops; `GO_TO_WORK` commutes (RUNNING until arrived).
- **Scheduled, at studio**: `AT_WORK` holds RUNNING; when the shift ends it falls through to `GO_HOME`.

---

## Authoring in the Dev Panel

Behaviour graphs are authored with `VineAISchema` from the dev panel's Enemies or NPCs panel (see [vine.md](vine.md)); `fromAiGraph`/`toAiGraph` convert between the stored inline shape above and the editor's graph.

The stored graph lives in `enemies.behaviour_graph` or `npcs.behaviour_graph` (JSONB). The runtime reads it directly from the in-memory world cache (loaded at boot or zone-reload).

---

## Pathfinding

Every routed move — PATROL walk mode, the commutes (`GO_TO_WORK`/`GO_HOME`/`GO_TO_STUDIO`/`VENDOR_GO_TO_ATM`), and the ESP evacuation — goes through `findPath`. FLEE and ROAM don't route: they pick from the current zone's immediate exits. [pathfinding.js](../server/engine/pathfinding.js) exports:

- `findPath(startId, targetId, { maxDistance = 60, roads = false, avoid = null })` — array of zone IDs from start to target (inclusive), or `null` if unreachable within maxDistance hops. `roads: true` runs a road-preferring least-cost search instead of plain BFS.
- `getZonesInRadius(originId, maxHops)` — BFS out to `maxHops`; returns a Map of `zone_id → distance`. Used by CALL_BACKUP.

`ai-behaviour.js` shadows the raw import with its own wrapper ([ai-behaviour.js:254](../server/engine/ai-behaviour.js#L254)): NPCs path with `roads: true` so they commute along streets instead of cutting through buildings; enemies keep the direct BFS line.

Pathfinding crosses map and interior/exterior boundaries freely — exits JSONB already encodes those connections.

---

## Known Limitations

- **World-scope flags** are blackboard-only: `SET_FLAG` with `scope: 'world'` is a no-op, and the `FLAG_SET` condition falls back to the blackboard rather than reading `world_flags`. Pending a decision on async DB writes in the tick loop.
- **Nothing an entity does through the graph persists.** Blackboards are in-memory, and `moveEntity` never writes `zone_id` — patrol progress, self-flags, and current position are all lost on restart (boot re-places NPCs at `home_zone`).
