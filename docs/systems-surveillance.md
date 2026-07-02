# Surveillance & Spy Networks — SPECTER (Design, Not Built)

*Working name: **SPECTER** (Surveillance, Perception, Evidence, Counter-Tracking & Remote-viewing).*
Grows the **camera half of the [broadcast system](systems-broadcast.md)** into a player-deployable,
PvP-capable surveillance layer. NPC police run the same tech to track crime.

> Status: **planned, not built.** This doc is the agreed, build-ready design. All forks resolved.

---

## The pitch

Players plant covert devices **anywhere** (any zone, not just owned property), wire them into
private **networks**, watch a multi-feed **Surveillance Hub**, and record **datachip** evidence.
Everyone else can hunt, hack, jam, and rip down that gear. NPC police get evidence + dispatch.

## Design pillars

1. **Reuse the broadcast spine.** `buildCameraSnapshot(zoneId)` in
   [`plugins/broadcast/index.js`](../plugins/broadcast/index.js) already renders a zone as feed
   text; `media_cameras` already has powered/damaged/recording/`recording_buffer`/streaming; the
   [TV panel](systems-broadcast.md#tv-panel-clientgamejspanelstvjs) already renders feeds with a
   `security` theme. We add *ownership, mobility, networks, counterplay* — not a new render stack.
2. **Every device is discoverable and killable.** No fire-and-forget omniscience. Plant it → it can be found.
3. **The display is a diegetic object.** Feeds show device chrome (battery, signal, REC, motion
   pings, jam static) and make noise — via SVG injection + the audio **sparkle** system.
4. **One mechanic, many devices.** All families share a deploy/power/network/counterplay skeleton;
   they differ by `device_kind` + a small behavior hook.

---

## Confirmed decisions (2026-07-01 review)

| Fork | Decision |
|---|---|
| Placement | **Deploy anywhere** — covert `plant` in any zone (spy-net / PvP), not owned-property only. |
| Monitor UI | **New Surveillance Hub panel** — multi-feed grid; opened by a carried spy-deck item. |
| Counterplay | **All three** — find & destroy, hack & hijack (Circuit Breach), jam & spoof. |
| Police | **Evidence + dispatch** — witnessing cams log evidence and route police AI to the zone. |
| Clips | **Shareable item/evidence** — export buffer to a physical `datachip` item (replay/trade/sell/submit). |
| Power | **Battery (drains) + zone power** — wired devices die in blackouts; battery devices need upkeep. |
| Devices | **All families** — sticky cam, relay, motion/audio sensor, drone, jammer, spoofer. |
| Acquisition | **Vendor + crafting** — black-market (shadow-dealer trust tiers) + craftable upgrade tiers. |
| Name | **SPECTER** (final). |
| Sanctuary | **Everywhere fair game** — any zone plantable; owners just `sweep` their own turf more easily. No no-plant flag. |
| Battery cadence | **Multi-day cams / hours drones** — fixed cams low-upkeep (days); drones burn down in hours. |
| Hub delivery | **Both** — carried spy-deck item (monitor anywhere, limited tiles) + placeable security-room console (wall-of-monitors, more tiles). |

---

## Schema — new `security_*` tables (do NOT overload `media_cameras`)

`media_cameras` is studio-broadcast-shaped (channel-bound, NPC-presence + tech-diff state machine).
Player gear needs ownership, batteries, families, hidden state, network membership. New tables that
**bridge** to broadcast for the feed-render / streaming path. All additive to `SCHEMA_SQL`
(deliberate one-shot apply, per the no-boot-migration rule).

```
security_networks
  id TEXT PK
  owner_id TEXT FK            -- player or npc faction id
  name TEXT                   -- "Ghost's Eyes"
  color TEXT                  -- hub accent (reuse --atm-accent pattern)
  is_police INTEGER           -- 1 = NPC-police network
  encryption INTEGER          -- hack_difficulty to join/hijack the whole net

security_devices
  id TEXT PK                  -- == furniture.id when planted (mirrors atm_units convention)
  network_id TEXT FK          -- null = orphan/unlinked
  owner_id TEXT FK
  device_kind TEXT            -- sticky_cam | relay | motion_sensor | audio_sensor | drone | jammer | spoofer
  zone_id TEXT FK             -- current location (drones move)
  direction TEXT
  tier INTEGER                -- 1..3: range, battery, stealth, resolution
  concealment INTEGER         -- vs finder's Perception check
  battery INTEGER / battery_max
  wired INTEGER               -- 1 = taps zone power instead of battery
  is_powered / is_damaged / is_recording INTEGER
  recording_buffer JSONB      -- ring buffer, reuse media_cameras shape
  storage_limit INTEGER
  status_flags JSONB          -- { jammed, spoofed, hijacked_by, looping, blinded }
  hack_difficulty INTEGER
  placed_at BIGINT

security_clips                -- exported evidence (datachip payload)
  id TEXT PK                  -- item_datachip_<id>; matches a spawned item
  device_id / zone_id / owner_id
  frames JSONB                -- snapshot of buffer at export time
  captured_at BIGINT
  crime_tags JSONB            -- ['murder','theft'] for police evidence value
```

A planted device is a **furniture row** with a `security_device` flag + `device_id` — exactly the
ATM pattern (`atm` flag → `atm_units`) — so it inherits the furniture / device-inspect /
interaction pipeline for free.

## Device families

| Kind | Behaviour | Counterplay hook |
|---|---|---|
| **Sticky cam** | Core covert video → live feed tile. Tiers scale range/resolution/stealth. | Easiest to spot; cheap to lose. |
| **Relay / remote viewer** | Network glue: extends range, bridges distant zones into one hub, boosts nearby cams. Kill it → downstream feeds go to static (cascade). | High-value target. |
| **Motion / audio sensor** | No picture — emits **alerts** to the hub (`movement in Zone X`, `gunshot heard`). Feeds off event bus + sound-propagation. | Fed false positives by a spoofer. |
| **Drone cam** | Repositionable mobile cam (`pilot <drone> <dir>`), heavier battery drain. | Loud (audio tell); shootable in the open. |
| **Jammer** | Deploy → statics all feeds in a radius (`status_flags.jammed`). | Find & destroy the jammer. |
| **Spoofer** | Feeds fake/looped footage to a target cam (`status_flags.spoofed`). | Signal-integrity check on the hub. |

## Placement — new `plant` / `retrieve` / `sweep` mechanic

Carried device item + `plant <device> [direction]`:
- **Stealth/Engineering check** vs zone traffic → sets `concealment`.
- Spawns furniture row + `security_devices` row in the **current** zone (anyone's turf).
- Hidden from default `look`; a **Perception/Scavenging** check (reuse the 2D8−2D8
  [scavenging check](systems-scavenging.md)) via `sweep` surfaces it.
- `retrieve <device>` picks it up (yours, or a found hostile one — theft loop → [Crime System](../CLAUDE.md)).

## Surveillance Hub (new panel — the centerpiece)

`client/game/js/panels/surveillancehub.js` + markup in `client/game/index.html`. Opened by a
carried **spy-deck / wrist-terminal item** (`use deck`) — monitor from anywhere.

- **Grid of live tiles**, each a mini feed reusing `buildCameraSnapshot` output; click to **focus**.
- Per-tile **chrome** = the "mechanical functions visible in the display": battery, signal bars,
  REC dot, timestamp, and **status skins** (JAMMED static, SPOOFED shimmer, OFFLINE snow). Rendered
  with the TV panel's SVG-injection path (engine-authored → safe innerHTML).
- **Sound:** each tile subscribes to the **audio sparkle system**
  ([`project_ambient_sparkle_system`]) — idle telemetry beeps, alert chirp on motion, buzz on feed
  drop/jam. New sparkle defs only, no new audio infra.
- **Alerts feed** drains sensor + event-bus hits (`player.death`, door-force, gunshot).

Reuses TV rendering internals (ticker, SVG, off-air static) — the hub is "a TV with N tiles + a control bar."

## Recording → datachip clips (shareable evidence)

- `record` toggles `is_recording`; buffer fills like `media_cameras.recording_buffer`.
- `CLIP→CHIP` exports the buffer into a `security_clips` row + a physical `item_datachip_<id>`
  (mirrors the cassette `eject` → item convention in the broadcast doc).
- A chip can be **replayed** (scrub popup), **handed off**, **sold**, or **submitted to police**.
- `crime_tags` auto-stamped when the buffer window overlaps a crime event in that zone → gives value.

## Counterplay (all three)

- **Find & destroy:** `sweep` (Perception vs `concealment`) reveals hidden devices → the
  device-inspect panel's existing **attack/repair/rescan** action bar
  ([`deviceinspect.js`](../client/game/js/panels/deviceinspect.js)) rips them down.
- **Hack & hijack:** the **Circuit Breach minigame** ([`circuithack.js`], currently cosmetic-only)
  finally wired for real — `hijack <cam>` launches it with the *real* `hack_difficulty` + player
  hacking skill. Win → **blind** it, **loop** its feed, or **annex** it into your network.
- **Jam & spoof:** deployable jammer/spoofer devices set `status_flags`; hub shows degraded tiles.

## Power & upkeep (battery + zone power)

- `wired=0`: `battery` drains on a slow tick; at 0 → `is_powered=0`, feed dark until recharged/swapped.
- `wired=1`: taps `isZonePowered()` (reuse ATM/broadcast power map) → **blackouts blind the grid**,
  tying into the [Extreme Weather](systems-weather-extreme.md) blackout scar + EMP hero event.

## NPC police — evidence + dispatch

- Police run a `security_networks` row (`is_police=1`) of city cams.
- Crime events on the bus (`player.death`, theft) in a zone a police cam witnesses → auto-log a
  `security_clips` evidence row **and** raise a dispatch alert → police AI VINE graph routes a unit
  via `GO_TO` (same pattern as broadcast NPC work-scheduling).
- Player-submitted chips with `crime_tags` feed the same evidence store → bounty/heat later.
- Hijacking/jamming a **police** cam is itself a crime → heat. Feedback loop.

## Acquisition — vendor + crafting

- **Spytech black-market vendor** — reuse the [shadow-dealer] trust-tier passphrase pattern for
  spicy gear (spoofers, police-band relays).
- Basics (tier-1 cams, batteries, datachips) from an open surveillance vendor.
- **Crafting/upgrade** tiers via the existing crafting system.

## Suggested additions

- **Hololock tie-in:** lock a device with a [hololock](systems-world.md); ripping a locked cam
  without the key trips a **tamper alert** to the owner's hub.
- **Dead-man / tamper ping:** any destroyed/hijacked device fires a final `⚠ TAMPER` + last-frame
  snapshot to its network before dying — losing a cam still yields intel.
- **Feed-as-broadcast crossover:** a relay can `stream` a spy feed onto a real broadcast channel
  (reuse `is_streaming`/`streaming_channel_id`) — pirate-TV a rival's private moment citywide.
- **Signal-integrity minigame:** spotting a spoofed feed is a small "is this footage real?" check.
- **Networks are social:** `grant <player> access` → shared surveillance for a crew/faction.

## Phased build (each phase independently shippable)

1. **Foundation** — `security_devices`/`security_networks` schema (+ `SCHEMA_SQL`),
   `plant`/`retrieve`/`sweep`, furniture + device-inspect wiring, battery/power tick. One device:
   sticky cam. Feed via `buildCameraSnapshot`.
2. **Surveillance Hub** — multi-feed panel + spy-deck item, live tiles, chrome, audio sparkle skins.
3. **Records** — `record`, datachip export/replay/trade, `security_clips`.
4. **Counterplay** — `sweep`→attack, Circuit Breach `hijack` (real wiring), jammer + spoofer.
5. **Device variety** — relays, motion/audio sensors, drones (+`pilot`), tiers, vendor + crafting.
6. **Police** — police network, evidence auto-log, VINE dispatch, tamper-a-cop-cam heat.

## Resolved forks

All settled 2026-07-01 — see the two decision tables above. No open questions remain; ready for Phase 1.
