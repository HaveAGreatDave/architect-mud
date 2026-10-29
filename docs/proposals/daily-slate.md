# The daily slate

**Status:** Phases 1 and 2 built (2026-10-24): the slate, month seasons, KSAB5 and the relay. Phase 3's rename to Golden Goose Gardens was already in; Phases 4 and 5 are design, and the scoreboard TVs were dropped (2026-10-29): the stands have no TV. As built, Saturday's one-day 18:00 show still beats the every-day relay on ch 7 (narrower day mask), the `.bsm` files keep `@airtime` (a slate item ignores it), and the Deadball fallback in `sportOf` stays.

Every Deadball and Cluster Puck club plays every in-game day. Each sport has eight clubs, so it plays four games a day. Two sports at four games each fill all eight three-hour slots, one game per slot. Every game is played at its sport's ground. KSAB5 "The Cinqo" Sports Network airs all of them around the clock. KSAB-TV ch 7 airs one featured game a day.

## Today

- `sportsGameForSlot` (`plugins/broadcast/index.js`) can make a game for any slot, but only the 18:00 slot airs.
  - Deadball airs Mon/Wed/Fri and Cluster Puck Tue/Thu/Sun, both on ch 7.
  - Saturday has neither.
- Standings already count every slot, aired or not. `broadcast.computeStandings` walks every slot in the season window. Today each sport plays a game in all eight slots a day, two full rounds that nobody sees. The slate cuts that to one round a day, four games, every one of them on air.
- `_sportsGraphCache` holds one game. A second channel showing a different game would rebuild it every second.

## The slate

- `sportsSlateForDay(date)` returns the day's eight games: sport, slot, home and away.
  - Each sport plays one round-robin round of four games.
  - The sports alternate slots: on even days Deadball has 00, 06, 12 and 18 and Cluster Puck has 03, 09, 15 and 21. Odd days swap them.
  - The 18:00 pairing is picked by the ch 7 rotation (below). The day's seed shuffles the rest, so a club's start time moves from day to day.
- `sportsGameForSlot` becomes a lookup into the slate. It's still a pure function of the clock.
- Bump the pinned sim version in `world_flags`, so results from the old schedule aren't recomputed under the new one.

## Grounds

- Every Deadball game is at the Charles B. Hughson Coliseum.
- Every Cluster Puck game is at Golden Goose Gardens.
  - The name changes everywhere: zone names, prose, `bc_cluster_puck.json`, the hockey script, the map and the scoreboard.
  - The `slush` ids stay, as they do now.
- Lights and the roof follow the game being played there, every slot rather than just the aired one.
- ~~Both scoreboard TVs tune to KSAB5.~~ Dropped: the stands have no TV.

## Channels

- **KSAB5 "The Cinqo" Sports Network**
  - A new `media_channels` row, channel 5.
  - Its playlist is one sports row for all seven days, and each slot airs whatever the slate says.
- **KSAB-TV ch 7**
  - Airs whatever game is played at 18:00, live, every day, Saturday included. KSAB5 shows the same game at the same time.
  - The 18:00 slot alternates sports by day, so the slot pattern flips on odd days (Cluster Puck at 00, 06, 12 and 18). Ch 7 then has Deadball one day and Cluster Puck the next.
  - The 18:00 game rotates through the clubs. The slate puts the pairing whose two clubs have aired on ch 7 the fewest times this month into that slot, with ties broken by the seed. Every club gets about the same number of ch 7 games each month.
  - The count is a fold over the month's slates, computed from the clock as the standings are. Nothing is stored.
### The relay block

Ch 7's 18:00 slot is a new kind of playlist block: a **relay**. It carries no show of its own and airs whatever another channel is showing at that moment. One playlist row covers every day:

```json
{
  "id": "ksab-7-1800-relay",
  "channel_id": "ch_7_1782953079593",
  "slot_type": "relay",
  "source_channel_id": "ch_5_cinqo",
  "broadcast_id": null,
  "days": 127,
  "start_time": 64800,
  "duration_override": 10800,
  "priority": 0,
  "conditions": []
}
```

- **A slot type, not a show type.** A relay is a `slot_type` beside `broadcast` and `commercial`, not a new `playback_mode`.
  - It has no broadcast and no pools, so the roughly nine places that branch on `playback_mode` stay as they are.
  - Schema: one nullable `source_channel_id` column on `media_channel_playlist`, in `SCHEMA_SQL`.
