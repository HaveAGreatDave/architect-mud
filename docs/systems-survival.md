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

### Sanity has no bar either — and no honest prose

**The sanity bar is hidden by default too, for the opposite reason.** Hunger and thirst lost their bars and *gained* plain banded lines that tell you exactly how hungry you are. Sanity gets no such replacement, deliberately: people losing their minds do not get a readout, and a reliable narrator would defeat the system it narrates. The **symptoms are the interface**, and they are built to be deniable — a whisper you might have imagined, a person who might have been there, a line somebody might actually have said.

`condition` still reports the Cool penalty ("rattled"), which is honest without being a gauge — the same deal temperature has always had.

The ladder is staggered *inside* the bands rather than aligned to them, so learning one threshold does not hand you a diagnostic, and each rung is **harder to verify than the last**:

| Sanity | Symptom | Can you check it? |
|---|---|---|
| < 50 | whispers (`.msg-dread`) | Yes — it is visibly its own channel. The one honest symptom. |
| < 42 | **misattributed speech** — someone genuinely in the room says something they didn't | Yes: ask them. |
| < 25 | phantoms — a person who isn't there at all | Yes: swing at them ([phantomWhiff](../plugins/trip/README.md)). |
| < 18 | **disembodied voices** — a name with nobody attached, from elsewhere in the world | Not in the moment. |
| < 12 | the room itself warps (`setRoomTransform`) | Nothing left to cross-reference. |
| < 7 | **dissociative episode** — the room stops being anywhere at all | No. |

**Dissociation** reuses the *sleep* machinery down to the `dream` templates, because an episode and a dream are the same place and a second implementation would mean a second set of wake paths to leak through. Same mind/body split: `current_zone` becomes the dreamscape while the body stays in the real room's occupant set — vacant, visible, lootable, killable. Rare and self-limiting (6 %/min, 12-minute cooldown, 1–2½ real minutes), never in combat, never while asleep.

> **The wake paths are the whole risk** — a missed one strands a player in a zone deleted under them. All five funnel through `endDissociation` (idempotent, so death and logout call it unconditionally): the episode's clock, sanity recovering, death, logout, and `wake`. And a dissociating player takes the **same `DREAM_VERBS` allowlist** a dreamer does — that gate is about standing in a transient room, not about sleep, and `drop` inside one orphans the item in the DB forever. See [systems-dreams.md](systems-dreams.md).

**On the voices.** [voices.js](../plugins/sanity/voices.js) emits through the *exact* wire format real speech uses — `formatChitchat`'s inline `style="color:var(--yellow)"` span for NPCs, `cmdSay`'s plain-text `say` payload for players — byte for byte, with no speaker id and nothing added. `sendToPlayer` is a unicast over the same `broadcast()` a room message uses and carries no zone, so the payload is indistinguishable from one the whole room received. The regression suite asserts the forgery against the real `formatChitchat` output, because the two formats it copies live in files that know nothing about it and could be "tidied" without anyone noticing on screen for weeks.

It never invents a speaker: misattribution uses somebody actually standing there, and disembodied voices use a real NPC who is provably elsewhere. A hallucination you cannot investigate is just noise.

### Reading hunger and thirst without a bar

**Hunger and thirst are off the HUD by default** (still one click away in the vitals edit mode, which already supported per-row hiding). Body temperature has never had a bar — you read it from `condition` and from banded prose — and hunger and thirst were the inconsistency, not the rule. A number also invites you to top up at 79 *because you can see 79*; prose makes eating a response to your own body instead of a chore against a gauge.

What replaced them lives in [appetite.js](../server/engine/appetite.js), and it is not the old warning with more words. The old implementation was one band each, fired **every single minute**:

```js
if (hunger > 0 && hunger <= 20) messages.push('You are very hungry.');
```

That is nagging, not information — it trains a player to skim past the one line that matters, and it left the entire 20-point runway to starvation undifferentiated. Three rules replaced it:

1. **Bands are unequal** — wide and silent at the top, narrow at the bottom. Danger is at zero, so that is where the resolution belongs.
2. **Cadence is the severity signal.** Repeat intervals tighten as the band worsens (hunger 35 → 22 → 14 → 8 → 4 game-minutes; thirst runs harder throughout because it drains faster and kills twice as fast). Urgency is *felt* in the rhythm, not only stated in the words.
3. **Crossing is an event.** Falling into a band speaks at once; sitting in it repeats on cadence; climbing out is silent **except** out of the two worst bands, where one line confirms you fixed it.

