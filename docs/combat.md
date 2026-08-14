# Combat (As Built)

This documents the combat system **as it currently runs in the engine**, file by file, and it is
the source of truth for it.

*(This paragraph used to point at a `combat-and-stats-plan.md` holding the "agreed future scope".
No such file has ever existed in this repo — the July 2026 docs audit found it and recorded it as a
ghost link, and it survived the audit that found it. The scope it described — continuous skills,
IP-funded stats, per-part typed soak — has since shipped and is documented below, so there is
nothing left to link to. Design intent that hasn't shipped lives in
[design.md](design.md).)*

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
darkness. Mob-vs-mob paths (`enemyAttackNpc`/`enemyAttackEnemy`/`npcAttackEnemy`) apply the raw zone darkness
too, so every combat direction respects the light level.

**The attack matrix is now complete.** Every attacker/defender pairing has a function in
`combat.js`: `playerAttackEnemy` · `playerAttackNpc` · `pvpSwing` · `enemyAttackPlayer` ·
`enemyAttackNpc` · `enemyAttackEnemy` · `npcAttackPlayer` · `npcAttackNpc` · **`npcAttackEnemy`**.
The last of those is what makes an allied NPC possible at all, and it is the only one built from
*two* halves rather than one: the attacker side is `npcAttackNpc`'s (`flags.hit`, `flags.weapon`, the
shared `_lastAttack` cooldown), the defender side is `applyStrikeToEnemy`'s (authored body-part
weights, **typed soak**, the enemy damage observers). Skipping the second half is the bug where an
ally's blow cuts through carapace armour the player's identical blow cannot. **Kill credit is the
CALLER's** — pass `{ credit: player }` — so `combat.js` never learns what an ally is; the policy half
lives in [plugins/ally](../plugins/ally/README.md).

### Type effectiveness — what the target IS, not what it is wearing

`typeEffectiveness(target, damageType)` (`combat.js`) is a multiplier on the damage **roll**, applied
in every path that rolls damage: `playerAttackEnemy`, `enemyAttackPlayer`, `npcAttackPlayer`,
`npcAttackEnemy`, `pvpSwing`, `applyStrikeToPlayer`, `applyStrikeToEnemy`.

Today it answers for exactly one type. **`chemical` is a specialist**: full damage against a target
whose content says `flags.vermin`, and `chemical_nonvermin_scale` (default **0.3**) against anything
else — including every player, who have no `flags` at all. Currently flagged vermin: sewer roach,
printer roach, choke swarm, sewer rat, sewer bat.

Three decisions in that, worth reading before you extend it:

- **It is a multiplier, not soak.** Soak is subtractive and floored at 1, so a flat resistance number
  that reads as meaningful on a rat is a rounding error on a 95-HP boss.
- **Resistance is the DEFAULT and vulnerability is opted into.** Authoring `armor_soak: {chemical: n}`
  onto every enemy instead is 60-odd files today and a silent hole in every enemy added tomorrow.
- **It scales the value the injury seam scores, not just the HP loss** (`raw`/`gBase`/`pvpBase`, not
  `amt`), or a resisted blow would wound as hard as an effective one.

The point of the gate is headroom: with chemical meaning *specialist*, a later broad-spectrum agent
that ignores it is a genuine escalation rather than a bigger number.

⚠ An enemy keeps `dodge` as a top-level column; an NPC keeps it in `flags.dodge`. `enemyAttackEnemy`
reads `defender.flags?.dodge` against an enemy, which is why enemy-vs-enemy almost never misses. That
is a known bug, not a pattern to copy.

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

> **`feet` must stay in the authored `body_part_weights` tunable.** The DB value
> OVERRIDES the engine default rather than merging with it, and it shipped
> without a `feet` key — so feet were struck 0% of the time, the entire `feet`
> armour slot was decorative across six footwear items, and `aim feet` was a pure
> −7 penalty you could never collect on (`aimedWeights` returns the map unchanged
> when the part is absent). Restored to 4. Anything editing that tunable in the
> dev panel must keep every part it means to be reachable.

