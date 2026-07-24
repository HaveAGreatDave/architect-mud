# Combat (As Built)

This documents the combat system **as it currently runs in the engine**, file by file. It is
distinct from [combat-and-stats-plan.md](combat-and-stats-plan.md), which is the agreed *future*
scope (continuous skills, IP-funded stats, per-part typed soak). Much of that plan is already
shipped; where the running code diverges from the plan, this file is the source of truth.

Primary files: [combat.js](../server/engine/combat.js) (combat math, cooldowns, enemy swings),
[stance.js](../server/engine/stance.js) (stance substrate: the modifier table, the dodge window, swing flavour),
[plugins/weapon/index.js](../plugins/weapon/index.js) (**player-initiated combat** — target resolution,
player swing, kill/corpse handling, sleep-kills), [commands/combat.js](../server/engine/commands/combat.js)
(loot; `steal` lives in [plugins/thievery](../plugins/thievery/index.js)), [gameLoop.js](../server/engine/gameLoop.js), [skills.js](../server/engine/skills.js),
[tunables.js](../server/engine/tunables.js). The gameLoop's 1s auto-attack tick reaches the plugin's
swing functions through `registerPlayerCombat` (engine combat.js) — raw function references injected at
plugin load, never the Action dispatcher (ADR-0001).

## To-hit

Both directions use the same shape (`combat.js`): a flat hit-vs-dodge comparison
plus a symmetric dice swing.

```
swing = 2d8 − 2d8 (range −14..+14; ~40% within ±2)
margin = (attackerHit − defenderDodge) + swing + darknessPenalty
hit = margin >= 0
```

- **Player → enemy:** `attackerHit = effectiveSkill(player, weaponSkill) + stanceHit`; `defenderDodge = enemy.dodge`.
- **Enemy → player:** `attackerHit = enemy.hit`; `defenderDodge = effectiveSkill(player, 'dodge') + stanceDefense`.

`stanceHit` / `stanceDefense` come from the player's combat stance (below). Stance defense is added to
the **defender's dodge term**, never to soak — so it also lowers the rate at which you get critted,
since crit is `margin >= crit_threshold`.

### Darkness penalty

`darknessHitPenalty` (`combat.js`) subtracts **1 to-hit per light-ladder step dimmer than `clear`**,
bottoming out at −5 in pitch dark; `clear`/`bright`/`blazing` give no penalty (and no bonus — darkness
only ever hurts). The step comes from `getZoneVisibility(zone).category` on the 8-step ladder
(`pitch_dark→murk→dark→gloomy→dim→clear→bright→blazing`) via `lightHitPenalty` (`environment.js`). It is
applied **from the attacker's own perceived light**: player-initiated swings (`playerAttackEnemy`,
`playerAttackNpc`, `pvpSwing`) run the `visibility.perceive` hook first, so a lit flashlight cancels the
penalty for that attacker; monster/NPC swings (`enemyAttackPlayer`, `npcAttackPlayer`) eat the raw zone
darkness. Mob-vs-mob paths (`enemyAttackNpc`/`enemyAttackEnemy`) apply the raw zone darkness too, so
every combat direction respects the light level.

`effectiveSkill = skill level (floor(player_skills.ip/100), 0–10) + average of the skill's governing stats` (`skills.js`). It can exceed 10.
There is no `dodge_base` term any more — `dodge`/`effectiveSkill('dodge')` is the whole defense value.
Monsters use a simplified pair of integer ratings, `hit` and `dodge` (both default 1); their old
`stat_str/stat_agi/stat_end` columns are no longer read.

## Damage

Player weapons are still a single typed roll. **Monster** attacks are a list of typed
components (e.g. `1–2 kinetic` + `2–3 energy`), each rolled, boosted, and soaked on its own,
then summed:

```
// player → enemy (single component)
damage = random int in [damage_min, damage_max]
if critical: damage = floor(damage × crit_multiplier)   // crit when margin >= crit_threshold
if struck part == head: damage = floor(damage × head_damage_multiplier)
damage = max(1, damage − enemyPartSoak(struck part, damage_type))

// enemy → player (multi-component)
for each component {min,max,type}:
  amt = random int in [min,max]
  if critical: amt = floor(amt × crit_multiplier)
  if struck part == head: amt = floor(amt × head_damage_multiplier)
  total += max(0, amt − playerPartSoak(struck part, component.type))
damage = max(1, total)
```

