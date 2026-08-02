# SPECTER: Broadcast Piracy — Pirate Station Takeover (Proposal, Not Built)

*A SPECTER capability: flash a piracy firmware, hack a station's **media deck**, and seize its
frequency — cut its cameras to your own SPECTER feed, air recorded tapes and spy microreels, and
run the schedule from your tablet while the city watches whatever you want.*

Grows the **broadcast half** of the media system into a player-seizable, PvP-capable takeover layer —
the mirror image of what [SPECTER surveillance](../systems-surveillance.md) did to the camera half.
Reuses the media-deck override, the SPECTER firmware/tablet shell, the Circuit-Breach-style hack
loop, the crime/Wanted spine, and the dead-man tamper ping. **No new render stack, no new content
system** — it turns the deck's existing `deck_active` override into a real pirate console.

> Status: **Phases 1–4 built (2026-07-12); regress-green.** Design agreed with all forks resolved in
> the decision tables below. Phases 1 (gate + seizure + Signal Hijack + crime), 2 (pirate console —
> queue/playback/crawl), 3 (LIVE/RECORDED toggle + live camera routing), and 4 (reclaim — engineer
> reboot + Wanted-heat drop + counter-hack) extend the **broadcast plugin** (it already owns the deck
> verb + `_getDeckMessage`). Only Phase 5 (corp-station targeting) pending — see the phase list.

---

## The pitch

Media decks already exist — one `furniture` row per channel (`flags.media_deck`), and while its
`deck_active` is set it **overrides the channel's programming citywide** for every tuned viewer
(`_getDeckMessage()` in [`plugins/broadcast/index.js`](../../plugins/broadcast/index.js)). Today
`use <deck>` is open to **anyone** in the zone — a crude, un-gated, un-punished takeover with a
single loaded tape.

This feature makes that override **intentional and dangerous**: lock the deck, gate real control
behind a **piracy firmware + a live hack**, and expand the crude override into a full pirate console —
**live/recorded switching, a queue you build from your own tapes and spy reels, playback controls,
and overlay taunts** — held **persistently** until the station fights back.

## Confirmed decisions (2026-07-12 review)

| Fork | Decision |
|---|---|
| **Access gate** | **Firmware becomes the gate.** Lock down today's open `use <deck>`. Controlling a deck you don't own now requires the piracy firmware **+** a successful hack. |
| **Takeover model** | **Persistent seizure until reclaimed.** You hold the station indefinitely; a tamper ping fires to the owner; it takes an active reclaim to end it. |
| **Edit target** | **Ephemeral pirate override.** All edits live in the deck's runtime/override state. The real `media_channel_playlist` is untouched and restored on reclaim. No content mutation. |
| **Hack mechanic** | **New "Signal Hijack" minigame** (bespoke, distinct from Circuit Breach), difficulty scaled to the station. |
| **Live/recorded toggle** | **Live cameras vs. recorded shows.** LIVE cuts the feed to a camera; RECORDED plays your queued content. |
| **Camera source (LIVE)** | **Station studio cam _and_ any SPECTER cam you control** — ride the station's own camera, or pipe your surveillance feed live citywide. |
| **Content pool (RECORDED)** | **Carried cassettes + your SPECTER microreels/datachips + the station's own library** (`deck_cassettes`). Not the full authored catalog. |
| **Reach** | **Hack on-site, hold remotely.** Breach the deck in person; once seized, run it from anywhere via the SPECTER tablet. |
| **Targets** | **NPC + player/corp stations.** All current channels (city/NPC) are fair game now; corp-owned stations join when corp station-ownership exists (phase-gated — see Dependencies). |
| **Firmware acquisition** | **Black-market vendor (Glitch** at *The Blindspot)*, matching the SPECTER spicy-gear trust-tier pattern. |
| **Playback options** | **Play/stop · Skip/next · Loop/repeat · Overlay + breaking-news crawl.** |
| **Reclaim path** | **Three, all active (no auto-timer):** station **engineer NPC** dispatched to reboot; **Wanted heat** (arrest/death drops the seizure); **counter-hack** by owner or a rival pirate. |