At **zero** the flavour goes quiet entirely and the damage line owns the moment — `Starvation is taking its toll. (-1 HP)` already fires every minute and says everything the flavour would. Two systems narrating one moment is exactly how the first draft reached four lines a minute; a full simulated starvation run went from **235 lines to 38** across seven game-hours.

**Satiation** is the half that never existed. `digestive_load` has always been there — eating adds `restoreHunger × 0.7` — but its only feedback was eventually needing the toilet, so a full stomach was a state the game could not express and portion sizes were unlearnable. Eating and drinking now report **where you ended up** rather than what the item was worth (`satiationLine` / `slakeLine`), which is the one thing a bar never could: how *full* you are, rather than how empty. The old `+20 Hunger.` receipt is gone; cooking's own quality line ("*Masterful, this one.*") still carries how good the meal was.

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
  scaling phased buff magnitude, hallucination intensity **and the stimulant fatigue relief** (below).
  Recovery is measured in **game** seconds (every site multiplies elapsed real time by `getTimeScale()`),
  and an undeclared rate falls back to `TOLERANCE_RECOVERY_PER_SEC` — **three game days** to shed a full
  habit, on the same axis as the fatigue curve. This was `1/3600` (one game *hour*), which quietly made
  tolerance meaningless for every drug that didn't override it: nobody held one long enough to feel a
  dulled high, and the relapse law had nothing to take away. `ADDICTION_RECOVERY_PER_SEC` is deliberately
  **twice** that span — dependency outlasts tolerance, and that gap (still craving it, no longer able to
  survive it) is the trap. The uppers override to ~1 game day so a stimulant habit is reachable inside a
  single bender.
- **Differential tolerance — the gap that kills a veteran.** `tolerance` is the **felt** one (dulls the
  high); **`player_drug_state.tolerance_lethal`** is the one that raises the overdose ceiling. They are
  separate because real tolerance is: euphoric tolerance builds fast, respiratory tolerance builds slowly
  and never fully, and the widening gap between "enough to feel it" and "enough to kill me" is what kills
  long-term users. Lethal gains at `LETHAL_TOLERANCE_GAIN_RATIO` (0.4) of the felt rate and fades at
  `LETHAL_TOLERANCE_RECOVERY_RATIO` (0.5) of it — **slow in, slow out** — so a deep habit is precarious
  rather than comfortable, and the relapse law bites from both ends. Both halves decay through the single
  `decayTolerances()` helper, so no caller can drift. Per-drug override: `tolerance.lethal_gain_ratio` /
  `lethal_recovery_ratio`; a psychedelic that can't stop your breathing should set the gain ratio to **0**.
  **The margin is surfaced in `habits`** (`toleranceGap` at 0.25 / 0.5) in the body's own words — a habit
  that silently narrowed your survivable dose would be a trap, not a system. Existing rows start at 0,
  which is the safe direction: a ceiling that has to be re-earned, never free headroom.
- **Overdose = death** — the ceiling is **`overdose_threshold × (1 + tolerance_lethal × 1.5)`**, computed
  from the **lethal** tolerance carried *into* the dose (post-decay, pre-gain). `classBurden` reads the same
  half for a cousin's ceiling — it is a question about what the body survives, not what it still feels. Tolerance therefore buys real headroom — and
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
- **Uppers vs. the fatigue clock** — a stimulant does not rest you, it **borrows**. While `isWired`,
  `tickDrugs` walks `last_slept_at` FORWARD at `STIM_FATIGUE_RELIEF` (12×) off elapsed real time and banks
  every millisecond of it on the in-memory `player._fatigueDebtMs`; the moment nothing is holding you up
  the whole bank is handed back at `STIM_FATIGUE_INTEREST` (1.25×) and the crash line prints. So speed is a
  real way to finish the night at a real price — before this an upper couldn't touch fatigue at all *and*
  `isWired` blocked the bed, making it strictly worse than water. It moves **`last_slept_at` itself** rather
  than masking the readout, so a wired player reads as less tired everywhere at once (stats, the Vitals
  rail, the sleep-deprivation bleed) with no second number to drift. Sleeping clears the debt — that's the
  honest way out of a bender. In memory only, deliberately: logging out sleeps you, which would clear it
  anyway.
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

### What you KNOW about a compound (`known_facts`)

