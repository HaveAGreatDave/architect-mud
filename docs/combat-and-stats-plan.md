# Combat & Stats — Scope Plan

**Status: scope, not implementation.** This document defines *what* the reworked
stats/skills/combat systems should do. *How* to build it — formulas tuned to real
numbers, data shapes, engine wiring — is deliberately deferred to a later pass.

Design target: **somewhere between HellMOO and D&D.** D&D's legible "roll to hit,
then roll damage" loop; HellMOO's learn-by-doing skills, typed armor soak, and
per-body-part hits. See [hellmoo-combat-reference.md](hellmoo-combat-reference.md)
for the source material this borrows from and reshapes.

This supersedes the **Stats** and **Skills** light-layer tables in
[design.md](design.md) — those are now out of date.

---

## 1. Stats

Six stats, adopting **HellMOO's grounded names** (the old fantasy
STR/AGI/INT/WIL/END/CHA set is retired):

| Stat | Rough domain |
|---|---|
| **brawn** | melee force, carry, physical checks |
| **reflexes** | attack speed, feeds dodge |
| **endurance** | health pool, fatigue, feeds physical skills |
| **brains** | tech, crafting, perception/evaluation |
| **senses** | detection, feeds dodge |
| **cool** | nerve under fire, stun/pain resistance |

- **There is no charisma stat.** Social outcomes hang off skills (Persuasion etc.),
  not a stat. **`senses` is new** vs. the old set — it earns its keep in the
  combat math (dodge + detection).
- **Stats start at 0.** New characters get **~6 points** to assign at creation.
  No baseline offset, no penalties for low/zero stats.
- **Secondary effects are deferred** — the exact per-stat mechanical hooks (carry
  weight, fatigue, etc.) are a later pass. This doc only fixes the names, the
  starting scheme, and how stats feed skills (§2) and how they're raised (§3).

---

## 2. Skills

The primary progression layer. Stats make you *generally* capable; skills are the
*specific* competence.

- **Continuous scale, 0.00–10.00**, in 0.01 increments (replaces the old integer
  0–10 ranks). Anchors unchanged: most players cap most skills at 3–5; 8+ trained
  makes you famous for it.
