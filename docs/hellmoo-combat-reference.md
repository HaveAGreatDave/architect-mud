# HellMOO Combat & Stats — Reverse-Engineering Reference

This documents how **HellMOO** (the inspiration for Architect) implemented stats,
skills, combat, equipment, damage, and NPCs. It is **not** a description of the
Architect engine — it's a parsed-from-source design basis we can borrow from,
simplify, or reject deliberately.

Source: `hellcore.db`, a **LambdaMOO textdump, Format Version 5** running on the
**Stunt** server lineage (it uses `TYPE_MAP`/`TYPE_BOOL`/`TYPE_WAIF`, which stock
LambdaMOO lacks). 373 objects, 4,380 verb programs. This is the **core/starter
db** — the engine plus base prototypes, with only the 6 stats and 2 skills
defined as objects. Production HellMOO layered its hundreds of skills, weapons,
and mobs on top as *content*. So this file is the engine skeleton, which is
exactly what's useful here.

All formulas below are read directly from the MOO verb code. A full parse
(object hierarchy, resolved property values, every verb program) lives in
`Downloads/hellmoo_analysis/` if we need to pull another system later
(economy, factions, crafting, drugs, areas, quests are all present).

---

## The model in one paragraph

Stats and skills are the **same object type** — `generic stat` is a subclass of
`generic skill` — and both live in one per-creature structure,
`player.skills[name] = {raw, ip, cached_total, cache_time}`. Six stats anchor
everything; skills *derive* their level by averaging the stats they depend on,
plus trained `raw`. Every action — attacking, dodging, parrying, crafting,
perceiving — resolves through one **2d9 skill check** that returns a *margin of
success*. Combat is real-time: each attack schedules its resolution after a
delay equal to the weapon's speed, via an action queue. Damage rolls per type,
armor absorbs by type, the hit lands on a specific body part, and **status
effects (bleed, stun, poison, disease) are modeled as drugs** applied to the
victim. Death sends you to an afterlife and leaves a corpse.

---

## 1. Stats and skills (one unified system)

`generic skill (#96)` is the base; `generic stat (#126)` subclasses it. Per
creature, both are stored in a single map:

```
player.skills[name] = {raw, ip, cached_total, cache_time}
```

- `raw` — trained level (practice-capped at 8; higher needs a teacher)
- `ip`  — improvement points 0–99; at 100 → `raw += 1`
- `cached_total` / `cache_time` — memoized `total()` (refreshed on a timer)

### The six stats (`$skills` = #97), baseline ≈ 10

| Stat | What the code uses it for |
|---|---|
| **brawn** | melee damage: `(brawn − 10) × weapon.damage_from_brawn` |
| **reflexes** | attack speed: `base_speed − (reflexes − 10) / 9`; feeds dodge |
| **endurance** | combat-fatigue resistance; feeds fists; stamina (chug, etc.) |
| **brains** | gates NPC tactical AI; perception/evaluation checks |
| **senses** | perception/detection (e.g. noticing a mind-scan); feeds dodge |
| **cool** | resist pain-fumble & stun thresholds; calm under fire; recovery |

### Skills derive from stats

```
skill.total(who) = raw
                 + base (−2)
                 + skill_modifier_for(who)        // gear, drugs, status
                 + average( each depends_on skill.total(who) )
```

Defined here:
- **fists** → `depends_on {brawn, endurance}`
- **dodge** → `depends_on {reflexes, senses}`

With stats at 10 and no training, `fists = 0 − 2 + (10+10)/2 = 8`. Stats set the
floor for every skill; trained `raw` lifts you above the stat baseline.
Untrained skills `defaults_to −3`. `depends_on` can chain (skill trees), since a
skill can depend on other skills, not just stats.

### The universal skill check (`#96:check`)

```
roll = random(9) + random(9)          // 2d9, bell-curve 2–18
if roll > 17: roll += random(9)       // exploding (crit fail tail)
if roll < 4:  roll -= random(9)       // exploding (crit success tail)
result = (skill.total(who) + modifier) − roll
```

`result > 0` = success; magnitude = quality. 3–4 auto-succeed, 17–18 auto-fail.
Encumbrance applies a penalty here for skills with an `encumbrance_penalty`.

### Advancement (learn-by-doing)

