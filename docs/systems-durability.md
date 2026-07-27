# Durability — gear wearing out, and being put right (As Built)

`player_inventory.condition` (REAL, 0..1) existed since the schema was written and was read by **nothing**. Two plugins wrote it with their own arithmetic and their own destroy-at-zero rules. This system is that column finally meaning something.

Primary files: [server/engine/durability.js](../server/engine/durability.js) (substrate), [plugins/wear](../plugins/wear/README.md) (repair).

---

## The model: condition is the item's HP bar

Wear events deal a fixed **absolute** amount — a landed swing costs the same wherever it lands. What differs per item is **capacity**, and capacity is derived, not authored.

```
durabilityOf(item) = 40 × (value/10)^0.25 × categoryToughness
```

Sub-linear on purpose: a 1000₵ weapon lasts about **three** times as long as a 10₵ one, not a hundred times. Otherwise good gear never wears at all and the system quietly switches itself off for anyone who can afford it.

`value` is authored for shop pricing, not durability, so it *is* wrong sometimes. Two things keep that acceptable: only wearable categories consult it (a 400₵ cognac has no durability), and within weapons/armour/apparel/tools price tracks quality closely enough. `tags.wear_rate` is the rarely-needed override.

**Zero per-item authoring**, and every future item is correct the day it's added.

---

## The six rules

These are the design, not implementation detail. Changing one changes whether the system is realism or a chore.

1. **Wear accrues on USE, never on the clock.** Gear in your wardrobe is untouched forever. This is why — unlike [preservation](../plugins/preservation/), which this is otherwise modelled on — there is no elapsed-time integration anywhere in the file.
2. **Bands, not a bleeding percentage.** The player never sees 87%.
3. **Two-thirds of an item's life is mechanically free.** Worn costs nothing but a scruffier examine line.
4. **Zero condition DESTROYS the item.** It disintegrates and is gone — there is no broken-but-repairable state to fall back on.
5. **Failure is always predicted** — and rule 4 is what makes this load-bearing rather than polite. Destruction is permanent, so the Failing band and the fatigue line on examine are the *only* thing between a player and losing something they cared about.
6. **One glance, not an audit.** Band shows on examine; silent for pristine unmended gear.

### Bands

| Band | at | effect multiplier |
|---|---|---|
| Pristine | ≥ 0.95 | 1.00 |
| Worn | ≥ 0.70 | **1.00 — free** |
| Battered | ≥ 0.40 | 0.85 |
| Failing | ≥ 0.15 | 0.60 |
| **Destroyed** | 0 | the item is gone |

---

## What wears, and what repairs — both derived

```
wears      = weapon | armor_soak | body-slot/accessory apparel | tool   (never a consumable)
repairable = wears && !tags.no_repair
```

**Opt-OUT, deliberately, not opt-in.** Of 481 items, 127 are wearable — so `repairable` as an opt-in would be ~127 tags to author and maintain forever, versus under ten `no_repair` exceptions. But the count isn't the real argument, the failure modes are:

- Forget an **opt-in** → an item that wears down and can *never* be fixed. Silent, player-hostile, indistinguishable from a bug, and it surfaces weeks later.
- Forget an **opt-out** → something repairable that arguably shouldn't be. Harmless.

Default to the direction that fails harmlessly.

> **Wearable ⇒ unique.** Condition is per-row and stacks merge; merging two rows with different conditions is nonsense. The codebase already knew this — the ATM's hack deck is tagged `unique` *"so multiple decks don't share one condition."* Weapons, armour and tools are effectively unique anyway.

---

## Read tier

Wear is applied **on the combat hot path**, so it cannot query.

| Moment | Cost |
|---|---|
| swing / hit taken | Map lookup + arithmetic. **Zero queries.** |
| flush | one coalesced multi-row `UPDATE` on `1m` |

`wear()` is **synchronous by contract** and must never learn to await.

The rows it reads are ones the live player already caches: `player._wornRows` (slot → worn row, rebuilt by `recomputeEquipped` — which now selects `pi.id`/`pi.slot`/`pi.condition` on a query that already ran) and `player._equippedWeapon` (5s TTL cache, likewise extended). Neither adds a round trip.

The flush does its arithmetic **in the database** (`GREATEST(0, condition - amount)`) so two sessions wearing the same row can't clobber each other with stale reads. A failed flush puts the deltas back and retries.

---

## Field contract

| Field | Shape | Written by | Read by |
|---|---|---|---|
| `player_inventory.condition` | REAL 0..1 | `flushWear` / `repairItem` — **durability.js only** | `effectiveCondition`, and through it everything |
| `player._wearPending` | `Map<invId, amount>` | `wear` (add) / `flushWear` (clear) | `effectiveCondition`, `flushAllWear` |
| `player._wornRows` | `Map<slot, row>` | `recomputeEquipped` | `wearStruckArmor` in combat.js |
| `custom_data.repairs` | int | `repairItem` | `conditionLine` |

**One funnel.** The two pre-existing writers were converted in the same change — the ATM hack deck ([atm/index.js](../plugins/atm/index.js)) and the fishing rod snap ([fishing/index.js](../plugins/fishing/index.js)). Both already destroyed the item at zero, which is now the shared rule rather than two local ones.