Tunable defaults (`tunables.js` / `combat.js`): `crit_threshold = 8`, `crit_multiplier = 1.5`,
`head_damage_multiplier = 1.5`, `soak_mismatch_factor = 0.25`.

### Body parts

`rollBodyPart(weights?)` does a weighted pick. The player (the defender when a monster swings)
uses the global `body_part_weights` tunable
(default `head:10, torso:40, left_arm:12, right_arm:12, left_leg:11, right_leg:11, feet:4`). A **monster**
(the defender when a player swings) uses its own `body_parts`: a list of `{part, weight, soak}`
entries editable per-monster in the dev panel, defaulting to that same standard spread. Each entry
carries its own typed `soak` map, so a monster soaks the player's hit against the struck part's
armour — replacing the old single monster-wide `soak`/`armor`. A monster with no `body_parts`
soaks **nothing** (`enemyPartSoak` returns 0 — there is no flat-armor fallback).

arms→hands, legs→legs, feet→feet. The low-weight `feet` part (weight 4) lets the `feet` armour
slot's typed soak actually reduce damage when the feet are struck — surfaced per-region in the
`gear` screen.

### Soak (armour)

Players carry a per-slot soak structure on `player.soak`, built by `recomputeArmor()`
([inventory.js](../server/engine/commands/inventory.js)):

```
player.soak[slot] = { soak: { kinetic: N, energy: N, ... } }
```

Soak comes only from the `armor_soak` tag on equipped pieces; the old flat `armor` int is gone.
`resolveSoak(soakMap, damageType)`: if the map has the incoming damage type, use it in full;
otherwise reduce by `max(other values) × soak_mismatch_factor` (0.25). Enemies use their own typed
`soak` map (from `body_parts`), or take full damage if they have none.

`recomputeArmor()` runs at login and again on every equip, unequip, and bulk-drop
([inventory.js](../server/engine/commands/inventory.js)), so armour changes take combat effect
immediately.

## Weapons

`resolveAttack()` ([plugins/weapon/index.js](../plugins/weapon/index.js)) reads the one equipped
item tagged `weapon` and pulls `damage` (`{min,max}`), `weapon_skill`, `damage_type`, `status_chance`
from its tags. Unarmed default: 2–4 kinetic, `fists`. `status_chance` is read but **never used**
(no code applies a weapon-triggered status effect — see the effects note below). Monsters carry
their own `weapon` instead: a JSONB list of `{type, min, max}` damage components edited in the
dev panel; if empty, the fallback is a fixed `1–3` strike typed by `flags.damage_type` (default
`kinetic`) — the legacy `damage_min/damage_max` columns are not read.

## Stances

`fight <stance>` (weapon plugin) is the risk/reward dial. Five stances, prefix-matched
(`fight cau`), on a **60 s cooldown that applies to every change including back to `normal`** —
otherwise berserk would have no downside, since you'd tap out the moment it hurt. Bare `fight`
reprints your current stance without burning the cooldown.

| Stance | Hit | Speed | Defense | Swing | `pow` cost |
|---|---|---|---|---|---|
| berserk | −3 | −1000 ms | −2 | **2500 ms** | 3750 ms |
| aggressive | +1 | −500 ms | −2 | **3000 ms** | 4500 ms |
| normal | 0 | 0 | 0 | **3500 ms** | 5250 ms |
| cautious | +2 | +500 ms | +1 | **4000 ms** | 6000 ms |
| pacifist | −1 | +1000 ms | +4 | **4500 ms** | *blocked* |

`speed` is a flat **millisecond delta on the swing timer**, not a multiplier and not a per-weapon
term — **there is still no weapon speed in the engine**. `swingInterval(player)` (`stance.js`) is the
single seam a future per-weapon speed would enter.

Stance persists across sessions in `player_flags.combat_stance`, but is read from the **live player
object** (`player.combat_stance`) on every roll — `getFlag()` is a DB round trip and can never live in
a to-hit path, so login is the one place it's fetched. Death resets you to `normal` and clears the lock.

Stance also swaps the **verb** on your swing lines (`tear into` / `drive into` / `strike` / `jab at` /
`clip`) and the miss line. Only the verb clause changes — the damage/part/type spans are byte-identical
across stances, so the client CSS and the `combat` dispatch handler need no stance awareness.

## Active moves — `pow` and `dodge`