A player learns a drug by **consequence, not by a counter**. `player_drug_state`
already tracked `times_used`, and gating on it would have been trivial — but
"you have taken this six times, here is its overdose ceiling" is a database
telling you a number. Learning that ceiling *because you went past it and your
body revolted* is the game teaching you something. So each fact has exactly one
way in, and it is the experience that fact describes:

| Fact | Bit | Earned by |
|---|---:|---|
| `FELT` | 1 | taking it and surviving |
| `EFFECTS` | 2 | riding a full **peak** (the come-up is scaled down; the comedown is it leaving) |
| `DURATION` | 4 | riding one out to its **natural end** — top up early and you never find out |
| `OVERDOSE` | 8 | actually going over the ceiling |
| `ADDICTION` | 16 | the moment dependency latches |
| `WITHDRAWAL` | 32 | withdrawal **biting** — mods applied, not merely a clock passing onset |

Stored as a bitmask on **`player_drug_state.known_facts`** — no new table, because
that table is already exactly per-player-per-drug. `learnDrugFact()` is a
fire-and-forget bitwise OR, so it is idempotent, race-safe, and never awaited on
the drug tick. Knowledge never decays: you do not un-learn what a bad night
taught you.

**The gate is server-side.** `getDrugStatus` returns `learned.*` as `null` for
anything unearned, so an unknown value never enters the payload at all — a number
the client is merely trusted not to render is readable in devtools, which is not
a secret. Asserted in `plugins/tablet/regress.js`.

The Substances tab is two questions in one screen: **On hand** (drugs in your
pockets, each marked `known` or `unidentified` — you can see you are carrying
something without being told what it does) and **Experience** (what has been
through you, and only the facts you have earned about it).

## Sanity — the slide into madness

