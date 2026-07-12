# Jail (as built)

Getting **downed while WANTED** no longer sends you to the cloning vat — the police
scrape you up. You wake in **Precinct 9's Holding cell**, stripped of your gear, and
do time. Clean deaths (0 stars) are unaffected: normal corpse + clone-vat respawn.

Owned by the **jail** plugin (`plugins/jail/`). Everything below is what ships.

## Flow

1. **Takedown / booking.** `handlePlayerDeath` (engine, `gameLoop.js`) fires the
   `player.respawnZone` hook *before* it spawns the lootable corpse. The jail plugin
   reads the player's `wanted` flag; if ≥ 1 star it:
   - Levies a **booking fine** of **₵50 per half-star × the penalty multiplier**
     (`round(peak / 0.5) × 50 × penaltyMult()`, default multiplier **6**, dev-tunable
     `crime_penalty_multiplier`). All carried cash is **seized at booking**
     (`credits = 0`) and held in `jail_prisoners.held_credits`; at release you get
     back `held_credits − fine` with a seizure/refund receipt. Debt only accrues if
     the fine exceeds what you carried.
   - Pulls the **charge** off the suspect's surveillance rap sheet
     (`WANTED_CHARGES` action; falls back to "multiple outstanding warrants"), read
     *now* because surveillance clears the heat later in this same death.
   - **Confiscates** everything (quest items and `sealed`/`packaged` items excepted):
     contraband (weapons, drugs, hacking decks) goes to the shared **police evidence
     locker** — unless successfully **concealed** (see below); the rest is
     snapshotted into `jail_prisoners.held_items` to hand back on release.
   - **Issues a prison jumpsuit** (`dressInGarb` → `item_prison_jumpsuit`), worn
     immediately. It's a "jumpsuit": one garment worn on the torso that also fills
     the legs via its `covers:['legs']` tag (see the equip engine), so a stripped
     prisoner isn't left half-naked. Insert-if-present, so a world missing the item
     (e.g. the regress harness) just skips it. Removed automatically at release —
     `restoreHeld` wipes the whole inventory (garb included) before restoring the
     held snapshot, so you walk out in your own clothes again.
   - Writes a `jail_prisoners` row with `release_at = now + stars minutes`.
   - Returns `{ zone: cell, message }` — the engine respawns you in the cell, skips
     the corpse (the cops bagged your gear), and shows the holding-cell flavor.
   - Fires an **arrest-notice popup** (`type:'arrest_notice'`) with the charge,
     sentence, item count, fine, and new balance — a dismissible "Booking Record"
     window client-side.
2. **Doing time.** You're locked in `zone_mq_precinct_holding` (now furnished with a
   toilet, sink, and cot — the bodily + posture systems work in the cell). Its only
   exit (`up` → Lobby) is a **police-only hololock** (`door_precinct_cell`, `canHack:false`) —
   no deck can bypass it; you leave only when the guard walks you out.
   Your **wanted HUD keeps your stars and visibly decays** over the sentence (the
   minute tick pushes the remaining stars, computed from `release_at`), hitting zero
   right as you're released. This is a cosmetic countdown — your street heat was
   already cleared on arrest, so you leave clean.
3. **Release.** A `setTimeout` fires at the deadline. The officer **on duty for the
   current in-game hour** walks you out: the plugin names them, broadcasts a random
   release line into the cell, zeroes your HUD, TELEPORTs **only you** to the Lobby
   (`zone_mq_precinct_lobby`) — no cellmate slips through, the door never opens —
   restores your held legal items, and hands them back at the desk.

## Timing

