# Surveillance & Spy Networks — SPECTER (As Built)

*Working name: **SPECTER** (Surveillance, Perception, Evidence, Counter-Tracking & Remote-viewing).*
Grows the **camera half of the [broadcast system](systems-broadcast.md)** into a player-deployable,
PvP-capable surveillance layer. NPC police run the same tech to track crime.

> Status: **shipped** — all six phases live in [`plugins/surveillance/`](../plugins/surveillance/index.js)
> (with its own `regress.js`); tables are in `SCHEMA_SQL` and classified in the content registry.
> Phase 6 became a **witnessed-crime Wanted System** (below) rather than plain
> evidence+dispatch — see [the Wanted System section](#wanted-system-phase-6). This doc keeps its
> phased-design structure as a history of how it was built; the per-phase "pending schema/restart"
> caveats are obsolete.

> **Cops don't chase you while you're airborne.** Ground policing runs normally, but the pursuit
> engine leaves a suspect alone while they're in a cockpit: `searchAndPursue` and the `APPREHEND`
> action both no-op when `isAirborne(suspect)` (the player carries an `aircraftId`). Your stars
> persist and the manhunt simply **waits until you land**, then resumes. Flying into restricted
> airspace still raises stars (the flight plugin's no-fly enforcement) — you just can't be
> physically detained or searched mid-flight; the reckoning happens on the ground.

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
  recording_buffer JSONB      -- DEAD COLUMN: the rolling buffer moved fully in-memory
  storage_limit INTEGER       -- (CameraBuffer / cameraBuffers in index.js); nothing reads these
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

1. **Foundation** — ✅ *shipped.*
   `security_networks`/`security_devices`/`security_clips` tables in `SCHEMA_SQL`; new
   [`plugins/surveillance/`](../plugins/surveillance/index.js) with `plant`/`retrieve`/`sweep`/`feed`;
   concealed furniture hidden from `look` via a `flags.concealed` filter in `describe.js`;
   battery/power tick (cams days / drone hours). Feed = own `feedSnapshot()` (zone snapshot, same
   shape as broadcast's `buildCameraSnapshot`, which is plugin-private so not importable). Test gear:
   [`scripts/seed-surveillance-gear.js`](../scripts/seed-surveillance-gear.js) (sticky/tap cam, recon drone).
2. **Surveillance Hub** — ✅ *shipped.*
   New client panel `surveillancehub.js` (*since deleted — UI is tablet-only, see the 2026-07-10 note*) (+ `#shub-panel`
   markup, CSS): grid of live feed tiles + a focus pane, per-tile chrome (battery, signal bars, ●REC,
   scanlines, and static skins for offline/jammed/spoofed/damaged), self-contained WebAudio blips.
   Opened by the carried **Surveillance Deck** (`hub`, or `use deck`) or a `security_console` furniture.
   Server pushes `surveillance_hub` (open) then `surveillance_hub_update` every 5s to a `hubViewers`
   set; client sends `hubclose` on close; `player.logout` prunes. Frames = `feedSnapshot()`.
3. **Records** — ✅ *shipped.*
   `record`/`clip`/`clips`/`replay` commands + hub RECORD / CLIP→CHIP focus buttons. Recording banks a
   frame per 5s tick into `recording_buffer` (capped at `storage_limit`); `clip` burns the buffer to a
   `security_clips` row **and** a physical `item_datachip_<id>` (tradeable/sellable). Crimes witnessed
   in-frame (in-memory `crimeLog` fed by `player.death`) auto-stamp `crime_tags` → the chip becomes
   evidence (higher value). `use <datachip>` / `replay` opened the **Datachip Replay Deck**
   (`datachipreplay.js`, *since deleted — the tablet reel viewer renders the pushed payload now, see
   the 2026-07-10 note*) — an 80s VHS/cyberdeck: spinning reels, amber timecode, VHS tracking band,
   scanlines, evidence sticker, transport controls + scrub.
4. **Counterplay** — ✅ *shipped.*
   **Find & destroy:** `smash <name>` rips a swept-out device off its mount (deletes it) and fires a
   `⚠ TAMPER` **dead-man ping** to its owner. **Hack & hijack:** `hijack <name>` validates + arms a
   breach and returns a `circuit_hack` message → the client opens the **Circuit Breach** minigame
   (finally wired for real — real hacking skill + device `hack_difficulty`); on resolve it fires
   `hijackresolve <id> <win>` → win **annexes** the device to your ownership (appears in your hub),
   loss = 5-min rig lockout; either way the old owner gets a tamper ping. Server arms a
   `pendingHijack` token so the resolve can't be spoofed without going through `hijack`.
   **Jam & spoof:** `jammer`/`spoofer` are planted like any device; a live jammer statics every cam
   in its zone (`jammed`), a spoofer feeds cams a clean empty-room frame (`spoofed`) — even into
   recordings. Effect computed live in `deviceStatus`/`deviceFrame` via a cached `getInterferenceZones()`.
5. **Device variety** — ✅ *shipped.*
   **Motion/audio sensors** push alerts (no video): motion via per-tick occupancy diffing (`pollSensors`),
   audio via the `player.death` hook (gunfire/scream). Alerts land in a per-owner ring, ping the owner if
   online, and render in a new **hub ALERTS strip** (with a chirp on arrival). **Drone piloting** —
   `pilot [drone] <dir>` flies a drone through a zone exit (`drone_ops` check); both zones hear it (loud
   → counterplay). **Relays** — a powered relay in a zone punches feeds through a jammer there.
   **Tiers** surfaced on hub tiles (`kind·T2`). **Acquisition** — black-market vendor **Glitch** at *The
   Blindspot* ([`seed-surveillance-vendor.js`](../scripts/seed-surveillance-vendor.js)) sells the full
   kit; gear defs in [`seed-surveillance-gear.js`](../scripts/seed-surveillance-gear.js). **Crafting** —
   [`seed-surveillance-crafting.js`](../scripts/seed-surveillance-crafting.js) adds 3 salvage components
   (Optic Module / Signal Board / Micro Cell) + 6 `electronics` recipes (`craft <gear name>`, no station;
   higher tiers need higher electronics rank); components also stock at Glitch.
6. **Police / Wanted System** — ✅ *shipped.* See below.

## Wanted System (Phase 6)

A GTA-style **0–5 star** wanted level per player, driven by surveillance and topping out at the
existing **Arbiters** (`plugins/emergency/index.js`). All in the "Wanted system" section of
[`plugins/surveillance/index.js`](../plugins/surveillance/index.js).

- **Witnessed-only** — `isWitnessed(zone)` = a live (un-jammed) PD cam, an on-duty `flags.police`
  NPC, or another player present. Crime off-camera earns nothing (except `always`-witnessed crimes
  like `murder`, which self-report). Triggers: a player kill (`player.death` → the 5★ `murder`
  crime), smashing a PD device (+1★), hijacking one (+2★).
- **Escalation ladder** (`TIERS`, full roster per star): ★1 Patrol Officer · ★2 +Patrol Drone ·
  ★3 ×2 Enforcement Trooper · ★4 Heavy Enforcer +Trooper · ★5 **Arbiters** (reuses
  `enemy_arbiterclass_enforcement_unit`). Tiers 1–4 are new enemy templates
  ([`seed-wanted-police.js`](../scripts/seed-wanted-police.js)).
- **Pursuit = search from the scene** (`searchAndPursue`, 2026-07-03; was teleport-redeploy) — units
  muster at the **crime scene** (`s.crimeZone`, the zone where the pursuit began) and then *hunt*: each
  4s `wantedTick`, a hunter either engages (same zone as the suspect → `targetId` set, `WANTED_HUNTER_GRAPH`
  cries once then attacks) or takes **one search step** — usually a `findPath` step toward the suspect's
  current zone, but `HUNT_RANDOM` (0.35) of the time (or when there's no path) a random-neighbour wander.
  Movement is server-driven via `moveEntity` (not the graph, which just idles until targeted), so there
  are no innocent-bystander acquisitions and **you can now lose them** by moving and staying unseen.
  Reinforcements after a kill re-muster at the scene.
- **Arrival scales with heat** (`responseDelayMs`, 2026-07-03) — units don't deploy until a star-scaled
  delay elapses from the start of the pursuit (`s.pursuitStartTs`, stamped when heat first goes above 0):
  ★5 = 10s · ★4 = 15s · ★3 = 20s · ★2 = 45s · ★1 = 90s · ½★ = 180s (petty heat gets a lazy response).
  Escalating stars mid-pursuit shortens the threshold, so they can arrive sooner. Once *any* unit has
  deployed the gate is dropped — pursuit then continues every tick. (½★ has no `TIERS` roster anyway, so
  in practice half-star heat draws only the delayed APB, not dedicated hunters.)
- **Clears**: decay one star per 60s **unseen**; **death/arrest** wipes it; **`bribe`** an on-scene
  cop (≤2★, `stars×250c`); **`scrub`** a `police_terminal` (hacking check). *(Disguise deferred.)*
- **Peak charge** (`WANTED_PEAK` action, `s.maxStars`, 2026-07-03) — the spree's highest star level is
  tracked and exposed for booking. Jail books the arrest on the **peak**, not the decayed current level:
  run 5★ down to ½★ and a downing still charges you the full 5★ (5-min sentence + fine). `maxStars`
  resets only when the pursuit fully clears (runtime entry deleted at 0 stars).
- **Evidence & bounty**: witnessed crimes auto-log a `security_clips` row to the PD network + an APB
  (`sendToZone` sirens + `police.dispatch` event — the seam for real AI patrol routing later).
  Players `submit` a crime-tagged datachip to a cop for a credit bounty.
- **HUD**: server pushes `wanted_level`; client renders a neon ★-bar
  ([`wanted.js`](../client/game/js/panels/wanted.js)) that pulses + stings on escalation.
- **Deviations**: disguise-clear deferred (needs the appearance system); "murder" = killing a *player*
  (only `player.death` fires).

### Invisible heat (0–100) — the second wanted layer

Alongside the visible star bar runs an invisible **heat** meter per player (`heatRuntime`):

- `addHeat` accrues it from suspicious-but-not-charged acts (e.g. reagent purchases via
  `vendor.purchase`); raising stars also adds `HEAT_PER_STAR` (8) per star.
- It decays `HEAT_DECAY_PER_TICK` (0.35) on the 6s tick and is **persisted to the `heat` player
  flag** (written on raise, on zero, and at logout — checkpoint tier), pushed to the HUD as
  `heat_level`.
- Crossing `HEAT_MAX` (100) **ignites**: `igniteHeat` forces a minimum 3★ pursuit
  (`HEAT_IGNITE_STARS`).
- Other plugins feed it through the **`HEAT_RAISE`** action.

**Being-watched cues:** as heat climbs, the player gets escalating atmospheric lines
(`WATCHED_CUES` — faint ≥25, watched ≥50, closing ≥80), delivered by `maybeWatchedCue` on an
interval that shrinks with heat.

### Apprehend — non-lethal detention (≤3.5★)

At `APPREHEND_MAX` (3.5★) or below, hunters **detain rather than kill**: on contact the client gets
an `apprehend_prompt` with a reflex-scaled submit-or-run window (`reflexWindowMs`), resolved by the
`apprehendresolve` command. **`submit`** dispatches `{type:'ARREST'}` into the jail plugin (live
booking, no death); **`run`** (or timeout) adds +2★ (`resisting_arrest`-style escalation) and the
hunt continues. Checkpoints and other systems can trigger the same flow via the **`APPREHEND`**
action. Above 3.5★ the response is lethal as described above.

### Admin & upkeep commands

- **`purge`** (admin-only) — "burn the law in the room": clears pursuit state + slate for the zone.
- **`wipe`** — discard-and-clear a camera's capped buffer (the Clear action in the tablet app); see
  the microreel note below for the cap-then-STOP buffer model.

### Notes & caveats

- **`camera_effectiveness` tunable (default 0.5):** every camera catch-chance is multiplied by this
  dev tunable — cameras run at *half* their base rates by default, on top of the visibility factor
  below. The `CAM_CATCH_BASE` 0.2 numbers quoted in this doc are before this multiplier.
- **Player kills charge once:** killing a player charges the 5★ `murder` crime (witness `always` —
  self-reporting) via the crime registry. The legacy +2★ "witnessed homicide" bump was removed
  (2026-07-12) — it double-logged evidence and double-dispatched police on top of the murder charge.
- **Recording is blocked on police networks** (`cmdRecord`) — you can't turn the PD's own cams into
  your evidence farm.
- **More crime wiring than listed above:** `item.given`→`drug_dealing`, `atm.jacked`/`atm.jackResolved`/
  `atm.drained`, `theft.caught`, `burglary.reported`, `hololock.breached`, `bodily.publicRelief`→
  `indecent_exposure`, `vendor.safeHackWitnessed`; witnessed charges also emit `crime.witnessed`.

## Crime registry & camera catch (2026-07-02)

The hardcoded per-crime star amounts were replaced with a **data-driven crime registry** plus a
camera-catch reaction. Stars are now **fractional** (half-steps) so petty acts read as a half star.

- **Crime registry** — [`server/engine/crimes.js`](../server/engine/crimes.js) ships the canonical
  crime keys + default star weights (dev-panel editable via the new **`crimes`** table & panel).
  Keys/witness-mode are engine constants; only the star value is content. The registry ships **~31
  crime keys** (see `crimes.js` for the full list — theft, robbery, burglary, atm_robbery, arson,
  manufacturing, contraband_possession, indecent_exposure, murder, …). Representative defaults:
  `drug_use` 0.5 (camera-only), `attack_player` 4, `attack_npc` 4, `kill_police` 5 (always reported),
  `hacking` 2, `murder` 5 (always). `getCrimeStars(key)` = DB override → shipped default → 0. Loaded
  at boot (`reloadCrimes`), reloaded on each `PUT /crimes/:id`.
- **`raiseCrime(player, key, zone, suspect)`** (surveillance) is the single charge path: witness-gates
  (`camera` / `any` / `always`), debounces repeats of the same act (12s so swings don't ratchet),
  charges `raiseWanted` by the crime's stars (additive, capped at 5), logs PD evidence, and dispatches
  police for ≥1★ crimes.
- **Triggers wire in via events**: the weapon plugin emits `player.attacked` / `npc.attacked` /
  `npc.killed` (police kill → `kill_police`); `server/engine/drugs.js` emits `player.drugUsed`
  (illegal only — legal drugs carry `flags.legal`); device breach emits `hack.success`. Surveillance
  subscribes to all of these.
- **Camera catch** — when a **live, un-jammed camera** (police or player-owned) is in the zone during a
  crime, `flashCamera` broadcasts a red `camera-alert` line ("…locking focus on <suspect>") to the
  whole room and pushes a `camera_flash` message; the game client flashes a red vignette
  ([`dispatch.js`](../client/game/js/dispatch.js) `camera_flash`, styles `#camera-flash-overlay`).
- **Legal drugs** — a drug with `flags.legal` (coffee, beer) draws no police heat and is sold by
  ordinary vendors (no dealer/trust gate). Toggle it in the **Drugs** dev panel (Legality dropdown).

## Probabilistic witness model + ongoing-crime catch (2026-07-03)

No witness catches a crime with certainty anymore. **All** crimes route through one probabilistic
gate, `witnessRoll(zone, witness, onCamera, camChance)` (surveillance), which replaced the old
deterministic `witness === 'camera' ? onCamera : isWitnessed(zone)` branch inside `raiseCrime`:

- **Camera** — rolls `camChance`: a flat `CAM_CATCH_BASE` (0.2) for a one-shot act, or the
  duration-ramped `camCatchChance(elapsed)` (0.2 → `CAM_CATCH_MAX` 0.9 over `CAM_CATCH_RAMP_MS` ~30s)
  for an ongoing one. Quick jobs can slip a lens; lingering ones almost always get made.
- **Cop** (`any`-witnessed only) — an on-scene `flags.police` NPC catches you at `COP_CATCH` (0.9):
  very high.
- **Bystander** (`any`-witnessed only) — another player in the room reports at just `BYSTANDER_REPORT`
  (0.12): rare. (`camera`-only crimes ignore cops/bystanders; `always` crimes self-report.)

Because a failed roll returns *before* the 12s debounce is stamped, repeated acts (combat swings,
repeat drug hits) simply re-roll — that's where "variability over time" comes from for one-shot acts.

Ongoing offences additionally run through an **active-crime tracker** (`activeCrimes` map +
`scanActiveCrimes`, on the 5s surveillance tick), which re-rolls `witnessRoll` each tick with the
time-ramped camera odds and charges via `raiseCrime(..., forced=true)` on a hit (then drops the entry;
the 12s debounce covers a resumed streak). Leaving the zone ends the offence. Two feed it:
- **ATM breach** — the crime chance now starts **when you `jack` in, not on success**. `atm` emits
  `atm.jacked` (begin, key `hacking`, 180s safety cap) and `atm.jackResolved` / `atm.drained` (end).
  The old on-success `emit('hack.success')` charge was removed. `atm_robbery` (draining, `always`) is
  unchanged.
- **Indecent exposure** — a player **naked (nothing on torso *and* legs) where a witness (live camera
  or on-scene cop) can see them** is a continuous offence; the scan derives it from equipment each
  tick (`nakedAmong`) and charges `indecent_exposure` (0.5★) on a caught roll. Dressing or leaving
  ends it.

`isWitnessed(zone)` stays deterministic — it now serves only heat-decay/visibility (wanted tick,
witnessed-homicide gate), not the catch roll.

### Cameras see worse in low visibility (2026-07-09)

A PD/player camera's catch rate is calibrated for **clear conditions**; darkness (night blackout,
storm, fog, ash) blinds the lens the same way it blinds a fighter's aim (combat's
`darknessHitPenalty`). `witnessRoll`'s camera branch multiplies `camChance` by
`cameraVisibilityFactor(zone)` = `getZoneVisibility(zone).category` mapped through the shared
`LIGHT_LADDER`: `clear` and brighter → **1.0** (full default rate); each band dimmer than `clear`
loses `CAM_VIS_STEP` (0.18) — `dim` 0.82, `gloomy` 0.64, `dark` 0.46, `murk` 0.28 — floored at
`CAM_VIS_FLOOR` (0.10) so a pitch-dark street still isn't a guaranteed free pass. Because
`scanActiveCrimes` re-rolls this each 5s tick, a lower per-roll chance also **lengthens
time-to-detection** for ongoing offences. Only the camera witness is degraded — an on-scene cop or
bystander (human eyes) still sees you at their usual odds.

### Microreels, capped buffers & the in-app viewer (2026-07-10)

The SPECTER **tablet app** ([`plugins/tablet/surveillance-app.js`](../plugins/tablet/surveillance-app.js))
became self-contained, and "clipping" was re-pointed at reels rather than physical chips.

> **Update — tablet-only retirement + possession model (2026-07-10).** The three standalone client
> panels — `surveillancehub.js` (`#shub-panel`), `datachipreplay.js` (`#chip-panel`), and
> `specterinstall.js` — were **deleted**. SPECTER's UI is now **tablet-only**; the server plugin is
> unchanged, so `hub` / `use spy_deck` / `use datachip` / `replay` and the `use <specter program>`
> install still fire the same pushes — `dispatch.js` just **reroutes** them into the tablet
> Surveillance app: `surveillance_hub` → open the tablet hub (+ `hubclose` to stop the 5 s update
> push; the tablet self-polls), `datachip_replay` → the tablet reel viewer rendered **directly from
> the pushed payload** (already authorised by carrying the chip — no owner-gated refetch, so traded
> evidence still plays), and `specter_install` → the firmware-flash **folded into the tablet shell**
> (`openTabletSpecterInstall` / `mountSpecterInstallFlash` in `tablet-os.js`, retinted to `--mg-accent`).
> **Microreels are now possession-gated and clip mints the chip:** a microreel **is** the datachip you
> carry. `clip` now calls `physicalizeClip` to drop the reel's `item_datachip_<id>` straight into your
> kit; `microreelList` + `getMicroreel` key on **carrying** that chip (not `owner_id`); `deleteMicroreel`
> crushes the carried chip. Net: reels are tradeable — hand someone the chip and the reel goes with it,
> and you lose access. (`collect` remains for **auto-banked evidence** clips a camera captured on its
> own, which still have no chip until pulled.) The bullets below describe the prior owner-backed,
> clip-≠-datachip model and are superseded on those points.

- **Clip → microreel, not datachip.** `clip` now writes a `security_clips` row (a **microreel**) and
  **clears** the camera's live buffer so it records again — it no longer mints an `item_datachip_<id>`.
  Physical **datachips** stay a separate, deliberate export: `collect` (or the crime auto-bank) still
  physicalizes a clip into a tradeable/evidence item + its airable broadcast (`physicalizeClip` /
  `ensureClipBroadcast`), unchanged. The tablet's **Microreels** list is now backed by the owner's
  `security_clips` (`microreelList`), decoupled from inventory chips.
- **In-app viewer.** Opening a reel renders the app's **own** inline viewer (`view: 'reel'` →
  `renderReel`/`wireReel` in [`tablet-os.js`](../client/game/js/panels/tablet-os.js)): CRT screen,
  colour-coded transcript, client-side play/scrub. No handoff to the standalone `#chip-panel`
  (`datachipreplay.js` — *since deleted*; a physical `use <datachip>` also routes to the tablet
  reel viewer now).
- **Speech vs. narration colour.** `captureZoneLine` tags each frame `kind` (`say` → speech,
  `zone_event` → narration/emote); the buffer log and reel viewer colour them apart via theme tokens
  (`--mg-accent` speech / `--shub` narration), so the split re-skins per tablet theme.
- **Buffer caps and STOPS.** `CameraBuffer.push` no longer rolls over: at the `camera_buffer_lines`
  tunable (default **25**) it sets `full` and banks nothing more **until reset**. Reset is `clip`
  (save + clear) or the new `wipe`/**Clear** action (discard + clear). Capture stays activity-only
  (speech/arrivals/exits/emotes/actions via `zone.broadcast`) + content-diffed, so an empty room never
  spends buffer slots.
- **Home notification.** `pendingClipCount` (cams with unclipped footage) drives a red badge on the
  SPECTER home tile (`buildHome.notify` → `renderHomeApps`).
- **SPECTER Firmware Drive + install flasher.** SPECTER is acquired as a one-shot firmware install,
  not a carried spy-deck: the **SPECTER Firmware Drive** (`item_specter_program`, tag
  `specter_program`) — a cyberpunk USB stick — is `use`d to flash SPECTER onto the tablet. The server
  handler (`doInstallSpecter`) still sets the install flag + consumes the drive, but now returns a
  `specter_install` message; the client plays a cosmetic **firmware flasher** overlay
  (formerly `specterinstall.js`, *since deleted* — now folded into the tablet shell via
  `openTabletSpecterInstall`/`mountSpecterInstallFlash` in `tablet-os.js`, routed in `dispatch.js`): the
  drive slides into the tablet's data port, the screen boots, and a hackery erase→write→verify→patch
  log fills a progress bar before "SPECTER INSTALLED". The old carried **spy-deck** (`item_spy_deck` →
  `hub`/standalone `#shub-panel`) still works but is superseded by the tablet app; retiring it is a
  vendor-side follow-up.

## Resolved forks

All settled 2026-07-01 — see the two decision tables above. All phases have since shipped.
