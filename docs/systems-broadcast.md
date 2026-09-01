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
- **Clubs differ.** `clubProfile(name)` derives shooting / goaltending / discipline /
  violence + a colour pair from the club NAME, then **nudges by keyword** — a club called
  the Goons cannot come out as the league's gentlest side because its name hashed low.
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
- **Barn colour.** Booth chatter looks for `chatter.<first word of the home club>` and
  falls back to the general `chatter` pool — authoring a building is optional, and a club
  with nothing written behaves exactly as before. Ashway, Docks and Longwatch have one.
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

### The rink sub-screen

[client/game/js/panels/gameday-rink.js](../client/game/js/panels/gameday-rink.js) is the
hockey analogue of the Deadball diamond, with the identical
`{ apply, clear, setCaption, showIdle, showCard }` interface — which is the only reason
tv.js can pick a view by `gd.sport` and change nothing else. Both TV surfaces (CRT and
tablet) get it, since both drive the same `createTvView`.

Two facts fell out of the sim and the whole view is built on them: the possession
keyframes are already in rink coordinates, and **a goal's final keyframe (x≈0.955) is
past the goal line the view draws (0.925)** — so the puck visibly crosses, *then* reaches
the mesh at 0.975, which bulges. Regress asserts every simulated goal crosses. The goalie
is an articulated SVG (mask, chest, blocker, trapper, two pads, stick) with a pose per
save type, because every save in the sim is a *different* save.

**The sheet stands up and the camera chases the puck** (NHL '94's answer to the same
problem). A whole 200×85 rink drawn end-to-end across a landscape panel puts every man at
three pixels; instead the ice is drawn TALL and LARGER THAN THE VIEWPORT, and `.gdr-cam`
slides under a clipping window to keep the puck in frame. Three elements, three jobs:
`.gdr-rink` clips, `.gdr-cam` slides, `.gdr-sheet` is the coordinate space every token is
positioned against — so no token knows the camera exists. **The model frame never
rotates:** the sim's `x`-along/`y`-across coordinates, GEO and DOTS are untouched and
standing the picture up is a projection (`_sx`/`_sy`) applied at the very edge. Rotating
the model instead would mean reinterpreting every coordinate the server sends. The sheet
SVG is authored at the real 85×200, so a faceoff circle is a *circle*; the CSS
`aspect-ratio` on `.gdr-cam` is derived from that and **must stay in step with it** or
every circle on the ice becomes an egg.

**The ice is never still.** A beat lands about every ten seconds; the view used to
animate it and then hold its last frame for the other nine, which reads as a photograph
of hockey. A rAF loop now owns every token — ten skaters (numbered, with sticks, five a
side) hold a formation *relative to the puck*, and the puck keeps circulating through an
idle flow between beats. **The idle flow decides nothing**: no shot, goal or stat ever
comes out of it, because the only events that exist are the ones the sim decided.

Four rules the motion is built on, each fixing something that was visibly wrong:

- **`ROLES` depths are bounded by the CAMERA, not by realism.** A real five-man unit
  spreads over half a zone; drawn at that spread the forwards and the defence were 0.26
  of the sheet apart — *wider than the viewport* — so one team was always entirely
  off-screen. Both teams now occupy about half the visible window.
- **A beat is a CUT.** `_snapFormation` places every man in the formation the opening
  keyframe implies before the first frame — including for beats with no possession
  chain (a hit, a fight, a death), which is what stopped a man being *killed off-camera
  on an empty sheet* while the rink greyed out around nobody.
- **The camera is a DEADZONE, not a spring.** Easing toward the puck every frame gives
  you either a camera that whips on every pass or one a rush outruns. It now holds still
  while the puck is anywhere mid-picture and follows only the amount by which it has
  left that band, with a hard leash — and it may overscroll a little past each end, so
  the net isn't jammed into the last few pixels exactly when you need to see it.
- **Each kind of touch moves differently.** A carry travels at the skater's pace with
  him; a **pass** is twice as fast, straight, and belongs to *nobody* while it's in the
  air (the receiver becomes the carrier on arrival); a **shot** is preceded by a wind-up
  where he plants and the puck sits still. Skaters are clamped out of the goalmouth, or
  the carrier follows the puck's final keyframe *into the net* and stands there holding
  it.

