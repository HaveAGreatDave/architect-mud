# Broadcast System (As Built)

Architect's media framework: scripted channels, dynamic news, live cameras, and VINE-authored broadcast graphs delivered automatically to players whose zone has a tuned device. Primary files: [`plugins/broadcast/index.js`](../plugins/broadcast/index.js), [`client/devpanel/js/panels/broadcast.js`](../client/devpanel/js/panels/broadcast.js), [`client/devpanel/js/panels/broadcast-channel.js`](../client/devpanel/js/panels/broadcast-channel.js), [`client/devpanel/js/vine/vine-schema-broadcast.js`](../client/devpanel/js/vine/vine-schema-broadcast.js).

---

## Schema

Four tables, all in `server/models/schema.js`:

| Table | Purpose |
|---|---|
| `media_broadcasts` | Reusable content assets (scripted shows, news templates, recorded footage) |
| `media_channels` | Channel definitions — number, type, playlist loop, idle fallback |
| `media_channel_playlist` | Timeline items: which broadcast plays at which `start_time` on which channel |
| `media_cameras` | Camera placement, recording buffer, streaming target channel |

### `media_broadcasts`

```
id TEXT PK
name TEXT
description TEXT
category TEXT         — general | news | advertisement | entertainment | emergency | …
tags JSONB            — []
playback_mode TEXT    — scripted | dynamic_news | live_camera | recorded
messages JSONB        — [{ text: '...' }, ...]
message_interval REAL — seconds between flat-list messages (default 5)
override_duration REAL — if set, overrides (count × interval) for this asset's duration
loop INTEGER          — 1 = repeat message list when exhausted
enabled INTEGER
broadcast_graph JSONB — VINE graph; if set, overrides flat message list at runtime
```

### `media_channels`

```
id TEXT PK
name TEXT
number INTEGER UNIQUE — dial number players tune to
channel_type TEXT     — playlist | news | mixed | live | emergency
idle_broadcast_id TEXT FK — played when nothing else covers the current time
news_categories JSONB — ['murder','martial_law',...] — which news events this channel carries
loop_playlist INTEGER — 1 = playlist loops continuously
```

### `media_channel_playlist`

```
channel_id TEXT FK
broadcast_id TEXT FK
start_time INTEGER    — seconds from loop start
duration_override REAL — replaces calculated duration for this slot only
```

### `media_cameras`

```
zone_id TEXT FK
direction TEXT
is_powered INTEGER
is_recording INTEGER
is_streaming INTEGER
streaming_channel_id TEXT FK
recording_buffer JSONB — [{ ts, text }, ...], capped at storage_limit
storage_limit INTEGER — default 200
```

---

## Plugin architecture

`plugins/broadcast/index.js` owns the runtime. On load:

1. `loadChannelRuntimes()` — reads all enabled channels + their joined playlist from DB, computes a `loopOriginMs` anchor, normalizes any `broadcast_graph` columns into the runtime object.
2. `loadZoneTunings()` — reads all furniture with the `broadcast_receiver` flag, builds `zoneTunings: Map<zoneId, Set<channelId>>`.
3. `startBroadcastTick()` — `setInterval(broadcastTick, 5000)`.

### `broadcastTick()`

Every 5 seconds:

1. Iterates `zoneTunings`.
2. Skips zones with no players.
3. For each zone's tuned channels, calls `getCurrentMessage(channelId, zoneId, nowMs)`.
4. Passes the result through `formatMessage()` (device-type formatting).
5. `sendToPlayer()` to every player in the zone with `{ type: 'broadcast', message, channel, style }`.

### `getCurrentMessage()`

Resolves what to emit for the current tick:

- **playlist channels** — finds the active playlist item by `(elapsed % totalDuration)`. If the item has `broadcastGraph`, calls `tickBroadcastGraph()`. Otherwise calls `getScriptedMessage()` (flat message index by elapsed).
- **news channels** — if the active playlist item has a `broadcastGraph`, delegates to `tickBroadcastGraph()`. Otherwise pops one item from `newsQueue`.
- **Deduplication** — tracks `lastMsgKey` per channel; skips if the same message would fire twice in a row.

