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

[drugs.js](../server/engine/drugs.js), invoked from `use`/`inject` when the item joins to a row in
`drugs`. Dev-panel editable, cached at boot. The `effects` JSON is one schema with all sub-blocks
optional; a flat object with none of the structured keys is treated as an `instant` block (back-compat
for pre-existing drugs). Per-drug state lives in `player_drug_state` (`doses_in_system`, `times_used`,
`is_addicted`, `active_until`, plus `tolerance` and `addiction`).

- **`instant`** — one-shot, clamped stat deltas (`hp`, `sanity`, `hunger`, `thirst`, `radiation`,
  `horniness_increase`). Restoring `hunger`/`thirst` applies `digestive_load`/`hydration_load` via
  `foodLoad`/`drinkLoad`, exactly like the `consumable` path.
- **`phases`** — phased effects over time (come-up → peak → comedown), pushed onto `player.activeDrugs`
  and advanced by `tickDrugs()` in the 1s loop. `peak_mods` holds buff deltas (`stat_*`, `hp_max`,
  `sanity_max`) applied through the **reversible modifier ledger** in
  [statmods.js](../server/engine/statmods.js) — buffs are scaled per phase by `comeup_scale`/
  `comedown_scale` and **cleanly reversed** on expiry (the ledger never bakes a buff into a base stat).
  `*_regen_per_sec` keys in `peak_mods` are per-second drip regen (fractional accumulator, like
  heal-over-time). Optional `comeup/peak/comedown/end_message` lines narrate each transition.
- **Tolerance** (`tolerance` block) — each dose raises `player_drug_state.tolerance`; it recovers lazily
  off `last_used_at`. Potency (locked into the active-drug entry) is `1 − tolerance × max_reduction`,
  scaling both phased buff magnitude and hallucination intensity.
- **Overdose = death** — when `doses_in_system ≥ overdose_threshold` and `effects.overdose.lethal`,
  `useDrug()` returns `overdose_death` and `cmdUse` runs the full `handlePlayerDeath` path (corpse + vat
  respawn), clearing any active buff/trip. Non-lethal overdose keeps the legacy burst-penalty behaviour.
  `tickDrugDecay()` decrements `doses_in_system` after `active_until`, so OD risk clears over time.
- **Addiction & withdrawal** — `addiction` accumulates per dose (`withdrawal.addiction_per_dose`, default
  `addiction_chance`) and decays over time; ≥ 0.5 marks the player addicted. `tickWithdrawal()` (minute
  cadence) applies `withdrawal.mods` through the ledger once time-since-last-use exceeds
  `withdrawal.onset_seconds`; re-dosing reverses it.
- **Appetite suppression** — a drug flagged `flags.smokeable` (cigarettes) is driven by the **smoking
  plugin** ([plugins/smoking/index.js](../plugins/smoking/index.js)) off the `player.drugUsed` event. On a
  smoke the plugin sets `player.appetiteSuppressedUntil` (ms); the hunger-decay line in `resourceTick`
  ([gameLoop.js](../server/engine/gameLoop.js)) reads that field and simply skips decay while it's in the
  future — plugin owns the field, engine reacts (the posture pattern). The plugin also owns the hacking
  cough and the onlooker "cool-reaction"; the Cool buff / Stamina debuff are plain `phases.peak_mods`
  (`stat_cool` / `stamina_max`). See [plugins.md](plugins.md).
- **Being stoned** — a drug flagged `flags.cannabis` (joints) is driven by the **cannabis plugin**
  ([plugins/cannabis/index.js](../plugins/cannabis/index.js)) off `player.drugUsed`. It sets an
  in-memory `player._cannabisHighUntil` (ms) and owns the four things that aren't stat deltas:
  a **global audio echo** (client `audio_echo` → `AudioEngine.setEcho`, a master-bus delay send so
  all sound shimmers), the **munchies** (its own tick drains hunger + narrates cravings — the deliberate
  inverse of cigarette appetite-suppression, which is why a joint is **not** `flags.smokeable`), the
  **giggles**, and **red eyes** on examine (the `player.appearanceNotes` fireHook in
  [commands/world.js](../server/engine/commands/world.js), mirroring `player.appearanceMisNotes`). The
  mellow itself (relaxation, cotton-mouth, dulled reflexes) is plain content on the drug row; joints are
  non-addictive (`addiction_chance 0`, no withdrawal) with a non-lethal green-out overdose. See
  [plugins.md](plugins.md).
