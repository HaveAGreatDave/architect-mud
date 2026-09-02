# Mastery — the Long Watch's third answer

**Status: BUILT** (restamped 2026-09-02; the Senses and Mind disciplines landed the same day,
so all eight now do something). [systems-mastery.md](../systems-mastery.md) is the as-built
authority. The per-discipline technique catalogue below — Pain Discipline, Cold Mind, Combat
Meditation, Ghost Step, Wall Run — was never scheduled and remains design.

⚠ **Where the build departed from this plan, on the Senses half:** §2 says "Blind Fighting is
a `visibility.perceive` contributor and nothing else". It cannot be. That hook keeps ONE
answer and hands every handler the same original arguments, and `plugins/flashlight` is
already on it — so mastery, which sorts after, would replace a torch's boost with a shift of
the raw value, and a carried light would stop working for anybody who trained. It rides the
swing seam instead, on the perceived darkness penalty, which composes by construction. It ships as
[`plugins/mastery/`](../../plugins/mastery/) — ten modules covering the swing seam, the
purity cap, the stain, Read and Exploit — and the as-built account is
[systems-mastery.md](../systems-mastery.md), which outranks this document wherever the two
disagree. What follows is the design that produced it, kept for its reasoning.

⚠ **This said "DESIGN ONLY. Nothing here is implemented." while the plugin was live.**
`docs:lint` cannot catch it: that check fires when a status line contradicts its own BODY,
and this body genuinely is design — it is the *world* that moved past it. The same
staleness hid something worse for months, and it is worth remembering which way round it
went: mastery shipped a `train` verb, a rep gate, a purity gate and a per-teacher ceiling
with **no instructor anywhere in the world**, so the discipline was unreachable while
documented as built. Three instructors exist now (see systems-mastery.md §8).

The third leg of the body-philosophy triangle. Wildblood mutate, Ascendants
install chrome, and the Long Watch do neither — their counterpart is **mastery**
of the body they were issued.

| Path | Philosophy | Source of power | System |
| --- | --- | --- | --- |
| Wildblood | Become something else | Mutation | `plugins/mutations` + `server/engine/mutations.js` |
| Ascendant / Synthesis | Replace yourself | Bionics | `plugins/augments` |
| **Long Watch** | **Master what you already are** | **Discipline** | **`plugins/mastery` (this doc)** |

The Long Watch answer to a mutant with six arms is not *get six arms too*. It is
**"I only need two."**

The design rule the whole thing hangs off: **a Long Watch veteran must not look
supernatural on inspection.** No entry on the paper doll, no line in
`player.appearanceNotes`, nothing an `examine` can see. They look like an
ordinary human until you watch what they do. Mutations are *visible* and chrome
is *visible* — mastery's invisibility is not an omission, it's the fiction.

---

## 1. The three deliberate NOTs

Three things this must not become, each one the trap that would collapse it into
a re-skin of the two systems it exists to differ from.

**Not a stat block.** Mutations and augments both apply `stat_modifiers`.
Mastery must never grant a permanent passive number, because the moment it does
it is a mutation you can't see and the fantasy is dead. Every technique costs
something at the moment of use — stamina, a resource, a positional commitment,
or the ability to do something else — and **can fail**. `Perfect Timing` is not
a 20% dodge bonus; it is a thing you attempt and eat a claw for missing.

**Not a second progression currency.** The game already has skills + IP
(`awardSkillUse`). Mastery ranks are *earned by doing hard things*, not bought,
and the natural implementation is that a discipline's rank is **derived** from
the skill uses that already fire — successful defence against a stronger
opponent, fighting injured, surviving an ambush, killing a mutant or a chromed
enemy. If a player has to go grind a training dummy, it's wrong.

**Not baked.** Same invariant `systems-mutations.md` had to learn the hard way:
contributions are derived at read time by the readers that already net gear and
status effects (`registerStatContributor`, `registerArmorContributor`). Nothing
writes into `players.stat_*`. A technique that is *active* is a status effect
with a timer, not a column.

