# Survival Systems (As Built)

Hunger, thirst, radiation, mutations, drugs, buffs, sleep, and the status-effect framework. Documents
what the engine actually does today. Primary files: [gameLoop.js](../server/engine/gameLoop.js),
[apartments.js](../server/engine/apartments.js), [drugs.js](../server/engine/drugs.js),
[mutations.js](../server/engine/mutations.js), [effects.js](../server/engine/effects.js),
[commands/inventory.js](../server/engine/commands/inventory.js) (`use`).

## Hunger & thirst

Driven by `resourceTick` (`gameLoop.js`), which runs once per real minute via the scheduler. Each awake
player accumulates the **game**-minutes elapsed this tick (`getTimeScale()`, carried fractionally in
`player._gmAccum`) into `_thirstAccum` / `_hungerAccum`, and whole points drain off those — so the
pacing below is in **game** minutes and scales with the game-speed knob:

- **Thirst:** −1 every 3 game-minutes (`THIRST_DECAY_INTERVAL_MIN = 3`) → ~5 game-hours from full to empty.
- **Hunger:** −1 every 4 game-minutes (`HUNGER_DECAY_INTERVAL_MIN = 4`) → ~6.7 game-hours from full to empty.

At ≤20 the player is warned ("very hungry/thirsty"). At 0:

- **Starvation:** −1 HP/min while hunger is 0.
- **Dehydration:** −2 HP/min while thirst is 0 (thirst kills faster, matching the decay pacing).

Both can reduce HP to 0 and trigger `handlePlayerDeath`. Restored by consumables (see **Buffs** below)

**What deprivation costs before it kills you** (`condition.js` + `gameLoop.js`):

| Meter | Stat penalty (`statPenalty`) | Stamina recovery (`deprivationRegenMultiplier`) |
| --- | --- | --- |
| Hunger ≤20 / ≤5 | Brawn −1 / −2 | ×0.75 / ×0.5 (×0.25 at 0) |
| Thirst ≤20 / ≤5 | **Endurance** −1 / −2; Brains −1 at ≤5 | ×0.7 / ×0.45 (×0.2 at 0) |

Thirst used to cost **Cool**, which was a pun rather than a symptom. It now costs Endurance —
the documented headline effect of dehydration — with the cognitive hit held one band later. The two
multipliers stack but are floored together at `DEPRIVATION_FLOOR = 0.2`, because `gain` is floored to
an integer and the raw product would round a resting player's recovery to zero.

**Endurance drives both maxima and the refill rate.** `maxHpForEndurance` (base 40, +2/point) and
`maxStaminaForEndurance` (base 100, +4/point) in [ip.js](../server/engine/ip.js), plus
`enduranceRegenMultiplier` in gameLoop (END 5 baseline, ±8%/point, clamped 0.6–1.4). The regen
multiplier reads through `effectiveStat`, which is what makes dehydration's Endurance penalty land
somewhere the player feels it. Both maxima are reconciled against `stat_endurance` **on login**
([index.js](../server/index.js)), so existing characters self-heal with no migration script.
and partially by sleep economics.

## Radiation

Range 0–100. Three sources/sinks:

- **Irradiated ground** (`irradiatedGround` + `minuteTickFn`, `gameLoop.js`): exposure is driven by
  the tile, **not** by entering it — standing anywhere whose `radiation` zone tag is `> 0`
  (`zones.flags.radiation`, 0–100, read via `getZoneRadiation()` in `engine/zone-tags.js`), or on a
  transient `flags.void_crossing` room, trickles **+1 RAD every 10 minutes** and **suspends the
  wash-out below**. Radiation ≥25/≥40 also floors the zone's inferred danger to high/lethal
  (`engine/danger.js`).
- **Natural decay** on clean ground (`minuteTickFn`): −1/min normally, **−2/min while hydrated**
  (the `hydrated` buff). A `player_update` is pushed to the client whenever radiation crosses a
  multiple of 10.
- **`irradiated` status effect** (+2/tick) — defined but nothing applies it (see **Status effects**).

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

## Drugs & addiction

[drugs.js](../server/engine/drugs.js), invoked from `use`/`inject` when the item joins to a row in
`drugs`. Dev-panel editable, cached at boot. The `effects` JSON is one schema with all sub-blocks
optional; a flat object with none of the structured keys is treated as an `instant` block (back-compat
for pre-existing drugs). Per-drug state lives in `player_drug_state` (`doses_in_system`, `times_used`,
`is_addicted`, `active_until`, plus `tolerance` and `addiction`).

