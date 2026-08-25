# The Turning — the two rites (as built)

**STATUS: BUILT, both halves.** The Ascendant arc (§1–6) and the Long Watch
mirror (§8) both ship, including the three mastery instructors that the
discipline had been missing entirely. One half of "free rein" is deliberately
deferred (§7).

The first arc in the game where a player changes **which side they are on**, and
the first faction ladders anybody can climb rather than talk their way up. Two of
them, deliberately shaped as opposites: the Ascendants sell you a better body,
the Long Watch teach you to use the one you have.

---

## 1. The hook was already standing, wired to one exit

Nothing about the entry to this arc is new. It has been in the world since the
Ascendant Stronghold shipped:

| Beat | Quest | Who |
|---|---|---|
| The Watch send you west to find where Halcyon's money goes | `quest_asc_1` | **Cyrelle**, of the Long Watch |
| A recruiter meets you at the plaza; you take the Gate scan | `quest_asc_2` | **Maresh** |
| The Gallery, a resurrection in the Vats, the Sanctum | `quest_asc_3` | **Curator Vess** |
| *"Halcyon Assurance does not insure against death. It insures death itself."* | — | **The First Ascended** |

At the end of that, exactly one person asked for an answer: Cyrelle, through
`halcyon_reveal`, who sends you to extract Sub-Registrar Nine (`quest_lw_4`).
Meanwhile The First's own closing line already read:

> *"When you're ready to stop merely dying, the clinic is downstairs, and your
> account is already open."*

**There was no account.** This arc is that account. The player had been offered
the choice in prose for months and could only ever take one side of it.

## 2. The turn is a fitting, not a conversation

`quest_asc_turn` — **The Account**. Two objectives: `talk` to Dr Kesh, then
`install` anything.

The pledge is deliberately not a dialogue option that sets a flag, because the
point of no return **already exists in the engine and is better than anything
this arc could invent**: `chromed_ever` (`plugins/augments/install.js`) fires on
your first fitting, burns off every mutation you carry, and permanently closes
the flesh path. So the quest walks you to a door the game already had, having
told you what is on the other side of it.

Reachable on arrival: the Spire tour leaves you at 380 Ascendant rep, over
`MIN_INSTALL_TIER` (Known, 200). Nobody has to grind to defect.

Pays **+250 Ascendants / −150 Long Watch** through `rewards.rep`.

## 3. Favour is `player_ideology_rep`, and the rungs were already load-bearing

| Tier | Rep | What it opens | Who reads it |
|---|---|---|---|
| Known | 200 | The clinic will cut you | `MIN_INSTALL_TIER` |
| **Trusted** | 500 | The loyalty mission; `aug_halo_collar` | `aug.rep_gate`, the `ideology_rep` dialogue condition |
| **Inner Circle** | 900 | The Rite; `aug_cortical_backup`, `aug_seraph_lattice` | same |

**No mirrored flags.** The dialogue gates use the `ideology_rep` condition shape
(registered by `plugins/ideologies`), which is the same number `installAugment`
reads — so "they trust you" means one thing on this campus, and the fiction and
the shop cannot drift.

Six jobs, spread across the cast who would plausibly hand them out, and each one
reaching a **different built system** rather than walking you to a tile:

| Quest | Giver | Rep | What it actually uses |
|---|---|---|---|
| **Actuarial** ♻ | Vess | +40 | `visit`. Deliberately banal — price the Boulevard and the Row, which share a description in the data, and get different numbers |
| **Lapsed** ♻ | Vess | +60 | `subdue` + `retrieve`, with an `assassinate` **fail_on**. Halcyon does not kill clients; it repossesses |
| **Adjuster** | Vess | +90 | `hack`, with `spotted` **and** `witnessed` fail conditions |
| **A Warm Lead** | Maresh | +80 | `escort`, `escort_lost` fail |
| **Within Tolerance** | Duc | +70 | `install` + `broke` fail |
| **Cold Chain** ♻ | Vess | +35 | `visit` chain |

♻ = repeatable. **The repeatables are structural, not filler.** Standing decays
toward its resting point on a 30-day half-life by design
([systems-ideologies.md](systems-ideologies.md)); an order with only one-off work
has no mechanism by which a player stays in it. These are the first repeatable
faction quests in the game.

One pass of all six is +375, which carries a pledged player from 630 to Inner
Circle without repeating anything.

