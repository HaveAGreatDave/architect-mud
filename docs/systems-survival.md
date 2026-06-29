# Survival Systems (As Built)

Hunger, thirst, radiation, mutations, drugs, buffs, sleep, and the status-effect framework. Documents
what the engine actually does today. Primary files: [gameLoop.js](../server/engine/gameLoop.js),
[apartments.js](../server/engine/apartments.js), [drugs.js](../server/engine/drugs.js),
[mutations.js](../server/engine/mutations.js), [effects.js](../server/engine/effects.js),
[commands/inventory.js](../server/engine/commands/inventory.js) (`use`).

## Hunger & thirst

Driven by `resourceTick` (`gameLoop.js`), which runs once per minute via the scheduler. Each awake
player carries a `_tickCounter`; decay is gated on it:

- **Thirst:** −1 every 3 minutes (`THIRST_DECAY_INTERVAL_MIN = 3`) → ~5 hours from full to empty.
- **Hunger:** −1 every 4 minutes (`HUNGER_DECAY_INTERVAL_MIN = 4`) → ~6.7 hours from full to empty.

At ≤20 the player is warned ("very hungry/thirsty"). At 0:

- **Starvation:** −1 HP/min while hunger is 0.
- **Dehydration:** −2 HP/min while thirst is 0 (thirst kills faster, matching the decay pacing).

Both can reduce HP to 0 and trigger `handlePlayerDeath`. Restored by consumables (see **Buffs** below)
and partially by sleep economics.

## Radiation

Range 0–100. Three sources/sinks:

- **Zone exposure on entry** (`commands/movement.js`): entering a zone with `radiation_level > 0`
  adds `floor(radiation_level × 0.1)`, capped at 100.
- **Natural decay** (`minuteTickFn`, `gameLoop.js`): −1/min normally, **−2/min while hydrated**
  (the `hydrated` buff). A `player_update` is pushed to the client whenever radiation crosses a
  multiple of 10.
- **`irradiated` status effect** (+2/tick) — defined but currently inert (see **Status effects**).

Sustained radiation feeds the mutation system.

## Mutations

[mutations.js](../server/engine/mutations.js) + the [mutations plugin](../plugins/mutations/index.js).
HellMOO-style, permanent, dev-panel editable, cached in memory at boot.

- **Trigger:** the mutations plugin's `tick.minute` hook walks every online player; for anyone with
  `radiation ≥ 40`, `checkMutationTrigger` rolls a **5% chance per minute** to grant one eligible
  mutation (radiation ≥ the mutation's `radiation_threshold`, not already owned).
- **Effect:** `stat_modifiers` are applied additively to the player's stats in the DB and (for the
  current session) in memory; the grant is recorded in `player_mutations`.
