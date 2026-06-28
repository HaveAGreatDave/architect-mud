# Scripting & Action System (As Built)

The engine's mutation/scripting stack spans four files that form a layered pipeline. Nothing writes world state directly — all game-changing operations flow through this chain.

Primary files: [actions.js](../server/engine/actions.js), [events.js](../server/engine/events.js), [flags.js](../server/engine/flags.js), [graph.js](../server/engine/graph.js).

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

Registered across `graph.js` and `flags.js`:

| Action | Source | What it does |
|---|---|---|
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
| `item.dropped` | `{ actor, item, zone }` |
| `inventory.changed` | `{ actor }` |
| `zone.entered` | `{ actor, zone, from }` |
| `flag.set` | `{ actor, scope, flag, value }` |
| `flag.cleared` | `{ actor, scope, flag }` |

**Events vs. hooks:** `emit` is fire-and-forget notification (past tense, no return value). `fireHook` (in `plugins.js`) is request/response middleware (present tense, can modify data). Use events for "this happened"; use hooks for "should I allow this" or "add data to this".

---

## Flags (`flags.js`)

Persistent key/value state keyed by player or world scope. Stored in `player_flags` and `world_flags` (each a `(key, value, updated_at)` row). Values are always strings; numeric comparisons coerce with `Number()`.

> Not to be confused with the legacy `flags` JSONB bag on item/entity rows — that belongs to the Tag system (ADR-0003).

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

```js
{ flag: 'quest_started', scope: 'player', op: 'set' }
```

`op` values: `set` (flag exists, default), `unset`, `eq`, `neq`, `gt`, `lt`.

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
| `say` | `text`, `next` | sends text to actor via broadcast |
| `script` | `scriptId`, `next` | runs sub-script by DB ID (depth+1) |
| `wait` | `seconds`, `next` | suspends; resumes continuation after delay |

### Dialogue vs. scripts

Dialogue trees (`npc.dialogue_tree`) are also node graphs but they are driven turn-by-turn by the client's `talk`/`reply` commands (`handleDialogue` in `server/index.js`). The graph format is identical; the walk is interactive rather than automatic. `graph.js` only runs Script assets; dialogue is walked in `index.js`.

### Authoring

Script and dialogue graphs are authored in the dev panel using [VINE](vine.md) and persisted to the `scripts` table or the `npcs.dialogue_tree` column. The VINE editor serialises to the same JSON format `runGraph` consumes.
