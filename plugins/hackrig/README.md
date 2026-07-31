# hackrig

Practice rigs: legal, low-difficulty `hack` targets that exist purely so Hacking
can be levelled without committing felonies at the skill level that guarantees
you fail them.

## Why it exists

Every other `hack` target is a crime against something that fights back — an ATM
that can electrocute you to death, a vendor safe whose owner never trades with
you again, a hololock that reports a burglary. That's right for the payout they
carry, but it left no on-ramp: the only way to get from Hacking 0 to competent
was to keep failing crimes.

A rig has nothing behind it. Same Circuit Breach minigame, same deck
requirement, **no credits, no crime, no shock.** The cost of the grind is the
deck: a failed attempt burns condition exactly as a failed live breach does, so
the skill has a running hardware bill. That is the only thing standing between a
practice rig and free XP, and it is deliberately the whole design.

## What retires it

The rig does not get harder. **You do**, and that's what evicts you.

`awardSkillUse`'s third argument is the skill-check **margin**, not an award
amount — [ip.js](../../server/engine/ip.js) rolls
`chance = base / (1 + |margin| × scale)`, so you learn most at the edge of your
ability and nothing at all from a walkover. **Every** hack target now scores on
the true gap (`marginOf` in [hack-gear.js](../../server/engine/hack-gear.js)), so
the rig isn't a special case — it's just the **easiest** target, and easy targets
stop paying:

| Hacking | vs a difficulty-2 rig | vs a difficulty-5 ATM |
|---|---|---|
| 2 | margin 0 → ~100% | margin 3 → ~14% |
| 5 | margin 3 → ~14% | margin 0 → ~100% |
| 8 | margin 6 → ~8% | margin 3 → ~14% |
| 12 | margin 10 → ~5% | margin 7 → ~7% |

The crossover lands around Hacking 3–4. Past it, grinding the rig is strictly
worse than going and doing crimes, *and* you're burning deck condition to do it.
Nobody has to be told to leave — the numbers evict them, and they keep evicting
you all the way up the ladder (rig → ATM → vault → police network). Once the gap
reaches `OUTGROWN_MARGIN` (5) the rig says so in as many words, because letting
someone grind a dead end silently is the one thing this plugin must not do.

This is why there's no cap, no daily limit, and no escalating-difficulty knob.
Escalation would only move one wall; the shared curve puts a wall behind every
target, in the right place, at any Brains score.

## Authoring a rig

Any furniture row with `flags.hack_rig` is a rig. Optional
`flags.hack_difficulty` overrides the default of **2**; the deck's own
`hack_penalty` is added on top (see `server/engine/hack-gear.js`), so a junk
starter deck reads a difficulty-2 rig as a 4.

```json
{ "id": "furn_twocell_rig", "zone_id": "zone_twocell_interior",
  "name": "practice lock rig", "object_type": "fixture",
  "flags": { "hack_rig": true, "hack_difficulty": 2 } }
```

## Surface

| | |
|---|---|
| Specialized action | `hack` (requiredTag `hack_rig`) — self-gates, so a hololock or vendor safe in the same room still claims the verb |
| Command | `hackrigresolve <rigId> <1\|0>` — silent; the overlay reports its own outcome |
| Ticks | none |
| DB writes | none of its own (skill gain routes through `awardSkillUse`) |

State is in-memory only: a 20-second per-player pacing cooldown and the
anti-spoof pending map every breach path uses.
