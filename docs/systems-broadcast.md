# Broadcast System (As Built)

Architect's media framework: scripted channels, live cameras, dynamic news, and VINE-authored broadcast graphs delivered in real-time to players in zones with tuned devices. Players who actively `watch tv` get the full TV panel experience; players in the same room passively hear occasional ambient noise.

Primary server file: [`plugins/broadcast/index.js`](../plugins/broadcast/index.js).  
Dev panel files: [`client/devpanel/js/panels/broadcast.js`](../client/devpanel/js/panels/broadcast.js), [`client/devpanel/js/panels/broadcast-channel.js`](../client/devpanel/js/panels/broadcast-channel.js), [`client/devpanel/js/panels/broadcast-schedule.js`](../client/devpanel/js/panels/broadcast-schedule.js).  
VINE schema: [`client/devpanel/js/vine/vine-schema-broadcast.js`](../client/devpanel/js/vine/vine-schema-broadcast.js).  
Game client: [`client/game/js/panels/tv.js`](../client/game/js/panels/tv.js).

---

## Schema

Five tables in `server/models/schema.js`:

| Table | Purpose |
|---|---|
| `media_broadcasts` | Reusable content assets — scripted shows, news templates, ad spots |
| `media_channels` | Channel definitions — number, type, NPC studio zone, offline graphic |
| `media_channel_playlist` | Daily schedule or loop playlist per channel |
| `media_cameras` | Camera placements, recording buffers, streaming targets |
| `media_graphics` | ASCII art / graphic assets referenced by channels and VINE nodes |

### `media_broadcasts`

```
id TEXT PK
name TEXT
description TEXT
category TEXT             — general | news | advertisement | entertainment | emergency | …
tags JSONB                — []
playback_mode TEXT        — scripted | dynamic_news | live_camera | recorded
messages JSONB            — [{ text: '...' }, ...] flat fallback list
message_interval REAL     — seconds between messages (default 5)
override_duration REAL    — if set, overrides computed duration
loop INTEGER              — 1 = repeat message list when exhausted
enabled INTEGER
broadcast_graph JSONB     — VINE graph; overrides flat message list when present
fallback_messages JSONB   — ['[TECHNICAL DIFFICULTIES]…', …] — used when NPC host is absent
```

### `media_channels`

```
id TEXT PK
name TEXT
number INTEGER UNIQUE     — dial number players tune to
channel_type TEXT         — playlist | news | mixed | live | emergency
station_name TEXT         — display name in TV panel header
theme_id TEXT FK          — references media_themes (optional)
idle_broadcast_id TEXT FK — plays when nothing covers the current time
news_categories JSONB     — ['murder','martial_law',…] — news event filter
loop_playlist INTEGER     — 1 = playlist loops continuously
studio_zone_id TEXT       — zone where NPC hosts work; used for presence checks
offline_graphic_id TEXT   — media_graphics id shown when channel is off-air
```

### `media_channel_playlist`

```
channel_id TEXT FK
broadcast_id TEXT FK
start_time INTEGER        — seconds from loop/day start
duration_override REAL    — overrides computed duration for this slot only
```

### `media_cameras`

```
zone_id TEXT FK
direction TEXT
is_powered INTEGER
is_recording INTEGER
is_streaming INTEGER
streaming_channel_id TEXT FK
recording_buffer JSONB    — [{ ts, text }, …] capped at storage_limit
storage_limit INTEGER     — default 200
```

### `media_graphics`

```
id TEXT PK
name TEXT
content TEXT              — raw ASCII art or text content
```

---

## Runtime Architecture

`plugins/broadcast/index.js` owns the entire server-side runtime. On plugin load:

1. **`loadChannelRuntimes()`** — reads all enabled channels plus their joined playlist from DB, builds in-memory `channelRuntime: Map<channelId, state>`. Each state object holds:
   ```js
   {
     channelId, name, stationName, number, channelType, theme,
     playlist, loopOriginMs, newsQueue,
     studioZoneId, offlineGraphicId,
     wasActive: false,
     currentFallbackMessages: [],
     lastMsgKey: null,
     graphBlackboard: {
       currentNode: null, waitUntil: null, npcAnchor: null,
       activeBroadcastId: null,
       hostAbsent: false, absentDetectedAt: null, techDiffMode: false,
     }
   }
   ```

2. **`loadZoneTunings()`** — reads all furniture with `broadcast_receiver` flag, builds `zoneTunings: Map<zoneId, Map<channelId, deviceType>>` and `furnitureChannelIndex: Map<furnitureId, { zoneId, channelId, deviceType }>`.

