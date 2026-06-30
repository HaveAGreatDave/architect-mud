# Broadcast System (As Built)

Architect's media framework: scripted channels, live cameras, dynamic news, and VINE-authored broadcast graphs delivered in real-time to players in zones with tuned devices. Players who actively `watch tv` get the full TV panel experience; players in the same room passively hear occasional ambient noise.

Primary server file: [`plugins/broadcast/index.js`](../plugins/broadcast/index.js).  
Dev panel files: [`client/devpanel/js/panels/broadcast.js`](../client/devpanel/js/panels/broadcast.js), [`client/devpanel/js/panels/broadcast-channel.js`](../client/devpanel/js/panels/broadcast-channel.js), [`client/devpanel/js/panels/broadcast-schedule.js`](../client/devpanel/js/panels/broadcast-schedule.js), [`client/devpanel/js/panels/broadcast-themes.js`](../client/devpanel/js/panels/broadcast-themes.js), [`client/devpanel/js/panels/broadcast-graphics.js`](../client/devpanel/js/panels/broadcast-graphics.js).  
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
| `media_graphics` | ASCII art and SVG graphic assets referenced by channels and VINE nodes |

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
channel_id TEXT FK        — channel this broadcast is assigned to (informational, not scheduling)
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
studio_zone_id TEXT FK    — zone where NPC hosts work; used for presence checks
offline_graphic_id TEXT FK — media_graphics id shown when channel is off-air
zone_id TEXT FK           — physical location of the channel's transmitter/studio
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
description TEXT
type TEXT                 — 'ascii' | 'svg'
content TEXT              — raw ASCII art string, or a complete <svg>…</svg> document
tags JSONB                — []
```

The `type` field controls how the content is rendered. `ascii` content is displayed as a `<pre>` element. `svg` content is injected as live SVG markup, centred and scaled to fit the panel.

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

3. **`loadGraphicsCache()`** — loads all `media_graphics` rows (`id`, `name`, `type`, `content`) into `graphicsCache: Map<id, row>` for zero-latency off-air graphic resolution.

4. **`startBroadcastTick()`** — `setInterval(broadcastTick, 5000)`.

### `broadcastTick()`

Every 5 seconds:

1. Iterates `zoneTunings`.
2. Skips zones with no players.
3. For each tuned channel, calls `getCurrentMessage(channelId, nowMs)`.
4. If no result (or duplicate key): checks `state.wasActive`. If it was active last tick, fires a one-time `off_air` signal to all watching players (includes offline graphic content and type if set), then sets `state.wasActive = false`. Continues to next channel.
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

**Phase 1 — Normal**: the walker follows the graph normally. When it hits an `npc_anchor` node, it checks whether that NPC is physically present in `state.studioZoneId`. If absent and `studioZoneId` is configured, it sets `bb.hostAbsent = true` and `bb.absentDetectedAt = nowMs`.

**Phase 2 — Camera-idle (0–60 seconds)**: once `hostAbsent` is true, `say` and `ticker` nodes are silently skipped. Instead, each tick returns a live camera snapshot of the empty studio zone as `[CAM: studio] <room description>`. This phase lasts 60 seconds.

**Phase 3 — Technical difficulties (60 s onward)**: after 60 seconds, `bb.techDiffMode = true`. The walker short-circuits each tick to return a rotating line from `state.currentFallbackMessages`. Default fallback: `'[TECHNICAL DIFFICULTIES] Please stand by.'`.

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
| `title_card` | Fetch graphic from `graphicsCache` by `graphic_id`. Return `{ text: content, style: 'svg' \| 'ascii_art' }` based on `graphic.type`. |
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

The AI engine emits `npc.broadcast_say` → broadcast plugin queues the text on that channel. The NPC does not need to be in the studio zone for this path.

### `CHANNEL_HAS_VIEWERS` condition

```
Condition node → type: CHANNEL_HAS_VIEWERS
  channel_id: 'ch_ksab_tv'
