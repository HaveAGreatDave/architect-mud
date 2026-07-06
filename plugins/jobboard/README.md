# jobboard

## Purpose

A **rotating job board** — the "legal" early-money path for players without the
street smarts or the Cool to earn any other way. It is a thin **discovery + rotation**
layer over the existing `quests` plugin: it doesn't own any quest logic, it just
posts a rotating subset of a pool of repeatable quests in a zone and lets players
pick them up and hand them in at the board.

Individual jobs are ordinary rows in the `quests` table, authored in the quest
editor. Which jobs a given board offers — and how many rotate at once, and how often
the selection re-rolls — is per-board config set in the **Job Boards** dev panel.

The first board lives in the **Franchise Strip** (`zone_city_west`), a safe hub one
step off the spawn. Its jobs are deliberately menial and low-pay: meter readings,
parcel runs, standing in someone else's ration line. Work you take because you have
to.

## Verbs

- `gigs` (aliases `postings`, `jobboard`) — read the board in your current zone.
- `gigs take <n>` (`accept`/`apply`) — take posting _n_ (dispatches `START_QUEST`).
- `gigs claim <n>` (`handin`/`collect`/`deliver`/`done`) — hand a finished job back
  for payment (dispatches `TURN_IN`).

> Note: the verbs are `gigs`/`postings`/`jobboard`, **not** `jobs`/`board`/`take`/
> `claim` — those are already owned by flight, gametable, posters, and corps.

## Rotation

A board row is pure config (`quest_pool`, `rotation_size`, `rotation_period`). The
live selection is a snapshot cached in a `world_flag` (`jobboard_rot_<id>`), re-rolled
lazily on read once `rotation_period` seconds have elapsed. No boot-time tick — boot
stays deliberate. Editing a board in the dev panel clears its snapshot so changes show
on the next read.

## Data

- **Owns** `job_boards` (config; classified in `CONTENT_TABLES` — authored content).
- **Reads** `quests` / writes `player_quests` only through the quests plugin's Actions.
- Rotation snapshot lives in `world_flags` (runtime, excluded from the seed).

## Routes

`GET/POST/PUT/DELETE /job-boards` (dev-gated) — backs the dev-panel Job Boards tab.

## Depends on

`quests` (for `START_QUEST` / `TURN_IN`).