---

## 2. Disciplines

Eight, each a rank 0–100 like a mutation's expression, each unlocking techniques
at thresholds:

`body` · `movement` · `senses` · `mind` · `combat` · `pain` · `breath` · `will`

A discipline is not a skill — skills answer *can you swing this weapon*,
disciplines answer *what can you do with a body*. They gate techniques; they
never add to a to-hit roll on their own.

### Body
- **Iron Body** — braced against impact: blunt soak up, knockback down, harder to
  knock out. Costs stamina per tick held.
- **Rooted Stance** — very hard to knock down or grapple, **and you can't move**.
  The cost is the point.
- **Controlled Landing** — fall damage scaled down; at high rank, survive falls
  that would down anyone else.
- **Deadlift** — one maximal exertion: force a door, shift a wreck, break a
  restraint, overpower something bigger. A technique with a cooldown, never a
  Brawn bonus.

### Movement
**Ghost Step** (move *through* the attack), **Slip** (small movement, the swing
misses), **Breakfall**, **Combat Roll** (a knockdown becomes a reposition),
**Wall Run** and **Vault** where the environment allows it. At high rank a Long
Watch veteran traverses a room in ways nobody else can.

### Senses
Their answer to enhanced-sense mutants: not new organs, extraordinary use of the
ones they have. **Peripheral Awareness**, **Sound Localization**, **Motion
Reading**, **Breath Detection**, and **Blind Fighting** — fight in darkness,
blinded, or obscured at a real but survivable penalty.

This one has an existing home: `server/engine/senses.js` already computes acuity
per observer, and `visibility.perceive` already lets a contributor change a
perceiver's effective light. Blind Fighting is a `visibility.perceive`
contributor and nothing else.

### Mind
**Pain Discipline** (pain doesn't interrupt), **Fear Discipline** (grotesque and
terrifying things land softer — this is a `sanity` interaction, and
`resistSanityLoss` in `condition.js` is already the seam), **Focus**, **Cold
Mind**, **Combat Meditation** (a maintained state: better perception and
reaction, less wasted stamina — broken by taking a hard hit).

---

## 3. Read — the mechanical identity

The best idea in the pile, and the one that makes the Long Watch feel unlike
anything else in the game.

Not psychic. Observation. Stance, breathing, weight distribution, weapon
position, muscle tension. The first few exchanges of a fight *teach* you the
opponent, and then:

> You recognize the shoulder movement.

**The longer a fight goes, the more dangerous a Long Watch fighter becomes.**
Every other build in Architect gets worse as a fight drags — stamina, condition,
bleeding. This one inverts it, which is exactly the shape a discipline path
should have.

Read accumulates per *opponent archetype*, not per instance, so it survives the
kill: you learned how that enemy type moves. The storage contract to copy is
`player_npc_relations` from `systems-relationships.md` — hydrated at login, read
from memory thereafter, **sync and query-free by contract**, lazily decayed with
no tick. Combat is the hottest path in the game; a Read lookup that awaits a
query is an instant no.

### Exploit

At high rank, Read produces a named **Exploit** — a specific, stated weakness
with a specific mechanical consequence:

- *"Its extra arm moves independently, but its torso turns before the left pair
  strikes."* → evade chance against that attack.
- *"The actuator pauses two-tenths at full extension."* → counterattack window.
- *"The left knee servo is compensating for damage."* → that body part becomes a
  much better target.
- *"It commits its whole weight to the swing."* → sidestep, and it loses balance.

The prose is the reward. An Exploit line must read like something a person
noticed, and it must name a real body part the combat system will actually
resolve against.

---

## 4. Composure

The resource. Built by staying calm, defending successfully, reading, holding
stance, not flailing; spent on the extraordinary techniques. It is the Long
Watch's overclock and their mutagen, and it is made of nothing but skill.

The headline spend:

> The mutant swings the claw.
> **PERFECT TIMING.**
> You step inside the arc. The claw passes behind you. You strike the joint.

Composure is runtime-only. It lives on the live player object, never in the DB —
it should not survive a logout, because a stockpiled resource you log in holding
is a passive bonus wearing a resource's clothes.

---

## 5. Countering the other two paths

Mastery is a **counter-specialist** system. It shouldn't make you stronger than a
mutant; it should make you better at fighting something stronger than you.

**Against mutation** — read attack sequencing rather than fighting every limb,
exploit limb collision, attack the torso; against thick hide go for eyes, joints,
throat, tendons, existing injuries; against extra senses use misdirection, dust,
overload, and the specialization itself; against size use mobility, legs, terrain,
leverage; against regeneration, incapacitate and restrain rather than out-damage.

**Against chrome** — joints, actuators, cables, power. Blind optics with glare,
smoke and darkness. Attack balance and load-bearing servos, never the armor
plate; go for exposed interfaces, breathing, vision.

And the best of the pair: **provoke overextension.** Chrome rewards pushing past
limits. The Long Watch survives the overclocked swing, the hardware overheats,
and the recovery window *is* the Exploit. Bionics reward pushing limits; mastery
rewards making your opponent push too far. That is a genuine rock-paper-scissors
relationship between two systems that already exist.

---

## 6. The read minigame

Techniques can carry a short interaction window:

```text
READING...
  LEFT SHOULDER
  WEIGHT SHIFT
  ATTACK COMING
> SIDESTEP / BLOCK / COUNTER / RETREAT
```

Correct read, spectacular result. Wrong read, you're hit. At high rank the
information arrives faster and subtler, so the system rewards **player**
knowledge alongside character rank — which is the stated goal, and the reason
this is worth building over a passive.

Non-negotiable: this is a Display Mode citizen from day one. Per
`systems-display-mode.md`, an action surface must have a written equivalent at
the `textgames` rung and the record must reach the log at `log` —
`prefersTextMinigames` is the predicate, latched at the entry moment, never
called from a tick.

---

## 7. Where it lives, and the one engine change

A plugin: `plugins/mastery/`. It owns its verbs (`mastery`, `read`, `technique`
or per-technique verbs), its own table (never new `players` columns), and its
regress suite. It is a *system*, not a substrate — it fails the engine litmus in
`proposals/engine-plugin-boundary.md`.

It reaches the world through seams that already exist:

- `registerStatContributor` / `registerArmorContributor` — derived, unbaked
  contributions while a stance is up
- the status-effect framework — every maintained technique is a timed effect
- `visibility.perceive` — Blind Fighting
- `resistSanityLoss` — Fear Discipline
- the specialized-action registry — techniques that other plugins can offer
- `ADJUST_PATH` / `ADJUST_REPUTATION` — the human path, and the standing cost of
  chrome that `plugins/augments` already pays *to* the Long Watch

**The honest gap:** `server/engine/combat.js` currently exposes registries and
helpers but **no per-swing gather hook**. Read, Exploit, Slip and Perfect Timing
all need to observe and modify an in-flight swing. So this system's one real
engine change is a pair of seams on the swing path — something shaped like
`combat.outgoingSwing` and `combat.incomingSwing`, gathered, sync, with a
documented contract that a contributor may not query. Design that seam properly
*before* writing a technique, because every technique in this doc is a customer
of it and a hook added carelessly on the hot path is a per-swing round trip
waiting to happen.

---

## 8. The three endgames

- **Wildblood** — *"Look what I've become."*
- **Ascendant** — *"Look what I've built."*
- **Long Watch** — *"Look what I can do."*

A six-limbed thing attacks. The Long Watch fighter watches. Waits. Steps inside
the first strike, redirects the second, breaks the rhythm of the third, uses its
own weight against it, puts it down — and calmly gets back up.

Not more than human. The absolute limit of what a human is.
