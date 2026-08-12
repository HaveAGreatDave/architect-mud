# topical

**Purpose** — *a liquid landing on a body*, for every liquid the game has.

The world could already put a liquid in a bottle, in a stomach, on a floor and in the sky. The one
case nothing owned was the direct one: somebody throws a liquid **at you**. The crop-duster opened
its booms over a tile full of people and the tile got a line of prose.

The substrate is [`server/engine/topical.js`](../../server/engine/topical.js). This plugin is the
leaf on top: the verb, the switch, and the consequences that need nothing but engine substrates.

## The three rules

**Every liquid wets you — that's a law, not a per-fluid behaviour.** The wetting pass is registered
**once** (`registerTopicalWetting`, claimed by `clothing-wetness`, which owns wetness) and runs for
beer and fuel exactly as it runs for clean water, through the same outside-in layer walk as rain — so
a slicker is worth as much against a thrown pint as against a downpour. What a liquid does *besides*
making you wet is the only per-fluid part.

**Consequences and container schemas belong to whoever owns them.** `registerTopicalEffect(fluid, fn)`
claims a consequence; `registerFluidResolver(fn)` claims a *container*, so the substrate never learns
that a canteen keeps its contents under `fluid_amount` while a cocktail keeps them under `drink`.
`fillable` and `drinks` each answer for their own. A liquid nobody has claimed still lands and still
wets — it just does nothing else, which is right for a fluid the game hasn't given a meaning yet.

**The gate is narrower than "topical contact", and it lives in the substrate.** Nobody consents to
rain. So the question is not *may this liquid touch a person*, it's *did a **person** choose to do it
to a **person*** — `actor && actor.id !== target.id`. Weather, NPCs, hazards and your own bucket land
regardless. The check is inside `applyTopical`, not at each call site, because a gate a caller can
forget is not a gate.

It is an **opt out, on by default**. Default-off would mean the world's liquids do nothing to anybody
who has never opened a settings page — a feature that reads as broken rather than as respected. A
refusal names nobody and tells the thrower only that it came to nothing; refusing shouldn't be a
targeting signal.

## Commands

| Verb | What it does |
|---|---|
| `splash <target> [with <container>]` | Tips a carried canteen or glass over another player in the room. Unnamed, it picks the first thing you're carrying that actually has liquid in it. The container empties whether or not it landed. |
| `sprayconsent off` / `on` | Your switch, on unless you turn it off. Bare `sprayconsent` reports where you stand. Stored in `player_flags.topical_consent`, written only when you change it. |

**A verb, with no tablet surface** — deliberately. The switch you might want in a hurry shouldn't be
four taps inside an app.

Not named `douse` — the **work** plugin owns that verb for a bar shift's fire event, and quietly
winning a collision off load order is how a whole feature goes dead with no error.

## Absorption — on you vs *into* you

The second axis, and the one that makes a splash more than a wet coat:

```
dose = potency × absorb × skinExposure     (below MIN_SYSTEMIC_DOSE = 0.15, nothing happens)
```

- **potency** — how much was thrown. The container's business.
- **absorb** — the liquid's permeability, on its `TOPICAL_FLUIDS` row. Alcohol 0.02 (sits there and
  evaporates), fuel 0.35, chem 0.60, a purpose-built solvent 0.85, water 0.
- **skinExposure** — the fraction that reached **skin** rather than stopping in cloth. The wetting
  pass has always computed this in the outside-in layer walk and thrown it away; absorption is what
  finally needed it. **So a raincoat is chemical protection, for free**, and a sealed shell drops the
  dose to zero. Naked is the worst case.

**What is dissolved in a liquid rides on the CONTAINER, never the fluid table** — a solvent is a
carrier, and the same carrier takes different cargo. `fillable` reads `custom_data.drug_id`, `drinks`
names `drug_alcohol` honestly and then the model correctly does nothing with it: a full pint over a
bare chest lands under the floor. You wear it; you don't drink it.

A real dose goes through the ordinary `useDrug` path on a new **`skin` route** (onset ×4, intensity
×0.7 — the slowest and weakest there is), so a splashed drug is the *same* drug arriving slowly, not
a parallel implementation of being high. The absorbed fraction *is* the strength.

The floor is load-bearing: without it every drink thrown in every bar would apply a rounding-error
of alcohol, and a thousand nothings still add up to a tolerance and an addiction.

**It's a crime.** A harmful fluid, or any splash that actually got into somebody, charges
`assault_chemical` (3★) — forced-witnessed, because the victim was standing right there. A drink in
the face charges nothing: that's a bar, not a crime scene.

## The liquids

Every one of them wets you — that's the law, not a column.

| Fluid | Absorb | Leaves | Besides that |
|---|---|---|---|
| `water` | 0 | — | rinses the sweat meter (clean water only), takes the heat out of an overheated body |
| `dirty_water` | 0 | `grease` | — |
| `booze` | 0.02 | `booze` | the room smells it on you, and on the floor |
| `soft_drink` | 0 | `grease` | sticky |
| `hot_drink` | 0.02 | `grease` | scalds (never cools — the one `hot` fluid) |
| `fuel` | 0.35 | `fuel` | reeks hard (strength 8) |
| `acid` | 0.20 | `chem` | eats every worn garment (durability) + burns |
| `solvent` | 0.85 | `chem` | inert on its own — it delivers whatever the container had dissolved in it |
| `blood`, `chem` | 0.05 / 0.60 | `blood` / `chem` | — |

Cooling is **derived, not decreed**: being wet already multiplies body-temperature drift, so a
soaking cools you over the following minutes for free. Only the instant of contact is coded, and
only for a cold liquid.

**A splash hurts but can never kill** (floors at 1 HP). Killing routes through `handlePlayerDeath`,
wanted stars, a corpse and possibly jail — a verb that tips a cup out has no business owning any of
that. If you want somebody dead, `attack` them.

## Seams

- **Substrate**: `applyTopical`, `applyTopicalToAll`, `registerTopicalEffect`,
  `registerTopicalWetting`, `registerFluidResolver`, `describeContainerFluid`,
  `getTopicalConsent`/`setTopicalConsent`, `needsTopicalConsent`, `TOPICAL_FLUIDS`.
- **Event**: emits `topical.applied` `{ playerId, fluid, potency, actorId }`.
- **Registered elsewhere**: the wetting pass (clothing-wetness), the container resolvers (fillable,
  drinks).
- **Callers**: `splash` here; `plugins/flight/hazards.js` `spray` (the Locust's booms, per player in
  the tile below).

## Adding a liquid

Add its row to `TOPICAL_FLUIDS` (description + `absorb`) and register the consequence from the plugin
that owns the state it writes. If it's a carrier rather than a substance in its own right, leave the
drug off the table — the container names its own cargo. If it arrives in a new kind of container, register a resolver from the
plugin that owns that container. Don't add a branch to the duster or to `splash`.