**The violence reaches the ice.** `boards`, `injury`, `death` and `scrum` used to carry no
gameday payload at all, so the announcer described a man going through the glass over a
still picture — the league's whole character happening off-screen. They now ride the same
payload, carrying `victim`/`hitter` (a `boards` beat) or `player` (an `injury` or a
`death`), each with the club's **name** — `victimTeam`/`hitterTeam`/`teamName`.

The **narrator** — not the sim — derives `victimSide`/`hitterSide` onto the gameday
payload from those names (`'att'` is always the away club), which is the tag the view
reads and the broadcast regress enforces. The view falls back to matching the club name
against the payload's own `awayTeam`/`homeTeam` if the tag is ever absent, and the smoke
fixtures now carry **the sim's real field names** (`player`/`teamName` on an injury or a
death, `victim`/`victimTeam` on a hit) so a fixture cannot quietly disagree with the
payload the view actually receives.

**Loose things are simulated; decided things are not.** This is the line the rink is
built on. Everything the sim decided — the carry, the pass, the shot, the outcome —
arrives as keyframes and is interpolated, because those are facts and a view may not
re-derive a fact. But *where a rebound ends up* was never a fact: the sim says "pad
save", not where the puck went. That used to be one more straight lerp to a hand-picked
resting spot, which is why every rebound in the league died in a gentle diagonal and no
puck had ever touched the boards.

Aftermath is **integrated** instead — velocity, ice friction, and dashers that give some
of it back (`_stepFree`). Velocities are feet per second on the real 85×200 sheet, the
only frame in which a bounce angle is correct; the two axes convert separately on the way
back into model units, or a puck off the end boards leaves at the wrong angle. A post
ricochets sideways at nearly shot speed; a wide shot *carries on into the end boards and
comes back out*, which is why a missed shot is still a chance ten feet later. Nothing
from here can change an outcome — the puck is already dead in the sim's ledger by the
time it is given a velocity — so a carom is free to be genuinely unpredictable.

**THE PICTURE IS 3/4, NOT PLAN — and that is the change everything else hangs off.** A
pure top-down rink has one fatal problem no amount of paint fixes: a man skating toward
the bottom of the screen is the same sprite rotated 180°, so his helmet is below his feet
and his number is upside down. It reads as a bug even when it is geometrically perfect,
because nobody has ever watched hockey from directly above. NHL '94/'96 never did it:
they foreshortened the sheet and stood the players up on it.

`SHEET_TILT` (0.62) is that foreshortening, and it is applied by making the sheet's **box
shorter**, never by transforming anything — which is precisely why the men, the puck and
the debris keep their true size and stand up off the ice with no counter-transform
anywhere. Two consequences look like bugs if you don't expect them and are both correct:
the faceoff circles become **ellipses** (what a circle on a tilted plane is), and the
visible band holds nearly twice as much of the rink's length. **`SHEET_TILT` and the
`.gdr-cam` aspect-ratio must move together** — the CSS says so at the rule.

The skater is now **a standing figure that never rotates**. Heading became two discrete
latched facts — which way he is mirrored, and whether you see his front or his back —
plus a lean, so his helmet is above his blades wherever the play goes. Things swap on the
`away` class, and each is real kit rather than a cartoon cue. **No face is ever drawn on
him.**

**The front and the back of a sweater share no ink at all**, which is what makes facing
legible from the chest as well as the helmet. His **number is only on his back**; his
chest carries the **club crest**. It used to be a number on both — two sizes of the same
marking, telling a viewer nothing about which way he was pointed. The crest is **derived
from the club name exactly as the sim derives its colours**: same input, same method, so a
club's crest is its crest every night, nothing is authored per club, and no logo has to
cross the wire for a cosmetic. It's printed the way a real crest is — the club's second
colour as the field with the mark knocked out of it in the primary, which also means it
can never come out the same value as the shirt it sits on.

The other half is the **full cage**, and it is the loudest facing cue on the figure. It
was one thin arc, which at this size is a scratch on the helmet; a real cage is a bright
bowl of bars over the whole face, and a bright bowl on one side of a head is unmistakable
at eleven pixels. The dark shell behind the bars is load-bearing — a cage is a shadow with
metal in front of it, and without it the thing reads as a white blob stuck to his chin.
The stick blade also sits lower on screen when it is nearer the camera.