### Aiming (`aim`)

**Opt-in, and free to ignore.** The weighted roll above is the default and always sufficient. A
player may call their shot with `aim head` / `aim left leg` / `aim auto` (the verb lives in
[plugins/injury](../plugins/injury/index.js)); it persists until changed and **resets to auto on
login**, deliberately — it is in-memory only, with no flag write and no hydration path to go stale.

Aim **biases** `rollBodyPart`'s existing weights rather than adding a second targeting path
(`aimedWeights`): the aimed part takes ~70% of the pool and everything else keeps a quarter of its
weight, so a missed aim still lands somewhere and a creature lacking that part falls through to its
ordinary spread. The engine reads `player._aimPart` — a plain field armed by the plugin, the same
one-way shape `_powQueued` uses — so with the plugin absent, combat is byte-identical.

Cost is a to-hit penalty in margin units (`AIM_PENALTY`): head −8, feet −7, arms/legs −6, torso 0.
Weapon skill buys back `floor(skill/2)` down to a shared floor of **−2** — one legible rule: *a novice
pays the full anatomy cost, a master pays 2 for any shot they call.* Aiming is never free, or leaving
it switched on permanently would be strictly correct. Applied in **both** `playerAttackEnemy` and
`pvpSwing`.

Hit chance in an even matchup (unaimed baseline is **54%**):

| aim at | skill 1 | skill 3 | skill 6 | skill 12+ |
|---|---:|---:|---:|---:|
| centre mass | 54% | 54% | 54% | 54% |
| arm / leg | 12% | 23% | 30% | 38% |
| feet | 8% | 17% | 30% | 38% |
| head | 5% | 12% | 17% | 38% |

#### How a player finds out, and why it's a person who tells them

That table is the whole reason the discovery path is what it is. At skill 1 a called head shot lands
**5%** of the time, so "you can aim" is not a tip — handed over unqualified it is a way to make a new
player worse at the game with no way to see why.

So two things carry the caveat:

- **`aim` quotes YOUR cost, not the constant.** `aimReadiness()` in the plugin reads the equipped
  weapon's `weapon_skill`, the player's effective skill, and then calls **`aimHitPenalty` itself** —
  the same function the swing uses — so the number on screen is the number in the maths, and the
  trainer and the tool cannot drift. It reports one of three bands: *a gamble, not a tactic* /
  *already bought back N* / *as cheap as it ever gets*.