- **Resolving it.** When `_pickDailySlot` lands on a relay, `getCurrentMessage` returns the source channel's current item. That means the same item at the same graph position, so a viewer who switches between ch 5 and ch 7 sees the same moment of the game.
  - The relay counts as tuned to the source channel when the code de-duplicates per game, so `sports.game` and the venue lights don't fire twice.
- **Branding.** The TV's channel bug reads "KSAB-TV 7 · via KSAB5 The Cinqo", taken from the source channel's name. That way it's clear the picture comes from somewhere else.
- **Rules.**
  - A relay can't point at another relay. Self-loops and chains are rejected by `content:lint` and again at runtime.
  - If the source channel has nothing on, the relay shows the target channel's off-air card.
  - `duration_override` sets how long the relay holds the slot, regardless of what the source is airing.
- **The schedule editor.** The dev panel's channel grid offers "Relay…" next to "Broadcast…" and asks for a channel instead of a broadcast. The block is drawn as a link to that channel.
- **Other uses.** A relay is generic engine, not sports content. It could carry a news simulcast on a second channel, or an emergency broadcast cut into every channel.

With the relay in place, ch 7 needs no sports logic at all. KSAB5's slate already rotates the 18:00 game between sports and clubs, and ch 7 shows whatever that game is.

- `sports.game` fires once per game, de-duplicated by game id rather than by channel. A game on both channels is counted once by standings and betting.

## The Cup game

- The last day of each in-game month is Cup day: the day whose next date falls in a new month on the world calendar (`apartments.js` dates).
- The final is played that day: Deadball's Curtain Call and Cluster Puck's Coldwater Cup, between the top two clubs over the month.
- On Cup day each sport plays only its final. The other slots have no game.
- Ch 7 airs both finals and KSAB5 simulcasts them.
- The season becomes the calendar month, replacing `SPORTS_SEASON_DAYS = 30`. `sports_season` keeps its row shape, and `start_slot` becomes the first slot of the month.
- Each club plays about 29 games a month: 28 to 30 regular days, less Cup day.

## Following a club

- `follow <club>` stores one club per league in `player_flags`. `unfollow <club>` clears it.
- `fixtures` lists today's eight games in in-game time, with your clubs highlighted and the channel for each. A tab in the tablet TV app shows the same list.
- About ten in-game minutes before your club plays, you get one line: "The Hullbreakers face off at Golden Goose Gardens shortly. KSAB5."
- New verbs go in `docs/plugins.md`. The guest rules don't apply, because both verbs are private.

## Engine changes

- `_sportsGraphCache` becomes a cache keyed by `sport:slot` holding about four games.
- Remove the fallbacks that assume Deadball (`sportOf`, `leagueOf`), now that both sports run every day.
- Cost: eight sims per in-game day instead of about one, with no new query on a hot path. `follow` writes a flag and `fixtures` reads from RAM.

## Gates

`plugins/sportsleague/regress.js`:
- Each day has eight games, one per slot, and no club plays twice.
- The relay returns the source channel's item and its graph position. Chains and self-loops are rejected. An off-air source shows the off-air card.
- Ch 7 airs the 18:00 game, the sport alternates by day, and over a month every club's ch 7 count is within one of every other club in its league.
- A game on both channels counts once.
- Cup day has only the two finals, between the month's top two.
- `follow` and `fixtures` round-trip.

## The KSAB5 studio and the grounds

KSAB5 exists in the world, not just on the schedule. It has a small studio in the Media Lot, an outside-broadcast deck in each ground's pressbox and cameras in each ground.

### The studio

Two rooms off the Writers' Wing Story Floor (`zone_ksab_lobby`), on `map_int_ksab`. No new tile or building.

- **The Cinqo desk** (`zone_ksab5_studio`): a small presentation set with two cameras and the anchor's desk. Ch 5's `studio_zone_id` points here.
- **KSAB5 master control** (`zone_ksab5_control`): the wired channel deck `furn_deck_ksab5` and a bank of feed monitors, one per ground. Each monitor shows its ground as live, dark or no game.
- **Power:** off the Writers' Wing junction box, with the power_zones row, fixture and lights wired in the same build.
- **Staff:** one producer NPC. The anchor reads the scores between games. The games themselves need nobody in the studio.

### Outside-broadcast decks