After most checks, `possibly_improve(who, result)` may grant IP. Improvement is
most likely when `result` is near zero — i.e. you attempted something *at your
ceiling*:

```
chance = max(0, (40 − raw×3) − result×5)     // only when −3 < result < 5
```

`maybe_improve` then rolls d100 against `chance × improve_rate`, with modifiers:
hardcore mode ×2, very low `raw` learns much faster, focus-skills ×, fighting
tougher enemies boosts gain, some drugs boost. **100 IP → raw +1.** Practice
caps `raw` at **8**; beyond that you spend **XP with a teacher**
(`learn_cost_for`, base 1000 XP, scaled by focus and `learn_cost_mod`).

Tuning constants: skill `improve_rate 0.6`, stat `improve_rate 0.8`, stat
`learn_cost_mod 1.8`.

---

## 2. Combat resolution (real-time, action-queued)

Combat is **not** lockstep rounds. `attack (#222)` is an *action object* with two
halves; each swing schedules `_finish` after a delay equal to the weapon's
`speed`, through the creature's action queue. Faster weapons / higher reflexes =
more swings per second.

### `_start` — build the swing
1. choose `bodypart` (random if unspecified)
2. `bonus = who.base_attack(...)` → weapon `accuracy` + `_tohit_next` +
   dual-wield mod + cover/darkness mods
3. `bonus = target.base_dodge(...)` → passive defense (cover −5, etc.)
4. `check = weapon.check_skill(who, bonus)` → the **attack margin** (2d9 check)
5. `speed = weapon.speed(who)` + jitter → the delay until `_finish`

### `_finish` — resolve the swing
```
if check < 0:                       → MISS
else:
  result = target.dodge_or_parry(who, weapon, check, bodypart)
     STR / LIST  → actively defended (dodge or parry message)
     INT         → defense failed, continue with this margin
  damage = weapon.inflict_damage(target, result, bodypart, who)
     STR         → absorbed by armor (bounce message)
     else        → HIT, damage applied
```

### Active defense (`dodge_or_parry`)
- **6% "lucky shot"** bypasses defense entirely.
- If `my_weapon.parry_class ≥ attacker_weapon.parry_class` → **parry**
  (`my_weapon.skill:check`), else → **dodge** (`dodge:check`).
- Bonuses for having defended recently and for not currently engaging that
  attacker. Margin picks the flavor (clean knock-aside vs. mid-swing stop).

### Damage (`#95:damage` / `inflict_damage`)
Weapon damage spec: `{{type, min, max, crit_chance}, ...}`.
```
dmax = base_max
     + (brawn − 10) × damage_from_brawn
     + clamp(attack_margin − 3, 0, 8) × damage_from_skill
amount = min + random(max − min)            // per damage component
crit:  if random(100) < crit_chance + accuracy×2  → amount ×1.5
power attack: amount ×2 + 3
```
A broken weapon (`health < 1`) halves max damage and lowers accuracy.

