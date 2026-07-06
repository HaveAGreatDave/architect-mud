# Mining (as built)

Mining is a **perpetual, posture-based deposit-working action** — the rock-face
cousin of [scavenging](systems-scavenging.md). You start it once with `mine`, and
it keeps swinging at the deposit on a timer until it strikes ore (which ends the
action), the deposit plays out, nothing is reachable, or it is interrupted. It is a
[split system](plugins.md#when-a-system-spans-engine-and-plugin) like posture — the
[mining plugin](../plugins/mining/index.js) owns the state and the loop; the engine
only contributes a look-description line and clears the posture on the usual
interruptions.

Primary file: [plugins/mining/index.js](../plugins/mining/index.js). Skill
plumbing: [skills.js](../server/engine/skills.js) (`mining` skill + the 2d8−2d8
check). It reuses the scavenging schema — see
[systems-scavenging.md](systems-scavenging.md) for the table/stock/replenish model.

## Relationship to scavenging & fishing

Mining is the third member of the posture-tick gathering family. All three share:

- `posture === "<activity>"` as the **authoritative** activity flag, inheriting
  every engine force-stand interruption (move, attack, be attacked, sit, die) for
  free — no new interruption code.
- A runtime-only companion (`mineState` / `scavengeState` / `fishState`) for the
  bookkeeping the posture string can't hold. **Rule: `player.posture` is the source
  of truth**; the tick discards stale companion state when posture no longer reads
  the activity.
- The `scavenging_tables` / `scavenging_table_items` / `scavenging_zone_stock` /
  `scavenging_zone_state` schema (per-zone stock + lazy weighted replenish).
- A 1s plugin tick that runs one attempt per player every `ATTEMPT_MS`.

What sets mining apart:

| | Scavenging | Fishing | **Mining** |
|---|---|---|---|
| Verb | `scavenge` | `fish` | `mine` |
| Skill (stats) | Scavenging (Brains+Reflexes) | Fishing (Reflexes+Cool) | **Mining (Brawn+Brains)** |
| Zone flag | `scavenging_table_id` | `fishing_table_id` | **`mining_table_id`** |
| Tool gate | none | rod (`fishing_rod`) | **pick (`mining_tool`)** |
| Cadence | 3.5 s | 4.2 s | **3.8 s** |
| Minigame | no | yes (reel overlay) | no |

The separate zone flag is deliberate — a single zone can run more than one
gathering system without them fighting over one flag. (If two systems in the same
zone share a catch item id, they share that item's per-zone stock row — harmless,
by design, same as the fishing note.)

## The tool gate

`mine` refuses unless the player carries an **uncontained** item tagged
`mining_tool` (a pick/drill/breaker) — the same carry-gate pattern as the fishing
rod and the ATM hacking deck (`jsonb_exists(i.tags,'mining_tool')`,
`container_id IS NULL`). The gate is re-checked on every swing, so dropping or
stashing the pick mid-work stops the action. Pair the tool with the `unique` tag so
each one keeps its own condition (condition loss / tool-breaking is a slice-2
concern — not built yet).

## The check

`effective = effectiveSkill(player, 'mining')` = `floor(ip/100)` + avg of the
governing stats (`brawn`, `brains`). A strike succeeds when
`(effective − difficulty) + (2d8 − 2d8) ≥ 0`. The swing spans −14..+14, so an ore
entry is **reachable** iff `effective + 14 ≥ difficulty`. Reachability is evaluated
up front (like scavenging), so a hopeless deposit stops you immediately instead of
grinding failures. Every swing trains Mining via `awardSkillUse(margin)` — a
near-miss teaches as much as a strike.

## The look line

The only engine touch is one line in `describePlayerAppearance`
([commands/world.js](../server/engine/commands/world.js)): while
`posture === "mining"`, look/examine appends "*…is chipping at the rock face,
mining the deposit.*" This mirrors the scavenging/fishing lines exactly — it is a
hardcoded engine line, not a plugin hook (there is no hook seam there).

## Command

`mine` (bare verb). Refuses if already mining, in combat, not standing, if the zone
has no `mining_table_id`, or if not carrying a `mining_tool`. There is no stop verb
— `stand`, the unified `stop`, or moving ends it.

## Authoring

Mining tables are the same `scavenging_tables` rows the Scavenging dev panel edits;
a dedicated Mining authoring tab is a **slice-2** item. For now,
[scripts/seed-mining.js](../scripts/seed-mining.js) (idempotent) seeds the pick +
ore items + a `mine_gravel_pit` table and attaches `flags.mining_table_id` to
`zone_waste_gravel`. Reload the world (or restart) after running so the zone flag
loads.

## Not yet built (slice 2)

- **Depletion scars** — an over-worked deposit's effective replenish interval
  lengthens, nudging players to rotate deposits. A small tweak to the lazy-replenish
  math; the scar factor must live in a column mining owns (never squatted into
  scavenging's `messages` blob — the fishing-monsters mistake).
- **Tool condition / breaking** — swings shed pick condition; a worn-out pick
  retires (the rod-snap pattern).
- **Dev-panel Mining tab** — first-class authoring instead of the seed script.
- **World placement** — richer ore in the dangerous deep tiles (The Under / Redline)
  to give those zones a reason to exist.