```

Returns true if any player is currently watching that channel. Implemented via `broadcast-bridge.js` to avoid circular imports.

### `broadcast-bridge.js`

`server/engine/broadcast-bridge.js` breaks the circular import:

```js
registerViewerChecker(fn)    // called by broadcast plugin at startup
hasChannelViewers(channelId) // called by ai-behaviour evalCondition
```

---

## Furniture Tag Contract

| Tag | Shape | Purpose |
|---|---|---|
| `broadcast_receiver` | flag | Item can be tuned to a channel |
| `broadcast_device_type` | enum: `tv\|radio\|security_monitor\|portable_monitor\|camera` | Controls `formatMessage()` output |
| `tv` | flag | Item is openable as a TV panel via `watch tv` / `tv` command |

---

## Player Commands

| Command | Behaviour |
|---|---|
| `watch tv` / `tv` / `watch television` | Opens the TV panel for the first `tv`-tagged device in the zone |
| `tune <n>` | Tunes the `broadcast_receiver` device in the zone to channel `n`; re-sends `tv_panel` if panel is open |
| `tune 0` | Turns the device off; triggers CRT shutoff animation if panel is open |
| `use <deck name>` | Opens the media deck panel (`mediadeck_panel`) for the `media_deck`-tagged furniture in the zone |
| `load cassette` | Loads a carried `media_cassette` item into the deck in the zone; **consumes the item from inventory** (the tape physically goes into the deck) and sets it active |
| `eject` | Stops the deck's active cassette, **removes its broadcast from the deck's library**, and spawns the physical cassette item (`item_cassette_<broadcastId>`) back into the player's inventory — at most one copy per broadcast can exist in a player's inventory at a time |
| `selectcassette <broadcastId>` | Switches the deck's active cassette among ones already in its library, without needing to carry the tape (used by panel row clicks) |

---

## Media Deck & Cassettes

Implemented in `plugins/broadcast/index.js` (search `Media Deck`).

- A media deck is `furniture` with `flags.media_deck = true`, `flags.channel_id`, `flags.deck_cassettes` (array of `broadcast_id`s in its library), and `flags.deck_active` (the currently-loaded `broadcast_id`, or `null`).
- While a deck has `deck_active` set, its messages **override** the linked channel's own programming for any zone-tuned viewers (`_getDeckMessage()` takes priority over `getCurrentMessage()` in `broadcastTick()`). Ejecting clears `deck_active` and removes that broadcast from `deck_cassettes`, so the deck goes idle and the channel falls through to its own programming — if the channel has nothing else scheduled, `broadcastTick()`'s existing off-air logic kicks in and viewers see static / the channel's offline graphic, exactly as it would for any other no-content channel state. A deck-message lookup cache (`_deckCache`, 10s TTL) is explicitly invalidated on load/eject so this transition isn't delayed by the cache.
- Cassette items are `items` rows with a deterministic id `item_cassette_<broadcastId>` and `tags.media_cassette = true` / `tags.broadcast_id`. The same id convention is used both by the dev-panel BSM import flow (`POST /broadcast/cassette`) and by `eject`, so the two paths always converge on one item definition per broadcast rather than creating duplicates.
- The media deck panel (`client/game/js/panels/mediadeck.js`, markup in `client/game/index.html`) shows a cartridge "slot" that slides a cartridge graphic into view when a cassette is active, a scrollable library list (click a row to `selectcassette`), a read-only schedule preview, and a LOAD / EJECT button row (LOAD sends `load cassette`, EJECT sends `eject`).

## Game Client — Passive vs Active

### Passive viewers (not watching)

Every 8th broadcast tick that would have reached them:

```
[TV] static voices from the television...
```

No broadcast content is ever shown in the main chat stream.

### Active viewers (TV panel open)

All broadcast messages for the active channel are routed to the TV panel. `style: 'ticker'` goes to the ticker strip. `style: 'svg'` is injected as live SVG markup. All others append as text.

`dispatch.js` handler:

```js
broadcast: (msg) => {
  if (msg.style === 'off_air') {
    if (isTvOpen() && getTvActiveChannelId() === msg.channel)
      showTvOffAir(msg.offlineGraphicContent || null, msg.offlineGraphicType || 'ascii');
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

### Message rendering (`appendTvMessage(text, style)`)

| Style | Render method |
|---|---|
| `raw` | `div.textContent = text` |
| `ticker` | Routed to the ticker strip, not the content area |
| `ascii_art` | `pre.textContent = text` — monospace, pre-wrapped, coloured by `--tv-header-color` |
| `svg` | `div.innerHTML = text` — SVG injected as live markup, `max-width:100%; height:auto` |

SVG graphics are centred and scale to fit the panel width. Because graphics are dev-authored (not player input), innerHTML injection is safe.

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

- **`#tv-freq-display`**: current frequency as a decimal (e.g. `7.0`).
- **`#tv-tuner-slider`**: range input from 0 to `(highest channel number + 2)`. Dragging calls `tvTunerInput(val)`.
- **Knob click**: cycles to the next channel in `_tvChannelList`, wrapping around.
- Lock range `LOCK_RANGE = 0.25`: within this many channel-numbers of a real channel, the tuner locks and calls `_tvTuneTo(n)`.

### Off-Air State

When a channel goes silent the server sends:

```js
{
  type: 'broadcast', channel, style: 'off_air',
  offlineGraphicContent: '...' | null,
  offlineGraphicType: 'ascii' | 'svg'
}
```

`showTvOffAir(content, type)`:
- If `content` is set: calls `appendTvMessage(content, type === 'svg' ? 'svg' : 'ascii_art')`.
- Otherwise: hides content, shows `#tv-static` with CSS flicker loop.

The off-air signal fires immediately in `buildTvPanel()` when a player opens or re-tunes to a currently-silent channel.

### Tune-In Animation

1. Content hidden; static overlay shown at full opacity.
2. Knob SVG rotates 360° over ~1.1 s (`tv-knob-spinning`).
3. After 1.1 s: static fades out; content reveals.

### CRT Shutoff Animation (`shutdownTvPanel()`)

Triggered by: close button, ESC, backdrop click, or server `tv_off` (from `tune 0`).

```
0%:   full size, normal brightness
10%:  scaleY(0.012) — snap to thin horizontal line, 4× brightness flash
28%:  line contracts horizontally, brightness drops
100%: scaleY(0.012) scaleX(0), brightness(0) — vanishes
```

Duration: 0.55 s. `closeTvPanel()` (programmatic, instant) bypasses the animation.

---

## Dev Panel

All broadcast tools live under a single **📺 Broadcasts** nav item. The panel renders a tab bar with five sub-tabs. Opening the Broadcasts panel fetches all required data in parallel: broadcasts, channels, NPCs, themes, graphics, zones.

### Sub-tabs

| Tab | File | Purpose |
|---|---|---|
| 📺 Broadcasts | `broadcast.js` | Storyboard canvas editor for individual broadcast assets |
| 📡 Channels | `broadcast-channel.js` | Channel metadata, playlists, camera manager |
| 📅 Schedule | `broadcast-schedule.js` | 24-hour timeline drag-and-drop scheduler |
| 🎨 Themes | `broadcast-themes.js` | CSS variable theme editor for the TV panel |
| 🖼 Graphics | `broadcast-graphics.js` | ASCII art and SVG graphic asset library |

Navigating between tabs preserves the loaded data (`_bcSuiteData`). Mutations (save/delete) in any sub-tab call `bcSuiteRefresh(tabName)` to re-fetch all data and re-render the suite on the correct tab.

### Broadcasts Tab (`broadcast.js`)

Split-pane: sidebar list + storyboard canvas editor.

**Sidebar**: all broadcasts with category colour dot and channel badge. "+ New" creates a blank broadcast. "↑ BSM" runs the BSM import flow.

**Canvas editor card types** and their inline field editors:

| Card type | Fields |
|---|---|
| `say` | Text (textarea), Style (raw / emote / narrate / system) |
| `ticker` | Ticker text (textarea) |
| `wait` | Duration (seconds) |
| `npc_anchor` | NPC ID (text) |
| `camera_cut` | Zone (dropdown from all zones), Label |
| `overlay` | Graphic (dropdown from `media_graphics`), Overlay text |
| `title_card` | Graphic (dropdown from `media_graphics`) |

`camera_cut`, `overlay`, and `title_card` card fields use populated dropdowns (zones and graphics are pre-fetched with the suite data) rather than plain text ID inputs.

**⬡ VINE button**: opens the full VINE graph modal. On save, the canvas syncs via `_bcBuildCards()`.

### BSM Import Flow

The BSM (Broadcast Script Markup) importer runs a three-step modal flow:

**Step 1 — Channel selection** (`_bcShowImportChannelModal`):  
Before any dependency checks, the user assigns the broadcast to a channel. Options:
- Pick an existing channel from a dropdown.
- Select "no channel" (imports unassigned).
- Select "+ Create new channel…" — expands an inline form with name, number, and a **Pick zone on map** button. Clicking the map button opens the same world-grid zone picker used in the dependency resolver. The chosen cell creates a new zone (`zone_ch_<n>_<ts>`) with the label `<channel name> Studio`, which becomes the new channel's `zone_id`. The channel is created with `channel_type: 'playlist'` before proceeding.

**Step 2 — Dependency resolver** (`_bcImportDependencies`):  
Checks the script's referenced NPCs and broadcast room zone IDs against the DB. Missing entities are listed in a modal with Create / Place on Map actions per item. The Finish Import button enables only when all dependencies are resolved.

**Step 3 — Import save** (`_bcImportSave`):  
Uploads any graphic assets embedded in the BSM file, then creates or overwrites the broadcast. The channel selected in Step 1 takes precedence over any `@channel` directive in the BSM file.

### Channels Tab (`broadcast-channel.js`)

Per-channel settings: name, number, type, station name, theme, idle broadcast, news categories, loop toggle, enabled toggle.

- **Studio Zone**: dropdown of all zones (the zone where NPC hosts work).
- **Offline Graphic**: dropdown of all `media_graphics` entries (the graphic shown when the channel is off-air).

The channel editor also fetches graphics and zones fresh on open, so newly created zones appear immediately.

Below the channel list, the **Cameras** section manages `media_cameras` entries. The camera editor's Zone dropdown is fetched fresh on open.

### Schedule Tab (`broadcast-schedule.js`)

Sidebar channel list (left) + per-channel 24 h timeline (right). Broadcast assets live in a library drawer below the timeline and can be dragged onto the timeline to create playlist slots. Slots are resizable (right edge drag) and repositionable (body drag), snapping to 30-second intervals.

### Graphics Tab (`broadcast-graphics.js`)

The graphic editor modal opens with three tabs:

**🎨 ASCII Canvas** — cell-grid painter. Click to paint characters from the palette, use arrow keys to move the cursor, type any character to paint it. Supports resize. Syncs bidirectionally with the Text tab.

**✏ Text** — raw textarea. Paste ASCII art or hand-write SVG. Live preview below. Syncs to canvas on tab switch. If the content starts with `<svg`, saving auto-sets `type: 'svg'`.

**◈ Vector** — live SVG canvas editor (modal widens to 960 px):

- **Tools**: Select (↖), Rect (▬), Circle (●), Line (╱), Text (T)
- **Creating**: drag on the canvas to draw rects, circles, lines; click to place text (prompts for content)
- **Selecting**: click a shape with the Select tool; drag to move; 8 resize handles on rects/circles; 2 endpoint handles on lines
- **Properties panel** (right sidebar): fill + stroke colour pickers with hex fallback, stroke width, opacity; type-specific fields (text content, font size/weight/family; rect corner radius)
- **Shape list**: shows all shapes top-to-bottom, click to select, ↑↓ to reorder z-order, ✕ to delete
- **Canvas controls**: width, height (default 640×360), background colour
- **Saving**: serialises shapes to a clean `<svg xmlns=…>` string, sets `type: 'svg'` automatically
- **Loading**: parses editor-generated SVG back into the shape list when reopening. Hand-edited SVG can be loaded via the Text tab and then switched to Vector for further editing.

### API Routes

All broadcast routes use `directAPI`:

| Method | Path | Action |
|---|---|---|
| GET | `/broadcast/broadcasts` | List all broadcasts |
| POST | `/broadcast/broadcasts` | Create broadcast |
| PUT | `/broadcast/broadcasts/:id` | Update broadcast |
| DELETE | `/broadcast/broadcasts/:id` | Delete broadcast |
| GET | `/broadcast/channels` | List channels with playlist |
| POST | `/broadcast/channels` | Create channel |
| PUT | `/broadcast/channels/:id` | Update channel |
| PUT | `/broadcast/channels/:id/playlist` | Replace entire playlist |
| GET | `/broadcast/cameras` | List cameras |
| POST | `/broadcast/cameras` | Create camera |
| PUT | `/broadcast/cameras/:id` | Update camera |
| DELETE | `/broadcast/cameras/:id` | Delete camera |
| GET | `/broadcast/graphics` | List graphics |
| POST | `/broadcast/graphics` | Create graphic |
| PUT | `/broadcast/graphics/:id` | Update graphic |
| DELETE | `/broadcast/graphics/:id` | Delete graphic |
| GET | `/broadcast/themes` | List themes |
| POST | `/broadcast/themes` | Create theme |
| PUT | `/broadcast/themes/:id` | Update theme |
| DELETE | `/broadcast/themes/:id` | Delete theme |

---

## Operational Notes

- **Tick cadence**: 5 seconds, separate `setInterval` in the plugin (not the world scheduler).
- **In-memory only**: `channelRuntime`, `zoneTunings`, `newsQueue`, `graphicsCache` — all rebuilt on server restart from DB. News queue starts empty on restart.
- **Graphics cache**: holds `id`, `name`, `type`, `content`. `type` is used by `title_card` and `off_air` to set the correct wire style (`'svg'` vs `'ascii_art'`), which the client uses to pick `innerHTML` vs `textContent` rendering.
- **VINE vs flat list**: runtime prefers `broadcastGraph` when present. Both are saved independently.
- **Off-air signal fires once per transition**: `state.wasActive` tracks channel activity. The signal fires exactly once when a channel goes silent, and again immediately via `buildTvPanel()` when a player opens a currently-silent TV.
- **NPC presence requires `studio_zone_id`**: if not set, presence checks are skipped — the broadcast runs regardless of NPC location.
- **Blackboard lifetime**: one per channel, persists across ticks, resets when the active `broadcast_id` changes.
- **SVG graphics**: displayed as inline SVG in the TV panel. Content is dev-authored, making `innerHTML` injection safe. The `max-width:100%; height:auto` rule on the injected `<svg>` ensures it scales to the panel width. The recommended canvas size for title sequences is 640×360.
