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
playback_mode TEXT        — scripted | film | sermon | dynamic_news | live_camera | recorded | weather | sports | news | talkshow | morning | gameshow
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
number INTEGER UNIQUE     — dial number players tune to. **number 0 is not a station**:
                            it's the VCR INPUT on the back of the set, and every media
                            deck in the world points flags.channel_id at that one row.
                            An input channel carries no schedule — see "Channel 0" below
channel_type TEXT         — playlist | news | mixed | live | emergency
station_name TEXT         — display name in TV panel header
theme_id TEXT FK          — references media_themes (optional)
idle_broadcast_id TEXT FK — plays when nothing covers the current time
news_categories JSONB     — ['murder','martial_law',…] — news event filter
loop_playlist INTEGER     — 1 = playlist loops continuously
studio_zone_id TEXT FK    — zone where NPC hosts work; used for presence checks
offline_graphic_id TEXT FK — media_graphics id shown when channel is off-air
schedule_mode TEXT        — VESTIGIAL. Always written 'daily'; the runtime no longer
                            reads it. There is one scheduling model (below), so the old
                            'loop' mode is gone. Column kept so the schema stays additive
commercial_pool JSONB     — broadcast ids eligible as commercial slots (default [])
```

### One scheduling model — the seven-day grid

A channel is programmed exactly one way: `start_time` is **seconds from in-game
midnight** and `days` is a **7-bit mask** (bit 0 = Mon … bit 6 = Sun; 127 = every day).
The server picks the **most specific** slot covering any given second, so a weekday
override needs no gap cut in the every-day grid underneath it.

The old `'loop'` mode — `start_time` as an offset into an endlessly repeating reel —
was removed along with the "Daily mode" toggle and the channel modal's playlist
timeline. `loadChannelRuntimes` hardcodes `scheduleMode: 'daily'`, and the channel
modal now edits **metadata only**: programming belongs to the Schedule tab, which is
the sole writer of `media_channel_playlist`.

In the editor, the every-day grid and a weekday's overrides share **one row**: dashed
low-contrast blocks are the base grid, solid blocks with a day badge sit on top of the
block each replaces. Ghosts are not draggable and are never their own drop target —
dragover/drop bubble to `#sched-timeline`, which reads `clientX`, so a drop landing on
a ghost means "new override here", not "move the base grid".

### Channel 0 — the VCR input, not a station

`number = 0` is the input on the back of the set that whatever deck is under it is
plugged into. **Every media deck in the world shares that one `media_channels` row**,
so it must never be treated as a schedulable channel:

- `isDeckInputChannel(channelId)` (exported from `plugins/broadcast/index.js`) is the
  test; the set is rebuilt from `number = 0` on every `loadChannelRuntimes()`.
- `mediaDeckSyncTick` skips input-channel decks — a VCR plays the cassette somebody
  put in it (`deck_active` / `deck_cassettes`) and answers to no timetable. Without
  this, one schedule would drive every VCR in Coldwater in lockstep.
- The eject path skips its `DELETE FROM media_channel_playlist WHERE channel_id=…`,
  which could otherwise let a tape ejected in one apartment wipe slots a deck across
  town was reading.
- The devpanel Schedule tab lists it as `deck input` and refuses the timeline.

Regress covers the first and last points directly (`vcr:` cases in
`plugins/broadcast/regress.js`).

### `media_channel_playlist`

```
channel_id TEXT FK
broadcast_id TEXT FK
start_time INTEGER        — seconds from in-game midnight (0–86399)
duration_override REAL    — overrides computed duration for this slot only
priority INTEGER          — manual tiebreak; higher wins when slots overlap (default 0)
conditions JSONB          — gate object, e.g. { npc_staff: [npcId,…] } (default [])
slot_type TEXT            — 'broadcast' | 'commercial' | … (default 'broadcast')
days SMALLINT             — weekday mask, bit 0 = Mon … bit 6 = Sun (default 127 = every
                            day). See Weekday Overrides below
```

### Weekday Overrides — one schedule, not two modes

A daily channel has **one** running order, authored once, that repeats every day.
`days` is what lets a single day differ from it without a second schedule existing.

- A slot with `days = 127` (the default, and what every pre-existing row carries) plays
  all seven days. That is the **base grid**.
- A slot with a narrower mask is an **override**. Where two slots both cover the current
  second, the runner picks the **most specific** one — fewest days set. So a Thursday-only
  slot at 20:00 replaces the base grid's 20:00 slot on Thursday, and the other six days
  keep playing the base grid untouched. No gap has to be cut, and nothing is duplicated.
- Overrides layer coarse-to-fine: a weekend slot (2 days) beats the base grid but loses
  to a Saturday-only slot (1 day).
- `priority` is the manual escape hatch and outranks specificity. Equal on both, the later
  `start_time` wins.
- A `0` or missing mask reads as every day, never as "airs on no day" — a bad write can't
  silently black out a channel.

Every daily-schedule read goes through **`_pickDailySlot()`** in `plugins/broadcast/index.js`
— the runner (`getCurrentMessage`), the NPC shift checker (`registerNpcScheduleChecker`),
the dev panel's "what's on now" (`nowBroadcastingFor`) and the viewer's TV guide
(`sendTvSchedule`). Add a new consumer through it, never with a fresh `.find()`, or the
four will disagree about which slot won.

The viewer's TV guide lists **today's** running order: slots that don't air today are absent,
and a base slot replaced by an override is shown only as its replacement.

**Authoring** (dev panel → Schedule tab): the day bar above the timeline picks the scope.
*Every day* edits the base grid; a weekday tab edits that day's exceptions on their own lane,
above a ghosted read-only copy of the base grid — click a ghost to lift it onto that day as an
editable override. Clear and Auto-schedule are scoped to the tab you're on, so wiping
Thursday's exceptions never touches the other six days. A slot's mask is also editable
directly from its popover (the M T W T F S S chips + ALL).

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
6. Records the beat on `state.lastBeat` (plus `lastScorebug`/`lastGameday` and their timestamps) for catch-up, below.

### Catch-up on tune (`sendCatchUp`)

A channel only pushes when its graph produces the **next** beat, and a beat holds for as
long as its line takes to read — up to ~30 s for a `say`, longer for a title card or a
theme. So a viewer who tuned in a moment after one landed sat in front of a blank set
until the next one, which reads as *"the channel didn't come up — change to it again"*.

`tv.watch` / `tablet_tv.watch` therefore replay `state.lastBeat` to that player alone.
The replay carries **`catchUp: true`**: the client renders it exactly like a live beat
but does **not** re-narrate it (`dispatch.js` skips `v.speak`), because that line's
read-aloud is already part-way through airing to everyone else. Tickers, overlays and
`live_relay` beats are not replayed (a transition or a scroller, not a picture), and
`state.lastBeat` is nulled whenever a channel drops to `wasActive = false` so a dead
channel replays nothing. The persistent score-bug / gameday overlays ride along only
while they're **fresher than 90 s** — a stale bug must never sit over a talk show.
Deadball's league table rides only a game's first Gameday payload, so the catch-up adds
it to the replayed payload (`state.lastStandings`, else the cached table). The kept table
carries its sport, so a hockey game that follows on the same channel isn't sent it.

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

**The seek offset is REAL seconds, and every assembled mode has to convert.** A daily slot is
authored on the in-game clock (`start_time` is seconds since midnight, blocks are hours wide), but an
assembled show is a real-time performance: every hold in it comes from `nodeHoldMs` in real
milliseconds. `_actedSeekSec(graph, segElapsed)` divides the in-game elapsed by `timeScale` and then
wraps it onto **one lap** of the graph (`_graphLapSec`, measured with the walker's own holds — not
`_vineDuration`, which bills a flat interval per line and walks a `node.next` property a normalized
graph no longer has). Every assembled mode goes through it: `weather`, `news`, `talkshow`, `morning`,
`sermon`, `gameshow`. Sports has its own shared clock (`sportsSegElapsedSec`) and film its own
conversion (`filmRunElapsed`).

This used to hand `_seekGraph` raw in-game seconds. Because the seeker wraps implicitly, that ran it
roughly `timeScale` laps too far and dropped viewers at an effectively arbitrary phase — most often
the back third. The symptom was a four-minute breakfast show that played **two lines and then the
credits**, over and over, on an episode nobody had actually missed. The film branch had guarded
against exactly this since it shipped; the assembled modes were walking in the wrong currency.

### NPC presence → camera-idle → tech-diff state machine

**Phase 1 — Normal**: the walker follows the graph normally. When it hits an `npc_anchor` node, it checks whether that NPC is physically present in `state.studioZoneId`. If absent and `studioZoneId` is configured, it sets `bb.hostAbsent = true` and `bb.absentDetectedAt = nowMs`.

**Phase 2 — Show-delay card (until the cast arrives)**: `hostAbsent` now means an **empty
stage** — *no* scheduled cast member is on the studio floor (`_anyCastPresent`), i.e. a show
that cannot start. A partially-absent cast does **not** raise the card: the show goes ahead
short-handed and the missing actor's lines simply never air (see
[Live realism](#live-realism-the-broadcast-is-the-studio)). Once `hostAbsent` is true, the walker short-circuits each tick and returns a clean, centred **`text_card` overlay** (`style: 'overlay'`) that names exactly who's missing — `_absentCastNames(graph, studioZoneId)` scans the graph's `npc_anchor` nodes and lists any not currently in the studio: *"PLEASE STAND BY — Tonight's programme is delayed — `<name(s)>` `has/have` not yet arrived in the studio. We apologise for the inconvenience…"*. This is deliberately **not** the technical-difficulties fallback (which reads as "signal lost") and **not** the old empty-studio camera spam — the viewer is told what's happening. The card holds (`duration: 0`, no auto-dismiss) and is re-emitted on a 5-second slot so late-tuners pick it up. The walker recovers automatically — clearing `hostAbsent` and resuming the graph — the instant `_absentCastNames` comes back empty (every scheduled anchor is back on the studio floor).

**The card is not an unbounded promise.** `bb.absentDetectedAt` starts a `NO_SHOW_GRACE_MS` clock (5 **real** minutes past airtime — the cast were already called 12 real minutes early, so the walk has had well over twice its budget and whatever went wrong is not traffic). When it expires the programme is abandoned and the channel falls to its own stand-in slate: a cast member who is dead, jailed, or standing on the wrong side of a route that doesn't exist used to hold a `duration: 0` card over the channel for the entire slot, with no recovery but somebody physically walking in. Handover takes two ticks by construction — the stand-by overlay must be explicitly cleared before the slate goes up, or the fallback text plays underneath a PLEASE STAND BY the viewer can never dismiss. Recovery is unchanged and still automatic: `_anyCastPresent` clears `hostAbsent`, `techDiffMode` and the timer the moment anyone reaches the floor, so a late cast member still gets their show back.

Technical-difficulties (`bb.techDiffMode`, a rotating line from `state.currentFallbackMessages`, default `'[TECHNICAL DIFFICULTIES] Please stand by.'`) is still reachable, but only for genuine signal failures — an explicit `tech_difficulties` node, a downed studio camera (`camera_cut` with the studio feed off/damaged), or a graph-walk error — never for a merely-late cast member.

### Node types

| Type | Per-tick behaviour |
|---|---|
| `say` | Return `{ text, key, style: 'raw' }`. Skipped (node advanced) when `hostAbsent`. |
| `ticker` | Return `{ text, key, style: 'ticker' }`. Skipped when `hostAbsent`. |
| `music` | Looks up `data.song` against `audio_songs` (via `getSongDefByName` in `plugins/audio/index.js`). If found, returns `{ text, song, key, style: 'music' }` and holds for 8s; if the channel is `live` with a `studioZoneId`, also `sendToZone`s the song there directly. If not found, falls back to `{ text, key, style: 'raw' }` (or is skipped if `text` is also empty). See [Music Cues](#music-cues). |
| `wait` | Set `waitUntil = nowMs + data.seconds * 1000`. Block until elapsed. |
| `npc_anchor` | Set `bb.npcAnchor`. Check NPC presence against `studioZoneId`. Advance. |
| `camera_cut` | Assign a **real** working `media_cameras` unit in the target zone (`_pickCamera`, round-robin per channel) and return `[<Camera N> — label] <zone snapshot>`. No working camera in that zone ⇒ the shot has no source: the studio's own feed falling over is tech-difficulties, a remote feed falling over just kills that cut. See [Live realism](#live-realism-the-broadcast-is-the-studio). |
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

## Live Realism — the broadcast IS the studio

For an **acted-live** graph (`liveActed` — a `live` channel or any `_requireHost` graph), the
broadcast is a literal readout of what is physically happening on the studio floor. The graph is
a *shooting plan*, not a guarantee of what airs. Four rules, all in `tickBroadcastGraph`:

**1. Cameras are objects, not instructions.** `zoneCameras: Map<zoneId, [{id, direction, label}]>`
holds the **working** (`is_powered && !is_damaged`) `media_cameras` rows per zone, rebuilt beside
`cameraZoneStatus` in `loadChannelRuntimes`. A `camera_cut` is executed by a specific unit picked
round-robin (`_pickCamera`, `state._camSeq`), and the cut is **acted out where it happens**: the
studio sees *"Camera 3 swings around and takes the couch; its tally light blinks red,"* and a
remote zone being cut to sees its own lens pivot. On air the shot is labelled with the real unit.
A live channel whose studio has **no** working camera has no picture at all — a per-tick blackout
gate raises tech-difficulties (`bb.cameraBlackout`) and lifts it by itself when a unit comes back.

**2. Room authority — a line belongs to whoever is standing there.** `npc_anchor` records
`bb.anchorPresent`. If that actor has walked off set, their `say`/`npc_action` beats are **dropped,
not deferred** — dead air, and the show moves on. Only a completely empty stage falls back to the
stand-by card.

**3. Every line is attempted live; the actor's condition decides what lands.** `_actorImpairment(npcId)`
reads the performer's real state — the dose on their AI blackboard (`npc._ai.dose` from
[`plugins/npc-drugs`](../plugins/npc-drugs/README.md)), their comedown, and any `npc.intoxication`
— and returns a **level** *and* a **state**. `_garbleLine` degrades the delivery in the Paul Masson
register: repeated words, fumbled clause starts, softened consonants, unfilled pauses, and past
~0.55 the line doesn't survive to its own full stop (*"…I can't read this. Who wrote this?"*). An
`out`-cold actor can't perform at all: the studio sees them fold (`_collapseLine`), and the air gets
nothing. Above the floor the mangling is **never** a silent no-op.

⚠ **The broadcast plugin never knows which drug anyone took, and that is the design.** npc-drugs
already classifies every substance down to a handful of states, so delivery is written against the
**state** and never against a drug name. Each one is a row in `_DELIVERY` — `drunk`, `loose`,
`wired`, `paranoid`, `mellow`, `tripping`, `dissociated`, `belligerent`, `comedown`, `lucid`,
`flee` — carrying four transform weights (`slur`, `stall`, `trip`, `derail`, plus `drift`) and its
own pools of fumbles, off-script asides and collapses. The weights are what make two actors at the
**same level** still sound like they are on different things: a wired anchor talks over himself and
`slur` is deliberately **0**, a loose one slurs everything and keeps losing the end of the sentence.
`lucid` is inert by design and returns the line verbatim — a state, not an impairment.

The payoff is that **an anchor's habit is pure content**: set `flags.drug_habit` to any drug in the
catalogue (or `flags.booze_habit` to a drink, or the show-timed `flags.preshow_habit` /
`flags.preshow_drink`) and their airtime changes to match, with nothing in the plugin edited. A drug
added tomorrow airs in a voice written before it existed. Adding a *state* is a row; giving one NPC
their **own words** for a state is authoring —

```json
"delivery_lines": {
  "drunk": { "offscript": ["...Marguerite. Marguerite, are you watching this."] },
  "any":   { "fumbles":   ["— hah —"] }
}
```

on the NPC's `flags`, keyed by state with `any` as the catch-all. Authored lines **replace** that
state's pool rather than joining it (a host given four of their own drunk asides should be heard
saying those four, not those four diluted by the house set); any pool left unauthored still falls
through to the state's. Regress asserts every dose state has a row, that all three pools are
non-empty on each, that a stimulant never slurs while drink does, and that an authored pool shuts
the house pool out.

**3b. Losing the thread.** The garbler works one line at a time and knows nothing about what is
being said, so the worst it can do is mangle a sentence and cut to a one-line aside. A **tangent**
is the other failure, and the one people actually remember from live television: the running order
is abandoned for a *run* of lines, and somebody has to fetch him back. Lives in
[`plugins/broadcast/tangents.js`](../plugins/broadcast/tangents.js) — a pure module, no engine
imports, so regress drives it with object literals.

Rolled at a `say` node **after** the line airs (a digression from nothing is just a monologue),
gated on `imp.level >= 0.45` and scaled by it, on a ~100s cooldown, and drained one beat per tick
**before** the graph is read. `bb.currentNode` is never touched, so the running order simply waits
and **every acted programme ever written gets tangents with no change to its graph**. It aborts if
the host walks off set or goes `out`.

Three rules:

- **A tangent is a RUN, and stays one.** The pools hold whole runs and one is picked entire. A flat
  pool of single lines shuffled together is how you get a man who mentions his divorce, then a
  coupon, then his divorce again, which reads as a bug rather than as a digression.
- **It is keyed to what they are ON** — the same `_DELIVERY` state names, so a stimulant tangent is
  a man with a plan talking too fast, a cannabis one wanders and is happy about it, and a deliriant
  one is about who is in the room. ⚠ **Regress fails the build if a `_DELIVERY` state has no
  tangent voice** (`lucid` and `flee` exempt: one is sharper than sober, the other never reaches a
  line). Without that gate a new state degrades lines and can never wander, which reads as the
  feature being broken on that drug rather than as an authoring gap.
- **The co-host's lines are the CO-HOST's.** The wrangle is dialogue: spoken by a named second
  person actually standing on the floor (the graph's own cast, minus the anchor, minus anyone who
  has left), garbled by their **own** impairment, and authored on them. It lands *inside* the run,
  because a producer who waits politely for the end of the digression is not wrangling anybody, and
  the last beat is always theirs and always a return to the running order. With nobody else on the
  floor there is **no wrangle at all** and the run dies of its own accord, which is the correct and
  much bleaker version of the same scene.