3. **`loadGraphicsCache()`** — loads all `media_graphics` rows into `graphicsCache: Map<id, row>` for zero-latency off-air graphic resolution.

4. **`startBroadcastTick()`** — `setInterval(broadcastTick, 5000)`.

### `broadcastTick()`

Every 5 seconds:

1. Iterates `zoneTunings`.
2. Skips zones with no players.
3. For each tuned channel, calls `getCurrentMessage(channelId, nowMs)`.
4. If no result (or duplicate key): checks `state.wasActive`. If it was active last tick, fires a one-time `off_air` signal to all watching players (includes offline graphic content if set), then sets `state.wasActive = false`. Continues to next channel.
5. If a result arrived: formats via `formatMessage(text, deviceType, zone)`, sends `{ type: 'broadcast', message, channel, style }` to all players in the zone. Sets `state.wasActive = true`.

### `getCurrentMessage()`

Resolves what to emit for the current tick:

- **Playlist channels** — finds the active playlist item by `(elapsed % totalDuration)`. If the item has a VINE graph, calls `tickBroadcastGraph()`. Otherwise uses `getScriptedMessage()` (flat message index by elapsed).
- **News channels** — if the active item has a VINE graph, delegates to `tickBroadcastGraph()`. Otherwise pops one item from the channel's `newsQueue`.
- Sets `state.currentFallbackMessages` from the active item's `fallback_messages` before calling `tickBroadcastGraph()`.
- Deduplication: tracks `lastMsgKey` per channel; skips if the same message key would fire twice.

### Broadcast Duration (`broadcastDuration()`)

Computes how many seconds a broadcast asset occupies in the schedule:

1. `override_duration` wins if set.
2. If `broadcast_graph` is present, walks the graph via `_vineDuration()`: `say`/`ticker` nodes each add one `message_interval`; `wait` nodes add `data.seconds`. If this is > 0, it wins.
3. Fallback: `messages.length × message_interval`.

This means VINE-authored broadcasts occupy the correct schedule window even when `wait` nodes add pauses.

### `formatMessage()`

| Device type | Format |
|---|---|
| `tv` | raw text |
| `radio` | `[Radio] text` |
| `security_monitor` | `[FEED — Zone Name] HH:MM:SS — text` |
| other | raw text |

Device type is read from the `broadcast_device_type` tag on the furniture item.

---

## VINE Graph Walker

When a playlist item has `broadcastGraph`, `tickBroadcastGraph(channelId, graph, state, nowMs)` runs each tick. The walker maintains a persistent cursor (`graphBlackboard`) between ticks.

### Blackboard reset

When the active playlist item changes (`activeBroadcastId` differs from last tick), the entire blackboard resets:

```js
currentNode = _start
waitUntil = null
npcAnchor = null
hostAbsent = false
absentDetectedAt = null
techDiffMode = false
```

### NPC presence → camera-idle → tech-diff state machine

**Phase 1 — Normal**: the walker follows the graph normally. When it hits an `npc_anchor` node, it checks whether that NPC is physically present in `state.studioZoneId` (`world.zones.get(studioZoneId)?.npcs.has(npcId)`). If absent and `studioZoneId` is configured, it sets `bb.hostAbsent = true` and `bb.absentDetectedAt = nowMs`.

**Phase 2 — Camera-idle (0–60 seconds)**: once `hostAbsent` is true, `say` and `ticker` nodes are silently skipped (NPC voice suppressed). Instead, each tick returns a live camera snapshot of the empty studio zone as `[CAM: studio] <room description>`. This phase lasts 60 seconds.

**Phase 3 — Technical difficulties (60 s onward)**: after 60 seconds, `bb.techDiffMode = true`. The walker short-circuits each tick to return a rotating line from `state.currentFallbackMessages`. Default fallback: `'[TECHNICAL DIFFICULTIES] Please stand by.'`. The show continues outputting until the schedule slot expires and the blackboard resets for the next program.

### Node types

| Type | Per-tick behaviour |
|---|---|
| `say` | Return `{ text, key, style: 'raw' }`. Skipped (node advanced) when `hostAbsent`. |
| `ticker` | Return `{ text, key, style: 'ticker' }`. Skipped when `hostAbsent`. |
| `wait` | Set `waitUntil = nowMs + data.seconds * 1000`. Block until elapsed. |
| `npc_anchor` | Set `bb.npcAnchor`. Check NPC presence against `studioZoneId`. Advance. |
| `camera_cut` | Return `[CAM: label] <zone snapshot>`. |
| `inject_news` | Pull one item from `newsQueue` by category, or emit `fallback_text`. |
| `break` | Drain one item from `newsQueue`; if empty, continue graph. |
| `condition` | Branch `ifTrue` / `ifFalse` synchronously. |
| `loop` | Jump to connected target or back to `_start`. |
| `random` | Pick a branch weighted by `branch.weight`. |
| `set_flag` | Call `setFlag(flag, value)`. Advance immediately. |
| `title_card` | Return graphic content from `graphicsCache` by `graphic_id`. |
| `overlay` | Push `{ type: 'tv_overlay', overlay: { overlayType, text, subtext, duration } }` to watching players. |

