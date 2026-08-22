# .bsm File Format — Broadcast Script

`.bsm` is a plain-text scripting format for authoring TV broadcast content (news segments, ads, scripted shows) outside the dev panel, then importing it. The importer/compiler lives at [client/devpanel/js/bsm-compiler.js](../client/devpanel/js/bsm-compiler.js) (`compileBsm(text)`), which turns the script into a VINE broadcast graph (`broadcastGraph`), a flat `messages` list, ASCII `assets`, and dependency lists (`rooms`, `cameras`, `npcIds`, `actorIds`). Import entry points are in [client/devpanel/js/panels/broadcast.js](../client/devpanel/js/panels/broadcast.js) (`bcImportBsm`, `_bcCommImportBsm`) — accepts `.bsm` or `.txt` files.

This doc describes the format **as parsed by the compiler**, line by line. There is no formal grammar elsewhere — this file is the spec.

## File Structure

```
@broadcast "Name"
@channel CHANNEL_ID
@category general
@host npc_some_host
@length 120
@type live

::actors
@actor npc_john_akerson
@alias npc_john_akerson JOHN
::endactors

... body directives ...

END
```

## Header Directives (`@key value`)

Appear at the top, one per line, in any order. Recognized keys:

| Key | Meta field | Notes |
|---|---|---|
| `@broadcast "Name"` | `meta.name` | Surrounding quotes (`"` or `'`) are stripped |
| `@channel CHANNEL_ID` | `meta.channel` | |
| `@category general` | `meta.category` | defaults to `"general"` |
| `@host npc_host_id` | `meta.host` | |
| `@length 120` | `meta.length` | parsed as float (seconds) |
| `@location zone_id` | `meta.location` → `media_broadcasts.location_zone_id`. Shoots this programme **on location** in that zone rather than in the channel's studio: the cast are routed there, the cameras that count are the ones standing in it, and every line the acting layer puts in a room goes into that room. Omit for the overwhelming default. Needs a camera in the room (a fixed unit, a camcorder, or a `camera_droid` NPC) **and** a `portable_mediadeck` to get the signal home — see [systems-broadcast.md](systems-broadcast.md#on-location). |
| `@type live` | `meta.type` | lowercased; known values: `live`, `scripted`, `film`, `weather`, `sports`, `news`, `talkshow`, `morning`, `gameshow`, `sermon`; defaults to `"live"`. `live`/`scripted`/`film` are **linear** (this document's main body); everything else switches the file to the line-library format — see [Weather](#weather-broadcasts-type-weather), [Sports](#sports-broadcasts-type-sports), [News](#news-broadcasts-type-news), [Talk-Show](#talk-show-broadcasts-type-talkshow), [Morning Shows](#morning-shows-type-morning) and [Game Shows](#game-shows-type-gameshow). `film` is linear like `scripted` but with its own cast model and pre-roll — see [Films](#films-type-film). |

Any other `@key value` line is silently ignored at the top level (only `@actor`/`@alias`/`@billing` are meaningful elsewhere — see below).

## `::actors` Block

Pre-scanned before the main pass, so actors/aliases can be referenced anywhere in the body regardless of order.

```
::actors
@actor npc_john_akerson
@alias npc_john_akerson JOHN
::endactors
```

- `@actor <entity_id>` — registers an exact NPC entity ID, added to `actorIds` (declaration order) and `npcIds`.
- `@alias <entity_id> <LABEL>` (or `alias` without the `@`) — maps `LABEL` (case-insensitive, stored uppercase) to `entity_id`. `LABEL` may be multiple words (e.g. `Captain Nguyen`, `NARRATOR`) — everything after the entity id is the label. Used to resolve bare `SPEAKER:` lines later; an actor can have several aliases (e.g. a formal name plus `NARRATOR`), all resolving to the same entity id so only one NPC is ever created.
- `@billing <entity_id> <NAME>` — an **on-air stage name**. The aired line reads `NAME says, "…"` instead of using the NPC row's own name, and it also registers `NAME` as a speaker label so `NAME:` lines resolve (a man billed as `PRODUCER` is written `PRODUCER:` anyway). Rides on the `npc_anchor` node as `display`. ⚠ **Not the same as `@alias`, and never derived from it**: an alias is typing shorthand (`@alias npc_neil_mcmanistan NEIL` exists so the author can write `NEIL:`), so treating aliases as stage names would put "NEIL says" and "LAWYER says" on air for two men with perfectly good names. A billing is a deliberate refusal to use the name — Phil McCracken produces *You're Not Gonna Believe This Shit* and is credited only as `PRODUCER`, and before this existed the only way to get that was to *name the NPC* "PRODUCER", which then follows him into room descriptions, examine, SIFT and his own front door.
- **Implicit aliases** — a `SPEAKER:` label with no explicit `@alias` still resolves to a declared `@actor` when it matches that actor's derived name: the humanized id (`npc_lucky_chen` → `LUCKY CHEN`), its first word (`LUCKY`), or its last word (`CHEN`). Only applied when exactly one declared actor owns the label; an ambiguous first name falls through to the `npc_<label>` fallback. This is what stops the importer minting a duplicate placeholder NPC for an already-declared actor.
- Any other `::xxx` line ends the actors block.

## Structural Markers (`::`)

- `::asset <id>` ... `::endasset` — collects raw block content as a graphic asset: `{ id, name: id, type, content }`, pushed to `assets`. `type` is `'svg'` when the content starts with `<svg`, else `'ascii'`.
- Any other line starting with `::` (e.g. `::actors`, `::endactors`, `::scene`) is consumed and skipped if not otherwise handled.

## Body Directives

Processed top to bottom, building a linked chain of VINE nodes (`node.next` points to the next node id; `_start` is the first node, always a `{ type: 'start' }` node).

| Directive | Result | Notes |
|---|---|---|
| `END` | stops parsing | EOF marker; everything after is ignored |
| `EVENT <type>` | `{ type: 'event', event_type }` | placeholder node |
| `TECH_DIFFICULTIES <seconds>` | `{ type: 'tech_difficulties', duration }` | duration defaults to `10` if unparsable |
| `TITLE <graphic_id>` | `{ type: 'title_card', graphic_id }` | |
| `TICKER` ... `TICKER_END` | `{ type: 'ticker', text }` | block content also pushed to `messages` |
| `WAIT` or `WAIT <seconds>` | `{ type: 'wait', duration }` | bare `WAIT` defaults to `5` |
| `ROOM <zone_id>` | no node; appends `zone_id` to `rooms` (deduped) | dependency declaration only |
| `CAM <n> [label words...]` | `{ type: 'camera_cut', zone_id: '', label }` | `n` recorded in `cameras` (deduped, first-seen order); label is `"CAM — n — rest"` |
| `OVERLAY` ... `OVERLAY_END` | `{ type: 'overlay', overlayType: 'text_card', text }` | bare form, no graphic id |
| `OVERLAY <graphic_id>` ... (free text until a directive line or `OVERLAY_END`) | `{ type: 'overlay', graphic_id, text }` | text lines collected until another directive is recognized |
| `LOWER_THIRD` ... `LOWER_THIRD_END` | `{ type: 'overlay', overlayType: 'lower_third', text, subtext, graphic_id: '' }` | first non-empty line = `text`, second = `subtext` |
| `SHOT` ... `SHOT_END` | `{ type: 'say', text, style: 'narration' }` | narration (no NPC prefix); text also pushed to `messages`. Like `NARRATOR:`, on a live/host-acted channel it plays over the studio speakers, not from an NPC |
| `CREDITS [seconds]` ... `END_CREDITS` | `{ type: 'credits', text, duration? }` | block content is the credits text; optional duration in seconds on the same line as `CREDITS` |
| `NPC <npc_id>` | `{ type: 'npc_anchor', npc_id }` | only emitted if it changes the active speaker; sets `activeNpc` |
| `SPEAKER:` (e.g. `JOHN:`, or a multi-word Title Case label like `Captain Nguyen:`) followed by a line of dialogue | `npc_anchor` (if speaker changed) + `{ type: 'say', text, style: 'raw' }` | label resolved via `::actors` aliases (uppercase match), then the implicit-alias match against declared `@actor`s, else falls back to `npc_<label_lowercased_with_underscores>`; unresolved labels recorded in `_debug.unresolvedSpeakers`; dialogue text also pushed to `messages`. A second-or-later word in the label must be Title Case (like a surname) so a plain sentence ending in `:` isn't mistaken for a speaker line |
| `NARRATOR:` / `ANNOUNCER:` followed by a line | `{ type: 'say', text, style: 'narration' }` — **no** `npc_anchor` | Reserved labels for an **unseen off-screen announcer**, recognized in every broadcast type. No NPC is created (never added to `npcIds`, so no studio NPC spawns); on air the line plays on TV as a bare line and, on a live/host-acted channel, over the studio speakers (`The studio speakers announce, "…"`) with nobody on stage. An explicit `@alias <npc_id> NARRATOR` still wins and treats it as that actor, for back-compat. |
| bare duration: `8`, `8s`, `1.5s` | `{ type: 'wait', duration }` | matches `^\d+(\.\d+)?s?$` |
| `MUSIC` or `MUSIC <song>` ... `MUSIC_END` | `{ type: 'music', song, text: body }` (only if `song` or body non-empty) | `song` must match an `audio_songs.name` row to actually play; if no such song exists the node falls back to showing `body` as plain text (`style: 'raw'`) — see [systems-broadcast.md](systems-broadcast.md#music-cues) |
| `ENTER <npc>` | `npc_anchor` (if changed) + `{ type: 'npc_action', message: 'enters the frame.' }` | `npc` auto-prefixed with `npc_` if missing |
| `ACTION` ... `END_ACTION` | `npc_anchor` (if first word is/becomes a new npc id) + `{ type: 'npc_action', message }` | first whitespace-separated token of the block is treated as the NPC id (defaults to current `activeNpc` if not npc-prefixed-looking); remainder is the action message |
| `ACTION <npc> <message...>` (single line) | same as block form | inline variant |
| `♪ <cue text> ♪` | `{ type: 'say', text: line, style: 'ambient' }` | only if the inner text contains whitespace (multi-word); a single bare word like `♪ tonight_theme ♪` is treated as a compiler-only cue ID and skipped (no node) |
| any other non-empty line while `activeNpc` is set | `{ type: 'npc_action', message: line }` | implicit stage direction for the current speaker |
| any other non-empty line with no `activeNpc` | no node; recorded in `_debug.unknownDirectives` | |
| lines ending in `_END` / `END_ACTION` / `END_CREDITS` seen outside their opening block | skipped silently | guards against stray terminators |

### Directive-line detection (`isDirectiveLine`)

Several block collectors (e.g. `OVERLAY <id>`, `SPEAKER:` text) stop early if the next line looks like a directive rather than free text. A line counts as a directive if it starts with any of:

```
@  ::  EVENT   TITLE   TICKER  WAIT  NPC   OVERLAY
SHOT  SHOT_END  TICKER_END  OVERLAY_END  LOWER_THIRD_END  MUSIC_END  END  CAM   ROOM  LOWER_THIRD
MUSIC  ENTER   ACTION  END_ACTION  ♪  TECH_DIFFICULTIES  CREDITS
```

...or matches the speaker pattern `^([A-Za-z][A-Za-z0-9_]*(?:\s[A-Z][A-Za-z0-9_]*)*):\s*$`, or is a bare duration (`^\d+(\.\d+)?s?$`).

## Node Layout

Every node created by `makeNode()` gets:
- an id `bsm_<n>` (sequential)
- a `_vine` position: `x = 80 + (n % 5) * 220`, `y = 80 + floor(n / 5) * 160` (5-column grid layout for the VINE editor)
- `next` set on the *previous* node once a new node is created (singly linked chain)

The graph always starts with `{ type: 'start' }` as `bsm_0`. If the script produces no further nodes that get linked (edge case), a guard step links `start.next` to the first node with a different id than `start`.

## Output Shape

`compileBsm(text)` returns:

```js
{
  meta: { name, channel, category, host, length, type },
  broadcastGraph: { _start: '<node id>', nodes: { [id]: nodeData } },
  messages: [...],     // flat list of display/spoken text, in order encountered
  assets: [...],       // [{ id, name, type: 'ascii', content }]
  rooms: [...],        // zone IDs from ROOM directives, deduped, ordered
  cameras: [...],      // unique CAM numbers, first-seen order
  npcIds: [...],       // all NPC entity ids referenced (actors + npc_anchor nodes)
  actorIds: [...],     // entity ids declared via @actor, in declaration order
  _debug: {
    unknownDirectives: [...],   // lines that couldn't be classified
    nodeTypes: { type: count }, // tally of node types produced
    unresolvedSpeakers: [...],  // [{ label, fallback }] for SPEAKER: lines with no matching @alias
  }
}
```

The five line-library envelopes — `weatherScript`, `sportsScript`, `newsScript`, `talkshowScript`,
`morningScript` — are **always** returned regardless of `@type`; the importer reads whichever one
matches `meta.type`. Their shapes are documented in each type's section below.

After import, the dev panel's broadcast UI resolves `rooms`/zone dependencies against real zone IDs (`_bcZoneRemap`) before the script can be saved — see the zone-picker flow in `broadcast.js`.

## Worked Example

```
@broadcast "Morning Wire — Pilot"
@channel NEWS1
@category news
@host npc_anchor_dana
@length 90
@type live

::actors
@actor npc_anchor_dana
@alias npc_anchor_dana DANA
::endactors

TITLE morning_wire_logo
2s

NPC npc_anchor_dana
DANA:
Good morning, wastes. Top story tonight: the Rust District blackout.

CAM 1 wide shot of the district
ROOM zone_rust_district

OVERLAY district_map
Rust District
Power: OFFLINE

3s

ACTION npc_anchor_dana shuffles papers

MUSIC outro_sting
Thanks for tuning in.
MUSIC_END

CREDITS 30
EXECUTIVE PRODUCER
Dana Vale

WRITTEN BY
J. Marlowe

END_CREDITS

END
```

This produces: a `title_card` node, a `wait(2)` node, an `npc_anchor` for `npc_anchor_dana`, a `say` node (raw dialogue), a `camera_cut` node (camera `1` recorded), a room dependency (`zone_rust_district`, no node), an `overlay` node with graphic id `district_map`, a `wait(3)` node, an `npc_action` node ("shuffles papers"), a `music` node (`song: 'outro_sting'`, `text: 'Thanks for tuning in.'`), and finally a `credits` node with `duration: 30` and the credits text block.

### CREDITS block

```
CREDITS [seconds]
<free text — roles, names, blank lines>
END_CREDITS
```

- Optional integer or float after `CREDITS` sets `duration` on the node (e.g. `CREDITS 30`). Without it, `duration` is omitted and the renderer decides how long to display.
- The entire block between `CREDITS` and `END_CREDITS` is stored verbatim as `text` — no special sub-parsing. Blank lines, all-caps role headings, and name lines are purely a convention for readability.
- Produces `{ type: 'credits', text, duration? }`.

---

# Weather Broadcasts (`@type weather`)

A **weather** `.bsm` is not a linear script — it's a **line library** for a weathercaster character. The file supplies pools of lines keyed to weather *situations*; at air time the broadcast runner reads the live 7-day forecast (`weather_forecast`, owned by [plugins/weather](../plugins/weather/index.js)) and **assembles a fresh segment every broadcast**, choosing one line at random from each pool whose key matches the actual conditions, and filling `{tokens}` from the forecast numbers. Same file, different report every day the weather shifts.

This keeps the *voice* (the weatherman's personality, the station's tone) in the authored `.bsm`, and the *facts* (which day is a blizzard, how cold, how windy) in the live forecast. The author never hardcodes "Tuesday is cold" — they write cold-day lines and the runner decides when to use them.

## How it differs from `live`/`scripted`

| | `live` / `scripted` | `weather` |
|---|---|---|
| Body | ordered directives → linked VINE chain | pools of interchangeable lines |
| Order | authored | assembled at air time from the forecast |
| Repeatable | plays the same each time | re-rolls per broadcast against current forecast |
| Compiler output | `broadcastGraph` chain | `weatherScript.pools` (graph generated at air time) |

All the header directives (`@broadcast`, `@channel`, `@category`, `@host`, `@length`) and the `::actors` block work exactly as before. `@host` is the weathercaster (an `npc_*` id); every assembled line is spoken by that anchor.

**Acted live.** Weather forecasts are always presence-gated: the assembled graph is flagged `_requireHost`, so the weathercaster NPC must be physically in the channel's studio zone for the report to air. If they're absent the channel drops to camera-idle (a live shot of the empty studio) and then to technical difficulties — exactly like a `live` channel — and the host's lines are also spoken aloud in the studio room. Give the channel a `studio_zone_id` and place the host there (the BSM importer does both automatically).

**Extra weather-only headers:**

| Directive | Effect |
|---|---|
| `@titlecard <graphic_id>` | Shows this graphic as a `title_card` before the report each airing. Pair it with a `::asset <graphic_id>` block (ASCII or `<svg>…</svg>`) — the importer uploads the asset to `media_graphics` under that id. |

**Line comments.** Any line starting with `#` is ignored by the compiler (top-level and inside `::lines` blocks), so you can annotate a weather library freely.

## The `::lines` block

Line pools use a block marker in the same family as `::asset` / `::actors`:

```
::lines <pool_key>
line option one
line option two
line option three
::endlines
```

- Each **non-empty** line inside is one interchangeable alternative; blank lines are ignored. The runner picks one at random (equal weight) each time the pool is invoked.
- Lines may contain `{tokens}` (below) and the usual dialogue text. No `SPEAKER:` prefixes inside a pool — the speaker is always `@host`.
- Declare the same key twice and the pools **merge** (append), so you can group lines however reads best.
- A pool whose key the runner never needs is simply unused; a needed-but-missing pool is skipped (or falls back to a neutral built-in — see [Fallbacks](#fallbacks)).

## Pool keys

Keys are a controlled vocabulary in four groups. Dotted sub-keys let the runner prefer a specific variant and fall back to the base key (`intro.morning` → `intro`).

### 1. Framing pools — segment scaffolding, chosen once per broadcast

| Key | When | Notes |
|---|---|---|
| `intro` | sign-on / cold open | Optional time variants: `intro.morning`, `intro.afternoon`, `intro.evening`, `intro.night`. Runner prefers the current-time key, falls back to `intro`. |
| `today.lead` | hand-off into current conditions | "Here's what you're breathing right now…" |
| `forecast.lead` | hand-off into the 7-day walk | "Looking down the barrel of the week…" |
| `outro` | sign-off / toss back to studio | |

### 2. Condition pools — spoken for *today and each forecast day*

One pool per `weatherType`. Keyed `sky.<type>`:

`sky.clear` · `sky.fog` · `sky.haze` · `sky.cloudy` · `sky.overcast` · `sky.rain` · `sky.sleet` · `sky.snow` · `sky.thunderstorm` · `sky.blizzard` · `sky.storm`

These carry the bulk of the report. Write several per type.

### 3. Modifier pools — added when a value is *notable*

**Temperature** — the runner maps `tempC` to a band and pulls one line. Bands (°C):

| Key | Range |
|---|---|
| `temp.frigid` | `< -10` |
| `temp.cold` | `-10 … 3` |
| `temp.cool` | `3 … 12` |
| `temp.mild` | `12 … 20` |
| `temp.warm` | `20 … 28` |
| `temp.hot` | `28 … 36` |
| `temp.scorching` | `> 36` |

**Wind** — keyed to the same bands as the forecast panel's `windLabel`:

`wind.calm` (`<6`) · `wind.breezy` (`6–20`) · `wind.windy` (`20–39`) · `wind.strong` (`39–62`) · `wind.gale` (`≥62` kph)

**Humidity** — `humid.dry` (`<35`) · `humid.comfortable` (`35–65`) · `humid.humid` (`65–85`) · `humid.oppressive` (`>85` %)

The runner only voices wind/humidity when they're worth a mention — wind in `calm`/`windy`/`strong`/`gale` (`breezy` stays quiet), humidity in `dry`/`oppressive`. Temperature is voiced for today only, never for forecast days.

### 4. Severe-weather warnings — invoked when a day's `severity ≥ 0.45`

Keyed to the dominant severe channel (the runner derives it from the forecast — cold/heat from `tempC`, wind from `windKph`, type from `weatherType`):

`warn.cold` · `warn.heat` · `warn.wind` · `warn.blizzard` · `warn.storm` · `warn.generic` (fallback)

These are the "gear up before you go out there" beats — they line up with the ⚠ telegraph the forecast panel already shows (see [systems-weather-extreme.md](systems-weather-extreme.md)).

### 5. Forecast-walk transitions — spoken before each day ahead

Keyed by lead time so the runner can say "tomorrow" vs "by the weekend":

`ahead.tomorrow` (day 1) · `ahead.midweek` (days 2–4) · `ahead.weekend` (days 5–6) · `ahead.next` (generic fallback for any day)

### 6. Trend pools — chosen once by comparing the week's arc

The runner compares day-0 to the week to pick one: `trend.warming` · `trend.cooling` · `trend.clearing` · `trend.deteriorating` · `trend.steady`.

## Tokens

The runner substitutes `{token}` from the forecast day currently being described (per-day tokens) or from week aggregates (week tokens). Unknown tokens are stripped to empty and logged once per assembly (`[broadcast] weather: unknown tokens`).

**Per-day** (the day this line describes):

| Token | Value |
|---|---|
| `{weather}` | weatherType, human-spaced ("thunderstorm") |
| `{temp}` | that day's temperature, in the viewer's unit (server formats; raw feed is integer °C) |
| `{feels}` | feels-like temperature |
| `{wind}` | wind speed (km/h) |
| `{windLabel}` | Calm / Breezy / Windy / Strong / Gale |
| `{humidity}` | relative humidity % |
| `{precip}` | precip chance % |
| `{day}` | `today` / `tomorrow` / weekday name (later days) |
| `{date}` | raw `MM-DD` |

**Week-level** (intro / trend / outro):

| Token | Value |
|---|---|
| `{hiTemp}` / `{loTemp}` | week's temperature extremes |
| `{season}` | winter / spring / summer / autumn |
| `{severeCount}` | number of days ahead flagged severe |
| `{worstDay}` | `{day}` label of the most severe day |
| `{host}` | the weathercaster's display name |

## Assembly order

Each broadcast the runner builds this beat sequence, each beat a `say` node anchored to `@host`:

0. `title_card` (if `@titlecard` is set)
1. `intro[.timeofday]`
2. `today.lead`
3. **Today:** `sky.<type>` → `temp.<band>` → `wind.<band>` (if notable) → `humid.<band>` (if notable) → `warn.<channel>` (if today is severe)
4. `forecast.lead`
5. **For each of days 1–6:** `ahead.<leadtime>` → `sky.<type>` → `warn.<channel>` (if severe)
6. `trend.<arc>`
7. `outro`

Each beat becomes a `say` node anchored to `@host`, so lines render as `Weathercaster says, "…"` on-air and reach passive listeners as `[TV] "…"`. The chain has no explicit loop node — when it ends the walker restarts at `_start` on its own.

## Fallbacks

The report degrades gracefully so a thin file still airs:
- Missing framing pool (`intro`/`outro`/`*.lead`) → that beat is skipped.
- Missing `sky.<type>` → a neutral built-in (`Conditions right now: {weather}, {temp} degrees.` for today, `{day}: {weather}, around {temp} degrees.` for a forecast day) so no gap.
- Missing `temp`/`wind`/`humid`/`warn`/`ahead`/`trend` pool → that garnish beat is skipped.

**Minimum viable file:** `@type weather`, `@host`, an `intro`, an `outro`, and a `sky.*` pool for each weather type you expect to see. Everything else is enrichment.

## Compiler & runtime contract (as built)

For `@type weather`, `compileBsm(text)` ([bsm-compiler.js](../client/devpanel/js/bsm-compiler.js)) returns the standard envelope **plus** a `weatherScript` field and leaves `broadcastGraph` minimal (just the `start` node — the real graph is generated at air time):

```js
weatherScript: {
  pools: { [poolKey]: [line, line, ...] },   // from ::lines blocks
  host:  meta.host,                          // also force-added to npcIds so the importer places it
  title: meta.titlecard || '',               // @titlecard graphic id
}
```

- The compiler special-cases `::lines <key>` … `::endlines` exactly like `::asset` (collect the block, split into non-empty lines, append to `pools[key]`; re-declared keys merge). Without this the pool body would fall through to the linear parser and be mis-read as stage directions.
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): a weather file is saved with `playback_mode = 'weather'`, `loop = 1`, `override_duration = @length`, and its `weatherScript` stored in the `media_broadcasts.weather_pools` JSONB column (`{ pools, host, title }`). The importer still creates/places the host NPC and a studio like any hosted broadcast.
- **Runner** ([plugins/broadcast/index.js](../plugins/broadcast/index.js)): when a playlist item has `playback_mode === 'weather'`, `getCurrentMessage` calls `getWeatherGraph(item)`, which reads the live forecast from `getEnvironmentState()`, maps values → bands, runs the assembly order (leading with a `title_card` if `@titlecard` is set), picks/​interpolates lines, and builds a normalised VINE graph via `assembleWeatherGraph`. The graph is cached on the item and re-rolled only when the forecast's lead day advances (the date is folded into the graph's `_broadcastId`, so the walker's blackboard resets and the report re-airs fresh for the new day). Downstream — `say` nodes, host anchoring, passive `[TV] "…"` leakage, off-air handling — reuses the existing broadcast walker. The one walker change: it treats a graph with `_requireHost` (which `assembleWeatherGraph` sets) exactly like a live channel — a `liveActed` flag drives presence gating and in-studio speech, so weather forecasts require the host on stage regardless of the channel's own type.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS weather_pools JSONB;` in `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads (it `SELECT`s the column in `loadChannelRuntimes`).

## Worked example

```
@broadcast "The Ash Report"
@channel WX7
@category news
@host npc_sunny_calloway
@length 90
@type weather

::actors
@actor npc_sunny_calloway
@alias npc_sunny_calloway SUNNY
::endactors

::lines intro.morning
Morning, survivors. Sunny Calloway, and yes, that's still my name.
Rise and shine — or just rise, {season} isn't doing "shine" this week.
::endlines

::lines intro
Sunny Calloway here with the only forecast that still bothers.
::endlines

::lines today.lead
Here's what the sky's serving right now.
Step outside and this is what's waiting for you.
::endlines

::lines sky.clear
Clear skies. Enjoy the exposure while the ozone lets you.
Not a cloud up there — just the usual haze of regret.
::endlines

::lines sky.rain
Rain, {precip}% of it, because of course.
It's coming down. Bring something that isn't you to get wet.
::endlines

::lines sky.blizzard
A full blizzard. {temp} degrees, feels like {feels}, feels like dying.
Whiteout conditions. If you can read this, you're already indoors — stay there.
::endlines

::lines temp.frigid
{temp} degrees. Your extremities are on their own out there.
::endlines

::lines temp.mild
A frankly suspicious {temp} degrees. Don't trust it.
::endlines

::lines wind.gale
And a {wind} km/h gale to file your teeth down.
::endlines

::lines warn.blizzard
⚠ Severe: {day} is a killer. Thermal gear or a will — your call.
::endlines

::lines warn.cold
⚠ Bundle up {day}. {temp} degrees will stop your heart if the muggers don't.
::endlines

::lines forecast.lead
Looking down the week, and I use "looking" generously.
::endlines

::lines ahead.tomorrow
Tomorrow:
::endlines

::lines ahead.midweek
Midweek, around {day}:
::endlines

::lines ahead.weekend
Come the weekend:
::endlines

::lines trend.cooling
Trend's downhill — we shed {hiTemp} today for {loTemp} by week's end.
::endlines

::lines trend.deteriorating
It gets worse. {severeCount} severe days ahead, {worstDay} the worst of it.
::endlines

::lines outro
That's the weather. It's still trying to kill you. Back to you in the studio.
Sunny Calloway. Stay sealed.
::endlines

END
```

At air time, on a day-0 blizzard with a cold snap midweek, the runner might assemble: *intro.morning → today.lead → sky.blizzard → temp.frigid → wind.gale → warn.blizzard → forecast.lead → ahead.tomorrow → sky.snow → … → trend.deteriorating → outro* — every value in `{}` filled from that day's real forecast row.

---

# Sports Broadcasts (`@type sports`)

A **sports** `.bsm` is the [weather](#weather-broadcasts-type-weather) format's sibling: a **line library** plus **team and player pools**, not a linear script. But where weather *reads* a live forecast, there is **no game in the world** — so the sports runner **simulates a whole game** each airing: it takes the matchup the league's round-robin schedule assigns to the current game slot, deals a lineup to each side from the player pool, plays the sport out (for baseball: nine innings of randomized at-bats, tracking the score), and assembles a fresh play-by-play graph from the matching pools with `{tokens}` filled from the live game state. Same file, a different matchup and a **different final score every slot**.

The authored `.bsm` holds the *voice* (the announcer's tone, the team/player flavour) and the *event language* (how a home run, a strikeout, a walk-off is called). The runner owns the *game* (who plays, what happens, what the score is). The author never hardcodes "team A wins 5–3" — they write home-run lines and the sim decides when to use them.

Two sports are implemented: **`baseball`** (DEADBALL, innings) and **`hockey`** (CLUSTER PUCK, periods). `@sport` is the ONLY thing that selects a simulation — nothing else in the pipeline branches on it. Each sport is a module under [plugins/broadcast/sports/](../plugins/broadcast/sports/); a module that exports `narrate` is handed the middle of the broadcast and writes its own play-by-play, which is how hockey narrates a running clock and live strength instead of innings and bases. See [systems-broadcast.md](systems-broadcast.md#sports--two-codes-one-pipeline).

## How it differs from `live` / `scripted`

| | `live` / `scripted` | `weather` | `sports` |
|---|---|---|---|
| Body | ordered directives → linked chain | condition-keyed line pools | event-keyed line pools + team/player pools |
| State source | none | live 7-day forecast (read) | a simulated game (generated) |
| Repeatable | same each time | re-rolls per forecast day | **a new game every league slot (3 in-game hours)** |
| Acted live | live channels only | yes (`_requireHost`, host must be in-studio) | **no** — announcer is a name, no NPC, no presence gating |
| Compiler output | `broadcastGraph` chain | `weatherScript` | `sportsScript` |

**Not acted live, no NPC.** The announcer is a **name string**, not an `npc_*` id. Sports lines are spoken as plain narration (the announcer's voice), so nothing is added to `npcIds` and **importing a sports broadcast never spawns a studio NPC**. It runs happily on an ordinary `playlist`/`loop` channel with no studio zone.

## Headers

All the standard headers (`@broadcast`, `@channel`, `@category`, `@length`) work as usual. Sports adds:

| Directive | Effect |
|---|---|
| `@type sports` | Switches the file to the sports line-library format. |
| `@sport baseball` | Which simulation to run: `baseball` or `hockey`. This is the only sport discriminator in the pipeline. |
| `@announcer "Chip Vega"` | The play-by-play voice — a display **name**, surrounding quotes stripped. Available in lines as `{announcer}`. Not an NPC. |
| `@airtime 19` | Optional. Feature only the game(s) covering these **in-game hours** (0–23, comma/space-separated) each day — one full game, snapped to the grid, at a fixed time of day; the channel is dark otherwise. Omit for **continuous** back-to-back games all day. The league itself always plays a full slate on the in-game clock (one game every 3 in-game hours → 8/in-game-day, ~1/team/day) and the standings advance regardless of what's aired; `@airtime` only picks which of those games this channel *shows*. `19` → the 18:00–21:00 game. |

## Team & player pools

Two block markers in the `::asset` / `::lines` family:

```
::teams
The Rustpile Rats
Coldwater Kingfishers
...
::endteams

::players
Rodriguez
"Big" Halvorsen
...
::endplayers
```

- `::teams` — one team name per line. The league runs a **round-robin** over the whole pool: each game slot gets a deterministic pairing (daily team order + a rolling window into the schedule; home/away flips on a per-slot coin; an odd roster is padded with a BYE that gets skipped). Surrounding quotes are stripped, so a name can be quoted if you like.
- `::players` — one player name per line. The runner deals **nine** to each team's lineup plus a pitcher, per airing. Give it plenty (20+) so lineups vary. If the pool is thin, a built-in default set backs it up.
- Blank lines and `#` comments inside either block are ignored.

## Line pools (`::lines <key>`)

Same `::lines <key>` … `::endlines` collector as weather. Each non-empty line is one interchangeable alternative; the runner picks one at random per event and fills `{tokens}`. Re-declared keys merge. Dotted keys fall back to the base key (`hr.grand` → `hr`).

**Framing (once per game):** `intro` · `matchup` · `final` · `outro`
**Half-inning framing:** `half.top` (away bats) · `half.bottom` (home bats) — fallback `half`
**Routine outs:** `atbat.strikeout` · `atbat.groundout` · `atbat.flyout` · `atbat.popout` — fallback `atbat.out`
**Non-scoring baserunners:** `atbat.single` · `atbat.double` · `atbat.triple` · `atbat.walk`
**Scoring plays:** `rbi` (non-homer runs batted in) · `hr.solo` · `hr.grand` (grand slam) · `hr` (fallback)
**After any scoring play:** `score.update` (the running-score line)
**Situational:** `walkoff` (home wins with a late go-ahead run) · `recap.half` (a sparse score checkpoint at the end of every third inning)

Only the keys the runner needs are voiced; a missing pool is skipped (framing) or falls back (`atbat.*` → `atbat.out`/`atbat.single`, `hr.*` → `hr`).

## Tokens

Filled per event from the live game state; unknown tokens strip to empty.

| Token | Value |
|---|---|
| `{announcer}` | the announcer's name |
| `{away}` / `{home}` | the two team names |
| `{team}` | the team currently batting |
| `{batter}` | the batter in this at-bat |
| `{pitcher}` | the opposing pitcher |
| `{inning}` / `{inningOrd}` | inning number / ordinal (`3` / `3rd`) |
| `{half}` | `top` or `bottom` |
| `{section}` / `{sectionOrd}` | generic section term (`inning` / `3rd`) — for cross-sport lines |
| `{outs}` | outs in the current half after this play |
| `{rbi}` / `{runs}` | runs driven in on this play |
| `{awayScore}` / `{homeScore}` | current score |
| `{battingScore}` / `{fieldingScore}` | score of the batting / fielding side |
| `{leader}` | the team currently ahead (empty if tied) |
| `{lead}` | current margin |

## Assembly order (baseball)

Each airing the runner simulates the game, then walks its beats: `intro → matchup →` for each half-inning: `half.top`/`half.bottom` → per at-bat (`atbat.*`, or `rbi` / `hr.*` + `score.update` on scoring plays, `walkoff` if it ends the game), sparse `recap.half` at the turn of every third inning → `final → outro`. Routine outs are **sampled and capped** per half so pacing stays watchable (each line holds ~5 s on air). Scoring plays and framing are always called.

## Score-bug overlay

Every spoken line also carries a **score-bug** — a persistent on-screen graphic (top-left of the TV panel) that stays up for the whole game and updates in place as the state changes. It's authored by nobody: the runner derives it from the live game state and attaches it to each `say` node; the walker returns it and `broadcastTick` pushes a `tv_overlay` (`overlayType: 'scorebug'`) to every TV watcher alongside the line. The client keeps one persistent element (`#tv-scorebug`), updated per line, cleared on off-air / channel-change / power-off.

**The payload is sport-agnostic by design**, so other sports reuse the same bug:

```js
{
  overlayType: 'scorebug',
  sport: 'baseball',
  away, home,            // full team names
  awayAbbr, homeAbbr,    // 2–3 letter tags (derived by sportsAbbr)
  awayScore, homeScore,
  status,                // free-text state line: "TOP 3rd" / "FINAL" / (other sport) "Q3 08:42"
  outs,                  // OPTIONAL, baseball-specific — renders the out dots
  bases: [b1, b2, b3],   // OPTIONAL, baseball-specific — renders the base diamond
}
```

The client renderer (`_applyScorebug` in [tv.js](../client/game/js/panels/tv.js)) **always** draws the two team/score rows (leader highlighted) and the `status` line. It draws the diamond only when `bases` is present and the out dots only when `outs` is present. So a future sport emits the same overlay with `status` set to its clock/period and simply omits `bases`/`outs` — same bug, no diamond — or adds its own optional field plus a matching client branch. Baseball's final bug drops `outs`/`bases` too, showing just the score under `FINAL`.

## Compiler & runtime contract (as built)

- `compileBsm(text)` returns the standard envelope **plus** a `sportsScript` field for `@type sports`, and leaves `broadcastGraph` minimal (just the `start` node — the real graph is generated per airing):
  ```js
  sportsScript: {
    sport: 'baseball',           // @sport
    announcer: 'Chip Vega',      // @announcer — a name, NOT added to npcIds
    teams:   [ '…', … ],         // ::teams block
    players: [ '…', … ],         // ::players block
    pools:   { [key]: [line,…] },// ::lines blocks
    title:   '',                 // @titlecard graphic id
    airSlots: [6],               // @airtime → in-game 3h block indices, or null for continuous
  }
  ```
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): saved with `playback_mode = 'sports'`, `loop = 1`, `override_duration = @length`, `sports_pools` = the `sportsScript` (new `media_broadcasts.sports_pools` JSONB column). No studio/host is created — asset-only.
- **Runner** ([plugins/broadcast/index.js](../plugins/broadcast/index.js)): a `sports` playlist item that is `sportsAiring` calls `getSportsGraph(sportsScript, sportsSlotIndex(), worldSeriesOverride())`, which caches the assembled game and re-rolls when the global game slot advances. `assembleSportsGraph` runs `sportsSimGame` (the baseball simulator) and emits a `say`-node chain via `sportsPick`/`sportsFill`. The graph does **not** set `_requireHost`, so no presence gating — it plays on any channel. Downstream (`say` nodes, dedup, passive `[TV] "…"` leakage, off-air) reuses the existing broadcast walker unchanged.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS sports_pools JSONB;` in `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads (it `SELECT`s the column in `loadChannelRuntimes`).

## Worked example

See [data/scripts/baseball.bsm](../data/scripts/baseball.bsm) for the full library. A minimal viable file needs `@type sports`, `@sport baseball`, `@announcer`, a `::teams` pool (2+), a `::players` pool, and at least the `intro`, `half.top`, `half.bottom`, `atbat.out`, `hr`, `rbi`, `score.update`, `final`, and `outro` pools. Everything else is enrichment.

### Hockey (`@sport hockey`)

See [data/scripts/hockey.bsm](../data/scripts/hockey.bsm). The event language is different because the game is: the beat is a **scoring chance**, not an at-bat, and the pools are keyed to what the sim emits — `section.start`/`section.end` (periods), `shot.save|glove|pad|blocked|wide|post|breakaway`, `goal` + `goal.pp|sh|en`, `hattrick`, `penalty`/`penalty.major`, `powerplay.start`/`powerplay.kill`, `penalty.fight`/`fight.result`, `boards`, `scrum`, `injury`, `death`, `pull`, `ot.intro`, `shootout.*`, the three faceoff pools and the `intermission.*` set.

Three rules a hockey library must respect:

- **TEXT PARITY.** Every beat the sim emits has a pool, including the casualties and the pulled goalie. Nothing may exist only as an animation on the rink sub-screen — a player reading the text gets the whole game. Regress asserts both directions: every beat type is narratable and every pool is reachable.
- **The three faceoff pools are not interchangeable.** `faceoff.center` means somebody just scored or a period just started; `faceoff.zone` means the puck died in that end; `faceoff.neutral` is everything else. The sim picks the dot by the RULE, so the pool is a fact about the game, not a flavour choice. (`faceoff` remains as a fallback and is expected never to fire.)
- **`::players` needs `clubs x 6` names minimum.** Skaters are dealt into permanent club rosters, so a short pool starts sharing men between clubs.

---

# News Broadcasts (`@type news`)

A **news** `.bsm` is the third [weather](#weather-broadcasts-type-weather)/[sports](#sports-broadcasts-type-sports) sibling: a **line library** (the same `::lines <key>` pools), not a linear script. Where weather *reads* a forecast and sports *simulates* a game, news pulls the **live dynamic stories** — the very ones the tablet's News app shows — from the news generator ([plugins/tablet/news-generator.js](../plugins/tablet/news-generator.js), via the `news.getStories` action) and reads them out through **anchors and field reporters**. Each airing assembles a fresh bulletin: cold open → anchor greeting → a full anchor→reporter segment per top story → a rundown of the next few headlines → a kicker → sign-off, one random line per matching pool with `{tokens}` filled from each story and the show's cast.

The authored `.bsm` holds the *voice* (the network's tone, the anchors' patter); the runner owns the *facts* (which stories lead tonight). The author never hardcodes a headline — they write anchor/reporter lines and the runner drops the live stories into them.

## How it differs from `live` / `weather` / `sports`

| | `live` / `scripted` | `weather` | `sports` | `news` |
|---|---|---|---|---|
| Body | ordered directives → chain | condition-keyed pools | event-keyed pools + team/player pools | segment-keyed pools |
| State source | none | live 7-day forecast (read) | a simulated game (generated) | the live news generator (read) |
| Repeatable | same each time | re-rolls per forecast day | re-rolls a new game each cycle | **re-rolls a fresh bulletin per refresh bucket** |
| Acted live | live channels only | yes (`_requireHost`, host in-studio) | no — announcer is a name | **no** — anchors/reporters are names, no NPC |
| Compiler output | `broadcastGraph` chain | `weatherScript` | `sportsScript` | `newsScript` |

**Not acted live, no NPC.** Anchors, reporters, and the announcer are **name strings**, not `npc_*` ids. Lines are spoken as plain narration, so nothing is added to `npcIds` and **importing a news broadcast never spawns a studio NPC**. It runs on an ordinary `playlist`/`daily`/`news` channel with no studio zone.

## Headers

All the standard headers (`@broadcast`, `@channel`, `@category`, `@length`) work as usual. News adds:

| Directive | Effect |
|---|---|
| `@type news` | Switches the file to the news line-library format. |
| `@anchor "Brick Hardline"` | A studio anchor — a display **name**, quotes stripped. **Repeatable**: the first `@anchor` is the lead anchor (`{anchor}`), a second is the co-anchor (`{anchor2}`). Not an NPC. |
| `@reporter "Ronnie Vasquez"` | A field reporter — a display **name**. **Repeatable**; the runner rotates through them for `{reporter}` (live-on-scene segments). Not an NPC. |
| `@announcer "The Voice of…"` | Optional station/voiceover name, available as `{announcer}` (cold opens, stings, sign-off). Not an NPC. |
| `@meteorologist "Skip Vandermeer"` | The weather desk — a display **name**, available as `{meteorologist}`. Optional; with no `@meteorologist` the co-anchor reads the weather. Not an NPC. |
| `@titlecard <graphic_id>` | Shows this graphic as a `title_card` before the bulletin each airing. Pair it with a `::asset <graphic_id>` block (ASCII or `<svg>…</svg>`). |
| `@theme <song>` | Intro sting — an `audio_songs` or `audio_samples` name (quote names with spaces). With a `@titlecard` it rides the card (song starts as the card appears, card holds for the theme's length); without one it plays as a standalone `music` node. |

## Line pools (`::lines <key>`)

Same collector as weather/sports — each non-empty line is one interchangeable alternative, the runner picks one per beat and fills `{tokens}`, re-declared keys merge.

**Framing (once per bulletin):** `open` (station cold open, announcer voice) · `anchor.intro` (anchor greeting) · `rundown.lead` (the "also tonight" pivot) · `kicker.lead` (feel-good pivot) · `kicker` (the light closer itself) · `outro` (anchor sign-off) · `signoff` (station sign-off, announcer voice)
**Per featured story (top 3):** `alert` (breaking sting — lead story only) · `anchor.banter` (toss to co-anchor between later stories) · `story.lead` (anchor reads the headline) · `handoff.reporter` (toss to a field reporter) · `reporter.scene` (reporter on scene, expands the story `{body}`) · `reporter.vox` (fabricated "man on the street", optional) · `handoff.back` (reporter tosses back) · `pundit.take` (a hot take, used for stories that *don't* get a field reporter) · `anchor.reaction` (anchor editorializes)
**Rundown (the next few headlines):** `rundown.item` (one per remaining headline)
**Weather desk (`wx.*`, between the rundown and the kicker):** `wx.toss` (anchor tosses to the desk) · `wx.open` (weathercaster sign-on) · `wx.sky.<weatherType>` (conditions now, and for the day named ahead) · `wx.warn.<channel>` (severe-day warning) · `wx.trend.<key>` (the week's arc) · `wx.back` (toss back) · `wx.reaction` (co-anchor reacts)

**The weather segment is real.** It reads the SAME live 7-day forecast `@type weather` does (`env.forecast`) and uses the same pool suffixes — `wx.sky.*` mirrors [weather](#weather-broadcasts-type-weather)'s `sky.*`, `wx.warn.*` its `warn.*`, `wx.trend.*` its `trend.*` — so a **hero event day is named as ITSELF** (`wx.sky.acid`, `wx.warn.ion`) rather than as the ordinary weather underneath it. Unlike DOOMCAST it does not walk the whole week: it reports today, then the first severe day ahead (or tomorrow if there is none), then the trend. **A file that authors no `wx.*` pool at all gets no weather segment** — the beats are skipped whole, so the desk is purely additive for any other news show.

The lead story always gets a reporter field segment; the others get a reporter ~half the time and a `pundit.take` otherwise. Missing pools skip gracefully; `story.lead`, `handoff.reporter`, `reporter.scene`, and `rundown.item` have neutral built-in fallbacks so a thin file still airs.

## Tokens

Filled per beat; unknown tokens strip to empty.

| Token | Value |
|---|---|
| `{anchor}` | the lead anchor (first `@anchor`); alternates with `{anchor2}` across stories |
| `{anchor2}` | the co-anchor (second `@anchor`, or the lead if only one) |
| `{reporter}` | a field reporter for this segment (rotated from `@reporter`) |
| `{announcer}` | the station/voiceover name (`@announcer`) |
| `{scene}` | a real outdoor district the reporter is "live" from (a random named zone) |
| `{headline}` | the story's headline (from the news generator) |
| `{body}` | the story's body copy — the reporter expands on this |
| `{byline}` | the story's outlet/byline |
| `{meteorologist}` | the weather desk name (`@meteorologist`) |
| weather tokens | inside a `wx.*` line only: `{weather}` `{temp}` `{feels}` `{wind}` `{windLabel}` `{humidity}` `{precip}` `{day}` `{season}` `{hiTemp}` `{loTemp}` `{severeCount}` `{worstDay}` — identical to [weather](#weather-broadcasts-type-weather)'s |

## Assembly order

Each airing: `title_card` (if `@titlecard`) → `open` → `anchor.intro` → **for each of the top 3 stories:** (`alert` on the lead / `anchor.banter` after) → `story.lead` → *either* `handoff.reporter` → `reporter.scene` → (`reporter.vox`) → `handoff.back` *or* `pundit.take` → `anchor.reaction` → **rundown:** `rundown.lead` → `rundown.item` × remaining → **weather:** `wx.toss` → `wx.open` → `wx.sky.*` (today) → `wx.warn.*` (if today is severe) → `wx.sky.*`/`wx.warn.*` (the day ahead) → `wx.trend.*` → `wx.back` → `wx.reaction` → `kicker.lead` → `kicker` → `outro` → `signoff`. Each beat is a `say` node; with no anchor NPC the lines render as plain `[TV] "…"` narration. The bulletin re-rolls when the refresh bucket (in-game day + a 5-minute window) advances, so it picks up new live stories as the world's news changes; within a bucket the chain loops.

## Compiler & runtime contract (as built)

- `compileBsm(text)` returns the standard envelope **plus** a `newsScript` field for `@type news`, and leaves `broadcastGraph` minimal (just the `start` node — the real graph is assembled per airing):
  ```js
  newsScript: {
    anchors:   [ 'Brick Hardline', 'Chastity Vale' ], // @anchor lines, in order — NOT added to npcIds
    reporters: [ 'Ronnie Vasquez', … ],               // @reporter lines
    announcer: 'The Voice of Raptor',                 // @announcer
    meteorologist: 'Skip Vandermeer',                 // @meteorologist ('' ⇒ the co-anchor reads it)
    pools:     { [key]: [line, …] },                  // ::lines blocks
    title:     'rnn_title',                           // @titlecard
    theme:     'rnn_sting',                           // @theme
  }
  ```
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): saved with `playback_mode = 'news'`, `loop = 1`, `override_duration = @length`, `news_pools` = the `newsScript` (new `media_broadcasts.news_pools` JSONB column). No studio/host is created — asset-only.
- **Runner** ([plugins/broadcast/index.js](../plugins/broadcast/index.js)): a `news` playlist item calls `getNewsGraph(item, nowMs)`, which fetches live stories via `dispatchAction('news.getStories')` (falling back to a couple of built-in stories if the generator is unreachable) and caches the assembled graph, re-fetching when the refresh bucket advances. `assembleNewsGraph` emits the `say`-node chain via `newsPick`/`newsFill`. The graph does **not** set `_requireHost`, so no presence gating — it plays on any channel. Downstream (`say` nodes, passive `[TV] "…"` leakage, off-air) reuses the existing broadcast walker unchanged.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS news_pools JSONB;` in `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads (it `SELECT`s the column in `loadChannelRuntimes`).

## Worked example

See [data/scripts/raptor_news.bsm](../data/scripts/raptor_news.bsm) for the full library — **Raptor News Network**, a Fox-News-parody nightly bulletin. A minimal viable file needs `@type news`, at least one `@anchor`, and the `anchor.intro`, `story.lead`, and `outro` pools; add `@reporter` plus `handoff.reporter`/`reporter.scene`/`handoff.back` for on-scene segments, and the rest is enrichment. Import it through the dev panel (Broadcast → Import BSM), pick a channel, and it airs a fresh, live-sourced bulletin on loop.

**Editing the shipped shows without a browser.** Raptor News and DOOMCAST are the two shows whose rows are regenerated straight from the file: [scripts/content/build-news-weather.mjs](../scripts/content/build-news-weather.mjs) recompiles both `.bsm` files into `news_pools` / `weather_pools` and touches nothing else. Run it after editing either file — the row and the file drifting apart is not hypothetical: DOOMCAST carried its acid/ion pools in git for weeks while the row that actually aired had none of them, so Dex fell through to the generic fallback on the two days it mattered most.

---

# Talk-Show Broadcasts (`@type talkshow`)

The line-library format's **live-acted** member. Where weather/sports/news read or simulate facts and read them out through disembodied **names**, a talk show is the reverse: a fixed procedural structure PERFORMED on the studio stage by **real `npc_*` cast**. Each night the runner assembles a fresh episode from the `::lines` pools — a cold open, a monologue, a guest interview, a sponsor break, a sign-off — and attributes every line to a cast NPC via `npc_anchor`, so it airs exactly like a hand-scripted `@type live` show but never repeats.

The signature trick is the **roaming guest**: ONE reusable NPC (`@guest`) is renamed to a different persona from the `::guests` pool every night, materialises in a random unobserved corner of the city (no players, no cameras watching), walks across the map to the studio to perform, and slips away to vanish backstage once the show's done. If the guest hasn't reached the stage by airtime the channel presence-gates to "technical difficulties" — it is genuinely live.

## How it differs from `live` / `weather` / `sports` / `news`

| | `live`/`scripted` | `weather` | `sports` | `news` | `talkshow` |
|---|---|---|---|---|---|
| Body | ordered directives → chain | condition pools | event pools + rosters | segment pools | segment pools + guest personas |
| State source | none | live forecast | simulated game | live news generator | **the night's guest persona (chosen daily)** |
| Repeatable | same each time | re-rolls per day | new game each cycle | re-rolls per bucket | **fresh episode each in-game day** |
| Acted live | live channels only | yes (host in-studio) | no — a name | no — names | **yes — real cast NPCs + a roaming guest** |
| Spawns NPCs | live channels | the weathercaster | no | no | **host + sidekick + reusable guest** |
| Compiler output | `broadcastGraph` chain | `weatherScript` | `sportsScript` | `newsScript` | `talkshowScript` |

**Acted live, real NPCs.** `@host`, `@sidekick`, and `@guest` are `npc_*` ids (not names) — they ARE added to `npcIds`, so importing a talk show places the host + sidekick on-stage and creates the reusable guest. The assembled graph is stamped `_requireHost`, so the live walker presence-gates it on ANY channel (no cast in the studio ⇒ camera-idle → technical difficulties).

## Headers

Standard headers (`@broadcast`, `@channel`, `@category`, `@length`) plus:

| Directive | Effect |
|---|---|
| `@type talkshow` | Switches the file to the talk-show line-library format. |
| `@host npc_john_akerson` | The desk host — a real `npc_*` id (`meta.host`). Commutes in on schedule; the `{host}` token. |
| `@sidekick npc_graham_mercer` | The announcer/bandleader — a real `npc_*` id. Does the cold open; the `{sidekick}` token. |
| `@guest npc_guest` | The **reusable** guest NPC, renamed to a different persona each night. |
| `@airtime 22` | The nightly slot. On import the show **auto-pins a daily playlist slot to this in-game 3-hour block** on its channel (reuses the sports slot clock; `22` → 21:00–24:00) and flips the channel to daily mode, so it's locked to its broadcast time with no manual scheduling. Omit ⇒ a single all-day slot (always available). |
| `@titlecard <graphic_id>` | Graphic shown as a `title_card` before each episode. Pair with a `::asset` block. |
| `@theme <song>` | Intro theme; plays the matching `audio_songs` row if one exists, else the cue text shows briefly. |

## `::guests` block — the persona pool

One persona per line: `Name | Title | theme_song | tag` (title, theme, and tag all optional). The runner picks one per in-game day (deterministically, so every TV agrees) and renames `@guest` to it; `{guest}` = the name, `{title}` = the title blurb. The optional **`tag`** names a persona-specific *exchange* pool (`interview.<tag>`), so that guest gets **on-topic signature Q&A** in the interview.

```
::guests
Lenny "Lucky" Malone | professional lottery winner, eight-time and counting | | lucky
Dr. Priya Sundaram | the surgeon who transplants organs she prints at home | | surgeon
::endguests
```

## Line pools (`::lines <key>`)

Same collector as the other library formats. Pools (all optional; missing ones skip):

**Cold open (sidekick):** `open` (the "it's the show!" intro, 1–2 a night) · `tease` (tonight's line-up, 2–3) · `announce_host` (brings out `{host}`)
**Monologue (host):** `monologue` (opening jokes — **4–5 a night**, so the length itself varies, and **every one lands on an `audience` beat**). A SHORT draw off a DEEP pool is the point: segment length is what a viewer sits through, pool depth is what makes it a different show tomorrow, so drawing deeply just burns the material faster. Tag every line with a `[topic]` (below) — the pool is *supposed* to hold several jokes about rent, and none of them are supposed to share a night.
**News bit (host):** `newsjoke` (one joke about a **real headline** — see below; folded in right after the monologue, once a show). Each line embeds a `{headline}` token; the runner fills it from the freshest story in the live news feed, **preferring a LIVE/event-sourced story over a wire/tabloid filler**, and strips the headline's trailing punctuation so the line supplies its own. The bit **skips cleanly** on nights the feed is empty or the file has no `newsjoke` pool, so it's purely additive to the monologue jokes.
**Host ↔ sidekick two-handers:** `greeting` (the host arrives at the desk and talks to the announcer — the beat that establishes these two have worked together for years; the second one drawn is reused as the throw-back after the interview) · `banter` (a mid-show back-and-forth, ~70% plus a ~30% second round). Both are **alternating-turn** lines (below). `greeting` is authored **host-first**, `banter` **sidekick-first** — at a desk the announcer needles and the host recovers, so the host gets the last word.
**Optional beats (some nights only):** `sidekick_aside` (a one-way heckle mid-monologue, no reply, ~45%) · `desk_bit` (a host riff before the guest, ~50%)
**Crowd (unattributed):** `audience` (a short reaction beat — after **every** monologue joke, after each heckle, and between most interview exchanges) · `applause` (the neutral entrance swell) · `applause_host` / `applause_guest` (swells that NAME who is walking out, and so may only play over that entrance). These air as **ambient** stage business: dim italic, no speaker, not read aloud. They are the show's only timing instrument — nothing else on air can hold a beat — so the `audience` pool has to be deep enough that one episode never repeats itself, and varied in KIND (laughs, groans, silences, small accidents) or it reads as a laugh track.
**Interview (host ↔ guest):** `guest_intro` (host welcomes `{guest}`, `{title}`) · `interview` (**generic** exchanges) · `interview.<tag>` (a guest's **signature** exchanges). Each exchange is one authored unit — **`host question >> guest answer`** — so the question and reply always belong together (no index-paired non-sequiturs). The night's deck blends up to two of the guest's signature exchanges with generic ones and runs **4–6** exchanges, plus a ~35%-chance follow-up
**Guest no-show:** `guest_noshow` — host/sidekick two-handers played **instead of** the interview when the guest isn't in the studio at showtime. See [the chair gate](#the-chair-gate).

### `>>` is a change of speaker

A `>>` separates **turns**, and a line may carry as many as the bit needs:

```
{host}, I looked up your contract today. >> And? >> And it's beautiful work, Graham.
```

Turns alternate between the pool's two speakers, starting with whichever the pool is authored for. This is what keeps a setup, its reply and the topper together through the shuffle — the alternative is authoring them as separate pool entries that may never be dealt together. An interview exchange is simply the two-turn case (host, then guest).

> **Never prefix a line with a speaker name.** The runtime already airs every line as `<name> says, "…"`, so an authored `{sidekick}: …` says the announcer's name twice.

### `[topic]` — the anti-repetition tag

A line may open with a bracketed topic:

```
[career] What would you tell young people considering your line of work? >> Aim low.
[career] Did you always know this was your calling? >> I knew the day everyone told me to stop.
```

**At most one line per topic reaches an episode.** Untagged lines are unconstrained, so tagging is opt-in and a pool can be half-tagged without surprise; the tag is stripped before air. This exists because those two lines are one question in two costumes, and drawing both — which the runner did — made the show look like it wasn't listening. **Tag by what a question wants, and tag coarsely:** near-duplicates are the failure mode, so `career` deliberately covers origin, advice, calling and quitting rather than splitting them.
**Break:** `commercial` (a sponsor read, spoken as studio narration, 1–2)
**Sign-off (host):** `signoff` (thanks the guest, goodnight, 2–3)

## Tokens

| Token | Value |
|---|---|
| `{host}` | the host NPC's live name (`@host`) |
| `{sidekick}` | the sidekick NPC's live name (`@sidekick`) |
| `{guest}` | tonight's guest persona name (from `::guests`) |
| `{title}` | tonight's guest persona title/blurb |
| `{headline}` | *(`newsjoke` pool only)* a real headline from the live news feed, punctuation stripped |

## Assembly order

Each in-game day: `title_card` (if `@titlecard`) → `music` (`@theme`) → **cold open:** `open` ×1–2 → `tease` ×2–3 → `announce_host` → `greeting` (host ↔ sidekick) → **monologue:** `monologue` ×4–5, each one followed by an `audience` beat → *(if a headline is available)* `newsjoke` ×1 → *(~45%)* `sidekick_aside` → *(~70%)* `banter` → *(~50%)* `desk_bit` ×1–2 → *(~30%)* a second `banter` → **interview:** `guest_intro` → **[chair gate]** → *guest present:* (`interview` / `interview.<tag>`: host Q → guest A) ×4–6 → *(~35%)* one follow-up → *(~50%)* a closing `greeting` throw-back · *guest absent:* `guest_noshow` ×2–3 → **break:** `commercial` ×1–2 (narration) → **sign-off:** `signoff` ×2–3. The **counts and the optional beats are seeded off the day**, so both the *content* and the *shape* of the episode change night to night — it doesn't go stale. Each spoken beat is an `npc_anchor` (switching the on-stage speaker) followed by `say` nodes; the walker resolves the anchor's *current* name at air time, so the renamed guest is attributed correctly. Each interview beat is an authored **`question >> answer`** pair, so the host's question and the guest's reply always match; the per-night deck blends up to two of the guest's `interview.<tag>` **signature** exchanges (the host asks about THEIR thing) with the generic `interview` pool, so each guest sounds like themselves. The episode re-rolls when the in-game day advances (new guest, new jokes, new structure); within a day it's stable so every TV agrees, and it only airs during the `@airtime` slot.

## Guest lifecycle (roaming NPC)

The reusable guest carries a bespoke behaviour graph ([`makeTalkshowGuestGraph`](../plugins/broadcast/index.js)) assigned by the schedule recalc when the show is put on a channel playlist:

```
start → IS_BROADCAST_SCHEDULED?
   true  → TALKSHOW_APPEAR → GO_TO_WORK → AT_WORK → wait → loop
   false → TALKSHOW_HIDE → wait → loop
```

- **`TALKSHOW_APPEAR`** (engine AI action): while the show is on the clock and the guest is still parked in its hidden backstage zone (`home_zone` = `zone_talkshow_backstage`, an exit-less limbo), it teleports the guest into a random zone a few tiles from the studio that has **no players and no active camera/planted device** watching (`pickUnobservedZoneNear` + the `isZoneWatched` bridge). `GO_TO_WORK` then walks it onstage one zone per tick.
- **`TALKSHOW_HIDE`** (engine AI action): off the clock, the moment the guest is standing somewhere unobserved it vanishes back to backstage; otherwise it walks toward the studio's exterior exit and re-checks each tick.
- The host + sidekick use the ordinary `makeDefaultStudioGraph` commute (studio ↔ home).
- **Call time (`TALKSHOW_GUEST_CALL_LEAD`).** The **whole cast** is staffed from **one slot before** `@airtime`. This was originally the guest's privilege alone, "because it's the only one of the three with a journey to make" — which stopped being true once the cast were housed. Graham Mercer sleeps in a Solenne apartment and `GO_TO_STUDIO` walks one tile per 15-second AI tick, so a host who comes on shift at the instant the slot opens is a quarter of an hour of stand-by card away from his own couch. The lead was never about the guest; it was about the walk. Daily non-talk-show slots get the same treatment on a different clock — see the **call time** note in [systems-broadcast.md](systems-broadcast.md#npc-hosts--studio-staffing).

### The chair gate

The interview is wrapped in a `condition` node, `NPC_IN_STUDIO { npc_id: <@guest> }`, evaluated **at air time**. Guest on the studio floor ⇒ the interview plays; guest absent ⇒ the `guest_noshow` cover plays instead. Both branches rejoin at the commercial, so the show reaches its sign-off either way.

This is load-bearing, not belt-and-braces. Without it the failure was **silent and total**:

- the guest came on shift *at* airtime, so it began walking as the theme played and was still en route through the interview;
- the say-node **room-authority rule** (a line belongs to whoever is standing there to say it) dropped every one of its answers without a trace;
- the `_requireHost` stand-by only fires when **nobody at all** is on the floor — and the host and sidekick were both there, so the show sailed on.

What aired was the host asking four questions in a row and nothing answering. The call time makes that rare; the gate makes it *visible* — and turns the worst night into a segment, which is the most late-night outcome available.

`NPC_IN_STUDIO` is a general broadcast condition, not a talk-show special case: any graph can ask whether an actor is actually on set before committing to a segment built around them. A channel with no `studio_zone_id` answers **true** (presence isn't modelled there), so it never cuts a segment on a technicality.

## Compiler & runtime contract (as built)

- `compileBsm(text)` returns the standard envelope **plus** a `talkshowScript`, and leaves `broadcastGraph` minimal (just `start` — the episode is assembled per airing):
  ```js
  talkshowScript: {
    host: 'npc_john_akerson', sidekick: 'npc_graham_mercer', guestNpc: 'npc_guest', // added to npcIds
    guests: [ { name, title, theme, tag }, … ],  // ::guests (tag → interview.<tag>)
    pools:  { [key]: [line, …] },             // ::lines blocks (interview pairs: 'Q >> A')
    title:  'tonight_show_logo',              // @titlecard
    theme:  'tonight_theme',                  // @theme
    airSlots: [7],                            // @airtime → in-game 3h block index
  }
  ```
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): saved with `playback_mode = 'talkshow'`, `loop = 1`, `override_duration = @length`, `talkshow_pools` = the `talkshowScript` (`media_broadcasts.talkshow_pools` JSONB). The host + sidekick are placed in the studio; the reusable guest is created tagged `flags.talkshow_guest`. No cassette (it's acted live, not a recording). On save, `ensureTalkshowSlot` **auto-pins a daily playlist slot at each `@airtime` block** and sets the channel to daily mode; once the cast NPCs exist the import triggers a schedule recalc to staff them — so the show self-schedules to its broadcast time.
- **Runner** ([plugins/broadcast/index.js](../plugins/broadcast/index.js)): a `talkshow` playlist item that is `talkshowAiring` calls `getTalkshowGraph(item, nowMs)` → `assembleTalkshowGraph`, cached per in-game day. A per-minute `talkshowHeartbeat` renames the guest to the day's persona regardless of viewers. `recalculateNpcSchedules` staffs the cast (read from `talkshow_pools`, since the stored graph is start-only) and assigns the guest its lifecycle graph + backstage home. The schedule checker ties the cast's "on-shift" window to `@airtime` (not the channel loop position).
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS talkshow_pools JSONB;` in `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads.

## Worked example

See [data/scripts/Tonight_Show.bsm](../data/scripts/Tonight_Show.bsm) — **The Tonight Show with John Akerson** (host `npc_john_akerson`, announcer `npc_graham_mercer`, reusable `npc_guest`, eighteen guest personas each with their own signature-exchange pool, `greeting`/`banter`/`guest_noshow` two-handers, plus `sidekick_aside`/`desk_bit` optional beats). A minimal file needs `@type talkshow`, `@host`, `@guest`, a `::guests` line, and the `monologue` and `interview` (Q&A pairs) pools; add `@sidekick` + `open`/`announce_host`/`signoff` for the full show, and `interview.<tag>` pools to give each guest an on-topic, distinct voice.

> **The `.bsm` is the source; the shipped row is compiled from it.** For the Tonight Show that loop is a script, not a browser — edit the file, then run `node scripts/content/build-tonight-show.mjs`, which rewrites `talkshow_pools` on the content row (and nothing else). Same reasoning as [build-cluster-puck.mjs](../scripts/content/build-cluster-puck.mjs): the dev-panel import writes to your local DB and relies on `content:export`, which lets the file in git and the row that airs drift apart silently.

For a new show, import through the dev panel (Broadcast → Import BSM) and pick a channel — the show **auto-schedules to its `@airtime`** (a daily slot on that channel) and staffs the cast automatically, so it airs a fresh, live-acted episode at its broadcast time each night with no manual scheduling.

---

# Morning Shows (`@type morning`)

The line library's **fifth** member, and the talk show's daytime cousin. Where a talk show's
variable is the night's **guest**, a morning show's variable is the **world**: every segment is
keyed to something live — the cold open reads the clock and the thermometer, the weather window
reads the forecast, the Basin Beat reads the news generator, the run-in reads the city's standing
alerts, and the ticker is *assembled from those facts* rather than authored. Like a talk show it is
**acted live** on the studio couch by two real `npc_*` hosts, so it presence-gates.

The couch's back-and-forth is the point: every pool is authored as an **exchange pair** —
`host line >> cohost line`, the same `>>` convention the talk-show interview uses — so the setup and
the deadpan always travel together no matter which alternative the day draws.

## How it differs from the other library types

| | `weather` | `news` | `talkshow` | `morning` |
|---|---|---|---|---|
| State source | live forecast | live news generator | the night's guest persona | **the live world: clock, forecast, news feed, alerts** |
| Repeatable | re-rolls per day | per refresh bucket | fresh episode per in-game day | **fresh episode per in-game day** |
| Acted live | yes (weathercaster) | no — names | yes — cast + roaming guest | **yes — two resident hosts** |
| Airtime | its playlist slot | its playlist slot | `@airtime` block | **its playlist slot** (no separate gate) |
| Compiler output | `weatherScript` | `newsScript` | `talkshowScript` | `morningScript` |

## Headers

Standard headers (`@broadcast`, `@category`, `@length`) plus:

| Directive | Effect |
|---|---|
| `@type morning` | Switches the file to the morning-show line-library format. |
| `@host npc_am_pace` | The lead host — a real `npc_*` id. Speaks the **left** side of every pair; the `{host}` token. |
| `@cohost npc_am_dorn` | The second host on the couch — a real `npc_*` id. Speaks the **right** side; the `{cohost}` token. |
| `@titlecard <graphic_id>` | Graphic shown before the show. Pair with a `::asset` block. |
| `@theme <song>` | Intro theme; rides the title card when both are present. |

Both hosts are added to `npcIds`, so the importer places them in the studio and the schedule recalc
staffs them for the show's slot.

## Line pools (`::lines <key>`)

Every pool is a set of interchangeable **`host >> cohost` pairs** (a line with no `>>` is spoken by
the host alone). Within one show a pool never repeats itself — each key is shuffled into a deck and
walked — so two stories in a row can't land on the same reaction.

**Cold open:** `open` (reads `{time}`/`{temp}`/`{day}`) · `couch` (small talk, ~60% of mornings)
**Weather window:** `weather.banner` (the caption strip, `TEXT | SUBTEXT`) · `weather.<type>` — one per weather type (`weather.rain`, `weather.snow`, `weather.ash`, `weather.fog`, …), falling back to `weather` · `weather.severe` (only when the day's `severity ≥ 0.45`) · `weather.ahead` (tomorrow; skipped when the forecast hasn't populated yet)
**The Basin Beat (live news):** `beat.banner` · `beat.lead` (the host reads `{headline}`) · `beat.detail` (~50%, expands `{body}`/`{byline}`) · `beat.aside` (~40% on the lead story)
**The running order (shuffled, see below):** `segment.banner` · `segment` (the recurring bit — the hotplate, whatever the file supplies) · `mailbag.banner` · `mailbag` (a letter, read out and not really engaged with) · `sportsdesk.banner` · `sportsdesk.baseball` / `sportsdesk.hockey` (falling back to `sportsdesk`; reads the live league table) · `audience` (the couch addresses the people actually watching) · `plug` (the network plugging its own evening)
**Your Morning Run-In (live alerts):** `runin.banner` · `runin.martial_law` · `runin.radiation` · `runin.blackout` (`{outages}`) · `runin.storm` · `runin.clear` — the runner picks **worst-first**, falling back to `runin`
**Ticker & close:** `ticker.lead` (a plain prefix, not a pair) · `signoff` · `credits` (**not** alternatives — every line is a card of the same roll, so they're joined)

Banner pools are authored as `TEXT | SUBTEXT` and become a `lower_third` overlay. Missing pools skip
cleanly; `open`, `weather`, `beat.lead` and `signoff` have neutral built-in fallbacks so a thin file
still airs.

## Tokens

| Token | Value |
|---|---|
| `{host}` / `{cohost}` | the two hosts' live names |
| `{time}` `{day}` `{date}` `{season}` | the in-game clock and calendar |
| `{temp}` `{feels}` `{weather}` `{wind}` `{windLabel}` `{precip}` | conditions right now |
| `{hi}` `{lo}` `{tomorrow}` `{tomorrowTemp}` | the week's arc (falls back to today's reading before the forecast populates) |
| `{headline}` `{body}` `{byline}` | *(Basin Beat pools)* the live story being read |
| `{outages}` | *(run-in pools)* grid-connected zones currently dark |
| `{leader}` `{leaderRecord}` | *(sports desk)* the Deadball table-topper, off the same standings cache the play-by-play reads |
| `{puckLeader}` `{puckRecord}` | *(sports desk)* the same for the CPhL (`W-L-OTL`) |
| `{tonight}` `{tonightTime}` | *(plug)* the day's last real slot on this channel, and its clock time |
| `{watching}` | **RUNTIME token** — how many sets are tuned in *at the moment the line is spoken*, not at assembly. See below. |

**Runtime tokens.** Almost everything above resolves when the day's show is assembled, which is what
makes one show identical on every TV. `RUNTIME_TOKENS` (`{watching}`, `{viewers}`, `{clock}`,
`{until_four}`) are the exception: the assembler deliberately leaves them standing and the graph
walker fills them as the line airs (`_scriptedTokens`), so a couch that says *"all {watching} of you"*
is telling the truth about the room. Any other unknown token is still blanked at assembly, so a typo
can never leak a brace to air.

## Assembly order

Each in-game day: `title_card` (+`@theme`) → `open` → *(~60%)* `couch` → **weather:** banner →
`weather.<type>` → *(severe only)* `weather.severe` → *(~70%, forecast permitting)* `weather.ahead` →
**Basin Beat:** banner → per story ×2: `beat.lead` → *(~50%)* `beat.detail` → *(~40%, lead only)*
`beat.aside` → **the running order** → **run-in:** banner → `runin.<worst alert>` →
**`ticker`** (assembled: conditions · standing alerts · the headlines that missed the couch) →
`signoff` → `credits`. Counts and optional beats are **seeded off the day**, so both the content and
the shape change morning to morning; within a day it's stable, so every TV in the city agrees.

**The middle of the show is a running order, not a fixed spine.** Five segments — `segment`,
`mailbag`, `sportsdesk`, `audience`, `plug` — are **shuffled and weighted per day**, so two mornings
differ in SHAPE rather than just in which line came out of the same slot. Each is allowed to find
nothing and drop out: no game played yet ⇒ no sports desk (a desk with no sport is worse than none),
nothing on later ⇒ no plug, no pool authored ⇒ not in today's programme. The two segments that are
**never** shuffled and never optional are the **run-in** (it tells you whether the street outside will
kill you, and it belongs immediately before the sign-off) and the **sign-off** itself.

## Compiler & runtime contract (as built)

- `compileBsm(text)` returns the standard envelope **plus** a `morningScript`, leaving
  `broadcastGraph` minimal (just `start`):
  ```js
  morningScript: {
    host: 'npc_am_pace', cohost: 'npc_am_dorn',   // real npc_ ids — added to npcIds
    pools: { [key]: [line, …] },                  // ::lines blocks (pairs: 'host >> cohost')
    title: 'coldwater_am_logo', theme: 'coldwater_am_theme',
  }
  ```
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): saved with
  `playback_mode = 'morning'`, `loop = 1`, `override_duration = @length`, `morning_pools` = the
  `morningScript` (`media_broadcasts.morning_pools` JSONB). Both hosts are placed in the studio. No
  cassette — it's acted live, not a recording. Unlike a talk show it does **not** auto-pin a slot:
  its airtime is whatever daily playlist slot you give it.
- **Runner** ([plugins/broadcast/index.js](../plugins/broadcast/index.js)): a `morning` playlist item
  calls `getMorningGraph(item, nowMs)`, which reads the live forecast + `news.getStories` + the
  `martial_law`/`nuclear_event` world flags + the power map **once per in-game day**, then
  `assembleMorningGraph` emits the `npc_anchor`/`say` chain. The graph is stamped `_requireHost`, so
  no hosts in-studio ⇒ camera-idle → technical difficulties. `recalculateNpcSchedules` staffs the two
  hosts from `morning_pools` (the stored graph is start-only), and the ordinary daily-slot branch of
  `IS_BROADCAST_SCHEDULED` puts them on-shift for the slot.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS morning_pools JSONB;` in
  `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads.

## Worked example

See [data/scripts/coldwater_am.bsm](../data/scripts/coldwater_am.bsm) — **Coldwater A.M.** on KSAB-TV,
hosted by Bijou Pace (`npc_am_pace`) and Hal Dorn (`npc_am_dorn`), 27 pools covering seven weather
types, the Basin Beat, the hotplate segment and five run-in conditions. A minimal file needs
`@type morning`, `@host`, `@cohost`, and the `open` and `signoff` pools; everything else is
enrichment.

---

# Game Shows (`@type gameshow`)

The line library's **sixth** member, and the only broadcast type a **player** can be inside.
Where a talk show's variable is the night's guest and a morning show's variable is the world,
a game show's variable is the **item catalog**: every round is a question about what something
in the world is actually worth, dealt live from `items.value`. The file supplies the *patter*;
the game supplies the *questions*. Add an item to the world and it becomes a prize with no
authoring at all.

Like a talk show it is **acted live** by real `npc_*` cast and presence-gates. What is unique to
it is the **audience**: anyone standing in the channel's `studio_zone_id` when a round opens is a
contestant, and the existing studio-camera relay televises their answer to every set in the city.
Nobody in the studio is **not** a failure mode — the contestants are then three name-only
strangers, and the episode plays out exactly as well. Participation is always possible, never
required.

## How it differs from the other library types

| | `news` | `talkshow` | `morning` | `gameshow` |
|---|---|---|---|---|
| State source | live news generator | the night's guest persona | the live world | **its `@subject` — the item catalog, or the districts and orders** |
| Repeatable | per refresh bucket | fresh episode per in-game day | fresh episode per in-game day | **fresh lots per in-game day** |
| Acted live | no — names | yes — cast + roaming guest | yes — two resident hosts | **yes — host + optional sidekick** |
| Player can take part | no | no | no | **yes — stand in the studio and `guess`** |
| Airtime | its playlist slot | `@airtime` block | its playlist slot | **`@airtime` block** |
| Compiler output | `newsScript` | `talkshowScript` | `morningScript` | `gameshowScript` |

## Headers

| Header | Meaning |
|---|---|
| `@type gameshow` | selects this type |
| `@host npc_…` | **required** — the real host NPC, acted on the studio floor |
| `@sidekick npc_…` | optional — the announcer who reads the prize copy |
| `@titlecard <graphic_id>` | card shown on the cold open |
| `@theme <song or sample>` | intro sting; plays over the title card |
| `@airtime <hour…>` | in-game hours to air; snapped to 3h blocks. Omit means continuous |
| `@rounds <1–4>` | how many rounds an episode plays. Omit means all four |
| `@subject <id>` | **what the show asks about** — see [Subjects](#subjects). Omit means `retail` |

**`::contestants … ::endcontestants`** — one name per line. These are **plain strings, not
`npc_` ids**: they never get bodies, never commute, never spawn. Their guesses are generated from
the episode seed, so they lose convincingly for free. This is deliberate — three walk-on NPCs a
day would need three commutes and three renames for nothing a name string doesn't already do.

## Subjects

A game show's SUBJECT is what it asks about: where the material comes from, how a round is dealt,
how an answer is typed, and how it's scored. The engine (`plugins/broadcast/gameshow.js`) owns
everything a game show has *regardless* of subject — the cast, the guess window, the purse, the
win cooldown, the studio-floor relay — and knows nothing about prices or districts. Subjects live
in `plugins/broadcast/gameshow-subjects.js`.

| `@subject` | Asks | Material | Answered with |
|---|---|---|---|
| `retail` *(default)* | "what is this worth?" | the live item catalog (`items.value`) | a number, higher/lower, or an ordering |
| `basin` | "what do you know about this city?" | the district registry, the NPC orders' own creeds, where NPCs live | a letter |

**The subject contract is ZERO QUERIES.** A subject may read the boot-loaded item cache, the world
Maps and the district registry, and nothing else. An episode is assembled on the broadcast tick, on
every channel, for every set in the city — a subject that needs a DB read is a subject that can't air.

An **unknown or absent `@subject` resolves to `retail`**, which is what every game show was before
subjects existed. A typo therefore produces a working show rather than a broken one — which is why
a build script that cares should assert its subject rather than trust it.

**Adding a subject** is a module exporting `id`, `plan` (the ordered round specs),
`episode(rand, ctx)`, `score`, `parse` and `hint`, passed to `registerGameshowSubject`.
`episode().round(spec)` returning `null` means "the world can't furnish this round today" — the
episode plays one round shorter, which is a normal outcome and not an error. The **purse is the
engine's to set, never the subject's**: prize money is calibrated against the quest economy for
every show at once, and a subject that could name its own could mint credits.

### Writing questions from authored copy

`basin` quotes the world's own prose back at the viewer, and that prose was written to be read
*about* a place rather than as a riddle — so it very often names it. The Pioneers' creed opens
"The old world is a corpse and the Pioneers refuse to keep it on life support", which quoted
verbatim is a question that answers itself. `redactAnswer` masks the answer's own name — and each
significant word of it, so "the Commercial Strip" also catches a later bare "the Strip" — before
the quote goes on air. **A new quoted category needs the same treatment**, and the regress suite
sweeps the whole corpus for a question that names its own answer.

## Rounds

### `retail`

Four fixed formats, in this order, all answered by the single `guess` verb:

| Round | Format | Player types | Wins by |
|---|---|---|---|
| 1 | **Over or under** — two lots, is the second dearer? | `guess higher` / `lower` (also `over`/`under`/`h`/`l`) | first correct answer |
| 2 | **The right price** — one lot | `guess 340` | closest **without going over**; over is elimination |
| 3 | **The lot** — three lots, order them | `guess 2 1 3` | the only top scorer; a shared best means nobody |
| 4 | **The Showcase** — one dear lot | `guess 4800` | within **±20%**, first one in |

Lot selection is **stratified** by value band (cheap under 50, mid 50–500, dear over 500) so an
episode isn't four consumables, and guarded so each round is answerable: over-or-under rejects
pairs closer than a 1.35× ratio (otherwise it's a coin flip), and the ordering round rejects
duplicate prices (otherwise there is no correct order).

### `basin`

One format, `choice`, four times — a question and lettered options, answered `guess b`. Difficulty
rises by **widening the field** (three options, then four), not by getting obscurer. Four scoring
modes were the wrong shape for a quiz: a question is right or it isn't, and one parse means the
finale can be harder without teaching a second verb.

| Round | Category | Options |
|---|---|---|
| 1 | a district, quoted from its own `blurb` | 3 |
| 2 | an order, quoted from its own creed | 3 |
| 3 | which district an NPC goes home to | 4 |
| 4 | a district again, for the Jackpot purse | 4 |

A category that can't furnish a question today (no orgs loaded, no NPC with a resolvable home
district) falls through to the next one, so a thin world plays a shorter show rather than a broken
one. **A quiz round hands over no item** — there is no lot on a plinth, and granting a random
consolation item would put untraceable loot on the studio floor.

## Line pools (`::lines <key>`)

`open`, `announce_host`, `audience_call`, `round_intro.<format>`, `showcase_intro`, `prize_copy`,
`prompt`, `stall`, `reveal`, `showcase_reveal`, `verdict_read`, `audience`, `applause`,
`commercial`, `walkoff`, `no_payout`, `signoff`, `ticker`.

The `.<format>` keys follow the subject: `retail` uses `round_intro.overunder`,
`round_intro.price` and `round_intro.lot`; `basin` uses `round_intro.choice` for every round.

**A pool drawn at random must contain no ordinals.** `retail` gets away with "Round three" in
`round_intro.lot` only because that pool is per-format and its formats are per-round. A show with
one format all the way down draws every round intro from the same pool, so a line saying "round
three" airs first about as often as it airs third — write "next" and "again" instead.

`prize_copy`, `prompt` and `reveal` accept a **`.<format>` variant** (`reveal.lot`,
`prompt.overunder`, `prize_copy.lot`, …) which wins over the generic pool when present. Use these
where a round shows more than one lot — the generic `reveal` reads a single price, which is wrong
for a three-item question.

Write prize copy **without an article**: the lot name comes from the catalog and could begin with
anything, so "A {prize}" produces "A Ooze — cassette tape".

## Tokens

**Baked at assemble time** (deterministic, known when the round is dealt). Shared by every subject:
`{host}` `{sidekick}` `{prize}` `{purse}`.

`retail` adds: `{prize2}` `{prize3}` `{price}` `{price2}` `{price3}` `{prices}` (every lot with its
price, as shown) `{order}` (the correct cheapest-first order, as prose) `{total}`.

`basin` adds: `{question}` `{options}` (the lettered options as read out) `{answer}` (letter +
text) `{answer_letter}` `{answer_text}`. Its `{prize}` is the **category** ("THE BASIN", "WHO
LIVES WHERE") rather than an object, since a quiz has no lot on a plinth.

**Resolved at airtime** (they depend on who was in the room): `{guesses}` `{contestant}`
`{guess}` `{winner}` `{verdict}`.

`{verb}` is special — it appears only in `audience_call` and is replaced with the `teachVerb`
shimmer for `guess`. **Do not write `{guess}` meaning the verb**: `{guess}` is the outcome token
and would read back somebody's bid.

Off-round every outcome token still returns prose, never `undefined` — the late-tune seeker walks
past the round nodes without firing them, so a viewer joining mid-episode can land on a reveal
line with nothing behind it.

## Assembly order

title card + theme → announcer cold open → `announce_host` → applause → `audience_call` (teaches
`guess`) → **for each round**: intro → prize copy → `gameshow_round` → prompt → 1–2 stalls →
`gameshow_reveal` → reveal line → price card → `verdict_read` → crowd beat (commercial before the
finale) → applause → `signoff` → `ticker` → `gameshow_endpass`.

`gameshow_round` and `gameshow_reveal` are **instantaneous side-effect nodes**, like `set_flag` —
they take no on-air time. **The guess window is the host's own patter between them**, so there is
never dead air waiting on a timer and the window is exactly as long as the show sounds like it is.
Lengthen it by adding `stall` lines, not by setting a duration.

**One deal per pass, not per day.** A game show owns its whole `@airtime` block, which is longer
than the show, so when the graph's chain ends the walker wraps to `_start` and plays it again.
The deal is therefore seeded on `(broadcastId, day, pass)` rather than the day alone — otherwise
the second run-through was tonight's lots at tonight's prices a second time, and sitting through
one pass handed you every answer in the next. The terminal `gameshow_endpass` node bumps the pass
counter, so the re-deal lands exactly when the old episode finishes and never mid-show. The
graph's `_broadcastId` stays keyed on the DAY on purpose: `tickBroadcastGraph` reseeks by
slot-elapsed whenever that id changes, and a seek at a pass boundary would fast-forward the new
episode to near its end. Pass 0 keeps the plain day key, so the first airing is identical on
every set.

The title card can read the money: `{purse_round}`, `{purse_showcase}` and `{paid_today}` (what
this channel has actually handed over today, in memory, reset by a restart) resolve with **no
round in play**, which is what makes them safe on a card that airs before the first lot. They are
purses, never prices — nothing in them leaks an answer.

## Prizes and the cooldown

Rounds 1–3 pay **40₵**; the Showcase pays **250₵** *and grants the actual lot* via the canonical
`GRANT_ITEM` action. A clean sweep is ~370₵ — deliberately just under the hardest quest in the
game. Credits are minted (like slots and quest rewards), so the throttle is the **cooldown**:
`player_flags.gameshow_win_cooldown` holds the epoch-ms of the last paid win and blocks another
payout for **6 real hours**. It's checked at *payout* time, not guess time — you can play and win
on air whenever you like, you just don't get paid twice, and the host has a `no_payout` line so it
reads as network policy rather than a silent no-op. **Losing costs nothing** but dignity.

## Compiler & runtime contract (as built)

- **Compiler** ([bsm-compiler.js](../client/devpanel/js/bsm-compiler.js)): `@type gameshow` gives
  `gameshowScript = { host, sidekick, contestants, pools, title, theme, airSlots, rounds }`,
  using the shared `::lines` collector. `@host`/`@sidekick` are added to `npcIds` so the importer
  spawns and places them; `::contestants` are **not**.
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): saved
  with `playback_mode = 'gameshow'`, `loop = 1`, `gameshow_pools` = the `gameshowScript`
  (`media_broadcasts.gameshow_pools` JSONB). On save, `ensureTalkshowSlot` (named for the talk
  show but generic — it reads only `airSlots`) **auto-pins a daily slot at each `@airtime`
  block** and flips the channel to daily mode.
- **Runner** ([plugins/broadcast/gameshow.js](../plugins/broadcast/gameshow.js), a sibling module
  of the plugin): a `gameshow` playlist item that is `gameshowAiring` calls
  `getGameshowGraph(item, normalize)` → `assembleGameshowGraph`, cached per in-game day. The
  episode is seeded from `${broadcastId}:${bucket}` so every TV deals the same lots.
  `recalculateNpcSchedules` staffs the cast from `gameshow_pools` (the stored graph is
  start-only). The graph is stamped `_requireHost`, so an empty studio gives PLEASE STAND BY.
- **The answer path**: `guess` → `gameshow.js` validates (in a studio, round open, one guess per
  round, format-parsed) → `sendToZone` echoes it as speech → `server/index.js` emits
  `zone.broadcast` → the studio relay puts it on air to every TV, deck and tablet on the channel.
  **No new WS message and no client code** — the relay already existed. The relay needs a
  **working camera in the studio zone**; without one the channel is in technical difficulties and
  nothing airs.
- **Prize pool**: read from the boot-loaded item cache (`getItemCache()`), so question generation
  costs **zero queries**. Filters: value 5–12000, no `drug`/`chemical`, must have a description,
  name-deduped, and **sorted by id before shuffling** — cache iteration order isn't stable across
  restarts, and an unsorted fold would make TVs disagree. `furniture.price` is deliberately NOT
  used: those rows are per-instance rather than catalog (the same flatscreen appears three times),
  half are unpriced, and the table is intentionally uncached.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS gameshow_pools JSONB;` in
  `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads.

## Worked example

See [data/scripts/the_last_lot.bsm](../data/scripts/the_last_lot.bsm) — **The Last Lot**, hosted by
Rennie Vosk (`npc_lot_vosk`) with Yolanda on the bids (`npc_lot_operator`), airing from the KSAB-TV
soundstage. It began as a `scripted` shopping channel selling confiscated municipal surplus and was
converted in place when the format became a contest. A minimal file needs `@type gameshow`,
`@host`, a `::contestants` line, and the `prompt`, `reveal` and `verdict_read` pools; everything
else is enrichment.

---

# Films (`@type film`)

A **film** is the format's only other **linear** member. Where the six library types
(`weather`/`sports`/`news`/`talkshow`/`morning`/`gameshow`) hand the runner pools and let it
assemble a fresh episode, a feature is authored shot by shot and does not re-roll — it compiles to
exactly the same `broadcastGraph` chain a `@type scripted` broadcast does. What `film` adds is
everything a two-and-a-half-hour picture needs that a five-minute scripted segment never did: a
cast who are **not** studio staff, screenplay-shaped authoring, structural cards, and a **fixed
screening time** that a viewer can be late for.

## How it differs from `scripted`

| | `scripted` | `film` |
|---|---|---|
| Body | ordered directives → linked chain | the same chain |
| `SPEAKER:` lines | `npc_anchor` + `say` (`raw`) — the speaker is an NPC | pre-rendered `say` (`verbatim`) — the speaker is a **display name** from `::cast` |
| Spawns NPCs | on a live channel, yes | **never** — `npcIds` is empty by construction |
| Bare prose lines | unclassified (`_debug.unknownDirectives`) | **narration** — a screenplay action line |
| Airtime | wherever it's placed on the playlist | pins itself to an `@airtime` block on import |
| Late tuner | joins mid-segment | **joins the reel already running** (real-time seek) |
| Compiler output | `broadcastGraph` | `broadcastGraph` + `filmScript` |

**A film is a recording, not a stage.** Its characters were photographed years ago; there is
nobody in a studio performing them tonight. So a film never adds an id to `npcIds`, the importer
never spawns or moves an NPC for it, the graph never sets `_requireHost`, and it never
presence-gates — it plays on any channel with no studio zone and no cast on the floor. This is
why `SPEAKER:` compiles differently here: the line is rendered `Name says, "…"` at compile time
and emitted with `style: 'verbatim'`, which the walker airs exactly as written (never re-wrapped
by an anchor) while still leaking to bystanders in the room as `[TV]` speech.

## Headers

Standard headers (`@broadcast`, `@channel`, `@category`, `@length`) plus:

| Directive | Effect |
|---|---|
| `@type film` | selects this type |
| `@presents "Meridian Reclamation Pictures"` | distributor card, auto-spliced in front of the picture |
| `@rating "CERTIFIED — UNSUITABLE FOR CORPORATE VIEWING"` | certification card, same |
| `@director "Auggie Prine"` | the "A film by" card, same |
| `@titlecard <graphic_id>` | main title, shown via `TITLE`; pair with a `::asset` block |
| `@theme <song>` | rides the title card, as everywhere else |
| `@airtime <hour…>` | **the screening start.** Snapped to in-game 3-hour blocks and auto-pinned on import by `ensureFilmSlots`, which flips the channel to daily mode and reserves **as many consecutive blocks as `@length` needs** (wrapping past midnight). Omit means a single all-day slot |
| `@airday <day...>` | **which weekday(s) it screens.** Names or 1-7 (Mon=1), comma or space separated, repeatable. Written to each row's 7-bit `days` mask. Omit and it screens every day, which for a feature is usually wrong |
| `@length <seconds>` | the picture's **real** runtime; stored as `override_duration` |

`@presents` / `@rating` / `@director` are spliced between `start` and the first authored node
after the body pass, so they play in front of the feature without the author hand-writing three
overlays. Omit them and there is no pre-roll.

## The `::cast` block

```
::cast
DEACON | Deacon Vox | the voice
AUGGIE | Auggie Prine | the director
::endcast
```

`LABEL | Display Name | role` — the role blurb is optional and is carried in `filmScript.cast`
for the record, not spoken. `LABEL` is what `SPEAKER:` lines use, matched case-insensitively.
A speaker with no `::cast` row still works: the ALL-CAPS screenplay label is lowercased and
Title-Cased for the display name, so a one-line walk-on needs no declaration. **These are names, never `npc_` ids** — putting an
`npc_…` id here would just produce a character called "Npc Something".

## Structural directives

Authored for films, but they compile to ordinary `overlay` nodes and are legal in any linear
script — the walker, the late-tune seeker and the TV panel already carry them.

| Directive | Node | Notes |
|---|---|---|
| `ACT 2 — The Boom` | `overlay` `act_card` (8 s) | everything after the em-dash is the subtitle |
| `SLUG THE BASIN \| 2079 — SUMMER` | `overlay` `lower_third` (6 s) | place before the pipe, time after; extra fields join with an em-dash |
| `INTERMISSION [sec]` | `overlay` `intermission` (60 s default) | the reel change. A viewer who tunes in during one **sees an intermission** — it is real airtime, not a marker |
| `LETTERBOX on` / `off` | `overlay` `letterbox` (**0 s**) | a **persistent** matte, not a card. Costs no airtime, stays up until switched off, and also puts the picture in filmic grade (`.tv-filmic`) |
| `FADE out [sec]` / `FADE in [sec]` | `overlay` `fade` | one-shot optical transition; `out` dips to black and holds, `in` lifts |

Everything else in the linear vocabulary — `SHOT`, `MUSIC`, `TITLE`, `CAM`, `TICKER`, `CREDITS`,
bare durations, `WAIT` — behaves exactly as documented above.

**Bare prose is narration.** In a film, a line that matches no directive and has no active NPC
compiles to a `say` node with `style: 'narration'` rather than being logged as an unknown
directive. Screenplay action lines are the bulk of a feature, and wrapping every "He crosses the
lot" in `SHOT`/`SHOT_END` would be all scaffolding and no script. The cost is that a typo becomes
a spoken line instead of a compiler warning — check `_debug.nodeTypes` if a film's `say` count
looks higher than the dialogue you wrote.

## A feature is longer than a block

A block is 3 in-game hours, but its **real** length is `(24 h ÷ timeScale) ÷ 8`. On the world's
default 3× clock that is **sixty real minutes** — so a two-hour picture pinned to a single block is
cut off at the slot edge, an hour in, every night.

`ensureFilmSlots` therefore reserves a **run** of consecutive blocks sized from `@length`
(`filmBlocksNeeded`), laid end to end from `@airtime` and wrapping past midnight if the picture
runs that long. `@airtime 21` means *starts at 21:00*, not *is over by midnight*.

The run then has to be treated as one screening. Each block is its own playlist row, and every
other broadcast type genuinely wants **per-slot** elapsed — so films get `filmRunElapsed`, which
reads a `film_run_start` stamp that `ensureFilmSlots` writes into every row of a showing. Without it a three-block
feature restarts from the distributor card every time the schedule rolls into the next hour.

**A weekly film is an exception row, not a mode.** The playlist already carries a 7-bit `days`
mask per row, and `_pickDailySlot` resolves ties by SPECIFICITY — fewest days set wins. So a
Saturday-only film row simply outranks the everyday row underneath it; nothing else on the channel
has to be edited, gapped or duplicated. A run crossing midnight shifts weekday per reel
(`filmDayMask`), so a Saturday-night feature's small-hours blocks are **Sunday** rows.

Blocks are reserved WHOLE, so the last one always has a remainder — 174 minutes of picture
sits in 180 minutes of schedule. The runner therefore checks the run-elapsed against the
real runtime (`filmRuntime`, from `@length`) and stops airing once the reel is finished. The
leftover tail plays the channel’s **commercial pool** via `_fillCommercialTail` — the same rule
`_loopFillOrNull` applies to any looping graph slot — cut off cleanly when the schedule moves on,
and the graph blackboard is parked so tomorrow’s screening seeks from the top. A finished film must
never fall through to the generic paths: the walker would wrap to `_start` and put the distributor
card back up, and the flat-message path would read the picture’s entire dialogue list out as bare
lines. Without that the walker’s wrap-to-`_start` behaviour would
put the distributor card and the first act back up in the last few minutes of the screening.

## Joining the reel already running

This is the reason a film wants an `@airtime` run rather than a playlist slot. The picture runs
on a wall clock: the walker's late-tune seeker (`_seekGraph`) walks the chain forward by however
much of the screening has already elapsed, so two players who switch a set on at different
moments see the **same shot**, and a player who is twenty minutes late has missed twenty minutes.

One conversion makes this work. Every other daily slot is authored on the **in-game** clock, so
the elapsed seconds the scheduler hands the walker are in-game seconds. A feature is authored in
**real** minutes — a 150-minute runtime is 150 minutes of somebody's evening — so the film branch
in `getCurrentMessage` divides the elapsed time back down by the world's `timeScale` before
seeking. Get this wrong and a viewer ten minutes late finds the reel at the credits.

Two things the runner has to carry explicitly rather than infer:

- **The run head is stamped**, not derived from which slots touch. Inference merged two separate
  one-block showings that happened to abut (`@airtime 9 12`) into a single run, so the second
  showing seeked past its own ending; and an all-day picture formed a ring with no head at all.
- **The letterbox matte is remembered across a seek.** It holds no airtime, so the seeker walks
  straight past it — and for a feature nearly every viewer is a late one. `_seekGraph` records
  the state it passed (`bb.pendingLetterbox`) and the walker raises it on the first tick.

The seek's step budget also scales with the graph (`max(2000, nodes × 2)`); the old fixed cap
would strand a latecomer partway through a feature-length chain.

## Compiler & runtime contract (as built)

- **Compiler** ([bsm-compiler.js](../client/devpanel/js/bsm-compiler.js)): `@type film` and the
  `::cast` block are **pre-scanned** before the body pass (a film's speaker lines compile
  differently, and `@type` may legally sit anywhere in the header). Output is the standard
  envelope plus:
  ```js
  filmScript: {
    presents, rating, director,          // pre-roll card copy
    cast: [{ label, name, role }],       // DISPLAY NAMES — never reaches npcIds
    title, theme,                        // @titlecard / @theme
    airSlots: [7],                       // @airtime → 3h block indices, or null
    runtime: 9000,                       // @length, seconds
  }
  ```
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): saved
  with `playback_mode = 'film'`, `loop = 1`, `override_duration = @length`, an **empty** `messages`
  list (a film's flat message list is its whole script over again — 874 lines and 82 KB for a
  feature — and nothing reads it), `film_meta` = the
  `filmScript` (`media_broadcasts.film_meta` JSONB). A film is **not** in `spawnsNpcs`, so no
  studio NPC is created or moved. It does get a **cassette** in the production room, like every
  other non-live import — a film is a recording, and a recording has a physical copy.
- **Slot pinning**: the broadcast POST/PUT route calls `ensureFilmSlots` for
  `playback_mode === 'film'` — a sibling of `ensureTalkshowSlot` that pins a **run** of blocks
  sized from the runtime rather than a talk show's single block.
- **Runner** ([plugins/broadcast/index.js](../plugins/broadcast/index.js)): a `film` playlist item
  in the daily path ticks its stored `broadcastGraph` through the ordinary walker with the
  real-time-converted seek described above. `broadcastDuration` reserves the whole screening block
  (measuring the chain would give the picture's real runtime, which is not the same thing as slot
  seconds). Nothing else in the walker is film-specific.
- **Client** ([tv.js](../client/game/js/panels/tv.js)): `act_card` and `intermission` render as
  full-screen cards; `letterbox` and `fade` are **persistent/overlay layers** handled before the
  transient overlay container (`#tv-letterbox`, `#tv-fade`) and cleared on channel change and
  power-off, so a picture's matte never frames the next station.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS film_meta JSONB;` in
  `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads.

## Worked example

See [data/scripts/the_open_signal.bsm](../data/scripts/the_open_signal.bsm) — **The Open Signal**,
a ~175-minute period picture about the eight years after the Handoff when the Basin's transmitters
stayed up, nobody owned them, and what went out on them was pornography. ~970 nodes, four acts, an
intermission at the midpoint, and a 21:00 screening on KSAB-TV that runs across three blocks.
**Adult in subject** — it depicts the trade and what it cost the people in it, and is scheduled
accordingly. A minimal film needs `@type film`, a `::cast` block, and a body;
`@airtime` is what turns it from a thing on a playlist into a thing people are late for.

---

# Sermons (`@type sermon`)

The [news](#news-broadcasts-type-news) type's Sunday cousin, and the library format's
**dynamic-but-not-acted** member. It reads the *same* live feed a news bulletin does — the
generator behind the tablet's News app — but takes each headline as **revelation** rather than
reporting it. The Machine did not comment on the week; the week *is* the comment, and the
celebrants argue about what it meant.

Like `news` and unlike `talkshow`, the cast are **display names**: nothing is added to `npcIds`,
importing a service never spawns a studio NPC, and the assembled graph never sets `_requireHost`,
so it never presence-gates. It airs whether or not anybody is standing in a studio.

## How it differs from `news`

| | `news` | `sermon` |
|---|---|---|
| State source | live news generator | the same live news generator |
| The stories are… | reported | **interpreted as scripture** |
| Cast | anchors + field reporters | **celebrants** with signature derangements + a verger |
| Structure | bulletin (lead, field segment, rundown, kicker) | **order of service** (call, invocation, creed, readings, testimony, hymn, tithe, homily, benediction) |
| Re-rolls | per 5-minute refresh bucket | **per in-game day** — a 15-minute liturgy re-rolling mid-service would cut itself off |
| Compiler output | `newsScript` | `sermonScript` |

## Headers

Standard headers plus:

| Directive | Effect |
|---|---|
| `@type sermon` | selects this type |
| `@verger "The Verger"` | the unseen voice that opens and closes the service — a name, not an NPC |
| `@titlecard <graphic_id>` | shown before the service; pair with an `::asset` block |
| `@theme <song>` | rides the title card, as everywhere else |
| `@airtime <hour>` | the block it occupies, snapped to in-game 3-hour blocks |
| `@airday <day…>` | **which weekday(s) it airs.** Names or 1-7 (Mon=1). This is what makes it a Sunday programme rather than a daily one |

## `::celebrants` block

```
::celebrants
Deacon-Prime Orrin Vance | who has given the most and speaks the softest | prime
Brother Duc, Third Seal  | who counts everything and finds it insufficient | duc
::endcelebrants
```

`Name | Title | tag` — title and tag optional. The **tag** is the important field: it names that
celebrant's signature pools (`exegesis.<tag>`, `interjection.<tag>`), which is what stops five
preachers from all sounding like one preacher.

## Line pools (`::lines <key>`)

**Gathering:** `call` (verger) · `invocation` · `greeting` · `creed` + `creed.response` (the
response is spoken **unattributed** — it's the congregation)
**Per reading (top 3 stories):** `reading.lead` · `reading.text` · `exegesis` · `interjection` ·
`amen` (also unattributed)
**Closing:** `testimony.lead` + `testimony` · `hymn` · `tithe` · `homily` · `benediction` ·
`signoff`

`exegesis` and `interjection` accept **two** kinds of variant, and they're tried in this order:

1. `exegesis.<celebrant-tag>` — that preacher's own obsession
2. `exegesis.<lens>` — how *this* reading should be taken
3. `exegesis` — the generic fallback

The **lens** is drawn at random per reading from `blessing` · `warning` · `omen` · `rebuke` ·
`miracle`. That's the trick that makes the format hold up: the same headline is a benediction one
week and an indictment the next, without a line being rewritten.

## Where the variety comes from

Three independent axes, rolled per service — a format that varies only by line pool reads as one
madman with a thesaurus:

1. **Who preaches** each reading rotates through the roster, and each has their own tag pools.
2. **The lens** per reading (five of them).
3. **Which optional beats happen at all** — interjection (~55%), a second exegesis (~40%),
   testimony (~70%), hymn (~60%), the creed (~75%).

Twelve services assembled from an identical three headlines come out **12/12 distinct**, sharing
roughly 4 lines in 27. That ratio is regression-tested.

## Tokens

`{verger}` `{celebrant}` `{title}` `{celebrant2}` `{headline}` `{body}` `{byline}` `{scene}`
`{lens}`. Anything left over is filled at **airtime** by the shared scripted-token pass, so a
service can also say `{weekday}`, `{season}`, `{weather}`, `{tempc}`, `{viewers}` — see
[Live-text tokens](#live-text-tokens-for-scripted-broadcasts).

## Compiler & runtime contract (as built)

- **Compiler**: `@type sermon` gives
  `sermonScript = { celebrants, verger, pools, title, theme, airSlots, airDays }`. Celebrants are
  names — nothing reaches `npcIds`.
- **Import**: `playback_mode = 'sermon'`, `loop = 1`, `sermon_pools` = the `sermonScript`
  (`media_broadcasts.sermon_pools` JSONB). Pins through `ensureTalkshowSlot` — the shared block
  pinner, which now also writes the **day mask** from `airDays`, so talk shows and game shows can
  be weekly by the same route.
- **Runner**: `getSermonGraph` fetches via `dispatchAction('news.getStories')` (falling back to the
  same built-in stories the news type uses) and caches per in-game day; `assembleSermonGraph`
  emits the `say`-node chain. No `_requireHost`.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS sermon_pools JSONB;`

## Worked example

See [data/scripts/the_calm_eye.bsm](../data/scripts/the_calm_eye.bsm) — **The Calm Eye**, the
Ascendant Sunday service: five celebrants, 32 pools, 138 lines, an animated chrome-eye title card,
airing Sundays only at 12:00 on KSAB-7. A minimal file needs `@type sermon`, one `::celebrants`
row, and the `reading.lead` / `exegesis` / `benediction` pools; everything else is enrichment.
