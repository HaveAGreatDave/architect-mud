# Scripting & Action System (As Built)

The engine's mutation/scripting stack spans four files that form a layered pipeline. Nothing writes world state directly — all game-changing operations flow through this chain.

Primary files: [actions.js](../server/engine/actions.js), [events.js](../server/engine/events.js), [flags.js](../server/engine/flags.js), [graph.js](../server/engine/graph.js), [script-triggers.js](../server/engine/script-triggers.js).

See [ADR-0001](adr/0001-action-canonical-mutation-path.md), [ADR-0002](adr/0002-events-vs-hooks.md), [ADR-0004](adr/0004-shared-graph-engine.md).

---

## Actions (`actions.js`) — ADR-0001

The canonical mutation path. All game-state writes that originate from content (dialogue, scripts, quests) go through `dispatchAction`. Commands and plugins may also dispatch actions.

### Register

```js
registerAction({
  type: 'MY_ACTION',          // string key — must be unique
  requiredTag: 'consumable',  // optional — rejects if params.target lacks this tag
  validate: async ({ actor, params, context }) => 'error message' | undefined,
  handler: async ({ actor, params, context, emit }) => { ... return result; },
});
```

### Dispatch

```js
const result = await dispatchAction({
  type: 'GRANT_ITEM',
  actor: player,          // live player object
  params: { item_id, quantity: 1, once: true },
  context: { broadcast }, // optional — passed through to handler
});
// result.type === 'error' if validation failed or handler returned an error
```

### Built-in actions

Registered across `actions.js`, `graph.js` and `flags.js`:

| Action | Source | What it does |
|---|---|---|
| `TAKE` | actions.js | Pick a ground row up; refuses `custom_data.ownerId` items belonging to someone else |
| `DROP` | actions.js | Drop a row (optional `params.qty`) to the zone floor |
| `GIVE` | actions.js | Hand a row to `params.toPlayer` |
| `EQUIP` / `UNEQUIP` | actions.js | Equip a row into `params.slot`/`layer`, or take it off |
| `MOVE` | actions.js | `cmdMove(params.direction, …, params.opts)` — runs the move-gate chain |
| `EXAMINE` | actions.js | Stub — returns an error; use the look command |
| `GRANT_ITEM` | graph.js | Insert item into `player_inventory`; once-guard optional |
| `REMOVE_ITEM` | graph.js | Remove item from `player_inventory` by item_id + quantity |
| `TELEPORT` / `TELEPORT_PLAYER` | graph.js | Move player to zone_id; broadcasts departure/arrival |
| `OPEN_UI` | graph.js | Tell client to open a named UI panel |
| `OPEN_BANK` | graph.js | Convenience alias for `OPEN_UI { ui:'bank' }` |
| `OPEN_STORAGE` | graph.js | Convenience alias for `OPEN_UI { ui:'storage' }` |
| `OPEN_CRAFTING` | graph.js | Convenience alias for `OPEN_UI { ui:'crafting' }` |
| `OPEN_SHOP` | graph.js | Load NPC vendor stock and send `dialogue_shop` to client |
| `TRIGGER_EVENT` | graph.js | Emit an arbitrary event on the event bus |
| `EXECUTE_SCRIPT` | graph.js | Run a script graph by ID or inline graph object |
| `END_CONVERSATION` | graph.js | Send `dialogue_end` to client |
| `GOTO_NODE` | graph.js | Return a goto_node result; `handleDialogue` redirects navigation |
| `SET_FLAG` | flags.js | Persist a flag to `player_flags` or `world_flags` |
| `CLEAR_FLAG` | flags.js | Delete a flag from the relevant table |

Plugins and commands add their own actions via `registerAction`.

---

## Events (`events.js`) — ADR-0002

Fire-and-forget pub/sub. Events are past-tense notifications emitted *after* a mutation succeeds. Subscriber errors are isolated — a bad handler cannot break the emitter.

```js
import { on, emit } from './events.js';

on('item.granted', ({ actor, item_id, quantity }) => { ... });
emit('item.granted', { actor, item_id: 'abc', quantity: 1 });
```

Return values from subscribers are ignored. Async subscribers run but their rejections are caught and logged.

### Known events (emitted by built-in actions)

| Event | Payload |
|---|---|
| `item.granted` | `{ actor, item_id, quantity }` |
| `item.removed` | `{ actor, item_id, quantity }` |
| `item.taken` | `{ actor, item, zone }` |
| `item.dropped` | `{ actor, item, zone }` |
| `item.given` | `{ actor, recipient, item }` |
| `item.equipped` / `item.unequipped` | `{ actor, item, slot }` (no `slot` on unequip) |
| `inventory.changed` | `{ actor }` |
| `zone.entered` | `{ actor, zone, from }` |
| `flag.set` | `{ actor, scope, flag, value }` |
| `flag.cleared` | `{ actor, scope, flag }` |