Both draw on **one shared 10 s `combat_move` cooldown**: every 10 seconds you pick offense or defense,
not both.

- **`pow` / `power` `[target]`** — 250 % damage. It is a **wind-up, not a swing**: it arms the flag
  and **resets the swing timer** to 1.5× the stance interval, discarding whatever progress the
  current swing had. The blow then lands through the ordinary auto-attack path. Blocked in
  `pacifist`. Bare `pow` re-aims your current target; a named target routes through `cmdAttack`'s
  SIFT resolution rather than duplicating it. The multiplier lands after crit and before the head
  bonus and soak. A crit and a pow render **one** `CRITICAL POWER` badge, never two.

  It deliberately does **not** require being off the attack cooldown. In sustained combat that
  cooldown is almost always running — the gameLoop swings the instant it lifts — so gating on it
  made the move very nearly unreachable. The 1.5× is charged **once**, up front as the wind-up
  (`powWindupMs`); the swing that eventually lands charges only the plain stance interval, or the
  move would cost 3× a swing instead of 1.5×.
- **`dodge`** — +5 defense for 5 s **or until the next attack attempt against you resolves**,
  whichever lands first. Blocked in `berserk`. The "you cannot attack for the duration" half is
  enforced by setting the *attack* cooldown to the same 5 s window, so `cmdAttack` refuses with its
  existing "still recovering" line and all four gameLoop auto-attack loops skip on their own — no new
  guard anywhere in the tick. Consuming the window early lifts that attack lock with it.

`pow` is a **one-shot flag** (`player._powQueued`), armed by the plugin and consumed by the engine
swing functions — and consumed *after* every early return, so a swing that never happened doesn't eat
the move. It must be consumed rather than read: `resolveAttack` rebuilds `weaponStats` on every swing
including auto-attack ticks, so a flag that merely persisted would turn the whole auto-attack loop
into power attacks.

## Contested flee

Walking out of a fight is no longer free. Both directions use the same shape as every other roll here:

```
margin = (fleeRating − 1 − attackerHit) + 2d8−2d8      // the −1 is the cost of turning your back
```

**Player side** — a move gate registered by the weapon plugin (owner `weapon:flee`;
`tests/regress.js` asserts on `getRegisteredMoveGates()`). `fleeRating = effectiveSkill(dodge) +
stanceDefense`, contested by the **toughest thing currently attacking you** (`toughestAttacker`).
"Being attacked" means an enemy/NPC has locked onto you or a player holds you as a PvP target —
deliberately *not* "you are attacking something": you can always walk away from a passive target.

An attempt **costs a full attack cycle** whether it lands or not, which is what makes it interrupt
your attack — the auto-attack loops never get a spare cycle while you're breaking away, so no guard
is needed in the tick. On failure the direction is remembered as `player._fleeIntent` and retried once
per cycle from the gameLoop; the retry moves with `opts.fleeing` so it can't re-enter the gate and
roll twice. Intents expire after 15 s and are cleared by `stop`/`disengage` and by death.

The `flee [direction]` verb (the one the client smartbar has advertised all along, hitting nothing
server-side until now) just routes into ordinary movement — the gate is what makes it cost something.
Bare `flee` picks a random exit.

**Mob side** — the same contest, enforced in **`moveEntity`** (`ai-behaviour.js`), the single writer
for every enemy/NPC tile change. It lives there rather than in the AI's `FLEE` node because gating
only FLEE would leave `ROAM`, `PATROL`, and the commute paths free to stroll a wounded enemy out of
the room mid-swing. `fleeRating = flags.flee_skill ?? dodge`. Throttled to one attempt per attack
cycle via `entity._fleeNextAt`.

Only a **deliberate** flee announces a failure ("scrabbles for a way out but can't break away!") —
an incidental roam/patrol step that bounces off the gate stays silent, or a mob you're fighting would
spam the room every time its wander timer came up. The `FLEE` node passes `{ deliberateFlee: true }`
and skips its own legacy `FLEE_DIFFICULTY 6` roll when a player is pressing (that roll now covers only
mob-vs-mob).

`moveEntity` is synchronous and can't await `effectiveSkill`, so the attacker's rating is read from
`player._lastAttackSkill`, stamped by every real player swing. A mob is only ever gated while a player
is actively attacking it, so the value is always present by then.

## Cooldowns