- **`instant`** — one-shot, clamped stat deltas (`hp`, `sanity`, `hunger`, `thirst`, `radiation`,
  `horniness_increase`). Restoring `hunger`/`thirst` applies `digestive_load`/`hydration_load` via
  `foodLoad`/`drinkLoad`, exactly like the `consumable` path. **These are permanent — the body absorbed
  the dose — and never reverse** (unlike `phases` buffs). This is the split that makes collapsing the two
  a mistake: the ledger would *refund* an hp cost on comedown.
- **`onset_seconds`** — how long the dose takes to HIT. `0` (default) = instant snap (the cocaine-type).
  `>0` defers the **whole `instant` block AND the hallucination trigger** to land after N seconds via
  `tickOnsets()` (1s loop, sibling to `tickDrugs`) — pushed onto `player.pendingOnsets`, cleared on death.
  So most drugs "come on" instead of snapping, and a trip's come-up rides with the drug. The come-up ramp
  of a *buff* still lives in `phases.comeup_scale`; `onset` is only the deferral of the one-shot hit.
  Optional `comeon_message` (shown at use) and `onset_message` (shown on landing) narrate it.
- **`phases`** — phased effects over time (come-up → peak → comedown), pushed onto `player.activeDrugs`
  and advanced by `tickDrugs()` in the 1s loop. `peak_mods` holds buff deltas (`stat_*`, `hp_max`,
  `sanity_max`) applied through the **reversible modifier ledger** in
  [statmods.js](../server/engine/statmods.js) — buffs are scaled per phase by `comeup_scale`/
  `comedown_scale` and **cleanly reversed** on expiry (the ledger never bakes a buff into a base stat).
  `*_regen_per_sec` keys in `peak_mods` are per-second drip regen (fractional accumulator, like
  heal-over-time). Optional `comeup/peak/comedown/end_message` lines narrate each transition.
