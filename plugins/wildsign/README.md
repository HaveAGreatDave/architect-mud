# wildsign

Signs of wildlife that `search` can turn up. No verbs of its own; it is a `search.provider`.

## What it finds

**A red-tail's kill site.** Red-tailed hawks in the wastes hunt voles, jackrabbits and lizards
(`crittersAt`, `groundStrike` in `client/shared/birds.js`). Those strikes are a pure function of the
tiles and the wall clock, so this plugin derives them again (`groundKillsSince`) and, if one landed on
the tile being searched in the last hour, reports what is left: fur, blood, a lizard's tail. Under ten
minutes old it reads as fresh.

## Rules

- **Knowledge only.** `search` never pays out (see `plugins/search/README.md`).
- **The prey list is built the way the renderer builds it** (critter ground by flight biome, not a
  building, not a road). The hawk picks its target by hashing over that list, so a different list
  means the server names a kill the picture never showed.
- **By day only**, because the windscreen only draws the hunt while the hawk is up.
- Needs a real margin (2), and a failed search is indistinguishable from an empty tile.

Priority 150: after the stray (50), before concealment (200).
