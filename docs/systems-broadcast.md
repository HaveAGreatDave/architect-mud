# Broadcast System (As Built)

Architect's media framework: scripted channels, live cameras, dynamic news, and VINE-authored broadcast graphs delivered in real-time to players in zones with tuned devices. Players who actively `watch tv` get the full TV panel experience; players in the same room passively hear occasional ambient noise.

Primary server file: [`plugins/broadcast/index.js`](../plugins/broadcast/index.js).  
Dev panel files: [`client/devpanel/js/panels/broadcast.js`](../client/devpanel/js/panels/broadcast.js), [`client/devpanel/js/panels/broadcast-channel.js`](../client/devpanel/js/panels/broadcast-channel.js), [`client/devpanel/js/panels/broadcast-schedule.js`](../client/devpanel/js/panels/broadcast-schedule.js), [`client/devpanel/js/panels/broadcast-themes.js`](../client/devpanel/js/panels/broadcast-themes.js), [`client/devpanel/js/panels/broadcast-graphics.js`](../client/devpanel/js/panels/broadcast-graphics.js).  
VINE schema: [`client/devpanel/js/vine/vine-schema-broadcast.js`](../client/devpanel/js/vine/vine-schema-broadcast.js).  
Game client: [`client/game/js/panels/tv.js`](../client/game/js/panels/tv.js) (the shared renderer behind
both the standalone CRT set and the Tablet TV app — see [Two TV surfaces, one renderer](#two-tv-surfaces-one-renderer)).
Tablet app: [`plugins/tablet/tv-app.js`](../plugins/tablet/tv-app.js).

---

## Schema

Seven tables in `server/models/schema.js`:

| Table | Purpose |
|---|---|
| `media_broadcasts` | Reusable content assets — scripted shows, news templates, ad spots |
| `media_channels` | Channel definitions — number, type, NPC studio zone, offline graphic |
| `media_channel_playlist` | Daily schedule or loop playlist per channel |
| `media_cameras` | Camera placements, recording buffers, streaming targets |
| `media_graphics` | ASCII art and SVG graphic assets referenced by channels and VINE nodes |
| `media_themes` | TV-panel CSS themes referenced by `media_channels.theme_id` (see Themes below) |
| `media_deck_units` | Media-deck light/state backing (see Media Deck & Cassettes) |

### `media_broadcasts`

```
id TEXT PK
name TEXT
description TEXT
category TEXT             — general | news | advertisement | entertainment | emergency | …
tags JSONB                — []
playback_mode TEXT        — scripted | dynamic_news | live_camera | recorded | weather | sports | news | talkshow | morning
                            (getCurrentMessage branches on weather/sports/news/talkshow/morning,
                            each assembling a fresh graph from its *_pools column — see
                            Live-Assembled Shows below; anything else plays its stored
                            broadcast_graph or flat message list)
messages JSONB            — [{ text: '...' }, ...] flat fallback list
message_interval REAL     — seconds between messages (default 5)
override_duration REAL    — if set, overrides computed duration
loop INTEGER              — 1 = repeat message list when exhausted
enabled INTEGER
broadcast_graph JSONB     — VINE graph; overrides flat message list when present
fallback_messages JSONB   — ['[TECHNICAL DIFFICULTIES]…', …] — used when NPC host is absent
channel_id TEXT FK        — channel this broadcast is assigned to (informational, not scheduling)
weather_pools JSONB       — line pools for 'weather' mode (forecast graph assembly)
sports_pools JSONB        — line pools for 'sports' mode (play-by-play / announcer)
news_pools JSONB          — line pools for 'news' mode (bulletin assembly from the live news feed)
talkshow_pools JSONB      — line pools + guest personas for 'talkshow' mode
morning_pools JSONB       — line pools + the two hosts for 'morning' mode (world-sourced show assembly)
created_by TEXT, updated_at
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
schedule_mode TEXT        — 'loop' | 'daily' (default 'loop'); 'daily' makes start_time
                            seconds from in-game midnight instead of loop-relative
commercial_pool JSONB     — broadcast ids eligible as commercial slots (default [])
```

### `media_channel_playlist`

```
channel_id TEXT FK
broadcast_id TEXT FK
start_time INTEGER        — seconds from loop/day start
duration_override REAL    — overrides computed duration for this slot only
priority INTEGER          — higher wins when slots overlap (default 0)
conditions JSONB          — gate object, e.g. { npc_staff: [npcId,…] } (default [])
slot_type TEXT            — 'broadcast' | 'commercial' | … (default 'broadcast')
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
is_damaged INTEGER        — a camera zone reads "working" only when is_powered && !is_damaged
permissions TEXT          — default 'public'
flags JSONB
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

1. **`loadChannelRuntimes()`** — reads all enabled channels plus their joined playlist from DB, builds in-memory `channelRuntime: Map<channelId, state>`. The state object is the channel row (id/name/stationName/number/channelType/theme/studioZoneId/offlineGraphicId/newsCategories/scheduleMode/commercialPool/idleBroadcast/camera) plus the resolved `playlist[]` + `totalDuration` + `loopOriginMs`, plus per-tick bookkeeping (`wasActive`, `lastMsgKey`, `currentFallbackMessages`, `currentProgramName`, `graphBlackboard`). `plugins/broadcast/index.js:413` (`loadChannelRuntimes`) is the authoritative shape — read it before adding a field.

2. **`loadZoneTunings()`** — reads all furniture with a `flags.tuned_channel` set (joined to the channel by `number`; device type comes from `broadcast_device_type`), builds `zoneTunings: Map<zoneId, Map<channelId, deviceType>>` and `furnitureChannelIndex: Map<furnitureId, { zoneId, channelId, deviceType }>`.

3. **`loadGraphicsCache()`** — loads all `media_graphics` rows (`id`, `name`, `type`, `content`) into `graphicsCache: Map<id, row>` for zero-latency off-air graphic resolution.

4. `setInterval(broadcastTick, BROADCAST_TICK_MS)` — `BROADCAST_TICK_MS = 1000`.

### `broadcastTick()`

Every tick (1 s):

1. Iterates `zoneTunings`.
2. Skips zones with no players.
3. For each tuned channel, calls `getCurrentMessage(state, nowMs)` (via `_resolveTickMessage`, which gives a pirated/loaded media deck first refusal).
4. If no result (or duplicate key): checks `state.wasActive`. If it was active last tick, fires a one-time `off_air` signal to all watching players (includes offline graphic content and type if set), then sets `state.wasActive = false`. Continues to next channel.
5. If a result arrived: formats via `formatMessage(text, deviceType, zone, style)` and **splits the zone's players** — active TV watchers on that channel get `{ type: 'broadcast', message, channel, style, duration, programName }` (music lines also push `audio_music`; overlays push `tv_overlay`); everyone else gets a `broadcast_ambient` only when the line carries `speech` and the 30-second ambient throttle allows (see Passive vs Active below); media-deck preview watchers separately get `deck_broadcast`. Sets `state.wasActive = true`.

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

Signature is `formatMessage(text, deviceType, zone, style)`. Graphic styles (`svg` / `ascii_art` /
`credits`, the `GRAPHIC_STYLES` set) bypass the device prefix entirely so a `radio`/`security_monitor`
prefix can't corrupt graphic content. Device type is read from the furniture's
`flags.broadcast_device_type` (default `tv`).

---

## VINE Graph Walker

When a playlist item has `broadcastGraph`, `tickBroadcastGraph(channelId, graph, state, nowMs)` runs each tick. The walker maintains a persistent cursor (`graphBlackboard`) between ticks.

### Blackboard reset

When the active playlist item changes (`activeBroadcastId` differs from last tick), the entire blackboard resets:

```js
currentNode = _start
waitUntil = null
npcAnchor = null       // npcAnchorId is also cleared
hostAbsent = false
absentDetectedAt = null
techDiffMode = false
```

When a viewer tunes in mid-slot (`segElapsedSec > 0`), `_seekGraph` fast-forwards the cursor so the
program lands mid-broadcast instead of restarting from the top.

### NPC presence → camera-idle → tech-diff state machine

**Phase 1 — Normal**: the walker follows the graph normally. When it hits an `npc_anchor` node, it checks whether that NPC is physically present in `state.studioZoneId`. If absent and `studioZoneId` is configured, it sets `bb.hostAbsent = true` and `bb.absentDetectedAt = nowMs`.

**Phase 2 — Show-delay card (until the cast arrives)**: once `hostAbsent` is true, the walker short-circuits each tick and returns a clean, centred **`text_card` overlay** (`style: 'overlay'`) that names exactly who's missing — `_absentCastNames(graph, studioZoneId)` scans the graph's `npc_anchor` nodes and lists any not currently in the studio: *"PLEASE STAND BY — Tonight's programme is delayed — `<name(s)>` `has/have` not yet arrived in the studio. We apologise for the inconvenience…"*. This is deliberately **not** the technical-difficulties fallback (which reads as "signal lost") and **not** the old empty-studio camera spam — the viewer is told what's happening. The card holds (`duration: 0`, no auto-dismiss) and is re-emitted on a 5-second slot so late-tuners pick it up. The walker recovers automatically — clearing `hostAbsent` and resuming the graph — the instant `_absentCastNames` comes back empty (every scheduled anchor is back on the studio floor).

Technical-difficulties (`bb.techDiffMode`, a rotating line from `state.currentFallbackMessages`, default `'[TECHNICAL DIFFICULTIES] Please stand by.'`) is still reachable, but only for genuine signal failures — an explicit `tech_difficulties` node, a downed studio camera (`camera_cut` with the studio feed off/damaged), or a graph-walk error — never for a merely-late cast member.

### Node types

| Type | Per-tick behaviour |
|---|---|
| `say` | Return `{ text, key, style: 'raw' }`. Skipped (node advanced) when `hostAbsent`. |
| `ticker` | Return `{ text, key, style: 'ticker' }`. Skipped when `hostAbsent`. |
| `music` | Looks up `data.song` against `audio_songs` (via `getSongDefByName` in `plugins/audio/index.js`). If found, returns `{ text, song, key, style: 'music' }` and holds for 8s; if the channel is `live` with a `studioZoneId`, also `sendToZone`s the song there directly. If not found, falls back to `{ text, key, style: 'raw' }` (or is skipped if `text` is also empty). See [Music Cues](#music-cues). |
| `wait` | Set `waitUntil = nowMs + data.seconds * 1000`. Block until elapsed. |
| `npc_anchor` | Set `bb.npcAnchor`. Check NPC presence against `studioZoneId`. Advance. |
| `camera_cut` | Return `[CAM: label] <zone snapshot>`. |
| `inject_news` | Pull one item from `newsQueue` by category, or emit `fallback_text`. |
| `break` | Drain one item from `newsQueue`; if empty, continue graph. |
| `condition` | Branch `ifTrue` / `ifFalse` synchronously. |
| `loop` | Jump to connected target or back to `_start`. |
| `random` | Pick a branch weighted by `branch.weight`. |
| `set_flag` | Call `setFlag(flag, value)`. Advance immediately. |
| `title_card` | Fetch graphic from `graphicsCache` by `graphic_id`. Return `{ text: content, style: 'svg' \| 'ascii_art' }` based on `graphic.type`. If the node carries a `theme` (an `audio_songs`/`audio_samples` name), the theme starts the moment the card appears and the card **holds for the theme's one-pass length** (`_themeDurationMs` → `nodeHoldMs`), so no spoken line drops until the intro ends (title-card / theme sync). The resolved def rides the result (`song`/`sample`) for `broadcastTick` to play. |
| `overlay` | Push `{ type: 'tv_overlay', overlay: { overlayType, text, subtext, duration } }` to TV watchers, and the same payload as `deck_overlay` to media-deck preview watchers so on-screen graphics mirror to the deck (music is not mirrored). |
| `show_overlay` / `clear_overlay` | Explicitly raise / clear a persistent overlay (score bug, standings). |
| `npc_action` | Emote-style host action line. |
| `credits` | Return `{ text, style: 'credits' }` — the client renders a scrolling crawl. |
| `tech_difficulties` | Force the technical-difficulties card. |
| `event` | Fire a script event from the graph. |

Guards against cycles: max 50 hops per tick before early exit.

---

## Music Cues

The `MUSIC <song>` ... `MUSIC_END` block in a `.bsm` script (or a `music` card in the dev panel canvas editor / VINE graph) plays a real synthesized song from the [procedural audio system](#audio-system-cross-reference) rather than just printing text.

- `song` is matched against `audio_songs.name` (case-sensitive) via `getSongDefByName()`, exported from `plugins/audio/index.js`.
- **Found**: the resolved song def (with `_instrumentsById` attached) is sent as `{ type: 'audio_music', def }` to every player currently watching that channel's TV. If the channel is `live` and has a `studioZoneId`, the same song is also sent to everyone physically in the studio zone via `sendToZone`, independent of who's watching a TV. The node holds for **8 seconds** of airtime (`nodeHoldMs`; `_vineDuration` bills music at 8s too) before the graph advances — independent of the song's authored length (seed instruments/songs in `scripts/seed-broadcast-music.js`). Any `text` on the node is still shown as a normal broadcast line alongside the song.
- **Not found**: no audio plays. If `text` is set, it's shown exactly like a `say` node (`style: 'raw'`) and the node holds for 5 seconds. If `text` is empty too, the node is skipped with no delay.

### Audio System Cross-Reference

Music/SFX/ambience playback is owned by `plugins/audio/index.js` + `client/shared/audio-engine.js` — a fully procedural, sample-free Web Audio synthesis engine (tracker-style `audio_songs.channels` step data, not audio files). This is wholly separate from the text-based ambient "Sound" system (`server/engine/sounds.js`) — never merge the two. See the `audio_instruments` / `audio_songs` / `audio_sfx` / `audio_ambient` / `audio_event_routes` tables in `server/models/schema.js` for the full schema, and `client/game/js/panels/musicplayer.js` for the player-facing music player UI (typing `music` in-game).

---

## Dynamic News

World events feed channels whose `news_categories` includes the event category:

```js
on('player.death', …) → enqueueNews('murder',     'Breaking: X was found dead in Y.', 'normal')
on('flag.set', …)     → enqueueNews('martial_law', 'EMERGENCY ALERT: …',               'critical')
```

`enqueueNews(category, text, priority, ts)` appends to each matching channel's `newsQueue`. Critical items are prepended. News channels drain one item per tick from the queue; when empty, the idle broadcast plays.

---

## Live-Assembled Shows (`weather` / `sports` / `news` / `talkshow` / `morning`)

Five `playback_mode`s store a **line library** (`::lines` pools) instead of a baked graph, and assemble a fresh VINE graph on each airing rather than replaying stored content. They're authored as `.bsm` files (`@type weather|sports|news|talkshow|morning`) — see [docs/bsm-format.md](bsm-format.md) — and stored in dedicated JSONB columns (`weather_pools` / `sports_pools` / `news_pools` / `talkshow_pools` / `morning_pools`). `getCurrentMessage` routes each `playback_mode` to its `assemble*Graph()` builder (cached per refresh bucket), then feeds the result to the same `tickBroadcastGraph` walker as any other graph.

- **`weather`** reads the live 7-day forecast; **`sports`** simulates a fresh game; **`news`** pulls from the news generator, which assembles **live → wire → tabloid**: live event-sourced stories, then date-seeded canonical-lore "wire" stories (the Long Watch framed as terrorists, the Ascendants as establishment, the Architect as "the Machine"; fixed outlet bylines like Coldwater Sentinel / Basin Civic Wire), padded with tabloid filler. Their announcers/anchors are **name strings** — no NPC is spawned.
- **Title-card / theme sync**: when a `news`/`talkshow`/`morning` script declares both `@titlecard` and `@theme`, the assembler folds the theme onto the `title_card` node (`{ type: 'title_card', theme }`) instead of emitting a separate `music` node after it. The intro song then starts as the card appears and the card holds for the theme's length, so the first anchor/cold-open line doesn't step on the intro. With a theme but no title card, it still plays as a standalone `music` node.
- **`sports`** is keyed to an absolute airing time-window so a re-simmed same-slot game produces the same `gameId`. While a game airs, the plugin **emits a `sports.game` event every 60s** with payload `{ channelId, gameId, away, home, awayScore, homeScore, winner, endsAtMs }` — consumed by the **sportsbet**, **sportsleague**, and **gossip** plugins (they read `winner`; there is no `result` field). Score-bug and standings overlays ride `tv_overlay`; the World Series takeover pulls standings back through the `sportsleague.getStandings`/`getSeason` actions.
- **`morning`** is the talk show's daytime cousin — also **acted live**, by two resident host NPCs on the studio couch, but its variable is the WORLD rather than a guest: every segment reads something live (the clock, the forecast, `news.getStories`, the `martial_law`/`nuclear_event` flags, the power map), and the ticker is assembled from those facts rather than authored. Every pool is a `host >> cohost` exchange pair, so the couch's back-and-forth survives the shuffle. Airtime is just its daily playlist slot — no separate gate. See [Morning Shows](bsm-format.md#morning-shows-type-morning).
- **`talkshow`** is the odd one out: it's **acted live by real cast NPCs**. A resident host + sidekick commute in on schedule, and ONE reusable guest NPC is renamed to a new persona each in-game day, appears in a random unobserved zone, walks across the map to the studio, performs, and vanishes backstage afterward (engine AI actions `TALKSHOW_APPEAR`/`TALKSHOW_HIDE`, plus `talkshowHeartbeat` for the nightly rename). The assembled graph sets `_requireHost`, so it presence-gates on any channel — no cast on-stage ⇒ camera-idle → technical difficulties. See [Talk-Show Broadcasts](bsm-format.md#talk-show-broadcasts-type-talkshow).

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

Returns true if any player is currently watching that channel. Implemented via `broadcast-bridge.js` to avoid circular imports. The plugin also registers the **`IS_BROADCAST_SCHEDULED`** and **`AT_WORK_ZONE`** AI conditions (used by the studio-actor default graphs).

### `broadcast-bridge.js`

`server/engine/broadcast-bridge.js` breaks the circular import:

```js
registerViewerChecker(fn)    // called by broadcast plugin at startup
hasChannelViewers(channelId) // called by ai-behaviour evalCondition
// plus three more registered pairs, same pattern:
isNpcScheduledNow(npcId)     // drives the AT_WORK / HAVE_LIFE stage-occupancy rule
getNpcStudioZone(npcId)
isZoneWatched(zoneId)
```

### NPC Work Scheduling (`recalculateNpcSchedules`)

Broadcasts declare their on-screen hosts through `npc_anchor` nodes in their VINE graph. `recalculateNpcSchedules()` walks every scheduled broadcast, derives that set of NPCs, and:

- merges them into the playlist item's `conditions.npc_staff` (also surfaced at runtime as `runtime.playlist[].npcStaff`, populated in `loadChannelRuntimes`);
- overwrites each host NPC's `behaviour_graph` with `makeDefaultStudioGraph(studioZoneId)` and sets its `work_zone_id` to the channel's studio zone, so the NPC's `GO_TO_WORK` behaviour resolves to the studio and it shows up when its slot is on air.

It runs automatically on **every** playlist save (`PUT /broadcast/channels/:id/playlist`) and on demand via `POST /broadcast/recalculate-schedules`. The `studio_zone_id` (channel) and `work_zone_id`/`studio_zone_id` (npc) columns are the wiring this depends on.

**Stage occupancy rule:** only actors whose slot is on air right now stay on the studio stage. `AT_WORK` holds a scheduled actor at the studio; the moment a slot ends (`isNpcScheduledNow` → false) the graph routes to `HAVE_LIFE`, which — for any actor still inside the studio building — walks them out to the exterior world tile (one zone per tick) before starting their random off-shift wander. So an unscheduled actor never lingers on the stage. This is enforced engine-side in `HAVE_LIFE` (`server/engine/ai-behaviour.js`), keyed off the actor's studio zone via the broadcast bridge; the studio building is identified as every interior zone sharing the studio zone's `map_id`, and the exit is the stage's `flags.world_exit_zone` (fallback `exits.out`).

---

## Furniture Contract

| Key | Where | Purpose |
|---|---|---|
| `tuned_channel` | furniture `flags` | Channel **number** this device is tuned to; what `loadZoneTunings()` joins on |
| `broadcast_receiver` | furniture `flags` | Item can be tuned to a channel |
| `broadcast_device_type` | furniture `flags` — `tv\|radio\|security_monitor\|portable_monitor\|camera` (default `tv`) | Controls `formatMessage()` output |
| `media_deck` | furniture `flags` | Item is a cassette deck (see Media Deck & Cassettes) |
| `tv` | item **tag** | `requiredTag` for the `use` specialized action that opens the TV panel |

Note the split: the USE action gates on the **tag** `tv`, while `doUseTv` then looks up the
`broadcast_receiver` **flag** — a set carrying the flag but no tag surfaces no examine action.

---

## Player Commands

| Command | Behaviour |
|---|---|
| `watch tv` / `tv` / `watch television` / `listen` | Opens the TV panel for the first `tv`-tagged device in the zone (`listen` is an alias of `watch`) |
| `tune <n>` | Tunes the `broadcast_receiver` device in the zone to channel `n`; re-sends `tv_panel` if panel is open |
| `tune 0` | Turns the device off; triggers CRT shutoff animation if panel is open |
| `tablettune <n>` | **Portable** — the Tablet TV app's dial. Needs no furniture; `0` powers the app's screen down. Never typed (the TV app's viewport sends it) |
| `use <deck name>` | Opens the media deck panel (`mediadeck_panel`) for the `media_deck`-tagged furniture in the zone |
| `load cassette` | Loads a carried `media_cassette` item into the deck in the zone; **consumes the item from inventory** (the tape physically goes into the deck) and sets it active. (`load` also has a chip/footage branch for surveillance datachips) |
| `eject` | Stops the deck's active cassette, **removes its broadcast from the deck's library**, and spawns the physical cassette item (`item_cassette_<showname>`) back into the player's inventory — at most one copy per broadcast can exist in the world at a time |
| `selectcassette <broadcastId>` | Switches the deck's active cassette among ones already in its library, without needing to carry the tape (used by panel row clicks) |

The plugin also owns the **media-deck piracy** verbs (`pirate`, `pirateresolve`, `air`) and the
emergency-broadcast verbs (`airemergency`, `endemergency`) — see the broadcast row in
[docs/plugins.md](plugins.md) for what each does.

---

## Media Deck & Cassettes

Implemented in `plugins/broadcast/index.js` (search `Media Deck`).

- A media deck is `furniture` with `flags.media_deck = true`, `flags.channel_id`, `flags.deck_cassettes` (array of `broadcast_id`s in its library), and `flags.deck_active` (the currently-loaded `broadcast_id`, or `null`).
- While a deck has `deck_active` set, its messages **override** the linked channel's own programming for any zone-tuned viewers (`_getDeckMessage()` takes priority over `getCurrentMessage()` in `broadcastTick()`). Ejecting clears `deck_active` and removes that broadcast from `deck_cassettes`, so the deck goes idle and the channel falls through to its own programming — if the channel has nothing else scheduled, `broadcastTick()`'s existing off-air logic kicks in and viewers see static / the channel's offline graphic, exactly as it would for any other no-content channel state. A deck-message lookup cache (`_deckCache`, 10s TTL) is explicitly invalidated on load/eject so this transition isn't delayed by the cache.
- Cassette items are `items` rows with a deterministic id `item_cassette_<showname>` (broadcast name, slugified) and `tags.media_cassette = true` / `tags.broadcast_id`. The same id convention is used both by the dev-panel BSM import flow (`POST /broadcast/cassette`) and by `eject`, so the two paths always converge on one item definition per broadcast rather than creating duplicates. Only one cassette can exist per broadcast — if a *different* broadcast's name slugifies to the same id, `_ensureCassetteItem` throws (`CASSETTE_NAME_COLLISION`) instead of overwriting; `POST /broadcast/cassette` returns `409` and `eject`'s fallback-create path returns an in-game error.
- The media deck panel (`client/game/js/panels/mediadeck.js`, markup in `client/game/index.html`) shows a cartridge "slot" that slides a cartridge graphic into view when a cassette is active, a scrollable library list (click a row to `selectcassette`), a read-only schedule preview, and a LOAD / EJECT button row (LOAD sends `load cassette`, EJECT sends `eject`).

## Game Client — Passive vs Active

The **server** (`broadcastTick`) decides who gets what: it splits the players in a tuned
zone into active watchers (TV panel open on that channel) and everyone else, and sends
each group a different message type. There is no client-side counter.

### Passive viewers (not watching)

Any player in a zone tuned to a channel who does **not** have the TV panel open overhears
spoken content as ambient background TV. When a message carries a `speech` component, the
server sends that player a `broadcast_ambient` with the actual `speechText`; the client
renders it as:

```
[TV] "…the spoken line…"
```

This fires at most once per new broadcast message (the `lastMsgKey` guard) **and** at most once
per 30 seconds per zone+channel (`AMBIENT_LINE_EVERY_MS = 30000`), and only for messages that have speech — non-spoken
content (graphics, music, tickers) never leaks into the main chat stream. It does **not**
depend on anyone else in the room actively watching.

### Active viewers (TV panel open)

All broadcast messages for the active channel are routed to the TV panel. `style: 'ticker'`
goes to the ticker strip. `style: 'svg'` is injected as live SVG markup. All others append
as text. Beyond these two, the server↔client wire also carries **`tv_overlay`** (score bug /
standings / overlay nodes), **`deck_overlay`** and **`deck_broadcast`** (media-deck preview),
**`audio_music`** (music nodes), and **`tv_off`** (`tune 0`). The `broadcast` handler also applies
`programName` to the panel header. Simplified, `dispatch.js`'s two core handlers:

```js
broadcast: (msg) => {
  const views = tvViewsForChannel(msg.channel);   // every surface tuned to this channel
  if (!views.length) return;
  if (msg.style === 'off_air') {
    for (const v of views) v.showOffAir(msg.offlineGraphicContent || null, msg.offlineGraphicType || 'ascii');
    return;
  }
  for (const v of views) {
    v.showOnAir();
    if (msg.style === 'ticker') v.updateTicker(msg.message);
    else { v.appendMessage(msg.message, msg.style, msg.duration, msg.hasGameday); v.speak(msg.message, msg.style, msg.duration); }
    if (msg.programName !== undefined) v.setProgramName(msg.programName);
  }
},
broadcast_ambient: (msg) => {
  if (msg.speechText) appendMsg(`[TV] "${msg.speechText}"`, 'broadcast-ambient');
},
```

---

## Two TV surfaces, one renderer

Television is presented on **two** surfaces, both driven by the same code:

| Surface | Opened by | Reception |
|---|---|---|
| Standalone CRT popup (`#tv-panel` in `index.html`) | `watch tv` / `tv` / `use <television>` at a physical set | Zone-tuned — needs a `broadcast_receiver` device in the room |
| **Tablet TV app** (Tablet OS → 📺 TV) | Tapping the app tile | **Portable** — streams anywhere, no device required |

`client/game/js/panels/tv.js` is a **factory**, not a singleton: `createTvView(root, opts)` binds an
instance to any container carrying the `data-tv="…"` hooks (`window`, `content`, `messages`, `static`,
`knob`, `scorebug`, `gameday`, …). The standalone markup in `index.html` keeps its `id`s purely so
`styles.css` still matches; the renderer itself only ever looks up `data-tv`. The historical exports
(`openTvPanel`, `appendTvMessage`, …) remain as thin delegates to a default instance bound to
`#tv-panel`, so `dispatch.js` and `initTvPanel()` are unchanged.

Because both surfaces can be open on **different channels at once**, `dispatch.js` no longer routes to
one global panel — it fans each `broadcast` / `tv_overlay` message out via `tvViewsForChannel(channelId)`.
`tv_panel` routes on `msg.dest`: `'tablet'` feeds the app's viewport, anything else pops the CRT set.

Two instance-level details keep the surfaces from fighting over global audio: each gets **its own
hum/static loop ids** (suffixed with the instance key), and a single module-level `_speechOwner`
means only the most recently tuned surface narrates.

### Portable reception (`tabletTuners`)

`broadcastTick` iterates `zoneTunings`, so it can only ever serve players standing in a tuned zone —
the tablet needed its own path:

- **`tabletTuners: Map<playerId, channelId>`** — deliberately separate from `tvWatchers`, which is
  what lets a player watch the wall set on CH 7 and the tablet on CH 3 simultaneously. Registered via
  the raw `tablet_tv_watch` / `tablet_tv_unwatch` messages (bridged in `server/index.js` to the
  `tablet_tv.watch`/`.unwatch` events) and by `tablettune`; cleared on logout.
- **A final pass in `broadcastTick`** (`_tabletBroadcastPass`) delivers to those tuners. The critical
  invariant: the VINE graph walker is stateful and must advance **exactly once per channel per tick**,
  so every pass records what it resolved into a per-tick `tickResults` map, and the tablet pass
  **reuses** that beat rather than re-resolving. It only resolves fresh for a channel nothing else
  drove (and then claims it in `activeChannels`). Getting this wrong makes viewers skip lines.
- Off-air, score-bug/gameday/standings/sports-FX overlays, `audio_music`/`audio_sample` and the
  per-line `duration` all reach tablet tuners identically. There's no `broadcast_ambient` — a tablet
  has no room to leak into. Formatting is always `tv` (no `[Radio]`/`[FEED]` prefix).
- The whole pass is guarded by `if (tabletTuners.size)`, so it costs nothing when nobody has the app
  open (and never wakes an idle server).

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
║      [ − ]  (knob)  [ + ]        5.00                 ║
╚═══════════════════════════════════════════════════════╝
```

### Message rendering (`appendTvMessage(text, style, duration, hasGameday)`)

| Style | Render method |
|---|---|
| `raw` | `div.textContent = text` |
| `ticker` | Routed to the ticker strip, not the content area |
| `ascii_art` | `pre.textContent = text` — monospace, pre-wrapped, coloured by `--tv-header-color` |
| `svg` | `div.innerHTML = text` — SVG injected as live markup, `max-width:100%; height:auto` |
| `credits` | Scrolling credits crawl (with header detection) |

`svg`, `ascii_art`, and `credits` are treated as **title cards** — they clear the screen before
rendering. The optional `duration` arg is threaded from the server message.

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

- **`[data-tv="freq-display"]`** (`#tv-freq-display`): current dial position to two decimals (e.g. `7.00`).
- **`[data-tv="tune-down"]` / `[data-tv="tune-up"]`**: step to the previous/next channel in `_tvChannelList`, wrapping. The two chassis step differently **on purpose** — the CRT is analogue and *sweeps* (`_sweepDialTo`, `DIAL_SWEEP_SPEED`) through the static in between so the buttons read like a slow hand-turn; the tablet is digital and snaps straight to the channel.
- **Knob click**: cycles to the next channel in `_tvChannelList`, wrapping around. The knob's rotation tracks the dial (`_tvFrequency / TV_DIAL_MAX × 360°`).
- Every dial position change routes through `tunerInput(val)`, which cross-fades static against content by distance from the nearest channel. Lock range `LOCK_RANGE = 0.25`: within this many channel-numbers of a real channel, the tuner locks and calls `_tvTuneTo(n)`.

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
| PUT | `/broadcast/channels/:id/playlist` | Replace entire playlist (re-runs NPC work-scheduling — see below) |
| GET/DELETE | `/broadcast/channels/:id/ejected-slots` | List / clear a channel's ejected-cassette slots |
| POST | `/broadcast/channels/:id/restart` | Restart a channel's runtime |
| GET | `/broadcast/channels/:id/debug` | Static day-scan broadcast debugger (`scanChannelDay`) |
| POST | `/broadcast/ensure-studio` | Attach/backfill a channel's studio interior rooms; places by `studio_zone_id` or `grid_x`+`grid_y` with neighbor auto-wiring |
| POST | `/broadcast/create-studio` | Create a new studio zone for a channel |
| POST | `/broadcast/recalculate-schedules` | Force `recalculateNpcSchedules` across channels |
| GET | `/broadcast/cameras` | List cameras |
| POST | `/broadcast/cameras` | Create camera |
| PUT | `/broadcast/cameras/:id` | Update camera |
| DELETE | `/broadcast/cameras/:id` | Delete camera |
| POST | `/broadcast/cameras/:id/clear-buffer` | Wipe a camera's recording buffer |
| POST | `/broadcast/cameras/:id/to-broadcast` | Convert a camera buffer into a broadcast asset |
| GET | `/broadcast/graphics` | List graphics |
| POST | `/broadcast/graphics` | Create graphic |
| PUT | `/broadcast/graphics/:id` | Update graphic |
| DELETE | `/broadcast/graphics/:id` | Delete graphic |
| GET | `/broadcast/themes` | List themes |
| POST | `/broadcast/themes` | Create theme |
| PUT | `/broadcast/themes/:id` | Update theme |
| DELETE | `/broadcast/themes/:id` | Delete theme |
| POST | `/broadcast/cleanup-orphans` | Remove orphaned broadcast rows |
| POST | `/broadcast/studio-info` | Studio zone info helper |
| GET/POST | `/broadcast/deck` | Media-deck state / mutations |
| POST | `/broadcast/cassette` | BSM-import cassette item creation (see Media Deck & Cassettes) |

---

## Operational Notes

- **Tick cadence**: 1 second (`BROADCAST_TICK_MS`), separate `setInterval` in the plugin (not the world scheduler). The tick is the re-evaluation granularity, not the reading pace — node holds (`nodeHoldMs`) are honored at tick granularity (a node advances on the first tick past its hold), so a fine tick lets the text-scaled holds land close to target without ever skipping messages.
- **Spoken-line pacing scales with text**: for `say`/`ticker`/`camera_cut` nodes, `nodeHoldMs` returns `min(chars × 110ms, 20s) + 1s` (a small floor for readability), sized so the read-aloud formant voice reads each line at its natural pace — never speeding up, nothing cut off — with a 1 s gap before the next line. The `say` result carries this window as `duration` so the client uses it as the exact speech budget (falling back to the measured inter-line gap when absent). `110 ms/char` is calibrated to the synth's ~94 ms/char average, the margin covering slower per-narrator voices.
- **In-memory only**: `channelRuntime`, `zoneTunings`, `newsQueue`, `graphicsCache` — all rebuilt on server restart from DB. News queue starts empty on restart.
- **Graphics cache**: holds `id`, `name`, `type`, `content`. `type` is used by `title_card` and `off_air` to set the correct wire style (`'svg'` vs `'ascii_art'`), which the client uses to pick `innerHTML` vs `textContent` rendering.
- **VINE vs flat list**: runtime prefers `broadcastGraph` when present. Both are saved independently.
- **NPC presence requires `studio_zone_id`**: if not set, presence checks are skipped — the broadcast runs regardless of NPC location.
- **Blackboard lifetime**: one per channel, persists across ticks, resets when the active `broadcast_id` changes.
- **SVG title cards**: 640×360 is the recommended canvas size (and the Vector editor's default).