- **Hallucinations** (`hallucination` block) — handled by the **trip plugin**
  ([plugins/trip](../plugins/trip/index.js)) off the engine's `drug.used` hook. `mode: "overlay"` streams
  scripted timed events + trippy client FX while the body stays in the real zone (attackable);
  `mode: "dreamzone"` teleports the mind into an isolated off-map zone (`flags.is_dreamzone`) and spawns
  an **attackable phantom body** in the real zone that mirrors the player's HP — damaging it damages the
  player, and killing it kills them. See [systems-broadcast.md] siblings and the trip plugin for FX
  (`trip_start`/`trip_event`/`trip_fx`/`trip_end` client messages, the `[trip]` markup tag, `#trip-overlay`
  + `.tripping` CSS, and inline trip audio). Trips are in-memory; a login rescue in `server/index.js`
  bounces anyone stranded in a dream zone by a restart back to their anchor.

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

Owned by the **bodily plugin** ([plugins/bodily/index.js](../plugins/bodily/index.js)) — its own 1m
tick, skipping sleeping players. The engine keeps only the substrate half in
[bodily.js](../server/engine/bodily.js): stains (`stainClothing`/`stainZone`) and the digestion loads
(`foodLoad`/`drinkLoad`/`applyThirst`) that eating/drinking/drugs feed.

Two hidden float columns on the `players` row — `digestive_load` (bowel) and `hydration_load` (bladder) — accumulate as the player eats and drinks:

- **Eating:** adds `restoreHunger × 0.5` digestive load (the `consumable` path **and** drugs that restore hunger).
- **Drinking:** adds `restoreThirst × 0.6` hydration load (the `consumable` path **and** drugs that restore thirst).
- **Natural decay:** −1 digestive / −2 hydration per minute (bladder clears faster than bowel).

**Threshold messages** (80–110) fire occasionally — every 3 minutes — as private ambient descriptions of increasing urgency, randomly selected from flavour pools. At >110 an **involuntary release** occurs with a zone-visible ambient message (no source attribution) and a dump to 0.

`foodLoad(restoreHunger)` and `drinkLoad(restoreThirst)` are exported so the `use`/`eat`/`drink` path can apply load at the same time as it applies the hunger/thirst restore.

## Body temperature & thermal comfort

`players.body_temp_c` (float, initialised to `37.0` on login in [index.js](../server/index.js)), drifted once per minute by `resourceTick` in [gameLoop.js](../server/engine/gameLoop.js) for each awake player. Clamped to **25–45°C** and rounded to one decimal. This is an **engine** system; the clothing fields it reads (`player.insulation`, `player.exposurePenalty`) are derived by `recomputeInsulation` in [inventory.js](../server/engine/commands/inventory.js), and the wetness field it reads (`player.wetness`) is owned by the clothing-wetness plugin (see below). The three must agree on those field names.

**Ambient the body drifts toward.** `getZoneApparentTemperature(zoneId, tempOffset)` in [environment.js](../server/engine/environment.js) — the "feels like" temperature (diurnal + per-tile weather offset outdoors, or a stored interior temp indoors; wind chill + humidity folded in outdoors only). See the apparent-temperature detail in [systems-world.md](systems-world.md); the temperature tick does not re-derive the curves.

**Clothing offsets.** Two effective temperatures are computed from the ambient:
- `warmthTemp = effectiveAmbient + insulation − exposurePenalty` — used on the **cold** side.
- `heatTemp = effectiveAmbient + insulation` — used on the **hot** side.

`recomputeInsulation(player)` sums the `insulation` tag value of every equipped item into `player.insulation` and sets `player.exposurePenalty = (torso covered ? 0 : 10) + (legs covered ? 0 : 5)` from the equipped items' `slot` tags. The exposure penalty is subtracted **only on the cooling side**, so bare skin makes the cold bite (torso dominant, legs secondary) but is a relief in the heat. `recomputeInsulation` (alongside `recomputeArmor`) is re-run on every equip/unequip and on bulk-drop of equipped items, so the fields stay current.

**Drift.** With `COLD_THRESHOLD = 10` and `HOT_THRESHOLD = 35`:
- **Cooling** (`warmthTemp < 10`): body temp falls by `baseDrift × wetMult` per minute, where `baseDrift = 0.002 × |10 − warmthTemp|^1.75` and `wetMult = 1 + wetness/100` (soaked ≈ 2× faster cooling).
- **Heating** (`heatTemp > 35`): body temp rises by `baseDrift × wetMult`, `baseDrift = 0.002 × (heatTemp − 35)^1.75`, `wetMult = max(0.70, 1 − wetness × 0.003)` (being wet mildly slows overheating via evaporative cooling).
- **Comfort band** (neither): metabolic thermoregulation relaxes core toward 37°C exponentially, `cur + (37 − cur) × 0.05` per minute (snaps to 37.0 within 0.1°C). A ~3°C deficit recovers in ~35 min.

Drift examples: `|diff|=10 → 0.11°C/min`; `|diff|=20 → 0.38°C/min`.