⚠ **A repeatable quest's offer must be gated on `op: 'neq', value: 'active'`,
never `op: 'unset'`.** A turned-in quest's status flag reads `turned_in`, which
IS set — so the obvious condition retires a one-off correctly and hides a
repeatable *forever*, which reads as an NPC who quietly stopped having a job.

## 4. The loyalty mission is the inverse of the Watch's own work

`quest_asc_loyalty` — **Restoring Service**. Go and turn the eastern approach
cameras back on: the exact ones `quest_lw_2` and `quest_lw_3` had you blind.

Nobody dies, and that is the point — The First says so: *"a corpse is an
argument, and an argument can be won. A road that can see again is simply true."*
Pays **+200 Ascendants / −400 Long Watch** and sets `lw_burned`.

## 5. The Rite is a claimed death, over an economy that already shipped

`quest_asc_rite` — three objectives: `visit` the Nave, `visit` the Uplink,
then **`restore`**.

`restore` (added with the Phase 1 enabling layer) advances only on a **claimed**
death — one somebody arranged for in advance. Which means the whole existing
Ascendant economy has to be standing behind you before the quest can finish:

```
augment install cortical backup   (rep_gate: inner_circle — the summit rung)
assurance                          (buy the policy → restores_remaining)
backup                             (commit the pattern → pattern_at)
```

With all three, `plugins/augments`' `player.respawnZone` hook claims your next
death: you get up in the Vats, your chrome is **not** corrupted (corruption skips
a claimed death), and `player.death` carries `claimed: true`.

**The ceremony is real because the paperwork is real.** `plugins/ascendant/rite.js`
adds exactly one thing to all of that: the verb that kills you.

### `ascend` — the verb

Furniture-flagged (`flags.asc_rite` on `furn_asc_uplink_terminal` in
`zone_asc_shrine_uplink`), so content decides where the ritual stands and the
plugin never names a room — the same shape the Purifier uses. Arm-then-run
confirm, also copied from the Purifier: **the two rituals are each other's
undoing and it is right that they ask the same way.**

⚠ **The refusals are the feature.** A quest objective can say "die a claimed
death"; it cannot say "and if nobody has your pattern, don't". Four gates, each
naming the missing thing and where to get it:

| Missing | Refusal |
|---|---|
| the cortical augment | *"nothing here to copy"* |
| a policy | *"a backup with no policy behind it is a photograph"* |
| a committed pattern | sent to the Registry to `backup` |
| **a clean record** | *"there is a warrant against this body"* |

⚠ **That last one is not decoration.** `onRespawnZone` declines to claim the
death of anybody at 1★ or more — the police take that body. A wanted player at
the Uplink would die **unclaimed**: no restore, chrome corrupted, quest not
advanced. It would look exactly like it worked, right up until it didn't. Regress
asserts this refusal by name.

⚠ **`requiredFlag` gates discoverability, not execution.** `fireSpecializedAction`
fires every registered handler and expects each to resolve its own target, so the
handler checks the room itself and returns `undefined` when there is no terminal.

## 6. Irreversibility — three levers, none of them new

The arc is meant to be very hard to walk back. Every mechanism that makes it so
was already implemented:

1. **`chromed_ever`** — the first fitting burns the flesh path out permanently.
2. **The −200 resting floor.** `restingRep` floors you there when you are
   opposite stance **and** a different path. The Rite sets stance `redeem` and
   path `machine`, so the Wildblood, the Exodus and the Null rest at −200
   *forever*: the world stops climbing back for you and only action moves it.
3. **The only door out is the enemy's.** The Purifier (`furn_exo_purifier_real`,
   `zone_exo_stillhouse`) strips every augment and every mutation — at 20 sanity,
   real damage through `applyStrikeToPlayer`, a knockout, and it awakens you as
   **Exodus**.

That third one is the design, and it is better than a hard lock: Ascension *can*
be undone, and the only way is to crawl to the people you spent the arc betraying
and let them take everything you bought. The First names it in the warning,
with contempt rather than kindness — *"there is one way back, and it is not
ours."*

## 7. "Free rein over the city" — what ships, and what is deferred

Already working, no new code:

- **Prices.** `getIdeologyDiscount` is read by `server/engine/vendor.js` and
  `server/engine/furniture-shop.js` on every purchase, keyed on the NPC's
  faction. Ascendant standing is already money off Ascendant counters.
