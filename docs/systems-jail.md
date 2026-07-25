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
2. **Doing time.** You're locked in the **cell block**: `zone_mq_precinct_holding`
   (cot; the bodily + posture systems work in the cell) plus two rooms behind the
   same lock — the **Wash Block** (`zone_mq_precinct_showers`: the showers, and the
   steel toilet + sink, moved out of the cell) and **The Pit**
   (`zone_mq_precinct_gym`: the prison weight bench, so a sentence is somewhere to
   spend XP rather than dead air). Block membership is authored per zone as
   **`flags.cell_block`** and read by `inCellBlock()` — adding another room to the
   block is a content change, not a code one, and a room that *forgets* the flag
   fails safe (walking into it reads as an escape). The block's only exit
   (`up` → Lobby) is a **police-only hololock** (`door_precinct_cell`,
   `canHack:false`) — no deck can bypass it. It ships **locked** in content and
   `bookIntoCell` calls `secureCellDoor()` on every booking, so a release (which
   leaves it open) or an admin poking at it can't leave the next stretch servable
   by walking out.
   Your **wanted HUD keeps your stars and visibly decays** over the sentence (the
   minute tick pushes the remaining stars, computed from `release_at`), hitting zero
   right as you're released. This is a cosmetic countdown — your street heat was
   already cleared on arrest, so you leave clean.
   **`sentence`** (alias `time`) prints your detention record — charge, stars,
   time remaining, and what the desk is holding. The same record reads off the
   **charge sheet** clipped to the bars (`furn_cell_charge_sheet`,
   `flags.charge_sheet`) via a tag-gated `read` specialized action. The booking
   popup states the sentence once and is dismissible, and the star HUD only counts
   in whole stars, so without these a prisoner has no way to ask how long they're
   in for — which is most of why walking out looked like the only move.
3. **Release.** A `setTimeout` fires at the deadline. The officer **on duty for the
   current in-game hour** walks you out: the plugin names them, **disengages the
   hololock** (`releaseCellDoor()`), broadcasts a random release line into the cell,
   zeroes your HUD, TELEPORTs you to the Lobby (`zone_mq_precinct_lobby`), restores
   your held legal items, and hands them back at the desk. The lock **stays**
   disengaged until the next booking re-secures it — a served sentence genuinely
   opens the way out rather than depending on a timer nobody can see. The accepted
   cost: a cellmate still doing time can walk through the open door, and that's
   still an `escape()` (gear forfeited, heat back). Offline releases are DB-only
   and don't touch the door.

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
(`flags.water_source`), and a `cot` (`interactions:['sit','lie']`). The
**bodily** (relief/hygiene), **water**, and **posture** (sleep/regen) systems
auto-detect these by `object_type`/flags, so `pee`/`poop`/`flush`/`use sink`/
`wash` and lying down all work while you do time.

**Sleeping in the cell** takes the **`allow_sleep`** zone tag (set on
`zone_mq_precinct_holding`). Ordinarily `sleep` requires a sanctuary bundle;
`allow_sleep` (read by `allowsSleep` in `zone-tags.js`, consumed in
`getSleepEligibility` in `apartments.js`) grants rest at the safe-zone rate
**without** making the cell a sanctuary — no forcefield, no combat protection,
no spawn suppression. It's the flag that makes doing your time restful without
turning the holding cell into a safe room.

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

**The cell door is police-only (`canHack:false`) and locked while you're serving** —
hacking it is disabled and the engine door-lock move gate blocks the exit, so there is
no self-service jailbreak: you leave when the guard walks you out, full stop. (Until
2026-07-24 the door shipped `lock_state:"unlocked"`, which made the whole lock moot —
a prisoner walked `up` and the only consequence was the escape penalty below.)
The escape machinery still covers any *other* way out of the cell (the door left open
behind an earlier release, a future tunnel, an admin move): the `zone.entered`
listener treats arriving anywhere
**outside the cell block** (`inCellBlock()` — the cell plus every `flags.cell_block`
room) by anything but the guarded release as an escape —
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

- `jail_prisoners(player_id PK, cell_zone, release_zone, release_at, stars, held_items, held_credits, fine, charge, created_at)`
- `police_evidence(id PK, item_id, quantity, condition, custom_data, source_handle, created_at)`

## Content

`scripts/create-jail.js` (one-shot) adds the cell door and Detention Officer Kohl
(`npc_precinct_guard`) to the existing Precinct 9. The cell (Holding), release room
(Lobby), and bullpen are pre-existing zones. Run once, then restart / `POST /world/reload`.

`scripts/create-jail-officers.js` (one-shot, idempotent) adds the two new officers
(**Pryce**, **Marlow**), flags Kohl as police, and adds the cell **toilet / sink /
cot**. Run once, then restart / `POST /world/reload`.

## Files

- `plugins/jail/index.js` — the whole system (fine, booking popup, shift roster, HUD decay,
  cell-door lock/unlock, the `sentence` readout)
- `content/doors/door_precinct_cell.json` — the hololock, authored **locked**
- `content/furniture/furn_cell_charge_sheet.json` — the readable charge sheet on the bars
- `plugins/jail/regress.js` — contraband classification, clean-death passthrough, confiscate↔restore round-trip
- `scripts/create-jail-officers.js` — the two new officers + cell fixtures (one-shot)
- `client/game/js/panels/arrest.js` — the booking-record popup (`arrest_notice`)
- engine seam: `server/engine/gameLoop.js` `handlePlayerDeath` (`player.respawnZone` hook + corpse skip)
- action seam: `plugins/surveillance/index.js` (`WANTED_RAISE`, `WANTED_CHARGES` rap sheet,
  `WANTED_PEAK`, `WANTED_CLEAR`, `CHARGE_CRIME`); the plugin also dispatches `TELEPORT`
  and registers `ARREST`
