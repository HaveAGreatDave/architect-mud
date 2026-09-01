# demolition

**Status: BUILT.** Rigging, defusing, the fuse, the blast, and both minigames on all three
Display Mode rungs.

Breaching charges. You do not throw one at somebody — you wire it to a thing, choose how long you
have, and then live with having chosen. Full design notes in
[docs/systems-demolition.md](../../docs/systems-demolition.md).

## Verbs

| Verb | |
|---|---|
| `breach <thing> [with <charge>]` | Opens the arming board. Spends one charge, leaves a fuse running on that object. |
| `defuse [<thing>]` | Opens the disarm board against a live charge — anybody's, including your own. |
| `charges` | What is counting down in this room, and how long it has. |
| `breachresolve` / `defuseresolve` | Client→server outcome verbs. Never typed by a player. |

## What it does not own

Damage is `applyStrikeToPlayer`, sound is `propagateSound`, the crime is the `CHARGE_CRIME` action,
and quest progress is one `demolition.detonated` subscriber over in `plugins/quests`. This plugin
imports none of those systems except the first two, and knows nothing about quests at all.

## Authoring

Tag any furniture `demolishable` and it can be wired; add `rig_difficulty` (1–10, default 5) to
make it fiddly. The charge item is anything tagged `explosive_charge` — `item_breach_charge` ships.

## Tests

`regress.js` covers verb routing, stale-resolve rejection, the fire-once fuse, and — the one worth
keeping — that **every Display Mode rung hands back something a player can act on**, which is
invisible from any single rung.