### `formatMessage(text, deviceType, zone)`

| Device type | Format |
|---|---|
| `tv` | raw text |
| `radio` | `[Radio] text` |
| `security_monitor` | `[FEED — Zone Name] HH:MM:SS — text` |
| other | raw text |

Device type is read from the `broadcast_device_type` tag on the furniture item.

### Dynamic news (`enqueueNews`)

World events populate the news queue:

```
on('player.death', ...) → enqueueNews('murder', 'Breaking: X was found dead in Y.', 'normal')
on('flag.set', ...)     → martial_law flag → enqueueNews('martial_law', 'EMERGENCY ALERT: …', 'critical')
```

`enqueueNews(category, text, priority, ts)` appends `{ text, category, priority, ts }` to `newsQueue` for every channel whose `news_categories` includes that category. Critical-priority items are prepended.

News channels with no active VINE graph auto-drain one item per tick. If the queue is empty, the idle broadcast plays instead.

### NPC host events

An NPC with the `BROADCAST_SAY` AI action emits `npc.broadcast_say`:

```js
on('npc.broadcast_say', ({ channel_id, text }) => {
  newsQueue.get(channel_id)?.push({ text, category: 'npc', priority: 'normal', ts: Date.now() });
});
```

This is the recommended path for live, in-world broadcast hosts — the NPC speaks independently through the AI behaviour graph rather than through a scripted VINE node sequence.

### `broadcast-bridge.js`

A tiny engine-side registry that breaks the circular import between `ai-behaviour.js` and the broadcast plugin:

```js
// server/engine/broadcast-bridge.js
registerViewerChecker(fn)  // called by broadcast plugin at startup
hasChannelViewers(channelId)  // called by ai-behaviour evalCondition('CHANNEL_HAS_VIEWERS')
```

The broadcast plugin registers a closure that checks whether `zoneTunings` has any players currently watching a given channel. The AI engine calls `hasChannelViewers` synchronously.

---

## VINE graph walker

When a playlist item has `broadcastGraph` set, `tickBroadcastGraph(channelId, graph, state, nowMs)` runs instead of the flat message list.

### Blackboard (`graphBlackboard`)

Each channel's runtime object has:

```js
graphBlackboard: {
  currentNode: null,    // current node id
  waitUntil: null,      // epoch ms for wait node
  npcAnchor: null,      // NPC object from world.npcs for active npc_anchor
  activeBroadcastId: null  // resets cursor when playlist item changes
}
```

### Walker logic (per tick)

1. If `activeBroadcastId` changed since last tick, reset `currentNode` to `_start`.
2. Follow the graph from `currentNode`, evaluating nodes in order.
3. On a **say** or **ticker** node: return `{ text, key, style }` — stop execution for this tick. Resume from `next` on the next tick.
4. On a **wait** node: set `waitUntil`; skip until elapsed.
5. On a **condition** node: branch to `ifTrue` or `ifFalse` synchronously (no DB calls).
6. On a **break** node: drain one item from `newsQueue`; if found, return it and resume from `next` next tick; if empty, continue graph.
7. On a **loop** node: jump to the connected target, or back to `_start`.
8. On a **random** node: pick a branch weighted by `branch.weight`.
9. On a **set_flag** node: call `setFlag(flag, value)` and continue immediately.
10. On a **npc_anchor** node: look up the NPC from `world.npcs.get(npcId)`, store in blackboard, continue.
11. On a **camera_cut** node: read zone description and return as `[CAM: label] …`.
12. On an **inject_news** node: pull from queue by category, or emit fallback, then continue.
13. Guards against cycles: max 50 hops per tick before early exit.

### Style field