- **Laced consumables** (`tags.laced_drug` + optional `tags.laced_potency`) — any **consumable** item
  (a drink or food, not a `drug`-type item) can carry a drug that fires when it's used: the consumable
  path applies the item's own restores, then calls `useDrug(laced_drug, { potencyMult: laced_potency,
  skipInstant: true })`. `skipInstant` runs the drug's *systemic* effects (the meter via `player.drugUsed`,
  phases, overdose) but **skips its instant resource block**, so the drug's restores don't double the
  item's. This is the general "drugged drink/food" path. **Alcohol** is its first user: `drug_alcohol`
  (`flags.alcoholic`) is one shared drug — beer is a drug item linked to it; the bar drinks are laced
  consumables at per-drink `laced_potency` — so all drinks share one BAC pool, tolerance and
  alcohol-poisoning OD. A non-alcohol laced item just points `laced_drug` at any other drug.
- **Route of administration** (`opts.route` — the verb that delivered the dose: `use`/`inject`/`eat`/
  `drink`/`smoke`) — `useDrug()` owns the `ROUTES` table and multiplies `onset_seconds` by `route.onset`
  and dose strength by `route.intensity`. Injecting collapses the come-up and hits harder; eating stretches
  it and softens it. The accelerated routes (`inject`, `smoke`) are **gated on a drug flag**
  (`flags.injectable`, `flags.smokeable`) and silently fall back to neutral otherwise, so **a drug with no
  route flags behaves exactly as it did before this existed**. Route intensity feeds `intensityMult`
  (effects + dose weight); batch potency stays separate in `potencyMult` so the "this batch is strong" tell
  still reports the *cook*, not the needle. Every `cmdUse` caller passes its verb; `finishConsume` can't see
  the original verb, so the `consume` plugin supplies `route` in `extraOpts` from its category.
- **Tolerance** (`tolerance` block) — each dose raises `player_drug_state.tolerance`; it recovers lazily
  off `last_used_at`. Potency (locked into the active-drug entry) is `1 − tolerance × max_reduction`,
  scaling both phased buff magnitude and hallucination intensity.
- **Overdose = death** — the ceiling is **`overdose_threshold × (1 + tolerance × 1.5)`**, computed from the
  tolerance carried *into* the dose (post-decay, pre-gain). Tolerance therefore buys real headroom — and
  losing it takes that headroom away, which is the **relapse law**: a habit dose that was routine at peak
  tolerance becomes lethal once time clean has burned the tolerance off. When `doses_in_system` reaches that
  ceiling and `effects.overdose.lethal` is set, `useDrug()` returns `overdose_death` and `cmdUse` runs the
  full `handlePlayerDeath` path (corpse + vat respawn), clearing any active buff/trip. Non-lethal overdose
  keeps the legacy burst-penalty behaviour. `tickDrugDecayAll()` clears `doses_in_system` on a **half-life**
  (sheds `CEIL(doses × 0.25)` per minute once past `active_until`, so a heavy load falls away fast and the
  last trace still terminates at zero on the integer column).
- **Addiction & withdrawal** — `addiction` accumulates per dose (`withdrawal.addiction_per_dose`, default
  the misleadingly-named `addiction_chance`, which is an **additive step, not a probability**) and decays
  over time. Dependency runs on **hysteresis**: it latches at `addiction ≥ 0.5` but only releases below
  `0.3`, so a player hovering at the line can't flicker in and out every tick. `tickWithdrawalAll()` (minute
  cadence) applies `withdrawal.mods` through the ledger once time-since-last-use exceeds
  `withdrawal.onset_seconds`; re-dosing reverses it. The debuff is **scaled by a severity arc** rather than
  snapping on flat — ramps from a floor of `0.25` to full over `ramp_seconds` (30 min), holds through
  `peak_seconds` (2 h), then tapers over `taper_seconds` (6 h) back to the floor, which it never drops below
  while still addicted. Per-drug overrides ride the `withdrawal` block. `player._withdrawalActive` is a
  **Map** of `drugId → applied-mod signature` so an unchanged severity doesn't churn the ledger through a
  reverse-and-reapply every minute.
- **Polydrug load** (`flags.drug_class`) — drugs of the same class share one ceiling, because they
  depress (or drive) the same system. Every same-class drug contributes its `doses_in_system` as a
  **fraction of its own tolerance-scaled ceiling**, and you overdose when the total reaches 1. For a
  lone unclassed drug that reduces to exactly `doses >= threshold` — the old law — so **untagged content
  behaves precisely as before**. Worked example: 4 drinks (4/8) plus one bag of tar (1/2) is 1.0 and
  kills, where either alone is survivable. Two classes are tagged, and only two, because only these kill
  by additive load: **`depressant`** (alcohol, blacktar, grey, lull, slow, ether) and **`stimulant`**
  (redline, coldfire, buzz, overclock). Psychedelics/dissociatives are deliberately unclassed — dangerous
  in other ways, but they don't stop your breathing by stacking — as are coffee and cigarettes, which a
  new player consumes constantly without meaning to take a risk. Spliced compounds carry no class (their
  carrier row has none), so they don't stack. When the mix is what killed you — the dose alone was
  survivable — the death message says so, and a survivable mix warns you on the way in; a death you
  couldn't see coming is a bug, not difficulty.
- **Class membership cuts four ways** — beyond the shared overdose ceiling above, `flags.drug_class`
  also drives: **substitution** (any same-class drug taken recently holds part of the class's withdrawal
  off, decaying back to full bite as its own `duration_seconds` runs out, floored at `SUBSTITUTION_FLOOR`
  — a cousin is never the drug you want, but it is why an addict takes what's nearest); **cross-tolerance**
  (`CROSS_TOLERANCE` = half of the strongest same-class tolerance, feeding *both* the dulled high and the
  raised ceiling — so class membership protects as well as endangers, and is never written back into the
  taken drug's own row); and **depth** (withdrawal severity scales from `WD_DEPTH_FLOOR` to 1 across the
  addiction band, so a casual user at the latch and a 0.95 addict no longer suffer identically).
  `isWired(player)` reports an active stimulant — `cmdSleep` asks it rather than growing its own
  pharmacology, so you cannot lie down on a live upper.
- **`habits` (the read-out)** — the whole model above is server-side and was otherwise invisible: a
  player could only infer tolerance, dependency and the withdrawal arc from stats moving for no stated
  reason. `habits` (drugs plugin) lists every substance you have a history with — decayed tolerance,
  whether it has you, time since the last dose, where you are on the withdrawal arc, and how many doses
  are still in you against the **current** overdose ceiling (which shrinks as tolerance fades — the
  relapse warning the system owes you). It formats `getDrugStatus()` and **computes nothing itself**:
  every derived value comes from the same constants and curve functions the ticks use, so the read-out
  cannot drift from the laws when one is tuned.
- **Spliced-compound identity** — every compound rides the same carrier row (`drug_compound`), so
  `player_drug_state` is keyed on a **`stateKey`** (`opts.stateKey`, built by `compoundStateKey()` in
  `commands/inventory.js` from the splice's `custom_data.sources`), not the drug id. Without it, doses,
  tolerance and the mod ledger pooled across unrelated compounds — three doses of one could overdose you
  on the first dose of another, and dosing B cancelled A's buffs. The same key names the ledger sources
  (`drug:<stateKey>` / `withdrawal:<stateKey>`). Because a compound has no `drugs` row, its composed blob
  is stashed in **`player_drug_state.effects`** at use time; the withdrawal tick resolves
  `DRUG_CACHE[drug_id]?.effects || state.effects`, which is what stops a compound latching `is_addicted`
  forever with no debuff and no message.
- **Withdrawal drip** — `*_regen_per_sec` keys in `withdrawal.mods` are a per-second rate, not a ledger
  buff, and are applied by `applyWithdrawalDrip()` over the minute tick (`rate × severity × 60`), clamped
  to the stat's cap and floored at 0. Never route them through `applyMods` — the ledger has no such field.
- **Session boundaries** — `activeDrugs` and `pendingOnsets` are memory-only while doses/tolerance are
  persisted, so `clearActiveDrugBuffs(player)` reverses the ledger and drops both at logout **and** on
  session replacement (`player.sessionReplaced`, emitted in `server/index.js` because a reconnect never
  fires `player.logout`). It deliberately does **not** clear `doses_in_system` — that would make logging
  out a free way to shed overdose risk; only death (`clearActiveDrugState`) does that. Deferred callbacks
  that write a player must gate on `isLivePlayer(player)` (world.js), since a reconnect discards the old
  object and a stale timer would otherwise persist frozen stats over the new session.
  **Ledger invariant:** a cap can fall through *either* ledger path — reversing a buff or applying a debuff
  — and [statmods.js](../server/engine/statmods.js) clamps the current value under it both ways (floored at
  1, so the ledger can never kill). So a withdrawal that carries `hp_max: -25` costs **real HP**: your
  ceiling drops and your current hp follows it down. Recovery restores the ceiling but **not** the hp —
  the cost stays paid, and you regen back up from there.
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
  ([plugins/trip](../plugins/trip/index.js)) off the engine's `drug.used` hook. Three modes:
  - `mode: "overlay"` streams scripted timed events + trippy client FX while the body stays in the real
    zone (attackable).
  - `mode: "dreamzone"` teleports the mind into an isolated off-map zone (`flags.is_dreamzone`) and spawns
    an **attackable phantom body** in the real zone that mirrors the player's HP — damaging it damages the
    player, and killing it kills them.
  - `mode: "phantom"` — a **deliriant**, deliberately silent: NO screen FX, NO `[trip]` text, NO "you are
    hallucinating" cue. Per-player **fake people/animals** (authored in the drug's `hallucination.phantoms`
    array, else a default roster) walk into the player's REAL room, act via ambient-styled emotes, and
    render into the room look identically to real NPCs/hostiles. They answer to `look`/`examine`/`talk`/
    `attack` as if real — until an interaction (a whiffed punch → the phantom evaporates, a bystander
    stares) reveals there was nothing there. The illusion follows the player room-to-room. Backed by the
    engine's per-player phantom registry [server/engine/phantoms.js](../server/engine/phantoms.js) (the
    law: a room can hold entities only one viewer sees; `matchPhantom` always defers to any real entity),
    which describe.js reads for the render and the trip plugin's specialized-action intercepts read for
    interactions. Reference drug: [content/drugs/drug_wraithdust.json](../content/drugs/drug_wraithdust.json).

  See the trip plugin for overlay/dreamzone FX (`trip_start`/`trip_event`/`trip_fx`/`trip_end` client
  messages, the `[trip]` markup tag, `#trip-overlay` + `.tripping` CSS, and inline trip audio). Trips
  (and phantoms) are in-memory; a login rescue in `server/index.js` bounces anyone stranded in a dream
  zone by a restart back to their anchor.