`players.sanity` (0–100, `sanity_max` default 100). Nothing in the **sanity plugin**
([plugins/sanity/index.js](../plugins/sanity/index.js)) *drains* it — drugs (`instant.sanity`),
`restore_sanity` consumables, **sleep deprivation** (below) and sleep own the meter. The plugin owns only the **consequence**: a
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
- **Fully rested is a NOTICE, not a wake-up.** When HP, sanity and stamina are all full and fatigue is
  gone, the sleeper gets one green line saying so (and the `rested` buff is granted right there, the
  moment it's earned) — and keeps sleeping. Bedding down to skip a night must not be cut short by the
  body happening to finish topping up.
- **Auto-wake** on any of: hunger or thirst ≤ 5, the alarm, body temp ≤ 34 °C or ≥ 40 °C, or the
  backstop at 180 minutes slept (`SLEEP_MAX_MINUTES` — hunger/thirst almost always bite first).
- Any command other than `sleep`/`rest` wakes the player and is then executed (`commands/index.js`).

### Fatigue — the clock you're sleeping off

Lives in [condition.js](../server/engine/condition.js), **derived from `players.last_slept_at`** and never
stored as a meter: no per-tick write, it survives logout for free, and there is no second number to drift.

- **Measured in GAME hours, not real ones** (`fatigueSpanMs()` divides by `getTimeScale()`). Everything else
  the body does — hunger, thirst, tolerance, withdrawal — runs on the game clock; fatigue was the odd one
  out. At the standard 3× the whole scale is ~24 real hours.
- **The curve runs to THREE days, not one**, because it's written off what a person actually does: 12h up is
  nothing, 24h up is unpleasant and survivable, and it's the second and third nights that take you apart.
  `FATIGUE_FULL_HOURS = 72`; bands at `TIRED 50` (~36h), `EXHAUSTED 65` (~47h), `RUINED 85` (~61h). The stat
  penalties stay deliberately gentle (Brains first, then Reflexes, ≤2 points) — **the teeth are the sanity
  bleed**, not the stats.
- **Sleep deprivation bleeds sanity** past `FATIGUE_RUINED`, in `resourceTick`
  ([gameLoop.js](../server/engine/gameLoop.js)), ramped rather than flat: 1 sanity per 6 game-minutes at
  `RUINED`, per 3 above 93, per 1 above 99 — so the third night empties the meter in about half an hour of
  play and hands you straight to the sanity plugin's dread/hallucination bands. It reads `fatigueOf`, which
  a stimulant has already moved, so being wired genuinely holds the madness off and the crash genuinely
  brings it on. `sanity` rides the existing batched resource write rather than adding a round trip.
- **Logging off sleeps you.** Any disconnect sets `offline_sleeping`; login resets `last_slept_at`
  ([index.js](../server/index.js)) and mirrors it onto the live object. So fatigue only accrues within a
  continuous session — which is why the three-day curve is affordable.
- **Sleeping it off** is priced as an OUTCOME, `SLEEP_FULL_CLEAR_MINUTES = 5` real minutes for a full three
  nights, via `sleepRecoveryPerMinute()`. It replaced a fixed real-time ratio that silently cleared a full
  night in 1.6 minutes once the speed knob moved off 1×.

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

`players.body_temp_c` (float, initialised to `37.0` on login in [index.js](../server/index.js)), drifted once per minute by **`driftBodyTemperature`** in [gameLoop.js](../server/engine/gameLoop.js) for **every** player, awake or asleep. Clamped to **25–45°C** and rounded to one decimal.

This is an **engine** system, and it reads four fields it does not own — they must all agree on their names:

| Field | Owner |
|---|---|
| `player.insulation`, `player.exposurePenalty` | `recomputeInsulation`, [inventory.js](../server/engine/commands/inventory.js) |
| `player.wetness` | the clothing-wetness plugin (below) |
| `player._submerged` | the swimming plugin ([systems-swimming.md](systems-swimming.md)) — reroutes ambient entirely |

> **Sleep is not a shelter.** The drift was extracted into `driftBodyTemperature` precisely so the sleeping body runs the *same* equation: `resourceTick` used to skip a sleeper before it reached this code, which made sleep a total, free immunity to temperature — the canonical way to die of cold (falling asleep in it) was the one guaranteed way not to, and any blizzard was survivable by lying down. There is deliberately **no sleep-specific rate**; two copies of the equation would drift apart, and a bed's protection is simply that it's usually indoors. `tickSleep` wakes the sleeper at **34°C** (or 40°C on the hot side) — a full four degrees clear of the `<30°C` lethal threshold — which is the same courtesy hunger and thirst already extend. The drift uses `bodyZoneOf(player)`, not `current_zone`, so a **dreamer** freezes in the room their body is lying in rather than in the dreamscape their mind is visiting.

> **A roof is not always a shelter either.** `isIndoorZone` returns **false** for any zone flagged `open_sky`, even one that is `is_interior`/`is_building` — a roof, deck or helipad takes raw outdoor temperature, wind chill and precipitation. That is deliberate ("standing on the pad in a storm is standing in the storm", [systems-weather-extreme.md](systems-weather-extreme.md#1-thermal-siege-nearly-free)), and it is the one case where a player who believes they are inside is not.

**Ambient the body drifts toward.** `getZoneApparentTemperature(zoneId, tempOffset)` in [environment.js](../server/engine/environment.js) — the "feels like" temperature (diurnal + per-tile weather offset outdoors, or a stored interior temp indoors; wind chill + humidity folded in outdoors only). See the apparent-temperature detail in [systems-world.md](systems-world.md); the temperature tick does not re-derive the curves. A **submerged** swimmer (`player._submerged`, owned by the swimming plugin) drifts toward `waterTemperature(zone)` instead and counts as fully wet regardless of gear — see [systems-swimming.md](systems-swimming.md).

**Windproofing.** Wind chill is a property of the *zone*; a shell is a property of the *player*. `windChillDelta(zoneId, offset)` isolates the wind's share of the feels-like figure (by running the apparent-temperature curve at the real wind and at zero, so the humidity terms cancel), and the drift gives back `chill × player.windproof`. `player.windproof` is coverage-weighted — **torso 0.65, legs 0.35** — from the `windproof` item tag, so a shell over both cancels the chill entirely. Without this the chill was applied to the ambient *before* any clothing and bit a bundled-up player exactly as hard as a naked one, which is the opposite of what a shell is for. **Windproof is not insulation:** a shell over nothing still leaves you in the cold, and the tag is separate from `waterproof` because oilskin sheds rain and flaps in a gale while a windbreaker does the reverse.

**Wet insulation — "cotton kills".** Soaked clothing stops being clothing. Only the `hydrophobic` share of your insulation (`player.insulationWet` — wool, neoprene, sealed shells, wicking synthetics) survives a soaking; the rest is interpolated away on `player.wetness`, losing up to **80 %** of its value. Wetness *also* still multiplies the drift rate, and both are intended: wet skin conducts faster even through neoprene, so wet wool beats wet cotton and never matches dry. Before this, wetness was a rate multiplier that **never touched insulation**, so a soaked arctic parka insulated exactly as well as a dry one — the largest single inaccuracy in the model. Applies to both sides, since wet clothing traps less heat in a heatwave too.

> **`hydrophobic` is load-bearing for swimming.** Submersion pins wetness to 100, so a wetsuit without the tag would lose 80 % of its rating the moment you got in the water — i.e. stop being a wetsuit. Tag any garment whose material genuinely works wet.

**Metabolic heat.** A body is a furnace, not a rock — and this was missing entirely, so standing still and running were thermally identical.

| Source | Worth | Side | Cost |
|---|---|---|---|
| Walking (moved in last 2 min) | +3 °C | **both** | — |
| Running | +6 °C | **both** | — |
| Shivering | +4 °C | cold only | 2 stamina/min |
| Sweating | up to −7 °C | hot only | 2 thirst/min |

**Exertion appears on both sides with the same sign,** because a working body makes the same watts whichever way the weather is trying to kill it. That's what makes the optimal play *opposite* at the two extremes: keep moving in the cold, sit still in the heat.

**The two defences are mirrors, and both fail.** Shivering stops below **32 °C**; sweating stops above **41 °C** (anhidrosis — hot, dry skin, the classic sign that heat exhaustion has become heat stroke). Either way the defence quits and the drift steps up at exactly the worst moment. Both transitions are messaged, because otherwise the player experiences the jump as the game misbehaving. Note the flavour pool has said *"You're not sweating anymore. That's very bad."* since long before anything made it true; it is earned now.

**Sweat is evaporative, not a flat bonus** — it delivers `SWEAT_COOLING_C × efficiency`, where efficiency is the product of:

- **humidity** — `1 − RH/100`. Saturated air takes no more water, so sweat runs off and cools nothing. This is the wet-bulb story, and why humid heat kills at temperatures dry heat doesn't.
- **wind** — up to +50 %, the one place moving air is your friend, and the exact mirror of wind chill.
- **hydration** — throttles below 40 thirst, zero when you can't pay the 2/min. Dehydration doesn't just make you thirsty; it removes the thing keeping you alive.
- **breathability** — `1 − 0.5 × windproof`. A sealed shell is boil-in-the-bag: the same garment that saves you in a gale traps every drop against your skin in a heatwave. One real property, honestly cutting both ways.

Sweating also feeds the hygiene substrate's `_sweat` meter, which listed heat as a source from the start and never received it. And it is now the **only** thirst drain in the heat — the old flat "hot bodies get thirsty" tick was removed rather than left to double-count.

**Clothing offsets.** Two effective temperatures are computed from the ambient:
- `warmthTemp = effectiveAmbient + insulation − exposurePenalty + metabolicWarmth` — used on the **cold** side.
- `heatTemp = effectiveAmbient + insulation` — used on the **hot** side.

`recomputeInsulation(player)` sums the `insulation` tag value of every equipped item into `player.insulation` and sets `player.exposurePenalty = (torso covered ? 0 : 10) + (legs covered ? 0 : 5)` from the equipped items' `slot` tags. The exposure penalty is subtracted **only on the cooling side**, so bare skin makes the cold bite (torso dominant, legs secondary) but is a relief in the heat. `recomputeInsulation` (alongside `recomputeArmor`) is re-run on every equip/unequip and on bulk-drop of equipped items, so the fields stay current.

**Drift.** With `COLD_THRESHOLD = 10` and `HOT_THRESHOLD = 35`:
- **Cooling** (`warmthTemp < 10`): body temp falls by `driftRate(10 − warmthTemp) × wetMult` per minute, `wetMult = 1 + wetness/100` (soaked ≈ 2× faster cooling).
- **Heating** (`heatTemp > 35`): body temp rises by `driftRate(heatTemp − 35) × wetMult`, `wetMult = max(0.70, 1 − wetness × 0.003)` (being wet mildly slows overheating via evaporative cooling).
- **Comfort band** (neither): metabolic thermoregulation relaxes the core toward 37°C exponentially at `REWARM_BASE × mult` per minute, snapping to 37.0 within 0.1°C.

**Warmth is a gradient, not a door.** That rate used to be a flat `0.05` with `warmthTemp` nowhere in it — so a 20°C room, a 35°C sauna and a freezing corridor-with-a-good-coat all rewarmed you at identical speed. Being *warmer* than merely comfortable did nothing at all, and that, not missing content, is why the game had no fires, heaters, blankets or hot drinks: **there was no mechanic that would have rewarded authoring one.** A brazier would have been a decoration.

Recovery now scales with how far past the cold threshold you actually are:

| warmthTemp | multiplier | rate | 30 → 36.9 °C |
|---|---|---|---|
| 10 (barely in band) | 1.0× | 0.050 | 83 min |
| 15 (outdoors, coat) | 1.4× | 0.071 | 58 min |
| 22 (indoors, dressed) | 2.0× | 0.102 | 40 min |
| 30 (heated + winter gear) | 2.7× | 0.133 | 30 min |
| 34+ (cap) | 3.0× | 0.150 | 27 min |

The floor is the old constant, so barely-in-the-band is exactly as slow as it ever was; everything above it is new headroom that clothing, shelter and heat sources buy. Capped at 3× so a heat source is a strong advantage and never an instant reset. Note the gradient is only reachable **inside the comfort band** — push `heatTemp` past 35 and you are in the heating branch instead.

**Heat sources.** `registerHeatSource(fn)` in [environment.js](../server/engine/environment.js) is a contributor seam like the smell/sound gather hooks: `fn(zoneId, baseTempC)` returns °C to add, summed into `getZoneTemperature` so the drift, frostbite's peripheral skin temperature and the HUD thermometer all read one number. **In-memory only by contract** — a heat source is runtime state (a burning fire, a battery with charge in it), never a persisted zone flag. Its first consumer is [plugins/warmth](../plugins/warmth/README.md): battery-backed space heaters that *hold a room at* a target temperature (a thermostat, not a bonfire — self-limiting, and two of them are not twice as warm) and run 12 in-game hours off their own cell once the grid drops.

**Carried warmth.** `player._warmC`/`_warmMin`, applied by [warmth.js](../server/engine/warmth.js) and burned down by the drift so there is exactly one clock. Fed by the `warming` item tag (hand warmers) and by hot drinks, which scale it by how hot the cup still is. Cold side only — a mug of cocoa is ~40 kcal against 70 kg of body, so it honestly models a *defence* against cold rather than calories added.

### The drift curve

`driftRate(d) = DRIFT_COEFF × d^1.25`, where `DRIFT_COEFF` is *solved* so the rate at a 10° deficit is exactly `0.1125 °C/min`.

| Deficit | °C/min | 37 → 30 |
|---|---|---|
| 5 | 0.047 | 148 min |
| 10 | 0.113 | 62 min |
| 20 | 0.268 | 26 min |
| 35 | 0.539 | 13 min |
| 50 | 0.841 | 8 min |

**The exponent was 1.75, and that tail was the least realistic number in the model:** a 50° deficit (arctic air on bare skin) cooled 37→30 in three and a half minutes against a couple of *hours* in reality, while ordinary cold — where players actually spend their time — was only ~4× fast. The error was concentrated almost entirely in the extremes.

It is **1.25** now, for a reason rather than a nerf. The steep curve was standing in for something real — a body's defences collapsing as it loses — but that collapse *is shivering*, and shivering is now an explicit term (+4 °C, costs stamina, switches off below 32 °C). Modelling it twice was the mistake. With the compensation explicit, what's left below the threshold is a body whose defence is already saturated, which is close to Newton's law: heat loss roughly linear in ΔT, with a little steepening for radiative loss and failing vasoconstriction.

**Pivoted, not merely flattened.** Anchoring the coefficient at a 10° deficit leaves ordinary cold untouched — it was closest to right and is the case players meet most — so only the tail stretches. Extreme conditions roughly double in survival time: long enough to be a journey to shelter rather than a coin flip, still lethal. The one trade is that *very* mild cold (a 5° deficit) got somewhat faster, 209 → 148 minutes, which is the unavoidable other side of pivoting and makes a chilly night marginally less toothless.

**Effects of core temperature** (on `body_temp_c` after drift):
- **Danger HP loss:** freezing (`<30°C`) or overheating (`>42°C`) increments `player._dangerousTempTicks`; after **5 continuous minutes** it deals **−10 HP/min** (hypothermia / heat stroke message), floored at 0 and feeding `handlePlayerDeath`. Any non-dangerous tick resets the counter, so short spells don't kill.
- **Thirst drain:** owned entirely by **sweating** (2/min while sweating, and nothing once anhidrosis sets in — which is correct, and quietly the most sinister readout in the game). The old flat `>40°C` drain was removed rather than left to double-count.
- **Stamina:** freezing/overheating drain −3/min, cold (`30–34°C`) or hot (`40–42°C`) drain −1/min; otherwise passive regen of `floor(2 × tempRegenMultiplier(tempC))` — full regen in 36–38°C (and mildly-hot 38–40°C), tapering to 0 at `<30°C` or `>42°C`.
- **Flavour:** `tempFlavorMessage(tempC, tick)` emits banded ambient lines (chilly → shivering → hypothermia; warm → sweating → heat stroke), rate-limited by tick count so they don't spam. Silent in the 36–38°C comfort band.

`body_temp_c` is persisted each tick and pushed to the client in the `resource_tick` `player_update` whenever it changes.

**Frostbite** is the peripheral half, and lives in its own plugin — see [plugins/frostbite](../plugins/frostbite/README.md). Core temperature asks whether the body as a whole is winning; frostbite is what happens to the parts it *sacrifices* to keep winning, which is why a superb coat used to make −30 °C free. It reads the windproofed apparent temperature with **no credit for core insulation** (a parka does nothing for your fingers) scaled by `player.extremityExposure` (hands/feet/head, owned by `recomputeInsulation`).

**Deep frostbite is the only permanent injury in the game.** Frostnip and frostbite are circulation damage and thaw on their own; past 90 the meter latches a floor and thaws only *to* it, because dead tissue does not warm up and come back. A `treat_frostbite` field kit walks it back but can never clear it — only the clinic's `CLINIC_TREAT` lifts the floor, billed per stage at a higher rate than a wound precisely because it's the one line on the bill the patient couldn't have waited out. It penalises the hand; it never costs you the hand (amputation is deliberately out of scope).

## Water temperature

`waterTemperature(zoneId)` — what a submerged body drifts toward. An authored `flags.water_temp_c` wins outright; otherwise it's derived from the **climate month**, damped: `clamp(4 + monthlyMean × 0.5, 2, 24)`, with underwater tiles 5 °C colder and capped at 12 °C.

Seasonal but *lagging* — a body of water has enormous thermal mass, so it tracks neither the time of day (no diurnal term) nor today's weather anomaly (which wanders ±11 °C), only the monthly mean. In practice: ~5 °C in January, ~15 °C in July. It was previously a flat **12 °C / 7 °C year-round**, which made a midsummer swim exactly as lethal as a January one.

> **Zone flags here come from `world.zones`, not `state.zones`.** The environment's own zone map is a snapshot of the **power graph** and contains only zones belonging to a power zone — which no body of water does. Reading flags from it meant `flags.underwater` was never seen on any of the **82** underwater tiles: every dive silently used the surface temperature, the deep-water branch had never once executed, and an authored `water_temp_c` was dead. Fixed 2026-07-29; the same trap applies to anything else reading world flags out of `state.zones`.

## Clothing wetness & drying

The [clothing-wetness plugin](../plugins/clothing-wetness/index.js). This is a **plugin**, not engine code: its `tick.minute` hook walks every live player, updates per-item wetness, and writes the aggregate to `player.wetness` — the field the engine's temperature tick reads as `wetMult`. Wetness is stored **per item** in `player_inventory.custom_data.wetness` (0–100 integer, merged via a `jsonb ||` update only when the rounded value changes); `player.wetness` is the mean over equipped wettable items. Only items tagged **`gets_wet`** accumulate wetness.

**Sleepers are included** (rain doesn't check whether you're awake, and since the temperature drift now follows you into bed, exempting them would have re-created the immunity that change removed) — but they get no wetness *messages*; cold is what wakes them. Like the temperature tick, the hook reads `bodyZoneOf(player)`, so a dreamer's body gets rained on.

**Bare skin.** A player wearing nothing wettable is **not** simply dry. Skin wets at the same rate cloth does and dries `SKIN_DRY_FACTOR` (8×) faster — soaked to bone-dry in ~7 minutes at the outdoor base rate, against ~50 for a soaked coat — and it is held in RAM, not an inventory row, because nobody logs back in still damp. This used to be a flat `player.wetness = 0`, which read as "bare skin dries at once" (true, and what the submersion branch hands over to) but silently also meant *bare skin never gets wet*: a naked player in freezing rain took the full −15 exposure penalty and **none** of the ×2 wet multiplier, making stripping off a way to shrug off a storm.

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