Sentence = `stars × 1 base-minute × penaltyMult()` (default 6), then scaled through
the world clock (`realMsToGame`) — so with the default ×6 multiplier a 5★ stretch is
~30 base minutes, longer or shorter depending on the game-speed knob. `stars` is
`floor(peak)` where `peak` is the spree's **highest** wanted level, read from
surveillance via the `WANTED_PEAK` action (falling back to the current `wanted` flag
if surveillance isn't loaded) — so decaying 5★ down to ½★ before the takedown still
books a full 5★ sentence + fine. Half-stars round down; a peak under 1★ is a clean
clone-vat death, not jail.

## Duty roster / shifts

Three detention officers cover the day in **8-hour shifts** (game hour `/ 8`):

- `npc_precinct_guard` — **Detention Officer Kohl** (00:00–08:00), pre-existing.
- `npc_precinct_officer_2` — **Detention Officer Pryce** (08:00–16:00), new.
- `npc_precinct_officer_3` — **Detention Officer Marlow** (16:00–24:00), new.

The lobby is their workplace. A minute tick (`syncShift`) keeps **only the on-duty
officer in the lobby** and the other two in the **bullpen** (`zone_mq_precinct_bullpen`),
via `moveEntity`. Whoever's on shift at release time is the one who walks you out and
says the line. The pre-existing street cop **Sergeant Vale** (`npc_pd_officer`) is
unrelated and untouched.

## Cell fixtures

`zone_mq_precinct_holding` has a `toilet` (steel combo), a `sink`
(`flags.water_source`), and a `cot` (`interactions:['sit','lie']`). No engine
changes — the **bodily** (relief/hygiene), **water**, and **posture** (sleep/regen)
systems auto-detect these by `object_type`/flags, so `pee`/`poop`/`flush`/`use sink`/
`wash` and lying down all work while you do time.

## The evidence locker (`police_evidence`)

- **One shared, global** locker — contraband from every arrest lands in the same
  table.
- **Cap 50.** Each insert evicts the oldest rows past 50 (`ORDER BY created_at DESC
  OFFSET 50`).
- **3-day purge.** An hourly tick deletes rows older than 3 game-scaled days
  (the window runs through `gameMsToReal`).
- **No reclaim path.** Confiscated contraband is gone — this is a graveyard, not a
  property room. (A future "raid the evidence room" feature could surface it.)

**Contraband** = an item whose tags include `weapon` or `drug`, or the id
`item_hack_deck`. Everything else is "legal" and returned on release. Quest items and
`sealed`/`packaged` items are never touched (same carve-out `spawnPlayerCorpse` makes).

## Concealment (beating confiscation)

Contraband can survive booking if it's **concealed**:

- **Proactive:** `conceal <item>` stashes a carried item ahead of time — a Deception
  check vs difficulty 5 (`CONCEAL_DIFFICULTY`).
- **Reactive:** at booking, a live **palm minigame** fires (`conceal_search` message,
  resolved by `concealresolve`): pick one small item (≤ weight 3, `PALM_MAX_WEIGHT`)
  to palm past the scan — a check vs difficulty 6 (`SCAN_DIFFICULTY`), 20 s timeout
  (`CONCEAL_TIMEOUT_MS`).
- A **botched palm** fires a fresh `contraband_possession` charge (`CHARGE_CRIME`).
- Successfully concealed items skip the evidence locker and stay with you in the cell.

## Live arrest (non-lethal)

Jail isn't only downed-while-wanted: the plugin registers an **`ARREST` action** that
books a *live* suspect at ≤ 3.5★ without a death — `bookIntoCell(..., {teleport:true})`
teleports them to Holding and clears their heat via `WANTED_CLEAR`.

## Jailbreak

**The cell door is police-only (`canHack:false`)** — hacking it out is disabled, so
there is no self-service jailbreak: you leave when the guard walks you out, full stop.
The escape machinery below still exists for any *other* way out of the cell (a future
tunnel, an admin move, etc.): the `zone.entered` listener treats leaving `holding` by
anything but the guarded release as an escape —
- The legal gear the desk was holding is **bagged into evidence too** (forfeited).
- `WANTED_RAISE` (surveillance action) puts your stars back — a jailbreak is a fresh
  crime, so you leave as a hot fugitive.

Previously the door was a difficulty-10 *hackable* hololock (jailbreak via a smuggled
`item_hack_deck`); that path was closed to make the station police-only.

## Persistence

`jail_prisoners` survives restarts. On boot the plugin loads every row and either
releases immediately (deadline already passed while the server was down) or
reschedules the remaining time. Offline players are relocated DB-only; the timer
still returns their items.

## Tables

Both are runtime tables (schema exported, rows not) in `SCHEMA_SQL` — apply with
`npm run db:schema`:

- `jail_prisoners(player_id PK, cell_zone, release_zone, release_at, stars, held_items, held_credits, fine, created_at)`
- `police_evidence(id PK, item_id, quantity, condition, custom_data, source_handle, created_at)`

## Content

`scripts/create-jail.js` (one-shot) adds the cell door and Detention Officer Kohl
(`npc_precinct_guard`) to the existing Precinct 9. The cell (Holding), release room
(Lobby), and bullpen are pre-existing zones. Run once, then restart / `POST /world/reload`.

`scripts/create-jail-officers.js` (one-shot, idempotent) adds the two new officers
(**Pryce**, **Marlow**), flags Kohl as police, and adds the cell **toilet / sink /
cot**. Run once, then restart / `POST /world/reload`.

## Files

- `plugins/jail/index.js` — the whole system (fine, booking popup, shift roster, HUD decay)
- `plugins/jail/regress.js` — contraband classification, clean-death passthrough, confiscate↔restore round-trip
- `scripts/create-jail-officers.js` — the two new officers + cell fixtures (one-shot)
- `client/game/js/panels/arrest.js` — the booking-record popup (`arrest_notice`)
- engine seam: `server/engine/gameLoop.js` `handlePlayerDeath` (`player.respawnZone` hook + corpse skip)
- action seam: `plugins/surveillance/index.js` (`WANTED_RAISE`, `WANTED_CHARGES` rap sheet,
  `WANTED_PEAK`, `WANTED_CLEAR`, `CHARGE_CRIME`); the plugin also dispatches `TELEPORT`
  and registers `ARREST`