**The figure is ASYMMETRIC, and that is what makes it three-quarter rather than
straight-on.** Standing the men up and foreshortening the ice got the scene into 3/4, but
the men themselves were still symmetric front-on sprites that mirrored — and a symmetric
trapezoid can only ever be a man facing you, however the rest of him is drawn. Because
`+x` is *always* the way he faces (the whole body mirrors), every asymmetry can be
authored once and stays correct both ways. Four of them do the work: the **near shoulder**
is further out and sits **lower** while the far one is pulled in and rides high, so the
shoulder line **slopes**; the **head is offset** toward his facing and the skull is an egg
rather than a ball; an **ear cup** sits on the far side of the helmet, a piece of kit that
only exists on a head that is turned; and the far side of the chest falls into **shadow**.
The far arm hangs off the higher, further shoulder and is drawn a size smaller, because it
is further from the camera.

**And he has a neck.** The helmet used to sit straight down on the shoulder line, so the
head was simply the top of the torso — the single loudest reason the figures read flat.
The neck is drawn before both the sweater and the head so only the sliver between them
shows, which is all a neck ever is at this size.

Proportions came from the reference directly, and three of them are load-bearing:
he is about **2¼ shoulder-widths tall** (squat and top-heavy, not a stick man in a
shirt); his legs are **bent and splayed** into a stance with the blades outside his own
shoulders, because nobody in a hockey game stands to attention; and he carries a
permanent **forward lean**, applied inside the mirror so it follows his facing for free.
He also **reflects in the ice** — the same body flipped about his blades, squashed and
faded — which is the cheapest thing in the whole picture that says *polished sheet*
rather than *white background*. One gotcha worth knowing: the **lean is a rotate about his blades, never a `skewX`** — a
shear slants a figure's verticals without moving its feet, which on a standing man
visibly warps him.

**The markings are PRINTED ON the sweater**, and getting that right took two goes. A
mirrored numeral is a mirrored numeral — every man skating left wore his number backwards
— so they were first moved *outside* the mirrored group. That fixed the numerals and
broke something worse: outside the body they inherit none of its lean, ride or mirror, so
they stayed pinned in space while the torso bobbed and leaned underneath them, and the
number visibly slid around on the shirt.

They live **inside** the body now and cancel the mirror **locally**: `.gdr-sk-marks`
translates to the middle of his chest — an anchor that is itself inside the body, so it
travels to the chest of a *turned* figure — and `.gdr-sk-marks-flip` applies the same
`scaleX` again about that point. Two mirrors compose to none, so the glyphs come out
upright while everything carrying them stays fully mirrored, leaning and riding. Facing is
a **custom property** (`--gdr-face`) rather than a written transform for exactly this
reason: the same value is needed in three places — the body, the markings that cancel it,
and the reflection's own copy of the whole body — and one property reaches all of them.
`rink-smoke` counts **twenty** crests and numbers rather than ten, and that count *is* the
assertion: the reflection duplicates everything the body carries, so ten would mean they
had drifted back outside it.

**EIGHT HEADINGS OUT OF ONE DRAWING.** Mirroring alone gives a man two looks — facing left
and facing right — so a team drifting up the ice was a row of profiles and "coming at the
camera" was indistinguishable from "crossing in front of it". Screen heading `yaw` is
measured from straight-away, and four separate numbers are derived from it, each driving a
different part because **they do not agree with each other**:

| property | drives | max when |
|---|---|---|
| `--gdr-front` | mask width, crest↔number, **arms swinging round to the front** | facing camera |
| `--gdr-side` | blade length and stride width — **the opposite of the torso** | profile |
| `--gdr-stickyaw` | the stick swings low-and-forward ↔ high-and-behind | ±, zero in profile |
| `--gdr-turn` | a whisper of body roll, and nothing else any more | facing camera **or** away |