Guards against cycles: max 50 hops per tick before early exit.

---

## Dynamic News

World events feed channels whose `news_categories` includes the event category:

```js
on('player.death', …) → enqueueNews('murder',     'Breaking: X was found dead in Y.', 'normal')
on('flag.set', …)     → enqueueNews('martial_law', 'EMERGENCY ALERT: …',               'critical')
```

`enqueueNews(category, text, priority, ts)` appends to each matching channel's `newsQueue`. Critical items are prepended. News channels drain one item per tick from the queue; when empty, the idle broadcast plays.

---

## AI Integration

### `BROADCAST_SAY` action

In an NPC's VINE behaviour graph:

```
Action node → type: BROADCAST_SAY
  channel_id: 'ch_ksab_tv'
  text: 'Good evening. Tonight's top story…'
```

The AI engine emits `npc.broadcast_say` → broadcast plugin queues the text on that channel. The NPC does not need to be in the studio zone for this path — it is a fire-and-forget voice insert, separate from the scripted VINE broadcast graph.

### `CHANNEL_HAS_VIEWERS` condition

```
Condition node → type: CHANNEL_HAS_VIEWERS
  channel_id: 'ch_ksab_tv'
```

Returns true if any player is currently watching that channel. Implemented via `broadcast-bridge.js` to avoid circular imports between the AI engine and the broadcast plugin.

### `broadcast-bridge.js`

A thin registry (`server/engine/broadcast-bridge.js`) that breaks the circular import:

```js
registerViewerChecker(fn)    // called by broadcast plugin at startup
hasChannelViewers(channelId) // called by ai-behaviour evalCondition
```

The broadcast plugin registers a closure over `zoneTunings`. The AI engine calls `hasChannelViewers` synchronously per evaluation.

---

## Furniture Tag Contract

| Tag | Shape | Purpose |
|---|---|---|
| `broadcast_receiver` | flag | Item can be tuned to a channel |
| `broadcast_device_type` | enum: `tv\|radio\|security_monitor\|portable_monitor\|camera` | Controls `formatMessage()` output |
| `tv` | flag | Item is openable as a TV panel via `watch tv` / `tv` command |

The `tune <n>` command sets `furniture.flags.tuned_channel`. `loadZoneTunings()` builds the in-memory map at startup; the `tune` command updates it live without a DB reload.

---

## Player Commands

| Command | Behaviour |
|---|---|
| `watch tv` / `tv` / `watch television` | Opens the TV panel for the first `tv`-tagged device in the zone |
| `tune <n>` | Tunes the `broadcast_receiver` device in the zone to channel `n`; re-sends `tv_panel` if panel is open |
| `tune 0` | Turns the device off; triggers CRT shutoff animation if panel is open |

---

## Game Client — Passive vs Active

### Passive viewers (not watching)

Players in the same room as a tuned TV who have not opened the TV panel hear only occasional ambient noise. Every 8th broadcast tick that would have reached them:

```
[TV] static voices from the television...
```

No broadcast content is ever shown in the main chat stream.

### Active viewers (TV panel open)

All broadcast messages for the active channel are routed to the TV panel. Messages with `style: 'ticker'` go to the ticker strip. All others append to the scrollable content area.

`dispatch.js` handler:

```js
broadcast: (msg) => {
  if (msg.style === 'off_air') {
    if (isTvOpen() && getTvActiveChannelId() === msg.channel)
      showTvOffAir(msg.offlineGraphicContent || null);
    return;
  }
  if (isTvOpen() && getTvActiveChannelId() === msg.channel) {
    if (msg.style === 'ticker') updateTvTicker(msg.message);
    else appendTvMessage(msg.message, msg.style);
  } else {
    if (++_tvAmbientCounter % 8 === 0)
      appendMsg('[TV] static voices from the television...', 'broadcast-ambient');
  }
},
tv_panel: (msg) => { openTvPanel(msg); },
tv_off:   ()    => { if (isTvOpen()) shutdownTvPanel(); },
```

---