## Sanity — the slide into madness

`players.sanity` (0–100, `sanity_max` default 100). Nothing in the **sanity plugin**
([plugins/sanity/index.js](../plugins/sanity/index.js)) *drains* it — drugs (`instant.sanity`),
`restore_sanity` consumables and sleep own the meter. The plugin owns only the **consequence**: a
gradual, deliberately scarier-than-a-drug-trip dread that escalates as sanity falls, driven by its
`tick.minute` hook walking the live `world.players` (no DB reads — reads `player.sanity` off the live
object). One continuous intensity curve (`(50 − sanity)/50`, clamped) over three bands on the **raw**
sanity value:

- **creep (25–49)** — unease, no hallucinations yet. A cold closing-in vignette (`#sanity-overlay`)
  that deepens as sanity drops, a low dread audio bed, and occasional **misperception whispers**
  (private `.msg-dread` lines: "Something moves at the edge of your vision…").
- **halluc (below 25)** — you **start seeing things**. Fake people and animals are conjured into the
  player's **real** room and read as ordinary presences. These reuse the engine's shared per-player
  **phantom registry** ([phantoms.js](../server/engine/phantoms.js)); the **trip** plugin's
  look/examine/talk/attack specialized actions answer them for free (`matchPhantom` is global — a
  whiffed swing evaporates one). Whispers turn specific and close.
