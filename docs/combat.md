# Combat (As Built)

This documents the combat system **as it currently runs in the engine**, file by file. It is
distinct from [combat-and-stats-plan.md](combat-and-stats-plan.md), which is the agreed *future*
scope (continuous skills, IP-funded stats, per-part typed soak). Much of that plan is already
shipped; where the running code diverges from the plan, this file is the source of truth.

Primary files: [combat.js](../server/engine/combat.js) (combat math, cooldowns, enemy swings),
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
margin = (attackerHit − defenderDodge) + swing
hit = margin >= 0
```

- **Player → enemy:** `attackerHit = effectiveSkill(player, weaponSkill)`; `defenderDodge = enemy.dodge`.
- **Enemy → player:** `attackerHit = enemy.hit`; `defenderDodge = effectiveSkill(player, 'dodge')`.

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
armour — replacing the old single monster-wide `soak`/`armor` (still read as a fallback for
monsters with no `body_parts`).

The player's struck part maps to an armour slot via `PART_TO_SLOT`: head→head, torso→torso,
arms→hands, legs→legs, feet→feet. The low-weight `feet` part (weight 4) lets the `feet` armour
slot's typed soak actually reduce damage when the feet are struck.

### Soak (armour)

Players carry a per-slot soak structure on `player.soak`, built by `recomputeArmor()`
([inventory.js](../server/engine/commands/inventory.js)):

```
player.soak[slot] = { soak: { kinetic: N, thermal: N, ... }, flat: <legacy armor int> }
```

`resolveSoak(soakMap, damageType)`: if the map has the incoming damage type, use it in full;
otherwise reduce by `max(other values) × soak_mismatch_factor` (0.25). Enemies use a typed `soak`
map if present, else the flat `armor` integer.

> **Known bug:** `recomputeArmor()` is only called at login ([index.js:395](../server/index.js)).
> Equipping or unequipping armour mid-session updates the DB but **not** `player.soak`, so armour
> changes have no combat effect until the player reconnects. See [qa-audit-2026-06.md](qa-audit-2026-06.md).

## Weapons

`resolveAttack()` ([plugins/weapon/index.js](../plugins/weapon/index.js)) reads the one equipped
item tagged `weapon` and pulls `damage` (`{min,max}`), `weapon_skill`, `damage_type`, `status_chance`
from its tags. Unarmed default: 2–4 kinetic, `brawling`. `status_chance` is read but **never used**
(no code applies a weapon-triggered status effect — see the effects note below). Monsters carry
their own `weapon` instead: a JSONB list of `{type, min, max}` damage components edited in the
dev panel (falling back to the legacy `damage_min/damage_max` + `flags.damage_type` if empty).

## Cooldowns

In-memory per-player map (`combat.js`), keyed by action:

| Action | Cooldown |
|--------|----------|
| `attack` | 3500 ms |
| `flee` | 4000 ms |
| `use_item` | 2500 ms |

Attacking while on cooldown returns a "still recovering" message. Cooldowns live in process memory
only; they reset on server restart.

## Enemy AI & the combat tick

The 1-second tick (`gameLoop.js`, raw `setInterval`, deliberately not on the scheduler) drives all
enemy behaviour:

1. **Acquire:** an untargeted `aggressive`/`territorial` enemy picks a random player in its zone.
2. **First-strike delay:** if the enemy's `flags.first_strike_delay_ms` is set, it hesitates that
   long after aggro before its first swing (flavour for skittish/lumbering enemies).
3. **Attack pacing:** `enemyAttackPlayer` only swings if `now − lastAttack >= enemy_attack_interval_ms` (tunable, default 4000 ms). The old `stat_agi`-derived interval is gone.
4. **Auto-retaliate:** if the player survives and is off attack-cooldown, they automatically swing back
   at the attacker.

> **Known issues** (see the QA report): the attack-interval formula has no lower clamp (`stat_agi ≥ 34`
> ⇒ attacks every tick); and `handlePlayerDeath` has no re-entrancy guard, so two same-tick lethal hits
> can run respawn twice. (`combatTargetId` tracking and retaliation focus-lock are now fixed.)

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

On a hit, `resolveAttack` awards skill use. **Note:** it remaps the weapon skill to one of
`bladed` / `electronics` (when `weapon_skill === 'energy'`) / `brawling` — so `firearms` and
`explosives` are never trained through attacks even if a weapon declares them. `awardSkillUse`
(`skills.js`) rolls for an IP award on a successful hit — best odds on a barely-won check (margin ≈ 0),
falling off as the margin grows — and on a hit adds 1 IP to the skill (`awardIp`).

## Status effects (defined but inert)

[effects.js](../server/engine/effects.js) defines `bleeding` (−2 HP/tick), `burning` (−5 HP/tick),
and `irradiated` (+2 RAD/tick), and `tickEffects()` runs every second from the game loop. However,
**`applyEffect()` has no callers anywhere in the codebase** — nothing in combat, weapons, drugs, or
the environment ever starts an effect. The system is wired to tick but can never be triggered. See
the QA report.

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
