# drugwar

Ambient living-world reactions for the drug districts. A covert street dealer runs
each of three areas — the Core / Franchise Strip, the Marquee, and the Yards (see
`plugins/dealer` + `scripts/seed-drugwar-dealers.mjs`: **Dov Keller**, **Gita
Marsh**, **Wick Sorel**). The dealers exist independently — this plugin has no ties
to any ideology.

> **No territory, no ideology ties.** The old self-running turf tick
> (`computeTurfMove` / `drugwarTurfTick`, which pushed `zone_control` influence and
> emitted `drugwar.flip`) was **retired** — `zone_control` belongs to **player corps**
> alone. The invisible alignment ledger was **removed** — a player's ideology
> stance/path now moves only through deliberate dialogue/quest choices (the
> **ideologies** plugin), never through incidental drug buys or kills. `DRUGWAR_ZONES`
> survives only as the map of drug districts the ambient beats below are grounded in
> — no controller, no tick.

## Living-world reactions

Ambient, diegetic, never part of any tutorial — all off the event bus, hard-gated
so they read as texture, not spam:

- **Police don't save you** — a near-spawn (`zone_start` / the Core) vignette where
  no cop comes. Narrates around the real crime seam; changes no rules.
- **The machine is watching** — the Architect as infrastructure only (never a voice):
  a camera that pans to you, streetlights stuttering in a pattern, cryptic departure
  boards, and — rarely — a genuine sourceless blackout via `drainZonePower` +
  `recomputePower`. Per-player in-memory cooldowns; a server-wide cooldown on blackouts.

## Content / setup

```
node scripts/seed-drugwar-dealers.mjs   # the three covert dealers
```

Then restart the server (or `/world reload`).

## Exports (for tests / ops)

`DRUGWAR_ZONES`, `isDrugWarZone`.
