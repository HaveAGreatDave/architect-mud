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
| `@type live` | `meta.type` | lowercased; known values: `live`, `scripted`, `weather`, `sports`; defaults to `"live"`. `weather` and `sports` switch the file to the line-library format — see [Weather Broadcasts](#weather-broadcasts-type-weather) and [Sports Broadcasts](#sports-broadcasts-type-sports). |

Any other `@key value` line is silently ignored at the top level (only `@actor`/`@alias` are meaningful elsewhere — see below).

## `::actors` Block

Pre-scanned before the main pass, so actors/aliases can be referenced anywhere in the body regardless of order.

```
::actors
@actor npc_john_akerson
@alias npc_john_akerson JOHN
::endactors
```

- `@actor <entity_id>` — registers an exact NPC entity ID, added to `actorIds` (declaration order) and `npcIds`.
- `@alias <entity_id> <LABEL>` (or `alias` without the `@`) — maps `LABEL` (case-insensitive, stored uppercase) to `entity_id`. Used to resolve bare `SPEAKER:` lines later.
- Any other `::xxx` line ends the actors block.

## Structural Markers (`::`)

- `::asset <id>` ... `::endasset` — collects raw block content as an ASCII asset: `{ id, name: id, type: 'ascii', content }`, pushed to `assets`.
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
| `CAM <n> [label words...]` | `{ type: 'camera_cut', zone_id: '', label }` | `n` recorded in `cameras` (deduped, first-seen order); label is `"CAM n — rest"` |
| `OVERLAY` ... `OVERLAY_END` | `{ type: 'overlay', overlayType: 'text_card', text }` | bare form, no graphic id |
| `OVERLAY <graphic_id>` ... (free text until a directive line or `OVERLAY_END`) | `{ type: 'overlay', graphic_id, text }` | text lines collected until another directive is recognized |
| `LOWER_THIRD` ... `LOWER_THIRD_END` | `{ type: 'overlay', overlayType: 'lower_third', text, subtext, graphic_id: '' }` | first non-empty line = `text`, second = `subtext` |
| `SHOT` ... `SHOT_END` | `{ type: 'say', text, style: 'narration' }` | text also pushed to `messages` |
| `CREDITS [seconds]` ... `END_CREDITS` | `{ type: 'credits', text, duration? }` | block content is the credits text; optional duration in seconds on the same line as `CREDITS` |
| `NPC <npc_id>` | `{ type: 'npc_anchor', npc_id }` | only emitted if it changes the active speaker; sets `activeNpc` |
| `SPEAKER:` (e.g. `JOHN:`) followed by a line of dialogue | `npc_anchor` (if speaker changed) + `{ type: 'say', text, style: 'raw' }` | label resolved via `::actors` aliases (uppercase match), else falls back to `npc_<label_lowercased>`; unresolved labels recorded in `_debug.unresolvedSpeakers`; dialogue text also pushed to `messages` |
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
SHOT  SHOT_END  TICKER_END  OVERLAY_END  LOWER_THIRD_END  MUSIC_END  END  CAM   ROOM
MUSIC  ENTER   ACTION  END_ACTION  ♪  TECH_DIFFICULTIES  CREDITS
```

...or matches the speaker pattern `^[A-Za-z][A-Za-z0-9_]*:\s*$`, or is a bare duration (`^\d+(\.\d+)?s?$`).

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

The runner only voices wind/humidity when they're worth a mention (e.g. wind ≥ `windy`, humidity in `dry`/`oppressive`); otherwise it stays quiet. Temperature is always voiced for today, optional for forecast days.

### 4. Severe-weather warnings — invoked when a day's `severity ≥ 0.45`

Keyed to the dominant severe channel (the runner derives it from the forecast — cold/heat from `tempC`, wind from `windKph`, type from `weatherType`):

`warn.cold` · `warn.heat` · `warn.wind` · `warn.blizzard` · `warn.storm` · `warn.generic` (fallback)

These are the "gear up before you go out there" beats — they line up with the ⚠ telegraph the forecast panel already shows (see [systems-weather-extreme.md](systems-weather-extreme.md)).

### 5. Forecast-walk transitions — spoken before each day ahead

Keyed by lead time so the runner can say "tomorrow" vs "by the weekend":

`ahead.tomorrow` (day 1) · `ahead.midweek` (days 2–4) · `ahead.weekend` (days 5–6) · `ahead.next` (generic fallback for any day)

### 6. Trend pools — chosen once by comparing the week's arc

The runner compares day-0 to the week to pick one: `trend.warming` · `trend.cooling` · `trend.clearing` · `trend.deteriorating` · `trend.steady`.

### 7. Ad-libs — optional character flavour, sprinkled between beats

`adlib` (generic), or moods `adlib.grim` / `adlib.chipper`. Inserted between beats at low probability to keep the weatherman feeling like a person, not a readout. Purely optional.

## Tokens

The runner substitutes `{token}` from the forecast day currently being described (per-day tokens) or from week aggregates (week tokens). Unknown tokens are stripped to empty and recorded in `_debug.unknownTokens`.

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
5. **For each of days 1–6:** `ahead.<leadtime>` → `sky.<type>` → `temp.<band>` (optional) → `warn.<channel>` (if severe)
6. `trend.<arc>`
7. `outro`

Each beat becomes a `say` node anchored to `@host`, so lines render as `Weathercaster says, "…"` on-air and reach passive listeners as `[TV] "…"`. `adlib` pools are part of the format vocabulary; the current runner reserves them for future between-beat sprinkling and does not yet inject them. Auto-generated `overlay` graphic cards are likewise a future runner enhancement — for now the `.bsm` drives spoken lines only.

## Fallbacks

The report degrades gracefully so a thin file still airs:
- Missing framing pool (`intro`/`outro`/`*.lead`) → that beat is skipped.
- Missing `sky.<type>` → a neutral built-in ("Conditions: {weather}, {temp}.") so no gap.
- Missing `temp`/`wind`/`humid`/`warn`/`ahead`/`trend` pool → that garnish beat is skipped.

**Minimum viable file:** `@type weather`, `@host`, an `intro`, an `outro`, and a `sky.*` pool for each weather type you expect to see. Everything else is enrichment.

## Compiler & runtime contract (as built)

For `@type weather`, `compileBsm(text)` ([bsm-compiler.js](../client/devpanel/js/bsm-compiler.js)) returns the standard envelope **plus** a `weatherScript` field and leaves `broadcastGraph` minimal (just the `start` node — the real graph is generated at air time):

```js
weatherScript: {
  pools: { [poolKey]: [line, line, ...] },   // from ::lines blocks
  host:  meta.host,                          // also force-added to npcIds so the importer places it
}
```

- The compiler special-cases `::lines <key>` … `::endlines` exactly like `::asset` (collect the block, split into non-empty lines, append to `pools[key]`; re-declared keys merge). Without this the pool body would fall through to the linear parser and be mis-read as stage directions.
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): a weather file is saved with `playback_mode = 'weather'`, `loop = 1`, `override_duration = @length`, and its `weatherScript` stored in the new `media_broadcasts.weather_pools` JSONB column (`{ pools, host }`). The importer still creates/places the host NPC and a studio like any hosted broadcast.
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

::lines adlib.grim
...not that any of us are going anywhere.
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

A **sports** `.bsm` is the [weather](#weather-broadcasts-type-weather) format's sibling: a **line library** plus **team and player pools**, not a linear script. But where weather *reads* a live forecast, there is **no game in the world** — so the sports runner **simulates a whole game** each airing: it picks two teams, deals a lineup to each from the player pool, plays the sport out (for baseball: nine innings of randomized at-bats, tracking the score), and assembles a fresh play-by-play graph from the matching pools with `{tokens}` filled from the live game state. Same file, a different matchup and a **different final score every airing**.

The authored `.bsm` holds the *voice* (the announcer's tone, the team/player flavour) and the *event language* (how a home run, a strikeout, a walk-off is called). The runner owns the *game* (who plays, what happens, what the score is). The author never hardcodes "team A wins 5–3" — they write home-run lines and the sim decides when to use them.

Baseball is the first (and currently only) implemented sport; `@sport` is the extension point for future sports, which may divide the game into **periods** rather than innings.

## How it differs from `live` / `scripted`

| | `live` / `scripted` | `weather` | `sports` |
|---|---|---|---|
| Body | ordered directives → linked chain | condition-keyed line pools | event-keyed line pools + team/player pools |
| State source | none | live 7-day forecast (read) | a simulated game (generated) |
| Repeatable | same each time | re-rolls per forecast day | **re-rolls a new game each loop cycle** |
| Acted live | live channels only | yes (`_requireHost`, host must be in-studio) | **no** — announcer is a name, no NPC, no presence gating |
| Compiler output | `broadcastGraph` chain | `weatherScript` | `sportsScript` |

**Not acted live, no NPC.** The announcer is a **name string**, not an `npc_*` id. Sports lines are spoken as plain narration (the announcer's voice), so nothing is added to `npcIds` and **importing a sports broadcast never spawns a studio NPC**. It runs happily on an ordinary `playlist`/`loop` channel with no studio zone.

## Headers

All the standard headers (`@broadcast`, `@channel`, `@category`, `@length`) work as usual. Sports adds:

| Directive | Effect |
|---|---|
| `@type sports` | Switches the file to the sports line-library format. |
| `@sport baseball` | Which simulation to run. Only `baseball` is implemented; the discriminator for future sports. |
| `@announcer "Chip Vega"` | The play-by-play voice — a display **name**, surrounding quotes stripped. Available in lines as `{announcer}`. Not an NPC. |

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

- `::teams` — one team name per line. The runner picks **two** at random per airing (home + away). Surrounding quotes are stripped, so a name can be quoted if you like.
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
    sport: 'baseball',          // @sport
    announcer: 'Chip Vega',     // @announcer — a name, NOT added to npcIds
    teams:   [ '…', … ],        // ::teams block
    players: [ '…', … ],        // ::players block
    pools:   { [key]: [line,…] } // ::lines blocks
  }
  ```
- **Import** ([broadcast.js](../client/devpanel/js/panels/broadcast.js) `_bcImportSave`): saved with `playback_mode = 'sports'`, `loop = 1`, `override_duration = @length`, `sports_pools` = the `sportsScript` (new `media_broadcasts.sports_pools` JSONB column). No studio/host is created — asset-only.
- **Runner** ([plugins/broadcast/index.js](../plugins/broadcast/index.js)): a `sports` playlist item calls `getSportsGraph(item, cycle)`, which caches the assembled game and re-rolls when the loop cycle advances. `assembleSportsGraph` runs `sportsSimGame` (the baseball simulator) and emits a `say`-node chain via `sportsPick`/`sportsFill`. The graph does **not** set `_requireHost`, so no presence gating — it plays on any channel. Downstream (`say` nodes, dedup, passive `[TV] "…"` leakage, off-air) reuses the existing broadcast walker unchanged.
- **Schema**: `ALTER TABLE media_broadcasts ADD COLUMN IF NOT EXISTS sports_pools JSONB;` in `SCHEMA_SQL`. Apply with `npm run db:schema` before the runner loads (it `SELECT`s the column in `loadChannelRuntimes`).

## Worked example

See [data/scripts/baseball.bsm](../data/scripts/baseball.bsm) for the full library. A minimal viable file needs `@type sports`, `@sport baseball`, `@announcer`, a `::teams` pool (2+), a `::players` pool, and at least the `intro`, `half.top`, `half.bottom`, `atbat.out`, `hr`, `rbi`, `score.update`, `final`, and `outro` pools. Everything else is enrichment.
