# climbing

## Purpose

Some of the world is above the rest of it, and until now the only way up was to
have grown wings. Roughly 737 tiles across Terminus, Deadwater and the
Scarletwastes — including the whole southern and eastern outside of Terminus, more
than half that region's walkable ground — sat behind cliff lines with no route into
them at all. This is the way in for somebody who came prepared.

The engine owns the law (`engine:impassable-terrain`, in
[server/engine/commands/movement.js](../../server/engine/commands/movement.js)) and
the property (`propsOf(id).climbable`). It knows nothing about rope. This plugin
answers the one question the law asks — *may this body go up this face?* — through
`registerClimbProvider`, so neither side imports the other.

## The rule it had to survive

Cliffs used to carry a written prohibition on exactly this feature:

> No climb, deliberately, and no GEAR exemption. A wall you can sometimes get over
> is not a funnel, it is a difficulty check, and the whole value of the feature is
> that a player can look at the map and KNOW where the ways through are.

That is still the law. What changed is **where it binds** — the exemption is a
property of the TILE, not of the gear:

* **A bare `cliff` is absolutely impassable and always will be.** Nothing you can
  buy, steal or carry opens one. Wings remain the only exemption. The regress suite
  asserts this twice, once with the rack in hand, because it is the invariant every
  funnel and wall in the world rests on.
* **A `scree` tile is painted.** Its own terrain, its own fill, its own name on the
  map. "Where are the ways through" is still answered by looking; there is simply
  one more kind of way through, and it is drawn.
* **Passage is deterministic.** Never a roll — twenty identical asks give twenty
  identical answers. The Climbing skill scales the *cost*, the way Swimming scales a
  stroke; it does not decide the outcome. "Sometimes" was the thing the rule
  forbade.

## How it works

| | |
|---|---|
| **Gear** | Any item tagged `climbing`, carried loose or worn — the same uncontained test the `boat` and `rebreather` tags get. `item_climbing_rack` is the first one (Wendel Corry at the Bolt Keeper, ₵300; Rindle Ashcroft in the Thornwarren, ₵275). |
| **Cost** | `climbCost(eff)` — 34 stamina at effective skill 0, floored at 7, 2 off per point. Charged on `zone.entered`, never in the check: a provider that drained stamina would charge for climbs a later gate vetoed. |
| **Skill** | `climbing` (Brawn + Endurance). Trained by climbing. No check anywhere. |
| **Reserve** | You must arrive with 5 stamina to spare, or you are refused. Without it the honest failure mode is somebody stranded on a shelf they no longer have the stamina to leave — the same stranding this whole feature exists to end. |
| **Mutations** | `claws` and `extra_limbs` fold into effective skill (+3 each) — better at it, not excused from it. `flight` skips the path entirely; the engine gate lets wings through before it ever asks. |
| **Free moves** | A system move (`shove`, `.gohome`, a respawn) pays nothing — the same `bypassEncumbrance` exemption the encumbrance law takes. |

## Seams

* **Provides** — `registerClimbProvider` (engine, [movement-gates.js](../../server/engine/movement-gates.js)).
  Fails closed: with no provider registered a climbable tile is an ordinary cliff.
* **Consumes** — `zone.entered` (charges the stamina, narrates, awards IP).
* **Verbs** — none. `climb` is owned by the flight plugin, and this needs no verb
  anyway: you walk into the tile, exactly as you walk into water.
* **Tables** — none.

## Adding a route

Paint a cliff tile as `scree` in the Studio, and give it a name and a description
that say there is a way up it. Nothing else is needed — the cliff tiles already
carry reciprocal exits with their neighbours (the law is a *gate*, so the exit graph
stays true), which is why the twelve existing routes cost twelve terrain values and
no wiring at all.

⚠ **Never paint scree where a cliff is doing structural work.** A cliff that seals a
town, a quarantine or the far side of a quest is a funnel somebody built, and a
scree tile through it is a back door with no lock on it.
