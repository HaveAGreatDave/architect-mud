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
| `@type live` | `meta.type` | lowercased; e.g. `live`, defaults to `"live"` |

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
| lines ending in `_END` / `END_ACTION` seen outside their opening block | skipped silently | guards against stray terminators |

### Directive-line detection (`isDirectiveLine`)

Several block collectors (e.g. `OVERLAY <id>`, `SPEAKER:` text) stop early if the next line looks like a directive rather than free text. A line counts as a directive if it starts with any of:

```
@  ::  EVENT   TITLE   TICKER  WAIT  NPC   OVERLAY
SHOT  SHOT_END  TICKER_END  OVERLAY_END  LOWER_THIRD_END  MUSIC_END  END  CAM   ROOM
MUSIC  ENTER   ACTION  END_ACTION  ♪  TECH_DIFFICULTIES 
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

END
```

This produces: a `title_card` node, a `wait(2)` node, an `npc_anchor` for `npc_anchor_dana`, a `say` node (raw dialogue), a `camera_cut` node (camera `1` recorded), a room dependency (`zone_rust_district`, no node), an `overlay` node with graphic id `district_map`, a `wait(3)` node, an `npc_action` node ("shuffles papers"), and a final `music` node (`song: 'outro_sting'`, `text: 'Thanks for tuning in.'`) — plays the `outro_sting` row from `audio_songs` if one exists, otherwise just shows the text.