- **insane (≤0)** — full breakdown. The plugin sets `player.insane`; the engine's **substrate gate**
  in [commands/index.js](../server/engine/commands/index.js) then collapses ~55% of deliberate
  commands into nonsense (mirrors the `blackedOutUntil` blackout gate). `sleep`/`rest` always pass —
  sleep is the only way to climb back out. The flag lifts with **hysteresis** at sanity 10, so 0→up
  doesn't flicker; the FX/phantoms fully tear down only once sanity climbs back to the clear band (≥50).

Client FX is its **own** channel (`sanity_fx` → a dark, desaturating overlay + `unhinged`/`insane`
body classes) so it composes with an active drug trip rather than fighting the psychedelic
`#trip-overlay`. All state is in-memory (mirrors trips); the plugin removes only the phantoms it
spawned (`sane_*`), never `clearPhantoms` (which would wipe a concurrent trip's phantoms), and resets
cleanly on death/logout.

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
  18% HP / 15% sanity / 50% stamina of *missing* per minute); a `sanctuary`-tagged zone or someone's
  unlocked apartment → shallower (`SLEEP_RESTORE_SAFE_ZONE` = 8% / 5% / 35%); a zone that merely
  `allowsSleep` (e.g. a holding cell) → the same shallow restore but **no** sanctuary protection;
  anywhere else / a locked apartment that isn't yours → can't sleep. The `is_safe_zone` column was
  dropped WITHOUT conversion, so sleeping in the open requires a deliberately-tagged `sanctuary`.
- **Per minute asleep:** restore a slice of missing HP/sanity/stamina (stamina fastest — a good
  sleep leaves you rested well before your wounds knit or your head clears), drain 1 hunger + 1 thirst.
- **Auto-wake** on any of: fully rested (HP **and** sanity **and** stamina full), hunger or thirst ≤ 5,
  or 30 minutes slept (`SLEEP_MAX_MINUTES`).
- Any command other than `sleep`/`rest` wakes the player and is then executed (`commands/index.js`).

## Bodily pressure

Owned by the **bodily plugin** ([plugins/bodily/index.js](../plugins/bodily/index.js)) — its own 1m
tick, skipping sleeping players. The engine keeps only the substrate half in
[bodily.js](../server/engine/bodily.js): stains (`stainClothing`/`stainZone`) and the digestion loads
(`foodLoad`/`drinkLoad`/`applyThirst`) that eating/drinking/drugs feed.

Two hidden float columns on the `players` row — `digestive_load` (bowel) and `hydration_load` (bladder) — accumulate as the player eats and drinks:

- **Eating:** adds `restoreHunger × 0.5` digestive load (the `consumable` path **and** drugs that restore hunger).
- **Drinking:** adds `restoreThirst × 0.6` hydration load (the `consumable` path **and** drugs that restore thirst).
- **No natural decay.** Waste doesn't evaporate by waiting: load only rises with intake and falls when you relieve yourself (or overflow).

**Threshold messages** (80–110) fire occasionally — every 3 minutes — as private ambient descriptions of increasing urgency, randomly selected from flavour pools. From digestive 60 an **involuntary fart** rolls each minute (~2%/min at 60 ramping to ~20%/min by 110) as a zone-audible warning. At >110 an **involuntary release** occurs with a zone-visible ambient message (no source attribution) and a dump to 0.

`foodLoad(restoreHunger)` and `drinkLoad(restoreThirst)` are exported so the `use`/`eat`/`drink` path can apply load at the same time as it applies the hunger/thirst restore.

