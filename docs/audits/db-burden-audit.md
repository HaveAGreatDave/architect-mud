# DB Burden Audit — Round Trips, Read Tiers, and Pool Pressure

**The seam:** runtime code ↔ the remote database. Prod Postgres is on Neon, so every `query()` in
`server/models/db.js` is a pool checkout plus a full network round trip (tens of ms). Nothing
enforces that a hot path stays off the wire: a per-move gate, a per-swing skill check, or an event
subscriber on `zone.entered` can each quietly add an awaited round trip, and a plugin heartbeat can
poll the DB forever on an empty server. **The bug class is silent because nothing errors and
nothing logs** — every individual query is a fast, correctly-indexed single-row hit. The defect
only appears as *aggregate latency*: a move command waiting on `pool.connect()` behind a
minute-boundary tick convoy, or 6+ serial round trips stacked on one keystroke.

This audit exists because the 2026-07 movement-lag investigation found exactly that: the engine's
indexes and diff-gated writes were already clean, yet a single step cost ~6 awaited queries
(encumbrance re-scanned the whole inventory every move) plus ~4–5 fire-and-forget ones (the quest
tracker re-loaded static quest definitions per step), while the broadcast plugin issued ~15
queries/min with zero players online — ~80% of idle traffic — all racing a 5-connection pool. None
of it was "a slow query." The companion doc is
[architecture.md → Read Tiers](../architecture.md#read-tiers-where-data-lives-at-runtime); this
audit is how you re-challenge the codebase against it.

## Prompt

> Audit `<SCOPE>` (one subsystem, plugin, or command path — never the whole game) for DB burden.
> All access goes through `query()` in `server/models/db.js`; treat every call as a network round
> trip holding a pool slot. For the scope, produce:
>
> 1. **Hot-path round-trip count.** Trace the scope's hottest operation end-to-end (a move, a
>    swing, a tick firing, a shop open) and list every `query()` that fires, in order, marking
>    serial vs `Promise.all` and awaited vs fire-and-forget. State the steady-state count.
> 2. **Read-tier violations.** For each recurring read, name which
>    [read tier](../architecture.md#read-tiers-where-data-lives-at-runtime) the value should live
>    in. Flag: values recomputed-unchanged per event (cache candidates), queries inside loops
>    (batch with `id = ANY($1)` / `GROUP BY`), independent serial awaits (batch with
>    `Promise.all`), multiple UPDATEs to the same row in one handler (coalesce), and `SELECT *`
>    on wide-JSONB tables where few columns are read.
> 3. **Scheduled work.** For every timer/cadence the scope registers: does it go through
>    `scheduler.js`? Does it idle-gate on `hasActivePlayers()`? What does one firing cost with an
>    empty server, and does state catch up correctly after an idle gap?
> 4. **Cache-safety check (the non-negotiable).** For anything you propose caching, grep EVERY
>    `INSERT/UPDATE/DELETE` against that table first and list the writers that would bypass the
>    cache. If writers are scattered, the finding is "needs a write funnel first," not "add a
>    cache" — a stale cache that misrenders is worse than the round trip (see the deliberately
>    uncached `furniture` and `npcs` rows).
>
> Prove hot findings by counting actual queries (instrument `query()` with a counter or log in a
> dev run) before proposing changes. Recommendations must be surgical and regress-gated
> (`npm run test:regress`).

## Checklist (quick manual pass)

- [ ] Count `query()` calls on the scope's hottest operation — is any of them recomputing a value
      that didn't change since last time?
- [ ] Any `await query(...)` inside a `for` loop? (`id = ANY($1)` or a `GROUP BY` aggregate.)
- [ ] Chains of independent awaited reads? (`Promise.all` them — see describeZone's 4-way batch.)
- [ ] More than one `UPDATE players SET … WHERE id=$1` in a single handler? (Coalesce — see
      cmdMove's `pendingWrite`.)
- [ ] `setInterval` instead of `schedule()`? Tick queries with no `hasActivePlayers()` gate?
- [ ] `SELECT *` on `items`/`npcs`/`zones`/`audio_samples` where only a few columns are used?
- [ ] Proposing a cache? Grep the table's full write surface first — every writer must either
      funnel through the cache or be covered by an event-bust/TTL whose staleness is benign.
