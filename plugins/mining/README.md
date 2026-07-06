# mining

## Purpose

Mining is a perpetual, posture-based **deposit-working** action — the rock-face
cousin of [scavenging](../scavenging/). You start it once with `mine`; it keeps
swinging at the deposit on a timer until it strikes ore (which ends the action,
like scavenging), the deposit plays out, nothing is reachable, or an engine
force-stand interrupts it (moving, attacking, being attacked, sitting, dying).

It is a [split system](../../docs/plugins.md#when-a-system-spans-engine-and-plugin)
like posture: `posture === "mining"` is the authoritative activity flag, so every
existing engine interruption ends it for free. The plugin owns the loop and a
runtime-only companion `player.mineState = { zoneId, streak, lastAttempt }`. The
only engine touch is one look-description line in `describePlayerAppearance`
(`server/engine/commands/world.js`), mirroring scavenging/fishing.

Mining reuses the `scavenging_tables` / `scavenging_table_items` /
`scavenging_zone_stock` / `scavenging_zone_state` schema verbatim (per-zone stock +
lazy replenish). A **separate** zone flag `flags.mining_table_id` keeps it from
colliding with scavenging/fishing on the same zone. The one thing it adds over
scavenging is a **tool gate**: a carried, uncontained item tagged `mining_tool`
(the fishing-rod carry-gate pattern) — no pick, no mining.

See [docs/systems-mining.md](../../docs/systems-mining.md) for the full contract.

## Commands

- `mine` — start working the deposit in the current zone. Refuses if already
  mining, in combat, not standing, if the zone has no `mining_table_id`, or if you
  aren't carrying a `mining_tool`. No stop verb — `stand`, `stop`, or moving ends it.

## Skill

- `mining` (survival; governed by **Brawn + Brains**) — added to `SKILLS` in
  `server/engine/skills.js`. Uses the standard 2d8−2d8 machinery
  (`effectiveSkill` / `awardSkillUse`). No schema change.

## Tags

- `mining_tool` — capability tag marking an item as a pick/drill/breaker. Carrying
  one (in hand, not in a container) is the tool gate. Pair with `unique` so each
  tool keeps its own condition.

## Zone opt-in

- `zones.flags.mining_table_id` → a reusable `scavenging_tables` template.
  `scripts/seed-mining.js` seeds a pick + ore items + a table and attaches it to
  `zone_waste_gravel` (a gravel pit) as the live test spot.

## Seams

- **command** — `mine`
- **tick** — plugin-owned `setInterval(mineTick, 1000)`; a swing runs every
  `ATTEMPT_MS` (3800 ms) per mining player
- **engine one-liner** — `describePlayerAppearance` look line (not a hook)
- **event** — consumes `player.stop` to halt on the unified STOP command
