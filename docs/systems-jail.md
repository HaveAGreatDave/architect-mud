# Jail (as built)

Getting **downed while WANTED** no longer sends you to the cloning vat — the police
scrape you up. You wake in **Precinct 9's Holding cell**, stripped of your gear, and
do time. Clean deaths (0 stars) are unaffected: normal corpse + clone-vat respawn.

Owned by the **jail** plugin (`plugins/jail/`). Everything below is what ships.

## Flow

1. **Takedown.** `handlePlayerDeath` (engine, `gameLoop.js`) fires the new
   `player.respawnZone` hook *before* it spawns the lootable corpse. The jail plugin
   reads the player's `wanted` flag; if ≥ 1 star it:
   - **Confiscates** everything (quest items excepted): contraband (weapons, drugs,
     hacking decks) goes to the shared **police evidence locker**; the rest is
     snapshotted into `jail_prisoners.held_items` to hand back on release.
   - Writes a `jail_prisoners` row with `release_at = now + stars minutes`.
   - Returns `{ zone: cell, message }` — the engine respawns you in the cell, skips
     the corpse (the cops bagged your gear, there's nothing to loot), and shows the
     holding-cell flavor instead of the clone-vat text.
   - Because the takedown already cleared your stars (surveillance's `player.death`
     listener), you come out of holding **clean**.
2. **Doing time.** You're locked in `zone_mq_precinct_holding`. Its only exit (`up`
   → Lobby) is a **difficulty-10 hackable hololock** (`door_precinct_cell`). The
   move gate blocks it; you wait.
3. **Release.** A `setTimeout` fires at the deadline. A guard "walks you out": the
   plugin broadcasts the guard line into the cell, TELEPORTs **only you** to the
   Lobby (`zone_mq_precinct_lobby`) — no cellmate slips through, the door never
   opens — restores your held legal items, and hands them back at the desk.

## Timing

`stars × 60 s`. 1★ = 1 minute … 5★ = 5 minutes. `stars` is `floor(wanted flag)` at
takedown (half-stars round down, min 1).

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

`scripts/create-jail.js` (one-shot) adds the cell door and a flavor desk guard
(`npc_precinct_guard`) to the existing Precinct 9. The cell (Holding) and release
room (Lobby) are pre-existing zones. Run once, then restart / `POST /world/reload`.

## Files

- `plugins/jail/index.js` — the whole system
- `plugins/jail/regress.js` — contraband classification, clean-death passthrough, confiscate↔restore round-trip
- engine seam: `server/engine/gameLoop.js` `handlePlayerDeath` (`player.respawnZone` hook + corpse skip)
- action seam: `plugins/surveillance/index.js` (`WANTED_RAISE`)