`say` nodes with `style: 'ticker'` return `style: 'ticker'`. The game client dispatch handler routes these to `.msg-broadcast-ticker` (accent colour, italic) instead of the default `.msg-broadcast`.

---

## VINE Broadcast Schema

`client/devpanel/js/vine/vine-schema-broadcast.js` → `window.VineBroadcastSchema`

### Node types

| Type | Color | Out ports | Purpose |
|---|---|---|---|
| `start` | Dark green | `next` | Entry point. One per graph. |
| `say` | Green | `next` | Push a line. Stops execution for this tick. Supports `style: raw` or `ticker`. |
| `ticker` | Purple | `next` | Push `>> text <<` formatted line. Always ticker-styled. |
| `npc_anchor` | Deep purple | `next` | Set the active NPC voice; prefixes subsequent say nodes with `[NPC Name]`. |
| `inject_news` | Amber | `next` | Pull one item from news queue (category-filtered). Falls back to `fallback_text`. |
| `camera_cut` | Blue-grey | `next` | Read a zone description snapshot, push as `[CAM: label] …`. |
| `break` | Grey | `next` | Natural cut-point; drains news queue inline. Lets urgent news interrupt scripted shows cleanly. |
| `condition` | Red | `ifTrue`, `ifFalse` | Branch on a world condition (synchronous). |
| `wait` | Steel | `next` | Pause N seconds. Only this channel blocks; others are unaffected. |
| `loop` | Green | `next` | Jump to connected node, or `_start` if unconnected. |
| `random` | Tan | N branch ports | Weighted random branch. |
| `set_flag` | Brown | `next` | Set a world flag (e.g. trigger `martial_law` state changes). |

### Conditions (for condition node)

| Type | Params | Notes |
|---|---|---|
| `IS_DAYTIME` | — | Reads game clock |
| `VIEWERS_PRESENT` | — | `hasChannelViewers()` via broadcast-bridge |
| `NEWS_AVAILABLE` | `category` | Checks `newsQueue` length for this channel |
| `HOUR_RANGE` | `from`, `to` | Game clock 0–23 |
| `RANDOM_CHANCE` | `chance` 0–1 | Pure random, no seed |

### Graph DB format

Identical to the AI behaviour graph format:

```js
{
  _start: 'node_id',
  nodes: {
    node_id: { type, ...fields, next?, ifTrue?, ifFalse?, branch_0?, _vine: { x, y } }
  }
}
```

Conversion helpers: `VineBroadcastSchema.fromBroadcastGraph(dbGraph)` → VINE graph, `VineBroadcastSchema.toBroadcastGraph(vineGraph)` → DB graph. Auto-layout is applied when opening a graph that has no `_vine` position data.

### Opening the editor

From the Broadcasts panel, open or create a broadcast and click **⬡ VINE** in the modal header:

```js
vineModalOpen(`VINE — ${name}`, VineBroadcastSchema, graphData, (vineGraph) => {
  _broadcastGraph = VineBroadcastSchema.toBroadcastGraph(vineGraph);
});
```

A "VINE graph" badge appears in the modal header when a graph is attached. The graph is saved alongside the flat `messages` array; the runtime prefers the graph when present.

---

## AI integration

Two entries were added to the AI behaviour system for NPC hosts:

### `BROADCAST_SAY` action

In an NPC's VINE behaviour graph:

```
Action node → type: BROADCAST_SAY
  channel_id: 'ch_ksab_tv'
  text: 'Good evening. Tonight's top story…'
```

The AI engine emits `npc.broadcast_say` → broadcast plugin queues the text. The NPC does not need to be in the broadcast zone. This is a one-way fire-and-forget; the NPC's dialogue and behaviour are entirely separate from the broadcast text.

### `CHANNEL_HAS_VIEWERS` condition

```
Condition node → type: CHANNEL_HAS_VIEWERS
  channel_id: 'ch_ksab_tv'
```