- **Visible mutations & the outcast mechanic:** a mutation flagged `visible` sets
  `players.visibly_mutated`. In zones flagged `custodian_controlled`, visibly-mutated players get
  hostility text on look; if the zone also has `has_turrets`, `describeZone` fires a turret for
  6–14 damage on an 8-second per-player cooldown (floored so it can't kill).

> **Known bug:** the in-memory live player object built at login ([index.js](../server/index.js))
> does **not** copy `visibly_mutated` from the DB, so the outcast/turret mechanic only fires during the
> same session in which the mutation was gained — it resets on reconnect. See the QA report.

## Drugs & addiction

[drugs.js](../server/engine/drugs.js), invoked from the `use` and `inject` commands when the item joins
to a row in `drugs` (both share one handler in the drugs plugin). Dev-panel editable, cached at boot.

- **Effects** (`effects` JSON): instantaneous, clamped stat deltas — `hp`, `sanity`, `hunger`, `thirst`,
  `radiation`. Restoring `hunger`/`thirst` also applies `digestive_load`/`hydration_load` via
  `foodLoad`/`drinkLoad`, the same as the `consumable` path — so a drug that fills you up carries the
  same bowel/bladder cost as food (see "Digestive & hydration load" below). Per-drug state is tracked in
  `player_drug_state` (`doses_in_system`, `times_used`, `is_addicted`, `active_until`).
- **Overdose:** when `doses_in_system ≥ overdose_threshold` (default 3), the drug's
  `withdrawal_effects.overdose` deltas are merged into the dose's effects and an overdose warning fires.
- **Addiction:** if not already addicted, a `Math.random() < addiction_chance` roll on each use can
  flip `is_addicted`.

> **Known gaps** (see the QA report): drug effects are applied **instantly**, not over `duration_seconds`
> — `active_until`/`duration_seconds` are stored but no timed reversal exists. `tickDrugDecay()` (which
> would decrement `doses_in_system` after `active_until`) and `getPlayerDrugState()` have **no callers**,
> so doses never decay → overdose state, once reached, is effectively permanent, and there is no enacted
> withdrawal penalty for addiction.

## Buffs & heal-over-time

Applied by the `use`/`eat`/`drink` command from item tags ([inventory.js](../server/engine/commands/inventory.js)):

- **`restore_hp` / `restore_hunger` / `restore_thirst` / `restore_radiation` / `restore_sanity` /
  `grants_credits`:** immediate clamped deltas.
- **`heal_over_time` `{amount, duration_seconds}`:** queued on `player.healOverTime`; `resourceTick`
  applies `perTick` HP each minute until exhausted or HP is full.
- **`well_fed`:** sets `wellFedUntil = now + 10 min`; while active and below max HP, `resourceTick`
  adds +2 HP/min.
- **`hydrating`:** sets `hydratedUntil = now + 10 min`; doubles radiation decay (see **Radiation**).

`stats` shows active buffs (Asleep / Healing / Well-Fed / Hydrated).

## Sleep

[apartments.js](../server/engine/apartments.js) `cmdSleep` + `tickSleep` (run from `resourceTick`).

- **Eligibility** (`getSleepEligibility`): your own apartment → best rest (`SLEEP_RESTORE_HOME` =
  18% HP / 15% sanity of *missing* per minute); a safe zone or someone's unlocked apartment → shallower
  (`SLEEP_RESTORE_SAFE_ZONE` = 8% / 5%); anywhere unsafe / a locked apartment that isn't yours → can't sleep.
- **Per minute asleep:** restore a slice of missing HP/sanity, drain 1 hunger + 1 thirst.
- **Auto-wake** on any of: fully rested, hunger or thirst ≤ 5, or 30 minutes slept (`SLEEP_MAX_MINUTES`).
- Any command other than `sleep`/`rest` wakes the player and is then executed (`commands/index.js`).

## Bodily pressure

[bodily.js](../server/engine/bodily.js), ticked once per minute by `resourceTick` for each awake player.

Two hidden float columns on the `players` row — `digestive_load` (bowel) and `hydration_load` (bladder) — accumulate as the player eats and drinks:

- **Eating:** adds `restoreHunger × 0.5` digestive load (the `consumable` path **and** drugs that restore hunger).
- **Drinking:** adds `restoreThirst × 0.6` hydration load (the `consumable` path **and** drugs that restore thirst).
- **Natural decay:** −1 digestive / −2 hydration per minute (bladder clears faster than bowel).

**Threshold messages** (80–110) fire occasionally — every 3 minutes — as private ambient descriptions of increasing urgency, randomly selected from flavour pools. At >110 an **involuntary release** occurs with a zone-visible ambient message (no source attribution) and a dump to 0.

`foodLoad(restoreHunger)` and `drinkLoad(restoreThirst)` are exported so the `use`/`eat`/`drink` path can apply load at the same time as it applies the hunger/thirst restore.

## Status effects (framework only)

[effects.js](../server/engine/effects.js) is a clean data-driven framework (`bleeding`, `burning`,
`irradiated`) that ticks every second. **It is currently inert: `applyEffect()` has no callers**, so no
effect is ever started. Wiring weapon `status_chance`, drug overdose, and zone hazards into `applyEffect`
is the intended use. Flagged in the QA report as dead-until-wired.