- Each pressbox gets a wired OB deck: `furn_ob_deck_hughson` in `zone_hughson_pressbox` and `furn_ob_deck_slush` in `zone_slush_pressbox`. Both carry `uplink_channel: ch_5_cinqo` and `flags.ob_deck`.
- **Engine change:** `_portableDeckLive` becomes "any live, powered deck in the zone bound to this channel". The change is generic, not sports code.
- **Locating a game:** `sports_pools.venue.site` gains `ob_zone_id` (the pressbox) and `camera_zones`.
  - A game's `location_zone_id` comes from the venue.
  - `_uplinkOk` (`plugins/broadcast/index.js`) decides whether the picture reaches master control. This is the same path the St. Garneau cooking shoot uses.

### Ground cameras

- **The cameras:** two `media_cameras` rows per ground, with `broadcast_camera` furniture, all streaming on ch 5.
  - The Hughson: `zone_hughson_stands` and `zone_hughson_nine`.
  - Golden Goose Gardens: `zone_slush_stands` and `zone_slush_rinkside`.
- **Coverage:** a ground is covered when at least one powered camera is in its `camera_zones` and its OB deck is live.
- **Recording:**
  - Each covered game writes a tape to the camera's `recording_buffer`. The tape is the reference `{ broadcast_id, slot }`, not the play-by-play, because a game is a pure function of its slot. A replay rebuilds the same graph, and the database cost stays near zero.
  - `recorded` playback learns to expand that reference. This makes overnight replays on KSAB5, or a tape ejected from the deck, possible later.
- **Scoreboard TVs:** dropped; the stands have no TV.

### When the picture is lost

- **What breaks it:** a power cut at the ground, a smashed camera or an OB deck switched off.
- **What carries on:** the game still happens. The standings, betting, lights and `sports.game` all run off the clock, not the picture.
- **What viewers see:** KSAB5 shows "We've lost the picture from Golden Goose Gardens" over the studio's score line, and the ch 7 relay shows the same card.
- **Fixing it:** players can repair it, or cause it, with the existing verbs (`uplink on|off`, repair, power).

### Docs and checks

- **Docs:** `docs/systems-broadcast.md` gets `ob_deck`, `venue.ob_zone_id`, `venue.camera_zones` and the sports tape. `docs/flags-keys.md` gets `ob_deck`.
- **Regress checks:**
  - A covered game is live on KSAB5.
  - Switching off an OB deck, or cutting a ground's power, gives the lost-picture card while the standings still count.
  - A tape replays the same play-by-play.
  - The relay shows the card.
  - Cutting one ground doesn't touch the other.

## Build plan

This is ordered so that each phase ships on its own and leaves the game working. Phases 3 and 4 are content only and can run at the same time as each other. The function names are from `plugins/broadcast/index.js` and `plugins/sportsleague/index.js` as of 2026-10-22.

### Phase 1: the slate and the month season (engine, no channel change yet)

1. **`sportsSlateForDay(day)`**, pure and memoised per day (an 8-entry LRU).
   - Sport for slot `s` of day `d`: `(s + d) % 2 === 0` gives Deadball, otherwise Cluster Puck.
   - A sport's four slots in time order are `k = 0..3`, and `k = 3` is 18:00.
   - Round: `roundRobinRounds(8)[d % 7]` over the club order. The order is shuffled once per **month**, not per day, so a full round robin plays inside a month.
   - 18:00 pick (the ch 7 rotation): fold the month's earlier days of this sport, counting each club's 18:00 games. The pairing with the lowest summed count goes to `k = 3`, ties broken by `sportsHash(d)`. The other three are seeded into `k = 0..2`.
   - Cost: at most 30 days × 4 pairings, memoised, so one cheap fold per day.
2. **`sportsMatchupForSlot(slot, teams)`** becomes a lookup. It returns null when the slot belongs to the other sport.
   - `sportsGameForSlot` already passes null through.
   - Check every caller handles null: `computeStandings`, `getSlotResult`, the heartbeat, `_sportsScheduleSlots` and `ledgerAt`.
3. **Cutover:** bump each league's `era` in `LEAGUES` (`deadball-8` to `deadball-8-slate`, same for the CPhL). `closeForEra` already closes the running season with no champion and opens a fresh one on the deploy. Don't mix old and new matchups in one window.
4. **Month seasons in `sportsleague`:**
   - `start_slot` = the first slot of the in-game month.
   - Cup day = the last day of the month, from the `env.date` calendar, with the month length taken from `Date.UTC`.
   - `seedFinal` runs at the first season tick of Cup day. `ws_slot` = that sport's 18:00 or 21:00 slot that day, from the parity rule. It no longer calls `broadcast.nextSportsAirSlot`.
   - On Cup day, `sportsSlateForDay` returns only the two finals. The other six slots are empty.
   - `SPORTS_SEASON_DAYS` and the `maxWindow` clamp derive from the month (31 × 8 slots at most).
   - The `SPORTS_MIN_WS_GAMES` guard stays.
