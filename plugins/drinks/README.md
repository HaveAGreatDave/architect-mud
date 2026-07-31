# drinks

**Purpose** — mixology, drinkware and hot drinks. `mix` builds a drink in a **reusable vessel**; `brew` needs a hot-water appliance. The whole point of a mug is that you keep it, so a finished drink is **not a new item row** — it lives on the vessel's `custom_data` as a serving count and a quality band. You carry it, drink it down, decant it, and rinse it out.

## Commands
- `mix` — build a cold drink from what you are carrying.
- `brew` — hot drinks; needs an appliance.
- `rinse` — clean the vessel out at a sink.
- `recipes` — what you could make.

## Specialized actions
- `drink` and `pour`, both gated on the `drinkware` tag.

## Actions
- Registers `drinks.finishServing`.
- Consumes `consume.begin`, `bodily.drinkContaminated`.

## Hooks
- `item.describeVessel`

## Recipes match on PROFILES, not item ids
Exactly as `dishes.js` does — with two deliberate differences:
- `vessels` is a **LIST**, not a single value.
- **`medium` profiles** (water, ice) fill a glass **without scoring it**, so diluting does not change what you made.

## Alcohol is derived
Alcohol is computed from `abv` × pours and applied through the ordinary `drug_alcohol` laced path on **each swallow** — so a mixed drink and a bottled one get you drunk identically. A zero derivation applies **no drug at all**.

## Heat is derived, not ticked
Hot drinks are appliance-gated on `flags.brew_tier`; cooling is computed from `hot_at` on read. No timer, no tick.

## Load order is load-bearing
Specialized actions fire in **registration order**, and `drinks` must claim `drink` **before** `fillable`, or a cup holding a poured drink is treated as plain water. Alphabetical ordering already does this (d < f); the belt to that brace is the `holdsDrink()` guard inside `fillable`, which does **not** depend on ordering.

## One deliberate omission
A vessel drink **does not** pass through `applyItemUse`, so it inherits none of `well_fed` / `restore_hp` / freshness / the `item.consumed` hook. `finishServing` implements thirst, sanity and alcohol — and nothing else. This is a choice, not a gap.

## Dependencies
**fillable** · **consume** · **appliances**

## Extension points
- A new **ingredient** needs only `tags.drink_profile` + `tags.pour_units` (+ `tags.abv` if alcoholic) to work in every recipe its profile fits — no edit here.
- A new **appliance tier** is one entry in `config.js` `BREW_TIERS` plus the furniture flag.
- **Drinkware** is `tags.drinkware` + `tags.drinkware_kind` + `tags.fillable` (capacity in servings).

## See also
[docs/systems-drinks.md](../../docs/systems-drinks.md) — including the `fromNearby` seam that lets a kitchen hold its own pots.