**Events vs. hooks:** `emit` is fire-and-forget notification (past tense, no return value). `fireHook` (in `plugins.js`) is request/response middleware (present tense, can modify data). Use events for "this happened"; use hooks for "should I allow this" or "add data to this".

---

## Flags (`flags.js`)

Persistent key/value state keyed by player or world scope. Stored in `player_flags` (`player_id, flag_key, flag_value, updated_at`) and `world_flags` (`flag_key, flag_value, updated_at`). Values are always strings; numeric comparisons coerce with `Number()`.

> Not to be confused with the legacy `flags` JSONB bag on item/entity rows — that belongs to the Tag system (ADR-0003).

**World-scope reads are cached for the life of the process** ([flags.js:19](../server/engine/flags.js#L19)) — `world_flags` loads once and every later `getFlag('world', …)` is served from memory. `setFlag`/`clearFlag` keep the cache coherent; **a write from outside the process does not** — a one-shot script, psql, or the Neon console. Restart the server after touching `world_flags` out of band. A stale *cleared* flag is the nastier direction: `op: 'set'` gates stay true forever (this is what makes `scripts/reach-jobboard.mjs` look like it did nothing).

### Store API

```js
await getFlag('player', 'quest_started', player);  // → string | undefined
await setFlag('player', 'quest_started', 'true', player);
await clearFlag('player', 'quest_started', player);

await getFlag('world', 'server_event_active');
await setFlag('world', 'server_event_active', 'true');
```

### Conditions

A condition object gates dialogue options and script branches:

There are **three** condition shapes, distinguished by which key is present:

```js
{ flag: 'quest_started', scope: 'player', op: 'set' }   // persisted flag state
{ item: 'item_crowbar', op: 'has', quantity: 1 }        // carried inventory
{ stat: 'brawn', op: 'gte', value: 5 }                  // a player stat
```

`flag` ops: `set` (flag exists, default), `unset`, `eq`, `neq`, `gt`, `lt`.
`item` ops: `has` (default, counts equipped + containers), `lacks`.
`stat` ops: `gte` (default), `gt`, `lt`, `lte`, `eq`, `neq`.

Stat names are the real columns minus the prefix — **`brawn`, `reflexes`, `endurance`, `brains`,
`cool`, `senses`**. An unknown stat name fails closed (logged, returns false) rather than reaching
the column position; the allow-list is the reason a condition can't build arbitrary SQL. A live
player object already carries its stat columns, so a stat condition normally costs no round trip; an
`item` condition is one indexed aggregate. Both are for **cold paths** — dialogue gates and script
branches — never a per-move or per-swing check.

```js
await evalCondition({ flag: 'quest_step', scope: 'player', op: 'gt', value: '2' }, player);
await evalConditions([cond1, cond2], player); // AND — all must pass
```

`evalConditions` returns `true` for empty/missing condition arrays.

### Mutating flags through actions

Prefer `dispatchAction` over calling `setFlag` directly — it keeps the audit trail intact and emits events:

```js
await dispatchAction({ type: 'SET_FLAG', actor: player,
  params: { scope: 'player', flag: 'quest_started', value: 'true' } });
```

---

## Script Graphs (`graph.js`) — ADR-0004

Script graphs are the server-side runnable counterpart to VINE graphs. They run to completion (up to 100 steps) rather than requiring client interaction like dialogue trees do.

### Running a script

```js
import { runGraph, runScriptById } from './graph.js';

// Run an inline graph object
await runGraph(graph, { actor: player, broadcast, depth: 0 });

// Run a script asset from the DB by ID
await runScriptById('uuid', { actor: player, broadcast });
```

Scripts can nest up to 10 levels deep via `script` nodes. A `wait` node is non-blocking: it returns immediately and schedules a `setTimeout` to resume.

### Node types

| Type | Fields | Behaviour |
|---|---|---|
| `action` | `action`, `params`, `next` | `dispatchAction(action, params)` |
| `setflag` | `scope`, `flag`, `value`, `op`, `next` | dispatches `SET_FLAG` or `CLEAR_FLAG` |
| `condition` / `branch` | `conditions`, `ifTrue`, `ifFalse` | `evalConditions` → branch |
| `random` | `outcomes:[{next,weight}]`, `next` | weighted pick of one outcome; weights are **relative**, not percentages (3 and 1 = 75/25). Weight 0 parks an outcome. Nothing pickable → falls through to `next` rather than dead-ending |
| `counter` | `scope`, `flag`, `delta`, `threshold`, `reset`, `ifTrue`, `ifFalse`, `next` | adds `delta` (default 1) to a numeric flag, then branches on `value >= threshold`. No threshold = bump and continue via `next`. `reset:true` zeroes the flag on a hit — that's how "every Nth time" is one node. Writes through `SET_FLAG`, so the audit trail holds |
| `say` | `text`, `next` | sends text to the actor only |
| `broadcast` | `text`, `zone`, `excludeActor`, `refresh`, `next` | sends text to **everyone in the room** — how a script makes a scene rather than a whisper. Defaults to the actor's zone; pass `zone` (or `${zone}`) for an actorless event |
| `spawn` | `kind:'enemy'\|'item'`, `id`, `zone`, `container`, `quantity`, `announce`, `next` | puts an enemy instance (from an `enemies` template) or an item into a zone. `announce` overrides the stock arrival line; `announce: false` on an enemy arrives **silently** — for a tail the player hasn't noticed. `container` makes an item spawn a **dead drop** (below). A missing template/zone is logged and skipped, never fatal |
| `script` | `scriptId`, `next` | runs sub-script by DB ID (depth+1) |
| `wait` | `seconds`, `next` | suspends; resumes the continuation after the delay. **Under 120 s** it's a bare `setTimeout`; **at or past 120 s** it is parked in `script_waits` so a restart can't eat it (see below) |

### Parameterised graphs (`${tokens}`)

Any **string** field in a node — flag keys, values, `say` text, `action` params (at any depth), a
`script` node's `scriptId`, condition flags/values, and the numeric fields `counter.delta`,
`counter.threshold`, `wait.seconds` — is interpolated against `ctx.params` before the node runs. Node
ids (`next`, `ifTrue`, …) are never interpolated: topology is authored, not computed.

Tokens are **dotted paths**, resolved against the params object.

#### Reading the event payload

A trigger exposes the payload it fired on under `event`, so a script can react to *what* happened
rather than merely that it happened:

Payload field names are the emitter's business, so **check the `emit()` call before authoring** — they
are not uniform. Verified examples:

| Event | Useful tokens | Note |
|---|---|---|
| `credits.changed` | `${event.delta}`, `${event.reason}`, `${event.after}` | **no actor** — carries `playerId`, so `once`/`say`/player-scope flags don't work here |
| `vendor.purchase` | `${event.itemId}`, `${event.price}`, `${event.quantity}`, `${event.player.handle}` | `player`, not `actor` — the dispatcher normalizes both |
| `item.taken` / `item.dropped` | `${event.item.name}`, `${event.item.id}` | full item row |
| `item.equipped` | `${event.item.name}`, `${event.slot}` | |
| `player.death` | `${event.cause}`, `${event.deathZone}`, `${event.killer.name}` | |
| `enemy.killed` | `${event.enemy.name}` | `npc.killed` uses `${event.npc.name}` |
| `player.drugUsed` | `${event.drug.name}`, `${event.potency}`, `${event.illegal}` | |
| `crime.witnessed` | `${event.label}`, `${event.key}` | |
| `gossip.bigBuy` | `${event.itemName}`, `${event.price}` | |

Combined with an interpolated `delta`, a counter accumulates **values**, not occurrences:

```json
{ "type": "counter", "scope": "player", "flag": "lifetime_spend", "delta": "${event.delta}" }
```

Three rules keep this from turning into a debugging problem:

- **The payload is referenced, never copied.** This resolves on `zone.entered`, so there is no
  per-event allocation. Only scalar leaves resolve, so handing over the live object costs nothing.
- **A token resolving to a non-scalar is left verbatim.** `${event.actor}` is the live player object;
  it must never stringify into a flag key.
- **An unresolved numeric token is inert.** `Number('${event.nope}')` is `NaN`, and the `|| 0` makes
  the counter a no-op rather than writing `NaN` over a running total.

A trigger's own `params` win a name collision with the payload — authored intent beats whatever the
emitter happened to call its field.

**Dialogue gets tokens too.** The interpolator lives in its own module
([interp.js](../server/engine/interp.js)) precisely so `dialogue.js` can share it without importing
the script runtime. `renderDialogueNode` interpolates a node's **text and its option labels** against
a small fixed bag — `${npc.*}`, `${player.*}`, `${zone}` — which is what lets one authored greeting
tree serve every bartender in the game. This is separate from the legacy `{quest}` single-brace
substitution, which is unchanged.

This is what lets **one** authored graph serve many instances. `script_venue_regular` counts
`bar_${venue}_visits`, and one `script_triggers` row per bar supplies `{"venue":"pigeon"}` — five bars,
one graph, no clones. Params ride the ctx, so they inherit into `script` sub-graphs and survive a
`wait` continuation. `${zone}` is always supplied by the trigger dispatcher.

An **unsupplied token is left verbatim**, on purpose: a typo'd `${vnue}` writes the literal key
`bar_${vnue}_visits` rather than collapsing every instance onto one shared counter. Because that's
invisible in play, `npm run test:regress` layer 1e2 statically asserts every trigger supplies every
token its script tree uses — including through `script` sub-graph hops.

Dialogue can use the same graphs: `EXECUTE_SCRIPT` takes `scriptParams` (named to avoid colliding
with the action's own `params` bag).

### Dead drops

An item `spawn` with a `container` puts the item **inside** that container instead of on the open
floor — really there, really retrievable, but not visible to the next person through the room.

```json
{ "type": "spawn", "kind": "item", "id": "item_credit_chip",
  "zone": "zone_mq_pigeon_bar", "container": "trash bin" }
```

`container` accepts a **furniture id** (exact) or a **name/alias**, matched against `object_type =
'container'` furniture **in the target zone only** — so a drop can't land in a "locker" three
districts away because two rooms named their furniture the same thing. Name matching is the same
shape `open <name>` uses, so what an author types is what a player can open.

Storage is a `player_inventory` row whose `container_id` is the furniture id, owned by a synthetic
`_container_<id>` (contents are looked up by `container_id` alone, but a real player's id there would
count against their carry weight). Taking it out works like any container item.

**If the container can't be resolved the drop is skipped, not dumped on the floor.** A drop that
misses its container and lands in the open is a *leaked* drop — worse than a missing one. It's loud
in the log and invisible in play.

Pair with a durable `wait` and the whole "someone will leave it for you in a couple of days" beat is
two nodes.

### Durable waits (`script_waits`)

A `wait` under `DURABLE_WAIT_S` (120 s) is a plain timer. At or past it, the continuation is
**persisted** — graph, node id, actor, params, `due_at` — and `resumeDueWaits()` (scheduled `1m`, so
idle-gated) runs it when due. That's what makes a multi-day consequence authorable instead of only a
45-second beat.

One rule worth knowing: a due row whose player is **offline is left in place**, not run and not
discarded. The table is a queue of *owed outcomes*, so the consequence lands the next time they're
connected to see it. An actorless row (`player_id NULL`) runs as soon as it's due. Rows are deleted
the moment they resume; the table is classified `runtime` and never ships.

### Script triggers — event → script bindings

[script-triggers.js](../server/engine/script-triggers.js) is the registry that gives Scripts a trigger surface other than a dialogue node's `EXECUTE_SCRIPT`. A row in `script_triggers` means *"when this bus event fires and these filters pass, run that graph"* — so "entering this room the first time plays a scene" is authored content, not a code change.

| Column | Meaning |
|---|---|
| `event` | any [events.js](#events-eventsjs--adr-0002) name — `zone.entered`, `item.equipped`, `player.death`, `flag.set`, `weather.event`, plugin events |
| `script_id` | the `scripts` row to run |
| `zone_id` | optional zone filter; `NULL` = anywhere |
| `conditions` | flag-condition array, ANDed (same shape as dialogue gates) |
| `cooldown_seconds` | per-player re-fire floor (per-world when the event has no actor) |
| `chance` | `0..1` roll |
| `once` | `1` = at most once per player, guarded by the `script_trigger_<id>` player flag |
| `params` | bag filling the graph's `${tokens}` — see above. `${zone}` and `${event.*}` are added by the dispatcher |
| `enabled` | `0` parks a row without deleting it |

**Field contract.** Sole writer: the `/api/script-triggers` CRUD in [routes.js](../server/api/routes.js) — every write calls `loadScriptTriggers()`, so an edit is live without a restart. Sole reader: the dispatcher in `script-triggers.js`. Rows are boot-cached; the table is never read on an event.

**Hot-path contract.** `zone.entered` fires on every move, so a miss costs one `Map.get`. Nothing is awaited and no DB is touched until a trigger matches the event name; the sync filters (zone, chance, cooldown) run before the async ones (conditions, once-guard). One dispatcher is subscribed per distinct event name, at most once per process — `events.js` has no unsubscribe, so a reload that drops every trigger for an event leaves a subscription that no-ops.

Payload shapes differ across emitters; the dispatcher normalizes `actor`/`player` and `zone`/`zoneId` (id string or zone object), falling back to the actor's `current_zone`.

### Dialogue vs. scripts

Dialogue trees (`npc.dialogue_tree`) are also node graphs but they are driven turn-by-turn by the client's `talk`/`reply` commands (`handleDialogue` in `server/index.js`). The graph format is identical; the walk is interactive rather than automatic. `graph.js` only runs Script assets; dialogue is walked in `index.js`.

### Authoring

Script and dialogue graphs are authored in the dev panel using [VINE](vine.md) and persisted to the `scripts` table or the `npcs.dialogue_tree` column. The VINE editor serialises to the same JSON format `runGraph` consumes.