5. **`_sportsGraphCache`** becomes a `Map` holding at most 4 entries, evicting the oldest. The key is unchanged.
6. **Remove the Deadball fallbacks** in `sportOf` and `leagueOf`. An unknown sport logs a warning and returns null.

Gate: a pure slate test over 62 simulated days covering two month boundaries:
- 8 games a day, 4 per sport, and no club twice in a day.
- Sports alternate slots and swap on each day.
- Over a month, each club's 18:00 count is within 2 of every other club in its league. Greedy picking is close but not proven exact, so check the measured spread and tighten the gate if it's always 1.
- Cup day holds exactly the two finals.

### Phase 2: KSAB5, the relay and the slate block

1. **Schema** (`SCHEMA_SQL`): `ALTER TABLE media_channel_playlist ADD COLUMN IF NOT EXISTS source_channel_id TEXT`. Add it to the content export columns.
2. **Slot type `sports_slate`:**
   - A KSAB5 row lists its broadcasts in `conditions.broadcasts: ["bc_1783289744953", "bc_cluster_puck"]`.
   - At resolve time it airs whichever of them has a game in the current slot, using the Phase 1 lookup.
   - It's one row for all day, every day.
   - `loadChannelRuntimes` loads each listed broadcast's `sports_pools` the way a sports row does now.
3. **Slot type `relay`:**
   - In `broadcastTick`, non-relay channels run first. A relay channel then copies its source's current state: the item, the message and the graph position.
   - It never walks a graph of its own, so it can't drift from the source. Sports would match anyway, because both channels seek by clock, but a scripted show wouldn't.
   - The channel bug is added from the source channel's name.
   - Resolution is one hop only. Lint rejects a relay whose source is a relay or itself.
4. **`sportsChannels()`** returns one entry per *game* airing, resolved through slate and relay rows. Each entry carries the channels showing it.
   - The heartbeat dedupes on `gameId` in a single `Set`, cleared each slot. `sports.game` fires once per game, so sportsbet and sportsleague see each game once.
5. **Lights and roof:** a venue is lit while its sport has a game in the current slot, read from the slate, not from channels. Turning a channel off no longer darkens a ground where a game is being played.
6. **Content:**
   - `content/media_channels/ch_5_cinqo.json`: number 5, "KSAB5 The Cinqo", `studio_zone_id` (set in Phase 4, null until then; a null studio means wired, as now).
   - KSAB5's playlist row.
   - Ch 7's relay row at 18:00, every day.
   - A Cup-day relay row at 21:00, so ch 7 shows both finals. It needs a playlist condition `{"calendar": "month_end"}`. Add that as a generic condition kind wherever row conditions are tested.
   - Delete `ksab-16-1800-95` and `ksab-16b-1800-10`. Run `content:import` **before** committing the deletion (guard-deletions).
   - Remove `airSlots`/`@airtime` from both `.bsm` files and recompile. Airing is now the playlist's job.
7. **`nextSportsAirSlot`:** delete it once Phase 1's `seedFinal` stops calling it. The TV guide's "next game" (`getNextOnAir`) reads the slate.

Gate:
- The relay copies the source's item and position.
- An off-air source shows the off-air card.
- A chain or a self-loop fails lint.
- A game shown on ch 5 and ch 7 emits `sports.game` once.
- A `month_end` row airs only on the last day of the month.

### Phase 3: Golden Goose Gardens (content, beside Phase 4)

- Rename every player-visible "Slush Fund" to "Golden Goose Gardens": the 17 files `grep -ril "slush fund" content` finds (district zones, power zones, `map_int_slush`, `bc_cluster_puck`) plus `data/scripts/hockey.bsm`.
- Ids stay `slush`. Update `docs/proposals/slush-fund.md` and the CLAUDE.md line that names it.
- (Dropped: the scoreboard TVs were removed.)
- The map icon and the GLASS sign, if either carries the old name. Check `client/game/js/panels/glass/` for "slush" strings.

### Phase 4: studio, OB decks and cameras (content + one engine seam)

