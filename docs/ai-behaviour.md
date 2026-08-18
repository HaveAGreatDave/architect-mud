# AI Behaviour System (As Built)

VINE-powered behaviour trees for enemies and NPCs. Each entity can carry a `behaviour_graph` — a JSON graph authored in the dev panel — driven by `tickEntityAI`. The graph drives what the entity does each tick: patrol, attack, say something, flee, call allies.

**Tick rates differ by entity kind** and bound everything below: enemies tick **every 1 s** (the raw combat `tick` in [gameLoop.js:161](../server/engine/gameLoop.js#L161)), NPCs **every 15 s** (`npcWanderTick`, [gameLoop.js:1243](../server/engine/gameLoop.js#L1243)). An NPC graph that walks one zone per tick therefore moves **4 zones per real minute**; a commuter walks `COMMUTE_STEPS_PER_TICK = 4` per tick, so **16**. Size waits accordingly, and note the two clocks are different units — real minutes for movement, game minutes (scaled by `state.timeScale`) for anything schedule-driven. `NPC_TICK_SECONDS` in `ai-behaviour.js` mirrors the cadence and must be changed with it.

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
  homeAwakeSince:  0,        // when this stretch of waking home life began (edge-detected on arrival)
  wokenUntil:      0,        // held awake after being disturbed — no straight back to bed
  sleepStartedAt:  0,        // when they went under (feeds sleep depth)
  disturbCount:    0,        // disturbances this sleep; each makes the next likelier to land
  wokeMood:        null,     // { mood: 'annoyed'|'confused', until } — read by the passive ticker
  _wasHome:        false,    // edge-detect for arriving home
  // Set by npc-drugs, read by the engine
  crashSleepy:     0,        // stimulant comedown — AT_HOME_LIFE raises the sleep chance while set
}
```

`initBlackboard()` creates a fresh blackboard. Blackboards are in-memory only — they do not persist across server restarts.

### Tick

`tickEntityAI(entity, ctx)` runs for every live enemy and NPC that has a `behaviour_graph`, at the per-kind rates above. It:

1. Yields the whole graph while a plugin has taken the entity over — `ai.alarm` (burglary), `ai.dosedOut` (npc-drugs), `ai.shopPaused` (a player has the shop open) — and skips any entity with no zone ([ai-behaviour.js:1658-1671](../server/engine/ai-behaviour.js#L1658)). Setting one of those flags is the supported way for a plugin to drive an NPC directly.
   **`shopPaused` is DERIVED, not trusted**: the tick yields only while the shopper is still a live player standing in the NPC's zone, and otherwise closes the stale session and clears the flag itself. `closeShopSession` is reachable from just three places (the client's `shop_close`, a disconnect, and `cmdMove`), while a player's `current_zone` is rewritten by a dozen others — sleep, death/respawn, jail, elevators, flight, apartment entry, VINE teleports. Leaving a shop open via any of those used to strand `shopPaused` set for the life of the process, freezing that vendor at their counter with no commute, wander or banter until a restart. Never hunt the call sites; the derivation covers whatever teleport gets added next.
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

Executes one action and stops the tick. The cursor is saved to the `next` port's target so the following tick resumes from there rather than restarting from `_start`. If the action returns `'RUNNING'`, the cursor stays at the action node and it re-executes next tick — that is how every multi-tick move works (`PATROL` walk mode, `CHASE`, `GO_TO_WORK`, `GO_HOME`, `GO_TO_STUDIO`, `VENDOR_GO_TO_ATM`, `AT_WORK`, `AT_HOME_LIFE`).

**Data:** `{ action_type, params }`

| `action_type` | Params | Effect |
|---|---|---|
| `ATTACK` | — | Attack `entity.targetId`; applies damage, triggers death if HP ≤ 0; respects `first_strike_delay_ms` flag |
| `ACQUIRE_TARGET` | `prefer: 'lowest_hp' \| 'random'` | Pick a player from the current zone as target |
| `DROP_TARGET` | — | Clear `targetId`, `aggroedAt`; reset patrol state |
| `PATROL` | `waypoints: [zone_id]`, `loop: bool`, `mode: 'walk' \| 'teleport'` | Step toward next waypoint; walk mode uses BFS (one zone per tick) |
| `FLEE` | — | Move to an adjacent zone that doesn't hold the target, then clear aggro. Gated by one break-contact roll per attack cycle (`ai._fleeNextAt`): `flee_skill + (2d8−2d8)` vs difficulty 6, where `flee_skill` = `flags.flee_skill`, else the combat `dodge` stat, else 1; a fail keeps aggro and stays put. **Skipped when a player is actively pressing the attack** — `moveEntity` gates every mob tile-exit itself, so rolling here too would charge two checks for one escape. Takes **no params**: it is one hop to an adjacent zone and then it drops the target, so there is no multi-hop retreat for a distance to bound (the editor used to offer a `max_distance` the engine never read) |
| `CHASE` | `quarry: 'target' \| 'flag'`, `flag` (default `suspect_id`), `wander_pct` (0–1) | Follow a quarry between zones, one step per `flags.chase_speed_s` (default 2s). **Opt-in by construction:** a creature whose graph has no CHASE node drops its target the instant you leave the room, which is exactly how every enemy behaved before pursuit existed, so nothing that shipped earlier changed. `quarry:'target'` follows `entity.targetId`; `quarry:'flag'` follows the player id stored in `entity.flags[flag]`, which lets a unit pursue somebody it is deliberately **not** targeting (a manhunt unit that must arrive and detain rather than kill). Bounded in space by the leash and in time by `CHASE_TIMEOUT_MS` (20s without arriving) — except in `'flag'` mode, which is a persistent hunt and skips the timeout. `wander_pct` injects imprecision so a hunt reads as searching rather than cursor-snapping |
| `ROAM` | `interval_s` (default 10) | Step to a random adjacent zone every N seconds, unless something targetable is already here (same flag rules as `TARGETABLE_IN_ZONE`). Hunt-by-wandering, vs. PATROL's fixed route |
| `SAY` | `message`, `cooldown_s`, `once: bool` | Broadcast message to zone; respects cooldown and once-flag. A studio NPC away from its `studio_zone_id` never delivers the authored line — it falls back to chitchat |
| `CALL_BACKUP` | `radius`, `faction_only: bool` | Alert same-faction enemies/NPCs within radius to adopt entity's target (30s cooldown) |
| `TELEPORT` | `zone_id` | Instantly move entity. **Not persisted** — `moveEntity` never writes `zone_id`, so every AI-driven position is RAM-only and boot re-places NPCs at `home_zone` |
| `IDLE` | — | No-op; useful as the terminal action in a branch |
| `SET_FLAG` | `scope: 'self'`, `flag`, `value` | Write to blackboard flags (self-scope only; world-scope is a no-op currently) |
| `EMOTE` | `message` | Broadcast `"NpcName <message>"` to the NPC's current zone (e.g. `"waves at the camera"`) |
| `BROADCAST_SAY` | `channel_id`, `text` | Inject a line of dialogue into a broadcast channel feed as this NPC |
| `START_QUEST` | `quest_id`, `cooldown_s` | Offer a quest (dispatch the quests plugin's `START_QUEST`) to every player in the entity's zone. Per-player/per-quest cooldown via the blackboard so it fires once, not every tick; the plugin no-ops if the player already has it. Editor renders a jump into that quest's VINE editor. |
| `GO_TO_WORK` | `zone_id?`, `arrive_by?` (hour), `depart_early_minutes?` | Commute to `zone_id` ?? `work_zone_id` ?? `studio_zone_id` ?? the broadcast-schedule studio, several zones per tick; returns RUNNING until arrived. **Checks no schedule of its own** — with `zone_id` + `arrive_by` it holds until the commute window opens, otherwise it leaves immediately, so gate it behind `CHECK_WORK`/`CHECK_VENDOR_WORK`. The window sizes itself off the real path length converted to game-minutes (`COMMUTE_TILES_PER_REAL_MIN` × `timeScale`) plus a buffer of half the trip, floor 5 min. **Late arrivals catch up** rather than waiting out the 24h ring: if the NPC's own schedule (`isNpcScheduledNow` / `vendor_schedule`) says they should be at work now, they leave on this tick; an NPC with bare `arrive_by` params and no schedule behind it gets `LATE_CATCHUP_GRACE_MINUTES` (240 game-min) instead. Destinations resolve facade → interior entry |
| `HAVE_LIFE` | `waypoints?: [zone_id]` | If not scheduled, walk toward `home_zone` or a random waypoint. No-ops when scheduled. Does NOT return RUNNING — graph continues each tick. **Studio actors:** when off-shift and still inside their studio building (same interior map as their studio zone), walk out to the exterior world tile first — one step per tick — before any random activity; once outside, the normal wander resumes. **The destination is drawn from within reach of where the NPC already stands** (`WANDER_NEAR_R` = 12 tiles, or `WANDER_FAR_R` = 30 on a 15% roll), falling back to the unrestricted set when nothing eligible is in range. See the wander-radius note below. |
| `AT_WORK` | — | No-op that marks the "at work" position in the graph. Keeps NPC in place during scheduled hours; graph re-checks schedule on next loop. |
| `CHECK_WORK` | — | 2-way branch for studio NPCs. Ports: `goToWork` (scheduled now), `haveLife` (off-shift, or no studio assigned) |
| `GO_HOME` | — | Walk toward `entity.home_zone`; returns RUNNING until arrived |
| `GO_TO_STUDIO` | — | Walk toward the studio zone derived from the NPC's broadcast schedule; returns RUNNING until arrived |
| `CHECK_VENDOR_WORK` | — | 4-way branch for vendor NPC routine. Ports: `goToWork` (work time + has work zone), `haveLife` (work time, no zone), `endShift` (shift just ended), `offWork` (off-duty). Reads `npc_type=vendor` schedule from `vendor_schedule`. |
| `VENDOR_CHITCHAT` | — | Say a random line from `entity.chitchat` to the zone; 60s cooldown |
| `VENDOR_COLLECT_SAFE` | — | Find linked vendor-safe furniture in `work_zone_id`, take 25% of `vendor_credits`, broadcast to zone |
| `VENDOR_GO_TO_ATM` | — | Find nearest non-broken ATM furniture globally (BFS), walk toward it; returns RUNNING until arrived |
| `VENDOR_DEPOSIT` | — | Add `blackboard.vendor_carrying` to `vendor_bank_credits` in DB; broadcast confirmation |
| `AT_HOME_LIFE` | — | Owns the sleep cycle only (the random home activities come from the passive home-life ticker in `tickEntityAI`). **Three gates before bed is even considered**, so an NPC has an evening as well as a night: 90 game-minutes of waking home life since arriving (`homeAwakeSince`, edge-detected so yesterday's timestamp can't count), not inside the post-wake grace (`wokenUntil`), and the next wake no more than 9 game-hours out — nobody turns in that early, they stay up and keep living. Then a 15%/tick roll (**50% while `ai.crashSleepy` is set** — a stimulant comedown, and the line changes to folding over mid-sentence) to sleep until 1 game-hour before the next `vendor_schedule` shift, or 07:00 game time with no schedule. On sleep it sets a real posture through the engine substrate — `setPosture(entity, 'lying', { sittingOn })` bound to a bed/couch/etc. in the room (floor fallback, `sittingOn=null`). Waking goes through `wakeNpc()`, never a bare `setPosture`. `ai.homeSleeping` is the *asleep* flag; `entity.posture === 'lying'` is the *physical stance*, so they stay separable |
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

## A wander has to come back

`HAVE_LIFE`'s patrol destination used to be drawn **uniformly from every exterior world
tile** — about 9,000 of them after the danger and facade filters. The four regions sit in
**disjoint blocks of one shared grid**:

| region | grid x | grid y | tiles |
|---|---|---|---|
| Coldwater | 863..955 | 896..947 | 4,837 |
| Deadwater | 726..818 | 950..1001 | 4,836 |
| Scarletwastes | 1000..1092 | 950..1001 | 4,836 |
| The Reach | 903..922 | 1032..1051 | 400 |
| Terminus | 1200..1213 | 934..947 | 196 |

So roughly **two rolls in three sent a Coldwater shopkeeper to another region**. NPC AI
ticks every 15s and walks one step per tick, which makes that a journey of hours: the NPC
left the neighbourhood, never arrived anywhere a player was, and never came back inside a
session. There was no error and nothing in the logs. Wandering read as the city quietly
emptying out, because that is exactly what it was.

The picker now draws from tiles within `WANDER_NEAR_R` (12) of where the NPC is standing,
or `WANDER_FAR_R` (30) on a `WANDER_FAR_CHANCE` (15%) roll so that somebody does still
cross town. **Because the regions are disjoint on that one grid, the radius is also a
region check** and needs no second source of truth — do not add one.

Two things to keep if you tune this:

- **The unrestricted set stays as a fallback.** An NPC standing where nothing eligible is
  in range must still get somewhere to go, or they stop wandering permanently.
- **The far band is not decoration.** Without it every NPC is on a short leash, which
  reads as its own kind of wrong: a city where nobody ever leaves their own street.

`npcs.wanders` / `npcs.wander_zones` are a **different, effectively dead path** — the
hardcoded fallback in `npcWanderTick` for NPCs with no behaviour graph. 214 of 215 shipped
NPCs have a graph, so only Reg Naylor reaches it. Three dealers (Gita Halvard, Wick Sorel,
Dov Keller) carry authored `wander_zones` that can never fire for exactly this reason.

---

## Home life needs a home

`home_zone` had drifted into meaning *"where this NPC is when they're not working"* —
**110 of 178 NPCs have their own shop floor, the studio stage or a street tile as their
home_zone**. Home life read off `home_zone` alone, so a shopkeeper tidied her apartment in
front of customers and eleven studio actors microwaved something questionable on a live set.

The passive ticker now asks **two** questions:

| | test | governs |
|---|---|---|
| `atHomeZone` | standing where `home_zone` points | washing (`npcWashAtHome`) and the evening clock — true of anywhere you live, including a bunk behind the counter |
| `atHome` | ...**and** `isDwellingZone(getZone(home_zone))` | the visible domestic activities |

`isDwellingZone` ([zone-tags.js](../server/engine/zone-tags.js)) = `is_apartment || is_dwelling`.
A workplace passes neither, on purpose: the NPC still stands there, still sleeps there, still
talks to you — they just stop performing domestic scenes in public. ambient-life's home
routines (the cooking/drinking vignettes) use the same gate, so both halves agree.

**`is_dwelling` is the flag for a home nobody rents** — the Reach cabins, Akerson's
penthouse, the Long Watch bunkroom, Dredge's cistern, the Echelon boudoir. Adding it to a
workplace is the one way to reintroduce the bug.

### What they actually do in there — the archetype tier

Passing the `atHome` gate gets you an evening; **which** evening comes from three tiers,
resolved by `getNpcHomeActivities()` in
[npc-personality.js](../server/engine/npc-personality.js):

| order | source | reach |
|---|---|---|
| 1 | `npc.home_activities` (hand-authored, per NPC) | 3 NPCs |
| 2 | `HOME_ACTIVITIES[flags.personality]` (the archetype pool) | 146 NPCs |
| 3 | `DEFAULT_HOME_ACTIVITIES` in ai-behaviour.js | anyone with an unregistered slug, or none |

Tier 2 is the one that was missing, and its absence is the kind of bug that never
throws: **146 of the 149 NPCs who live in a real dwelling shared the same twelve
lines.** Nothing was broken, everyone's evening was just the same evening. Banter has
had a personality tier since it shipped; this is home life catching up, and it reaches
all 146 without a single per-NPC edit.

The getter returns **`null`, never `[]`**, when it has nothing — the caller ends
`|| DEFAULT_HOME_ACTIVITIES`, and an empty array is truthy, so returning one would hand
`pickFresh` nothing to pick and silence home life completely.

Same convention as chitchat throughout: `"quoted"` is spoken, unquoted is an emote with
the NPC's name in front. Adding a personality to the registry and forgetting the home
pool is a **regress failure** (layer 1i3), which also covers the same question for work
chitchat, life chitchat and the banter library.

### The thirteen unregistered slugs

`lowlife`, `official`, `clerk`, `professional`, `labourer`, `corporate`, `quiet`, `gruff`,
`gambler`, `charity`, `chatty`, `robot` and `stoic` were each set on real, named NPCs and
none of them existed in `DEFAULTS`, so `getData()` handed all **46** of those characters
the same `FALLBACK`: no work voice, no life voice, one shared set of combat lines. They
are registered now. This failure mode is silent by construction — an unknown slug is not
an error, it is a shrug — which is exactly why the regress layer reads the content tree
for slugs rather than checking a list.

---

### The commute build

The gate above is only half the answer — a home is worth having only if you can leave it.
[`scripts/house-posted-npcs.mjs`](../scripts/house-posted-npcs.mjs) gives the workplace-homed
cast all three things at once, because doing fewer is worse than doing none:

1. **Home** — an apartment chosen by real hop distance from their workplace (BFS over
   `zones.exits`, undirected, capped at 60 hops), packed 2 to a unit (3 every fifth).
2. **Shift** — a derived `vendor_schedule`. An NPC with no schedule is never *off* shift
   and therefore never goes home; the day off is derived from their id so a district
   doesn't shut all at once.
3. **Commute** — the engine's OWN `buildDefaultVendorGraph` / `buildDefaultStudioGraph`.
   Adopting the default rather than inventing a graph means the script can never drift
   from what the engine knows how to run, and anyone who already has `GO_TO_WORK` keeps
   their authored graph untouched.

Two candidate classes: NPCs homed at their workplace get all three; NPCs who already live
somewhere real but have a job they can't reach keep their home and get the last two.

**Who is left posted** is a rule, not a list of names:

- **`flags.posted`** — authored "the post is the life". `aa_crew`, `aa_engineer`, `police`,
  `haunt_zone` and `no_attack` already imply it.
- **No apartment reachable from their workplace.** This is the load-bearing one: it
  silently and correctly excludes The Reach, the Long Watch, the Under, the Ascendant
  compound, the AA emplacements and the Echelon without anyone having to remember they
  are remote. If a district gets housing later, they house themselves on the next run.
- A workplace that is itself a dwelling — bad data or a home business; either way not a
  commute worth building.

Result: **144 of 178 NPCs now live somewhere they could plausibly live**, 34 stay posted.
The script is file-authoring (git is the source of truth) and dry-run by default.

### Two ways a housing pass leaves someone permanently off work

Both of these shipped, and both are **silent** — no error, no log line, no in-game tell.
The shop just always has nobody behind the counter. Found 2026-08-01, when Lowry Cormack
and Angus Malcolm were both missing from their own counters.

**1. The body is left behind (`npcs.zone_id` vs `home_zone`).** `home_zone` is content and
moves with the housing pass; `zone_id` is runtime, excluded from content files, and does
not. An NPC whose home is reassigned while their body stands in the old flat no longer
*owns* that flat's door — so the locked door sealed them in. `GO_TO_WORK` cleared its path,
returned `RUNNING`, and retried the same impossible hop forever.

Fixed in `moveEntity`: **a lock on a home keeps people out, not in.** Ownership still
decides who may come *in*; anyone standing inside a dwelling may always walk *out*. The
test is `isDwellingZone(getZone(oldZoneId))` — deliberately **not** `door.zone_id`, whose
anchor side is not a reliable "protected side" (an apartment door is anchored inside the
flat; the regress hall door is anchored in the hall with `target_zone` pointing at the
flat). Testing the anchor lets a stranger walk *in* through the second kind. Enemies are
excluded — a locked door is still a wall to something chasing you, from either side.

`ownsThisDoor` alone is also too narrow, because it only knows the two zones either side of
one doorway. **A door on the building you live or work in opens for you from anywhere
inside it** — compared by `map_id`, on both the zone being left and the one being entered.
Halloran is the case that needs it: he sleeps in the Long Watch bunkroom and runs a surface
shop, so his commute crosses *two* `lock:longwatch` doors — out through the bunker blast
door, then back up the drain hatch into his own shop's back room. Neither is adjacent to his
home or work zone, and `lock:longwatch`'s `authFn` reads a **player's** reputation, so it can
never answer for an NPC at all. The map comparison is guarded on a truthy `map_id`: regress
uses synthetic zones with none, and `undefined === undefined` would wave every stranger through.

A blocked commute now also logs once per NPC per hour rather than failing silently.

**2. A home but no shift.** `CHECK_VENDOR_WORK` drives everything off `vendor_schedule`.
An empty one has no blocks and no reference range, so it falls through to `return
'offWork'` — permanently off duty, `GO_TO_WORK` unreachable. 20 NPCs shipped this way.
`content:lint` now **fails** on `work_zone_id !== home_zone` with an empty
`vendor_schedule`. Two exemptions, both meaning "a schedule would decide nothing here":
NPCs stationed where they live (`work_zone_id === home_zone`, 28 of them), and
**studio-driven** NPCs whose graph uses `CHECK_WORK` rather than `CHECK_VENDOR_WORK` —
that node gates on `studio_zone_id` and the broadcast schedule and never reads
`vendor_schedule`, so a TV host is at the studio when their show is on and home otherwise.

A third failure of the same family is not an NPC problem at all: **a workplace with no way
in.** Tine & Temper's interior map was parented on `zone_district_918_907`, but that tile was
never given the `facade` tag, so `isEnterableFacade` was false and the auto-forward seam
never fired — the shop could be left but never entered, by anyone, including Tove Adaska who
owns it. Tagging the facade (plus `entrance`, `building_type`, and the exit into the
interior taking the slot *opposite* the entrance) is what wires a building up; see
[land-taxonomy](reference/land-taxonomy.md) and the facade invariants `content:lint`
already checks.

For the residue of past passes, [`scripts/oneshots/reconcile-stranded-npcs.mjs`](../scripts/oneshots/reconcile-stranded-npcs.mjs)
returns anyone who cannot reach their workplace from where they stand — and deliberately
refuses to move an NPC whose workplace is unreachable from *home* too, since that is a
world-connectivity bug that relocating them would only hide.

## Sleeping NPCs, and waking them

`ai.homeSleeping` is the one flag meaning *this NPC is unconscious in their own bed*.
`AT_HOME_LIFE` sets it; **everything that disturbs a sleeper goes through
`disturbSleeper()`** ([ai-behaviour.js](../server/engine/ai-behaviour.js)) so the roll,
the resulting state and the flavour cannot drift across the verbs that can reach a
sleeping body.

```js
disturbSleeper(npc, { broadcast, force }) // → null | { woke, mood, message }
```

- Returns **`null` when the NPC isn't asleep** — callers carry straight on, so adding the
  check to a verb is one line and changes nothing for an awake NPC.
- Otherwise it rolls. A sleeper is not a light switch: the usual outcome is that they
  mumble and stay under, and it *says so*, so the player knows the interaction happened
  and failed rather than appearing to do nothing.
- Depth: **0.55** baseline, **0.9** while `loose`/`out` on drink or a downer, **0.15** while
  `wired`. Each disturbance subtracts **0.2**, so persistence always works and nobody is
  trapped rolling `talk` at a snoring body.
- Waking picks a mood — **confused** if they were deep under (dosed, or under an hour of
  sleep behind them), otherwise usually **annoyed** — which is stored as `ai.wokeMood` and
  read by the passive home-life ticker for the next 45 game-minutes, so being woken has a
  visible tail instead of one line and business as usual.
- `force: true` skips the roll. Being hit wakes you up; a listener on `npc.attacked` in
  this module does exactly that.
- `message` is already broadcast to the room (via the `broadcast` you pass, which should
  exclude the actor) and *also* returned, so the verb can answer the actor with it.

`wakeNpc(npc, { mood })` is the state half, shared with `AT_HOME_LIFE`'s own scheduled
wake: clears the sleep, `forceStand`s the body, restarts the graph from `_start`, and sets
`wokenUntil` so they don't lie straight back down on the next tick.

**Wired in at:** `cmdTalk` ([commands/social.js](../server/engine/commands/social.js)) —
before the `npc.talk` hook, so a plugin can't hold a conversation with an unconscious
person — and the `npc.attacked` listener. Anything new that touches a sleeping NPC should
call it rather than poking `homeSleeping` directly.

Consumers that must exclude sleepers: the passive home-life ticker (gated on
`!ai.homeSleeping`) and ambient-life's home routines (`isBusyBeingUnconscious`, which also
covers `dosedOut` and `posture === 'lying'`).

## Pathfinding

Every routed move — PATROL walk mode, the commutes (`GO_TO_WORK`/`GO_HOME`/`GO_TO_STUDIO`/`VENDOR_GO_TO_ATM`), and the ESP evacuation — goes through `findPath`. FLEE and ROAM don't route: they pick from the current zone's immediate exits. [pathfinding.js](../server/engine/pathfinding.js) exports:

- `findPath(startId, targetId, { maxDistance = 60, roads = false, avoid = null })` — array of zone IDs from start to target (inclusive), or `null` if unreachable within maxDistance hops. `roads: true` runs a road-preferring least-cost search instead of plain BFS.
- `getZonesInRadius(originId, maxHops)` — BFS out to `maxHops`; returns a Map of `zone_id → distance`. Used by CALL_BACKUP.

`ai-behaviour.js` shadows the raw import with its own wrapper ([ai-behaviour.js:254](../server/engine/ai-behaviour.js#L254)): NPCs path with `roads: true` so they commute along streets instead of cutting through buildings; enemies keep the direct BFS line.

Pathfinding crosses map and interior/exterior boundaries freely — exits JSONB already encodes those connections.

---

## The leash, and where a mob may not go

Two separate bounds, both on `entity.flags` rather than on any node's params. Neither is authored in
the graph, so a designer tuning pursuit is editing the creature, not its behaviour tree.

### `flags.leash_radius` — how far from home

Chebyshev tiles from the mob's `spawnZoneId`, applied to **ROAM** and **CHASE** only. Zero is a real
value, so never write `Number(f) || 12`:

| value | meaning |
|---|---|
| unset | `LEASH_RADIUS` (12 tiles), the default |
| `-1` | unleashed — an authored world-wanderer or a pursuer that does not give up at the district line |
| `0` | pinned to its own tile |
| `1..n` | that many tiles |

A different map, floor, or an ungridded zone reads as `Infinity`, i.e. definitively off its patch.
Deliberately **not** applied to PATROL (already bounded by its authored waypoints) or FLEE (bounding
a fleeing mob by its own leash corners it and hands the player a free kill on something the design
says should escape — it clears `targetId`, and the next ROAM beat walks it home).

`flags.chase_speed_s` sets pursuit pace (default 2s/step). This is tuned so a **walking** player
cannot break contact but run mode can, which is what makes running a decision rather than a
formality. Raise it to give the player more room.

### The destination law — sanctuary, `no_spawn`, `enemy_barrier`

`enemyMayEnter` refuses to let a mob walk into a zone flagged `sanctuary`, `no_spawn`, or
`enemy_barrier`, and `findPath` honours the refusal. A mob is exempted for its own `spawnZoneId` and
`home_zone`.

> ⚠ **`flags.hunter` is an exemption, not a pursuit enabler.** `isEnforcement()` (`flags.hunter`, or
> `faction === 'police'`) exists so the law can follow a wanted player into a safe room. It has
> nothing to do with CHASE, which reads `flags.suspect_id`. Setting `hunter` on a pursuer because it
> sounds right will let it walk into every sanctuary in the game after the player, and the bug will
> look like broken AI rather than a content mistake. Give a pursuer `suspect_id` and
> `leash_radius: -1`; give it `hunter` only if it is genuinely the law.

Content stamps `suspect_id` onto a spawned mob through the script `spawn` node's `flags` field —
see [scripting.md](scripting.md).

---

## Known Limitations

- **World-scope flags** are blackboard-only: `SET_FLAG` with `scope: 'world'` is a no-op, and the `FLAG_SET` condition falls back to the blackboard rather than reading `world_flags`. Pending a decision on async DB writes in the tick loop.
- **Nothing an entity does through the graph persists.** Blackboards are in-memory, and `moveEntity` never writes `zone_id` — patrol progress, self-flags, and current position are all lost on restart (boot re-places NPCs at `home_zone`).