**A TURN IS LIMBS MOVING, NOT A SQUASHED SPRITE.** The first version of this scaled the
whole figure horizontally, which is a cheap way to fake a heading and looks like precisely
what it is. There is a full limb rig here, so the heading is now carried by the rig: the
arms come round in front of his chest as he turns to face you and hang at his side in
profile, the stride narrows, the mask widens on his face, the stick yaws and the blades
foreshorten. Each limb therefore has **three** nested groups — `limb` (the authored
pivot), `stance` (where it sits for this heading) and `joint` (what it is *doing*: stride,
crossover, dangle, shot) — because a CSS animation always beats a static transform on the
same element, so heading and action cannot share a group. That collision is the whole
reason turning had been done by squashing in the first place.

That last one is the trap worth naming: a skate blade is *not* the same shape problem as a
chest. Drawn as fixed horizontal lines the blades pointed right whatever the man was
doing, so somebody skating at the camera stood on two sideways skates. And the **mask used
to hang off the side of the skull** — a cage seen edge-on, correct in profile and nonsense
the moment a man skates straight at you. It is centred on the face now and widens with
`--gdr-front`, so head-on you look into a full grey cage and in profile it narrows back to
an edge. The dark field behind the bars carries as much of it as the bars do: a cage is a
shadow with metal in front of it, and bars alone read as a white smear on his chin.