1. **Rooms:** `zone_ksab5_studio` and `zone_ksab5_control` on `map_int_ksab`, off `zone_ksab_lobby`.
   - Write them through `scripts/content/media-lot.mjs` so the generator stays the one author.
   - Wire power, fixture and lights in the same build.
   - The interior exit uses the lobby's direction, never `out`.
2. **Furniture:**
   - `furn_deck_ksab5`, the wired channel deck (copy the KSAB-TV production deck's flags).
   - `furn_ksab5_monitors`, the feed monitors.
   - The anchor desk and two studio cameras.
   - `furn_ob_deck_hughson` and `furn_ob_deck_slush` with `flags.ob_deck` and `uplink_channel: "ch_5_cinqo"`.
   - Two `media_cameras` rows and `broadcast_camera` furniture per ground.
3. **Engine seam:** `_portableDeckLive(zoneId)` becomes `_feedDeckLive(zoneId, channelId)`. It's true for a deck flagged `portable_mediadeck` **or** `ob_deck`, bound to that channel, switched on, in a zone not `offline`. The St. Garneau cooking shoot keeps working. Pass its channel through.
4. **Coverage:** `venue.site` gains `ob_zone_id` and `camera_zones` in each `.bsm` venue block.
   - `groundCovered(script)` = `_feedDeckLive(ob_zone_id, ch)` and at least one camera in `camera_zones` that isn't broken and is powered (`_camerasIn`).
   - It's sync and query-free, and checked per broadcast tick only for channels with viewers.
5. **Lost picture:** when the ground isn't covered, the sports walker shows a card instead of advancing the narration, but keeps the score bug. The game result is unaffected. The card line is authored in each `.bsm` (`::lines lost_picture`), with the ground's name from the venue.
6. **Tapes:**
   - Each covered game appends `{ broadcast_id, slot }` to an in-RAM ring of the last 8 per camera. The database isn't touched.
   - `eject` on `furn_deck_ksab5` makes a tape item whose `custom_data` is that reference. That's the only write.
   - `recorded` playback of a reference calls `getSportsGraph(script, slot)` and plays it from the start. Phase 4 builds the playback; overnight replays on KSAB5 are a later playlist row.
7. **Monitors:** `look monitors` lists each ground as live, dark (with the cause: no power, deck off, no camera) or no game.
8. **Staff:** one producer NPC with a unique name and a `npc_residences` file. The studio is decorative for games; no `npc_staff` is required.

Gate:
- Covered gives live.
- OB deck off gives the card, and the standings are unchanged.
- Power off at one ground leaves the other ground live.
- The relay carries the card.
- A tape plays the same first line as the live game.
- The St. Garneau portable still uplinks.

### Phase 5: following a club

- `plugins/sportsleague`: `follow <club>`, `unfollow <club>` and `fixtures`.
  - Club names are resolved through SIFT against both leagues' rosters.
  - The flag is `player_flags` key `fav_club_<sport>`. Check how player flags are read at runtime before choosing the read path. The pre-game sweep must not query per player.
- **Pre-game line:** the 1-minute season tick, gated on `hasActivePlayers()`. When the next slot starts within 10 in-game minutes, it tells each online follower of either club once, keyed by the slot.
- **Tablet:** a Fixtures tab in `plugins/tablet/tv-app.js` reading a new `broadcast.getSlate` action.
- **Docs:** add the verbs to `docs/plugins.md` (docs:verbs), and add `regress.js` checks.
- **Optional:** NPC `favTeam` (gossip) could feed the line "Frank's off to watch the Crows tonight". This is a later change.

## Risks and things to check while building

- **Every caller of `sportsMatchupForSlot` must handle null.** A sport now has no game in half the slots. The injury ledger (`ledgerAt`) walks slots, so it needs to skip the other sport's slots, not end there.
- **The sportsbet window.** It opens wagers when a game airs. Every game now airs, so check its per-player wager cap still makes sense at 8 games a day.
- **NPC banter** (`plugins/sports-banter`) may quote "tonight's game" for the single 18:00 game. Point it at the ch 7 game, the 18:00 slot.
- **timeScale.** The slate is in in-game slots, so a clock change doesn't break it. The existing comment about a timeScale change resetting the season still applies.
- **Content deletion order.** For the two old ch 7 rows, import first, then commit (guard-deletions).
- **Neon cost.** No new queries on a hot path. The only new writes are `follow`, `unfollow`, tape ejects and the season rows that already exist.
