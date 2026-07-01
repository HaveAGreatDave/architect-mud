# Scavenging (as built)

Scavenging is a **perpetual, posture-based search action**: you start it once, and
it keeps rummaging the room on a timer until it succeeds out, empties out, or is
interrupted. It is a [split system](plugins.md#when-a-system-spans-engine-and-plugin)
like posture — the [scavenging plugin](../plugins/scavenging/index.js) owns the
state and the loop; the engine only contributes a look-description line and clears
the posture on the usual interruptions.

Primary file: [plugins/scavenging/index.js](../plugins/scavenging/index.js). Skill
plumbing: [skills.js](../server/engine/skills.js) (`scavenging` skill + the
2d8−2d8 check). Schema: [schema.js](../server/models/schema.js).

## Posture integration — the load-bearing decision

`posture === "scavenging"` is the **authoritative** activity flag. Because posture
is the mutually-exclusive stance/activity slot, making scavenging a posture value
means every existing engine "force-stand" trigger ends it *for free*, with no new
interruption code:

| Trigger | Where | Effect on scavenging |
|---|---|---|
| Move to another zone | `commands/movement.js` `cmdMove` | posture → standing ⇒ scavenging ends |
| Initiate an attack | `commands/combat.js` `cmdAttack` | posture → standing ⇒ can't attack *and* scavenge |
| Be attacked (PvE/PvP) | `gameLoop.js` | posture → standing ⇒ scavenging ends |
| Sit / lie / kneel / stand | `interactions` plugin | posture overwritten ⇒ scavenging ends |
| Death / respawn | `gameLoop.js` | posture reset ⇒ scavenging ends |

The posture string can't hold *which* zone's table you're working or your failure
count, so a runtime-only companion rides alongside:

```
player.scavengeState = { zoneId, streak, lastAttempt }   // never persisted
```

**Rule: `player.posture` is the source of truth.** The plugin tick treats
`posture !== "scavenging"` as "stopped" and discards stale `scavengeState`. The
engine clears posture; the plugin never has to chase down interruption sites. This
is the same contract that keeps posture/sitting honest — see
[systems-posture.md](systems-posture.md). (Note the one asymmetry: combat lives in
`player.combatTargetId`, *outside* the posture enum. Scavenging yields to combat
because posture already does; folding combat into posture is flagged as future
work.)

The only engine edit scavenging requires is one line in `describePlayerAppearance`
([commands/world.js](../server/engine/commands/world.js)): while
`posture === "scavenging"`, look/examine appends "*…is rummaging around, scavenging
the area.*"

## Data model

Content lives in Postgres. A **table is a reusable template**; a zone opts in via
`zones.flags.scavenging_table_id`. Depletion and replenish are tracked **per zone**,
so one template can be shared across many rooms without them sharing a stock pool.

| Table | Grain | Key columns |
|---|---|---|
| `scavenging_tables` | template | `id`, `name`, `replenish_interval_seconds`, `messages JSONB` |
| `scavenging_table_items` | template entry | `table_id`, `item_id`, `difficulty`, `weight`, `max_qty` |
| `scavenging_zone_stock` | per-zone live | PK `(zone_id, item_id)`, `current_qty` |
| `scavenging_zone_state` | per-zone clock | PK `zone_id`, `table_id`, `last_replenish` (epoch s) |

- **`difficulty`** is the opposing value in the 2d8−2d8 check (like a dodge rating).
- **`weight`** biases *both* the per-attempt item draw and the replenish draw.
- **`max_qty`** caps how much of an item a zone can hold.
- **`messages`** is a nullable override `{ "player": [...], "broadcast": [...] }`;
  empty/absent keys fall back to the plugin's built-in default pools
  (`DEFAULT_PLAYER_FLAVOR`, `DEFAULT_BROADCAST`). Feedback lines (below) are
  code-only and not overridable.

Per-zone stock/state rows are created lazily the first time a zone is scavenged
(stock initialised to each entry's `max_qty`, clock anchored to now).

## The check

Reuses `skillCheck`-style math inline (one query saved): `effective =
effectiveSkill(player, 'scavenging')` = `floor(ip/100)` + avg of governing stats
(`brains`, `reflexes`). A find succeeds when
`(effective − difficulty) + (2d8 − 2d8) ≥ 0`. The swing spans −14..+14, so an item
is **reachable** iff `effective + 14 ≥ difficulty`.

## The perpetual loop

A plugin-owned `setInterval(scavengeTick, 1000)` (same pattern as `atm`/`broadcast`)
scans live players. For anyone with `posture === "scavenging"`, an **attempt** runs
once per `ATTEMPT_MS` (3500 ms, a sibling to the attack cadence). Each attempt:

**Pre-roll**
1. Zone lost its table → stop silently.
2. Total stock `= 0` → "*nothing left here to find*" + stop.
3. Stock exists but **nothing reachable** → "*something's here — but you've got no
   shot of finding it*" + stop. (Evaluated up front, so the player never grinds
   failures to learn they never had a chance.)

**Roll** — pick one item weighted among those with `current_qty > 0` (an
out-of-reach pick can be drawn and auto-fails; variance is intentional), then roll.

**Success** — decrement that item's per-zone stock, insert one unit straight into
inventory, award 1 IP via `awardSkillUse`, and show a random flavor line + "*You
turn up <item> and pocket it.*" (the item name is a clickable `examine` link). **A
successful find always ends the action** — you stop scavenging on the first find,
so gathering a room takes a fresh `scavenge` per item. If that find took the
**last** unit, an extra "*picked the area clean*" line fires before the stop.

**Failure** — `streak++`, show a flavor line + "*You come up empty.*" At **exactly**
`streak === 3`, fire the once-only nudge "*…if you just search a little harder…*"
(distinguishing "keep trying, it's gettable" from the "no shot" stop above).

When a player has `scavengeState` but posture is no longer `"scavenging"` (an
engine force-stand fired), the tick cleans up the state and sends "*You stop
scavenging.*"

## Broadcasts

To avoid spamming onlookers, the room only hears the action **start** ("*X starts
picking through the area…*", from the pool) and **stop** ("*X stops scavenging.*").
Per-attempt flavor is shown to the acting player only. `sendToZone` gained an
optional `excludeId` so tick-driven room lines don't echo to the actor.

## Replenish (lazy catch-up)

There is no per-zone replenish timer. On every read (`loadZoneTable`), the plugin
computes `steps = floor((now − last_replenish) / interval)` and adds that many
units, one at a time, each to a weighted-random entry **below** its `max_qty`,
advancing `last_replenish` only by the number of units actually applied. So an
untouched zone burns no CPU, yet is correctly stocked when someone arrives. If every
entry is already full the clock is left frozen — which means a long-idle zone tops
straight back up the moment a scavenger depletes something.

## Command

`scavenge` (bare verb; new plugin). Refuses if already scavenging, if in combat
(`combatTargetId`/`pvpTargetId`), if not standing, or if the zone has no table.
There is no stop verb — `stand` or moving ends it. Targeted `scavenge <thing>`
(furniture-attached tables) is deliberately out of scope for now.

## Tunables

- `ATTEMPT_MS` = 3500 (per-attempt cadence)
- `HINT_STREAK` = 3 (failures before the "search harder" nudge)
- `MAX_SWING` = 14 (reachability ceiling; the 2d8−2d8 maximum)
- Tick scan cadence: 1000 ms

## Authoring (deferred)

There is **no dev-panel UI yet** — tables/items/zone-attachment are seeded by hand.
[scripts/seed-scavenging.js](../scripts/seed-scavenging.js) is the working example:
it creates six "junk" items, the "Roadside Junk" table, and attaches it to
`zone_start`. A dev-panel CRUD surface (table editor + a zone-editor dropdown, and
likely promoting `zones.flags.scavenging_table_id` to a real column for the join) is
the intended follow-up.