**Condition is consumed, not just displayed.** `playerPartSoak` scales the struck slot's soak by its band (battered armour soaks less), and player weapon damage scales the same way — both read from the cached rows, so still zero queries. Wearing out costs you something before it costs you the item.

## Accrual points

All inside [combat.js](../server/engine/combat.js), all explicit and greppable:

| Event | Wears |
|---|---|
| player lands a hit (enemy / NPC / PvP) | the equipped weapon |
| player takes a hit (enemy / PvP / `applyStrikeToPlayer`) | the armour on the **struck part** only |
| failed ATM breach | the hack deck |
| botched reel | the rod |

Getting hit in the leg does nothing to your helmet.

---

## Fatigue — why you can't mend a thing forever

Every repair leaves the item more likely to simply **go**. Not worse in the bands — a mended coat is exactly as good as its condition says — but brittle: each unresolved mend adds **1.5% per wear event** (capped at 12%) that it fails outright instead of degrading another notch.

```
fatigue      = repairs − fatigue_base
breakChance  = min(0.12, fatigue × 0.015)     ... and 0 unless already Battered or worse
```

The band gate is rule 5 doing its job: **a fatigued item in good condition can never surprise you.** By the time one can go, the game has called it Battered, then Failing, and — once mended a few times — said *"the repairs are starting to fight each other"* on every examine.

That's what stops a starter jacket riding with you for a year on 30₵ of duct tape, without ever making repair feel pointless.

### Reinforcement resolves it

A masterful hand repair stamps `fatigue_base` at the current repair count, forgiving every mend to date. The item ends up **tougher (+20% capacity) *and* no more likely to break than one fresh out of the box** — mends after that start counting again from zero.

This is the second half of why a real tradesman is worth finding. Watts can keep your coat alive indefinitely, but every visit makes it more brittle and he can never undo that. Only a good hand can make it *new* again.

## Repair (plugins/wear)

Registered as a **specialized action**, not a command — which is what makes `repair` shareable rather than owned. Flight's `repair` (a plugin command) runs first and self-gates on "am I at a hangar with a craft"; the engine builtin targets infrastructure; this one answers for carried gear. Different registries, no collision, no `after:` needed. SIFT sorts out what you actually pointed at, and an ambiguous pick replays through the `wear.repair_item` Action (the SIFT replay trap — a builtin replay can't reach a plugin verb).

### Who fixes your gear is a real decision

| | Where | Ceiling | Reinforce? | Risk |
|---|---|---|---|---|
| **Hand** (yours or another player's) | anywhere, needs a `repair_kit` | rises with Fabrication — **0.65 at novice, full at skill 8** | **yes**, on mastery | a botch on a *broken* item destroys it |
| **Bench** (an NPC flagged `repairman`) | that NPC's zone | full | **never** | ~8% chance of a wasted fee |

**Reinforcement is the whole argument for player repairmen.** A masterful hand repair by someone with real skill doesn't just restore the item — it makes it permanently tougher: **+20% capacity, three deep**, riding `custom_data.reinforced`, transferable with the item and stamped with the repairer's name.

Watts cannot sell you that at any price. A bench *restores*; it never improves. So the choice is genuinely three-way:

- **Watts** — certain, same-day, and **expensive**: `max(25, value × 0.9 × missing)`, discounted by your [standing with him](systems-relationships.md). You are paying for convenience and certainty.
- **A good hand** — cheaper by negotiation, and can give it back *better than new*.
- **A bad hand** — cheapest, and may finish off what was already broken.

Reinforcement is gated on **both** a masterful roll (margin ≥ 8) **and** Fabrication ≥ 6, so it can't be farmed by a novice getting lucky. It surfaces on examine — *"Someone who knew what they were doing has been at it by Dud — it is noticeably tougher than it has any right to be."* — which is how a player builds a reputation the game never has to track for them.

Difficulty scales with item value, so the gear you care about is exactly where the difference between a master and a chancer shows.

**Outcomes** are margin-driven — `rough` / `sound` / `masterful`. A failed repair costs 5% progress, never the item. **The only way wear ever loses you an item** is botching a *hand* repair on something already **broken**, and that's a decision made with the risk stated.

**Items accumulate history.** `custom_data.repairs` surfaces on examine — *"battered, twice-mended."* Nearly free, and it's the thing that makes a player keep a jacket they should have replaced.

---

## Known gaps

- **Combat is the only accrual source.** Weather exposure, scavenging, mining and swimming should all wear gear and don't yet — each is one call at an existing funnel.
- **Repair is not yet a JOB.** Reinforcement makes a skilled player worth seeking out, but there is no shift at a bench (the work-plugin SHIFTS archetype) and no repair commission on the job board. Player-to-player service works today only through the existing trade window — hand it over, they fix it, hand it back, pay via the pay plugin — with no in-game way to advertise.
- **Only combat consumes `conditionPenalty`.** Tools (rods, decks, mining gear) don't yet get worse as they wear — they just die at zero.