### Armor (`take_damage`)
```
who.armor = {{type, min, max, frontmod}, ...}
```
Each entry whose `type` matches absorbs `random(min..max)`. `frontmod` multiplies
absorption when the hit comes from someone you're **not** already fighting
(i.e. you're facing them). Remaining damage hits the **body part**, then
`health`. PvP halves damage. Death at `health ≤ 0`.

### Weapon properties (`generic weapon #95`)

| Property | Meaning |
|---|---|
| `base_speed` | seconds per swing before reflexes/mods |
| `damage` | `{{type, min, max, crit_chance}, ...}` |
| `accuracy` | flat to-hit bonus (degrades as weapon breaks) |
| `damage_from_brawn` | extra max damage per brawn point above 10 |
| `damage_from_skill` | extra max damage per attack-margin point |
| `skill` / `min_skill` | which skill it uses; penalty below min |
| `parry_class` / `parry_bonus` | parry capability and bonus |
| `melee_defense_mod`, `antidodge_mod` | defensive interplay |
| `grind_ceiling` | max skill level you can practice-grind from it |
| `max_mods`, `mods` | weapon-mod slots (`generic weapon mod #127`) |
| `throwability`, `min_speed`, `health` | thrown use, speed floor, durability |

Weapon hierarchy: `weapon #95 → melee #259 → natural #101 → fist #193`. Unarmed
attacks use a "natural weapon" so the same pipeline handles fists and swords.

---

## 3. Status effects are drugs

There is no separate status-effect system. **Bleed, burn, stun, knockout, shock,
poison, disease, and moods are all `generic drug (#125)` subclasses**, applied
with `who:ingest(drug, dose)`. After damage, `damage_type:affect()` rolls each
effect with chance scaled by damage and **body-part multipliers** (head ×3
knockout / ×2 stun; chest ×2 shock):

```
bleed    → ingest bleeding drug, dose = amount/4
knockout → unconscious drug (drug tolerance can shrug it off)
stun     → stunned drug, duration from damage %
shock    → shock drug, dose = amount/7
burn     → burn drug, dose = amount/4
```

The creature `heartbeat` ticks `process_blood()` to apply ongoing drug/bleed
effects each beat. Drugs enter through **drug_vectors** (inhalation,
intravenous, mouth, skin, divine). This is powerful — one system covers combat
status, narcotics, diseases, and buffs — but it's also a big part of why HellMOO
felt "convoluted": everything is a drug, so reasoning about a creature's state
means reading its whole drug list.

---

## 4. Bodies, death, and NPCs

### Body system
Creatures have `body_parts` (head, chest, abdomen, groin, arms, legs, hands,
feet, back, face, mouth, eyes, skin…). Each `body (#110)` part has `size`,
`max_damage`, `critical`, `severable`. Armor/clothing is worn **per part**
(`wearing_on`). There's a **body/dream duality**: a creature can "die" in a
dream/cyberspace layer (`#1837`) while its real body survives.

### Death
On `health ≤ 0` → `die`: disengage, drop to an **afterlife**, leave a **corpse
(#104)**, and award XP to attackers. `xp_value` uses a **diminishing curve** — a
mob is worth less XP the more you out-level it. Includes soul/respawn/entomb
flow and bloodstain decals (which can spread disease).

### NPC AI
`generic NPC #106 → generic monster #142`, behavior driven by a tactics object
(`default tactics #269`). The tactics object holds `considerations` (dodge,
grab, push) gated by the NPC's **brains**; `decide_on_action` evaluates the
fight (with brains-based accuracy noise) and queues special actions when useful.

`threat_rating = (weapon_skill + dodge) + damage/3 + health/3 + armor/3` — a
single combat-power number, handy for difficulty tuning and spawn balancing.

---

## 5. Object reference (the `$names`)

| `$name` | obj | role |
|---|---|---|
| `$rpg` | #103 | combat globals/utilities (`combat_speed 1.3`, meters, damage helpers) |
| `$skills` | #97 | registry of stat/skill objects by name |
| `$creature` | #107 | core combat object (179 verbs) |
| `$player` / `$npc` | #6 / #106 | player and NPC prototypes |
| `$weapon` | #95 | weapon prototype (→ melee #259 → natural #101 → fist #193) |
| `$body` / `$bodypart` | #148 / #110 | body and body-part prototypes |
| `$damage` | #102 | damage type (→ beating #199); `$damages` db #220 |
| `$drugs` | #226 | drug/status registry |
| `$actions` | #94 | action objects (attack #222, dodge, etc.) |
| `$stat` / `$skill` | #126 / #96 | stat and skill bases |

Creature hierarchy: `actor #92 → creature #107 → living creature #154 → RPG
player #100 → player #6`; NPCs branch at `creature #154 → NPC #106 → monster
#142`.

---

## 6. What to keep vs. simplify for Architect

Opinions, not decisions — flagged so we choose deliberately:

- **Keep:** the unified `skills[name] = {raw, ip, …}` store; the single 2d9
  margin-of-success check for *every* action; learn-by-doing IP; weapon damage
  as `{type, min, max, crit}`; armor absorbing by type; real-time action-queue
  combat with weapon-speed delays; per-body-part hits; `threat_rating` for
  balancing.
- **Simplify / reconsider:**
  - **Stat→skill `depends_on` averaging** is elegant but hard to reason about
    once trees get deep. Consider a flatter "skill = trained level, stats give a
    flat bonus" model, or cap dependency depth at 1.
  - **Drug-as-everything** overloads one system for combat status, narcotics,
    diseases, and buffs. Splitting *combat status effects* from *consumables*
    would trade some elegance for a lot of legibility.
  - **Body/dream duality** and the full afterlife/corpse/soul flow are heavy;
    worth deferring until the core loop is fun.
