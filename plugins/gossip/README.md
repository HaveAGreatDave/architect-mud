# gossip

A global rumour pool fed by real in-game events. NPCs recall the juiciest, most
recent, most *local* thing they've "heard" when a player asks; players can plant
their own rumours (true or false); and gossip items carry optional **leads** — a
dim hint pointing at a zone or subject that's worth chasing.

## Model

**Global pool + local recall.** Events drop into one shared, in-memory pool
([pool.js](pool.js)) — ephemeral, rebuilt on restart like surveillance's
`crimeLog`. There is **no** NPC-to-NPC travel: locality is a recall-time
weighting only.

```
weight = heat × 0.5^(age / 30min) × proximity(originZone, viewerZone) × credibility
```

`proximity` is 1.0 in the origin zone and falls off by zone-graph hops to a floor
(a `global` reach — kills, blackouts — is heard anywhere). `credibility` is 1 for
real events and the planted `truth` for player rumours.

**Coalescing.** A repeated real event (a storm that keeps thundering, an ongoing
crime spree) refreshes one warm item — bumps its `ts`/`heat` — rather than piling
near-duplicate rows. The identity is `templateKey|zoneId|subject` by default;
callers pass a `coalesceKey` to widen it (weather keys by building/area so a storm
across a whole block stays one rumour). Planted rumours never coalesce — each is
its own claim. Weather gossip names the **building** (via the engine's
`getBuildingName`), not the room, and is capped at **5** concurrent items
(`GROUP_CAPS.weather` in pool.js — the weakest is evicted past the cap).

## Verbs

| Verb | Effect |
|---|---|
| `gossip` | A random talkative NPC in the room shares the hottest local rumour. |
| `gossip <npc>` / `ask <npc> about gossip` | Ask a specific NPC (SIFT-resolved). |
| `spread <text>` / `rumor <text>` | Plant a rumour. Believability rides a `deception` check; a botch still plants, but weak (repeated with a shrug). 60s cooldown via the `gossip_spread_until` player Flag. |

## Sources (event bus)

Consumes, via [events.js](../../server/engine/events.js) `on()`:
`player.death`, `enemy.killed`, `npc.killed`, `crime.witnessed`,
`police.dispatch`, `player.drugUsed`, `gossip.pokerWin`, `gossip.bigBuy`,
`gossip.housing`, `weather.thunder`. Blackout / power-restored news is derived in
the tick by diffing `getPowerMap()` — no engine emit.

The four `gossip.*` / `crime.witnessed` events are emitted by small additions at
their seams (poker cash-out, vendor buy, apartment rent, surveillance
`raiseCrime`) so gossip never re-implements witness logic or economy hooks.

## Ask-only secrets

Some gossip is too sensitive to blurt out unprompted. An item with `askOnly:true`
is excluded from the ambient tick (via a `recall` filter) and only ever surfaces
when a player asks. The **shadow dealer's passphrase** is one: rarely seeded in
the tick (`PASSPHRASE_CHANCE`), read live off the covert-dealer NPC's
`flags.passphrases` (content, not code — see [[project_shadow_dealer]]), category
`secret`, coalesced to one, with a lead pointing at the dealer's haunt.

## Tick

`setInterval` every 60s: `pool.gc()`, power-map diff → blackout/restore items,
and low-chance (`AMBIENT_CHANCE`) unprompted gossip in zones with a player
present.

## Leads

Items may carry `lead: { kind, targetId?, zoneId?, hint }`, surfaced as a dim
follow-up line when the gossip is told. v1 is flavour + a documented
`gossip.leadFollowed` future hook (no payout wired) — a `follow`/bounty verb
would consume the lead later.

## Dev panel

Read-only **💬 Gossip** inspector (Server nav section) via `routePrefix:"/gossip"`
+ `routeHandler`: `GET` returns the live pool (strength = decayed weight),
`DELETE /gossip/:id` removes one item, `DELETE /gossip` clears the pool. All
dev-role gated. Client panel: [client/devpanel/js/panels/gossip.js](../../client/devpanel/js/panels/gossip.js).

## Tunables

Top of [index.js](index.js): `TICK_MS`, `AMBIENT_CHANCE`, `SPREAD_COOLDOWN_MS`,
`DEDUP_MS`. Pool shape in [pool.js](pool.js): `CAP`, `HALF_LIFE_MS`, `MIN_KEEP`,
`PROX_FLOOR`. Emit thresholds live at each emit site (poker/vendor).
