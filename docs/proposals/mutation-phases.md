# Mutation phases and the mutation level

**Status: design only.** Nothing here is built. The mutations that ship are in
[systems-mutations.md](../systems-mutations.md), and that doc wins until this one is built.

## The idea

Each mutation grows in phases, and each phase is stronger than the one before. A body has a
**mutation level**, like a character level, which caps at a number still to be tuned. Every dose of
mutagen raises it, and each dose goes on one of two things:

- **growing a new mutation**, which starts at phase 1, or
- **upgrading one you already have** to its next phase.

So two players at the same level end up different. One has spent it all on bone blades and has them
at phase 4. Another has blades, gills and a chameleon skin, all at phase 1 or 2. The cap makes the
combination a choice, and the choice is the build.

## Decided

- **The cap is a fixed maximum level**, the same for every body, tuned later. It doesn't grow with
  standing or stats.
- **Mutagen comes from Wildblood missions.** You earn it by doing work for the order, not by buying
  it. This replaces the ₵4000 flask on Rindle's shelf as the way in.
- **You choose your mutations, in a Wildblood ritual.** A ritual is where mutagen is spent: you pick
  the new mutation, or the one to upgrade. Nothing is rolled at random from the pool.
- **Radiation mutations can be upgraded** with mutagen, the same as Wildblood ones. Radiation still
  can't give you a severe one on its own; pushing one past that is what the Wildblood are for.
- **A clinic can take a phase off, or a whole mutation**, at a price. Taking a phase or a mutation off
  gives back the levels it used, so a clinic is where a build is changed.
- **Clones inherit every mutation and every phase.** That's how clones already work
  (`clone_inheritance` defaults to `all`). Dying doesn't make you redo your mutations; the only way
  to lose one is to have a clinic cure it.

## The Wildblood's machines

The rituals run on machines. Behind the bale, clay and hide, the Wildblood keep their own computer
systems and clone vats, which is how a ritual can give you the mutation you asked for and how they
keep their own bodies the way they've chosen. The primitive look is a style, not a lack of means.

This is canon now: [lore-wildblood.md](../lore-wildblood.md#the-machines) has the machines under the
Fleshery, salvaged from the Under, run off a rotgas generator and never seen from outside. The town
stays fire-lit. The old way, blood drunk in the dark with no machine, still gives Lessons and
Refusals, and that's where a reckless flask fits if it stays.

## How it sits with what's built

**Phase is a second number beside expression.** Expression (1 to 100) is rolled once, when the
mutation arrives, and says how strongly this body took it. Phase says how far the mutation has been
pushed since. A mutation's effects scale with both: phase sets the size of the effect, and
expression sets how much of it this body gets. That keeps the rule in systems-mutations.md that
expression never creeps, because a phase only changes when the player spends mutagen on it.

**Every step is a turn.** The `turning_deep` status already fires on `mutation.gained`. An upgrade
should fire its own event (`mutation.upgraded`, say) and put the body through the same injury,
longer at higher phases. You're sick in the Thornwarren, where the ritual happened and somebody is
watching the door.

**The gate doesn't change.** `canUseMutagen` still asks for Inner Circle standing and the
Quickening. The ritual is the one door to the applier, as `MUTAGEN_CONSUME` is today.

## What a phase does

Each mutation would need its effects authored per phase, in the mutation's content file. Roughly:

| phase | what it is |
|---|---|
| 1 | what a mutation does today |
| 2 | stronger, and harder to hide (visibility goes up a rung) |
| 3 | a new property, not just bigger numbers: blades that cut through soak, gills that work in acid water |
| 4 | the mutation is who you are: it can't be concealed, and the city's refusals key on it |

Phase 3 matters most. If every phase is the same effect with a bigger number, upgrading is a sum
and nobody spreads out. A new property at phase 3 is what makes "one mutation pushed far" a real
alternative to "four mutations at phase 1".

## Still open

- **The numbers.** The level cap, how many phases a mutation has, and whether a higher phase costs
  more levels than a new mutation.
- **Which missions pay mutagen**, and how much. The Quickening's three quests are the first rungs of
  the order's ladder ([systems-faction-arcs.md](../systems-faction-arcs.md)).
- **The flask.** Today you can drink `item_wb_mutagen` anywhere and get a random mutation. With the
  ritual as the place you choose, either the flask goes, or it stays as the reckless way: a random
  new mutation, in an alley, with nobody watching the door.
- **What a clinic charges** for a phase and for a whole mutation, against today's three treatment
  tiers.