Routes `ifTrue`/`ifFalse` based on whether any player is currently watching that channel. Useful for making a host NPC patrol into camera range only when the channel has viewers, or to trigger a special event segment.

---

## Dev panel

### Broadcasts panel (`panels/broadcast.js`)

- Lists all `media_broadcasts` with name, category, playback mode, and calculated duration.
- **Edit modal**: name, description, category, playback mode, interval, override duration, loop toggle, enabled toggle.
- **Flat message sequence**: ordered list of text lines, moveable rows, duration preview.
- **⬡ VINE button**: opens the VINE graph editor. Badge shows when a graph is attached. Graph is stored in `_broadcastGraph` and saved with the record as `broadcast_graph`.

### Channels panel (`panels/broadcast-channel.js`)

- Lists all channels with number, name, type, item count.
- **Visual timeline editor**: horizontal scrollable canvas, items positioned at `start_time * scale`. Drag to reposition (snaps to 30s). Resize via right-edge drag.
- **Library**: drag broadcast assets from the left library pane onto the timeline.
- **Camera section**: list, editor modal, clear buffer, convert to broadcast.

### Routes (`/broadcast/…`)

All broadcast routes use `directAPI` (not the staging API).

| Method | Path | Action |
|---|---|---|
| GET | `/broadcast/broadcasts` | List all broadcasts |
| POST | `/broadcast/broadcasts` | Create broadcast |
| PUT | `/broadcast/broadcasts/:id` | Update broadcast (includes `broadcast_graph`) |
| DELETE | `/broadcast/broadcasts/:id` | Delete broadcast |
| GET | `/broadcast/channels` | List channels with playlist |
| POST | `/broadcast/channels` | Create channel |
| PUT | `/broadcast/channels/:id` | Update channel |
| PUT | `/broadcast/channels/:id/playlist` | Replace entire playlist (DELETE + INSERT) |
| GET | `/broadcast/cameras` | List cameras |

---

## Game client

`dispatch.js` handles `{ type: 'broadcast', message, channel, style }`:

```js
broadcast: (msg) => appendMsg(msg.message, msg.style === 'ticker' ? 'broadcast-ticker' : 'broadcast')
```

CSS classes in `client/game/styles.css`:

```css
.msg-broadcast        { color: var(--text-dim); border-left: 2px solid var(--border); padding-left: 8px; }
.msg-broadcast-ticker { color: var(--accent); letter-spacing: 0.5px; font-style: italic; border-left: 2px solid var(--accent); padding-left: 8px; }
```

---

## Furniture tag contract

A furniture item becomes a broadcast receiver by having the `atm` flag set... wait, that's wrong — broadcast receivers use:

| Tag | Shape | Purpose |
|---|---|---|
| `broadcast_receiver` | flag | Item can be tuned to a channel |
| `broadcast_device_type` | enum: `tv\|radio\|security_monitor\|portable_monitor\|camera` | Controls `formatMessage()` output |

The `tune <number>` command sets `furniture.flags.tuned_channel`. `loadZoneTunings()` reads this at startup to build `zoneTunings`. When furniture is added/tuned at runtime, `zoneTunings` is updated in memory.

---

## Operational notes

- **Tick cadence**: 5 seconds (not the world scheduler — sub-10s cadence needed). Separate `setInterval` in the plugin.
- **In-memory state only**: `channelRuntimes`, `zoneTunings`, `newsQueue`, `jackLockout` — all reset on server restart. Channel runtimes reconstruct from DB; news queue starts empty; zone tunings are rebuilt from furniture.
- **VINE vs flat list**: the runtime prefers `broadcastGraph` when present. Updating a VINE graph does not affect `messages` and vice versa; both are saved. A channel op could maintain both and switch via `playback_mode` if desired, but current routing just checks `item.broadcastGraph != null`.
- **Camera feeds** (`live_camera` mode): not yet wired — `describeRoom()` integration is stubbed. The table and schema are in place; the runtime lookup is a TODO.