In-memory per-player map (`combat.js`). The **duration is stamped at set time** rather than looked up
at read time, because the attack cooldown is now per-player and variable (stance speed, pow's 1.5×,
the dodge lock) while the ~8 `isOnCooldown(id,'attack')` readers across `gameLoop.js` and the weapon
plugin have no stance in hand — changing the writer keeps every reader untouched.

| Action | Cooldown |
|--------|----------|
| `attack` | 3500 ms **base**, ± stance speed (2500–4500); reset to ×1.5 by a `pow` wind-up, = 5000 while dodging |
| `use_item` | 2500 ms |
| `shove` | 60000 ms |
| `stance` | 60000 ms |
| `combat_move` | 10000 ms (shared by `pow` and `dodge`) |

`clearCooldown(playerId, action)` ends one early — used when a dodge window is spent before its 5 s
runs out. Attacking while on cooldown returns a "still recovering" message. Cooldowns live in process
memory only; they reset on server restart. (The old dead `COOLDOWNS.flee = 4000` entry was removed —
it had no readers, and fleeing now costs an attack cycle rather than its own timer.)

## Enemy AI & the combat tick

The 1-second tick (`gameLoop.js`, raw `setInterval`, deliberately not on the scheduler) drives all
enemy behaviour:

1. **Acquire:** an untargeted `aggressive`/`territorial` enemy picks a random player in its zone.
2. **First-strike delay:** if the enemy's `flags.first_strike_delay_ms` is set, it hesitates that
   long after aggro before its first swing (flavour for skittish/lumbering enemies).
3. **Attack pacing:** `enemyAttackPlayer` only swings if `now − lastAttack >= enemy_attack_interval_ms` (tunable, default 4000 ms). The old `stat_agi`-derived interval is gone.
4. **Auto-retaliate:** if the player survives and is off attack-cooldown, they automatically swing back
   at the attacker.

> **Known issue** (see the QA report): `handlePlayerDeath` has no re-entrancy guard, so two same-tick
> lethal hits can run respawn twice. (`combatTargetId` tracking and retaliation focus-lock are now fixed.)

## On kill

`playerAttackEnemy` resolves loot via `resolveEnemyLoot` (per-entry `weight` is a 0–100 percent roll;
`qty` may be a `[min,max]` range). `resolveAttack` (weapon plugin) then:

- creates a corpse via `createCorpse()` ([world.js](../server/engine/world.js)) carrying the enemy's
  `butcher_table`/`butcher_difficulty` (1h expiry),
- inserts each loot drop into `player_inventory` under the **corpse id** — loot stays ON the corpse
  until a player loots it via the loot GUI (`loot <corpse>` or the corpse link),
- broadcasts a zone kill event with a clickable corpse link, and emits `enemy.killed`
  (or `enemy.attacked` on a non-lethal swing) — quest objective tracking hangs off these.

`xp_reward` and `credit_reward` no longer apply — enemies grant no direct XP or credits on death.
(Advancement comes from *using* skills: IP earned per skill use, and 1 XP per IP — see
[systems-economy.md](systems-economy.md). A future quest reward could grant XP directly via `grantXp`,
but the `enemies.xp_reward` column is not that path.) Both fields are dropped from the dev panel and
no longer read by the engine; the columns linger in the DB but are vestigial.

> Looting an **empty-but-butcherable** corpse dispatches the `BUTCHER` Action straight into the
> [butchering plugin](plugins.md) (the coupling is purely through the action registry). The `loot`
> command also falls back to looting a **sleeping or offline player** in the zone via
> `cmdLootCorpse`/`resolveCorpseOrPlayer` (see below).

### Looting a sleeping player (Deception-gated)

`cmdLootCorpse` selects `offline_sleeping` targets and, when the target is `sleeping || offline_sleeping`,
routes through `attemptSneakyLoot`. If any **awake witnesses** are present (`getZonePlayers`, excluding
self / target / other sleepers) the deed is broadcast and gated on `skillCheck(player, "deception", 4 + 3 × witnesses.length)`
(with `awardSkillUse`); failure aborts with an emote and does **not** open the loot view. With no
witnesses it proceeds silently. This is the sneaky-loot seam the future Crime System will own.

## Skill gain from combat