**Effects of core temperature** (on `body_temp_c` after drift):
- **Danger HP loss:** freezing (`<30°C`) or overheating (`>42°C`) increments `player._dangerousTempTicks`; after **5 continuous minutes** it deals **−10 HP/min** (hypothermia / heat stroke message), floored at 0 and feeding `handlePlayerDeath`. Any non-dangerous tick resets the counter, so short spells don't kill.
- **Thirst drain:** hot/overheating (`>40°C`) drains 1 extra thirst on a 50% roll per minute.
- **Stamina:** freezing/overheating drain −3/min, cold (`30–34°C`) or hot (`40–42°C`) drain −1/min; otherwise passive regen of `floor(2 × tempRegenMultiplier(tempC))` — full regen in 36–38°C (and mildly-hot 38–40°C), tapering to 0 at `<30°C` or `>42°C`.
- **Flavour:** `tempFlavorMessage(tempC, tick)` emits banded ambient lines (chilly → shivering → hypothermia; warm → sweating → heat stroke), rate-limited by tick count so they don't spam. Silent in the 36–38°C comfort band.

`body_temp_c` is persisted each tick and pushed to the client in the `resource_tick` `player_update` whenever it changes.

## Clothing wetness & drying

The [clothing-wetness plugin](../plugins/clothing-wetness/index.js). This is a **plugin**, not engine code: its `tick.minute` hook walks every live, awake player, updates per-item wetness, and writes the aggregate to `player.wetness` — the field the engine's temperature tick reads as `wetMult`. Wetness is stored **per item** in `player_inventory.custom_data.wetness` (0–100 integer, merged via a `jsonb ||` update only when the rounded value changes); `player.wetness` is the mean over equipped wettable items. Only items tagged **`gets_wet`** accumulate wetness; a player with no such equipped item has `player.wetness = 0`.

**Wetting** (outdoors, when `getZonePrecip` reports `precipRate > 0` and the zone is not `flags.is_interior`). Per minute:
- **Rain:** `rainWettingRate = precipRate² × 30` (quadratic — torrential soaks far faster than drizzle). Light rain (0.3) ≈ 37 min to soaked; moderate (0.5) ≈ 13 min; heavy (0.65) ≈ 8 min; torrential (0.95) ≈ 4 min.
- **Snow** (`precipType === 'snow'`), piecewise: `≤0.2 → precipRate × 2`; `0.2–0.7 → precipRate × 6`; `>0.7 → min(precipRate × 3, 3)` (blizzard's dry wind caps the soak rate).

Indoors, or when precipitation stops, items **dry** instead.

**Drying.** `dryRate = baseDryRate × dryMultiplier(temp) × windMult × humidMult` per minute:
- `baseDryRate` = **3 indoors, 2 outdoors**.
- `dryMultiplier(tempC) = 1 + max(0, tempC − 15)/20` — every 10°C above 15°C adds ~50% (15°C→1×, 25°C→1.5×, 35°C→2×), using `getZoneTemperature`.
- `windMult = 1 + min(1.5, windKph/30)` and `humidMult = max(0.5, min(1.3, 1.5 − humidityPct/100))` (null humidity → 1×) apply **outdoors only**; interiors treat both as 1× (sheltered, HVAC-neutral).

**Thresholds & messaging.** `WETNESS_THRESHOLDS` at **25 / 50 / 75 / 100** ("starting to get damp" → "getting quite wet" → "very wet" → "completely soaked"), with matching falling messages as you dry ("almost dry" → "drying off" → "drying out"), plus a `"You're completely dry."` line when `player.wetness` reaches 0. Messages fire on the aggregate crossing a threshold in the appropriate direction; a `resource_tick` broadcast with `player_update.wetness` is sent whenever the rounded value changes.

**Feedback into body temperature.** `player.wetness` is consumed by the engine's temperature drift (above): wet clothing accelerates **cooling** (`wetMult = 1 + wetness/100`, up to 2× when soaked) and slightly retards **overheating** (`wetMult = max(0.70, 1 − wetness × 0.003)`). This is the sole cross-system coupling; the plugin owns the wetness value, the engine owns its thermal consequence, and they meet on the `player.wetness` field name. Sleeping players are skipped by the wetness hook.

## Status effects

[effects.js](../server/engine/effects.js) is a clean data-driven framework (`bleeding`, `burning`,
`irradiated`, `choking`) that ticks every second. Its **first caller** is the extreme-weather ashfall
hazard: `resourceTick` applies `choking` to unmasked players outdoors during `ash` weather (see
[systems-weather-extreme.md](systems-weather-extreme.md) §4). `choking` drains stamina (−4/s), then HP
(−2/s) once winded. The per-second tick now **persists and broadcasts** hp/stamina whenever an effect
changes them (previously effect damage was invisible on the HUD until the minute tick). Wiring weapon
`status_chance` and drug overdose into `applyEffect` remains the next intended use.
