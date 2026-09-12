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
- Registers `drinks.finishServing`, `drinks.serveVended`.
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

## A rig serves; a person is better
`drinks.serveVended` is the seam `plugins/vending` dispenses through. A machine with `flags.vend_drink` hands you a vessel with the drink already in it and charges for it — the espresso-rig case, which before this was a cup dispenser you were expected to bring your own grounds to.

- **The band comes off the tier and sits below its ceiling** (`VEND_BANDS`). Pushing a button gets you a consistent cup; the top of the ladder is what a pair of hands is for, and a player brewing at the same rig with good grounds and a good roll beats it. No machine ever serves `masterful`.
- **The price is the vessel plus the tier** (`VEND_CHARGE`). You keep the cup, so the price has to cover it — otherwise the salon's brass lever is a faucet handing out ₵30 demitasses. That is also the whole of "luxury": nothing new is authored, because the cup a rig dispenses already says what kind of place it stands in.
- **It answers `undefined` for a machine that isn't one of ours**, the same fall-through `mix` uses when it hands a bowl to cooking. Vending never learns the vessel schema.

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
- A **dispenser that serves a drink** is content: furniture `flags.vend_drink` beside the `flags.vends` and `flags.brew_tier` it already has. No edit here.

## See also
[docs/systems-drinks.md](../../docs/systems-drinks.md) — including the `fromNearby` seam that lets a kitchen hold its own pots.