- **Grady teaches the verb** (`TEACH_AIM`, a dialogue action returning a `dialogue_line`, which is
  the seam that lets an NPC's spoken line carry a live `teachVerb` shimmer).

It used to be an ambient one-shot on your first durable wound, keyed on `player_flags.taught_aim`.
That fired at precisely the moment your skill was lowest — the verb was a trap exactly when the game
introduced it — and the "you're ready for this" wording was unreachable for anyone but a high-stat
build, since first-wound and first-training are the same moment for everyone else. A lesson whose
answer is *not yet* needs someone who is still standing there when the answer becomes *now*. Both the
hint and its flag are gone.

### The execution shot

A called head shot can kill outright. Three conditions, all chosen or earned:

1. the attacker **deliberately** aimed at the head (`_aimPart === 'head'`),
2. the blow actually landed on the head, and
3. it was a **critical**.

**There is no hidden roll** — the rarity is emergent. Aiming high costs −8 to hit, so a novice's
margin cannot arithmetically reach the +8 crit threshold: it is *0%* until you train, not merely
unlikely. Per swing:

| weapon skill | vs weak mob | vs tough | vs elite / PvP |
|---:|---:|---:|---:|
| 1–3 | **0.0%** | 0.0% | 0.0% |
| 6 | 3.9% | 0.3% | 0.0% |
| 12 | 47.2% | 22.6% | 3.9% |
| 18 | 71.8% | 58.3% | 28.5% |

**The weapon decides lethal vs non-lethal.** With `clubs` or `fists` a successful called head shot is
a **knockout**, not a kill — the stealth system's rule reused verbatim (*"swinging a blade at a skull
is not a knockout attempt, it is a killing"*), so the two routes to unconsciousness agree and no new
verb is needed. You chose the outcome when you picked up a bat instead of a knife. See
[systems-stealth.md](systems-stealth.md#the-rule-that-shapes-everything) for why this does not
contradict "combat is to the death".

Two guards (`executionShot`):

- **The damage floor** — the blow must be ≥25% of the target's `hp_max` *after soak*. A 600 HP boss
  would need 150 damage in one strike, so it can never be cheesed. This is what stops "one hit"
  meaning "one hit on anything".
- **Falling short still ruins the skull.** A called crit under the floor forces a **Maimed** head via
  `forceSeverity` on the damage payload — combat's decision, not a second roll. So the shot is worth
  attempting against big targets even though it can't kill them.

Head armour is the counterplay: enough soak pushes the attacker under the floor, which finally gives
the `head` slot a job. **Symmetric in PvP** — a helmet is the only thing between you and a skilled
sniper.

**Enemies never set `_aimPart`, so a mob cannot execute a player** — `enemyAttackPlayer` consults
none of the aim machinery. This is always something a player chose to do, never something that
happens to them, the same principle the stealth system uses for knockouts.

That is **reserved rather than permanent**: truly elite enemies will aim once such enemies exist
(decided 2026-07-30), because the "no mob can one-shot you" guarantee is safe to spend on a named,
telegraphed opponent and reckless to spend on a street thug. See
[injury-system.md §15](proposals/injury-system.md) for the four-step wiring — in particular that the
enemy must pay `aimHitPenalty` too, or the rarity curve that makes this fair disappears.

### Buckshot (`spread`)

A weapon tagged `spread: N` (2–4) lands as N **separate impacts** instead of one. Each rolls its own
body part, is soaked **separately** against the armour covering that part, and fires its own damage
event; the whole lot is summed for HP. `splitSpread` distributes the remainder, so nothing is lost.
Absent or `1` is the single-impact path every weapon has always used.

This exists because one big roll saturated the injury curve. The breacher shotgun (18–34 against a
40 HP body) cleared the Maimed bar on ~71% of hits **unarmoured and 40% through heavy armour** —
armour had a flat line where every other weapon had a curve. Splitting the same damage three ways:

| soak | any injury | maimed | avg damage |
|---:|---|---|---|
| 0 | 100% → 31% | **71.3% → 2.7%** | 28.6 → **28.6** |
| 6 | 100% → 5% | 40.3% → 0.0% | 22.6 → 10.6 |

Lethality is untouched unarmoured; the guaranteed maim is gone; and per-group soak means **armour is
far better against shot than against a slug**, which is both realistic and the point. Currently on
`item_breacher_shotgun` (3) and `item_riot_shotgun` (2).

**Both directions are wired.** Enemies carry a component list rather than item tags, so their
authoring surface is **`enemies.flags.spread`** instead of a weapon tag — same helper, same mechanic,
different place to write it down. (Enemy flags have no section in
[flags-keys.md](flags-keys.md) as a class, so this one is documented here.) On the enemy side each
component is rolled **once** and its damage split across the groups, never re-rolled per group —
otherwise a spread weapon would quietly deal more total damage than the same weapon firing a slug.
No enemy authors it yet; tag a shotgun-carrying mob to switch it on.

### Fighting in water

`waterCombatPenalty(zone, weaponStats, skill)`. Water state is read straight off the zone —
terrain `water`, `flags.water`, `flags.underwater`, the same test the swimming plugin uses — so
the engine needs no plugin import and this holds on every attack path including the auto-attack
tick.

- **A firearm does not fire.** Wet powder, and no amount of skill fixes it.
- **Melee is dismal, and *how* dismal depends on the weapon's BULK as much as your skill.** A
  knife is a thrust, which water barely argues with; a big sword is a swing, which is the exact
  motion water refuses to allow. `weight` (grams) is the proxy, so this needs no new authoring:
  ≤1000 g unaffected, ≥4000 g hopeless.

| weapon | unskilled damage in water |
|---|---:|
| knife (700 g) | ~97% |
| shortsword (2400 g) | ~64% |
| chainblade (4400 g) | ~15% |

Two independent outs — **be good, or carry something small** (`relief = max(mastery, 1 − bulk)`).
A novice with a knife fights nearly normally; a master with a chainblade manages; a novice with a
chainblade is worse off than unarmed. Mastery scales between skill 8 and 18, and a master is never
*better* in water than out.

- **`waterproof`** exempts anything actually built for it — the Tidewell speargun.
- **`water_shock`** (the Halcyon ComplyMate taser) works perfectly, which is the problem: the water
  is the circuit, so it earths through every enemy and every player in the zone at 60% — including
  the person holding it. Capped so it is humiliating, never lethal. Resolved as part of the same
  blow, not a second attack: no extra cooldown, no second to-hit roll.

### Fighting something in the air — `flags.flies`

The mirror image of the water rule, and it uses the same `weight` proxy with the
opposite sign. **Water punishes the long weapon** (a swing is the motion water
refuses to let you make); **air punishes the short one** (you simply cannot
reach). No new authoring — `flightCombatPenalty(enemy, weaponStats, skill)`
returns a `hitMod` between 0 and −7:

| | novice (4) | trained (12) | grounded |
|---|---|---|---|
| bare fists | 23% (−7) | 92% (−5) | 77% |
| scrap shiv (300 g) | 30% (−6) | 92% (−5) | 77% |
| Orme Trueline shortsword (2200 g) | 54% (−3) | 97% (−3) | 77% |
| sledgehammer (8000 g) / any firearm | 77% | 100% | 77% |

Two independent outs, exactly as in water: **be good, or carry something that
gets there.** Firearms and thrown weapons are exempt outright — shooting it down
is the intended answer.

**A stunned flier is a GROUNDED flier** and the penalty lifts entirely. That is
the loop this exists to create: you can't reach it, so you drop it (a taser's
`status_chance`, an unaimed head crit), then you get to use the weapon you
actually brought. This is why the function takes the live enemy *instance*, not
the template — and it's what gives the taser a job no gun does. The hit line
reads `GROUNDED` instead of `STUNNED` when the target flies.

A melee miss against a flier says **why** ("It is above you. You need reach, or
something that shoots."), or a run of misses reads as bad luck rather than the
wrong tool.

> There is deliberately **no `reaches_flight` weapon tag.** Weight alone decides,
> because a tag no item carries is exactly how `flies` sat unread for months in
> the first place. Add the override when a weapon exists whose reach its weight
> misrepresents — a long light spear — and not before.

### Stun and radiation on the hit path

Two small readers, both for data that already existed:

- **A head crit STUNS** — but only an **unaimed** one. A called head shot already
  pays out as an execution or a knockout, so stacking a stun on top would be two
  rewards for one event. Aiming buys the bigger outcome; not aiming still makes a
  lucky head crit worth something. Deliberately **not** applied on the
  enemy→player path: a mob taking your turn away is the same agency theft the
  knockout rules refuse, and the old `TODO(phase5)` there is now answered with a
  no.
- **`flags.radiates` + `flags.radiation_damage`** on an enemy dose the player when
  it lands a blow (Rad Mutant +5, a Redline horror +8). Authored long before
  anything read them; `player.radiation` and the `irradiated` effect already
  existed, so this is a reader, not a system.

### What a part GIVES — `body_parts[].grants`

A body part can carry a `grants` block. While it is intact the creature has that
capability; **Maim it and the capability is gone**. This is what turns anatomy
from a damage-location table into a set of things worth aiming at for a reason
other than "more damage".

| key | effect when the part is destroyed |
|---|---|
| `component: <n>` | that index of the creature's `weapon` array **stops firing** — the arc goes out, the bite stops |
| `dodge: <n>` | it loses that much evasion (floored at 0 — a wrecked thing is easy to hit, never impossible to miss) |
| `capability: "<name>"` | the named capability is lost; read with `enemyHasCapability(enemy, name)` |

**A shared component behaves like a pair.** Two parts granting `component: 0`
keep it alive until *both* are destroyed, which is how a creature with two
tendrils should work without a special case.

**A creature always keeps at least one attack.** If every component is silenced,
the last one survives — something that cannot strike is a corpse that has not
been told, and it would stand there being hit forever.

Authored today: the **Heavy Enforcer's** energy arc dies with its torso emitter,
the **gill mutant's** edged bite dies with its head, the **tar-pit horror's**
tendrils share one attack and both carry `grab`, and the **harbour lurker's**
fins are worth 2 dodge each — take both and dodge 4 becomes dodge 0.

Deliberately **not** in the block: `soak`. Parts already carry their own typed
soak, and a second creature-wide plating number in the same place would be two
knobs that look like one.

Nothing consumes `capability` yet, by design — the seam exists so a behaviour can
gate on `grab` without this layer learning about that behaviour.

### `status_chance` — the tag that finally does something

Weapons authored `status_chance` (e.g. `{ "stunned": 0.3 }`) for a long time with
exactly one reader — `plugins/weapon/index.js` copied it into `weaponStats` and
**`combat.js` never looked at it**, so the ComplyMate taser's 30% stun had never
once fired. `rollWeaponStatus()` is that missing reader, rolled on every landed
hit in `playerAttackEnemy` and `pvpSwing`.

**`stunned`** did not exist either. Rather than invent a turn-skip mechanic (the
thing `combat.js` has a standing TODO about), it reuses the one `dodge` already
proved: **lock the attack cooldown**. `cmdAttack` then refuses with its existing
"still recovering" line and all four auto-attack loops skip on their own — no new
guard anywhere in the tick. Two shapes, because readiness lives in two places:

| target | how it is stunned | how it is enforced |
|---|---|---|
| player | `applyStun` → cooldown + the `stunned` status | every attack path already checks the cooldown |
| enemy | `_stunnedUntil` on the instance | `enemyAttackPlayer` returns null, beside the `isOut` guard |

**NPCs are deliberately not covered** — they have no status list and no equivalent
readiness field, so a stun would be silent. `applyStun` returns `false` rather
than pretending, and that is asserted.

Non-`stunned` effects only land on something with a status list, so a mob cannot
be set on fire by this path. Food uses the same tag through a different door — see
[systems-survival.md](systems-survival.md#hunger--thirst).

### Weapons above your grade (`min_skill`)

`min_skill` (e.g. `{ "blades": 6 }`) is **two different gates, deliberately split**:

- **Buying is a hard refusal.** A vendor will not sell you a weapon you visibly cannot handle
  (`vendor.js`, at the purchase point) — you can never buy your way past the ladder.
- **Using one is a soft penalty.** `underskilledPenalty()` costs you `-1` to-hit per level short
  and up to 75% of your damage (floored at 25%). **Never an equip block.**

That split is the point: "you may not hold this" is a rule, whereas "you are visibly terrible with
this" is a story, and it leaves the looted-a-great-sword-too-early moment intact instead of
deleting it.

### Injuries, and the `baseDamage` contract

Where a hit lands now outlives the fight — see [systems/injury](proposals/injury-system.md). Two
things combat owes that system:

- `fireDamageToPlayer` / `fireDamageToEnemy` ([damage-events.js](../server/engine/damage-events.js))
  fire at every damage site. Observers are **notified, not consulted** — nothing they return is read
  and they cannot change the damage.
- Each payload carries **`baseDamage`** alongside `damage`: the same roll, soaked, but *without* the
  crit and head multipliers. The injury system scores the base, because crit and head already lower
  its threshold and were otherwise counted twice. **`damage` is unchanged** — this affects how often
  a blow wounds, never how hard it hits. (`pow` is deliberately included in `baseDamage`: a called
  haymaker at a knee should break it.)

Enemies are wounded too, in memory on the instance. Combat reads two plain fields the plugin
maintains: `enemy._injuryHitMod` (wounded arms degrade its swing, in `enemyAttackPlayer`) and
`enemy._injuryFleeMod` (wounded legs cost it the `mobFleeRoll` contest). Both absent = unchanged.

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

## The swing seam — `registerSwingContributor`

The one place a plugin can see a swing **while it is still resolving** and bend it.
Added 2026-08-13 for the Long Watch's mastery system ([systems-mastery.md](systems-mastery.md)).

Everything else in `combat.js` that a plugin touches is a **field poke** — the injury
plugin maintains `enemy._injuryHitMod` / `_injuryDodgeMod`, the weapon plugin sets
`player._powQueued`, and the engine reads those without importing anything. That pattern
is good at exactly one thing: *intent armed somewhere else, earlier.* It cannot express
**observation**, which a system that learns an opponent over a fight needs.

A **registry**, deliberately, and not a `gatherHook`: `gatherHook` awaits every handler,
so one plugin doing a query inside it would put a DB round trip on every swing in the
game. `senses.js` made this exact call for the movement path — it is why `acuitySync`
exists beside `acuityFor` — and combat is hotter than movement.

```js
registerSwingContributor((phase, ctx) => { … }, 'mastery');
```

**Sync by contract, and stricter than any other contributor registry: may not await,
may not query, may not send.** It runs twice per swing, in both directions.

| Phase | When | Fields read back by the engine |
|-------|------|-------------------------------|
| `'pre'` | before the to-hit roll | `hitMod`, `damageScale`, `critBonus` (outgoing); `hitMod`, `soakBonus`, `negate`, `negateLine` (incoming) |
| `'post'` | after the outcome, **including on a miss** | nothing — this phase is for observing |

`ctx` always carries `kind` (`'outgoing'` / `'incoming'`), `player`, `enemy` and
`lines[]`; `'post'` adds `hit`, `margin`, and on a landed swing `damage`, `impacts`,
`critical`.

Three things worth knowing before you use it:

- **`'post'` fires on a miss.** That is the whole reason this is not built on
  `registerDamageObserver` — those answer "a wound happened" and never see a swing that
  missed. A system reading an opponent learns as much from the swings that miss.
- **`negate` is separate from `hitMod` on purpose.** A technique that steps inside the
  arc is a *stated outcome*; expressed as a large negative `hitMod` it would silently
  fail against a high-`hit` enemy, the exact opposite of what such a technique is for.
  The attempt already rolled, in the plugin, before it set the flag. A negated swing
  must also set `negateLine`, or it prints the ordinary miss text and reads as luck.
- **`soakBonus` is read at the moment the blow lands**, not baked into `player.soak`.
  `player.soak` is a cache rebuilt on equip/login; a timed brace written into it would
  need invalidating on every path that can end one, and one missed path leaves a player
  armoured forever.

Prose goes in `ctx.lines[]` and the engine appends it to the message it was already
sending — a `sendToPlayer` from a contributor is N websocket writes inside the tick's
enemy loop. With nothing registered the seam allocates nothing and costs one `Map.size`
read; `tests/regress.js` layer 1h2 asserts that, plus that a throwing or `async`
contributor degrades to "your technique does nothing" rather than breaking combat.

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