## TV Panel (`client/game/js/panels/tv.js`)

### Structure

```
╔═══════════════════════════════════════════════════════╗
║  STATION NAME          CH 7    Program Name  ● LIVE   ║
╠═══════════════════════════════════════════════════════╣
║                                                       ║
║            Scrollable broadcast content               ║
║                 (history up to 200 msgs)              ║
║                                                       ║
╠═══════════════════════════════════════════════════════╣
║  BREAKING • ticker text scrolls here right-to-left •  ║
╠═══════════════════════════════════════════════════════╣
║  [knob]  ┄┄ 5.0 ┄┄┄[slider]┄┄┄┄┄┄┄┄┄┄┄┄┄┄           ║
╚═══════════════════════════════════════════════════════╝
```

- **Header**: station name, channel number, program name, LIVE badge (pulses red while receiving).
- **Content**: broadcast messages append here. Scrollback is preserved. Scrolling up pauses auto-scroll; returning to the bottom restores LIVE mode — the badge dims when scrolled.
- **Ticker strip**: `style: 'ticker'` messages feed a horizontally scrolling ticker. Multiple ticker messages within the same animation are concatenated with `●` separators. The text enters fully off-screen right (`translateX(trackWidth)`) and exits fully off the left edge (`translateX(-textWidth)`), measured at runtime via `scrollWidth`/`offsetWidth` for accuracy. Speed is constant 80 px/s.
- **Footer**: channel knob + frequency tuner.

### Themes

Each channel can reference a `theme_id` from `media_themes`. `applyTvTheme(theme)` sets CSS variables on `#tv-window`:

| Variable | Controls |
|---|---|
| `--tv-bg` | Panel background |
| `--tv-border` | Border and glow colour |
| `--tv-text` | Content text colour |
| `--tv-header-color` | Header accent, knob line, ticker label |
| `--tv-live-color` | LIVE badge pulse colour |
| `--tv-ticker-color` | Ticker text colour |

Built-in theme presets (applied via `data-theme` attribute): `corporate`, `crt`, `emergency`, `security`, `pirate`.

### Frequency Tuner

The TV footer contains a frequency dial:

- **`#tv-freq-display`**: shows current frequency as a decimal (e.g. `7.0`).
- **`#tv-tuner-slider`**: range input from 0 to `(highest channel number + 2)`. Dragging calls `tvTunerInput(val)`.
- **`tvTunerInput(val)`**: updates `_tvFrequency`, finds the nearest channel, sets the static overlay opacity proportional to distance from that channel (`opacity = min(1, dist / LOCK_RANGE)`). When within `LOCK_RANGE = 0.25` of a channel number and not already on that channel, calls `_tvTuneTo(n)` — sends `tune n` to the server and plays the tune animation.
- **Knob click**: cycles to the next channel in `_tvChannelList` (sorted by channel number), wrapping around.

Channel list is sent by the server in every `tv_panel` message and used to populate the tuner's range and lock targets.

### Off-Air State

When a channel transitions from active to silent, the server sends:

```js
{ type: 'broadcast', channel, style: 'off_air', offlineGraphicContent: '...' | null }
```

`showTvOffAir(offlineGraphicContent)`:

- If `offlineGraphicContent` is set: shows it in the content area as `ascii_art`.
- Otherwise: hides content, shows the `#tv-static` element with `tv-static-loop` (CSS flicker animation).

The server also fires the off-air signal immediately in `buildTvPanel()` when a player opens or re-tunes to a channel that is currently off-air, so they never see a blank panel.

### Tune-In Animation

When a channel switch occurs (`openTvPanel` or `_tvTuneTo`):

1. Content hidden; static overlay shown at full opacity.
2. Knob SVG rotates 360° over ~1.1 s (`tv-knob-spinning`).
3. After 1.1 s: static fades out via `tv-static-out` keyframe; content reveals.

### CRT Shutoff Animation (`shutdownTvPanel()`)

Triggered by: close button, ESC, clicking the backdrop, or the server's `tv_off` message (fired by `tune 0`).

The `#tv-window` receives class `tv-shutting-off`:

```
0%:   full size, normal brightness
10%:  scaleY(0.012) — image snaps to thin horizontal line with 4× brightness flash
28%:  line starts contracting horizontally, brightness dropping
100%: scaleY(0.012) scaleX(0), brightness(0) — line vanishes
```

Total duration: 0.55 s. On `animationend`, `closeTvPanel()` is called to actually remove the panel from the DOM.

`closeTvPanel()` (instant, used for programmatic channel switches) bypasses the animation.

### `tv_panel` message