**A lean is something a body does, not something done to a bounding box.** This was a
`skewX` (which shears a figure's verticals without moving its feet), then a whole-figure
rotate — wrong the same way, because tipping a finished drawing reads as the *sprite*
being tilted. It is nearly gone from the transform now; the weight of a turn is carried by
the **crossover**, which is limbs moving at their joints.

**The building.** The dashers carry **lit LED hoardings naming real Coldwater businesses** —
Battery Acid Coffee, Grease Expectations, In Hock We Trust, Co-Pay & Pray — because the
arena advertising the city you can actually walk around in is worth more than any invented
sponsor. Every name is forced to its panel with `textLength`/`spacingAndGlyphs`, which is
both what an LED board really does with a long name and the only reason
"PERCUSSIVE MAINTENANCE" doesn't run off onto the ice. The bowl behind them is **denser and
brighter at the ice and thins into the dark as it climbs** — that range, not the dot
grids, is what makes a crowd read as depth — with sparse saturated points up in the gloom:
four thousand people looking at their screens instead of the game.

**The puck is the most-looked-at object on the screen and is built like it.** It was a
flat black circle 2.4% of the sheet wide — nearly two feet across, bigger than a man's
chest, and drawn in plan on a surface that isn't. It is now a shade over a stick-blade
wide (the object a viewer actually judges it against) and rendered as the **cylinder** it
is: a top face that is an ellipse at the sheet's own 0.62 tilt, the vulcanised side wall
below it, and a contact shadow so it sits *on* the ice rather than over it — which is
also what makes it findable when it is moving fast. The size is deliberately generous:
a true 3in puck on an 85ft sheet is 0.3% and invisible, so **don't "correct" it to
reality.**

**The stride is asymmetric, and always running.** Two things made the old one a shuffle,
neither of them artwork. First it was a **sine** — `alternate` between two keyframes with
`ease-in-out`, so the leg spent as long going out as coming back, at the same speed. A
real stride is violent and lopsided: a hard fast push off the edge, then a long slow
recovery gliding the foot back under. The cycle now spends ~16% of its period pushing and
the rest recovering, and that ratio alone is most of the difference. Second it **switched
on and off** at a speed threshold, so every man popped between an animated cycle and a
frozen pose, legs snapping to neutral in one frame. Nothing is gated now: the cycle always
runs and speed drives two custom properties instead — `--gdr-stride` (tempo) and
`--gdr-amp` (a unitless degree count the keyframes multiply). A man barely moving runs a
slow shallow version that reads as shifting his weight, and there is no threshold to pop
across. **Both are quantised into coarse bands** — rewriting an animation's duration
restarts it, so a smoothly accelerating man would twitch in place every frame otherwise.
On top of the legs: the arms counter them a beat late, the body **rides** up on each push,
and the head counters the ride so his eyes stay level. The ride lives on `.gdr-sk-body`
rather than the flip group on purpose — the reflection wraps its own copy of that group in
a `scale(1,-0.52)`, so it sinks exactly when he rises, for free.

**They move WITH the puck.** The formation used to be the whole model: every man held a
lane offset from the puck, so the puck could squirt into a corner and ten men would shade
two feet sideways and carry on standing in a diamond. Jobs are now assigned every frame
off each side's real distance to the puck — **chase** it when nobody owns it, **support**
the man who does, **forecheck** the man who doesn't — and a man with a job skates harder
than a man holding a lane, which is where "they move with the puck" is actually felt. The
assignment is **sticky**: two men a hair apart would otherwise swap the job several times
a second and throw each other back and forth. Lane `grip` went up across the board too;
only the defence pair really holds position now, which is the one place holding position
is the point.

**Changing direction is a move, not a sign change.** Facing is three values now — a
discrete `faceWant`, a continuous `faceBlend` that eases toward it, and the sign of the
blend — and everything that positions a man reads **the blend**. That one indirection buys
both halves of turning. A **carrier can switch stick side** again (he couldn't, because an
instantaneous mirror teleported the blade to his other hip and dragged the puck through
his skates on the way): his lateral offset now travels across over ~200 ms, so he **pulls
the puck across his body**, and the mirror flips at the midpoint — exactly when the offset
is zero and the blade is at his centre. That is precisely what `rink-smoke` asserts, since
the flip instant is the one place the old bug was visible.

And he **crosses over**. A skater changing direction at speed steps one skate over the
other rather than swivelling. The **near** leg is the one that crosses — a drawing-order
decision as much as an anatomical one, since SVG has no z-index and `legR` is emitted last,
so it is the only leg that can pass in *front* of its partner. It's driven off the lean
(already the turn rate) with a deliberate gap between the on and off thresholds, and it
deliberately does **not** scale with `--gdr-amp`: a man crosses over the same way whether
he's flat out or barely moving.

**The puck rides on his blade, not under his boots.** A standing figure is anchored at his
skates, so putting the carrier's own position on the puck drew every man in the league
dribbling it with his feet. He is offset by `BLADE_REACH` instead — **derived from the
artwork, not chosen** (the blade sits ~0.43 out from his spine in a viewBox drawn at the
skater's own width, landing at ~3½ feet of stick), so **if the figure's width or the
stick's length changes, that constant changes with them.** A carrier also **never turns
around**: flipping him mid-rush swings the blade to his other side and drags the puck
straight through his skates on the way.

**Three things used to make men shake violently in place, and all three were thresholds.**
Which way a man faces, whether you see his front or his back, and — loudest — the stride
DURATION, because rewriting it *restarts* the animation, so a man sitting on a band
boundary re-triggered his own stride every frame. The facing fix is the interesting one:
hysteresis alone wasn't enough, because every man carries a slow cosine **wander** whose
own peak lateral speed exceeds any threshold worth setting, so a man standing still was
told he'd changed direction once a second. Facing is decided on a **700 ms low-passed**
velocity now, which averages the wander away while leaving a real turn intact. Duration
changes only on a two-band move; amplitude is safe to write freely because it's read
*inside* the keyframes and re-resolves without restarting. `rink-smoke` measures this as
a **worst one-second window per man** — a total says nothing, since over eight seconds of
circulation men legitimately turn with the puck several times.

**The stick has a wrist.** Welded to the shoulder it swung as one rigid spar, so every arm
swing threw the blade through a huge arc and lifted it clean off the ice — the giveaway
that it was a painted-on radius after all. It pivots at the **hands** now, inside the
shoulder joint, and counter-rotates against the swing at a bit over half the amplitude:
the arms drive it, the wrists absorb the throw, the blade stays down. It also **lags** the
shoulder by a few percent of the cycle, which is most of what makes the limb read as a
chain rather than one piece. A carrier's wrists do the actual dangling (at two-thirds the
arm's period, so the two never line up the same way twice), and a shot **whips** — the
blade lags going back, then overtakes the hands coming through.

**The skater is a rig, and the rig is why limbs come off.** `LIMB` is the single table of
what a man is made of: five named parts (`armR`, `armL`, `legL`, `legR`, `head`), each
drawn *relative to its own pivot* and wrapped in a translate that puts the pivot at the
shoulder, the hip, the neck. An SVG group's default `transform-origin` is 0,0 of its own
user space, so after that translate the origin already **is** the joint — no
`transform-box` guesswork, and nothing drifts when the figure is scaled.

That buys two things at once. Animation: legs alternate about the hips, arms counter them
about the shoulders, and **the stick belongs to the right arm** so it sweeps with the
hands rather than being a painted-on radius — the NHL '96 read. A carrier's stickhandle
overrides the stride (his hands work the puck whether or not his feet are moving) and a
shot overrides both. Tempo is per-man: the loop writes `--gdr-stride` from his actual
speed, quantised so an accelerating man doesn't restart his own animation every frame.

And dismemberment. `_sever` hides the part on the man and throws **a copy of the same
`LIMB` markup** — so the arm on the ice is the arm that was on the shoulder and cannot
drift from it — inheriting his club colours by copying his `style` attribute. Which part
is hashed off the victim's **name**, so every screen watching the broadcast loses the
same arm; **a head is only ever taken on a death**. An injury takes a limb only when the
sim's own `slotsOut` is 3 or more, so severity is read from a fact rather than rolled.

**A severed limb goes into the puck's integrator, not a keyframe.** An arm on ice is a
loose body on ice, and writing that physics twice would be two things to keep in
agreement for no gain. It slides, caroms off the dashers, spins down as it slows, and
stops where friction leaves it (meat glides far worse than vulcanised rubber, hence
`DEBRIS_FRICTION`). **And the puck can hit it** — a circle test that pushes both bodies,
which is what makes the debris part of the game rather than a decal near it. It changes
nothing: only cosmetic idle circulation is ever running when a carom off a leg can
happen. The smoke suite steps frames and re-reads the style to prove the limb *travels,
spins and comes to rest* — a CSS throw would look identical on screen and fail there.

**The booth calls the rush, not just the outcome.** The announcer's entire account of a
scoring chance used to be its last event — *"saved"* — laid over ten seconds of a play he
never mentioned: the viewer watched a breakout, a zone entry and two passes and heard
about none of them. `describeRush` in [hockey.js](../plugins/broadcast/sports/hockey.js)
walks **the same possession keyframes the rink is about to animate** and says what
happened on the way up the ice, naming the men the carrier indices already point at. It
decides and invents nothing, which is exactly why the call cannot disagree with the
picture — the one failure mode a generated play-by-play has that a human one doesn't.

The line rides the beat as `rush`, reaching the announcer as a `{rush}` token and the
rink as its own quiet strip under the score line, so the words and the picture arrive
together. It is spoken **before** the outcome and **without** a gameday payload, so the
outcome line still owns the cut and a beat with no possession behaves exactly as before.
A goal or a near-miss always gets one; routine chances get one 45% of the time, because
every chance narrated in full is a stream of breakouts nobody can follow. Fixing this
also exposed that `synthPossession` hardcoded `carrier: 0` on the breakout — the same man
broke his club out on every rush of every game, invisible while the chain was only
animated and glaring the moment the booth started naming him.

**The goalie stands on the angle**, which is geometry with a real answer rather than a
fraction to taste: he plays out along the line from the puck to the middle of his net and
covers `out/dist` of its offset from centre. He comes out to cut the angle when the play
is up the ice and retreats to his post when it is in tight — the old version covered a
flat 0.42 of the lateral spread on a stepped 560 ms transition, so he drifted the *wrong
way* on a puck in tight (the closer it is, the more he must move) and arrived in visible
hops. He is on the frame loop now, with his CSS transition explicitly cleared so two
things are never writing the same two properties.

Branding lives in [cphl-brand.js](../client/game/js/panels/cphl-brand.js) — one mark,
drawn by the score bug, the full-screen graphics, the rink header, the idle screen and
**the Gameday toggle itself**, which wears a puck on a hockey night and a baseball
otherwise (`_brandGamedayBtn` in tv.js).

[scripts/shapes/rink-smoke.mjs](../scripts/shapes/rink-smoke.mjs) is the view's only
automated coverage and runs in `pretest:regress`: it drives `apply()` through every beat
type over a hand-cranked DOM + clock ([rink-dom-stub.mjs](../scripts/shapes/rink-dom-stub.mjs))
and asserts ten men take the ice, the camera moves, the puck still circulates with no new
beat, and a death leaves a body that stays where it fell. It proves the view **runs**,
not that it looks right — there is no pixel comparison.

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
emergency-broadcast verbs (`airemergency`, `endemergency`) — see the broadcast row in
[docs/plugins.md](plugins.md) for what each does.

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