---

## Seizure state (where the takeover lives)

Stored **on the media-deck furniture `flags`** — so it inherits the furniture pipeline, persists in
the DB, and **survives server restarts** (a pirate holds through a reboot until actively reclaimed).
This is the *ephemeral pirate override* — ephemeral vs. the channel's real `media_channel_playlist`,
which is never written.

```
furniture.flags (media deck), added keys:
  pirate_locked      true            -- deck no longer freely usable; firmware+hack required
  hack_difficulty    INTEGER         -- station's Signal-Hijack difficulty (station-scaled)
  pirate_owner       <player id>     -- current pirate, or null
  pirate_since       BIGINT
  pirate_mode        'live'|'recorded'
  pirate_live_source { kind:'station_cam' | 'specter', deviceId?, zoneId }  -- when mode=live
  pirate_queue       [ { src:'cassette'|'microreel'|'library', ref, name }, … ]  -- recorded queue
  pirate_cursor      INTEGER         -- current queue index
  pirate_loop        'off'|'item'|'queue'
  pirate_overlay     { title?, ticker?, until? }  -- active overlay/crawl, optional
```

`_getDeckMessage()` gains a branch: **if `pirate_owner` is set, the pirate state wins** over both the
channel's own programming *and* the legacy `deck_active` path. In `recorded` mode it emits from the
current queue item (a cassette/library broadcast asset, or a microreel's frames); in `live` mode it
emits a per-tick camera snapshot (`feedSnapshot()` for a SPECTER cam, `buildCameraSnapshot()` for a
station cam); overlays/tickers ride on top via the existing `overlay`/`ticker` styles.

**No new tables required.** Only additive touches: the `flags` keys above, and one new crime key
(below). A `station_piracy` history/leaderboard table is a *possible* later nicety, not needed for v1.

---

## Mechanics

### 1. Firmware — the gate

- New SPECTER program item **Pirate Signal Firmware** (`item_pirate_firmware`, `tags.specter_program`
  family) — a black-market USB flashed onto the tablet with `use`, mirroring `doInstallSpecter`
  (`item_specter_program`): sets an install flag (`piracy_installed`), consumes the drive, plays the
  firmware-flasher overlay folded into the tablet shell.
- Sold by **Glitch** at *The Blindspot* (existing SPECTER black-market vendor), trust-tier gated.
- **Locking the deck:** `use <deck>` / `doUseMediaDeck` now checks ownership. Owner (station
  owner / dev-admin) opens the normal console; anyone else with the firmware gets the **hack entry
  point**; anyone without it is refused (`The deck's control interface is locked.`). This removes
  today's free-for-all override — the behavior change to verify in regress.

### 2. Signal Hijack — the hack (on-site)

A bespoke real-time minigame — **carrier capture** — deliberately distinct from the two existing
hacks (Circuit Breach = turn-based graph routing; Hololock = rhythm-timing on static channels). You
**overpower the station's carrier wave with your own transmitter**: track a drifting, evading signal
and hold the lock to seize the air.

- **Loop.** A spectrum band shows the station's **carrier** — a bright peak that drifts and
  periodically **frequency-hops** (jump-cuts you must re-acquire). **Decoy harmonics** mimic it. Your
  tuner window must overlap the *real* carrier to fill **CAPTURE**; off-target it drains. The
  station's IDS fills a **TRACE** meter over time. Fill CAPTURE (past three notches — *AUDIO → VIDEO →
  SCHEDULER*, cosmetic progress that narrates the takeover) before TRACE tops out.
