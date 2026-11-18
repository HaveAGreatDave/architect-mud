# sportsleague

**Purpose** — Maintains the persistent standings for the DEADBALL baseball broadcast. The broadcast plugin simulates a fresh game every airing; this plugin books each aired game's result into a league table (`sports_standings`) and lets players read it with `standings`. It is the foundation layer for a full league: later phases add month-long seasons, top-two seeding into the final off this table, a champion, and a reset.

## Commands

- `standings` — the league table (one row per team that has played), sorted by win % → wins → run diff. Shows W, L, PCT, RDIF, with a season/reigning-champion header.
- `curtaincall` — current season / Curtain Call status + the reigning champion. Hockey's is `cup`. A dev/admin can `curtaincall start` to force-seed the final immediately (testing, so you don't wait for the in-game month to roll).
- `champions` — the champions history (most recent first).

## Seasons & the Curtain Call

A season is the **in-game calendar month** (`world_clock.game_date`). Every club plays every other club twice, once at home and once away, fourteen games each, on the daily slate ([docs/proposals/daily-slate.md](../../docs/proposals/daily-slate.md)), and the month's last day is **Cup day**. At the first season tick of Cup day (if the runner-up has played at least `SPORTS_MIN_WS_GAMES`), the **top two teams** are seeded into a single-game final, Deadball's **Curtain Call**, played in the sport's last slot of the day (18:00 or 21:00). The top seed is the home side. Broadcast owns the calendar and answers `broadcast.getSeasonCalendar`. A tick that comes after Cup day still seeds the final in its own slot and crowns it from its result; a season that can't seed one by then closes with no champion. Broadcast reads the season (via `sportsleague.getSeason`) and runs *those two teams* with championship branding instead of a random matchup. When that game airs, its result crowns the champion, closes the season (kept as history), **wipes the standings**, and opens the next season. There is always a champion — the sim never ties.

**Eras.** A league in `LEAGUES` can name an `era` (the CPhL's is `cphl-8-slate` and Deadball's
`deadball-8-slate`: eight clubs each, on the daily slate since October 2026).
Every season records the era it opened in, and when the league's era
moves on, the next season tick closes the open season with no champion and opens a fresh one
(`staleEra` and `closeForEra`). That is how a new roster starts at 0-0 on the deploy that
ships it, with no one-shot against prod. Change an era only when the roster changes.

**A fresh start from the dev panel.** The plugin brings a 🏆 Leagues tab (`panel.js`, under
Sound & Media) showing each league's open season, its table and its trophy case, with a
**Start a fresh season** button per league. It posts to `POST /sportsleague/restart`
(`{ sport, wipe }`, dev or admin), which runs `restartLeague`: the open season closes with no
champion (its toll still counts toward careers) and the next opens with `start_slot` at the
next slot, so the table reads 0-0 at once rather than at the turn of the month. Cup day is still
the month's last day; a season started too late to seed a final closes uncrowned then. Started
on Cup day, it opens with next month. With `wipe`, every season of that league is deleted first,
so it's Season 1 with no champions and no careers. `ensureSeason` waits on a restart in flight,
so the season tick can't open a month-anchored season between the close and the insert.
Broadcast's season and standings caches pick the new season up within 30 seconds.
`GET /sportsleague/state` feeds the tab.

## Registered actions

- `sportsleague.getHistory` returns `{ sport, era, seasons }`: every played season, newest first (up
  to 24), each `{ seasonNo, champion, runnerUp, score, table, era }`, where `table` is where every
  club finished. The broadcast reads it on its season refresh and works each club's story out of
  it for the booth (`plugins/broadcast/sports/club-lore.js`). Cached like the finals.
- `sportsleague.getFinals` returns `{ sport, final, finals }`: every final the league has seeded,
  newest first (up to 120), each `{ seasonNo, month, teams, winner, loser, score, pending }`.
  Played finals carry the winner and score; a seeded one still to air is `pending`. Cached per
  league and dropped by `invalidateSeason`, which every writer of `sports_season` calls. The
  tablet's Cups tab reads it.

- `sportsleague.getStandings` — returns `{ rows }`, the standings sorted the canonical way (win% → wins → run diff → name). The **broadcast** plugin dispatches this to drive the on-air **standings bug** overlay and the announcer's pre-game record mentions, so it never reaches into this plugin's table directly.

## Events consumed

- `sports.game` — emitted by the **broadcast** plugin the moment a simulated baseball game starts airing, carrying the already-decided result `{ gameId, channelId, away, home, awayScore, homeScore, winner, endsAtMs }`. On receipt the game is **staged** as a `pending` row in `sports_results` (keyed by `gameId`, `ON CONFLICT DO NOTHING`); it is booked into the standings only when its airing window ends, by the 1-minute sweep. This makes booking **end-of-game, restart-safe, and idempotent**: a game that never finishes airing (mid-window restart) isn't counted, the sweep catches up rows that came due during downtime, and a re-simmed same-slot game (the broadcast keys game ids to an absolute time-window) no-ops instead of double-counting.

## Data schema

- `sports_standings` — **runtime** state (regenerated by play; excluded from exports). One row per team: `team` (PK), `wins`, `losses`, `runs_for`, `runs_against`, `updated_at`.
- `sports_season` — one row per season: `sport` and `season_no` (PK), `start_month`, `start_date`, `start_slot`, `phase`, finalists, `ws_slot`, `champion`, `runner_up`, scores, `decided_at`, `era` (the roster era it opened in), `final_table` (the clubs in the order they finished: the table that seeded the final, folded once as the season closes and never past the games that aired; seasons closed before it was kept get theirs worked out once, the latest five only, and keep it only if its top two are the season's finalists, otherwise an empty list), and `toll`: every man's `{ hurt, died }` for the season, from the sport's fold, written once as the season closes, crowned or not. A league whose fold keeps a toll (hockey) also gets `career` on its extras, the closed seasons' tolls added up; it's read once per league and cached until the next close.
- `sports_results` — staging for aired games (book-at-end): `game_id` (PK), teams, scores, `winner`, `resolve_at`, `status` (`pending`/`booked`). Idempotent PK = restart-safe, no double-count.

## Dependencies

- The **broadcast** plugin's sports sim (source of the `sports.game` event). No import coupling — the two meet only through the event.

## Extension points

- Season and final logic reads `sports_standings` for top-two seeding and resets it at season's end. It will live in this plugin.

## Per-player races

Each sport folds its own leaderboard alongside the table, out of the beats the sim
ALREADY emits — no second simulation, no stored rows, and the leaders can never
disagree with the games that aired, because they are folded from the same games.

- **DEADBALL** — batting average, home runs, RBI, stolen bases and the pitchers'
  strikeouts (`SEASON.foldExtras` in
  [sports/baseball.js](../broadcast/sports/baseball.js)). Scoring follows real rules:
  a **walk** and a **sacrifice fly** are plate appearances but **not at-bats**, while a
  double play or a productive out is. Count those two as at-bats and every average in
  the league reads low. A qualifier gate (40% of the leader's at-bats, floor 5) keeps
  the board off whoever went 2-for-2 in April; it scales with the season so an early
  table still has names on it, and falls back to the whole pool rather than showing
  nothing.
- **CLUSTER PUCK** — goals, assists, points, plus the casualty count (the one sport
  where a season costs lives).