⚠ **A tangent beat is garbled with `noDerail`.** A line that is already off script cannot be
derailed off it: cutting a beat short to append *"...I can't read this. Who wrote this?"* throws
away the authored line — the entire point of the tangent — and on a four-beat run you hear the same
generic aside three times. Slur and stall still apply; he is no less drunk for having gone off book.

Authoring, on the NPC's `flags`, mirroring `delivery_lines` exactly (authored **replaces** the
house pool for that state; `any` is the catch-all, consulted only when the state itself is
unauthored, so one bespoke drunk run doesn't silently disable the character on everything else):

```json
"tangents": {
  "loose": [["...and that's another thing.", "Barb took the good pans.", "She had a LIST."]]
},
"wrangle_lines": {
  "early":   ["Neil. Neil. We talked about this."],
  "late":    ["I am cutting your mic. I am going to do it."],
  "recover": ["Top ten. You were on the top ten. Go."]
}
```

A run may also declare **what it is about** — `{ "lines": [...], "topic": "divorce" }`, with a bare
array meaning the same thing untagged — and the co-host answers the topic:

```json
"wrangle_lines": {
  "divorce": { "late": ["This is the pans again. Every week it's the pans."] },
  "late":    ["...the register default, for a tangent about anything else"]
}
```

Falling through topic → register → `any` → house, so a topic nobody wrote for is an ordinary
tangent rather than a silent one. ⚠ **A run declares its topic; it never supplies the**
**interruption.** The shortcut is to let the host's run carry the co-host's lines, and it is wrong
for the reason the wrangle half exists at all: those words belong to a second person standing on
the floor. Without the topic seam a producer with one good specific line reads it at random over
every tangent — *"nobody is watching this for your divorce"* landing on a bit about coffee, which
is worse than the generic line it displaced.

⚠ **The house pools name nobody** — they are read by whoever happens to be on the floor of whichever
show, so a default that says "Neil" is one character's dialogue wearing a generic pool's clothes.
Regress asserts it.

⚠ **The floor must sit at or below the lowest tangent-capable `_DELIVERY` level.** It shipped at
0.45, which is *above* `wired` (0.4) and `comedown` (0.35) — so a stimulant host had a tangent voice
written for him and could never once reach it, and nothing errors: the man simply never wanders.
It is 0.35, and regress asserts every state with a pool can clear it.

Shipped authored, two hosts and two very different failures. **Neil Mcmanistan** loses the thread
downhill — eight `loose` runs (the pans, the price match, the men watching alone, Singh Hortons, the
basement payphone, the Hulkster, the one he refuses to say, the conspiracy board), plus two
`paranoid` and two `comedown` for the states a spiking or a wearing-off can put him in, with
**Captain Nguyen** answering across all three registers and seven topics. **John Akerson** is not
lost, he is *launched*: seven `wired` runs (the network's notes, keeping the cameras up all night,
nineteen years of Graham, the ratings caveat, the Machine's eleven seconds, the chair that makes
people lie, and the quiet of the penthouse at four in the morning) and two `comedown` runs for the
lace coming down — the on-air half of the arc whose other half is `ai.crashSleepy` walking him home
to fold onto the bed mid-sentence. **Graham Mercer** answers him in the register the Tonight Show
already gave him: he never panics, he *notes*, and he would like it timestamped.

`TANGENT_DUMP=1 node tests/regress.js` prints one tangent per state as it would go to air, garbled
at that state's own level. The pools are comedy and assembling is not the same as reading well.

**3c. A billing is not a name.** `@billing <npc_id> <NAME>` in a `.bsm` `::actors` block gives an
actor an **on-air stage name**: the aired line reads `PRODUCER says, "…"` while the NPC row stays
`Phil McCracken` everywhere else in the world. It rides on the `npc_anchor` node as `display`, which
is why nothing else had to learn about it — one `||` at each of the two anchor sites. It also
registers the script label, since a man billed as PRODUCER is always written `PRODUCER:` anyway.

⚠ **Do not derive this from `@alias`.** That was the first attempt and it is wrong in a way that is
invisible until it airs: an alias is *typing shorthand* (`@alias npc_neil_mcmanistan NEIL` exists so
the author can write `NEIL:`), so treating every alias as a stage name puts "NEIL says" and "LAWYER
says" on screen for two men with perfectly good names. A billing is the opposite — a deliberate
refusal to use the name — and before it existed the only way to get one was to *name the NPC*
"PRODUCER", which then follows him into room descriptions, examine, SIFT and his own front door.

**3d. Two people on the floor, and only one of them is helping.** `_tangentCohosts` returns *every*
present cast member, and `buildTangent` picks the wrangler **from the run's topic**: whoever has a
topical answer, then whoever has any authored voice, then anyone. This is not an optimisation — with
a producer *and* a mate on a barstool in the same room, picking the first present body makes the
sober one and the enabler interchangeable, which is the entire distinction between those two
characters. On *You're Not Gonna Believe This Shit* that means the producer takes the divorce, the
coupon and the Hulkster; Captain Nguyen takes the magic root, because it is his root.

**4. The audience seam.** The studio-floor relay (`zone.broadcast` → `server/index.js:134`) puts
**untagged** room events out on air whenever the channel is acting a show there and the room has a
working camera — so a player can walk into shot, heckle the host, or break something and the city
sees it. It reaches zone-tuned sets, deck previews, and tablet tuners alike. The show's own
performance is exempt: every line the acting layer puts in the room goes through `_stageLine`,
which tags it `_fromBroadcast` so the relay can't pick the performance back up and re-air it.

## On Location

A programme is normally made in the room its channel owns, and until now that was not a default so
much as an assumption: thirty reads of `state.studioZoneId` inside the runner, each one quietly
asserting that a channel has ONE room. **A show shot on location is the same programme in a
different room**, so it is one substitution rather than a second staging path —

```
const stageZoneId = graph._locationZone || state.studioZoneId;
```

Everything downstream follows for free, because everything downstream was already reading that
field: which cameras can execute a shot, the presence gate, the stand-by card, the lines the acting
layer puts into a room, the tangent co-host lookup, and the camera-blackout check. **Null means the
channel studio**, so nothing that already worked has to learn the concept exists.

Declared in the script (`@location <zone_id>`), carried on `media_broadcasts.location_zone_id`, and
stamped onto the stored graph **once at load** rather than threaded through ten tick call sites —
the stage is a property of the programme, not of the tick.

**The call sheet says where, not just when.** `getNpcStudioZone` now prefers the slot's own
`locationZoneId`. ⚠ Without this the cast dutifully walk to the studio while the show is being staged
across town, the presence gate finds an empty room, and the channel tells viewers that nobody turned
up to a programme that is currently happening.

### The kit

Three pieces, each of which is a physical object in a room rather than a property of the show:

- **Camera droids** (`flags.camera_droid`) — NPCs that ARE a working camera in whatever room they
  are standing in. The entire integration is `_camerasIn(zoneId)`, which unions the bolted-down
  `media_cameras` rows with any droid present; the shot picker, the blackout gate and the
  surveillance relay all inherit walking cameras without one of them being told such a thing exists.
  They are dispatched by being on the programme's `npc_staff` — the same machinery that walks a human
  anchor to work — so **nothing in the broadcast plugin dispatches anything**. A droid that is downed,
  jammed, or simply goes home takes the picture with it, which is what makes a location shoot
  something you have to STAFF.