- **The campus.** `isCleared` (`plugins/ascendant/index.js`) passes anyone
  chromed, so the Threshold stops being a wall the moment you take the account.
- **The hardware.** Two new rungs at the top of the ladder — `aug_halo_collar`
  (Trusted) and `aug_seraph_lattice` (Inner Circle) — because the ladder ran all
  six rungs already but its summit was a *backup*, which is insurance rather than
  a reward.

**Deferred deliberately: wanted-star suppression.** Halcyon is an insurer, and a
policyholder's misdemeanours being quietly settled rather than prosecuted is the
right fiction. It is also a change to the law system with no existing seam —
`plugins/surveillance` exposes no leniency hook — and inventing one to make one
faction's members harder to arrest deserves its own decision rather than arriving
as the tail end of a quest pack. Not a gap; a call.

## 8. The Long Watch mirror (as built)

A literal mirror would be wrong, and [systems-mastery.md](systems-mastery.md)
says why: a Long Watch veteran **must not look supernatural on inspection**, so
the order grants no permanent passive at all. Their rite cannot be a thing done
to you. Every row below is an inversion rather than a copy:

| | Ascendants | Long Watch |
|---|---|---|
| Favour | `rewards.rep`, same ladder | `rewards.rep`, same ladder |
| Climbing buys | better **hardware** (`rep_gate`) | better **teachers** (`rep_required` + `max_rank`) |
| Loyalty test | one irreversible **act** | a **duration** you can blow at any moment |
| The rite | an upload; you die in white fire | a vigil; you sit still and nothing happens |
| The door out | the Exodus's chair | the Ascendants' clinic |

### ⚠ 8a. Mastery had no front door at all

Before this pack, **`grep -rl mastery_instructor content/` returned nothing.**
The plugin shipped a `train` verb, a reputation gate, a purity gate, a
per-instructor ceiling and a teaching step — and there was no teacher anywhere in
the Basin for any of it to apply to, so `train` could only ever answer *"nobody
here teaches that"*. The Long Watch's entire discipline was unreachable while
being documented as built.

The three instructors are therefore the pack's reason to exist, and they double
as the reward ladder — the order's whole answer to a shelf of chrome is that you
climb their standing to be **taught by somebody who knows more**:

| Teacher | Where | Gate | Ceiling | Teaches |
|---|---|---|---|---|
| **Pike** | The Threshold | Known (200) | 35 | `body`, `breath` |
| **the Quartermaster** | The Bunkroom | Trusted (500) | 65 | `senses`, `will` |
| **Teague** | the Under | Inner Circle (900) | 100 | `movement`, `pain`, `mind`, `combat` |

Teague is deliberately the furthest away and the only one who can take you to the
ceiling. **No second gate was added to reach her** — the Rite's reputation reward
is what carries you to Inner Circle, so the rep she already checks *is* the gate.

`plugins/mastery/regress.js` now asserts that at least one NPC teaches, that
every instructor config names real disciplines, and that somebody can teach to
100 — a content check living in the plugin that would be dead without it.

### 8b. Favour work

Five jobs, three repeatable, each the Watch's own argument about itself:

| Quest | Giver | Rep | Uses |
|---|---|---|---|
| **Bench Time** ♻ | Halloran | +45 | `craft` — the only type that already means *made, not bought* |
| **Closing an Eye** ♻ | Nyall | +65 | `hack` + `spotted`/`witnessed` fails. The inverse of Restoring Service |
| **A Turn on the Blind** ♻ | Pike | +40 | a 30s `visit` vigil |
| **Carry It Back** | the Quartermaster | +55 | `retrieve` + `visit` |
| **Quiet Hands** | Teague | +70 | `subdue` with an `assassinate` fail |

**Quiet Hands is the deliberate twin of the Ascendants' *Lapsed*** — the same
verb, the opposite reason. Halcyon leave you breathing so you can resume
payments; the Watch leave you breathing because *a body is a reason for somebody
to come and look*.

### 8c. The loyalty test is a duration, not an act

`quest_lw_loyalty` — **Nothing Bought**. The Quartermaster hands you a purse
heavier than the errand needs and a parts list that only sells on Halcyon
Boulevard, and the last item is behind the **clinic counter**, where you wait 20
seconds being offered something better at a discount.

