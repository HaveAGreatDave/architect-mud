# Mutations

**STATUS: BUILT — Phases 1 and 2, 2026-08-13.** Both halves ship. Phase 1 is the substrate
(expression, live effects, derived contributions, visibility/concealment, detection, treatment, UI).
Phase 2 is the Wildblood half: 24 mutagen mutations, the flask, the Quickening arc that opens the
gate, natural weapons, the active organs, and clothing-conflict enforcement with tailored gear.
A short list remains genuinely unbuilt — see [Deferred](#deferred).

A mutation is a persistent biological change carried by a body. It is not a status effect (no
duration), not an item (cannot be removed by taking it off), and not a stat sticker — which is
exactly what it used to be, and the reason for the rework.

---

## What was wrong with the old one

Worth recording, because two of the three failures are the kind that regrow.

1. **`mutations.effects` was completely inert.** Every authored mutation carried an `effects` JSONB,
   and **nothing anywhere read it**. `rad_resistance`, `sanity_drain_reduction`, `status_on_hit` and
   `perception_bonus` sat in the database for months looking exactly like mechanics. Only
   `stat_modifiers` and the `visible` boolean ever did anything.
2. **Mutations were booleans.** You had Extra Eye or you did not. No mutation could ever be a story,
   because there was nothing to tell about it.
3. **Stats were baked into `players.stat_*`** and un-baked by reversing the arithmetic. Fine while
   mutations were permanent and all-or-nothing; unrecoverable the moment one can be treated at 40%
   and re-treated at 15%, because a drifted stat column has no record of what the true base was.

---

## The three rules

### 1. Expression, not a boolean

Every carried mutation has an **expression of 1-100** saying how strongly this body carries it.
Everything downstream — soak, acuity, whether a stranger can see it, what a clinic charges — derives
from that one number.

Expression is rolled **once at grant** and thereafter only ever goes **down**, via treatment.
Mutations do not creep. The moment you got it is the memorable one, and a concealable mutation cannot
quietly become an obvious one while you are out of town.

Two weighted profiles (`EXPRESSION_BANDS` in [mutations.js](../server/engine/mutations.js)):

| band | range | radiation | mutagen |
|---|---|---|---|
| common | 10-29 | 55 | 34 |
| marked | 30-59 | 32 | 33 |
| strong | 60-84 | 13 | 21 |
| severe | 85-94 | **0** | 9 |
| profound | 95-99 | **0** | 2.5 |
| legendary | 100 | **0** | 0.5 |

**Radiation cannot reach the severe band at all.** That is deliberate and load-bearing: a legendary
rad mutation would undercut the entire reason to go and find the Wildblood.

### 2. Nothing is baked

`server/engine/mutations.js` never writes `players.stat_brawn`. Contributions are **derived at read
time** from the carried set, scaled by expression, and netted by the same readers that already net
status effects and gear.

| seam | reader | accessor |
|---|---|---|
| stat | [condition.js](../server/engine/condition.js) `effectiveStat` | `mutationStatBonus` |
| acuity | [senses.js](../server/engine/senses.js) `acuitySync` via `registerAcuityContributor` | `mutationAcuity` |
| soak | [inventory.js](../server/engine/commands/inventory.js) `registerArmorContributor` | `mutationSoak` |
| resist | drug/temp/sanity paths | `mutationResist` |
| rate | [durability.js](../server/engine/durability.js) `wear()` | `mutationNumber` |
| social | [relations.js](../server/engine/relations.js) `adjustRelation` | `mutationNumber` |

**`hp_max` is the one exception.** It is a persisted column read by dozens of sites, so it cannot be
derived at read time; `recomputeMaxHp` is called from every path that moves the carried set.

**The identity at expression 100 is a correctness invariant.** `scaleByExpression` guarantees that a
mutation at 100 contributes exactly its authored value, which is what makes the migration off baked
columns arithmetically net-zero. Regress asserts it. Break it and the whole server gets silently
re-statted.

### 3. Sync by contract, one query at login

The read accessors sit on the combat, describe and senses paths. They read `player._mutations` and
never await. The pattern is [relations.js](../server/engine/relations.js)'s exactly: hydrate once at
login, mutate memory plus a dirty set, flush coalesced on a 1m cadence and again at logout.

**`server/engine/mutations.js` is the ONLY writer of `player_mutations`.** Keep it that way — the
memory cache is only as safe as its write funnel.

---

## The effect vocabulary

[mutation-effects.js](../server/engine/mutation-effects.js) is the registry, and it exists so the
failure mode **inverts**: an unrecognised effect key is logged loudly at boot and fails
`plugins/mutations/regress.js`, rather than being silently ignored forever.

```js
registerMutationEffect('acuity_sight', { kind: 'number', scale: 'linear', seam: 'acuity' })
```

- `kind` — `number` (summed) · `fraction` (0..1, combined **multiplicatively**, so stacking
  approaches immunity and never reaches it) · `flag` (true if any mutation asserts it)
- `scale` — `linear` (value × expression/100) · `threshold` (full value at/above `min`) · `none`
- `seam` — which reader consumes it. Documentation **and** dispatch: the accessors filter by seam, so
  a key declared under `acuity` can never leak into a stat total.

Two keys are registered but **not yet consumed** (`swim`, `stealth_penalty`); their readers are later
phases. `getUnconsumedMutationEffects()` reports them and regress caps the list at two, so
"registered" cannot quietly become the new "inert".

**Adding a mutation is a content edit.** Author the keys, ship through the `codex` skill. No engine
change is required, which was the whole point.

---

## Visibility, concealment, detection

`visibility_class` is a **ceiling** — what the mutation looks like fully expressed — and expression
walks it down:

| expression | result |
|---|---|
| < 10 | `hidden` |
| 10-39 | one rung **below** the class |
| 40-79 | the class value |
| ≥ 80 | one rung **above** (capped `extreme`) |

A `hidden`-class mutation is never visible at any expression. That is a real authoring choice: some
things are wrong on the inside.

**Concealment is generic.** `canConcealMutation(item, mutation, bodyPart)` reads the item's `slot`
and `covers` tags and intersects them with the mutation's `conceal_slots`. **No clothing item
anywhere carries mutation data, and none ever should** — a coat conceals a torso mutation because a
coat covers a torso. An `extreme` mutation is never concealable; a second head is not a tailoring
problem.

**Detection is per observer.** `detectMutations(observer, target)` composes `acuitySync` and light,
so the Wildblood with sharpened eyes catches what the barman misses. A mutation caught on acuity
alone through clothing returns `certain: false`, and the prose hedges rather than naming it.

`players.visibly_mutated` survives as a **write-through derived cache** of "would a stranger notice",
because four readers already depend on it. It is **no longer a one-way latch** — the old comment said
"once visible, always visible", which was right when nothing could remove a mutation. Treatment can,
and getting your Custodian-zone access back is most of what the fee buys.

---

## Body parts

[body-parts.js](../server/engine/body-parts.js) is now the **one** anatomy table; `combat.js` and
`plugins/injury/tables.js` re-export from it. There were four copies before this.

- `PARTS` / `BASE_PARTS` — the humanoid seven. Still what aiming, foe anatomy and the aim-target list
  ask for, because those are generic questions about bodies.
- `MUTATION_PARTS` — `head_2`, `wing_left`, `wing_right`, `aux_limb`, `tail`. Present only when a
  mutation's `grants_part` grows one.
- `ALL_PARTS` — used **only** where the question is about one specific body: what can be injured
  (`onDamage`, injury deserialization) and what this player's paper doll shows.

**Mutation parts carry zero base hit weight.** `rollBodyPart` iterates the *keys* of the weight map,
so a part with no key cannot be hit — which is why an unmutated player's combat maths is provably
byte-identical to what it was before this file existed. Regress asserts the identity.

> **The trap:** `bodyReport` must map `partsForPlayer(player)`, never `ALL_PARTS`. Mapping the whole
> table gives every player in the game a phantom second head in the Vitals app.

---

## Treatment, and the chrome interlock

Two routes off a mutation, at genuinely different prices:

- **Chrome** (`plugins/augments`) — the first augment install calls `burnAllMutations`, removing
  everything at once, for free, permanently, and `player.chromed` blocks mutation forever after.
  Flesh and machine are the two divergent paths and this closes one. **Unchanged by this rework.**
- **The clinic** (`CLINIC_MUTATION_TREAT`) — bills you per mutation and leaves every door open. One
  course walks expression back by 25; below the visibility floor it is removed outright. Cost is
  **superlinear** in expression (`treat_cost × share × 4 × (expression/100)^1.5`), discounted by
  `relationHelp`, free at `close`. `treatable: false` mutations are refused in character.

That gradient is the system: the further you have gone, the more it costs to come back.

---

## The mutagen gate

Enforced at the **application layer**, in `canUseMutagen(player)`, and re-checked inside
`applyMutagenMutation` — because a verb, a script node and a dialogue action are three different
doors and only one check can be the real one. There is deliberately no path that reaches the applier
without passing through it.

Two conditions, both required:

- **Inner Circle reputation** with `ideology_wildblood` (≥ 900). Rep is earned and decays, so this is
  a standing you keep rather than a box you ticked.
- **The Quickening ritual flag** (`wildblood_quickened`). You went to the Pool and they held you
  under.

Rep alone is not enough, because rep measures how much they like you and the ritual is a thing that
happened to your body. Both, or neither.

**Phase 1 correctly refuses everybody**, since nothing sets the ritual flag yet. That is the contract
later phases build against, not a bug.

---

## Files

| file | what |
|---|---|
| [server/engine/mutations.js](../server/engine/mutations.js) | the substrate: hydrate/flush, expression, visibility, concealment, detection, gate, treatment |
| [server/engine/mutation-effects.js](../server/engine/mutation-effects.js) | the effect vocabulary |
| [server/engine/body-parts.js](../server/engine/body-parts.js) | the one anatomy table |
| [server/engine/equip-gates.js](../server/engine/equip-gates.js) | the equip veto chain (registers nothing in Phase 1) |
| [plugins/mutations/](../plugins/mutations/index.js) | the verb, the trigger tick, all prose, the city's refusal |
| [plugins/clinic/index.js](../plugins/clinic/index.js) | `CLINIC_MUTATION_TREAT` |
| [content/mutations/](../content/mutations/) | 31 authored mutations |
| [scripts/unbake-mutation-stats.mjs](../scripts/unbake-mutation-stats.mjs) | the one-shot |

---

## Deploy note

**Run `scripts/unbake-mutation-stats.mjs` against prod BEFORE the new code serves traffic.**

- code first → players carry the baked column **and** the derived bonus: double-counted stats,
  silently, for everyone.
- script first → a few minutes where the bonus is missing entirely.

The second is strictly safer and self-heals the moment the deploy lands. Take the second.

```bash
node --env-file=.env.prod scripts/unbake-mutation-stats.mjs
```

It is idempotent (guarded per player by the `mutations_unbaked` flag) and sets every legacy row to
expression 100, which is what makes the migration net-zero on characters who already exist.

---

## Phase 2 — the Wildblood half

### Natural weapons are weaponStats, not a combat system

`naturalWeaponStats(player)` returns **the same plain object an equipped pipe produces**, handed to
the same `playerAttackEnemy`. Soak, crits, body-part rolls, injury, spread and skill all treat a
clawed hand exactly as they treat a weapon. There is no parallel path and nothing to keep in sync.
It returns `null` for a body that has grown nothing, so an ordinary player's fists are provably
untouched.

Precedence: consulted only on the **unarmed** branch. Picking up a pipe uses the pipe, so a player
with bone blades who wants them simply puts the pipe down.

`unarmed_edged` retypes the damage, which matters more than the number: edged has a low injury bar
and a shallow climb, so claws *wound constantly and ruin rarely*.

### Active organs are verbs

**A discharge you cannot choose to fire is just a damage number with a story attached.** So
`shock`, `screech` and `morph` are verbs (`plugins/mutations/organs.js`), gated at expression 30.
All three route through `applyStrikeToEnemy` (new, `combat.js`) — the enemy mirror of
`applyStrikeToPlayer` — so nothing writes `enemy.hp` by hand and skips the part roll, the typed soak,
the damage observers or the loot-on-death path.

`shock` hits **everything in the room** and cannot choose a target: excellent in a crowd, a liability
with someone you like in it. `morph` is deliberately *not* a combat power — it applies an ordinary
timed status, which keeps the rarest mutation in the game from also being the strongest.

### Clothing conflicts, enforced

Phase 1's promised one `registerEquipGate` call. **Nothing is destroyed or confiscated** — the
garment is fine, your body is not the shape it was cut for, and the refusal says so in those terms.
A system that ate your coat when you grew a tail would punish a player for the content they went and
found.

The way out is the `accommodates` item tag, a **small closed list of shapes** (`TAIL`, `WINGS`,
`EXTRA_LIMBS`, `CARAPACE`, `LARGE_HEAD`, …) rather than mutation ids: a coat has a slit for a tail,
it is not cut for `mut_wb_prehensile_tail` specifically. Six tailored garments ship, priced to hurt
(₵600–2600), which is the economic choice the design asks for: hide it cheaply and lose the slot, or
pay a great deal and keep your loadout.

### The mutagen, and the only path that drinks it

`item_wb_mutagen` carries the `mutagen` tag. `cmdUse` routes it to `MUTAGEN_CONSUME` (its own Action,
because `consume.begin` is already owned by the consume plugin and the registry is
one-handler-per-type). **That dispatch is the only path that consumes a flask**, and the gate sits
behind it, so buying or being given one and drinking it early cannot work. A refusal returns *without*
reaching `applyItemUse`, so the item is not spent.

The refusals never name rep, flags or Inner Circle. A player who has not been through the Quickening
should learn the gate's shape from the Wildblood, not from an error message.

### The Quickening

Three quests through the existing Thornwarren NPCs, paying **950 rep** in total, which clears the
Inner Circle threshold the gate requires; the last one sets `wildblood_quickened`.

| quest | who | what |
|---|---|---|
| `quest_wild_seen` | The Chorus | restitch the gate mask lining |
| `quest_wild_proving` | Bracken Hale | walk the road past the wall, check the fixings |
| `quest_wild_quickening` | The Chorus | stand in the Pool at `zone_scw_1057_988` (radiation 70) |

The first hangs off a line the Chorus **already said** as flavour: *"the mask is on the rack by the
gate and the lining wants restitching, if you have a needle and a free afternoon."* That was authored
as texture; it is now the door.

Every task is a chore, on purpose. `scarletwastes.md`'s rule holds: **the terror is on the approach,
the inside is domestic, and nothing ever remarks on the difference.** No NPC argues the point about
the trophy road and no step rewards a player for working it out.

`registerConditionShape('ideology_rep', …)` was added in `plugins/ideologies` so authored dialogue
can gate on standing directly. Before this the only way was to mirror rep into a flag by hand and
keep the two in step forever. Unknown tiers **fail closed**, like every other condition shape.

---

## Phase 3 — the authoring seam and the supply

### `GRANT_MUTATION`

The action named in `wildblood-stronghold.md` as the one net-new mechanic the Wildblood content
needed. Flat params, like every VINE action:

```json
{ "type": "GRANT_MUTATION", "mutation_id": "mut_thornhide", "expression": 45 }
```

`expression` is optional and rolls on the mutation's own ladder when omitted, which is almost always
right — an authored 90 is a designer deciding something the distribution exists to decide.

**The gate still applies.** A mutagen-source mutation granted this way goes through
`applyMutagenMutation` and is re-checked, because an authored action is still a door and §5 says
every door is checked. A refusal comes back as a `dialogue_line` rather than an error, so a mis-gated
node reads as a beat instead of a bug. Radiation-source mutations are ungated: a script that
irradiates you is describing something the world did *to* you.

### Mutagen supply

§6 says mutagen must be scarce and must not be a normal vendor commodity. Rindle stocking it looks
like a violation and is not, because of **how his shelf works**: `vendor_inventory` entries carry
`min_trust`, and trust is a numeric player flag named by `npcs.flags.trust_flag`. Nothing in the game
raises `wildblood_trust` except the Quickening arc, which sets it to 1, 2 and 3.

So the flask sits on a shelf that **does not exist** for anyone who has not been through the Pool, at
₵4000, from one trader in a walled town four regions out. That is scarcity enforced by the mechanism
the game already uses for every other under-the-counter good, rather than a second bespoke gate. The
tailored garments ladder up the same flag, and Rindle's ordinary medicine stays open to strangers.

`mut_thornhide` is granted at the Pool through `GRANT_MUTATION` rather than as a quest-reward flag,
so its expression rolls properly. It is deliberately the **mildest** thing in the mutagen pool: it is
what the Pool gives everybody, so it has to be the floor of the Wildblood experience rather than a
prize — and it is `obvious`, because the whole social mechanic depends on the first one showing.

---

## Flight

`flight` spent two phases registered-and-unconsumed, and the reason is worth keeping: the obvious
reading of "wings" is **falling more slowly**, and this game has no fall-damage system to ride.
Building one for a single mutation would have been exactly the parallel-system trap the effect
registry exists to prevent.

The fix was to stop asking what wings do to *gravity* and ask what they do to a **map** and a
**fight**, both of which the game already models. Four seams, no new systems:

| seam | what it does | where |
|---|---|---|
| **cliffs** | the one named exemption to `engine:impassable-terrain` | `commands/movement.js` |
| **water** | you cross dry, on the same path a boat uses | `plugins/swimming` |
| **fleeing** | +6 to the flee contest | `playerFleeRoll`, `combat.js` |
| **swoop** | the power move | `plugins/mutations/organs.js` |

Three rules hold it in shape:

- **The cliff exemption is not a gear exemption and must never become one.** That gate's own comment
  always anticipated "one named exemption, the way `bypassEncumbrance` is" — this is it. Nothing you
  can buy, steal or carry opens a cliff; it takes a body that grew wings, at high expression, at the
  cost of your torso armour slot permanently. The map still reads true for everyone who didn't do
  that, which was the property the no-climb rule was protecting.
- **Wings help you LEAVE a fight, not survive one.** The bonus is on the flee contest only, never the
  in-fight dodge. Regress asserts `defenseBonus` is untouched — the day that changes, flight has
  quietly become a combat mutation.
- **`swoop` is positional, not stronger.** One hit from above, aimed at the head, with a stun; then
  you are on the ground in the middle of them. The stamina cost and the 45s cooldown are what stop it
  being an opener you spam, and it routes through `applyStrikeToEnemy` so the head multiplier, typed
  soak, injury observers and loot-on-death all apply exactly as they do to a swing.

Water is deliberately **surface only**. Wings are no help once you are under, the same way a boat
isn't, and folding flight into the existing boat path rather than giving it a parallel one means
submersion, the breath timer, wetness, cold and the stamina drain all get it for free.

---

## The turn — what it costs to change

**Mutating is an injury.** Not a notification, not a level-up. `plugins/mutations/onset.js` registers
a `turning` status (and `turning_deep` for mutagen) applied on the `mutation.gained` event, which the
substrate emits from **every** grant path — the radiation roll, the flask, and any authored
`GRANT_MUTATION` — so a future path cannot hand somebody a new body without the body objecting.

What it does:

- **Real HP, up front and per tick.** Ordinary damage on the ordinary pool, so a medkit, a clinic, a
  bed and time all mend it the normal way. Nothing here invents a second kind of wound.
- **Most of your stamina, immediately.** Whatever you were about to do, you are not doing it.
- **Weakness while it runs** — negative Brawn, Reflexes, Endurance and Cool, plus blunted senses.
  This is the half the player feels in play rather than in the log.
- **No organ can be fired mid-turn.** The thing being built does not take instruction yet.

Duration and severity both scale with expression, so the legendary outcome everyone wants is also the
one that nearly finishes you. **Mutagen is worse than radiation on every axis** — longer, harder,
heavier weakness — because it is a deliberate demolition rather than an accident your body is coping
with badly. That gap is the price of the better ladder.

**It cannot kill you.** HP is floored at 1, the same rule the Custodian turrets follow. Dying to your
own biology mid-turn would be unreadable, and would teach players not to touch the content they went
and found.

### Why the Wildblood give you a room

This is the mechanic that makes the Quickening's fiction true. The Chorus already says *"you will be
sick for a week"* and *"Gristle will sit with you for the week"* — and until the turn existed, that
was a good line over nothing. Now it describes what the status does: you are on your back, weak,
bleeding HP, in a walled town four regions from anywhere, with somebody you have done three jobs for
watching the door.

Take mutagen in an alley in Coldwater and nobody is watching the door.

---

## Diagnosis and suppression

Three tiers at three prices, which is what makes the mutation economy a choice rather than a savings
target:

| tier | what you buy | permanence |
|---|---|---|
| **diagnose** | a NAME | information only |
| **suppress** | an evening of quiet | wears off |
| **treat** | expression walked back | permanent, expensive |

**Diagnosis is mechanically inert, on purpose.** A mutation you cannot see is one you have no way to
identify: you know something is wrong and that is all you know, so the `mutations` verb shows it as
*"Something unnamed"* until a physician names it. A diagnostic that also *improved* the outcome would
make not-knowing a penalty rather than an information state, and the information is the product.
Visible mutations arrive already diagnosed — you do not need a doctor to tell you your hands have
claws on them.

**Suppression reaches everything through one chokepoint.** `effectiveExpression()` is the only place
a calculation reads expression, so a suppressed mutation soaks less, glows less, hits softer and may
stop blocking your trousers, all from one timestamp. It does **not** cure: the raw expression is
untouched and the UI says *"suppressed to 17%"* rather than reporting 17%, because the second reads
as the drug having fixed something. It does not stack, re-dosing never shortens a running course, and
it lapses lazily with no tick.

---

## Clone inheritance

`mutations.clone_inheritance` ∈ `all | none | radiation_only | mutagen_only`, applied on
`player.respawn`. **Defaults to `all`, which is exactly the behaviour that already shipped** —
mutations persist through the vats, radiation resets to 0. The column exists so a specific mutation
can opt out without anybody inventing a second biology to contradict the first. An unrecognised value
fails toward *keeping* the body you had.

---

## The social ladder

`plugins/mutations/reactions.js`, on `zone.entered`. **The city is socially hostile long before it is
physically hostile** — there is no "mutant = attack" rule in the file and regress asserts none of the
lines is violence. What there is instead is what ordinary frightened people do: look, stop looking,
move, say something, gather, and eventually one of them goes to find somebody official. Every rung is
survivable; the accumulation is the punishment. It emits `mutation.reported` as the seam the wanted
system can hang off later.

Two rules shape it:

- **`concealable` draws nothing.** If it is under a coat there is nothing to react to, and if it is
  not, visibility has already called it `obvious`. A room reacting to something nobody can see would
  teach the player that concealment does not work.
- **NONE OF IT FIRES IN THE SCARLETWASTES.** A hard region check, not a tuning value. In the
  Thornwarren a changed body is the normal kind, and a town that recoiled from its own people would
  break the one thing the region is for.

---

## Deferred

**Nothing.** Every registered effect key has a reader, and regress asserts the unconsumed list is
**empty**. Adding a key without one requires a comment in `mutation-effects.js` saying why, and the
cap raised deliberately in the same commit. That friction is the whole discipline keeping this system
out of the inert-JSONB state it started in.

> **Regress note.** Granting a mutation now puts a body through a real turn, so any suite that grants
> one on the SHARED fake player must restore its HP, stamina and statuses afterwards. Skipping that
> leaves the player winded and the sneak and weightbench suites red for reasons that look nothing
> like mutations.