On **every swing — hit or miss** — `resolveAttack` awards weapon-skill use. The `weapon_skill` tag is
the combat skill id directly (`fists` / `blades` / `clubs` / `firearms` / `science`, validated with a
`fists` fallback via `weaponSkillId()`), so the skill the weapon declares is the skill that trains.
Defending trains **Dodge**: `enemyAttackPlayer` / `npcAttackPlayer` / `pvpSwing` award the defender
Dodge on **every miss**. `awardSkillUse` (`skills.js`) rolls for a 1-IP award via `awardIp` — best odds
when the check is close (margin ≈ 0) and falling off with the **absolute** margin, so barely-*failing*
trains you nearly as well as barely-winning.

## Status effects

[effects.js](../server/engine/effects.js) defines `bleeding` (−2 HP/tick), `burning` (−5 HP/tick),
`irradiated` (+2 RAD/tick), and `choking` (−4 STA/tick, then −2 HP/tick once winded), and
`tickEffects()` runs every second from the game loop. The only live caller of `applyEffect()` today
is the ashfall hazard (`gameLoop.js` applies `choking` outdoors in ash weather — see
[systems-weather-extreme.md](systems-weather-extreme.md)). Nothing in combat, weapons, or drugs
starts an effect yet — weapon `status_chance` remains read-but-unused.

## Player death

`handlePlayerDeath` (`gameLoop.js`) full-restores the body (HP/sanity to max, hunger/thirst to 100,
radiation 0), clears sleep, moves the player to `anchor_zone` (default `zone_start`), and broadcasts a
randomized clone-vat death message. Skills/IP live in separate tables and are untouched — death costs
you the run, not your progress.

## Client message contract (combat & loot)

The server→client protocol has no schema; this is the contract for the combat/loot messages.

**Canonical vitals rule:** any message that mutates player vitals carries them in a nested
`player_update` object, and the client applies it uniformly via
`Object.assign(state.player, msg.player_update)`. Do **not** send flat top-level vitals fields
(`hp`, `sanity`, …) on a new message — `combat_incoming` used to (carrying flat `hp`/`hp_max`) and
was realigned to `player_update: { hp, hp_max }`. Follow the canonical shape for anything new.

**The output pane must not get denser.** Auto-attack already prints a line every 2.5–4.5 s, so
stance, `pow`, `dodge`, and flee were built to **never add a line**. They decorate a line that already
exists, replace the swing line for that cycle, or live in the HUD. This works because all of them
consume your attack cycle — a flee attempt or a `pow` prints *instead of* the swing you'd have had.
Three fields on `combat` carry it:

- **`player_update`** — the `combat` handler applies it the same way `combat_incoming` does. Stance
  rides `player_update.combat_stance` to the HUD chip (`#stance-chip` / `#stance-chip-m`, both
  driven from `updateVitals`), so it is never re-announced in the pane. The chip is **hidden while
  the stance is `normal`** — the default and the no-op — so it only appears once you've actually
  committed to something. The mobile chip hides its whole `.mob-bar-row`, or an empty row is left.
- **`progressMs`** — attaches the existing `attachInlineProgress` countdown bar (the one butchering
  uses via `emote`'s `butcherMs`) to the dodge window and the wait for the next flee attempt.
- **`noRefresh`** — suppresses the debounced area-pane `look`. A line that changed nobody's HP
  (stance, dodge, a failed break-away) shouldn't repaint the room.

A spent dodge window decorates the *incoming* line rather than adding one: `— you slip aside` on a
miss, `(guard broken)` appended on a hit. An expired window prints nothing.

**Corpse links on a kill:** a `combat` message with `killed: true` puts the clickable corpse link in
its own `corpseLink` field (never embedded in `message`). The client renders `message`, then appends
`corpseLink`. Both the PvE (`resolveAttack`) and PvP (`offlineSleepSwing`) kill paths follow this.

**`player_death` has two variants.** The normal death (`gameLoop.js` `handlePlayerDeath`) carries
`{ message, respawn_zone, player_update }`. The offline "murdered in your sleep" wake path
(`index.js`) sends `{ message }` only — no `player_update`. This is intentional: the woken player
receives full state on their next `look`/reconnect, and the handler guards on `msg.player_update`
before applying it. `respawn_zone` is currently emitted but read by no client handler.

## Player baseline

New survivors start with every stat at **1** (raised further with XP via `raise`) and a flat **40 HP**
(`hp_max`). The migration floors all existing characters' stats at 1 and resets 100-HP characters to 40.