- **Learn by use.** Doing a thing improves it; there's no XP-to-skill spend.
  Improvement is biggest when you **barely win** — a skill-up check keyed to a
  near-zero margin of success, so fighting things you can only just beat is the
  fastest way up (HellMOO's curve).
- **Stats boost skills by averaging.** A skill's effective level is:

  ```
  effective skill = trained value + average(its governing stats)
  ```

  - Trained value caps at **10**; the stat bonus pushes **effective skill past 10**,
    so a maxed specialist with strong stats lands in the teens.
  - With multiple governing stats, the bonus is their **average**, not their sum —
    a brawn+endurance skill wants *both* high; dumping one drags the skill down
    even if the other is maxed. This is the point: it makes balancing stats matter.
  - Single-governing-stat skills just take that one stat's value.
  - Early game stats are tiny (~1), so the bonus is small and trained skill
    dominates; the stat contribution grows as IP raises stats (§3).
- **No skill-depends-on-skill.** Skills pull only from stats, never from other
  skills. Stats already represent "generally good at things in your wheelhouse";
  chaining skills onto skills is the complexity we're cutting.

Skill *names/list* are not finalized here — that's content, sized later. The doc
fixes the scale, the learning rule, and the stat-coupling.

---

## 3. The IP economy (raising stats)

Two tracks, linked: skills self-level by use; **stats are bought with IP**, and IP
is *minted by skill progress.*

- Every 0.01 of skill gain drips **IP into a single shared pool.** You never grind
  stats directly — you play, skills climb, and the byproduct funds stat growth.
- **Spend IP to raise a stat**, with **quadratic-ish escalating cost** (each point
  costs more than the last), so dumping everything into one stat is deterred.
- **Soft cap**, no hard ceiling — it just gets prohibitively expensive in the high
  range. Starting stats are low (0–~1 each) so the first points are cheap and move
  fast, then it stiffens.
- Side effect, accepted: a **wide generalist** (many skills moving) banks more
  stat-IP than a **narrow specialist** — a fair tradeoff for breadth.
- Constants (IP per 0.01 skill gain, the exact cost curve, practical cap) are
  **tuned later**, once the real skill list exists — the skill count determines the
  size of the lifetime stat pool. Undesigned future stat sources may also exist.

---

## 4. Combat resolution

D&D-shaped: **roll to hit; if you hit, roll damage.**

- **To-hit:** `2d10 + attacker's effective weapon skill  ≥  defender's dodge`.
  - **2d10** is a bell curve on purpose — skill, not luck, usually decides; luck is
    a thumb on the scale (fits "skill is the primary progression").
  - **Dodge composition is deferred.** We know combatants have a dodge that must be
    overcome (a skill governed by reflexes/senses, plus situational mods like cover
    / darkness / being ganged up on); the exact formula is a later pass.
- **Armor never affects to-hit.** Armor is **soak only** (§5) — unlike D&D's AC,
  it never makes you harder to hit, only reduces damage after a hit lands.
- **Binary hit.** No margin-scaling of damage. A **crit** (high roll / beating
  dodge by a wide margin) multiplies damage. The margin-near-zero rule lives on the
  *skill-up* side (§2), not the damage side — so "barely beating tough enemies
  levels you fast" stays true without making damage swing on every roll's margin.
- **Damage** is then rolled from the weapon (per damage type), and reduced by the
  struck body part's armor soak for that type (§5).

---

## 5. Body parts & armor

- **Five body parts**, picked per hit from a **weighted table** so the torso eats
  most hits and the head is rare-but-punishing:

  | Part | Hit weight (rough) | Gear slot |
  |---|---|---|
  | Torso | high | vest / chest |
  | Legs | medium | pants / greaves |
  | Head | low | helmet |
  | Hands | low | gloves |
  | Feet | low | boots |

  (Weights total ~100 so a `d100`-style roll covers them; exact split tuned later.
  Arms were cut — for armor purposes they're effectively torso.)
- **Head is the only special part:** head hits get a **damage multiplier** and can
  **crit-to-stun**. Every other part is flat — location just decides which armor
  soaks. No per-part effect table (no arm-hits-drop-weapon, etc.).
- **Armor is per-part soak, typed.** Each armor piece lists a **soak value per
  damage type** — e.g. a kevlar vest soaks *kinetic* well, *energy/fire* poorly.
  The weapon's damage type indexes into the struck piece's table; a type mismatch
  means the armor barely helps. This is the whole reason types exist: "bring the
  right weapon / wear the right armor for this enemy" becomes a real decision.
- **Starter damage types (5):** **kinetic** (blunt/ballistic impact), **edged**
  (cutting/piercing), **energy** (directed-energy weapons), **fire**, **radiation**
  (ties into the existing rad system). **Chem/corrosive is deferred** — added the
  moment a weapon or enemy actually needs it, rather than balancing an unused type.

---

## Deferred / open (intentionally out of scope here)

- Per-stat **secondary effects** (carry weight, fatigue, sanity hooks, etc.).
- **Dodge** composition and exact formula.
- **Gear layers** (liked, explicitly not pursued now).
- All **tuning constants:** the 2d10 vs dodge target numbers, IP minted per skill
  gain, the quadratic stat-cost curve, practical stat cap, body-part hit weights,
  per-type soak values, crit threshold & multiplier, head multiplier.
- **Status effects** in detail (bleed/stun/burn/etc.) — HellMOO models these as
  "drugs"; whether we keep that or split combat status from consumables is a
  separate decision (see the reference doc's keep-vs-simplify notes).
- Final **skill list** and **damage-type-to-weapon** content mapping.