`fail_on: [{type:'install'}, {type:'mutate'}]`. They do not ask you to hurt
anybody. They put you in the one place where the shortcut is on a shelf at eye
height, give you a reason to be there a long time, and see whether you come back
the same shape. The **stain** (`purity.js`, which decays rather than clearing) is
what stops you renting chrome for the trip.

### 8d. The rite needs no verb, and that is the point — DESIGN, NOT BUILT

⚠ **Corrected 2026-08-25. This section described a quest that does not exist,
and named one that does.** It read: "`quest_lw_rite` — **The Long Watch**. Pike
gets off the stool and does not come back. One objective: a `visit` to The Blind
with `taskSeconds: 180`." None of that is in the content tree. `quest_lw_rite`
is the **faction-arc slot 10** ([systems-faction-arcs.md](systems-faction-arcs.md)):
five objectives, a charge, the vat colonnade, Verity Ives at the gate and a run
home. It has no `taskSeconds` at all, and the longest tile task anywhere in the
quest tree is **90 seconds**, in `quest_lw_meet`. Same failure mode as the
`mastery_instructor` case two sections up — a design written down in the present
tense and then read back as shipped.

**What actually ships** is `quest_lw_fav_sit` (*A Turn on the Blind*): a
**repeatable favour**, one `visit` to `zone_lw_blind`, `taskSeconds: 30`, +40
standing. It is the same idea at a tenth of the length and none of the weight —
a chore, not a rite.

**The design below is still the right one and is worth building.** The Ascendants
needed `ascend` because dying has to be *triggered*. Standing a watch is the
**absence of action**, so the engine's existing rule that any non-passive command
cancels a tile task **is** the test. There is no failure message and no penalty —
you sit it again, which is the most Long Watch outcome available. Zero new code.

If it is built it wants its own quest id rather than `quest_lw_rite`, which is
spoken for, and the gate described here — membership, the loyalty test, Inner
Circle standing, and `{ mastery: 'any', min: 25, pure: true }` — is a **mastery**
gate, not an arc gate. It belongs to the instructor ladder, not to slot 10.

### 8e. The `mastery` condition shape

Registered by `plugins/mastery/index.js` beside `ideology_rep`, because
reputation alone would be the wrong door on the one order whose argument is that
standing is not a substitute for having done the work.

```jsonc
{ "mastery": "body", "min": 40 }             // that discipline is worth 40
{ "mastery": "any",  "min": 40 }             // your best one is
{ "mastery": "any",  "pure": true }          // and the body carries nothing
```

⚠ **It reads `effectiveRank`, never `storedRank`.** The purity cap applies on
read by design, so a gate on the raw number would let somebody bolt on an arm and
still walk through a door the discipline is meant to hold shut. `pure` is the
stricter claim — a cap of 100 means no chrome, no mutation **and no stain**,
which is what makes clean cost time rather than a trip to a surgeon.

⚠ **It must never read `regardOf`/`standingGreeting`.** Those exist to be *said*,
never checked; `purity.js` says so at length. This shape is the sanctioned way to
gate on the body, and the social ladder is not and never will be.

**The symmetry worth protecting: each order's only exit runs through its rival's
ritual.** Purifier ← Ascension → clinic.

## Files

- `content/quests/quest_asc_turn|asc_fav_*|asc_loyalty|asc_rite.json`
- `content/npcs/npc_lapsed_client.json`, `npc_asc_prospect.json`, plus dialogue
  merged onto `npc_asc_first|vess|recruiter|duc|kesh|orrin`
- `content/furniture/furn_asc_uplink_terminal.json`
- `content/augments/aug_halo_collar.json`, `aug_seraph_lattice.json` (+ 4 items)
- [plugins/ascendant/rite.js](../plugins/ascendant/rite.js) — the `ascend` verb
- `content/quests/quest_lw_fav_*|lw_loyalty|lw_rite.json`,
  `content/npcs/npc_civic_counter.json`, plus instructor flags + dialogue merged
  onto `npc_lw_pike|quartermaster|teague|halloran|nyall`
- [plugins/mastery/index.js](../plugins/mastery/index.js) — the `mastery`
  condition shape
- Regenerate with `scripts/content/build-ascendant-turn*.mjs` and
  `build-longwatch-*.mjs` (all re-runnable; dialogue merges by node key and root
  options are stamped so a re-run replaces its own work rather than duplicating it)
