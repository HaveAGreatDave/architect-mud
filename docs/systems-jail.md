# Jail (as built)

Getting **downed while WANTED** no longer sends you to the cloning vat — the police
scrape you up. You wake in **Precinct 9's Holding cell**, stripped of your gear, and
do time. Clean deaths (0 stars) are unaffected: normal corpse + clone-vat respawn.

Owned by the **jail** plugin (`plugins/jail/`). Everything below is what ships.

## Flow

1. **Takedown / booking.** `handlePlayerDeath` (engine, `gameLoop.js`) fires the
   `player.respawnZone` hook *before* it spawns the lootable corpse. The jail plugin
   reads the player's `wanted` flag; if ≥ 1 star it:
   - Levies a **booking fine** of **₵50 per half-star** (`round(wanted / 0.5) × 50`).
     Debt is allowed — the debit is un-clamped, so a broke player leaves owing the
     city (negative credits).
   - Pulls the **charge** off the suspect's surveillance rap sheet
     (`WANTED_CHARGES` action; falls back to "multiple outstanding warrants"), read
     *now* because surveillance clears the heat later in this same death.
   - **Confiscates** everything (quest items excepted): contraband (weapons, drugs,
     hacking decks) goes to the shared **police evidence locker**; the rest is
     snapshotted into `jail_prisoners.held_items` to hand back on release.
   - Writes a `jail_prisoners` row with `release_at = now + stars minutes`.
   - Returns `{ zone: cell, message }` — the engine respawns you in the cell, skips
     the corpse (the cops bagged your gear), and shows the holding-cell flavor.
   - Fires an **arrest-notice popup** (`type:'arrest_notice'`) with the charge,
     sentence, item count, fine, and new balance — a dismissible "Booking Record"
     window client-side.
2. **Doing time.** You're locked in `zone_mq_precinct_holding` (now furnished with a
   toilet, sink, and cot — the bodily + posture systems work in the cell). Its only
   exit (`up` → Lobby) is a **difficulty-10 hackable hololock** (`door_precinct_cell`).
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

`stars × 60 s`. 1★ = 1 minute … 5★ = 5 minutes. `stars` is `floor(peak)` where `peak`
is the spree's **highest** wanted level, read from surveillance via the `WANTED_PEAK`
action (falling back to the current `wanted` flag if surveillance isn't loaded) — so
decaying 5★ down to ½★ before the takedown still books a full 5★ sentence + fine.
Half-stars round down; a peak under 1★ is a clean clone-vat death, not jail. Game time
runs 1:1 with real time.

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
- **3-day purge.** An hourly tick deletes rows older than 3 days.
- **No reclaim path.** Confiscated contraband is gone — this is a graveyard, not a
  property room. (A future "raid the evidence room" feature could surface it.)

**Contraband** = an item whose tags include `weapon` or `drug`, or the id
`item_hack_deck`. Everything else is "legal" and returned on release. Quest items are
never touched (same carve-out `spawnPlayerCorpse` makes).

## Jailbreak

The cell door is a real `canHack` hololock, so `hack door up` opens the HOLOLOCK
BYPASS minigame — but the engine hack requires an `item_hack_deck` in inventory, and
yours was confiscated. **Escaping therefore needs a deck smuggled to you** (a friend
dropping one), on top of beating a difficulty-10 lock. If you do get out — or leave
the cell any way other than the guard — the `zone.entered` listener treats it as an
escape:
- The legal gear the desk was holding is **bagged into evidence too** (forfeited).
- `WANTED_RAISE` (surveillance action) puts your stars back — a jailbreak is a fresh
  crime, so you leave as a hot fugitive.

## Persistence

`jail_prisoners` survives restarts. On boot the plugin loads every row and either
releases immediately (deadline already passed while the server was down) or
reschedules the remaining time. Offline players are relocated DB-only; the timer
still returns their items.

## Tables

Both are runtime tables (schema exported, rows not) in `SCHEMA_SQL` — apply with
`npm run db:schema`:

- `jail_prisoners(player_id PK, cell_zone, release_zone, release_at, stars, held_items, created_at)`
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
- action seam: `plugins/surveillance/index.js` (`WANTED_RAISE`, `WANTED_CHARGES` rap sheet)