- **Framework.** Plugs into [`minigame-common.js`](../../client/game/js/panels/minigame-common.js)
  like the others: `mountOverlay` + chassis, `deviceHeader('◈','SIGNAL HIJACK', 'TARGET · <station>')`,
  `deckStrip('CARRIER BUS','TRACE')` + `setDeckLevel`, new `hijack-*` cues in `sfx-catalog.js`. Accent
  hot magenta `#ff5f8a` (distinct from Circuit teal / Hololock blue; matches the TV `pirate` theme).
  Real-time RAF loop (like Hololock — tracking a live target needs continuous input).
- **Scaling — the shared `edge = skill − difficulty` contract.** Skill = **hacking**; difficulty =
  deck `hack_difficulty` (station-scaled). `edge` drives: tuner tolerance (lock window width), carrier
  drift speed + hop rate, decoy count (0–3), CAPTURE fill-vs-drain, and TRACE rate + ceiling — an
  out-classed pirate faces a genuinely brutal board, not a cosmetic difference.
- **Two tactical abilities** (parity with Circuit's PING/SCAN/BREACH, held to two): **SWEEP** — spend
  a little TRACE to tag the true carrier + dim decoys ~2s (the SCAN analogue); **OVERDRIVE** (hold) —
  dump power so CAPTURE fills much faster **but** TRACE climbs faster and the lock window narrows (the
  risky BREACH-style closer).
- **Server wiring** (authoritative-resolve pattern, exactly like Circuit/Hololock). `use <deck>` +
  firmware → server validates, arms a `pendingHijack` token (anti-spoof), returns `signal_hijack`
  `{ skill, difficulty, stationName, accent }`; `dispatch.js` routes it → `openSignalHijack(opts)`;
  `onResult({won})` → client fires `hijackresolve <deckId> <win>` → **server re-runs the real hacking
  skillCheck** and is authoritative: **win** sets `pirate_owner`, stamps `pirate_since`, fires the
  `broadcast_piracy` crime + tamper ping; **loss** = short rig lockout on that deck. Re-Jack is
  cosmetic practice — only the server resolve counts.

### 3. Hold remotely — the pirate console (SPECTER tablet)

Once seized, control moves to a **new SPECTER tablet view** (reuse the surveillance-app shell in
[`tablet-os.js`](../../client/game/js/panels/tablet-os.js)); the on-site `mediadeck_panel` also
gains the pirate controls for the owner-at-deck case. Controls:

- **LIVE / RECORDED toggle** — flips `pirate_mode`.
- **Recorded queue editor** — add from the **content pool** (carried cassettes · your SPECTER
  microreels/datachips · the station's own `deck_cassettes`), delete, reorder (reuse the
  [list-reorder](../../client/game/js/panels/list-reorder.js) engine). This is the "pick from a bottom list /
  load cassettes / delete broadcasts" surface, mapped onto the *ephemeral* queue, not the real
  playlist.
- **Playback** — Play/Stop, Skip/Next (advances `pirate_cursor`), Loop (off/item/queue).
- **Live source picker** — station studio camera, or any SPECTER camera you own (routes its
  `feedSnapshot`). This is the surveillance crossover: broadcast a rival's private moment live.
- **Overlay / breaking-news crawl** — inject a title card + scrolling ticker (reuse broadcast
  `overlay`/`title_card`/`ticker` nodes) to taunt the city while you hold the air.

### 4. Crime & Wanted

- New crime key **`broadcast_piracy`** in the [crime registry](../../server/engine/crimes.js),
  witness-mode **`always`** (a citywide hijack is inherently reported) → heavy stars (proposed 3–4,
  tune in the dev Crimes panel). Charged via `raiseCrime` on a successful hijack; ongoing possession
  keeps you hot. Integrates with the built [Wanted system](../systems-surveillance.md#wanted-system-phase-6).
- **Tamper dead-man ping** to the station owner/PD network on seizure (reuse the SPECTER `⚠ TAMPER`
  ping) — the station *knows* it's been pirated, which is what triggers the engineer response.

### 5. Reclaim — how the station fights back (persistent, three active paths)

- **Engineer NPC dispatch** — the tamper ping dispatches a station **engineer/tech NPC** (VINE
  `GO_TO` to the studio zone, same pattern as police dispatch / broadcast NPC scheduling). On arrival
  it **reboots the deck** after a short on-site delay → clears `pirate_owner`, restoring normal
  programming. Gives the pirate a defend-the-studio window.
- **Wanted heat** — arrest/downed/death while holding a station drops the seizure (the citywide crime
  keeps units hunting you).
- **Counter-hack** — the owner, or a rival pirate, runs Signal Hijack against the held deck to wrest
  it back. Enables PvP over a frequency.
- **No auto-reboot timer** — the station only comes back through one of the three active paths.

---

## Phased build (each phase independently shippable)

1. **Gate + seizure core** — ✅ *built 2026-07-12 (broadcast plugin; regress-green).*
   `item_pirate_firmware` (content) + `use`→`doInstallPiracyFirmware` (sets `piracy_installed` flag,
   consumes drive); `_deckLockError`/`canOperateDeck` gate on `use`/`load`/`eject`/`selectcassette`
   (admin/dev or current pirate only — today's open access is now locked); `pirate <deck>` +
   `pendingPirate` token → `signal_hijack` push → the **Signal Hijack** minigame
   ([`signalhijack.js`](../../client/game/js/panels/signalhijack.js), carrier-capture, built on
   `minigame-common.js`); `pirateresolve` seizes on win — `pirate_owner`/`pirate_since` on the deck's
   furniture flags (survives restarts), `broadcast_piracy` crime via the `CHARGE_CRIME` action, a ⚠
   TAMPER ping to any prior pirate, 5-min lockout on loss; the schedule-sync tick skips pirated decks.
   Recorded-only for now: the pirate runs the deck's existing `deck_active` override (load a tape → it
   airs citywide). *Ships a working, punishable takeover.* **Deviation from the original plan:** built
   as an extension of the broadcast plugin (per the change-gate's "already owned → extend the owner"),
   not a new plugin; the fancy tablet firmware-flasher overlay was deferred (plain grant message for
   now).
2. **Pirate console** — ✅ *built 2026-07-12 (broadcast plugin; regress-green).*
   `air [open|play|stop|skip|loop <mode>|add <name>|remove <n>|move <n> <m>|crawl <text|off>|close]` +
   a self-mounted client console ([`piratedeck.js`](../../client/game/js/panels/piratedeck.js), `pirate_console`
   push) — opened by the captor's `use <deck>` or `air` **from anywhere** (hold-remote). Recorded
   **queue** on the deck flags (`pirate_queue`/`pirate_cursor`/`pirate_loop`/`pirate_playing`/
   `pirate_started_ms`/`pirate_crawl`), seeded from the station library on seizure; content pool =
   carried cassettes + SPECTER microreels (cassette-tagged datachips) + the station's own library.
   `_getPirateMessage` runs the queue in `_getDeckMessage` with **real-duration auto-advance**
   (`broadcastDuration`), loop off/item/queue, and a breaking-news **ticker crawl**. Play/Stop/Skip and
   reorder/remove/add all edit the flags and refresh the console. *Ships "run the schedule from in
   game."* **Deviations:** the console is a self-mounted overlay (not folded into the tablet shell —
   simpler, and it opens both on-site and remotely); the crawl rides the existing ticker style (~1 tick
   in 3) rather than a dedicated overlay event; the open console reflects state at each command, not a
   live push (auto-advance shows on a TV, not in the console) — a live-refresh push is a small follow-up.
3. **Live camera routing** — ✅ *built 2026-07-12 (broadcast plugin; regress-green).*
   `pirate_mode` ('recorded'|'live') + `pirate_live_source` on the deck flags; `air recorded` /
   `air live [src]` / `air source <src>` toggle + pick. LIVE mode's `_getPirateMessage` branch cuts to
   a camera via **`buildCameraSnapshot(zoneId)`** — the station studio cam (channel `studioZoneId`) **or**
   any SPECTER camera the captor controls (`_liveSources` reads `security_devices` for their
   `sticky_cam`/`drone` devices **read-only** — no surveillance import; every source is just a zone to
   render). The console gains a RECORDED/LIVE toggle + a source picker; the crawl rides both modes.
   *Ships the surveillance crossover — broadcast a rival's private moment citywide.* **Deviation:** used
   broadcast's own `buildCameraSnapshot` for every source (station and SPECTER alike) rather than
   surveillance's plugin-private `feedSnapshot` — same result (a zone rendered as feed text), no
   cross-plugin code coupling.
4. **Reclaim depth** — ✅ *built 2026-07-12 (broadcast plugin; regress-green).* All three active paths,
   no auto-timer: **(1) engineer response** — a 15 s `engineerTick` reboots any deck whose 2-min defend
   window (`_engineerDueAt` on `pirate_since`, or a stamped `pirate_engineer_at` retry) has elapsed,
   **unless the captor is standing at the deck** (they run the engineer off; retry in 90 s) — the seize
   message telegraphs it. **(2) Wanted-heat drop** — `player.death` (covers downing/arrest) fires
   `_releaseSeizuresBy` → every station the victim held falls. **(3) counter-hack** — a rival re-runs
   Signal Hijack on a deck they don't own (`cmdPirate`/`cmdPirateResolve` already allow it and reset the
   defend window). All reclaim routes clear via `_clearSeizure` (wipes `pirate_*` → the channel's own
   programming resumes). *Ships the station fighting back.* **Deviation:** the engineer is a
   **telegraphed, presence-defended reboot** (messaging + a defend-by-standing-there window), not a
   physically-pathing killable NPC — same gameplay loop, far lower risk; the surveillance
   hunter pattern (`spawnEnemySync` + `findPath`/`moveEntity`) can upgrade it to a walk-in unit later.
5. **Corp/player station targeting** *(dependency-gated)* — extend targeting + counter-hack to
   corp-owned stations once corp **station ownership** exists (see Dependencies). Until then, all
   channels read as city/NPC and are pirateable under phases 1–4.

## Dependencies & risks

- **Corp-owned stations don't exist yet.** "NPC + player/corp stations" is fully realized only when
  the [corps system](../systems-corps.md) gains media-asset ownership. Phases 1–4 treat every channel as
  city/NPC (all pirateable); Phase 5 is the corp-ownership overlay.
- **Behavior change: locking open deck access.** Today any player can `use` any deck and override it.
  Locking it is correct per the [broadcast overhaul](../../CLAUDE.md) (media-deck = required
  transmitter), but must be verified against any content/quests that assumed free deck use. **Run
  `npm run test:regress`** after Phase 1.
- **Restart semantics.** Seizure lives in DB `flags`, so it *persists across restarts* by design.
  Runtime-only bits (dispatched-engineer timers) rebuild from the ping/flag state on boot.
- **All-additive schema.** Only new `flags` keys + one crime default; no new tables for v1. Any table
  (piracy history/leaderboard) would ship via CODEX like any additive content.

## Open questions (deferrable)

- **Signal-Hijack feel** — *resolved 2026-07-12:* carrier-capture (see §2). Remaining polish-level
  calls for Phase 1 client work: exact drift/hop cadence curves, whether OVERDRIVE also risks a
  self-jam, and SWEEP's TRACE cost.
- **Engineer response timing** — dispatch delay + reboot dwell (tunable), and whether higher-value
  stations respond faster/with guards.
- **Microreel-on-air fidelity** — do reels play as their captured frame transcript, or a stylized
  "leaked footage" card? (Frames are cheapest; matches the reel viewer.)
- **Station leaderboard** — do we want a visible "pirated N times / longest hold" record later? (Only
  reason to add a `station_piracy` table.)
