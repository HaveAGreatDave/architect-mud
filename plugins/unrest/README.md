# unrest

**Purpose** — the ledger behind the conflict between the orders. Architect has five
orders with a full ideology substrate and nothing that makes the tension between them
observable: the ten authored `org_relations` hostile edges are read by exactly one
thing, the CODEX tablet reader, and no NPC behaviour reacts to any of it. This plugin
is the state that makes the tension consequential rather than decorative.

Design: [docs/proposals/unrest.md](../../docs/proposals/unrest.md).

## Status

**Phase 1a — the ledger, and nothing else.** Deliberately no player-facing surface:
no verbs, no hooks, no gossip, no graffiti, no incidents, no spawns. At this step a
player notices nothing at all; the dev panel shows numbers moving.

Later steps, not built: 1b perceivability (the first thing a player can notice),
1c incidents, 1d danger, 2 favours, 3 the Null and the Wildblood.

## The three rules worth knowing before you touch it

**No player-facing readout, ever.** No verb, no tablet gauge, no number. The moment
there is a readout the sim becomes a dashboard to optimise and the flavour dies. The
dev panel is the exact opposite and gets the complete numeric picture, because an
operator who cannot see the ledger cannot tune it. The line is the client boundary,
not the data: every scalar is visible at `/dev` and none of it crosses into
`client/game/`.

**The cell is derived, never authored.** A 12×12 block of grid coordinates
(`blocks.js`), about ten of them over the built city. The first draft used
`flags.district` and that made the whole system wait on content that does not exist —
twelve of the twenty authored districts hold zero tiles. Nothing downstream knows what
a cell *is*, so if [district-repair](../../docs/proposals/district-repair.md) ever
ships, this file swaps its key function for `districtFor` and no scalar, incident or
regress case changes.

**Three scalars, not two.** `grip` (hours), `heat` (tens of minutes), and `pressure`,
a slow integrator of grip over days that raises heat's *baseline* rather than heat.
⚠ Pressure is not optional: without it the fast pair converges, because decay pulls
both toward baseline and incidents gate on high heat — so a quiet cell could never
generate what would make it loud, and dead cells would stay dead for ever.

## Traps

- ⚠ **grid 0,0 is an unset column, never a tile.** Interiors carry it, so they resolve
  their cell by following `world_exit_zone` out to their facade. A coordinate read that
  trusts 0,0 puts every interior in the game into one corner of the map.
- ⚠ **Insurgency is "writes heat AND reads grip"**, not merely "writes heat". The
  Wildblood also write heat and are deliberately outside the cycle — they fire off an
  external clock in a burst and leave no baseline behind, which is a driver *into* the
  ledger rather than a participant in it.
- ⚠ **The region is not the city.** `region_coldwater` is 4,838 tiles of which 2,865
  are redrock waste. The index gates on the urban filter, not on `region_id`, or the
  sim spends its heat on empty ground.
- **Decay is monotone toward baseline and never crosses it.** An exponential approach
  can only close the gap. An overshoot would read as the sim spontaneously producing
  tension in a quiet city, so regress asserts it.

## REST

- `/unrest/state` (GET) — cells, bands and the role roster.
- `/unrest/force` (POST) — set a cell's scalars for testing.
- `/unrest/step` (POST) — run one forcing tick now.
- `/unrest/reindex` (POST) — drop the memoised block index after a world reload.

All dev-gated, all `directAPI` (live world, never staged).

## Commands

None. That is the point of this phase.

## Hooks

None.

## Tick usage

`30m` — the forcing tick, idle-gated by the scheduler's default.
`5m` — write-behind flush, a no-op unless something changed.

## Data schema

No table. The ledger is one versioned `world_flags` blob, `unrest_ledger`, and this
plugin is its only writer. ~10 cells × 4 numbers does not justify a schema change, a
registry entry, a boot load and a read-tier decision.