**Hygiene** rides the same plugin. MIS `wash` (at a sink, a one-liner) and the bodily **`shower`** verb (gated on a shower fixture — `object_type='shower'`/`flags.shower`) clear accumulated grime. `shower` is the luxurious superset: a **~15s timed ritual** of hot-water beats that, on completion, wipes `clothing_contamination`, bare-skin `soiled_state`, dried `ejaculate_state`, and `covered_in_blood`, plus a brief cosmetic `refreshed` badge (~180s). Leaving mid-shower aborts it with no clean. See the **bodily** row in [plugins.md](plugins.md).

## Body temperature & thermal comfort

`players.body_temp_c` (float, initialised to `37.0` on login in [index.js](../server/index.js)), drifted once per minute by `resourceTick` in [gameLoop.js](../server/engine/gameLoop.js) for each awake player. Clamped to **25–45°C** and rounded to one decimal. This is an **engine** system; the clothing fields it reads (`player.insulation`, `player.exposurePenalty`) are derived by `recomputeInsulation` in [inventory.js](../server/engine/commands/inventory.js), and the wetness field it reads (`player.wetness`) is owned by the clothing-wetness plugin (see below). The three must agree on those field names.

**Ambient the body drifts toward.** `getZoneApparentTemperature(zoneId, tempOffset)` in [environment.js](../server/engine/environment.js) — the "feels like" temperature (diurnal + per-tile weather offset outdoors, or a stored interior temp indoors; wind chill + humidity folded in outdoors only). See the apparent-temperature detail in [systems-world.md](systems-world.md); the temperature tick does not re-derive the curves. A **submerged** swimmer (`player._submerged`, owned by the swimming plugin) drifts toward `waterTemperature(zone)` instead and counts as fully wet regardless of gear — see [systems-swimming.md](systems-swimming.md).

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

[effects.js](../server/engine/effects.js) is a data-driven registry that ticks every second.
`registerStatusEffect({ name, label, onTick })` is the extensibility seam — the engine ships
`bleeding` / `burning` / `irradiated` / `choking`, and plugins add their own (`refreshed`, `sick` in
bodily; `exhausted` in weightbench; `drowning` in swimming). `applyEffect(player, name, ticks)`
applies or refreshes one; the per-second tick persists and broadcasts hp/stamina whenever an effect
changes them.

Live callers: `resourceTick` applies `choking` to unmasked players outdoors during `ash` weather (see
[systems-weather-extreme.md](systems-weather-extreme.md) §4) — it drains stamina (−4/s), then HP
(−2/s) once winded — plus the plugin effects above. Nothing applies `irradiated`; weapon
`status_chance` and drug overdose are still unwired.

## Reading it back — the Vitals app

Every meter above is surfaced in one place: the Tablet OS **Vitals** app
([plugins/tablet/health-app.js](../plugins/tablet/health-app.js)), reached from the tablet home
screen or the `vitals` / `health` verbs (with an optional tab: `vitals apothecary`).

It owns **no** survival logic and must not grow any — it is a window onto sources that already exist
(the live player object, `conditionReport`, `statusLabels`, `getDrugStatus`, `hygieneOf`, the
sanity/intoxication plugins). Three tabs:

- **Vitals** — the meters (HP, sanity, stamina, hunger, thirst, radiation, core temp, fatigue, and
  intoxication once it's above zero), then *everything currently dragging on you*: active status
  effects, each stat penalty `conditionReport` is charging and why, live phased drugs with their
  phase and time remaining, withdrawal (biting, or a countdown to it), blood and hygiene. Above it, a
  quick-remedy strip that appears **only** for a meter that's actually deficient and **only** when
  you're carrying the answer.
- **Apothecary** — the medical/chemical subset of the inventory (anything joined to a `drugs` row, or
  tagged with one of the `restore_*` / `heal_over_time` / `laced_drug` keys), collapsed one row per
  item type, each with a derived effect line and a Use button.
- **Substances** — per-drug tolerance, dependency, time since last dose, and `doses_in_system`
  against that drug's tolerance-scaled overdose ceiling. This is the screen that makes the relapse
  law legible before it kills you rather than after.

The one mutating action routes through the engine's own `cmdUse`, so a dose taken from the tablet is
identical to one typed at the prompt — the `consume` plugin's timed drinking, route of
administration, tolerance, addiction and lethal overdose all behave exactly as they do at the prompt,
and the app never learns about the death path because `cmdUse` already owns it.