Sent by the server whenever the player opens a TV or successfully tunes to a new channel:

```js
{
  type: 'tv_panel',
  channelId, channelName, stationName,
  channelNumber,
  channelType,
  theme,        // theme row or null
  channelList,  // [{ number, name, channelId }] sorted by number — populates tuner
}
```

`openTvPanel(data)` resets all panel state (history, ticker, static) and plays the tune-in animation.

---

## Dev Panel

### Broadcasts Panel (`panels/broadcast.js`)

Split-pane layout: sidebar list (left) + storyboard canvas editor (right).

**Sidebar**: all broadcasts with category colour dot, channel number badge, computed duration. "+ New" creates a blank broadcast. "↑ Import .bsm" runs the BSM dependency resolver.

**Canvas editor**: card-based VINE graph editor. Each node in the broadcast graph is a card that can be expanded inline to edit fields. Card types: `start`, `say`, `ticker`, `wait`, `npc_anchor`, `camera_cut`, `overlay`, `title_card`. Drag handles reorder cards; the graph's `next` chain is rebuilt on save. Branch nodes (condition/random/loop) are shown as read-only badges with "Edit in VINE ⬡".

**⬡ VINE button**: opens the full VINE graph modal. On save, the canvas syncs via `_bcBuildCards()`.

**Fallback Messages textarea**: one line per message. Saved as `fallback_messages` JSONB. Used when an NPC host is absent (tech-diff mode).

**Duration readout**: computed client-side via `_bcVineDuration()` — the same node-walk logic as the server — displayed next to the message interval field.

### Channels Panel (`panels/broadcast-channel.js`)

Per-channel settings: name, number, type, station name, theme, idle broadcast, news categories, loop toggle, enabled toggle, **Studio Zone ID**, **Offline Graphic ID**.

- **Studio Zone ID**: zone where NPC hosts work. If the NPC anchor is absent from this zone at broadcast time, the presence state machine activates.
- **Offline Graphic ID**: `media_graphics` row ID. Content is shown in the TV panel when the channel is off-air instead of the default static animation.

### Schedule Panel (`panels/broadcast-schedule.js`)

Sidebar channel list (left) + per-channel 24 h timeline (right).

- Clicking a channel in the sidebar loads its daily schedule on the timeline.
- Broadcast assets live in a library drawer below the timeline and can be dragged onto the timeline to create playlist slots.
- Slots are resizable (right edge drag) and repositionable (body drag), snapping to 30-second intervals.
- Inline channel rename/renumber in the timeline header (saved on blur via `PUT /broadcast/channels/:id`).

### API Routes

All broadcast routes use `directAPI`:

| Method | Path | Action |
|---|---|---|
| GET | `/broadcast/broadcasts` | List all broadcasts (includes `broadcast_graph`, `fallback_messages`) |
| POST | `/broadcast/broadcasts` | Create broadcast |
| PUT | `/broadcast/broadcasts/:id` | Update broadcast |
| DELETE | `/broadcast/broadcasts/:id` | Delete broadcast |
| GET | `/broadcast/channels` | List channels with playlist |
| POST | `/broadcast/channels` | Create channel |
| PUT | `/broadcast/channels/:id` | Update channel (includes `studio_zone_id`, `offline_graphic_id`) |
| PUT | `/broadcast/channels/:id/playlist` | Replace entire playlist (DELETE + INSERT) |
| GET | `/broadcast/cameras` | List cameras |
| GET | `/broadcast/graphics` | List graphics |

---

## Operational Notes

- **Tick cadence**: 5 seconds, separate `setInterval` in the plugin (not the world scheduler).
- **In-memory only**: `channelRuntime`, `zoneTunings`, `newsQueue`, `graphicsCache` — all rebuilt on server restart from DB. News queue starts empty on restart; news events re-populate it as they occur in-world.
- **VINE vs flat list**: runtime prefers `broadcastGraph` when present on a playlist item. Both are saved independently; updating one does not affect the other.
- **Off-air signal fires once per transition**: `state.wasActive` tracks whether the channel was active last tick. The off-air signal fires exactly once when a channel goes silent. It fires again immediately via `buildTvPanel()` when a player opens a TV that is currently off-air.
- **NPC presence requires `studio_zone_id`**: if `studioZoneId` is not set on the channel runtime, presence checks are skipped — the broadcast runs regardless of where the NPC is. This is the safe default for channels without a physical studio.
- **Blackboard lifetime**: one blackboard per channel, persists across ticks, resets when the active `broadcast_id` changes (next schedule slot). This means the tech-diff state machine clears automatically when the show's time slot ends.
