# Findings: network round trips and bytes (2026-10-19)

**Status: fix pass done; the open items below are written up, not fixed.** Line numbers are as of commit `349bc8065`.

Three read-only passes, run against the [db-burden audit](db-burden-audit.md) and the [read tiers](../architecture.md#read-tiers-where-data-lives-at-runtime): scheduled work, per-command paths, and the client↔server wire. Prod is Neon (5 GB/month transfer, scale-to-zero) on Render's free tier.

## The short version

- **An empty world costs nothing.** No scheduled job reads the DB with nobody online, and nothing keeps Render or Neon awake. Every remaining cost is per online player, and mostly per activity.
- **The biggest cost was the room re-look.** Each landed hit, and each time anyone walked through a room, made every client in it send a silent `look`. Each look was three queries and about 48 KB, a third of it minimap.
- **Gathering and recorded TV re-read authored rows every few seconds**, and several per-player writes skipped the batch flushes that already exist.

## Measured

A throwaway profiler (the recipe in [architecture.md](../architecture.md#measuring-runtime-cost-before-optimising-anything)), HEAD against the fix, same tile:

| Path | Before | After |
|---|---|---|
| `look` | 3.2 queries, 47.5 KB reply | 1 query; a repeat look leaves out the unchanged minimap |
| `move` | 3 queries in `describeZone` | 1 |
| fish/mine/scavenge attempt (every 3.5-4.2 s) | 4-6 queries | 1, 2 when stock tops up |
| login (counted from the code, not profiled) | about 10 serial round trips | about 6 |
| dev weather map (every 12 s while open) | SELECT of 16,509 zone rows | 0 queries |
| idle world, 1/5/20 synthetic players | 10/12/34 queries a minute | unchanged; synthetic players do nothing, so the gains above are per activity |

## What changed

| Area | Change | Where |
|---|---|---|
| Room re-look | One shared re-look timer, at most one per second, for combat and room events | `client/game/js/dispatch.js` (`requestRelook`) |
| | `describeZone`'s three reads are one statement | `server/engine/commands/describe.js` |
| | A look whose minimap matches the last one sent to that socket leaves it off | `server/index.js` (`lastMinimapSent`) |
| | Look replies carry `visibility`, so the client stops fetching it after every look | `movement.js` cmdLook, the login look |
| Reply frames | `sleep_state` goes out only when the sleep bar would change; a silent `noop` gets no frame | `server/index.js` (`sleepUiShown`) |
| Vehicles | Truck cab: the 61×61 map, far roads and truck params ride only on an 8-tile move, a lock-lamp change, an event push, or every 15 s | `plugins/trucking/state.js` pushCab |
| | Aircraft: the 73×73 map, far roads and skyline, the same rule per occupant; a fresh cockpit always gets them | `plugins/flight/state.js` pushContext |
| | Airborne checkpoint every 60 s, not 12 s | `plugins/flight/index.js` |
| | Text cockpit panel skips an unchanged repeat (10 s resend) | `plugins/flight/textpilot.js` |
| DB ticks | Scavenging tables cached (10 min, the dev routes invalidate); zone clock and stock in one query | `server/engine/zone-stock.js` |
| | Rod, bait and pick checked once and on `inventory.changed`, not per attempt | fishing, mining |
| | Recorded TV caches each camera's buffer; `CAMERA_RECORD` and the dev routes drop it | `plugins/broadcast/index.js` (`recordingBuffer`) |
| | Pinch walkers keep their position in RAM; one UPDATE per tick for all of them | `plugins/pinch/index.js` |
| | Swimming: one carried-item read per water step (was two); stamina rides `_resDirty`; rinse is one UPDATE | `plugins/swimming/index.js` |
| | MIS meter rides the minute batch and the logout write, not an UPDATE every 8 s | `plugins/mis` |
| | Wear, relations, mutations and augments flush every player in one statement each (augments was one serial UPDATE per augment) | durability, relations, mutations, augments |
| Login and moves | Independent login reads and writes go out together; MOTD cached in `motd.js` | `server/index.js` finishAuth, `motd.js` |
| | A building crossing's position write no longer blocks the move reply | `movement.js` |
| | Active quest rows cached per player; any `player_quests` write by the plugin drops them | `plugins/quests/index.js` (`activeQuestRows`) |
| | Equipped-weapon cache 5 s → 30 s (the wear flush drops it); skill cache 30 s → 5 min | `inventory.js`, `ip.js` |
| HTTP | API JSON over 1 KB is brotli/gzip compressed, off the loop | `server/index.js` |
| | `online_change` carries the roster; the players panel polls every 60 s (was 12), not while hidden | routes.js `publicOnlineRoster`, `players.js`, `whisper.js` |
| | Dev panel: the crime log and weather map polls skip a hidden tab; the weather map reads `world.zones` | `client/devpanel`, `environment.js` |

The crash-loss trades were agreed before the pass: airborne aircraft up to 60 s, swim stamina up to 1 s, the MIS meter up to a minute.

## Looked at and left alone

- **The flashlight perceive query** (`plugins/flashlight/index.js:192`). It's the only way a lit torch moved without an event gets noticed, and it is cached 30 s and dropped on `inventory.changed`.
- **The per-minute visibility fetch** (`client/game/js/panels/environment.js`). One small request a minute, answered from RAM.
- **The per-swing "X attacks Y" refresh.** Bystanders' room pane shows the enemy's HP; the one-per-second re-look cap covers the cost.
- **Boat and podracer sync at 4 Hz when stopped.** The server pushes contacts and street people on each sync, and other players see the boat through it. The empty reply frames are gone, so what's left is about 100 bytes up per sync.
- **Mastery's flush.** Already parallel, and only for Long Watch players mid-fight.
- **The 1 s combat resource flush**, by design (1 s crash bound), and the 10 s client ping.

## Open

| Finding | Where | Note |
|---|---|---|
| The weapon label pulls the whole inventory after every inventory change | `client/game/js/panels/inventory-state.js:53`, `server/engine/commands/inventory.js:400` | Put the weapon name on `inventory_dirty`. Left while another session had that file open. |
| Encumbrance gate re-queries after 5 s | `server/engine/commands/inventory.js:386` | Trust the cached weight longer when well under capacity. |
| Leaving a shop runs the unpaid-items query twice | `plugins/commerce/index.js:517,577`, `plugins/storefront/index.js:1280,1305` | The gate can hand its answer to the subscriber. |
| Followers move one at a time | `movement.js` dragFollowers | |
| `stats` is up to 5 serial round trips | `server/engine/commands/world.js:112` | |
| Queries in loops on rare paths | crafting, wardrobe, synthesis, flight contracts, consort billing, rent, mortgage, ventures, `aa-sites` | `id = ANY($1)` each. Several overlap [findings-2026-10-efficiency.md](findings-2026-10-efficiency.md). |
| AA site read while flying wanted | `plugins/flight/combat.js:667` | The aa-sites plugin already holds the roster. |
| Police camera zones, 5 s TTL against a 5 s scan | `plugins/surveillance/index.js:1357` | |
| Three page-load requests | `client/game/js/main.js:216,233,515` | Could ride the `connected` message. |
| Sleeping bodies and ground items on every room render | `describe.js` | Now one statement; a RAM cache needs a write funnel first (8 and many writers). |

## Bugs found on the way

| Finding | Where | Status |
|---|---|---|
| A pinched sleeper who logged back in kept being walked home, and the walker wrote their row under the live player | `plugins/pinch/index.js` | fixed in this pass |
| The augments `zone.entered` subscriber reads `{ player, zoneId }`, but the event sends `{ actor, zone }`, so the campus top-up never runs | `plugins/augments/index.js:141` | fixed 2026-10-20: reads `{ actor, zone }`; regress emits the event into a campus zone |
| Corps territory and venture ticks are `24h` cadences phased from boot, so payouts follow uptime, and a firing on an empty world skips the day | `plugins/corps/index.js:1271,1298` | fixed 2026-10-20: `settleCorpDay` settles once per game date from an idle-gated 1m check on a world flag |