- **The portable mediadeck** (`flags.portable_mediadeck`, furniture) — the case with the aerial. A
  studio is wired and needs none; a church basement is wired to nothing, so a stage that is not the
  channel's own studio needs a deck in the room or the signal never reaches the gallery. It is
  furniture deliberately: it can be switched off, carried out, stolen, or left behind. That failure
  resolves through the tech-difficulties path that already exists for a studio with dark cameras,
  because from the couch it is the same event and should not need a second explanation.
  **It is a transmitter, not only a relay.** `channelTransmitterLive` asked about the wired deck
  alone, so a crew filming in a basement with a working case went off air the moment the gallery
  lost power — the one situation the kit exists for. A portable bound to the channel
  (`uplink_channel`, or plain `channel_id`) now answers for it too. The binding is the whole gate:
  a case in somebody else's basement keeps nobody on air. It is deliberately not narrowed to "the
  room the current programme is staged in", because this runs before the tick has resolved which
  programme that is.
  **`uplink` is the switch.** `deck_off` was read by the transmission check and written by nothing
  but the regress suite, so the case was documented as switch-off-able and wasn't. `uplink` reports;
  `uplink on` / `uplink off` flips it. Not owner-gated, unlike `load`/`eject`/`pirate` — those answer
  to a station's control interface, and this is a flight case standing open on a church floor.
  ⚠ **Both power tests here were dead until 2026-08-31.** `_portableDeckLive` tested
  `furniture.is_powered`, a column that exists on `media_cameras` and `security_devices` and not on
  `furniture` — so it was `undefined !== 0`, true on every furniture object ever. One layer up,
  `channelTransmitterLive` tested `getZone(zoneId).powerStatus`, which is never written onto a world
  zone object (zone power lives only in the environment's own map). A channel counted as
  transmitting because a deck ROW existed. Both now ask `getZonePowerStatus`, and only an explicit
  `offline` kills a feed — an unmodelled room reads `unpowered` and still works, or every interior
  nobody wired would silently take a channel down.
- **Camcorders** — ordinary `media_cameras` rows flagged `portable` + `paired_deck`, which is what
  makes them work everywhere a studio camera works with nothing taught about them.

First location: **St Garneau's basement kitchen** (`zone_stgarneau_basement`), where *Cooking Shit
With Neil McManistan* is shot on a priest's WiFi.

### Transmission is not presence

Two questions that used to share one gate. `skipPresence` says **do not ask whether the cast are
standing there** — right for a scheduled programme, since a daily slot is a promise the station has
already made and a viewer should not get a stand-by card because an actor is four tiles from the
door. It was also switching off a question with nothing to do with the cast: **is there a camera in
this room, and does its picture reach the gallery?** A show can be perfectly staffed and still be
going out to nobody because somebody carried the deck up the stairs.

So the transmission check now applies to every **acted** programme, scheduled or not. It wants a
working camera in the room (a bolted-down unit, a camcorder, or a droid that walked there) and —
anywhere that is not the channel's own wired studio — a `portable_mediadeck` to get the signal home.
Either missing raises tech difficulties and reads as one; both heal by themselves the moment the
missing piece comes back. **That is what makes the kit a dependency somebody can interfere with
rather than set dressing standing in a basement.**

⚠ **`channel_type` decides whether a show is PERFORMED or merely printed — unless the programme
says otherwise.** On a `playlist` channel `liveActed` is false, the staffing self-heal strips
`npc_staff` to `{}`, and the programme plays as text with nobody in a room. That is still the
default, and it is the first thing to check when a live-authored show is not behaving like one.

**`media_broadcasts.acted` (BSM `@acted`) is the per-programme override**, and it exists because
being performed is a fact about the PRODUCTION, not about the channel that happens to carry it.
KSAB is a `playlist` channel with 28 slots; making one show performed by flipping the channel to
`live` would presence-gate six films and two ball games on a cast that does not exist. The flag
does both halves — `staffsNpcs` (the cast commute to the stage) and `_requireHost` (the airing is
gated on them arriving) — because a show staffed but not acted is the worst of both: the crew
genuinely walk across town and then the programme prints itself anyway. That was the live state of
*Cooking Shit With Neil McManistan* until `acted` existed.

⚠ **It is authored, never derived from "has `npc_anchor` nodes".** A recorded drama names its cast
that way too — *Chrome & Circumstance* and *Neighbors from 14B* both do — and presence-gating a
recording takes it off the air whenever its actors are asleep. Thirteen scripted broadcasts carry
real `npc_` anchors; two of them are performances.

⚠ **A crew member who works in more than one building must not carry a fixed `work_zone_id`.**
`GO_TO_WORK` resolves `params → work_zone_id → studio_zone_id → getNpcStudioZone`, so a pinned zone
**wins over the call sheet**: the producer walks to the studio on the day the show is in a church,
and his lines come out of an empty room.

⚠ **The staffing pass used to inflict this pin itself.** Its write was
`work_zone_id = COALESCE(work_zone_id, $stage)`, so the first reconcile of a two-show NPC wrote one
stage into a null column and every pass after it preserved that value permanently. Neil McManistan
and Phil McCracken both ended up with `work_zone_id = zone_stgarneau_basement` in production while
their content files correctly carried null. The pass now counts the distinct stages each staffed
NPC is called to and **nulls `work_zone_id` for anyone with more than one**, so the per-slot lookup
answers. A single-stage NPC keeps the pin — that is what lets an ordinary resident anchor commute
without a call-sheet lookup, and it leaves vendors with an authored work zone untouched. The same applies to field units, and doubly — a camera the
studio sends out is defined by being sendable, so a droid with a pinned work zone can only ever
serve one location for the rest of its life. Null on both, and the per-slot lookup answers. Note
broadcast staffing runs off the **playlist** (`npc_staff` + the slot's day mask + the call lead),
never off `vendor_schedule`, so a shift window wider than the show is a contradiction nothing reads.

### A camera direction is an order

A bolted-down camera can only shoot the room it is screwed to, so a cut to a zone with no unit in it
has always simply had no source. That is still true of fixed units and it is the right answer for
them. **A droid is different, and this is the whole reason it is an NPC rather than a row:** it is
the physical manifestation of the direction. `CAM 3 FOLLOW to the pantry door` is not a rendering
instruction, it is a machine being told to go to the pantry, so it goes, the room it leaves sees it
leave, the room it enters sees it arrive, and the shot happens because there is now something there
to take it. It then performs the shot it was given: the script says `SNAP_TIGHT` and the thing in
the room snaps tight.

The unit named in the label is taken first — a script that numbers its cameras is describing a crew
and should get the crew it describes.

⚠ **Bounded by hops, not by reachability.** The first cut of this asked only "is there a path", and
the world is connected: a direction to a room across the city is technically followable, and a unit
sets off on a twenty-minute walk to the Ascendant shrine in the middle of the programme. A camera
direction moves a camera around a **location**; `MAX_DISPATCH_HOPS` is what keeps it there, and
anything further is a direction nobody could execute and gets the dark-camera answer. This is also
worth knowing when writing regress: off shift the crew sit at the studio, so a dispatch test has to
put them on location first or it is only testing the cap.

### Waiting for somebody who is not coming

A cast member fails to turn up, the viewer gets a stand-by card, and that is the *station's* answer.
It was never anybody's: the people who did turn up stood on the floor in total silence. `flags.absent_lines`
gives them their own, aimed at the specific person who is missing (`{missing}` is the name or names),
and it plays on the studio floor only — nothing is on air, that being the entire problem.

⚠ **Edge-triggered, one voice per absence.** Level-triggered, it is a man saying the same exasperated
line every four seconds for the length of a stand-by card, which turns a character beat into a fault.
`bb.absentSpoke` clears wherever the absence does, so a second no-show later in the same programme
gets its own reaction.

Six authored, and deliberately not interchangeable — regress fails if any two of them share a line.
Neil takes it personally inside four seconds; Phil does not get angry, he documents; Nguyen's
afternoon has just improved; Father Jerome is the only one who is not inconvenienced but *worried*;
Graham announces it, for the record, as he has announced everything for nineteen years; and John
cannot help doing a bit about it, and the bit is thinner than usual.

### The keyholder's pre-show act

A location shoot happens in **somebody else's building**, and the person whose building it is has
their own relationship with it being filmed in. `flags.preshow_act` on an NPC is the seam for that:
authored beats that play when a programme staged in the zone they keep enters its **call window**,
and a second set once it is off the air again.

```json
"preshow_act": {
  "stage":  "zone_stgarneau_basement",
  "zone":   "zone_district_925_912",
  "before": ["…the crew are unloading and he does the thing…"],
  "after":  ["…and undoes it…"]
}
```

Three decisions:

- **It is the CALL WINDOW, not airtime.** The act belongs to the run-up: the crew are unloading,
  nothing is live, and whatever is being said by doing it is being said to nobody. It reuses
  `_staffCallLeadGameSec` — the same lead the cast themselves are walked in on — so retuning the
  station's call time moves this with it instead of letting it drift.
- ⚠ **`zone` is authored separately from `stage`, because the two are rarely the same room.** The
  shoot is in a basement; the thing being done is over the front door. One field for both puts a man
  unscrewing an outdoor plaque inside a basement kitchen, which is exactly what the first cut did.
- **Edge-triggered, RAM-only.** It fires on the transition into the window and on the transition
  out, never for as long as the condition holds — the level-triggered version reads as a man
  unscrewing the same four screws every forty seconds for two hours.

First use: **Father Jerome and the plaque.** The church's own name is cut into the lintel and an
Architect compliance plaque is fitted across the lower line, covering it exactly. When the crew
arrive he takes it down; when the show is over he puts it back. ⚠ **Nothing anywhere says why,
including him** — asked directly he gives a true and completely unresponsive answer about a loose
fixing in a hundred-and-forty-year-old lintel, and the only tell is physical: four screw holes gone
oval, and a rectangle of sandstone at the plaque's edges a shade cleaner than the wall around it.
Regress fails the build if the words *protest*, *defiance*, *resist* or *statement* ever reach that
content, on the same principle as the Scarletwastes trophy road: the moment anything names it, it
stops working.


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

## Live-Assembled Shows (`weather` / `sports` / `news` / `talkshow` / `morning` / `gameshow`)

Six `playback_mode`s store a **line library** (`::lines` pools) instead of a baked graph, and assemble a fresh VINE graph on each airing rather than replaying stored content. They're authored as `.bsm` files (`@type weather|sports|news|talkshow|morning|gameshow`) — see [docs/bsm-format.md](bsm-format.md) — and stored in dedicated JSONB columns (`weather_pools` / `sports_pools` / `news_pools` / `talkshow_pools` / `morning_pools` / `gameshow_pools`). `getCurrentMessage` routes each `playback_mode` to its `assemble*Graph()` builder (cached per refresh bucket), then feeds the result to the same `tickBroadcastGraph` walker as any other graph.

There is **no show-type registry** — a type is a `playback_mode` string branched on in ~9 places (`scanChannelDay`, `broadcastDuration`, the `loadChannelRuntimes` SELECT + item mapping, the `npcStaff` exemption, both `getCurrentMessage` branches, `_scriptedTokens`, the walker switch, `recalculateNpcSchedules`). Adding a type means touching each; mirror the nearest existing one.

- **`weather`** reads the live 7-day forecast; **`sports`** simulates a fresh game; **`news`** pulls from the news generator, which assembles **live → wire → tabloid**: live event-sourced stories, then date-seeded canonical-lore "wire" stories (the Long Watch framed as terrorists, the Ascendants as establishment, the Architect as "the Machine"; fixed outlet bylines like Coldwater Sentinel / Basin Civic Wire), padded with tabloid filler. Their announcers/anchors are **name strings** — no NPC is spawned.
- **The news type has a weather desk.** A `news` script that authors `wx.*` pools gets a weather segment between the rundown and the kicker, read by `@meteorologist`, off the SAME live 7-day forecast `weather` reads. It uses the weather type's own pool suffixes (`wx.sky.*`/`wx.warn.*`/`wx.trend.*`) so a hero event — acid rain, ion storm — is named as itself rather than as the ordinary weather underneath it. It reports today and the first severe day ahead, not the whole week: the week belongs to DOOMCAST. A file with no `wx.*` pools airs no segment at all.
- **Title-card / theme sync**: when a `news`/`talkshow`/`morning` script declares both `@titlecard` and `@theme`, the assembler folds the theme onto the `title_card` node (`{ type: 'title_card', theme }`) instead of emitting a separate `music` node after it. The intro song then starts as the card appears and the card holds for the theme's length, so the first anchor/cold-open line doesn't step on the intro. With a theme but no title card, it still plays as a standalone `music` node.
- **`sports`** is keyed to an absolute airing time-window so a re-simmed same-slot game produces the same `gameId`. While a game airs, the plugin **emits a `sports.game` event every 60s** with payload `{ channelId, gameId, sport, away, home, awayScore, homeScore, winner, endsAtMs }` — consumed by the **sportsbet**, **sportsleague**, and **gossip** plugins (they read `winner`; there is no `result` field). Score-bug and standings overlays ride `tv_overlay`; a postseason takeover pulls standings back through the `sportsleague.getStandings`/`getSeason` actions. **Each channel simulates its own game** and the `gameId` is keyed to the broadcast as well as the slot — with two sports sharing a channel, one result broadcast to every channel would settle a hockey wager against a ballgame's score. See [Sports — two codes, one pipeline](#sports--two-codes-one-pipeline).
- **`morning`** is the talk show's daytime cousin — also **acted live**, by two resident host NPCs on the studio couch, but its variable is the WORLD rather than a guest: every segment reads something live (the clock, the forecast, `news.getStories`, the `martial_law`/`nuclear_event` flags, the power map), and the ticker is assembled from those facts rather than authored. Every pool is a `host >> cohost` exchange pair, so the couch's back-and-forth survives the shuffle. Airtime is just its daily playlist slot — no separate gate. The middle of the show is a **shuffled, weighted running order** of five segments (the hotplate, the mailbag, a sports desk off the live league tables, an `audience` beat that names the real viewer count via the `{watching}` runtime token, and a plug for the channel's own evening), each of which drops out cleanly when its live source is empty — so two mornings differ in shape, not just in wording. Only the run-in and the sign-off are fixed. See [Morning Shows](bsm-format.md#morning-shows-type-morning).
- **`gameshow`** is the only broadcast type a **player can be inside**. Its variable is its **`@subject`** — what the show asks about, which owns the material, the round plan, the parsing and the scoring while [gameshow.js](../plugins/broadcast/gameshow.js) owns everything a game show has regardless (cast, guess window, purse, cooldown, relay). Two ship, both **zero-query by contract** because an episode is assembled on the broadcast tick for every set in the city. **`retail`** (The Last Lot) asks what something is worth, dealt from `items.value` via the boot-loaded item cache, so every item added later becomes a prize with no authoring: four rounds — over-or-under, closest-without-going-over, order-three-lots, and a ±20% Showcase. **`basin`** (Jackpot Protocol) asks what you know about the city, dealt from the district registry and the orders' own creeds: four multiple-choice rounds on a widening field, answered with a letter. Both go through the single `guess` verb, and an absent or unknown `@subject` resolves to `retail` — which is what every game show was before subjects existed. Subjects live in [plugins/broadcast/gameshow-subjects.js](../plugins/broadcast/gameshow-subjects.js). **Anyone standing in the channel's `studio_zone_id` when a round opens is a contestant**, and the existing studio relay televises their spoken answer citywide; with nobody there the contestants are name-only strings and the show plays out identically. Round control is a pair of *instantaneous* side-effect nodes (`gameshow_round` / `gameshow_reveal`) — **the guess window is the host's patter between them**, not a timer — and the outcome reaches air through the `{winner}`/`{verdict}`/`{guesses}` tokens rather than by graph branching (the `FLAG_SET` broadcast condition is a stub that always returns `false`). Wins pay credits gated by a 6-hour `player_flags.gameshow_win_cooldown`; the Showcase also grants the actual lot. Lives in the sibling module [plugins/broadcast/gameshow.js](../plugins/broadcast/gameshow.js). See [Game Shows](bsm-format.md#game-shows-type-gameshow).
- **`sermon`** is the news type’s Sunday cousin: the SAME live news feed, read as scripture instead of reported. Dynamic but **not acted** — celebrants are display names, so nothing spawns and it never presence-gates. Variety comes from three axes rolled per service (which celebrant reads, a random interpretive LENS per reading, and which optional beats happen at all), which is why twelve services off identical headlines come out twelve distinct. Re-rolls per in-game DAY, not per news bucket — a 15-minute liturgy re-rolling mid-service would cut itself off. Weekly via `@airday`, which rides the playlist’s existing 7-bit day mask. See [Sermons](bsm-format.md#sermons-type-sermon).
- **`film`** is the exception to this whole section: it is **linear**, not assembled. A feature stores an ordinary baked `broadcast_graph` like a `scripted` broadcast, and `film_meta` holds only what a chain cannot — pre-roll card copy, the display-name cast, and the `airSlots` screening block. It spawns no NPCs and never presence-gates (a film is a *recording*, so its `SPEAKER:` lines compile to pre-rendered `verbatim` says with no anchor). The one thing it needs from the runner is a **real-time seek**: daily slots elapse on the in-game clock but a picture is authored in real minutes, so the film branch divides `segElapsed` by `timeScale` before seeking — which is what lets a late viewer join the reel already running instead of restarting it. See [Films](bsm-format.md#films-type-film).
- **`talkshow`** is the odd one out: it's **acted live by real cast NPCs**. A resident host + sidekick commute in on schedule, and ONE reusable guest NPC is renamed to a new persona each in-game day, appears in a random unobserved zone, walks across the map to the studio, performs, and vanishes backstage afterward (engine AI actions `TALKSHOW_APPEAR`/`TALKSHOW_HIDE`, plus `talkshowHeartbeat` for the nightly rename). The assembled graph sets `_requireHost`, so it presence-gates on any channel — no cast on-stage ⇒ camera-idle → technical difficulties. **`_requireHost` is not enough on its own, and the reason is worth carrying to any acted show:** it only fires when the studio is *empty*, so a segment built around ONE absent actor — while the rest of the cast works — degrades silently instead. The say-node room-authority rule drops that actor's lines without a trace, and what airs is a host interviewing furniture. A talk show therefore does two more things: the guest gets a **call time** (staffed a slot before airtime, since it's the only one with a journey to make), and the interview sits behind a **chair gate** — an `NPC_IN_STUDIO` condition evaluated at air time, with an authored `guest_noshow` cover on the other branch. See [the chair gate](bsm-format.md#the-chair-gate) and [Talk-Show Broadcasts](bsm-format.md#talk-show-broadcasts-type-talkshow).

  There are **two** such gates, and the split between them is the design: a missing GUEST is a segment, a missing HOST is not a show. The **host gate** sits right after the announcer's introduction and branches the entire episode. Its false branch is short, solo and terminal — a few `host_absent` lines, the announcer's own `host_absent_signoff`, and off the air. It does **not** run the greeting (nobody to greet), the monologue, the guest intro, the interview, or — pointedly — the show's own sign-off, which is the host's line. Without it the whole running order played regardless and the room-authority rule binned the host's every line underneath, so what aired was the sidekick hosting a show he isn't the host of. The false branch also draws **no audience beats**: `react()` deals from the laugh deck, and a crowd losing it under "I can't say his name to an empty desk" is the wrong three seconds of television.

  **Segment discipline.** The sidekick has exactly three places in the hour — the intro, the monologue, and the goodnight — and is silent between them. He gets one heckle (`sidekick_aside`) and one two-hander (`banter`) placed at two different joke boundaries *inside* the monologue run, never bracketing it, and one throwback (the second `greeting` drawn) on the way to the sign-off. He is absent from the interview entirely. Scattering him through the whole hour reads as a co-host, not a sidekick. The one exception is the `guest_noshow` cover, where filling a hole in the running order in front of the audience is the job.

  **A short segment out of a deep pool, and the crowd doing the timing.** The monologue draws **4–5 jokes** a night (`TALKSHOW_MONOLOGUE`), not the 6–7 it drew originally, and **every one of them lands on an audience beat** rather than most of them. These are one decision, not two. Segment length is what a viewer sits through; POOL depth is what makes it a different show tomorrow — so drawing deeply was spending the only resource that matters twice as fast, and every extra joke a night is another night sooner that a regular viewer starts hearing them twice. The `monologue` pool was tripled to match (57 → 131 lines, `audience` 24 → 64), because a short draw off a small pool is the same show either way. The monologue still reads as the host's own segment: what does that work is the sidekick being capped at two interjections inside it, not the run being long.

  **`[topic]` on every monologue line.** Topic tags started life on the interview pools, where two phrasings of one question made the show look like it wasn't listening; the monologue has the same failure in a different key. The pool holds several jokes about rent, several about the Machine, several about what comes out of the taps — it should — but two in one monologue reads as a man with one subject rather than a man with an act. Two lines sharing a tag can never reach the same episode, so authoring a new joke onto an EXISTING tag is how you say "this covers ground we already cover."

  **`{host}` vs `{host_first}`.** The full name is the marquee name and belongs in the announcer's formal introduction; every conversational line uses the derived `{host_first}` / `{sidekick_first}` / `{guest_first}` token, because two men who have shared a desk for nineteen years don't say "John Akerson" across it. The script used to hardcode "John" into the text — right on air, wrong the moment the host NPC is renamed.

  **The cast has to be awake for any of this.** Studio actors are not vendors and have no `vendor_schedule`; their timetable lives in the channel playlist, reachable only through `npcNextShiftInMins()` on the broadcast bridge. `getNextShiftWakeMs()` in `ai-behaviour.js` consults it alongside the vendor schedule and takes whichever wake-up comes first. Before it did, a studio NPC read as "no schedule", fell through to the 07:00 default, and a host who dozed off at home in the evening was parked on `ai.waitUntil` until the next morning — asleep through his own 22:00 taping while the show aired to an empty desk.

---

## Sports — two codes, one pipeline

Two shows share the `sports` pipeline: **DEADBALL** (baseball, `bc_1783289744953`) and
**CLUSTER PUCK** (CPhL hockey, `bc_cluster_puck`). Both live on KSAB-TV at 18:00 —
Deadball Mon/Wed/Fri, Cluster Puck **Tue + Thu + Sun**, Jackpot Protocol Saturday. A
script declares its code with `@sport`, and **that is the only thing that selects a
sport module**; nothing else in the pipeline may branch on it.

Deadball's sub-screen is the 2-D Gameday view ([gameday.js](../client/game/js/panels/gameday.js)).
A high-fidelity 3-D one on Rinkside's pattern, with a 1990s arcade look and the park inside the
Curtain on Halcyon Fields, is planned in [proposals/deadball-glass2.md](proposals/deadball-glass2.md)
(Phase 0, sim v2, Phases 1 and 2 and the plays of Phase 3 built, behind a flag: see the
Grandstand below).

**The Gameday payload** is built by a pure module,
[sports/baseball-gameday.js](../plugins/broadcast/sports/baseball-gameday.js), which the
broadcast attaches to the line that calls each play and which the gates run without a server.
An at-bat payload carries the batter and pitcher, the play's kind, outs and RBI, the bases
before and after, the pitches, the line score so far, `sport`, and `bats` and `throws` (from
the names, so a player is the same in every game; a switch hitter also gets `switchHitter`).
A half-inning break carries `phase: 'half'` and nothing to animate.

An at-bat also carries `moves`, every man's fate on the play, lead runner first and the batter
last: `{ from, to }` to a bag or `to: 4` for a run, `{ from, out }` put out at a bag (0 for a
batter who never left the box), or `{ from, off }` for a runner cleared by an inning-ending
play. A v1 game keeps only which bags are occupied, so `runnerMoves` works the moves out from
the bags before and after, the kind and the change in the batting side's score (not the RBI: a
run can score without one). Runners can't pass each other, which makes the answer unique. The
views only animate them.

An at-bat that put a ball in play also carries `play`, decided on the server by `synthPlay` in
[sports/baseball.js](../plugins/broadcast/sports/baseball.js) so the picture and the booth's line
agree: what it was off the bat (`t`: a grounder, a liner, a fly or a pop-up), its spray (`dir`,
degrees off centre, negative to left), the exit speed and launch angle (`ev`, `la`), how far out
it was fielded or came down (`d`), the fielders in the order it went through them, numbered as a
scorer numbers them (`f`, `[6, 4, 3]`), the fielding grade (`g`: routine, ranging, diving,
sliding, leaping, barehand or rail), the batter's legs (`sp`), and where they apply the man who
dove for a hit and missed, the throw, the wall, the slide, the kind of home run and the kind of
error. It's seeded off the at-bat with a salt of its own, so it never touches the sim's stream.
The field it's judged on (where the nine stand, shaded to the hitter's pull side, how far a ball
carries or rolls, how far a fielder gets in the time) is
[diamond/play.js](../client/game/js/panels/diamond/play.js), which the 3-D park reads too, so a
play the server grades a dive is one the park can show as a dive. Every candidate is drawn round
the man who has to make the play and kept with the chance a play that hard gets made, so most
outs are routine and a hit goes where nobody could get to it. The play's tags open the line pools
that agree with it ([bsm-format.md](bsm-format.md#lines-that-agree-with-the-play-baseball)), and
the 2-D view draws the ball to the man it names and on through the bags the outs were made at.

The broadcast adds `hold` (how long the line holds, in ms) to every payload, and the league
table, `leaders` and `season` (its number, `regular` or `final`, and the seeds in a final) to the
game's first payload only; a late tuner's catch-up carries all three. `leaders` is five a race
from the season's fold (`gamedayLeaders`): `hr`, `avg` and `sb` for the hitters, `k` for the
pitchers.

Every play also carries the batter's and the pitcher's season lines as they stood before it:
`bl` is [AB, H, HR, RBI, SB] and `pl` is [W, L, outs, ER, K]. They start from the standings
fold's every-man ledger (the games before this one) and are folded forward through this game
(`nightLines`), so a late tuner's numbers match everyone else's. A steal, a caught stealing and
a double steal carry `plate` and `pop`, the pitcher's time to the plate and the catcher's pop
time in seconds, from the quickness and the arm that decided the play, and a steal carries `sb`,
the runner's steals with this one. As each line airs, `gamedayOnAir` adds `wx`, the weather over the park's
site (`sports_pools.venue.site`, carried over a rebuild by `build-deadball.mjs`): the tile's
weather `word`, `precip` and `rate` from the in-memory weather cells, and any city-wide `event`
such as an ion storm. It's read on air rather than at assembly because the cells drift across
the city during a game. A script with no site sends none.

`scripts/shapes/gameday-smoke.mjs` plays real games through the 2-D view and checks that every
play lands, its runners end where the sim left them, and every ball in play goes to the man its
play names and ends where the play says. `scripts/shapes/variety-smoke.mjs` runs a season of
seeded plays: grounders pulled about three times in five and fly balls spread more evenly, exit
speeds from about 50 to 115 mph, every fielding grade, double play, kind of home run and error,
and a play that opens every suffixed line pool. Regress checks every play against its kind and
the sim, that building the payloads leaves the game as it was, and that a bare line pool names no
direction. `tools/sandbox/deadball-park-test.html`
plays the same in a browser, with the script's lines, for screenshots and tuning by hand.
Regress pins the sim itself: a hundred seeded games and four finals, every at-bat and every
pitch, hash to a recorded value, because the standings and the recaps re-simulate games that
have already aired. A viewer with the sub-screen open is sent about 91 payloads a game, about
85 KB with the weather (measured over eight graphs on 2026-10-11), and about 5 KB more with the
men's lines and the leaders (37 bytes a payload and 1.6 KB once, measured on 2026-10-12), and
about 4 KB more with the plays (about 52 balls in play a game at about 75 bytes each, measured
on 2026-10-12). It was 116 KB when the table rode every payload.

### The park in 3-D (the Grandstand, behind a flag)

tv.js mounts baseball through
[gameday-grandstand.js](../client/game/js/panels/gameday-grandstand.js). With the flag off it
returns the 2-D Gameday and nothing else runs. To turn it on in a browser, set the localStorage
key `deadball.grandstand` to `'1'` (in the console:
`localStorage.setItem('deadball.grandstand', '1')`) and reopen the Gameday. It has the same five
methods as the other two views. When the 3-D view can't draw (no WebGL2, no float target, a
shader that won't build, a lost context), it hands over to the 2-D view with the last payload and
the booth's line.

Built so far (Phases 1 and 2 of the plan):

- the park from the venue's defaults, built by the pure
  [gl/ballpark-mesh.js](../client/game/js/panels/gl/ballpark-mesh.js) from
  [diamond/geo.js](../client/game/js/panels/diamond/geo.js): the field, the padded wall with its
  distances, the foul poles, the bleachers and the batter's eye, the lower bowl, the upper deck,
  the backstop net, six light towers whose lamps the venue says work or not, and the scoreboard;
- [gl/ballpark.js](../client/game/js/panels/gl/ballpark.js), the WebGL2 renderer: the towers as
  the only lights, GGX in linear light into `hdr.js`'s multisampled float target, the field painted
  in the shader under the infield canvas ([diamond/dirt.js](../client/game/js/panels/diamond/dirt.js)),
  the crowd instanced over the seats, then bloom and a filmic curve. It takes `hdr.resolve()`, not
  `composite()`, so it grades its own frame;
- the scoreboard's lamps lit from the payloads by [diamond/board.js](../client/game/js/panels/diamond/board.js):
  the line score, the count and the names, in a 5×7 matrix face;
- the shots in [diamond/camera.js](../client/game/js/panels/diamond/camera.js) (batting view,
  centre field, high home, the first-base camera, the bag, the third-base camera, the sky), each
  with its GL matrices and the same pinhole worked out by hand;
- a score bug, the booth's line and the cards in HTML over the canvas;
- the frame round it (Phase 1b): four of the towers draw shadow maps of whatever casts
  ([gl/spotshadow.js](../client/game/js/panels/gl/spotshadow.js); the players will, in 1c), the
  night air is `fog.js`'s height fog with each tower's light scattered in it, the depth the frame
  was drawn with is blitted out of the multisampled target for ambient occlusion at half size
  (`createDepthSSAO` in `ssao.js`) and for the lens, and
  [gl/broadcast.js](../client/game/js/panels/gl/broadcast.js) draws the lens (depth of field per
  shot: the long lens softens the crowd), the curve and the grade. The grade is `arcade` (full
  saturation, a contrast curve, warm highlights over cool shadows, sharpening, a vignette),
  `broadcast` (the period's video: lifted blacks, soft colour, aperture correction, the CCD's
  smear off the lamps) or `none`, and tube glass can go over either. The sandbox takes `?grade=`
  and `?tube=1`;
- the players (Phase 1c): [diamond/cast.js](../client/game/js/panels/diamond/cast.js)
  puts each payload's people where they stand (the nine in the field, the batter in the box for his
  side of the plate, the men on base leading off, on deck, the coaches and four umpires), and
  [gl/ballplayer-mesh.js](../client/game/js/panels/gl/ballplayer-mesh.js) builds each one's body
  from a pose by IK, with the street figure's head and its face from the atlas, and a cap, a
  batting helmet or a mask fitted to the skull. A lefty is his pose in a mirror. What a player
  looks like and his number come off his name, or off his club and position where the payload
  doesn't name him, and [diamond/kits.js](../client/game/js/panels/diamond/kits.js) paints the
  kits: the clubs' nicknames and the numbers on placeholder colours until the clubs bring their
  own (Phase 5). The players cast the towers' shadows. Since Phase 2a they're skinned: each body
  is built once in the rig's bind pose ([diamond/rig.js](../client/game/js/panels/diamond/rig.js),
  twenty bones from the pelvis to the bat) with four bone weights a vertex, and the GPU moves it
  into any pose ([gl/skin.js](../client/game/js/panels/gl/skin.js), a palette of bones in a float
  texture, a row a kit slot). A body is kept for who a player is and what he wears, not where he
  stands, so a runner keeps his round the bases and a new payload builds only its new people. The
  fielders stand where the server's plays start them (`fieldSpots` in
  [diamond/play.js](../client/game/js/panels/diamond/play.js)), shaded toward the hitter's pull
  side, so a hitter from the other side moves them over.
  Their motion is the clip library (Phase 2b): [diamond/anim.js](../client/game/js/panels/diamond/anim.js)
  plays clips keyed in the rig's pose language, from `content/animation_clips/` baked to
  `diamond/clips.js` by `npm run clips:bake` (the Modelshop's Pose Lab keys them, Phase 2e),
  with the glove reaching for the ball, the head
  turning to it and each player's own way of doing it off his name. The library holds the pitch
  (Phase 2c): the pitcher's deliveries from the stretch and the windup for each arm slot, the
  hitter's load, swings, take and check swing, the catcher's receive, block and throw back, and
  the umpire's calls, three ways to ring up strike three among them. It holds the play too
  (Phase 3b): the runs (a jog, a run and a sprint), pulling up, the hitter out of the box for
  each hand, three slides; ground balls taken routine, backhand, forehand, diving either way and
  barehanded; the throws over the top, from the knees, the flip and the crow hop; the first
  baseman's stretch and scoop, both double-play pivots and the relay; the outfielder's charge
  and throw; catches camped, running, diving, sliding, at the wall and over the rail, and the
  catcher's pop-up; a fielder watching one go; and the base umpires' safe and out. And the plays
  on the bases (Phase 3d): the catcher's throw from the crouch to second and to third, the tag
  astride a bag for a runner coming from ahead or from beside, the first baseman's tag on a
  pickoff, the pickoff move (a right-hander's jump turn, a left-hander's step), the dive back to
  first, up off the ground from either slide, and a ball picked up where it lies. A clip that
  travels carries its frame with it (`root`), and the world carries the player on by it;
- the pitch (Phase 2d): [diamond/director.js](../client/game/js/panels/diamond/director.js) stages
  each at-bat in a world ([diamond/world.js](../client/game/js/panels/diamond/world.js)) stepped
  at 120 Hz while it plays. The ball flies from the pitcher's hand at its real speed to exactly
  where the payload says it crossed the plate, bending by its type
  ([diamond/flight.js](../client/game/js/panels/diamond/flight.js)), and every clip is lined up on
  it: the delivery's release, the swing's contact, the mitt's catch, the flinch of a hit batsman.
  A swing meets an inside pitch out in front and lets an outside one travel, and the hands carry
  the bat to the outer edge with the body leaning after them. The budget is 0.45 of the line's
  hold, kept between 13 and 26 seconds, and the director spends it in the plan's order: every
  pitch cut in at the stride, then each one's reaction (the hitter in close-up, with the umpire's
  call), then the pitcher's whole motion and the set before it, then the throw back and the walk
  up to the rubber. A long at-bat on a short hold leaves pitches out of the middle and the count
  goes through them. Every jump from one moment to the next is under a cut. Strike three, ball
  four and a hit batsman are played in full, the hitter walking off or heading to first, and a
  strikeout and a walk get their splash words. The 2-D view's cues
  ([client/shared/deadball-sfx.js](../client/shared/deadball-sfx.js)) play on the moment: the
  mitt, the crack of the bat, a miss's whiff, the ball into a glove, and the play's own sound as
  it lands;
- the ball in play (Phase 3c): [diamond/plays.js](../client/game/js/panels/diamond/plays.js)
  plays out the payload's `play` as the server decided it. The ball goes off the bat on the
  spray, at the exit speed and launch angle the server drew: one on the ground rolls on play.js's
  own roll and comes up off its last hop into the glove, one in the air comes down in its hang
  time, and one over the fence lands in the seats. The seven set as the pitch comes and every
  head follows the ball. The man who fields it runs to where his clip puts the glove on the ball
  at the moment the server said, in the clip for his grade: the ground ball taken routine,
  backhand, forehand, diving or barehanded, the catch camped, running, diving, sliding, at the
  wall or over the rail, the catcher's pop-up, or the outfielder running a hit down. The throws
  go man to man (to first, to the pivot at second and on, to the cutoff), each turned so the
  hand's own way at the release points at its man, out of the hand at the release and into the
  glove at his catch, and held until he can be there. The batter comes out of the box and runs
  to first at his own legs' pace, never ahead of the ball on an out there, and pulls up through
  the bag; the base umpire calls it. Errors play too: the ball booted and picked up again, through
  the legs to the man behind, dropped out of the glove, past the first baseman or into the
  stands. The high camera from home follows the ball, tilting up for a pop-up and closing in on
  one far out; a play at first cuts to the first-base camera as the throw goes, and a long fly to
  a camera behind the man under it. The men on the bags run the payload's `moves` (Phase 3d,
  [diamond/bases.js](../client/game/js/panels/diamond/bases.js)) at their own legs' pace, the
  sim's speedOf: round the bags on a bowed turn, into a slide where the play says, home over the
  plate and off toward their dugout. A man holding goes back to his bag; one tagging up leaves it
  on the catch; one forced out gets there after the ball, and the base umpire calls it. The batter
  rounds first on a single to the outfield and comes back, and trots round on a home run. A throw
  to a bag a man's safe at waits for him, and the play lands with every man on his bag and every
  run in; a man still running once the ball's back in gets the camera at the bag he's going to
  (the plate, third or second). On ball four or a hit batsman the batter trots to first, every
  man forced trots up a bag and a man not forced walks back to his. When the booth skips an
  at-bat and the next one starts from other bags, it opens on the wide shot over the city while
  everyone takes their places;
- the changeover (Phase 3d): on the third out, once the play's landed, every man on the field
  jogs off to his side's dugout, the fielders to theirs and the men on the bases to their own,
  and the high camera watches them go. A dugout is a row of spots in foul ground up the line
  (the visitors' on the third-base side), handed out by when the men get there, the first man in
  to the end furthest from the field, and a man holds back a beat where he'd pass too close to
  one gone before him. At the break the side taking the field runs out of its dugout, the
  catcher first and then the pitcher and the rest a third of a second apart, and the pitcher
  throws his warm-ups to the catcher and takes the ball back, as many as the hold has room for
  (four at most), under the break's graphics;
- the plays on the bases (Phase 3d,
  [diamond/runs.js](../client/game/js/panels/diamond/runs.js)): a `phase: 'run'` payload is
  staged as an at-bat is, on its one pitch (`runPitch`: a fastball away for a steal, a breaking
  ball in the dirt for a wild pitch, one on the far corner for a passed ball) or its one throw
  over, with the board at no balls and no strikes, since the man's up and hasn't seen a pitch. A
  steal's delivery from the stretch is played at the tempo that gets the ball to the mitt on the
  card's time to the plate (`plate`), and the catcher throws in what's left of the pop time
  (`pop`) once the ball's in his hand, so the card's clocks are the picture's. The man covering
  (the second baseman with a right-hander up, the shortstop with a left-hander, the third baseman
  at third) takes it astride the bag and puts the tag down, and the runner breaks so his slide is
  in a beat before the tag when he's safe and just after it when he's out, his lead taking up
  what no jump will. A throw over is the pitcher's pickoff move to the first baseman at the bag,
  the runner diving back in time or, on a pickoff, a beat late. A wild pitch skips off the dirt
  past the block and a passed ball goes off the end of the mitt; either rolls to the backstop and
  the catcher picks it up where it stops, every man moving up a bag while he does and the pitcher
  covering the plate when a man comes home. The base umpire calls it, a man out jogs off, and
  once it's done the man who took the throw jogs back to where he plays and a man safe steps onto
  his bag; on the third out the man who made the tag steps off past the bag, away from the man he
  got, and everyone goes off once that man's up. The camera cuts to the bag as the throw goes
  (first on a throw over), and to the backstop camera when a man scores on a pitch that got by; a
  steal's card goes up with the call;
- the spectacle (Phase 3e, [diamond/spectacle.js](../client/game/js/panels/diamond/spectacle.js)
  plans it, [gl/spectacle.js](../client/game/js/panels/gl/spectacle.js) draws it): a comet's tail
  down the ball's way on a ball hit 100 mph or harder and on every home run, gone once its flight
  is over; sparks off the bat at contact on a ball hit that hard; and after a home run or a
  walk-off, six shells over the outfield (nine on a grand slam, twelve on a walk-off), each rising
  from behind the bleachers and bursting over them. All of it is light added over the frame, so it
  blooms, and pure in time, so a stopped clock or a replay draws the same picture. A home run gets
  its own camera: once it's clearly gone, the shot rides beside the ball on the side nearer the
  middle of the field, stops 45 ft short of the wall and watches it into the seats; then the wide
  shot over the outfield as the first shell goes up, and the high camera back for the trot. Its
  distance and its speed off the bat take the pitch speed's box. The shells go up more than a
  third of a second apart, so no second has more than three bursts in it;
- reduced motion (Phase 4a), the Motion switch or the system's setting, read as each play is
  staged: the cameras that would follow the ball hold still and cut instead, each framed on where
  the ball's flight ends and cut to the next as the next throw goes, never within a second of its
  last cut ([diamond/plays.js](../client/game/js/panels/diamond/plays.js) `stillShots`); no camera
  rides with a home run and none of the spectacle is drawn; the graphics come up still. The 2-D
  view draws no trails, no wipe on a cut and no celebration, and runs no idle loop between plays;
- the play by play in words (Phase 4a): with Play by Play on (`accessibility plays`, on by
  default), both views write into a polite live log for a screen reader each pitch as it's thrown,
  in the words gameday.js `pitchText` makes of the payload the picture throws it from ("88 slider,
  swinging strike, 1 and 2"; the last pitch says ball four or strike three instead of the count),
  the booth's line as it goes up, and every card and splash word. The 3-D view also says the
  matchup with both season lines, a steal's card with its clocks and a home run's distance, and
  its board in words carries the leaders' table between innings, so nothing on the hidden graphics
  canvas is only a picture;
- the crowd (Phase 4c, [gl/crowd.js](../client/game/js/panels/gl/crowd.js)): every fan is one
  figure in three poses, sitting, standing and cheering (`crowdMorph` pairs the poses vertex for
  vertex), and the vertex shader moves him between them by how loud his side is. A play's cheer
  (spectacle.js `cheerOf`) says whose fans, how loud and how long: a home run brings its side up
  off the bat, a run, a double play, a great catch or a strikeout ending a half as it lands. Each
  side's roar rises, holds and falls away (`createRoar`, a pure function of time), and each fan
  gets up once it passes his own threshold, hashed from his seat, so a big play brings a whole
  stand up and a small one a few; up, he bounces and sways on his own beat. Most fans are the home
  side's, more of the visitors' up the third-base line by their dugout. With reduced motion they
  still stand, without the bouncing;
- the infield keeps the game (Phase 4d, [diamond/marks.js](../client/game/js/panels/diamond/marks.js)):
  every pitch leaves the pitcher's stride where his front foot lands and the hitter's back foot
  dug in, and every slide and dive its scar, said by the director as they're made (`'mark'`). The
  park paints them on its own copy of the infield canvas ([diamond/dirt.js](../client/game/js/panels/diamond/dirt.js)
  `paintMark`, only where there's dirt, `onDirt`) and uploads only the rect each one touches
  (gl/ballpark.js `markDirt`). A payload from another game, or an earlier inning, starts a fresh
  infield (`resetDirt`);
- replays (Phase 4b, [diamond/replay.js](../client/game/js/panels/diamond/replay.js)): a walk-off,
  a home run, a triple or double play, a catch that took a dive, a slide or a leap, a triple and a
  call at first closer than 0.15 s are shown again in slow motion. Staging is a pure function of
  the payload, so the play is staged again in a world of its own (`stageReplay`), stepped to just
  before its moment and played at 0.4 of its speed from a second camera, at most 3.4 s of play,
  silent, under a REPLAY bug beside the score; the live world carries on behind it and a cut its
  director makes meanwhile waits. It starts 1.8 s after the landing, or once the fireworks are out
  after a home run or a walk-off, and only when it ends a second before the next payload's due (a
  payload's `hold`; one without gets none). With reduced
  motion it's a still of the moment for 3.2 s. The live text says "Replay" with the play;
- the arcade graphics (Phase 1d), a canvas over the picture drawn by
  [diamond/hud.js](../client/game/js/panels/diamond/hud.js) in the client's display faces: the
  score with the bases, the count as lamps, the pitch speed and type, and in the batting view the
  zone over the plate with the last pitch marked. As each man comes up a matchup card shows his
  number and season line against the pitcher's, with VS on a starburst; a steal shows its card and
  its clocks; the cards the broadcast throws (home run, walk-off, double play and the rest) are
  splash words, and so is every play that earns one on its own (spectacle.js `splashOf`): strike
  three, ball four, a hit batsman, a triple, an error, a catch at the wall or one that robs a home
  run, a diving or sliding catch, one over the rail, a diving stop, a barehanded play, a pickoff,
  a wild pitch and a passed ball; and each half-inning break is a high-score table of the leaders, one race at a
  time, over the live picture. The final dresses it all in gold. The HTML score bug and cards
  are gone; the score is written out for a screen reader instead. The words, the colours and the
  station's bug come from a theme (tv.js passes the station's name), so `hud.js` names no league;
- the city round the park (Phase 1e), a set composed for television: the park is full size and the
  map's park is three tiles by three, so what the cameras see past the walls is the map's
  buildings laid out again round it. [client/shared/city-set.js](../client/shared/city-set.js)
  stands the park in a superblock with a paved plaza, runs streets every third tile out from it,
  puts the set's edges on the map's Curtain and shore, gives each building the free plot nearest
  its true bearing from home plate (a pier stays on the water), and fills the rest in the
  quarter's style. [gl/cityscape.js](../client/game/js/panels/gl/cityscape.js) builds it from
  the buildings' baked shapes at the flight sim's size (`buildingScale` in
  [skyline-scale.js](../client/shared/skyline-scale.js), which the windshield now reads too):
  facades shaded from bays and storeys with lit windows, streets from each road tile's arms,
  cobra-head sodium lamps with pools of light, beacons on the tall roofs, the Curtain in
  `curtain.js`'s own look, red rock past the walls and the bay past the shore. The park has its
  outside too: a brick wall along its outline with a lit arcade, the club level's windows and
  the steel tier, flags along the grandstand, and the venue's `name` lit over the main gate.
  The towers reach the city through a narrower beam, so the field stays the brightest thing in
  the picture.

**How the venue reaches a viewer.** Like the clubs, it never rides a payload. A game's first
payload (and a late tuner's catch-up) carries `venueRev`, a short stamp of the venue as the
server would send it. A client without that revision sends `tv_venue` once
([venue.js](../client/game/js/panels/venue.js)), and the plugin answers with `{ type:
'tv_venue', sport, rev, venue }`: the content's venue (`site`, the city's art direction in
`city`, `name`) with `skyline`, built from the in-memory map by
[server/engine/skyline.js](../server/engine/skyline.js) over
[client/shared/skyline-manifest.js](../client/shared/skyline-manifest.js): the buildings
within 40 tiles of the site and the edges round it, a Curtain line or a shore per side. It's
about 18 KB, 5 KB gzipped, kept ten minutes on the server and in `localStorage`
(`thomas.venue.<sport>`) on the client. The cold open's flythrough reads the same building rows.

**The city's art direction** is `sports_pools.venue.city` on the Deadball row: `styles` maps a
building type to a facade style (glass, concrete, brick, ribbon, works, farm, stone, ruin,
chrome), and `quarters` are tile rectangles, first match wins, each with the style for its tall
and low buildings, `all` to dress a whole quarter alike (Old Coldwater's ruin), and the styles
and floors of its filler. `tallFloors` is where tall starts.

Frames run while an at-bat or a play on the bases plays and stop once everyone's at rest, so the
GPU idles between them. The count goes up as the director decides each pitch, and the booth's
held line and any card go up when the play lands (`onLand`): the umpire's call on a called third
strike, the ball in the mitt, the ball hitting the batter, or a ball put in play settled: the out
at first called, the catch made, a hit back in from the outfield with the batter on the bag; on
the bases, the base umpire's call, or every man on his bag after a pitch that got by. A line
comes just before its payload; one that arrives while the
last play is still in the air (a hidden tab stops the frames) lands that play first, and a
timer lands a play whose frames have stopped. A changeover has nothing to land, so its line goes
up a beat in.
`scripts/shapes/ballpark-smoke.mjs` builds the park from the defaults and from a venue of its
own, holds every shot's matrices to its pinhole on three screen shapes, reads the board's lamps,
checks the fallback, fits each tower's shadow map to the shot, reads depth back through the
occlusion's constants, holds the lens sharp at its focus, builds every pose for both hands,
places a cast, holds every face pick steady and every cap, helmet and mask clear of the brow,
the ears and the eyes, keeps a runner's body from bag to bag, and lays the graphics out on the wall TV's, the tablet's and the
sandbox's screens with and without the tube glass: everything inside the frame, nothing under
6 px or cut short for the script's longest names, no panel over another, and checks the outer
wall faces out all round with the sign outside it. `scripts/shapes/cityscape-smoke.mjs`
composes the set from the content tree's skyline and builds the city: every building placed
and resolved to a shape, none inside the park, bearings held, the edges on tile lines, every
road tile drawn from its arms, nothing tall beside a street-level camera, and no region named
in the engine files. `scripts/shapes/anim-smoke.mjs` skins the players on the CPU with the
shader's own sum and holds every pose to the posed build's surface, the head vertex for vertex
and the hands on the bat; then it plays every clip, holding each frame to what a body can do,
the planted feet still (on the ground he started on, for a clip that travels), a travelling
clip's frame no faster than a sprint, the hands on the bat, the glove to the ball across the box
its catch covers and the ball leaving the hand at its fastest, and fails a stale `clips.js`.
`scripts/shapes/diamond-smoke.mjs` stages two sim v2 games at a short hold and a long one: every
pitch through the plate within 0.05 ft of its spot, every clip on its event as the ball arrives,
the mitt and the bat's barrel on the ball with both hands on the bat, the joints inside their
limits, each at-bat ending as the sim ended it, `onLand` on time inside the budget with the count
done by then. Every ball in play has each catch's clip on its catch with the glove on the ball
and the fielder inside his joints, each throw out of the thrower's hand, the call at first
agreeing with the ball and the batter, nobody moving faster than 52 ft/s outside a cut, the ball
above the grass and never faster than the hardest-hit ball, and the high camera keeping it in
frame. Every man on the bases goes over every bag on his way, is on his bag by the landing and
stands on it at the end, a man forced out gets there after the ball and one safe at a bag a throw
goes to gets there first, no two men come within 2.5 ft of each other, and the runs that cross
the plate are the play's, after ball four too; a runner's legs in the picture are the sim's
(play.js legsOf against speedOf). After a third out everyone ends by his own dugout and nobody
comes within 2 ft of anybody going off; at every changeover each man ends where he plays, nobody
moves faster than 52 ft/s, and every warm-up leaves the pitcher's hand and meets the catcher's
mitt. Every play on the bases in the game, and the first of each kind it hasn't got from the
games after it, has the delivery and the pop on the card's clocks (0.01 s), the throw out of the
hand and into the cover man's glove, the pitch in the mitt, the call agreeing with the slide and
the tag, the runner's hand or foot on the bag at his touch, a pitch that got by picked up where it
stopped, and at the end a man safe on his bag, the man who took the throw off it and no two men
within 2 ft; a third out on the bases (the game's, or the next games' first) takes everyone off
to his own dugout without a jump or two men within 2 ft. Every home run, ball hit hard and
walk-off (a home run and a walk-off borrowed from the next games when the game has none) has the
right tail, sparks and shells, every shell over the outfield with its sparks above the stands and
inside the wide shot's frame, never more than three shells in a second, the home-run camera
keeping the ball in its frame from inside the park, the cuts in order, and none of it with reduced
motion on. Every ball in play is staged again with reduced motion: every camera holds still and the
ball is in the frame of the still that's up as each flight ends. Every play that earns a replay
(and a triple, a walk-off that isn't a home run and a triple play from the next games) is staged
again in a world of its own and is the same play to a micron, with its moment in its camera's
frame. It feeds the view with a recording renderer to hold each line until its play
lands, a play on the bases among them with its steal card, and leaves out one at-bat that moves
the bags, as the booth does, to open the next on the cutaway because its bags differ from the
picture's; its live text says every pitch in order and the booth's line, says nothing with Play by
Play off, and its board has the leaders' table between innings; and a home run with room in its
hold plays its replay at 0.4 of the live clock with its bug up and its camera on, the live camera
back after, and with reduced motion holds a still of the moment instead. `gameday-smoke` checks the 2-D
view's live text the same way. The sandbox page takes
`?park=3d`, `?play=inplay` (balls in play only), `?play=bases` (the plays on the bases), `?shot=`, `?bug=`, `?po=1` (the final's
dressing), `?hud=0` (the picture alone), `?city=0`, `?hold=` (each line's hold in milliseconds,
35000 by default) and `?speed=` (0.25 for a slow look, 0 to stop the park's clock); its city comes from the flight sim's
baked world, so it can trail the live map by a bake. [tools/sandbox/deadball-shots.mjs](../tools/sandbox/deadball-shots.mjs)
takes the page headless and screenshots a slot's plays at the moments the director logs (each
pitch, the catch, the throw, the tag, the landing and after), so the picture can be checked with
nobody at the keyboard. The renderer's traps are in [glass-notes.md](reference/glass-notes.md#the-ballpark-glballparkjs).

### Sim v2

`simGameV2` in [sports/baseball.js](../plugins/broadcast/sports/baseball.js) adds the plays v1
never had: errors, hit batters, steals and caught stealing, pickoffs and the throw over a runner
beats back, double steals, wild pitches and passed balls. Per team a game it comes to about 0.9
steal tries (68% safe), 0.4 errors, 0.4 hit batters, 0.2 wild pitches and 0.05 passed balls,
measured over 3,000 games, and scoring stays within 1% of v1, because an error comes out of the
single's share of the at-bat table and a hit batter out of the walk's.

- **It's v1's game with named runners.** Every draw v1 makes, v2 makes in the same order from
  the same stream, and every new decision draws from a stream seeded from the game's seed, so
  with its new plays off (`SIM_V2_OFF`) a v2 game is the v1 game play for play. Regress checks
  that over 300 games. The one other change: the home nine start one name further into the
  shuffled pool, because in v1 the home leadoff man shares the away pitcher's name.
- **A runner's legs, a catcher's arm and a pitcher's quickness** come from their names, as
  handedness does, and decide steals. The catcher is the seventh lineup slot
  (`LINEUP_POSITIONS`).
- **The beats.** An at-bat carries `runs` (scored on the play), `runners` (the names on the bags
  after it) and `moves` with names, and `rbi` is the true RBI: none on an error or a double play.
  Two kinds are new, `hitbypitch` and `error` (with `fielder` and `errorType`). A play on the
  bases is a beat of type `run` with `runner` and `base`; one that makes the third out ends the
  half with the batter still up, and he leads off the next inning.
- **The payloads.** A play on the bases is a `phase: 'run'` payload with its moves and no
  pitches, an at-bat passes the sim's moves through, and the line counts errors (`eAway`,
  `eHome`) for the 2-D view's E column. A v1 game's payloads are byte for byte what they were.
- **The booth.** The new plays have pools of their own (see
  [bsm-format.md](bsm-format.md)), and the tokens `{runner}`, `{base}` and `{fielder}` come from
  the sport's `playTokens`. A throw over is colour; everything else on the bases is called.
- **The hitting race.** A hit batter is a plate appearance and no at-bat; an error is an at-bat
  with no hit.
- **The steals and the pitchers.** The same walk over the beats (`foldGame` in `baseball.js`)
  counts each man's steals and caught stealings, and each pitcher's wins, losses, outs, earned
  runs and strikeouts. On a double steal with a man thrown out nobody is credited with a steal.
  Each side's pitcher goes the distance, so the winning side's takes the win. A run is unearned
  when it scores on an error or a passed ball, when the man scoring reached on an error, or when
  the errors, counted as outs, would already have ended the inning. The `standings` command and
  the tablet's Sports app show the steals and strikeout races.

**The switch.** A game that has aired must replay as it aired, so v2 plays from a slot the
server records once, not from a slot written into content: the slot comes from the in-game clock,
which lives in the database and staff can skip, so nothing outside the server could check one.
`@sim 2` in `baseball.bsm` compiles to `sports_pools.sim.version`. The heartbeat
(`recordSimSwitches`) sees it and writes `{ from }` to the world flag `sports_sim_v2:baseball`:
the first slot of the next in-game day, which is in the future when it's written. A script that
stops asking gets `until`, the same way. `sportsGameForSlot` reads the record (loaded at startup,
before any game is simulated) through `simVersionFor` and plays the slot's version. A version
that has played and ended can't be switched back on; one switched off before its first slot can.
world_flags is runtime state, so a deploy never rewrites the record.

### The sport registry

`SPORTS = { baseball, hockey }` in [plugins/broadcast/index.js](../plugins/broadcast/index.js),
each entry a module under [plugins/broadcast/sports/](../plugins/broadcast/sports/). A
module is **pure and seeded**: `simGame(matchup, players, rand)` with the same three
arguments returns the same game forever, on every server and every TV, writing nothing.
`matchup.teams` carries the whole club list, because a sport whose rosters belong to the
league can't derive them from two names.

| Export | What it is |
| --- | --- |
| `simGame` | the sim; returns `{ away, home, awayScore, homeScore, beats, … }` |
| `playDesc(beat)` | neutral factual label for the play card (distinct from the announcer's line) |
| `synthDetail(seed, kind, side)` | cosmetic keyframes for the sub-screen (pitches / possession) |
| `season` | how a game folds into a league table — see below |
| `narrate(ctx)` | **optional.** Its presence is what hands this sport the middle of the broadcast |
| `defaultNames`, `section`, `ordinal` | naming/labelling |

### The `narrate` seam

`assembleSportsGraph()` keeps everything sport-agnostic — the node chain, `say`/`pick`,
the recap reel, the pacing, the graph — and hands the middle to `sportMod.narrate(ctx)`
when the module exports one. **Baseball has no `narrate`**, so its body (halves, bases,
RBI, extra innings) runs untouched on the original path; the diff that added the seam is
the seam and nothing else. A third sport touches `index.js` nowhere but the registry.

`ctx` supplies `{ script, game, gs, slot, ws, announcer, pools, nrng, sport, add, say,
pick, abbr, recordOf, standings, lastId }`. `recordOf` is **bound to that sport's table**
so a narrator cannot read the other league's records.

### Hockey specifics (as built)

- **The atomic beat is a scoring chance**, not an at-bat: ~34/game at ~10–11% conversion,
  landing on **~6.4 goals on ~64 shots**.
- **Violence has consequences.** An injured man is *not replaced* — his side finishes
  short. A fight loser serves five and the **winner's** team gets the power play.
- **Sudden death is literal**: overtime ends on the first goal *or* the first fatality,
  then a shootout. **Never a tie.**
- **Faceoffs are real beats at the nine real dots.** Centre ice **only** after a goal or
  to start a period; the offending team's end after a penalty; the defending end after a
  frozen puck or an injury; neutral zone after a fight or scrum. The dot alone tells a
  reader what just happened, which is why it is simulated rather than sprinkled.
- **A man belongs to one club.** `rosterFor(team, teams, players)` deals each club a
  stable, disjoint six by sorting the league and shuffling the pool with a fixed seed —
  a pure function of the *league*, not the game, stored nowhere. The pool must hold at
  least `clubs × 6` names (regress asserts it); below that it degrades to sharing men.
- **Clubs differ.** `clubProfile(name, identity)` derives shooting / goaltending /
  discipline / violence from the club NAME, then **nudges by keyword** — a club called
  the Goons cannot come out as the league's gentlest side because its name hashed low.
  Its colour pair comes from the club's authored identity (below), or from the name's
  hash for a club nobody has dressed.
  Measured over 480 games: the most-penalised club takes ~341 to the least's ~121, with
  goals/game holding at ~6.4.
- **Every club has exactly one rival**, `rivalOf(team, teams)`, derived from the league
  (sort → seeded shuffle → pair adjacent) so nothing is authored and a new club arrives
  with a rival. A rivalry is **not a caption**: fights and boards run ×1.7 and penalties
  ×1.45, which measures out at **7.9 penalties and 2.1 fights** a night against 6.4 and
  1.4 normally. It's highlighted everywhere it's true — its own intro/matchup pools, a
  red `hockeyrivalry` pre-game card, and a persistent chip on both the score bug and the
  rink header, so someone joining in the second period can see why the penalty count
  looks like that.
- **Barn colour.** Half the booth's chatter is about the building: it draws from
  `chatter.<first word of the home club>` (falling back to the general pool when a club
  has none), and the other half from the general `chatter` pool, so the league-wide lines
  still get heard. Every club has a barn pool; the District 9 Goons' is `chatter.district`.
- **Every barn's horn is its own.** The goal horn is seeded from a hash of the scoring
  club's name (`hornSeed` on the payload) through the soundset's existing `variant()`,
  so no per-club audio is authored and a barn sounds like itself forever.
- **Injuries persist, and that is the hard part.** A man carried off is gone for
  **2–16 slots**; a death is permanent. This makes game N depend on the games before it
  — the one thing this league's determinism forbids — so nothing is stored: the schedule
  is deterministic, therefore **the injury ledger is also a pure function of the slot**.
  `ledgerAt()` folds the season's games forward in order carrying who is hurt and until
  when, memoised and *advanced* (a normal slot roll costs one extra sim, a cold start
  rebuilds the window). **`computeStandings` walks the identical chain**, so the table
  and the broadcast can never disagree about who was playing. A depleted club **calls up**
  from the reserve — the slack between the player pool and `clubs × 6`, which is why the
  pool should run comfortably past the minimum — and a club can never ice fewer than six;
  with the reserve exhausted the injured man plays hurt. Tuned to hold the league at
  **~13% unavailable** (peak 21 of 96, reserve never dry): at the first pass, 40% of the
  league was hurt at once, which makes "their best man is out" meaningless. Deaths reset
  with the season when the chain re-anchors — which is exactly right for a league whose
  own lore says there are no records and no office to keep them.
- **Intermissions.** Between periods the broadcast reads the period back: scoring
  summary, shot clock, penalties, casualties. Every number is counted from beats already
  aired, so an intermission can't disagree with the game. **No intermission in overtime.**
- **Every play is called, in short lines.** Every shot, draw, hit, fight and casualty
  reaches the air, as lines that follow the play the way the rink shows it: the rush touch
  by touch (`rushNames` on the beat says who each carrier index is), the release, the
  save, the draw and who won it, each punch, the hit as it lands. The `pbp.*` pools hold
  them, and 80% are eight words or fewer, so a screen reader finishes one before the next
  arrives. The longer pools ride along as colour. A game generates about 1,150 lines and airs about 1,000 in an hour slot.
- **What the rink shows after the play is called too.** The drop of every draw, where a
  saved puck went (held, kicked to the corner, loose in the slot, rattled off the post),
  the lamp, the scorer wheeling away, the pile-on and the goalie's slump, the glass a hit
  bends or breaks, a helmet off, a stick loose, a man who stays down, the fighters
  tying up and going to the box, teammates round an injured man, the stretcher, the
  goalie heading for the bench, the Zamboni coming on. Where the rink would otherwise
  roll its own dice the narrator decides and the payload carries it (`shatter`,
  `helmetOff` on a hit, `helmets` in a fight), so the line that says the glass went is the
  hit the rink breaks it on.
- **A line holds as long as it takes to hear.** Other sports give every line the same
  hold. Hockey sets `paceCalls` on its module, and the assembler hands it the game's lines
  instead ([hockey-pacing.js](../plugins/broadcast/sports/hockey-pacing.js)): 95 ms a
  character over a short floor, the read-aloud voice's own pace, then scaled to fill 85%
  of the slot, no tighter than 0.8 (about 76 ms a character). A slot that can't fit the
  game cuts lines the narrator marked optional: colour first (`opt: 'colour'`), then
  optional calls of the play (`opt: true`), longest first within each, and as a last
  resort compresses the holds. The line carrying a payload is never cut. An hour on the
  default clock cuts none in most games and a handful of colour lines in the busiest.
- **The picture moves when the words do.** The narrator tags a line with the moment of
  play it describes (`cue`: a touch, the release, the drop and the won draw, the impact,
  the clinch, a punch, the walk to the box, the medics). The pacer turns those into `cues` on the payload, in ms from the start of the
  payload's line, and the director does each thing as its line airs. A rush plays only
  the touches the booth calls, and one running behind its lines catches up rather than
  letting the words get ahead.

### The CPhL's clubs (as built)

Eight clubs, every one a neighbourhood side. None is named for or tied to an order or a
corp ([systems-ideologies.md](systems-ideologies.md), [systems-corps.md](systems-corps.md)),
which is why the Longwatch Goons became the District 9 Goons and the Government Whips and
Civic Center Wardens went.

| Club | Home | Colours | Crest |
|---|---|---|---|
| Westside Warlords | the Glasshouse | black and gold | a W of two bazookas and two rifles inside a gem-set bezel; the same stones run along the sweater stripe |
| Boomtown Bulldogs | the Rust Quarter | orange and black | a scowling bulldog with heavy jowls and a bone in its jaws, bursting out of a rusted cog, chain collar, dog tags stamped RC |
| Marquee Marauders | the Marquee | navy and white | a great helm with a plume on a heater shield |
| Coldwater Highlanders | the Marrow | the Malcolm tartan | a roaring ginger highlander in the Malcolm kilt and sash, woad on half his face, stick raised overhead like a claymore, on a tartan ring |
| District 9 Goons | District 9 | bruise purple and bone | a taped, bloodied fist in an octagon, D9 in marker on the tape |
| Docks Boarders | the Docks | teal and navy | an anchor over crossed sticks in a rope ring |
| Ashway Zambonis | the Ashway | ash grey and hi-vis lime | an ice resurfacer laying fresh ice, on a haul-road plate |
| Yards Icehaulers | the Yards | maroon and steel | ice tongs biting a block, on a hexagon |

The Highlanders' tartan is the Malcolm sett as W. & A. Smith recorded it in 1850
(`K/4 Y4 K4 G24 K24 DB24 R4 DB4 R4 DB24 K24 G24 K4 LB/4`, 344 threads), transcribed from
the Tartan Dictionary and not yet checked against the Scottish Register of Tartans.

**Where it lives.** The look of a club is content: `sports_pools.clubs` on the Cluster Puck
broadcast row, keyed by club name, holding `district`, `home`, `colours`, `crest`,
`kit.home`, `kit.road`, and `sett` or `gems` where a club has them. Its authoring source
is [scripts/content/build-cphl-clubs.mjs](../scripts/content/build-cphl-clubs.mjs), which
builds the crests from rules (the bezel's 24 stones, the chain's links, a weapon laid
along a stroke) and writes `clubs` into the row and nothing else. Run it after editing a
club; `--check` fails if the row is behind the script. `build-cluster-puck.mjs` carries
`clubs` across when it rebuilds the row from the `.bsm`.

The client side is engine: [club-crest.js](../client/game/js/panels/club-crest.js) knows
no club. It keeps the set the server sent, draws a crest from layered paths as inline SVG
(`crestSvg`) or onto a canvas (`paintCrest`, Path2D), and weaves a sett from its ticket.
A crest is `{ box: 100, layers, small }`: `small` is a simpler drawing used under 34px,
because the full one turns to mush in a score bug. A layer's fill can be `'sett'`.

**How it reaches a viewer.** Payloads never carry the set. Every hockey score bug and
gameday payload carries `clubsRev`, a short stamp of it (`clubsRevOf`). A client without
that revision sends `tv_clubs` once; the plugin answers with `{ type: 'tv_clubs', sport,
rev, clubs }` (about 50 KB), and the client keeps it in memory and in `localStorage` for
the next visit.

**Where the look shows.** Score bug and both standings tables (crest beside the name),
the matchup, rivalry, Cup, goal and fight cards, Rinkside's header, jumbotron cards,
intermission board and fight HUD. `kitFor` in `director.js` dresses a side in its club's
authored kit (home at home, road away). GLASS 2's jersey atlas paints the kit's hem bands,
yoke, crest (the small drawing), number colours, the Warlords' gem row and the
Highlanders' tartan body; `arena-mesh.js` takes the kit's sleeve and sock bands; the 2-D
`figure.js` takes the bands, number colours and crest decal. Centre ice still carries the
CPhL mark.

### Leagues (`sportsleague`)

One season **per sport**. `sports_season` carries a `sport` column with a
`(sport, season_no)` key, so both leagues number their own seasons from 1. Standings stay
a **zero-write computed fold** over the deterministic schedule, but *what* a game folds
into belongs to the sport module (`SEASON` in `sports/<name>.js`):

| | Deadball | Cluster Puck |
| --- | --- | --- |
| Table | W · L · PCT · RDIF | W · L · **OTL** · **PTS** · GD |
| Points | — | 2 for a win, **1 for losing past sixty** |
| Extras | — | scoring race + season casualty/death count |
| Final | World Series (`worldseries`) | **Coldwater Cup** (`cup`) |

A postseason takeover applies **only to its own sport** (`overrideFor(script)`) —
handing the World Series' finalists to the hockey sim would put two ballclubs on the ice.

### The rink sub-screen (Rinkside, as built)

[client/game/js/panels/gameday-rink.js](../client/game/js/panels/gameday-rink.js) is the
CPhL sub-screen. It keeps the Deadball view's interface (`apply`, `clear`, `setCaption`,
`showIdle`, `showCard`), so tv.js picks a view by sport and nothing else changes. The file
is the shell: the header, the strip, the caption, the jumbotron cards, the intermission
board, the sound mapping and the frame loop. The work is in `client/game/js/panels/rink/`:

| File | What it holds |
|---|---|
| `geo.js` | The sheet in feet: 200 by 85, goal lines at 11 and 189, blue lines, dots, boards as segments, 24 far glass panels. `GEO` and `DOTS` in model units for the broadcast regress. |
| `sim.js` | The world, stepped at 120 Hz: skaters, goalies, officials, medics, the puck, debris, severed limbs, particles, the glass, the Zamboni. Between beats it plays cosmetic hockey. |
| `director.js` | One payload in, choreography out. `SAVE` and `kitFor` live here. |
| `camera.js` | The broadcast camera both renderers draw through: its modes, the easing, the projection `P`, and `matrices()`, the same camera as GL matrices. |
| `render.js` | The 2-D renderer: Mode-7 ice, the bowl, the boards, the reflections, the overlays. The fallback when there's no WebGL2. |
| `hud.js` | What both renderers share besides the camera: the officials' and medics' kits, `bodyOpts`, the fight pips, the banner and the REPLAY bug. |
| `replay.js` | The instant replay: the last ten seconds of what the renderers draw, and the stand-in world they draw from while it plays. |
| `rig.js` | The 21-joint skeleton: skating strides, shots, passes, dekes, checks, punches, goalie saves, ragdolls, the stick solver. |
| `figure.js` | Bodies drawn as volumes: tapered limbs, a padded torso, kit, cage or visor, gloves, skates, blood. |
| `textures.js` | The ice canvas and everything painted into it, the dasherboard ads and the crowd. |
| `../gl/arena.js` | The GLASS 2 renderer (WebGL2), the one the view prefers. See *Two renderers* below. |
| `../gl/arena-mesh.js` | Bodies, nets, the Zamboni, the puck, debris and limbs as triangles, built each frame from the joints. Pure, so the smoke gate runs it in node. |

**Frames.** The sim's payloads speak fractions of the sheet (`x` along it, `y` across it);
`geo.js` converts to feet once. `y = 0` is the camera side. The away club attacks `+x`
every period, which is how `synthPossession` writes its keyframes, and a goal's last
keyframe (`x` ≈ 0.955) lies past `GEO.goalLine[1]`, which the broadcast regress asserts.

**Nothing on the ice decides anything.** The sim on the server decided every shot, save,
hit, fight and injury before the broadcast began. Between beats the world plays hockey on
its own (carries, cycles, passes, dekes, dump-ins, rub-outs, a goalie playing it to his
defence), and that hockey never shoots. A net lets a puck in only through its mouth and
only while `W.allowGoal` names it, which the director sets for a goal and nothing else.

**What the director stages.** Each payload type has a stager. Each one takes the men and
the puck it needs, walks them through the beat and hands them back to the ambient play.

- *Chances and goals* play the possession keyframes: carries, passes to the man who carries
  the next touch, battles and dump-ins chased down, dekes past a man standing the carrier
  up. With cues on the payload each called touch happens as its line airs; without them a
  rush starts late when the whole chain would run past about five seconds. The shot is the sim's `shotType` with its own
  wind-up; a one-timer and a tip are fed by a teammate. Where the puck goes comes from the
  outcome: into the net for a goal, into the glove, the chest, the pad, off the post, wide,
  into a defender who drops to block it, or poked off the stick on a breakaway.
- *Faceoffs* line both sides up on the named dot, put the two named centres on it, and
  have the linesman drop the puck. The winner draws it back to his defence.
- *Boards hits* happen on the far wall, where the glass is in shot, in the sim's
  `hitStyle`: shoulder, glass (which can break a pane), from behind, hip check, elbow.
  The man hit becomes a ragdoll, so where and how hard he meets the boards decides how he
  falls. A man who is hurt stays down, with play stopped, until the injury beat comes.
- *Injuries* bring two medics out with a stretcher. A severed limb comes off at the hit.
- *Fights* drop the gloves on the ice, cut to a side-on close-up with a health bar per
  man, and throw the sim's exchange punch for punch. The ending is the sim's: a
  knockdown, the sweater over the head, or the linesmen. Both men skate to the box and the
  spare comes on.
- *A death* drains the colour out of the picture, silences the crowd, pushes the camera in
  slowly, and the players take their helmets off.
- *Scrums*, *the pulled goalie* (he skates to the bench and a sixth skater comes on) and
  *the intermission* (everyone off, the Zamboni on) each have their own.

`onLand` fires the moment the play lands and is when a held caption and any held card go
up. A payload with cues is the first line of a play called as it happens, so its line is
never held. A walk to the box or a stretcher on its way off outlives the beat that started it;
a camera cut finishes it on the spot, since nobody sees the jump. Names go on bodies the
first time a payload mentions them, and the number comes from the name, so every viewer
sees the same sweater. The home club wears its colour and the road club wears white with
its colour as trim, which keeps two dark clubs apart.

**The puck never jumps to a stick.** Possession only passes within reach of the blade
(3 ft). `W.give(b)` on a puck farther off than that calls `W.collect(b)` instead: with
`drive`, a scripted man skates to it (easing up so he meets it rather than overruns it)
and it's swept in over the last few feet; without, it slides to his blade like a pass,
never faster than 55 ft/s. A pass that misses its man is collected the same way, a man
moved away from his own puck loses it to a collect, and the carry leash, the skate
keep-out and the goalie's catch are all speed-capped. Only a caller that has just moved
the puck under a camera cut passes `force`. The director plays nothing in a rush until
the man it needs actually has the puck (a `fetch` leg), a dump is aimed at the next touch
and bleeds speed to settle there (`W.settleAt`), the nearest teammate chases it, and a
missed goal is steered in through the mouth rather than placed in the net. The booth
covers the time: a rush off a loose puck opens with `pbp.retrieve` (the breakout follows
on the `fetched` cue), and a dump or battle is followed by `pbp.chase`. The rink smoke
fails on any visible step of the puck over 1.6 ft outside a cut and any gain from beyond
reach.

**Positions and plays.** Between beats, and around whoever the director is scripting, the
men play their positions (`assignRoles` and `systemSpot` in sim.js). On the rush the
wingers are wide in their lanes and stay onside, the centre supports through the middle,
and the D trail. In the zone the D hold the points (a D carrying it walks the line), one
forward goes to the net, the nearest supports low and the third sits in the high slot. In
their own end the strong-side D takes the corner, the other holds the front of the net, the
centre covers low and the wingers take the points; through the neutral zone it's a 1-2-2.
Passing follows the zone: back to the points, D to D and low to high in the zone, the
stretch pass to a winger through the middle. A drop pass is only for a man right behind;
farther back the pass is played firmly. In a scripted rush, a touch goes to the man in that
slot unless he's out of the play (40 ft off), when the nearest teammate takes it and the
name the booth gives it. The booth calls up to five touches of a near-miss or a goal and
three of a routine chance, so the build-up is on air as well as on the ice.

**Breakaways.** A breakaway chance, or a goal the narrator stages as one (`gd.breakaway`,
about one even-strength goal in five), gets `pbp.breakaway` ("He's in alone!") on an
`alone` cue. On it the rink puts up a BREAKAWAY banner with the shooter's name, moves the
camera in (`W.cam.drama`), and has the nearest two defenders chase from behind and lose
ground.

**Instant replay.** [replay.js](../client/game/js/panels/rink/replay.js) keeps the last ten
seconds of what the renderers draw, thirty times a second: every man's joints and kit,
the puck and its tail, the loose gear, the lamp. It keeps nothing of the sim, so a replay
can't change anything; the world plays on underneath it. On a goal the booth says
`pbp.replay.start` ("Let's see that again.") on a `replay` cue, then walks through it
(`pbp.replay.assist` or `.solo`, `.shot`, `.goalie`). On the cue the director runs the five
seconds before the goal and a moment after at half speed. The renderers draw the replay's
stand-in world, interpolated between frames, through a camera of their own at ice level
(`replay` mode), letterboxed with a REPLAY bug. It ends on its own or when the next play
comes in, and cuts back to live. The rink smoke checks every goal's replay starts, plays
sound frames, draws and hands back.

**Motion.** A skater leans into acceleration and sits back under braking (`b.accel`), and a
hard stop at speed turns him side-on into a proper hockey stop. Up close (GLASS 2's
`detail`) a man has gauntlet gloves with finger rolls and a thumb, a ridged helmet with ear
guards and a chin strap, shoulder caps and elbow pads under the sweater, a stripe down the
pants, a tongue and tendon guard on the skates, a curved blade, and a shoulder yoke on the
jersey; a goalie has a trapper.

**A shot leaves a tail.** `W.shoot(from, tgt, spd, type)` starts `pk.tail`: the puck's
last fifth of a second of flight, faded by speed. Both renderers draw it as a faint slate
streak (a white one vanishes on the ice), strongest at the puck and strongest of all on a
snap shot (`TAIL` in sim.js: snap 1, slap 0.75, one-timer 0.7, wrist 0.5).

**The camera never yaws or rolls.** It pans, climbs, tilts and zooms, so every screen row
is a line of constant depth across the sheet and the whole ice texture maps to the screen
with one `drawImage` per row. It lives in `camera.js` so both renderers frame a shot the
same way; `matrices()` writes it out by hand for GL, mirror included.

**The broadcast framing is NHL 99's.** High on the near side and close (44 ft back, 38 on
a breakaway, so the players are big), panning with the puck and leading it well ahead the
way it's going (three quarters of a second of its travel, up to 28 ft). When
the play is within about 60 ft of a goal line, or the director says a shot is coming
(`W.cam.net`, set when a rush reaches its shot leg and cleared when the beat ends), the
camera widens and slides until that net is in frame with the puck. That framing is solved,
not guessed: given the points that must be seen (the action, and the net when it matters),
it slides across the ice and pulls back, up to 140 ft for a shot from centre, until every
one projects inside the picture for the screen's own aspect ratio. Every number follows
its target on a critically damped spring, on real time (`camera.update(w, h, now)`), so it
starts and stops without a jolt and keeps moving through a hit-stop. The rail view widens
its lens for a net in its zone and rises to the broadcast framing whenever a shot is
coming. The rink smoke runs its own camera at 60 Hz in both views and fails if any shot is
released, or arrives, with its net or the puck out of frame; the old camera missed the net
on about 300 shots a game.

Player motion is eased too: a skater turns into a new heading rather than stopping dead
on it, two men who bump are eased apart over a few steps with their closing speed taken
off, and a man pushed out of a net slides out. Fighters skate in to square up unless
there's a cut. The view steps frames that arrive within 4 ms of the running average as
the average, so vsync jitter doesn't make the 120 Hz world alternate one step and three. Its modes are broadcast, zoom, push (a goal), fight, death,
and a framing that follows the Zamboni. `renderer.view = 'low'` puts it on the rail just
inside the near glass at head height, which is where the reflections show best.

**The ice keeps the game.** It is one canvas, and things are painted into it as they
happen: every skate stroke traced from where the blade actually is, a fan of snow at each
hard stop, rubber where the puck hits the wall, blood, smears where a body or a limb slid.
`ice.wear` climbs as the sheet is cut up. The renderer reflects the whole scene through a
mirrored camera into a half-size canvas, which softens it, and fresh ice gives back much
more of it than a worn sheet does, so the reflections dull over a period. The dasher ads
hang upside down in the ice too.

**Two renderers.** The view tries [gl/arena.js](../client/game/js/panels/gl/arena.js) first
and falls back to `render.js` when there's no WebGL2, a shader won't build, the context is
lost (the canvas is swapped for a fresh one and the 2-D renderer carries on), or the caller
passes `renderer: '2d'`. The 2-D renderer paints each man as a few hundred gradient paths,
twice with his reflection, and dropped frames on big hits. The arena draws the same world as
lit triangles with a depth buffer:

- Bodies are meshes from `arena-mesh.js`, rebuilt every frame from the 21 joints with
  `figure.js`'s proportions: about 1,000 triangles for a man at broadcast distance and
  2,000 close up, where the cage bars, eyes and blade tape come in. Each jersey is a slot
  in one 1024² atlas (number and name on the back, crest, hem stripes, blood), painted once
  per kit, number, name and blood level.
- The ice is the same painted canvas, kept as a texture. `textures.js` lists the 125-texel
  tiles each mark touches (`ice.dirty`), and the arena re-uploads only those.
- The reflection is the boards, the props and the men drawn again through `matrices(C,
  true)` into [gl/mirror.js](../client/game/js/panels/gl/mirror.js)'s half-size target. The
  ice shader reads it back at its own screen position, stronger at grazing angles and on
  wet ice, and works out the five light banks' highlights per pixel, so they streak towards
  the camera the way they do on television.
- The lamp, its red wash, the vignette, a death's darkening and the cut's flash are one
  full-screen pass. Mourning desaturates in every shader. The HUD text is a 2-D canvas
  (`.gdr-hud`) over the WebGL one, cleared and left alone while there's no HUD.

The frame governor in `gameday-rink.js` steps through the renderer's own `rungs`: for the
arena, resolution, then the mirror's size, then the men in the reflection.

The Zamboni laps the sheet inside the boards, each lap a strip further in, then runs down
the middle. Its conditioner paints a clean copy of the sheet back over its strip, so the
lines and logos survive, and leaves a wet mask the renderer draws as darker, glossier ice
that freezes off over about forty seconds. The next period starts on a fresh sheet
whatever the Zamboni got through.

**Things that trip people up.**

- `W.script` belongs to the director. Ambient hockey stands down while `W.puckScripted`
  or `W.frozen` is set.
- Kit colours must be hex. `figure.js` shades them with `parseInt`. That holds for a club's
  authored kit and its bands too.
- Anything that moves a man farther than he could skate should cut the camera, and a cut
  finishes every outstanding walk-off and stretcher.
- Cosmetic randomness is seeded from the payload. A `rand()` call added to the sim to
  decorate a beat replays the whole season with different results.
- The heavy modules (`textures.js`, `render.js`, `gl/arena.js`) load on first mount, so
  tv.js's import of the view stays cheap.
- A new kind of mark painted into the ice has to `touch` its tiles, or the GL sheet goes
  stale while the 2-D one is right. `arena-smoke.mjs` checks each kind.
- Don't upload a canvas sub-rectangle with `UNPACK_SKIP_PIXELS`/`ROWS`. It's in the WebGL2
  spec, and headless Chromium on SwiftShader ignores the skips: every tile arrived as the
  sheet's top-left corner. The arena copies a tile into a small canvas first.
- Don't clip twice in `resurface`. The rink's rounded clip intersected with the strip's made
  Chromium erase the whole sheet, on both renderers. The clean copy is transparent outside
  the boards, so the strip's clip alone is enough.
- The reflection leaves the crowd out, treads included: dim stands under a lit sheet read
  as stripes, not as a reflection.
- The arena draws with no face culling. The mesh builders don't keep one winding, and the
  lit shader lights whichever side faces the eye.

**The booth calls the rush.** `describeRush` in [hockey.js](../plugins/broadcast/sports/hockey.js)
reads the possession keyframes into one sentence, which rides the payload as `rush` and
shows as a quiet strip under the score line. The spoken call is now the touch-by-touch
lines above, read off the same keyframes and names, so neither can disagree with the
picture.

**Nothing calls a goal before it goes in.** A goal's beat carries the score after the
goal, so the narrator gives the rush and shot lines a bug with the score before it
(`scoreBefore`, also on the payload). The rink header shows that score and the strip reads
LIVE until the director lands the play (`onLand`); then the header takes the goal and the
strip names the result. Both smoke and regress check it.

Branding lives in [cphl-brand.js](../client/game/js/panels/cphl-brand.js): one mark, drawn
by the score bug, the full-screen graphics, the rink header, the idle screen and the
Gameday toggle itself, which wears a puck on a hockey night and a baseball otherwise
(`_brandGamedayBtn` in tv.js).

[scripts/shapes/rink-smoke.mjs](../scripts/shapes/rink-smoke.mjs) runs in `pretest:regress`, as two gates, one game each (`rink-smoke.mjs 206` and `rink-smoke.mjs 25`), side by side; run bare, it plays both.
It plays two real games (the sim and the narrator, slots 206 and 25, which between them
emit every beat type) through the view over a hand-cranked DOM, clock and canvas
([rink-dom-stub.mjs](../scripts/shapes/rink-dom-stub.mjs)). It checks that every beat
resolves, every goal goes in and no save does, the faceoff is taken on the named dot by
the named centres, a fight's loser ends with nothing left, a man carried off is gone, a
death stops the building, the pulled goalie leaves an empty net and a sixth skater, the
Zamboni lays wet ice and the next period starts on a fresh sheet. It proves the view runs
and agrees with the sim, not that it looks right. The stub has no WebGL, so it drives the
2-D renderer.

[scripts/shapes/arena-smoke.mjs](../scripts/shapes/arena-smoke.mjs) covers what the arena
stands on without a GPU. `matrices()` matches `P` to a hundredth of a pixel in every camera
mode, both views and two screen shapes, and so does the mirror against `P(x, y, -z)`. Every
body state (ragdoll, missing an arm, a leg or the head, gloves or helmet off, jersey over the
head, visor) builds finite and inside its triangle budget, along with limbs, debris, nets,
the Zamboni and the stretcher. Each kind of ice mark lists its tile. With no WebGL2,
`createArenaRenderer` returns null rather than throwing.

### Sound banks

`sfx-catalog.js` folds in **banks**: a separate file authoring a themed preset set in the
catalog's own shape (`client/shared/hockey-sfx.js`, 29 CPhL presets under group `hockey`).
Folding them in is what makes them dev-panel editable and `interface_sfx`-overridable.
**Load-order contract: a bank's `<script>` must come BEFORE `sfx-catalog.js`** in both
`client/game/index.html` and `client/devpanel/index.html` — otherwise the bank still
plays but the dev panel can't see it.

### Reading the league from outside (`broadcast.getNextOnAir`)

Two read Actions serve anything that wants league data without touching the sim:
`broadcast.getTeamCard` (a club's form + when they're next on) and
**`broadcast.getNextOnAir`** — *the one game the schedule puts on next*, optionally
narrowed by `{ sport }` or `{ team }`. It walks forward from the current slot over
every channel's sports playlist items, clearing **both** gates a real airing clears
(the script's `airSlots` hour **and** the item's day mask, with day-of-week advanced
per slot), and returns the first match. Query-free — grids, season and clock are all
in memory — and only the matching slot is ever simulated, which is what makes it
safe on the tablet's home screen (the Sports home widget is its only consumer).

**Both obey the spoiler rule, and it is the load-bearing constraint here.** Every
game is a pure function of its slot, so a future fixture's final score is already
computable. An upcoming game therefore returns matchup + airtime with `awayScore`/
`homeScore` **null**; a game currently on air returns the score *as far as the
play-by-play has been called* (indexed off the same shared clock the graph walker
seeks by, over `SPORTS_GAME_FILL` of the slot); past that point it's `FINAL`. If you
add another consumer, keep this — the whole sports system exists to make watching
the broadcast worth doing.

### Rebuilding the show from its script

`data/scripts/hockey.bsm` is the source of the show. `node scripts/content/build-cluster-puck.mjs`
recompiles it into the broadcast, graphic and playlist rows under `content/`, so the file
in git and the shipped row can't drift. The one thing it can't do — handing Deadball's two
nights back — is `scripts/cluster-puck-schedule.mjs`, an idempotent one-shot per database.

---

## Studio Audience Door

A channel with a `studio_zone_id` is a room players can walk into, and while one of the
**acted** modes (`talkshow` / `gameshow` / `morning`) is airing, that room is a set with a
house in it. [plugins/broadcast/audience.js](../plugins/broadcast/audience.js) ticketizes it.

**The gate is a person, not a law.** It's a `registerMoveGate` (`broadcast:audience-door`)
that only bites when an NPC carrying `flags.audience_door` is standing on the tile *outside*
the studio, alive, and on shift (**08:00–02:00**). Dead, absent, or off-shift ⇒ no check at
all. That's the designed out, not a hole. It also only fires on the way in from outside
(`from.map_id !== to.map_id`), so moving between the studio's own interior rooms is free.

**A pass is a dated document.** The playlist has no day-of-week, so the date rides on the
ticket instead of the schedule. The box office stamps `player_inventory.custom_data.show_pass`
= `{ channel, broadcast, name, slot, date, time }`, where `slot` is the **absolute** airtime
index (in-game day × `SPORTS_GAMES_PER_DAY` + block) and is therefore self-dating. The doorman
admits you iff `show_pass.slot === sportsSlotIndex()`. Yesterday's pass is a souvenir, and he
says so. The pass is **not consumed** — step out and the same one walks you back in until the
showing ends.

**Off air there is no house.** With nothing acted airing, the doorman turns everyone away and
the box office sells for the **next** taping rather than the current one.

Selling is the engine seam `registerPurchaseStamp(itemId, fn)` in
[server/engine/vendor.js](../server/engine/vendor.js) — a per-purchase sibling of the static
`flags.prefill`. The stamper runs before credits move (so a refusal is free), returns a
`custom_data` bag or a string to refuse the sale with, and may carry a `_line` for the receipt.
A stamped unit **never** merges into an existing stack; `show_pass` is registered in
`INSTANCE_KEYS` + `NOT_INSTANCED_SQL` so pickUp/give/drop honour that too — two passes to two
different nights must never collapse into one row carrying the wrong date.

As built at KSAB-TV: **Orsino Tull** (`npc_ksab_doorman`) on the facade `zone_district_913_911`,
**Dovie Deeb** (`npc_ksab_boxoffice`) selling `item_holo_ticket` at 25₵ from the same tile.

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

### The audience — NPCs reacting to what's on (as built)

Two separate things, deliberately, because they answer different questions.

**The beat that just aired** is the `tv-reactions` plugin ([README](../plugins/tv-reactions/README.md)).
`broadcastTick()` has always emitted `broadcast.message` for every beat it puts into every room
with a tuned device; nothing consumed it until now. The emit carries `programName`, `stationName`,
`mode` (the item's `playback_mode`) and `style` alongside the text, so a subscriber can tell a ball
game from a sermon without re-deriving the schedule — and would otherwise have to look the channel
back up, by which time the next beat could already have replaced it. The studio-floor emit is
flagged `onStage`, because in there the cast are *saying* the lines rather than watching them.

**What's on generally** is a banter token. `getTopicContext()` in
[npc-banter.js](../server/engine/npc-banter.js) now resolves `{tv_program}`, `{tv_station}` and
`{tv_channel}` for the zone a scene is starting in, alongside the weather and sports tokens that
were already there. **They are unset in a room with no set on**, which is most rooms — so the
existing "a thread whose token has no value is skipped in favour of a plain one" rule means an
authored thread about the programme can only ever air in front of a screen. Nothing new was needed
to make that true.

The engine reaches this through the **`broadcast.getZoneNowPlaying`** action rather than an import,
since npc-banter is engine and must not reach into a plugin. The action returns the same shape as
the `getZoneNowPlaying()` export, which now also carries `mode` and `lastLine`.

`state.currentPlaybackMode` is the field behind `mode`. It is set wherever the tick selects a
playlist item (the daily-schedule path and the sequential loop), set to `'commercial'` on a
commercial break, and cleared everywhere `state.currentProgramName` is cleared. A news *channel*
has no playlist item at all, so it falls back to its `channel_type`; that is the one case where
the two agree by definition.

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

**On air outranks the timetable.** `isNpcScheduledNow` is the *only* thing keeping an actor on set — `ai-behaviour.js` walks a studio NPC out of the building the first tick it reads false, before their own graph runs — so any moment the schedule says "off" is a cast member leaving mid-sentence, and the channel then tells viewers it has lost the studio floor. The answer therefore begins with the fact that outranks every window: **if the runner is currently putting a programme on air, everyone that programme anchors is working.** `tickBroadcastGraph` stamps the on-air cast (`_stampOnAirCast`, read off the graph's own `npc_anchor` nodes) on the channel state each tick, and the shift checker consults it first. The stamp expires after `ON_AIR_CAST_HOLD_MS` because the runner only ticks while somebody is watching — an unobserved channel has to let its cast go home rather than pinning them to the set. This subsumes the talk show's straddle grace (`talkshowCastTailMin`), which stays as the belt to this braces: every acted mode straddles its slot boundary the same way, and only the talk show had a fix.

### NPC Work Scheduling (`recalculateNpcSchedules`)

Broadcasts declare their on-screen hosts through `npc_anchor` nodes in their VINE graph — **except the assembled modes, whose stored graph is start-only and whose cast therefore comes from the pools instead**: `talkshow_pools` (host + sidekick + guest), `morning_pools` (host + cohost), `gameshow_pools` (host + sidekick) and `weather_pools` (**host**). A mode missing from that list is a structural, permanent no-show, and it is silent: `assembleWeatherGraph` still emits an `npc_anchor` and still stamps `_requireHost`, so the forecast was presence-gated on a caster who had no `work_zone_id`, no studio graph and no reason to ever walk in — and the self-heal pass at the bottom actively reverted any hand-patch. **Add the pool to the derivation in the same change that adds the mode.**

`recalculateNpcSchedules()` walks every scheduled broadcast, derives that set of NPCs, and:

- merges them into the playlist item's `conditions.npc_staff` (also surfaced at runtime as `runtime.playlist[].npcStaff`, populated in `loadChannelRuntimes`);
- overwrites each host NPC's `behaviour_graph` with `makeDefaultStudioGraph(studioZoneId)` and sets its `work_zone_id` to the channel's studio zone, so the NPC's `GO_TO_WORK` behaviour resolves to the studio and it shows up when its slot is on air.

It runs automatically **at plugin boot**, on **every** playlist save (`PUT /broadcast/channels/:id/playlist`), and on demand via `POST /broadcast/recalculate-schedules`. The `studio_zone_id` (channel) and `work_zone_id`/`studio_zone_id` (npc) columns are the wiring this depends on.

**Staffing is derived, so it is derived at boot.** `conditions.npc_staff` is the only thing that puts a cast member on the clock, and the content pipeline does not own that key — every playlist row in `content/` ships `conditions: []`. Without a boot pass, a database seeded from git had **no staffing at all**: nobody was ever on shift, nobody commuted, and every acted show sat on a stand-by card until a human clicked *Recalculate Schedules* in the dev panel. The boot call is converging (it writes only rows whose staffing changed), ends by reloading the channel runtimes, and is wrapped in a `try` — a plugin that can't staff its studios must still put pictures out. `scanChannelDay` now also reports `no_staff` / `staff_unreachable` / `staff_home_missing`, so an acted slot with no cast, or a cast member with no walkable route from `home_zone` to the studio, shows up in Channel Check instead of looking like a dead transmitter.

<a id="npc-hosts--studio-staffing"></a>
**Call time, not airtime.** A staff NPC comes on shift **before** their slot opens, because the walk
to the studio is real: the commute moves a few tiles per 15-second AI tick, and the KSAB cast sleep in
Solenne and Meridian apartments 15–25 tiles away. Reporting for duty at the instant the slot opened
guaranteed an empty couch and a **"has not yet arrived"** stand-by card over the top of every
programme — a structural no-show, not bad luck.

- **Daily slots** (`_staffCallSlot`): a staff NPC is also on shift during the run-up to their next
  slot. The lead is `STAFF_CALL_LEAD_REAL_MIN` **real** minutes converted to in-game seconds at read
  time (`_staffCallLeadGameSec`) — the walk is real while the schedule is in-game, so a fixed in-game
  lead would shrink as the clock sped up. The window wraps midnight, checks the day mask against the
  day the slot **opens** on (so a Friday-only show doesn't commute its cast on Thursday), and skips
  commercial breaks, which have no cast.
- **Talk shows** keep their own slot-granular lead (`TALKSHOW_GUEST_CALL_LEAD`), now applied to the
  **whole cast** rather than the guest alone. See [bsm-format.md](bsm-format.md#the-chair-gate).
- **The sleep wake-up is in the same currency.** `getNextShiftWakeMs` wakes a vendor one *game* hour
  before their counter shift, which is right for a shop's opening time and wrong for an air call: the
  call lead is booked in *real* minutes because the walk is real. At any brisk `timeScale` a flat 60
  game minutes is fewer real minutes than the lead itself, so a host woke up already late. The air
  branch converts its real lead at the live clock and takes whichever is longer — it can only ever
  wake somebody earlier, never later.
- **`GO_TO_STUDIO` is `GO_TO_WORK` with the studio preferred**, one case falling through to the other
  in `ai-behaviour.js`. It used to be a separate hand-rolled walker at a quarter of the pace, with no
  late-arrival catch-up and no blocked-commute warning — offered to authors in the VINE editor right
  next to the good one, with nothing to say which was which.

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
**Emergency Broadcast System** verbs (`ebs`, `airemergency`, `endemergency`, below) — see the
broadcast row in [docs/plugins.md](plugins.md) for what each does.

---

## Media Deck & Cassettes

Implemented in `plugins/broadcast/index.js` (search `Media Deck`).

- A media deck is `furniture` with `flags.media_deck = true`, `flags.channel_id`, `flags.deck_cassettes` (array of `broadcast_id`s in its library), and `flags.deck_active` (the currently-loaded `broadcast_id`, or `null`).
- While a deck has `deck_active` set, its messages **override** the linked channel's own programming for any zone-tuned viewers (`_getDeckMessage()` takes priority over `getCurrentMessage()` in `broadcastTick()`). Ejecting clears `deck_active` and removes that broadcast from `deck_cassettes`, so the deck goes idle and the channel falls through to its own programming — if the channel has nothing else scheduled, `broadcastTick()`'s existing off-air logic kicks in and viewers see static / the channel's offline graphic, exactly as it would for any other no-content channel state. A deck-message lookup cache (`_deckCache`, 10s TTL) is explicitly invalidated on load/eject so this transition isn't delayed by the cache.
- Cassette items are `items` rows with a deterministic id `item_cassette_<showname>` (broadcast name, slugified) and `tags.media_cassette = true` / `tags.broadcast_id`. The same id convention is used both by the dev-panel BSM import flow (`POST /broadcast/cassette`) and by `eject`, so the two paths always converge on one item definition per broadcast rather than creating duplicates. Only one cassette can exist per broadcast — if a *different* broadcast's name slugifies to the same id, `_ensureCassetteItem` throws (`CASSETTE_NAME_COLLISION`) instead of overwriting; `POST /broadcast/cassette` returns `409` and `eject`'s fallback-create path returns an in-game error.
- The media deck panel (`client/game/js/panels/mediadeck.js`, markup in `client/game/index.html`) shows a cartridge "slot" that slides a cartridge graphic into view when a cassette is active, a scrollable library list (click a row to `selectcassette`), a read-only schedule preview, and a LOAD / EJECT button row (LOAD sends `load cassette`, EJECT sends `eject`).


### Small-format players (`flags.mini_deck`) — the betamax

A **tape player** is a media deck scoped to one room and one set: a squat top-loading box
that sits on a television and plays whatever is in it, on a loop, until somebody stops it.
First example: `furn_betamax_zone_grindhouse_interior` in the Grind House.

It is **the same `object_type: 'media_deck'`**, and that is the whole design. Reusing the deck
gets `load` / `eject` / `selectcassette`, the examine panel with its LIVE/LOAD dots, and the
zone-scoped channel override for nothing — and `_playDeckItem` **already loops a flat list on
its own duration**, so "plays until stopped" required no playback code at all. `mini_deck` is
a marker for the physical thing (one tape, one receiver), not a second mechanism.

**How the television "tunes to" it: it doesn't.** `_zoneDeck(zoneId, channelId)` finds decks in
the *same zone* and prefers the one whose `flags.channel_id` matches the channel the viewer's
set is on. The set stays on its channel; the deck **substitutes what that channel shows, for
that room only**. So the linkage between player and TV is simply that both furniture rows carry
the same `channel_id` — there is no pairing table and no cable.

**Channel 0 is the VCR input** (`ch_0_vcr`, name `VCR`), exactly as every television that ever
had a tape deck under it. Tape players carry `channel_id: 'ch_0_vcr'`; **KSAB-TV on 7 is
independent**, so putting a tape on no longer hijacks the station in that room — you change
input, the way you would in life.

#### Absorbed into the set — the `tv_deck` strip

*Built.* A `mini_deck` standing under a television is **one appliance in the room's eye**, so it
is no longer a thing in the room pane at all: `attachChildren`
(`server/engine/commands/describe.js`) claims it and prints nothing, and the television's own
display carries a **reduced transport** instead — `tv_deck`, pushed by `pushTvDeck()` and drawn
by the 📼 drawer in `client/game/js/panels/tv.js`. What's loaded, the shelf, what you're
carrying, EJECT, one button that puts the set on the deck's own channel — the classic VCR
confusion, and the thing the strip most exists to fix — and, for a player who has SPECTER, the
spare input. That last one is **one verb both ways**: bare `patch` pulls the jack when a feed is
already in and otherwise answers with the player's own cameras as clickable prose, so the strip
never has to know whether they own one.

Three rules hold it up:

- **Reduced, never a second implementation.** The full chassis — schedule preview, the SPECTER
  cam input, the pirate console — stays behind `use <deck>`. The strip **decides nothing**:
  every control sends a verb string a player could have typed (`selectcassette <id> tv`,
  `load cassette <name>`, `eject`, `tune <n>`) and redraws from the server's answer. The lone
  `tv` suffix on `selectcassette` says *which surface asked*, so the answer refreshes the strip
  instead of throwing the deck chassis up over the television you're watching.
- **Absorb only where mis-attribution is impossible** — exactly one consumer deck and exactly
  one receiver in the zone, or a pinned `flags.attached_to`. `_absorbedDeckFor()` and
  `attachChildren` apply the same test, so the two surfaces can never disagree about which set
  a deck is under. Anything ambiguous keeps its old satellite row and gets no strip.
- **A STATION deck is never absorbed**, and neither is anything at the **log** Display Mode
  rung, where no TV panel opens. Seeing a transmitter deck is the entire discovery path for
  `pirate`, and absorbing a deck behind a surface that doesn't exist would strand it. Both fall
  back to the `↳` satellite row, which is what regress pins.

That required freeing `0`, which used to mean *off*. **Powering down is the power button, not a
dial position**: in `client/game/js/panels/tv.js` a **tap** closes the view and leaves the set on,
a **450 ms hold** sends `tv_poweroff` and switches it off room-wide. `_applyTuning` now takes an
explicit **`TV_OFF`** sentinel, and both `tune` and `tablettune` accept the word `off`. The two
dials are deliberately identical — a tablet standing in a room with a deck in it watches the tape
on 0 like anything else.

**Small-format cassettes** carry `tags.beta_cassette` alongside the usual `media_cassette` +
`broadcast_id`. A full-size deck reads them perfectly well; the tag exists so the little players
can refuse the big deck cassettes, which physically would not fit. It has no playback behaviour.

### The spare input: a SPECTER camera instead of a tape (`flags.deck_cam_source`)

A consumer deck has one input, and with SPECTER on your tablet it can be one of **your own
sticky cams** rather than a cassette. Patch a feed in and the set in that room shows the camera,
live, refreshed every 5 s. `patch <cam>` / `patch off`, or the **Patch →** action on a focused cam
in the tablet's SPECTER app, or the `IN` row at the top of the deck panel's library list.

- The flag is `flags.deck_cam_source = { deviceId, label, zoneId }`, and the input is
  **exclusive**: `_getDeckMessage` checks it *before* the cassette path, and loading or selecting a
  tape clears it (the tape stays in `deck_cassettes`, so pulling the jack resumes where it was).
  `_miniDeckPlayback` counts a patched cam as loaded, so the panel and the examine readout say
  `▶ PLAYING: LIVE FEED — <zone>` rather than "nothing loaded" — the set still has to be on the
  deck's channel, same rule as a tape.
- **Deliberately `mini_deck` only.** A domestic deck transmits nothing, so this puts the feed on
  *your* wall and nowhere else. Putting a spy cam on a city channel stays the piracy route
  (`pirate` → `air live`), which is a crime and should keep costing what it costs. A station deck
  refuses `patch` and says so.
- **Jam, spoof, battery and damage are not re-decided here.** The frame comes from surveillance's
  `camPatchFrame(deviceId, ownerId)`, the one sanctioned way for another plugin to turn a device id
  into a frame; a spoofed cam plays its clean empty-room lie on your TV exactly as it does in the
  hub, and a jammed one reads `▓ JAMMED`. Both that helper and `camSourcesFor(ownerId)` run off
  surveillance's 4 s device cache, and the deck memoizes the resolved frame for 4 s
  (`_camPatchCache`), so **a patched deck adds no query per tick**.
- A cam that dies for good (24 h burnout, smashed, retrieved) makes the next frame drop the patch
  itself — lazy cleanup, so nothing has to know to come and tidy up after a device.
- The cross-plugin seam is two exports on broadcast: `miniDeckHere(zoneId)` (is there a deck to
  take a feed — cache read, no query) and `patchCamToDeck(player, deviceId)` (patch/unpatch by id).
  Every gate lives in broadcast; the SPECTER app only asks.

**One fix this needed:** `canOperateDeck` now returns true for any `mini_deck`. A consumer deck is
an appliance, not a transmitter — there is no frequency to seize — and until this, a resident
could not put a tape in the machine in their own flat.

### The proprietor puts their tape back on

A deck may name `flags.deck_owner_npc` and `flags.deck_default`. Anyone can stop it or tune the
set to a real station — and while that NPC is in the room, they will put it back on the next
`tick.minute`, with a line about it. Two flags, no bespoke code per shop.

Scoped to zones that currently contain a **player**: a tape reverting in an empty room is both
unobservable and a pointless write, and sweeping ~5,800 zones a minute to find out would cost
more than the feature is worth. (This is the broadcast plugin's only engine hook.)


---

## The Emergency Broadcast System

*Built.* `plugins/broadcast/index.js` (search `Emergency Broadcast System`), client console in
`client/game/js/panels/ebconsole.js`. The Echelon's Emergency Broadcast Console
(`furn_echelon_emergency_deck`, in `zone_echelon_broadcast`) is the only machine in Architect
that can seize every tuned television at once.

It is a media deck by flag (`media_deck`) and nothing like one in use: no channel, no schedule,
no transport. `use <console>` routes it to its own surface, and the whole surface is `ebs`
sub-verbs.

| Command | Behaviour |
|---|---|
| `ebs` / `ebs status` | Opens the console (or prints its readout at the Display Mode `log` rung) |
| `ebs on` | Throws the switch. Every tuned set in the city carries the console's source |
| `ebs off` | Releases the airwaves; normal programming resumes |
| `ebs source cassette` \| `ebs source live` | Which source goes to air |
| `ebs cam <n\|name>` | Cuts the live feed to one of the studio's cameras |
| `ebs tape <n\|name>` | Loads one of the console's bulletins |
| `ebs ticker <text\|off>` | The crawl along the bottom of every screen in the city |
| `airemergency [id]` / `endemergency` | The older way in. Same switch, same rules |

Admin/dev only, on every sub-verb but `close`.

### The four rules

**The switch is the only RAM-only part.** What the console is set up to DO — source, camera,
ticker — is configuration and lives on the deck's own furniture flags (`eb_mode`, `eb_cam`,
`eb_ticker`), exactly where the pirate console keeps `pirate_crawl`. Whether the switch is
currently THROWN is not: a city-wide hijack that survives a restart is a thing nobody in the
room did, so a reboot releases the air and remembers the bulletin.

**The system is its own transmitter, and the test lives in one function.** A seized channel is
not putting out its own programme, so asking whether its gallery still has power is asking about
a station that is no longer transmitting. ⚠ Before this, `channelTransmitterLive` sent a dark
channel off_air BEFORE the override was ever consulted, and the hijack missed exactly the screens
a hijack is for. `if (emergencyOverride) return true` is the first line of that function rather
than a test at each of its three call sites, because a fourth call site is one more chance for
two expressions to disagree.

**LIVE puts the ROOM on air, not a picture of it.** A camera in a room with people in it should
carry what those people do, which is the same audience seam the studio relay already is, pointed
at every set in the city instead of one channel's. So somebody stands in front of the camera and
speaks, and the city hears it. ⚠ What a camera can see is decided once, in `_relayableAir`, shared
by both relays — never re-air the show's own performance, foot traffic is not television, and a
room event is HTML that has to shed its transport on the way to a screen that escapes. ⚠ And the
studio relay **stands down entirely** while the air is seized: no channel is carrying its own
content, and if the emergency camera happened to be a channel's studio both relays would serve
the same line to the same viewer.

**An edit made while the switch is thrown has to reach the air.** The override snapshots its
source when it is engaged, so writing the flag alone would leave the console reporting LIVE while
the city went on watching the tape. `ebs source` and `ebs tape` re-engage through the one engage
path, so a source that cannot go to air (live, no camera) refuses there in the same words it
refuses anywhere else. ⚠ `ebs cam` deliberately does NOT re-engage — re-engaging restarts the
bulletin, and a vision mix during a live address should not interrupt the address.

### ⚠ A beat that repeats its key takes the channel off air

The tick runs at 1s and every beat the system emits lasts longer than that: a bulletin line holds
for its six-second `message_interval`, a ticker or a camera cut for its five-second slot.
`broadcastTick` treats `result.key === state.lastMsgKey` **exactly as it treats no content at all**
— `wasActive` goes false and the off-air static card is pushed to every viewer. So a beat emitted
on all of its ticks showed content for one second and static for the rest. Measured before the fix:
**5 content lines and 5 off-air cards over 20 seconds.**

`_emergencyMessage` speaks only when the beat actually CHANGES, and answers `live_relay` on every
other tick — the style the tick already understands as "the channel is up and carrying nothing of
its own", and which the tablet tuner, the deck preview and catch-up all already skip. ⚠ The last
beat is remembered **per channel** (`state._ebKey` on the runtime object), never on the override:
the override is one object shared by every channel in the city, and a marker on it would hand the
beat to whichever channel the tick reached first. ⚠ And it cannot read `state.lastMsgKey`, because
the tick overwrites that with the hold's own key on the very next line.

⚠ **The pirate console's `live` mode and its crawl have the same shape and are NOT fixed** — both
key on a five-second slot (`pirlive:`, `pircrawl:`), so a seized station flickers the same way.

### The ticker

`style: 'ticker'` beats, which the TV panel already renders into the marquee strip along the
bottom of the set (`_startTickerAnimation` in `client/game/js/panels/tv.js`). The crawl rides
**one five-second slot in three**, the cadence the pirate crawl uses, so it re-scrolls alongside
the content instead of replacing it. Clamped to `EB_TICKER_MAX` (200 chars) rather than rejected.

### The studio

Two cameras (`cam_echelon_eb_1`, `cam_echelon_eb_2`) and a gallery monitor
(`furn_echelon_eb_monitor`, an ordinary `broadcast_receiver` tuned to 7). The monitor needs no
special case: while the system is off it carries channel 7 like any other set, and while it is on
it carries the hijack like any other set, which is the point of the hijack being a channel-level
override rather than a delivery of its own.

A camera can be NAMED by content — `media_cameras.flags.camera_label`, read by the roster in
`loadChannelRuntimes`, the same field a camera droid already uses. Without it the only name a
bolted-down unit can have is one derived from its id (`_cameraLabel` pulls the crew number out of
`cam_<channel>_3_<ts>`), so "Camera 2" has to be smuggled into the primary key.


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
- **One player, two surfaces, one copy of each beat.** `tvWatchers` and `tabletTuners` are separate
  registrations on purpose, but `dispatch.js` fans a `broadcast` message out to *every* view on that
  channel — so if both passes send the same beat to the same player, each screen renders it twice,
  plays the music twice, and stacks the overlays. `broadcastTick` records `"<playerId>:<channelId>"`
  in a per-tick `servedThisTick` set as the zone pass delivers, and `_tabletBroadcastPass` skips
  anyone already in it. The studio-floor relay does the same with its own `sentTv` set.
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
- **Spoken-line pacing scales with text**: for `say`/`ticker`/`camera_cut` nodes, `nodeHoldMs` returns `max(2.2s, min(chars × 75ms, 30s) + 900ms)`, sized so the read-aloud formant voice reads each line at its natural pace — never speeding up, nothing cut off — with a 1 s gap before the next line. **The voice never compresses to fit**: `AudioEngine.speak` used to scale a long line's speed by up to 2× to land inside its window, which made long lines gabble while short ones strolled, so the window is the thing that stretches. That makes the 30 s cap the only thing that can now clip a read, which is why it sits past any sane line. The `say` result still carries the window as `duration` (the client takes it as information, falling back to the measured inter-line gap when absent). `110 ms/char` is calibrated to the synth's ~94 ms/char average (re-measured at 92.2 after the stress/reduction work — see [systems-library.md](systems-library.md)), the margin covering slower per-narrator voices.
- **The client CHAINS spoken lines; the hold is a ceiling, not a metronome** (`tv.js`, `_speakNow`/`_pump`). `nodeHoldMs` is a text-length *estimate*, and measured across the `.bsm` corpus the voice finishes inside it on essentially every line of dialogue — averaging ~1.9 s early. Playing on arrival therefore left the set silent between every line, and on an overrun the next arrival called `AudioEngine.speak`, whose first act is `cancel()`, truncating the previous line **mid-word**. So arriving lines queue and are spoken the moment the previous utterance ends, driven by the real `duration` speak() hands back rather than by a second estimate. An overrun now delays the next line instead of amputating this one.
  - **Long lines are split** to ≤220 chars on sentence → clause → word boundaries (three cascading levels, because the corpus contains a 585-char crawl punctuated only with middots that the first two don't touch). This is internal to the voice — the caption is still one message. Note it bounds the *utterance*, *not* the total: splitting does not make a long line take less time to read, so it does not by itself fix an overrun.
  - **A line over 273 chars cannot fit its hold by construction**, since `nodeHoldMs` caps at 30 s while speech keeps growing. 19 lines in the corpus are over it; they are crawl/ticker copy that the read-aloud style filter doesn't voice anyway.
  - **The coefficient is FITTED, and it can only be fitted because `estimateDuration` is honest.** 110 ms/char dated from when that function ignored the stress, pre-boundary and aspiration factors and so under-reported the real read length — the coefficient was covering an error rather than a voice, which is why lines began landing on top of the speech. With it corrected, 75 ms/char + 900 ms was fitted against every line in the `.bsm` corpus read by the **slowest possible narrator** (the speed-range floor, 1.24 — the average voice is not what has to fit). That leaves ~0.5 % of lines overrunning, essentially all of them the >273-char crawl copy the read-aloud filter never voices. Below ~70 the overrun rate climbs sharply (2 %, 4 %, 10 %) for progressively less dead air, so this sits just above the knee.
  - A small overrun is **safe** now: the client queue delays the next line rather than cutting the current one mid-word. That's what allows a fitted coefficient instead of a defensive one.
  - Measured across the corpus: 65–77 ms/char depending on the voice, 0.2–0.6 % overruns, 1.8–2.3 s dead air per line. The remaining dead air is mostly the ±9 % per-voice speed spread (the hold must cover the slowest) plus up to 1 s of rounding to the broadcast tick.
  - **A spoken line is not DISPLAYED until the voice is free to read it.** Caption and audio are delivered together, so the text can never run ahead of the speech. `_deliverQ` holds whole messages; `_pumpDeliver` releases the head once the voice falls silent, then renders and speaks it.
    - **Order is preserved absolutely.** Once anything is waiting, *everything* queues behind it — including a title card or ticker that has nothing to say — or the picture would overtake the line it belongs to.
    - **With the voice off, nothing waits.** `_voiceLive` tracks whether the engine actually produced sound (it returns nothing when muted, disabled, or blocked by autoplay policy). The moment a read comes back silent, every held caption is released and display reverts to the server's own timing. A muted set never sits waiting on a voice that will never speak.
    - `catchUp` — the beat already on air when you tuned in — is shown but never narrated, so it never waits either.
    - A `DELIVER_MAX_WAIT_MS` backstop (20 s) shows an old message regardless, so a stuck voice can't leave the screen dead. Normal operation never reaches it.
  - **Drift is bounded at scene beats only.** The client now paces off its own voice while the graph runs on the server clock for every viewer at once, so it can fall behind. If the oldest unspoken line has waited more than `RESYNC_MS` (2.5 s), the queue sheds down to the freshest line — but *only* on a non-spoken message (title card, ticker, overlay), because that's where the picture changes and where a lost beat is invisible. Never mid-scene, never mid-word. In the measured corpus the threshold is not reached; it exists to bound worst-case drift, not to run normally.
- **In-memory only**: `channelRuntime`, `zoneTunings`, `newsQueue`, `graphicsCache` — all rebuilt on server restart from DB. News queue starts empty on restart.
- **Graphics cache**: holds `id`, `name`, `type`, `content`. `type` is used by `title_card` and `off_air` to set the correct wire style (`'svg'` vs `'ascii_art'`), which the client uses to pick `innerHTML` vs `textContent` rendering.
- **VINE vs flat list**: runtime prefers `broadcastGraph` when present. Both are saved independently.
- **NPC presence requires `studio_zone_id`**: if not set, presence checks are skipped — the broadcast runs regardless of NPC location.
- **Blackboard lifetime**: one per channel, persists across ticks, resets when the active `broadcast_id` changes.
- **SVG title cards**: 640×360 is the recommended canvas size (and the Vector editor's default).
